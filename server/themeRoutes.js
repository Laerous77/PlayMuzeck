// server/themeRoutes.js
// Router tema. Pasang sekali di server utama:
//
//   import { createThemeRouter, ensureThemeSchema } from './themeRoutes.js';
//   await ensureThemeSchema(db);   // membuat tabel themes & user_theme_prefs bila belum ada
//   app.use(createThemeRouter({ db, requireUser, requireAdmin }));
//
// - db            : objek dengan db.query(sql, params) -> { rows } (gaya node-postgres)
// - requireUser   : middleware login pengguna biasa (mengisi req.user)
// - requireAdmin  : middleware login admin
// - getUserEmail  : opsional, default req.user.email
//
// Batas (maks 7 tema admin, 2 tema per pengguna) DITEGAKKAN DI SINI, bukan cuma di UI.
import express, { Router } from 'express';

export const LIMITS = { admin: 7, user: 2 };
const NAME_MAX = 24;
const HEX = /^#[0-9a-fA-F]{6}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const THEME_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS themes (
  id SERIAL PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('admin','user')),
  owner_email TEXT,
  name TEXT NOT NULL,
  surface TEXT NOT NULL,
  accent TEXT NOT NULL,
  accent2 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS themes_owner_idx ON themes (scope, owner_email);
