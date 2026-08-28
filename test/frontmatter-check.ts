// frontmatter 值的跳脫。純邏輯,不碰 Obsidian。
//
// 這份測試是為了 2026-08-28 那個 bug 補的:來源標題含「冒號加空格」會讓整段
// frontmatter 解析失敗,而且不報錯——那篇筆記直接從外掛眼中消失。
//
//   npx tsx test/frontmatter-check.ts

import { yamlString } from "../src/frontmatter";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

/** 把 `鍵: 值` 丟進最小的 YAML 解析器看還原不還原得回來。 */
function roundtrip(value: string): string | null {
	const line = `來源: ${yamlString(value)}`;
	const m = line.match(/^來源: "((?:[^"\\]|\\.)*)"$/);
	if (!m) return null;
	return m[1].replace(/\\(["\\])/g, "$1");
}

console.log("會打壞 YAML 的字元");
// 這就是真的把 30 篇筆記弄消失的那個影片標題。
const killer = "Language Reactor — Justice: What's The Right Thing To Do? Episode 01 \"THE MORAL SIDE OF MURDER\"";
check("冒號加空格包得住", roundtrip(killer) === killer, roundtrip(killer) ?? "(解析不出來)");
check("結果真的有前後引號", yamlString(killer).startsWith('"') && yamlString(killer).endsWith('"'));
check("內部的引號有跳脫", yamlString(killer).includes('\\"'));

console.log("\n各種值都要能原樣還原");
for (const [label, v] of [
	["一般標題", "Learn English the EASY way"],
	["冒號加空格", "Justice: What's The Right Thing To Do?"],
	["雙引號", 'He said "no" twice'],
	["反斜線", "path\\to\\thing"],
	["反斜線接引號", 'a\\"b'],
	["網址", "https://www.youtube.com/watch?v=bDoE4JI0DBg&t=176s"],
	["井字號", "#1 tip: read more"],
	["中括號", "[計] 同步的"],
	["大括號", "{{c1::carved}}"],
	["全形標點", "夏普指數：風險調整後報酬"],
	["前後空白", "  trimmed  "],
	["只有一個冒號", ":"],
	["空字串", ""],
] as const) {
	const want = v.replace(/[\r\n]+/g, " ").trim();
	check(label, roundtrip(v) === want, `${JSON.stringify(yamlString(v))}`);
}

console.log("\n換行折成空格(單行值裝不下換行)");
check("換行不見了", !yamlString("a\nb").includes("\n"), yamlString("a\nb"));
check("折成空格", roundtrip("a\nb") === "a b", String(roundtrip("a\nb")));
check("CRLF 也一樣", roundtrip("a\r\nb") === "a b", String(roundtrip("a\r\nb")));

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
