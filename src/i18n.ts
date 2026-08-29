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
	command_anki: "Send vocabulary to Anki",
	anki_unreachable:
		"WordFolio: cannot reach Anki.\nOpen Anki and make sure the AnkiConnect add-on is installed.",
	anki_nothing: "WordFolio: your vocabulary notebook is empty.",
	anki_done: "WordFolio: sent to Anki — {added} new, {skipped} already there.",
	set_anki_deck_name: "Anki deck",
	set_anki_deck_desc:
		"Where \"Send vocabulary to Anki\" puts the cards; created if it does not exist. One-way only (Obsidian → Anki) — this plugin has its own spaced repetition, so pick one of the two as your main review system rather than running both.",
	command_download_dict: "Download / update the offline dictionary",

	// 詞庫
	notice_dict_missing:
		"WordFolio: the offline dictionary is not installed yet.\nRun \"Download / update the offline dictionary\" from the command palette.",
	notice_dict_downloading: "WordFolio: downloading the offline dictionary…",
	notice_dict_ready: "WordFolio: dictionary ready ({entries} entries).",
	notice_dict_failed: "WordFolio: dictionary download failed.\n{err}",
	notice_not_found: "WordFolio: \"{word}\" is not in the dictionary.",
	notice_no_selection: "WordFolio: select a word first, then press the button.",
	dict_progress: "WordFolio: downloading the dictionary… {done}/{total} files · {mb}",
	dict_verifying: "WordFolio: checking files already on disk…",
	dict_up_to_date: "WordFolio: the dictionary is already complete ({entries} entries).",
	dict_cancelled: "WordFolio: download cancelled. Run the command again to carry on where it stopped.",
	dict_err_http: "Could not reach the download server. Check your connection and run the command again — files already downloaded are kept.",
	dict_err_hash: "A downloaded file was damaged ({file}). Run the command again to re-fetch just that one.",
	dict_err_meta: "The download server did not return a valid dictionary index.",
	dict_err_version: "This release does not have the dictionary version this plugin expects ({version}).",
	dict_err_write: "Could not write to the plugin folder. Check that the disk is not full or read-only.",

	// 首次啟動的安裝引導
	setup_title: "Install the offline dictionary",
	setup_body:
		"WordFolio looks words up entirely on your own machine, so the dictionary is downloaded once and then never needs a network again.\n\n{size} · {entries} entries · downloaded from this plugin's GitHub release.\n\nIt goes into the plugin's own folder, not your vault, and you can delete it any time by removing the plugin. If the download is interrupted, run the command again — it carries on from where it stopped.",
	setup_download: "Download now",
	setup_later: "Not now",
	setup_later_hint:
		"WordFolio: no dictionary, so lookups are off.\nRun \"Download / update the offline dictionary\" from the command palette when you are ready.",

	// 複習紀錄
	log_sentinel_note: "Maintained by WordFolio — do not edit this table by hand",

	// 浮窗
	tooltip_add: "Add to vocabulary notebook",
	tooltip_added: "In your vocabulary notebook",
	tooltip_ask_claude: "What does it mean here?",
	tooltip_usage: "Examples and usage",
	tooltip_detail: "Roots and word family",
	tooltip_asking: "Thinking…",
	tooltip_looking_up: "Looking up…",
	tooltip_inflection_of: "form of {lemma}",
	tooltip_forms: "Forms",
	tooltip_back: "Back",
	label_uk: "UK",
	label_us: "US",
	label_syn: "syn.",
	label_ant: "ant.",

	// 生詞本
	notice_vocab_added: "WordFolio: \"{word}\" added to your notebook.",
	notice_vocab_exists: "WordFolio: \"{word}\" is already in your notebook.",

	// 複習
	review_show_answer: "Show answer",
	review_again: "Again",
	review_again_desc: "Did not come back to me — ask again right now",
	review_hard_desc: "Got there, but it was a struggle — comes back soon",
	review_good_desc: "Remembered it — the gap grows as usual",
	review_easy_desc: "Too easy — the gap grows much faster",
	review_hard: "Hard",
	review_good: "Good",
	review_easy: "Easy",
	review_done: "WordFolio: review finished — {count} cards.",
	review_nothing_due: "WordFolio: nothing due today.",
	accent_uk: "UK",
	accent_us: "US",
	review_sec_english: "In English",
	review_sec_forms: "Forms",
	review_sec_sentence: "Where you met it",
	review_suspend: "Know it",
	review_suspend_desc: "Stop scheduling this word. The note stays, and you can bring it back from the vocabulary list.",
	review_open_note: "Open note",
	review_hint_listen: "Hear it",
	review_hint_ipa: "Show phonetics",
	review_spell_slot: "Missing letter",
	review_spelled_next: "Right — see the card",
	review_spell_right: "You spelled it right",
	review_spell_wrong: "What you typed",
	review_spell_should_be: "should be {letter}",
	set_auto_speak_name: "Say the word when the card flips",
	set_auto_speak_desc:
		"Plays the British recording as soon as you reveal the answer, so you do not have to click every time. Both accents stay clickable next to the phonetics either way.",
	list_filter_suspended: "Suspended",
	state_suspended: "Suspended",

	// 清單視圖與練習數據
	command_vocab_list: "Open the vocabulary list",
	command_import_anki: "Import words from Anki",
	list_title: "Vocabulary",
	list_import: "Import from Anki",
	list_refresh: "Reload",
	list_review_n: "Review {n}",
	list_review_none: "Nothing due",
	list_search: "Search word or meaning",
	list_count: "Showing {shown} of {total}",
	list_empty: "Your vocabulary notebook is empty. Words you saved in the browser through Anki can be brought in here.",
	list_empty_filtered: "No words match this filter.",
	list_breakdown: "New {new} · Learning {learning} · Review {review} · Due today {due}",
	list_hardest: "Hardest to remember",
	list_new_limit_note: " · reviewing {n} this session — new words are capped at {limit} a day (change it in settings)",
	list_filter_all: "All",
	list_filter_due: "Due today",
	list_filter_leech: "Keep forgetting",
	list_filter_new: "New",
	list_filter_learning: "Learning",
	list_col_word: "Word",
	list_col_meaning: "Meaning",
	list_col_state: "State",
	list_col_due: "Next due",
	list_col_reps: "Reviews",
	list_col_lapses: "Forgot",
	state_new: "New",
	state_learning: "Learning",
	state_relearning: "Relearning",
	state_review: "Review",
	due_today: "Today",
	due_overdue: "{days}d overdue",
	stat_today: "Reviewed today",
	stat_week: "Last 7 days",
	stat_streak: "Streak",
	stat_streak_unit: "d",
	stat_accuracy_week: "Accuracy (7d)",
	stat_total: "Words saved",
	stat_stability: "Avg. memory",
	stat_days: "d",

	// 複習紀錄檔
	log_title: "Review log",
	log_col_date: "Date",
	log_col_reviewed: "Reviewed",
	log_col_new: "New",

	// Anki 匯入
	import_no_models: "WordFolio: Anki has none of these note types — {models}.",
	import_nothing: "WordFolio: found nothing to import from Anki.",
	import_working: "WordFolio: importing {count} words…",
	import_confirm_title: "Import words from Anki",
	import_confirm_body:
		"{count} words found in: {models}\nThey will be written to {folder}/ — one note per word.\nSkipping {ignored} entries that are phrases or sentences rather than single words.\nNothing in Anki is modified or deleted; only the words are read, not their scheduling.",
	import_confirm_ok: "Import",
	import_done:
		"WordFolio: import finished — {created} added, {existed} already there ({backfilled} got their sentence translated), {skipped} skipped (no definition found), {ignored} not single words.",
	confirm_cancel: "Cancel",
	set_new_per_day_name: "New words per day",
	set_new_per_day_desc:
		"How many words you have never seen get mixed into a review session. Words that are already due are always included on top of this. Set it to 0 to work through what you have already started and let no new words in.",
	set_new_per_day_unit: "words",
	set_import_anki_name: "Import from Anki",
	set_import_anki_desc:
		"Brings words you saved in the browser (Language Reactor, Saladict) into your notebook as notes, filling in phonetics and definitions from the offline dictionary. Anki must be running with AnkiConnect. Read-only as far as Anki is concerned — nothing there is changed or deleted, and review scheduling stays with this plugin.",
	set_import_anki_button: "Import",

	// 設定
	set_language_name: "Language",
	set_language_desc: "Interface language. Auto follows Obsidian.",
	lang_auto: "Auto",
	// --- 詞庫(設定頁) ---
	default_vocab_folder: "Vocabulary",
	set_content_lang_name: "Definition language",
	set_content_lang_desc:
		"What language definitions and new vocabulary notes are written in — separate from the interface language above, so you can read an English interface and still get Chinese definitions. Changing this resets which tooltip sections are shown to that language's defaults; notes you already have are left as they are and stay readable either way.",
	content_lang_auto: "Same as the interface",
	heading_dict: "Offline dictionary",
	set_dict_status_name: "Dictionary files",
	set_dict_installed: "Installed — version {version}, {entries} entries, {size} on disk.",
	set_dict_not_installed:
		"Not installed. Nothing can be looked up until the dictionary is downloaded ({size}, one time only).",
	set_dict_download: "Download",
	set_dict_repair: "Check and repair",
	set_dict_cancel: "Cancel",
	set_dict_folder_note:
		"The files live in this plugin's own folder inside .obsidian/plugins, not in your vault. Removing the plugin removes them too; your vocabulary notes are not touched.",

	// --- 贊助 ---
	heading_support: "Support",
	set_donate_desc:
		"WordFolio is free and open source, with no accounts, no servers and no tracking. If it saves you time, a coffee keeps it maintained.",
	set_donate_button: "Buy me a coffee",

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
	section_cambridge: "Cambridge dictionary",
	section_cambridge_desc:
		"Senses from the Cambridge English–Chinese (Traditional) dictionary: English definition, Chinese gloss and real example sentences with translations. Needs a network connection the first time you look a word up; after that the entry is saved to disk and works offline. Everything else in this plugin is already offline.",
	section_longman: "Longman (LDOCE)",
	section_longman_desc:
		"Learner-focused definitions written with a very small vocabulary — useful when the Cambridge definition is still hard to read. English only, online (cached to disk after the first lookup).",
	section_oxford: "Oxford Learner's",
	section_oxford_desc:
		"Like Longman, plus CEFR levels (A1–C2). English only, online (cached to disk after the first lookup).",
	section_wiktionary: "Etymology (Wiktionary)",
	section_wiktionary_desc:
		"The real origin chain, e.g. effective ← French effectif ← Latin effect\u012bvus. Uses the official Wiktionary API, so it will not break when a site redesigns. English only.",
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
	section_examples: "Example sentences",
	section_examples_desc: "Real example sentences from WordNet, offline. In English.",
	section_synonyms: "Synonyms and antonyms",
	section_synonyms_desc: "From WordNet, offline. English words, no Chinese gloss.",
	section_exams: "Exam tags",
	section_exams_desc: "CET, TOEFL, GRE and so on. Useful when studying for a test, noise otherwise.",
	section_forms: "Inflected forms",
	section_forms_desc: "Plural, past tense, -ing form and the rest.",
	section_claude: "What does it mean here (AI)",
	section_claude_desc: "Explains which sense applies in the sentence you are reading. Generated by the local AI once the tooltip has been open for a moment.",
	section_usage: "Examples and usage (AI)",
	section_usage_desc:
		"Example sentences, common collocations and near-synonym notes, written by the local AI. Appears on its own after a short pause; results are cached and saved into the word's note.",
	section_detail: "Roots & word family (AI)",
	section_detail_desc:
		"Breaks the word into prefix/root/suffix with Latin/Greek origins, plus words from the same root. Written by the local AI, cached per word and saved into the word's note.",
	set_reset_order_name: "Reset order",
	set_reset_order_desc:
		"Put the sections back in the recommended order. Useful after an update adds new sections.",
	set_reset_order_button: "Reset",
	section_move_up: "Move up",
	section_move_down: "Move down",

	heading_audio: "Pronunciation",
	wave_not_downloaded: "No recording saved yet — press play once and the waveform appears.",
	set_waveform_name: "Show a waveform",
	set_waveform_desc:
		"Draws the shape of the recording next to the phonetics, so you can see which syllable carries the stress — not just how loud it is. Only words whose audio is already on disk get one; it never goes online just to draw a line, and the system voice fallback cannot be drawn at all.",
	set_prefetch_name: "Fetch pronunciations as you hover",
	set_prefetch_desc:
		"Off by default. Normally a recording is downloaded the first time you press play, so words you have never played show a dotted placeholder instead of a waveform. Turn this on and the recording is fetched as soon as the tooltip opens, so the waveform is always there. The cost: every English word you hover sends that word to Youdao's public pronunciation endpoint — reading one article can be dozens of requests. Words with no recording are remembered and not asked for again.",
	set_normalize_name: "Even out the volume",
	set_normalize_desc:
		"Recorded pronunciations arrive at wildly different levels — measured across 81 cached files, the quietest and loudest were 11.6 dB apart, roughly four times the loudness. This matches them on playback so you are not reaching for the volume key every other word.",
	set_accent_name: "Accent",
	set_accent_desc:
		"Which pronunciation to show and play — in the hover popup, on review cards, and for every automatic playback. If you are learning one accent, the other one is just taking up space.",
	accent_both: "British and American",
	accent_us_only: "American only",
	accent_uk_only: "British only",
	wf_stats_reps: "{reps} reviews",
	wf_stats_right: "{right} right",
	wf_stats_wrong: "{wrong} wrong",
	wf_stats_accuracy: "{pct}% correct",
	wf_stats_untested: "Not reviewed yet",
	wf_stats_approx: "Counted from FSRS lapses — this note predates per-answer tracking, so the rate is optimistic.",
	tier_untested: "Not rated yet",
	tier_shaky: "Needs work",
	tier_learning: "Still learning",
	tier_solid: "Getting solid",
	tier_mastered: "Mastered",
	tier_untested_why: "You have not been asked this one yet.",
	tier_shaky_why: "You get this wrong more than most — worth extra attention.",
	tier_learning_why: "Too few reviews to judge. Keep going.",
	tier_solid_why: "Reliable so far, but not yet held over a long gap.",
	tier_mastered_why: "Right almost every time, and still remembered after weeks.",
	review_eg_from_dict: "Example from the dictionary",
	set_selection_icon_name: "Show the lookup icon when you select a word",
	set_selection_icon_desc:
		"When on, selecting a word pops up a small book icon you tap to open the dictionary. Off by default on phones and tablets: on a small screen anything that appears by itself covers the lines you are reading. With it off, look words up with the \"Look up the selected word\" command — on mobile you can add that to the toolbar (Settings → Mobile → Manage toolbar options) and it becomes a button you press when you want it.",
	set_spelling_hint_name: "Letters given in spelling practice",
	set_spelling_hint_desc:
		"Which letters of the answer are filled in for you. Fewer letters is harder — with none, you spell the whole word from scratch, which turns the exercise from fill-in-the-blank into writing it out from memory. Hyphens and apostrophes are always given; they are not the hard part. Words of two letters or fewer are never blanked.",
	spelling_hint_both: "First and last",
	spelling_hint_first: "First only",
	spelling_hint_last: "Last only",
	spelling_hint_none: "None — spell the whole word",
	set_speak_front_name: "Say the word when the question appears",
	set_speak_front_desc:
		"Plays the word as soon as a question card opens. Good for listening practice — but note it also tells you the pronunciation before you try to recall the word, which makes the question easier. Only plays the first time you see a card, not when you press Again.",
	set_audio_source_name: "Audio source",
	set_audio_source_desc:
		"Online recordings sound better; the system voice always works offline. Downloaded audio is cached, so a word you have heard once stays available offline.",
	audio_online_first: "Online recording, fall back to system voice",
	audio_system_only: "System voice only (fully offline)",
	heading_vocab: "Vocabulary notebook",
	set_vocab_folder_name: "Notebook folder",
	set_vocab_folder_desc:
		"One note per word is written here; the plugin only ever touches this folder.",
	heading_llm: "Local AI (optional)",
	heading_llm_desc:
		"The AI sections (\"what does it mean here\", roots, usage) run on a local model via Ollama — no API key, nothing leaves your Mac. Install Ollama and run e.g. `ollama pull qwen2.5:7b`. Leave these as-is if you use Ollama's defaults.",
	set_llm_endpoint_name: "Endpoint",
	set_llm_endpoint_desc: "OpenAI-compatible API base. Ollama's default is http://localhost:11434/v1.",
	set_llm_model_name: "Model",
	set_llm_model_desc: "Pick from the models installed in Ollama. Smaller models (3b) answer faster; larger ones (7b) write better Chinese.",
	llm_model_none: "No models found — is Ollama running?",
};

