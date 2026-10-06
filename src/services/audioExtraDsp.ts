// src/services/audioExtraDsp.ts
//
// DSP murni (tanpa Web Audio API) untuk alat-alat tambahan PlayMuzeck:
// gabung audio, fade, deteksi BPM & kunci nada, hapus jeda hening, normalisasi
// loudness (LUFS), stereo ke mono, pembuat klik metronom, dan deteksi pitch (tuner).
// Semua fungsi bekerja pada array kanal Float32Array sehingga bisa diuji di Node.

export type Channels = Float32Array[];

// ───────────────────────── Utilitas dasar ─────────────────────────

export const dbToLin = (db: number) => Math.pow(10, db / 20);
export const linToDb = (lin: number) => 20 * Math.log10(Math.max(lin, 1e-12));

export function peakOf(ch: Channels): number {
  let p = 0;
  for (const c of ch) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > p) p = a; }
  return p;
}

export function cloneChannels(ch: Channels): Channels {
  return ch.map((c) => new Float32Array(c));
}

export function toMono(ch: Channels): Channels {
  if (ch.length <= 1) return cloneChannels(ch);
  const n = ch[0].length;
  const out = new Float32Array(n);
  for (const c of ch) for (let i = 0; i < n; i++) out[i] += c[i];
  const k = 1 / ch.length;
  for (let i = 0; i < n; i++) out[i] *= k;
  return [out];
}

function monoMix(ch: Channels): Float32Array {
  return toMono(ch)[0] ?? new Float32Array(0);
}

/** Ambil potongan [startSec, endSec) dari audio. */
export function sliceChannels(ch: Channels, sr: number, startSec: number, endSec: number): Channels {
  const n = ch[0]?.length ?? 0;
  const a = Math.max(0, Math.min(n, Math.round(startSec * sr)));
  const b = Math.max(a, Math.min(n, Math.round(endSec * sr)));
  return ch.map((c) => c.slice(a, b));
}

/** Samakan jumlah kanal (mono -> stereo dengan menduplikasi, atau kanal berlebih dibuang). */
export function matchChannelCount(ch: Channels, count: number): Channels {
  if (ch.length === count) return ch;
  const out: Channels = [];
  for (let i = 0; i < count; i++) out.push(ch[Math.min(i, ch.length - 1)]);
  return out;
}

// ───────────────────────── Gabung & Fade ─────────────────────────

/**
 * Gabung beberapa audio berurutan. `crossfadeSec` > 0 membuat tumpang-tindih
 * dengan kurva equal-power di tiap sambungan. Semua bagian harus sample rate sama.
 */
export function concatChannels(parts: Channels[], sr: number, crossfadeSec = 0): Channels {
  const valid = parts.filter((p) => (p[0]?.length ?? 0) > 0);
  if (valid.length === 0) return [new Float32Array(0)];
  const chCount = Math.max(...valid.map((p) => p.length));
  const norm = valid.map((p) => matchChannelCount(p, chCount));
  let out: Channels = norm[0].map((c) => new Float32Array(c));

  for (let k = 1; k < norm.length; k++) {
    const next = norm[k];
    const prevLen = out[0].length;
    const nextLen = next[0].length;
    const cf = Math.max(0, Math.min(Math.round(crossfadeSec * sr), Math.floor(prevLen / 2), Math.floor(nextLen / 2)));
    const total = prevLen + nextLen - cf;
    const merged: Channels = [];
    for (let c = 0; c < chCount; c++) {
      const m = new Float32Array(total);
      m.set(out[c].subarray(0, prevLen - cf), 0);
      for (let i = 0; i < cf; i++) {
        const t = cf === 1 ? 1 : i / (cf - 1);
        const gOut = Math.cos(t * Math.PI / 2);
        const gIn = Math.sin(t * Math.PI / 2);
        m[prevLen - cf + i] = out[c][prevLen - cf + i] * gOut + next[c][i] * gIn;
      }
      m.set(next[c].subarray(cf), prevLen);
      merged.push(m);
    }
    out = merged;
  }
  return out;
}

export type FadeCurve = 'linear' | 'natural' | 'scurve';

