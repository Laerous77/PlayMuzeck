// src/services/voiceDsp.ts
// Logika musik untuk alat "Deteksi Nada Suara" dan "Tes Vocal Range". Murni fungsi (tanpa DOM) agar bisa diuji.
// Pitch dasar per-frame dideteksi oleh detectPitch (YIN) di audioExtraDsp; di sini frame-frame itu dirangkai
// menjadi nada (segmentasi), nada stabil, kunci lagu, dan klasifikasi jenis suara.
//
// Konvensi: notasi ilmiah (C4 = do tengah = MIDI 60 = 261,63 Hz pada A4 = 440 Hz).

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;
/** Nama kunci (tonika) yang lazim dipakai musisi: Db, Eb, Ab, Bb memakai mol. */
export const KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

export const midiToFreq = (midi: number, a4 = 440) => a4 * Math.pow(2, (midi - 69) / 12);
export const freqToMidi = (freq: number, a4 = 440) => 69 + 12 * Math.log2(freq / a4);
export const pcOf = (midi: number) => ((Math.round(midi) % 12) + 12) % 12;
export const octaveOf = (midi: number) => Math.floor(Math.round(midi) / 12) - 1;
/** "C#4" */
export const noteName = (midi: number) => `${NOTE_NAMES[pcOf(midi)]}${octaveOf(midi)}`;
/** Nama kunci untuk tonika (tanpa oktaf), mis. 67 -> "G". */
export const keyName = (midi: number) => KEY_NAMES[pcOf(midi)];
/** Selisih cent antara frekuensi dan nada terdekatnya (-50..+50). */
export function centsOff(freq: number, a4 = 440) {
  const m = freqToMidi(freq, a4);
  const r = Math.round(m);
  return { midi: r, cents: (m - r) * 100 };
}

/** Jarak dua nada dalam teks: 12 -> "1 oktaf", 19 -> "1 oktaf + 7 semiton". */
export function describeSpan(semitones: number): string {
  const s = Math.max(0, Math.round(semitones));
  const oct = Math.floor(s / 12);
  const rest = s % 12;
  if (oct === 0) return `${rest} semiton`;
  return rest === 0 ? `${oct} oktaf` : `${oct} oktaf + ${rest} semiton`;
}

// ───────────────────────── Segmentasi nada ─────────────────────────

export interface NoteSegment {
  midi: number;
  /** Detik sejak awal sesi. */
  start: number;
  duration: number;
  /** Rata-rata penyimpangan dari nada tepat, dalam cent. */
  avgCents: number;
}

/**
 * Merangkai frame pitch (≈ tiap 50-80 ms) menjadi segmen nada.
 * - Histeresis: frame dianggap nada yang sama selama masih dalam ±65 cent dari nada berjalan (vibrato aman).
 * - Perpindahan nada butuh 2 frame berturut-turut (menolak glitch 1 frame, mis. lompatan oktaf sesaat).
 * - Senyap/tidak bernada lebih dari `gapSec` menutup segmen.
 */
export class NoteSegmenter {
  readonly segments: NoteSegment[] = [];
  private cur: { midi: number; start: number; last: number; centsSum: number; n: number } | null = null;
  private pending: { midi: number; t: number; cents: number; count: number } | null = null;
  constructor(private readonly minDur = 0.12, private readonly gapSec = 0.18, private readonly a4 = 440) {}

  feed(t: number, freq: number | null) {
    if (freq === null) {
      if (this.cur && t - this.cur.last > this.gapSec) this.close();
      this.pending = null;
      return;
    }
    const m = freqToMidi(freq, this.a4);
    const r = Math.round(m);
    const cents = (m - r) * 100;
    if (!this.cur) { this.open(r, t, m); return; }
    if (t - this.cur.last > this.gapSec) { this.close(); this.open(r, t, m); return; }
    if (Math.abs(m - this.cur.midi) <= 0.65) {
      this.cur.last = t; this.cur.n++; this.cur.centsSum += (m - this.cur.midi) * 100; this.pending = null;
      return;
    }
    if (this.pending && this.pending.midi === r) this.pending.count++;
    else this.pending = { midi: r, t, cents, count: 1 };
    if (this.pending.count >= 2) {
      const start = this.pending.t;
      this.close(start);
      this.open(r, start, m);
      this.cur!.last = t; this.pending = null;
    }
  }

  private open(midi: number, t: number, m: number) {
    this.cur = { midi, start: t, last: t, centsSum: (m - midi) * 100, n: 1 };
  }
  private close(endAt?: number) {
    const c = this.cur; this.cur = null;
    if (!c) return;
    const end = endAt ?? c.last;
    const duration = Math.max(0, end - c.start) + (endAt === undefined ? 0.06 : 0); // frame terakhir punya lebar
    if (duration >= this.minDur) this.segments.push({ midi: c.midi, start: c.start, duration, avgCents: c.centsSum / c.n });
  }
  /** Tutup segmen yang masih berjalan dan kembalikan semua segmen. */
  finish(): NoteSegment[] { this.close(); this.pending = null; return this.segments; }
  /** Nada yang sedang berjalan (untuk tampilan langsung). */
  get currentMidi() { return this.cur?.midi ?? null; }
}

