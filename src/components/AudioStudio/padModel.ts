// src/components/AudioStudio/padModel.ts
// Model data & fungsi murni untuk Step Sequencer (dinamika drum, panjang not akor, seleksi/clipboard).

// ---------------------------------------------------------------------------
// DINAMIKA (drum dan akor memakai skala yang sama)
// Skala dasar 6 tingkat: 0 = kosong, 1 = pp, 2 = p, 3 = mp, 4 = mf, 5 = f, 6 = ff.
// Pengguna memilih berapa tingkat yang dipakai (6 / 4 / 2). Data selalu disimpan di skala 6 tingkat; mode 4 dan 2 hanya
// membatasi pilihan ("palet") dan membulatkan nilai lain ke tingkat terdekat saat ditampilkan / dibunyikan, jadi pindah
// mode tidak menghilangkan data.
//   6 tingkat: pp, p, mp, mf, f, ff
//   4 tingkat: p, mp, mf, f
//   2 tingkat: p, f
// ---------------------------------------------------------------------------
export const DRUM_LEVEL_MAX = 6;
// Saat dinamika dimatikan, semua pukulan dibunyikan pada level ini (forte).
export const DRUM_FLAT_LEVEL = 5;
// Level bawaan untuk pad yang ditekan tanpa tombol dinamika (forte, sama seperti sebelumnya).
export const DEFAULT_LIVE_LEVEL = 5;
export const DRUM_LEVEL_LABEL = ['Kosong', 'Pianissimo', 'Piano', 'Mezzo piano', 'Mezzo forte', 'Forte', 'Fortissimo'] as const;
export const DRUM_LEVEL_SHORT = ['', 'pp', 'p', 'mp', 'mf', 'f', 'ff'] as const;
export const DRUM_LEVEL_DESC = ['', 'Sangat pelan', 'Pelan', 'Agak pelan', 'Agak keras', 'Keras', 'Sangat keras'] as const;
// Pengali volume (dikalikan volume drum utama) dan velocity MIDI untuk tiap level.
export const DRUM_LEVEL_GAIN = [0, 0.3, 0.45, 0.6, 0.75, 0.88, 1] as const;
export const DRUM_LEVEL_MIDI = [0, 35, 55, 75, 95, 112, 127] as const;
// Pengali volume akor live untuk tiap level.
export const CHORD_LEVEL_GAIN = [0, 0.35, 0.5, 0.65, 0.8, 0.92, 1] as const;
// Warna pad: makin keras makin pekat.
export const DRUM_LEVEL_CELL_CLASS = [
  '',
  'bg-accent/20 border border-accent/30',
  'bg-accent/30 border border-accent/40',
  'bg-accent/40 border border-accent/50',
  'bg-accent/60 border border-accent/70',
  'bg-accent/80 border border-accent/90',
  'bg-accent border border-accent shadow-xs',
] as const;

export const clampLevel = (v: unknown): number => {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(DRUM_LEVEL_MAX, n));
};

export type DynMode = 2 | 4 | 6;
export const DYN_MODES: DynMode[] = [6, 4, 2];
export const clampDynMode = (v: unknown): DynMode => {
  const n = Number(v);
  return n === 2 || n === 4 ? n : 6;
};
// Tingkat yang tersedia di tiap mode (dari paling pelan ke paling keras).
export const DYN_PALETTE: Record<DynMode, number[]> = {
  6: [1, 2, 3, 4, 5, 6],
  4: [2, 3, 4, 5],
  2: [2, 5],
};

// Bulatkan level ke tingkat terdekat di palet mode (0 tetap 0).
export const snapLevel = (level: number, mode: DynMode): number => {
  if (!(level > 0)) return 0;
  const pal = DYN_PALETTE[mode];
  let best = pal[0];
  for (const p of pal) if (Math.abs(p - level) < Math.abs(best - level)) best = p;
  return best;
};

