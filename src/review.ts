// 複習介面:一張一張翻的 Modal。排程邏輯在 schedule.ts,筆記解析與挖空在 note-parse.ts。
//
// 為什麼是 FSRS 不是定時彈窗:市面上號稱有複習的字典外掛(Dictionary Lexicon)
// 其實只是「每 N 分鐘跳一次」,沒有難易度回饋,記得跟記不得的字下次都一樣時間
// 再來。FSRS 會依每次評分調整 stability 與 difficulty,把時間花在記不牢的字上。
//
// 2026-08-28 大改。原本正面只有一個孤零零的單字,答案面是把整篇 markdown 洗成
// 純文字塞進一個 div——結果「英英釋義」變成裸標題、列點的破折號還留著。
// 道哥的回報:「沒有發音選項」「沒有原來出處的完整句子,在學習上很沒有效率」。
//
// 音標與例句其實一直都在筆記裡,是這個檔自己丟掉的:frontmatter 被整段剝掉
// (音標沒了)、`split("## 我遇到它的地方")[0]` 主動切掉例句。現在改成先把筆記
// 解析成有名字的欄位,再一塊一塊畫。

import { App, Modal, TFile, setIcon, type KeymapEventHandler } from "obsidian";
import { t } from "./i18n";
import { gradeCard, Rating, type Grade } from "./schedule";
import {
	parseNote,
	clozeSentence,
	focusSentence,
	letterSlots,
	type SpellingHint,
	slotsFilled,
	spellingAttempt,
	diffLetters,
	hasAttempt,
	type ParsedNote,
} from "./note-parse";
import type { Accent } from "./audio";
import { drawWave, drawWavePlaceholder, type WaveHandle } from "./tooltip";
import type { WaveformData } from "./waveform";
import type { AccentPref } from "./settings";
import type { VocabStore } from "./vocab";
import type { VocabCard } from "./types";

interface Queued {
	file: TFile;
	card: VocabCard;
}

/** 複習過程中要回報出去的事。紀錄與畫面更新交給呼叫端。 */
export interface ReviewHooks {
	/** 每評一張就回報一次。wasNew = 這張是第一次見到的新字。 */
	onGraded?: (rating: Grade, wasNew: boolean) => Promise<void>;
	/** 視窗關掉時叫一次,讓清單視圖把數字重畫。 */
	onClose?: () => void;
	/** 念出這個字。接的是浮窗那套(有道真人錄音,失敗退回系統語音)。 */
	speak?: (word: string, accent: Accent, onProgress?: (p: number | null) => void) => void;
	/** 翻面時要不要自動念一次。 */
	autoSpeak?: () => boolean;
	/** 問題卡一出現就先念一次。 */
	speakFront?: () => boolean;
	/** 要哪一套口音。 */
	accent?: () => AccentPref;
	/** 拼寫練習先給哪幾個字母。 */
	spellingHint?: () => SpellingHint;
	/** 開啟這張卡的筆記(複習到一半想改釋義)。 */
	openNote?: (file: TFile) => void;
	/** 已經算好的發音波形,同步。跟浮窗共用同一份快取。 */
	cachedWaveform?: (word: string, accent: Accent) => WaveformData | null;
	/** 去算波形(只讀磁碟上已有的音檔,不連網)。 */
	loadWaveform?: (word: string, accent: Accent) => Promise<WaveformData | null>;
}

export class ReviewModal extends Modal {
	private queue: Queued[];
	private current: Queued | null = null;
	private note: ParsedNote | null = null;
	private answered = false;
	private reviewed = 0;
	/** 這張卡他在拼寫格填了什麼。翻面後要拿來訂正,所以得跨過重畫存著。 */
	private attempt: string | null = null;
	/** 這張卡的問題面已經自動念過了。重畫(按 Again、切回正面)不再念。 */
	private spokeFront = false;
	/**
	 * 這次重畫註冊的快捷鍵。
	 *
	 * 每次 render 都會重新註冊,不清掉的話會一路累積——翻面、按 Again、
	 * 下一張都各疊一層,同一個鍵最後會觸發到早就被移除的舊按鈕。
	 * 這是原本就有的問題,只是以前只註冊空白與 1–4,不容易看出來。
	 */
	private keys: KeymapEventHandler[] = [];

