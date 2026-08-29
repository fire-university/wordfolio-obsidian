// 離線詞庫:shard 的延遲載入與查詢。
//
// hover 是高頻操作,所以:
//   - 只在真的查到某個字母時才 parse 該 shard(1MB 左右,個位數毫秒)
//   - parse 過的 shard 常駐,不重複 parse
//   - inflect.json 相對小(約 3.4MB),開機時一次載入,因為每次查詢都要用
//
// 檔案存取抽成 ReadFile 介面,讓 node 測試可以直接餵檔案系統,
// 外掛裡則接 Obsidian 的 vault adapter。

import type { DictEntry, DictMeta, DictShard, Lookup } from "./types";
import { resolveLemma, InflectionMap } from "./lemma";

/** 讀一個詞庫檔;找不到回 null。路徑相對於詞庫資料夾。 */
export type ReadFile = (name: string) => Promise<string | null>;

function shardKey(word: string): string {
	const c = word[0]?.toLowerCase() ?? "";
	return c >= "a" && c <= "z" ? c : "other";
}

export class Dictionary {
	private shards = new Map<string, DictShard>();
	private inflect: InflectionMap = {};
	private meta: DictMeta | null = null;
	private ready = false;

	constructor(private readFile: ReadFile) {}

	get installed(): boolean {
		return this.ready;
	}

	get version(): string {
		return this.meta?.version ?? "";
	}

	get entryCount(): number {
		return this.meta?.entries ?? 0;
	}

	/** 載入 meta 與變化形對照表。詞條 shard 留到第一次查到才載。 */
	async load(): Promise<boolean> {
		const metaRaw = await this.readFile("meta.json");
		if (!metaRaw) return false;

		try {
			this.meta = JSON.parse(metaRaw) as DictMeta;
		} catch {
			return false;
		}

		const inflectRaw = await this.readFile("inflect.json");
		this.inflect = inflectRaw ? (JSON.parse(inflectRaw) as InflectionMap) : {};

		this.ready = true;
		return true;
	}

	private async shard(key: string): Promise<DictShard | null> {
		const cached = this.shards.get(key);
		if (cached) return cached;

		const raw = await this.readFile(`${key}.json`);
		if (!raw) return null;

		const parsed = JSON.parse(raw) as DictShard;
		this.shards.set(key, parsed);
		return parsed;
	}

	private async entry(word: string): Promise<DictEntry | null> {
		const lower = word.toLowerCase();
		const shard = await this.shard(shardKey(lower));
		return shard?.[lower] ?? null;
	}

	/**
	 * 查一個字。
	 *
	 * 先試原字;是變化形的話改用原形的詞條當主體,因為變化形自己的釋義常常
	 * 是冷僻義項(`unnerving` → 「[醫] 除神經法」)。變化形若有自己的、且真的
	 * 不同的釋義,一併帶回讓浮窗附在後面。
	 */
	async lookup(surface: string): Promise<Lookup | null> {
		if (!this.ready) return null;

		const clean = surface.trim();
		if (!clean) return null;

		const direct = await this.entry(clean);
		const resolved = resolveLemma(clean, this.inflect);

		if (!resolved) {
			return direct ? { entry: direct, surface: clean } : null;
		}

		const lemmaEntry = await this.entry(resolved.lemma);
		if (!lemmaEntry) {
			// 詞庫沒收原形(釋義篩選濾掉了),那就用變化形自己的。
			return direct ? { entry: direct, surface: clean } : null;
		}

		const out: Lookup = {
			entry: lemmaEntry,
			surface: clean,
			inflection: resolved.kind,
		};
		if (direct && direct.tr !== lemmaEntry.tr) out.surfaceEntry = direct;
		return out;
	}

	/**
	 * 查片語(使用者選取多個字時走這條)。
	 *
	 * 片語存在獨立的 p{letter}.json,只有這裡會載入——單字 hover 不碰,
	 * 所以高頻的單字查詢不受片語資料量拖累。
	 *
	 * 只做正規化後的精確比對:多個空白併一個、大小寫忽略、去頭尾標點。
	 * 不做詞形還原(片語的變化形太發散,ECDICT 本來就分開收「give up / gave up」)。
	 */
	async lookupPhrase(text: string): Promise<DictEntry | null> {
		if (!this.ready) return null;

		const phrase = text
			.toLowerCase()
			.replace(/[^a-z'\s-]/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (!phrase.includes(" ")) return null; // 單字走 lookup(),不走這裡

		const first = phrase[0];
		if (first < "a" || first > "z") return null;

		// 用同一套 shard 快取。片語 key 是 "pa"/"pb"…,不會跟單字的 "a"/"b" 撞。
		const shard = await this.shard(`p${first}`);
		return shard?.[phrase] ?? null;
	}

	/**
	 * 這個字在詞庫裡的第一句例句(WordNet,覆蓋約 28%)。
	 *
	 * **同步,只看已經載入記憶體的 shard。** 複習卡是同步繪製的,而要複習的字
	 * 剛剛才被查過釋義,它的 shard 一定已經在記憶體裡;沒有就回 null,
	 * 答案卡少一段而已,不值得為了一句例句讓整張卡變成非同步繪製。
	 */
	cachedExample(word: string): string | null {
		const lower = word.trim().toLowerCase();
		if (!lower) return null;
		const shard = this.shards.get(shardKey(lower));
		const ex = shard?.[lower]?.ex;
		return ex?.length ? ex[0] : null;
	}

	/** 測試與除錯用:清掉已載入的 shard。 */
	unloadShards(): void {
		this.shards.clear();
	}
}
