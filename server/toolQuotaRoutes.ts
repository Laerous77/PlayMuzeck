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
  DAILY_FREE_QUOTA, QUOTA_TOOL_IDS, ensureToolQuotaSchema, isQuotaTool, purgeOld, refund, remainingMap, reserve, serverDay,
} from './toolQuotaCore';

export { ensureToolQuotaSchema };

/** Kolom identity di DB VARCHAR(160): email yang sangat panjang di-hash supaya INSERT tidak gagal. */
const MAX_IDENTITY = 160;
const USE_KEY_RE = /^[A-Za-z0-9:_|.\-]{1,120}$/;
interface Deps {
  db: Pool;
  /** Email akun yang sedang login (null = tamu). Tidak boleh melempar 401. */
  resolveEmail: (req: Request) => Promise<string | null>;
}

export function createToolQuotaRouter({ db, resolveEmail }: Deps): Router {
  const router = Router();

  // Pastikan tabel ada sebelum dipakai. Bila pembuatan saat boot gagal (DB belum siap), dicoba lagi pada permintaan berikutnya,
  // sehingga kuota tidak diam-diam jatuh ke penghitung memori di browser hanya karena DB telat hidup.
  let schemaReady: Promise<unknown> | null = null;
  const ready = () => {
    if (!schemaReady) schemaReady = ensureToolQuotaSchema(db).catch((e) => { schemaReady = null; throw e; });
    return schemaReady;
  };

  /** Jatah dicatat PER AKUN (email). Tamu tidak punya jatah: harus masuk dulu. Mengembalikan null untuk tamu. */
  const accountOf = async (req: Request): Promise<string | null> => {
    const email = await resolveEmail(req).catch(() => null);
    if (!email) return null;
    const id = `u:${email.trim().toLowerCase()}`;
    return id.length <= MAX_IDENTITY ? id : `u:h:${crypto.createHash('sha256').update(id).digest('hex')}`;
  };

  const fail = (res: Response, e: unknown) => {
    console.error('[tool-quota]', e);
    res.status(500).json({ error: 'Kuota tidak bisa diperiksa saat ini.' });
  };

  router.get('/api/tool-quota', async (req, res) => {
    try {
      await ready();
      const identity = await accountOf(req);
      const day = await serverDay(db);
      res.set('Cache-Control', 'no-store');
      if (!identity) {
        const none: Record<string, number> = {};
        for (const id of QUOTA_TOOL_IDS) none[id] = 0;
        return res.json({ day, limit: DAILY_FREE_QUOTA, loginRequired: true, remaining: none });
      }
      res.json({ day, limit: DAILY_FREE_QUOTA, remaining: await remainingMap(db, identity, day) });
    } catch (e) { fail(res, e); }
  });

  router.post('/api/tool-quota/reserve', async (req, res) => {
    try {
      const { toolId, useKey } = req.body ?? {};
      if (!isQuotaTool(toolId)) return res.status(400).json({ error: 'Alat tidak dikenal.' });
      const key = typeof useKey === 'string' && USE_KEY_RE.test(useKey) ? useKey : crypto.randomUUID();
      await ready();
      const identity = await accountOf(req);
      res.set('Cache-Control', 'no-store');
      if (!identity) return res.json({ allowed: false, remaining: 0, useKey: key, loginRequired: true });
      res.json(await reserve(db, identity, toolId, key));
    } catch (e) { fail(res, e); }
  });

  router.post('/api/tool-quota/refund', async (req, res) => {
    try {
      const { toolId, useKey } = req.body ?? {};
      if (!isQuotaTool(toolId) || typeof useKey !== 'string' || !USE_KEY_RE.test(useKey)) {
        return res.status(400).json({ error: 'Permintaan tidak valid.' });
      }
      await ready();
      const identity = await accountOf(req);
      res.set('Cache-Control', 'no-store');
      if (!identity) return res.json({ ok: true, remaining: 0 });
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
