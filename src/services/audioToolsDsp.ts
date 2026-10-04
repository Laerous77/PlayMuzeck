// src/services/audioToolsDsp.ts
//
// Modul DSP murni untuk Audio Tools Suite.
// Semua fungsi bekerja pada array kanal Float32Array (bukan AudioBuffer) sehingga
// mudah diuji dan tidak bergantung pada AudioContext. Hanya LivePitchPlayer yang
// memakai Web Audio API (untuk preview real-time).

export type Channels = Float32Array[];
export type ProgressFn = (pct: number) => void;

export interface DspOptions {
  onProgress?: ProgressFn;
  /** Kembalikan true untuk membatalkan proses (akan melempar DspError CANCELLED). */
  isCancelled?: () => boolean;
}

export type DspErrorCode = 'CANCELLED' | 'MONO' | 'SILENT' | 'EMPTY';

export class DspError extends Error {
  code: DspErrorCode;
  constructor(code: DspErrorCode, message?: string) {
    super(message || code);
    this.code = code;
    this.name = 'DspError';
  }
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Memberi napas ke UI thread tiap ±24 ms kerja, sekaligus mengecek pembatalan. */
class Yielder {
  private last = nowMs();
  constructor(private opts: DspOptions) {}
  async tick() {
    if (this.opts.isCancelled?.()) throw new DspError('CANCELLED');
    if (nowMs() - this.last > 24) {
      await new Promise<void>((r) => setTimeout(r, 0));
      this.last = nowMs();
      if (this.opts.isCancelled?.()) throw new DspError('CANCELLED');
    }
  }
}

function sub(opts: DspOptions, lo: number, hi: number): DspOptions {
  return {
    isCancelled: opts.isCancelled,
    onProgress: opts.onProgress ? (p) => opts.onProgress!(lo + (hi - lo) * (p / 100)) : undefined,
  };
}

// ---------------------------------------------------------------------------
// FFT radix-2
// ---------------------------------------------------------------------------

export class FFT {
  readonly size: number;
  private cosT: Float64Array;
  private sinT: Float64Array;
  private rev: Uint32Array;

