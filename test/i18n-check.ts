// 兩份語言字典的對照檢查。純模組,不碰 Obsidian。
//
// 為什麼值得一個測試:字串是一個一個加上去的,漏掉另一邊不會編譯失敗、
// 也不會噴錯——t() 找不到就默默 fallback 到英文,介面上只是「有一句沒翻到」,
// 而那通常是使用者先看到,不是我先看到。
//
//   npx tsx test/i18n-check.ts

import { STRINGS, t, setLang, resolveLang } from "../src/i18n";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const en = Object.keys(STRINGS.en);
const zh = Object.keys(STRINGS["zh-TW"]);

console.log("兩份字典的鍵要一樣");
const missingZh = en.filter((k) => !zh.includes(k));
const missingEn = zh.filter((k) => !en.includes(k));
check(`繁中沒漏鍵(共 ${en.length} 個)`, missingZh.length === 0, missingZh.join(", "));
check("英文沒漏鍵", missingEn.length === 0, missingEn.join(", "));

console.log("\n代入的參數名兩邊要對得上");
// 「{n}」在英文寫成「{count}」這種錯,畫面上會直接顯示大括號。
const placeholders = (v: string) => [...v.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const mismatched: string[] = [];
for (const k of en) {
	if (!zh.includes(k)) continue;
	const a = placeholders(STRINGS.en[k]).join(",");
	const b = placeholders(STRINGS["zh-TW"][k]).join(",");
	if (a !== b) mismatched.push(`${k}: en{${a}} vs zh{${b}}`);
}
check("參數名一致", mismatched.length === 0, mismatched.join(" | "));

console.log("\n沒有空字串的翻譯");
const blank = en.filter((k) => !STRINGS.en[k].trim() || !(STRINGS["zh-TW"][k] ?? "x").trim());
check("兩邊都有內容", blank.length === 0, blank.join(", "));

console.log("\nt() 的行為");
setLang("zh-TW");
check("取得繁中", t("list_title") === "生詞本", t("list_title"));
check("參數代入", t("list_review_n", { n: 12 }).includes("12"), t("list_review_n", { n: 12 }));
setLang("en");
check("取得英文", t("list_title") === "Vocabulary", t("list_title"));
check("不存在的鍵原樣回傳", t("no_such_key_here") === "no_such_key_here");
check("auto 跟著語系碼走", resolveLang("auto", "zh-TW") === "zh-TW" && resolveLang("auto", "en-US") === "en");

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
