// 練習數據的測試。純邏輯,不碰 Obsidian。
//
//   npx tsx test/stats-check.ts

import {
	parseLog,
	renderLog,
	upsertLogTable,
	bumpDay,
	streak,
	shiftDate,
	summarize,
	LOG_START_PREFIX,
	wordStats,
	logStart,
	LOG_END,
	type DayLog,
	type StatCard,
} from "../src/stats";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const HEADERS = ["日期", "複習", "新字", "重來", "有點難", "記得", "太簡單"];

console.log("紀錄表格的讀寫");
const days: DayLog[] = [
	{ date: "2026-08-25", reviewed: 10, fresh: 4, again: 2, hard: 1, good: 5, easy: 2 },
	{ date: "2026-08-27", reviewed: 6, fresh: 6, again: 0, hard: 2, good: 3, easy: 1 },
];
const table = renderLog(days, HEADERS);
check("新的排在最上面", table.indexOf("2026-08-27") < table.indexOf("2026-08-25"));

const round = parseLog(table);
check("讀回來筆數一樣", round.length === 2, String(round.length));
check("欄位對得上", round[0].date === "2026-08-27" && round[0].reviewed === 6 && round[0].fresh === 6);
check("評分欄對得上", round[1].again === 2 && round[1].hard === 1 && round[1].good === 5 && round[1].easy === 2);

console.log("\n表頭換語言之後還讀得動(認日期不認表頭)");
const english = renderLog(days, ["Date", "Reviewed", "New", "Again", "Hard", "Good", "Easy"]);
check("英文表頭一樣解析得出兩列", parseLog(english).length === 2);
check("表頭那兩列不會被當成資料", !parseLog(english).some((d) => d.date === "Date"));

console.log("\n區塊外的手寫內容不能被動到");
const handwritten = `---
type: 複習紀錄
---

# 複習紀錄

我自己寫的一段話，換語言、重寫表格都不該把它弄丟。

${logStart("這個表格由外掛自動維護，請不要手動編輯")}

| 日期 | 複習 |
|---|---|

${LOG_END}

下面也是我寫的。
`;
const ZH = { note: "這個表格由外掛自動維護，請不要手動編輯", type: "複習紀錄" };
const EN = { note: "Maintained by WordFolio — do not edit by hand", type: "review log" };
const updated = upsertLogTable(handwritten, table, "複習紀錄", ZH);
check("上面的手寫段落還在", updated.includes("我自己寫的一段話"));
check("下面的手寫段落還在", updated.includes("下面也是我寫的。"));
check("新表格進去了", updated.includes("2026-08-27"));
check("界線只有一組", updated.split(LOG_START_PREFIX).length === 2 && updated.split(LOG_END).length === 2);

console.log("\n檔案還不存在時整份建起來");
const fresh = upsertLogTable("", table, "複習紀錄", ZH);
check("有 frontmatter", fresh.startsWith("---\ntype: 複習紀錄"));
check("有界線與表格", fresh.includes(LOG_START_PREFIX) && fresh.includes("2026-08-27"));
check(
	"再 upsert 一次不會長出第二組界線",
	upsertLogTable(fresh, table, "複習紀錄", ZH).split(LOG_START_PREFIX).length === 2
);

// 換語言時,舊檔案裡的界線寫的是舊那句說明。認整串就會接不上,結果是同一個檔
// 長出第二張表、舊的那張再也不更新——而且畫面上看不出來。
const switched = upsertLogTable(fresh, table, "Review log", EN);
check("換成英文之後界線仍然只有一組", switched.split(LOG_START_PREFIX).length === 2);
check("換語言不會丟掉原本的資料列", switched.includes("2026-08-27"));
check("界線的說明換成英文", switched.includes("Maintained by WordFolio"));

console.log("\n記一次評分");
let d2 = bumpDay([], "2026-08-27", "good", true);
check("開了新的一列", d2.length === 1 && d2[0].reviewed === 1 && d2[0].fresh === 1 && d2[0].good === 1);
d2 = bumpDay(d2, "2026-08-27", "again", false);
check("同一天累加", d2.length === 1 && d2[0].reviewed === 2 && d2[0].again === 1);
check("舊卡不算新字", d2[0].fresh === 1);
const before = bumpDay([], "2026-08-27", "good", true);
bumpDay(before, "2026-08-27", "easy", false);
check("不會改到傳進去的陣列", before[0].reviewed === 1);

console.log("\n連續天數");
const run: DayLog[] = ["2026-08-25", "2026-08-26", "2026-08-27"].map((date) => ({
	date, reviewed: 3, fresh: 0, again: 0, hard: 0, good: 3, easy: 0,
}));
check("連三天 = 3", streak(run, "2026-08-27") === 3, String(streak(run, "2026-08-27")));
check("今天還沒複習時從昨天數起", streak(run, "2026-08-28") === 3, String(streak(run, "2026-08-28")));
check("隔一天就斷了", streak(run, "2026-08-29") === 0, String(streak(run, "2026-08-29")));
const gap = [...run, { date: "2026-08-23", reviewed: 5, fresh: 0, again: 0, hard: 0, good: 5, easy: 0 }];
check("中間斷掉的那段不算進來", streak(gap, "2026-08-27") === 3, String(streak(gap, "2026-08-27")));
const zero: DayLog[] = [{ date: "2026-08-27", reviewed: 0, fresh: 0, again: 0, hard: 0, good: 0, easy: 0 }];
check("有列但沒複習不算一天", streak(zero, "2026-08-27") === 0);

