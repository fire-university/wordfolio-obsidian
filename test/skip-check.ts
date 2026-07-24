// 「哪些地方不該跳浮窗」的測試。
//
//   npx tsx test/skip-check.ts
//
// 用假的 DOM 節點(只需要 tagName / classList / parentElement 三個屬性),
// 不必拉 jsdom。這裡要驗的是祖先鏈的判斷邏輯,不是瀏覽器行為。

import { inSkippedContext, inNoteContent } from "../src/tooltip";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

interface FakeEl {
	tagName: string;
	classList: string[];
	parentElement: FakeEl | null;
	closest(selector: string): FakeEl | null;
}

/** 由外而內建一條祖先鏈,回傳最內層的節點。closest 只支援逗號分隔的 class 選擇器。 */
function chain(...specs: string[]): Element {
	let parent: FakeEl | null = null;
	let node: FakeEl = null as unknown as FakeEl;
	for (const spec of specs) {
		const [tag, ...classes] = spec.split(".");
		node = {
			tagName: (tag || "span").toUpperCase(),
			classList: classes,
			parentElement: parent,
			closest(selector: string) {
				const wanted = selector.split(",").map((s) => s.trim().replace(/^\./, ""));
				for (let n: FakeEl | null = this; n; n = n.parentElement) {
					if (n.classList.some((c) => wanted.includes(c))) return n;
				}
				return null;
			},
		};
		parent = node;
	}
	return node as unknown as Element;
}

/** 包在編輯模式的內容容器裡(實務上絕大多數情況)。 */
const inEditor = (...specs: string[]) => chain("div.cm-editor", "div.cm-content", ...specs);
/** 包在閱讀模式的內容容器裡。 */
const inPreview = (...specs: string[]) => chain("div.markdown-preview-view", ...specs);

// 第一道關卡:白名單——只有筆記內容才查。
console.log("Obsidian 自己的介面（都不該查）");
check(
	"vault 切換選單",
	!inNoteContent(chain("body", "div.menu", "div.menu-item", "div.menu-item-title")),
	"2026-07-24 回報的就是這個"
);
check("檔案總管", !inNoteContent(chain("div.nav-files-container", "div.nav-file-title")));
check("分頁標題", !inNoteContent(chain("div.workspace-tab-header", "div.workspace-tab-header-inner-title")));
check("狀態列", !inNoteContent(chain("div.status-bar", "div.status-bar-item")));
check("設定畫面", !inNoteContent(chain("div.modal", "div.setting-item", "div.setting-item-name")));
check("搜尋結果", !inNoteContent(chain("div.search-result-container", "div.tree-item-inner")));
check("左側 ribbon", !inNoteContent(chain("div.side-dock-ribbon", "div.side-dock-ribbon-action")));
check("浮窗自己（掛在 body 底下）", !inNoteContent(chain("body", "div.wordfolio-tooltip", "div")));

console.log("\n筆記內容（該查）");
check("編輯模式：.cm-content 底下", inNoteContent(inEditor("div.cm-line", "span")));
check("閱讀模式：.markdown-preview-view 底下", inNoteContent(inPreview("p")));
check("hover 預覽 / Canvas 卡片：.markdown-rendered 底下", inNoteContent(chain("div.hover-popover", "div.markdown-rendered", "p")));
check("null 不算內容", !inNoteContent(null));

// 第二道關卡:內容裡面仍要跳過的東西。
console.log("\n內容裡該跳過的（程式碼）");
check(
	"閱讀模式 fenced block：pre > code > span",
	inSkippedContext(inPreview("pre", "code", "span.token.keyword"))
);
check("閱讀模式行內程式碼：p > code", inSkippedContext(inPreview("p", "code")));
check(
	"即時預覽 fenced block：div.cm-line.HyperMD-codeblock > span",
	inSkippedContext(inEditor("div.cm-line.HyperMD-codeblock", "span.cm-keyword")),
	"這條是 2026-07-24 第一次回報的漏網之魚"
);
check(
	"即時預覽行內程式碼：div.cm-line > span.cm-inline-code",
	inSkippedContext(inEditor("div.cm-line", "span.cm-inline-code"))
);
check(
	"Obsidian 改版換名也擋得住：div.cm-line.some-new-code-block-name",
	inSkippedContext(inEditor("div.cm-line.some-new-code-block-name", "span")),
	"class 只要含 code 就算"
);
check("<kbd> 也跳過", inSkippedContext(inPreview("p", "kbd")));

console.log("\n內容裡該跳過的（其他）");
check("frontmatter", inSkippedContext(inEditor("div.cm-line", "span.cm-hmd-frontmatter")));
check("屬性面板", inSkippedContext(chain("div.metadata-container", "div", "span")));
check("輸入框", inSkippedContext(inEditor("div", "input")));

console.log("\n內容裡不該誤擋的（一般內文）");
check("閱讀模式段落", !inSkippedContext(inPreview("p")), "這裡要能查");
check(
	"即時預覽一般行",
	!inSkippedContext(inEditor("div.cm-line", "span")),
	"cm-line 本身不是程式碼"
);
check("粗體字裡", !inSkippedContext(inPreview("p", "strong")));
check("引用區塊裡", !inSkippedContext(inPreview("blockquote", "p")));
check("標題裡", !inSkippedContext(inPreview("h2")));
check("callout 裡", !inSkippedContext(inPreview("div.callout", "div.callout-content", "p")));
check("清單裡", !inSkippedContext(inPreview("ul", "li", "p")));
check("null 不當成要跳過", !inSkippedContext(null));

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
