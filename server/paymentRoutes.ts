// server/paymentRoutes.ts
// Pembayaran Midtrans (server-side), dipulihkan dari server/index.ts versi sebelum commit 943b335 ("email update").
//
// Alur: klien -> POST /api/payment/charge (server hitung harga sendiri, buat pesanan 'pending', minta Snap token)
//       -> bayar di Snap -> POST /api/user/checkout | /api/user/donate dengan invoiceId / orderId.
// Server MEMVERIFIKASI status pesanan langsung ke Midtrans sebelum memberi kepemilikan.
// Webhook POST /api/payment/notification ikut memperbarui status.
//
// CATATAN PENTING: variabel env dibaca di DALAM createPaymentRouter(), bukan di level modul, karena
// import ES Module dievaluasi SEBELUM dotenv.config() di index.ts dijalankan.

import express from 'express';
import crypto from 'crypto';

type CollectionRef = { category: string; id: string; typeKey: string };
type AudioOwn = Record<
  'fullMaster' | 'loopVersion' | 'separatedStems' | 'sheetMusic' | 'fullEditor8Bar' | 'audioToolsSuite',
  boolean
>;
type PayCheck = { ok: boolean; status?: number; error?: string; order?: any };

class CheckoutError extends Error {}

export interface PaymentDeps {
  pool: any;
  requireUser: express.RequestHandler;
  resolveAudioKeys: (item: any) => string[] | null;
  stripProductSuffix: (id: string) => string;
  /** Fungsi (bukan nilai) supaya aman dipanggil walau konstanta aslinya didefinisikan lebih bawah di index.ts. */
  getDonationTiers: () => { min: number; frameId: string }[];
}

const CREATOR_SUITE_PRICE = 10000; // harga otoritatif Kreator Kuis & Topik Suite (server yang menentukan)
const DEFAULT_DECK_PRICE = 3000;

// ---- Harga audio di server: cerminan src/services/pricing.ts (harus dijaga tetap sama) ----
function calcAudioPricing(basePrice: number, own: AudioOwn) {
  const FIXED_EDITOR = 15000;
  const FIXED_TOOLS = 20000;
  const base = Math.max(70000, Math.round(Number(basePrice || 70000) / 1000) * 1000);
  const poolAmt = base - FIXED_EDITOR - FIXED_TOOLS;
  const pMaster = Math.max(5000, Math.round((poolAmt * (9 / 35)) / 1000) * 1000);
  const pLoop = Math.max(5000, Math.round((poolAmt * (5 / 35)) / 1000) * 1000);
  const pSheet = Math.max(5000, Math.round((poolAmt * (7 / 35)) / 1000) * 1000);
  let pStems = Math.max(5000, Math.round((poolAmt * (14 / 35)) / 1000) * 1000);
  pStems += poolAmt - (pMaster + pLoop + pSheet + pStems);

  const products: Record<keyof AudioOwn, number> = {
    fullMaster: pMaster,
    loopVersion: pLoop,
    separatedStems: pStems,
    sheetMusic: pSheet,
    fullEditor8Bar: FIXED_EDITOR,
    audioToolsSuite: FIXED_TOOLS,
  };
  const unowned = (Object.keys(products) as (keyof AudioOwn)[]).filter((k) => !own[k]);
  if (!unowned.length) return { products, bundle: 0 };

  const totalUnowned = unowned.reduce((sum, k) => sum + products[k], 0);
  let discount = 10000;
  if (!own.fullEditor8Bar) discount += 10000;
  if (!own.audioToolsSuite) discount += 5000;
  const floorPrice = Math.min(5000, totalUnowned);
  const bundle = Math.max(floorPrice, Math.round((totalUnowned - Math.min(discount, totalUnowned)) / 1000) * 1000);
  return { products, bundle };
}

