// src/data/quiz/index.ts
// Sumber tunggal deck & topik bawaan. Semua soal + kunci jawaban tersimpan di berkas JSON
// pada folder ./decks (satu berkas per deck) sehingga mudah diedit, di-diff, dan diekspor.
// Butuh "resolveJsonModule": true di tsconfig (Vite mendukung impor JSON secara bawaan).
import type { Deck, Topic } from '../../types';

import starter1 from './decks/deck-starter-1.json';
import starter2 from './decks/deck-starter-2.json';
import starter3 from './decks/deck-starter-3.json';
import olahraga from './decks/deck-builtin-olahraga.json';
import sehariHari from './decks/deck-builtin-seharihari.json';
import matematika from './decks/deck-builtin-matematika.json';
import alam from './decks/deck-builtin-alam.json';
import seni from './decks/deck-builtin-seni.json';
import teknologi from './decks/deck-builtin-teknologi.json';
import bahasa from './decks/deck-builtin-bahasa.json';
import sosial from './decks/deck-builtin-sosial.json';
import fiksi from './decks/deck-builtin-fiksi.json';
import musikDunia from './decks/deck-builtin-musikdunia.json';
import psikologi from './decks/deck-builtin-psikologi.json';
import kuliner from './decks/deck-builtin-kuliner.json';
import topicsJson from './topics.json';

/** 3 deck gratis permanen (tetap ada, tidak bisa diedit/dihapus dari UI). */
export const STARTER_DECKS = [starter1, starter2, starter3] as unknown as Deck[];

/** Deck bawaan tambahan (30 soal per deck). */
export const EXTRA_BUILTIN_DECKS = [
  olahraga,
  sehariHari,
  matematika,
  alam,
  seni,
  teknologi,
  bahasa,
  sosial,
  fiksi,
  musikDunia,
  psikologi,
  kuliner,
] as unknown as Deck[];

/** Seluruh deck bawaan = 3 starter + 12 deck tambahan. */
export const BUILTIN_DECKS: Deck[] = [...STARTER_DECKS, ...EXTRA_BUILTIN_DECKS];

export const BUILTIN_TOPICS = topicsJson as unknown as Topic[];

export const BUILTIN_DECK_IDS = new Set(BUILTIN_DECKS.map((d) => d.id));

/** true untuk deck bawaan (starter maupun tambahan) → jangan tampilkan tombol edit/hapus. */
export const isBuiltinDeckId = (id: string): boolean => BUILTIN_DECK_IDS.has(id);
