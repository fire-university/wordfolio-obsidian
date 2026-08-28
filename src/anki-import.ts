// Anki → 生詞本:把瀏覽器工具存進 Anki 的字轉成匯入用的結構。
//
// **這個檔刻意不 import obsidian**(專案規則,見 anki-fields.ts 檔頭):純字串處理
// 拆出來才測得到。真正打 AnkiConnect 的那半在 anki.ts。
//
// 為什麼需要這個方向:道哥的字散在四個地方——Obsidian 生詞本 10 個、Anki 裡的
// Language Reactor 152 個、Saladict 101 個、Wordwise 11 個。他說「看不到全部的
// 單字」,字面上就是真的:九成以上的字根本不在 Obsidian 裡。先把字接進來,
// 清單視圖才有東西可看。
//
// 每個來源的欄位品質差很多,所以一個來源一條轉換規則:
//
//   Language Reactor - Word  Lemma 已經還原好、Word Definition 是繁中詞義,
//                            幾乎是現成的生詞筆記。
//   Saladict Word            Text 是查的字、Context 是原句,但 Translation 欄
//                            是整句機翻(google/deepl)**不是詞義**,不能當釋義用
//                            ——那一欄直接丟掉,釋義改由離線詞庫補。

/** 一筆從 Anki 撈回來、還沒寫成筆記的字。 */
export interface ImportedWord {
	/** 單字(Language Reactor 用已還原的 Lemma) */
	word: string;
	/** 來源自帶的繁中詞義;沒有就等離線詞庫補 */
	definition?: string;
	/** 遇到這個字的原句 */
	sentence?: string;
	/** 那一句的中文翻譯(來源有給才有) */
	sentenceTranslation?: string;
	/** 來源名稱,寫進筆記的 frontmatter */
	source?: string;
	/** 原始出處連結(Saladict 有) */
	url?: string;
}

/** 支援匯入的 Anki 筆記類型。不在這份清單裡的一律跳過。 */
export const LANGUAGE_REACTOR = "Language Reactor - Word";
export const SALADICT = "Saladict Word";
export const IMPORT_MODELS = [LANGUAGE_REACTOR, SALADICT];

const ENTITIES: Record<string, string> = {
	"&amp;": "&",
	"&lt;": "<",
	"&gt;": ">",
	"&quot;": '"',
	"&#39;": "'",
	"&nbsp;": " ",
};

/**
 * Anki 欄位是 HTML。抽成純文字:<br> 當空格、標籤拿掉、實體還原、
 * `[sound:xxx.mp3]` 這種 Anki 媒體標記也一併去掉。
 */
export function stripHtml(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, " ")
		.replace(/<\/(p|div|li)>/gi, " ")
		.replace(/<[^>]*>/g, "")
		.replace(/\[sound:[^\]]*\]/gi, "")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
		.replace(/&[a-z]+;|&#\d+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m)
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * 一組常見簡化字,用來認出簡體譯文。
 *
 * Saladict 一次存三個引擎的譯文(google / deepl / …),**其中往往有簡體**——
 * 而「繁體」正是做 WordFolio 的理由之一(ADR-9),挑錯就把它還回去了。
 * 不做完整的簡繁轉換(那要 opencc,執行期不值得背這個包),只要能在三個候選
 * 之間分出高下就夠。
 */
const SIMPLIFIED = new Set(
	"们这个说时会来国对开经无产头难过应从后动务学实见证张边里机东车马长门问题间样点儿两业内书买卖发号台叶电话语汉义节约级纪线组织统计划则测试认识风飞习乡画笔结给练细终绿维绍继续届层属岁帮带担单图团园圆坏欢环极乐丽灵刘龙楼罗吗满庙灭亩恼脑闹宁农盘辟苹凭扑仆朴启弃气迁签墙桥窃寝庆穷区权劝却让扰热荣软洒伞丧扫涩杀晒陕伤烧摄绅审声胜湿"
);

function simplifiedScore(text: string): number {
	let n = 0;
	for (const c of text) if (SIMPLIFIED.has(c)) n++;
	return n;
}

const hasChinese = (s: string) => /[\u4e00-\u9fff]/.test(s);

/**
 * 從 Saladict 的 Translation 欄挑一個繁體譯文。
 *
 * 那一欄是三個引擎的結果串在一起:
 *   <span class="trans_title">google</span><div class="trans_content">譯文</div>…
 *
 * 挑選順序:先認 google(實測它跟著 Saladict 的 zh-TW 設定給繁體),
 * 不然挑簡化字最少的,再平手就取第一個。
 */
export function pickTranslation(html: string): string | undefined {
	const pairs: { engine: string; text: string }[] = [];
	const re = /<span class="trans_title">(.*?)<\/span>\s*<div class="trans_content">(.*?)<\/div>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const text = stripHtml(m[2]);
		if (hasChinese(text)) pairs.push({ engine: stripHtml(m[1]).toLowerCase(), text });
	}
	// 沒有引擎標記時退回單純抓內容。
	if (!pairs.length) {
		for (const c of html.matchAll(/<div class="trans_content">(.*?)<\/div>/g)) {
			const text = stripHtml(c[1]);
			if (hasChinese(text)) pairs.push({ engine: "", text });
		}
	}
	if (!pairs.length) return undefined;

	const google = pairs.find((p) => p.engine === "google");
	if (google) return google.text;
	return pairs.reduce((best, p) =>
		simplifiedScore(p.text) < simplifiedScore(best.text) ? p : best
	).text;
}

