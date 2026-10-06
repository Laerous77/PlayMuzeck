// src/services/pitchMatchDsp.ts
// Modul DSP untuk evaluasi kecocokan nada (pitch) dan tempo (timing)
// antara audio acuan (reference track) dengan vokal/suara pengguna.

import { detectPitch, detectBpm, detectKey } from './audioExtraDsp';
import { freqToMidi, midiToFreq, noteName, centsOff, pcOf } from './voiceDsp';

export interface ReferencePitchFrame {
  t: number;
  freq: number | null;
  midi: number | null;
}

export interface ReferenceNote {
  id: string;
  start: number;
  end: number;
  duration: number;
  midi: number;
  noteName: string;
  freq: number;
}

export interface ReferenceMelodyProfile {
  duration: number;
  frames: ReferencePitchFrame[];
  notes: ReferenceNote[];
  bpm: number | null;
  keyName: string | null;
}

export type MatchStatus = 'perfect' | 'good' | 'near' | 'octave' | 'miss' | 'silent';

export interface RealtimeMatchFeedback {
  time: number;
  hasReferenceNote: boolean;
  refMidi: number | null;
  refNoteName: string | null;
  refFreq: number | null;
  userMidi: number | null;
  userNoteName: string | null;
  userFreq: number | null;
  centsDiff: number;
  status: MatchStatus;
  statusLabel: string;
}

export interface UserVocalPoint {
  t: number;
  freq: number | null;
  clarity: number;
}

export interface VocalEvaluationResult {
  pitchScore: number;
  timingScore: number;
  overallScore: number;
  perfectPercent: number;
  goodPercent: number;
  nearPercent: number;
  missPercent: number;
  octaveMatchPercent: number;
  avgCentsDeviation: number;
  intonationTendency: 'flat' | 'sharp' | 'balanced';
  tendencyLabel: string;
  totalSingingDurationSec: number;
  matchedNoteNames: string[];
  musicalAdvice: string[];
}

/**
 * Menganalisis file audio acuan untuk mengekstrak kontur nada melodi dan tempo.
 * Dijalankan sekali saat file acuan dimuat.
 */
