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
  Info,
  Mic2,
  Upload,
  Merge,
  Eraser,
  Activity,
  AudioLines,
  Timer,
  Mic,
  Sparkles,
  Play,
  Pause,
  Download,
  CheckCircle,
  Loader2,
  FileAudio,
  Film,
  Music,
  Trash2,
  Lock,
  AlertTriangle,
  X,
} from 'lucide-react';
import { AudioEntitlements } from '../../types';
import { ExtraToolPanel, EXTRA_TOOL_META, EXTRA_SLUG_TO_TOOL, type ExtraToolId } from './AudioExtraTools';
import { consumeExtraQuota, remainingExtraQuota } from '../../services/extraToolsQuota';
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
  /** Harga Audio Tools Suite (Rp), diambil dari sumber harga yang sama dengan keranjang. */
  toolsPrice?: number;
  /** false saat seksi Audio Tools disembunyikan (tetap ter-mount agar berkas & hasil proses tidak hilang). */
  isActive?: boolean;
  /** Alat yang dibuka pertama kali (mis. dari URL /alat-audio/<slug>); bisa alat bawaan atau alat tambahan. */
  initialTool?: UnifiedToolId | null;
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
  { id: 'trim', name: 'Trim / Cut', desc: 'Potong audio dengan menentukan batas awal & akhir (input manual)', icon: Scissors },
  { id: 'volume', name: 'Volume / Gain', desc: 'Atur penguatan gain dinamis tanpa tombol apply', icon: Volume2 },
  { id: 'pitch', name: 'Pitch / Transpose', desc: 'Ubah nada dinamis dengan opsi Kunci Tempo', icon: Sliders },
  { id: 'tempo', name: 'Tempo / Speed', desc: 'Ubah kecepatan secara dinamis tanpa mengubah nada', icon: FastForward },
  { id: 'reverse', name: 'Reverse', desc: 'Balikkan urutan sampel audio untuk efek transisi', icon: RotateCcw },
  { id: 'convert', name: 'Convert', desc: 'Konversi audio antar format (MP3, WAV, M4A, FLAC) & ekstrak audio dari video', icon: RefreshCw },
  { id: 'compress', name: 'Compress', desc: '5 tingkatan kompresi dengan estimasi ukuran & bitrate', icon: Minimize2 },
  { id: 'noise_reduction', name: 'Noise Reduction', desc: 'Peredam desis & dengung latar dengan spectral gate', icon: Waves },
  { id: 'vocal_separator', name: 'Vocal Isolator', desc: 'Pisahkan vokal & musik lewat teknik center-phase', icon: Mic2 },
];

// ---------------------------------------------------------------------------
// Suite gabungan: 9 alat bawaan + 6 alat tambahan, dikelompokkan menurut fungsi
// ---------------------------------------------------------------------------

export type UnifiedToolId = ToolType | ExtraToolId;

interface ToolGroup {
  id: string;
  label: string;
  icon: React.ElementType;
  desc: string;
  tools: UnifiedToolId[];
}

const TOOL_GROUPS: ToolGroup[] = [
  { id: 'cut', label: 'Potong & Susun', icon: Scissors, desc: 'Ubah struktur audio: potong bagian, sambung beberapa file, atau balik urutannya.', tools: ['trim', 'merge', 'reverse'] },
  { id: 'sound', label: 'Perbaiki Suara', icon: Sparkles, desc: 'Bersihkan dan seimbangkan suara: volume, jeda hening, loudness, mono, dan noise.', tools: ['volume', 'clean', 'noise_reduction'] },
  { id: 'music', label: 'Nada, Tempo & Vokal', icon: Music, desc: 'Olah unsur musik: ubah nada, ubah kecepatan, atau pisahkan vokal dari musik.', tools: ['pitch', 'tempo', 'vocal_separator'] },
  { id: 'format', label: 'Format & Ukuran', icon: RefreshCw, desc: 'Ganti format file (termasuk ekstrak audio dari video) atau perkecil ukurannya.', tools: ['convert', 'compress'] },
  { id: 'record', label: 'Rekam & Analisis', icon: Mic, desc: 'Ambil audio baru dari mikrofon, atau cari tahu tempo dan kunci nada sebuah lagu.', tools: ['recorder', 'bpm'] },
  { id: 'practice', label: 'Latihan Musik', icon: Timer, desc: 'Alat langsung untuk berlatih: jaga tempo dengan metronom dan setel instrumen dengan tuner.', tools: ['metronome', 'tuner'] },
];

