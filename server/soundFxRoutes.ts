// server/soundFxRoutes.ts
// Pengaturan EFEK SUARA KLIK per pengguna, disimpan di PostgreSQL
// (kolom users.sfx_settings, JSONB) — sama seperti avatar_url / bio / greeting.
//
// Dipasang di server/index.ts (lihat PANDUAN-PASANG.md):
//   import { createSoundFxRouter, ensureSoundFxSchema } from './soundFxRoutes';
//   .then(() => ensureSoundFxSchema(pool))
//   app.use(createSoundFxRouter({ db: pool, requireUser }));
//
// Penjagaan mode "Nada GM" DILAKUKAN DI SINI (bukan cuma di UI): server mengecek
// sendiri apakah akun memiliki Full 64-Bar Editor dari tabel user_collections,
// dengan aturan yang sama persis seperti GET /api/user/collections.
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';

type Db = Pick<Pool, 'query'>;

export const SOUNDFX_SCHEMA_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS sfx_settings JSONB;
`;
export const ensureSoundFxSchema = (db: Db) => db.query(SOUNDFX_SCHEMA_SQL);

// ── Harus sama dengan src/services/sfxSettings.ts ───────────────────────────
type Section = 'audio' | 'quiz' | 'other';
const SECTIONS: Section[] = ['audio', 'quiz', 'other'];
const BUILTIN_IDS: Record<Section, string[]> = {
  audio: ['audio-hat', 'audio-kick'],
  quiz: ['quiz-bell', 'quiz-pop'],
  other: ['other-tok'],
};
const NOTE_MIN = 36;
const NOTE_MAX = 96;
const DEFAULT_SLOT = { program: 12, note: 72, randomPitch: false };

interface Slot { program: number; note: number; randomPitch: boolean }
export interface SfxSettings {
  v: 1;
  mode: 'builtin' | 'gm';
  builtin: Record<Section, string>; // id efek atau 'off'
  gmLinked: boolean;
  gmShared: Slot;
  gm: Record<Section, Slot>;
}

const clampInt = (n: unknown, lo: number, hi: number, fb: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fb;
  return Math.min(hi, Math.max(lo, v));
};
const slot = (raw: any): Slot => ({
  program: clampInt(raw?.program, 0, 127, DEFAULT_SLOT.program),
  note: clampInt(raw?.note, NOTE_MIN, NOTE_MAX, DEFAULT_SLOT.note),
  randomPitch: raw?.randomPitch === true,
});
const builtin = (s: Section, id: unknown) => (BUILTIN_IDS[s].includes(id as string) ? (id as string) : 'off');

export function sanitizeSfx(raw: any): SfxSettings {
  return {
    v: 1,
    mode: raw?.mode === 'gm' ? 'gm' : 'builtin',
    builtin: {
      audio: builtin('audio', raw?.builtin?.audio),
      quiz: builtin('quiz', raw?.builtin?.quiz),
      other: builtin('other', raw?.builtin?.other),
    },
    gmLinked: raw?.gmLinked !== false,
    gmShared: slot(raw?.gmShared),
    gm: { audio: slot(raw?.gm?.audio), quiz: slot(raw?.gm?.quiz), other: slot(raw?.gm?.other) },
  };
}

interface Options {
  db: Db;
  requireUser: RequestHandler;
  getUserEmail?: (req: Request) => string | undefined;
}

export function createSoundFxRouter({
  db,
  requireUser,
  getUserEmail = (req) => (req as any).userEmail || (req as any).user?.email,
}: Options) {
  const router = Router();

  const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[sfx]', err);
      if (!res.headersSent) res.status(500).json({ error: 'Terjadi kesalahan server.' });
    });
  };

  // Aturan SAMA dengan has16BarEditor di GET /api/user/collections (server/index.ts).
  async function ownsPadEditor(email: string): Promise<boolean> {
    const { rows } = await db.query(
      `SELECT 1 FROM public.user_collections
        WHERE lower(user_email) = $1 AND item_category = 'audio'
          AND item_type_key IN ('fullEditor8Bar', 'all')
        LIMIT 1`,
      [email]
    );
    return rows.length > 0;
  }

  async function load(email: string) {
    const { rows } = await db.query(`SELECT sfx_settings FROM users WHERE lower(email) = $1 LIMIT 1`, [email]);
    const gmUnlocked = await ownsPadEditor(email);
    const settings = sanitizeSfx(rows[0]?.sfx_settings);
    // Kalau kepemilikan editor hilang (mis. refund), mode GM otomatis kembali ke bawaan.
    if (!gmUnlocked && settings.mode === 'gm') settings.mode = 'builtin';
    return { settings, gmUnlocked };
  }

  const own = (req: Request) => String(getUserEmail(req) || '').trim().toLowerCase();

  router.get('/api/me/sfx', requireUser, h(async (req, res) => {
    const email = own(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    res.json(await load(email));
  }));

  router.put('/api/me/sfx', requireUser, h(async (req, res) => {
    const email = own(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });

    const settings = sanitizeSfx(req.body?.settings);
    const gmUnlocked = await ownsPadEditor(email);
    if (settings.mode === 'gm' && !gmUnlocked) {
      return res.status(403).json({ error: 'Mode Nada GM butuh Full 64-Bar Editor.' });
    }

    const { rowCount } = await db.query(
      `UPDATE users SET sfx_settings = $2::jsonb WHERE lower(email) = $1`,
      [email, JSON.stringify(settings)]
    );
    if (!rowCount) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
    res.json({ settings, gmUnlocked });
  }));

  return router;
}
