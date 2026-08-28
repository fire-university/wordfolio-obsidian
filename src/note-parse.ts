// 生詞筆記 → 複習卡要的欄位,以及例句挖空。
//
// **這個檔刻意不 import obsidian**(專案規則,見 anki-fields.ts 檔頭)。
//
// 為什麼要一個真的解析器:原本複習卡的答案面是「把整篇 markdown 洗成純文字」——
// 剝掉 frontmatter、拿掉 `##` 和 `**`、塞進一個 div。結果畫面上「英英釋義」變成
// 一個孤零零的裸標題,底下是 `- v make too high an estimate of`,破折號還在。
// 洗字串洗不出版面,得先把筆記拆成有名字的欄位,畫面才畫得出來。
//
// 順便解掉兩個資料一直都在、只是被丟掉的東西:音標(在 frontmatter,被整段剝掉)
// 與出處例句(在「我遇到它的地方」,被 split 主動切掉)。

import { FRONTMATTER_ALIASES, FORMS_LINE, headingIs } from "./note-schema";

/** 中譯行的標記。放在引用區塊裡,原句底下一行。 */
export const TRANSLATION_MARK = "↳";

/** 一句出處例句,以及它的中文翻譯(如果來源有給)。 */
export interface SourceSentence {
	text: string;
	translation?: string;
}

export interface ParsedNote {
	word: string;
	ukPhonetic?: string;
	usPhonetic?: string;
	/** 主釋義(中文那幾行) */
	meaning: string[];
	/** 英英釋義的列點 */
	english: string[];
	/** 變化形,例如 overrated / overrating / overrates */
	forms: string[];
	/** 「我遇到它的地方」底下的原句與中譯 */
	sentences: SourceSentence[];
	/** 匯入來源 */
	source?: string;
	/** 其他區塊(字詞詳解、例句與用法…),原樣帶著標題 */
	extras: { heading: string; body: string }[];
}

/**
 * frontmatter 的單行值。yamlString 寫出來的雙引號字串要脫掉引號與跳脫。
 *
 * 吃的是**別名清單**而不是單一欄位名:同一篇 vault 裡可能同時有繁中版
 * (`音標_英`)與英文版(`phonetic_uk`)的筆記,兩種都要讀得出來。
 */
