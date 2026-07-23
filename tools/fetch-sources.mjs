// 下載詞庫來源到 vendor/(gitignored,約 73MB)。
//
//   node tools/fetch-sources.mjs
//
// 兩份來源都是開放授權:
//   ECDICT   (skywind3000)      MIT — 英漢釋義、音標、詞頻、考試標籤、詞形變化
//   ipa-dict (open-dict-data)   MIT — 英式/美式 IPA

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor");

const SOURCES = [
	{
		file: "ecdict.csv",
		url: "https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv",
	},
	{
		file: "lemma.en.txt",
		url: "https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt",
	},
	{
		file: "en_UK.txt",
		url: "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_UK.txt",
	},
	{
		file: "en_US.txt",
		url: "https://raw.githubusercontent.com/open-dict-data/ipa-dict/master/data/en_US.txt",
	},
];

fs.mkdirSync(VENDOR, { recursive: true });

for (const { file, url } of SOURCES) {
	const dest = path.join(VENDOR, file);
	if (fs.existsSync(dest)) {
		const mb = (fs.statSync(dest).size / 1024 / 1024).toFixed(1);
		console.log(`= ${file} already present (${mb} MB)`);
		continue;
	}
	process.stdout.write(`↓ ${file} …`);
	const res = await fetch(url);
	if (!res.ok) {
		console.error(`\n  failed: HTTP ${res.status} ${url}`);
		process.exit(1);
	}
	fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
	console.log(` ${(fs.statSync(dest).size / 1024 / 1024).toFixed(1)} MB`);
}

console.log("\nNow run `npm run build:dict`.");
