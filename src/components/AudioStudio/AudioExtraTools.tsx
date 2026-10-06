// src/components/AudioStudio/AudioExtraTools.tsx
//
// 7 alat audio tambahan PlayMuzeck (semua diproses di browser, tanpa unggah ke server):
//  1. Gabung Audio + Fade in/out      5. Hapus Hening + Normalisasi + Stereo ke Mono
//  2. Deteksi BPM & Kunci Nada        6. Metronom (+ ekspor klik ke berkas)
//  3. Perekam Suara + Trim            7. Tuner (gitar, bass, ukulele, biola, vokal)
//  4. Pembuat Nada Dering
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Merge, Activity, Mic, BellRing, Eraser, Timer, AudioLines, Upload, Download, Play, Square,
  Loader2, Trash2, ArrowUp, ArrowDown, Copy, X, AlertTriangle, CheckCircle,
} from 'lucide-react';
import {
  audioBufferToWav, downloadBlob, encodeCompressedAudio, exportAudioFile,
} from '../../services/exporters';
import {
  TUNING_PRESETS, applyFade, concatChannels, detectBpm, detectKey, detectPitch, freqToNote,
  measureLufs, midiToFreq, nearestString, normalizeLoudness, peaksForDisplay, removeSilence,
  renderMetronome, sliceChannels, toMono, type Channels, type FadeCurve, type TuningPreset,
} from '../../services/audioExtraDsp';

// ───────────────────────── Tipe & konstanta ─────────────────────────

export type ExtraToolId = 'merge' | 'bpm' | 'recorder' | 'ringtone' | 'clean' | 'metronome' | 'tuner';

export interface AudioExtraToolsProps {
  /** Tool yang dibuka pertama kali (mis. dari URL /alat-audio/<slug>). */
  initialTool?: ExtraToolId;
  /** Dipanggil sebelum mengunduh hasil. Kembalikan false untuk memblokir (mis. kuota harian habis / buka modal beli). */
  gate?: (toolId: ExtraToolId) => boolean;
  onSuccessToast?: (msg: string) => void;
}

/** Slug URL (untuk halaman SEO) -> tab yang dibuka. */
export const EXTRA_SLUG_TO_TOOL: Record<string, ExtraToolId> = {
  'gabung-audio': 'merge',
  'fade-audio': 'merge',
  'deteksi-bpm': 'bpm',
  'deteksi-kunci-nada': 'bpm',
  'rekam-suara': 'recorder',
  'buat-nada-dering': 'ringtone',
  'hapus-hening-audio': 'clean',
  'normalisasi-volume-audio': 'clean',
  'stereo-ke-mono': 'clean',
  'metronom-online': 'metronome',
  'tuner-online': 'tuner',
};

const TABS: { id: ExtraToolId; label: string; icon: React.ElementType; desc: string; realtime?: boolean }[] = [
  { id: 'merge', label: 'Gabung & Fade', icon: Merge, desc: 'Gabungkan beberapa audio, crossfade, fade in/out.' },
  { id: 'bpm', label: 'BPM & Kunci', icon: Activity, desc: 'Deteksi tempo (BPM) dan kunci nada lagu.' },
  { id: 'recorder', label: 'Perekam', icon: Mic, desc: 'Rekam suara dari mikrofon lalu potong.', realtime: true },
  { id: 'ringtone', label: 'Nada Dering', icon: BellRing, desc: 'Potong bagian favorit jadi nada dering.' },
  { id: 'clean', label: 'Bersihkan', icon: Eraser, desc: 'Hapus hening, normalisasi volume, stereo ke mono.' },
  { id: 'metronome', label: 'Metronom', icon: Timer, desc: 'Metronom + unduh klik sebagai berkas.', realtime: true },
  { id: 'tuner', label: 'Tuner', icon: AudioLines, desc: 'Setel gitar, bass, ukulele, biola, dan vokal.', realtime: true },
];

// ───────────────────────── Helper umum ─────────────────────────

const AudioCtx: typeof AudioContext = (typeof window !== 'undefined' &&
  (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)) as typeof AudioContext;

async function decodeFile(file: File): Promise<AudioBuffer> {
  const ctx = new AudioCtx();
  try {
    const data = await file.arrayBuffer();
    return await ctx.decodeAudioData(data);
  } catch {
    throw new Error('Berkas tidak bisa dibaca. Coba format lain (MP3, WAV, M4A, OGG, atau video MP4).');
  } finally {
    void ctx.close();
  }
}

/** Tampilan baca-saja atas kanal AudioBuffer (tanpa menyalin memori). */
function viewChannels(b: AudioBuffer): Channels {
  return Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
}

