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

	// ---------------------------------------------------------------- 波形
	// 這裡才測得到 drawWave:它要真的 document。壞掉的樣子是 SVG 屬性變成 NaN,
	// 瀏覽器不會報錯,只是那根長方形靜靜地不畫出來——畫面上是「波形缺了幾格」。
	console.log("\n發音波形畫成 SVG");
	{
		const { drawWave } = await import("../src/tooltip");
		const { envelope } = await import("../src/waveform");

		const samples = new Float32Array(4800);
		for (let i = 0; i < samples.length; i++) {
			const loud = i > 1600 && i < 3200 ? 0.9 : 0.08;
			samples[i] = loud * Math.sin((2 * Math.PI * i) / 32);
		}
		const env = envelope(samples, 56);

		const host = document.createElement("div");
		drawWave(host, env);
		const svg = host.querySelector("svg");
		const rects = [...host.querySelectorAll("rect")];
		check("產生一個 svg", !!svg);
		check("每一格都有一根長方形", rects.length === 56, String(rects.length));

		const nums = rects.flatMap((r) =>
			["x", "y", "width", "height"].map((a) => Number(r.getAttribute(a)))
		);
		check("所有座標都是數字,沒有 NaN", nums.every((n) => Number.isFinite(n)));
		check("高度都是正的", rects.every((r) => Number(r.getAttribute("height")) > 0));
		check(
			"沒有一根超出畫布",
			rects.every((r) => Number(r.getAttribute("y")) + Number(r.getAttribute("height")) <= 18.01)
		);

		const h = (i: number) => Number(rects[i].getAttribute("height"));
		check("中段比兩端高(重音看得出來)", h(28) > h(4) && h(28) > h(52),
			`${h(4).toFixed(1)} / ${h(28).toFixed(1)} / ${h(52).toFixed(1)}`);

		// 靜音那幾格要留一根細線,不然波形頭尾會憑空斷掉,看起來像畫壞了。
		drawWave(host, [0, 0, 0.5, 0, 0]);
		check("靜音的格子仍然畫一根細線",
			[...host.querySelectorAll("rect")].every((r) => Number(r.getAttribute("height")) >= 1));

		// 重畫要換掉舊的,不是疊上去。
		drawWave(host, new Array(10).fill(0.5));
		check("重畫不會疊加", host.querySelectorAll("rect").length === 10,
			String(host.querySelectorAll("rect").length));

		drawWave(host, []);
		check("空的包絡線不動畫面", host.querySelectorAll("rect").length === 10);
	}

	// 播放時的由暗到亮。壞掉的樣子有兩種,都不會報錯:停下來的波形停在一半的
	// 亮度(看起來像卡住),或者每一幀重設 56 根長方形而讓整條抖動。
	console.log("\n波形跟著播放亮起來");
	{
		const { drawWave } = await import("../src/tooltip");
		const host = document.createElement("div");
		const h = drawWave(host, new Array(10).fill(0.5));
		const bars = [...host.querySelectorAll("rect")];
		const lit = () => bars.filter((r) => r.classList.contains("is-lit")).length;

		check("一開始整條都是暗的", lit() === 0, String(lit()));

		h.progress(0);
		check("進度 0 只亮第一格", lit() === 1, String(lit()));

		h.progress(0.5);
		check("進度一半亮一半", lit() === 5, String(lit()));
		check("亮的是前面那幾格,不是隨便幾格",
			bars.slice(0, 5).every((r) => r.classList.contains("is-lit")) &&
				bars.slice(5).every((r) => !r.classList.contains("is-lit")));

		h.progress(1);
		check("進度 1 整條都亮", lit() === 10, String(lit()));

		// 超出範圍不可以爆掉,也不可以少亮一格——rAF 的時間戳很容易剛好超過 1。
		h.progress(1.4);
		check("進度超過 1 也是整條亮,不會出錯", lit() === 10, String(lit()));

		h.progress(null);
		check("結束後整條熄掉,不會停在一半", lit() === 0, String(lit()));

		// 重播:再亮一次要能從頭來。上一版曾經因為 lit 沒還原而第二次不會動。
		h.progress(0.3);
		check("可以再播一次", lit() === 3, String(lit()));

		// 倒退(播到一半換字、或使用者重按)要把多亮的熄掉。
		h.progress(0.1);
		check("進度倒退時多亮的會熄掉", lit() === 1, String(lit()));

		h.progress(null);
		check("再次還原", lit() === 0, String(lit()));
	}

	console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