	constructor(
		app: App,
		private store: VocabStore,
		queue: Queued[],
		private hooks: ReviewHooks = {}
	) {
		super(app);
		// 每次順序不同,避免照字母序背成「順序記憶」。
		this.queue = [...queue].sort(() => Math.random() - 0.5);
	}

	onOpen(): void {
		this.modalEl.addClass("wordfolio-review-modal");
		this.next();
	}

	onClose(): void {
		this.clearKeys();
		this.contentEl.empty();
		this.hooks.onClose?.();
	}

	private next(): void {
		this.current = this.queue.shift() ?? null;
		this.answered = false;
		this.note = null;
		this.attempt = null;
		this.spokeFront = false;
		if (!this.current) {
			this.renderDone();
			return;
		}
		void this.render();
	}

	/** 目前偏好的口音設定。沒接就當兩套都要(既有行為)。 */
	private accentPref(): AccentPref {
		return this.hooks.accent?.() ?? "both";
	}

	/**
	 * 自動發音要用哪一套。
	 *
	 * 只選一種時當然用那一種;兩種都要時用美式——它是多數學習者的目標,
	 * 而且想聽英式的人隨時可以按旁邊那顆。
	 */
	private mainAccent(): Accent {
		return this.accentPref() === "uk" ? "uk" : "us";
	}

	/** 焦點正在拼寫格裡——這時字母鍵是拿來打字的,不是快捷鍵。 */
	private typingInSlot(): boolean {
		return !!document.activeElement?.classList.contains("wf-slot-input");
	}

	/**
	 * 綁一個快捷鍵,並在按鈕上掛一個鍵帽圖示。
	 *
	 * @param whileTyping 在拼寫格裡打字時也要生效。只有空白與 Enter 用得上——
	 *                    它們不是字母,拼一個英文字永遠不會按到。
	 */
	private bind(
		button: HTMLElement | null,
		key: string,
		action: () => void,
		whileTyping = false
	): void {
		if (button) button.createSpan({ cls: "wf-key", text: key.toUpperCase() });
		this.keys.push(
			this.scope.register([], key, (e) => {
				if (!whileTyping && this.typingInSlot()) return;
				e.preventDefault();
				// 按鍵按下要看得見有反應。多數快捷鍵按下去畫面本來就會變(翻面、
				// 評分、換卡),那個變化自己就是回饋;真正需要這個的是**不改變畫面**
				// 的那幾顆——聽發音、UK、US 按了只有聲音,沒有這一下就不知道
				// 到底有沒有按到。
				this.flash(button);
				action();
				return false;
			})
		);
	}

	/** 讓按鈕閃一下,表示這個鍵真的被接住了。 */
	private flash(button: HTMLElement | null): void {
		if (!button) return;
		button.addClass("wf-pressed");
		window.setTimeout(() => button.removeClass("wf-pressed"), 220);
	}

	private clearKeys(): void {
		for (const h of this.keys) this.scope.unregister(h);
		this.keys = [];
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.removeClass("wf-typing");
		this.clearKeys();
		const entry = this.current!;

		// 生詞本才是事實來源,不重查詞庫——使用者自己補在筆記裡的東西也要看得到。
		if (!this.note) {
			this.note = parseNote(await this.app.vault.read(entry.file));
		}
		const note = this.note;

		contentEl.createDiv({
			cls: "wordfolio-review-progress",
			text: `${this.reviewed + 1} / ${this.reviewed + 1 + this.queue.length}`,
		});
		if (!this.answered) {
			this.renderFront(contentEl, note, entry.card.word);
			// 問題卡一出現就先念一次。刻意只在**第一次**看到這張卡時念——
			// 按 Again 重問同一個字時不再念,不然同一個字會被念到煩。
			if (this.hooks.speakFront?.() && !this.spokeFront) {
				this.spokeFront = true;
				this.hooks.speak?.(entry.card.word, this.mainAccent());
			}
			return;
		}

		contentEl.createDiv({ cls: "wordfolio-review-word", text: entry.card.word });
		this.renderPhonetics(contentEl, note, entry.card.word, true);
		this.renderBack(contentEl, note);
	}

