// src/services/audioExtraDsp.ts
//
// DSP murni (tanpa Web Audio API) untuk alat-alat audio PlayMuzeck.

export type Channels = Float32Array[];

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

export function sliceChannels(ch: Channels, sr: number, startSec: number, endSec: number): Channels {
  const n = ch[0]?.length ?? 0;
  const a = Math.max(0, Math.min(n, Math.round(startSec * sr)));
  const b = Math.max(a, Math.min(n, Math.round(endSec * sr)));
  return ch.map((c) => c.slice(a, b));
}

export function matchChannelCount(ch: Channels, count: number): Channels {
  if (ch.length === count) return ch;
  const out: Channels = [];
  for (let i = 0; i < count; i++) out.push(ch[Math.min(i, ch.length - 1)]);
  return out;
}

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

export const MIN_REPEAT = 2;
export const MAX_REPEAT = 5;

/**
 * Ulangi audio `times` kali (dibatasi 1..MAX_REPEAT). `crossfadeSec` > 0 menumpang-tindihkan sambungan antar-ulangan
 * (berguna untuk loop musik agar akhir dan awal menyatu). Durasi hasil = times * durasi - (times - 1) * crossfade.
 */
export function repeatChannels(ch: Channels, sr: number, times: number, crossfadeSec = 0): Channels {
  const n = Math.max(1, Math.min(MAX_REPEAT, Math.floor(Number.isFinite(times) ? times : 1)));
  if (!ch[0] || ch[0].length === 0) return [new Float32Array(0)];
  if (n === 1) return cloneChannels(ch);
  const out = concatChannels(Array.from({ length: n }, () => ch), sr, crossfadeSec);
  // Crossfade equal-power bisa menjumlah dua sinyal yang searah hingga ~1,41x. Bila itu melewati 0 dBFS, turunkan
  // seluruh hasil secukupnya (hanya saat perlu) supaya tidak terpotong saat diekspor.
  if (crossfadeSec > 0) {
    const pk = peakOf(out);
    if (pk > 1) { const g = 1 / pk; for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= g; }
  }
  return out;
}

export type ChannelLayout = 'keep' | 'mono' | 'stereo';

/** Ubah jumlah kanal: mono = rata-rata semua kanal, stereo = kanal tunggal diduplikasi / ambil dua kanal pertama. */
export function remixChannels(ch: Channels, layout: ChannelLayout): Channels {
  if (layout === 'keep' || ch.length === 0) return ch;
  if (layout === 'mono') return ch.length === 1 ? ch : toMono(ch);
  if (ch.length === 2) return ch;
  if (ch.length === 1) return [ch[0], new Float32Array(ch[0])];
  return [ch[0], ch[1]];
}

export type FadeCurve = 'linear' | 'natural' | 'scurve';

function fadeGain(t: number, curve: FadeCurve): number {
  const x = Math.max(0, Math.min(1, t));
  if (curve === 'natural') return x * x;
  if (curve === 'scurve') return x * x * (3 - 2 * x);
  return x;
}

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

function centerWindow(x: Float32Array, sr: number, maxSec: number): Float32Array {
  const max = Math.round(maxSec * sr);
  if (x.length <= max) return x;
  const start = Math.floor((x.length - max) / 2);
  return x.subarray(start, start + max);
}

export interface BpmResult {
  bpm: number;
  alternatives: number[];
  confidence: number;
}

export function detectBpm(ch: Channels, sr: number): BpmResult | null {
  const mono = monoMix(ch);
  if (mono.length < sr * 4) return null;
  const factor = Math.max(1, Math.round(sr / 11025));
  const fs = sr / factor;
  const x = centerWindow(decimate(mono, factor), fs, 90);

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

  const mw = Math.round(fs / hop);
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
    return ac[lag] * Math.exp(-0.5 * o * o);
  };

  let best = minLag, bestV = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (ac[lag] < ac[lag - 1] || ac[lag] < ac[lag + 1]) continue;
    const v = weighted(lag);
    if (v > bestV) { bestV = v; best = lag; }
  }
  if (bestV <= 0) return null;

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

const MAJOR_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const MINOR_KEY_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
export const keyLabel = (pc: number, minor: boolean): string => (minor ? MINOR_KEY_NAMES : MAJOR_KEY_NAMES)[((Math.round(pc) % 12) + 12) % 12];

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

export function camelotCode(pc: number, minor: boolean): string {
  const majorPc = minor ? (pc + 3) % 12 : pc;
  const num = ((8 + ((majorPc * 7) % 12) - 1) % 12) + 1;
  return `${num}${minor ? 'A' : 'B'}`;
}

