// FSRS 排程的測試。純邏輯,不碰 Obsidian。
//
//   npx tsx test/schedule-check.ts

import { gradeCard, newCard, dueCards, isoDate, Rating } from "../src/schedule";
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

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
