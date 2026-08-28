// 詞庫查詢的煙霧測試。直接餵檔案系統,不經過 Obsidian。
//
//   npx tsx test/dict-check.ts
//
// 需要先跑過 `npm run build:dict` 產生 dict/。

import fs from "fs";
import path from "path";
import { Dictionary } from "../src/dict";
import { wordAt, formsFor } from "../src/lemma";

const DICT_DIR = path.resolve(__dirname, "../dict");

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

async function main() {
	if (!fs.existsSync(path.join(DICT_DIR, "meta.json"))) {
		console.error("dict/ not built — run `npm run build:dict` first.");
		process.exit(1);
	}

	const dict = new Dictionary(async (name) => {
		const p = path.join(DICT_DIR, name);
		return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
	});

	const loaded = await dict.load();
	check("詞庫載入", loaded, `${dict.entryCount.toLocaleString()} 詞條 · ${dict.version}`);

	// --- 釋義必須是繁體 ---
	console.log("\n繁體轉換");
	const traditional: [string, string][] = [
		["software", "軟體"],
		["network", "網路"],
		["memory", "記憶體"],
		["mouse", "滑鼠"],
	];
	for (const [word, expect] of traditional) {
		const r = await dict.lookup(word);
		check(`${word} 含「${expect}」`, !!r && r.entry.tr.includes(expect), r?.entry.tr.split("\n")[0] ?? "查無");
	}

	// 簡體字不該出現在任何釋義裡(抽查常見的幾個)
	const simplifiedProbes = ["软", "网", "内", "优", "习"];
	for (const word of ["software", "network", "practice", "optimize", "study"]) {
		const r = await dict.lookup(word);
		const bad = simplifiedProbes.filter((c) => r?.entry.tr.includes(c));
		check(`${word} 無殘留簡體`, bad.length === 0, bad.length ? `殘留 ${bad.join("")}` : "");
	}

	// twp 過度轉換的回歸測試(「最优化」曾轉成「最最佳化」)
	for (const word of ["optimize", "optimization", "optimal"]) {
		const r = await dict.lookup(word);
		check(`${word} 無「最最佳化」`, !r || !r.entry.tr.includes("最最佳化"), r?.entry.tr.split("\n")[0] ?? "查無");
	}

	// 轉繁後同一行撞出重複詞(「优化, 最优化」→「最佳化, 最佳化」)
	for (const word of ["optimization", "optimize", "network", "software"]) {
		const r = await dict.lookup(word);
		const dupLine = r?.entry.tr.split("\\n").find((line) => {
			const terms = line.replace(/^([a-zA-Z]+\.\s*|\[[^\]]+\]\s*)/, "").split(",").map((s) => s.trim());
			return new Set(terms).size !== terms.length;
		});
		check(`${word} 釋義無重複詞`, !dupLine, dupLine ?? r?.entry.tr.split("\\n")[0] ?? "");
	}

	// --- 英美雙音標 ---
	console.log("\n英美音標");
	for (const word of ["unnerve", "schedule", "tomato", "advertisement"]) {
		const r = await dict.lookup(word);
		check(
			`${word} 有英/美音標`,
			!!r?.entry.uk && !!r?.entry.us,
			r ? `${r.entry.uk ?? "—"} / ${r.entry.us ?? "—"}` : "查無"
		);
	}

	// --- 詞形還原 ---
	console.log("\n詞形還原");
	const inflections: [string, string][] = [
		["unnerving", "unnerve"],
		["ran", "run"],
		["running", "run"],
		["better", "good"],
		["mice", "mouse"],
		["was", "be"],
		// 專有名詞劫走一般字的變化形:ECDICT 的 Sharpe(夏普指數)在 exchange 欄
		// 宣告了 r:sharper / t:sharpest,而 sharp 自己的 exchange 只有 s:sharps。
		// 先寫先贏的話,滑過任何筆記裡的 sharpest 都會跳出「夏普指數」。
		["sharpest", "sharp"],
		["sharper", "sharp"],
		// 同一族的其他受害者:ACH(自動清算所)劫走 aches、AP 劫走 aped。
		["aches", "ache"],
		["aped", "ape"],
	];
	for (const [surface, lemma] of inflections) {
		const r = await dict.lookup(surface);
		check(
			`${surface} → ${lemma}`,
			r?.entry.w.toLowerCase() === lemma,
			r ? `得到 ${r.entry.w}（${r.inflection ?? "原形"}）` : "查無"
		);
	}

	// 變化類型也要對:sharpest 是最高級,不是別的。
	for (const [surface, kind] of [["sharpest", "superlative"], ["sharper", "comparative"]] as const) {
		const r = await dict.lookup(surface);
		check(`${surface} 標成 ${kind}`, r?.inflection === kind, r?.inflection ?? "無");
	}

	// unnerving 是這條規則的來由:它自己的釋義是「[醫] 除神經法」,沒用。
	const unnerving = await dict.lookup("unnerving");
	check(
		"unnerving 顯示 unnerve 的釋義",
		!!unnerving && unnerving.entry.tr.includes("勇氣"),
		unnerving?.entry.tr.split("\n")[0] ?? "查無"
	);

	// --- 原形本身不該被誤判 ---
	console.log("\n原形不受影響");
	for (const word of ["run", "good", "be"]) {
		const r = await dict.lookup(word);
		check(`${word} 不被還原`, r?.entry.w.toLowerCase() === word && !r?.inflection, r?.entry.w ?? "查無");
	}

	// --- 變化形清單 ---
	console.log("\n變化形顯示");
	const unnerve = await dict.lookup("unnerve");
	const forms = formsFor(unnerve?.entry.exch);
	check("unnerve 列出變化形", forms.length >= 3, forms.join(" / "));
	check("變化形不含 0:/1: 的反向資訊", !forms.some((f) => f.length <= 1), forms.join(" / "));

	// --- 冷門領域標籤清理 ---
	console.log("\n[計][醫] 噪音清理");
	{
		const { meaningfulLines } = await import("../src/lemma");
		// be 底下的「[計] 後端, 匯流排允許」應被丟掉,留下正常釋義
		const be = await dict.lookup("be");
		const lines = be ? meaningfulLines(be.entry.tr) : [];
		check("be 不再顯示 [計] 那行", !lines.some((l) => l.includes("匯流排")), lines.join(" / "));
		check("be 仍保留正常釋義", lines.some((l) => l.includes("是")), lines.join(" / "));
		// 只有領域標籤的冷僻詞:不能整個清空
		check(
			"純領域標籤詞不被清空",
			meaningfulLines("[醫] 甚麼甚麼").length === 1,
			"至少保留一行"
		);
	}

	// --- 片語 ---
	console.log("\n片語查詢");
	const phrases: [string, string][] = [
		["give up", "放棄"],
		["make sense", "意義"],
		["look forward to", "期"],
	];
	for (const [phrase, expect] of phrases) {
		const e = await dict.lookupPhrase(phrase);
		check(`${phrase} 查得到`, !!e && e.tr.includes(expect), e ? e.tr.split("\\n")[0] : "查無");
	}
	// 大小寫、多重空白、頭尾標點都要正規化到同一個 key
	check("大小寫不敏感", !!(await dict.lookupPhrase("Give Up")), "Give Up");
	check("多重空白併一個", !!(await dict.lookupPhrase("give   up")), "give   up");
	check("去頭尾標點", !!(await dict.lookupPhrase("give up.")), "give up.");
	// 單字不該走片語查詢(交給 lookup 做詞形還原)
	check("單字不從片語庫查", (await dict.lookupPhrase("give")) === null, "give 應回 null");
	// 冷僻搭配不該被收進來(組成字雖常見,但整體是隨機組合的長尾)
	const junk = await dict.lookupPhrase("give window");
	check("隨機組合查無", junk === null, junk ? junk.tr : "null");

	// --- 從句子裡抓字 ---
	console.log("\n游標抓字");
	const sentence = "It was an unnerving, well-timed question.";
	const cases: [number, string | null][] = [
		[3, "was"],
		[11, "unnerving"],
		[19, "unnerving"], // 字尾:游標停在逗號前
		[21, "well-timed"], // 連字號要整個咬住
		[sentence.length - 1, "question"],
	];
	for (const [offset, expect] of cases) {
		const hit = wordAt(sentence, offset);
		check(`offset ${offset} → ${expect}`, hit?.word === expect, hit?.word ?? "null");
	}
	check("空白處不抓字", wordAt("a  b", 2) === null || wordAt("a  b", 2)?.word === "a");

	console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
	process.exit(failures === 0 ? 0 : 1);
}

main();