	/** 翻到答案面。按鈕、空白鍵、拼寫格裡的 Enter 都走這裡。 */
	private flip(): void {
		if (this.answered) return;
		const word = this.current!.card.word;
		this.answered = true;
		void this.render().then(() => {
			// 翻面就念一次,不用多按一下。一次複習幾十張,每張都要手動點會懶得點。
			if (this.hooks.autoSpeak?.()) this.hooks.speak?.(word, this.mainAccent());
		});
	}

	/**
	 * 英美兩套音標,各自一顆播放鍵。要聽哪一種是使用者的事,不幫他挑。
	 *
	 * 快捷鍵是 U(UK)與 S(US),兩面一致。
	 *
	 * 原本問題卡用的是 K,但答案卡的 K 已經給了「已學會」——同一個鍵在兩面
	 * 做不同的事,等於要記兩套。改成 U / S 之後兩面一樣,而且 U 對 UK、S 對 US
	 * 本身就好記。
	 */
	private renderPhonetics(
		parent: HTMLElement,
		note: ParsedNote,
		word: string,
		bindKeys = true
	): void {
		const pairs: [Accent, string, string | undefined, string][] = [
			["uk", t("accent_uk"), note.ukPhonetic, "u"],
			["us", t("accent_us"), note.usPhonetic, "s"],
		];
		const pref = this.accentPref();
		const wanted = pairs.filter(([a]) => pref === "both" || pref === a);
		if (!wanted.some(([, , ipa]) => ipa)) return;

		const row = parent.createDiv({ cls: "wordfolio-review-phonetics" });
		for (const [accent, label, ipa, key] of wanted) {
			if (!ipa) continue;
			const b = row.createEl("button", { cls: "wordfolio-review-speak" });
			b.createSpan({ cls: "wf-accent-label", text: label });
			b.createSpan({ cls: "wf-ipa", text: ipa });
			setIcon(b.createSpan({ cls: "wf-speak-icon" }), "volume-2");
			// 波形。**放在音標按鈕裡面**,所以只有音標本來就看得到的時候才出現——
			// 問題卡的音標藏在「顯示音標」後面,是使用者自己選擇要的提示,而 IPA
			// 本身洩漏的音節數遠比一條波形多,所以這裡不會多給任何線索。
			const slot = b.createSpan({ cls: "wordfolio-wave-slot" });
			let handle: WaveHandle | null = null;
			const ready = this.hooks.cachedWaveform?.(word, accent);
			if (ready) {
				handle = drawWave(slot, ready.env);
			} else {
				drawWavePlaceholder(slot, t("wave_not_downloaded"));
				void this.hooks.loadWaveform?.(word, accent).then((w) => {
					if (w && slot.isConnected) handle = drawWave(slot, w.env);
				});
			}

			// 第一次播新字時波形還不存在(音檔是這一次才下載的),
			// 所以在第一個進度回報時再撿一次。理由同 tooltip.ts。
			const play = () =>
				this.hooks.speak?.(word, accent, (p) => {
					if (!slot.isConnected) return;
					if (!handle) {
						const w = this.hooks.cachedWaveform?.(word, accent);
						if (w) handle = drawWave(slot, w.env);
					}
					handle?.progress(p);
				});
			b.onclick = (e) => {
				e.stopPropagation();
				play();
			};
			if (bindKeys) this.bind(b, key, play);
		}
	}