const ZH: Dict = {
	// 命令 / 圖示
	ribbon_tooltip: "WordFolio:複習生詞(今天 {due} 個)",
	ribbon_tooltip_empty: "WordFolio:今天沒有要複習的",
	command_lookup: "查詢選取的單字",
	command_review: "開始複習生詞",
	command_anki: "把生詞本送進 Anki",
	anki_unreachable:
		"WordFolio:連不上 Anki。\n請打開 Anki,並確認裝了 AnkiConnect 外掛。",
	anki_nothing: "WordFolio:生詞本是空的。",
	anki_done: "WordFolio:已送進 Anki——新增 {added} 個,{skipped} 個已經有了。",
	set_anki_deck_name: "Anki 牌組",
	set_anki_deck_desc:
		"「把生詞本送進 Anki」會放進這個牌組,不存在會自動建立。**單向而已(Obsidian → Anki)**——這個外掛自己就有間隔複習,兩邊各記各的進度,建議挑一邊當主力,不要兩套並行。",
	command_download_dict: "下載／更新離線詞庫",

	// 詞庫
	notice_dict_missing:
		"WordFolio:離線詞庫還沒安裝。\n請從命令面板執行「下載／更新離線詞庫」。",
	notice_dict_downloading: "WordFolio:正在下載離線詞庫…",
	notice_dict_ready: "WordFolio:詞庫就緒(共 {entries} 個詞條)。",
	notice_dict_failed: "WordFolio:詞庫下載失敗。\n{err}",
	notice_not_found: "WordFolio:詞庫裡沒有「{word}」。",
	notice_no_selection: "WordFolio:先選取一個英文字,再按這個按鈕。",
	dict_progress: "WordFolio:正在下載詞庫… {done}/{total} 個檔案 · {mb}",
	dict_verifying: "WordFolio:正在檢查已經下載好的檔案…",
	dict_up_to_date: "WordFolio:詞庫已經是完整的(共 {entries} 個詞條)。",
	dict_cancelled: "WordFolio:已取消下載。再執行一次指令會從中斷的地方接著下載。",
	dict_err_http: "連不上下載伺服器。檢查網路後再執行一次指令,已經下載好的檔案會保留。",
	dict_err_hash: "有一個檔案下載壞掉({file})。再執行一次指令會只重抓那一個。",
	dict_err_meta: "下載伺服器沒有回傳正確的詞庫索引檔。",
	dict_err_version: "這個 release 裡沒有外掛需要的詞庫版本({version})。",
	dict_err_write: "寫不進外掛資料夾。確認磁碟沒有滿、也不是唯讀。",

	// 首次啟動的安裝引導
	setup_title: "安裝離線詞庫",
	setup_body:
		"WordFolio 查字完全在你自己的電腦上進行,所以詞庫只下載這一次,之後永遠不需要連網。\n\n{size} · {entries} 個詞條 · 從這個外掛的 GitHub release 下載。\n\n檔案放在外掛自己的資料夾,不會進你的 vault;移除外掛就一起消失。下載中斷的話再執行一次指令,會從中斷的地方接著下載。",
	setup_download: "現在下載",
	setup_later: "稍後再說",
	setup_later_hint:
		"WordFolio:沒有詞庫,查詢功能是關著的。\n想裝的時候從命令面板執行「下載／更新離線詞庫」。",

	// 複習紀錄
	log_sentinel_note: "這個表格由外掛自動維護,請不要手動編輯",

	// 浮窗
	tooltip_add: "加入生詞本",
	tooltip_added: "已在生詞本裡",
	tooltip_ask_claude: "在這句話裡是什麼意思",
	tooltip_usage: "例句與用法",
	tooltip_detail: "字根字首與詞族",
	tooltip_asking: "本地 AI 思考中…",
	tooltip_looking_up: "查詢中…",
	tooltip_inflection_of: "{lemma} 的變化形",
	tooltip_forms: "變化",
	tooltip_back: "返回",
	label_uk: "英",
	label_us: "美",
	label_syn: "同義",
	label_ant: "反義",

	// 生詞本
	notice_vocab_added: "WordFolio:「{word}」已加入生詞本。",
	notice_vocab_exists: "WordFolio:「{word}」已經在生詞本裡了。",

	// 複習
	review_show_answer: "看答案",
	review_again: "重來",
	review_again_desc: "沒想起來 —— 立刻再問一次同一個字",
	review_hard_desc: "想起來了，但很吃力 —— 很快就會再問你",
	review_good_desc: "記得 —— 間隔照常拉長",
	review_easy_desc: "太簡單 —— 間隔拉得更長，之後很久才會再出現",
	review_hard: "有點難",
	review_good: "記得",
	review_easy: "太簡單",
	review_done: "WordFolio:複習完成,共 {count} 張。",
	review_nothing_due: "WordFolio:今天沒有要複習的。",
	accent_uk: "英",
	accent_us: "美",
	review_sec_english: "英英釋義",
	review_sec_forms: "變化",
	review_sec_sentence: "我遇到它的地方",
	review_suspend: "已學會",
	review_suspend_desc: "不再排這個字進複習。筆記不會刪，之後在生詞清單的「已封存」裡隨時可以放回來。",
	review_open_note: "開啟筆記",
	review_hint_listen: "聽發音",
	review_hint_ipa: "顯示音標",
	review_spell_slot: "缺的字母",
	review_spelled_next: "拼對了，看解答",
	review_spell_right: "拼對了",
	review_spell_wrong: "你剛才拼的",
	review_spell_should_be: "應該是 {letter}",
	set_auto_speak_name: "翻到答案面時自動念一次",
	set_auto_speak_desc:
		"翻面就播英式真人錄音，不用每張都手動點。不管開或關，音標旁邊的英美兩顆播放鍵都在。",
	list_filter_suspended: "已封存",
	state_suspended: "已封存",

	// 清單視圖與練習數據
	command_vocab_list: "開啟生詞清單",
	command_import_anki: "從 Anki 匯入生詞",
	list_title: "生詞本",
	list_import: "從 Anki 匯入",
	list_refresh: "重新整理",
	list_review_n: "開始複習（{n}）",
	list_review_none: "今天沒有要複習的",
	list_search: "搜尋單字或釋義",
	list_count: "顯示 {shown} / {total}",
	list_empty: "生詞本還是空的。你在瀏覽器裡存進 Anki 的字可以接進來。",
	list_empty_filtered: "這個篩選底下沒有字。",
	list_breakdown: "新字 {new} · 學習中 {learning} · 複習中 {review} · 今天到期 {due}",
	list_hardest: "最記不牢",
	list_new_limit_note: " · 本次排 {n} 張——新字每天上限 {limit} 個（可在設定改）",
	list_filter_all: "全部",
	list_filter_due: "今天到期",
	list_filter_leech: "記不牢",
	list_filter_new: "新字",
	list_filter_learning: "學習中",
	list_col_word: "單字",
	list_col_meaning: "釋義",
	list_col_state: "狀態",
	list_col_due: "下次到期",
	list_col_reps: "複習",
	list_col_lapses: "忘記",
	state_new: "新字",
	state_learning: "學習中",
	state_relearning: "重新學",
	state_review: "複習中",
	due_today: "今天",
	due_overdue: "逾期 {days} 天",
	stat_today: "今天複習",
	stat_week: "最近七天",
	stat_streak: "連續",
	stat_streak_unit: "天",
	stat_accuracy_week: "七天正確率",
	stat_total: "生詞總數",
	stat_stability: "平均記憶強度",
	stat_days: "天",

	// 複習紀錄檔
	log_title: "複習紀錄",
	log_col_date: "日期",
	log_col_reviewed: "複習",
	log_col_new: "新字",

	// Anki 匯入
	import_no_models: "WordFolio:Anki 裡沒有這幾種筆記類型 — {models}。",
	import_nothing: "WordFolio:Anki 裡沒有可以匯入的字。",
	import_working: "WordFolio:正在匯入 {count} 個字⋯⋯",
	import_confirm_title: "從 Anki 匯入生詞",
	import_confirm_body:
		"在這些筆記類型裡找到 {count} 個字：{models}\n會寫進 {folder}/，一個字一篇筆記。\n另有 {ignored} 筆是片語或整句而不是單字，跳過。\nAnki 那邊不會被改動或刪除任何東西：只讀單字內容，不碰它的複習排程。",
	import_confirm_ok: "開始匯入",
	import_done:
		"WordFolio:匯入完成 — 新增 {created}、本來就有 {existed}（其中 {backfilled} 篇補上了例句中譯）、查不到釋義跳過 {skipped}、不是單字跳過 {ignored}。",
	confirm_cancel: "取消",
	set_new_per_day_name: "每次複習放幾個新字",
	set_new_per_day_desc:
		"一次複習裡最多混進幾個你沒看過的字。已經到期的舊字不受這個限制，一定會排進來。設成 0 就是這陣子只把已經開始學的字複習完，不放新字進來。",
	set_new_per_day_unit: "個",
	set_import_anki_name: "從 Anki 匯入生詞",
	set_import_anki_desc:
		"把你在瀏覽器裡存進 Anki 的字（Language Reactor、Saladict）接成生詞筆記，音標與釋義用離線詞庫補齊。要先開著 Anki 並裝有 AnkiConnect。對 Anki 而言是唯讀的：不會改動也不會刪掉那邊的任何東西，複習排程仍然只有這個外掛在管。",
	set_import_anki_button: "匯入",

	// 設定
	set_language_name: "語言",
	set_language_desc: "介面語言。自動 = 跟著 Obsidian 走。",
	lang_auto: "自動",
	// --- 詞庫(設定頁) ---
	default_vocab_folder: "英文生詞本",
	set_content_lang_name: "釋義語言",
	set_content_lang_desc:
		"釋義與新生詞筆記要用哪種語言寫。**跟上面的介面語言分開**,所以介面用英文、釋義用繁中是可以的。改這個會把浮窗要顯示哪些區塊重設成該語言的預設值;已經寫好的筆記不會被動到,兩種語言的筆記都讀得出來。",
	content_lang_auto: "跟介面語言一致",
	heading_dict: "離線詞庫",
	set_dict_status_name: "詞庫檔案",
	set_dict_installed: "已安裝——版本 {version},{entries} 個詞條,佔用 {size}。",
	set_dict_not_installed:
		"尚未安裝。詞庫下載完成之前查不了任何字({size},只需要下載這一次)。",
	set_dict_download: "下載",
	set_dict_repair: "檢查並修復",
	set_dict_cancel: "取消",
	set_dict_folder_note:
		"檔案放在 .obsidian/plugins 底下這個外掛自己的資料夾,不在你的 vault 裡。移除外掛時會一起消失,你的生詞筆記不會被動到。",

	// --- 贊助 ---
	heading_support: "支持這個外掛",
	set_donate_desc:
		"WordFolio 是免費的開源外掛,沒有帳號、沒有伺服器、沒有任何追蹤。如果它幫你省下了時間,請我一杯咖啡就是最好的支持。",
	set_donate_button: "請我喝杯咖啡",

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
	section_cambridge: "劍橋詞典",
	section_cambridge_desc:
		"劍橋英漢（繁體）詞典的義項:英文定義、中文釋義,還有附中譯的真實例句。**只有第一次查那個字需要連網**,之後會存進磁碟,離線與重開之後都看得到。外掛其他內容(釋義、音標、例句、同義詞)本來就是離線的。",
	section_longman: "朗文當代（LDOCE）",
	section_longman_desc:
		"學習者字典:定義只用最基本的詞彙寫成,劍橋的定義還是看不懂時看這個。純英文,線上(查過一次就存進磁碟,之後離線也看得到)。",
	section_oxford: "牛津學習者（OALD）",
	section_oxford_desc:
		"跟朗文同類,額外標 CEFR 等級(A1–C2)。純英文,線上(查過一次就存進磁碟)。",
	section_wiktionary: "字源（Wiktionary）",
	section_wiktionary_desc:
		"真實的字源鏈,例如 effective ← 法語 effectif ← 拉丁 effectīvus。走**官方 API**,不會因為對方改版面而壞。純英文。",
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
	section_examples: "例句",
	section_examples_desc: "來自 WordNet 的真實例句,離線。英文句子。",
	section_synonyms: "同義詞與反義詞",
	section_synonyms_desc: "來自 WordNet,離線。英文單字,沒有中文對照。",
	section_exams: "考試標籤",
	section_exams_desc: "CET、TOEFL、GRE 之類。準備考試時有用,一般閱讀是雜訊。",
	section_forms: "變化形",
	section_forms_desc: "複數、過去式、現在分詞等。",
	section_claude: "在這句話裡是什麼意思（AI）",
	section_claude_desc: "說明這個字在你正在讀的那句話裡是哪一個意思。浮窗停留一下之後由本地 AI 生成。",
	section_usage: "例句與用法（AI）",
	section_usage_desc:
		"例句、常見搭配、近義詞辨析,由本地 AI 生成。浮窗停留一下就會自己出現;算過的字會快取,加進生詞本時一起寫進筆記。",
	section_detail: "字根字首與詞族（AI）",
	section_detail_desc:
		"把字拆成字首/字根/字尾,標出拉丁或希臘來源,再加同一字根的衍生字。由本地 AI 生成,算過的字會快取,並一起寫進生詞本。",
	set_reset_order_name: "恢復預設順序",
	set_reset_order_desc: "把區塊排回建議的順序。外掛更新加了新區塊之後,按這個最快。",
	set_reset_order_button: "恢復",
	section_move_up: "往上移",
	section_move_down: "往下移",

	heading_audio: "發音",
	wave_not_downloaded: "這個口音的發音還沒下載過——按一次播放就會出現波形。",
	set_waveform_name: "顯示波形",
	set_waveform_desc:
		"在音標旁邊畫出這段錄音的形狀,**看得到重音落在哪一個音節**,而不只是多大聲。只有音檔已經在磁碟上的字才畫,不會為了畫一條線而額外連網;退回系統語音的字沒有波形可畫。",
	set_prefetch_name: "滑過去就先抓發音",
	set_prefetch_desc:
		"**預設關閉。** 平常是按下播放時才下載錄音,所以沒播過的字看到的是一排淡點而不是波形。打開這個之後,浮窗一跳出來就去抓,波形就會一直都在。代價是:**你滑過的每一個英文字都會把那個字送到有道的公開發音端點**,讀一篇文章可能就是幾十個請求。查不到錄音的字會被記住,不會重複問。",
	set_normalize_name: "拉齊音量",
	set_normalize_desc:
		"真人錄音的音量很不一致——實測 81 個快取檔,最小聲與最大聲差了 11.6 dB,大約四倍響度。開啟後播放時會自動拉齊,不用每隔幾個字就去動音量鍵。",
	set_accent_name: "發音口音",
	set_accent_desc:
		"要顯示與播放哪一套發音——浮窗、複習卡的音標按鈕、以及所有自動發音都跟著這裡走。只學一種口音的話，另一種就只是佔版面。",
	accent_both: "英式與美式都要",
	accent_us_only: "只要美式",
	accent_uk_only: "只要英式",
	wf_stats_reps: "複習 {reps} 次",
	wf_stats_right: "答對 {right} 次",
	wf_stats_wrong: "答錯 {wrong} 次",
	wf_stats_accuracy: "正確率 {pct}%",
	wf_stats_untested: "還沒複習過",
	wf_stats_approx: "這篇筆記早於逐次記錄,答錯次數是用 FSRS 的忘記次數估的,正確率偏樂觀。",
	tier_untested: "還沒評過",
	tier_shaky: "重點加強",
	tier_learning: "還在學",
	tier_solid: "漸漸穩了",
	tier_mastered: "已掌握",
	tier_untested_why: "這個字還沒考過你。",
	tier_shaky_why: "這個字你答錯的比例偏高,值得多花時間。",
	tier_learning_why: "複習次數還太少,判斷不了,繼續練。",
	tier_solid_why: "目前都答得出來,但還沒經過長時間的間隔考驗。",
	tier_mastered_why: "幾乎每次都對,而且隔了幾週還記得。",
	review_eg_from_dict: "詞庫例句",
	set_selection_icon_name: "選字時自動顯示查詢圖示",
	set_selection_icon_desc:
		"開啟時,選取一個字就會冒出一顆小書本圖示,點它才開字典。**手機與平板預設關閉**:小螢幕上任何自動出現的東西都是在搶你正在讀的那幾行。關閉時改用命令「查詢選取的單字」——手機版可以把它加進下方工具列(設定 → 行動裝置 → 管理工具列選項),變成一顆你想按才按的按鈕。",
	set_spelling_hint_name: "拼寫練習先給幾個字母",
	set_spelling_hint_desc:
		"答案的哪幾個字母會先幫你填好。**給越少越難**——一個都不給等於整個字從頭拼到尾,那是把「填空」變成「默寫」。連字號與撇號一律直接給,那不是拼寫的難點;兩個字母以內的字也不會挖空。",
	spelling_hint_both: "首字母與尾字母",
	spelling_hint_first: "只給首字母",
	spelling_hint_last: "只給尾字母",
	spelling_hint_none: "都不給——整個字自己拼",
	set_speak_front_name: "問題卡出現時先念一次",
	set_speak_front_desc:
		"問題卡一打開就把那個字念出來。練聽力有幫助，但要知道它也等於在你回想之前先把讀音告訴你，題目會變簡單。只在第一次看到那張卡時念，按「重來」重問同一個字時不會再念。",
	set_audio_source_name: "發音來源",
	set_audio_source_desc:
		"線上真人錄音比較好聽,系統語音則是永遠都能用。抓過的音檔會快取,所以聽過一次的字之後離線也聽得到。",
	audio_online_first: "線上真人錄音,失敗時用系統語音",
	audio_system_only: "只用系統語音(完全離線)",
	heading_vocab: "生詞本",
	set_vocab_folder_name: "生詞本資料夾",
	set_vocab_folder_desc: "一個字一篇筆記寫在這裡;外掛永遠只碰這個資料夾。",
	heading_llm: "本地 AI（選用）",
	heading_llm_desc:
		"AI 那幾個區塊（「在這句話裡是什麼意思」、字根字首、例句用法）跑在本地模型上,透過 Ollama——不用 API key、查的字不會離開你的電腦。裝好 Ollama 後執行 `ollama pull qwen2.5:7b`。用 Ollama 預設的話這兩欄不用改。",
	set_llm_endpoint_name: "端點",
	set_llm_endpoint_desc: "OpenAI 相容的 API base。Ollama 預設是 http://localhost:11434/v1。",
	set_llm_model_name: "模型",
	set_llm_model_desc: "從 Ollama 裡已安裝的模型挑一個。小模型(3b)回得快,大模型(7b)中文寫得好。",
	llm_model_none: "找不到模型——Ollama 有在執行嗎?",
};

export const STRINGS: Record<Lang, Dict> = { en: EN, "zh-TW": ZH };
