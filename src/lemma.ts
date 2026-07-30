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

/** 從一段文字裡抓出 offset 位置所在的英文單字(含連字號與撇號)。 */
export function wordAt(text: string, offset: number): { word: string; from: number; to: number } | null {
	const isWordChar = (c: string) => /[A-Za-z'’-]/.test(c);
	if (offset < 0 || offset > text.length) return null;

	let from = offset;
	let to = offset;
	// 游標剛好落在字尾時，offset 指向的是下一個字元，要往回退一格才咬得到。
	if (from > 0 && (to >= text.length || !isWordChar(text[to]))) from--;
	if (from < 0 || !isWordChar(text[from])) return null;

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
