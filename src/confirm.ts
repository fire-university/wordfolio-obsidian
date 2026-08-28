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
		private onConfirm: () => void,
		/** 按下取消(或直接關掉)時要做的事。首次安裝引導靠它補一句提示。 */
		private onCancel?: () => void,
		/** 取消鍵的字。不給就用預設的「取消」。 */
		private cancelText?: string
	) {
		super(app);
	}

	/** 有沒有走過確定那條路。沒有的話,關閉時算取消。 */
	private confirmed = false;

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h3", { text: this.title });
		// 內文可能有好幾行(每個來源一行),照換行拆開比塞成一段好讀。
		const box = contentEl.createDiv({ cls: "wordfolio-confirm-body" });
		for (const line of this.body.split("\n")) box.createDiv({ text: line });

		const buttons = contentEl.createDiv({ cls: "wordfolio-confirm-buttons" });
		const cancel = buttons.createEl("button", { text: this.cancelText ?? t("confirm_cancel") });
		cancel.onclick = () => this.close();

		const ok = buttons.createEl("button", { cls: "mod-cta", text: this.confirmText });
		ok.onclick = () => {
			this.confirmed = true;
			this.close();
			this.onConfirm();
		};
		ok.focus();
	}

	onClose(): void {
		this.contentEl.empty();
		// 按 Esc、點框外關掉,跟按「取消」是同一件事——使用者的意思都是「先不要」。
		if (!this.confirmed) this.onCancel?.();
	}
}
