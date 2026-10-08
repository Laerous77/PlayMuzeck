// src/components/AudioStudio/AudioExtraTools.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Merge, Activity, Mic, Eraser, Timer, AudioLines, Upload, Download, Play, Square,
  Loader2, Trash2, ArrowUp, ArrowDown, Copy, X, AlertTriangle, CheckCircle, RotateCcw, Music2, Ruler,
  Target, Sparkles, Repeat, Tags, ImagePlus, Image as ImageIcon
} from 'lucide-react';
import {
  audioBufferToWav, downloadBlob, exportAudioFile,
} from '../../services/exporters';
import {
  BTN_DOWNLOAD, BTN_GHOST, BTN_PRIMARY, CARD_CLS, EmptyFileNotice, FORMAT_INFO, FileChip, FormatRow, INPUT_CLS, InfoTip, LimitNote,
  NUM_FIELD_CLS, PANEL_CLS, SLIDER_CLS, pillCls, quotaGuardProps, type DownloadFormat,
} from './toolsShared';
import { PitchDetectTool, VocalRangeTool } from './VoiceTools';
import { PitchMatchTool } from './PitchMatchTool';
import {
  CLICK_GAIN, CLICK_SOUNDS, DENOMINATORS, MAX_NUMERATOR, TEMPO_REFS, TUNING_PRESETS, accentsFromGroups, applyFade,
  barSeconds, clickSample, concatChannels, defaultGrouping, detectBpm, detectKey, detectPitch, freqToNote,
  getClickSound, groupingsFor, lowestFreq, makeTimeSignature, measureLufs, midiToFreq, nearestString,
  normalizeLoudness, peaksForDisplay, pulseSeconds, removeSilence, renderMetronome, sliceChannels, subdivisionsFor,
  tempoMarking, toMono, repeatChannels, MIN_REPEAT, MAX_REPEAT,
  type Accent, type Channels, type ClickKind, type FadeCurve, type TempoRef, type TuningPreset,
} from '../../services/audioExtraDsp';
import {
  checkInputDuration, checkOutputDuration, formatDuration, limitLabelFor, maxRepeatsFor, maxSecondsFor, repeatedDuration,
} from '../../services/audioLimits';
import {
  FORMAT_EXT, FORMAT_LABEL, FORMAT_MIME, GENRE_SUGGESTIONS, MAX_COVER_BYTES, MAX_FILE_BYTES, TEXT_FIELDS,
  emptyTags, imageExtension, readTags, sniffImage, writeTags,
  type AudioPicture, type AudioTags, type AudioTechInfo, type MetaFormat, type TextField,
} from '../../services/audioMetadata';

export type ExtraToolId = 'merge' | 'clean' | 'recorder' | 'bpm' | 'metronome' | 'tuner' | 'pitch_detect' | 'vocal_range' | 'pitch_match' | 'loop' | 'metadata';

export interface QuotaGate {
  use: (toolId: ExtraToolId, sessionKey?: string) => Promise<boolean>;
  has: (toolId: ExtraToolId, sessionKey?: string) => boolean;
  refund: (toolId: ExtraToolId, sessionKey?: string) => void;
  locked: (toolId: ExtraToolId) => boolean;
  exhausted: (toolId: ExtraToolId) => boolean;
  blocked: (toolId: ExtraToolId) => void;
}

export interface AudioExtraToolsProps {
  initialTool?: ExtraToolId;
  gate?: QuotaGate;
  onSuccessToast?: (msg: string) => void;
  studioActiveTrack?: { id: string; title: string; audioUrl?: string } | null;
}

/**
 * Pegangan tombol "Unggah Berkas" di header AudioToolsSuite. Alat yang sedang aktif mendaftarkan dirinya,
 * sehingga tombol header (sama seperti untuk Reverse dkk.) membuka pemilih berkas milik alat itu.
 */
export interface ExtraPickerHandle { open: () => void; label: string; loading: boolean }

/** Alat tambahan yang memakai tombol "Unggah Berkas" di header (bukan pemilih berkas di dalam panel). */
export const EXTRA_FILE_TOOLS: ExtraToolId[] = ['merge', 'loop', 'metadata', 'clean'];

interface ExtraFileToolProps {
  gate?: AudioExtraToolsProps['gate'];
  toast?: (m: string) => void;
  isActive?: boolean;
  onPicker?: (h: ExtraPickerHandle | null) => void;
}

export const EXTRA_SLUG_TO_TOOL: Record<string, ExtraToolId> = {
  'gabung-audio': 'merge',
  'ulangi-audio': 'loop',
  'loop-audio': 'loop',
  'edit-metadata-audio': 'metadata',
  'edit-tag-mp3': 'metadata',
  'ganti-cover-mp3': 'metadata',
  'fade-audio': 'merge',
  'deteksi-bpm': 'bpm',
  'deteksi-kunci-nada': 'bpm',
  'rekam-suara': 'recorder',
  'hapus-hening-audio': 'clean',
  'normalisasi-volume-audio': 'clean',
  'stereo-ke-mono': 'clean',
  'metronom-online': 'metronome',
  'tuner-online': 'tuner',
  'deteksi-nada-suara': 'pitch_detect',
  'tes-vocal-range': 'vocal_range',
  'latihan-nada': 'pitch_match',
  'cocokkan-nada': 'pitch_match',
  'latihan-vokal': 'pitch_match',
};

export interface ExtraToolMeta { id: ExtraToolId; label: string; icon: React.ElementType; desc: string; realtime?: boolean }

export const EXTRA_TOOL_META: ExtraToolMeta[] = [
  { id: 'merge', label: 'Gabung & Fade', icon: Merge, desc: 'Gabungkan beberapa audio, crossfade, fade in/out' },
  { id: 'loop', label: 'Ulangi Audio', icon: Repeat, desc: 'Ulangi audio 2 sampai 5 kali menjadi satu berkas, dengan crossfade opsional agar sambungan mulus' },
  { id: 'metadata', label: 'Edit Metadata', icon: Tags, desc: 'Ubah judul, artis, album, cover, lirik, dan tag lain di MP3, FLAC, WAV, dan M4A tanpa mengubah kualitas audio' },
  { id: 'clean', label: 'Rapikan Audio', icon: Eraser, desc: 'Hapus jeda hening, samakan loudness (LUFS), ubah stereo ke mono' },
  { id: 'recorder', label: 'Perekam', icon: Mic, desc: 'Rekam suara dari mikrofon, potong awal/akhir, lalu unduh', realtime: true },
  { id: 'bpm', label: 'BPM & Kunci', icon: Activity, desc: 'Deteksi tempo (BPM) dan kunci nada lagu' },
  { id: 'metronome', label: 'Metronom', icon: Timer, desc: 'Birama lengkap, subdivisi sampai 1/64, aksen per ketukan, bunyi metronom asli, dan ekspor klik ke berkas', realtime: true },
  { id: 'tuner', label: 'Tuner', icon: AudioLines, desc: 'Setel gitar, bass, ukulele, alat gesek, banjo, mandolin, dan vokal', realtime: true },
  { id: 'pitch_detect', label: 'Deteksi Nada Suara', icon: Music2, desc: 'Rekam suaramu, deteksi nada vokal langsung, lihat ringkasan nada dan kunci', realtime: true },
  { id: 'vocal_range', label: 'Tes Vocal Range', icon: Ruler, desc: 'Ukur jangkauan suara, jenis suara, dan wilayah nyaman, lengkap contoh lagu', realtime: true },
  { id: 'pitch_match', label: 'Latihan Cocokkan Nada & Tempo', icon: Target, desc: 'Unggah audio acuan, bernyanyi bersama musik, lalu nilai kecocokan nada & tempo secara real-time', realtime: true },
];

const AudioCtx: typeof AudioContext = (typeof window !== 'undefined' &&
  (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)) as typeof AudioContext;

/** Baca berkas jadi AudioBuffer. Bila `toolId` diberikan, durasi dibatasi sesuai batas alat itu (lihat audioLimits.ts). */
async function decodeFile(file: File, toolId?: ExtraToolId): Promise<AudioBuffer> {
  const ctx = new AudioCtx();
  let buf: AudioBuffer;
  try {
    const data = await file.arrayBuffer();
    buf = await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(
        data.slice(0),
        (b) => resolve(b),
        (err) => reject(err)
      ).catch?.(reject);
    });
  } catch {
    throw new Error('Berkas tidak bisa dibaca. Coba format lain (MP3, WAV, M4A, OGG, atau FLAC).');
  } finally {
    try { void ctx.close(); } catch {}
  }
  const tooLong = toolId ? checkInputDuration(toolId, buf.duration) : null;
  if (tooLong) throw new Error(tooLong);
  return buf;
}

function viewChannels(b: AudioBuffer): Channels {
  return Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
}

function toBuffer(ch: Channels, sampleRate: number): AudioBuffer {
  const len = Math.max(1, ch[0]?.length ?? 0);
  const numCh = Math.max(1, ch.length);
  let buf: AudioBuffer;
  try {
    buf = new AudioBuffer({ length: len, numberOfChannels: numCh, sampleRate });
  } catch {
    const ctx = new AudioCtx();
    buf = ctx.createBuffer(numCh, len, sampleRate);
    void ctx.close().catch(() => {});
  }
  for (let i = 0; i < numCh; i++) {
    const target = buf.getChannelData(i);
    if (ch[i]) target.set(ch[i]);
  }
  return buf;
}

async function resampleTo(b: AudioBuffer, sr: number): Promise<AudioBuffer> {
  if (b.sampleRate === sr) return b;
  const off = new OfflineAudioContext(b.numberOfChannels, Math.max(1, Math.ceil(b.duration * sr)), sr);
  const src = off.createBufferSource();
  src.buffer = b;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};
const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[^\w\s-]/g, '').trim() || 'audio';
const tick = () => new Promise<void>((r) => setTimeout(r, 30));

const Panel: React.FC<{ title: string; info?: string[]; children: React.ReactNode }> = ({ title, info, children }) => (
  <div className={PANEL_CLS}>
    <div className="flex items-center gap-2">
      <h4 className="text-sm font-bold text-white">{title}</h4>
      {info && info.length > 0 && (
        <InfoTip label={`Info alat ${title}`}>
          {info.map((line) => <p key={line} className="text-gray-300">{line}</p>)}
        </InfoTip>
      )}
    </div>
    {children}
  </div>
);

const btnPrimary = BTN_PRIMARY;
const btnGhost = BTN_GHOST;
const inputCls = INPUT_CLS;
const sliderCls = SLIDER_CLS;

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block space-y-1">
    <span className="text-xs font-bold text-gray-300">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-gray-500">{hint}</span>}
  </label>
);

const ErrorNote: React.FC<{ msg: string | null }> = ({ msg }) =>
  msg ? (
    <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  ) : null;

const FilePicker: React.FC<{
  label: string; multiple?: boolean; disabled?: boolean; onFiles: (f: File[]) => void;
  onBeforePick?: () => boolean; accept?: string;
}> = ({ label, multiple, disabled, onFiles, onBeforePick, accept = 'audio/*,video/*' }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref} type="file" accept={accept} multiple={multiple} className="hidden"
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f); }}
      />
      <button type="button" disabled={disabled} onClick={() => { if (onBeforePick && !onBeforePick()) return; ref.current?.click(); }} className={btnGhost}>
        <Upload className="w-4 h-4 text-accent" />
        <span>{label}</span>
      </button>
    </>
  );
};

