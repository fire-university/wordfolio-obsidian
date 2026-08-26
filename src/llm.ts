// 本地 AI(Ollama)——生成離線詞庫給不出的那幾樣:句中語意、例句用法、字根詞族。
//
// 刻意用本地模型而不是雲端 API:道哥要簡化、不想放 API key、不想把查的字送出去。
// Ollama 在 localhost:11434 提供 OpenAI 相容端點,免 key。透過 Obsidian 的
// requestUrl 呼叫(繞過 CORS)。模型跑不動或沒開時,給清楚的錯誤,不當機。
//
// 這些一律按鈕觸發,不隨 hover 自動呼叫——本地推理也要時間,滑過一排字跑一排
// 模型會很慢。

import { requestUrl } from "obsidian";
import type { Lookup } from "./types";

export interface LLMOptions {
	/** OpenAI 相容端點的 base,如 http://localhost:11434/v1 */
	endpoint: string;
	/** 模型名,如 qwen2.5:7b */
	model: string;
	/** 回答要用哪個語言(跟著外掛的介面語言走) */
	traditional: boolean;
}

export class LocalLLM {
	/** 句中語意:同一個字在同一句話問過就不再問。 */
	private cache = new Map<string, string>();
	/** 例句用法、字詞詳解是「字」層級,單獨快取,加進生詞本時一起寫入。 */
	private usageCache = new Map<string, string>();

