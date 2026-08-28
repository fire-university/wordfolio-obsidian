// 本地 AI(Ollama)——生成離線詞庫給不出的那幾樣:句中語意、例句用法、字根詞族。
//
// 刻意用本地模型而不是雲端 API:道哥要簡化、不想放 API key、不想把查的字送出去。
//
// **用 fetch 串流,不是 requestUrl。** 實測 Ollama 對 `app://obsidian.md` 有回
// Access-Control-Allow-Origin,所以瀏覽器 fetch 打得通,可以邊生成邊把字吐進浮窗。
// 這對體感差很多:重點不是「總共跑幾秒」,是「多久看到第一個字」。fetch 失敗時
// (換成不給 CORS 的服務)自動退回 requestUrl 的非串流版,功能不會斷。
//
// 輸出一律壓短。長度直接等於等待時間,而浮窗空間也有限。

import { requestUrl } from "obsidian";
import type { Lookup } from "./types";

export interface LLMOptions {
	/** OpenAI 相容端點的 base,如 http://localhost:11434/v1 */
	endpoint: string;
	/** 模型名,如 qwen2.5:3b */
	model: string;
	/** 回答要用哪個語言(跟著外掛的介面語言走) */
	traditional: boolean;
}

/** 生成時的附加選項:邊生成邊回報、以及中途取消。 */
export interface GenOpts {
	onChunk?: (partial: string) => void;
	signal?: AbortSignal;
}

