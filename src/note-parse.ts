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

const SENTENCE_HEADING = "## 我遇到它的地方";
const ENGLISH_HEADING = "英英釋義";

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
	/** 「我遇到它的地方」底下的原句 */
	sentences: string[];
	/** 匯入來源 */
	source?: string;
	/** 其他區塊(字詞詳解、例句與用法…),原樣帶著標題 */
	extras: { heading: string; body: string }[];
}

/** frontmatter 的單行值。yamlString 寫出來的雙引號字串要脫掉引號與跳脫。 */
function frontmatterValue(front: string, key: string): string | undefined {
	const m = front.match(new RegExp(`^${key}:\\s*(.*)$`, "m"));
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
		ukPhonetic: frontmatterValue(front, "音標_英"),
		usPhonetic: frontmatterValue(front, "音標_美"),
		meaning: [],
		english: [],
		forms: [],
		sentences: [],
		source: frontmatterValue(front, "來源"),
		extras: [],
	};

	// 變化形那一行不一定在哪:renderNote 是把它接在「英英釋義」區塊**後面**,
	// 所以不能只在第一段裡找。全文抓一次。
	const formLine = body.match(/^\*\*變化\*\*：(.+)$/m);
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
		if (/^\*\*變化\*\*：/.test(t)) continue; // 上面已經抓過了
		out.meaning.push(t.replace(/\*\*/g, ""));
	}

	for (const chunk of chunks) {
		const nl = chunk.indexOf("\n");
		const heading = (nl < 0 ? chunk : chunk.slice(0, nl)).trim();
		const rest = nl < 0 ? "" : chunk.slice(nl + 1);

		if (heading === ENGLISH_HEADING) {
			out.english = rest
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.startsWith("-"))
				.map((l) => l.replace(/^-\s*/, ""));
			continue;
		}
		if (SENTENCE_HEADING.endsWith(heading)) {
			out.sentences = rest
				.split("\n")
				.map((l) => l.trim())
				.filter((l) => l.startsWith(">"))
				.map((l) => l.replace(/^>\s*/, ""))
				.filter(Boolean);
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