function toBuffer(ch: Channels, sampleRate: number): AudioBuffer {
  const len = Math.max(1, ch[0]?.length ?? 0);
  const buf = new AudioBuffer({ length: len, numberOfChannels: Math.max(1, ch.length), sampleRate });
  ch.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
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
const tick = () => new Promise<void>((r) => setTimeout(r, 30)); // beri UI kesempatan menampilkan "Memproses…"

// ───────────────────────── Komponen kecil bersama ─────────────────────────

const Panel: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="rounded-2xl bg-surface/30 border border-white/[0.08] p-4 sm:p-5 space-y-4">
    <h3 className="text-sm font-black text-white">{title}</h3>
    {children}
  </div>
);

const btnPrimary =
  'px-4 py-2.5 rounded-xl bg-accent hover:bg-accent/80 text-on-accent font-black text-xs sm:text-sm inline-flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed';
const btnGhost =
  'px-3 py-2 rounded-xl bg-black/40 hover:bg-black/60 border border-white/[0.12] text-xs font-bold text-white inline-flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50';
const inputCls =
  'w-full rounded-lg bg-black/50 border border-white/[0.12] px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-accent/60';

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block space-y-1">
    <span className="text-[11px] font-bold text-gray-300">{label}</span>
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
}> = ({ label, multiple, disabled, onFiles }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref} type="file" accept="audio/*,video/*" multiple={multiple} className="hidden"
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; if (f.length) onFiles(f); }}
      />
      <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className={btnGhost}>
        <Upload className="w-4 h-4 text-accent" />
        <span>{label}</span>
      </button>
    </>
  );
};

