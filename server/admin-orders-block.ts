// ==========================================
// KELOLA PESANAN MANUAL (payment_orders) — dipakai saat payment gateway bermasalah.
// Sumber kebenaran pembayaran = payment_orders; akses produk = user_collections.
// Mengubah status ke 'paid' otomatis MEMBERI akses (user_collections), mengubah dari
// 'paid' ke status lain MENCABUT akses (kecuali item itu juga dimiliki lewat pesanan paid lain).
// ==========================================
const MANUAL_STATUSES = ['pending', 'paid', 'failed', 'cancelled'];

type CollectionRef = { category: string; id: string; typeKey: string };

// Ubah daftar item pesanan -> baris user_collections (logika sama dengan /api/user/checkout)
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
      if (!audioKeys) throw new Error(`Produk audio tidak dikenali (itemTypeKey="${item.itemTypeKey ?? ''}", id="${item.id ?? ''}").`);
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

async function ensureUserRow(db: { query: (q: string, p?: any[]) => Promise<any> }, email: string, name?: string) {
  await db.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`, [
    `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, email, name || email.split('@')[0],
  ]);
}

// Beri akses sesuai isi pesanan. Dipanggil di dalam transaksi.
async function grantOrderAccess(client: any, order: any) {
  const items: any[] = typeof order.items === 'string' ? JSON.parse(order.items) : order.items || [];
  const email = order.user_email;
  await ensureUserRow(client, email);

  if (order.kind === 'donation') {
    const amt = Number(order.gross_amount) || 0;
    await client.query('INSERT INTO donations (id, user_email, amount) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [`don_${order.order_id}`, email, amt]);
    const tier = DONATION_FRAME_TIERS.find((t) => amt >= t.min);
    if (tier) {
      await client.query(
        `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key) VALUES ($1, 'frame', $2, 'donation') ON CONFLICT DO NOTHING`,
        [email, tier.frameId]
      );
    }
  } else {
    for (const r of await collectionRefsForItems(client, items)) {
      await client.query(
        `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
        [email, r.category, r.id, r.typeKey]
      );
    }
  }

  // Cerminkan ke tabel `orders` supaya Pendapatan di Dashboard ikut terhitung.
  await client.query(
    `INSERT INTO orders (id, customer_email, customer_name, items, total, status)
     VALUES ($1, $2::varchar, (SELECT name FROM users WHERE email = $2::varchar), $3::jsonb, $4::int, 'completed')
     ON CONFLICT (id) DO UPDATE SET items = EXCLUDED.items, total = EXCLUDED.total, status = 'completed'`,
    [`pay_${order.order_id}`, email, JSON.stringify(items), Number(order.gross_amount) || 0]
  );
}

// Cabut akses pesanan ini, KECUALI item yang sama juga dimiliki lewat pesanan paid lain milik user yang sama.
async function revokeOrderAccess(client: any, order: any) {
  const items: any[] = typeof order.items === 'string' ? JSON.parse(order.items) : order.items || [];
  const email = order.user_email;

  if (order.kind === 'donation') {
    await client.query('DELETE FROM donations WHERE id = $1', [`don_${order.order_id}`]);
    const { rows } = await client.query('SELECT COALESCE(SUM(amount),0) AS total, COALESCE(MAX(amount),0) AS biggest FROM donations WHERE user_email = $1', [email]);
    const biggest = Number(rows[0].biggest);
    const stillEarned = new Set(DONATION_FRAME_TIERS.filter((t) => biggest >= t.min).map((t) => t.frameId));
    for (const t of DONATION_FRAME_TIERS) {
      if (!stillEarned.has(t.frameId)) {
        await client.query(`DELETE FROM public.user_collections WHERE user_email = $1 AND item_category = 'frame' AND item_id = $2 AND item_type_key = 'donation'`, [email, t.frameId]);
      }
    }
  } else {
    const mine = await collectionRefsForItems(client, items);
    const others = await client.query(
      `SELECT items FROM payment_orders WHERE user_email = $1 AND status = 'paid' AND order_id <> $2 AND kind = 'cart'`,
      [email, order.order_id]
    );
    const keep = new Set<string>();
    for (const o of others.rows) {
      const its = typeof o.items === 'string' ? JSON.parse(o.items) : o.items || [];
      try {
        for (const r of await collectionRefsForItems(client, its)) keep.add(`${r.category}|${r.id}|${r.typeKey}`);
      } catch { /* abaikan item tak dikenali */ }
    }
    for (const r of mine) {
      if (keep.has(`${r.category}|${r.id}|${r.typeKey}`)) continue;
      await client.query(
        `DELETE FROM public.user_collections WHERE user_email = $1 AND item_category = $2 AND item_id = $3 AND item_type_key = $4`,
        [email, r.category, r.id, r.typeKey]
      );
    }
  }
  await client.query('DELETE FROM orders WHERE id = $1', [`pay_${order.order_id}`]);
}

const mapPaymentOrder = (o: any) => ({
  order_id: o.order_id,
  user_email: o.user_email,
  customer_name: o.customer_name || o.user_email,
  kind: o.kind,
  gross_amount: Number(o.gross_amount),
  status: o.status,
  fulfilled: Boolean(o.fulfilled),
  created_at: o.created_at,
  items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items || [],
});

app.get('/api/admin/payment-orders', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, u.name AS customer_name FROM payment_orders p
       LEFT JOIN users u ON u.email = p.user_email ORDER BY p.created_at DESC LIMIT 1000`
    );
    res.json(rows.map(mapPaymentOrder));
  } catch (err) {
    console.error('[admin] payment-orders:', err);
    res.status(500).json({ error: 'Gagal memuat pesanan.' });
  }
});

// Rekap per pembeli: berhasil / gagal / menunggu + jumlah akses aktif.
app.get('/api/admin/buyers', requireAdmin, async (_req, res) => {
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
    res.json(rows.map((r) => ({
      email: r.email, name: r.name || r.email.split('@')[0],
      paid: Number(r.paid), failed: Number(r.failed), pending: Number(r.pending), cancelled: Number(r.cancelled),
      spent: Number(r.spent), last_order: r.last_order, owned_items: Number(r.owned_items),
    })));
  } catch (err) {
    console.error('[admin] buyers:', err);
    res.status(500).json({ error: 'Gagal memuat rekap pembeli.' });
  }
});

