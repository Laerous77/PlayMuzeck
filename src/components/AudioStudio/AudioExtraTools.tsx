// src/components/AudioStudio/AudioExtraTools.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Merge, Activity, Mic, Eraser, Timer, AudioLines, Upload, Download, Play, Square,
  Loader2, Trash2, ArrowUp, ArrowDown, Copy, X, AlertTriangle, CheckCircle, RotateCcw, Music2, Ruler,
  Target, Sparkles
} from 'lucide-react';
import {
  audioBufferToWav, downloadBlob, exportAudioFile,
} from '../../services/exporters';
import {
  BTN_DOWNLOAD, BTN_GHOST, BTN_PRIMARY, CARD_CLS, FORMAT_INFO, INPUT_CLS, InfoTip, NUM_FIELD_CLS, PANEL_CLS, SLIDER_CLS, pillCls, quotaGuardProps,
} from './toolsShared';
import { PitchDetectTool, VocalRangeTool } from './VoiceTools';
import { PitchMatchTool } from './PitchMatchTool';
import {
  CLICK_GAIN, CLICK_SOUNDS, DENOMINATORS, MAX_NUMERATOR, TEMPO_REFS, TUNING_PRESETS, accentsFromGroups, applyFade,
  barSeconds, clickSample, concatChannels, defaultGrouping, detectBpm, detectKey, detectPitch, freqToNote,
  getClickSound, groupingsFor, lowestFreq, makeTimeSignature, measureLufs, midiToFreq, nearestString,
  normalizeLoudness, peaksForDisplay, pulseSeconds, removeSilence, renderMetronome, sliceChannels, subdivisionsFor,
  tempoMarking, toMono,
  type Accent, type Channels, type ClickKind, type FadeCurve, type TempoRef, type TuningPreset,
} from '../../services/audioExtraDsp';

export type ExtraToolId = 'merge' | 'clean' | 'recorder' | 'bpm' | 'metronome' | 'tuner' | 'pitch_detect' | 'vocal_range' | 'pitch_match';

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

