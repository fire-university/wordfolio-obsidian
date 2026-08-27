// 把生詞本推進 Anki。
//
// 走 AnkiConnect(localhost:8765)——Anki 生態的標準做法,沙拉查詞也是用這個。
// 要 Anki 開著、且裝了 AnkiConnect 外掛。
//
// **單向:Obsidian → Anki。** 不做雙向同步。WordFolio 自己有 FSRS 複習,Anki 也有
// 自己的排程,兩邊各記各的進度;硬要同步只會讓兩份排程互相覆蓋。使用者挑一邊當
// 主力就好,這裡只負責「把字送過去」。

import { requestUrl } from "obsidian";

const ENDPOINT = "http://localhost:8765";

/** 一張要送進 Anki 的卡。 */
export interface AnkiNote {
	word: string;
	phonetic: string;
	meaning: string;
	examples: string;
	/** 點了跳回 Obsidian 那篇筆記 */
	source: string;
}

export interface AnkiResult {
	added: number;
	skipped: number;
}

/** 從 Anki 撈回來的一筆原始筆記。欄位怎麼解讀是 anki-import.ts 的事。 */
export interface AnkiRawNote {
	modelName: string;
	fields: Record<string, string>;
}

/** WordFolio 專用的筆記類型。跟他既有的 Saladict Word 等並存,不去動人家的。 */
export const MODEL = "WordFolio";
const FIELDS = ["Word", "Phonetic", "Meaning", "Examples", "Source"];

export class Anki {
	private async call<T>(action: string, params?: unknown): Promise<T> {
		let res;
		try {
			res = await requestUrl({
				url: ENDPOINT,
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ action, version: 6, params: params ?? {} }),
				throw: false,
			});
		} catch {
			throw new Error("anki:unreachable");
		}
		if (res.status !== 200) throw new Error("anki:unreachable");
		const json = res.json as { result: T; error: string | null };
		if (json.error) throw new Error(json.error);
		return json.result;
	}

	/** Anki 開著且 AnkiConnect 在跑嗎。 */
	async available(): Promise<boolean> {
		try {
			await this.call<number>("version");
			return true;
		} catch {
			return false;
		}
	}

	/** Anki 裡目前有哪些筆記類型。匯入前拿來確認要找的類型真的存在。 */
	async models(): Promise<string[]> {
		return this.call<string[]>("modelNames");
	}

	/**
	 * 反方向:把指定筆記類型的字撈回來。
	 *
	 * 這是 ADR-21 當初沒做的方向。當時只做 Obsidian → Anki,理由是雙向同步會讓
	 * 兩套排程互相覆蓋——那個理由現在還是成立,所以**這裡只拿內容不拿排程**:
	 * 撈欄位(單字、釋義、原句),不碰 Anki 的 due/reps/lapses。排程仍然只有
	 * WordFolio 這一套在寫,沒有誰覆蓋誰的問題。
	 */
	async pull(models: string[]): Promise<AnkiRawNote[]> {
		const out: AnkiRawNote[] = [];
		for (const model of models) {
			const ids = await this.call<number[]>("findNotes", { query: `note:"${model}"` });
			if (!ids.length) continue;
			const infos = await this.call<
				{ modelName: string; fields: Record<string, { value: string }> }[]
			>("notesInfo", { notes: ids });
			for (const note of infos) {
				const fields: Record<string, string> = {};
				for (const [k, v] of Object.entries(note.fields)) fields[k] = v.value;
				out.push({ modelName: note.modelName, fields });
			}
		}
		return out;
	}

	/** 牌組與筆記類型不存在就建起來。已存在的不動。 */
	async ensure(deck: string): Promise<void> {
		const decks = await this.call<string[]>("deckNames");
		if (!decks.includes(deck)) await this.call("createDeck", { deck });

		const models = await this.call<string[]>("modelNames");
		if (!models.includes(MODEL)) {
			await this.call("createModel", {
				modelName: MODEL,
				inOrderFields: FIELDS,
				css: ".card{font-family:-apple-system,sans-serif;font-size:20px;text-align:left;padding:1em}" +
					".word{font-size:28px;font-weight:600}.phon{color:#888;font-size:16px}" +
					".eg{color:#666;font-style:italic;margin-top:.6em}",
				cardTemplates: [
					{
						Name: "Recognition",
						Front: '<div class="word">{{Word}}</div><div class="phon">{{Phonetic}}</div>',
						Back: "{{FrontSide}}<hr id=answer>{{Meaning}}<div class=\"eg\">{{Examples}}</div><div class=\"phon\">{{Source}}</div>",
					},
				],
			});
		}
	}

	/**
	 * 送出。已經有同一個字的就跳過(用 Word 欄位比對,不是靠 Anki 的重複偵測——
	 * 那個只看第一個欄位而且行為隨設定變)。
	 */
	async push(deck: string, notes: AnkiNote[]): Promise<AnkiResult> {
		await this.ensure(deck);

		const existing = new Set(
			await this.call<number[]>("findNotes", { query: `note:"${MODEL}"` }).then(async (ids) => {
				if (!ids.length) return [] as string[];
				const infos = await this.call<{ fields: Record<string, { value: string }> }[]>(
					"notesInfo",
					{ notes: ids }
				);
				return infos.map((n) => (n.fields.Word?.value ?? "").toLowerCase());
			})
		);

		const fresh = notes.filter((n) => !existing.has(n.word.toLowerCase()));
		if (!fresh.length) return { added: 0, skipped: notes.length };

		await this.call("addNotes", {
			notes: fresh.map((n) => ({
				deckName: deck,
				modelName: MODEL,
				fields: {
					Word: n.word,
					Phonetic: n.phonetic,
					Meaning: n.meaning,
					Examples: n.examples,
					Source: n.source,
				},
				tags: ["wordfolio"],
				options: { allowDuplicate: false },
			})),
		});

		return { added: fresh.length, skipped: notes.length - fresh.length };
	}
}
