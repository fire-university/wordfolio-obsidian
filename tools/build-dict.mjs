// 詞庫建構管線(建構期執行,產物不進版控)。
//
//   node tools/build-dict.mjs [--stats]
//
// 輸入(vendor/,由 fetch-sources.mjs 下載):
//   ecdict.csv    ECDICT 主檔,約 77 萬詞條
//   en_UK.txt     ipa-dict 英式 IPA
//   en_US.txt     ipa-dict 美式 IPA
//   lemma.en.txt  ECDICT 的 lemma 對照(補不規則變化)
//
// 輸出(dict/):
//   a.json … z.json  依首字母切的詞條 shard
//   other.json       非 a–z 開頭的詞條
//   inflect.json     變化形 → 原形
//   meta.json        版本、詞條數、各 shard 的 sha256
//
// 為什麼切 shard:hover 是高頻操作,每次查詢只 parse 一個 1–3MB 的小檔,
// 比一次載入整包 30MB+ 進記憶體體感好得多,也讓日後上行動裝置不用重寫。

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import OpenCC from "opencc-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VENDOR = path.join(ROOT, "vendor");
const OUT = path.join(ROOT, "dict");
const STATS_ONLY = process.argv.includes("--stats");

// ---------------------------------------------------------------- CSV

// ECDICT 的欄位裡有帶逗號的引號欄(音標、釋義),所以不能用 split(",")。
// 換行在檔案裡是字面的 "\n" 兩個字元,不是真的換行,但仍用完整狀態機比較保險。
function* parseCsv(text) {
	let field = "";
	let row = [];
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];

		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				field += c;
			}
			continue;
		}

		if (c === '"') {
			inQuotes = true;
		} else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n") {
			row.push(field);
			yield row;
			row = [];
			field = "";
		} else if (c !== "\r") {
			field += c;
		}
	}

	if (field !== "" || row.length) {
		row.push(field);
		yield row;
	}
}

// ---------------------------------------------------------- 簡繁轉換

const convert = OpenCC.Converter({ from: "cn", to: "twp" });

// twp 會做詞組替換,偶爾會撞出重複詞。例:「最优化」先命中「优化 → 最佳化」
// 就變成「最最佳化」。這裡收已知的過度轉換,發現新的就往下加。
const OVERCONVERSION_FIXES = [
	[/最最佳化/g, "最佳化"],
	[/最最佳解/g, "最佳解"],
	[/裡裡面/g, "裡面"],
];

// 轉換後同一行裡可能出現重複詞:原文「优化, 最优化」兩個不同的詞
// 都命中「优化 → 最佳化」,變成「最佳化, 最佳化」。逐行去重,保留原順序。
function dedupeTerms(line) {
	if (!line.includes(",")) return line;
	// 詞性前綴(如 "n. ")要留著,只對後面的詞去重。
	const m = line.match(/^([a-zA-Z]+\.\s*|\[[^\]]+\]\s*)?(.*)$/s);
	const prefix = m?.[1] ?? "";
	const body = m?.[2] ?? line;

	const seen = new Set();
	const kept = [];
	for (const part of body.split(",")) {
		const term = part.trim();
		if (!term) continue;
		if (seen.has(term)) continue;
		seen.add(term);
		kept.push(term);
	}
	return kept.length ? prefix + kept.join(", ") : line;
}

function toTraditional(s) {
	if (!s) return "";
	let out = convert(s);
	for (const [re, to] of OVERCONVERSION_FIXES) out = out.replace(re, to);
	// ECDICT 的釋義用字面的 "\n" 分行(不是真的換行字元)。
	return out
		.split("\\n")
		.map(dedupeTerms)
		.join("\\n");
}

// -------------------------------------------------------------- ipa-dict

