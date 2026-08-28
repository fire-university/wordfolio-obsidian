// 生詞清單的純邏輯:從筆記抽出釋義、篩選、搜尋、排序。
// 零 Obsidian 依賴,node 測得到(專案規則,見 anki-fields.ts 檔頭)。UI 在 vocab-view.ts。

import type { VocabCard } from "./types";

/** 清單裡的一列。 */
export interface VocabRow {
	word: string;
	/** 一行釋義,清單裡顯示用 */
	meaning: string;
	card: VocabCard;
	/** vault 內的筆記路徑,點下去要開它 */
	path: string;
}

export type ListFilter = "all" | "due" | "leech" | "new" | "learning" | "suspended";
export type SortKey = "word" | "meaning" | "state" | "due" | "reps" | "lapses";
export type SortDir = "asc" | "desc";

/**
 * 忘記幾次以上算「記不牢」。
 *
 * Anki 預設是 8,但那是給每天複習好幾年的牌組用的。這個生詞本大部分的字
 * 複習次數還是個位數,門檻設 8 等於這個篩選永遠是空的。設 2:忘記過兩次
 * 就值得被挑出來看一眼。
 */
export const LEECH_LAPSES = 2;

/**
 * 從生詞筆記抽出一行釋義。
 *
 * 筆記的格式是自己定的(vocab.ts 的 renderNote):frontmatter → `# 單字` →
 * 釋義數行 → 第一個 `##` 區塊。所以取「標題之後、第一個 ## 之前」的第一行。
 * 格式一改這裡就會壞,值得有測試守著——跟 toAnkiFields 是同一個理由。
 */
export function meaningOf(markdown: string): string {
	const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
	const head = body.split(/^##\s/m)[0];
	for (const raw of head.split("\n")) {
		const line = raw
			.replace(/^#\s+.*$/, "") // 標題就是那個字,不是釋義
			.replace(/\*\*/g, "")
			.trim();
		if (line) return line;
	}
	return "";
}

export function applyFilter(rows: VocabRow[], filter: ListFilter, today: string): VocabRow[] {
	switch (filter) {
		case "due":
			return rows.filter(
				(r) => !r.card.suspended && (!r.card.due || r.card.due <= today)
			);
		case "suspended":
			return rows.filter((r) => r.card.suspended);
		case "leech":
			return rows.filter((r) => r.card.lapses >= LEECH_LAPSES);
		case "new":
			return rows.filter((r) => r.card.state === "new");
		case "learning":
			return rows.filter(
				(r) => r.card.state === "learning" || r.card.state === "relearning"
			);
		default:
			// 「全部」真的是全部,封存的也列出來——這個視圖存在的理由就是
			// 「看得到全部的字」,把封存的藏起來等於又製造一批看不到的字。
			return rows;
	}
}

/** 單字與釋義都比對,大小寫不分。 */
export function applySearch(rows: VocabRow[], query: string): VocabRow[] {
	const q = query.trim().toLowerCase();
	if (!q) return rows;
	return rows.filter(
		(r) => r.word.toLowerCase().includes(q) || r.meaning.toLowerCase().includes(q)
	);
}

// 狀態欄按學習進度排,不是按字母——new < learning < relearning < review。
const STATE_RANK: Record<VocabCard["state"], number> = {
	new: 0,
	learning: 1,
	relearning: 2,
	review: 3,
};

export function applySort(rows: VocabRow[], key: SortKey, dir: SortDir): VocabRow[] {
	const sign = dir === "asc" ? 1 : -1;
	const value = (r: VocabRow): string | number => {
		switch (key) {
			case "word":
				return r.word.toLowerCase();
			case "meaning":
				return r.meaning;
			case "state":
				return STATE_RANK[r.card.state] ?? 0;
			case "due":
				// 沒有到期日的排在最前面(等同今天到期)。
				return r.card.due || "0000-00-00";
			case "reps":
				return r.card.reps;
			case "lapses":
				return r.card.lapses;
		}
	};
	// 值相同時一律用單字當第二鍵,不然每次重畫順序都會跳。
	return [...rows].sort((a, b) => {
		const va = value(a);
		const vb = value(b);
		if (va < vb) return -sign;
		if (va > vb) return sign;
		return a.word.toLowerCase() < b.word.toLowerCase() ? -1 : 1;
	});
}

/** 最記不牢的幾個字:忘記次數多的優先,同樣多就看複習次數。 */
export function hardest(rows: VocabRow[], n: number): VocabRow[] {
	return rows
		.filter((r) => r.card.lapses > 0)
		.sort((a, b) => b.card.lapses - a.card.lapses || b.card.reps - a.card.reps)
		.slice(0, n);
}