function fadeGain(t: number, curve: FadeCurve): number {
  const x = Math.max(0, Math.min(1, t));
  if (curve === 'natural') return x * x;
  if (curve === 'scurve') return x * x * (3 - 2 * x);
  return x;
}

/** Fade in di awal dan fade out di akhir (detik). Mengembalikan salinan baru. */
export function applyFade(ch: Channels, sr: number, fadeInSec: number, fadeOutSec: number, curve: FadeCurve = 'natural'): Channels {
  const out = cloneChannels(ch);
  const n = out[0]?.length ?? 0;
  const fi = Math.min(n, Math.max(0, Math.round(fadeInSec * sr)));
  const fo = Math.min(n, Math.max(0, Math.round(fadeOutSec * sr)));
  for (const c of out) {
    for (let i = 0; i < fi; i++) c[i] *= fadeGain(fi <= 1 ? 1 : i / (fi - 1), curve);
    for (let i = 0; i < fo; i++) c[n - 1 - i] *= fadeGain(fo <= 1 ? 1 : i / (fo - 1), curve);
  }
  return out;
}

// ───────────────────────── FFT kecil ─────────────────────────

function fftInPlace(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Turunkan sample rate dengan rata-rata blok (cukup untuk analisis, bukan untuk didengar). */
function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const n = Math.floor(x.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += x[i * factor + j];
    out[i] = s / factor;
  }
  return out;
}

/** Ambil jendela analisis dari tengah lagu (maks `maxSec` detik) agar cepat. */
function centerWindow(x: Float32Array, sr: number, maxSec: number): Float32Array {
  const max = Math.round(maxSec * sr);
  if (x.length <= max) return x;
  const start = Math.floor((x.length - max) / 2);
  return x.subarray(start, start + max);
}

// ───────────────────────── Deteksi BPM ─────────────────────────

export interface BpmResult {
  bpm: number;
  /** Alternatif umum (setengah / dua kali) yang masih dalam rentang 60–200. */
  alternatives: number[];
  /** 0–1, makin tinggi makin yakin. */
  confidence: number;
}

export function detectBpm(ch: Channels, sr: number): BpmResult | null {
  const mono = monoMix(ch);
  if (mono.length < sr * 4) return null; // terlalu pendek
  const factor = Math.max(1, Math.round(sr / 11025));
  const fs = sr / factor;
  const x = centerWindow(decimate(mono, factor), fs, 90);

  // Energi per frame -> kekuatan onset (kenaikan energi, skala log).
  const hop = 64, win = 256;
  const frames = Math.floor((x.length - win) / hop);
  if (frames < 200) return null;
  const energy = new Float64Array(frames);
  let maxE = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < win; i++) { const v = x[f * hop + i] - (i > 0 ? x[f * hop + i - 1] : 0); s += v * v; }
    energy[f] = Math.sqrt(s / win);
    if (energy[f] > maxE) maxE = energy[f];
  }
  if (maxE < 1e-7) return null;
  const onset = new Float64Array(frames);
  for (let f = 1; f < frames; f++) {
    const a = Math.log1p((1000 * energy[f]) / maxE);
    const b = Math.log1p((1000 * energy[f - 1]) / maxE);
    onset[f] = Math.max(0, a - b);
  }
  // Buang rata-rata bergerak supaya autokorelasi tidak bias.
  const mw = Math.round(fs / hop); // ±1 detik
  const prefix = new Float64Array(frames + 1);
  for (let i = 0; i < frames; i++) prefix[i + 1] = prefix[i] + onset[i];
  const z = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    const lo = Math.max(0, i - mw), hi = Math.min(frames, i + mw + 1);
    z[i] = onset[i] - (prefix[hi] - prefix[lo]) / (hi - lo);
  }

  const frameRate = fs / hop;
  const minLag = Math.floor((60 / 200) * frameRate);
  const maxLag = Math.min(frames - 2, Math.ceil((60 / 60) * frameRate) + 1);
  let zero = 0;
  for (let i = 0; i < frames; i++) zero += z[i] * z[i];
  if (zero <= 0) return null;

  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < frames; i++) s += z[i] * z[i + lag];
    ac[lag] = s / zero;
  }
  const weighted = (lag: number) => {
    const bpm = (60 * frameRate) / lag;
    const o = Math.log2(bpm / 120);
    return ac[lag] * Math.exp(-0.5 * o * o); // prior lembut di sekitar 120 BPM
  };

  let best = minLag, bestV = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    // hanya puncak lokal
    if (ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) continue;
    const v = weighted(lag);
    if (v > bestV) { bestV = v; best = lag; }
  }
  if (bestV <= 0) return null;

  // Interpolasi parabola agar presisi di bawah satu frame.
  const y0 = ac[best - 1], y1 = ac[best], y2 = ac[best + 1];
  const denom = y0 - 2 * y1 + y2;
  const shift = denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0;
  const lagF = best + Math.max(-1, Math.min(1, shift));
  let bpm = (60 * frameRate) / lagF;

  const alternatives: number[] = [];
  for (const m of [0.5, 2]) {
    const alt = bpm * m;
    if (alt >= 60 && alt <= 200) alternatives.push(Math.round(alt * 10) / 10);
  }
  return {
    bpm: Math.round(bpm * 10) / 10,
    alternatives,
    confidence: Math.max(0, Math.min(1, ac[best] * 1.5)),
  };
}

