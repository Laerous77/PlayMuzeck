// src/services/quizJsonStore.ts
// Penyimpanan kuis buatan pengguna dalam bentuk JSON.
//  - Disimpan di localStorage sebagai SATU dokumen JSON (kunci: muzeck_custom_decks_json)
//  - Bisa diunduh sebagai berkas .json (per deck atau semua) dan diimpor kembali
// Browser tidak boleh menulis berkas ke disk secara diam-diam, jadi "berkas" JSON dibuat lewat
// tombol Unduh; salinan kerja tetap ada di localStorage.
import type { Deck, Topic } from '../types';
import { scopedKey } from './userScope';

export const CUSTOM_DECKS_JSON_KEY = 'muzeck_custom_decks_json';
const FORMAT = 'muzeck-quiz-decks';

export interface QuizJsonDocument {
  format: typeof FORMAT;
  version: 1;
  updatedAt: string;
  topics: Topic[];
  decks: Deck[];
}

const emptyDoc = (): QuizJsonDocument => ({
  format: FORMAT,
  version: 1,
  updatedAt: new Date().toISOString(),
  topics: [],
  decks: [],
});

export function loadCustomQuizJson(): QuizJsonDocument {
  try {
    const raw = localStorage.getItem(scopedKey(CUSTOM_DECKS_JSON_KEY));
    if (!raw) return emptyDoc();
    const parsed = JSON.parse(raw);
    if (parsed?.format !== FORMAT || !Array.isArray(parsed.decks)) return emptyDoc();
    return { ...emptyDoc(), ...parsed, topics: parsed.topics || [] };
  } catch {
    return emptyDoc();
  }
}

function writeDoc(doc: QuizJsonDocument): boolean {
  try {
    doc.updatedAt = new Date().toISOString();
    localStorage.setItem(scopedKey(CUSTOM_DECKS_JSON_KEY), JSON.stringify(doc, null, 2));
    return true;
  } catch {
    return false; // kuota localStorage penuh / tidak tersedia
  }
}

/** Simpan (atau perbarui) satu deck kustom beserta topiknya ke dokumen JSON. */
export function saveDeckToJsonStore(deck: Deck, topic?: Topic): boolean {
  const doc = loadCustomQuizJson();
  doc.decks = [...doc.decks.filter((d) => d.id !== deck.id), deck];
  if (topic) doc.topics = [...doc.topics.filter((t) => t.id !== topic.id), topic];
  return writeDoc(doc);
}

export function removeDeckFromJsonStore(deckId: string): boolean {
  const doc = loadCustomQuizJson();
  const removed = doc.decks.find((d) => d.id === deckId);
  doc.decks = doc.decks.filter((d) => d.id !== deckId);
  if (removed) {
    const stillUsed = doc.decks.some((d) => d.topicId === removed.topicId);
    if (!stillUsed) doc.topics = doc.topics.filter((t) => t.id !== removed.topicId);
  }
  return writeDoc(doc);
}

// ---------- Unduh / Impor ----------

export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000); // revoke langsung bisa membatalkan unduhan di sebagian browser
}

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'kuis';

/** Unduh satu deck (soal + pilihan + kunci jawaban + penjelasan + media) sebagai .json */
export function downloadDeckJson(deck: Deck, topic?: Topic) {
  const doc: QuizJsonDocument = { ...emptyDoc(), decks: [deck], topics: topic ? [topic] : [] };
  downloadJson(`${slug(deck.title)}.json`, doc);
}

export function downloadAllDecksJson(decks: Deck[], topics: Topic[] = [], filename = 'muzeck-semua-kuis.json') {
  downloadJson(filename, { ...emptyDoc(), decks, topics });
}

/** Validasi & baca berkas JSON hasil ekspor. Mengembalikan deck yang valid + daftar galat. */
export function parseQuizJson(text: string): { decks: Deck[]; topics: Topic[]; errors: string[] } {
  const errors: string[] = [];
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return { decks: [], topics: [], errors: ['Berkas bukan JSON yang valid.'] };
  }
  const rawDecks: any[] = Array.isArray(data) ? data : Array.isArray(data?.decks) ? data.decks : data?.questions ? [data] : [];
  const decks: Deck[] = [];
  rawDecks.forEach((d, i) => {
    const label = d?.title || `deck #${i + 1}`;
    if (!d?.title || !Array.isArray(d.questions) || d.questions.length === 0) {
      errors.push(`${label}: judul/soal tidak lengkap`);
      return;
    }
    const bad = d.questions.findIndex(
      (q: any) =>
        typeof q?.question !== 'string' ||
        !Array.isArray(q.options) ||
        q.options.length < 2 ||
        !Number.isInteger(q.correctIndex) ||
        q.correctIndex < 0 ||
        q.correctIndex >= q.options.length
    );
    if (bad >= 0) {
      errors.push(`${label}: soal nomor ${bad + 1} tidak valid`);
      return;
    }
    const id = d.id && String(d.id).startsWith('deck-custom-') ? d.id : `deck-custom-${Date.now()}-${i}`;
    decks.push({
      ...d,
      id,
      cardCount: d.questions.length,
      isFree: true,
      price: 0,
      badge: d.badge || 'Kuis Kustom',
    } as Deck);
  });
  return { decks, topics: Array.isArray(data?.topics) ? data.topics : [], errors };
}

// ---------- Cek soal ganda ----------

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const normalizeQuestionText = norm;

/** Mengembalikan pasangan soal identik (teks sama) di antara kumpulan deck. */
export function findDuplicateQuestions(decks: Deck[]): { text: string; where: string[] }[] {
  const map = new Map<string, string[]>();
  decks.forEach((d) =>
    (d.questions || []).forEach((q, i) => {
      const k = norm(q.question || '');
      if (!k) return;
      map.set(k, [...(map.get(k) || []), `${d.title} (no. ${i + 1})`]);
    })
  );
  return [...map.entries()].filter(([, w]) => w.length > 1).map(([text, where]) => ({ text, where }));
}
