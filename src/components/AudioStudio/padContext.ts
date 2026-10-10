// src/components/AudioStudio/padContext.ts
// Konstanta Pad Studio yang MURNI (tanpa React / Web Audio) dan dipakai BERSAMA oleh browser dan server.
// Server (server/padEditorRoutes.ts) memakai ini untuk memvalidasi proyek dengan aturan yang sama persis dengan editor.

import { ChordFormulaDef, EnvelopeADSR, NOTE_ROOTS } from '../../services/chordTheory';
import type { Adsr4, ImportContext, Range4 } from './midiProject';

export type AdsrRanges = {
  attack: [number, number];
  decay: [number, number];
  sustain: [number, number];
  release: [number, number];
};

export const DRUM_IDS = ['kick', 'snare', 'clap', 'closedhat', 'openhat', 'tom', 'splash', 'ride', 'perc', 'fx'] as const;

export const DRUM_KITS = [
  '80s Kit',
  'Ambient',
  'Industrial',
  'Breakbeat',
  'Jazzy',
  'Electro',
  'Hiphop',
];

export const TOTAL_BARS = 64;


export interface TimeSignatureDef {
  id: string;
  label: string;
  num: number;
  den: number;
  groups: number[];
}

export const TIME_SIGNATURES: TimeSignatureDef[] = [
  { id: '2/4', label: '2/4', num: 2, den: 4, groups: [4, 4] },
  { id: '3/4', label: '3/4', num: 3, den: 4, groups: [4, 4, 4] },
  { id: '4/4', label: '4/4', num: 4, den: 4, groups: [4, 4, 4, 4] },
  { id: '5/4', label: '5/4', num: 5, den: 4, groups: [4, 4, 4, 4, 4] },
  { id: '2/2', label: '2/2', num: 2, den: 2, groups: [8, 8] },
  { id: '3/8', label: '3/8', num: 3, den: 8, groups: [6] },
  { id: '5/8', label: '5/8', num: 5, den: 8, groups: [4, 6] },
  { id: '6/8', label: '6/8', num: 6, den: 8, groups: [6, 6] },
  { id: '7/8', label: '7/8', num: 7, den: 8, groups: [4, 4, 6] },
  { id: '9/8', label: '9/8', num: 9, den: 8, groups: [6, 6, 6] },
  { id: '12/8', label: '12/8', num: 12, den: 8, groups: [6, 6, 6, 6] },
];

export const getTimeSig = (id: string): TimeSignatureDef => TIME_SIGNATURES.find((t) => t.id === id) ?? TIME_SIGNATURES[2];
export const stepsPerBarOf = (ts: TimeSignatureDef): number => ts.groups.reduce((a, b) => a + b, 0);



export const defaultBarsPerView = (stepsPerBar: number) => Math.max(1, Math.min(8, Math.round(32 / stepsPerBar)));
export const BARS_PER_VIEW_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8];

export const BASE_PADS: ChordFormulaDef[] = [
    { root: 'A', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'F', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'C', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'G', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'D', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'E', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'Bb', type: 'maj', tension: 'none', bass: 'none', inversion: 1, octaveOffset: 0 },
    { root: 'E', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'C', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'G', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'F', type: 'maj', tension: 'maj7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'D', type: 'min', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'A', type: 'min', tension: '7', bass: 'none', inversion: 1, octaveOffset: 0 },
    { root: 'Eb', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'Bb', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: -1 },
    { root: 'G', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
  ];

export const BANK_SEMITONES = [0, 5, 7, 2, 10, 3, 8, 4]; // Am, Dm, Em, Bm, Gm, Cm, Fm, C#m
const transposeNote = (note: string | undefined, semis: number): string | undefined => {
  if (!note || note === 'none') return note;
  const i = NOTE_ROOTS.indexOf(note);
  return i < 0 ? note : NOTE_ROOTS[(i + semis) % 12];
};
export const makeDefaultPadChords = (): ChordFormulaDef[] =>
  BANK_SEMITONES.flatMap((semis) =>
    BASE_PADS.map((c) => ({ ...c, root: transposeNote(c.root, semis) as string, bass: transposeNote(c.bass, semis) }))
  );


export const DEFAULT_DRUM_ADSR: EnvelopeADSR = { attack: 0.002, decay: 0.15, sustain: 0.3, release: 0.12 };
export const DRUM_ADSR_RANGES: AdsrRanges = {
  attack: [0.001, 0.1],
  decay: [0.01, 2],
  sustain: [0, 1],
  release: [0.02, 2],
};
export const CHORD_ADSR_RANGES: AdsrRanges = {
  attack: [0.005, 5],
  decay: [0.02, 5],
  sustain: [0, 1],
  release: [0.05, 10],
};


// Konteks validasi/konversi untuk impor MIDI (nilai-nilai yang dimiliki Pad Studio).
export const adsrTuple = (a: EnvelopeADSR): Adsr4 => [a.attack, a.decay, a.sustain, a.release];
export const rangesTuple = (r: AdsrRanges): Range4 => [r.attack, r.decay, r.sustain, r.release];
export const IMPORT_CTX: ImportContext = {
  drumIds: [...DRUM_IDS],
  totalBars: TOTAL_BARS,
  timeSigs: TIME_SIGNATURES.map((t) => ({ id: t.id, num: t.num, den: t.den, steps: stepsPerBarOf(t) })),
  kits: DRUM_KITS,
  defaultKit: DRUM_KITS[0],
  barsPerViewOptions: BARS_PER_VIEW_OPTIONS,
  defaultBarsPerView,
  defaultPads: makeDefaultPadChords(),
  drumAdsr: adsrTuple(DEFAULT_DRUM_ADSR),
  drumAdsrRanges: rangesTuple(DRUM_ADSR_RANGES),
  chordAdsrRanges: rangesTuple(CHORD_ADSR_RANGES),
  chordDefaults: [
    { label: 'Progresi Akor 1', program: 0, volume: 80, adsr: [0.02, 0.25, 0.65, 0.35] },
    { label: 'Progresi Akor 2', program: 12, volume: 65, adsr: [0.05, 0.4, 0.8, 0.9] },
    { label: 'Progresi Akor 3', program: 48, volume: 70, adsr: [0.1, 0.5, 0.75, 1.2] },
    { label: 'Progresi Akor 4', program: 32, volume: 75, adsr: [0.03, 0.3, 0.7, 0.8] },
  ],
  bpmRange: [60, 300],
};
