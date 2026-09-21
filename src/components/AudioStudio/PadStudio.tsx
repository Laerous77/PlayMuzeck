// src/components/AudioStudio/PadStudio.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Lock,
  Sparkles,
  RotateCcw,
  Repeat,
  Music,
  Download,
  Plus,
  Minus,
  Volume2,
  Disc,
  Sliders,
  X,
  Check,
  Activity,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { AudioEntitlements } from '../../types';
import {
  audioEngine,
  INSTRUMENTS_128,
  NOTE_ROOTS,
  CHORD_QUALITIES,
  CHORD_TENSIONS,
  CHORD_INVERSIONS,
  ChordFormulaDef,
  EnvelopeADSR,
  buildHarmonicChord,
  SOUND_BANK_READY_MESSAGE,
} from '../../services/audioEngine';
import { ExportPatternModal, ChordTrackExportData } from './ExportPatternModal';

interface PadStudioProps {
  entitlements: AudioEntitlements;
  onUnlockEditor: () => void;
  onSuccessToast: (msg: string) => void;
}

type PadTab = 'drum' | 'chord';

export interface DrumInstrument {
  id: 'kick' | 'snare' | 'clap' | 'closedhat' | 'openhat' | 'tom' | 'splash' | 'ride' | 'perc' | 'fx';
  label: string;
  keyHint: string;
}

export const DRUM_INSTRUMENTS: DrumInstrument[] = [
  { id: 'kick', label: 'Kick', keyHint: 'Q' },
  { id: 'snare', label: 'Snare', keyHint: 'W' },
  { id: 'clap', label: 'Clap', keyHint: 'E' },
  { id: 'closedhat', label: 'Closed Hat', keyHint: 'R' },
  { id: 'openhat', label: 'Open Hat', keyHint: 'T' },
  { id: 'tom', label: 'Tom', keyHint: 'Y' },
  { id: 'splash', label: 'Splash', keyHint: 'U' },
  { id: 'ride', label: 'Ride', keyHint: 'I' },
  { id: 'perc', label: 'Percussion', keyHint: 'O' },
  { id: 'fx', label: 'FX / Impact', keyHint: 'P' },
];

export const DRUM_KITS = [
  '80s Kit',
  'Ambient',
  'Industrial',
  'Breakbeat',
  'Jazzy',
  'Electro',
  'Hiphop',
];

export const STEPS_PER_BAR = 4;
export const TOTAL_BARS = 16;
export const TOTAL_STEPS = STEPS_PER_BAR * TOTAL_BARS;

const INSTRUMENT_CATEGORIES = Array.from(new Set(INSTRUMENTS_128.map((inst) => inst.category)));

interface ChordTrackState {
  id: number;
  label: string;
  enabled: boolean;
  program: number;
  volume: number;
  muted: boolean;
  solo: boolean;
  adsr: EnvelopeADSR;
  steps: number[];
}

