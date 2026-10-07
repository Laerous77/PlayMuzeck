// src/components/AudioStudio/PadStudio.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Lock,
  RotateCcw,
  Repeat,
  Music,
  Download,
  Plus,
  Minus,
  Volume2,
  Disc,
  Sliders,
  X,
  Check,
  Activity,
  ChevronLeft,
  ChevronRight,
  Drum,
  Layers,
  Square,
  ChevronDown,
  Copy,
  Scissors,
  ClipboardPaste,
  CopyPlus,
  Trash2,
  Pencil,
  BoxSelect,
  SlidersHorizontal,
  Undo2,
  Redo2,
  Info,
  Gauge,
  Circle,
  Save,
  FolderOpen,
} from 'lucide-react';
import { AudioEntitlements } from '../../types';
import {
  audioEngine,
  INSTRUMENTS_128,
  NOTE_ROOTS,
  CHORD_QUALITIES,
  CHORD_TENSIONS,
  CHORD_INVERSIONS,
  ChordFormulaDef,
  EnvelopeADSR,
  buildHarmonicChord,
  SOUND_BANK_READY_MESSAGE,
} from '../../services/audioEngine';
import { ExportPatternModal, ChordTrackExportData } from './ExportPatternModal';
import { downloadBlob } from '../../services/exporters';
import {
  PadProject,
  ImportContext,
  Adsr4,
  Range4,
  padToTuple,
  tupleToPad,
  encodeProjectPayload,
  projectToMidiBlob,
  importMidiBuffer,
} from './midiProject';
import { ModalPortal } from './ModalPortal';
import { AdsrMini, AdsrRanges, IntField } from './NumberFields';
import { InstrumentPickerModal } from './InstrumentPickerModal';
import {
  DRUM_LEVEL_MAX,
  DRUM_LEVEL_LABEL,
  DRUM_LEVEL_SHORT,
  DRUM_LEVEL_DESC,
  DRUM_LEVEL_GAIN,
  DRUM_LEVEL_CELL_CLASS,
  DRUM_FLAT_LEVEL,
  clampLevel,
  emptyTrackData,
  normalizeLens,
  listNotes,
  noteStartCovering,
  insertNote,
  removeNote,
  resizeNote,
  remapTrackData,
  cellKey,
  cellRow,
  cellStep,
  selectionBounds,
  groupCellsByRow,
  ChordNote,
  Selection,
  SeqClip,
  DrumClip,
  ChordClip,
} from './padModel';

interface PadStudioProps {
  entitlements: AudioEntitlements;
  onUnlockEditor: () => void;
  onSuccessToast: (msg: string) => void;
}

type PadTab = 'drum' | 'chord';
// edit = pasang/ubah pad; select = pilih area (pilihan lama diganti); selectAdd = tambah pad ke pilihan tanpa melepas yang lama.
type EditMode = 'edit' | 'select' | 'selectAdd';

export interface DrumInstrument {
  id: 'kick' | 'snare' | 'clap' | 'closedhat' | 'openhat' | 'tom' | 'splash' | 'ride' | 'perc' | 'fx';
  label: string;
  keyHint: string;
}

export const DRUM_INSTRUMENTS: DrumInstrument[] = [
  { id: 'kick', label: 'Kick', keyHint: 'Q' },
  { id: 'snare', label: 'Snare', keyHint: 'W' },
  { id: 'clap', label: 'Clap', keyHint: 'E' },
  { id: 'closedhat', label: 'Closed Hat', keyHint: 'R' },
  { id: 'openhat', label: 'Open Hat', keyHint: 'T' },
  { id: 'tom', label: 'Tom', keyHint: 'Y' },
  { id: 'splash', label: 'Splash', keyHint: 'U' },
  { id: 'ride', label: 'Ride', keyHint: 'I' },
  { id: 'perc', label: 'Percussion', keyHint: 'O' },
  { id: 'fx', label: 'FX / Impact', keyHint: 'P' },
];

// Tombol keyboard fisik (QWERTY) -> pad drum. Memakai e.code supaya posisi tombol tetap sama walau Caps Lock / Shift aktif.
const DRUM_BY_CODE: Record<string, DrumInstrument> = Object.fromEntries(
  DRUM_INSTRUMENTS.map((inst) => [`Key${inst.keyHint}`, inst])
);

export const DRUM_KITS = [
  '80s Kit',
  'Ambient',
  'Industrial',
  'Breakbeat',
  'Jazzy',
  'Electro',
  'Hiphop',
];

export const TOTAL_BARS = 16;

// ---------------------------------------------------------------------------
// BIRAMA (TIME SIGNATURE)
// Grid memakai resolusi 1/16 not: 1 step = 1/16. BPM dihitung per not seperempat (1 seperempat = 4 step).
// Jumlah step per bar = jumlah semua `groups`. `groups` = panjang tiap kelompok ketukan (dalam step) dan
// dipakai untuk penanda ketukan di grid serta pola drum bawaan.
//   4/4  -> [4,4,4,4]  = 16 step      3/4 -> [4,4,4] = 12 step     6/8 -> [6,6] = 12 step
//   7/8  -> [4,4,6]    = 14 step      5/4 -> 5 x 4  = 20 step
// ---------------------------------------------------------------------------
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

const getTimeSig = (id: string): TimeSignatureDef => TIME_SIGNATURES.find((t) => t.id === id) ?? TIME_SIGNATURES[2];
const stepsPerBarOf = (ts: TimeSignatureDef): number => ts.groups.reduce((a, b) => a + b, 0);

const INITIAL_TS = getTimeSig('4/4');
const INITIAL_STEPS_PER_BAR = stepsPerBarOf(INITIAL_TS);
const INITIAL_TOTAL_STEPS = INITIAL_STEPS_PER_BAR * TOTAL_BARS;
const DEFAULT_PATTERN_BARS = 4; // pola bawaan mengisi 4 bar pertama
const DEFAULT_LOOP_END_BAR = 4;

// Jumlah bar yang digambar sekaligus (dipilih supaya sel tetap cukup lebar dan DOM tetap kecil).
const defaultBarsPerView = (stepsPerBar: number) => Math.max(1, Math.min(8, Math.round(32 / stepsPerBar)));
const BARS_PER_VIEW_OPTIONS = [1, 2, 3, 4, 6, 8];

const INSTRUMENT_CATEGORIES = Array.from(new Set(INSTRUMENTS_128.map((inst) => inst.category)));

// Penanda ketukan di dalam satu bar: step mana yang awal kelompok ketukan, dan nomor ketukannya.
function buildBeatInfo(ts: TimeSignatureDef): { isBeatStart: boolean[]; beatNumber: number[] } {
  const S = stepsPerBarOf(ts);
  const isBeatStart: boolean[] = Array(S).fill(false);
  const beatNumber: number[] = Array(S).fill(0);
  let acc = 0;
  ts.groups.forEach((g, i) => {
    isBeatStart[acc] = true;
    beatNumber[acc] = i + 1;
    acc += g;
  });
  return { isBeatStart, beatNumber };
}

// Pindahkan isi grid ke birama baru: tiap bar disalin step demi step (yang melebihi panjang bar baru terpotong).
function remapSteps<T>(src: T[], oldS: number, newS: number, fill: T): T[] {
  const out: T[] = Array(newS * TOTAL_BARS).fill(fill);
  const n = Math.min(oldS, newS);
  for (let bar = 0; bar < TOTAL_BARS; bar++) {
    for (let i = 0; i < n; i++) {
      const v = src[bar * oldS + i];
      if (v !== undefined) out[bar * newS + i] = v;
    }
  }
  return out;
}

// Pola drum bawaan yang menyesuaikan birama (kick di ketukan awal, snare di ketukan "backbeat", hat tiap 1/8).
// Nilai = level dinamika 0–4 (kick/snare "keras", hi-hat "normal").
function buildDefaultDrumGrid(ts: TimeSignatureDef): { [key: string]: number[] } {
  const S = stepsPerBarOf(ts);
  const total = S * TOTAL_BARS;
  const grid: { [key: string]: number[] } = {};
  DRUM_INSTRUMENTS.forEach((inst) => {
    grid[inst.id] = Array(total).fill(0);
  });
  const starts: number[] = [];
  let acc = 0;
  ts.groups.forEach((g) => {
    starts.push(acc);
    acc += g;
  });
  const n = ts.groups.length;
  const kickGroups = n >= 4 ? [0, 2] : [0];
  const snareGroups = n >= 4 ? [1, 3] : n === 3 ? [1, 2] : n === 2 ? [1] : [];
  for (let bar = 0; bar < DEFAULT_PATTERN_BARS; bar++) {
    const base = bar * S;
    kickGroups.forEach((g) => {
      grid.kick[base + starts[g]] = 3;
    });
    snareGroups.forEach((g) => {
      grid.snare[base + starts[g]] = 3;
    });
    for (let i = 0; i < S; i += 2) grid.closedhat[base + i] = 2;
  }
  return grid;
}

// Progresi akor bawaan: satu akor di awal tiap bar (panjang 1 bar), 4 bar pertama.
function buildDefaultChordSteps(ts: TimeSignatureDef): { steps: number[]; lens: number[] } {
  const S = stepsPerBarOf(ts);
  const data = emptyTrackData(S * TOTAL_BARS);
  for (let bar = 0; bar < DEFAULT_PATTERN_BARS; bar++) {
    data.steps[bar * S] = bar;
    data.lens[bar * S] = S;
  }
  return data;
}

// ---------------------------------------------------------------------------
// OPTIMASI PERFORMA SEQUENCER
// - Sel grid dibuat komponen ter-memo: mengubah satu sel hanya me-render ulang satu sel itu,
//   dan ketukan berjalan TIDAK me-render ulang grid sama sekali (playhead digambar lewat atribut DOM).
// - Hanya bar yang sedang tampil (jendela) yang digambar di DOM, bukan semua 16 bar.
// - Suara dijadwalkan dengan jam AudioContext (lookahead), bukan setInterval per ketukan.
// - Detak scheduler berjalan di Web Worker supaya tidak ikut tertahan saat UI sibuk / tab di latar.
// ---------------------------------------------------------------------------
const SCHEDULER_TICK_MS = 25; // seberapa sering scheduler memeriksa
const LOOKAHEAD_SEC = 0.22; // seberapa jauh ke depan suara dijadwalkan (lebih panjang = lebih tahan hitch)

// Pencatat waktu berbasis Web Worker (tidak ikut macet saat main thread sibuk). Jatuh ke setInterval
// biasa jika Worker tidak tersedia. Mengembalikan fungsi untuk menghentikannya.
function startTicker(cb: () => void, ms: number): () => void {
  let fallbackId: number | undefined;
  const startFallback = () => {
    if (fallbackId === undefined) fallbackId = window.setInterval(cb, ms);
  };
  let worker: Worker | null = null;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(
      new Blob([`let t=0;onmessage=function(e){clearInterval(t);if(e.data==='start'){t=setInterval(function(){postMessage(0)},${ms})}}`], {
        type: 'text/javascript',
      })
    );
    worker = new Worker(url);
    worker.onmessage = () => cb();
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      startFallback();
    };
    worker.postMessage('start');
  } catch {
    worker = null;
    startFallback();
  }
  return () => {
    if (worker) {
      try {
        worker.postMessage('stop');
      } catch {}
      worker.terminate();
      worker = null;
    }
    if (url) {
      URL.revokeObjectURL(url);
      url = null;
    }
    if (fallbackId !== undefined) {
      window.clearInterval(fallbackId);
      fallbackId = undefined;
    }
  };
}

interface PadInfo {
  midiNotes: number[];
  displayName: string;
}

interface LiveSeqState {
  bpm: number;
  isDrumLoopActive: boolean;
  isChordLoopActive: boolean;
  isSeqLooping: boolean;
  isUnlocked8Bar: boolean;
  stepsPerBar: number;
  drumGrid: { [key: string]: number[] };
  drumMix: Record<string, DrumMixState>;
  chordTracks: ChordTrackState[];
  padInfo: PadInfo[];
  dynamicsOn: boolean;
  isRecording: boolean;
  metronomeOn: boolean;
  beatStart: boolean[];
  selectedDrumKit: string;
  drumVolume: number;
  chordMasterVolume: number;
  loopStartBar: number;
  loopStartBeat: number;
  loopEndBar: number;
  loopEndBeat: number;
}

// ---------------------------------------------------------------------------
// LIVE HARMONIC CHORDS: 8 bank x 16 pad = 128 akor.
// Bank 1 = progresi bawaan (Am). Bank 2–8 = progresi yang sama di nada dasar lain (bisa diedit bebas).
// Pad live dan sequencer berbagi data yang sama: mengubah akor sebuah pad otomatis mengubahnya di semua step yang memakainya.
// ---------------------------------------------------------------------------
export const PADS_PER_BANK = 16;
export const PAD_BANKS = 8;
const BASE_PADS: ChordFormulaDef[] = [
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
const BANK_SEMITONES = [0, 5, 7, 2, 10, 3, 8, 4]; // Am, Dm, Em, Bm, Gm, Cm, Fm, C#m
const transposeNote = (note: string | undefined, semis: number): string | undefined => {
  if (!note || note === 'none') return note;
  const i = NOTE_ROOTS.indexOf(note);
  return i < 0 ? note : NOTE_ROOTS[(i + semis) % 12];
};
const makeDefaultPadChords = (): ChordFormulaDef[] =>
  BANK_SEMITONES.flatMap((semis) =>
    BASE_PADS.map((c) => ({ ...c, root: transposeNote(c.root, semis) as string, bass: transposeNote(c.bass, semis) }))
  );

// Dinamika live drum dari posisi klik: makin jauh dari pusat pad, makin lemah. Batas = proporsi dari setengah lebar/tinggi pad
// (elips), sama persis dengan cincin yang digambar di pad.
const LIVE_RING = [0.3, 0.55, 0.8] as const;
const levelFromOffset = (dx: number, dy: number, halfW: number, halfH: number): number => {
  const d = Math.sqrt((dx / halfW) ** 2 + (dy / halfH) ** 2);
  if (d <= LIVE_RING[0]) return 4;
  if (d <= LIVE_RING[1]) return 3;
  if (d <= LIVE_RING[2]) return 2;
  return 1;
};

// Dinamika mati: semua pad aktif dibunyikan sama keras (level DRUM_FLAT_LEVEL). Data level asli tetap tersimpan,
// jadi menyalakan kembali dinamika mengembalikan pp / p / f / ff yang pernah dipasang.
const effLevel = (level: number, dynamics: boolean): number => (level > 0 && !dynamics ? DRUM_FLAT_LEVEL : level);

// Klik metronom sederhana (osilator) yang dijadwalkan di jam AudioContext, dipakai saat merekam.
function scheduleClick(ctx: AudioContext, when: number, accent: boolean) {
  try {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = accent ? 1568 : 1046;
    const peak = accent ? 0.16 : 0.1;
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(when);
    osc.stop(when + 0.06);
  } catch {
    // Abaikan jika context belum aktif
  }
}

// Waktu jam audio saat sebuah event input terjadi (dikoreksi oleh umur event, supaya tidak ikut telat bila UI sempat sibuk).
const audioTimeOfEvent = (eventTimeStamp?: number): number => {
  const ctx = audioEngine.getAudioContext();
  const age = eventTimeStamp && eventTimeStamp > 0 ? Math.max(0, Math.min(0.1, (performance.now() - eventTimeStamp) / 1000)) : 0;
  return ctx.currentTime - age;
};

const SEL_CLASS = 'outline outline-2 outline-sky-300 -outline-offset-2';

// Boolean yang diingat di localStorage (preferensi tampilan). Aman bila storage diblokir.
function usePersistedBool(key: string, initial: boolean): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [val, setVal] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? initial : saved === '1';
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, val ? '1' : '0');
    } catch {
      // Abaikan jika storage tidak tersedia
    }
  }, [key, val]);
  return [val, setVal];
}

// Riwayat undo/redo: hanya data pola (grid drum + not akor), bukan volume/ADSR/mute. Array bersifat immutable,
// jadi snapshot cukup menyimpan referensi (murah).
type DrumSnap = { [key: string]: number[] };
type ChordSnap = Array<{ steps: number[]; lens: number[]; enabled: boolean }>;
const HISTORY_LIMIT = 100;
const snapChord = (tracks: Array<{ steps: number[]; lens: number[]; enabled: boolean }>): ChordSnap =>
  tracks.map((t) => ({ steps: t.steps, lens: t.lens, enabled: t.enabled }));
const chordSnapEqual = (a: ChordSnap, b: ChordSnap): boolean =>
  a.length === b.length && a.every((t, i) => t.steps === b[i].steps && t.lens === b[i].lens && t.enabled === b[i].enabled);

const DrumCell = memo(function DrumCell({
  drumId,
  stepIdx,
  level,
  selected,
  beat,
  dynamics,
  onCycle,
  onMenu,
}: {
  drumId: string;
  stepIdx: number;
  level: number; // level yang sudah memperhitungkan dinamika (mati = 0 atau DRUM_FLAT_LEVEL)
  selected: boolean;
  beat: boolean;
  dynamics: boolean;
  onCycle: (drumId: string, stepIdx: number) => void;
  onMenu: (drumId: string, stepIdx: number, el: HTMLElement) => void;
}) {
  const next = (level + 1) % (DRUM_LEVEL_MAX + 1);
  const nextText = next === 0 ? 'hapus' : `naik ke ${DRUM_LEVEL_SHORT[next]}`;
  const ariaLabel = dynamics
    ? level > 0
      ? `Drum ${DRUM_LEVEL_LABEL[level]}, klik untuk ${nextText}`
      : 'Pad kosong, klik untuk memasang (mulai dari pianissimo)'
    : level > 0
    ? 'Drum aktif, klik untuk menghapus'
    : 'Pad kosong, klik untuk memasang';
  const title = dynamics
    ? level > 0
      ? `${DRUM_LEVEL_LABEL[level]} (${DRUM_LEVEL_SHORT[level]}) — klik: ${nextText} • klik kanan: pilih langsung`
      : 'Klik: pasang pp, klik lagi untuk menaikkan • klik kanan: pilih langsung'
    : level > 0
    ? 'Aktif — klik untuk menghapus'
    : 'Klik untuk memasang';
  return (
    <button
      type="button"
      data-step={stepIdx}
      data-level={level}
      aria-label={ariaLabel}
      title={title}
      onClick={() => onCycle(drumId, stepIdx)}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(drumId, stepIdx, e.currentTarget);
      }}
      className={`h-8 rounded-sm transition-colors relative flex items-center justify-center cursor-pointer text-[9px] font-black italic leading-none ${
        level > 0
          ? `${DRUM_LEVEL_CELL_CLASS[level]} text-on-accent`
          : beat
          ? 'bg-black/35 hover:bg-white/10 border border-white/[0.09]'
          : 'bg-black/60 hover:bg-white/10 border border-white/[0.05]'
      } ${selected ? SEL_CLASS : ''}`}
    >
      {level > 0 && dynamics ? DRUM_LEVEL_SHORT[level] : null}
    </button>
  );
});

