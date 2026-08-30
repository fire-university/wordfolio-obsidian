// Kobo 交接檔 → 生詞本的轉換測試。純邏輯,不碰 Obsidian。
// 樣本照道哥 Kobo 上真實查到的五個字抄下來(2026-08-30 從 KoboReader.sqlite 讀的)。
//
//   npx tsx test/kobo-import-check.ts

import {
	fromKoboFile,
	pathFromPaperFolioData,
	DEFAULT_KOBO_WORDS_PATH,
} from "../src/kobo-import";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const REAL = JSON.stringify({
	version: 1,
	updated: "2026-08-30T04:20:00.000Z",
	words: [
		{ text: "marble", book: "The Art of Spending Money", dict: "-en-zh-TW", date: "2026-08-30T04:07:57Z" },
		{ text: "horsepower", book: "The Art of Spending Money", dict: "-en-zh-TW", date: "2026-08-30T04:08:14Z" },
		{ text: "obituary", book: "The Art of Spending Money", dict: "-en-zh-TW", date: "2026-08-30T04:08:27Z" },
		{ text: "inherently", book: "The Art of Spending Money", dict: "-en-zh-TW", date: "2026-08-30T04:08:36Z" },
		{ text: "predominant", book: "The Art of Spending Money", dict: "-en-zh-TW", date: "2026-08-30T04:08:57Z" },
	],
});

console.log("真實樣本");
const real = fromKoboFile(REAL);
check("五個字全部收進來", real.items.length === 5, String(real.items.length));
check("沒有被當成非單字丟掉的", real.ignored === 0, String(real.ignored));
check("字轉小寫", real.items[0].word === "marble", real.items[0].word);
check(
	"來源標成書名",
	real.items[0].source === "Kobo — The Art of Spending Money",
	String(real.items[0].source)
);
check("釋義留空給離線詞庫補", real.items[0].definition === undefined);
check("Kobo 沒有原句,例句欄一定是空的", real.items.every((i) => !i.sentence));

console.log("\n該擋的");
const mixed = fromKoboFile(
	JSON.stringify({
		words: [
			{ text: "glacier", book: "A" },
			{ text: "冰川", book: "中文書" },
			{ text: "risk tolerance", book: "A" },
			{ text: "   ", book: "A" },
			{ text: "", book: "A" },
		],
	})
);
check("英文單字收下", mixed.items.length === 1, String(mixed.items.length));
check(
	"中文與片語擋掉並算進 ignored",
	mixed.ignored === 2,
	String(mixed.ignored)
);
check("空白不算 ignored(那不是使用者查的字)", mixed.ignored === 2);

console.log("\n壞資料");
check("壞掉的 JSON 回空的而不是丟例外", fromKoboFile("{oops").items.length === 0);
check("沒有 words 欄", fromKoboFile("{}").items.length === 0);
check("words 不是陣列", fromKoboFile('{"words":3}').items.length === 0);
check("整個檔是空的", fromKoboFile("").items.length === 0);
check(
	"缺欄位的筆也不會爆",
	fromKoboFile('{"words":[{"text":"glacier"},{},{"book":"A"}]}').items.length === 1
);

console.log("\n自動找 PaperFolio 寫在哪");
check(
	"有設 wordListPath 就用它",
	pathFromPaperFolioData(
		JSON.stringify({ settings: { wordListPath: "x/y.json", outputFolder: "70. Kobo" } })
	) === "x/y.json"
);
check(
	"沒設就用它的輸出資料夾",
	pathFromPaperFolioData(
		JSON.stringify({ settings: { outputFolder: "70. Kobo", wordListPath: "" } })
	) === "70. Kobo/.kobo-words.json"
);
check("沒有 settings 就回 null(呼叫端退回預設)", pathFromPaperFolioData("{}") === null);
check("壞掉的 JSON 回 null", pathFromPaperFolioData("nope") === null);
check("預設路徑指向 PaperFolio 的預設資料夾", DEFAULT_KOBO_WORDS_PATH === "PaperFolio/.kobo-words.json");

console.log("\n筆記格式跟著資料夾走");
{
	const { langOfType } = require("../src/note-schema") as typeof import("../src/note-schema");
	check("繁中筆記的 type", langOfType("生詞") === "zh-TW");
	check("英文筆記的 type", langOfType("vocabulary") === "en");
	check("前後空白不影響", langOfType(" 生詞 ") === "zh-TW");
	check("認不得的 type 回 null(交給呼叫端退回介面語言)", langOfType("note") === null);
}

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
