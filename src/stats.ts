// 練習數據的純邏輯:複習紀錄的讀寫,以及從紀錄與卡片算出統計。
// 零 Obsidian 依賴,node 測得到(專案規則,見 anki-fields.ts 檔頭)。
// 真正碰檔案的那半在 review-log.ts。
//
// 為什麼要另外記一份紀錄:生詞筆記的 frontmatter 只有 `fsrs_last_review`
// (最後一次複習的日期),歷史沒有被留下來過。所以「連續幾天」「今天複習幾張」
// 「這週正確率」這三個數字,不管怎麼算都算不出來——不是漏做,是資料不存在。
// 從現在開始一天記一列,往後才有得看。
//
// 為什麼是「一天一列」而不是「一次複習一列」:一天一列一年只有 365 列(約 20KB),
// 而且人打開就看得懂。要回答的問題(每日量、正確率、連續天數)只需要日彙總,
// 存到每一張卡的粒度是為了將來不知道會不會用到的查詢先付一年幾百 KB 的成本。

/** 某一天的複習彙總。 */
export interface DayLog {
	/** YYYY-MM-DD */
	date: string;
	/** 當天複習了幾張(同一張卡評兩次算兩次) */
	reviewed: number;
	/** 其中有幾張是第一次見到的新字(拿來管每日新字上限) */
	fresh: number;
	again: number;
	hard: number;
	good: number;
	easy: number;
}

export type RatingName = "again" | "hard" | "good" | "easy";

/** 自動維護區塊的界線。區塊外面留給使用者自己寫,永遠不動。 */
export const LOG_START = "<!-- WORDFOLIO:START 這個表格由外掛自動維護，請不要手動編輯 -->";
export const LOG_END = "<!-- WORDFOLIO:END -->";

/**
 * 從紀錄檔撈出每天的資料。
 *
 * 刻意「認日期不認表頭」:只要一列的第一格長得像 YYYY-MM-DD 就當資料列。
 * 這樣表頭可以隨介面語言換掉(繁中/英文兩份),舊檔案也還讀得動。
 */
export function parseLog(md: string): DayLog[] {
	const out: DayLog[] = [];
	for (const line of md.split("\n")) {
		const cells = line.split("|").map((c) => c.trim());
		// 前後各有一個空字串(| 開頭與結尾),所以資料格從 index 1 開始。
		if (cells.length < 8) continue;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(cells[1])) continue;
		const n = (i: number) => {
			const v = Number(cells[i]);
			return Number.isFinite(v) ? v : 0;
		};
		out.push({
			date: cells[1],
			reviewed: n(2),
			fresh: n(3),
			again: n(4),
			hard: n(5),
			good: n(6),
			easy: n(7),
		});
	}
	return out;
}

/** 每天一列的 Markdown 表格,新的在最上面。 */
export function renderLog(days: DayLog[], headers: string[]): string {
	const sorted = [...days].sort((a, b) => (a.date < b.date ? 1 : -1));
	const rows = sorted.map(
		(d) =>
			`| ${d.date} | ${d.reviewed} | ${d.fresh} | ${d.again} | ${d.hard} | ${d.good} | ${d.easy} |`
	);
	return [
		`| ${headers.join(" | ")} |`,
		`|${headers.map(() => "---").join("|")}|`,
		...rows,
	].join("\n");
}

/**
 * 把表格塞回檔案的自動維護區塊裡。檔案還沒有那個區塊就整份重建。
 * 區塊外的內容原樣保留——沿用 PaperFolio 與 Kobo 畫線那套「不碰手寫區」的做法。
 */
export function upsertLogTable(md: string, table: string, title: string): string {
	const block = `${LOG_START}\n\n${table}\n\n${LOG_END}`;
	const start = md.indexOf(LOG_START);
	const end = md.indexOf(LOG_END);
	if (start >= 0 && end > start) {
		return md.slice(0, start) + block + md.slice(end + LOG_END.length);
	}
	const head = md.trim()
		? md.trimEnd() + "\n\n"
		: `---\ntype: 複習紀錄\n---\n\n# ${title}\n\n`;
	return head + block + "\n";
}

