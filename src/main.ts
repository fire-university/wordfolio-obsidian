// WordFolio — 外掛進入點。
// 滑鼠滑過英文字 → 浮窗顯示英美音標、發音、繁中釋義 → 一鍵加進生詞本 → FSRS 排程複習。
// 釋義走離線詞庫(ECDICT 轉繁 + ipa-dict 英美音標),只有「在這句話裡是什麼意思」才呼叫 Claude。

import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import {
	WordFolioSettings,
	DEFAULT_SETTINGS,
	AudioSource,
} from "./settings";
import { t, setLang, LangSetting, currentLang } from "./i18n";
import { Dictionary } from "./dict";
import { WordTooltip } from "./tooltip";
import { HoverController, type TriggerMode } from "./hover";
import type { IconMode } from "./tooltip";
import { Audio } from "./audio";
import { VocabStore } from "./vocab";
import { ReviewModal } from "./review";
import { dueCards } from "./schedule";
import { LocalLLM } from "./llm";
import { Cambridge } from "./cambridge";
import {
	ALL_SECTIONS,
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
	private llm!: LocalLLM;
	private cambridge = new Cambridge();
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

		// 劍橋查過的字寫進外掛資料夾,離線與重開之後都還在。
		const cambDir = `${base}/cambridge`;
		this.cambridge.useStore({
			read: async (name) => {
				const p = `${cambDir}/${name}`;
				return (await this.app.vault.adapter.exists(p))
					? this.app.vault.adapter.read(p)
					: null;
			},
			write: async (name, data) => {
				await this.app.vault.adapter.mkdir(cambDir).catch(() => undefined);
				await this.app.vault.adapter.write(`${cambDir}/${name}`, data);
			},
		});

		this.llm = new LocalLLM(() => ({
			endpoint: this.settings.llmEndpoint,
			model: this.settings.llmModel,
			traditional: currentLang() === "zh-TW",
		}));

		this.tooltip = new WordTooltip({
			onSpeak: (word, accent) => void this.audio.speak(word, accent),
			onAdd: (lookup, sentence) => void this.addToVocab(lookup, sentence),
			onAsk: (lookup, sentence, gen) => this.llm.explain(lookup, sentence, gen),
			onUsage: (lookup, gen) =>
				this.llm.usage(lookup.entry.w, lookup.entry.tr.split("\\n").join("; "), gen),
			onDetail: (lookup, gen) =>
				this.llm.detail(lookup.entry.w, lookup.entry.tr.split("\\n").join("; "), gen),
			isSaved: (word) => this.vocab.has(word),
			onCambridge: (word, signal) => this.cambridge.lookup(word, signal),
			cachedCambridge: (word) => this.cambridge.cached(word),
			cachedAsk: (lookup, sentence) => this.llm.cachedExplain(lookup.surface, sentence),
			cachedUsage: (word) => this.llm.usageFor(word),
			cachedDetail: (word) => this.llm.detailFor(word),
			// 浮窗內導覽:點同義詞跳過去,可以返回上一個字。
			onNavigate: (word) => void this.hover.navigateTo(word),
			onBack: () => this.hover.goBack(),
			canGoBack: () => this.hover.canGoBack(),
		});

		this.hover = new HoverController({
			triggerMode: () => this.settings.triggerMode,
			delay: () => this.settings.hoverDelay,
			closeDelay: () => this.settings.closeDelay,
			enabled: () => this.dict.installed,
			lookup: (word) => this.dict.lookup(word),
			lookupSelection: (text) => this.lookupSelection(text),
			iconMode: () => this.settings.iconMode,
			iconDwell: () => this.settings.iconDwell,
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

	/**
	 * 查選取的文字。單字就走一般查詢(含詞形還原);多個字先查離線片語庫,
	 * 查不到才用 Claude 翻譯整個片語——大部分常用片語 ECDICT 有,不必每次燒 token。
	 */
	private async lookupSelection(text: string): Promise<Lookup | null> {
		const words = text.trim().split(/\s+/);
		if (words.length === 1) return this.dict.lookup(words[0]);

		const entry = await this.dict.lookupPhrase(text);
		if (entry) return { entry, surface: text };

		// 離線庫沒有:交給 Claude 生一個臨時詞條(有 key 才行)。
		if (!this.llm.available) return null;
		try {
			const tr = await this.llm.translatePhrase(text);
			return { entry: { w: text, tr }, surface: text };
		} catch {
			return null;
		}
	}

	private async addToVocab(lookup: Lookup, sentence: string): Promise<void> {
		try {
			const created = await this.vocab.add(
				lookup,
				sentence,
				this.settings.captureSentence,
				// 已經花 token 生成過的內容一併寫進筆記,不用再花第二次。
				this.llm.usageFor(lookup.entry.w),
				this.llm.detailFor(lookup.entry.w)
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

	/** 設定頁用:列出本地已安裝的模型。 */
	listLocalModels(): Promise<string[]> {
		return this.llm.listModels();
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

		// 遷移:加了劍橋詞典之後,AI 那三樣退位成加值選項(太慢)。已經存過設定的人
		// 不會因為預設值改了就受惠,要主動關掉一次;同時把劍橋打開。只做一次,
		// 之後使用者自己開回來就尊重他的選擇。
		if (data && !this.settings.migratedCambridge) {
			this.settings.sectionsEnabled = {
				...this.settings.sectionsEnabled,
				cambridge: true,
				claude: false,
				usage: false,
				detail: false,
			};
			this.settings.migratedCambridge = true;
			await this.saveSettings();
		}

		// 遷移:triggerMode 之前叫 hoverEnabled(布林)。舊使用者若關掉過 hover,
		// 沿用其意圖;沒有 triggerMode 欄位又沒關過 hover 的,維持預設 hover。
		if (data && data.triggerMode === undefined && data.hoverEnabled === false) {
			this.settings.triggerMode = "select";
			await this.saveSettings();
		}
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

	/**
	 * 帶單位的毫秒滑桿。數值讀數就緊貼在滑桿旁邊(不是放在標題),拖動時即時
	 * 跟著手把跳動——這樣視線不用在標題和滑桿之間來回,調整當下就看得到現值。
	 * Obsidian 內建的 setDynamicTooltip 只在拖動當下冒個泡泡、放開就消失,不夠。
	 */
	private msSlider(
		container: HTMLElement,
		name: string,
		desc: string,
		min: number,
		max: number,
		step: number,
		get: () => number,
		set: (v: number) => Promise<void>
	): void {
		const setting = new Setting(container).setName(name).setDesc(desc);
		// 讀數放在滑桿前面(靠標題那側),拖動時更新文字。
		const readout = setting.controlEl.createSpan({ cls: "wordfolio-slider-value" });
		const paint = (v: number) => {
			readout.setText(`${v} ms`);
		};
		paint(get());
		setting.addSlider((sl) =>
			sl
				.setLimits(min, max, step)
				.setValue(get())
				.onChange(async (v) => {
					paint(v);
					await set(v);
				})
		);
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
			.setName(t("set_trigger_name"))
			.setDesc(t("set_trigger_desc"))
			.addDropdown((d) =>
				d
					.addOption("hover", t("trigger_hover"))
					.addOption("select", t("trigger_select"))
					.addOption("both", t("trigger_both"))
					.setValue(s.triggerMode)
					.onChange(async (v) => {
						s.triggerMode = v as TriggerMode;
						await this.plugin.saveSettings();
						// hover 延遲滑桿只在有 hover 的模式下才有意義。
						this.display();
					})
			);

		// hover 延遲只在會用到 hover 的模式顯示。
		if (s.triggerMode !== "select") {
			this.msSlider(
				containerEl,
				t("set_hover_delay_name"),
				t("set_hover_delay_desc"),
				100,
				1000,
				50,
				() => s.hoverDelay,
				async (v) => {
					s.hoverDelay = v;
					await this.plugin.saveSettings();
				}
			);
		}

		// 寬限期只跟 hover 有關(選取打開的浮窗是 sticky,點框外才關)。
		if (s.triggerMode !== "select") {
			this.msSlider(
				containerEl,
				t("set_close_delay_name"),
				t("set_close_delay_desc"),
				100,
				2000,
				100,
				() => s.closeDelay,
				async (v) => {
					s.closeDelay = v;
					await this.plugin.saveSettings();
				}
			);
		}

		// 選取圖示怎麼展開——只在有選取的模式(select / both)下才有那顆圖示。
		if (s.triggerMode !== "hover") {
			new Setting(containerEl)
				.setName(t("set_icon_mode_name"))
				.setDesc(t("set_icon_mode_desc"))
				.addDropdown((d) =>
					d
						.addOption("click", t("icon_click"))
						.addOption("hover", t("icon_hover"))
						.addOption("both", t("icon_both"))
						.setValue(s.iconMode)
						.onChange(async (v) => {
							s.iconMode = v as IconMode;
							await this.plugin.saveSettings();
							// 停留秒數滑桿只在有停留的模式下才有意義。
							this.display();
						})
				);

			if (s.iconMode !== "click") {
				this.msSlider(
					containerEl,
					t("set_icon_dwell_name"),
					t("set_icon_dwell_desc"),
					300,
					3000,
					100,
					() => s.iconDwell,
					async (v) => {
						s.iconDwell = v;
						await this.plugin.saveSettings();
					}
				);
			}
		}

		// --- 浮窗顯示什麼 ---
		new Setting(containerEl)
			.setName(t("heading_sections"))
			.setDesc(t("sections_desc"))
			.setHeading();

		const order = normalizeOrder(s.sectionOrder);
		const enabled = normalizeEnabled(s.sectionsEnabled);

		// 舊版存的順序可能跟現在的建議順序差很多(新區塊一直加進來)。
		// 給一顆一鍵還原,比叫使用者一格一格搬上搬下實際。
		new Setting(containerEl)
			.setName(t("set_reset_order_name"))
			.setDesc(t("set_reset_order_desc"))
			.addButton((b) =>
				b.setButtonText(t("set_reset_order_button")).onClick(async () => {
					s.sectionOrder = [...ALL_SECTIONS];
					await this.plugin.saveSettings();
					this.display();
				})
			);

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

		// --- 本地 AI ---
		new Setting(containerEl)
			.setName(t("heading_llm"))
			.setDesc(t("heading_llm_desc"))
			.setHeading();

		new Setting(containerEl)
			.setName(t("set_llm_endpoint_name"))
			.setDesc(t("set_llm_endpoint_desc"))
			.addText((txt) =>
				txt
					.setPlaceholder("http://localhost:11434/v1")
					.setValue(s.llmEndpoint)
					.onChange(async (v) => {
						s.llmEndpoint = v.trim() || DEFAULT_SETTINGS.llmEndpoint;
						await this.plugin.saveSettings();
					})
			);

		// 模型:列出 Ollama 裡真的裝了哪些,讓人用選的,不要叫人背模型名去打字。
		// Obsidian 的 display() 是同步的,所以先畫出目前值,再非同步把清單補進去。
		const modelSetting = new Setting(containerEl)
			.setName(t("set_llm_model_name"))
			.setDesc(t("set_llm_model_desc"));
		modelSetting.addDropdown((d) => {
			d.addOption(s.llmModel, s.llmModel).setValue(s.llmModel);
			d.onChange(async (v) => {
				s.llmModel = v;
				await this.plugin.saveSettings();
			});
			void this.plugin.listLocalModels().then((models) => {
				if (!models.length) {
					modelSetting.setDesc(t("llm_model_none"));
					return;
				}
				d.selectEl.empty();
				for (const m of models) d.addOption(m, m);
				// 目前選的模型若已經被刪掉,就退到清單第一個。
				const pick = models.includes(s.llmModel) ? s.llmModel : models[0];
				d.setValue(pick);
				if (pick !== s.llmModel) {
					s.llmModel = pick;
					void this.plugin.saveSettings();
				}
			});
		});
	}
}
