// Hover 浮窗:游標停在英文字上 → 顯示英美音標、發音、繁中釋義。
//
// 為什麼走 DOM 的 caretRangeFromPoint,而不是 CodeMirror 的 hoverTooltip:
// CM6 extension 只在編輯模式(source / live preview)生效,閱讀模式滑過去
// 不會有反應——而讀筆記多半是在閱讀模式。走 DOM 一套實作兩種模式都能用,
// 代價是要自己處理定位與生命週期。

import { formsFor } from "./lemma";
import { t } from "./i18n";
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

// 這些容器裡不查:程式碼、行內程式碼、frontmatter、以及浮窗自己。
const SKIP_SELECTOR =
	".wordfolio-tooltip, code, pre, .cm-inline-code, .cm-hmd-frontmatter, .metadata-container, .cm-formatting";

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
	if (!el || el.closest(SKIP_SELECTOR)) return null;

	// Electron 是 Chromium,用 WebKit 系的 caretRangeFromPoint。
	const caret = (document as Document & {
		caretRangeFromPoint?: (x: number, y: number) => Range | null;
	}).caretRangeFromPoint?.(x, y);
	if (!caret) return null;

	const node = caret.startContainer;
	if (node.nodeType !== Node.TEXT_NODE) return null;

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

export interface TooltipCallbacks {
	/** 點喇叭 */
	onSpeak: (word: string, accent: "uk" | "us") => void;
	/** 點「加入生詞本」 */
	onAdd: (lookup: Lookup, sentence: string) => void;
	/** 點「在這句話裡是什麼意思」;回傳解釋文字 */
	onAsk?: (lookup: Lookup, sentence: string) => Promise<string>;
	/** 這個字是不是已經在生詞本裡了 */
	isSaved: (word: string) => boolean;
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

	hide(): void {
		if (!this.visible) return;
		this.visible = false;
		this.el.style.display = "none";
		this.el.empty();
	}

	show(lookup: Lookup, hit: HoverHit, showEnglish: boolean): void {
		this.el.empty();
		this.render(lookup, hit, showEnglish);
		this.el.style.display = "";
		this.visible = true;
		this.position(hit.rect);
	}

	// ---------------------------------------------------------- 內容

	private render(lookup: Lookup, hit: HoverHit, showEnglish: boolean): void {
		const { entry } = lookup;

		// 標題列:單字 + 加入生詞本
		const head = this.el.createDiv({ cls: "wordfolio-head" });
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

		// 音標列
		const phonetics = this.el.createDiv({ cls: "wordfolio-phonetics" });
		this.accent(phonetics, "uk", entry.uk ?? entry.ph, entry.w);
		this.accent(phonetics, "us", entry.us, entry.w);

		// 釋義
		const tr = this.el.createDiv({ cls: "wordfolio-translation" });
		for (const line of entry.tr.split("\\n")) {
			if (line.trim()) tr.createDiv({ text: line.trim() });
		}

		// 變化形自己另有釋義時附在後面(例:running 當名詞的「賽跑」)
		if (lookup.surfaceEntry) {
			const extra = this.el.createDiv({ cls: "wordfolio-surface-sense" });
			extra.createSpan({ cls: "wordfolio-surface-word", text: hit.word });
			for (const line of lookup.surfaceEntry.tr.split("\\n")) {
				if (line.trim()) extra.createDiv({ text: line.trim() });
			}
		}

		if (showEnglish && entry.def) {
			const def = this.el.createDiv({ cls: "wordfolio-definition" });
			for (const line of entry.def.split("\\n")) {
				if (line.trim()) def.createDiv({ text: line.trim() });
			}
		}

		// 詞頻／分級／考試標籤
		const meta: string[] = [];
		if (entry.collins) meta.push("★".repeat(entry.collins));
		if (entry.oxford) meta.push("Oxford 3000");
		if (entry.bnc) meta.push(`BNC ${entry.bnc.toLocaleString()}`);
		if (entry.frq) meta.push(`COCA ${entry.frq.toLocaleString()}`);
		if (entry.tag?.length) meta.push(entry.tag.join(" · "));
		if (meta.length) {
			this.el.createDiv({ cls: "wordfolio-meta", text: meta.join("　·　") });
		}

		// 變化形
		const forms = formsFor(entry.exch);
		if (forms.length) {
			this.el.createDiv({
				cls: "wordfolio-forms",
				text: `${t("tooltip_forms")}: ${forms.join(" / ")}`,
			});
		}

		// 問 Claude:一定要按才會呼叫,hover 自動觸發會滑一排字燒一排 token。
		if (this.cb.onAsk) {
			const ask = this.el.createEl("button", {
				cls: "wordfolio-ask",
				text: `✦ ${t("tooltip_ask_claude")}`,
			});
			ask.onclick = async () => {
				ask.disabled = true;
				ask.textContent = t("tooltip_asking");
				try {
					const answer = await this.cb.onAsk!(lookup, hit.sentence);
					ask.remove();
					this.el.createDiv({ cls: "wordfolio-claude", text: answer });
					this.position(hit.rect);
				} catch (e) {
					ask.disabled = false;
					ask.textContent = `✦ ${t("tooltip_ask_claude")}`;
					this.el.createDiv({
						cls: "wordfolio-error",
						text: e instanceof Error ? e.message : String(e),
					});
				}
			};
		}
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
