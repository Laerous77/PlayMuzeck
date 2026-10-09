// src/services/padFxRuntime.ts
// RUNTIME EFEK PAD STUDIO (Web Audio). Dipakai SAMA PERSIS oleh:
//   - pemutaran live (audioEngine.getFx())            -> AudioContext biasa
//   - ekspor audio (ExportPatternModal, createOfflineFx) -> OfflineAudioContext
// Jadi suara yang terdengar saat bermain = suara hasil ekspor.
//
// Desain:
//   - Rantai efek bersifat PERMANEN (dibuat sekali per bagian drum / instrumen akor), pukulan & akor hanya
//     menyambung ke input rantai. Jumlah node tetap konstan berapa lama pun diputar (tidak ada node bocor per pukulan).
//   - Mengubah NILAI parameter memakai AudioParam yang dihaluskan (tanpa klik, ekor reverb/delay tidak terpotong).
//   - Hanya saat DAFTAR efek yang menyala berubah, sambungan antar-efek disusun ulang. Efek yang tetap menyala
//     dipertahankan (ekornya tidak terputus).

import {
  FX_DEFS,
  FX_SIGNAL_ORDER,
  EMPTY_CHAIN,
  emptyFx,
  type FxChain,
  type FxId,
  type PadFxState,
} from './padFxModel';

interface Stage {
  input: AudioNode;
  output: AudioNode;
  update(p: Record<string, number>, init: boolean): void;
  dispose(): void;
}

const smooth = (ctx: BaseAudioContext, param: AudioParam, v: number, init: boolean) => {
  if (init) {
    param.value = v;
    return;
  }
  const t = ctx.currentTime;
  try {
    param.cancelScheduledValues(t);
    param.setTargetAtTime(v, t, 0.015);
  } catch {
    param.value = v;
  }
};

const dbToGain = (db: number) => Math.pow(10, db / 20);

// Lengkapi parameter yang hilang dengan nilai bawaan dan jepit ke rentang sah (jaring pengaman: tidak pernah NaN ke AudioParam).
const fullParams = (id: FxId, p: Record<string, number> | undefined): Record<string, number> => {
  const out: Record<string, number> = {};
  FX_DEFS[id].params.forEach((d) => {
    const v = p?.[d.key];
    out[d.key] = typeof v === 'number' && Number.isFinite(v) ? Math.max(d.min, Math.min(d.max, v)) : d.def;
  });
  return out;
};

const safeDisconnect = (nodes: AudioNode[]) => {
  for (const n of nodes) {
    try {
      n.disconnect();
    } catch {
      /* sudah terputus */
    }
  }
};

// ---------------------------------------------------------------------------
// Impulse response reverb (deterministik: seed tetap, supaya live == ekspor)
// ---------------------------------------------------------------------------
const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const irCache = new Map<string, AudioBuffer>();
const IR_CACHE_MAX = 8;

const getImpulse = (ctx: BaseAudioContext, decaySec: number, dampHz: number): AudioBuffer => {
  const sr = ctx.sampleRate;
  const key = `${sr}|${decaySec.toFixed(2)}|${Math.round(dampHz / 100)}`;
  const hit = irCache.get(key);
  if (hit) return hit;

  const len = Math.max(64, Math.floor(sr * decaySec));
  const buf = ctx.createBuffer(2, len, sr);
  const a = Math.exp((-2 * Math.PI * Math.min(dampHz, sr * 0.45)) / sr);
  const fade = Math.max(1, Math.floor(sr * 0.002));
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const rnd = mulberry32(0x9e3779b9 + ch * 7919);
    let y = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.exp((-6.9078 * i) / len); // -60 dB tepat di akhir
      const x = rnd() * 2 - 1;
      y = (1 - a) * x + a * y; // redaman treble (low-pass satu kutub)
      data[i] = y * env * (i < fade ? i / fade : 1);
    }
  }
  irCache.set(key, buf);
  if (irCache.size > IR_CACHE_MAX) {
    const first = irCache.keys().next().value;
    if (first !== undefined) irCache.delete(first);
  }
  return buf;
};

