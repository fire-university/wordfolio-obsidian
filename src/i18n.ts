// 輕量 i18n:一個 t(key) + en / zh-TW 兩份字典。無官方框架，自建。
// 語言由設定決定:auto = 跟 Obsidian 顯示語言走;否則用指定語言。預設 fallback 英文。
// 純模組:不依賴任何瀏覽器 API,語系碼由呼叫端傳入,node 測試可直接跑。
// (實作沿用 PaperFolio 的同名模組,只換字串字典。)

export type LangSetting = "auto" | "en" | "zh-TW";
type Lang = "en" | "zh-TW";

let current: Lang = "en";

// setting 為 auto 時，依呼叫端提供的語系碼決定(由 main.ts 用 Obsidian 官方 API 取得)。
export function resolveLang(setting: LangSetting, locale = ""): Lang {
	if (setting === "en" || setting === "zh-TW") return setting;
	return locale.toLowerCase().startsWith("zh") ? "zh-TW" : "en";
}

export function setLang(setting: LangSetting, locale = ""): void {
	current = resolveLang(setting, locale);
}

export function currentLang(): Lang {
	return current;
}

function interpolate(s: string, params?: Record<string, string | number>): string {
	if (!params) return s;
	let out = s;
	for (const k of Object.keys(params)) {
		out = out.replace(new RegExp("\\{" + k + "\\}", "g"), String(params[k]));
	}
	return out;
}

export function t(key: string, params?: Record<string, string | number>): string {
	const dict = STRINGS[current] || STRINGS.en;
	const s = dict[key] ?? STRINGS.en[key] ?? key;
	return interpolate(s, params);
}

type Dict = Record<string, string>;

const EN: Dict = {
	// 命令 / 圖示
	ribbon_tooltip: "WordFolio: review vocabulary ({due} due)",
	ribbon_tooltip_empty: "WordFolio: nothing due today",
	command_lookup: "Look up the selected word",
	command_review: "Start vocabulary review",
	command_download_dict: "Download / update the offline dictionary",

	// 詞庫
	notice_dict_missing:
		"WordFolio: the offline dictionary is not installed yet.\nRun \"Download / update the offline dictionary\" from the command palette.",
	notice_dict_downloading: "WordFolio: downloading the offline dictionary…",
	notice_dict_ready: "WordFolio: dictionary ready ({entries} entries).",
	notice_dict_failed: "WordFolio: dictionary download failed.\n{err}",
	notice_not_found: "WordFolio: \"{word}\" is not in the dictionary.",

	// 浮窗
	tooltip_add: "Add to vocabulary notebook",
	tooltip_added: "In your vocabulary notebook",
	tooltip_ask_claude: "What does it mean here?",
	tooltip_usage: "Examples and usage",
	tooltip_asking: "Asking Claude…",
	tooltip_inflection_of: "form of {lemma}",
	tooltip_forms: "Forms",
	label_uk: "UK",
	label_us: "US",

	// 生詞本
	notice_vocab_added: "WordFolio: \"{word}\" added to your notebook.",
	notice_vocab_exists: "WordFolio: \"{word}\" is already in your notebook.",

	// 複習
	review_show_answer: "Show answer",
	review_again: "Again",
	review_hard: "Hard",
	review_good: "Good",
	review_easy: "Easy",
	review_done: "WordFolio: review finished — {count} cards.",
	review_nothing_due: "WordFolio: nothing due today.",

	// 設定
	set_language_name: "Language",
	set_language_desc: "Interface language. Auto follows Obsidian.",
	lang_auto: "Auto",
	heading_lookup: "Lookup",
	set_trigger_name: "How to look up",
	set_trigger_desc:
		"Hover: rest the pointer on a word and the tooltip appears, then fades when you move away. Select: highlight a word or phrase and a small icon appears — click it to open the tooltip, which stays until you click elsewhere. Select is how you look up phrases like \"give up\".",
	trigger_hover: "Hover over a word",
	trigger_select: "Select a word or phrase",
	trigger_both: "Both",
	set_hover_delay_name: "Hover delay",
	set_hover_delay_desc: "Milliseconds to wait before the tooltip appears.",
	set_close_delay_name: "Grace period (hover)",
	set_close_delay_desc:
		"For hover tooltips: how long it waits after the pointer leaves before closing. Moving back onto it cancels the close. Tooltips opened from a selection ignore this — they stay until you click away.",
	set_icon_mode_name: "Opening the selection icon",
	set_icon_mode_desc:
		"After you select text, a small book icon appears. Choose how it opens the tooltip: click it, rest on it, or either.",
	icon_click: "Click the icon",
	icon_hover: "Rest on the icon",
	icon_both: "Either (click or rest)",
	set_icon_dwell_name: "Rest delay (icon)",
	set_icon_dwell_desc: "How long to rest on the book icon before the tooltip opens.",
	heading_sections: "What the tooltip shows",
	sections_desc:
		"Turn parts on or off and reorder them. A part that has no data for a word simply doesn't appear.",
	section_phonetics: "Phonetics and pronunciation",
	section_phonetics_desc: "UK and US IPA with playable audio.",
	section_translation: "Chinese definition",
	section_translation_desc: "Traditional Chinese, from the offline dictionary.",
	section_english: "English definition",
	section_english_desc:
		"WordNet glosses. Available for about 80% of entries and often more detailed than the Chinese line.",
	section_surface: "Sense of the inflected form",
	section_surface_desc:
		"Shown only when the form you hovered means something different from its base word.",
	section_frequency: "Frequency and grading",
	section_frequency_desc: "Collins stars, Oxford 3000, BNC and COCA ranks.",
	section_exams: "Exam tags",
	section_exams_desc: "CET, TOEFL, GRE and so on. Useful when studying for a test, noise otherwise.",
	section_forms: "Inflected forms",
	section_forms_desc: "Plural, past tense, -ing form and the rest.",
	section_claude: "Ask Claude",
	section_claude_desc: "The button that explains the word in the sentence you are reading.",
	section_usage: "Examples and usage (Claude)",
	section_usage_desc:
		"Example sentences, common collocations and near-synonym notes — the three things the offline dictionary does not have. Costs tokens per word, so it is off by default; whatever you generate is saved into the word's note.",
	section_move_up: "Move up",
	section_move_down: "Move down",

	heading_audio: "Pronunciation",
	set_audio_source_name: "Audio source",
	set_audio_source_desc:
		"Online recordings sound better; the system voice always works offline. Downloaded audio is cached, so a word you have heard once stays available offline.",
	audio_online_first: "Online recording, fall back to system voice",
	audio_system_only: "System voice only (fully offline)",
	heading_vocab: "Vocabulary notebook",
	set_vocab_folder_name: "Notebook folder",
	set_vocab_folder_desc:
		"One note per word is written here; the plugin only ever touches this folder.",
	heading_claude: "Claude (optional)",
	set_claude_key_name: "Anthropic API key",
	set_claude_key_desc:
		"Only used when you press \"What does it mean here?\". Leave empty to disable. Stored in plain text in this plugin's data.json — if your vault syncs (iCloud, Dropbox, Git), the key syncs with it.",
	set_claude_model_name: "Model",
	set_claude_model_desc: "Haiku is fast and cheap; Sonnet writes better explanations.",
};

