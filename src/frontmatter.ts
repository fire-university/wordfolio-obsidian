// 寫進 frontmatter 的值要自己跳脫。
//
// **這個檔刻意不 import obsidian**(專案規則,見 anki-fields.ts 檔頭)。
//
// 2026-08-28 踩到的雷:匯入時把來源標題直接寫成 `來源: {標題}`,而 Language Reactor
// 有一支影片叫 `Justice: What's The Right Thing To Do?`——那個**冒號加空格**在 YAML
// 裡就是「鍵值分隔」的意思,整段 frontmatter 因此解析失敗。
//
// 而失敗的方式最惡劣:**不會報錯,那篇筆記直接從外掛眼中消失**。
// Obsidian 的 getFileCache().frontmatter 變成 undefined,allCards() 看不到它,
// 清單上就是少了 30 篇,沒有任何訊息說少在哪裡。245 個檔案顯示 215 個。
//
// 規則:**凡是使用者資料或外部來源的字串,一律走這裡包成帶引號的字串**,
// 不要因為「這個欄位看起來不會有冒號」就直接內插。

/**
 * 包成 YAML 的雙引號字串。
 *
 * 反斜線要先跳脫,不然後面跳脫引號時產生的反斜線會再被跳脫一次。
 * 換行折成空格——frontmatter 的單行值裝不下換行,硬寫進去一樣會壞掉。
 */
export function yamlString(value: string): string {
	const flat = value.replace(/[\r\n]+/g, " ").trim();
	return `"${flat.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
