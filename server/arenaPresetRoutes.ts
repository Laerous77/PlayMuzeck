// server/arenaPresetRoutes.ts
//
// DECK PRESET ARENA GLOBAL: 12 tema (alam ... teknologi) x ARENA_DECK_SIZE (20) soal, diatur HANYA oleh admin.
//
// - Disimpan di tabel sendiri `arena_preset_decks` (bukan shared_quizzes, bukan BUILTIN_DECKS), sehingga tidak pernah
//   muncul di Perpustakaan / Komunitas Kuis dan tidak bisa dimainkan di luar Arena Global.
// - Semua rute di sini memakai requireAdmin. Tidak ada rute publik; soal hanya keluar lewat server/globalArena.ts
//   (kunci jawaban tidak dikirim ke klien oleh arena).
// - Sebuah deck hanya ikut rotasi arena bila `enabled` = true DAN berisi tepat 20 soal valid. Draf (kurang dari 20 soal)
//   boleh disimpan, tetapi tidak bisa diaktifkan.
// - pickArenaDeck() menggabungkan kuis Komunitas yang disetujui + deck preset aktif: undian seragam atas seluruh kandidat.
//
// Dipasang di server/index.ts:
//   import { createArenaPresetRouter, ensureArenaPresetSchema, pickArenaDeck } from './arenaPresetRoutes';
//   .then(() => ensureArenaPresetSchema(pool))
//   app.use(createArenaPresetRouter({ db: pool, requireAdmin }));
//   pickCommunityDeck: () => pickArenaDeck(pool, () => pickApprovedCommunityDeck(pool))
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { randomInt } from 'crypto';
import type { ArenaDeck, ArenaQuestion } from './globalArena';
import { ARENA_DECK_SIZE, ARENA_THEMES, getArenaTheme, isArenaThemeId, presetDeckId } from '../src/data/quiz/arenaThemes';

type Db = Pick<Pool, 'query'>;

/* ───────────────────────────── Skema ───────────────────────────── */

