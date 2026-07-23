// 外掛設定。分四區:查詢(hover)、發音、生詞本、Claude。

import type { LangSetting } from "./i18n";

export type AudioSource = "online_first" | "system_only";
export type ClaudeModel = "claude-haiku-4-5-20251001" | "claude-sonnet-5";

export interface WordFolioSettings {
	// 介面語言:auto 跟 Obsidian、en、zh-TW
	language: LangSetting;

	// --- 查詢 ---
	// 游標停在英文字上就跳浮窗。關掉只剩快捷鍵/右鍵。
	hoverEnabled: boolean;
	// 停留多久才跳(ms)。太短會滑過去一路閃,太長會覺得慢。
	hoverDelay: number;
	// 浮窗要不要一併顯示英英釋義(ECDICT definition 欄)。
	showEnglishDefinition: boolean;

	// --- 發音 ---
	audioSource: AudioSource;

	// --- 生詞本 ---
	// vault 相對路徑;外掛只碰這個資料夾。
	vocabFolder: string;
	// 加入生詞本時要不要一併記下原句。
	captureSentence: boolean;

	// --- Claude(選用) ---
	// 注意:明文存在 data.json,vault 有同步就會跟著同步出去。設定頁必須講清楚。
	claudeApiKey: string;
	claudeModel: ClaudeModel;

	// --- 詞庫 ---
	// 已安裝的詞庫版本;空字串 = 尚未下載。
	dictVersion: string;
}

export const DEFAULT_SETTINGS: WordFolioSettings = {
	language: "auto",
	hoverEnabled: true,
	hoverDelay: 300,
	showEnglishDefinition: false,
	audioSource: "online_first",
	vocabFolder: "英文生詞本",
	captureSentence: true,
	claudeApiKey: "",
	claudeModel: "claude-haiku-4-5-20251001",
	dictVersion: "",
};

// 詞庫 shard 下載來源(GitHub Release)。build-dict.mjs 產出的檔案上傳到這裡。
export const DICT_RELEASE_BASE =
	"https://github.com/fire-university/wordfolio-obsidian/releases/download";

// 有道 dictvoice:免費、免 key、真人錄音。type=1 英式,type=2 美式。
export const DICTVOICE_ENDPOINT = "https://dict.youdao.com/dictvoice";
