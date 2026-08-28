// 複習紀錄的檔案讀寫。算數字的純邏輯在 stats.ts。
//
// 檔案放在生詞本資料夾裡、底線開頭(`_review-log.md`),所以在檔案總管會排在
// 所有生詞的最上面——他看得到、翻得動、進得了 git,跟生詞筆記存 Markdown
// 是同一個理由(ADR-4)。表格夾在 WORDFOLIO:START/END 之間自動維護,
// 區塊外面隨他寫什麼都不會被蓋掉。
//
// 檔名固定不隨語言變(不然切語言會多長出一個檔),裡面的標題與表頭才走 i18n;
// stats.ts 的解析器認日期不認表頭,所以換語言不會讓舊資料讀不出來。

import { App, TFile, normalizePath } from "obsidian";
import { t } from "./i18n";
import { schemaFor, type NoteLang } from "./note-schema";
import { isoDate } from "./schedule";
import {
	parseLog,
	renderLog,
	upsertLogTable,
	bumpDay,
	type DayLog,
	type RatingName,
} from "./stats";

export const LOG_FILE = "_review-log.md";

export class ReviewLog {
	private days: DayLog[] = [];

	constructor(
		private app: App,
		private folder: () => string,
		/** 紀錄檔的 frontmatter 用哪種語言。跟生詞筆記同一個來源。 */
		private lang: () => NoteLang
	) {}

	private path(): string {
		return normalizePath(`${this.folder()}/${LOG_FILE}`);
	}

	/** 界線裡那句提醒,以及新檔案的 frontmatter type。都跟介面語言走。 */
	private labels(): { note: string; type: string } {
		return { note: t("log_sentinel_note"), type: schemaFor(this.lang()).logType };
	}

	private headers(): string[] {
		return [
			t("log_col_date"),
			t("log_col_reviewed"),
			t("log_col_new"),
			t("review_again"),
			t("review_hard"),
			t("review_good"),
			t("review_easy"),
		];
	}

	/** 讀進記憶體。外掛啟動與換生詞本資料夾時各叫一次。 */
	async load(): Promise<void> {
		const file = this.app.vault.getAbstractFileByPath(this.path());
		this.days = file instanceof TFile ? parseLog(await this.app.vault.read(file)) : [];
	}

	all(): DayLog[] {
		return this.days;
	}

	/** 今天已經上過幾個新字。每日新字上限靠這個數。 */
	newToday(today = isoDate()): number {
		return this.days.find((d) => d.date === today)?.fresh ?? 0;
	}

	/**
	 * 記一次評分並立刻寫檔。
	 *
	 * 為什麼每評一張就寫一次而不是等複習結束:複習到一半關掉視窗是常態,
	 * 那幾張不該憑空消失。檔案本身一年也才 20KB,寫的成本可以忽略。
	 */
	async record(rating: RatingName, wasNew: boolean, now = new Date()): Promise<void> {
		this.days = bumpDay(this.days, isoDate(now), rating, wasNew);
		await this.flush();
	}

	private async flush(): Promise<void> {
		const path = this.path();
		const table = renderLog(this.days, this.headers());
		const file = this.app.vault.getAbstractFileByPath(path);

		if (file instanceof TFile) {
			const next = upsertLogTable(
				await this.app.vault.read(file),
				table,
				t("log_title"),
				this.labels()
			);
			await this.app.vault.modify(file, next);
			return;
		}

		const dir = normalizePath(this.folder());
		if (!(await this.app.vault.adapter.exists(dir))) {
			await this.app.vault.createFolder(dir);
		}
		await this.app.vault.create(path, upsertLogTable("", table, t("log_title"), this.labels()));
	}
}
