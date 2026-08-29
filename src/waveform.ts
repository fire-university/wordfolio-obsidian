// 發音音檔的分析:音量、包絡線。
//
// **這個檔刻意不 import obsidian**(專案規則,見 anki-fields.ts 檔頭)。吃的是
// 一段 Float32Array 取樣,所以 node 測試可以用 ffmpeg 解出真實 PCM 直接餵進來,
// 不必在測試裡假造波形——這幾個函式的正確性只有拿真的錄音跑才看得出來。
//
// 兩個用途:
//
//   1. **包絡線**:畫成浮窗裡那條波形。看得到的不只是「多大聲」,還有**重音落在
//      哪一個音節**——architecture 是第一段最高,testimonial 是第三段。
//   2. **音量正規化**:有道的錄音音量很不一致。實測道哥快取的 81 個檔,整體 RMS
//      從 −27.6 到 −12.8 dBFS,差 14.7 dB(約五倍響度)。同一個字典裡有的字要
//      湊近喇叭聽、有的嚇一跳,那不是內容問題是工程問題。

/** 靜音門檻。低於這個振幅的取樣不算進「人聲的音量」。 */
const SILENCE = 0.02;

export interface Loudness {
	/** 最大絕對振幅(0–1) */
	peak: number;
	/**
	 * 人聲部分的 RMS。
	 *
	 * **刻意排除靜音**:有道的長錄音前後留白多,把靜音算進去會讓 RMS 被稀釋,
	 * 於是「比較長的字」看起來就比較小聲——那是假的。實測 violently(2.03 秒)
	 * 整體 RMS −27.6 dBFS,但真正在講話的那段其實沒那麼小聲。
	 */
	rms: number;
	/** 有多少比例的取樣是人聲。全靜音的檔會是 0。 */
	voiced: number;
}

export function analyse(samples: Float32Array): Loudness {
	let peak = 0;
	let sum = 0;
	let n = 0;
	for (let i = 0; i < samples.length; i++) {
		const a = Math.abs(samples[i]);
		if (a > peak) peak = a;
		if (a >= SILENCE) {
			sum += samples[i] * samples[i];
			n++;
		}
	}
	return {
		peak,
		rms: n ? Math.sqrt(sum / n) : 0,
		voiced: samples.length ? n / samples.length : 0,
	};
}

/**
 * 一個字算好的波形。
 *
 * **型別定義放在這個純模組裡,不是放 audio.ts。** 浮窗要畫波形就得認得這個
 * 型別,而 audio.ts 有 import obsidian——讓 tooltip.ts 去 import 它,等於把
 * 整個 tooltip 的測試拖進「Cannot find module 'obsidian'」。這個專案在同一個
 * 坑裡摔過四次了。
 */
export interface WaveformData {
	/** 0–1 的包絡線 */
	env: number[];
	/** 秒 */
	duration: number;
	loudness: Loudness;
	/** 播放時要乘的增益 */
	gain: number;
}

export interface GainOptions {
	/** 目標人聲 RMS。預設值是量過 81 個真實檔案之後選的,見 tools/audio-stats.mjs。 */
	targetRms?: number;
	/** 放大後的峰值不可以超過這個,否則會削波(聽起來是爆音)。 */
	maxPeak?: number;
	/** 增益上限。太小聲的檔硬拉會把底噪一起拉上來。 */
	maxGain?: number;
}

/**
 * 播放時要乘上的增益。
 *
 * 兩道天花板:先照 RMS 算出想要的倍數,再被「峰值不可以削波」壓下來。**順序不能
 * 反過來**——只看峰值的話,一個單獨的爆音就會決定整個檔的音量,而那顆爆音通常
 * 不是人聲。
 */
export function normalizationGain(l: Loudness, opts: GainOptions = {}): number {
	const targetRms = opts.targetRms ?? 0.16;
	const maxPeak = opts.maxPeak ?? 0.97;
	const maxGain = opts.maxGain ?? 6;

	// 沒有人聲(全靜音、或短到量不出來)就不要動它。
	if (!l.rms || !l.peak || l.voiced < 0.02) return 1;

	const wanted = targetRms / l.rms;
	const ceiling = maxPeak / l.peak;
	return Math.max(0.2, Math.min(wanted, ceiling, maxGain));
}

/**
 * 畫波形用的包絡線:把整段切成 buckets 格,每格取 RMS,再以最大值正規化到 0–1。
 *
 * 回傳的是**形狀**不是絕對音量——畫在浮窗裡的目的是看重音落在哪裡,每個字各自
 * 填滿高度才看得清楚。想看絕對音量的話用 analyse()。
 */
export function envelope(samples: Float32Array, buckets = 56): number[] {
	if (!samples.length || buckets < 1) return [];
	const out: number[] = [];
	let max = 0;
	for (let i = 0; i < buckets; i++) {
		const lo = Math.floor((samples.length * i) / buckets);
		const hi = Math.max(Math.floor((samples.length * (i + 1)) / buckets), lo + 1);
		let sum = 0;
		for (let j = lo; j < hi && j < samples.length; j++) sum += samples[j] * samples[j];
		const v = Math.sqrt(sum / (hi - lo));
		out.push(v);
		if (v > max) max = v;
	}
	return max > 0 ? out.map((v) => v / max) : out.map(() => 0);
}

/**
 * 掐掉頭尾的靜音,回傳 [起點, 終點] 取樣索引。
 *
 * 有道的錄音前後常有半秒以上的空白。不掐的話波形會被擠在中間一小段,而按下
 * 播放之後還要等空白跑完才聽到聲音。
 */
export function trimSilence(samples: Float32Array, pad = 0.02): [number, number] {
	const n = samples.length;
	let start = 0;
	let end = n;
	while (start < n && Math.abs(samples[start]) < SILENCE) start++;
	while (end > start && Math.abs(samples[end - 1]) < SILENCE) end--;
	if (start >= end) return [0, n]; // 整段都在門檻以下,不要掐成空的

	// 留一點餘裕,不然子音的起音會被切掉,聽起來像被吃掉一個音。
	const padN = Math.round(pad * n);
	return [Math.max(0, start - padN), Math.min(n, end + padN)];
}

/** 給人看的分貝值。0 振幅回 -Infinity 的話畫面不好處理,壓成 -99。 */
export function dbfs(amplitude: number): number {
	return amplitude <= 0 ? -99 : 20 * Math.log10(amplitude);
}
