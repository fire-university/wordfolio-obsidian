// 生詞筆記解析與例句挖空。純邏輯,不碰 Obsidian。
// 樣本就是道哥 vault 裡 overrate.md 的真實內容。
//
//   npx tsx test/note-parse-check.ts

import { parseNote, clozeSentence, BLANK } from "../src/note-parse";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const NOTE = `---
type: 生詞
word: overrate
音標_英: "/ˌəʊvəɹˈeɪt/"
音標_美: "/ˌoʊvɝˈɹeɪt/"
詞頻: BNC 41677 / COCA 29696
來源: "Saladict — BUILDING JUDGMENT: Almanack of Naval Ravikant"
來源連結: "https://www.navalmanack.com/almanack-of-naval-ravikant/judgment"
date: 2026-08-28
fsrs_state: new
tags: [英文, 生詞]
---
# overrate

vt. 評價過高, 高估, 估價過高

## 英英釋義

- v make too high an estimate of

**變化**：overrated / overrating / overrates

## 我遇到它的地方

> Hard work is really overrated.
`;

console.log("拆解生詞筆記");
const n = parseNote(NOTE);
check("單字", n.word === "overrate", n.word);
check("英式音標(脫掉引號)", n.ukPhonetic === "/ˌəʊvəɹˈeɪt/", String(n.ukPhonetic));
check("美式音標", n.usPhonetic === "/ˌoʊvɝˈɹeɪt/", String(n.usPhonetic));
check("主釋義", n.meaning.join("|") === "vt. 評價過高, 高估, 估價過高", n.meaning.join("|"));
check("大標題不算釋義", !n.meaning.some((m) => m === "overrate"));
check("英英釋義去掉列點符號", n.english.join("|") === "v make too high an estimate of", n.english.join("|"));
check("變化形", n.forms.join(",") === "overrated,overrating,overrates", n.forms.join(","));
check("變化那行不會混進釋義", !n.meaning.some((m) => m.includes("變化")));
check("出處例句", n.sentences.join("|") === "Hard work is really overrated.", n.sentences.join("|"));
// 來源用 yamlString 寫的,值裡有冒號,解析時要把引號與跳脫脫乾淨。
check("來源(帶冒號、脫引號)", n.source === "Saladict — BUILDING JUDGMENT: Almanack of Naval Ravikant", String(n.source));

console.log("\n其他區塊原樣保留");
const withExtra = NOTE.replace("## 我遇到它的地方", "## 字詞詳解\n\n字首 over- 表示過度。\n\n## 我遇到它的地方");
const e = parseNote(withExtra);
check("撿到字詞詳解", e.extras.length === 1 && e.extras[0].heading === "字詞詳解", JSON.stringify(e.extras));
check("內容保留", e.extras[0].body.includes("字首 over-"));
check("例句仍然解析得到", e.sentences.length === 1);

console.log("\n殘缺的筆記不能爆");
check("空字串", parseNote("").word === "");
check("只有 frontmatter", parseNote("---\nword: x\n---\n").word === "x");
check("沒有 frontmatter", parseNote("# hi\n\n釋義").meaning.join("") === "釋義");
const bare = parseNote("---\nword: sync\n---\n\n# sync\n\n[計] 同步的\n");
check("沒有音標時是 undefined", bare.ukPhonetic === undefined && bare.usPhonetic === undefined);
check("沒有例句時是空陣列", bare.sentences.length === 0);

console.log("\n例句挖空");
const s = "Hard work is really overrated.";
// 這是最重要的一條:句子裡是變化形 overrated,筆記的字是原形 overrate。
check("挖得到變化形", clozeSentence(s, "overrate", n.forms) === `Hard work is really ${BLANK}.`,
	String(clozeSentence(s, "overrate", n.forms)));
check("不會在變化形中間挖出半個字", !String(clozeSentence(s, "overrate", n.forms)).includes("d."));
check("沒給變化形時挖不到就回 null", clozeSentence(s, "overrate", []) === null,
	String(clozeSentence(s, "overrate", [])));
check("原形直接命中", clozeSentence("Do not overrate it.", "overrate", n.forms) === `Do not ${BLANK} it.`,
	String(clozeSentence("Do not overrate it.", "overrate", n.forms)));

console.log("\n挖空的邊界");
check("句首大寫也挖得到", clozeSentence("Overrated ideas spread.", "overrate", n.forms) === `${BLANK} ideas spread.`,
	String(clozeSentence("Overrated ideas spread.", "overrate", n.forms)));
// 不能用 \b:撇號與連字號會被當成邊界,挖出半個字。
check("撇號的字不會被切一半", clozeSentence("I don't know.", "do", []) === null,
	String(clozeSentence("I don't know.", "do", [])));
check("連字號的字不會被切一半", clozeSentence("A well-known fact.", "well", []) === null,
	String(clozeSentence("A well-known fact.", "well", [])));
check("整個 don't 挖得到", clozeSentence("I don't know.", "don't", []) === `I ${BLANK} know.`,
	String(clozeSentence("I don't know.", "don't", [])));
check("字中間的巧合不會被挖", clozeSentence("The rate is high.", "at", []) === null,
	String(clozeSentence("The rate is high.", "at", [])));
check("只挖第一個出現的", clozeSentence("Rate the rate.", "rate", []) === `${BLANK} the rate.`,
	String(clozeSentence("Rate the rate.", "rate", [])));
check("挖不到回 null,呼叫端才知道要退回完整句", clozeSentence("Nothing here.", "absent", []) === null);
check("空句子回 null", clozeSentence("", "x", []) === null);
check("空格長度固定,不洩漏字有多長", BLANK === "______");

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