const Waveform: React.FC<{ peaks: Float32Array; from?: number; to?: number }> = ({ peaks, from = 0, to = 1 }) => (
  <div className="flex items-end gap-px h-20 rounded-xl bg-black/60 border border-white/10 p-2" aria-hidden>
    {Array.from(peaks).map((p, i) => {
      const pos = (i + 0.5) / peaks.length;
      const inside = pos >= from && pos <= to;
      return (
        <div key={i} className={`flex-1 rounded-sm ${inside ? 'bg-accent' : 'bg-white/20'}`}
          style={{ height: `${Math.max(4, Math.min(100, p * 100))}%` }} />
      );
    })}
  </div>
);

const Preview: React.FC<{ buffer: AudioBuffer | null }> = ({ buffer }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!buffer) { setUrl(null); return; }
    const u = URL.createObjectURL(audioBufferToWav(buffer, 16));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [buffer]);
  return url ? <audio controls src={url} className="w-full" /> : null;
};

let exportSeq = 0;

interface AudioExportArgs {
  buffer: AudioBuffer | null; fileName: string; toolId: ExtraToolId;
  gate?: AudioExtraToolsProps['gate']; onDone?: (m: string) => void; sessionKey?: string;
  bitDepth?: 16 | 24; defaultFormat?: DownloadFormat;
}

/** Logika ekspor bersama (batas durasi, kuota, encode, unduh). Dipakai ExportPanel dan AudioToolFooter. */
function useAudioExport({ buffer, fileName, toolId, gate, onDone, sessionKey, bitDepth, defaultFormat = 'MP3' }: AudioExportArgs) {
  const [fmt, setFmt] = useState<DownloadFormat>(defaultFormat);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const resultKey = useMemo(() => `r${++exportSeq}`, [buffer]);
  const run = async () => {
    if (!buffer || busy) return;
    // Batas panjang berkas keluaran: diperiksa SEBELUM jatah dipakai, jadi berkas yang ditolak tidak memakan kuota.
    const tooLong = checkOutputDuration(toolId, buffer.duration);
    if (tooLong) { setErr(tooLong); return; }
    const key = sessionKey ?? resultKey;
    const wasPaid = gate?.has(toolId, key) ?? false;
    setBusy(true); setErr(null); setNote(null); setPct(0);
    if (gate && !(await gate.use(toolId, key))) { setBusy(false); return; }
    try {
      const r = await exportAudioFile(buffer, fileName, fmt, { mp3Kbps: 192, bitDepth, onProgress: setPct });
      if (r.note) setNote(r.note);
      onDone?.(`Berkas ${r.actualFormat} berhasil diunduh.`);
    } catch (e) {
      if (!wasPaid) gate?.refund(toolId, key);
      setErr(e instanceof Error ? e.message : 'Gagal mengekspor berkas.');
    } finally { setBusy(false); }
  };
  return { fmt, setFmt, busy, pct, note, err, run };
}

const ExportPanel: React.FC<AudioExportArgs> = (props) => {
  const { fmt, setFmt, busy, pct, note, err, run } = useAudioExport(props);
  if (!props.buffer) return null;
  return (
    <div className="pt-3 border-t border-white/[0.06] space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
        <span className="text-gray-300 font-bold flex items-center gap-2">
          Format Unduhan:
          <InfoTip label="Info format unduhan"><p>{FORMAT_INFO}</p></InfoTip>
        </span>
        <div className="flex items-center gap-1.5">
          {(['MP3', 'WAV', 'M4A', 'FLAC'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFmt(f)} className={pillCls(fmt === f)}>{f}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-emerald-400 text-xs font-bold flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Siap</span>
        <button type="button" onClick={run} disabled={busy} className={BTN_DOWNLOAD}>
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span>{busy ? `Mengekspor ${Math.round(pct)}%` : `Unduh ${fmt}`}</span>
        </button>
      </div>
      {note && <p className="text-[11px] text-amber-300">{note}</p>}
      <ErrorNote msg={err} />
    </div>
  );
};

// ───────────── Kerangka seragam alat berbasis berkas (Gabung & Fade, Ulangi, Rapikan, Metadata) ─────────────
// Tata letak identik dengan alat bawaan seperti Reverse:
// judul + chip berkas → catatan "unggah dulu" → batas durasi → kontrol → Format Unduhan → Jalankan / Siap / Unduh.
// Berkasnya sendiri diunggah lewat tombol "Unggah Berkas" di header AudioToolsSuite (lihat useRegisterPicker).

/** Input berkas tersembunyi + fungsi `open`. Pemilihnya dipicu tombol header atau tombol "Jalankan" saat belum ada berkas. */
function useFileInput(opts: { accept?: string; multiple?: boolean; onFiles: (f: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const onFilesRef = useRef(opts.onFiles);
  onFilesRef.current = opts.onFiles;
  const open = useCallback(() => { ref.current?.click(); }, []);
  const input = (
    <input
      ref={ref} type="file" accept={opts.accept ?? 'audio/*,video/*'} multiple={opts.multiple} className="hidden"
      onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFilesRef.current(f); }}
    />
  );
  return { input, open };
}

/** Daftarkan pemilih berkas alat ini ke tombol "Unggah Berkas" di header, hanya selama alat sedang aktif. */
function useRegisterPicker(
  onPicker: ExtraFileToolProps['onPicker'], isActive: boolean, open: () => void, label: string, loading: boolean,
) {
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!onPicker || !isActive) return;
    onPicker({ open: () => openRef.current(), label, loading });
    return () => onPicker(null);
  }, [onPicker, isActive, label, loading]);
}

const ToolFrame: React.FC<{
  title: string; info?: string[];
  file?: { name: string; meta?: string } | null;
  emptyNotice?: string | null;
  limitText: string; warn?: string | null; error?: string | null;
  footer: React.ReactNode; children?: React.ReactNode;
}> = ({ title, info, file, emptyNotice, limitText, warn, error, footer, children }) => (
  <div className={PANEL_CLS}>
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-bold text-white">{title}</h4>
        {info && info.length > 0 && (
          <InfoTip label={`Info alat ${title}`}>
            {info.map((line) => <p key={line} className="text-gray-300">{line}</p>)}
          </InfoTip>
        )}
      </div>
      {file && <FileChip name={file.name} meta={file.meta} />}
    </div>
    {emptyNotice && <EmptyFileNotice>{emptyNotice}</EmptyFileNotice>}
    <LimitNote text={limitText} alert={warn} />
    <ErrorNote msg={error ?? null} />
    {children && <div className="pt-2 space-y-4">{children}</div>}
    {footer}
  </div>
);

