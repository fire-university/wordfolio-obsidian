// 詞庫與生詞本的共用型別。
// 詞庫的欄位命名刻意貼近 ECDICT 原始欄位，方便對照 build-dict.mjs 的轉換邏輯。

/** 一個詞條。由 tools/build-dict.mjs 從 ECDICT + ipa-dict 產出。 */
export interface DictEntry {
	/** 單字原形(小寫) */
	w: string;
	/** ECDICT 的 phonetic 欄，通常偏英式;英美兩套音標缺漏時當退路 */
	ph?: string;
	/** 英式 IPA(來自 ipa-dict en_UK) */
	uk?: string;
	/** 美式 IPA(來自 ipa-dict en_US) */
	us?: string;
	/** 繁中釋義(ECDICT translation 經 s2twp 轉換);以 \n 分行 */
	tr: string;
	/** 英英釋義(ECDICT definition);可選顯示 */
	def?: string;
	/** 詞性比例，如 "n:52/v:48" */
	pos?: string;
	/** 柯林斯星級 1–5 */
	collins?: number;
	/** 是否在牛津三千核心詞 */
	oxford?: boolean;
	/** 考試標籤，如 ["cet4","toefl"] */
	tag?: string[];
	/** BNC 詞頻排名(數字越小越常用) */
	bnc?: number;
	/** 當代語料庫詞頻排名 */
	frq?: number;
	/** 詞形變化原字串，如 "p:ran/d:run/i:running/3:runs" */
	exch?: string;
}

/** shard 檔的內容:單字 → 詞條 */
export type DictShard = Record<string, DictEntry>;

/** dict/meta.json */
export interface DictMeta {
	/** 詞庫版本(build 日期) */
	version: string;
	/** 詞條總數 */
	entries: number;
	/** 每個 shard 的檔名 → sha256，用來驗證下載完整性 */
	shards: Record<string, string>;
}

/** 查詢結果:詞條 + 是怎麼找到的 */
export interface Lookup {
	entry: DictEntry;
	/** 使用者滑過的原字(可能是變化形) */
	surface: string;
	/** 若經過詞形還原，記下是哪一種變化 */
	inflection?: InflectionKind;
}

/** ECDICT exchange 欄的變化類型 */
export type InflectionKind =
	| "past" // p: 過去式
	| "done" // d: 過去分詞
	| "ing" // i: 現在分詞
	| "third" // 3: 第三人稱單數
	| "plural" // s: 複數
	| "comparative" // r: 比較級
	| "superlative" // t: 最高級
	| "lemma"; // 0: 原形(反查用)

/** 生詞本裡一個字的複習狀態，對應 frontmatter 的 fsrs_* 欄位 */
export interface VocabCard {
	word: string;
	due: string; // YYYY-MM-DD
	stability: number;
	difficulty: number;
	reps: number;
	lapses: number;
	state: "new" | "learning" | "review" | "relearning";
	lastReview?: string;
}
