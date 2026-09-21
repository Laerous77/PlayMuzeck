// src/components/AudioStudio/ExportPatternModal.tsx
import React, { useEffect, useState } from 'react';
import { X, Download, Loader2, Music, Disc, Sparkles, Repeat } from 'lucide-react';
import { generateMidiFile, exportAudioFile, downloadBlob } from '../../services/exporters';
import { audioEngine, EnvelopeADSR } from '../../services/audioEngine';

export type ExportScope = 'drum' | 'chord' | 'both';

export interface ChordTrackExportData {
  id: number;
  name: string;
  program: number;
  notesPerStep: number[][];
  volume: number;
  adsr: EnvelopeADSR;
  enabled: boolean;
  muted?: boolean;
  solo?: boolean;
}

interface ExportPatternModalProps {
  isOpen: boolean;
  onClose: () => void;
  tab: 'drum' | 'chord';
  exportScope?: ExportScope;
  totalBars?: number;
  stepsPerBar?: number;
  bpm: number;
  drumGrid: { [key: string]: boolean[] };
  chordTracksData?: ChordTrackExportData[];
  drumAdsr?: EnvelopeADSR;
  drumVolume?: number;
  selectedDrumKit?: string;
  onSuccessToast: (msg: string) => void;
  chordProgression?: string[];
  chordProgressionNotes?: number[][];
  instrumentType?: string;
  adsr?: EnvelopeADSR;
  chordVolume?: number;
  selectedProgram?: number;
}

interface GenericMidiEvent {
  step: number;
  note: number;
  velocity: number;
  isDrum?: boolean;
  durationSteps?: number;
  channel?: number;
}

const DEFAULT_DRUM_ADSR: EnvelopeADSR = { attack: 0.002, decay: 0.15, sustain: 0.3, release: 0.12 };

const DRUM_NOTE_MAP: { [key: string]: number } = {
  kick: 36,
  snare: 38,
  clap: 39,
  closedhat: 42,
  openhat: 46,
  tom: 45,
  crash: 49,
  splash: 55,
  ride: 51,
  perc: 60,
  percussion: 60,
  fx: 39,
};

const formatTimeVal = (sec: number): string => {
  return sec < 1 ? `${Math.round(sec * 1000)}ms` : `${sec.toFixed(2)}s`;
};

const scopeLabel = (scope: ExportScope) =>
  scope === 'drum' ? 'Drum Sequencer' : scope === 'chord' ? 'Harmoni Akor' : 'Drum + Akor';

