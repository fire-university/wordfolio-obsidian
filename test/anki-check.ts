// 生詞筆記 → Anki 欄位的轉換。純字串處理,不碰網路也不碰 Anki。
//
//   npx tsx test/anki-check.ts
//
// 生詞筆記的格式是自己定的,格式一改這裡就會靜靜地少東西,值得有測試守著。

import { toAnkiFields } from "../src/anki-fields";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const NOTE = `---
type: 生詞
word: unnerve
音標_英: "/ʌnˈnɜːv/"
音標_美: "/ʌnˈnɝːv/"
詞頻: BNC 12111 / COCA 12595
date: 2026-08-27
fsrs_due: 2026-08-27
tags: [英文, 生詞]
---

# unnerve

vt. 使失去勇氣, 使膽怯, 使不能自制

## 英英釋義

- disturb the composure of

**變化**：unnerved / unnerving / unnerves

## 我遇到它的地方

> It was an unnerving, well-timed question.
> The silence unnerved him.
`;

const URI = "obsidian://open?vault=Documents&file=x.md";

console.log("欄位轉換");
{
	const f = toAnkiFields(NOTE, URI);
	check("轉得出來", !!f);
	if (f) {
		check("單字", f.word === "unnerve", f.word);
		check("英美音標都在", f.phonetic.includes("UK") && f.phonetic.includes("US"), f.phonetic);
		check("釋義有抓到", f.meaning.includes("使失去勇氣"), f.meaning.slice(0, 40));
		// 釋義只該取「標題之後、第一個 ## 之前」——不能把英英釋義、變化形全吃進來。
		check("釋義沒有吃到後面的區塊", !f.meaning.includes("英英釋義") && !f.meaning.includes("變化"));
		check("標題沒被當成釋義", !f.meaning.startsWith("# "), f.meaning.slice(0, 20));
		check("例句有兩句", f.examples.split("<br>").length === 2, f.examples.slice(0, 50));
		// 注意:不能直接檢查有沒有 ">",分隔用的 <br> 本身就含 >。要看每一句的開頭。
		check(
			"例句去掉了引用符號",
			f.examples.split("<br>").every((x) => !x.trim().startsWith(">")),
			f.examples.split("<br>")[0]
		);
		check("來源連回 Obsidian", f.source.includes("obsidian://"));
	}
}

console.log("\n邊界情況");
check("沒有 frontmatter 就回 null", toAnkiFields("# hello\n\nworld", URI) === null);
check("沒有 word 欄位就回 null", toAnkiFields("---\ntype: 生詞\n---\n\n# x", URI) === null);
{
	const noEg = toAnkiFields(NOTE.split("## 我遇到它的地方")[0], URI);
	check("沒有例句也不會壞", noEg !== null && noEg.examples === "", `例句=${noEg?.examples}`);
}

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
