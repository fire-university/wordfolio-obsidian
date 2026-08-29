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

/**
 * 自動維護區塊的界線。區塊外面留給使用者自己寫,永遠不動。
 *
 * 找的時候只認 `<!-- WORDFOLIO:START` 這個前綴,不認後面那句說明——說明要跟著
 * 介面語言換,而**已經存在的檔案裡寫的是舊那句**。認整串的話,換一次語言就
 * 接不上舊區塊,結果是同一個檔裡長出第二張表,舊的那張永遠不再更新。
 */
export const LOG_START_PREFIX = "<!-- WORDFOLIO:START";
export const LOG_END = "<!-- WORDFOLIO:END -->";

/** 寫出去用的完整界線。note 是給人看的那句提醒。 */
export function logStart(note: string): string {
	return `${LOG_START_PREFIX} ${note} -->`;
}

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
export function upsertLogTable(
	md: string,
	table: string,
	title: string,
	labels: { note: string; type: string }
): string {
	const block = `${logStart(labels.note)}\n\n${table}\n\n${LOG_END}`;
	const start = md.indexOf(LOG_START_PREFIX);
	const end = md.indexOf(LOG_END);
	if (start >= 0 && end > start) {
		return md.slice(0, start) + block + md.slice(end + LOG_END.length);
	}
	const head = md.trim()
		? md.trimEnd() + "\n\n"
		: `---\ntype: ${labels.type}\n---\n\n# ${title}\n\n`;
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

// ---------------------------------------------------------------- 單字層級

/**
 * 一個字的熟練度分級。
 *
 * 這是**依他自己的表現**分的,跟這個字客觀上難不難無關(客觀難度另有 CEFR、
 * 考試標籤、詞頻,那些在浮窗裡)。
 */
export type MasteryTier = "untested" | "shaky" | "learning" | "solid" | "mastered";

export interface WordStats {
	/** 複習過幾次 */
	reps: number;
	/** 答對幾次 */
	right: number;
	/** 答錯幾次(按過幾次「重來」) */
	wrong: number;
	/** 正確率 0–1;還沒複習過是 null,不是 0——那兩個意思差很多 */
	accuracy: number | null;
	tier: MasteryTier;
}

/**
 * FSRS 的 stability 到幾天算「記牢了」。
 *
 * stability 的定義是「記憶強度掉到 90% 需要幾天」,所以 21 天 = 三週後still
 * 有九成把握。挑 21 而不是 7 或 30:一週太短(剛複習完的字都會超過),
 * 一個月太嚴(要等很久才有人能升到這一級,那個分級就沒有回饋作用)。
 */
const MASTERED_DAYS = 21;
/** 低於這個正確率就是「重點加強」。 */
const SHAKY_ACCURACY = 0.6;
/** 少於這麼多次,樣本太小,不下「已掌握」的結論。 */
const ENOUGH_REPS = 3;

/**
 * 從一張卡算出他在這個字上的實際表現。
 *
 * **答錯次數優先用 `again`,沒有才退回 `lapses`。** 舊筆記沒有 again 欄位,
 * 那時只能用 lapses 當近似值——它會低估,所以舊卡的正確率偏樂觀,這一點
 * 顯示的時候要老實講(見 i18n 的說明字串)。
 */
export function wordStats(card: {
	reps: number;
	lapses: number;
	again?: number;
	stability: number;
}): WordStats {
	const reps = Math.max(0, card.reps);
	const wrong = Math.min(reps, Math.max(0, card.again ?? card.lapses));
	const right = Math.max(0, reps - wrong);
	const accuracy = reps > 0 ? right / reps : null;

	let tier: MasteryTier;
	if (reps === 0) tier = "untested";
	else if (accuracy !== null && accuracy < SHAKY_ACCURACY) tier = "shaky";
	else if (reps < ENOUGH_REPS) tier = "learning";
	else if (card.stability >= MASTERED_DAYS && accuracy !== null && accuracy >= 0.9)
		tier = "mastered";
	else tier = "solid";

	return { reps, right, wrong, accuracy, tier };
}

/** i18n 的 key。 */
export function tierLabelKey(tier: MasteryTier): string {
	return `tier_${tier}`;
}