function frontmatterValue(front: string, keys: string | string[]): string | undefined {
	const list = typeof keys === "string" ? [keys] : keys;
	const m = list.map((k) => front.match(new RegExp(`^${k}:\\s*(.*)$`, "m"))).find(Boolean);
	if (!m) return undefined;
	const raw = m[1].trim();
	if (!raw) return undefined;
	if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
		return raw.slice(1, -1).replace(/\\(["\\])/g, "$1");
	}
	return raw;
}

export function parseNote(markdown: string): ParsedNote {
	const fm = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
	const front = fm?.[1] ?? "";
	const body = markdown.slice(fm ? fm[0].length : 0);

	const out: ParsedNote = {
		word: frontmatterValue(front, "word") ?? "",
		ukPhonetic: frontmatterValue(front, FRONTMATTER_ALIASES.uk),
		usPhonetic: frontmatterValue(front, FRONTMATTER_ALIASES.us),
		meaning: [],
		english: [],
		forms: [],
		sentences: [],
		source: frontmatterValue(front, FRONTMATTER_ALIASES.source),
		extras: [],
	};

	// 變化形那一行不一定在哪:renderNote 是把它接在「英英釋義」區塊**後面**,
	// 所以不能只在第一段裡找。全文抓一次。
	const formLine = body.match(FORMS_LINE);
	if (formLine) {
		out.forms = formLine[1].split("/").map((f) => f.trim()).filter(Boolean);
	}

	// 依 `## 標題` 切段。標題之前那段是主釋義。
	const chunks = body.split(/^##\s+/m);
	const head = chunks.shift() ?? "";

	for (const line of head.split("\n")) {
		const t = line.trim();
		if (!t) continue;
		if (/^#\s/.test(t)) continue; // 大標題就是那個字,正面已經看過
		if (FORMS_LINE.test(t)) continue; // 上面已經抓過了
		// 前導的「- 」要剝掉。英文版筆記的主釋義是列點(英英釋義當主體),
		// 留著的話複習卡上就是一個孤零零的破折號——這個檔一開始就是為了修掉
		// 這種東西才存在的,不要在自己身上重犯。
		out.meaning.push(t.replace(/^[-*]\s+/, "").replace(/\*\*/g, ""));
	}

	for (const chunk of chunks) {
		const nl = chunk.indexOf("\n");
		const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
		const rest = nl < 0 ? "" : chunk.slice(nl + 1);

		if (headingIs(heading, "english")) {
			out.english = rest
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.startsWith("-"))
				.map((l) => l.replace(/^-\s*/, ""));
			continue;
		}
		if (headingIs(heading, "sentence")) {
			// 引用行有兩種:原句,以及緊接其後、用 ↳ 標記的中譯。
			// 用明確標記而不是「第二行就是翻譯」,免得他自己手動加第二句時被誤判。
			for (const raw of rest.split("\n")) {
				const line = raw.trim();
				if (!line.startsWith(">")) continue;
				const body = line.replace(/^>\s*/, "");
				if (!body) continue;
				if (body.startsWith(TRANSLATION_MARK)) {
					const last = out.sentences[out.sentences.length - 1];
					if (last) last.translation = body.slice(TRANSLATION_MARK.length).trim();
					continue;
				}
				out.sentences.push({ text: body });
			}
			continue;
		}
		const trimmed = rest.trim();
		if (trimmed) out.extras.push({ heading, body: trimmed });
	}

	return out;
}

// ---------------------------------------------------------------- 挖空

/** 挖掉之後留下的空格。長度固定,不要洩漏原字有幾個字母。 */
export const BLANK = "______";

/**
 * 把句子裡的目標字換成空格。挖不到就回 null——回 null 時呼叫端該退回顯示
 * 完整句子,而不是給一個看起來沒挖到東西的句子。
 *
 * 難的地方是**句子裡通常不是原形**:筆記的字是 `overrate`,句子裡寫的是
 * `overrated`。所以除了原形本身,變化形(筆記「變化」那一行)也要一起試,
 * 而且要**先試長的**——先挖 `overrate` 會在 `overrated` 中間挖出
 * `______d`,那比沒挖到還糟。
 */
export function clozeSentence(
	sentence: string,
	word: string,
	forms: string[] = []
): string | null {
	const candidates = [word, ...forms]
		.map((w) => w.trim())
		.filter(Boolean)
		// 長的優先:overrated 要比 overrate 先試。
		.sort((a, b) => b.length - a.length);

	for (const candidate of candidates) {
		// 英文字的邊界不能用 \b:`don't` 的撇號、`well-known` 的連字號都會被
		// \b 當成邊界,挖出半個字。改成「前後不是字母、撇號或連字號」。
		const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(`(^|[^A-Za-z'’-])(${escaped})(?=[^A-Za-z'’-]|$)`, "i");
		if (re.test(sentence)) {
			return sentence.replace(re, `$1${BLANK}`);
		}
	}
	return null;
}


// ------------------------------------------------------- 例句清理與提示

/**
 * 字幕來源的句子常常黏成一長串。
 *
 * Language Reactor 匯出的 `Subtitle` 是用 `>>` 接起來的好幾句,而且最後一句
 * 往往被切在半路:
 *
 *   stop relying only on willpower. >> That sounds brilliant. So, by the end of
 *
 * 只留**含目標字的那一段**,其餘丟掉——複習要看的是那個字怎麼用,不是前後文。
 * 找不到含目標字的段落就回整句(至少不是空的)。
 */
export function focusSentence(sentence: string, word: string, forms: string[] = []): string {
	const parts = sentence
		.split(/\s*>>\s*/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (parts.length <= 1) return sentence.trim();

	const targets = [word, ...forms].map((w) => w.trim().toLowerCase()).filter(Boolean);
	const hit = parts.find((p) => {
		const lower = p.toLowerCase();
		return targets.some((tWord) =>
			new RegExp(`(^|[^a-z'’-])${tWord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^a-z'’-]|$)`).test(lower)
		);
	});
	return (hit ?? parts[0]).trim();
}



/** 拼寫格子裡的一格。 */
export interface LetterSlot {
	/** 這一格該是什麼字元 */
	char: string;
	/** 要不要讓使用者填。首尾與非字母(連字號、撇號)直接給,其餘留空 */
	editable: boolean;
}

/**
 * 把一個字拆成一排拼寫格子。
 *
 * 道哥:「既然你已經有格子、空格出來了,是不是可以讓我把中間的空白填進去呢?
 * 這樣是不是可以增加我動腦的機會?」——對,而且不只是「多一點動腦」:
 * 用打的會逼出**拼寫**,而光是心裡想「喔是 worthwhile」是可以含糊帶過的。
 *
 * 首尾與非字母(連字號、撇號)直接給——它們是線索不是題目;其餘留空等他填。
 */
export function letterSlots(word: string): LetterSlot[] {
	const w = word.trim();
	return [...w].map((char, i) => ({
		char,
		editable:
			i !== 0 && i !== w.length - 1 && /[A-Za-z]/.test(char) && w.length > 2,
	}));
}

/** 使用者填的字母跟正確答案對不對得上(大小寫不計)。 */
export function slotsFilled(slots: LetterSlot[], typed: string[]): boolean {
	let k = 0;
	for (const slot of slots) {
		if (!slot.editable) continue;
		if ((typed[k] ?? "").toLowerCase() !== slot.char.toLowerCase()) return false;
		k++;
	}
	return true;
}


/**
 * 把使用者填在格子裡的字母,跟直接給的首尾組回一個完整的字。
 *
 * 沒填的格子留空——這樣 `v_brant` 看得出他漏了哪一格,比補一個底線好認。
 */
export function spellingAttempt(slots: LetterSlot[], typed: string[]): string {
	let k = 0;
	return slots
		.map((slot) => (slot.editable ? typed[k++] || " " : slot.char))
		.join("");
}

/** 訂正時逐格的比對結果。 */
export interface LetterDiff {
	/** 使用者填的(空白代表沒填) */
	typed: string;
	/** 正確答案 */
	answer: string;
	ok: boolean;
	/** 這一格本來就是給他的線索,不是他答的 */
	given: boolean;
}

/**
 * 逐個字母訂正。
 *
 * 道哥:「我輸入答案並按下 Enter 之後,系統並沒有告訴我答對或答錯。那我錯在哪裡?
 * 我原本輸入的答案在哪裡?」——**不記分不等於不訂正**。不記分是不要把學習變成
 * 計分遊戲;訂正則是學習本身,錯在哪一個字母是他最需要看到的東西。
 *
 * 長度以正確答案為準:填多了的部分丟掉,填少了的補空白。
 */
export function diffLetters(attempt: string, answer: string): LetterDiff[] {
	const a = [...attempt];
	return [...answer].map((char, i) => {
		const typed = a[i] ?? "";
		return {
			typed,
			answer: char,
			ok: typed.toLowerCase() === char.toLowerCase(),
			given: false,
		};
	});
}

/** 這次作答有沒有真的填過東西。完全沒填就不用訂正,他只是想直接看答案。 */
export function hasAttempt(typed: string[]): boolean {
	return typed.some((t) => t.trim());
}
