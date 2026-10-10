// src/components/AudioStudio/PadStudio.tsx
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react';
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
  ChevronUp,
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
  Timer,
  Save,
  FolderOpen,
  MousePointer2,
  Eraser,
  Hand,
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
import { PadEffectsModal } from './PadEffectsModal';
import { emptyFx, serializeFx, deserializeFx, totalActiveFx, type PadFxState } from '../../services/padFxModel';
import { downloadBlob } from '../../services/exporters';
import { PadProject, Adsr4, padToTuple, tupleToPad } from './midiProject';
import {
  FREE_MAX_BARS,
  FREE_DRUM_KITS,
  FREE_CHORD_PROGRAMS,
  FREE_CHORD_SLOTS,
  PadAction,
  PadSettings,
  fetchPadPolicy,
  loadPadSettings,
  savePadSettings,
  authorizePadAction,
  enforcePadSettings,
  saveProjectOnServer,
  loadProjectOnServer,
} from '../../services/padPolicy';
import { ModalPortal } from './ModalPortal';
import { AdsrMini, IntField } from './NumberFields';
import {
  DRUM_KITS,
  TOTAL_BARS,
  TIME_SIGNATURES,
  getTimeSig,
  stepsPerBarOf,
  defaultBarsPerView,
  BARS_PER_VIEW_OPTIONS,
  makeDefaultPadChords,
  DEFAULT_DRUM_ADSR,
  DRUM_ADSR_RANGES,
  CHORD_ADSR_RANGES,
  adsrTuple,
  type TimeSignatureDef,
} from './padContext';
export type { TimeSignatureDef };
export { DRUM_KITS, TOTAL_BARS, TIME_SIGNATURES };
import { InstrumentPickerModal } from './InstrumentPickerModal';
import { SoundBankCredits } from './SoundBankCredits';
import {
  DYN_KEY_CODES,
  DRUM_LEVEL_MAX,
  DRUM_LEVEL_LABEL,
  DRUM_LEVEL_SHORT,
  DRUM_LEVEL_DESC,
  DRUM_LEVEL_GAIN,
  DRUM_LEVEL_CELL_CLASS,
  DRUM_FLAT_LEVEL,
  DEFAULT_LIVE_LEVEL,
  CHORD_LEVEL_GAIN,
  DYN_MODES,
  DYN_PALETTE,
  DynMode,
  clampDynMode,
  snapLevel,
  nextLevelInPalette,
  dynLevelForKey,
  dynKeyGuide,
  clampLevel,
  emptyTrackData,
  normalizeLens,
  listNotes,
  noteStartCovering,
  insertNote,
  removeNote,
  resizeNote,
  remapTrackData,
  noteGain,
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
// edit = pasang/ubah pad; select = pilih area. Tahan Shift untuk MENAMBAH ke pilihan (tanpa melepas yang lama).
type EditMode = 'edit' | 'select';
// Bagian yang ikut diputar saat tombol Putar ditekan: Drum, Akor, atau keduanya (minimal satu harus aktif).
type PlayPart = 'drum' | 'chord';

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

// Keyboard fisik -> pad akor live (16 pad per bank): baris atas A S D F G H J K, baris bawah L Z X C V B N M.
const CHORD_KEY_CODES = ['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM'];
const CHORD_KEY_LABELS = ['A','S','D','F','G','H','J','K','L','Z','X','C','V','B','N','M'];

// Batas pengguna gratis (Bar 1, kit, instrumen akor, slot) didefinisikan di src/services/padPolicy.ts dan
// DIPAKSA di server (server/padEditorRoutes.ts). Ekspor Pola, Simpan Proyek, Muat Proyek = berbayar (izin dari server).

// ---------------------------------------------------------------------------
// BIRAMA (TIME SIGNATURE)
// Grid memakai resolusi 1/16 not: 1 step = 1/16. BPM dihitung per not seperempat (1 seperempat = 4 step).
// Jumlah step per bar = jumlah semua `groups`. `groups` = panjang tiap kelompok ketukan (dalam step) dan
// dipakai untuk penanda ketukan di grid serta pola drum bawaan.
//   4/4  -> [4,4,4,4]  = 16 step      3/4 -> [4,4,4] = 12 step     6/8 -> [6,6] = 12 step
//   7/8  -> [4,4,6]    = 14 step      5/4 -> 5 x 4  = 20 step
// ---------------------------------------------------------------------------
const INITIAL_TS = getTimeSig('4/4');
const INITIAL_STEPS_PER_BAR = stepsPerBarOf(INITIAL_TS);
const INITIAL_TOTAL_STEPS = INITIAL_STEPS_PER_BAR * TOTAL_BARS;
const DEFAULT_PATTERN_BARS = 4; // pola bawaan mengisi 4 bar pertama
const DEFAULT_LOOP_END_BAR = 4;

// Ikon tombol Belah: satu not panjang yang dibelah garis vertikal menjadi dua. Gaya garis sama dengan lucide-react.
const SplitNoteIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <rect x="2" y="8" width="6" height="8" rx="1.5" />
    <rect x="16" y="8" width="6" height="8" rx="1.5" />
    <path d="M12 3v18" />
  </svg>
);

// Ikon tombol Efek: pedal efek (stompbox) dengan dua knob, label, dan footswitch. Gaya garis sama dengan lucide-react.
const FxPedalIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
  >
    <rect x="5" y="2.5" width="14" height="19" rx="2.5" />
    <circle cx="9" cy="6.6" r="1.3" />
    <circle cx="15" cy="6.6" r="1.3" />
    <path d="M9 10.8h6" />
    <circle cx="12" cy="16.5" r="2" />
  </svg>
);

// Jumlah bar yang digambar sekaligus (dipilih supaya sel tetap cukup lebar dan DOM tetap kecil).
const MAX_BARS_PER_VIEW = 8;
const MAX_SHIFT_BARS = TOTAL_BARS / 2; // sekali geser maksimal separuh dari total bar (64 / 2 = 32)

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
// Nilai = level dinamika 0–6 (kick/snare f = 5, hi-hat p = 2).
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
      grid.kick[base + starts[g]] = 5;
    });
    snareGroups.forEach((g) => {
      grid.snare[base + starts[g]] = 5;
    });
    for (let i = 0; i < S; i += 2) grid.closedhat[base + i] = 2;
  }
  return grid;
}

// Progresi akor bawaan: satu akor di awal tiap bar (panjang 1 bar), 4 bar pertama.
function buildDefaultChordSteps(ts: TimeSignatureDef): { steps: number[]; lens: number[]; vels: number[] } {
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
// - Hanya bar yang sedang tampil (jendela) yang digambar di DOM, bukan seluruh bar proyek.
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
  isPlaying: boolean;
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
  drumDynMode: DynMode;
  chordDynMode: DynMode;
  chordDynamicsOn: boolean;
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
// Dinamika live drum dari posisi klik: makin jauh dari pusat pad, makin lemah. Batas = proporsi dari setengah lebar/tinggi pad
// (elips), sama persis dengan cincin yang digambar di pad.
// Jumlah cincin = jumlah tingkat - 1 (6 tingkat: 5 cincin, 4 tingkat: 3 cincin, 2 tingkat: 1 cincin).
const liveRings = (levels: number): number[] =>
  levels <= 2 ? [0.55] : levels <= 4 ? [0.3, 0.55, 0.8] : [0.2, 0.36, 0.52, 0.68, 0.84];
const levelFromOffset = (dx: number, dy: number, halfW: number, halfH: number, mode: DynMode): number => {
  const pal = DYN_PALETTE[mode];
  const rings = liveRings(pal.length);
  const d = Math.sqrt((dx / halfW) ** 2 + (dy / halfH) ** 2);
  for (let i = 0; i < rings.length; i++) if (d <= rings[i]) return pal[pal.length - 1 - i];
  return pal[0];
};

// Dinamika mati: semua pad aktif dibunyikan sama keras (level DRUM_FLAT_LEVEL). Data level asli tetap tersimpan,
// jadi menyalakan kembali dinamika mengembalikan tingkat yang pernah dipasang. Saat menyala, level dibulatkan ke
// tingkat terdekat di mode dinamika yang dipilih (6 / 4 / 2); datanya sendiri tidak diubah.
const effLevel = (level: number, dynamics: boolean, mode: DynMode): number =>
  level > 0 ? (dynamics ? snapLevel(level, mode) : DRUM_FLAT_LEVEL) : 0;

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

// Pilihan bagian yang diputar: dua kotak centang. Boleh keduanya aktif, tetapi minimal satu harus aktif.
const PLAY_PARTS: Array<{ id: PlayPart; label: string; Icon: React.ComponentType<{ className?: string }>; tip: string }> = [
  { id: 'drum', label: 'Drum', Icon: Drum, tip: 'Ikutkan drum saat memutar (klik lagi untuk mematikan)' },
  { id: 'chord', label: 'Akor', Icon: Music, tip: 'Ikutkan akor saat memutar (klik lagi untuk mematikan)' },
];

const defaultTrackLabel = (id: number) => `Progresi Akor ${id}`;

// Pad akor live: lama maksimal akor ditahan, dan lama minimal akor berbunyi walau pad hanya diketuk.
const CHORD_HOLD_SEC = 30;
const CHORD_TAP_MIN_MS = 900;

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
type ChordSnap = Array<{ steps: number[]; lens: number[]; vels?: number[]; enabled: boolean }>;
const HISTORY_LIMIT = 100;
const snapChord = (tracks: Array<{ steps: number[]; lens: number[]; vels?: number[]; enabled: boolean }>): ChordSnap =>
  tracks.map((t) => ({ steps: t.steps, lens: t.lens, vels: t.vels, enabled: t.enabled }));
const chordSnapEqual = (a: ChordSnap, b: ChordSnap): boolean =>
  a.length === b.length && a.every((t, i) => t.steps === b[i].steps && t.lens === b[i].lens && t.vels === b[i].vels && t.enabled === b[i].enabled);

const DrumCell = memo(function DrumCell({
  drumId,
  stepIdx,
  level,
  selected,
  beat,
  dynamics,
  mode,
  showText,
  onCycle,
  onMenu,
}: {
  drumId: string;
  stepIdx: number;
  level: number; // level yang sudah memperhitungkan dinamika (mati = 0 atau DRUM_FLAT_LEVEL)
  selected: boolean;
  beat: boolean;
  dynamics: boolean;
  mode: DynMode;
  showText: boolean; // tampilkan teks dinamika (pp ... ff) di dalam pad (hanya bila dinamika menyala)
  onCycle: (drumId: string, stepIdx: number) => void;
  onMenu: (drumId: string, stepIdx: number, el: HTMLElement) => void;
}) {
  const next = nextLevelInPalette(level, mode);
  const nextText = next === 0 ? 'hapus' : `naik ke ${DRUM_LEVEL_SHORT[next]}`;
  const firstText = DRUM_LEVEL_SHORT[DYN_PALETTE[mode][0]];
  const ariaLabel = dynamics
    ? level > 0
      ? `Drum ${DRUM_LEVEL_LABEL[level]}, klik untuk ${nextText}`
      : `Pad kosong, klik untuk memasang (mulai dari ${firstText})`
    : level > 0
    ? 'Drum aktif, klik untuk menghapus'
    : 'Pad kosong, klik untuk memasang';
  const title = dynamics
    ? level > 0
      ? `${DRUM_LEVEL_LABEL[level]} (${DRUM_LEVEL_SHORT[level]}) — klik: ${nextText} • klik kanan: pilih langsung`
      : `Klik: pasang ${firstText}, klik lagi untuk menaikkan • klik kanan: pilih langsung`
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
      {level > 0 && dynamics && showText ? DRUM_LEVEL_SHORT[level] : null}
    </button>
  );
});