// 格式:word\t/ipa/  或  word\t/ipa1/, /ipa2/
// 只取第一個發音,浮窗空間有限,列一堆變體反而難讀。
function loadIpa(file) {
	const map = new Map();
	const text = fs.readFileSync(path.join(VENDOR, file), "utf8");
	for (const line of text.split("\n")) {
		const tab = line.indexOf("\t");
		if (tab < 0) continue;
		const word = line.slice(0, tab).trim().toLowerCase();
		const ipa = line.slice(tab + 1).split(",")[0].trim();
		if (word && ipa && !map.has(word)) map.set(word, ipa);
	}
	return map;
}

// --------------------------------------------------------- exchange 欄

// 兩種寫法:
//   原形列   p:rankled/d:rankled/i:rankling/3:rankles   (原形 → 各變化形)
//   變化形列 0:run/1:i                                  (變化形 → 原形 + 類型)
const KIND_BY_CODE = {
	p: "past",
	d: "done",
	i: "ing",
	3: "third",
	s: "plural",
	r: "comparative",
	t: "superlative",
};

function parseExchange(exch) {
	const parts = {};
	if (!exch) return parts;
	for (const seg of exch.split("/")) {
		const colon = seg.indexOf(":");
		if (colon < 0) continue;
		const code = seg.slice(0, colon);
		const value = seg.slice(colon + 1).trim();
		if (value) parts[code] = value;
	}
	return parts;
}

// ------------------------------------------------------------- 主流程

function shardKey(word) {
	const c = word[0]?.toLowerCase();
	return c >= "a" && c <= "z" ? c : "other";
}

