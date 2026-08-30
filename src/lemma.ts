// 詞形還原:把使用者滑到的字(可能是變化形)對回詞庫裡的原形。
// 純模組,不碰檔案系統也不依賴 Obsidian,node 測試可直接跑。

import type { InflectionKind } from "./types";

/** inflect.json 的內容:變化形 → [原形, 變化類型] */
export type InflectionMap = Record<string, [string, InflectionKind]>;

export interface Resolved {
	lemma: string;
	kind: InflectionKind;
}

/**
 * 查變化形對應的原形。查不到就回 null(代表這個字本身就是原形,或詞庫沒收)。
 * 表裡不會有自我指向的項目(build-dict.mjs 已排除),所以不需要防迴圈。
 */
export function resolveLemma(word: string, map: InflectionMap): Resolved | null {
	const key = word.toLowerCase();
	const hit = map[key];
	if (!hit) return null;
	return { lemma: hit[0], kind: hit[1] };
}

const KIND_BY_CODE: Record<string, InflectionKind> = {
	p: "past",
	d: "done",
	i: "ing",
	"3": "third",
	s: "plural",
	r: "comparative",
	t: "superlative",
	"0": "lemma",
};

/** ECDICT exchange 欄的顯示用變化形清單，如 "unnerved / unnerving / unnerves"。 */
export function formsFor(exchange: string | undefined): string[] {
	if (!exchange) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const seg of exchange.split("/")) {
		const colon = seg.indexOf(":");
		if (colon < 0) continue;
		const code = seg.slice(0, colon);
		// 0/1 是「這個字是誰的變化形」的反向資訊，不是要展示的變化形。
		if (code === "0" || code === "1") continue;
		if (!KIND_BY_CODE[code]) continue;
		for (const f of seg.slice(colon + 1).split(",")) {
			const form = f.trim();
			if (form && !seen.has(form)) {
				seen.add(form);
				out.push(form);
			}
		}
	}
	return out;
}

/**
 * 把 ECDICT 釋義切成「有意義的行」,丟掉冷門領域標籤那種噪音。
 *
 * ECDICT 常夾帶 [計]（電腦）、[醫]、[法]、[網絡] 開頭的行,對常用字幾乎都是垃圾——
 * be 底下的「[計] 後端, 匯流排允許」就是「bus enable」被硬翻的產物,毫無用處。
 * 規則:只要有「不是領域標籤開頭」的正常行,就把領域標籤行全丟掉;若整個詞條只剩
 * 領域標籤行(冷僻技術詞),那才保留——至少有東西可看。
 */
export function meaningfulLines(tr: string): string[] {
	const lines = tr
		.split("\\n")
		.map((s) => s.trim())
		.filter(Boolean);
	const isDomainTag = (l: string) => /^\[[^\]]+\]/.test(l);
	const plain = lines.filter((l) => !isDomainTag(l));
	return plain.length ? plain : lines;
}

/**
 * ECDICT 的英英釋義用 WordNet 的詞性代號開頭,而那組代號是給機器看的:
 * `s most frequent or common` 的 `s` 是「形容詞衛星義項」,對讀的人沒有意義,
 * 看起來只像句子被切掉了第一個字(道哥 2026-08-30 回報「解釋很薄弱」,
 * predominant 那篇兩行都是 `s ` 開頭)。
 *
 * 對照(實測 a/b/c/p 四個 shard 共 24,000 多行):n/v/a/s/r,有的帶點有的不帶。
 * a 與 s 都是形容詞(satellite 只是 WordNet 內部的關係分類),對使用者一律寫 adj.。
 */
const POS_LABEL: Record<string, string> = {
	n: "n.",
	v: "v.",
	a: "adj.",
	s: "adj.",
	r: "adv.",
};

/** 英英釋義切行,並把 WordNet 的詞性代號換成看得懂的縮寫。 */
export function defLines(def: string | undefined): string[] {
	return (def ?? "")
		.split("\\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.map((l) => {
			const m = /^([nvasr])\.?\s+(.+)$/.exec(l);
			return m ? `${POS_LABEL[m[1]]} ${m[2]}` : l;
		});
}

/**
 * Markdown 的標記字元。
 *
 * 這些**不算單字的一部分,但也不該擋住查詢**:編輯模式下看到的是原始文字,
 * 游標點在 `**candidate**` 上時,`offset` 很可能落在星號上。不跳過的話,
 * 所有粗體、斜體、highlight、行內程式碼裡的字全都查不到——而那是筆記裡
 * 最常被強調、也最值得查的那些字。
 *
 * 2026-08-29 道哥實機回報:「只要是一個單字加了符號,例如 ** 這樣一個符號在的話,
 * 它就阻止了查詢單字這個功能。」
 */
const MD_SYNTAX = /[*_~`=[\]()]/;

/** 從一段文字裡抓出 offset 位置所在的英文單字(含連字號與撇號)。 */
export function wordAt(text: string, offset: number): { word: string; from: number; to: number } | null {
	const isWordChar = (c: string) => /[A-Za-z'’-]/.test(c);
	if (offset < 0 || offset > text.length) return null;

	let from = offset;
	let to = offset;

	/**
	 * 從 i 往兩個方向跨越 Markdown 標記,找出最近的字母。
	 *
	 * **先往回再往前**:游標點在 `**word**` 後面時退回 word(最常見的情況),
	 * 點在前面那組星號上時才往前找。兩個方向都只跨越標記字元,一碰到空白或
	 * 其他標點就放棄——不然會咬到隔壁那一整個字。
	 */
	const throughSyntax = (i: number): number => {
		let back = i;
		while (back >= 0 && MD_SYNTAX.test(text[back])) back--;
		if (back >= 0 && isWordChar(text[back])) return back;
		let fwd = i;
		while (fwd < text.length && MD_SYNTAX.test(text[fwd])) fwd++;
		return fwd < text.length && isWordChar(text[fwd]) ? fwd : -1;
	};

	// 游標就落在標記上(`**candidate**` 的星號)。這要在退一格之前處理——
	// 退一格會把游標推到標記串外面的空白上,那時就找不回來了。
	if (from < text.length && MD_SYNTAX.test(text[from])) {
		from = throughSyntax(from);
	} else if (from > 0 && (to >= text.length || !isWordChar(text[to]))) {
		// 游標剛好落在字尾時，offset 指向的是下一個字元，要往回退一格才咬得到。
		from--;
		if (from >= 0 && from < text.length && MD_SYNTAX.test(text[from])) {
			from = throughSyntax(from);
		}
	}

	if (from < 0 || from >= text.length || !isWordChar(text[from])) return null;

	to = from;
	while (from > 0 && isWordChar(text[from - 1])) from--;
	while (to < text.length && isWordChar(text[to])) to++;

	// 修掉咬到頭尾的標點:連字號結尾的破折號、所有格的撇號。
	let word = text.slice(from, to);
	const lead = word.length - word.replace(/^[-'’]+/, "").length;
	from += lead;
	word = word.slice(lead).replace(/[-'’]+$/, "");
	to = from + word.length;

	if (!/[A-Za-z]/.test(word)) return null;
	return { word, from, to };
}
