// server/index.ts
import { uploadToSupabase } from './supabaseStorage';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, initDatabase, SUPER_ADMIN_EMAIL } from './db';
import { fileURLToPath } from 'url'; 
import { attachMultiplayerSocket } from './multiplayerSocket';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { authRouter, requireAuth, originGuard, isAllowedOrigin, sendMailStrict } from './auth/authRoutes';
import { createThemeRouter, ensureThemeSchema } from './themeRoutes';
import { createSoundFxRouter, ensureSoundFxSchema } from './soundFxRoutes';
import { createToolQuotaRouter, ensureToolQuotaSchema, startToolQuotaSweeper } from './toolQuotaRoutes';
import { createThemeBulkRoutes } from './themeBulkRoutes';
import { createAccountDeletionRouter, startDeletionSweeper } from './accountDeletion';
import { createNotificationsRouter, ensureNotificationSchema } from './notifications';
import { createAdminOpsRouter } from './adminOpsRoutes';
import { createPaymentRouter } from './paymentRoutes';
import {
  sendCustomAudioInquiryNotifications,
  sendContactFeedbackNotifications,
  sendMail,
  ADMIN_NOTIF_EMAIL,
} from './emailService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();

// Express 4 tidak menangkap error dari handler async: tanpa ini, satu error database yang tidak ditangani
// menjadi unhandled rejection dan bisa menjatuhkan seluruh server. Semua handler rute milik `app`
// dibungkus supaya error diteruskan ke penangan error di bagian bawah file.
const safeHandler = (fn: any) => {
  if (typeof fn !== 'function' || fn.length === 4) return fn;
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
      const out = fn(req, res, next);
      if (out && typeof out.catch === 'function') out.catch(next);
    } catch (err) {
      next(err);
    }
  };
};
for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
  const original = (app as any)[method].bind(app);
  (app as any)[method] = (routePath: any, ...handlers: any[]) =>
    handlers.length ? original(routePath, ...handlers.map(safeHandler)) : original(routePath);
}
const PORT = Number(process.env.PORT) || 8787;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'PlayMuzeck-admin';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[SECURITY] ADMIN_PASSWORD belum diset - memakai sandi default yang mudah ditebak!');
}

async function isServerAdminEmail(email: string): Promise<boolean> {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e === SUPER_ADMIN_EMAIL) return true;
  const { rows } = await pool.query('SELECT 1 FROM admin_emails WHERE email = $1', [e]);
  return rows.length > 0;
}

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

async function verifyGoogleIdToken(credential: string): Promise<{ email: string; name: string } | null> {
  if (!credential || !GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('xxxxx')) return null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const payload: any = await r.json().catch(() => null);
    if (!r.ok || !payload?.email) return null;
    if (payload.aud !== GOOGLE_CLIENT_ID) return null;
    if (payload.email_verified !== 'true' && payload.email_verified !== true) return null;
    return { email: String(payload.email).toLowerCase(), name: payload.name || payload.email.split('@')[0] };
  } catch (err) {
    console.error('[google] error verify:', err);
    return null;
  }
}

app.set('trust proxy', Number(process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 1 : 0)));
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(originGuard);

app.get('/api/avatar/:id', async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^[\w-]{1,100}$/.test(id)) return res.status(404).end();
    const { rows } = await pool.query(`SELECT avatar_url FROM users WHERE id = $1 AND suspended_at IS NULL`, [id]);
    const m = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(rows[0]?.avatar_url || '');
    if (!m) return res.status(404).end();
    res.set('Content-Type', m[1]);
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.set('Cross-Origin-Resource-Policy', 'cross-origin');
    res.send(Buffer.from(m[2], 'base64'));
  } catch {
    res.status(500).end();
  }
});

app.use('/api/auth', authRouter);

const requireUser: express.RequestHandler = (req, res, next) => {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (!req.user) return;
    const email = req.user.email;
    const claimed = String((req.body && req.body.email) ?? req.query?.email ?? '').trim();
    if (claimed && claimed.toLowerCase() !== email.toLowerCase()) {
      return res.status(403).json({ error: 'Email pada permintaan tidak sesuai dengan akun yang sedang login.' });
    }
    if (req.body && typeof req.body === 'object') req.body.email = email;
    (req as any).userEmail = email;
    next();
  });
};
app.use('/api/user', requireUser);

// Email akun yang sedang login, atau null untuk tamu (tidak pernah membalas 401). Dipakai kuota Audio Tools.
const softEmail = (req: express.Request): Promise<string | null> =>
  new Promise((resolve) => {
    const fakeRes: any = { status: () => fakeRes, json: () => { resolve(null); return fakeRes; } };
    try { (requireAuth as any)(req, fakeRes, () => resolve(req.user?.email ?? null)); } catch { resolve(null); }
  });


Promise.resolve(initDatabase())
  .catch((err) => console.error('[DB] initDatabase gagal:', err))
  .then(() => ensurePaymentTables())
  .catch((err) => console.error('[DB] ensurePaymentTables gagal:', err))
  .then(() => ensureThemeSchema(pool))
  .catch((err) => console.error('[DB] ensureThemeSchema gagal:', err))
  .then(() => ensureSoundFxSchema(pool))
  .catch((err) => console.error('[DB] ensureSoundFxSchema gagal:', err))
  .then(() => ensureToolQuotaSchema(pool))
  .catch((err) => console.error('[DB] ensureToolQuotaSchema gagal:', err))
  .then(() => ensureNotificationSchema(pool))
  .catch((err) => console.error('[DB] ensureNotificationSchema gagal:', err));

const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use('/uploads', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
}, express.static(uploadsDir));

const serverUploads = path.resolve(process.cwd(), 'server/uploads');
if (fs.existsSync(serverUploads)) {
  app.use('/uploads', express.static(serverUploads));
}

const storage = multer.memoryStorage();
const fileFilter = (_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExts = ['.mp3', '.wav', '.m4a', '.flac', '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.txt'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) cb(null, true);
  else cb(Object.assign(new Error('Format file tidak didukung.'), { status: 400 }) as any);
};
const upload = multer({ storage, fileFilter, limits: { fileSize: 150 * 1024 * 1024 } });

const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
interface AdminTokenInfo { exp: number; email: string | null; isSuper: boolean; }
const adminTokens = new Map<string, AdminTokenInfo>();
const getAdminTokenInfo = (token: string): AdminTokenInfo | null => {
  const info = adminTokens.get(token);
  if (!info) return null;
  if (info.exp < Date.now()) { adminTokens.delete(token); return null; }
  return info;
};
const issueAdminToken = (email: string | null, isSuper: boolean): string => {
  const token = `adm_${crypto.randomBytes(32).toString('hex')}`;
  adminTokens.set(token, { exp: Date.now() + ADMIN_TOKEN_TTL_MS, email, isSuper });
  return token;
};
const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Akses ditolak: token admin tidak ditemukan.' });
  const info = getAdminTokenInfo(auth.slice(7).trim());
  if (!info) return res.status(401).json({ error: 'Token admin tidak valid atau sudah kedaluwarsa.' });
  (req as any).adminEmail = info.email;
  (req as any).isSuperAdmin = info.isSuper;
  next();
};
const requireSuperAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!(req as any).isSuperAdmin) return res.status(403).json({ error: 'Hanya Super Admin yang bisa melakukan aksi ini.' });
  next();
};