	/**
	 * 一次只跑一個請求。本地模型是獨佔資源,平行送只會互相排隊還吃滿記憶體;
	 * 排成序列,前一個做完才做下一個。
	 */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private opts: () => LLMOptions) {}

	private enqueue<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.queue.then(fn, fn);
		this.queue = run.catch(() => undefined);
		return run;
	}

	// -------------------------------------------- 同步讀快取(給浮窗用)
	// 浮窗每次重畫都要問「這個算過了沒」——算過就直接畫,不再排隊、不閃 loading。

	/** 句中語意算過了沒。 */
	cachedExplain(surface: string, sentence: string): string | undefined {
		return this.cache.get(`${surface} ${sentence}`);
	}

	/** 有沒有設定端點(預設 Ollama,通常都有)。 */
	get available(): boolean {
		return this.opts().endpoint.trim().length > 0;
	}

	usageFor(word: string): string | undefined {
		return this.usageCache.get(word.toLowerCase());
	}

	detailFor(word: string): string | undefined {
		return this.usageCache.get(`detail:${word.toLowerCase()}`);
	}

	/**
	 * 列出本地已安裝的模型(給設定頁的下拉選單用)。
	 * Ollama 的 OpenAI 相容端點有 /models。連不上就回空陣列——設定頁自己顯示提示,
	 * 不要在這裡丟例外把設定頁弄壞。
	 */
	async listModels(): Promise<string[]> {
		const base = this.opts().endpoint.trim().replace(/\/+$/, "");
		if (!base) return [];
		try {
			const res = await requestUrl({ url: `${base}/models`, method: "GET", throw: false });
			if (res.status !== 200) return [];
			const ids = (res.json?.data ?? [])
				.map((m: { id?: string }) => m.id)
				.filter((x: unknown): x is string => typeof x === "string");
			return ids.sort();
		} catch {
			return [];
		}
	}

	// -------------------------------------------------------- 底層呼叫

	/** 打一次本地模型,回純文字。連線/模型錯誤都轉成看得懂的訊息。 */
	private async chat(prompt: string, maxTokens: number): Promise<string> {
		const { endpoint, model, traditional } = this.opts();
		const base = endpoint.trim().replace(/\/+$/, "");
		if (!base) {
			throw new Error(traditional ? "還沒設定本地 AI 端點。" : "No local AI endpoint set.");
		}

		let res;
		try {
			res = await requestUrl({
				url: `${base}/chat/completions`,
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					model,
					max_tokens: maxTokens,
					stream: false,
					messages: [{ role: "user", content: prompt }],
				}),
				throw: false,
			});
		} catch (e) {
			// requestUrl 連不上會丟例外——多半是 Ollama 沒開。
			throw new Error(
				traditional
					? `連不上本地 AI（${base}）。確認 Ollama 正在執行。`
					: `Cannot reach local AI (${base}). Is Ollama running?`
			);
		}

		if (res.status === 404) {
			throw new Error(
				traditional
					? `找不到模型「${model}」。用 \`ollama pull ${model}\` 下載，或到設定改模型名。`
					: `Model "${model}" not found. Run \`ollama pull ${model}\`.`
			);
		}
		if (res.status !== 200) {
			const detail = res.json?.error?.message ?? `HTTP ${res.status}`;
			throw new Error(detail);
		}

		const text = (res.json?.choices?.[0]?.message?.content ?? "").trim();
		if (!text) throw new Error(traditional ? "本地 AI 沒有回覆。" : "Empty response.");
		return text;
	}

	// -------------------------------------------------------- 三種生成

	/** 這個字在這句話裡是什麼意思。 */
	async explain(lookup: Lookup, sentence: string): Promise<string> {
		const { traditional } = this.opts();
		const key = `${lookup.surface} ${sentence}`;
		const cached = this.cache.get(key);
		if (cached) return cached;

		const senses = lookup.entry.tr.split("\\n").join("; ");
		const prompt = traditional
			? [
					`句子：${sentence}`,
					`要問的字：${lookup.surface}${
						lookup.inflection ? `（${lookup.entry.w} 的變化形）` : ""
					}`,
					`字典收錄的義項：${senses}`,
					"",
					"請用繁體中文、台灣用語，寫一句話說明這個字在上面這句話裡是哪一個意思。",
					"不要重述整句翻譯，不要列出其他義項，不要加開場白。直接給答案。",
			  ].join("\n")
			: [
					`Sentence: ${sentence}`,
					`Word: ${lookup.surface}`,
					`Dictionary senses: ${senses}`,
					"",
					"In one sentence, say which of these senses applies here. No preamble, no full translation.",
			  ].join("\n");

		const text = await this.enqueue(() => this.chat(prompt, 200));
		this.cache.set(key, text);
		return text;
	}

	/** 例句、常見搭配、近義詞辨析。 */
	async usage(word: string, senses: string): Promise<string> {
		const { traditional } = this.opts();
		const key = word.toLowerCase();
		const cached = this.usageCache.get(key);
		if (cached) return cached;

		const prompt = traditional
			? [
					`單字：${word}`,
					`字典義項：${senses}`,
					"",
					"請給這個字的例句與用法，用繁體中文、台灣用語。格式如下，不要加開場白或結語：",
					"",
					"1. <英文例句>",
					"   <繁中翻譯>",
					"2. <英文例句>",
					"   <繁中翻譯>",
					"3. <英文例句>",
					"   <繁中翻譯>",
					"",
					"搭配：<3-5 個常見搭配，用 / 分隔>",
					"辨析：<跟哪個近義詞容易混淆、差在哪，一到兩句。沒有明顯易混淆的就整行省略>",
					"",
					"例句要自然、日常，涵蓋不同義項；不要用字典式的造句。",
			  ].join("\n")
			: [
					`Word: ${word}`,
					`Dictionary senses: ${senses}`,
					"",
					"Give examples and usage. Follow this format exactly, no preamble:",
					"",
					"1. <example sentence>",
					"2. <example sentence>",
					"3. <example sentence>",
					"",
					"Collocations: <3-5 common ones, separated by />",
					"Confusable with: <the near-synonym people mix it up with and how it differs>",
					"",
					"Sentences should be natural and everyday, covering different senses.",
			  ].join("\n");

		const text = await this.enqueue(() => this.chat(prompt, 700));
		this.usageCache.set(key, text);
		return text;
	}

	/** 字根字首拆解 + 詞族/同根詞。 */
	async detail(word: string, senses: string): Promise<string> {
		const { traditional } = this.opts();
		const key = `detail:${word.toLowerCase()}`;
		const cached = this.usageCache.get(key);
		if (cached) return cached;

		const prompt = traditional
			? [
					`單字：${word}`,
					`字典義項：${senses}`,
					"",
					"請用繁體中文、台灣用語，給這個字的構詞與詞族。格式如下，不要加開場白或結語：",
					"",
					"字根字首：",
					"把字拆成字首/字根/字尾，每個部件標出來源（拉丁或希臘）與意思，說明怎麼合成這個字的意義。若這個字無法有意義地拆解（例如常見的本族短詞），就寫「這個字沒有明顯的字根結構」，不要硬拆。",
					"",
					"詞族：",
					"列出同一個字根衍生出的常見字，每個附一句極短的中文意思，用換行分隔。沒有明顯詞族就寫「無明顯同根詞」。",
			  ].join("\n")
			: [
					`Word: ${word}`,
					`Dictionary senses: ${senses}`,
					"",
					"Give the morphology and word family. Follow this format exactly, no preamble:",
					"",
					"Roots & affixes:",
					"Break the word into prefix/root/suffix, note each part's origin (Latin/Greek) and meaning. If the word has no meaningful decomposition, say so instead of forcing it.",
					"",
					"Word family:",
					"Common words from the same root, each with a very short gloss, one per line. Say 'none' if there isn't a clear family.",
			  ].join("\n");

		const text = await this.enqueue(() => this.chat(prompt, 600));
		this.usageCache.set(key, text);
		return text;
	}

	/** 翻譯一整個片語(離線片語庫沒收到時的退路)。 */
	async translatePhrase(phrase: string): Promise<string> {
		const { traditional } = this.opts();
		const key = `phrase:${phrase.toLowerCase()}`;
		const cached = this.cache.get(key);
		if (cached) return cached;

		const prompt = traditional
			? `翻譯這個英文片語或詞組，用繁體中文、台灣用語，只給翻譯本身，不要造句、不要解釋：\n\n${phrase}`
			: `Translate this English phrase. Give only the translation, no examples, no explanation:\n\n${phrase}`;

		const text = await this.enqueue(() => this.chat(prompt, 120));
		this.cache.set(key, text);
		return text;
	}
}
