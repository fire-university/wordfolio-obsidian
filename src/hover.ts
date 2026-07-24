// Hover 的生命週期:什麼時候開、什麼時候關、什麼時候不要理。
//
// 手感重點(hover 是高頻操作,這幾條決定會不會覺得煩):
//   - 滑到「同一個字」不重跳,不然滑鼠一抖浮窗就重畫
//   - 滑到別的字要重新計時,不能沿用上一個字的倒數
//   - 游標移到浮窗上不能關,不然點不到喇叭
//   - **離開單字之後要有寬限期**,不然使用者滑不進浮窗(見下方)
//   - 有選取文字時不跳,那時使用者在做別的事
//   - 捲動、打字、切換視窗一律關掉
//
// 「滑不進浮窗」是這裡最容易做錯的一件事:浮窗跟單字之間隔著幾 px 的間隙,
// 游標經過那段空白時既不在單字上、也不在浮窗上。若那一刻就關掉,使用者
// 必須瞬間跨過去才進得了浮窗——實際上幾乎不可能。兩道防線一起解:
//   1. 安全區:浮窗周圍一圈 margin 內都算「還在浮窗上」
//   2. 寬限期:離開之後延遲一段時間才真的關,期間滑回來就取消
//
// 另外提供「點外面才關」模式:要點喇叭、加生詞本、等 Claude 回覆時,
// 不該有個計時器在跟使用者賽跑。

import { hitTest, HoverHit, WordTooltip, type ViewConfig } from "./tooltip";
import type { Lookup } from "./types";

/** 浮窗怎麼關:移開就關(有寬限期) / 點浮窗外面才關 */
export type DismissMode = "delay" | "click_outside";

/** 安全區的寬度。浮窗定位時跟單字之間留 6px,這裡給足餘裕。 */
const SAFE_MARGIN = 24;

export interface HoverOptions {
	/** 停在單字上多久才跳浮窗 */
	delay: () => number;
	/** 離開之後多久才關(僅 delay 模式) */
	closeDelay: () => number;
	dismissMode: () => DismissMode;
	enabled: () => boolean;
	lookup: (word: string) => Promise<Lookup | null>;
	tooltip: WordTooltip;
	view: () => ViewConfig;
}

export class HoverController {
	private openTimer: number | null = null;
	private closeTimer: number | null = null;
	private currentWord = "";
	/** 每次觸發帶一個序號,非同步查詢回來時比對,晚到的結果直接丟掉。 */
	private generation = 0;

	constructor(private opts: HoverOptions) {}

	// ------------------------------------------------------------ 事件

	private onMouseMove = (e: MouseEvent) => {
		if (!this.opts.enabled()) return;

		const sticky = this.opts.dismissMode() === "click_outside";

		// 游標在浮窗上(或安全區內):維持現狀,讓使用者滑得進來、點得到按鈕。
		if (
			this.opts.tooltip.contains(e.target) ||
			this.opts.tooltip.isNear(e.clientX, e.clientY, SAFE_MARGIN)
		) {
			this.clearOpenTimer();
			this.clearCloseTimer();
			return;
		}

		// 使用者正在選字,那是別的意圖。
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) {
			if (!sticky) this.close();
			return;
		}

		const hit = hitTest(e.clientX, e.clientY);
		if (!hit) {
			// 已經離開浮窗與安全區了。sticky 模式維持開著,等使用者點外面。
			if (!sticky) this.scheduleClose();
			return;
		}

		// 還在同一個字上,不重跳。
		if (hit.word === this.currentWord && this.opts.tooltip.isOpen) {
			this.clearOpenTimer();
			this.clearCloseTimer();
			return;
		}

		// 滑到新的字:取消待關,重新倒數。
		this.clearCloseTimer();
		this.clearOpenTimer();
		this.openTimer = window.setTimeout(() => this.trigger(hit), this.opts.delay());
	};

	/** sticky 模式:點浮窗外面才關。 */
	private onPointerDown = (e: MouseEvent) => {
		if (this.opts.dismissMode() !== "click_outside") return;
		if (!this.opts.tooltip.isOpen) return;
		if (this.opts.tooltip.contains(e.target)) return;
		this.close();
	};

	private onScroll = () => this.close();

	private onKeyDown = (e: KeyboardEvent) => {
		// sticky 模式只認 Esc——不然在浮窗裡等 Claude 回覆時隨手按個鍵就關了。
		if (this.opts.dismissMode() === "click_outside") {
			if (e.key === "Escape") this.close();
			return;
		}
		this.close();
	};

	private onBlur = () => this.close();

	attach(): void {
		document.addEventListener("mousemove", this.onMouseMove, { passive: true });
		document.addEventListener("mousedown", this.onPointerDown, { capture: true });
		document.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
		document.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("blur", this.onBlur);
	}

	detach(): void {
		this.clearOpenTimer();
		this.clearCloseTimer();
		document.removeEventListener("mousemove", this.onMouseMove);
		document.removeEventListener("mousedown", this.onPointerDown, { capture: true });
		document.removeEventListener("scroll", this.onScroll, { capture: true });
		document.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("blur", this.onBlur);
	}

	// ------------------------------------------------------------ 開關

	/** 快捷鍵/右鍵走這條:略過延遲,直接對指定的字開浮窗。 */
	async showFor(hit: HoverHit): Promise<boolean> {
		const gen = ++this.generation;
		const result = await this.opts.lookup(hit.word);
		if (gen !== this.generation) return false;
		if (!result) return false;
		this.clearCloseTimer();
		this.currentWord = hit.word;
		this.opts.tooltip.show(result, hit, this.opts.view());
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
		this.opts.tooltip.show(result, hit, this.opts.view());
	}

	/** 排一個延後關閉。期間滑回浮窗或安全區就會被取消。 */
	private scheduleClose(): void {
		this.clearOpenTimer();
		if (!this.opts.tooltip.isOpen) return;
		if (this.closeTimer !== null) return; // 已經在倒數了,不要一直重排
		this.closeTimer = window.setTimeout(() => this.close(), this.opts.closeDelay());
	}

	private clearOpenTimer(): void {
		if (this.openTimer !== null) {
			window.clearTimeout(this.openTimer);
			this.openTimer = null;
		}
	}

	private clearCloseTimer(): void {
		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}
	}

	private close(): void {
		this.clearOpenTimer();
		this.clearCloseTimer();
		this.generation++;
		this.currentWord = "";
		this.opts.tooltip.hide();
	}
}