// ---------------------------------------------------------------------------
// Kurva distortion
// ---------------------------------------------------------------------------
const curveCache = new Map<number, Float32Array>();
const getDriveCurve = (drivePct: number): Float32Array => {
  const key = Math.round(drivePct);
  const hit = curveCache.get(key);
  if (hit) return hit;
  const n = 2048;
  const curve = new Float32Array(n);
  const k = 1 + (key / 100) * 60;
  const norm = Math.tanh(k);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(k * x) / norm;
  }
  curveCache.set(key, curve);
  return curve;
};

// ---------------------------------------------------------------------------
// STAGE (satu efek)
// ---------------------------------------------------------------------------
const FILTER_TYPES: BiquadFilterType[] = ['lowpass', 'highpass', 'bandpass', 'notch'];

const makeStage = (ctx: BaseAudioContext, id: FxId): Stage => {
  switch (id) {
    case 'filter': {
      const f = ctx.createBiquadFilter();
      return {
        input: f,
        output: f,
        update(p, init) {
          f.type = FILTER_TYPES[Math.max(0, Math.min(3, Math.round(p.type ?? 0)))];
          smooth(ctx, f.frequency, p.cutoff, init);
          smooth(ctx, f.Q, p.q, init);
        },
        dispose: () => safeDisconnect([f]),
      };
    }

    case 'eq': {
      const low = ctx.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 100;
      const lowMid = ctx.createBiquadFilter();
      lowMid.type = 'peaking';
      lowMid.frequency.value = 500;
      lowMid.Q.value = 0.9;
      const highMid = ctx.createBiquadFilter();
      highMid.type = 'peaking';
      highMid.frequency.value = 2500;
      highMid.Q.value = 0.9;
      const high = ctx.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 8000;
      low.connect(lowMid);
      lowMid.connect(highMid);
      highMid.connect(high);
      return {
        input: low,
        output: high,
        update(p, init) {
          smooth(ctx, low.gain, p.low, init);
          smooth(ctx, lowMid.gain, p.lowMid, init);
          smooth(ctx, highMid.gain, p.highMid, init);
          smooth(ctx, high.gain, p.high, init);
        },
        dispose: () => safeDisconnect([low, lowMid, highMid, high]),
      };
    }

    case 'distortion': {
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '2x';
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      const wet = ctx.createGain();
      input.connect(dry);
      dry.connect(output);
      input.connect(shaper);
      shaper.connect(tone);
      tone.connect(wet);
      wet.connect(output);
      let lastDrive = -1;
      return {
        input,
        output,
        update(p, init) {
          const drive = Math.round(p.drive);
          if (drive !== lastDrive) {
            shaper.curve = getDriveCurve(drive) as Float32Array<ArrayBuffer>;
            lastDrive = drive;
          }
          const mix = Math.max(0, Math.min(1, p.mix / 100));
          smooth(ctx, tone.frequency, p.tone, init);
          smooth(ctx, dry.gain, 1 - mix, init);
          smooth(ctx, wet.gain, mix * dbToGain(p.level), init);
        },
        dispose: () => safeDisconnect([input, output, dry, shaper, tone, wet]),
      };
    }

    case 'chorus': {
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const d1 = ctx.createDelay(0.1);
      const d2 = ctx.createDelay(0.1);
      d1.delayTime.value = 0.018;
      d2.delayTime.value = 0.026;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      const dep1 = ctx.createGain();
      const dep2 = ctx.createGain();
      lfo.connect(dep1);
      lfo.connect(dep2);
      dep1.connect(d1.delayTime);
      dep2.connect(d2.delayTime);
      input.connect(dry);
      dry.connect(output);
      const extra: AudioNode[] = [];
      const wirePan = (d: DelayNode, pan: number) => {
        if (typeof ctx.createStereoPanner === 'function') {
          const sp = ctx.createStereoPanner();
          sp.pan.value = pan;
          d.connect(sp);
          sp.connect(wet);
          extra.push(sp);
        } else {
          d.connect(wet);
        }
      };
      input.connect(d1);
      input.connect(d2);
      wirePan(d1, -0.7);
      wirePan(d2, 0.7);
      wet.connect(output);
      lfo.start();
      return {
        input,
        output,
        update(p, init) {
          const depthSec = (Math.max(0, Math.min(100, p.depth)) / 100) * 0.008;
          const mix = Math.max(0, Math.min(1, p.mix / 100));
          smooth(ctx, lfo.frequency, p.rate, init);
          smooth(ctx, dep1.gain, depthSec, init);
          smooth(ctx, dep2.gain, -depthSec, init);
          smooth(ctx, wet.gain, mix * 0.75, init);
        },
        dispose() {
          try {
            lfo.stop();
          } catch {
            /* belum / sudah berhenti */
          }
          safeDisconnect([input, output, dry, wet, d1, d2, lfo, dep1, dep2, ...extra]);
        },
      };
    }

    case 'delay': {
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      dry.gain.value = 1;
      const dl = ctx.createDelay(2.0);
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      const fb = ctx.createGain();
      const wet = ctx.createGain();
      input.connect(dry);
      dry.connect(output);
      input.connect(dl);
      dl.connect(tone);
      tone.connect(fb);
      fb.connect(dl);
      tone.connect(wet);
      wet.connect(output);
      return {
        input,
        output,
        update(p, init) {
          smooth(ctx, dl.delayTime, p.time / 1000, init);
          smooth(ctx, fb.gain, Math.min(0.9, p.fb / 100), init);
          smooth(ctx, tone.frequency, p.tone, init);
          smooth(ctx, wet.gain, Math.max(0, Math.min(1, p.mix / 100)), init);
        },
        dispose: () => safeDisconnect([input, output, dry, dl, tone, fb, wet]),
      };
    }

    case 'reverb': {
      const input = ctx.createGain();
      const output = ctx.createGain();
      const dry = ctx.createGain();
      dry.gain.value = 1;
      const pre = ctx.createDelay(0.5);
      const conv = ctx.createConvolver();
      const wet = ctx.createGain();
      input.connect(dry);
      dry.connect(output);
      input.connect(pre);
      pre.connect(conv);
      conv.connect(wet);
      wet.connect(output);
      let lastKey = '';
      return {
        input,
        output,
        update(p, init) {
          const key = `${p.size.toFixed(2)}|${Math.round(p.damp / 100)}`;
          if (key !== lastKey) {
            conv.buffer = getImpulse(ctx, p.size, p.damp);
            lastKey = key;
          }
          smooth(ctx, pre.delayTime, p.pre / 1000, init);
          // Convolver ternormalisasi; sedikit dikuatkan supaya Mix 100% terdengar sebanding dengan sinyal asli.
          smooth(ctx, wet.gain, Math.max(0, Math.min(1, p.mix / 100)) * 1.4, init);
        },
        dispose: () => safeDisconnect([input, output, dry, pre, conv, wet]),
      };
    }

    case 'limiter': {
      const comp = ctx.createDynamicsCompressor();
      comp.knee.value = 0;
      comp.ratio.value = 20;
      comp.attack.value = 0.002;
      const makeup = ctx.createGain();
      comp.connect(makeup);
      return {
        input: comp,
        output: makeup,
        update(p, init) {
          smooth(ctx, comp.threshold, p.thr, init);
          smooth(ctx, comp.release, p.rel / 1000, init);
          smooth(ctx, makeup.gain, dbToGain(p.gain), init);
        },
        dispose: () => safeDisconnect([comp, makeup]),
      };
    }
  }
};