export function createPaymentRouter(deps: PaymentDeps): express.Router {
  const { pool, requireUser, resolveAudioKeys, stripProductSuffix, getDonationTiers } = deps;
  const router = express.Router();

  // ---------- Konfigurasi (dibaca SEKARANG, setelah dotenv dimuat) ----------
  const SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
  const CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
  const PROD = process.env.MIDTRANS_IS_PRODUCTION === 'true';
  const SNAP_URL = PROD
    ? 'https://app.midtrans.com/snap/v1/transactions'
    : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
  const SNAP_JS_URL = PROD ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js';
  const API_URL = PROD ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
  const TTL_MIN = Math.max(5, Number(process.env.PENDING_ORDER_TTL_MIN) || 1440);

  // Mode demo (checkout TANPA bayar) hanya menyala bila ALLOW_UNPAID_CHECKOUT=true DAN bukan production.
  // Dulu mode demo menyala otomatis bila kunci Midtrans kosong; itu yang membuat checkout bisa gratis.
  const ALLOW_UNPAID = process.env.ALLOW_UNPAID_CHECKOUT === 'true' && process.env.NODE_ENV !== 'production';
  if (process.env.ALLOW_UNPAID_CHECKOUT === 'true' && process.env.NODE_ENV === 'production') {
    console.warn('[SECURITY] ALLOW_UNPAID_CHECKOUT=true DIABAIKAN karena NODE_ENV=production.');
  }
  if (ALLOW_UNPAID) console.warn('[SECURITY] MODE DEMO: checkout & donasi TANPA verifikasi pembayaran. Jangan dipakai di server publik.');
  const configured = Boolean(SERVER_KEY && CLIENT_KEY);
  console.log(
    `[payment] mode: ${
      ALLOW_UNPAID ? 'DEMO (tanpa bayar)' : configured ? (PROD ? 'PRODUKSI' : 'SANDBOX') : 'BELUM SIAP (isi MIDTRANS_SERVER_KEY & MIDTRANS_CLIENT_KEY)'
    }`
  );

  const midtransAuth = () => 'Basic ' + Buffer.from(`${SERVER_KEY}:`).toString('base64');
  const ORDER_ID_RE = /^[A-Za-z0-9_-]{6,60}$/;

  // ---------- Helper kepemilikan & harga ----------
  async function collectionRefsForItems(db: { query: (q: string, p?: any[]) => Promise<any> }, items: any[]): Promise<CollectionRef[]> {
    const refs: CollectionRef[] = [];
    for (const item of items || []) {
      if (item?.category === 'donation') continue;
      if (item.itemTypeKey === 'quizCreatorSuite' || /quiz.?(creator|editor)/i.test(String(item.id || ''))) {
        refs.push({ category: 'feature', id: 'quiz-creator-suite', typeKey: 'quizCreatorSuite' });
        continue;
      }
      const audioKeys = resolveAudioKeys(item);
      if (item.category === 'audio' || audioKeys) {
        if (!audioKeys) throw new CheckoutError(`Produk audio tidak dikenali (itemTypeKey="${item.itemTypeKey ?? ''}", id="${item.id ?? ''}").`);
        const trackId = stripProductSuffix(String(item.trackId || item.id));
        for (const k of audioKeys) refs.push({ category: 'audio', id: trackId, typeKey: k });
      } else if (item.category === 'deck') {
        const badge = typeof item.badge === 'string' ? item.badge.trim() : '';
        refs.push({ category: 'quiz', id: String(item.deckId || item.id), typeKey: badge ? `theme:${badge}` : 'quizDeck' });
      } else if (item.category === 'topic') {
        const topicId = String(item.topicId || item.id);
        refs.push({ category: 'topic', id: topicId, typeKey: 'topic' });
        const { rows } = await db.query('SELECT id, badge FROM decks WHERE topic_id = $1', [topicId]);
        for (const d of rows) {
          const b = typeof d.badge === 'string' ? d.badge.trim() : '';
          refs.push({ category: 'quiz', id: d.id, typeKey: b ? `theme:${b}` : 'quizDeck' });
        }
      } else if (item.category && item.id) {
        refs.push({ category: String(item.category), id: String(item.id), typeKey: String(item.itemTypeKey || '') });
      }
    }
    return refs;
  }

  async function audioOwnership(email: string, trackId: string): Promise<AudioOwn> {
    const own: AudioOwn = { fullMaster: false, loopVersion: false, separatedStems: false, sheetMusic: false, fullEditor8Bar: false, audioToolsSuite: false };
    const { rows } = await pool.query(
      `SELECT item_id, item_type_key FROM public.user_collections WHERE user_email = $1 AND item_category = 'audio'`,
      [email]
    );
    for (const r of rows) {
      const k = String(r.item_type_key);
      if (k === 'all') { own.fullEditor8Bar = true; own.audioToolsSuite = true; }
      if (k === 'fullEditor8Bar' || k === 'audioToolsSuite') own[k] = true;
      if (String(r.item_id) === trackId) {
        if (k === 'all') { own.fullMaster = own.loopVersion = own.separatedStems = own.sheetMusic = true; }
        else if (k in own) own[k as keyof AudioOwn] = true;
      }
    }
    return own;
  }

  /** Harga otoritatif satu item keranjang. Melempar CheckoutError bila item tidak dikenali. */
  async function serverItemPrice(item: any, email: string): Promise<number> {
    if (item.itemTypeKey === 'quizCreatorSuite' || /quiz.?(creator|editor)/i.test(String(item.id || ''))) {
      return CREATOR_SUITE_PRICE;
    }
    const audioKeys = resolveAudioKeys(item);
    if (item.category === 'audio' || audioKeys) {
      if (!audioKeys) throw new CheckoutError(`Produk audio tidak dikenali (${item.title || item.id}).`);
      const trackId = stripProductSuffix(String(item.trackId || item.id));
      const t = await pool.query('SELECT price FROM audio_tracks WHERE id = $1', [trackId]);
      if (!t.rows.length) throw new CheckoutError('Trek audio tidak ditemukan.');
      const calc = calcAudioPricing(Number(t.rows[0].price) || 70000, await audioOwnership(email, trackId));
      if (audioKeys.length > 1) return calc.bundle;
      const price = calc.products[audioKeys[0] as keyof AudioOwn];
      if (price === undefined) throw new CheckoutError('Produk audio tidak dikenali.');
      return price;
    }
    if (item.category === 'deck') {
      const r = await pool.query('SELECT price FROM decks WHERE id = $1', [item.deckId || item.id]);
      return r.rows.length ? Math.max(0, Math.round(Number(r.rows[0].price) || 0)) : DEFAULT_DECK_PRICE;
    }
    if (item.category === 'topic') {
      const r = await pool.query('SELECT price FROM topics WHERE id = $1', [item.topicId || item.id]);
      // Topik bawaan statis tidak ada di DB -> terpaksa memakai harga dari keranjang (pindahkan ke DB agar aman).
      return r.rows.length ? Math.max(0, Math.round(Number(r.rows[0].price) || 0)) : Math.max(0, Math.round(Number(item.price) || 0));
    }
    throw new CheckoutError(`Kategori item tidak dikenali (${item.category}).`);
  }

  // Beli sekali = akses langsung terbuka. Item yang sudah dimiliki (atau dobel di keranjang) ditolak sebelum bayar.
  async function assertNotOwned(email: string, items: any[]): Promise<void> {
    const seen = new Set<string>();
    for (const item of items) {
      if (!item || item.category === 'donation') continue;
      const label = String(item.title || item.name || item.id || 'Produk');
      const refs = await collectionRefsForItems(pool, [item]);
      if (!refs.length) continue;

      const key = refs.map((r) => `${r.category}:${r.id}:${r.typeKey}`).sort().join('|');
      if (seen.has(key)) throw new CheckoutError(`"${label}" ada lebih dari satu di keranjang. Hapus yang dobel.`);
      seen.add(key);

      const { rows } = await pool.query(
        `SELECT item_category, item_id, item_type_key FROM public.user_collections
          WHERE lower(user_email) = lower($1) AND item_id = ANY($2::text[])`,
        [email, refs.map((r) => r.id)]
      );
      const looseCats = new Set(['quiz', 'topic', 'feature']);
      const owns = (r: CollectionRef) =>
        rows.some(
          (o: any) =>
            o.item_category === r.category &&
            o.item_id === r.id &&
            (looseCats.has(r.category) || String(o.item_type_key || '') === r.typeKey)
        );
      if (refs.every(owns)) {
        throw new CheckoutError(`Kamu sudah memiliki "${label}". Akses produk ini sudah terbuka, jadi tidak perlu dibeli lagi.`);
      }
    }
  }

  // ---------- Midtrans ----------
  /** Tanya status resmi ke Midtrans lalu simpan ke tabel (status 'paid' tidak pernah diturunkan). */
  async function refreshPaymentStatus(orderId: string) {
    if (!SERVER_KEY) return;
    const r = await fetch(`${API_URL}/v2/${encodeURIComponent(orderId)}/status`, {
      headers: { Accept: 'application/json', Authorization: midtransAuth() },
    });
    const d: any = await r.json().catch(() => null);
    if (!d?.transaction_status) return;
    const { rows } = await pool.query('SELECT gross_amount, status FROM payment_orders WHERE order_id = $1', [orderId]);
    const order = rows[0];
    if (!order || order.status === 'paid') return;
    const amountOk = Number(d.gross_amount) === Number(order.gross_amount);
    const paid = amountOk && (d.transaction_status === 'settlement' || (d.transaction_status === 'capture' && d.fraud_status === 'accept'));
    if (order.status === 'cancelled' && !paid) return; // sudah dibatalkan: jangan dihidupkan lagi
    const cancelled = ['cancel', 'expire'].includes(d.transaction_status);
    const failed = ['deny', 'failure'].includes(d.transaction_status);
    const status = paid ? 'paid' : cancelled ? 'cancelled' : failed ? 'failed' : 'pending';
    if (status === order.status) return;
    if (status === 'cancelled') {
      await pool.query(
        `UPDATE payment_orders SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW()),
           cancel_reason = COALESCE(cancel_reason, 'dibatalkan / kedaluwarsa di Midtrans'), snap_token = NULL WHERE order_id = $1`,
        [orderId]
      );
    } else {
      await pool.query('UPDATE payment_orders SET status = $1 WHERE order_id = $2', [status, orderId]);
    }
  }

  /** Batalkan transaksi di Midtrans (best-effort) supaya tidak bisa dibayar belakangan. */
  async function midtransCancel(orderId: string) {
    if (!SERVER_KEY) return;
    try {
      await fetch(`${API_URL}/v2/${encodeURIComponent(orderId)}/cancel`, {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: midtransAuth() },
      });
    } catch { /* Midtrans tidak terjangkau: status lokal tetap dibatalkan */ }
  }

  /** Ubah pesanan 'pending' jadi 'cancelled'. `email` null = dipanggil sistem (sapuan kedaluwarsa). */
  async function cancelOrder(orderId: string, email: string | null, reason: string): Promise<boolean> {
    const { rows } = await pool.query('SELECT user_email, status, fulfilled FROM payment_orders WHERE order_id = $1', [orderId]);
    const o = rows[0];
    if (!o) return false;
    if (email && o.user_email !== email) return false;
    if (o.status !== 'pending' || o.fulfilled) return false;
    if (SERVER_KEY) {
      try { await refreshPaymentStatus(orderId); } catch { /* lanjut */ }
      const again = await pool.query('SELECT status FROM payment_orders WHERE order_id = $1', [orderId]);
      if (!again.rows[0] || again.rows[0].status !== 'pending') return false; // ternyata sudah lunas / gagal / dibatalkan
      await midtransCancel(orderId);
    }
    const upd = await pool.query(
      `UPDATE payment_orders SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, snap_token = NULL
        WHERE order_id = $1 AND status = 'pending' AND fulfilled = FALSE`,
      [orderId, reason]
    );
    return (upd.rowCount || 0) > 0;
  }

  async function requirePaidOrder(invoiceId: string, email: string, kind: 'cart' | 'donation'): Promise<PayCheck> {
    if (invoiceId) {
      let { rows } = await pool.query('SELECT * FROM payment_orders WHERE order_id = $1', [invoiceId]);
      let order = rows[0];
      if (order) {
        if (order.user_email !== email) return { ok: false, status: 403, error: 'Pesanan ini bukan milik akunmu.' };
        if (order.kind !== kind) return { ok: false, status: 400, error: 'Jenis pesanan tidak sesuai.' };
        if (order.fulfilled) return { ok: true, order };
        if (order.status !== 'paid') {
          try { await refreshPaymentStatus(invoiceId); } catch (e) { console.error('[payment] refresh gagal:', e); }
          ({ rows } = await pool.query('SELECT * FROM payment_orders WHERE order_id = $1', [invoiceId]));
          order = rows[0];
        }
        if (order.status === 'paid' || ALLOW_UNPAID) return { ok: true, order };
        return { ok: false, status: 402, error: 'Pembayaran belum terkonfirmasi oleh Midtrans. Selesaikan pembayaran lalu coba lagi.' };
      }
    }
    if (ALLOW_UNPAID) return { ok: true, order: null };
    return { ok: false, status: 402, error: 'Pembayaran belum terkonfirmasi. Selesaikan pembayaran QRIS terlebih dahulu.' };
  }

  // ---------- Rute pembayaran ----------
  // Cek kesiapan: buka /api/payment/status. mode: production | sandbox | demo | not-configured
  router.get('/api/payment/status', (_req, res) => {
    const mode = ALLOW_UNPAID ? 'demo' : configured ? (PROD ? 'production' : 'sandbox') : 'not-configured';
    res.json({ mode, ready: configured && !ALLOW_UNPAID, clientKey: CLIENT_KEY || null, snapUrl: SNAP_JS_URL });
  });

  router.post('/api/payment/charge', requireUser, async (req, res) => {
    const email = String((req as any).userEmail);
    const { orderId, items, customerDetails } = req.body || {};
    if (!SERVER_KEY) return res.status(503).json({ error: 'Gateway pembayaran belum dikonfigurasi di server.' });
    if (!ORDER_ID_RE.test(String(orderId || ''))) return res.status(400).json({ error: 'ID pesanan tidak valid.' });
    if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Item pembayaran kosong.' });

    try {
      const existing = await pool.query('SELECT user_email, fulfilled, status FROM payment_orders WHERE order_id = $1', [orderId]);
      if (existing.rows[0] && (existing.rows[0].user_email !== email || existing.rows[0].fulfilled)) {
        return res.status(409).json({ error: 'ID pesanan sudah dipakai. Ulangi pembayaran.' });
      }
      if (existing.rows[0] && existing.rows[0].status === 'cancelled') {
        return res.status(409).json({ error: 'Pesanan ini sudah dibatalkan. Buat pesanan baru.' });
      }

      let kind: 'cart' | 'donation';
      let gross: number;
      let storedItems: any[];
      if (items.every((i: any) => i?.category === 'donation')) {
        kind = 'donation';
        gross = Math.round(Number(req.body.grossAmount));
        if (!(gross >= 1000 && gross <= 50000000)) return res.status(400).json({ error: 'Nominal donasi tidak valid (Rp1.000 - Rp50.000.000).' });
        storedItems = [{ category: 'donation', price: gross }];
      } else {
        kind = 'cart';
        let subtotal = 0;
        storedItems = [];
        for (const raw of items.slice(0, 50)) {
          storedItems.push({
            ...raw,
            id: raw.category === 'audio' ? raw.trackId || raw.id : raw.deckId || raw.topicId || raw.id,
            cartItemId: raw.id,
          });
        }
        await assertNotOwned(email, storedItems);
        for (let i = 0; i < storedItems.length; i++) {
          const price = await serverItemPrice(storedItems[i], email);
          subtotal += price;
          storedItems[i] = { ...storedItems[i], price };
        }
        gross = subtotal + Math.round(subtotal * 0.11); // PPN 11%, sama dengan keranjang di klien
        if (gross < 1) return res.status(400).json({ error: 'Total pembayaran tidak valid.' });
      }

      // Satu pesanan menunggu per jenis (keranjang / donasi), seperti marketplace.
      const open = await pool.query(
        `SELECT order_id FROM payment_orders
          WHERE user_email = $1 AND kind = $2 AND status = 'pending' AND fulfilled = FALSE
            AND order_id <> $3 AND order_id NOT LIKE 'man\\_%'
            AND COALESCE(expires_at, created_at + interval '24 hours') > NOW()
          LIMIT 1`,
        [email, kind, orderId]
      );
      if (open.rows[0]) {
        return res.status(409).json({
          code: 'PENDING_EXISTS',
          pendingOrderId: open.rows[0].order_id,
          error: 'Masih ada pesanan yang menunggu pembayaran. Selesaikan atau batalkan dulu sebelum membuat pesanan baru.',
        });
      }

      const snapRes = await fetch(SNAP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: midtransAuth() },
        body: JSON.stringify({
          transaction_details: { order_id: orderId, gross_amount: gross },
          expiry: { unit: 'minute', duration: TTL_MIN },
          customer_details: { first_name: String(customerDetails?.name || 'Pelanggan').slice(0, 50), email },
        }),
      });
      const snap: any = await snapRes.json().catch(() => null);
      if (!snapRes.ok || !snap?.token) {
        console.error('[payment] Midtrans menolak:', snapRes.status, snap);
        return res.status(502).json({ error: 'Gateway pembayaran menolak transaksi. Coba lagi.' });
      }

      const ins = await pool.query(
        `INSERT INTO payment_orders (order_id, user_email, kind, gross_amount, items, status, snap_token, expires_at)
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, NOW() + ($7 || ' minutes')::interval)
         ON CONFLICT (order_id) DO UPDATE SET kind = EXCLUDED.kind, gross_amount = EXCLUDED.gross_amount, items = EXCLUDED.items,
           status = 'pending', snap_token = EXCLUDED.snap_token, expires_at = EXCLUDED.expires_at
         WHERE payment_orders.user_email = EXCLUDED.user_email AND payment_orders.fulfilled = FALSE AND payment_orders.status <> 'cancelled'
         RETURNING expires_at`,
        [orderId, email, kind, gross, JSON.stringify(storedItems), snap.token, String(TTL_MIN)]
      );
      console.log(`[payment] pesanan pending dibuat: ${orderId} (${email}, Rp${gross})`);
      res.json({ snapToken: snap.token, amount: gross, expiresAt: ins.rows[0]?.expires_at ?? null });
    } catch (err: any) {
      if (err instanceof CheckoutError) {
        console.warn(`[payment] charge ditolak (${email}): ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
      console.error('[payment] charge error:', err);
      res.status(500).json({ error: 'Gagal membuat transaksi pembayaran.' });
    }
  });

  // Pembeli membatalkan pesanannya sendiri.
  router.post('/api/payment/cancel', requireUser, async (req, res) => {
    const email = String((req as any).userEmail);
    const orderId = String(req.body?.orderId || '');
    if (!ORDER_ID_RE.test(orderId)) return res.status(400).json({ error: 'ID pesanan tidak valid.' });
    try {
      const cancelled = await cancelOrder(orderId, email, 'dibatalkan pembeli');
      res.json({ success: true, cancelled });
    } catch (err) {
      console.error('[payment] cancel error:', err);
      res.status(500).json({ error: 'Gagal membatalkan pesanan.' });
    }
  });

  // Pesanan belum selesai: menunggu bayar (belum lewat batas) ATAU sudah dibayar tapi akses belum diaktifkan.
  router.get('/api/payment/pending', requireUser, async (req, res) => {
    const email = String((req as any).userEmail);
    try {
      const { rows } = await pool.query(
        `SELECT order_id, kind, gross_amount, items, status, created_at, expires_at
           FROM payment_orders
          WHERE user_email = $1 AND fulfilled = FALSE AND order_id NOT LIKE 'man\\_%'
            AND (status = 'paid'
                 OR (status = 'pending' AND snap_token IS NOT NULL
                     AND COALESCE(expires_at, created_at + interval '24 hours') > NOW()))
          ORDER BY created_at DESC LIMIT 5`,
        [email]
      );
      res.json(
        rows.map((r: any) => ({
          orderId: r.order_id,
          kind: r.kind,
          amount: Number(r.gross_amount),
          status: r.status,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items || [],
        }))
      );
    } catch (err) {
      console.error('[payment] pending error:', err);
      res.status(500).json({ error: 'Gagal memuat pesanan menunggu.' });
    }
  });

  // Lanjutkan pembayaran pesanan yang sama (membuka Snap lagi dengan token tersimpan).
  router.post('/api/payment/resume', requireUser, async (req, res) => {
    const email = String((req as any).userEmail);
    const orderId = String(req.body?.orderId || '');
    if (!ORDER_ID_RE.test(orderId)) return res.status(400).json({ error: 'ID pesanan tidak valid.' });
    try {
      const { rows } = await pool.query(
        `SELECT snap_token, gross_amount, status, fulfilled, COALESCE(expires_at, created_at + interval '24 hours') AS due
           FROM payment_orders WHERE order_id = $1 AND user_email = $2`,
        [orderId, email]
      );
      const o = rows[0];
      if (!o || o.fulfilled || o.status !== 'pending' || !o.snap_token) {
        return res.status(404).json({ error: 'Pesanan ini tidak bisa dilanjutkan.' });
      }
      if (new Date(o.due).getTime() <= Date.now()) {
        await cancelOrder(orderId, email, 'melewati batas pembayaran').catch(() => false);
        return res.status(410).json({ error: 'Batas pembayaran pesanan ini sudah lewat dan pesanan dibatalkan.' });
      }
      res.json({ snapToken: o.snap_token, amount: Number(o.gross_amount), expiresAt: o.due });
    } catch (err) {
      console.error('[payment] resume error:', err);
      res.status(500).json({ error: 'Gagal melanjutkan pembayaran.' });
    }
  });

  // Webhook Midtrans. Daftarkan di dashboard Midtrans -> Settings -> Payment Notification URL:
  //   https://playmuzeck.my.id/api/payment/notification
  router.post('/api/payment/notification', async (req, res) => {
    const { order_id, status_code, gross_amount, signature_key } = req.body || {};
    if (!SERVER_KEY || !order_id) return res.sendStatus(400);
    const expected = crypto.createHash('sha512').update(`${order_id}${status_code}${gross_amount}${SERVER_KEY}`).digest('hex');
    if (expected !== String(signature_key || '')) return res.sendStatus(403);
    try {
      await refreshPaymentStatus(String(order_id));
    } catch (e) {
      console.error('[payment] webhook error:', e);
    }
    res.sendStatus(200);
  });

  // Sapu otomatis: pesanan 'Menunggu' dari checkout yang lewat batas bayar -> 'Dibatalkan'.
  async function purgeExpiredPendingOrders() {
    try {
      const { rows } = await pool.query(
        `SELECT order_id FROM payment_orders
          WHERE status = 'pending' AND fulfilled = FALSE AND order_id NOT LIKE 'man\\_%'
            AND COALESCE(expires_at, created_at + ($1 || ' minutes')::interval) < NOW()
          LIMIT 50`,
        [String(TTL_MIN)]
      );
      for (const r of rows) await cancelOrder(r.order_id, null, 'melewati batas pembayaran').catch(() => false);
    } catch (e) {
      console.error('[payment] sapu kedaluwarsa gagal:', e);
    }
  }
  setInterval(purgeExpiredPendingOrders, 2 * 60 * 1000).unref();
  setTimeout(purgeExpiredPendingOrders, 15 * 1000).unref();

  // ---------- Checkout & donasi: HANYA berjalan untuk pesanan yang terbukti lunas ----------
  router.post('/api/user/checkout', requireUser, async (req, res) => {
    const { email, items: requestItems } = req.body || {};
    if (!email || !Array.isArray(requestItems)) return res.status(400).json({ error: 'Data tidak lengkap' });

    const invoiceId = String(req.body?.invoiceId || '');
    const pay = await requirePaidOrder(invoiceId, email, 'cart');
    if (!pay.ok) return res.status(pay.status || 402).json({ error: pay.error });
    if (pay.order?.fulfilled) return res.json({ success: true, savedCount: 0, alreadyFulfilled: true });
    // Item diambil dari pesanan yang dikunci saat /charge (harga & isi tidak bisa diubah klien).
    const items: any[] = pay.order ? (typeof pay.order.items === 'string' ? JSON.parse(pay.order.items) : pay.order.items) : requestItems;

    const client = await pool.connect();
    const failed: { item: any; reason: string }[] = [];
    const succeeded: any[] = [];

    try {
      await client.query('BEGIN');

      // FOREIGN KEY user_collections.user_email -> users.email: baris user harus ada duluan.
      await pool.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`, [
        `usr_${Date.now()}`, email, email.split('@')[0],
      ]);

      const insert = (category: string, id: string, typeKey = '') =>
        client.query(
          `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [email, category, id, typeKey]
        );

      // Tiap item di SAVEPOINT sendiri: satu item gagal tidak membatalkan item lain.
      for (const item of items) {
        await client.query('SAVEPOINT item_sp');
        try {
          if (item.itemTypeKey === 'quizCreatorSuite' || /quiz.?(creator|editor)/i.test(String(item.id || ''))) {
            await insert('feature', 'quiz-creator-suite', 'quizCreatorSuite');
            succeeded.push(item);
            await client.query('RELEASE SAVEPOINT item_sp');
            continue;
          }

          const audioKeys = resolveAudioKeys(item);
          if (item.category === 'audio' || audioKeys) {
            if (!audioKeys) {
              throw new CheckoutError(`Produk audio tidak dikenali (itemTypeKey="${item.itemTypeKey ?? ''}", id="${item.id ?? ''}").`);
            }
            const trackId = stripProductSuffix(String(item.trackId || item.id));
            for (const k of audioKeys) await insert('audio', trackId, k);
            succeeded.push(item);
          } else if (item.category === 'deck') {
            // Deck bawaan tidak punya baris di tabel decks, jadi tema disimpan langsung di item_type_key.
            const badge = typeof item.badge === 'string' ? item.badge.trim() : '';
            await insert('quiz', item.deckId || item.id, badge ? `theme:${badge}` : 'quizDeck');
            succeeded.push(item);
          } else if (item.category === 'topic') {
            const topicId = item.topicId || item.id;
            await insert('topic', topicId, 'topic');
            const { rows } = await client.query('SELECT id, badge FROM decks WHERE topic_id = $1', [topicId]);
            for (const d of rows) {
              const b = typeof d.badge === 'string' ? d.badge.trim() : '';
              await insert('quiz', d.id, b ? `theme:${b}` : 'quizDeck');
            }
            succeeded.push(item);
          } else {
            await insert(item.category, item.id, item.itemTypeKey || '');
            succeeded.push(item);
          }
          await client.query('RELEASE SAVEPOINT item_sp');
        } catch (itemErr: any) {
          await client.query('ROLLBACK TO SAVEPOINT item_sp');
          const reason = itemErr instanceof CheckoutError ? itemErr.message : itemErr?.message || 'Gagal diproses.';
          console.error('[checkout] item gagal:', item?.id, reason);
          failed.push({ item, reason });
        }
      }

      if (succeeded.length === 0 && failed.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: `Seluruh ${failed.length} item gagal dicatat.`, failed });
      }

      if (pay.order) {
        await client.query('UPDATE payment_orders SET fulfilled = TRUE WHERE order_id = $1', [invoiceId]);
      }
      await client.query('COMMIT');

      if (failed.length > 0) {
        return res.status(207).json({ success: true, partial: true, savedCount: succeeded.length, failed });
      }
      res.json({ success: true, savedCount: succeeded.length });
    } catch (error: any) {
      try { await client.query('ROLLBACK'); } catch { /* abaikan */ }
      console.error('Error Checkout DB:', error);
      res.status(500).json({ error: 'Gagal mencatat transaksi.', detail: error.message });
    } finally {
      client.release();
    }
  });

  router.post('/api/user/donate', requireUser, async (req, res) => {
    const { email, amount, orderId } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Data donasi tidak valid.' });
    const pay = await requirePaidOrder(String(orderId || ''), email, 'donation');
    if (!pay.ok) return res.status(pay.status || 402).json({ error: pay.error });
    // Nominal diambil dari pesanan yang benar-benar dibayar, bukan dari body request.
    const amt = pay.order ? Number(pay.order.gross_amount) : Number(amount) || 0;
    if (amt <= 0) return res.status(400).json({ error: 'Data donasi tidak valid.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`, [
        `usr_${Date.now()}`, email, email.split('@')[0],
      ]);
      // orderId dipakai sebagai id supaya "coba simpan ulang" tidak menggandakan donasi.
      await client.query('INSERT INTO donations (id, user_email, amount) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [
        orderId ? `don_${orderId}` : `don_${Date.now()}`, email, amt,
      ]);

      const tier = getDonationTiers().find((t) => amt >= t.min);
      if (tier) {
        await client.query(
          `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key)
           VALUES ($1, 'frame', $2, 'donation') ON CONFLICT DO NOTHING`,
          [email, tier.frameId]
        );
      }
      if (pay.order) {
        await client.query('UPDATE payment_orders SET fulfilled = TRUE WHERE order_id = $1', [String(orderId)]);
      }
      await client.query('COMMIT');
      res.json({ success: true, unlockedFrameId: tier?.frameId || null });
    } catch (err: any) {
      await client.query('ROLLBACK');
      console.error('Error mencatat donasi:', err);
      res.status(500).json({ error: 'Gagal mencatat donasi.', detail: err.message });
    } finally {
      client.release();
    }
  });

  return router;
}
