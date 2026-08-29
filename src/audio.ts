// 發音。
//
// 釋義跟發音刻意解耦:釋義永遠來自離線詞庫,只有音檔可能需要連網。
// 真人錄音對語言學習差很多,所以優先;抓過的存進外掛資料夾,第二次以後
// 完全離線。斷網又沒快取時退回系統語音,至少聽得到。
//
// **播放走 Web Audio 而不是 `new Audio(url)`。** 換掉是因為一次要三件事:
// 播放、拿到取樣畫波形、播放時套上音量增益。`<audio>` 元素只給第一件,而
// 三件事的前提都是同一個 decode,分開做等於解碼三次。
//
// 實測道哥快取的 81 個檔:人聲 RMS 從 −21.9 到 −10.3 dBFS,差 11.6 dB
// (約四倍響度)。正規化之後全部落在 −15.9,零削波。詳見 tools/audio-stats.mjs。
//
// 訊號處理的純函式在 waveform.ts,那個檔不 import obsidian,所以測得到。

import { requestUrl, Vault } from "obsidian";
import { DICTVOICE_ENDPOINT } from "./settings";
import { analyse, normalizationGain, envelope, trimSilence, type WaveformData } from "./waveform";

export type Accent = "uk" | "us";

/**
 * 播放進度回報。0–1 是播放中,**null 代表結束或被取消**。
 *
 * 收到 null 一定要把畫面還原,不然停下來的波形會停在一半的亮度,看起來像卡住。
 */
export type ProgressFn = (p: number | null) => void;

// 有道 dictvoice:type=1 英式,type=2 美式。免費、免 key。
const ACCENT_TYPE: Record<Accent, number> = { uk: 1, us: 2 };
const VOICE_LANG: Record<Accent, string> = { uk: "en-GB", us: "en-US" };

/** 波形要切幾格。56 格在浮窗那個寬度下,一格大約 4px,看得出音節。 */
const BUCKETS = 56;

/**
 * 掐前置靜音時,前後各留多少秒的餘裕。
 *
 * 60 毫秒是刻意偏保守的:多留一點沒人聽得出來,切掉一個爆破音卻會讓整個字
 * 聽起來是錯的。實測有道的錄音前置靜音中位數 0.31 秒、最長 0.50 秒,
 * 掐掉之後按下播放就直接出聲,跟著波形唸才跟得上。
 */
const TRIM_PAD_SEC = 0.06;

/** 一個字解碼後的分析結果。型別本體在 waveform.ts(純模組),見那裡的說明。 */
export type Waveform = WaveformData;

export class Audio {
	/** 解碼過的音檔。同一個字反覆按不要重新解碼。 */
	private decoded = new Map<string, AudioBuffer>();
	/** 分析結果。浮窗每次重畫都要問「這個字的波形算過沒」,必須是同步的。 */
	private waves = new Map<string, Waveform>();
	/** 正在解碼中的字,避免連按兩下抓兩次。 */
	private pending = new Map<string, Promise<Waveform | null>>();
	/**
	 * 有道沒有這個字的錄音。
	 *
	 * **開了 hover 預先下載之後,這個negative cache 是必要的**:有道不是每個字
	 * 都有錄音(冷僻字、片語),沒有的話每滑過去一次就再問一次,同一個字讀一篇
	 * 文章可能滑過十幾次——那是對別人的免費服務做重複轟炸。
	 */
	private missing = new Set<string>();
	private ctx: AudioContext | null = null;
	private playing: AudioBufferSourceNode | null = null;
	/** 進行中的進度動畫。換一個字播放時要先取消,不然兩條線一起跑。 */
	private raf = 0;
	private onProgress: ProgressFn | null = null;

	constructor(
		private vault: Vault,
		private cacheDir: string,
		private onlineAllowed: () => boolean,
		/** 要不要把各個字的音量拉齊。設定頁可關。 */
		private normalize: () => boolean = () => true
	) {}

	/** 這個字這個口音確定抓不到,不要再問了。 */
	private markMissing(key: string): void {
		this.missing.add(key);
	}

	/**
	 * AudioContext 延後到第一次真的要出聲才建立。
	 *
	 * 開機就建一個等於平白佔著音訊裝置,而且瀏覽器會因為「沒有使用者手勢」
	 * 把它掛在 suspended,之後還要記得喚醒。
	 */
	private audioCtx(): AudioContext {
		if (!this.ctx) this.ctx = new AudioContext();
		if (this.ctx.state === "suspended") void this.ctx.resume();
		return this.ctx;
	}