// ───────────────────────── Deteksi kunci nada ─────────────────────────

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Profil Krumhansl-Kessler.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function pearson(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

/** Kode Camelot (dipakai DJ) untuk pitch class + mode. */
export function camelotCode(pc: number, minor: boolean): string {
  const majorPc = minor ? (pc + 3) % 12 : pc;
  const num = ((8 + ((majorPc * 7) % 12) - 1) % 12) + 1;
  return `${num}${minor ? 'A' : 'B'}`;
}

export interface KeyResult {
  /** Contoh: "C mayor" / "A minor". */
  name: string;
  tonic: string;
  mode: 'mayor' | 'minor';
  camelot: string;
  /** Kunci relatif, contoh "A minor" untuk C mayor. */
  relative: string;
  /** 0–1, selisih korelasi antara kunci terbaik dan terbaik kedua. */
  confidence: number;
  /** Chroma ternormalisasi (12 nilai, C..B) untuk visualisasi. */
  chroma: number[];
}

export function detectKey(ch: Channels, sr: number): KeyResult | null {
  const mono = monoMix(ch);
  if (mono.length < sr * 3) return null;
  const factor = Math.max(1, Math.round(sr / 11025));
  const fs = sr / factor;
  const x = centerWindow(decimate(mono, factor), fs, 45);
  const N = 8192, hop = 4096;
  if (x.length < N) return null;

  const win = new Float64Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  const chroma = new Array(12).fill(0);
  const binHz = fs / N;
  const loBin = Math.ceil(65 / binHz), hiBin = Math.floor(2100 / binHz);

  for (let start = 0; start + N <= x.length; start += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[start + i] * win[i]; im[i] = 0; }
    fftInPlace(re, im);
    for (let k = loBin; k <= hiBin; k++) {
      const mag = Math.hypot(re[k], im[k]);
      const midi = 69 + 12 * Math.log2((k * binHz) / 440);
      const nearest = Math.round(midi);
      if (Math.abs(midi - nearest) > 0.4) continue; // abaikan bin di antara dua nada
      chroma[((nearest % 12) + 12) % 12] += mag;
    }
  }
  const total = chroma.reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  const norm = chroma.map((v) => v / total);

  const scores: { pc: number; minor: boolean; r: number }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const rotMajor = KK_MAJOR.map((_, i) => KK_MAJOR[(i - pc + 12) % 12]);
    const rotMinor = KK_MINOR.map((_, i) => KK_MINOR[(i - pc + 12) % 12]);
    scores.push({ pc, minor: false, r: pearson(norm, rotMajor) });
    scores.push({ pc, minor: true, r: pearson(norm, rotMinor) });
  }
  scores.sort((a, b) => b.r - a.r);
  const top = scores[0], second = scores[1];
  const tonic = NOTE_NAMES[top.pc];
  const relPc = top.minor ? (top.pc + 3) % 12 : (top.pc + 9) % 12;
  return {
    name: `${tonic} ${top.minor ? 'minor' : 'mayor'}`,
    tonic,
    mode: top.minor ? 'minor' : 'mayor',
    camelot: camelotCode(top.pc, top.minor),
    relative: `${NOTE_NAMES[relPc]} ${top.minor ? 'mayor' : 'minor'}`,
    confidence: Math.max(0, Math.min(1, (top.r - second.r) * 4)),
    chroma: norm,
  };
}

