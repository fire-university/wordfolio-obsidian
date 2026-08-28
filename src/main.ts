// WordFolio — 外掛進入點。
// 滑鼠滑過英文字 → 浮窗顯示英美音標、發音、繁中釋義 → 一鍵加進生詞本 → FSRS 排程複習。
// 釋義走離線詞庫(ECDICT 轉繁 + ipa-dict 英美音標),只有「在這句話裡是什麼意思」才呼叫 Claude。

import { App, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
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
import { toAnkiFields } from "./anki-fields";
import { Anki } from "./anki";
import { ReviewModal } from "./review";
import { ReviewLog } from "./review-log";
import { ConfirmModal } from "./confirm";
import { VocabView, VIEW_TYPE_VOCAB } from "./vocab-view";
import {
	fromAnkiNote,
	mergeImported,
	IMPORT_MODELS,
	type ImportedWord,
} from "./anki-import";
import { LocalLLM } from "./llm";
import { WebSource, type SourceStore } from "./sources";
import { CAMBRIDGE, LONGMAN, OXFORD, WIKTIONARY } from "./source-defs";
import {
	ALL_SECTIONS,
	normalizeOrder,
	normalizeEnabled,
	move,
	sectionLabelKey,
	sectionDescKey,
} from "./sections";
import type { Lookup, VocabCard } from "./types";
import { reviewQueue, Rating, type Grade } from "./schedule";
import type { RatingName } from "./stats";

/** 四個評分鍵 → 複習紀錄裡的欄位名。 */
const RATING_NAME: Record<Grade, RatingName> = {
	[Rating.Again]: "again",
	[Rating.Hard]: "hard",
	[Rating.Good]: "good",
	[Rating.Easy]: "easy",
};

export default class WordFolioPlugin extends Plugin {
	settings: WordFolioSettings = { ...DEFAULT_SETTINGS };
	private dict!: Dictionary;
	private tooltip!: WordTooltip;
	private hover!: HoverController;
	private audio!: Audio;
	private vocab!: VocabStore;
	private llm!: LocalLLM;
	/** 四家線上詞典。每一家是設定裡一個可勾選的區塊。 */
	private sources: Record<string, WebSource> = {
		cambridge: new WebSource(CAMBRIDGE),
		longman: new WebSource(LONGMAN),
		oxford: new WebSource(OXFORD),
		wiktionary: new WebSource(WIKTIONARY),
	};
	private ribbon: HTMLElement | null = null;
	private anki = new Anki();
	private log!: ReviewLog;

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
		this.log = new ReviewLog(this.app, () => this.settings.vocabFolder);

		// 線上詞典查過的字寫進外掛資料夾,離線與重開之後都還在。
		const store: SourceStore = {
			read: async (name: string) => {
				const p = `${base}/sources/${name}`;
				return (await this.app.vault.adapter.exists(p))
					? this.app.vault.adapter.read(p)
					: null;
			},
			write: async (name: string, data: string) => {
				const dir = `${base}/sources/${name.split("/")[0]}`;
				await this.app.vault.adapter.mkdir(dir).catch(() => undefined);
				await this.app.vault.adapter.write(`${base}/sources/${name}`, data);
			},
		};
		for (const src of Object.values(this.sources)) src.useStore(store);

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
			onSource: (id, word, signal) => this.sources[id]?.lookup(word, signal) ?? Promise.resolve(null),
			cachedSource: (id, word) => this.sources[id]?.cached(word),
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
			id: "sync-anki",
			name: t("command_anki"),
			callback: () => void this.syncToAnki(),
		});

		this.addCommand({
			id: "review-vocabulary",
			name: t("command_review"),
			callback: () => void this.startReview(),
		});

		this.registerView(VIEW_TYPE_VOCAB, (leaf) => new VocabView(leaf, {
			data: () => this.viewData(),
			startReview: () => void this.startReview(),
			importFromAnki: () => this.importFromAnki(),
			openNote: (path) => void this.app.workspace.openLinkText(path, "", true),
		}));

		this.addCommand({
			id: "open-vocab-list",
			name: t("command_vocab_list"),
			callback: () => void this.openVocabView(),
		});

		this.addCommand({
			id: "import-from-anki",
			name: t("command_import_anki"),
			callback: () => void this.importFromAnki(),
		});

		// ribbon 改成開清單視圖,不是直接進複習 Modal。
		// 「唯一的入口是一次一張卡的 Modal」正是他覺得不好用的原因;清單頁上
		// 有一顆「開始複習(N)」,少一次點擊換來看得到全部的字與數據。
		this.ribbon = this.addRibbonIcon("book-open-check", t("ribbon_tooltip_empty"), () =>
			void this.openVocabView()
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
			void Promise.all([this.vocab.refresh(), this.log.load()]).then(() =>
				this.refreshBadge()
			);
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

	/**
	 * ribbon 圖示顯示今天有幾個字要複習。
	 *
	 * 數的是**實際會排進佇列的張數**(受每日新字上限影響),不是所有到期的。
	 * 徽章寫 240、按下去只有 20 張,那個數字就是在騙人。
	 */
	private async refreshBadge(): Promise<void> {
		if (!this.ribbon) return;
		const due = (await this.queue()).length;
		this.ribbon.setAttribute(
			"aria-label",
			due ? t("ribbon_tooltip", { due }) : t("ribbon_tooltip_empty")
		);
		this.ribbon.toggleClass("wordfolio-has-due", due > 0);
		this.ribbon.dataset.count = due ? String(due) : "";
	}

	/** 這次要複習哪些卡。到期的舊字全排,新字受每日上限管。 */
	private async queue(): Promise<{ file: TFile; card: VocabCard }[]> {
		return reviewQueue(
			await this.vocab.allCards(),
			this.settings.newPerDay,
			this.log.newToday()
		);
	}

	private async startReview(): Promise<void> {
		const due = await this.queue();
		if (!due.length) {
			new Notice(t("review_nothing_due"));
			return;
		}
		new ReviewModal(this.app, this.vocab, due, {
			speak: (word, accent) => void this.audio.speak(word, accent),
			autoSpeak: () => this.settings.reviewAutoSpeak,
			openNote: (file) => void this.app.workspace.getLeaf(true).openFile(file),
			// 每評一張就寫進 _review-log.md。複習到一半關掉視窗是常態,
			// 那幾張不該憑空消失。
			onGraded: (rating, wasNew) => this.log.record(RATING_NAME[rating], wasNew),
			onClose: () => {
				void this.refreshBadge();
				void this.refreshViews();
			},
		}).open();
	}

	// ------------------------------------------------------------ 清單視圖

	private async openVocabView(): Promise<void> {
		const { workspace } = this.app;
		const open = workspace.getLeavesOfType(VIEW_TYPE_VOCAB);
		if (open.length) {
			workspace.revealLeaf(open[0]);
			return;
		}
		const leaf = workspace.getLeaf(true);
		await leaf.setViewState({ type: VIEW_TYPE_VOCAB, active: true });
		workspace.revealLeaf(leaf);
	}

	private async viewData() {
		const rows = await this.vocab.listRows();
		return {
			rows,
			days: this.log.all(),
			queueSize: (await this.queue()).length,
			newLimit: this.settings.newPerDay,
		};
	}

	private async refreshViews(): Promise<void> {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_VOCAB)) {
			if (leaf.view instanceof VocabView) await leaf.view.refresh();
		}
	}

	// ------------------------------------------------------------ Anki 匯入

	/**
	 * 把 Anki 裡的字接進生詞本(Anki → Obsidian)。
	 *
	 * 為什麼要有這個方向:道哥的字散在四個地方,Obsidian 生詞本只有其中最小的
	 * 一份。他說「看不到全部的單字」,字面上就是真的——做完清單視圖也只會看到
	 * 十個字。先把瀏覽器那邊存的字接進來,清單才有意義。
	 *
	 * 這不是雙向同步:**只拿內容,不拿排程**(見 anki.ts 的 pull)。
	 */
	private async importFromAnki(): Promise<void> {
		if (!(await this.anki.available())) {
			new Notice(t("anki_unreachable"), 8000);
			return;
		}

		const present = await this.anki.models();
		const models = IMPORT_MODELS.filter((m) => present.includes(m));
		if (!models.length) {
			new Notice(t("import_no_models", { models: IMPORT_MODELS.join("、") }), 8000);
			return;
		}

		const raw = await this.anki.pull(models);
		const parsed = raw
			.map((n) => fromAnkiNote(n.modelName, n.fields))
			.filter((x): x is ImportedWord => x !== null);
		const items = mergeImported(parsed);
		// 不是單字的(片語、整句)在這一步就被擋掉了,數量要講出來,不要靜靜吞掉。
		const ignored = raw.length - parsed.length;

		if (!items.length) {
			new Notice(t("import_nothing"), 6000);
			return;
		}

		new ConfirmModal(
			this.app,
			t("import_confirm_title"),
			t("import_confirm_body", {
				count: items.length,
				folder: this.settings.vocabFolder,
				models: models.join("、"),
				ignored,
			}),
			t("import_confirm_ok"),
			() => void this.runImport(items, ignored)
		).open();
	}

	private async runImport(items: ImportedWord[], ignored: number): Promise<void> {
		new Notice(t("import_working", { count: items.length }));

		let created = 0;
		let existed = 0;
		let skipped = 0;
		for (const item of items) {
			// 走一般查詢,所以詞形還原也生效:Saladict 存的 `carved` 會落在
			// `carve` 這篇筆記上,跟從浮窗加入的行為一致。
			const lookup = this.dict.installed ? await this.dict.lookup(item.word) : null;
			const r = await this.vocab.addImported(item, lookup);
			if (r === "created") created++;
			else if (r === "existed") existed++;
			else skipped++;
		}

		await this.vocab.refresh();
		await this.refreshBadge();
		await this.refreshViews();
		new Notice(t("import_done", { created, existed, skipped, ignored }), 12000);
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

	/**
	 * 把生詞本推進 Anki。單向:Obsidian → Anki。
	 * 已經在 Anki 裡的字會跳過,所以重複執行是安全的。
	 */
	private async syncToAnki(): Promise<void> {
		if (!(await this.anki.available())) {
			new Notice(t("anki_unreachable"), 8000);
			return;
		}

		const prefix = this.settings.vocabFolder + "/";
		const notes = [];
		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(prefix)) continue;
			const uri = `obsidian://open?vault=${encodeURIComponent(
				this.app.vault.getName()
			)}&file=${encodeURIComponent(file.path)}`;
			const fields = toAnkiFields(await this.app.vault.read(file), uri);
			if (fields) notes.push(fields);
		}

		if (!notes.length) {
			new Notice(t("anki_nothing"));
			return;
		}

		try {
			const r = await this.anki.push(this.settings.ankiDeck, notes);
			new Notice(t("anki_done", { added: r.added, skipped: r.skipped }), 6000);
		} catch (e) {
			new Notice(`Anki: ${e instanceof Error ? e.message : String(e)}`, 8000);
		}
	}

	/** 設定頁的按鈕用。 */
	importFromAnkiFromSettings(): Promise<void> {
		return this.importFromAnki();
	}

	/** 設定頁用:列出本地已安裝的模型。 */
	listLocalModels(): Promise<string[]> {
		return this.llm.listModels();
	}

	/** 改了生詞本資料夾之後重建索引與徽章。複習紀錄也跟著換資料夾。 */
	async reindexVocab(): Promise<void> {
		await this.vocab.refresh();
		await this.log.load();
		await this.refreshBadge();
		await this.refreshViews();
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
		set: (v: number) => Promise<void>,
		unit = "ms"
	): void {
		const setting = new Setting(container).setName(name).setDesc(desc);
		// 讀數放在滑桿前面(靠標題那側),拖動時更新文字。
		const readout = setting.controlEl.createSpan({ cls: "wordfolio-slider-value" });
		const paint = (v: number) => {
			readout.setText(`${v} ${unit}`);
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

		this.msSlider(
			containerEl,
			t("set_new_per_day_name"),
			t("set_new_per_day_desc"),
			0,
			100,
			5,
			() => s.newPerDay,
			async (v) => {
				s.newPerDay = v;
				await this.plugin.saveSettings();
				await this.plugin.reindexVocab();
			},
			t("set_new_per_day_unit")
		);

		new Setting(containerEl)
			.setName(t("set_auto_speak_name"))
			.setDesc(t("set_auto_speak_desc"))
			.addToggle((tg) =>
				tg.setValue(s.reviewAutoSpeak).onChange(async (v) => {
					s.reviewAutoSpeak = v;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("set_import_anki_name"))
			.setDesc(t("set_import_anki_desc"))
			.addButton((b) =>
				b.setButtonText(t("set_import_anki_button")).onClick(() => {
					void this.plugin.importFromAnkiFromSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("set_anki_deck_name"))
			.setDesc(t("set_anki_deck_desc"))
			.addText((txt) =>
				txt
					.setPlaceholder("WordFolio")
					.setValue(s.ankiDeck)
					.onChange(async (v) => {
						s.ankiDeck = v.trim() || DEFAULT_SETTINGS.ankiDeck;
						await this.plugin.saveSettings();
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
