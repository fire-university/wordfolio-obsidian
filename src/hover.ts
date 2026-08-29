// 浮窗的生命週期。
//
// 一條原則貫穿全部:**消失邏輯跟著「怎麼打開的」走,不是另一個要調的設定。**
//   - hover 打開的  → 隨手一瞥,移開就(寬限期後)消失(transient)
//   - 選取＋點 Logo → 刻意動作,賴著不走,只有點框外或 Esc 才關(sticky)
//
// 鍵盤只有 Esc 會關浮窗。其他任何鍵一律不理——不然截圖的 Cmd+Shift+4
// 一按下去浮窗就沒了。
//
// hover 手感(高頻操作,這幾條決定會不會覺得煩):
//   - 滑到同一個字不重跳、滑到別的字重新計時
//   - 游標在浮窗上(或周圍安全區)不關,不然滑不進去、點不到按鈕
//   - 離開後留一段寬限期,期間滑回來就取消關閉
//
// 選取(沙拉查詞式):選字先浮現小 Logo,點了才開浮窗,不會選個字就被打擾。

import {
	hitTest,
	HoverHit,
	WordTooltip,
	SelectionIcon,
	inNoteContent,
	type ViewConfig,
	type IconMode,
} from "./tooltip";
import type { Lookup } from "./types";

/** 怎麼觸發:滑過去 / 選取 / 兩者 */
export type TriggerMode = "hover" | "select" | "both";

/** 安全區的寬度。浮窗定位時跟單字之間留 6px,這裡給足餘裕。 */
const SAFE_MARGIN = 24;

/**
 * selectionchange 去抖動:最後一次變動之後等多久才動作。
 *
 * 350ms 是「拖選取控點時手指的停頓」與「選完之後的等待感」之間的取捨。
 * 太短會在拖曳中途一直跳圖示,太長會覺得外掛慢半拍。
 */
const SELECTION_SETTLE_MS = 350;

export interface HoverOptions {
	triggerMode: () => TriggerMode;
	/**
	 * 這台裝置是不是觸控裝置(手機／平板)。
	 *
	 * **不在這裡自己判斷。** 這個檔刻意不 import obsidian(它要在 JSDOM 測試裡
	 * 跑),所以 `Platform.isMobile` 由 main.ts 注入進來。預設 false,舊呼叫端
	 * 不受影響。
	 */
	touch?: () => boolean;
	/** 停在單字上多久才跳浮窗(hover) */
	delay: () => number;
	/** 離開之後多久才關(hover 的寬限期) */
	closeDelay: () => number;
	enabled: () => boolean;
	lookup: (word: string) => Promise<Lookup | null>;
	lookupSelection: (text: string) => Promise<Lookup | null>;
	/** 選取圖示怎麼展開:點一下 / 停留 / 兩者 */
	iconMode: () => IconMode;
	/** 停留展開的秒數(ms) */
	iconDwell: () => number;
	tooltip: WordTooltip;
	view: () => ViewConfig;
}

export class HoverController {
	private openTimer: number | null = null;
	private closeTimer: number | null = null;
	private currentWord = "";
	/** 每次觸發帶一個序號,非同步查詢回來時比對,晚到的結果直接丟掉。 */
	private generation = 0;
	/** 目前這個浮窗是不是 sticky(選取/命令打開的)。hover 打開的為 false。 */
	private sticky = false;
	/** 選取後暫存,等點 Logo 才真的查。 */
	private pending: { text: string; rect: DOMRect } | null = null;
	private icon: SelectionIcon;
	/**
	 * 浮窗內導覽的歷史(點同義詞跳過去、可以返回)。
	 * 存的是「查什麼字 + 浮窗釘在哪」——返回時要回到同一個位置,
	 * 不然浮窗會在畫面上亂跳。
	 */
	private history: { lookup: Lookup; hit: HoverHit }[] = [];
	/**
	 * 正在開一個「使用者明確要求」的浮窗(點圖示、點關聯字、命令面板)。
	 *
	 * 這段期間 hover 完全不插手。否則會出現這個競態:查詢是非同步的,而使用者
	 * 選完字後那段選取還在畫面上——只要查詢途中滑鼠動一下,就會走進下面
	 * 「有選取就關掉」那條,close() 把 generation 加一,結果回來時被判定成過期、
	 * 靜靜丟掉。症狀是「有時候展不開,又不報錯」。
	 */
	private opening = false;
	/** 目前浮窗顯示的是什麼(導覽時要把它推進歷史)。 */
	private shown: { lookup: Lookup; hit: HoverHit } | null = null;

