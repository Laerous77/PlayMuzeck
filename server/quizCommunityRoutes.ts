// server/quizCommunityRoutes.ts
// Papan peringkat (harian / bulanan / sepanjang waktu) + Komunitas Kuis (berbagi kuis buatan Kuis Editor).
//
// PAPAN PERINGKAT hanya berisi skor dari ARENA GLOBAL (multiplayer publik tanpa kode ruangan, server/globalArena.ts).
// Skor dihitung & dicatat oleh SERVER saat permainan tuntas (recordMultiplayerGame), bukan dikirim klien.
// Ruangan multiplayer berkode (teman/kelas) dan mode lain TIDAK masuk peringkat.
//
// KOMUNITAS KUIS: kuis yang diunggah TIDAK langsung tayang. Alurnya (lihat server/quizModeration.ts):
//   unggah -> pemeriksaan aturan (instan) -> pemeriksaan AI (latar belakang, bila API key tersedia) -> keputusan:
//     ditolak otomatis  |  disetujui otomatis (aturan bersih + AI aman)  |  menunggu tinjauan admin.
//   Kuis berstatus "approved" saja yang muncul di daftar publik, bisa dimainkan, dan masuk rotasi Arena Global.
//   Mengubah isi kuis yang sudah disetujui = diperiksa ulang. Pemain bisa melaporkan kuis; 3 laporan = ditinjau ulang admin.
//
// Dipasang di server/index.ts:
//   import { createQuizCommunityRouter, ensureQuizCommunitySchema, startQuizCommunitySweeper, recordMultiplayerGame, pickApprovedCommunityDeck } from './quizCommunityRoutes';
//   .then(() => ensureQuizCommunitySchema(pool))
//   app.use(createQuizCommunityRouter({ db: pool, requireUser, requireAdmin, resolveEmail: softEmail }));
//   startQuizCommunitySweeper(pool);
//
// Aturan akses:
//   - MEMBACA papan peringkat & daftar/isi kuis komunitas yang disetujui -> siapa saja (/api/public/...).
//   - MEMBAGIKAN / memperbarui / menghapus kuis sendiri                   -> hanya akun yang sudah membuka Kuis Editor
//     (dicek di SERVER dari tabel user_collections, bukan cuma disembunyikan di UI).
//   - Mencatat skor ke papan peringkat                                    -> otomatis oleh server saat Arena Global selesai (akun login).
//   - Menyetujui / menolak kuis                                           -> admin (/api/admin/shared-quizzes/...).
import crypto from 'crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'pg';
import { builtinDeckTitle, isBuiltinDeckKnown, verifyBuiltinQuestions } from './builtinQuizVerify';
import {
  contentHash,
  decideModeration,
  moderationEnvFromProcess,
  ruleScan,
  scanQuiz,
  toScanInput,
  type ModerationEnv,
  type ModerationStatus,
  type ScanReport,
} from './quizModeration';
import { notifyUser } from './notifications';
import type { ArenaDeck } from './globalArena';
import { parsePresetDeckId } from '../src/data/quiz/arenaThemes';
import { ensureArenaPresetSchema } from './arenaPresetRoutes';

type Db = Pick<Pool, 'query'>;

/* ───────────────────────────── Skema ───────────────────────────── */

export const QUIZ_COMMUNITY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS quiz_leaderboard_scores (
  id BIGSERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  deck_key VARCHAR(120) NOT NULL,
  deck_title VARCHAR(160) NOT NULL DEFAULT '',
  correct INT NOT NULL,
  total INT NOT NULL,
  points INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE quiz_leaderboard_scores ADD COLUMN IF NOT EXISTS mode VARCHAR(20) NOT NULL DEFAULT 'solo';
CREATE INDEX IF NOT EXISTS quiz_lb_created_idx ON quiz_leaderboard_scores (created_at);
CREATE INDEX IF NOT EXISTS quiz_lb_user_deck_idx ON quiz_leaderboard_scores (user_email, deck_key);

CREATE TABLE IF NOT EXISTS shared_quizzes (
  id VARCHAR(40) PRIMARY KEY,
  owner_email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  source_deck_id VARCHAR(100) NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL DEFAULT '',
  difficulty VARCHAR(50) NOT NULL DEFAULT 'Sedang',
  question_count INT NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  play_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_email, source_deck_id)
);
CREATE INDEX IF NOT EXISTS shared_quizzes_created_idx ON shared_quizzes (created_at DESC);
CREATE INDEX IF NOT EXISTS shared_quizzes_plays_idx ON shared_quizzes (play_count DESC);

