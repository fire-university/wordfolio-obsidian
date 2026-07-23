// 發音。
//
// 釋義跟發音刻意解耦:釋義永遠來自離線詞庫,只有音檔可能需要連網。
// 真人錄音對語言學習差很多,所以優先;抓過的存進外掛資料夾,第二次以後
// 完全離線。斷網又沒快取時退回系統語音,至少聽得到。

import { requestUrl, Vault } from "obsidian";
import { DICTVOICE_ENDPOINT } from "./settings";

export type Accent = "uk" | "us";

// 有道 dictvoice:type=1 英式,type=2 美式。免費、免 key。
const ACCENT_TYPE: Record<Accent, number> = { uk: 1, us: 2 };
const VOICE_LANG: Record<Accent, string> = { uk: "en-GB", us: "en-US" };

export class Audio {
	/** 已解碼的音檔,避免同一個字反覆讀檔 */
	private memCache = new Map<string, string>();

	constructor(
		private vault: Vault,
		private cacheDir: string,
		private onlineAllowed: () => boolean
	) {}

	async speak(word: string, accent: Accent): Promise<void> {
		if (this.onlineAllowed()) {
			const url = await this.recording(word, accent);
			if (url) {
				await this.play(url);
				return;
			}
		}
		this.systemVoice(word, accent);
	}

	// ---------------------------------------------------- 真人錄音

	private cacheKey(word: string, accent: Accent): string {
		// 檔名只留安全字元;大小寫不同的同一個字共用一個檔。
		const safe = word.toLowerCase().replace(/[^a-z0-9'-]/g, "_");
		return `${safe}.${accent}.mp3`;
	}

	private async recording(word: string, accent: Accent): Promise<string | null> {
		const key = this.cacheKey(word, accent);
		const cached = this.memCache.get(key);
		if (cached) return cached;

		const filePath = `${this.cacheDir}/${key}`;

		// 先看磁碟快取。
		if (await this.vault.adapter.exists(filePath)) {
			const buf = await this.vault.adapter.readBinary(filePath);
			const url = URL.createObjectURL(new Blob([buf], { type: "audio/mpeg" }));
			this.memCache.set(key, url);
			return url;
		}

		// 沒有就抓一次。抓不到不是錯誤——斷網、對方擋了都可能,交給系統語音。
		try {
			const res = await requestUrl({
				url: `${DICTVOICE_ENDPOINT}?audio=${encodeURIComponent(word)}&type=${ACCENT_TYPE[accent]}`,
				method: "GET",
				throw: false,
			});
			if (res.status !== 200 || !res.arrayBuffer?.byteLength) return null;

			await this.vault.adapter.mkdir(this.cacheDir).catch(() => undefined);
			await this.vault.adapter.writeBinary(filePath, res.arrayBuffer);

			const url = URL.createObjectURL(
				new Blob([res.arrayBuffer], { type: "audio/mpeg" })
			);
			this.memCache.set(key, url);
			return url;
		} catch {
			return null;
		}
	}

	private play(url: string): Promise<void> {
		return new Promise((resolve) => {
			const el = new window.Audio(url);
			el.onended = () => resolve();
			el.onerror = () => resolve();
			void el.play().catch(() => resolve());
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
		for (const url of this.memCache.values()) URL.revokeObjectURL(url);
		this.memCache.clear();
	}
}
