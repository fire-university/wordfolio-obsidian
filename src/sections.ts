// 浮窗要顯示哪些區塊、照什麼順序——沙拉查詞那套模型:每種內容各自成一個區塊,
// 使用者自己勾選要哪些、排什麼順序。
//
// 純資料 + 純函式,不碰 DOM 也不依賴 Obsidian,node 測試可直接跑。

export type SectionId =
	| "phonetics" // 英美音標與發音
	| "cambridge" // 劍橋詞典:按義項分的英文定義＋繁中＋例句(線上)
	| "longman" // 朗文當代:定義用最基本的詞彙寫(線上,純英文)
	| "oxford" // 牛津學習者:定義＋CEFR 等級(線上,純英文)
	| "wiktionary" // Wiktionary 字源:真實的字根字首來源鏈(線上 API)
	| "translation" // 繁中釋義(ECDICT)
	| "english" // 英英釋義(WordNet)
	| "surface" // 變化形自己的釋義(跟原形不同時才有)
	| "frequency" // 詞頻與分級(柯林斯星級、Oxford 3000、BNC、COCA)
	| "exams" // 考試標籤(cet4、toefl、gre…)
	| "forms" // 變化形清單
	| "examples" // 離線例句(WordNet，英文)
	| "synonyms" // 同義詞/反義詞(WordNet，離線)
	| "claude" // 問 Claude:在這句話裡是什麼意思
	| "usage" // 例句、常見搭配、近義詞辨析(本地 AI 生成)
	| "detail"; // 字根字首 + 詞族(本地 AI 生成)

/** 全部區塊,照預設順序。設定裡的排序以這個為起點。 */
export const ALL_SECTIONS: SectionId[] = [
	"phonetics",
	// 劍橋擺在最前面:它是人編的詞典,按義項分、每個義項都有繁中與例句,
	// 比 ECDICT 那幾行並列的釋義好讀得多。
	"cambridge",
	"translation",
	// 朗文/牛津擺在中文釋義後面:它們是「劍橋還看不懂時」的補充。
	"longman",
	"oxford",
	// 字源放靠後:那是想深究時才看的。
	"wiktionary",
	// 「在這句話裡是什麼意思」緊接在釋義後面:那是讀者當下最想要的答案,
	// 不該埋在一堆補充資料底下。
	"claude",
	"english",
	"examples",
	"surface",
	"detail",
	"usage",
	"synonyms",
	"forms",
	"frequency",
	"exams",
];

/**
 * 預設開哪些。
 *
 * english 預設開——ECDICT 有 79.7% 的詞條帶 WordNet 英英釋義,而且常常比繁中
 * 那一行細得多(leverage 的繁中只有「n. 槓桿作用」,英英分了槓桿原理／策略優勢／
 * 融資操作三個義項)。這份資料本來就在詞庫裡,關掉是浪費。
 *
 * exams 預設關——考試標籤對準備考試的人有用,對一般閱讀是雜訊。
 */
export const DEFAULT_ENABLED: Record<SectionId, boolean> = {
	phonetics: true,
	cambridge: true,
	translation: true,
	// 朗文/牛津/字源預設關:一次跑四家會慢,而且劍橋通常就夠了。
	// 想要更淺白的定義(朗文/牛津)或真實字根來源(字源)再自己打開。
	longman: false,
	oxford: false,
	wiktionary: false,
	english: true,
	surface: true,
	frequency: true,
	exams: false,
	forms: true,
	// 例句、同義詞都是離線的、免費,預設開。
	examples: true,
	synonyms: true,
	// AI 三樣改回預設關閉。
	//
	// 一度預設全開(字典就該直接給答案),但實測本地模型要等好幾秒、內容還不穩
	// (會吐簡體、硬拆字根)。劍橋詞典把「例句」「多義項辨析」做得更好而且快一個
	// 量級,所以那三樣退位成加值選項——想要中文的字根拆解再自己打開。
	claude: false,
	usage: false,
	detail: false,
};

/**
 * 英文介面的預設值。
 *
 * 繁中的預設(上面那份)對英文使用者是錯的:`translation` 是繁中釋義,劍橋走的
 * 是**英漢**詞典——兩個都給他看不懂的中文。反過來,英英釋義、例句、同義詞在
 * 詞庫裡本來就有(覆蓋率 80.9% / 28.1% / 47.4%),對他才是主菜。
 *
 * 線上詞典留一家打開,理由跟繁中版留劍橋一樣:離線詞庫是逐字義項並列,人編的
 * 詞典按義項分、有例句,好讀得多。英文使用者選牛津學習者詞典——它標 CEFR 等級,
 * 學習者判斷「這個字該不該現在學」用得上。
 */