-- Moderasi. Kuis yang sudah ada sebelum fitur ini dianggap 'pending' sampai dipindai & ditinjau (default kolom).
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) NOT NULL DEFAULT 'pending';
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS moderation_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS moderation_source VARCHAR(20) NOT NULL DEFAULT '';
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS moderated_by VARCHAR(255);
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS scan_report JSONB;
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS scanned_at TIMESTAMPTZ;
ALTER TABLE shared_quizzes ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64) NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS shared_quizzes_mod_idx ON shared_quizzes (moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS shared_quizzes_hash_idx ON shared_quizzes (content_hash);

CREATE TABLE IF NOT EXISTS shared_quiz_reports (
  quiz_id VARCHAR(40) NOT NULL REFERENCES shared_quizzes(id) ON DELETE CASCADE,
  reporter_email VARCHAR(255) NOT NULL,
  reason VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (quiz_id, reporter_email)
);
`;
export const ensureQuizCommunitySchema = (db: Db) => db.query(QUIZ_COMMUNITY_SCHEMA_SQL);

/* ───────────────────────── Aturan & fungsi murni ───────────────────────── */

export type LeaderboardPeriod = 'daily' | 'monthly' | 'all';
export const PERIODS: LeaderboardPeriod[] = ['daily', 'monthly', 'all'];

/** Skor hanya dicatat untuk permainan minimal sekian soal. */
export const MIN_SCORED_QUESTIONS = 5;
export const MAX_SCORED_QUESTIONS = 200;
export const POINTS_PER_CORRECT = 10;
export const LEADERBOARD_SIZE = 50;

/** Skor multiplayer hanya dicatat bila minimal sekian AKUN berbeda (bukan tamu) ikut bermain. */
export const MIN_MULTIPLAYER_ACCOUNTS = 2;

export const MAX_SHARED_PER_USER = 30;
export const MAX_QUESTIONS_PER_SHARE = 100;
export const MAX_SHARE_BYTES = 6 * 1024 * 1024;

/** Jumlah pelapor berbeda yang mengembalikan kuis disetujui ke antrean admin. */
export const REPORT_THRESHOLD = 3;

/** Hari & bulan papan peringkat mengikuti waktu Indonesia Barat (WIB, UTC+7, tanpa DST). */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/** 10 poin per jawaban benar + bonus 20% bila semua soal benar. */
export function computePoints(correct: number, total: number): number {
  const base = correct * POINTS_PER_CORRECT;
  return correct === total ? base + Math.round(base * 0.2) : base;
}

/** Awal & akhir periode (UTC). 'all' tidak punya batas. */
export function periodRange(period: LeaderboardPeriod, now: Date = new Date()): { start: Date | null; end: Date | null } {
  if (period === 'all') return { start: null, end: null };
  const local = new Date(now.getTime() + WIB_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  if (period === 'daily') {
    return {
      start: new Date(Date.UTC(y, m, d) - WIB_OFFSET_MS),
      end: new Date(Date.UTC(y, m, d + 1) - WIB_OFFSET_MS),
    };
  }
  return {
    start: new Date(Date.UTC(y, m, 1) - WIB_OFFSET_MS),
    end: new Date(Date.UTC(y, m + 1, 1) - WIB_OFFSET_MS),
  };
}

const BUILTIN_DECK_RE = /^deck-(?:builtin|starter)-[a-z0-9-]{1,60}$/;
const SHARED_DECK_PREFIX = 'deck-custom-shared-';
const SHARED_ID_RE = /^shq_[0-9a-f]{12}$/;

/** Id deck di sisi klien (QuizPlayer) <-> id kuis komunitas di database. */
export const toClientDeckId = (sharedId: string) => `${SHARED_DECK_PREFIX}${sharedId}`;
export function parseSharedDeckId(deckId: string): string | null {
  if (!deckId.startsWith(SHARED_DECK_PREFIX)) return null;
  const id = deckId.slice(SHARED_DECK_PREFIX.length);
  return SHARED_ID_RE.test(id) ? id : null;
}
export const isBuiltinDeckKey = (deckId: string) => BUILTIN_DECK_RE.test(deckId);

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\u0000/g, '').trim().slice(0, max) : '');
const SAFE_MEDIA_URL = /^(?:https?:\/\/|data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,)/i;
const SAFE_HTTP_URL = /^https?:\/\//i;
const DIFFICULTIES = ['Mudah', 'Biasa', 'Sedang', 'Sulit', 'Ekstrem', 'Tidak dispesifikasikan'];

export interface SharedQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  category: string;
  timeLimitSec: number;
  mediaType?: 'image' | 'audio' | 'video';
  mediaUrl?: string;
  mediaCredit?: string;
  mediaSourceUrl?: string;
}

/** Bersihkan & validasi soal dari klien. Mengembalikan galat yang ramah pengguna bila ada yang tidak valid. */
export function sanitizeSharedQuestions(raw: unknown): { questions: SharedQuestion[]; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { questions: [], error: 'Kuis belum punya soal.' };
  if (raw.length > MAX_QUESTIONS_PER_SHARE) {
    return { questions: [], error: `Maksimal ${MAX_QUESTIONS_PER_SHARE} soal per kuis yang dibagikan.` };
  }
  const out: SharedQuestion[] = [];
  for (let i = 0; i < raw.length; i++) {
    const q: any = raw[i];
    const n = i + 1;
    const question = clean(q?.question, 600);
    if (!question) return { questions: [], error: `Soal #${n} belum punya teks pertanyaan.` };
    const optionsRaw = Array.isArray(q?.options) ? q.options : [];
    const options = optionsRaw.map((o: unknown) => clean(o, 300));
    if (options.length < 2 || options.length > 6 || options.some((o: string) => !o)) {
      return { questions: [], error: `Soal #${n} harus punya 2-6 pilihan jawaban yang terisi.` };
    }
    const correctIndex = Number(q?.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { questions: [], error: `Soal #${n} belum punya kunci jawaban yang valid.` };
    }
    const t = Number(q?.timeLimitSec);
    const item: SharedQuestion = {
      id: clean(q?.id, 60) || `q${n}`,
      question,
      options,
      correctIndex,
      explanation: clean(q?.explanation, 1200),
      category: clean(q?.category, 80),
      timeLimitSec: Number.isFinite(t) && t > 0 ? Math.min(180, Math.round(t)) : 0,
    };
    const mediaType = q?.mediaType;
    const mediaUrl = typeof q?.mediaUrl === 'string' ? q.mediaUrl.trim() : '';
    if ((mediaType === 'image' || mediaType === 'audio' || mediaType === 'video') && SAFE_MEDIA_URL.test(mediaUrl)) {
      item.mediaType = mediaType;
      item.mediaUrl = mediaUrl;
      const credit = clean(q?.mediaCredit, 200);
      if (credit) item.mediaCredit = credit;
      const src = typeof q?.mediaSourceUrl === 'string' ? q.mediaSourceUrl.trim().slice(0, 500) : '';
      if (SAFE_HTTP_URL.test(src)) item.mediaSourceUrl = src;
    }
    out.push(item);
  }
  return { questions: out, error: '' };
}

export function sanitizeSharedSettings(raw: any): { penaltyPercent: number; scoreUnit: 'point' | 'percent' } {
  const p = Number(raw?.penaltyPercent);
  return {
    penaltyPercent: Number.isFinite(p) ? Math.min(100, Math.max(0, Math.round(p))) : 0,
    scoreUnit: raw?.scoreUnit === 'percent' ? 'percent' : 'point',
  };
}

/* ───────────────────────── Skor Arena Global ───────────────────────── */

export interface FinishedMultiplayerGame {
  /** Id deck bawaan, "deck-custom-shared-shq_xxx" untuk kuis komunitas, atau "arena-preset-<tema>" untuk deck preset Arena. */
  deckId: string;
  /** Soal yang dimainkan (dipilih server; bawaan diverifikasi ulang terhadap data server). */
  questions: unknown[];
  /** Peserta yang masuk akun, dengan jumlah jawaban benar yang DIHITUNG SERVER. */
  players: { userId: string; correct: number }[];
}

export interface ScoreOutcome {
  counted: boolean;
  points?: number;
  reason?: 'too_short' | 'not_eligible' | 'few_players' | 'no_account' | 'own_quiz' | 'unavailable';
  message?: string;
}