app.use(createThemeRouter({ db: pool, requireUser, requireAdmin }));
app.use(createSoundFxRouter({ db: pool, requireUser }));
app.use(createToolQuotaRouter({ db: pool, resolveEmail: softEmail }));
startToolQuotaSweeper(pool);
app.use(createThemeBulkRoutes({ pool, requireAdmin, requireSuperAdmin, requireUser }));
app.use(createAccountDeletionRouter({ pool, requireUser, requireAdmin, requireSuperAdmin, isServerAdminEmail }));
startDeletionSweeper(pool);
app.use(createNotificationsRouter({ pool }));

// ---- Pembayaran Midtrans + checkout/donasi yang WAJIB terverifikasi lunas (server/paymentRoutes.ts) ----
// Pembungkus fungsi dipakai karena stripProductSuffix & DONATION_FRAME_TIERS didefinisikan lebih bawah di file ini.
app.use(createPaymentRouter({
  pool,
  requireUser,
  resolveAudioKeys: (item) => resolveAudioKeys(item),
  stripProductSuffix: (id) => stripProductSuffix(id),
  getDonationTiers: () => DONATION_FRAME_TIERS,
}));
app.use(createAdminOpsRouter({ pool, requireAdmin, requireSuperAdmin }));

const OWN_ONLY_MSG = 'Kamu hanya bisa mengubah audio/kuis buatanmu sendiri.';
const adminEmailOf = (req: express.Request): string | null => (req as any).adminEmail ? String((req as any).adminEmail).toLowerCase() : null;
const canManageOwner = (req: express.Request, ownerEmail: unknown): boolean => {
  if ((req as any).isSuperAdmin) return true;
  const me = adminEmailOf(req);
  return Boolean(me && ownerEmail && String(ownerEmail).toLowerCase() === me);
};
async function guardTrack(req: express.Request, res: express.Response, id: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT owner_email FROM audio_tracks WHERE id = $1', [id]);
  if (!rows.length) { res.status(404).json({ error: 'Track tidak ditemukan.' }); return false; }
  if (!canManageOwner(req, rows[0].owner_email)) { res.status(403).json({ error: OWN_ONLY_MSG }); return false; }
  return true;
}
async function guardDeck(req: express.Request, res: express.Response, id: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT owner_email, is_custom FROM decks WHERE id = $1', [id]);
  if (!rows.length) { res.status(404).json({ error: 'Deck tidak ditemukan.' }); return false; }
  const allowed = rows[0].is_custom === true ? Boolean((req as any).isSuperAdmin) : canManageOwner(req, rows[0].owner_email);
  if (!allowed) { res.status(403).json({ error: OWN_ONLY_MSG }); return false; }
  return true;
}

const mapTrackRow = (t: any) => ({
  id: t.id,
  coverImageUrl: t.cover_image_url,
  title: t.title,
  artist: t.artist,
  genre: t.genre,
  bpm: t.bpm,
  duration: t.duration,
  loopDuration: t.loop_duration || '00:00',
  durationSec: t.duration_sec,
  coverGradient: t.cover_gradient,
  coverIcon: t.cover_icon,
  licenseInfo: t.license_info,
  price: t.price,
  isFlagship: Boolean(t.is_flagship),
  isPublished: t.is_published !== false,
  description: t.description,
  audioUrl: t.audio_url,
  loopAudioUrl: t.loop_audio_url,
  sheetMusicUrl: t.sheet_music_url,
  stems: typeof t.stems === 'string' ? JSON.parse(t.stems) : t.stems || [],
  chordSequence: typeof t.chord_sequence === 'string' ? JSON.parse(t.chord_sequence) : t.chord_sequence || [],
  bassSequence: typeof t.bass_sequence === 'string' ? JSON.parse(t.bass_sequence) : t.bass_sequence || [],
  melodySequence: typeof t.melody_sequence === 'string' ? JSON.parse(t.melody_sequence) : t.melody_sequence || [],
});
const mapAdminTrack = (t: any) => ({ ...mapTrackRow(t), ownerEmail: t.owner_email || null });

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    return res.json({ token: issueAdminToken(null, true) });
  }
  return res.status(401).json({ error: 'Kata sandi admin salah.' });
});

app.post('/api/admin/google-login', async (req, res) => {
  try {
    const { credential } = req.body || {};
    const verified = await verifyGoogleIdToken(String(credential || ''));
    if (!verified) return res.status(401).json({ error: 'Token Google tidak valid.' });
    if (!(await isServerAdminEmail(verified.email))) return res.status(403).json({ error: `Akses ditolak: ${verified.email} bukan admin.` });
    const token = issueAdminToken(verified.email, verified.email === SUPER_ADMIN_EMAIL);
    res.json({ token, email: verified.email });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memproses login Google.' });
  }
});

app.post('/api/admin/session-login', requireAuth, async (req, res) => {
  const email = String(req.user!.email).toLowerCase();
  if (!(await isServerAdminEmail(email))) return res.status(403).json({ error: `Akses ditolak: ${email} bukan admin.` });
  const token = issueAdminToken(email, email === SUPER_ADMIN_EMAIL);
  res.json({ token, email });
});

app.post('/api/admin/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) adminTokens.delete(auth.slice(7).trim());
  res.json({ success: true });
});

app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ email: (req as any).adminEmail || null, isSuperAdmin: Boolean((req as any).isSuperAdmin) });
});

// Admin Tracks
app.get('/api/admin/tracks', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM audio_tracks ORDER BY id DESC');
  res.json(rows.map(mapAdminTrack));
});

app.post('/api/admin/tracks', requireAdmin, async (req, res) => {
  const d = req.body;
  const trackId = d.id || `track-${Date.now()}`;
  const query = `
    INSERT INTO audio_tracks (
      id, title, artist, genre, bpm, duration, duration_sec,
      cover_gradient, cover_icon, license_info, price, is_flagship, is_published,
      description, audio_url, loop_audio_url, sheet_music_url, stems, chord_sequence, bass_sequence, melody_sequence, owner_email
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
    RETURNING *;
  `;
  const values = [
    trackId, d.title || 'Untitled Track', d.artist || 'PlayMuzeck Studio', d.genre || 'General',
    Number(d.bpm) || 110, d.duration || '02:00', Number(d.durationSec) || 120,
    d.coverGradient || 'from-amber-500/30 via-orange-950/40 to-black',
    d.coverIcon || 'Music', d.licenseInfo || 'Lisensi Komersial PlayMuzeck',
    Number(d.price) || 25000, Boolean(d.isFlagship), d.isPublished !== false,
    d.description || '', d.audioUrl || '', d.loopAudioUrl || '', d.sheetMusicUrl || '',
    JSON.stringify(d.stems || []), JSON.stringify(d.chordSequence || []),
    JSON.stringify(d.bassSequence || []), JSON.stringify(d.melodySequence || []),
    adminEmailOf(req)
  ];
  const { rows } = await pool.query(query, values);
  res.status(201).json(mapAdminTrack(rows[0]));
});