const EXTRA_IDS = new Set<string>(EXTRA_TOOL_META.map((t) => t.id));
const isExtraId = (id: UnifiedToolId): id is ExtraToolId => EXTRA_IDS.has(id);

/** Nama, ikon, dan deskripsi untuk semua 15 alat. */
function toolInfo(id: UnifiedToolId): { name: string; icon: React.ElementType; desc: string } {
  const base = TOOLS.find((t) => t.id === id);
  if (base) return { name: base.name, icon: base.icon, desc: base.desc };
  const ex = EXTRA_TOOL_META.find((t) => t.id === id)!;
  return { name: ex.label, icon: ex.icon, desc: ex.desc };
}

/** Slug halaman SEO (/alat-audio/<slug>) -> alat yang dibuka. */
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

/** Tool real-time: tanpa tombol "Jalankan", hasil dibuat saat diunduh. */
const LIVE_TOOLS: ToolType[] = ['volume', 'pitch', 'tempo'];
/** Tool yang hasilnya dihitung sekali lalu diputar dari file hasil. */
const STATIC_RESULT_TOOLS: ToolType[] = ['trim', 'reverse', 'convert', 'compress', 'noise_reduction', 'vocal_separator'];

const DAILY_FREE_QUOTA = 2;
const RESULT_TTL_MS = 5 * 60 * 1000;
const QUOTA_PREFIX = 'muzeck_daily_quota_';

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

// ---------------------------------------------------------------------------
// Kuota harian (tanggal lokal, bukan UTC, supaya reset tepat tengah malam lokal)
// ---------------------------------------------------------------------------

function localDateKey(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function defaultQuota(): Record<ToolType, number> {
  const q = {} as Record<ToolType, number>;
  TOOLS.forEach((t) => {
    q[t.id] = DAILY_FREE_QUOTA;
  });
  return q;
}

function readQuota(): Record<ToolType, number> {
  const q = defaultQuota();
  try {
    const key = QUOTA_PREFIX + localDateKey();
    // bersihkan kuota hari-hari sebelumnya
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(QUOTA_PREFIX) && k !== key) localStorage.removeItem(k);
    }
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      TOOLS.forEach((t) => {
        const v = Number(parsed?.[t.id]);
        if (Number.isFinite(v)) q[t.id] = Math.max(0, Math.min(DAILY_FREE_QUOTA, Math.floor(v)));
      });
    }
  } catch {
    /* localStorage tidak tersedia: pakai default */
  }
  return q;
}

