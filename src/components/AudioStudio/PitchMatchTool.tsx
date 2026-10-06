// src/components/AudioStudio/PitchMatchTool.tsx
//
// Fitur Audio Tool: Latihan Nada & Tempo (Pitch & Tempo Matcher).
// Pengguna mengunggah audio acuan (atau menggunakan lagu aktif studio), bernyanyi
// bersama audio via mikrofon, dan sistem menganalisis serta menilai kecocokan
// nada dan ketepatan tempo secara real-time dan terperinci.

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Mic, Square, Play, Pause, Download, Copy, AlertTriangle, CheckCircle, RotateCcw,
  Loader2, Volume2, Upload, Music, Headphones, Activity, Target, Sparkles, ChevronRight,
  Sliders, Trash2
} from 'lucide-react';
import {
  extractReferenceMelody, evaluateRealtimeMatch, evaluateVocalPerformance,
  ReferenceMelodyProfile, RealtimeMatchFeedback, UserVocalPoint, VocalEvaluationResult
} from '../../services/pitchMatchDsp';
import { detectPitch } from '../../services/audioExtraDsp';
import { exportAudioFile, downloadBlob } from '../../services/exporters';
import {
  BTN_DOWNLOAD, BTN_GHOST, BTN_PRIMARY, CARD_CLS, FORMAT_INFO, InfoTip, PANEL_CLS,
  SLIDER_CLS, pillCls
} from './toolsShared';
import type { QuotaGate } from './AudioExtraTools';

const AudioCtx: typeof AudioContext = (typeof window !== 'undefined' &&
  (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)) as typeof AudioContext;

