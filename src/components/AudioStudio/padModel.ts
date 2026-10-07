// src/components/AudioStudio/padModel.ts
// Model data & fungsi murni untuk Step Sequencer (dinamika drum, panjang not akor, seleksi/clipboard).

// ---------------------------------------------------------------------------
// DINAMIKA DRUM: 0 = tidak ada, 1 = pianissimo (pp), 2 = piano (p), 3 = forte (f), 4 = fortissimo (ff)
// ---------------------------------------------------------------------------
export const DRUM_LEVEL_MAX = 4;
// Saat dinamika dimatikan, semua pukulan dibunyikan pada level ini (forte = velocity MIDI 100, volume normal).
export const DRUM_FLAT_LEVEL = 3;
export const DRUM_LEVEL_LABEL = ['Kosong', 'Pianissimo', 'Piano', 'Forte', 'Fortissimo'] as const;
export const DRUM_LEVEL_SHORT = ['', 'pp', 'p', 'f', 'ff'] as const;
export const DRUM_LEVEL_DESC = ['', 'Sangat pelan', 'Pelan', 'Keras', 'Sangat keras'] as const;
// Pengali volume (dikalikan volume drum utama) dan velocity MIDI untuk tiap level.
export const DRUM_LEVEL_GAIN = [0, 0.4, 0.65, 0.85, 1] as const;
export const DRUM_LEVEL_MIDI = [0, 45, 75, 100, 127] as const;
// Warna pad: makin keras makin pekat (opacity memakai skala bawaan Tailwind: 30/50/75/100).
export const DRUM_LEVEL_CELL_CLASS = [
  '',
  'bg-accent/30 border border-accent/40',
  'bg-accent/50 border border-accent/60',
  'bg-accent/75 border border-accent/80',
  'bg-accent border border-accent shadow-xs',
] as const;

export const clampLevel = (v: unknown): number => {
  const n = Math.round(Number(v) || 0);
  return Math.max(0, Math.min(DRUM_LEVEL_MAX, n));
};

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

export const emptyTrackData = (total: number) => ({
  steps: Array<number>(total).fill(-1),
  lens: Array<number>(total).fill(0),
});

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
  len: number
): { steps: number[]; lens: number[] } {
  const s2 = [...steps];
  const l2 = [...lens];
  const cs = noteStartCovering(s2, l2, start - 1);
  if (cs >= 0 && cs < start) l2[cs] = start - cs;
  const limit = nextNoteStart(s2, start) - start;
  s2[start] = pad;
  l2[start] = Math.max(1, Math.min(len, limit));
  return { steps: s2, lens: l2 };
}

export function removeNote(steps: number[], lens: number[], start: number) {
  const s2 = [...steps];
  const l2 = [...lens];
  s2[start] = -1;
  l2[start] = 0;
  return { steps: s2, lens: l2 };
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
  totalBars: number
): { steps: number[]; lens: number[] } {
  const total = newS * totalBars;
  const ns = Array<number>(total).fill(-1);
  const nl = Array<number>(total).fill(0);
  const n = Math.min(oldS, newS);
  for (let bar = 0; bar < totalBars; bar++) {
    for (let i = 0; i < n; i++) {
      const v = steps[bar * oldS + i];
      if (v !== undefined && v >= 0) {
        ns[bar * newS + i] = v;
        nl[bar * newS + i] = lens[bar * oldS + i] || 1;
      }
    }
  }
  return { steps: ns, lens: normalizeLens(ns, nl) };
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
  data: number[][]; // [baris][step] = level 0..4
  // Sel mana yang ikut disalin (pilihan boleh terpisah-pisah). Tanpa mask = seluruh persegi panjang.
  mask?: boolean[][];
}

export interface ChordClip {
  kind: 'chord';
  rows: number;
  width: number;
  data: Array<Array<{ pad: number; len: number } | null>>; // [track][step]
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

export const CELL_STRIDE = 2048; // > jumlah step maksimum (12/8 x 16 bar = 384)
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