	/**
	 * 正面:**不顯示那個字**,只給線索。
	 *
	 * 上一版把單字大大地印在最上面,底下才是挖空的例句——挖掉的字自己在標題裡,
	 * 挖空完全失效。道哥的原話:「你直接就把答案給我了,我根本就沒有辦法學習啊!」
	 *
	 * 線索由淺到深排,前三樣免費、後兩樣要自己按:
	 *
	 *   1. **那個字的中文釋義**  要猜的東西是什麼意思
	 *   2. 挖空的原句            看得到它在句子裡的位置與詞性
	 *   3. 那句話的中譯          情境參考,小字
	 *   4. 首尾字母              s______t,把範圍縮到想得起來的程度
	 *   5. 聽發音(要按)         音檔本身就是很強的提示,不主動播
	 *   6. 看音標(要按)         IPA 幾乎等於答案,所以收起來
	 *
	 * 第 1 層是二改補上的。原本只給句子中譯,但**字幕的翻譯常常跟原句一樣是
	 * 斷的**——`enabled them to subsist` 的中譯是「使他們能夠」,`subsist`
	 * 那半截根本沒翻到。道哥:「連那個答案空缺的也沒給,我怎麼知道我要猜的字是
	 * 什麼?」句子中譯給的是情境,**要猜的東西是什麼意思得由釋義來講**。
	 *
	 * 他說得很清楚:「重點是在我思考的過程,你要給我線索去思考」——所以這裡的
	 * 設計目標不是「讓他答對」,是**讓他想得動**。
	 */
	private renderFront(parent: HTMLElement, note: ParsedNote, word: string): void {
		// 挑一句挖得動的。焦點化先把字幕的 `>>` 前後文切掉,只留含這個字的那段。
		let cloze: string | null = null;
		let translation: string | undefined;
		for (const s of note.sentences) {
			const focused = focusSentence(s.text, word, note.forms);
			const blanked = clozeSentence(focused, word, note.forms);
			if (blanked) {
				cloze = blanked;
				translation = s.translation;
				break;
			}
		}

		// 第一層線索:這個字的中文意思。一定要有,不然根本不知道要猜什麼。
		if (note.meaning.length) {
			const gloss = parent.createDiv({ cls: "wordfolio-review-gloss" });
			for (const line of note.meaning) gloss.createDiv({ text: line });
		}

		if (cloze) {
			parent.createDiv({ cls: "wordfolio-review-cloze", text: cloze });
			// 句子中譯降級成情境參考:字幕的翻譯常常是半截的,拿它當主線索會害人。
			if (translation) {
				parent.createDiv({ cls: "wordfolio-review-hint-zh", text: translation });
			}
		}
		// 拼對時主按鈕要換掉:光是格子變綠不會告訴人下一步該做什麼,
		// 而「不是每一個人都知道要按 Enter 鍵才可以進到下一步」。
		let onSpellingDone: (correct: boolean) => void = () => undefined;
		this.renderSpelling(parent, word, (ok) => onSpellingDone(ok));

		const hints = parent.createDiv({ cls: "wordfolio-review-hints" });

		const listen = hints.createEl("button", { cls: "wf-hint-btn" });
		setIcon(listen.createSpan(), "volume-2");
		listen.createSpan({ text: t("review_hint_listen") });
		const hear = () => this.hooks.speak?.(word, this.mainAccent());
		listen.onclick = hear;
		this.bind(listen, "h", hear);

		if (note.ukPhonetic || note.usPhonetic) {
			const reveal = hints.createEl("button", { cls: "wf-hint-btn", text: t("review_hint_ipa") });
			const show = () => {
				reveal.remove();
				this.renderPhonetics(hints, note, word, true);
			};
			reveal.onclick = show;
			this.bind(reveal, "p", show);
		}

		const show = parent.createEl("button", { cls: "mod-cta wordfolio-review-show" });
		const label = show.createSpan({ text: t("review_show_answer") });
		show.onclick = () => this.flip();
		this.bind(show, "a", () => this.flip());
		onSpellingDone = (ok) => {
			show.toggleClass("is-correct", ok);
			label.setText(ok ? t("review_spelled_next") : t("review_show_answer"));
		};
		// 問題卡的字母快捷鍵只在**焦點不在拼寫格**時生效——那一面的鍵盤主要是
		// 拿來填格子的,不保護就會邊打字邊誤觸。
		//
		// 光是這樣還不夠:焦點預設就在第一格,所以快捷鍵幾乎永遠不會生效,
		// 而鍵帽卻一直亮著,等於騙人。所以**鍵帽跟著狀態走**——打字時淡掉,
		// 焦點離開格子(按 Tab)就亮起來。「現在能不能按」變成看得見的。
		//
		// 空白與 Enter 不受這個限制:它們不是字母,拼一個英文字永遠按不到。
		this.bind(null, " ", () => this.flip(), true);
		this.bind(null, "Enter", () => this.flip(), true);
	}

