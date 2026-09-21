// src/components/AudioStudio/StemMixer.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Repeat,
  Volume2,
  Lock,
  Download,
  Sliders,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Activity,
  Layers,
  X,
  Loader2,
  FileAudio,
} from 'lucide-react';
import { AudioTrackItem, AudioEntitlements } from '../../types';
import { exportAudioFile } from '../../services/exporters';

interface StemMixerProps {
  activeTrack: AudioTrackItem;
  entitlements: AudioEntitlements;
  onOpenBundlePurchase: () => void;
  onSuccessToast: (msg: string) => void;
}

export interface StemFxState {
  bassGain: number;
  trebleGain: number;
  isReverb: boolean;
  isDelay: boolean;
  isChorus: boolean;
  isFlanger: boolean;
  isPhaser: boolean;
}

interface StemChannelState {
  volume: number;
  pan: number;
  isMuted: boolean;
  isSolo: boolean;
  fx: StemFxState;
}

const defaultStemFxState: StemFxState = {
  bassGain: 0,
  trebleGain: 0,
  isReverb: false,
  isDelay: false,
  isChorus: false,
  isFlanger: false,
  isPhaser: false,
};

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

export const StemMixer: React.FC<StemMixerProps> = ({
  activeTrack,
  entitlements,
  onOpenBundlePurchase,
  onSuccessToast,
}) => {
  const trackIdStr = String(activeTrack?.id || '');
  const trackOwnership = entitlements?.byTrack?.[trackIdStr] || entitlements?.byTrack?.[activeTrack?.id] || {};
  const isStemsUnlocked = Boolean(
    trackOwnership.separatedStems ||
    (entitlements as any)?.separatedStems ||
    (entitlements as any)?.all
  );

  const PREVIEW_LIMIT = 7.0;
  const rawDuration = activeTrack?.durationSec || 168;
  const effectiveMaxDuration = isStemsUnlocked ? rawDuration : PREVIEW_LIMIT;

  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [masterVolume, setMasterVolume] = useState(0.85);

  const baseBpm = Number(activeTrack?.bpm) || 120;
  const [targetBpm, setTargetBpm] = useState<number>(baseBpm);
  const [keepPitch, setKeepPitch] = useState<boolean>(true);

  const [showMasterFxRack, setShowMasterFxRack] = useState<boolean>(true);
  const [masterBassGain, setMasterBassGain] = useState<number>(0);
  const [masterTrebleGain, setMasterTrebleGain] = useState<number>(0);
  const [isMasterReverb, setIsMasterReverb] = useState<boolean>(false);
  const [isMasterDelay, setIsMasterDelay] = useState<boolean>(false);
  const [isMasterChorus, setIsMasterChorus] = useState<boolean>(false);
  const [isMasterFlanger, setIsMasterFlanger] = useState<boolean>(false);
  const [isMasterPhaser, setIsMasterPhaser] = useState<boolean>(false);

  const stems = activeTrack?.stems || [];
  const [channelStates, setChannelStates] = useState<Record<string, StemChannelState>>({});
  const [openStemFxId, setOpenStemFxId] = useState<string | null>(null);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<'WAV' | 'MP3' | 'FLAC' | 'M4A'>('WAV');
  const [exportFileName, setExportFileName] = useState('');
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);

  const stemAudioRefs = useRef<Record<string, HTMLAudioElement>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodesRef = useRef<Record<string, MediaElementAudioSourceNode>>({});
  const channelNodesRef = useRef<Record<string, {
    gainNode: GainNode;
    panNode: StereoPannerNode;
    bassNode: BiquadFilterNode;
    trebleNode: BiquadFilterNode;
    reverbWet: GainNode;
    delayWet: GainNode;
    chorusWet: GainNode;
    flangerWet: GainNode;
    phaserWet: GainNode;
  }>>({});

  const masterBusGainRef = useRef<GainNode | null>(null);
  const masterBassRef = useRef<BiquadFilterNode | null>(null);
  const masterTrebleRef = useRef<BiquadFilterNode | null>(null);
  const masterReverbWetRef = useRef<GainNode | null>(null);
  const masterDelayWetRef = useRef<GainNode | null>(null);
  const masterChorusWetRef = useRef<GainNode | null>(null);
  const masterFlangerWetRef = useRef<GainNode | null>(null);
  const masterPhaserWetRef = useRef<GainNode | null>(null);
  const masterOutGainRef = useRef<GainNode | null>(null);

  const applyFilterGain = (filter: BiquadFilterNode | null | undefined, gainDb: number) => {
    if (!filter) return;
    if (audioCtxRef.current && audioCtxRef.current.state === 'running') {
      try {
        filter.gain.setTargetAtTime(gainDb, audioCtxRef.current.currentTime, 0.015);
      } catch {
        filter.gain.value = gainDb;
      }
    } else {
      filter.gain.value = gainDb;
    }
  };

  useEffect(() => {
    const initial: Record<string, StemChannelState> = {};
    stems.forEach((s) => {
      initial[s.id] = {
        volume: (s.defaultVolume || 80) / 100,
        pan: 0,
        isMuted: false,
        isSolo: false,
        fx: { ...defaultStemFxState },
      };
    });
    setChannelStates(initial);
    setTargetBpm(baseBpm);
    stopAllAudio();
    setCurrentTime(0);
    setOpenStemFxId(null);
  }, [activeTrack?.id]);

  const playbackSpeed = targetBpm > 0 ? targetBpm / baseBpm : 1.0;

  const scrollToStemsBanner = () => {
    const bannerBtn = document.getElementById('btn-buy-stems-banner');
    if (bannerBtn) {
      bannerBtn.scrollIntoView({ behavior: 'smooth', block: 'center' });
      bannerBtn.classList.add('ring-4', 'ring-[#FCA311]', 'scale-105');
      setTimeout(() => bannerBtn.classList.remove('ring-4', 'ring-[#FCA311]', 'scale-105'), 1500);
    }
  };

  const setupWebAudioGraph = () => {
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

      const masterBus = ctx.createGain();
      masterBusGainRef.current = masterBus;

      const masterBass = ctx.createBiquadFilter();
      masterBass.type = 'lowshelf';
      masterBass.frequency.value = 200;
      masterBass.gain.value = masterBassGain;
      masterBassRef.current = masterBass;

      const masterTreble = ctx.createBiquadFilter();
      masterTreble.type = 'highshelf';
      masterTreble.frequency.value = 2800;
      masterTreble.gain.value = masterTrebleGain;
      masterTrebleRef.current = masterTreble;

      const masterOut = ctx.createGain();
      masterOut.gain.value = masterVolume;
      masterOutGainRef.current = masterOut;

      const masterConvolver = ctx.createConvolver();
      masterConvolver.buffer = buildImpulse(ctx, 2.2, 2.0);
      const masterReverbWet = ctx.createGain();
      masterReverbWet.gain.value = isMasterReverb ? 0.5 : 0.0;
      masterReverbWetRef.current = masterReverbWet;

      const masterDelay = ctx.createDelay();
      masterDelay.delayTime.value = 0.28;
      const masterDelayFeedback = ctx.createGain();
      masterDelayFeedback.gain.value = 0.35;
      const masterDelayWet = ctx.createGain();
      masterDelayWet.gain.value = isMasterDelay ? 0.45 : 0.0;
      masterDelayWetRef.current = masterDelayWet;

      masterDelay.connect(masterDelayFeedback);
      masterDelayFeedback.connect(masterDelay);
      masterDelay.connect(masterDelayWet);

      const masterChorusDelay = ctx.createDelay();
      masterChorusDelay.delayTime.value = 0.025;
      const masterChorusLfo = ctx.createOscillator();
      masterChorusLfo.frequency.value = 1.5;
      const masterChorusLfoGain = ctx.createGain();
      masterChorusLfoGain.gain.value = 0.0025;
      masterChorusLfo.connect(masterChorusLfoGain);
      masterChorusLfoGain.connect(masterChorusDelay.delayTime);
      masterChorusLfo.start();
      const masterChorusWet = ctx.createGain();
      masterChorusWet.gain.value = isMasterChorus ? 0.55 : 0.0;
      masterChorusWetRef.current = masterChorusWet;
      masterChorusDelay.connect(masterChorusWet);

      const masterFlangerDelay = ctx.createDelay();
      masterFlangerDelay.delayTime.value = 0.003;
      const masterFlangerLfo = ctx.createOscillator();
      masterFlangerLfo.frequency.value = 0.5;
      const masterFlangerLfoGain = ctx.createGain();
      masterFlangerLfoGain.gain.value = 0.0018;
      masterFlangerLfo.connect(masterFlangerLfoGain);
      masterFlangerLfoGain.connect(masterFlangerDelay.delayTime);
      masterFlangerLfo.start();
      const masterFlangerFeedback = ctx.createGain();
      masterFlangerFeedback.gain.value = 0.4;
      masterFlangerDelay.connect(masterFlangerFeedback);
      masterFlangerFeedback.connect(masterFlangerDelay);
      const masterFlangerWet = ctx.createGain();
      masterFlangerWet.gain.value = isMasterFlanger ? 0.55 : 0.0;
      masterFlangerWetRef.current = masterFlangerWet;
      masterFlangerDelay.connect(masterFlangerWet);

      const phaserFilters: BiquadFilterNode[] = [];
      const masterPhaserLfo = ctx.createOscillator();
      masterPhaserLfo.frequency.value = 0.8;
      const masterPhaserLfoGain = ctx.createGain();
      masterPhaserLfoGain.gain.value = 600;
      masterPhaserLfo.connect(masterPhaserLfoGain);
      masterPhaserLfo.start();

      for (let i = 0; i < 4; i++) {
        const ap = ctx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 1000;
        masterPhaserLfoGain.connect(ap.frequency);
        phaserFilters.push(ap);
      }
      for (let i = 0; i < 3; i++) {
        phaserFilters[i].connect(phaserFilters[i + 1]);
      }
      const masterPhaserWet = ctx.createGain();
      masterPhaserWet.gain.value = isMasterPhaser ? 0.6 : 0.0;
      masterPhaserWetRef.current = masterPhaserWet;
      phaserFilters[3].connect(masterPhaserWet);

      masterBus.connect(masterBass);
      masterBass.connect(masterTreble);

      masterTreble.connect(masterOut);
      masterTreble.connect(masterConvolver);
      masterConvolver.connect(masterReverbWet);
      masterReverbWet.connect(masterOut);

      masterTreble.connect(masterDelay);
      masterDelayWet.connect(masterOut);

      masterTreble.connect(masterChorusDelay);
      masterChorusWet.connect(masterOut);

      masterTreble.connect(masterFlangerDelay);
      masterFlangerWet.connect(masterOut);

      masterTreble.connect(phaserFilters[0]);
      masterPhaserWet.connect(masterOut);

      masterOut.connect(ctx.destination);

      stems.forEach((stem) => {
        const audioEl = stemAudioRefs.current[stem.id];
        if (!audioEl || sourceNodesRef.current[stem.id]) return;

        const source = ctx.createMediaElementSource(audioEl);
        sourceNodesRef.current[stem.id] = source;

        const currentStemState = channelStates[stem.id];

        const bassNode = ctx.createBiquadFilter();
        bassNode.type = 'lowshelf';
        bassNode.frequency.value = 200;
        bassNode.gain.value = currentStemState?.fx.bassGain || 0;

        const trebleNode = ctx.createBiquadFilter();
        trebleNode.type = 'highshelf';
        trebleNode.frequency.value = 2800;
        trebleNode.gain.value = currentStemState?.fx.trebleGain || 0;

        let panNode: StereoPannerNode;
        try {
          panNode = ctx.createStereoPanner();
        } catch {
          panNode = { pan: { value: 0 }, connect: () => {} } as any;
        }

        const gainNode = ctx.createGain();
        gainNode.gain.value = 0.8;

        const stemConvolver = ctx.createConvolver();
        stemConvolver.buffer = masterConvolver.buffer;
        const reverbWet = ctx.createGain();
        reverbWet.gain.value = currentStemState?.fx.isReverb ? 0.5 : 0;
        stemConvolver.connect(reverbWet);

        const stemDelay = ctx.createDelay();
        stemDelay.delayTime.value = 0.28;
        const stemDelayFb = ctx.createGain();
        stemDelayFb.gain.value = 0.35;
        const delayWet = ctx.createGain();
        delayWet.gain.value = currentStemState?.fx.isDelay ? 0.45 : 0;
        stemDelay.connect(stemDelayFb);
        stemDelayFb.connect(stemDelay);
        stemDelay.connect(delayWet);

        const stemChorusDelay = ctx.createDelay();
        stemChorusDelay.delayTime.value = 0.025;
        const chorusWet = ctx.createGain();
        chorusWet.gain.value = currentStemState?.fx.isChorus ? 0.55 : 0;
        masterChorusLfoGain.connect(stemChorusDelay.delayTime);
        stemChorusDelay.connect(chorusWet);

        const stemFlangerDelay = ctx.createDelay();
        stemFlangerDelay.delayTime.value = 0.003;
        const flangerWet = ctx.createGain();
        flangerWet.gain.value = currentStemState?.fx.isFlanger ? 0.55 : 0;
        masterFlangerLfoGain.connect(stemFlangerDelay.delayTime);
        stemFlangerDelay.connect(flangerWet);

        const stemPhaserAp1 = ctx.createBiquadFilter();
        stemPhaserAp1.type = 'allpass';
        stemPhaserAp1.frequency.value = 1000;
        const stemPhaserAp2 = ctx.createBiquadFilter();
        stemPhaserAp2.type = 'allpass';
        stemPhaserAp2.frequency.value = 1000;
        masterPhaserLfoGain.connect(stemPhaserAp1.frequency);
        masterPhaserLfoGain.connect(stemPhaserAp2.frequency);
        stemPhaserAp1.connect(stemPhaserAp2);
        const phaserWet = ctx.createGain();
        phaserWet.gain.value = currentStemState?.fx.isPhaser ? 0.6 : 0;
        stemPhaserAp2.connect(phaserWet);

        source.connect(bassNode);
        bassNode.connect(trebleNode);

        trebleNode.connect(stemConvolver);
        trebleNode.connect(stemDelay);
        trebleNode.connect(stemChorusDelay);
        trebleNode.connect(stemFlangerDelay);
        trebleNode.connect(stemPhaserAp1);

        trebleNode.connect(panNode);
        reverbWet.connect(panNode);
        delayWet.connect(panNode);
        chorusWet.connect(panNode);
        flangerWet.connect(panNode);
        phaserWet.connect(panNode);

        panNode.connect(gainNode);
        gainNode.connect(masterBus);

        channelNodesRef.current[stem.id] = {
          gainNode,
          panNode,
          bassNode,
          trebleNode,
          reverbWet,
          delayWet,
          chorusWet,
          flangerWet,
          phaserWet,
        };
      });
    } catch (e) {
      console.warn('Web Audio API inisialisasi fallback:', e);
    }
  };

  useEffect(() => {
    applyFilterGain(masterBassRef.current, masterBassGain);
  }, [masterBassGain]);

  useEffect(() => {
    applyFilterGain(masterTrebleRef.current, masterTrebleGain);
  }, [masterTrebleGain]);

  useEffect(() => {
    if (masterReverbWetRef.current) masterReverbWetRef.current.gain.value = isMasterReverb ? 0.5 : 0.0;
  }, [isMasterReverb]);

  useEffect(() => {
    if (masterDelayWetRef.current) masterDelayWetRef.current.gain.value = isMasterDelay ? 0.45 : 0.0;
  }, [isMasterDelay]);

  useEffect(() => {
    if (masterChorusWetRef.current) masterChorusWetRef.current.gain.value = isMasterChorus ? 0.55 : 0.0;
  }, [isMasterChorus]);

  useEffect(() => {
    if (masterFlangerWetRef.current) masterFlangerWetRef.current.gain.value = isMasterFlanger ? 0.55 : 0.0;
  }, [isMasterFlanger]);

  useEffect(() => {
    if (masterPhaserWetRef.current) masterPhaserWetRef.current.gain.value = isMasterPhaser ? 0.6 : 0.0;
  }, [isMasterPhaser]);

  useEffect(() => {
    if (masterOutGainRef.current) masterOutGainRef.current.gain.value = masterVolume;
  }, [masterVolume]);

  useEffect(() => {
    const hasSolo = Object.values(channelStates).some((s) => s.isSolo);

    stems.forEach((stem) => {
      const state = channelStates[stem.id];
      const nodes = channelNodesRef.current[stem.id];
      if (!state || !nodes) return;

      const isAudible = hasSolo ? (state.isSolo && !state.isMuted) : !state.isMuted;
      nodes.gainNode.gain.value = isAudible ? state.volume : 0;

      if (nodes.panNode?.pan) {
        nodes.panNode.pan.value = Math.max(-1, Math.min(1, state.pan / 100));
      }

      applyFilterGain(nodes.bassNode, state.fx.bassGain);
      applyFilterGain(nodes.trebleNode, state.fx.trebleGain);

      nodes.reverbWet.gain.value = state.fx.isReverb ? 0.5 : 0;
      nodes.delayWet.gain.value = state.fx.isDelay ? 0.45 : 0;
      nodes.chorusWet.gain.value = state.fx.isChorus ? 0.55 : 0;
      nodes.flangerWet.gain.value = state.fx.isFlanger ? 0.55 : 0;
      nodes.phaserWet.gain.value = state.fx.isPhaser ? 0.6 : 0;
    });
  }, [channelStates, stems]);

  useEffect(() => {
    Object.values(stemAudioRefs.current).forEach((audio) => {
      if (audio) {
        audio.loop = isStemsUnlocked ? isLooping : false;
      }
    });
  }, [isLooping, isStemsUnlocked]);

  const stopAllAudio = () => {
    setIsPlaying(false);
    Object.values(stemAudioRefs.current).forEach((audio) => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  };

  const togglePlayAll = () => {
    setupWebAudioGraph();

    if (isPlaying) {
      setIsPlaying(false);
      Object.values(stemAudioRefs.current).forEach((audio) => audio?.pause());
    } else {
      const startTime = currentTime >= effectiveMaxDuration ? 0 : currentTime;
      setCurrentTime(startTime);

      Object.values(stemAudioRefs.current).forEach((audio) => {
        if (audio) {
          audio.currentTime = startTime;
          audio.playbackRate = playbackSpeed;
          audio.preservesPitch = keepPitch;
          (audio as any).webkitPreservesPitch = keepPitch;
          audio.play().catch(() => {});
        }
      });
      setIsPlaying(true);
    }
  };

  const handleAudioEnded = () => {
    if (isLooping) {
      Object.values(stemAudioRefs.current).forEach((audio) => {
        if (audio) {
          audio.currentTime = 0;
          audio.play().catch(() => {});
        }
      });
      setCurrentTime(0);
      setIsPlaying(true);
    } else {
      stopAllAudio();
    }
  };

  const handleLeadTimeUpdate = (e: React.SyntheticEvent<HTMLAudioElement>) => {
    const cur = e.currentTarget.currentTime;
    setCurrentTime(cur);

    if (!isStemsUnlocked && cur >= PREVIEW_LIMIT) {
      if (isLooping) {
        Object.values(stemAudioRefs.current).forEach((audio) => {
          if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
          }
        });
        setCurrentTime(0);
      } else {
        stopAllAudio();
      }
      return;
    }

    Object.values(stemAudioRefs.current).forEach((audio) => {
      if (audio && !audio.seeking && Math.abs(audio.currentTime - cur) > 0.25) {
        audio.currentTime = cur;
      }
    });

    if (cur >= effectiveMaxDuration) {
      if (isLooping) {
        Object.values(stemAudioRefs.current).forEach((audio) => {
          if (audio) {
            audio.currentTime = 0;
            audio.play().catch(() => {});
          }
        });
        setCurrentTime(0);
      } else {
        stopAllAudio();
      }
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const target = Number(e.target.value);
    setCurrentTime(target);
    Object.values(stemAudioRefs.current).forEach((audio) => {
      if (audio) audio.currentTime = target;
    });
  };

  useEffect(() => {
    Object.values(stemAudioRefs.current).forEach((audio) => {
      if (audio) {
        audio.playbackRate = playbackSpeed;
        audio.preservesPitch = keepPitch;
        (audio as any).webkitPreservesPitch = keepPitch;
      }
    });
  }, [playbackSpeed, keepPitch]);

  const updateChannel = (id: string, partial: Partial<StemChannelState>) => {
    setChannelStates((prev) => ({
      ...prev,
      [id]: { ...prev[id], ...partial },
    }));
  };

  const updateChannelFx = (id: string, partialFx: Partial<StemFxState>) => {
    setChannelStates((prev) => {
      const currentCh = prev[id] || {
        volume: 0.8,
        pan: 0,
        isMuted: false,
        isSolo: false,
        fx: { ...defaultStemFxState },
      };
      return {
        ...prev,
        [id]: {
          ...currentCh,
          fx: { ...currentCh.fx, ...partialFx },
        },
      };
    });
  };

  const resetChannelFx = (id: string) => {
    updateChannelFx(id, { ...defaultStemFxState });
  };

  const hasActiveStemFx = (id: string) => {
    const fx = channelStates[id]?.fx;
    if (!fx) return false;
    return (
      fx.bassGain !== 0 ||
      fx.trebleGain !== 0 ||
      fx.isReverb ||
      fx.isDelay ||
      fx.isChorus ||
      fx.isFlanger ||
      fx.isPhaser
    );
  };

  const handleOpenExportModal = () => {
    if (!isStemsUnlocked) {
      scrollToStemsBanner();
      return;
    }
    const safeTitle = (activeTrack?.title || 'PlayMuzeck_Mix').replace(/\s+/g, '_');
    setExportFileName(`${safeTitle}_StemMix`);
    setIsExportModalOpen(true);
  };

  const handleExecuteExport = async () => {
    setIsRendering(true);
    setRenderProgress(10);

    try {
      const sampleRate = 44100;
      const audioBuffers: { stem: any; buffer: AudioBuffer }[] = [];

      setRenderProgress(20);
      const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();

      try {
        for (const stem of stems) {
          const url = stem.audioUrl || activeTrack?.audioUrl;
          if (!url) continue;
          const res = await fetch(url);
          const ab = await res.arrayBuffer();
          const buf = await tempCtx.decodeAudioData(ab);
          audioBuffers.push({ stem, buffer: buf });
        }
      } finally {
        await tempCtx.close();
      }

      setRenderProgress(45);
      if (audioBuffers.length === 0) {
        throw new Error('Tidak ada berkas audio stem yang dapat dimuat.');
      }

      const maxRawDuration = Math.max(...audioBuffers.map((b) => b.buffer.duration), activeTrack?.durationSec || 60);
      const renderDurationSec = maxRawDuration / playbackSpeed;
      const totalSamples = Math.ceil(sampleRate * renderDurationSec);

      const offlineCtx = new OfflineAudioContext(2, totalSamples, sampleRate);

      const masterBus = offlineCtx.createGain();

      const masterBass = offlineCtx.createBiquadFilter();
      masterBass.type = 'lowshelf';
      masterBass.frequency.value = 200;
      masterBass.gain.value = masterBassGain;

      const masterTreble = offlineCtx.createBiquadFilter();
      masterTreble.type = 'highshelf';
      masterTreble.frequency.value = 2800;
      masterTreble.gain.value = masterTrebleGain;

      const masterOut = offlineCtx.createGain();
      masterOut.gain.value = masterVolume;

      const masterConvolver = offlineCtx.createConvolver();
      masterConvolver.buffer = buildImpulse(offlineCtx, 2.2, 2.0);
      const masterReverbWet = offlineCtx.createGain();
      masterReverbWet.gain.value = isMasterReverb ? 0.5 : 0.0;

      const masterDelay = offlineCtx.createDelay();
      masterDelay.delayTime.value = 0.28;
      const masterDelayFb = offlineCtx.createGain();
      masterDelayFb.gain.value = 0.35;
      const masterDelayWet = offlineCtx.createGain();
      masterDelayWet.gain.value = isMasterDelay ? 0.45 : 0.0;
      masterDelay.connect(masterDelayFb);
      masterDelayFb.connect(masterDelay);
      masterDelay.connect(masterDelayWet);

      const masterChorusDelay = offlineCtx.createDelay();
      masterChorusDelay.delayTime.value = 0.025;
      const masterChorusLfo = offlineCtx.createOscillator();
      masterChorusLfo.frequency.value = 1.5;
      const masterChorusLfoGain = offlineCtx.createGain();
      masterChorusLfoGain.gain.value = 0.0025;
      masterChorusLfo.connect(masterChorusLfoGain);
      masterChorusLfoGain.connect(masterChorusDelay.delayTime);
      masterChorusLfo.start(0);
      const masterChorusWet = offlineCtx.createGain();
      masterChorusWet.gain.value = isMasterChorus ? 0.55 : 0.0;
      masterChorusDelay.connect(masterChorusWet);

      const masterFlangerDelay = offlineCtx.createDelay();
      masterFlangerDelay.delayTime.value = 0.003;
      const masterFlangerLfo = offlineCtx.createOscillator();
      masterFlangerLfo.frequency.value = 0.5;
      const masterFlangerLfoGain = offlineCtx.createGain();
      masterFlangerLfoGain.gain.value = 0.0018;
      masterFlangerLfo.connect(masterFlangerLfoGain);
      masterFlangerLfoGain.connect(masterFlangerDelay.delayTime);
      masterFlangerLfo.start(0);
      const masterFlangerFeedback = offlineCtx.createGain();
      masterFlangerFeedback.gain.value = 0.4;
      masterFlangerDelay.connect(masterFlangerFeedback);
      masterFlangerFeedback.connect(masterFlangerDelay);
      const masterFlangerWet = offlineCtx.createGain();
      masterFlangerWet.gain.value = isMasterFlanger ? 0.55 : 0.0;
      masterFlangerDelay.connect(masterFlangerFeedback);
      masterFlangerDelay.connect(masterFlangerDelay);

      const phaserFilters: BiquadFilterNode[] = [];
      const masterPhaserLfo = offlineCtx.createOscillator();
      masterPhaserLfo.frequency.value = 0.8;
      const masterPhaserLfoGain = offlineCtx.createGain();
      masterPhaserLfoGain.gain.value = 600;
      masterPhaserLfo.connect(masterPhaserLfoGain);
      masterPhaserLfo.start(0);

      for (let i = 0; i < 4; i++) {
        const ap = offlineCtx.createBiquadFilter();
        ap.type = 'allpass';
        ap.frequency.value = 1000;
        masterPhaserLfoGain.connect(ap.frequency);
        phaserFilters.push(ap);
      }
      for (let i = 0; i < 3; i++) {
        phaserFilters[i].connect(phaserFilters[i + 1]);
      }
      const masterPhaserWet = offlineCtx.createGain();
      masterPhaserWet.gain.value = isMasterPhaser ? 0.6 : 0.0;
      phaserFilters[3].connect(masterPhaserWet);

      masterBus.connect(masterBass);
      masterBass.connect(masterTreble);

      masterTreble.connect(masterOut);
      masterTreble.connect(masterConvolver);
      masterConvolver.connect(masterReverbWet);
      masterReverbWet.connect(masterOut);

      masterTreble.connect(masterDelay);
      masterDelayWet.connect(masterOut);

      masterTreble.connect(masterChorusDelay);
      masterChorusWet.connect(masterOut);

      masterTreble.connect(masterFlangerDelay);
      masterFlangerWet.connect(masterOut);

      masterTreble.connect(phaserFilters[0]);
      masterPhaserWet.connect(masterOut);

      masterOut.connect(offlineCtx.destination);

      const hasSolo = Object.values(channelStates).some((s) => s.isSolo);

      for (const { stem, buffer } of audioBuffers) {
        const state = channelStates[stem.id];
        const isAudible = state ? (hasSolo ? (state.isSolo && !state.isMuted) : !state.isMuted) : true;
        const stemVol = isAudible ? (state?.volume ?? 0.8) : 0;

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.playbackRate.value = playbackSpeed;

        const bassNode = offlineCtx.createBiquadFilter();
        bassNode.type = 'lowshelf';
        bassNode.frequency.value = 200;
        bassNode.gain.value = state?.fx.bassGain || 0;

        const trebleNode = offlineCtx.createBiquadFilter();
        trebleNode.type = 'highshelf';
        trebleNode.frequency.value = 2800;
        trebleNode.gain.value = state?.fx.trebleGain || 0;

        let panNode: StereoPannerNode;
        try {
          panNode = offlineCtx.createStereoPanner();
          panNode.pan.value = Math.max(-1, Math.min(1, (state?.pan || 0) / 100));
        } catch {
          panNode = { pan: { value: 0 }, connect: () => {} } as any;
        }

        const gainNode = offlineCtx.createGain();
        gainNode.gain.value = stemVol;

        const stemConvolver = offlineCtx.createConvolver();
        stemConvolver.buffer = masterConvolver.buffer;
        const reverbWet = offlineCtx.createGain();
        reverbWet.gain.value = state?.fx.isReverb ? 0.5 : 0;
        stemConvolver.connect(reverbWet);

        const stemDelay = offlineCtx.createDelay();
        stemDelay.delayTime.value = 0.28;
        const stemDelayFb = offlineCtx.createGain();
        stemDelayFb.gain.value = 0.35;
        const delayWet = offlineCtx.createGain();
        delayWet.gain.value = state?.fx.isDelay ? 0.45 : 0;
        stemDelay.connect(stemDelayFb);
        stemDelayFb.connect(stemDelay);
        stemDelay.connect(delayWet);

        const stemChorusDelay = offlineCtx.createDelay();
        stemChorusDelay.delayTime.value = 0.025;
        const chorusWet = offlineCtx.createGain();
        chorusWet.gain.value = state?.fx.isChorus ? 0.55 : 0;
        masterChorusLfoGain.connect(stemChorusDelay.delayTime);
        stemChorusDelay.connect(chorusWet);

        const stemFlangerDelay = offlineCtx.createDelay();
        stemFlangerDelay.delayTime.value = 0.003;
        const flangerWet = offlineCtx.createGain();
        flangerWet.gain.value = state?.fx.isFlanger ? 0.55 : 0;
        masterFlangerLfoGain.connect(stemFlangerDelay.delayTime);
        stemFlangerDelay.connect(flangerWet);

        const stemPhaserAp1 = offlineCtx.createBiquadFilter();
        stemPhaserAp1.type = 'allpass';
        stemPhaserAp1.frequency.value = 1000;
        const stemPhaserAp2 = offlineCtx.createBiquadFilter();
        stemPhaserAp2.type = 'allpass';
        stemPhaserAp2.frequency.value = 1000;
        masterPhaserLfoGain.connect(stemPhaserAp1.frequency);
        masterPhaserLfoGain.connect(stemPhaserAp2.frequency);
        stemPhaserAp1.connect(stemPhaserAp2);
        const phaserWet = offlineCtx.createGain();
        phaserWet.gain.value = state?.fx.isPhaser ? 0.6 : 0;
        stemPhaserAp2.connect(phaserWet);

        source.connect(bassNode);
        bassNode.connect(trebleNode);

        trebleNode.connect(stemConvolver);
        trebleNode.connect(stemDelay);
        trebleNode.connect(stemChorusDelay);
        trebleNode.connect(stemFlangerDelay);
        trebleNode.connect(stemPhaserAp1);

        trebleNode.connect(panNode);
        reverbWet.connect(panNode);
        delayWet.connect(panNode);
        chorusWet.connect(panNode);
        flangerWet.connect(panNode);
        phaserWet.connect(panNode);

        panNode.connect(gainNode);
        gainNode.connect(masterBus);

        source.start(0);
      }

      setRenderProgress(70);
      const renderedAudioBuffer = await offlineCtx.startRendering();

      setRenderProgress(90);
      await exportAudioFile(renderedAudioBuffer, exportFileName.trim() || 'PlayMuzeck_Mix', selectedFormat);
      
      setRenderProgress(100);
      onSuccessToast(`Berkas ${selectedFormat} dengan seluruh efek berhasil diekspor!`);
      setTimeout(() => {
        setIsRendering(false);
        setIsExportModalOpen(false);
      }, 500);
    } catch (err: unknown) {
      setIsRendering(false);
      const msg = err instanceof Error ? err.message : 'Gagal merender audio.';
      alert(`Gagal mengekspor audio: ${msg}`);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const leadStemId = stems[0]?.id;
  const isAnySoloActive = Object.values(channelStates).some((s) => s.isSolo);

  return (
    <div className="rounded-3xl bg-[#090D16] border border-white/10 p-6 sm:p-8 space-y-6 shadow-2xl">
      {stems.map((stem) => (
        <audio
          key={stem.id}
          ref={(el) => {
            if (el) stemAudioRefs.current[stem.id] = el;
          }}
          src={stem.audioUrl || activeTrack?.audioUrl || ''}
          crossOrigin="anonymous"
          preload="auto"
          loop={isStemsUnlocked ? isLooping : false}
          onEnded={stem.id === leadStemId ? handleAudioEnded : undefined}
          onTimeUpdate={stem.id === leadStemId ? handleLeadTimeUpdate : undefined}
        />
      ))}

      {/* Header Panel */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-black text-white">{activeTrack?.title || 'Stem Mixer'}</h2>
            {isStemsUnlocked ? (
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Full Multi-Track Aktif
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                <Lock className="w-3 h-3" /> Mode Preview 7 Detik
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {activeTrack?.genre || 'General'} • {baseBpm} BPM Asli • {stems.length} Channel Audio Terpisah
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Tombol Master FX Rack (tanpa tulisan Terkunci) */}
          <button
            onClick={() => {
              if (!isStemsUnlocked) {
                scrollToStemsBanner();
                return;
              }
              setShowMasterFxRack(!showMasterFxRack);
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
              !isStemsUnlocked
                ? 'bg-white/5 border-white/10 text-gray-400 hover:border-[#FCA311]/40 hover:text-amber-300'
                : showMasterFxRack
                ? 'bg-[#FCA311] text-black border-[#FCA311] shadow-md shadow-amber-500/20'
                : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10'
            }`}
          >
            {!isStemsUnlocked ? (
              <>
                <Lock className="w-3.5 h-3.5 text-[#FCA311]" />
                <span>Master FX Rack</span>
              </>
            ) : (
              <>
                <Sliders className="w-3.5 h-3.5" />
                <span>Master FX Rack</span>
                {showMasterFxRack ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </>
            )}
          </button>

          {/* Tombol Ekspor Mix */}
          <button
            onClick={handleOpenExportModal}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
              isStemsUnlocked
                ? 'bg-emerald-500 text-black hover:brightness-110 shadow-lg shadow-emerald-500/20'
                : 'bg-white/5 text-gray-400 border border-white/10 hover:border-[#FCA311]/40 hover:text-amber-300'
            }`}
          >
            {isStemsUnlocked ? <Download className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5 text-[#FCA311]" />}
            <span>Ekspor Mix</span>
          </button>
        </div>
      </div>

      {/* Scrubber & Master Controls */}
      <div className="bg-black/40 p-4 rounded-2xl border border-white/5 space-y-3">
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
              onClick={togglePlayAll}
              className="w-12 h-12 rounded-2xl bg-[#FCA311] text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-lg shadow-amber-500/20 cursor-pointer"
            >
              {isPlaying ? <Pause className="w-6 h-6 fill-black" /> : <Play className="w-6 h-6 fill-black ml-0.5" />}
            </button>

            <button
              onClick={() => {
                stopAllAudio();
                setCurrentTime(0);
              }}
              title="Mulai dari awal"
              className="p-2.5 rounded-xl bg-white/5 text-gray-400 hover:text-white hover:bg-white/10 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsLooping(!isLooping)}
              title={isLooping ? 'Matikan Loop' : 'Ulangi Audio (Loop)'}
              className={`p-2.5 rounded-xl transition-all cursor-pointer flex items-center gap-1.5 text-xs font-bold ${
                isLooping
                  ? 'bg-[#FCA311] text-black shadow-md shadow-amber-500/20'
                  : 'bg-white/5 text-gray-400 hover:text-white hover:bg-white/10'
              }`}
            >
              <Repeat className="w-4 h-4" />
              <span>{isLooping ? 'Loop On' : 'Loop'}</span>
            </button>

            <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
              <Volume2 className="w-4 h-4 text-gray-400" />
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={masterVolume}
                onChange={(e) => setMasterVolume(Number(e.target.value))}
                className="w-20 sm:w-24 h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#FCA311]"
              />
              <span className="text-xs font-mono text-gray-300 font-semibold">{Math.round(masterVolume * 100)}%</span>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-xl border border-white/5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400 font-semibold">Tempo:</span>
              <input
                type="number"
                min={40}
                max={240}
                value={targetBpm}
                onChange={(e) => setTargetBpm(Math.max(40, Math.min(240, Number(e.target.value) || baseBpm)))}
                className="w-14 bg-black/60 border border-white/15 rounded px-1.5 py-0.5 text-xs text-white font-mono text-center outline-none focus:border-[#FCA311]"
              />
              <span className="text-xs text-gray-400 font-mono">BPM ({playbackSpeed.toFixed(2)}x)</span>
            </div>

            <label className="flex items-center gap-1.5 text-xs text-gray-300 cursor-pointer pl-2 border-l border-white/10">
              <input
                type="checkbox"
                checked={keepPitch}
                onChange={(e) => setKeepPitch(e.target.checked)}
                className="accent-[#FCA311] rounded cursor-pointer"
              />
              <span>Kunci Nada (Keep Pitch)</span>
            </label>
          </div>
        </div>
      </div>

      {/* Rak Efek Master */}
      {isStemsUnlocked && showMasterFxRack && (
        <div className="p-5 rounded-2xl bg-black/50 border border-white/10 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-white/5 pb-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#FCA311]" />
              <span className="text-xs font-bold text-[#FCA311] uppercase tracking-wider">
                Stem Studio Master FX Rack
              </span>
              <span className="text-[10px] text-gray-400 bg-white/5 px-2 py-0.5 rounded border border-white/10">
                Efek Global (Seluruh Channel)
              </span>
            </div>
            <span className="text-[11px] text-gray-400">7 Modul DSP Master</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 text-xs">
            <div className="bg-white/5 p-2.5 rounded-xl flex flex-col justify-between">
              <div className="flex justify-between text-gray-400 mb-1">
                <span>Bass (Low EQ)</span>
                <span className="font-mono text-white">{masterBassGain > 0 ? `+${masterBassGain}` : masterBassGain} dB</span>
              </div>
              <input
                type="range"
                min={-20}
                max={20}
                step={1}
                value={masterBassGain}
                onChange={(e) => setMasterBassGain(Number(e.target.value))}
                className="w-full h-1 bg-zinc-800 rounded accent-[#FCA311] cursor-pointer"
              />
            </div>

            <div className="bg-white/5 p-2.5 rounded-xl flex flex-col justify-between">
              <div className="flex justify-between text-gray-400 mb-1">
                <span>Treble (High EQ)</span>
                <span className="font-mono text-white">{masterTrebleGain > 0 ? `+${masterTrebleGain}` : masterTrebleGain} dB</span>
              </div>
              <input
                type="range"
                min={-20}
                max={20}
                step={1}
                value={masterTrebleGain}
                onChange={(e) => setMasterTrebleGain(Number(e.target.value))}
                className="w-full h-1 bg-zinc-800 rounded accent-[#FCA311] cursor-pointer"
              />
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setIsMasterReverb(!isMasterReverb)}
                className={`w-full py-2.5 rounded-xl font-bold border transition-colors cursor-pointer text-center ${
                  isMasterReverb ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isMasterReverb ? '✓ Reverb On' : 'Reverb'}
              </button>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setIsMasterDelay(!isMasterDelay)}
                className={`w-full py-2.5 rounded-xl font-bold border transition-colors cursor-pointer text-center ${
                  isMasterDelay ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isMasterDelay ? '✓ Delay On' : 'Delay'}
              </button>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setIsMasterChorus(!isMasterChorus)}
                className={`w-full py-2.5 rounded-xl font-bold border transition-colors cursor-pointer text-center ${
                  isMasterChorus ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isMasterChorus ? '✓ Chorus On' : 'Chorus FX'}
              </button>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setIsMasterFlanger(!isMasterFlanger)}
                className={`w-full py-2.5 rounded-xl font-bold border transition-colors cursor-pointer text-center ${
                  isMasterFlanger ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isMasterFlanger ? '✓ Flanger On' : 'Flanger'}
              </button>
            </div>

            <div className="flex items-end col-span-2 sm:col-span-1">
              <button
                type="button"
                onClick={() => setIsMasterPhaser(!isMasterPhaser)}
                className={`w-full py-2.5 rounded-xl font-bold border transition-colors cursor-pointer text-center ${
                  isMasterPhaser ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                }`}
              >
                {isMasterPhaser ? '✓ Phaser On' : 'Phaser'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Banner Preview jika Belum Beli */}
      {!isStemsUnlocked && (
        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              Mode Preview 7 Detik aktif. Buka paket <strong>Separated Stems</strong> untuk mixing durasi penuh, akses rak efek, dan ekspor multi-track.
            </span>
          </div>
          <button
            id="btn-buy-stems-banner"
            onClick={onOpenBundlePurchase}
            className="px-4 py-1.5 rounded-xl bg-[#FCA311] text-black font-extrabold text-xs hover:brightness-110 cursor-pointer whitespace-nowrap transition-all duration-300"
          >
            Beli Lisensi Stems
          </button>
        </div>
      )}

      {/* Daftar Channel Stems */}
      <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-start">
        {stems.map((stem) => {
          const state = channelStates[stem.id] || {
            volume: 0.8,
            pan: 0,
            isMuted: false,
            isSolo: false,
            fx: { ...defaultStemFxState },
          };
          const fxActive = hasActiveStemFx(stem.id);
          const isFxOpen = openStemFxId === stem.id;
          const isDimmed = isAnySoloActive && !state.isSolo;

          return (
            <div
              key={stem.id}
              className={`p-4 rounded-2xl bg-black/40 border transition-all space-y-3 ${
                isDimmed ? 'opacity-40' : 'opacity-100'
              } ${
                isFxOpen
                  ? 'border-[#FCA311] ring-1 ring-[#FCA311]/40 shadow-xl shadow-amber-500/10'
                  : 'border-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white truncate max-w-[120px]">{stem.name}</span>
                <div className="flex items-center gap-1.5">
                  {fxActive && (
                    <span className="w-2 h-2 rounded-full bg-[#FCA311] animate-pulse" title="Efek instrumen aktif" />
                  )}
                  <span className="text-[10px] text-gray-400 uppercase font-mono">{stem.type || 'SYNTH'}</span>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-gray-400 font-mono">
                  <span>Volume</span>
                  <span>{Math.round(state.volume * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={state.volume}
                  onChange={(e) => updateChannel(stem.id, { volume: Number(e.target.value) })}
                  className="w-full h-1.5 bg-zinc-800 rounded accent-[#FCA311] cursor-pointer"
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-gray-400 font-mono">
                  <span>Pan</span>
                  <span>{state.pan === 0 ? 'C' : state.pan < 0 ? `L${Math.abs(state.pan)}` : `R${state.pan}`}</span>
                </div>
                <input
                  type="range"
                  min={-100}
                  max={100}
                  value={state.pan}
                  onChange={(e) => updateChannel(stem.id, { pan: Number(e.target.value) })}
                  className="w-full h-1.5 bg-zinc-800 rounded accent-[#FCA311] cursor-pointer"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => updateChannel(stem.id, { isMuted: !state.isMuted })}
                  className={`w-9 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    state.isMuted ? 'bg-red-500 text-white border-red-500' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                  }`}
                  title="Mute Channel"
                >
                  M
                </button>

                <button
                  type="button"
                  onClick={() => updateChannel(stem.id, { isSolo: !state.isSolo })}
                  className={`w-9 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                    state.isSolo ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                  }`}
                  title="Solo Channel"
                >
                  S
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (!isStemsUnlocked) {
                      scrollToStemsBanner();
                      return;
                    }
                    setOpenStemFxId(isFxOpen ? null : stem.id);
                  }}
                  className={`flex-1 py-1 rounded-lg text-xs font-bold border transition-all flex items-center justify-center gap-1 cursor-pointer ${
                    !isStemsUnlocked
                      ? 'bg-black/30 border-white/5 text-gray-400 hover:text-[#FCA311] hover:border-[#FCA311]/30'
                      : isFxOpen
                      ? 'bg-[#FCA311] text-black border-[#FCA311]'
                      : fxActive
                      ? 'bg-amber-500/20 text-[#FCA311] border-[#FCA311]/40'
                      : 'bg-white/5 border-white/10 text-gray-300 hover:text-white'
                  }`}
                >
                  {!isStemsUnlocked ? (
                    <>
                      <Lock className="w-3 h-3 text-[#FCA311]" />
                      <span>FX Rack</span>
                    </>
                  ) : (
                    <>
                      <Activity className="w-3 h-3" />
                      <span>FX Rack</span>
                      {isFxOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    </>
                  )}
                </button>
              </div>

              {isStemsUnlocked && isFxOpen && (
                <div className="pt-3 border-t border-white/10 space-y-3 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#FCA311] flex items-center gap-1">
                      <Layers className="w-3 h-3" /> Efek {stem.name}
                    </span>
                    {fxActive && (
                      <button
                        type="button"
                        onClick={() => resetChannelFx(stem.id)}
                        className="text-[10px] text-red-400 hover:text-red-300 underline cursor-pointer"
                      >
                        Reset FX
                      </button>
                    )}
                  </div>

                  <div className="space-y-2 bg-black/50 p-2.5 rounded-xl border border-white/5">
                    <div>
                      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                        <span>Bass (Low)</span>
                        <span className="font-mono text-white">{state.fx.bassGain > 0 ? `+${state.fx.bassGain}` : state.fx.bassGain} dB</span>
                      </div>
                      <input
                        type="range"
                        min={-20}
                        max={20}
                        step={1}
                        value={state.fx.bassGain}
                        onChange={(e) => updateChannelFx(stem.id, { bassGain: Number(e.target.value) })}
                        className="w-full h-1 bg-zinc-800 rounded accent-[#FCA311] cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                        <span>Treble (High)</span>
                        <span className="font-mono text-white">{state.fx.trebleGain > 0 ? `+${state.fx.trebleGain}` : state.fx.trebleGain} dB</span>
                      </div>
                      <input
                        type="range"
                        min={-20}
                        max={20}
                        step={1}
                        value={state.fx.trebleGain}
                        onChange={(e) => updateChannelFx(stem.id, { trebleGain: Number(e.target.value) })}
                        className="w-full h-1 bg-zinc-800 rounded accent-[#FCA311] cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => updateChannelFx(stem.id, { isReverb: !state.fx.isReverb })}
                      className={`py-1.5 rounded-lg font-bold border transition-colors cursor-pointer text-center ${
                        state.fx.isReverb ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      {state.fx.isReverb ? '✓ Reverb' : 'Reverb'}
                    </button>

                    <button
                      type="button"
                      onClick={() => updateChannelFx(stem.id, { isDelay: !state.fx.isDelay })}
                      className={`py-1.5 rounded-lg font-bold border transition-colors cursor-pointer text-center ${
                        state.fx.isDelay ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      {state.fx.isDelay ? '✓ Delay' : 'Delay'}
                    </button>

                    <button
                      type="button"
                      onClick={() => updateChannelFx(stem.id, { isChorus: !state.fx.isChorus })}
                      className={`py-1.5 rounded-lg font-bold border transition-colors cursor-pointer text-center ${
                        state.fx.isChorus ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      {state.fx.isChorus ? '✓ Chorus' : 'Chorus'}
                    </button>

                    <button
                      type="button"
                      onClick={() => updateChannelFx(stem.id, { isFlanger: !state.fx.isFlanger })}
                      className={`py-1.5 rounded-lg font-bold border transition-colors cursor-pointer text-center ${
                        state.fx.isFlanger ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      {state.fx.isFlanger ? '✓ Flanger' : 'Flanger'}
                    </button>

                    <button
                      type="button"
                      onClick={() => updateChannelFx(stem.id, { isPhaser: !state.fx.isPhaser })}
                      className={`py-1.5 rounded-lg font-bold border transition-colors cursor-pointer text-center col-span-2 ${
                        state.fx.isPhaser ? 'bg-[#FCA311] text-black border-[#FCA311]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                      }`}
                    >
                      {state.fx.isPhaser ? '✓ Phaser' : 'Phaser'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isExportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="w-full max-w-md max-h-[92vh] overflow-y-auto my-auto rounded-2xl bg-[#14213D] border border-white/[0.12] p-6 shadow-2xl relative space-y-4">
            <button
              onClick={() => !isRendering && setIsExportModalOpen(false)}
              disabled={isRendering}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/50 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FCA311]/20 text-[#FCA311] flex items-center justify-center">
                <FileAudio className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Ekspor Hasil Multi-Track Mix</h3>
                <p className="text-xs text-gray-400">Rendering seluruh DSP aktif ke berkas audio fisik</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Nama Berkas</label>
              <div className="flex items-center bg-black/50 rounded-xl border border-white/[0.1] px-3 py-2 text-sm text-white focus-within:border-[#FCA311]">
                <input
                  type="text"
                  value={exportFileName}
                  onChange={(e) => setExportFileName(e.target.value)}
                  disabled={isRendering}
                  className="w-full bg-transparent focus:outline-none text-xs font-mono"
                  placeholder="Nama berkas unduhan..."
                />
                <span className="text-xs font-mono text-gray-500">.{selectedFormat.toLowerCase()}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-300">Pilih Format Audio</label>
              <div className="grid grid-cols-2 xs:grid-cols-4 gap-2">
                {(['WAV', 'MP3', 'FLAC', 'M4A'] as const).map((fmt) => (
                  <button
                    key={fmt}
                    type="button"
                    onClick={() => setSelectedFormat(fmt)}
                    disabled={isRendering}
                    className={`py-2 px-1 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                      selectedFormat === fmt
                        ? 'bg-[#FCA311] text-black border-[#FCA311] shadow-md'
                        : 'bg-black/40 text-gray-300 border-white/[0.08] hover:border-white/20'
                    }`}
                  >
                    {fmt}
                    <div className="text-[9px] font-normal opacity-80 mt-0.5">
                      {fmt === 'WAV' ? '24-bit PCM' : fmt === 'MP3' ? '320 kbps' : fmt === 'FLAC' ? 'Lossless' : 'AAC Audio'}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-black/40 p-3 rounded-xl border border-white/[0.06] text-[11px] text-gray-400 space-y-1">
              <div className="flex items-center justify-between text-white font-semibold">
                <span>Konfigurasi Render Studio:</span>
                <span className="text-[#FCA311] font-mono">{playbackSpeed.toFixed(2)}x Speed</span>
              </div>
              <p>✓ Seluruh EQ & efek DSP Master maupun per-stem otomatis terbawa.</p>
              <p>✓ Mode <strong>Single-pass</strong> aktif (audio diekspor 1 putaran penuh tanpa pengulangan loop).</p>
            </div>

            {isRendering && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-xs text-gray-300">
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FCA311]" />
                    Merender buffer multi-track offline...
                  </span>
                  <span className="font-mono text-[#FCA311]">{renderProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden border border-white/[0.08]">
                  <div
                    className="h-full bg-gradient-to-r from-[#FCA311] to-amber-300 transition-all duration-300"
                    style={{ width: `${renderProgress}%` }}
                  />
                </div>
              </div>
            )}

            <button
              onClick={handleExecuteExport}
              disabled={isRendering}
              className="w-full py-3 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              {isRendering ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Memproses Audio...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Render & Unduh {selectedFormat}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};