	constructor(private opts: HoverOptions) {
		this.icon = new SelectionIcon(() => this.onIconOpen(), {
			clickable: () => {
				const m = this.opts.iconMode();
				return m === "click" || m === "both";
			},
			hoverable: () => {
				const m = this.opts.iconMode();
				return m === "hover" || m === "both";
			},
			dwell: () => this.opts.iconDwell(),
		});
	}

	private isTouch(): boolean {
		return this.opts.touch?.() ?? false;
	}

	private hoverOn(): boolean {
		// 觸控裝置上沒有 hover 這回事。就算設定寫 hover,也不該讓它擋掉選字——
		// 那會變成「兩種觸發方式都不通」,使用者只看得到一個完全不動的外掛。
		if (this.isTouch()) return false;
		const m = this.opts.triggerMode();
		return m === "hover" || m === "both";
	}

	private selectOn(): boolean {
		// 同上:觸控裝置一律走選字,不看設定。設定裡那三個選項是為滑鼠設計的。
		if (this.isTouch()) return true;
		const m = this.opts.triggerMode();
		return m === "select" || m === "both";
	}

	// ------------------------------------------------------------ 事件

	private onMouseMove = (e: MouseEvent) => {
		if (!this.opts.enabled() || !this.hoverOn()) return;
		// sticky 浮窗開著時,hover 完全不插手——那是使用者刻意留住的。
		// opening 期間同理:那是使用者明確要求的查詢,不能被 hover 的邏輯打斷。
		if (this.sticky || this.opening) return;

		// 游標在浮窗上、在選取圖示上、或在浮窗的安全區內:維持現狀,
		// 讓使用者滑得進來、點得到按鈕。
		if (
			this.opts.tooltip.contains(e.target) ||
			this.icon.contains(e.target) ||
			this.opts.tooltip.isNear(e.clientX, e.clientY, SAFE_MARGIN)
		) {
			this.clearOpenTimer();
			this.clearCloseTimer();
			return;
		}

		// 使用者正在選字,那是別的意圖(交給 select 那條路)。
		// **只是不開新的,不要 close()** ——close() 會遞增 generation,把使用者
		// 正在等的那個查詢結果判成過期丟掉(見 opening 的註解)。
		const sel = window.getSelection();
		if (sel && !sel.isCollapsed) {
			this.clearOpenTimer();
			return;
		}

		const hit = hitTest(e.clientX, e.clientY);
		if (!hit) {
			this.scheduleClose();
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

	/** 收 Logo 與 sticky 浮窗的「點外面就關」。不分模式,永遠生效。 */
	private onPointerDown = (e: MouseEvent) => {
		// 點 Logo 本身交給它自己的 click,這裡別動。
		if (this.icon.contains(e.target)) return;
		// 點在 Logo 以外 → 收掉 Logo。
		this.icon.hide();
		// sticky 浮窗:點浮窗以外就關。
		if (this.sticky && this.opts.tooltip.isOpen && !this.opts.tooltip.contains(e.target)) {
			this.close();
		}
	};

	/** select:框一段文字放開滑鼠 → 浮現小 Logo(還不查)。 */
	/**
	 * 觸控裝置的選字訊號。
	 *
	 * **手機上不能用 `mouseup`。** 用手指拖選取控點時,WebView 不保證在選取結束
	 * 時送出 `mouseup`——實測 iPhone 上選了字完全沒有反應,就是卡在這裡。
	 * `selectionchange` 是唯一可靠的,代價是它在拖曳過程中會一直觸發,所以要
	 * 去抖動:等使用者的手指停下來(最後一次變動後 350ms)才動作。
	 *
	 * 桌面維持 `mouseup`:它更精準,而且不會在拖曳中途就跳出圖示打擾人。
	 */
	private onSelectionChange = () => {
		if (!this.opts.enabled() || !this.isTouch()) return;
		if (this.selectionTimer) window.clearTimeout(this.selectionTimer);
		this.selectionTimer = window.setTimeout(() => {
			this.selectionTimer = 0;
			this.pickUpSelection();
		}, SELECTION_SETTLE_MS);
	};

	/** selectionchange 的去抖動計時器。0 = 沒有排程中。 */
	private selectionTimer = 0;

	private onMouseUp = (e: MouseEvent) => {
		if (!this.opts.enabled() || !this.selectOn()) return;
		if (this.isTouch()) return; // 觸控走 selectionchange,不要兩條路一起跑
		if (this.opts.tooltip.contains(e.target) || this.icon.contains(e.target)) return;

		// mouseup 後 selection 才穩定,延一個 tick 再讀。
		window.setTimeout(() => this.pickUpSelection(), 0);
	};

	/**
	 * 讀目前的選取,合格就把書本圖示放出來。
	 *
	 * 滑鼠(mouseup)與觸控(selectionchange)兩條路共用這一份——**選取合不合格
	 * 的規則只能有一份**,分兩份寫的話兩個平台遲早會長出不一樣的行為,
	 * 而且只有其中一個平台的使用者會遇到。
	 */
	private pickUpSelection(): void {
		const sel = window.getSelection();
		if (!sel || sel.isCollapsed) {
			// 觸控上點一下就會把選取收掉,那時要順手把圖示收起來,
			// 不然它會孤零零地留在畫面上,點下去查的還是上一個字。
			if (this.isTouch()) {
				this.pending = null;
				this.icon.hide();
			}
			return;
		}

		const text = sel.toString().trim();
		// 太長的多半是整段誤選,不是要查詞;放行 1–6 個字。
		if (!text || text.length > 80) return;
		if (text.split(/\s+/).length > 6) return;
		if (!/[A-Za-z]/.test(text)) return;

		const anchor = sel.anchorNode;
		const el =
			anchor?.nodeType === Node.ELEMENT_NODE
				? (anchor as Element)
				: anchor?.parentElement ?? null;
		if (!inNoteContent(el)) return;

		this.pending = { text, rect: sel.getRangeAt(0).getBoundingClientRect() };
		this.icon.show(this.pending.rect);
	}

	// 點一下、或停留展開,都走這裡。
	private onIconOpen(): void {
		const p = this.pending;
		this.icon.hide();
		if (p) void this.triggerSelection(p.text, p.rect);
	}

	private onScroll = (e: Event) => {
		// 浮窗自己在捲(內容太長時它是可捲的)——這不是「頁面捲走了」,不能關。
		// document 上是捕獲階段監聽,所以浮窗內部的捲動也會傳到這裡。
		if (this.opts.tooltip.contains(e.target)) return;

		this.icon.hide();
		// sticky 是使用者刻意打開的(點圖示、點關聯字),頁面捲動不該把它收掉;
		// 他可能正邊捲筆記邊對照。要關就自己點外面或按 Esc。
		if (!this.sticky) this.close();
	};

	// 鍵盤:只有 Esc 關。其他鍵一律不理,不然截圖組合鍵一按浮窗就沒了。
	private onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			this.icon.hide();
			this.close();
		}
	};