// Popover kecil untuk memilih dinamika drum. Dirender ke <body> (fixed) supaya tidak terpotong area scroll sequencer.
// Pintasan keyboard: angka 1.. = tingkat dari paling pelan, Delete=hapus, Esc=tutup.
const DrumLevelPicker: React.FC<{
  x: number;
  y: number;
  current: number;
  mode: DynMode;
  onPick: (level: number) => void;
  onClose: () => void;
  heading?: string;
  ariaLabel?: string;
  clearLabel?: string;
  clearIcon?: 'trash' | 'reset';
}> = ({ x, y, current, mode, onPick, onClose, heading = 'Dinamika pukulan', ariaLabel = 'Pilih dinamika drum', clearLabel = 'Hapus pad', clearIcon = 'trash' }) => {
  const pal = DYN_PALETTE[mode];
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
      else if (e.key >= '1' && Number(e.key) <= pal.length) onPick(pal[Number(e.key) - 1]);
      else if ((e.key === 'Delete' || e.key === 'Backspace') && current > 0) onPick(0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPick, current, pal]);

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
        aria-label={ariaLabel}
        onPointerDown={(e) => e.stopPropagation()}
        style={{ left: pos.left, top: pos.top }}
        className="fixed w-48 rounded-xl border border-white/15 bg-zinc-950/95 backdrop-blur p-1.5 shadow-2xl shadow-black/60"
      >
        <div className="px-1.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">{heading}</div>
        {pal.map((lv, li) => (
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
            <kbd className="text-[9px] font-mono text-gray-500 border border-white/10 rounded px-1">{li + 1}</kbd>
          </button>
        ))}
        {current > 0 && (
          <button
            type="button"
            onClick={() => onPick(0)}
            className={`mt-1 w-full flex items-center justify-center gap-1.5 px-1.5 py-1.5 rounded-lg text-[11px] font-bold border-t border-white/10 cursor-pointer ${
              clearIcon === 'reset' ? 'text-gray-300 hover:bg-white/10' : 'text-red-300 hover:bg-red-500/15'
            }`}
          >
            {clearIcon === 'reset' ? <RotateCcw className="w-3 h-3" /> : <Trash2 className="w-3 h-3" />}
            {clearLabel}
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
    <IntField
      value={value}
      min={0}
      max={100}
      onChange={onChange}
      ariaLabel={`${title} (ketik angka 0–100)`}
      className="w-9 shrink-0 bg-black/80 rounded border border-white/15 px-0.5 py-0.5 text-[10px] font-mono text-accent text-center outline-none focus:border-accent"
    />
    <span className="text-[10px] font-mono text-gray-400 shrink-0">%</span>
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
  rowIdx,
  label,
  mix,
  showMixer,
  onMix,
  onAdsr,
  onSelectRow,
  rowSelected,
  pickMode,
}: {
  id: string;
  rowIdx: number;
  rowSelected: boolean;
  pickMode: boolean;
  onSelectRow: (row: number, additive: boolean) => void;
  label: string;
  mix: DrumMixState;
  showMixer: boolean;
  onMix: (id: string, patch: Partial<DrumMixState>) => void;
  onAdsr: (id: string, patch: Partial<EnvelopeADSR>) => void;
}) {
  const [adsrOpen, setAdsrOpen] = useState(false);
  return (
    <div
      className={`${labelWidth(showMixer)} shrink-0 relative border-r border-white/10 pl-4 pr-3 py-2 space-y-2 transition-colors ${
        rowSelected ? 'bg-accent/20' : 'bg-black/40'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${mix.muted ? 'bg-red-500/70' : mix.solo ? 'bg-accent' : 'bg-accent/40'}`}
      />
      <div className="flex items-center justify-between gap-1.5">
        <button
          type="button"
          onClick={(e) => {
            if (pickMode || e.shiftKey) onSelectRow(rowIdx, e.shiftKey);
          }}
          aria-pressed={rowSelected}
          title={`Klik: pilih seluruh instrumen ${label} (Shift+klik = tambahkan / lepas dari pilihan). Lalu Salin, Potong, atau Hapus isinya.`}
          className={`min-w-0 flex items-center gap-1 text-left text-xs font-semibold truncate hover:text-accent cursor-pointer ${
            rowSelected ? 'text-accent' : 'text-gray-200'
          }`}
        >
          {(pickMode || rowSelected) && <BoxSelect className="w-3 h-3 shrink-0" />}
          <span className="truncate">{label}</span>
        </button>
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

// Kolom label baris akor: nama progresi (bisa diganti nama) + instrumen + M/S + Duplikat / Hapus + urutan.
// Volume & ADSR hanya tampil saat "Mixer" aktif.
const ChordLabel = memo(function ChordLabel({
  tIdx,
  track,
  instName,
  showMixer,
  onUpdateTrack,
  onUpdateAdsr,
  onPickInstrument,
  onRemove,
  onSelectRow,
  rowSelected,
  pickMode,
  canDuplicate,
  onDuplicate,
  canRemove,
  onRename,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  tIdx: number;
  rowSelected: boolean;
  pickMode: boolean;
  canDuplicate: boolean;
  onDuplicate: (trackIndex: number) => void;
  canRemove: boolean;
  onRename: (trackIndex: number, name: string) => void;
  onMove: (trackIndex: number, dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  track: ChordTrackState;
  instName: string;
  showMixer: boolean;
  onUpdateTrack: (trackIndex: number, updates: Partial<ChordTrackState>) => void;
  onUpdateAdsr: (trackIndex: number, patch: Partial<EnvelopeADSR>) => void;
  onPickInstrument: (trackIndex: number) => void;
  onRemove: (trackIndex: number) => void;
  onSelectRow: (row: number, additive: boolean) => void;
}) {
  const [adsrOpen, setAdsrOpen] = useState(false);
  // Ganti nama progresi: Enter / klik di luar = simpan, Esc = batal. Nama kosong dibatalkan, maksimal 40 karakter.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.label);
  const finishedRef = useRef(false);
  const startRename = () => {
    finishedRef.current = false;
    setDraft(track.label);
    setEditing(true);
  };
  const finishRename = (save: boolean) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setEditing(false);
    const v = draft.trim().slice(0, 40);
    if (save && v && v !== track.label) onRename(tIdx, v);
  };
  return (
    <div
      className={`${labelWidth(showMixer)} shrink-0 relative border-r border-white/10 pl-4 pr-3 py-2 space-y-2 transition-colors ${
        rowSelected ? 'bg-accent/20' : 'bg-black/40'
      }`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-0 w-1 ${track.muted ? 'bg-red-500/70' : track.solo ? 'bg-accent' : 'bg-accent/40'}`}
      />
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              autoFocus
              value={draft}
              maxLength={40}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.currentTarget.select()}
              onBlur={() => finishRename(true)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  e.preventDefault();
                  finishRename(true);
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  finishRename(false);
                }
              }}
              aria-label="Nama progresi akor"
              className="w-full bg-black/70 border border-accent/60 rounded px-1.5 py-0.5 text-xs font-semibold text-white outline-none focus:border-accent"
            />
          ) : (
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={(e) => {
                  // Klik biasa = ganti nama. Di mode Pilih atau dengan Shift, klik memilih seluruh instrumen.
                  if (pickMode || e.shiftKey) onSelectRow(tIdx, e.shiftKey);
                  else startRename();
                }}
                aria-pressed={rowSelected}
                title={
                  pickMode
                    ? `Klik: pilih seluruh instrumen ${track.label} (Shift+klik = tambahkan / lepas dari pilihan)`
                    : `Klik untuk mengganti nama ${track.label}. Shift+klik = pilih seluruh instrumen ini.`
                }
                className={`min-w-0 max-w-full flex items-center gap-1 text-left text-xs font-semibold rounded-md border border-white/10 bg-white/[0.07] hover:bg-white/15 hover:border-accent/50 px-1.5 py-0.5 cursor-text transition-colors ${
                  rowSelected ? 'text-accent' : 'text-gray-200'
                }`}
              >
                {(pickMode || rowSelected) && <BoxSelect className="w-3 h-3 shrink-0" />}
                <span className="truncate">{track.label}</span>
              </button>
            </div>
          )}
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
        <MuteSoloButtons
          muted={track.muted}
          solo={track.solo}
          onMute={() => onUpdateTrack(tIdx, { muted: !track.muted })}
          onSolo={() => onUpdateTrack(tIdx, { solo: !track.solo })}
        />
      </div>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={() => onDuplicate(tIdx)}
          disabled={!canDuplicate}
          title={
            canDuplicate
              ? `Duplikat ${track.label}: isi, instrumen, volume, dan ADSR ikut disalin ke slot kosong`
              : 'Semua slot instrumen akor sudah terpakai (maksimal 4)'
          }
          className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-accent cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400"
        >
          <CopyPlus className="w-3 h-3" />
          <span>Duplikat</span>
        </button>
        <button
          type="button"
          onClick={() => onRemove(tIdx)}
          disabled={!canRemove}
          title={canRemove ? `Hapus ${track.label}` : 'Minimal harus ada satu progresi akor'}
          className="flex items-center gap-1 text-[10px] font-bold text-gray-400 hover:text-red-400 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400"
        >
          <Trash2 className="w-3 h-3" />
          <span>Hapus</span>
        </button>
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={() => onMove(tIdx, -1)}
            disabled={!canMoveUp}
            title={`Naikkan ${track.label} (tukar urutan dengan progresi di atasnya)`}
            aria-label={`Naikkan ${track.label}`}
            className="p-0.5 rounded text-gray-400 hover:text-accent hover:bg-white/5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onMove(tIdx, 1)}
            disabled={!canMoveDown}
            title={`Turunkan ${track.label} (tukar urutan dengan progresi di bawahnya)`}
            aria-label={`Turunkan ${track.label}`}
            className="p-0.5 rounded text-gray-400 hover:text-accent hover:bg-white/5 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
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
  dynMode,
  dynText,
  onCycle,
  onMenu,
  onSelectRow,
  rowSelected,
  pickMode,
}: {
  rowSelected: boolean;
  pickMode: boolean;
  dynText: boolean;
  rowIdx: number;
  onSelectRow: (row: number, additive: boolean) => void;
  dynamics: boolean;
  dynMode: DynMode;
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
      <DrumLabel
        id={id}
        rowIdx={rowIdx}
        label={label}
        mix={mix}
        showMixer={showMixer}
        onMix={onMix}
        onAdsr={onAdsr}
        onSelectRow={onSelectRow}
        rowSelected={rowSelected}
        pickMode={pickMode}
      />
      <div className="flex-1 min-w-0 pl-2 pr-0 py-1 flex items-center">
        <div className="grid gap-0.5 w-full min-w-0" style={gridStyle} data-rowgrid="" data-row={rowIdx}>
          {steps.map((stepIdx) => (
            <DrumCell
              key={stepIdx}
              drumId={id}
              stepIdx={stepIdx}
              level={effLevel(clampLevel(row?.[stepIdx]), dynamics, dynMode)}
              selected={selSteps ? selSteps.has(stepIdx) : false}
              beat={Boolean(beatMask[stepIdx % stepsPerBar])}
              dynamics={dynamics}
              mode={dynMode}
              showText={dynText}
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
  vel,
  dynamics,
  dynMode,
  dynText,
  onLevelCycle,
  onLevelMenu,
}: {
  vel: number;
  dynamics: boolean;
  dynMode: DynMode;
  dynText: boolean;
  onLevelCycle: (trackIdx: number, start: number) => void;
  onLevelMenu: (trackIdx: number, start: number, el: HTMLElement) => void;
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

  // Dinamika akor: level tersimpan dibulatkan ke palet mode yang dipilih (6 / 4 / 2). 0 = normal (belum diatur).
  const lv = dynamics ? snapLevel(clampLevel(vel), dynMode) : 0;
  const nextLv = nextLevelInPalette(lv, dynMode);
  const nextText = nextLv === 0 ? 'kembali ke normal' : `naik ke ${DRUM_LEVEL_SHORT[nextLv]}`;
  const levelTitle = lv > 0
    ? `${DRUM_LEVEL_LABEL[lv]} (${DRUM_LEVEL_SHORT[lv]}) — klik: ${nextText} • klik kanan: pilih langsung`
    : `Dinamika normal — klik: pasang ${DRUM_LEVEL_SHORT[DYN_PALETTE[dynMode][0]]}, klik lagi untuk menaikkan • klik kanan: pilih langsung`;

  return (
    <div
      data-block=""
      onContextMenu={(e) => {
        if (!dynamics || getMode() !== 'edit') return;
        e.preventDefault();
        onLevelMenu(trackIdx, note.start, e.currentTarget);
      }}
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
        {dynamics ? (
          <button
            type="button"
            data-keepsel=""
            title={levelTitle}
            aria-label={levelTitle}
            onPointerDown={(e) => {
              if (getMode() === 'edit' && !e.shiftKey) e.stopPropagation();
            }}
            onClick={(e) => {
              if (getMode() !== 'edit' || e.shiftKey) return;
              e.stopPropagation();
              onLevelCycle(trackIdx, note.start);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (getMode() === 'edit') onLevelMenu(trackIdx, note.start, e.currentTarget);
            }}
            className={`relative z-[3] h-4 min-w-[1rem] px-1 rounded-sm flex items-center justify-center text-[9px] font-black italic leading-none cursor-pointer transition-colors ${
              lv > 0 ? `${DRUM_LEVEL_CELL_CLASS[lv]} text-on-accent` : 'bg-black/40 border border-white/20 text-gray-300 hover:bg-white/15'
            }`}
          >
            {lv > 0 ? (dynText ? DRUM_LEVEL_SHORT[lv] : '') : <span className="w-1.5 h-1.5 rounded-full bg-accent" />}
          </button>
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-accent" />
        )}
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
  onSelectRow,
  rowSelected,
  pickMode,
  canDuplicate,
  onDuplicate,
  canRemove,
  onRename,
  onMove,
  canMoveUp,
  canMoveDown,
  dynamics,
  dynMode,
  dynText,
  onLevelCycle,
  onLevelMenu,
}: {
  dynamics: boolean;
  dynMode: DynMode;
  dynText: boolean;
  onLevelCycle: (trackIdx: number, start: number) => void;
  onLevelMenu: (trackIdx: number, start: number, el: HTMLElement) => void;
  rowSelected: boolean;
  pickMode: boolean;
  canDuplicate: boolean;
  onDuplicate: (trackIndex: number) => void;
  canRemove: boolean;
  onRename: (trackIndex: number, name: string) => void;
  onMove: (trackIndex: number, dir: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelectRow: (row: number, additive: boolean) => void;
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
        onSelectRow={onSelectRow}
        rowSelected={rowSelected}
        pickMode={pickMode}
        canDuplicate={canDuplicate}
        onDuplicate={onDuplicate}
        canRemove={canRemove}
        onRename={onRename}
        onMove={onMove}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
      />
      <div className="flex-1 min-w-0 pl-2 pr-0 py-1.5 flex items-center">
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
            vel={clampLevel(track.vels?.[n.start])}
            dynamics={dynamics}
            dynMode={dynMode}
            dynText={dynText}
            onLevelCycle={onLevelCycle}
            onLevelMenu={onLevelMenu}
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
          <div className="fixed inset-0 z-[80]" data-keepsel="" onPointerDown={() => setOpen(false)}>
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

// Saklar dinamika drum: ON = tingkat dinamika (pp ... ff) berlaku; OFF = semua pukulan sama keras.
const DynamicsToggle: React.FC<{ on: boolean; onToggle: () => void; noun?: string }> = ({ on, onToggle, noun = 'pukulan' }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    onClick={onToggle}
    title={
      on
        ? `Dinamika menyala. Klik untuk mematikan: semua ${noun} jadi sama keras.`
        : `Dinamika mati: semua ${noun} sama keras. Klik untuk menyalakan.`
    }
    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
      on ? 'bg-accent/20 text-accent border-accent/40' : 'bg-black/60 text-gray-400 border-white/10 hover:border-white/25'
    }`}
  >
    <Gauge className="w-3 h-3" />
    <span>Dinamika</span>
  </button>
);

// Saklar teks pp / p / f / ff di dalam pad. Selalu tampil di sebelah KIRI tombol Dinamika (tidak muncul / hilang),
// jadi posisi tombol Dinamika tidak bergeser. Saat dinamika mati, tombol ini dinonaktifkan (pilihannya tetap diingat).
const DynTextToggle: React.FC<{ on: boolean; disabled: boolean; onToggle: () => void }> = ({ on, disabled, onToggle }) => {
  const active = on && !disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      disabled={disabled}
      onClick={onToggle}
      title={
        disabled
          ? 'Teks dinamika hanya berlaku saat dinamika menyala.'
          : on
          ? 'Teks dinamika tampil di pad. Klik untuk menyembunyikannya (dinamika tetap menyala).'
          : 'Teks dinamika disembunyikan. Klik untuk menampilkan.'
      }
      className={`flex items-center px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
        disabled
          ? 'bg-black/40 text-gray-600 border-white/5 opacity-50 cursor-not-allowed'
          : active
          ? 'bg-accent/20 text-accent border-accent/40 cursor-pointer'
          : 'bg-black/60 text-gray-400 border-white/10 hover:border-white/25 cursor-pointer'
      }`}
    >
      Teks
    </button>
  );
};

// Pemilih jumlah tingkat dinamika: 6 (pp p mp mf f ff), 4 (p mp mf f) atau 2 (p f). Dipakai untuk drum dan akor.
const DynModePicker: React.FC<{ kind: 'drum' | 'chord'; mode: DynMode; onChange: (m: DynMode) => void; disabled?: boolean }> = ({
  kind,
  mode,
  onChange,
  disabled,
}) => (
  <div
    role="radiogroup"
    aria-label={kind === 'drum' ? 'Jumlah tingkat dinamika drum' : 'Jumlah tingkat dinamika akor'}
    className={`flex items-center gap-0.5 bg-black/60 border border-white/10 rounded-lg p-0.5 ${disabled ? 'opacity-50' : ''}`}
    title={`Jumlah tingkat dinamika ${kind === 'drum' ? 'drum' : 'akor'}: 6 (pp p mp mf f ff), 4 (p mp mf f) atau 2 (p f).`}
  >
    <span className="px-1.5 text-[10px] font-bold text-gray-400">Tingkat</span>
    {DYN_MODES.map((m) => (
      <button
        key={m}
        type="button"
        role="radio"
        aria-checked={mode === m}
        disabled={disabled}
        onClick={() => onChange(m)}
        title={`${m} tingkat: ${DYN_PALETTE[m].map((l) => DRUM_LEVEL_SHORT[l]).join(', ')}  •  ${dynKeyGuide(kind, m)}`}
        className={`px-2 py-0.5 rounded-md text-[11px] font-bold transition-colors ${
          mode === m ? 'bg-accent text-on-accent shadow' : 'text-gray-300 hover:bg-white/10'
        } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        {m}
      </button>
    ))}
  </div>
);

// Mode dinamika yang diingat di localStorage. Aman bila storage diblokir.
function usePersistedDynMode(key: string, initial: DynMode): [DynMode, (m: DynMode) => void] {
  const [val, setVal] = useState<DynMode>(() => {
    try {
      const saved = window.localStorage.getItem(key);
      return saved === null ? initial : clampDynMode(parseInt(saved, 10));
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(key, String(val));
    } catch {
      // Abaikan jika storage tidak tersedia
    }
  }, [key, val]);
  return [val, setVal];
}

const SPIN_INPUT_CLASS =
  'w-9 bg-black/80 rounded-l-lg border border-white/15 px-0.5 py-1 text-sm font-mono font-bold text-accent text-center outline-none focus:border-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

// Dua tombol kecil atas / bawah di sisi kanan kolom angka.
const SpinButtons: React.FC<{ onUp: () => void; onDown: () => void; upDisabled?: boolean; downDisabled?: boolean; label: string }> = ({
  onUp,
  onDown,
  upDisabled,
  downDisabled,
  label,
}) => (
  <div className="flex flex-col -ml-px">
    <button
      type="button"
      onClick={onUp}
      disabled={upDisabled}
      aria-label={`${label}: naikkan`}
      title="Naikkan"
      className="flex items-center justify-center px-1 h-[15px] rounded-tr-lg border border-white/15 bg-white/5 hover:bg-white/15 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
    >
      <ChevronUp className="w-3 h-3" />
    </button>
    <button
      type="button"
      onClick={onDown}
      disabled={downDisabled}
      aria-label={`${label}: turunkan`}
      title="Turunkan"
      className="flex items-center justify-center px-1 h-[15px] -mt-px rounded-br-lg border border-white/15 bg-white/5 hover:bg-white/15 text-gray-300 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
    >
      <ChevronDown className="w-3 h-3" />
    </button>
  </div>
);

// Kolom angka: bisa diketik manual (IntField) dan diatur dengan tombol atas / bawah.
const SpinField: React.FC<{ value: number; min: number; max: number; onChange: (v: number) => void; ariaLabel: string }> = ({
  value,
  min,
  max,
  onChange,
  ariaLabel,
}) => (
  <div className="flex items-stretch">
    <IntField value={value} min={min} max={max} onChange={onChange} ariaLabel={ariaLabel} className={SPIN_INPUT_CLASS} />
    <SpinButtons
      label={ariaLabel}
      onUp={() => onChange(Math.min(max, value + 1))}
      onDown={() => onChange(Math.max(min, value - 1))}
      upDisabled={value >= max}
      downDisabled={value <= min}
    />
  </div>
);

// Kotak kelompok yang dipakai bersama oleh seluruh grup di baris step bar.
const BAR_BOX = 'shrink-0 whitespace-nowrap flex items-center gap-1.5 text-xs text-gray-300 bg-black/40 border border-white/10 rounded-xl px-2 py-1';
// Varian untuk kotak yang ikut melebar supaya baris kontrol sejajar dengan lebar toolbar di bawahnya.
const BAR_BOX_GROW = `${BAR_BOX} flex-1 justify-center`;

// Tempo: (1) ketik angka langsung di kotaknya (tempo berubah seketika selama angkanya 60–300), (2) tombol − / + (tahan = terus berubah),
// (3) panah ↑ / ↓ di keyboard (Shift = ±10), (4) Tap Tempo: ketuk tombol Tap sesuai ketukan lagu (minimal 2 kali).
const TEMPO_MIN = 60;
const TEMPO_MAX = 300;
const TAP_RESET_MS = 2000;
const TempoControl: React.FC<{ bpm: number; setBpm: React.Dispatch<React.SetStateAction<number>> }> = ({ bpm, setBpm }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const tapsRef = useRef<number[]>([]);
  const tapTimerRef = useRef<number | null>(null);
  const holdRef = useRef<{ delay: number | null; tick: number | null }>({ delay: null, tick: null });

  const clampBpm = (n: number) => Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, n));
  const bump = useCallback((d: number) => {
    setDraft(null);
    setBpm((p) => Math.max(TEMPO_MIN, Math.min(TEMPO_MAX, p + d)));
  }, [setBpm]);
  const stopHold = useCallback(() => {
    if (holdRef.current.delay !== null) window.clearTimeout(holdRef.current.delay);
    if (holdRef.current.tick !== null) window.clearInterval(holdRef.current.tick);
    holdRef.current = { delay: null, tick: null };
  }, []);
  const startHold = (d: number) => {
    stopHold();
    bump(d);
    holdRef.current.delay = window.setTimeout(() => {
      holdRef.current.tick = window.setInterval(() => bump(d), 70);
    }, 400);
  };
  useEffect(
    () => () => {
      stopHold();
      if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
    },
    [stopHold]
  );

  const holdProps = (d: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      startHold(d);
    },
    onPointerUp: stopHold,
    onPointerLeave: stopHold,
    onPointerCancel: stopHold,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        bump(d);
      }
    },
  });

  const commitDraft = () => {
    if (draft !== null) {
      const n = parseInt(draft, 10);
      if (!Number.isNaN(n)) setBpm(clampBpm(n));
    }
    setDraft(null);
  };

  // Tap tempo: rata-rata jarak antar ketukan terakhir (maks 8 ketukan). Jeda > 2 detik memulai hitungan baru.
  const tap = () => {
    const now = performance.now();
    const taps = tapsRef.current;
    if (taps.length > 0 && now - taps[taps.length - 1] > TAP_RESET_MS) taps.length = 0;
    taps.push(now);
    if (taps.length > 8) taps.shift();
    if (taps.length >= 2) {
      const avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setDraft(null);
      setBpm(clampBpm(Math.round(60000 / avg)));
    }
    if (tapTimerRef.current !== null) window.clearTimeout(tapTimerRef.current);
    tapTimerRef.current = window.setTimeout(() => {
      tapsRef.current = [];
    }, TAP_RESET_MS);
  };

  const stepBtn =
    'p-1.5 rounded-lg bg-white/5 hover:bg-white/15 active:bg-accent active:text-black text-gray-200 border border-white/10 disabled:opacity-40 cursor-pointer touch-none select-none';
  return (
    <div className={BAR_BOX}>
      <span className="text-[11px] font-bold text-gray-400 select-none">TEMPO</span>
      <button
        type="button"
        {...holdProps(-1)}
        disabled={bpm <= TEMPO_MIN}
        aria-label="Kurangi tempo (tahan untuk terus menurun)"
        title="Kurangi tempo (tahan untuk terus menurun)"
        className={stepBtn}
      >
        <Minus className="w-4 h-4" />
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={draft ?? String(bpm)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const d = e.target.value.replace(/\D/g, '').slice(0, 3);
          setDraft(d);
          const n = parseInt(d, 10);
          if (!Number.isNaN(n) && n >= TEMPO_MIN && n <= TEMPO_MAX) setBpm(n);
        }}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            bump((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
          }
        }}
        aria-label="Tempo (BPM): klik lalu ketik angka 60–300, atau tekan panah atas / bawah"
        title="Klik lalu ketik tempo (60–300 BPM). Panah ↑ / ↓ = ±1, Shift + panah = ±10"
        className="w-12 py-1 text-center font-mono font-black text-base text-accent bg-black/70 border border-white/20 rounded-lg outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 cursor-text select-text"
      />
      <span className="text-[10px] text-gray-400 select-none">BPM</span>
      <button
        type="button"
        {...holdProps(1)}
        disabled={bpm >= TEMPO_MAX}
        aria-label="Tambah tempo (tahan untuk terus menaik)"
        title="Tambah tempo (tahan untuk terus menaik)"
        className={stepBtn}
      >
        <Plus className="w-4 h-4" />
      </button>
      <span aria-hidden="true" className="w-px h-6 bg-white/10" />
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          tap();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            tap();
          }
        }}
        title="Tap Tempo: ketuk berulang sesuai ketukan lagu (minimal 2 kali). Tempo dihitung otomatis dari jeda antar ketukan."
        aria-label="Tap tempo"
        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-bold border cursor-pointer select-none touch-none transition-colors bg-white/5 hover:bg-white/15 active:bg-accent active:text-on-accent text-gray-200 border-white/10"
      >
        <Hand className="w-4 h-4" />
        <span>Tap</span>
      </button>
    </div>
  );
};

const TOOL_BTN =
  'flex flex-1 items-center justify-center gap-2 min-w-[92px] px-3 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer disabled:cursor-not-allowed';
const TOOL_BTN_IDLE = 'bg-white/5 hover:bg-white/15 text-gray-200 border-white/10 disabled:opacity-35 disabled:hover:bg-white/5';
const TOOL_BTN_ON = 'bg-accent/20 text-accent border-accent/40';

const ToolBtn: React.FC<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}> = ({ icon: Icon, label, onClick, disabled, title }) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title} className={`${TOOL_BTN} ${TOOL_BTN_IDLE}`}>
    <Icon className="w-4 h-4 shrink-0" />
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
  vels?: number[]; // dinamika not (1–6 = pp..ff) yang dimulai di step ini (0 / kosong = volume normal)
}

export const PadStudio: React.FC<PadStudioProps> = ({
  entitlements,
  onUnlockEditor,
  onSuccessToast,
}) => {
  // Berbayar = entitlements (dari server) DAN kebijakan server tidak menyatakan gratis. Server hanya bisa menurunkan.
  const entitled = Boolean(entitlements?.fullEditor8Bar);
  const [serverPaid, setServerPaid] = useState<boolean | null>(null);
  const isUnlocked8Bar = entitled && serverPaid !== false;
  const [activeTab, setActiveTab] = useState<PadTab>('drum');
  const [bpm, setBpm] = useState(115);

  // Birama & jendela tampilan grid
  const [timeSigId, setTimeSigId] = useState<string>(INITIAL_TS.id);
  const timeSig = getTimeSig(timeSigId);
  const stepsPerBar = stepsPerBarOf(timeSig);
  const totalSteps = stepsPerBar * TOTAL_BARS;
  const beatInfo = useMemo(() => buildBeatInfo(timeSig), [timeSigId]); // eslint-disable-line react-hooks/exhaustive-deps
  const [barsPerViewRaw, setBarsPerView] = useState<number>(defaultBarsPerView(INITIAL_STEPS_PER_BAR));
  const [viewStartBarRaw, setViewStartBar] = useState<number>(0);
  // Gratis: jendela tampilan terkunci di Bar 1 (1 bar). Nilai mentah tetap disimpan agar kembali normal setelah membeli.
  const barsPerView = isUnlocked8Bar ? barsPerViewRaw : FREE_MAX_BARS;
  const viewStartBar = isUnlocked8Bar ? viewStartBarRaw : 0;
  const [followPlayhead, setFollowPlayhead] = useState(true);
  // Sekali tekan tombol geser kiri / kanan memindahkan tampilan sebanyak ini (bar).
  const [shiftBars, setShiftBars] = useState(1);

  // Satu transport untuk semuanya: `isPlaying` = sedang berjalan; `playDrum` / `playChord` = bagian mana yang berbunyi
  // (boleh keduanya, minimal satu aktif). Drum dan Akor sama-sama gratis (terbatas Bar 1).
  const [isPlaying, setIsPlaying] = useState(false);
  const [playDrum, setPlayDrum] = useState(true);
  const [playChord, setPlayChord] = useState(true);
  const effPlayChord = playChord;
  const effPlayDrum = !effPlayChord || playDrum;
  const isDrumLoopActive = isPlaying && effPlayDrum;
  const isChordLoopActive = isPlaying && effPlayChord;
  const [isSeqLooping, setIsSeqLooping] = useState(true);

  const [loopStartBarRaw, setLoopStartBar] = useState<number>(1);
  const [loopStartBeat, setLoopStartBeat] = useState<number>(1);
  const [loopEndBarRaw, setLoopEndBar] = useState<number>(DEFAULT_LOOP_END_BAR);
  // Gratis: area main terkunci di Bar 1.
  const loopStartBar = isUnlocked8Bar ? loopStartBarRaw : 1;
  const loopEndBar = isUnlocked8Bar ? loopEndBarRaw : FREE_MAX_BARS;
  const [loopEndBeat, setLoopEndBeat] = useState<number>(INITIAL_STEPS_PER_BAR);
  // Grid overlay area main: dipakai untuk menghitung step dari posisi pointer saat pegangan area main ditarik.
  const loopGridRef = useRef<HTMLDivElement>(null);
  // Overlay area main diukur langsung dari grid pad yang sebenarnya (bukan dihitung dari lebar label), supaya tepi
  // kiri / kanannya selalu persis di ujung pad berapa pun lebar label, border, atau scrollbar-nya.
  const seqWrapRef = useRef<HTMLDivElement>(null);
  const [loopBox, setLoopBox] = useState<{ left: number; right: number } | null>(null);
  // Posisi tepi area main (px, relatif terhadap tepi kiri grid pad). Diukur dari tombol ruler yang sebenarnya dan
  // diletakkan di tengah celah antar pad, sehingga garis batas persis di antara pad terakhir area main dan pad sesudahnya.
  const [loopX, setLoopX] = useState<{ x1: number | null; x2: number | null; w: number; gap: number }>({
    x1: null,
    x2: null,
    w: 0,
    gap: 2,
  });

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
  // Teks bantu pp / p / f / ff (di pad live & sequencer). Hanya berlaku saat dinamika menyala; bisa dimatikan sendiri.
  const [dynText, setDynText] = usePersistedBool('padstudio.dynamicsText', true);
  // Jumlah tingkat dinamika drum dan akor (6 / 4 / 2), masing-masing diingat di perangkat.
  const [drumDynMode, setDrumDynMode] = usePersistedDynMode('padstudio.drumDynMode', 6);
  const [chordDynMode, setChordDynMode] = usePersistedDynMode('padstudio.chordDynMode', 6);
  const drumDynModeRef = useRef<DynMode>(drumDynMode);
  drumDynModeRef.current = drumDynMode;
  const chordDynModeRef = useRef<DynMode>(chordDynMode);
  chordDynModeRef.current = chordDynMode;
  // Dinamika akor live (terpisah dari drum): ON = tingkat dari posisi tekan / tombol dinamika berlaku; OFF = semua akor sama keras.
  const [chordDynamicsOn, setChordDynamicsOn] = usePersistedBool('padstudio.chordDynamicsOn', true);
  const [chordDynText, setChordDynText] = usePersistedBool('padstudio.chordDynamicsText', true);
  const chordDynamicsOnRef = useRef(chordDynamicsOn);
  chordDynamicsOnRef.current = chordDynamicsOn;
  // Sisi tombol Shift yang sedang ditahan: Shift KIRI = dinamika drum, Shift KANAN = dinamika akor.
  const shiftSideRef = useRef({ left: false, right: false });
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

  // Penanda: urutan / susunan track berubah (tukar urutan, hapus track teratas), jadi riwayat Undo akor lama tidak cocok lagi.
  const chordHistoryResetRef = useRef(false);

  const [activePadAnim, setActivePadAnim] = useState<string | null>(null);

  const [selectedDrumKit, setSelectedDrumKit] = useState('80s Kit');
  const [engineStatus, setEngineStatus] = useState<string>('');
  const [bankState, setBankState] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => audioEngine.getBankState());

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'drum' | 'chord' | 'both'>('both');

  // Efek (Equalizer, Reverb, Delay, Chorus, Filter, Distortion, Limiter): per bagian drum / instrumen akor, atau semuanya.
  // Disimpan di proyek, dirender saat ekspor audio, dan diteruskan ke engine untuk pemutaran live.
  const [fx, setFx] = useState<PadFxState>(() => emptyFx());
  const [isFxOpen, setIsFxOpen] = useState(false);
  const fxCount = totalActiveFx(fx);
  useEffect(() => {
    audioEngine.setPadEffects(fx);
  }, [fx]);
  // Engine bersifat global (dipakai halaman lain juga): lepas efek Pad Studio saat editor ditutup.
  useEffect(() => () => audioEngine.setPadEffects(emptyFx()), []);

  const sequencerScrollRef = useRef<HTMLDivElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const stepRef = useRef(0); // ketukan BERIKUTNYA yang akan dijadwalkan
  // Jejak ketukan yang baru dijadwalkan (step + waktu jam audio), dipakai untuk membulatkan pukulan rekaman ke step terdekat.
  const recentStepsRef = useRef<{ step: number; time: number }[]>([]);
  const isRecordingRef = useRef(false);
  isRecordingRef.current = isRecording;
  const recTakeOpenRef = useRef(false); // true setelah pukulan pertama sebuah rekaman (satu rekaman = satu langkah undo)
  const recChordTakeOpenRef = useRef(false); // sama, untuk akor
  // Akor yang sedang direkam (pad masih ditahan): kunci = indeks pad, nilai = step awal, waktu awal, dan track tujuan.
  const chordRecRef = useRef<Map<number, { step: number; t0: number; targets: number[] }>>(new Map());

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

  // Teks posisi playhead ("Bar 2 · Step 5"), ditulis langsung ke DOM supaya tidak memicu render ulang tiap ketukan.
  const posBarRef = useRef<HTMLInputElement | null>(null);
  // Baris "Instrumen live + Bank akor": dipakai mendeteksi apakah Bank akor sudah turun ke baris bawah.
  const chordRowRef = useRef<HTMLDivElement | null>(null);
  const liveInstRef = useRef<HTMLDivElement | null>(null);
  const bankGroupRef = useRef<HTMLDivElement | null>(null);
  const [bankWrapped, setBankWrapped] = useState(false);
  const posStepRef = useRef<HTMLInputElement | null>(null);

  // Tandai kolom ketukan yang sedang berbunyi langsung di DOM (tanpa render ulang React).
  const paintPlayhead = (step: number) => {
    playheadStepRef.current = step;
    // Isian posisi tidak ditimpa saat sedang diketik / difokus.
    const S = Math.max(1, layoutRef.current.stepsPerBar);
    const barEl = posBarRef.current;
    const stepEl = posStepRef.current;
    if (barEl && document.activeElement !== barEl) barEl.value = String(Math.floor(step / S) + 1);
    if (stepEl && document.activeElement !== stepEl) stepEl.value = String((step % S) + 1);
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

  // Bank SF2 dipakai Chord Pad (drum memakai sample WAV). Chord Pad kini gratis (Grand Piano, 1 slot, Bar 1),
  // jadi bank dimuat untuk semua pengguna.
  // Status pemuatan dipantau lewat subscribeBank, jadi tetap tampil walau pemuatan sudah dimulai komponen lain
  // (sebelumnya pemanggil kedua tidak pernah menerima pesan progres, dan kegagalan tidak terlihat).
  useEffect(() => {
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
  }, []);

  // Pengaman: bila hak akses editor penuh tidak ada (mis. berakhir saat sesi berjalan), kembalikan ke batas gratis:
  // kit drum non-gratis -> 80s Kit; hanya slot akor pertama aktif; instrumen akor -> Grand Piano.
  useEffect(() => {
    if (isUnlocked8Bar) return;
    setSelectedDrumKit((k) => (FREE_DRUM_KITS.includes(k) ? k : FREE_DRUM_KITS[0]));
    setChordTracks((prev) => {
      let changed = false;
      const next = prev.map((t, i) => {
        const overSlot = i >= FREE_CHORD_SLOTS && t.enabled;
        const badProgram = t.enabled && !FREE_CHORD_PROGRAMS.includes(t.program);
        if (!overSlot && !badProgram) return t;
        changed = true;
        return {
          ...t,
          enabled: overSlot ? false : t.enabled,
          program: badProgram ? FREE_CHORD_PROGRAMS[0] : t.program,
        };
      });
      return changed ? next : prev;
    });
    setLiveSel((v) => (v === 'all' || (typeof v === 'number' && v >= FREE_CHORD_SLOTS) ? 0 : v));
  }, [isUnlocked8Bar]);

  // Kebijakan & pengaturan pad dari SERVER (konsisten di semua perangkat). Kit drum + konfigurasi 4 slot akor disimpan
  // per akun; server memaksa batas gratis saat membaca & menolak (403) saat menulis bila melanggar.
  const padSyncRef = useRef<{ loaded: boolean; lastKey: string }>({ loaded: false, lastKey: '' });
  const padKeyOf = (kit: string, cfg: { enabled: boolean; program: number }[]) =>
    `${kit}#${cfg.map((c) => `${c.enabled ? 1 : 0}:${c.program}`).join('|')}`;
  const applyServerSettings = useCallback((raw: PadSettings, paid: boolean) => {
    const st = enforcePadSettings(raw, paid);
    padSyncRef.current.lastKey = padKeyOf(st.drumKit, st.chord);
    padSyncRef.current.loaded = true;
    setSelectedDrumKit(st.drumKit);
    setChordTracks((prev) =>
      prev.map((t, i) => (st.chord[i] ? { ...t, enabled: st.chord[i].enabled, program: st.chord[i].program } : t))
    );
    setLiveSel((v) => (v === 'all' || (typeof v === 'number' && !st.chord[v]?.enabled) ? 0 : v));
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const policy = await fetchPadPolicy();
      if (cancelled) return;
      setServerPaid(policy ? policy.paid : null);
      const paid = entitled && policy?.paid !== false;
      const settings = await loadPadSettings();
      if (cancelled || !settings) return;
      applyServerSettings(settings, paid);
    })();
    return () => {
      cancelled = true;
    };
  }, [entitled, applyServerSettings]);

  const padCfgKey = padKeyOf(
    selectedDrumKit,
    chordTracks.map((t) => ({ enabled: t.enabled, program: t.program }))
  );
  useEffect(() => {
    const sync = padSyncRef.current;
    if (!sync.loaded || sync.lastKey === padCfgKey) return;
    const timer = window.setTimeout(async () => {
      const result = await savePadSettings({
        v: 1,
        drumKit: selectedDrumKit,
        chord: chordTracks.map((t) => ({ enabled: t.enabled, program: t.program })),
      });
      if (result === 'ok') {
        sync.lastKey = padCfgKey;
      } else if (result === 'denied') {
        // Server menolak (hak akses tidak ada): ambil keadaan resmi dari server.
        const policy = await fetchPadPolicy();
        setServerPaid(policy ? policy.paid : null);
        const settings = await loadPadSettings();
        if (settings) applyServerSettings(settings, entitled && policy?.paid !== false);
      }
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padCfgKey]);

  // Izin SERVER untuk aksi berbayar (Ekspor / Simpan / Muat). Gagal verifikasi = ditolak (fail-closed).
  const requireServerAccess = async (action: PadAction): Promise<boolean> => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return false;
    }
    const r = await authorizePadAction(action);
    if (r === 'ok') return true;
    if (r === 'denied') {
      setServerPaid(false);
      onUnlockEditor();
      return false;
    }
    onSuccessToast('Tidak dapat memverifikasi akses ke server. Periksa koneksi lalu coba lagi.');
    return false;
  };

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

  // Ganti nama progresi akor (maksimal 40 karakter; nama kosong diabaikan). Nama ikut tersimpan di proyek.
  const renameTrack = useCallback((trackIndex: number, name: string) => {
    const v = name.trim().slice(0, 40);
    if (!v) return;
    setChordTracks((prev) => {
      if (!prev[trackIndex] || prev[trackIndex].label === v) return prev;
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], label: v };
      return copy;
    });
  }, []);

  // Hapus baris instrumen (dikosongkan & dinonaktifkan). Minimal satu progresi harus tersisa; slot pertama selalu terisi,
  // jadi bila yang dihapus adalah baris teratas, progresi aktif berikutnya naik menggantikannya.
  const removeTrack = useCallback((trackIndex: number) => {
    const cur = liveRef.current?.chordTracks;
    if (!cur || !cur[trackIndex]?.enabled) return;
    if (cur.filter((t) => t.enabled).length <= 1) return;
    const hasNotes = cur[trackIndex].steps.some((v) => v >= 0);
    if (trackIndex === 0 && hasNotes && !window.confirm(`Hapus "${cur[trackIndex].label}" beserta isinya? Riwayat Undo akor akan direset.`)) {
      return;
    }
    try {
      audioEngine.stopAllChords(0.04);
    } catch {
      // Abaikan jika context belum aktif
    }
    const next = cur.map((t, i) =>
      i === trackIndex
        ? {
            ...t,
            enabled: false,
            muted: false,
            solo: false,
            label: defaultTrackLabel(t.id),
            ...emptyTrackData(layoutRef.current.totalSteps),
          }
        : t
    );
    if (trackIndex === 0) {
      const j = next.findIndex((t, i) => i > 0 && t.enabled);
      if (j > 0) {
        [next[0], next[j]] = [next[j], next[0]];
        chordHistoryResetRef.current = true;
      }
    }
    setSel(null);
    setChordTracks(next);
  }, []);

  // Tukar urutan: naik / turun satu langkah dengan progresi aktif terdekat. Isi, instrumen, volume, dan nama ikut berpindah.
  const moveTrack = useCallback((trackIndex: number, dir: -1 | 1) => {
    if (isRecordingRef.current) return;
    const cur = liveRef.current?.chordTracks;
    if (!cur || !cur[trackIndex]?.enabled) return;
    let j = trackIndex + dir;
    while (j >= 0 && j < cur.length && !cur[j].enabled) j += dir;
    if (j < 0 || j >= cur.length) return;
    const next = [...cur];
    [next[trackIndex], next[j]] = [next[j], next[trackIndex]];
    chordHistoryResetRef.current = true;
    setSel(null);
    setLiveSel((prev) => (prev === trackIndex ? j : prev === j ? trackIndex : prev));
    setChordTracks(next);
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
      onSuccessToast(`Pengguna gratis hanya bisa memakai ${FREE_CHORD_SLOTS} dari 4 slot instrumen akor. Buka editor penuh untuk menambah.`);
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

  // Bulatkan waktu jam audio sebuah input ke step terdekat dari ketukan yang sedang berjalan (kompensasi latensi keluaran
  // audio). Dipakai bersama oleh perekaman drum dan akor supaya keduanya selalu sejajar. -1 = tidak ada ketukan yang cocok.
  const quantizeToStep = (audioTime: number): number => {
    const L = liveRef.current;
    const q = recentStepsRef.current;
    if (!L || !L.isPlaying || q.length === 0) return -1;
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
    return best >= 0 && bestDist <= stepSec ? best : -1;
  };

  // Rekam satu pukulan live drum: masuk ke step terdekat.
  const recordDrumHit = (drumId: string, level: number, audioTime: number) => {
    const best = quantizeToStep(audioTime);
    if (best < 0) return;
    setDrumGrid((prev) => {
      const row = [...(prev[drumId] || Array(layoutRef.current.totalSteps).fill(0))];
      row[best] = level;
      return { ...prev, [drumId]: row };
    });
  };

  // Rekam akor live: saat pad ditekan, not akor dipasang di step terdekat (panjang awal 1 step) pada track tujuan
  // (instrumen live yang dipilih); saat pad dilepas, panjang not disesuaikan dengan lama pad ditahan.
  const recordChordStart = (padIdx: number, targets: number[], eventTimeStamp?: number, level: number = DEFAULT_LIVE_LEVEL) => {
    const t0 = audioTimeOfEvent(eventTimeStamp);
    const step = quantizeToStep(t0);
    if (step < 0) return;
    finishChordRecordRef.current(padIdx, t0);
    const valid = targets.filter((ti) => liveRef.current?.chordTracks[ti]?.enabled);
    if (valid.length === 0) return;
    chordRecRef.current.set(padIdx, { step, t0, targets: valid });
    setChordTracks((prev) =>
      prev.map((t, ti) => (valid.includes(ti) && t.enabled ? { ...t, ...insertNote(t.steps, t.lens, step, padIdx, 1, t.vels, level) } : t))
    );
  };

  const finishChordRecord = (padIdx: number, tEnd: number) => {
    const rec = chordRecRef.current.get(padIdx);
    if (!rec) return;
    chordRecRef.current.delete(padIdx);
    const L = liveRef.current;
    const stepSec = 60 / (L?.bpm ?? 115) / 4;
    // Ketukan singkat tetap dihitung selama akor memang terdengar (CHORD_TAP_MIN_MS), sama seperti yang didengar pemain.
    const heldSec = Math.max(tEnd - rec.t0, CHORD_TAP_MIN_MS / 1000);
    let len = Math.max(1, Math.round(heldSec / stepSec));
    if (L) {
      const S = L.stepsPerBar;
      const loopEnd = (L.loopEndBar - 1) * S + (L.loopEndBeat - 1);
      if (loopEnd >= rec.step) len = Math.min(len, loopEnd - rec.step + 1);
    }
    setChordTracks((prev) =>
      prev.map((t, ti) =>
        rec.targets.includes(ti) && t.steps[rec.step] === padIdx ? { ...t, ...resizeNote(t.steps, t.lens, rec.step, len) } : t
      )
    );
  };
  const finishChordRecordRef = useRef(finishChordRecord);
  finishChordRecordRef.current = finishChordRecord;

  const triggerDrum = (type: DrumInstrument['id'], level = DEFAULT_LIVE_LEVEL, eventTimeStamp?: number) => {
    const lv = dynamicsOn ? snapLevel(Math.max(1, Math.min(DRUM_LEVEL_MAX, level)), drumDynMode) : DRUM_FLAT_LEVEL;
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
  const toggleChordDynamics = () => {
    setChordDynamicsOn((v) => !v);
    setChordHover(null);
  };
  // Level dinamika pad akor dari posisi tekan: tengah = paling keras, tepi = paling pelan (sama dengan pad drum).
  const chordLevelAtPointer = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return levelFromOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2, r.height / 2, chordDynMode);
  };
  const levelAtPointer = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return levelFromOffset(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2, r.height / 2, drumDynMode);
  };


  // ---------------------------------------------------------------------------
  // MODE EDIT / PILIH, DINAMIKA DRUM, PANJANG AKOR BARU
  // ---------------------------------------------------------------------------
  const [editMode, setEditMode] = useState<EditMode>('edit');
  const modeRef = useRef<EditMode>('edit');
  modeRef.current = editMode;
  const getMode = useCallback(() => modeRef.current, []);
  // Saklar "Tambah" (untuk layar sentuh tanpa Shift): saat aktif di mode Pilih, memilih MENAMBAH ke pilihan lama.
  const [freeSel, setFreeSel] = useState(false);
  const freeSelRef = useRef(false);
  freeSelRef.current = freeSel;
  const [addMode, setAddMode] = useState(false);
  const addModeRef = useRef(false);
  addModeRef.current = addMode;

  // Popover pemilih dinamika drum (pp / p / f / ff), muncul lewat klik kanan / tahan lama pada pad.
  const [drumPicker, setDrumPicker] = useState<{ drumId: string; stepIdx: number; x: number; y: number } | null>(null);
  const closeDrumPicker = useCallback(() => setDrumPicker(null), []);

  // Popover pemilih dinamika akor (klik kanan / tahan lama pada blok akor).
  const [chordPicker, setChordPicker] = useState<{ trackIdx: number; start: number; x: number; y: number } | null>(null);
  const closeChordPicker = useCallback(() => setChordPicker(null), []);

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
        (L.drumVolume / 100) * ((m?.volume ?? 100) / 100) * DRUM_LEVEL_GAIN[effLevel(next, L.dynamicsOn, L.drumDynMode)],
        m?.adsr
      );
    }
  }, []);

  // Klik pad drum = naik bertahap lewat tingkat dinamika yang dipilih (6 / 4 / 2), lalu kosong. Tiap klik dibunyikan sebagai pratinjau.
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
      setDrumLevel(drumId, stepIndex, nextLevelInPalette(cur, liveRef.current?.drumDynMode ?? 6));
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
      let data: { steps: number[]; lens: number[]; vels?: number[] };
      if (padIdx < 0) {
        data = removeNote(t.steps, t.lens, stepIndex, t.vels);
      } else if (t.steps[stepIndex] >= 0) {
        const steps = [...t.steps];
        steps[stepIndex] = padIdx;
        data = { steps, lens: t.lens, vels: t.vels };
      } else {
        data = insertNote(t.steps, t.lens, stepIndex, padIdx, newChordLenRef.current, t.vels, 0);
      }
      copy[trackIndex] = { ...t, ...data };
      return copy;
    });
  }, []);

  // Pasang dinamika pada satu not akor (0 = normal / belum diatur). Ikut tercatat di Undo, Salin/Tempel, Simpan, dan ekspor.
  const setChordNoteLevel = useCallback((trackIndex: number, start: number, level: number) => {
    const next = clampLevel(level);
    setChordTracks((prev) => {
      const t = prev[trackIndex];
      if (!t || t.steps[start] < 0) return prev;
      if (clampLevel(t.vels?.[start]) === next) return prev;
      const vels = t.vels ? [...t.vels] : Array<number>(t.steps.length).fill(0);
      vels[start] = next;
      const copy = [...prev];
      copy[trackIndex] = { ...t, vels };
      return copy;
    });
  }, []);

  // Klik lencana dinamika pada blok akor = naik bertahap lewat tingkat yang dipilih (6 / 4 / 2), lalu kembali normal.
  const cycleChordLevel = useCallback(
    (trackIndex: number, start: number) => {
      const L = liveRef.current;
      if (!L || !L.chordDynamicsOn) return;
      const spb = layoutRef.current.stepsPerBar;
      if (!gateRef.current.isUnlocked8Bar && Math.floor(start / spb) > 0) {
        gateRef.current.onUnlockEditor();
        return;
      }
      const cur = clampLevel(L.chordTracks[trackIndex]?.vels?.[start]);
      setChordNoteLevel(trackIndex, start, nextLevelInPalette(cur, L.chordDynMode));
    },
    [setChordNoteLevel]
  );

  const openChordPicker = useCallback((trackIndex: number, start: number, el: HTMLElement) => {
    if (modeRef.current !== 'edit' || !liveRef.current?.chordDynamicsOn) return;
    const spb = layoutRef.current.stepsPerBar;
    if (!gateRef.current.isUnlocked8Bar && Math.floor(start / spb) > 0) {
      gateRef.current.onUnlockEditor();
      return;
    }
    const r = el.getBoundingClientRect();
    setChordPicker({ trackIdx: trackIndex, start, x: r.left + r.width / 2, y: r.bottom });
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
  // Pilihan = himpunan sel (boleh terpisah-pisah). Cara memilih:
  //  - Mode Pilih: ketuk / seret area; pilihan lama DIGANTI. Ketuk pad yang sudah terpilih = lepas pad itu.
  //  - Tahan Shift (di mode apa pun): ketuk pad untuk menambah (ketuk lagi = lepas) tanpa melepas pilihan lama; seret = tambah area.
  //  - Klik label baris (nama drum / progresi akor) = pilih seluruh baris; klik label BAR = pilih satu bar; tombol Semua = semuanya.
  //  - Klik area kosong di luar pad / bar / tombol = lepas semua pilihan.
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
  modalOpenRef.current = editingPadIndex !== null || pickerTrack !== null || isExportModalOpen || isExportMenuOpen || drumPicker !== null || isFxOpen;
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

  // Pilih kolom step (semua baris) lewat ruler beat/step di bawah label BAR.
  //  - klik 1x pada step / angka beat = pilih step itu saja
  //  - klik 2x = pilih satu beat, klik 3x = pilih satu bar (tombol Bebas: mulai dari step yang diklik)
  //  - seret ke samping = pilih rentang step
  const lastRulerTapRef = useRef<{ idx: number; t: number; count: number; base: Set<number> } | null>(null);
  const rulerStepAt = (x: number): number | null => {
    const el = document.querySelector<HTMLElement>('[data-ruler]');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const v = viewRef.current;
    const count = v.count * v.stepsPerBar;
    const frac = (x - rect.left) / Math.max(1, rect.width);
    return v.start * v.stepsPerBar + Math.max(0, Math.min(count - 1, Math.floor(frac * count)));
  };
  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>, startIdx: number) => {
    const tab = activeTabRef.current;
    e.preventDefault();
    const { stepsPerBar: S, totalSteps: total } = layoutRef.current;
    const lastRow = rowCountOf(tab) - 1;
    const colCells = (a: number, b: number) =>
      buildCells(tab, { r: 0, s: Math.max(0, a) }, { r: lastRow, s: Math.min(total - 1, b) });
    const now = Date.now();
    const prev = lastRulerTapRef.current;
    const chained = prev !== null && prev.idx === startIdx && now - prev.t < 450 && prev.count < 3;
    const count = chained ? (prev as { count: number }).count + 1 : 1;
    const additive = wantsAdd(e.shiftKey);
    const base: Set<number> = chained
      ? (prev as { base: Set<number> }).base
      : new Set<number>(additive && selRef.current ? selRef.current.cells : []);
    lastRulerTapRef.current = { idx: startIdx, t: now, count, base };
    anchorRef.current = { r: 0, s: startIdx };

    // 1x = step, 2x = beat, 3x = bar. Sama untuk tab Drum dan Akor.
    // Mode Bebas: beat / bar dimulai dari step yang diklik; mode normal: sejajar garis beat / bar.
    if (count >= 2) {
      const pos = startIdx % S;
      let bs = pos;
      while (bs > 0 && !beatInfo.isBeatStart[bs]) bs--;
      let be = bs + 1;
      while (be < S && !beatInfo.isBeatStart[be]) be++;
      const beatLen = Math.max(1, be - bs);
      const barStart = startIdx - pos;
      let from: number;
      let to: number;
      if (count === 2) {
        from = freeSelRef.current ? startIdx : barStart + bs;
        to = from + beatLen - 1;
      } else {
        from = freeSelRef.current ? startIdx : barStart;
        to = from + S - 1;
      }
      setSel(makeSel(tab, [...base, ...colCells(from, to)]));
      return;
    }

    const apply = (a: number, b: number) =>
      setSel(makeSel(tab, [...base, ...colCells(Math.min(a, b), Math.max(a, b))]));
    apply(startIdx, startIdx);
    const move = (ev: PointerEvent) => {
      const idx = rulerStepAt(ev.clientX);
      if (idx !== null) apply(startIdx, idx);
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

  const handleGridPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const mode = modeRef.current;
    if (mode === 'edit' && !e.shiftKey) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const rulerBtn = (e.target as HTMLElement).closest<HTMLElement>('[data-ruler] [data-step]');
    if (rulerBtn) {
      handleRulerPointerDown(e, Number(rulerBtn.dataset.step));
      return;
    }
    const cell = pointToCell(e.clientX, e.clientY);
    if (!cell) return;
    const tab = activeTabRef.current;
    e.preventDefault();

    const base = new Set<number>(selRef.current ? selRef.current.cells : []);
    const start = cell;
    const here = buildCells(tab, cell, cell);
    const already = here.every((k) => base.has(k));
    anchorRef.current = cell;
    const isStart = (c: { r: number; s: number }) => c.r === start.r && c.s === start.s;
    const additive = wantsAdd(e.shiftKey);

    let onMove: (c: { r: number; s: number }) => void;
    let onUp: (() => void) | null = null;
    if (additive) {
      // Shift (atau saklar Tambah) = tambah / lepas satu pad tanpa menyentuh pilihan lain; seret = tambahkan seluruh area.
      const rest = [...base].filter((k) => !here.includes(k));
      setSel(rest.length || !already ? makeSel(tab, already ? rest : [...base, ...here]) : null);
      onMove = (c) => {
        if (isStart(c)) return;
        setSel(makeSel(tab, [...base, ...buildCells(tab, start, c)]));
      };
    } else if (already) {
      // Pad yang sudah terpilih: ketuk = lepas pad itu; SERET = pindahkan seluruh pilihan ke tempat baru (lepas untuk menjatuhkan).
      const orig = selRef.current as Selection;
      const bb = selectionBounds(orig.cells) as { r1: number; r2: number; s1: number; s2: number };
      const rowsN = rowCountOf(tab);
      const total = layoutRef.current.totalSteps;
      const tracks = liveRef.current?.chordTracks ?? [];
      let maxEnd = bb.s2;
      if (tab === 'chord') {
        orig.cells.forEach((k) => {
          const t = tracks[cellRow(k)];
          const end = cellStep(k) + Math.max(1, t?.lens[cellStep(k)] || 1) - 1;
          if (end > maxEnd) maxEnd = end;
        });
      }
      let off = { dr: 0, ds: 0 };
      let moved = false;
      onMove = (c) => {
        let dr = Math.max(-bb.r1, Math.min(rowsN - 1 - bb.r2, c.r - start.r));
        const ds = Math.max(-bb.s1, Math.min(total - 1 - maxEnd, c.s - start.s));
        if (tab === 'chord') {
          // Baris tujuan harus instrumen akor yang aktif.
          let ok = true;
          orig.cells.forEach((k) => {
            if (!tracks[cellRow(k) + dr]?.enabled) ok = false;
          });
          if (!ok) dr = off.dr;
        }
        if (!moved && dr === 0 && ds === 0) return;
        moved = true;
        off = { dr, ds };
        document.body.style.cursor = 'grabbing';
        setSel(makeSel(tab, [...orig.cells].map((k) => cellKey(cellRow(k) + dr, cellStep(k) + ds))));
      };
      onUp = () => {
        document.body.style.cursor = '';
        if (!moved) {
          const rest = [...base].filter((k) => !here.includes(k));
          setSel(rest.length ? makeSel(tab, rest) : null);
          return;
        }
        if (off.dr === 0 && off.ds === 0) {
          setSel(orig);
          return;
        }
        moveSelectionBy(orig, off.dr, off.ds);
      };
    } else {
      // Area baru menggantikan pilihan lama.
      setSel(makeSel(tab, here));
      onMove = (c) => {
        setSel(makeSel(tab, buildCells(tab, start, c)));
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
      if (onUp) onUp();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Terapkan satu kelompok sel (bar / baris) ke pilihan.
  //  - extend (Shift): kelompok ditambahkan; bila sudah terpilih seluruhnya, kelompok itu dilepas.
  //  - tanpa extend : kelompok MENGGANTI pilihan; bila pilihan sudah persis kelompok itu, pilihan dilepas.
  const wantsAdd = (shift: boolean) => shift || (modeRef.current === 'select' && addModeRef.current);
  const applyGroup = (tab: PadTab, cells: number[], extendIn: boolean) => {
    const extend = wantsAdd(extendIn);
    const prev = selRef.current;
    const base: ReadonlySet<number> = prev ? prev.cells : new Set<number>();
    const group = new Set<number>(cells);
    if (group.size === 0) return;
    const full = [...group].every((k) => base.has(k));
    let next: Set<number>;
    if (extend) next = full ? new Set([...base].filter((k) => !group.has(k))) : new Set([...base, ...group]);
    else next = full && base.size === group.size ? new Set<number>() : new Set(group);
    const first = [...group][0];
    anchorRef.current = { r: cellRow(first), s: cellStep(first) };
    setSel(next.size > 0 ? makeSel(tab, next) : null);
  };

  // Klik label BAR = pilih seluruh bar itu (Shift+klik = tambahkan ke pilihan).
  const selectBar = (barIdx: number, extend: boolean) => {
    const tab = activeTabRef.current;
    const S = layoutRef.current.stepsPerBar;
    const s1 = barIdx * S;
    applyGroup(tab, buildCells(tab, { r: 0, s: s1 }, { r: rowCountOf(tab) - 1, s: s1 + S - 1 }), extend);
  };

  // Klik label baris = pilih satu bagian drum / satu instrumen akor di seluruh bar.
  const selectRow = (row: number, extend: boolean) => {
    const tab = activeTabRef.current;
    applyGroup(tab, buildCells(tab, { r: row, s: 0 }, { r: row, s: layoutRef.current.totalSteps - 1 }), extend);
  };
  const selectRowRef = useRef(selectRow);
  selectRowRef.current = selectRow;
  const onSelectRow = useCallback((row: number, additive: boolean) => selectRowRef.current(row, additive), []);
  const duplicateTracksRef = useRef<(rows: number[]) => boolean>(() => false);
  const onDuplicateTrack = useCallback((row: number) => void duplicateTracksRef.current([row]), []);

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
          return mask[r][i] && t && t.steps[st] >= 0 ? { pad: t.steps[st], len: t.lens[st] || 1, vel: t.vels?.[st] || 0 } : null;
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

  const deleteSelection = () => deleteSelectionOf(selRef.current);
  const deleteSelectionOf = (cur: Selection | null) => {
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
          const vl = t.vels ? [...t.vels] : Array<number>(t.steps.length).fill(0);
          steps.forEach((s0) => {
            st[s0] = -1;
            ln[s0] = 0;
            vl[s0] = 0;
          });
          return { ...t, steps: st, lens: ln, vels: vl };
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
    if (r0 < 0 || s0 < 0) return null;
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
          let vels = t.vels ? [...t.vels] : Array<number>(t.steps.length).fill(0);
          // Not yang menutupi titik tempel dipotong; sel tujuan dikosongkan (mode "timpa").
          const cs = noteStartCovering(steps, lens, s0);
          if (cs >= 0 && cs < s0 && inMask(r, 0)) lens[cs] = s0 - cs;
          for (let i = 0; i < clip.width && s0 + i <= lastStep; i++) {
            if (!inMask(r, i)) continue;
            steps[s0 + i] = -1;
            lens[s0 + i] = 0;
            vels[s0 + i] = 0;
          }
          for (let i = 0; i < clip.width && s0 + i <= lastStep; i++) {
            if (!inMask(r, i)) continue;
            const cell = clip.data[r][i];
            if (cell) ({ steps, lens, vels } = insertNote(steps, lens, s0 + i, cell.pad, cell.len, vels, cell.vel || 0));
          }
          return { ...t, steps, lens, vels };
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

  // Pindahkan pilihan `orig` sejauh (dr baris, ds step): potong dari tempat asal lalu tempel di tujuan (satu langkah Undo).
  const moveSelectionBy = (orig: Selection, dr: number, ds: number) => {
    const clip = buildClip(orig);
    const bb = selectionBounds(orig.cells);
    if (!clip || !bb) {
      setSel(orig);
      return;
    }
    const { totalSteps: total, stepsPerBar: spb } = layoutRef.current;
    const lastStep = Math.min(total - 1, bb.s1 + ds + clip.width - 1);
    if (!gateRef.current.isUnlocked8Bar && Math.floor(lastStep / spb) > 0) {
      gateRef.current.onUnlockEditor();
      setSel(orig);
      return;
    }
    deleteSelectionOf(orig);
    const res = pasteClip(clip, bb.r1 + dr, bb.s1 + ds);
    if (res) adoptPasted(clip.kind, res);
    else setSel(orig);
  };

  const pasteSelection = () => {
    const clip = clipsRef.current[activeTabRef.current];
    if (!clip) return;
    const cur = selRef.current;
    const b = cur ? selectionBounds(cur.cells) : null;
    // Klip satu instrumen utuh (selebar seluruh grid) selalu ditempel dari step 1, ke baris instrumen yang sedang dipilih.
    const wholeRow = clip.width >= layoutRef.current.totalSteps;
    const res = pasteClip(clip, b ? b.r1 : 0, wholeRow ? 0 : b ? b.s1 : playheadStepRef.current);
    if (res) adoptPasted(clip.kind, res);
  };

  // Duplikat instrumen akor: seluruh isi (not), instrumen suara, volume, dan ADSR ikut disalin ke slot kosong berikutnya.
  const duplicateTracks = (srcRows: number[]): boolean => {
    if (!gateRef.current.isUnlocked8Bar) {
      gateRef.current.onUnlockEditor();
      return false;
    }
    const tracks = liveRef.current?.chordTracks ?? [];
    const free = tracks.map((t, i) => (t.enabled ? -1 : i)).filter((i) => i >= 0);
    const rows = srcRows.filter((r) => tracks[r]?.enabled);
    if (rows.length === 0) return false;
    if (free.length < rows.length) {
      onSuccessToast(
        free.length === 0
          ? 'Sudah 4 instrumen akor, tidak ada slot kosong untuk duplikat.'
          : `Slot kosong hanya ${free.length}, tidak cukup untuk menduplikat ${rows.length} instrumen.`
      );
      return false;
    }
    // Hanya slot kosong sebanyak instrumen sumber yang dipakai (sebelumnya semua slot kosong ikut diproses
    // dan memicu error "Cannot read properties of undefined (reading 'program')").
    const targets = free.slice(0, rows.length);
    setChordTracks((prev) =>
      prev.map((t, i) => {
        const k = targets.indexOf(i);
        if (k < 0) return t;
        const src = prev[rows[k]];
        if (!src) return t;
        return {
          ...t,
          label: defaultTrackLabel(t.id),
          enabled: true,
          muted: false,
          solo: false,
          program: src.program,
          volume: src.volume,
          adsr: { ...src.adsr },
          steps: [...src.steps],
          lens: [...src.lens],
          vels: src.vels ? [...src.vels] : undefined,
        };
      })
    );
    onSuccessToast(
      rows.length === 1
        ? `${tracks[rows[0]].label} diduplikat ke ${defaultTrackLabel(tracks[targets[0]].id)} (isi, instrumen, volume, dan ADSR ikut).`
        : `${rows.length} instrumen akor diduplikat (isi, instrumen, volume, dan ADSR ikut).`
    );
    return true;
  };

  duplicateTracksRef.current = duplicateTracks;

  // Duplikat: salin pilihan lalu tempel TEPAT setelahnya; pilihan pindah ke hasil, jadi bisa diulang beruntun.
  // Bila yang dipilih adalah instrumen akor UTUH (seluruh barisnya), yang diduplikat adalah instrumennya ke slot kosong.
  const duplicateSelection = () => {
    const cur = selRef.current;
    if (!cur) return;
    if (cur.tab === 'chord') {
      const rows = Array.from(groupCellsByRow(cur.cells).keys()).sort((a, b) => a - b);
      if (rows.length > 0 && rows.every((r) => rowFullSel[r])) {
        duplicateTracks(rows);
        return;
      }
    }
    const clip = buildClip(cur);
    const b = selectionBounds(cur.cells);
    if (!clip || !b) return;
    const res = pasteClip(clip, b.r1, b.s2 + 1);
    if (res) adoptPasted(clip.kind, res);
  };

  // Pilih semua bagian drum / semua instrumen akor (yang aktif). Dari tombol "Semua": bila sudah semua terpilih, dilepas.
  const selectAll = (toggle?: boolean) => {
    const tab = activeTabRef.current;
    const last = layoutRef.current.totalSteps - 1;
    const cells: number[] = [];
    for (let r = 0; r < rowCountOf(tab); r++) {
      if (tab === 'chord' && !liveRef.current?.chordTracks[r]?.enabled) continue;
      cells.push(...buildCells(tab, { r, s: 0 }, { r, s: last }));
    }
    if (cells.length === 0) return;
    const cur = selRef.current;
    const group = new Set<number>(cells);
    if (toggle === true && cur && cur.cells.size === group.size && cells.every((k) => cur.cells.has(k))) {
      setSel(null);
      return;
    }
    anchorRef.current = { r: 0, s: 0 };
    setSel(makeSel(tab, group));
  };

  const clearSelection = () => setSel(null);

  // Klik di area kosong (bukan pad, bar, baris, tombol, atau kolom isian) = lepas semua pilihan.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!selRef.current || modalOpenRef.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      if (!t || !t.closest) return;
      // Abaikan klik pada scrollbar.
      if (e.offsetX > t.clientWidth || e.offsetY > t.clientHeight) return;
      if (t.closest('button, input, select, textarea, a, label, [role="dialog"], [role="tab"], [data-rowgrid], [data-keepsel]')) return;
      setSel(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  // Step terpilih per baris (untuk menandai sel di grid). Identitas Set stabil selama pilihan tidak berubah.
  const rowSelSets = useMemo<Array<ReadonlySet<number> | undefined>>(() => {
    const rows: Array<ReadonlySet<number> | undefined> = [];
    if (!activeSel) return rows;
    groupCellsByRow(activeSel.cells).forEach((steps, r) => {
      rows[r] = new Set(steps);
    });
    return rows;
  }, [activeSel]);

  // Step yang punya sel terpilih (untuk menandai ruler beat/step).
  const rulerSelSteps = useMemo<ReadonlySet<number>>(() => {
    const out = new Set<number>();
    if (!activeSel) return out;
    const tracks = chordTracks;
    activeSel.cells.forEach((k) => {
      const st = cellStep(k);
      out.add(st);
      if (activeSel.tab === 'chord') {
        const t = tracks[cellRow(k)];
        const len = Math.max(1, t?.lens[st] || 1);
        for (let i = 1; i < len; i++) out.add(st + i);
      }
    });
    return out;
  }, [activeSel, chordTracks]);

  // Baris (instrumen) yang terpilih SELURUHNYA: dipakai untuk menandai label dan untuk Duplikat instrumen.
  const rowFullSel = useMemo<boolean[]>(() => {
    const out: boolean[] = [];
    if (!activeSel) return out;
    groupCellsByRow(activeSel.cells).forEach((steps, r) => {
      if (activeSel.tab === 'drum') {
        out[r] = steps.length >= totalSteps;
        return;
      }
      const t = chordTracks[r];
      if (!t || !t.enabled) return;
      // Jumlah kunci sel unik satu baris penuh = jumlah not + step kosong yang tidak tertutup not.
      let expected = 0;
      let st = 0;
      while (st < totalSteps) {
        expected++;
        st += t.steps[st] >= 0 ? Math.max(1, t.lens[st] || 1) : 1;
      }
      out[r] = steps.length === expected;
    });
    return out;
  }, [activeSel, chordTracks, totalSteps]);

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

  // Ada not akor terpilih yang cukup panjang (>= 2 step) untuk dibelah?
  const canSplit = useMemo(() => {
    if (!activeSel || activeSel.tab !== 'chord') return false;
    let ok = false;
    groupCellsByRow(activeSel.cells).forEach((steps, r) => {
      const t = chordTracks[r];
      if (!t || !t.enabled) return;
      if (steps.some((st) => t.steps[st] >= 0 && (t.lens[st] || 1) >= 2)) ok = true;
    });
    return ok;
  }, [activeSel, chordTracks]);

  // Belah: tiap not akor terpilih yang panjangnya >= 2 step dibelah di tengah menjadi dua not berurutan dengan akor
  // dan dinamika yang sama (panjang ganjil: bagian pertama lebih panjang 1 step). Kedua bagian tetap terpilih,
  // jadi tombol bisa ditekan lagi untuk membelah lebih kecil. Satu langkah Undo.
  const splitNotesOfTrack = (t: ChordTrackState, starts: number[]) => {
    const steps = [...t.steps];
    const lens = [...t.lens];
    const vels = t.vels ? [...t.vels] : Array<number>(t.steps.length).fill(0);
    const created: number[] = [];
    starts.forEach((st) => {
      const len = lens[st] || 1;
      if (steps[st] < 0 || len < 2) return;
      const first = Math.ceil(len / 2);
      const at = st + first;
      if (at >= steps.length || steps[at] >= 0) return;
      steps[at] = steps[st];
      lens[at] = len - first;
      vels[at] = vels[st] || 0;
      lens[st] = first;
      created.push(at);
    });
    return { track: created.length > 0 ? { ...t, steps, lens, vels } : t, created };
  };

  const splitSelection = () => {
    const cur = selRef.current;
    if (!cur || cur.tab !== 'chord') return;
    const byRow = groupCellsByRow(cur.cells);
    const added: number[] = [];
    chordTracks.forEach((t, ti) => {
      const starts = byRow.get(ti);
      if (!starts || !t.enabled) return;
      splitNotesOfTrack(t, starts).created.forEach((at) => added.push(cellKey(ti, at)));
    });
    if (added.length === 0) return;
    setChordTracks((prev) =>
      prev.map((t, ti) => {
        const starts = byRow.get(ti);
        if (!starts || !t.enabled) return t;
        return splitNotesOfTrack(t, starts).track;
      })
    );
    setSel(makeSel('chord', [...cur.cells, ...added]));
  };

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
    if (chordHistoryResetRef.current) {
      // Urutan / susunan track berubah: riwayat akor lama (berdasarkan nomor baris) tidak cocok lagi.
      chordHistoryResetRef.current = false;
      H.chord = { past: [], future: [] };
      lastChordRef.current = chordNow;
    }
    if (!chordSnapEqual(chordNow, lastChordRef.current)) {
      const coalesce = performance.now() < coalesceUntilRef.current;
      // Selama merekam, seluruh akor satu rekaman juga dihitung SATU langkah undo.
      const chordInTake = isRecordingRef.current;
      if (!(coalesce && coalescingRef.current) && !(chordInTake && recChordTakeOpenRef.current)) {
        H.chord.past.push(lastChordRef.current);
        if (H.chord.past.length > HISTORY_LIMIT) H.chord.past.shift();
      }
      if (chordInTake) recChordTakeOpenRef.current = true;
      coalescingRef.current = coalesce;
      H.chord.future = [];
      lastChordRef.current = chordNow;
    }
    syncHistFlags();
  }, [drumGrid, chordTracks, syncHistFlags]);

  const restoreChordSnap = (snap: ChordSnap) => {
    stopAllLiveChords();
    setChordTracks((prev) =>
      prev.map((t, i) => (snap[i] ? { ...t, steps: snap[i].steps, lens: snap[i].lens, vels: snap[i].vels, enabled: snap[i].enabled } : t))
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

  // Pelacak sisi Shift (kiri / kanan). Dipakai untuk membedakan dinamika drum (Shift kiri) dari dinamika akor (Shift kanan).
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft') shiftSideRef.current.left = true;
      else if (e.code === 'ShiftRight') shiftSideRef.current.right = true;
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft') shiftSideRef.current.left = false;
      else if (e.code === 'ShiftRight') shiftSideRef.current.right = false;
    };
    const reset = () => {
      shiftSideRef.current.left = false;
      shiftSideRef.current.right = false;
    };
    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', reset);
    };
  }, []);

  // Keyboard fisik -> pad drum live: Q W E R T Y U I O P (kiri ke kanan). Aktif di tab Drum Pad maupun tab Akor (tombolnya tidak bentrok dengan pad akor) selama Pad Studio terlihat
  // di layar dan fokus tidak sedang di kolom ketik. Dinamika dipilih dengan menahan tombol dinamika lalu menekan pad:
  //   6 tingkat:  ,=pp  <=p  .=mp  >=mf  /=f  ?=ff     (< > ? = tombol yang sama + Shift KIRI)
  //   4 tingkat:  ,=p   <=mp .=mf  >=f                 (/ dan ? tidak dipakai)
  //   2 tingkat:  ,=p   .=f                            (hanya tanpa Shift)
  // Tanpa tombol dinamika pad berbunyi f; Shift kiri saja = tingkat paling keras. Hanya berlaku bila dinamika menyala.
  useEffect(() => {
    const dyn: { code: string | null } = { code: null };
    const dynCodes = DYN_KEY_CODES.drum;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const isDyn = dynCodes.includes(e.code);
      const inst = DRUM_BY_CODE[e.code];
      if (!inst && !isDyn) return;
      if (modalOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const sec = sectionRef.current;
      if (!sec) return;
      const r = sec.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) return;
      e.preventDefault();
      setHasKeyboard(true);
      if (isDyn) {
        dyn.code = e.code;
        return;
      }
      if (e.repeat || !inst) return;
      const mode = drumDynModeRef.current;
      const shifted = shiftSideRef.current.left;
      let level = DEFAULT_LIVE_LEVEL;
      if (dyn.code) {
        const lv = dynLevelForKey('drum', dyn.code, shifted, mode);
        if (lv > 0) level = lv;
      } else if (shifted) {
        level = DYN_PALETTE[mode][DYN_PALETTE[mode].length - 1];
      }
      triggerDrumRef.current(inst.id, level, e.timeStamp);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === dyn.code) dyn.code = null;
    };
    const reset = () => {
      dyn.code = null;
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

  // Posisi (playhead) selalu berada di dalam rentang main: di luar rentang, dijepit ke ujung terdekat.
  // Bila awal dan akhir sama, posisinya ikut sama.
  const loopBounds = () => {
    const a = (loopStartBar - 1) * stepsPerBar + (loopStartBeat - 1);
    const b = (loopEndBar - 1) * stepsPerBar + (loopEndBeat - 1);
    const playable = isUnlocked8Bar ? totalSteps : stepsPerBar;
    const hi = Math.max(0, Math.min(playable - 1, Math.max(a, b)));
    const lo = Math.max(0, Math.min(Math.min(a, b), hi));
    return { lo, hi };
  };
  const clampToLoop = (step: number) => {
    const { lo, hi } = loopBounds();
    return Math.max(lo, Math.min(hi, step));
  };

  const handleSeekStep = (rawTarget: number) => {
    const targetStep = clampToLoop(rawTarget);
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
    const startStep = loopBounds().lo;
    stepRef.current = startStep;
    visualQueueRef.current = [];
    paintPlayhead(startStep);
  };

  // Transport tunggal. Mode Drum saja langsung jalan; bila akor ikut, sample akor dipanaskan dulu, tapi pengguna JANGAN
  // dibuat menunggu:
  // - Bank sudah siap: tunggu paling lama 350 ms (biasanya cukup), sisanya jalan di latar belakang.
  // - Bank belum siap: langsung mulai. Engine membunyikan suara sintesis sementara dan otomatis
  //   pindah ke sample SF2 begitu bank selesai dimuat.
  // Mengembalikan true bila pemutaran benar-benar dimulai.
  const preparingChordsRef = useRef(false);
  const startPlayback = async (): Promise<boolean> => {
    audioEngine.getAudioContext().resume();
    if (preparingChordsRef.current) return false;
    if (effPlayChord) {
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
    }
    setIsPlaying(true);
    return true;
  };

  const togglePlay = async () => {
    audioEngine.getAudioContext().resume();
    if (isPlaying) {
      stopAllLiveChords();
      setIsPlaying(false);
      return;
    }
    await startPlayback();
  };

  // Nyalakan / matikan bagian yang diputar (Drum, Akor, atau keduanya). Minimal satu harus tetap aktif. Boleh diganti saat
  // sedang memutar; mematikan Akor memotong akor yang menggantung.
  const togglePlayPart = (part: PlayPart) => {
    const cur = { drum: effPlayDrum, chord: effPlayChord };
    const next = { ...cur, [part]: !cur[part] };
    if (!next.drum && !next.chord) {
      onSuccessToast('Pilih minimal satu: Drum atau Akor.');
      return;
    }
    if (part === 'chord' && cur.chord && isPlaying) stopAllLiveChords();
    setPlayDrum(next.drum);
    setPlayChord(next.chord);
  };

  // Pindah posisi putar dari isian Posisi (Bar / Step), diketik atau lewat tombol atas-bawah.
  const seekToPosition = () => {
    const b = parseInt(posBarRef.current?.value ?? '', 10);
    const st = parseInt(posStepRef.current?.value ?? '', 10);
    if (!Number.isFinite(b) || !Number.isFinite(st)) return;
    const bar = Math.max(1, Math.min(TOTAL_BARS, b));
    const stepInBar = Math.max(1, Math.min(stepsPerBar, st));
    handleSeekStep((bar - 1) * stepsPerBar + (stepInBar - 1));
    setViewStartBar((v) =>
      bar - 1 < v || bar - 1 >= v + barsPerView ? Math.max(0, Math.min(TOTAL_BARS - barsPerView, bar - 1)) : v
    );
  };
  const syncPositionFields = () => paintPlayhead(playheadStepRef.current);
  // Isi kolom Posisi dengan posisi playhead sebenarnya, walau kolomnya sedang difokus.
  const forceSyncPositionFields = () => {
    const S = Math.max(1, stepsPerBar);
    const step = playheadStepRef.current;
    if (posBarRef.current) posBarRef.current.value = String(Math.floor(step / S) + 1);
    if (posStepRef.current) posStepRef.current.value = String((step % S) + 1);
  };
  const nudgePosition = (el: HTMLInputElement | null, delta: number, min: number, max: number) => {
    if (!el) return;
    const cur = parseInt(el.value, 10);
    el.value = String(Math.max(min, Math.min(max, (Number.isFinite(cur) ? cur : min) + delta)));
    seekToPosition();
    forceSyncPositionFields();
  };

  // Tampilkan halaman grid yang memuat posisi playhead saat ini (berguna setelah menggulir jauh dari posisi putar).
  const jumpToPlayhead = () => {
    const bar = Math.floor(playheadStepRef.current / Math.max(1, stepsPerBar));
    setViewStartBar(Math.max(0, Math.min(TOTAL_BARS - barsPerView, bar)));
  };

  // Rekam: pukulan pad drum dan akor live (klik / sentuh / keyboard) masuk ke sequencer, keduanya memakai ketukan yang sama.
  // Jika belum diputar, pemutaran (sesuai mode Putar) dimulai dari awal wilayah loop. Berhenti otomatis saat pemutaran berhenti.
  const beginRecording = async () => {
    recTakeOpenRef.current = false;
    recChordTakeOpenRef.current = false;
    if (!isPlaying) {
      resetToBeginning();
      const started = await startPlayback();
      if (!started) return;
    }
    setIsRecording(true);
  };
  const beginRecordingRef = useRef(beginRecording);
  beginRecordingRef.current = beginRecording;

  // Hitung mundur sebelum rekaman (0–15 detik). Klik tombol lagi saat hitung mundur = batal.
  const [recCountdownSec, setRecCountdownSec] = useState<number>(() => {
    try {
      const v = parseInt(window.localStorage.getItem('padstudio.recCountdown') ?? '', 10);
      return Number.isFinite(v) ? Math.max(0, Math.min(15, v)) : 3;
    } catch {
      return 3;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('padstudio.recCountdown', String(recCountdownSec));
    } catch {
      // Abaikan bila storage diblokir
    }
  }, [recCountdownSec]);
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);
  const countdownTimerRef = useRef<number | undefined>(undefined);
  const cancelCountdown = useCallback(() => {
    window.clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = undefined;
    setCountdownLeft(null);
  }, []);
  const countdownClickRef = useRef<(accent: boolean) => void>(() => {});
  countdownClickRef.current = (accent: boolean) => {
    if (!metronomeOn) return;
    const ctx = audioEngine.getAudioContext();
    scheduleClick(ctx, ctx.currentTime + 0.01, accent);
  };
  useEffect(() => () => window.clearInterval(countdownTimerRef.current), []);
  // Hitung mundur dan rekaman TIDAK dibatalkan saat pindah tab: pukulan drum dari keyboard tetap masuk ke sequencer
  // walau yang tampil tab Chord Pad. Tombol Stop/Batal tersedia di kedua tab.
  const toggleRecording = () => {
    audioEngine.getAudioContext().resume();
    if (countdownLeft !== null) {
      cancelCountdown();
      return;
    }
    if (isRecording) {
      setIsRecording(false);
      return;
    }
    if (recCountdownSec <= 0) {
      beginRecording();
      return;
    }
    let left = recCountdownSec;
    setCountdownLeft(left);
    countdownClickRef.current(true);
    countdownTimerRef.current = window.setInterval(() => {
      left -= 1;
      if (left <= 0) {
        cancelCountdown();
        void beginRecordingRef.current();
      } else {
        setCountdownLeft(left);
        countdownClickRef.current(false);
      }
    }, 1000);
  };
  useEffect(() => {
    if (isRecording && !isPlaying) setIsRecording(false);
  }, [isRecording, isPlaying]);
  // Rekaman berhenti: akor yang masih ditahan diselesaikan panjangnya sekarang juga.
  useEffect(() => {
    if (isRecording) return;
    const pending = Array.from(chordRecRef.current.keys());
    if (pending.length === 0) return;
    const now = audioEngine.getAudioContext().currentTime;
    pending.forEach((padIdx) => finishChordRecordRef.current(padIdx, now));
  }, [isRecording]);

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
  const [litChords, setLitChords] = useState<number[]>([]);
  // Level dinamika pad akor yang sedang ditekan / disorot kursor (untuk cincin & teks di pad).
  const [chordHitLv, setChordHitLv] = useState<Record<number, number>>({});
  const [chordHover, setChordHover] = useState<{ idx: number; level: number } | null>(null);
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

  const startChordHold = (padIdx: number, eventTimeStamp?: number, level: number = DEFAULT_LIVE_LEVEL) => {
    const info = padInfo[padIdx];
    if (!info) return;
    const ctx = audioEngine.getAudioContext();
    ctx.resume();
    const prev = heldChordsRef.current.get(padIdx);
    if (prev?.timer !== undefined) window.clearTimeout(prev.timer);
    const voices: Array<{ trackKey: string; midiNotes: number[]; program: number; adsr: EnvelopeADSR }> = [];
    const liveLevel = chordDynamicsOn ? snapLevel(level, chordDynMode) || DEFAULT_LIVE_LEVEL : DEFAULT_LIVE_LEVEL;
    const chordGain = CHORD_LEVEL_GAIN[liveLevel];
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
        volume: (t.volume / 100) * (chordMasterVolume / 100) * chordGain,
        adsr: t.adsr,
      });
      voices.push({ trackKey, midiNotes: info.midiNotes, program: t.program, adsr: { ...t.adsr } });
    });
    heldChordsRef.current.set(padIdx, { since: performance.now(), voices });
    if (isRecordingRef.current) recordChordStart(padIdx, liveTargets, eventTimeStamp, liveLevel);
    setChordHitLv((m) => (m[padIdx] === liveLevel ? m : { ...m, [padIdx]: liveLevel }));
    setLitChords((l) => (l.includes(padIdx) ? l : [...l, padIdx]));
  };

  // Lepas: engine hanya punya "choke" per kunci, jadi akor yang sama dipicu ulang dengan volume 0 untuk memotong halus
  // voice yang sedang ditahan (memakai waktu release instrumen).
  const releaseChordHold = (padIdx: number) => {
    if (chordRecRef.current.has(padIdx)) finishChordRecordRef.current(padIdx, audioEngine.getAudioContext().currentTime);
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
    setChordHitLv((m) => {
      if (!(padIdx in m)) return m;
      const { [padIdx]: _gone, ...rest } = m;
      return rest;
    });
    const wait = Math.max(0, CHORD_TAP_MIN_MS - (performance.now() - held.since));
    if (wait > 0) held.timer = window.setTimeout(doRelease, wait);
    else doRelease();
  };

  // Keyboard fisik -> pad akor live (aktif di tab Akor maupun tab Drum, tombolnya tidak bentrok dengan pad drum): A S D F G H J K = baris atas, L Z X C V B N M = baris bawah.
  // Tahan angka 1–8 (baris angka atau keypad) lalu tekan pad = bunyikan akor dari bank itu TANPA pindah tampilan bank.
  // Tanpa angka, memakai bank yang sedang ditampilkan.
  // Dinamika: tahan tombol dinamika lalu tekan pad.
  //   6 tingkat:  [=pp  {=p  ]=mp  }=mf  \=f  |=ff     ({ } | = tombol yang sama + Shift KANAN)
  //   4 tingkat:  [=p   {=mp ]=mf  }=f                 (\ dan | tidak dipakai)
  //   2 tingkat:  [=p   ]=f                            (hanya tanpa Shift)
  // Tanpa tombol dinamika akor berbunyi f; Shift kanan saja = tingkat paling keras.
  const startChordHoldRef = useRef(startChordHold);
  startChordHoldRef.current = startChordHold;
  const releaseChordHoldRef = useRef(releaseChordHold);
  releaseChordHoldRef.current = releaseChordHold;
  const padBankRef = useRef(padBank);
  padBankRef.current = padBank;
  useEffect(() => {
    const held = new Map<string, number>(); // kode tombol -> indeks pad yang sedang ditahan
    let bankKey: number | null = null;
    let dynCode: string | null = null;
    const dynCodes = DYN_KEY_CODES.chord;
    const bankOf = (code: string): number | null => {
      const m = /^(?:Digit|Numpad)([1-8])$/.exec(code);
      return m ? Number(m[1]) - 1 : null;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const bank = bankOf(e.code);
      const slot = CHORD_KEY_CODES.indexOf(e.code);
      const isDyn = dynCodes.includes(e.code);
      if (bank === null && slot < 0 && !isDyn) return;
      if (modalOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const sec = sectionRef.current;
      if (!sec) return;
      const r = sec.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) return;
      e.preventDefault();
      setHasKeyboard(true);
      if (isDyn) {
        dynCode = e.code;
        return;
      }
      if (bank !== null) {
        bankKey = bank;
        return;
      }
      if (e.repeat || held.has(e.code)) return;
      const idx = (bankKey ?? padBankRef.current) * PADS_PER_BANK + slot;
      held.set(e.code, idx);
      const mode = chordDynModeRef.current;
      const shifted = shiftSideRef.current.right;
      let level = DEFAULT_LIVE_LEVEL;
      if (!chordDynamicsOnRef.current) {
        // Dinamika akor mati: tombol dinamika & Shift diabaikan, semua akor sama keras.
      } else if (dynCode) {
        const lv = dynLevelForKey('chord', dynCode, shifted, mode);
        if (lv > 0) level = lv;
      } else if (shifted) {
        level = DYN_PALETTE[mode][DYN_PALETTE[mode].length - 1];
      }
      startChordHoldRef.current(idx, e.timeStamp, level);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const bank = bankOf(e.code);
      if (bank !== null && bankKey === bank) bankKey = null;
      if (e.code === dynCode) dynCode = null;
      const idx = held.get(e.code);
      if (idx !== undefined) {
        held.delete(e.code);
        releaseChordHoldRef.current(idx);
      }
    };
    const reset = () => {
      held.forEach((idx) => releaseChordHoldRef.current(idx));
      held.clear();
      bankKey = null;
      dynCode = null;
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

  const isAnySeqActive = isPlaying;

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
        <optgroup key={bank} label={`Bank ${bank + 1}`} className="bg-surface text-accent font-black">
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
  const selectionLabel = activeSel ? `${activeSel.cells.size} ${activeTab === 'drum' ? 'pad' : 'sel'} terpilih` : 'Belum ada pilihan';
  // Kontrol panjang akor (tab Akor): diletakkan di baris atas toolbar, di tempat teks jumlah pilihan sebelumnya.
  const chordLenControls = (
    <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5">
      <label className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-gray-300" title="Panjang akor baru: panjang default akor yang baru dipasang">
        Panjang baru
        <select
          value={newChordLen}
          onChange={(e) => setNewChordLen(Number(e.target.value))}
          aria-label="Panjang akor baru (step)"
          className="bg-black/70 border border-white/15 rounded-md px-2 py-1 text-xs font-mono text-accent focus:outline-none cursor-pointer"
        >
          {Array.from(new Set([1, 2, 4, 8, stepsPerBar, stepsPerBar * 2, stepsPerBar * 4, newChordLen]))
            .filter((n) => n >= 1 && n <= totalSteps)
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n} value={n} className="bg-black text-white">
                {n}
                {n % stepsPerBar === 0 ? ` (${n / stepsPerBar} bar)` : ''}
              </option>
            ))}
        </select>
        <span className="font-mono text-gray-500 font-normal">step</span>
      </label>
      <label className="flex items-center gap-1 whitespace-nowrap text-xs font-bold text-gray-300" title="Panjang akor terpilih: ubah panjang semua akor yang sedang dipilih">
        Terpilih
        <IntField
          value={selectedNoteInfo.len}
          min={1}
          max={totalSteps}
          onChange={setSelectedNotesLength}
          disabled={selectedNoteInfo.count === 0}
          ariaLabel="Panjang akor terpilih (step)"
        />
        <span className="font-mono text-gray-500 font-normal">step{selectedNoteInfo.count > 1 ? ` ×${selectedNoteInfo.count}` : ''}</span>
      </label>
    </div>
  );

  const gridStyle = useMemo<React.CSSProperties>(
    () => ({ gridTemplateColumns: `repeat(${viewSteps}, minmax(0, 1fr))` }),
    [viewSteps]
  );
  // Layar sentuh (HP/tablet): sel step minimal 20px supaya bisa diketuk dengan jari; kursor mouse tetap 10px.
  const [coarsePointer, setCoarsePointer] = useState<boolean>(
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(pointer: coarse)');
    const onChange = () => setCoarsePointer(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  const gridMinWidth = viewSteps * (coarsePointer ? 20 : 10) + (showMixer ? 320 : 260);

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
    if (chordWarmPairs.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      audioEngine.prewarmChordSamples(chordWarmPairs, { shouldAbort: () => cancelled }).catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chordWarmKey]);

  // Cermin state terbaru untuk scheduler: scheduler membaca dari sini, jadi TIDAK perlu dibuat ulang
  // setiap grid/track/volume/tempo berubah (sebelumnya interval dihentikan & dibuat ulang tiap edit).
  liveRef.current = {
    bpm,
    isPlaying,
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
    drumDynMode,
    chordDynMode,
    chordDynamicsOn,
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
      // Catat ketukan ini (untuk membulatkan pukulan rekaman) dan bunyikan metronom (saat memutar maupun merekam).
      const trail = recentStepsRef.current;
      trail.push({ step, time: when });
      if (trail.length > 48) trail.shift();
      if (L.metronomeOn) {
        const pos = step % L.stepsPerBar;
        if (L.beatStart[pos]) scheduleClick(ctx, when, pos === 0);
      }
      if (L.isDrumLoopActive) {
        for (const inst of DRUM_INSTRUMENTS) {
          const level = effLevel(clampLevel(L.drumGrid[inst.id]?.[step]), L.dynamicsOn, L.drumDynMode);
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
            volume: effectiveVol * (L.chordDynamicsOn ? noteGain(track.vels?.[step], L.chordDynMode) : 1),
            adsr: track.adsr,
          });
        }
      }
      const vq = visualQueueRef.current;
      vq.push({ step, time: when });
      if (vq.length > 256) vq.splice(0, vq.length - 256); // tab di latar: rAF berhenti, jangan biarkan antrean membengkak
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
        // Wilayah loop selalu dari titik yang lebih awal ke yang lebih akhir, walau Bar / Step awal diisi melewati akhir.
        const posA = (L.loopStartBar - 1) * S + (L.loopStartBeat - 1);
        const posB = (L.loopEndBar - 1) * S + (L.loopEndBeat - 1);
        const configuredEndStep = Math.max(0, Math.min(maxSteps - 1, Math.max(posA, posB)));
        const configuredStartStep = Math.max(0, Math.min(Math.min(posA, posB), configuredEndStep));

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
            stepRef.current = configuredStartStep;
            const waitMs = Math.max(0, (nextTimeRef.current - ctx.currentTime) * 1000) + 30;
            finishTimer = window.setTimeout(() => {
              setIsPlaying(false);
              stopAllLiveChords();
              visualQueueRef.current = [];
              paintPlayhead(configuredStartStep);
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

  // Rentang main berubah: playhead yang tertinggal di luar rentang langsung dijepit masuk.
  useEffect(() => {
    const cur = playheadStepRef.current;
    const next = clampToLoop(cur);
    if (next !== cur || stepRef.current !== clampToLoop(stepRef.current)) {
      stepRef.current = clampToLoop(stepRef.current);
      visualQueueRef.current = [];
      paintPlayhead(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopStartBar, loopStartBeat, loopEndBar, loopEndBeat, stepsPerBar, isUnlocked8Bar]);

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

  // Ukur posisi horizontal grid pad (baris pertama) relatif terhadap pembungkus overlay.
  useLayoutEffect(() => {
    const wrap = seqWrapRef.current;
    if (!wrap) return;
    const measure = () => {
      const g = wrap.querySelector('[data-rowgrid]') as HTMLElement | null;
      if (!g) return;
      const wr = wrap.getBoundingClientRect();
      const gr = g.getBoundingClientRect();
      const left = Math.round((gr.left - wr.left) * 100) / 100;
      const right = Math.round((wr.right - gr.right) * 100) / 100;
      setLoopBox((prev) => (prev && prev.left === left && prev.right === right ? prev : { left, right }));

      // Tepi area main: tengah celah antar pad (kiri pad awal, kanan pad akhir).
      const S = stepsPerBar;
      const playable = isUnlocked8Bar ? totalSteps : S;
      const rawA = (loopStartBar - 1) * S + (loopStartBeat - 1);
      const rawB = (loopEndBar - 1) * S + (loopEndBeat - 1);
      const hi = Math.max(0, Math.min(playable - 1, Math.max(rawA, rawB)));
      const lo = Math.max(0, Math.min(Math.min(rawA, rawB), hi));
      const winStart = viewStartBar * S;
      const winEnd = winStart + barsPerView * S - 1;
      const gap = parseFloat(getComputedStyle(g).columnGap) || 2;
      // Kolom grid sama lebar (1fr + celah), jadi tepi dihitung dari lebar grid — tidak bergantung ukuran tombol
      // yang bisa belum final saat halaman baru dimuat.
      const nCols = Math.max(1, barsPerView * S);
      const colW = (gr.width - gap * (nCols - 1)) / nCols;
      const colLeft = (k: number) => k * (colW + gap);
      const x1 = lo >= winStart && lo <= winEnd ? Math.round((colLeft(lo - winStart) - gap / 2) * 100) / 100 : null;
      const x2 = hi >= winStart && hi <= winEnd ? Math.round((colLeft(hi - winStart) + colW + gap / 2) * 100) / 100 : null;
      const w = Math.round(gr.width * 100) / 100;
      setLoopX((prev) => (prev.x1 === x1 && prev.x2 === x2 && prev.w === w && prev.gap === gap ? prev : { x1, x2, w, gap }));
    };
    measure();
    // Ukur ulang setelah layout/font benar-benar settle (pemuatan awal / reload).
    const raf1 = requestAnimationFrame(() => {
      measure();
      requestAnimationFrame(measure);
    });
    const t1 = window.setTimeout(measure, 150);
    const t2 = window.setTimeout(measure, 600);
    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    fonts?.ready?.then(measure).catch(() => {});
    window.addEventListener('load', measure);
    window.addEventListener('resize', measure);
    const cleanupBase = () => {
      cancelAnimationFrame(raf1);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('load', measure);
      window.removeEventListener('resize', measure);
    };
    if (typeof ResizeObserver === 'undefined') return cleanupBase;
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    if (wrap.parentElement) ro.observe(wrap.parentElement);
    wrap.querySelectorAll('[data-rowgrid]').forEach((el) => ro.observe(el));
    return () => {
      cleanupBase();
      ro.disconnect();
    };
  }, [
    activeTab,
    showMixer,
    chordTracks,
    barsPerView,
    stepsPerBar,
    viewStartBar,
    loopStartBar,
    loopStartBeat,
    loopEndBar,
    loopEndBeat,
    isUnlocked8Bar,
    totalSteps,
  ]);

  // Geser jendela tampilan grid per bar (menggantikan scroll horizontal 1560px).
  const shiftView = (direction: 1 | -1) => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    setViewStartBar((v) => Math.max(0, Math.min(TOTAL_BARS - barsPerView, v + direction * shiftBars)));
  };

  const changeBarsPerView = (raw: number) => {
    if (!isUnlocked8Bar) {
      if (Math.round(raw) > FREE_MAX_BARS) onUnlockEditor();
      return;
    }
    const n = Math.max(1, Math.min(MAX_BARS_PER_VIEW, Math.round(raw) || 1));
    setBarsPerView(n);
    setViewStartBar((v) => Math.max(0, Math.min(TOTAL_BARS - n, v)));
  };

  // Deteksi Bank akor yang overflow (turun ke baris bawah instrumen live). Tidak bergantung pada kelas rata kiri/kanan,
  // jadi hasilnya stabil dan tidak bolak-balik.
  useLayoutEffect(() => {
    if (activeTab !== 'chord') return;
    const row = chordRowRef.current;
    const inst = liveInstRef.current;
    const bank = bankGroupRef.current;
    if (!row || !inst || !bank) return;
    const measure = () => {
      // Bank akor dianggap turun bila posisinya sudah di bawah blok instrumen live (bukan sejajar dengannya).
      const wrapped = bank.offsetTop >= inst.offsetTop + inst.offsetHeight - 2;
      setBankWrapped((prev) => (prev === wrapped ? prev : wrapped));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    ro.observe(inst);
    ro.observe(bank);
    return () => ro.disconnect();
  }, [activeTab, chordTracks]);

  // Rentang loop dijaga urut: awal tidak bisa melewati akhir dan akhir tidak bisa mendahului awal. Bila diubah melewati
  // batas, nilai yang sedang diubah berhenti di nilai pasangannya (awal dan akhir jadi sama).
  const loopPos = (bar: number, beat: number) => (bar - 1) * stepsPerBar + (beat - 1);
  const changeLoopStart = (bar: number, beat: number) => {
    if (!isUnlocked8Bar && bar > FREE_MAX_BARS) {
      onUnlockEditor();
      return;
    }
    if (loopPos(bar, beat) > loopPos(loopEndBar, loopEndBeat)) {
      setLoopStartBar(loopEndBar);
      setLoopStartBeat(loopEndBeat);
      return;
    }
    setLoopStartBar(bar);
    setLoopStartBeat(beat);
  };
  const changeLoopEnd = (bar: number, beat: number) => {
    if (!isUnlocked8Bar && bar > FREE_MAX_BARS) {
      onUnlockEditor();
      return;
    }
    if (loopPos(bar, beat) < loopPos(loopStartBar, loopStartBeat)) {
      setLoopEndBar(loopStartBar);
      setLoopEndBeat(loopStartBeat);
      return;
    }
    setLoopEndBar(bar);
    setLoopEndBeat(beat);
  };

  // Tarik pegangan awal / akhir area main langsung di grid. Posisi dibulatkan ke step di jendela yang tampil.
  const startLoopDrag = (edge: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const grid = loopGridRef.current;
    if (!grid) return;
    const winStart = viewStartBar * stepsPerBar;
    const move = (ev: PointerEvent) => {
      const r = grid.getBoundingClientRect();
      const frac = (ev.clientX - r.left) / Math.max(1, r.width);
      const step = winStart + Math.max(0, Math.min(viewSteps - 1, Math.floor(frac * viewSteps)));
      const clamped = Math.max(0, Math.min((isUnlocked8Bar ? totalSteps : stepsPerBar) - 1, step));
      const bar = Math.floor(clamped / stepsPerBar) + 1;
      const beat = (clamped % stepsPerBar) + 1;
      if (edge === 'start') changeLoopStart(bar, beat);
      else changeLoopEnd(bar, beat);
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

  // Ganti birama: hentikan pemutaran, pindahkan isi grid ke panjang bar baru, reset wilayah loop.
  const changeTimeSignature = (nextId: string) => {
    if (nextId === timeSigId) return;
    const next = getTimeSig(nextId);
    const oldS = stepsPerBar;
    const newS = stepsPerBarOf(next);

    historyResetRef.current = true;
    setIsPlaying(false);
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
      prev.map((t) => ({ ...t, ...remapTrackData(t.steps, t.lens, oldS, newS, TOTAL_BARS, t.vels) }))
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
    const fxData = serializeFx(fx);
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
        notes: listNotes(t.steps, t.lens).map((n) => {
          const vel = clampLevel(t.vels?.[n.start]);
          return (vel > 0 ? [n.start, n.len, n.pad, vel] : [n.start, n.len, n.pad]) as [number, number, number] | [number, number, number, number];
        }),
      })),
      ...(fxData ? { fx: fxData } : {}),
    };
  };

  // Terapkan proyek (sudah divalidasi oleh importMidiBuffer) ke seluruh state editor.
  const loadProject = (p: PadProject) => {
    const ts = getTimeSig(p.timeSig);
    const S = stepsPerBarOf(ts);
    const total = S * TOTAL_BARS;

    historyResetRef.current = true;
    setIsPlaying(false);
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
      t.notes.forEach(([start, len, pad, vel]) => {
        if (start >= 0 && start < total) {
          data.steps[start] = pad;
          data.lens[start] = len;
          data.vels[start] = clampLevel(vel);
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
        vels: data.vels,
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
    setFx(deserializeFx(p.fx));
    setPadBank(0);
    setLiveSel(0);
    setSel(null);
    setDrumPicker(null);
    setPickerTrack(null);
  };

  // Server menolak karena tidak punya hak akses: samakan UI dengan keadaan resmi lalu tawarkan Full Editor.
  const handleServerDenied = () => {
    setServerPaid(false);
    onUnlockEditor();
  };

  // Berkas proyek DIBUAT oleh server (divalidasi + dienkripsi). Browser hanya mengirim data dan menyimpan hasilnya.
  const saveProject = async () => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    try {
      const made = await saveProjectOnServer(snapshotProject());
      if (made.result === 'denied') return handleServerDenied();
      if (made.result !== 'ok') {
        alert(`Gagal menyimpan proyek: ${made.message}`);
        return;
      }
      const d = new Date();
      const two = (n: number) => String(n).padStart(2, '0');
      const name = `PlayMuzeck_Proyek_${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}.mid`;
      downloadBlob(made.value, name);
      onSuccessToast(`Proyek disimpan sebagai "${name}". Simpan berkas ini; muat kembali lewat tombol Muat Proyek.`);
    } catch (err) {
      alert(`Gagal menyimpan proyek: ${err instanceof Error ? err.message : 'terjadi kesalahan.'}`);
    }
  };

  // Contoh suara di popup Efek: satu rangkaian pukulan drum, atau satu akor (nada pad pertama) per instrumen target.
  const auditionFx = (domain: 'drum' | 'chord', target: string) => {
    const ctx = audioEngine.getAudioContext();
    void ctx.resume();
    const t0 = ctx.currentTime + 0.03;
    if (domain === 'drum') {
      const ids = target === 'all' ? ['kick', 'snare', 'closedhat', 'snare'] : [target];
      ids.forEach((id, i) => {
        const m = drumMix[id];
        audioEngine.scheduleDrumSound(
          id,
          selectedDrumKit,
          (drumVolume / 100) * ((m?.volume ?? 100) / 100) * DRUM_LEVEL_GAIN[DEFAULT_LIVE_LEVEL],
          t0 + i * 0.24,
          m?.adsr
        );
      });
      return;
    }
    const info = padInfo[0];
    if (!info) return;
    const targets = target === 'all' ? chordTracks.filter((t) => t.enabled) : chordTracks.filter((t) => String(t.id) === target);
    targets.forEach((t) => {
      audioEngine.scheduleChordEvent({
        trackKey: `live${t.id}-fxtest`,
        midiNotes: info.midiNotes,
        program: t.program,
        when: t0,
        holdSec: 0.9,
        volume: (t.volume / 100) * (chordMasterVolume / 100) * CHORD_LEVEL_GAIN[DEFAULT_LIVE_LEVEL],
        adsr: t.adsr,
      });
    });
  };

  // Ekspor: minta izin server dulu, baru buka modal ekspor.
  const openExportModal = async (scope: 'drum' | 'chord' | 'both') => {
    if (!(await requireServerAccess('export'))) {
      setIsExportMenuOpen(false);
      return;
    }
    setExportScope(scope);
    setIsExportMenuOpen(false);
    setIsExportModalOpen(true);
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
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Berkas terlalu besar (maksimal 5 MB).');
      return;
    }
    try {
      // Server yang membuka & memvalidasi berkas; konfirmasi hanya muncul bila berkasnya memang bisa dimuat.
      const res = await loadProjectOnServer<PadProject>(file);
      if (res.result === 'denied') return handleServerDenied();
      if (res.result !== 'ok') {
        alert(`Gagal memuat berkas: ${res.message}`);
        return;
      }
      if (!window.confirm(`Memuat "${file.name}" akan mengganti seluruh pola dan pengaturan yang sedang ada. Lanjutkan?`)) return;
      loadProject(res.value.project);
      onSuccessToast(`${res.value.summary} (${file.name})`);
      if (res.value.warnings.length > 0) alert(`Catatan impor:\n- ${res.value.warnings.join('\n- ')}`);
    } catch (err) {
      alert(`Gagal memuat berkas: ${err instanceof Error ? err.message : 'berkas tidak dapat dibaca.'}`);
    }
  };

  // Hasil ekspor sama dengan yang terdengar: dinamika mati = semua pukulan rata, mode 4 / 2 tingkat = dibulatkan ke palet.
  const exportDrumGrid = useMemo<{ [key: string]: number[] }>(() => {
    if (!isExportModalOpen || (dynamicsOn && drumDynMode === 6)) return drumGrid;
    const out: { [key: string]: number[] } = {};
    Object.keys(drumGrid).forEach((id) => {
      out[id] = drumGrid[id].map((v) => effLevel(clampLevel(v), dynamicsOn, drumDynMode));
    });
    return out;
  }, [isExportModalOpen, dynamicsOn, drumDynMode, drumGrid]);

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
        stepGains: t.steps.map((_, i) => (chordDynamicsOn ? noteGain(t.vels?.[i], chordDynMode) : 1)),
        volume: effVol,
        adsr: t.adsr,
        enabled: t.enabled,
        muted: t.muted,
        solo: t.solo,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExportModalOpen, chordTracks, padInfo, chordMasterVolume]);

  // Indeks track akor yang aktif (urutan tampil), dipakai untuk tombol tukar urutan & hapus.
  const enabledChordIdx = chordTracks.reduce<number[]>((acc, t, i) => {
    if (t.enabled) acc.push(i);
    return acc;
  }, []);

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

          <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
            <div className="flex items-center bg-black/60 p-1 rounded-xl border border-white/[0.08] shrink-0">
              <button
                onClick={() => setActiveTab('drum')}
                className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'drum' ? 'bg-accent text-on-accent shadow-sm' : 'text-gray-300 hover:text-white'
                }`}
              >
                Drum Pad
              </button>
              <button
                onClick={() => setActiveTab('chord')}
                className={`px-3 py-2 sm:py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  activeTab === 'chord' ? 'bg-accent text-on-accent shadow-sm' : 'text-gray-300 hover:text-white'
                }`}
              >
                <span>Chord Pad</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 ml-auto">
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
              {isUnlocked8Bar ? <Download className="w-3.5 h-3.5 text-accent" /> : <Lock className="w-3.5 h-3.5 text-accent" />}
              <span>Ekspor Pola</span>
            </button>

            <button
              type="button"
              onClick={() => void saveProject()}
              title="Simpan seluruh proyek (pola, mixer, ADSR, akor) ke berkas MIDI di perangkat Anda"
              className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-black/60 hover:bg-black/90 border border-white/[0.12] text-gray-200 shadow cursor-pointer shrink-0"
            >
              {isUnlocked8Bar ? <Save className="w-3.5 h-3.5 text-accent" /> : <Lock className="w-3.5 h-3.5 text-accent" />}
              <span>Simpan Proyek</span>
            </button>

            <button
              type="button"
              onClick={openProjectPicker}
              title="Muat proyek dari berkas MIDI (hasil Simpan Proyek / Ekspor MIDI, atau MIDI lain)"
              className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-black/60 hover:bg-black/90 border border-white/[0.12] text-gray-200 shadow cursor-pointer shrink-0"
            >
              {isUnlocked8Bar ? <FolderOpen className="w-3.5 h-3.5 text-accent" /> : <Lock className="w-3.5 h-3.5 text-accent" />}
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
        </div>

        {activeTab === 'drum' && (
          <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06]">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-300">Pilih Drum Kit:</span>
              {DRUM_KITS.map((kit) => {
                const kitLocked = !isUnlocked8Bar && !FREE_DRUM_KITS.includes(kit);
                return (
                  <button
                    key={kit}
                    onClick={() => {
                      if (kitLocked) {
                        onUnlockEditor();
                        return;
                      }
                      setSelectedDrumKit(kit);
                    }}
                    title={kitLocked ? `Kit ${kit} perlu editor penuh` : undefined}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1 ${
                      selectedDrumKit === kit
                        ? 'bg-accent text-on-accent border-accent font-bold shadow'
                        : kitLocked
                        ? 'bg-black/50 text-gray-500 border-white/[0.08] hover:border-white/20'
                        : 'bg-black/50 text-gray-300 border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    {kitLocked && <Lock className="w-3 h-3 text-accent" />}
                    {kit}
                  </button>
                );
              })}
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
                    <b className="text-gray-100">Dinamika menyala:</b> tekan di pusat pad untuk pukulan paling keras. Makin jauh dari pusat
                    makin lemah sampai paling pelan di tepi. Cincin dan label di pad menunjukkan tingkatnya. Jumlah tingkat dipilih lewat
                    tombol Tingkat: 6 (pp, p, mp, mf, f, ff), 4 (p, mp, mf, f) atau 2 (p, f).
                  </p>
                  <p>
                    <b className="text-gray-100">Dinamika mati:</b> semua pukulan sama kerasnya, di mana pun pad ditekan.
                  </p>
                  {hasKeyboard && (
                    <p>
                      <b className="text-gray-100">Keyboard:</b> tombol Q W E R T Y U I O P membunyikan kesepuluh pad dari kiri ke kanan. Untuk
                      memilih dinamika, tahan tombol dinamika lalu tekan pad. 6 tingkat: , = pp, &lt; = p, . = mp, &gt; = mf, / = f, ? = ff. 4 tingkat:
                      , = p, &lt; = mp, . = mf, &gt; = f. 2 tingkat: , = p dan . = f. Simbol &lt; &gt; ? dibuat dengan menahan Shift KIRI.
                      Tanpa tombol dinamika, pad berbunyi f (Shift kiri saja = tingkat paling keras). Tidak berlaku bila dinamika mati.
                    </p>
                  )}
                  <p>
                    <b className="text-gray-100">Rekam:</b> atur hitung mundur (0–15 detik) di kotak sebelah tombol, tekan Rekam, tunggu hitungan selesai, lalu mainkan pad{hasKeyboard ? ' (atau tombol keyboard)' : ''}. Tiap pukulan
                    masuk ke step terdekat di sequencer drum (resolusi 1/16 not) dan ikut tercatat sebagai dinamikanya. Pad akor juga ikut
                    terekam (lihat tab Chord Pad). Bila belum diputar, pemutaran sesuai pilihan Drum dan/atau Akor dimulai otomatis dari
                    awal wilayah loop. Satu rekaman = satu langkah Undo. Metronom (bila aktif) berbunyi saat memutar maupun merekam.
                  </p>
                </InfoTip>
              ) : (
                <InfoTip title="Live harmonic chords">
                  <p>
                    Mengubah akor sebuah pad (ikon slider) juga mengubahnya di semua step sequencer yang memakai pad itu.
                  </p>
                  <p>Mengganti instrumen (ikon pensil) juga mengganti instrumen barisnya di sequencer.</p>
                  <p>
                    <b className="text-gray-100">Keyboard:</b> baris atas pad = A S D F G H J K, baris bawah = L Z X C V B N M. Tahan angka 1–8
                    (baris angka atau keypad) lalu tekan pad untuk membunyikan akor dari bank itu tanpa memindahkan tampilan bank. Tanpa angka,
                    dipakai bank yang sedang ditampilkan.
                  </p>
                  <p>
                    <b className="text-gray-100">Dinamika:</b> nyalakan tombol Dinamika; tekan di pusat pad untuk akor paling keras, makin ke tepi makin pelan (tombol Teks
                    menampilkan pp … ff di pad). Bila dinamika mati, semua akor sama keras. Pilih jumlah tingkat lewat tombol Tingkat (6, 4 atau 2), atau tahan tombol dinamika dan
                    tekan pad. 6 tingkat: [ = pp, {'{'} = p, ] = mp, {'}'} = mf, \ = f, | = ff. 4 tingkat: [ = p, {'{'} = mp, ] = mf, {'}'} = f. 2 tingkat:
                    [ = p dan ] = f. Simbol {'{'} {'}'} | dibuat dengan menahan Shift KANAN. Tanpa tombol dinamika, akor berbunyi f (Shift kanan saja =
                    tingkat paling keras). Dinamika ikut tersimpan pada akor yang direkam (juga di Salin/Tempel, Undo, Simpan Proyek, dan ekspor). Akor yang dipasang dengan klik di grid berbunyi normal.
                  </p>
                  <p>
                    <b className="text-gray-100">Rekam:</b> tombol Rekam sama dengan di tab Drum Pad, jadi drum dan akor direkam bersamaan pada
                    ketukan yang sama. Akor masuk ke instrumen live yang dipilih (atau semua instrumen bila memilih Semua); panjang
                    notanya mengikuti lama pad ditahan. Satu rekaman = satu langkah Undo.
                  </p>
                </InfoTip>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {activeTab === 'drum' && (
                <>
                  <DynModePicker kind="drum" mode={drumDynMode} onChange={setDrumDynMode} disabled={!dynamicsOn} />
                  <DynTextToggle on={dynText} disabled={!dynamicsOn} onToggle={() => setDynText((v) => !v)} />
                  <DynamicsToggle on={dynamicsOn} onToggle={toggleDynamics} />
                </>
              )}
              {activeTab === 'chord' && (
                <>
                  <DynModePicker kind="chord" mode={chordDynMode} onChange={setChordDynMode} disabled={!chordDynamicsOn} />
                  <DynTextToggle on={chordDynText} disabled={!chordDynamicsOn} onToggle={() => setChordDynText((v) => !v)} />
                  <DynamicsToggle on={chordDynamicsOn} onToggle={toggleChordDynamics} noun="akor" />
                </>
              )}
            </div>
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
              {/* Satu baris: instrumen live di kiri, bank akor di kanan. Bila Bank akor overflow dan turun ke baris
                  bawah, Bank akor rata kiri sedangkan keterangan "Pad #… dari …" tetap di kanan. */}
              <div ref={chordRowRef} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* Pemilih instrumen live: satu chip per instrumen yang sedang dipakai di sequencer */}
              <div ref={liveInstRef} className="flex flex-wrap items-center gap-1.5">
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
                      {/* Hapus instrumen: tersedia untuk instrumen ke-2 dan seterusnya */}
                      {i !== enabledChordIdx[0] && (
                        <button
                          type="button"
                          onClick={() => {
                            if (isRecording) return;
                            if (t.steps.some((v) => v >= 0) && !window.confirm(`Hapus "${name}" (${t.label}) beserta isinya di sequencer?`)) return;
                            removeTrack(i);
                            setLiveSel((prev) => (prev === i ? 0 : prev));
                          }}
                          disabled={isRecording}
                          title={`Hapus instrumen ${t.label}`}
                          aria-label={`Hapus instrumen ${t.label}`}
                          className={`px-1.5 border-l cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                            active ? 'border-accent/40 text-accent hover:bg-red-500 hover:text-white' : 'border-white/10 text-gray-400 hover:bg-red-500/80 hover:text-white'
                          }`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
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
                    {isUnlocked8Bar ? <Plus className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                    Instrumen
                  </button>
                )}
              </div>

              {/* Bank akor 1–8 + keterangan pad dalam SATU unit. Bila unit ini tidak muat sejajar dengan instrumen live
                  (sudah 2 instrumen atau lebih / layar sempit), seluruh unit turun ke baris bawah: Bank akor rata kiri,
                  keterangan "Pad #… dari …" tetap di kanan. Selagi muat (1 instrumen), Bank akor di kanan. */}
              <div ref={bankGroupRef} className="flex flex-auto items-center gap-x-3">
                <div
                  className={`flex flex-wrap items-center justify-start gap-1.5 min-w-0 ${bankWrapped ? '' : 'ml-auto'}`}
                  role="tablist"
                  aria-label="Bank akor"
                >
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
                </div>
                <span className={`shrink-0 text-[10px] font-mono text-gray-500 whitespace-nowrap ${bankWrapped ? 'ml-auto' : ''}`}>
                  Pad #{padBank * PADS_PER_BANK + 1}–{(padBank + 1) * PADS_PER_BANK} dari {PAD_BANKS * PADS_PER_BANK}
                </span>
              </div>
              </div>
            </>
          )}

          {countdownLeft !== null && (
            <>
              <p className="text-[11px] font-semibold text-amber-300 flex items-center gap-1.5 flex-wrap">
                <Timer className="w-3 h-3" />
                Rekaman dimulai dalam {countdownLeft} detik… bersiap di pad drum atau pad akor.
                <button
                  type="button"
                  onClick={toggleRecording}
                  className="ml-1 px-2 py-0.5 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-[10px] font-bold cursor-pointer"
                >
                  Batal
                </button>
              </p>
              {createPortal(
                <div className="fixed inset-0 z-[70] pointer-events-none flex items-center justify-center" aria-live="assertive">
                  <span className="text-8xl sm:text-9xl font-black text-accent drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)]">{countdownLeft}</span>
                </div>,
                document.body
              )}
            </>
          )}

          {isRecording && (
            <p className="text-[11px] font-semibold text-red-300 flex items-center gap-1.5 flex-wrap">
              <Circle className="w-2.5 h-2.5 fill-red-500 text-red-500 animate-pulse" />
              Merekam… mainkan pad drum{hasKeyboard ? ' (Q–P)' : ''} atau pad akor{hasKeyboard ? ' (A–M)' : ''}
              {!hasKeyboard ? ' (pad drum di tab Drum Pad, pad akor di tab Chord Pad)' : ''}; masuk ke step terdekat.
              <button
                  type="button"
                  onClick={toggleRecording}
                  className="ml-1 px-2 py-0.5 rounded-md bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-200 text-[10px] font-bold cursor-pointer"
                >
                  Stop
                </button>
            </p>
          )}

          {activeTab === 'drum' ? (
            <div className="grid grid-cols-5 lg:grid-cols-10 gap-1.5 sm:gap-2">
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
                        ? `Tekan dekat pusat = keras (${DRUM_LEVEL_SHORT[DYN_PALETTE[drumDynMode][DYN_PALETTE[drumDynMode].length - 1]]}), makin ke tepi = makin pelan (${DRUM_LEVEL_SHORT[DYN_PALETTE[drumDynMode][0]]})`
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
                        triggerDrum(inst.id, DEFAULT_LIVE_LEVEL, e.timeStamp);
                      }
                    }}
                    onContextMenu={(e) => e.preventDefault()}
                    className={`group relative h-24 rounded-xl border overflow-hidden select-none touch-none transition-all cursor-pointer ${
                      activePadAnim === inst.id
                        ? 'bg-accent/25 border-accent scale-[1.03] shadow-lg'
                        : 'bg-surface text-white border-white/[0.08] hover:border-accent/60'
                    }`}
                  >
                    <span className="absolute top-1.5 inset-x-0.5 sm:inset-x-1 text-[9.5px] min-[400px]:text-[11px] sm:text-xs font-black tracking-tight text-center leading-tight pointer-events-none [overflow-wrap:anywhere]">
                      {inst.label}
                    </span>
                    {/* Cincin dinamika: batas tiap cincin = batas level (ff di tengah → pp di tepi). Hanya saat dinamika menyala. */}
                    {dynamicsOn &&
                      liveRings(DYN_PALETTE[drumDynMode].length).map((r, i) => {
                        const pal = DYN_PALETTE[drumDynMode];
                        const ringLevel = pal[pal.length - 1 - i]; // cincin terdalam = batas tingkat paling keras
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
                      {dynamicsOn && dynText && shown ? DRUM_LEVEL_SHORT[shown] : ''}
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
                const pal = DYN_PALETTE[chordDynMode];
                const hitLv = chordDynamicsOn ? chordHitLv[idx] ?? 0 : 0;
                const hoverLv = chordDynamicsOn && chordHover && chordHover.idx === idx ? chordHover.level : 0;
                const shownLv = hitLv || hoverLv;
                return (
                  <div
                    key={idx}
                    title={
                      chordDynamicsOn
                        ? `Tekan dekat pusat = keras (${DRUM_LEVEL_SHORT[pal[pal.length - 1]]}), makin ke tepi = makin pelan (${DRUM_LEVEL_SHORT[pal[0]]})`
                        : 'Dinamika mati: semua akor sama keras'
                    }
                    onPointerDown={(e) => {
                      if (e.pointerType === 'mouse' && e.button !== 0) return;
                      const lv = chordDynamicsOn ? chordLevelAtPointer(e) : DEFAULT_LIVE_LEVEL;
                      try {
                        e.currentTarget.setPointerCapture(e.pointerId);
                      } catch {
                        // Abaikan bila pointer capture tidak didukung
                      }
                      startChordHold(idx, e.timeStamp, lv);
                    }}
                    onPointerMove={(e) => {
                      if (!chordDynamicsOn || e.pointerType !== 'mouse') return;
                      const lv = chordLevelAtPointer(e);
                      setChordHover((h) => (h && h.idx === idx && h.level === lv ? h : { idx, level: lv }));
                    }}
                    onPointerLeave={() => setChordHover((h) => (h && h.idx === idx ? null : h))}
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
                      aria-label="Edit akor pad ini"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => openHarmonicEditor(idx, e)}
                      className="absolute top-0.5 right-0.5 p-2 rounded-md bg-black/40 hover:bg-accent text-gray-300 hover:text-on-accent transition-colors"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                    </button>
                    {/* Cincin dinamika: ff di tengah → pp di tepi (sama dengan pad drum). Hanya saat dinamika menyala. */}
                    {chordDynamicsOn &&
                      liveRings(pal.length).map((r, ri) => {
                        const ringLevel = pal[pal.length - 1 - ri];
                        return (
                          <span
                            key={r}
                            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border pointer-events-none transition-colors ${
                              shownLv === ringLevel ? (isActive ? 'border-black/60' : 'border-accent') : isActive ? 'border-black/15' : 'border-white/10'
                            }`}
                            style={{ width: `${r * 100}%`, height: `${r * 100}%` }}
                          />
                        );
                      })}
                    {chordDynamicsOn && chordDynText && shownLv > 0 && (
                      <span
                        className={`absolute top-1.5 left-1/2 -translate-x-1/2 px-1.5 rounded text-[10px] font-black italic pointer-events-none ${
                          isActive ? 'bg-black/30 text-white' : 'bg-accent text-on-accent'
                        }`}
                      >
                        {DRUM_LEVEL_SHORT[shownLv]}
                      </span>
                    )}
                    <span className="text-[10px] font-mono text-gray-400 self-start">#{idx + 1}</span>
                    {hasKeyboard && CHORD_KEY_LABELS[i] && (
                      <kbd className="absolute bottom-1 right-1.5 px-1 rounded border border-white/15 bg-black/50 text-[9px] font-mono font-bold text-gray-300 pointer-events-none">
                        {CHORD_KEY_LABELS[i]}
                      </kbd>
                    )}
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
          <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider">
            {activeTab === 'drum' ? 'Step Sequencer Pola Ketukan' : 'Step Sequencer Progresi Akor (4 Instrumen)'}
          </h4>
          {/* Satu baris, dirapatkan supaya muat di layar laptop tanpa scroll. Gulir ke samping hanya jadi cadangan di layar sangat sempit. */}
          <div className="flex flex-nowrap items-center justify-between gap-1.5 overflow-x-auto pb-1 whitespace-nowrap">
            <TempoControl bpm={bpm} setBpm={setBpm} />
            <div className={BAR_BOX}>
              <select
                value={timeSigId}
                onChange={(e) => changeTimeSignature(e.target.value)}
                aria-label="Birama" title="Birama. BPM dihitung per not seperempat; 1 step = 1/16 not."
                className="bg-black/70 border border-white/20 rounded-lg px-2 py-1 font-mono font-black text-base text-accent focus:outline-none focus:border-accent cursor-pointer"
              >
                {TIME_SIGNATURES.map((ts) => (
                  <option key={ts.id} value={ts.id} className="bg-black text-white">
                    {ts.label}
                  </option>
                ))}
              </select>
            </div>
            {!isUnlocked8Bar && (
              <div className="shrink-0 flex items-center gap-[2px]" role="group" aria-label={`Peta ${TOTAL_BARS} bar (gratis: hanya Bar 1)`}>
                <button
                  type="button"
                  title="Bar 1 (gratis)"
                  className="w-5 h-5 sm:w-4 sm:h-4 rounded text-[8px] font-bold leading-none flex items-center justify-center bg-accent text-on-accent cursor-default"
                >
                  1
                </button>
                <button
                  type="button"
                  onClick={onUnlockEditor}
                  title={`Bar 2–${TOTAL_BARS} terkunci — buka editor penuh`}
                  className="h-5 sm:h-4 px-1.5 rounded text-[8px] font-bold leading-none flex items-center gap-0.5 bg-black/50 text-gray-500 border border-white/10 hover:border-accent/50 cursor-pointer"
                >
                  <Lock className="w-2.5 h-2.5" />
                  2–{TOTAL_BARS}
                </button>
              </div>
            )}
            <div
              className={BAR_BOX}
              role="group"
              aria-label="Jendela tampilan grid"
              title={`Sedang menampilkan Bar ${viewStartBar + 1}–${viewStartBar + barsPerView} dari ${TOTAL_BARS} (${timeSig.label})`}
            >
              <div className="flex items-center gap-1.5" title="Banyak bar yang ditampilkan (1–8). Ketik angka atau pakai tombol atas-bawah.">
                <span className="text-gray-400">Tampil</span>
                <SpinField min={1} max={isUnlocked8Bar ? MAX_BARS_PER_VIEW : FREE_MAX_BARS} value={barsPerView} onChange={changeBarsPerView} ariaLabel="Banyak bar yang ditampilkan" />
              </div>
            </div>
            <div className={BAR_BOX_GROW} title="Rentang loop: dari Bar / Step awal sampai Bar / Step akhir">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wide">Loop</span>
              <span className="text-[10px] text-gray-400">Bar</span>
              <SpinField min={1} max={isUnlocked8Bar ? TOTAL_BARS : FREE_MAX_BARS} value={loopStartBar} onChange={(v) => changeLoopStart(v, loopStartBeat)} ariaLabel="Loop mulai bar" />
              <span className="text-[10px] text-gray-400">Step</span>
              <SpinField min={1} max={stepsPerBar} value={loopStartBeat} onChange={(v) => changeLoopStart(loopStartBar, v)} ariaLabel="Loop mulai step" />
              <span className="text-gray-500">—</span>
              <span className="text-[10px] text-gray-400">Bar</span>
              <SpinField min={1} max={isUnlocked8Bar ? TOTAL_BARS : FREE_MAX_BARS} value={loopEndBar} onChange={(v) => changeLoopEnd(v, loopEndBeat)} ariaLabel="Loop sampai bar" />
              <span className="text-[10px] text-gray-400">Step</span>
              <SpinField min={1} max={stepsPerBar} value={loopEndBeat} onChange={(v) => changeLoopEnd(loopEndBar, v)} ariaLabel="Loop sampai step" />
            </div>
            {!isUnlocked8Bar && (
              <button type="button" onClick={onUnlockEditor} className="shrink-0 text-[11px] text-accent hover:underline font-semibold cursor-pointer">
                Buka 64-Bar →
              </button>
            )}
            <div
              className={BAR_BOX_GROW}
              title="Posisi playhead. Ketik angka atau pakai tombol atas-bawah untuk pindah posisi. Aktifkan Ikuti agar grid ikut berpindah."
            >
              <span className="text-[11px] font-bold text-accent uppercase tracking-wide">Pos</span>
              <span className="text-[10px] text-gray-400">Bar</span>
              <div className="flex items-stretch">
                <input
                  ref={posBarRef}
                  type="number"
                  min={1}
                  max={TOTAL_BARS}
                  defaultValue={1}
                  onChange={seekToPosition}
                  onBlur={syncPositionFields}
                  aria-label="Posisi bar"
                  className="w-9 bg-black/80 rounded-l-lg border border-white/15 px-0.5 py-1 text-sm font-mono font-bold text-accent text-center outline-none focus:border-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <SpinButtons
                  label="Posisi bar"
                  onUp={() => nudgePosition(posBarRef.current, 1, 1, TOTAL_BARS)}
                  onDown={() => nudgePosition(posBarRef.current, -1, 1, TOTAL_BARS)}
                />
              </div>
              <span className="text-[10px] text-gray-400">Step</span>
              <div className="flex items-stretch">
                <input
                  ref={posStepRef}
                  type="number"
                  min={1}
                  max={stepsPerBar}
                  defaultValue={1}
                  onChange={seekToPosition}
                  onBlur={syncPositionFields}
                  aria-label="Posisi step"
                  className="w-9 bg-black/80 rounded-l-lg border border-white/15 px-0.5 py-1 text-sm font-mono font-bold text-accent text-center outline-none focus:border-accent [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <SpinButtons
                  label="Posisi step"
                  onUp={() => nudgePosition(posStepRef.current, 1, 1, stepsPerBar)}
                  onDown={() => nudgePosition(posStepRef.current, -1, 1, stepsPerBar)}
                />
              </div>
              <button
                type="button"
                onClick={jumpToPlayhead}
                title="Tampilkan halaman grid yang memuat posisi ini"
                className="px-2 py-1 rounded-lg border border-white/10 bg-white/5 hover:bg-white/15 text-gray-200 font-bold cursor-pointer"
              >
                Lihat
              </button>
            </div>
            <button
              type="button"
              onClick={() => setFollowPlayhead((f) => !f)}
              aria-pressed={followPlayhead}
              title="Halaman grid otomatis mengikuti playhead saat diputar"
              className={`shrink-0 px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                followPlayhead ? 'bg-accent/20 text-accent border-accent/40' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
              }`}
            >
              Ikuti
            </button>
            <div className={BAR_BOX}>
              <button
                type="button"
                onClick={() => shiftView(-1)}
                disabled={viewStartBar <= 0}
                title={`Geser ${shiftBars} bar ke kiri`}
                aria-label="Geser ke kiri"
                className="p-1.5 rounded-lg bg-white/5 hover:bg-accent hover:text-on-accent text-gray-200 border border-white/10 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <SpinField min={1} max={MAX_SHIFT_BARS} value={shiftBars} onChange={setShiftBars} ariaLabel={`Jumlah bar sekali geser (maksimal ${MAX_SHIFT_BARS})`} />
              <button
                type="button"
                onClick={() => shiftView(1)}
                disabled={viewStartBar >= TOTAL_BARS - barsPerView}
                title={`Geser ${shiftBars} bar ke kanan`}
                aria-label="Geser ke kanan"
                className="p-1.5 rounded-lg bg-white/5 hover:bg-accent hover:text-on-accent text-gray-200 border border-white/10 transition-colors disabled:opacity-40 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 rounded-xl bg-black/40 border border-white/[0.06] p-3">
            {/* Baris 1: mode & edit. Semua tombol melebar rata mengisi lebar toolbar. */}
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="flex flex-[1.4] items-stretch min-w-[min(200px,100%)] bg-black/60 border border-white/10 rounded-lg p-0.5" role="tablist" aria-label="Mode editor">
                {([
                  { id: 'edit', label: 'Edit', Icon: Pencil, tip: 'Klik sel untuk memasang / mengubah' },
                  {
                    id: 'select',
                    label: 'Pilih',
                    Icon: BoxSelect,
                    tip: 'Ketuk atau seret untuk memilih area. Tahan Shift untuk MENAMBAH ke pilihan tanpa melepas yang sebelumnya. Ketuk pad terpilih untuk melepasnya.',
                  },
                ] as const).map(({ id, label, Icon, tip }) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={editMode === id}
                    title={tip}
                    onClick={() => setEditMode(id)}
                    className={`flex flex-1 items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                      editMode === id ? 'bg-accent text-on-accent shadow' : 'text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={addMode && editMode === 'select'}
                onClick={() => {
                  if (editMode !== 'select') {
                    setEditMode('select');
                    setAddMode(true);
                  } else setAddMode((v) => !v);
                }}
                title="Saklar Tambah (untuk HP / tanpa Shift): aktif = memilih MENAMBAH ke pilihan sebelumnya, nonaktif = pilihan baru menggantikan yang lama"
                className={`${TOOL_BTN} ${addMode && editMode === 'select' ? TOOL_BTN_ON : 'bg-black/60 text-gray-300 border-white/10 hover:border-white/25'}`}
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span>Tambah</span>
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={freeSel}
                onClick={() => setFreeSel((v) => !v)}
                title="Pilih Bebas: klik 2x = satu beat, klik 3x = satu bar, dihitung mulai dari step yang pertama diklik (bukan dari garis beat / bar)"
                className={`${TOOL_BTN} ${freeSel ? TOOL_BTN_ON : 'bg-black/60 text-gray-300 border-white/10 hover:border-white/25'}`}
              >
                <MousePointer2 className="w-4 h-4 shrink-0" />
                <span>Bebas</span>
              </button>

              <span aria-hidden="true" className="hidden lg:block w-px self-stretch bg-white/10" />

              <div className="contents">
                <ToolBtn icon={Undo2} label="Undo" title="Ctrl+Z" onClick={undo} disabled={!canUndo} />
                <ToolBtn icon={Redo2} label="Redo" title="Ctrl+Shift+Z atau Ctrl+Y" onClick={redo} disabled={!canRedo} />
              </div>

              <span aria-hidden="true" className="hidden lg:block w-px self-stretch bg-white/10" />

              <div className="contents">
                <ToolBtn
                  icon={Layers}
                  label="Semua"
                  title={activeTab === 'drum' ? 'Ctrl+A — pilih semua bagian drum (klik lagi untuk melepas)' : 'Ctrl+A — pilih semua instrumen akor (klik lagi untuk melepas)'}
                  onClick={() => selectAll(true)}
                />
                <ToolBtn
                  icon={SplitNoteIcon}
                  label="Belah"
                  title={
                    activeTab === 'chord'
                      ? 'Belah not akor yang panjang jadi dua bagian sama panjang (bisa ditekan lagi untuk membelah lebih kecil)'
                      : 'Belah hanya untuk not akor di Chord Pad (pad drum tidak punya panjang not)'
                  }
                  onClick={splitSelection}
                  disabled={!canSplit}
                />
                <ToolBtn icon={Scissors} label="Potong" title="Ctrl+X" onClick={cutSelection} disabled={!activeSel} />
                <ToolBtn icon={Copy} label="Salin" title="Ctrl+C" onClick={copySelection} disabled={!activeSel} />
                <ToolBtn icon={ClipboardPaste} label="Tempel" title="Ctrl+V — ditempel di awal pilihan (atau di playhead)" onClick={pasteSelection} disabled={!clips[activeTab]} />
                <ToolBtn
                  icon={CopyPlus}
                  label="Duplikat"
                  title={
                    activeTab === 'chord'
                      ? 'Ctrl+D — salin lalu tempel tepat setelah pilihan. Bila yang dipilih instrumen akor utuh (klik namanya), instrumennya diduplikat ke slot kosong beserta isinya.'
                      : 'Ctrl+D — salin lalu tempel tepat setelah pilihan'
                  }
                  onClick={duplicateSelection}
                  disabled={!activeSel}
                />
                <ToolBtn icon={Trash2} label="Hapus" title="Delete" onClick={deleteSelection} disabled={!activeSel} />
                <ToolBtn icon={X} label="Lepas" title="Esc — batalkan semua pilihan" onClick={clearSelection} disabled={!activeSel} />
              </div>
            </div>

            {/* Baris 2: pemutaran & rekaman. Tombol juga melebar rata. */}
            <div className="flex flex-wrap items-stretch gap-2">
              <div className="flex flex-[2.4] items-stretch gap-1.5 min-w-[min(300px,100%)] bg-black/60 border border-white/10 rounded-lg p-1">
                <button
                  type="button"
                  onClick={() => void togglePlay()}
                  aria-pressed={isPlaying}
                  title={`${isPlaying ? 'Hentikan' : 'Putar'} ${effPlayDrum && effPlayChord ? 'Drum + Akor' : effPlayChord ? 'Akor' : 'Drum'} (loop)`}
                  className={`flex flex-1 items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                    isPlaying ? 'bg-accent text-on-accent border-accent shadow-md' : 'bg-white/5 text-gray-200 border-white/10 hover:bg-white/10'
                  }`}
                >
                  {isPlaying ? <Square className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                  <span>{isPlaying ? 'Stop' : 'Putar'}</span>
                </button>
                <div className="flex flex-[1.3] items-stretch gap-1.5 pl-1.5 border-l border-white/10" role="group" aria-label="Bagian yang diputar">
                  {PLAY_PARTS.map(({ id, label, Icon, tip }) => {
                    const on = id === 'drum' ? effPlayDrum : effPlayChord;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        title={tip}
                        onClick={() => togglePlayPart(id)}
                        className={`flex flex-1 items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
                          on ? 'bg-accent text-on-accent shadow' : 'text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                type="button"
                onClick={resetToBeginning}
                title="Mulai dari awal wilayah loop"
                className={`${TOOL_BTN} ${TOOL_BTN_IDLE}`}
              >
                <RotateCcw className="w-4 h-4 shrink-0" />
                <span>Awal</span>
              </button>
              <button
                type="button"
                onClick={() => setIsSeqLooping(!isSeqLooping)}
                aria-pressed={isSeqLooping}
                title={isSeqLooping ? 'Ulangi (loop) aktif: klik untuk mematikan' : 'Ulangi (loop) mati: klik untuk menyalakan'}
                className={`${TOOL_BTN} ${isSeqLooping ? TOOL_BTN_ON : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}
              >
                <Repeat className="w-4 h-4 shrink-0" />
                <span>Ulangi</span>
              </button>
              <button
                type="button"
                onClick={toggleRecording}
                aria-pressed={isRecording || countdownLeft !== null}
                title={
                  countdownLeft !== null
                    ? 'Batalkan hitung mundur rekaman'
                    : isRecording
                    ? 'Hentikan rekaman'
                    : 'Rekam: pukulan pad drum dan akor yang kamu mainkan masuk ke sequencer'
                }
                className={`${TOOL_BTN} ${
                  countdownLeft !== null
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
                    : isRecording
                    ? 'bg-red-500/20 text-red-300 border-red-500/60'
                    : 'bg-black/60 text-gray-300 border-white/10 hover:border-white/25'
                }`}
              >
                <Circle
                  className={`w-4 h-4 shrink-0 ${
                    isRecording || countdownLeft !== null ? 'fill-red-500 text-red-500 animate-pulse' : 'fill-red-500/80 text-red-500/80'
                  }`}
                />
                <span>{countdownLeft !== null ? `Batal (${countdownLeft})` : isRecording ? 'Stop Rekam' : 'Rekam'}</span>
              </button>
              <label
                className="flex flex-1 items-center justify-center gap-2 min-w-[min(110px,100%)] px-3 py-2 rounded-lg text-xs font-bold text-gray-300 bg-black/60 border border-white/10"
                title="Hitung mundur sebelum rekaman dimulai (0–15 detik; 0 = langsung mulai)"
              >
                <Timer className="w-4 h-4 text-gray-400" />
                <IntField
                  value={recCountdownSec}
                  min={0}
                  max={15}
                  onChange={setRecCountdownSec}
                  disabled={isRecording || countdownLeft !== null}
                  ariaLabel="Hitung mundur sebelum rekam (detik, maksimal 15)"
                  className="w-10 bg-black/80 rounded-md border border-white/15 px-1 py-0.5 text-xs font-mono text-accent text-center outline-none focus:border-accent disabled:opacity-50"
                />
                <span className="font-mono text-gray-400">dtk</span>
              </label>
              <button
                type="button"
                onClick={() => setMetronomeOn((v) => !v)}
                aria-pressed={metronomeOn}
                title="Metronom: klik ketukan saat memutar dan merekam"
                className={`${TOOL_BTN} ${metronomeOn ? TOOL_BTN_ON : 'bg-white/5 text-gray-400 border-white/10 hover:bg-white/10'}`}
              >
                <Activity className="w-4 h-4 shrink-0" />
                <span>Metronom</span>
              </button>
              <button
                type="button"
                onClick={handleClearGrid}
                title="Bersihkan Grid: hapus seluruh isi pola"
                className={`${TOOL_BTN} ${TOOL_BTN_IDLE} hover:text-white`}
              >
                <Eraser className="w-4 h-4 shrink-0 text-red-400" />
                <span>Bersihkan Grid</span>
              </button>
              <button
                type="button"
                onClick={() => setIsFxOpen(true)}
                aria-haspopup="dialog"
                title="Efek: Equalizer, Reverb, Delay, Chorus, Filter, Distortion, Limiter (per bagian drum / instrumen, atau semuanya)"
                className={`${TOOL_BTN} ${fxCount > 0 ? TOOL_BTN_ON : `${TOOL_BTN_IDLE} hover:text-white`}`}
              >
                <FxPedalIcon className="w-4 h-4 shrink-0" />
                <span>Efek</span>
                {fxCount > 0 && (
                  <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-accent text-on-accent text-[10px] font-black flex items-center justify-center">
                    {fxCount}
                  </span>
                )}
              </button>
            </div>

            {/* Baris 3: status pilihan (kiri) dan kontrol panjang akor + bantuan (kanan). */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-white/[0.06]">
              <div className="flex items-center gap-3">
                {isRecording && (
                  <span className="flex items-center gap-1 text-xs font-mono font-bold text-red-300">
                    <Circle className="w-3 h-3 fill-red-500 text-red-500 animate-pulse" />
                    Merekam
                  </span>
                )}
                <span className="text-xs font-mono text-gray-300">{selectionLabel}</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3">
                {activeTab === 'chord' && chordLenControls}
                <InfoTip title="Cara memakai sequencer">
          {activeTab === 'drum' ? (
            dynamicsOn ? (
              <p>
                <b className="text-gray-100">Edit:</b> klik pad untuk menaikkan dinamika bertahap sesuai tingkat yang dipilih (6: pp → p → mp
                → mf → f → ff, 4: p → mp → mf → f, 2: p → f), lalu kosong. Klik kanan (atau tahan lama di HP) untuk memilih dinamika
                langsung. Warna makin pekat = makin keras.
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
            <b className="text-gray-100">Pilih:</b> ketuk atau seret untuk memilih area (klik label BAR dan nama baris juga hanya memilih di mode ini); memilih lagi menggantikan pilihan sebelumnya.
            Ketuk pad yang sudah terpilih untuk melepasnya. Tahan <b className="text-gray-100">Shift</b> (atau nyalakan saklar{' '}
            <b className="text-gray-100">Tambah</b> di HP) untuk menambahkan pad atau area ke pilihan tanpa melepas yang lama (ketuk pad
            terpilih = lepas). Shift+seret di mode Edit juga memilih area.
          </p>
          <p>
            <b className="text-gray-100">Pindahkan:</b> di mode Pilih, seret salah satu pad yang sudah terpilih ke tempat lain; seluruh
            pilihan ikut berpindah dan dijatuhkan saat dilepas (bisa pindah baris maupun antar bar). Satu pemindahan = satu langkah Undo.
          </p>
          <p>
            {activeTab === 'drum'
              ? 'Klik nama drum (Kick, Snare, …) untuk memilih seluruh instrumen drum itu; tombol Semua memilih semua bagian drum.'
              : 'Klik nama progresi akor untuk memilih seluruh instrumen itu; tombol Semua memilih semua instrumen akor.'}
          </p>
          <p>
            <b className="text-gray-100">Salin ke instrumen lain:</b> Salin pilihan, klik nama instrumen tujuan, lalu Tempel.
            {activeTab === 'chord' && (
              <>
                {' '}
                <b className="text-gray-100">Duplikat instrumen:</b> tombol Duplikat di bawah nama instrumen (atau Duplikat saat instrumen
                utuh terpilih) membuat instrumen baru lengkap dengan isi, suara, volume, dan ADSR-nya (maksimal 4 instrumen).{' '}
                <b className="text-gray-100">Ganti nama &amp; urutan:</b> ikon pensil (atau klik dua kali nama) mengganti nama progresi;
                tombol panah atas / bawah menukar urutannya; tombol Hapus menghapus progresi (minimal satu harus tersisa).
              </>
            )}
          </p>
          <p>
            <b className="text-gray-100">Putar:</b> tombol Putar memutar bagian yang dicentang di sebelahnya: Drum, Akor, atau
            keduanya (minimal satu harus aktif). Pilihan boleh diganti saat sedang diputar. Metronom (bila aktif) ikut berbunyi.
          </p>
          <p>
            Di mode Pilih, klik label BAR untuk memilih satu bar (dengan Shift, bar ditambahkan ke pilihan; Shift juga berlaku di mode Edit). Klik area kosong di luar pad untuk melepas semua
            pilihan.
          </p>
          <p>
            <b className="text-gray-100">Pintasan:</b> Ctrl+Z / Ctrl+Shift+Z untuk undo / redo; Ctrl+C / X / V / D untuk salin, potong,
            tempel, duplikat; Delete untuk hapus; Esc untuk melepas pilihan.
          </p>
        </InfoTip>
              </div>
            </div>
          </div>

          <div
            ref={sequencerScrollRef}
            className="overflow-x-auto pt-2 pb-4 px-3"
            style={{ scrollbarWidth: 'thin', ...(editMode !== 'edit' ? { touchAction: 'none' } : {}) }}
            onPointerDown={handleGridPointerDown}
            onMouseDownCapture={(e) => {
              if ((modeRef.current !== 'edit' || e.shiftKey) && (e.target as HTMLElement).closest('[data-rowgrid], [data-ruler]')) e.preventDefault();
            }}
            onClickCapture={(e) => {
              if ((modeRef.current !== 'edit' || e.shiftKey) && (e.target as HTMLElement).closest('[data-rowgrid], [data-ruler]')) {
                e.stopPropagation();
                e.preventDefault();
              }
            }}
          >
            <div className="space-y-2" style={{ minWidth: gridMinWidth }}>
              <div className="relative" ref={seqWrapRef}>
              <div className="space-y-2">
              <div className="flex items-stretch border border-transparent">
                <div className={`${labelWidth(showMixer)} shrink-0 border-r border-transparent flex items-center text-[10px] font-mono font-bold text-gray-500 uppercase tracking-wider pl-4`}>
                  SEGMEN BAR
                </div>
                <div className="grid gap-0.5 flex-1 min-w-0 pl-2 pr-0" style={gridStyle}>
                  {windowBars.map((barIdx) => (
                    <div
                      key={barIdx}
                      style={{ gridColumn: `span ${stepsPerBar} / span ${stepsPerBar}` }}
                      data-keepsel=""
                      onClick={(e) => {
                        if (editMode === 'select' || e.shiftKey) selectBar(barIdx, e.shiftKey);
                      }}
                      title={
                        editMode === 'select'
                          ? 'Klik untuk memilih seluruh bar ini (Shift+klik = tambahkan / lepas dari pilihan)'
                          : 'Pindah ke mode Pilih (atau tahan Shift) untuk memilih seluruh bar ini'
                      }
                      className={`py-1.5 rounded-md border text-center text-xs font-mono font-bold bg-surface text-accent border-accent/30 select-none ${
                        editMode === 'select' ? 'cursor-pointer hover:bg-accent/10' : 'cursor-default'
                      }`}
                    >
                      BAR {barIdx + 1}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-stretch border border-transparent">
                <div className={`${labelWidth(showMixer)} shrink-0 border-r border-transparent pr-2 flex items-center`}>
                <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-xl px-1.5 py-1 w-full min-w-0">
                  <button
                    type="button"
                    onClick={() => setShowMixer((v) => !v)}
                    aria-pressed={showMixer}
                    title="Tampilkan / sembunyikan volume & ADSR"
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border transition-colors cursor-pointer shrink-0 ${
                      showMixer ? 'bg-accent/20 text-accent border-accent/40' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/15'
                    }`}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    <span>Mixer</span>
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
                    <IntField
                      value={activeTab === 'drum' ? drumVolume : chordMasterVolume}
                      min={0}
                      max={100}
                      onChange={activeTab === 'drum' ? setDrumVolume : setChordMasterVolume}
                      ariaLabel={activeTab === 'drum' ? 'Volume drum utama (ketik angka 0–100)' : 'Volume akor utama (ketik angka 0–100)'}
                      className="w-9 shrink-0 bg-black/80 rounded border border-white/15 px-0.5 py-0.5 text-[10px] font-mono text-accent text-center outline-none focus:border-accent"
                    />
                    <span className="text-[10px] font-mono text-gray-400 shrink-0">%</span>
                  </div>
                </div>
                </div>

                <div className="grid gap-0.5 flex-1 min-w-0 pl-2 pr-0" style={gridStyle} data-ruler="" data-keepsel="">
                  {windowSteps.map((idx) => {
                    const pos = idx % stepsPerBar;
                    const isBeat = beatInfo.isBeatStart[pos];
                    const rulerSel = Boolean(activeSel && rulerSelSteps.has(idx));
                    return (
                      <button
                        key={idx}
                        type="button"
                        data-step={idx}
                        data-seek="1"
                        title={
                          editMode === 'select'
                            ? isBeat
                              ? 'Klik = step · 2x = beat · 3x = bar · seret = beberapa step'
                              : 'Klik = pilih step ini · seret ke samping = pilih beberapa step'
                            : undefined
                        }
                        onClick={() => handleSeekStep(idx)}
                        className={`h-8 rounded-xs text-xs font-mono font-bold transition-colors flex items-center justify-center ${
                          rulerSel
                            ? 'bg-accent/40 text-white ring-1 ring-accent'
                            : isBeat
                              ? 'bg-white/15 text-white hover:bg-white/30'
                              : 'bg-black/50 text-gray-500 hover:bg-white/10'
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
                        dynMode={drumDynMode}
                        dynText={dynText}
                        row={drumGrid[inst.id]}
                        steps={windowSteps}
                        stepsPerBar={stepsPerBar}
                        beatMask={beatInfo.isBeatStart}
                        gridStyle={gridStyle}
                        selSteps={rowSelSets[di] ?? null}
                        onCycle={cycleDrumStep}
                        onMenu={openDrumPicker}
                        onSelectRow={onSelectRow}
                        rowSelected={Boolean(rowFullSel[di])}
                        pickMode={editMode === 'select'}
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
                        dynamics={chordDynamicsOn}
                        dynMode={chordDynMode}
                        dynText={chordDynText}
                        onLevelCycle={cycleChordLevel}
                        onLevelMenu={openChordPicker}
                        onUpdateTrack={updateTrack}
                        onUpdateAdsr={updateTrackAdsr}
                        onPickInstrument={openInstrumentPicker}
                        onRemove={removeTrack}
                        onSelectRow={onSelectRow}
                        rowSelected={Boolean(rowFullSel[tIdx])}
                        pickMode={editMode === 'select'}
                        canDuplicate={chordTracks.some((t) => !t.enabled)}
                        onDuplicate={onDuplicateTrack}
                        canRemove={enabledChordIdx.length > 1}
                        onRename={renameTrack}
                        onMove={moveTrack}
                        canMoveUp={!isRecording && enabledChordIdx.indexOf(tIdx) > 0}
                        canMoveDown={!isRecording && enabledChordIdx.indexOf(tIdx) < enabledChordIdx.length - 1}
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
                </div>
              )}
              </div>

              {/* Area main (rentang loop) ditimpa di atas ruler + semua baris, seperti locator di DAW:
                  area di dalam rentang disorot, di luar rentang digelapkan. Mengikuti jendela bar yang tampil. */}
              {(() => {
                // Sama persis dengan yang dimainkan scheduler: awal <= akhir, dijepit ke panjang yang bisa diputar.
                const playable = isUnlocked8Bar ? totalSteps : stepsPerBar;
                const rawA = loopPos(loopStartBar, loopStartBeat);
                const rawB = loopPos(loopEndBar, loopEndBeat);
                const hi = Math.max(0, Math.min(playable - 1, Math.max(rawA, rawB)));
                const lo = Math.max(0, Math.min(Math.min(rawA, rawB), hi));
                const winStart = viewStartBar * stepsPerBar;
                const winEnd = winStart + viewSteps - 1;
                const vLo = Math.max(lo, winStart);
                const vHi = Math.min(hi, winEnd);
                const title = `Area main: Bar ${Math.floor(lo / stepsPerBar) + 1} Step ${(lo % stepsPerBar) + 1} sampai Bar ${Math.floor(hi / stepsPerBar) + 1} Step ${(hi % stepsPerBar) + 1}`;
                const hasArea = vLo <= vHi;
                const startIn = hasArea && lo >= winStart && loopX.x1 !== null;
                const endIn = hasArea && hi <= winEnd && loopX.x2 !== null;
                // Isi area main: dari garis awal (atau tepi kiri grid bila awal di luar jendela) sampai garis akhir
                // (atau tepi kanan grid). Garis batas berada di tengah celah antar pad, bukan di dalam pad.
                const fillL = startIn ? (loopX.x1 as number) : 0;
                const fillR = endIn ? (loopX.x2 as number) : loopX.w;
                const lineW = Math.max(2, loopX.gap);
                return (
                  <div
                    aria-hidden="true"
                    title={title}
                    className="absolute top-0 bottom-0 z-[5] pointer-events-none"
                    style={
                      loopBox
                        ? { left: loopBox.left, right: loopBox.right }
                        : { left: `calc(${showMixer ? '16rem' : '13rem'} + 1px + 0.5rem)`, right: 1 }
                    }
                  >
                    <div ref={loopGridRef} className="relative w-full h-full">
                      {!hasArea ? (
                        <div className="absolute inset-0 bg-black/30" />
                      ) : (
                        <>
                          {fillL > 0 && <div className="absolute top-0 bottom-0 left-0 bg-black/30" style={{ width: fillL }} />}
                          <div
                            className="absolute top-0 bottom-0 bg-accent/[0.14] border-y-2 border-accent/60"
                            style={{ left: fillL, width: Math.max(0, fillR - fillL) }}
                          />
                          {fillR < loopX.w && (
                            <div className="absolute top-0 bottom-0 bg-black/30" style={{ left: fillR, right: 0 }} />
                          )}
                          {startIn && (
                            <>
                              <div
                                className="absolute top-0 bottom-0 bg-accent"
                                style={{ left: fillL - lineW / 2, width: lineW }}
                              />
                              <div
                                onPointerDown={startLoopDrag('start')}
                                title="Seret untuk memindahkan awal area main"
                                className="pointer-events-auto absolute top-0 h-24 w-3 cursor-ew-resize touch-none flex items-start justify-center z-10"
                                style={{ left: fillL - 6 }}
                              >
                                <div className="mt-1 w-1.5 h-6 rounded-sm bg-accent ring-1 ring-black/50 shadow" />
                              </div>
                            </>
                          )}
                          {endIn && (
                            <>
                              <div
                                className="absolute top-0 bottom-0 bg-accent"
                                style={{ left: fillR - lineW / 2, width: lineW }}
                              />
                              <div
                                onPointerDown={startLoopDrag('end')}
                                title="Seret untuk memindahkan akhir area main"
                                className="pointer-events-auto absolute top-0 h-24 w-3 cursor-ew-resize touch-none flex items-start justify-center z-10"
                                style={{ left: fillR - 6 }}
                              >
                                <div className="mt-1 w-1.5 h-6 rounded-sm bg-accent ring-1 ring-black/50 shadow" />
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}
              </div>

              {activeTab === 'chord' && chordTracks.some((t) => !t.enabled) && (
                <button
                  type="button"
                  onClick={addChordTrack}
                  className="w-full flex items-center justify-center gap-1.5 py-3 rounded-xl border border-dashed border-accent/50 text-accent text-xs font-bold hover:bg-accent/10 cursor-pointer transition-colors"
                >
                  {isUnlocked8Bar ? <Plus className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
                  <span>Tambah baris instrumen ({chordTracks.filter((t) => t.enabled).length + 1}/4)</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {drumPicker && (
        <DrumLevelPicker
          x={drumPicker.x}
          y={drumPicker.y}
          mode={drumDynMode}
          current={snapLevel(clampLevel(drumGrid[drumPicker.drumId]?.[drumPicker.stepIdx]), drumDynMode)}
          onClose={closeDrumPicker}
          onPick={(lv) => {
            setDrumLevel(drumPicker.drumId, drumPicker.stepIdx, lv);
            setDrumPicker(null);
          }}
        />
      )}

      {chordPicker && activeTab === 'chord' && chordDynamicsOn && (
        <DrumLevelPicker
          x={chordPicker.x}
          y={chordPicker.y}
          mode={chordDynMode}
          current={snapLevel(clampLevel(chordTracks[chordPicker.trackIdx]?.vels?.[chordPicker.start]), chordDynMode)}
          heading="Dinamika akor"
          ariaLabel="Pilih dinamika akor"
          clearLabel="Normal (tanpa dinamika)"
          clearIcon="reset"
          onClose={closeChordPicker}
          onPick={(lvl) => {
            setChordNoteLevel(chordPicker.trackIdx, chordPicker.start, lvl);
            setChordPicker(null);
          }}
        />
      )}

      <InstrumentPickerModal
        isOpen={pickerTrack !== null}
        title={pickerTrack !== null ? chordTracks[pickerTrack]?.label ?? '' : ''}
        currentProgram={pickerTrack !== null ? chordTracks[pickerTrack]?.program ?? 0 : 0}
        isUnlocked={Boolean(isUnlocked8Bar)}
        freePrograms={FREE_CHORD_PROGRAMS}
        onSelect={(program) => {
          if (!isUnlocked8Bar && !FREE_CHORD_PROGRAMS.includes(program)) {
            onUnlockEditor();
            return;
          }
          if (pickerTrack !== null) updateTrack(pickerTrack, { program });
          setPickerTrack(null);
        }}
        onLockedClick={onUnlockEditor}
        onClose={() => setPickerTrack(null)}
      />

      {editingPadIndex !== null && (
        <ModalPortal>
          <div className="bg-surface border border-white/20 rounded-2xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto overscroll-contain shadow-2xl p-4 sm:p-6 space-y-5">
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
                onClick={() => void openExportModal('drum')}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Disc className="w-4 h-4 text-accent" />
                <span>Hanya Pola Drum</span>
              </button>
              <button
                type="button"
                onClick={() => void openExportModal('chord')}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Music className="w-4 h-4 text-accent" />
                <span>4 Instrumen Akor</span>
              </button>
              <button
                type="button"
                onClick={() => void openExportModal('both')}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Layers className="w-4 h-4 text-accent" />
                <span>Drum + Semua Instrumen Akor</span>
              </button>
            </div>
          </div>
        </ModalPortal>
      )}

      {isFxOpen && (
        <PadEffectsModal
          onClose={() => setIsFxOpen(false)}
          fx={fx}
          onChange={setFx}
          initialDomain={activeTab}
          drumParts={DRUM_INSTRUMENTS.map((d) => ({ id: d.id, label: d.label }))}
          chordTracks={chordTracks.filter((t) => t.enabled).map((t) => ({ id: t.id, label: t.label }))}
          isPlaying={isPlaying}
          onTogglePlay={() => void togglePlay()}
          onAudition={auditionFx}
        />
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
        project={isExportModalOpen ? snapshotProject() : undefined}
        effects={fx}
        authorize={() => requireServerAccess('export')}
        onAccessDenied={handleServerDenied}
        onSuccessToast={onSuccessToast}
      />
      <div className="pt-3">
        <SoundBankCredits />
      </div>
    </section>
  );
};