const Waveform: React.FC<{ peaks: Float32Array; from?: number; to?: number }> = ({ peaks, from = 0, to = 1 }) => (
  <div className="flex items-end gap-px h-20 rounded-xl bg-black/40 border border-white/[0.06] p-2" aria-hidden>
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

const ExportPanel: React.FC<{
  buffer: AudioBuffer | null; fileName: string; toolId: ExtraToolId;
  gate?: AudioExtraToolsProps['gate']; onDone?: (m: string) => void;
}> = ({ buffer, fileName, toolId, gate, onDone }) => {
  const [fmt, setFmt] = useState<'MP3' | 'WAV' | 'FLAC' | 'M4A'>('MP3');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!buffer) return null;
  const run = async () => {
    if (gate && !gate(toolId)) return;
    setBusy(true); setErr(null); setNote(null); setPct(0);
    try {
      const r = await exportAudioFile(buffer, fileName, fmt, { mp3Kbps: 192, onProgress: setPct });
      if (r.note) setNote(r.note);
      onDone?.(`Berkas ${r.actualFormat} berhasil diunduh.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Gagal mengekspor berkas.');
    } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3 rounded-xl border border-accent/30 bg-accent/5 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Format hasil">
          <select value={fmt} onChange={(e) => setFmt(e.target.value as typeof fmt)} className={inputCls}>
            <option value="MP3">MP3 (192 kbps)</option>
            <option value="WAV">WAV (kualitas penuh)</option>
            <option value="FLAC">FLAC (lossless)</option>
            <option value="M4A">M4A / AAC</option>
          </select>
        </Field>
        <button type="button" onClick={run} disabled={busy} className={btnPrimary}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          <span>{busy ? `Mengekspor ${Math.round(pct)}%` : 'Unduh hasil'}</span>
        </button>
      </div>
      {note && <p className="text-[11px] text-amber-300">{note}</p>}
      <ErrorNote msg={err} />
    </div>
  );
};

// ───────────────────────── 1. Gabung & Fade ─────────────────────────

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
    <Panel title="Gabung Audio + Fade In/Out">
      <p className="text-xs text-gray-400">Tambahkan satu atau lebih berkas, atur urutannya, lalu gabungkan. Dengan satu berkas, alat ini jadi pengatur fade in/out saja.</p>
      <FilePicker label="Tambah berkas audio" multiple onFiles={addFiles} disabled={busy} />
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li key={it.id} className="flex items-center gap-2 rounded-xl bg-black/40 border border-white/[0.06] px-3 py-2 text-xs">
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
          <input type="range" min={0} max={5} step={0.1} value={crossfade} onChange={(e) => setCrossfade(+e.target.value)} className="w-full accent-[var(--t-accent)]" disabled={items.length < 2} />
        </Field>
        <Field label={`Fade in: ${fadeIn.toFixed(1)} dtk`}>
          <input type="range" min={0} max={10} step={0.1} value={fadeIn} onChange={(e) => setFadeIn(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
        </Field>
        <Field label={`Fade out: ${fadeOut.toFixed(1)} dtk`}>
          <input type="range" min={0} max={10} step={0.1} value={fadeOut} onChange={(e) => setFadeOut(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
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
          <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />Selesai, durasi {fmtTime(result.duration)}. Dengarkan dulu sebelum mengunduh.</p>
          <Preview buffer={result} />
          <ExportPanel buffer={result} fileName="PlayMuzeck_Gabungan" toolId="merge" gate={gate} onDone={toast} />
        </div>
      )}
    </Panel>
  );
};

// ───────────────────────── 2. BPM & Kunci ─────────────────────────

const BpmKeyTool: React.FC<{ toast?: (m: string) => void }> = ({ toast }) => {
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ bpm: ReturnType<typeof detectBpm>; key: ReturnType<typeof detectKey>; seconds: number } | null>(null);

  const onFiles = async ([file]: File[]) => {
    setBusy(true); setErr(null); setRes(null); setFileName(file.name);
    try {
      const buf = await decodeFile(file);
      await tick();
      const ch = viewChannels(buf);
      const bpm = detectBpm(ch, buf.sampleRate);
      const key = detectKey(ch, buf.sampleRate);
      if (!bpm && !key) setErr('Tidak ada pola yang bisa dianalisis. Pastikan berkas cukup panjang (minimal ±5 detik) dan tidak senyap.');
      else setRes({ bpm, key, seconds: buf.duration });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal menganalisis.'); }
    finally { setBusy(false); }
  };

  const report = useMemo(() => {
    if (!res) return '';
    const lines = ['PlayMuzeck - Hasil Analisis Audio', `Berkas: ${fileName}`, `Durasi: ${fmtTime(res.seconds)}`, ''];
    if (res.bpm) lines.push(`BPM: ${res.bpm.bpm}` + (res.bpm.alternatives.length ? ` (kemungkinan lain: ${res.bpm.alternatives.join(' / ')})` : ''), `Keyakinan BPM: ${Math.round(res.bpm.confidence * 100)}%`);
    if (res.key) lines.push(`Kunci nada: ${res.key.name}`, `Kode Camelot (untuk mixing DJ): ${res.key.camelot}`, `Kunci relatif: ${res.key.relative}`, `Keyakinan kunci: ${Math.round(res.key.confidence * 100)}%`);
    lines.push('', 'Catatan: hasil berupa perkiraan otomatis. Lagu dengan tempo berubah-ubah atau modulasi bisa kurang akurat.');
    return lines.join('\n');
  }, [res, fileName]);

  return (
    <Panel title="Deteksi BPM & Kunci Nada">
      <p className="text-xs text-gray-400">Pilih lagu, dan hasilnya langsung dianalisis di browser kamu. Berkas tidak diunggah.</p>
      <FilePicker label={busy ? 'Menganalisis…' : 'Pilih lagu untuk dianalisis'} onFiles={onFiles} disabled={busy} />
      <ErrorNote msg={err} />
      {res && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="rounded-xl bg-black/40 border border-white/[0.08] p-4">
              <div className="text-[11px] font-bold text-gray-400">TEMPO</div>
              <div className="text-3xl font-black text-white tabular-nums">{res.bpm ? res.bpm.bpm : '—'} <span className="text-sm text-gray-400">BPM</span></div>
              {res.bpm && res.bpm.alternatives.length > 0 && <div className="text-[11px] text-gray-400 mt-1">Bisa juga terasa seperti {res.bpm.alternatives.join(' atau ')} BPM (setengah/dua kali).</div>}
              {res.bpm && <div className="text-[11px] text-gray-500 mt-1">Keyakinan {Math.round(res.bpm.confidence * 100)}%</div>}
            </div>
            <div className="rounded-xl bg-black/40 border border-white/[0.08] p-4">
              <div className="text-[11px] font-bold text-gray-400">KUNCI NADA</div>
              <div className="text-3xl font-black text-white">{res.key ? res.key.name : '—'}</div>
              {res.key && <div className="text-[11px] text-gray-400 mt-1">Camelot {res.key.camelot} · relatif {res.key.relative}</div>}
              {res.key && <div className="text-[11px] text-gray-500 mt-1">Keyakinan {Math.round(res.key.confidence * 100)}%</div>}
            </div>
          </div>
          {res.key && (
            <div className="flex items-end gap-1 h-14" aria-label="Profil nada">
              {res.key.chroma.map((v, i) => {
                const max = Math.max(...res.key!.chroma);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full rounded-sm bg-accent/70" style={{ height: `${Math.max(4, (v / max) * 100)}%` }} />
                    <span className="text-[9px] text-gray-500">{['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'][i]}</span>
                  </div>
                );
              })}
            </div>
          )}
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

// ───────────────────────── 3. Perekam Suara + Trim ─────────────────────────

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
  useEffect(() => () => { try { recRef.current?.state === 'recording' && recRef.current.stop(); } catch { /* abaikan */ } cleanup(); }, [cleanup]);

  const begin = async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErr('Browser ini belum mendukung perekaman suara. Coba Chrome, Edge, Firefox, atau Safari terbaru.'); return;
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
      const name = (e as DOMException)?.name;
      setErr(name === 'NotAllowedError' ? 'Izin mikrofon ditolak. Izinkan akses mikrofon di pengaturan browser lalu coba lagi.'
        : name === 'NotFoundError' ? 'Mikrofon tidak ditemukan.' : 'Gagal mengakses mikrofon.');
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
    <Panel title="Perekam Suara + Trim">
      <p className="text-xs text-gray-400">Rekam dari mikrofon, potong bagian awal/akhir, lalu unduh. Rekaman tidak meninggalkan perangkatmu.</p>
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
              <input type="range" min={0} max={dur} step={0.01} value={start} onChange={(e) => setStart(Math.min(+e.target.value, end - 0.1))} className="w-full accent-[var(--t-accent)]" />
            </Field>
            <Field label={`Selesai: ${fmtTime(end)}`}>
              <input type="range" min={0} max={dur} step={0.01} value={end} onChange={(e) => setEnd(Math.max(+e.target.value, start + 0.1))} className="w-full accent-[var(--t-accent)]" />
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

// ───────────────────────── 4. Pembuat Nada Dering ─────────────────────────

const MAX_RING = 30;

const RingtoneTool: React.FC<{ gate?: AudioExtraToolsProps['gate']; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [fileName, setFileName] = useState('');
  const [buffer, setBuffer] = useState<AudioBuffer | null>(null);
  const [start, setStart] = useState(0);
  const [len, setLen] = useState(20);
  const [fadeIn, setFadeIn] = useState(0.5);
  const [fadeOut, setFadeOut] = useState(1.5);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onFiles = async ([f]: File[]) => {
    setBusy(true); setErr(null); setInfo(null);
    try {
      const b = await decodeFile(f);
      setBuffer(b); setFileName(f.name); setStart(0); setLen(Math.min(20, Math.floor(b.duration)));
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal membaca berkas.'); }
    finally { setBusy(false); }
  };
  const dur = buffer?.duration ?? 0;
  const maxLen = Math.max(1, Math.min(MAX_RING, Math.floor(dur)));
  const effLen = Math.min(len, maxLen);
  const effStart = Math.min(start, Math.max(0, dur - effLen));

  const ringBuffer = useMemo(() => {
    if (!buffer) return null;
    const sr = buffer.sampleRate;
    let ch = sliceChannels(viewChannels(buffer), sr, effStart, effStart + effLen);
    ch = applyFade(ch, sr, Math.min(fadeIn, effLen / 2), Math.min(fadeOut, effLen / 2), 'natural');
    return ch[0].length ? toBuffer(ch, sr) : null;
  }, [buffer, effStart, effLen, fadeIn, fadeOut]);
  const peaks = useMemo(() => (buffer ? peaksForDisplay(viewChannels(buffer), 120) : new Float32Array(0)), [buffer]);
  const name = `PlayMuzeck_NadaDering_${baseName(fileName)}`;

  const downloadM4r = async () => {
    if (!ringBuffer) return;
    if (gate && !gate('ringtone')) return;
    setBusy(true); setErr(null); setInfo(null);
    try {
      const r = await encodeCompressedAudio(ringBuffer, 192);
      if (r.extension === 'm4a') {
        downloadBlob(r.blob, `${name}.m4r`);
        setInfo('File .m4r diunduh. Impor ke iPhone lewat Finder/iTunes (kabel) atau GarageBand.');
        toast?.('Nada dering .m4r diunduh.');
      } else {
        setErr(`Browser ini menghasilkan .${r.extension}, bukan AAC (.m4a), jadi tidak bisa dijadikan .m4r. Gunakan MP3 untuk Android, atau buka situs ini di Safari untuk membuat .m4r.`);
      }
    } catch { setErr('Gagal membuat berkas .m4r di browser ini.'); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Pembuat Nada Dering">
      <p className="text-xs text-gray-400">Pilih lagu milikmu, tentukan bagian terbaik (maksimal {MAX_RING} detik), lalu unduh sebagai nada dering. Pastikan kamu berhak memakai lagu tersebut.</p>
      <FilePicker label={busy ? 'Membaca…' : buffer ? 'Ganti lagu' : 'Pilih lagu'} onFiles={onFiles} disabled={busy} />
      <ErrorNote msg={err} />
      {buffer && (
        <div className="space-y-3">
          <Waveform peaks={peaks} from={effStart / dur} to={(effStart + effLen) / dur} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label={`Mulai: ${fmtTime(effStart)}`}>
              <input type="range" min={0} max={Math.max(0, dur - effLen)} step={0.1} value={effStart} onChange={(e) => setStart(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
            </Field>
            <Field label={`Panjang: ${effLen.toFixed(0)} dtk`}>
              <input type="range" min={Math.min(3, maxLen)} max={maxLen} step={1} value={effLen} onChange={(e) => setLen(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
            </Field>
            <Field label={`Fade in: ${fadeIn.toFixed(1)} dtk`}>
              <input type="range" min={0} max={3} step={0.1} value={fadeIn} onChange={(e) => setFadeIn(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
            </Field>
            <Field label={`Fade out: ${fadeOut.toFixed(1)} dtk`}>
              <input type="range" min={0} max={3} step={0.1} value={fadeOut} onChange={(e) => setFadeOut(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
            </Field>
          </div>
          <Preview buffer={ringBuffer} />
          <div className="space-y-2 rounded-xl border border-accent/30 bg-accent/5 p-3">
            <p className="text-[11px] text-gray-300"><strong className="text-white">Android:</strong> unduh MP3 lalu pilih sebagai nada dering di Pengaturan. <strong className="text-white">iPhone:</strong> butuh format .m4r.</p>
            <ExportPanel buffer={ringBuffer} fileName={name} toolId="ringtone" gate={gate} onDone={toast} />
            <button type="button" onClick={downloadM4r} disabled={busy || !ringBuffer} className={btnGhost}><Download className="w-4 h-4" /><span>Unduh .m4r (iPhone)</span></button>
            {info && <p className="text-[11px] text-emerald-300">{info}</p>}
          </div>
        </div>
      )}
    </Panel>
  );
};

// ───────────────────────── 5. Bersihkan: hening, normalisasi, mono ─────────────────────────

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
        lines.push(r.removedCount ? `Hening dihapus: ${r.removedCount} bagian, total ${r.removedSeconds.toFixed(1)} detik.` : 'Tidak ada jeda hening yang cukup panjang untuk dihapus.');
      }
      if (doNorm) {
        const r = normalizeLoudness(ch, sr, target, -1);
        if (r.beforeLufs === null) lines.push('Normalisasi dilewati: audio terlalu senyap atau terlalu pendek (minimal 0,4 detik).');
        else {
          ch = r.channels;
          lines.push(`Loudness: ${r.beforeLufs.toFixed(1)} → ${r.afterLufs?.toFixed(1)} LUFS (target ${target}).`);
          if (r.limited) lines.push('Limiter dipakai agar puncak tidak melewati -1 dBFS.');
        }
      }
      if (before !== null && !doNorm) lines.push(`Loudness saat ini: ${before.toFixed(1)} LUFS.`);
      setOut({ buffer: toBuffer(ch, sr), lines });
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal memproses audio.'); }
    finally { setBusy(false); }
  };

  return (
    <Panel title="Hapus Hening · Normalisasi Volume · Stereo ke Mono">
      <p className="text-xs text-gray-400">Cocok untuk podcast, voice-over, dan video YouTube. Proses berjalan berurutan: mono → hapus hening → normalisasi.</p>
      <FilePicker label={busy ? 'Memproses…' : buffer ? `Ganti berkas (${fileName})` : 'Pilih berkas audio'} onFiles={onFiles} disabled={busy} />
      {buffer && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="rounded-xl bg-black/40 border border-white/[0.06] p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doSilence} onChange={(e) => setDoSilence(e.target.checked)} />Hapus jeda hening</label>
              <Field label={`Dianggap hening di bawah ${thr} dB`}><input type="range" min={-70} max={-20} value={thr} onChange={(e) => setThr(+e.target.value)} className="w-full accent-[var(--t-accent)]" disabled={!doSilence} /></Field>
              <Field label={`Jeda minimal dipotong: ${minSil} ms`}><input type="range" min={150} max={3000} step={50} value={minSil} onChange={(e) => setMinSil(+e.target.value)} className="w-full accent-[var(--t-accent)]" disabled={!doSilence} /></Field>
              <Field label={`Sisakan jeda: ${keep} ms`} hint="Agar ucapan tidak terdengar terpotong"><input type="range" min={0} max={600} step={10} value={keep} onChange={(e) => setKeep(+e.target.value)} className="w-full accent-[var(--t-accent)]" disabled={!doSilence} /></Field>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/[0.06] p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doNorm} onChange={(e) => setDoNorm(e.target.checked)} />Normalisasi volume (LUFS)</label>
              <div className="flex flex-col gap-1.5">
                {LOUDNESS_PRESETS.map((p) => (
                  <button key={p.id} type="button" disabled={!doNorm} onClick={() => setTarget(p.lufs)}
                    className={`text-left px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer ${target === p.lufs ? 'border-accent bg-accent/15 text-white' : 'border-white/[0.1] text-gray-300'}`}>{p.label}</button>
                ))}
              </div>
              <Field label="Target kustom (LUFS)"><input type="number" min={-40} max={-6} step={0.5} value={target} onChange={(e) => setTarget(Math.max(-40, Math.min(-6, +e.target.value || -16)))} className={inputCls} disabled={!doNorm} /></Field>
            </div>
            <div className="rounded-xl bg-black/40 border border-white/[0.06] p-3 space-y-2">
              <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer"><input type="checkbox" checked={doMono} onChange={(e) => setDoMono(e.target.checked)} />Stereo ke mono</label>
              <p className="text-[11px] text-gray-400">Menggabungkan kanal kiri-kanan jadi satu. Ukuran berkas lebih kecil dan cocok untuk suara bicara. Rekaman dengan fase berlawanan antar kanal bisa jadi pelan.</p>
            </div>
          </div>
          <button type="button" onClick={run} disabled={busy} className={btnPrimary}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eraser className="w-4 h-4" />}<span>{busy ? 'Memproses…' : 'Proses audio'}</span></button>
        </div>
      )}
      <ErrorNote msg={err} />
      {out && (
        <div className="space-y-3">
          <ul className="text-xs text-emerald-300 space-y-1">{out.lines.map((l) => <li key={l} className="flex gap-1.5"><CheckCircle className="w-4 h-4 shrink-0" />{l}</li>)}</ul>
          <p className="text-[11px] text-gray-400">Durasi: {fmtTime(buffer!.duration)} → {fmtTime(out.buffer.duration)}</p>
          <Preview buffer={out.buffer} />
          <ExportPanel buffer={out.buffer} fileName={`PlayMuzeck_Bersih_${baseName(fileName)}`} toolId="clean" gate={gate} onDone={toast} />
        </div>
      )}
    </Panel>
  );
};

// ───────────────────────── 6. Metronom ─────────────────────────

const MetronomeTool: React.FC<{ gate?: AudioExtraToolsProps['gate']; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [bpm, setBpm] = useState(100);
  const [beats, setBeats] = useState(4);
  const [sub, setSub] = useState(1);
  const [running, setRunning] = useState(false);
  const [beat, setBeat] = useState(-1);
  const [bars, setBars] = useState(16);
  const [clickBuf, setClickBuf] = useState<AudioBuffer | null>(null);
  const cfg = useRef({ bpm, beats, sub });
  cfg.current = { bpm, beats, sub };
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<number | null>(null);
  const nextRef = useRef(0);
  const tickRef = useRef(0);
  const tapsRef = useRef<number[]>([]);

  const stop = useCallback(() => {
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
    void ctxRef.current?.close(); ctxRef.current = null;
    setRunning(false); setBeat(-1);
  }, []);
  useEffect(() => stop, [stop]);

  const schedule = () => {
    const ctx = ctxRef.current; if (!ctx) return;
    while (nextRef.current < ctx.currentTime + 0.12) {
      const { bpm: b, beats: n, sub: s } = cfg.current;
      const k = tickRef.current;
      const isBeat = k % s === 0;
      const beatIdx = Math.floor(k / s) % n;
      const osc = ctx.createOscillator(); const g = ctx.createGain();
      osc.frequency.value = isBeat ? (beatIdx === 0 ? 1600 : 1000) : 700;
      const amp = isBeat ? 0.8 : 0.3; const t = nextRef.current;
      g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      osc.connect(g); g.connect(ctx.destination); osc.start(t); osc.stop(t + 0.06);
      if (isBeat) window.setTimeout(() => setBeat(beatIdx), Math.max(0, (t - ctx.currentTime) * 1000));
      nextRef.current += 60 / b / s; tickRef.current = k + 1;
    }
  };
  const start = () => {
    stop();
    const ctx = new AudioCtx(); void ctx.resume();
    ctxRef.current = ctx; nextRef.current = ctx.currentTime + 0.05; tickRef.current = 0;
    timerRef.current = window.setInterval(schedule, 25);
    setRunning(true);
  };
  const tap = () => {
    const now = performance.now();
    const taps = tapsRef.current.filter((t) => now - t < 2500); taps.push(now); tapsRef.current = taps;
    if (taps.length >= 2) {
      const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
      setBpm(Math.max(30, Math.min(300, Math.round(60000 / iv))));
    }
  };
  const maxBars = Math.max(1, Math.floor(300 / ((60 / bpm) * beats)));
  const makeFile = () => {
    const b = Math.min(bars, maxBars);
    const pcm = renderMetronome({ bpm, beatsPerBar: beats, bars: b, subdivision: sub, sampleRate: 44100 });
    setClickBuf(toBuffer([pcm], 44100));
  };

  return (
    <Panel title="Metronom">
      <div className="flex items-center justify-center gap-2 py-1" aria-live="off">
        {Array.from({ length: beats }, (_, i) => (
          <div key={i} className={`w-5 h-5 rounded-full border transition-all ${running && beat === i ? (i === 0 ? 'bg-accent2 border-accent2 scale-125' : 'bg-accent border-accent scale-125') : 'bg-black/40 border-white/20'}`} />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Field label={`Tempo: ${bpm} BPM`}>
          <input type="range" min={30} max={300} value={bpm} onChange={(e) => setBpm(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
        </Field>
        <Field label="Ketukan per bar">
          <select value={beats} onChange={(e) => setBeats(+e.target.value)} className={inputCls}>{[2, 3, 4, 5, 6, 7, 9, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select>
        </Field>
        <Field label="Subdivisi">
          <select value={sub} onChange={(e) => setSub(+e.target.value)} className={inputCls}>
            <option value={1}>Ketukan saja</option><option value={2}>1/8 (2 per ketuk)</option><option value={3}>Triplet</option><option value={4}>1/16 (4 per ketuk)</option>
          </select>
        </Field>
        <Field label="Atur BPM tepat">
          <input type="number" min={30} max={300} value={bpm} onChange={(e) => setBpm(Math.max(30, Math.min(300, Math.round(+e.target.value) || 100)))} className={inputCls} />
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {!running ? <button type="button" onClick={start} className={btnPrimary}><Play className="w-4 h-4" /><span>Mulai</span></button>
          : <button type="button" onClick={stop} className="px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-sm inline-flex items-center gap-2 cursor-pointer"><Square className="w-4 h-4" /><span>Berhenti</span></button>}
        <button type="button" onClick={tap} className={btnGhost}>Tap tempo</button>
      </div>
      <div className="rounded-xl border border-white/[0.08] bg-black/30 p-3 space-y-3">
        <p className="text-xs font-bold text-white">Unduh klik sebagai berkas</p>
        <div className="flex flex-wrap items-end gap-3">
          <Field label={`Jumlah bar (maks ${maxBars})`}>
            <input type="number" min={1} max={maxBars} value={Math.min(bars, maxBars)} onChange={(e) => setBars(Math.max(1, Math.min(maxBars, Math.round(+e.target.value) || 1)))} className={inputCls} />
          </Field>
          <button type="button" onClick={makeFile} className={btnGhost}>Buat berkas</button>
        </div>
        {clickBuf && (<><Preview buffer={clickBuf} /><ExportPanel buffer={clickBuf} fileName={`PlayMuzeck_Metronom_${bpm}BPM_${beats}-4`} toolId="metronome" gate={gate} onDone={toast} /></>)}
      </div>
    </Panel>
  );
};

// ───────────────────────── 7. Tuner ─────────────────────────

const TunerTool: React.FC = () => {
  const [preset, setPreset] = useState<TuningPreset>(TUNING_PRESETS[1]);
  const [a4, setA4] = useState(440);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reading, setReading] = useState<{ freq: number; clarity: number } | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const recent = useRef<number[]>([]);
  const lastGood = useRef(0);
  const a4Ref = useRef(a4); a4Ref.current = a4;

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null;
    void ctxRef.current?.close(); ctxRef.current = null;
    setRunning(false); setReading(null); recent.current = [];
  }, []);
  useEffect(() => stop, [stop]);

  const start = async () => {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErr('Browser ini belum mendukung akses mikrofon.'); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const ctx = new AudioCtx(); void ctx.resume();
      const analyser = ctx.createAnalyser(); analyser.fftSize = 8192; // cukup panjang untuk senar bass (E1 ≈ 41 Hz)
      ctx.createMediaStreamSource(stream).connect(analyser);
      streamRef.current = stream; ctxRef.current = ctx; setRunning(true);
      const buf = new Float32Array(analyser.fftSize);
      let last = 0;
      const loop = (now: number) => {
        rafRef.current = requestAnimationFrame(loop);
        if (now - last < 80) return; last = now;
        analyser.getFloatTimeDomainData(buf);
        const p = detectPitch(buf, ctx.sampleRate, 35, 1400);
        if (p && p.clarity > 0.85) {
          const r = recent.current; r.push(p.freq); if (r.length > 5) r.shift();
          const sorted = [...r].sort((x, y) => x - y); const med = sorted[Math.floor(sorted.length / 2)];
          lastGood.current = now; setReading({ freq: med, clarity: p.clarity });
        } else if (now - lastGood.current > 600) { recent.current = []; setReading(null); }
      };
      rafRef.current = requestAnimationFrame(loop);
    } catch (e) {
      stop();
      setErr((e as DOMException)?.name === 'NotAllowedError' ? 'Izin mikrofon ditolak. Izinkan akses mikrofon di pengaturan browser.' : 'Gagal mengakses mikrofon.');
    }
  };

  const playRef = (midi: number) => {
    const ctx = new AudioCtx(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = midiToFreq(midi, a4Ref.current);
    g.gain.setValueAtTime(0.0001, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.4, ctx.currentTime + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 2.1);
    window.setTimeout(() => void ctx.close(), 2400);
  };

  const note = reading ? freqToNote(reading.freq, a4) : null;
  const ns = reading ? nearestString(reading.freq, preset, a4) : null;
  const cents = ns ? ns.cents : note?.cents ?? 0;
  const clamped = Math.max(-50, Math.min(50, cents));
  const inTune = reading !== null && Math.abs(cents) <= 5;
  const status = !reading ? 'Mainkan satu nada…' : inTune ? 'Pas!' : cents < 0 ? 'Terlalu rendah, kencangkan' : 'Terlalu tinggi, kendurkan';

  return (
    <Panel title="Tuner">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Mode">
          <select value={preset.id} onChange={(e) => setPreset(TUNING_PRESETS.find((p) => p.id === e.target.value)!)} className={inputCls}>
            {TUNING_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
        <Field label={`Acuan A4: ${a4} Hz`}>
          <input type="range" min={430} max={450} value={a4} onChange={(e) => setA4(+e.target.value)} className="w-full accent-[var(--t-accent)]" />
        </Field>
      </div>
      {!running ? <button type="button" onClick={start} className={btnPrimary}><Mic className="w-4 h-4" /><span>Mulai tuner</span></button>
        : <button type="button" onClick={stop} className="px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-sm inline-flex items-center gap-2 cursor-pointer w-fit"><X className="w-4 h-4" /><span>Hentikan</span></button>}
      <ErrorNote msg={err} />
      <div className="rounded-2xl bg-black/50 border border-white/[0.08] p-5 text-center space-y-3">
        <div className={`text-6xl font-black tabular-nums ${inTune ? 'text-emerald-400' : 'text-white'}`}>
          {note ? <>{ns && preset.strings.length ? ns.string.label.replace(/\d+$/, '') : note.name}<span className="text-2xl text-gray-400">{ns && preset.strings.length ? ns.string.label.match(/\d+$/)?.[0] : note.octave}</span></> : '—'}
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
          {preset.strings.map((s) => (
            <button key={s.label} type="button" onClick={() => playRef(s.midi)} title="Dengarkan nada acuan"
              className={`px-3 py-2 rounded-xl text-sm font-black border cursor-pointer ${ns?.string.label === s.label && reading ? 'border-accent bg-accent/15 text-white' : 'border-white/[0.12] text-gray-300'}`}>{s.label}</button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-500">Tips: mainkan satu senar saja, di ruangan tenang, dekatkan perangkat ke sumber suara. Ketuk nama senar untuk mendengar nada acuannya.</p>
    </Panel>
  );
};

// ───────────────────────── Komponen utama ─────────────────────────

export const AudioExtraTools: React.FC<AudioExtraToolsProps> = ({ initialTool = 'merge', gate, onSuccessToast }) => {
  const [active, setActive] = useState<ExtraToolId>(initialTool);
  const [visited, setVisited] = useState<Set<ExtraToolId>>(new Set([initialTool]));
  const select = (id: ExtraToolId) => { setActive(id); setVisited((v) => new Set(v).add(id)); };
  const show = (id: ExtraToolId) => (active === id ? '' : 'hidden');
  const mounted = (id: ExtraToolId) => (TABS.find((t) => t.id === id)?.realtime ? active === id : visited.has(id));

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Audio tools tambahan" className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} type="button" onClick={() => select(t.id)}
            className={`px-3 py-2 rounded-xl text-xs font-black inline-flex items-center gap-2 border cursor-pointer transition-all ${active === t.id ? 'bg-accent text-on-accent border-accent' : 'bg-black/40 text-gray-300 border-white/[0.1] hover:border-accent/50'}`}>
            <t.icon className="w-4 h-4" /><span>{t.label}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">{TABS.find((t) => t.id === active)?.desc} Semua diproses di perangkatmu.</p>
      {mounted('merge') && <div className={show('merge')}><MergeFadeTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('bpm') && <div className={show('bpm')}><BpmKeyTool toast={onSuccessToast} /></div>}
      {mounted('recorder') && <div className={show('recorder')}><RecorderTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('ringtone') && <div className={show('ringtone')}><RingtoneTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('clean') && <div className={show('clean')}><CleanTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('metronome') && <div className={show('metronome')}><MetronomeTool gate={gate} toast={onSuccessToast} /></div>}
      {mounted('tuner') && <div className={show('tuner')}><TunerTool /></div>}
    </div>
  );
};

export default AudioExtraTools;
