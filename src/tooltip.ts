// Hover 浮窗:游標停在英文字上 → 顯示英美音標、發音、繁中釋義。
//
// 為什麼走 DOM 的 caretRangeFromPoint,而不是 CodeMirror 的 hoverTooltip:
// CM6 extension 只在編輯模式(source / live preview)生效,閱讀模式滑過去
// 不會有反應——而讀筆記多半是在閱讀模式。走 DOM 一套實作兩種模式都能用,
// 代價是要自己處理定位與生命週期。

import { formsFor, meaningfulLines } from "./lemma";
import { t } from "./i18n";
import type { SectionId } from "./sections";
import type { Lookup, InflectionKind, GenOpts } from "./types";
import { ABORTED } from "./types";
import type { CambridgeEntry } from "./cambridge-parse";

/** 從畫面座標找出游標底下的英文字,連同所在句子。 */
export interface HoverHit {
	word: string;
	/** 該字所在的句子,給「在這句話裡是什麼意思」與生詞本的原句引用用 */
	sentence: string;
	/** 字在畫面上的位置,用來定位浮窗 */
	rect: DOMRect;
}

const INFLECTION_LABEL: Record<InflectionKind, string> = {
	past: "past tense",
	done: "past participle",
	ing: "-ing form",
	third: "3rd person singular",
	plural: "plural",
	comparative: "comparative",
	superlative: "superlative",
	lemma: "inflected form",
};

const INFLECTION_LABEL_ZH: Record<InflectionKind, string> = {
	past: "過去式",
	done: "過去分詞",
	ing: "現在分詞",
	third: "第三人稱單數",
	plural: "複數",
	comparative: "比較級",
	superlative: "最高級",
	lemma: "變化形",
};

// 第一道關卡:白名單。只在「筆記內容」裡查。
//
// 一開始是用黑名單(想到一種不該觸發的地方就加一條排除),結果一直漏——
// 程式碼區塊漏了,Obsidian 自己的 vault 切換選單也漏了。問題出在思路:
// **Obsidian 的 UI 是無界的**(選單、側邊欄、狀態列、分頁標題、檔案總管、
// 搜尋結果、設定畫面…),列不完。
//
// 反過來就有界了:筆記內容只會出現在這幾個容器裡,其餘一律不是內文。
//   .cm-content            編輯／即時預覽(CodeMirror 6 的可編輯區)
//   .markdown-preview-view 閱讀模式
//   .markdown-rendered     hover 預覽、Canvas 卡片等渲染出來的 Markdown
const CONTENT_SELECTOR = ".cm-content, .markdown-preview-view, .markdown-rendered";

// 第二道關卡:內容裡面仍要跳過的東西——程式碼、frontmatter、屬性面板。
//
// 為什麼不是一行 CSS selector:`code` / `pre` 只存在於**閱讀模式**的 DOM。
// 在編輯／即時預覽模式下 CodeMirror 根本不產生那兩個標籤,而是給行加 class
// (`HyperMD-codeblock` 之類),所以只比對標籤會整個漏掉——這正是 2026-07-24
// 回報「程式碼區塊裡還是會跳浮窗」的成因。
//
// 改成往上走祖先鏈,同時看標籤與 class **字串內容**:任何 class 含 "code" 的
// 元素都當成程式碼。這樣不依賴記住 Obsidian 目前叫什麼名字,它改版換名也不會壞。
const SKIP_TAGS = new Set(["CODE", "PRE", "KBD", "SAMP", "TEXTAREA", "INPUT"]);
const SKIP_CLASS_PARTS = ["code", "frontmatter", "metadata", "wordfolio-tooltip"];

/** 這個元素是不是在筆記內容裡(而不是 Obsidian 的介面)。 */
export function inNoteContent(el: Element | null): boolean {
	return !!el?.closest?.(CONTENT_SELECTOR);
}

export function inSkippedContext(start: Element | null): boolean {
	for (let n: Element | null = start; n; n = n.parentElement) {
		if (SKIP_TAGS.has(n.tagName)) return true;
		// SVG 元素的 className 不是字串,用 classList 才安全。
		for (const cls of Array.from(n.classList)) {
			const lower = cls.toLowerCase();
			if (SKIP_CLASS_PARTS.some((part) => lower.includes(part))) return true;
		}
	}
	return false;
}

