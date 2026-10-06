// server/toolQuotaRoutes.ts
// Rute kuota harian Audio Tools (disimpan di PostgreSQL). Pasang di server/index.ts:
//   import { createToolQuotaRouter, ensureToolQuotaSchema, startToolQuotaSweeper } from './toolQuotaRoutes';
//   .then(() => ensureToolQuotaSchema(pool))
//   app.use(createToolQuotaRouter({ db: pool, resolveEmail: softEmail }));
//   startToolQuotaSweeper(pool);
import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import type { Pool } from 'pg';
import {
  DAILY_FREE_QUOTA, ensureToolQuotaSchema, isQuotaTool, purgeOld, refund, remainingMap, reserve, serverDay,
} from './toolQuotaCore';

export { ensureToolQuotaSchema };

const DEVICE_COOKIE = 'pm_dev';
const USE_KEY_RE = /^[A-Za-z0-9:_|.\-]{1,120}$/;

interface Deps {
  db: Pool;
  /** Email akun yang sedang login (null = tamu). Tidak boleh melempar 401. */
  resolveEmail: (req: Request) => Promise<string | null>;
}

export function createToolQuotaRouter({ db, resolveEmail }: Deps): Router {
  const router = Router();

  /** Akun login -> per-email. Tamu -> per-perangkat (cookie httpOnly yang dibuat server). */
  const identityOf = async (req: Request, res: Response): Promise<string> => {
    const email = await resolveEmail(req).catch(() => null);
    if (email) return `u:${email.trim().toLowerCase()}`;
    let dev = String(req.cookies?.[DEVICE_COOKIE] ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(dev)) {
      dev = crypto.randomUUID();
      res.cookie(DEVICE_COOKIE, dev, {
        httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production',
        maxAge: 400 * 24 * 3600 * 1000, path: '/',
      });
    }
    return `g:${dev}`;
  };

  const fail = (res: Response, e: unknown) => {
    console.error('[tool-quota]', e);
    res.status(500).json({ error: 'Kuota tidak bisa diperiksa saat ini.' });
  };

  router.get('/api/tool-quota', async (req, res) => {
    try {
      const identity = await identityOf(req, res);
      const day = await serverDay(db);
      res.set('Cache-Control', 'no-store');
      res.json({ day, limit: DAILY_FREE_QUOTA, remaining: await remainingMap(db, identity, day) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/tool-quota/reserve', async (req, res) => {
    try {
      const { toolId, useKey } = req.body ?? {};
      if (!isQuotaTool(toolId)) return res.status(400).json({ error: 'Alat tidak dikenal.' });
      const key = typeof useKey === 'string' && USE_KEY_RE.test(useKey) ? useKey : crypto.randomUUID();
      const identity = await identityOf(req, res);
      res.set('Cache-Control', 'no-store');
      res.json(await reserve(db, identity, toolId, key));
    } catch (e) { fail(res, e); }
  });

  router.post('/api/tool-quota/refund', async (req, res) => {
    try {
      const { toolId, useKey } = req.body ?? {};
      if (!isQuotaTool(toolId) || typeof useKey !== 'string' || !USE_KEY_RE.test(useKey)) {
        return res.status(400).json({ error: 'Permintaan tidak valid.' });
      }
      const identity = await identityOf(req, res);
      res.set('Cache-Control', 'no-store');
      res.json({ ok: true, remaining: await refund(db, identity, toolId, useKey) });
    } catch (e) { fail(res, e); }
  });

  return router;
}

/** Bersihkan catatan lama saat start lalu tiap 6 jam. */
export function startToolQuotaSweeper(db: Pool) {
  const run = () => { purgeOld(db).catch((e) => console.error('[tool-quota] purge gagal:', e)); };
  run();
  const t = setInterval(run, 6 * 3600 * 1000);
  t.unref?.();
}
