// Kobo → 生詞本:把 Kobo 內建字典查過的字轉成匯入用的結構。
//
// **這個檔刻意不 import obsidian**(專案規則,見 anki-fields.ts 檔頭):純字串處理
// 拆出來才測得到。讀檔那半在 main.ts。
//
// 字怎麼來的:PaperFolio 同步時把 Kobo 的 WordList 寫成一份 JSON 交接檔。
// (Kobo 上要先打開 My Words:更多 > Beta 功能 > My Words,否則那張表是空的。)
//
// 跟 Anki 那條路的差別:**Kobo 自己不存原句**,WordList 只有單字、來源書、時間。
// PaperFolio 會在插著 USB(或有 Kobo Desktop 書檔)時回頭到書裡把那一句撈出來,
// 撈得到就在 `sentence` 欄;純無線同步、或加密的商店書就沒有,那時筆記的
// 「我遇到它的地方」會是空的,等下次插線同步再補。

import { isSingleWord, type ImportedWord } from "./anki-import";

/** 沒設路徑、也問不到 PaperFolio 時的預設(PaperFolio 的預設輸出資料夾)。 */
export const DEFAULT_KOBO_WORDS_PATH = "PaperFolio/.kobo-words.json";
/** PaperFolio 的設定檔:用來自動找出它把單字寫到哪。 */
export const PAPERFOLIO_DATA_PATH =
	".obsidian/plugins/paperfolio-kobo/data.json";
const WORDLIST_FILENAME = ".kobo-words.json";
/**
 * PaperFolio 同步完成、交接檔有新字時發的事件名。
 *
 * Obsidian 沒有官方的跨外掛事件匯流排,但 `workspace` 本身就是一個 Events,
 * 兩邊約好同一個字串就能通。收不到也不會壞:使用者仍然可以自己按匯入
 * (PaperFolio 版本比較舊的人就是這個情況)。
 */
export const PAPERFOLIO_SYNC_EVENT = "paperfolio:words-synced";

/** 交接檔裡的一筆。除了 text 以外都可能沒有。 */
export interface KoboWordEntry {
	text: string;
	book?: string;
	dict?: string;
	date?: string;
	/** 書裡包含這個字的那一句(PaperFolio 撈得到才有) */
	sentence?: string;
}

export interface KoboParseResult {
	items: ImportedWord[];
	/** 不是單字所以跳過的筆數(中文書查的詞、片語) */
	ignored: number;
}

/**
 * 交接檔 → 待匯入的字。
 *
 * 中文書上查的詞也會存進同一張 WordList,但生詞本是英文的,`isSingleWord`
 * 會把它們擋在外面並計入 ignored——**不要靜靜吞掉**,數量要報給使用者看。
 */
export function fromKoboFile(text: string): KoboParseResult {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (e) {
		console.warn("WordFolio: .kobo-words.json unreadable", e);
		return { items: [], ignored: 0 };
	}
	const words = (raw as { words?: unknown })?.words;
	if (!Array.isArray(words)) return { items: [], ignored: 0 };

	const items: ImportedWord[] = [];
	let ignored = 0;
	for (const w of words as KoboWordEntry[]) {
		const word = typeof w?.text === "string" ? w.text.trim() : "";
		if (!isSingleWord(word)) {
			if (word) ignored++;
			continue;
		}
		const book = (w.book ?? "").trim();
		const sentence = typeof w.sentence === "string" ? w.sentence.trim() : "";
		items.push({
			word: word.toLowerCase(),
			// 釋義留空:交給離線詞庫補繁體釋義與音標,不要用 Kobo 字典的內容。
			definition: undefined,
			sentence: sentence || undefined,
			source: book ? `Kobo — ${book}` : "Kobo",
		});
	}
	return { items, ignored };
}

/**
 * 從 PaperFolio 的 data.json 推出它把單字寫到哪。
 *
 * 兩個外掛裝在同一個 vault,路徑讓使用者在兩邊各填一次只會填錯;
 * 直接問對方的設定比較不會出事。問不到就回 null,呼叫端退回預設值。
 */
export function pathFromPaperFolioData(text: string): string | null {
	try {
		const data = JSON.parse(text) as {
			settings?: { wordListPath?: string; outputFolder?: string };
		};
		const s = data?.settings;
		if (!s) return null;
		const explicit = (s.wordListPath ?? "").trim();
		if (explicit) return explicit;
		const folder = (s.outputFolder ?? "").trim();
		return folder ? `${folder}/${WORDLIST_FILENAME}` : null;
	} catch (e) {
		return null;
	}
}
