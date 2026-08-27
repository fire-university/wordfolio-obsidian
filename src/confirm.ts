// 一個「確定嗎」對話框。
//
// 匯入會一次在 vault 裡建幾百篇筆記,這種規模的寫入應該先把數字攤開來給人看,
// 不是按下去才知道發生了什麼。

import { App, Modal } from "obsidian";
import { t } from "./i18n";

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private body: string,
		private confirmText: string,
		private onConfirm: () => void
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });
		// 內文可能有好幾行(每個來源一行),照換行拆開比塞成一段好讀。
		const box = contentEl.createDiv({ cls: "wordfolio-confirm-body" });
		for (const line of this.body.split("\n")) box.createDiv({ text: line });

		const buttons = contentEl.createDiv({ cls: "wordfolio-confirm-buttons" });
		const cancel = buttons.createEl("button", { text: t("confirm_cancel") });
		cancel.onclick = () => this.close();

		const ok = buttons.createEl("button", { cls: "mod-cta", text: this.confirmText });
		ok.onclick = () => {
			this.close();
			this.onConfirm();
		};
		ok.focus();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