export const ARENA_PRESET_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS arena_preset_decks (
  theme_id VARCHAR(30) PRIMARY KEY,
  title VARCHAR(120) NOT NULL,
  questions JSONB NOT NULL DEFAULT '[]'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by VARCHAR(255),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
export const ensureArenaPresetSchema = (db: Db) => db.query(ARENA_PRESET_SCHEMA_SQL);

/* ───────────────────────────── Validasi soal ───────────────────────────── */

export interface PresetQuestion extends ArenaQuestion {
  id: string;
  explanation: string;
  category: string;
}

const clean = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

const isHttpsUrl = (v: unknown) => {
  try {
    return new URL(String(v)).protocol === 'https:';
  } catch {
    return false;
  }
};

/** Bersihkan & validasi satu soal. Mengembalikan soal bersih atau pesan galat (sudah memuat nomor soal). */
export function sanitizePresetQuestion(
  raw: any,
  index: number,
  themeId: string
): { ok: true; q: PresetQuestion } | { ok: false; error: string } {
  const no = index + 1;
  const question = clean(raw?.question, 500);
  if (question.length < 5) return { ok: false, error: `Soal ${no}: teks pertanyaan minimal 5 karakter.` };
  if (!Array.isArray(raw?.options)) return { ok: false, error: `Soal ${no}: pilihan jawaban harus berupa daftar.` };
  const options = raw.options.map((o: unknown) => clean(o, 200));
  if (options.length < 2 || options.length > 6) return { ok: false, error: `Soal ${no}: jumlah pilihan harus 2 sampai 6.` };
  if (options.some((o: string) => !o)) return { ok: false, error: `Soal ${no}: ada pilihan jawaban yang kosong.` };
  if (new Set(options.map((o: string) => o.toLowerCase())).size !== options.length) {
    return { ok: false, error: `Soal ${no}: ada pilihan jawaban yang kembar.` };
  }
  const correctIndex = Number(raw?.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    return { ok: false, error: `Soal ${no}: jawaban benar tidak valid.` };
  }
  const q: PresetQuestion = {
    id: `ap-${themeId}-${String(no).padStart(2, '0')}`,
    question,
    options,
    correctIndex,
    explanation: clean(raw?.explanation, 600),
    category: clean(raw?.category, 40) || 'Umum',
  };
  const t = Number(raw?.timeLimitSec);
  if (Number.isFinite(t) && t >= 8 && t <= 60) q.timeLimitSec = Math.round(t);
  if (raw?.mediaType) {
    if (!['image', 'audio', 'video'].includes(raw.mediaType)) return { ok: false, error: `Soal ${no}: jenis media tidak dikenal.` };
    if (!isHttpsUrl(raw.mediaUrl) || String(raw.mediaUrl).length > 500) return { ok: false, error: `Soal ${no}: alamat media harus https.` };
    q.mediaType = raw.mediaType;
    q.mediaUrl = String(raw.mediaUrl);
    if (raw.mediaCredit) q.mediaCredit = clean(raw.mediaCredit, 200);
    if (raw.mediaSourceUrl && isHttpsUrl(raw.mediaSourceUrl)) q.mediaSourceUrl = String(raw.mediaSourceUrl);
  }
  return { ok: true, q };
}

/** Validasi seluruh daftar soal. `errors` kosong berarti semuanya sah. Soal ganda (teks sama) ditolak. */
export function sanitizePresetQuestions(raw: unknown, themeId: string): { questions: PresetQuestion[]; errors: string[] } {
  const errors: string[] = [];
  const questions: PresetQuestion[] = [];
  if (!Array.isArray(raw)) return { questions, errors: ['Daftar soal harus berupa array.'] };
  if (raw.length > ARENA_DECK_SIZE) errors.push(`Satu deck maksimal ${ARENA_DECK_SIZE} soal (terkirim ${raw.length}).`);
  const seen = new Set<string>();
  raw.slice(0, ARENA_DECK_SIZE).forEach((item, i) => {
    const r = sanitizePresetQuestion(item, i, themeId);
    if (!r.ok) return void errors.push(r.error);
    const key = r.q.question.toLowerCase();
    if (seen.has(key)) return void errors.push(`Soal ${i + 1}: pertanyaan sama dengan soal lain di deck ini.`);
    seen.add(key);
    questions.push(r.q);
  });
  return { questions, errors };
}

/* ───────────────────────────── Pemilih deck untuk arena ───────────────────────────── */

/** Deck preset aktif dan lengkap (tepat 20 soal). */
export async function listActivePresetDecks(db: Db): Promise<ArenaDeck[]> {
  const { rows } = await db.query(
    `SELECT theme_id, title, questions FROM arena_preset_decks
      WHERE enabled = true AND jsonb_typeof(questions) = 'array' AND jsonb_array_length(questions) = $1
      ORDER BY theme_id`,
    [ARENA_DECK_SIZE]
  );
  return rows
    .filter((r: any) => isArenaThemeId(String(r.theme_id)))
    .map((r: any) => ({
      deckId: presetDeckId(String(r.theme_id)),
      title: String(r.title),
      source: 'preset' as const,
      ownerName: '',
      questions: r.questions as ArenaQuestion[],
    }));
}

const MIN_COMMUNITY_QUESTIONS = 5;

/**
 * Pilih satu kuis untuk Arena Global dari gabungan: kuis Komunitas yang disetujui + deck preset aktif.
 * Undian seragam atas semua kandidat (tiap kuis Komunitas dan tiap deck preset punya peluang sama).
 * Bila undian jatuh ke Komunitas tetapi tidak ada hasil, jatuh ke deck preset; bila keduanya kosong, null.
 */
export async function pickArenaDeck(db: Db, pickCommunity: () => Promise<ArenaDeck | null>): Promise<ArenaDeck | null> {
  let presets: ArenaDeck[] = [];
  try {
    presets = await listActivePresetDecks(db);
  } catch (e: any) {
    console.error('[arena] gagal membaca deck preset:', e?.message || e);
  }
  let communityCount = 0;
  try {
    const { rows } = await db.query(
      `SELECT count(*)::int AS n FROM shared_quizzes WHERE moderation_status = 'approved' AND question_count >= $1`,
      [MIN_COMMUNITY_QUESTIONS]
    );
    communityCount = Number(rows[0]?.n) || 0;
  } catch (e: any) {
    console.error('[arena] gagal menghitung kuis komunitas:', e?.message || e);
  }
  const total = presets.length + communityCount;
  if (total === 0) return pickCommunity(); // hitungan gagal/kosong: tetap coba Komunitas langsung
  const roll = randomInt(total);
  if (roll < presets.length) return presets[roll];
  const community = await pickCommunity();
  if (community) return community;
  return presets.length ? presets[randomInt(presets.length)] : null;
}

/* ───────────────────────────── Rute admin ───────────────────────────── */

interface Options {
  db: Db;
  requireAdmin: RequestHandler;
}

export function createArenaPresetRouter({ db, requireAdmin }: Options) {
  const router = Router();

  const h =
    (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler =>
    (req, res) => {
      Promise.resolve(fn(req, res)).catch((err) => {
        console.error('[arena-preset]', err);
        if (!res.headersSent) res.status(500).json({ error: 'Terjadi kesalahan server.' });
      });
    };

  const adminEmail = (req: Request) => String((req as any).adminEmail || 'operator').slice(0, 255);

  const themeOf = (req: Request, res: Response): string | null => {
    const id = String(req.params.theme || '');
    if (!isArenaThemeId(id)) {
      res.status(404).json({ error: 'Tema Arena tidak dikenal.' });
      return null;
    }
    return id;
  };

  const countOf = (q: unknown) => (Array.isArray(q) ? q.length : 0);

  // Ringkasan ke-12 tema.
  router.get(
    '/api/admin/arena-decks',
    requireAdmin,
    h(async (_req, res) => {
      await ensureArenaPresetSchema(db);
      const { rows } = await db.query(`SELECT theme_id, title, questions, enabled, updated_by, updated_at FROM arena_preset_decks`);
      const byTheme = new Map<string, any>(rows.map((r: any) => [String(r.theme_id), r]));
      res.json({
        deckSize: ARENA_DECK_SIZE,
        themes: ARENA_THEMES.map((t) => {
          const r = byTheme.get(t.id);
          const questionCount = countOf(r?.questions);
          return {
            id: t.id,
            themeTitle: t.title,
            description: t.description,
            title: r ? String(r.title) : t.title,
            questionCount,
            complete: questionCount === ARENA_DECK_SIZE,
            enabled: Boolean(r?.enabled) && questionCount === ARENA_DECK_SIZE,
            updatedBy: r?.updated_by ?? null,
            updatedAt: r?.updated_at ?? null,
          };
        }),
      });
    })
  );

  // Satu deck lengkap beserta soalnya (admin boleh melihat kunci jawaban).
  router.get(
    '/api/admin/arena-decks/:theme',
    requireAdmin,
    h(async (req, res) => {
      const theme = themeOf(req, res);
      if (!theme) return;
      await ensureArenaPresetSchema(db);
      const { rows } = await db.query(
        `SELECT title, questions, enabled, updated_by, updated_at FROM arena_preset_decks WHERE theme_id = $1`,
        [theme]
      );
      const t = getArenaTheme(theme)!;
      const r = rows[0];
      res.json({
        id: theme,
        themeTitle: t.title,
        description: t.description,
        deckSize: ARENA_DECK_SIZE,
        title: r ? String(r.title) : t.title,
        questions: r && Array.isArray(r.questions) ? r.questions : [],
        enabled: Boolean(r?.enabled),
        updatedBy: r?.updated_by ?? null,
        updatedAt: r?.updated_at ?? null,
      });
    })
  );

  // Simpan deck (menimpa seluruh soal). Draf < 20 soal boleh, tetapi tidak bisa diaktifkan.
  router.put(
    '/api/admin/arena-decks/:theme',
    requireAdmin,
    h(async (req, res) => {
      const theme = themeOf(req, res);
      if (!theme) return;
      await ensureArenaPresetSchema(db);
      const t = getArenaTheme(theme)!;
      const title = clean(req.body?.title, 120) || t.title;
      const { questions, errors } = sanitizePresetQuestions(req.body?.questions, theme);
      if (errors.length) return res.status(400).json({ error: errors[0], errors });
      const wantEnabled = req.body?.enabled === true;
      if (wantEnabled && questions.length !== ARENA_DECK_SIZE) {
        return res
          .status(400)
          .json({ error: `Deck baru bisa diaktifkan bila berisi tepat ${ARENA_DECK_SIZE} soal (sekarang ${questions.length}).` });
      }
      await db.query(
        `INSERT INTO arena_preset_decks (theme_id, title, questions, enabled, updated_by, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, $5, now())
         ON CONFLICT (theme_id) DO UPDATE
           SET title = EXCLUDED.title, questions = EXCLUDED.questions, enabled = EXCLUDED.enabled,
               updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [theme, title, JSON.stringify(questions), wantEnabled, adminEmail(req)]
      );
      res.json({ success: true, id: theme, title, questionCount: questions.length, enabled: wantEnabled });
    })
  );

  // Aktif / nonaktifkan tanpa mengubah soal.
  router.patch(
    '/api/admin/arena-decks/:theme',
    requireAdmin,
    h(async (req, res) => {
      const theme = themeOf(req, res);
      if (!theme) return;
      await ensureArenaPresetSchema(db);
      const enabled = req.body?.enabled === true;
      const { rows } = await db.query(`SELECT questions FROM arena_preset_decks WHERE theme_id = $1`, [theme]);
      if (!rows.length) return res.status(404).json({ error: 'Deck tema ini belum dibuat.' });
      const count = countOf(rows[0].questions);
      if (enabled && count !== ARENA_DECK_SIZE) {
        return res
          .status(400)
          .json({ error: `Deck baru bisa diaktifkan bila berisi tepat ${ARENA_DECK_SIZE} soal (sekarang ${count}).` });
      }
      await db.query(`UPDATE arena_preset_decks SET enabled = $2, updated_by = $3, updated_at = now() WHERE theme_id = $1`, [
        theme,
        enabled,
        adminEmail(req),
      ]);
      res.json({ success: true, id: theme, enabled });
    })
  );

  // Kosongkan deck tema ini.
  router.delete(
    '/api/admin/arena-decks/:theme',
    requireAdmin,
    h(async (req, res) => {
      const theme = themeOf(req, res);
      if (!theme) return;
      await ensureArenaPresetSchema(db);
      await db.query(`DELETE FROM arena_preset_decks WHERE theme_id = $1`, [theme]);
      res.json({ success: true, id: theme });
    })
  );

  return router;
}
