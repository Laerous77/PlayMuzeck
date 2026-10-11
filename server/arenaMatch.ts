// server/arenaMatch.ts
//
// PENYUSUN PERMAINAN ARENA GLOBAL (fungsi murni, tanpa database / socket / express, jadi mudah diuji).
//
// Dari dua kumpulan soal:
//   - official  : soal resmi Arena Global (deck preset aktif buatan admin), dan
//   - community : soal dari kuis Komunitas yang SUDAH DISETUJUI moderasi,
// fungsi composeMatch() menyusun satu permainan sesuai tingkat kesulitan (src/data/quiz/arenaDifficulty.ts):
//   1. mengundi jumlah soal, waktu per soal, dan peluang soal komunitas di dalam rentang tingkat itu;
//   2. membuang soal yang tidak layak (kunci jawaban rusak, pilihan kembar, media tidak aman);
//   3. membuang soal KEMBAR (teks sama setelah dinormalisasi), baik di dalam satu kumpulan maupun antar kumpulan,
//      sehingga peluang bertemu soal yang sama dalam satu permainan adalah 0%;
//   4. mengundi sumber tiap soal (komunitas dengan peluang tertentu, sisanya resmi), memakai stok yang ada bila salah satu
//      kumpulan kurang, lalu mengacak urutan soal dan urutan pilihan jawaban tanpa menghilangkan kunci.
import { randomInt } from 'crypto';
import { ARENA_DIFFICULTIES, arenaWrongPenalty, type ArenaDifficulty, type Range } from '../src/data/quiz/arenaDifficulty';

/** Jumlah soal minimum agar sebuah permainan layak dimulai (sama dengan syarat peringkat). */
export const ARENA_MIN_QUESTIONS = 5;

/* ───────────────────────────── Tipe ───────────────────────────── */

export interface ArenaQuestion {
  id?: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
  category?: string;
  timeLimitSec?: number;
  mediaType?: 'image' | 'audio' | 'video';
  mediaUrl?: string;
  mediaCredit?: string;
  mediaSourceUrl?: string;
}

/** Soal di kumpulan. `ownerEmail` hanya ada untuk soal komunitas (rahasia server, tidak pernah dikirim ke klien). */
export interface ArenaPoolQuestion extends ArenaQuestion {
  ownerEmail?: string;
}

export interface ArenaQuestionPools {
  official: ArenaPoolQuestion[];
  community: ArenaPoolQuestion[];
}

export type QuestionOrigin = 'official' | 'community';

/** Soal dalam permainan yang berjalan. */
export interface MatchQuestion extends ArenaQuestion {
  origin: QuestionOrigin;
  ownerEmail?: string;
}

export interface ComposedMatch {
  difficulty: ArenaDifficulty;
  questions: MatchQuestion[];
  /** Waktu menjawab per soal (detik), sama untuk semua soal dalam permainan ini. */
  secPerQuestion: number;
  /** Poin yang dikurangi per jawaban salah (0 = tidak aktif). */
  penalty: number;
  officialQuestions: number;
  communityQuestions: number;
  /** Peluang soal komunitas yang diundi untuk permainan ini (0..1). Hasil nyata bisa sedikit berbeda. */
  communityChance: number;
  /** true bila stok soal lebih sedikit dari jumlah yang diundi, sehingga permainan dipersingkat. */
  shortened: boolean;
}

export interface Rng {
  /** Bilangan bulat acak 0..max-1. */
  int(max: number): number;
  /** Bilangan pecahan acak 0..1 (1 tidak termasuk). */
  float(): number;
}

export const cryptoRng: Rng = {
  int: (max) => randomInt(max),
  float: () => randomInt(2 ** 30) / 2 ** 30,
};

/* ───────────────────────────── Validasi & normalisasi ───────────────────────────── */

/** Kunci pembanding soal kembar: huruf kecil, tanpa tanda baca/aksen, spasi dirapatkan. */
export function normalizeQuestionText(s: string): string {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const isHttpUrl = (v: unknown) => /^https?:\/\//i.test(String(v ?? '')) && String(v).length <= 500;

/**
 * Soal layak dimainkan: teks cukup, 2-6 pilihan terisi dan tidak kembar, kunci jawaban valid, dan media (bila ada)
 * berupa alamat http(s). Soal bermedia data: (base64) tidak dipakai di arena karena terlalu berat dikirim ke banyak pemain.
 */
export function isPlayableQuestion(q: any): q is ArenaQuestion {
  if (!q || typeof q.question !== 'string' || q.question.trim().length < 5) return false;
  if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6) return false;
  if (q.options.some((o: unknown) => typeof o !== 'string' || !o.trim())) return false;
  if (new Set(q.options.map((o: string) => o.trim().toLowerCase())).size !== q.options.length) return false;
  if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length) return false;
  if (q.mediaType !== undefined && q.mediaType !== null && q.mediaType !== '') {
    if (!['image', 'audio', 'video'].includes(q.mediaType) || !isHttpUrl(q.mediaUrl)) return false;
  } else if (q.mediaUrl) {
    return false;
  }
  return true;
}

