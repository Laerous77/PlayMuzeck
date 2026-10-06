// server/adminOpsRoutes.ts
// Rute operasional admin untuk tab "Pesanan & User" (/admin#ops):
// 1. Pesanan pembayaran (payment_orders)
// 2. Daftar pembeli (buyers)
// 3. Permintaan Custom Audio & Pesan Masuk (inquiries)
// 4. Manajemen Pengguna (users) & Pengiriman Email Balasan ke Pengguna via Resend

import { Router, Request, Response, RequestHandler } from 'express';
import type { Pool, PoolClient } from 'pg';
import argon2 from 'argon2';
import { isDeliverableEmail } from './auth/emailCheck';
import crypto from 'crypto';
import { SUPER_ADMIN_EMAIL } from './db';
import { sendMailStrict } from './emailService';

interface DonationTier { min: number; frameId: string }

interface Deps {
  pool: Pool;
  requireAdmin: RequestHandler;
  requireSuperAdmin: RequestHandler;
  /** Tier bingkai donasi (sama dengan yang dipakai jalur donasi asli). Opsional: ada fallback bawaan. */
  getDonationTiers?: () => DonationTier[];
}

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
const MANUAL_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];
const INQUIRY_STATUSES = ['baru', 'proses', 'selesai'];
const USER_ROLES = ['user', 'admin'];

// ---------------------------------------------------------------------------
// Akses produk untuk pesanan yang diubah lewat admin
//
// Dulu admin hanya mengubah status/fulfilled di payment_orders. Akses sebenarnya hidup di
// user_collections (dan bingkai donasi + tabel donations), jadi pesanan "Berhasil" buatan
// admin tidak memberi akses apa pun, dan pesanan yang dibatalkan tidak mencabut apa pun.
//
// Di sini akses diturunkan dari pesanan lewat satu fungsi perencana (planOrder) yang dipakai
// untuk MEMBERI akses (paid) maupun MENCABUTNYA (paid -> status lain, atau pesanan dihapus).
// Mencabut selalu menyisakan item yang masih ditanggung pesanan lunas lain milik user yang sama.
// ---------------------------------------------------------------------------
const AUDIO_BUNDLE = ['fullMaster', 'loopVersion', 'separatedStems', 'sheetMusic', 'fullEditor8Bar', 'audioToolsSuite'];
const AUDIO_KEY_SET = new Set(AUDIO_BUNDLE);
const GLOBAL_AUDIO_KEYS = new Set(['fullEditor8Bar', 'audioToolsSuite']); // berlaku untuk semua lagu
const GLOBAL_ITEM_ID = 'global';
const AUDIO_KEY_ALIASES: Record<string, string> = {
  master: 'fullMaster', loop: 'loopVersion', stems: 'separatedStems', stem: 'separatedStems',
  sheet: 'sheetMusic', partitur: 'sheetMusic', editor: 'fullEditor8Bar', fullEditor: 'fullEditor8Bar',
  full16BarEditor: 'fullEditor8Bar', tools: 'audioToolsSuite', audioTools: 'audioToolsSuite',
};
const normalizeAudioKey = (k: unknown) => {
  const raw = String(k || '');
  return AUDIO_KEY_ALIASES[raw] || raw;
};
const stripProductSuffix = (id: string) =>
  id.replace(/[-_:](fullMaster|loopVersion|separatedStems|sheetMusic|fullEditor8Bar|audioToolsSuite|all|bundle)$/i, '');

const DEFAULT_DONATION_TIERS: DonationTier[] = [
  { min: 100000, frameId: 'frame-sultan' },
  { min: 50000, frameId: 'frame-warp' },
  { min: 25000, frameId: 'frame-neon' },
  { min: 10000, frameId: 'frame-coffee' },
];

/** Sama dengan resolveAudioKeys di jalur checkout, untuk item berbentuk keranjang. */
function resolveCartAudioKeys(item: any): string[] | null {
  for (const field of ['bundleKeys', 'productKeys', 'includedKeys', 'unownedKeys', 'includes', 'bundleItems']) {
    const list = item?.[field];
    if (Array.isArray(list)) {
      const keys = list
        .map((x: any) => normalizeAudioKey(typeof x === 'string' ? x : x?.itemTypeKey || x?.key))
        .filter((k: string) => AUDIO_KEY_SET.has(k));
      if (keys.length) return Array.from(new Set(keys));
    }
  }
  const raw = String(item?.itemTypeKey || '');
  const key = normalizeAudioKey(raw);
  if (AUDIO_KEY_SET.has(key)) return [key];
  const haystack = `${raw} ${item?.id || ''} ${item?.cartItemId || ''}`;
  if (raw === 'all' || /bundle|lengkap/i.test(haystack)) return AUDIO_BUNDLE;
  return null;
}

