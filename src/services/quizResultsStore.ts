// src/services/quizResultsStore.ts
// Riwayat hasil permainan (disimpan sebagai JSON di localStorage), termasuk RINCIAN JAWABAN
// per soal: teks soal, seluruh pilihan, pilihan pemain, dan kunci jawaban benar.
import { downloadJson } from './quizJsonStore';
import { scopedKey } from './userScope';

export const RESULTS_STORAGE_KEY = 'muzeck_quiz_results';
const MAX_RESULTS = 150;

export type ResultMode = 'solo' | 'pass_play' | 'host';

export interface AnswerLogEntry {
  questionId: string;
  number: number; // nomor soal (1-based)
  question: string;
  options: string[];
  correctIndex: number;
  /** indeks pilihan pemain; -1 = waktu habis; null = tidak dijawab lewat aplikasi (mode Host) */
  selectedIndex: number | null;
  isCorrect: boolean | null;
  playerName?: string; // mode Pass & Play
  category?: string;
  explanation?: string;
  mediaType?: 'image' | 'audio' | 'video';
  mediaUrl?: string; // data: URL tidak disimpan (terlalu besar), hanya tipe media
  mediaCredit?: string;
}

export interface SavedQuizResult {
  id: string;
  savedAt: number;
  deckId: string;
  deckTitle: string;
  mode: ResultMode;
  totalQuestions: number;
  summary: string;
  data: any;
  answers?: AnswerLogEntry[]; // hasil lama (sebelum fitur ini) tidak punya rincian
}

export function loadSavedResults(): SavedQuizResult[] {
  try {
    const raw = localStorage.getItem(scopedKey(RESULTS_STORAGE_KEY));
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Mengembalikan true bila berhasil. Jika kuota penuh, entri terlama dibuang bertahap. */
export function persistSavedResults(list: SavedQuizResult[]): boolean {
  let current = list;
  while (true) {
    try {
      localStorage.setItem(scopedKey(RESULTS_STORAGE_KEY), JSON.stringify(current));
      return true;
    } catch {
      if (current.length <= 1) return false;
      current = current.slice(0, Math.max(1, Math.floor(current.length * 0.8)));
    }
  }
}

export function addSavedResult(entry: SavedQuizResult): boolean {
  return persistSavedResults([entry, ...loadSavedResults()].slice(0, MAX_RESULTS));
}

export function deleteSavedResult(id: string): SavedQuizResult[] {
  const updated = loadSavedResults().filter((r) => r.id !== id);
  persistSavedResults(updated);
  return updated;
}

export function clearSavedResults() {
  persistSavedResults([]);
}

export function downloadResultsJson(results: SavedQuizResult[], filename = 'muzeck-riwayat-hasil.json') {
  downloadJson(filename, { format: 'muzeck-quiz-results', version: 1, exportedAt: new Date().toISOString(), results });
}

/** Ringkas statistik dari log jawaban (abaikan entri mode Host yang tidak dinilai aplikasi). */
export function summarizeAnswers(answers: AnswerLogEntry[]) {
  const graded = answers.filter((a) => a.isCorrect !== null);
  const correct = graded.filter((a) => a.isCorrect).length;
  const timedOut = graded.filter((a) => a.selectedIndex === -1).length;
  return { total: graded.length, correct, wrong: graded.length - correct - timedOut, timedOut };
}