	private onBlur = () => {
		this.icon.hide();
		this.close();
	};

	attach(): void {
		document.addEventListener("mousemove", this.onMouseMove, { passive: true });
		document.addEventListener("mousedown", this.onPointerDown, { capture: true });
		document.addEventListener("mouseup", this.onMouseUp);
		// 觸控裝置唯一可靠的選字訊號。桌面上也會觸發,但 onSelectionChange
		// 自己會用 isTouch() 擋掉,不會兩條路重複。
		document.addEventListener("selectionchange", this.onSelectionChange);
		document.addEventListener("scroll", this.onScroll, { passive: true, capture: true });
		document.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("blur", this.onBlur);
	}

	detach(): void {
		this.clearOpenTimer();
		if (this.selectionTimer) window.clearTimeout(this.selectionTimer);
		this.selectionTimer = 0;
		this.clearCloseTimer();
		this.icon.destroy();
		document.removeEventListener("mousemove", this.onMouseMove);
		document.removeEventListener("mousedown", this.onPointerDown, { capture: true });
		document.removeEventListener("mouseup", this.onMouseUp);
		document.removeEventListener("selectionchange", this.onSelectionChange);
		document.removeEventListener("scroll", this.onScroll, { capture: true });
		document.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("blur", this.onBlur);
	}