export interface KeyResult {
  name: string;
  tonic: string;
  mode: 'mayor' | 'minor';
  camelot: string;
  relative: string;
  confidence: number;
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
      if (Math.abs(midi - nearest) > 0.4) continue;
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
  const tonic = keyLabel(top.pc, top.minor);
  const relPc = top.minor ? (top.pc + 3) % 12 : (top.pc + 9) % 12;
  return {
    name: `${tonic} ${top.minor ? 'minor' : 'mayor'}`,
    tonic,
    mode: top.minor ? 'minor' : 'mayor',
    camelot: camelotCode(top.pc, top.minor),
    relative: `${keyLabel(relPc, !top.minor)} ${top.minor ? 'mayor' : 'minor'}`,
    confidence: Math.max(0, Math.min(1, (top.r - second.r) * 4)),
    chroma: norm,
  };
}

export interface SilenceOptions {
  thresholdDb?: number;
  minSilenceMs?: number;
  keepMs?: number;
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

  const frame = Math.max(1, Math.round(sr * 0.01));
  const thr = dbToLin(thresholdDb);
  const nFrames = Math.ceil(n / frame);
  const silent = new Uint8Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    let peak = 0;
    const a = f * frame, b = Math.min(n, a + frame);
    for (const c of ch) for (let i = a; i < b; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
    silent[f] = peak < thr ? 1 : 0;
  }

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

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number; }

function kWeightingFilters(fs: number): [Biquad, Biquad] {
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

export function measureLufs(ch: Channels, sr: number): number | null {
  const n = ch[0]?.length ?? 0;
  const step = Math.round(0.1 * sr);
  const block = step * 4;
  if (n < block) return null;
  const [shelf, hp] = kWeightingFilters(sr);
  const nSteps = Math.floor(n / step);
  const stepEnergy = new Float64Array(nSteps);

  for (const c of ch) {
    let sx1 = 0, sx2 = 0, sy1 = 0, sy2 = 0;
    let hx1 = 0, hx2 = 0, hy1 = 0, hy2 = 0;
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
  const gmin = new Float32Array(n);
  const dq = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = n - 1; i >= 0; i--) {
    while (tail > head && g[dq[tail - 1]] >= g[i]) tail--;
    dq[tail++] = i;
    while (dq[head] > i + W - 1) head++;
    gmin[i] = g[dq[head]];
  }
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
    gainDb += targetLufs - after;
  }
  return { channels: out, beforeLufs: before, afterLufs: after, gainDb, limited };
}

export function normalizePeak(ch: Channels, targetDb = -1): { channels: Channels; gainDb: number } {
  const p = peakOf(ch);
  if (p <= 0) return { channels: cloneChannels(ch), gainDb: 0 };
  const gainDb = targetDb - linToDb(p);
  const lin = dbToLin(gainDb);
  const out = cloneChannels(ch);
  for (const c of out) for (let i = 0; i < c.length; i++) c[i] *= lin;
  return { channels: out, gainDb };
}

// ════════════════════════════════════════════════════════════════════════════
// METRONOM
//
// Semua di sini murni DSP (tanpa Web Audio), jadi bunyi di pratinjau langsung
// (AudioExtraTools) dan bunyi di berkas yang diunduh (renderMetronome) berasal
// dari sampel yang SAMA persis.
// ════════════════════════════════════════════════════════════════════════════

export type Accent = 0 | 1 | 2;
export type ClickKind = 'accent' | 'beat' | 'sub';

// ── Subdivisi ───────────────────────────────────────────────────────────────
// Satu ketukan (pulsa) dibagi n klik. Nilai not-nya bergantung pada penyebut birama:
// pulsa 1/4 dibagi 4 = 1/16, dibagi 16 = 1/64, dibagi 3 = triol 1/8, dst.
export interface Subdivision {
  id: string;          // = String(count), supaya kompatibel dengan versi lama ('1'..'6')
  count: number;       // jumlah klik per ketukan
  label: string;
  hint: string;
  group: string;       // untuk <optgroup>
  offsets: number[];   // posisi tiap klik di dalam ketukan (0..1)
}

export const MAX_NOTE_VALUE = 64; // 1/64 — setara resolusi grid DAW
const SUB_COUNTS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 32, 64];
const even = (n: number) => Array.from({ length: n }, (_, i) => i / n);

type SubKind = 'lurus' | 'triol' | 'kuintol' | 'septol';
function subKind(n: number): SubKind {
  let m = n; while (m % 2 === 0) m /= 2;
  return m === 1 ? 'lurus' : m === 3 ? 'triol' : m === 5 ? 'kuintol' : 'septol';
}
const SUB_GROUP: Record<SubKind, string> = { lurus: 'Lurus (1/4, 1/8, 1/16 … 1/64)', triol: 'Triol', kuintol: 'Kuintol', septol: 'Septol' };

/** Nilai not (penyebut) hasil pembagian pulsa berpenyebut `den` menjadi `n` klik. */
export function subNoteValue(n: number, den: number): number {
  return den * Math.pow(2, Math.floor(Math.log2(n)));
}

