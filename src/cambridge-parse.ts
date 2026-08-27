// 劍橋詞典(英漢繁體)——真正的詞典內容,取代本地模型硬生的那幾樣。
//
// 為什麼改抓這個:本地 AI 生例句/字根要等好幾秒,而且品質不穩(會吐簡體、會硬拆
// 字根)。劍橋給的是人編的詞典:按義項分、每個義項有英文定義＋繁中對照＋真實例句
// (連例句都有中譯),外加英美音標與真人發音。查一次網頁只要零點幾秒,比跑模型快
// 一個量級,內容還更可靠。沙拉查詞就是這樣做的。
//
// 這個檔刻意**不 import obsidian**:解析是純函式,拆出來才能用 jsdom 在 node 裡
// 真的測(踩過一次——tooltip.ts 因為輾轉 import 到 obsidian,整批 node 測試就掛了)。
// 網路那一半在 cambridge.ts。
//
// 解析用 DOMParser 而不是正則:HTML 結構會變,用選擇器至少是「找不到就沒有」,
// 不會像正則那樣配錯位置給出亂七八糟的內容。parse 抽成純函式吃 Document,
// 這樣可以用 jsdom 在 node 裡真的測,不必賭它在 Obsidian 裡會動。

/** 一個義項:英文定義 + 繁中 + 例句。 */
export interface CambridgeSense {
	/** 義項標籤,如 SUCCESSFUL / IN FACT——劍橋用來區分多義字的那個詞 */
	guideword?: string;
	/** 詞性,如 adjective */
	pos?: string;
	/** CEFR 等級,如 B2 */
	level?: string;
	/** 英文定義 */
	def: string;
	/** 繁中翻譯 */
	zh?: string;
	/** 例句(英文 + 繁中) */
	examples: { en: string; zh?: string }[];
}

export interface CambridgeEntry {
	word: string;
	ukIpa?: string;
	usIpa?: string;
	ukAudio?: string;
	usAudio?: string;
	senses: CambridgeSense[];
}

export const BASE = "https://dictionary.cambridge.org";
export const PATH = "/dictionary/english-chinese-traditional/";

function text(el: Element | null | undefined): string {
	return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 從劍橋的頁面 DOM 抽出詞條。找不到任何義項就回 null(查無此字,或版面換了)。
 * 純函式,不碰網路——node 測試可以直接餵 jsdom 建的 Document。
 */
export function parseCambridge(doc: Document, word: string): CambridgeEntry | null {
	const entry: CambridgeEntry = { word, senses: [] };

	// 音標與發音檔。劍橋一個頁面可能有多個詞性區塊,取第一組就好。
	const pick = (region: "uk" | "us") => {
		const box = doc.querySelector(`.${region}.dpron-i`);
		if (!box) return;
		const ipa = text(box.querySelector(".ipa.dipa"));
		const src = box.querySelector('source[type="audio/mpeg"]')?.getAttribute("src");
		if (ipa) entry[region === "uk" ? "ukIpa" : "usIpa"] = `/${ipa}/`;
		if (src) entry[region === "uk" ? "ukAudio" : "usAudio"] = src.startsWith("http") ? src : BASE + src;
	};
	pick("uk");
	pick("us");

	for (const senseEl of Array.from(doc.querySelectorAll(".pr.dsense"))) {
		// guideword 的原始內容是 "(SUCCESSFUL)",括號在 span 外面。
		const guideword = text(senseEl.querySelector(".guideword span")) || undefined;
		// 詞性掛在外層的 entry 區塊上,往上找。
		const pos =
			text(senseEl.closest(".pr.entry-body__el")?.querySelector(".pos.dpos")) || undefined;

		for (const block of Array.from(senseEl.querySelectorAll(".def-block.ddef_block"))) {
			const def = text(block.querySelector(".def.ddef_d"));
			if (!def) continue;

			// 義項的繁中譯要取「def-body 的直接子層」——例句裡面也有 .trans,
			// 不限定直接子層會抓到例句的翻譯。
			const body = block.querySelector(".def-body.ddef_b");
			let zh: string | undefined;
			for (const child of Array.from(body?.children ?? [])) {
				if (child.classList.contains("trans")) {
					zh = text(child);
					break;
				}
			}

			const examples: { en: string; zh?: string }[] = [];
			for (const ex of Array.from(block.querySelectorAll(".examp.dexamp"))) {
				const en = text(ex.querySelector(".eg.deg"));
				if (!en) continue;
				examples.push({ en, zh: text(ex.querySelector(".trans.dtrans")) || undefined });
			}

			entry.senses.push({
				guideword,
				pos,
				level: text(block.querySelector(".epp-xref, .def-info .epp-xref")) || undefined,
				def,
				zh: zh?.replace(/[；;]\s*$/, ""),
				examples,
			});
		}
	}

	return entry.senses.length ? entry : null;
}