/** Aturan murni (tanpa database): apakah permainan ini boleh masuk papan peringkat. Kuis komunitas masih dicek ke database. */
export function checkMultiplayerEligibility(g: {
  deckId: string;
  questions: unknown[];
  accountCount: number;
}): { ok: true } | { ok: false; reason: NonNullable<ScoreOutcome['reason']>; message: string } {
  const total = g.questions.length;
  if (total < MIN_SCORED_QUESTIONS || total > MAX_SCORED_QUESTIONS) {
    return { ok: false, reason: 'too_short', message: `Skor hanya dicatat untuk permainan minimal ${MIN_SCORED_QUESTIONS} soal.` };
  }
  const builtinKnown = isBuiltinDeckKnown(g.deckId);
  const sharedId = parseSharedDeckId(g.deckId);
  const presetTheme = parsePresetDeckId(g.deckId);
  if (presetTheme) {
    // Deck preset Arena (12 tema x 20 soal, diatur admin): soal dipilih server sendiri; keberadaannya dicek ke database di recordMultiplayerGame.
  } else if (builtinKnown) {
    if (!verifyBuiltinQuestions(g.deckId, g.questions)) {
      return { ok: false, reason: 'not_eligible', message: 'Soal permainan tidak cocok dengan deck bawaan, jadi skor tidak dihitung.' };
    }
  } else if (!sharedId) {
    return { ok: false, reason: 'not_eligible', message: 'Hanya deck bawaan, starter, deck preset Arena, dan kuis Komunitas yang sudah disetujui yang masuk papan peringkat.' };
  }
  if (g.accountCount < MIN_MULTIPLAYER_ACCOUNTS) {
    return { ok: false, reason: 'few_players', message: `Skor dicatat bila minimal ${MIN_MULTIPLAYER_ACCOUNTS} pemain yang masuk akun ikut bermain.` };
  }
  return { ok: true };
}

// Cache papan peringkat (10 detik) dipakai bersama: dikosongkan setiap ada skor baru / kuis dihapus.
const lbCache = new Map<string, { at: number; body: unknown }>();
const LB_TTL_MS = 10_000;
export const clearLeaderboardCache = () => lbCache.clear();

/**
 * Catat skor sebuah permainan Arena Global yang TUNTAS sampai soal terakhir.
 * Poin = 10 per jawaban benar (+20% bila semua benar), dihitung dari jawaban yang dinilai server.
 * Kuis komunitas: harus berstatus disetujui saat permainan selesai, dan skor pembuatnya sendiri tidak dihitung.
 * Mengembalikan hasil per akun supaya pemain bisa diberi tahu di layar akhir.
 */
export async function recordMultiplayerGame(db: Db, game: FinishedMultiplayerGame): Promise<Record<string, ScoreOutcome>> {
  const out: Record<string, ScoreOutcome> = {};
  // Satu akun yang bergabung dari dua browser dihitung sekali (skor tertinggi).
  const best = new Map<string, number>();
  for (const p of game.players) best.set(p.userId, Math.max(best.get(p.userId) ?? 0, p.correct));
  if (best.size === 0) return out;

  const rejectAll = (reason: NonNullable<ScoreOutcome['reason']>, message: string) => {
    for (const id of best.keys()) out[id] = { counted: false, reason, message };
    return out;
  };

  const verdict = checkMultiplayerEligibility({ deckId: game.deckId, questions: game.questions, accountCount: best.size });
  if (!verdict.ok) return rejectAll(verdict.reason, verdict.message);

  await ensureQuizCommunitySchema(db);
  const total = game.questions.length;

  let deckKey = game.deckId;
  let title = builtinDeckTitle(game.deckId);
  let ownerEmail = '';
  const sharedId = parseSharedDeckId(game.deckId);
  const presetTheme = parsePresetDeckId(game.deckId);
  if (presetTheme) {
    await ensureArenaPresetSchema(db);
    const { rows } = await db.query(`SELECT title, enabled FROM arena_preset_decks WHERE theme_id = $1`, [presetTheme]);
    if (!rows.length || rows[0].enabled !== true) {
      return rejectAll('unavailable', 'Deck Arena ini sudah tidak aktif, jadi skor tidak dihitung.');
    }
    deckKey = `arena-preset:${presetTheme}`;
    title = String(rows[0].title);
  } else if (sharedId) {
    const { rows } = await db.query(`SELECT title, owner_email, moderation_status FROM shared_quizzes WHERE id = $1`, [sharedId]);
    if (!rows.length || rows[0].moderation_status !== 'approved') {
      return rejectAll('unavailable', 'Kuis komunitas ini sudah tidak tersedia atau belum disetujui, jadi skor tidak dihitung.');
    }
    deckKey = `shared:${sharedId}`;
    title = String(rows[0].title);
    ownerEmail = String(rows[0].owner_email).toLowerCase();
  }

  const { rows } = await db.query(`SELECT id, email FROM users WHERE id = ANY($1::text[]) AND suspended_at IS NULL`, [Array.from(best.keys())]);
  const emailOf = new Map<string, string>(rows.map((r: any) => [String(r.id), String(r.email)]));

  // Pembuat kuis tidak mendapat poin dari kuisnya sendiri (dia tahu semua jawabannya).
  const scorable: [string, number][] = [];
  for (const [userId, rawCorrect] of best) {
    const email = emailOf.get(userId);
    if (!email) {
      out[userId] = { counted: false, reason: 'no_account', message: 'Akun tidak ditemukan.' };
    } else if (ownerEmail && email.toLowerCase() === ownerEmail) {
      out[userId] = { counted: false, reason: 'own_quiz', message: 'Kuis buatan sendiri tidak dihitung ke papan peringkat.' };
    } else {
      scorable.push([userId, rawCorrect]);
    }
  }
  if (scorable.length < MIN_MULTIPLAYER_ACCOUNTS) {
    for (const [userId] of scorable) {
      out[userId] = { counted: false, reason: 'few_players', message: `Skor dicatat bila minimal ${MIN_MULTIPLAYER_ACCOUNTS} pemain yang masuk akun ikut bermain.` };
    }
    return out;
  }

  for (const [userId, rawCorrect] of scorable) {
    const correct = Math.max(0, Math.min(total, Math.round(rawCorrect)));
    const points = computePoints(correct, total);
    await db.query(
      `INSERT INTO quiz_leaderboard_scores (user_email, deck_key, deck_title, correct, total, points, mode)
       VALUES ($1,$2,$3,$4,$5,$6,'multiplayer')`,
      [emailOf.get(userId), deckKey, title.slice(0, 160), correct, total, points]
    );
    out[userId] = { counted: true, points };
  }
  clearLeaderboardCache();
  return out;
}

