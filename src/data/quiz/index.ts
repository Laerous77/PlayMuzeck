// src/data/quiz/index.ts
import type { Deck, Topic } from '../../types';
import topicsData from './topics.json';

import deckAlam from './decks/deck-builtin-alam.json';
import deckBahasa from './decks/deck-builtin-bahasa.json';
import deckFiksi from './decks/deck-builtin-fiksi.json';
import deckKuliner from './decks/deck-builtin-kuliner.json';
import deckMatematika from './decks/deck-builtin-matematika.json';
import deckMusikDunia from './decks/deck-builtin-musikdunia.json';
import deckOlahraga from './decks/deck-builtin-olahraga.json';
import deckPsikologi from './decks/deck-builtin-psikologi.json';
import deckSehariHari from './decks/deck-builtin-seharihari.json';
import deckSeni from './decks/deck-builtin-seni.json';
import deckSosial from './decks/deck-builtin-sosial.json';
import deckTeknologi from './decks/deck-builtin-teknologi.json';
import deckStarter1 from './decks/deck-starter-1.json';
import deckStarter2 from './decks/deck-starter-2.json';
import deckStarter3 from './decks/deck-starter-3.json';

// Starter decks yang diimpor oleh QuizIndex.tsx
export const STARTER_DECKS: Deck[] = [
  deckStarter1,
  deckStarter2,
  deckStarter3,
] as unknown as Deck[];

export const BUILTIN_TOPICS: Topic[] = topicsData as unknown as Topic[];
export const TOPICS: Topic[] = BUILTIN_TOPICS;

export const BUILTIN_DECKS: Deck[] = [
  deckStarter1,
  deckStarter2,
  deckStarter3,
  deckAlam,
  deckBahasa,
  deckFiksi,
  deckKuliner,
  deckMatematika,
  deckMusikDunia,
  deckOlahraga,
  deckPsikologi,
  deckSehariHari,
  deckSeni,
  deckSosial,
  deckTeknologi,
] as unknown as Deck[];

export const DECKS: Deck[] = BUILTIN_DECKS;

export function isBuiltinDeckId(id: string): boolean {
  return BUILTIN_DECKS.some((d) => d.id === id);
}

export function isStarterDeckId(id: string): boolean {
  return STARTER_DECKS.some((d) => d.id === id);
}

export function getBuiltinDeck(id: string): Deck | undefined {
  return BUILTIN_DECKS.find((d) => d.id === id);
}

export function getDeckById(id: string): Deck | undefined {
  return BUILTIN_DECKS.find((d) => d.id === id);
}

export default BUILTIN_DECKS;