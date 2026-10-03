// server/accountDeletion.ts
// Hapus akun permanen dengan masa tunggu 3 hari.
// - Pengguna atau admin menjadwalkan penghapusan -> users.deletion_scheduled_at = sekarang + 3 hari.
// - Selama masa tunggu akun tetap bisa dipakai & login. Jam terus berjalan.
// - Hanya tombol "Batalkan penghapusan" (manual) yang menghentikan jam.
// - Penyapu otomatis menghapus permanen akun yang waktunya habis.
import { Router, RequestHandler } from 'express';
import type { Pool } from 'pg';
import { SUPER_ADMIN_EMAIL } from './db';
import { verifyPassword, sendMailStrict } from './auth/authRoutes';

export const DELETION_GRACE_DAYS = 3;

interface Deps {
  pool: Pool;
  requireUser: RequestHandler;
  requireAdmin: RequestHandler;
  requireSuperAdmin: RequestHandler;
  isServerAdminEmail: (email: string) => Promise<boolean>;
}

const fmtWib = (d: Date) =>
  d.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' }) + ' WIB';

function notify(to: string, subject: string, text: string) {
  sendMailStrict(to, subject, text).catch(() => { /* SMTP belum aktif / gagal: abaikan, penghapusan tetap terjadwal */ });
}

/** Jadwalkan penghapusan. Kalau sudah terjadwal, jam lama DIPERTAHANKAN (tidak di-reset). */
async function scheduleDeletion(pool: Pool, userId: string, by: string) {
  const { rows } = await pool.query(
    `UPDATE users SET
        deletion_requested_at = COALESCE(deletion_requested_at, now()),
        deletion_scheduled_at = COALESCE(deletion_scheduled_at, now() + make_interval(days => $2)),
        deletion_requested_by = COALESCE(deletion_requested_by, $3)
      WHERE id = $1
      RETURNING email, name, deletion_scheduled_at`,
    [userId, DELETION_GRACE_DAYS, by]
  );
  return rows[0] as { email: string; name: string | null; deletion_scheduled_at: Date } | undefined;
}

async function cancelDeletion(pool: Pool, userId: string) {
  const { rows } = await pool.query(
    `UPDATE users SET deletion_requested_at = NULL, deletion_scheduled_at = NULL, deletion_requested_by = NULL
      WHERE id = $1 AND deletion_scheduled_at IS NOT NULL
      RETURNING email, name`,
    [userId]
  );
  return rows[0] as { email: string; name: string | null } | undefined;
}

