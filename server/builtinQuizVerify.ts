// server/builtinQuizVerify.ts
// Memastikan soal yang dikirim host multiplayer benar-benar berasal dari deck bawaan/starter (data server),
// supaya skor papan peringkat tidak bisa dipalsukan dengan mengklaim deck bawaan tapi memainkan soal buatan sendiri.
import { BUILTIN_DECKS } from '../src/data/quiz/index';

export const isBuiltinDeckKnown = (deckId: string) => BUILTIN_DECKS.some((d) => d.id === deckId);

export function builtinDeckTitle(deckId: string): string {
  return BUILTIN_DECKS.find((d) => d.id === deckId)?.title || '';
}

const sortedKey = (opts: unknown[]) => JSON.stringify([...opts].map(String).sort());

/**
 * true bila SEMUA soal terkirim identik dengan soal di deck bawaan `deckId` (teks, kumpulan pilihan, dan teks jawaban benar),
 * tanpa soal ganda. Urutan soal & urutan pilihan boleh berbeda (host boleh mengacak atau memakai sebagian soal).
 */
export function verifyBuiltinQuestions(deckId: string, sent: unknown): boolean {
  const deck = BUILTIN_DECKS.find((d) => d.id === deckId);
  if (!deck || !Array.isArray(sent) || sent.length === 0) return false;
  const byText = new Map<string, any>();
  for (const q of deck.questions as any[]) byText.set(String(q.question), q);

  const used = new Set<string>();
  for (const q of sent as any[]) {
    const text = String(q?.question ?? '');
    const ref = byText.get(text);
    if (!ref || used.has(text)) return false;
    used.add(text);
    if (!Array.isArray(q.options) || !Array.isArray(ref.options)) return false;
    if (sortedKey(q.options) !== sortedKey(ref.options)) return false;
    if (!Number.isInteger(q.correctIndex)) return false;
    if (String(q.options[q.correctIndex]) !== String(ref.options[ref.correctIndex])) return false;
  }
  return true;
}
