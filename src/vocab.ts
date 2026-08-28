// 生詞本:一個字一篇 Markdown,FSRS 狀態存在 frontmatter。
//
// 為什麼不用資料庫:Language Learner 把生詞存在 Obsidian 的 IndexDB 裡,
// 結果是不進 vault、不同步、搜尋不到、換裝置就沒了。存成 Markdown 才能
// 被搜尋、被連結、被 Dataview 查、被 git 管。
//
// 重複加入同一個字時的規則(沿用 PaperFolio「不碰使用者手寫內容」的原則):
// 已存在的筆記正文一律不動,只更新 frontmatter 的 FSRS 欄位,並把新的原句
// 追加到「我遇到它的地方」底下。

import { App, TFile, normalizePath } from "obsidian";
import { formsFor, meaningfulLines } from "./lemma";
import { meaningOf, type VocabRow } from "./vocab-list";
import { yamlString } from "./frontmatter";
import { TRANSLATION_MARK, parseNote } from "./note-parse";
import type { ImportedWord } from "./anki-import";
import type { DictEntry, Lookup, VocabCard } from "./types";

/** renderNote 的可選內容。欄位一直加,用具名物件比一串位置參數好讀。 */
interface NoteOpts {
	sentence?: string;
	usage?: string;
	detail?: string;
	/** 匯入來源,例如 "Language Reactor — 影片標題" */
	source?: string;
	/** 原句的中文翻譯 */
	sentenceTranslation?: string;
	url?: string;
	/** 來源自己標的詞義,放在詞庫釋義旁邊當對照 */
	sourceMeaning?: string;
}

const SENTENCE_HEADING = "## 我遇到它的地方";
const USAGE_HEADING = "## 例句與用法";
const DETAIL_HEADING = "## 字詞詳解";