	/**
	 * 念出這個字。
	 *
	 * `onProgress` 是給波形用的:播放過程中一直回報 0–1,結束或被打斷時回報 null。
	 * **走系統語音時完全不會呼叫它**——speechSynthesis 的輸出不經過 Web Audio,
	 * 拿不到時間軸,硬做只能用「猜一個秒數」的假動畫,那比沒有更糟。
	 */
	async speak(word: string, accent: Accent, onProgress?: ProgressFn): Promise<void> {
		if (this.onlineAllowed()) {
			const key = this.cacheKey(word, accent);
			const buf = this.decoded.get(key) ?? (await this.load(word, accent));
			const wave = this.waves.get(key);
			if (buf) {
				await this.play(buf, wave, onProgress);
				return;
			}
		}
		onProgress?.(null);
		this.systemVoice(word, accent);
	}

	// ---------------------------------------------------- 波形

	/** 算過的波形。浮窗畫的時候用,同步,沒有就回 null。 */
	cachedWaveform(word: string, accent: Accent): Waveform | null {
		return this.waves.get(this.cacheKey(word, accent)) ?? null;
	}

	/**
	 * 確保某個字的波形算好。浮窗開起來時呼叫,算完再重畫一次。
	 *
	 * **不會為了畫波形而連網去抓新的音檔**——只用磁碟上已經有的。滑過一個字就
	 * 送一次請求去有道,只為了畫一條線,那是拿別人的頻寬換一個沒人要求的東西;
	 * 真的要抓是使用者按下發音鍵的時候。
	 */
	async waveform(word: string, accent: Accent, fetch = false): Promise<Waveform | null> {
		const key = this.cacheKey(word, accent);
		const done = this.waves.get(key);
		if (done) return done;

		const inflight = this.pending.get(key);
		if (inflight) return inflight;

		// 問過而且確定沒有的,不要再問。
		if (fetch && this.missing.has(key)) return null;

		const job = (async () => {
			const path = `${this.cacheDir}/${key}`;
			try {
				if (await this.vault.adapter.exists(path)) {
					return await this.decode(key, await this.vault.adapter.readBinary(path));
				}
				// 磁碟上沒有。預先下載開著、而且允許連網時才去抓。
				if (!fetch || !this.onlineAllowed()) return null;
				const buf = await this.load(word, accent);
				if (!buf) this.markMissing(key);
				return this.waves.get(key) ?? null;
			} catch {
				return null;
			} finally {
				this.pending.delete(key);
			}
		})();
		this.pending.set(key, job);
		return job;
	}

	private async decode(key: string, raw: ArrayBuffer): Promise<Waveform | null> {
		// decodeAudioData 會吃掉(detach)傳進去的 ArrayBuffer,所以給它一份副本——
		// 不給的話,同一份 raw 之後要再用就變成長度 0,而且不會丟例外。
		const buf = await this.audioCtx().decodeAudioData(raw.slice(0));
		const samples = buf.getChannelData(0);
		const loudness = analyse(samples);

		// **波形與播放掐在同一個區間。** 播放跳過前置靜音、波形也只畫那一段,
		// 兩邊都用這一次的計算結果,所以不可能對不上。分開算才會漂移。
		const pad = Math.round(TRIM_PAD_SEC * buf.sampleRate);
		const [from, to] = trimSilence(samples, pad);

		const wave: Waveform = {
			env: envelope(samples.subarray(from, to), BUCKETS),
			offset: from / buf.sampleRate,
			duration: (to - from) / buf.sampleRate,
			loudness,
			gain: normalizationGain(loudness),
		};
		this.decoded.set(key, buf);
		this.waves.set(key, wave);
		return wave;
	}

	// ---------------------------------------------------- 真人錄音

