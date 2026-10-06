// src/components/AudioStudio/PadStudio.tsx
import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
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
import { ModalPortal } from './ModalPortal';
import { AdsrMini, AdsrRanges, IntField } from './NumberFields';
import { InstrumentPickerModal } from './InstrumentPickerModal';
import {
  DRUM_LEVEL_MAX,
  DRUM_LEVEL_LABEL,
  DRUM_LEVEL_GAIN,
  DRUM_LEVEL_CELL_CLASS,
  clampLevel,
  emptyTrackData,
  listNotes,
  noteStartCovering,
  insertNote,
  removeNote,
  resizeNote,
  remapTrackData,
  makeRect,
  ChordNote,
  SelRect,
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
// Nilai = level kekuatan 0–4 (kick/snare "keras", hi-hat "normal").
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
  selectedDrumKit: string;
  drumVolume: number;
  chordMasterVolume: number;
  loopStartBar: number;
  loopStartBeat: number;
  loopEndBar: number;
  loopEndBeat: number;
}

const SEL_CLASS = 'outline outline-2 outline-sky-300 -outline-offset-2';

const DrumCell = memo(function DrumCell({
  drumId,
  stepIdx,
  level,
  selected,
  beat,
  onPaint,
}: {
  drumId: string;
  stepIdx: number;
  level: number;
  selected: boolean;
  beat: boolean;
  onPaint: (drumId: string, stepIdx: number) => void;
}) {
  return (
    <button
      type="button"
      data-step={stepIdx}
      data-level={level}
      title={`Kekuatan: ${DRUM_LEVEL_LABEL[level]}`}
      onClick={() => onPaint(drumId, stepIdx)}
      className={`h-7 rounded-xs transition-colors relative flex items-center justify-center cursor-pointer ${
        level > 0
          ? `${DRUM_LEVEL_CELL_CLASS[level]} text-on-accent font-bold`
          : beat
          ? 'bg-black/35 hover:bg-black/70 border border-white/[0.09]'
          : 'bg-black/60 hover:bg-black/90 border border-white/[0.05]'
      } ${selected ? SEL_CLASS : ''}`}
    />
  );
});

// Lebar kolom label di sisi kiri semua baris sequencer (nama + mixer ringkas).
const LABEL_W = 'w-52';

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

// Kolom label baris drum: nama + M/S, di bawahnya volume, di bawahnya ADSR (bisa dilipat).
const DrumLabel = memo(function DrumLabel({
  id,
  label,
  mix,
  onMix,
  onAdsr,
}: {
  id: string;
  label: string;
  mix: DrumMixState;
  onMix: (id: string, patch: Partial<DrumMixState>) => void;
  onAdsr: (id: string, patch: Partial<EnvelopeADSR>) => void;
}) {
  const [adsrOpen, setAdsrOpen] = useState(false);
  return (
    <div className={`${LABEL_W} shrink-0 px-1 py-1 space-y-1`}>
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-xs font-semibold text-gray-200 truncate">{label}</span>
        <MuteSoloButtons
          muted={mix.muted}
          solo={mix.solo}
          onMute={() => onMix(id, { muted: !mix.muted })}
          onSolo={() => onMix(id, { solo: !mix.solo })}
        />
      </div>
      <div className="flex items-center">
        <MiniVolume value={mix.volume} onChange={(v) => onMix(id, { volume: v })} title={`Volume ${label}`} />
      </div>
      <AdsrToggle open={adsrOpen} onClick={() => setAdsrOpen((o) => !o)} />
      {adsrOpen && <AdsrMini adsr={mix.adsr} ranges={DRUM_ADSR_RANGES} onChange={(p) => onAdsr(id, p)} />}
    </div>
  );
});