// Klik pad: kosong -> tingkat terendah palet -> ... -> tingkat tertinggi -> kosong.
export const nextLevelInPalette = (level: number, mode: DynMode): number => {
  const cur = snapLevel(level, mode);
  if (cur === 0) return DYN_PALETTE[mode][0];
  const pal = DYN_PALETTE[mode];
  const i = pal.indexOf(cur);
  return i >= 0 && i < pal.length - 1 ? pal[i + 1] : 0;
};

// Data proyek lama memakai skala 4 tingkat (1 pp, 2 p, 3 f, 4 ff): petakan ke skala baru.
export const legacyLevel = (v: number): number => (v === 3 ? 5 : v === 4 ? 6 : v);

// ---------------------------------------------------------------------------
// TOMBOL DINAMIKA KEYBOARD (ditahan lalu tekan pad)
//   Drum : ,  <  .  >  /  ?   = pp p mp mf f ff   (<  >  ?  = tombol yang sama + Shift KIRI)
//   Akor : [  {  ]  }  \  |   = pp p mp mf f ff   ({  }  |  = tombol yang sama + Shift KANAN)
// Mode 4 tingkat memakai 4 simbol pertama (p mp mf f); mode 2 tingkat hanya simbol tanpa Shift (p dan f).
// ---------------------------------------------------------------------------
export type DynKeyKind = 'drum' | 'chord';
export const DYN_KEY_CODES: Record<DynKeyKind, string[]> = {
  drum: ['Comma', 'Period', 'Slash'],
  chord: ['BracketLeft', 'BracketRight', 'Backslash'],
};
export const DYN_KEY_SYMBOLS: Record<DynKeyKind, string[]> = {
  drum: [',', '<', '.', '>', '/', '?'],
  chord: ['[', '{', ']', '}', '\\', '|'],
};
const DYN_SLOTS: Record<DynMode, number[]> = {
  6: [0, 1, 2, 3, 4, 5],
  4: [0, 1, 2, 3],
  2: [0, 2],
};

// Level untuk tombol dinamika `code` (dengan / tanpa Shift sisi yang sesuai). 0 = tombol tidak dipakai di mode ini.
export function dynLevelForKey(kind: DynKeyKind, code: string, shifted: boolean, mode: DynMode): number {
  const ci = DYN_KEY_CODES[kind].indexOf(code);
  if (ci < 0) return 0;
  const pos = DYN_SLOTS[mode].indexOf(ci * 2 + (shifted ? 1 : 0));
  return pos < 0 ? 0 : DYN_PALETTE[mode][pos];
}

// Daftar pasangan simbol = tingkat untuk mode ini, mis. ", = pp   < = p   . = mp ...".
export function dynKeyGuide(kind: DynKeyKind, mode: DynMode): string {
  const sym = DYN_KEY_SYMBOLS[kind];
  return DYN_SLOTS[mode].map((s, i) => `${sym[s]} = ${DRUM_LEVEL_SHORT[DYN_PALETTE[mode][i]]}`).join('   ');
}

// ---------------------------------------------------------------------------
// NOT AKOR BERPANJANG
// Tiap track punya dua array sejajar: steps[i] = indeks pad akor yang DIMULAI di step i (-1 = kosong),
// lens[i] = panjang not itu dalam step (0 jika tidak ada not). Not tidak boleh saling tumpang tindih.
// ---------------------------------------------------------------------------
export interface ChordNote {
  start: number;
  len: number;
  pad: number;
}

// vels[i] = dinamika not yang dimulai di step i (1..6 = pp..ff; 0 = tidak ditentukan, dibunyikan dengan volume normal).
export const emptyTrackData = (total: number) => ({
  steps: Array<number>(total).fill(-1),
  lens: Array<number>(total).fill(0),
  vels: Array<number>(total).fill(0),
});