	// ------------------------------------------------------------ 開關

	/** 快捷鍵/命令走這條:略過延遲,直接對指定的字開浮窗,且是 sticky。 */
	async showFor(hit: HoverHit): Promise<boolean> {
		const gen = ++this.generation;
		this.opening = true;
		let result;
		try {
			result = await this.opts.lookup(hit.word);
		} finally {
			this.opening = false;
		}
		if (gen !== this.generation) return false;
		if (!result) return false;
		this.clearCloseTimer();
		this.sticky = true;
		this.currentWord = hit.word;
		this.shown = { lookup: result, hit };
		this.opts.tooltip.show(result, hit, this.opts.view());
		return true;
	}

	/** 選取觸發:sticky,點框外或 Esc 才關。 */
	private async triggerSelection(text: string, rect: DOMRect): Promise<void> {
		const gen = ++this.generation;
		this.opening = true;
		let result;
		try {
			result = await this.opts.lookupSelection(text);
		} finally {
			this.opening = false;
		}
		if (gen !== this.generation) return;
		if (!result) {
			this.close();
			return;
		}
		this.clearCloseTimer();
		this.sticky = true;
		this.currentWord = text;
		const selHit = { word: text, sentence: text, rect };
		this.shown = { lookup: result, hit: selHit };
		this.opts.tooltip.show(result, selHit, this.opts.view());
	}

	/** hover 觸發:transient,移開就(寬限期後)關。 */
	private async trigger(hit: HoverHit): Promise<void> {
		const gen = ++this.generation;
		const result = await this.opts.lookup(hit.word);
		if (gen !== this.generation) return;

		if (!result) {
			// 查不到就安靜地不動作。滑過一整段英文時每個介系詞都跳「查無」會很吵。
			this.close();
			return;
		}

		this.sticky = false;
		this.currentWord = hit.word;
		this.shown = { lookup: result, hit };
		this.opts.tooltip.show(result, hit, this.opts.view());
	}

	// ---------------------------------------------------- 浮窗內導覽

	/** 還有沒有上一頁可回。 */
	canGoBack(): boolean {
		return this.history.length > 0;
	}

	/**
	 * 點同義詞:跳去查那個字。把目前這頁推進歷史,浮窗位置沿用——
	 * 導覽時浮窗釘在原地不動,只有內容換,這樣視線不會被拉走。
	 */
	async navigateTo(word: string): Promise<void> {
		const current = this.shown;
		this.opening = true;
		let result;
		try {
			result = await this.opts.lookup(word);
		} finally {
			this.opening = false;
		}
		if (!result) return;
		if (current) this.history.push(current);
		// 導覽出來的浮窗一律 sticky:使用者正在深入看,不該被滑鼠移開就關掉。
		this.sticky = true;
		this.currentWord = word;
		const hit = current?.hit ?? { word, sentence: word, rect: new DOMRect() };
		this.shown = { lookup: result, hit };
		this.opts.tooltip.show(result, hit, this.opts.view());
	}

	/** 返回上一個查過的字。 */
	goBack(): void {
		const prev = this.history.pop();
		if (!prev) return;
		this.sticky = true;
		this.currentWord = prev.lookup.entry.w;
		this.shown = prev;
		this.opts.tooltip.show(prev.lookup, prev.hit, this.opts.view());
	}

	/** 排一個延後關閉(只用於 hover transient)。滑回浮窗或安全區就取消。 */
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
		this.sticky = false;
		this.opening = false;
		// 關掉浮窗就結束這一輪導覽,歷史不跨越兩次查詢。
		this.history = [];
		this.shown = null;
		this.opts.tooltip.hide();
	}
}
