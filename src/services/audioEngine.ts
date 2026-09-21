// src/services/audioEngine.ts
import { SoundFont2, GeneratorType, Generator } from 'soundfont2';

export interface InstrumentMeta {
  id: number;
  name: string;
  category: string;
}

export const INSTRUMENTS_128: InstrumentMeta[] = [
  { id: 0, name: 'Acoustic Grand Piano', category: 'Piano' },
  { id: 1, name: 'Bright Acoustic Piano', category: 'Piano' },
  { id: 2, name: 'Electric Grand Piano', category: 'Piano' },
  { id: 3, name: 'Honky-tonk Piano', category: 'Piano' },
  { id: 4, name: 'Electric Piano 1 (Rhodes)', category: 'Piano' },
  { id: 5, name: 'Electric Piano 2 (DX7)', category: 'Piano' },
  { id: 6, name: 'Harpsichord', category: 'Piano' },
  { id: 7, name: 'Clavinet', category: 'Piano' },
  { id: 8, name: 'Celesta', category: 'Chromatic Percussion' },
  { id: 9, name: 'Glockenspiel', category: 'Chromatic Percussion' },
  { id: 10, name: 'Music Box', category: 'Chromatic Percussion' },
  { id: 11, name: 'Vibraphone', category: 'Chromatic Percussion' },
  { id: 12, name: 'Marimba', category: 'Chromatic Percussion' },
  { id: 13, name: 'Xylophone', category: 'Chromatic Percussion' },
  { id: 14, name: 'Tubular Bells', category: 'Chromatic Percussion' },
  { id: 15, name: 'Dulcimer (Santur)', category: 'Chromatic Percussion' },
  { id: 16, name: 'Drawbar Organ', category: 'Organ' },
  { id: 17, name: 'Percussive Organ', category: 'Organ' },
  { id: 18, name: 'Rock Organ', category: 'Organ' },
  { id: 19, name: 'Church Organ', category: 'Organ' },
  { id: 20, name: 'Reed Organ', category: 'Organ' },
  { id: 21, name: 'Accordion', category: 'Organ' },
  { id: 22, name: 'Harmonica', category: 'Organ' },
  { id: 23, name: 'Tango Accordion', category: 'Organ' },
  { id: 24, name: 'Acoustic Guitar (Nylon)', category: 'Guitar' },
  { id: 25, name: 'Acoustic Guitar (Steel)', category: 'Guitar' },
  { id: 26, name: 'Electric Guitar (Jazz)', category: 'Guitar' },
  { id: 27, name: 'Electric Guitar (Clean)', category: 'Guitar' },
  { id: 28, name: 'Electric Guitar (Muted)', category: 'Guitar' },
  { id: 29, name: 'Overdriven Guitar', category: 'Guitar' },
  { id: 30, name: 'Distortion Guitar', category: 'Guitar' },
  { id: 31, name: 'Guitar Harmonics', category: 'Guitar' },
  { id: 32, name: 'Acoustic Bass', category: 'Bass' },
  { id: 33, name: 'Electric Bass (Finger)', category: 'Bass' },
  { id: 34, name: 'Electric Bass (Pick)', category: 'Bass' },
  { id: 35, name: 'Fretless Bass', category: 'Bass' },
  { id: 36, name: 'Slap Bass 1', category: 'Bass' },
  { id: 37, name: 'Slap Bass 2', category: 'Bass' },
  { id: 38, name: 'Synth Bass 1', category: 'Bass' },
  { id: 39, name: 'Synth Bass 2', category: 'Bass' },
  { id: 40, name: 'Violin', category: 'Strings' },
  { id: 41, name: 'Viola', category: 'Strings' },
  { id: 42, name: 'Cello', category: 'Strings' },
  { id: 43, name: 'Contrabass', category: 'Strings' },
  { id: 44, name: 'Tremolo Strings', category: 'Strings' },
  { id: 45, name: 'Pizzicato Strings', category: 'Strings' },
  { id: 46, name: 'Orchestral Harp', category: 'Strings' },
  { id: 47, name: 'Timpani', category: 'Strings' },
  { id: 48, name: 'String Ensemble 1', category: 'Ensemble' },
  { id: 49, name: 'String Ensemble 2', category: 'Ensemble' },
  { id: 50, name: 'Synth Strings 1', category: 'Ensemble' },
  { id: 51, name: 'Synth Strings 2', category: 'Ensemble' },
  { id: 52, name: 'Choir Aahs', category: 'Ensemble' },
  { id: 53, name: 'Voice Oohs', category: 'Ensemble' },
  { id: 54, name: 'Synth Voice / Choir', category: 'Ensemble' },
  { id: 55, name: 'Orchestra Hit', category: 'Ensemble' },
  { id: 56, name: 'Trumpet', category: 'Brass' },
  { id: 57, name: 'Trombone', category: 'Brass' },
  { id: 58, name: 'Tuba', category: 'Brass' },
  { id: 59, name: 'Muted Trumpet', category: 'Brass' },
  { id: 60, name: 'French Horn', category: 'Brass' },
  { id: 61, name: 'Brass Section', category: 'Brass' },
  { id: 62, name: 'Synth Brass 1', category: 'Brass' },
  { id: 63, name: 'Synth Brass 2', category: 'Brass' },
  { id: 64, name: 'Soprano Sax', category: 'Reed' },
  { id: 65, name: 'Alto Sax', category: 'Reed' },
  { id: 66, name: 'Tenor Sax', category: 'Reed' },
  { id: 67, name: 'Baritone Sax', category: 'Reed' },
  { id: 68, name: 'Oboe', category: 'Reed' },
  { id: 69, name: 'English Horn', category: 'Reed' },
  { id: 70, name: 'Bassoon', category: 'Reed' },
  { id: 71, name: 'Clarinet', category: 'Reed' },
  { id: 72, name: 'Piccolo', category: 'Pipe' },
  { id: 73, name: 'Flute', category: 'Pipe' },
  { id: 74, name: 'Recorder', category: 'Pipe' },
  { id: 75, name: 'Pan Flute', category: 'Pipe' },
  { id: 76, name: 'Blown Bottle', category: 'Pipe' },
  { id: 77, name: 'Shakuhachi', category: 'Pipe' },
  { id: 78, name: 'Whistle', category: 'Pipe' },
  { id: 79, name: 'Ocarina', category: 'Pipe' },
  { id: 80, name: 'Lead 1 (Square)', category: 'Synth Lead' },
  { id: 81, name: 'Lead 2 (Sawtooth)', category: 'Synth Lead' },
  { id: 82, name: 'Lead 3 (Calliope)', category: 'Synth Lead' },
  { id: 83, name: 'Lead 4 (Chiff)', category: 'Synth Lead' },
  { id: 84, name: 'Lead 5 (Charang)', category: 'Synth Lead' },
  { id: 85, name: 'Lead 6 (Voice)', category: 'Synth Lead' },
  { id: 86, name: 'Lead 7 (Fifths)', category: 'Synth Lead' },
  { id: 87, name: 'Lead 8 (Bass + Lead)', category: 'Synth Lead' },
  { id: 88, name: 'Pad 1 (New Age)', category: 'Synth Pad' },
  { id: 89, name: 'Pad 2 (Warm)', category: 'Synth Pad' },
  { id: 90, name: 'Pad 3 (Polysynth)', category: 'Synth Pad' },
  { id: 91, name: 'Pad 4 (Choir)', category: 'Synth Pad' },
  { id: 92, name: 'Pad 5 (Bowed)', category: 'Synth Pad' },
  { id: 93, name: 'Pad 6 (Metallic)', category: 'Synth Pad' },
  { id: 94, name: 'Pad 7 (Halo)', category: 'Synth Pad' },
  { id: 95, name: 'Pad 8 (Sweep)', category: 'Synth Pad' },
  { id: 96, name: 'FX 1 (Rain)', category: 'Synth Effects' },
  { id: 97, name: 'FX 2 (Soundtrack)', category: 'Synth Effects' },
  { id: 98, name: 'FX 3 (Crystal)', category: 'Synth Effects' },
  { id: 99, name: 'FX 4 (Atmosphere)', category: 'Synth Effects' },
  { id: 100, name: 'FX 5 (Brightness)', category: 'Synth Effects' },
  { id: 101, name: 'FX 6 (Goblins)', category: 'Synth Effects' },
  { id: 102, name: 'FX 7 (Echoes)', category: 'Synth Effects' },
  { id: 103, name: 'FX 8 (Sci-fi)', category: 'Synth Effects' },
  { id: 104, name: 'Sitar', category: 'Ethnic' },
  { id: 105, name: 'Banjo', category: 'Ethnic' },
  { id: 106, name: 'Shamisen', category: 'Ethnic' },
  { id: 107, name: 'Koto', category: 'Ethnic' },
  { id: 108, name: 'Kalimba', category: 'Ethnic' },
  { id: 109, name: 'Bagpipe', category: 'Ethnic' },
  { id: 110, name: 'Fiddle', category: 'Ethnic' },
  { id: 111, name: 'Shanai', category: 'Ethnic' },
  { id: 112, name: 'Tinkle Bell', category: 'Percussive' },
  { id: 113, name: 'Agogo', category: 'Percussive' },
  { id: 114, name: 'Steel Drums', category: 'Percussive' },
  { id: 115, name: 'Woodblock', category: 'Percussive' },
  { id: 116, name: 'Taiko Drum', category: 'Percussive' },
  { id: 117, name: 'Melodic Tom', category: 'Percussive' },
  { id: 118, name: 'Synth Drum', category: 'Percussive' },
  { id: 119, name: 'Reverse Cymbal', category: 'Percussive' },
  { id: 120, name: 'Guitar Fret Noise', category: 'Sound Effects' },
  { id: 121, name: 'Breath Noise', category: 'Sound Effects' },
  { id: 122, name: 'Seashore', category: 'Sound Effects' },
  { id: 123, name: 'Bird Tweet', category: 'Sound Effects' },
  { id: 124, name: 'Telephone Ring', category: 'Sound Effects' },
  { id: 125, name: 'Helicopter', category: 'Sound Effects' },
  { id: 126, name: 'Applause', category: 'Sound Effects' },
  { id: 127, name: 'Gunshot', category: 'Sound Effects' },
];