// Pengali volume not akor dari dinamikanya (0 = tidak ditentukan = volume normal).
export const noteGain = (vel: number | undefined, mode?: DynMode): number => {
  const lv = clampLevel(vel);
  if (lv === 0) return 1;
  return CHORD_LEVEL_GAIN[mode ? snapLevel(lv, mode) : lv];
};

// Rapikan lens: panjang minimal 1, tidak melewati akhir grid, dan tidak menimpa not berikutnya.
export function normalizeLens(steps: number[], lens: number[]): number[] {
  const total = steps.length;
  const out = Array<number>(total).fill(0);
  let prev = -1;
  for (let i = 0; i < total; i++) {
    if (steps[i] < 0) continue;
    out[i] = Math.max(1, Math.min(Math.round(lens[i] || 1), total - i));
    if (prev >= 0 && prev + out[prev] > i) out[prev] = i - prev;
    prev = i;
  }
  return out;
}

export function listNotes(steps: number[], lens: number[]): ChordNote[] {
  const notes: ChordNote[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i] >= 0) notes.push({ start: i, len: Math.max(1, lens[i] || 1), pad: steps[i] });
  }
  return notes;
}

// Awal not yang menutupi step `s` (termasuk not yang dimulai tepat di `s`), atau -1.
export function noteStartCovering(steps: number[], lens: number[], s: number): number {
  for (let j = Math.min(s, steps.length - 1); j >= 0; j--) {
    if (steps[j] >= 0) return j + Math.max(1, lens[j] || 1) > s ? j : -1;
  }
  return -1;
}

const nextNoteStart = (steps: number[], after: number): number => {
  for (let k = after + 1; k < steps.length; k++) if (steps[k] >= 0) return k;
  return steps.length;
};

// Sisipkan not. Not sebelumnya yang menutupi `start` dipotong, panjang dibatasi sampai not berikutnya.
export function insertNote(
  steps: number[],
  lens: number[],
  start: number,
  pad: number,
  len: number,
  vels?: number[],
  vel = 0
): { steps: number[]; lens: number[]; vels: number[] } {
  const s2 = [...steps];
  const l2 = [...lens];
  const v2 = vels ? [...vels] : Array<number>(steps.length).fill(0);
  const cs = noteStartCovering(s2, l2, start - 1);
  if (cs >= 0 && cs < start) l2[cs] = start - cs;
  const limit = nextNoteStart(s2, start) - start;
  s2[start] = pad;
  l2[start] = Math.max(1, Math.min(len, limit));
  v2[start] = clampLevel(vel);
  return { steps: s2, lens: l2, vels: v2 };
}

export function removeNote(steps: number[], lens: number[], start: number, vels?: number[]) {
  const s2 = [...steps];
  const l2 = [...lens];
  const v2 = vels ? [...vels] : Array<number>(steps.length).fill(0);
  s2[start] = -1;
  l2[start] = 0;
  v2[start] = 0;
  return { steps: s2, lens: l2, vels: v2 };
}

// Ubah panjang not (dibatasi sampai not berikutnya / akhir grid, minimal 1 step).
export function resizeNote(steps: number[], lens: number[], start: number, newLen: number) {
  if (steps[start] < 0) return { steps, lens };
  const limit = nextNoteStart(steps, start) - start;
  const l2 = [...lens];
  l2[start] = Math.max(1, Math.min(Math.round(newLen), limit));
  return { steps, lens: l2 };
}

