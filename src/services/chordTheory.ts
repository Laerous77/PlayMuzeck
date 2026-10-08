// src/services/chordTheory.ts
// Teori akor MURNI (tanpa Web Audio / DOM / soundfont) supaya bisa dipakai di server (pembuatan berkas MIDI & proyek)
// maupun di browser. audioEngine.ts mengekspor ulang semuanya, jadi impor lama tetap jalan.

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