	/**
	 * 可以真的打字填進去的拼寫格。
	 *
	 * 原本這裡是一行靜態的 `w_________e`。道哥:「既然你已經有格子、空格出來了,
	 * 是不是可以讓我把中間的空白填進去呢?這樣是不是可以增加我動腦的機會?」
	 *
	 * 用打的會逼出**拼寫**,而心裡想「喔是 worthwhile」是可以含糊帶過的。
	 * 首尾與連字號那格直接給(它們是線索不是題目),其餘一格一個輸入框。
	 *
	 * 不記分、不擋翻面:全部填對時格子轉綠當作一個確認,填錯不做任何事——
	 * 他早就說過「答對幾題或答錯對我的學習完全沒有幫助」。
	 */
	private renderSpelling(
		parent: HTMLElement,
		word: string,
		onDone: (correct: boolean) => void
	): void {
		const slots = letterSlots(word, this.hooks.spellingHint?.() ?? "both");
		if (!slots.length) return;

		const row = parent.createDiv({ cls: "wordfolio-review-spelling" });
		const inputs: HTMLInputElement[] = [];

		for (const slot of slots) {
			if (!slot.editable) {
				row.createSpan({ cls: "wf-slot wf-slot-given", text: slot.char });
				continue;
			}
			const input = row.createEl("input", {
				cls: "wf-slot wf-slot-input",
				attr: {
					type: "text",
					maxlength: "1",
					// 拼字練習不需要這些幫忙,不然瀏覽器會直接把答案補上。
					autocomplete: "off",
					autocapitalize: "off",
					autocorrect: "off",
					spellcheck: "false",
					"aria-label": t("review_spell_slot"),
				},
			});
			// 焦點在格子裡 = 打字模式,這時字母快捷鍵停用、鍵帽淡掉。
			input.onfocus = () => this.contentEl.addClass("wf-typing");
			input.onblur = () =>
				// 格子之間移動時會短暫失焦,等一拍再判斷才不會閃。
				window.setTimeout(() => {
					if (!this.typingInSlot()) this.contentEl.removeClass("wf-typing");
				}, 0);
			inputs.push(input);
		}
		if (!inputs.length) return;

		const typed = () => inputs.map((i) => i.value);
		const check = () => {
			const values = typed();
			// 翻面之後畫面會重建,所以每次輸入就把作答存起來,翻面時才訂正得出來。
			this.attempt = hasAttempt(values) ? spellingAttempt(slots, values) : null;
			const done = inputs.every((i) => i.value) && slotsFilled(slots, values);
			row.toggleClass("is-correct", done);
			onDone(done);
		};

		/** 全部填滿就放開焦點,字母快捷鍵立刻可用(鍵帽也會跟著亮起來)。 */
		const releaseIfFull = () => {
			if (inputs.every((i) => i.value)) inputs[inputs.length - 1].blur();
		};

		inputs.forEach((input, i) => {
			input.oninput = () => {
				// 只收字母;打了別的就當沒打,不要讓格子留著奇怪的東西。
				input.value = input.value.replace(/[^A-Za-z]/g, "").slice(-1);
				if (input.value && i + 1 < inputs.length) inputs[i + 1].focus();
				check();
				releaseIfFull();
			};
			input.onkeydown = (e) => {
				if (e.key === "Backspace" && !input.value && i > 0) {
					// 空格上按退格要跳回前一格並清掉它,不然會卡在原地。
					e.preventDefault();
					inputs[i - 1].value = "";
					inputs[i - 1].focus();
					check();
					return;
				}
				if (e.key === "ArrowLeft" && i > 0) {
					e.preventDefault();
					inputs[i - 1].focus();
					return;
				}
				if (e.key === "ArrowRight" && i + 1 < inputs.length) {
					e.preventDefault();
					inputs[i + 1].focus();
					return;
				}
				// 空白與 Enter 翻面由 scope 統一處理(見 renderFront 的 bind)。
			};
			// 貼上整個字時一格一格分過去。
			input.onpaste = (e) => {
				e.preventDefault();
				const text = (e.clipboardData?.getData("text") ?? "").replace(/[^A-Za-z]/g, "");
				for (let k = 0; k < text.length && i + k < inputs.length; k++) {
					inputs[i + k].value = text[k];
				}
				inputs[Math.min(i + text.length, inputs.length - 1)].focus();
				check();
				releaseIfFull();
			};
		});

		// 焦點放開之後想改字就沒地方按了,所以讓退格把它抓回最後一格。
		// 這是自動放開焦點的必要配套——不然拼錯最後一個字母只能用滑鼠點回去。
		this.bind(null, "Backspace", () => {
			const last = inputs[inputs.length - 1];
			last.value = "";
			last.focus();
			check();
		});

		// 打開就可以直接開始打,不用先點一下。
		window.setTimeout(() => inputs[0].focus(), 0);
	}