app.put('/api/admin/tracks/:id', requireAdmin, async (req, res) => {
  if (!(await guardTrack(req, res, req.params.id))) return;
  const { id } = req.params;
  const d = req.body;
  const query = `
    UPDATE audio_tracks SET
      title = $1, artist = $2, genre = $3, bpm = $4, duration = $5, duration_sec = $6,
      cover_gradient = $7, cover_icon = $8, license_info = $9, price = $10,
      is_flagship = $11, is_published = $12, description = $13,
      stems = $14, chord_sequence = $15, bass_sequence = $16, melody_sequence = $17
    WHERE id = $18
    RETURNING *;
  `;
  const values = [
    d.title, d.artist, d.genre, Number(d.bpm), d.duration, Number(d.durationSec),
    d.coverGradient, d.coverIcon, d.licenseInfo, Number(d.price),
    Boolean(d.isFlagship), d.isPublished !== false, d.description || '',
    JSON.stringify(d.stems || []), JSON.stringify(d.chordSequence || []),
    JSON.stringify(d.bassSequence || []), JSON.stringify(d.melodySequence || []),
    id
  ];
  const { rows } = await pool.query(query, values);
  res.json(mapAdminTrack(rows[0]));
});

app.delete('/api/admin/tracks/:id', requireAdmin, async (req, res) => {
  if (!(await guardTrack(req, res, req.params.id))) return;
  await pool.query('DELETE FROM audio_tracks WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.post('/api/admin/tracks/:id/audio', requireAdmin, upload.single('file'), async (req, res) => {
  if (!(await guardTrack(req, res, req.params.id))) return;
  const { id } = req.params;
  const { kind, stemId, duration } = req.query as { kind: string; stemId?: string; duration?: string };
  if (!req.file) return res.status(400).json({ error: 'Tidak ada berkas yang diunggah.' });

  const fileUrl = await uploadToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
  const { rows } = await pool.query('SELECT * FROM audio_tracks WHERE id = $1', [id]);
  if (!rows.length) return res.status(404).json({ error: 'Track tidak ditemukan.' });

  let query = '';
  let params: any[] = [];
  if (kind === 'master') {
    query = 'UPDATE audio_tracks SET audio_url = $1 WHERE id = $2 RETURNING *;';
    params = [fileUrl, id];
  } else if (kind === 'cover') {
    query = 'UPDATE audio_tracks SET cover_image_url = $1 WHERE id = $2 RETURNING *;';
    params = [fileUrl, id];
  } else if (kind === 'loop') {
    query = 'UPDATE audio_tracks SET loop_audio_url = $1, loop_duration = COALESCE($2, loop_duration) WHERE id = $3 RETURNING *;';
    params = [fileUrl, duration || '00:00', id];
  } else if (kind === 'sheet') {
    query = 'UPDATE audio_tracks SET sheet_music_url = $1 WHERE id = $2 RETURNING *;';
    params = [fileUrl, id];
  } else if (kind === 'stem' && stemId) {
    const stems = typeof rows[0].stems === 'string' ? JSON.parse(rows[0].stems) : rows[0].stems || [];
    const updatedStems = stems.map((s: any) => (s.id === stemId ? { ...s, audioUrl: fileUrl } : s));
    query = 'UPDATE audio_tracks SET stems = $1 WHERE id = $2 RETURNING *;';
    params = [JSON.stringify(updatedStems), id];
  } else {
    return res.status(400).json({ error: 'Jenis berkas tidak valid.' });
  }

  const updated = await pool.query(query, params);
  res.json(mapAdminTrack(updated.rows[0]));
});

app.delete('/api/admin/tracks/:id/file', requireAdmin, async (req, res) => {
  if (!(await guardTrack(req, res, req.params.id))) return;
  const { id } = req.params;
  const { kind, stemId } = req.query as { kind: string; stemId?: string };
  let query = '';
  let params: any[] = [id];

  if (kind === 'master') query = 'UPDATE audio_tracks SET audio_url = NULL WHERE id = $1 RETURNING *;';
  else if (kind === 'loop') query = 'UPDATE audio_tracks SET loop_audio_url = NULL WHERE id = $1 RETURNING *;';
  else if (kind === 'sheet') query = 'UPDATE audio_tracks SET sheet_music_url = NULL WHERE id = $1 RETURNING *;';
  else if (kind === 'cover') query = 'UPDATE audio_tracks SET cover_image_url = NULL WHERE id = $1 RETURNING *;';
  else if (kind === 'stem' && stemId) {
    const { rows } = await pool.query('SELECT stems FROM audio_tracks WHERE id = $1', [id]);
    const stems = typeof rows[0]?.stems === 'string' ? JSON.parse(rows[0].stems) : rows[0]?.stems || [];
    const updatedStems = stems.map((s: any) => (s.id === stemId ? { ...s, audioUrl: null } : s));
    query = 'UPDATE audio_tracks SET stems = $1 WHERE id = $2 RETURNING *;';
    params = [JSON.stringify(updatedStems), id];
  }

  const updated = await pool.query(query, params);
  res.json(mapAdminTrack(updated.rows[0]));
});

// Admin Topics & Decks
app.get('/api/admin/topics', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM topics ORDER BY id ASC');
  res.json(rows.map(t => ({ id: t.id, title: t.title, iconName: t.icon_name, description: t.description, price: t.price, originalPrice: t.original_price, badge: t.badge })));
});

app.post('/api/admin/topics', requireAdmin, requireSuperAdmin, async (req, res) => {
  const t = req.body;
  const topicId = t.id || `topic-${Date.now()}`;
  const query = `
    INSERT INTO topics (id, title, icon_name, description, price, original_price, badge)
    VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
  `;
  const { rows } = await pool.query(query, [
    topicId, t.title, t.iconName || 'BookOpen', t.description || '',
    Number(t.price) || 0, Number(t.originalPrice) || 0, t.badge || ''
  ]);
  res.status(201).json(rows[0]);
});

app.put('/api/admin/topics/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  const { id } = req.params;
  const t = req.body;
  const query = `
    UPDATE topics SET title = $1, icon_name = $2, description = $3, price = $4, original_price = $5, badge = $6
    WHERE id = $7 RETURNING *;
  `;
  const { rows } = await pool.query(query, [t.title, t.iconName, t.description, Number(t.price) || 0, Number(t.originalPrice) || 0, t.badge, id]);
  res.json(rows[0]);
});

app.delete('/api/admin/topics/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  await pool.query('DELETE FROM topics WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

const mapAdminDeck = (d: any) => ({
  id: d.id, topicId: d.topic_id || '', title: d.title, description: d.description,
  cardCount: d.card_count, difficulty: d.difficulty, isFree: Boolean(d.is_free),
  price: d.price, badge: d.badge, settings: d.settings || {},
  isCustom: d.is_custom === true, ownerEmail: d.owner_email || null,
  questions: typeof d.questions === 'string' ? JSON.parse(d.questions) : d.questions || [],
});

app.get('/api/admin/decks', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM decks ORDER BY COALESCE(is_custom, FALSE), id ASC');
  res.json(rows.map(mapAdminDeck));
});

