// 朗文 / 牛津 / Wiktionary 字源 三個解析器的測試。
//
//   npx tsx test/sources-check.ts
//
// 跟 cambridge-check 一樣:對「真的頁面」跑,不是對自己捏的假 HTML。
// fixture 不進版控,缺的話用 curl 抓一次(node 的 fetch 對這些站會拿到壓縮亂碼)。

import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { JSDOM } from "jsdom";
import { parseLongman, parseOxford, parseWiktionary } from "../src/sources-parse";
import type { SourceEntry } from "../src/sources-parse";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

function fixture(name: string, url: string): string {
	const file = path.resolve(__dirname, "fixtures", `${name}.html`);
	if (fs.existsSync(file)) return fs.readFileSync(file, "utf8");
	console.log(`(抓一次 ${name})`);
	const out = execFileSync(
		"curl",
		[
			"-s",
			"-A",
			"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
			"--max-time",
			"25",
			url,
		],
		{ encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }
	);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, out);
	return out;
}

const doc = (html: string) => new JSDOM(html).window.document as unknown as Document;

console.log("朗文 LDOCE");
{
	const e = parseLongman(
		doc(fixture("ldoce-effective", "https://www.ldoceonline.com/dictionary/effective")),
		"effective"
	);
	check("解析出詞條", !!e);
	if (e) {
		check("有多個義項", e.senses.length >= 2, `${e.senses.length} 個`);
		check("有音標", !!e.ukIpa, e.ukIpa ?? "—");
		check("義項有定義", e.senses.every((s) => s.def.length > 3));
		check(
			"至少一個義項有例句",
			e.senses.some((s) => s.examples.length),
			e.senses[0]?.examples[0]?.en?.slice(0, 46) ?? "—"
		);
		console.log(`      ${e.senses[0].def.slice(0, 60)}`);
	}
}

console.log("\n牛津 OALD");
{
	const e = parseOxford(
		doc(
			fixture(
				"oald-effective",
				"https://www.oxfordlearnersdictionaries.com/definition/english/effective"
			)
		),
		"effective"
	);
	check("解析出詞條", !!e);
	if (e) {
		check("有多個義項", e.senses.length >= 2, `${e.senses.length} 個`);
		check("英美音標都有", !!e.ukIpa && !!e.usIpa, `${e.ukIpa} / ${e.usIpa}`);
		check(
			"至少一個義項有例句",
			e.senses.some((s) => s.examples.length),
			e.senses[0]?.examples[0]?.en?.slice(0, 46) ?? "—"
		);
		console.log(`      ${e.senses[0].def.slice(0, 60)}`);
	}
}

console.log("\nWiktionary 字源");
{
	const raw = fixture(
		"wiktionary-effective",
		"https://en.wiktionary.org/w/api.php?action=parse&page=effective&prop=text&format=json&formatversion=2"
	);
	const html = JSON.parse(raw)?.parse?.text ?? "";
	const e: SourceEntry | null = parseWiktionary(doc(html), "effective");
	check("解析出字源", !!e?.text);
	if (e?.text) {
		// 這是最容易錯的地方:同一個拼法在 Wiktionary 上常常同時是英文、法文、
		// 拉丁文的詞條。沒限定英文區段就會抓到別的語言的字源。
		check("抓到的是英文區段的字源", e.text.includes("Latin") || e.text.includes("French"));
		check("有字源鏈（不只一層）", (e.text.match(/from/gi) ?? []).length >= 2);
		check("不是義項而是散文", e.senses.length === 0);
		console.log(`      ${e.text.slice(0, 110)}`);
	}
}

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
