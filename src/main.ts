// WordFolio — 外掛進入點。
// 滑鼠滑過英文字 → 浮窗顯示英美音標、發音、繁中釋義 → 一鍵加進生詞本 → FSRS 排程複習。
// 釋義走離線詞庫(ECDICT 轉繁 + ipa-dict 英美音標),只有「在這句話裡是什麼意思」才呼叫 Claude。

import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	WordFolioSettings,
	DEFAULT_SETTINGS,
	AudioSource,
	ClaudeModel,
} from "./settings";
import { t, setLang, LangSetting, currentLang } from "./i18n";
import { Dictionary } from "./dict";
import { WordTooltip } from "./tooltip";
import { HoverController, type DismissMode } from "./hover";
import { Audio } from "./audio";
import { VocabStore } from "./vocab";
import { ReviewModal } from "./review";
import { dueCards } from "./schedule";
import { ClaudeExplainer } from "./claude";
import {
	normalizeOrder,
	normalizeEnabled,
	move,
	sectionLabelKey,
	sectionDescKey,
} from "./sections";
import type { Lookup } from "./types";

export default class WordFolioPlugin extends Plugin {
	settings: WordFolioSettings = { ...DEFAULT_SETTINGS };
	private dict!: Dictionary;
	private tooltip!: WordTooltip;
	private hover!: HoverController;
	private audio!: Audio;
	private vocab!: VocabStore;
	private claude!: ClaudeExplainer;
	private ribbon: HTMLElement | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.applyLang();

		const base = this.manifest.dir ?? "";
		this.dict = new Dictionary(async (name) => {
			const p = `${base}/dict/${name}`;
			if (!(await this.app.vault.adapter.exists(p))) return null;
			return this.app.vault.adapter.read(p);
		});

		this.audio = new Audio(
			this.app.vault,
			`${base}/audio`,
			() => this.settings.audioSource === "online_first"
		);

		this.vocab = new VocabStore(this.app, () => this.settings.vocabFolder);

		this.claude = new ClaudeExplainer(() => ({
			apiKey: this.settings.claudeApiKey,
			model: this.settings.claudeModel,
			traditional: currentLang() === "zh-TW",
		}));

		this.tooltip = new WordTooltip({
			onSpeak: (word, accent) => void this.audio.speak(word, accent),
			onAdd: (lookup, sentence) => void this.addToVocab(lookup, sentence),
			onAsk: (lookup, sentence) => this.claude.explain(lookup, sentence),
			isSaved: (word) => this.vocab.has(word),
		});

		this.hover = new HoverController({
			delay: () => this.settings.hoverDelay,
			closeDelay: () => this.settings.closeDelay,
			dismissMode: () => this.settings.dismissMode,
			enabled: () => this.settings.hoverEnabled && this.dict.installed,
			lookup: (word) => this.dict.lookup(word),
			tooltip: this.tooltip,
			view: () => ({
				order: normalizeOrder(this.settings.sectionOrder),
				enabled: normalizeEnabled(this.settings.sectionsEnabled),
			}),
		});
		this.hover.attach();

		this.addSettingTab(new WordFolioSettingTab(this.app, this));

		this.addCommand({
			id: "lookup-word",
			name: t("command_lookup"),
			callback: () => void this.lookupAtCursor(),
		});

		this.addCommand({
			id: "review-vocabulary",
			name: t("command_review"),
			callback: () => void this.startReview(),
		});

		this.ribbon = this.addRibbonIcon("book-open-check", t("ribbon_tooltip_empty"), () =>
			void this.startReview()
		);