// ───────────────────────── Nada stabil (untuk tes vocal range) ─────────────────────────

/**
 * Menerima frame pitch dan menyatakan sebuah nada "stabil" setelah ditahan `needFrames` frame berturut-turut pada
 * nada (dibulatkan) yang sama dengan kejernihan tinggi. Mencegah lompatan oktaf sesaat / desis / napas dihitung
 * sebagai nada tertinggi/terendah.
 */
export class StableNoteDetector {
  private run = 0;
  private midi: number | null = null;
  constructor(private readonly needFrames = 7, private readonly minClarity = 0.9, private readonly a4 = 440) {}
  reset() { this.run = 0; this.midi = null; }
  /** Mengembalikan MIDI nada stabil, atau null bila belum stabil. */
  feed(freq: number | null, clarity: number): number | null {
    if (freq === null || clarity < this.minClarity) { this.reset(); return null; }
    const m = freqToMidi(freq, this.a4);
    const r = Math.round(m);
    if (this.midi !== null && (r === this.midi || Math.abs(m - this.midi) <= 0.6)) this.run++;
    else { this.midi = r; this.run = 1; }
    return this.run >= this.needFrames ? this.midi : null;
  }
  get progress() { return Math.min(1, this.run / this.needFrames); }
  get candidate() { return this.midi; }
}

// ───────────────────────── Kunci nada dari nyanyian ─────────────────────────

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]; // Krumhansl-Kessler
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]) {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : 0;
}

export interface SungKey { name: string; tonicPc: number; minor: boolean; relative: string; confidence: number }

/** Perkirakan kunci dari nada-nada yang dinyanyikan (dibobot durasi). null bila data kurang (<4 nada atau <3 kelas nada). */
export function estimateKey(segments: NoteSegment[]): SungKey | null {
  const hist = new Array(12).fill(0);
  let count = 0;
  for (const s of segments) { hist[pcOf(s.midi)] += s.duration; count++; }
  if (count < 4 || hist.filter((v) => v > 0).length < 3) return null;
  const scores: { pc: number; minor: boolean; r: number }[] = [];
  for (let pc = 0; pc < 12; pc++) {
    const rot = (p: number[]) => Array.from({ length: 12 }, (_, i) => p[(i - pc + 12) % 12]);
    scores.push({ pc, minor: false, r: corr(hist, rot(MAJOR)) }, { pc, minor: true, r: corr(hist, rot(MINOR)) });
  }
  scores.sort((a, b) => b.r - a.r);
  const top = scores[0], second = scores[1];
  const relPc = top.minor ? (top.pc + 3) % 12 : (top.pc + 9) % 12;
  return {
    name: `${KEY_NAMES[top.pc]} ${top.minor ? 'minor' : 'mayor'}`,
    tonicPc: top.pc,
    minor: top.minor,
    relative: `${KEY_NAMES[relPc]} ${top.minor ? 'mayor' : 'minor'}`,
    confidence: Math.max(0, Math.min(1, top.r > 0 ? (top.r - Math.max(0, second.r)) * 4 + top.r * 0.4 : 0)),
  };
}

// ───────────────────────── Ringkasan sesi ─────────────────────────

export interface SessionSummary {
  noteCount: number;
  lowest: NoteSegment | null;
  highest: NoteSegment | null;
  /** Nada (kelas nada + oktaf) yang paling lama dinyanyikan. */
  mostSung: { midi: number; seconds: number } | null;
  totalSungSeconds: number;
  /** Rata-rata |cent| tertimbang durasi: seberapa dekat dengan nada tepat. */
  avgAbsCents: number;
  key: SungKey | null;
}

export function summarize(segments: NoteSegment[]): SessionSummary {
  let lowest: NoteSegment | null = null, highest: NoteSegment | null = null;
  const byMidi = new Map<number, number>();
  let total = 0, centsW = 0;
  for (const s of segments) {
    if (!lowest || s.midi < lowest.midi) lowest = s;
    if (!highest || s.midi > highest.midi) highest = s;
    byMidi.set(s.midi, (byMidi.get(s.midi) ?? 0) + s.duration);
    total += s.duration; centsW += Math.abs(s.avgCents) * s.duration;
  }
  let most: { midi: number; seconds: number } | null = null;
  byMidi.forEach((sec, midi) => { if (!most || sec > most.seconds) most = { midi, seconds: sec }; });
  return {
    noteCount: segments.length, lowest, highest, mostSung: most, totalSungSeconds: total,
    avgAbsCents: total > 0 ? centsW / total : 0, key: estimateKey(segments),
  };
}

