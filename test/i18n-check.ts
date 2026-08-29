// 兩份語言字典的對照檢查。純模組,不碰 Obsidian。
//
// 為什麼值得一個測試:字串是一個一個加上去的,漏掉另一邊不會編譯失敗、
// 也不會噴錯——t() 找不到就默默 fallback 到英文,介面上只是「有一句沒翻到」,
// 而那通常是使用者先看到,不是我先看到。
//
//   npx tsx test/i18n-check.ts

import fs from "fs";
import path from "path";
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

console.log("\n同一份字典裡不可以有重複的鍵");
// 為什麼要讀原始碼而不是看 STRINGS:**物件實字裡重複的鍵會靜靜地被後面那個蓋掉**,
// 讀 STRINGS 只看得到贏的那一個,鍵集合完全正常。實際發生過:用 Python 的
// str.replace 補字串,它預設換掉**所有**出現的地方,於是英文區塊同時被塞進
// 英文與繁中兩份字典。tsc 抓得到(TS1117),但 npm test 不跑 tsc。
//
// 這種錯的下場是:繁中使用者看到英文句子,而且測試全綠。
{
	const src = fs.readFileSync(path.resolve(__dirname, "../src/i18n.ts"), "utf8");
	const dicts = [...src.matchAll(/const (EN|ZH|[A-Z_]+): Dict = \{([\s\S]*?)\n\};/g)];
	check(`找得到字典(${dicts.length} 份)`, dicts.length >= 2, String(dicts.length));
	for (const [, name, bodyText] of dicts) {
		const keys = [...bodyText.matchAll(/^\t([a-z_0-9]+):/gm)].map((m) => m[1]);
		const seen = new Set<string>();
		const dup = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
		check(`${name} 沒有重複的鍵(共 ${keys.length} 個)`, dup.length === 0, [...new Set(dup)].join(", "));
	}
}

console.log("\n繁中那份不可以殘留沒翻的英文句子");
// 同一個坑的另一面:值被覆蓋成英文時,鍵集合檢查看不出來。
// 只抓「長句子、完全沒有中日韓字元、而且跟英文版一字不差」的,
// 像 UK / US / Anki / Obsidian 這種本來就該維持原樣的短字串不會被誤判。
{
	const en = STRINGS.en;
	const zh = STRINGS["zh-TW"];
	const untranslated = Object.keys(zh).filter((k) => {
		const v = zh[k];
		return (
			v === en[k] &&
			v.length > 24 &&
			/[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(v) &&
			!/[\u3000-\u9fff\uff00-\uffef]/.test(v)
		);
	});
	check("沒有殘留英文", untranslated.length === 0, untranslated.join(", "));
}

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
