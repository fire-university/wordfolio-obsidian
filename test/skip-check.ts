// 「哪些地方不該跳浮窗」的測試。
//
//   npx tsx test/skip-check.ts
//
// 用假的 DOM 節點(只需要 tagName / classList / parentElement 三個屬性),
// 不必拉 jsdom。這裡要驗的是祖先鏈的判斷邏輯,不是瀏覽器行為。

import { inSkippedContext } from "../src/tooltip";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

/** 由外而內建一條祖先鏈,回傳最內層的節點。 */
function chain(...specs: string[]): Element {
	let parent: Element | null = null;
	let node: Element = null as unknown as Element;
	for (const spec of specs) {
		const [tag, ...classes] = spec.split(".");
		node = {
			tagName: (tag || "span").toUpperCase(),
			classList: classes,
			parentElement: parent,
		} as unknown as Element;
		parent = node;
	}
	return node;
}

console.log("該跳過的（程式碼）");
check(
	"閱讀模式 fenced block：pre > code > span",
	inSkippedContext(chain("div", "pre", "code", "span.token.keyword"))
);
check(
	"閱讀模式行內程式碼：p > code",
	inSkippedContext(chain("div", "p", "code"))
);
check(
	"即時預覽 fenced block：div.cm-line.HyperMD-codeblock > span",
	inSkippedContext(chain("div.cm-content", "div.cm-line.HyperMD-codeblock", "span.cm-keyword")),
	"這條是 2026-07-24 回報的漏網之魚"
);
check(
	"即時預覽行內程式碼：div.cm-line > span.cm-inline-code",
	inSkippedContext(chain("div.cm-line", "span.cm-inline-code"))
);
check(
	"Obsidian 改版換名也擋得住：div.cm-line.some-new-code-block-name",
	inSkippedContext(chain("div.cm-line.some-new-code-block-name", "span")),
	"class 只要含 code 就算"
);
check("<kbd> 也跳過", inSkippedContext(chain("p", "kbd")));

console.log("\n該跳過的（其他）");
check("frontmatter：span.cm-hmd-frontmatter", inSkippedContext(chain("div.cm-line", "span.cm-hmd-frontmatter")));
check("屬性面板：div.metadata-container", inSkippedContext(chain("div.metadata-container", "div", "span")));
check("浮窗自己", inSkippedContext(chain("div.wordfolio-tooltip", "div.wordfolio-translation", "div")));
check("輸入框", inSkippedContext(chain("div", "input")));

console.log("\n不該跳過的（正常內文）");
check(
	"閱讀模式段落：div.markdown-preview-view > p",
	!inSkippedContext(chain("div.markdown-preview-view", "p")),
	"這裡要能查"
);
check(
	"即時預覽一般行：div.cm-line > span",
	!inSkippedContext(chain("div.cm-content", "div.cm-line", "span")),
	"cm-line 本身不是程式碼"
);
check("粗體字裡", !inSkippedContext(chain("p", "strong")));
check("引用區塊裡", !inSkippedContext(chain("blockquote", "p")));
check("標題裡", !inSkippedContext(chain("h2")));
check("callout 裡", !inSkippedContext(chain("div.callout", "div.callout-content", "p")));
check("清單裡", !inSkippedContext(chain("ul", "li", "p")));
check("null 不當成要跳過", !inSkippedContext(null));

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
