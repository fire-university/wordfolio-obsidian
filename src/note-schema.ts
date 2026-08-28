// 生詞筆記長什麼樣:frontmatter 的欄位名、本文的區塊標題,每種語言一份。
//
// **這個檔刻意不 import obsidian**(專案規則,見 anki-fields.ts 檔頭)。
//
// 為什麼要有這個檔:原本這些字串散在 vocab.ts(寫)、note-parse.ts(讀)、
// anki-fields.ts(轉 Anki)三個地方,而且全部寫死繁中——`音標_英:`、
// `## 我遇到它的地方`、`tags: [英文, 生詞]`。對英文使用者來說,那不是「介面
// 沒翻譯」,是**他自己 vault 裡的檔案長滿看不懂的字**,而且那些檔案會留一輩子。
//
// 兩條規則:
//
//   1. **寫的時候只用一種語言**(建立當下的介面語言)。
//   2. **讀的時候兩種都要認。** 語言是可以切換的,而已經寫好的筆記不會跟著變——
//      解析器只認一種的話,切一次語言就等於把舊筆記全部弄丟(畫面上是「清單
//      突然少了兩百篇」,不會有任何錯誤訊息)。所以下面每個欄位都有 alias 清單。

export type NoteLang = "en" | "zh-TW";

/** 一種語言的筆記用字。 */
export interface NoteSchema {
	/** frontmatter 的 type 值 */
	type: string;
	/** frontmatter 欄位名 */
	ukKey: string;
	usKey: string;
	freqKey: string;
	collinsKey: string;
	examKey: string;
	sourceKey: string;
	sourceUrlKey: string;
	tags: string[];
	/** 本文區塊標題(不含 `## `) */
	englishHeading: string;
	usageHeading: string;
	detailHeading: string;
	sentenceHeading: string;
	/** 變化形那一行:`**Forms**: a / b` 對 `**變化**：a / b` */
	formsLabel: string;
	/** 標籤與值之間的分隔符。中文用全形冒號。 */
	colon: string;
	/** 沒有指定來源時,那一行的抬頭 */
	sourceLabel: string;
	/** 複習紀錄檔的 type 與標題 */
	logType: string;
}

export const NOTE_SCHEMA: Record<NoteLang, NoteSchema> = {
	"zh-TW": {
		type: "生詞",
		ukKey: "音標_英",
		usKey: "音標_美",
		freqKey: "詞頻",
		collinsKey: "柯林斯",
		examKey: "考試",
		sourceKey: "來源",
		sourceUrlKey: "來源連結",
		tags: ["英文", "生詞"],
		englishHeading: "英英釋義",
		usageHeading: "例句與用法",
		detailHeading: "字詞詳解",
		sentenceHeading: "我遇到它的地方",
		formsLabel: "變化",
		colon: "：",
		sourceLabel: "來源",
		logType: "複習紀錄",
	},
	en: {
		type: "vocabulary",
		ukKey: "phonetic_uk",
		usKey: "phonetic_us",
		freqKey: "frequency",
		collinsKey: "collins",
		examKey: "exams",
		sourceKey: "source",
		sourceUrlKey: "source_url",
		tags: ["english", "vocabulary"],
		englishHeading: "Definitions",
		usageHeading: "Usage",
		detailHeading: "Word details",
		sentenceHeading: "Where I met it",
		formsLabel: "Forms",
		colon: ": ",
		sourceLabel: "Source",
		logType: "review log",
	},
};

export function schemaFor(lang: NoteLang): NoteSchema {
	return NOTE_SCHEMA[lang];
}

const LANGS: NoteLang[] = ["zh-TW", "en"];

/** 某個欄位在所有語言裡的寫法。讀筆記時全部都要認。 */
function aliases(pick: (s: NoteSchema) => string): string[] {
	return [...new Set(LANGS.map((l) => pick(NOTE_SCHEMA[l])))];
}

export const FRONTMATTER_ALIASES = {
	uk: aliases((s) => s.ukKey),
	us: aliases((s) => s.usKey),
	freq: aliases((s) => s.freqKey),
	collins: aliases((s) => s.collinsKey),
	exams: aliases((s) => s.examKey),
	source: aliases((s) => s.sourceKey),
	sourceUrl: aliases((s) => s.sourceUrlKey),
};

export const HEADING_ALIASES = {
	english: aliases((s) => s.englishHeading),
	usage: aliases((s) => s.usageHeading),
	detail: aliases((s) => s.detailHeading),
	sentence: aliases((s) => s.sentenceHeading),
};

/** `**變化**：a / b` 與 `**Forms**: a / b` 都要抓得到。 */
export const FORMS_LINE = new RegExp(
	`^\\*\\*(?:${aliases((s) => s.formsLabel).join("|")})\\*\\*[:：]\\s*(.+)$`,
	"m"
);

/** 這個標題是不是某個已知區塊(不分語言)。 */
export function headingIs(heading: string, kind: keyof typeof HEADING_ALIASES): boolean {
	return HEADING_ALIASES[kind].some((h) => h === heading.trim());
}