// Kolom label baris akor: nama progresi + nama instrumen (klik untuk ganti), di bawahnya volume + M/S, lalu ADSR.
const ChordLabel = memo(function ChordLabel({
  tIdx,
  track,
  instName,
  onUpdateTrack,
  onUpdateAdsr,
  onPickInstrument,
  onRemove,
}: {
  tIdx: number;
  track: ChordTrackState;
  instName: string;
  onUpdateTrack: (trackIndex: number, updates: Partial<ChordTrackState>) => void;
  onUpdateAdsr: (trackIndex: number, patch: Partial<EnvelopeADSR>) => void;
  onPickInstrument: (trackIndex: number) => void;
  onRemove: (trackIndex: number) => void;
}) {
  const [adsrOpen, setAdsrOpen] = useState(true);
  return (
    <div className={`${LABEL_W} shrink-0 px-1 py-1 space-y-1`}>
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
        {tIdx > 0 && (
          <button
            type="button"
            onClick={() => onRemove(tIdx)}
            title={`Hapus ${track.label}`}
            className="p-0.5 rounded text-gray-500 hover:text-red-400 hover:bg-white/5 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <MiniVolume value={track.volume} onChange={(v) => onUpdateTrack(tIdx, { volume: v })} title={`Volume ${track.label}`} />
        <MuteSoloButtons
          muted={track.muted}
          solo={track.solo}
          onMute={() => onUpdateTrack(tIdx, { muted: !track.muted })}
          onSolo={() => onUpdateTrack(tIdx, { solo: !track.solo })}
        />
      </div>
      <AdsrToggle open={adsrOpen} onClick={() => setAdsrOpen((o) => !o)} />
      {adsrOpen && <AdsrMini adsr={track.adsr} ranges={CHORD_ADSR_RANGES} onChange={(p) => onUpdateAdsr(tIdx, p)} />}
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
  selS1,
  selS2,
  mix,
  onMix,
  onAdsr,
  onPaint,
}: {
  rowIdx: number;
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
  selS1: number; // -1 = baris ini tidak terpilih
  selS2: number;
  onPaint: (drumId: string, stepIdx: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <DrumLabel id={id} label={label} mix={mix} onMix={onMix} onAdsr={onAdsr} />
      <div className="grid gap-0.5 flex-1" style={gridStyle} data-rowgrid="" data-row={rowIdx}>
        {steps.map((stepIdx) => (
          <DrumCell
            key={stepIdx}
            drumId={id}
            stepIdx={stepIdx}
            level={clampLevel(row?.[stepIdx])}
            selected={selS1 >= 0 && stepIdx >= selS1 && stepIdx <= selS2}
            beat={Boolean(beatMask[stepIdx % stepsPerBar])}
            onPaint={onPaint}
          />
        ))}
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
  if (covered) return <div data-step={stepIdx} style={style} className="h-20 pointer-events-none" />;
  return (
    <div
      data-step={stepIdx}
      style={style}
      className={`h-20 rounded-lg p-1 flex flex-col justify-between items-center transition-colors relative border ${
        selected
          ? `bg-white/15 border-white/30 ${SEL_CLASS}`
          : beat
          ? 'bg-black/35 border-white/[0.09] hover:border-white/20'
          : 'bg-black/60 border-white/[0.05] hover:border-white/20'
      }`}
    >
      <span className="text-[10px] text-gray-400 font-mono font-bold">{posInBar + 1}</span>
      <div className="w-full flex-1 flex flex-col items-center justify-center relative">
        <span className="text-[11px] font-black text-gray-500">-</span>
        <select
          value={-1}
          onChange={(e) => onPick(trackIdx, stepIdx, Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          aria-label={`Pasang akor di step ${posInBar + 1}`}
        >
          {options}
        </select>
      </div>
      <div className="w-1.5 h-1.5 mb-0.5" />
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
  getMode: () => 'edit' | 'select';
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
    if (getMode() === 'select' || e.shiftKey) return; // biarkan gestur seleksi yang bekerja
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
      className={`relative z-[2] h-20 border border-accent bg-accent/25 text-white p-1 flex flex-col justify-between items-center overflow-hidden ${
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
  padInfo,
  options,
  steps,
  stepsPerBar,
  beatMask,
  gridStyle,
  selS1,
  selS2,
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
  padInfo: PadInfo[];
  options: React.ReactNode;
  steps: number[];
  stepsPerBar: number;
  beatMask: boolean[];
  gridStyle: React.CSSProperties;
  selS1: number;
  selS2: number;
  getMode: () => 'edit' | 'select';
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
    <div className="flex items-center gap-2">
      <ChordLabel
        tIdx={tIdx}
        track={track}
        instName={instName}
        onUpdateTrack={onUpdateTrack}
        onUpdateAdsr={onUpdateAdsr}
        onPickInstrument={onPickInstrument}
        onRemove={onRemove}
      />
      <div className="grid gap-0.5 flex-1" style={gridStyle} data-rowgrid="" data-row={tIdx}>
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
              selected={selS1 >= 0 && stepIdx >= selS1 && stepIdx <= selS2}
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
            selected={selS1 >= 0 && n.start >= selS1 && n.start <= selS2}
            options={options}
            getMode={getMode}
            onPick={onPick}
            onResize={onResize}
          />
        ))}
      </div>
    </div>
  );
});

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
  const [masterVolOpen, setMasterVolOpen] = useState(false);


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
  const stepRef = useRef(0); // ketukan BERIKUTNYA yang akan dijadwalkan

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

  const [padChords, setPadChords] = useState<ChordFormulaDef[]>([
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
  ]);

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

  const triggerDrum = (type: DrumInstrument['id']) => {
    const m = drumMix[type];
    audioEngine.playDrumSound(type, selectedDrumKit, (drumVolume / 100) * ((m?.volume ?? 100) / 100), m?.adsr);
    setActivePadAnim(type);
    setTimeout(() => setActivePadAnim(null), 150);
  };

  const triggerChordByIndex = (padIdx: number) => {
    const def = padChords[padIdx];
    if (!def) return;
    const { midiNotes } = buildHarmonicChord(def);
    const mainTrack = chordTracks[0];
    audioEngine.adsr.attack = mainTrack.adsr.attack;
    audioEngine.adsr.decay = mainTrack.adsr.decay;
    audioEngine.adsr.sustain = mainTrack.adsr.sustain;
    audioEngine.adsr.release = mainTrack.adsr.release;

    audioEngine.playChordNotes(midiNotes, mainTrack.program, (mainTrack.volume / 100) * (chordMasterVolume / 100), 1.2);
    setActivePadAnim(`chord-${padIdx}`);
    setTimeout(() => setActivePadAnim(null), 250);
  };

  // ---------------------------------------------------------------------------
  // MODE EDIT / PILIH, KEKUATAN DRUM, PANJANG AKOR BARU
  // ---------------------------------------------------------------------------
  const [editMode, setEditMode] = useState<'edit' | 'select'>('edit');
  const modeRef = useRef<'edit' | 'select'>('edit');
  modeRef.current = editMode;
  const getMode = useCallback(() => modeRef.current, []);

  // Kekuatan yang dipasang saat pad drum diklik: 'cycle' = putar 0→1→2→3→4→0, angka = pasang level itu
  // (klik lagi pada level yang sama untuk menghapus).
  const [drumBrush, setDrumBrush] = useState<'cycle' | 1 | 2 | 3 | 4>(3);
  const drumBrushRef = useRef(drumBrush);
  drumBrushRef.current = drumBrush;

  // Panjang default akor yang baru dipasang (dalam step).
  const [newChordLen, setNewChordLen] = useState<number>(INITIAL_STEPS_PER_BAR);
  const newChordLenRef = useRef(newChordLen);
  newChordLenRef.current = newChordLen;

  const paintDrumStep = useCallback((drumId: string, stepIndex: number) => {
    const spb = layoutRef.current.stepsPerBar;
    if (!gateRef.current.isUnlocked8Bar && Math.floor(stepIndex / spb) > 0) {
      gateRef.current.onUnlockEditor();
      return;
    }
    const L = liveRef.current;
    const cur = clampLevel(L?.drumGrid[drumId]?.[stepIndex]);
    const brush = drumBrushRef.current;
    const next = brush === 'cycle' ? (cur + 1) % (DRUM_LEVEL_MAX + 1) : cur === brush ? 0 : brush;
    setDrumGrid((prev) => {
      const row = [...(prev[drumId] || Array(layoutRef.current.totalSteps).fill(0))];
      row[stepIndex] = next;
      return { ...prev, [drumId]: row };
    });
    // Dengarkan kekuatan yang dipasang (hanya saat drum tidak sedang diputar).
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
  // ---------------------------------------------------------------------------
  const [sel, setSel] = useState<SelRect | null>(null);
  const activeSel = sel && sel.tab === activeTab ? sel : null;
  const selRef = useRef<SelRect | null>(null);
  selRef.current = activeSel;
  const anchorRef = useRef<{ r: number; s: number } | null>(null);
  const [clips, setClips] = useState<{ drum: DrumClip | null; chord: ChordClip | null }>({ drum: null, chord: null });
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const sectionRef = useRef<HTMLElement | null>(null);
  const focusInsideRef = useRef(false);
  const modalOpenRef = useRef(false);
  modalOpenRef.current = editingPadIndex !== null || pickerTrack !== null || isExportModalOpen || isExportMenuOpen;
  const activeTabRef = useRef<PadTab>(activeTab);
  activeTabRef.current = activeTab;

  const rowCountOf = (tab: PadTab) => (tab === 'drum' ? DRUM_INSTRUMENTS.length : 4);

  // Rect seleksi; untuk akor, awal rect digeser ke awal not yang menutupi step itu supaya not utuh terpilih.
  const buildRect = (tab: PadTab, a: { r: number; s: number }, b: { r: number; s: number }): SelRect => {
    const rect = makeRect(tab, a, b);
    if (tab === 'chord') {
      const tracks = liveRef.current?.chordTracks ?? [];
      let s1 = rect.s1;
      for (let i = rect.r1; i <= rect.r2; i++) {
        const t = tracks[i];
        if (!t) continue;
        const cs = noteStartCovering(t.steps, t.lens, rect.s1);
        if (cs >= 0 && cs < s1) s1 = cs;
      }
      rect.s1 = s1;
    }
    return rect;
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
    const selecting = modeRef.current === 'select' || e.shiftKey;
    if (!selecting) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const cell = pointToCell(e.clientX, e.clientY);
    if (!cell) return;
    const tab = activeTabRef.current;
    const anchor = e.shiftKey && selRef.current && anchorRef.current ? anchorRef.current : cell;
    anchorRef.current = anchor;
    setSel(buildRect(tab, anchor, cell));
    e.preventDefault();
    const move = (ev: PointerEvent) => {
      const c = pointToCell(ev.clientX, ev.clientY);
      if (c && anchorRef.current) setSel(buildRect(tab, anchorRef.current, c));
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

  // Klik label BAR = pilih seluruh bar itu (Shift+klik = perluas).
  const selectBar = (barIdx: number, extend: boolean) => {
    const tab = activeTabRef.current;
    const S = layoutRef.current.stepsPerBar;
    let s1 = barIdx * S;
    let s2 = s1 + S - 1;
    const prev = selRef.current;
    if (extend && prev) {
      s1 = Math.min(s1, prev.s1);
      s2 = Math.max(s2, prev.s2);
    }
    anchorRef.current = { r: 0, s: s1 };
    setSel({ tab, r1: 0, r2: rowCountOf(tab) - 1, s1, s2 });
  };

  const buildClip = (rect: SelRect): SeqClip | null => {
    const L = liveRef.current;
    if (!L) return null;
    const rows = rect.r2 - rect.r1 + 1;
    const width = rect.s2 - rect.s1 + 1;
    if (rect.tab === 'drum') {
      const data: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const id = DRUM_INSTRUMENTS[rect.r1 + r]?.id;
        const row = (id && L.drumGrid[id]) || [];
        data.push(Array.from({ length: width }, (_, i) => clampLevel(row[rect.s1 + i])));
      }
      return { kind: 'drum', rows, width, data };
    }
    const data: ChordClip['data'] = [];
    for (let r = 0; r < rows; r++) {
      const t = L.chordTracks[rect.r1 + r];
      data.push(
        Array.from({ length: width }, (_, i) => {
          const st = rect.s1 + i;
          return t && t.steps[st] >= 0 ? { pad: t.steps[st], len: t.lens[st] || 1 } : null;
        })
      );
    }
    return { kind: 'chord', rows, width, data };
  };

  const copySelection = (): boolean => {
    const rect = selRef.current;
    if (!rect) return false;
    const clip = buildClip(rect);
    if (!clip) return false;
    const next = { ...clipsRef.current, [clip.kind]: clip } as typeof clips;
    clipsRef.current = next;
    setClips(next);
    return true;
  };

  const deleteSelection = () => {
    const rect = selRef.current;
    if (!rect) return;
    if (rect.tab === 'drum') {
      setDrumGrid((prev) => {
        const out = { ...prev };
        for (let r = rect.r1; r <= rect.r2; r++) {
          const id = DRUM_INSTRUMENTS[r]?.id;
          if (!id) continue;
          const row = [...(prev[id] || [])];
          for (let s = rect.s1; s <= rect.s2; s++) row[s] = 0;
          out[id] = row;
        }
        return out;
      });
    } else {
      setChordTracks((prev) =>
        prev.map((t, ti) => {
          if (ti < rect.r1 || ti > rect.r2 || !t.enabled) return t;
          const steps = [...t.steps];
          const lens = [...t.lens];
          for (let s = rect.s1; s <= rect.s2; s++) {
            steps[s] = -1;
            lens[s] = 0;
          }
          return { ...t, steps, lens };
        })
      );
    }
  };

  const cutSelection = () => {
    if (copySelection()) deleteSelection();
  };

  // Tempel `clip` dengan pojok kiri-atas di (baris r0, step s0). Mengembalikan area yang ditempel.
  const pasteClip = (clip: SeqClip, r0: number, s0: number): SelRect | null => {
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

    if (clip.kind === 'drum') {
      setDrumGrid((prev) => {
        const out = { ...prev };
        for (let r = 0; r < rowsUsed; r++) {
          const id = DRUM_INSTRUMENTS[r0 + r].id;
          const row = [...(prev[id] || Array(total).fill(0))];
          for (let i = 0; i < clip.width && s0 + i < total; i++) row[s0 + i] = clip.data[r][i];
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
          // Not yang menutupi titik tempel dipotong; area tujuan dikosongkan (mode "timpa").
          const cs = noteStartCovering(steps, lens, s0);
          if (cs >= 0 && cs < s0) lens[cs] = s0 - cs;
          for (let s = s0; s <= lastStep; s++) {
            steps[s] = -1;
            lens[s] = 0;
          }
          for (let i = 0; i < clip.width && s0 + i < total; i++) {
            const cell = clip.data[r][i];
            if (cell) ({ steps, lens } = insertNote(steps, lens, s0 + i, cell.pad, cell.len));
          }
          return { ...t, steps, lens };
        })
      );
    }
    return { tab: clip.kind, r1: r0, r2: r0 + rowsUsed - 1, s1: s0, s2: lastStep };
  };

  const pasteSelection = () => {
    const clip = clipsRef.current[activeTabRef.current];
    if (!clip) return;
    const rect = selRef.current;
    const res = pasteClip(clip, rect ? rect.r1 : 0, rect ? rect.s1 : playheadStepRef.current);
    if (res) {
      anchorRef.current = { r: res.r1, s: res.s1 };
      setSel(res);
    }
  };

  // Duplikat: salin pilihan lalu tempel TEPAT setelahnya; pilihan pindah ke hasil, jadi bisa diulang beruntun.
  const duplicateSelection = () => {
    const rect = selRef.current;
    if (!rect) return;
    const clip = buildClip(rect);
    if (!clip) return;
    const res = pasteClip(clip, rect.r1, rect.s2 + 1);
    if (res) {
      anchorRef.current = { r: res.r1, s: res.s1 };
      setSel(res);
    }
  };

  const selectAll = () => {
    const tab = activeTabRef.current;
    anchorRef.current = { r: 0, s: 0 };
    setSel({ tab, r1: 0, r2: rowCountOf(tab) - 1, s1: 0, s2: layoutRef.current.totalSteps - 1 });
  };

  const clearSelection = () => setSel(null);

  // Panjang not akor yang sedang terpilih (untuk kolom angka panjang).
  const selectedNoteInfo = useMemo(() => {
    if (!activeSel || activeSel.tab !== 'chord') return { count: 0, len: 1 };
    let count = 0;
    let len = 1;
    for (let r = activeSel.r1; r <= activeSel.r2; r++) {
      const t = chordTracks[r];
      if (!t || !t.enabled) continue;
      for (let s = activeSel.s1; s <= activeSel.s2; s++) {
        if (t.steps[s] >= 0) {
          if (count === 0) len = t.lens[s] || 1;
          count++;
        }
      }
    }
    return { count, len };
  }, [activeSel, chordTracks]);

  const setSelectedNotesLength = (newLen: number) => {
    const rect = selRef.current;
    if (!rect || rect.tab !== 'chord') return;
    setChordTracks((prev) =>
      prev.map((t, ti) => {
        if (ti < rect.r1 || ti > rect.r2 || !t.enabled) return t;
        let data = { steps: t.steps, lens: t.lens };
        for (let s = rect.s1; s <= rect.s2; s++) {
          if (data.steps[s] >= 0) data = resizeNote(data.steps, data.lens, s, newLen);
        }
        return { ...t, lens: data.lens };
      })
    );
  };

  // Pintasan keyboard (aktif hanya saat pengguna terakhir berinteraksi di dalam Pad Studio dan tidak ada popup).
  const opsRef = useRef({
    copy: copySelection,
    cut: cutSelection,
    paste: pasteSelection,
    del: deleteSelection,
    dup: duplicateSelection,
    all: selectAll,
    clear: clearSelection,
  });
  opsRef.current = {
    copy: copySelection,
    cut: cutSelection,
    paste: pasteSelection,
    del: deleteSelection,
    dup: duplicateSelection,
    all: selectAll,
    clear: clearSelection,
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
      if (mod && k === 'c') {
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
      ...padInfo.map((p, pIdx) => (
        <option key={pIdx} value={pIdx} className="bg-surface text-white font-bold">
          Pad #{pIdx + 1}: {p.displayName}
        </option>
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
  const gridMinWidth = viewSteps * 22 + 230;

  // Pasangan (program, nada) yang dipakai grid akor + semua pad track utama (untuk bermain live).
  const chordWarmPairs = useMemo<Array<[number, number]>>(() => {
    const pairs: Array<[number, number]> = [];
    chordTracks.forEach((t, idx) => {
      if (!t.enabled) return;
      const used = new Set<number>();
      t.steps.forEach((v) => {
        if (v >= 0) used.add(v);
      });
      if (idx === 0) padInfo.forEach((_, i) => used.add(i));
      used.forEach((pi) => {
        padInfo[pi]?.midiNotes.forEach((n) => pairs.push([t.program, n]));
      });
    });
    return pairs;
  }, [chordTracks, padInfo]);
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
    let stopped = false;
    let finishTimer: number | undefined;
    let stopTicker: (() => void) | undefined;

    // `stepsLeft` = sisa step sampai akhir wilayah loop, dipakai membatasi lama tahan akor.
    const scheduleStep = (L: LiveSeqState, step: number, when: number, stepSec: number, stepsLeft: number) => {
      if (L.isDrumLoopActive) {
        for (const inst of DRUM_INSTRUMENTS) {
          const level = clampLevel(L.drumGrid[inst.id]?.[step]);
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
    audioEngine.playChordNotes(midiNotes, chordTracks[0].program, chordTracks[0].volume / 100, 1.0);
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
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
          <div className="space-y-1">
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

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 flex-nowrap shrink-0">
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

        <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
              {activeTab === 'drum'
                ? `Live Drum Trigger Pads (${selectedDrumKit})`
                : `Live Harmonic Chords — #${chordTracks[0].program + 1} ${INSTRUMENTS_128.find((i) => i.id === chordTracks[0].program)?.name || 'Piano'}`}
            </span>
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

          {activeTab === 'drum' ? (
            <div className="grid grid-cols-5 lg:grid-cols-10 gap-2">
              {DRUM_INSTRUMENTS.map((inst) => (
                <button
                  key={inst.id}
                  onClick={() => triggerDrum(inst.id)}
                  className={`h-20 rounded-xl border flex flex-col items-center justify-between p-2 transition-all cursor-pointer ${
                    activePadAnim === inst.id
                      ? 'bg-accent text-on-accent border-accent scale-105 shadow-lg'
                      : 'bg-surface text-white border-white/[0.08] hover:border-accent/60'
                  }`}
                >
                  <span className="text-xs font-black tracking-tight text-center leading-tight">{inst.label}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-accent/80" />
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {padChords.map((chordDef, idx) => {
                const displayName = padInfo[idx]?.displayName ?? '';
                const isActive = activePadAnim === `chord-${idx}`;
                return (
                  <div
                    key={idx}
                    onClick={() => triggerChordByIndex(idx)}
                    className={`h-22 rounded-xl border flex flex-col items-center justify-between p-2 transition-all relative group cursor-pointer ${
                      isActive
                        ? 'bg-accent text-on-accent border-accent scale-105 shadow-lg'
                        : 'bg-surface text-white border-white/[0.08] hover:border-accent/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => openHarmonicEditor(idx, e)}
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/40 hover:bg-accent text-gray-300 hover:text-on-accent transition-colors"
                    >
                      <Sliders className="w-3 h-3" />
                    </button>
                    <span className="text-[10px] font-mono text-gray-400 self-start">#{idx + 1}</span>
                    <span className="text-lg font-black tracking-tight my-auto">{displayName}</span>
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
                  { id: 'select', label: 'Pilih', Icon: BoxSelect, tip: 'Seret untuk memilih area (Shift+seret di mode Edit)' },
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

              <div className="flex flex-wrap items-center gap-1">
                <ToolBtn icon={Copy} label="Salin" title="Ctrl+C" onClick={copySelection} disabled={!activeSel} />
                <ToolBtn icon={Scissors} label="Potong" title="Ctrl+X" onClick={cutSelection} disabled={!activeSel} />
                <ToolBtn icon={ClipboardPaste} label="Tempel" title="Ctrl+V — ditempel di awal pilihan (atau di playhead)" onClick={pasteSelection} disabled={!clips[activeTab]} />
                <ToolBtn icon={CopyPlus} label="Duplikat" title="Ctrl+D — salin lalu tempel tepat setelah pilihan" onClick={duplicateSelection} disabled={!activeSel} />
                <ToolBtn icon={Trash2} label="Hapus" title="Delete" onClick={deleteSelection} disabled={!activeSel} />
              </div>

              <span className="text-[10px] font-mono text-gray-400 ml-auto">
                {activeSel
                  ? `${activeSel.r2 - activeSel.r1 + 1} baris × ${activeSel.s2 - activeSel.s1 + 1} step terpilih`
                  : 'Belum ada pilihan'}
              </span>
            </div>

            {activeTab === 'drum' ? (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-bold text-gray-300 mr-1">Kekuatan:</span>
                <button
                  type="button"
                  onClick={() => setDrumBrush('cycle')}
                  title="Tiap klik menaikkan kekuatan: kosong → pelan → normal → keras → maksimum → kosong"
                  className={`px-2 py-1 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                    drumBrush === 'cycle' ? 'bg-white/20 text-white border-white/40' : 'bg-black/50 text-gray-300 border-white/10 hover:border-white/25'
                  }`}
                >
                  Siklus
                </button>
                {([1, 2, 3, 4] as const).map((lv) => (
                  <button
                    key={lv}
                    type="button"
                    onClick={() => setDrumBrush(lv)}
                    title={`${DRUM_LEVEL_LABEL[lv]} — klik lagi pada pad dengan kekuatan sama untuk menghapus`}
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-bold border transition-colors cursor-pointer ${
                      drumBrush === lv ? 'bg-white/20 text-white border-white/40' : 'bg-black/50 text-gray-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <span className={`inline-block w-3.5 h-3.5 rounded-sm ${DRUM_LEVEL_CELL_CLASS[lv]}`} />
                    <span>{lv === 4 ? 'Maks' : DRUM_LEVEL_LABEL[lv]}</span>
                  </button>
                ))}
              </div>
            ) : (
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

            <p className="text-[10px] text-gray-500 leading-relaxed">
              {activeTab === 'drum'
                ? 'Pilih kekuatan lalu klik pad. Warna makin pekat = makin keras. '
                : 'Seret pegangan di tepi kanan blok akor untuk memanjang/memendekkan. '}
              Klik label BAR untuk memilih satu bar. Mode Pilih (atau Shift+seret) untuk memilih area; Ctrl+C / X / V / D untuk salin, potong, tempel, duplikat; Delete untuk hapus.
            </p>
          </div>

          <div
            ref={sequencerScrollRef}
            className="overflow-x-auto pt-2 pb-4 px-3 no-scrollbar"
            style={editMode === 'select' ? { touchAction: 'none' } : undefined}
            onPointerDown={handleGridPointerDown}
            onMouseDownCapture={(e) => {
              if ((modeRef.current === 'select' || e.shiftKey) && (e.target as HTMLElement).closest('[data-rowgrid]')) e.preventDefault();
            }}
            onClickCapture={(e) => {
              if ((modeRef.current === 'select' || e.shiftKey) && (e.target as HTMLElement).closest('[data-rowgrid]')) {
                e.stopPropagation();
                e.preventDefault();
              }
            }}
          >
            <div className="space-y-2" style={{ minWidth: gridMinWidth }}>
              <div className="flex items-center gap-2">
                <div className={`${LABEL_W} shrink-0 text-[10px] font-mono font-bold text-gray-500 uppercase tracking-wider px-1`}>
                  SEGMEN BAR
                </div>
                <div className="grid gap-0.5 flex-1" style={gridStyle}>
                  {windowBars.map((barIdx) => (
                    <div
                      key={barIdx}
                      style={{ gridColumn: `span ${stepsPerBar} / span ${stepsPerBar}` }}
                      onClick={(e) => selectBar(barIdx, e.shiftKey)}
                      title="Klik untuk memilih seluruh bar ini (Shift+klik = perluas)"
                      className="py-1.5 rounded-md border text-center text-xs font-mono font-bold bg-surface text-accent border-accent/30 cursor-pointer hover:bg-accent/10 select-none"
                    >
                      BAR {barIdx + 1}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className={`${LABEL_W} shrink-0 flex items-center gap-1 bg-black/60 border border-white/10 rounded-xl px-1.5 py-1`}>
                  {(() => {
                    const playing = activeTab === 'drum' ? isDrumLoopActive : isChordLoopActive;
                    const partName = activeTab === 'drum' ? 'Drum' : 'Akor';
                    return (
                      <button
                        type="button"
                        onClick={activeTab === 'drum' ? toggleDrumLoop : toggleChordLoop}
                        title={`${playing ? 'Hentikan' : 'Putar'} ${partName} (loop)`}
                        className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                          playing ? 'bg-accent text-on-accent shadow-md' : 'bg-white/5 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        {playing ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                        <span>{playing ? 'Stop' : 'Putar'} {partName}</span>
                      </button>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={resetToBeginning}
                    title="Mulai dari awal"
                    className="p-1.5 rounded-md bg-white/5 hover:bg-white/15 text-gray-300 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsSeqLooping(!isSeqLooping)}
                    title={isSeqLooping ? 'Loop aktif' : 'Loop mati'}
                    className={`p-1.5 rounded-md transition-all cursor-pointer ${
                      isSeqLooping ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-white/5 text-gray-500'
                    }`}
                  >
                    <Repeat className="w-3 h-3" />
                  </button>
                </div>

                <div className="grid gap-0.5 flex-1" style={gridStyle}>
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

              <div className="flex items-start gap-2">
                <div className={`${LABEL_W} shrink-0`}>
                  <button
                    type="button"
                    onClick={() => setMasterVolOpen((o) => !o)}
                    aria-expanded={masterVolOpen}
                    className="w-full flex items-center justify-between gap-2 bg-black/60 border border-white/10 hover:border-white/25 rounded-xl px-2.5 py-1.5 text-[11px] font-bold text-gray-200 cursor-pointer transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                      {activeTab === 'drum' ? 'Volume Drum' : 'Volume Akor'}
                    </span>
                    <span className="flex items-center gap-1 font-mono text-accent">
                      {activeTab === 'drum' ? drumVolume : chordMasterVolume}%
                      <ChevronDown className={`w-3 h-3 transition-transform ${masterVolOpen ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                  {masterVolOpen && (
                    <div className="mt-1 bg-black/60 border border-white/10 rounded-xl px-2.5 py-2">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={activeTab === 'drum' ? drumVolume : chordMasterVolume}
                        aria-label={activeTab === 'drum' ? 'Volume drum utama' : 'Volume akor utama'}
                        onChange={(e) =>
                          activeTab === 'drum' ? setDrumVolume(Number(e.target.value)) : setChordMasterVolume(Number(e.target.value))
                        }
                        className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                      />
                    </div>
                  )}
                </div>
                <div className="flex-1" />
              </div>

              {activeTab === 'drum' ? (
                <div className="space-y-1.5 pt-1">
                  {DRUM_INSTRUMENTS.map((inst, di) => {
                    const inSel = activeSel !== null && di >= activeSel.r1 && di <= activeSel.r2;
                    return (
                      <DrumRow
                        key={inst.id}
                        rowIdx={di}
                        id={inst.id}
                        label={inst.label}
                        mix={drumMix[inst.id]}
                        onMix={updateDrumMix}
                        onAdsr={updateDrumAdsr}
                        row={drumGrid[inst.id]}
                        steps={windowSteps}
                        stepsPerBar={stepsPerBar}
                        beatMask={beatInfo.isBeatStart}
                        gridStyle={gridStyle}
                        selS1={inSel ? activeSel!.s1 : -1}
                        selS2={inSel ? activeSel!.s2 : -1}
                        onPaint={paintDrumStep}
                      />
                    );
                  })}
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  {chordTracks.map((track, tIdx) =>
                    track.enabled ? (
                      <ChordRow
                        selS1={activeSel !== null && tIdx >= activeSel.r1 && tIdx <= activeSel.r2 ? activeSel.s1 : -1}
                        selS2={activeSel !== null && tIdx >= activeSel.r1 && tIdx <= activeSel.r2 ? activeSel.s2 : -1}
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
        drumGrid={drumGrid}
        chordTracksData={exportChordTracksData}
        drumMix={drumMix}
        drumVolume={drumVolume / 100}
        selectedDrumKit={selectedDrumKit}
        onSuccessToast={onSuccessToast}
      />
    </section>
  );
};