function buildSubdivision(n: number, den?: number): Subdivision {
  const kind = subKind(n);
  const hint = n === 1 ? 'Hanya klik utama' : `Klik utama + ${n - 1} klik pelan di antara ketukan`;
  let label: string;
  if (den === undefined) label = n === 1 ? '1 klik per ketukan' : `${n} klik per ketukan`;
  else if (n === 1) label = `Hanya ketukan (1/${den})`;
  else {
    const nv = subNoteValue(n, den);
    const kindTxt = kind === 'lurus' ? '' : ` ${kind}`;
    label = `1/${nv}${kindTxt} — ${n} klik per ketukan`;
  }
  return { id: String(n), count: n, label, hint, group: SUB_GROUP[kind], offsets: even(n) };
}

/** Daftar generik (tidak bergantung penyebut). Dipertahankan demi kompatibilitas. */
export const SUBDIVISIONS: Subdivision[] = SUB_COUNTS.map((n) => buildSubdivision(n));

/** Subdivisi yang tersedia untuk penyebut tertentu, lengkap dengan nama nilai not (maks 1/64). */
export function subdivisionsFor(den: number): Subdivision[] {
  return SUB_COUNTS.filter((n) => subNoteValue(n, den) <= MAX_NOTE_VALUE).map((n) => buildSubdivision(n, den));
}

export const getSubdivision = (id?: string, den?: number): Subdivision => {
  const n = SUB_COUNTS.find((c) => String(c) === id) ?? 1;
  return buildSubdivision(n, den);
};

// ── Birama ──────────────────────────────────────────────────────────────────
export const DENOMINATORS = [1, 2, 4, 8, 16, 32, 64] as const;
export const MAX_NUMERATOR = 32;

export interface TimeSignature { id: string; label: string; pulses: number; denominator: number; accents: Accent[]; }

const FIXED_GROUPING: Record<number, number[]> = {
  1: [1], 2: [2], 3: [3], 4: [4], 5: [3, 2], 6: [3, 3], 7: [2, 2, 3], 8: [4, 4], 9: [3, 3, 3],
  10: [3, 3, 2, 2], 11: [3, 3, 3, 2], 12: [3, 3, 3, 3], 13: [3, 3, 3, 2, 2], 14: [3, 3, 3, 3, 2],
  15: [3, 3, 3, 3, 3], 16: [4, 4, 4, 4],
};

/** Pengelompokan ketukan bawaan: 4/4 → [4], 6/8 → [3,3], 7/8 → [2,2,3], 5/4 → [3,2], dst. */
export function defaultGrouping(num: number): number[] {
  const n = Math.max(1, Math.round(num));
  if (FIXED_GROUPING[n]) return [...FIXED_GROUPING[n]];
  if (n % 4 === 0) return Array(n / 4).fill(4);
  const threes = Math.floor(n / 3), r = n % 3;
  if (r === 0) return Array(threes).fill(3);
  if (r === 1) return [...Array(threes - 1).fill(3), 2, 2];
  return [...Array(threes).fill(3), 2];
}

export interface GroupingOption { id: string; label: string; groups: number[]; }

function compositions23(n: number): number[][] {
  const res: number[][] = [];
  const rec = (left: number, cur: number[]) => {
    if (left === 0) { res.push(cur); return; }
    if (left >= 2) rec(left - 2, [...cur, 2]);
    if (left >= 3) rec(left - 3, [...cur, 3]);
  };
  rec(n, []);
  return res;
}

/** Semua pilihan pengelompokan aksen yang masuk akal untuk jumlah pulsa `num`. */
export function groupingsFor(num: number): GroupingOption[] {
  const n = Math.max(1, Math.round(num));
  const opts: GroupingOption[] = [];
  const seen = new Set<string>();
  const add = (groups: number[], label?: string) => {
    const id = groups.join('+');
    if (seen.has(id)) return;
    seen.add(id);
    opts.push({ id, groups, label: label ?? (groups.length === 1 ? `${n} (aksen hanya di ketukan 1)` : groups.join(' + ')) });
  };
  const def = defaultGrouping(n);
  add(def, def.length === 1 ? `${n} (aksen hanya di ketukan 1)` : `${def.join(' + ')} (bawaan)`);
  if (n >= 4 && n <= 12) for (const g of compositions23(n)) add(g);
  if (n % 4 === 0 && n > 4) add(Array(n / 4).fill(4));
  if (n % 3 === 0 && n > 3) add(Array(n / 3).fill(3));
  if (n % 2 === 0 && n > 2) add(Array(n / 2).fill(2));
  if (n > 1) { add([n]); add(Array(n).fill(1), 'Semua ketukan beraksen'); }
  return opts;
}

export function accentsFromGroups(groups: number[], pulses: number): Accent[] {
  const out: Accent[] = Array.from({ length: pulses }, () => 1 as Accent);
  let pos = 0;
  for (const g of groups) { if (pos < pulses) out[pos] = 2; pos += Math.max(1, g); }
  if (pulses > 0) out[0] = 2;
  return out;
}