CREATE TABLE IF NOT EXISTS user_theme_prefs (
  email TEXT PRIMARY KEY,
  active_theme_id INTEGER REFERENCES themes(id) ON DELETE SET NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);`;

export const ensureThemeSchema = (db) => db.query(THEME_SCHEMA_SQL);

const isHex = (v) => typeof v === 'string' && HEX.test(v);

const toTheme = (r) => ({
  id: r.id,
  name: r.name,
  scope: r.scope,
  palette: { surface: r.surface, accent: r.accent, accent2: r.accent2 },
});

function parseThemeBody(body) {
  const name = typeof body?.name === 'string' ? body.name.trim() : '';
  const p = body?.palette;
  if (!name || name.length > NAME_MAX) return { error: `Nama tema wajib diisi (maks ${NAME_MAX} karakter).` };
  if (!p || !isHex(p.surface) || !isHex(p.accent) || !isHex(p.accent2)) {
    return { error: 'Warna tidak valid (format #RRGGBB).' };
  }
  return {
    name,
    palette: { surface: p.surface.toLowerCase(), accent: p.accent.toLowerCase(), accent2: p.accent2.toLowerCase() },
  };
}

const parseId = (v) => {
  const n = Number.parseInt(v, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

export function createThemeRouter({ db, requireUser, requireAdmin, getUserEmail = (req) => req.user?.email }) {
  const router = Router();
  router.use(express.json());

  const h = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[theme]', err);
      res.status(500).json({ error: 'Terjadi kesalahan server.' });
    });

  // ── helper data ──────────────────────────────────────────────────────────
  async function insertTheme(scope, owner, t) {
    // Cek batas & insert dalam SATU statement supaya tidak bisa menembus batas.
    const { rows } = await db.query(
      `INSERT INTO themes (scope, owner_email, name, surface, accent, accent2)
       SELECT $1::text, $2::text, $3::text, $4::text, $5::text, $6::text
       WHERE (SELECT count(*) FROM themes
              WHERE scope = $1::text AND owner_email IS NOT DISTINCT FROM $2::text) < $7::int
       RETURNING *`,
      [scope, owner, t.name, t.palette.surface, t.palette.accent, t.palette.accent2, LIMITS[scope]],
    );
    return rows[0] ? toTheme(rows[0]) : null;
  }

  async function upsertPref(email, activeId, locked) {
    await db.query(
      `INSERT INTO user_theme_prefs (email, active_theme_id, locked) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE
         SET active_theme_id = EXCLUDED.active_theme_id, locked = EXCLUDED.locked, updated_at = now()`,
      [email, activeId, locked],
    );
  }

  async function loadState(email) {
    const { rows: mine } = await db.query(
      `SELECT * FROM themes WHERE scope = 'user' AND owner_email = $1 ORDER BY id`, [email]);
    const { rows: [pref] } = await db.query(
      `SELECT active_theme_id, locked FROM user_theme_prefs WHERE email = $1`, [email]);
    let active = null;
    if (pref?.active_theme_id) {
      const { rows: [t] } = await db.query(`SELECT * FROM themes WHERE id = $1`, [pref.active_theme_id]);
      // hanya tema admin atau tema milik user itu sendiri yang boleh jadi aktif
      if (t && (t.scope === 'admin' || t.owner_email === email)) active = toTheme(t);
    }
    return {
      activeId: active ? active.id : null,
      active,
      mine: mine.map(toTheme),
      locked: !!pref?.locked && !!active,
      maxMine: LIMITS.user,
    };
  }

  async function isLocked(email) {
    const { rows: [r] } = await db.query(
      `SELECT locked, active_theme_id FROM user_theme_prefs WHERE email = $1`, [email]);
    return !!(r?.locked && r?.active_theme_id);
  }

  const ownEmail = (req) => String(getUserEmail(req) || '').trim().toLowerCase();

  // ════════════════ PENGGUNA ════════════════════════════════════════════════
  router.get('/api/me/theme', requireUser, h(async (req, res) => {
    const email = ownEmail(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    res.json(await loadState(email));
  }));

  router.put('/api/me/theme/active', requireUser, h(async (req, res) => {
    const email = ownEmail(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    if (await isLocked(email)) return res.status(403).json({ error: 'Tema dikunci oleh admin.' });

    const raw = req.body?.themeId;
    let id = null;
    if (raw !== null && raw !== undefined) {
      id = parseId(raw);
      if (!id) return res.status(400).json({ error: 'Tema tidak valid.' });
      const { rows: [t] } = await db.query(`SELECT scope, owner_email FROM themes WHERE id = $1`, [id]);
      if (!t || (t.scope === 'user' && t.owner_email !== email)) {
        return res.status(404).json({ error: 'Tema tidak ditemukan.' });
      }
      if (t.scope === 'admin') {
        // Tema admin hanya boleh dipilih kalau memang sedang diterapkan admin untuk akun ini.
        const cur = await loadState(email);
        if (cur.activeId !== id) return res.status(403).json({ error: 'Tema admin ini tidak diterapkan untuk akunmu.' });
      }
    }
    await upsertPref(email, id, false);
    res.json(await loadState(email));
  }));

  router.post('/api/me/themes', requireUser, h(async (req, res) => {
    const email = ownEmail(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    if (await isLocked(email)) return res.status(403).json({ error: 'Tema dikunci oleh admin.' });
    const t = parseThemeBody(req.body);
    if (t.error) return res.status(400).json({ error: t.error });

    const created = await insertTheme('user', email, t);
    if (!created) return res.status(409).json({ error: `Slot tema penuh (maks ${LIMITS.user}). Hapus salah satu dulu.` });
    await upsertPref(email, created.id, false);
    res.json(await loadState(email));
  }));

  router.put('/api/me/themes/:id', requireUser, h(async (req, res) => {
    const email = ownEmail(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    if (await isLocked(email)) return res.status(403).json({ error: 'Tema dikunci oleh admin.' });
    const id = parseId(req.params.id);
    const t = parseThemeBody(req.body);
    if (!id) return res.status(400).json({ error: 'Tema tidak valid.' });
    if (t.error) return res.status(400).json({ error: t.error });

    const { rowCount } = await db.query(
      `UPDATE themes SET name = $3, surface = $4, accent = $5, accent2 = $6
       WHERE id = $1 AND scope = 'user' AND owner_email = $2`,
      [id, email, t.name, t.palette.surface, t.palette.accent, t.palette.accent2]);
    if (!rowCount) return res.status(404).json({ error: 'Tema tidak ditemukan.' });
    await upsertPref(email, id, false);
    res.json(await loadState(email));
  }));

  router.delete('/api/me/themes/:id', requireUser, h(async (req, res) => {
    const email = ownEmail(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    if (await isLocked(email)) return res.status(403).json({ error: 'Tema dikunci oleh admin.' });
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Tema tidak valid.' });
    // FK ON DELETE SET NULL → kalau tema ini sedang aktif, otomatis balik ke bawaan.
    await db.query(`DELETE FROM themes WHERE id = $1 AND scope = 'user' AND owner_email = $2`, [id, email]);
    res.json(await loadState(email));
  }));

  // ════════════════ ADMIN ═══════════════════════════════════════════════════
  router.get('/api/admin/themes', requireAdmin, h(async (_req, res) => {
    const { rows } = await db.query(`SELECT * FROM themes WHERE scope = 'admin' ORDER BY id`);
    res.json({ themes: rows.map(toTheme), max: LIMITS.admin });
  }));

  router.post('/api/admin/themes', requireAdmin, h(async (req, res) => {
    const t = parseThemeBody(req.body);
    if (t.error) return res.status(400).json({ error: t.error });
    const created = await insertTheme('admin', null, t);
    if (!created) return res.status(409).json({ error: `Tema admin sudah penuh (maks ${LIMITS.admin}). Hapus salah satu dulu.` });
    res.json({ theme: created });
  }));

  router.put('/api/admin/themes/:id', requireAdmin, h(async (req, res) => {
    const id = parseId(req.params.id);
    const t = parseThemeBody(req.body);
    if (!id) return res.status(400).json({ error: 'Tema tidak valid.' });
    if (t.error) return res.status(400).json({ error: t.error });
    const { rows } = await db.query(
      `UPDATE themes SET name = $2, surface = $3, accent = $4, accent2 = $5
       WHERE id = $1 AND scope = 'admin' RETURNING *`,
      [id, t.name, t.palette.surface, t.palette.accent, t.palette.accent2]);
    if (!rows[0]) return res.status(404).json({ error: 'Tema tidak ditemukan.' });
    res.json({ theme: toTheme(rows[0]) });
  }));

  router.delete('/api/admin/themes/:id', requireAdmin, h(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Tema tidak valid.' });
    // Buka kunci pengguna yang sedang dikunci ke tema ini; FK akan mengembalikan mereka ke bawaan.
    await db.query(`UPDATE user_theme_prefs SET locked = FALSE WHERE active_theme_id = $1`, [id]);
    await db.query(`DELETE FROM themes WHERE id = $1 AND scope = 'admin'`, [id]);
    res.json({ ok: true });
  }));

  router.get('/api/admin/users/:email/theme', requireAdmin, h(async (req, res) => {
    const email = String(req.params.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Email tidak valid.' });
    res.json(await loadState(email));
  }));

  router.put('/api/admin/users/:email/theme', requireAdmin, h(async (req, res) => {
    const email = String(req.params.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) return res.status(400).json({ error: 'Email tidak valid.' });

    let id = null;
    if (req.body?.themeId !== null && req.body?.themeId !== undefined) {
      id = parseId(req.body.themeId);
      if (!id) return res.status(400).json({ error: 'Tema tidak valid.' });
      const { rows } = await db.query(`SELECT 1 FROM themes WHERE id = $1 AND scope = 'admin'`, [id]);
      if (!rows.length) return res.status(404).json({ error: 'Tema admin tidak ditemukan.' });
    }
    // Kunci hanya masuk akal kalau ada tema yang di-assign.
    await upsertPref(email, id, id != null && !!req.body?.locked);
    res.json(await loadState(email));
  }));

  return router;
}