export const NOTE_ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
export const CHORD_QUALITIES = ['maj', 'min', 'dim', 'sus4', 'sus2', 'aug', 'dyad5', 'dyad3maj', 'dyad3min', 'dyadOct'];
export const CHORD_TENSIONS = ['none', '7', 'maj7', 'b9', '9', '#9', '11', 'b5/#11', '#5/b13', '6/13'];
export const CHORD_INVERSIONS = [
  { id: 0, label: 'Root (Dasar)' },
  { id: 1, label: '1st Inversion' },
  { id: 2, label: '2nd Inversion' },
  { id: 3, label: '3rd Inversion' },
];

const SEMITONE_MAP: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11
};

export interface EnvelopeADSR {
  attack: number;   // detik — batas praktis diatur di UI pemanggil (drum: pendek/perkusif; chord: panjang/mengalun)
  decay: number;    // detik — waktu transisi dari puncak ke sustain
  sustain: number;  // 0.0 s/d 1.0 (level volume tahan) — rentang SAMA untuk semua jenis instrumen
  release: number;  // detik — waktu dengung memudar
}

export interface ChordFormulaDef {
  root: string;
  type: string;
  tension?: string;
  bass?: string;
  inversion?: number; // 0 = Root, 1 = 1st, 2 = 2nd, 3 = 3rd
  octaveOffset?: number; // -2, -1, 0, 1, 2
}

export function buildHarmonicChord(def: ChordFormulaDef): { displayName: string; midiNotes: number[] } {
  const rootOffset = SEMITONE_MAP[def.root] ?? 0;
  const baseOctave = (def.octaveOffset ?? 0) * 12;
  
  // Geser basis ke Oktaf 3 (MIDI 48) agar akor berbunyi tebal dan pas di register tengah
  const baseMidi = 48 + rootOffset + baseOctave;

  let intervals: number[] = [0, 4, 7]; // default major
  if (def.type === 'min') intervals = [0, 3, 7];
  else if (def.type === 'dim') intervals = [0, 3, 6];
  else if (def.type === 'sus4') intervals = [0, 5, 7];
  else if (def.type === 'sus2') intervals = [0, 2, 7];
  else if (def.type === 'aug') intervals = [0, 4, 8];
  // Dyad (akor dua nada): hanya root + satu interval, TANPA nada ketiga.
  else if (def.type === 'dyad5') intervals = [0, 7]; // power chord (perfect 5th)
  else if (def.type === 'dyad3maj') intervals = [0, 4]; // dyad tertian mayor
  else if (def.type === 'dyad3min') intervals = [0, 3]; // dyad tertian minor
  else if (def.type === 'dyadOct') intervals = [0, 12]; // dyad oktaf

  const isDyad = def.type.startsWith('dyad');

  const tension = def.tension || 'none';
  // Dyad murni sengaja TIDAK menerima tension (7th/9th/dst), supaya jumlah
  // nadanya tetap persis 2 sesuai definisi "dyad".
  if (isDyad) {
    // no-op — dyad tetap 2 nada
  } else if (tension === '7') {
    intervals.push(def.type === 'dim' ? 9 : 10);
  } else if (tension === 'maj7' || tension === 'j7') {
    intervals.push(11);
  } else if (tension === 'b9') {
    intervals.push(10, 13);
  } else if (tension === '9') {
    intervals.push(10, 14);
  } else if (tension === '#9') {
    intervals.push(10, 15);
  } else if (tension === '11') {
    intervals.push(10, 17);
  } else if (tension === 'b5/#11') {
    intervals.push(6, 18);
  } else if (tension === '#5/b13') {
    intervals.push(8, 20);
  } else if (tension === '6/13') {
    intervals.push(9);
  }

  // Bentuk not dasar dan urutkan
  let notes = Array.from(new Set(intervals))
    .map((intv) => baseMidi + intv)
    .sort((a, b) => a - b);

  // Mesin Inversion Presisi (Memindahkan not terbawah ke atas tanpa merusak harmoni)
  const inv = Math.max(0, Math.min(notes.length - 1, def.inversion || 0));
  for (let i = 0; i < inv; i++) {
    const bottomNote = notes.shift();
    if (bottomNote !== undefined) {
      notes.push(bottomNote + 12);
    }
  }
  notes.sort((a, b) => a - b);

  // Bass Note (Slash Chord) — dilewati untuk dyad murni supaya tetap 2 nada
  if (!isDyad && def.bass && def.bass !== 'none' && def.bass !== def.root) {
    const bassOffset = SEMITONE_MAP[def.bass] ?? 0;
    const bassMidi = 36 + bassOffset + baseOctave; // Di oktaf 2 yang dalam
    notes = [bassMidi, ...notes];
  }

  const DYAD_LABELS: Record<string, string> = {
    dyad5: '5',
    dyad3maj: '(dyad M3)',
    dyad3min: '(dyad m3)',
    dyadOct: '(dyad 8ve)',
  };

  let name: string;
  if (isDyad) {
    name = `${def.root}${DYAD_LABELS[def.type] || ''}`;
  } else {
    name = `${def.root}${def.type === 'maj' ? '' : def.type}`;
    if (tension !== 'none') {
      name += tension === 'j7' ? 'maj7' : tension;
    }
    if (def.bass && def.bass !== 'none' && def.bass !== def.root) {
      name += `/${def.bass}`;
    }
  }
  if (inv > 0) {
    name += ` (inv${inv})`;
  }

  return { displayName: name, midiNotes: notes };
}

