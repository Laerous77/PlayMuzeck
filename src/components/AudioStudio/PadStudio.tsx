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
function buildDefaultDrumGrid(ts: TimeSignatureDef): { [key: string]: boolean[] } {
  const S = stepsPerBarOf(ts);
  const total = S * TOTAL_BARS;
  const grid: { [key: string]: boolean[] } = {};
  DRUM_INSTRUMENTS.forEach((inst) => {
    grid[inst.id] = Array(total).fill(false);
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
      grid.kick[base + starts[g]] = true;
    });
    snareGroups.forEach((g) => {
      grid.snare[base + starts[g]] = true;
    });
    for (let i = 0; i < S; i += 2) grid.closedhat[base + i] = true;
  }
  return grid;
}

// Progresi akor bawaan: satu akor di awal tiap bar, 4 bar pertama.
function buildDefaultChordSteps(ts: TimeSignatureDef): number[] {
  const S = stepsPerBarOf(ts);
  const arr: number[] = Array(S * TOTAL_BARS).fill(-1);
  for (let bar = 0; bar < DEFAULT_PATTERN_BARS; bar++) arr[bar * S] = bar;
  return arr;
}

// Berapa step sebuah akor ditahan: sampai akor berikutnya di track yang sama (maks. `limit` step).
function holdStepsFor(steps: number[], step: number, limit: number): number {
  const maxSteps = Math.max(1, limit);
  let d = 1;
  while (d < maxSteps && step + d < steps.length && steps[step + d] < 0) d++;
  return d;
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
  drumGrid: { [key: string]: boolean[] };
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

const DrumCell = memo(function DrumCell({
  drumId,
  stepIdx,
  active,
  beat,
  onToggle,
}: {
  drumId: string;
  stepIdx: number;
  active: boolean;
  beat: boolean;
  onToggle: (drumId: string, stepIdx: number) => void;
}) {
  return (
    <button
      type="button"
      data-step={stepIdx}
      onClick={() => onToggle(drumId, stepIdx)}
      className={`h-7 rounded-xs transition-colors relative flex items-center justify-center cursor-pointer ${
        active
          ? 'bg-accent text-on-accent font-bold shadow-xs'
          : beat
          ? 'bg-black/35 hover:bg-black/70 border border-white/[0.09]'
          : 'bg-black/60 hover:bg-black/90 border border-white/[0.05]'
      }`}
    />
  );
});

const DrumRow = memo(function DrumRow({
  id,
  label,
  row,
  steps,
  stepsPerBar,
  beatMask,
  gridStyle,
  onToggle,
}: {
  id: string;
  label: string;
  row: boolean[] | undefined;
  steps: number[];
  stepsPerBar: number;
  beatMask: boolean[];
  gridStyle: React.CSSProperties;
  onToggle: (drumId: string, stepIdx: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-36 text-xs font-semibold text-gray-300 truncate shrink-0 px-1">{label}</span>
      <div className="grid gap-0.5 flex-1" style={gridStyle}>
        {steps.map((stepIdx) => (
          <DrumCell
            key={stepIdx}
            drumId={id}
            stepIdx={stepIdx}
            active={Boolean(row?.[stepIdx])}
            beat={Boolean(beatMask[stepIdx % stepsPerBar])}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
});

const ChordCell = memo(function ChordCell({
  trackIdx,
  stepIdx,
  posInBar,
  beat,
  padIdx,
  isAssigned,
  fullName,
  options,
  onPick,
}: {
  trackIdx: number;
  stepIdx: number;
  posInBar: number;
  beat: boolean;
  padIdx: number;
  isAssigned: boolean;
  fullName: string;
  options: React.ReactNode;
  onPick: (trackIdx: number, stepIdx: number, padIdx: number) => void;
}) {
  const shortName = isAssigned ? fullName.replace(/\s+/g, '') : '-';
  return (
    <div
      data-step={stepIdx}
      className={`h-20 rounded-lg p-1 flex flex-col justify-between items-center transition-colors relative ${
        isAssigned
          ? 'bg-accent/20 border border-accent text-white shadow-xs'
          : beat
          ? 'bg-black/35 border border-white/[0.09] hover:border-white/20'
          : 'bg-black/60 border border-white/[0.05] hover:border-white/20'
      }`}
    >
      <span className="text-[10px] text-gray-400 font-mono font-bold">{posInBar + 1}</span>
      <div className="w-full flex-1 flex flex-col items-center justify-center relative">
        <span
          className={`text-[11px] font-black tracking-tight leading-none text-center px-0.5 w-full overflow-hidden ${
            isAssigned ? 'text-accent' : 'text-gray-500'
          }`}
          title={isAssigned ? fullName : '-'}
        >
          {shortName}
        </span>
        <select
          value={padIdx}
          onChange={(e) => onPick(trackIdx, stepIdx, Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        >
          {options}
        </select>
      </div>
      <div className={`w-1.5 h-1.5 rounded-full mb-0.5 ${isAssigned ? 'bg-accent' : 'bg-transparent'}`} />
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
  onPick,
}: {
  tIdx: number;
  track: ChordTrackState;
  instName: string;
  padInfo: PadInfo[];
  options: React.ReactNode;
  steps: number[];
  stepsPerBar: number;
  beatMask: boolean[];
  gridStyle: React.CSSProperties;
  onPick: (trackIdx: number, stepIdx: number, padIdx: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-36 shrink-0 px-1 flex flex-col justify-center">
        <span className="text-xs font-semibold text-gray-200 truncate">{track.label}</span>
        <span className="text-[10px] text-accent truncate font-mono">{instName}</span>
      </div>
      <div className="grid gap-0.5 flex-1" style={gridStyle}>
        {steps.map((stepIdx) => {
          const assigned = track.steps[stepIdx] ?? -1;
          const info = assigned >= 0 ? padInfo[assigned] : undefined;
          const posInBar = stepIdx % stepsPerBar;
          return (
            <ChordCell
              key={stepIdx}
              trackIdx={tIdx}
              stepIdx={stepIdx}
              posInBar={posInBar}
              beat={Boolean(beatMask[posInBar])}
              padIdx={assigned}
              isAssigned={Boolean(info)}
              fullName={info?.displayName ?? '-'}
              options={options}
              onPick={onPick}
            />
          );
        })}
      </div>
    </div>
  );
});

interface ChordTrackState {
  id: number;
  label: string;
  enabled: boolean;
  program: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  adsr: EnvelopeADSR;
  steps: number[];
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

  // ADSR Drum Mandiri
  const [drumAttackVal, setDrumAttackVal] = useState(0.002);
  const [drumDecayVal, setDrumDecayVal] = useState(0.15);
  const [drumSustainVal, setDrumSustainVal] = useState(0.3);
  const [drumReleaseVal, setDrumReleaseVal] = useState(0.12);

  const [showEnvelopePanel, setShowEnvelopePanel] = useState(false);

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
      steps: buildDefaultChordSteps(INITIAL_TS),
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
      steps: Array(INITIAL_TOTAL_STEPS).fill(-1),
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
      steps: Array(INITIAL_TOTAL_STEPS).fill(-1),
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
      steps: Array(INITIAL_TOTAL_STEPS).fill(-1),
    },
  ]);

  const [activePadAnim, setActivePadAnim] = useState<string | null>(null);

  const [selectedDrumKit, setSelectedDrumKit] = useState('80s Kit');
  const [engineStatus, setEngineStatus] = useState<string>('');

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

  const [drumGrid, setDrumGrid] = useState<{ [key: string]: boolean[] }>(() => buildDefaultDrumGrid(INITIAL_TS));

  // Sinkronisasi ADSR Drum ke AudioEngine
  useEffect(() => {
    if (audioEngine.drumAdsr) {
      audioEngine.drumAdsr.attack = drumAttackVal;
      audioEngine.drumAdsr.decay = drumDecayVal;
      audioEngine.drumAdsr.sustain = drumSustainVal;
      audioEngine.drumAdsr.release = drumReleaseVal;
    }
  }, [drumAttackVal, drumDecayVal, drumSustainVal, drumReleaseVal]);

  useEffect(() => {
    let hideTimer: number | undefined;
    audioEngine.initBank((msg: string) => {
      setEngineStatus(msg);
      if (msg === SOUND_BANK_READY_MESSAGE) {
        hideTimer = window.setTimeout(() => setEngineStatus(''), 2000);
      }
    });
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  const updateTrack = (trackIndex: number, updates: Partial<ChordTrackState>) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], ...updates };
      return copy;
    });
  };

  const updateTrackAdsr = (trackIndex: number, adsrUpdates: Partial<EnvelopeADSR>) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = {
        ...copy[trackIndex],
        adsr: { ...copy[trackIndex].adsr, ...adsrUpdates },
      };
      return copy;
    });
  };

  const toggleMute = (trackIndex: number) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], muted: !copy[trackIndex].muted };
      return copy;
    });
  };

  const toggleSolo = (trackIndex: number) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], solo: !copy[trackIndex].solo };
      return copy;
    });
  };

  const isTrackAudible = (track: ChordTrackState, allTracks: ChordTrackState[]) => {
    if (!track.enabled || track.muted) return false;
    const anySolo = allTracks.some((t) => t.enabled && t.solo);
    if (anySolo) return track.solo;
    return true;
  };

  const triggerDrum = (type: DrumInstrument['id']) => {
    audioEngine.playDrumSound(type, selectedDrumKit, drumVolume / 100);
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

  const toggleDrumStep = useCallback((drumId: string, stepIndex: number) => {
    const spb = layoutRef.current.stepsPerBar;
    const barIndex = Math.floor(stepIndex / spb);
    if (!gateRef.current.isUnlocked8Bar && barIndex > 0) {
      gateRef.current.onUnlockEditor();
      return;
    }
    setDrumGrid((prev) => {
      const row = [...(prev[drumId] || Array(layoutRef.current.totalSteps).fill(false))];
      row[stepIndex] = !row[stepIndex];
      return { ...prev, [drumId]: row };
    });
  }, []);

  const setTrackChordStep = useCallback((trackIndex: number, stepIndex: number, padIdx: number) => {
    const barIndex = Math.floor(stepIndex / layoutRef.current.stepsPerBar);
    if (!gateRef.current.isUnlocked8Bar && barIndex > 0) {
      gateRef.current.onUnlockEditor();
      return;
    }
    setChordTracks((prev) => {
      const copy = [...prev];
      const stepsCopy = [...copy[trackIndex].steps];
      stepsCopy[stepIndex] = stepsCopy[stepIndex] === padIdx ? -1 : padIdx;
      copy[trackIndex] = { ...copy[trackIndex], steps: stepsCopy };
      return copy;
    });
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
    // Siapkan semua sample akor yang dipakai SEBELUM mulai, supaya tidak ada pemrosesan di tengah ketukan.
    preparingChordsRef.current = true;
    const statusTimer = window.setTimeout(() => setEngineStatus('Menyiapkan suara akor...'), 150);
    try {
      await audioEngine.prewarmChordSamples(chordWarmPairs);
    } catch {
      // Lanjut saja: scheduler melewati nada yang belum siap, bukan berhenti.
    }
    window.clearTimeout(statusTimer);
    setEngineStatus('');
    preparingChordsRef.current = false;
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
  const gridMinWidth = viewSteps * 22 + 150;

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
    isDrumLoopActive,
    isChordLoopActive,
    isSeqLooping,
    isUnlocked8Bar: Boolean(isUnlocked8Bar),
    stepsPerBar,
    drumGrid,
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
          if (L.drumGrid[inst.id]?.[step]) {
            audioEngine.scheduleDrumSound(inst.id, L.selectedDrumKit, L.drumVolume / 100, when);
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
          // Akor ditahan sampai akor berikutnya di track ini (maks. 2 bar, tidak melewati akhir loop).
          const holdSteps = holdStepsFor(track.steps, step, Math.min(L.stepsPerBar * 2, stepsLeft));
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
      const cleared: { [key: string]: boolean[] } = {};
      DRUM_INSTRUMENTS.forEach((inst) => {
        cleared[inst.id] = Array(totalSteps).fill(false);
      });
      setDrumGrid(cleared);
    } else {
      setChordTracks((prev) =>
        prev.map((t) => ({ ...t, steps: Array(totalSteps).fill(-1) }))
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
      const out: { [key: string]: boolean[] } = {};
      DRUM_INSTRUMENTS.forEach((inst) => {
        out[inst.id] = remapSteps<boolean>(prev[inst.id] || [], oldS, newS, false);
      });
      return out;
    });
    setChordTracks((prev) => prev.map((t) => ({ ...t, steps: remapSteps<number>(t.steps, oldS, newS, -1) })));

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
    <section id="pad-studio-section" className="w-full">
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

        <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-black/50 border border-white/[0.08]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/[0.06]">
                <button
                  type="button"
                  onClick={toggleDrumLoop}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isDrumLoopActive ? 'bg-accent text-on-accent shadow-md' : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <Disc className="w-3.5 h-3.5" />
                  <span>{isDrumLoopActive ? 'Stop Drum' : 'Drum Loop'}</span>
                </button>
                <div className="flex items-center gap-1.5 pl-1.5 border-l border-white/10">
                  <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={drumVolume}
                    onChange={(e) => setDrumVolume(Number(e.target.value))}
                    className="w-16 sm:w-20 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                  />
                  <span className="text-[10px] font-mono text-gray-300 w-7 text-right">{drumVolume}%</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/[0.06]">
                <button
                  type="button"
                  onClick={toggleChordLoop}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isChordLoopActive ? 'bg-accent text-on-accent shadow-md' : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>{isChordLoopActive ? 'Stop Chord' : 'Chord Loop'}</span>
                </button>
                <div className="flex items-center gap-1.5 pl-1.5 border-l border-white/10">
                  <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={chordMasterVolume}
                    onChange={(e) => setChordMasterVolume(Number(e.target.value))}
                    className="w-16 sm:w-20 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                  />
                  <span className="text-[10px] font-mono text-gray-300 w-7 text-right">{chordMasterVolume}%</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowEnvelopePanel(!showEnvelopePanel)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  showEnvelopePanel
                    ? 'bg-accent text-on-accent border-accent'
                    : 'bg-black/40 text-gray-300 border-white/[0.08] hover:border-white/20'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Envelope ADSR</span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {isUnlocked8Bar ? (
                <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
                  Full 16-Bar Editor Aktif
                </span>
              ) : (
                <button onClick={onUnlockEditor} className="text-accent hover:underline font-semibold cursor-pointer">
                  Buka 16-Bar →
                </button>
              )}
            </div>
          </div>

          {showEnvelopePanel && (
            <div className="pt-3 border-t border-white/10 text-xs space-y-4">
              {activeTab === 'drum' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <Activity className="w-3 h-3 text-accent" />
                    <span>Envelope DRUM KIT ({selectedDrumKit}) — Karakter perkusif</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">A (Attack):</span>
                      <input
                        type="range"
                        min="0.001"
                        max="0.1"
                        step="0.001"
                        value={drumAttackVal}
                        onChange={(e) => setDrumAttackVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                      />
                      <span className="font-mono text-accent w-12 text-right">{(drumAttackVal * 1000).toFixed(0)}ms</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">D (Decay):</span>
                      <input
                        type="range"
                        min="0.01"
                        max="2.0"
                        step="0.01"
                        value={drumDecayVal}
                        onChange={(e) => setDrumDecayVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                      />
                      <span className="font-mono text-accent w-12 text-right">{(drumDecayVal * 1000).toFixed(0)}ms</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">S (Sustain):</span>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.05"
                        value={drumSustainVal}
                        onChange={(e) => setDrumSustainVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                      />
                      <span className="font-mono text-accent w-10 text-right">{(drumSustainVal * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">R (Release):</span>
                      <input
                        type="range"
                        min="0.02"
                        max="2.0"
                        step="0.02"
                        value={drumReleaseVal}
                        onChange={(e) => setDrumReleaseVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                      />
                      <span className="font-mono text-accent w-12 text-right">{(drumReleaseVal * 1000).toFixed(0)}ms</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {chordTracks.map((track, tIdx) => {
                    if (!track.enabled) return null;
                    const instName = INSTRUMENTS_128.find((i) => i.id === track.program)?.name || `Instrumen ${track.id}`;
                    return (
                      <div key={track.id} className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px] font-bold text-accent">
                          <span>Envelope {track.label}: {instName}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">A (Attack):</span>
                            <input
                              type="range"
                              min="0.005"
                              max="5.0"
                              step="0.01"
                              value={track.adsr.attack}
                              onChange={(e) => updateTrackAdsr(tIdx, { attack: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                            />
                            <span className="font-mono text-accent w-12 text-right">{(track.adsr.attack * 1000).toFixed(0)}ms</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">D (Decay):</span>
                            <input
                              type="range"
                              min="0.02"
                              max="5.0"
                              step="0.01"
                              value={track.adsr.decay}
                              onChange={(e) => updateTrackAdsr(tIdx, { decay: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                            />
                            <span className="font-mono text-accent w-12 text-right">{(track.adsr.decay * 1000).toFixed(0)}ms</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">S (Sustain):</span>
                            <input
                              type="range"
                              min="0.0"
                              max="1.0"
                              step="0.05"
                              value={track.adsr.sustain}
                              onChange={(e) => updateTrackAdsr(tIdx, { sustain: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                            />
                            <span className="font-mono text-accent w-10 text-right">{(track.adsr.sustain * 100).toFixed(0)}%</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">R (Release):</span>
                            <input
                              type="range"
                              min="0.05"
                              max="10.0"
                              step="0.05"
                              value={track.adsr.release}
                              onChange={(e) => updateTrackAdsr(tIdx, { release: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                            />
                            <span className="font-mono text-accent w-12 text-right">{(track.adsr.release * 1000).toFixed(0)}ms</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-accent font-bold">
              <Repeat className="w-4 h-4" />
              <span>Wilayah Looping (Bar & Step):</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">Mulai: Bar</span>
                <input
                  type="number"
                  min={1}
                  max={TOTAL_BARS}
                  value={loopStartBar}
                  onChange={(e) => setLoopStartBar(Math.max(1, Math.min(TOTAL_BARS, Number(e.target.value) || 1)))}
                  className="w-12 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-accent"
                />
                <span className="text-gray-400">Step</span>
                <input
                  type="number"
                  min={1}
                  max={stepsPerBar}
                  value={loopStartBeat}
                  onChange={(e) => setLoopStartBeat(Math.max(1, Math.min(stepsPerBar, Number(e.target.value) || 1)))}
                  className="w-10 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-accent"
                />
              </div>
              <span className="text-gray-500">—</span>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">Sampai: Bar</span>
                <input
                  type="number"
                  min={1}
                  max={TOTAL_BARS}
                  value={loopEndBar}
                  onChange={(e) => setLoopEndBar(Math.max(1, Math.min(TOTAL_BARS, Number(e.target.value) || 1)))}
                  className="w-12 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-accent"
                />
                <span className="text-gray-400">Step</span>
                <input
                  type="number"
                  min={1}
                  max={stepsPerBar}
                  value={loopEndBeat}
                  onChange={(e) => setLoopEndBeat(Math.max(1, Math.min(stepsPerBar, Number(e.target.value) || 1)))}
                  className="w-10 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-accent"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06] space-y-3">
          {activeTab === 'drum' ? (
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
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                  Preset Instrumen & Mixer Saluran (4 Progresi Akor)
                </span>
                {engineStatus && (
                  <span className="text-[10px] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
                    {engineStatus}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {chordTracks.map((track, tIdx) => {
                  if (!track.enabled) return null;
                  return (
                    <div
                      key={track.id}
                      className="flex items-center justify-between gap-2.5 bg-black/50 border border-white/[0.08] rounded-xl px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs font-bold text-gray-300 shrink-0">
                          {tIdx === 0 ? 'Instrumen 1:' : `Instrumen ${track.id}:`}
                        </span>

                        <select
                          value={track.program}
                          onChange={(e) => {
                            const prg = Number(e.target.value);
                            if (!isUnlocked8Bar && prg > 7) {
                              onUnlockEditor();
                              return;
                            }
                            updateTrack(tIdx, { program: prg });
                          }}
                          className="bg-black/80 text-white text-xs font-medium px-2 py-1 rounded-lg border border-white/[0.15] focus:border-accent outline-none min-w-0 flex-1 truncate cursor-pointer"
                        >
                          {INSTRUMENT_CATEGORIES.map((cat) => {
                            const isCatLocked = !isUnlocked8Bar && cat !== 'Piano';
                            return (
                              <optgroup
                                key={cat}
                                label={`${isCatLocked ? '🔒 ' : ''}── ${cat} ──`}
                                className="bg-surface text-gray-300 font-bold"
                              >
                                {INSTRUMENTS_128.filter((i) => i.category === cat).map((inst) => (
                                  <option
                                    key={inst.id}
                                    value={inst.id}
                                    disabled={isCatLocked}
                                    className={`text-white font-normal bg-black ${isCatLocked ? 'opacity-40 text-gray-500' : ''}`}
                                  >
                                    #{inst.id + 1} {inst.name}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded-lg border border-white/[0.06]">
                          <Volume2 className="w-3 h-3 text-gray-400" />
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={track.volume}
                            onChange={(e) => updateTrack(tIdx, { volume: Number(e.target.value) })}
                            className="w-14 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                            title={`Volume ${track.label}: ${track.volume}%`}
                          />
                          <span className="text-[10px] font-mono text-gray-300 w-6 text-right">
                            {track.volume}%
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleMute(tIdx)}
                          className={`w-6 h-6 rounded text-[10px] font-black transition-colors cursor-pointer flex items-center justify-center ${
                            track.muted
                              ? 'bg-red-500 text-white'
                              : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                          }`}
                          title={track.muted ? 'Buka Mute' : 'Mute Instrumen'}
                        >
                          M
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleSolo(tIdx)}
                          className={`w-6 h-6 rounded text-[10px] font-black transition-colors cursor-pointer flex items-center justify-center ${
                            track.solo
                              ? 'bg-accent text-on-accent font-extrabold'
                              : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                          }`}
                          title={track.solo ? 'Buka Isolate' : 'Isolate (Solo) Instrumen'}
                        >
                          S
                        </button>

                        {tIdx > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              updateTrack(tIdx, { enabled: false, steps: Array(totalSteps).fill(-1) });
                              stopAllLiveChords();
                            }}
                            className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
                            title={`Hapus ${track.label}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {chordTracks.some((t) => !t.enabled) && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isUnlocked8Bar) {
                        onUnlockEditor();
                        return;
                      }
                      const firstDisabledIdx = chordTracks.findIndex((t) => !t.enabled);
                      if (firstDisabledIdx !== -1) {
                        updateTrack(firstDisabledIdx, { enabled: true });
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-dashed border-accent/50 text-accent hover:bg-accent/10 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Progresi Instrumen ({chordTracks.filter((t) => t.enabled).length + 1}/4)</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
              {activeTab === 'drum'
                ? `Live Drum Trigger Pads (${selectedDrumKit})`
                : `Live Harmonic Chords — #${chordTracks[0].program + 1} ${INSTRUMENTS_128.find((i) => i.id === chordTracks[0].program)?.name || 'Piano'}`}
            </span>
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

          <div ref={sequencerScrollRef} className="overflow-x-auto pt-2 pb-4 px-3 no-scrollbar">
            <div className="space-y-2" style={{ minWidth: gridMinWidth }}>
              <div className="flex items-center gap-2">
                <div className="w-36 shrink-0 text-[10px] font-mono font-bold text-gray-500 uppercase tracking-wider px-1">
                  SEGMEN BAR
                </div>
                <div className="grid gap-0.5 flex-1" style={gridStyle}>
                  {windowBars.map((barIdx) => (
                    <div
                      key={barIdx}
                      style={{ gridColumn: `span ${stepsPerBar} / span ${stepsPerBar}` }}
                      className="py-1.5 rounded-md border text-center text-xs font-mono font-bold bg-surface text-accent border-accent/30"
                    >
                      BAR {barIdx + 1}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-36 shrink-0 flex items-center justify-between bg-black/60 border border-white/10 rounded-xl px-2.5 py-1">
                  <span className="text-[11px] font-bold text-accent tracking-tight">Titik Putar</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={resetToBeginning}
                      className="p-1 rounded-md bg-white/5 hover:bg-white/15 text-gray-300 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSeqLooping(!isSeqLooping)}
                      className={`p-1 rounded-md transition-all ${
                        isSeqLooping ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-white/5 text-gray-500'
                      }`}
                    >
                      <Repeat className="w-3 h-3" />
                    </button>
                  </div>
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

              {activeTab === 'drum' ? (
                <div className="space-y-1.5 pt-1">
                  {DRUM_INSTRUMENTS.map((inst) => (
                    <DrumRow
                      key={inst.id}
                      id={inst.id}
                      label={inst.label}
                      row={drumGrid[inst.id]}
                      steps={windowSteps}
                      stepsPerBar={stepsPerBar}
                      beatMask={beatInfo.isBeatStart}
                      gridStyle={gridStyle}
                      onToggle={toggleDrumStep}
                    />
                  ))}
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  {chordTracks.map((track, tIdx) =>
                    track.enabled ? (
                      <ChordRow
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
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {editingPadIndex !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-surface border border-white/20 rounded-2xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto my-auto shadow-2xl p-6 space-y-5">
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
        </div>
      )}

      {isExportMenuOpen && isUnlocked8Bar && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="fixed inset-0" onClick={() => setIsExportMenuOpen(false)} />
          <div className="relative w-full max-w-xs rounded-2xl bg-surface border border-white/[0.12] p-5 shadow-2xl">
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
        </div>
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
        drumAdsr={{
          attack: drumAttackVal,
          decay: drumDecayVal,
          sustain: drumSustainVal,
          release: drumReleaseVal,
        }}
        drumVolume={drumVolume / 100}
        selectedDrumKit={selectedDrumKit}
        onSuccessToast={onSuccessToast}
      />
    </section>
  );
};