app.post('/api/admin/decks', requireAdmin, async (req, res) => {
  const d = req.body;
  const deckId = d.id || `deck-${Date.now()}`;
  const questions = Array.isArray(d.questions) ? d.questions : [];
  const query = `
    INSERT INTO decks (id, topic_id, title, description, card_count, difficulty, is_free, price, badge, questions, settings, owner_email)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12) RETURNING *;
  `;
  const settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
  const { rows } = await pool.query(query, [
    deckId, d.topicId || null, d.title, d.description || '', questions.length,
    d.difficulty || 'Sedang', Boolean(d.isFree), Number(d.price) || 0, d.badge || '', JSON.stringify(questions),
    JSON.stringify(settings), adminEmailOf(req)
  ]);
  res.status(201).json(mapAdminDeck(rows[0]));
});

app.put('/api/admin/decks/:id', requireAdmin, async (req, res) => {
  if (!(await guardDeck(req, res, req.params.id))) return;
  const { id } = req.params;
  const d = req.body;
  const questions = Array.isArray(d.questions) ? d.questions : [];
  const query = `
    UPDATE decks SET topic_id = $1, title = $2, description = $3, card_count = $4, difficulty = $5, is_free = $6, price = $7, badge = $8, questions = $9,
      settings = COALESCE($10::jsonb, settings)
    WHERE id = $11 RETURNING *;
  `;
  const settingsJson = d.settings && typeof d.settings === 'object' ? JSON.stringify(d.settings) : null;
  const { rows } = await pool.query(query, [
    d.topicId || null, d.title, d.description || '', questions.length, d.difficulty, Boolean(d.isFree), Number(d.price) || 0, d.badge || '', JSON.stringify(questions), settingsJson, id
  ]);
  res.json(mapAdminDeck(rows[0]));
});

