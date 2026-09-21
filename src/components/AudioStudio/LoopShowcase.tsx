// src/components/AudioStudio/LoopShowcase.tsx
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
  Radio,
} from 'lucide-react';
import { AudioTrackItem, AudioEntitlements } from '../../types';
import { exportAudioFile } from '../../services/exporters';

interface LoopShowcaseProps {
  activeTrack: AudioTrackItem;
  entitlements: AudioEntitlements;
  onNavigateToPricing: (key: string) => void;
}

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

export const LoopShowcase: React.FC<LoopShowcaseProps> = ({
  activeTrack,
  entitlements,
  onNavigateToPricing,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const trackIdStr = String(activeTrack?.id || '');
  const trackOwnership = entitlements?.byTrack?.[trackIdStr] || entitlements?.byTrack?.[activeTrack?.id] || {};
  const isLoopUnlocked = Boolean(
    trackOwnership.loopVersion ||
    (entitlements as any)?.all
  );

  const PREVIEW_LIMIT = 7.0;
  const loopAudioUrl = (activeTrack as any)?.loopAudioUrl || activeTrack?.audioUrl || '';

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);

  const [maxLoopCount, setMaxLoopCount] = useState<1 | 2 | 3>(1);
  const [currentLoopIteration, setCurrentLoopIteration] = useState(1);

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

  const effectiveMaxDuration = isLoopUnlocked ? (duration || 32) : PREVIEW_LIMIT;

  const scrollToUnlockHeader = () => {
    const unlockBtn = document.getElementById('btn-unlock-loop-header');
    if (unlockBtn) {
      unlockBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      unlockBtn.classList.add('ring-4', 'ring-[#FCA311]', 'scale-105');
      setTimeout(() => {
        unlockBtn.classList.remove('ring-4', 'ring-[#FCA311]', 'scale-105');
      }, 1500);
    }
  };

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
      console.warn('Inisialisasi Web Audio Loop:', e);
    }
  }, [bassGain, trebleGain, isCompressor, isReverb, isDelay, isChorus, volume]);

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

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
      audioRef.current.preservesPitch = keepPitch;
      (audioRef.current as any).webkitPreservesPitch = keepPitch;
    }
  }, [speed, keepPitch]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentLoopIteration(1);
      audioRef.current.load();
    }
  }, [activeTrack?.id, loopAudioUrl]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (!loopAudioUrl) {
      alert('Berkas loop audio belum diunggah untuk trek ini.');
      return;
    }

    setupWebAudioGraph();

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      if (!isLoopUnlocked && audioRef.current.currentTime >= PREVIEW_LIMIT) {
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
        setCurrentLoopIteration(1);
      }
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => setIsPlaying(false));
    }
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current) return;
    const cur = audioRef.current.currentTime;
    setCurrentTime(cur);

    if (!isLoopUnlocked && cur >= PREVIEW_LIMIT) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentLoopIteration(1);
    }
  };

  const handleAudioEnded = () => {
    if (!audioRef.current) return;

    if (currentLoopIteration < maxLoopCount) {
      setCurrentLoopIteration((prev) => prev + 1);
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    } else {
      setIsPlaying(false);
      audioRef.current.currentTime = 0;
      setCurrentTime(0);
      setCurrentLoopIteration(1);
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = Number(e.target.value);
    setCurrentTime(target);
    if (audioRef.current) audioRef.current.currentTime = target;
  };

  const handleDownloadProcessedLoop = async (format: string) => {
    if (!loopAudioUrl) return;
    setShowDownloadMenu(false);
    setIsExporting(true);

    try {
      const response = await fetch(loopAudioUrl);
      const arrayBuffer = await response.arrayBuffer();
      const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const decodedBuffer = await tempCtx.decodeAudioData(arrayBuffer);
      await tempCtx.close();

      const singleLoopDuration = decodedBuffer.duration / speed;
      const totalLoopDuration = singleLoopDuration * maxLoopCount;
      const tailSec = isReverb || isDelay ? 1.5 : 0.2;
      const sampleRate = decodedBuffer.sampleRate;
      const targetLength = Math.ceil(sampleRate * (totalLoopDuration + tailSec));

      const offlineCtx = new OfflineAudioContext(decodedBuffer.numberOfChannels, targetLength, sampleRate);

      const bass = offlineCtx.createBiquadFilter();
      bass.type = 'lowshelf';
      bass.frequency.value = 250;
      bass.gain.value = bassGain;

      const treble = offlineCtx.createBiquadFilter();
      treble.type = 'highshelf';
      treble.frequency.value = 3200;
      treble.gain.value = trebleGain;

      const comp = offlineCtx.createDynamicsCompressor();
      comp.threshold.value = isCompressor ? -24 : 0;
      comp.ratio.value = isCompressor ? 8 : 1;

      const masterOut = offlineCtx.createGain();
      masterOut.gain.value = 1.0;

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

      bass.connect(treble);
      treble.connect(comp);
      comp.connect(masterOut);
      comp.connect(convolver);
      comp.connect(delay);
      comp.connect(chorusDelay);
      masterOut.connect(offlineCtx.destination);

      for (let i = 0; i < maxLoopCount; i++) {
        const source = offlineCtx.createBufferSource();
        source.buffer = decodedBuffer;
        source.playbackRate.value = speed;
        source.connect(bass);
        source.start(i * singleLoopDuration);
      }

      const renderedBuffer = await offlineCtx.startRendering();
      const cleanTitle = (activeTrack.title || 'Track').replace(/[^a-zA-Z0-9_-]/g, '_');
      await exportAudioFile(renderedBuffer, `${cleanTitle}_Loop_${maxLoopCount}x`, format as any);
    } catch {
      alert('Gagal mengekspor loop audio.');
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
    <div className="rounded-3xl bg-gradient-to-b from-[#14213D]/80 via-black to-[#090D16] border border-white/10 p-6 sm:p-8 shadow-2xl space-y-6">
      <audio
        ref={audioRef}
        src={loopAudioUrl}
        crossOrigin="anonymous"
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={handleAudioEnded}
      />

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-[#FCA311]/15 border border-[#FCA311]/30 flex items-center justify-center text-[#FCA311] shadow-inner">
            <Radio className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Seamless Loop Version
              </h3>
              {isLoopUnlocked ? (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <CheckCircle2 className="w-3 h-3" /> Full Loop Aktif
                </span>
              ) : (
                <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                  <Lock className="w-3 h-3" /> Preview 7 Detik
                </span>
              )}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              Potongan looping presisi tanpa jeda untuk musik latar konten, game, podcast, dan siaran streaming.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isLoopUnlocked ? (
            <>
              <div className="relative">
                <button
                  disabled={isExporting}
                  onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-500 text-black font-extrabold text-xs hover:bg-emerald-400 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                >
                  {isExporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  <span>Unduh Loop</span>
                  <ChevronDown className="w-3 h-3" />
                </button>
                {showDownloadMenu && !isExporting && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl bg-[#14213D] border border-white/15 p-1.5 shadow-2xl z-30 text-xs">
                    <p className="text-[10px] uppercase font-bold text-[#FCA311] px-2.5 py-1">
                      Render Loop ({maxLoopCount}x):
                    </p>
                    {['WAV', 'MP3', 'FLAC', 'M4A'].map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => handleDownloadProcessedLoop(fmt)}
                        className="w-full text-left px-2.5 py-1.5 rounded-lg text-white hover:bg-[#FCA311] hover:text-black font-semibold flex justify-between cursor-pointer"
                      >
                        <span>Loop .{fmt}</span>
                        <span className="text-[10px] opacity-70">{maxLoopCount}x Loop</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowDspPanel(!showDspPanel)}
                className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  showDspPanel ? 'bg-[#FCA311] text-black' : 'bg-white/10 text-white hover:bg-white/20'
                }`}
              >
                <Sliders className="w-3.5 h-3.5" />
                <span>Studio FX Rack</span>
              </button>
            </>
          ) : (
            <button
              id="btn-unlock-loop-header"
              type="button"
              onClick={() => onNavigateToPricing('loopVersion')}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FCA311] text-black font-extrabold text-xs hover:brightness-110 shadow-lg shadow-amber-500/20 cursor-pointer transition-all duration-300"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Buka Seamless Loop</span>
            </button>
          )}
        </div>
      </div>

      <div className="space-y-2 bg-black/40 p-4 rounded-2xl border border-white/5">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-gray-400 w-10 text-right">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={effectiveMaxDuration}
            step={0.1}
            value={currentTime}
            onChange={handleSeek}
            className="flex-1 h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FCA311]"
          />
          <span className="text-xs font-mono text-gray-400 w-10">{formatTime(effectiveMaxDuration)}</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
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
                  setCurrentLoopIteration(1);
                }
              }}
              title="Mulai dari awal"
              className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Selector Ulangi Loop (1x Gratis, 2x & 3x Mengarahkan ke Buka Seamless Loop) */}
            <div className="flex items-center gap-1.5 bg-white/5 px-2.5 py-1.5 rounded-xl border border-white/5">
              <Repeat className="w-3.5 h-3.5 text-[#FCA311]" />
              <span className="text-xs text-gray-300 font-bold mr-1">Ulangi:</span>
              {([1, 2, 3] as const).map((count) => {
                const isLockedCount = !isLoopUnlocked && count > 1;

                return (
                  <button
                    key={count}
                    type="button"
                    onClick={() => {
                      if (isLockedCount) {
                        scrollToUnlockHeader();
                        return;
                      }
                      setMaxLoopCount(count);
                      setCurrentLoopIteration(1);
                    }}
                    title={isLockedCount ? `Buka lisensi loop untuk pengulangan ${count}x` : `Ulangi ${count} kali`}
                    className={`px-2 py-1 rounded-lg text-xs font-mono font-black transition-all cursor-pointer flex items-center gap-1 ${
                      maxLoopCount === count
                        ? 'bg-[#FCA311] text-black shadow'
                        : isLockedCount
                        ? 'bg-black/30 text-gray-500 hover:text-amber-300'
                        : 'bg-black/50 text-gray-400 hover:text-white'
                    }`}
                  >
                    {isLockedCount && <Lock className="w-2.5 h-2.5 text-[#FCA311]" />}
                    <span>{count}x</span>
                  </button>
                );
              })}
              {isPlaying && isLoopUnlocked && (
                <span className="text-[10px] font-mono text-[#FCA311] bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 ml-1">
                  Putaran {currentLoopIteration}/{maxLoopCount}
                </span>
              )}
            </div>
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
                if (audioRef.current) audioRef.current.volume = v;
              }}
              className="w-20 sm:w-24 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FCA311]"
            />
            <span className="text-xs font-mono text-gray-300 w-9 text-right font-semibold">
              {Math.round(volume * 100)}%
            </span>
          </div>
        </div>
      </div>

      {isLoopUnlocked && showDspPanel && (
        <div className="mt-6 pt-6 border-t border-white/10 animate-in fade-in duration-300">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#FCA311]" /> Rak Efek Audio & Equalizer (Loop Studio)
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