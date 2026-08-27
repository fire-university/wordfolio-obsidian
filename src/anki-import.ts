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
		return {
			word: word.toLowerCase(),
			definition: get("Word Definition") || undefined,
			sentence: get("Subtitle") || undefined,
			source: title ? `Language Reactor — ${title}` : "Language Reactor",
		};
	}

	if (modelName === SALADICT) {
		const word = get("Text");
		if (!isSingleWord(word)) return null;
		const title = get("Title");
		return {
			word: word.toLowerCase(),
			// Translation 欄刻意不用:那是整句機翻,不是這個字的意思。
			definition: undefined,
			sentence: get("Context") || undefined,
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
		if (!prev.sentence && item.sentence) prev.sentence = item.sentence;
		if (!prev.url && item.url) prev.url = item.url;
	}
	return [...byWord.values()];
}