// Popover kecil untuk memilih dinamika drum. Dirender ke <body> (fixed) supaya tidak terpotong area scroll sequencer.
// Pintasan keyboard: 1=pp, 2=p, 3=f, 4=ff, Delete=hapus, Esc=tutup.
const DrumLevelPicker: React.FC<{
  x: number;
  y: number;
  current: number;
  onPick: (level: number) => void;
  onClose: () => void;
}> = ({ x, y, current, onPick, onClose }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const pad = 8;
    const left = Math.max(pad, Math.min(window.innerWidth - w - pad, x - w / 2));
    const below = y + 6;
    const top = below + h > window.innerHeight - pad ? Math.max(pad, y - h - 42) : below;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key >= '1' && e.key <= '4') onPick(Number(e.key));
      else if ((e.key === 'Delete' || e.key === 'Backspace') && current > 0) onPick(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPick, current]);

  return createPortal(
    <div
      className="fixed inset-0 z-[80]"
      onPointerDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        ref={ref}
        role="menu"
        aria-label="Pilih dinamika drum"
        onPointerDown={(e) => e.stopPropagation()}
        style={{ left: pos.left, top: pos.top }}
        className="fixed w-48 rounded-xl border border-white/15 bg-zinc-950/95 backdrop-blur p-1.5 shadow-2xl shadow-black/60"
      >
        <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Dinamika pukulan</div>
        {([1, 2, 3, 4] as const).map((lv) => (
          <button
            key={lv}
            type="button"
            role="menuitemradio"
            aria-checked={current === lv}
            onClick={() => onPick(lv)}
            className={`w-full flex items-center gap-2 px-1.5 py-1.5 rounded-lg text-left cursor-pointer transition-colors ${
              current === lv ? 'bg-white/15' : 'hover:bg-white/10'
            }`}
          >
            <span
              className={`w-7 h-7 rounded-md shrink-0 flex items-center justify-center text-[10px] font-black italic text-on-accent ${DRUM_LEVEL_CELL_CLASS[lv]}`}
            >
              {DRUM_LEVEL_SHORT[lv]}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-bold text-gray-100 leading-tight">{DRUM_LEVEL_LABEL[lv]}</span>
              <span className="block text-[10px] text-gray-400 leading-tight">{DRUM_LEVEL_DESC[lv]}</span>
            </span>
            <kbd className="text-[9px] font-mono text-gray-500 border border-white/10 rounded px-1">{lv}</kbd>
          </button>
        ))}
        {current > 0 && (
          <button
            type="button"
            onClick={() => onPick(0)}
            className="mt-1 w-full flex items-center justify-center gap-1.5 px-1.5 py-1.5 rounded-lg text-[11px] font-bold text-red-300 hover:bg-red-500/15 border-t border-white/10 cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            Hapus pad
          </button>
        )}
      </div>
    </div>,
    document.body
  );
};

// Lebar kolom label di sisi kiri semua baris sequencer (nama + mixer ringkas).
const LABEL_W = 'w-52';
// Saat Mixer dibuka, panel kiri dilebarkan supaya volume & ADSR lega.
const LABEL_W_WIDE = 'w-64';
const labelWidth = (showMixer: boolean) => (showMixer ? LABEL_W_WIDE : LABEL_W);

const DEFAULT_DRUM_ADSR: EnvelopeADSR = { attack: 0.002, decay: 0.15, sustain: 0.3, release: 0.12 };
const DRUM_ADSR_RANGES: AdsrRanges = {
  attack: [0.001, 0.1],
  decay: [0.01, 2],
  sustain: [0, 1],
  release: [0.02, 2],
};
const CHORD_ADSR_RANGES: AdsrRanges = {
  attack: [0.005, 5],
  decay: [0.02, 5],
  sustain: [0, 1],
  release: [0.05, 10],
};

interface DrumMixState {
  volume: number; // 0–100, relatif terhadap volume drum utama
  muted: boolean;
  solo: boolean;
  adsr: EnvelopeADSR;
}

const makeDefaultDrumMix = (): Record<string, DrumMixState> =>
  Object.fromEntries(
    DRUM_INSTRUMENTS.map((inst) => [inst.id, { volume: 100, muted: false, solo: false, adsr: { ...DEFAULT_DRUM_ADSR } }])
  );

// Drum terdengar jika tidak di-mute, dan (bila ada solo) hanya yang solo.
const isDrumAudible = (id: string, mix: Record<string, DrumMixState>): boolean => {
  const m = mix[id];
  if (!m || m.muted) return false;
  const anySolo = Object.values(mix).some((x) => x.solo);
  return anySolo ? m.solo : true;
};

const MuteSoloButtons: React.FC<{ muted: boolean; solo: boolean; onMute: () => void; onSolo: () => void }> = ({
  muted,
  solo,
  onMute,
  onSolo,
}) => (
  <div className="flex items-center gap-1 shrink-0">
    <button
      type="button"
      onClick={onMute}
      title={muted ? 'Buka Mute' : 'Mute'}
      className={`w-5 h-5 rounded text-[9px] font-black flex items-center justify-center cursor-pointer transition-colors ${
        muted ? 'bg-red-500 text-white' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
      }`}
    >
      M
    </button>
    <button
      type="button"
      onClick={onSolo}
      title={solo ? 'Buka Solo' : 'Solo'}
      className={`w-5 h-5 rounded text-[9px] font-black flex items-center justify-center cursor-pointer transition-colors ${
        solo ? 'bg-accent text-on-accent' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
      }`}
    >
      S
    </button>
  </div>
);

const MiniVolume: React.FC<{ value: number; onChange: (v: number) => void; title: string }> = ({ value, onChange, title }) => (
  <div className="flex items-center gap-1.5 flex-1 min-w-0" title={title}>
    <Volume2 className="w-3 h-3 text-gray-400 shrink-0" />
    <input
      type="range"
      min="0"
      max="100"
      value={value}
      aria-label={title}
      onChange={(e) => onChange(Number(e.target.value))}
      className="flex-1 min-w-0 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
    />
    <span className="text-[10px] font-mono text-gray-300 w-7 text-right shrink-0">{value}%</span>
  </div>
);

const AdsrToggle: React.FC<{ open: boolean; onClick: () => void }> = ({ open, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-expanded={open}
    className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-accent cursor-pointer"
  >
    <Activity className="w-3 h-3" />
    <span>ADSR</span>
    <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
  </button>
);

// Kolom label baris drum. Default ringkas (nama + M/S). Volume & ADSR baru muncul saat tombol "Mixer" aktif.
const DrumLabel = memo(function DrumLabel({
  id,
  label,
  mix,
  showMixer,
  onMix,
  onAdsr,
}: {
  id: string;
  label: string;
  mix: DrumMixState;
  showMixer: boolean;
  onMix: (id: string, patch: Partial<DrumMixState>) => void;
  onAdsr: (id: string, patch: Partial<EnvelopeADSR>) => void;
}) {
  const [adsrOpen, setAdsrOpen] = useState(false);
  return (
    <div className={`${labelWidth(showMixer)} shrink-0 relative border-r border-white/10 bg-black/40 pl-4 pr-3 py-2 space-y-2`}>
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${mix.muted ? 'bg-red-500/70' : mix.solo ? 'bg-accent' : 'bg-accent/40'}`}
      />
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-xs font-semibold text-gray-200 truncate">{label}</span>
        <MuteSoloButtons
          muted={mix.muted}
          solo={mix.solo}
          onMute={() => onMix(id, { muted: !mix.muted })}
          onSolo={() => onMix(id, { solo: !mix.solo })}
        />
      </div>
      {showMixer && (
        <div className="space-y-2 border-t border-white/[0.08] pt-2">
          <MiniVolume value={mix.volume} onChange={(v) => onMix(id, { volume: v })} title={`Volume ${label}`} />
          <AdsrToggle open={adsrOpen} onClick={() => setAdsrOpen((o) => !o)} />
          {adsrOpen && <AdsrMini adsr={mix.adsr} ranges={DRUM_ADSR_RANGES} onChange={(p) => onAdsr(id, p)} />}
        </div>
      )}
    </div>
  );
});

// Kolom label baris akor: nama progresi + instrumen + M/S. Volume & ADSR hanya tampil saat "Mixer" aktif.
const ChordLabel = memo(function ChordLabel({
  tIdx,
  track,
  instName,
  showMixer,
  onUpdateTrack,
  onUpdateAdsr,
  onPickInstrument,
  onRemove,
}: {
  tIdx: number;
  track: ChordTrackState;
  instName: string;
  showMixer: boolean;
  onUpdateTrack: (trackIndex: number, updates: Partial<ChordTrackState>) => void;
  onUpdateAdsr: (trackIndex: number, patch: Partial<EnvelopeADSR>) => void;
  onPickInstrument: (trackIndex: number) => void;
  onRemove: (trackIndex: number) => void;
}) {
  const [adsrOpen, setAdsrOpen] = useState(false);
  return (
    <div className={`${labelWidth(showMixer)} shrink-0 relative border-r border-white/10 bg-black/40 pl-4 pr-3 py-2 space-y-2`}>
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${track.muted ? 'bg-red-500/70' : track.solo ? 'bg-accent' : 'bg-accent/40'}`}
      />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <span className="text-xs font-semibold text-gray-200 truncate block">{track.label}</span>
          <button
            type="button"
            onClick={() => onPickInstrument(tIdx)}
            title="Klik untuk mengganti instrumen"
            className="max-w-full flex items-center gap-0.5 text-[10px] text-accent font-mono hover:text-white cursor-pointer"
          >
            <span className="truncate underline decoration-dotted underline-offset-2">{instName}</span>
            <ChevronDown className="w-3 h-3 shrink-0" />
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <MuteSoloButtons
            muted={track.muted}
            solo={track.solo}
            onMute={() => onUpdateTrack(tIdx, { muted: !track.muted })}
            onSolo={() => onUpdateTrack(tIdx, { solo: !track.solo })}
          />
          {tIdx > 0 && (
            <button
              type="button"
              onClick={() => onRemove(tIdx)}
              title={`Hapus ${track.label}`}
              className="p-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-white/5 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      {showMixer && (
        <div className="space-y-2 border-t border-white/[0.08] pt-2">
          <MiniVolume value={track.volume} onChange={(v) => onUpdateTrack(tIdx, { volume: v })} title={`Volume ${track.label}`} />
          <AdsrToggle open={adsrOpen} onClick={() => setAdsrOpen((o) => !o)} />
          {adsrOpen && <AdsrMini adsr={track.adsr} ranges={CHORD_ADSR_RANGES} onChange={(p) => onUpdateAdsr(tIdx, p)} />}
        </div>
      )}
    </div>
  );
});