function isWordChar(c: string): boolean {
	return /[A-Za-z'’-]/.test(c);
}

/** 抓出 offset 所在的句子(用 . ! ? 與換行斷句)。 */
function sentenceAround(text: string, offset: number): string {
	const isBoundary = (i: number) =>
		i < 0 || i >= text.length || /[.!?\n]/.test(text[i]);

	let start = offset;
	while (start > 0 && !isBoundary(start - 1)) start--;
	let end = offset;
	while (end < text.length && !isBoundary(end)) end++;
	if (end < text.length) end++; // 把句號本身帶進來

	return text.slice(start, end).trim();
}

/** 用畫面座標找出底下的英文字。找不到(空白、非英文、被排除的容器)回 null。 */
export function hitTest(x: number, y: number): HoverHit | null {
	const el = document.elementFromPoint(x, y);
	if (!el || !inNoteContent(el) || inSkippedContext(el)) return null;

	// Electron 是 Chromium,用 WebKit 系的 caretRangeFromPoint。
	const caret = (document as Document & {
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	}).caretRangeFromPoint?.(x, y);
	if (!caret) return null;

	const node = caret.startContainer;
	if (node.nodeType !== Node.TEXT_NODE) return null;

	// caretRangeFromPoint 落到的文字節點未必在 elementFromPoint 那個元素底下
	// (游標壓在邊界時會差一個元素),所以實際咬到的位置兩道關卡都要再驗一次。
	const parent = node.parentElement;
	if (!inNoteContent(parent) || inSkippedContext(parent)) return null;

	const text = node.nodeValue ?? "";
	const offset = caret.startOffset;

	let from = offset;
	let to = offset;
	// 游標壓在字尾時 offset 指向下一個字元,往回退一格才咬得到。
	if (from > 0 && (to >= text.length || !isWordChar(text[to]))) from--;
	if (from < 0 || from >= text.length || !isWordChar(text[from])) return null;

	to = from;
	while (from > 0 && isWordChar(text[from - 1])) from--;
	while (to < text.length && isWordChar(text[to])) to++;

	// 修掉咬到頭尾的標點。
	while (from < to && /[-'’]/.test(text[from])) from++;
	while (to > from && /[-'’]/.test(text[to - 1])) to--;

	const word = text.slice(from, to);
	if (!/^[A-Za-z][A-Za-z'’-]*$/.test(word)) return null;

	const range = document.createRange();
	range.setStart(node, from);
	range.setEnd(node, to);

	return {
		word,
		sentence: sentenceAround(text, from),
		rect: range.getBoundingClientRect(),
	};
}

/** 浮窗要畫哪些區塊、照什麼順序。 */
export interface ViewConfig {
	order: SectionId[];
	enabled: Record<SectionId, boolean>;
}

/** 選取圖示怎麼展開浮窗:點一下 / 停留 / 兩者 */
export type IconMode = "click" | "hover" | "both";

export interface IconOptions {
	/** 點一下能不能展開(click / both) */
	clickable: () => boolean;
	/** 停留能不能展開(hover / both) */
	hoverable: () => boolean;
	/** 停留多久展開(ms) */
	dwell: () => number;
}

/**
 * 選取後浮現的小書本 Logo(沙拉查詞式)。選字不會馬上跳浮窗——先出現這個,
 * 點了(或停留)才查。這樣選字做別的事(複製、標記)時不會被浮窗打擾。
 *
 * 滑鼠移上去有翻頁動畫(純 CSS,`:hover` 觸發);若開了「停留展開」,停留超過
 * dwell() 毫秒就自動展開,秒數可在設定調。
 */
export class SelectionIcon {
	private el: HTMLButtonElement;
	private visible = false;
	private dwellTimer: number | null = null;

	constructor(onOpen: () => void, private opts: IconOptions) {
		this.el = document.createElement("button");
		this.el.className = "wordfolio-select-icon";
		this.el.setAttribute("aria-label", "WordFolio");
		// 一本翻開的書:靜止的左頁 + 會翻的右頁(右頁單獨一個元素才能做翻頁動畫)。
		this.el.innerHTML =
			'<span class="wf-book"><span class="wf-page wf-page-left"></span>' +
			'<span class="wf-page wf-page-right"></span></span>';

		// mousedown 一定要擋掉,不然點 Logo 會先清掉選取,查詢就拿不到字了。
		this.el.addEventListener("mousedown", (e) => {
			e.preventDefault();
			e.stopPropagation();
		});
		this.el.addEventListener("click", (e) => {
			e.preventDefault();
			e.stopPropagation();
			if (this.opts.clickable()) onOpen();
		});
		// 停留展開:移上去開始倒數,移開就取消。翻頁動畫走 CSS :hover,跟這無關。
		this.el.addEventListener("mouseenter", () => {
			if (!this.opts.hoverable()) return;
			this.clearDwell();
			this.dwellTimer = window.setTimeout(onOpen, this.opts.dwell());
		});
		this.el.addEventListener("mouseleave", () => this.clearDwell());

		this.el.style.display = "none";
		document.body.appendChild(this.el);
	}

	get isOpen(): boolean {
		return this.visible;
	}

	contains(target: EventTarget | null): boolean {
		return target instanceof Node && this.el.contains(target);
	}

	show(anchor: DOMRect): void {
		this.el.style.display = "";
		this.visible = true;
		const gap = 4;
		const b = this.el.getBoundingClientRect();
		let left = anchor.right + gap;
		let top = anchor.bottom + gap;
		if (left + b.width > window.innerWidth - gap) left = window.innerWidth - b.width - gap;
		if (top + b.height > window.innerHeight - gap) top = anchor.top - b.height - gap;
		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
	}

	hide(): void {
		this.clearDwell();
		if (!this.visible) return;
		this.visible = false;
		this.el.style.display = "none";
	}

	private clearDwell(): void {
		if (this.dwellTimer !== null) {
			window.clearTimeout(this.dwellTimer);
			this.dwellTimer = null;
		}
	}

	destroy(): void {
		this.clearDwell();
		this.el.remove();
	}
}

export interface TooltipCallbacks {
	/** 點喇叭 */
	onSpeak: (word: string, accent: "uk" | "us") => void;
	/** 點「加入生詞本」 */
	onAdd: (lookup: Lookup, sentence: string) => void;
	/** 點「在這句話裡是什麼意思」;回傳解釋文字 */
	onAsk?: (lookup: Lookup, sentence: string, gen: GenOpts) => Promise<string>;
	/** 點「例句與用法」;回傳例句、搭配、辨析 */
	onUsage?: (lookup: Lookup, gen: GenOpts) => Promise<string>;
	/** 點「字詞詳解」;回傳字根字首與詞族 */
	onDetail?: (lookup: Lookup, gen: GenOpts) => Promise<string>;
	/** 這個字是不是已經在生詞本裡了 */
	isSaved: (word: string) => boolean;
	/** 點了同義詞/詞形等可點的字:跳去查那個字(浮窗內導覽) */
	onNavigate?: (word: string) => void;
	/** 按返回:回上一個查過的字 */
	onBack?: () => void;
	/** 還有沒有上一頁可回 */
	canGoBack?: () => boolean;
	/** 查劍橋詞典(線上);查不到回 null */
	onCambridge?: (word: string, signal: AbortSignal) => Promise<CambridgeEntry | null>;
	/** 劍橋查過了沒(undefined = 還沒查過,null = 查過但沒這個字) */
	cachedCambridge?: (word: string) => CambridgeEntry | null | undefined;
	/** 這幾樣算過了沒(算過就直接畫,不再等模型) */
	cachedAsk?: (lookup: Lookup, sentence: string) => string | undefined;
	cachedUsage?: (word: string) => string | undefined;
	cachedDetail?: (word: string) => string | undefined;
}

/**
 * 浮窗開著多久才開始跑本地 AI。
 *
 * 為什麼要這道閘門:AI 那幾樣現在是自動顯示的(字典就該直接給答案,不該叫人按按鈕),
 * 但本地模型每次要跑幾秒。滑過一整段英文若每個字都觸發,等於排隊幾十次推理。
 * 停留超過這個時間才開始跑——掃視不會觸發,真的停下來看才會。
 */
const AI_DWELL_MS = 700;

/**
 * 劍橋是查網頁不是跑模型,零點幾秒就回來,所以閘門可以短很多。
 * 但還是要有——不然滑過一段文章會朝人家網站送一排請求。
 */
const CAMBRIDGE_DWELL_MS = 250;

export class WordTooltip {
	private el: HTMLDivElement;
	private visible = false;
	/** 重畫世代,用來丟掉晚到的 AI 結果 */
	private renderGen = 0;
	/**
	 * 還在跑的 AI 請求。換字或關掉浮窗時要真的中止——只是「忽略結果」不夠,
	 * 模型還是會在背景跑完,滑過一排字就等於排隊一排推理。
	 */
	private inflight: AbortController[] = [];

	constructor(private cb: TooltipCallbacks) {
		this.el = document.createElement("div");
		this.el.className = "wordfolio-tooltip";
		this.el.style.display = "none";
		document.body.appendChild(this.el);
	}

	destroy(): void {
		this.el.remove();
	}

	get isOpen(): boolean {
		return this.visible;
	}

	/** 游標是不是在浮窗上(在的話不要關掉,使用者可能要點喇叭)。 */
	contains(target: EventTarget | null): boolean {
		return target instanceof Node && this.el.contains(target);
	}

	/**
	 * 游標是不是在浮窗附近(含 margin)。
	 *
	 * 浮窗跟單字之間隔著幾 px 的間隙,游標經過那段空白時 elementFromPoint
	 * 抓到的是底下的筆記而不是浮窗——如果那時就關掉,使用者永遠滑不進來。
	 * 把浮窗周圍一圈也算成「在浮窗上」,那段路就走得過去了。
	 */
	isNear(x: number, y: number, margin: number): boolean {
		if (!this.visible) return false;
		const r = this.el.getBoundingClientRect();
		return (
			x >= r.left - margin &&
			x <= r.right + margin &&
			y >= r.top - margin &&
			y <= r.bottom + margin
		);
	}

	hide(): void {
		this.abortInflight();
		if (!this.visible) return;
		this.visible = false;
		this.el.style.display = "none";
		this.el.empty();
	}

	show(lookup: Lookup, hit: HoverHit, view: ViewConfig): void {
		// 每次重畫換一個世代號:還在路上的 AI 結果回來時比對,不是這一輪的就丟掉。
		this.renderGen++;
		this.abortInflight();
		this.el.empty();
		this.render(lookup, hit, view);
		this.el.style.display = "";
		this.visible = true;
		this.position(hit.rect);
	}

	// ---------------------------------------------------------- 內容

	private render(lookup: Lookup, hit: HoverHit, view: ViewConfig): void {
		this.renderHead(lookup, hit);

		// 依使用者設定的順序逐一產出。每個區塊沒資料就自己不畫,
		// 所以這裡不需要判斷「這個字有沒有音標／有沒有變化形」。
		for (const id of view.order) {
			if (!view.enabled[id]) continue;
			this.renderSection(id, lookup, hit);
		}
	}

	/** 標題列不列入可排序的區塊:單字本身跟「加入生詞本」永遠要在最上面。 */
	private renderHead(lookup: Lookup, hit: HoverHit): void {
		const { entry } = lookup;
		const head = this.el.createDiv({ cls: "wordfolio-head" });

		// 從同義詞點進來的話,左邊給一顆返回鍵(像瀏覽器的上一頁)。
		if (this.cb.canGoBack?.()) {
			const back = head.createEl("button", {
				cls: "wordfolio-back",
				text: "‹",
				attr: { "aria-label": t("tooltip_back") },
			});
			back.onclick = (e) => {
				e.preventDefault();
				e.stopPropagation();
				this.cb.onBack?.();
			};
		}

		head.createSpan({ cls: "wordfolio-word", text: entry.w });

		if (lookup.inflection) {
			const zh = t("label_uk") === "英"; // 借語言判斷,避免再開一個 API
			const label = zh
				? INFLECTION_LABEL_ZH[lookup.inflection]
				: INFLECTION_LABEL[lookup.inflection];
			head.createSpan({
				cls: "wordfolio-inflection",
				text: zh ? `${hit.word}・${label}` : `${hit.word} · ${label}`,
			});
		}

		const saved = this.cb.isSaved(entry.w);
		const addBtn = head.createEl("button", {
			cls: `wordfolio-add${saved ? " is-saved" : ""}`,
			text: saved ? "✓" : "＋",
			attr: { "aria-label": saved ? t("tooltip_added") : t("tooltip_add") },
		});
		addBtn.disabled = saved;
		addBtn.onclick = () => {
			this.cb.onAdd(lookup, hit.sentence);
			addBtn.textContent = "✓";
			addBtn.addClass("is-saved");
			addBtn.disabled = true;
		};
	}

	private renderSection(id: SectionId, lookup: Lookup, hit: HoverHit): void {
		const { entry } = lookup;

		switch (id) {
			case "phonetics": {
				const uk = entry.uk ?? entry.ph;
				if (!uk && !entry.us) return;
				const row = this.el.createDiv({ cls: "wordfolio-phonetics" });
				this.accent(row, "uk", uk, entry.w);
				this.accent(row, "us", entry.us, entry.w);
				return;
			}

			case "translation": {
				const box = this.el.createDiv({ cls: "wordfolio-translation" });
				for (const line of meaningfulLines(entry.tr)) {
					box.createDiv({ text: line });
				}
				return;
			}

			case "english": {
				if (!entry.def) return;
				const box = this.el.createDiv({ cls: "wordfolio-definition" });
				for (const line of entry.def.split("\\n")) {
					if (line.trim()) box.createDiv({ text: line.trim() });
				}
				return;
			}

			// 變化形自己另有釋義時才顯示(例:running 當名詞的「賽跑」)
			case "surface": {
				if (!lookup.surfaceEntry) return;
				const box = this.el.createDiv({ cls: "wordfolio-surface-sense" });
				box.createSpan({ cls: "wordfolio-surface-word", text: hit.word });
				for (const line of meaningfulLines(lookup.surfaceEntry.tr)) {
					box.createDiv({ text: line });
				}
				return;
			}

			case "frequency": {
				const parts: string[] = [];
				if (entry.collins) parts.push("★".repeat(entry.collins));
				if (entry.oxford) parts.push("Oxford 3000");
				if (entry.bnc) parts.push(`BNC ${entry.bnc.toLocaleString()}`);
				if (entry.frq) parts.push(`COCA ${entry.frq.toLocaleString()}`);
				if (!parts.length) return;
				this.el.createDiv({ cls: "wordfolio-meta", text: parts.join("　·　") });
				return;
			}

			case "exams": {
				if (!entry.tag?.length) return;
				this.el.createDiv({ cls: "wordfolio-meta", text: entry.tag.join(" · ") });
				return;
			}

			case "forms": {
				const forms = formsFor(entry.exch);
				if (!forms.length) return;
				this.el.createDiv({
					cls: "wordfolio-forms",
					text: `${t("tooltip_forms")}: ${forms.join(" / ")}`,
				});
				return;
			}

			case "cambridge": {
				if (!this.cb.onCambridge) return;
				this.cambridgeSection(entry.w, hit);
				return;
			}

			case "examples": {
				if (!entry.ex?.length) return;
				const box = this.el.createDiv({ cls: "wordfolio-examples" });
				for (const ex of entry.ex) {
					box.createDiv({ cls: "wordfolio-example", text: ex });
				}
				return;
			}

			case "synonyms": {
				if (!entry.syn?.length && !entry.ant?.length) return;
				const box = this.el.createDiv({ cls: "wordfolio-synonyms" });
				const row = (labelKey: string, words: string[]) => {
					const r = box.createDiv({ cls: "wordfolio-syn-row" });
					r.createSpan({ cls: "wordfolio-syn-label", text: t(labelKey) });
					// 每個字做成可點的:點了就在浮窗裡跳去查那個字,可以再返回。
					words.forEach((w, i) => {
						if (i) r.createSpan({ text: ", " });
						this.wordLink(r, w);
					});
				};
				if (entry.syn?.length) row("label_syn", entry.syn);
				if (entry.ant?.length) row("label_ant", entry.ant);
				return;
			}

			// 一定要按才會呼叫 Claude,hover 自動觸發會滑一排字燒一排 token。
			case "claude": {
				if (!this.cb.onAsk) return;
				// 句子跟這個字一樣時沒有「在這句話裡」可言(選字查詢就是這種),跳過。
				if (!hit.sentence || hit.sentence.trim() === hit.word.trim()) return;
				this.aiSection(
					t("tooltip_ask_claude"),
					this.cb.cachedAsk?.(lookup, hit.sentence),
					(gen) => this.cb.onAsk!(lookup, hit.sentence, gen),
					hit
				);
				return;
			}

			case "usage": {
				if (!this.cb.onUsage) return;
				this.aiSection(
					t("tooltip_usage"),
					this.cb.cachedUsage?.(entry.w),
					(gen) => this.cb.onUsage!(lookup, gen),
					hit
				);
				return;
			}

			case "detail": {
				if (!this.cb.onDetail) return;
				this.aiSection(
					t("tooltip_detail"),
					this.cb.cachedDetail?.(entry.w),
					(gen) => this.cb.onDetail!(lookup, gen),
					hit
				);
				return;
			}
		}
	}

	/**
	 * 可點的單字(同義詞、反義詞…)。點了在浮窗內跳去查那個字。
	 * 沒有 onNavigate 就退回純文字,不給假的可點外觀。
	 */
	private wordLink(parent: HTMLElement, word: string): void {
		if (!this.cb.onNavigate) {
			parent.createSpan({ text: word });
			return;
		}
		const a = parent.createEl("a", { cls: "wordfolio-word-link", text: word });
		// mousedown 擋掉,不然點下去會清掉頁面上的選取。
		a.onmousedown = (e) => {
			e.preventDefault();
			e.stopPropagation();
		};
		a.onclick = (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.cb.onNavigate!(word);
		};
	}

	/** 兩顆 AI 按鈕的共用行為:按下去 → 顯示進行中 → 換成結果或錯誤。 */
	/**
	 * 劍橋詞典區塊:按義項顯示「英文定義 + 繁中 + 例句(附中譯)」。
	 * 這是人編的詞典內容,比離線詞庫那幾行並列釋義好讀,也比本地模型生的可靠。
	 */
	private cambridgeSection(word: string, hit: HoverHit): void {
		const cached = this.cb.cachedCambridge?.(word);
		// 查過但沒有這個字(冷僻字、變化形):安靜跳過,不要留一塊空的。
		if (cached === null) return;

		const box = this.el.createDiv({ cls: "wordfolio-camb" });
		if (cached) {
			this.renderCambridge(box, cached);
			return;
		}

		const loading = box.createDiv({ cls: "wordfolio-ai-body is-loading", text: t("tooltip_looking_up") });
		const gen = this.renderGen;

		window.setTimeout(async () => {
			if (gen !== this.renderGen) return;
			const ctrl = new AbortController();
			this.inflight.push(ctrl);
			try {
				const data = await this.cb.onCambridge!(word, ctrl.signal);
				if (gen !== this.renderGen) return;
				loading.remove();
				if (!data) {
					box.remove(); // 查無此字,整塊收掉
					return;
				}
				this.renderCambridge(box, data);
				this.position(hit.rect);
			} catch {
				if (gen !== this.renderGen) return;
				// 沒網路之類:安靜收掉。離線那幾個區塊本來就還在,不必嚇使用者。
				box.remove();
			}
		}, CAMBRIDGE_DWELL_MS);
	}

	private renderCambridge(box: HTMLElement, data: CambridgeEntry): void {
		box.empty();
		box.createDiv({ cls: "wordfolio-ai-label", text: t("section_cambridge") });

		// 義項多的字(get、run)會很長,取前六個就夠讀了。
		for (const sense of data.senses.slice(0, 6)) {
			const el = box.createDiv({ cls: "wf-camb-sense" });

			if (sense.guideword || sense.pos) {
				const head = el.createDiv({ cls: "wf-camb-head" });
				if (sense.guideword) head.createSpan({ cls: "wf-camb-gw", text: sense.guideword });
				if (sense.pos) head.createSpan({ cls: "wf-camb-pos", text: sense.pos });
			}

			el.createDiv({ cls: "wf-camb-def", text: sense.def });
			if (sense.zh) el.createDiv({ cls: "wf-camb-zh", text: sense.zh });

			// 每個義項留兩句就好,不然多義字會排到看不完。
			for (const eg of sense.examples.slice(0, 2)) {
				const e = el.createDiv({ cls: "wf-camb-eg" });
				e.createDiv({ cls: "wf-camb-eg-en", text: eg.en });
				if (eg.zh) e.createDiv({ cls: "wf-camb-eg-zh", text: eg.zh });
			}
		}
	}

	/** 中止所有還在跑的 AI 請求。 */
	private abortInflight(): void {
		for (const c of this.inflight) c.abort();
		this.inflight = [];
	}

	/**
	 * 自動生成的 AI 區塊。算過的直接畫;沒算過的先放一行「思考中」,
	 * 等浮窗真的停留超過 AI_DWELL_MS 才開始跑,然後**邊生成邊把字填進去**。
	 *
	 * 串流是關鍵:重點不是總共跑幾秒,是多久看到第一個字。浮窗高度由
	 * position() 綁死在可用空間上,所以內容再長也只會在框內捲動。
	 */
	private aiSection(
		label: string,
		cached: string | undefined,
		run: (gen: GenOpts) => Promise<string>,
		hit: HoverHit
	): void {
		const box = this.el.createDiv({ cls: "wordfolio-ai" });
		box.createDiv({ cls: "wordfolio-ai-label", text: label });
		const body = box.createDiv({ cls: "wordfolio-ai-body" });

		if (cached) {
			body.setText(cached);
			return;
		}

		body.addClass("is-loading");
		body.setText(t("tooltip_asking"));

		const gen = this.renderGen;
		window.setTimeout(async () => {
			if (gen !== this.renderGen) return; // 已經換字了,不用跑

			const ctrl = new AbortController();
			this.inflight.push(ctrl);
			let started = false;

			try {
				await run({
					signal: ctrl.signal,
					onChunk: (partial) => {
						if (gen !== this.renderGen) return;
						if (!started) {
							started = true;
							body.removeClass("is-loading");
						}
						body.setText(partial);
					},
				});
				if (gen !== this.renderGen) return;
				body.removeClass("is-loading");
			} catch (e) {
				if (gen !== this.renderGen) return;
				// 中止是預期行為(使用者滑走了),不要顯示成錯誤。
				if (e instanceof Error && e.message === ABORTED) return;
				body.removeClass("is-loading");
				body.addClass("wordfolio-error");
				body.setText(e instanceof Error ? e.message : String(e));
			}
		}, AI_DWELL_MS);
	}

	private accent(
		parent: HTMLElement,
		accent: "uk" | "us",
		ipa: string | undefined,
		word: string
	): void {
		if (!ipa) return;
		const group = parent.createSpan({ cls: "wordfolio-accent" });
		group.createSpan({
			cls: "wordfolio-accent-label",
			text: t(accent === "uk" ? "label_uk" : "label_us"),
		});
		group.createSpan({ cls: "wordfolio-ipa", text: ipa });
		const speak = group.createEl("button", {
			cls: "wordfolio-speak",
			text: "▶",
			attr: { "aria-label": `${accent.toUpperCase()} ${word}` },
		});
		speak.onclick = () => this.cb.onSpeak(word, accent);
	}

	// ---------------------------------------------------------- 定位

	/**
	 * 貼在字的下方偏左對齊;下方放不下就翻到上方,右邊超出視窗就往左推。
	 * 刻意不蓋住游標所在的那一行,不然滑動時會自己把自己關掉。
	 */
	private position(anchor: DOMRect): void {
		const gap = 6;
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		// 高度先解除限制才量得到真實內容高度。
		this.el.style.maxHeight = "";
		const box = this.el.getBoundingClientRect();

		let left = anchor.left;
		if (left + box.width > vw - gap) left = vw - box.width - gap;
		if (left < gap) left = gap;

		// 上下各剩多少空間。內容長度不可控(AI 邊生成邊變長),所以不是「挑一邊放得下」,
		// 而是「挑空間大的一邊,再把 max-height 綁死在那一邊的可用高度」——
		// 之後內容再長也只會在浮窗內捲動,不會撐出畫面外。
		const below = vh - anchor.bottom - gap * 2;
		const above = anchor.top - gap * 2;
		const useBelow = below >= box.height || below >= above;
		const avail = Math.max(120, useBelow ? below : above);

		this.el.style.maxHeight = `${Math.floor(avail)}px`;
		const height = Math.min(box.height, avail);
		const top = useBelow ? anchor.bottom + gap : Math.max(gap, anchor.top - height - gap);

		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
	}
}
