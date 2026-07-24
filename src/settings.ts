// 外掛設定。分四區:查詢(hover)、發音、生詞本、Claude。

import type { LangSetting } from "./i18n";
import type { DismissMode } from "./hover";
import { ALL_SECTIONS, DEFAULT_ENABLED, type SectionId } from "./sections";

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
	// 浮窗怎麼關:移開就關(有寬限期) / 點浮窗外面才關。
	dismissMode: DismissMode;
	// 離開浮窗多久才真的關(ms,僅 delay 模式)。
	// 這是寬限期不是「顯示時間」——期間滑回浮窗就會取消關閉。
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
	dismissMode: "delay",
	// 400ms 加上浮窗周圍的安全區,一般速度的滑鼠移動都來得及滑進去。
	closeDelay: 400,
	sectionOrder: [...ALL_SECTIONS],
	sectionsEnabled: { ...DEFAULT_ENABLED },
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
