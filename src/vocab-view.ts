// 生詞清單 + 練習數據的視圖。篩選/排序/統計的純邏輯在 vocab-list.ts 與 stats.ts。
//
// 為什麼需要這個:在這之前,生詞本唯一的入口是複習 Modal——一次一張卡,而且
// 只給今天到期的。沒有任何地方看得到「我總共存了哪些字」,也看不到複習了多少。
// 道哥的原話:「我看不到全部的單字,我也看不到什麼數據,練習的數據。」
//
// 做成全頁分頁而不是側欄:六個欄位(單字/釋義/狀態/到期/複習/忘記)在側欄的
// 寬度下會擠成一團,釋義那欄會被壓到只剩兩三個字——那就等於還是看不到。

import { Platform, ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import { t } from "./i18n";
import { isoDate } from "./schedule";
import { summarize, type DayLog, type Stats } from "./stats";
import {
	applyFilter,
	applySearch,
	applySort,
	hardest,
	type ListFilter,
	type SortDir,
	type SortKey,
	type VocabRow,
} from "./vocab-list";

export const VIEW_TYPE_VOCAB = "wordfolio-vocab";

export interface VocabViewDeps {
	data: () => Promise<{
		rows: VocabRow[];
		days: DayLog[];
		queueSize: number;
		newLimit: number;
	}>;
	startReview: () => void;
	importFromAnki: () => Promise<void>;
	importFromKobo: () => Promise<void>;
	openNote: (path: string) => void;
}

const FILTERS: { id: ListFilter; key: string }[] = [
	{ id: "all", key: "list_filter_all" },
	{ id: "due", key: "list_filter_due" },
	{ id: "leech", key: "list_filter_leech" },
	{ id: "new", key: "list_filter_new" },
	{ id: "learning", key: "list_filter_learning" },
	{ id: "suspended", key: "list_filter_suspended" },
];

const COLUMNS: { key: SortKey; label: string; cls: string }[] = [
	{ key: "word", label: "list_col_word", cls: "wf-col-word" },
	{ key: "meaning", label: "list_col_meaning", cls: "wf-col-meaning" },
	{ key: "state", label: "list_col_state", cls: "wf-col-state" },
	{ key: "due", label: "list_col_due", cls: "wf-col-due" },
	{ key: "reps", label: "list_col_reps", cls: "wf-col-num" },
	{ key: "lapses", label: "list_col_lapses", cls: "wf-col-num" },
];

const STATE_KEY: Record<VocabRow["card"]["state"], string> = {
	new: "state_new",
	learning: "state_learning",
	relearning: "state_relearning",
	review: "state_review",
};

export class VocabView extends ItemView {
	private filter: ListFilter = "all";
	private sortKey: SortKey = "due";
	private sortDir: SortDir = "asc";
	private query = "";

	private rows: VocabRow[] = [];
	private stats: Stats | null = null;
	private queueSize = 0;
	private newLimit = 0;

	// 重畫表格時只換這幾塊,不整頁重建——不然打字打到一半焦點就沒了。
	private statsEl!: HTMLElement;
	private breakdownEl!: HTMLElement;
	private hardestEl!: HTMLElement;
	private tableEl!: HTMLElement;
	private reviewBtn!: HTMLButtonElement;
	private countEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, private deps: VocabViewDeps) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_VOCAB;
	}

	getDisplayText(): string {
		return t("list_title");
	}

	getIcon(): string {
		return "book-open-check";
	}

	async onOpen(): Promise<void> {
		this.buildShell();
		await this.refresh();
	}

	/** 生詞本或複習紀錄變動時由 main.ts 叫。 */
	async refresh(): Promise<void> {
		const { rows, days, queueSize, newLimit } = await this.deps.data();
		this.rows = rows;
		this.queueSize = queueSize;
		this.newLimit = newLimit;
		this.stats = summarize(
			rows.map((r) => r.card),
			days,
			isoDate()
		);
		this.paintStats();
		this.paintTable();
	}

	// ------------------------------------------------------------- 版面

	private buildShell(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass("wordfolio-vocab-view");

		const header = root.createDiv({ cls: "wf-vocab-header" });
		this.breakdownEl = header.createDiv({ cls: "wf-breakdown" });

		const actions = header.createDiv({ cls: "wf-vocab-actions" });
		this.reviewBtn = actions.createEl("button", { cls: "mod-cta" });
		this.reviewBtn.onclick = () => this.deps.startReview();

		// **手機上不放這顆。** AnkiConnect 是 Anki 桌面版的外掛,而這個功能連的是
		// `localhost:8765`——在手機上那個 localhost 就是手機自己,那裡永遠不會有
		// Anki。放一顆按了必定失敗的按鈕比不放更糟:道哥按了兩次,拿到兩則
		// 「連不上 Anki」,而那則訊息聽起來像是他哪裡沒設定好。
		if (!Platform.isMobile) {
			const importBtn = actions.createEl("button", { text: t("list_import") });
			importBtn.onclick = () => void this.deps.importFromAnki();
		}

		// **這顆手機上要留著。** 它讀的是 vault 裡的一個檔(PaperFolio 同步時寫的),
		// 不像 Anki 那顆得連 localhost:8765,所以手機上按了是會成功的。
		const koboBtn = actions.createEl("button", { text: t("list_import_kobo") });
		koboBtn.onclick = () => void this.deps.importFromKobo();

		const reload = actions.createEl("button", { cls: "wf-icon-btn" });
		setIcon(reload, "refresh-cw");
		reload.setAttribute("aria-label", t("list_refresh"));
		reload.onclick = () => void this.refresh();

		this.statsEl = root.createDiv({ cls: "wf-stats" });
		this.hardestEl = root.createDiv({ cls: "wf-hardest" });

		const toolbar = root.createDiv({ cls: "wf-toolbar" });
		const filters = toolbar.createDiv({ cls: "wf-filters" });
		for (const f of FILTERS) {
			const b = filters.createEl("button", { text: t(f.key) });
			b.toggleClass("is-active", this.filter === f.id);
			b.onclick = () => {
				this.filter = f.id;
				filters.findAll("button").forEach((el) => el.removeClass("is-active"));
				b.addClass("is-active");
				this.paintTable();
			};
		}

		const search = toolbar.createEl("input", {
			cls: "wf-search",
			attr: { type: "search", placeholder: t("list_search") },
		});
		search.oninput = () => {
			this.query = search.value;
			this.paintTable();
		};

		this.countEl = root.createDiv({ cls: "wf-count" });
		this.tableEl = root.createDiv({ cls: "wf-table-wrap" });
	}

	// ------------------------------------------------------------- 數據

	private paintStats(): void {
		const s = this.stats;
		this.statsEl.empty();
		this.breakdownEl.empty();
		this.hardestEl.empty();
		if (!s) return;

		this.reviewBtn.setText(
			this.queueSize ? t("list_review_n", { n: this.queueSize }) : t("list_review_none")
		);
		this.reviewBtn.disabled = this.queueSize === 0;

		const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
		const tiles: [string, string, string][] = [
			[String(s.todayReviewed), t("stat_today"), ""],
			[String(s.weekReviewed), t("stat_week"), ""],
			[String(s.streakDays), t("stat_streak"), t("stat_streak_unit")],
			[pct(s.weekAccuracy), t("stat_accuracy_week"), ""],
			[String(s.total), t("stat_total"), ""],
			[s.avgStability ? s.avgStability.toFixed(1) : "—", t("stat_stability"), t("stat_days")],
		];
		for (const [value, label, unit] of tiles) {
			const tile = this.statsEl.createDiv({ cls: "wf-stat" });
			const v = tile.createDiv({ cls: "wf-stat-value", text: value });
			if (unit) v.createSpan({ cls: "wf-stat-unit", text: unit });
			tile.createDiv({ cls: "wf-stat-label", text: label });
		}

		this.breakdownEl.setText(
			t("list_breakdown", {
				new: s.newCount,
				learning: s.learningCount,
				review: s.reviewCount,
				due: s.dueToday,
			})
		);
		// 「今天到期 209」旁邊卻是一顆「複習 24」,不解釋的話那看起來就像壞了。
		if (this.queueSize < s.dueToday) {
			this.breakdownEl.createSpan({
				cls: "wf-limit-note",
				text: t("list_new_limit_note", { n: this.queueSize, limit: this.newLimit }),
			});
		}

		const worst = hardest(this.rows, 8);
		if (!worst.length) return;
		const line = this.hardestEl.createDiv({ cls: "wf-hardest-line" });
		line.createSpan({ cls: "wf-hardest-label", text: t("list_hardest") });
		for (const r of worst) {
			const chip = line.createEl("a", { cls: "wf-chip", text: r.word });
			chip.createSpan({ cls: "wf-chip-count", text: String(r.card.lapses) });
			chip.onclick = (e) => {
				e.preventDefault();
				this.deps.openNote(r.path);
			};
		}
	}

	// ------------------------------------------------------------- 表格

	private visibleRows(): VocabRow[] {
		const today = isoDate();
		return applySort(
			applySearch(applyFilter(this.rows, this.filter, today), this.query),
			this.sortKey,
			this.sortDir
		);
	}

	private paintTable(): void {
		const today = isoDate();
		const rows = this.visibleRows();
		this.countEl.setText(t("list_count", { shown: rows.length, total: this.rows.length }));

		this.tableEl.empty();

		if (!this.rows.length) {
			const empty = this.tableEl.createDiv({ cls: "wf-empty" });
			empty.createDiv({ text: t("list_empty") });
			if (Platform.isMobile) {
				// 空清單時更要講清楚下一步在哪,不然他只看到一個空白畫面。
				empty.createDiv({ cls: "wf-empty-hint", text: t("list_import_desktop_only") });
			} else {
				const b = empty.createEl("button", { cls: "mod-cta", text: t("list_import") });
				b.onclick = () => void this.deps.importFromAnki();
			}
			const kb = empty.createEl("button", { text: t("list_import_kobo") });
			kb.onclick = () => void this.deps.importFromKobo();
			return;
		}
		if (!rows.length) {
			this.tableEl.createDiv({ cls: "wf-empty", text: t("list_empty_filtered") });
			return;
		}

		const table = this.tableEl.createEl("table", { cls: "wf-table" });
		const head = table.createEl("thead").createEl("tr");
		for (const col of COLUMNS) {
			const th = head.createEl("th", { cls: col.cls, text: t(col.label) });
			if (this.sortKey === col.key) {
				th.addClass("is-sorted");
				th.createSpan({ text: this.sortDir === "asc" ? " ↑" : " ↓" });
			}
			th.onclick = () => {
				// 再點同一欄就換方向;換一欄則從預設方向開始。
				if (this.sortKey === col.key) {
					this.sortDir = this.sortDir === "asc" ? "desc" : "asc";
				} else {
					this.sortKey = col.key;
					// 次數類的欄位大家想看的是「最多的」,所以預設由大到小。
					this.sortDir = col.key === "reps" || col.key === "lapses" ? "desc" : "asc";
				}
				this.paintTable();
			};
		}

		const body = table.createEl("tbody");
		for (const r of rows) {
			const tr = body.createEl("tr");
			tr.onclick = () => this.deps.openNote(r.path);

			tr.createEl("td", { cls: "wf-col-word", text: r.word });
			tr.createEl("td", { cls: "wf-col-meaning", text: r.meaning });

			const state = tr.createEl("td", { cls: "wf-col-state" });
			// 封存蓋過學習階段:那個字現在不會被排,狀態欄該講的是這件事。
			state.createSpan({
				cls: r.card.suspended ? "wf-state wf-state-suspended" : `wf-state wf-state-${r.card.state}`,
				text: r.card.suspended ? t("state_suspended") : t(STATE_KEY[r.card.state]),
			});

			const due = tr.createEl("td", { cls: "wf-col-due" });
			// 封存的字沒有「下次到期」可言,顯示日期只會讓人以為它還會回來。
			due.setText(r.card.suspended ? "—" : this.dueLabel(r.card.due, today));
			if (!r.card.suspended && (!r.card.due || r.card.due <= today)) due.addClass("is-due");

			tr.createEl("td", { cls: "wf-col-num", text: String(r.card.reps) });
			const lapses = tr.createEl("td", { cls: "wf-col-num", text: String(r.card.lapses) });
			if (r.card.lapses > 0) lapses.addClass("wf-lapses");
		}
	}

	/** 到期日欄:今天與逾期講人話,其他照日期顯示。 */
	private dueLabel(due: string, today: string): string {
		if (!due || due === today) return t("due_today");
		if (due < today) {
			const days = Math.round((Date.parse(today) - Date.parse(due)) / 86400000);
			return t("due_overdue", { days });
		}
		return due;
	}
}
