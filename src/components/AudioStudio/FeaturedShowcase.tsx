// src/components/AudioStudio/FeaturedShowcase.tsx
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Sliders,
  Volume2,
  Sparkles,
  Lock,
  CheckCircle2,
  Download,
  ChevronDown,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { AudioTrackItem, AudioEntitlements } from '../../types';

interface FeaturedShowcaseProps {
  activeTrack: AudioTrackItem;
  entitlements: AudioEntitlements;
  onRequestCustom: () => void;
  onUnlockMaster: () => void;
}

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const outBuffer = new ArrayBuffer(length);
  const view = new DataView(outBuffer);
  const channels: Float32Array[] = [];
  let offset = 0;
  let pos = 0;

  function setUint16(data: number) { view.setUint16(pos, data, true); pos += 2; }
  function setUint32(data: number) { view.setUint32(pos, data, true); pos += 4; }

  setUint32(0x46464952); setUint32(length - 8); setUint32(0x45564157);
  setUint32(0x20746d66); setUint32(16); setUint16(1); setUint16(numOfChan);
  setUint32(buffer.sampleRate); setUint32(buffer.sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2); setUint16(16); setUint32(0x61746164); setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      view.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([outBuffer], { type: 'audio/wav' });
}

// Impulse response sintetik untuk reverb (sama seperti punya LoopShowcase),
// dipakai baik untuk graph live maupun render offline saat unduh.
function buildImpulse(ctx: BaseAudioContext, durationSec = 2.0, decay = 2.0) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * durationSec);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let c = 0; c < 2; c++) {
    const channel = impulse.getChannelData(c);
    for (let i = 0; i < length; i++) {
      channel[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

export const FeaturedShowcase: React.FC<FeaturedShowcaseProps> = ({
  activeTrack,
  entitlements,
  onUnlockMaster,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const trackIdStr = String(activeTrack?.id || '');
  const trackOwnership = entitlements?.byTrack?.[trackIdStr] || entitlements?.byTrack?.[activeTrack?.id] || {};
  const isMasterUnlocked = Boolean(trackOwnership.fullMaster || (entitlements as any)?.fullMaster);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [volume, setVolume] = useState(0.85);

  const [speed, setSpeed] = useState(1.0);
  const [keepPitch, setKeepPitch] = useState(true);
  const [bassGain, setBassGain] = useState(0);
  const [trebleGain, setTrebleGain] = useState(0);
  const [isCompressor, setIsCompressor] = useState(false);
  const [isReverb, setIsReverb] = useState(false);
  const [isDelay, setIsDelay] = useState(false);
  const [isChorus, setIsChorus] = useState(false);

  const [showDspPanel, setShowDspPanel] = useState(true);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // -------------------------------------------------------------------
  // GRAPH WEB AUDIO LIVE UNTUK RAK EFEK
  //
  // SEBELUMNYA: bassGain/trebleGain/isCompressor/isReverb/isDelay/isChorus
  // di atas cuma jadi state React biasa yang dibaca satu kali di dalam
  // handleDownloadProcessedAudio() (untuk file yang DIUNDUH). Elemen
  // <audio> pemutar live-nya sama sekali tidak pernah dihubungkan ke
  // AudioContext/BiquadFilter/dll apa pun, jadi apapun yang kamu geser di
  // panel itu TIDAK berpengaruh ke suara yang kamu dengar sambil main-main
  // slider-nya — cuma berpengaruh ke file .wav/.mp3 hasil unduhan.
  //
  // Di bawah ini dibangun graph Web Audio permanen (mirip pola yang sudah
  // benar di LoopShowcase.tsx) supaya semua 6 kontrol efek benar-benar
  // memproses suara yang sedang diputar secara real-time.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
  const bassNodeRef = useRef<BiquadFilterNode | null>(null);
  const trebleNodeRef = useRef<BiquadFilterNode | null>(null);
  const compressorNodeRef = useRef<DynamicsCompressorNode | null>(null);
  const reverbWetRef = useRef<GainNode | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const delayFeedbackRef = useRef<GainNode | null>(null);
  const delayWetRef = useRef<GainNode | null>(null);
  const chorusDelayRef = useRef<DelayNode | null>(null);
  const chorusWetRef = useRef<GainNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  const PREVIEW_LIMIT = 7.0;
  const rawDuration = duration || activeTrack?.durationSec || 168;
  const effectiveMaxDuration = isMasterUnlocked ? rawDuration : PREVIEW_LIMIT;

  useEffect(() => {
    // Elemen <audio> di-remount (lihat `key={activeTrack?.id}` di JSX) setiap
    // ganti lagu, jadi MediaElementAudioSourceNode lama jadi tidak valid lagi.
    // Tutup & reset graph di sini supaya setupWebAudioGraph() membangun ulang
    // dari nol terhadap elemen <audio> yang baru pada play berikutnya.
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    sourceNodeRef.current = null;
    bassNodeRef.current = null;
    trebleNodeRef.current = null;
    compressorNodeRef.current = null;
    reverbWetRef.current = null;
    delayNodeRef.current = null;
    delayFeedbackRef.current = null;
    delayWetRef.current = null;
    chorusDelayRef.current = null;
    chorusWetRef.current = null;
    masterGainRef.current = null;

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
      audioRef.current.load();
    }
  }, [activeTrack?.id, activeTrack?.audioUrl]);

  // Bangun graph Web Audio sekali per elemen <audio> (dipanggil dari togglePlay,
  // jadi selalu berada dalam konteks user-gesture agar AudioContext boleh jalan).
  const setupWebAudioGraph = useCallback(() => {
    if (!audioRef.current) return;
    if (audioCtxRef.current) {
      if (audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;

      const source = ctx.createMediaElementSource(audioRef.current);
      sourceNodeRef.current = source;

      const bass = ctx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 250;
      bass.gain.value = bassGain;
      bassNodeRef.current = bass;

      const treble = ctx.createBiquadFilter();
      treble.type = 'highshelf';
      treble.frequency.value = 3200;
      treble.gain.value = trebleGain;
      trebleNodeRef.current = treble;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = isCompressor ? -24 : 0;
      comp.ratio.value = isCompressor ? 8 : 1;
      comp.attack.value = 0.003;
      comp.release.value = 0.15;
      compressorNodeRef.current = comp;

      const masterOut = ctx.createGain();
      masterOut.gain.value = volume;
      masterGainRef.current = masterOut;

      const convolver = ctx.createConvolver();
      convolver.buffer = buildImpulse(ctx, 2.2, 2.0);
      const reverbWet = ctx.createGain();
      reverbWet.gain.value = isReverb ? 0.5 : 0;
      reverbWetRef.current = reverbWet;
      convolver.connect(reverbWet);
      reverbWet.connect(masterOut);

      const delay = ctx.createDelay();
      delay.delayTime.value = 0.28;
      const delayFb = ctx.createGain();
      delayFb.gain.value = 0.35;
      const delayWet = ctx.createGain();
      delayWet.gain.value = isDelay ? 0.45 : 0;
      delay.connect(delayFb);
      delayFb.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(masterOut);
      delayNodeRef.current = delay;
      delayFeedbackRef.current = delayFb;
      delayWetRef.current = delayWet;

      const chorusDelay = ctx.createDelay();
      chorusDelay.delayTime.value = 0.025;
      const chorusLfo = ctx.createOscillator();
      chorusLfo.frequency.value = 1.5;
      const chorusLfoGain = ctx.createGain();
      chorusLfoGain.gain.value = 0.0025;
      chorusLfo.connect(chorusLfoGain);
      chorusLfoGain.connect(chorusDelay.delayTime);
      chorusLfo.start();
      const chorusWet = ctx.createGain();
      chorusWet.gain.value = isChorus ? 0.55 : 0;
      chorusDelay.connect(chorusWet);
      chorusWet.connect(masterOut);
      chorusDelayRef.current = chorusDelay;
      chorusWetRef.current = chorusWet;

      source.connect(bass);
      bass.connect(treble);
      treble.connect(comp);

      comp.connect(masterOut);
      comp.connect(convolver);
      comp.connect(delay);
      comp.connect(chorusDelay);

      masterOut.connect(ctx.destination);
    } catch (e) {
      console.warn('Inisialisasi Web Audio Master:', e);
    }
  }, [bassGain, trebleGain, isCompressor, isReverb, isDelay, isChorus, volume]);

  // Selaraskan tiap kontrol efek ke node live-nya secara real-time.
  useEffect(() => {
    if (bassNodeRef.current) bassNodeRef.current.gain.value = bassGain;
  }, [bassGain]);

  useEffect(() => {
    if (trebleNodeRef.current) trebleNodeRef.current.gain.value = trebleGain;
  }, [trebleGain]);

  useEffect(() => {
    if (compressorNodeRef.current) {
      compressorNodeRef.current.threshold.value = isCompressor ? -24 : 0;
      compressorNodeRef.current.ratio.value = isCompressor ? 8 : 1;
    }
  }, [isCompressor]);

  useEffect(() => {
    if (reverbWetRef.current) reverbWetRef.current.gain.value = isReverb ? 0.5 : 0;
  }, [isReverb]);

  useEffect(() => {
    if (delayWetRef.current) delayWetRef.current.gain.value = isDelay ? 0.45 : 0;
  }, [isDelay]);

  useEffect(() => {
    if (chorusWetRef.current) chorusWetRef.current.gain.value = isChorus ? 0.55 : 0;
  }, [isChorus]);

  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = volume;
  }, [volume]);

  const togglePlay = () => {
    if (!audioRef.current) return;

    if (!activeTrack?.audioUrl) {
      alert('Berkas audio master belum diunggah untuk trek ini di Developer Console.');
      return;
    }

    // Bangun/lanjutkan graph efek SEBELUM play(), masih dalam konteks
    // user-gesture dari klik tombol ini (disyaratkan kebijakan autoplay browser).
    setupWebAudioGraph();

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (!isMasterUnlocked && audioRef.current.currentTime >= PREVIEW_LIMIT) {
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
      }

      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.error('Pemutaran gagal:', err);
            setIsPlaying(false);
          });
      }
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    setCurrentTime(cur);

    if (!isMasterUnlocked && cur >= PREVIEW_LIMIT) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetTime = Number(e.target.value);
    setCurrentTime(targetTime);
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
    }
  };

  const handleToggleLoop = () => {
    const next = !isLooping;
    setIsLooping(next);
    if (audioRef.current) audioRef.current.loop = next;
  };

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
      audioRef.current.preservesPitch = keepPitch;
      (audioRef.current as any).webkitPreservesPitch = keepPitch;
    }
  }, [speed, keepPitch]);

  const handleDownloadProcessedAudio = async (format: string) => {
    if (!activeTrack?.audioUrl) {
      alert('Berkas audio belum tersedia.');
      return;
    }
    setShowDownloadMenu(false);
    setIsExporting(true);

    try {
      const response = await fetch(activeTrack.audioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
      await tempCtx.close();

      const tailSec = isReverb || isDelay ? 1.5 : 0.2;
      const targetDuration = decodedBuffer.duration / speed + tailSec;
      const targetLength = Math.floor(decodedBuffer.sampleRate * targetDuration);

      const offlineCtx = new OfflineAudioContext(
        decodedBuffer.numberOfChannels,
        targetLength,
        decodedBuffer.sampleRate
      );

      const source = offlineCtx.createBufferSource();
      source.buffer = decodedBuffer;
      source.playbackRate.value = speed;

      const bass = offlineCtx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 250;
      bass.gain.value = bassGain;

      const treble = offlineCtx.createBiquadFilter();
      treble.type = 'highshelf';
      treble.frequency.value = 3200;
      treble.gain.value = trebleGain;

      const compressor = offlineCtx.createDynamicsCompressor();
      compressor.threshold.value = isCompressor ? -24 : 0;
      compressor.ratio.value = isCompressor ? 8 : 1;

      const masterOut = offlineCtx.createGain();
      masterOut.gain.value = 1.0;

      // Delay, Reverb, dan Chorus sebelumnya SAMA SEKALI tidak dihubungkan di
      // sini walau togglenya ada di panel — hasil unduhan diam-diam selalu
      // "polos" tanpa 3 efek ini. Sekarang disamakan dengan graph live.
      const convolver = offlineCtx.createConvolver();
      convolver.buffer = buildImpulse(offlineCtx, 2.2, 2.0);
      const reverbWet = offlineCtx.createGain();
      reverbWet.gain.value = isReverb ? 0.5 : 0;
      convolver.connect(reverbWet);
      reverbWet.connect(masterOut);

      const delay = offlineCtx.createDelay();
      delay.delayTime.value = 0.28;
      const delayFb = offlineCtx.createGain();
      delayFb.gain.value = 0.35;
      const delayWet = offlineCtx.createGain();
      delayWet.gain.value = isDelay ? 0.45 : 0;
      delay.connect(delayFb);
      delayFb.connect(delay);
      delay.connect(delayWet);
      delayWet.connect(masterOut);

      const chorusDelay = offlineCtx.createDelay();
      chorusDelay.delayTime.value = 0.025;
      const chorusLfo = offlineCtx.createOscillator();
      chorusLfo.frequency.value = 1.5;
      const chorusLfoGain = offlineCtx.createGain();
      chorusLfoGain.gain.value = 0.0025;
      chorusLfo.connect(chorusLfoGain);
      chorusLfoGain.connect(chorusDelay.delayTime);
      chorusLfo.start(0);
      const chorusWet = offlineCtx.createGain();
      chorusWet.gain.value = isChorus ? 0.55 : 0;
      chorusDelay.connect(chorusWet);
      chorusWet.connect(masterOut);

      source.connect(bass);
      bass.connect(treble);
      treble.connect(compressor);
      compressor.connect(masterOut);
      compressor.connect(convolver);
      compressor.connect(delay);
      compressor.connect(chorusDelay);
      masterOut.connect(offlineCtx.destination);
      source.start(0);

      const renderedBuffer = await offlineCtx.startRendering();
      const wavBlob = audioBufferToWav(renderedBuffer);

      const cleanTitle = (activeTrack.title || 'Master').replace(/[^a-zA-Z0-9_-]/g, '_');
      const downloadUrl = URL.createObjectURL(wavBlob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `${cleanTitle}_Master_DSP.${format.toLowerCase()}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(downloadUrl);
    } catch (err) {
      console.error('Gagal render audio:', err);
      alert('Terjadi kendala saat memproses berkas unduhan.');
    } finally {
      setIsExporting(false);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#14213D]/80 via-black to-[#090D16] border border-white/10 p-6 sm:p-8 shadow-2xl">
      <audio
        ref={audioRef}
        key={activeTrack?.id}
        src={activeTrack?.audioUrl || ''}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => !isLooping && setIsPlaying(false)}
      />

      <div className="grid lg:grid-cols-[auto_1fr] items-center gap-8">
        <div className="relative flex justify-center items-center">
          <div
            className={`relative w-44 h-44 sm:w-52 sm:h-52 rounded-full bg-gradient-to-tr from-zinc-950 via-zinc-900 to-black border-4 border-zinc-800 shadow-[0_0_50px_rgba(0,0,0,0.8)] flex items-center justify-center transition-transform duration-700 ${
              isPlaying ? 'animate-[spin_4s_linear_infinite]' : ''
            }`}
          >
            <div className="absolute inset-2 rounded-full border border-white/[0.04]" />
            <div className="absolute inset-6 rounded-full border border-white/[0.04]" />
            <div className="absolute inset-10 rounded-full border border-white/[0.06]" />
            <div className="absolute inset-14 rounded-full border border-white/[0.04]" />

            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-[#FCA311] border-2 border-black flex flex-col items-center justify-center p-2 text-center shadow-inner">
              <div className="w-3 h-3 rounded-full bg-black mb-1" />
              <span className="text-[8px] font-black text-black leading-tight uppercase truncate max-w-full">
                {activeTrack?.title || 'No Audio'}
              </span>
            </div>
          </div>

          <div className="absolute -bottom-2 px-3 py-1 rounded-full bg-black/80 border border-white/15 text-[10px] font-bold text-gray-300">
            {isMasterUnlocked ? (
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Full Audio Master Aktif
              </span>
            ) : (
              <span className="text-amber-400 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Preview 7 Detik
              </span>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#FCA311]/10 text-[#FCA311] border border-[#FCA311]/30 font-semibold">
                  {activeTrack?.genre || 'General'}
                </span>
                <span className="text-xs text-gray-400">{activeTrack?.bpm || 120} BPM</span>
              </div>
              <h1 className="text-3xl sm:text-4xl font-black text-white mt-1 tracking-tight">
                {activeTrack?.title || 'Pilih Lagu'}
              </h1>
              <p className="text-sm text-gray-400">Diproduksi oleh {activeTrack?.artist || 'PlayMuzeck Studio'}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {isMasterUnlocked ? (
                <>
                  <div className="relative">
                    <button
                      disabled={isExporting}
                      onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 text-black font-extrabold text-xs hover:bg-emerald-400 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                    >
                      {isExporting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Merender DSP...
                        </>
                      ) : (
                        <>
                          <Download className="w-3.5 h-3.5" /> Unduh Master <ChevronDown className="w-3 h-3" />
                        </>
                      )}
                    </button>
                    {showDownloadMenu && !isExporting && (
                      <div className="absolute right-0 mt-2 w-48 rounded-xl bg-[#14213D] border border-white/15 p-1.5 shadow-2xl z-30 text-xs">
                        <p className="text-[10px] uppercase font-bold text-[#FCA311] px-2.5 py-1">
                          Render Efek Studio ke:
                        </p>
                        {['WAV', 'MP3', 'FLAC', 'M4A'].map((fmt) => (
                          <button
                            key={fmt}
                            onClick={() => handleDownloadProcessedAudio(fmt)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg text-white hover:bg-[#FCA311] hover:text-black font-semibold flex justify-between cursor-pointer"
                          >
                            <span>Master .{fmt}</span>
                            <span className="text-[10px] opacity-70">
                              {fmt === 'WAV' ? 'Studio 24-bit' : 'HQ Baked'}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => setShowDspPanel(!showDspPanel)}
                    className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      showDspPanel ? 'bg-[#FCA311] text-black' : 'bg-white/10 text-white hover:bg-white/20'
                    }`}
                  >
                    <Sliders className="w-3.5 h-3.5" /> Studio FX Rack
                  </button>
                </>
              ) : (
                <button
                  onClick={onUnlockMaster}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#FCA311] text-black font-bold text-xs hover:brightness-110 shadow-lg shadow-amber-500/10 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Buka Full Audio Master
                </button>
              )}
            </div>
          </div>

          <div className="space-y-2 bg-black/40 p-4 rounded-2xl border border-white/5">
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono text-gray-400 w-10 text-right">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={effectiveMaxDuration}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FCA311]"
              />
              <span className="text-xs font-mono text-gray-400 w-10">
                {formatTime(effectiveMaxDuration)}
              </span>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-3">
                <button
                  onClick={togglePlay}
                  className="w-12 h-12 rounded-2xl bg-[#FCA311] text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-amber-500/20 cursor-pointer"
                >
                  {isPlaying ? <Pause className="w-6 h-6 fill-black" /> : <Play className="w-6 h-6 fill-black ml-0.5" />}
                </button>

                <button
                  onClick={() => {
                    if (audioRef.current) {
                      audioRef.current.currentTime = 0;
                      setCurrentTime(0);
                    }
                  }}
                  title="Mulai dari awal"
                  className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                <button
                  onClick={handleToggleLoop}
                  title="Ulangi Lagu (Loop)"
                  className={`p-2.5 rounded-xl transition-colors cursor-pointer ${
                    isLooping ? 'bg-[#FCA311]/20 text-[#FCA311] border border-[#FCA311]/40' : 'bg-white/5 text-gray-400 hover:text-white'
                  }`}
                >
                  <Repeat className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
                <Volume2 className="w-4 h-4 text-gray-400" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    // Volume dikendalikan lewat masterGainRef (lihat useEffect di atas)
                    // begitu graph Web Audio aktif, supaya tidak dobel-dikalikan dengan
                    // audioRef.current.volume (yang akan bikin slider terasa tidak linear).
                    if (!audioCtxRef.current && audioRef.current) audioRef.current.volume = v;
                  }}
                  className="w-20 sm:w-24 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FCA311]"
                />
                <span className="text-xs font-mono text-gray-300 w-9 text-right font-semibold">
                  {Math.round(volume * 100)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isMasterUnlocked && showDspPanel && (
        <div className="mt-6 pt-6 border-t border-white/10 animate-in fade-in duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#FCA311]" /> Rak Efek Audio & Equalizer (Master Studio)
            </h3>
          </div>

          <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-4 bg-black/60 p-4 rounded-2xl border border-white/10">
            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 flex justify-between">
                <span>Speed Audio</span>
                <span className="text-white font-mono font-bold">{speed}x</span>
              </label>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="w-full bg-zinc-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-[#FCA311]"
              >
                <option value={0.5}>0.5x (Slow Motion)</option>
                <option value={0.75}>0.75x</option>
                <option value={1.0}>1.0x (Normal)</option>
                <option value={1.25}>1.25x</option>
                <option value={1.5}>1.5x</option>
                <option value={2.0}>2.0x (Double Speed)</option>
              </select>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-400 cursor-pointer pt-0.5">
                <input
                  type="checkbox"
                  checked={keepPitch}
                  onChange={(e) => setKeepPitch(e.target.checked)}
                  className="accent-[#FCA311] rounded cursor-pointer"
                />
                <span>Kunci Nada (Keep Pitch)</span>
              </label>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 flex justify-between">
                <span>Bass (Low EQ)</span>
                <span className="text-white font-mono">{bassGain > 0 ? `+${bassGain}` : bassGain} dB</span>
              </label>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={bassGain}
                onChange={(e) => setBassGain(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FCA311]"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-gray-400 flex justify-between">
                <span>Treble (High EQ)</span>
                <span className="text-white font-mono">{trebleGain > 0 ? `+${trebleGain}` : trebleGain} dB</span>
              </label>
              <input
                type="range"
                min={-12}
                max={12}
                step={1}
                value={trebleGain}
                onChange={(e) => setTrebleGain(Number(e.target.value))}
                className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FCA311]"
              />
            </div>

            <div className="flex gap-2 items-start pt-1">
              <button
                type="button"
                onClick={() => setIsDelay(!isDelay)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  isDelay ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-zinc-900 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isDelay ? '✓ Delay On' : 'Delay'}
              </button>
              <button
                type="button"
                onClick={() => setIsReverb(!isReverb)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  isReverb ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-zinc-900 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isReverb ? '✓ Reverb On' : 'Reverb'}
              </button>
            </div>

            <div className="flex gap-2 items-start pt-1">
              <button
                type="button"
                onClick={() => setIsChorus(!isChorus)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  isChorus ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-zinc-900 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isChorus ? '✓ Chorus' : 'Chorus'}
              </button>
              <button
                type="button"
                onClick={() => setIsCompressor(!isCompressor)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                  isCompressor ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-zinc-900 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isCompressor ? '✓ Comp' : 'Compressor'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};