/** Baris bawah alat: Format Unduhan, tombol Jalankan, Hapus Hasil, serta Siap + Unduh (sama seperti Reverse). */
const ToolFooter: React.FC<{
  formatRow: React.ReactNode;
  runLabel: string; onRun: () => void; running: boolean; runDisabled?: boolean;
  ready: boolean; onClear?: () => void;
  downloadLabel: string; onDownload: () => void; downloading: boolean; downloadPct?: number;
  preview?: React.ReactNode; note?: string | null; error?: string | null; after?: React.ReactNode;
}> = (p) => (
  <div className="pt-3 border-t border-white/[0.06] space-y-3">
    {p.formatRow}
    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
      <div className="flex items-center gap-2.5 flex-wrap">
        <button type="button" onClick={p.onRun} disabled={p.running || p.runDisabled} className={BTN_PRIMARY}>
          {p.running ? (
            <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Memproses...</span></>
          ) : (
            <><Play className="w-3.5 h-3.5 fill-on-accent" /><span>Jalankan {p.runLabel}</span></>
          )}
        </button>
        {p.ready && p.onClear && (
          <button
            type="button" onClick={p.onClear}
            className="px-3.5 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 hover:text-red-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" /><span>Hapus Hasil</span>
          </button>
        )}
      </div>
      {p.ready && (
        <div className="flex items-center gap-2">
          <span className="text-emerald-400 text-xs font-bold flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Siap</span>
          <button type="button" onClick={p.onDownload} disabled={p.downloading} className={BTN_DOWNLOAD}>
            {p.downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span>{p.downloading ? (p.downloadPct !== undefined ? `Mengekspor ${Math.round(p.downloadPct)}%` : 'Menyimpan…') : p.downloadLabel}</span>
          </button>
        </div>
      )}
    </div>
    {p.ready && p.preview}
    {p.note && <p className="text-[11px] text-amber-300">{p.note}</p>}
    <ErrorNote msg={p.error ?? null} />
    {p.after}
  </div>
);

/** ToolFooter untuk alat yang hasilnya AudioBuffer (Gabung & Fade, Ulangi Audio, Rapikan Audio). */
const AudioToolFooter: React.FC<{
  toolId: ExtraToolId; runLabel: string; onRun: () => void; running: boolean; runDisabled?: boolean;
  result: AudioBuffer | null; onClear: () => void; fileName: string;
  gate?: AudioExtraToolsProps['gate']; onDone?: (m: string) => void; sessionKey?: string; bitDepth?: 16 | 24;
}> = ({ toolId, runLabel, onRun, running, runDisabled, result, onClear, fileName, gate, onDone, sessionKey, bitDepth }) => {
  const ex = useAudioExport({ buffer: result, fileName, toolId, gate, onDone, sessionKey, bitDepth });
  return (
    <ToolFooter
      formatRow={<FormatRow value={ex.fmt} onChange={ex.setFmt} />}
      runLabel={runLabel} onRun={onRun} running={running} runDisabled={runDisabled}
      ready={Boolean(result)} onClear={onClear}
      downloadLabel={`Unduh ${ex.fmt}`} onDownload={ex.run} downloading={ex.busy} downloadPct={ex.pct}
      preview={<Preview buffer={result} />} note={ex.note} error={ex.err}
    />
  );
};

// 1. Gabung & Fade
interface MergeItem { id: number; name: string; buffer: AudioBuffer; }
let mergeIdSeq = 1;

const MergeFadeTool: React.FC<ExtraFileToolProps> = ({ gate, toast, isActive = false, onPicker }) => {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [crossfade, setCrossfade] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [curve, setCurve] = useState<FadeCurve>('natural');
  const [result, setResult] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addFiles = async (files: File[]) => {
    setErr(null); setLoading(true);
    try {
      const added: MergeItem[] = [];
      for (const f of files) added.push({ id: mergeIdSeq++, name: f.name, buffer: await decodeFile(f, 'merge') });
      const nextTotal = items.reduce((sum, x) => sum + x.buffer.duration, 0) + added.reduce((sum, x) => sum + x.buffer.duration, 0);
      const tooLong = checkOutputDuration('merge', nextTotal);
      if (tooLong) { setErr(`Total durasi gabungan ${formatDuration(nextTotal)} melebihi batas ${limitLabelFor('merge')}. Berkas baru tidak ditambahkan.`); return; }
      setItems((prev) => [...prev, ...added]);
      setResult(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca berkas.'); }
    finally { setLoading(false); }
  };
  const { input, open } = useFileInput({ multiple: true, onFiles: addFiles });
  useRegisterPicker(onPicker, isActive, open, loading ? 'Membaca...' : items.length > 0 ? 'Tambah Berkas' : 'Unggah Berkas', loading);

  const move = (i: number, d: -1 | 1) => setItems((prev) => {
    const j = i + d; if (j < 0 || j >= prev.length) return prev;
    const n = prev.slice(); [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const remove = (id: number) => { setItems((p) => p.filter((x) => x.id !== id)); setResult(null); };

  const process = async () => {
    if (items.length === 0) return;
    setBusy(true); setErr(null); await tick();
    try {
      const sr = items[0].buffer.sampleRate;
      const parts: Channels[] = [];
      for (const it of items) parts.push(viewChannels(await resampleTo(it.buffer, sr)));
      let ch = concatChannels(parts, sr, crossfade);
      if (fadeIn > 0 || fadeOut > 0) ch = applyFade(ch, sr, fadeIn, fadeOut, curve);
      setResult(toBuffer(ch, sr));
      toast?.('Gabung & Fade selesai diproses.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal memproses audio.'); }
    finally { setBusy(false); }
  };
  const total = items.reduce((s, x) => s + x.buffer.duration, 0);
  const changed = () => setResult(null);

  return (
    <>
      {input}
      <ToolFrame
        title="Gabung & Fade"
        info={['Tambahkan satu atau lebih berkas, atur urutannya, lalu gabungkan.', 'Crossfade menumpang-tindihkan sambungan antar lagu.', `Total durasi hasil gabungan maks. ${limitLabelFor('merge')}.`]}
        file={items.length > 0 ? { name: items.length === 1 ? items[0].name : `${items.length} berkas`, meta: fmtTime(total) } : null}
        emptyNotice={items.length === 0 ? 'Unggah satu atau lebih berkas audio (atau video untuk ekstrak audio) terlebih dahulu untuk memakai alat ini.' : null}
        limitText={`Total durasi hasil gabungan maks. ${limitLabelFor('merge')} untuk alat ini (berlaku untuk berkas masuk dan hasil unduhan).`}
        error={err}
        footer={
          <AudioToolFooter
            toolId="merge" runLabel="Gabung & Fade" onRun={items.length > 0 ? process : open} running={busy}
            result={result} onClear={() => setResult(null)} fileName="PlayMuzeck_Gabungan" gate={gate} onDone={toast}
          />
        }
      >
        {items.length > 0 && (
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={it.id} className="flex items-center gap-2 rounded-xl bg-black/50 border border-white/5 px-3 py-2 text-xs">
                <span className="w-5 text-gray-500">{i + 1}.</span>
                <span className="flex-1 min-w-0 truncate text-white">{it.name}</span>
                <span className="text-gray-400 tabular-nums">{fmtTime(it.buffer.duration)}</span>
                <button type="button" aria-label="Naik" onClick={() => move(i, -1)} className="p-1 text-gray-300 hover:text-white cursor-pointer"><ArrowUp className="w-4 h-4" /></button>
                <button type="button" aria-label="Turun" onClick={() => move(i, 1)} className="p-1 text-gray-300 hover:text-white cursor-pointer"><ArrowDown className="w-4 h-4" /></button>
                <button type="button" aria-label="Hapus" onClick={() => remove(it.id)} className="p-1 text-red-300 hover:text-red-200 cursor-pointer"><Trash2 className="w-4 h-4" /></button>
              </li>
            ))}
            <li className={`text-[11px] ${total > maxSecondsFor('merge') ? 'text-red-300' : 'text-gray-500'}`}>Total sebelum efek: {fmtTime(total)} (maks. {limitLabelFor('merge')})</li>
          </ul>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label={`Crossfade: ${crossfade.toFixed(1)} dtk`} hint="Tumpang-tindih antar lagu">
            <input type="range" min={0} max={5} step={0.1} value={crossfade} onChange={(e) => { setCrossfade(+e.target.value); changed(); }} className={sliderCls} disabled={items.length < 2} />
          </Field>
          <Field label={`Fade in: ${fadeIn.toFixed(1)} dtk`}>
            <input type="range" min={0} max={10} step={0.1} value={fadeIn} onChange={(e) => { setFadeIn(+e.target.value); changed(); }} className={sliderCls} />
          </Field>
          <Field label={`Fade out: ${fadeOut.toFixed(1)} dtk`}>
            <input type="range" min={0} max={10} step={0.1} value={fadeOut} onChange={(e) => { setFadeOut(+e.target.value); changed(); }} className={sliderCls} />
          </Field>
          <Field label="Kurva fade">
            <select value={curve} onChange={(e) => { setCurve(e.target.value as FadeCurve); changed(); }} className={inputCls}>
              <option value="natural">Natural (disarankan)</option>
              <option value="linear">Linear</option>
              <option value="scurve">Halus (S-curve)</option>
            </select>
          </Field>
        </div>
        {result && (
          <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />Selesai, durasi {fmtTime(result.duration)}.</p>
        )}
      </ToolFrame>
    </>
  );
};

// 2. BPM & Kunci
const BpmKeyTool: React.FC<{ gate?: AudioExtraToolsProps['gate']; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ bpm: ReturnType<typeof detectBpm>; key: ReturnType<typeof detectKey>; seconds: number } | null>(null);

  const onFiles = async ([file]: File[]) => {
    if (gate && !(await gate.use('bpm'))) return;
    setBusy(true); setErr(null); setRes(null); setFileName(file.name);
    try {
      const buf = await decodeFile(file, 'bpm');
      await tick();
      const ch = viewChannels(buf);
      const bpm = detectBpm(ch, buf.sampleRate);
      const key = detectKey(ch, buf.sampleRate);
      if (!bpm && !key) { gate?.refund('bpm'); setErr('Tidak ada pola yang bisa dianalisis. Pastikan berkas cukup panjang (minimal ±5 detik) dan tidak senyap.'); }
      else setRes({ bpm, key, seconds: buf.duration });
    } catch (e) { gate?.refund('bpm'); setErr(e instanceof Error ? e.message : 'Gagal menganalisis.'); }
    finally { setBusy(false); }
  };

  const report = useMemo(() => {
    if (!res) return '';
    const lines = ['PlayMuzeck - Hasil Analisis Audio', `Berkas: ${fileName}`, `Durasi: ${fmtTime(res.seconds)}`, ''];
    if (res.bpm) lines.push(`BPM: ${res.bpm.bpm}` + (res.bpm.alternatives.length ? ` (kemungkinan lain: ${res.bpm.alternatives.join(' / ')})` : ''), `Keyakinan BPM: ${Math.round(res.bpm.confidence * 100)}%`);
    if (res.key) lines.push(`Kunci nada: ${res.key.name}`, `Kode Camelot: ${res.key.camelot}`, `Kunci relatif: ${res.key.relative}`, `Keyakinan kunci: ${Math.round(res.key.confidence * 100)}%`);
    return lines.join('\n');
  }, [res, fileName]);

  return (
    <Panel title="BPM & Kunci" info={['Pilih lagu, dan hasilnya langsung dianalisis.', 'Mendeteksi tempo lagu serta kunci nada mayor/minor.', `Durasi berkas maks. ${limitLabelFor('bpm')}.`]}>
      <FilePicker label={busy ? 'Menganalisis…' : 'Pilih lagu untuk dianalisis'} onFiles={onFiles} disabled={busy}
        onBeforePick={() => { if (gate?.exhausted('bpm')) { gate.blocked('bpm'); return false; } return true; }} />
      <ErrorNote msg={err} />
      {res && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-black/50 border border-white/5 p-4">
              <div className="text-[11px] font-bold text-gray-400">TEMPO</div>
              <div className="text-3xl font-black text-white tabular-nums">{res.bpm ? res.bpm.bpm : '—'} <span className="text-sm text-gray-400">BPM</span></div>
              {res.bpm && res.bpm.alternatives.length > 0 && <div className="text-[11px] text-gray-400 mt-1">Bisa juga {res.bpm.alternatives.join(' atau ')} BPM.</div>}
            </div>
            <div className="rounded-xl bg-black/50 border border-white/5 p-4">
              <div className="text-[11px] font-bold text-gray-400">KUNCI NADA</div>
              <div className="text-3xl font-black text-white">{res.key ? res.key.name : '—'}</div>
              {res.key && <div className="text-[11px] text-gray-400 mt-1">Camelot {res.key.camelot} · relatif {res.key.relative}</div>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} onClick={() => { downloadBlob(new Blob([report], { type: 'text/plain;charset=utf-8' }), `PlayMuzeck_Analisis_${baseName(fileName)}.txt`); toast?.('Laporan diunduh.'); }}>
              <Download className="w-4 h-4" /><span>Unduh laporan (.txt)</span>
            </button>
            <button type="button" className={btnGhost} onClick={() => { void navigator.clipboard?.writeText(report); toast?.('Hasil disalin.'); }}>
              <Copy className="w-4 h-4" /><span>Salin hasil</span>
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
};

// 3. Perekam Suara + Trim
const RecorderTool: React.FC<{ gate?: AudioExtraToolsProps['gate']; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [state, setState] = useState<'idle' | 'recording' | 'ready'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => () => { try { recRef.current?.state === 'recording' && recRef.current.stop(); } catch {} cleanup(); }, [cleanup]);

  const begin = async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('Browser ini belum mendukung perekaman suara.'); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      streamRef.current = stream;
      const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        cleanup();
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          const ctx = new AudioCtx();
          const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
          void ctx.close();
          setBuffer(decoded); setStart(0); setEnd(decoded.duration); setState('ready');
        } catch { setErr('Rekaman tidak bisa diproses. Coba rekam ulang.'); setState('idle'); }
      };
      recRef.current = rec; rec.start(250);
      setElapsed(0); setBuffer(null); setState('recording');
      const t0 = performance.now();
      const maxRec = maxSecondsFor('recorder');
      timerRef.current = window.setInterval(() => {
        const e = (performance.now() - t0) / 1000;
        setElapsed(e);
        if (e >= maxRec) { try { if (rec.state === 'recording') rec.stop(); } catch {} }
      }, 200);
    } catch (e) {
      cleanup();
      setErr((e as DOMException)?.name === 'NotAllowedError' ? 'Izin mikrofon ditolak.' : 'Gagal mengakses mikrofon.');
    }
  };
  const stop = () => { if (recRef.current?.state === 'recording') recRef.current.stop(); };

  const trimmed = useMemo(() => {
    if (!buffer) return null;
    const ch = sliceChannels(viewChannels(buffer), buffer.sampleRate, start, end);
    return ch[0].length > 0 ? toBuffer(ch, buffer.sampleRate) : null;
  }, [buffer, start, end]);
  const peaks = useMemo(() => (buffer ? peaksForDisplay(viewChannels(buffer), 120) : new Float32Array(0)), [buffer]);
  const dur = buffer?.duration ?? 0;

  return (
    <Panel title="Perekam" info={['Rekam dari mikrofon, potong bagian awal/akhir, lalu unduh.', `Rekaman otomatis berhenti di ${limitLabelFor('recorder')}.`]}>
      <div className="flex flex-wrap items-center gap-3">
        {state !== 'recording' ? (
          <button type="button" onClick={begin} className={btnPrimary}><Mic className="w-4 h-4" /><span>{state === 'ready' ? 'Rekam ulang' : 'Mulai merekam'}</span></button>
        ) : (
          <button type="button" onClick={stop} className="px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-sm inline-flex items-center gap-2 cursor-pointer"><Square className="w-4 h-4" /><span>Berhenti</span></button>
        )}
        {state === 'recording' && <span className="flex items-center gap-2 text-sm text-red-300 tabular-nums"><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />{fmtTime(elapsed)} <span className="text-gray-500">/ {limitLabelFor('recorder')}</span></span>}
      </div>
      <ErrorNote msg={err} />
      {state === 'ready' && buffer && (
        <div className="space-y-3">
          <Waveform peaks={peaks} from={start / dur} to={end / dur} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={`Mulai: ${fmtTime(start)}`}>
              <input type="range" min={0} max={dur} step={0.01} value={start} onChange={(e) => setStart(Math.min(+e.target.value, end - 0.1))} className={sliderCls} />
            </Field>
            <Field label={`Selesai: ${fmtTime(end)}`}>
              <input type="range" min={0} max={dur} step={0.01} value={end} onChange={(e) => setEnd(Math.max(+e.target.value, start + 0.1))} className={sliderCls} />
            </Field>
          </div>
          <p className="text-[11px] text-gray-400">Hasil potongan: {fmtTime(Math.max(0, end - start))} dari {fmtTime(dur)}</p>
          <Preview buffer={trimmed} />
          <ExportPanel buffer={trimmed} fileName="PlayMuzeck_Rekaman" toolId="recorder" gate={gate} onDone={toast} />
        </div>
      )}
    </Panel>
  );
};

// 4. Rapikan Audio
const LOUDNESS_PRESETS = [
  { id: 'podcast', label: 'Podcast (-16 LUFS)', lufs: -16 },
  { id: 'youtube', label: 'YouTube / Spotify (-14 LUFS)', lufs: -14 },
  { id: 'tv', label: 'Siaran TV (-23 LUFS)', lufs: -23 },
];

const CleanTool: React.FC<ExtraFileToolProps> = ({ gate, toast, isActive = false, onPicker }) => {
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [doSilence, setDoSilence] = useState(true);
  const [thr, setThr] = useState(-45);
  const [minSil, setMinSil] = useState(400);
  const [keep, setKeep] = useState(150);
  const [doNorm, setDoNorm] = useState(true);
  const [target, setTarget] = useState(-16);
  const [doMono, setDoMono] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<{ buffer: AudioBuffer; lines: string[] } | null>(null);

  const onFiles = async ([f]: File[]) => {
    setLoading(true); setErr(null); setOut(null);
    try { setBuffer(await decodeFile(f, 'clean')); setFileName(f.name); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca berkas.'); }
    finally { setLoading(false); }
  };
  const { input, open } = useFileInput({ onFiles });
  useRegisterPicker(onPicker, isActive, open, loading ? 'Membaca...' : buffer ? 'Ganti Berkas' : 'Unggah Berkas', loading);

  const run = async () => {
    if (!buffer) return;
    if (!doSilence && !doNorm && !doMono) { setErr('Aktifkan minimal satu proses.'); return; }
    setBusy(true); setErr(null); await tick();
    try {
      const sr = buffer.sampleRate;
      const lines: string[] = [];
      let ch: Channels = viewChannels(buffer);
      if (doMono && ch.length > 1) { ch = toMono(ch); lines.push('Stereo diubah ke mono.'); }
      if (doSilence) {
        const r = removeSilence(ch, sr, { thresholdDb: thr, minSilenceMs: minSil, keepMs: keep });
        ch = r.channels;
        lines.push(r.removedCount ? `Hening dihapus: ${r.removedCount} bagian, total ${r.removedSeconds.toFixed(1)} detik.` : 'Tidak ada jeda hening panjang.');
      }
      if (doNorm) {
        const r = normalizeLoudness(ch, sr, target, -1);
        if (r.beforeLufs === null) lines.push('Normalisasi dilewati: audio terlalu senyap.');
        else {
          ch = r.channels;
          lines.push(`Loudness: ${r.beforeLufs.toFixed(1)} → ${r.afterLufs?.toFixed(1)} LUFS (target ${target}).`);
        }
      }
      setOut({ buffer: toBuffer(ch, sr), lines });
      toast?.('Rapikan Audio selesai diproses.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal memproses audio.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      {input}
      <ToolFrame
        title="Rapikan Audio"
        info={['Hapus jeda hening, samakan loudness (LUFS), atau ubah stereo ke mono.', `Durasi berkas maks. ${limitLabelFor('clean')}.`]}
        file={buffer ? { name: fileName, meta: `${buffer.duration.toFixed(1)}s` } : null}
        emptyNotice={!buffer ? 'Unggah berkas audio (atau video untuk ekstrak audio) terlebih dahulu untuk memakai alat ini.' : null}
        limitText={`Durasi berkas maks. ${limitLabelFor('clean')} untuk alat ini (berlaku untuk berkas masuk dan hasil unduhan).`}
        error={err}
        footer={
          <AudioToolFooter
            toolId="clean" runLabel="Rapikan Audio" onRun={buffer ? run : open} running={busy}
            result={out?.buffer ?? null} onClear={() => setOut(null)}
            fileName={`PlayMuzeck_Bersih_${baseName(fileName)}`} gate={gate} onDone={toast}
          />
        }
      >
        {buffer && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doSilence} onChange={(e) => { setDoSilence(e.target.checked); setOut(null); }} />Hapus jeda hening</label>
              <Field label={`Threshold: ${thr} dB`}><input type="range" min={-70} max={-20} value={thr} onChange={(e) => { setThr(+e.target.value); setOut(null); }} className={sliderCls} disabled={!doSilence} /></Field>
              <Field label={`Jeda minimal: ${minSil} ms`}><input type="range" min={150} max={3000} step={50} value={minSil} onChange={(e) => { setMinSil(+e.target.value); setOut(null); }} className={sliderCls} disabled={!doSilence} /></Field>
              <Field label={`Sisakan jeda: ${keep} ms`}><input type="range" min={0} max={600} step={10} value={keep} onChange={(e) => { setKeep(+e.target.value); setOut(null); }} className={sliderCls} disabled={!doSilence} /></Field>
            </div>
            <div className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doNorm} onChange={(e) => { setDoNorm(e.target.checked); setOut(null); }} />Normalisasi volume (LUFS)</label>
              <div className="flex flex-col gap-1.5">
                {LOUDNESS_PRESETS.map((p) => (
                  <button key={p.id} type="button" disabled={!doNorm} onClick={() => { setTarget(p.lufs); setOut(null); }}
                    className={`text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${target === p.lufs ? 'border-accent bg-accent/15 text-white' : 'border-white/[0.1] text-gray-300'}`}>{p.label}</button>
                ))}
              </div>
              <Field label="Target (LUFS)"><input type="number" min={-40} max={-6} step={0.5} value={target} onChange={(e) => { setTarget(Math.max(-40, Math.min(-6, +e.target.value || -16))); setOut(null); }} className={inputCls} disabled={!doNorm} /></Field>
            </div>
            <div className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doMono} onChange={(e) => { setDoMono(e.target.checked); setOut(null); }} />Stereo ke mono</label>
              <p className="text-[11px] text-gray-400">Gabungkan kanal kiri dan kanan jadi mono untuk ukuran berkas lebih kecil.</p>
            </div>
          </div>
        )}
        {out && (
          <ul className="text-xs text-emerald-300 space-y-1">{out.lines.map((l) => <li key={l} className="flex gap-1.5"><CheckCircle className="w-4 h-4 shrink-0" />{l}</li>)}</ul>
        )}
      </ToolFrame>
    </>
  );
};

