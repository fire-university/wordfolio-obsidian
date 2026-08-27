// 生詞筆記 → Anki 欄位。
//
// **這個檔刻意不 import obsidian。** 純字串處理拆出來才能在 node 裡測——
// 這是這個專案第三次踩到同一個坑了(前兩次是 GenOpts 和劍橋解析器):
// 只要一個檔輾轉 import 到 `obsidian`,依賴它的整批 node 測試就載不起來。
// 規則:**純函式不要跟需要 Obsidian API 的程式碼放同一個檔。**

/**
 * 把一篇生詞筆記轉成要送進 Anki 的欄位。
 *
 * 純函式(吃檔案內容字串),所以可以直接測——生詞筆記的格式是自己定的,
 * 格式一改這裡就會壞,值得有測試守著。
 */
export function toAnkiFields(markdown: string, obsidianUri: string): {
	word: string;
	phonetic: string;
	meaning: string;
	examples: string;
	source: string;
} | null {
	const fm = markdown.match(/^---\n([\s\S]*?)\n---/);
	const front = fm?.[1] ?? "";
	const pick = (k: string) =>
		front.match(new RegExp(`^${k}:\\s*"?(.*?)"?\\s*$`, "m"))?.[1]?.trim() ?? "";

	const word = pick("word");
	if (!word) return null;

	const body = markdown.slice(fm ? fm[0].length : 0);
	// 標題(就是那個字)之後、第一個 ## 之前 = 釋義。
	const meaning = body
		.replace(/^\s*#\s+.*$/m, "")
		.split(/^##\s/m)[0]
		.trim();

	// 例句:「我遇到它的地方」底下的引用行。
	const examples = (body.split("## 我遇到它的地方")[1] ?? "")
		.split(/^##\s/m)[0]
		.split("\n")
		.filter((l) => l.trim().startsWith(">"))
		.map((l) => l.replace(/^>\s*/, "").trim())
		.filter(Boolean)
		.join("<br>");

	const uk = pick("音標_英");
	const us = pick("音標_美");
	const phonetic = [uk && `UK ${uk}`, us && `US ${us}`].filter(Boolean).join("　");

	return {
		word,
		phonetic,
		meaning: meaning.replace(/\n+/g, "<br>"),
		examples,
		source: `<a href="${obsidianUri}">Obsidian</a>`,
	};
}
