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
import { analyse, normalizationGain, envelope, type WaveformData } from "./waveform";

export type Accent = "uk" | "us";

// 有道 dictvoice:type=1 英式,type=2 美式。免費、免 key。
const ACCENT_TYPE: Record<Accent, number> = { uk: 1, us: 2 };
const VOICE_LANG: Record<Accent, string> = { uk: "en-GB", us: "en-US" };

/** 波形要切幾格。56 格在浮窗那個寬度下,一格大約 4px,看得出音節。 */
const BUCKETS = 56;

/** 一個字解碼後的分析結果。型別本體在 waveform.ts(純模組),見那裡的說明。 */
export type Waveform = WaveformData;

export class Audio {
	/** 解碼過的音檔。同一個字反覆按不要重新解碼。 */
	private decoded = new Map<string, AudioBuffer>();
	/** 分析結果。浮窗每次重畫都要問「這個字的波形算過沒」,必須是同步的。 */
	private waves = new Map<string, Waveform>();
	/** 正在解碼中的字,避免連按兩下抓兩次。 */
	private pending = new Map<string, Promise<Waveform | null>>();
	private ctx: AudioContext | null = null;
	private playing: AudioBufferSourceNode | null = null;

	constructor(
		private vault: Vault,
		private cacheDir: string,
		private onlineAllowed: () => boolean,
		/** 要不要把各個字的音量拉齊。設定頁可關。 */
		private normalize: () => boolean = () => true
	) {}

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

	async speak(word: string, accent: Accent): Promise<void> {
		if (this.onlineAllowed()) {
			const key = this.cacheKey(word, accent);
			const buf = this.decoded.get(key) ?? (await this.load(word, accent));
			if (buf) {
				await this.play(buf, this.waves.get(key)?.gain ?? 1);
				return;
			}
		}
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
	async waveform(word: string, accent: Accent): Promise<Waveform | null> {
		const key = this.cacheKey(word, accent);
		const done = this.waves.get(key);
		if (done) return done;

		const inflight = this.pending.get(key);
		if (inflight) return inflight;

		const job = (async () => {
			const path = `${this.cacheDir}/${key}`;
			try {
				if (!(await this.vault.adapter.exists(path))) return null;
				const raw = await this.vault.adapter.readBinary(path);
				return await this.decode(key, raw);
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
		const wave: Waveform = {
			env: envelope(samples, BUCKETS),
			duration: buf.duration,
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

	private play(buf: AudioBuffer, gain: number): Promise<void> {
		const ctx = this.audioCtx();
		// 上一次還在響就掐掉。連按兩個字時兩段聲音疊在一起會聽不清楚。
		try {
			this.playing?.stop();
		} catch {
			// 已經播完的 source 再 stop 會丟例外,不是問題。
		}

		const src = ctx.createBufferSource();
		src.buffer = buf;
		const g = ctx.createGain();
		g.gain.value = this.normalize() ? gain : 1;
		src.connect(g).connect(ctx.destination);
		this.playing = src;

		return new Promise((resolve) => {
			src.onended = () => {
				if (this.playing === src) this.playing = null;
				resolve();
			};
			try {
				src.start();
			} catch {
				resolve();
			}
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
		try {
			this.playing?.stop();
		} catch {
			// 同上
		}
		this.playing = null;
		this.decoded.clear();
		this.waves.clear();
		this.pending.clear();
		void this.ctx?.close();
		this.ctx = null;
	}
}
