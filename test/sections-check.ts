// 浮窗區塊的排序與勾選。純資料邏輯,不碰 DOM。
//
//   npx tsx test/sections-check.ts

import {
	ALL_SECTIONS,
	DEFAULT_ENABLED,
	normalizeOrder,
	normalizeEnabled,
	move,
	type SectionId,
	setSectionEnabled,
} from "../src/sections";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}

const eq = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((x, i) => x === b[i]);

console.log("順序正規化");
check("沒存過設定時給完整預設", eq(normalizeOrder(undefined), ALL_SECTIONS));
check("空陣列也給完整預設", eq(normalizeOrder([]), ALL_SECTIONS));
// 真正的不變量是「使用者調過的相對順序要保留」——不是「他們一定排在最前面」。
// 補進來的新區塊會插在正典順序的鄰居旁,所以可能落在兩個舊區塊之間。
{
	const out = normalizeOrder(["claude", "translation"]);
	check(
		"保留使用者調過的相對順序",
		out.indexOf("claude") < out.indexOf("translation"),
		out.join(" ")
	);
}

// 這條是升級時的關鍵:外掛新增區塊時,舊使用者的設定裡沒有它。
// 若不補進來,那個新區塊永遠不會顯示,而且使用者找不到原因。
const partial = normalizeOrder(["translation", "phonetics"]);
check(
	"新版本新增的區塊要全部補進來",
	partial.length === ALL_SECTIONS.length &&
		ALL_SECTIONS.every((id) => partial.includes(id)),
	partial.join(" ")
);
check(
	"補進來時不打亂使用者的相對順序",
	partial.indexOf("translation") < partial.indexOf("phonetics"),
	partial.join(" ")
);
// 新區塊要落在正典鄰居旁,不是全部堆到最後——道哥遇到的就是這個:
// 例句/同義詞被接在尾端,排在 AI 區塊後面,看起來像壞掉。
// 用真實的升級情境測:舊版預設順序(沒有新區塊),升級後新的該插在鄰居旁。
{
	const oldDefault: SectionId[] = [
		"phonetics",
		"translation",
		"english",
		"surface",
		"frequency",
		"exams",
		"forms",
	];
	const upgraded = normalizeOrder(oldDefault);
	// 斷言「誰緊接在誰後面」會隨著正典順序改動而過期(加了朗文/牛津/字源就壞過一次)。
	// 改成驗真正的不變量:每個補進來的新區塊,都要緊接在「正典順序裡排它前面、
	// 而且也在清單裡」的那個區塊之後。
	const inserted = ALL_SECTIONS.filter((id) => !oldDefault.includes(id));
	const misplaced = inserted.filter((id) => {
		const canonPrev = ALL_SECTIONS.slice(0, ALL_SECTIONS.indexOf(id))
			.reverse()
			.find((x) => upgraded.includes(x));
		return canonPrev ? upgraded[upgraded.indexOf(canonPrev) + 1] !== id : false;
	});
	check(
		"新區塊都插在自己的正典鄰居後面",
		misplaced.length === 0,
		misplaced.length ? `錯位: ${misplaced.join(", ")}` : upgraded.join(" ")
	);
	check(
		"新區塊沒有全部堆在尾端",
		upgraded.indexOf("examples") < upgraded.indexOf("forms"),
		`examples 在 ${upgraded.indexOf("examples")}、forms 在 ${upgraded.indexOf("forms")}`
	);
}
check(
	"不認得的 id 丟掉",
	!normalizeOrder(["translation", "made-up-section"]).includes("made-up-section" as SectionId)
);
check(
	"重複的 id 只留一個",
	normalizeOrder(["claude", "claude", "translation"]).filter((x) => x === "claude").length === 1
);

console.log("\n勾選狀態正規化");
check(
	"沒存過設定時用預設",
	ALL_SECTIONS.every((id) => normalizeEnabled(undefined)[id] === DEFAULT_ENABLED[id])
);
check("使用者關掉的要保留", normalizeEnabled({ forms: false }).forms === false);
check(
	"設定裡沒提到的用預設，不是當成關閉",
	normalizeEnabled({ forms: false }).translation === true,
	"否則升級後新區塊會全部消失"
);
check("英英釋義預設開啟", DEFAULT_ENABLED.english === true, "79.7% 的詞條有這份資料，關掉是浪費");
check("考試標籤預設關閉", DEFAULT_ENABLED.exams === false, "一般閱讀是雜訊");
// AI 三樣一度預設全開(字典就該直接給答案),但本地模型要等好幾秒、內容還不穩。
// 劍橋詞典把「例句」「多義項辨析」做得更好又快一個量級,所以 AI 退位成加值選項。
check("劍橋詞典預設開啟", DEFAULT_ENABLED.cambridge === true, "主要內容來源");
check("例句與用法(AI)預設關閉", DEFAULT_ENABLED.usage === false, "太慢,交給劍橋");
check("字根詞族(AI)預設關閉", DEFAULT_ENABLED.detail === false, "太慢,想要再自己開");
// 劍橋要排在離線釋義前面——它是人編的內容,該先看到。
check(
	"劍橋排在 ECDICT 釋義之前",
	ALL_SECTIONS.indexOf("cambridge") < ALL_SECTIONS.indexOf("translation")
);
check(
	"舊使用者升級後會拿到 usage 區塊",
	normalizeOrder(["phonetics", "translation"]).includes("usage"),
	"這是 normalizeOrder 存在的理由"
);

console.log("\n搬移");
const base: SectionId[] = ["phonetics", "translation", "english"];
check("往下搬", eq(move(base, "phonetics", 1), ["translation", "phonetics", "english"]));
check("往上搬", eq(move(base, "english", -1), ["phonetics", "english", "translation"]));
check("最上面再往上搬不動", eq(move(base, "phonetics", -1), base));
check("最下面再往下搬不動", eq(move(base, "english", 1), base));
check("不在清單裡的原樣回傳", eq(move(base, "claude", 1), base));
check("搬移不改動原陣列", eq(base, ["phonetics", "translation", "english"]));

console.log("\n連續開關多個區塊,每一個都要留住");
// 2026-08-28 的真實 bug:設定頁拿 display() 當下的快照去展開,
// 切 toggle 又不重繪,於是每切一個就把其他的蓋回舊值——道哥的症狀是
// 「只要開啟了 Wiktionary,牛津跟朗文都會被取消掉」。
let e = normalizeEnabled({});
e = setSectionEnabled(e, "oxford", true);
e = setSectionEnabled(e, "longman", true);
e = setSectionEnabled(e, "wiktionary", true);
check("三個都還開著", e.oxford && e.longman && e.wiktionary,
	JSON.stringify({ oxford: e.oxford, longman: e.longman, wiktionary: e.wiktionary }));

const before = normalizeEnabled({});
setSectionEnabled(before, "oxford", true);
check("不會改到傳進去的物件", before.oxford === normalizeEnabled({}).oxford);

let off = setSectionEnabled(normalizeEnabled({}), "cambridge", false);
check("關得掉", off.cambridge === false);
off = setSectionEnabled(off, "oxford", true);
check("關掉的維持關掉", off.cambridge === false && off.oxford === true);
check("其他區塊維持預設", off.zh === normalizeEnabled({}).zh);

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
