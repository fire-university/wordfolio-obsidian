// 音量分析與包絡線。純函式,用合成訊號測,不需要真的音檔。
//
//   npx tsx test/waveform-check.ts
//
// 真實錄音的驗證在 `node tools/audio-stats.mjs`(拿快取的 81 個檔跑一遍,
// 看正規化後的音量分布與有沒有削波)。那個要 ffmpeg,不進 npm test。

import { analyse, normalizationGain, envelope, trimSilence, dbfs } from "../src/waveform";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
	console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? "  " + detail : ""}`);
	if (!ok) failures++;
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/** 固定振幅的正弦波。RMS 剛好是振幅 / √2,方便對答案。 */
function sine(amp: number, n: number, period = 32): Float32Array {
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * i) / period);
	return out;
}
function concat(...parts: Float32Array[]): Float32Array {
	const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
const silence = (n: number) => new Float32Array(n);

console.log("音量分析");
{
	const s = sine(0.5, 3200);
	const l = analyse(s);
	check("峰值", near(l.peak, 0.5), l.peak.toFixed(3));
	check("RMS 是振幅 / √2", near(l.rms, 0.5 / Math.SQRT2, 0.02), l.rms.toFixed(3));
	check("整段都是人聲", l.voiced > 0.9, l.voiced.toFixed(2));
}

console.log("\n頭尾的靜音不可以稀釋音量(有道的長錄音留白很多)");
{
	const voice = sine(0.5, 3200);
	const bare = analyse(voice);
	const padded = analyse(concat(silence(16000), voice, silence(16000)));
	check("加了兩秒靜音,人聲 RMS 不變", near(bare.rms, padded.rms, 0.01),
		`${bare.rms.toFixed(3)} vs ${padded.rms.toFixed(3)}`);
	check("峰值也不變", near(bare.peak, padded.peak));
	check("但人聲比例掉下來了", padded.voiced < 0.15, padded.voiced.toFixed(3));
	// 這正是「比較長的字看起來比較小聲」的來源:實測 violently 整段 RMS
	// −27.6 dBFS,只算人聲是 −21.9,差了 5.7 dB 全是留白造成的。
}

console.log("\n正規化增益");
{
	const quiet = analyse(sine(0.08, 3200));
	const loud = analyse(sine(0.7, 3200));
	const gq = normalizationGain(quiet);
	const gl = normalizationGain(loud);
	check("小聲的被放大", gq > 1, `×${gq.toFixed(2)}`);
	check("大聲的被壓下來", gl < 1, `×${gl.toFixed(2)}`);
	check("兩個拉到同一個 RMS", near(quiet.rms * gq, loud.rms * gl, 0.005),
		`${dbfs(quiet.rms * gq).toFixed(1)} vs ${dbfs(loud.rms * gl).toFixed(1)} dBFS`);
}

console.log("\n不可以削波——削波聽起來就是爆音,比音量不齊更糟");
{
	// 峰值很高但整體很小聲:一顆爆音配一段氣音。照 RMS 硬拉一定削波,
	// 所以峰值那道天花板必須壓得住。
	const spike = concat(sine(0.02, 6400), sine(0.99, 64), sine(0.02, 6400));
	const l = analyse(spike);
	const g = normalizationGain(l);
	// 真正的不變量是「**正規化不可以讓它比原本更容易削波**」,不是「峰值一定
	// 低於 0.98」。這個檔 99.5% 是靜音,落在「人聲太少就別動它」那條規則裡,
	// 增益是 ×1——原封不動播放,跟今天沒有正規化時完全一樣,不會多出任何失真。
	// 會削波的只有 g > 1 的情況,那條才要被峰值天花板壓住。
	check("不會比原本更容易削波", l.peak * g <= Math.max(l.peak, 0.98), `峰值 ${(l.peak * g).toFixed(3)}`);
	check("增益沒有大到離譜", g <= 6, `×${g.toFixed(2)}`);

	// 放大的時候(g > 1)才是危險的,那條要守死。
	for (const [amp, pad] of [[0.9, 0], [0.95, 3200], [0.99, 1600]] as [number, number][]) {
		const sig = pad ? concat(silence(pad), sine(amp, 6400), silence(pad)) : sine(amp, 6400);
		const a = analyse(sig);
		const gg = normalizationGain(a);
		check(
			`峰值 ${amp} 的檔,放大時守得住天花板`,
			gg <= 1 || a.peak * gg <= 0.98,
			`×${gg.toFixed(2)} → 峰值 ${(a.peak * gg).toFixed(3)}`
		);
	}

	for (const amp of [0.01, 0.05, 0.2, 0.5, 0.9, 0.99]) {
		const a = analyse(sine(amp, 3200));
		check(`振幅 ${amp} 放大後不削波`, a.peak * normalizationGain(a) <= 0.98);
	}
}

console.log("\n邊界情況");
{
	check("全靜音不要動它", normalizationGain(analyse(silence(1600))) === 1);
	check("空的取樣不會爆", normalizationGain(analyse(new Float32Array(0))) === 1);
	// 幾乎全是靜音的檔(例如抓到半個壞掉的音檔)不該被硬拉六倍。
	const mostlySilent = concat(silence(32000), sine(0.3, 160));
	check("人聲只有一點點就不動它", normalizationGain(analyse(mostlySilent)) === 1,
		`人聲比例 ${analyse(mostlySilent).voiced.toFixed(4)}`);
}

console.log("\n包絡線(畫成浮窗那條波形)");
{
	const wave = concat(sine(0.1, 1600), sine(0.9, 1600), sine(0.1, 1600));
	const env = envelope(wave, 12);
	check("格數正確", env.length === 12, String(env.length));
	check("最大值正規化成 1", near(Math.max(...env), 1), Math.max(...env).toFixed(3));
	check("全部落在 0–1", env.every((v) => v >= 0 && v <= 1));
	const [a, b, c] = [env.slice(0, 4), env.slice(4, 8), env.slice(8)];
	const avg = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
	check("中段最高(重音看得出來)", avg(b) > avg(a) && avg(b) > avg(c),
		`${avg(a).toFixed(2)} / ${avg(b).toFixed(2)} / ${avg(c).toFixed(2)}`);
}
{
	check("空的取樣回空陣列", envelope(new Float32Array(0)).length === 0);
	check("全靜音回全 0,不是 NaN", envelope(silence(1600), 8).every((v) => v === 0));
	// 取樣數比格數還少時,不可以出現 NaN 或負的高度——畫出來會變成破圖。
	const tiny = envelope(sine(0.5, 3), 8);
	check("取樣比格數少也不會壞", tiny.length === 8 && tiny.every((v) => Number.isFinite(v) && v >= 0),
		JSON.stringify(tiny.map((v) => +v.toFixed(2))));
}

console.log("\n掐頭尾的靜音");
{
	const voice = sine(0.5, 3200);
	const [s, e] = trimSilence(concat(silence(8000), voice, silence(8000)));
	check("起點落在人聲前面", s < 8000 && s > 8000 - 1000, String(s));
	check("終點落在人聲後面", e > 11200 && e < 11200 + 1000, String(e));
	check("留下來的長度接近人聲本身", e - s > 3200 && e - s < 3200 + 2000, String(e - s));
}
{
	const [s, e] = trimSilence(silence(1600));
	check("整段靜音時不要掐成空的", s === 0 && e === 1600, `${s}..${e}`);
}

console.log("\ndBFS");
check("滿刻度是 0 dBFS", near(dbfs(1), 0));
check("一半是 −6 dBFS", near(dbfs(0.5), -6.02, 0.05), dbfs(0.5).toFixed(2));
check("0 壓成 −99,不是 −Infinity", dbfs(0) === -99);

console.log(failures === 0 ? "\n全部通過。" : `\n${failures} 項失敗。`);
process.exit(failures === 0 ? 0 : 1);