app.delete('/api/admin/decks/:id', requireAdmin, async (req, res) => {
  if (!(await guardDeck(req, res, req.params.id))) return;
  await pool.query('DELETE FROM decks WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

app.post('/api/admin/import-content', requireAdmin, requireSuperAdmin, async (req, res) => {
  const { topics = [], decks = [] } = req.body;
  for (const t of topics) {
    await pool.query(`
      INSERT INTO topics (id, title, icon_name, description, price, original_price, badge)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT(id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description;
    `, [t.id, t.title, t.iconName || 'BookOpen', t.description || '', Number(t.price) || 0, Number(t.originalPrice) || 0, t.badge || '']);
  }
  for (const d of decks) {
    const q = Array.isArray(d.questions) ? d.questions : [];
    await pool.query(`
      INSERT INTO decks (id, topic_id, title, description, card_count, difficulty, is_free, price, badge, questions)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT(id) DO UPDATE SET title = EXCLUDED.title, questions = EXCLUDED.questions;
    `, [d.id, d.topicId || null, d.title, d.description || '', q.length, d.difficulty || 'Sedang', Boolean(d.isFree), Number(d.price) || 0, d.badge || '', JSON.stringify(q)]);
  }
  res.json({ topics: topics.length, decks: decks.length });
});

// Admin Analytics & Ops
app.get('/api/admin/analytics', requireAdmin, async (_req, res) => {
  try {
    const [cat, usr, pay, inq, evt, days, byType, top, statuses, recentEv, recentOrd] = await Promise.all([
      pool.query(`SELECT
          (SELECT COUNT(*) FROM audio_tracks)::int AS tracks,
          (SELECT COUNT(*) FROM topics)::int AS topics,
          (SELECT COUNT(*) FROM decks WHERE COALESCE(is_custom, FALSE) = FALSE)::int AS decks,
          (SELECT COUNT(*) FROM decks WHERE is_custom IS TRUE)::int AS custom_decks,
          (SELECT COALESCE(array_agg(id), '{}') FROM decks) AS deck_ids`),
      pool.query(`SELECT COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE suspended_at IS NOT NULL)::int AS suspended,
          COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new7d
        FROM users`),
      pool.query(`SELECT
          COUNT(*) FILTER (WHERE status = 'paid')::int AS paid,
          COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
          COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
          COALESCE(SUM(gross_amount) FILTER (WHERE status = 'paid'), 0)::bigint AS revenue,
          COALESCE(SUM(gross_amount) FILTER (WHERE status = 'paid' AND kind = 'donation'), 0)::bigint AS donations,
          COUNT(DISTINCT user_email) FILTER (WHERE status = 'paid')::int AS buyers
        FROM payment_orders`),
      pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'baru')::int AS open FROM inquiries`),
      pool.query('SELECT COUNT(*)::int AS total FROM analytics_events'),
      pool.query(`
        WITH d AS (
          SELECT generate_series(
            (NOW() AT TIME ZONE 'Asia/Jakarta')::date - 13,
            (NOW() AT TIME ZONE 'Asia/Jakarta')::date, INTERVAL '1 day')::date AS day
        )
        SELECT TO_CHAR(d.day, 'YYYY-MM-DD') AS date,
          (SELECT COUNT(*) FROM analytics_events e
             WHERE (e.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date = d.day)::int AS events,
          (SELECT COUNT(*) FROM payment_orders p
             WHERE p.status = 'paid' AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date = d.day)::int AS orders,
          (SELECT COALESCE(SUM(p.gross_amount), 0) FROM payment_orders p
             WHERE p.status = 'paid' AND (p.created_at AT TIME ZONE 'Asia/Jakarta')::date = d.day)::int AS revenue,
          (SELECT COUNT(*) FROM users u
             WHERE (u.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Jakarta')::date = d.day)::int AS users
        FROM d ORDER BY d.day ASC`),
      pool.query(`SELECT event_type AS type, COUNT(*)::int AS count FROM analytics_events
                  GROUP BY event_type ORDER BY count DESC LIMIT 8`),
      pool.query(`
        SELECT COALESCE(it->>'title', it->>'id') AS title,
               COALESCE(NULLIF(it->>'itemTypeKey', ''), it->>'category') AS type_key,
               COUNT(*)::int AS sold
        FROM payment_orders p,
             jsonb_array_elements(CASE WHEN jsonb_typeof(p.items) = 'array' THEN p.items ELSE '[]'::jsonb END) it
        WHERE p.status = 'paid' AND p.kind = 'cart'
        GROUP BY 1, 2 ORDER BY sold DESC LIMIT 6`),
      pool.query(`SELECT status, COUNT(*)::int AS count FROM payment_orders GROUP BY status`),
      pool.query('SELECT id, event_type, payload, created_at FROM analytics_events ORDER BY created_at DESC LIMIT 12'),
      pool.query(`SELECT order_id, user_email, kind, gross_amount, status, created_at
                  FROM payment_orders ORDER BY created_at DESC LIMIT 8`),
    ]);

    res.json({
      totals: {
        tracks: cat.rows[0].tracks,
        topics: cat.rows[0].topics,
        decks: cat.rows[0].decks,
        customDecks: cat.rows[0].custom_decks,
        deckIds: cat.rows[0].deck_ids || [],
        users: usr.rows[0].total,
        newUsers7d: usr.rows[0].new7d,
        suspendedUsers: usr.rows[0].suspended,
        orders: pay.rows[0].paid,
        pendingOrders: pay.rows[0].pending,
        cancelledOrders: pay.rows[0].cancelled,
        buyers: pay.rows[0].buyers,
        revenue: Number(pay.rows[0].revenue),
        donations: Number(pay.rows[0].donations),
        inquiries: inq.rows[0].total,
        openInquiries: inq.rows[0].open,
        events: evt.rows[0].total,
      },
      days: days.rows,
      byType: byType.rows,
      topProducts: top.rows,
      orderStatuses: statuses.rows,
      recentEvents: recentEv.rows,
      recentOrders: recentOrd.rows.map((o) => ({ ...o, gross_amount: Number(o.gross_amount) })),
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat analitik.' });
  }
});

app.post('/api/admin/clear-analytics', requireAdmin, requireSuperAdmin, async (_req, res) => {
  await pool.query('DELETE FROM analytics_events');
  res.json({ success: true });
});

// ==========================================
// CUSTOM AUDIO INQUIRY: POST /api/public/inquiries (Frontend CustomAudioModal)
// ==========================================
app.post('/api/public/inquiries', async (req, res) => {
  try {
    const { id, title, genre, mood, duration, notes, email } = req.body || {};
    const inqId = id || `inquiry-${Date.now()}`;
    const cleanTitle = String(title || 'Komposisi Custom PlayMuzeck').trim().slice(0, 255);
    const cleanEmail = String(email || '').trim().slice(0, 255);
    const cleanGenre = String(genre || 'General').trim().slice(0, 100);
    const cleanMood = String(mood || '').trim().slice(0, 100);
    const cleanNotes = String(notes || '').trim().slice(0, 10000);

    await pool.query(
      `INSERT INTO inquiries (id, title, email, genre, mood, status, notes) VALUES ($1, $2, $3, $4, $5, 'baru', $6)
       ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, notes = EXCLUDED.notes`,
      [inqId, cleanTitle, cleanEmail, cleanGenre, cleanMood, cleanNotes]
    );

    // Kirim notifikasi via Resend ke Admin & konfirmasi ke Pelanggan
    void sendCustomAudioInquiryNotifications({
      id: inqId,
      title: cleanTitle,
      genre: cleanGenre,
      mood: cleanMood,
      duration: String(duration || '2 Menit'),
      notes: cleanNotes,
      email: cleanEmail,
    });

    res.json({ success: true, id: inqId });
  } catch (err: any) {
    console.error('[inquiries] error saving public inquiry:', err);
    res.status(500).json({ error: 'Gagal mencatat permintaan custom audio.' });
  }
});

// ==========================================
// FEEDBACK & HUBUNGI KAMI: POST /api/user/contact
// ==========================================
app.post('/api/user/contact', async (req, res) => {
  const { email, category, subject, message } = req.body || {};
  if (!email || !message) return res.status(400).json({ error: 'Pesan tidak boleh kosong.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [`usr_${Date.now()}`, email, email.split('@')[0]]
    );
    const inqId = `inq_${Date.now()}`;
    await client.query(
      `INSERT INTO inquiries (id, title, email, genre, mood, notes) VALUES ($1, $2, $3, $4, $5, $6)`,
      [inqId, subject || 'Masukan Pengguna', email, category || 'feedback', 'contact-form', message]
    );
    await client.query(
      `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key)
       VALUES ($1, 'frame', 'frame-contact', 'contact') ON CONFLICT DO NOTHING`,
      [email]
    );
    await client.query('COMMIT');

    // Kirim notifikasi via Resend ke Admin & konfirmasi ke Pengirim
    void sendContactFeedbackNotifications({
      category: category || 'feedback',
      subject: subject || undefined,
      message,
      email,
    });

    res.json({ success: true, unlockedFrameId: 'frame-contact' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error mengirim masukan:', err);
    res.status(500).json({ error: 'Gagal mengirim masukan.', detail: err.message });
  } finally {
    client.release();
  }
});

// Admin Admins list
app.get('/api/admin/admins', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT email, granted_by, created_at FROM admin_emails ORDER BY created_at ASC');
  res.json(rows.map((r) => ({ email: r.email, grantedBy: r.granted_by, createdAt: r.created_at, isSuperAdmin: r.email === SUPER_ADMIN_EMAIL })));
});

app.post('/api/admin/admins', requireAdmin, requireSuperAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email.includes('@')) return res.status(400).json({ error: 'Alamat email tidak valid.' });
  const grantedBy = (req as any).adminEmail || 'password-admin';
  await pool.query('INSERT INTO admin_emails (email, granted_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING', [email, grantedBy]);
  res.json({ success: true });
});

app.delete('/api/admin/admins/:email', requireAdmin, requireSuperAdmin, async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();
  if (email === SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Super Admin tidak bisa dicabut.' });
  await pool.query('DELETE FROM admin_emails WHERE email = $1', [email]);
  res.json({ success: true });
});

app.get('/api/admin/settings', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM site_settings');
  const defaults: Record<string, string> = {
    siteName: 'PlayMuzeck', tagline: 'Audio & Trivia Arena', accentAudio: '#FCA311',
    accentQuiz: '#FC1212', themeId: 'oxford-amber', footerNote: 'Platform Audio Interaktif & Pusat Kuis',
  };
  rows.forEach(r => { defaults[r.key] = r.value; });
  res.json(defaults);
});

app.put('/api/admin/settings', requireAdmin, requireSuperAdmin, async (req, res) => {
  const s = req.body;
  for (const [k, v] of Object.entries(s)) {
    await pool.query('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value', [k, String(v)]);
  }
  res.json(s);
});

app.get('/api/admin/export', requireAdmin, requireSuperAdmin, async (_req, res) => {
  const [tr, tp, dk] = await Promise.all([
    pool.query('SELECT * FROM audio_tracks'),
    pool.query('SELECT * FROM topics'),
    pool.query('SELECT * FROM decks')
  ]);
  res.json({ tracks: tr.rows.map(mapTrackRow), topics: tp.rows, decks: dk.rows });
});

// Rute Publik Catalog & Settings
app.get('/api/public/catalog', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM audio_tracks WHERE is_published = TRUE ORDER BY id DESC');
  res.json(rows.map(mapTrackRow));
});

app.get('/api/public/topics', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM topics ORDER BY id ASC');
  res.json(rows.map(t => ({ id: t.id, title: t.title, iconName: t.icon_name, description: t.description, price: t.price, originalPrice: t.original_price, badge: t.badge })));
});

app.get('/api/public/decks', async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM decks WHERE is_custom IS NOT TRUE ORDER BY id ASC");
  res.json(rows.map(d => ({ id: d.id, topicId: d.topic_id, title: d.title, description: d.description, cardCount: d.card_count, difficulty: d.difficulty, isFree: Boolean(d.is_free), price: d.price, badge: d.badge, settings: d.settings || {}, questions: typeof d.questions === 'string' ? JSON.parse(d.questions) : d.questions || [] })));
});

app.get('/api/public/settings', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM site_settings');
  const defaults: Record<string, string> = { siteName: 'PlayMuzeck', tagline: 'Audio & Trivia Arena', accentAudio: '#FCA311', accentQuiz: '#FC1212', themeId: 'oxford-amber', footerNote: 'Platform Audio Interaktif & Pusat Kuis' };
  rows.forEach(r => { defaults[r.key] = r.value; });
  res.json(defaults);
});

app.post('/api/public/analytics', async (req, res) => {
  try {
    const { event, eventType, path: p, ...payload } = req.body || {};
    await pool.query(
      'INSERT INTO analytics_events (id, event_type, payload) VALUES ($1, $2, $3)',
      [`evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, String(eventType || event || 'page_view').slice(0, 60), JSON.stringify({ path: p, ...payload })]
    );
  } catch {}
  res.json({ success: true });
});

app.post('/api/users', requireUser, async (req, res) => {
  const name = String(req.body?.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
  await pool.query(
    `UPDATE users SET name = COALESCE(NULLIF($2, ''), name), last_seen = NOW() WHERE id = $1`,
    [req.user!.id, name]
  );
  res.json({ success: true });
});

app.put('/api/user/profile', async (req, res) => {
  try {
    const b = req.body || {};
    const clean = (v: unknown, max: number) => String(v ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
    const sets: string[] = [];
    const vals: unknown[] = [req.user!.id];
    const push = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (b.name !== undefined) {
      const name = clean(b.name, 60);
      if (!name) return res.status(400).json({ error: 'Nama tidak boleh kosong.' });
      push('name', name);
    }
    if (b.bio !== undefined) push('bio', clean(b.bio, 160) || null);
    if (b.greeting !== undefined) push('greeting', clean(b.greeting, 80) || null);
    if (b.avatarUrl !== undefined) {
      const a = String(b.avatarUrl || '');
      if (a && !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(a)) return res.status(400).json({ error: 'Format foto tidak valid.' });
      if (a.length > 300_000) return res.status(413).json({ error: 'Foto terlalu besar.' });
      push('avatar_url', a || null);
    }
    if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });

    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')}, last_seen = NOW() WHERE id = $1
       RETURNING id, name, email, left(md5(avatar_url), 8) AS avatar_v, bio, greeting, active_frame_id`,
      vals
    );
    const u = rows[0];
    res.json({ success: true, profile: { name: u.name, email: u.email, avatarUrl: u.avatar_v ? `/api/avatar/${u.id}?v=${u.avatar_v}` : '', bio: u.bio || '', greeting: u.greeting || '', frameId: u.active_frame_id || 'none' } });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan profil.' });
  }
});

// Frontend user collections & checkout
const AUDIO_BUNDLE = ['fullMaster', 'loopVersion', 'separatedStems', 'sheetMusic', 'fullEditor8Bar', 'audioToolsSuite'];
const AUDIO_KEY_SET = new Set(AUDIO_BUNDLE);
const AUDIO_KEY_ALIASES: Record<string, string> = {
  master: 'fullMaster', loop: 'loopVersion', stems: 'separatedStems', stem: 'separatedStems',
  sheet: 'sheetMusic', partitur: 'sheetMusic', editor: 'fullEditor8Bar', fullEditor: 'fullEditor8Bar',
  full16BarEditor: 'fullEditor8Bar', tools: 'audioToolsSuite', audioTools: 'audioToolsSuite',
};
const normalizeAudioKey = (k: unknown) => {
  const raw = String(k || '');
  return AUDIO_KEY_ALIASES[raw] || raw;
};

function resolveAudioKeys(item: any): string[] | null {
  for (const field of ['bundleKeys', 'productKeys', 'includedKeys', 'unownedKeys', 'includes', 'bundleItems']) {
    const list = item?.[field];
    if (Array.isArray(list)) {
      const keys = list.map((x: any) => normalizeAudioKey(typeof x === 'string' ? x : x?.itemTypeKey || x?.key)).filter((k: string) => AUDIO_KEY_SET.has(k));
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

const stripProductSuffix = (id: string) =>
  id.replace(/[-_:](fullMaster|loopVersion|separatedStems|sheetMusic|fullEditor8Bar|audioToolsSuite|all|bundle)$/i, '');

app.post('/api/user/decks', async (req, res) => {
  const { email, deck } = req.body || {};
  if (!email || !deck || !deck.title) return res.status(400).json({ error: 'Data deck kuis tidak lengkap.' });
  // Kreator Kuis adalah produk berbayar: dicek di SERVER (bukan cuma disembunyikan di UI).
  const hasCreator = await pool.query(
    `SELECT 1 FROM public.user_collections
      WHERE user_email = $1 AND (item_type_key = 'quizCreatorSuite' OR item_id IN ('quiz-creator-suite','quiz_editor_10k')) LIMIT 1`,
    [email]
  );
  if (!hasCreator.rows.length) {
    return res.status(403).json({ error: 'Fitur Kreator Kuis belum dibeli untuk akun ini.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`, [`usr_${Date.now()}`, email, email.split('@')[0]]);
    const deckId = deck.id || `deck-custom-${Date.now()}`;
    const questions = Array.isArray(deck.questions) ? deck.questions : [];
    const rawSettings = deck.settings && typeof deck.settings === 'object' ? deck.settings : {};
    const penaltyRaw = Number(rawSettings.penaltyPercent ?? deck.penaltyPercent);
    const deckSettings = {
      ...rawSettings,
      penaltyPercent: Number.isFinite(penaltyRaw) ? Math.min(100, Math.max(0, Math.round(penaltyRaw))) : 0,
      scoreUnit: (rawSettings.scoreUnit ?? deck.scoreUnit) === 'percent' ? 'percent' : 'point',
    };

    const { rows } = await client.query(
      `INSERT INTO decks (id, topic_id, title, description, card_count, difficulty, is_free, price, badge, questions, is_custom, owner_email, settings)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $12::jsonb)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description, card_count = EXCLUDED.card_count,
         questions = EXCLUDED.questions, settings = EXCLUDED.settings
       WHERE decks.is_custom IS TRUE AND decks.owner_email = EXCLUDED.owner_email
       RETURNING *;`,
      [deckId, deck.topicId || null, deck.title, deck.description || '', questions.length, deck.difficulty || 'Sedang', true, 0, deck.badge || 'Kustom Kamu', JSON.stringify(questions), email, JSON.stringify(deckSettings)]
    );

    if (!rows.length) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'ID kuis ini sudah dipakai milik orang lain / kuis resmi.' });
    }

    await client.query(
      `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key)
       VALUES ($1, 'quiz', $2, 'custom') ON CONFLICT DO NOTHING`,
      [email, deckId]
    );

    await client.query('COMMIT');
    res.status(201).json({ ...rows[0], topicId: rows[0].topic_id, cardCount: rows[0].card_count, isFree: Boolean(rows[0].is_free), questions, settings: rows[0].settings || deckSettings });
  } catch (error: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Gagal menyimpan kuis kustom.' });
  } finally {
    client.release();
  }
});