/** 記一次評分。當天還沒有列就開一列。回傳新的陣列,不改原本的。 */
export function bumpDay(
	days: DayLog[],
	date: string,
	rating: RatingName,
	wasNew: boolean
): DayLog[] {
	const out = days.map((d) => ({ ...d }));
	let day = out.find((d) => d.date === date);
	if (!day) {
		day = { date, reviewed: 0, fresh: 0, again: 0, hard: 0, good: 0, easy: 0 };
		out.push(day);
	}
	day.reviewed++;
	if (wasNew) day.fresh++;
	day[rating]++;
	return out;
}

// ------------------------------------------------------------------ 日期

/** YYYY-MM-DD 加減天數。用 UTC 算,不受時區影響。 */
export function shiftDate(iso: string, days: number): string {
	const t = Date.parse(`${iso}T00:00:00Z`);
	return new Date(t + days * 86400000).toISOString().slice(0, 10);
}

/**
 * 連續複習幾天。
 *
 * 今天還沒複習不算斷——從昨天往回數。不然每天早上打開都會看到 0,
 * 那個數字就失去意義了(Anki 的日曆也是這樣處理)。
 */
export function streak(days: DayLog[], today: string): number {
	const active = new Set(days.filter((d) => d.reviewed > 0).map((d) => d.date));
	let cursor = active.has(today) ? today : shiftDate(today, -1);
	let n = 0;
	while (active.has(cursor)) {
		n++;
		cursor = shiftDate(cursor, -1);
	}
	return n;
}

// ------------------------------------------------------------------ 統計

/** 生詞卡片裡統計會用到的欄位。刻意只要這幾個,方便測試造假資料。 */
export interface StatCard {
	stability: number;
	reps: number;
	lapses: number;
	state: "new" | "learning" | "review" | "relearning";
	due: string;
	suspended?: boolean;
}

export interface Stats {
	/** 生詞總數 */
	total: number;
	newCount: number;
	learningCount: number;
	reviewCount: number;
	/** 今天(含逾期)到期幾張。封存的不算。 */
	dueToday: number;
	/** 已封存幾個 */
	suspendedCount: number;
	/** 今天複習了幾張 */
	todayReviewed: number;
	/** 今天已經上了幾個新字(給每日新字上限用) */
	todayNew: number;
	/** 最近七天(含今天)複習了幾張 */
	weekReviewed: number;
	/** 連續複習天數 */
	streakDays: number;
	/** 最近七天的正確率;沒複習過時為 null */
	weekAccuracy: number | null;
	/** 從有紀錄以來的正確率;沒複習過時為 null */
	allAccuracy: number | null;
	/** 複習過的卡片的平均 stability(天);沒有就是 0 */
	avgStability: number;
}

function accuracy(rows: DayLog[]): number | null {
	const total = rows.reduce((s, d) => s + d.reviewed, 0);
	if (!total) return null;
	const again = rows.reduce((s, d) => s + d.again, 0);
	// 「正確」= 沒有按重來。有點難/記得/太簡單都算想起來了,這跟 Anki 的
	// true retention 是同一個定義。
	return (total - again) / total;
}

export function summarize(cards: StatCard[], days: DayLog[], today: string): Stats {
	const byDate = new Map(days.map((d) => [d.date, d]));
	const weekStart = shiftDate(today, -6);
	const week = days.filter((d) => d.date >= weekStart && d.date <= today);

	const reviewed = cards.filter((c) => c.reps > 0);
	const avgStability = reviewed.length
		? reviewed.reduce((s, c) => s + c.stability, 0) / reviewed.length
		: 0;

	return {
		total: cards.length,
		newCount: cards.filter((c) => c.state === "new").length,
		learningCount: cards.filter((c) => c.state === "learning" || c.state === "relearning")
			.length,
		reviewCount: cards.filter((c) => c.state === "review").length,
		dueToday: cards.filter((c) => !c.suspended && (!c.due || c.due <= today)).length,
		suspendedCount: cards.filter((c) => c.suspended).length,
		todayReviewed: byDate.get(today)?.reviewed ?? 0,
		todayNew: byDate.get(today)?.fresh ?? 0,
		weekReviewed: week.reduce((s, d) => s + d.reviewed, 0),
		streakDays: streak(days, today),
		weekAccuracy: accuracy(week),
		allAccuracy: accuracy(days),
		avgStability,
	};
}
