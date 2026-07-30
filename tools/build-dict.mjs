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

// -------------------------------------------------------------- WordNet

// 同義詞/反義詞:離線,來自 Princeton WordNet(免費授權)。
// 一個 synset 裡的詞互為同義詞;`!` 指標指向反義詞的 synset。
//
// data.* 每行:offset lex_num ss_type w_cnt [word lex_id]... p_cnt [sym off pos src/tgt]... | gloss
// w_cnt 是十六進位。指標的第 4 欄是 4 位十六進位:前 2 = 本 synset 的來源詞序號、
// 後 2 = 目標 synset 的目標詞序號(0000 = 整個 synset)。
function loadWordNet(dir) {
	const synsets = new Map(); // `${pos}${offset}` → [words]
	const antonymPtrs = []; // {srcKey, srcW, tgtKey, tgtW}
	const files = ["data.noun", "data.verb", "data.adj", "data.adv"];

	for (const file of files) {
		const filePath = path.join(dir, file);
		if (!fs.existsSync(filePath)) continue;
		const text = fs.readFileSync(filePath, "utf8");
		for (const line of text.split("\n")) {
			if (!line || line.startsWith("  ")) continue; // 授權標頭
			const bar = line.indexOf(" | ");
			const head = (bar >= 0 ? line.slice(0, bar) : line).trim().split(/\s+/);
			if (head.length < 4) continue;

			const offset = head[0];
			const pos = head[2];
			const key = pos + offset;
			const wCnt = parseInt(head[3], 16);
			if (!Number.isFinite(wCnt)) continue;

			const words = [];
			let i = 4;
			for (let w = 0; w < wCnt; w++) {
				words.push(head[i].replace(/_/g, " ").toLowerCase());
				i += 2; // 跳過 lex_id
			}
			synsets.set(key, words);

			const pCnt = parseInt(head[i], 10) || 0;
			i += 1;
			for (let p = 0; p < pCnt; p++) {
				const sym = head[i];
				const tgtOff = head[i + 1];
				const tgtPos = head[i + 2];
				const srcTgt = head[i + 3];
				i += 4;
				if (sym === "!") {
					antonymPtrs.push({
						srcKey: key,
						srcW: parseInt(srcTgt.slice(0, 2), 16),
						tgtKey: tgtPos + tgtOff,
						tgtW: parseInt(srcTgt.slice(2, 4), 16),
					});
				}
			}
		}
	}

	// word → { s: Set(同義詞), a: Set(反義詞) }
	const map = new Map();
	const ensure = (w) => {
		let e = map.get(w);
		if (!e) map.set(w, (e = { s: new Set(), a: new Set() }));
		return e;
	};

	// 同義詞:synset 裡的詞兩兩互為同義。
	for (const words of synsets.values()) {
		if (words.length < 2) continue;
		for (const w of words) {
			const e = ensure(w);
			for (const other of words) if (other !== w) e.s.add(other);
		}
	}

	// 反義詞:解析 `!` 指標。src/tgt 為 0 代表整個 synset。
	for (const { srcKey, srcW, tgtKey, tgtW } of antonymPtrs) {
		const src = synsets.get(srcKey);
		const tgt = synsets.get(tgtKey);
		if (!src || !tgt) continue;
		const srcWords = srcW === 0 ? src : [src[srcW - 1]];
		const tgtWords = tgtW === 0 ? tgt : [tgt[tgtW - 1]];
		for (const sw of srcWords) {
			if (!sw) continue;
			const e = ensure(sw);
			for (const tw of tgtWords) if (tw) e.a.add(tw);
		}
	}

	return map;
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

	console.log("Loading WordNet (synonyms / antonyms) …");
	const wnDir = path.join(VENDOR, "wndict", "dict");
	const wn = fs.existsSync(wnDir) ? loadWordNet(wnDir) : new Map();
	console.log(`  WordNet ${wn.size.toLocaleString()} words`);

	const shards = new Map(); // shardKey → { word: entry }
	const phraseShards = new Map(); // p{letter} → { phrase: entry };單字與片語分開存
	const inflect = new Map(); // 變化形 → [原形, 類型]
	const keptWords = new Set(); // 通過篩選的單字(小寫),片語篩選要用
	const phraseCandidates = []; // 含空格的詞條,單字全掃完才知道哪些留

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

		// 釋義篩選:沒有中文釋義的一律不要。
		if (!translation.trim()) continue;

		// 片語(含空格)另外處理:它們幾乎都沒有詞頻資料,套單字那套篩選會被全砍。
		// 但「give up / make sense / on the other hand」正是使用者選取時最想查的。
		// 先收下來,等單字全掃完、知道哪些是常用字,再決定哪些片語留(見下方)。
		if (w.includes(" ")) {
			phraseCandidates.push({
				w,
				lower,
				tr: translation.trim(),
				def: definition.trim(),
			});
			continue;
		}

		// 單字:用詞頻/分級/考試標籤過濾掉只有 ECDICT 自動抓來、沒人用得到的長尾。
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

		// WordNet 同義詞/反義詞。優先留單字(多字同義詞在小浮窗裡難讀),各設上限。
		const wnEntry = wn.get(lower);
		if (wnEntry) {
			const pickSingle = (set, n) =>
				[...set].filter((x) => !x.includes(" ") && x !== lower).slice(0, n);
			const syn = pickSingle(wnEntry.s, 8);
			const ant = pickSingle(wnEntry.a, 5);
			if (syn.length) entry.syn = syn;
			if (ant.length) entry.ant = ant;
		}

		const key = shardKey(w);
		if (!shards.has(key)) shards.set(key, {});
		shards.get(key)[lower] = entry;
		keptWords.add(lower);
		kept++;

		if (kept % 20000 === 0) process.stdout.write(`\r  kept ${kept.toLocaleString()} …`);
	}

	// 片語:2–4 個字,且每個字母組成的字都是「留下來的常用單字」。
	// 這樣 give up(give+up 都常用)留,冷僻搭配自然被擋掉,不必靠詞頻。
	// of/the/up 這類功能詞本來就過了單字篩選,所以在 keptWords 裡,不用特例。
	//
	// 存進獨立的 phraseShards——片語只在使用者「選取」時才查(低頻、刻意),
	// 跟單字的 hover(高頻)存取頻率完全不同。混在一起會讓 s.json 之類的單字
	// shard 從 1.7MB 漲到 3.6MB,拖慢每一次 hover。分開存,單字那條路不受影響。
	console.log("\nFiltering phrases …");
	// ECDICT 的詞典式佔位符,使用者選取時不可能框到這些,收了只是雜訊。
	const PLACEHOLDERS = new Set(["sb", "sth", "one's", "oneself", "sb's", "sth's"]);
	let keptPhrase = 0;
	for (const p of phraseCandidates) {
		const tokens = p.lower.split(/\s+/).filter(Boolean);
		if (tokens.length < 2 || tokens.length > 4) continue;
		if (tokens.some((tok) => PLACEHOLDERS.has(tok))) continue;
		const allCommon = tokens.every((tok) => {
			// 非純字母的片段(…、數字)不參與判斷,直接放行。
			if (!/^[a-z]+$/.test(tok)) return true;
			return keptWords.has(tok);
		});
		if (!allCommon) continue;

		const entry = { w: p.w, tr: toTraditional(p.tr) };
		if (p.def) entry.def = p.def;

		const key = `p${shardKey(p.w)}`;
		if (!phraseShards.has(key)) phraseShards.set(key, {});
		phraseShards.get(key)[p.lower] = entry;
		keptPhrase++;
	}
	console.log(`  kept ${keptPhrase.toLocaleString()} of ${phraseCandidates.length.toLocaleString()} phrases`);

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
		phrases: keptPhrase,
		inflections: inflect.size,
		shards: {},
	};

	const writeShard = (map, key) => {
		const file = `${key}.json`;
		const json = JSON.stringify(map.get(key));
		fs.writeFileSync(path.join(OUT, file), json);
		meta.shards[file] = crypto.createHash("sha256").update(json).digest("hex");
		const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
		console.log(`  ${file.padEnd(11)} ${Object.keys(map.get(key)).length.toString().padStart(7)} entries  ${kb.padStart(6)} KB`);
	};

	console.log("\nWriting word shards …");
	for (const key of [...shards.keys()].sort()) writeShard(shards, key);

	console.log("Writing phrase shards …");
	for (const key of [...phraseShards.keys()].sort()) writeShard(phraseShards, key);

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
