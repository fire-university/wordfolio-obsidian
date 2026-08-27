// Hover 生命週期的迴歸測試——特別是那個「有時候展不開又不報錯」的競態。
//
//   npx tsx test/hover-check.ts
//
// 用 jsdom 撐出 document/window,浮窗用 stub。這裡不驗畫面,只驗
// 「什麼情況下該開、什麼情況下不該把使用者要的結果丟掉」。

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><body></body>", { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.Node = dom.window.Node;
g.MouseEvent = dom.window.MouseEvent;
g.DOMRect = dom.window.DOMRect;

// 預設:畫面上有一段「還沒收起來的選取」——這正是踩到 bug 的狀態。
let selectionCollapsed = false;
dom.window.getSelection = (() => ({
	get isCollapsed() {
		return selectionCollapsed;
	},
	toString: () => "effective",
	anchorNode: null,
	getRangeAt: () => ({ getBoundingClientRect: () => new dom.window.DOMRect() }),
})) as never;

// 動態 import:globals 要先設好,hover.ts 一載入就會用到 document。
import type { WordTooltip } from "../src/tooltip";
import type { Lookup } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const ENTRY: Lookup = { entry: { w: "effective", tr: "有效的" }, surface: "effective" };

type HoverCtor = typeof import("../src/hover").HoverController;
let HoverController: HoverCtor;

function makeController(lookupDelayMs: number) {
	let shown = 0;
	const tooltip = {
		isOpen: false,
		contains: () => false,
		isNear: () => false,
		show: () => {
			shown++;
			tooltip.isOpen = true;
		},
		hide: () => {
			tooltip.isOpen = false;
		},
	} as unknown as WordTooltip;

	const hover = new HoverController({
		triggerMode: () => "both",
		delay: () => 10,
		closeDelay: () => 50,
		enabled: () => true,
		lookup: async () =>
			new Promise<Lookup | null>((r) => setTimeout(() => r(ENTRY), lookupDelayMs)),
		lookupSelection: async () => ENTRY,
		iconMode: () => "both",
		iconDwell: () => 10,
		tooltip,
		view: () => ({ order: [], enabled: {} as never }),
	});
	hover.attach();
	return { hover, tooltip, shown: () => shown };
}

/** 模擬使用者滑鼠動一下(游標不在浮窗上、也不在任何字上)。 */
function jiggle() {
	dom.window.document.dispatchEvent(
		new dom.window.MouseEvent("mousemove", { clientX: 5, clientY: 5, bubbles: true })
	);
}

const rect = new dom.window.DOMRect(0, 0, 10, 10);

async function main() {
	({ HoverController } = await import("../src/hover"));

	console.log("查詢途中滑鼠動一下（畫面上還有選取）");
	{
		// 這就是道哥回報的情境:選完字 → 滑到圖示上展開 → 查詢是非同步的,
		// 途中滑鼠一動,舊版會因為「有選取就 close()」把 generation 推進,
		// 結果回來時被判成過期、靜靜丟掉 → 展不開又不報錯。
		const { hover, shown } = makeController(40);
		selectionCollapsed = false;
		const p = hover.showFor({ word: "effective", sentence: "it is effective.", rect });
		await new Promise((r) => setTimeout(r, 10));
		jiggle();
		jiggle();
		const ok = await p;
		check("結果沒有被丟掉", ok === true);
		check("浮窗真的畫出來了", shown() === 1, `show 被呼叫 ${shown()} 次`);
		hover.detach();
	}

	console.log("\n浮窗自己捲動不該關掉它");
	{
		const { hover, tooltip } = makeController(0);
		selectionCollapsed = true;
		await hover.showFor({ word: "effective", sentence: "x", rect });
		check("先開起來", tooltip.isOpen === true);

		// 浮窗內容太長時它是可捲的;那個捲動會冒泡到 document(捕獲階段也收得到)。
		(tooltip as unknown as { contains: () => boolean }).contains = () => true;
		dom.window.document.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
		check("在浮窗裡捲動,浮窗還在", tooltip.isOpen === true);
		hover.detach();
	}

	console.log("\n頁面捲動:sticky 的留著,hover 的收掉");
	{
		// sticky = 使用者刻意打開的(點圖示、點關聯字)。他可能正邊捲筆記邊對照。
		const { hover, tooltip } = makeController(0);
		selectionCollapsed = true;
		await hover.showFor({ word: "effective", sentence: "x", rect }); // showFor 是 sticky
		dom.window.document.dispatchEvent(new dom.window.Event("scroll", { bubbles: true }));
		check("sticky 浮窗不因頁面捲動而關", tooltip.isOpen === true);
		hover.detach();
	}

	console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
