// server/themeBulkRoutes.ts
// Terapkan / reset tema ke banyak pengguna + notifikasi untuk pengguna.
//
// Dipasang di server/index.ts (SESUDAH createThemeRouter):
//   import { createThemeBulkRoutes } from './themeBulkRoutes';
//   app.use(createThemeBulkRoutes({ pool, requireAdmin, requireSuperAdmin, requireUser }));
//
// Memakai tabel yang SAMA dengan themeRoutes.ts:
//   themes(id, scope, ...)                                   -> tema
//   user_theme_prefs(email PK, active_theme_id, locked)      -> tema aktif + kunci per pengguna
//   users(email)                                             -> daftar pengguna terdaftar
// Tabel baru yang dibuat otomatis: theme_prev (riwayat tema sebelumnya) dan user_notifications.
import { Router } from 'express';
import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'pg';

interface Deps {
  pool: Pool;
  requireAdmin: RequestHandler;      // wajib dijalankan lebih dulu: dialah yang mengisi req.isSuperAdmin
  requireSuperAdmin: RequestHandler;
  requireUser: RequestHandler;       // sesi cookie pengguna; mengisi req.userEmail
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TARGETS = 1000;
const TITLE_MAX = 80;
const MESSAGE_MAX = 400;

const normEmails = (input: unknown): string[] => {
  if (!Array.isArray(input)) return [];
  const out = new Set<string>();
  for (const v of input) {
    if (typeof v !== 'string') continue;
    const e = v.trim().toLowerCase();
    if (EMAIL_RE.test(e)) out.add(e);
  }
  return Array.from(out);
};

const parseNotify = (n: any): { title: string; message: string } | null => {
  if (!n || typeof n.title !== 'string' || typeof n.message !== 'string') return null;
  const title = n.title.trim().slice(0, TITLE_MAX);
  const message = n.message.trim().slice(0, MESSAGE_MAX);
  return title && message ? { title, message } : null;
};

export function createThemeBulkRoutes({ pool, requireAdmin, requireSuperAdmin, requireUser }: Deps): Router {
  const router = Router();

  const ready = pool
    .query(`
      CREATE TABLE IF NOT EXISTS theme_prev (
        user_email TEXT PRIMARY KEY,
        prev_theme_id INTEGER,
        prev_locked BOOLEAN NOT NULL DEFAULT FALSE,
        saved_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS user_notifications (
        id SERIAL PRIMARY KEY,
        user_email TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'theme',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        read_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS user_notifications_unread_idx ON user_notifications (user_email) WHERE read_at IS NULL;
    `)
    .catch((e) => { console.error('[themeBulk] gagal menyiapkan tabel:', e); throw e; });

  const wrap =
    (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
    async (req, res) => {
      try {
        await ready;
        await fn(req, res);
      } catch (e) {
        console.error('[themeBulk]', e);
        if (!res.headersSent) res.status(500).json({ error: 'Terjadi kesalahan di server.' });
      }
    };

  /** Tentukan email sasaran. 'all' = semua pengguna terdaftar; 'selected' = hanya yang terdaftar. */
  async function resolveTargets(q: { query: Pool['query'] }, scope: unknown, emailsIn: unknown) {
    if (scope === 'all') {
      const r = await q.query(`SELECT lower(email) AS email FROM users WHERE email IS NOT NULL`);
      return { targets: r.rows.map((x: any) => x.email as string), unknown: [] as string[] };
    }
    const wanted = normEmails(emailsIn);
    if (wanted.length === 0) return { targets: [] as string[], unknown: [] as string[] };
    const r = await q.query(`SELECT lower(email) AS email FROM users WHERE lower(email) = ANY($1::text[])`, [wanted]);
    const found = new Set<string>(r.rows.map((x: any) => x.email));
    return { targets: wanted.filter((e) => found.has(e)), unknown: wanted.filter((e) => !found.has(e)) };
  }

  async function notify(client: { query: Pool['query'] }, emails: string[], n: { title: string; message: string } | null) {
    if (!n || emails.length === 0) return 0;
    const r = await client.query(
      `INSERT INTO user_notifications (user_email, kind, title, message)
       SELECT e, 'theme', $2::text, $3::text FROM unnest($1::text[]) AS e`,
      [emails, n.title, n.message],
    );
    return r.rowCount ?? 0;
  }

  // ── Admin: daftar pengguna untuk pemilih ───────────────────────────────
  router.get('/api/admin/theme-bulk/users', requireAdmin, requireSuperAdmin, wrap(async (_req, res) => {
    const r = await pool.query(`SELECT lower(email) AS email FROM users WHERE email IS NOT NULL ORDER BY 1 LIMIT 5000`);
    res.json({ users: r.rows });
  }));

  // ── Admin: terapkan tema ───────────────────────────────────────────────
  router.post('/api/admin/theme-bulk/apply', requireAdmin, requireSuperAdmin, wrap(async (req, res) => {
    const { scope, emails, themeId, locked, notify: notifyIn } = req.body || {};
    if (scope !== 'all' && scope !== 'selected') { res.status(400).json({ error: 'scope harus "all" atau "selected".' }); return; }
    if (!Number.isInteger(themeId)) { res.status(400).json({ error: 'themeId tidak valid.' }); return; }

    const t = await pool.query(`SELECT id FROM themes WHERE id = $1 AND scope = 'admin'`, [themeId]);
    if (t.rowCount === 0) { res.status(404).json({ error: 'Tema admin tidak ditemukan.' }); return; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { targets, unknown } = await resolveTargets(client, scope, emails);
      if (targets.length === 0) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Tidak ada pengguna sasaran.' }); return; }
      if (scope === 'selected' && targets.length > MAX_TARGETS) { await client.query('ROLLBACK'); res.status(400).json({ error: `Maksimal ${MAX_TARGETS} pengguna per permintaan.` }); return; }

      // Simpan tema sebelumnya — hanya kalau belum ada snapshot, supaya penerapan berulang
      // tidak menimpa tema asli pengguna.
      await client.query(
        `INSERT INTO theme_prev (user_email, prev_theme_id, prev_locked)
         SELECT e, ut.active_theme_id, COALESCE(ut.locked, FALSE)
         FROM unnest($1::text[]) AS e
         LEFT JOIN user_theme_prefs ut ON lower(ut.email) = e
         ON CONFLICT (user_email) DO NOTHING`,
        [targets],
      );

      await client.query(
        `INSERT INTO user_theme_prefs (email, active_theme_id, locked)
         SELECT e, $2::int, $3::boolean FROM unnest($1::text[]) AS e
         ON CONFLICT (email) DO UPDATE SET active_theme_id = EXCLUDED.active_theme_id, locked = EXCLUDED.locked`,
        [targets, themeId, Boolean(locked)],
      );

      const notified = await notify(client, targets, parseNotify(notifyIn));
      await client.query('COMMIT');
      res.json({ total: targets.length, updated: targets.length, skipped: unknown, notified });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }));

  // ── Admin: reset tema ──────────────────────────────────────────────────
  // mode 'previous' = kembalikan ke tema + status kunci sebelum admin menerapkan
  // mode 'builtin'  = kembali ke tema bawaan & buka kunci
  router.post('/api/admin/theme-bulk/reset', requireAdmin, requireSuperAdmin, wrap(async (req, res) => {
    const { scope, emails, mode, notify: notifyIn } = req.body || {};
    if (scope !== 'all' && scope !== 'selected') { res.status(400).json({ error: 'scope harus "all" atau "selected".' }); return; }
    if (mode !== 'previous' && mode !== 'builtin') { res.status(400).json({ error: 'mode harus "previous" atau "builtin".' }); return; }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { targets, unknown } = await resolveTargets(client, scope, emails);
      if (targets.length === 0) { await client.query('ROLLBACK'); res.status(400).json({ error: 'Tidak ada pengguna sasaran.' }); return; }
      if (scope === 'selected' && targets.length > MAX_TARGETS) { await client.query('ROLLBACK'); res.status(400).json({ error: `Maksimal ${MAX_TARGETS} pengguna per permintaan.` }); return; }

      let restored: string[] = [];

      if (mode === 'previous') {
        // Tema sebelumnya yang sudah dihapus admin → jatuh ke bawaan (NULL).
        const r = await client.query(
          `WITH snap AS (
             DELETE FROM theme_prev WHERE user_email = ANY($1::text[])
             RETURNING user_email, prev_theme_id, prev_locked
           )
           INSERT INTO user_theme_prefs (email, active_theme_id, locked)
           SELECT s.user_email,
                  CASE WHEN EXISTS (SELECT 1 FROM themes t WHERE t.id = s.prev_theme_id) THEN s.prev_theme_id END,
                  s.prev_locked
           FROM snap s
           ON CONFLICT (email) DO UPDATE SET active_theme_id = EXCLUDED.active_theme_id, locked = EXCLUDED.locked
           RETURNING email AS user_email`,
          [targets],
        );
        restored = r.rows.map((x: any) => x.user_email as string);
      } else {
        await client.query(
          `INSERT INTO user_theme_prefs (email, active_theme_id, locked)
           SELECT e, NULL, FALSE FROM unnest($1::text[]) AS e
           ON CONFLICT (email) DO UPDATE SET active_theme_id = NULL, locked = FALSE`,
          [targets],
        );
        await client.query(`DELETE FROM theme_prev WHERE user_email = ANY($1::text[])`, [targets]);
        restored = targets;
      }

      const restoredSet = new Set(restored);
      const skipped = [...unknown, ...targets.filter((e) => !restoredSet.has(e))];
      // Notifikasi hanya untuk yang benar-benar berubah.
      const notified = await notify(client, restored, parseNotify(notifyIn));
      await client.query('COMMIT');
      res.json({ total: targets.length, restored: restored.length, skipped, notified });
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }));

  // ── Pengguna: baca & tandai notifikasi ─────────────────────────────────
  router.get('/api/me/notifications', requireUser, wrap(async (req, res) => {
    const email = String((req as any).userEmail || '').toLowerCase();
    if (!email) { res.status(401).json({ error: 'Belum login.' }); return; }
    const r = await pool.query(
      `SELECT id, title, message, created_at FROM user_notifications
       WHERE user_email = $1 AND read_at IS NULL ORDER BY id DESC LIMIT 5`,
      [email],
    );
    res.json({
      notifications: r.rows.map((x: any) => ({ id: x.id, title: x.title, message: x.message, createdAt: x.created_at })),
    });
  }));

  router.post('/api/me/notifications/read', requireUser, wrap(async (req, res) => {
    const email = String((req as any).userEmail || '').toLowerCase();
    if (!email) { res.status(401).json({ error: 'Belum login.' }); return; }
    const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.filter((n: unknown) => Number.isInteger(n)) : [];
    if (ids.length) {
      await pool.query(`UPDATE user_notifications SET read_at = now() WHERE user_email = $1 AND id = ANY($2::int[])`, [email, ids]);
    }
    res.json({ ok: true });
  }));

  return router;
}