// ───────────────────────── Hapus jeda hening ─────────────────────────

export interface SilenceOptions {
  thresholdDb?: number;   // default -45 dBFS
  minSilenceMs?: number;  // jeda minimal yang dipotong, default 400 ms
  keepMs?: number;        // sisa jeda yang dipertahankan per jeda, default 150 ms
}

export interface SilenceResult {
  channels: Channels;
  removedSeconds: number;
  removedCount: number;
}

export function removeSilence(ch: Channels, sr: number, opts: SilenceOptions = {}): SilenceResult {
  const thresholdDb = opts.thresholdDb ?? -45;
  const minSil = Math.round(((opts.minSilenceMs ?? 400) / 1000) * sr);
  const keep = Math.round(((opts.keepMs ?? 150) / 1000) * sr);
  const n = ch[0]?.length ?? 0;
  if (n === 0) return { channels: ch, removedSeconds: 0, removedCount: 0 };

  const frame = Math.max(1, Math.round(sr * 0.01)); // 10 ms
  const thr = dbToLin(thresholdDb);
  const nFrames = Math.ceil(n / frame);
  const silent = new Uint8Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let peak = 0;
    const a = f * frame, b = Math.min(n, a + frame);
    for (const c of ch) for (let i = a; i < b; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
    silent[f] = peak < thr ? 1 : 0;
  }

  // Kumpulkan rentang yang DIBUANG.
  const cuts: [number, number][] = [];
  let f = 0;
  while (f < nFrames) {
    if (!silent[f]) { f++; continue; }
    let g = f;
    while (g < nFrames && silent[g]) g++;
    const a = f * frame, b = Math.min(n, g * frame);
    if (b - a >= minSil) {
      const half = Math.floor(keep / 2);
      const from = f === 0 ? a : a + half;
      const to = g >= nFrames ? b : b - half;
      if (to - from > 0) cuts.push([from, to]);
    }
    f = g;
  }
  if (cuts.length === 0) return { channels: cloneChannels(ch), removedSeconds: 0, removedCount: 0 };

  const removed = cuts.reduce((s, [a, b]) => s + (b - a), 0);
  const outLen = n - removed;
  const fadeLen = Math.min(Math.round(sr * 0.003), 128);
  const out: Channels = ch.map(() => new Float32Array(outLen));
  let w = 0, r = 0;
  const joins: number[] = [];
  for (const [a, b] of cuts) {
    for (let c = 0; c < ch.length; c++) out[c].set(ch[c].subarray(r, a), w);
    w += a - r;
    joins.push(w);
    r = b;
  }
  for (let c = 0; c < ch.length; c++) out[c].set(ch[c].subarray(r, n), w);

  // Fade sangat pendek di tiap sambungan supaya tidak berbunyi "klik".
  for (const j of joins) {
    for (let c = 0; c < out.length; c++) {
      for (let i = 0; i < fadeLen; i++) {
        const gi = j - 1 - i, go = j + i;
        const g = i / fadeLen;
        if (gi >= 0 && gi < outLen) out[c][gi] *= g;
        if (go >= 0 && go < outLen) out[c][go] *= g;
      }
    }
  }
  return { channels: out, removedSeconds: removed / sr, removedCount: cuts.length };
}

// ───────────────────────── Loudness (ITU-R BS.1770 / EBU R128) ─────────────────────────

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number; }