interface Grant { category: string; id: string; typeKey: string }
interface OrderRow { order_id: string; user_email: string; kind: string; gross_amount: any; items: any }
interface Plan { grants: Grant[]; donation: { amount: number } | null }

/** Kunci pembanding antar-pesanan. Editor/Audio Tools = per jenis (id lagu tidak relevan); deck/topik = per id. */
function grantKey(g: Grant): string {
  if (g.category === 'audio' && GLOBAL_AUDIO_KEYS.has(g.typeKey)) return `audio|*|${g.typeKey}`;
  if (g.category === 'quiz' || g.category === 'topic') return `${g.category}|${g.id}`;
  return `${g.category}|${g.id}|${g.typeKey}`;
}

const parseItems = (raw: any): any[] => {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const need = (v: unknown, what: string): string => {
  const s = String(v ?? '').trim();
  if (!s) throw new Error(`Data pesanan tidak lengkap: ${what} kosong.`);
  return s;
};

/** Susun daftar akses yang SEHARUSNYA dimiliki dari satu pesanan (tanpa menulis apa pun). */
async function planOrder(client: PoolClient, order: OrderRow, tiers: DonationTier[]): Promise<Plan> {
  const grants: Grant[] = [];
  let donation: Plan['donation'] = null;

  if (order.kind === 'donation') {
    const amount = Number(order.gross_amount) || 0;
    if (amount > 0) {
      donation = { amount };
      const tier = tiers.find((t) => amount >= t.min);
      if (tier) grants.push({ category: 'frame', id: tier.frameId, typeKey: 'donation' });
    }
    return { grants, donation };
  }

  const topicDecks = async (topicId: string) => {
    const { rows } = await client.query('SELECT id, badge FROM decks WHERE topic_id = $1', [topicId]);
    return rows.map((d: any) => {
      const b = typeof d.badge === 'string' ? d.badge.trim() : '';
      return { category: 'quiz', id: String(d.id), typeKey: b ? `theme:${b}` : 'quizDeck' } as Grant;
    });
  };

  for (const it of parseItems(order.items)) {
    if (!it) continue;

    // ---- pesanan manual dari form admin ----
    if (it.kind) {
      if (it.kind === 'audio') {
        const trackId = need(it.trackId, 'lagu');
        const keys: string[] = it.bundle ? AUDIO_BUNDLE : (it.keys || []).map(normalizeAudioKey).filter((k: string) => AUDIO_KEY_SET.has(k));
        if (!keys.length) throw new Error('Data pesanan tidak lengkap: jenis produk audio kosong.');
        for (const k of keys) {
          grants.push({ category: 'audio', id: GLOBAL_AUDIO_KEYS.has(k) ? GLOBAL_ITEM_ID : trackId, typeKey: k });
        }
      } else if (it.kind === 'editor8Bar') {
        grants.push({ category: 'audio', id: GLOBAL_ITEM_ID, typeKey: 'fullEditor8Bar' });
      } else if (it.kind === 'audioTools') {
        grants.push({ category: 'audio', id: GLOBAL_ITEM_ID, typeKey: 'audioToolsSuite' });
      } else if (it.kind === 'quizCreator') {
        grants.push({ category: 'feature', id: 'quiz-creator-suite', typeKey: 'quizCreatorSuite' });
      } else if (it.kind === 'deck') {
        grants.push({ category: 'quiz', id: need(it.deckId, 'deck'), typeKey: 'quizDeck' });
      } else if (it.kind === 'topic') {
        const topicId = need(it.topicId, 'topik');
        grants.push({ category: 'topic', id: topicId, typeKey: 'topic' }, ...(await topicDecks(topicId)));
      } else {
        throw new Error(`Jenis produk tidak dikenal: ${String(it.kind)}`);
      }
      continue;
    }

    // ---- item keranjang dari checkout asli (INV-MUZ-...) ----
    if (it.itemTypeKey === 'quizCreatorSuite' || /quiz.?(creator|editor)/i.test(String(it.id || ''))) {
      grants.push({ category: 'feature', id: 'quiz-creator-suite', typeKey: 'quizCreatorSuite' });
      continue;
    }
    const audioKeys = resolveCartAudioKeys(it);
    if (it.category === 'audio' || audioKeys) {
      if (!audioKeys) throw new Error(`Produk audio tidak dikenali (itemTypeKey="${it.itemTypeKey ?? ''}", id="${it.id ?? ''}").`);
      const trackId = stripProductSuffix(String(it.trackId || it.id));
      for (const k of audioKeys) {
        grants.push({ category: 'audio', id: GLOBAL_AUDIO_KEYS.has(k) && !it.trackId && !it.id ? GLOBAL_ITEM_ID : trackId, typeKey: k });
      }
    } else if (it.category === 'deck') {
      const badge = typeof it.badge === 'string' ? it.badge.trim() : '';
      grants.push({ category: 'quiz', id: String(it.deckId || it.id), typeKey: badge ? `theme:${badge}` : 'quizDeck' });
    } else if (it.category === 'topic') {
      const topicId = String(it.topicId || it.id);
      grants.push({ category: 'topic', id: topicId, typeKey: 'topic' }, ...(await topicDecks(topicId)));
    } else if (it.category && it.id) {
      grants.push({ category: String(it.category), id: String(it.id), typeKey: String(it.itemTypeKey || '') });
    }
  }
  return { grants, donation };
}

/** Pakai email persis seperti di tabel users (foreign key peka huruf besar/kecil); buat barisnya bila belum ada. */
async function ensureUserEmail(client: PoolClient, email: string): Promise<string> {
  const found = await client.query('SELECT email FROM users WHERE lower(email) = lower($1) LIMIT 1', [email]);
  if (found.rows[0]) return String(found.rows[0].email);
  await client.query(
    `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
    [`usr_${crypto.randomUUID()}`, email, email.split('@')[0]]
  );
  return email;
}

/** MEMBERI akses dari pesanan (idempotent). Mengembalikan jumlah akses yang dicatat. */
async function grantOrderAccess(client: PoolClient, order: OrderRow, tiers: DonationTier[]): Promise<number> {
  const plan = await planOrder(client, order, tiers);
  const email = await ensureUserEmail(client, String(order.user_email).trim());

  for (const g of plan.grants) {
    await client.query(
      `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [email, g.category, g.id, g.typeKey]
    );
  }
  if (plan.donation) {
    // id sama dengan jalur donasi asli (don_<orderId>) supaya tidak pernah dobel.
    await client.query(
      `INSERT INTO donations (id, user_email, amount) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount`,
      [`don_${order.order_id}`, email, plan.donation.amount]
    );
  }
  return plan.grants.length + (plan.donation ? 1 : 0);
}

