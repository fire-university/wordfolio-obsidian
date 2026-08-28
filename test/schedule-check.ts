// FSRS 排程的測試。純邏輯,不碰 Obsidian。
//
//   npx tsx test/schedule-check.ts

import { gradeCard, newCard, dueCards, reviewQueue, isoDate, Rating } from "../src/schedule";
import type { VocabCard } from "../src/types";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const DAY0 = new Date("2026-07-23T09:00:00Z");
const daysBetween = (a: string, b: string) =>
	Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

console.log("新卡");
const fresh = newCard("unnerve", DAY0);
check("今天就到期", fresh.due === isoDate(DAY0), fresh.due);
check("狀態 new", fresh.state === "new");
check("reps 0", fresh.reps === 0);

console.log("\n四種評分的間隔要單調遞增");
const intervals: Record<string, number> = {};
for (const [name, grade] of [
	["Again", Rating.Again],
	["Hard", Rating.Hard],
	["Good", Rating.Good],
	["Easy", Rating.Easy],
] as const) {
	// 用一張已經複習過幾次的卡,新卡的 learning step 都在同一天分不出來。
	const seasoned: VocabCard = {
		word: "unnerve",
		due: "2026-07-23",
		stability: 10,
		difficulty: 5,
		reps: 4,
		lapses: 0,
		state: "review",
		lastReview: "2026-07-13",
	};
	const next = gradeCard(seasoned, grade, DAY0);
	intervals[name] = daysBetween(isoDate(DAY0), next.due);
	console.log(`  ${name.padEnd(6)} → ${next.due}  (+${intervals[name]} 天, stability ${next.stability.toFixed(1)})`);
}
check(
	"Again ≤ Hard ≤ Good ≤ Easy",
	intervals.Again <= intervals.Hard &&
		intervals.Hard <= intervals.Good &&
		intervals.Good <= intervals.Easy,
	`${intervals.Again} / ${intervals.Hard} / ${intervals.Good} / ${intervals.Easy}`
);
check("Easy 明顯拉長", intervals.Easy > intervals.Good, `${intervals.Easy} > ${intervals.Good}`);

console.log("\n記不牢的字要往回收");
const lapsing: VocabCard = {
	word: "ubiquitous",
	due: "2026-07-23",
	stability: 30,
	difficulty: 5,
	reps: 8,
	lapses: 1,
	state: "review",
	lastReview: "2026-06-23",
};
const failed = gradeCard(lapsing, Rating.Again, DAY0);
check("lapses +1", failed.lapses === lapsing.lapses + 1, `${lapsing.lapses} → ${failed.lapses}`);
check("狀態轉 relearning", failed.state === "relearning", failed.state);
check("stability 下降", failed.stability < lapsing.stability, `${lapsing.stability} → ${failed.stability.toFixed(1)}`);
check("當天就要再看", failed.due <= isoDate(DAY0), failed.due);

console.log("\n連續答對要愈拉愈長");
let card = newCard("frugal", DAY0);
let prev = 0;
let monotonic = true;
const trail: string[] = [];
for (let i = 0; i < 6; i++) {
	const at = new Date(Date.parse(`${card.due}T09:00:00Z`));
	card = gradeCard(card, Rating.Good, at);
	const gap = daysBetween(isoDate(at), card.due);
	trail.push(`+${gap}`);
	// 第一輪還在 learning step(同一天),從有間隔之後開始檢查。
	if (prev > 0 && gap < prev) monotonic = false;
	if (gap > 0) prev = gap;
}
check("間隔不倒退", monotonic, trail.join(" → "));
check("六次之後間隔 > 7 天", prev > 7, `${prev} 天`);

console.log("\n到期篩選");
const pool = [
	{ card: { ...newCard("a", DAY0), due: "2026-07-20" } },
	{ card: { ...newCard("b", DAY0), due: "2026-07-23" } },
	{ card: { ...newCard("c", DAY0), due: "2026-07-24" } },
	{ card: { ...newCard("d", DAY0), due: "" } },
];
const due = dueCards(pool, DAY0).map((x) => x.card.word);
check("過期與今天到期都算", due.includes("a") && due.includes("b"), due.join(","));
check("明天到期不算", !due.includes("c"), due.join(","));
check("沒有到期日的當成要複習", due.includes("d"), due.join(","));

console.log("\n封存的字不排進複習");
const withSuspended = [
	{ card: { ...newCard("live", DAY0), due: "2026-07-20" } },
	{ card: { ...newCard("parked", DAY0), due: "2026-07-20", suspended: true } },
];
const live = dueCards(withSuspended, DAY0).map((x) => x.card.word);
check("到期但封存的不算", live.join(",") === "live", live.join(","));
check("封存的到期日再早也不會回來",
	!reviewQueue(withSuspended, 99, 0, DAY0).map((x) => x.card.word).includes("parked"));

console.log("\n每日新字上限");
// 從 Anki 匯入之後生詞本會一次多兩百多個新字。到期的舊字一定要複習完
// (排程算出來該複習的),新字才受上限管。
const mixed = [
	{ card: { ...newCard("old1", DAY0), state: "review" as const, due: "2026-07-20", reps: 5 } },
	{ card: { ...newCard("old2", DAY0), state: "learning" as const, due: "2026-07-23", reps: 2 } },
	{ card: { ...newCard("new1", DAY0) } },
	{ card: { ...newCard("new2", DAY0) } },
	{ card: { ...newCard("new3", DAY0) } },
	{ card: { ...newCard("later", DAY0), due: "2026-08-30" } },
];
const q = (limit: number, done: number) =>
	reviewQueue(mixed, limit, done, DAY0).map((x) => x.card.word).join(",");
check("上限 2:舊字全進,新字只放 2 個", q(2, 0) === "old1,old2,new1,new2", q(2, 0));
check("今天已經上過 1 個新字,只剩 1 個名額", q(2, 1) === "old1,old2,new1", q(2, 1));
check("名額用完就只剩舊字", q(2, 2) === "old1,old2", q(2, 2));
check("上限 0 = 只複習舊字", q(0, 0) === "old1,old2", q(0, 0));
check("上限大於新字數不會爆", q(99, 0) === "old1,old2,new1,new2,new3", q(99, 0));
check("超額也不會變成負數名額", q(2, 99) === "old1,old2", q(2, 99));
check("還沒到期的字一律不進來", !q(99, 0).includes("later"), q(99, 0));

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
