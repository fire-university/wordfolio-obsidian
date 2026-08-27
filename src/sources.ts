// 線上詞典來源的網路層:抓頁面 → 解析 → 記憶體與磁碟快取。
//
// 一個通用的類別餵不同的「來源定義」,而不是每家詞典複製一份幾乎一樣的類別。
// 解析全部在 sources-parse.ts / cambridge-parse.ts(純函式,可測)。

import { requestUrl } from "obsidian";
import type { SourceEntry } from "./sources-parse";

/** 存到磁碟用的最小介面(由 main.ts 接上 Obsidian 的 vault adapter)。 */
export interface SourceStore {
	read(name: string): Promise<string | null>;
	write(name: string, data: string): Promise<void>;
}

export interface SourceDef {
	/** 用在磁碟快取的資料夾名 */
	id: string;
	url(word: string): string;
	parse(doc: Document, word: string): SourceEntry | null;
	/** 回應不是 HTML 而是包著 HTML 的 JSON 時(Wiktionary),從原始回應取出 HTML */
	html?(raw: string): string;
}

const UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export class WebSource {
	/** 查過的字留著。同一個字在一個 session 裡常常會滑到好幾次。 */
	private cache = new Map<string, SourceEntry | null>();
	private store: SourceStore | null = null;

	constructor(private def: SourceDef) {}

	get id(): string {
		return this.def.id;
	}

	useStore(store: SourceStore): void {
		this.store = store;
	}

	/** 這個字查過了沒(浮窗重畫時直接用,不重打網路)。 */
	cached(word: string): SourceEntry | null | undefined {
		return this.cache.get(word.toLowerCase().trim());
	}

	private fileFor(key: string): string {
		return `${key.replace(/[^a-z0-9'-]/g, "_")}.json`;
	}

	/**
	 * 查一個字。查不到回 null(不是丟例外)——查無此字很正常,尤其冷僻字或變化形,
	 * 不該在浮窗上顯示成錯誤。
	 */
	async lookup(word: string, signal?: AbortSignal): Promise<SourceEntry | null> {
		const key = word.toLowerCase().trim();
		if (!key) return null;

		const hit = this.cache.get(key);
		if (hit !== undefined) return hit;

		// 先問磁碟。查過的字不必再上網,離線也拿得到。
		if (this.store) {
			try {
				const raw = await this.store.read(`${this.def.id}/${this.fileFor(key)}`);
				if (raw) {
					const saved = JSON.parse(raw) as SourceEntry;
					this.cache.set(key, saved);
					return saved;
				}
			} catch {
				// 快取壞了就當作沒有,重抓一次。
			}
		}

		let body: string;
		try {
			const res = await requestUrl({
				url: this.def.url(key),
				method: "GET",
				headers: { "User-Agent": UA, "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8" },
				throw: false,
			});
			// 非 200 **不快取**:可能只是一時的(網路抖、對方限流)。記成 null 的話
			// 這個字整個 session 都不會再查,症狀會是「這個字就是查不到,重開才好」。
			if (res.status !== 200) return null;
			body = res.text;
		} catch {
			throw new Error("source:offline");
		}
		if (signal?.aborted) throw new Error("source:aborted");

		const html = this.def.html ? this.def.html(body) : body;
		const parsed = this.def.parse(new DOMParser().parseFromString(html, "text/html"), word);
		this.cache.set(key, parsed);

		// 只存查得到的:查無此字不用佔磁碟,而且哪天對方補了這個字也還能查到。
		if (parsed && this.store) {
			void this.store.write(`${this.def.id}/${this.fileFor(key)}`, JSON.stringify(parsed));
		}
		return parsed;
	}
}