/**
 * MENCABUT akses yang diberikan pesanan ini, kecuali yang masih ditanggung pesanan lunas lain
 * milik user yang sama. Mengembalikan jumlah akses yang dicabut.
 */
async function revokeOrderAccess(client: PoolClient, order: OrderRow, tiers: DonationTier[]): Promise<number> {
  const plan = await planOrder(client, order, tiers);

  const others = await client.query(
    `SELECT order_id, user_email, kind, gross_amount, items FROM payment_orders
      WHERE lower(user_email) = lower($1) AND status = 'paid' AND order_id <> $2`,
    [order.user_email, order.order_id]
  );
  const covered = new Set<string>();
  for (const o of others.rows) {
    try {
      for (const g of (await planOrder(client, o, tiers)).grants) covered.add(grantKey(g));
    } catch (e) {
      // Pesanan lain yang datanya rusak tidak boleh menggagalkan pencabutan; anggap tidak menanggung apa pun.
      console.error('[admin] revoke: pesanan lain tidak terbaca:', o.order_id, e);
    }
  }

  let revoked = 0;
  for (const g of plan.grants) {
    if (covered.has(grantKey(g))) continue;
    let r;
    if (g.category === 'audio' && GLOBAL_AUDIO_KEYS.has(g.typeKey)) {
      r = await client.query(
        `DELETE FROM public.user_collections WHERE lower(user_email) = lower($1) AND item_category = 'audio' AND item_type_key = $2`,
        [order.user_email, g.typeKey]
      );
    } else if (g.category === 'quiz' || g.category === 'topic') {
      r = await client.query(
        `DELETE FROM public.user_collections WHERE lower(user_email) = lower($1) AND item_category = $2 AND item_id = $3`,
        [order.user_email, g.category, g.id]
      );
    } else {
      r = await client.query(
        `DELETE FROM public.user_collections
          WHERE lower(user_email) = lower($1) AND item_category = $2 AND item_id = $3 AND item_type_key = $4`,
        [order.user_email, g.category, g.id, g.typeKey]
      );
    }
    revoked += r.rowCount || 0;
  }
  if (plan.donation) {
    await client.query('DELETE FROM donations WHERE id = $1', [`don_${order.order_id}`]);
  }
  return revoked;
}