app.delete('/api/user/decks/:id', async (req, res) => {
  const { id } = req.params;
  const email = String((req as any).userEmail || '');
  if (!email) return res.status(400).json({ error: 'Email wajib disertakan.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deckRes = await client.query(`SELECT id, owner_email, is_custom FROM decks WHERE id = $1`, [id]);
    if (deckRes.rows.length) {
      const d = deckRes.rows[0];
      if (d.is_custom && d.owner_email && d.owner_email !== email) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Bukan pemilik kuis ini.' });
      }
      if (d.is_custom) await client.query('DELETE FROM decks WHERE id = $1', [id]);
    }
    await client.query(`DELETE FROM public.user_collections WHERE user_email = $1 AND item_category = 'quiz' AND item_id = $2`, [email, id]);
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Gagal menghapus kuis.' });
  } finally {
    client.release();
  }
});

app.get('/api/user/collections', async (req, res) => {
  const email = String((req as any).userEmail || '');
  if (!email) return res.status(400).json({ error: 'Email wajib disertakan' });

  try {
    const { rows } = await pool.query(
      `SELECT item_category, item_id, item_type_key FROM public.user_collections WHERE user_email = $1`,
      [email]
    );

    // Kuis: ambil ID langsung dari user_collections, tidak bergantung pada tabel decks
    const deckIds = rows.filter(r => r.item_category === 'quiz').map(r => r.item_id);
    const topicIds = rows.filter(r => r.item_category === 'topic').map(r => r.item_id);
    const dbDecks = deckIds.length
      ? (await pool.query('SELECT * FROM decks WHERE id = ANY($1)', [deckIds])).rows
      : [];

    const hasQuizEditor = rows.some(r =>
      r.item_id === 'quiz_editor_10k' || r.item_id === 'quiz-creator-suite' || r.item_type_key === 'quizCreatorSuite' ||
      /quiz.?(creator|editor)/i.test(String(r.item_id || ''))
    );

    // Audio ('all' tetap dikenali supaya data lama ikut benar)
    const audioRows = rows.filter(r => r.item_category === 'audio');
    const has16BarEditor = audioRows.some(r => r.item_type_key === 'fullEditor8Bar' || r.item_type_key === 'all');
    const hasAudioToolsSuite = audioRows.some(r => r.item_type_key === 'audioToolsSuite' || r.item_type_key === 'all');

    const ownershipByTrack = new Map<string, any>();
    for (const r of audioRows) {
      if (r.item_type_key === 'fullEditor8Bar' || r.item_type_key === 'audioToolsSuite') continue;
      const p = ownershipByTrack.get(r.item_id) || { fullMaster: false, loopVersion: false, separatedStems: false, sheetMusic: false };
      const all = r.item_type_key === 'all';
      if (all || r.item_type_key === 'fullMaster') p.fullMaster = true;
      if (all || r.item_type_key === 'loopVersion') p.loopVersion = true;
      if (all || r.item_type_key === 'separatedStems') p.separatedStems = true;
      if (all || r.item_type_key === 'sheetMusic') p.sheetMusic = true;
      ownershipByTrack.set(r.item_id, p);
    }

    const audioItems = [];
    let hasFullBundleOnAnyTrack = false;
    for (const [trackId, ownership] of ownershipByTrack) {
      const t = await pool.query('SELECT * FROM public.audio_tracks WHERE id = $1', [trackId]);
      if (t.rows.length) audioItems.push({ track: mapTrackRow(t.rows[0]), ownership });
      if (ownership.fullMaster && ownership.loopVersion && ownership.separatedStems && ownership.sheetMusic) {
        hasFullBundleOnAnyTrack = true;
      }
    }

    // Tema deck bawaan berbayar (Olahraga, Matematika, dst.) tidak punya baris di tabel `decks`.
    // Sumber kebenarannya adalah item_type_key berformat "theme:<nama>" yang disimpan saat checkout.
    const quizRows = rows.filter(r => r.item_category === 'quiz');
    const themeFromItemTypeKey = quizRows
      .map(r => {
        const m = /^theme:(.+)$/.exec(String(r.item_type_key || ''));
        return m ? m[1] : null;
      })
      .filter((v): v is string => v !== null);

    const THEME_SLUG_RULES: [RegExp, string][] = [
      [/olahraga/i, 'olahraga'],
      [/sehari.?hari/i, 'sehari_hari'],
      [/\balam\b/i, 'alam'],
      [/musik/i, 'musik'],
      [/matematika/i, 'matematika'],
      [/\bseni\b/i, 'seni'],
      [/teknologi/i, 'teknologi'],
      [/psikologi/i, 'psikologi'],
      [/bahasa/i, 'bahasa'],
      [/sosial/i, 'sosial'],
      [/fiksi/i, 'fiksi'],
    ];
    const themeIdsFromCheckoutBadge = themeFromItemTypeKey
      .map((badge) => {
        const found = THEME_SLUG_RULES.find(([re]) => re.test(badge));
        return found ? found[1] : 'lainnya';
      });

    // Jaring pengaman untuk data LAMA (item_type_key masih 'quizDeck' polos): turunkan dari tabel decks/topics
    // bila barisnya ada, lalu dari item_id (mis. "deck-olahraga-dunia").
    const deckTopicIds = Array.from(
      new Set(dbDecks.map((d) => d.topic_id).filter((id: unknown): id is string => typeof id === 'string' && id.length > 0))
    );
    const allTopicIdsToCheck = Array.from(new Set([...topicIds, ...deckTopicIds]));
    const purchasedTopicRows = allTopicIdsToCheck.length
      ? (await pool.query('SELECT id, title, badge FROM topics WHERE id = ANY($1)', [allTopicIdsToCheck])).rows
      : [];
    const deckBadgeHaystacks = dbDecks.map((d) => `${d.badge || ''} ${d.topic_id || ''}`);
    const purchasedThemeIds = Array.from(new Set([
      ...themeIdsFromCheckoutBadge,
      ...purchasedTopicRows.map((t) => {
        const haystack = `${t.badge || ''} ${t.title || ''}`;
        const found = THEME_SLUG_RULES.find(([re]) => re.test(haystack));
        return found ? found[1] : 'lainnya';
      }),
      ...deckBadgeHaystacks
        .map((haystack) => {
          const found = THEME_SLUG_RULES.find(([re]) => re.test(haystack));
          return found ? found[1] : null;
        })
        .filter((v): v is string => v !== null),
      ...quizRows
        .map((r) => {
          const found = THEME_SLUG_RULES.find(([re]) => re.test(String(r.item_id || '')));
          return found ? found[1] : null;
        })
        .filter((v): v is string => v !== null),
    ]));

    // Bingkai yang terbuka lewat donasi/kontak/bundle dicatat di user_collections (kategori 'frame').
    const frameRows = rows.filter(r => r.item_category === 'frame').map(r => r.item_id);
    const unlockedFrameIds = Array.from(new Set([
      'none',
      ...frameRows,
      ...(hasFullBundleOnAnyTrack && has16BarEditor && hasAudioToolsSuite ? ['frame-bundle'] : []),
    ]));

    const userRow = await pool.query('SELECT active_frame_id FROM users WHERE email = $1', [email]);
    const activeFrameId = userRow.rows[0]?.active_frame_id || 'none';

    res.json({
      features: { full16BarEditor: has16BarEditor, audioToolsSuite: hasAudioToolsSuite, quizEditor: hasQuizEditor },
      audio: { items: audioItems, totalCount: audioItems.length },
      quiz: {
        decks: dbDecks.map(d => ({ ...d, questions: typeof d.questions === 'string' ? JSON.parse(d.questions) : d.questions })),
        deckIds,
        topicIds,
        purchasedThemeIds,
        totalCount: deckIds.length,
      },
      frames: { unlockedIds: unlockedFrameIds, activeId: activeFrameId },
    });
  } catch (error) {
    console.error('Error GET /api/user/collections:', error);
    res.status(500).json({ error: 'Terjadi kesalahan saat memuat data koleksi.' });
  }
});

