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

export interface Subdivision { id: string; label: string; hint: string; offsets: number[]; }

const even = (n: number) => Array.from({ length: n }, (_, i) => i / n);
export const SUBDIVISIONS: Subdivision[] = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: String(n),
  label: n === 1 ? '1 klik per ketukan' : `${n} klik per ketukan`,
  hint: n === 1 ? 'Hanya klik utama' : `Klik utama + ${n - 1} klik pelan di antara ketukan`,
  offsets: even(n),
}));

export interface TimeSignature { id: string; label: string; pulses: number; accents: Accent[]; }
export type Accent = 0 | 1 | 2;

const acc = (n: number, strong: number[]): Accent[] => Array.from({ length: n }, (_, i) => (strong.includes(i) ? 2 : 1) as Accent);
const ts = (id: string, pulses: number, strong: number[]): TimeSignature => ({ id, label: id, pulses, accents: acc(pulses, strong) });
export const TIME_SIGNATURES: TimeSignature[] = [
  ts('2/4', 2, [0]),
  ts('3/4', 3, [0]),
  ts('4/4', 4, [0]),
  ts('5/4', 5, [0, 3]),
  ts('6/8', 6, [0, 3]),
  ts('7/8', 7, [0, 2, 4]),
  ts('9/8', 9, [0, 3, 6]),
  ts('12/8', 12, [0, 3, 6, 9]),
];

export interface ClickSound { id: string; label: string; accent: number; normal: number; sub: number; decay: number; noise: number; wave: 'sine' | 'square' | 'triangle'; }
export const CLICK_SOUNDS: ClickSound[] = [
  { id: 'beep', label: 'Beep (sine)', accent: 1600, normal: 1000, sub: 700, decay: 90, noise: 0, wave: 'sine' },
  { id: 'woodblock', label: 'Woodblock', accent: 1150, normal: 820, sub: 620, decay: 160, noise: 0.08, wave: 'triangle' },
  { id: 'rimshot', label: 'Rimshot / klik tajam', accent: 2400, normal: 1800, sub: 1300, decay: 260, noise: 0.35, wave: 'square' },
  { id: 'hihat', label: 'Hi-hat (derau)', accent: 7000, normal: 6000, sub: 5000, decay: 320, noise: 0.95, wave: 'sine' },
  { id: 'cowbell', label: 'Cowbell', accent: 800, normal: 540, sub: 400, decay: 55, noise: 0, wave: 'square' },
];

export interface MetronomeRenderOptions {
  bpm: number;
  beatsPerBar: number;
  bars: number;
  subdivisionId?: string;
  subdivision?: number;
  accents?: Accent[];
  sound?: string;
  sampleRate?: number;
}

export const getSubdivision = (id?: string): Subdivision => SUBDIVISIONS.find((x) => x.id === id) ?? SUBDIVISIONS[0];
export const getClickSound = (id?: string): ClickSound => CLICK_SOUNDS.find((x) => x.id === id) ?? CLICK_SOUNDS[0];

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

export function renderMetronome(opts: MetronomeRenderOptions): Float32Array {
  const sr = opts.sampleRate ?? 44100;
  const sub = getSubdivision(opts.subdivisionId ?? (opts.subdivision !== undefined ? String(Math.max(1, Math.min(6, Math.round(opts.subdivision)))) : undefined));
  const snd = getClickSound(opts.sound);
  const pulses = Math.max(1, Math.round(opts.beatsPerBar));
  const accents: Accent[] = Array.from({ length: pulses }, (_, i) => opts.accents?.[i] ?? (i === 0 ? 2 : 1));
  const pulseSamples = (60 / opts.bpm) * sr;
  const total = Math.round(pulseSamples * pulses * opts.bars);
  const out = new Float32Array(total);
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0xffffffff * 2 - 1; };
  const click = (startSample: number, freq: number, amp: number) => {
    const len = Math.round(0.06 * sr);
    for (let i = 0; i < len && startSample + i < total; i++) {
      const t = i / sr;
      const env = Math.exp(-t * snd.decay);
      const ph = 2 * Math.PI * freq * t;
      const tone = snd.wave === 'sine' ? Math.sin(ph) : snd.wave === 'square' ? Math.sign(Math.sin(ph)) * 0.6 : (2 / Math.PI) * Math.asin(Math.sin(ph));
      const v = out[startSample + i] + (tone * (1 - snd.noise) + rnd() * snd.noise) * env * amp;
      out[startSample + i] = v > 1 ? 1 : v < -1 ? -1 : v;
    }
  };
  for (let p = 0; p < pulses * opts.bars; p++) {
    const a = accents[p % pulses];
    sub.offsets.forEach((off, j) => {
      const start = Math.round((p + off) * pulseSamples);
      if (j === 0) {
        if (a === 2) click(start, snd.accent, 0.8);
        else if (a === 1) click(start, snd.normal, 0.6);
      } else click(start, snd.sub, 0.3);
    });
  }
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