export const EXTRA_SLUG_TO_TOOL: Record<string, ExtraToolId> = {
  'gabung-audio': 'merge',
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

async function decodeFile(file: File): Promise<AudioBuffer> {
  const ctx = new AudioCtx();
  try {
    const data = await file.arrayBuffer();
    return await new Promise<AudioBuffer>((resolve, reject) => {
      ctx.decodeAudioData(
        data.slice(0),
        (buf) => resolve(buf),
        (err) => reject(err)
      ).catch?.(reject);
    });
  } catch {
    throw new Error('Berkas tidak bisa dibaca. Coba format lain (MP3, WAV, M4A, OGG, atau FLAC).');
  } finally {
    try { void ctx.close(); } catch {}
  }
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
  onBeforePick?: () => boolean;
}> = ({ label, multiple, disabled, onFiles, onBeforePick }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref} type="file" accept="audio/*,video/*" multiple={multiple} className="hidden"
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
const ExportPanel: React.FC<{
  buffer: AudioBuffer | null; fileName: string; toolId: ExtraToolId;
  gate?: AudioExtraToolsProps['gate']; onDone?: (m: string) => void; sessionKey?: string;
}> = ({ buffer, fileName, toolId, gate, onDone, sessionKey }) => {
  const [fmt, setFmt] = useState<'MP3' | 'WAV' | 'FLAC' | 'M4A'>('MP3');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const resultKey = useMemo(() => `r${++exportSeq}`, [buffer]);
  if (!buffer) return null;
  const run = async () => {
    if (busy) return;
    const key = sessionKey ?? resultKey;
    const wasPaid = gate?.has(toolId, key) ?? false;
    setBusy(true); setErr(null); setNote(null); setPct(0);
    if (gate && !(await gate.use(toolId, key))) { setBusy(false); return; }
    try {
      const r = await exportAudioFile(buffer, fileName, fmt, { mp3Kbps: 192, onProgress: setPct });
      if (r.note) setNote(r.note);
      onDone?.(`Berkas ${r.actualFormat} berhasil diunduh.`);
    } catch (e) {
      if (!wasPaid) gate?.refund(toolId, key);
      setErr(e instanceof Error ? e.message : 'Gagal mengekspor berkas.');
    } finally { setBusy(false); }
  };
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

// 1. Gabung & Fade
interface MergeItem { id: number; name: string; buffer: AudioBuffer; }
let mergeIdSeq = 1;

const MergeFadeTool: React.FC<{ gate?: AudioExtraToolsProps['gate']; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [crossfade, setCrossfade] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [curve, setCurve] = useState<FadeCurve>('natural');
  const [result, setResult] = useState<AudioBuffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addFiles = async (files: File[]) => {
    setErr(null); setBusy(true);
    try {
      const added: MergeItem[] = [];
      for (const f of files) added.push({ id: mergeIdSeq++, name: f.name, buffer: await decodeFile(f) });
      setItems((prev) => [...prev, ...added]);
      setResult(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca berkas.'); }
    finally { setBusy(false); }
  };
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
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal memproses audio.'); }
    finally { setBusy(false); }
  };
  const total = items.reduce((s, x) => s + x.buffer.duration, 0);

  return (
    <Panel title="Gabung & Fade" info={['Tambahkan satu atau lebih berkas, atur urutannya, lalu gabungkan.', 'Crossfade menumpang-tindihkan sambungan antar lagu.']}>
      <FilePicker label="Tambah berkas audio" multiple onFiles={addFiles} disabled={busy} />
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
          <li className="text-[11px] text-gray-500">Total sebelum efek: {fmtTime(total)}</li>
        </ul>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label={`Crossfade: ${crossfade.toFixed(1)} dtk`} hint="Tumpang-tindih antar lagu">
          <input type="range" min={0} max={5} step={0.1} value={crossfade} onChange={(e) => setCrossfade(+e.target.value)} className={sliderCls} disabled={items.length < 2} />
        </Field>
        <Field label={`Fade in: ${fadeIn.toFixed(1)} dtk`}>
          <input type="range" min={0} max={10} step={0.1} value={fadeIn} onChange={(e) => setFadeIn(+e.target.value)} className={sliderCls} />
        </Field>
        <Field label={`Fade out: ${fadeOut.toFixed(1)} dtk`}>
          <input type="range" min={0} max={10} step={0.1} value={fadeOut} onChange={(e) => setFadeOut(+e.target.value)} className={sliderCls} />
        </Field>
        <Field label="Kurva fade">
          <select value={curve} onChange={(e) => setCurve(e.target.value as FadeCurve)} className={inputCls}>
            <option value="natural">Natural (disarankan)</option>
            <option value="linear">Linear</option>
            <option value="scurve">Halus (S-curve)</option>
          </select>
        </Field>
      </div>
      <button type="button" onClick={process} disabled={busy || items.length === 0} className={btnPrimary}>
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Merge className="w-4 h-4" />}
        <span>{busy ? 'Memproses…' : items.length > 1 ? 'Gabungkan' : 'Terapkan fade'}</span>
      </button>
      <ErrorNote msg={err} />
      {result && (
        <div className="space-y-3">
          <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />Selesai, durasi {fmtTime(result.duration)}.</p>
          <Preview buffer={result} />
          <ExportPanel buffer={result} fileName="PlayMuzeck_Gabungan" toolId="merge" gate={gate} onDone={toast} />
        </div>
      )}
    </Panel>
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
      const buf = await decodeFile(file);
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
    <Panel title="BPM & Kunci" info={['Pilih lagu, dan hasilnya langsung dianalisis.', 'Mendeteksi tempo lagu serta kunci nada mayor/minor.']}>
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
      timerRef.current = window.setInterval(() => setElapsed((performance.now() - t0) / 1000), 200);
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
    <Panel title="Perekam" info={['Rekam dari mikrofon, potong bagian awal/akhir, lalu unduh.']}>
      <div className="flex flex-wrap items-center gap-3">
        {state !== 'recording' ? (
          <button type="button" onClick={begin} className={btnPrimary}><Mic className="w-4 h-4" /><span>{state === 'ready' ? 'Rekam ulang' : 'Mulai merekam'}</span></button>
        ) : (
          <button type="button" onClick={stop} className="px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-sm inline-flex items-center gap-2 cursor-pointer"><Square className="w-4 h-4" /><span>Berhenti</span></button>
        )}
        {state === 'recording' && <span className="flex items-center gap-2 text-sm text-red-300 tabular-nums"><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />{fmtTime(elapsed)}</span>}
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

const CleanTool: React.FC<{ gate?: AudioExtraToolsProps['gate']; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [doSilence, setDoSilence] = useState(true);
  const [thr, setThr] = useState(-45);
  const [minSil, setMinSil] = useState(400);
  const [keep, setKeep] = useState(150);
  const [doNorm, setDoNorm] = useState(true);
  const [target, setTarget] = useState(-16);
  const [doMono, setDoMono] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [out, setOut] = useState<{ buffer: AudioBuffer; lines: string[] } | null>(null);

  const onFiles = async ([f]: File[]) => {
    setBusy(true); setErr(null); setOut(null);
    try { setBuffer(await decodeFile(f)); setFileName(f.name); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca berkas.'); }
    finally { setBusy(false); }
  };

  const run = async () => {
    if (!buffer) return;
    if (!doSilence && !doNorm && !doMono) { setErr('Aktifkan minimal satu proses.'); return; }
    setBusy(true); setErr(null); await tick();
    try {
      const sr = buffer.sampleRate;
      const lines: string[] = [];
      let ch: Channels = viewChannels(buffer);
      const before = measureLufs(ch, sr);
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
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal memproses audio.'); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Rapikan Audio" info={['Hapus jeda hening, samakan loudness (LUFS), atau ubah stereo ke mono.']}>
      <FilePicker label={busy ? 'Memproses…' : buffer ? `Ganti berkas (${fileName})` : 'Pilih berkas audio'} onFiles={onFiles} disabled={busy} />
      {buffer && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doSilence} onChange={(e) => setDoSilence(e.target.checked)} />Hapus jeda hening</label>
              <Field label={`Threshold: ${thr} dB`}><input type="range" min={-70} max={-20} value={thr} onChange={(e) => setThr(+e.target.value)} className={sliderCls} disabled={!doSilence} /></Field>
              <Field label={`Jeda minimal: ${minSil} ms`}><input type="range" min={150} max={3000} step={50} value={minSil} onChange={(e) => setMinSil(+e.target.value)} className={sliderCls} disabled={!doSilence} /></Field>
              <Field label={`Sisakan jeda: ${keep} ms`}><input type="range" min={0} max={600} step={10} value={keep} onChange={(e) => setKeep(+e.target.value)} className={sliderCls} disabled={!doSilence} /></Field>
            </div>
            <div className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doNorm} onChange={(e) => setDoNorm(e.target.checked)} />Normalisasi volume (LUFS)</label>
              <div className="flex flex-col gap-1.5">
                {LOUDNESS_PRESETS.map((p) => (
                  <button key={p.id} type="button" disabled={!doNorm} onClick={() => setTarget(p.lufs)}
                    className={`text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${target === p.lufs ? 'border-accent bg-accent/15 text-white' : 'border-white/[0.1] text-gray-300'}`}>{p.label}</button>
                ))}
              </div>
              <Field label="Target (LUFS)"><input type="number" min={-40} max={-6} step={0.5} value={target} onChange={(e) => setTarget(Math.max(-40, Math.min(-6, +e.target.value || -16)))} className={inputCls} disabled={!doNorm} /></Field>
            </div>
            <div className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doMono} onChange={(e) => setDoMono(e.target.checked)} />Stereo ke mono</label>
              <p className="text-[11px] text-gray-400">Gabungkan kanal kiri dan kanan jadi mono untuk ukuran berkas lebih kecil.</p>
            </div>
          </div>
          <button type="button" onClick={run} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}<span>{busy ? 'Memproses…' : 'Proses audio'}</span></button>
        </div>
      )}
      <ErrorNote msg={err} />
      {out && (
        <div className="space-y-3">
          <ul className="text-xs text-emerald-300 space-y-1">{out.lines.map((l) => <li key={l} className="flex gap-1.5"><CheckCircle className="w-4 h-4 shrink-0" />{l}</li>)}</ul>
          <Preview buffer={out.buffer} />
          <ExportPanel buffer={out.buffer} fileName={`PlayMuzeck_Bersih_${baseName(fileName)}`} toolId="clean" gate={gate} onDone={toast} />
        </div>
      )}
    </Panel>
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

// Panel Gabungan Extra Tools
export const ExtraToolPanel: React.FC<{
  active: ExtraToolId | null;
  gate?: AudioExtraToolsProps['gate'];
  onSuccessToast?: (msg: string) => void;
  studioActiveTrack?: { id: string; title: string; audioUrl?: string } | null;
}> = ({ active, gate, onSuccessToast, studioActiveTrack }) => {
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
      {mounted('merge') && <div className={show('merge')} {...guard('merge')}><MergeFadeTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('clean') && <div className={show('clean')} {...guard('clean')}><CleanTool gate={gate} toast={onSuccessToast} /></div>}
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