app.post('/api/user/frame', async (req, res) => {
  const { email, frameId } = req.body || {};
  if (!email || !frameId) return res.status(400).json({ error: 'Data bingkai tidak lengkap.' });
  try {
    // Hanya bingkai yang syaratnya tercatat sebagai baris 'frame' (donasi & masukan) yang dicek di sini.
    // Bingkai tema/bundle dihitung dari pembelian (bukan baris 'frame'), jadi tidak boleh ditolak.
    const gatedFrames = new Set([...DONATION_FRAME_TIERS.map((t) => t.frameId), 'frame-contact']);
    if (gatedFrames.has(String(frameId))) {
      const owned = await pool.query(
        `SELECT 1 FROM public.user_collections WHERE user_email = $1 AND item_category = 'frame' AND item_id = $2 LIMIT 1`,
        [email, frameId]
      );
      if (!owned.rows.length) return res.status(403).json({ error: 'Bingkai ini belum terbuka untuk akunmu.' });
    }
    await pool.query('UPDATE users SET active_frame_id = $1 WHERE email = $2', [frameId, email]);
    res.json({ success: true, frameId });
  } catch (err) {
    console.error('Error menyimpan bingkai:', err);
    res.status(500).json({ error: 'Gagal menyimpan pilihan bingkai.' });
  }
});