export async function extractReferenceMelody(
  buffer: AudioBuffer,
  onProgress?: (pct: number) => void
): Promise<ReferenceMelodyProfile> {
  const sr = buffer.sampleRate;
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;

  const mono = new Float32Array(len);
  for (let c = 0; c < numCh; c++) {
    const ch = buffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += ch[i] / numCh;
  }

  const bpmResult = detectBpm([mono], sr);
  const keyResult = detectKey([mono], sr);

  const frameStepSec = 0.04;
  const frameStepSamples = Math.round(frameStepSec * sr);
  const windowSize = 2048;
  const totalFrames = Math.floor((len - windowSize) / frameStepSamples);

  const frames: ReferencePitchFrame[] = [];
  const windowBuf = new Float32Array(windowSize);

  for (let f = 0; f < totalFrames; f++) {
    const startIdx = f * frameStepSamples;
    for (let i = 0; i < windowSize; i++) {
      windowBuf[i] = mono[startIdx + i];
    }

    const pitch = detectPitch(windowBuf, sr, 65, 1100);
    const t = Math.round(f * frameStepSec * 100) / 100;

    if (pitch && pitch.clarity >= 0.78) {
      const midi = Math.round(freqToMidi(pitch.freq));
      frames.push({ t, freq: pitch.freq, midi });
    } else {
      frames.push({ t, freq: null, midi: null });
    }

    if (f % 50 === 0 && onProgress) {
      onProgress(Math.round((f / totalFrames) * 100));
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }

  const notes: ReferenceNote[] = [];
  let curNote: { midi: number; start: number; last: number; freqs: number[] } | null = null;
  const maxGapSec = 0.12;

  for (const fr of frames) {
    if (fr.midi !== null && fr.freq !== null) {
      if (!curNote) {
        curNote = { midi: fr.midi, start: fr.t, last: fr.t, freqs: [fr.freq] };
      } else if (fr.midi === curNote.midi || Math.abs(freqToMidi(fr.freq) - curNote.midi) <= 0.6) {
        curNote.last = fr.t;
        curNote.freqs.push(fr.freq);
      } else {
        const dur = curNote.last - curNote.start;
        if (dur >= 0.08) {
          const avgF = curNote.freqs.reduce((a, b) => a + b, 0) / curNote.freqs.length;
          notes.push({
            id: `ref-note-${notes.length}`,
            start: curNote.start,
            end: curNote.last,
            duration: Math.round(dur * 100) / 100,
            midi: curNote.midi,
            noteName: noteName(curNote.midi),
            freq: Math.round(avgF * 10) / 10,
          });
        }
        curNote = { midi: fr.midi, start: fr.t, last: fr.t, freqs: [fr.freq] };
      }
    } else {
      if (curNote && fr.t - curNote.last > maxGapSec) {
        const dur = curNote.last - curNote.start;
        if (dur >= 0.08) {
          const avgF = curNote.freqs.reduce((a, b) => a + b, 0) / curNote.freqs.length;
          notes.push({
            id: `ref-note-${notes.length}`,
            start: curNote.start,
            end: curNote.last,
            duration: Math.round(dur * 100) / 100,
            midi: curNote.midi,
            noteName: noteName(curNote.midi),
            freq: Math.round(avgF * 10) / 10,
          });
        }
        curNote = null;
      }
    }
  }

  if (curNote) {
    const dur = curNote.last - curNote.start;
    if (dur >= 0.08) {
      const avgF = curNote.freqs.reduce((a, b) => a + b, 0) / curNote.freqs.length;
      notes.push({
        id: `ref-note-${notes.length}`,
        start: curNote.start,
        end: curNote.last,
        duration: Math.round(dur * 100) / 100,
        midi: curNote.midi,
        noteName: noteName(curNote.midi),
        freq: Math.round(avgF * 10) / 10,
      });
    }
  }

  onProgress?.(100);

  return {
    duration: buffer.duration,
    frames,
    notes,
    bpm: bpmResult ? bpmResult.bpm : null,
    keyName: keyResult ? keyResult.name : null,
  };
}

/**
 * Menghitung feedback kecocokan real-time pada detik ke `currentTime`.
 */
export function evaluateRealtimeMatch(
  currentTime: number,
  userFreq: number | null,
  profile: ReferenceMelodyProfile
): RealtimeMatchFeedback {
  let refNote: ReferenceNote | null = null;
  for (const n of profile.notes) {
    if (currentTime >= n.start - 0.04 && currentTime <= n.end + 0.04) {
      refNote = n;
      break;
    }
  }

  if (userFreq === null || userFreq <= 0) {
    return {
      time: currentTime,
      hasReferenceNote: Boolean(refNote),
      refMidi: refNote?.midi ?? null,
      refNoteName: refNote?.noteName ?? null,
      refFreq: refNote?.freq ?? null,
      userMidi: null,
      userNoteName: null,
      userFreq: null,
      centsDiff: 0,
      status: 'silent',
      statusLabel: refNote ? 'Bernyanyilah mengikuti nada!' : 'Mendengarkan...',
    };
  }

  const userMidiExact = freqToMidi(userFreq);
  const userMidiRounded = Math.round(userMidiExact);
  const userNName = noteName(userMidiRounded);

  if (!refNote) {
    return {
      time: currentTime,
      hasReferenceNote: false,
      refMidi: null,
      refNoteName: null,
      refFreq: null,
      userMidi: userMidiRounded,
      userNoteName: userNName,
      userFreq,
      centsDiff: 0,
      status: 'silent',
      statusLabel: `Nada vokalmu: ${userNName} (Musik sedang jeda)`,
    };
  }

  const rawCentsDiff = 1200 * Math.log2(userFreq / refNote.freq);
  const userPitchClass = pcOf(userMidiRounded);
  const refPitchClass = pcOf(refNote.midi);
  const isOctaveEquivalent = userPitchClass === refPitchClass;

  const targetSemitone = isOctaveEquivalent
    ? refNote.midi + 12 * Math.round((userMidiRounded - refNote.midi) / 12)
    : refNote.midi;

  const targetFreq = midiToFreq(targetSemitone);
  const centsFromTarget = 1200 * Math.log2(userFreq / targetFreq);
  const absCents = Math.abs(centsFromTarget);

  let status: MatchStatus;
  let statusLabel: string;

  if (absCents <= 15) {
    status = 'perfect';
    statusLabel = 'Tepat Sempurna! (In-Tune)';
  } else if (absCents <= 30) {
    status = 'good';
    statusLabel = centsFromTarget > 0 ? 'Sedikit Ketinggian (Sharp)' : 'Sedikit Kerendahan (Flat)';
  } else if (absCents <= 50) {
    status = 'near';
    statusLabel = centsFromTarget > 0 ? 'Mendekati (Cenderung Sharp)' : 'Mendekati (Cenderung Flat)';
  } else if (isOctaveEquivalent && absCents <= 40) {
    status = 'octave';
    statusLabel = 'Cocok secara Harmoni Oktaf!';
  } else {
    status = 'miss';
    const dist = userMidiRounded - refNote.midi;
    statusLabel = dist > 0 ? `Terlalu tinggi (+${dist} nada)` : `Terlalu rendah (${dist} nada)`;
  }

  return {
    time: currentTime,
    hasReferenceNote: true,
    refMidi: refNote.midi,
    refNoteName: refNote.noteName,
    refFreq: refNote.freq,
    userMidi: userMidiRounded,
    userNoteName: userNName,
    userFreq,
    centsDiff: Math.round(centsFromTarget * 10) / 10,
    status,
    statusLabel,
  };
}

/**
 * Menghitung evaluasi musikal komprehensif setelah latihan selesai.
 */
export function evaluateVocalPerformance(
  userPoints: UserVocalPoint[],
  profile: ReferenceMelodyProfile
): VocalEvaluationResult {
  if (userPoints.length === 0 || profile.notes.length === 0) {
    return {
      pitchScore: 0,
      timingScore: 0,
      overallScore: 0,
      perfectPercent: 0,
      goodPercent: 0,
      nearPercent: 0,
      missPercent: 0,
      octaveMatchPercent: 0,
      avgCentsDeviation: 0,
      intonationTendency: 'balanced',
      tendencyLabel: 'Data belum cukup',
      totalSingingDurationSec: 0,
      matchedNoteNames: [],
      musicalAdvice: ['Silakan bernyanyi lebih lama bersama audio acuan untuk memperoleh analisis akurat.'],
    };
  }

  let totalActiveSingingPoints = 0;
  let perfectCount = 0;
  let goodCount = 0;
  let nearCount = 0;
  let octaveCount = 0;
  let missCount = 0;

  let totalCentsSigned = 0;
  let totalCentsValidPoints = 0;

  const matchedNotesSet = new Set<string>();

  let referenceActiveWindowsCount = 0;
  let userSungDuringReferenceCount = 0;
  let userSangOutsideReferenceCount = 0;

  for (const pt of userPoints) {
    if (pt.freq === null || pt.clarity < 0.75) continue;

    totalActiveSingingPoints++;

    let matchedRef: ReferenceNote | null = null;
    for (const n of profile.notes) {
      if (pt.t >= n.start - 0.05 && pt.t <= n.end + 0.05) {
        matchedRef = n;
        break;
      }
    }

    if (matchedRef) {
      userSungDuringReferenceCount++;
      const userMidi = Math.round(freqToMidi(pt.freq));
      const isOctaveEq = pcOf(userMidi) === pcOf(matchedRef.midi);

      const targetMidi = isOctaveEq
        ? matchedRef.midi + 12 * Math.round((userMidi - matchedRef.midi) / 12)
        : matchedRef.midi;

      const targetF = midiToFreq(targetMidi);
      const cDiff = 1200 * Math.log2(pt.freq / targetF);
      const absC = Math.abs(cDiff);

      totalCentsSigned += cDiff;
      totalCentsValidPoints++;

      if (absC <= 15) {
        perfectCount++;
        matchedNotesSet.add(matchedRef.noteName);
      } else if (absC <= 30) {
        goodCount++;
        matchedNotesSet.add(matchedRef.noteName);
      } else if (absC <= 50) {
        nearCount++;
      } else if (isOctaveEq && absC <= 35) {
        octaveCount++;
        matchedNotesSet.add(matchedRef.noteName);
      } else {
        missCount++;
      }
    } else {
      userSangOutsideReferenceCount++;
    }
  }

  const sampleStep = 0.05;
  for (const n of profile.notes) {
    referenceActiveWindowsCount += Math.round(n.duration / sampleStep);
  }

  const singingPoints = Math.max(1, totalActiveSingingPoints);
  const perfectPct = Math.round((perfectCount / singingPoints) * 100);
  const goodPct = Math.round((goodCount / singingPoints) * 100);
  const nearPct = Math.round((nearCount / singingPoints) * 100);
  const octavePct = Math.round((octaveCount / singingPoints) * 100);
  const missPct = Math.round((missCount / singingPoints) * 100);

  const rawPitchScore =
    (perfectCount * 1.0 + goodCount * 0.8 + octaveCount * 0.75 + nearCount * 0.45) / singingPoints;
  const pitchScore = Math.min(100, Math.max(0, Math.round(rawPitchScore * 100)));

  const coverageRatio =
    referenceActiveWindowsCount > 0
      ? userSungDuringReferenceCount / Math.max(1, referenceActiveWindowsCount)
      : 0.5;
  const timingPenalizedRatio = Math.max(
    0,
    coverageRatio - (userSangOutsideReferenceCount / singingPoints) * 0.25
  );
  const timingScore = Math.min(100, Math.max(0, Math.round(timingPenalizedRatio * 100)));

  const overallScore = Math.round(pitchScore * 0.7 + timingScore * 0.3);

  const avgCents =
    totalCentsValidPoints > 0 ? Math.round((totalCentsSigned / totalCentsValidPoints) * 10) / 10 : 0;

  let intonationTendency: 'flat' | 'sharp' | 'balanced' = 'balanced';
  let tendencyLabel = 'Intonasi seimbang';
  if (avgCents > 12) {
    intonationTendency = 'sharp';
    tendencyLabel = `Cenderung Sharp / Ketinggian (+${avgCents} cent)`;
  } else if (avgCents < -12) {
    intonationTendency = 'flat';
    tendencyLabel = `Cenderung Flat / Kerendahan (${avgCents} cent)`;
  }

  const advice: string[] = [];

  if (overallScore >= 85) {
    advice.push('Akurasi nada dan timing vokalmu sangat solid dan musikal!');
  } else if (overallScore >= 70) {
    advice.push('Kemampuan mencocokkan nada sudah baik, intonasi stabil di register utama.');
  } else {
    advice.push('Perbanyak latihan mendengarkan nada acuan sebelum mulai bernyanyi.');
  }

  if (intonationTendency === 'flat') {
    advice.push('Vokalmu sering sedikit di bawah nada (flat). Topang pernapasan diafragma lebih aktif dan bayangkan nada dari atas.');
  } else if (intonationTendency === 'sharp') {
    advice.push('Vokalmu sering sedikit terlalu tinggi (sharp). Kendurkan otot rahang dan leher agar intonasi lebih rileks.');
  }

  if (octavePct >= 15) {
    advice.push('Bagus! Kamu bernyanyi 1 oktaf berbeda namun tetap pas secara harmoni dengan melodi acuan.');
  }

  if (timingScore < 60) {
    advice.push('Perhatikan ketukan awal tiap baris lagu: usahakan masuk tepat pada saat nada acuan mulai berbunyi.');
  }

  return {
    pitchScore,
    timingScore,
    overallScore,
    perfectPercent: perfectPct,
    goodPercent: goodPct,
    nearPercent: nearPct,
    missPercent: missPct,
    octaveMatchPercent: octavePct,
    avgCentsDeviation: avgCents,
    intonationTendency,
    tendencyLabel,
    totalSingingDurationSec: Math.round(totalActiveSingingPoints * 0.05 * 10) / 10,
    matchedNoteNames: Array.from(matchedNotesSet),
    musicalAdvice: advice,
  };
}
