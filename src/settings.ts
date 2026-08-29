// 外掛設定。分四區:查詢(hover)、發音、生詞本、Claude。

import type { LangSetting } from "./i18n";
import { ALL_SECTIONS, DEFAULT_ENABLED, type SectionId } from "./sections";

import type { IconMode } from "./tooltip";
import type { SpellingHint } from "./note-parse";

export type AudioSource = "online_first" | "system_only";
/**
 * 要哪一套發音。
 *
 * 學英式的人看美式音標、學美式的人看英式音標,都只是佔位置——道哥:「我就是
 * 美式發音的學習者,那英式發音對我來說就是佔一個版面,不需要。」
 */
export type AccentPref = "us" | "uk" | "both";
export type TriggerMode = "hover" | "select" | "both";

export interface WordFolioSettings {
	// 介面語言:auto 跟 Obsidian、en、zh-TW。管的是按鈕、標籤、設定頁那些「外框」。
	language: LangSetting;
	/**
	 * 釋義與生詞筆記的語言。auto = 跟介面語言走。
	 *
	 * **跟介面語言分開是必要的,不是多此一舉。** 道哥的 Obsidian 介面是英文,
	 * 但他要的是繁中釋義——外框的語言跟內容的語言本來就是兩件事,合成一個
	 * 設定就等於逼他二選一。已經存過設定的人一律遷移成 zh-TW,因為在這之前
	 * 內容永遠是中文的。
	 */
	contentLang: LangSetting;

	// --- 查詢 ---
	// 怎麼觸發查詢:hover(滑過去)/ select(選取放開)/ both。
	// select 模式下,選取多個字會查片語。
	triggerMode: TriggerMode;
	// 選取後那顆書本圖示怎麼展開浮窗:click(點一下)/ hover(停留)/ both。
	iconMode: IconMode;
	// 停留展開的秒數(ms)。
	iconDwell: number;
	// 游標停在英文字上就跳浮窗。關掉只剩快捷鍵/右鍵。
	// (保留給舊 data.json 遷移用;現以 triggerMode 為準。)
	hoverEnabled: boolean;
	// 停留多久才跳(ms)。太短會滑過去一路閃,太長會覺得慢。
	hoverDelay: number;
	// hover 打開的浮窗,游標離開多久才關(ms)。這是寬限期不是「顯示時間」——
	// 期間滑回浮窗就會取消關閉。選取打開的浮窗是 sticky,不受這個影響。
	closeDelay: number;
	// --- 浮窗顯示什麼(沙拉查詞那套:每種內容一個區塊,可勾選可排序) ---
	// 存字串陣列而不是 SectionId[],因為使用者的 data.json 可能是舊版本寫的,
	// 讀進來一律經過 normalizeOrder 正規化。
	sectionOrder: string[];
	sectionsEnabled: Partial<Record<SectionId, boolean>>;

	// --- 發音 ---
	audioSource: AudioSource;
	// 顯示與播放哪一套口音。影響浮窗、複習卡的音標按鈕與所有自動發音。
	accent: AccentPref;

	/**
	 * 音標旁邊畫一條發音波形。
	 *
	 * 看得到的不只是「多大聲」,還有**重音落在哪一個音節**。只畫已經抓過的字
	 * (磁碟上有音檔),不會為了畫線而額外連網。
	 */
	showWaveform: boolean;
	/**
	 * 播放時把各個字的音量拉齊。
	 *
	 * 有道的錄音音量很不一致——實測 81 個快取檔,人聲 RMS 差了 11.6 dB,
	 * 大約四倍響度。有的字要湊近喇叭、有的嚇一跳。
	 */
	normalizeVolume: boolean;
	/**
	 * 浮窗一開就先去抓發音,好讓波形一直都在。
	 *
	 * **預設關閉,而且要一直是關的。** hover 是不自覺的高頻動作——讀一篇文章滑過
	 * 幾十個字就是幾十個請求送到有道,那是把使用者查的字送出電腦,而他只是把
	 * 滑鼠移過去而已。想要「波形永遠都在」的人自己開。
	 */
	prefetchAudio: boolean;

	// --- 生詞本 ---
	// vault 相對路徑;外掛只碰這個資料夾。
	vocabFolder: string;
	// 加入生詞本時要不要一併記下原句。
	captureSentence: boolean;
	// 推進 Anki 時用哪個牌組(不存在會自動建)。
	ankiDeck: string;
	// 每次複習最多放幾個沒看過的新字進來。0 = 這陣子只複習舊字。
	// 從 Anki 匯入之後生詞本會一次多兩百多個新字,不限量的話打開複習就是
	// 兩百多張等著——那不會被複習完,只會被關掉。
	newPerDay: number;
	// 複習翻到答案面時自動念一次。一次複習幾十張,每張都手動點會懶得點。
	reviewAutoSpeak: boolean;
	// 問題卡一出現就先念一次。**這等於先把讀音告訴你**,對練聽力有幫助,
	// 但也讓「想不想得起來」變簡單,所以做成可關的。
	reviewSpeakFront: boolean;
	/**
	 * 拼寫練習先給哪幾個字母。
	 *
	 * 首尾給出來原本是寫死的。**給越少越難**,`none` 等於從填空變成默寫。
	 * 預設維持 both,不要因為加了設定就把既有使用者的難度悄悄調高。
	 */
	spellingHint: SpellingHint;

