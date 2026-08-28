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

import { App, Modal, TFile, setIcon } from "obsidian";
import { t } from "./i18n";
import { gradeCard, Rating, type Grade } from "./schedule";
import { parseNote, clozeSentence, focusSentence, hintFor, type ParsedNote } from "./note-parse";
import type { Accent } from "./audio";
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
	speak?: (word: string, accent: Accent) => void;
	/** 翻面時要不要自動念一次。 */
	autoSpeak?: () => boolean;
	/** 開啟這張卡的筆記(複習到一半想改釋義)。 */
	openNote?: (file: TFile) => void;
}

export class ReviewModal extends Modal {
	private queue: Queued[];
	private current: Queued | null = null;
	private note: ParsedNote | null = null;
	private answered = false;
	private reviewed = 0;

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
		this.contentEl.empty();
		this.hooks.onClose?.();
	}

	private next(): void {
		this.current = this.queue.shift() ?? null;
		this.answered = false;
		this.note = null;
		if (!this.current) {
			this.renderDone();
			return;
		}
		void this.render();
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
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
			return;
		}

		contentEl.createDiv({ cls: "wordfolio-review-word", text: entry.card.word });
		this.renderPhonetics(contentEl, note, entry.card.word);
		this.renderBack(contentEl, note);
	}

	/** 英美兩套音標,各自一顆播放鍵。要聽哪一種是使用者的事,不幫他挑。 */
	private renderPhonetics(parent: HTMLElement, note: ParsedNote, word: string): void {
		const pairs: [Accent, string, string | undefined][] = [
			["uk", t("accent_uk"), note.ukPhonetic],
			["us", t("accent_us"), note.usPhonetic],
		];
		if (!pairs.some(([, , ipa]) => ipa)) return;

		const row = parent.createDiv({ cls: "wordfolio-review-phonetics" });
		for (const [accent, label, ipa] of pairs) {
			if (!ipa) continue;
			const b = row.createEl("button", { cls: "wordfolio-review-speak" });
			b.createSpan({ cls: "wf-accent-label", text: label });
			b.createSpan({ cls: "wf-ipa", text: ipa });
			setIcon(b.createSpan({ cls: "wf-speak-icon" }), "volume-2");
			b.onclick = (e) => {
				e.stopPropagation();
				this.hooks.speak?.(word, accent);
			};
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
		// 沒有句子可挖時至少給首尾字母,不然正面會是一片空白。
		parent.createDiv({ cls: "wordfolio-review-shape", text: hintFor(word) });

		const hints = parent.createDiv({ cls: "wordfolio-review-hints" });

		const listen = hints.createEl("button", { cls: "wf-hint-btn" });
		setIcon(listen.createSpan(), "volume-2");
		listen.createSpan({ text: t("review_hint_listen") });
		listen.onclick = () => this.hooks.speak?.(word, "uk");

		if (note.ukPhonetic || note.usPhonetic) {
			const reveal = hints.createEl("button", { cls: "wf-hint-btn", text: t("review_hint_ipa") });
			reveal.onclick = () => {
				reveal.remove();
				this.renderPhonetics(hints, note, word);
			};
		}

		const show = parent.createEl("button", {
			cls: "mod-cta wordfolio-review-show",
			text: t("review_show_answer"),
		});
		show.focus();
		show.onclick = () => {
			this.answered = true;
			void this.render().then(() => {
				// 翻面就念一次,不用多按一下。一次複習幾十張,每張都要手動點會懶得點。
				if (this.hooks.autoSpeak?.()) this.hooks.speak?.(word, "uk");
			});
		};
		// 空白鍵翻面,跟一般閃卡工具一致。
		this.scope.register([], " ", (e) => {
			e.preventDefault();
			show.click();
			return false;
		});
	}

	/** 答案面:一塊一塊畫,不再把 markdown 洗成一團純文字。 */
	private renderBack(parent: HTMLElement, note: ParsedNote): void {
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
		const grades: [Grade, string][] = [
			[Rating.Again, t("review_again")],
			[Rating.Hard, t("review_hard")],
			[Rating.Good, t("review_good")],
			[Rating.Easy, t("review_easy")],
		];
		grades.forEach(([rating, label], i) => {
			const b = buttons.createEl("button", { text: label });
			b.onclick = () => void this.grade(rating);
			// 1–4 對應四個評分鍵。
			this.scope.register([], String(i + 1), (e) => {
				e.preventDefault();
				b.click();
				return false;
			});
		});

		// 次要動作跟評分鍵**同一排**。原本另起一排,兩排按鈕把答案面的重心往下拉,
		// 而且看起來像四顆同等重要的選項又多了兩顆。用一條分隔線分主次,只佔一行。
		buttons.createSpan({ cls: "wf-btn-separator" });

		// 封存:匯進來兩百多個字,一定有一批本來就會的。Easy 只是把它推遠,
		// 它還是會回來;這顆是「別再問我這個字了」。
		const park = buttons.createEl("button", {
			cls: "wf-secondary-action",
			text: t("review_suspend"),
		});
		park.setAttribute("aria-label", t("review_suspend_desc"));
		park.onclick = () => void this.suspend();

		// 開筆記用圖示就夠——它是最少用到的那顆,不值得佔掉一整個詞的寬度。
		const open = buttons.createEl("button", {
			cls: "wf-secondary-action wf-icon-action",
		});
		setIcon(open, "pencil");
		open.setAttribute("aria-label", t("review_open_note"));
		open.onclick = () => {
			const file = this.current!.file;
			this.close();
			this.hooks.openNote?.(file);
		};
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
		this.reviewed++;

		// 到期只存到「日」,所以 FSRS 的 learning step 在這裡補回來:
		// 評「重來」的字排到佇列尾端,本次 session 內會再看到一次。
		if (rating === Rating.Again) {
			this.queue.push({ file: entry.file, card: updated });
		}

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
