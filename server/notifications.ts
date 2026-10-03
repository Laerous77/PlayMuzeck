// server/notifications.ts
// Pusat notifikasi per pengguna (lonceng di Header). Satu tabel untuk SEMUA jenis notifikasi:
// hapus akun, tema diterapkan admin, dst. Fitur lain cukup memanggil notifyUser(...).
import { Router } from 'express';
import type { Pool } from 'pg';

export async function ensureNotificationSchema(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      type VARCHAR(40) NOT NULL,
      title VARCHAR(200) NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS user_notifications_user_idx ON user_notifications (lower(user_email), created_at DESC);
    -- ref_key mencegah notifikasi yang sama (mis. dari sistem tema) tersimpan dua kali.
    ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS ref_key VARCHAR(80);
    CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_ref_uniq ON user_notifications (lower(user_email), ref_key) WHERE ref_key IS NOT NULL;
  `);
}

/**
 * Kirim notifikasi ke satu pengguna. Tidak pernah melempar error (gagal notifikasi tidak boleh menggagalkan aksi utama).
 * type contoh: 'account_deletion', 'account_deletion_cancelled', 'theme_applied', 'theme_reset'.
 */
export async function notifyUser(pool: Pool, email: string, type: string, title: string, body = '') {
  try {
    await pool.query(
      `INSERT INTO user_notifications (user_email, type, title, body) VALUES ($1, $2, $3, $4)`,
      [String(email).toLowerCase(), type.slice(0, 40), title.slice(0, 200), body.slice(0, 5000)]
    );
  } catch (err) {
    console.error('[notif] gagal menyimpan notifikasi:', err);
  }
}

export function createNotificationsRouter({ pool }: { pool: Pool }) {
  const r = Router();

  // Semua route di bawah /api/user sudah dilindungi requireUser (index.ts), jadi req.user pasti ada.
  r.get('/api/user/notifications', async (req, res) => {
    try {
      const user = req.user!;
      const [list, unread, del] = await Promise.all([
        pool.query(
          `SELECT id, type, title, body, created_at, read_at FROM user_notifications
            WHERE lower(user_email) = lower($1) ORDER BY created_at DESC, id DESC LIMIT 50`,
          [user.email]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS n FROM user_notifications WHERE lower(user_email) = lower($1) AND read_at IS NULL`,
          [user.email]
        ),
        pool.query(`SELECT deletion_scheduled_at, deletion_requested_by FROM users WHERE id = $1`, [user.id]),
      ]);
      const d = del.rows[0];
      res.json({
        items: list.rows,
        unread: unread.rows[0].n,
        // Status penghapusan akun dihitung langsung dari tabel users, jadi hitung mundurnya selalu akurat.
        deletion: d?.deletion_scheduled_at
          ? {
              scheduledAt: new Date(d.deletion_scheduled_at).toISOString(),
              requestedBy: d.deletion_requested_by === 'self' ? 'self' : 'admin',
            }
          : null,
      });
    } catch (err) {
      console.error('[notif] list:', err);
      res.status(500).json({ error: 'Gagal memuat notifikasi.' });
    }
  });

  // Jembatan ke sistem notifikasi tema lama (/api/me/notifications): lonceng memindahkan notifikasi dari admin
  // (tema diterapkan / direset / dikunci) ke tabel ini supaya tersimpan sebagai riwayat. Hanya untuk akun yang sedang login.
  r.post('/api/user/notifications/import', async (req, res) => {
    try {
      const email = req.user!.email;
      const raw = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
      for (const it of raw) {
        const id = Number(it?.id);
        const title = String(it?.title || '').trim().slice(0, 200);
        if (!Number.isFinite(id) || !title) continue;
        const body = String(it?.message || '').trim().slice(0, 2000);
        const t = new Date(String(it?.createdAt || ''));
        const createdAt = Number.isNaN(t.getTime()) || t.getTime() > Date.now() ? new Date() : t;
        await pool.query(
          `INSERT INTO user_notifications (user_email, type, title, body, created_at, ref_key)
           VALUES ($1, 'theme_notice', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
          [email.toLowerCase(), title, body, createdAt, `theme:${id}`]
        );
      }
      res.json({ success: true });
    } catch (err) {
      console.error('[notif] import:', err);
      res.status(500).json({ error: 'Gagal menyimpan notifikasi.' });
    }
  });

  r.post('/api/user/notifications/read-all', async (req, res) => {
    try {
      await pool.query(
        `UPDATE user_notifications SET read_at = now() WHERE lower(user_email) = lower($1) AND read_at IS NULL`,
        [req.user!.email]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[notif] read-all:', err);
      res.status(500).json({ error: 'Gagal menandai notifikasi.' });
    }
  });

  r.delete('/api/user/notifications', async (req, res) => {
    try {
      await pool.query(`DELETE FROM user_notifications WHERE lower(user_email) = lower($1)`, [req.user!.email]);
      res.json({ success: true });
    } catch (err) {
      console.error('[notif] clear:', err);
      res.status(500).json({ error: 'Gagal menghapus notifikasi.' });
    }
  });

  return r;
}