/**
 * 是不是一個值得匯入的英文單字。
 *
 * Saladict 存的 `Text` 常常是片語甚至整句(實測 101 筆裡有 12 筆:`risk tolerance`、
 * `wears off.`)。生詞本是一個字一篇筆記,片語進來只會變成查不到釋義的空殼,
 * 所以在這裡就擋掉並回報數量,不要靜靜吞掉。
 */
export function isSingleWord(text: string): boolean {
	return /^[A-Za-z][A-Za-z'’-]{1,}$/.test(text.trim());
}

/** 一筆 Anki 筆記 → ImportedWord。看不懂的類型或不是單字就回 null。 */
export function fromAnkiNote(
	modelName: string,
	fields: Record<string, string>
): ImportedWord | null {
	const get = (k: string) => stripHtml(fields[k] ?? "");

	if (modelName === LANGUAGE_REACTOR) {
		// Lemma 是 Language Reactor 自己還原好的原形,優先用它;實測 152 筆全都有值。
		const word = get("Lemma") || get("Word");
		if (!isSingleWord(word)) return null;
		const title = get("Item Title");
		const sentence = get("Subtitle") || undefined;
		// Translation 欄不一定是中文:影片本身沒有中文字幕時,它會等於英文原句
		// (實測 152 筆裡有 28 筆是這樣)。要檢查真的有中文才收。
		const translated = get("Translation");
		return {
			word: word.toLowerCase(),
			definition: get("Word Definition") || undefined,
			sentence,
			sentenceTranslation:
				translated && hasChinese(translated) && translated !== sentence
					? translated
					: undefined,
			source: title ? `Language Reactor — ${title}` : "Language Reactor",
		};
	}

	if (modelName === SALADICT) {
		const word = get("Text");
		if (!isSingleWord(word)) return null;
		const title = get("Title");
		return {
			word: word.toLowerCase(),
			// Translation 欄不能當釋義:那是**整句**機翻,不是這個字的意思。
			// 但它正好是那一句的中譯,拿來當複習卡的線索剛好。
			definition: undefined,
			sentence: get("Context") || undefined,
			sentenceTranslation: pickTranslation(fields["Translation"] ?? ""),
			source: title ? `Saladict — ${title}` : "Saladict",
			url: fields["Url"]?.trim() || undefined,
		};
	}

	return null;
}

/**
 * 同一個字在多個來源都出現時合併成一筆。
 *
 * 挑選規則:有釋義的優先(Language Reactor 帶繁中詞義,Saladict 沒有),
 * 原句則取第一個非空的——兩邊都有的話留先遇到的那句就好,生詞筆記本來就
 * 支援之後再追加。
 */
export function mergeImported(items: ImportedWord[]): ImportedWord[] {
	const byWord = new Map<string, ImportedWord>();
	for (const item of items) {
		const key = item.word.toLowerCase();
		const prev = byWord.get(key);
		if (!prev) {
			byWord.set(key, { ...item });
			continue;
		}
		if (!prev.definition && item.definition) prev.definition = item.definition;
		if (!prev.sentence && item.sentence) {
			prev.sentence = item.sentence;
			prev.sentenceTranslation = item.sentenceTranslation;
		}
		if (!prev.url && item.url) prev.url = item.url;
	}
	return [...byWord.values()];
}