function kWeightingFilters(fs: number): [Biquad, Biquad] {
  // Tahap 1: high-shelf (+4 dB), tahap 2: high-pass ~38 Hz (RLB). Koefisien dihitung untuk fs berapa pun.
  const f0a = 1681.974450955533, Ga = 3.999843853973347, Qa = 0.7071752369554196;
  const Ka = Math.tan((Math.PI * f0a) / fs);
  const Vh = Math.pow(10, Ga / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0a = 1 + Ka / Qa + Ka * Ka;
  const shelf: Biquad = {
    b0: (Vh + (Vb * Ka) / Qa + Ka * Ka) / a0a,
    b1: (2 * (Ka * Ka - Vh)) / a0a,
    b2: (Vh - (Vb * Ka) / Qa + Ka * Ka) / a0a,
    a1: (2 * (Ka * Ka - 1)) / a0a,
    a2: (1 - Ka / Qa + Ka * Ka) / a0a,
  };
  const f0b = 38.13547087602444, Qb = 0.5003270373238773;
  const Kb = Math.tan((Math.PI * f0b) / fs);
  const a0b = 1 + Kb / Qb + Kb * Kb;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (Kb * Kb - 1)) / a0b, a2: (1 - Kb / Qb + Kb * Kb) / a0b };
  return [shelf, hp];
}

/** Loudness terintegrasi dalam LUFS (dengan gating absolut -70 dan relatif -10 LU). null bila senyap. */
export function measureLufs(ch: Channels, sr: number): number | null {
  const n = ch[0]?.length ?? 0;
  const step = Math.round(0.1 * sr);   // geser 100 ms
  const block = step * 4;              // blok 400 ms (overlap 75%)
  if (n < block) return null;
  const [shelf, hp] = kWeightingFilters(sr);
  const nSteps = Math.floor(n / step);
  const stepEnergy = new Float64Array(nSteps); // jumlah energi (semua kanal) per langkah 100 ms

  // Streaming: filter K-weighting dijalankan sampel demi sampel, tanpa menyimpan array besar.
  for (const c of ch) {
    let sx1 = 0, sx2 = 0, sy1 = 0, sy2 = 0; // shelf
    let hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0; // high-pass
    const limit = nSteps * step;
    for (let i = 0; i < limit; i++) {
      const x = c[i];
      const y = shelf.b0 * x + shelf.b1 * sx1 + shelf.b2 * sx2 - shelf.a1 * sy1 - shelf.a2 * sy2;
      sx2 = sx1; sx1 = x; sy2 = sy1; sy1 = y;
      const z = hp.b0 * y + hp.b1 * hx1 + hp.b2 * hx2 - hp.a1 * hy1 - hp.a2 * hy2;
      hx2 = hx1; hx1 = y; hy2 = hy1; hy1 = z;
      stepEnergy[(i / step) | 0] += z * z;
    }
  }
  const blocks: number[] = [];
  for (let j = 0; j + 4 <= nSteps; j++) {
    blocks.push((stepEnergy[j] + stepEnergy[j + 1] + stepEnergy[j + 2] + stepEnergy[j + 3]) / block);
  }
  const toLufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && toLufs(z) > -70);
  if (abs.length === 0) return null;
  const meanAbs = abs.reduce((s, v) => s + v, 0) / abs.length;
  const relThr = toLufs(meanAbs) - 10;
  const rel = abs.filter((z) => toLufs(z) > relThr);
  if (rel.length === 0) return null;
  return toLufs(rel.reduce((s, v) => s + v, 0) / rel.length);
}

/** Limiter lookahead sederhana: menjamin puncak sampel <= ceilingDb. Mengubah `ch` langsung. */
export function limitPeaks(ch: Channels, sr: number, ceilingDb: number): void {
  const n = ch[0]?.length ?? 0;
  if (n === 0) return;
  const ceil = dbToLin(ceilingDb);
  const W = Math.max(2, Math.round(0.005 * sr));
  const g = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const c of ch) { const v = Math.abs(c[i]); if (v > p) p = v; }
    g[i] = p > ceil ? ceil / p : 1;
    if (g[i] < 1) any = true;
  }
  if (!any) return;
  // min bergeser ke depan (jendela W) dengan deque monoton
  const gmin = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && g[dq[tail - 1]] >= g[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + W - 1) head++;
    gmin[i] = g[dq[head]];
  }
  // rata-rata bergerak mundur sepanjang W (menjamin gain <= g di tiap sampel).
  // Sebelum sampel pertama, ring diisi gmin[0] agar jaminan tetap berlaku di awal berkas.
  const ring = new Float32Array(W).fill(gmin[0]);
  let acc = gmin[0] * W;
  for (let i = 0; i < n; i++) {
    const idx = i % W;
    acc += gmin[i] - ring[idx];
    ring[idx] = gmin[i];
    const gs = acc / W;
    for (const c of ch) c[i] *= gs;
  }
}