export const ExportPatternModal: React.FC<ExportPatternModalProps> = ({
  isOpen,
  onClose,
  tab,
  exportScope,
  totalBars = 16,
  stepsPerBar = 4,
  bpm,
  drumGrid,
  chordTracksData = [],
  drumAdsr,
  drumVolume = 1.0,
  selectedDrumKit = '80s Kit',
  onSuccessToast,
  instrumentType,
  chordProgressionNotes,
  adsr,
  chordVolume,
  selectedProgram,
}) => {
  const scope: ExportScope = exportScope ?? tab;
  const activeDrumAdsr: EnvelopeADSR = drumAdsr ?? DEFAULT_DRUM_ADSR;
  const totalStepsAvailable = totalBars * stepsPerBar;

  const tracks: ChordTrackExportData[] = chordTracksData.length > 0
    ? chordTracksData
    : [
        {
          id: 1,
          name: instrumentType || 'Piano',
          program: selectedProgram ?? 0,
          notesPerStep: chordProgressionNotes ?? [],
          volume: chordVolume ?? 1.0,
          adsr: adsr ?? { attack: 0.02, decay: 0.25, sustain: 0.65, release: 0.35 },
          enabled: true,
        },
      ];

  const activeTracks = tracks.filter((t) => t.enabled && t.volume > 0);

  const buildDefaultName = (s: ExportScope) => {
    const mainInstName = activeTracks[0]?.name?.replace(/\s+/g, '_') || 'Instrumen';
    return s === 'drum'
      ? 'PlayMuzeck_Drum_Groove'
      : s === 'chord'
      ? `PlayMuzeck_Chord_${mainInstName}`
      : `PlayMuzeck_DrumChord_${mainInstName}`;
  };

  const [fileName, setFileName] = useState(buildDefaultName(scope));
  const [selectedFormat, setSelectedFormat] = useState<'MIDI' | 'WAV' | 'MP3' | 'M4A' | 'FLAC'>('MIDI');
  const [isExporting, setIsExporting] = useState(false);

  const [useFullRange, setUseFullRange] = useState(true);
  const [fromBar, setFromBar] = useState(1);
  const [fromBeat, setFromBeat] = useState(1);
  const [toBar, setToBar] = useState(totalBars);
  const [toBeat, setToBeat] = useState(stepsPerBar);

  const [exportAsLoop, setExportAsLoop] = useState(false);
  const [loopRepeatCount, setLoopRepeatCount] = useState<1 | 2 | 3>(2);

  useEffect(() => {
    if (isOpen) {
      setUseFullRange(true);
      setFromBar(1);
      setFromBeat(1);
      setToBar(totalBars);
      setToBeat(stepsPerBar);
      setExportAsLoop(false);
      setLoopRepeatCount(2);
      setFileName(buildDefaultName(scope));
    }
  }, [isOpen, totalBars, stepsPerBar]);

  const clampedFromStep = useFullRange
    ? 0
    : Math.max(0, Math.min(totalStepsAvailable - 1, (fromBar - 1) * stepsPerBar + (fromBeat - 1)));
  const clampedToStepRaw = useFullRange
    ? totalStepsAvailable - 1
    : Math.max(0, Math.min(totalStepsAvailable - 1, (toBar - 1) * stepsPerBar + (toBeat - 1)));
  const rangeFromStep = Math.min(clampedFromStep, clampedToStepRaw);
  const rangeToStep = Math.max(clampedFromStep, clampedToStepRaw);
  const rangeStepCount = rangeToStep - rangeFromStep + 1;

  const isAudioFormat = selectedFormat !== 'MIDI';
  const effectiveRepeatCount = exportAsLoop && isAudioFormat ? loopRepeatCount : 1;

  if (!isOpen) return null;

  const buildDrumEvents = (fromStep: number, toStep: number): GenericMidiEvent[] => {
    const events: GenericMidiEvent[] = [];
    Object.keys(drumGrid).forEach((instId) => {
      const noteNumber = DRUM_NOTE_MAP[instId] || 36;
      drumGrid[instId].forEach((isActive, step) => {
        if (isActive && step >= fromStep && step <= toStep) {
          events.push({ step: step - fromStep, note: noteNumber, velocity: 105, isDrum: true, durationSteps: 1 });
        }
      });
    });
    return events;
  };

  const buildChordEventsForTrack = (track: ChordTrackExportData, channelIdx: number, fromStep: number, toStep: number): GenericMidiEvent[] => {
    const events: GenericMidiEvent[] = [];
    track.notesPerStep.forEach((notes, step) => {
      if (notes && notes.length > 0 && step >= fromStep && step <= toStep) {
        notes.forEach((note) => {
          events.push({
            step: step - fromStep,
            note,
            velocity: Math.round(95 * track.volume),
            durationSteps: 2,
            channel: channelIdx,
          });
        });
      }
    });
    return events;
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      if (selectedFormat === 'MIDI') {
        const drumEvents = scope === 'drum' || scope === 'both' ? buildDrumEvents(rangeFromStep, rangeToStep) : [];
        const chordEvents: GenericMidiEvent[] = [];

        if (scope === 'chord' || scope === 'both') {
          activeTracks.forEach((track, idx) => {
            chordEvents.push(...buildChordEventsForTrack(track, idx, rangeFromStep, rangeToStep));
          });
        }

        const combinedEvents = [...drumEvents, ...chordEvents];
        const title =
          scope === 'drum'
            ? `PlayMuzeck Drums (${bpm} BPM)`
            : scope === 'chord'
            ? `PlayMuzeck Chords (${bpm} BPM)`
            : `PlayMuzeck Multi-Track (${bpm} BPM)`;

        const programs = activeTracks.map((t) => t.program);
        const midiBlob = generateMidiFile(
          bpm,
          combinedEvents,
          title,
          programs[0] ?? 0,
          programs[1]
        );

        const cleanName = fileName.replace(/[^\w\s.-]/gi, '').trim() || 'PlayMuzeck_Pattern';
        downloadBlob(midiBlob, `${cleanName}.mid`);
        onSuccessToast(`Berkas MIDI "${cleanName}.mid" berhasil diunduh!`);
      } else {
        if (scope === 'chord' || scope === 'both') {
          const ready = await audioEngine.ensureBankLoaded();
          if (!ready) throw new Error('Bank sampel (SoundFont) gagal dimuat.');
        }

        const stepSec = 60 / bpm / 2;
        const totalSteps = rangeStepCount * effectiveRepeatCount;
        const musicalDurationSec = totalSteps * stepSec;

        // JIKA LOOP: Durasi dipotong pas di batas birama (0 detik tail) agar seamless tanpa hening.
        // JIKA BUKAN LOOP: Batasi ekor rilis maksimal 1.0 detik (tanpa padding +0.5s yang memicu hening panjang).
        const tailSec = exportAsLoop
          ? 0
          : Math.min(1.0, Math.max(0.1, activeDrumAdsr.release, ...activeTracks.map((t) => t.adsr.release)));

        const durationSec = musicalDurationSec + tailSec;
        const sampleRate = 44100;
        const offlineCtx = new OfflineAudioContext(2, Math.ceil(sampleRate * durationSec), sampleRate);

        // Skala headroom dinamis agar output tidak distorsi
        const activeLayerCount = Math.max(1, activeTracks.length + (scope === 'drum' || scope === 'both' ? 1 : 0));
        const headroomGain = 0.85 / Math.sqrt(activeLayerCount);

        const master = offlineCtx.createGain();
        master.gain.value = headroomGain;

        // Brickwall limiter untuk menjaga puncak sinyal di bawah -0.5 dB
        const limiter = offlineCtx.createDynamicsCompressor();
        limiter.threshold.value = -0.5;
        limiter.knee.value = 0.0;
        limiter.ratio.value = 20.0;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.05;

        master.connect(limiter);
        limiter.connect(offlineCtx.destination);

        const drumParts = scope === 'drum' || scope === 'both' ? Object.keys(drumGrid) : [];
        const drumBufferByPart: Record<string, AudioBuffer | null> = {};
        await Promise.all(
          drumParts.map(async (part) => {
            drumBufferByPart[part] = await audioEngine.getDrumSampleBuffer(offlineCtx, selectedDrumKit, part);
          })
        );

        const renderDrumHitsForStep = (step: number, time: number) => {
          drumParts.forEach((part) => {
            if (drumGrid[part]?.[step]) {
              audioEngine.renderDrumHitToDestination(
                offlineCtx,
                master,
                part,
                selectedDrumKit,
                time,
                drumVolume,
                drumBufferByPart[part],
                activeDrumAdsr
              );
            }
          });
        };

        for (let rep = 0; rep < effectiveRepeatCount; rep++) {
          const repOffsetSec = rep * rangeStepCount * stepSec;

          for (let localStep = 0; localStep < rangeStepCount; localStep++) {
            const globalStep = rangeFromStep + localStep;
            const time = repOffsetSec + localStep * stepSec;

            if (scope === 'drum' || scope === 'both') {
              renderDrumHitsForStep(globalStep, time);
            }

            if (scope === 'chord' || scope === 'both') {
              const holdSec = stepSec * 1.8;
              activeTracks.forEach((track) => {
                const notes = track.notesPerStep[globalStep];
                if (notes && notes.length > 0) {
                  notes.forEach((note) => {
                    audioEngine.renderChordNoteToDestination(
                      offlineCtx,
                      master,
                      note,
                      track.program,
                      time,
                      holdSec,
                      track.volume,
                      track.adsr
                    );
                  });
                }
              });
            }
          }
        }

        const buffer = await offlineCtx.startRendering();
        await exportAudioFile(buffer, fileName, selectedFormat);
        const loopNote = effectiveRepeatCount > 1 ? ` (diulang ${effectiveRepeatCount}x)` : '';
        onSuccessToast(`Berkas ${selectedFormat} berhasil diekspor${loopNote}!`);
      }

      setIsExporting(false);
      onClose();
    } catch (err: unknown) {
      setIsExporting(false);
      const errorMsg = err instanceof Error ? err.message : 'Gagal mengekspor berkas.';
      alert(`Gagal mengekspor: ${errorMsg}`);
    }
  };

  const ScopeIcon = scope === 'drum' ? Disc : scope === 'chord' ? Music : Sparkles;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl bg-[#14213D] border border-white/[0.12] p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          disabled={isExporting}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#FCA311]/20 text-[#FCA311] flex items-center justify-center">
            <ScopeIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Ekspor Pola {scopeLabel(scope)}</h3>
            <p className="text-xs text-gray-400">
              {scope === 'both'
                ? 'Drum & 4 instrumen digabung dalam satu berkas'
                : 'Pilih format MIDI untuk DAW atau audio langsung'}
            </p>
          </div>
        </div>

        <div className="mb-4 bg-black/40 border border-white/[0.08] rounded-xl p-3 text-[11px] space-y-2">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
            Pengaturan Envelope ADSR:
          </span>

          {(scope === 'chord' || scope === 'both') && (
            <div className="space-y-1.5">
              {activeTracks.map((track, idx) => (
                <div
                  key={track.id || idx}
                  className="flex flex-col sm:flex-row sm:items-center justify-between text-gray-300 bg-white/[0.02] px-2.5 py-1.5 rounded-lg border border-white/[0.04]"
                >
                  <span className="font-bold text-[#FCA311]">
                    {track.name || `Instrumen ${idx + 1}`}:
                  </span>
                  <span className="font-mono text-gray-300 text-[10.5px]">
                    attack = {formatTimeVal(track.adsr.attack)}, decay = {formatTimeVal(track.adsr.decay)}, sustain = {(track.adsr.sustain * 100).toFixed(0)}%, release = {formatTimeVal(track.adsr.release)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {(scope === 'drum' || scope === 'both') && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between text-gray-300 bg-white/[0.02] px-2.5 py-1.5 rounded-lg border border-white/[0.04]">
              <span className="font-bold text-amber-300">
                Drum ({selectedDrumKit}):
              </span>
              <span className="font-mono text-gray-300 text-[10.5px]">
                attack = {formatTimeVal(activeDrumAdsr.attack)}, decay = {formatTimeVal(activeDrumAdsr.decay)}, sustain = {(activeDrumAdsr.sustain * 100).toFixed(0)}%, release = {formatTimeVal(activeDrumAdsr.release)}
              </span>
            </div>
          )}
        </div>

        <div className="space-y-1.5 mb-4">
          <label className="text-xs font-semibold text-gray-300">Nama Berkas</label>
          <div className="flex items-center bg-black/50 rounded-xl border border-white/[0.1] px-3 py-2 text-sm text-white focus-within:border-[#FCA311]">
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              disabled={isExporting}
              className="w-full bg-transparent focus:outline-none text-xs font-mono"
            />
            <span className="text-xs font-mono text-gray-500">
              .{selectedFormat === 'MIDI' ? 'mid' : selectedFormat.toLowerCase()}
            </span>
          </div>
        </div>

        <div className="space-y-1.5 mb-5">
          <label className="text-xs font-semibold text-gray-300">Format Ekspor</label>
          <div className="grid grid-cols-5 gap-1.5">
            {(['MIDI', 'WAV', 'MP3', 'M4A', 'FLAC'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setSelectedFormat(fmt)}
                className={`py-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                  selectedFormat === fmt
                    ? 'bg-[#FCA311] text-black border-[#FCA311] shadow'
                    : 'bg-black/40 text-gray-300 border-white/[0.08] hover:border-white/20'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">
            {selectedFormat === 'MIDI'
              ? 'MIDI multi-channel kompatibel dengan DAW.'
              : 'File audio hasil rendering langsung berkualitas penuh.'}
          </p>
        </div>

        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-300">Rentang Ekspor</label>
            <button
              type="button"
              onClick={() => setUseFullRange(!useFullRange)}
              disabled={isExporting}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors cursor-pointer ${
                useFullRange
                  ? 'bg-[#FCA311] text-black border-[#FCA311]'
                  : 'bg-black/40 text-gray-300 border-white/[0.1] hover:border-white/25'
              }`}
            >
              {useFullRange ? `Penuh (Bar 1–${totalBars})` : 'Kustom'}
            </button>
          </div>

          {!useFullRange && (
            <div className="grid grid-cols-2 gap-3 bg-black/40 border border-white/[0.08] rounded-xl p-3">
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Dari</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1">
                    <span className="text-[9px] text-gray-500 block">Bar</span>
                    <input
                      type="number"
                      min={1}
                      max={totalBars}
                      value={fromBar}
                      disabled={isExporting}
                      onChange={(e) => setFromBar(Math.max(1, Math.min(totalBars, Number(e.target.value) || 1)))}
                      className="w-full bg-black/60 rounded-lg border border-white/[0.1] px-2 py-1.5 text-xs font-mono text-white focus:border-[#FCA311] outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="text-[9px] text-gray-500 block">Beat</span>
                    <input
                      type="number"
                      min={1}
                      max={stepsPerBar}
                      value={fromBeat}
                      disabled={isExporting}
                      onChange={(e) => setFromBeat(Math.max(1, Math.min(stepsPerBar, Number(e.target.value) || 1)))}
                      className="w-full bg-black/60 rounded-lg border border-white/[0.1] px-2 py-1.5 text-xs font-mono text-white focus:border-[#FCA311] outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Sampai</span>
                <div className="flex items-center gap-1.5">
                  <div className="flex-1">
                    <span className="text-[9px] text-gray-500 block">Bar</span>
                    <input
                      type="number"
                      min={1}
                      max={totalBars}
                      value={toBar}
                      disabled={isExporting}
                      onChange={(e) => setToBar(Math.max(1, Math.min(totalBars, Number(e.target.value) || 1)))}
                      className="w-full bg-black/60 rounded-lg border border-white/[0.1] px-2 py-1.5 text-xs font-mono text-white focus:border-[#FCA311] outline-none"
                    />
                  </div>
                  <div className="flex-1">
                    <span className="text-[9px] text-gray-500 block">Beat</span>
                    <input
                      type="number"
                      min={1}
                      max={stepsPerBar}
                      value={toBeat}
                      disabled={isExporting}
                      onChange={(e) => setToBeat(Math.max(1, Math.min(stepsPerBar, Number(e.target.value) || 1)))}
                      className="w-full bg-black/60 rounded-lg border border-white/[0.1] px-2 py-1.5 text-xs font-mono text-white focus:border-[#FCA311] outline-none"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 mb-5">
          <div className="flex items-center justify-between bg-black/40 border border-white/[0.08] rounded-xl px-3.5 py-2.5">
            <div className="flex items-center gap-2.5">
              <Repeat className="w-4 h-4 text-[#FCA311]" />
              <div>
                <p className="text-xs font-bold text-white">Ekspor Sebagai Loop</p>
                <p className="text-[10px] text-gray-400">
                  {isAudioFormat ? 'Ulangi rentang terpilih dalam 1 berkas audio' : 'Khusus format audio'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setExportAsLoop(!exportAsLoop)}
              disabled={isExporting || !isAudioFormat}
              className={`w-11 h-6 rounded-full relative transition-colors cursor-pointer disabled:opacity-30 ${
                exportAsLoop && isAudioFormat ? 'bg-[#FCA311]' : 'bg-white/10'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                  exportAsLoop && isAudioFormat ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          {exportAsLoop && isAudioFormat && (
            <div className="flex items-center gap-2 bg-black/40 border border-white/[0.08] rounded-xl px-3.5 py-2.5">
              <span className="text-[11px] font-bold text-gray-300">Pengulangan:</span>
              <div className="flex items-center gap-1.5">
                {([1, 2, 3] as const).map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setLoopRepeatCount(count)}
                    disabled={isExporting}
                    className={`w-8 h-8 rounded-lg text-xs font-black transition-colors ${
                      loopRepeatCount === count
                        ? 'bg-[#FCA311] text-black border border-[#FCA311]'
                        : 'bg-black/50 text-gray-300 border border-white/[0.1]'
                    }`}
                  >
                    {count}x
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={handleExport}
          disabled={isExporting}
          className="w-full py-3 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-xs shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Membuat berkas...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>
                Unduh Berkas {selectedFormat}
                {exportAsLoop && isAudioFormat ? ` (${loopRepeatCount}x Loop)` : ''}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};