export function createAdminOpsRouter({ pool, requireAdmin, requireSuperAdmin, getDonationTiers }: Deps): Router {
  const router = Router();
  const tiers = (): DonationTier[] => (getDonationTiers ? getDonationTiers() : DEFAULT_DONATION_TIERS);

  // ============================================================
  // 1. PAYMENT ORDERS & BUYERS
  // ============================================================

  router.get('/api/admin/payment-orders', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT p.*, u.name AS customer_name FROM payment_orders p
         LEFT JOIN users u ON u.email = p.user_email ORDER BY p.created_at DESC LIMIT 1000`
      );
      res.json(
        rows.map((o) => ({
          order_id: o.order_id,
          user_email: o.user_email,
          customer_name: o.customer_name || o.user_email,
          kind: o.kind,
          gross_amount: Number(o.gross_amount),
          status: o.status,
          fulfilled: Boolean(o.fulfilled),
          created_at: o.created_at,
          expires_at: o.expires_at ?? null,
          cancelled_at: o.cancelled_at ?? null,
          cancel_reason: o.cancel_reason ?? null,
          items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items || [],
        }))
      );
    } catch (err) {
      console.error('[admin] payment-orders:', err);
      res.status(500).json({ error: 'Gagal memuat pesanan.' });
    }
  });

  router.get('/api/admin/buyers', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT p.user_email AS email,
                MAX(u.name) AS name,
                COUNT(*) FILTER (WHERE p.status = 'paid')      AS paid,
                COUNT(*) FILTER (WHERE p.status = 'failed')    AS failed,
                COUNT(*) FILTER (WHERE p.status = 'pending')   AS pending,
                COUNT(*) FILTER (WHERE p.status = 'cancelled') AS cancelled,
                COALESCE(SUM(p.gross_amount) FILTER (WHERE p.status = 'paid'), 0) AS spent,
                MAX(p.created_at) AS last_order,
                (SELECT COUNT(*) FROM public.user_collections c
                   WHERE c.user_email = p.user_email AND c.item_category <> 'frame') AS owned_items
         FROM payment_orders p LEFT JOIN users u ON u.email = p.user_email
         GROUP BY p.user_email ORDER BY MAX(p.created_at) DESC`
      );
      res.json(
        rows.map((r) => ({
          email: r.email,
          name: r.name || r.email.split('@')[0],
          paid: Number(r.paid),
          failed: Number(r.failed),
          pending: Number(r.pending),
          cancelled: Number(r.cancelled),
          spent: Number(r.spent),
          last_order: r.last_order,
          owned_items: Number(r.owned_items),
        }))
      );
    } catch (err) {
      console.error('[admin] buyers:', err);
      res.status(500).json({ error: 'Gagal memuat rekap pembeli.' });
    }
  });

  router.get('/api/admin/buyers/:email', requireAdmin, async (req: Request, res: Response) => {
    try {
      const email = String(req.params.email || '');
      const [orders, owned] = await Promise.all([
        pool.query('SELECT * FROM payment_orders WHERE user_email = $1 ORDER BY created_at DESC', [email]),
        pool.query(
          `SELECT c.item_category, c.item_id, c.item_type_key, c.purchased_at,
                  COALESCE(t.title, d.title, tp.title) AS title
           FROM public.user_collections c
           LEFT JOIN audio_tracks t ON c.item_category = 'audio' AND t.id = c.item_id
           LEFT JOIN decks d        ON c.item_category = 'quiz'  AND d.id = c.item_id
           LEFT JOIN topics tp      ON c.item_category = 'topic' AND tp.id = c.item_id
           WHERE c.user_email = $1 AND c.item_category <> 'frame'
           ORDER BY c.purchased_at DESC`,
          [email]
        ),
      ]);
      res.json({
        orders: orders.rows.map((o) => ({
          order_id: o.order_id,
          user_email: o.user_email,
          customer_name: email.split('@')[0],
          kind: o.kind,
          gross_amount: Number(o.gross_amount),
          status: o.status,
          fulfilled: Boolean(o.fulfilled),
          created_at: o.created_at,
          items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items || [],
        })),
        owned: owned.rows.map((r) => ({
          category: r.item_category,
          id: r.item_id,
          type_key: r.item_type_key,
          title: r.title || r.item_id,
          purchased_at: r.purchased_at,
        })),
      });
    } catch (err) {
      console.error('[admin] buyer detail:', err);
      res.status(500).json({ error: 'Gagal memuat detail pembeli.' });
    }
  });

  router.get('/api/admin/product-catalog', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const [tr, dk, tp] = await Promise.all([
        pool.query('SELECT id, title, artist, price FROM audio_tracks ORDER BY title'),
        pool.query(`SELECT id, topic_id, title, price, badge, is_free FROM decks WHERE COALESCE(is_custom, FALSE) = FALSE ORDER BY title`),
        pool.query('SELECT id, title, price, badge FROM topics ORDER BY title'),
      ]);
      res.json({
        tracks: tr.rows.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          products: {
            fullMaster: Math.max(5000, Math.round((Number(t.price || 70000) * 0.25) / 1000) * 1000),
            loopVersion: Math.max(5000, Math.round((Number(t.price || 70000) * 0.15) / 1000) * 1000),
            separatedStems: Math.max(5000, Math.round((Number(t.price || 70000) * 0.4) / 1000) * 1000),
            sheetMusic: Math.max(5000, Math.round((Number(t.price || 70000) * 0.2) / 1000) * 1000),
          },
          bundle: Math.max(50000, Number(t.price || 70000) - 25000),
        })),
        decks: dk.rows.map((d) => ({ ...d, price: Number(d.price) || 0 })),
        topics: tp.rows.map((t) => ({ ...t, price: Number(t.price) || 0 })),
        features: {
          editor8Bar: 15000,
          audioTools: 20000,
          quizCreator: 10000,
        },
      });
    } catch (err) {
      console.error('[admin] product-catalog:', err);
      res.status(500).json({ error: 'Gagal memuat katalog produk.' });
    }
  });

  router.post('/api/admin/payment-orders', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    const { user_email, kind, status, gross_amount, items } = req.body || {};
    const email = String(user_email || '').trim().toLowerCase();
    if (!isValidEmail(email)) return res.status(400).json({ error: 'Email pengguna tidak valid.' });
    const finalStatus = status || 'paid';
    if (!MANUAL_STATUSES.includes(finalStatus)) return res.status(400).json({ error: 'Status tidak valid.' });
    const finalKind = kind || 'cart';
    if (finalKind !== 'cart' && finalKind !== 'donation') return res.status(400).json({ error: 'Jenis pesanan tidak valid.' });
    const amount = Number(gross_amount) || 0;
    if (finalKind === 'donation' && amount <= 0) return res.status(400).json({ error: 'Nominal donasi harus lebih dari 0.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderId = `man_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const storedItems = finalKind === 'cart' ? items || [] : [];
      await client.query(
        `INSERT INTO payment_orders (order_id, user_email, kind, gross_amount, items, status, fulfilled)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [orderId, email, finalKind, amount, JSON.stringify(storedItems), finalStatus, finalStatus === 'paid']
      );
      // "paid" = akses benar-benar diberikan (produk, atau bingkai + catatan donasi), bukan cuma label.
      let granted = 0;
      if (finalStatus === 'paid') {
        granted = await grantOrderAccess(
          client,
          { order_id: orderId, user_email: email, kind: finalKind, gross_amount: amount, items: storedItems },
          tiers()
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ success: true, order_id: orderId, granted });
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* abaikan */ }
      console.error('[admin] buat pesanan manual:', err);
      res.status(500).json({ error: err?.message || 'Gagal membuat pesanan.' });
    } finally {
      client.release();
    }
  });

  router.patch('/api/admin/payment-orders/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    const { status, gross_amount } = req.body || {};
    // PERBAIKAN: admin bisa memilih "ubah status TANPA mencabut akses" di panel, tetapi server dulu selalu
    // mencabut. Default tetap mencabut (perilaku lama) kecuali klien mengirim revoke:false.
    const doRevoke = req.body?.revoke !== false;
    if (status !== undefined && !MANUAL_STATUSES.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
    if (status === undefined && gross_amount === undefined) return res.status(400).json({ error: 'Tidak ada perubahan.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Kunci baris supaya dua perubahan status serentak tidak saling menimpa akses.
      const cur = await client.query('SELECT * FROM payment_orders WHERE order_id = $1 FOR UPDATE', [req.params.id]);
      const before = cur.rows[0];
      if (!before) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Pesanan tidak ditemukan.' });
      }

      const sets: string[] = [];
      const vals: any[] = [];
      if (status !== undefined) {
        vals.push(status);
        sets.push(`status = $${vals.length}`);
        // fulfilled hanya TRUE untuk pesanan lunas; status lain berarti akses tidak (lagi) diberikan.
        sets.push(`fulfilled = ${status === 'paid' ? 'TRUE' : 'FALSE'}`);
      }
      if (gross_amount !== undefined) {
        vals.push(Number(gross_amount) || 0);
        sets.push(`gross_amount = $${vals.length}`);
      }
      vals.push(req.params.id);
      await client.query(`UPDATE payment_orders SET ${sets.join(', ')} WHERE order_id = $${vals.length}`, vals);

      const after = { ...before, status: status ?? before.status, gross_amount: gross_amount !== undefined ? Number(gross_amount) || 0 : before.gross_amount };
      const wasPaid = before.status === 'paid';
      const isPaid = after.status === 'paid';
      const donationAmountChanged = before.kind === 'donation' && Number(before.gross_amount) !== Number(after.gross_amount);

      let granted = 0;
      let revoked = 0;
      if (doRevoke && wasPaid && (!isPaid || donationAmountChanged)) {
        // Lunas -> status lain (atau nominal donasi berubah, mungkin pindah tier): cabut dulu yang lama.
        revoked = await revokeOrderAccess(client, before, tiers());
      }
      // Memilih "Berhasil" lagi pada pesanan yang sudah lunas juga memastikan aksesnya lengkap
      // (idempotent): ini cara memperbaiki pesanan lama yang tercatat lunas tapi aksesnya tak pernah masuk.
      if (isPaid && (!wasPaid || donationAmountChanged || status === 'paid')) {
        granted = await grantOrderAccess(client, after, tiers());
      }

      await client.query('COMMIT');
      res.json({ success: true, granted, revoked });
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* abaikan */ }
      console.error('[admin] ubah pesanan:', err);
      res.status(500).json({ error: err?.message || 'Gagal memperbarui pesanan.' });
    } finally {
      client.release();
    }
  });

  router.delete('/api/admin/payment-orders/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cur = await client.query('SELECT * FROM payment_orders WHERE order_id = $1 FOR UPDATE', [req.params.id]);
      const order = cur.rows[0];
      let revoked = 0;
      // PERBAIKAN: panel mengirim ?revoke=0|1 ("hapus pesanan saja, akses tetap" vs "cabut juga akses"),
      // tetapi server dulu mengabaikannya dan SELALU mencabut akses pesanan lunas. Tanpa parameter = mencabut.
      const doRevoke = req.query.revoke === undefined ? true : ['1', 'true'].includes(String(req.query.revoke));
      // Menghapus pesanan lunas = akses dari pesanan itu ikut dicabut (kecuali ditanggung pesanan lunas lain).
      if (order && order.status === 'paid' && doRevoke) revoked = await revokeOrderAccess(client, order, tiers());
      await client.query('DELETE FROM payment_orders WHERE order_id = $1', [req.params.id]);
      await client.query('COMMIT');
      res.json({ success: true, revoked });
    } catch (err: any) {
      try { await client.query('ROLLBACK'); } catch { /* abaikan */ }
      console.error('[admin] hapus pesanan:', err);
      res.status(500).json({ error: err?.message || 'Gagal menghapus pesanan.' });
    } finally {
      client.release();
    }
  });

  // ============================================================
  // 2. INQUIRIES (CUSTOM AUDIO & HUBUNGI KAMI)
  // ============================================================

  router.get('/api/admin/inquiries', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query('SELECT * FROM inquiries ORDER BY created_at DESC');
      res.json(rows);
    } catch (err) {
      console.error('[admin] inquiries:', err);
      res.status(500).json({ error: 'Gagal memuat permintaan.' });
    }
  });

  router.post('/api/admin/inquiries', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const b = req.body || {};
      const status = INQUIRY_STATUSES.includes(b.status) ? b.status : 'baru';
      const title = String(b.title || '').trim();
      if (!title) return res.status(400).json({ error: 'Judul wajib diisi.' });
      const id = `inq_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      await pool.query(
        `INSERT INTO inquiries (id, title, email, genre, mood, status, notes) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, title.slice(0, 255), String(b.email || '').trim().slice(0, 255), String(b.genre || '').slice(0, 100), String(b.mood || '').slice(0, 100), status, String(b.notes || '')]
      );
      res.status(201).json({ success: true, id });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal membuat permintaan.' });
    }
  });

  router.patch('/api/admin/inquiries/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const b = req.body || {};
      const cols: Array<[string, string, number]> = [
        ['status', 'status', 50],
        ['title', 'title', 255],
        ['email', 'email', 255],
        ['genre', 'genre', 100],
        ['mood', 'mood', 100],
        ['notes', 'notes', 20000],
      ];
      const sets: string[] = [];
      const vals: any[] = [];
      for (const [key, col, max] of cols) {
        if (b[key] !== undefined) {
          vals.push(String(b[key]).slice(0, max));
          sets.push(`${col} = $${vals.length}`);
        }
      }
      if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });
      vals.push(req.params.id);
      const r = await pool.query(`UPDATE inquiries SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      if (!r.rowCount) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal memperbarui permintaan.' });
    }
  });

  router.delete('/api/admin/inquiries/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const r = await pool.query('DELETE FROM inquiries WHERE id = $1', [req.params.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal menghapus permintaan.' });
    }
  });

  // ============================================================
  // 3. USERS & BALASAN EMAIL ADMIN VIA RESEND
  // ============================================================

  router.get('/api/admin/users', requireAdmin, async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.name, u.role, u.active_frame_id, u.created_at, u.last_seen,
                u.bio, u.greeting, left(md5(u.avatar_url), 8) AS avatar_v,
                u.suspended_at, u.suspended_reason, u.email_verified_at,
                u.deletion_scheduled_at, u.deletion_requested_by,
                (u.password_hash IS NOT NULL) AS has_password,
                (u.google_sub IS NOT NULL) AS has_google,
                (SELECT COUNT(*) FROM public.user_collections c WHERE c.user_email = u.email AND c.item_category <> 'frame')::int AS owned_items,
                (SELECT COUNT(*) FROM payment_orders p WHERE p.user_email = u.email AND p.status = 'paid')::int AS paid_orders
         FROM users u ORDER BY u.created_at DESC`
      );
      res.json(
        rows.map(({ avatar_v, ...u }) => ({
          ...u,
          bio: u.bio || '',
          greeting: u.greeting || '',
          avatar_url: avatar_v ? `/api/avatar/${u.id}?v=${avatar_v}` : '',
          last_seen: u.last_seen || u.created_at,
          is_super_admin: String(u.email).toLowerCase() === SUPER_ADMIN_EMAIL,
        }))
      );
    } catch (err) {
      console.error('[admin] users:', err);
      res.status(500).json({ error: 'Gagal memuat pengguna.' });
    }
  });

  router.post('/api/admin/users', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { email, name, role, password } = req.body || {};
      const cleanEmail = String(email || '').trim().toLowerCase();
      if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Alamat email tidak valid.' });
      if (!(await isDeliverableEmail(cleanEmail))) return res.status(400).json({ error: 'Domain email ini tidak bisa menerima pesan.' });
      // PERBAIKAN: minimal 8 karakter (dulu 4) dan maksimal 72 byte (batas bcrypt), selaras dengan pendaftaran biasa.
      if (password && (String(password).length < 8 || Buffer.byteLength(String(password)) > 72)) {
        return res.status(400).json({ error: 'Kata sandi 8-72 karakter.' });
      }
      const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [cleanEmail]);
      if (exists.rows.length) return res.status(409).json({ error: 'Email ini sudah terdaftar.' });
      const hash = password ? await argon2.hash(String(password), { type: argon2.argon2id }) : null;
      const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      await pool.query(
        `INSERT INTO users (id, email, name, role, password_hash, last_seen, email_verified_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())`,
        [id, cleanEmail, String(name || '').trim().slice(0, 255) || cleanEmail.split('@')[0], USER_ROLES.includes(role) ? role : 'user', hash]
      );
      res.status(201).json({ success: true, id });
    } catch (err: any) {
      console.error('[admin] create user:', err);
      res.status(500).json({ error: err?.message || 'Gagal membuat pengguna.' });
    }
  });

  router.patch('/api/admin/users/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const { name, role, password, bio, greeting, removeAvatar } = req.body || {};
      const cleanProfileText = (v: unknown, max: number) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
      const sets: string[] = [];
      const vals: any[] = [];
      if (name !== undefined) {
        const cleanName = cleanProfileText(name, 60);
        if (!cleanName) return res.status(400).json({ error: 'Nama tidak boleh kosong.' });
        vals.push(cleanName);
        sets.push(`name = $${vals.length}`);
      }
      if (bio !== undefined) {
        vals.push(cleanProfileText(bio, 160) || null);
        sets.push(`bio = $${vals.length}`);
      }
      if (greeting !== undefined) {
        vals.push(cleanProfileText(greeting, 80) || null);
        sets.push(`greeting = $${vals.length}`);
      }
      if (removeAvatar === true) sets.push('avatar_url = NULL');
      if (role !== undefined && USER_ROLES.includes(role)) {
        vals.push(role);
        sets.push(`role = $${vals.length}`);
      }
      if (password) {
        // PERBAIKAN: PATCH dulu tidak memvalidasi sandi sama sekali (sandi 1 huruf pun diterima).
        if (String(password).length < 8 || Buffer.byteLength(String(password)) > 72) {
          return res.status(400).json({ error: 'Kata sandi 8-72 karakter.' });
        }
        vals.push(await argon2.hash(String(password), { type: argon2.argon2id }));
        sets.push(`password_hash = $${vals.length}`);
        // Ganti sandi = reset hitungan gagal login & kunci akun.
        sets.push('failed_logins = 0', 'locked_until = NULL');
      }
      if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });
      vals.push(req.params.id);
      const r = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      if (!r.rowCount) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      // Sandi diganti oleh admin -> semua sesi lama pengguna itu dicabut (orang yang memegang sesi lama keluar).
      if (password) await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal memperbarui pengguna.' });
    }
  });

  router.delete('/api/admin/users/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const found = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
      if (!found.rows[0]) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      if (String(found.rows[0].email).toLowerCase() === SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Akun Super Admin tidak bisa dihapus.' });
      await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal menghapus pengguna.' });
    }
  });

  router.post('/api/admin/users/:id/suspend', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      const found = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
      if (!found.rows[0]) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      if (String(found.rows[0].email).toLowerCase() === SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Akun Super Admin tidak bisa ditangguhkan.' });

      await pool.query(`UPDATE users SET suspended_at = NOW(), suspended_reason = $2 WHERE id = $1`, [req.params.id, reason || null]);
      await pool.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal menangguhkan akun.' });
    }
  });

  router.post('/api/admin/users/:id/restore', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const r = await pool.query(`UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = $1`, [req.params.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal mengaktifkan kembali akun.' });
    }
  });

  // Kirim email balasan/pesan langsung dari Admin ke Pengguna via Resend SDK
  router.post('/api/admin/users/:id/email', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    const subject = String(req.body?.subject || '').trim().slice(0, 200);
    const message = String(req.body?.message || '').trim().slice(0, 5000);
    if (!subject || !message) return res.status(400).json({ error: 'Subjek dan isi pesan wajib diisi.' });

    try {
      const found = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.params.id]);
      const user = found.rows[0];
      if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

      // Kirim email menggunakan Resend
      await sendMailStrict(user.email, subject, message);

      await pool.query('INSERT INTO analytics_events (id, event_type, payload) VALUES ($1, $2, $3)', [
        `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        'admin_email',
        JSON.stringify({ to: user.email, subject, by: (req as any).adminEmail || 'server-admin' }),
      ]);

      res.json({ success: true });
    } catch (err: any) {
      console.error('[admin] email user via Resend error:', err);
      res.status(500).json({ error: err?.message || 'Gagal mengirim email balasan.' });
    }
  });

  return router;
}
