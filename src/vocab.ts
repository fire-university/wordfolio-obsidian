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
import type { DictEntry, Lookup, VocabCard } from "./types";

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
			if (p.endsWith(".md")) {
				this.index.add(p.split("/").pop()!.slice(0, -3).toLowerCase());
			}
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
			this.renderNote(entry, captureSentence ? sentence : "", usage, detail)
		);
		this.index.add(fileNameFor(entry.w));
		return true;
	}

	private async ensureFolder(): Promise<void> {
		const dir = normalizePath(this.folder());
		if (!(await this.app.vault.adapter.exists(dir))) {
			await this.app.vault.createFolder(dir);
		}
	}

	/** 把新句子接在「我遇到它的地方」底下;重複的句子不再加一次。 */
	private async appendSentence(file: TFile, sentence: string): Promise<void> {
		const quote = `> ${sentence.replace(/\n/g, " ")}`;
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

	private renderNote(entry: DictEntry, sentence: string, usage?: string, detail?: string): string {
		const today = new Date().toISOString().slice(0, 10);
		const fm: string[] = [
			"---",
			"type: 生詞",
			`word: ${entry.w}`,
		];
		if (entry.uk ?? entry.ph) fm.push(`音標_英: "${entry.uk ?? entry.ph}"`);
		if (entry.us) fm.push(`音標_美: "${entry.us}"`);

		const freq: string[] = [];
		if (entry.bnc) freq.push(`BNC ${entry.bnc}`);
		if (entry.frq) freq.push(`COCA ${entry.frq}`);
		if (freq.length) fm.push(`詞頻: ${freq.join(" / ")}`);
		if (entry.collins) fm.push(`柯林斯: ${entry.collins}`);
		if (entry.tag?.length) fm.push(`考試: ${entry.tag.join(", ")}`);

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

		// Claude 生成過的內容。花過的 token 就留著,複習時直接看得到。
		if (detail) body.push(DETAIL_HEADING, "", detail.trim(), "");
		if (usage) body.push(USAGE_HEADING, "", usage.trim(), "");

		body.push(SENTENCE_HEADING, "");
		if (sentence) body.push(`> ${sentence.replace(/\n/g, " ")}`, "");

		return fm.join("\n") + body.join("\n");
	}

	// ------------------------------------------------------ FSRS 狀態

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
}
