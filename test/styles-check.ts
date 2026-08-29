// styles.css 的完整性檢查。
//
//   npx tsx test/styles-check.ts
//
// **為什麼需要這個測試。**
//
// 2026-08-29:改按鈕樣式時用 `s[:i] + new + s[j:]` 這種索引切片改 CSS,索引算錯
// 把整份樣式表從 1,431 行砍到 114 行——**92% 的樣式沒了**。當下我確實檢查了
// 大括號平衡,看到「11 / 11」就放行,完全沒注意到那代表整份檔案只剩十幾條規則。
//
// 更糟的是後面每一關都沒攔住它:`tsc` 不看 CSS、16 份測試沒有一份碰 CSS、
// `npm run build` 只是把檔案複製過去。最後是道哥在手機上看到波形變形才發現——
// 而他回報的是「波形變了,上一版比較好」,聽起來像設計改動,不像檔案被砍掉。
//
// 教訓:**平衡不等於完整**。一個空檔案的大括號也是平衡的。所以這裡同時檢查
// 規模與必要選擇器,任何一項掉了都會紅。

import fs from "fs";
import path from "path";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const css = fs.readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");
const lines = css.split("\n").length;
const open = (css.match(/{/g) ?? []).length;
const close = (css.match(/}/g) ?? []).length;

console.log("結構");
check("大括號平衡", open === close, `${open} / ${close}`);
// 下限刻意訂在「現況打七折」:允許正常的刪減與重構,但攔得住「整段不見」。
// 被砍那次是 1,431 → 114,任何合理的下限都攔得到。
check("規模沒有暴跌(> 900 行)", lines > 900, `${lines} 行`);
check("規則數合理(> 150 條)", open > 150, `${open} 條`);
check("沒有未閉合的註解", !/\/\*(?:(?!\*\/)[\s\S])*$/.test(css));

console.log("\n每個功能區塊至少要有樣式");
// 一區一條。這些是使用者看得到的東西,對應的樣式掉了畫面就會爛,
// 而**畫面爛掉的樣子很容易被當成「設計改動」而不是「檔案壞了」**。
const required: [string, string][] = [
	["浮窗本體", ".wordfolio-tooltip"],
	["音標與發音", ".wordfolio-phonetics"],
	["發音波形", ".wordfolio-wave"],
	["選字圖示", ".wordfolio-select-icon"],
	["標題列按鈕", ".wordfolio-add"],
	["關閉鍵", ".wordfolio-close"],
	["釋義", ".wordfolio-translation"],
	["複習視窗", ".wordfolio-review-modal"],
	["評分鍵", ".wf-grade"],
	["拼寫格", ".wf-slot"],
	["生詞清單", ".wordfolio-vocab-view"],
	["練習數據", ".wordfolio-word-stats"],
	["手機專用", ".is-mobile"],
];
for (const [name, sel] of required) {
	check(`${name}(${sel})`, css.includes(sel));
}

console.log("\n手機的觸控尺寸");
// 44px 是 iOS 的最小可觸控尺寸。改版時很容易連這條一起刪掉,
// 而桌面上完全看不出差別。
check("選字圖示有放大到 44px", /\.is-mobile\s+\.wordfolio-select-icon[\s\S]{0,200}44px/.test(css));

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
