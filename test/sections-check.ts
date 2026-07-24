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
check(
	"保留使用者調過的順序",
	eq(normalizeOrder(["claude", "translation"]).slice(0, 2), ["claude", "translation"]),
	normalizeOrder(["claude", "translation"]).join(" ")
);

// 這條是升級時的關鍵:外掛新增區塊時,舊使用者的設定裡沒有它。
// 若不補進來,那個新區塊永遠不會顯示,而且使用者找不到原因。
const partial = normalizeOrder(["translation", "phonetics"]);
check(
	"新版本新增的區塊要補進來（接在尾端）",
	partial.length === ALL_SECTIONS.length && eq(partial.slice(0, 2), ["translation", "phonetics"]),
	partial.join(" ")
);
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
check("例句與用法預設關閉", DEFAULT_ENABLED.usage === false, "每個字要花 token，讓使用者自己決定");
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

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