function writeQuota(q: Record<ToolType, number>) {
  try {
    localStorage.setItem(QUOTA_PREFIX + localDateKey(), JSON.stringify(q));
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------
// Utilitas
// ---------------------------------------------------------------------------

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
  // Tidak boleh melebihi bitrate sumber dan harus menurun ketat antar tingkat.
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

/** Bulatkan ke 2 desimal agar tidak muncul artefak floating point (mis. 0.30000000000000004). */
const round2 = (v: number) => Math.round(v * 100) / 100;

/** Tampilan angka bertanda: 0 -> "0", 0.3 -> "+0.3", -1.25 -> "-1.25". */
const formatSigned = (v: number) => {
  const r = round2(v);
  return r > 0 ? `+${r}` : `${r}`;
};

/** Format berkas asal (null bila video / tidak dikenali), dipakai agar Convert tidak mengonversi ke format yang sama. */
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

// ---------------------------------------------------------------------------
// Tombol informasi (popover) agar penjelasan tiap alat tidak memenuhi panel
// ---------------------------------------------------------------------------

const InfoTip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors cursor-pointer ${
          open
            ? 'bg-accent/20 text-accent border-accent/40'
            : 'bg-black/40 text-gray-400 border-white/10 hover:text-accent hover:border-accent/40'
        }`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full mt-2 z-30 w-72 sm:w-80 max-w-[calc(100vw-3rem)] rounded-xl bg-[#0b130e] border border-white/15 shadow-2xl p-3.5 space-y-2 text-[11px] leading-relaxed text-gray-300 font-normal normal-case tracking-normal"
        >
          {children}
        </div>
      )}
    </span>
  );
};

const FORMAT_INFO =
  'MP3 di-encode dengan LAME (320 kbps untuk tool selain Compress), FLAC lossless 16-bit, WAV PCM 16-bit. M4A memakai encoder bawaan browser (bisa berupa .webm/.ogg).';

/** Penjelasan tambahan per alat (di luar deskripsi singkat), ditampilkan di popover info. */
const TOOL_INFO: Record<ToolType, string[]> = {
  trim: [],
  volume: [
    `Geser slider atau ketik langsung, desimal didukung (mis. ${formatSigned(0.3)} dB). Rentang -24 sampai +24 dB.`,
  ],
  pitch: [
    `Desimal didukung (mis. ${formatSigned(0.02)} semitone = geser nada 2 cent). Rentang -12 sampai +12 semitone.`,
  ],
  tempo: ['Geser slider atau ketik langsung, desimal didukung (mis. 1.25x). Rentang 0.5x sampai 2x.'],
  reverse: [],
  convert: [],
  compress: [
    'Memilih tingkatan langsung memproses ulang. Unduhan MP3 di-encode dengan LAME pada bitrate di atas (disesuaikan ke bitrate MP3 standar terdekat). M4A memakai encoder bawaan browser; bila hasilnya berbeda dari pilihan, ekstensi berkas disesuaikan dan Anda diberi tahu. WAV (PCM 16-bit) dan FLAC (lossless 16-bit) menyimpan hasil downsample tanpa kompresi lossy, sehingga bitrate tidak berlaku.',
  ],
  noise_reduction: [],
  vocal_separator: [
    'Memisahkan elemen yang berada di tengah stereo. Instrumen yang juga di tengah (bass, kick, snare) bisa ikut terbawa ke hasil vokal; hasil terbaik pada rekaman stereo dengan vokal di tengah.',
  ],
};

// ---------------------------------------------------------------------------
// Input angka desimal bebas (boleh titik atau koma: 0.3 / 0,3), di-commit saat blur/Enter
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Input waktu dengan draft lokal (bisa diketik bebas, di-commit saat blur/Enter)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Komponen utama
// ---------------------------------------------------------------------------

export const AudioToolsSuite: React.FC<AudioToolsSuiteProps> = ({
  entitlements,
  onUnlockEditor,
  onSuccessToast,
  toolsPrice = 20000,
  isActive = true,
  initialTool = null,
}) => {
  // Kepemilikan Audio Tools Suite (langsung, atau lewat salah satu track)
  const isToolsOwned = useMemo(() => {
    const e: any = entitlements;
    return Boolean(
      e?.audioToolsSuite || Object.values(e?.byTrack || {}).some((t: any) => t?.audioToolsSuite)
    );
  }, [entitlements]);

  const [selectedTool, setSelectedTool] = useState<ToolType>(initialTool && !isExtraId(initialTool) ? initialTool : 'trim');
  // Alat tambahan yang aktif (null = alat bawaan `selectedTool` yang aktif).
  const [selectedExtra, setSelectedExtra] = useState<ExtraToolId | null>(initialTool && isExtraId(initialTool) ? initialTool : null);
  const [extraTick, setExtraTick] = useState(0);
  const extraSessionRef = useRef<Set<string>>(new Set());
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

  // Parameter alat
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
  // Kuota yang ditampilkan di header: mengikuti alat aktif (bawaan atau tambahan). `extraTick` memicu render ulang setelah pemakaian.
  void extraTick;
  const activeQuota = isToolsOwned ? Infinity : selectedExtra ? remainingExtraQuota(selectedExtra) : currentToolQuota;
  const activeToolId: UnifiedToolId = selectedExtra ?? selectedTool;
  const activeGroup = TOOL_GROUPS.find((g) => g.tools.includes(activeToolId)) ?? TOOL_GROUPS[0];

  // Convert: format tujuan tidak boleh sama dengan format berkas asal.
  const sourceFormat = useMemo(() => detectAudioFormat(audioFile), [audioFile]);
  const blockedFormat: ExportAudioFormat | null = selectedTool === 'convert' ? sourceFormat : null;
  useEffect(() => {
    if (blockedFormat && selectedExportFormat === blockedFormat) {
      const next = (['MP3', 'WAV', 'M4A', 'FLAC'] as const).find((f) => f !== blockedFormat);
      if (next) setSelectedExportFormat(next);
    }
  }, [blockedFormat, selectedExportFormat]);

  // Refs
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

  // ---- Audio graph --------------------------------------------------------

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
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

  // ---- Sumber audio aktif -------------------------------------------------

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

  // Seksi disembunyikan (pengguna pindah ke Harga dsb.): hentikan suara, tetapi simpan state.
  useEffect(() => {
    if (!isActive) stopPlayback();
  }, [isActive, stopPlayback]);

  // Rate & preservesPitch (load() mereset playbackRate, jadi disetel ulang tiap src berubah)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desiredRate, desiredPreserve, activeAudioSrc, audioUrl]);

  // Pitch granular: ubah rasio langsung saat memutar
  useEffect(() => {
    pitchPlayerRef.current?.setPitchRatio(Math.pow(2, dynamicPitchSemitones / 12));
  }, [dynamicPitchSemitones]);

  // Preview Trim: berhenti persis di batas akhir + playhead
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

  // ---- Pembersihan hasil --------------------------------------------------

  const clearToolResult = useCallback((tool: ToolType) => {
    revokeStateUrls(toolStatesRef.current[tool]);
    runIdsRef.current[tool] += 1; // batalkan proses yang sedang berjalan
    if (tool === 'compress') compressChargedRef.current = false;
    setToolStates((prev) => ({ ...prev, [tool]: { ...INITIAL_TOOL_STATE } }));
  }, []);

  const handleClearToolResult = (tool: ToolType) => {
    if (live.current.selectedTool === tool) stopPlayback();
    clearToolResult(tool);
    onSuccessToast(`Hasil ${TOOLS.find((t) => t.id === tool)?.name} berhasil dihapus.`);
  };

  // Hasil kedaluwarsa otomatis (hemat memori) + penyegaran label sisa waktu
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
          toastRef.current(`Hasil ${TOOLS.find((x) => x.id === tool)?.name} kedaluwarsa dan dihapus dari memori.`);
        }
      });
      if (any) setNowTick(t);
    }, 5000);
    return () => clearInterval(id);
  }, [clearToolResult, stopPlayback]);

  // Segarkan kuota saat tab kembali aktif / pindah tool
  useEffect(() => {
    setQuotaMap(readQuota());
  }, [selectedTool]);
  useEffect(() => {
    const onFocus = () => setQuotaMap(readQuota());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Cleanup saat unmount
  useEffect(() => {
    return () => {
      pitchPlayerRef.current?.stop();
      dragCleanupRef.current?.();
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      Object.values(toolStatesRef.current).forEach(revokeStateUrls);
    };
  }, []);

  const deductQuota = (tool: ToolType) => {
    if (isToolsOwned) return;
    const q = readQuota();
    q[tool] = Math.max(0, (q[tool] ?? DAILY_FREE_QUOTA) - 1);
    writeQuota(q);
    setQuotaMap(q);
  };

  // ---- Muat berkas --------------------------------------------------------

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // izinkan memilih berkas yang sama lagi
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

      // Berhasil dibaca: baru ganti state & bersihkan hasil lama.
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
            ? 'Browser tidak bisa membaca track audio dari video ini (kontainer/codec tidak didukung). Coba MP4, WebM, atau MOV, atau ekstrak audionya lebih dulu.'
            : 'Gagal membaca berkas. Pastikan format audio didukung browser (MP3, WAV, M4A, OGG, FLAC) dan file tidak rusak.'
        );
      }
    } finally {
      if (myLoad === loadIdRef.current) setIsLoadingFile(false);
    }
  };

  // ---- Pemutaran ----------------------------------------------------------

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
      } catch {
        /* abaikan */
      }
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
    } catch {
      /* abaikan */
    }
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

  // ---- Trim ---------------------------------------------------------------

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

  // ---- Proses tool statis -------------------------------------------------

  const executeProcessForTool = async (targetTool: ToolType, overrideTier?: string) => {
    if (!decodedBuffer) {
      fileInputRef.current?.click();
      return;
    }
    if (LIVE_TOOLS.includes(targetTool)) return;

    const q = readQuota();
    setQuotaMap(q);
    const needsCharge = !isToolsOwned && !(targetTool === 'compress' && compressChargedRef.current);
    if (needsCharge && (q[targetTool] ?? 0) <= 0) {
      onUnlockEditor();
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
      await nextFrame(); // beri kesempatan UI menampilkan status "memproses"

      let outputBuffer: AudioBuffer;
      let vocalBuffers: ToolExecutionState['vocalBuffers'];

      if (targetTool === 'trim') {
        const dur = src.duration;
        const s = Math.floor(clamp(live.current.trimStart, 0, dur) * sr);
        const e = Math.min(src.length, Math.floor(clamp(live.current.trimEnd, 0, dur) * sr));
        if (e - s < Math.floor(sr * 0.05)) {
          throw new DspError('EMPTY', 'Rentang potong terlalu pendek (minimal 0,05 detik).');
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
        // vocal_separator
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
        return;
      }

      // Kuota dikurangi tepat sekali setelah proses benar-benar sukses.
      if (needsCharge) deductQuota(targetTool);
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
      if (err instanceof DspError && err.code === 'CANCELLED') return;
      if (isStale()) return;
      console.error(err);
      let msg = 'Pemrosesan audio gagal. Coba berkas lain atau muat ulang halaman.';
      if (err instanceof DspError) {
        if (err.code === 'MONO') {
          msg =
            chs.length < 2
              ? 'Audio stereo (2 kanal) dibutuhkan untuk ekstraksi vokal.'
              : 'Kedua kanal berkas ini identik (mono / stereo palsu) sehingga vokal tidak bisa dipisahkan dengan metode center-phase.';
        } else if (err.code === 'SILENT') msg = 'Berkas ini senyap, tidak ada yang bisa diproses.';
        else if (err.code === 'EMPTY') msg = err.message !== 'EMPTY' ? err.message : 'Berkas audio kosong.';
      }
      setErrorMsg(msg);
      setToolStates((prev) => ({ ...prev, [targetTool]: { ...INITIAL_TOOL_STATE } }));
    }
  };

  const handleCompressTierChange = (newTierId: string) => {
    if (newTierId === selectedCompressTier && toolStates.compress.resultBuffer) return;
    const wasCharged = compressChargedRef.current; // sudah dihitung kuotanya untuk berkas ini?
    setSelectedCompressTier(newTierId);
    if (live.current.selectedTool === 'compress') stopPlayback();
    clearToolResult('compress'); // batalkan proses lama & hapus hasil tingkat sebelumnya
    if (decodedBuffer) {
      compressChargedRef.current = wasCharged; // ganti tingkat tidak memakan kuota lagi
      void executeProcessForTool('compress', newTierId);
    }
  };

  // ---- Unduh --------------------------------------------------------------

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

    if (isLive && !isToolsOwned && !alreadyCharged) {
      const q = readQuota();
      setQuotaMap(q);
      if ((q[tool] ?? 0) <= 0) {
        onUnlockEditor();
        return;
      }
    }

    if (tool === 'convert' && blockedFormat && selectedExportFormat === blockedFormat) {
      setErrorMsg(`Berkas asal sudah berformat ${blockedFormat}. Pilih format tujuan yang berbeda.`);
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

      // --- Compress: encode bitrate nyata ---
      if (tool === 'compress') {
        const result = toolStates.compress.resultBuffer;
        if (!result) return;
        const tier = compressTiers.find((t) => t.id === selectedCompressTier) || compressTiers[2];
        const fileBase = `${baseName}_compressed_${tier.id}`;

        if (fmt === 'WAV' || fmt === 'FLAC') {
          // 16-bit: hasil kompresi tidak boleh membengkak jadi lebih besar dari sumbernya.
          // FLAC = lossless sungguhan (lebih kecil dari WAV), WAV = PCM mentah.
          const res = await exportAudioFile(result, fileBase, fmt, { bitDepth: 16, onProgress: (pct) => setExportProgress(Math.round(pct)) });
          onSuccessToast(`Berkas ${res.actualFormat} hasil kompresi (${tier.label}, ${Math.round(result.sampleRate / 1000)} kHz) berhasil diunduh.${res.note ? ' ' + res.note : ''}`);
          return;
        }

        if (fmt === 'MP3') {
          // MP3 sungguhan (LAME) pada bitrate tingkatan terpilih.
          try {
            const mp3 = await encodeMp3(result, tier.bitrate, (pct: number) => setExportProgress(Math.round(pct)));
            downloadBlob(mp3, `${fileBase}.mp3`);
            onSuccessToast(`Berkas MP3 dikompresi (${tier.label}) berhasil diunduh.`);
            return;
          } catch (mp3Err) {
            console.error('Encode MP3 gagal:', mp3Err);
            const res = await exportAudioFile(result, fileBase, 'WAV', { bitDepth: 16 });
            onSuccessToast(`Encoder MP3 gagal dimuat, berkas disimpan sebagai ${res.actualFormat}.`);
            return;
          }
        }

        // M4A: memakai encoder bawaan browser. Ekstensi berkas ditentukan dari
        // format yang BENAR-BENAR dihasilkan, dan pengguna diberi tahu bila berbeda dari pilihan.
        const enc: CompressedAudioResult = await encodeCompressedAudio(result, tier.bitrate, (pct: number) =>
          setExportProgress(Math.round(pct))
        );
        const mime = (enc.blob.type || '').toLowerCase();
        const metaExt = String((enc as any).extension || (enc as any).ext || '')
          .replace('.', '')
          .toLowerCase();
        const ext =
          metaExt ||
          (mime.includes('mpeg') || mime.includes('mp3')
            ? 'mp3'
            : mime.includes('mp4') || mime.includes('aac') || mime.includes('m4a')
            ? 'm4a'
            : mime.includes('flac')
            ? 'flac'
            : mime.includes('wav')
            ? 'wav'
            : mime.includes('webm')
            ? 'webm'
            : mime.includes('ogg') || mime.includes('opus')
            ? 'ogg'
            : fmt.toLowerCase());
        downloadBlob(enc.blob, `${fileBase}.${ext}`);
        onSuccessToast(
          ext === fmt.toLowerCase()
            ? `Berkas berhasil dikompresi (${tier.label}, .${ext}).`
            : `Berkas dikompresi (${tier.label}). Encoder browser menghasilkan format .${ext}.`
        );
        return;
      }

      // --- Tool lainnya: siapkan buffer ---
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
          if (clipped) onSuccessToast('Peringatan: sebagian puncak sinyal terpotong (clipping). Turunkan gain untuk hasil lebih bersih.');
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

      const exported = await exportAudioFile(buf, `${baseName}_${suffix}`, fmt, {
        onProgress: (pct) => setExportProgress(Math.round(pct)),
      });

      if (isLive && !isToolsOwned && !alreadyCharged) {
        deductQuota(tool);
        chargedSigRef.current[tool] = sig;
      } else if (isLive && !alreadyCharged) {
        chargedSigRef.current[tool] = sig;
      }
      onSuccessToast(exported.note ? `Berkas diunduh. ${exported.note}` : `Berkas ${fmt} berhasil diunduh.`);
    } catch (err) {
      if (err instanceof DspError && err.code === 'CANCELLED') return;
      console.error(err);
      setErrorMsg(
        tool === 'compress'
          ? 'Gagal mengompres berkas. Pastikan browser mendukung AudioEncoder, atau coba format WAV.'
          : `Gagal mengekspor berkas ${fmt}. Coba format lain.`
      );
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  // ---- Turunan UI ---------------------------------------------------------

  const toolMeta = TOOLS.find((t) => t.id === selectedTool)!;

  /**
   * Pintu kuota untuk 6 alat tambahan: aturannya sama dengan alat bawaan (2x gratis per hari per alat, lalu berbayar).
   * `sessionKey` dipakai alat real-time (metronom, tuner): satu sesi halaman dihitung satu penggunaan.
   */
  const gateExtra = useCallback(
    (toolId: ExtraToolId, sessionKey?: string) => {
      const sKey = sessionKey ? `${toolId}:${sessionKey}` : null;
      if (sKey && extraSessionRef.current.has(sKey)) return true;
      const ok = consumeExtraQuota(toolId, isToolsOwned);
      setExtraTick((t) => t + 1);
      if (!ok) {
        toastRef.current(`Jatah gratis ${toolInfo(toolId).name} hari ini habis (${DAILY_FREE_QUOTA}x/hari). Beli Audio Tools untuk pemakaian tanpa batas.`);
      } else if (sKey) {
        extraSessionRef.current.add(sKey);
      }
      return ok;
    },
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

        {/* Header Seksi & Status Kuota */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-white/[0.08] pb-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-accent" />
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">Audio Processing Tools Suite</h3>
            </div>
            <p className="text-xs text-gray-300">
              15 alat studio dalam 6 kelompok: potong &amp; susun, perbaiki suara, nada/tempo/vokal, format &amp; ukuran, rekam &amp; analisis, serta latihan musik. Setiap alat gratis {DAILY_FREE_QUOTA}x per hari, selebihnya berbayar.
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

            {!selectedExtra && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoadingFile}
              className="h-9 px-3.5 rounded-xl bg-black/50 hover:bg-black/80 border border-white/10 text-xs font-bold text-gray-200 flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
            >
              {isLoadingFile ? (
                <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-accent" />
              )}
              <span>{isLoadingFile ? 'Membaca...' : audioFile ? 'Ganti Berkas' : 'Unggah Berkas'}</span>
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

        {/* Kelompok alat (dikelompokkan menurut fungsi) */}
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

        {/* Panel alat tambahan (6 alat; punya pemilih berkas sendiri) */}
        {selectedExtra && (
          <p className="text-[11px] text-gray-400 -mt-2">{toolInfo(selectedExtra).desc}. Semua diproses di perangkatmu.</p>
        )}
        <ExtraToolPanel active={selectedExtra} gate={gateExtra} onSuccessToast={onSuccessToast} />

        {/* Panel Kontrol (9 alat bawaan, memakai tombol Unggah Berkas) */}
        {!selectedExtra && (
        <div className="p-4 sm:p-5 rounded-xl bg-black/40 border border-white/[0.06] space-y-4">
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

            {audioFile && (
              <span className="text-[11px] font-mono text-accent bg-black/60 px-2.5 py-1 rounded-md border border-white/10 flex items-center gap-1.5">
                <FileAudio className="w-3.5 h-3.5" />
                <span className="truncate max-w-[150px] sm:max-w-xs">{audioFile.name}</span>
                <span className="text-gray-400">({decodedBuffer?.duration.toFixed(1)}s)</span>
              </span>
            )}
          </div>

          {!decodedBuffer && (
            <p className="text-[11px] text-gray-400 bg-black/40 border border-white/5 rounded-lg px-3 py-2">
              Unggah berkas audio (atau video untuk ekstrak audio) terlebih dahulu untuk memakai alat ini.
            </p>
          )}

          <div className="pt-2">
            {/* 1. TRIM / CUT */}
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

            {/* 2. VOLUME / GAIN */}
            {selectedTool === 'volume' && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label className="text-gray-300 font-bold block">Penyesuaian Gain Dinamis (Real-time):</label>
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
                      Puncak sinyal diperkirakan melewati 0 dBFS dan akan terpotong (clipping) saat diunduh.
                      {safeGainDb > 0 ? ` Gain maksimum aman untuk berkas ini sekitar +${safeGainDb} dB.` : ' Berkas ini sudah mendekati level maksimum.'}
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* 3. PITCH / TRANSPOSE */}
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

            {/* 4. TEMPO / SPEED */}
            {selectedTool === 'tempo' && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <label className="text-gray-300 font-bold block">Kecepatan Putar Dinamis (Nada Terkunci Normal):</label>
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

            {/* 5. REVERSE */}
            {/* Tidak ada pengaturan tambahan: cukup tekan tombol Jalankan */}

            {/* 6. CONVERT */}
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
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold cursor-pointer ${
                      convertSourceMode === 'video' ? 'bg-accent text-on-accent shadow' : 'bg-black/50 text-gray-400 hover:text-white'
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Video ke Audio (MP4, MKV, WebM, MOV, AVI, dll.)</span>
                  </button>
                </div>

                {blockedFormat && (
                  <p className="text-[11px] text-gray-400">
                    Format asal: <span className="font-bold text-gray-200">{blockedFormat}</span>. Pilih format tujuan yang berbeda.
                  </p>
                )}

                {convertSourceMode === 'video' && (
                  <p className="text-[11px] text-accent bg-accent/10 p-3 rounded-xl border border-accent/20 leading-relaxed">
                    Audio diekstrak oleh decoder bawaan browser dari berkas video, lalu disimpan ke format pilihan Anda.
                    Dukungan bergantung pada codec browser: <strong>.mp4, .webm, .mov, .m4v</strong> umumnya aman, sedangkan
                    <strong> .mkv, .avi, .flv, .wmv</strong> bisa gagal dibaca di sebagian browser.
                  </p>
                )}
              </div>
            )}

            {/* 7. COMPRESS */}
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

            {/* 8. NOISE REDUCTION */}
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

            {/* 9. VOCAL ISOLATOR */}
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
                {vocalExtractTarget === 'both' && currentToolState.vocalUrls && (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="text-gray-400">Dengar:</span>
                    {(['vocal', 'instrumental'] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => {
                          stopPlayback();
                          setVocalPreviewChoice(w);
                        }}
                        className={`px-2.5 py-1 rounded-md font-bold cursor-pointer ${
                          vocalPreviewChoice === w ? 'bg-white/20 text-white' : 'bg-black/60 text-gray-400 hover:text-white'
                        }`}
                      >
                        {w === 'vocal' ? 'Vokal' : 'Musik'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Format Unduhan & Aksi */}
          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <span className="text-gray-300 font-bold flex items-center gap-2">
                Format Unduhan:
                <InfoTip label="Info format unduhan">
                  <p>{FORMAT_INFO}</p>
                </InfoTip>
              </span>
              <div className="flex items-center gap-1.5">
                {(['MP3', 'WAV', 'M4A', 'FLAC'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    disabled={blockedFormat === fmt}
                    title={blockedFormat === fmt ? 'Sama dengan format berkas asal' : undefined}
                    onClick={() => setSelectedExportFormat(fmt)}
                    className={`px-3 py-1 rounded-lg font-bold transition-all ${
                      blockedFormat === fmt
                        ? 'bg-black/30 text-gray-600 line-through cursor-not-allowed'
                        : selectedExportFormat === fmt
                        ? 'bg-accent text-on-accent shadow cursor-pointer'
                        : 'bg-black/60 text-gray-400 hover:text-white cursor-pointer'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2.5 flex-wrap">
                {/* Jalankan (tool statis) */}
                {!isLiveTool &&
                  (staticNeedsPurchase ? (
                    <button
                      type="button"
                      onClick={onUnlockEditor}
                      className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>Beli Audio Tools — Rp{toolsPrice.toLocaleString('id-ID')}</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => executeProcessForTool(selectedTool)}
                      disabled={isProcessing}
                      className="px-5 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
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

              {/* Unduhan */}
              {selectedTool === 'vocal_separator' && vocalExtractTarget === 'both' && currentToolState.vocalBuffers ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => handleDownloadFile({ buffer: currentToolState.vocalBuffers!.vocal, suffix: 'Vocal_Only' })}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-black flex items-center gap-1 cursor-pointer shadow disabled:opacity-50"
                  >
                    {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Unduh Vokal ({selectedExportFormat})
                  </button>
                  <button
                    type="button"
                    disabled={isExporting}
                    onClick={() => handleDownloadFile({ buffer: currentToolState.vocalBuffers!.instrumental, suffix: 'Music_Only' })}
                    className="px-3 py-1.5 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black flex items-center gap-1 cursor-pointer shadow disabled:opacity-50"
                  >
                    {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />} Unduh Musik ({selectedExportFormat})
                  </button>
                </div>
              ) : (
                (hasResult || isLiveTool) &&
                decodedBuffer && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> Siap
                    </span>
                    {liveNeedsPurchase ? (
                      <button
                        type="button"
                        onClick={onUnlockEditor}
                        className="px-4 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Beli Audio Tools — Rp{toolsPrice.toLocaleString('id-ID')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleDownloadFile()}
                        disabled={isExporting}
                        className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
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
                )
              )}
            </div>

            {remainingMin !== null && (
              <p className="text-[11px] text-gray-500">
                Hasil disimpan sementara di memori browser (sisa ±{remainingMin} menit), lalu dihapus otomatis.
              </p>
            )}
          </div>
        </div>
        )}
      </div>
    </section>
  );
};
