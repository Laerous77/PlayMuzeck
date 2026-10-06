// src/components/AudioStudio/VoiceTools.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mic, Square, Play, Download, Copy, AlertTriangle, CheckCircle, RotateCcw, Loader2, X, ArrowRight, Volume2, Trash2,
} from 'lucide-react';
import { detectPitch } from '../../services/audioExtraDsp';
import { downloadBlob, exportAudioFile } from '../../services/exporters';
import {
  BTN_DOWNLOAD, BTN_GHOST, BTN_PRIMARY, CARD_CLS, FORMAT_INFO, InfoTip, PANEL_CLS, SLIDER_CLS, pillCls,
} from './toolsShared';
import type { QuotaGate } from './AudioExtraTools';
import {
  NoteSegmenter, StableNoteDetector, VOICE_TYPES, WARMUPS, centsOff, classifyVoice, describeSpan, freqToMidi, keyName,
  midiToFreq, noteName, summarize, tessituraFrom, warmupStart, type NoteSegment, type WarmUp,
} from '../../services/voiceDsp';
import { fitSongs, type FitLevel, type SongFit } from '../../data/vocalRangeSongs';

const AudioCtx: typeof AudioContext = (typeof window !== 'undefined' &&
  (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)) as typeof AudioContext;

const fmtClock = (sec: number) => {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec - m * 60)).padStart(2, '0')}`;
};
const fmtSec = (sec: number) => `${sec.toFixed(sec < 10 ? 1 : 0)} dtk`;
const hz = (f: number) => `${f.toFixed(1)} Hz`;
const midiHz = (m: number, a4 = 440) => hz(midiToFreq(m, a4));
const semis = (n: number) => `${n > 0 ? '+' : ''}${n}`;

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

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block space-y-1">
    <span className="text-xs font-bold text-gray-300">{label}</span>
    {children}
    {hint && <span className="block text-[10px] text-gray-500">{hint}</span>}
  </label>
);

const ErrorNote: React.FC<{ msg: string | null }> = ({ msg }) =>
  msg ? (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>{msg}</span>
    </div>
  ) : null;

const InfoNote: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="text-[11px] text-gray-400 bg-black/40 border border-white/5 rounded-lg px-3 py-2 leading-relaxed">{children}</p>
);

const STOP_BTN = 'px-5 py-2 rounded-xl bg-red-500 hover:bg-red-400 text-white text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-md w-fit';

interface Frame { t: number; freq: number | null; clarity: number; rms: number }
interface MicHandle { stream: MediaStream; stop: () => void }

const FRAME_MS = 50;

async function openMic(onFrame: (f: Frame) => void): Promise<MicHandle> {
  if (!navigator.mediaDevices?.getUserMedia || !AudioCtx) throw new DOMException('Tidak didukung', 'NotSupportedError');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const ctx = new AudioCtx();
  if (ctx.state === 'suspended') {
    try { await ctx.resume(); } catch {}
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const t0 = performance.now();
  const id = window.setInterval(() => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    const rms = Math.sqrt(sum / buf.length);
    const p = detectPitch(buf, ctx.sampleRate, 60, 1400);
    onFrame({
      t: (performance.now() - t0) / 1000,
      freq: p && p.clarity >= 0.72 ? p.freq : null,
      clarity: p?.clarity ?? 0,
      rms,
    });
  }, FRAME_MS);
  return {
    stream,
    stop: () => {
      window.clearInterval(id);
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
    },
  };
}

const micError = (e: unknown) => {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Izin mikrofon ditolak. Izinkan akses mikrofon di pengaturan browser lalu coba lagi.';
  if (name === 'NotFoundError') return 'Mikrofon tidak ditemukan. Sambungkan mikrofon lalu coba lagi.';
  if (name === 'NotSupportedError') return 'Browser ini belum mendukung akses mikrofon. Coba Chrome, Edge, Firefox, atau Safari terbaru.';
  return 'Gagal mengakses mikrofon.';
};

function startRecorder(stream: MediaStream): { stop: () => Promise<Blob | null> } | null {
  if (typeof MediaRecorder === 'undefined') return null;
  try {
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    rec.start(250);
    return {
      stop: () => new Promise<Blob | null>((resolve) => {
        if (rec.state === 'inactive') { resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null); return; }
        rec.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: rec.mimeType || 'audio/webm' }) : null);
        rec.stop();
      }),
    };
  } catch { return null; }
}

async function decodeBlob(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioCtx();
  try { return await ctx.decodeAudioData(await blob.arrayBuffer()); } finally { void ctx.close(); }
}

function playSequence(midis: number[], a4 = 440, step = 0.6, hold = 0.55): { stop: () => void; durationMs: number } {
  const ctx = new AudioCtx();
  void ctx.resume();
  const master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  midis.forEach((m, i) => {
    const t = ctx.currentTime + 0.05 + i * step;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = midiToFreq(m, a4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + hold);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + hold + 0.05);
  });
  const durationMs = (midis.length * step + 0.3) * 1000;
  const id = window.setTimeout(() => void ctx.close(), durationMs);
  return { durationMs, stop: () => { window.clearTimeout(id); void ctx.close(); } };
}

function useTonePlayer(a4 = 440) {
  const cur = useRef<{ stop: () => void } | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const timer = useRef<number | null>(null);
  const stop = useCallback(() => {
    cur.current?.stop(); cur.current = null;
    if (timer.current) window.clearTimeout(timer.current);
    setPlayingId(null);
  }, []);
  const play = useCallback((id: string, midis: number[], step?: number, hold?: number) => {
    cur.current?.stop();
    if (timer.current) window.clearTimeout(timer.current);
    const p = playSequence(midis, a4, step, hold);
    cur.current = p; setPlayingId(id);
    timer.current = window.setTimeout(() => { cur.current = null; setPlayingId(null); }, p.durationMs);
  }, [a4]);
  useEffect(() => stop, [stop]);
  return { play, stop, playingId };
}

let runSeq = 0;
const newRunKey = (prefix: string) => `${prefix}-${++runSeq}-${Date.now().toString(36)}`;

const LiveReading: React.FC<{
  midi: number | null; freq: number | null; cents: number; level: number; active: boolean; idle: string;
}> = ({ midi, freq, cents, level, active, idle }) => {
  const inTune = midi !== null && Math.abs(cents) <= 10;
  const clamped = Math.max(-50, Math.min(50, cents));
  return (
    <div className="rounded-xl bg-black/50 border border-white/5 p-5 text-center space-y-3">
      <div className={`text-6xl font-black tabular-nums ${inTune ? 'text-emerald-400' : 'text-white'}`}>
        {midi !== null ? <>{noteName(midi).replace(/-?\d+$/, '')}<span className="text-2xl text-gray-400">{noteName(midi).match(/-?\d+$/)?.[0]}</span></> : '—'}
      </div>
      <div className="text-xs text-gray-400 tabular-nums">
        {midi !== null && freq !== null ? `${hz(freq)} · ${cents >= 0 ? '+' : ''}${cents.toFixed(0)} cent` : '\u00a0'}
      </div>
      <div className="relative h-3 rounded-full bg-white/10 mx-auto max-w-md" role="img" aria-label="Jarum ketepatan nada">
        <div className="absolute left-1/2 top-[-4px] bottom-[-4px] w-px bg-white/40" />
        {midi !== null && (
          <div className={`absolute top-[-4px] w-2 h-5 rounded-sm transition-all duration-100 ${inTune ? 'bg-emerald-400' : 'bg-accent'}`} style={{ left: `calc(${50 + clamped}% - 4px)` }} />
        )}
      </div>
      <div className={`text-sm font-bold ${inTune ? 'text-emerald-400' : 'text-gray-300'}`}>
        {!active ? idle : midi === null ? 'Bernyanyilah atau bersiullah…' : inTune ? 'Tepat!' : cents < 0 ? 'Sedikit di bawah nada' : 'Sedikit di atas nada'}
      </div>
      <div className="flex items-center gap-2 max-w-xs mx-auto" aria-label="Level mikrofon">
        <Mic className="w-3.5 h-3.5 text-gray-500 shrink-0" />
        <div className="h-1.5 flex-1 rounded-full bg-white/10 overflow-hidden">
          <div className={`h-full rounded-full transition-[width] duration-100 ${level > 92 ? 'bg-red-400' : 'bg-accent'}`} style={{ width: `${level}%` }} />
        </div>
      </div>
    </div>
  );
};

const levelPct = (rms: number) => Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(rms, 1e-5)) + 60) / 50) * 100));
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const RecordingExport: React.FC<{ buffer: AudioBuffer; fileName: string; onDone?: (m: string) => void }> = ({ buffer, fileName, onDone }) => {
  const [fmt, setFmt] = useState<'MP3' | 'WAV' | 'FLAC' | 'M4A'>('MP3');
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true); setErr(null); setNote(null); setPct(0);
    try {
      const r = await exportAudioFile(buffer, fileName, fmt, { mp3Kbps: 192, onProgress: setPct });
      if (r.note) setNote(r.note);
      onDone?.(`Berkas ${r.actualFormat} berhasil diunduh.`);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Gagal mengekspor berkas.'); }
    finally { setBusy(false); }
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
          <span>{busy ? `Mengekspor ${Math.round(pct)}%` : `Unduh rekaman ${fmt}`}</span>
        </button>
      </div>
      {note && <p className="text-[11px] text-amber-300">{note}</p>}
      <ErrorNote msg={err} />
    </div>
  );
};

const BTN_DELETE = 'px-3.5 py-2 rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 text-red-400 hover:text-red-300 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors';

const ReportButtons: React.FC<{ report: string; fileName: string; toast?: (m: string) => void; onClear?: () => void }> = ({ report, fileName, toast, onClear }) => (
  <div className="flex flex-wrap gap-2">
    <button type="button" className={BTN_PRIMARY} onClick={() => { downloadBlob(new Blob([report], { type: 'text/plain;charset=utf-8' }), fileName); toast?.('Laporan diunduh.'); }}>
      <Download className="w-4 h-4" /><span>Unduh laporan (.txt)</span>
    </button>
    <button type="button" className={BTN_GHOST} onClick={() => { void navigator.clipboard?.writeText(report); toast?.('Hasil disalin.'); }}>
      <Copy className="w-4 h-4" /><span>Salin hasil</span>
    </button>
    {onClear && (
      <button type="button" className={BTN_DELETE} onClick={onClear}>
        <Trash2 className="w-4 h-4" /><span>Hapus hasil</span>
      </button>
    )}
  </div>
);

const StatCard: React.FC<{ label: string; value: React.ReactNode; sub?: React.ReactNode }> = ({ label, value, sub }) => (
  <div className="rounded-xl bg-black/50 border border-white/5 p-4 min-w-0">
    <div className="text-[11px] font-bold text-gray-400">{label}</div>
    <div className="text-2xl font-black text-white tabular-nums break-words">{value}</div>
    {sub && <div className="text-[11px] text-gray-400 mt-1">{sub}</div>}
  </div>
);

const GRAPH_SECONDS = 8;
const MAX_RECORD_SEC = 300;

const accuracyLabel = (c: number) => (c <= 12 ? 'sangat akurat' : c <= 25 ? 'cukup akurat' : c <= 40 ? 'perlu dilatih' : 'masih sering meleset');

export const PitchDetectTool: React.FC<{ gate?: QuotaGate; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [a4, setA4] = useState(440);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [live, setLive] = useState<{ midi: number; freq: number; cents: number } | null>(null);
  const [level, setLevel] = useState(0);
  const [, setTick] = useState(0);
  const [segments, setSegments] = useState<NoteSegment[] | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);

  const a4Ref = useRef(a4); a4Ref.current = a4;
  const gateRef = useRef(gate); gateRef.current = gate;
  const micRef = useRef<MicHandle | null>(null);
  const recRef = useRef<ReturnType<typeof startRecorder>>(null);
  const segRef = useRef<NoteSegmenter | null>(null);
  const hist = useRef<{ t: number; m: number | null }[]>([]);
  const recent = useRef<number[]>([]);
  const lastVoiced = useRef(0);
  const range = useRef({ lo: 48, hi: 72 });
  const runKey = useRef<string | null>(null);
  const stoppingRef = useRef(false);

  const clearResult = useCallback(() => {
    setSegments(null); setAudioBuffer(null);
    setAudioUrl((u) => { if (u) URL.revokeObjectURL(u); return null; });
  }, []);

  const handleClear = useCallback(() => {
    clearResult();
    setErr(null); setElapsed(0); setLive(null); setLevel(0);
    hist.current = []; recent.current = [];
    toast?.('Hasil deteksi nada dihapus.');
  }, [clearResult, toast]);

  const finish = useCallback(async (auto = false) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setBusy(true);
    const mic = micRef.current; micRef.current = null;
    const rec = recRef.current; recRef.current = null;
    const blob = rec ? await rec.stop() : null;
    mic?.stop();
    setRunning(false); setLive(null); setLevel(0);
    const segs = segRef.current?.finish() ?? [];
    segRef.current = null;
    const key = runKey.current; runKey.current = null;
    if (segs.length === 0) {
      if (key) gate?.refund('pitch_detect', key);
      setErr('Tidak ada nada yang terdeteksi. Dekatkan mikrofon, bernyanyilah dengan "aaa" atau bersiullah, dan pastikan ruangan tenang.');
      setBusy(false); stoppingRef.current = false;
      return;
    }
    setSegments(segs);
    if (blob) {
      setAudioUrl(URL.createObjectURL(blob));
      try { setAudioBuffer(await decodeBlob(blob)); } catch {}
    }
    if (auto) toast?.('Batas perekaman 5 menit tercapai; rekaman dihentikan.');
    setBusy(false); stoppingRef.current = false;
  }, [gate, toast]);

  useEffect(() => () => {
    micRef.current?.stop(); micRef.current = null;
    void recRef.current?.stop(); recRef.current = null;
    const key = runKey.current; runKey.current = null;
    const seg = segRef.current; segRef.current = null;
    if (key && (!seg || (seg.segments.length === 0 && seg.currentMidi === null))) gateRef.current?.refund('pitch_detect', key);
  }, []);
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const start = async () => {
    if (running || busy) return;
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErr(micError(new DOMException('', 'NotSupportedError'))); return; }
    const key = newRunKey('pd');
    if (gate && !(await gate.use('pitch_detect', key))) return;
    setBusy(true);
    try {
      clearResult();
      hist.current = []; recent.current = []; lastVoiced.current = 0; range.current = { lo: 48, hi: 72 };
      segRef.current = new NoteSegmenter(0.12, 0.18, a4Ref.current);
      runKey.current = key;
      const mic = await openMic((f) => {
        if (stoppingRef.current) return;
        setElapsed(f.t); setLevel(levelPct(f.rms));
        segRef.current?.feed(f.t, f.freq);
        let m: number | null = null;
        if (f.freq !== null) {
          recent.current.push(f.freq); if (recent.current.length > 5) recent.current.shift();
          const med = median(recent.current);
          lastVoiced.current = f.t;
          const c = centsOff(med, a4Ref.current);
          setLive({ midi: c.midi, freq: med, cents: c.cents });
          m = freqToMidi(med, a4Ref.current);
          const r = range.current;
          if (m - 2 < r.lo) r.lo = Math.max(21, Math.floor(m - 2));
          if (m + 2 > r.hi) r.hi = Math.min(108, Math.ceil(m + 2));
        } else if (f.t - lastVoiced.current > 0.6) { recent.current = []; setLive(null); }
        hist.current.push({ t: f.t, m });
        const cutoff = f.t - GRAPH_SECONDS - 1;
        while (hist.current.length && hist.current[0].t < cutoff) hist.current.shift();
        setTick((n) => n + 1);
        if (f.t >= MAX_RECORD_SEC) void finish(true);
      });
      micRef.current = mic;
      recRef.current = startRecorder(mic.stream);
      setElapsed(0); setRunning(true);
    } catch (e) {
      micRef.current?.stop(); micRef.current = null; segRef.current = null; runKey.current = null;
      gate?.refund('pitch_detect', key);
      setErr(micError(e));
    } finally { setBusy(false); }
  };

  const summary = useMemo(() => (segments ? summarize(segments) : null), [segments]);

  const report = useMemo(() => {
    if (!summary || !segments) return '';
    const L = ['PlayMuzeck - Hasil Deteksi Nada Suara', ''];
    L.push(`Jumlah nada terdeteksi: ${summary.noteCount}`, `Total waktu bernada: ${summary.totalSungSeconds.toFixed(1)} detik`);
    if (summary.lowest) L.push(`Nada terendah: ${noteName(summary.lowest.midi)} (${midiHz(summary.lowest.midi, a4)})`);
    if (summary.highest) L.push(`Nada tertinggi: ${noteName(summary.highest.midi)} (${midiHz(summary.highest.midi, a4)})`);
    if (summary.mostSung) L.push(`Nada paling sering: ${noteName(summary.mostSung.midi)} (${summary.mostSung.seconds.toFixed(1)} detik)`);
    if (summary.key) L.push(`Perkiraan kunci: ${summary.key.name} (relatif ${summary.key.relative}), keyakinan ${Math.round(summary.key.confidence * 100)}%`);
    L.push(`Rata-rata penyimpangan dari nada tepat: ${summary.avgAbsCents.toFixed(0)} cent (${accuracyLabel(summary.avgAbsCents)})`);
    L.push(`Acuan A4: ${a4} Hz`, '', 'Urutan nada (waktu mulai, nada, durasi):');
    segments.forEach((s) => L.push(`${fmtClock(s.start)}.${Math.floor((s.start % 1) * 10)}  ${noteName(s.midi)}  ${s.duration.toFixed(2)} dtk  (${s.avgCents >= 0 ? '+' : ''}${s.avgCents.toFixed(0)} cent)`));
    L.push('', 'Catatan: hasil berupa deteksi otomatis.');
    return L.join('\n');
  }, [summary, segments, a4]);

  const { lo, hi } = range.current;
  const rows = hi - lo + 1;
  const now = hist.current.length ? hist.current[hist.current.length - 1].t : 0;
  const lines: string[] = [];
  {
    let cur: string[] = [];
    const flush = () => { if (cur.length > 1) lines.push(cur.join(' ')); cur = []; };
    const winStart = now - GRAPH_SECONDS;
    for (const p of hist.current) {
      if (p.t < winStart) continue;
      if (p.m === null) { flush(); continue; }
      const x = ((p.t - winStart) / GRAPH_SECONDS) * 1000;
      const y = ((hi + 0.5 - p.m) / rows) * (rows * 10);
      cur.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    flush();
  }
  const labelMidis: number[] = [];
  for (let m = lo; m <= hi; m++) if (m % 12 === 0 || (rows <= 26 && (m % 12 === 4 || m % 12 === 7))) labelMidis.push(m);

  return (
    <Panel title="Deteksi Nada Suara" info={[
      'Aktifkan perekaman lalu bernyanyi, bersenandung, atau bersiul. Nada yang kamu hasilkan dideteksi langsung dan digambar sebagai grafik pitch.',
      'Setelah berhenti, kamu mendapat ringkasan: nada terendah/tertinggi, nada paling sering, perkiraan kunci, dan seberapa tepat intonasimu.',
    ]}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={`Acuan A4: ${a4} Hz`} hint="Standar 440 Hz.">
          <div className="flex items-center gap-2">
            <input type="range" min={430} max={450} value={a4} onChange={(e) => setA4(+e.target.value)} className={SLIDER_CLS} disabled={running} />
            <button type="button" onClick={() => setA4(440)} disabled={a4 === 440 || running} className={BTN_GHOST}>440</button>
          </div>
        </Field>
        <div className="flex items-end">
          {!running ? (
            <button type="button" onClick={start} disabled={busy} className={BTN_PRIMARY}>
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              <span>{segments ? 'Rekam lagi' : 'Mulai merekam'}</span>
            </button>
          ) : (
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => void finish()} disabled={busy} className={STOP_BTN}><Square className="w-3.5 h-3.5" /><span>Berhenti</span></button>
              <span className="flex items-center gap-2 text-sm text-red-300 tabular-nums"><span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />{fmtClock(elapsed)}</span>
            </div>
          )}
        </div>
      </div>
      <ErrorNote msg={err} />

      {(running || segments) && (
        <LiveReading midi={live?.midi ?? null} freq={live?.freq ?? null} cents={live?.cents ?? 0} level={level} active={running} idle="Rekaman selesai. Lihat ringkasan di bawah." />
      )}

      {running && (
        <div className="space-y-1.5">
          <div className="text-xs font-bold text-gray-300">Grafik pitch (8 detik terakhir)</div>
          <div className="relative flex rounded-xl bg-black/60 border border-white/10 overflow-hidden h-56" role="img" aria-label="Grafik nada yang kamu nyanyikan">
            <div className="relative w-10 shrink-0 border-r border-white/10">
              {labelMidis.map((m) => (
                <span key={m} className="absolute right-1 -translate-y-1/2 text-[9px] font-mono text-gray-500" style={{ top: `${((hi + 0.5 - m) / rows) * 100}%` }}>{noteName(m)}</span>
              ))}
            </div>
            <svg className="flex-1 h-full text-accent" viewBox={`0 0 1000 ${rows * 10}`} preserveAspectRatio="none" aria-hidden>
              {Array.from({ length: rows }, (_, i) => {
                const m = hi - i;
                const black = [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
                return <rect key={m} x={0} y={i * 10} width={1000} height={10} className={black ? 'fill-white/[0.05]' : 'fill-transparent'} />;
              })}
              {Array.from({ length: rows }, (_, i) => ((hi - i) % 12 === 0 ? <line key={`c${i}`} x1={0} x2={1000} y1={(i + 1) * 10} y2={(i + 1) * 10} stroke="rgba(255,255,255,0.12)" strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null))}
              {live && <line x1={0} x2={1000} y1={((hi + 0.5 - live.midi) / rows) * rows * 10} y2={((hi + 0.5 - live.midi) / rows) * rows * 10} stroke="rgba(255,255,255,0.25)" strokeDasharray="4 4" strokeWidth={1} vectorEffect="non-scaling-stroke" />}
              {lines.map((pts, i) => <polyline key={i} points={pts} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
            </svg>
          </div>
        </div>
      )}

      {summary && segments && !running && (
        <div className="space-y-4">
          <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />Selesai: {summary.noteCount} nada terdeteksi dalam {fmtSec(summary.totalSungSeconds)} bernada.</p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="NADA TERENDAH" value={summary.lowest ? noteName(summary.lowest.midi) : '—'} sub={summary.lowest ? midiHz(summary.lowest.midi, a4) : undefined} />
            <StatCard label="NADA TERTINGGI" value={summary.highest ? noteName(summary.highest.midi) : '—'} sub={summary.highest ? midiHz(summary.highest.midi, a4) : undefined} />
            <StatCard label="PALING SERING" value={summary.mostSung ? noteName(summary.mostSung.midi) : '—'} sub={summary.mostSung ? `${summary.mostSung.seconds.toFixed(1)} detik` : undefined} />
            <StatCard
              label="PERKIRAAN KUNCI"
              value={summary.key ? summary.key.name : '—'}
              sub={summary.key ? `relatif ${summary.key.relative} · keyakinan ${Math.round(summary.key.confidence * 100)}%` : 'Data belum mencukupi'}
            />
          </div>
          <div className={`${CARD_CLS} text-xs space-y-1`}>
            <div className="font-bold text-gray-300">Ketepatan intonasi</div>
            <p className="text-gray-400">
              Rata-rata nadamu menyimpang <span className="font-bold text-white">{summary.avgAbsCents.toFixed(0)} cent</span> dari nada tepat ({accuracyLabel(summary.avgAbsCents)}).
            </p>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-bold text-gray-300">Urutan nada yang kamu nyanyikan</div>
            <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
              {segments.slice(0, 120).map((s, i) => (
                <span key={i} className="px-2 py-1 rounded-lg bg-black/50 border border-white/10 text-[11px] font-mono text-gray-200" title={`${fmtClock(s.start)} · ${s.duration.toFixed(2)} dtk`}>
                  <span className="font-black text-white">{noteName(s.midi)}</span> <span className="text-gray-500">{s.duration.toFixed(1)}s</span>
                </span>
              ))}
            </div>
          </div>
          {audioUrl && <audio controls src={audioUrl} className="w-full" />}
          <ReportButtons report={report} fileName="PlayMuzeck_Deteksi_Nada.txt" toast={toast} onClear={handleClear} />
          {audioBuffer && <RecordingExport buffer={audioBuffer} fileName="PlayMuzeck_Rekaman_Suara" onDone={toast} />}
        </div>
      )}
    </Panel>
  );
};

type Phase = 'intro' | 'low' | 'high' | 'comfort' | 'result';

const STEPS: { id: Exclude<Phase, 'intro' | 'result'>; label: string }[] = [
  { id: 'low', label: 'Nada terendah' },
  { id: 'high', label: 'Nada tertinggi' },
  { id: 'comfort', label: 'Nada nyaman' },
];

const PHASE_HELP: Record<'low' | 'high' | 'comfort', string> = {
  low: 'Nyanyikan "aaa" mulai dari nada yang nyaman, lalu turunkan pelan-pelan selangkah demi selangkah. Tahan nada terendah yang masih jernih selama sekitar 1 detik.',
  high: 'Sekarang naikkan nada pelan-pelan dengan "aaa" atau "ooo". Tahan nada tertinggi yang masih bisa kamu nyanyikan tanpa memaksa. Berhenti bila tenggorokan terasa tegang.',
  comfort: 'Nyanyikan sepotong lagu yang kamu hafal dengan nyaman selama 10-20 detik untuk mengukur wilayah nyamanmu.',
};

const LEVEL_META: Record<FitLevel, { label: string; hint: string }> = {
  comfort: { label: 'Nyaman', hint: 'Seluruh melodi ada di wilayah nyamanmu.' },
  range: { label: 'Rentang penuh', hint: 'Muat di jangkauanmu, tetapi ujung melodi mendekati batas.' },
  challenge: { label: 'Tantangan', hint: 'Sedikit di luar jangkauanmu saat ini, untuk melatih perluasan rentang.' },
};

const A4 = 440;
const AXIS_MIN = 36;
const AXIS_MAX = 96;

const pctOf = (m: number) => ((Math.min(AXIS_MAX, Math.max(AXIS_MIN, m)) - AXIS_MIN) / (AXIS_MAX - AXIS_MIN)) * 100;

export const VocalRangeResult: React.FC<{
  low: number; high: number; tessMeasured: Map<number, number> | null; toast?: (m: string) => void; onRetake: () => void; onClear?: () => void;
}> = ({ low, high, tessMeasured, toast, onRetake, onClear }) => {
  const [songTab, setSongTab] = useState<FitLevel>('comfort');
  const [showAll, setShowAll] = useState(false);
  const player = useTonePlayer(A4);

  const result = useMemo(() => {
    const lo = Math.min(low, high), hi = Math.max(low, high);
    const matches = classifyVoice(lo, hi);
    const tess = tessituraFrom(lo, hi, tessMeasured ?? undefined);
    const fits = fitSongs(lo, hi, tess.low, tess.high);
    const warm = WARMUPS.map((w) => ({ w, start: warmupStart(w, tess.low, tess.high) }));
    return { lo, hi, span: hi - lo, matches, tess, fits, warm };
  }, [low, high, tessMeasured]);

  const fitsByLevel = useMemo(() => {
    const g: Record<FitLevel, SongFit[]> = { comfort: [], range: [], challenge: [] };
    result.fits.forEach((f) => g[f.level].push(f));
    return g;
  }, [result]);

  useEffect(() => {
    if (fitsByLevel[songTab].length === 0) {
      const first = (['comfort', 'range', 'challenge'] as const).find((l) => fitsByLevel[l].length > 0);
      if (first) setSongTab(first);
    }
  }, [fitsByLevel, songTab]);

  const report = useMemo(() => {
    const top = result.matches[0];
    const L = ['PlayMuzeck - Hasil Tes Vocal Range', ''];
    L.push(`Rentang suara: ${noteName(result.lo)} – ${noteName(result.hi)} (${midiHz(result.lo)} – ${midiHz(result.hi)})`);
    L.push(`Jangkauan: ${describeSpan(result.span)} (${result.span} semiton)`);
    L.push(`Wilayah nyaman: ${noteName(result.tess.low)} – ${noteName(result.tess.high)}`);
    L.push(`Jenis suara paling mendekati: ${top.type.name}`);
    L.push('', 'Contoh lagu:');
    (['comfort', 'range', 'challenge'] as const).forEach((lv) => {
      fitsByLevel[lv].forEach((f) => L.push(`- [${LEVEL_META[lv].label}] ${f.song.title}: kunci ${keyName(f.tonic)}, melodi ${noteName(f.low)}–${noteName(f.high)}`));
    });
    return L.join('\n');
  }, [result, fitsByLevel]);

  const visibleSongs = fitsByLevel[songTab].slice(0, showAll ? 50 : 6);

  return (
    <div className="space-y-5">
      <p className="text-xs text-emerald-300 flex items-center gap-1.5"><CheckCircle className="w-4 h-4" />Tes selesai. Ini hasil jangkauan suaramu.</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="RENTANG SUARA" value={`${noteName(result.lo)}–${noteName(result.hi)}`} sub={`${midiHz(result.lo)} – ${midiHz(result.hi)}`} />
        <StatCard label="JANGKAUAN" value={describeSpan(result.span)} sub={`${result.span} semiton`} />
        <StatCard label={result.tess.measured ? 'WILAYAH NYAMAN' : 'WILAYAH NYAMAN (PERKIRAAN)'} value={`${noteName(result.tess.low)}–${noteName(result.tess.high)}`} sub={result.tess.measured ? 'Dari nyanyianmu di langkah 3' : '60% bagian tengah rentang'} />
        <StatCard label="JENIS SUARA TERDEKAT" value={result.matches[0].type.name} sub={`kecocokan rentang ${Math.round(result.matches[0].fit * 100)}%`} />
      </div>

      <div className="space-y-2">
        <div className="text-xs font-bold text-gray-300">Rentangmu dibanding jenis suara</div>
        <div className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-1.5">
          {[{ id: 'me', name: 'Kamu', low: result.lo, high: result.hi }, ...VOICE_TYPES].map((row) => {
            const me = row.id === 'me';
            const top = result.matches[0].type.id === row.id;
            return (
              <div key={row.id} className="flex items-center gap-2 text-[11px]">
                <span className={`w-24 shrink-0 truncate ${me ? 'font-black text-accent' : top ? 'font-bold text-white' : 'text-gray-400'}`}>{row.name}</span>
                <div className="relative h-3 flex-1 rounded bg-white/[0.06]">
                  <div className={`absolute top-0 bottom-0 rounded ${me ? 'bg-accent' : top ? 'bg-white/50' : 'bg-white/20'}`} style={{ left: `${pctOf(row.low)}%`, width: `${Math.max(1.5, pctOf(row.high) - pctOf(row.low))}%` }} />
                  {me && <div className="absolute top-0 bottom-0 rounded border-2 border-white/80" style={{ left: `${pctOf(result.tess.low)}%`, width: `${Math.max(1, pctOf(result.tess.high) - pctOf(result.tess.low))}%` }} title="Wilayah nyaman" />}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h5 className="text-sm font-bold text-white">Contoh lagu di rentangmu</h5>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {(['comfort', 'range', 'challenge'] as const).map((lv) => (
            <button key={lv} type="button" onClick={() => { setSongTab(lv); setShowAll(false); }} className={pillCls(songTab === lv)}>
              {LEVEL_META[lv].label} ({fitsByLevel[lv].length})
            </button>
          ))}
        </div>
        {visibleSongs.length === 0 ? (
          <InfoNote>Belum ada lagu pada kategori ini untuk rentangmu.</InfoNote>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {visibleSongs.map((f) => {
              const id = `song-${f.song.id}`;
              const playing = player.playingId === id;
              return (
                <li key={f.song.id} className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2 min-w-0">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-white break-words">{f.song.title}</div>
                    <div className="text-[11px] text-gray-400">{f.song.artist}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                    <span className="px-2 py-0.5 rounded-md bg-accent/15 text-accent border border-accent/20">Kunci {keyName(f.tonic)}</span>
                    <span className="px-2 py-0.5 rounded-md bg-black/60 text-gray-300 border border-white/10 font-mono">{noteName(f.low)}–{noteName(f.high)}</span>
                  </div>
                  <button type="button" className={BTN_GHOST} onClick={() => (playing ? player.stop() : player.play(id, [f.tonic, f.low, f.high]))}>
                    {playing ? <Square className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5 text-accent" />}
                    <span>{playing ? 'Hentikan' : 'Dengar nada tonika & rentang'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h5 className="text-sm font-bold text-white">Latihan pemanasan</h5>
        </div>
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {result.warm.map(({ w, start }: { w: WarmUp; start: number | null }) => {
            const id = `warm-${w.id}`;
            const playing = player.playingId === id;
            return (
              <li key={w.id} className="rounded-xl bg-black/50 border border-white/5 p-3 space-y-2">
                <div className="text-xs font-bold text-white">{w.name}</div>
                <p className="text-[11px] text-gray-400">{w.desc}</p>
                {start !== null && (
                  <button type="button" className={BTN_GHOST} onClick={() => (playing ? player.stop() : player.play(id, w.steps.map((s) => start + s), 0.5, 0.45))}>
                    {playing ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-accent" />}
                    <span>{playing ? 'Hentikan' : 'Mainkan acuan'}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <ReportButtons report={report} fileName="PlayMuzeck_Vocal_Range.txt" toast={toast} />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onRetake} className={BTN_GHOST}><RotateCcw className="w-3.5 h-3.5" /><span>Tes ulang</span></button>
        {onClear && <button type="button" onClick={onClear} className={BTN_DELETE}><Trash2 className="w-3.5 h-3.5" /><span>Hapus hasil</span></button>}
      </div>
    </div>
  );
};

export const VocalRangeTool: React.FC<{ gate?: QuotaGate; toast?: (m: string) => void }> = ({ gate, toast }) => {
  const [phase, setPhase] = useState<Phase>('intro');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [low, setLow] = useState<number | null>(null);
  const [high, setHigh] = useState<number | null>(null);
  const [live, setLive] = useState<{ midi: number; freq: number; cents: number } | null>(null);
  const [level, setLevel] = useState(0);
  const [hold, setHold] = useState(0);
  const [tessMeasured, setTessMeasured] = useState<Map<number, number> | null>(null);
  const [hasTaken, setHasTaken] = useState(false);

  const gateRef = useRef(gate); gateRef.current = gate;
  const phaseRef = useRef<Phase>('intro');
  const lowRef = useRef<number | null>(null);
  const highRef = useRef<number | null>(null);
  const histRef = useRef<Map<number, number>>(new Map());
  const detRef = useRef(new StableNoteDetector(6, 0.80, A4));
  const micRef = useRef<MicHandle | null>(null);
  const recent = useRef<number[]>([]);
  const lastVoiced = useRef(0);
  const lastT = useRef(0);
  const runKey = useRef<string | null>(null);

  const goPhase = (p: Phase) => { phaseRef.current = p; detRef.current.reset(); setHold(0); setPhase(p); };

  const closeMic = useCallback(() => { micRef.current?.stop(); micRef.current = null; setLive(null); setLevel(0); }, []);

  useEffect(() => () => {
    micRef.current?.stop(); micRef.current = null;
    const key = runKey.current; runKey.current = null;
    if (key) gateRef.current?.refund('vocal_range', key);
  }, []);

  const abort = (message?: string) => {
    closeMic();
    const key = runKey.current; runKey.current = null;
    if (key) gate?.refund('vocal_range', key);
    lowRef.current = null; highRef.current = null; histRef.current = new Map();
    setLow(null); setHigh(null); setTessMeasured(null);
    goPhase('intro');
    if (message) setErr(message);
  };

  const onFrame = (f: Frame) => {
    setLevel(levelPct(f.rms));
    const ph = phaseRef.current;
    if (f.freq !== null) {
      recent.current.push(f.freq); if (recent.current.length > 5) recent.current.shift();
      const med = median(recent.current);
      lastVoiced.current = f.t;
      const c = centsOff(med, A4);
      setLive({ midi: c.midi, freq: med, cents: c.cents });
    } else if (f.t - lastVoiced.current > 0.6) { recent.current = []; setLive(null); }

    const dt = Math.max(0, Math.min(0.2, f.t - lastT.current)); lastT.current = f.t;
    const stable = detRef.current.feed(f.freq, f.clarity);
    setHold(detRef.current.progress);
    if (ph === 'low' && stable !== null && (lowRef.current === null || stable < lowRef.current)) { lowRef.current = stable; setLow(stable); }
    if (ph === 'high' && stable !== null && (highRef.current === null || stable > highRef.current)) { highRef.current = stable; setHigh(stable); }
    if (ph === 'comfort' && f.freq !== null && f.clarity >= 0.78) {
      const m = Math.round(freqToMidi(f.freq, A4));
      histRef.current.set(m, (histRef.current.get(m) ?? 0) + dt);
    }
  };

  const begin = async () => {
    if (busy) return;
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) { setErr(micError(new DOMException('', 'NotSupportedError'))); return; }
    const key = newRunKey('vr');
    if (gate && !(await gate.use('vocal_range', key))) return;
    setBusy(true);
    try {
      lowRef.current = null; highRef.current = null; histRef.current = new Map();
      setLow(null); setHigh(null); setTessMeasured(null);
      recent.current = []; lastVoiced.current = 0; lastT.current = 0; runKey.current = key;
      micRef.current = await openMic(onFrame);
      goPhase('low');
    } catch (e) {
      micRef.current?.stop(); micRef.current = null; runKey.current = null;
      gate?.refund('vocal_range', key);
      setErr(micError(e));
    } finally { setBusy(false); }
  };

  const redo = () => {
    if (phase === 'low') { lowRef.current = null; setLow(null); }
    if (phase === 'high') { highRef.current = null; setHigh(null); }
    if (phase === 'comfort') { histRef.current = new Map(); }
    detRef.current.reset(); setHold(0); setErr(null);
  };

  const next = () => {
    setErr(null);
    if (phase === 'low') { goPhase('high'); return; }
    if (phase === 'high') {
      if (lowRef.current !== null && highRef.current !== null && highRef.current <= lowRef.current) {
        setErr(`Nada tertinggi (${noteName(highRef.current)}) harus berada di atas nada terendah (${noteName(lowRef.current)}). Ulangi dan naikkan nadamu lebih tinggi.`);
        return;
      }
      goPhase('comfort'); return;
    }
    if (phase === 'comfort') finishTest(true);
  };

  const finishTest = (useComfort: boolean) => {
    closeMic();
    runKey.current = null;
    setTessMeasured(useComfort && histRef.current.size >= 3 ? new Map(histRef.current) : null);
    setHasTaken(true);
    goPhase('result');
    toast?.('Tes vocal range selesai.');
  };

  const retake = () => { setErr(null); goPhase('intro'); };

  const clearResult = () => {
    lowRef.current = null; highRef.current = null; histRef.current = new Map();
    setLow(null); setHigh(null); setTessMeasured(null); setHasTaken(false); setErr(null);
    goPhase('intro');
    toast?.('Hasil tes vocal range dihapus.');
  };

  const stepIndex = STEPS.findIndex((s) => s.id === phase);
  const captured = phase === 'low' ? low : phase === 'high' ? high : null;
  const comfortSeconds = [...histRef.current.values()].reduce((s, v) => s + v, 0);
  const canNext = phase === 'comfort' ? comfortSeconds >= 2.5 : captured !== null;

  return (
    <Panel title="Tes Vocal Range" info={[
      'Tes terpandu untuk mengetahui jangkauan suaramu: nada terendah, nada tertinggi, dan wilayah nyaman.',
      'Dari rentang itu kamu mendapat perkiraan jenis suara, contoh lagu yang pas, dan latihan pemanasan.',
    ]}>
      {phase === 'intro' && (
        <div className="space-y-3">
          <InfoNote>
            Tes 3 langkah: (1) nada terendah, (2) nada tertinggi, (3) menyanyikan sepotong lagu dengan nyaman. Gunakan vokal "aaa".
          </InfoNote>
          <button type="button" onClick={begin} disabled={busy} className={BTN_PRIMARY}>
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
            <span>{busy ? 'Membuka mikrofon…' : hasTaken ? 'Tes ulang' : 'Mulai tes'}</span>
          </button>
        </div>
      )}
      <ErrorNote msg={err} />

      {(phase === 'low' || phase === 'high' || phase === 'comfort') && (
        <div className="space-y-4">
          <ol className="flex flex-wrap gap-2" aria-label="Langkah tes">
            {STEPS.map((s, i) => (
              <li key={s.id} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${i === stepIndex ? 'bg-accent text-on-accent border-accent' : i < stepIndex ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/10' : 'border-white/10 text-gray-400 bg-black/40'}`}>
                {i + 1}. {s.label}{i < stepIndex ? ' ✓' : ''}
              </li>
            ))}
          </ol>
          <InfoNote>{PHASE_HELP[phase]}</InfoNote>

          <LiveReading midi={live?.midi ?? null} freq={live?.freq ?? null} cents={live?.cents ?? 0} level={level} active idle="" />

          {phase !== 'comfort' ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs gap-3">
                <span className="text-gray-300 font-bold">Menahan nada…</span>
                <span className="text-gray-500">Tahan nada stabil sejenak</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${hold * 100}%` }} /></div>
              <div className={`${CARD_CLS} flex items-center justify-between gap-3 text-xs`}>
                <span className="text-gray-300 font-bold">{phase === 'low' ? 'Nada terendah tercatat:' : 'Nada tertinggi tercatat:'}</span>
                <span className="font-mono font-black text-accent text-base tabular-nums">
                  {captured !== null ? `${noteName(captured)} · ${midiHz(captured)}` : 'belum ada'}
                </span>
              </div>
            </div>
          ) : (
            <div className={`${CARD_CLS} flex items-center justify-between gap-3 text-xs`}>
              <span className="text-gray-300 font-bold">Waktu bernada nyaman terekam:</span>
              <span className="font-mono font-black text-accent text-base tabular-nums">{comfortSeconds.toFixed(0)} dtk{comfortSeconds < 2.5 ? ' (min. 3s)' : ''}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={next} disabled={!canNext} className={BTN_PRIMARY}>
              <span>{phase === 'comfort' ? 'Selesai & lihat hasil' : 'Lanjut'}</span><ArrowRight className="w-3.5 h-3.5" />
            </button>
            {phase === 'comfort' && (
              <button type="button" onClick={() => finishTest(false)} className={BTN_GHOST}>Lewati langkah ini</button>
            )}
            <button type="button" onClick={redo} className={BTN_GHOST}><RotateCcw className="w-3.5 h-3.5" /><span>Ulangi bagian ini</span></button>
            <button type="button" onClick={() => abort()} className={BTN_GHOST}><X className="w-3.5 h-3.5" /><span>Batalkan tes</span></button>
          </div>
        </div>
      )}

      {phase === 'result' && (
        <VocalRangeResult
          low={low ?? lowRef.current ?? 48}
          high={high ?? highRef.current ?? 72}
          tessMeasured={tessMeasured}
          toast={toast}
          onRetake={retake}
          onClear={clearResult}
        />
      )}
    </Panel>
  );
};