/** 檔名安全化。英文字本來就安全,但 ' 與 - 在某些檔案系統上要留意。 */
function fileNameFor(word: string): string {
	return word.toLowerCase().replace(/[\\/:*?"<>|]/g, "-");
}

export class VocabStore {
	/** 資料夾裡已有哪些字。浮窗每次都要問「這個字存過沒」,不能每次都打檔案系統。 */
	private index = new Set<string>();

	constructor(private app: App, private folder: () => string) {}

	/** 掃一次資料夾建索引。外掛啟動與設定改資料夾時各呼叫一次。 */
	async refresh(): Promise<void> {
		this.index.clear();
		const dir = normalizePath(this.folder());
		if (!(await this.app.vault.adapter.exists(dir))) return;
		const listing = await this.app.vault.adapter.list(dir);
		for (const p of listing.files) {
			if (!p.endsWith(".md")) continue;
			const name = p.split("/").pop()!.slice(0, -3);
			// 底線開頭的是外掛自己的檔案(目前是 _review-log.md),不是生詞。
			// 不擋掉的話「這個字存過沒」會把它們當成單字。
			if (name.startsWith("_")) continue;
			this.index.add(name.toLowerCase());
		}
	}

	has(word: string): boolean {
		return this.index.has(fileNameFor(word));
	}

	get size(): number {
		return this.index.size;
	}

	private pathFor(word: string): string {
		return normalizePath(`${this.folder()}/${fileNameFor(word)}.md`);
	}

	/**
	 * 加入生詞本。已存在就只追加原句,不動正文。
	 * 回傳 true 代表新建、false 代表這個字本來就有。
	 */
	async add(
		lookup: Lookup,
		sentence: string,
		captureSentence: boolean,
		usage?: string,
		detail?: string
	): Promise<boolean> {
		const { entry } = lookup;
		const path = this.pathFor(entry.w);
		const existing = this.app.vault.getAbstractFileByPath(path);

		if (existing instanceof TFile) {
			if (captureSentence && sentence) await this.appendSentence(existing, sentence);
			return false;
		}

		await this.ensureFolder();
		await this.app.vault.create(
			path,
			this.renderNote(entry, { sentence: captureSentence ? sentence : "", usage, detail })
		);
		this.index.add(fileNameFor(entry.w));
		return true;
	}

	/**
	 * 從 Anki 匯進來的一個字。
	 *
	 * 釋義的優先順序:**離線詞庫優先,來源自帶的當退路**。詞庫給的是完整的
	 * 繁中釋義加英美音標加詞頻,Language Reactor 給的只有短短一行詞義,
	 * Saladict 根本沒有。詞庫查不到(專有名詞、冷僻字)才用來源那行,
	 * 兩邊都沒有就跳過——寧可少匯一個字,也不要在生詞本裡留一篇空殼筆記。
	 *
	 * 已經在生詞本裡的字只追加原句,不動既有內容也不重設複習進度。
	 */
	async addImported(
		item: ImportedWord,
		lookup: Lookup | null
	): Promise<"created" | "existed" | "skipped"> {
		const entry: DictEntry | null =
			lookup?.entry ?? (item.definition ? { w: item.word, tr: item.definition } : null);
		if (!entry) return "skipped";

		const path = this.pathFor(entry.w);
		const existing = this.app.vault.getAbstractFileByPath(path);
		if (existing instanceof TFile) {
			if (item.sentence) {
				await this.appendSentence(existing, item.sentence, item.sentenceTranslation);
			}
			return "existed";
		}

		await this.ensureFolder();
		await this.app.vault.create(
			path,
			this.renderNote(entry, {
				sentence: item.sentence ?? "",
				sentenceTranslation: item.sentenceTranslation,
				source: item.source,
				url: item.url,
				// 詞庫查得到時,來源那行詞義仍然留著當對照——Language Reactor 的
				// 詞義是照影片語境挑的,有時比詞庫的第一個義項更貼。
				sourceMeaning: lookup ? item.definition : undefined,
			})
		);
		this.index.add(fileNameFor(entry.w));
		return "created";
	}

	private async ensureFolder(): Promise<void> {
		const dir = normalizePath(this.folder());
		if (!(await this.app.vault.adapter.exists(dir))) {
			await this.app.vault.createFolder(dir);
		}
	}

	/** 把新句子接在「我遇到它的地方」底下;重複的句子不再加一次。 */
	private async appendSentence(
		file: TFile,
		sentence: string,
		translation?: string
	): Promise<void> {
		const quote = translation
			? `> ${sentence.replace(/\n/g, " ")}\n> ${TRANSLATION_MARK} ${translation}`
			: `> ${sentence.replace(/\n/g, " ")}`;
		const text = await this.app.vault.read(file);
		if (text.includes(sentence)) return;

		const idx = text.indexOf(SENTENCE_HEADING);
		const next =
			idx < 0
				? `${text.trimEnd()}\n\n${SENTENCE_HEADING}\n\n${quote}\n`
				: (() => {
						const cut = idx + SENTENCE_HEADING.length;
						return `${text.slice(0, cut)}\n\n${quote}\n${text.slice(cut)}`;
				  })();
		await this.app.vault.modify(file, next);
	}

	// ------------------------------------------------------------ 內容

	private renderNote(entry: DictEntry, opts: NoteOpts = {}): string {
		const { sentence = "", sentenceTranslation, usage, detail, source, url, sourceMeaning } = opts;
		const today = new Date().toISOString().slice(0, 10);
		const fm: string[] = [
			"---",
			"type: 生詞",
			`word: ${entry.w}`,
		];
		const uk = entry.uk ?? entry.ph;
		if (uk) fm.push(`音標_英: ${yamlString(uk)}`);
		if (entry.us) fm.push(`音標_美: ${yamlString(entry.us)}`);

		const freq: string[] = [];
		if (entry.bnc) freq.push(`BNC ${entry.bnc}`);
		if (entry.frq) freq.push(`COCA ${entry.frq}`);
		if (freq.length) fm.push(`詞頻: ${freq.join(" / ")}`);
		if (entry.collins) fm.push(`柯林斯: ${entry.collins}`);
		if (entry.tag?.length) fm.push(`考試: ${entry.tag.join(", ")}`);

		// 來源是外部標題,含冒號、引號都很正常,一定要包起來——不包的下場見 frontmatter.ts。
		if (source) fm.push(`來源: ${yamlString(source)}`);
		if (url) fm.push(`來源連結: ${yamlString(url)}`);

		fm.push(
			`date: ${today}`,
			// FSRS 初始狀態:今天就到期,加入當天就能複習。
			`fsrs_due: ${today}`,
			"fsrs_stability: 0",
			"fsrs_difficulty: 0",
			"fsrs_reps: 0",
			"fsrs_lapses: 0",
			"fsrs_state: new",
			"tags: [英文, 生詞]",
			"---",
			""
		);

		const body: string[] = [`# ${entry.w}`, ""];
		for (const line of meaningfulLines(entry.tr)) {
			body.push(line, "");
		}

		if (entry.def) {
			body.push("## 英英釋義", "");
			for (const line of entry.def.split("\\n")) {
				if (line.trim()) body.push(`- ${line.trim()}`);
			}
			body.push("");
		}

		const forms = formsFor(entry.exch);
		if (forms.length) body.push(`**變化**：${forms.join(" / ")}`, "");

		// 匯入來源自己標的詞義。放在詞庫釋義後面當對照,不覆蓋。
		if (sourceMeaning) body.push(`**${source?.split(" — ")[0] ?? "來源"}**：${sourceMeaning}`, "");

		// Claude 生成過的內容。花過的 token 就留著,複習時直接看得到。
		if (detail) body.push(DETAIL_HEADING, "", detail.trim(), "");
		if (usage) body.push(USAGE_HEADING, "", usage.trim(), "");

		body.push(SENTENCE_HEADING, "");
		if (sentence) {
			body.push(`> ${sentence.replace(/\n/g, " ")}`);
			// 中譯緊接在原句下面。複習卡的正面就靠它當第一層線索——
			// 知道那句話在講什麼,才有辦法把英文字想出來。
			if (sentenceTranslation) body.push(`> ${TRANSLATION_MARK} ${sentenceTranslation}`);
			body.push("");
		}

		return fm.join("\n") + body.join("\n");
	}

	// ------------------------------------------------------ FSRS 狀態

	/**
	 * 清單視圖要的一列一列資料:複習狀態再加上一行釋義。
	 *
	 * 釋義得讀筆記本文才拿得到(frontmatter 裡沒有),所以這裡比 allCards() 貴。
	 * 用 cachedRead 而不是 read——Obsidian 會自己快取,兩百多篇筆記重畫一次
	 * 感覺不出來。
	 */
	async listRows(): Promise<VocabRow[]> {
		const rows: VocabRow[] = [];
		for (const { file, card } of await this.allCards()) {
			rows.push({
				word: card.word,
				meaning: meaningOf(await this.app.vault.cachedRead(file)),
				card,
				path: file.path,
			});
		}
		return rows;
	}

	/** 讀出所有生詞的複習狀態。複習排程與 ribbon 徽章都靠這個。 */
	async allCards(): Promise<{ file: TFile; card: VocabCard }[]> {
		const out: { file: TFile; card: VocabCard }[] = [];
		const prefix = normalizePath(this.folder()) + "/";

		for (const file of this.app.vault.getMarkdownFiles()) {
			if (!file.path.startsWith(prefix)) continue;
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (!fm?.word) continue;
			out.push({
				file,
				card: {
					word: String(fm.word),
					due: String(fm.fsrs_due ?? ""),
					stability: Number(fm.fsrs_stability ?? 0),
					difficulty: Number(fm.fsrs_difficulty ?? 0),
					reps: Number(fm.fsrs_reps ?? 0),
					lapses: Number(fm.fsrs_lapses ?? 0),
					state: (fm.fsrs_state ?? "new") as VocabCard["state"],
					lastReview: fm.fsrs_last_review ? String(fm.fsrs_last_review) : undefined,
					suspended: fm.fsrs_suspended === true,
				},
			});
		}
		return out;
	}

	/** 寫回複習後的狀態。用官方的 processFrontMatter,不自己動字串。 */
	async saveCard(file: TFile, card: VocabCard): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			fm.fsrs_due = card.due;
			fm.fsrs_stability = Number(card.stability.toFixed(4));
			fm.fsrs_difficulty = Number(card.difficulty.toFixed(4));
			fm.fsrs_reps = card.reps;
			fm.fsrs_lapses = card.lapses;
			fm.fsrs_state = card.state;
			if (card.lastReview) fm.fsrs_last_review = card.lastReview;
		});
	}

	/**
	 * 幫既有筆記補上例句的中譯。
	 *
	 * 為什麼要獨立一個動作:245 篇是在「還沒開始撿中譯」的時候匯進來的,而中譯
	 * 只有 Anki 那邊有,顯示時生不出來。這個動作**只加不改**——原句、正文、
	 * 複習進度一律不動,只在缺中譯的原句底下補一行。
	 *
	 * 回傳補了幾篇。
	 */
	async backfillTranslation(word: string, sentenceTranslation: string): Promise<boolean> {
		const path = this.pathFor(word);
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return false;

		const text = await this.app.vault.read(file);
		const note = parseNote(text);
		// 已經有中譯的不碰;沒有例句的也沒地方補。
		if (!note.sentences.length || note.sentences.some((s) => s.translation)) return false;

		const first = note.sentences[0].text;
		const quoted = `> ${first}`;
		const idx = text.indexOf(quoted);
		if (idx < 0) return false;

		const cut = idx + quoted.length;
		const next = `${text.slice(0, cut)}\n> ${TRANSLATION_MARK} ${sentenceTranslation}${text.slice(cut)}`;
		await this.app.vault.modify(file, next);
		return true;
	}

	/**
	 * 封存／解除封存。
	 *
	 * 只動 `fsrs_suspended` 這一個欄位,FSRS 的進度一律不碰——解除封存時
	 * 原本學到哪就接回哪,不會因為封存過就被當成新字重來。
	 * 解除時直接把欄位刪掉,而不是寫 false,免得每篇筆記都多一行沒用的資訊。
	 */
	async setSuspended(file: TFile, suspended: boolean): Promise<void> {
		await this.app.fileManager.processFrontMatter(file, (fm) => {
			if (suspended) fm.fsrs_suspended = true;
			else delete fm.fsrs_suspended;
		});
	}
}
