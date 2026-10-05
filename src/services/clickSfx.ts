// src/services/clickSfx.ts
// Sintesis suara klik (5 efek bawaan) + pemutar 1 nada GM dari bank SF2.
// Dipanggil oleh audioEngine.playClickEffect(). Tanpa file audio tambahan.
import type { BuiltinSfxId } from './sfxSettings';

// Bentuk minimal metadata sampel dari AudioEngine.getSampleMetadata().
export interface ClickSampleMeta {
  buffer: AudioBuffer;
  rootKey: number;
  isLooping: boolean;
  loopStartSec: number;
  loopEndSec: number;
  tuningCentsOffset: number;
  scaleTuningCents: number;
  normalizationGain: number;
}

export function playBuiltinClick(ctx: AudioContext, out: AudioNode, id: BuiltinSfxId, volume: number) {
  const now = ctx.currentTime;
  const v = volume / 0.3; // 1.0 pada volume bawaan

  const tone = (type: OscillatorType, f0: number, f1: number, dur: number, peak: number) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, now);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(f1, now + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, peak), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  };

  const noise = (dur: number, hz: number, q: number, peak: number, type: BiquadFilterType) => {
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let k = 0; k < len; k++) data[k] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, peak), now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(now);
  };

  switch (id) {
    // --- Audio Studio ---
    case 'audio-hat':
      noise(0.05, 7000, 0.7, 0.2 * v, 'highpass');
      break;
    case 'audio-kick':
      tone('sine', 160, 48, 0.12, 0.35 * v);
      break;
    // --- Pusat Kuis ---
    case 'quiz-bell':
      tone('sine', 1318.5, 1318.5, 0.28, 0.16 * v);
      tone('sine', 3135.9, 3135.9, 0.14, 0.06 * v);
      break;
    case 'quiz-pop':
      tone('sine', 380, 820, 0.09, 0.22 * v);
      break;
    // --- Lainnya (jembatan: transien noise ala audio + nada pendek ala kuis) ---
    case 'other-tok':
      noise(0.012, 2500, 1.2, 0.14 * v, 'bandpass');
      tone('triangle', 640, 560, 0.07, 0.18 * v);
      break;
  }
}

/**
 * Satu nada pendek dari program GM (bank SF2 yang sama dengan Full 16-Bar Editor).
 * Sengaja TIDAK memakai playChordNotes/activeVoices: klik tidak boleh memotong
 * chord yang sedang diputar, dan stopAllChords() tidak boleh mematikan klik.
 * `meta` null = bank belum siap -> nada sinus/segitiga sederhana sebagai cadangan.
 */
export function playGmClick(
  ctx: AudioContext,
  out: AudioNode,
  meta: ClickSampleMeta | null,
  midiNote: number,
  volume: number
) {
  const now = ctx.currentTime;
  const note = Math.max(0, Math.min(127, Math.round(midiNote)));
  const atk = 0.004;
  const hold = 0.12;
  const rel = 0.18;

  if (!meta) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(440 * Math.pow(2, (note - 69) / 12), now);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.15 * (volume / 0.3), now + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, now + hold + rel);
    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + hold + rel + 0.02);
    return;
  }

  const peak = Math.max(0.0002, 0.7 * volume * meta.normalizationGain);
  const src = ctx.createBufferSource();
  src.buffer = meta.buffer;
  if (meta.isLooping) {
    src.loop = true;
    src.loopStart = meta.loopStartSec;
    src.loopEnd = meta.loopEndSec;
  }
  const totalCents = (note - meta.rootKey) * meta.scaleTuningCents + meta.tuningCentsOffset;
  src.playbackRate.value = Math.pow(2, totalCents / 1200);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(peak, now + atk);
  gain.gain.setValueAtTime(peak, now + atk + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + atk + hold + rel);

  src.connect(gain);
  gain.connect(out);
  src.start(now);
  src.stop(now + atk + hold + rel + 0.05);
}
