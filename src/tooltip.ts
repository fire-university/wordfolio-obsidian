// Hover 浮窗:游標停在英文字上 → 顯示英美音標、發音、繁中釋義。
//
// 為什麼走 DOM 的 caretRangeFromPoint,而不是 CodeMirror 的 hoverTooltip:
// CM6 extension 只在編輯模式(source / live preview)生效,閱讀模式滑過去
// 不會有反應——而讀筆記多半是在閱讀模式。走 DOM 一套實作兩種模式都能用,
// 代價是要自己處理定位與生命週期。

import { formsFor, meaningfulLines } from "./lemma";
import { t } from "./i18n";
import type { SectionId } from "./sections";
import type { Lookup, InflectionKind } from "./types";

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
	onAsk?: (lookup: Lookup, sentence: string) => Promise<string>;
	/** 點「例句與用法」;回傳例句、搭配、辨析 */
	onUsage?: (lookup: Lookup) => Promise<string>;
	/** 點「字詞詳解」;回傳字根字首與詞族 */
	onDetail?: (lookup: Lookup) => Promise<string>;
	/** 這個字是不是已經在生詞本裡了 */
	isSaved: (word: string) => boolean;
	/** 點了同義詞/詞形等可點的字:跳去查那個字(浮窗內導覽) */
	onNavigate?: (word: string) => void;
	/** 按返回:回上一個查過的字 */
	onBack?: () => void;
	/** 還有沒有上一頁可回 */
	canGoBack?: () => boolean;
}

export class WordTooltip {
	private el: HTMLDivElement;
	private visible = false;

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
		if (!this.visible) return;
		this.visible = false;
		this.el.style.display = "none";
		this.el.empty();
	}

	show(lookup: Lookup, hit: HoverHit, view: ViewConfig): void {
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
				this.claudeButton(
					t("tooltip_ask_claude"),
					() => this.cb.onAsk!(lookup, hit.sentence),
					hit
				);
				return;
			}

			case "usage": {
				if (!this.cb.onUsage) return;
				this.claudeButton(t("tooltip_usage"), () => this.cb.onUsage!(lookup), hit);
				return;
			}

			case "detail": {
				if (!this.cb.onDetail) return;
				this.claudeButton(t("tooltip_detail"), () => this.cb.onDetail!(lookup), hit);
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
	private claudeButton(
		label: string,
		run: () => Promise<string>,
		hit: HoverHit
	): void {
		const btn = this.el.createEl("button", {
			cls: "wordfolio-ask",
			text: `✦ ${label}`,
		});
		btn.onclick = async () => {
			btn.disabled = true;
			btn.textContent = t("tooltip_asking");
			try {
				const answer = await run();
				btn.remove();
				this.el.createDiv({ cls: "wordfolio-claude", text: answer });
				// 內容變高了,重新定位免得掉出視窗外。
				this.position(hit.rect);
			} catch (e) {
				btn.disabled = false;
				btn.textContent = `✦ ${label}`;
				this.el.createDiv({
					cls: "wordfolio-error",
					text: e instanceof Error ? e.message : String(e),
				});
				this.position(hit.rect);
			}
		};
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
		const box = this.el.getBoundingClientRect();
		const vw = window.innerWidth;
		const vh = window.innerHeight;

		let left = anchor.left;
		if (left + box.width > vw - gap) left = vw - box.width - gap;
		if (left < gap) left = gap;

		let top = anchor.bottom + gap;
		if (top + box.height > vh - gap) {
			const above = anchor.top - box.height - gap;
			if (above > gap) top = above;
			else top = Math.max(gap, vh - box.height - gap);
		}

		this.el.style.left = `${Math.round(left)}px`;
		this.el.style.top = `${Math.round(top)}px`;
	}
}