// CREATE: buat pesanan manual. status 'paid' langsung memberi akses.
app.post('/api/admin/payment-orders', requireAdmin, async (req, res) => {
  const email = String(req.body?.user_email || '').trim().toLowerCase();
  const kind = req.body?.kind === 'donation' ? 'donation' : 'cart';
  const status = MANUAL_STATUSES.includes(req.body?.status) ? req.body.status : 'pending';
  const gross = Math.max(0, Math.round(Number(req.body?.gross_amount) || 0));
  const items: any[] = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email pengguna tidak valid.' });
  if (kind === 'cart' && !items.length) return res.status(400).json({ error: 'Pilih minimal satu produk.' });
  if (kind === 'donation' && gross <= 0) return res.status(400).json({ error: 'Nominal donasi harus lebih dari 0.' });

  const orderId = `man_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureUserRow(client, email, req.body?.customer_name);
    if (req.body?.customer_name) await client.query('UPDATE users SET name = $1 WHERE email = $2 AND (name IS NULL OR name = split_part(email, \'@\', 1))', [String(req.body.customer_name).slice(0, 255), email]);
    const storedItems = kind === 'donation' ? [{ category: 'donation', price: gross }] : items;
    if (kind === 'cart') await collectionRefsForItems(client, storedItems); // validasi: lempar error kalau ada item tak dikenali
    await client.query(
      `INSERT INTO payment_orders (order_id, user_email, kind, gross_amount, items, status, fulfilled) VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
      [orderId, email, kind, gross, JSON.stringify(storedItems), status]
    );
    if (status === 'paid') {
      await grantOrderAccess(client, { order_id: orderId, user_email: email, kind, gross_amount: gross, items: storedItems });
      await client.query('UPDATE payment_orders SET fulfilled = TRUE WHERE order_id = $1', [orderId]);
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, order_id: orderId });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] create payment-order:', err);
    res.status(400).json({ error: err?.message || 'Gagal membuat pesanan.' });
  } finally {
    client.release();
  }
});

// UPDATE: ubah status (dan nominal). paid -> beri akses; keluar dari paid -> cabut akses.
app.patch('/api/admin/payment-orders/:id', requireAdmin, async (req, res) => {
  const { status, gross_amount } = req.body || {};
  if (status !== undefined && !MANUAL_STATUSES.includes(status)) return res.status(400).json({ error: 'Status tidak valid.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM payment_orders WHERE order_id = $1 FOR UPDATE', [req.params.id]);
    const order = found.rows[0];
    if (!order) { await client.query('ROLLBACK').catch(() => {}); return res.status(404).json({ error: 'Pesanan tidak ditemukan.' }); }

    const newAmount = gross_amount !== undefined ? Math.max(0, Math.round(Number(gross_amount) || 0)) : Number(order.gross_amount);
    const newStatus = status ?? order.status;
    const wasAccess = order.fulfilled && order.status === 'paid';
    const next = { ...order, gross_amount: newAmount, status: newStatus };

    if (wasAccess && newStatus !== 'paid') {
      if (req.body?.revoke !== false) await revokeOrderAccess(client, order);
      await client.query('UPDATE payment_orders SET status = $1, gross_amount = $2, fulfilled = FALSE WHERE order_id = $3', [newStatus, newAmount, order.order_id]);
    } else if (newStatus === 'paid') {
      await grantOrderAccess(client, next);
      await client.query('UPDATE payment_orders SET status = $1, gross_amount = $2, fulfilled = TRUE WHERE order_id = $3', [newStatus, newAmount, order.order_id]);
    } else {
      await client.query('UPDATE payment_orders SET status = $1, gross_amount = $2 WHERE order_id = $3', [newStatus, newAmount, order.order_id]);
    }
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] patch payment-order:', err);
    res.status(500).json({ error: err?.message || 'Gagal memperbarui pesanan.' });
  } finally {
    client.release();
  }
});

// DELETE: hapus pesanan. ?revoke=1 sekaligus mencabut akses yang diberikan pesanan ini.
app.delete('/api/admin/payment-orders/:id', requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query('SELECT * FROM payment_orders WHERE order_id = $1 FOR UPDATE', [req.params.id]);
    const order = found.rows[0];
    if (!order) { await client.query('ROLLBACK').catch(() => {}); return res.status(404).json({ error: 'Pesanan tidak ditemukan.' }); }
    if (order.fulfilled && order.status === 'paid' && String(req.query.revoke) === '1') await revokeOrderAccess(client, order);
    else await client.query('DELETE FROM orders WHERE id = $1', [`pay_${order.order_id}`]);
    await client.query('DELETE FROM payment_orders WHERE order_id = $1', [order.order_id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] delete payment-order:', err);
    res.status(500).json({ error: err?.message || 'Gagal menghapus pesanan.' });
  } finally {
    client.release();
  }
});

