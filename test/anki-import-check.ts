// Anki → 生詞本的欄位轉換測試。純邏輯,不碰 Obsidian。
// 樣本欄位照著道哥 Anki 裡真實的筆記抄下來(2026-08-27 用 AnkiConnect 撈的)。
//
//   npx tsx test/anki-import-check.ts

import {
	stripHtml,
	isSingleWord,
	fromAnkiNote,
	mergeImported,
	LANGUAGE_REACTOR,
	SALADICT,
	type ImportedWord,
} from "../src/anki-import";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

console.log("HTML 清理");
check("<br> 變空格", stripHtml("a<br>b") === "a b", stripHtml("a<br>b"));
check("標籤拿掉", stripHtml('<div class="trans">冰川</div>') === "冰川");
check("HTML 實體還原", stripHtml("And that&#39;s what carved") === "And that's what carved");
check("&amp; 還原", stripHtml("R&amp;D") === "R&D", stripHtml("R&amp;D"));
check("Anki 音檔標記去掉", stripHtml("[sound:36E92A.mp3]") === "");
check("連續空白收成一個", stripHtml("a   \n  b") === "a b");
check("空字串不會爆", stripHtml("") === "");

console.log("\n哪些算單字");
check("一般單字", isSingleWord("glacier"));
check("撇號", isSingleWord("don't"));
check("連字號", isSingleWord("well-known"));
check("片語不算", !isSingleWord("risk tolerance"));
check("帶句點的不算", !isSingleWord("wears off."));
check("單一字母不算(a、I 不值得存)", !isSingleWord("a"));
check("空字串不算", !isSingleWord(""));
check("中文不算", !isSingleWord("冰川"));

console.log("\nLanguage Reactor — Word");
const lr = {
	Cloze: "Dan: Okay, so {{c1::appearance}} I look mostly like my mom.",
	Word: "appearance",
	Lemma: "appearance",
	"Part of Speech": "Noun",
	"Word Definition": "外觀, 外貌, 外表",
	Subtitle: "Dan: Okay, so appearance I look mostly like my mom, I think.",
	Translation: "丹：好吧，所以我覺得我的外表很像 我媽。",
	"Item Title": "1.5 HOUR English Conversation Lesson",
	"Audio Clip": "[sound:161C188921344847FD280E92C1DE5E44.mp3]",
};
const a = fromAnkiNote(LANGUAGE_REACTOR, lr)!;
check("有轉出來", !!a);
check("單字", a.word === "appearance");
check("用的是繁中詞義,不是整句翻譯", a.definition === "外觀, 外貌, 外表", a.definition);
check("原句取 Subtitle", a.sentence?.startsWith("Dan: Okay"), a.sentence);
check("來源帶上影片標題", a.source === "Language Reactor — 1.5 HOUR English Conversation Lesson", a.source);

const inflected = fromAnkiNote(LANGUAGE_REACTOR, { ...lr, Word: "appearances", Lemma: "appearance" })!;
check("優先用 Lemma(已還原的原形)", inflected.word === "appearance", inflected.word);
const noLemma = fromAnkiNote(LANGUAGE_REACTOR, { ...lr, Lemma: "", Word: "Anxious" })!;
check("沒有 Lemma 就退回 Word", noLemma.word === "anxious", noLemma.word);
check("一律轉小寫", noLemma.word === noLemma.word.toLowerCase());
const noDef = fromAnkiNote(LANGUAGE_REACTOR, { ...lr, "Word Definition": "" })!;
check("沒有詞義時留 undefined 給離線詞庫補", noDef.definition === undefined);

console.log("\nSaladict Word");
const sal = {
	Date: "1760497476538",
	Text: "carved",
	Translation:
		'<div class="trans"><span class="trans_title">google</span><div class="trans_content">這就是大部分山谷的形成原因。</div></div>',
	Context: "And that&#39;s what carved out most of these valleys.",
	ContextCloze: "And that's what {{c1::carved}} out most of these valleys.",
	Title: "Learn English the EASY way - YouTube",
	Url: "https://www.youtube.com/watch?v=bDoE4JI0DBg&t=176s",
};
const b = fromAnkiNote(SALADICT, sal)!;
check("單字", b.word === "carved");
// 這是這次匯入最關鍵的一條:Saladict 的 Translation 是整句機翻,不是這個字的意思。
// 拿它當釋義會讓 carved 的釋義變成「這就是大部分山谷的形成原因」。
check("整句機翻不能當釋義", b.definition === undefined, String(b.definition));
check("原句解過 HTML 實體", b.sentence === "And that's what carved out most of these valleys.", b.sentence);
check("留下原始連結", b.url === "https://www.youtube.com/watch?v=bDoE4JI0DBg&t=176s");
check("來源帶上頁面標題", b.source?.startsWith("Saladict — "), b.source);

check("片語擋掉", fromAnkiNote(SALADICT, { ...sal, Text: "risk tolerance" }) === null);
check("整句擋掉", fromAnkiNote(SALADICT, { ...sal, Text: "wears off." }) === null);

console.log("\n不認得的筆記類型");
check("Wordwise 這次不匯,回 null", fromAnkiNote("Wordwise", { Word: "spreadsheet" }) === null);
check("Basic 回 null", fromAnkiNote("Basic", { Front: "x", Back: "y" }) === null);
check("欄位全缺不會爆", fromAnkiNote(LANGUAGE_REACTOR, {}) === null);

console.log("\n兩個來源都有的字要合併");
const merged = mergeImported([
	{ word: "carved", sentence: "from saladict", source: "Saladict" },
	{ word: "carved", definition: "雕刻", sentence: "from LR", source: "Language Reactor" },
	{ word: "glacier", definition: "冰川", source: "Language Reactor" },
]);
check("去重", merged.length === 2, String(merged.length));
const carved = merged.find((m) => m.word === "carved")!;
check("補上另一邊才有的釋義", carved.definition === "雕刻", String(carved.definition));
check("原句留先遇到的那句", carved.sentence === "from saladict", carved.sentence);
check("大小寫不同視為同一個字", mergeImported([
	{ word: "Glacier" }, { word: "glacier" },
] as ImportedWord[]).length === 1);
check("空陣列不會爆", mergeImported([]).length === 0);

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
