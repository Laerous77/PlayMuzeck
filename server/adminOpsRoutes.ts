// server/adminOpsRoutes.ts
// Rute operasional admin untuk tab "Pesanan & User" (/admin#ops):
// 1. Pesanan pembayaran (payment_orders)
// 2. Daftar pembeli (buyers)
// 3. Permintaan Custom Audio & Pesan Masuk (inquiries)
// 4. Manajemen Pengguna (users) & Pengiriman Email Balasan ke Pengguna via Resend

import { Router, Request, Response, RequestHandler } from 'express';
import type { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { SUPER_ADMIN_EMAIL } from './db';
import { sendMailStrict } from './emailService';

interface Deps {
  pool: Pool;
  requireAdmin: RequestHandler;
  requireSuperAdmin: RequestHandler;
}

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));
const MANUAL_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];
const INQUIRY_STATUSES = ['baru', 'proses', 'selesai'];
const USER_ROLES = ['user', 'admin'];

export function createAdminOpsRouter({ pool, requireAdmin, requireSuperAdmin }: Deps): Router {
  const router = Router();

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

    try {
      const orderId = `man_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const amount = Number(gross_amount) || 0;
      await pool.query(
        `INSERT INTO payment_orders (order_id, user_email, kind, gross_amount, items, status, fulfilled)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [orderId, email, kind || 'cart', amount, JSON.stringify(items || []), status || 'paid', status === 'paid']
      );
      res.status(201).json({ success: true, order_id: orderId });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal membuat pesanan.' });
    }
  });

  router.patch('/api/admin/payment-orders/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    const { status, gross_amount } = req.body || {};
    try {
      const sets: string[] = [];
      const vals: any[] = [];
      if (status !== undefined) {
        if (!MANUAL_STATUSES.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
        vals.push(status);
        sets.push(`status = $${vals.length}`);
        if (status === 'paid') sets.push('fulfilled = TRUE');
        if (status === 'cancelled') sets.push('fulfilled = FALSE');
      }
      if (gross_amount !== undefined) {
        vals.push(Number(gross_amount) || 0);
        sets.push(`gross_amount = $${vals.length}`);
      }
      if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });
      vals.push(req.params.id);
      await pool.query(`UPDATE payment_orders SET ${sets.join(', ')} WHERE order_id = $${vals.length}`, vals);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal memperbarui pesanan.' });
    }
  });

  router.delete('/api/admin/payment-orders/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      await pool.query('DELETE FROM payment_orders WHERE order_id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal menghapus pesanan.' });
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
          is_super_admin: u.email === SUPER_ADMIN_EMAIL,
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
      if (password && String(password).length < 4) return res.status(400).json({ error: 'Kata sandi minimal 4 karakter.' });
      const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [cleanEmail]);
      if (exists.rows.length) return res.status(409).json({ error: 'Email ini sudah terdaftar.' });
      const hash = password ? await bcrypt.hash(String(password), 10) : null;
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
        vals.push(await bcrypt.hash(String(password), 10));
        sets.push(`password_hash = $${vals.length}`);
      }
      if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });
      vals.push(req.params.id);
      const r = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
      if (!r.rowCount) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || 'Gagal memperbarui pengguna.' });
    }
  });

  router.delete('/api/admin/users/:id', requireAdmin, requireSuperAdmin, async (req: Request, res: Response) => {
    try {
      const found = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
      if (!found.rows[0]) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      if (found.rows[0].email === SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Akun Super Admin tidak bisa dihapus.' });
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
      if (found.rows[0].email === SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Akun Super Admin tidak bisa ditangguhkan.' });

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