export function createAccountDeletionRouter({ pool, requireUser, requireAdmin, requireSuperAdmin, isServerAdminEmail }: Deps) {
  const r = Router();

  // ---------- SISI PENGGUNA ----------
  r.get('/api/user/account/deletion', requireUser, async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT deletion_requested_at, deletion_scheduled_at, deletion_requested_by FROM users WHERE id = $1`,
        [req.user!.id]
      );
      const u = rows[0];
      if (!u?.deletion_scheduled_at) return res.json({ scheduled: false, graceDays: DELETION_GRACE_DAYS });
      const at = new Date(u.deletion_scheduled_at);
      res.json({
        scheduled: true,
        graceDays: DELETION_GRACE_DAYS,
        requestedAt: u.deletion_requested_at,
        scheduledAt: at.toISOString(),
        requestedBy: u.deletion_requested_by === 'self' ? 'self' : 'admin',
        msLeft: Math.max(0, at.getTime() - Date.now()),
      });
    } catch (err) {
      console.error('[account] status:', err);
      res.status(500).json({ error: 'Gagal memuat status penghapusan akun.' });
    }
  });

  r.post('/api/user/account/delete', requireUser, async (req, res) => {
    try {
      const user = req.user!;
      if (String(req.body?.confirm || '').trim().toUpperCase() !== 'HAPUS') {
        return res.status(400).json({ error: 'Ketik HAPUS untuk mengonfirmasi penghapusan akun.' });
      }
      if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
        return res.status(403).json({ error: 'Akun Super Admin tidak bisa dihapus.' });
      }
      if (await isServerAdminEmail(user.email)) {
        return res.status(403).json({ error: 'Akun ini terdaftar sebagai admin. Minta Super Admin mencabut akses adminmu dulu.' });
      }
      // Akun berkata sandi wajib memasukkan kata sandi (cegah penghapusan oleh orang yang meminjam perangkat).
      const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      const hash: string | null = rows[0]?.password_hash ?? null;
      if (hash) {
        const check = await verifyPassword(hash, String(req.body?.password || ''));
        if (!check.ok) return res.status(401).json({ error: 'Kata sandi salah.' });
      }
      const saved = await scheduleDeletion(pool, user.id, 'self');
      if (!saved) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
      const at = new Date(saved.deletion_scheduled_at);
      notify(
        saved.email,
        'Akun PlayMuzeck kamu dijadwalkan untuk dihapus',
        `Kamu meminta penghapusan akun PlayMuzeck.\n\nAkun akan DIHAPUS PERMANEN pada ${fmtWib(at)} (${DELETION_GRACE_DAYS} hari dari permintaan).\n` +
          `Sampai saat itu akunmu masih bisa dipakai. Untuk membatalkan, masuk lalu tekan "Batalkan Penghapusan Akun" di Profil.\n` +
          `Bukan kamu? Segera masuk dan batalkan, lalu ganti kata sandi.`
      );
      res.json({ success: true, scheduledAt: at.toISOString(), msLeft: Math.max(0, at.getTime() - Date.now()) });
    } catch (err) {
      console.error('[account] delete:', err);
      res.status(500).json({ error: 'Gagal menjadwalkan penghapusan akun.' });
    }
  });

  r.post('/api/user/account/cancel-deletion', requireUser, async (req, res) => {
    try {
      const saved = await cancelDeletion(pool, req.user!.id);
      if (!saved) return res.status(404).json({ error: 'Tidak ada penghapusan akun yang sedang dijadwalkan.' });
      notify(saved.email, 'Penghapusan akun PlayMuzeck dibatalkan', 'Penghapusan akunmu sudah dibatalkan. Akunmu tetap aktif seperti biasa.');
      res.json({ success: true });
    } catch (err) {
      console.error('[account] cancel:', err);
      res.status(500).json({ error: 'Gagal membatalkan penghapusan akun.' });
    }
  });

  // ---------- SISI ADMIN ----------
  r.post('/api/admin/users/:id/schedule-deletion', requireAdmin, requireSuperAdmin, async (req, res) => {
    try {
      const found = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
      const email: string | undefined = found.rows[0]?.email;
      if (!email) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) return res.status(403).json({ error: 'Akun Super Admin tidak bisa dihapus.' });
      if (await isServerAdminEmail(email)) return res.status(403).json({ error: 'Akun ini admin. Cabut akses adminnya dulu di menu Admin & Akses.' });
      const by = String((req as any).adminEmail || 'admin');
      const saved = await scheduleDeletion(pool, req.params.id, `admin:${by}`);
      if (!saved) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      const at = new Date(saved.deletion_scheduled_at);
      notify(
        saved.email,
        'Akun PlayMuzeck kamu dijadwalkan untuk dihapus oleh admin',
        `Admin PlayMuzeck menjadwalkan penghapusan akunmu.\n\nAkun akan DIHAPUS PERMANEN pada ${fmtWib(at)}.\n` +
          `Sampai saat itu akunmu masih bisa dipakai. Kalau keberatan, masuk lalu tekan "Batalkan Penghapusan Akun" di Profil.`
      );
      res.json({ success: true, scheduledAt: at.toISOString() });
    } catch (err: any) {
      console.error('[admin] schedule deletion:', err);
      res.status(500).json({ error: err?.message || 'Gagal menjadwalkan penghapusan.' });
    }
  });

  r.post('/api/admin/users/:id/cancel-deletion', requireAdmin, requireSuperAdmin, async (req, res) => {
    try {
      const saved = await cancelDeletion(pool, req.params.id);
      if (!saved) return res.status(404).json({ error: 'Pengguna tidak ditemukan atau tidak sedang dijadwalkan dihapus.' });
      notify(saved.email, 'Penghapusan akun PlayMuzeck dibatalkan', 'Penghapusan akunmu dibatalkan oleh admin. Akunmu tetap aktif.');
      res.json({ success: true });
    } catch (err: any) {
      console.error('[admin] cancel deletion:', err);
      res.status(500).json({ error: err?.message || 'Gagal membatalkan penghapusan.' });
    }
  });

  return r;
}

/** Hapus permanen akun yang masa tunggunya habis. Dipanggil berkala. */
export async function purgeDueAccounts(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, email FROM users
        WHERE deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= now() AND lower(email) <> $1
        FOR UPDATE`,
      [SUPER_ADMIN_EMAIL.toLowerCase()]
    );
    for (const u of rows) {
      // Kuis kustom milik pengguna tidak terhubung lewat FOREIGN KEY, jadi dibersihkan manual.
      await client.query('DELETE FROM decks WHERE is_custom IS TRUE AND lower(owner_email) = lower($1)', [u.email]);
      await client.query('DELETE FROM admin_emails WHERE lower(email) = lower($1)', [u.email]);
      // sessions, koleksi, donasi, token ikut terhapus lewat ON DELETE CASCADE. Riwayat pesanan sengaja dipertahankan.
      await client.query('DELETE FROM users WHERE id = $1', [u.id]);
      console.log(`[account] dihapus permanen: ${u.email}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[account] sapu penghapusan gagal:', err);
  } finally {
    client.release();
  }
}

export function startDeletionSweeper(pool: Pool) {
  setInterval(() => purgeDueAccounts(pool), 10 * 60 * 1000).unref();
  setTimeout(() => purgeDueAccounts(pool), 20 * 1000).unref();
}