export function makeTimeSignature(num: number, den: number, groups?: number[]): TimeSignature {
  const n = Math.max(1, Math.min(MAX_NUMERATOR, Math.round(num)));
  const d = (DENOMINATORS as readonly number[]).includes(den) ? den : 4;
  return { id: `${n}/${d}`, label: `${n}/${d}`, pulses: n, denominator: d, accents: accentsFromGroups(groups ?? defaultGrouping(n), n) };
}

/** Birama populer (pintasan). Birama lain tetap bisa dipilih lewat pembilang 1–32 & penyebut 1–64. */
export const TIME_SIGNATURES: TimeSignature[] = [
  [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [2, 2], [3, 2], [4, 2],
  [3, 8], [5, 8], [6, 8], [7, 8], [9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [15, 8],
  [5, 16], [7, 16], [9, 16], [12, 16],
].map(([n, d]) => makeTimeSignature(n, d));

// ── Tempo ───────────────────────────────────────────────────────────────────
// 'quarter' : BPM = not seperempat (standar DAW: Ableton, Logic, FL Studio, Cubase).
// 'pulse'   : BPM = satu pulsa (not penyebut), seperti metronom mekanik klasik.
// 'group3'  : BPM = tiga pulsa (♩. pada 6/8, 9/8, 12/8 — kebiasaan birama majemuk).
export type TempoRef = 'quarter' | 'pulse' | 'group3';
export const TEMPO_REFS: { id: TempoRef; label: string; hint: string }[] = [
  { id: 'quarter', label: 'Not seperempat ♩ (standar DAW)', hint: 'BPM dihitung per not seperempat, sama seperti di DAW' },
  { id: 'pulse', label: 'Satu pulsa (not penyebut)', hint: 'BPM dihitung per klik utama, seperti metronom mekanik' },
  { id: 'group3', label: 'Tiga pulsa (♩. birama majemuk)', hint: 'BPM dihitung per kelompok 3 pulsa, cocok untuk 6/8, 9/8, 12/8' },
];

export function pulseSeconds(bpm: number, den: number, ref: TempoRef = 'quarter'): number {
  const q = 60 / Math.max(1, bpm);
  if (ref === 'pulse') return q;
  if (ref === 'group3') return q / 3;
  return q * (4 / den);
}

export function barSeconds(bpm: number, num: number, den: number, ref: TempoRef = 'quarter'): number {
  return pulseSeconds(bpm, den, ref) * num;
}

export function tempoMarking(bpm: number): string {
  if (bpm < 40) return 'Grave';
  if (bpm < 60) return 'Largo';
  if (bpm < 66) return 'Larghetto';
  if (bpm < 76) return 'Adagio';
  if (bpm < 108) return 'Andante';
  if (bpm < 120) return 'Moderato';
  if (bpm < 156) return 'Allegro';
  if (bpm < 176) return 'Vivace';
  if (bpm < 200) return 'Presto';
  return 'Prestissimo';
}

// ── Bunyi klik ──────────────────────────────────────────────────────────────
// Bukan lagi "beep" osilator polos. Tiap bunyi dibangun dengan sintesis modal
// (gabungan resonansi teredam bernada tidak harmonis seperti benda kayu/logam
// asli) + letupan derau tersaring untuk transien benturan, lalu dirender jadi
// sampel PCM. Aksen, ketukan biasa, dan subdivisi memakai sampel berbeda,
// bukan sekadar nada yang digeser.

interface ModeDef { f: number; tau: number; a: number }
interface NoiseDef { type: 'bp' | 'hp' | 'lp'; f: number; q?: number; tau: number; a: number; delay?: number }
interface SweepDef { f0: number; f1: number; fTau: number; tau: number; a: number }
interface MetalDef { freqs: number[]; tau: number; tau2?: number; mix2?: number; a: number; filter: { type: 'bp' | 'hp' | 'lp'; f: number; q?: number } }
interface VoiceSpec { len: number; modes?: ModeDef[]; noises?: NoiseDef[]; sweep?: SweepDef; metal?: MetalDef }

export interface ClickSound {
  id: string;
  label: string;
  hint: string;
  group: string;
  seed: number;
  build: (kind: ClickKind) => VoiceSpec;
}

const pick = <T,>(k: ClickKind, accent: T, beat: T, sub: T): T => (k === 'accent' ? accent : k === 'beat' ? beat : sub);

const hatSpec = (k: ClickKind): VoiceSpec => {
  const tau = pick(k, 0.075, 0.03, 0.016);
  return {
    len: pick(k, 0.32, 0.16, 0.1),
    metal: { freqs: [205.3, 304.4, 369.6, 522.7, 540, 800], tau, a: 1, filter: { type: 'hp', f: pick(k, 6800, 7300, 8000), q: 0.8 } },
    noises: [{ type: 'hp', f: 9000, q: 0.7, tau: tau * 0.8, a: 0.55 }],
  };
};

export const CLICK_SOUNDS: ClickSound[] = [
  {
    id: 'mechanical', label: 'Metronom mekanik (tok-tak)', group: 'Metronom & kayu', seed: 11,
    hint: 'Bunyi benturan kayu metronom pendulum klasik',
    build: (k) => {
      const p = pick(k, 1.22, 1, 1.55), d = pick(k, 1, 1, 0.55);
      return {
        len: pick(k, 0.2, 0.2, 0.1),
        modes: [
          { f: 820 * p, tau: 0.014 * d, a: 1 }, { f: 1370 * p, tau: 0.010 * d, a: 0.8 },
          { f: 2180 * p, tau: 0.007 * d, a: 0.55 }, { f: 3290 * p, tau: 0.005 * d, a: 0.35 },
          { f: 165 * pick(k, 1, 1, 2), tau: 0.03 * d, a: 0.65 },
        ],
        noises: [{ type: 'bp', f: 2800 * p, q: 0.8, tau: 0.0018, a: 1.2 }],
      };
    },
  },
  {
    id: 'woodblock', label: 'Woodblock', group: 'Metronom & kayu', seed: 23,
    hint: 'Blok kayu berongga, hangat dan jelas',
    build: (k) => {
      const p = pick(k, 1.26, 1, 1.5), d = pick(k, 1, 1, 0.5);
      return {
        len: pick(k, 0.22, 0.22, 0.1),
        modes: [{ f: 1040 * p, tau: 0.024 * d, a: 1 }, { f: 1640 * p, tau: 0.016 * d, a: 0.45 }, { f: 2870 * p, tau: 0.009 * d, a: 0.28 }],
        noises: [{ type: 'bp', f: 3500 * p, q: 0.9, tau: 0.0015, a: 0.5 }],
      };
    },
  },
  {
    id: 'claves', label: 'Claves', group: 'Metronom & kayu', seed: 37,
    hint: 'Dua batang kayu keras, nyaring dan menembus musik',
    build: (k) => {
      const p = pick(k, 1.12, 1, 1.3), d = pick(k, 1, 1, 0.5);
      return {
        len: pick(k, 0.3, 0.3, 0.12),
        modes: [{ f: 2500 * p, tau: 0.04 * d, a: 1 }, { f: 4950 * p, tau: 0.018 * d, a: 0.3 }, { f: 7600 * p, tau: 0.008 * d, a: 0.12 }],
        noises: [{ type: 'bp', f: 5000 * p, q: 1, tau: 0.001, a: 0.6 }],
      };
    },
  },
  {
    id: 'rimshot', label: 'Rimshot / sidestick', group: 'Perkusi', seed: 41,
    hint: 'Pukulan pinggir snare, tajam dan kering',
    build: (k) => {
      const p = pick(k, 1.15, 1, 1.4), d = pick(k, 1, 1, 0.6);
      return {
        len: pick(k, 0.24, 0.24, 0.11),
        modes: [{ f: 480 * p, tau: 0.02 * d, a: 0.7 }, { f: 1250 * p, tau: 0.012 * d, a: 0.4 }, { f: 3900 * p, tau: 0.005 * d, a: 0.3 }],
        noises: [{ type: 'bp', f: 1900 * p, q: 0.7, tau: 0.008 * d, a: 1 }, { type: 'hp', f: 5000, tau: 0.004, a: 0.35 }],
      };
    },
  },
  {
    id: 'cowbell', label: 'Cowbell', group: 'Perkusi', seed: 53,
    hint: 'Cowbell ala drum machine klasik',
    build: (k) => {
      const p = pick(k, 1.26, 1, 1.5);
      return {
        len: pick(k, 0.4, 0.4, 0.12),
        metal: { freqs: [540 * p, 800 * p], tau: 0.012, tau2: pick(k, 0.09, 0.09, 0.03), mix2: 0.55, a: 1, filter: { type: 'bp', f: 1800 * p, q: 0.9 } },
      };
    },
  },
  {
    id: 'hihat', label: 'Hi-hat', group: 'Perkusi', seed: 67,
    hint: 'Hi-hat tertutup; aksen sedikit lebih terbuka',
    build: hatSpec,
  },
  {
    id: 'drumkit', label: 'Drum kit (kick & hi-hat)', group: 'Perkusi', seed: 79,
    hint: 'Aksen = bass drum, ketukan = hi-hat, subdivisi = hi-hat pelan',
    build: (k) => (k === 'accent'
      ? { len: 0.32, sweep: { f0: 160, f1: 52, fTau: 0.035, tau: 0.11, a: 1 }, noises: [{ type: 'bp', f: 3000, q: 0.8, tau: 0.002, a: 0.35 }] }
      : hatSpec(k)),
  },
  {
    id: 'clap', label: 'Tepukan tangan (clap)', group: 'Perkusi', seed: 83,
    hint: 'Tepuk tangan ala drum machine',
    build: (k) => {
      const p = pick(k, 1.15, 1, 1.25);
      const delays = k === 'sub' ? [0, 0.008] : [0, 0.009, 0.018, 0.027];
      const last = delays[delays.length - 1];
      return {
        len: pick(k, 0.24, 0.24, 0.1),
        noises: [
          ...delays.map((delay) => ({ type: 'bp' as const, f: 1300 * p, q: 1, tau: 0.0025, a: 0.9, delay })),
          { type: 'bp' as const, f: 1300 * p, q: 1, tau: k === 'sub' ? 0.014 : 0.03, a: 0.8, delay: last },
        ],
      };
    },
  },
  {
    id: 'beep', label: 'Beep elektronik (digital)', group: 'Elektronik', seed: 97,
    hint: 'Bunyi bip metronom digital',
    build: (k) => {
      const f = pick(k, 1600, 1000, 700);
      return { len: 0.09, modes: [{ f, tau: 0.014, a: 1 }, { f: f * 2, tau: 0.006, a: 0.15 }] };
    },
  },
];

export const getClickSound = (id?: string): ClickSound => CLICK_SOUNDS.find((x) => x.id === id) ?? CLICK_SOUNDS[0];

/** Level relatif tiap jenis klik saat dicampur (sampel sendiri dinormalkan ke puncak 1). */
export const CLICK_GAIN: Record<ClickKind, number> = { accent: 0.9, beat: 0.7, sub: 0.38 };

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 0xffffffff) * 2 - 1; };
}

