// FSRS 排程的純邏輯。零 Obsidian 依賴,node 測試可直接跑。
// UI(複習 Modal)在 review.ts。
//
// 到期時間刻意只存日期(YYYY-MM-DD),不存時間戳:frontmatter 要人看得懂、
// Dataview 要查得動。代價是 FSRS 的 learning step(新卡評「記得」是 +10 分鐘)
// 會被抹平,所以改在複習 session 內處理——評「重來」的卡片排回佇列尾端,
// 當場再看一次。對每天複習一次的人來說這才是想要的行為。

import {
	fsrs,
	generatorParameters,
	createEmptyCard,
	Rating,
	State,
	type Card as FsrsCard,
	type Grade,
} from "ts-fsrs";
import type { VocabCard } from "./types";

export { Rating };
export type { Grade };

const STATE_NAME: Record<number, VocabCard["state"]> = {
	[State.New]: "new",
	[State.Learning]: "learning",
	[State.Review]: "review",
	[State.Relearning]: "relearning",
};

const STATE_VALUE: Record<VocabCard["state"], State> = {
	new: State.New,
	learning: State.Learning,
	review: State.Review,
	relearning: State.Relearning,
};

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export function isoDate(d: Date = new Date()): string {
	return d.toISOString().slice(0, 10);
}

function toFsrs(card: VocabCard): FsrsCard {
	const empty = createEmptyCard();
	return {
		...empty,
		due: card.due ? new Date(`${card.due}T00:00:00Z`) : empty.due,
		stability: card.stability,
		difficulty: card.difficulty,
		reps: card.reps,
		lapses: card.lapses,
		state: STATE_VALUE[card.state] ?? State.New,
		last_review: card.lastReview ? new Date(`${card.lastReview}T00:00:00Z`) : undefined,
	};
}

/** 評分後算出新的複習狀態。 */
export function gradeCard(card: VocabCard, grade: Grade, now = new Date()): VocabCard {
	const next = scheduler.next(toFsrs(card), now, grade).card;
	return {
		word: card.word,
		// FSRS 對新卡的 learning step 是分鐘級,取日期會落在同一天——
		// 那正是我們要的:今天沒記牢的字今天再看。
		due: isoDate(next.due),
		stability: next.stability,
		difficulty: next.difficulty,
		reps: next.reps,
		lapses: next.lapses,
		state: STATE_NAME[next.state] ?? "learning",
		lastReview: isoDate(now),
	};
}

/** 新加入的字:今天就到期,加入當天就能複習。 */
export function newCard(word: string, now = new Date()): VocabCard {
	return {
		word,
		due: isoDate(now),
		stability: 0,
		difficulty: 0,
		reps: 0,
		lapses: 0,
		state: "new",
	};
}

/** 今天(含之前)到期的卡片。 */
export function dueCards<T extends { card: VocabCard }>(all: T[], now = new Date()): T[] {
	const today = isoDate(now);
	return all.filter(({ card }) => !card.due || card.due <= today);
}

/**
 * 這次複習實際要排哪些卡。
 *
 * 為什麼需要新字上限:從 Anki 匯入之後生詞本一次多了兩百多個字,全部標成
 * 「今天到期」的話,打開複習就是兩百多張等著——那不會被複習完,只會被關掉。
 * Anki 的解法是每天限量放新卡進來,這裡照做:**到期的舊字全部要複習**
 * (它們是排程算出來該複習的,漏掉就白排了),新字才受上限管。
 *
 * @param newLimit  每天最多放幾個新字進來;0 = 這陣子只複習舊字
 * @param newToday  今天已經上過幾個新字(從複習紀錄來)
 */
export function reviewQueue<T extends { card: VocabCard }>(
	all: T[],
	newLimit: number,
	newToday: number,
	now = new Date()
): T[] {
	const due = dueCards(all, now);
	const old = due.filter(({ card }) => card.state !== "new");
	const fresh = due.filter(({ card }) => card.state === "new");
	const room = Math.max(0, newLimit - newToday);
	return [...old, ...fresh.slice(0, room)];
}