export const PadStudio: React.FC<PadStudioProps> = ({
  entitlements,
  onUnlockEditor,
  onSuccessToast,
}) => {
  const isUnlocked8Bar = entitlements?.fullEditor8Bar;
  const [activeTab, setActiveTab] = useState<PadTab>('drum');
  const [bpm, setBpm] = useState(115);

  const [isDrumLoopActive, setIsDrumLoopActive] = useState(false);
  const [isChordLoopActive, setIsChordLoopActive] = useState(false);
  const [isSeqLooping, setIsSeqLooping] = useState(true);

  const [loopStartBar, setLoopStartBar] = useState<number>(1);
  const [loopStartBeat, setLoopStartBeat] = useState<number>(1);
  const [loopEndBar, setLoopEndBar] = useState<number>(TOTAL_BARS);
  const [loopEndBeat, setLoopEndBeat] = useState<number>(STEPS_PER_BAR);

  const [drumVolume, setDrumVolume] = useState(85);
  const [chordMasterVolume, setChordMasterVolume] = useState(80);

  // ADSR Drum Mandiri
  const [drumAttackVal, setDrumAttackVal] = useState(0.002);
  const [drumDecayVal, setDrumDecayVal] = useState(0.15);
  const [drumSustainVal, setDrumSustainVal] = useState(0.3);
  const [drumReleaseVal, setDrumReleaseVal] = useState(0.12);

  const [showEnvelopePanel, setShowEnvelopePanel] = useState(false);

  // 4 Track Progresi Akor Mandiri
  const [chordTracks, setChordTracks] = useState<ChordTrackState[]>([
    {
      id: 1,
      label: 'Progresi Akor 1',
      enabled: true,
      program: 0,
      volume: 80,
      muted: false,
      solo: false,
      adsr: { attack: 0.02, decay: 0.25, sustain: 0.65, release: 0.35 },
      steps: (() => {
        const arr = Array(TOTAL_STEPS).fill(-1);
        arr[0] = 0;
        arr[4] = 1;
        arr[8] = 2;
        arr[12] = 3;
        return arr;
      })(),
    },
    {
      id: 2,
      label: 'Progresi Akor 2',
      enabled: false,
      program: 12,
      volume: 65,
      muted: false,
      solo: false,
      adsr: { attack: 0.05, decay: 0.4, sustain: 0.8, release: 0.9 },
      steps: Array(TOTAL_STEPS).fill(-1),
    },
    {
      id: 3,
      label: 'Progresi Akor 3',
      enabled: false,
      program: 48,
      volume: 70,
      muted: false,
      solo: false,
      adsr: { attack: 0.1, decay: 0.5, sustain: 0.75, release: 1.2 },
      steps: Array(TOTAL_STEPS).fill(-1),
    },
    {
      id: 4,
      label: 'Progresi Akor 4',
      enabled: false,
      program: 32,
      volume: 75,
      muted: false,
      solo: false,
      adsr: { attack: 0.03, decay: 0.3, sustain: 0.7, release: 0.8 },
      steps: Array(TOTAL_STEPS).fill(-1),
    },
  ]);

  const [currentStep, setCurrentStep] = useState<number>(0);
  const [activePadAnim, setActivePadAnim] = useState<string | null>(null);

  const [selectedDrumKit, setSelectedDrumKit] = useState('80s Kit');
  const [engineStatus, setEngineStatus] = useState<string>('');

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [exportScope, setExportScope] = useState<'drum' | 'chord' | 'both'>('both');

  const sequencerScrollRef = useRef<HTMLDivElement | null>(null);
  const stepRef = useRef(0);

  // Bus Gain khusus live playback 4 track akor
  const chordBusGainRef = useRef<GainNode | null>(null);

  const getChordBusNode = (ctx: AudioContext): GainNode => {
    if (!chordBusGainRef.current) {
      const g = ctx.createGain();
      g.gain.value = 1.0;
      g.connect(ctx.destination);
      chordBusGainRef.current = g;
    }
    return chordBusGainRef.current;
  };

  const stopAllLiveChords = () => {
    try {
      const ctx = audioEngine.getAudioContext();
      if (chordBusGainRef.current) {
        const now = ctx.currentTime;
        chordBusGainRef.current.gain.cancelScheduledValues(now);
        chordBusGainRef.current.gain.setValueAtTime(chordBusGainRef.current.gain.value, now);
        chordBusGainRef.current.gain.linearRampToValueAtTime(0.0001, now + 0.04);

        const newGain = ctx.createGain();
        newGain.gain.value = 1.0;
        newGain.connect(ctx.destination);
        chordBusGainRef.current = newGain;
      }
      audioEngine.stopAllChords(0.04);
      audioEngine.stopAllChords(0.04, 'progresi2');
    } catch {
      // Abaikan jika context belum aktif
    }
  };

  const [padChords, setPadChords] = useState<ChordFormulaDef[]>([
    { root: 'A', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'F', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'C', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'G', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'D', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'E', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'Bb', type: 'maj', tension: 'none', bass: 'none', inversion: 1, octaveOffset: 0 },
    { root: 'E', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'C', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'G', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'F', type: 'maj', tension: 'maj7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'D', type: 'min', tension: '7', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'A', type: 'min', tension: '7', bass: 'none', inversion: 1, octaveOffset: 0 },
    { root: 'Eb', type: 'maj', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
    { root: 'Bb', type: 'maj', tension: '7', bass: 'none', inversion: 0, octaveOffset: -1 },
    { root: 'G', type: 'min', tension: 'none', bass: 'none', inversion: 0, octaveOffset: 0 },
  ]);

  const [editingPadIndex, setEditingPadIndex] = useState<number | null>(null);
  const [draftChord, setDraftChord] = useState<ChordFormulaDef>({
    root: 'C',
    type: 'maj',
    tension: 'none',
    bass: 'none',
    inversion: 0,
    octaveOffset: 0,
  });

  const [drumGrid, setDrumGrid] = useState<{ [key: string]: boolean[] }>(() => {
    const initial: { [key: string]: boolean[] } = {};
    DRUM_INSTRUMENTS.forEach((inst) => {
      initial[inst.id] = Array(TOTAL_STEPS).fill(false);
    });
    initial['kick'][0] = true;
    initial['kick'][4] = true;
    initial['snare'][2] = true;
    initial['snare'][6] = true;
    for (let i = 0; i < 8; i++) initial['closedhat'][i] = true;
    return initial;
  });

  // Sinkronisasi ADSR Drum ke AudioEngine
  useEffect(() => {
    if (audioEngine.drumAdsr) {
      audioEngine.drumAdsr.attack = drumAttackVal;
      audioEngine.drumAdsr.decay = drumDecayVal;
      audioEngine.drumAdsr.sustain = drumSustainVal;
      audioEngine.drumAdsr.release = drumReleaseVal;
    }
  }, [drumAttackVal, drumDecayVal, drumSustainVal, drumReleaseVal]);

  useEffect(() => {
    let hideTimer: number | undefined;
    audioEngine.initBank((msg: string) => {
      setEngineStatus(msg);
      if (msg === SOUND_BANK_READY_MESSAGE) {
        hideTimer = window.setTimeout(() => setEngineStatus(''), 2000);
      }
    });
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  const updateTrack = (trackIndex: number, updates: Partial<ChordTrackState>) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], ...updates };
      return copy;
    });
  };

  const updateTrackAdsr = (trackIndex: number, adsrUpdates: Partial<EnvelopeADSR>) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = {
        ...copy[trackIndex],
        adsr: { ...copy[trackIndex].adsr, ...adsrUpdates },
      };
      return copy;
    });
  };

  const toggleMute = (trackIndex: number) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], muted: !copy[trackIndex].muted };
      return copy;
    });
  };

  const toggleSolo = (trackIndex: number) => {
    setChordTracks((prev) => {
      const copy = [...prev];
      copy[trackIndex] = { ...copy[trackIndex], solo: !copy[trackIndex].solo };
      return copy;
    });
  };

  const isTrackAudible = (track: ChordTrackState, allTracks: ChordTrackState[]) => {
    if (!track.enabled || track.muted) return false;
    const anySolo = allTracks.some((t) => t.enabled && t.solo);
    if (anySolo) return track.solo;
    return true;
  };

  const triggerDrum = (type: DrumInstrument['id']) => {
    audioEngine.playDrumSound(type, selectedDrumKit, drumVolume / 100);
    setActivePadAnim(type);
    setTimeout(() => setActivePadAnim(null), 150);
  };

  const triggerChordByIndex = (padIdx: number) => {
    const def = padChords[padIdx];
    if (!def) return;
    const { midiNotes } = buildHarmonicChord(def);
    const mainTrack = chordTracks[0];
    audioEngine.adsr.attack = mainTrack.adsr.attack;
    audioEngine.adsr.decay = mainTrack.adsr.decay;
    audioEngine.adsr.sustain = mainTrack.adsr.sustain;
    audioEngine.adsr.release = mainTrack.adsr.release;

    audioEngine.playChordNotes(midiNotes, mainTrack.program, (mainTrack.volume / 100) * (chordMasterVolume / 100), 1.2);
    setActivePadAnim(`chord-${padIdx}`);
    setTimeout(() => setActivePadAnim(null), 250);
  };

  const toggleDrumStep = (drumId: string, stepIndex: number) => {
    const barIndex = Math.floor(stepIndex / STEPS_PER_BAR);
    if (!isUnlocked8Bar && barIndex > 0) {
      onUnlockEditor();
      return;
    }
    setDrumGrid((prev) => {
      const row = [...prev[drumId]];
      row[stepIndex] = !row[stepIndex];
      return { ...prev, [drumId]: row };
    });
  };

  const setTrackChordStep = (trackIndex: number, stepIndex: number, padIdx: number) => {
    const barIndex = Math.floor(stepIndex / STEPS_PER_BAR);
    if (!isUnlocked8Bar && barIndex > 0) {
      onUnlockEditor();
      return;
    }
    setChordTracks((prev) => {
      const copy = [...prev];
      const stepsCopy = [...copy[trackIndex].steps];
      stepsCopy[stepIndex] = stepsCopy[stepIndex] === padIdx ? -1 : padIdx;
      copy[trackIndex] = { ...copy[trackIndex], steps: stepsCopy };
      return copy;
    });
  };

  const handleSeekStep = (targetStep: number) => {
    const barIdx = Math.floor(targetStep / STEPS_PER_BAR);
    if (!isUnlocked8Bar && barIdx > 0) {
      onUnlockEditor();
      return;
    }
    audioEngine.getAudioContext().resume();
    stepRef.current = targetStep;
    setCurrentStep(targetStep);
  };

  const resetToBeginning = () => {
    const startStep = Math.max(0, (loopStartBar - 1) * STEPS_PER_BAR + (loopStartBeat - 1));
    stepRef.current = startStep;
    setCurrentStep(startStep);
  };

  const toggleDrumLoop = () => {
    audioEngine.getAudioContext().resume();
    setIsDrumLoopActive(!isDrumLoopActive);
  };

  const toggleChordLoop = () => {
    if (!isUnlocked8Bar) {
      onUnlockEditor();
      return;
    }
    audioEngine.getAudioContext().resume();
    if (isChordLoopActive) {
      stopAllLiveChords();
    }
    setIsChordLoopActive(!isChordLoopActive);
  };

  const isAnySeqActive = isDrumLoopActive || isChordLoopActive;

  // Live Sequencer: 4 Track Akor Berbunyi Serentak Tanpa Saling Mencekik
  useEffect(() => {
    let interval: number | null = null;
    if (isAnySeqActive) {
      const stepDurationMs = (60 / bpm / 2) * 1000;
      interval = window.setInterval(() => {
        const step = stepRef.current;
        setCurrentStep(step);

        if (isDrumLoopActive) {
          DRUM_INSTRUMENTS.forEach((inst) => {
            if (drumGrid[inst.id]?.[step]) {
              audioEngine.playDrumSound(inst.id, selectedDrumKit, drumVolume / 100);
            }
          });
        }

        if (isChordLoopActive) {
          const ctx = audioEngine.getAudioContext();
          const chordBus = getChordBusNode(ctx);
          const stepDurationSec = (stepDurationMs / 1000) * 1.5;

          chordTracks.forEach((track) => {
            if (!isTrackAudible(track, chordTracks)) return;

            const padIdx = track.steps[step];
            if (padIdx >= 0 && padChords[padIdx]) {
              const chordDef = padChords[padIdx];
              const { midiNotes } = buildHarmonicChord(chordDef);
              const effectiveVol = (track.volume / 100) * (chordMasterVolume / 100);

              midiNotes.forEach((note) => {
                audioEngine.renderChordNoteToDestination(
                  ctx,
                  chordBus,
                  note,
                  track.program,
                  ctx.currentTime,
                  stepDurationSec,
                  effectiveVol,
                  track.adsr
                );
              });
            }
          });
        }

        const maxSteps = isUnlocked8Bar ? TOTAL_STEPS : STEPS_PER_BAR;
        const nextStep = step + 1;
        const configuredStartStep = Math.max(0, (loopStartBar - 1) * STEPS_PER_BAR + (loopStartBeat - 1));
        const configuredEndStep = Math.min(maxSteps - 1, (loopEndBar - 1) * STEPS_PER_BAR + (loopEndBeat - 1));
        const activeLoopTarget = nextStep > configuredEndStep ? configuredStartStep : nextStep;

        if (nextStep >= maxSteps || step >= configuredEndStep) {
          if (isSeqLooping) {
            stepRef.current = configuredStartStep;
            setCurrentStep(configuredStartStep);
          } else {
            setIsDrumLoopActive(false);
            setIsChordLoopActive(false);
            stopAllLiveChords();
            stepRef.current = 0;
            setCurrentStep(0);
          }
        } else {
          stepRef.current = activeLoopTarget;
        }
      }, stepDurationMs);
    }

    return () => {
      if (interval !== null) clearInterval(interval);
    };
  }, [
    isAnySeqActive,
    isDrumLoopActive,
    isChordLoopActive,
    bpm,
    isUnlocked8Bar,
    isSeqLooping,
    drumGrid,
    chordTracks,
    padChords,
    selectedDrumKit,
    drumVolume,
    chordMasterVolume,
    loopStartBar,
    loopStartBeat,
    loopEndBar,
    loopEndBeat,
  ]);

  const handleClearGrid = () => {
    stopAllLiveChords();

    if (activeTab === 'drum') {
      const cleared: { [key: string]: boolean[] } = {};
      DRUM_INSTRUMENTS.forEach((inst) => {
        cleared[inst.id] = Array(TOTAL_STEPS).fill(false);
      });
      setDrumGrid(cleared);
    } else {
      setChordTracks((prev) =>
        prev.map((t) => ({ ...t, steps: Array(TOTAL_STEPS).fill(-1) }))
      );
    }
    onSuccessToast('Grid berhasil dibersihkan.');
  };

  const openHarmonicEditor = (padIdx: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingPadIndex(padIdx);
    setDraftChord({ ...padChords[padIdx] });
  };

  const previewDraftChord = (updated: ChordFormulaDef) => {
    setDraftChord(updated);
    const { midiNotes } = buildHarmonicChord(updated);
    audioEngine.playChordNotes(midiNotes, chordTracks[0].program, chordTracks[0].volume / 100, 1.0);
  };

  const applyHarmonicChord = () => {
    if (editingPadIndex === null) return;
    setPadChords((prev) => {
      const copy = [...prev];
      copy[editingPadIndex] = { ...draftChord };
      return copy;
    });
    setEditingPadIndex(null);
    onSuccessToast('Formula akor berhasil diperbarui.');
  };

  const scrollByBar = (direction: 1 | -1) => {
    const el = sequencerScrollRef.current;
    if (!el) return;
    const barWidth = el.scrollWidth / TOTAL_BARS;
    el.scrollBy({ left: barWidth * direction, behavior: 'smooth' });
  };

  const exportChordTracksData: ChordTrackExportData[] = chordTracks.map((t) => {
    const audible = isTrackAudible(t, chordTracks);
    const effVol = audible ? (t.volume / 100) * (chordMasterVolume / 100) : 0;
    const instDef = INSTRUMENTS_128.find((i) => i.id === t.program);
    return {
      id: t.id,
      name: instDef?.name || `Instrumen ${t.id}`,
      program: t.program,
      notesPerStep: t.steps.map((pIdx) => (pIdx >= 0 && padChords[pIdx] ? buildHarmonicChord(padChords[pIdx]).midiNotes : [])),
      volume: effVol,
      adsr: t.adsr,
      enabled: t.enabled,
      muted: t.muted,
      solo: t.solo,
    };
  });

  return (
    <section id="pad-studio-section" className="w-full">
      <div className="rounded-2xl bg-[#14213D] border border-white/[0.08] p-5 sm:p-7 shadow-xl relative overflow-hidden space-y-6">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pb-5 border-b border-white/[0.08]">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-[#FCA311]" />
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Drum Pad & Chord Pad Studio
              </h3>
            </div>
            <p className="text-xs text-gray-300">
              Pilihan 7 genre drum kit dan 10 trigger pad ritmis dengan 4 progresi instrumen independen.
            </p>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 flex-nowrap shrink-0">
            <div className="flex items-center bg-black/60 px-2.5 py-1.5 rounded-xl border border-white/[0.08] gap-1.5 select-none shrink-0">
              <span className="text-xs font-bold text-gray-400 mr-0.5">TEMPO</span>
              <button
                type="button"
                onClick={() => setBpm((p) => Math.max(60, p - 1))}
                className="p-1 rounded-md bg-white/5 hover:bg-white/10 active:bg-[#FCA311] active:text-black text-gray-300"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <input
                type="number"
                min="60"
                max="200"
                value={bpm}
                onChange={(e) => setBpm(Math.max(60, Math.min(200, Number(e.target.value))))}
                className="w-11 bg-transparent text-center font-mono font-black text-sm text-[#FCA311] focus:outline-none"
              />
              <span className="text-[10px] text-gray-400 mr-0.5">BPM</span>
              <button
                type="button"
                onClick={() => setBpm((p) => Math.min(200, p + 1))}
                className="p-1 rounded-md bg-white/5 hover:bg-white/10 active:bg-[#FCA311] active:text-black text-gray-300"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={handleClearGrid}
              className="px-3 py-2 rounded-xl bg-black/60 hover:bg-black/90 text-gray-300 hover:text-white border border-white/[0.08] text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5 text-red-400" />
              <span>Bersihkan Grid</span>
            </button>

            <div className="flex items-center bg-black/60 p-1 rounded-xl border border-white/[0.08] shrink-0">
              <button
                onClick={() => setActiveTab('drum')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  activeTab === 'drum' ? 'bg-[#FCA311] text-black shadow-sm' : 'text-gray-300 hover:text-white'
                }`}
              >
                Drum Pad
              </button>
              <button
                onClick={() => {
                  if (!isUnlocked8Bar) {
                    onUnlockEditor();
                    return;
                  }
                  setActiveTab('chord');
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer ${
                  activeTab === 'chord' ? 'bg-[#FCA311] text-black shadow-sm' : 'text-gray-300 hover:text-white'
                }`}
              >
                {!isUnlocked8Bar && <Lock className="w-3 h-3 text-amber-400" />}
                <span>Chord Pad</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                if (!isUnlocked8Bar) {
                  onUnlockEditor();
                  return;
                }
                setIsExportMenuOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-black/60 hover:bg-black/90 border border-white/[0.12] text-[#FCA311] shadow cursor-pointer shrink-0"
            >
              <Download className="w-3.5 h-3.5 text-[#FCA311]" />
              <span>Ekspor Pola</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-3 p-3.5 rounded-xl bg-black/50 border border-white/[0.08]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/[0.06]">
                <button
                  type="button"
                  onClick={toggleDrumLoop}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isDrumLoopActive ? 'bg-[#FCA311] text-black shadow-md' : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <Disc className="w-3.5 h-3.5" />
                  <span>{isDrumLoopActive ? 'Stop Drum' : 'Drum Loop'}</span>
                </button>
                <div className="flex items-center gap-1.5 pl-1.5 border-l border-white/10">
                  <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={drumVolume}
                    onChange={(e) => setDrumVolume(Number(e.target.value))}
                    className="w-16 sm:w-20 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                  />
                  <span className="text-[10px] font-mono text-gray-300 w-7 text-right">{drumVolume}%</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/[0.06]">
                <button
                  type="button"
                  onClick={toggleChordLoop}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isChordLoopActive ? 'bg-amber-400 text-black shadow-md' : 'bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <Music className="w-3.5 h-3.5" />
                  <span>{isChordLoopActive ? 'Stop Chord' : 'Chord Loop'}</span>
                </button>
                <div className="flex items-center gap-1.5 pl-1.5 border-l border-white/10">
                  <Volume2 className="w-3.5 h-3.5 text-gray-400" />
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={chordMasterVolume}
                    onChange={(e) => setChordMasterVolume(Number(e.target.value))}
                    className="w-16 sm:w-20 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-amber-400"
                  />
                  <span className="text-[10px] font-mono text-gray-300 w-7 text-right">{chordMasterVolume}%</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowEnvelopePanel(!showEnvelopePanel)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                  showEnvelopePanel
                    ? 'bg-[#FCA311] text-black border-[#FCA311]'
                    : 'bg-black/40 text-gray-300 border-white/[0.08] hover:border-white/20'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>Envelope ADSR</span>
              </button>
            </div>

            <div className="flex items-center gap-2 text-xs">
              {isUnlocked8Bar ? (
                <span className="text-emerald-400 font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/30">
                  Full 16-Bar Editor Aktif
                </span>
              ) : (
                <button onClick={onUnlockEditor} className="text-[#FCA311] hover:underline font-semibold cursor-pointer">
                  Buka 16-Bar →
                </button>
              )}
            </div>
          </div>

          {showEnvelopePanel && (
            <div className="pt-3 border-t border-white/10 text-xs space-y-4">
              {activeTab === 'drum' ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <Activity className="w-3 h-3 text-[#FCA311]" />
                    <span>Envelope DRUM KIT ({selectedDrumKit}) — Karakter perkusif</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">A (Attack):</span>
                      <input
                        type="range"
                        min="0.001"
                        max="0.1"
                        step="0.001"
                        value={drumAttackVal}
                        onChange={(e) => setDrumAttackVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                      />
                      <span className="font-mono text-[#FCA311] w-12 text-right">{(drumAttackVal * 1000).toFixed(0)}ms</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">D (Decay):</span>
                      <input
                        type="range"
                        min="0.01"
                        max="2.0"
                        step="0.01"
                        value={drumDecayVal}
                        onChange={(e) => setDrumDecayVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                      />
                      <span className="font-mono text-[#FCA311] w-12 text-right">{(drumDecayVal * 1000).toFixed(0)}ms</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">S (Sustain):</span>
                      <input
                        type="range"
                        min="0.0"
                        max="1.0"
                        step="0.05"
                        value={drumSustainVal}
                        onChange={(e) => setDrumSustainVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                      />
                      <span className="font-mono text-[#FCA311] w-10 text-right">{(drumSustainVal * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                      <span className="text-gray-400 font-bold">R (Release):</span>
                      <input
                        type="range"
                        min="0.02"
                        max="2.0"
                        step="0.02"
                        value={drumReleaseVal}
                        onChange={(e) => setDrumReleaseVal(Number(e.target.value))}
                        className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                      />
                      <span className="font-mono text-[#FCA311] w-12 text-right">{(drumReleaseVal * 1000).toFixed(0)}ms</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {chordTracks.map((track, tIdx) => {
                    if (!track.enabled) return null;
                    const instName = INSTRUMENTS_128.find((i) => i.id === track.program)?.name || `Instrumen ${track.id}`;
                    return (
                      <div key={track.id} className="space-y-2">
                        <div className="flex items-center gap-2 text-[11px] font-bold text-[#FCA311]">
                          <span>Envelope {track.label}: {instName}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">A (Attack):</span>
                            <input
                              type="range"
                              min="0.005"
                              max="5.0"
                              step="0.01"
                              value={track.adsr.attack}
                              onChange={(e) => updateTrackAdsr(tIdx, { attack: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                            />
                            <span className="font-mono text-[#FCA311] w-12 text-right">{(track.adsr.attack * 1000).toFixed(0)}ms</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">D (Decay):</span>
                            <input
                              type="range"
                              min="0.02"
                              max="5.0"
                              step="0.01"
                              value={track.adsr.decay}
                              onChange={(e) => updateTrackAdsr(tIdx, { decay: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                            />
                            <span className="font-mono text-[#FCA311] w-12 text-right">{(track.adsr.decay * 1000).toFixed(0)}ms</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">S (Sustain):</span>
                            <input
                              type="range"
                              min="0.0"
                              max="1.0"
                              step="0.05"
                              value={track.adsr.sustain}
                              onChange={(e) => updateTrackAdsr(tIdx, { sustain: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                            />
                            <span className="font-mono text-[#FCA311] w-10 text-right">{(track.adsr.sustain * 100).toFixed(0)}%</span>
                          </div>
                          <div className="flex items-center justify-between gap-2 bg-black/40 px-3 py-2 rounded-lg border border-white/[0.04]">
                            <span className="text-gray-400 font-bold">R (Release):</span>
                            <input
                              type="range"
                              min="0.05"
                              max="10.0"
                              step="0.05"
                              value={track.adsr.release}
                              onChange={(e) => updateTrackAdsr(tIdx, { release: Number(e.target.value) })}
                              className="flex-1 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                            />
                            <span className="font-mono text-[#FCA311] w-12 text-right">{(track.adsr.release * 1000).toFixed(0)}ms</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs">
            <div className="flex items-center gap-2 text-[#FCA311] font-bold">
              <Repeat className="w-4 h-4" />
              <span>Wilayah Looping (Bar & Beat):</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">Mulai: Bar</span>
                <input
                  type="number"
                  min={1}
                  max={TOTAL_BARS}
                  value={loopStartBar}
                  onChange={(e) => setLoopStartBar(Math.max(1, Math.min(TOTAL_BARS, Number(e.target.value) || 1)))}
                  className="w-12 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-[#FCA311]"
                />
                <span className="text-gray-400">Beat</span>
                <input
                  type="number"
                  min={1}
                  max={STEPS_PER_BAR}
                  value={loopStartBeat}
                  onChange={(e) => setLoopStartBeat(Math.max(1, Math.min(STEPS_PER_BAR, Number(e.target.value) || 1)))}
                  className="w-10 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-[#FCA311]"
                />
              </div>
              <span className="text-gray-500">—</span>
              <div className="flex items-center gap-1.5">
                <span className="text-gray-400">Sampai: Bar</span>
                <input
                  type="number"
                  min={1}
                  max={TOTAL_BARS}
                  value={loopEndBar}
                  onChange={(e) => setLoopEndBar(Math.max(1, Math.min(TOTAL_BARS, Number(e.target.value) || 1)))}
                  className="w-12 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-[#FCA311]"
                />
                <span className="text-gray-400">Beat</span>
                <input
                  type="number"
                  min={1}
                  max={STEPS_PER_BAR}
                  value={loopEndBeat}
                  onChange={(e) => setLoopEndBeat(Math.max(1, Math.min(STEPS_PER_BAR, Number(e.target.value) || 1)))}
                  className="w-10 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-[#FCA311]"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="bg-black/30 p-3.5 rounded-xl border border-white/[0.06] space-y-3">
          {activeTab === 'drum' ? (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-bold text-gray-300">Pilih Drum Kit:</span>
              {DRUM_KITS.map((kit) => (
                <button
                  key={kit}
                  onClick={() => setSelectedDrumKit(kit)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
                    selectedDrumKit === kit
                      ? 'bg-[#FCA311] text-black border-[#FCA311] font-bold shadow'
                      : 'bg-black/50 text-gray-300 border-white/[0.08] hover:border-white/20'
                  }`}
                >
                  {kit}
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                  Preset Instrumen & Mixer Saluran (4 Progresi Akor)
                </span>
                {engineStatus && (
                  <span className="text-[10px] text-[#FCA311] font-mono bg-amber-500/10 px-2 py-0.5 rounded border border-[#FCA311]/20">
                    {engineStatus}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {chordTracks.map((track, tIdx) => {
                  if (!track.enabled) return null;
                  return (
                    <div
                      key={track.id}
                      className="flex items-center justify-between gap-2.5 bg-black/50 border border-white/[0.08] rounded-xl px-3 py-2"
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <span className="text-xs font-bold text-gray-300 shrink-0">
                          {tIdx === 0 ? 'Instrumen 1:' : `Instrumen ${track.id}:`}
                        </span>

                        <select
                          value={track.program}
                          onChange={(e) => {
                            const prg = Number(e.target.value);
                            if (!isUnlocked8Bar && prg > 7) {
                              onUnlockEditor();
                              return;
                            }
                            updateTrack(tIdx, { program: prg });
                          }}
                          className="bg-black/80 text-white text-xs font-medium px-2 py-1 rounded-lg border border-white/[0.15] focus:border-[#FCA311] outline-none min-w-0 flex-1 truncate cursor-pointer"
                        >
                          {INSTRUMENT_CATEGORIES.map((cat) => {
                            const isCatLocked = !isUnlocked8Bar && cat !== 'Piano';
                            return (
                              <optgroup
                                key={cat}
                                label={`${isCatLocked ? '🔒 ' : ''}── ${cat} ──`}
                                className="bg-[#14213D] text-gray-300 font-bold"
                              >
                                {INSTRUMENTS_128.filter((i) => i.category === cat).map((inst) => (
                                  <option
                                    key={inst.id}
                                    value={inst.id}
                                    disabled={isCatLocked}
                                    className={`text-white font-normal bg-black ${isCatLocked ? 'opacity-40 text-gray-500' : ''}`}
                                  >
                                    #{inst.id + 1} {inst.name}
                                  </option>
                                ))}
                              </optgroup>
                            );
                          })}
                        </select>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5 bg-black/60 px-2 py-1 rounded-lg border border-white/[0.06]">
                          <Volume2 className="w-3 h-3 text-gray-400" />
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={track.volume}
                            onChange={(e) => updateTrack(tIdx, { volume: Number(e.target.value) })}
                            className="w-14 h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-[#FCA311]"
                            title={`Volume ${track.label}: ${track.volume}%`}
                          />
                          <span className="text-[10px] font-mono text-gray-300 w-6 text-right">
                            {track.volume}%
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleMute(tIdx)}
                          className={`w-6 h-6 rounded text-[10px] font-black transition-colors cursor-pointer flex items-center justify-center ${
                            track.muted
                              ? 'bg-red-500 text-white'
                              : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                          }`}
                          title={track.muted ? 'Buka Mute' : 'Mute Instrumen'}
                        >
                          M
                        </button>

                        <button
                          type="button"
                          onClick={() => toggleSolo(tIdx)}
                          className={`w-6 h-6 rounded text-[10px] font-black transition-colors cursor-pointer flex items-center justify-center ${
                            track.solo
                              ? 'bg-[#FCA311] text-black font-extrabold'
                              : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'
                          }`}
                          title={track.solo ? 'Buka Isolate' : 'Isolate (Solo) Instrumen'}
                        >
                          S
                        </button>

                        {tIdx > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              updateTrack(tIdx, { enabled: false, steps: Array(TOTAL_STEPS).fill(-1) });
                              stopAllLiveChords();
                            }}
                            className="p-1 rounded text-gray-400 hover:text-red-400 hover:bg-white/5 transition-colors cursor-pointer"
                            title={`Hapus ${track.label}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {chordTracks.some((t) => !t.enabled) && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      if (!isUnlocked8Bar) {
                        onUnlockEditor();
                        return;
                      }
                      const firstDisabledIdx = chordTracks.findIndex((t) => !t.enabled);
                      if (firstDisabledIdx !== -1) {
                        updateTrack(firstDisabledIdx, { enabled: true });
                      }
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-dashed border-[#FCA311]/50 text-[#FCA311] hover:bg-[#FCA311]/10 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Progresi Instrumen ({chordTracks.filter((t) => t.enabled).length + 1}/4)</span>
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06]">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
              {activeTab === 'drum'
                ? `Live Drum Trigger Pads (${selectedDrumKit})`
                : `Live Harmonic Chords — #${chordTracks[0].program + 1} ${INSTRUMENTS_128.find((i) => i.id === chordTracks[0].program)?.name || 'Piano'}`}
            </span>
          </div>

          {activeTab === 'drum' ? (
            <div className="grid grid-cols-5 lg:grid-cols-10 gap-2">
              {DRUM_INSTRUMENTS.map((inst) => (
                <button
                  key={inst.id}
                  onClick={() => triggerDrum(inst.id)}
                  className={`h-20 rounded-xl border flex flex-col items-center justify-between p-2 transition-all cursor-pointer ${
                    activePadAnim === inst.id
                      ? 'bg-[#FCA311] text-black border-[#FCA311] scale-105 shadow-lg'
                      : 'bg-[#14213D] text-white border-white/[0.08] hover:border-[#FCA311]/60'
                  }`}
                >
                  <span className="text-xs font-black tracking-tight text-center leading-tight">{inst.label}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400/80" />
                </button>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
              {padChords.map((chordDef, idx) => {
                const { displayName } = buildHarmonicChord(chordDef);
                const isActive = activePadAnim === `chord-${idx}`;
                return (
                  <div
                    key={idx}
                    onClick={() => triggerChordByIndex(idx)}
                    className={`h-22 rounded-xl border flex flex-col items-center justify-between p-2 transition-all relative group cursor-pointer ${
                      isActive
                        ? 'bg-[#FCA311] text-black border-[#FCA311] scale-105 shadow-lg'
                        : 'bg-[#14213D] text-white border-white/[0.08] hover:border-[#FCA311]/60'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={(e) => openHarmonicEditor(idx, e)}
                      className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/40 hover:bg-[#FCA311] text-gray-300 hover:text-black transition-colors"
                    >
                      <Sliders className="w-3 h-3" />
                    </button>
                    <span className="text-[10px] font-mono text-gray-400 self-start">#{idx + 1}</span>
                    <span className="text-lg font-black tracking-tight my-auto">{displayName}</span>
                    <span className="text-[9px] text-gray-400 truncate max-w-full font-mono">
                      {chordDef.inversion ? `inv${chordDef.inversion}` : 'root'} • {chordDef.octaveOffset ? `oct${chordDef.octaveOffset > 0 ? `+${chordDef.octaveOffset}` : chordDef.octaveOffset}` : 'std'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-gray-200 uppercase tracking-wider">
              {activeTab === 'drum' ? 'Step Sequencer Pola Ketukan' : 'Step Sequencer Progresi Akor (4 Instrumen)'}
            </h4>
            <div className="flex items-center gap-1 bg-black/60 border border-white/10 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => scrollByBar(-1)}
                className="p-1.5 rounded-md bg-white/5 hover:bg-[#FCA311] hover:text-black text-gray-300 transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => scrollByBar(1)}
                className="p-1.5 rounded-md bg-white/5 hover:bg-[#FCA311] hover:text-black text-gray-300 transition-colors"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div ref={sequencerScrollRef} className="overflow-x-auto pt-2 pb-4 px-3 no-scrollbar scroll-smooth">
            <div className="min-w-[1560px] space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-36 shrink-0 text-[10px] font-mono font-bold text-gray-500 uppercase tracking-wider px-1">
                  SEGMEN BAR
                </div>
                <div className="grid grid-cols-64 gap-0.5 flex-1" style={{ gridTemplateColumns: `repeat(${TOTAL_STEPS}, minmax(0, 1fr))` }}>
                  {Array.from({ length: TOTAL_BARS }).map((_, barIdx) => (
                    <div
                      key={barIdx}
                      className="col-span-4 py-1.5 rounded-md border text-center text-xs font-mono font-bold bg-[#14213D] text-[#FCA311] border-[#FCA311]/30"
                    >
                      BAR {barIdx + 1}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="w-36 shrink-0 flex items-center justify-between bg-black/60 border border-white/10 rounded-xl px-2.5 py-1">
                  <span className="text-[11px] font-bold text-[#FCA311] tracking-tight">Titik Putar</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={resetToBeginning}
                      className="p-1 rounded-md bg-white/5 hover:bg-white/15 text-gray-300 transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsSeqLooping(!isSeqLooping)}
                      className={`p-1 rounded-md transition-all ${
                        isSeqLooping ? 'bg-amber-500/20 text-[#FCA311] border border-[#FCA311]/40' : 'bg-white/5 text-gray-500'
                      }`}
                    >
                      <Repeat className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-64 gap-0.5 flex-1" style={{ gridTemplateColumns: `repeat(${TOTAL_STEPS}, minmax(0, 1fr))` }}>
                  {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSeekStep(idx)}
                      className={`h-8 rounded-xs text-xs font-mono font-bold transition-all flex items-center justify-center ${
                        currentStep === idx
                          ? 'bg-[#FCA311] text-black ring-2 ring-white ring-inset z-10 font-black'
                          : idx % 4 === 0
                          ? 'bg-white/15 text-white hover:bg-white/30'
                          : 'bg-black/50 text-gray-400 hover:bg-white/10'
                      }`}
                    >
                      {idx + 1}
                    </button>
                  ))}
                </div>
              </div>

              {activeTab === 'drum' ? (
                <div className="space-y-1.5 pt-1">
                  {DRUM_INSTRUMENTS.map((inst) => (
                    <div key={inst.id} className="flex items-center gap-2">
                      <span className="w-36 text-xs font-semibold text-gray-300 truncate shrink-0 px-1">
                        {inst.label}
                      </span>
                      <div className="grid grid-cols-64 gap-0.5 flex-1" style={{ gridTemplateColumns: `repeat(${TOTAL_STEPS}, minmax(0, 1fr))` }}>
                        {Array.from({ length: TOTAL_STEPS }).map((_, stepIdx) => {
                          const isStepActive = drumGrid[inst.id]?.[stepIdx];
                          return (
                            <button
                              key={stepIdx}
                              onClick={() => toggleDrumStep(inst.id, stepIdx)}
                              className={`h-7 rounded-xs transition-all relative flex items-center justify-center cursor-pointer ${
                                isStepActive
                                  ? 'bg-[#FCA311] text-black font-bold shadow-xs'
                                  : 'bg-black/60 hover:bg-black/90 border border-white/[0.05]'
                              } ${currentStep === stepIdx ? 'ring-2 ring-white ring-inset z-10' : ''}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-2 pt-1">
                  {chordTracks.map((track, tIdx) => {
                    if (!track.enabled) return null;
                    return (
                      <div key={track.id} className="flex items-center gap-2">
                        <div className="w-36 shrink-0 px-1 flex flex-col justify-center">
                          <span className="text-xs font-semibold text-gray-200 truncate">
                            {track.label}
                          </span>
                          <span className="text-[10px] text-[#FCA311] truncate font-mono">
                            {INSTRUMENTS_128.find((i) => i.id === track.program)?.name || 'Piano'}
                          </span>
                        </div>

                        <div className="grid grid-cols-64 gap-0.5 flex-1" style={{ gridTemplateColumns: `repeat(${TOTAL_STEPS}, minmax(0, 1fr))` }}>
                          {Array.from({ length: TOTAL_STEPS }).map((_, stepIdx) => {
                            const assignedPadIdx = track.steps[stepIdx];
                            const isAssigned = assignedPadIdx >= 0 && padChords[assignedPadIdx];
                            const fullChordName = isAssigned ? buildHarmonicChord(padChords[assignedPadIdx]).displayName : '-';
                            const shortChordName = isAssigned ? fullChordName.replace(/\s+/g, '') : '-';

                            return (
                              <div
                                key={stepIdx}
                                className={`h-20 rounded-lg p-1 flex flex-col justify-between items-center transition-all relative ${
                                  isAssigned
                                    ? 'bg-[#FCA311]/20 border border-[#FCA311] text-white shadow-xs'
                                    : 'bg-black/60 border border-white/[0.05] hover:border-white/20'
                                } ${currentStep === stepIdx ? 'ring-2 ring-white ring-inset z-10' : ''}`}
                              >
                                <span className="text-[10px] text-gray-400 font-mono font-bold">#{stepIdx + 1}</span>
                                <div className="w-full flex-1 flex flex-col items-center justify-center relative">
                                  <span
                                    className={`text-[11px] font-black tracking-tight leading-none text-center px-0.5 w-full overflow-hidden ${
                                      isAssigned ? 'text-[#FCA311]' : 'text-gray-500'
                                    }`}
                                    title={fullChordName}
                                  >
                                    {shortChordName}
                                  </span>
                                  <select
                                    value={assignedPadIdx}
                                    onChange={(e) => setTrackChordStep(tIdx, stepIdx, Number(e.target.value))}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  >
                                    <option value={-1} className="bg-black text-gray-400">- Kosongkan -</option>
                                    {padChords.map((ch, pIdx) => (
                                      <option key={pIdx} value={pIdx} className="bg-[#14213D] text-white font-bold">
                                        Pad #{pIdx + 1}: {buildHarmonicChord(ch).displayName}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className={`w-1.5 h-1.5 rounded-full mb-0.5 ${isAssigned ? 'bg-[#FCA311]' : 'bg-transparent'}`} />
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {editingPadIndex !== null && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#14213D] border border-white/20 rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto my-auto shadow-2xl p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-[#FCA311]" />
                <h3 className="font-bold text-white text-base sm:text-lg">
                  Harmonic Chord Editor — Mengedit Pad #{editingPadIndex + 1}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingPadIndex(null)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center justify-between bg-black/60 p-3.5 rounded-xl border border-white/10">
              <div>
                <span className="text-xs text-gray-400 font-mono">Hasil Formula Akor:</span>
                <div className="text-2xl font-black text-[#FCA311]">
                  {buildHarmonicChord(draftChord).displayName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => previewDraftChord(draftChord)}
                className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 border border-white/15 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Test Suara</span>
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-black/40 p-3 rounded-xl border border-white/[0.06] text-xs">
              <div>
                <span className="text-gray-300 font-bold block mb-1">Inversion:</span>
                <div className="grid grid-cols-4 gap-1">
                  {CHORD_INVERSIONS.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, inversion: inv.id })}
                      className={`py-1.5 rounded-lg font-bold text-[10px] cursor-pointer ${
                        (draftChord.inversion || 0) === inv.id
                          ? 'bg-[#FCA311] text-black shadow'
                          : 'bg-black/60 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {inv.id === 0 ? 'Root' : `${inv.id}nd`}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-gray-300 font-bold block mb-1">Octave Shift:</span>
                <div className="grid grid-cols-5 gap-1">
                  {[-2, -1, 0, 1, 2].map((oct) => (
                    <button
                      key={oct}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, octaveOffset: oct })}
                      className={`py-1.5 rounded-lg font-bold text-[10px] cursor-pointer ${
                        (draftChord.octaveOffset || 0) === oct
                          ? 'bg-[#FCA311] text-black shadow'
                          : 'bg-black/60 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {oct === 0 ? 'Base' : oct > 0 ? `+${oct}` : oct}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Root</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  {NOTE_ROOTS.map((root) => (
                    <button
                      key={root}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, root })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        draftChord.root === root ? 'bg-[#FCA311] text-black' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {root}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Quality</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  {CHORD_QUALITIES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, type })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        draftChord.type === type ? 'bg-[#FCA311] text-black' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Tension</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  {CHORD_TENSIONS.map((tension) => (
                    <button
                      key={tension}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, tension })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        (draftChord.tension || 'none') === tension ? 'bg-[#FCA311] text-black' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {tension === 'none' ? 'None' : tension}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="font-bold text-gray-300 block">Bass Note</span>
                <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1 no-scrollbar">
                  <button
                    type="button"
                    onClick={() => previewDraftChord({ ...draftChord, bass: 'none' })}
                    className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                      !draftChord.bass || draftChord.bass === 'none' ? 'bg-[#FCA311] text-black' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                    }`}
                  >
                    Root
                  </button>
                  {NOTE_ROOTS.map((bass) => (
                    <button
                      key={bass}
                      type="button"
                      onClick={() => previewDraftChord({ ...draftChord, bass })}
                      className={`px-3 py-1.5 rounded-lg font-bold text-left transition-colors cursor-pointer ${
                        draftChord.bass === bass ? 'bg-[#FCA311] text-black' : 'bg-black/50 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      /{bass}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 pt-4">
              <button
                type="button"
                onClick={() => setEditingPadIndex(null)}
                className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 text-xs font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={applyHarmonicChord}
                className="px-5 py-2 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-amber-500/20"
              >
                <Check className="w-4 h-4" />
                <span>Simpan ke Pad #{editingPadIndex + 1}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {isExportMenuOpen && isUnlocked8Bar && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="fixed inset-0" onClick={() => setIsExportMenuOpen(false)} />
          <div className="relative w-full max-w-xs rounded-2xl bg-[#14213D] border border-white/[0.12] p-5 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Pilih Cakupan Ekspor</h3>
              <button
                type="button"
                onClick={() => setIsExportMenuOpen(false)}
                className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => {
                  setExportScope('drum');
                  setIsExportMenuOpen(false);
                  setIsExportModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Disc className="w-4 h-4 text-[#FCA311]" />
                <span>Hanya Pola Drum</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportScope('chord');
                  setIsExportMenuOpen(false);
                  setIsExportModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Music className="w-4 h-4 text-[#FCA311]" />
                <span>4 Instrumen Akor</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setExportScope('both');
                  setIsExportMenuOpen(false);
                  setIsExportModalOpen(true);
                }}
                className="w-full text-left px-3.5 py-3 rounded-xl bg-black/50 hover:bg-white/10 border border-white/[0.08] text-xs font-bold text-gray-200 flex items-center gap-2.5 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-[#FCA311]" />
                <span>Drum + Semua Instrumen Akor</span>
              </button>
            </div>
          </div>
        </div>
      )}

      <ExportPatternModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        tab={activeTab}
        exportScope={exportScope}
        totalBars={TOTAL_BARS}
        stepsPerBar={STEPS_PER_BAR}
        bpm={bpm}
        drumGrid={drumGrid}
        chordTracksData={exportChordTracksData}
        drumAdsr={{
          attack: drumAttackVal,
          decay: drumDecayVal,
          sustain: drumSustainVal,
          release: drumReleaseVal,
        }}
        drumVolume={drumVolume / 100}
        selectedDrumKit={selectedDrumKit}
        onSuccessToast={onSuccessToast}
      />
    </section>
  );
};