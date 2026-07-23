// Hover 的生命週期:什麼時候開、什麼時候關、什麼時候不要理。
//
// 手感重點(hover 是高頻操作,這幾條決定會不會覺得煩):
//   - 滑到「同一個字」不重跳,不然滑鼠一抖浮窗就重畫
//   - 滑到別的字要重新計時,不能沿用上一個字的倒數
//   - 游標移到浮窗上不能關,不然點不到喇叭
//   - 有選取文字時不跳,那時使用者在做別的事
//   - 捲動、打字、切換視窗一律關掉

import { hitTest, HoverHit, WordTooltip } from "./tooltip";
import type { Lookup } from "./types";

export interface HoverOptions {
	delay: number;
	enabled: () => boolean;
	lookup: (word: string) => Promise<Lookup | null>;
	tooltip: WordTooltip;
	showEnglish: () => boolean;
}

export class HoverController {
	private timer: number | null = null;
	private currentWord = "";
	/** 每次觸發帶一個序號,非同步查詢回來時比對,晚到的結果直接丟掉。 */
	private generation = 0;

	private onMouseMove = (e: MouseEvent) => {
		if (!this.opts.enabled()) return;

		// 游標在浮窗上:維持現狀,讓使用者點得到喇叭跟按鈕。
		if (this.opts.tooltip.contains(e.target)) {
			this.clearTimer();
			return;
		}

		// 使用者正在選字,那是別的意圖。
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) {
			this.close();
			return;
		}

		const hit = hitTest(e.clientX, e.clientY);
		if (!hit) {
			this.close();
			return;
		}

		// 還在同一個字上,不重跳。
		if (hit.word === this.currentWord && this.opts.tooltip.isOpen) {
			this.clearTimer();
			return;
		}

		this.clearTimer();
		this.timer = window.setTimeout(() => this.trigger(hit), this.opts.delay);
	};

	private onScroll = () => this.close();
	private onKeyDown = () => this.close();
	private onBlur = () => this.close();

	constructor(private opts: HoverOptions) {}

	attach(): void {
		document.addEventListener("mousemove", this.onMouseMove, { passive: true });
		document.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
		document.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("blur", this.onBlur);
	}

	detach(): void {
		this.clearTimer();
		document.removeEventListener("mousemove", this.onMouseMove);
		document.removeEventListener("scroll", this.onScroll, { capture: true });
		document.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("blur", this.onBlur);
	}

	/** 快捷鍵/右鍵走這條:略過延遲,直接對指定的字開浮窗。 */
	async showFor(hit: HoverHit): Promise<boolean> {
		const gen = ++this.generation;
		const result = await this.opts.lookup(hit.word);
		if (gen !== this.generation) return false;
		if (!result) return false;
		this.currentWord = hit.word;
		this.opts.tooltip.show(result, hit, this.opts.showEnglish());
		return true;
	}

	private async trigger(hit: HoverHit): Promise<void> {
		const gen = ++this.generation;
		const result = await this.opts.lookup(hit.word);
		// 查詢期間游標已經移到別處(或又觸發了一次):丟掉這個結果。
		if (gen !== this.generation) return;

		if (!result) {
			// 查不到就安靜地不動作。滑過一整段英文時每個介系詞都跳「查無」會很吵。
			this.close();
			return;
		}

		this.currentWord = hit.word;
		this.opts.tooltip.show(result, hit, this.opts.showEnglish());
	}

	private clearTimer(): void {
		if (this.timer !== null) {
			window.clearTimeout(this.timer);
			this.timer = null;
		}
	}

	private close(): void {
		this.clearTimer();
		this.generation++;
		this.currentWord = "";
		this.opts.tooltip.hide();
	}
}
