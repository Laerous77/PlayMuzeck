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
  Sparkles,
  Mic2,
  Upload,
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
} from 'lucide-react';
import { AudioEntitlements } from '../../types';
import {
  exportAudioFile,
  audioBufferToWav,
  encodeCompressedAudio,
  downloadBlob,
  type CompressedAudioResult,
} from '../../services/exporters';

interface AudioToolsSuiteProps {
  entitlements: AudioEntitlements;
  onUnlockEditor: () => void;
  onSuccessToast: (msg: string) => void;
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

interface ToolConfig {
  id: ToolType;
  name: string;
  desc: string;
  icon: React.ElementType;
  isAi: boolean;
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
    vocal: AudioBuffer | null;
    instrumental: AudioBuffer | null;
  };
}

const TOOLS: ToolConfig[] = [
  { id: 'trim', name: 'Trim / Cut', desc: 'Potong audio dengan menentukan batas awal & akhir (input manual)', icon: Scissors, isAi: false },
  { id: 'volume', name: 'Volume / Gain', desc: 'Atur penguatan gain dinamis tanpa tombol apply', icon: Volume2, isAi: false },
  { id: 'pitch', name: 'Pitch / Transpose', desc: 'Ubah nada dinamis dengan opsi Kunci Tempo', icon: Sliders, isAi: false },
  { id: 'tempo', name: 'Tempo / Speed', desc: 'Ubah kecepatan secara dinamis tanpa mengubah nada', icon: FastForward, isAi: false },
  { id: 'reverse', name: 'Reverse', desc: 'Balikkan urutan sampel audio untuk efek transisi', icon: RotateCcw, isAi: false },
  { id: 'convert', name: 'Convert', desc: 'Konversi Audio-ke-Audio & Ekstrak Video-ke-Audio', icon: RefreshCw, isAi: false },
  { id: 'compress', name: 'Compress', desc: '5 tingkatan kompresi ukuran & bitrate nyata', icon: Minimize2, isAi: false },
  { id: 'noise_reduction', name: 'AI Noise Reduction', desc: 'Pembersih desis & dengung latar berbasis Spectral Gate', icon: Sparkles, isAi: true },
  { id: 'vocal_separator', name: 'AI Vocal Separator', desc: 'Ekstraksi vokal, musik, atau keduanya (Center-Phase AI)', icon: Mic2, isAi: true },
];

function getAdaptiveCompressTiers(sourceKbps: number): CompressTier[] {
  const base = Math.max(64, sourceKbps || 128);
  const vlBitrate = Math.max(96, Math.min(112, Math.round(base * 0.88)));
  const lBitrate = Math.max(80, Math.min(92, Math.round(base * 0.74)));
  const bBitrate = Math.max(48, Math.min(64, Math.round(base * 0.50)));
  const hBitrate = Math.max(36, Math.min(44, Math.round(base * 0.35)));
  const mBitrate = Math.max(24, Math.min(28, Math.round(base * 0.22)));

  return [
    { id: 'very_light', name: 'Very Light', bitrate: vlBitrate, targetRate: 32000, label: `${vlBitrate} kbps (Stereo)`, desc: 'Kompresi ringan (estimasi ~3,7 MB)', isMono: false },
    { id: 'light', name: 'Light', bitrate: lBitrate, targetRate: 28000, label: `${lBitrate} kbps (Stereo)`, desc: 'Kualitas siaran (estimasi ~3,1 MB)', isMono: false },
    { id: 'balanced', name: 'Balanced', bitrate: bBitrate, targetRate: 22050, label: `${bBitrate} kbps (Mono)`, desc: 'Standar streaming (estimasi ~2,1 MB)', isMono: true },
    { id: 'high', name: 'High', bitrate: hBitrate, targetRate: 16000, label: `${hBitrate} kbps (Mono)`, desc: 'Kompresi tinggi (estimasi ~1,5 MB)', isMono: true },
    { id: 'maximum', name: 'Maximum', bitrate: mBitrate, targetRate: 12000, label: `${mBitrate} kbps (Mono)`, desc: 'Ukuran file terkecil (estimasi ~1,0 MB)', isMono: true },
  ];
}

function timeStretchWSOLA(inputBuf: AudioBuffer, speed: number): AudioBuffer {
  if (Math.abs(speed - 1.0) < 0.01) return inputBuf;
  const sampleRate = inputBuf.sampleRate;
  const numChannels = inputBuf.numberOfChannels;
  const inputLen = inputBuf.length;
  const outputLen = Math.max(1, Math.floor(inputLen / speed));

  const outputBuf = new AudioBuffer({ length: outputLen, numberOfChannels: numChannels, sampleRate });
  const windowSize = Math.floor(sampleRate * 0.04);
  const hopIn = Math.floor(windowSize * 0.5);
  const hopOut = Math.floor(hopIn / speed);

  for (let c = 0; c < numChannels; c++) {
    const src = inputBuf.getChannelData(c);
    const dest = outputBuf.getChannelData(c);
    let inPos = 0;
    let outPos = 0;

    while (outPos + windowSize < outputLen && inPos + windowSize < inputLen) {
      for (let i = 0; i < windowSize; i++) {
        const weight = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
        dest[outPos + i] += src[inPos + i] * weight;
      }
      inPos += hopIn;
      outPos += hopOut;
    }
  }

  return outputBuf;
}

class GranularPitchShifter {
  private ctx: AudioContext;
  private buffer: AudioBuffer;
  private pitchRatio = 1;
  private readonly grainSize = 0.12;
  private readonly overlap = 0.5;
  private playing = false;
  private schedulerId: number | null = null;
  private position = 0;
  private outputGain: GainNode;
  private onEndedCb?: () => void;

  constructor(ctx: AudioContext, buffer: AudioBuffer) {
    this.ctx = ctx;
    this.buffer = buffer;
    this.outputGain = ctx.createGain();
    this.outputGain.gain.value = 1;
    this.outputGain.connect(ctx.destination);
  }

  setPitchRatio(ratio: number) {
    this.pitchRatio = Math.max(0.25, Math.min(4, ratio));
  }

