// 劍橋詞典解析器的測試。
//
//   npx tsx test/cambridge-check.ts
//
// 用 jsdom 對「真的頁面」跑,不是對自己捏的假 HTML——選擇器會不會壞,只有真頁面
// 說了算。fixture 不進版控(那是人家的內容),缺的話自動抓一次存到 test/fixtures/。

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { JSDOM } from "jsdom";
import { parseCambridge } from "../src/cambridge-parse";

const WORD = "effective";
const FIXTURE = path.resolve(__dirname, "fixtures", `cambridge-${WORD}.html`);
const URL = `https://dictionary.cambridge.org/dictionary/english-chinese-traditional/${WORD}`;

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

/**
 * 取得 fixture。
 *
 * **刻意用 curl 而不是 node 的 fetch**:實測 Cambridge 回的是 zstd/br 壓縮內容,
 * undici 不會解,拿到二進位亂碼。症狀很陰險——字串裡搜得到 "def ddef_d",
 * 但 jsdom 解析出 0 個 div,看起來像選擇器寫錯。curl 會正確解壓。
 *
 * 這不影響外掛本身:Obsidian 的 requestUrl 走 Electron/Chromium 的網路層,
 * 跟瀏覽器一樣會處理壓縮。
 */
function fixture(): string {
	if (fs.existsSync(FIXTURE)) return fs.readFileSync(FIXTURE, "utf8");
	console.log(`(fixture 不在,抓一次 ${URL})`);
	const html = execFileSync(
		"curl",
		[
			"-s",
			"-A",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
			"-H",
			"Accept-Language: zh-TW,zh;q=0.9,en;q=0.8",
			"--max-time",
			"25",
			URL,
		],
		{ encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
	);
	fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
	fs.writeFileSync(FIXTURE, html);
	return html;
}

async function main() {
	const dom = new JSDOM(fixture());
	const entry = parseCambridge(dom.window.document as unknown as Document, WORD);

	check("解析出詞條", !!entry);
	if (!entry) {
		process.exit(1);
	}

	console.log("\n音標與發音");
	check("英式音標", !!entry.ukIpa, entry.ukIpa ?? "—");
	check("美式音標", !!entry.usIpa, entry.usIpa ?? "—");
	check("英式音檔", !!entry.ukAudio?.endsWith(".mp3"), entry.ukAudio ?? "—");
	check("美式音檔", !!entry.usAudio?.endsWith(".mp3"), entry.usAudio ?? "—");
	check("英美音標不同", entry.ukIpa !== entry.usIpa);

	console.log("\n義項");
	check("至少三個義項", entry.senses.length >= 3, `${entry.senses.length} 個`);
	check(
		"每個義項都有英文定義",
		entry.senses.every((s) => s.def.length > 3)
	);
	check(
		"每個義項都有繁中",
		entry.senses.every((s) => !!s.zh),
		entry.senses.map((s) => s.zh ?? "—").join(" / ")
	);
	check(
		"有 guideword（多義字的分類標籤）",
		entry.senses.some((s) => !!s.guideword),
		entry.senses.map((s) => s.guideword ?? "—").join(" / ")
	);
	check(
		"有詞性",
		entry.senses.some((s) => !!s.pos),
		entry.senses[0]?.pos ?? "—"
	);

	console.log("\n例句");
	const withEg = entry.senses.filter((s) => s.examples.length);
	check("至少三個義項有例句", withEg.length >= 3, `${withEg.length} 個義項有例句`);
	check(
		"例句有繁中對照",
		withEg.some((s) => s.examples.some((e) => !!e.zh))
	);
	// 這是關鍵:義項的繁中不可以被例句的繁中蓋掉(def-body 要取直接子層)。
	check(
		"義項繁中 ≠ 例句繁中",
		entry.senses.every((s) => !s.examples.some((e) => e.zh && e.zh === s.zh)),
		"抓錯層級的話兩者會一樣"
	);

	console.log("\n實際內容:");
	for (const s of entry.senses.slice(0, 3)) {
		console.log(`  [${s.guideword ?? "—"}] ${s.def}`);
		console.log(`      ${s.zh ?? "—"}`);
		for (const e of s.examples.slice(0, 1)) {
			console.log(`      · ${e.en}`);
			if (e.zh) console.log(`        ${e.zh}`);
		}
	}

	console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