export interface NormalizeResult {
  channels: Channels;
  beforeLufs: number | null;
  afterLufs: number | null;
  gainDb: number;
  limited: boolean;
}

/** Normalisasi ke target LUFS. Puncak dijaga <= ceilingDb dengan limiter bila perlu. */
export function normalizeLoudness(ch: Channels, sr: number, targetLufs: number, ceilingDb = -1): NormalizeResult {
  const before = measureLufs(ch, sr);
  if (before === null) return { channels: cloneChannels(ch), beforeLufs: null, afterLufs: null, gainDb: 0, limited: false };
  let gainDb = targetLufs - before;
  let out = cloneChannels(ch);
  let limited = false;
  let after: number | null = before;
  for (let iter = 0; iter < 3; iter++) {
    out = cloneChannels(ch);
    const lin = dbToLin(gainDb);
    for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= lin;
    if (linToDb(peakOf(out)) > ceilingDb) { limitPeaks(out, sr, ceilingDb); limited = true; }
    after = measureLufs(out, sr);
    if (after === null || Math.abs(after - targetLufs) < 0.3) break;
    gainDb += targetLufs - after; // koreksi akibat limiter
  }
  return { channels: out, beforeLufs: before, afterLufs: after, gainDb, limited };
}

/** Normalisasi puncak ke targetDb (mis. -1 dBFS). */
export function normalizePeak(ch: Channels, targetDb = -1): { channels: Channels; gainDb: number } {
  const p = peakOf(ch);
  if (p <= 0) return { channels: cloneChannels(ch), gainDb: 0 };
  const gainDb = targetDb - linToDb(p);
  const lin = dbToLin(gainDb);
  const out = cloneChannels(ch);
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= lin;
  return { channels: out, gainDb };
}

// ───────────────────────── Metronom (render ke berkas) ─────────────────────────

export interface MetronomeRenderOptions {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  /** 1 = hanya beat, 2 = per setengah beat, 3 = triplet, 4 = per seperempat beat. */
  subdivision?: number;
  sampleRate?: number;
}

/** Hasilkan loop klik metronom mono. Beat 1 = nada tinggi, beat lain = sedang, subdivisi = pelan. */
export function renderMetronome(opts: MetronomeRenderOptions): Float32Array {
  const sr = opts.sampleRate ?? 44100;
  const sub = Math.max(1, Math.min(4, Math.round(opts.subdivision ?? 1)));
  const beatSamples = (60 / opts.bpm) * sr;
  const total = Math.round(beatSamples * opts.beatsPerBar * opts.bars);
  const out = new Float32Array(total);
  const click = (startSample: number, freq: number, amp: number) => {
    const len = Math.round(0.045 * sr);
    for (let i = 0; i < len && startSample + i < total; i++) {
      const t = i / sr;
      const env = Math.exp(-t * 90);
      out[startSample + i] += Math.sin(2 * Math.PI * freq * t) * env * amp;
    }
  };
  const totalTicks = opts.beatsPerBar * opts.bars * sub;
  for (let k = 0; k < totalTicks; k++) {
    const start = Math.round((k * beatSamples) / sub);
    const beatIndex = Math.floor(k / sub);
    const isBeat = k % sub === 0;
    if (isBeat) click(start, beatIndex % opts.beatsPerBar === 0 ? 1600 : 1000, 0.8);
    else click(start, 700, 0.35);
  }
  return out;
}

// ───────────────────────── Tuner (deteksi pitch YIN) ─────────────────────────

export interface PitchResult { freq: number; clarity: number; }

