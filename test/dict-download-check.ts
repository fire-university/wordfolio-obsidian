// 詞庫下載的測試。全部在記憶體裡跑,不碰網路、不碰檔案系統、不碰 Obsidian。
//
//   npx tsx test/dict-download-check.ts
//
// 這裡真正要守住的是三件會讓使用者受害、但畫面上看不出來的事:
//   1. 半套的詞庫不可以看起來像裝好了(meta.json 一定最後才寫)
//   2. 中斷之後重跑要續傳,不是從頭再抓 38 MB
//   3. 抓下來的內容壞掉要擋住,不能寫進去

import {
	installDictionary,
	dictUrl,
	dictTag,
	parseMeta,
	totalBytes,
	formatMB,
	sha256Hex,
	DictDownloadError,
	type DownloadIO,
	type RemoteMeta,
	type Progress,
} from "../src/dict-download";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const BASE = "https://github.com/fire-university/wordfolio-obsidian/releases/download";
const VERSION = "2026-08-28";

const enc = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

/** 建一個假的 Release:三個 shard,內容自己編。 */
async function makeRemote(): Promise<{ meta: RemoteMeta; files: Map<string, ArrayBuffer> }> {
	const bodies: Record<string, string> = {
		"a.json": JSON.stringify({ apple: { w: "apple", tr: "蘋果" } }),
		"b.json": JSON.stringify({ book: { w: "book", tr: "書" } }),
		"inflect.json": JSON.stringify({ apples: "apple" }),
	};
	const shards: Record<string, string> = {};
	const sizes: Record<string, number> = {};
	const files = new Map<string, ArrayBuffer>();
	for (const [name, body] of Object.entries(bodies)) {
		const buf = enc(body);
		shards[name] = await sha256Hex(buf);
		sizes[name] = buf.byteLength;
		files.set(name, buf);
	}
	const meta: RemoteMeta = { version: VERSION, entries: 2, shards, sizes };
	files.set("meta.json", enc(JSON.stringify(meta)));
	return { meta, files };
}

/** 記憶體版的 IO。可以指定某個檔要失敗幾次、或永遠回壞資料。 */
function makeIO(
	remote: Map<string, ArrayBuffer>,
	opts: { failTimes?: Record<string, number>; corrupt?: Set<string>; offline?: Set<string> } = {}
) {
	const disk = new Map<string, ArrayBuffer>();
	const fetched: string[] = [];
	const failTimes = { ...(opts.failTimes ?? {}) };
	let folderMade = false;

	const io: DownloadIO = {
		async fetchBinary(url: string) {
			const name = url.split("/").pop() ?? "";
			fetched.push(name);
			if (opts.offline?.has(name)) throw new Error("ENOTFOUND");
			if (failTimes[name] > 0) {
				failTimes[name]--;
				throw new Error("HTTP 500");
			}
			if (opts.corrupt?.has(name)) return enc("garbage");
			const buf = remote.get(name);
			if (!buf) throw new Error("HTTP 404");
			return buf;
		},
		async readLocal(name) {
			return disk.get(name) ?? null;
		},
		async writeLocal(name, data) {
			disk.set(name, data);
		},
		async removeLocal(name) {
			disk.delete(name);
		},
		async ensureFolder() {
			folderMade = true;
		},
	};
	return { io, disk, fetched, made: () => folderMade };
}