const fmtClock = (sec: number) => {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec - m * 60)).padStart(2, '0')}`;
};

const levelPct = (rms: number) => Math.max(0, Math.min(100, ((20 * Math.log10(Math.max(rms, 1e-5)) + 60) / 50) * 100));

interface PitchMatchToolProps {
  gate?: QuotaGate;
  onSuccessToast?: (msg: string) => void;
  studioActiveTrack?: { id: string; title: string; audioUrl?: string } | null;
}

export const PitchMatchTool: React.FC<PitchMatchToolProps> = ({ gate, onSuccessToast, studioActiveTrack }) => {
  // State Audio Acuan
  const [refFileName, setRefFileName] = useState<string>('');
  const [refBuffer, setRefBuffer] = useState<AudioBuffer | null>(null);
  const [refProfile, setRefProfile] = useState<ReferenceMelodyProfile | null>(null);
  const [isAnalyzingRef, setIsAnalyzingRef] = useState<boolean>(false);
  const [analysisProgress, setAnalysisProgress] = useState<number>(0);

  // State Latihan & Perekaman
  const [isPracticing, setIsPracticing] = useState<boolean>(false);
  const [currentPlaybackTime, setCurrentPlaybackTime] = useState<number>(0);
  const [micLevel, setMicLevel] = useState<number>(0);
  const [matchFeedback, setMatchFeedback] = useState<RealtimeMatchFeedback | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Kontrol Volume saat Latihan
  const [refTrackVolume, setRefTrackVolume] = useState<number>(0.75);
  const [playbackVocalVolume, setPlaybackVocalVolume] = useState<number>(0.9);

  // Rekaman Vokal Pengguna
  const [recordedVocalBuffer, setRecordedVocalBuffer] = useState<AudioBuffer | null>(null);
  const [recordedVocalUrl, setRecordedVocalUrl] = useState<string | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<VocalEvaluationResult | null>(null);

  // Pemutaran Hasil Komparasi
  const [isReviewPlaying, setIsReviewPlaying] = useState<boolean>(false);
  const [reviewCurrentTime, setReviewCurrentTime] = useState<number>(0);

  // Ekspor Rekaman Vokal
  const [exportFmt, setExportFmt] = useState<'MP3' | 'WAV' | 'FLAC' | 'M4A'>('MP3');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);

  // Refs untuk Web Audio & Loop
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const refSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const refGainNodeRef = useRef<GainNode | null>(null);
  const userMediaStreamRef = useRef<MediaStream | null>(null);
  const micIntervalRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const userSingingHistoryRef = useRef<UserVocalPoint[]>([]);
  const runKeyRef = useRef<string | null>(null);
  const rafReviewRef = useRef<number | null>(null);
  const reviewStartTimeRef = useRef<number>(0);
  const reviewSourcesRef = useRef<{ refSource?: AudioBufferSourceNode; vocalSource?: AudioBufferSourceNode; refGain?: GainNode; vocalGain?: GainNode }>({});

  const stopAllMedia = useCallback(() => {
    if (micIntervalRef.current) {
      window.clearInterval(micIntervalRef.current);
      micIntervalRef.current = null;
    }
    if (userMediaStreamRef.current) {
      userMediaStreamRef.current.getTracks().forEach((t) => t.stop());
      userMediaStreamRef.current = null;
    }
    if (refSourceNodeRef.current) {
      try { refSourceNodeRef.current.stop(); } catch {}
      refSourceNodeRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try { mediaRecorderRef.current.stop(); } catch {}
      mediaRecorderRef.current = null;
    }
    if (rafReviewRef.current) {
      cancelAnimationFrame(rafReviewRef.current);
      rafReviewRef.current = null;
    }
    try {
      reviewSourcesRef.current.refSource?.stop();
      reviewSourcesRef.current.vocalSource?.stop();
    } catch {}
    reviewSourcesRef.current = {};
    setIsPracticing(false);
    setIsReviewPlaying(false);
    setMicLevel(0);
    setMatchFeedback(null);
  }, []);

  useEffect(() => {
    return () => {
      stopAllMedia();
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
        audioContextRef.current = null;
      }
      if (recordedVocalUrl) {
        URL.revokeObjectURL(recordedVocalUrl);
      }
    };
  }, [stopAllMedia, recordedVocalUrl]);

  // Decode & Analisis Audio Acuan
  const processReferenceAudio = async (arrayBuffer: ArrayBuffer, name: string) => {
    setErrorMsg(null);
    setIsAnalyzingRef(true);
    setAnalysisProgress(5);
    stopAllMedia();

    try {
      const AudioContextClass = AudioCtx;
      const tempCtx = new AudioContextClass();
      const decoded = await tempCtx.decodeAudioData(arrayBuffer);
      await tempCtx.close();

      setRefBuffer(decoded);
      setRefFileName(name);
      setAnalysisProgress(20);

      const profile = await extractReferenceMelody(decoded, (pct) => {
        setAnalysisProgress(20 + Math.round(pct * 0.75));
      });

      setRefProfile(profile);
      setAnalysisProgress(100);
      onSuccessToast?.(`Audio acuan "${name}" siap. Terdeteksi ${profile.notes.length} nada melodi acuan.`);
    } catch (err: any) {
      console.error(err);
      setErrorMsg('Gagal membaca atau menganalisis file audio acuan. Pastikan format didukung (MP3, WAV, M4A, FLAC).');
    } finally {
      setIsAnalyzingRef(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ab = await file.arrayBuffer();
    await processReferenceAudio(ab, file.name);
  };

  const handleLoadStudioActiveTrack = async () => {
    if (!studioActiveTrack?.audioUrl) {
      setErrorMsg('Trek aktif di Audio Studio belum memiliki berkas audio master.');
      return;
    }
    setIsAnalyzingRef(true);
    try {
      const res = await fetch(studioActiveTrack.audioUrl);
      const ab = await res.arrayBuffer();
      await processReferenceAudio(ab, studioActiveTrack.title || 'Studio Track');
    } catch (err) {
      setErrorMsg('Gagal mengunduh audio master dari Audio Studio.');
      setIsAnalyzingRef(false);
    }
  };

  // Mulai Latihan & Evaluasi
  const startPractice = async () => {
    if (!refBuffer || !refProfile) {
      setErrorMsg('Pilih atau unggah audio acuan terlebih dahulu.');
      return;
    }
    setErrorMsg(null);

    const sessionKey = `pitch_match_${Date.now()}`;
    if (gate && !(await gate.use('pitch_match', sessionKey))) {
      return;
    }
    runKeyRef.current = sessionKey;

    try {
      const AudioContextClass = AudioCtx;
      const ctx = audioContextRef.current || new AudioContextClass();
      if (ctx.state === 'suspended') await ctx.resume();
      audioContextRef.current = ctx;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      userMediaStreamRef.current = stream;

      const micSource = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      micSource.connect(analyser);

      // Perekam vokal pengguna
      recordedChunksRef.current = [];
      userSingingHistoryRef.current = [];
      let recorder: MediaRecorder | null = null;
      try {
        const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg'].find((m) =>
          MediaRecorder.isTypeSupported(m)
        );
        recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        recorder.ondataavailable = (ev) => {
          if (ev.data.size > 0) recordedChunksRef.current.push(ev.data);
        };
        recorder.start(100);
        mediaRecorderRef.current = recorder;
      } catch (e) {
        console.warn('MediaRecorder fallback:', e);
      }

      // Pemutar audio acuan
      const refSrc = ctx.createBufferSource();
      refSrc.buffer = refBuffer;
      const refGain = ctx.createGain();
      refGain.gain.value = refTrackVolume;
      refSrc.connect(refGain);
      refGain.connect(ctx.destination);
      refSourceNodeRef.current = refSrc;
      refGainNodeRef.current = refGain;

      const startTime = ctx.currentTime + 0.15;
      refSrc.start(startTime);
      refSrc.onended = () => {
        finishPractice();
      };

      setIsPracticing(true);
      setCurrentPlaybackTime(0);

      const buf = new Float32Array(analyser.fftSize);
      micIntervalRef.current = window.setInterval(() => {
        if (!audioContextRef.current) return;
        const curTime = Math.max(0, audioContextRef.current.currentTime - startTime);
        setCurrentPlaybackTime(Math.min(refBuffer.duration, curTime));

        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setMicLevel(levelPct(rms));

        const pitch = detectPitch(buf, ctx.sampleRate, 65, 1100);
        const userFreq = pitch && pitch.clarity >= 0.75 ? pitch.freq : null;
        const clarity = pitch ? pitch.clarity : 0;

        userSingingHistoryRef.current.push({ t: curTime, freq: userFreq, clarity });

        const feedback = evaluateRealtimeMatch(curTime, userFreq, refProfile);
        setMatchFeedback(feedback);
      }, 50);

    } catch (err: any) {
      stopAllMedia();
      if (runKeyRef.current) gate?.refund('pitch_match', runKeyRef.current);
      setErrorMsg(err.name === 'NotAllowedError' ? 'Akses mikrofon ditolak. Izinkan mikrofon di browser.' : 'Gagal memulai mikrofon.');
    }
  };

  const finishPractice = async () => {
    if (!isPracticing) return;
    const ctx = audioContextRef.current;
    stopAllMedia();

    // Hitung evaluasi musikal
    if (refProfile && userSingingHistoryRef.current.length > 0) {
      const evalRes = evaluateVocalPerformance(userSingingHistoryRef.current, refProfile);
      setEvaluationResult(evalRes);
      onSuccessToast?.(`Latihan selesai! Skor keselarasan nada & tempo: ${evalRes.overallScore}%`);
    }

    // Dekode rekaman vokal jika ada
    if (recordedChunksRef.current.length > 0 && ctx) {
      try {
        const mime = mediaRecorderRef.current?.mimeType || 'audio/webm';
        const blob = new Blob(recordedChunksRef.current, { type: mime });
        const url = URL.createObjectURL(blob);
        setRecordedVocalUrl(url);

        const ab = await blob.arrayBuffer();
        const decoded = await ctx.decodeAudioData(ab);
        setRecordedVocalBuffer(decoded);
      } catch (e) {
        console.warn('Gagal decode vokal pengguna:', e);
      }
    }
  };

  // Pemutaran Hasil Latihan (Musik Acuan + Vokal Pengguna Bersamaan)
  const togglePlayReview = () => {
    if (isReviewPlaying) {
      stopReviewPlayback();
      return;
    }
    if (!refBuffer) return;

    try {
      const AudioContextClass = AudioCtx;
      const ctx = audioContextRef.current || new AudioContextClass();
      if (ctx.state === 'suspended') ctx.resume();
      audioContextRef.current = ctx;

      const refSrc = ctx.createBufferSource();
      refSrc.buffer = refBuffer;
      const refGain = ctx.createGain();
      refGain.gain.value = refTrackVolume;
      refSrc.connect(refGain);
      refGain.connect(ctx.destination);

      let vocalSrc: AudioBufferSourceNode | undefined;
      let vocalGain: GainNode | undefined;

      if (recordedVocalBuffer) {
        vocalSrc = ctx.createBufferSource();
        vocalSrc.buffer = recordedVocalBuffer;
        vocalGain = ctx.createGain();
        vocalGain.gain.value = playbackVocalVolume;
        vocalSrc.connect(vocalGain);
        vocalGain.connect(ctx.destination);
      }

      const startTime = ctx.currentTime + 0.05;
      refSrc.start(startTime);
      if (vocalSrc) vocalSrc.start(startTime);

      reviewSourcesRef.current = { refSource: refSrc, vocalSource: vocalSrc, refGain, vocalGain };
      reviewStartTimeRef.current = startTime;
      setIsReviewPlaying(true);

      const totalDur = Math.max(refBuffer.duration, recordedVocalBuffer?.duration || 0);

      const loop = () => {
        if (!audioContextRef.current) return;
        const cur = audioContextRef.current.currentTime - startTime;
        setReviewCurrentTime(Math.min(totalDur, Math.max(0, cur)));

        if (cur >= totalDur) {
          stopReviewPlayback();
          return;
        }
        rafReviewRef.current = requestAnimationFrame(loop);
      };
      rafReviewRef.current = requestAnimationFrame(loop);

      refSrc.onended = () => {
        if (!recordedVocalBuffer || refBuffer.duration >= recordedVocalBuffer.duration) {
          stopReviewPlayback();
        }
      };
    } catch (err) {
      stopReviewPlayback();
    }
  };

  const stopReviewPlayback = () => {
    if (rafReviewRef.current) cancelAnimationFrame(rafReviewRef.current);
    rafReviewRef.current = null;
    try {
      reviewSourcesRef.current.refSource?.stop();
      reviewSourcesRef.current.vocalSource?.stop();
    } catch {}
    reviewSourcesRef.current = {};
    setIsReviewPlaying(false);
  };

  // Unduh Berkas Rekaman Vokal
  const handleExportVocal = async () => {
    if (!recordedVocalBuffer || isExporting) return;
    setIsExporting(true);
    setExportProgress(10);
    try {
      const cleanName = `Vokal_Latihan_${(refFileName || 'Nyanyi').replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const res = await exportAudioFile(recordedVocalBuffer, cleanName, exportFmt, {
        mp3Kbps: 256,
        onProgress: (pct) => setExportProgress(Math.round(pct)),
      });
      onSuccessToast?.(`Rekaman vokal ${res.actualFormat} berhasil diunduh!`);
    } catch (err: any) {
      setErrorMsg('Gagal mengekspor rekaman vokal.');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleDownloadReport = () => {
    if (!evaluationResult) return;
    const lines = [
      '====================================================',
      '      PLAYMUZECK — LAPORAN LATIHAN NADA & VOKAL',
      '====================================================',
      `Tanggal          : ${new Date().toLocaleString('id-ID')}`,
      `Audio Acuan      : ${refFileName || 'Audio Pilihan'}`,
      `Durasi Nyanyi    : ${evaluationResult.totalSingingDurationSec} detik`,
      '',
      '--- EVALUASI SKOR MUSIKAL ---',
      `Skor Nada (Pitch) : ${evaluationResult.pitchScore}%`,
      `Skor Tempo/Ritme  : ${evaluationResult.timingScore}%`,
      `SKOR TOTAL        : ${evaluationResult.overallScore}%`,
      '',
      '--- AKURASI INTONASI ---',
      `Tepat Sempurna    : ${evaluationResult.perfectPercent}%`,
      `Cukup Tepat       : ${evaluationResult.goodPercent}%`,
      `Harmoni Oktaf     : ${evaluationResult.octaveMatchPercent}%`,
      `Meleset           : ${evaluationResult.missPercent}%`,
      `Deviasi Rata-rata : ${evaluationResult.avgCentsDeviation > 0 ? '+' : ''}${evaluationResult.avgCentsDeviation} cent`,
      `Kecenderungan     : ${evaluationResult.tendencyLabel}`,
      '',
      '--- CATATAN & SARAN PELATIH VOKAL ---',
      ...evaluationResult.musicalAdvice.map((a, i) => `${i + 1}. ${a}`),
      '',
      '====================================================',
    ];
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' }), `Laporan_Evaluasi_${refFileName.replace(/\.[^/.]+$/, '')}.txt`);
    onSuccessToast?.('Laporan evaluasi vokal berhasil diunduh.');
  };

  return (
    <div className={PANEL_CLS}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-accent" />
          <h4 className="text-sm font-bold text-white">Latihan Nada &amp; Vokal (Pitch &amp; Tempo Matcher)</h4>
          <InfoTip label="Info Latihan Vokal">
            <p>Unggah file lagu/vokal acuan, dengarkan lagunya sambil bernyanyi, dan sistem akan menilai kecocokan nada (pitch) serta tempo secara real-time dan terperinci.</p>
            <p>Gunakan headset atau earphone saat bernyanyi agar musik dari speaker tidak bocor masuk ke mikrofon.</p>
          </InfoTip>
        </div>
      </div>

      {/* Bagian 1: Pilih Audio Acuan */}
      <div className={`${CARD_CLS} space-y-3`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
            <Music className="w-4 h-4 text-accent" />
            1. Tentukan Lagu / Audio Acuan:
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {studioActiveTrack?.audioUrl && (
              <button
                type="button"
                onClick={handleLoadStudioActiveTrack}
                disabled={isAnalyzingRef || isPracticing}
                className="px-3 py-1.5 rounded-lg bg-accent/20 hover:bg-accent text-accent hover:text-on-accent text-xs font-bold transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Gunakan Trek Studio ({studioActiveTrack.title})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isAnalyzingRef || isPracticing}
              className={`${BTN_GHOST} px-3 py-1.5`}
            >
              <Upload className="w-3.5 h-3.5 text-accent" />
              <span>{refBuffer ? 'Ganti File Audio' : 'Unggah File Audio Acuan'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,.mp3,.wav,.m4a,.flac,.ogg"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        </div>

        {isAnalyzingRef && (
          <div className="space-y-1.5 pt-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                Mengekstrak melodi acuan &amp; tempo...
              </span>
              <span className="font-mono text-accent">{analysisProgress}%</span>
            </div>
            <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all duration-200" style={{ width: `${analysisProgress}%` }} />
            </div>
          </div>
        )}

        {refProfile && !isAnalyzingRef && (
          <div className="p-3 rounded-xl bg-black/60 border border-white/5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="space-y-0.5">
              <span className="font-bold text-white flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                {refFileName || 'Trek Acuan'} ({fmtClock(refProfile.duration)})
              </span>
              <p className="text-[11px] text-gray-400">
                {refProfile.notes.length} nada melodi terdeteksi • {refProfile.bpm ? `${refProfile.bpm} BPM` : 'Tempo bebas'} • {refProfile.keyName ? `Kunci: ${refProfile.keyName}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-400">Volume Musik Acuan:</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={refTrackVolume}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setRefTrackVolume(val);
                  if (refGainNodeRef.current) refGainNodeRef.current.gain.value = val;
                }}
                className={SLIDER_CLS}
                style={{ width: '80px' }}
              />
              <span className="font-mono text-accent w-8 text-right">{Math.round(refTrackVolume * 100)}%</span>
            </div>
          </div>
        )}
      </div>

      {/* Bagian 2: Layar Latihan & Live Comparison */}
      <div className={`${CARD_CLS} space-y-4`}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
            <Mic className="w-4 h-4 text-accent" />
            2. Mulai Bernyanyi &amp; Cocokkan Nada:
          </span>
          <div className="flex items-center gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
            <Headphones className="w-3.5 h-3.5 shrink-0" />
            <span>Disarankan memakai earphone/headset agar suara musik tidak masuk ke mikrofon.</span>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Layar Visual Real-Time Matcher */}
        <div className="p-5 rounded-2xl bg-black/60 border border-white/10 space-y-4 text-center">
          <div className="flex items-center justify-between text-xs text-gray-400 font-mono">
            <span>Posisi: {fmtClock(currentPlaybackTime)} / {refProfile ? fmtClock(refProfile.duration) : '0:00'}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">Input Mic:</span>
              <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div className={`h-full ${micLevel > 90 ? 'bg-red-400' : 'bg-accent'} transition-all duration-75`} style={{ width: `${micLevel}%` }} />
              </div>
            </div>
          </div>

          {/* Kotak Bandingan Nada Besar */}
          <div className="grid grid-cols-2 gap-4 max-w-md mx-auto items-center">
            {/* Target Nada Acuan */}
            <div className="p-4 rounded-xl bg-black/40 border border-accent/40 space-y-1">
              <span className="text-[10px] uppercase font-bold text-accent tracking-wider block">Target Nada Lagu</span>
              <div className="text-4xl font-black text-white font-mono">
                {matchFeedback?.refNoteName || '—'}
              </div>
              <span className="text-[11px] text-gray-400 block font-mono">
                {matchFeedback?.refFreq ? `${matchFeedback.refFreq.toFixed(1)} Hz` : 'Menunggu melodi...'}
              </span>
            </div>

            {/* Nada Vokal Pengguna */}
            <div className={`p-4 rounded-xl border space-y-1 transition-all ${
              matchFeedback?.status === 'perfect'
                ? 'bg-emerald-950/40 border-emerald-400 text-emerald-300'
                : matchFeedback?.status === 'good'
                ? 'bg-emerald-950/20 border-emerald-500/50 text-emerald-200'
                : matchFeedback?.status === 'octave'
                ? 'bg-blue-950/30 border-blue-400 text-blue-200'
                : matchFeedback?.status === 'near'
                ? 'bg-amber-950/30 border-amber-400 text-amber-200'
                : matchFeedback?.status === 'miss'
                ? 'bg-red-950/30 border-red-500 text-red-200'
                : 'bg-black/40 border-white/10 text-gray-400'
            }`}>
              <span className="text-[10px] uppercase font-bold tracking-wider block">Vokal Kamu</span>
              <div className="text-4xl font-black font-mono">
                {matchFeedback?.userNoteName || '—'}
              </div>
              <span className="text-[11px] block font-mono">
                {matchFeedback?.userFreq ? `${matchFeedback.userFreq.toFixed(1)} Hz` : 'Hening...'}
              </span>
            </div>
          </div>

          {/* Cents Gauge Meter (-50 cent s/d +50 cent) */}
          <div className="space-y-1.5 max-w-md mx-auto">
            <div className="flex justify-between text-[10px] font-mono text-gray-500">
              <span>-50c (Flat)</span>
              <span className="font-bold text-white">0 cent (Tepat)</span>
              <span>+50c (Sharp)</span>
            </div>
            <div className="relative h-3 rounded-full bg-white/10 overflow-hidden">
              <div className="absolute left-1/2 top-0 bottom-0 w-0.5 bg-white/40 z-10" />
              {matchFeedback?.userFreq && matchFeedback.hasReferenceNote && (
                <div
                  className={`absolute top-0 bottom-0 w-2.5 rounded-full transition-all duration-75 ${
                    matchFeedback.status === 'perfect' || matchFeedback.status === 'octave'
                      ? 'bg-emerald-400 shadow-[0_0_8px_#10B981]'
                      : matchFeedback.status === 'good'
                      ? 'bg-emerald-300'
                      : matchFeedback.status === 'near'
                      ? 'bg-amber-400'
                      : 'bg-red-500'
                  }`}
                  style={{
                    left: `calc(${50 + Math.max(-50, Math.min(50, matchFeedback.centsDiff))}% - 5px)`
                  }}
                />
              )}
            </div>
            <p className={`text-xs font-bold pt-1 ${
              matchFeedback?.status === 'perfect' ? 'text-emerald-400' :
              matchFeedback?.status === 'good' ? 'text-emerald-300' :
              matchFeedback?.status === 'octave' ? 'text-blue-300' :
              matchFeedback?.status === 'near' ? 'text-amber-300' :
              matchFeedback?.status === 'miss' ? 'text-red-400' : 'text-gray-400'
            }`}>
              {matchFeedback?.statusLabel || 'Siap untuk memulai latihan vokal'}
            </p>
          </div>

          {/* Tombol Aksi Mulai / Berhenti */}
          <div className="pt-2">
            {!isPracticing ? (
              <button
                type="button"
                onClick={startPractice}
                disabled={!refBuffer || isAnalyzingRef}
                className={`${BTN_PRIMARY} px-6 py-2.5 text-sm`}
              >
                <Play className="w-4 h-4 fill-on-accent" />
                <span>Mulai Bernyanyi &amp; Nilai Nada</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={finishPractice}
                className="px-6 py-2.5 rounded-xl bg-red-500 hover:bg-red-400 text-white font-black text-sm inline-flex items-center gap-2 cursor-pointer shadow-lg active:scale-95 transition-all"
              >
                <Square className="w-4 h-4 fill-white" />
                <span>Selesai &amp; Lihat Evaluasi</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bagian 3: Hasil Evaluasi Musikal & Putar Ulang */}
      {evaluationResult && (
        <div className={`${CARD_CLS} space-y-5 animate-in fade-in duration-300`}>
          <div className="flex items-center justify-between flex-wrap gap-2 border-b border-white/10 pb-3">
            <span className="text-sm font-black text-white flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              Hasil Evaluasi Musikal Latihan Kamu
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDownloadReport}
                className={`${BTN_GHOST} px-3 py-1.5`}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Unduh Laporan (.txt)</span>
              </button>
            </div>
          </div>

          {/* 3 Skor Utama */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="p-4 rounded-xl bg-black/50 border border-white/5 space-y-1">
              <span className="text-xs font-bold text-gray-400">Skor Ketepatan Nada</span>
              <div className="text-3xl font-black text-accent font-mono">{evaluationResult.pitchScore}%</div>
              <p className="text-[10px] text-gray-500">Persentase nada vokal pas dengan melodi</p>
            </div>

            <div className="p-4 rounded-xl bg-black/50 border border-white/5 space-y-1">
              <span className="text-xs font-bold text-gray-400">Skor Ketepatan Tempo</span>
              <div className="text-3xl font-black text-emerald-400 font-mono">{evaluationResult.timingScore}%</div>
              <p className="text-[10px] text-gray-500">Sinkronisasi ketukan &amp; durasi bernyanyi</p>
            </div>

            <div className="p-4 rounded-xl bg-black/50 border border-white/5 space-y-1">
              <span className="text-xs font-bold text-gray-400">Total Keselarasan</span>
              <div className="text-3xl font-black text-white font-mono">{evaluationResult.overallScore}%</div>
              <p className="text-[10px] text-gray-500">Kombinasi musikalitas pitch &amp; tempo</p>
            </div>
          </div>

          {/* Analisis Rinci */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2">
              <span className="font-bold text-gray-300 block">Distribusi Akurasi Nada:</span>
              <div className="space-y-1.5 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-emerald-300">Tepat Sempurna (&le;15 cent):</span>
                  <span>{evaluationResult.perfectPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-emerald-400/80">Cukup Tepat (16–30 cent):</span>
                  <span>{evaluationResult.goodPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-blue-300">Harmoni Oktaf:</span>
                  <span>{evaluationResult.octaveMatchPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-amber-300">Mendekati (31–50 cent):</span>
                  <span>{evaluationResult.nearPercent}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-red-300">Meleset / Salah Nada:</span>
                  <span>{evaluationResult.missPercent}%</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-2">
              <span className="font-bold text-gray-300 block">Kecenderungan Intonasi:</span>
              <p className="text-[11px] text-white font-medium">{evaluationResult.tendencyLabel}</p>
              <p className="text-[10px] text-gray-400 leading-relaxed">
                Rata-rata simpangan: <strong>{evaluationResult.avgCentsDeviation > 0 ? `+${evaluationResult.avgCentsDeviation}` : evaluationResult.avgCentsDeviation} cent</strong>.
                {evaluationResult.intonationTendency === 'flat' && ' Kamu cenderung sedikit kerendahan. Jaga energi pernapasan tetap stabil.'}
                {evaluationResult.intonationTendency === 'sharp' && ' Kamu cenderung sedikit ketinggian. Usahakan rileks dan jangan menekan vokal.'}
                {evaluationResult.intonationTendency === 'balanced' && ' Intonasi vokalmu terpusat dengan sangat seimbang.'}
              </p>
              {evaluationResult.matchedNoteNames.length > 0 && (
                <div className="pt-1">
                  <span className="text-[10px] text-gray-400 block mb-1">Nada yang berhasil dikuasai:</span>
                  <div className="flex flex-wrap gap-1">
                    {evaluationResult.matchedNoteNames.map((n) => (
                      <span key={n} className="px-1.5 py-0.5 rounded bg-white/10 text-accent font-mono text-[10px] font-bold">
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Saran Musikal */}
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 space-y-1.5 text-xs">
            <span className="font-bold text-accent flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Saran Perbaikan Pelatih Vokal:
            </span>
            <ul className="space-y-1 text-gray-300 text-[11px] pl-4 list-disc">
              {evaluationResult.musicalAdvice.map((adv, i) => (
                <li key={i}>{adv}</li>
              ))}
            </ul>
          </div>

          {/* Putar Ulang Rekaman & Fader Musik vs Vokal */}
          <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <span className="font-bold text-white flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-accent" />
                Dengarkan Hasil Rekaman Latihanmu Bersama Musik:
              </span>
              <button
                type="button"
                onClick={togglePlayReview}
                className={`${BTN_PRIMARY} px-4 py-1.5`}
              >
                {isReviewPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{isReviewPlaying ? 'Jeda Playback' : 'Putar Musik + Vokal Kamu'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>Volume Musik Acuan:</span>
                  <span className="font-mono text-white">{Math.round(refTrackVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={refTrackVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setRefTrackVolume(val);
                    if (reviewSourcesRef.current.refGain) reviewSourcesRef.current.refGain.gain.value = val;
                  }}
                  className={SLIDER_CLS}
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-gray-400">
                  <span>Volume Vokal Kamu:</span>
                  <span className="font-mono text-white">{Math.round(playbackVocalVolume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1.5"
                  step="0.05"
                  value={playbackVocalVolume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setPlaybackVocalVolume(val);
                    if (reviewSourcesRef.current.vocalGain) reviewSourcesRef.current.vocalGain.gain.value = val;
                  }}
                  className={SLIDER_CLS}
                />
              </div>
            </div>
          </div>

          {/* Unduh Rekaman Vokal Saja */}
          {recordedVocalBuffer && (
            <div className="pt-2 border-t border-white/5 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
                <span className="text-gray-300 font-bold flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  Unduh Berkas Vokal Rekaman Latihan:
                </span>
                <div className="flex items-center gap-1">
                  {(['MP3', 'WAV', 'M4A', 'FLAC'] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setExportFmt(fmt)}
                      className={pillCls(exportFmt === fmt)}
                    >
                      {fmt}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={handleExportVocal}
                    disabled={isExporting}
                    className={`${BTN_DOWNLOAD} ml-2`}
                  >
                    {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
                    <span>{isExporting ? `Mengekspor ${exportProgress}%` : `Unduh Vokal .${exportFmt}`}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