// Pindahkan isi grid ke birama baru (tiap bar disalin step demi step, yang melebihi bar baru terpotong).
export function remapTrackData(
  steps: number[],
  lens: number[],
  oldS: number,
  newS: number,
  totalBars: number,
  vels?: number[]
): { steps: number[]; lens: number[]; vels: number[] } {
  const total = newS * totalBars;
  const ns = Array<number>(total).fill(-1);
  const nl = Array<number>(total).fill(0);
  const nv = Array<number>(total).fill(0);
  const n = Math.min(oldS, newS);
  for (let bar = 0; bar < totalBars; bar++) {
    for (let i = 0; i < n; i++) {
      const v = steps[bar * oldS + i];
      if (v !== undefined && v >= 0) {
        ns[bar * newS + i] = v;
        nl[bar * newS + i] = lens[bar * oldS + i] || 1;
        nv[bar * newS + i] = clampLevel(vels?.[bar * oldS + i]);
      }
    }
  }
  return { steps: ns, lens: normalizeLens(ns, nl), vels: nv };
}

// ---------------------------------------------------------------------------
// SELEKSI & CLIPBOARD
// ---------------------------------------------------------------------------
export type SeqTab = 'drum' | 'chord';

export interface SelRect {
  tab: SeqTab;
  r1: number;
  r2: number;
  s1: number;
  s2: number;
}

export interface DrumClip {
  kind: 'drum';
  rows: number;
  width: number;
  data: number[][]; // [baris][step] = level 0..6
  // Sel mana yang ikut disalin (pilihan boleh terpisah-pisah). Tanpa mask = seluruh persegi panjang.
  mask?: boolean[][];
}

export interface ChordClip {
  kind: 'chord';
  rows: number;
  width: number;
  data: Array<Array<{ pad: number; len: number; vel?: number } | null>>; // [track][step]
  mask?: boolean[][];
}

export type SeqClip = DrumClip | ChordClip;

export const makeRect = (tab: SeqTab, a: { r: number; s: number }, b: { r: number; s: number }): SelRect => ({
  tab,
  r1: Math.min(a.r, b.r),
  r2: Math.max(a.r, b.r),
  s1: Math.min(a.s, b.s),
  s2: Math.max(a.s, b.s),
});


// ---------------------------------------------------------------------------
// PILIHAN BERPENCAR (multi-select)
// Pilihan disimpan sebagai himpunan sel: kunci = baris * CELL_STRIDE + step. Dengan begitu pad yang
// tidak berdekatan bisa dipilih bersamaan (mode "Pilih+"), dan tiap pad bisa dipilih / dilepas satu per satu.
// Untuk akor, kunci sel selalu menunjuk AWAL not (not yang menutupi sebuah step diwakili step awalnya).
// ---------------------------------------------------------------------------
export interface Selection {
  tab: SeqTab;
  cells: ReadonlySet<number>;
}

export const CELL_STRIDE = 2048; // > jumlah step maksimum (12/8 x 64 bar = 1536)
export const cellKey = (row: number, step: number): number => row * CELL_STRIDE + step;
export const cellRow = (key: number): number => Math.floor(key / CELL_STRIDE);
export const cellStep = (key: number): number => key % CELL_STRIDE;

// Kotak pembatas terkecil yang memuat semua sel terpilih (null bila kosong).
export function selectionBounds(cells: ReadonlySet<number>): { r1: number; r2: number; s1: number; s2: number } | null {
  if (cells.size === 0) return null;
  let r1 = Infinity;
  let r2 = -Infinity;
  let s1 = Infinity;
  let s2 = -Infinity;
  cells.forEach((k) => {
    const r = cellRow(k);
    const s = cellStep(k);
    if (r < r1) r1 = r;
    if (r > r2) r2 = r;
    if (s < s1) s1 = s;
    if (s > s2) s2 = s;
  });
  return { r1, r2, s1, s2 };
}

// Kelompokkan sel terpilih per baris (step terurut naik).
export function groupCellsByRow(cells: ReadonlySet<number>): Map<number, number[]> {
  const map = new Map<number, number[]>();
  cells.forEach((k) => {
    const r = cellRow(k);
    const list = map.get(r);
    if (list) list.push(cellStep(k));
    else map.set(r, [cellStep(k)]);
  });
  map.forEach((list) => list.sort((a, b) => a - b));
  return map;
}
