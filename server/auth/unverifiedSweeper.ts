// server/auth/unverifiedSweeper.ts
// Menghapus akun daftar-manual yang tidak pernah memverifikasi email dalam 48 jam.
// Baris "hantu" dari alur pembayaran (tanpa password) dan akun yang punya pembelian/koleksi TIDAK disentuh.
import type { Pool } from 'pg';

const WHERE = `
  email_verified_at IS NULL AND google_sub IS NULL AND password_hash IS NOT NULL
  AND created_at < now() - interval '48 hours'
  AND NOT EXISTS (SELECT 1 FROM public.user_collections c WHERE c.user_email = users.email)
  AND NOT EXISTS (SELECT 1 FROM payment_orders p WHERE p.user_email = users.email)`;

export function startUnverifiedSweeper(pool: Pool) {
  const run = async () => {
    try {
      await pool.query(`DELETE FROM auth_tokens WHERE user_id IN (SELECT id FROM users WHERE ${WHERE})`);
      await pool.query(`DELETE FROM sessions    WHERE user_id IN (SELECT id FROM users WHERE ${WHERE})`);
      const r = await pool.query(`DELETE FROM users WHERE ${WHERE}`);
      if (r.rowCount) console.log(`[sweeper] ${r.rowCount} akun belum terverifikasi dihapus`);
    } catch (e) {
      console.error('[sweeper] pembersihan akun belum terverifikasi gagal:', e);
    }
  };
  setInterval(run, 6 * 60 * 60_000).unref();
  setTimeout(run, 30_000).unref();
}