/** 中途取消時丟這個,呼叫端看到就安靜跳過,不要當成錯誤顯示。 */
export const ABORTED = "wordfolio:aborted";

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

	/** 有沒有設定端點(預設 Ollama,通常都有)。 */
	get available(): boolean {
		return this.opts().endpoint.trim().length > 0;
	}

	// -------------------------------------------- 同步讀快取(給浮窗用)
	// 浮窗每次重畫都要問「這個算過了沒」——算過就直接畫,不再排隊、不閃 loading。

	cachedExplain(surface: string, sentence: string): string | undefined {
		return this.cache.get(`${surface} ${sentence}`);
	}

	usageFor(word: string): string | undefined {
		return this.usageCache.get(word.toLowerCase());
	}

	detailFor(word: string): string | undefined {
		return this.usageCache.get(`detail:${word.toLowerCase()}`);
	}

	/**
	 * 列出本地已安裝的模型(給設定頁的下拉選單用)。
	 * 連不上就回空陣列——設定頁自己顯示提示,不要在這裡丟例外把設定頁弄壞。
	 */
	async listModels(): Promise<string[]> {
		const base = this.base();
		if (!base) return [];
		try {
			const res = await requestUrl({ url: `${base}/models`, method: "GET", throw: false });
			if (res.status !== 200) return [];
			return (res.json?.data ?? [])
				.map((m: { id?: string }) => m.id)
				.filter((x: unknown): x is string => typeof x === "string")
				.sort();
		} catch {
			return [];
		}
	}

	// -------------------------------------------------------- 底層呼叫

	private base(): string {
		return this.opts().endpoint.trim().replace(/\/+$/, "");
	}

	private err(zh: string, en: string): Error {
		return new Error(this.opts().traditional ? zh : en);
	}

	/** 打一次本地模型。優先串流(邊生成邊回報),失敗退回一次性請求。 */
	private async chat(prompt: string, maxTokens: number, gen?: GenOpts): Promise<string> {
		const base = this.base();
		if (!base) throw this.err("還沒設定本地 AI 端點。", "No local AI endpoint set.");

		try {
			return await this.stream(base, prompt, maxTokens, gen);
		} catch (e) {
			if (e instanceof Error && e.message === ABORTED) throw e;
			// 串流打不通(對方沒給 CORS 之類)就退回非串流,功能不要因此壞掉。
			return this.once(base, prompt, maxTokens);
		}
	}

	private async stream(
		base: string,
		prompt: string,
		maxTokens: number,
		gen?: GenOpts
	): Promise<string> {
		const { model } = this.opts();
		const res = await fetch(`${base}/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				model,
				max_tokens: maxTokens,
				stream: true,
				messages: [{ role: "user", content: prompt }],
			}),
			signal: gen?.signal,
		});

		if (res.status === 404) {
			throw this.err(
				`找不到模型「${model}」。用 \`ollama pull ${model}\` 下載，或到設定改模型。`,
				`Model "${model}" not found. Run \`ollama pull ${model}\`.`
			);
		}
		if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let out = "";

		for (;;) {
			let chunk;
			try {
				chunk = await reader.read();
			} catch {
				// abort 會讓 read() 丟例外。
				throw new Error(ABORTED);
			}
			if (chunk.done) break;

			buffer += decoder.decode(chunk.value, { stream: true });
			// SSE:一行一筆 `data: {...}`,最後一行可能只收到一半,留在 buffer 等下一輪。
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				const s = line.trim();
				if (!s.startsWith("data:")) continue;
				const payload = s.slice(5).trim();
				if (!payload || payload === "[DONE]") continue;
				try {
					const delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
					if (delta) {
						out += delta;
						gen?.onChunk?.(out);
					}
				} catch {
					// 半筆 JSON 就跳過,下一輪會補齊。
				}
			}
		}

		if (!out.trim()) throw this.err("本地 AI 沒有回覆。", "Empty response.");
		return out.trim();
	}

	/** 非串流退路。 */
	private async once(base: string, prompt: string, maxTokens: number): Promise<string> {
		const { model } = this.opts();
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
		} catch {
			throw this.err(
				`連不上本地 AI（${base}）。確認 Ollama 正在執行。`,
				`Cannot reach local AI (${base}). Is Ollama running?`
			);
		}
		if (res.status === 404) {
			throw this.err(
				`找不到模型「${model}」。用 \`ollama pull ${model}\` 下載。`,
				`Model "${model}" not found. Run \`ollama pull ${model}\`.`
			);
		}
		if (res.status !== 200) throw new Error(res.json?.error?.message ?? `HTTP ${res.status}`);

		const text = (res.json?.choices?.[0]?.message?.content ?? "").trim();
		if (!text) throw this.err("本地 AI 沒有回覆。", "Empty response.");
		return text;
	}

	/** 所有中文提示共用的硬性要求:繁體、精簡、不要開場白。 */
	private get zhRules(): string {
		return "用繁體中文（台灣用語），不可以出現簡體字。直接給內容，不要開場白、不要結語、不要 Markdown 標記。";
	}

	// -------------------------------------------------------- 三種生成

	/** 這個字在這句話裡是什麼意思。一句話。 */
	async explain(lookup: Lookup, sentence: string, gen?: GenOpts): Promise<string> {
		const { traditional } = this.opts();
		const key = `${lookup.surface} ${sentence}`;
		const cached = this.cache.get(key);
		if (cached) return cached;

		const senses = lookup.entry.tr.split("\\n").join("; ");
		const prompt = traditional
			? [
					`句子：${sentence}`,
					`要問的字：${lookup.surface}`,
					`字典義項：${senses}`,
					"",
					`這個字在這句話裡是哪一個意思？只寫一句話，20 字以內。${this.zhRules}`,
			  ].join("\n")
			: [
					`Sentence: ${sentence}`,
					`Word: ${lookup.surface}`,
					`Dictionary senses: ${senses}`,
					"",
					"Which sense applies here? One short sentence, no preamble.",
			  ].join("\n");

		const text = await this.enqueue(() => this.chat(prompt, 120, gen));
		this.cache.set(key, text);
		return text;
	}

	/** 例句與搭配。刻意壓成固定短格式。 */
	async usage(word: string, senses: string, gen?: GenOpts): Promise<string> {
		const { traditional } = this.opts();
		const key = word.toLowerCase();
		const cached = this.usageCache.get(key);
		if (cached) return cached;

		const prompt = traditional
			? [
					`單字：${word}`,
					`字典義項：${senses}`,
					"",
					"照這個格式寫，總共不要超過五行：",
					"1. <英文例句>｜<繁中翻譯>",
					"2. <英文例句>｜<繁中翻譯>",
					"搭配：<3 個常見搭配，用 / 分隔>",
					"",
					`例句要自然日常、涵蓋不同義項。${this.zhRules}`,
			  ].join("\n")
			: [
					`Word: ${word}`,
					`Dictionary senses: ${senses}`,
					"",
					"Follow this format, five lines max, no preamble:",
					"1. <example sentence>",
					"2. <example sentence>",
					"Collocations: <3 common ones, separated by />",
			  ].join("\n");

		const text = await this.enqueue(() => this.chat(prompt, 220, gen));
		this.usageCache.set(key, text);
		return text;
	}

	/** 字根字首 + 詞族。同樣壓成短格式。 */
	async detail(word: string, senses: string, gen?: GenOpts): Promise<string> {
		const { traditional } = this.opts();
		const key = `detail:${word.toLowerCase()}`;
		const cached = this.usageCache.get(key);
		if (cached) return cached;

		const prompt = traditional
			? [
					`單字：${word}`,
					`字典義項：${senses}`,
					"",
					"照這個格式寫，總共不要超過四行：",
					"拆解：<字首/字根/字尾，各標拉丁或希臘來源與意思>",
					"詞族：<同字根的常見字，最多 4 個，各附兩三個字的中文意思>",
					"",
					`拆不出字根的字（例如常見本族短詞），拆解那行就寫「無明顯字根結構」，不要硬拆。${this.zhRules}`,
			  ].join("\n")
			: [
					`Word: ${word}`,
					"",
					"Follow this format, four lines max, no preamble:",
					"Roots: <prefix/root/suffix with Latin or Greek origin>",
					"Family: <up to 4 words from the same root, each with a short gloss>",
					"",
					"If the word has no meaningful decomposition, say so instead of forcing it.",
			  ].join("\n");

		const text = await this.enqueue(() => this.chat(prompt, 220, gen));
		this.usageCache.set(key, text);
		return text;
	}

	/**
	 * 說明一整個片語(離線片語庫沒收到時的退路)。
	 *
	 * 繁中介面是「翻譯成中文」;英文介面不能也叫它翻譯——把英文片語翻成英文
	 * 沒有意義,那裡要的是**改寫成白話**,所以兩邊問的是不同的問題。
	 */
	async translatePhrase(phrase: string): Promise<string> {
		const { traditional } = this.opts();
		const key = `phrase:${phrase.toLowerCase()}`;
		const cached = this.cache.get(key);
		if (cached) return cached;

		const prompt = traditional
			? `翻譯這個英文片語，只給翻譯本身。${this.zhRules}\n\n${phrase}`
			: `Explain this English phrase in one short, plain sentence. No preamble:\n\n${phrase}`;

		const text = await this.enqueue(() => this.chat(prompt, 80));
		this.cache.set(key, text);
		return text;
	}
}
