// 劍橋詞典的網路層。解析在 cambridge-parse.ts(純函式,可測)。

import { requestUrl } from "obsidian";
import { parseCambridge, BASE, PATH } from "./cambridge-parse";
import type { CambridgeEntry, CambridgeSense } from "./cambridge-parse";

export type { CambridgeEntry, CambridgeSense };

/** 存到磁碟用的最小介面(由 main.ts 接上 Obsidian 的 vault adapter)。 */
export interface CambridgeStore {
	read(name: string): Promise<string | null>;
	write(name: string, data: string): Promise<void>;
}

export class Cambridge {
	/** 查過的字留著。同一個字在一個 session 裡常常會滑到好幾次。 */
	private cache = new Map<string, CambridgeEntry | null>();

	/**
	 * 磁碟快取:查過的字寫成一個小 JSON,**之後離線也看得到,重開 Obsidian 也還在**。
	 *
	 * 劍橋沒辦法整包離線(那要爬人家整站),但「你查過的字」本來就是最可能再查的字。
	 * 一詞一檔而不是一個大 JSON:大檔每查一個字就要整份重寫,而且中途出錯會整包壞掉。
	 */
	private store: CambridgeStore | null = null;

	useStore(store: CambridgeStore): void {
		this.store = store;
	}

	/** 檔名安全化——單字裡可能有撇號或連字號。 */
	private fileFor(key: string): string {
		return `${key.replace(/[^a-z0-9'-]/g, "_")}.json`;
	}

	/** 這個字查過了沒(浮窗重畫時直接用,不重打網路)。 */
	cached(word: string): CambridgeEntry | null | undefined {
		return this.cache.get(word.toLowerCase());
	}

	/**
	 * 查一個字。查不到回 null(不是丟例外)——查無此字是很正常的情況,
	 * 尤其冷僻字或變化形,不該在浮窗上顯示成錯誤。
	 */
	async lookup(word: string, signal?: AbortSignal): Promise<CambridgeEntry | null> {
		const key = word.toLowerCase().trim();
		if (!key) return null;
		const hit = this.cache.get(key);
		if (hit !== undefined) return hit;

		// 先問磁碟。查過的字不必再上網,離線也拿得到。
		if (this.store) {
			try {
				const raw = await this.store.read(this.fileFor(key));
				if (raw) {
					const saved = JSON.parse(raw) as CambridgeEntry;
					this.cache.set(key, saved);
					return saved;
				}
			} catch {
				// 快取壞了就當作沒有,重抓一次。
			}
		}

		// 片語在網址裡用連字號:give up → give-up
		const slug = encodeURIComponent(key.replace(/\s+/g, "-"));
		let html: string;
		try {
			const res = await requestUrl({
				url: `${BASE}${PATH}${slug}`,
				method: "GET",
				headers: {
					// 不帶瀏覽器 UA 的話拿到的可能是簡版頁面。
					"User-Agent":
						"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
					"Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
				},
				throw: false,
			});
			if (res.status !== 200) {
				// **不要快取。** 非 200 可能只是一時的(網路抖一下、對方限流),
				// 記成 null 的話這個字整個 session 都不會再查——症狀會是
				// 「這個字就是查不到,重開才好」。真的沒這個字是走下面 parse 回 null。
				return null;
			}
			html = res.text;
		} catch {
			// 沒網路。不快取——等一下有網路時要能再試。
			throw new Error("cambridge:offline");
		}
		if (signal?.aborted) throw new Error("cambridge:aborted");

		const doc = new DOMParser().parseFromString(html, "text/html");
		const parsed = parseCambridge(doc, word);
		this.cache.set(key, parsed);
		// 只存查得到的。查無此字不用佔磁碟,而且哪天劍橋補了這個字也還能查到。
		if (parsed && this.store) {
			void this.store.write(this.fileFor(key), JSON.stringify(parsed));
		}
		return parsed;
	}
}