async function main() {
	const { meta, files } = await makeRemote();

	// ---------------------------------------------------------------- 純函式
	console.log("網址與 meta 解析");
	check("標籤是 dict-<版本>", dictTag(VERSION) === "dict-2026-08-28", dictTag(VERSION));
	check(
		"檔案網址",
		dictUrl(BASE, VERSION, "a.json") === `${BASE}/dict-${VERSION}/a.json`,
		dictUrl(BASE, VERSION, "a.json")
	);
	check(
		"base 尾端多的斜線不會變成兩條",
		dictUrl(BASE + "/", VERSION, "a.json") === `${BASE}/dict-${VERSION}/a.json`
	);
	check("總位元組", totalBytes(meta) === (meta.sizes!["a.json"] + meta.sizes!["b.json"] + meta.sizes!["inflect.json"]));
	check("舊版 meta 沒有 sizes 就回 0", totalBytes({ ...meta, sizes: undefined }) === 0);
	check("MB 格式", formatMB(1024 * 1024 * 38.46) === "38.5 MB", formatMB(1024 * 1024 * 38.46));

	for (const [label, raw] of [
		["不是 JSON", "<html>404</html>"],
		["沒有版本", '{"entries":1,"shards":{"a.json":"x"}}'],
		["沒有檔案清單", '{"version":"1","shards":{}}'],
	] as [string, string][]) {
		let code = "";
		try {
			parseMeta(raw);
		} catch (e) {
			code = e instanceof DictDownloadError ? e.code : "?";
		}
		check(`壞的 meta 擋下來(${label})`, code === "meta", code);
	}

	// ---------------------------------------------------------------- 正常路徑
	console.log("\n乾淨安裝");
	{
		const { io, disk, made } = makeIO(files);
		const seen: Progress[] = [];
		const res = await installDictionary(BASE, VERSION, io, { onProgress: (p) => seen.push(p) });
		check("先建資料夾", made());
		check("三個檔都下載", res.downloaded === 3 && res.reused === 0, JSON.stringify(res));
		check("詞條數從 meta 來", res.entries === 2);
		check("meta.json 有寫進去", disk.has("meta.json"));
		check("shard 都在", disk.has("a.json") && disk.has("b.json") && disk.has("inflect.json"));
		check("進度回報三次", seen.length === 3, `${seen.length} 次`);
		check(
			"進度累加到全部",
			seen[seen.length - 1].done === 3 && seen[seen.length - 1].bytes === totalBytes(meta)
		);
		check("進度知道總量", seen[0].totalBytes === totalBytes(meta));
	}

	// ---------------------------------------------------------------- 續傳
	console.log("\n中斷之後重跑要續傳");
	{
		const { io, disk, fetched } = makeIO(files);
		// 假裝上一輪已經抓好 a.json
		await io.writeLocal("a.json", files.get("a.json")!);
		const res = await installDictionary(BASE, VERSION, io, {});
		check("已存在且正確的檔跳過", res.reused === 1 && res.downloaded === 2, JSON.stringify(res));
		check("跳過的檔沒有再抓一次", !fetched.filter((f) => f === "a.json").length, fetched.join(","));
		check("meta.json 仍然寫好", disk.has("meta.json"));
	}

	console.log("\n本機的檔壞掉會被換掉,不是跳過");
	{
		const { io, disk } = makeIO(files);
		await io.writeLocal("a.json", enc("這是壞掉的內容"));
		const res = await installDictionary(BASE, VERSION, io, {});
		check("壞檔重抓", res.downloaded === 3 && res.reused === 0, JSON.stringify(res));
		check(
			"磁碟上換成正確內容",
			(await sha256Hex(disk.get("a.json")!)) === meta.shards["a.json"]
		);
	}

	// ---------------------------------------------------------------- 半套不能像裝好了
	console.log("\n半套的詞庫不可以看起來像裝好了");
	{
		const { io, disk } = makeIO(files, { offline: new Set(["b.json"]) });
		let code = "";
		try {
			await installDictionary(BASE, VERSION, io, { attempts: 2 });
		} catch (e) {
			code = e instanceof DictDownloadError ? e.code : "?";
		}
		check("失敗有丟出來", code === "http", code);
		check("meta.json 沒有寫下去", !disk.has("meta.json"));
		check("抓到的那一個還留著(下次續傳)", disk.has("a.json"));
	}

	console.log("\n更新途中失敗,舊的 meta.json 也要先拿掉");
	{
		const { io, disk } = makeIO(files, { offline: new Set(["b.json"]) });
		await io.writeLocal("meta.json", enc('{"version":"2020-01-01","entries":1,"shards":{}}'));
		try {
			await installDictionary(BASE, VERSION, io, { attempts: 1 });
		} catch {
			/* 預期會失敗 */
		}
		check("舊 meta 不會留下來謊報「裝好了」", !disk.has("meta.json"));
	}

	// ---------------------------------------------------------------- 校驗與重試
	console.log("\n內容校驗");
	{
		const { io, disk } = makeIO(files, { corrupt: new Set(["b.json"]) });
		let err: DictDownloadError | null = null;
		try {
			await installDictionary(BASE, VERSION, io, { attempts: 3 });
		} catch (e) {
			err = e as DictDownloadError;
		}
		check("sha256 對不上就失敗", err?.code === "hash", err?.code ?? "沒失敗");
		check("指出是哪個檔", err?.file === "b.json", err?.file ?? "");
		check("壞內容沒有寫進磁碟", !disk.has("b.json"));
	}

	{
		const { io, fetched } = makeIO(files, { failTimes: { "b.json": 2 } });
		const res = await installDictionary(BASE, VERSION, io, { attempts: 3 });
		check("暫時性錯誤會重試到成功", res.downloaded === 3, JSON.stringify(res));
		check("b.json 抓了三次", fetched.filter((f) => f === "b.json").length === 3);
	}

	{
		const { io } = makeIO(files, { failTimes: { "b.json": 5 } });
		let code = "";
		try {
			await installDictionary(BASE, VERSION, io, { attempts: 3 });
		} catch (e) {
			code = e instanceof DictDownloadError ? e.code : "?";
		}
		check("重試用完就放棄", code === "http", code);
	}

	// ---------------------------------------------------------------- 版本與取消
	console.log("\n版本與取消");
	{
		const wrong = new Map(files);
		wrong.set("meta.json", enc(JSON.stringify({ ...meta, version: "1999-01-01" })));
		const { io } = makeIO(wrong);
		let code = "";
		try {
			await installDictionary(BASE, VERSION, io, {});
		} catch (e) {
			code = e instanceof DictDownloadError ? e.code : "?";
		}
		check("遠端版本對不上就停手", code === "version", code);
	}

	{
		const { io, disk } = makeIO(files);
		const ac = new AbortController();
		ac.abort();
		let code = "";
		try {
			await installDictionary(BASE, VERSION, io, { signal: ac.signal });
		} catch (e) {
			code = e instanceof DictDownloadError ? e.code : "?";
		}
		check("一開始就取消", code === "aborted", code);
		check("什麼都沒寫", disk.size === 0);
	}

	{
		// 抓完第一個檔就取消
		const { io, disk } = makeIO(files);
		const ac = new AbortController();
		let code = "";
		try {
			await installDictionary(BASE, VERSION, io, {
				signal: ac.signal,
				onProgress: () => ac.abort(),
			});
		} catch (e) {
			code = e instanceof DictDownloadError ? e.code : "?";
		}
		check("中途取消", code === "aborted", code);
		check("取消後沒有 meta.json", !disk.has("meta.json"));
		check("已抓好的檔留著給下次續傳", disk.size > 0, `${disk.size} 個檔`);
	}

	console.log(failures === 0 ? "\n全部通過" : `\n${failures} 項失敗`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