function main() {
	console.log("Reading ecdict.csv …");
	const csv = fs.readFileSync(path.join(VENDOR, "ecdict.csv"), "utf8");

	console.log("Loading ipa-dict …");
	const ukIpa = loadIpa("en_UK.txt");
	const usIpa = loadIpa("en_US.txt");
	console.log(`  en_UK ${ukIpa.size.toLocaleString()} · en_US ${usIpa.size.toLocaleString()}`);

	const shards = new Map(); // shardKey → { word: entry }
	const inflect = new Map(); // 變化形 → [原形, 類型]

	let total = 0;
	let kept = 0;
	let withUk = 0;
	let withUs = 0;
	let first = true;

	for (const row of parseCsv(csv)) {
		if (first) {
			first = false;
			continue; // 標題列
		}
		if (row.length < 11) continue;

		const [
			word,
			phonetic,
			definition,
			translation,
			pos,
			collinsRaw,
			oxfordRaw,
			tagRaw,
			bncRaw,
			frqRaw,
			exchange,
		] = row;

		total++;
		const w = word.trim();
		if (!w) continue;

		const collins = parseInt(collinsRaw, 10) || 0;
		const oxford = (parseInt(oxfordRaw, 10) || 0) === 1;
		const tag = tagRaw ? tagRaw.trim().split(/\s+/).filter(Boolean) : [];
		const bnc = parseInt(bncRaw, 10) || 0;
		const frq = parseInt(frqRaw, 10) || 0;

		const exch = parseExchange(exchange);
		const lower = w.toLowerCase();

		// 詞形還原表要涵蓋所有詞條,不受下面的釋義篩選影響——
		// 罕見字的變化形一樣要能還原回原形,才查得到。
		if (exch["0"]) {
			const lemma = exch["0"].toLowerCase();
			if (lemma !== lower && !inflect.has(lower)) {
				inflect.set(lower, [lemma, KIND_BY_CODE[exch["1"]] || "lemma"]);
			}
		}
		for (const [code, kind] of Object.entries(KIND_BY_CODE)) {
			const form = exch[code];
			if (!form) continue;
			for (const f of form.split(",")) {
				const key = f.trim().toLowerCase();
				if (key && key !== lower && !inflect.has(key)) {
					inflect.set(key, [lower, kind]);
				}
			}
		}

		// 釋義篩選:沒有中文釋義的一律不要;剩下的用詞頻/分級/考試標籤過濾掉
		// 只有 ECDICT 自動抓來、沒人用得到的長尾。
		if (!translation.trim()) continue;
		if (!(frq > 0 || bnc > 0 || tag.length || collins >= 1 || oxford)) continue;

		const uk = ukIpa.get(lower);
		const us = usIpa.get(lower);
		if (uk) withUk++;
		if (us) withUs++;

		const entry = { w, tr: toTraditional(translation.trim()) };
		if (phonetic.trim()) entry.ph = phonetic.trim();
		if (uk) entry.uk = uk;
		if (us) entry.us = us;
		if (definition.trim()) entry.def = definition.trim();
		if (pos.trim()) entry.pos = pos.trim();
		if (collins) entry.collins = collins;
		if (oxford) entry.oxford = true;
		if (tag.length) entry.tag = tag;
		if (bnc) entry.bnc = bnc;
		if (frq) entry.frq = frq;
		if (exchange.trim()) entry.exch = exchange.trim();

		const key = shardKey(w);
		if (!shards.has(key)) shards.set(key, {});
		shards.get(key)[lower] = entry;
		kept++;

		if (kept % 20000 === 0) process.stdout.write(`\r  kept ${kept.toLocaleString()} …`);
	}

	// lemma.en.txt 補不規則變化(be → is/was/are/were …),ECDICT 的 exchange 欄漏掉的。
	console.log("\nMerging lemma.en.txt …");
	let lemmaAdded = 0;
	const lemmaText = fs.readFileSync(path.join(VENDOR, "lemma.en.txt"), "utf8");
	for (const line of lemmaText.split("\n")) {
		if (!line || line.startsWith(";")) continue;
		const [left, right] = line.split("->");
		if (!right) continue;
		const lemma = left.split("/")[0].trim().toLowerCase();
		for (const f of right.split(",")) {
			const key = f.trim().toLowerCase();
			if (key && key !== lemma && !inflect.has(key)) {
				inflect.set(key, [lemma, "lemma"]);
				lemmaAdded++;
			}
		}
	}

	console.log(`\nTotal rows      ${total.toLocaleString()}`);
	console.log(`Kept entries    ${kept.toLocaleString()}  (${((kept / total) * 100).toFixed(1)}%)`);
	console.log(`  with UK IPA   ${withUk.toLocaleString()}  (${((withUk / kept) * 100).toFixed(1)}%)`);
	console.log(`  with US IPA   ${withUs.toLocaleString()}  (${((withUs / kept) * 100).toFixed(1)}%)`);
	console.log(`Inflections     ${inflect.size.toLocaleString()}  (+${lemmaAdded.toLocaleString()} from lemma.en.txt)`);

	if (STATS_ONLY) return;

	// ------------------------------------------------------------ 寫檔
	fs.rmSync(OUT, { recursive: true, force: true });
	fs.mkdirSync(OUT, { recursive: true });

	const meta = {
		version: new Date().toISOString().slice(0, 10),
		entries: kept,
		inflections: inflect.size,
		shards: {},
	};

	console.log("\nWriting shards …");
	const keys = [...shards.keys()].sort();
	for (const key of keys) {
		const file = `${key}.json`;
		const json = JSON.stringify(shards.get(key));
		fs.writeFileSync(path.join(OUT, file), json);
		meta.shards[file] = crypto.createHash("sha256").update(json).digest("hex");
		const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
		console.log(`  ${file.padEnd(11)} ${Object.keys(shards.get(key)).length.toString().padStart(7)} entries  ${kb.padStart(6)} KB`);
	}

	const inflectJson = JSON.stringify(Object.fromEntries(inflect));
	fs.writeFileSync(path.join(OUT, "inflect.json"), inflectJson);
	meta.shards["inflect.json"] = crypto.createHash("sha256").update(inflectJson).digest("hex");
	console.log(`  inflect.json ${inflect.size.toString().padStart(7)} entries  ${(Buffer.byteLength(inflectJson) / 1024).toFixed(0).padStart(6)} KB`);

	fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, "\t"));

	const totalKb = fs
		.readdirSync(OUT)
		.reduce((n, f) => n + fs.statSync(path.join(OUT, f)).size, 0) / 1024;
	console.log(`\nTotal ${(totalKb / 1024).toFixed(1)} MB in ${OUT}`);
}

main();
