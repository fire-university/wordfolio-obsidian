// 從 GitHub Release 下載離線詞庫。
//
// 詞庫是 38.5 MB、54 個檔,太大不能塞進外掛本體(社群市集裝的只有 main.js /
// manifest.json / styles.css),所以走 Release 下載。
//
// 三件事決定了這裡的寫法:
//
//   1. **一定會中斷。** 38 MB 分成 54 個檔,途中關掉 Obsidian、斷線、睡眠都很正常。
//      所以每個檔都先比對本機的 sha256,對得上就跳過——重跑指令等於續傳,
//      不是從頭再來。同一套邏輯順便修復壞掉的檔。
//
//   2. **meta.json 最後才寫。** `dict.load()` 是先讀 meta.json 才算數,所以只要
//      它還沒落地,半套的詞庫就一律視為「沒安裝」,不會出現查得到 a 查不到 b
//      的鬼狀態。開始更新時先把舊的 meta.json 刪掉,理由一樣。
//
//   3. **版本綁在程式碼裡**(`DICT_VERSION`),不去問遠端有沒有新版。外掛認得的
//      詞庫格式跟版本是一起演進的,讓執行期自己去撿最新版,等於允許新資料配舊
//      解析器。要換詞庫就發一版外掛。
//
// 純模組:不 import obsidian。檔案存取與網路都由呼叫端注入,node 測試可以直接跑。

/** meta.json 的內容。`sizes` 是後加的,舊版沒有——沒有就只報檔數。 */
export interface RemoteMeta {
	version: string;
	entries: number;
	phrases?: number;
	inflections?: number;
	/** 檔名 → sha256(小寫 hex) */
	shards: Record<string, string>;
	/** 檔名 → bytes */
	sizes?: Record<string, number>;
}

/** 下載途中回報進度。每處理完一個檔叫一次。 */
export interface Progress {
	/** 已處理的檔數(含跳過的) */
	done: number;
	total: number;
	/** 已處理的位元組(含跳過的) */
	bytes: number;
	/** 全部加起來的位元組;meta 沒有 sizes 時是 0 */
	totalBytes: number;
	/** 剛處理完的檔名 */
	file: string;
	/** true = 本機已有且校驗通過,沒有真的下載 */
	reused: boolean;
}

/** 外界能力:網路與檔案。由 main.ts 接 Obsidian,由測試接記憶體。 */
export interface DownloadIO {
	fetchBinary(url: string): Promise<ArrayBuffer>;
	/** 詞庫資料夾裡的檔;不存在回 null */
	readLocal(name: string): Promise<ArrayBuffer | null>;
	writeLocal(name: string, data: ArrayBuffer): Promise<void>;
	removeLocal(name: string): Promise<void>;
	ensureFolder(): Promise<void>;
}

export interface InstallOptions {
	onProgress?: (p: Progress) => void;
	signal?: AbortSignal;
	/** 每個檔最多試幾次(含第一次)。 */
	attempts?: number;
}

export interface InstallResult {
	version: string;
	entries: number;
	/** 真的下載了幾個檔 */
	downloaded: number;
	/** 本機已有、校驗通過而跳過的 */
	reused: number;
	/** 真的從網路拉了多少位元組 */
	bytes: number;
}

/**
 * 失敗原因。呼叫端拿 `code` 去對應介面語言的訊息——這裡不做 i18n,
 * 因為這個模組不該知道有 i18n 這回事。
 */
export type FailureCode =
	| "aborted" // 使用者取消
	| "http" // 連不上或非 200
	| "meta" // meta.json 抓到了但不是預期的內容
	| "version" // 遠端 meta 的版本跟要求的不一樣
	| "hash" // 重試完仍然校驗不過
	| "write"; // 寫檔失敗

export class DictDownloadError extends Error {
	constructor(
		readonly code: FailureCode,
		message: string,
		readonly file?: string
	) {
		super(message);
		this.name = "DictDownloadError";
	}
}

/** 詞庫的 Release 標籤:`dict-2026-08-28`。跟外掛版本的標籤不會撞。 */
export function dictTag(version: string): string {
	return `dict-${version}`;
}

/** 某個詞庫檔的下載網址。 */
export function dictUrl(base: string, version: string, file: string): string {
	return `${base.replace(/\/+$/, "")}/${dictTag(version)}/${file}`;
}

/** SHA-256 → 小寫 hex。Electron 與 Node 20 都有 Web Crypto,不用外部套件。 */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", data);
	return [...new Uint8Array(digest)]
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}