const ZH: Dict = {
	// 命令 / 圖示
	ribbon_tooltip: "WordFolio:複習生詞(今天 {due} 個)",
	ribbon_tooltip_empty: "WordFolio:今天沒有要複習的",
	command_lookup: "查詢選取的單字",
	command_review: "開始複習生詞",
	command_download_dict: "下載／更新離線詞庫",

	// 詞庫
	notice_dict_missing:
		"WordFolio:離線詞庫還沒安裝。\n請從命令面板執行「下載／更新離線詞庫」。",
	notice_dict_downloading: "WordFolio:正在下載離線詞庫…",
	notice_dict_ready: "WordFolio:詞庫就緒(共 {entries} 個詞條)。",
	notice_dict_failed: "WordFolio:詞庫下載失敗。\n{err}",
	notice_not_found: "WordFolio:詞庫裡沒有「{word}」。",

	// 浮窗
	tooltip_add: "加入生詞本",
	tooltip_added: "已在生詞本裡",
	tooltip_ask_claude: "在這句話裡是什麼意思",
	tooltip_usage: "例句與用法",
	tooltip_asking: "問 Claude 中…",
	tooltip_inflection_of: "{lemma} 的變化形",
	tooltip_forms: "變化",
	label_uk: "英",
	label_us: "美",

	// 生詞本
	notice_vocab_added: "WordFolio:「{word}」已加入生詞本。",
	notice_vocab_exists: "WordFolio:「{word}」已經在生詞本裡了。",

	// 複習
	review_show_answer: "看答案",
	review_again: "重來",
	review_hard: "有點難",
	review_good: "記得",
	review_easy: "太簡單",
	review_done: "WordFolio:複習完成,共 {count} 張。",
	review_nothing_due: "WordFolio:今天沒有要複習的。",

	// 設定
	set_language_name: "語言",
	set_language_desc: "介面語言。自動 = 跟著 Obsidian 走。",
	lang_auto: "自動",
	heading_lookup: "查詢",
	set_trigger_name: "怎麼觸發查詢",
	set_trigger_desc:
		"「滑過去」:游標停在單字上就跳浮窗,移開就淡出。「選取」:把單字或片語框起來,旁邊會浮現一個小圖示,點它才開浮窗,而且會一直留著,直到你點框外才關。查 give up 這種片語就是用選取。",
	trigger_hover: "滑過單字",
	trigger_select: "選取單字或片語",
	trigger_both: "兩者都要",
	set_hover_delay_name: "浮窗延遲",
	set_hover_delay_desc: "游標停留幾毫秒後才跳浮窗。",
	set_close_delay_name: "寬限期（滑過去模式）",
	set_close_delay_desc:
		"只影響滑過去打開的浮窗:游標離開後等多久才關,期間滑回浮窗就取消。選取打開的浮窗不受這個影響——它會一直留著,直到你點框外。",
	set_icon_mode_name: "選取圖示怎麼展開",
	set_icon_mode_desc:
		"選字之後會浮現一顆小書本圖示。選它怎麼展開浮窗:點一下、把滑鼠停在上面、或兩者都行。",
	icon_click: "點一下圖示",
	icon_hover: "滑鼠停在圖示上",
	icon_both: "兩者都行（點或停留）",
	set_icon_dwell_name: "停留秒數（圖示）",
	set_icon_dwell_desc: "滑鼠停在書本圖示上多久,浮窗就自動展開。",
	heading_sections: "浮窗顯示什麼",
	sections_desc: "勾選要顯示的內容並調整順序。某個字沒有那項資料時,該區塊自己不會出現。",
	section_phonetics: "音標與發音",
	section_phonetics_desc: "英式與美式 IPA,可點喇叭發音。",
	section_translation: "中文釋義",
	section_translation_desc: "繁體中文,來自離線詞庫。",
	section_english: "英英釋義",
	section_english_desc:
		"WordNet 的英文解釋。約八成詞條有,而且常常比中文那一行細——leverage 的中文只有「槓桿作用」,英英分了槓桿原理／策略優勢／融資操作三個義項。",
	section_surface: "變化形的獨立語意",
	section_surface_desc: "只有在你滑到的變化形跟原形意思不同時才出現(例:running 當名詞的「賽跑」)。",
	section_frequency: "詞頻與分級",
	section_frequency_desc: "柯林斯星級、Oxford 3000、BNC 與 COCA 排名。",
	section_exams: "考試標籤",
	section_exams_desc: "CET、TOEFL、GRE 之類。準備考試時有用,一般閱讀是雜訊。",
	section_forms: "變化形",
	section_forms_desc: "複數、過去式、現在分詞等。",
	section_claude: "問 Claude",
	section_claude_desc: "那顆「在這句話裡是什麼意思」的按鈕。",
	section_usage: "例句與用法（Claude）",
	section_usage_desc:
		"例句、常見搭配、近義詞辨析——離線詞庫沒有的三樣。每個字要花 token,所以預設關閉;生成過的內容加進生詞本時會一起寫進筆記,不用再花第二次。",
	section_move_up: "往上移",
	section_move_down: "往下移",

	heading_audio: "發音",
	set_audio_source_name: "發音來源",
	set_audio_source_desc:
		"線上真人錄音比較好聽,系統語音則是永遠都能用。抓過的音檔會快取,所以聽過一次的字之後離線也聽得到。",
	audio_online_first: "線上真人錄音,失敗時用系統語音",
	audio_system_only: "只用系統語音(完全離線)",
	heading_vocab: "生詞本",
	set_vocab_folder_name: "生詞本資料夾",
	set_vocab_folder_desc: "一個字一篇筆記寫在這裡;外掛永遠只碰這個資料夾。",
	heading_claude: "Claude(選用)",
	set_claude_key_name: "Anthropic API key",
	set_claude_key_desc:
		"只有按下「在這句話裡是什麼意思」時才會用到,留空就是不啟用。這把 key 以明文存在外掛的 data.json 裡——如果你的 vault 有同步(iCloud、Dropbox、Git),key 會跟著一起同步出去。",
	set_claude_model_name: "模型",
	set_claude_model_desc: "Haiku 快又便宜;Sonnet 解釋寫得比較好。",
};

const STRINGS: Record<Lang, Dict> = { en: EN, "zh-TW": ZH };