interface ActiveVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  stopAtTime: number;
  // 'primary'    = Progresi Akor 1 (instrumen utama)
  // 'progresi2'  = Progresi Akor 2 (opsional, independen dari progresi 1)
  group: 'primary' | 'progresi2';
}

interface SampleBufferMetadata {
  buffer: AudioBuffer;
  rootKey: number;
  isLooping: boolean;
  loopStartSec: number;
  loopEndSec: number;
  // Total detune in cents baked into the sample/generators (pitch correction +
  // coarse/fine tune). Applied on top of the (note - rootKey) interval.
  tuningCentsOffset: number;
  // Cents produced per semitone of key distance from rootKey. SF2 default is
  // 100 (i.e. a normal 12-TET semitone); some presets override this.
  scaleTuningCents: number;
  // Gain koreksi (linear) hasil analisa loudness (RMS) sample ini, dipakai
  // untuk MENYAMAKAN kekerasan semua instrumen dalam bank SF2 yang sama.
  // Lihat computeLoudnessNormalizationGain() untuk detail perhitungannya.
  normalizationGain: number;
}

// -------------------------------------------------------------------
// PROFIL KARAKTER SUARA PER DRUM KIT
//
// Sebelumnya parameter `kit` nyaris tidak berpengaruh (hanya mengubah
// pitch awal kick antara '80s' vs kit lain). Sekarang setiap kit punya
// "kepribadian" sendiri lewat 5 parameter yang mempengaruhi semua
// bagian drum secara konsisten:
// - pitchShiftSemitones : menggeser nada elemen bertitinada (kick/tom/perc)
// - brightness          : mengalikan frekuensi filter (>1 lebih cerah/tajam)
// - decayScale          : mengalikan durasi peluruhan (>1 lebih panjang)
// - drive               : jumlah saturasi/distorsi lembut (0 = bersih)
// - ambience            : jumlah "ekor" delay pendek yang meniru ruang
// -------------------------------------------------------------------
export interface DrumKitProfile {
  pitchShiftSemitones: number;
  brightness: number;
  decayScale: number;
  drive: number;
  ambience: number;
}

export const DRUM_KIT_PROFILES: Record<string, DrumKitProfile> = {
  '80s': { pitchShiftSemitones: 2, brightness: 1.3, decayScale: 0.8, drive: 0.15, ambience: 0.05 },
  ambient: { pitchShiftSemitones: -2, brightness: 0.7, decayScale: 1.9, drive: 0, ambience: 0.55 },
  industrial: { pitchShiftSemitones: -3, brightness: 1.15, decayScale: 1.0, drive: 0.6, ambience: 0.1 },
  breakbeat: { pitchShiftSemitones: 0, brightness: 0.95, decayScale: 0.8, drive: 0.3, ambience: 0.08 },
  jazzy: { pitchShiftSemitones: -1, brightness: 0.65, decayScale: 1.35, drive: 0, ambience: 0.18 },
  electro: { pitchShiftSemitones: 3, brightness: 1.45, decayScale: 0.7, drive: 0.2, ambience: 0.05 },
  hiphop: { pitchShiftSemitones: -4, brightness: 0.85, decayScale: 1.2, drive: 0.25, ambience: 0.12 },
};

const semitoneRatio = (semitones: number): number => Math.pow(2, semitones / 12);

