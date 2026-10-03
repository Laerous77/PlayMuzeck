// server/notifications.ts
// Pusat notifikasi per pengguna (lonceng di Header). Satu tabel untuk SEMUA jenis notifikasi:
// hapus akun, tema diterapkan admin, dst. Fitur lain cukup memanggil notifyUser(...).
import { Router } from 'express';
import type { Pool } from 'pg';

export async function ensureNotificationSchema(pool: Pool) {
  // PENYEBAB UTAMA "notifikasi tidak masuk": themeBulkRoutes.ts SUDAH membuat tabel bernama `user_notifications`
  // dengan kolom berbeda (kind, message). Karena CREATE TABLE IF NOT EXISTS tidak mengubah tabel yang sudah ada,
  // semua query kita (kolom type, body) gagal. Karena itu inbox pengguna memakai tabel TERPISAH: notification_inbox.
  // Tabel lama `user_notifications` tetap milik sistem tema (admin menulis, lonceng menariknya lewat /api/me/notifications).
  //
  // Penyembuhan: kalau tabel lama ternyata sempat dibuat dengan bentuk milik kita (ada kolom `type`), sesuaikan agar
  // INSERT dari sistem tema (kolom kind/message) tidak gagal.
  await pool.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_notifications' AND column_name = 'type') THEN
        ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'theme';
        ALTER TABLE user_notifications ADD COLUMN IF NOT EXISTS message TEXT NOT NULL DEFAULT '';
        ALTER TABLE user_notifications ALTER COLUMN type DROP NOT NULL;
      END IF;
    END $$;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notification_inbox (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255) NOT NULL,
      type VARCHAR(40) NOT NULL,
      title VARCHAR(200) NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      read_at TIMESTAMPTZ
    );
    CREATE INDEX IF NOT EXISTS notification_inbox_user_idx ON notification_inbox (lower(user_email), created_at DESC);
    -- ref_key mencegah notifikasi yang sama (mis. dari sistem tema) tersimpan dua kali.
    ALTER TABLE notification_inbox ADD COLUMN IF NOT EXISTS ref_key VARCHAR(80);
    CREATE UNIQUE INDEX IF NOT EXISTS notification_inbox_ref_uniq ON notification_inbox (lower(user_email), ref_key) WHERE ref_key IS NOT NULL;
  `);
}

// Pastikan tabel ada SEBELUM dipakai (aman dipanggil berkali-kali; hanya jalan sekali).
// Dulu tabel hanya dibuat lewat rantai .then() di index.ts, sehingga kalau langkah sebelumnya
// error, tabel tidak pernah dibuat dan SEMUA notifikasi diam-diam gagal.
let schemaReady: Promise<void> | null = null;
export function ensureNotificationSchemaOnce(pool: Pool): Promise<void> {
  if (!schemaReady) {
    schemaReady = ensureNotificationSchema(pool).catch((err) => {
      schemaReady = null; // coba lagi di pemanggilan berikutnya
      throw err;
    });
  }
  return schemaReady;
}

/**
 * Kirim notifikasi ke satu pengguna. Tidak pernah melempar error (gagal notifikasi tidak boleh menggagalkan aksi utama).
 * type contoh: 'account_deletion', 'account_deletion_cancelled', 'theme_applied', 'theme_reset'.
 */
export async function notifyUser(pool: Pool, email: string, type: string, title: string, body = '') {
  try {
    await ensureNotificationSchemaOnce(pool);
    await pool.query(
      `INSERT INTO notification_inbox (user_email, type, title, body) VALUES ($1, $2, $3, $4)`,
      [String(email).toLowerCase(), type.slice(0, 40), title.slice(0, 200), body.slice(0, 5000)]
    );
  } catch (err) {
    console.error('[notif] gagal menyimpan notifikasi:', err);
  }
}

export function createNotificationsRouter({ pool }: { pool: Pool }) {
  const r = Router();

  // Setiap request ke /api/user/notifications* memastikan tabelnya ada dulu.
  r.use('/api/user/notifications', async (_req, _res, next) => {
    try {
      await ensureNotificationSchemaOnce(pool);
    } catch (err) {
      console.error('[notif] schema:', err);
    }
    next();
  });

  // Semua route di bawah /api/user sudah dilindungi requireUser (index.ts), jadi req.user pasti ada.
  r.get('/api/user/notifications', async (req, res) => {
    const user = req.user!;
    let items: any[] = [];
    let unread = 0;
    let deletion: { scheduledAt: string; requestedBy: 'self' | 'admin' } | null = null;

    // Daftar notifikasi. Kalau gagal, banner hapus akun di bawah tetap dikirim.
    try {
      const [list, count] = await Promise.all([
        pool.query(
          `SELECT id, type, title, body, created_at, read_at FROM notification_inbox
            WHERE lower(user_email) = lower($1) ORDER BY created_at DESC, id DESC LIMIT 50`,
          [user.email]
        ),
        pool.query(
          `SELECT COUNT(*)::int AS n FROM notification_inbox WHERE lower(user_email) = lower($1) AND read_at IS NULL`,
          [user.email]
        ),
      ]);
      items = list.rows;
      unread = count.rows[0].n;
    } catch (err) {
      console.error('[notif] list:', err);
    }

    // Status penghapusan akun dihitung langsung dari tabel users, jadi hitung mundurnya selalu akurat
    // dan tidak bergantung pada tabel notifikasi.
    try {
      const del = await pool.query(
        `SELECT deletion_scheduled_at, deletion_requested_by FROM users WHERE id = $1`,
        [user.id]
      );
      const d = del.rows[0];
      if (d?.deletion_scheduled_at) {
        deletion = {
          scheduledAt: new Date(d.deletion_scheduled_at).toISOString(),
          requestedBy: d.deletion_requested_by === 'self' ? 'self' : 'admin',
        };
      }
    } catch (err) {
      console.error('[notif] deletion status:', err);
    }

    res.json({ items, unread, deletion });
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
          `INSERT INTO notification_inbox (user_email, type, title, body, created_at, ref_key)
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
        `UPDATE notification_inbox SET read_at = now() WHERE lower(user_email) = lower($1) AND read_at IS NULL`,
        [req.user!.email]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[notif] read-all:', err);
      res.status(500).json({ error: 'Gagal menandai notifikasi.' });
    }
  });

  // Hapus SATU notifikasi milik pengguna yang sedang login.
  r.delete('/api/user/notifications/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id)) {
        res.status(400).json({ error: 'ID notifikasi tidak valid.' });
        return;
      }
      await pool.query(
        `DELETE FROM notification_inbox WHERE id = $1 AND lower(user_email) = lower($2)`,
        [id, req.user!.email]
      );
      res.json({ success: true });
    } catch (err) {
      console.error('[notif] delete one:', err);
      res.status(500).json({ error: 'Gagal menghapus notifikasi.' });
    }
  });

  r.delete('/api/user/notifications', async (req, res) => {
    try {
      await pool.query(`DELETE FROM notification_inbox WHERE lower(user_email) = lower($1)`, [req.user!.email]);
      res.json({ success: true });
    } catch (err) {
      console.error('[notif] clear:', err);
      res.status(500).json({ error: 'Gagal menghapus notifikasi.' });
    }
  });

  return r;
}