function biquad(x: Float32Array, type: 'bp' | 'hp' | 'lp', f: number, q: number, sr: number): Float32Array {
  const w0 = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
  const cosw = Math.cos(w0), alpha = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lp') { b0 = (1 - cosw) / 2; b1 = 1 - cosw; b2 = b0; }
  else if (type === 'hp') { b0 = (1 + cosw) / 2; b1 = -(1 + cosw); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha, a1 = -2 * cosw, a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

function renderVoice(spec: VoiceSpec, sr: number, seed: number): Float32Array {
  const n = Math.max(8, Math.round(spec.len * sr));
  const out = new Float32Array(n);
  const rng = makeRng(seed);

  for (const m of spec.modes ?? []) {
    if (m.f >= sr * 0.48) continue;
    const w = (2 * Math.PI * m.f) / sr, k = Math.exp(-1 / (m.tau * sr));
    let env = m.a;
    for (let i = 0; i < n; i++) { out[i] += env * Math.sin(w * i); env *= k; }
  }

  if (spec.sweep) {
    const s = spec.sweep, ke = Math.exp(-1 / (s.tau * sr)), kf = Math.exp(-1 / (s.fTau * sr));
    let env = s.a, fd = s.f0 - s.f1, ph = 0;
    for (let i = 0; i < n; i++) { ph += (2 * Math.PI * (s.f1 + fd)) / sr; out[i] += env * Math.sin(ph); env *= ke; fd *= kf; }
  }

  if (spec.metal) {
    const mt = spec.metal;
    const raw = new Float32Array(n);
    for (const f0 of mt.freqs) {
      // persegi band-limited (deret harmonik ganjil) agar tidak alias
      for (let h = 1; f0 * h < sr * 0.45; h += 2) {
        const w = (2 * Math.PI * f0 * h) / sr, amp = 1 / h;
        for (let i = 0; i < n; i++) raw[i] += amp * Math.sin(w * i);
      }
    }
    const filtered = biquad(raw, mt.filter.type, mt.filter.f, mt.filter.q ?? 0.8, sr);
    const k1 = Math.exp(-1 / (mt.tau * sr)), k2 = mt.tau2 ? Math.exp(-1 / (mt.tau2 * sr)) : 0;
    const mix = mt.tau2 ? (mt.mix2 ?? 0.5) : 0;
    let e1 = 1, e2 = 1;
    for (let i = 0; i < n; i++) { out[i] += mt.a * filtered[i] * ((1 - mix) * e1 + mix * e2); e1 *= k1; if (k2) e2 *= k2; }
  }

  for (const nz of spec.noises ?? []) {
    const d = Math.round((nz.delay ?? 0) * sr);
    const len = n - d;
    if (len <= 0) continue;
    const raw = new Float32Array(len);
    for (let i = 0; i < len; i++) raw[i] = rng();
    const f = biquad(raw, nz.type, nz.f, nz.q ?? 0.8, sr);
    const k = Math.exp(-1 / (nz.tau * sr));
    let env = nz.a;
    for (let i = 0; i < len; i++) { out[d + i] += env * f[i]; env *= k; }
  }

  // Sentuhan awal ~0,15 ms (hindari klik DC) & penutup 4 ms (hindari klik akhir).
  const att = Math.max(1, Math.round(0.00015 * sr));
  for (let i = 0; i < att && i < n; i++) out[i] *= i / att;
  const rel = Math.min(n, Math.round(0.004 * sr));
  for (let i = 0; i < rel; i++) out[n - 1 - i] *= i / rel;

  let peak = 0;
  for (let i = 0; i < n; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 0) { const g = 1 / peak; for (let i = 0; i < n; i++) out[i] *= g; }
  return out;
}

const sampleCache = new Map<string, Float32Array>();

/** Sampel PCM satu klik (puncak = 1). Di-cache; JANGAN diubah isinya. */
export function clickSample(soundId: string | undefined, kind: ClickKind, sr: number): Float32Array {
  const snd = getClickSound(soundId);
  const key = `${snd.id}|${kind}|${sr}`;
  let s = sampleCache.get(key);
  if (!s) {
    s = renderVoice(snd.build(kind), sr, snd.seed * 31 + (kind === 'accent' ? 1 : kind === 'beat' ? 2 : 3));
    sampleCache.set(key, s);
  }
  return s;
}

// ── Render ke berkas ────────────────────────────────────────────────────────
export interface MetronomeRenderOptions {
  bpm: number;
  beatsPerBar: number;       // pembilang
  bars: number;
  denominator?: number;      // penyebut birama (bawaan 4)
  tempoRef?: TempoRef;       // acuan BPM (bawaan 'quarter')
  subdivisionId?: string;
  subdivision?: number;
  accents?: Accent[];
  sound?: string;
  sampleRate?: number;
}

export function renderMetronome(opts: MetronomeRenderOptions): Float32Array {
  const sr = opts.sampleRate ?? 44100;
  const sub = getSubdivision(opts.subdivisionId ?? (opts.subdivision !== undefined ? String(Math.max(1, Math.min(6, Math.round(opts.subdivision)))) : undefined));
  const snd = getClickSound(opts.sound);
  const pulses = Math.max(1, Math.round(opts.beatsPerBar));
  const accents: Accent[] = Array.from({ length: pulses }, (_, i) => opts.accents?.[i] ?? (i === 0 ? 2 : 1));
  const pulseSamples = pulseSeconds(opts.bpm, opts.denominator ?? 4, opts.tempoRef ?? 'quarter') * sr;
  const total = Math.round(pulseSamples * pulses * opts.bars);
  const out = new Float32Array(total);

  const put = (start: number, kind: ClickKind) => {
    const s = clickSample(snd.id, kind, sr), g = CLICK_GAIN[kind];
    for (let i = 0; i < s.length && start + i < total; i++) out[start + i] += s[i] * g;
  };
  for (let p = 0; p < pulses * opts.bars; p++) {
    const a = accents[p % pulses];
    sub.offsets.forEach((off, j) => {
      const start = Math.round((p + off) * pulseSamples);
      if (j === 0) { if (a === 2) put(start, 'accent'); else if (a === 1) put(start, 'beat'); }
      else put(start, 'sub');
    });
  }
  // Klik rapat (mis. 1/64) bisa menumpuk: skala turun bersama-sama, bukan dipotong (tanpa distorsi).
  let peak = 0;
  for (let i = 0; i < total; i++) { const a = Math.abs(out[i]); if (a > peak) peak = a; }
  if (peak > 0.98) { const g = 0.98 / peak; for (let i = 0; i < total; i++) out[i] *= g; }
  return out;
}

export interface PitchResult { freq: number; clarity: number; }

export function detectPitch(buf: Float32Array, sr: number, minHz = 60, maxHz = 1200): PitchResult | null {
  const size = buf.length;
  const half = Math.floor(size / 2);
  const tauMin = Math.max(2, Math.floor(sr / maxHz));
  const tauMax = Math.min(half - 1, Math.ceil(sr / minHz));
  if (tauMax <= tauMin + 2) return null;

  let rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / size) < 0.008) return null;

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

export function midiToFreq(midi: number, a4 = 440): number {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

export interface NoteInfo { name: string; octave: number; midi: number; cents: number; targetFreq: number; }

const PITCH_NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function freqToNote(freq: number, a4 = 440): NoteInfo {
  const midiExact = 69 + 12 * Math.log2(freq / a4);
  const midi = Math.round(midiExact);
  return {
    name: PITCH_NOTE_NAMES[((midi % 12) + 12) % 12],
    octave: Math.floor(midi / 12) - 1,
    midi,
    cents: (midiExact - midi) * 100,
    targetFreq: a4 * Math.pow(2, (midi - 69) / 12),
  };
}

export interface TuningString { label: string; midi: number; }
export interface TuningPreset { id: string; name: string; group: string; strings: TuningString[]; }

const NOTE_LABELS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteLabel = (midi: number) => `${NOTE_LABELS[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
const strs = (...midis: number[]): TuningString[] => midis.map((m) => ({ label: noteLabel(m), midi: m }));
const pre = (id: string, name: string, group: string, ...midis: number[]): TuningPreset => ({ id, name, group, strings: strs(...midis) });

export const TUNING_PRESETS: TuningPreset[] = [
  { id: 'chromatic', name: 'Kromatik (semua nada / vokal)', group: 'Umum', strings: [] },
  pre('guitar', 'Standar (E A D G B E)', 'Gitar 6 senar', 40, 45, 50, 55, 59, 64),
  pre('guitar-dropd', 'Drop D (D A D G B E)', 'Gitar 6 senar', 38, 45, 50, 55, 59, 64),
  pre('guitar-halfdown', 'Half-step down (Eb Ab Db Gb Bb Eb)', 'Gitar 6 senar', 39, 44, 49, 54, 58, 63),
  pre('guitar-fulldown', 'Whole-step down (D G C F A D)', 'Gitar 6 senar', 38, 43, 48, 53, 57, 62),
  pre('guitar-dadgad', 'DADGAD (Celtic / fingerstyle)', 'Gitar 6 senar', 38, 45, 50, 55, 57, 62),
  pre('guitar-opend', 'Open D (D A D F# A D)', 'Gitar 6 senar', 38, 45, 50, 54, 57, 62),
  pre('guitar-openg', 'Open G (D G D G B D)', 'Gitar 6 senar', 38, 43, 50, 55, 59, 62),
  pre('guitar-opene', 'Open E (E B E G# B E)', 'Gitar 6 senar', 40, 47, 52, 56, 59, 64),
  pre('guitar7', 'Gitar 7 senar (B E A D G B E)', 'Gitar lain', 35, 40, 45, 50, 55, 59, 64),
  pre('guitar-bari', 'Gitar bariton (B E A D F# B)', 'Gitar lain', 35, 40, 45, 50, 54, 59),
  pre('bass', 'Bass 4 senar (E A D G)', 'Bass', 28, 33, 38, 43),
  pre('bass-dropd', 'Bass 4 senar Drop D (D A D G)', 'Bass', 26, 33, 38, 43),
  pre('bass5', 'Bass 5 senar (B E A D G)', 'Bass', 23, 28, 33, 38, 43),
  pre('bass6', 'Bass 6 senar (B E A D G C)', 'Bass', 23, 28, 33, 38, 43, 48),
  pre('ukulele', 'Ukulele soprano/concert/tenor (G C E A)', 'Ukulele & sejenisnya', 67, 60, 64, 69),
  pre('ukulele-lowg', 'Ukulele low-G (G C E A, G satu oktaf lebih rendah)', 'Ukulele & sejenisnya', 55, 60, 64, 69),
  pre('ukulele-bari', 'Ukulele bariton (D G B E)', 'Ukulele & sejenisnya', 50, 55, 59, 64),
  pre('ukulele-d', 'Ukulele D-tuning (A D F# B)', 'Ukulele & sejenisnya', 69, 62, 66, 71),
  pre('violin', 'Biola / violin (G D A E)', 'Alat gesek', 55, 62, 69, 76),
  pre('viola', 'Viola (C G D A)', 'Alat gesek', 48, 55, 62, 69),
  pre('cello', 'Cello (C G D A)', 'Alat gesek', 36, 43, 50, 57),
  pre('doublebass', 'Kontrabas (E A D G)', 'Alat gesek', 28, 33, 38, 43),
  pre('mandolin', 'Mandolin (G D A E)', 'Alat petik lain', 55, 62, 69, 76),
  pre('banjo5', 'Banjo 5 senar (G D G B D)', 'Alat petik lain', 67, 50, 55, 59, 62),
  pre('banjo-tenor', 'Banjo tenor (C G D A)', 'Alat petik lain', 48, 55, 62, 69),
  pre('charango', 'Charango (G C E A E)', 'Alat petik lain', 67, 72, 76, 69, 76),
  pre('bouzouki', 'Bouzouki Irlandia (G D A D)', 'Alat petik lain', 43, 50, 57, 62),
];

export function lowestFreq(preset: TuningPreset, a4 = 440): number | null {
  if (!preset.strings.length) return null;
  return Math.min(...preset.strings.map((st) => midiToFreq(st.midi, a4)));
}

export function nearestString(freq: number, preset: TuningPreset, a4 = 440): { string: TuningString; cents: number } | null {
  if (preset.strings.length === 0) return null;
  let best = preset.strings[0], bestAbs = Infinity, bestCents = 0;
  for (const st of preset.strings) {
    const cents = 1200 * Math.log2(freq / midiToFreq(st.midi, a4));
    if (Math.abs(cents) < bestAbs) { bestAbs = Math.abs(cents); best = st; bestCents = cents; }
  }
  return { string: best, cents: bestCents };
}

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