/** Kuis komunitas yang disetujui, dipilih acak untuk rotasi Arena Global. null bila belum ada. */
export async function pickApprovedCommunityDeck(db: Db): Promise<ArenaDeck | null> {
  const { rows } = await db.query(
    `SELECT q.id, q.title, q.questions, u.name AS owner_name
       FROM shared_quizzes q
       JOIN users u ON lower(u.email) = lower(q.owner_email) AND u.suspended_at IS NULL
      WHERE q.moderation_status = 'approved' AND q.question_count >= $1
      ORDER BY random() LIMIT 1`,
    [MIN_SCORED_QUESTIONS]
  );
  if (!rows.length) return null;
  const r = rows[0];
  const questions = Array.isArray(r.questions) ? r.questions : [];
  if (questions.length < MIN_SCORED_QUESTIONS) return null;
  return { deckId: toClientDeckId(String(r.id)), title: String(r.title), source: 'community', ownerName: String(r.owner_name || 'Pengguna'), questions };
}

/* ───────────────────────────── Moderasi (database) ───────────────────────────── */

const inFlight = new Set<string>();

const STATUS_LABEL: Record<ModerationStatus, string> = { pending: 'menunggu tinjauan', approved: 'disetujui', rejected: 'ditolak' };

async function notifyOwner(pool: Pool, ownerEmail: string, title: string, status: ModerationStatus, reason: string) {
  if (status === 'pending') return;
  await notifyUser(
    pool,
    ownerEmail,
    status === 'approved' ? 'quiz_approved' : 'quiz_rejected',
    status === 'approved' ? `Kuis "${title}" disetujui` : `Kuis "${title}" ditolak`,
    status === 'approved'
      ? 'Kuismu sudah tampil di Komunitas Kuis dan masuk rotasi Arena Global.'
      : `${reason || 'Kuis tidak memenuhi pedoman komunitas.'} Kamu bisa memperbaikinya lalu membagikannya lagi.`
  );
}

/**
 * Pindai kuis berstatus 'pending' (aturan + AI) lalu terapkan keputusan otomatis. Aman dipanggil berulang:
 * hasil hanya ditulis bila isi kuis belum berubah sejak dibaca (mencegah hasil lama menimpa suntingan pemilik).
 */
export async function moderateSharedQuiz(pool: Pool, id: string, env: ModerationEnv = moderationEnvFromProcess()): Promise<ModerationStatus | null> {
  if (inFlight.has(id)) return null;
  inFlight.add(id);
  try {
    const { rows } = await pool.query(
      `SELECT id, owner_email, title, description, questions, content_hash, moderation_status FROM shared_quizzes WHERE id = $1`,
      [id]
    );
    if (!rows.length || rows[0].moderation_status !== 'pending') return null;
    const r = rows[0];
    const { input, correctIndexes } = toScanInput(r.title, r.description, r.questions);
    const hash = contentHash({ ...input, correctIndexes });
    const report: ScanReport = await scanQuiz(input, correctIndexes, env);
    const decision = decideModeration(report, { autoApprove: env.autoApprove ?? 'ai' });
    const res = await pool.query(
      `UPDATE shared_quizzes
          SET moderation_status = $3, moderation_reason = $4, moderation_source = $5, scan_report = $6::jsonb,
              scanned_at = now(), content_hash = $7, moderated_by = NULL,
              moderated_at = CASE WHEN $3 = 'pending' THEN NULL ELSE now() END
        WHERE id = $1 AND content_hash = $2 AND moderation_status = 'pending'`,
      [id, r.content_hash, decision.status, decision.reason, decision.source, JSON.stringify(report), hash]
    );
    if (res.rowCount) await notifyOwner(pool, String(r.owner_email), String(r.title), decision.status, decision.reason);
    return res.rowCount ? decision.status : null;
  } finally {
    inFlight.delete(id);
  }
}

/* ───────────────────────────── Router ───────────────────────────── */

