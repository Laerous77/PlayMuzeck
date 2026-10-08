// src/components/AudioStudio/AudioToolsSuite.tsx
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Scissors,
  Volume2,
  Sliders,
  FastForward,
  RotateCcw,
  RefreshCw,
  Minimize2,
  Waves,
  Wrench,
  Mic2,
  Upload,
  Eraser,
  Timer,
  Play,
  Pause,
  Download,
  CheckCircle,
  Loader2,
  Film,
  Music,
  Trash2,
  Lock,
  AlertTriangle,
  X,
  Target,
} from 'lucide-react';
import { AudioEntitlements } from '../../types';
import { InfoTip, BTN_DOWNLOAD, BTN_PRIMARY, PANEL_CLS, EmptyFileNotice, FileChip, FormatRow, LimitNote, quotaGuardProps } from './toolsShared';
import { ExtraToolPanel, EXTRA_TOOL_META, EXTRA_SLUG_TO_TOOL, EXTRA_FILE_TOOLS, type ExtraPickerHandle, type ExtraToolId, type QuotaGate } from './AudioExtraTools';
import { checkInputDuration, checkOutputDuration, limitLabelFor } from '../../services/audioLimits';
import { DAILY_FREE_QUOTA, refreshQuota, refundReservation, remainingQuota, reserveQuota, subscribeQuota, type Reservation } from '../../services/toolQuota';
import {
  exportAudioFile,
  audioBufferToWav,
  encodeCompressedAudio,
  encodeMp3,
  downloadBlob,
  type CompressedAudioResult,
} from '../../services/exporters';
import {
  DspError,
  LivePitchPlayer,
  applyGainDb,
  centerIsolate,
  computePeak,
  downsampleForCompress,
  pitchShift,
  spectralNoiseGate,
  timeStretch,
  waveformPeaks,
  type Channels,
  type DspOptions,
} from '../../services/audioToolsDsp';

interface AudioToolsSuiteProps {
  entitlements: AudioEntitlements;
  onUnlockEditor: () => void;
  onSuccessToast: (msg: string) => void;
  onQuotaExhausted?: () => void;
  toolsPrice?: number;
  isActive?: boolean;
  initialTool?: UnifiedToolId | null;
  studioActiveTrack?: { id: string; title: string; audioUrl?: string } | null;
}

type ToolType =
  | 'trim'
  | 'volume'
  | 'pitch'
  | 'tempo'
  | 'reverse'
  | 'convert'
  | 'compress'
  | 'noise_reduction'
  | 'vocal_separator';

type ExportAudioFormat = 'WAV' | 'MP3' | 'FLAC' | 'M4A';
type VocalTarget = 'vocal' | 'instrumental' | 'both';

interface ToolConfig {
  id: ToolType;
  name: string;
  desc: string;
  icon: React.ElementType;
}

interface CompressTier {
  id: string;
  name: string;
  bitrate: number;
  targetRate: number;
  label: string;
  desc: string;
  isMono: boolean;
}

interface ToolExecutionState {
  isProcessing: boolean;
  progress: number;
  resultBuffer: AudioBuffer | null;
  previewUrl: string | null;
  expiresAt: number | null;
  vocalBuffers?: {
    vocal: AudioBuffer;
    instrumental: AudioBuffer;
  };
  vocalUrls?: {
    vocal: string;
    instrumental: string;
  };
}

const TOOLS: ToolConfig[] = [
  { id: 'trim', name: 'Trim / Cut', desc: 'Potong audio dengan menentukan batas awal & akhir', icon: Scissors },
  { id: 'volume', name: 'Volume / Gain', desc: 'Atur penguatan gain dinamis tanpa tombol apply', icon: Volume2 },
  { id: 'pitch', name: 'Pitch / Transpose', desc: 'Ubah nada dinamis dengan opsi Kunci Tempo', icon: Sliders },
  { id: 'tempo', name: 'Tempo / Speed', desc: 'Ubah kecepatan secara dinamis tanpa mengubah nada', icon: FastForward },
  { id: 'reverse', name: 'Reverse', desc: 'Balikkan urutan sampel audio untuk efek transisi', icon: RotateCcw },
  { id: 'convert', name: 'Convert', desc: 'Konversi audio antar format (MP3, WAV, M4A, FLAC) & ekstrak audio dari video', icon: RefreshCw },
  { id: 'compress', name: 'Compress', desc: '5 tingkatan kompresi dengan estimasi ukuran & bitrate', icon: Minimize2 },
  { id: 'noise_reduction', name: 'Noise Reduction', desc: 'Peredam desis & dengung latar dengan spectral gate', icon: Waves },
  { id: 'vocal_separator', name: 'Vocal Isolator', desc: 'Pisahkan vokal & musik lewat teknik center-phase', icon: Mic2 },
];

export type UnifiedToolId = ToolType | ExtraToolId;

interface ToolGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  desc: string;
  tools: UnifiedToolId[];
}

const TOOL_GROUPS: ToolGroup[] = [
  { id: 'cut', label: 'Potong & Susun', icon: Scissors, desc: 'Ubah struktur audio: potong bagian, sambung beberapa file, balik urutannya, atau ulangi beberapa kali.', tools: ['trim', 'merge', 'reverse', 'loop'] },
  { id: 'sound', label: 'Perbaiki Suara', icon: Eraser, desc: 'Bersihkan dan seimbangkan suara: volume, jeda hening, loudness, mono, dan noise.', tools: ['volume', 'clean', 'noise_reduction'] },
  { id: 'music', label: 'Nada, Tempo & Vokal', icon: Music, desc: 'Olah unsur musik: ubah nada, ubah kecepatan, atau pisahkan vokal dari musik.', tools: ['pitch', 'tempo', 'vocal_separator'] },
  { id: 'format', label: 'Format & Ukuran', icon: RefreshCw, desc: 'Ganti format file (termasuk ekstrak audio dari video), perkecil ukurannya, atau edit metadata: judul, artis, album, cover, dan lirik.', tools: ['convert', 'compress', 'metadata'] },
  { id: 'record', label: 'Rekam & Analisis', icon: Mic2, desc: 'Ambil audio baru dari mikrofon, cari tahu tempo dan kunci nada lagu, atau deteksi nada vokal.', tools: ['recorder', 'bpm', 'pitch_detect'] },
  { id: 'practice', label: 'Latihan Musik', icon: Timer, desc: 'Alat langsung berlatih: jaga tempo dengan metronom, setel instrumen dengan tuner, ukur vocal range, dan latihan cocokkan nada.', tools: ['metronome', 'tuner', 'vocal_range', 'pitch_match'] },
];

const EXTRA_IDS = new Set<string>(EXTRA_TOOL_META.map((t) => t.id));
const isExtraId = (id: UnifiedToolId): id is ExtraToolId => EXTRA_IDS.has(id);

function toolInfo(id: UnifiedToolId): { name: string; icon: React.ElementType; desc: string } {
  const base = TOOLS.find((t) => t.id === id);
  if (base) return { name: base.name, icon: base.icon, desc: base.desc };
  const ex = EXTRA_TOOL_META.find((t) => t.id === id)!;
  return { name: ex.label, icon: ex.icon, desc: ex.desc };
}

export const TOOL_SLUG_TO_ID: Record<string, UnifiedToolId> = {
  'potong-audio': 'trim',
  'atur-volume-audio': 'volume',
  'ubah-nada-audio': 'pitch',
  'ubah-kecepatan-audio': 'tempo',
  'balik-audio': 'reverse',
  'konversi-audio': 'convert',
  'kompres-audio': 'compress',
  'kurangi-noise-audio': 'noise_reduction',
  'pisahkan-vokal': 'vocal_separator',
  ...EXTRA_SLUG_TO_TOOL,
};

const LIVE_TOOLS: ToolType[] = ['volume', 'pitch', 'tempo'];
const STATIC_RESULT_TOOLS: ToolType[] = ['trim', 'reverse', 'convert', 'compress', 'noise_reduction', 'vocal_separator'];

const RESULT_TTL_MS = 5 * 60 * 1000;

const INITIAL_TOOL_STATE: ToolExecutionState = {
  isProcessing: false,
  progress: 0,
  resultBuffer: null,
  previewUrl: null,
  expiresAt: null,
};

function makeInitialStates(): Record<ToolType, ToolExecutionState> {
  const s = {} as Record<ToolType, ToolExecutionState>;
  TOOLS.forEach((t) => {
    s[t.id] = { ...INITIAL_TOOL_STATE };
  });
  return s;
}

function readQuota(isOwned = false): Record<ToolType, number> {
  const q = {} as Record<ToolType, number>;
  TOOLS.forEach((t) => {
    q[t.id] = remainingQuota(t.id, isOwned);
  });
  return q;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));

function bufferToChannels(buf: AudioBuffer): Channels {
  const out: Channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) out.push(buf.getChannelData(c));
  return out;
}