/** Deteksi pitch dasar dengan algoritma YIN. Mengembalikan null bila tidak ada nada jelas. */
export function detectPitch(buf: Float32Array, sr: number, minHz = 60, maxHz = 1200): PitchResult | null {
  const size = buf.length;
  const half = Math.floor(size / 2);
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(half - 1, Math.ceil(sr / minHz));
  if (tauMax <= tauMin + 2) return null;

  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / size) < 0.008) return null; // terlalu pelan

  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < half; i++) { const diff = buf[i] - buf[i + tau]; s += diff * diff; }
    d[tau] = s;
  }
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  const threshold = 0.12;
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (cmnd[t] < threshold) {
      while (t + 1 <= tauMax && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;
  const x0 = cmnd[tau - 1] ?? cmnd[tau], x1 = cmnd[tau], x2 = cmnd[tau + 1] ?? cmnd[tau];
  const denom = x0 - 2 * x1 + x2;
  const refined = denom !== 0 ? tau + (0.5 * (x0 - x2)) / denom : tau;
  return { freq: sr / refined, clarity: Math.max(0, Math.min(1, 1 - cmnd[tau])) };
}

export interface NoteInfo { name: string; octave: number; midi: number; cents: number; targetFreq: number; }

/** Ubah frekuensi jadi nada terdekat + selisih cent (a4 = frekuensi acuan A4). */
export function freqToNote(freq: number, a4 = 440): NoteInfo {
  const midiExact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiExact);
  return {
    name: NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: (midiExact - midi) * 100,
    targetFreq: a4 * Math.pow(2, (midi - 69) / 12),
  };
}

export interface TuningString { label: string; midi: number; }
export interface TuningPreset { id: string; name: string; strings: TuningString[]; }

const s = (label: string, midi: number): TuningString => ({ label, midi });
export const TUNING_PRESETS: TuningPreset[] = [
  { id: 'chromatic', name: 'Kromatik (semua nada / vokal)', strings: [] },
  { id: 'guitar', name: 'Gitar standar (E A D G B E)', strings: [s('E2', 40), s('A2', 45), s('D3', 50), s('G3', 55), s('B3', 59), s('E4', 64)] },
  { id: 'guitar-dropd', name: 'Gitar Drop D', strings: [s('D2', 38), s('A2', 45), s('D3', 50), s('G3', 55), s('B3', 59), s('E4', 64)] },
  { id: 'bass', name: 'Bass 4 senar (E A D G)', strings: [s('E1', 28), s('A1', 33), s('D2', 38), s('G2', 43)] },
  { id: 'ukulele', name: 'Ukulele (G C E A)', strings: [s('G4', 67), s('C4', 60), s('E4', 64), s('A4', 69)] },
  { id: 'violin', name: 'Biola (G D A E)', strings: [s('G3', 55), s('D4', 62), s('A4', 69), s('E5', 76)] },
];

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Cari senar preset yang paling dekat dengan frekuensi terdeteksi. */
export function nearestString(freq: number, preset: TuningPreset, a4 = 440): { string: TuningString; cents: number } | null {
  if (preset.strings.length === 0) return null;
  let best = preset.strings[0], bestAbs = Infinity, bestCents = 0;
  for (const st of preset.strings) {
    const cents = 1200 * Math.log2(freq / midiToFreq(st.midi, a4));
    if (Math.abs(cents) < bestAbs) { bestAbs = Math.abs(cents); best = st; bestCents = cents; }
  }
  return { string: best, cents: bestCents };
}

/** Puncak waveform untuk tampilan (nilai 0..1 per bin). */
export function peaksForDisplay(ch: Channels, bins: number): Float32Array {
  const n = ch[0]?.length ?? 0;
  const out = new Float32Array(bins);
  if (n === 0) return out;
  const per = n / bins;
  for (let b = 0; b < bins; b++) {
    const a = Math.floor(b * per), z = Math.min(n, Math.max(a + 1, Math.floor((b + 1) * per)));
    let p = 0;
    for (const c of ch) for (let i = a; i < z; i += Math.max(1, Math.floor((z - a) / 64))) { const v = Math.abs(c[i]); if (v > p) p = v; }
    out[b] = p;
  }
  return out;
}