	/** 答案面:一塊一塊畫,不再把 markdown 洗成一團純文字。 */
	private renderBack(parent: HTMLElement, note: ParsedNote): void {
		this.renderCorrection(parent, note.word);

		const body = parent.createDiv({ cls: "wordfolio-review-answer" });

		if (note.meaning.length) {
			const box = body.createDiv({ cls: "wf-review-meaning" });
			for (const line of note.meaning) box.createDiv({ text: line });
		}

		if (note.english.length) {
			const box = this.section(body, t("review_sec_english"));
			for (const line of note.english) box.createDiv({ text: line });
		}

		if (note.forms.length) {
			this.section(body, t("review_sec_forms")).setText(note.forms.join(" / "));
		}

		// 出處例句:答案面給完整的句子(正面是挖空的),看得到這個字實際怎麼用。
		if (note.sentences.length) {
			const box = this.section(body, t("review_sec_sentence"));
			for (const s of note.sentences) {
				box.createDiv({ cls: "wf-review-eg", text: focusSentence(s.text, note.word, note.forms) });
				if (s.translation) box.createDiv({ cls: "wf-review-eg-zh", text: s.translation });
			}
			if (note.source) box.createDiv({ cls: "wf-review-source", text: note.source });
		}

		for (const extra of note.extras) {
			this.section(body, extra.heading).setText(extra.body.replace(/\*\*/g, ""));
		}

		const buttons = parent.createDiv({ cls: "wordfolio-review-buttons" });
		// Grade 是 Rating 去掉 Manual 的子集;複習只會用這四個。
		// 每顆的快捷鍵取自它自己的字首(Again→A、Hard→H、Good→G、Easy→E),
		// 這樣不用背——看按鈕就知道按哪個鍵。1–4 也留著,舊的肌肉記憶不打斷。
		// 顏色由紅到綠一路過去,對應「下次多久再問你」由短到長:
		// Again 紅、Hard 橘、Good 黃、Easy 綠。用 class 而不是 :first-child——
		// 靠位置決定顏色,順序一改就錯。
		// 每顆的意思寫在 tooltip,不寫在卡片上:具體天數每張卡都不一樣,印在每張
		// 卡上只是噪音——道哥:「這個規則不用再每張答案卡上寫出來,應該在計分
		// 系統說明就好。」
		const grades: [Grade, string, string, string][] = [
			[Rating.Again, t("review_again"), "a", "again"],
			[Rating.Hard, t("review_hard"), "h", "hard"],
			[Rating.Good, t("review_good"), "g", "good"],
			[Rating.Easy, t("review_easy"), "e", "easy"],
		];
		grades.forEach(([rating, label, key, tone], i) => {
			const b = buttons.createEl("button", { cls: `wf-grade wf-grade-${tone}` });
			b.setAttribute("aria-label", t(`review_${tone}_desc`));
			b.createSpan({ text: label });
			b.onclick = () => void this.grade(rating);
			this.bind(b, key, () => void this.grade(rating));
			this.bind(null, String(i + 1), () => void this.grade(rating));
		});

		// 次要動作跟評分鍵**同一排**。原本另起一排,兩排按鈕把答案面的重心往下拉,
		// 而且看起來像四顆同等重要的選項又多了兩顆。用一條分隔線分主次,只佔一行。
		buttons.createSpan({ cls: "wf-btn-separator" });

		// 封存:匯進來兩百多個字,一定有一批本來就會的。Easy 只是把它推遠,
		// 它還是會回來;這顆是「別再問我這個字了」。
		const park = buttons.createEl("button", { cls: "wf-secondary-action" });
		park.createSpan({ text: t("review_suspend") });
		park.setAttribute("aria-label", t("review_suspend_desc"));
		park.onclick = () => void this.suspend();
		this.bind(park, "k", () => void this.suspend());

		// 開筆記用圖示就夠——它是最少用到的那顆,不值得佔掉一整個詞的寬度。
		const open = buttons.createEl("button", {
			cls: "wf-secondary-action wf-icon-action",
		});
		setIcon(open.createSpan(), "pencil");
		open.setAttribute("aria-label", t("review_open_note"));
		const edit = () => {
			const file = this.current!.file;
			this.close();
			this.hooks.openNote?.(file);
		};
		open.onclick = edit;
		this.bind(open, "d", edit);
	}