  constructor(size: number) {
    if (size < 2 || (size & (size - 1)) !== 0) throw new Error('Ukuran FFT harus pangkat 2');
    this.size = size;
    this.cosT = new Float64Array(size / 2);
    this.sinT = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      const a = (2 * Math.PI * i) / size;
      this.cosT[i] = Math.cos(a);
      this.sinT[i] = Math.sin(a);
    }
    this.rev = new Uint32Array(size);
    const bits = Math.round(Math.log2(size));
    for (let i = 0; i < size; i++) {
      let r = 0;
      let x = i;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
  }

  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.size;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    const sgn = inverse ? 1 : -1;
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = 0, k = 0; j < half; j++, k += step) {
          const wr = this.cosT[k];
          const wi = sgn * this.sinT[k];
          const a = i + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
    if (inverse) {
      const s = 1 / n;
      for (let i = 0; i < n; i++) {
        re[i] *= s;
        im[i] *= s;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Filter Butterworth (cascade biquad) & resampler
// ---------------------------------------------------------------------------

function biquadCoeffs(type: 'lowpass' | 'highpass', fc: number, sr: number, q: number) {
  const w0 = (2 * Math.PI * Math.min(fc, sr * 0.499)) / sr;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0: number, b1: number, b2: number;
  if (type === 'lowpass') {
    b0 = (1 - cosw) / 2;
    b1 = 1 - cosw;
    b2 = (1 - cosw) / 2;
  } else {
    b0 = (1 + cosw) / 2;
    b1 = -(1 + cosw);
    b2 = (1 + cosw) / 2;
  }
  const a0 = 1 + alpha;
  return [b0 / a0, b1 / a0, b2 / a0, (-2 * cosw) / a0, (1 - alpha) / a0];
}

function applyBiquad(data: Float32Array, c: number[]) {
  let z1 = 0;
  let z2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    const y = c[0] * x + z1;
    z1 = c[1] * x - c[3] * y + z2;
    z2 = c[2] * x - c[4] * y;
    data[i] = y;
  }
}

/** Filter Butterworth orde genap (default 4) yang dimodifikasi langsung pada `data`. */
export function butterworthInPlace(
  data: Float32Array,
  sampleRate: number,
  fc: number,
  type: 'lowpass' | 'highpass',
  order = 4
) {
  if (fc <= 0 || fc >= sampleRate / 2) return;
  for (let k = 1; k <= order / 2; k++) {
    const q = 1 / (2 * Math.cos(((2 * k - 1) * Math.PI) / (2 * order)));
    applyBiquad(data, biquadCoeffs(type, fc, sampleRate, q));
  }
}

/**
 * Resample dengan interpolasi Catmull-Rom. out[i] = src(i * ratio).
 * ratio > 1 -> lebih pendek & lebih tinggi nadanya bila diputar pada sample rate sama.
 */
export function resampleByRatio(src: Float32Array, ratio: number): Float32Array {
  const n = src.length;
  if (n === 0) return new Float32Array(0);
  const outLen = Math.max(1, Math.floor(n / ratio));
  const out = new Float32Array(outLen);
  const last = n - 1;
  for (let i = 0; i < outLen; i++) {
    const pos = i * ratio;
    const i1 = Math.floor(pos);
    const f = pos - i1;
    const p1 = src[Math.min(i1, last)];
    const p0 = src[i1 > 0 ? Math.min(i1 - 1, last) : 0];
    const p2 = src[Math.min(i1 + 1, last)];
    const p3 = src[Math.min(i1 + 2, last)];
    out[i] = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Volume
// ---------------------------------------------------------------------------

export function computePeak(channels: Channels): number {
  let peak = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = ch[i] < 0 ? -ch[i] : ch[i];
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** Terapkan gain (dB) lalu hard-clip ke [-1, 1] agar file ekspor tidak melampaui rentang. */
export function applyGainDb(channels: Channels, db: number): { channels: Channels; clipped: boolean } {
  const g = Math.pow(10, db / 20);
  let clipped = false;
  const out = channels.map((ch) => {
    const o = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) {
      let v = ch[i] * g;
      if (v > 1) {
        v = 1;
        clipped = true;
      } else if (v < -1) {
        v = -1;
        clipped = true;
      }
      o[i] = v;
    }
    return o;
  });
  return { channels: out, clipped };
}

/** Puncak (0..1) per bin untuk menggambar waveform. */
export function waveformPeaks(channels: Channels, bins: number): Float32Array {
  const out = new Float32Array(bins);
  if (!channels.length || !channels[0].length) return out;
  const len = channels[0].length;
  for (let b = 0; b < bins; b++) {
    const s = Math.floor((b * len) / bins);
    const e = Math.max(s + 1, Math.floor(((b + 1) * len) / bins));
    const stride = Math.max(1, Math.floor((e - s) / 64));
    let m = 0;
    for (const ch of channels) {
      for (let i = s; i < e; i += stride) {
        const a = ch[i] < 0 ? -ch[i] : ch[i];
        if (a > m) m = a;
      }
    }
    out[b] = m > 1 ? 1 : m;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tempo: WSOLA (Waveform-Similarity Overlap-Add)
// ---------------------------------------------------------------------------

/**
 * Ubah kecepatan tanpa mengubah nada. speed > 1 = lebih cepat (lebih pendek).
 * Panjang keluaran = round(panjang / speed).
 */
export async function timeStretch(
  channels: Channels,
  sampleRate: number,
  speed: number,
  opts: DspOptions = {}
): Promise<Channels> {
  if (!channels.length) throw new DspError('EMPTY');
  const len = channels[0].length;
  if (len === 0) throw new DspError('EMPTY');
  if (Math.abs(speed - 1) < 0.005) return channels.map((c) => c.slice());
  speed = Math.min(4, Math.max(0.25, speed));

  let N = Math.round(sampleRate * 0.046);
  if (N % 2) N++;
  N = Math.max(256, N);
  const Hs = N / 2; // synthesis hop -> Hann 50% overlap menjumlah ke 1
  const Ha = Hs * speed; // analysis hop nominal
  const delta = Math.round(sampleRate * 0.012); // toleransi pencarian ±12 ms
  const outLen = Math.max(1, Math.round(len / speed));
  const nCh = channels.length;

  // Sinyal mono (dengan zero-padding) sebagai panduan pencarian kemiripan gelombang.
  const pad = N + 2 * delta + Hs + 16;
  const mono = new Float32Array(len + pad);
  for (let c = 0; c < nCh; c++) {
    const ch = channels[c];
    for (let i = 0; i < len; i++) mono[i] += ch[i] / nCh;
  }

  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  // Frame pertama: separuh awal tidak di-fade supaya awal audio tidak teredam.
  const winFirst = win.slice();
  for (let i = 0; i < Hs; i++) winFirst[i] = 1;

  const outs = channels.map(() => new Float32Array(outLen + N));
  const norm = new Float32Array(outLen + N);
  const tpl = new Float32Array(N);
  const STEP_SEARCH = 2;
  const STEP_CMP = 4;
  const totalFrames = Math.ceil(outLen / Hs) + 1;
  const y = new Yielder(opts);

  let prev = 0;
  for (let k = 0; ; k++) {
    const outPos = k * Hs;
    if (outPos >= outLen) break;
    const nominal = Math.round(k * Ha);
    let chosen: number;

    if (k === 0) {
      chosen = 0;
    } else {
      const tStart = prev + Hs;
      for (let j = 0; j < N; j += STEP_CMP) tpl[j] = mono[tStart + j];
      const lo = Math.max(0, nominal - delta);
      const hi = Math.min(len - 1, nominal + delta);
      if (lo > hi) {
        chosen = Math.min(len - 1, Math.max(0, nominal));
      } else {
        let best = -Infinity;
        chosen = lo;
        for (let c = lo; c <= hi; c += STEP_SEARCH) {
          let dot = 0;
          let en = 0;
          for (let j = 0; j < N; j += STEP_CMP) {
            const a = mono[c + j];
            dot += a * tpl[j];
            en += a * a;
          }
          const score = dot / Math.sqrt(en + 1e-9);
          if (score > best) {
            best = score;
            chosen = c;
          }
        }
      }
    }

    const w = k === 0 ? winFirst : win;
    for (let c = 0; c < nCh; c++) {
      const src = channels[c];
      const dst = outs[c];
      const maxJ = Math.min(N, len - chosen);
      for (let j = 0; j < maxJ; j++) dst[outPos + j] += src[chosen + j] * w[j];
    }
    for (let j = 0; j < N; j++) norm[outPos + j] += w[j];
    prev = chosen;

    if ((k & 15) === 0) {
      opts.onProgress?.(Math.min(99, (k / totalFrames) * 100));
      await y.tick();
    }
  }

  const result: Channels = [];
  for (let c = 0; c < nCh; c++) {
    const dst = outs[c];
    const o = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) o[i] = norm[i] > 1e-3 ? dst[i] / norm[i] : dst[i];
    result.push(o);
  }
  opts.onProgress?.(100);
  return result;
}

// ---------------------------------------------------------------------------
// Pitch (ekspor offline)
// ---------------------------------------------------------------------------

/**
 * Geser nada dalam semitone.
 * keepTempo = true  -> durasi tetap (time-stretch WSOLA + resample).
 * keepTempo = false -> seperti memutar lebih cepat/lambat (durasi berubah).
 */
export async function pitchShift(
  channels: Channels,
  sampleRate: number,
  semitones: number,
  keepTempo: boolean,
  opts: DspOptions = {}
): Promise<Channels> {
  const ratio = Math.pow(2, semitones / 12);
  if (Math.abs(ratio - 1) < 1e-4) return channels.map((c) => c.slice());

  let work = channels;
  if (keepTempo) {
    work = await timeStretch(channels, sampleRate, 1 / ratio, sub(opts, 0, 92));
  }

  const out = work.map((c) => {
    let src = c;
    if (ratio > 1) {
      // anti-aliasing sebelum membaca lebih cepat
      src = c.slice();
      butterworthInPlace(src, sampleRate, 0.45 * (sampleRate / ratio), 'lowpass', 4);
    }
    return resampleByRatio(src, ratio);
  });
  opts.onProgress?.(100);
  return out;
}

// ---------------------------------------------------------------------------
// Kompresi: downmix + downsample dengan anti-aliasing
// ---------------------------------------------------------------------------

export function downsampleForCompress(
  channels: Channels,
  srcRate: number,
  dstRate: number,
  mono: boolean
): { channels: Channels; sampleRate: number } {
  const targetRate = Math.min(dstRate, srcRate);
  let work: Channels;
  if (mono && channels.length > 1) {
    const len = channels[0].length;
    const m = new Float32Array(len);
    const n = channels.length;
    for (let c = 0; c < n; c++) {
      const ch = channels[c];
      for (let i = 0; i < len; i++) m[i] += ch[i] / n;
    }
    work = [m];
  } else if (!mono && channels.length > 2) {
    work = channels.slice(0, 2).map((c) => c.slice());
  } else {
    work = channels.map((c) => c.slice());
  }

  if (targetRate >= srcRate) return { channels: work, sampleRate: srcRate };

  const ratio = srcRate / targetRate;
  const out = work.map((c) => {
    butterworthInPlace(c, srcRate, 0.45 * targetRate, 'lowpass', 8);
    return resampleByRatio(c, ratio);
  });
  return { channels: out, sampleRate: targetRate };
}

// ---------------------------------------------------------------------------
// STFT helper bersama (Hann, N=2048, hop=512)
// ---------------------------------------------------------------------------

const STFT_N = 2048;
const STFT_H = 512;

function makeHann(n: number) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

const frameCountFor = (len: number) => Math.ceil((len + STFT_N - STFT_H) / STFT_H);
const frameStartOf = (f: number) => f * STFT_H - (STFT_N - STFT_H);

function loadFrame(ch: Float32Array, start: number, win: Float64Array, re: Float64Array, im: Float64Array) {
  const len = ch.length;
  for (let j = 0; j < STFT_N; j++) {
    const idx = start + j;
    re[j] = idx >= 0 && idx < len ? ch[idx] * win[j] : 0;
    im[j] = 0;
  }
}

/** Jumlah w^2 per sampel untuk normalisasi OLA analisis+sintesis. */
function overlapNorm(len: number, win: Float64Array): Float32Array {
  const norm = new Float32Array(len);
  const F = frameCountFor(len);
  for (let f = 0; f < F; f++) {
    const s = frameStartOf(f);
    for (let j = 0; j < STFT_N; j++) {
      const idx = s + j;
      if (idx >= 0 && idx < len) norm[idx] += win[j] * win[j];
    }
  }
  return norm;
}

// ---------------------------------------------------------------------------
// Noise reduction: spectral gate (STFT) + high-pass anti dengung
// ---------------------------------------------------------------------------

/**
 * @param aggression 10..100
 * Profil noise diambil otomatis dari ±10% frame paling senyap pada berkas.
 */
export async function spectralNoiseGate(
  channels: Channels,
  sampleRate: number,
  aggression: number,
  opts: DspOptions = {}
): Promise<Channels> {
  if (!channels.length || channels[0].length === 0) throw new DspError('EMPTY');
  const agg = Math.min(100, Math.max(0, aggression)) / 100;
  const N = STFT_N;
  const H = STFT_H;
  const bins = N / 2 + 1;
  const fft = new FFT(N);
  const win = makeHann(N);
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  const y = new Yielder(opts);

  const alpha = 1 + 2 * agg; // over-subtraction
  const gMin = Math.pow(10, -(6 + 24 * agg) / 20); // lantai attenuasi 6..30 dB
  const humHz = 30 + agg * 40; // high-pass lembut, tidak memotong bass musik

  const results: Channels = [];

  for (let c = 0; c < channels.length; c++) {
    const base = c / channels.length;
    const span = 1 / channels.length;
    const report = (p: number) => opts.onProgress?.(Math.min(99, (base + span * p) * 100));

    const ch = channels[c].slice();
    butterworthInPlace(ch, sampleRate, humHz, 'highpass', 4);
    const len = ch.length;
    const F = frameCountFor(len);

    // 1) energi tiap frame penuh -> pilih yang paling senyap (bukan digital silence)
    const cand: { f: number; e: number }[] = [];
    for (let f = 0; f < F; f++) {
      const s = frameStartOf(f);
      if (len >= N && (s < 0 || s + N > len)) continue;
      let e = 0;
      for (let j = 0; j < N; j++) {
        const idx = s + j;
        if (idx >= 0 && idx < len) {
          const v = ch[idx] * win[j];
          e += v * v;
        }
      }
      if (e > 1e-12 * N) cand.push({ f, e });
    }
    if (!cand.length) {
      results.push(ch);
      continue;
    }
    cand.sort((a, b) => a.e - b.e);
    const take = Math.min(cand.length, Math.max(3, Math.floor(cand.length * 0.1)));
    const noise = new Float64Array(bins);
    for (let i = 0; i < take; i++) {
      loadFrame(ch, frameStartOf(cand[i].f), win, re, im);
      fft.transform(re, im);
      for (let k = 0; k < bins; k++) noise[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]) / take;
    }
    await y.tick();

    // 2) gate per frame
    const norm = overlapNorm(len, win);
    const out = new Float32Array(len);
    const g = new Float64Array(bins);
    const gs = new Float64Array(bins);
    const prevG = new Float64Array(bins).fill(1);

    for (let f = 0; f < F; f++) {
      const s = frameStartOf(f);
      loadFrame(ch, s, win, re, im);
      fft.transform(re, im);

      for (let k = 0; k < bins; k++) {
        const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
        if (mag < 1e-12 || noise[k] <= 0) {
          g[k] = 1;
        } else {
          const v = 1 - (alpha * noise[k]) / mag;
          g[k] = v > gMin ? v : gMin;
        }
      }
      for (let k = 0; k < bins; k++) {
        const a = g[k > 0 ? k - 1 : 0];
        const b = g[k < bins - 1 ? k + 1 : bins - 1];
        gs[k] = 0.25 * a + 0.5 * g[k] + 0.25 * b;
      }
      for (let k = 0; k < bins; k++) {
        const target = gs[k];
        const p = prevG[k];
        const v = target > p ? p + (target - p) * 0.85 : p + (target - p) * 0.3;
        prevG[k] = v;
        re[k] *= v;
        im[k] *= v;
        if (k > 0 && k < N / 2) {
          re[N - k] *= v;
          im[N - k] *= v;
        }
      }
      fft.transform(re, im, true);
      for (let j = 0; j < N; j++) {
        const idx = s + j;
        if (idx >= 0 && idx < len) out[idx] += re[j] * win[j];
      }
      if ((f & 31) === 0) {
        report(f / F);
        await y.tick();
      }
    }
    for (let i = 0; i < len; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
    results.push(out);
  }
  opts.onProgress?.(100);
  return results;
}

// ---------------------------------------------------------------------------
// Vocal separator: isolasi kanal tengah berbasis kemiripan fase/amplitudo
// ---------------------------------------------------------------------------

export interface CenterIsolateResult {
  vocal: Channels; // 2 kanal
  instrumental: Channels; // 2 kanal
}

export async function centerIsolate(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  opts: DspOptions = {}
): Promise<CenterIsolateResult> {
  const len = left.length;
  if (len === 0) throw new DspError('EMPTY');

  let midE = 0;
  let sideE = 0;
  for (let i = 0; i < len; i++) {
    const m = left[i] + right[i];
    const s = left[i] - right[i];
    midE += m * m;
    sideE += s * s;
  }
  if (midE < 1e-12) throw new DspError('SILENT');
  if (sideE < midE * 1e-6) throw new DspError('MONO');

  const N = STFT_N;
  const bins = N / 2 + 1;
  const fft = new FFT(N);
  const win = makeHann(N);
  const lr = new Float64Array(N);
  const li = new Float64Array(N);
  const rr = new Float64Array(N);
  const ri = new Float64Array(N);
  const vr = new Float64Array(N);
  const vi = new Float64Array(N);
  const y = new Yielder(opts);

  // Bobot pita: bass/kick (<~150 Hz) tetap di instrumental, desis tinggi dikurangi.
  const band = new Float64Array(bins);
  for (let k = 0; k < bins; k++) {
    const hz = (k * sampleRate) / N;
    let w = 1;
    if (hz < 100) w = 0;
    else if (hz < 180) w = (hz - 100) / 80;
    else if (hz > 14000) w = 0.4;
    else if (hz > 8000) w = 1 - (0.6 * (hz - 8000)) / 6000;
    band[k] = w;
  }

  const norm = overlapNorm(len, win);
  const vocalAcc = new Float32Array(len);
  const mask = new Float64Array(bins);
  const maskS = new Float64Array(bins);
  const prevMask = new Float64Array(bins);
  const F = frameCountFor(len);

  for (let f = 0; f < F; f++) {
    const s = frameStartOf(f);
    loadFrame(left, s, win, lr, li);
    loadFrame(right, s, win, rr, ri);
    fft.transform(lr, li);
    fft.transform(rr, ri);

    for (let k = 0; k < bins; k++) {
      const num = 2 * (lr[k] * rr[k] + li[k] * ri[k]);
      const den = lr[k] * lr[k] + li[k] * li[k] + rr[k] * rr[k] + ri[k] * ri[k] + 1e-12;
      let c = num / den;
      c = c > 0 ? c : 0;
      mask[k] = c * c * c * band[k];
    }
    for (let k = 0; k < bins; k++) {
      const a = mask[k > 0 ? k - 1 : 0];
      const b = mask[k < bins - 1 ? k + 1 : bins - 1];
      const target = 0.25 * a + 0.5 * mask[k] + 0.25 * b;
      const p = prevMask[k];
      const v = target > p ? p + (target - p) * 0.8 : p + (target - p) * 0.4;
      prevMask[k] = v;
      maskS[k] = v;
    }
    for (let k = 0; k < bins; k++) {
      const mr = 0.5 * (lr[k] + rr[k]);
      const mi = 0.5 * (li[k] + ri[k]);
      vr[k] = maskS[k] * mr;
      vi[k] = maskS[k] * mi;
      if (k > 0 && k < N / 2) {
        vr[N - k] = vr[k];
        vi[N - k] = -vi[k];
      }
    }
    fft.transform(vr, vi, true);
    for (let j = 0; j < N; j++) {
      const idx = s + j;
      if (idx >= 0 && idx < len) vocalAcc[idx] += vr[j] * win[j];
    }
    if ((f & 31) === 0) {
      opts.onProgress?.(Math.min(99, (f / F) * 100));
      await y.tick();
    }
  }

  const vocal = new Float32Array(len);
  const instL = new Float32Array(len);
  const instR = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const v = norm[i] > 1e-6 ? vocalAcc[i] / norm[i] : 0;
    vocal[i] = v;
    instL[i] = left[i] - v;
    instR[i] = right[i] - v;
  }
  opts.onProgress?.(100);
  return { vocal: [vocal, vocal.slice()], instrumental: [instL, instR] };
}

// ---------------------------------------------------------------------------
// Preview pitch real-time (granular, durasi tetap) — memakai Web Audio API
// ---------------------------------------------------------------------------

export class LivePitchPlayer {
  private ctx: AudioContext;
  private buffer: AudioBuffer;
  private master: GainNode;
  private ratio = 1;
  private playing = false;
  private timer: number | null = null;
  private endTimer: number | null = null;
  private nextTime = 0;
  private pos = 0;
  private active = new Set<AudioBufferSourceNode>();
  private onEnded?: () => void;

  private readonly grain = 0.09;
  private readonly hop = 0.09 / 4; // overlap 4x
  private readonly curve: Float32Array;

  constructor(ctx: AudioContext, buffer: AudioBuffer) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.master = ctx.createGain();
    this.master.gain.value = 0.5; // 4x Hann overlap menjumlah ke 2
    this.master.connect(ctx.destination);
    this.curve = new Float32Array(64);
    for (let i = 0; i < 64; i++) this.curve[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / 63);
  }

  setPitchRatio(r: number) {
    this.ratio = Math.max(0.25, Math.min(4, r));
  }

  setOnEnded(cb: () => void) {
    this.onEnded = cb;
  }

  start(fromSec = 0) {
    this.stopInternal(false);
    this.pos = Math.max(0, fromSec);
    this.playing = true;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.pump();
    this.timer = window.setInterval(() => this.pump(), 25);
  }

  stop() {
    this.stopInternal(true);
  }

  private stopInternal(disconnect: boolean) {
    this.playing = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.endTimer !== null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    this.active.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* sudah berhenti */
      }
      try {
        s.disconnect();
      } catch {
        /* abaikan */
      }
    });
    this.active.clear();
    if (disconnect) {
      try {
        this.master.disconnect();
      } catch {
        /* abaikan */
      }
    }
  }

  private pump() {
    if (!this.playing) return;
    const horizon = this.ctx.currentTime + 0.15;
    while (this.nextTime < horizon) {
      if (this.pos >= this.buffer.duration) {
        // semua grain terjadwal: tunggu grain terakhir selesai lalu akhiri
        if (this.timer !== null) {
          clearInterval(this.timer);
          this.timer = null;
        }
        const wait = Math.max(0, this.nextTime - this.ctx.currentTime + this.grain) * 1000;
        this.endTimer = window.setTimeout(() => {
          this.stopInternal(true);
          this.onEnded?.();
        }, wait);
        return;
      }
      this.schedule(this.nextTime, this.pos);
      this.nextTime += this.hop;
      this.pos += this.hop;
    }
  }

  private schedule(when: number, offset: number) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.ratio;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    g.connect(this.master);
    try {
      g.gain.setValueCurveAtTime(this.curve, when, this.grain);
      src.start(when, Math.min(offset, Math.max(0, this.buffer.duration - 0.001)));
      src.stop(when + this.grain + 0.01);
    } catch {
      return;
    }
    this.active.add(src);
    src.onended = () => {
      this.active.delete(src);
      try {
        src.disconnect();
        g.disconnect();
      } catch {
        /* abaikan */
      }
    };
  }
}