/** meta.json 至少要有版本與 shards 才算數。 */
export function parseMeta(raw: string): RemoteMeta {
	let obj: unknown;
	try {
		obj = JSON.parse(raw);
	} catch {
		throw new DictDownloadError("meta", "meta.json is not valid JSON");
	}
	const m = obj as RemoteMeta;
	if (!m || typeof m.version !== "string" || !m.version) {
		throw new DictDownloadError("meta", "meta.json has no version");
	}
	if (!m.shards || typeof m.shards !== "object" || !Object.keys(m.shards).length) {
		throw new DictDownloadError("meta", "meta.json lists no files");
	}
	return m;
}

/** 全部檔案加起來多少位元組;meta 沒有 sizes 就回 0。 */
export function totalBytes(meta: RemoteMeta): number {
	if (!meta.sizes) return 0;
	return Object.keys(meta.shards).reduce((n, f) => n + (meta.sizes?.[f] ?? 0), 0);
}

/** 給進度文字用:1536000 → "1.5 MB"。 */
export function formatMB(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function decode(buf: ArrayBuffer): string {
	return new TextDecoder().decode(buf);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DictDownloadError("aborted", "cancelled");
}

/**
 * 下載(或補齊)整份詞庫。
 *
 * 可以重複執行:已經在本機、而且 sha256 對得上的檔會直接跳過,所以中斷之後
 * 再跑一次就是續傳。回傳實際下載了幾個檔、用了多少流量。
 */
export async function installDictionary(
	base: string,
	version: string,
	io: DownloadIO,
	opts: InstallOptions = {}
): Promise<InstallResult> {
	const attempts = Math.max(1, opts.attempts ?? 3);
	throwIfAborted(opts.signal);

	await io.ensureFolder();

	// 先把舊的 meta.json 拿掉:途中失敗時,半新半舊的 shard 配一份宣稱「裝好了」
	// 的 meta,比乾脆顯示「沒裝」危險得多。
	await io.removeLocal("meta.json").catch(() => undefined);

	let metaRaw: ArrayBuffer;
	try {
		metaRaw = await io.fetchBinary(dictUrl(base, version, "meta.json"));
	} catch (e) {
		throw new DictDownloadError("http", String(e), "meta.json");
	}

	const meta = parseMeta(decode(metaRaw));
	if (meta.version !== version) {
		throw new DictDownloadError(
			"version",
			`expected ${version}, release has ${meta.version}`,
			"meta.json"
		);
	}

	const files = Object.keys(meta.shards).sort();
	const total = files.length;
	const totalSize = totalBytes(meta);

	let done = 0;
	let bytesSeen = 0;
	let downloadedBytes = 0;
	let downloaded = 0;
	let reused = 0;

	for (const file of files) {
		throwIfAborted(opts.signal);
		const want = meta.shards[file];
		const size = meta.sizes?.[file] ?? 0;

		// 已經在本機而且是對的?跳過。這就是續傳。
		const existing = await io.readLocal(file).catch(() => null);
		if (existing && (await sha256Hex(existing)) === want) {
			reused++;
			done++;
			bytesSeen += size;
			opts.onProgress?.({ done, total, bytes: bytesSeen, totalBytes: totalSize, file, reused: true });
			continue;
		}

		let lastErr = "";
		let ok = false;
		for (let i = 0; i < attempts && !ok; i++) {
			throwIfAborted(opts.signal);
			try {
				const buf = await io.fetchBinary(dictUrl(base, version, file));
				if ((await sha256Hex(buf)) !== want) {
					lastErr = "checksum mismatch";
					continue;
				}
				await io.writeLocal(file, buf);
				downloadedBytes += buf.byteLength;
				ok = true;
			} catch (e) {
				if (e instanceof DictDownloadError && e.code === "aborted") throw e;
				lastErr = String(e);
			}
		}
		if (!ok) {
			throw new DictDownloadError(
				lastErr === "checksum mismatch" ? "hash" : "http",
				lastErr,
				file
			);
		}

		downloaded++;
		done++;
		bytesSeen += size;
		opts.onProgress?.({ done, total, bytes: bytesSeen, totalBytes: totalSize, file, reused: false });
	}

	// 全部齊了才寫 meta.json——它落地才代表「這份詞庫可以用」。
	throwIfAborted(opts.signal);
	try {
		await io.writeLocal("meta.json", metaRaw);
	} catch (e) {
		throw new DictDownloadError("write", String(e), "meta.json");
	}

	return {
		version: meta.version,
		entries: meta.entries,
		downloaded,
		reused,
		bytes: downloadedBytes,
	};
}