interface Options {
  db: Pool;
  requireUser: RequestHandler;
  requireAdmin: RequestHandler;
  /** Email akun yang sedang login atau null untuk tamu. Tidak boleh melempar 401. */
  resolveEmail: (req: Request) => Promise<string | null>;
  /** Dapat diganti saat tes. */
  moderationEnv?: () => ModerationEnv;
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Pemilik Kuis Editor: aturan yang SAMA dengan POST /api/user/decks. */
async function hasQuizCreator(db: Db, email: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM public.user_collections
      WHERE user_email = $1 AND (item_type_key = 'quizCreatorSuite' OR item_id IN ('quiz-creator-suite','quiz_editor_10k')) LIMIT 1`,
    [email]
  );
  return rows.length > 0;
}

export function createQuizCommunityRouter({ db, requireUser, requireAdmin, resolveEmail, moderationEnv = moderationEnvFromProcess }: Options): Router {
  const router = Router();

  // Tabel dibuat saat boot; bila gagal (DB belum siap) dicoba lagi pada permintaan berikutnya.
  let schemaReady: Promise<unknown> | null = null;
  const ready = () => {
    if (!schemaReady) schemaReady = ensureQuizCommunitySchema(db).catch((e) => { schemaReady = null; throw e; });
    return schemaReady;
  };

  const wrap = (label: string, fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res) => {
      ready()
        .then(() => fn(req, res))
        .catch((err) => {
          console.error(`[quiz-community] ${label}:`, err);
          if (!res.headersSent) res.status(500).json({ error: 'Terjadi kesalahan di server. Coba lagi sebentar.' });
        });
    };

  const emailOf = (req: Request) => String((req as any).userEmail || '').trim();
  const adminOf = (req: Request) => String((req as any).adminEmail || 'admin').toLowerCase();
  const limiter = (windowMs: number, limit: number) =>
    rateLimit({ windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: 'Terlalu sering. Coba lagi beberapa saat lagi.' } });

  const shareLimiter = limiter(60 * 60_000, 20);
  const reportLimiter = limiter(60 * 60_000, 15);
  const listLimiter = limiter(60_000, 120);

  const runModeration = (id: string) => {
    moderateSharedQuiz(db, id, moderationEnv()).catch((e) => console.error('[quiz-community] moderasi gagal:', e?.message || e));
  };

  /* ───────────── Papan peringkat ───────────── */

  // Hanya skor dari Arena Global. Peringkat = jumlah skor TERBAIK tiap kuis dalam periode (bukan jumlah semua permainan),
  // jadi mengulang kuis yang sama tidak bisa dipakai untuk menggembungkan poin.
  router.get('/api/public/quiz-leaderboard', listLimiter, wrap('leaderboard', async (req, res) => {
    const period = String(req.query.period || 'daily') as LeaderboardPeriod;
    if (!PERIODS.includes(period)) return res.status(400).json({ error: 'Periode tidak dikenal.' });

    const me = ((await resolveEmail(req).catch(() => null)) || '').trim().toLowerCase();
    const cacheKey = `${period}|${me}`;
    const hit = lbCache.get(cacheKey);
    res.set('Cache-Control', 'no-store');
    if (hit && Date.now() - hit.at < LB_TTL_MS) return res.json(hit.body);

    const { start, end } = periodRange(period);
    const { rows } = await db.query(
      `WITH best AS (
         SELECT s.user_email, s.deck_key,
                MAX(s.points) AS points,
                (ARRAY_AGG(s.correct ORDER BY s.points DESC, s.id DESC))[1] AS correct,
                MAX(s.created_at) AS played_at
           FROM quiz_leaderboard_scores s
          WHERE s.mode = 'multiplayer'
            AND ($1::timestamptz IS NULL OR s.created_at >= $1::timestamptz)
          GROUP BY s.user_email, s.deck_key
       ), agg AS (
         SELECT b.user_email,
                SUM(b.points)::int AS points,
                SUM(b.correct)::int AS correct,
                COUNT(*)::int AS decks,
                MAX(b.played_at) AS last_played
           FROM best b
           JOIN users u ON lower(u.email) = lower(b.user_email) AND u.suspended_at IS NULL
          GROUP BY b.user_email
       ), ranked AS (
         SELECT a.*,
                RANK() OVER (ORDER BY a.points DESC, a.correct DESC, a.last_played ASC) AS rnk,
                COUNT(*) OVER () AS total_players
           FROM agg a
       )
       SELECT r.rnk::int AS rank, r.points, r.correct, r.decks, r.total_players::int AS total_players,
              u.id AS user_id, u.name,
              (u.avatar_url IS NOT NULL AND u.avatar_url <> '') AS has_avatar,
              COALESCE(u.active_frame_id, 'none') AS frame_id,
              (lower(r.user_email) = $2::text) AS is_me
         FROM ranked r
         JOIN users u ON lower(u.email) = lower(r.user_email)
        WHERE r.rnk <= $3 OR lower(r.user_email) = $2::text
        ORDER BY r.rnk ASC, r.points DESC`,
      [start, me, LEADERBOARD_SIZE]
    );

    const toEntry = (r: any) => ({
      rank: r.rank,
      userId: r.user_id,
      name: r.name || 'Pemain',
      avatarUrl: r.has_avatar ? `/api/avatar/${encodeURIComponent(r.user_id)}` : null,
      frameId: r.frame_id,
      points: r.points,
      correct: r.correct,
      decks: r.decks,
      isMe: Boolean(r.is_me),
    });
    const all = rows.map(toEntry);
    const body = {
      period,
      since: start ? start.toISOString() : null,
      resetsAt: end ? end.toISOString() : null,
      totalPlayers: rows[0]?.total_players ?? 0,
      entries: all.filter((e) => e.rank <= LEADERBOARD_SIZE),
      me: all.find((e) => e.isMe) || null,
    };
    if (lbCache.size > 500) clearLeaderboardCache();
    lbCache.set(cacheKey, { at: Date.now(), body });
    res.json(body);
  }));

  /* ───────────── Komunitas kuis: baca (publik, HANYA yang disetujui) ───────────── */

  const ownerJoin = `JOIN users u ON lower(u.email) = lower(q.owner_email) AND u.suspended_at IS NULL`;
  const summaryOf = (r: any) => ({
    id: r.id,
    deckId: toClientDeckId(r.id),
    title: r.title,
    description: r.description,
    difficulty: r.difficulty,
    questionCount: r.question_count,
    playCount: r.play_count,
    ownerName: r.owner_name || 'Pengguna',
    ownerAvatarUrl: r.owner_has_avatar ? `/api/avatar/${encodeURIComponent(r.owner_id)}` : null,
    ownerFrameId: r.owner_frame_id || 'none',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });
  const SUMMARY_COLS = `q.id, q.title, q.description, q.difficulty, q.question_count, q.play_count, q.created_at, q.updated_at,
         u.id AS owner_id, u.name AS owner_name, COALESCE(u.active_frame_id,'none') AS owner_frame_id,
         (u.avatar_url IS NOT NULL AND u.avatar_url <> '') AS owner_has_avatar`;

  router.get('/api/public/shared-quizzes', listLimiter, wrap('list-shared', async (req, res) => {
    const search = clean(req.query.q, 80);
    const sort = req.query.sort === 'popular' ? 'popular' : 'newest';
    const limit = Math.min(30, Math.max(1, parseInt(String(req.query.limit ?? '12'), 10) || 12));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
    const pattern = search ? `%${likeEscape(search)}%` : null;
    const order = sort === 'popular' ? 'q.play_count DESC, q.created_at DESC' : 'q.created_at DESC';

    const where = `WHERE q.moderation_status = 'approved'
      AND ($1::text IS NULL OR q.title ILIKE $1::text ESCAPE '\\' OR q.description ILIKE $1::text ESCAPE '\\' OR u.name ILIKE $1::text ESCAPE '\\')`;
    const [list, count] = await Promise.all([
      db.query(`SELECT ${SUMMARY_COLS} FROM shared_quizzes q ${ownerJoin} ${where} ORDER BY ${order} LIMIT $2 OFFSET $3`, [pattern, limit, offset]),
      db.query(`SELECT COUNT(*)::int AS n FROM shared_quizzes q ${ownerJoin} ${where}`, [pattern]),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({ items: list.rows.map(summaryOf), total: count.rows[0]?.n ?? 0 });
  }));

  router.get('/api/public/shared-quizzes/:id', listLimiter, wrap('get-shared', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const { rows } = await db.query(
      `SELECT ${SUMMARY_COLS}, q.questions, q.settings FROM shared_quizzes q ${ownerJoin} WHERE q.id = $1 AND q.moderation_status = 'approved'`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const r = rows[0];
    res.set('Cache-Control', 'no-store');
    res.json({
      ...summaryOf(r),
      questions: Array.isArray(r.questions) ? r.questions : [],
      settings: r.settings || {},
    });
  }));

  // Hitung jumlah pemain. Satu IP hanya dihitung sekali per kuis dalam 30 menit.
  const seenPlays = new Map<string, number>();
  router.post('/api/public/shared-quizzes/:id/play', limiter(60_000, 60), wrap('count-play', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const key = `${req.ip}|${id}`;
    const now = Date.now();
    if (seenPlays.size > 5000) for (const [k, t] of seenPlays) if (now - t > 30 * 60_000) seenPlays.delete(k);
    if (!seenPlays.has(key) || now - (seenPlays.get(key) || 0) > 30 * 60_000) {
      seenPlays.set(key, now);
      await db.query(`UPDATE shared_quizzes SET play_count = play_count + 1 WHERE id = $1 AND moderation_status = 'approved'`, [id]);
    }
    res.status(204).end();
  }));

  /* ───────────── Komunitas kuis: bagikan (khusus pemilik Kuis Editor) ───────────── */

  router.get('/api/user/shared-quizzes/mine', requireUser, wrap('mine', async (req, res) => {
    const email = emailOf(req);
    const [canShare, mine] = await Promise.all([
      hasQuizCreator(db, email),
      db.query(
        `SELECT id, source_deck_id, title, question_count, play_count, updated_at, moderation_status, moderation_reason, moderated_at
           FROM shared_quizzes WHERE lower(owner_email) = lower($1) ORDER BY updated_at DESC`,
        [email]
      ),
    ]);
    res.set('Cache-Control', 'no-store');
    res.json({
      canShare,
      limit: MAX_SHARED_PER_USER,
      items: mine.rows.map((r) => ({
        id: r.id,
        deckId: toClientDeckId(r.id),
        sourceDeckId: r.source_deck_id,
        title: r.title,
        questionCount: r.question_count,
        playCount: r.play_count,
        updatedAt: r.updated_at,
        moderationStatus: r.moderation_status as ModerationStatus,
        moderationReason: r.moderation_reason || '',
        moderatedAt: r.moderated_at,
      })),
    });
  }));

  router.post('/api/user/shared-quizzes', requireUser, shareLimiter, wrap('share', async (req, res) => {
    const email = emailOf(req);
    if (!(await hasQuizCreator(db, email))) {
      return res.status(403).json({ error: 'Membagikan kuis hanya untuk akun yang sudah membuka fitur Kuis Editor.' });
    }

    const deck = req.body?.deck;
    if (!deck || typeof deck !== 'object') return res.status(400).json({ error: 'Data kuis tidak lengkap.' });
    const sourceDeckId = clean(deck.id, 100);
    if (!/^deck-custom-[\w-]{1,80}$/.test(sourceDeckId) || sourceDeckId.startsWith(SHARED_DECK_PREFIX)) {
      return res.status(400).json({ error: 'Hanya kuis buatan Kuis Editor milikmu yang bisa dibagikan.' });
    }
    const title = clean(deck.title, 120);
    if (!title) return res.status(400).json({ error: 'Judul kuis wajib diisi.' });

    const qs = sanitizeSharedQuestions(deck.questions);
    if (qs.error) return res.status(400).json({ error: qs.error });
    const questionsJson = JSON.stringify(qs.questions);
    if (Buffer.byteLength(questionsJson) > MAX_SHARE_BYTES) {
      return res.status(413).json({ error: 'Kuis terlalu besar untuk dibagikan (lampiran media terlalu berat). Kurangi media pada soal.' });
    }

    const difficulty = DIFFICULTIES.includes(deck.difficulty) ? deck.difficulty : 'Sedang';
    const description = clean(deck.description, 500);
    const settings = JSON.stringify(sanitizeSharedSettings(deck.settings));

    const existing = await db.query(
      `SELECT id, content_hash, moderation_status, moderation_reason FROM shared_quizzes WHERE lower(owner_email) = lower($1) AND source_deck_id = $2`,
      [email, sourceDeckId]
    );
    if (!existing.rows.length) {
      const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM shared_quizzes WHERE lower(owner_email) = lower($1)`, [email]);
      if ((cnt.rows[0]?.n ?? 0) >= MAX_SHARED_PER_USER) {
        return res.status(409).json({ error: `Kamu sudah membagikan ${MAX_SHARED_PER_USER} kuis (batas maksimum). Hapus salah satu dulu.` });
      }
    }

    const { input, correctIndexes } = toScanInput(title, description, qs.questions);
    const hash = contentHash({ ...input, correctIndexes });

    // Isi yang sama persis dengan kuis milik akun lain = salinan; tolak supaya komunitas tidak dibanjiri duplikat.
    const dup = await db.query(
      `SELECT 1 FROM shared_quizzes WHERE content_hash = $1 AND lower(owner_email) <> lower($2) AND moderation_status <> 'rejected' LIMIT 1`,
      [hash, email]
    );
    if (dup.rows.length) {
      return res.status(409).json({ error: 'Isi kuis ini sama persis dengan kuis lain di Komunitas. Ubah atau buat kuis yang orisinal.' });
    }

    // Isi tidak berubah: hanya perbarui kesulitan/pengaturan; status moderasi dipertahankan.
    const prev = existing.rows[0];
    if (prev && prev.content_hash === hash) {
      await db.query(`UPDATE shared_quizzes SET difficulty = $2, settings = $3::jsonb, updated_at = now() WHERE id = $1`, [prev.id, difficulty, settings]);
      return res.status(200).json({
        id: prev.id,
        deckId: toClientDeckId(prev.id),
        updated: true,
        questionCount: qs.questions.length,
        moderationStatus: prev.moderation_status as ModerationStatus,
        moderationReason: prev.moderation_reason || '',
      });
    }

    // Isi baru / berubah: periksa aturan SEKARANG (instan). Pelanggaran berat langsung ditolak tanpa memboroskan AI.
    const quick = ruleScan(input);
    const rejected = quick.verdict === 'block' ? decideModeration(quick) : null;
    const status: ModerationStatus = rejected ? 'rejected' : 'pending';
    const reason = rejected ? rejected.reason : 'Sedang diperiksa. Biasanya selesai dalam beberapa menit.';

    const newId = `shq_${crypto.randomBytes(6).toString('hex')}`;
    const { rows } = await db.query(
      `INSERT INTO shared_quizzes
         (id, owner_email, source_deck_id, title, description, difficulty, question_count, questions, settings,
          moderation_status, moderation_reason, moderation_source, scan_report, scanned_at, content_hash, moderated_at, moderated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15,$16,NULL)
       ON CONFLICT (owner_email, source_deck_id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, difficulty = EXCLUDED.difficulty,
         question_count = EXCLUDED.question_count, questions = EXCLUDED.questions, settings = EXCLUDED.settings,
         moderation_status = EXCLUDED.moderation_status, moderation_reason = EXCLUDED.moderation_reason,
         moderation_source = EXCLUDED.moderation_source, scan_report = EXCLUDED.scan_report, scanned_at = EXCLUDED.scanned_at,
         content_hash = EXCLUDED.content_hash, moderated_at = EXCLUDED.moderated_at, moderated_by = NULL,
         updated_at = now()
       RETURNING id, (xmax = 0) AS inserted`,
      [
        newId, email, sourceDeckId, title, description, difficulty, qs.questions.length, questionsJson, settings,
        status, reason, rejected ? 'auto-rules' : '', rejected ? JSON.stringify(quick) : null,
        rejected ? new Date() : null, hash, rejected ? new Date() : null,
      ]
    );
    const id = String(rows[0].id);
    // Suntingan membuat laporan lama tidak relevan lagi.
    if (!rows[0].inserted) await db.query(`DELETE FROM shared_quiz_reports WHERE quiz_id = $1`, [id]);
    if (rejected) await db.query(`DELETE FROM quiz_leaderboard_scores WHERE deck_key = $1`, [`shared:${id}`]).catch(() => undefined);
    else runModeration(id);
    clearLeaderboardCache();

    res.status(rows[0].inserted ? 201 : 200).json({
      id,
      deckId: toClientDeckId(id),
      updated: !rows[0].inserted,
      questionCount: qs.questions.length,
      moderationStatus: status,
      moderationReason: reason,
    });
  }));

  router.delete('/api/user/shared-quizzes/:id', requireUser, wrap('unshare', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const { rowCount } = await db.query(`DELETE FROM shared_quizzes WHERE id = $1 AND lower(owner_email) = lower($2)`, [id, emailOf(req)]);
    if (!rowCount) return res.status(404).json({ error: 'Kuis tidak ditemukan atau bukan milikmu.' });
    // Skor dari kuis yang sudah tidak ada ikut dibuang (sama seperti moderasi admin), supaya papan peringkat
    // tidak memuat poin dari kuis yang tak bisa dimainkan lagi.
    await db.query(`DELETE FROM quiz_leaderboard_scores WHERE deck_key = $1`, [`shared:${id}`]);
    clearLeaderboardCache();
    res.json({ success: true });
  }));

  // Pemain melaporkan kuis komunitas. REPORT_THRESHOLD pelapor berbeda mengembalikannya ke antrean tinjauan admin.
  router.post('/api/user/shared-quizzes/:id/report', requireUser, reportLimiter, wrap('report', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const email = emailOf(req).toLowerCase();
    const found = await db.query(`SELECT owner_email, moderation_status FROM shared_quizzes WHERE id = $1`, [id]);
    if (!found.rows.length) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    if (String(found.rows[0].owner_email).toLowerCase() === email) return res.status(400).json({ error: 'Kamu tidak bisa melaporkan kuismu sendiri.' });
    const reason = clean(req.body?.reason, 300);
    await db.query(
      `INSERT INTO shared_quiz_reports (quiz_id, reporter_email, reason) VALUES ($1,$2,$3) ON CONFLICT (quiz_id, reporter_email) DO NOTHING`,
      [id, email, reason]
    );
    const cnt = await db.query(`SELECT COUNT(*)::int AS n FROM shared_quiz_reports WHERE quiz_id = $1`, [id]);
    let escalated = false;
    if ((cnt.rows[0]?.n ?? 0) >= REPORT_THRESHOLD && found.rows[0].moderation_status === 'approved') {
      const r = await db.query(
        `UPDATE shared_quizzes
            SET moderation_status = 'pending', moderation_source = 'reports', moderated_at = NULL, moderated_by = NULL, scanned_at = now(),
                moderation_reason = 'Dilaporkan oleh beberapa pemain. Disembunyikan sampai admin meninjau ulang.'
          WHERE id = $1 AND moderation_status = 'approved'`,
        [id]
      );
      escalated = Boolean(r.rowCount);
      if (escalated) clearLeaderboardCache();
    }
    res.json({ success: true, escalated });
  }));

  /* ───────────── Moderasi admin ───────────── */

  const adminItemOf = (r: any) => {
    const report: ScanReport | null = r.scan_report || null;
    return {
      id: r.id,
      deckId: toClientDeckId(r.id),
      title: r.title,
      description: r.description,
      difficulty: r.difficulty,
      questionCount: r.question_count,
      playCount: r.play_count,
      ownerEmail: r.owner_email,
      ownerName: r.owner_name || '',
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      moderationStatus: r.moderation_status as ModerationStatus,
      moderationReason: r.moderation_reason || '',
      moderationSource: r.moderation_source || '',
      moderatedBy: r.moderated_by || null,
      moderatedAt: r.moderated_at,
      scanned: Boolean(r.scanned_at),
      reportCount: r.report_count ?? 0,
      scan: report
        ? {
            verdict: report.verdict,
            risk: report.risk,
            flagCount: report.flags.length,
            highFlags: report.flags.filter((f) => f.severity === 'high').length,
            unverifiedMedia: report.unverifiedMedia,
            ai: report.ai.map((a) => ({ provider: a.provider, ran: a.ran, verdict: a.verdict ?? null, summary: a.summary ?? '', error: a.error ?? '' })),
          }
        : null,
    };
  };

  // Daftar antrean + hitungan per status. Urutan: yang menunggu paling lama dulu (adil bagi pengunggah).
  router.get('/api/admin/shared-quizzes', requireAdmin, wrap('admin-list', async (req, res) => {
    const status = ['pending', 'approved', 'rejected'].includes(String(req.query.status)) ? String(req.query.status) : 'pending';
    const search = clean(req.query.q, 80);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const offset = Math.max(0, parseInt(String(req.query.offset ?? '0'), 10) || 0);
    const pattern = search ? `%${likeEscape(search)}%` : null;
    const order = status === 'pending' ? 'q.updated_at ASC' : 'q.updated_at DESC';
    const where = `WHERE q.moderation_status = $1
      AND ($2::text IS NULL OR q.title ILIKE $2::text ESCAPE '\\' OR q.owner_email ILIKE $2::text ESCAPE '\\' OR q.description ILIKE $2::text ESCAPE '\\')`;
    const [list, count, totals] = await Promise.all([
      db.query(
        `SELECT q.id, q.title, q.description, q.difficulty, q.question_count, q.play_count, q.owner_email, q.created_at, q.updated_at,
                q.moderation_status, q.moderation_reason, q.moderation_source, q.moderated_by, q.moderated_at, q.scan_report, q.scanned_at,
                u.name AS owner_name,
                (SELECT COUNT(*)::int FROM shared_quiz_reports r WHERE r.quiz_id = q.id) AS report_count
           FROM shared_quizzes q LEFT JOIN users u ON lower(u.email) = lower(q.owner_email)
           ${where} ORDER BY ${order} LIMIT $3 OFFSET $4`,
        [status, pattern, limit, offset]
      ),
      db.query(`SELECT COUNT(*)::int AS n FROM shared_quizzes q ${where}`, [status, pattern]),
      db.query(`SELECT moderation_status AS s, COUNT(*)::int AS n FROM shared_quizzes GROUP BY moderation_status`),
    ]);
    const counts: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
    for (const r of totals.rows) counts[String(r.s)] = r.n;
    res.set('Cache-Control', 'no-store');
    res.json({
      items: list.rows.map(adminItemOf),
      total: count.rows[0]?.n ?? 0,
      counts,
      ai: { anthropic: Boolean(moderationEnv().anthropicKey), openai: Boolean(moderationEnv().openaiKey), autoApprove: moderationEnv().autoApprove ?? 'ai' },
    });
  }));

  // Isi lengkap (termasuk kunci jawaban) + laporan pemindaian lengkap untuk ditinjau.
  router.get('/api/admin/shared-quizzes/:id', requireAdmin, wrap('admin-get', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const { rows } = await db.query(
      `SELECT q.*, u.name AS owner_name,
              (SELECT COUNT(*)::int FROM shared_quiz_reports r WHERE r.quiz_id = q.id) AS report_count
         FROM shared_quizzes q LEFT JOIN users u ON lower(u.email) = lower(q.owner_email) WHERE q.id = $1`,
      [id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const reports = await db.query(`SELECT reason, created_at FROM shared_quiz_reports WHERE quiz_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]);
    res.set('Cache-Control', 'no-store');
    res.json({
      ...adminItemOf(rows[0]),
      questions: Array.isArray(rows[0].questions) ? rows[0].questions : [],
      scanReport: rows[0].scan_report || null,
      reports: reports.rows.map((r) => ({ reason: r.reason, createdAt: r.created_at })),
    });
  }));

  // Putusan admin: setuju / tolak. Berlaku untuk status apa pun (admin boleh membatalkan penolakan otomatis atau mencabut persetujuan).
  router.post('/api/admin/shared-quizzes/:id/review', requireAdmin, wrap('admin-review', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const decision = req.body?.decision;
    if (decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: 'Keputusan harus "approve" atau "reject".' });
    const note = clean(req.body?.reason, 400);
    if (decision === 'reject' && !note) return res.status(400).json({ error: 'Tulis alasan penolakan agar pemilik tahu apa yang perlu diperbaiki.' });

    const status: ModerationStatus = decision === 'approve' ? 'approved' : 'rejected';
    const reason = decision === 'approve' ? note || 'Disetujui admin.' : note;
    const { rows } = await db.query(
      `UPDATE shared_quizzes
          SET moderation_status = $2, moderation_reason = $3, moderation_source = 'admin', moderated_by = $4, moderated_at = now(),
              scanned_at = COALESCE(scanned_at, now())
        WHERE id = $1 RETURNING owner_email, title`,
      [id, status, reason, adminOf(req)]
    );
    if (!rows.length) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    // Putusan baru menghapus laporan lama; kuis yang ditolak ikut membuang skor peringkat yang berasal darinya.
    await db.query(`DELETE FROM shared_quiz_reports WHERE quiz_id = $1`, [id]);
    if (status === 'rejected') await db.query(`DELETE FROM quiz_leaderboard_scores WHERE deck_key = $1`, [`shared:${id}`]);
    clearLeaderboardCache();
    await notifyOwner(db as Pool, String(rows[0].owner_email), String(rows[0].title), status, reason);
    res.json({ success: true, status, label: STATUS_LABEL[status] });
  }));

  // Jalankan ulang pemeriksaan otomatis untuk kuis yang masih menunggu (mis. setelah API key AI dipasang).
  router.post('/api/admin/shared-quizzes/:id/rescan', requireAdmin, wrap('admin-rescan', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const found = await db.query(`SELECT moderation_status FROM shared_quizzes WHERE id = $1`, [id]);
    if (!found.rows.length) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    if (found.rows[0].moderation_status !== 'pending') return res.status(409).json({ error: 'Hanya kuis yang menunggu tinjauan yang bisa dipindai ulang.' });
    const result = await moderateSharedQuiz(db, id, moderationEnv());
    res.json({ success: true, status: result ?? 'pending' });
  }));

  // Menghapus kuis komunitas yang melanggar sekaligus menghapus skor papan peringkat yang berasal darinya.
  router.delete('/api/admin/shared-quizzes/:id', requireAdmin, wrap('admin-delete', async (req, res) => {
    const id = String(req.params.id || '');
    if (!SHARED_ID_RE.test(id)) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    const { rowCount } = await db.query(`DELETE FROM shared_quizzes WHERE id = $1`, [id]);
    if (!rowCount) return res.status(404).json({ error: 'Kuis tidak ditemukan.' });
    await db.query(`DELETE FROM quiz_leaderboard_scores WHERE deck_key = $1`, [`shared:${id}`]);
    clearLeaderboardCache();
    res.json({ success: true });
  }));

  return router;
}

/**
 * Buang baris skor lama yang sudah pasti tidak berpengaruh: lebih tua dari awal bulan ini (WIB) DAN
 * sudah dikalahkan oleh skor lain pada kuis yang sama (skor terbaik untuk "Sepanjang Waktu" selalu dipertahankan).
 */
export async function pruneQuizScores(db: Db, now: Date = new Date()): Promise<void> {
  const { start } = periodRange('monthly', now);
  await db.query(
    `DELETE FROM quiz_leaderboard_scores s
      WHERE s.created_at < $1
        AND EXISTS (
          SELECT 1 FROM quiz_leaderboard_scores b
           WHERE b.user_email = s.user_email AND b.deck_key = s.deck_key
             AND (b.points > s.points OR (b.points = s.points AND b.id > s.id))
        )`,
    [start]
  );
}

/** Pindai kuis 'pending' yang belum pernah dipindai (kuis lama sebelum fitur moderasi, atau pemindaian yang terputus saat server restart). */
export async function scanPendingQuizzes(pool: Pool, limit = 5, env: ModerationEnv = moderationEnvFromProcess()): Promise<number> {
  const { rows } = await pool.query(
    `SELECT id FROM shared_quizzes WHERE moderation_status = 'pending' AND scanned_at IS NULL ORDER BY updated_at ASC LIMIT $1`,
    [limit]
  );
  for (const r of rows) await moderateSharedQuiz(pool, String(r.id), env).catch((e) => console.error('[quiz-community] pindai ulang:', e?.message || e));
  return rows.length;
}

export function startQuizCommunitySweeper(db: Pool): void {
  const prune = () => pruneQuizScores(db).catch((e) => console.error('[quiz-community] sweeper:', e?.message || e));
  setTimeout(prune, 60_000).unref();
  setInterval(prune, 6 * 60 * 60_000).unref();
  // Antrean pemindaian: tiap menit ambil beberapa kuis yang belum dipindai.
  const scan = () => scanPendingQuizzes(db).catch((e) => console.error('[quiz-community] antrean moderasi:', e?.message || e));
  setTimeout(scan, 20_000).unref();
  setInterval(scan, 60_000).unref();
}