const DrumRow = memo(function DrumRow({
  rowIdx,
  id,
  label,
  row,
  steps,
  stepsPerBar,
  beatMask,
  gridStyle,
  selSteps,
  mix,
  showMixer,
  onMix,
  onAdsr,
  dynamics,
  onCycle,
  onMenu,
}: {
  rowIdx: number;
  dynamics: boolean;
  showMixer: boolean;
  id: string;
  label: string;
  mix: DrumMixState;
  onMix: (id: string, patch: Partial<DrumMixState>) => void;
  onAdsr: (id: string, patch: Partial<EnvelopeADSR>) => void;
  row: number[] | undefined;
  steps: number[];
  stepsPerBar: number;
  beatMask: boolean[];
  gridStyle: React.CSSProperties;
  selSteps: ReadonlySet<number> | null; // step terpilih di baris ini (null = tidak ada)
  onCycle: (drumId: string, stepIdx: number) => void;
  onMenu: (drumId: string, stepIdx: number, el: HTMLElement) => void;
}) {
  return (
    <div
      className={`flex items-stretch rounded-xl border overflow-hidden bg-white/[0.02] border-white/[0.1] hover:border-white/25 transition-colors ${
        mix.muted ? 'opacity-60' : ''
      }`}
    >
      <DrumLabel id={id} label={label} mix={mix} showMixer={showMixer} onMix={onMix} onAdsr={onAdsr} />
      <div className="flex-1 min-w-0 px-2 py-1 flex items-center">
        <div className="grid gap-0.5 w-full min-w-0" style={gridStyle} data-rowgrid="" data-row={rowIdx}>
          {steps.map((stepIdx) => (
            <DrumCell
              key={stepIdx}
              drumId={id}
              stepIdx={stepIdx}
              level={effLevel(clampLevel(row?.[stepIdx]), dynamics)}
              selected={selSteps ? selSteps.has(stepIdx) : false}
              beat={Boolean(beatMask[stepIdx % stepsPerBar])}
              dynamics={dynamics}
              onCycle={onCycle}
              onMenu={onMenu}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

// Sel kosong (tempat memilih akor). Sel yang tertutup blok not dirender sebagai penampung kosong.
const ChordCell = memo(function ChordCell({
  trackIdx,
  stepIdx,
  col,
  posInBar,
  beat,
  covered,
  selected,
  options,
  onPick,
}: {
  trackIdx: number;
  stepIdx: number;
  col: number;
  posInBar: number;
  beat: boolean;
  covered: boolean;
  selected: boolean;
  options: React.ReactNode;
  onPick: (trackIdx: number, stepIdx: number, padIdx: number) => void;
}) {
  const style = { gridColumn: col, gridRow: 1 } as const;
  if (covered) return <div data-step={stepIdx} style={style} className="h-16 pointer-events-none" />;
  return (
    <div
      data-step={stepIdx}
      style={style}
      className={`group h-16 rounded-lg p-1 flex flex-col justify-between items-center transition-colors relative border ${
        selected
          ? `bg-white/15 border-white/30 ${SEL_CLASS}`
          : beat
          ? 'bg-black/35 border-white/[0.09] hover:border-white/20'
          : 'bg-black/60 border-white/[0.05] hover:border-white/20'
      }`}
    >
      <span className="text-[10px] text-gray-500 font-mono font-bold">{posInBar + 1}</span>
      <div className="w-full flex-1 flex flex-col items-center justify-center relative">
        <Plus className="w-3.5 h-3.5 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        <select
          value={-1}
          onChange={(e) => onPick(trackIdx, stepIdx, Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={`Pasang akor di step ${posInBar + 1}`}
        >
          {options}
        </select>
      </div>
    </div>
  );
});

// Blok not akor: membentang sepanjang `note.len` step. Tepi kanan bisa diseret untuk memanjangkan/memendekkan.
const ChordBlock = memo(function ChordBlock({
  trackIdx,
  note,
  winStart,
  viewSteps,
  posInBar,
  fullName,
  selected,
  options,
  getMode,
  onPick,
  onResize,
}: {
  trackIdx: number;
  note: ChordNote;
  winStart: number;
  viewSteps: number;
  posInBar: number;
  fullName: string;
  selected: boolean;
  options: React.ReactNode;
  getMode: () => EditMode;
  onPick: (trackIdx: number, stepIdx: number, padIdx: number) => void;
  onResize: (trackIdx: number, start: number, newLen: number) => void;
}) {
  const winEnd = winStart + viewSteps - 1;
  const noteEnd = note.start + note.len - 1;
  const clippedL = note.start < winStart;
  const clippedR = noteEnd > winEnd;
  const visStart = Math.max(note.start, winStart);
  const visEnd = Math.min(noteEnd, winEnd);

  const onHandleDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (getMode() !== 'edit' || e.shiftKey) return; // biarkan gestur seleksi yang bekerja
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grid = e.currentTarget.closest('[data-rowgrid]') as HTMLElement | null;
    if (!grid) return;
    const move = (ev: PointerEvent) => {
      const r = grid.getBoundingClientRect();
      const frac = (ev.clientX - r.left) / r.width;
      const step = winStart + Math.max(0, Math.min(viewSteps - 1, Math.floor(frac * viewSteps)));
      onResize(trackIdx, note.start, step - note.start + 1);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <div
      data-block=""
      style={{ gridColumn: `${visStart - winStart + 1} / span ${visEnd - visStart + 1}`, gridRow: 1 }}
      className={`relative z-[2] h-16 border border-accent bg-accent/25 text-white p-1 flex flex-col justify-between items-center overflow-hidden ${
        clippedL ? 'rounded-l-none border-l-0' : 'rounded-l-lg'
      } ${clippedR ? 'rounded-r-none border-r-0' : 'rounded-r-lg'} ${selected ? SEL_CLASS : ''}`}
    >
      <span className="text-[10px] text-gray-300 font-mono font-bold self-start">
        {clippedL ? '◂' : posInBar + 1}
      </span>
      <div className="w-full flex-1 flex items-center justify-center relative min-w-0">
        <span className="text-[11px] font-black tracking-tight leading-none text-accent px-1 truncate" title={fullName}>
          {fullName.replace(/\s+/g, '')}
        </span>
        <select
          value={note.pad}
          onChange={(e) => onPick(trackIdx, note.start, Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label="Ganti akor"
        >
          {options}
        </select>
      </div>
      <div className="flex items-center gap-1.5 mb-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-accent" />
        {note.len > 1 && <span className="text-[9px] font-mono text-gray-300">{note.len}</span>}
      </div>
      {!clippedR && (
        <div
          onPointerDown={onHandleDown}
          title="Seret untuk mengubah panjang akor"
          className="absolute top-0 right-0 h-full w-3 cursor-ew-resize touch-none bg-accent/40 hover:bg-accent/80 flex items-center justify-center"
        >
          <div className="w-0.5 h-5 rounded bg-black/50" />
        </div>
      )}
    </div>
  );
});

const ChordRow = memo(function ChordRow({
  tIdx,
  track,
  instName,
  showMixer,
  padInfo,
  options,
  steps,
  stepsPerBar,
  beatMask,
  gridStyle,
  selSteps,
  getMode,
  onPick,
  onResize,
  onUpdateTrack,
  onUpdateAdsr,
  onPickInstrument,
  onRemove,
}: {
  onUpdateTrack: (trackIndex: number, updates: Partial<ChordTrackState>) => void;
  onUpdateAdsr: (trackIndex: number, patch: Partial<EnvelopeADSR>) => void;
  onPickInstrument: (trackIndex: number) => void;
  onRemove: (trackIndex: number) => void;
  tIdx: number;
  track: ChordTrackState;
  instName: string;
  showMixer: boolean;
  padInfo: PadInfo[];
  options: React.ReactNode;
  steps: number[];
  stepsPerBar: number;
  beatMask: boolean[];
  gridStyle: React.CSSProperties;
  selSteps: ReadonlySet<number> | null; // step (awal not / sel kosong) terpilih di baris ini
  getMode: () => EditMode;
  onPick: (trackIdx: number, stepIdx: number, padIdx: number) => void;
  onResize: (trackIdx: number, start: number, newLen: number) => void;
}) {
  const winStart = steps[0] ?? 0;
  const winEnd = steps[steps.length - 1] ?? 0;
  const notes = useMemo(() => listNotes(track.steps, track.lens), [track.steps, track.lens]);
  const visible = notes.filter((n) => n.start <= winEnd && n.start + n.len - 1 >= winStart);
  const coveredMask = new Array<boolean>(steps.length).fill(false);
  visible.forEach((n) => {
    const a = Math.max(n.start, winStart);
    const b = Math.min(n.start + n.len - 1, winEnd);
    for (let s = a; s <= b; s++) coveredMask[s - winStart] = true;
  });

  return (
    <div
      className={`flex items-stretch rounded-xl border overflow-hidden bg-white/[0.02] border-white/[0.1] hover:border-white/25 transition-colors ${
        track.muted ? 'opacity-60' : ''
      }`}
    >
      <ChordLabel
        tIdx={tIdx}
        track={track}
        instName={instName}
        showMixer={showMixer}
        onUpdateTrack={onUpdateTrack}
        onUpdateAdsr={onUpdateAdsr}
        onPickInstrument={onPickInstrument}
        onRemove={onRemove}
      />
      <div className="flex-1 min-w-0 px-2 py-1.5 flex items-center">
      <div className="grid gap-0.5 w-full min-w-0" style={gridStyle} data-rowgrid="" data-row={tIdx}>
        {steps.map((stepIdx, i) => {
          const posInBar = stepIdx % stepsPerBar;
          return (
            <ChordCell
              key={stepIdx}
              trackIdx={tIdx}
              stepIdx={stepIdx}
              col={i + 1}
              posInBar={posInBar}
              beat={Boolean(beatMask[posInBar])}
              covered={coveredMask[i]}
              selected={selSteps ? selSteps.has(stepIdx) : false}
              options={options}
              onPick={onPick}
            />
          );
        })}
        {visible.map((n) => (
          <ChordBlock
            key={n.start}
            trackIdx={tIdx}
            note={n}
            winStart={winStart}
            viewSteps={steps.length}
            posInBar={n.start % stepsPerBar}
            fullName={padInfo[n.pad]?.displayName ?? '?'}
            selected={selSteps ? selSteps.has(n.start) : false}
            options={options}
            getMode={getMode}
            onPick={onPick}
            onResize={onResize}
          />
        ))}
      </div>
      </div>
    </div>
  );
});

// Tombol informasi (ikon "i"): penjelasan cara pakai disembunyikan di balik popover supaya tampilan tidak berisik.
// Dirender ke <body> (fixed) agar tidak terpotong area scroll. Tutup: klik di luar, tombol X, atau Esc.
const InfoTip: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = btnRef.current;
    const box = boxRef.current;
    if (!btn || !box) return;
    const r = btn.getBoundingClientRect();
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const pad = 8;
    const left = Math.max(pad, Math.min(window.innerWidth - w - pad, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8;
    const top = below + h > window.innerHeight - pad ? Math.max(pad, r.top - h - 8) : below;
    setPos({ left, top });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onScroll = (e: Event) => {
      if (boxRef.current && e.target instanceof Node && boxRef.current.contains(e.target)) return;
      close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Informasi: ${title}`}
        title="Informasi"
        className={`shrink-0 w-6 h-6 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${
          open ? 'bg-accent text-on-accent border-accent' : 'bg-black/50 text-gray-300 border-white/15 hover:text-accent hover:border-accent/50'
        }`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[80]" onPointerDown={() => setOpen(false)}>
            <div
              ref={boxRef}
              role="dialog"
              aria-label={title}
              onPointerDown={(e) => e.stopPropagation()}
              style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
              className="fixed w-[min(24rem,calc(100vw-1rem))] max-h-[70dvh] overflow-y-auto overscroll-contain rounded-xl border border-white/15 bg-zinc-950/95 backdrop-blur p-3 shadow-2xl shadow-black/60 space-y-2 text-[11px] leading-relaxed text-gray-300"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{title}</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Tutup informasi"
                  className="p-1 rounded-md bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {children}
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

// Saklar dinamika drum: ON = pp / p / f / ff berlaku; OFF = semua pukulan sama keras.
const DynamicsToggle: React.FC<{ on: boolean; onToggle: () => void }> = ({ on, onToggle }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={onToggle}
    title={
      on
        ? 'Dinamika menyala (pp / p / f / ff). Klik untuk mematikan: semua pukulan jadi sama keras.'
        : 'Dinamika mati: semua pukulan sama keras. Klik untuk menyalakan.'
    }
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
      on ? 'bg-accent/20 text-accent border-accent/40' : 'bg-black/60 text-gray-400 border-white/10 hover:border-white/25'
    }`}
  >
    <Gauge className="w-3 h-3" />
    <span>Dinamika</span>
    <span className={`font-mono text-[9px] px-1 rounded ${on ? 'bg-accent text-on-accent' : 'bg-white/10 text-gray-400'}`}>
      {on ? 'ON' : 'OFF'}
    </span>
  </button>
);

const ToolBtn: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}> = ({ icon: Icon, label, onClick, disabled, title }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold bg-white/5 hover:bg-white/15 text-gray-200 border border-white/10 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
  >
    <Icon className="w-3 h-3" />
    <span>{label}</span>
  </button>
);

interface ChordTrackState {
  id: number;
  label: string;
  enabled: boolean;
  program: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  adsr: EnvelopeADSR;
  steps: number[]; // indeks pad akor yang dimulai di step ini (-1 = kosong)
  lens: number[]; // panjang not (step) yang dimulai di step ini (0 = kosong)
}

// Konteks validasi/konversi untuk impor MIDI (nilai-nilai yang dimiliki Pad Studio).
const adsrTuple = (a: EnvelopeADSR): Adsr4 => [a.attack, a.decay, a.sustain, a.release];
const rangesTuple = (r: AdsrRanges): Range4 => [r.attack, r.decay, r.sustain, r.release];
const IMPORT_CTX: ImportContext = {
  drumIds: DRUM_INSTRUMENTS.map((i) => i.id),
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
  bpmRange: [60, 200],
};

export const PadStudio: React.FC<PadStudioProps> = ({
  entitlements,
  onUnlockEditor,
  onSuccessToast,
}) => {
  const isUnlocked8Bar = entitlements?.fullEditor8Bar;
  const [activeTab, setActiveTab] = useState<PadTab>('drum');
  const [bpm, setBpm] = useState(115);

  // Birama & jendela tampilan grid
  const [timeSigId, setTimeSigId] = useState<string>(INITIAL_TS.id);
  const timeSig = getTimeSig(timeSigId);
  const stepsPerBar = stepsPerBarOf(timeSig);
  const totalSteps = stepsPerBar * TOTAL_BARS;
  const beatInfo = useMemo(() => buildBeatInfo(timeSig), [timeSigId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [barsPerView, setBarsPerView] = useState<number>(defaultBarsPerView(INITIAL_STEPS_PER_BAR));
  const [viewStartBar, setViewStartBar] = useState<number>(0);
  const [followPlayhead, setFollowPlayhead] = useState(true);

  const [isDrumLoopActive, setIsDrumLoopActive] = useState(false);
  const [isChordLoopActive, setIsChordLoopActive] = useState(false);
  const [isSeqLooping, setIsSeqLooping] = useState(true);

  const [loopStartBar, setLoopStartBar] = useState<number>(1);
  const [loopStartBeat, setLoopStartBeat] = useState<number>(1);
  const [loopEndBar, setLoopEndBar] = useState<number>(DEFAULT_LOOP_END_BAR);
  const [loopEndBeat, setLoopEndBeat] = useState<number>(INITIAL_STEPS_PER_BAR);

  const [drumVolume, setDrumVolume] = useState(85);
  const [chordMasterVolume, setChordMasterVolume] = useState(80);

  // Mixer per instrumen drum: volume, mute/solo, dan envelope ADSR sendiri.
  const [drumMix, setDrumMix] = useState<Record<string, DrumMixState>>(makeDefaultDrumMix);

  // Pemilih instrumen akor (indeks track yang sedang diganti) & dropdown volume utama.
  const [pickerTrack, setPickerTrack] = useState<number | null>(null);
  // Mixer (volume utama, volume per baris, ADSR) disembunyikan secara default agar sequencer bersih.
  const [showMixer, setShowMixer] = useState(false);
  // Dinamika drum (pp/p/f/ff). ON: tingkat pukulan berlaku di live pad, sequencer, dan hasil rekaman.
  // OFF: semua pukulan sama keras, cincin & label dinamika disembunyikan. Pilihan diingat di perangkat.
  const [dynamicsOn, setDynamicsOn] = usePersistedBool('padstudio.dynamicsOn', true);
  // Perekaman live drum ke sequencer + metronom pengiring rekaman.
  const [isRecording, setIsRecording] = useState(false);
  const [metronomeOn, setMetronomeOn] = usePersistedBool('padstudio.metronome', true);
  // Tombol Q–P hanya ditampilkan di perangkat dengan keyboard fisik (mouse/trackpad), tidak di layar sentuh murni.
  const [hasKeyboard, setHasKeyboard] = useState<boolean>(() => {
    try {
      return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch {
      return false;
    }
  });


  // 4 Track Progresi Akor Mandiri
  const [chordTracks, setChordTracks] = useState<ChordTrackState[]>([
    {
      id: 1,
      label: 'Progresi Akor 1',
      enabled: true,
      program: 0,
      volume: 80,
      muted: false,
      solo: false,
      adsr: { attack: 0.02, decay: 0.25, sustain: 0.65, release: 0.35 },
      ...buildDefaultChordSteps(INITIAL_TS),
    },
    {
      id: 2,
      label: 'Progresi Akor 2',
      enabled: false,
      program: 12,
      volume: 65,
      muted: false,
      solo: false,
      adsr: { attack: 0.05, decay: 0.4, sustain: 0.8, release: 0.9 },
      ...emptyTrackData(INITIAL_TOTAL_STEPS),
    },
    {
      id: 3,
      label: 'Progresi Akor 3',
      enabled: false,
      program: 48,
      volume: 70,
      muted: false,
      solo: false,
      adsr: { attack: 0.1, decay: 0.5, sustain: 0.75, release: 1.2 },
      ...emptyTrackData(INITIAL_TOTAL_STEPS),
    },
    {
      id: 4,
      label: 'Progresi Akor 4',
      enabled: false,
      program: 32,
      volume: 75,
      muted: false,
      solo: false,
      adsr: { attack: 0.03, decay: 0.3, sustain: 0.7, release: 0.8 },
      ...emptyTrackData(INITIAL_TOTAL_STEPS),
    },
  ]);

  const [activePadAnim, setActivePadAnim] = useState<string | null>(null);

  const [selectedDrumKit, setSelectedDrumKit] = useState('80s Kit');
  const [engineStatus, setEngineStatus] = useState<string>('');
  const [bankState, setBankState] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => audioEngine.getBankState());

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'drum' | 'chord' | 'both'>('both');

  const sequencerScrollRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const stepRef = useRef(0); // ketukan BERIKUTNYA yang akan dijadwalkan
  // Jejak ketukan yang baru dijadwalkan (step + waktu jam audio), dipakai untuk membulatkan pukulan rekaman ke step terdekat.
  const recentStepsRef = useRef<{ step: number; time: number }[]>([]);
  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;
  const recTakeOpenRef = useRef(false); // true setelah pukulan pertama sebuah rekaman (satu rekaman = satu langkah undo)

  // Ref untuk scheduler & playhead (tidak memicu render ulang)
  const liveRef = useRef<LiveSeqState | null>(null);
  const nextTimeRef = useRef(0);
  const visualQueueRef = useRef<{ step: number; time: number }[]>([]);
  const playheadStepRef = useRef(0); // ketukan yang sedang ditandai di layar
  const paintedElsRef = useRef<HTMLElement[]>([]);
  const gateRef = useRef({ isUnlocked8Bar: Boolean(isUnlocked8Bar), onUnlockEditor });
  gateRef.current = { isUnlocked8Bar: Boolean(isUnlocked8Bar), onUnlockEditor };
  // Ukuran grid terbaru untuk callback ber-memo (useCallback dengan deps kosong) dan scheduler.
  const layoutRef = useRef({ stepsPerBar, totalSteps });
  layoutRef.current = { stepsPerBar, totalSteps };
  // Jendela tampilan terbaru untuk loop penggambar playhead.
  const viewRef = useRef({ start: viewStartBar, count: barsPerView, stepsPerBar, follow: followPlayhead });
  viewRef.current = { start: viewStartBar, count: barsPerView, stepsPerBar, follow: followPlayhead };

  // Tandai kolom ketukan yang sedang berbunyi langsung di DOM (tanpa render ulang React).
  const paintPlayhead = (step: number) => {
    playheadStepRef.current = step;
    const root = sequencerScrollRef.current;
    if (!root) return;
    paintedElsRef.current.forEach((el) => el.removeAttribute('data-playing'));
    const els = Array.from(root.querySelectorAll<HTMLElement>(`[data-step="${step}"]`));
    els.forEach((el) => el.setAttribute('data-playing', '1'));
    paintedElsRef.current = els;
  };

  // Voice akor sequencer dikelola AudioEngine (bus + kompresor master, batas voice, choke per track).
  const stopAllLiveChords = () => {
    try {
      audioEngine.stopAllChords(0.04);
    } catch {
      // Abaikan jika context belum aktif
    }
  };

  const [padChords, setPadChords] = useState<ChordFormulaDef[]>(makeDefaultPadChords);
  // Bank live harmonic yang sedang tampil (0–7) dan instrumen mana yang dibunyikan saat pad ditekan.
  const [padBank, setPadBank] = useState(0);
  const [liveSel, setLiveSel] = useState<number | 'all'>(0);

  const [editingPadIndex, setEditingPadIndex] = useState<number | null>(null);
  const [draftChord, setDraftChord] = useState<ChordFormulaDef>({
    root: 'C',
    type: 'maj',
    tension: 'none',
    bass: 'none',
    inversion: 0,
    octaveOffset: 0,
  });

  const [drumGrid, setDrumGrid] = useState<{ [key: string]: number[] }>(() => buildDefaultDrumGrid(INITIAL_TS));

  // Bank SF2 hanya dipakai Chord Pad (drum memakai sample WAV), jadi hanya diunduh untuk pengguna yang
  // sudah membuka editor penuh. Pengguna gratis tidak lagi dipaksa mengunduh berkas besar yang tak terpakai.
  // Status pemuatan dipantau lewat subscribeBank, jadi tetap tampil walau pemuatan sudah dimulai komponen lain
  // (sebelumnya pemanggil kedua tidak pernah menerima pesan progres, dan kegagalan tidak terlihat).
  useEffect(() => {
    if (!isUnlocked8Bar) return;
    let hideTimer: number | undefined;
    const apply = (msg: string, state: 'idle' | 'loading' | 'ready' | 'error') => {
      setBankState(state);
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = undefined;
      }
      setEngineStatus(msg);
      if (state === 'ready' || msg === SOUND_BANK_READY_MESSAGE) {
        hideTimer = window.setTimeout(() => setEngineStatus(''), 2000);
      }
    };
    const off = audioEngine.subscribeBank(apply);
    if (audioEngine.isLoaded) {
      setBankState('ready');
    } else {
      const st = audioEngine.getBankState();
      if (st === 'loading' || st === 'error') apply(audioEngine.getBankMessage(), st);
      void audioEngine.initBank();
    }
    return () => {
      off();
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, [isUnlocked8Bar]);

  const updateTrack = useCallback((trackIndex: number, updates: Partial<ChordTrackState>) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], ...updates };
      return copy;
    });
  }, []);

  const updateTrackAdsr = useCallback((trackIndex: number, adsrUpdates: Partial<EnvelopeADSR>) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = {
        ...copy[trackIndex],
        adsr: { ...copy[trackIndex].adsr, ...adsrUpdates },
      };
      return copy;
    });
  }, []);

  // Hapus baris instrumen (dikosongkan & dinonaktifkan; baris 1 tidak bisa dihapus).
  const removeTrack = useCallback((trackIndex: number) => {
    try {
      audioEngine.stopAllChords(0.04);
    } catch {
      // Abaikan jika context belum aktif
    }
    setChordTracks((prev) =>
      prev.map((t, i) =>
        i === trackIndex
          ? { ...t, enabled: false, muted: false, solo: false, ...emptyTrackData(layoutRef.current.totalSteps) }
          : t
      )
    );
  }, []);

  const updateDrumMix = useCallback((id: string, patch: Partial<DrumMixState>) => {
    setDrumMix((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const updateDrumAdsr = useCallback((id: string, patch: Partial<EnvelopeADSR>) => {
    setDrumMix((prev) => ({ ...prev, [id]: { ...prev[id], adsr: { ...prev[id].adsr, ...patch } } }));
  }, []);

  const openInstrumentPicker = useCallback((trackIndex: number) => setPickerTrack(trackIndex), []);

  // Tambah baris instrumen baru di bawah, lalu langsung buka pemilih instrumennya.
  const addChordTrack = () => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    const idx = chordTracks.findIndex((t) => !t.enabled);
    if (idx === -1) return;
    updateTrack(idx, { enabled: true });
    setPickerTrack(idx);
  };

  const isTrackAudible = (track: ChordTrackState, allTracks: ChordTrackState[]) => {
    if (!track.enabled || track.muted) return false;
    const anySolo = allTracks.some((t) => t.enabled && t.solo);
    if (anySolo) return track.solo;
    return true;
  };

  // Live drum: bila dinamika menyala, level 1–4 (pp/p/f/ff) dihitung dari jarak klik ke pusat pad;
  // bila mati, semua pukulan memakai level tetap.
  const [drumHit, setDrumHit] = useState<{ id: string; level: number } | null>(null);
  const [drumHover, setDrumHover] = useState<{ id: string; level: number } | null>(null);
  const drumHitTimer = useRef<number | undefined>(undefined);

  // Rekam satu pukulan live: dibulatkan ke step terdekat dari ketukan yang sedang berjalan (kompensasi latensi keluaran audio).
  const recordDrumHit = (drumId: string, level: number, audioTime: number) => {
    const L = liveRef.current;
    const q = recentStepsRef.current;
    if (!L || !L.isDrumLoopActive || q.length === 0) return;
    const ctx = audioEngine.getAudioContext();
    const latency = Math.min(0.25, ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) + (ctx.baseLatency || 0));
    const t = audioTime - latency;
    const stepSec = 60 / L.bpm / 4;
    let best = -1;
    let bestDist = Infinity;
    for (const e of q) {
      const d = Math.abs(e.time - t);
      if (d < bestDist) {
        bestDist = d;
        best = e.step;
      }
    }
    if (best < 0 || bestDist > stepSec) return;
    setDrumGrid((prev) => {
      const row = [...(prev[drumId] || Array(layoutRef.current.totalSteps).fill(0))];
      row[best] = level;
      return { ...prev, [drumId]: row };
    });
  };

  const triggerDrum = (type: DrumInstrument['id'], level = 4, eventTimeStamp?: number) => {
    const lv = dynamicsOn ? Math.max(1, Math.min(DRUM_LEVEL_MAX, level)) : DRUM_FLAT_LEVEL;
    const m = drumMix[type];
    audioEngine.playDrumSound(type, selectedDrumKit, (drumVolume / 100) * ((m?.volume ?? 100) / 100) * DRUM_LEVEL_GAIN[lv], m?.adsr);
    setActivePadAnim(type);
    setDrumHit({ id: type, level: lv });
    window.clearTimeout(drumHitTimer.current);
    drumHitTimer.current = window.setTimeout(() => {
      setActivePadAnim(null);
      setDrumHit(null);
    }, 350);
    if (isRecordingRef.current) recordDrumHit(type, lv, audioTimeOfEvent(eventTimeStamp));
  };
  const triggerDrumRef = useRef(triggerDrum);
  triggerDrumRef.current = triggerDrum;

  const toggleDynamics = () => {
    setDynamicsOn((v) => !v);
    setDrumPicker(null);
    setDrumHover(null);
  };
  const levelAtPointer = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return levelFromOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2, r.height / 2);
  };


  // ---------------------------------------------------------------------------
  // MODE EDIT / PILIH, DINAMIKA DRUM, PANJANG AKOR BARU
  // ---------------------------------------------------------------------------
  const [editMode, setEditMode] = useState<EditMode>('edit');
  const modeRef = useRef<EditMode>('edit');
  modeRef.current = editMode;
  const getMode = useCallback(() => modeRef.current, []);

  // Popover pemilih dinamika drum (pp / p / f / ff), muncul lewat klik kanan / tahan lama pada pad.
  const [drumPicker, setDrumPicker] = useState<{ drumId: string; stepIdx: number; x: number; y: number } | null>(null);
  const closeDrumPicker = useCallback(() => setDrumPicker(null), []);

  // Panjang default akor yang baru dipasang (dalam step).
  const [newChordLen, setNewChordLen] = useState<number>(INITIAL_STEPS_PER_BAR);
  const newChordLenRef = useRef(newChordLen);
  newChordLenRef.current = newChordLen;

  // Penanda gestur beruntun (mis. menyeret panjang akor) supaya satu seretan = satu langkah undo.
  const coalesceUntilRef = useRef(0);
  const coalescingRef = useRef(false);

  // Pasang dinamika pada pad (0 = hapus) lalu bunyikan pratinjau bila drum tidak sedang diputar.
  const setDrumLevel = useCallback((drumId: string, stepIndex: number, level: number) => {
    const L = liveRef.current;
    const next = clampLevel(level);
    setDrumGrid((prev) => {
      const row = [...(prev[drumId] || Array(layoutRef.current.totalSteps).fill(0))];
      row[stepIndex] = next;
      return { ...prev, [drumId]: row };
    });
    if (next > 0 && L && !L.isDrumLoopActive) {
      const m = L.drumMix[drumId];
      audioEngine.playDrumSound(
        drumId,
        L.selectedDrumKit,
        (L.drumVolume / 100) * ((m?.volume ?? 100) / 100) * DRUM_LEVEL_GAIN[next],
        m?.adsr
      );
    }
  }, []);

  // Klik pad drum = naik bertahap: kosong → pp → p → f → ff → kosong. Tiap klik dibunyikan sebagai pratinjau.
  // Dinamika mati: klik hanya memasang / menghapus pad (level tetap).
  const cycleDrumStep = useCallback(
    (drumId: string, stepIndex: number) => {
      const spb = layoutRef.current.stepsPerBar;
      if (!gateRef.current.isUnlocked8Bar && Math.floor(stepIndex / spb) > 0) {
        gateRef.current.onUnlockEditor();
        return;
      }
      const cur = clampLevel(liveRef.current?.drumGrid[drumId]?.[stepIndex]);
      if (liveRef.current && !liveRef.current.dynamicsOn) {
        setDrumLevel(drumId, stepIndex, cur > 0 ? 0 : DRUM_FLAT_LEVEL);
        return;
      }
      setDrumLevel(drumId, stepIndex, (cur + 1) % (DRUM_LEVEL_MAX + 1));
    },
    [setDrumLevel]
  );

  // Klik kanan / tahan lama pada pad = menu pilih dinamika langsung (atau hapus). Tidak aktif bila dinamika mati.
  const openDrumPicker = useCallback((drumId: string, stepIndex: number, el: HTMLElement) => {
    if (modeRef.current !== 'edit' || !liveRef.current?.dynamicsOn) return;
    const spb = layoutRef.current.stepsPerBar;
    if (!gateRef.current.isUnlocked8Bar && Math.floor(stepIndex / spb) > 0) {
      gateRef.current.onUnlockEditor();
      return;
    }
    const r = el.getBoundingClientRect();
    setDrumPicker({ drumId, stepIdx: stepIndex, x: r.left + r.width / 2, y: r.bottom });
  }, []);

  // Pilih akor di sebuah sel: kosong → buat not baru (panjang default), blok → ganti akor, "-" → hapus not.
  const setTrackChordStep = useCallback((trackIndex: number, stepIndex: number, padIdx: number) => {
    const barIndex = Math.floor(stepIndex / layoutRef.current.stepsPerBar);
    if (!gateRef.current.isUnlocked8Bar && barIndex > 0) {
      gateRef.current.onUnlockEditor();
      return;
    }
    setChordTracks((prev) => {
      const copy = [...prev];
      const t = copy[trackIndex];
      let data: { steps: number[]; lens: number[] };
      if (padIdx < 0) {
        data = removeNote(t.steps, t.lens, stepIndex);
      } else if (t.steps[stepIndex] >= 0) {
        const steps = [...t.steps];
        steps[stepIndex] = padIdx;
        data = { steps, lens: t.lens };
      } else {
        data = insertNote(t.steps, t.lens, stepIndex, padIdx, newChordLenRef.current);
      }
      copy[trackIndex] = { ...t, ...data };
      return copy;
    });
  }, []);

  const resizeChordNote = useCallback((trackIndex: number, start: number, newLen: number) => {
    coalesceUntilRef.current = performance.now() + 350;
    setChordTracks((prev) => {
      const t = prev[trackIndex];
      if (!t || t.steps[start] < 0) return prev;
      const next = resizeNote(t.steps, t.lens, start, newLen);
      if (next.lens[start] === t.lens[start]) return prev;
      const copy = [...prev];
      copy[trackIndex] = { ...t, lens: next.lens };
      return copy;
    });
  }, []);

  // ---------------------------------------------------------------------------
  // SELEKSI, SALIN, POTONG, TEMPEL, DUPLIKAT, HAPUS
  // Pilihan = himpunan sel (boleh terpisah-pisah). Tiga cara memilih:
  //  - Pilih  : ketuk / seret area; pilihan lama DIGANTI.
  //  - Pilih+ : ketuk pad untuk menambah (ketuk lagi = lepas) tanpa melepas pilihan lama; seret = tambah area.
  //  - Shift+seret di mode Edit (perluas area dari titik awal sebelumnya).
  // ---------------------------------------------------------------------------
  const [sel, setSel] = useState<Selection | null>(null);
  const activeSel = sel && sel.tab === activeTab ? sel : null;
  const selRef = useRef<Selection | null>(null);
  selRef.current = activeSel;
  const anchorRef = useRef<{ r: number; s: number } | null>(null);
  const [clips, setClips] = useState<{ drum: DrumClip | null; chord: ChordClip | null }>({ drum: null, chord: null });
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const sectionRef = useRef<HTMLElement | null>(null);
  const focusInsideRef = useRef(false);
  const modalOpenRef = useRef(false);
  modalOpenRef.current = editingPadIndex !== null || pickerTrack !== null || isExportModalOpen || isExportMenuOpen || drumPicker !== null;
  const activeTabRef = useRef<PadTab>(activeTab);
  activeTabRef.current = activeTab;

  const rowCountOf = (tab: PadTab) => (tab === 'drum' ? DRUM_INSTRUMENTS.length : 4);

  const makeSel = (tab: PadTab, cells: Iterable<number>): Selection => ({ tab, cells: new Set<number>(cells) });

  // Semua sel dalam persegi (a..b). Untuk akor, step yang tertutup sebuah not diwakili step AWAL not itu,
  // sehingga not selalu terpilih utuh.
  const buildCells = (tab: PadTab, a: { r: number; s: number }, b: { r: number; s: number }): number[] => {
    const r1 = Math.min(a.r, b.r);
    const r2 = Math.max(a.r, b.r);
    const s1 = Math.min(a.s, b.s);
    const s2 = Math.max(a.s, b.s);
    const tracks = liveRef.current?.chordTracks ?? [];
    const out: number[] = [];
    for (let r = r1; r <= r2; r++) {
      const t = tab === 'chord' ? tracks[r] : undefined;
      for (let st = s1; st <= s2; st++) {
        let at = st;
        if (t) {
          const cs = noteStartCovering(t.steps, t.lens, st);
          if (cs >= 0) at = cs;
        }
        out.push(cellKey(r, at));
      }
    }
    return out;
  };

  // Ubah koordinat pointer menjadi (baris, step) dari geometri baris grid (blok akor tidak mengganggu).
  const pointToCell = (x: number, y: number): { r: number; s: number } | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const rowEl = el?.closest<HTMLElement>('[data-rowgrid]');
    if (!rowEl) return null;
    const rect = rowEl.getBoundingClientRect();
    const v = viewRef.current;
    const count = v.count * v.stepsPerBar;
    const frac = (x - rect.left) / rect.width;
    const s = v.start * v.stepsPerBar + Math.max(0, Math.min(count - 1, Math.floor(frac * count)));
    return { r: Number(rowEl.dataset.row), s };
  };

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const mode = modeRef.current;
    if (mode === 'edit' && !e.shiftKey) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const cell = pointToCell(e.clientX, e.clientY);
    if (!cell) return;
    const tab = activeTabRef.current;
    e.preventDefault();

    let onMove: (c: { r: number; s: number }) => void;
    if (mode === 'selectAdd') {
      // Tambah / lepas satu pad tanpa menyentuh pilihan lain; seret = tambahkan seluruh area.
      const base = new Set<number>(selRef.current ? selRef.current.cells : []);
      const start = cell;
      const here = buildCells(tab, cell, cell);
      const already = here.every((k) => base.has(k));
      anchorRef.current = cell;
      setSel(makeSel(tab, already ? [...base].filter((k) => !here.includes(k)) : [...base, ...here]));
      onMove = (c) => {
        if (c.r === start.r && c.s === start.s) return;
        setSel(makeSel(tab, [...base, ...buildCells(tab, start, c)]));
      };
    } else {
      // Pilih (area baru menggantikan pilihan lama). Shift = perluas dari titik awal sebelumnya.
      const anchor = e.shiftKey && selRef.current && anchorRef.current ? anchorRef.current : cell;
      anchorRef.current = anchor;
      setSel(makeSel(tab, buildCells(tab, anchor, cell)));
      onMove = (c) => {
        if (anchorRef.current) setSel(makeSel(tab, buildCells(tab, anchorRef.current, c)));
      };
    }

    const move = (ev: PointerEvent) => {
      const c = pointToCell(ev.clientX, ev.clientY);
      if (c) onMove(c);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Klik label BAR = pilih seluruh bar itu (Shift+klik, atau mode Pilih+ = tambahkan ke pilihan).
  const selectBar = (barIdx: number, extend: boolean) => {
    const tab = activeTabRef.current;
    const S = layoutRef.current.stepsPerBar;
    const s1 = barIdx * S;
    const cells = buildCells(tab, { r: 0, s: s1 }, { r: rowCountOf(tab) - 1, s: s1 + S - 1 });
    const prev = selRef.current;
    anchorRef.current = { r: 0, s: s1 };
    setSel(makeSel(tab, extend && prev ? [...prev.cells, ...cells] : cells));
  };

  const buildClip = (selection: Selection): SeqClip | null => {
    const L = liveRef.current;
    const b = selectionBounds(selection.cells);
    if (!L || !b) return null;
    const rows = b.r2 - b.r1 + 1;
    const width = b.s2 - b.s1 + 1;
    const mask = Array.from({ length: rows }, () => Array<boolean>(width).fill(false));
    selection.cells.forEach((k) => {
      mask[cellRow(k) - b.r1][cellStep(k) - b.s1] = true;
    });
    if (selection.tab === 'drum') {
      const data: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const id = DRUM_INSTRUMENTS[b.r1 + r]?.id;
        const row = (id && L.drumGrid[id]) || [];
        data.push(Array.from({ length: width }, (_, i) => (mask[r][i] ? clampLevel(row[b.s1 + i]) : 0)));
      }
      return { kind: 'drum', rows, width, data, mask };
    }
    const data: ChordClip['data'] = [];
    for (let r = 0; r < rows; r++) {
      const t = L.chordTracks[b.r1 + r];
      data.push(
        Array.from({ length: width }, (_, i) => {
          const st = b.s1 + i;
          return mask[r][i] && t && t.steps[st] >= 0 ? { pad: t.steps[st], len: t.lens[st] || 1 } : null;
        })
      );
    }
    return { kind: 'chord', rows, width, data, mask };
  };

  const copySelection = (): boolean => {
    const cur = selRef.current;
    if (!cur) return false;
    const clip = buildClip(cur);
    if (!clip) return false;
    const next = { ...clipsRef.current, [clip.kind]: clip } as typeof clips;
    clipsRef.current = next;
    setClips(next);
    return true;
  };

  const deleteSelection = () => {
    const cur = selRef.current;
    if (!cur || cur.cells.size === 0) return;
    const byRow = groupCellsByRow(cur.cells);
    if (cur.tab === 'drum') {
      setDrumGrid((prev) => {
        const out = { ...prev };
        byRow.forEach((steps, r) => {
          const id = DRUM_INSTRUMENTS[r]?.id;
          if (!id) return;
          const row = [...(prev[id] || [])];
          steps.forEach((st) => {
            row[st] = 0;
          });
          out[id] = row;
        });
        return out;
      });
    } else {
      setChordTracks((prev) =>
        prev.map((t, ti) => {
          const steps = byRow.get(ti);
          if (!steps || !t.enabled) return t;
          const st = [...t.steps];
          const ln = [...t.lens];
          steps.forEach((s0) => {
            st[s0] = -1;
            ln[s0] = 0;
          });
          return { ...t, steps: st, lens: ln };
        })
      );
    }
  };

  const cutSelection = () => {
    if (copySelection()) deleteSelection();
  };

  // Tempel `clip` dengan pojok kiri-atas di (baris r0, step s0). Hanya sel bertanda mask yang ditulis.
  // Mengembalikan sel yang ditempel (menjadi pilihan baru).
  const pasteClip = (clip: SeqClip, r0: number, s0: number): Set<number> | null => {
    const { totalSteps: total, stepsPerBar: spb } = layoutRef.current;
    if (s0 >= total) {
      onSuccessToast('Tidak ada ruang untuk menempel di sini (sudah di ujung grid).');
      return null;
    }
    const lastStep = Math.min(total - 1, s0 + clip.width - 1);
    if (!gateRef.current.isUnlocked8Bar && Math.floor(lastStep / spb) > 0) {
      gateRef.current.onUnlockEditor();
      return null;
    }
    const rowsMax = clip.kind === 'drum' ? DRUM_INSTRUMENTS.length : 4;
    const rowsUsed = Math.min(clip.rows, rowsMax - r0);
    if (rowsUsed <= 0) return null;
    const inMask = (r: number, i: number) => !clip.mask || Boolean(clip.mask[r]?.[i]);

    const pasted = new Set<number>();
    for (let r = 0; r < rowsUsed; r++) {
      for (let i = 0; i < clip.width && s0 + i <= lastStep; i++) {
        if (inMask(r, i)) pasted.add(cellKey(r0 + r, s0 + i));
      }
    }
    if (pasted.size === 0) return null;

    if (clip.kind === 'drum') {
      setDrumGrid((prev) => {
        const out = { ...prev };
        for (let r = 0; r < rowsUsed; r++) {
          const id = DRUM_INSTRUMENTS[r0 + r].id;
          const row = [...(prev[id] || Array(total).fill(0))];
          for (let i = 0; i < clip.width && s0 + i <= lastStep; i++) {
            if (inMask(r, i)) row[s0 + i] = clip.data[r][i];
          }
          out[id] = row;
        }
        return out;
      });
    } else {
      setChordTracks((prev) =>
        prev.map((t, ti) => {
          const r = ti - r0;
          if (r < 0 || r >= rowsUsed || !t.enabled) return t;
          let steps = [...t.steps];
          let lens = [...t.lens];
          // Not yang menutupi titik tempel dipotong; sel tujuan dikosongkan (mode "timpa").
          const cs = noteStartCovering(steps, lens, s0);
          if (cs >= 0 && cs < s0 && inMask(r, 0)) lens[cs] = s0 - cs;
          for (let i = 0; i < clip.width && s0 + i <= lastStep; i++) {
            if (!inMask(r, i)) continue;
            steps[s0 + i] = -1;
            lens[s0 + i] = 0;
          }
          for (let i = 0; i < clip.width && s0 + i <= lastStep; i++) {
            if (!inMask(r, i)) continue;
            const cell = clip.data[r][i];
            if (cell) ({ steps, lens } = insertNote(steps, lens, s0 + i, cell.pad, cell.len));
          }
          return { ...t, steps, lens };
        })
      );
    }
    return pasted;
  };

  const adoptPasted = (kind: PadTab, cells: Set<number>) => {
    const nb = selectionBounds(cells);
    if (nb) anchorRef.current = { r: nb.r1, s: nb.s1 };
    setSel({ tab: kind, cells });
  };

  const pasteSelection = () => {
    const clip = clipsRef.current[activeTabRef.current];
    if (!clip) return;
    const cur = selRef.current;
    const b = cur ? selectionBounds(cur.cells) : null;
    const res = pasteClip(clip, b ? b.r1 : 0, b ? b.s1 : playheadStepRef.current);
    if (res) adoptPasted(clip.kind, res);
  };

  // Duplikat: salin pilihan lalu tempel TEPAT setelahnya; pilihan pindah ke hasil, jadi bisa diulang beruntun.
  const duplicateSelection = () => {
    const cur = selRef.current;
    if (!cur) return;
    const clip = buildClip(cur);
    const b = selectionBounds(cur.cells);
    if (!clip || !b) return;
    const res = pasteClip(clip, b.r1, b.s2 + 1);
    if (res) adoptPasted(clip.kind, res);
  };

  const selectAll = () => {
    const tab = activeTabRef.current;
    anchorRef.current = { r: 0, s: 0 };
    setSel(makeSel(tab, buildCells(tab, { r: 0, s: 0 }, { r: rowCountOf(tab) - 1, s: layoutRef.current.totalSteps - 1 })));
  };

  const clearSelection = () => setSel(null);

  // Step terpilih per baris (untuk menandai sel di grid). Identitas Set stabil selama pilihan tidak berubah.
  const rowSelSets = useMemo<Array<ReadonlySet<number> | undefined>>(() => {
    const rows: Array<ReadonlySet<number> | undefined> = [];
    if (!activeSel) return rows;
    groupCellsByRow(activeSel.cells).forEach((steps, r) => {
      rows[r] = new Set(steps);
    });
    return rows;
  }, [activeSel]);

  // Panjang not akor yang sedang terpilih (untuk kolom angka panjang).
  const selectedNoteInfo = useMemo(() => {
    if (!activeSel || activeSel.tab !== 'chord') return { count: 0, len: 1 };
    let count = 0;
    let len = 1;
    groupCellsByRow(activeSel.cells).forEach((steps, r) => {
      const t = chordTracks[r];
      if (!t || !t.enabled) return;
      steps.forEach((st) => {
        if (t.steps[st] >= 0) {
          if (count === 0) len = t.lens[st] || 1;
          count++;
        }
      });
    });
    return { count, len };
  }, [activeSel, chordTracks]);

  const setSelectedNotesLength = (newLen: number) => {
    const cur = selRef.current;
    if (!cur || cur.tab !== 'chord') return;
    const byRow = groupCellsByRow(cur.cells);
    setChordTracks((prev) =>
      prev.map((t, ti) => {
        const steps = byRow.get(ti);
        if (!steps || !t.enabled) return t;
        let data = { steps: t.steps, lens: t.lens };
        steps.forEach((st) => {
          if (data.steps[st] >= 0) data = resizeNote(data.steps, data.lens, st, newLen);
        });
        return { ...t, lens: data.lens };
      })
    );
  };

  // ---------------------------------------------------------------------------
  // UNDO / REDO (terpisah per tab: Drum Pad dan Chord Pad punya riwayat sendiri)
  // Perubahan pola dicatat otomatis dari perubahan state grid, jadi semua jalur edit (klik, tempel, hapus,
  // bersihkan, seret panjang akor, dst.) ikut tercatat tanpa perlu dibungkus satu per satu.
  // ---------------------------------------------------------------------------
  const histRef = useRef<{
    drum: { past: DrumSnap[]; future: DrumSnap[] };
    chord: { past: ChordSnap[]; future: ChordSnap[] };
  }>({ drum: { past: [], future: [] }, chord: { past: [], future: [] } });
  const lastDrumRef = useRef<DrumSnap>(drumGrid);
  const lastChordRef = useRef<ChordSnap>(snapChord(chordTracks));
  const historyResetRef = useRef(false);
  const [histFlags, setHistFlags] = useState({ drumU: false, drumR: false, chordU: false, chordR: false });

  const syncHistFlags = useCallback(() => {
    const H = histRef.current;
    const next = {
      drumU: H.drum.past.length > 0,
      drumR: H.drum.future.length > 0,
      chordU: H.chord.past.length > 0,
      chordR: H.chord.future.length > 0,
    };
    setHistFlags((p) => (p.drumU === next.drumU && p.drumR === next.drumR && p.chordU === next.chordU && p.chordR === next.chordR ? p : next));
  }, []);

  useEffect(() => {
    const H = histRef.current;
    const chordNow = snapChord(chordTracks);
    if (historyResetRef.current) {
      // Ukuran grid berubah (ganti birama): riwayat lama tidak cocok lagi.
      historyResetRef.current = false;
      H.drum = { past: [], future: [] };
      H.chord = { past: [], future: [] };
      lastDrumRef.current = drumGrid;
      lastChordRef.current = chordNow;
      syncHistFlags();
      return;
    }
    if (drumGrid !== lastDrumRef.current) {
      // Selama merekam, seluruh pukulan satu rekaman dihitung SATU langkah undo.
      const inTake = isRecordingRef.current;
      if (!(inTake && recTakeOpenRef.current)) {
        H.drum.past.push(lastDrumRef.current);
        if (H.drum.past.length > HISTORY_LIMIT) H.drum.past.shift();
      }
      if (inTake) recTakeOpenRef.current = true;
      H.drum.future = [];
      lastDrumRef.current = drumGrid;
    }
    if (!chordSnapEqual(chordNow, lastChordRef.current)) {
      const coalesce = performance.now() < coalesceUntilRef.current;
      if (!(coalesce && coalescingRef.current)) {
        H.chord.past.push(lastChordRef.current);
        if (H.chord.past.length > HISTORY_LIMIT) H.chord.past.shift();
      }
      coalescingRef.current = coalesce;
      H.chord.future = [];
      lastChordRef.current = chordNow;
    }
    syncHistFlags();
  }, [drumGrid, chordTracks, syncHistFlags]);

  const restoreChordSnap = (snap: ChordSnap) => {
    stopAllLiveChords();
    setChordTracks((prev) =>
      prev.map((t, i) => (snap[i] ? { ...t, steps: snap[i].steps, lens: snap[i].lens, enabled: snap[i].enabled } : t))
    );
  };

  const undo = () => {
    const H = histRef.current;
    if (activeTabRef.current === 'drum') {
      const snap = H.drum.past.pop();
      if (!snap) return;
      H.drum.future.push(lastDrumRef.current);
      lastDrumRef.current = snap;
      setDrumGrid(snap);
    } else {
      const snap = H.chord.past.pop();
      if (!snap) return;
      H.chord.future.push(lastChordRef.current);
      lastChordRef.current = snap;
      restoreChordSnap(snap);
    }
    coalescingRef.current = false;
    setSel(null);
    syncHistFlags();
  };

  const redo = () => {
    const H = histRef.current;
    if (activeTabRef.current === 'drum') {
      const snap = H.drum.future.pop();
      if (!snap) return;
      H.drum.past.push(lastDrumRef.current);
      lastDrumRef.current = snap;
      setDrumGrid(snap);
    } else {
      const snap = H.chord.future.pop();
      if (!snap) return;
      H.chord.past.push(lastChordRef.current);
      lastChordRef.current = snap;
      restoreChordSnap(snap);
    }
    coalescingRef.current = false;
    setSel(null);
    syncHistFlags();
  };

  const canUndo = activeTab === 'drum' ? histFlags.drumU : histFlags.chordU;
  const canRedo = activeTab === 'drum' ? histFlags.drumR : histFlags.chordR;

  // Pintasan keyboard (aktif hanya saat pengguna terakhir berinteraksi di dalam Pad Studio dan tidak ada popup).
  const opsRef = useRef({
    copy: copySelection,
    cut: cutSelection,
    paste: pasteSelection,
    del: deleteSelection,
    dup: duplicateSelection,
    all: selectAll,
    clear: clearSelection,
    undo,
    redo,
  });
  opsRef.current = {
    copy: copySelection,
    cut: cutSelection,
    paste: pasteSelection,
    del: deleteSelection,
    dup: duplicateSelection,
    all: selectAll,
    clear: clearSelection,
    undo,
    redo,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!focusInsideRef.current || modalOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      const inGrid = Boolean(t?.closest?.('[data-rowgrid]'));
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (tag === 'SELECT' && !inGrid) || t?.isContentEditable) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const ops = opsRef.current;
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) ops.redo();
        else ops.undo();
      } else if (mod && k === 'y') {
        e.preventDefault();
        ops.redo();
      } else if (mod && k === 'c') {
        if (selRef.current) {
          e.preventDefault();
          ops.copy();
        }
      } else if (mod && k === 'x') {
        if (selRef.current) {
          e.preventDefault();
          ops.cut();
        }
      } else if (mod && k === 'v') {
        e.preventDefault();
        ops.paste();
      } else if (mod && k === 'd') {
        if (selRef.current) {
          e.preventDefault();
          ops.dup();
        }
      } else if (mod && k === 'a') {
        e.preventDefault();
        ops.all();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selRef.current) {
          e.preventDefault();
          ops.del();
        }
      } else if (e.key === 'Escape') {
        ops.clear();
      }
    };
    const onDown = (e: PointerEvent) => {
      focusInsideRef.current = Boolean(sectionRef.current?.contains(e.target as Node));
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  // Keyboard fisik -> pad drum live: Q W E R T Y U I O P (kiri ke kanan). Aktif di tab Drum Pad saat Pad Studio terlihat
  // di layar dan fokus tidak sedang di kolom ketik. Dinamika dipilih dengan menahan tombol koma / titik lalu menekan pad:
  //   ,  = pp      Shift + ,  = p      .  = f      Shift + .  = ff      (tanpa keduanya: f, Shift saja: ff)
  // Hanya berlaku bila dinamika menyala.
  useEffect(() => {
    const dyn = { comma: false, period: false };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const isComma = e.code === 'Comma';
      const isPeriod = e.code === 'Period';
      const inst = DRUM_BY_CODE[e.code];
      if (!inst && !isComma && !isPeriod) return;
      if (activeTabRef.current !== 'drum' || modalOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const sec = sectionRef.current;
      if (!sec) return;
      const r = sec.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) return;
      e.preventDefault();
      setHasKeyboard(true);
      if (isComma) {
        dyn.comma = true;
        return;
      }
      if (isPeriod) {
        dyn.period = true;
        return;
      }
      if (e.repeat || !inst) return;
      let level = e.shiftKey ? 4 : 3;
      if (dyn.comma) level = e.shiftKey ? 2 : 1;
      else if (dyn.period) level = e.shiftKey ? 4 : 3;
      triggerDrumRef.current(inst.id, level, e.timeStamp);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Comma') dyn.comma = false;
      else if (e.code === 'Period') dyn.period = false;
    };
    const reset = () => {
      dyn.comma = false;
      dyn.period = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', reset);
    };
  }, []);

  const handleSeekStep = (targetStep: number) => {
    const barIdx = Math.floor(targetStep / stepsPerBar);
    if (!isUnlocked8Bar && barIdx > 0) {
      onUnlockEditor();
      return;
    }
    audioEngine.getAudioContext().resume();
    stepRef.current = targetStep;
    visualQueueRef.current = [];
    paintPlayhead(targetStep);
  };

  const resetToBeginning = () => {
    const startStep = Math.max(0, (loopStartBar - 1) * stepsPerBar + (loopStartBeat - 1));
    stepRef.current = startStep;
    visualQueueRef.current = [];
    paintPlayhead(startStep);
  };

  const toggleDrumLoop = () => {
    audioEngine.getAudioContext().resume();
    setIsDrumLoopActive(!isDrumLoopActive);
  };

  // Rekam: pukulan dari live drum trigger pads (klik / sentuh / keyboard) masuk ke sequencer drum.
  // Jika drum belum jalan, pemutaran dimulai dari awal wilayah loop. Berhenti otomatis saat drum berhenti / pindah tab.
  const toggleRecording = () => {
    if (activeTab !== 'drum') return;
    audioEngine.getAudioContext().resume();
    if (isRecording) {
      setIsRecording(false);
      return;
    }
    recTakeOpenRef.current = false;
    if (!isDrumLoopActive) {
      resetToBeginning();
      setIsDrumLoopActive(true);
    }
    setIsRecording(true);
  };
  useEffect(() => {
    if (isRecording && (!isDrumLoopActive || activeTab !== 'drum')) setIsRecording(false);
  }, [isRecording, isDrumLoopActive, activeTab]);

  const preparingChordsRef = useRef(false);
  const toggleChordLoop = async () => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    if (preparingChordsRef.current) return;
    audioEngine.getAudioContext().resume();
    if (isChordLoopActive) {
      stopAllLiveChords();
      setIsChordLoopActive(false);
      return;
    }
    // Panaskan sample akor sebelum mulai, tapi JANGAN membuat pengguna menunggu:
    // - Bank sudah siap: tunggu paling lama 350 ms (biasanya cukup), sisanya jalan di latar belakang.
    // - Bank belum siap: langsung mulai. Engine membunyikan suara sintesis sementara dan otomatis
    //   pindah ke sample SF2 begitu bank selesai dimuat (sebelumnya tombol putar menunggu seluruh unduhan).
    preparingChordsRef.current = true;
    try {
      if (audioEngine.isLoaded) {
        const warm = audioEngine.prewarmChordSamples(chordWarmPairs).catch(() => false);
        await Promise.race([warm, new Promise<void>((r) => window.setTimeout(r, 350))]);
      } else {
        void audioEngine.initBank();
        void audioEngine.prewarmChordSamples(chordWarmPairs).catch(() => false);
      }
    } finally {
      preparingChordsRef.current = false;
    }
    setIsChordLoopActive(true);
  };

  // Track yang dibunyikan pad live: satu track pilihan, atau semua track aktif (berlapis).
  const liveTargets = useMemo<number[]>(() => {
    const enabled = chordTracks.map((t, i) => (t.enabled ? i : -1)).filter((i) => i >= 0);
    if (liveSel === 'all' && enabled.length > 1) return enabled;
    if (typeof liveSel === 'number' && chordTracks[liveSel]?.enabled) return [liveSel];
    return [0];
  }, [chordTracks, liveSel]);
  const liveMain = chordTracks[liveTargets[0]] ?? chordTracks[0];

  // Pad akor live: tekan = akor berbunyi dan DITAHAN selama pad ditekan; lepas = akor dilepas.
  // Ketukan singkat tetap berbunyi minimal CHORD_TAP_MIN_MS supaya tidak terpotong. Tiap pad × instrumen memakai kunci
  // sendiri di engine, jadi beberapa pad bisa ditahan bersamaan dan mode "Semua" benar-benar melapis semua instrumen
  // (dengan ADSR masing-masing) tanpa saling memotong.
  const CHORD_HOLD_SEC = 30;
  const CHORD_TAP_MIN_MS = 900;
  const [litChords, setLitChords] = useState<number[]>([]);
  const heldChordsRef = useRef<
    Map<
      number,
      {
        since: number;
        timer?: number;
        voices: Array<{ trackKey: string; midiNotes: number[]; program: number; adsr: EnvelopeADSR }>;
      }
    >
  >(new Map());

  const startChordHold = (padIdx: number) => {
    const info = padInfo[padIdx];
    if (!info) return;
    const ctx = audioEngine.getAudioContext();
    ctx.resume();
    const prev = heldChordsRef.current.get(padIdx);
    if (prev?.timer !== undefined) window.clearTimeout(prev.timer);
    const voices: Array<{ trackKey: string; midiNotes: number[]; program: number; adsr: EnvelopeADSR }> = [];
    liveTargets.forEach((ti) => {
      const t = chordTracks[ti];
      if (!t) return;
      const trackKey = `live${t.id}-p${padIdx}`;
      audioEngine.scheduleChordEvent({
        trackKey,
        midiNotes: info.midiNotes,
        program: t.program,
        when: ctx.currentTime,
        holdSec: CHORD_HOLD_SEC,
        volume: (t.volume / 100) * (chordMasterVolume / 100),
        adsr: t.adsr,
      });
      voices.push({ trackKey, midiNotes: info.midiNotes, program: t.program, adsr: { ...t.adsr } });
    });
    heldChordsRef.current.set(padIdx, { since: performance.now(), voices });
    setLitChords((l) => (l.includes(padIdx) ? l : [...l, padIdx]));
  };

  // Lepas: engine hanya punya "choke" per kunci, jadi akor yang sama dipicu ulang dengan volume 0 untuk memotong halus
  // voice yang sedang ditahan (memakai waktu release instrumen).
  const releaseChordHold = (padIdx: number) => {
    const held = heldChordsRef.current.get(padIdx);
    if (!held) return;
    const doRelease = () => {
      const ctx = audioEngine.getAudioContext();
      held.voices.forEach((v) => {
        audioEngine.scheduleChordEvent({
          trackKey: v.trackKey,
          midiNotes: v.midiNotes,
          program: v.program,
          when: ctx.currentTime,
          holdSec: 0.05,
          volume: 0,
          adsr: v.adsr,
        });
      });
      heldChordsRef.current.delete(padIdx);
    };
    setLitChords((l) => l.filter((i) => i !== padIdx));
    const wait = Math.max(0, CHORD_TAP_MIN_MS - (performance.now() - held.since));
    if (wait > 0) held.timer = window.setTimeout(doRelease, wait);
    else doRelease();
  };

  // Lepas semua pad akor yang masih ditahan saat komponen dibongkar.
  useEffect(() => {
    const held = heldChordsRef.current;
    return () => {
      held.forEach((h) => {
        if (h.timer !== undefined) window.clearTimeout(h.timer);
      });
      held.clear();
    };
  }, []);

  const isAnySeqActive = isDrumLoopActive || isChordLoopActive;

  // Data turunan akor dihitung SEKALI per perubahan pad (bukan tiap render / tiap ketukan).
  const padInfo = useMemo<PadInfo[]>(
    () =>
      padChords.map((ch) => {
        const { midiNotes, displayName } = buildHarmonicChord(ch);
        return { midiNotes, displayName };
      }),
    [padChords]
  );

  // Opsi <select> sel akor dibuat sekali dan dipakai bersama oleh semua sel.
  const chordOptions = useMemo<React.ReactNode>(
    () => [
      <option key="empty" value={-1} className="bg-black text-gray-400">
        - Kosongkan -
      </option>,
      ...Array.from({ length: PAD_BANKS }, (_, bank) => (
        <optgroup key={bank} label={`Bank ${bank + 1}`}>
          {padInfo.slice(bank * PADS_PER_BANK, (bank + 1) * PADS_PER_BANK).map((p, i) => {
            const pIdx = bank * PADS_PER_BANK + i;
            return (
              <option key={pIdx} value={pIdx} className="bg-surface text-white font-bold">
                Pad #{pIdx + 1}: {p.displayName}
              </option>
            );
          })}
        </optgroup>
      )),
    ],
    [padInfo]
  );

  // Jendela tampilan: hanya bar yang terlihat yang digambar ke DOM.
  const viewSteps = barsPerView * stepsPerBar;
  const windowSteps = useMemo<number[]>(
    () => Array.from({ length: viewSteps }, (_, i) => viewStartBar * stepsPerBar + i),
    [viewStartBar, viewSteps, stepsPerBar]
  );
  const windowBars = useMemo<number[]>(
    () => Array.from({ length: barsPerView }, (_, i) => viewStartBar + i),
    [viewStartBar, barsPerView]
  );
  const gridStyle = useMemo<React.CSSProperties>(
    () => ({ gridTemplateColumns: `repeat(${viewSteps}, minmax(0, 1fr))` }),
    [viewSteps]
  );
  const gridMinWidth = viewSteps * 22 + (showMixer ? 320 : 260);

  // Pasangan (program, nada) yang dipakai grid akor + semua pad track utama (untuk bermain live).
  const chordWarmPairs = useMemo<Array<[number, number]>>(() => {
    const pairs: Array<[number, number]> = [];
    chordTracks.forEach((t, idx) => {
      if (!t.enabled) return;
      const used = new Set<number>();
      t.steps.forEach((v) => {
        if (v >= 0) used.add(v);
      });
      if (liveTargets.includes(idx)) {
        for (let i = padBank * PADS_PER_BANK; i < (padBank + 1) * PADS_PER_BANK; i++) used.add(i);
      }
      used.forEach((pi) => {
        padInfo[pi]?.midiNotes.forEach((n) => pairs.push([t.program, n]));
      });
    });
    return pairs;
  }, [chordTracks, padInfo, liveTargets, padBank]);
  const chordWarmKey = useMemo(
    () => Array.from(new Set(chordWarmPairs.map((p) => `${p[0]}:${p[1]}`))).sort().join(','),
    [chordWarmPairs]
  );

  // Panaskan sample akor di latar belakang setiap kali instrumen/akor yang dipakai berubah (ditunda 250 ms
  // supaya tidak berulang-ulang saat pengguna sedang mengedit).
  useEffect(() => {
    if (chordWarmPairs.length === 0 || !isUnlocked8Bar) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      audioEngine.prewarmChordSamples(chordWarmPairs, { shouldAbort: () => cancelled }).catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordWarmKey, isUnlocked8Bar]);

  // Cermin state terbaru untuk scheduler: scheduler membaca dari sini, jadi TIDAK perlu dibuat ulang
  // setiap grid/track/volume/tempo berubah (sebelumnya interval dihentikan & dibuat ulang tiap edit).
  liveRef.current = {
    bpm,
    isDrumLoopActive,
    isChordLoopActive,
    isSeqLooping,
    isUnlocked8Bar: Boolean(isUnlocked8Bar),
    stepsPerBar,
    drumGrid,
    drumMix,
    chordTracks,
    padInfo,
    dynamicsOn,
    isRecording,
    metronomeOn,
    beatStart: beatInfo.isBeatStart,
    selectedDrumKit,
    drumVolume,
    chordMasterVolume,
    loopStartBar,
    loopStartBeat,
    loopEndBar,
    loopEndBeat,
  };

  // Sample drum kit dimuat lebih dulu agar ketukan pertama tidak telat.
  useEffect(() => {
    audioEngine.preloadDrumKit(selectedDrumKit, DRUM_INSTRUMENTS.map((i) => i.id)).catch(() => {});
  }, [selectedDrumKit]);

  // Live Sequencer: scheduler Web Audio dengan lookahead.
  // Suara dijadwalkan di jam AudioContext (presisi tinggi) beberapa milidetik ke depan, jadi ritme tetap
  // rata walau thread utama sedang sibuk menggambar UI (penting di HP). Detaknya datang dari Web Worker.
  useEffect(() => {
    if (!isAnySeqActive) return;
    const ctx = audioEngine.getAudioContext();
    nextTimeRef.current = ctx.currentTime + 0.06;
    visualQueueRef.current = [];
    recentStepsRef.current = [];
    let stopped = false;
    let finishTimer: number | undefined;
    let stopTicker: (() => void) | undefined;

    // `stepsLeft` = sisa step sampai akhir wilayah loop, dipakai membatasi lama tahan akor.
    const scheduleStep = (L: LiveSeqState, step: number, when: number, stepSec: number, stepsLeft: number) => {
      // Catat ketukan ini (untuk membulatkan pukulan rekaman) dan bunyikan metronom bila sedang merekam.
      const trail = recentStepsRef.current;
      trail.push({ step, time: when });
      if (trail.length > 48) trail.shift();
      if (L.isRecording && L.metronomeOn) {
        const pos = step % L.stepsPerBar;
        if (L.beatStart[pos]) scheduleClick(ctx, when, pos === 0);
      }
      if (L.isDrumLoopActive) {
        for (const inst of DRUM_INSTRUMENTS) {
          const level = effLevel(clampLevel(L.drumGrid[inst.id]?.[step]), L.dynamicsOn);
          if (level > 0 && isDrumAudible(inst.id, L.drumMix)) {
            const m = L.drumMix[inst.id];
            audioEngine.scheduleDrumSound(
              inst.id,
              L.selectedDrumKit,
              (L.drumVolume / 100) * (m.volume / 100) * DRUM_LEVEL_GAIN[level],
              when,
              m.adsr
            );
          }
        }
      }
      if (L.isChordLoopActive) {
        for (const track of L.chordTracks) {
          if (!isTrackAudible(track, L.chordTracks)) continue;
          const padIdx = track.steps[step];
          if (padIdx === undefined || padIdx < 0) continue;
          const info = L.padInfo[padIdx];
          if (!info) continue;
          const effectiveVol = (track.volume / 100) * (L.chordMasterVolume / 100);
          // Akor ditahan sesuai panjang not-nya (tidak melewati akhir wilayah loop).
          const holdSteps = Math.max(1, Math.min(track.lens[step] || 1, stepsLeft));
          audioEngine.scheduleChordEvent({
            trackKey: `t${track.id}`,
            midiNotes: info.midiNotes,
            program: track.program,
            when,
            holdSec: holdSteps * stepSec,
            volume: effectiveVol,
            adsr: track.adsr,
          });
        }
      }
      visualQueueRef.current.push({ step, time: when });
    };

    const tick = () => {
      if (stopped) return;
      const L = liveRef.current;
      if (!L) return;
      const S = L.stepsPerBar;
      const stepSec = 60 / L.bpm / 4; // 1 step = 1/16 not; BPM per not seperempat

      // Tab sempat di-background / thread macet lama: lewati ketukan yang terlewat, jangan menumpuk sekaligus.
      if (nextTimeRef.current < ctx.currentTime - 0.1) {
        nextTimeRef.current = ctx.currentTime + 0.05;
      }

      while (nextTimeRef.current < ctx.currentTime + LOOKAHEAD_SEC) {
        const step = stepRef.current;
        const maxSteps = L.isUnlocked8Bar ? S * TOTAL_BARS : S;
        const rawEndStep = Math.min(maxSteps - 1, (L.loopEndBar - 1) * S + (L.loopEndBeat - 1));
        const rawStartStep = Math.max(0, (L.loopStartBar - 1) * S + (L.loopStartBeat - 1));
        const configuredEndStep = Math.max(0, rawEndStep);
        const configuredStartStep = Math.min(rawStartStep, configuredEndStep);

        scheduleStep(L, step, nextTimeRef.current, stepSec, Math.max(1, configuredEndStep - step + 1));
        nextTimeRef.current += stepSec;

        const nextStep = step + 1;
        const activeLoopTarget = nextStep > configuredEndStep ? configuredStartStep : nextStep;

        if (nextStep >= maxSteps || step >= configuredEndStep) {
          if (L.isSeqLooping) {
            stepRef.current = configuredStartStep;
          } else {
            // Selesai (tanpa loop): berhenti setelah ketukan terakhir benar-benar selesai berbunyi.
            stopped = true;
            stopTicker?.();
            stepRef.current = 0;
            const waitMs = Math.max(0, (nextTimeRef.current - ctx.currentTime) * 1000) + 30;
            finishTimer = window.setTimeout(() => {
              setIsDrumLoopActive(false);
              setIsChordLoopActive(false);
              stopAllLiveChords();
              visualQueueRef.current = [];
              paintPlayhead(0);
            }, waitMs);
            break;
          }
        } else {
          stepRef.current = activeLoopTarget;
        }
      }
    };

    tick();
    stopTicker = startTicker(tick, SCHEDULER_TICK_MS);
    if (stopped) stopTicker();

    // Penanda playhead mengikuti jam audio (bukan jam timer), digambar sekali per frame.
    let raf = 0;
    const paintLoop = () => {
      const q = visualQueueRef.current;
      const now = ctx.currentTime;
      let latest = -1;
      while (q.length && q[0].time <= now) latest = q.shift()!.step;
      if (latest >= 0 && latest !== playheadStepRef.current) {
        // Ikuti playhead: kalau keluar dari jendela tampilan, balik halaman ke bar-nya.
        const v = viewRef.current;
        if (v.follow) {
          const bar = Math.floor(latest / v.stepsPerBar);
          if (bar < v.start || bar >= v.start + v.count) {
            setViewStartBar(Math.max(0, Math.min(TOTAL_BARS - v.count, bar)));
          }
        }
        paintPlayhead(latest);
      }
      raf = requestAnimationFrame(paintLoop);
    };
    raf = requestAnimationFrame(paintLoop);

    return () => {
      stopped = true;
      stopTicker?.();
      if (finishTimer !== undefined) window.clearTimeout(finishTimer);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnySeqActive]);

  // Gambar ulang penanda playhead saat grid berganti (tab drum/chord) atau baris track muncul.
  const enabledKey = chordTracks.map((t) => (t.enabled ? 1 : 0)).join('');
  useEffect(() => {
    paintPlayhead(playheadStepRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, enabledKey, viewStartBar, barsPerView, timeSigId]);

  const handleClearGrid = () => {
    stopAllLiveChords();

    if (activeTab === 'drum') {
      const cleared: { [key: string]: number[] } = {};
      DRUM_INSTRUMENTS.forEach((inst) => {
        cleared[inst.id] = Array(totalSteps).fill(0);
      });
      setDrumGrid(cleared);
    } else {
      setChordTracks((prev) =>
        prev.map((t) => ({ ...t, ...emptyTrackData(totalSteps) }))
      );
    }
    onSuccessToast('Grid berhasil dibersihkan.');
  };

  const openHarmonicEditor = (padIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPadIndex(padIdx);
    setDraftChord({ ...padChords[padIdx] });
  };

  const previewDraftChord = (updated: ChordFormulaDef) => {
    setDraftChord(updated);
    const { midiNotes } = buildHarmonicChord(updated);
    audioEngine.playChordNotes(midiNotes, liveMain.program, liveMain.volume / 100, 1.0);
  };

  const applyHarmonicChord = () => {
    if (editingPadIndex === null) return;
    setPadChords((prev) => {
      const copy = [...prev];
      copy[editingPadIndex] = { ...draftChord };
      return copy;
    });
    setEditingPadIndex(null);
    onSuccessToast('Formula akor berhasil diperbarui.');
  };

  // Geser jendela tampilan grid per bar (menggantikan scroll horizontal 1560px).
  const shiftView = (direction: 1 | -1) => {
    setViewStartBar((v) => Math.max(0, Math.min(TOTAL_BARS - barsPerView, v + direction)));
  };

  const changeBarsPerView = (n: number) => {
    setBarsPerView(n);
    setViewStartBar((v) => Math.max(0, Math.min(TOTAL_BARS - n, v)));
  };

  // Ganti birama: hentikan pemutaran, pindahkan isi grid ke panjang bar baru, reset wilayah loop.
  const changeTimeSignature = (nextId: string) => {
    if (nextId === timeSigId) return;
    const next = getTimeSig(nextId);
    const oldS = stepsPerBar;
    const newS = stepsPerBarOf(next);

    historyResetRef.current = true;
    setIsDrumLoopActive(false);
    setIsChordLoopActive(false);
    stopAllLiveChords();
    stepRef.current = 0;
    visualQueueRef.current = [];
    playheadStepRef.current = 0;

    let trimmed = false;
    if (newS < oldS) {
      const isCut = (idx: number) => idx % oldS >= newS;
      trimmed =
        Object.values(drumGrid).some((row) => row.some((v, i) => v && isCut(i))) ||
        chordTracks.some((t) => t.steps.some((v, i) => v >= 0 && isCut(i)));
    }

    setDrumGrid((prev) => {
      const out: { [key: string]: number[] } = {};
      DRUM_INSTRUMENTS.forEach((inst) => {
        out[inst.id] = remapSteps<number>(prev[inst.id] || [], oldS, newS, 0);
      });
      return out;
    });
    setChordTracks((prev) =>
      prev.map((t) => ({ ...t, ...remapTrackData(t.steps, t.lens, oldS, newS, TOTAL_BARS) }))
    );
    setSel(null);
    setNewChordLen(newS);

    setTimeSigId(nextId);
    setLoopStartBar(1);
    setLoopStartBeat(1);
    setLoopEndBeat(newS);
    const nextBarsPerView = defaultBarsPerView(newS);
    setBarsPerView(nextBarsPerView);
    setViewStartBar(0);

    onSuccessToast(
      trimmed
        ? `Birama diganti ke ${next.label}. Sebagian not di luar panjang bar baru terpotong.`
        : `Birama diganti ke ${next.label} (${newS} step per bar).`
    );
  };

  // ---------------------------------------------------------------------------
  // SIMPAN / MUAT PROYEK (berkas MIDI di perangkat pengguna, tanpa server)
  // ---------------------------------------------------------------------------
  const snapshotProject = (): PadProject => {
    const drum: Record<string, string> = {};
    const mix: PadProject['drumMix'] = {};
    DRUM_INSTRUMENTS.forEach((inst) => {
      const row = drumGrid[inst.id] || [];
      let str = '';
      for (let i = 0; i < totalSteps; i++) str += String(clampLevel(row[i]));
      drum[inst.id] = str;
      const m = drumMix[inst.id];
      mix[inst.id] = { v: m.volume, m: m.muted, s: m.solo, a: adsrTuple(m.adsr) };
    });
    return {
      bpm,
      timeSig: timeSigId,
      kit: selectedDrumKit,
      drumVolume,
      chordVolume: chordMasterVolume,
      barsPerView,
      newChordLen,
      loop: { sb: loopStartBar, sbt: loopStartBeat, eb: loopEndBar, ebt: loopEndBeat },
      pads: padChords.map(padToTuple),
      drum,
      drumMix: mix,
      chords: chordTracks.map((t) => ({
        id: t.id,
        label: t.label,
        on: t.enabled,
        program: t.program,
        vol: t.volume,
        m: t.muted,
        s: t.solo,
        a: adsrTuple(t.adsr),
        notes: listNotes(t.steps, t.lens).map((n) => [n.start, n.len, n.pad] as [number, number, number]),
      })),
    };
  };

  // Terapkan proyek (sudah divalidasi oleh importMidiBuffer) ke seluruh state editor.
  const loadProject = (p: PadProject) => {
    const ts = getTimeSig(p.timeSig);
    const S = stepsPerBarOf(ts);
    const total = S * TOTAL_BARS;

    historyResetRef.current = true;
    setIsDrumLoopActive(false);
    setIsChordLoopActive(false);
    stopAllLiveChords();
    stepRef.current = 0;
    visualQueueRef.current = [];
    playheadStepRef.current = 0;

    const grid: { [key: string]: number[] } = {};
    const mix: Record<string, DrumMixState> = {};
    DRUM_INSTRUMENTS.forEach((inst) => {
      const str = p.drum[inst.id] || '';
      grid[inst.id] = Array.from({ length: total }, (_, i) => clampLevel(str.charCodeAt(i) - 48));
      const m = p.drumMix[inst.id];
      mix[inst.id] = {
        volume: m.v,
        muted: m.m,
        solo: m.s,
        adsr: { attack: m.a[0], decay: m.a[1], sustain: m.a[2], release: m.a[3] },
      };
    });

    const tracks: ChordTrackState[] = p.chords.map((t) => {
      const data = emptyTrackData(total);
      t.notes.forEach(([start, len, pad]) => {
        if (start >= 0 && start < total) {
          data.steps[start] = pad;
          data.lens[start] = len;
        }
      });
      return {
        id: t.id,
        label: t.label,
        enabled: t.on,
        program: t.program,
        volume: t.vol,
        muted: t.m,
        solo: t.s,
        adsr: { attack: t.a[0], decay: t.a[1], sustain: t.a[2], release: t.a[3] },
        steps: data.steps,
        lens: normalizeLens(data.steps, data.lens),
      };
    });

    setTimeSigId(ts.id);
    setBpm(p.bpm);
    setSelectedDrumKit(p.kit);
    setDrumVolume(p.drumVolume);
    setChordMasterVolume(p.chordVolume);
    setDrumGrid(grid);
    setDrumMix(mix);
    setPadChords(p.pads.map(tupleToPad));
    setChordTracks(tracks);
    setLoopStartBar(p.loop.sb);
    setLoopStartBeat(p.loop.sbt);
    setLoopEndBar(p.loop.eb);
    setLoopEndBeat(p.loop.ebt);
    setBarsPerView(p.barsPerView);
    setViewStartBar(0);
    setNewChordLen(p.newChordLen);
    setPadBank(0);
    setLiveSel(0);
    setSel(null);
    setDrumPicker(null);
    setPickerTrack(null);
  };

  const saveProject = () => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    try {
      const blob = projectToMidiBlob(snapshotProject());
      const d = new Date();
      const two = (n: number) => String(n).padStart(2, '0');
      const name = `PlayMuzeck_Proyek_${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.mid`;
      downloadBlob(blob, name);
      onSuccessToast(`Proyek disimpan sebagai "${name}". Simpan berkas ini; muat kembali lewat tombol Muat Proyek.`);
    } catch (err) {
      alert(`Gagal menyimpan proyek: ${err instanceof Error ? err.message : 'terjadi kesalahan.'}`);
    }
  };

  const openProjectPicker = () => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    importInputRef.current?.click();
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // supaya berkas yang sama bisa dipilih lagi
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('Berkas terlalu besar (maksimal 5 MB).');
      return;
    }
    try {
      // Baca & validasi dulu; konfirmasi hanya muncul bila berkasnya memang bisa dimuat.
      const res = importMidiBuffer(await file.arrayBuffer(), IMPORT_CTX);
      if (!window.confirm(`Memuat "${file.name}" akan mengganti seluruh pola dan pengaturan yang sedang ada. Lanjutkan?`)) return;
      loadProject(res.project);
      onSuccessToast(`${res.summary} (${file.name})`);
      if (res.warnings.length > 0) alert(`Catatan impor:\n- ${res.warnings.join('\n- ')}`);
    } catch (err) {
      alert(`Gagal memuat berkas: ${err instanceof Error ? err.message : 'berkas tidak dapat dibaca.'}`);
    }
  };

  // Saat dinamika mati, hasil ekspor juga rata (semua pukulan level tetap), sama seperti yang terdengar.
  const exportDrumGrid = useMemo<{ [key: string]: number[] }>(() => {
    if (!isExportModalOpen || dynamicsOn) return drumGrid;
    const out: { [key: string]: number[] } = {};
    Object.keys(drumGrid).forEach((id) => {
      out[id] = drumGrid[id].map((v) => effLevel(clampLevel(v), false));
    });
    return out;
  }, [isExportModalOpen, dynamicsOn, drumGrid]);

  // Dihitung hanya saat modal ekspor terbuka (sebelumnya dihitung ulang di SETIAP render).
  const exportChordTracksData = useMemo<ChordTrackExportData[]>(() => {
    if (!isExportModalOpen) return [];
    return chordTracks.map((t) => {
      const audible = isTrackAudible(t, chordTracks);
      const effVol = audible ? (t.volume / 100) * (chordMasterVolume / 100) : 0;
      const instDef = INSTRUMENTS_128.find((i) => i.id === t.program);
      return {
        id: t.id,
        name: instDef?.name || `Instrumen ${t.id}`,
        program: t.program,
        notesPerStep: t.steps.map((pIdx) => (pIdx >= 0 && padInfo[pIdx] ? padInfo[pIdx].midiNotes : [])),
        stepLens: t.lens,
        volume: effVol,
        adsr: t.adsr,
        enabled: t.enabled,
        muted: t.muted,
        solo: t.solo,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExportModalOpen, chordTracks, padInfo, chordMasterVolume]);

  return (
    <section id="pad-studio-section" ref={sectionRef} className="w-full">
      <div className="rounded-2xl bg-surface border border-white/[0.08] p-5 sm:p-7 shadow-xl relative overflow-hidden space-y-6">
        <div className="flex flex-col gap-4 pb-5 border-b border-white/[0.08]">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Drum className="w-5 h-5 text-accent" />
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Drum Pad & Chord Pad Studio
              </h3>
            </div>
            <p className="text-xs text-gray-300">
              Pilihan 7 genre drum kit dan 10 trigger pad ritmis dengan 4 progresi instrumen independen.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div className="flex items-center bg-black/60 px-2.5 py-1.5 rounded-xl border border-white/[0.08] gap-1.5 select-none shrink-0">
              <span className="text-xs font-bold text-gray-400 mr-0.5">TEMPO</span>
              <button
                type="button"
                onClick={() => setBpm((p) => Math.max(60, p - 1))}
                className="p-1 rounded-md bg-white/5 hover:bg-white/10 active:bg-accent active:text-black text-gray-300"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <input
                type="number"
                min="60"
                max="200"
                value={bpm}
                onChange={(e) => setBpm(Math.max(60, Math.min(200, Number(e.target.value))))}
                className="w-11 bg-transparent text-center font-mono font-black text-sm text-accent focus:outline-none"
              />
              <span className="text-[10px] text-gray-400 mr-0.5">BPM</span>
              <button
                type="button"
                onClick={() => setBpm((p) => Math.min(200, p + 1))}
                className="p-1 rounded-md bg-white/5 hover:bg-white/10 active:bg-accent active:text-black text-gray-300"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center bg-black/60 px-2.5 py-1.5 rounded-xl border border-white/[0.08] gap-1.5 select-none shrink-0">
              <span className="text-xs font-bold text-gray-400 mr-0.5">BIRAMA</span>
              <select
                value={timeSigId}
                onChange={(e) => changeTimeSignature(e.target.value)}
                title="Birama. BPM dihitung per not seperempat; 1 step = 1/16 not."
                className="bg-transparent font-mono font-black text-sm text-accent focus:outline-none cursor-pointer"
              >
                {TIME_SIGNATURES.map((ts) => (
                  <option key={ts.id} value={ts.id} className="bg-black text-white">
                    {ts.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleClearGrid}
              className="px-3 py-2 rounded-xl bg-black/60 hover:bg-black/90 text-gray-300 hover:text-white border border-white/[0.08] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 text-red-400" />
              <span>Bersihkan Grid</span>
            </button>

            <div className="flex items-center bg-black/60 p-1 rounded-xl border border-white/[0.08] shrink-0">
              <button
                onClick={() => setActiveTab('drum')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'drum' ? 'bg-accent text-on-accent shadow-sm' : 'text-gray-300 hover:text-white'
                }`}
              >
                Drum Pad
              </button>
              <button
                onClick={() => {
                  if (!isUnlocked8Bar) {
                    onUnlockEditor();
                    return;
                  }
                  setActiveTab('chord');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  activeTab === 'chord' ? 'bg-accent text-on-accent shadow-sm' : 'text-gray-300 hover:text-white'
                }`}
              >
                {!isUnlocked8Bar && <Lock className="w-3 h-3 text-accent" />}
                <span>Chord Pad</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!isUnlocked8Bar) {
                  onUnlockEditor();
                  return;
                }
                setIsExportMenuOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-black/60 hover:bg-black/90 border border-white/[0.12] text-accent shadow cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-accent" />
              <span>Ekspor Pola</span>
            </button>

            <button
              type="button"
              onClick={saveProject}
              title="Simpan seluruh proyek (pola, mixer, ADSR, akor) ke berkas MIDI di perangkat Anda"
              className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-black/60 hover:bg-black/90 border border-white/[0.12] text-gray-200 shadow cursor-pointer shrink-0"
            >
              <Save className="w-3.5 h-3.5 text-accent" />
              <span>Simpan Proyek</span>
            </button>

            <button
              type="button"
              onClick={openProjectPicker}
              title="Muat proyek dari berkas MIDI (hasil Simpan Proyek / Ekspor MIDI, atau MIDI lain)"
              className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-black/60 hover:bg-black/90 border border-white/[0.12] text-gray-200 shadow cursor-pointer shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5 text-accent" />
              <span>Muat Proyek</span>
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".mid,.midi,audio/midi,audio/x-midi"
              onChange={handleImportFile}
              className="hidden"
              aria-label="Pilih berkas MIDI proyek"
            />
          </div>
        </div>

        {activeTab === 'drum' && (
          <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-300">Pilih Drum Kit:</span>
              {DRUM_KITS.map((kit) => (
                <button
                  key={kit}
                  onClick={() => setSelectedDrumKit(kit)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    selectedDrumKit === kit
                      ? 'bg-accent text-on-accent border-accent font-bold shadow'
                      : 'bg-black/50 text-gray-300 border-white/[0.08] hover:border-white/20'
                  }`}
                >
                  {kit}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                {activeTab === 'drum'
                  ? `Live Drum Trigger Pads (${selectedDrumKit})`
                  : `Live Harmonic Chords — ${PAD_BANKS * PADS_PER_BANK} akor`}
              </span>
              {activeTab === 'drum' ? (
                <InfoTip title="Cara memakai trigger pad">
                  <p>Tekan pad untuk membunyikan drum.</p>
                  <p>
                    <b className="text-gray-100">Dinamika menyala:</b> tekan di pusat pad untuk pukulan paling keras (ff). Makin jauh dari pusat
                    makin lemah: f, p, lalu pp di tepi. Cincin dan label di pad menunjukkan tingkatnya.
                  </p>
                  <p>
                    <b className="text-gray-100">Dinamika mati:</b> semua pukulan sama kerasnya, di mana pun pad ditekan.
                  </p>
                  {hasKeyboard && (
                    <p>
                      <b className="text-gray-100">Keyboard:</b> tombol Q W E R T Y U I O P membunyikan kesepuluh pad dari kiri ke kanan. Untuk
                      memilih dinamika, tahan tombol dinamika lalu tekan pad: koma (,) = pp, Shift + koma = p, titik (.) = f, Shift + titik = ff.
                      Tanpa tombol dinamika, pad berbunyi f (Shift saja = ff). Tidak berlaku bila dinamika mati.
                    </p>
                  )}
                  <p>
                    <b className="text-gray-100">Rekam:</b> tekan Rekam, lalu mainkan pad{hasKeyboard ? ' (atau tombol keyboard)' : ''}. Tiap pukulan
                    masuk ke step terdekat di sequencer drum (resolusi 1/16 not) dan ikut tercatat sebagai dinamikanya. Bila drum belum
                    diputar, pemutaran dimulai otomatis dari awal wilayah loop. Satu rekaman = satu langkah Undo. Metronom (bila aktif) hanya
                    berbunyi saat merekam.
                  </p>
                </InfoTip>
              ) : (
                <InfoTip title="Live harmonic chords">
                  <p>
                    Mengubah akor sebuah pad (ikon slider) juga mengubahnya di semua step sequencer yang memakai pad itu.
                  </p>
                  <p>Mengganti instrumen (ikon pensil) juga mengganti instrumen barisnya di sequencer.</p>
                </InfoTip>
              )}
            </div>
            {activeTab === 'drum' && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <DynamicsToggle on={dynamicsOn} onToggle={toggleDynamics} />
                <button
                  type="button"
                  onClick={toggleRecording}
                  aria-pressed={isRecording}
                  title={isRecording ? 'Hentikan rekaman' : 'Rekam: pukulan dari pad masuk ke sequencer drum'}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                    isRecording
                      ? 'bg-red-500/20 text-red-300 border-red-500/60'
                      : 'bg-black/60 text-gray-300 border-white/10 hover:border-white/25'
                  }`}
                >
                  <Circle className={`w-3 h-3 ${isRecording ? 'fill-red-500 text-red-500 animate-pulse' : 'fill-red-500/80 text-red-500/80'}`} />
                  <span>{isRecording ? 'Stop Rekam' : 'Rekam'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMetronomeOn((v) => !v)}
                  aria-pressed={metronomeOn}
                  title="Metronom: klik ketukan saat merekam"
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                    metronomeOn ? 'bg-accent/20 text-accent border-accent/40' : 'bg-black/60 text-gray-400 border-white/10 hover:border-white/25'
                  }`}
                >
                  <Activity className="w-3 h-3" />
                  <span>Metronom</span>
                </button>
              </div>
            )}
            {activeTab === 'chord' && engineStatus && (
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded border inline-flex items-center gap-1.5 flex-wrap ${
                  bankState === 'error'
                    ? 'text-red-300 bg-red-500/10 border-red-500/30'
                    : 'text-accent bg-accent/10 border-accent/20'
                }`}
              >
                <span>{engineStatus}</span>
                {bankState === 'loading' && <span className="text-gray-400">· suara sementara aktif</span>}
                {bankState === 'error' && (
                  <button
                    type="button"
                    onClick={() => void audioEngine.retryBank()}
                    className="underline font-bold cursor-pointer text-red-200 hover:text-white"
                  >
                    Coba lagi
                  </button>
                )}
              </span>
            )}
          </div>

          {activeTab === 'chord' && (
            <>
              {/* Pemilih instrumen live: satu chip per instrumen yang sedang dipakai di sequencer */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-gray-300 mr-1">Instrumen live:</span>
                {chordTracks.map((t, i) => {
                  if (!t.enabled) return null;
                  const name = INSTRUMENTS_128.find((x) => x.id === t.program)?.name || 'Piano';
                  const active = liveTargets.length === 1 && liveTargets[0] === i;
                  return (
                    <div
                      key={t.id}
                      className={`flex items-stretch rounded-lg border overflow-hidden transition-colors ${
                        active ? 'border-accent bg-accent/15' : 'border-white/10 bg-black/50 hover:border-white/25'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setLiveSel(i)}
                        aria-pressed={active}
                        title={`Mainkan pad dengan ${name}`}
                        className={`flex items-center gap-1.5 pl-2 pr-2 py-1 text-[11px] font-bold cursor-pointer ${active ? 'text-accent' : 'text-gray-300'}`}
                      >
                        <span className="font-mono text-[10px] opacity-70">#{i + 1}</span>
                        <span className="max-w-[10rem] truncate">{name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLiveSel(i);
                          setPickerTrack(i);
                        }}
                        title={`Ganti instrumen ${t.label}`}
                        className={`px-1.5 border-l cursor-pointer ${
                          active ? 'border-accent/40 text-accent hover:bg-accent hover:text-on-accent' : 'border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                        }`}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
                {chordTracks.filter((t) => t.enabled).length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLiveSel('all')}
                    aria-pressed={liveSel === 'all'}
                    title="Bunyikan semua instrumen sekaligus (berlapis)"
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                      liveTargets.length > 1 ? 'border-accent bg-accent/15 text-accent' : 'border-white/10 bg-black/50 text-gray-300 hover:border-white/25'
                    }`}
                  >
                    <Layers className="w-3 h-3" />
                    Semua
                  </button>
                )}
                {chordTracks.some((t) => !t.enabled) && (
                  <button
                    type="button"
                    onClick={addChordTrack}
                    title="Tambah instrumen baru (juga muncul sebagai baris di sequencer)"
                    className="flex items-center gap-1 px-2 py-1 rounded-lg border border-dashed border-accent/50 text-accent text-[11px] font-bold hover:bg-accent/10 cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                    Instrumen
                  </button>
                )}
              </div>

              {/* Bank akor 1–8 */}
              <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Bank akor">
                <span className="text-[11px] font-bold text-gray-300 mr-1">Bank akor:</span>
                {Array.from({ length: PAD_BANKS }, (_, bank) => (
                  <button
                    key={bank}
                    type="button"
                    role="tab"
                    aria-selected={padBank === bank}
                    onClick={() => setPadBank(bank)}
                    title={`Pad #${bank * PADS_PER_BANK + 1}–${(bank + 1) * PADS_PER_BANK}`}
                    className={`flex flex-col items-center leading-tight px-2.5 py-1 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                      padBank === bank ? 'bg-accent text-on-accent border-accent shadow' : 'bg-black/50 text-gray-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <span>{bank + 1}</span>
                    <span className={`text-[9px] font-mono font-normal ${padBank === bank ? 'opacity-80' : 'text-gray-500'}`}>
                      {padInfo[bank * PADS_PER_BANK]?.displayName}
                    </span>
                  </button>
                ))}
                <span className="text-[10px] font-mono text-gray-500 ml-auto">
                  Pad #{padBank * PADS_PER_BANK + 1}–{(padBank + 1) * PADS_PER_BANK} dari {PAD_BANKS * PADS_PER_BANK}
                </span>
              </div>
            </>
          )}

          {activeTab === 'drum' && isRecording && (
            <p className="text-[11px] font-semibold text-red-300 flex items-center gap-1.5">
              <Circle className="w-2.5 h-2.5 fill-red-500 text-red-500 animate-pulse" />
              Merekam… {hasKeyboard ? 'tekan pad atau tombol Q–P' : 'tekan pad'}; pukulan masuk ke step terdekat.
            </p>
          )}

          {activeTab === 'drum' ? (
            <div className="grid grid-cols-5 lg:grid-cols-10 gap-2">
              {DRUM_INSTRUMENTS.map((inst) => {
                const hit = drumHit && drumHit.id === inst.id ? drumHit.level : 0;
                const hover = dynamicsOn && drumHover && drumHover.id === inst.id ? drumHover.level : 0;
                const shown = dynamicsOn ? hit || hover : 0;
                return (
                  <button
                    key={inst.id}
                    type="button"
                    aria-label={
                      dynamicsOn
                        ? `${inst.label}. Tekan dekat pusat = lebih keras, dekat tepi = lebih pelan`
                        : `${inst.label}${hasKeyboard ? ` (tombol ${inst.keyHint})` : ''}`
                    }
                    title={
                      dynamicsOn
                        ? 'Tekan dekat pusat = keras (ff), makin ke tepi = makin pelan (pp)'
                        : 'Dinamika mati: semua pukulan sama keras'
                    }
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      triggerDrum(inst.id, dynamicsOn ? levelAtPointer(e) : DRUM_FLAT_LEVEL, e.timeStamp);
                    }}
                    onPointerMove={(e) => {
                      if (!dynamicsOn || e.pointerType !== 'mouse') return;
                      const lv = levelAtPointer(e);
                      setDrumHover((h) => (h && h.id === inst.id && h.level === lv ? h : { id: inst.id, level: lv }));
                    }}
                    onPointerLeave={() => setDrumHover((h) => (h && h.id === inst.id ? null : h))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        triggerDrum(inst.id, 3, e.timeStamp);
                      }
                    }}
                    className={`group relative h-24 rounded-xl border overflow-hidden select-none touch-manipulation transition-all cursor-pointer ${
                      activePadAnim === inst.id
                        ? 'bg-accent/25 border-accent scale-[1.03] shadow-lg'
                        : 'bg-surface text-white border-white/[0.08] hover:border-accent/60'
                    }`}
                  >
                    <span className="absolute top-1.5 inset-x-1 text-xs font-black tracking-tight text-center leading-tight pointer-events-none">
                      {inst.label}
                    </span>
                    {/* Cincin dinamika: batas tiap cincin = batas level (ff di tengah → pp di tepi). Hanya saat dinamika menyala. */}
                    {dynamicsOn &&
                      LIVE_RING.map((r, i) => {
                        const ringLevel = 4 - i; // cincin 0.3 = batas ff, 0.55 = batas f, 0.8 = batas p
                        return (
                          <span
                            key={r}
                            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border pointer-events-none transition-colors ${
                              shown === ringLevel ? 'border-accent' : 'border-white/10'
                            }`}
                            style={{ width: `${r * 100}%`, height: `${r * 100}%` }}
                          />
                        );
                      })}
                    <span
                      className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center rounded-full pointer-events-none text-[10px] font-black italic transition-colors ${
                        shown || (!dynamicsOn && activePadAnim === inst.id) ? 'bg-accent text-on-accent' : 'bg-accent/70 text-transparent'
                      }`}
                      style={{ width: 22, height: 22 }}
                    >
                      {dynamicsOn && shown ? DRUM_LEVEL_SHORT[shown] : ''}
                    </span>
                    {/* Tombol keyboard: hanya muncul di perangkat dengan keyboard fisik */}
                    {hasKeyboard && (
                      <kbd className="absolute bottom-1 inset-x-0 mx-auto w-fit px-1.5 rounded border border-white/15 bg-black/50 text-[9px] font-mono font-bold text-gray-300 pointer-events-none">
                        {inst.keyHint}
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {padChords.slice(padBank * PADS_PER_BANK, (padBank + 1) * PADS_PER_BANK).map((chordDef, i) => {
                const idx = padBank * PADS_PER_BANK + i;
                const displayName = padInfo[idx]?.displayName ?? '';
                const isActive = litChords.includes(idx);
                return (
                  <div
                    key={idx}
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Abaikan bila pointer capture tidak didukung
                      }
                      startChordHold(idx);
                    }}
                    onPointerUp={() => releaseChordHold(idx)}
                    onPointerCancel={() => releaseChordHold(idx)}
                    onLostPointerCapture={() => releaseChordHold(idx)}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`h-22 rounded-xl border flex flex-col items-center justify-between p-2 transition-all relative group cursor-pointer select-none touch-manipulation ${
                      isActive
                        ? 'bg-accent text-on-accent border-accent scale-105 shadow-lg'
                        : 'bg-surface text-white border-white/[0.08] hover:border-accent/60'
                    }`}
                  >
                    <button
                      type="button"
                      title="Edit akor pad ini"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openHarmonicEditor(idx, e)}
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/40 hover:bg-accent text-gray-300 hover:text-on-accent transition-colors"
                    >
                      <Sliders className="w-3 h-3" />
                    </button>
                    <span className="text-[10px] font-mono text-gray-400 self-start">#{idx + 1}</span>
                    <span className="text-lg font-black tracking-tight my-auto text-center leading-tight">{displayName}</span>
                    <span className="text-[9px] text-gray-400 truncate max-w-full font-mono">
                      {chordDef.inversion ? `inv${chordDef.inversion}` : 'root'} • {chordDef.octaveOffset ? `oct${chordDef.octaveOffset > 0 ? `+${chordDef.octaveOffset}` : chordDef.octaveOffset}` : 'std'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

        </div>

        <div className="space-y-2 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider">
              {activeTab === 'drum' ? 'Step Sequencer Pola Ketukan' : 'Step Sequencer Progresi Akor (4 Instrumen)'}
            </h4>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-mono text-gray-400">
                Bar {viewStartBar + 1}–{viewStartBar + barsPerView} / {TOTAL_BARS} • {timeSig.label}
              </span>
              <label className="flex items-center gap-1 text-[10px] text-gray-400">
                Tampil
                <select
                  value={barsPerView}
                  onChange={(e) => changeBarsPerView(Number(e.target.value))}
                  className="bg-black/60 border border-white/10 rounded-md px-1 py-0.5 font-mono text-accent focus:outline-none cursor-pointer"
                >
                  {BARS_PER_VIEW_OPTIONS.map((n) => (
                    <option key={n} value={n} className="bg-black text-white">
                      {n} bar
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex items-center gap-1.5 text-[10px] text-gray-400 bg-black/40 border border-white/10 rounded-lg px-2 py-1">
                <Repeat className="w-3 h-3 text-accent" />
                <span className="font-bold text-accent">Loop</span>
                <span>Bar</span>
                <IntField min={1} max={TOTAL_BARS} value={loopStartBar} onChange={setLoopStartBar} ariaLabel="Loop mulai bar" />
                <span>Step</span>
                <IntField min={1} max={stepsPerBar} value={loopStartBeat} onChange={setLoopStartBeat} ariaLabel="Loop mulai step" />
                <span>—</span>
                <span>Bar</span>
                <IntField min={1} max={TOTAL_BARS} value={loopEndBar} onChange={setLoopEndBar} ariaLabel="Loop sampai bar" />
                <span>Step</span>
                <IntField min={1} max={stepsPerBar} value={loopEndBeat} onChange={setLoopEndBeat} ariaLabel="Loop sampai step" />
              </div>
              {!isUnlocked8Bar && (
                <button type="button" onClick={onUnlockEditor} className="text-[11px] text-accent hover:underline font-semibold cursor-pointer">
                  Buka 16-Bar →
                </button>
              )}
              <button
                type="button"
                onClick={() => setFollowPlayhead((f) => !f)}
                title="Halaman grid otomatis mengikuti playhead saat diputar"
                className={`px-2 py-1 rounded-md text-[10px] font-bold border transition-colors ${
                  followPlayhead ? 'bg-accent/20 text-accent border-accent/40' : 'bg-white/5 text-gray-400 border-white/10'
                }`}
              >
                Ikuti
              </button>
              <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => shiftView(-1)}
                  disabled={viewStartBar <= 0}
                  className="p-1.5 rounded-md bg-white/5 hover:bg-accent hover:text-on-accent text-gray-300 transition-colors disabled:opacity-40"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => shiftView(1)}
                  disabled={viewStartBar >= TOTAL_BARS - barsPerView}
                  className="p-1.5 rounded-md bg-white/5 hover:bg-accent hover:text-on-accent text-gray-300 transition-colors disabled:opacity-40"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-black/40 border border-white/[0.06] p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-black/60 border border-white/10 rounded-lg p-0.5" role="tablist" aria-label="Mode editor">
                {([
                  { id: 'edit', label: 'Edit', Icon: Pencil, tip: 'Klik sel untuk memasang / mengubah' },
                  {
                    id: 'select',
                    label: 'Pilih',
                    Icon: BoxSelect,
                    tip: 'Ketuk atau seret untuk memilih area. Memilih lagi MENGGANTI pilihan sebelumnya.',
                  },
                  {
                    id: 'selectAdd',
                    label: 'Pilih+',
                    Icon: Plus,
                    tip: 'Ketuk pad untuk menambah ke pilihan TANPA melepas yang sebelumnya (ketuk lagi untuk melepas). Seret untuk menambah area.',
                  },
                ] as const).map(({ id, label, Icon, tip }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={editMode === id}
                    title={tip}
                    onClick={() => setEditMode(id)}
                    className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors cursor-pointer ${
                      editMode === id ? 'bg-accent text-on-accent shadow' : 'text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => setShowMixer((v) => !v)}
                aria-pressed={showMixer}
                title="Tampilkan / sembunyikan volume & ADSR"
                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                  showMixer ? 'bg-accent/20 text-accent border-accent/40' : 'bg-black/60 text-gray-300 border-white/10 hover:border-white/25'
                }`}
              >
                <SlidersHorizontal className="w-3 h-3" />
                <span>Mixer</span>
              </button>

              {activeTab === 'drum' && <DynamicsToggle on={dynamicsOn} onToggle={toggleDynamics} />}

              <span aria-hidden="true" className="hidden sm:block w-px h-5 bg-white/10" />

              <div className="flex items-center gap-1">
                <ToolBtn icon={Undo2} label="Undo" title="Ctrl+Z" onClick={undo} disabled={!canUndo} />
                <ToolBtn icon={Redo2} label="Redo" title="Ctrl+Shift+Z atau Ctrl+Y" onClick={redo} disabled={!canRedo} />
              </div>

              <span aria-hidden="true" className="hidden sm:block w-px h-5 bg-white/10" />

              <div className="flex flex-wrap items-center gap-1">
                <ToolBtn icon={Copy} label="Salin" title="Ctrl+C" onClick={copySelection} disabled={!activeSel} />
                <ToolBtn icon={Scissors} label="Potong" title="Ctrl+X" onClick={cutSelection} disabled={!activeSel} />
                <ToolBtn icon={ClipboardPaste} label="Tempel" title="Ctrl+V — ditempel di awal pilihan (atau di playhead)" onClick={pasteSelection} disabled={!clips[activeTab]} />
                <ToolBtn icon={CopyPlus} label="Duplikat" title="Ctrl+D — salin lalu tempel tepat setelah pilihan" onClick={duplicateSelection} disabled={!activeSel} />
                <ToolBtn icon={Trash2} label="Hapus" title="Delete" onClick={deleteSelection} disabled={!activeSel} />
                <ToolBtn icon={X} label="Lepas" title="Esc — batalkan semua pilihan" onClick={clearSelection} disabled={!activeSel} />
              </div>

              <div className="ml-auto flex items-center gap-2">
                {activeTab === 'drum' && isRecording && (
                  <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-red-300">
                    <Circle className="w-2.5 h-2.5 fill-red-500 text-red-500 animate-pulse" />
                    Merekam
                  </span>
                )}
                <span className="text-[10px] font-mono text-gray-400">
                  {activeSel ? `${activeSel.cells.size} ${activeTab === 'drum' ? 'pad' : 'sel'} terpilih` : 'Belum ada pilihan'}
                </span>
                <InfoTip title="Cara memakai sequencer">
                  {activeTab === 'drum' ? (
                    dynamicsOn ? (
                      <p>
                        <b className="text-gray-100">Edit:</b> klik pad untuk menaikkan dinamika bertahap: kosong → pp (sangat pelan) → p (pelan) → f
                        (keras) → ff (sangat keras) → kosong. Klik kanan (atau tahan lama di HP) untuk memilih dinamika langsung. Warna makin
                        pekat = makin keras.
                      </p>
                    ) : (
                      <p>
                        <b className="text-gray-100">Edit:</b> klik pad untuk memasang, klik lagi untuk menghapus. Dinamika mati, jadi semua pad
                        dibunyikan sama keras (dinamika yang sudah tersimpan kembali muncul bila dinamika dinyalakan lagi).
                      </p>
                    )
                  ) : (
                    <p>
                      <b className="text-gray-100">Edit:</b> klik sel kosong untuk memasang akor. Seret pegangan di tepi kanan blok akor untuk
                      memanjangkan atau memendekkan.
                    </p>
                  )}
                  <p>
                    <b className="text-gray-100">Pilih:</b> ketuk atau seret untuk memilih area; memilih lagi menggantikan pilihan sebelumnya.
                    Shift+seret di mode Edit juga memilih area.
                  </p>
                  <p>
                    <b className="text-gray-100">Pilih+:</b> ketuk pad untuk menambahkannya ke pilihan tanpa melepas pad yang sudah dipilih (ketuk
                    lagi untuk melepas). Pad yang dipilih boleh berjauhan; seret untuk menambah satu area sekaligus.
                  </p>
                  <p>Klik label BAR untuk memilih satu bar (di mode Pilih+ atau dengan Shift, bar ditambahkan ke pilihan).</p>
                  <p>
                    <b className="text-gray-100">Pintasan:</b> Ctrl+Z / Ctrl+Shift+Z untuk undo / redo; Ctrl+C / X / V / D untuk salin, potong,
                    tempel, duplikat; Delete untuk hapus; Esc untuk melepas pilihan.
                  </p>
                </InfoTip>
              </div>
            </div>

            {activeTab === 'chord' && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-300">
                  Panjang akor baru
                  <select
                    value={newChordLen}
                    onChange={(e) => setNewChordLen(Number(e.target.value))}
                    className="bg-black/70 border border-white/15 rounded-md px-1.5 py-1 font-mono text-accent focus:outline-none cursor-pointer"
                  >
                    {Array.from(new Set([1, 2, 4, 8, stepsPerBar, stepsPerBar * 2, stepsPerBar * 4, newChordLen]))
                      .filter((n) => n >= 1 && n <= totalSteps)
                      .sort((a, b) => a - b)
                      .map((n) => (
                        <option key={n} value={n} className="bg-black text-white">
                          {n} step{n % stepsPerBar === 0 ? ` (${n / stepsPerBar} bar)` : ''}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="flex items-center gap-1.5 text-[11px] font-bold text-gray-300">
                  Panjang akor terpilih
                  <IntField
                    value={selectedNoteInfo.len}
                    min={1}
                    max={totalSteps}
                    onChange={setSelectedNotesLength}
                    disabled={selectedNoteInfo.count === 0}
                    ariaLabel="Panjang akor terpilih (step)"
                  />
                  <span className="font-mono text-gray-500 font-normal">step{selectedNoteInfo.count > 1 ? ` (${selectedNoteInfo.count} akor)` : ''}</span>
                </label>
              </div>
            )}

          </div>

          <div
            ref={sequencerScrollRef}
            className="overflow-x-auto pt-2 pb-4 px-3 no-scrollbar"
            style={editMode !== 'edit' ? { touchAction: 'none' } : undefined}
            onPointerDown={handleGridPointerDown}
            onMouseDownCapture={(e) => {
              if ((modeRef.current !== 'edit' || e.shiftKey) && (e.target as HTMLElement).closest('[data-rowgrid]')) e.preventDefault();
            }}
            onClickCapture={(e) => {
              if ((modeRef.current !== 'edit' || e.shiftKey) && (e.target as HTMLElement).closest('[data-rowgrid]')) {
                e.stopPropagation();
                e.preventDefault();
              }
            }}
          >
            <div className="space-y-2" style={{ minWidth: gridMinWidth }}>
              <div className="flex items-stretch border border-transparent">
                <div className={`${labelWidth(showMixer)} shrink-0 border-r border-transparent flex items-center text-[10px] font-mono font-bold text-gray-500 uppercase tracking-wider pl-4`}>
                  SEGMEN BAR
                </div>
                <div className="grid gap-0.5 flex-1 min-w-0 px-2" style={gridStyle}>
                  {windowBars.map((barIdx) => (
                    <div
                      key={barIdx}
                      style={{ gridColumn: `span ${stepsPerBar} / span ${stepsPerBar}` }}
                      onClick={(e) => selectBar(barIdx, e.shiftKey || editMode === 'selectAdd')}
                      title="Klik untuk memilih seluruh bar ini (Shift+klik atau mode Pilih+ = tambahkan ke pilihan)"
                      className="py-1.5 rounded-md border text-center text-xs font-mono font-bold bg-surface text-accent border-accent/30 cursor-pointer hover:bg-accent/10 select-none"
                    >
                      BAR {barIdx + 1}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-stretch border border-transparent">
                <div className={`${labelWidth(showMixer)} shrink-0 border-r border-transparent pr-2 flex items-center`}>
                <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-xl px-1.5 py-1 w-full min-w-0">
                  {(() => {
                    const playing = activeTab === 'drum' ? isDrumLoopActive : isChordLoopActive;
                    const partName = activeTab === 'drum' ? 'Drum' : 'Akor';
                    return (
                      <button
                        type="button"
                        onClick={activeTab === 'drum' ? toggleDrumLoop : toggleChordLoop}
                        title={`${playing ? 'Hentikan' : 'Putar'} ${partName} (loop)`}
                        aria-label={`${playing ? 'Hentikan' : 'Putar'} ${partName}`}
                        className={`p-1.5 rounded-lg transition-all cursor-pointer shrink-0 ${
                          playing ? 'bg-accent text-on-accent shadow-md' : 'bg-white/5 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        {playing ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={resetToBeginning}
                    title="Mulai dari awal"
                    className="p-1.5 rounded-md bg-white/5 hover:bg-white/15 text-gray-300 transition-colors cursor-pointer shrink-0"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <div
                    className="flex items-center gap-1 flex-1 min-w-0 px-0.5"
                    title={activeTab === 'drum' ? 'Volume Drum' : 'Volume Akor'}
                  >
                    <Volume2 className="w-3 h-3 text-accent shrink-0" />
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={activeTab === 'drum' ? drumVolume : chordMasterVolume}
                      aria-label={activeTab === 'drum' ? 'Volume drum utama' : 'Volume akor utama'}
                      onChange={(e) =>
                        activeTab === 'drum' ? setDrumVolume(Number(e.target.value)) : setChordMasterVolume(Number(e.target.value))
                      }
                      className="flex-1 min-w-0 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                    />
                    <span className="text-[10px] font-mono text-accent w-8 text-right shrink-0">
                      {activeTab === 'drum' ? drumVolume : chordMasterVolume}%
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsSeqLooping(!isSeqLooping)}
                    title={isSeqLooping ? 'Loop aktif' : 'Loop mati'}
                    className={`p-1.5 rounded-md transition-all cursor-pointer shrink-0 ${
                      isSeqLooping ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-white/5 text-gray-500'
                    }`}
                  >
                    <Repeat className="w-3 h-3" />
                  </button>
                </div>
                </div>

                <div className="grid gap-0.5 flex-1 min-w-0 px-2" style={gridStyle}>
                  {windowSteps.map((idx) => {
                    const pos = idx % stepsPerBar;
                    const isBeat = beatInfo.isBeatStart[pos];
                    return (
                      <button
                        key={idx}
                        type="button"
                        data-step={idx}
                        data-seek="1"
                        onClick={() => handleSeekStep(idx)}
                        className={`h-8 rounded-xs text-xs font-mono font-bold transition-colors flex items-center justify-center ${
                          isBeat ? 'bg-white/15 text-white hover:bg-white/30' : 'bg-black/50 text-gray-500 hover:bg-white/10'
                        }`}
                      >
                        {isBeat ? beatInfo.beatNumber[pos] : '·'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeTab === 'drum' ? (
                <div className="space-y-2 pt-1.5">
                  {DRUM_INSTRUMENTS.map((inst, di) => {
                    return (
                      <DrumRow
                        key={inst.id}
                        rowIdx={di}
                        id={inst.id}
                        label={inst.label}
                        mix={drumMix[inst.id]}
                        showMixer={showMixer}
                        onMix={updateDrumMix}
                        onAdsr={updateDrumAdsr}
                        dynamics={dynamicsOn}
                        row={drumGrid[inst.id]}
                        steps={windowSteps}
                        stepsPerBar={stepsPerBar}
                        beatMask={beatInfo.isBeatStart}
                        gridStyle={gridStyle}
                        selSteps={rowSelSets[di] ?? null}
                        onCycle={cycleDrumStep}
                        onMenu={openDrumPicker}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2.5 pt-1.5">
                  {chordTracks.map((track, tIdx) =>
                    track.enabled ? (
                      <ChordRow
                        selSteps={rowSelSets[tIdx] ?? null}
                        getMode={getMode}
                        onResize={resizeChordNote}
                        onUpdateTrack={updateTrack}
                        onUpdateAdsr={updateTrackAdsr}
                        onPickInstrument={openInstrumentPicker}
                        onRemove={removeTrack}
                        key={track.id}
                        tIdx={tIdx}
                        track={track}
                        instName={INSTRUMENTS_128.find((i) => i.id === track.program)?.name || 'Piano'}
                        showMixer={showMixer}
                        padInfo={padInfo}
                        options={chordOptions}
                        steps={windowSteps}
                        stepsPerBar={stepsPerBar}
                        beatMask={beatInfo.isBeatStart}
                        gridStyle={gridStyle}
                        onPick={setTrackChordStep}
                      />
                    ) : null
                  )}
                  {chordTracks.some((t) => !t.enabled) && (
                    <button
                      type="button"
                      onClick={addChordTrack}
                      className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl border border-dashed border-accent/50 text-accent text-xs font-bold hover:bg-accent/10 cursor-pointer transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Tambah baris instrumen ({chordTracks.filter((t) => t.enabled).length + 1}/4)</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {drumPicker && (
        <DrumLevelPicker
          x={drumPicker.x}
          y={drumPicker.y}
          current={clampLevel(drumGrid[drumPicker.drumId]?.[drumPicker.stepIdx])}
          onClose={closeDrumPicker}
          onPick={(lv) => {
            setDrumLevel(drumPicker.drumId, drumPicker.stepIdx, lv);
            setDrumPicker(null);
          }}
        />
      )}

      <InstrumentPickerModal
        isOpen={pickerTrack !== null}
        title={pickerTrack !== null ? chordTracks[pickerTrack]?.label ?? '' : ''}
        currentProgram={pickerTrack !== null ? chordTracks[pickerTrack]?.program ?? 0 : 0}
        isUnlocked={Boolean(isUnlocked8Bar)}
        onSelect={(program) => {
          if (pickerTrack !== null) updateTrack(pickerTrack, { program });
          setPickerTrack(null);
        }}
        onLockedClick={onUnlockEditor}
        onClose={() => setPickerTrack(null)}
      />

      {editingPadIndex !== null && (
        <ModalPortal>
          <div className="bg-surface border border-white/20 rounded-2xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto overscroll-contain shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-accent" />
                <h3 className="font-bold text-white text-base sm:text-lg">
                  Harmonic Chord Editor — Mengedit Pad #{editingPadIndex + 1}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingPadIndex(null)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between bg-black/60 p-3.5 rounded-xl border border-white/10">
              <div>
                <span className="text-xs text-gray-400 font-mono">Hasil Formula Akor:</span>
                <div className="text-2xl font-black text-accent">
                  {buildHarmonicChord(draftChord).displayName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => previewDraftChord(draftChord)}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 border border-white/15 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Test Suara</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-black/40 p-3 rounded-xl border border-white/[0.06] text-xs">
              <div>
                <span className="text-gray-300 font-bold block mb-1">Inversion:</span>
                <div className="grid grid-cols-4 gap-1">
                  {CHORD_INVERSIONS.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, inversion: inv.id })}
                      className={`py-1.5 rounded-lg font-bold text-[10px] cursor-pointer ${
                        (draftChord.inversion || 0) === inv.id
                          ? 'bg-accent text-on-accent shadow'
                          : 'bg-black/60 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {inv.id === 0 ? 'Root' : `${inv.id}nd`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-gray-300 font-bold block mb-1">Octave Shift:</span>
                <div className="grid grid-cols-5 gap-1">
                  {[-2, -1, 0, 1, 2].map((oct) => (
                    <button
                      key={oct}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, octaveOffset: oct })}
                      className={`py-1.5 rounded-lg font-bold text-[10px] cursor-pointer ${
                        (draftChord.octaveOffset || 0) === oct
                          ? 'bg-accent text-on-accent shadow'
                          : 'bg-black/60 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {oct === 0 ? 'Base' : oct > 0 ? `+${oct}` : oct}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Root</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  {NOTE_ROOTS.map((root) => (
                    <button
                      key={root}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, root })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        draftChord.root === root ? 'bg-accent text-on-accent' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {root}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Quality</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  {CHORD_QUALITIES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, type })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        draftChord.type === type ? 'bg-accent text-on-accent' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Tension</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  {CHORD_TENSIONS.map((tension) => (
                    <button
                      key={tension}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, tension })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        (draftChord.tension || 'none') === tension ? 'bg-accent text-on-accent' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {tension === 'none' ? 'None' : tension}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Bass Note</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  <button
                    type="button"
                    onClick={() => previewDraftChord({ ...draftChord, bass: 'none' })}
                    className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                      !draftChord.bass || draftChord.bass === 'none' ? 'bg-accent text-on-accent' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    Root
                  </button>
                  {NOTE_ROOTS.map((bass) => (
                    <button
                      key={bass}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, bass })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        draftChord.bass === bass ? 'bg-accent text-on-accent' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      /{bass}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setEditingPadIndex(null)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={applyHarmonicChord}
                className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-accent/20"
              >
                <Check className="w-4 h-4" />
                <span>Simpan ke Pad #{editingPadIndex + 1}</span>
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {isExportMenuOpen && isUnlocked8Bar && (
        <ModalPortal onClose={() => setIsExportMenuOpen(false)}>
          <div className="relative w-full max-w-xs max-h-[92dvh] overflow-y-auto overscroll-contain rounded-2xl bg-surface border border-white/[0.12] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Pilih Cakupan Ekspor</h3>
              <button
                type="button"
                onClick={() => setIsExportMenuOpen(false)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setExportScope('drum');
                  setIsExportMenuOpen(false);
                  setIsExportModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Disc className="w-4 h-4 text-accent" />
                <span>Hanya Pola Drum</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportScope('chord');
                  setIsExportMenuOpen(false);
                  setIsExportModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Music className="w-4 h-4 text-accent" />
                <span>4 Instrumen Akor</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportScope('both');
                  setIsExportMenuOpen(false);
                  setIsExportModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Layers className="w-4 h-4 text-accent" />
                <span>Drum + Semua Instrumen Akor</span>
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      <ExportPatternModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        tab={activeTab}
        exportScope={exportScope}
        totalBars={TOTAL_BARS}
        stepsPerBar={stepsPerBar}
        timeSignature={{ num: timeSig.num, den: timeSig.den }}
        bpm={bpm}
        drumGrid={exportDrumGrid}
        chordTracksData={exportChordTracksData}
        drumMix={drumMix}
        drumVolume={drumVolume / 100}
        selectedDrumKit={selectedDrumKit}
        projectPayload={isExportModalOpen ? encodeProjectPayload(snapshotProject()) : undefined}
        onSuccessToast={onSuccessToast}
      />
    </section>
  );
};
