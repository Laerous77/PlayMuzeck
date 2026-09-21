// src/services/questionTime.ts
// Aturan batas waktu per soal, dipakai QuizPlayer (Langsung Main, Pass & Play, Host)
// dan MultiplayerArenaModal.
//
//  - Kuis bawaan (gratis / berbayar): waktu diatur pemain saat main. Bawaan 30 detik, min 1 detik, maks 3 menit.
//  - Kuis buatan Editor: waktu ditetapkan pembuat kuis dan TIDAK bisa diubah di Langsung Main,
//    Pass & Play, maupun Multiplayer. Kalau pembuatnya tidak menetapkan batas waktu, dipakai 30 detik.
//  - Mode Host: bebas memilih tanpa timer, waktu bawaan soal, atau atur sendiri (1 detik - 3 menit).

export const DEFAULT_QUESTION_TIME = 30;
export const MIN_QUESTION_TIME = 1;
export const MAX_QUESTION_TIME = 180; // 3 menit

/** Bulatkan & batasi ke rentang 1 - 180 detik. */
export function clampQuestionTime(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_QUESTION_TIME;
  return Math.min(MAX_QUESTION_TIME, Math.max(MIN_QUESTION_TIME, v));
}

/** true bila deck dibuat lewat Quiz Editor (id berawalan "deck-custom-"). */
export function isEditorDeck(deck?: { id?: string } | null): boolean {
  return String(deck?.id || '').startsWith('deck-custom-');
}

/**
 * Waktu bawaan sebuah soal (detik).
 *  - soal punya timeLimitSec > 0 -> waktu itu
 *  - timeLimitSec = 0            -> 0 (pembuat kuis tidak memberi batas waktu)
 *  - tidak ada field timeLimitSec (deck bawaan / kuis lama) -> fallback
 */
export function getQuestionTime(q?: any, fallback: number = DEFAULT_QUESTION_TIME): number {
  const raw = q?.timeLimitSec;
  if (raw === undefined || raw === null || Number.isNaN(Number(raw))) return fallback;
  const t = Number(raw);
  return t > 0 ? clampQuestionTime(t) : 0;
}

/**
 * Waktu untuk mode yang SELALU memakai timer (Langsung Main, Pass & Play, Multiplayer).
 * Kuis Editor: ikut pengaturan pembuat (atau 30 detik bila kosong). Kuis bawaan: pilihan pemain.
 */
export function getPlayTime(deck: { id?: string } | null | undefined, q: any, chosenSec: number): number {
  if (isEditorDeck(deck)) {
    const t = getQuestionTime(q, 0);
    return t > 0 ? t : DEFAULT_QUESTION_TIME;
  }
  return clampQuestionTime(chosenSec);
}

/** 30 -> "30 detik", 90 -> "1 menit 30 detik", 180 -> "3 menit". */
export function formatTimeLabel(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} detik`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m} menit` : `${m} menit ${r} detik`;
}

/** Kalimat penjelasan waktu untuk kuis buatan Editor (dipakai saat pengaturannya terkunci). */
export function describeEditorDeckTime(deck?: { questions?: any[] } | null): string {
  const first = (deck?.questions || []).find((q) => getQuestionTime(q, 0) > 0);
  const sec = first ? getQuestionTime(first, 0) : 0;
  return sec > 0
    ? `Waktu ditetapkan pembuat kuis: ${formatTimeLabel(sec)} per soal.`
    : `Pembuat kuis tidak menetapkan batas waktu, jadi memakai ${formatTimeLabel(DEFAULT_QUESTION_TIME)} per soal.`;
}

/** Keterangan pilihan "Bawaan Soal" di layar setup mode Host. */
export function describeHostDeckTime(deck?: { id?: string; questions?: any[] } | null): string {
  if (isEditorDeck(deck)) {
    const first = (deck?.questions || []).find((q) => getQuestionTime(q, 0) > 0);
    const sec = first ? getQuestionTime(first, 0) : 0;
    return sec > 0
      ? `Memakai waktu dari pembuat kuis: ${formatTimeLabel(sec)} per soal.`
      : 'Pembuat kuis tidak menetapkan batas waktu, jadi sesi berjalan tanpa timer.';
  }
  return `Kuis ini tidak punya pengaturan waktu sendiri, jadi memakai ${formatTimeLabel(DEFAULT_QUESTION_TIME)} per soal.`;
}
