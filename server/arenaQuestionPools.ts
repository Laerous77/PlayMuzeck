// server/arenaQuestionPools.ts
//
// PEMUAT KUMPULAN SOAL ARENA GLOBAL (database -> ArenaQuestionPools). Dipakai sebagai `loadQuestionPools` di
// server/index.ts. Penyusunan permainannya sendiri ada di server/arenaMatch.ts (fungsi murni).
//
//   official  = soal dari deck preset Arena yang AKTIF dan lengkap (12 tema x 20 soal buatan admin).
//   community = soal dari kuis Komunitas berstatus "approved" milik akun yang tidak ditangguhkan. Setiap soal masih diperiksa
//               ulang (isPlayableQuestion) dan soal kembar dibuang saat permainan disusun.
//
// Deck bawaan Pusat Kuis (starter gratis maupun berbayar) tidak pernah dibaca di sini.
//
// Hasil di-cache sebentar (POOL_TTL_MS) supaya tiap kanal yang memulai permainan tidak membebani database. Kumpulan komunitas
// diambil acak dari sejumlah kuis (COMMUNITY_QUIZ_SAMPLE) dan diacak ulang tiap cache habis, jadi seluruh kuis punya peluang tampil.
import type { Pool } from 'pg';
import { listActivePresetDecks } from './arenaPresetRoutes';
import { isPlayableQuestion, type ArenaPoolQuestion, type ArenaQuestionPools } from './arenaMatch';

type Db = Pick<Pool, 'query'>;

export const POOL_TTL_MS = 60_000;
/** Banyak kuis komunitas yang dibaca per penyegaran cache. */
export const COMMUNITY_QUIZ_SAMPLE = 120;

const MIN_QUIZ_QUESTIONS = 5;

/** Soal komunitas dari baris database: hanya yang layak, dengan email pembuat (rahasia server) terlampir. */
export function communityQuestionsFromRows(rows: any[]): ArenaPoolQuestion[] {
  const out: ArenaPoolQuestion[] = [];
  for (const r of rows) {
    const list = Array.isArray(r?.questions) ? r.questions : [];
    if (list.length < MIN_QUIZ_QUESTIONS) continue;
    const ownerEmail = String(r.owner_email || '').toLowerCase();
    for (const q of list) {
      if (!isPlayableQuestion(q)) continue;
      out.push({
        question: q.question.trim(),
        options: q.options.map((o: string) => o.trim()),
        correctIndex: q.correctIndex,
        explanation: typeof q.explanation === 'string' ? q.explanation : '',
        category: typeof q.category === 'string' ? q.category : '',
        ...(q.mediaType ? { mediaType: q.mediaType, mediaUrl: q.mediaUrl, mediaCredit: q.mediaCredit, mediaSourceUrl: q.mediaSourceUrl } : {}),
        ownerEmail,
      });
    }
  }
  return out;
}

export async function loadQuestionPoolsFromDb(db: Db): Promise<ArenaQuestionPools> {
  let official: ArenaPoolQuestion[] = [];
  try {
    const decks = await listActivePresetDecks(db);
    official = decks.flatMap((d) => d.questions as ArenaPoolQuestion[]);
  } catch (e: any) {
    console.error('[arena] gagal membaca soal resmi (deck preset):', e?.message || e);
  }

  let community: ArenaPoolQuestion[] = [];
  try {
    const { rows } = await db.query(
      `SELECT q.id, q.questions, q.owner_email
         FROM shared_quizzes q
         JOIN users u ON lower(u.email) = lower(q.owner_email) AND u.suspended_at IS NULL
        WHERE q.moderation_status = 'approved' AND q.question_count >= $1
        ORDER BY random() LIMIT $2`,
      [MIN_QUIZ_QUESTIONS, COMMUNITY_QUIZ_SAMPLE]
    );
    community = communityQuestionsFromRows(rows);
  } catch (e: any) {
    console.error('[arena] gagal membaca soal komunitas:', e?.message || e);
  }
  return { official, community };
}

/** Pemuat ber-cache untuk dipasang sebagai `loadQuestionPools` Arena Global. */
export function createQuestionPoolLoader(db: Db, ttlMs = POOL_TTL_MS, now: () => number = Date.now) {
  let cached: { at: number; pools: ArenaQuestionPools } | null = null;
  let inflight: Promise<ArenaQuestionPools> | null = null;
  return async (): Promise<ArenaQuestionPools> => {
    if (cached && now() - cached.at < ttlMs) return cached.pools;
    if (!inflight) {
      inflight = loadQuestionPoolsFromDb(db)
        .then((pools) => {
          // Hasil kosong tidak di-cache, supaya soal yang baru disetujui/diaktifkan langsung terdeteksi.
          if (pools.official.length + pools.community.length > 0) cached = { at: now(), pools };
          return pools;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}