// 5. Metronom
const ACCENT_CYCLE: Accent[] = [2, 1, 0];
const ACCENT_LABEL: Record<Accent, string> = { 2: 'aksen', 1: 'normal', 0: 'senyap' };
const clampBpm = (n: number) => Math.max(30, Math.min(300, Math.round(n) || 100));
const QUICK_SIGS = ['2/4', '3/4', '4/4', '5/4', '6/4', '2/2', '3/8', '5/8', '6/8', '7/8', '9/8', '12/8'];
const DEN_NAME: Record<number, string> = { 1: 'not penuh', 2: 'setengah', 4: 'seperempat', 8: 'seperdelapan', 16: 'seperenambelas', 32: 'sepertigapuluhdua', 64: 'seperenampuluhempat' };
const SOUND_GROUPS = Array.from(new Set(CLICK_SOUNDS.map((s) => s.group)));
const SUB_GROUPS = (list: ReturnType<typeof subdivisionsFor>) => Array.from(new Set(list.map((s) => s.group)));

const MetronomeTool: React.FC<{ gate?: AudioExtraToolsProps['gate']; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [bpm, setBpm] = useState(100);
  const [num, setNum] = useState(4);
  const [den, setDen] = useState(4);
  const [groupId, setGroupId] = useState(() => defaultGrouping(4).join('+'));
  const [subId, setSubId] = useState('1');
  const [soundId, setSoundId] = useState('mechanical');
  const [tempoRef, setTempoRef] = useState<TempoRef>('quarter');
  const [vol, setVol] = useState(0.8);
  const [accents, setAccents] = useState<Accent[]>(() => makeTimeSignature(4, 4).accents);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [bars, setBars] = useState(16);
  const [clickBuf, setClickBuf] = useState<AudioBuffer | null>(null);

  const subs = useMemo(() => subdivisionsFor(den), [den]);
  const sub = subs.find((s) => s.id === subId) ?? subs[0];
  const snd = getClickSound(soundId);
  const groupOpts = useMemo(() => groupingsFor(num), [num]);
  const refOpts = TEMPO_REFS.filter((r) => r.id !== 'group3' || num % 3 === 0);
  const effRef: TempoRef = refOpts.some((r) => r.id === tempoRef) ? tempoRef : 'quarter';
  const barSec = barSeconds(bpm, num, den, effRef);

  const cfg = useRef({ bpm, num, den, tempoRef: effRef, sub, accents, soundId, vol });
  cfg.current = { bpm, num, den, tempoRef: effRef, sub, accents, soundId, vol };
  const ctxRef = useRef<AudioContext | null>(null);
  const masterRef = useRef<GainNode | null>(null);
  const bufRef = useRef<Map<string, AudioBuffer>>(new Map());
  const timerRef = useRef<number | null>(null);
  const nextRef = useRef(0);
  const pulseStartRef = useRef(0);
  const pulseRef = useRef(0);
  const subRef = useRef(0);
  const tapsRef = useRef<number[]>([]);

  const applySig = (n: number, d: number, groups?: number[]) => {
    const g = groups ?? defaultGrouping(n);
    setNum(n); setDen(d); setGroupId(g.join('+')); setAccents(accentsFromGroups(g, n)); setClickBuf(null);
    if (!subdivisionsFor(d).some((s) => s.id === subId)) setSubId('1');
    if (tempoRef === 'group3' && n % 3 !== 0) setTempoRef('quarter');
  };
  const changeGrouping = (id: string) => {
    const o = groupOpts.find((x) => x.id === id); if (!o) return;
    setGroupId(id); setAccents(accentsFromGroups(o.groups, num)); setClickBuf(null);
  };
  const cycleAccent = (i: number) => {
    setAccents((prev) => prev.map((a, j) => (j === i ? ACCENT_CYCLE[(ACCENT_CYCLE.indexOf(a) + 1) % ACCENT_CYCLE.length] : a)));
    setClickBuf(null);
  };

  const stop = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      void ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null; masterRef.current = null; bufRef.current = new Map();
    setRunning(false); setBeat(-1);
  }, []);
  useEffect(() => stop, [stop]);
  useEffect(() => { if (masterRef.current) masterRef.current.gain.value = vol; }, [vol]);

  // Sampel klik hasil sintesis (sama persis dengan yang masuk ke berkas unduhan).
  const bufferFor = (ctx: AudioContext, sid: string, kind: ClickKind): AudioBuffer => {
    const key = `${sid}|${kind}`;
    let b = bufRef.current.get(key);
    if (!b) {
      const pcm = clickSample(sid, kind, ctx.sampleRate);
      b = ctx.createBuffer(1, pcm.length, ctx.sampleRate);
      b.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
      bufRef.current.set(key, b);
    }
    return b;
  };
  const playClick = (ctx: AudioContext, dest: AudioNode, t: number, kind: ClickKind, sid: string) => {
    const src = ctx.createBufferSource(); src.buffer = bufferFor(ctx, sid, kind);
    const g = ctx.createGain(); g.gain.value = CLICK_GAIN[kind];
    src.connect(g); g.connect(dest); src.start(t);
  };
  const makeMaster = (ctx: AudioContext, volume: number) => {
    const master = ctx.createGain(); master.gain.value = volume;
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -4; lim.knee.value = 3; lim.ratio.value = 12; lim.attack.value = 0.001; lim.release.value = 0.05;
    master.connect(lim); lim.connect(ctx.destination);
    return master;
  };

  const schedule = () => {
    const ctx = ctxRef.current; const master = masterRef.current; if (!ctx || !master) return;
    while (nextRef.current < ctx.currentTime + 0.12) {
      const c = cfg.current; const dur = pulseSeconds(c.bpm, c.den, c.tempoRef); const offs = c.sub.offsets;
      if (subRef.current >= offs.length) subRef.current = 0;
      const t = Math.max(nextRef.current, ctx.currentTime);
      const pulse = pulseRef.current % c.num;
      const a = c.accents[pulse] ?? 1; const j = subRef.current;
      if (j === 0) {
        if (a === 2) playClick(ctx, master, t, 'accent', c.soundId);
        else if (a === 1) playClick(ctx, master, t, 'beat', c.soundId);
        window.setTimeout(() => setBeat(pulse), Math.max(0, (t - ctx.currentTime) * 1000));
      } else playClick(ctx, master, t, 'sub', c.soundId);
      subRef.current = j + 1;
      if (subRef.current < offs.length) nextRef.current = pulseStartRef.current + offs[subRef.current] * dur;
      else { pulseStartRef.current += dur; pulseRef.current += 1; subRef.current = 0; nextRef.current = pulseStartRef.current; }
    }
  };

  const start = async () => {
    stop();
    const ctx = new AudioCtx();
    void ctx.resume();
    let allowed = true;
    try { allowed = !gate || (await gate.use('metronome', 'session')); } catch {}
    if (!allowed) { void ctx.close(); return; }

    const master = makeMaster(ctx, cfg.current.vol);
    ctxRef.current = ctx; masterRef.current = master; bufRef.current = new Map();
    pulseStartRef.current = ctx.currentTime + 0.05; nextRef.current = pulseStartRef.current; pulseRef.current = 0; subRef.current = 0;
    timerRef.current = window.setInterval(schedule, 25);
    setRunning(true);
  };

  // Dengarkan contoh bunyi (aksen, ketukan, subdivisi) tanpa memulai metronom.
  const audition = () => {
    if (running) return;
    const ctx = new AudioCtx(); void ctx.resume();
    const master = makeMaster(ctx, cfg.current.vol);
    const seq: ClickKind[] = ['accent', 'beat', 'beat', 'sub', 'beat', 'sub'];
    const t0 = ctx.currentTime + 0.05;
    seq.forEach((k, i) => playClick(ctx, master, t0 + i * 0.32, k, cfg.current.soundId));
    window.setTimeout(() => { void ctx.close().catch(() => {}); }, 2600);
  };

  const tap = () => {
    const now = performance.now();
    const taps = tapsRef.current.filter((t) => now - t < 2500); taps.push(now); tapsRef.current = taps;
    if (taps.length >= 2) {
      const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBpm(clampBpm(60000 / iv));
    }
  };

  const maxBars = Math.max(1, Math.floor(300 / barSec));
  const makeFile = () => {
    const b = Math.min(bars, maxBars);
    const pcm = renderMetronome({ bpm, beatsPerBar: num, denominator: den, tempoRef: effRef, bars: b, subdivisionId: sub.id, accents, sound: soundId, sampleRate: 44100 });
    setClickBuf(toBuffer([pcm], 44100));
  };
  const [bpmText, setBpmText] = useState(String(bpm));
  useEffect(() => { setBpmText(String(bpm)); }, [bpm]);
  const commitBpm = () => {
    const n = Number(bpmText);
    if (Number.isFinite(n) && bpmText.trim() !== '') setBpm(clampBpm(n)); else setBpmText(String(bpm));
  };
  const refHint = refOpts.find((r) => r.id === effRef)?.hint;

  return (
    <Panel title="Metronom" info={['Atur tempo, birama (pembilang 1–32, penyebut 1–64), pengelompokan aksen, klik per ketukan sampai 1/64 (termasuk triol, kuintol, septol), bunyi klik, lalu unduh ke berkas.']}>
      <div className="flex flex-wrap items-center justify-center gap-2 py-1" aria-live="off">
        {accents.map((a, i) => {
          const on = running && beat === i;
          const base = a === 0 ? 'border-dashed border-white/15 bg-transparent opacity-60' : a === 2 ? 'border-accent2 bg-accent2/25 w-6 h-6' : 'border-white/30 bg-black/40';
          const lit = on ? (a === 2 ? '!bg-accent2 !border-accent2 scale-125' : '!bg-accent !border-accent scale-125') : '';
          return (
            <button key={i} type="button" onClick={() => cycleAccent(i)} aria-label={`Pulsa ${i + 1}: ${ACCENT_LABEL[a]}`}
              className={`w-5 h-5 rounded-full border transition-all cursor-pointer ${base} ${lit}`} />
          );
        })}
      </div>

      <div className={`${CARD_CLS} space-y-2 text-xs`}>
        <div className="flex justify-between items-center gap-3 flex-wrap">
          <label htmlFor="metro-bpm" className="text-gray-300 font-bold">Tempo ({tempoMarking(bpm)}):</label>
          <div className="flex items-center gap-2">
            <input id="metro-bpm" type="text" inputMode="numeric" value={bpmText}
              onChange={(e) => setBpmText(e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              onBlur={commitBpm} onKeyDown={(e) => { if (e.key === 'Enter') { commitBpm(); (e.target as HTMLInputElement).blur(); } }}
              className={NUM_FIELD_CLS} />
            <span className="text-gray-400 font-mono">BPM</span>
            <button type="button" onClick={tap} className={btnGhost}>Tap tempo</button>
          </div>
        </div>
        <input type="range" min={30} max={300} value={bpm} onChange={(e) => setBpm(+e.target.value)} className={sliderCls} aria-label="Tempo (BPM)" />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-bold text-gray-300">Birama</p>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Birama populer">
          {QUICK_SIGS.map((id) => {
            const [n, d] = id.split('/').map(Number);
            const sel = n === num && d === den;
            return (
              <button key={id} type="button" onClick={() => applySig(n, d)} aria-pressed={sel}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${sel ? 'border-accent bg-accent/15 text-white' : 'border-white/[0.1] text-gray-300'}`}>{id}</button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Field label="Pembilang (pulsa per bar)" hint={`${num}/${den} · 1 bar = ${barSec.toFixed(2)} detik`}>
          <select value={num} onChange={(e) => applySig(+e.target.value, den)} className={inputCls}>
            {Array.from({ length: MAX_NUMERATOR }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </Field>
        <Field label="Penyebut (nilai not)" hint={`1 pulsa = not ${DEN_NAME[den]}`}>
          <select value={den} onChange={(e) => applySig(num, +e.target.value)} className={inputCls}>
            {DENOMINATORS.map((d) => <option key={d} value={d}>{d} — {DEN_NAME[d]}</option>)}
          </select>
        </Field>
        <Field label="Pengelompokan aksen" hint="Aksen jatuh di awal tiap kelompok">
          <select value={groupId} onChange={(e) => changeGrouping(e.target.value)} className={inputCls}>
            {groupOpts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            {!groupOpts.some((o) => o.id === groupId) && <option value={groupId}>Kustom</option>}
          </select>
        </Field>
        <Field label="Acuan BPM" hint={refHint}>
          <select value={effRef} onChange={(e) => { setTempoRef(e.target.value as TempoRef); setClickBuf(null); }} className={inputCls}>
            {refOpts.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="Klik per ketukan" hint={sub.hint}>
          <select value={sub.id} onChange={(e) => { setSubId(e.target.value); setClickBuf(null); }} className={inputCls}>
            {SUB_GROUPS(subs).map((g) => (
              <optgroup key={g} label={g}>{subs.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>
            ))}
          </select>
        </Field>
        <Field label="Bunyi klik" hint={snd.hint}>
          <select value={soundId} onChange={(e) => { setSoundId(e.target.value); setClickBuf(null); }} className={inputCls}>
            {SOUND_GROUPS.map((g) => (
              <optgroup key={g} label={g}>{CLICK_SOUNDS.filter((x) => x.group === g).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</optgroup>
            ))}
          </select>
        </Field>
        <Field label={`Volume: ${Math.round(vol * 100)}%`}>
          <input type="range" min={0} max={1} step={0.05} value={vol} onChange={(e) => setVol(+e.target.value)} className={sliderCls} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {!running ? <button type="button" onClick={start} className={btnPrimary}><Play className="w-3.5 h-3.5 fill-on-accent" /><span>Mulai</span></button>
          : <button type="button" onClick={stop} className="px-5 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-md"><Square className="w-3.5 h-3.5" /><span>Berhenti</span></button>}
        <button type="button" onClick={audition} disabled={running} className={btnGhost}><span>Dengar contoh bunyi</span></button>
        <button type="button" onClick={() => { const o = groupOpts.find((x) => x.id === groupId); setAccents(accentsFromGroups(o ? o.groups : defaultGrouping(num), num)); setClickBuf(null); }} className={btnGhost}><RotateCcw className="w-3.5 h-3.5" /><span>Reset aksen</span></button>
      </div>
      <div className={`${CARD_CLS} space-y-3 text-xs`}>
        <p className="font-bold text-gray-300">Unduh klik sebagai berkas</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={`Jumlah bar (maks ${maxBars})`}>
            <input type="number" min={1} max={maxBars} value={Math.min(bars, maxBars)} onChange={(e) => setBars(Math.max(1, Math.min(maxBars, Math.round(+e.target.value) || 1)))} className={inputCls} />
          </Field>
          <button type="button" onClick={makeFile} className={btnGhost}>Buat berkas</button>
        </div>
        {clickBuf && (<><Preview buffer={clickBuf} /><ExportPanel buffer={clickBuf} fileName={`PlayMuzeck_Metronom_${bpm}BPM_${num}-${den}`} toolId="metronome" gate={gate} onDone={toast} sessionKey="session" /></>)}
      </div>
    </Panel>
  );
};

// 6. Tuner
const PRESET_GROUPS = Array.from(new Set(TUNING_PRESETS.map((p) => p.group)));

const TunerTool: React.FC<{ gate?: AudioExtraToolsProps['gate'] }> = ({ gate }) => {
  const [preset, setPreset] = useState<TuningPreset>(TUNING_PRESETS.find((p) => p.id === 'guitar') ?? TUNING_PRESETS[1]);
  const [a4, setA4] = useState(440);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reading, setReading] = useState<{ freq: number; clarity: number } | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const toneCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const recent = useRef<number[]>([]);
  const lastGood = useRef(0);
  const a4Ref = useRef(a4); a4Ref.current = a4;
  const presetRef = useRef(preset); presetRef.current = preset;

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      void ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    setRunning(false); setReading(null); recent.current = [];
  }, []);

  useEffect(() => {
    return () => {
      stop();
      if (toneCtxRef.current && toneCtxRef.current.state !== 'closed') {
        void toneCtxRef.current.close().catch(() => {});
        toneCtxRef.current = null;
      }
    };
  }, [stop]);

  const start = async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErr('Browser ini belum mendukung akses mikrofon.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') await ctx.resume();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 8192;
      ctx.createMediaStreamSource(stream).connect(analyser);
      streamRef.current = stream; ctxRef.current = ctx; setRunning(true);
      const buf = new Float32Array(analyser.fftSize);
      let last = 0;
      const loop = (now: number) => {
        rafRef.current = requestAnimationFrame(loop);
        if (now - last < 80) return; last = now;
        analyser.getFloatTimeDomainData(buf);
        const lf = lowestFreq(presetRef.current, a4Ref.current);
        const p = detectPitch(buf, ctx.sampleRate, lf ? Math.max(22, lf * 0.8) : 35, 1400);
        if (p && p.clarity > 0.82) {
          const r = recent.current; r.push(p.freq); if (r.length > 5) r.shift();
          const sorted = [...r].sort((x, y) => x - y); const med = sorted[Math.floor(sorted.length / 2)];
          lastGood.current = now; setReading({ freq: med, clarity: p.clarity });
        } else if (now - lastGood.current > 600) { recent.current = []; setReading(null); }
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      stop();
      setErr((e as DOMException)?.name === 'NotAllowedError' ? 'Izin mikrofon ditolak.' : 'Gagal mengakses mikrofon.');
    }
  };

  const playRef = (midi: number) => {
    try {
      const ctx = toneCtxRef.current || new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();
      toneCtxRef.current = ctx;

      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = midiToFreq(midi, a4Ref.current);
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.8);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + 1.85);
    } catch {}
  };

  const note = reading ? freqToNote(reading.freq, a4) : null;
  const ns = reading && preset.strings.length > 0 ? nearestString(reading.freq, preset, a4) : null;
  const cents = ns ? ns.cents : note?.cents ?? 0;
  const clamped = Math.max(-50, Math.min(50, cents));
  const inTune = reading !== null && Math.abs(cents) <= 5;
  const status = !reading ? 'Mainkan satu nada…' : inTune ? 'Pas!' : cents < 0 ? 'Terlalu rendah, kencangkan' : 'Terlalu tinggi, kendurkan';

  return (
    <Panel title="Tuner" info={['Setel instrumen atau cek nada vokal lewat mikrofon.', 'Ketuk nama senar untuk mendengar nada acuan.']}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Instrumen">
          <select value={preset.id} onChange={(e) => { setPreset(TUNING_PRESETS.find((p) => p.id === e.target.value)!); recent.current = []; }} className={inputCls}>
            {PRESET_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {TUNING_PRESETS.filter((p) => p.group === g).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label={`Acuan A4: ${a4} Hz`}>
          <div className="flex items-center gap-2">
            <input type="range" min={430} max={450} value={a4} onChange={(e) => setA4(+e.target.value)} className={sliderCls} />
            <button type="button" onClick={() => setA4(440)} disabled={a4 === 440} className={btnGhost}>440</button>
          </div>
        </Field>
      </div>
      {!running ? <button type="button" onClick={start} className={btnPrimary}><Mic className="w-3.5 h-3.5" /><span>Mulai tuner</span></button>
        : <button type="button" onClick={stop} className="px-5 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-md w-fit"><X className="w-4 h-4" /><span>Hentikan</span></button>}
      <ErrorNote msg={err} />
      <div className="rounded-xl bg-black/50 border border-white/5 p-5 text-center space-y-3">
        <div className={`text-6xl font-black tabular-nums ${inTune ? 'text-emerald-400' : 'text-white'}`}>
          {note ? (
            <>
              {ns ? ns.string.label.replace(/\d+$/, '') : note.name}
              <span className="text-2xl text-gray-400">{ns ? (ns.string.label.match(/\d+$/)?.[0] || '') : note.octave}</span>
            </>
          ) : '—'}
        </div>
        <div className="text-xs text-gray-400 tabular-nums">{reading ? `${reading.freq.toFixed(1)} Hz · ${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cent` : '\u00a0'}</div>
        <div className="relative h-3 rounded-full bg-white/10 mx-auto max-w-md" role="img" aria-label="Jarum tuner">
          <div className="absolute left-1/2 top-[-4px] bottom-[-4px] w-px bg-white/40" />
          {reading && <div className={`absolute top-[-4px] w-2 h-5 rounded-sm transition-all duration-100 ${inTune ? 'bg-emerald-400' : 'bg-accent'}`} style={{ left: `calc(${50 + clamped}% - 4px)` }} />}
        </div>
        <div className={`text-sm font-bold ${inTune ? 'text-emerald-400' : 'text-gray-300'}`}>{status}</div>
      </div>
      {preset.strings.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {preset.strings.map((s, i) => (
            <button key={`${s.label}-${i}`} type="button" onClick={() => playRef(s.midi)} title="Dengarkan nada acuan"
              className={`px-3 py-2 rounded-xl text-sm font-black border cursor-pointer ${ns?.string.midi === s.midi && reading ? 'border-accent bg-accent/15 text-white' : 'border-white/[0.12] text-gray-300'}`}>{s.label}</button>
          ))}
        </div>
      )}
    </Panel>
  );
};

// 7. Ulangi Audio (loop 2 sampai 5 kali)
const LoopTool: React.FC<ExtraFileToolProps> = ({ gate, toast, isActive = false, onPicker }) => {
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [times, setTimes] = useState(2);
  const [crossfade, setCrossfade] = useState(0);
  const [result, setResult] = useState<AudioBuffer | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dur = buffer?.duration ?? 0;
  // Jumlah ulangan tertinggi yang hasilnya masih di bawah batas durasi alat (maks. MAX_REPEAT).
  const allowed = buffer ? maxRepeatsFor('loop', dur, MAX_REPEAT, crossfade) : MAX_REPEAT;
  const canLoop = !buffer || allowed >= MIN_REPEAT;
  const useTimes = Math.max(MIN_REPEAT, Math.min(times, allowed));
  const outSec = buffer ? repeatedDuration(dur, useTimes, crossfade) : 0;

  const onFiles = async ([f]: File[]) => {
    setLoading(true); setErr(null); setResult(null);
    try { setBuffer(await decodeFile(f, 'loop')); setFileName(f.name); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca berkas.'); }
    finally { setLoading(false); }
  };
  const { input, open } = useFileInput({ onFiles });
  useRegisterPicker(onPicker, isActive, open, loading ? 'Membaca...' : buffer ? 'Ganti Berkas' : 'Unggah Berkas', loading);
  const pickTimes = (n: number) => { setTimes(n); setResult(null); };

  const run = async () => {
    if (!buffer || !canLoop) return;
    const tooLong = checkOutputDuration('loop', outSec);
    if (tooLong) { setErr(tooLong); return; }
    setBusy(true); setErr(null); await tick();
    try {
      const sr = buffer.sampleRate;
      setResult(toBuffer(repeatChannels(viewChannels(buffer), sr, useTimes, crossfade), sr));
      toast?.('Ulangi Audio selesai diproses.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal memproses audio.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      {input}
      <ToolFrame
        title="Ulangi Audio"
        info={[
          'Unggah satu berkas, pilih diulang 2 sampai 5 kali, lalu unduh sebagai satu berkas.',
          'Crossfade menyatukan akhir dan awal tiap ulangan supaya loop terdengar mulus.',
          `Berkas masuk maks. ${limitLabelFor('loop')}, dan hasil pengulangan juga maks. ${limitLabelFor('loop')}.`,
        ]}
        file={buffer ? { name: fileName, meta: `${buffer.duration.toFixed(1)}s` } : null}
        emptyNotice={!buffer ? 'Unggah berkas audio (atau video untuk ekstrak audio) terlebih dahulu untuk memakai alat ini.' : null}
        limitText={`Durasi berkas maks. ${limitLabelFor('loop')} untuk alat ini (berlaku untuk berkas masuk dan hasil unduhan).`}
        error={err}
        footer={
          <AudioToolFooter
            toolId="loop" runLabel="Ulangi Audio" onRun={buffer ? run : open} running={busy} runDisabled={Boolean(buffer) && !canLoop}
            result={result} onClear={() => setResult(null)}
            fileName={`PlayMuzeck_Ulang${useTimes}x_${baseName(fileName)}`} gate={gate} onDone={toast}
          />
        }
      >
        {buffer && (
          <>
            <p className="text-[11px] text-gray-400">Durasi asli: {fmtTime(dur)} · maks. {limitLabelFor('loop')} per berkas</p>
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-300">Ulangi berapa kali?</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Jumlah pengulangan">
                {Array.from({ length: MAX_REPEAT - MIN_REPEAT + 1 }, (_, i) => i + MIN_REPEAT).map((n) => {
                  const off = n > allowed;
                  return (
                    <button key={n} type="button" disabled={off} onClick={() => pickTimes(n)} aria-pressed={useTimes === n}
                      title={off ? `Hasil ${n}x akan lebih dari ${limitLabelFor('loop')}` : undefined}
                      className={`min-w-[3.5rem] px-3 py-2 rounded-xl text-sm font-black border ${off ? 'border-white/5 text-gray-600 line-through cursor-not-allowed' : useTimes === n ? 'border-accent bg-accent/15 text-white cursor-pointer' : 'border-white/[0.12] text-gray-300 cursor-pointer'}`}>
                      {n}x
                    </button>
                  );
                })}
              </div>
              {canLoop && allowed < MAX_REPEAT && (
                <p className="text-[11px] text-amber-300">Audio sepanjang ini hanya bisa diulang sampai {allowed}x supaya hasilnya tidak melebihi {limitLabelFor('loop')}.</p>
              )}
            </div>
            <Field label={`Crossfade antar ulangan: ${crossfade.toFixed(1)} dtk`} hint="0 = sambung langsung. Naikkan bila akhir dan awal audio terdengar patah.">
              <input type="range" min={0} max={2} step={0.1} value={crossfade} onChange={(e) => { setCrossfade(+e.target.value); setResult(null); }} className={sliderCls} />
            </Field>
            {canLoop ? (
              <p className="text-[11px] text-gray-400">Perkiraan durasi hasil: {fmtTime(outSec)} ({useTimes}x)</p>
            ) : (
              <ErrorNote msg={`Audio ${formatDuration(dur)} terlalu panjang untuk diulang: hasil 2x akan melebihi ${limitLabelFor('loop')}. Gunakan berkas yang lebih pendek (maks. sekitar 30 menit).`} />
            )}
          </>
        )}
        {result && (
          <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />Selesai, {useTimes}x ulangan, durasi {fmtTime(result.duration)}.</p>
        )}
      </ToolFrame>
    </>
  );
};

// 8. Edit Metadata
// Tidak men-decode / meng-encode audio: hanya blok tag yang ditulis ulang (lihat services/audioMetadata.ts),
// jadi kualitas identik dan prosesnya instan walau berkasnya besar.
const META_ACCEPT = '.mp3,.flac,.wav,.m4a,.mp4,audio/mpeg,audio/flac,audio/x-flac,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a';
const COVER_MAX_DIM = 1600;
const COVER_MAX_BYTES = 3 * 1024 * 1024;
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const safeFileName = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim();
let metaSeq = 0;

const FORMAT_HINT: Record<MetaFormat, string> = {
  mp3: 'Tag ID3v2.3, terbaca di hampir semua pemutar. Jika berkas punya tag ID3v1, ikut disegarkan.',
  flac: 'Vorbis Comment dan gambar FLAC (standar untuk FLAC).',
  wav: 'WAV menyimpan tag di LIST INFO (terbaca Windows) dan chunk ID3 (cover, lirik, semua kolom). Dukungan cover & lirik WAV tergantung pemutar.',
  m4a: 'Atom iTunes (judul, artis, cover, lirik, dan lainnya), terbaca di iTunes, Apple Music, dan Android.',
};

/** Siapkan gambar cover: JPEG/PNG <= 1600 px dipakai apa adanya; lainnya (WebP, GIF, BMP, atau terlalu besar) dikonversi ke JPEG. */
async function prepareCover(file: File): Promise<{ pic: AudioPicture; adjusted: boolean }> {
  const raw = new Uint8Array(await file.arrayBuffer());
  const sn = sniffImage(raw);
  if (sn && (sn.mime === 'image/jpeg' || sn.mime === 'image/png') && sn.width && sn.height
    && Math.max(sn.width, sn.height) <= COVER_MAX_DIM && raw.length <= COVER_MAX_BYTES) {
    return { pic: { mime: sn.mime, data: raw, width: sn.width, height: sn.height }, adjusted: false };
  }
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('Gambar tidak bisa dibaca. Pakai JPG, PNG, WebP, atau GIF.'); }
  try {
    const scale = Math.min(1, COVER_MAX_DIM / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('Gambar tidak bisa diproses di browser ini.');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    g.drawImage(bmp, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.9));
    if (!blob) throw new Error('Gambar tidak bisa diproses di browser ini.');
    return { pic: { mime: 'image/jpeg', data: new Uint8Array(await blob.arrayBuffer()), width: w, height: h }, adjusted: true };
  } finally { bmp.close?.(); }
}

/** "01 - Artis - Judul.mp3" -> { track: '01', artist: 'Artis', title: 'Judul' }. */
function guessFromFileName(name: string): { track: string; artist: string; title: string } {
  let base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  let track = '';
  const m = /^(\d{1,3})\s*[-.)]\s+(.+)$/.exec(base);
  if (m) { track = String(parseInt(m[1], 10)); base = m[2]; }
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) return { track, artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { track, artist: '', title: base };
}

const MetadataTool: React.FC<ExtraFileToolProps> = ({ gate, toast, isActive = false, onPicker }) => {
  const [file, setFile] = useState<File | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fmt, setFmt] = useState<MetaFormat>('mp3');
  const [info, setInfo] = useState<AudioTechInfo>({});
  const [preserved, setPreserved] = useState(0);
  const [orig, setOrig] = useState<AudioTags>(emptyTags());
  const [tags, setTags] = useState<AudioTags>(emptyTags());
  const [sessionKey, setSessionKey] = useState('');
  const [renameFromTags, setRenameFromTags] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [coverNote, setCoverNote] = useState<string | null>(null);
  const [outBytes, setOutBytes] = useState<Uint8Array | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) { setAudioUrl(null); return; }
    const u = URL.createObjectURL(file);
    setAudioUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  useEffect(() => {
    if (!tags.cover) { setCoverUrl(null); return; }
    const u = URL.createObjectURL(new Blob([tags.cover.data as unknown as BlobPart], { type: tags.cover.mime }));
    setCoverUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [tags.cover]);

  // Hasil yang sudah diterapkan jadi usang begitu tag, cover, atau berkasnya berubah.
  useEffect(() => { setOutBytes(null); setDownloaded(false); }, [tags, fmt, bytes]);

  const set = (k: TextField, v: string) => { setTags((t) => ({ ...t, [k]: v })); };

  const onFiles = async ([f]: File[]) => {
    setLoading(true); setErr(null); setCoverNote(null);
    try {
      if (f.size > MAX_FILE_BYTES) throw new Error(`Berkas ${fmtBytes(f.size)} melebihi batas ${fmtBytes(MAX_FILE_BYTES)} untuk alat ini.`);
      await tick();
      const data = new Uint8Array(await f.arrayBuffer());
      const r = readTags(data);
      setFile(f); setBytes(data); setFmt(r.format); setInfo(r.info); setPreserved(r.preservedCount);
      setOrig(r.tags); setTags(r.tags); setSessionKey(`meta${++metaSeq}`); setRenameFromTags(false);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca berkas.'); }
    finally { setLoading(false); }
  };
  const { input, open } = useFileInput({ accept: META_ACCEPT, onFiles });
  useRegisterPicker(onPicker, isActive, open, loading ? 'Membaca...' : file ? 'Ganti Berkas' : 'Unggah Berkas', loading);

  const onCover = async (f: File | undefined) => {
    if (!f) return;
    setErr(null); setCoverNote(null);
    if (!f.type.startsWith('image/')) { setErr('Pilih berkas gambar (JPG, PNG, WebP, atau GIF).'); return; }
    try {
      const { pic, adjusted } = await prepareCover(f);
      if (pic.data.length > MAX_COVER_BYTES) throw new Error('Gambar cover terlalu besar (maks. 8 MB).');
      setTags((t) => ({ ...t, cover: pic }));
      if (adjusted) setCoverNote('Gambar disesuaikan (dikonversi ke JPEG dan/atau diperkecil maks. 1600 px) agar ringan dan kompatibel di semua pemutar.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca gambar.'); }
  };

  const downloadCover = () => {
    if (!tags.cover) return;
    downloadBlob(new Blob([tags.cover.data as unknown as BlobPart], { type: tags.cover.mime }), `Cover_${baseName(file?.name ?? 'audio')}.${imageExtension(tags.cover.mime)}`);
  };

  const dirty = useMemo(() => {
    if (tags.cover !== orig.cover) return true;
    return TEXT_FIELDS.some((k) => tags[k] !== orig[k]);
  }, [tags, orig]);

  const fillFromName = () => {
    if (!file) return;
    const g = guessFromFileName(file.name);
    setTags((t) => ({ ...t, title: t.title || g.title, artist: t.artist || g.artist, track: t.track || g.track }));
   
  };

  // "Jalankan": tulis tag ke salinan berkas di memori (belum memakai jatah).
  const apply = async () => {
    if (!bytes || !file) { open(); return; }
    if (busy) return;
    setBusy(true); setErr(null); setDownloaded(false);
    try {
      await tick();
      setOutBytes(writeTags(bytes, tags, fmt));
      toast?.('Edit Metadata selesai diproses.');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal menyimpan metadata.'); }
    finally { setBusy(false); }
  };

  // "Unduh": jatah dipakai di sini, sama seperti alat tambahan lain. Unduh ulang berkas yang sama tidak memakai jatah lagi.
  const download = async () => {
    if (!outBytes || !file || downloading) return;
    const key = sessionKey;
    const wasPaid = gate?.has('metadata', key) ?? false;
    setDownloading(true); setErr(null);
    if (gate && !(await gate.use('metadata', key))) { setDownloading(false); return; }
    try {
      let name = safeFileName(file.name.replace(/\.[^.]+$/, '')) || 'audio';
      if (renameFromTags && tags.title.trim()) {
        const n = safeFileName(tags.artist.trim() ? `${tags.artist.trim()} - ${tags.title.trim()}` : tags.title.trim());
        if (n) name = n;
      }
      downloadBlob(new Blob([outBytes as unknown as BlobPart], { type: FORMAT_MIME[fmt] }), `${name}.${FORMAT_EXT[fmt]}`);
      setDownloaded(true);
      toast?.(`Metadata ${FORMAT_LABEL[fmt]} berhasil disimpan dan diunduh.`);
    } catch (e) {
      if (!wasPaid) gate?.refund('metadata', key);
      setErr(e instanceof Error ? e.message : 'Gagal mengunduh berkas.');
    } finally { setDownloading(false); }
  };

  // Format unduhan Edit Metadata selalu sama dengan berkas asal (tag ditulis tanpa encode ulang), jadi format lain dikunci.
  const ownFormat: DownloadFormat | null = file ? (fmt.toUpperCase() as DownloadFormat) : null;
  const lockedFormats = Object.fromEntries(
    (['MP3', 'WAV', 'M4A', 'FLAC'] as const)
      .filter((f) => f !== ownFormat)
      .map((f) => [f, file ? 'Edit Metadata tidak mengubah format berkas. Pakai alat Convert untuk ganti format.' : 'Unggah berkas terlebih dahulu.']),
  ) as Partial<Record<DownloadFormat, string>>;

  const dateBad = tags.date.trim() !== '' && !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(tags.date.trim());
  const cv = tags.cover;
  const techLine = [
    FORMAT_LABEL[fmt],
    file ? fmtBytes(file.size) : '',
    info.durationSec ? fmtTime(info.durationSec) : '',
    info.sampleRate ? `${info.sampleRate.toLocaleString('id-ID')} Hz` : '',
    info.channels ? (info.channels === 1 ? 'Mono' : info.channels === 2 ? 'Stereo' : `${info.channels} kanal`) : '',
    info.bitDepth ? `${info.bitDepth}-bit` : '',
  ].filter(Boolean).join(' · ');

  const txt = (k: TextField, label: string, opts: { hint?: string; numeric?: boolean; max?: number; list?: string; placeholder?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      <input
        type="text" value={tags[k]} maxLength={opts.max ?? 300} list={opts.list} placeholder={opts.placeholder}
        inputMode={opts.numeric ? 'numeric' : undefined} autoComplete="off" className={inputCls}
        onChange={(e) => set(k, opts.numeric ? e.target.value.replace(k === 'bpm' ? /[^\d.]/g : /\D/g, '').slice(0, k === 'bpm' ? 6 : 4) : e.target.value)}
      />
    </Field>
  );

  return (
    <>
    {input}
    <ToolFrame
      title="Edit Metadata"
      info={[
        'Ubah judul, artis, album, cover, lirik, dan tag lain langsung di berkas audio. Audio tidak di-decode atau di-encode ulang, jadi kualitas suara persis sama dan prosesnya cepat.',
        'Format yang didukung: MP3, FLAC, WAV, dan M4A/MP4. Untuk OGG, Opus, atau AAC mentah, ganti format dulu lewat alat Konversi.',
        'Tag lain yang tidak ada di formulir (mis. ReplayGain, gambar tambahan) dipertahankan apa adanya. Cover diperkecil otomatis bila lebih dari 1600 px.',
        `Ukuran berkas maks. ${fmtBytes(MAX_FILE_BYTES)}. Berkas diproses di perangkatmu dan tidak diunggah.`,
      ]}
      file={file ? { name: file.name, meta: fmtBytes(file.size) } : null}
      emptyNotice={!file ? 'Unggah berkas audio (MP3, FLAC, WAV, atau M4A) terlebih dahulu untuk memakai alat ini.' : null}
      limitText={`Ukuran berkas maks. ${fmtBytes(MAX_FILE_BYTES)} untuk alat ini. Durasi tidak dibatasi karena audio tidak di-decode.`}
      error={err}
      footer={
        <ToolFooter
          formatRow={
            <FormatRow
              value={ownFormat} onChange={() => undefined} disabled={lockedFormats} strike={false}
              info="Edit Metadata hanya menulis ulang tag di berkas aslinya tanpa encode ulang, jadi format unduhan selalu sama dengan format berkas yang diunggah. Untuk mengganti format, pakai alat Convert."
            />
          }
          runLabel="Edit Metadata" onRun={file && bytes ? apply : open} running={busy} runDisabled={loading}
          ready={Boolean(outBytes)} onClear={() => { setOutBytes(null); setDownloaded(false); }}
          downloadLabel={`Unduh ${ownFormat ?? ''}`.trim()} onDownload={download} downloading={downloading}
          after={
            downloaded
              ? <span className="text-emerald-400 text-xs font-bold flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Berkas terunduh</span>
              : !outBytes && dirty
                ? <span className="text-amber-300 text-[11px]">Ada perubahan. Klik “Jalankan Edit Metadata” untuk menerapkannya sebelum mengunduh.</span>
                : null
          }
        />
      }
    >
      {file && bytes && (
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-[11px] text-gray-400">{techLine}</p>
            {audioUrl && <audio controls src={audioUrl} className="w-full" />}
            <p className="text-[11px] text-gray-500">{FORMAT_HINT[fmt]}</p>
            {preserved > 0 && <p className="text-[11px] text-gray-500">{preserved} tag tambahan di berkas ini (mis. ReplayGain) tidak ditampilkan, tetapi dipertahankan.</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[11rem_1fr] gap-4">
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-300">Cover</p>
              <div className="w-full max-w-[11rem] aspect-square rounded-xl overflow-hidden bg-black/60 border border-white/10 flex items-center justify-center">
                {coverUrl
                  ? <img src={coverUrl} alt="Cover album" className="w-full h-full object-cover" />
                  : <div className="text-center text-gray-500 text-[11px] px-3 space-y-1"><ImageIcon className="w-6 h-6 mx-auto" /><p>Belum ada cover</p></div>}
              </div>
              {cv && (
                <p className="text-[10px] text-gray-500">
                  {cv.width && cv.height ? `${cv.width}×${cv.height} · ` : ''}{imageExtension(cv.mime).toUpperCase()} · {fmtBytes(cv.data.length)}
                </p>
              )}
              {cv?.width && cv.height && cv.width !== cv.height && <p className="text-[10px] text-amber-300">Cover tidak persegi; sebagian pemutar akan memotongnya.</p>}
              {cv?.width && cv.height && Math.min(cv.width, cv.height) < 300 && <p className="text-[10px] text-amber-300">Resolusi rendah. Disarankan minimal 500×500 px.</p>}
              {coverNote && <p className="text-[10px] text-amber-300">{coverNote}</p>}
              <input ref={coverInput} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void onCover(f); }} />
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => coverInput.current?.click()} className={btnGhost}>
                  <ImagePlus className="w-4 h-4 text-accent" /><span>{cv ? 'Ganti' : 'Pilih cover'}</span>
                </button>
                {cv && (
                  <>
                    <button type="button" onClick={downloadCover} className={btnGhost} aria-label="Unduh cover"><Download className="w-4 h-4" /></button>
                    <button type="button" onClick={() => { setTags((t) => ({ ...t, cover: null })); setCoverNote(null); }} className={btnGhost} aria-label="Hapus cover"><Trash2 className="w-4 h-4" /></button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-4 min-w-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">{txt('title', 'Judul')}</div>
                {txt('artist', 'Artis')}
                {txt('album', 'Album')}
                {txt('albumArtist', 'Artis album')}
                {txt('genre', 'Genre', { list: 'pm-meta-genres' })}
                <datalist id="pm-meta-genres">{GENRE_SUGGESTIONS.map((g) => <option key={g} value={g} />)}</datalist>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {txt('track', 'Trek ke', { numeric: true })}
                {txt('trackTotal', 'Dari total', { numeric: true })}
                {txt('disc', 'Disc ke', { numeric: true })}
                {txt('discTotal', 'Dari total', { numeric: true })}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  {txt('date', 'Tahun / tanggal rilis', { max: 10, placeholder: '2024 atau 2024-05-17' })}
                  {dateBad && <p className="text-[10px] text-amber-300 mt-1">Format yang disarankan: 2024 atau 2024-05-17.</p>}
                </div>
                {txt('bpm', 'BPM', { numeric: true })}
                {txt('composer', 'Komposer')}
                {txt('grouping', 'Grup / seri')}
                {txt('publisher', 'Label / penerbit')}
                {txt('isrc', 'ISRC', { max: 15, placeholder: 'mis. IDABC2400001' })}
                <div className="sm:col-span-2">{txt('copyright', 'Hak cipta', { placeholder: '© 2024 Nama Pemilik' })}</div>
              </div>

              <Field label="Komentar">
                <textarea value={tags.comment} rows={2} maxLength={2000} className={`${inputCls} resize-y`} onChange={(e) => set('comment', e.target.value)} />
              </Field>
              <Field label="Lirik" hint={`${tags.lyrics.length.toLocaleString('id-ID')} karakter. Satu baris per baris lirik; baris kosong memisahkan bait.`}>
                <textarea value={tags.lyrics} rows={8} maxLength={60000} className={`${inputCls} resize-y min-h-[8rem]`} onChange={(e) => set('lyrics', e.target.value)} />
              </Field>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={fillFromName} disabled={busy} className={btnGhost}>Isi kolom kosong dari nama berkas</button>
            <button type="button" onClick={() => { setTags(orig); setCoverNote(null); }} disabled={busy || !dirty} className={btnGhost}>
              <RotateCcw className="w-4 h-4" /><span>Kembalikan ke tag asli</span>
            </button>
            <button type="button" onClick={() => { setTags(emptyTags()); setCoverNote(null); }} disabled={busy} className={btnGhost}>
              <Eraser className="w-4 h-4" /><span>Kosongkan semua tag</span>
            </button>
          </div>

          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" checked={renameFromTags} onChange={(e) => setRenameFromTags(e.target.checked)} className="accent-accent" />
              Namai berkas hasil “Artis - Judul”
            </label>
            <p className="text-[10px] text-gray-500">Berkas hasil memakai nama yang sama dengan aslinya, jadi browser bisa menambahkan “(1)”. Mengunduh ulang berkas yang sama setelah mengubah tag tidak memakai jatah lagi.</p>
          </div>
        </div>
      )}
    </ToolFrame>
    </>
  );
};

// Panel Gabungan Extra Tools
export const ExtraToolPanel: React.FC<{
  active: ExtraToolId | null;
  gate?: AudioExtraToolsProps['gate'];
  onSuccessToast?: (msg: string) => void;
  studioActiveTrack?: { id: string; title: string; audioUrl?: string } | null;
  /** Dipanggil alat berbasis berkas yang aktif agar tombol "Unggah Berkas" di header bisa membuka pemilih berkasnya. */
  onPicker?: (h: ExtraPickerHandle | null) => void;
}> = ({ active, gate, onSuccessToast, studioActiveTrack, onPicker }) => {
  const [visited, setVisited] = useState<Set<ExtraToolId>>(new Set());
  useEffect(() => { if (active) setVisited((v) => (v.has(active) ? v : new Set(v).add(active))); }, [active]);
  const show = (id: ExtraToolId) => (active === id ? '' : 'hidden');
  const guard = (id: ExtraToolId) =>
    ['tuner', 'metronome'].includes(id)
      ? {}
      : quotaGuardProps(Boolean(gate?.locked(id)), () => gate?.blocked(id));
  const mounted = (id: ExtraToolId) => visited.has(id) || active === id;

  return (
    <div className={active ? '' : 'hidden'}>
      {mounted('merge') && <div className={show('merge')} {...guard('merge')}><MergeFadeTool gate={gate} toast={onSuccessToast} isActive={active === 'merge'} onPicker={onPicker} /></div>}
      {mounted('loop') && <div className={show('loop')} {...guard('loop')}><LoopTool gate={gate} toast={onSuccessToast} isActive={active === 'loop'} onPicker={onPicker} /></div>}
      {mounted('metadata') && <div className={show('metadata')} {...guard('metadata')}><MetadataTool gate={gate} toast={onSuccessToast} isActive={active === 'metadata'} onPicker={onPicker} /></div>}
      {mounted('clean') && <div className={show('clean')} {...guard('clean')}><CleanTool gate={gate} toast={onSuccessToast} isActive={active === 'clean'} onPicker={onPicker} /></div>}
      {mounted('recorder') && <div className={show('recorder')} {...guard('recorder')}><RecorderTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('bpm') && <div className={show('bpm')} {...guard('bpm')}><BpmKeyTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('metronome') && <div className={show('metronome')} {...guard('metronome')}><MetronomeTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('tuner') && <div className={show('tuner')} {...guard('tuner')}><TunerTool gate={gate} /></div>}
      {mounted('pitch_detect') && <div className={show('pitch_detect')} {...guard('pitch_detect')}><PitchDetectTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('vocal_range') && <div className={show('vocal_range')} {...guard('vocal_range')}><VocalRangeTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('pitch_match') && <div className={show('pitch_match')} {...guard('pitch_match')}><PitchMatchTool gate={gate} onSuccessToast={onSuccessToast} studioActiveTrack={studioActiveTrack} /></div>}
    </div>
  );
};