	/**
	 * 訂正:他填了什麼、哪一個字母錯了。
	 *
	 * 道哥:「系統並沒有告訴我答對或答錯。那我錯在哪裡?我原本輸入的答案在哪裡?」
	 *
	 * **不記分不等於不訂正。** 上一版我把兩件事混成一件,以為「答對答錯不重要」
	 * 就代表什麼都不用給——但他要的是不要計分板,不是不要回饋。錯在哪一個字母
	 * 正是這一刻最該看到的東西。
	 *
	 * 沒作答就完全不顯示:那代表他只是想直接看答案,這時跳出一排紅字是在責備他。
	 */
	private renderCorrection(parent: HTMLElement, word: string): void {
		if (!this.attempt) return;

		const diff = diffLetters(this.attempt, word);
		const correct = diff.every((d) => d.ok);

		const box = parent.createDiv({ cls: "wordfolio-review-correction" });
		box.toggleClass("is-correct", correct);
		box.createDiv({
			cls: "wf-correction-label",
			text: correct ? t("review_spell_right") : t("review_spell_wrong"),
		});

		// 全對就不用再把他打的字重播一次,那跟上面的答案一模一樣。
		if (correct) return;

		const row = box.createDiv({ cls: "wf-correction-letters" });
		for (const d of diff) {
			const cell = row.createSpan({
				cls: d.ok ? "wf-correction-letter" : "wf-correction-letter is-wrong",
				// 沒填的格子顯示底線,比一片空白看得出「這裡漏了」。
				text: d.typed.trim() || "_",
			});
			if (!d.ok) cell.setAttribute("aria-label", t("review_spell_should_be", { letter: d.answer }));
		}
	}

	private section(parent: HTMLElement, heading: string): HTMLElement {
		const box = parent.createDiv({ cls: "wf-review-section" });
		box.createDiv({ cls: "wf-review-heading", text: heading });
		return box.createDiv({ cls: "wf-review-body" });
	}

	private async suspend(): Promise<void> {
		const entry = this.current!;
		await this.store.setSuspended(entry.file, true);
		// 封存不算複習過,不寫進複習紀錄——那會讓「今天複習幾張」灌水。
		this.next();
	}

	private async grade(rating: Grade): Promise<void> {
		const entry = this.current!;
		// 「是不是新字」要在排程算下去之前問——gradeCard 一跑狀態就變成
		// learning 了,事後再問永遠是 false,每日新字上限就會失效。
		const wasNew = entry.card.state === "new";
		const updated = gradeCard(entry.card, rating);

		await this.store.saveCard(entry.file, updated);
		await this.hooks.onGraded?.(rating, wasNew);

		// 「重來」就是**立刻再問一次同一個字**。
		//
		// 原本是把卡片推到佇列尾端,結果按下去跳出來的是下一題,要等一整輪才會
		// 再遇到它。道哥:「如果你要做 Again 這個按鈕,應該要重複同樣的問題,
		// 讓我再有一次機會去回答,這樣才對。」——他是對的,那顆按鈕上面寫的就是
		// 「再一次」,跳到別題完全違反它的字面意思。
		//
		// 進度不前進(還是 2 / 24):同一個字重答不該算成又過了一張。
		// 但排程與複習紀錄照記——他確實又看了一次。
		if (rating === Rating.Again) {
			this.current = { file: entry.file, card: updated };
			this.answered = false;
			this.attempt = null;
			void this.render();
			return;
		}

		this.reviewed++;
		this.next();
	}

	private renderDone(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({
			cls: "wordfolio-review-done",
			text: t("review_done", { count: this.reviewed }),
		});
		const close = contentEl.createEl("button", { cls: "mod-cta", text: "OK" });
		close.focus();
		close.onclick = () => this.close();
	}
}