	// --- 本地 AI(選用) ---
	// OpenAI 相容端點(預設 Ollama)。不用 API key、不把查的字送出電腦。
	llmEndpoint: string;
	llmModel: string;

	// 一次性遷移的標記。改預設值救不了已經存過設定的人——他們的 data.json
	// 裡是舊值。加了劍橋之後,AI 那三樣要真的關掉才看得到改善,所以需要這個。
	migratedCambridge?: boolean;

	// --- 詞庫 ---
	// 已安裝的詞庫版本;空字串 = 尚未下載。
	dictVersion: string;
}

export const DEFAULT_SETTINGS: WordFolioSettings = {
	language: "auto",
	contentLang: "auto",
	triggerMode: "hover",
	iconMode: "both",
	iconDwell: 1000,
	hoverEnabled: true,
	hoverDelay: 300,
	// 400ms 加上浮窗周圍的安全區,一般速度的滑鼠移動都來得及滑進去。
	closeDelay: 400,
	sectionOrder: [...ALL_SECTIONS],
	sectionsEnabled: { ...DEFAULT_ENABLED },
	audioSource: "online_first",
	// 預設兩套都給:不知道使用者學哪一種之前,少給不如多給。
	accent: "both",
	showWaveform: true,
	normalizeVolume: true,
	prefetchAudio: false,
	vocabFolder: "英文生詞本",
	captureSentence: true,
	ankiDeck: "WordFolio",
	// 跟 Anki 的預設一樣。兩百多個字大約兩週消化完。
	newPerDay: 20,
	reviewAutoSpeak: true,
	reviewSpeakFront: true,
	spellingHint: "both",
	llmEndpoint: "http://localhost:11434/v1",
	// 預設用 3b 而不是 7b:實測暖機後 3b 約 2 秒、7b 明顯更久。
	// 這幾個任務(挑義項、拆字根、造例句)不需要大模型,速度比較重要。
	// 想要更好的中文可以在設定的下拉選單改 7b。
	llmModel: "qwen2.5:3b",
	dictVersion: "",
};

/**
 * 讀進來的 data.json 該用哪個釋義語言。
 *
 * 抽成純函式是因為這條規則錯了會很難發現:既有使用者突然拿到英文釋義、新的
 * 生詞筆記用英文格式寫,而他既有的兩百多篇是中文格式——畫面上不會報錯。
 *
 *   - 沒有 data.json(全新安裝)→ auto,跟介面語言走
 *   - 有 data.json 但沒有 contentLang(這個欄位之前不存在)→ zh-TW,
 *     因為在這個欄位出現之前,內容永遠是繁中的
 *   - 已經有 contentLang → 尊重他選的
 */
export function migrateContentLang(saved: Partial<WordFolioSettings> | null): LangSetting {
	if (!saved) return "auto";
	return saved.contentLang ?? "zh-TW";
}

// 詞庫 shard 下載來源(GitHub Release)。build-dict.mjs 產出的檔案上傳到這裡。
export const DICT_RELEASE_BASE =
	"https://github.com/fire-university/wordfolio-obsidian/releases/download";

/**
 * 這一版外掛要用哪個詞庫。對應 Release 的 `dict-<版本>` 標籤。
 *
 * 綁死在程式碼裡,不去問遠端「有沒有更新的」:詞庫的欄位跟解析它的程式是一起
 * 演進的,讓執行期自己撿最新版等於允許新資料配舊解析器。要換詞庫就發一版外掛。
 *
 * 下面三個常數必須跟 `dict/meta.json` 一致,`npm test` 的 dict-check 會擋。
 */
export const DICT_VERSION = "2026-08-28";
/** 詞條數,只拿來在安裝引導裡顯示。 */
export const DICT_ENTRIES = 58250;
/** 全部檔案加起來多少 bytes,拿來在下載前先告訴使用者要花多少流量。 */
export const DICT_BYTES = 40_416_408;

/**
 * 贊助連結。也寫在 manifest.json 的 fundingUrl,Obsidian 會在外掛頁顯示。
 * 兩邊要一致——設定頁的按鈕跟外掛頁的連結指到不同地方會很怪。
 */
export const FUNDING_URL = "https://buymeacoffee.com/firetw";

// 有道 dictvoice:免費、免 key、真人錄音。type=1 英式,type=2 美式。
export const DICTVOICE_ENDPOINT = "https://dict.youdao.com/dictvoice";