  start(fromSec = 0) {
    this.position = Math.max(0, fromSec);
    this.playing = true;
    const hopMs = this.grainSize * (1 - this.overlap) * 1000;
    this.scheduleGrain(this.position);
    this.schedulerId = window.setInterval(() => {
      if (!this.playing) return;
      this.position += this.grainSize * (1 - this.overlap);
      if (this.position >= this.buffer.duration) {
        this.stop();
        this.onEndedCb?.();
        return;
      }
      this.scheduleGrain(this.position);
    }, hopMs);
  }

  stop() {
    this.playing = false;
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
  }

  setOnEnded(cb: () => void) {
    this.onEndedCb = cb;
  }

  private scheduleGrain(readPos: number) {
    const now = this.ctx.currentTime;
    const dur = this.grainSize;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = this.pitchRatio;

    const grainGain = this.ctx.createGain();
    grainGain.gain.setValueAtTime(0, now);
    grainGain.gain.linearRampToValueAtTime(1, now + dur * 0.25);
    grainGain.gain.setValueAtTime(1, now + dur * 0.75);
    grainGain.gain.linearRampToValueAtTime(0, now + dur);

    src.connect(grainGain);
    grainGain.connect(this.outputGain);

    const offset = Math.min(readPos, Math.max(0, this.buffer.duration - 0.02));
    const playableDur = Math.max(0.02, Math.min(dur * this.pitchRatio, this.buffer.duration - offset));

    try {
      src.start(now, offset, playableDur);
      src.stop(now + dur + 0.05);
    } catch {}
  }
}

const STATIC_RESULT_TOOLS: ToolType[] = [
  'trim',
  'reverse',
  'convert',
  'compress',
  'noise_reduction',
  'vocal_separator',
];

const INITIAL_TOOL_STATE: ToolExecutionState = {
  isProcessing: false,
  progress: 0,
  resultBuffer: null,
  previewUrl: null,
  expiresAt: null,
};