// Pesan status ini sengaja TIDAK menyertakan nama file/ekstensi .sf2 — UI
// hanya perlu tahu "sudah siap", bukan detail teknis nama bank sampel.
// Diekspos di sini (bukan sebagai static class member) supaya komponen UI
// (mis. PadStudio) bisa mengimpornya langsung tanpa perlu mengekspor kelas
// AudioEngine itu sendiri, lalu memakainya untuk menyembunyikan status ini
// otomatis setelah beberapa detik.
export const SOUND_BANK_READY_MESSAGE = 'Bank Sampel Siap Digunakan';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private soundfontInstance: SoundFont2 | null = null;
  public loadedSoundfontPath: string | null = null;
  private bufferCache: Record<string, SampleBufferMetadata> = {};
  public isLoaded: boolean = false;
  public isLoading: boolean = false;
  private drumCache: Record<string, AudioBuffer> = {};
  private activeVoices: ActiveVoice[] = [];

  // Envelope Pengguna Default — khusus CHORD (dipakai playChordNotes &
  // renderChordNoteToDestination default).
  public adsr: EnvelopeADSR = {
    attack: 0.02,
    decay: 0.25,
    sustain: 0.65,
    release: 0.35,
  };

  // Envelope TERPISAH khusus DRUM. Rentang batas maksimum drum sengaja lebih
  // pendek daripada chord (karakter drum yang perkusif/one-shot), sementara
  // rentang Sustain (0..1) sama seperti chord — hanya A/D/R yang punya
  // batas atas berbeda. Diterapkan pada hit drum berbasis sample WAV baik
  // saat live play (playDrumSound) maupun saat ekspor
  // (renderDrumHitToDestination).
  public drumAdsr: EnvelopeADSR = {
    attack: 0.002,
    decay: 0.15,
    sustain: 0.3,
    release: 0.12,
  };

  // -------------------------------------------------------------------
  // Kurva ADSR generik 4-tahap yang diterapkan pada sebuah GainNode mana
  // pun (dipakai khusus untuk hit drum berbasis sample WAV — chord punya
  // implementasinya sendiri di playChordVoicesInternal/
  // renderChordNoteToDestination karena butuh normalizationGain per-not).
  // holdSec = panjang sample/durasi ketukan sebelum release mulai.
  // Mengembalikan waktu absolut kapan voice ini benar-benar selesai
  // (dipakai untuk menjadwalkan src.stop()).
  // -------------------------------------------------------------------
  private applyAdsrEnvelope(
    gainNode: GainNode,
    adsr: EnvelopeADSR,
    startTime: number,
    holdSec: number,
    peakVal: number
  ): number {
    const a = Math.max(0.001, adsr.attack);
    const d = Math.max(0.005, adsr.decay);
    const s = Math.max(0.0, Math.min(1.0, adsr.sustain));
    const r = Math.max(0.02, adsr.release);
    const peak = Math.max(0.0002, peakVal);
    const sustainVal = Math.max(0.0001, peak * s);

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(peak, startTime + a);
    gainNode.gain.exponentialRampToValueAtTime(sustainVal, startTime + a + d);
    const holdUntil = startTime + Math.max(a + d, holdSec);
    gainNode.gain.setValueAtTime(sustainVal, holdUntil);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, holdUntil + r);
    return holdUntil + r + 0.05;
  }

  public getAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.setValueAtTime(-4, this.ctx.currentTime);
      this.compressor.knee.setValueAtTime(10, this.ctx.currentTime);
      this.compressor.ratio.setValueAtTime(6, this.ctx.currentTime);
      this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
      this.compressor.release.setValueAtTime(0.12, this.ctx.currentTime);
      this.compressor.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // -------------------------------------------------------------------
  // EFEK SUARA UI PENDEK (click / correct / wrong)
  //
  // SEBELUMNYA method-method ini dipanggil di banyak tempat di seluruh
  // aplikasi (App.tsx: pindah mode header, tambah/hapus item keranjang,
  // login/logout, dsb) TAPI TIDAK PERNAH DIDEFINISIKAN di audioEngine
  // sama sekali. Karena dipanggil secara sinkron TANPA try/catch dan
  // TANPA optional chaining (`audioEngine.playClickSound()`, bukan
  // `audioEngine.playClickSound?.()`), setiap panggilan langsung
  // melempar `TypeError: ... is not a function` dan MENGHENTIKAN seluruh
  // handler di baris itu juga — termasuk baris setelahnya yang harusnya
  // jalan (`setCurrentMode(mode)`, `setCartItems(...)`, dst).
  //
  // Ini akar penyebab tombol "pindah ke mode Pusat Kuis" tidak
  // bereaksi sama sekali (onModeChange manggil playClickSound() DULU,
  // sebelum setCurrentMode(mode)), dan juga akar penyebab "Gagal
  // menambahkan bundle ke keranjang" (handleAddToCart di App.tsx juga
  // manggil playClickSound() di baris pertama, sebelum setCartItems).
  // -------------------------------------------------------------------
  public playClickSound(volume: number = 0.3) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1100, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5 * volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(gain);
      gain.connect(this.compressor || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      // Suara UI tidak boleh pernah menjatuhkan alur logic pemanggilnya.
    }
  }

  public playCorrectSound(volume: number = 0.4) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      // Dua nada naik (mis. C5 -> E5) khas notifikasi "benar".
      [523.25, 659.25].forEach((freq, i) => {
        const startAt = now + i * 0.09;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startAt);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.55 * volume, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.22);

        osc.connect(gain);
        gain.connect(this.compressor || ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + 0.25);
      });
    } catch {
      // no-op
    }
  }

  public playWrongSound(volume: number = 0.4) {
    try {
      const ctx = this.getAudioContext();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.22);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.5 * volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

      osc.connect(gain);
      gain.connect(this.compressor || ctx.destination);
      osc.start(now);
      osc.stop(now + 0.28);
    } catch {
      // no-op
    }
  }

  // Pemotongan Nada Halus (Anti-Kresek / Anti-Pop) Menggunakan Kurva Eksponensial.
  // `group` opsional: kalau diisi, HANYA voice dari grup itu yang dihentikan
  // (mis. retrigger Progresi Akor 1 tidak lagi memotong not Progresi Akor 2
  // yang sengaja diberi durasi tahan lebih panjang, dan sebaliknya). Kalau
  // `group` tidak diisi, semua voice dihentikan seperti sebelumnya (dipakai
  // untuk tombol Stop/Clear Grid global).
  public stopAllChords(customFadeSec?: number, group?: 'primary' | 'progresi2') {
    if (!this.ctx || this.activeVoices.length === 0) return;
    const now = this.ctx.currentTime;
    const fadeSec = customFadeSec !== undefined ? customFadeSec : Math.max(0.04, this.adsr.release);

    const remaining: ActiveVoice[] = [];
    this.activeVoices.forEach((voice) => {
      if (group && voice.group !== group) {
        remaining.push(voice);
        return;
      }
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setValueAtTime(Math.max(0.0001, voice.gain.gain.value), now);
        // Transisi eksponensial menuju batas tak terdengar untuk menghindari lonjakan DC
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + fadeSec);
        voice.source.stop(now + fadeSec + 0.02);
      } catch {}
    });

    this.activeVoices = remaining;
  }

  // -------------------------------------------------------------------
  // Bank sampel yang dipakai aplikasi. SEBELUMNYA nama file di-hardcode
  // langsung di initBank(), jadi setiap kali file SF2 diganti, kode akan
  // tetap ngotot mencari nama file yang lama dulu — dan kalau file lama
  // itu masih ada di /public, ia akan selalu "menang" tanpa pernah
  // menyentuh file yang baru sama sekali.
  //
  // Sekarang path-nya jadi satu titik konfigurasi tunggal di sini. Ganti
  // `PRIMARY_SOUNDFONT_PATH` setiap kali kamu mengganti bank SF2 yang
  // dipakai, dan HAPUS file SF2 lama dari /public supaya tidak ada
  // kemungkinan tersandung nama file basi lagi.
  // -------------------------------------------------------------------
  private static readonly PRIMARY_SOUNDFONT_PATH = 'https://huggingface.co/Laerous77/playmuzeck-assets/resolve/main/soundfont.sf2'; 
  private static readonly FALLBACK_SOUNDFONT_PATHS = [
    '/just t4.sf2',
    '/soundfont.sf2',
  ];

  public async initBank(onProgress?: (msg: string) => void): Promise<boolean> {
    if (this.isLoaded || this.isLoading) return true;
    this.isLoading = true;

    const candidatePaths = [
      AudioEngine.PRIMARY_SOUNDFONT_PATH,
      ...AudioEngine.FALLBACK_SOUNDFONT_PATHS,
    ];

    for (const path of candidatePaths) {
      try {
        if (onProgress) onProgress('Memuat Bank Sampel...');
        const res = await fetch(path);
        if (res.ok) {
          if (onProgress) onProgress('Mengurai struktur gelombang akustik...');
          const ab = await res.arrayBuffer();
          this.soundfontInstance = new SoundFont2(new Uint8Array(ab));
          this.isLoaded = true;
          this.isLoading = false;
          this.loadedSoundfontPath = path;
          if (onProgress) onProgress(SOUND_BANK_READY_MESSAGE);
          return true;
        }
      } catch {}
    }

    this.isLoading = false;
    return false;
  }

  // Ambil nilai generator SF2 (mis. fineTune, overridingRootKey) dari peta gabungan,
  // dengan fallback ke default spec jika generator tidak diset di preset/instrument.
  private getGenValue(
    generators: Partial<Record<GeneratorType, Generator>> | undefined,
    id: GeneratorType,
    fallback: number
  ): number {
    const gen = generators?.[id];
    return gen && typeof gen.value === 'number' ? gen.value : fallback;
  }

  // -------------------------------------------------------------------
  // PENYAMAAN LOUDNESS ANTAR-INSTRUMEN (Auto-Gain per Sample)
  //
  // Masalah: bank SF2 (mis. "just t4.sf2") sering dibuat dengan level
  // rekaman/mixing yang berbeda-beda per instrumen — beberapa sample
  // sengaja/tidak sengaja jauh lebih keras atau lebih pelan dari yang
  // lain. Sebelumnya sample dipakai apa adanya (hanya dikoreksi skala
  // int16 vs float), jadi ketimpangan volume asli dari file SF2 selalu
  // ikut terdengar apa adanya.
  //
  // Solusi: ukur RMS (rata-rata kekerasan) tiap sample saat pertama kali
  // di-decode, lalu hitung gain koreksi agar SEMUA sample diarahkan ke
  // satu level referensi (TARGET_RMS) yang sama. Dibatasi (MIN/MAX_GAIN)
  // supaya sample yang sangat pelan tidak jadi berisik/berdesis, dan
  // sample yang sangat keras tidak berubah karakter drastis. Gain juga
  // dibatasi lagi agar tidak membuat puncak sample melewati batas aman
  // (mencegah clipping akibat penguatan).
  // -------------------------------------------------------------------
  private static readonly LOUDNESS_TARGET_RMS = 0.18;
  private static readonly LOUDNESS_MIN_GAIN = 0.35;
  private static readonly LOUDNESS_MAX_GAIN = 3.0;

  private computeLoudnessNormalizationGain(samples: Float32Array): number {
    const total = samples.length;
    if (total === 0) return 1.0;

    // Sampling (bukan setiap sampel) supaya file panjang tetap cepat dianalisa.
    const step = Math.max(1, Math.floor(total / 20000));
    let sumSquares = 0;
    let peak = 0;
    let counted = 0;

    for (let i = 0; i < total; i += step) {
      const v = samples[i];
      sumSquares += v * v;
      const abs = Math.abs(v);
      if (abs > peak) peak = abs;
      counted++;
    }

    const rms = counted > 0 ? Math.sqrt(sumSquares / counted) : 0;
    if (rms < 0.0005) return 1.0; // nyaris hening (mis. sample silence), jangan dipaksa dikuatkan

    let gain = AudioEngine.LOUDNESS_TARGET_RMS / rms;
    gain = Math.max(AudioEngine.LOUDNESS_MIN_GAIN, Math.min(AudioEngine.LOUDNESS_MAX_GAIN, gain));

    // Jaga agar hasil penguatan tidak membuat puncak gelombang melewati batas aman.
    if (peak > 0) {
      const maxSafeGain = 0.98 / peak;
      gain = Math.min(gain, maxSafeGain);
    }

    return gain;
  }

  private getSampleMetadata(midiNote: number, programNumber: number): SampleBufferMetadata | null {
    if (!this.soundfontInstance) return null;
    const cacheKey = `${programNumber}_${midiNote}`;
    if (this.bufferCache[cacheKey]) {
      return this.bufferCache[cacheKey];
    }

    try {
      const ctx = this.getAudioContext();
      const preset: any = this.soundfontInstance.presets.find(
        (p: any) => p.header.preset === programNumber && (p.header.bank === 0 || p.header.bank === undefined)
      ) || this.soundfontInstance.presets.find((p: any) => p.header.preset === programNumber) || this.soundfontInstance.presets[0];

      if (!preset || !preset.zones) return null;

      const pZone: any = preset.zones.find(
        (z: any) => !z.keyRange || (midiNote >= z.keyRange.lo && midiNote <= z.keyRange.hi)
      ) || preset.zones[0];

      if (!pZone) return null;

      const inst: any = pZone.instrument;
      let sample: any = null;
      let iZone: any = null;

      if (inst && inst.zones) {
        iZone = inst.zones.find(
          (z: any) => !z.keyRange || (midiNote >= z.keyRange.lo && midiNote <= z.keyRange.hi)
        ) || inst.zones[0];

        if (iZone && iZone.sample) {
          sample = iZone.sample;
        }
      }

      if (!sample && pZone.sample) {
        sample = pZone.sample;
      }

      if (!sample || !sample.data) return null;

      // -------------------------------------------------------------
      // RESOLUSI PITCH SF2 YANG AKURAT
      // Sebelumnya kode ini hanya memakai `sample.header.originalPitch`
      // sebagai kunci akar, dan mengabaikan pitchCorrection sampel serta
      // generator OverridingRootKey/CoarseTune/FineTune/ScaleTuning di
      // preset & instrument zone. Bank SF2 profesional hampir selalu
      // menyetel salah satu dari nilai-nilai ini, jadi mengabaikannya
      // membuat SEMUA nada (termasuk akor) sedikit atau bahkan jauh
      // fals dibanding not yang seharusnya ditampilkan.
      //
      // Urutan resolusi generator mengikuti pola referensi resmi
      // pustaka soundfont2 (`SoundFont2.getKeyData`): generator level
      // instrument menang atas generator level preset, dan generator
      // global zone jadi dasar sebelum ditimpa oleh zone spesifik.
      const presetGenerators = {
        ...(preset.globalZone?.generators || {}),
        ...(pZone.generators || {}),
      };
      const instrumentGenerators = {
        ...(inst?.globalZone?.generators || {}),
        ...(iZone?.generators || {}),
      };
      const generators = { ...presetGenerators, ...instrumentGenerators };

      const overridingRootKey = this.getGenValue(generators, GeneratorType.OverridingRootKey, -1);
      const coarseTune = this.getGenValue(generators, GeneratorType.CoarseTune, 0); // semitone
      const fineTune = this.getGenValue(generators, GeneratorType.FineTune, 0); // cents
      const scaleTuningCents = this.getGenValue(generators, GeneratorType.ScaleTuning, 100); // cents/semitone

      const sampleOriginalPitch = sample.header?.originalPitch ?? 60;
      const rootKey = overridingRootKey >= 0 ? overridingRootKey : sampleOriginalPitch;

      const pitchCorrection = sample.header?.pitchCorrection || 0; // cents
      const tuningCentsOffset = pitchCorrection + coarseTune * 100 + fineTune;

      const sampleData: Float32Array = sample.data;
      const sampleRate: number = sample.header?.sampleRate || 44100;

      // -------------------------------------------------------------
      // RESOLUSI TITIK LOOP YANG TAHAN-BANTING
      //
      // Spec SF2 menyimpan `startloop`/`endloop` di SHDR sebagai indeks ke
      // dalam POOL sampel gabungan seluruh file (bersama field `start`/`end`
      // yang menandai potongan sample INI di dalam pool tsb) — bukan
      // otomatis relatif ke 0 pada buffer sample yang sudah dipotong per
      // instrumen. Sebagian parser sudah menormalkannya jadi relatif,
      // sebagian lagi (termasuk kasus ini) membiarkannya apa adanya.
      //
      // Sebelumnya kode ini langsung memakai startloop/endloop mentah.
      // Kalau nilainya ternyata masih absolut (jauh melebihi panjang
      // sampleData milik sample ini), Web Audio gagal me-loop dengan benar
      // dan pemutaran cuma berhenti begitu saja begitu buffer pendeknya
      // habis — inilah sebabnya instrumen yang MEMANG didesain lewat
      // sample pendek + loop (Flute, Strings, Reed, Organ, Pad, dsb)
      // terdengar "kepotong", sementara instrumen satu-tembakan (Piano,
      // Pluck) tidak menunjukkan gejala ini karena memang tak butuh loop.
      const sampleStartAbs: number = sample.header?.start ?? 0;
      const rawStartLoop: number = sample.header?.startloop || 0;
      const rawEndLoop: number = sample.header?.endloop || 0;

      let startLoop = rawStartLoop;
      let endLoop = rawEndLoop;
      const outOfRange = rawStartLoop >= sampleData.length || rawEndLoop > sampleData.length;
      if (outOfRange && sampleStartAbs > 0) {
        // Nilai mentah tidak muat di buffer sample ini -> asumsikan masih
        // absolut terhadap pool, geser jadi relatif ke sample ini.
        startLoop = rawStartLoop - sampleStartAbs;
        endLoop = rawEndLoop - sampleStartAbs;
      }

      // Jaga tetap dalam batas panjang buffer & urutan yang masuk akal,
      // supaya tidak pernah memberi loopStart/loopEnd yang tidak valid.
      startLoop = Math.max(0, Math.min(startLoop, sampleData.length - 1));
      endLoop = Math.max(0, Math.min(endLoop, sampleData.length));

      // -------------------------------------------------------------
      // KEPUTUSAN LOOP YANG BENAR: PAKAI GENERATOR `sampleModes`, BUKAN
      // CUMA MENERKA DARI JARAK startloop/endloop.
      //
      // Sebelumnya isLooping ditentukan HANYA dari "apakah endLoop jauh
      // lebih besar dari startLoop". Itu tebakan yang tidak konsisten:
      // - Sample yang memang dimaksudkan SEKALI-PUTAR (mis. pluck/perc)
      //   kadang masih punya sisa metadata startloop/endloop dari proses
      //   authoring, sehingga heuristik lama SALAH mengaktifkan loop dan
      //   suaranya jadi "ketahan"/berdengung terus alih-alih berhenti wajar.
      // - Sample yang memang dimaksudkan MENGALUN PANJANG (aerofon seperti
      //   Flute/Sax/Oboe/Clarinet/Trumpet/French Horn, juga Strings/Organ/
      //   Pad) tapi titik loop mentahnya kebetulan tidak lolos ambang
      //   heuristik (mis. setelah koreksi absolut->relatif ternyata jadi
      //   sangat rapat), sehingga SALAH dianggap sekali-putar. Begitu
      //   buffer sample pendeknya habis, Web Audio otomatis berhenti walau
      //   kurva ADSR masih minta bunyi berlanjut -> kedengaran "kepotong"
      //   sebentar saja walau attack/decay/sustain/release-nya sudah benar.
      //
      // Spec SF2 generator `sampleModes` (id 54) adalah sumber kebenaran
      // yang eksplisit dari pembuat bank: 0 = no loop, 1 = loop terus,
      // 2 = reserved (diperlakukan sbg no loop), 3 = loop lalu lepas ke
      // sisa sample saat not dilepas. Kita hormati nilai ini dulu; kalau
      // generator ini tidak tersedia sama sekali di file SF2 (bank lama/
      // minimal), baru jatuh kembali ke heuristik jarak titik loop seperti
      // sebelumnya.
      // -------------------------------------------------------------
      const sampleModesRaw = this.getGenValue(
        generators,
        (GeneratorType as any).SampleModes,
        -1
      );
      const explicitNoLoop = sampleModesRaw === 0 || sampleModesRaw === 2;
      const explicitLoop = sampleModesRaw === 1 || sampleModesRaw === 3;
      const rangeLooksValid = endLoop > startLoop + 32;

      let isLooping: boolean;
      if (explicitNoLoop) {
        isLooping = false;
      } else if (explicitLoop) {
        if (rangeLooksValid) {
          isLooping = true;
        } else {
          // SF2 bilang sample ini HARUS mengalun (loop), tapi titik loop
          // mentahnya rusak/tidak valid. Daripada diam-diam jatuh jadi
          // sekali-putar (yang bikin instrumen aerofon kepotong), pakai
          // fallback loop di bagian ekor sample (setelah transient attack)
          // supaya tetap bisa mengalun sepanjang durasi ADSR yang diminta.
          startLoop = Math.floor(sampleData.length * 0.2);
          endLoop = sampleData.length - 1;
          isLooping = endLoop > startLoop + 32;
        }
      } else {
        // Generator tidak tersedia di file ini -> pertahankan perilaku lama.
        isLooping = rangeLooksValid;
      }

      let isUnnormalized = false;
      const checkLimit = Math.min(120, sampleData.length);
      for (let i = 0; i < checkLimit; i++) {
        if (Math.abs(sampleData[i]) > 1.2) {
          isUnnormalized = true;
          break;
        }
      }

      const normalized = new Float32Array(sampleData.length);
      const divider = isUnnormalized ? 32768.0 : 1.0;
      for (let i = 0; i < sampleData.length; i++) {
        normalized[i] = sampleData[i] / divider;
      }

      const audioBuf = ctx.createBuffer(1, normalized.length, sampleRate);
      audioBuf.getChannelData(0).set(normalized);

      const normalizationGain = this.computeLoudnessNormalizationGain(normalized);

      const result: SampleBufferMetadata = {
        buffer: audioBuf,
        rootKey,
        isLooping,
        loopStartSec: startLoop / sampleRate,
        loopEndSec: endLoop / sampleRate,
        tuningCentsOffset,
        scaleTuningCents,
        normalizationGain,
      };

      this.bufferCache[cacheKey] = result;
      return result;
    } catch {
      return null;
    }
  }

  // Inti pemutaran voice akor — dipakai bersama oleh playChordNotes (Progresi
  // Akor 1, memakai this.adsr) dan playChordLayer (Progresi Akor 2 opsional,
  // memakai ADSR & instrumen sendiri). Dipisah + ditandai `group` supaya
  // kedua progresi bisa dimainkan BERSAMAAN dan diretrigger secara independen
  // tanpa memotong voice progresi yang lain.
  private playChordVoicesInternal(
    midiNotes: number[],
    programNumber: number,
    volume: number,
    noteDurationSec: number,
    adsr: EnvelopeADSR,
    group: 'primary' | 'progresi2'
  ) {
    const ctx = this.getAudioContext();
    const now = ctx.currentTime;

    const a = Math.max(0.005, adsr.attack);
    const d = Math.max(0.01, adsr.decay);
    const s = Math.max(0.01, Math.min(1.0, adsr.sustain));
    const r = Math.max(0.04, adsr.release);

    const peakVolBase = 0.35 * volume;

    if (this.soundfontInstance) {
      midiNotes.forEach((midiNote) => {
        const meta = this.getSampleMetadata(midiNote, programNumber);
        if (meta) {
          const peakVol = peakVolBase * meta.normalizationGain;
          const sustainVol = peakVol * s;

          const src = ctx.createBufferSource();
          src.buffer = meta.buffer;

          if (meta.isLooping) {
            src.loop = true;
            src.loopStart = meta.loopStartSec;
            src.loopEnd = meta.loopEndSec;
          }

          const semitoneDiff = midiNote - meta.rootKey;
          const totalCents = semitoneDiff * meta.scaleTuningCents + meta.tuningCentsOffset;
          src.playbackRate.value = Math.pow(2, totalCents / 1200);

          const gain = ctx.createGain();
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peakVol), now + a);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustainVol), now + a + d);
          const holdUntil = now + Math.max(a + d, noteDurationSec);
          gain.gain.setValueAtTime(Math.max(0.0001, sustainVol), holdUntil);
          gain.gain.exponentialRampToValueAtTime(0.0001, holdUntil + r);

          src.connect(gain);
          gain.connect(this.compressor || ctx.destination);

          const totalStop = holdUntil + r + 0.05;
          src.start(now);
          src.stop(totalStop);

          this.activeVoices.push({ source: src, gain, stopAtTime: totalStop, group });
        }
      });
    }
  }

  // Pemutaran Polifonik Bersih dengan Kontrol ADSR Penuh — Progresi Akor 1
  // (instrumen utama). Hanya menghentikan voice grup 'primary' sebelumnya,
  // supaya TIDAK memotong Progresi Akor 2 yang mungkin sedang mengalun.
  public playChordNotes(
    midiNotes: number[],
    programNumber: number = 0,
    volume: number = 1.0,
    noteDurationSec: number = 1.0
  ) {
    // Hentikan nada sebelumnya secara mulus tanpa kresek
    this.stopAllChords(0.02, 'primary');
    this.playChordVoicesInternal(midiNotes, programNumber, volume, noteDurationSec, this.adsr, 'primary');
  }

  // Progresi Akor 2 (opsional) — sequencer/progresi TERPISAH dari Progresi
  // Akor 1, bukan sekadar layer yang menumpuk not yang sama. Punya instrumen
  // (programNumber) dan kurva ADSR sendiri, dan hanya menghentikan voice
  // grup 'progresi2' sebelumnya (tidak memotong Progresi Akor 1).
  public playChordLayer(
    midiNotes: number[],
    programNumber: number,
    volume: number,
    noteDurationSec: number,
    adsr: EnvelopeADSR
  ) {
    this.stopAllChords(0.02, 'progresi2');
    this.playChordVoicesInternal(midiNotes, programNumber, volume, noteDurationSec, adsr, 'progresi2');
  }

  // -------------------------------------------------------------------
  // RENDER SATU NOT AKOR KE KONTEKS/DESTINASI APA PUN (dipakai live
  // maupun ekspor offline). Logikanya SAMA PERSIS dengan playChordNotes
  // (sample SF2 asli + kurva ADSR 4 tahap + normalisasi loudness +
  // resolusi pitch), tapi menerima `ctx`/`destination`/`startTime`
  // eksplisit alih-alih selalu memakai AudioContext & compressor milik
  // instance ini. Ini membuat ExportPatternModal bisa merender chord
  // pad memakai SUARA SOUNDFONT+PROGRAM YANG SAMA dengan yang didengar
  // saat pad ditekan langsung, bukan oscillator generik terpisah.
  // -------------------------------------------------------------------
  public renderChordNoteToDestination(
    ctx: BaseAudioContext,
    destination: AudioNode,
    midiNote: number,
    programNumber: number,
    startTime: number,
    holdSec: number,
    volume: number,
    adsr: EnvelopeADSR
  ) {
    const meta = this.getSampleMetadata(midiNote, programNumber);
    if (!meta) return;

    const a = Math.max(0.005, adsr.attack);
    const d = Math.max(0.01, adsr.decay);
    const s = Math.max(0.0, Math.min(1.0, adsr.sustain));
    const r = Math.max(0.04, adsr.release);

    const peakVol = 0.35 * volume * meta.normalizationGain;
    const sustainVol = Math.max(0.0001, peakVol * s);

    const src = ctx.createBufferSource();
    src.buffer = meta.buffer;

    if (meta.isLooping) {
      src.loop = true;
      src.loopStart = meta.loopStartSec;
      src.loopEnd = meta.loopEndSec;
    }

    const semitoneDiff = midiNote - meta.rootKey;
    const totalCents = semitoneDiff * meta.scaleTuningCents + meta.tuningCentsOffset;
    src.playbackRate.value = Math.pow(2, totalCents / 1200);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peakVol), startTime + a);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, sustainVol), startTime + a + d);
    const holdUntil = startTime + Math.max(a + d, holdSec);
    gain.gain.setValueAtTime(Math.max(0.0001, sustainVol), holdUntil);
    gain.gain.exponentialRampToValueAtTime(0.0001, holdUntil + r);

    src.connect(gain);
    gain.connect(destination);

    const totalStop = holdUntil + r + 0.05;
    src.start(startTime);
    src.stop(totalStop);
  }

  // Pastikan bank SF2 sudah termuat sebelum dipakai (dipanggil dari alur
  // ekspor supaya tidak diam-diam jatuh ke suara kosong kalau pengguna
  // belum pernah memicu initBank()).
  public async ensureBankLoaded(): Promise<boolean> {
    if (this.isLoaded) return true;
    return this.initBank();
  }

  // -------------------------------------------------------------------
  // Ambil (dan cache) buffer sample WAV drum asli untuk kit+part tertentu,
  // didekode memakai `ctx` yang diberikan (bisa AudioContext biasa atau
  // OfflineAudioContext saat ekspor). Dipakai bersama renderDrumHitToDestination
  // di bawah supaya ekspor memakai sample REAL yang sama dgn playDrumSound,
  // bukan fallback sintesis kalau sample-nya memang tersedia.
  // -------------------------------------------------------------------
  public async getDrumSampleBuffer(ctx: BaseAudioContext, kitName: string, part: string): Promise<AudioBuffer | null> {
    const folder = kitName.toLowerCase().replace(/\s+kit/g, '').trim();
    const cacheKey = `${folder}_${part}`;
    if (this.drumCache[cacheKey]) {
      return this.drumCache[cacheKey];
    }
    try {
      const res = await fetch(`/sounds/drums/${folder}/${part}.wav`);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        this.drumCache[cacheKey] = buf;
        return buf;
      }
    } catch {}
    return null;
  }

  // Render satu hit drum ke konteks/destinasi apa pun, di waktu (startTime)
  // eksplisit. Memakai sample WAV asli kalau tersedia (sama seperti
  // playDrumSound), atau fallback ke synthesizeDrum dengan profil kit yang
  // BENAR (bukan oscillator generik) kalau sample-nya tidak ada.
  public renderDrumHitToDestination(
    ctx: BaseAudioContext,
    destination: AudioNode,
    part: string,
    kitName: string,
    startTime: number,
    volume: number,
    preloadedBuffer?: AudioBuffer | null,
    adsr?: EnvelopeADSR
  ) {
    if (preloadedBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = preloadedBuffer;
      const gain = ctx.createGain();
      const useAdsr = adsr || this.drumAdsr;
      const stopAt = this.applyAdsrEnvelope(gain, useAdsr, startTime, preloadedBuffer.duration, volume);
      src.connect(gain);
      gain.connect(destination);
      src.start(startTime);
      src.stop(stopAt);
      return;
    }
    const folder = kitName.toLowerCase().replace(/\s+kit/g, '').trim();
    this.synthesizeDrum(part, folder, ctx, volume, startTime, destination);
  }

  // Pemutar Drum Pad
  public async playDrumSound(part: string, kitName: string = '80s Kit', volume: number = 1.0) {
    const ctx = this.getAudioContext();
    const folder = kitName.toLowerCase().replace(/\s+kit/g, '').trim();
    const cacheKey = `${folder}_${part}`;

    const playBuffer = (buf: AudioBuffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      const now = ctx.currentTime;
      const stopAt = this.applyAdsrEnvelope(gain, this.drumAdsr, now, buf.duration, volume);
      src.connect(gain);
      gain.connect(this.compressor || ctx.destination);
      src.start(now);
      src.stop(stopAt);
    };

    if (this.drumCache[cacheKey]) {
      playBuffer(this.drumCache[cacheKey]);
      return;
    }

    try {
      const res = await fetch(`/sounds/drums/${folder}/${part}.wav`);
      if (res.ok) {
        const ab = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(ab);
        this.drumCache[cacheKey] = buf;
        playBuffer(buf);
        return;
      }
    } catch {}

    this.synthesizeDrum(part, folder, ctx, volume);
  }

  // NOTE: fallback `this.compressor` HANYA valid kalau `ctx` yang diberikan
  // memang AudioContext live milik instance ini. Untuk rendering offline
  // (ekspor), pemanggil WAJIB mengirim `destination` eksplisit ke
  // playNoiseVoice/playTonalVoice/synthesizeDrum di bawah supaya method ini
  // tidak pernah dipanggil dengan ctx offline (menyambungkan node dari
  // OfflineAudioContext ke compressor milik AudioContext lain akan
  // menyebabkan error "cannot connect to a destination belonging to a
  // different audio context").
  private getOutputNode(ctx: BaseAudioContext): AudioNode {
    return this.compressor || ctx.destination;
  }

  // Waveshaper soft-clip untuk memberi karakter "drive" (dipakai kit
  // Industrial/Breakbeat/Electro/80s agar terasa lebih agresif/gahar).
  private createDriveShaper(ctx: BaseAudioContext, amount: number): WaveShaperNode {
    const shaper = ctx.createWaveShaper();
    const samples = 256;
    const curve = new Float32Array(samples);
    const k = amount * 20;
    for (let i = 0; i < samples; i++) {
      const x = (i / (samples - 1)) * 2 - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    return shaper;
  }

  // Ekor delay pendek yang meniru ambience/reverb ringan tanpa perlu file
  // impulse-response terpisah (dipakai kit Ambient/Jazzy/Hiphop).
  private applyAmbienceTail(ctx: BaseAudioContext, source: AudioNode, amount: number, now: number, destination?: AudioNode) {
    if (amount <= 0) return;
    const delay = ctx.createDelay(1.0);
    delay.delayTime.value = 0.09 + amount * 0.05;
    const feedback = ctx.createGain();
    feedback.gain.setValueAtTime(Math.min(0.6, amount), now);
    const wetGain = ctx.createGain();
    wetGain.gain.setValueAtTime(Math.min(0.45, amount), now);
    const tailFilter = ctx.createBiquadFilter();
    tailFilter.type = 'lowpass';
    tailFilter.frequency.value = 3200;

    source.connect(delay);
    delay.connect(tailFilter);
    tailFilter.connect(feedback);
    feedback.connect(delay);
    tailFilter.connect(wetGain);
    wetGain.connect(destination || this.getOutputNode(ctx));
  }

  // Suara berbasis noise (snare/clap/hat/splash/perc/fx) melalui filter +
  // envelope, lalu dialirkan lewat drive & ambience sesuai profil kit.
  private playNoiseVoice(
    ctx: BaseAudioContext,
    now: number,
    volume: number,
    profile: DrumKitProfile,
    opts: { filterType: BiquadFilterType; freq: number; q?: number; decay: number; peakGain: number; bufferDur?: number; delaySec?: number },
    destination?: AudioNode
  ) {
    const startAt = now + (opts.delaySec ?? 0);
    const noise = this.createNoiseBuffer(ctx, opts.bufferDur ?? opts.decay + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filterType;
    filter.frequency.value = Math.max(80, opts.freq * profile.brightness);
    if (opts.q !== undefined) filter.Q.value = opts.q;

    const gain = ctx.createGain();
    const decay = Math.max(0.02, opts.decay * profile.decayScale);
    gain.gain.setValueAtTime(opts.peakGain * volume, startAt);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + decay);

    noise.connect(filter);
    filter.connect(gain);

    let outNode: AudioNode = gain;
    if (profile.drive > 0) {
      const shaper = this.createDriveShaper(ctx, profile.drive);
      gain.connect(shaper);
      outNode = shaper;
    }
    outNode.connect(destination || this.getOutputNode(ctx));
    this.applyAmbienceTail(ctx, outNode, profile.ambience, startAt, destination);

    noise.start(startAt);
  }

  // Suara bertitinada (kick/tom/perc/ride) lewat osilator + envelope pitch,
  // juga dialirkan lewat drive & ambience sesuai profil kit.
  private playTonalVoice(
    ctx: BaseAudioContext,
    now: number,
    volume: number,
    profile: DrumKitProfile,
    opts: { type: OscillatorType; startFreq: number; endFreq?: number; sweepTime?: number; decay: number; peakGain: number },
    destination?: AudioNode
  ) {
    const osc = ctx.createOscillator();
    osc.type = opts.type;
    const startFreq = opts.startFreq * semitoneRatio(profile.pitchShiftSemitones);
    osc.frequency.setValueAtTime(startFreq, now);
    if (opts.endFreq !== undefined) {
      const endFreq = Math.max(20, opts.endFreq * semitoneRatio(profile.pitchShiftSemitones * 0.5));
      osc.frequency.exponentialRampToValueAtTime(endFreq, now + (opts.sweepTime ?? opts.decay));
    }

    const gain = ctx.createGain();
    const decay = Math.max(0.02, opts.decay * profile.decayScale);
    gain.gain.setValueAtTime(opts.peakGain * volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + decay);

    osc.connect(gain);

    let outNode: AudioNode = gain;
    if (profile.drive > 0) {
      const shaper = this.createDriveShaper(ctx, profile.drive);
      gain.connect(shaper);
      outNode = shaper;
    }
    outNode.connect(destination || this.getOutputNode(ctx));
    this.applyAmbienceTail(ctx, outNode, profile.ambience, now, destination);

    osc.start(now);
    osc.stop(now + decay + 0.05);
  }

  // -------------------------------------------------------------------
  // Sintesis 10 bagian drum, masing-masing dengan bentuk gelombang/filter
  // KHAS-nya sendiri (bukan lagi 8 dari 10 bagian berbagi 1 cabang 'else'
  // yang identik), dimodulasi oleh profil 7 kit di atas.
  // -------------------------------------------------------------------
  // `startTime`/`destination` opsional: kalau tidak diberikan, berperilaku
  // persis seperti sebelumnya (pakai ctx.currentTime & compressor live).
  // Kalau diberikan (dipakai saat ekspor offline), setiap voice dijadwalkan
  // di waktu eksplisit tsb dan disalurkan ke destination yang eksplisit
  // pula (mis. master gain milik OfflineAudioContext), bukan compressor
  // milik AudioContext live yang berbeda instance sepenuhnya.
  private synthesizeDrum(
    part: string,
    kit: string,
    ctx: BaseAudioContext,
    volume: number = 1.0,
    startTime?: number,
    destination?: AudioNode
  ) {
    const now = startTime ?? ctx.currentTime;
    const profile = DRUM_KIT_PROFILES[kit] || DRUM_KIT_PROFILES['80s'];

    switch (part) {
      case 'kick': {
        this.playTonalVoice(ctx, now, volume, profile, {
          type: 'sine', startFreq: 150, endFreq: 42, sweepTime: 0.1, decay: 0.3, peakGain: 0.9,
        }, destination);
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'highpass', freq: 1200, decay: 0.02, peakGain: 0.4, bufferDur: 0.02,
        }, destination);
        break;
      }
      case 'snare': {
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'highpass', freq: 1600, decay: 0.18, peakGain: 0.65,
        }, destination);
        this.playTonalVoice(ctx, now, volume, profile, {
          type: 'triangle', startFreq: 210, endFreq: 150, sweepTime: 0.08, decay: 0.1, peakGain: 0.35,
        }, destination);
        break;
      }
      case 'clap': {
        // 3 letupan noise cepat (flam) + satu ekor lebih panjang.
        [0, 0.018, 0.036].forEach((delaySec) => {
          this.playNoiseVoice(ctx, now, volume, profile, {
            filterType: 'bandpass', freq: 1500, q: 2.2, decay: 0.045, peakGain: 0.55, delaySec,
          }, destination);
        });
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'bandpass', freq: 1300, q: 1.5, decay: 0.16, peakGain: 0.3, delaySec: 0.05,
        }, destination);
        break;
      }
      case 'closedhat': {
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'highpass', freq: 7500, decay: 0.045, peakGain: 0.35,
        }, destination);
        break;
      }
      case 'openhat': {
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'highpass', freq: 7000, decay: 0.35, peakGain: 0.32,
        }, destination);
        break;
      }
      case 'tom': {
        this.playTonalVoice(ctx, now, volume, profile, {
          type: 'sine', startFreq: 200, endFreq: 95, sweepTime: 0.22, decay: 0.32, peakGain: 0.7,
        }, destination);
        break;
      }
      case 'splash': {
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'bandpass', freq: 5200, q: 1.1, decay: 0.22, peakGain: 0.4,
        }, destination);
        break;
      }
      case 'ride': {
        // Karakter metalik: beberapa nada tinggi yang saling detune + noise tipis.
        [3200, 4300, 5300].forEach((freq, i) => {
          this.playTonalVoice(ctx, now, volume * 0.5, profile, {
            type: i === 0 ? 'triangle' : 'square', startFreq: freq, decay: 0.7, peakGain: 0.18,
          }, destination);
        });
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'highpass', freq: 6500, decay: 0.6, peakGain: 0.15,
        }, destination);
        break;
      }
      case 'perc': {
        this.playTonalVoice(ctx, now, volume, profile, {
          type: 'triangle', startFreq: 520, endFreq: 380, sweepTime: 0.07, decay: 0.13, peakGain: 0.5,
        }, destination);
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'bandpass', freq: 2200, q: 3, decay: 0.03, peakGain: 0.25,
        }, destination);
        break;
      }
      case 'fx':
      default: {
        // Impact/riser panjang: sapuan sub rendah + ekor noise ber-lowpass.
        this.playTonalVoice(ctx, now, volume, profile, {
          type: 'sine', startFreq: 320, endFreq: 30, sweepTime: 0.55, decay: 0.7, peakGain: 0.6,
        }, destination);
        this.playNoiseVoice(ctx, now, volume, profile, {
          filterType: 'lowpass', freq: 2500, decay: 0.9, peakGain: 0.3, bufferDur: 0.9,
        }, destination);
        break;
      }
    }
  }

  private createNoiseBuffer(ctx: BaseAudioContext, duration: number): AudioBufferSourceNode {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    return noise;
  }
}

export const audioEngine = new AudioEngine();