function makeBuffer(ctx: BaseAudioContext, chs: Channels, sampleRate: number): AudioBuffer {
  const len = chs[0]?.length || 0;
  if (!len) throw new DspError('EMPTY');
  const buf = ctx.createBuffer(chs.length, len, sampleRate);
  chs.forEach((c, i) => buf.getChannelData(i).set(c));
  return buf;
}

function revokeStateUrls(s: ToolExecutionState) {
  if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
  if (s.vocalUrls) {
    URL.revokeObjectURL(s.vocalUrls.vocal);
    URL.revokeObjectURL(s.vocalUrls.instrumental);
  }
}

function safeFileBase(name: string): string {
  const base = name.replace(/\.[^/.]+$/, '').replace(/[\\/:*?"<>|]+/g, '_').trim();
  return base || 'audio';
}

function formatMb(bytes: number): string {
  return (bytes / 1048576).toLocaleString('id-ID', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

function getAdaptiveCompressTiers(
  sourceKbps: number,
  durationSec: number,
  sourceChannels: number,
  sourceBytes: number
): CompressTier[] {
  const base = Math.max(64, sourceKbps || 128);
  const cap = Math.max(32, Math.round(base * 0.95));
  const raw = [
    Math.max(96, Math.min(112, Math.round(base * 0.88))),
    Math.max(80, Math.min(92, Math.round(base * 0.74))),
    Math.max(48, Math.min(64, Math.round(base * 0.5))),
    Math.max(36, Math.min(44, Math.round(base * 0.35))),
    Math.max(24, Math.min(28, Math.round(base * 0.22))),
  ];
  const rates: number[] = [];
  raw.forEach((r, i) => {
    let v = Math.min(r, cap);
    if (i > 0) v = Math.min(v, rates[i - 1] - 4);
    rates.push(Math.max(16, v));
  });

  const defs = [
    { id: 'very_light', name: 'Very Light', targetRate: 32000, stereo: true, note: 'Kompresi ringan' },
    { id: 'light', name: 'Light', targetRate: 24000, stereo: true, note: 'Kualitas siaran' },
    { id: 'balanced', name: 'Balanced', targetRate: 22050, stereo: false, note: 'Standar streaming' },
    { id: 'high', name: 'High', targetRate: 16000, stereo: false, note: 'Kompresi tinggi' },
    { id: 'maximum', name: 'Maximum', targetRate: 11025, stereo: false, note: 'Ukuran file terkecil' },
  ];

  return defs.map((d, i) => {
    const bitrate = rates[i];
    const isMono = !d.stereo || sourceChannels < 2;
    let est = '';
    if (durationSec > 0) {
      const bytes = (bitrate * 1000 * durationSec) / 8;
      const pct = sourceBytes > 0 ? Math.round((1 - bytes / sourceBytes) * 100) : null;
      est = ` (estimasi ~${formatMb(bytes)} MB${pct !== null && pct > 0 ? `, -${pct}%` : ''})`;
    }
    return {
      id: d.id,
      name: d.name,
      bitrate,
      targetRate: d.targetRate,
      isMono,
      label: `${bitrate} kbps (${isMono ? 'Mono' : 'Stereo'})`,
      desc: `${d.note}${est}`,
    };
  });
}

const round2 = (v: number) => Math.round(v * 100) / 100;

const formatSigned = (v: number) => {
  const r = round2(v);
  return r > 0 ? `+${r}` : `${r}`;
};

const detectAudioFormat = (file: File | null): ExportAudioFormat | null => {
  if (!file) return null;
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('video/')) return null;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (type === 'audio/mpeg' || type === 'audio/mp3' || ext === 'mp3') return 'MP3';
  if (/wav|wave/.test(type) || ext === 'wav' || ext === 'wave') return 'WAV';
  if (type === 'audio/flac' || type === 'audio/x-flac' || ext === 'flac') return 'FLAC';
  if (type === 'audio/mp4' || type === 'audio/x-m4a' || type === 'audio/m4a' || ext === 'm4a') return 'M4A';
  return null;
};

const TOOL_INFO: Record<ToolType, string[]> = {
  trim: [],
  volume: [`Geser slider atau ketik langsung, desimal didukung (mis. ${formatSigned(0.3)} dB). Rentang -24 sampai +24 dB.`],
  pitch: [`Desimal didukung (mis. ${formatSigned(0.02)} semitone = geser nada 2 cent). Rentang -12 sampai +12 semitone.`],
  tempo: ['Geser slider atau ketik langsung, desimal didukung (mis. 1.25x). Rentang 0.5x sampai 2x.'],
  reverse: [],
  convert: [],
  compress: ['Memilih tingkatan langsung memproses ulang dengan encoder LAME MP3 / FLAC / AAC.'],
  noise_reduction: [],
  vocal_separator: ['Memisahkan elemen yang berada di tengah stereo menggunakan center-phase isolation.'],
};

const DecimalField: React.FC<{
  value: number;
  min: number;
  max: number;
  unit: string;
  disabled?: boolean;
  onCommit: (v: number) => void;
}> = ({ value, min, max, unit, disabled, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(v)) onCommit(round2(clamp(v, min, max)));
    setDraft(null);
  };
  return (
    <div className="flex items-center gap-1">
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? String(round2(value))}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
        aria-label={unit}
        className="w-20 bg-black/80 border border-white/15 rounded px-2 py-1 text-sm font-mono font-bold text-accent text-right focus:outline-none focus:border-accent disabled:opacity-40"
      />
      <span className="text-gray-400 font-mono text-xs">{unit}</span>
    </div>
  );
};

const TimeField: React.FC<{
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}> = ({ value, min, max, disabled, onCommit }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const v = parseFloat(draft.replace(',', '.'));
    if (Number.isFinite(v)) onCommit(clamp(v, min, max));
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      disabled={disabled}
      value={draft ?? value.toFixed(2)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      className="w-20 bg-black/80 border border-white/15 rounded px-2 py-1 text-xs font-mono font-bold text-accent text-right focus:outline-none focus:border-accent disabled:opacity-40"
    />
  );
};

export const AudioToolsSuite: React.FC<AudioToolsSuiteProps> = ({
  entitlements,
  onUnlockEditor,
  onSuccessToast,
  onQuotaExhausted,
  toolsPrice = 20000,
  isActive = true,
  initialTool = null,
  studioActiveTrack = null,
}) => {
  const isToolsOwned = useMemo(() => {
    const e: any = entitlements;
    return Boolean(
      e?.audioToolsSuite || Object.values(e?.byTrack || {}).some((t: any) => t?.audioToolsSuite)
    );
  }, [entitlements]);

  const [selectedTool, setSelectedTool] = useState<ToolType>(initialTool && !isExtraId(initialTool) ? initialTool : 'trim');
  const [selectedExtra, setSelectedExtra] = useState<ExtraToolId | null>(initialTool && isExtraId(initialTool) ? initialTool : null);
  const [extraTick, setExtraTick] = useState(0);
  // Pemilih berkas milik alat tambahan yang sedang aktif (Gabung & Fade, Ulangi Audio, Rapikan Audio, Edit Metadata).
  const [extraPicker, setExtraPicker] = useState<ExtraPickerHandle | null>(null);
  const extraSessionRef = useRef<Set<string>>(new Set());
  const paidExtraRef = useRef<Set<string>>(new Set());
  const extraResRef = useRef<Map<string, Reservation>>(new Map());
  const pageNonce = useMemo(() => Math.random().toString(36).slice(2, 10), []);
  const goPricingRef = useRef<(toolId?: UnifiedToolId) => void | Promise<void>>(() => undefined);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [decodedBuffer, setDecodedBuffer] = useState<AudioBuffer | null>(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [toolStates, setToolStates] = useState<Record<ToolType, ToolExecutionState>>(makeInitialStates);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedExportFormat, setSelectedExportFormat] = useState<ExportAudioFormat>('MP3');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(10);
  const [dynamicGainDb, setDynamicGainDb] = useState(0);
  const [dynamicPitchSemitones, setDynamicPitchSemitones] = useState(0);
  const [keepTempoOnPitch, setKeepTempoOnPitch] = useState(true);
  const [dynamicTempoSpeed, setDynamicTempoSpeed] = useState(1.0);
  const [convertSourceMode, setConvertSourceMode] = useState<'audio' | 'video'>('audio');
  const [selectedCompressTier, setSelectedCompressTier] = useState('balanced');
  const [noiseAggression, setNoiseAggression] = useState(75);
  const [vocalExtractTarget, setVocalExtractTarget] = useState<VocalTarget>('both');
  const [vocalPreviewChoice, setVocalPreviewChoice] = useState<'vocal' | 'instrumental'>('vocal');

  const [quotaMap, setQuotaMap] = useState<Record<ToolType, number>>(() => readQuota());
  const currentToolQuota = isToolsOwned ? Infinity : quotaMap[selectedTool] ?? DAILY_FREE_QUOTA;
  void extraTick;
  const activeQuota = isToolsOwned ? Infinity : selectedExtra ? remainingQuota(selectedExtra) : currentToolQuota;
  const activeToolId: UnifiedToolId = selectedExtra ?? selectedTool;
  const activeGroup = TOOL_GROUPS.find((g) => g.tools.includes(activeToolId)) ?? TOOL_GROUPS[0];

  const sourceFormat = useMemo(() => detectAudioFormat(audioFile), [audioFile]);
  const blockedFormat: ExportAudioFormat | null = selectedTool === 'convert' ? sourceFormat : null;
  useEffect(() => {
    if (blockedFormat && selectedExportFormat === blockedFormat) {
      const next = (['MP3', 'WAV', 'M4A', 'FLAC'] as const).find((f) => f !== blockedFormat);
      if (next) setSelectedExportFormat(next);
    }
  }, [blockedFormat, selectedExportFormat]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const pitchPlayerRef = useRef<LivePitchPlayer | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const loadIdRef = useRef(0);
  const runIdsRef = useRef<Record<ToolType, number>>(
    Object.fromEntries(TOOLS.map((t) => [t.id, 0])) as Record<ToolType, number>
  );
  const toolStatesRef = useRef(toolStates);
  const audioUrlRef = useRef<string | null>(null);
  const compressChargedRef = useRef(false);
  const chargedSigRef = useRef<Partial<Record<ToolType, string>>>({});
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const toastRef = useRef(onSuccessToast);
  toastRef.current = onSuccessToast;
  toolStatesRef.current = toolStates;
  audioUrlRef.current = audioUrl;

  const currentToolState = toolStates[selectedTool];
  const hasResult = Boolean(currentToolState.resultBuffer);
  const live = useRef({ selectedTool, trimStart, trimEnd, hasTrimResult: false });
  live.current.selectedTool = selectedTool;
  live.current.trimStart = trimStart;
  live.current.trimEnd = trimEnd;
  live.current.hasTrimResult = Boolean(toolStates.trim.resultBuffer);

  const totalDuration = decodedBuffer?.duration || 60;
  const minGap = Math.min(0.1, totalDuration / 2);
  const startPercent = clamp((trimStart / totalDuration) * 100, 0, 100);
  const endPercent = clamp((trimEnd / totalDuration) * 100, 0, 100);

  const isGranularPitchMode = selectedTool === 'pitch' && keepTempoOnPitch;

  // Durasi hasil yang diperkirakan untuk alat `tool` (tempo & pitch tanpa kunci tempo mengubah durasi).
  const predictedOutputSec = (tool: ToolType): number => {
    const d = decodedBuffer?.duration ?? 0;
    if (tool === 'tempo') return d / Math.max(0.01, dynamicTempoSpeed);
    if (tool === 'pitch' && !keepTempoOnPitch) return d / Math.pow(2, dynamicPitchSemitones / 12);
    return d;
  };

  const estimatedSourceBitrate = useMemo(() => {
    if (audioFile && decodedBuffer && decodedBuffer.duration > 0) {
      return Math.min(320, Math.round((audioFile.size * 8) / decodedBuffer.duration / 1000));
    }
    return 128;
  }, [audioFile, decodedBuffer]);

  const compressTiers = useMemo(
    () =>
      getAdaptiveCompressTiers(
        estimatedSourceBitrate,
        decodedBuffer?.duration || 0,
        decodedBuffer?.numberOfChannels || 2,
        audioFile?.size || 0
      ),
    [estimatedSourceBitrate, decodedBuffer, audioFile]
  );

  const sourcePeak = useMemo(() => (decodedBuffer ? computePeak(bufferToChannels(decodedBuffer)) : 0), [decodedBuffer]);

  const waveformPath = useMemo(() => {
    if (!decodedBuffer) return '';
    const bins = 400;
    const peaks = waveformPeaks(bufferToChannels(decodedBuffer), bins);
    let d = '';
    for (let i = 0; i < bins; i++) {
      const h = Math.max(0.5, peaks[i] * 46);
      d += `M${i + 0.5} ${(50 - h).toFixed(1)}V${(50 + h).toFixed(1)}`;
    }
    return d;
  }, [decodedBuffer]);

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioCtxClass();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => undefined);
    }
    return audioCtxRef.current;
  }, []);

  const ensureGraph = useCallback(() => {
    const el = audioElementRef.current;
    if (!el || mediaSourceNodeRef.current) return;
    const ctx = getAudioContext();
    try {
      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      source.connect(gain);
      gain.connect(ctx.destination);
      mediaSourceNodeRef.current = source;
      gainNodeRef.current = gain;
    } catch (err) {
      console.warn('Media element sudah terhubung ke graph:', err);
    }
  }, [getAudioContext]);

  const dynamicGainDbRef = useRef(dynamicGainDb);
  dynamicGainDbRef.current = dynamicGainDb;

  const applyGain = useCallback(() => {
    const g = gainNodeRef.current;
    const ctx = audioCtxRef.current;
    if (!g || !ctx) return;
    const v = live.current.selectedTool === 'volume' ? Math.pow(10, dynamicGainDbRef.current / 20) : 1;
    g.gain.setTargetAtTime(v, ctx.currentTime, 0.015);
  }, []);

  useEffect(() => {
    applyGain();
  }, [selectedTool, dynamicGainDb, applyGain]);

  const vocalPreviewTarget: 'vocal' | 'instrumental' =
    vocalExtractTarget === 'both' ? vocalPreviewChoice : vocalExtractTarget;

  let resultSrc: string | null = null;
  if (selectedTool === 'vocal_separator') {
    resultSrc = currentToolState.vocalUrls?.[vocalPreviewTarget] ?? null;
  } else if (STATIC_RESULT_TOOLS.includes(selectedTool)) {
    resultSrc = currentToolState.previewUrl;
  }
  const activeAudioSrc = resultSrc || audioUrl;

  const stopPlayback = useCallback(() => {
    pitchPlayerRef.current?.stop();
    pitchPlayerRef.current = null;
    const a = audioElementRef.current;
    if (a) {
      a.pause();
      const l = live.current;
      a.currentTime = l.selectedTool === 'trim' && !l.hasTrimResult ? l.trimStart : 0;
    }
    if (playheadRef.current) playheadRef.current.style.display = 'none';
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    stopPlayback();
  }, [activeAudioSrc, selectedTool, keepTempoOnPitch, stopPlayback]);

  useEffect(() => {
    if (!isActive) stopPlayback();
  }, [isActive, stopPlayback]);

  const desiredRate =
    selectedTool === 'tempo'
      ? dynamicTempoSpeed
      : selectedTool === 'pitch' && !keepTempoOnPitch
      ? Math.pow(2, dynamicPitchSemitones / 12)
      : 1;
  const desiredPreserve = !(selectedTool === 'pitch' && !keepTempoOnPitch);

  const applyRate = () => {
    const a = audioElementRef.current;
    if (!a) return;
    a.defaultPlaybackRate = desiredRate;
    a.playbackRate = desiredRate;
    a.preservesPitch = desiredPreserve;
    (a as any).webkitPreservesPitch = desiredPreserve;
    (a as any).mozPreservesPitch = desiredPreserve;
  };

  useEffect(() => {
    applyRate();
  }, [desiredRate, desiredPreserve, activeAudioSrc, audioUrl]);

  useEffect(() => {
    pitchPlayerRef.current?.setPitchRatio(Math.pow(2, dynamicPitchSemitones / 12));
  }, [dynamicPitchSemitones]);

  useEffect(() => {
    if (!isPlaying || selectedTool !== 'trim' || toolStates.trim.resultBuffer) return;
    let raf = 0;
    const loop = () => {
      const a = audioElementRef.current;
      if (a) {
        if (a.currentTime >= live.current.trimEnd - 0.005) {
          stopPlayback();
          return;
        }
        if (a.currentTime < live.current.trimStart - 0.05) a.currentTime = live.current.trimStart;
        const ph = playheadRef.current;
        if (ph && decodedBuffer) {
          ph.style.display = 'block';
          ph.style.left = `${clamp((a.currentTime / decodedBuffer.duration) * 100, 0, 100)}%`;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, selectedTool, toolStates.trim.resultBuffer, decodedBuffer, stopPlayback]);

  const clearToolResult = useCallback((tool: ToolType) => {
    revokeStateUrls(toolStatesRef.current[tool]);
    runIdsRef.current[tool] += 1;
    if (tool === 'compress') compressChargedRef.current = false;
    setToolStates((prev) => ({ ...prev, [tool]: { ...INITIAL_TOOL_STATE } }));
  }, []);

  const handleClearToolResult = (tool: ToolType) => {
    if (live.current.selectedTool === tool) stopPlayback();
    clearToolResult(tool);
    onSuccessToast(`Hasil ${TOOLS.find((t) => t.id === tool)?.name} berhasil dihapus.`);
  };

  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      let any = false;
      (Object.keys(toolStatesRef.current) as ToolType[]).forEach((tool) => {
        const exp = toolStatesRef.current[tool].expiresAt;
        if (!exp) return;
        any = true;
        if (t > exp) {
          if (live.current.selectedTool === tool) stopPlayback();
          clearToolResult(tool);
          toastRef.current(`Hasil ${TOOLS.find((x) => x.id === tool)?.name} kedaluwarsa dan dihapus.`);
        }
      });
      if (any) setNowTick(t);
    }, 5000);
    return () => clearInterval(id);
  }, [clearToolResult, stopPlayback]);

  useEffect(() => {
    const off = subscribeQuota(() => {
      setQuotaMap(readQuota());
      setExtraTick((t) => t + 1);
    });
    return off;
  }, []);
  useEffect(() => {
    void refreshQuota();
  }, [selectedTool, selectedExtra, entitlements]);

  const lastPricingRef = useRef(0);
  const goPricing = async (toolId?: UnifiedToolId) => {
    const now = Date.now();
    if (now - lastPricingRef.current < 600) return;
    lastPricingRef.current = now;
    if (toolId && !isToolsOwned) {
      await refreshQuota();
      if (remainingQuota(toolId) > 0) {
        toastRef.current(`Jatah gratis ${toolInfo(toolId).name} tersedia lagi.`);
        return;
      }
    }
    if (toolId) {
      toastRef.current(`Jatah gratis ${toolInfo(toolId).name} hari ini sudah habis (${DAILY_FREE_QUOTA}x/hari).`);
    }
    (onQuotaExhausted ?? onUnlockEditor)();
  };

  goPricingRef.current = goPricing;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    const myLoad = ++loadIdRef.current;
    setErrorMsg(null);
    setIsLoadingFile(true);
    stopPlayback();

    try {
      const ctx = getAudioContext();
      const arrayBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      if (myLoad !== loadIdRef.current) return;
      if (!decoded.length) throw new Error('empty');
      // Batas tertinggi (90 menit) berlaku untuk semua alat saat berkas dimuat; alat berbatas 60 menit diperiksa lagi per alat.
      const tooLongForAll = checkInputDuration('trim', decoded.duration);
      if (tooLongForAll) {
        setErrorMsg(tooLongForAll);
        return;
      }

      Object.values(toolStatesRef.current).forEach(revokeStateUrls);
      (Object.keys(runIdsRef.current) as ToolType[]).forEach((t) => (runIdsRef.current[t] += 1));
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      compressChargedRef.current = false;
      chargedSigRef.current = {};

      setToolStates(makeInitialStates());
      setAudioFile(file);
      setAudioUrl(URL.createObjectURL(file));
      setDecodedBuffer(decoded);
      setTrimStart(0);
      setTrimEnd(decoded.duration);
      onSuccessToast(`Berkas "${file.name}" berhasil dimuat.`);
    } catch {
      if (myLoad === loadIdRef.current) {
        setErrorMsg(
          convertSourceMode === 'video' || file.type.startsWith('video/')
            ? 'Browser tidak bisa membaca track audio dari video ini. Coba MP4, WebM, atau MOV.'
            : 'Gagal membaca berkas. Pastikan format audio didukung (MP3, WAV, M4A, OGG, FLAC).'
        );
      }
    } finally {
      if (myLoad === loadIdRef.current) setIsLoadingFile(false);
    }
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    if (isGranularPitchMode) {
      if (!decodedBuffer) return;
      const ctx = getAudioContext();
      try {
        await ctx.resume();
      } catch {}
      const player = new LivePitchPlayer(ctx, decodedBuffer);
      player.setPitchRatio(Math.pow(2, dynamicPitchSemitones / 12));
      player.setOnEnded(() => {
        pitchPlayerRef.current = null;
        setIsPlaying(false);
      });
      pitchPlayerRef.current = player;
      player.start(0);
      setIsPlaying(true);
      return;
    }

    const a = audioElementRef.current;
    if (!a) return;
    try {
      await getAudioContext().resume();
    } catch {}
    ensureGraph();
    applyGain();
    applyRate();

    if (selectedTool === 'trim' && !toolStates.trim.resultBuffer) {
      if (a.currentTime < trimStart || a.currentTime >= trimEnd - 0.02) a.currentTime = trimStart;
    }
    try {
      await a.play();
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  };

  const changeTrimStart = (v: number) => {
    if (!decodedBuffer) return;
    const nv = clamp(v, 0, Math.max(0, live.current.trimEnd - minGap));
    live.current.trimStart = nv;
    setTrimStart(nv);
    if (toolStatesRef.current.trim.resultBuffer) clearToolResult('trim');
    const a = audioElementRef.current;
    if (a && !toolStatesRef.current.trim.resultBuffer) a.currentTime = nv;
  };

  const changeTrimEnd = (v: number) => {
    if (!decodedBuffer) return;
    const nv = clamp(v, Math.min(totalDuration, live.current.trimStart + minGap), totalDuration);
    live.current.trimEnd = nv;
    setTrimEnd(nv);
    if (toolStatesRef.current.trim.resultBuffer) clearToolResult('trim');
  };

  const handleTrimHandleDrag = (which: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!decodedBuffer) return;
    e.preventDefault();
    e.stopPropagation();
    const dur = decodedBuffer.duration;

    const onMove = (ev: PointerEvent) => {
      const rect = timelineRef.current?.getBoundingClientRect();
      if (!rect || !rect.width) return;
      const t = clamp((ev.clientX - rect.left) / rect.width, 0, 1) * dur;
      if (which === 'start') changeTrimStart(t);
      else changeTrimEnd(t);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragCleanupRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    dragCleanupRef.current = onUp;
  };

  const executeProcessForTool = async (targetTool: ToolType, overrideTier?: string) => {
    if (!decodedBuffer) {
      fileInputRef.current?.click();
      return;
    }
    if (LIVE_TOOLS.includes(targetTool)) return;

    const inputMsg = checkInputDuration(targetTool, decodedBuffer.duration);
    if (inputMsg) {
      setErrorMsg(inputMsg);
      return;
    }

    const q = readQuota();
    setQuotaMap(q);
    const needsCharge = !isToolsOwned && !(targetTool === 'compress' && compressChargedRef.current);
    if (needsCharge && (q[targetTool] ?? 0) <= 0) {
      goPricing(targetTool);
      return;
    }

    const src = decodedBuffer;
    const sr = src.sampleRate;
    const chs = bufferToChannels(src);
    const myLoad = loadIdRef.current;
    const myRun = ++runIdsRef.current[targetTool];
    const isStale = () => myLoad !== loadIdRef.current || myRun !== runIdsRef.current[targetTool];

    setErrorMsg(null);
    if (live.current.selectedTool === targetTool) stopPlayback();
    revokeStateUrls(toolStatesRef.current[targetTool]);
    setToolStates((prev) => ({ ...prev, [targetTool]: { ...INITIAL_TOOL_STATE, isProcessing: true, progress: 0 } }));

    let reservation: Reservation | null = null;
    if (needsCharge) {
      reservation = await reserveQuota(targetTool, targetTool === 'compress' ? `compress:${myLoad}:${pageNonce}` : undefined);
      if (isStale()) {
        void refundReservation(targetTool, reservation);
        return;
      }
      if (!reservation.allowed) {
        setToolStates((prev) => ({ ...prev, [targetTool]: { ...INITIAL_TOOL_STATE } }));
        setQuotaMap(readQuota());
        goPricing(targetTool);
        return;
      }
    }

    let lastPct = -1;
    const dspOpts: DspOptions = {
      isCancelled: isStale,
      onProgress: (pct) => {
        const p = Math.round(pct);
        if (p === lastPct || isStale()) return;
        lastPct = p;
        setToolStates((prev) =>
          prev[targetTool].isProcessing ? { ...prev, [targetTool]: { ...prev[targetTool], progress: p } } : prev
        );
      },
    };

    try {
      const ctx = getAudioContext();
      await nextFrame();

      let outputBuffer: AudioBuffer;
      let vocalBuffers: ToolExecutionState['vocalBuffers'];

      if (targetTool === 'trim') {
        const dur = src.duration;
        const s = Math.floor(clamp(live.current.trimStart, 0, dur) * sr);
        const e = Math.min(src.length, Math.floor(clamp(live.current.trimEnd, 0, dur) * sr));
        if (e - s < Math.floor(sr * 0.05)) {
          throw new DspError('EMPTY', 'Rentang potong terlalu pendek.');
        }
        outputBuffer = makeBuffer(ctx, chs.map((c) => c.slice(s, e)), sr);
      } else if (targetTool === 'reverse') {
        outputBuffer = makeBuffer(ctx, chs.map((c) => c.slice().reverse()), sr);
      } else if (targetTool === 'convert') {
        outputBuffer = src;
      } else if (targetTool === 'compress') {
        const tier = compressTiers.find((t) => t.id === (overrideTier || selectedCompressTier)) || compressTiers[2];
        const out = downsampleForCompress(chs, sr, tier.targetRate, tier.isMono);
        outputBuffer = makeBuffer(ctx, out.channels, out.sampleRate);
      } else if (targetTool === 'noise_reduction') {
        const out = await spectralNoiseGate(chs, sr, noiseAggression, dspOpts);
        outputBuffer = makeBuffer(ctx, out, sr);
      } else {
        if (chs.length < 2) {
          throw new DspError('MONO', 'Audio stereo (2 kanal) dibutuhkan untuk ekstraksi vokal.');
        }
        const out = await centerIsolate(chs[0], chs[1], sr, dspOpts);
        vocalBuffers = {
          vocal: makeBuffer(ctx, out.vocal, sr),
          instrumental: makeBuffer(ctx, out.instrumental, sr),
        };
        outputBuffer = vocalBuffers.vocal;
      }

      if (isStale()) return;

      let previewUrl: string | null = null;
      let vocalUrls: ToolExecutionState['vocalUrls'];
      if (vocalBuffers) {
        vocalUrls = {
          vocal: URL.createObjectURL(audioBufferToWav(vocalBuffers.vocal, 16)),
          instrumental: URL.createObjectURL(audioBufferToWav(vocalBuffers.instrumental, 16)),
        };
      } else {
        previewUrl = URL.createObjectURL(audioBufferToWav(outputBuffer, 16));
      }

      if (isStale()) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        if (vocalUrls) {
          URL.revokeObjectURL(vocalUrls.vocal);
          URL.revokeObjectURL(vocalUrls.instrumental);
        }
        void refundReservation(targetTool, reservation);
        return;
      }

      if (targetTool === 'compress') compressChargedRef.current = true;

      setToolStates((prev) => ({
        ...prev,
        [targetTool]: {
          isProcessing: false,
          progress: 100,
          resultBuffer: outputBuffer,
          previewUrl,
          expiresAt: Date.now() + RESULT_TTL_MS,
          vocalBuffers,
          vocalUrls,
        },
      }));
      onSuccessToast(`${TOOLS.find((t) => t.id === targetTool)?.name} selesai diproses.`);
    } catch (err) {
      void refundReservation(targetTool, reservation);
      if (err instanceof DspError && err.code === 'CANCELLED') return;
      if (isStale()) return;
      console.error(err);
      let msg = 'Pemrosesan audio gagal.';
      if (err instanceof DspError) {
        if (err.code === 'MONO') msg = 'Audio stereo dibutuhkan untuk ekstraksi vokal.';
        else if (err.code === 'SILENT') msg = 'Berkas ini senyap.';
        else if (err.code === 'EMPTY') msg = 'Berkas audio kosong.';
      }
      setErrorMsg(msg);
      setToolStates((prev) => ({ ...prev, [targetTool]: { ...INITIAL_TOOL_STATE } }));
    }
  };

  const handleCompressTierChange = (newTierId: string) => {
    if (newTierId === selectedCompressTier && toolStates.compress.resultBuffer) return;
    const wasCharged = compressChargedRef.current;
    setSelectedCompressTier(newTierId);
    if (live.current.selectedTool === 'compress') stopPlayback();
    clearToolResult('compress');
    if (decodedBuffer) {
      compressChargedRef.current = wasCharged;
      void executeProcessForTool('compress', newTierId);
    }
  };

  const liveParamSig = (tool: ToolType) => {
    if (tool === 'volume') return `${loadIdRef.current}|volume|${dynamicGainDb}`;
    if (tool === 'pitch') return `${loadIdRef.current}|pitch|${dynamicPitchSemitones}|${keepTempoOnPitch}`;
    return `${loadIdRef.current}|tempo|${dynamicTempoSpeed}`;
  };

  const liveAlreadyCharged = LIVE_TOOLS.includes(selectedTool) && chargedSigRef.current[selectedTool] === liveParamSig(selectedTool);
  const liveNeedsPurchase = LIVE_TOOLS.includes(selectedTool) && !isToolsOwned && !liveAlreadyCharged && currentToolQuota <= 0;

  const getStaticExportBuffer = (): { buffer: AudioBuffer | null; suffix: string } => {
    const st = toolStates[selectedTool];
    if (selectedTool === 'vocal_separator' && st.vocalBuffers) {
      const which = vocalExtractTarget === 'instrumental' ? 'instrumental' : 'vocal';
      return { buffer: st.vocalBuffers[which], suffix: which === 'vocal' ? 'Vocal_Only' : 'Music_Only' };
    }
    return { buffer: st.resultBuffer, suffix: selectedTool };
  };

  const handleDownloadFile = async (custom?: { buffer: AudioBuffer; suffix: string }) => {
    if (!decodedBuffer || isExporting) return;

    const tool = selectedTool;
    const isLive = LIVE_TOOLS.includes(tool);
    const sig = isLive ? liveParamSig(tool) : '';
    const alreadyCharged = isLive && chargedSigRef.current[tool] === sig;

    if (isLive && !isToolsOwned && !alreadyCharged && remainingQuota(tool) <= 0) {
      goPricing(tool);
      return;
    }

    if (tool === 'convert' && blockedFormat && selectedExportFormat === blockedFormat) {
      setErrorMsg(`Berkas asal sudah berformat ${blockedFormat}. Pilih format tujuan yang berbeda.`);
      return;
    }

    // Batas panjang berkas masuk & perkiraan berkas keluar, diperiksa sebelum jatah dipakai.
    const limitBefore = checkInputDuration(tool, decodedBuffer.duration) ?? checkOutputDuration(tool, predictedOutputSec(tool));
    if (limitBefore) {
      setErrorMsg(limitBefore);
      return;
    }

    const baseName = safeFileBase(audioFile?.name || 'audio');
    const fmt = selectedExportFormat;
    const sr = decodedBuffer.sampleRate;
    const chs = bufferToChannels(decodedBuffer);
    const myLoad = loadIdRef.current;
    const stale = () => myLoad !== loadIdRef.current;

    setErrorMsg(null);
    setIsExporting(true);
    setExportProgress(0);

    let liveRes: Reservation | null = null;
    let liveDone = false;
    if (isLive && !isToolsOwned && !alreadyCharged) {
      liveRes = await reserveQuota(tool, `${sig}|${pageNonce}`);
      if (!liveRes.allowed) {
        setIsExporting(false);
        setQuotaMap(readQuota());
        goPricing(tool);
        return;
      }
    }

    let lastPct = -1;
    const dspOpts: DspOptions = {
      isCancelled: stale,
      onProgress: (p) => {
        const r = Math.round(p);
        if (r !== lastPct) {
          lastPct = r;
          setExportProgress(r);
        }
      },
    };

    try {
      await nextFrame();
      const ctx = getAudioContext();

      if (tool === 'compress') {
        const result = toolStates.compress.resultBuffer;
        if (!result) return;
        const compressLimit = checkOutputDuration(tool, result.duration);
        if (compressLimit) {
          setErrorMsg(compressLimit);
          return;
        }
        const tier = compressTiers.find((t) => t.id === selectedCompressTier) || compressTiers[2];
        const fileBase = `${baseName}_compressed_${tier.id}`;

        if (fmt === 'WAV' || fmt === 'FLAC') {
          const res = await exportAudioFile(result, fileBase, fmt, { bitDepth: 16, onProgress: (pct) => setExportProgress(Math.round(pct)) });
          onSuccessToast(`Berkas ${res.actualFormat} berhasil diunduh.`);
          return;
        }

        if (fmt === 'MP3') {
          try {
            const mp3 = await encodeMp3(result, tier.bitrate, (pct: number) => setExportProgress(Math.round(pct)));
            downloadBlob(mp3, `${fileBase}.mp3`);
            onSuccessToast(`Berkas MP3 (${tier.label}) berhasil diunduh.`);
            return;
          } catch (mp3Err) {
            const res = await exportAudioFile(result, fileBase, 'WAV', { bitDepth: 16 });
            onSuccessToast(`Berkas disimpan sebagai ${res.actualFormat}.`);
            return;
          }
        }

        const enc: CompressedAudioResult = await encodeCompressedAudio(result, tier.bitrate, (pct: number) =>
          setExportProgress(Math.round(pct))
        );
        const ext = enc.extension || 'm4a';
        downloadBlob(enc.blob, `${fileBase}.${ext}`);
        onSuccessToast(`Berkas berhasil dikompresi (.${ext}).`);
        return;
      }

      let buf: AudioBuffer | null = null;
      let suffix = tool as string;

      if (custom) {
        buf = custom.buffer;
        suffix = custom.suffix;
      } else if (tool === 'volume') {
        if (dynamicGainDb === 0) buf = decodedBuffer;
        else {
          const { channels: out, clipped } = applyGainDb(chs, dynamicGainDb);
          buf = makeBuffer(ctx, out, sr);
          if (clipped) onSuccessToast('Peringatan: sebagian puncak sinyal terpotong.');
        }
      } else if (tool === 'pitch') {
        if (dynamicPitchSemitones === 0) buf = decodedBuffer;
        else {
          const out = await pitchShift(chs, sr, dynamicPitchSemitones, keepTempoOnPitch, dspOpts);
          buf = makeBuffer(ctx, out, sr);
        }
      } else if (tool === 'tempo') {
        if (Math.abs(dynamicTempoSpeed - 1) < 0.005) buf = decodedBuffer;
        else {
          const out = await timeStretch(chs, sr, dynamicTempoSpeed, dspOpts);
          buf = makeBuffer(ctx, out, sr);
        }
      } else {
        const st = getStaticExportBuffer();
        buf = st.buffer;
        suffix = st.suffix;
      }

      if (stale()) return;
      if (!buf) return;

      const outputLimit = checkOutputDuration(tool, buf.duration);
      if (outputLimit) {
        setErrorMsg(outputLimit);
        return;
      }

      const exported = await exportAudioFile(buf, `${baseName}_${suffix}`, fmt, {
        onProgress: (pct) => setExportProgress(Math.round(pct)),
      });

      if (isLive && !alreadyCharged) chargedSigRef.current[tool] = sig;
      liveDone = true;
      onSuccessToast(exported.note ? `Berkas diunduh. ${exported.note}` : `Berkas ${fmt} berhasil diunduh.`);
    } catch (err) {
      if (err instanceof DspError && err.code === 'CANCELLED') return;
      console.error(err);
      setErrorMsg(`Gagal mengekspor berkas ${fmt}. Coba format lain.`);
    } finally {
      if (liveRes && !liveDone) void refundReservation(tool, liveRes);
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const toolMeta = TOOLS.find((t) => t.id === selectedTool)!;

  // Batas panjang audio untuk alat yang sedang dipilih (60 / 90 menit; lihat services/audioLimits.ts).
  const limitMsg = decodedBuffer
    ? checkInputDuration(selectedTool, decodedBuffer.duration) ?? checkOutputDuration(selectedTool, predictedOutputSec(selectedTool))
    : null;

  const extraGate: QuotaGate = useMemo(
    () => ({
      use: async (toolId, sessionKey) => {
        if (isToolsOwned) return true;
        const sKey = sessionKey ? `${toolId}:${sessionKey}` : null;
        if (sKey && extraSessionRef.current.has(sKey)) return true;
        const res = await reserveQuota(toolId, sKey ? `${sKey}|${pageNonce}` : undefined);
        if (!res.allowed) {
          goPricingRef.current(toolId);
          return false;
        }
        paidExtraRef.current.add(toolId);
        if (sKey) extraSessionRef.current.add(sKey);
        extraResRef.current.set(sKey ?? `${toolId}:last`, res);
        return true;
      },
      has: (toolId, sessionKey) => (sessionKey ? extraSessionRef.current.has(`${toolId}:${sessionKey}`) : false),
      exhausted: (toolId) => !isToolsOwned && remainingQuota(toolId) <= 0,
      refund: (toolId, sessionKey) => {
        if (isToolsOwned) return;
        const sKey = sessionKey ? `${toolId}:${sessionKey}` : null;
        const k = sKey ?? `${toolId}:last`;
        const res = extraResRef.current.get(k) ?? null;
        extraResRef.current.delete(k);
        if (sKey) extraSessionRef.current.delete(sKey);
        void refundReservation(toolId, res);
      },
      locked: (toolId) => !isToolsOwned && remainingQuota(toolId) <= 0 && !paidExtraRef.current.has(toolId),
      blocked: (toolId) => goPricingRef.current(toolId),
    }),
    [isToolsOwned]
  );

  const pickTool = (id: UnifiedToolId) => {
    stopPlayback();
    if (isExtraId(id)) {
      setSelectedExtra(id);
    } else {
      setSelectedExtra(null);
      setSelectedTool(id);
    }
  };
  const isLiveTool = LIVE_TOOLS.includes(selectedTool);
  const isProcessing = currentToolState.isProcessing;
  const staticNeedsPurchase =
    !isLiveTool &&
    !isToolsOwned &&
    currentToolQuota <= 0 &&
    !(selectedTool === 'compress' && compressChargedRef.current);

  const hasPaidWork = isLiveTool
    ? liveAlreadyCharged
    : Boolean(currentToolState.resultBuffer || currentToolState.vocalBuffers || currentToolState.isProcessing) ||
      (selectedTool === 'compress' && compressChargedRef.current);
  const panelLocked = !isToolsOwned && !selectedExtra && currentToolQuota <= 0 && !hasPaidWork;
  const guardBuiltin = quotaGuardProps(panelLocked, () => goPricing(selectedTool));

  // Tombol "Unggah Berkas" di header dipakai bersama: alat bawaan memuat berkas ke suite ini,
  // alat tambahan berbasis berkas membuka pemilih berkas miliknya sendiri.
  const showUploadBtn = !selectedExtra || (EXTRA_FILE_TOOLS.includes(selectedExtra) && extraPicker !== null);
  const uploadLoading = selectedExtra ? Boolean(extraPicker?.loading) : isLoadingFile;
  const uploadLabel = selectedExtra
    ? extraPicker?.label ?? 'Unggah Berkas'
    : isLoadingFile
    ? 'Membaca...'
    : audioFile
    ? 'Ganti Berkas'
    : 'Unggah Berkas';
  const handleUploadClick = () => {
    if (selectedExtra) {
      if (extraGate.locked(selectedExtra)) {
        goPricing(selectedExtra);
        return;
      }
      extraPicker?.open();
      return;
    }
    if (panelLocked) goPricing(selectedTool);
    else fileInputRef.current?.click();
  };

  const predictedPeak = sourcePeak * Math.pow(10, dynamicGainDb / 20);
  const clipWarning = selectedTool === 'volume' && dynamicGainDb > 0 && predictedPeak > 1;
  const safeGainDb = sourcePeak > 0 ? Math.floor(-20 * Math.log10(sourcePeak) * 10) / 10 : 0;

  const remainingMin = currentToolState.expiresAt
    ? Math.max(1, Math.ceil((currentToolState.expiresAt - nowTick) / 60000))
    : null;

  const playLabel = isPlaying
    ? 'Berhenti'
    : isLiveTool || (selectedTool === 'trim' && !hasResult)
    ? 'Dengar Audio (Live Preview)'
    : hasResult
    ? selectedTool === 'vocal_separator'
      ? `Dengar Hasil (${vocalPreviewTarget === 'vocal' ? 'Vokal' : 'Musik'})`
      : 'Dengar Hasil'
    : 'Dengar Asli';

  const exportBusyLabel = selectedTool === 'compress' ? 'Mengompres' : 'Menyiapkan';

  return (
    <section id="audio-tools-section" className="w-full">
      <div className="rounded-2xl bg-surface border border-white/[0.08] p-5 sm:p-7 shadow-xl space-y-6">
        {audioUrl && (
          <audio
            ref={audioElementRef}
            src={activeAudioSrc || undefined}
            onLoadedMetadata={applyRate}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            onError={() => setIsPlaying(false)}
            className="hidden"
          />
        )}

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-accent" />
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">Audio Processing Tools Suite</h3>
            </div>
            <p className="text-xs text-gray-300">
              Potong, perbaiki, ubah, rekam, dan berlatih musik dalam satu tempat.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap lg:justify-end shrink-0">
            {isToolsOwned ? (
              <span className="text-emerald-400 bg-emerald-500/10 h-9 px-3.5 rounded-xl border border-emerald-500/20 text-xs font-bold flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" /> Sudah Dimiliki
              </span>
            ) : activeQuota > 0 ? (
              <span className="text-accent bg-accent/10 h-9 px-3.5 rounded-xl border border-accent/20 text-xs font-bold flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-accent" />
                {activeQuota === DAILY_FREE_QUOTA
                  ? `${DAILY_FREE_QUOTA} penggunaan gratis hari ini (per alat)`
                  : `${activeQuota} penggunaan gratis tersisa (per alat)`}
              </span>
            ) : (
              <button
                type="button"
                onClick={onUnlockEditor}
                className="h-9 px-3.5 rounded-xl bg-accent hover:bg-accent/80 text-on-accent font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Lock className="w-3.5 h-3.5" /> Beli Audio Tools — Rp{toolsPrice.toLocaleString('id-ID')}
              </button>
            )}

            {showUploadBtn && (
              <button
                type="button"
                onClick={handleUploadClick}
                disabled={uploadLoading}
                className="h-9 px-3.5 rounded-xl bg-black/50 hover:bg-black/80 border border-white/10 text-xs font-bold text-gray-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {uploadLoading ? (
                  <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                ) : (
                  <Upload className="w-3.5 h-3.5 text-accent" />
                )}
                <span>{uploadLabel}</span>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={
                selectedTool === 'convert' && convertSourceMode === 'video'
                  ? 'video/*,.mp4,.mkv,.webm,.mov,.avi,.flv,.wmv,.m4v,.3gp,.ts,.ogv'
                  : 'audio/*,video/*'
              }
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-300"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="flex-1 leading-relaxed">{errorMsg}</span>
            <button type="button" onClick={() => setErrorMsg(null)} className="cursor-pointer text-red-300 hover:text-white" aria-label="Tutup pesan">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Kelompok alat */}
        <div role="tablist" aria-label="Kelompok alat audio" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {TOOL_GROUPS.map((g) => {
            const GroupIcon = g.icon;
            const on = g.id === activeGroup.id;
            const busy = g.tools.some((id) => !isExtraId(id) && toolStates[id].isProcessing);
            const ready = g.tools.some((id) => !isExtraId(id) && toolStates[id].resultBuffer);
            return (
              <button
                key={g.id}
                role="tab"
                aria-selected={on}
                type="button"
                onClick={() => { if (!on) pickTool(g.tools[0]); }}
                className={`relative p-3 rounded-xl border text-left transition-all cursor-pointer min-w-0 ${
                  on ? 'bg-accent/15 border-accent text-white' : 'bg-black/40 text-gray-300 border-white/[0.06] hover:border-white/20'
                }`}
              >
                {busy && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-400 animate-ping" />}
                {!busy && ready && <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-400" title="Ada hasil siap" />}
                <span className="flex items-center gap-2 text-xs font-black leading-tight">
                  <GroupIcon className={`w-4 h-4 shrink-0 ${on ? 'text-accent' : ''}`} />
                  <span className="min-w-0 break-words">{g.label}</span>
                </span>
                <span className="mt-1 block text-[10px] text-gray-400 leading-snug">{g.tools.length} alat</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-400 -mt-2">{activeGroup.desc}</p>

        {/* Alat di dalam kelompok terpilih */}
        <div role="tablist" aria-label={`Alat di ${activeGroup.label}`} className="flex flex-wrap gap-2 -mt-2">
          {activeGroup.tools.map((id) => {
            const info = toolInfo(id);
            const IconComp = info.icon;
            const isSelected = activeToolId === id;
            const tState = isExtraId(id) ? null : toolStates[id];
            return (
              <button
                type="button"
                role="tab"
                aria-selected={isSelected}
                key={id}
                onClick={() => pickTool(id)}
                className={`px-3.5 py-2.5 rounded-xl border flex items-center gap-2 text-xs transition-all cursor-pointer relative ${
                  isSelected
                    ? 'bg-accent text-on-accent border-accent shadow-md font-black'
                    : 'bg-black/40 text-gray-300 border-white/[0.06] hover:border-white/20 font-bold'
                }`}
              >
                {tState?.isProcessing && <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-blue-400 animate-ping" />}
                {tState?.resultBuffer && !tState.isProcessing && (
                  <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-emerald-400" title="Hasil siap" />
                )}
                <IconComp className="w-4 h-4 shrink-0" />
                <span>{info.name}</span>
              </button>
            );
          })}
        </div>

        {/* Panel alat tambahan */}
        <ExtraToolPanel
          active={selectedExtra}
          gate={extraGate}
          onSuccessToast={onSuccessToast}
          studioActiveTrack={studioActiveTrack}
          onPicker={setExtraPicker}
        />

        {/* Panel Kontrol (9 alat bawaan) */}
        {!selectedExtra && (
          <div className={PANEL_CLS} {...guardBuiltin}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-white">{toolMeta.name}</h4>
                <InfoTip label={`Info alat ${toolMeta.name}`}>
                  <p>{toolMeta.desc}.</p>
                  {TOOL_INFO[selectedTool].map((line) => (
                    <p key={line} className="text-gray-400">
                      {line}
                    </p>
                  ))}
                </InfoTip>
              </div>

              {audioFile && <FileChip name={audioFile.name} meta={`${decodedBuffer?.duration.toFixed(1)}s`} />}
            </div>

            {!decodedBuffer && (
              <EmptyFileNotice>
                Unggah berkas audio (atau video untuk ekstrak audio) terlebih dahulu untuk memakai alat ini.
              </EmptyFileNotice>
            )}
            <LimitNote
              text={`Durasi berkas maks. ${limitLabelFor(selectedTool)} untuk alat ini (berlaku untuk berkas masuk dan hasil unduhan).`}
              alert={limitMsg}
            />

            <div className="pt-2">
              {/* TRIM / CUT */}
              {selectedTool === 'trim' && (
                <div className="space-y-4 text-xs">
                  <div
                    ref={timelineRef}
                    className="relative w-full h-16 bg-black/60 rounded-xl border border-white/10 overflow-hidden select-none p-1 touch-none"
                  >
                    {waveformPath && (
                      <svg
                        className="absolute inset-0 w-full h-full pointer-events-none text-gray-500"
                        viewBox="0 0 400 100"
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <path d={waveformPath} stroke="currentColor" strokeWidth="0.8" fill="none" vectorEffect="non-scaling-stroke" />
                      </svg>
                    )}
                    <div
                      className="absolute top-0 bottom-0 bg-accent/25 border-x-2 border-accent flex items-center justify-center pointer-events-none"
                      style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }}
                    >
                      <span className="text-[10px] font-mono font-bold text-accent bg-black/80 px-2 py-0.5 rounded shadow">
                        Area Simpan: {(trimEnd - trimStart).toFixed(1)}s
                      </span>
                    </div>
                    <div
                      ref={playheadRef}
                      className="absolute top-0 bottom-0 w-px bg-white pointer-events-none z-[5]"
                      style={{ display: 'none' }}
                    />

                    {(['start', 'end'] as const).map((which) => (
                      <div
                        key={which}
                        onPointerDown={handleTrimHandleDrag(which)}
                        className="absolute top-0 bottom-0 w-4 -ml-2 z-10 flex items-center justify-center cursor-ew-resize group touch-none"
                        style={{ left: `${which === 'start' ? startPercent : endPercent}%` }}
                      >
                        <div className="w-1 h-full bg-accent group-hover:bg-accent/70 group-active:bg-white transition-colors" />
                        <div className="absolute w-3 h-6 bg-accent group-hover:bg-accent/70 group-active:bg-white rounded-sm shadow" />
                      </div>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2 bg-black/50 p-3 rounded-xl border border-white/5">
                      <div className="flex justify-between items-center">
                        <label className="text-gray-300 font-bold">Batas Awal (Start):</label>
                        <div className="flex items-center gap-1">
                          <TimeField
                            value={trimStart}
                            min={0}
                            max={Math.max(0, trimEnd - minGap)}
                            disabled={!decodedBuffer}
                            onCommit={changeTrimStart}
                          />
                          <span className="text-gray-400 font-mono">detik</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={totalDuration}
                        step={0.01}
                        value={trimStart}
                        disabled={!decodedBuffer}
                        onChange={(e) => changeTrimStart(Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent disabled:opacity-40"
                      />
                    </div>

                    <div className="space-y-2 bg-black/50 p-3 rounded-xl border border-white/5">
                      <div className="flex justify-between items-center">
                        <label className="text-gray-300 font-bold">Batas Akhir (End):</label>
                        <div className="flex items-center gap-1">
                          <TimeField
                            value={trimEnd}
                            min={Math.min(totalDuration, trimStart + minGap)}
                            max={totalDuration}
                            disabled={!decodedBuffer}
                            onCommit={changeTrimEnd}
                          />
                          <span className="text-gray-400 font-mono">detik</span>
                        </div>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={totalDuration}
                        step={0.01}
                        value={trimEnd}
                        disabled={!decodedBuffer}
                        onChange={(e) => changeTrimEnd(Number(e.target.value))}
                        className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent disabled:opacity-40"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* VOLUME / GAIN */}
              {selectedTool === 'volume' && (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="text-gray-300 font-bold block">Penyesuaian Gain Dinamis:</label>
                    <div className="flex items-center gap-2">
                      {dynamicGainDb !== 0 && (
                        <button
                          type="button"
                          onClick={() => setDynamicGainDb(0)}
                          className="text-[11px] text-gray-400 hover:text-white underline cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                      <DecimalField value={dynamicGainDb} min={-24} max={24} unit="dB" onCommit={setDynamicGainDb} />
                    </div>
                  </div>
                  <input
                    type="range"
                    min="-24"
                    max="24"
                    step="0.01"
                    value={dynamicGainDb}
                    onChange={(e) => setDynamicGainDb(round2(Number(e.target.value)))}
                    className="w-full h-2 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                  />
                  {clipWarning && (
                    <p className="flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
                      <span>
                        Puncak sinyal diperkirakan melewati 0 dBFS.
                        {safeGainDb > 0 ? ` Gain maksimum aman sekitar +${safeGainDb} dB.` : ''}
                      </span>
                    </p>
                  )}
                </div>
              )}

              {/* PITCH / TRANSPOSE */}
              {selectedTool === 'pitch' && (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="text-gray-300 font-bold block">Pergeseran Nada Dinamis:</label>
                    <div className="flex items-center gap-2">
                      {dynamicPitchSemitones !== 0 && (
                        <button
                          type="button"
                          onClick={() => setDynamicPitchSemitones(0)}
                          className="text-[11px] text-gray-400 hover:text-white underline cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                      <DecimalField
                        value={dynamicPitchSemitones}
                        min={-12}
                        max={12}
                        unit="semitone"
                        onCommit={setDynamicPitchSemitones}
                      />
                    </div>
                  </div>
                  <input
                    type="range"
                    min="-12"
                    max="12"
                    step="0.01"
                    value={dynamicPitchSemitones}
                    onChange={(e) => setDynamicPitchSemitones(round2(Number(e.target.value)))}
                    className="w-full h-2 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                  />
                  <div className="flex items-center gap-2 pt-1 bg-black/40 p-2.5 rounded-lg border border-white/5">
                    <input
                      type="checkbox"
                      id="chk-keep-tempo"
                      checked={keepTempoOnPitch}
                      onChange={(e) => setKeepTempoOnPitch(e.target.checked)}
                      className="accent-accent w-4 h-4 cursor-pointer"
                    />
                    <label htmlFor="chk-keep-tempo" className="text-gray-300 font-bold cursor-pointer select-none">
                      Kunci Tempo (Keep Tempo)
                    </label>
                  </div>
                </div>
              )}

              {/* TEMPO / SPEED */}
              {selectedTool === 'tempo' && (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <label className="text-gray-300 font-bold block">Kecepatan Putar Dinamis:</label>
                    <div className="flex items-center gap-2">
                      {Math.abs(dynamicTempoSpeed - 1) > 0.0001 && (
                        <button
                          type="button"
                          onClick={() => setDynamicTempoSpeed(1)}
                          className="text-[11px] text-gray-400 hover:text-white underline cursor-pointer"
                        >
                          Reset
                        </button>
                      )}
                      <DecimalField value={dynamicTempoSpeed} min={0.5} max={2} unit="x" onCommit={setDynamicTempoSpeed} />
                    </div>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.01"
                    value={dynamicTempoSpeed}
                    onChange={(e) => setDynamicTempoSpeed(round2(Number(e.target.value)))}
                    className="w-full h-2 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                  />
                  {decodedBuffer && (
                    <p className="text-[11px] text-gray-400">
                      Durasi hasil: {(decodedBuffer.duration / dynamicTempoSpeed).toFixed(2)}s (asli {decodedBuffer.duration.toFixed(2)}s)
                    </p>
                  )}
                </div>
              )}

              {/* CONVERT */}
              {selectedTool === 'convert' && (
                <div className="space-y-3 text-xs">
                  <div className="flex items-center gap-2 border-b border-white/10 pb-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => setConvertSourceMode('audio')}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold cursor-pointer ${
                        convertSourceMode === 'audio' ? 'bg-accent text-on-accent shadow' : 'bg-black/50 text-gray-400 hover:text-white'
                      }`}
                    >
                      <Music className="w-3.5 h-3.5" />
                      <span>Audio ke Audio</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setConvertSourceMode('video');
                        fileInputRef.current?.click();
                      }}
                      className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold cursor-pointer ${
                        convertSourceMode === 'video' ? 'bg-accent text-on-accent shadow' : 'bg-black/50 text-gray-400 hover:text-white'
                      }`}
                    >
                      <Film className="w-3.5 h-3.5" />
                      <span>Video ke Audio</span>
                    </button>
                  </div>
                  {blockedFormat && (
                    <p className="text-[11px] text-gray-400">
                      Format asal: <span className="font-bold text-gray-200">{blockedFormat}</span>. Pilih format tujuan yang berbeda.
                    </p>
                  )}
                </div>
              )}

              {/* COMPRESS */}
              {selectedTool === 'compress' && (
                <div className="space-y-3 text-xs">
                  <span className="text-gray-300 font-bold block">Pilih Tingkatan Kompresi:</span>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                    {compressTiers.map((tier) => {
                      const isSel = selectedCompressTier === tier.id;
                      return (
                        <button
                          key={tier.id}
                          type="button"
                          onClick={() => handleCompressTierChange(tier.id)}
                          className={`p-3 rounded-xl border flex flex-col justify-between text-left transition-all cursor-pointer ${
                            isSel
                              ? 'bg-accent text-on-accent border-accent font-bold shadow-md'
                              : 'bg-black/50 text-gray-300 border-white/[0.08] hover:border-white/20'
                          }`}
                        >
                          <div>
                            <span className="text-xs font-black block">{tier.name}</span>
                            <span className="text-[10px] opacity-80 font-mono block mt-0.5">{tier.label}</span>
                          </div>
                          <p className="text-[9px] opacity-75 mt-2 leading-tight">{tier.desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* NOISE REDUCTION */}
              {selectedTool === 'noise_reduction' && (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-accent font-bold">
                    <Waves className="w-4 h-4" />
                    <span>Spectral Noise Gate</span>
                  </div>
                  <div className="space-y-1">
                    <label className="text-gray-300 font-bold block">Intensitas Pembersihan: {noiseAggression}%</label>
                    <input
                      type="range"
                      min="10"
                      max="100"
                      value={noiseAggression}
                      onChange={(e) => {
                        setNoiseAggression(Number(e.target.value));
                        if (toolStatesRef.current.noise_reduction.resultBuffer || toolStatesRef.current.noise_reduction.isProcessing) {
                          if (live.current.selectedTool === 'noise_reduction') stopPlayback();
                          clearToolResult('noise_reduction');
                        }
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
                    />
                  </div>
                </div>
              )}

              {/* VOCAL ISOLATOR */}
              {selectedTool === 'vocal_separator' && (
                <div className="space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-accent font-bold">
                    <Mic2 className="w-4 h-4" />
                    <span>Center-Phase Vocal Isolation</span>
                  </div>
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    {(['vocal', 'instrumental', 'both'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => {
                          if (live.current.selectedTool === 'vocal_separator') stopPlayback();
                          setVocalExtractTarget(mode);
                        }}
                        className={`px-3 py-1.5 rounded-lg font-bold cursor-pointer ${
                          vocalExtractTarget === mode ? 'bg-accent text-on-accent' : 'bg-black/60 text-gray-400 hover:text-white'
                        }`}
                      >
                        {mode === 'vocal' ? 'Vokal Saja' : mode === 'instrumental' ? 'Musik Saja' : 'Keduanya (2 File)'}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Format Unduhan & Aksi */}
            <div className="pt-3 border-t border-white/[0.06] space-y-3">
              <FormatRow
                value={selectedExportFormat}
                onChange={setSelectedExportFormat}
                disabled={blockedFormat ? { [blockedFormat]: 'Sama dengan format berkas asal' } : undefined}
              />

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  {!isLiveTool &&
                    (staticNeedsPurchase ? (
                      <button
                        type="button"
                        data-quota-free
                        onClick={onUnlockEditor}
                        className={BTN_PRIMARY}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Beli Audio Tools — Rp{toolsPrice.toLocaleString('id-ID')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => executeProcessForTool(selectedTool)}
                        disabled={isProcessing || Boolean(limitMsg)}
                        className={BTN_PRIMARY}
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Memproses ({currentToolState.progress}%)...</span>
                          </>
                        ) : (
                          <>
                            <Play className="w-3.5 h-3.5 fill-on-accent" />
                            <span>Jalankan {toolMeta.name}</span>
                          </>
                        )}
                      </button>
                    ))}

                  {audioUrl && (
                    <button
                      type="button"
                      onClick={togglePlayback}
                      className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                    >
                      {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      <span>{playLabel}</span>
                    </button>
                  )}

                  {Boolean(currentToolState.resultBuffer || currentToolState.vocalBuffers) && (
                    <button
                      type="button"
                      onClick={() => handleClearToolResult(selectedTool)}
                      className="px-3.5 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 hover:text-red-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Hasil</span>
                    </button>
                  )}
                </div>

                {(hasResult || isLiveTool) && decodedBuffer && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> Siap
                    </span>
                    {liveNeedsPurchase ? (
                      <button
                        type="button"
                        data-quota-free
                        onClick={onUnlockEditor}
                        className={BTN_PRIMARY}
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Beli Audio Tools — Rp{toolsPrice.toLocaleString('id-ID')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDownloadFile()}
                        disabled={isExporting || Boolean(limitMsg)}
                        className={BTN_DOWNLOAD}
                      >
                        {isExporting ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>
                              {exportBusyLabel} ({exportProgress}%)...
                            </span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5" />
                            <span>Unduh {selectedExportFormat}</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                )}
              </div>

              {remainingMin !== null && (
                <p className="text-[11px] text-gray-500">
                  Hasil disimpan sementara di memori browser (sisa ±{remainingMin} menit).
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
