// 各家線上詞典的解析器。
//
// 這個檔刻意**不 import obsidian**——解析是純函式,拆出來才能用 jsdom 在 node 裡
// 真的測。網路那一半在 sources.ts。(這個拆法是踩過兩次的坑:只要輾轉 import 到
// `obsidian`,整批 node 測試就載不起來。)
//
// 各家的共通形狀:一組義項,每個義項有定義、可能有中譯、可能有例句。
// 字源那種散文式的內容用 `text`。

/** 一個義項。 */
export interface SourceSense {
	/** 義項標籤(劍橋的 SUCCESSFUL / IN FACT 那種) */
	guideword?: string;
	/** 詞性 */
	pos?: string;
	/** 分級標示(CEFR 等) */
	level?: string;
	/** 定義(英文) */
	def: string;
	/** 中譯(只有英漢詞典有) */
	zh?: string;
	examples: { en: string; zh?: string }[];
}

export interface SourceEntry {
	word: string;
	ukIpa?: string;
	usIpa?: string;
	ukAudio?: string;
	usAudio?: string;
	/** 散文式內容(字源)。有這個就不畫 senses。 */
	text?: string;
	senses: SourceSense[];
}

function T(el: Element | null | undefined): string {
	return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

const wrapIpa = (s: string) => (!s ? "" : s.startsWith("/") ? s : `/${s}/`);

// ------------------------------------------------------------ 朗文 LDOCE

/**
 * 朗文當代(LDOCE)。學習者字典的標竿:定義只用最基本的詞彙寫成,
 * 「劍橋看不懂」的時候看這個通常就懂了。純英文。
 */
export function parseLongman(doc: Document, word: string): SourceEntry | null {
	const entry: SourceEntry = { word, senses: [] };
	entry.ukIpa = wrapIpa(T(doc.querySelector(".PronCodes")).replace(/[/]/g, "")) || undefined;

	for (const s of Array.from(doc.querySelectorAll(".Sense"))) {
		const def = T(s.querySelector(".DEF"));
		if (!def) continue;
		const examples = Array.from(s.querySelectorAll(".EXAMPLE"))
			.slice(0, 2)
			.map((e) => ({ en: T(e) }))
			.filter((e) => e.en);
		entry.senses.push({
			pos: T(s.closest(".Entry")?.querySelector(".POS")) || undefined,
			def,
			examples,
		});
	}
	return entry.senses.length ? entry : null;
}

// ------------------------------------------------------------ 牛津 OALD

/**
 * 牛津學習者字典(OALD)。跟朗文同類,額外有 CEFR 等級(A1–C2)標示。純英文。
 */
export function parseOxford(doc: Document, word: string): SourceEntry | null {
	const entry: SourceEntry = { word, senses: [] };
	entry.ukIpa = wrapIpa(T(doc.querySelector(".phons_br .phon"))) || undefined;
	entry.usIpa = wrapIpa(T(doc.querySelector(".phons_n_am .phon"))) || undefined;
	const pos = T(doc.querySelector(".pos")) || undefined;

	for (const s of Array.from(doc.querySelectorAll(".sense"))) {
		const def = T(s.querySelector(".def"));
		if (!def) continue;
		// CEFR 等級掛在一個 class 像 "symbols ox3000 a1" 的元素上。
		const lvlEl = s.querySelector('[class*="ox3000"], [class*="symbols"]');
		const lvl = lvlEl?.getAttribute("class")?.match(/\b([abc][12])\b/i)?.[1];
		entry.senses.push({
			pos,
			level: lvl ? lvl.toUpperCase() : undefined,
			def,
			examples: Array.from(s.querySelectorAll(".examples li"))
				.slice(0, 2)
				.map((e) => ({ en: T(e) }))
				.filter((e) => e.en),
		});
	}
	return entry.senses.length ? entry : null;
}

// -------------------------------------------------------- Wiktionary 字源

/**
 * Wiktionary 的字源(Etymology)。**真實的字源鏈**,不是 AI 猜的:
 * 「effective ← 法語 effectif ← 拉丁 effectīvus ← efficiō」。
 *
 * 兩個要點:
 * 1. **一定要限定在英文區段。** 同一個拼法在 Wiktionary 上常常同時是英文、法文、
 *    拉丁文的詞條,不限定會抓到別的語言的字源。
 * 2. 一個字可能有多個 Etymology 段(Etymology 1 / 2),各取第一段就夠。
 */
export function parseWiktionary(doc: Document, word: string): SourceEntry | null {
	let inEnglish = false;
	let inEtymology = false;
	const parts: string[] = [];

	for (const el of Array.from(doc.querySelectorAll("h2, h3, h4, p"))) {
		const tag = el.tagName.toUpperCase();

		if (tag === "H2") {
			inEnglish = (el.id || T(el)).toLowerCase().startsWith("english");
			inEtymology = false;
			continue;
		}
		if (!inEnglish) continue;

		if (tag === "H3" || tag === "H4") {
			inEtymology = (el.id || T(el)).toLowerCase().startsWith("etymology");
			continue;
		}
		if (tag === "P" && inEtymology) {
			// 去掉維基的參考標記 [1]。
			const t = T(el).replace(/\[\d+\]/g, "").trim();
			if (t) parts.push(t);
			if (parts.length >= 2) break;
		}
	}

	const text = parts.join("\n");
	return text ? { word, senses: [], text } : null;
}
