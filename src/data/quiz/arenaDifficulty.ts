// src/data/quiz/arenaDifficulty.ts
//
// SISTEM TINGKAT KESULITAN ARENA GLOBAL — satu-satunya sumber aturan, dipakai server (server/arenaMatch.ts,
// server/globalArena.ts) DAN klien (MultiplayerArenaModal), jadi angka di layar selalu sama dengan angka di server.
//
// Empat tingkat: Mudah, Normal, Sulit, Ekstrem. Tiap tingkat punya kanal sendiri; pemain memilih tingkat saat bergabung.
//
//   Tingkat | Waktu/soal | Jumlah soal | Pengurangan skor        | Soal komunitas
//   --------+------------+-------------+-------------------------+---------------
//   Mudah   | 30-60 dtk  | 10-20       | tidak aktif             | 10-25%
//   Normal  | 25-50 dtk  | 15-30       | tidak aktif             | 20-40%
//   Sulit   | 15-40 dtk  | 20-50       | aktif (1x penalti)      | 40-65%
//   Ekstrem | 10-30 dtk  | 30-100      | aktif (1,5x Sulit)      | 65-95%
//
// Cara membaca rentang: SETIAP PERMAINAN server mengundi angka di dalam rentang (waktu per soal, jumlah soal, dan
// peluang soal komunitas). Waktu per soal sama untuk semua soal dalam satu permainan supaya adil bagi semua pemain.
// Persentase soal komunitas adalah PELUANG: tiap soal diundi satu per satu, jadi hasil akhirnya bisa sedikit
// bergeser dari peluangnya (dan dibatasi oleh stok soal yang benar-benar tersedia).

export type ArenaDifficulty = 'easy' | 'normal' | 'hard' | 'extreme';

export const ARENA_DIFFICULTY_IDS: readonly ArenaDifficulty[] = ['easy', 'normal', 'hard', 'extreme'];

/** Tingkat yang dipakai bila klien tidak menyebut tingkat. */
export const DEFAULT_ARENA_DIFFICULTY: ArenaDifficulty = 'normal';

export interface Range {
  min: number;
  max: number;
}

export interface ArenaDifficultyConfig {
  id: ArenaDifficulty;
  /** Nama tampilan (Bahasa Indonesia). */
  label: string;
  /** Satu kalimat untuk kartu pilihan tingkat. */
  tagline: string;
  /** Waktu menjawab per soal, detik. */
  timeSec: Range;
  /** Jumlah soal per permainan. */
  questions: Range;
  /** 0 = jawaban salah tidak mengurangi skor; 1 = penalti tingkat Sulit; 1,5 = Ekstrem. */
  penaltyMultiplier: number;
  /** Peluang sebuah soal berasal dari kuis Komunitas (0..1). Sisanya dari kumpulan soal resmi Arena Global. */
  communityShare: Range;
}

/** Penalti dasar tingkat Sulit: poin yang dikurangi untuk SETIAP jawaban salah (jawaban benar tercepat = 100 poin). */
export const ARENA_HARD_PENALTY_POINTS = 20;

export const ARENA_DIFFICULTIES: Record<ArenaDifficulty, ArenaDifficultyConfig> = {
  easy: {
    id: 'easy',
    label: 'Mudah',
    tagline: 'Waktu longgar, soal sedikit, salah tidak mengurangi skor.',
    timeSec: { min: 30, max: 60 },
    questions: { min: 10, max: 20 },
    penaltyMultiplier: 0,
    communityShare: { min: 0.1, max: 0.25 },
  },
  normal: {
    id: 'normal',
    label: 'Normal',
    tagline: 'Waktu lebih singkat dan soal lebih banyak. Salah tetap tidak mengurangi skor.',
    timeSec: { min: 25, max: 50 },
    questions: { min: 15, max: 30 },
    penaltyMultiplier: 0,
    communityShare: { min: 0.2, max: 0.4 },
  },
  hard: {
    id: 'hard',
    label: 'Sulit',
    tagline: 'Cepat dan akurat: jawaban salah mengurangi skor.',
    timeSec: { min: 15, max: 40 },
    questions: { min: 20, max: 50 },
    penaltyMultiplier: 1,
    communityShare: { min: 0.4, max: 0.65 },
  },
  extreme: {
    id: 'extreme',
    label: 'Ekstrem',
    tagline: 'Sesi panjang, waktu ketat, penalti 1,5 kali lebih berat dari Sulit.',
    timeSec: { min: 10, max: 30 },
    questions: { min: 30, max: 100 },
    penaltyMultiplier: 1.5,
    communityShare: { min: 0.65, max: 0.95 },
  },
};

export const isArenaDifficulty = (v: unknown): v is ArenaDifficulty => typeof v === 'string' && (ARENA_DIFFICULTY_IDS as readonly string[]).includes(v);

/** Tingkat dari masukan yang tidak tepercaya. Mengembalikan null bila ada nilai tetapi tidak dikenal. */
export function parseArenaDifficulty(v: unknown): ArenaDifficulty | null {
  if (v === undefined || v === null || v === '') return DEFAULT_ARENA_DIFFICULTY;
  return isArenaDifficulty(v) ? v : null;
}

/** Poin yang dikurangi per jawaban salah (0 bila pengurangan skor tidak aktif). Ekstrem = 1,5 x Sulit. */
export const arenaWrongPenalty = (d: ArenaDifficulty): number => Math.round(ARENA_HARD_PENALTY_POINTS * ARENA_DIFFICULTIES[d].penaltyMultiplier);

export const arenaNegativeScoring = (d: ArenaDifficulty): boolean => ARENA_DIFFICULTIES[d].penaltyMultiplier > 0;

/* ───────── Id permainan campuran (untuk Papan Peringkat) ───────── */

const MIX_PREFIX = 'arena-mix-';

/** Id "deck" untuk permainan Arena Global yang soalnya dicampur dari beberapa sumber, per tingkat. */
export const mixDeckId = (d: ArenaDifficulty) => `${MIX_PREFIX}${d}`;

export function parseMixDeckId(deckId: string): ArenaDifficulty | null {
  if (!deckId.startsWith(MIX_PREFIX)) return null;
  const d = deckId.slice(MIX_PREFIX.length);
  return isArenaDifficulty(d) ? d : null;
}

/** Ringkasan satu baris untuk layar: "30-60 dtk/soal, 10-20 soal, ...". */
export const formatRange = (r: Range, unit = ''): string => (r.min === r.max ? `${r.min}${unit}` : `${r.min}–${r.max}${unit}`);
export const formatShare = (r: Range): string => formatRange({ min: Math.round(r.min * 100), max: Math.round(r.max * 100) }, '%');