		// 生詞本被改動(手動編輯、複習寫回)時更新徽章。
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (file.path.startsWith(this.settings.vocabFolder + "/")) {
					void this.refreshBadge();
				}
			})
		);

		// 詞庫載入放到 layout ready 之後,不要拖慢 Obsidian 啟動。
		this.app.workspace.onLayoutReady(() => {
			void this.loadDictionary();
			void this.vocab.refresh().then(() => this.refreshBadge());
		});
	}

	onunload(): void {
		this.hover?.detach();
		this.tooltip?.destroy();
		this.audio?.dispose();
	}

	private async loadDictionary(): Promise<void> {
		const ok = await this.dict.load();
		if (!ok) {
			new Notice(t("notice_dict_missing"), 8000);
			return;
		}
		this.settings.dictVersion = this.dict.version;
		await this.saveSettings();
	}

	/** ribbon 圖示顯示今天有幾個字要複習。 */
	private async refreshBadge(): Promise<void> {
		if (!this.ribbon) return;
		const due = dueCards(await this.vocab.allCards()).length;
		this.ribbon.setAttribute(
			"aria-label",
			due ? t("ribbon_tooltip", { due }) : t("ribbon_tooltip_empty")
		);
		this.ribbon.toggleClass("wordfolio-has-due", due > 0);
		this.ribbon.dataset.count = due ? String(due) : "";
	}

	private async startReview(): Promise<void> {
		const due = dueCards(await this.vocab.allCards());
		if (!due.length) {
			new Notice(t("review_nothing_due"));
			return;
		}
		new ReviewModal(this.app, this.vocab, due).open();
	}

	/** 命令面板／快捷鍵的入口:對選取的字(沒選取就用游標位置)查詢。 */
	private async lookupAtCursor(): Promise<void> {
		if (!this.dict.installed) {
			new Notice(t("notice_dict_missing"), 8000);
			return;
		}

		const sel = window.getSelection();
		const word = sel?.toString().trim() ?? "";
		if (!word) {
			new Notice(t("notice_not_found", { word: "" }));
			return;
		}

		const range = sel!.getRangeAt(0);
		const shown = await this.hover.showFor({
			word,
			sentence: range.startContainer.nodeValue ?? word,
			rect: range.getBoundingClientRect(),
		});
		if (!shown) new Notice(t("notice_not_found", { word }));
	}

	private async addToVocab(lookup: Lookup, sentence: string): Promise<void> {
		try {
			const created = await this.vocab.add(
				lookup,
				sentence,
				this.settings.captureSentence
			);
			new Notice(
				t(created ? "notice_vocab_added" : "notice_vocab_exists", {
					word: lookup.entry.w,
				})
			);
			await this.refreshBadge();
		} catch (e) {
			new Notice(e instanceof Error ? e.message : String(e));
		}
	}

	/** 改了生詞本資料夾之後重建索引與徽章。 */
	async reindexVocab(): Promise<void> {
		await this.vocab.refresh();
		await this.refreshBadge();
	}

	applyLang(): void {
		// Obsidian 的顯示語言;官方 API 沒有公開 getter,用 localStorage 的 language 鍵。
		const locale = window.localStorage.getItem("language") || "";
		setLang(this.settings.language, locale);
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<WordFolioSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, data ?? {});
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class WordFolioSettingTab extends PluginSettingTab {
	plugin: WordFolioPlugin;

	constructor(app: App, plugin: WordFolioPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = this.plugin.settings;

		new Setting(containerEl)
			.setName(t("set_language_name"))
			.setDesc(t("set_language_desc"))
			.addDropdown((d) =>
				d
					.addOption("auto", t("lang_auto"))
					.addOption("en", "English")
					.addOption("zh-TW", "繁體中文")
					.setValue(s.language)
					.onChange(async (v) => {
						s.language = v as LangSetting;
						await this.plugin.saveSettings();
						this.plugin.applyLang();
						this.display();
					})
			);

		// --- 查詢 ---
		new Setting(containerEl).setName(t("heading_lookup")).setHeading();

		new Setting(containerEl)
			.setName(t("set_hover_name"))
			.setDesc(t("set_hover_desc"))
			.addToggle((tg) =>
				tg.setValue(s.hoverEnabled).onChange(async (v) => {
					s.hoverEnabled = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("set_hover_delay_name"))
			.setDesc(t("set_hover_delay_desc"))
			.addSlider((sl) =>
				sl
					.setLimits(100, 1000, 50)
					.setValue(s.hoverDelay)
					.setDynamicTooltip()
					.onChange(async (v) => {
						s.hoverDelay = v;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("set_dismiss_name"))
			.setDesc(t("set_dismiss_desc"))
			.addDropdown((d) =>
				d
					.addOption("delay", t("dismiss_delay"))
					.addOption("click_outside", t("dismiss_click_outside"))
					.setValue(s.dismissMode)
					.onChange(async (v) => {
						s.dismissMode = v as DismissMode;
						await this.plugin.saveSettings();
						// 寬限期滑桿只在「移開就關」時有意義。
						this.display();
					})
			);

		if (s.dismissMode === "delay") {
			new Setting(containerEl)
				.setName(t("set_close_delay_name"))
				.setDesc(t("set_close_delay_desc"))
				.addSlider((sl) =>
					sl
						.setLimits(100, 2000, 100)
						.setValue(s.closeDelay)
						.setDynamicTooltip()
						.onChange(async (v) => {
							s.closeDelay = v;
							await this.plugin.saveSettings();
						})
				);
		}

		// --- 浮窗顯示什麼 ---
		new Setting(containerEl)
			.setName(t("heading_sections"))
			.setDesc(t("sections_desc"))
			.setHeading();

		const order = normalizeOrder(s.sectionOrder);
		const enabled = normalizeEnabled(s.sectionsEnabled);

		order.forEach((id, i) => {
			const row = new Setting(containerEl)
				.setName(t(sectionLabelKey(id)))
				.setDesc(t(sectionDescKey(id)));

			row.addExtraButton((b) =>
				b
					.setIcon("chevron-up")
					.setTooltip(t("section_move_up"))
					.setDisabled(i === 0)
					.onClick(async () => {
						s.sectionOrder = move(order, id, -1);
						await this.plugin.saveSettings();
						this.display();
					})
			);
			row.addExtraButton((b) =>
				b
					.setIcon("chevron-down")
					.setTooltip(t("section_move_down"))
					.setDisabled(i === order.length - 1)
					.onClick(async () => {
						s.sectionOrder = move(order, id, 1);
						await this.plugin.saveSettings();
						this.display();
					})
			);
			row.addToggle((tg) =>
				tg.setValue(enabled[id]).onChange(async (v) => {
					s.sectionsEnabled = { ...enabled, [id]: v };
					await this.plugin.saveSettings();
				})
			);
		});

		// --- 發音 ---
		new Setting(containerEl).setName(t("heading_audio")).setHeading();

		new Setting(containerEl)
			.setName(t("set_audio_source_name"))
			.setDesc(t("set_audio_source_desc"))
			.addDropdown((d) =>
				d
					.addOption("online_first", t("audio_online_first"))
					.addOption("system_only", t("audio_system_only"))
					.setValue(s.audioSource)
					.onChange(async (v) => {
						s.audioSource = v as AudioSource;
						await this.plugin.saveSettings();
					})
			);

		// --- 生詞本 ---
		new Setting(containerEl).setName(t("heading_vocab")).setHeading();

		new Setting(containerEl)
			.setName(t("set_vocab_folder_name"))
			.setDesc(t("set_vocab_folder_desc"))
			.addText((txt) =>
				txt.setValue(s.vocabFolder).onChange(async (v) => {
					s.vocabFolder = v.trim() || DEFAULT_SETTINGS.vocabFolder;
					await this.plugin.saveSettings();
					await this.plugin.reindexVocab();
				})
			);

		// --- Claude ---
		new Setting(containerEl).setName(t("heading_claude")).setHeading();

		new Setting(containerEl)
			.setName(t("set_claude_key_name"))
			.setDesc(t("set_claude_key_desc"))
			.addText((txt) => {
				txt.inputEl.type = "password";
				txt.setPlaceholder("sk-ant-…")
					.setValue(s.claudeApiKey)
					.onChange(async (v) => {
						s.claudeApiKey = v.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName(t("set_claude_model_name"))
			.setDesc(t("set_claude_model_desc"))
			.addDropdown((d) =>
				d
					.addOption("claude-haiku-4-5-20251001", "Haiku 4.5")
					.addOption("claude-sonnet-5", "Sonnet 5")
					.setValue(s.claudeModel)
					.onChange(async (v) => {
						s.claudeModel = v as ClaudeModel;
						await this.plugin.saveSettings();
					})
			);
	}
}