console.log("\n日期加減");
check("跨月往前", shiftDate("2026-09-01", -1) === "2026-08-31", shiftDate("2026-09-01", -1));
check("跨年往後", shiftDate("2026-12-31", 1) === "2027-01-01", shiftDate("2026-12-31", 1));
check("閏年 2 月", shiftDate("2028-02-28", 1) === "2028-02-29", shiftDate("2028-02-28", 1));

console.log("\n統計彙總");
const cards: StatCard[] = [
	{ stability: 0, reps: 0, lapses: 0, state: "new", due: "2026-08-27" },
	{ stability: 0, reps: 0, lapses: 0, state: "new", due: "2026-08-27" },
	{ stability: 4, reps: 3, lapses: 1, state: "learning", due: "2026-08-27" },
	{ stability: 10, reps: 8, lapses: 3, state: "review", due: "2026-09-10" },
	{ stability: 6, reps: 5, lapses: 0, state: "review", due: "2026-08-20" },
];
const s = summarize(cards, days, "2026-08-27");
check("總數 5", s.total === 5);
check("新字 2 / 學習中 1 / 複習中 2", s.newCount === 2 && s.learningCount === 1 && s.reviewCount === 2);
check("到期含逾期 = 4", s.dueToday === 4, String(s.dueToday));
check("今天複習 6 張", s.todayReviewed === 6);
check("今天上了 6 個新字", s.todayNew === 6);
check("本週(七天內)兩列都算 = 16", s.weekReviewed === 16, String(s.weekReviewed));
check("平均 stability 只算複習過的", Math.abs(s.avgStability - 20 / 3) < 1e-9, String(s.avgStability));

// 16 張裡按過 2 次重來 → 14/16
check("正確率 = 非重來 / 總數", Math.abs((s.allAccuracy ?? 0) - 14 / 16) < 1e-9, String(s.allAccuracy));
check("本週正確率同上(兩列都在七天內)", Math.abs((s.weekAccuracy ?? 0) - 14 / 16) < 1e-9);

const older = summarize(cards, days, "2026-09-05");
check("超過七天的不算進本週", older.weekReviewed === 0, String(older.weekReviewed));
check("本週沒複習過 → 正確率 null(不是 0)", older.weekAccuracy === null);
check("但累計正確率還在", older.allAccuracy !== null);

const parked = summarize(
	[...cards, { stability: 9, reps: 4, lapses: 0, state: "review", due: "2026-08-01", suspended: true }],
	days, "2026-08-27");
check("封存的算進總數", parked.total === 6, String(parked.total));
check("封存的不算到期(雖然它逾期很久)", parked.dueToday === 4, String(parked.dueToday));
check("封存數單獨算", parked.suspendedCount === 1, String(parked.suspendedCount));

const empty = summarize([], [], "2026-08-27");
check("空生詞本不會爆", empty.total === 0 && empty.allAccuracy === null && empty.avgStability === 0);

console.log("\n單字的練習數據");
const st = (reps: number, again: number, stability = 0) =>
	wordStats({ reps, lapses: 0, again, stability });

check("還沒複習過:正確率是 null 不是 0", st(0, 0).accuracy === null);
check("還沒複習過 → untested", st(0, 0).tier === "untested", st(0, 0).tier);
{
	const s1 = st(10, 2);
	check("對錯次數", s1.right === 8 && s1.wrong === 2, `${s1.right}/${s1.wrong}`);
	check("正確率", Math.abs(s1.accuracy! - 0.8) < 1e-9, String(s1.accuracy));
}

console.log("\n熟練度分級");
check("正確率低 → shaky(重點加強)", st(10, 6).tier === "shaky", st(10, 6).tier);
// 樣本太小不下「已掌握」的結論:第一次就答對不代表記住了。
check("只練一次全對 → learning,不是 mastered", st(1, 0, 99).tier === "learning", st(1, 0, 99).tier);
check("兩次全對 → 還是 learning", st(2, 0, 99).tier === "learning");
check("三次全對 + 記憶夠久 → mastered", st(3, 0, 30).tier === "mastered", st(3, 0, 30).tier);
check("三次全對但記憶還很短 → solid,不是 mastered", st(3, 0, 5).tier === "solid", st(3, 0, 5).tier);
check("練很多次、正確率中等 → solid", st(20, 4, 40).tier === "solid", st(20, 4, 40).tier);
// 正確率低就是低,不會因為練很久、stability 很高就升級。
check("stability 很高但正確率低 → 仍然 shaky", st(20, 12, 90).tier === "shaky", st(20, 12, 90).tier);

console.log("\n舊筆記沒有 again 欄位時退回 lapses");
{
	const old = wordStats({ reps: 5, lapses: 2, stability: 10 });
	check("用 lapses 當近似值", old.wrong === 2 && old.right === 3, `${old.right}/${old.wrong}`);
	const fresh = wordStats({ reps: 5, lapses: 2, again: 4, stability: 10 });
	check("有 again 就以 again 為準(它才是真的答錯次數)", fresh.wrong === 4, String(fresh.wrong));
}

console.log("\n不合理的輸入不會算出荒謬的數字");
check("答錯次數超過複習次數 → 夾住,不會出現負的答對次數",
	st(3, 99).wrong === 3 && st(3, 99).right === 0, JSON.stringify(st(3, 99)));
check("負數不會爆", st(-5, -5).reps === 0 && st(-5, -5).accuracy === null);
{
	const a = st(4, 0, 30).accuracy;
	check("正確率不會超過 1", a !== null && a <= 1, String(a));
}

console.log(failures ? `\n${failures} 項失敗` : "\n全部通過");
process.exit(failures ? 1 : 0);
