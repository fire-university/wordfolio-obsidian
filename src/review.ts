// 複習介面:一張一張翻的 Modal。排程邏輯在 schedule.ts。
//
// 為什麼是 FSRS 不是定時彈窗:市面上號稱有複習的字典外掛(Dictionary Lexicon)
// 其實只是「每 N 分鐘跳一次」,沒有難易度回饋,記得跟記不得的字下次都一樣時間
// 再來。FSRS 會依每次評分調整 stability 與 difficulty,把時間花在記不牢的字上。

import { App, Modal, TFile } from "obsidian";
import { t } from "./i18n";
import { gradeCard, Rating, type Grade } from "./schedule";
import type { VocabStore } from "./vocab";
import type { VocabCard } from "./types";

interface Queued {
	file: TFile;
	card: VocabCard;
}

export class ReviewModal extends Modal {
	private queue: Queued[];
	private current: Queued | null = null;
	private answered = false;
	private reviewed = 0;

	constructor(app: App, private store: VocabStore, queue: Queued[]) {
		super(app);
		// 每次順序不同,避免照字母序背成「順序記憶」。
		this.queue = [...queue].sort(() => Math.random() - 0.5);
	}

	onOpen(): void {
		this.modalEl.addClass("wordfolio-review-modal");
		this.next();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private next(): void {
		this.current = this.queue.shift() ?? null;
		this.answered = false;
		if (!this.current) {
			this.renderDone();
			return;
		}
		void this.render();
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		const entry = this.current!;

		contentEl.createDiv({
			cls: "wordfolio-review-progress",
			text: `${this.reviewed + 1} / ${this.reviewed + 1 + this.queue.length}`,
		});
		contentEl.createDiv({ cls: "wordfolio-review-word", text: entry.card.word });

		if (!this.answered) {
			const show = contentEl.createEl("button", {
				cls: "mod-cta wordfolio-review-show",
				text: t("review_show_answer"),
			});
			show.focus();
			show.onclick = () => {
				this.answered = true;
				void this.render();
			};
			// 空白鍵翻面,跟一般閃卡工具一致。
			this.scope.register([], " ", (e) => {
				e.preventDefault();
				show.click();
				return false;
			});
			return;
		}

		// 翻面:讀該字的筆記顯示釋義。生詞本才是事實來源,不重查詞庫——
		// 這樣使用者自己補在筆記裡的註解也會一起出現在複習畫面上。
		const text = await this.app.vault.read(entry.file);
		const body = text
			.replace(/^---[\s\S]*?\n---\n/, "") // frontmatter
			.replace(/^#\s+.*$/m, "") // 標題(就是那個字,正面已經看過了)
			.split("## 我遇到它的地方")[0]
			// 答案面是純文字渲染,markdown 標記會原樣顯示,所以先去掉:
			// ## 標題 → 標題,**粗體** → 粗體。
			.replace(/^#{2,}\s+/gm, "")
			.replace(/\*\*/g, "")
			.replace(/\n{3,}/g, "\n\n")
			.trim();

		contentEl.createDiv({ cls: "wordfolio-review-answer", text: body });

		const buttons = contentEl.createDiv({ cls: "wordfolio-review-buttons" });
		// Grade 是 Rating 去掉 Manual 的子集;複習只會用這四個。
		const grades: [Grade, string][] = [
			[Rating.Again, t("review_again")],
			[Rating.Hard, t("review_hard")],
			[Rating.Good, t("review_good")],
			[Rating.Easy, t("review_easy")],
		];
		grades.forEach(([rating, label], i) => {
			const b = buttons.createEl("button", { text: label });
			b.onclick = () => void this.grade(rating);
			// 1–4 對應四個評分鍵。
			this.scope.register([], String(i + 1), (e) => {
				e.preventDefault();
				b.click();
				return false;
			});
		});
	}

	private async grade(rating: Grade): Promise<void> {
		const entry = this.current!;
		const updated = gradeCard(entry.card, rating);

		await this.store.saveCard(entry.file, updated);
		this.reviewed++;

		// 到期只存到「日」,所以 FSRS 的 learning step 在這裡補回來:
		// 評「重來」的字排到佇列尾端,本次 session 內會再看到一次。
		if (rating === Rating.Again) {
			this.queue.push({ file: entry.file, card: updated });
		}

		this.next();
	}

	private renderDone(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createDiv({
			cls: "wordfolio-review-done",
			text: t("review_done", { count: this.reviewed }),
		});
		const close = contentEl.createEl("button", { cls: "mod-cta", text: "OK" });
		close.focus();
		close.onclick = () => this.close();
	}
}
