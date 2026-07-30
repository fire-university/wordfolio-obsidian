// 浮窗要顯示哪些區塊、照什麼順序——沙拉查詞那套模型:每種內容各自成一個區塊,
// 使用者自己勾選要哪些、排什麼順序。
//
// 純資料 + 純函式,不碰 DOM 也不依賴 Obsidian,node 測試可直接跑。

export type SectionId =
	| "phonetics" // 英美音標與發音
	| "translation" // 繁中釋義(ECDICT)
	| "english" // 英英釋義(WordNet)
	| "surface" // 變化形自己的釋義(跟原形不同時才有)
	| "frequency" // 詞頻與分級(柯林斯星級、Oxford 3000、BNC、COCA)
	| "exams" // 考試標籤(cet4、toefl、gre…)
	| "forms" // 變化形清單
	| "synonyms" // 同義詞/反義詞(WordNet，離線)
	| "claude" // 問 Claude:在這句話裡是什麼意思
	| "usage" // 例句、常見搭配、近義詞辨析(Claude 生成)
	| "detail"; // 字根字首 + 詞族(Claude 生成)
// 之後會加的離線區塊:examples(Tatoeba 繁中對照例句)。資料建好才進 enum,
// 免得設定裡出現空的 toggle。

/** 全部區塊,照預設順序。設定裡的排序以這個為起點。 */
export const ALL_SECTIONS: SectionId[] = [
	"phonetics",
	"translation",
	"english",
	"surface",
	"frequency",
	"exams",
	"forms",
	"synonyms",
	"claude",
	"usage",
	"detail",
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
	translation: true,
	english: true,
	surface: true,
	frequency: true,
	exams: false,
	forms: true,
	// 同義詞是離線的、不花 token,預設開。
	synonyms: true,
	claude: true,
	// usage / detail 預設關:每個字要花 token,先讓使用者自己決定要不要開。
	usage: false,
	detail: false,
};

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
	for (const id of ALL_SECTIONS) {
		if (!seen.has(id)) out.push(id);
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