	private cacheKey(word: string, accent: Accent): string {
		// 檔名只留安全字元;大小寫不同的同一個字共用一個檔。
		const safe = word.toLowerCase().replace(/[^a-z0-9'-]/g, "_");
		return `${safe}.${accent}.mp3`;
	}

	/** 磁碟上有就讀,沒有就抓一次。回傳解碼好的 buffer。 */
	private async load(word: string, accent: Accent): Promise<AudioBuffer | null> {
		const key = this.cacheKey(word, accent);
		const filePath = `${this.cacheDir}/${key}`;

		try {
			if (await this.vault.adapter.exists(filePath)) {
				await this.decode(key, await this.vault.adapter.readBinary(filePath));
				return this.decoded.get(key) ?? null;
			}
		} catch {
			// 檔案壞了或解不開就當作沒有,往下走去重抓。
		}

		// 抓不到不是錯誤——斷網、對方擋了都可能,交給系統語音。
		try {
			const res = await requestUrl({
				url: `${DICTVOICE_ENDPOINT}?audio=${encodeURIComponent(word)}&type=${ACCENT_TYPE[accent]}`,
				method: "GET",
				throw: false,
			});
			if (res.status !== 200 || !res.arrayBuffer?.byteLength) return null;

			await this.vault.adapter.mkdir(this.cacheDir).catch(() => undefined);
			await this.vault.adapter.writeBinary(filePath, res.arrayBuffer);

			await this.decode(key, res.arrayBuffer);
			return this.decoded.get(key) ?? null;
		} catch {
			return null;
		}
	}

	/** 停掉目前的播放與進度動畫,並把上一個訂閱者的畫面還原。 */
	private stopCurrent(): void {
		if (this.raf) cancelAnimationFrame(this.raf);
		this.raf = 0;
		this.onProgress?.(null);
		this.onProgress = null;
		try {
			this.playing?.stop();
		} catch {
			// 已經播完的 source 再 stop 會丟例外,不是問題。
		}
		this.playing = null;
	}

	private play(buf: AudioBuffer, wave: Waveform | undefined, onProgress?: ProgressFn): Promise<void> {
		const ctx = this.audioCtx();
		// 上一次還在響就掐掉。連按兩個字時兩段聲音疊在一起會聽不清楚,
		// 而且兩條進度動畫會同時跑。
		this.stopCurrent();

		const src = ctx.createBufferSource();
		src.buffer = buf;
		const g = ctx.createGain();
		g.gain.value = this.normalize() ? (wave?.gain ?? 1) : 1;
		src.connect(g).connect(ctx.destination);
		this.playing = src;
		this.onProgress = onProgress ?? null;

		// 掐掉前置靜音再播:實測前置靜音中位數 0.31 秒,不掐的話按下去要等
		// 三分之一秒才出聲,而波形也會先空跑一段。
		const offset = wave?.offset ?? 0;
		const dur = wave?.duration ?? buf.duration;

		return new Promise((resolve) => {
			src.onended = () => {
				if (this.playing !== src) return; // 已經被下一個播放接手了
				if (this.raf) cancelAnimationFrame(this.raf);
				this.raf = 0;
				this.onProgress?.(null);
				this.onProgress = null;
				this.playing = null;
				resolve();
			};
			try {
				src.start(0, offset, dur);
			} catch {
				this.onProgress?.(null);
				this.onProgress = null;
				resolve();
				return;
			}

			if (!onProgress || dur <= 0) return;
			// 進度用 ctx.currentTime 算,不用 Date.now()——它跟音訊時鐘是同一個,
			// 所以畫面跟聲音不會慢慢漂開。
			const startedAt = ctx.currentTime;
			const step = () => {
				if (this.playing !== src) return;
				const p = (ctx.currentTime - startedAt) / dur;
				onProgress(Math.max(0, Math.min(1, p)));
				if (p < 1) this.raf = requestAnimationFrame(step);
			};
			this.raf = requestAnimationFrame(step);
		});
	}

	// ---------------------------------------------------- 系統語音

	private systemVoice(word: string, accent: Accent): void {
		const synth = window.speechSynthesis;
		if (!synth) return;
		synth.cancel();

		const u = new SpeechSynthesisUtterance(word);
		u.lang = VOICE_LANG[accent];
		// macOS 通常同時裝了英美語音;挑一個語系相符的,挑不到就用系統預設。
		const match = synth.getVoices().find((v) => v.lang.replace("_", "-") === u.lang);
		if (match) u.voice = match;
		u.rate = 0.9;
		synth.speak(u);
	}

	dispose(): void {
		this.stopCurrent();
		this.decoded.clear();
		this.waves.clear();
		this.pending.clear();
		this.missing.clear();
		void this.ctx?.close();
		this.ctx = null;
	}
}