// ---------------------------------------------------------------------------
// RANTAI EFEK (7 efek dalam urutan sinyal tetap, hanya yang menyala yang tersambung)
// ---------------------------------------------------------------------------
export class FxChainRuntime {
  readonly input: GainNode;
  readonly output: GainNode;
  private stages = new Map<FxId, Stage>();
  private signature = '\u0000'; // tidak pernah sama dengan tanda tangan sah => rakit pertama kali
  private applied: FxChain | null = null;

  constructor(private ctx: BaseAudioContext, destination: AudioNode) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.output.connect(destination);
  }

  apply(chain: FxChain) {
    if (this.applied === chain) return;
    this.applied = chain;

    const active = FX_SIGNAL_ORDER.filter((id) => chain[id]?.on);
    const sig = active.join(',');

    if (sig !== this.signature) {
      // Buang efek yang dimatikan.
      this.stages.forEach((stage, id) => {
        if (!active.includes(id)) {
          stage.dispose();
          this.stages.delete(id);
        }
      });
      // Buat efek yang baru dinyalakan.
      const created = new Set<FxId>();
      active.forEach((id) => {
        if (!this.stages.has(id)) {
          this.stages.set(id, makeStage(this.ctx, id));
          created.add(id);
        }
      });
      // Susun ulang sambungan antar-efek (di dalam tiap efek tidak disentuh, jadi ekornya tetap utuh).
      safeDisconnect([this.input]);
      this.stages.forEach((s) => safeDisconnect([s.output]));
      let prev: AudioNode = this.input;
      active.forEach((id) => {
        const s = this.stages.get(id)!;
        prev.connect(s.input);
        prev = s.output;
      });
      prev.connect(this.output);
      this.signature = sig;
      active.forEach((id) => this.stages.get(id)!.update(fullParams(id, chain[id].p), created.has(id)));
      return;
    }

    active.forEach((id) => this.stages.get(id)!.update(fullParams(id, chain[id].p), false));
  }

  dispose() {
    this.stages.forEach((s) => s.dispose());
    this.stages.clear();
    safeDisconnect([this.input, this.output]);
  }
}

