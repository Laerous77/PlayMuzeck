// server/donationGoalRoutes.ts
// Endpoint PUBLIK (tanpa login) untuk kartu donasi: total donasi bulan ini, jumlah donatur, sisa hari.
// Angka berasal dari tabel `donations` yang asli. Tidak ada data pribadi (email/nama) yang dikirim.
//
// Pasang di server/index.ts, setelah `pool` dibuat:
//   import { createDonationGoalRouter } from './donationGoalRoutes';
//   app.use(createDonationGoalRouter({ pool }));
//
// Atur target bulanan lewat env (Railway):  DONATION_GOAL_IDR=300000
// Kalau env tidak diisi / 0, kartu tetap tampil tetapi TANPA progress bar (tidak ada target palsu).
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type { Pool } from 'pg';

const TTL_MS = 60_000;
let cache: { at: number; body: unknown } | null = null;

export function createDonationGoalRouter({ pool }: { pool: Pool }): Router {
  const router = Router();
  const limiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false });

  router.get('/api/public/donation-goal', limiter, async (_req, res) => {
    try {
      if (cache && Date.now() - cache.at < TTL_MS) return res.json(cache.body);

      const goal = Math.max(0, Math.floor(Number(process.env.DONATION_GOAL_IDR || 0))) || 0;

      // Awal bulan menurut WIB, dikonversi ke UTC. Asumsi: created_at disimpan sebagai UTC
      // (default CURRENT_TIMESTAMP pada Postgres dengan timezone UTC, seperti di Railway).
      const { rows } = await pool.query(
        `WITH m AS (
           SELECT ((date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta')) AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'UTC' AS start_utc,
                  to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYY-MM') AS ym,
                  (date_trunc('month', now() AT TIME ZONE 'Asia/Jakarta') + interval '1 month')::date
                    - (now() AT TIME ZONE 'Asia/Jakarta')::date AS days_left
         )
         SELECT COALESCE(SUM(d.amount), 0)::bigint AS raised,
                COUNT(DISTINCT d.user_email)::int   AS donors,
                (SELECT ym FROM m)        AS ym,
                (SELECT days_left FROM m) AS days_left
           FROM donations d, m
          WHERE d.created_at >= m.start_utc`
      );
      const r = rows[0] || {};
      const body = {
        month: String(r.ym || ''),                 // "2026-10"
        goal,                                      // 0 = tidak ada target
        raised: Number(r.raised || 0),
        donors: Number(r.donors || 0),
        daysLeft: Math.max(0, Number(r.days_left || 0)),
      };
      cache = { at: Date.now(), body };
      res.set('Cache-Control', 'public, max-age=60');
      res.json(body);
    } catch (err) {
      console.error('[donation-goal]', err);
      res.status(500).json({ error: 'Gagal memuat data donasi.' });
    }
  });

  return router;
}