export const DEFAULT_ENABLED_EN: Record<SectionId, boolean> = {
	...DEFAULT_ENABLED,
	translation: false,
	cambridge: false,
	oxford: true,
	english: true,
	examples: true,
	synonyms: true,
};

/** 這個語言的預設區塊設定。只在使用者還沒存過設定時當起點。 */
export function defaultEnabledFor(lang: "en" | "zh-TW"): Record<SectionId, boolean> {
	return { ...(lang === "en" ? DEFAULT_ENABLED_EN : DEFAULT_ENABLED) };
}

/** i18n 的 key,設定頁與說明共用。 */
export function sectionLabelKey(id: SectionId): string {
	return `section_${id}`;
}

export function sectionDescKey(id: SectionId): string {
	return `section_${id}_desc`;
}

/**
 * 把使用者存的順序正規化:補上新版本新增的區塊、丟掉已經不存在的。
 *
 * 沒有這一步的話,外掛升級加了新區塊,舊使用者的設定裡不會有它,那個區塊就
 * 永遠不會顯示——而且他還找不到原因。新區塊一律接在尾端,不打亂既有順序。
 */
export function normalizeOrder(saved: readonly string[] | undefined): SectionId[] {
	const valid = new Set<string>(ALL_SECTIONS);
	const seen = new Set<SectionId>();
	const out: SectionId[] = [];

	for (const id of saved ?? []) {
		if (valid.has(id) && !seen.has(id as SectionId)) {
			seen.add(id as SectionId);
			out.push(id as SectionId);
		}
	}

	// 補上使用者設定裡沒有的區塊(外掛升級新增的)。
	//
	// 一律接到最後是錯的:新區塊會全部堆在浮窗底部,排在次要資料後面,
	// 使用者還以為壞了。改成插在「正典順序裡它前一個鄰居」的後面——
	// 這樣新區塊會落在該在的位置,而使用者自己調過的順序也不會被打亂。
	for (const id of ALL_SECTIONS) {
		if (seen.has(id)) continue;
		const canonIdx = ALL_SECTIONS.indexOf(id);
		let insertAt = 0;
		for (let i = canonIdx - 1; i >= 0; i--) {
			const at = out.indexOf(ALL_SECTIONS[i]);
			if (at >= 0) {
				insertAt = at + 1;
				break;
			}
		}
		out.splice(insertAt, 0, id);
		seen.add(id);
	}
	return out;
}

/** 同樣的道理:設定裡沒提到的區塊用預設值,不是當成關閉。 */
export function normalizeEnabled(
	saved: Partial<Record<SectionId, boolean>> | undefined
): Record<SectionId, boolean> {
	const out = { ...DEFAULT_ENABLED };
	for (const id of ALL_SECTIONS) {
		const v = saved?.[id];
		if (typeof v === "boolean") out[id] = v;
	}
	return out;
}

/** 往上／往下搬一格。已經在頭尾就原樣回傳。 */
export function move(order: SectionId[], id: SectionId, delta: -1 | 1): SectionId[] {
	const i = order.indexOf(id);
	if (i < 0) return order;
	const j = i + delta;
	if (j < 0 || j >= order.length) return order;
	const next = [...order];
	[next[i], next[j]] = [next[j], next[i]];
	return next;
}


/**
 * 開/關一個區塊,回傳新的啟用表。
 *
 * 抽成函式是為了**強迫呼叫端把「目前的值」傳進來**。原本設定頁是這樣寫的:
 *
 *     const enabled = normalizeEnabled(s.sectionsEnabled);   // 畫面繪製當下的快照
 *     ...
 *     s.sectionsEnabled = { ...enabled, [id]: v };           // 永遠基於那個快照
 *
 * `enabled` 在 display() 執行時算一次就不再更新,而切換 toggle 不會重繪,
 * 所以每切一個開關都是「舊快照 + 這一個改動」,把中間的其他改動全部蓋回去——
 * 連續切換多個區塊,只有最後一個會生效。
 *
 * 2026-08-28 道哥回報:「只要開啟了 Wiktionary,那牛津學習者跟朗文當代都會被
 * 取消掉,是因為它們有衝突嗎?」不是衝突,就是這個。
 */
export function setSectionEnabled(
	current: Partial<Record<SectionId, boolean>>,
	id: SectionId,
	value: boolean
): Record<SectionId, boolean> {
	return { ...normalizeEnabled(current), [id]: value };
}
