// src/components/PusatKuis/quizSegments.ts
// Daftar segmen Pusat Kuis + normalisasi nilai yang tersimpan (localStorage "muzeck_last_nav").
// "Papan Peringkat" kini menyatu dengan "Komunitas Kuis" dalam satu segmen ('community'),
// jadi nilai lama 'leaderboard' dipetakan ke 'community' agar pengguna lama tidak melihat halaman kosong.

export type QuizSegment = 'pwa' | 'play' | 'all' | 'community';

export const QUIZ_SEGMENTS: readonly QuizSegment[] = ['pwa', 'play', 'all', 'community'];
export const DEFAULT_QUIZ_SEGMENT: QuizSegment = 'all';

export function normalizeQuizSegment(value: unknown): QuizSegment {
  if (value === 'leaderboard') return 'community';
  return (QUIZ_SEGMENTS as readonly unknown[]).includes(value) ? (value as QuizSegment) : DEFAULT_QUIZ_SEGMENT;
}