export const AudioToolsSuite: React.FC<AudioToolsSuiteProps> = ({
  entitlements,
  onUnlockEditor,
  onSuccessToast,
}) => {
  // Kepemilikan Resmi Produk Audio Tools Suite
  const isToolsOwned = Boolean(entitlements?.audioToolsSuite);

  const [selectedTool, setSelectedTool] = useState<ToolType>('trim');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [decodedBuffer, setDecodedBuffer] = useState<AudioBuffer | null>(null);

  const [toolStates, setToolStates] = useState<Record<ToolType, ToolExecutionState>>({
    trim: { ...INITIAL_TOOL_STATE },
    volume: { ...INITIAL_TOOL_STATE },
    pitch: { ...INITIAL_TOOL_STATE },
    tempo: { ...INITIAL_TOOL_STATE },
    reverse: { ...INITIAL_TOOL_STATE },
    convert: { ...INITIAL_TOOL_STATE },
    compress: { ...INITIAL_TOOL_STATE },
    noise_reduction: { ...INITIAL_TOOL_STATE },
    vocal_separator: { ...INITIAL_TOOL_STATE },
  });

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedExportFormat, setSelectedExportFormat] = useState<ExportAudioFormat>('MP3');
  const [isEncodingCompressed, setIsEncodingCompressed] = useState<boolean>(false);
  const [compressEncodeProgress, setCompressEncodeProgress] = useState<number>(0);

  // Parameter masing-masing alat
  const [trimStart, setTrimStart] = useState<number>(0);
  const [trimEnd, setTrimEnd] = useState<number>(10);
  const [dynamicGainDb, setDynamicGainDb] = useState<number>(0);
  const [dynamicPitchSemitones, setDynamicPitchSemitones] = useState<number>(0);
  const [keepTempoOnPitch, setKeepTempoOnPitch] = useState<boolean>(true);
  const [dynamicTempoSpeed, setDynamicTempoSpeed] = useState<number>(1.0);
  const [convertSourceMode, setConvertSourceMode] = useState<'audio' | 'video'>('audio');
  const [selectedCompressTier, setSelectedCompressTier] = useState<string>('balanced');
  const [aiNoiseAggression, setAiNoiseAggression] = useState<number>(75);
  const [vocalExtractTarget, setVocalExtractTarget] = useState<'vocal' | 'instrumental' | 'both'>('both');

  // Kuota Harian 2x Per Hari Per Tool (Tersimpan di localStorage dengan tanggal)
  const getTodayQuotaKey = () => `muzeck_daily_quota_${new Date().toISOString().slice(0, 10)}`;

  const [quotaMap, setQuotaMap] = useState<Record<ToolType, number>>(() => {
    try {
      const stored = localStorage.getItem(getTodayQuotaKey());
      if (stored) return JSON.parse(stored);
    } catch {}
    const initialQuota: any = {};
    TOOLS.forEach((t) => (initialQuota[t.id] = 2));
    return initialQuota;
  });

  const currentToolQuota = isToolsOwned ? Infinity : (quotaMap[selectedTool] ?? 2);

  const deductQuota = () => {
    if (isToolsOwned) return true;
    const current = quotaMap[selectedTool] ?? 2;
    if (current <= 0) return false;

    const updated = { ...quotaMap, [selectedTool]: current - 1 };
    setQuotaMap(updated);
    try {
      localStorage.setItem(getTodayQuotaKey(), JSON.stringify(updated));
    } catch {}
    return true;
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const mediaSourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const granularShifterRef = useRef<GranularPitchShifter | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  const estimatedSourceBitrate = useMemo(() => {
    if (audioFile && decodedBuffer && decodedBuffer.duration > 0) {
      return Math.round((audioFile.size * 8) / decodedBuffer.duration / 1000);
    }
    return 128;
  }, [audioFile, decodedBuffer]);

  const compressTiers = useMemo(() => {
    return getAdaptiveCompressTiers(estimatedSourceBitrate);
  }, [estimatedSourceBitrate]);

  const isGranularPitchMode = selectedTool === 'pitch' && keepTempoOnPitch;

  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  }, []);

  const setupGainNode = useCallback(() => {
    const ctx = getAudioContext();
    if (!mediaSourceNodeRef.current && audioElementRef.current) {
      try {
        const source = ctx.createMediaElementSource(audioElementRef.current);
        const gain = ctx.createGain();
        source.connect(gain);
        gain.connect(ctx.destination);
        mediaSourceNodeRef.current = source;
        gainNodeRef.current = gain;
      } catch (err) {
        console.warn('Media element source sudah terpasang:', err);
      }
    }
  }, [getAudioContext]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setToolStates((prev) => {
        let changed = false;
        const next = { ...prev };
        (Object.keys(next) as ToolType[]).forEach((t) => {
          if (next[t].expiresAt && now > next[t].expiresAt!) {
            if (next[t].previewUrl) URL.revokeObjectURL(next[t].previewUrl!);
            next[t] = { ...INITIAL_TOOL_STATE };
            changed = true;
          }
        });
        return changed ? next : prev;
      });
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      Object.values(toolStates).forEach((s) => {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
      });
    };
  }, [audioUrl]);

  const currentToolState = toolStates[selectedTool];
  const activeAudioSrc =
    STATIC_RESULT_TOOLS.includes(selectedTool) && currentToolState.previewUrl
      ? currentToolState.previewUrl
      : audioUrl;

  useEffect(() => {
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      audioElementRef.current.load();
    }
    setIsPlaying(false);
  }, [activeAudioSrc, selectedTool]);

  useEffect(() => {
    setupGainNode();
    if (gainNodeRef.current) {
      if (selectedTool === 'volume') {
        gainNodeRef.current.gain.value = Math.pow(10, dynamicGainDb / 20);
      } else {
        gainNodeRef.current.gain.value = 1.0;
      }
    }
  }, [selectedTool, dynamicGainDb, setupGainNode]);

  useEffect(() => {
    if (!audioElementRef.current) return;
    const audio = audioElementRef.current;

    if (selectedTool === 'tempo') {
      audio.playbackRate = dynamicTempoSpeed;
      audio.preservesPitch = true;
      (audio as any).webkitPreservesPitch = true;
    } else if (selectedTool === 'pitch') {
      if (keepTempoOnPitch) {
        audio.playbackRate = 1.0;
        audio.preservesPitch = true;
      } else {
        const pitchSpeed = Math.pow(2, dynamicPitchSemitones / 12);
        audio.playbackRate = pitchSpeed;
        audio.preservesPitch = false;
        (audio as any).webkitPreservesPitch = false;
      }
    } else {
      audio.playbackRate = 1.0;
      audio.preservesPitch = true;
    }
  }, [selectedTool, dynamicPitchSemitones, keepTempoOnPitch, dynamicTempoSpeed]);

  useEffect(() => {
    if (isGranularPitchMode && granularShifterRef.current) {
      granularShifterRef.current.setPitchRatio(Math.pow(2, dynamicPitchSemitones / 12));
    }
  }, [dynamicPitchSemitones, isGranularPitchMode]);

  const handleTimeUpdate = () => {
    if (!audioElementRef.current) return;
    const cur = audioElementRef.current.currentTime;

    if (selectedTool === 'trim' && !currentToolState.resultBuffer) {
      if (cur < trimStart || cur >= trimEnd) {
        audioElementRef.current.currentTime = trimStart;
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAudioFile(file);
    const newUrl = URL.createObjectURL(file);
    setAudioUrl(newUrl);

    setToolStates({
      trim: { ...INITIAL_TOOL_STATE },
      volume: { ...INITIAL_TOOL_STATE },
      pitch: { ...INITIAL_TOOL_STATE },
      tempo: { ...INITIAL_TOOL_STATE },
      reverse: { ...INITIAL_TOOL_STATE },
      convert: { ...INITIAL_TOOL_STATE },
      compress: { ...INITIAL_TOOL_STATE },
      noise_reduction: { ...INITIAL_TOOL_STATE },
      vocal_separator: { ...INITIAL_TOOL_STATE },
    });
    stopPlayback();

    try {
      const ctx = getAudioContext();
      const arrayBuf = await file.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuf);
      setDecodedBuffer(decoded);
      setTrimStart(0);
      setTrimEnd(Math.max(1, Math.min(60, Math.floor(decoded.duration))));
      onSuccessToast(`Berkas "${file.name}" berhasil dimuat.`);
    } catch {
      alert('Gagal membaca berkas media. Pastikan format file didukung browser.');
    }
  };

  const stopPlayback = () => {
    granularShifterRef.current?.stop();
    granularShifterRef.current = null;
    if (audioElementRef.current) {
      audioElementRef.current.pause();
      if (selectedTool === 'trim' && !currentToolState.resultBuffer) {
        audioElementRef.current.currentTime = trimStart;
      } else {
        audioElementRef.current.currentTime = 0;
      }
    }
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    setupGainNode();
    if (isGranularPitchMode) {
      if (!decodedBuffer) return;
      if (isPlaying) {
        stopPlayback();
        return;
      }
      const ctx = getAudioContext();
      const shifter = new GranularPitchShifter(ctx, decodedBuffer);
      shifter.setPitchRatio(Math.pow(2, dynamicPitchSemitones / 12));
      shifter.setOnEnded(() => setIsPlaying(false));
      granularShifterRef.current = shifter;
      shifter.start(0);
      setIsPlaying(true);
      return;
    }

    if (!audioElementRef.current) return;
    if (isPlaying) {
      stopPlayback();
    } else {
      if (selectedTool === 'trim' && !currentToolState.resultBuffer) {
        const cur = audioElementRef.current.currentTime;
        if (cur < trimStart || cur >= trimEnd) {
          audioElementRef.current.currentTime = trimStart;
        }
      }
      audioElementRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const handleClearToolResult = (toolToClear: ToolType) => {
    stopPlayback();
    const targetState = toolStates[toolToClear];
    if (targetState.previewUrl) {
      URL.revokeObjectURL(targetState.previewUrl);
    }
    setToolStates((prev) => ({
      ...prev,
      [toolToClear]: { ...INITIAL_TOOL_STATE },
    }));
    onSuccessToast(`Hasil ${TOOLS.find((t) => t.id === toolToClear)?.name} berhasil dihapus.`);
  };

  const executeProcessForTool = async (targetTool: ToolType, customTier?: string) => {
    if (!decodedBuffer) {
      fileInputRef.current?.click();
      return;
    }

    // Pengecekan Kuota Harian Ketat: Tolak jika kuota habis dan belum beli
    if (!isToolsOwned && currentToolQuota <= 0) {
      onUnlockEditor();
      return;
    }

    setToolStates((prev) => ({
      ...prev,
      [targetTool]: {
        ...prev[targetTool],
        isProcessing: true,
        progress: 25,
      },
    }));

    try {
      const sampleRate = decodedBuffer.sampleRate;
      const channels = decodedBuffer.numberOfChannels;
      let outputBuffer: AudioBuffer | null = null;
      let vocalOutputs: any = null;

      if (targetTool === 'trim') {
        const startSec = Math.max(0, Math.min(trimStart, decodedBuffer.duration - 0.1));
        const endSec = Math.min(decodedBuffer.duration, Math.max(startSec + 0.1, trimEnd));
        const startSample = Math.floor(startSec * sampleRate);
        const endSample = Math.floor(endSec * sampleRate);
        const frameCount = Math.max(1, endSample - startSample);

        outputBuffer = new AudioBuffer({ length: frameCount, numberOfChannels: channels, sampleRate });
        for (let c = 0; c < channels; c++) {
          outputBuffer.copyToChannel(decodedBuffer.getChannelData(c).slice(startSample, endSample), c);
        }
      } else if (targetTool === 'reverse') {
        outputBuffer = new AudioBuffer({ length: decodedBuffer.length, numberOfChannels: channels, sampleRate });
        for (let c = 0; c < channels; c++) {
          const orig = decodedBuffer.getChannelData(c);
          const rev = new Float32Array(orig.length);
          for (let i = 0, j = orig.length - 1; i < orig.length; i++, j--) {
            rev[i] = orig[j];
          }
          outputBuffer.copyToChannel(rev, c);
        }
      } else if (targetTool === 'convert') {
        outputBuffer = decodedBuffer;
      } else if (targetTool === 'compress') {
        const activeTierKey = customTier || selectedCompressTier;
        const tier = compressTiers.find((t) => t.id === activeTierKey) || compressTiers[2];
        const targetRate = tier.targetRate;
        const outChannels = tier.isMono ? 1 : Math.min(2, channels);

        const targetLength = Math.max(1, Math.floor((decodedBuffer.length * targetRate) / sampleRate));
        const offline = new OfflineAudioContext(outChannels, targetLength, targetRate);
        const src = offline.createBufferSource();

        if (tier.isMono && channels >= 2) {
          const monoBuf = offline.createBuffer(1, decodedBuffer.length, sampleRate);
          const monoData = monoBuf.getChannelData(0);
          const left = decodedBuffer.getChannelData(0);
          const right = decodedBuffer.getChannelData(1);
          for (let i = 0; i < decodedBuffer.length; i++) {
            monoData[i] = (left[i] + right[i]) * 0.5;
          }
          src.buffer = monoBuf;
        } else {
          src.buffer = decodedBuffer;
        }

        const comp = offline.createDynamicsCompressor();
        comp.threshold.value = tier.bitrate <= 48 ? -20 : -14;
        comp.ratio.value = tier.bitrate <= 48 ? 6 : 3;
        comp.attack.value = 0.003;
        comp.release.value = 0.15;

        src.connect(comp);
        comp.connect(offline.destination);
        src.start(0);

        outputBuffer = await offline.startRendering();
      } else if (targetTool === 'noise_reduction') {
        const offline = new OfflineAudioContext(channels, decodedBuffer.length, sampleRate);
        const src = offline.createBufferSource();
        src.buffer = decodedBuffer;

        const highpass = offline.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 75 + aiNoiseAggression * 0.8;

        const lowpass = offline.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 15000 - aiNoiseAggression * 50;

        src.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(offline.destination);
        src.start(0);

        const cleaned = await offline.startRendering();
        const threshold = (aiNoiseAggression / 100) * 0.02 + 0.002;
        const floorGain = Math.max(0.02, 0.3 - (aiNoiseAggression / 100) * 0.28);
        const attackCoef = 0.4;
        const releaseCoef = 0.01;
        const gainSmoothing = 0.05;

        for (let c = 0; c < channels; c++) {
          const data = cleaned.getChannelData(c);
          let envelope = 0;
          let currentGain = 1;
          for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]);
            envelope = abs > envelope ? envelope + (abs - envelope) * attackCoef : envelope + (abs - envelope) * releaseCoef;
            const targetGain = envelope < threshold ? floorGain : 1;
            currentGain += (targetGain - currentGain) * gainSmoothing;
            data[i] *= currentGain;
          }
        }
        outputBuffer = cleaned;
      } else if (targetTool === 'vocal_separator') {
        if (channels < 2) {
          alert('Audio stereo (2 kanal) dibutuhkan untuk ekstraksi vokal.');
          setToolStates((prev) => ({ ...prev, [targetTool]: { ...prev[targetTool], isProcessing: false } }));
          return;
        }

        const left = decodedBuffer.getChannelData(0);
        const right = decodedBuffer.getChannelData(1);

        const vocalBuf = new AudioBuffer({ length: decodedBuffer.length, numberOfChannels: 2, sampleRate });
        const instBuf = new AudioBuffer({ length: decodedBuffer.length, numberOfChannels: 2, sampleRate });

        const vocL = new Float32Array(left.length);
        const vocR = new Float32Array(right.length);
        const instL = new Float32Array(left.length);
        const instR = new Float32Array(right.length);

        for (let i = 0; i < left.length; i++) {
          const mid = (left[i] + right[i]) * 0.5;
          const side = (left[i] - right[i]) * 0.5;
          vocL[i] = mid * 0.9;
          vocR[i] = mid * 0.9;
          instL[i] = side * 1.2;
          instR[i] = -side * 1.2;
        }

        vocalBuf.copyToChannel(vocL, 0);
        vocalBuf.copyToChannel(vocR, 1);
        instBuf.copyToChannel(instL, 0);
        instBuf.copyToChannel(instR, 1);

        vocalOutputs = { vocal: vocalBuf, instrumental: instBuf };

        if (vocalExtractTarget === 'vocal') outputBuffer = vocalBuf;
        else if (vocalExtractTarget === 'instrumental') outputBuffer = instBuf;
        else outputBuffer = vocalBuf;
      }

      if (outputBuffer) {
        // Kurangi kuota harian tepat 1 kali saat proses berhasil
        deductQuota();

        const previewBlob = audioBufferToWav(outputBuffer, 16);
        const pUrl = URL.createObjectURL(previewBlob);

        setToolStates((prev) => ({
          ...prev,
          [targetTool]: {
            isProcessing: false,
            progress: 100,
            resultBuffer: outputBuffer,
            previewUrl: pUrl,
            expiresAt: Date.now() + 5 * 60 * 1000,
            vocalBuffers: vocalOutputs || undefined,
          },
        }));
        onSuccessToast(`${TOOLS.find((t) => t.id === targetTool)?.name} selesai diproses.`);
      }
    } catch (err) {
      console.error(err);
      alert('Pemrosesan audio gagal.');
      setToolStates((prev) => ({
        ...prev,
        [targetTool]: { ...prev[targetTool], isProcessing: false, progress: 0 },
      }));
    }
  };

  const handleCompressTierChange = (newTierId: string) => {
    setSelectedCompressTier(newTierId);
    if (toolStates.compress.previewUrl) {
      URL.revokeObjectURL(toolStates.compress.previewUrl);
    }
    setToolStates((prev) => ({
      ...prev,
      compress: { ...INITIAL_TOOL_STATE },
    }));

    if (decodedBuffer) {
      executeProcessForTool('compress', newTierId);
    }
  };

  const handleDownloadFile = async (customBuffer?: AudioBuffer, suffix?: string) => {
    if (!isToolsOwned && currentToolQuota <= 0) {
      onUnlockEditor();
      return;
    }

    const baseName = (audioFile?.name.replace(/\.[^/.]+$/, '') || 'audio').trim();

    if (selectedTool === 'compress' && currentToolState.resultBuffer) {
      const tier = compressTiers.find((t) => t.id === selectedCompressTier) || compressTiers[2];

      if (selectedExportFormat === 'WAV') {
        await exportAudioFile(currentToolState.resultBuffer, `${baseName}_compressed_${tier.id}`, 'WAV');
        onSuccessToast(`Berkas kompresi WAV (${tier.label}) berhasil diunduh.`);
        return;
      }

      setIsEncodingCompressed(true);
      setCompressEncodeProgress(0);
      try {
        const result: CompressedAudioResult = await encodeCompressedAudio(
          currentToolState.resultBuffer,
          tier.bitrate,
          (pct) => setCompressEncodeProgress(pct)
        );
        const cleanName = `${baseName}_compressed_${tier.id}`.replace(/[^\w\s.-]/gi, '').trim();
        downloadBlob(result.blob, `${cleanName}.${selectedExportFormat.toLowerCase()}`);
        onSuccessToast(`Berkas berhasil dikompresi nyata (${tier.label}, .${selectedExportFormat.toLowerCase()}).`);
      } catch {
        alert('Gagal mengompres berkas. Pastikan browser mendukung AudioEncoder.');
      } finally {
        setIsEncodingCompressed(false);
        setCompressEncodeProgress(0);
      }
      return;
    }

    let bufToExport = customBuffer || currentToolState.resultBuffer;

    if (selectedTool === 'volume' && decodedBuffer && !customBuffer) {
      const offline = new OfflineAudioContext(decodedBuffer.numberOfChannels, decodedBuffer.length, decodedBuffer.sampleRate);
      const src = offline.createBufferSource();
      src.buffer = decodedBuffer;
      const gain = offline.createGain();
      gain.gain.value = Math.pow(10, dynamicGainDb / 20);
      src.connect(gain);
      gain.connect(offline.destination);
      src.start(0);
      bufToExport = await offline.startRendering();
      deductQuota();
    }

    if (selectedTool === 'pitch' && decodedBuffer && !customBuffer) {
      const pitchRatio = Math.pow(2, dynamicPitchSemitones / 12);
      const resampledLen = Math.max(1, Math.floor(decodedBuffer.length / pitchRatio));
      const offline = new OfflineAudioContext(decodedBuffer.numberOfChannels, resampledLen, decodedBuffer.sampleRate);
      const src = offline.createBufferSource();
      src.buffer = decodedBuffer;
      src.playbackRate.value = pitchRatio;
      src.connect(offline.destination);
      src.start(0);
      const pitchOnly = await offline.startRendering();
      bufToExport = keepTempoOnPitch ? timeStretchWSOLA(pitchOnly, 1 / pitchRatio) : pitchOnly;
      deductQuota();
    }

    if (selectedTool === 'tempo' && decodedBuffer && !customBuffer) {
      bufToExport = timeStretchWSOLA(decodedBuffer, dynamicTempoSpeed);
      deductQuota();
    }

    const finalBuf = bufToExport || decodedBuffer;
    if (!finalBuf) return;

    const fileName = `${baseName}_${suffix || selectedTool}`;
    await exportAudioFile(finalBuf, fileName, selectedExportFormat);
    onSuccessToast(`Berkas ${selectedExportFormat} berhasil diunduh.`);
  };

  const handleTrimHandleDrag = (which: 'start' | 'end') => (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const duration = decodedBuffer?.duration || 60;

    const updateFromClientX = (clientX: number) => {
      const track = timelineRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const timeAtPos = ratio * duration;

      if (which === 'start') {
        const val = Math.max(0, Math.min(timeAtPos, trimEnd - 0.1));
        setTrimStart(val);
        if (audioElementRef.current) audioElementRef.current.currentTime = val;
      } else {
        const val = Math.min(duration, Math.max(timeAtPos, trimStart + 0.1));
        setTrimEnd(val);
      }
    };

    const onMove = (moveEvent: PointerEvent) => updateFromClientX(moveEvent.clientX);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const totalDuration = decodedBuffer?.duration || 60;
  const startPercent = Math.min(100, Math.max(0, (trimStart / totalDuration) * 100));
  const endPercent = Math.min(100, Math.max(0, (trimEnd / totalDuration) * 100));

  return (
    <section id="audio-tools-section" className="w-full">
      <div className="rounded-2xl bg-[#14213D] border border-white/[0.08] p-5 sm:p-7 shadow-xl space-y-6">
        
        {audioUrl && (
          <audio
            ref={audioElementRef}
            src={activeAudioSrc || undefined}
            onTimeUpdate={handleTimeUpdate}
            onEnded={() => setIsPlaying(false)}
            className="hidden"
          />
        )}

        {/* Header Seksi & Status Kuota */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#FCA311]" />
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Audio Processing & AI Tools Suite
              </h3>
            </div>
            <p className="text-xs text-gray-300">
              9 utilitas studio untuk pemotongan, manipulasi pitch, mastering gain, serta reduksi noise dan pemisahan vokal AI.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Status Kepemilikan / Kuota Harian */}
            {isToolsOwned ? (
              <span className="text-emerald-400 bg-emerald-500/10 px-3 py-1.5 rounded-xl border border-emerald-500/20 text-xs font-bold flex items-center gap-1.5">
                <CheckCircle className="w-3.5 h-3.5" /> Sudah Dimiliki
              </span>
            ) : currentToolQuota > 0 ? (
              <span className="text-amber-300 bg-amber-500/10 px-3 py-1.5 rounded-xl border border-amber-500/20 text-xs font-bold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-[#FCA311]" />
                {currentToolQuota === 2 ? '2 penggunaan gratis hari ini' : '1 penggunaan gratis tersisa'}
              </span>
            ) : (
              <button
                type="button"
                onClick={onUnlockEditor}
                className="px-3.5 py-1.5 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md"
              >
                <Lock className="w-3.5 h-3.5" /> Beli Audio Tools — Rp20.000
              </button>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl bg-black/50 hover:bg-black/80 border border-white/10 text-xs font-bold text-gray-200 flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-[#FCA311]" />
              <span>{audioFile ? 'Ganti Berkas' : 'Unggah Berkas'}</span>
            </button>
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

        {/* Bilah 9 Tools */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-9 gap-2">
          {TOOLS.map((tool) => {
            const IconComp = tool.icon;
            const isSelected = selectedTool === tool.id;
            const tState = toolStates[tool.id];

            return (
              <button
                key={tool.id}
                onClick={() => {
                  setSelectedTool(tool.id);
                  stopPlayback();
                }}
                className={`p-2.5 rounded-xl border flex flex-col items-center text-center gap-1.5 transition-all cursor-pointer relative ${
                  isSelected
                    ? 'bg-[#FCA311] text-black border-[#FCA311] shadow-md font-black'
                    : 'bg-black/40 text-gray-300 border-white/[0.06] hover:border-white/20'
                }`}
              >
                {tool.isAi && (
                  <span
                    className={`absolute -top-1.5 -right-1 text-[9px] font-black px-1.5 py-0.2 rounded-full border shadow-xs ${
                      isSelected ? 'bg-black text-[#FCA311] border-black' : 'bg-[#FCA311] text-black border-[#FCA311]'
                    }`}
                  >
                    AI
                  </span>
                )}
                {tState.isProcessing && (
                  <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-blue-400 animate-ping" />
                )}
                {tState.resultBuffer && !tState.isProcessing && (
                  <span className="absolute top-1 left-1 w-2 h-2 rounded-full bg-emerald-400" title="Hasil siap" />
                )}
                <IconComp className="w-4 h-4 shrink-0" />
                <span className="text-[11px] leading-tight truncate w-full">{tool.name}</span>
              </button>
            );
          })}
        </div>

        {/* Panel Kontrol & Konfigurasi Tool Terpilih */}
        <div className="p-4 sm:p-5 rounded-xl bg-black/40 border border-white/[0.06] space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <h4 className="text-sm font-bold text-white">
                {TOOLS.find((t) => t.id === selectedTool)?.name}
              </h4>
              <p className="text-xs text-gray-400">
                {TOOLS.find((t) => t.id === selectedTool)?.desc}
              </p>
            </div>

            {audioFile && (
              <span className="text-[11px] font-mono text-[#FCA311] bg-black/60 px-2.5 py-1 rounded-md border border-white/10 flex items-center gap-1.5">
                <FileAudio className="w-3.5 h-3.5" />
                <span className="truncate max-w-[150px] sm:max-w-xs">{audioFile.name}</span>
                <span className="text-gray-400">({decodedBuffer?.duration.toFixed(1)}s)</span>
              </span>
            )}
          </div>

          <div className="pt-2">
            {/* 1. TRIM / CUT */}
            {selectedTool === 'trim' && (
              <div className="space-y-4 text-xs">
                <div
                  ref={timelineRef}
                  className="relative w-full h-16 bg-black/60 rounded-xl border border-white/10 overflow-hidden select-none p-1 touch-none"
                >
                  <div
                    className="absolute top-0 bottom-0 bg-[#FCA311]/25 border-x-2 border-[#FCA311] transition-none flex items-center justify-center pointer-events-none"
                    style={{
                      left: `${startPercent}%`,
                      width: `${Math.max(0, endPercent - startPercent)}%`,
                    }}
                  >
                    <span className="text-[10px] font-mono font-bold text-[#FCA311] bg-black/80 px-2 py-0.5 rounded shadow">
                      Area Simpan: {(trimEnd - trimStart).toFixed(1)}s
                    </span>
                  </div>

                  <div
                    onPointerDown={handleTrimHandleDrag('start')}
                    className="absolute top-0 bottom-0 w-4 -ml-2 z-10 flex items-center justify-center cursor-ew-resize group"
                    style={{ left: `${startPercent}%` }}
                  >
                    <div className="w-1 h-full bg-amber-300 group-hover:bg-amber-200 group-active:bg-white transition-colors" />
                    <div className="absolute w-3 h-6 bg-amber-300 group-hover:bg-amber-200 group-active:bg-white rounded-sm shadow" />
                  </div>

                  <div
                    onPointerDown={handleTrimHandleDrag('end')}
                    className="absolute top-0 bottom-0 w-4 -ml-2 z-10 flex items-center justify-center cursor-ew-resize group"
                    style={{ left: `${endPercent}%` }}
                  >
                    <div className="w-1 h-full bg-amber-300 group-hover:bg-amber-200 group-active:bg-white transition-colors" />
                    <div className="absolute w-3 h-6 bg-amber-300 group-hover:bg-amber-200 group-active:bg-white rounded-sm shadow" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2 bg-black/50 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center">
                      <label className="text-gray-300 font-bold">Batas Awal (Start):</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min={0}
                          max={Math.max(0, trimEnd - 0.1)}
                          value={trimStart}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const clamped = Math.max(0, Math.min(val, trimEnd - 0.1));
                            setTrimStart(clamped);
                            if (audioElementRef.current) audioElementRef.current.currentTime = clamped;
                          }}
                          className="w-20 bg-black/80 border border-white/15 rounded px-2 py-1 text-xs font-mono font-bold text-[#FCA311] text-right focus:outline-none focus:border-[#FCA311]"
                        />
                        <span className="text-gray-400 font-mono">detik</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={totalDuration}
                      step={0.1}
                      value={trimStart}
                      onChange={(e) => {
                        const val = Math.min(Number(e.target.value), trimEnd - 0.1);
                        setTrimStart(val);
                        if (audioElementRef.current) audioElementRef.current.currentTime = val;
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                    />
                  </div>

                  <div className="space-y-2 bg-black/50 p-3 rounded-xl border border-white/5">
                    <div className="flex justify-between items-center">
                      <label className="text-gray-300 font-bold">Batas Akhir (End):</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          step="0.1"
                          min={trimStart + 0.1}
                          max={totalDuration}
                          value={trimEnd}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            const clamped = Math.max(trimStart + 0.1, Math.min(val, totalDuration));
                            setTrimEnd(clamped);
                          }}
                          className="w-20 bg-black/80 border border-white/15 rounded px-2 py-1 text-xs font-mono font-bold text-[#FCA311] text-right focus:outline-none focus:border-[#FCA311]"
                        />
                        <span className="text-gray-400 font-mono">detik</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={totalDuration}
                      step={0.1}
                      value={trimEnd}
                      onChange={(e) => {
                        const val = Math.max(trimStart + 0.1, Number(e.target.value));
                        setTrimEnd(val);
                      }}
                      className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 2. VOLUME / GAIN */}
            {selectedTool === 'volume' && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 font-bold block">Penyesuaian Gain Dinamis (Real-time):</label>
                  <span className="text-sm font-mono font-bold text-[#FCA311]">
                    {dynamicGainDb > 0 ? `+${dynamicGainDb}` : dynamicGainDb} dB
                  </span>
                </div>
                <input
                  type="range"
                  min="-24"
                  max="24"
                  step="1"
                  value={dynamicGainDb}
                  onChange={(e) => setDynamicGainDb(Number(e.target.value))}
                  className="w-full h-2 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                />
              </div>
            )}

            {/* 3. PITCH / TRANSPOSE */}
            {selectedTool === 'pitch' && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 font-bold block">Pergeseran Nada Dinamis:</label>
                  <span className="text-sm font-mono font-bold text-[#FCA311]">
                    {dynamicPitchSemitones > 0 ? `+${dynamicPitchSemitones}` : dynamicPitchSemitones} Semitone
                  </span>
                </div>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="1"
                  value={dynamicPitchSemitones}
                  onChange={(e) => setDynamicPitchSemitones(Number(e.target.value))}
                  className="w-full h-2 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                />
                <div className="flex items-center gap-2 pt-1 bg-black/40 p-2.5 rounded-lg border border-white/5">
                  <input
                    type="checkbox"
                    id="chk-keep-tempo"
                    checked={keepTempoOnPitch}
                    onChange={(e) => setKeepTempoOnPitch(e.target.checked)}
                    className="accent-[#FCA311] w-4 h-4 cursor-pointer"
                  />
                  <label htmlFor="chk-keep-tempo" className="text-gray-300 font-bold cursor-pointer select-none">
                    Kunci Tempo (Keep Tempo) — Kecepatan tempo tetap stabil saat nada dinaik-turunkan
                  </label>
                </div>
              </div>
            )}

            {/* 4. TEMPO / SPEED */}
            {selectedTool === 'tempo' && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <label className="text-gray-300 font-bold block">Kecepatan Putar Dinamis (Nada Terkunci Normal):</label>
                  <span className="text-sm font-mono font-bold text-[#FCA311]">{dynamicTempoSpeed}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.05"
                  value={dynamicTempoSpeed}
                  onChange={(e) => setDynamicTempoSpeed(Number(e.target.value))}
                  className="w-full h-2 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                />
              </div>
            )}

            {/* 5. REVERSE */}
            {selectedTool === 'reverse' && (
              <p className="text-xs text-gray-300">
                Membalikkan urutan gelombang audio dari ujung akhir ke awal (reverse swell).
              </p>
            )}

            {/* 6. CONVERT */}
            {selectedTool === 'convert' && (
              <div className="space-y-3 text-xs">
                <div className="flex items-center gap-2 border-b border-white/10 pb-3 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setConvertSourceMode('audio')}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-bold cursor-pointer ${
                      convertSourceMode === 'audio' ? 'bg-[#FCA311] text-black shadow' : 'bg-black/50 text-gray-400 hover:text-white'
                    }`}
                  >
                    <Music className="w-3.5 h-3.5" />
                    <span>Audio to Audio (WAV, MP3, FLAC, M4A)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConvertSourceMode('video');
                      fileInputRef.current?.click();
                    }}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg font-bold cursor-pointer ${
                      convertSourceMode === 'video' ? 'bg-[#FCA311] text-black shadow' : 'bg-black/50 text-gray-400 hover:text-white'
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" />
                    <span>Video to Audio (Semua Format: MP4, MKV, WebM, MOV, AVI, dll.)</span>
                  </button>
                </div>

                {convertSourceMode === 'video' && (
                  <p className="text-[11px] text-amber-300 bg-amber-500/10 p-3 rounded-xl border border-amber-500/20 leading-relaxed">
                    Mendukung ekstraksi audio universal dari semua ekstensi video (<strong>.mp4, .mkv, .webm, .mov, .avi, .flv, .wmv, .m4v, .3gp</strong>). Mesin browser mendaur ulang track suara video langsung ke format MP3/WAV/FLAC/M4A pilihan Anda.
                  </p>
                )}
              </div>
            )}

            {/* 7. COMPRESS */}
            {selectedTool === 'compress' && (
              <div className="space-y-3 text-xs">
                <span className="text-gray-300 font-bold block">Pilih Tingkatan Kompresi Bitrate Nyata:</span>
                <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                  {compressTiers.map((tier) => {
                    const isSelected = selectedCompressTier === tier.id;
                    return (
                      <button
                        key={tier.id}
                        type="button"
                        onClick={() => handleCompressTierChange(tier.id)}
                        className={`p-3 rounded-xl border flex flex-col justify-between text-left transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#FCA311] text-black border-[#FCA311] font-bold shadow-md'
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

            {/* 8. AI NOISE REDUCTION */}
            {selectedTool === 'noise_reduction' && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 text-[#FCA311] font-bold">
                  <Sparkles className="w-4 h-4" />
                  <span>AI Spectral Noise Gate</span>
                </div>
                <div className="space-y-1">
                  <label className="text-gray-300 font-bold block">Intensitas Pembersihan: {aiNoiseAggression}%</label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={aiNoiseAggression}
                    onChange={(e) => setAiNoiseAggression(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                  />
                </div>
              </div>
            )}

            {/* 9. AI VOCAL SEPARATOR */}
            {selectedTool === 'vocal_separator' && (
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2 text-[#FCA311] font-bold">
                  <Mic2 className="w-4 h-4" />
                  <span>AI Center-Phase Isolation</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {(['vocal', 'instrumental', 'both'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setVocalExtractTarget(mode)}
                      className={`px-3 py-1.5 rounded-lg font-bold capitalize cursor-pointer ${
                        vocalExtractTarget === mode ? 'bg-[#FCA311] text-black' : 'bg-black/60 text-gray-400 hover:text-white'
                      }`}
                    >
                      {mode === 'vocal' ? 'Vokal Saja' : mode === 'instrumental' ? 'Musik Saja' : 'Keduanya (2 File)'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Baris Format Unduhan & Tombol Aksi */}
          <div className="pt-3 border-t border-white/[0.06] space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs">
              <span className="text-gray-300 font-bold">Format Unduhan:</span>
              <div className="flex items-center gap-1.5">
                {(['MP3', 'WAV', 'M4A', 'FLAC'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setSelectedExportFormat(fmt)}
                    className={`px-3 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                      selectedExportFormat === fmt
                        ? 'bg-[#FCA311] text-black shadow'
                        : 'bg-black/60 text-gray-400 hover:text-white'
                    }`}
                  >
                    {fmt}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2.5">
                {/* Tombol Jalankan / Kunci jika Kuota Habis */}
                {!isToolsOwned && currentToolQuota <= 0 ? (
                  <button
                    type="button"
                    onClick={onUnlockEditor}
                    className="px-5 py-2 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Beli Audio Tools — Rp20.000</span>
                  </button>
                ) : (
                  selectedTool !== 'volume' && selectedTool !== 'pitch' && selectedTool !== 'tempo' && (
                    <button
                      type="button"
                      onClick={() => executeProcessForTool(selectedTool)}
                      disabled={currentToolState.isProcessing}
                      className="px-5 py-2 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50"
                    >
                      {currentToolState.isProcessing ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Memproses ({currentToolState.progress}%)...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5 fill-black" />
                          <span>Jalankan {TOOLS.find((t) => t.id === selectedTool)?.name}</span>
                        </>
                      )}
                    </button>
                  )
                )}

                {audioUrl && (
                  <button
                    type="button"
                    onClick={togglePlayback}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                    <span>
                      {isPlaying
                        ? 'Berhenti'
                        : selectedTool === 'volume' || selectedTool === 'pitch' || selectedTool === 'tempo' || (selectedTool === 'trim' && !currentToolState.resultBuffer)
                        ? 'Dengar Audio (Live Preview)'
                        : currentToolState.resultBuffer
                        ? 'Dengar Hasil'
                        : 'Dengar Asli'}
                    </span>
                  </button>
                )}

                {Boolean(currentToolState.resultBuffer || currentToolState.vocalBuffers?.vocal) && (
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

              {/* Unduhan Vokal Separator 2 File */}
              {selectedTool === 'vocal_separator' && vocalExtractTarget === 'both' && currentToolState.vocalBuffers?.vocal ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleDownloadFile(currentToolState.vocalBuffers!.vocal!, 'Vocal_Only')}
                    className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black flex items-center gap-1 cursor-pointer shadow"
                  >
                    <Download className="w-3 h-3" /> Unduh Vokal ({selectedExportFormat})
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDownloadFile(currentToolState.vocalBuffers!.instrumental!, 'Music_Only')}
                    className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-black text-xs font-black flex items-center gap-1 cursor-pointer shadow"
                  >
                    <Download className="w-3 h-3" /> Unduh Musik ({selectedExportFormat})
                  </button>
                </div>
              ) : (
                /* Unduhan Standar */
                (currentToolState.resultBuffer || selectedTool === 'volume' || selectedTool === 'pitch' || selectedTool === 'tempo') &&
                decodedBuffer && (
                  <div className="flex items-center gap-2">
                    <span className="text-emerald-400 text-xs font-bold flex items-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> Siap
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownloadFile()}
                      disabled={isEncodingCompressed || (!isToolsOwned && currentToolQuota <= 0)}
                      className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                    >
                      {isEncodingCompressed ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Mengompres ({compressEncodeProgress}%)...</span>
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" />
                          <span>Unduh {selectedExportFormat}</span>
                        </>
                      )}
                    </button>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};