// ---------------------------------------------------------------------------
// ROUTER: bagian/instrumen -> "semua" -> tujuan
// ---------------------------------------------------------------------------
export class PadFxRouter {
  private drumAll: FxChainRuntime;
  private chordAll: FxChainRuntime;
  private drumParts = new Map<string, FxChainRuntime>();
  private chordTracks = new Map<string, FxChainRuntime>();
  private state: PadFxState;

  constructor(private ctx: BaseAudioContext, drumDestination: AudioNode, chordDestination: AudioNode, state?: PadFxState) {
    this.state = state ?? emptyFx();
    this.drumAll = new FxChainRuntime(ctx, drumDestination);
    this.chordAll = new FxChainRuntime(ctx, chordDestination);
    this.drumAll.apply(this.state.drumAll);
    this.chordAll.apply(this.state.chordAll);
  }

  setState(state: PadFxState) {
    this.state = state;
    this.drumAll.apply(state.drumAll);
    this.chordAll.apply(state.chordAll);
    this.drumParts.forEach((rt, key) => rt.apply(state.drumParts[key] ?? EMPTY_CHAIN));
    this.chordTracks.forEach((rt, key) => rt.apply(state.chordTracks[key] ?? EMPTY_CHAIN));
  }

  /** Titik masuk untuk satu bagian drum (kick, snare, ...). */
  drumInput(part: string): AudioNode {
    let rt = this.drumParts.get(part);
    if (!rt) {
      rt = new FxChainRuntime(this.ctx, this.drumAll.input);
      rt.apply(this.state.drumParts[part] ?? EMPTY_CHAIN);
      this.drumParts.set(part, rt);
    }
    return rt.input;
  }

  /** Titik masuk untuk satu instrumen akor (id 1..4). */
  chordInput(trackId: string | number): AudioNode {
    const key = String(trackId);
    let rt = this.chordTracks.get(key);
    if (!rt) {
      rt = new FxChainRuntime(this.ctx, this.chordAll.input);
      rt.apply(this.state.chordTracks[key] ?? EMPTY_CHAIN);
      this.chordTracks.set(key, rt);
    }
    return rt.input;
  }

  dispose() {
    this.drumParts.forEach((rt) => rt.dispose());
    this.chordTracks.forEach((rt) => rt.dispose());
    this.drumAll.dispose();
    this.chordAll.dispose();
    this.drumParts.clear();
    this.chordTracks.clear();
  }
}

/** Untuk ekspor: pasang seluruh rantai efek di OfflineAudioContext, keluarannya ke `destination` (mis. master gain). */
export const createOfflineFx = (ctx: BaseAudioContext, destination: AudioNode, state: PadFxState): PadFxRouter =>
  new PadFxRouter(ctx, destination, destination, state);

