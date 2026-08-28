// 把 dict/ 發佈成一個 GitHub Release,標籤是 `dict-<版本>`。
//
//   node tools/release-dict.mjs            # 發佈(不存在就建立,存在就補齊缺的檔)
//   node tools/release-dict.mjs --verify   # 只驗證線上那份,不上傳
//   node tools/release-dict.mjs --force    # 重新上傳全部檔案(--clobber)
//
// 為什麼是獨立的 release、不跟外掛版本綁在一起:詞庫 38.5 MB,而外掛本體
// (main.js + manifest.json + styles.css)不到 300 KB。每發一版外掛就重傳
// 38 MB 沒有意義,而且外掛更新通常不會動到詞庫。
//
// **這個腳本一定會在上傳後回頭驗證。** 從 release 的公開網址真的把 meta.json
// 與幾個 shard 抓回來、比對 sha256——上傳指令回傳 0 不代表使用者抓得到那個檔。
// (踩過:上傳失敗沒檢查,結果做出一個會刪掉整份清單的 commit。)

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DICT = path.join(ROOT, "dict");
const REPO = "fire-university/wordfolio-obsidian";
/** 上傳後要抽驗幾個 shard(全部驗要抓 38 MB,太久)。 */
const SAMPLE = 3;

const args = new Set(process.argv.slice(2));
const VERIFY_ONLY = args.has("--verify");
const FORCE = args.has("--force");

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

function gh(...a) {
	return execFileSync("gh", a, { encoding: "utf8", maxBuffer: 1 << 28 }).trim();
}

// ---------------------------------------------------------------- 先驗本機
const metaPath = path.join(DICT, "meta.json");
if (!fs.existsSync(metaPath)) {
	console.error("dict/meta.json 不存在——先跑 `npm run build:dict`。");
	process.exit(1);
}
const metaRaw = fs.readFileSync(metaPath);
const meta = JSON.parse(metaRaw.toString("utf8"));
const tag = `dict-${meta.version}`;
const files = Object.keys(meta.shards).sort();

console.log(`詞庫 ${meta.version} — ${files.length} 個檔,${meta.entries.toLocaleString()} 個詞條`);

let bad = [];
let total = 0;
for (const f of files) {
	const p = path.join(DICT, f);
	if (!fs.existsSync(p)) {
		bad.push(`${f}(檔案不見了)`);
		continue;
	}
	const buf = fs.readFileSync(p);
	total += buf.length;
	if (sha(buf) !== meta.shards[f]) bad.push(`${f}(sha256 不符)`);
	if (meta.sizes && meta.sizes[f] !== buf.length) bad.push(`${f}(大小不符)`);
}
if (bad.length) {
	console.error(`本機的 dict/ 有問題,不上傳:\n  ${bad.join("\n  ")}`);
	process.exit(1);
}
console.log(`本機校驗通過,共 ${mb(total)}`);

// ---------------------------------------------------------------- 上傳
if (!VERIFY_ONLY) {
	let exists = true;
	try {
		gh("release", "view", tag, "--repo", REPO);
	} catch {
		exists = false;
	}

	const assets = [...files.map((f) => path.join(DICT, f)), path.join(ROOT, "NOTICE.md")];

	if (!exists) {
		console.log(`建立 release ${tag} …`);
		gh(
			"release",
			"create",
			tag,
			"--repo",
			REPO,
			"--title",
			`Offline dictionary ${meta.version}`,
			"--notes",
			[
				`WordFolio 的離線詞庫,${meta.entries.toLocaleString()} 個詞條,共 ${mb(total)}。`,
				"",
				"這不是外掛本身。外掛會在首次啟動時自動下載這裡的檔案,不需要手動抓。",
				"",
				`檔案的 sha256 全部列在 \`meta.json\` 裡,下載時會逐一比對。`,
				"",
				"詞庫由 ECDICT(MIT)、ipa-dict(MIT)與 WordNet 3.1(Princeton)建構而成;",
				"授權與出處見一併附上的 `NOTICE.md`。",
			].join("\n"),
			...assets
		);
	} else {
		console.log(`release ${tag} 已存在,${FORCE ? "重新上傳全部" : "補齊缺的檔"} …`);
		const listed = new Set(
			gh("release", "view", tag, "--repo", REPO, "--json", "assets", "--jq", ".assets[].name")
				.split("\n")
				.filter(Boolean)
		);
		const missing = FORCE ? assets : assets.filter((p) => !listed.has(path.basename(p)));
		if (!missing.length) console.log("  沒有缺的檔");
		else {
			console.log(`  上傳 ${missing.length} 個檔 …`);
			gh("release", "upload", tag, "--repo", REPO, "--clobber", ...missing);
		}
	}
}

// ---------------------------------------------------------------- 回頭驗線上
// 上傳指令沒報錯 ≠ 使用者抓得到。從公開網址真的抓一次。
const base = `https://github.com/${REPO}/releases/download/${tag}`;
console.log(`\n從 ${base} 驗證 …`);

async function fetchAsset(name) {
	const res = await fetch(`${base}/${name}`, { redirect: "follow" });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return Buffer.from(await res.arrayBuffer());
}

let failures = 0;
const ok = (label, good, detail = "") => {
	console.log(`  ${good ? "✓" : "✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!good) failures++;
};

try {
	const remoteMeta = await fetchAsset("meta.json");
	ok("meta.json 抓得到", true, mb(remoteMeta.length));
	ok("meta.json 內容一致", remoteMeta.equals(metaRaw));

	// 抽驗:最大的、最小的,再加一個中間的。壞掉通常壞在極端值上。
	const bySize = [...files].sort((a, b) => (meta.sizes?.[a] ?? 0) - (meta.sizes?.[b] ?? 0));
	const sample = [...new Set([bySize[0], bySize[bySize.length - 1], bySize[bySize.length >> 1]])]
		.slice(0, SAMPLE);
	for (const f of sample) {
		const buf = await fetchAsset(f);
		ok(`${f} sha256 相符`, sha(buf) === meta.shards[f], mb(buf.length));
	}

	const notice = await fetchAsset("NOTICE.md");
	ok("NOTICE.md 一起附上了", notice.includes("WordNet 3.1 Copyright 2011"));

	// 清單完整性:release 上的檔數要跟 meta 對得上。
	const listed = new Set(
		gh("release", "view", tag, "--repo", REPO, "--json", "assets", "--jq", ".assets[].name")
			.split("\n")
			.filter(Boolean)
	);
	const absent = files.filter((f) => !listed.has(f));
	ok(`${files.length} 個檔全部在 release 上`, absent.length === 0, absent.join(", "));
} catch (e) {
	ok(`驗證過程出錯:${e}`, false);
}

console.log(failures === 0 ? "\n線上那份是好的。" : `\n${failures} 項失敗——使用者會抓不到。`);
process.exit(failures === 0 ? 0 : 1);
