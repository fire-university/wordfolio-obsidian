// 拿真實的發音快取檔驗證音量正規化。
//
//   node tools/audio-stats.mjs [資料夾]
//
// 預設讀 vault 裡外掛自己的 audio/ 快取。用 ffmpeg 解成 16k 單聲道 PCM,再走
// src/waveform.ts 裡**跟外掛執行期完全同一份**的邏輯,印出正規化前後的音量分布。
//
// 為什麼需要這個:`targetRms` 這種常數沒辦法用「感覺」挑,也沒辦法在瀏覽器裡
// 一次跑 81 個檔來看。挑錯的下場是一半的字削波(爆音)或者根本沒改善,而那兩種
// 都只有真的按下播放才發現。

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { analyse, normalizationGain, dbfs, trimSilence } from "../src/waveform.ts";

const DEFAULT_DIR = path.join(
	os.homedir(),
	"Library/Mobile Documents/iCloud~md~obsidian/Documents/Doug/.obsidian/plugins/wordfolio/audio"
);
const dir = process.argv[2] ?? DEFAULT_DIR;

if (!fs.existsSync(dir)) {
	console.error(`找不到音檔資料夾:${dir}`);
	process.exit(1);
}

/** mp3 → Float32Array(16 kHz 單聲道)。 */
function decode(file) {
	const raw = execFileSync(
		"ffmpeg",
		["-v", "quiet", "-i", file, "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
		{ maxBuffer: 1 << 28 }
	);
	const n = Math.floor(raw.length / 2);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = raw.readInt16LE(i * 2) / 32768;
	return out;
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".mp3")).sort();
if (!files.length) {
	console.error("資料夾裡沒有 mp3。");
	process.exit(1);
}

const rows = [];
for (const f of files) {
	const samples = decode(path.join(dir, f));
	if (!samples.length) continue;
	const [s, e] = trimSilence(samples);
	const l = analyse(samples);
	const gain = normalizationGain(l);
	rows.push({
		name: f.replace(/\.mp3$/, ""),
		dur: samples.length / 16000,
		trimmed: (e - s) / 16000,
		peak: l.peak,
		rms: l.rms,
		voiced: l.voiced,
		gain,
		afterRms: l.rms * gain,
		afterPeak: l.peak * gain,
	});
}

const fmt = (v) => dbfs(v).toFixed(1).padStart(6);
const spread = (vals) => `${Math.min(...vals).toFixed(1)} … ${Math.max(...vals).toFixed(1)}`;

rows.sort((a, b) => a.rms - b.rms);
console.log(`${files.length} 個檔,來自 ${dir}\n`);
console.log("人聲 RMS 最低與最高各五個(dBFS):\n");
console.log(`  ${"字".padEnd(24)} ${"長度".padStart(6)} ${"人聲".padStart(6)} ${"前".padStart(7)} ${"增益".padStart(6)} ${"後".padStart(7)} ${"後峰值".padStart(7)}`);
for (const r of [...rows.slice(0, 5), null, ...rows.slice(-5)]) {
	if (!r) {
		console.log("  …");
		continue;
	}
	console.log(
		`  ${r.name.padEnd(24)} ${r.dur.toFixed(2).padStart(5)}s ${(r.voiced * 100).toFixed(0).padStart(5)}% ` +
			`${fmt(r.rms)} ${("×" + r.gain.toFixed(2)).padStart(6)} ${fmt(r.afterRms)} ${fmt(r.afterPeak)}`
	);
}

const before = rows.map((r) => dbfs(r.rms));
const after = rows.map((r) => dbfs(r.afterRms));
const clipped = rows.filter((r) => r.afterPeak > 1);
const untouched = rows.filter((r) => Math.abs(r.gain - 1) < 0.05);

console.log("\n總結");
console.log(`  正規化前 RMS   ${spread(before)} dBFS,差距 ${(Math.max(...before) - Math.min(...before)).toFixed(1)} dB`);
console.log(`  正規化後 RMS   ${spread(after)} dBFS,差距 ${(Math.max(...after) - Math.min(...after)).toFixed(1)} dB`);
console.log(`  削波的檔       ${clipped.length} 個${clipped.length ? " ← 有削波就是爆音,必須修" : ""}`);
console.log(`  幾乎沒動的檔   ${untouched.length} 個`);
console.log(`  增益範圍       ×${Math.min(...rows.map((r) => r.gain)).toFixed(2)} … ×${Math.max(...rows.map((r) => r.gain)).toFixed(2)}`);

process.exit(clipped.length ? 1 : 0);
