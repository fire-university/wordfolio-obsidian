// 開發用:把建置產物複製進 vault 的外掛資料夾。
// vault 在 iCloud,所以不用 symlink(iCloud 對 symlink 的行為不可靠),直接複製。
//
//   node tools/deploy.mjs
//
// 目標路徑可用環境變數覆蓋:WORDFOLIO_VAULT=/path/to/vault

import fs from "fs";
import path from "path";
import os from "os";

const DEFAULT_VAULT = path.join(
	os.homedir(),
	"Library/Mobile Documents/iCloud~md~obsidian/Documents"
);

const vault = process.env.WORDFOLIO_VAULT || DEFAULT_VAULT;
const dest = path.join(vault, ".obsidian/plugins/wordfolio");

if (!fs.existsSync(vault)) {
	console.error(`Vault not found: ${vault}`);
	process.exit(1);
}

fs.mkdirSync(dest, { recursive: true });

const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) {
	if (!fs.existsSync(f)) {
		console.error(`Missing ${f} — run \`npm run build\` first.`);
		process.exit(1);
	}
	fs.copyFileSync(f, path.join(dest, f));
	console.log(`→ ${path.join(dest, f)}`);
}

// 詞庫:正式版由外掛從 GitHub Release 下載,開發時直接複製本地建置好的。
if (fs.existsSync("dict")) {
	const dictDest = path.join(dest, "dict");
	fs.mkdirSync(dictDest, { recursive: true });
	let bytes = 0;
	for (const f of fs.readdirSync("dict")) {
		fs.copyFileSync(path.join("dict", f), path.join(dictDest, f));
		bytes += fs.statSync(path.join("dict", f)).size;
	}
	console.log(`→ ${dictDest}/  (${(bytes / 1024 / 1024).toFixed(1)} MB)`);
} else {
	console.log("… dict/ not built — run `npm run build:dict` to enable lookups.");
}

console.log("\nReload Obsidian (or toggle the plugin off/on) to pick up the change.");
