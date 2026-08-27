// 四家線上詞典的來源定義:網址怎麼組、用哪個解析器。
//
// 各自的取捨都寫在下面。共通的一句:爬 HTML 的來源(劍橋/朗文/牛津)在對方改版面
// 時會解析失敗,那時區塊會安靜消失,離線內容還在——降級是安全的。

import { parseCambridge } from "./cambridge-parse";
import { parseLongman, parseOxford, parseWiktionary } from "./sources-parse";
import type { SourceDef } from "./sources";

/** 劍橋英漢(繁體):唯一有繁中的線上來源,例句也附中譯。 */
export const CAMBRIDGE: SourceDef = {
	id: "cambridge",
	url: (w) =>
		`https://dictionary.cambridge.org/dictionary/english-chinese-traditional/${encodeURIComponent(
			w.replace(/\s+/g, "-")
		)}`,
	parse: parseCambridge,
};

/** 朗文當代:定義只用最基本的詞彙寫,劍橋看不懂時看這個。純英文。 */
export const LONGMAN: SourceDef = {
	id: "longman",
	url: (w) => `https://www.ldoceonline.com/dictionary/${encodeURIComponent(w.replace(/\s+/g, "-"))}`,
	parse: parseLongman,
};

/** 牛津學習者:跟朗文同類,額外有 CEFR 等級。純英文。 */
export const OXFORD: SourceDef = {
	id: "oxford",
	url: (w) =>
		`https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(
			w.replace(/\s+/g, "-")
		)}`,
	parse: parseOxford,
};

/**
 * Wiktionary 字源。**走官方 API**,所以不會因為對方改版面而壞——
 * 這是它跟上面三個最大的差別。回的是包著 HTML 的 JSON。
 */
export const WIKTIONARY: SourceDef = {
	id: "wiktionary",
	url: (w) =>
		`https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(
			w
		)}&prop=text&format=json&formatversion=2`,
	parse: parseWiktionary,
	html: (raw) => {
		try {
			return JSON.parse(raw)?.parse?.text ?? "";
		} catch {
			return "";
		}
	},
};