const DONATION_FRAME_TIERS = [
  { min: 100000, frameId: 'frame-sultan' },
  { min: 50000, frameId: 'frame-warp' },
  { min: 25000, frameId: 'frame-neon' },
  { min: 10000, frameId: 'frame-coffee' },
];

// Tabel pesanan pembayaran. Rute pembayarannya ada di ./paymentRoutes.ts
async function ensurePaymentTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_orders (
      order_id TEXT PRIMARY KEY,
      user_email TEXT NOT NULL,
      kind TEXT NOT NULL,
      gross_amount INTEGER NOT NULL,
      items JSONB,
      status TEXT NOT NULL DEFAULT 'pending',
      fulfilled BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT,
      snap_token TEXT
    )`);
}

// Kirim langsung sitemap.xml resmi dalam format XML ke Google
app.get('/sitemap.xml', (_req, res) => {
  res.type('application/xml');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
  <url>
    <loc>https://playmuzeck.my.id/</loc>
    <lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <xhtml:link rel="alternate" hreflang="id-ID" href="https://playmuzeck.my.id/" />
    <xhtml:link rel="alternate" hreflang="x-default" href="https://playmuzeck.my.id/" />
  </url>
</urlset>`);
});

// Kirim robots.txt resmi dalam format Plain Text
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: https://playmuzeck.my.id/sitemap.xml`);
});

const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

// Penangan error terakhir: error dari handler async (lihat safeHandler) berakhir di sini, bukan menjatuhkan server.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = Number(err?.status || err?.statusCode) || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error('[server] error tidak tertangani:', err);
  if (res.headersSent) return;
  res.status(status).json({ error: status < 500 ? String(err?.message || 'Permintaan tidak valid.') : 'Terjadi kesalahan pada server.' });
});

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server aktif di http://localhost:${PORT} terhubung ke PostgreSQL.`);
  const ok = (v: unknown) => (v ? '✔' : '✘');
  console.log('--- KESIAPAN LAYANAN ---');
  console.log(`${ok(process.env.RESEND_API_KEY)} RESEND_API_KEY (Layanan Email Resend: Reset Password, Verifikasi, Custom Audio & Feedback)`);
  console.log(`${ok(process.env.APP_URL)} APP_URL`);
  console.log(`${ok(process.env.ADMIN_PASSWORD)} ADMIN_PASSWORD`);
  console.log(`${ok(process.env.GOOGLE_CLIENT_ID)} GOOGLE_CLIENT_ID`);
  console.log(`${ok(process.env.MIDTRANS_SERVER_KEY)} MIDTRANS_SERVER_KEY`);
  console.log(`${ok(process.env.MIDTRANS_CLIENT_KEY)} MIDTRANS_CLIENT_KEY`);
  console.log(`${process.env.NODE_ENV === 'production' ? '✔' : '✘'} NODE_ENV=production (sekarang: ${process.env.NODE_ENV || 'kosong'})`);
});

// Multiplayer: kenali akun login dari cookie sesi saat socket tersambung, supaya blokir host
// berlaku per AKUN (bukan hanya per browser). Memakai requireAuth yang sama dengan route lain.
attachMultiplayerSocket(httpServer, (cookieHeader, handshake) =>
  new Promise<string | null>((resolve) => {
    if (!cookieHeader) return resolve(null);
    const timer = setTimeout(() => resolve(null), 3000);
    const done = (id: string | null) => {
      clearTimeout(timer);
      resolve(id);
    };
    const fakeReq: any = {
      headers: { ...handshake.headers, cookie: cookieHeader },
      query: {},
      body: {},
      method: 'GET',
      ip: handshake.address,
      socket: { remoteAddress: handshake.address },
      get(name: string) {
        return this.headers[String(name).toLowerCase()];
      },
      header(name: string) {
        return this.headers[String(name).toLowerCase()];
      },
    };
    const fakeRes: any = {
      locals: {},
      status() { return fakeRes; },
      json() { done(null); return fakeRes; },
      send() { done(null); return fakeRes; },
      end() { done(null); return fakeRes; },
      set() { return fakeRes; },
      setHeader() { return fakeRes; },
      cookie() { return fakeRes; },
      clearCookie() { return fakeRes; },
    };
    cookieParser()(fakeReq, fakeRes, () => {
      try {
        requireAuth(fakeReq, fakeRes, (err?: unknown) => done(!err && fakeReq.user?.id ? String(fakeReq.user.id) : null));
      } catch {
        done(null);
      }
    });
  })
);