// ───────────────────────── Jenis suara ─────────────────────────

export interface VoiceType {
  id: string;
  name: string;
  /** Rentang baku paduan suara (MIDI), notasi ilmiah. */
  low: number;
  high: number;
  desc: string;
}

export const VOICE_TYPES: VoiceType[] = [
  { id: 'bass', name: 'Bass', low: 40, high: 64, desc: 'Suara pria paling rendah, berat dan dalam (E2–E4).' },
  { id: 'baritone', name: 'Bariton', low: 45, high: 69, desc: 'Suara pria menengah, paling umum pada pria (A2–A4).' },
  { id: 'tenor', name: 'Tenor', low: 48, high: 72, desc: 'Suara pria tinggi, terang (C3–C5).' },
  { id: 'countertenor', name: 'Kontratenor', low: 52, high: 76, desc: 'Suara pria sangat tinggi dengan register kepala, setara alto/mezzo (E3–E5).' },
  { id: 'alto', name: 'Alto', low: 53, high: 77, desc: 'Suara wanita rendah, hangat (F3–F5).' },
  { id: 'mezzo', name: 'Mezzo-sopran', low: 57, high: 81, desc: 'Suara wanita menengah, paling umum pada wanita (A3–A5).' },
  { id: 'soprano', name: 'Sopran', low: 60, high: 84, desc: 'Suara wanita tinggi, cerah (C4–C6).' },
];

export interface VoiceMatch { type: VoiceType; /** 0..1: irisan rentang ÷ gabungan rentang (dalam semiton). */ fit: number }

/** Urutkan jenis suara berdasarkan seberapa besar rentang pengguna beririsan dengan rentang baku. */
export function classifyVoice(low: number, high: number): VoiceMatch[] {
  const lo = Math.min(low, high), hi = Math.max(low, high);
  return VOICE_TYPES.map((t) => {
    const inter = Math.max(0, Math.min(hi, t.high) - Math.max(lo, t.low));
    const union = Math.max(hi, t.high) - Math.min(lo, t.low);
    // Selaraskan juga titik tengah: dua rentang beririsan sama besar tapi tengahnya berjauhan jangan seri.
    const centerGap = Math.abs((lo + hi) / 2 - (t.low + t.high) / 2);
    const fit = union > 0 ? Math.max(0, inter / union - centerGap * 0.005) : 0;
    return { type: t, fit };
  }).sort((a, b) => b.fit - a.fit);
}

/**
 * Wilayah nyaman (tessitura). Dari nada yang benar-benar dinyanyikan bila ada (persentil 10-90 tertimbang durasi),
 * bila tidak diperkirakan sebagai 60% bagian tengah rentang.
 */
export function tessituraFrom(low: number, high: number, weighted?: Map<number, number>): { low: number; high: number; measured: boolean } {
  if (weighted && weighted.size >= 3) {
    const entries = [...weighted.entries()].sort((a, b) => a[0] - b[0]);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    if (total > 0) {
      let acc = 0, lo = entries[0][0], hi = entries[entries.length - 1][0];
      let gotLo = false;
      for (const [m, w] of entries) {
        acc += w;
        if (!gotLo && acc / total >= 0.1) { lo = m; gotLo = true; }
        if (acc / total >= 0.9) { hi = m; break; }
      }
      if (hi > lo) return { low: Math.max(low, lo), high: Math.min(high, hi), measured: true };
    }
  }
  const span = high - low;
  return { low: Math.round(low + span * 0.2), high: Math.round(high - span * 0.2), measured: false };
}

// ───────────────────────── Latihan pemanasan ─────────────────────────

export interface WarmUp { id: string; name: string; desc: string; /** Semiton dari nada awal. */ steps: number[]; }

export const WARMUPS: WarmUp[] = [
  { id: 'triad', name: 'Arpeggio mayor (1-3-5-3-1)', desc: 'Melatih lompatan nada dan intonasi pada akor mayor.', steps: [0, 4, 7, 4, 0] },
  { id: 'five', name: 'Lima nada tangga nada (1-2-3-4-5-4-3-2-1)', desc: 'Pemanasan klasik: naik dan turun selangkah demi selangkah.', steps: [0, 2, 4, 5, 7, 5, 4, 2, 0] },
  { id: 'octave', name: 'Arpeggio satu oktaf (1-3-5-8-5-3-1)', desc: 'Melatih jangkauan dan transisi register (butuh rentang minimal 1 oktaf).', steps: [0, 4, 7, 12, 7, 4, 0] },
];

/** Nada awal tertinggi yang membuat seluruh latihan tetap di dalam wilayah nyaman; null bila tidak muat. */
export function warmupStart(w: WarmUp, tessLow: number, tessHigh: number): number | null {
  const top = Math.max(...w.steps);
  const start = tessLow;
  return start + top <= tessHigh ? start : null;
}
