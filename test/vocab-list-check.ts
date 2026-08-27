// 生詞清單的篩選/搜尋/排序測試。純邏輯,不碰 Obsidian。
//
//   npx tsx test/vocab-list-check.ts

import {
	meaningOf,
	applyFilter,
	applySearch,
	applySort,
	hardest,
	LEECH_LAPSES,
	type VocabRow,
} from "../src/vocab-list";
import type { VocabCard } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const TODAY = "2026-08-27";

console.log("從生詞筆記抽釋義");
// 這就是 vocab.ts 的 renderNote 產出的格式。
const note = `---
type: 生詞
word: unnerve
音標_英: "ʌnˈnɜːv"
---

# unnerve

vt. 使失去勇氣, 使氣餒, 使膽怯

**變化**：unnerved / unnerving

## 英英釋義

- cause to lose one's nerve

## 我遇到它的地方

> It was an unnerving experience.
`;
check("取到第一行釋義", meaningOf(note) === "vt. 使失去勇氣, 使氣餒, 使膽怯", meaningOf(note));
check("不會取到標題", !meaningOf(note).includes("unnerve"));
check("不會取到 ## 區塊裡的內容", !meaningOf(note).includes("cause to lose"));

const bold = `---
word: sync
---

# sync

**同步**
`;
check("粗體標記會去掉", meaningOf(bold) === "同步", meaningOf(bold));
check("沒有釋義時回空字串", meaningOf("---\nword: x\n---\n\n# x\n") === "");
check("沒有 frontmatter 也不會爆", meaningOf("# x\n\n釋義") === "釋義");

console.log("\n篩選");
const card = (over: Partial<VocabCard>): VocabCard => ({
	word: "x", due: TODAY, stability: 0, difficulty: 0, reps: 0, lapses: 0, state: "new", ...over,
});
const rows: VocabRow[] = [
	{ word: "alpha", meaning: "第一個", path: "v/alpha.md", card: card({ word: "alpha", state: "new", due: TODAY }) },
	{ word: "bravo", meaning: "第二個", path: "v/bravo.md", card: card({ word: "bravo", state: "review", due: "2026-09-30", reps: 9, lapses: 4 }) },
	{ word: "charlie", meaning: "第三個", path: "v/charlie.md", card: card({ word: "charlie", state: "learning", due: "2026-08-20", reps: 3, lapses: 1 }) },
	{ word: "delta", meaning: "第四個", path: "v/delta.md", card: card({ word: "delta", state: "relearning", due: "2026-09-01", reps: 6, lapses: 2 }) },
];

const words = (rs: VocabRow[]) => rs.map((r) => r.word).join(",");
check("全部", applyFilter(rows, "all", TODAY).length === 4);
check("今天到期含逾期", words(applyFilter(rows, "due", TODAY)) === "alpha,charlie", words(applyFilter(rows, "due", TODAY)));
check("新字", words(applyFilter(rows, "new", TODAY)) === "alpha");
check("學習中含重新學習", words(applyFilter(rows, "learning", TODAY)) === "charlie,delta");
check(`記不牢(忘記 >= ${LEECH_LAPSES})`, words(applyFilter(rows, "leech", TODAY)) === "bravo,delta", words(applyFilter(rows, "leech", TODAY)));

console.log("\n搜尋");
check("比對單字", words(applySearch(rows, "brav")) === "bravo");
check("比對釋義", words(applySearch(rows, "第三")) === "charlie");
check("大小寫不分", words(applySearch(rows, "ALPHA")) === "alpha");
check("空字串回全部", applySearch(rows, "  ").length === 4);
check("查不到回空陣列", applySearch(rows, "zzz").length === 0);

console.log("\n排序");
check("單字 asc", words(applySort(rows, "word", "asc")) === "alpha,bravo,charlie,delta");
check("單字 desc", words(applySort(rows, "word", "desc")) === "delta,charlie,bravo,alpha");
check("忘記次數 desc", words(applySort(rows, "lapses", "desc")) === "bravo,delta,charlie,alpha", words(applySort(rows, "lapses", "desc")));
check("複習次數 asc", words(applySort(rows, "reps", "asc")) === "alpha,charlie,delta,bravo");
check("到期日 asc(早的在前)", words(applySort(rows, "due", "asc")) === "charlie,alpha,delta,bravo", words(applySort(rows, "due", "asc")));
// 狀態照學習進度排,不是字母序:new < learning < relearning < review
check("狀態照進度排", words(applySort(rows, "state", "asc")) === "alpha,charlie,delta,bravo", words(applySort(rows, "state", "asc")));
check("不會改到原陣列", words(rows) === "alpha,bravo,charlie,delta");

const tied: VocabRow[] = [
	{ word: "zulu", meaning: "", path: "v/zulu.md", card: card({ word: "zulu", reps: 1 }) },
	{ word: "mike", meaning: "", path: "v/mike.md", card: card({ word: "mike", reps: 1 }) },
];
check("同分時用單字當第二鍵,順序才穩定", words(applySort(tied, "reps", "desc")) === "mike,zulu", words(applySort(tied, "reps", "desc")));

console.log("\n最記不牢的字");
check("忘記多的在前", words(hardest(rows, 5)) === "bravo,delta,charlie", words(hardest(rows, 5)));
check("沒忘記過的不列進來", !words(hardest(rows, 5)).includes("alpha"));
check("取前 n 個", hardest(rows, 2).length === 2);
check("全新的生詞本回空陣列", hardest([rows[0]], 5).length === 0);

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