/** Buang soal tidak layak dan soal kembar. `seen` dipakai bersama supaya kembar antar kumpulan ikut terbuang. */
export function cleanPool(list: unknown, seen: Set<string> = new Set()): ArenaPoolQuestion[] {
  const out: ArenaPoolQuestion[] = [];
  if (!Array.isArray(list)) return out;
  for (const q of list) {
    if (!isPlayableQuestion(q)) continue;
    const key = normalizeQuestionText(q.question);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(q as ArenaPoolQuestion);
  }
  return out;
}

/* ───────────────────────────── Pengacakan ───────────────────────────── */

export function shuffle<T>(arr: T[], rng: Rng = cryptoRng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Acak urutan pilihan tanpa menghilangkan kunci jawabannya. */
export function shuffleOptions<T extends ArenaQuestion>(q: T, rng: Rng = cryptoRng): T {
  const idx = shuffle(
    q.options.map((_, i) => i),
    rng
  );
  return { ...q, options: idx.map((i) => q.options[i]), correctIndex: idx.indexOf(q.correctIndex) };
}

const rollInt = (r: Range, rng: Rng) => r.min + rng.int(r.max - r.min + 1);
const rollFloat = (r: Range, rng: Rng) => r.min + rng.float() * (r.max - r.min);

/* ───────────────────────────── Penyusun ───────────────────────────── */

/**
 * Susun satu permainan. Mengembalikan null bila stok soal yang layak kurang dari ARENA_MIN_QUESTIONS.
 * Bila stok kurang dari jumlah soal yang diundi, permainan dipersingkat (`shortened`) alih-alih menunggu selamanya.
 */
export function composeMatch(pools: ArenaQuestionPools, difficulty: ArenaDifficulty, rng: Rng = cryptoRng): ComposedMatch | null {
  const cfg = ARENA_DIFFICULTIES[difficulty];

  // Soal resmi diproses lebih dulu: bila soal komunitas kembar dengan soal resmi, yang dibuang adalah yang komunitas.
  const seen = new Set<string>();
  const official = cleanPool(pools?.official, seen);
  const community = cleanPool(pools?.community, seen);
  const available = official.length + community.length;
  if (available < ARENA_MIN_QUESTIONS) return null;

  const wanted = rollInt(cfg.questions, rng);
  const total = Math.min(wanted, available);
  const secPerQuestion = rollInt(cfg.timeSec, rng);
  const communityChance = rollFloat(cfg.communityShare, rng);

  // Tiap soal diundi: komunitas dengan peluang `communityChance`, selain itu resmi.
  let nCommunity = 0;
  for (let i = 0; i < total; i++) if (rng.float() < communityChance) nCommunity++;
  // Batasi dengan stok; kekurangan salah satu sumber ditutup oleh sumber lain.
  nCommunity = Math.min(nCommunity, community.length);
  let nOfficial = total - nCommunity;
  if (nOfficial > official.length) {
    nOfficial = official.length;
    nCommunity = total - nOfficial; // pasti <= community.length karena total <= available
  }

  const picked: MatchQuestion[] = [
    ...shuffle(official, rng)
      .slice(0, nOfficial)
      .map((q): MatchQuestion => ({ ...q, origin: 'official' })),
    ...shuffle(community, rng)
      .slice(0, nCommunity)
      .map((q): MatchQuestion => ({ ...q, origin: 'community' })),
  ];

  const questions = shuffle(picked, rng).map((q, i) => {
    const withKey = shuffleOptions(q, rng);
    // Id soal unik per permainan (id asal bisa bentrok antar deck, mis. "q1").
    return { ...withKey, id: `q${i + 1}`, timeLimitSec: secPerQuestion };
  });

  return {
    difficulty,
    questions,
    secPerQuestion,
    penalty: arenaWrongPenalty(difficulty),
    officialQuestions: nOfficial,
    communityQuestions: nCommunity,
    communityChance,
    shortened: total < wanted,
  };
}

/** Pemeriksaan akhir: tidak ada dua soal berteks sama dalam satu permainan. */
export function hasDuplicateQuestions(questions: ArenaQuestion[]): boolean {
  const keys = questions.map((q) => normalizeQuestionText(q.question));
  return new Set(keys).size !== keys.length;
}
