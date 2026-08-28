// 外掛設定。分四區:查詢(hover)、發音、生詞本、Claude。

import type { LangSetting } from "./i18n";
import { ALL_SECTIONS, DEFAULT_ENABLED, type SectionId } from "./sections";

import type { IconMode } from "./tooltip";

export type AudioSource = "online_first" | "system_only";
export type TriggerMode = "hover" | "select" | "both";

export interface WordFolioSettings {
	// 介面語言:auto 跟 Obsidian、en、zh-TW
	language: LangSetting;

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
	vocabFolder: "英文生詞本",
	captureSentence: true,
	ankiDeck: "WordFolio",
	// 跟 Anki 的預設一樣。兩百多個字大約兩週消化完。
	newPerDay: 20,
	reviewAutoSpeak: true,
	llmEndpoint: "http://localhost:11434/v1",
	// 預設用 3b 而不是 7b:實測暖機後 3b 約 2 秒、7b 明顯更久。
	// 這幾個任務(挑義項、拆字根、造例句)不需要大模型,速度比較重要。
	// 想要更好的中文可以在設定的下拉選單改 7b。
	llmModel: "qwen2.5:3b",
	dictVersion: "",
};

// 詞庫 shard 下載來源(GitHub Release)。build-dict.mjs 產出的檔案上傳到這裡。
export const DICT_RELEASE_BASE =
	"https://github.com/fire-university/wordfolio-obsidian/releases/download";

// 有道 dictvoice:免費、免 key、真人錄音。type=1 英式,type=2 美式。
export const DICTVOICE_ENDPOINT = "https://dict.youdao.com/dictvoice";
