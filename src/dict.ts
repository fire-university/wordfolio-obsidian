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

	/** 測試與除錯用:清掉已載入的 shard。 */
	unloadShards(): void {
		this.shards.clear();
	}
}
