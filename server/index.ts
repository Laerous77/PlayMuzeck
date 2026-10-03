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
import { createThemeBulkRoutes } from './themeBulkRoutes';

// Definisikan __filename dan __dirname agar ES Module mengenalnya
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const PORT = Number(process.env.PORT) || 8787;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'PlayMuzeck-admin';
if (!process.env.ADMIN_PASSWORD) {
  console.warn('[SECURITY] ADMIN_PASSWORD belum diset di .env — memakai sandi default yang mudah ditebak!');
}

// Daftar admin sekarang tersimpan di tabel `admin_emails` (database), bukan
// hardcode/env lagi — supaya bisa dikelola dari panel admin (lihat
// /api/admin/admins di bawah) tanpa perlu deploy ulang. SUPER_ADMIN_EMAIL
// (frfrareu@gmail.com) SELALU diizinkan apa pun isi tabelnya, dan dialah
// satu-satunya yang boleh menambah/mencabut admin lain.
async function isServerAdminEmail(email: string): Promise<boolean> {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  if (e === SUPER_ADMIN_EMAIL) return true;
  const { rows } = await pool.query('SELECT 1 FROM admin_emails WHERE email = $1', [e]);
  return rows.length > 0;
}

// Dipakai untuk memverifikasi ID token dari Google Sign-In (baik login akun
// biasa di /api/auth/google maupun login admin di /api/admin/google-login).
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
if (!GOOGLE_CLIENT_ID) {
  console.warn('[CONFIG] GOOGLE_CLIENT_ID belum diset di .env — tombol "Masuk dengan Google" tidak akan berfungsi.');
}

/** Verifikasi ID token Google via endpoint resmi Google (tanpa perlu library tambahan). */
async function verifyGoogleIdToken(credential: string): Promise<{ email: string; name: string } | null> {
  if (!credential) { console.error('[google] credential kosong'); return null; }
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('xxxxx')) {
    console.error('[google] GOOGLE_CLIENT_ID server kosong/placeholder. Cek server/.env lalu restart server.');
    return null;
  }
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    const payload: any = await r.json().catch(() => null);
    if (!r.ok || !payload?.email) {
      console.error('[google] tokeninfo menolak token:', r.status, payload);
      return null;
    }
    if (payload.aud !== GOOGLE_CLIENT_ID) {
      console.error('[google] aud tidak cocok.\n  token aud :', payload.aud, '\n  server ID :', GOOGLE_CLIENT_ID);
      return null;
    }
    if (payload.email_verified !== 'true' && payload.email_verified !== true) {
      console.error('[google] email belum terverifikasi:', payload.email);
      return null;
    }
    return { email: String(payload.email).toLowerCase(), name: payload.name || payload.email.split('@')[0] };
  } catch (err) {
    console.error('[google] gagal menghubungi Google (cek Node >= 18 & koneksi internet):', err);
    return null;
  }
}

// ==========================================
// MIDDLEWARE GLOBAL (urutan PENTING: harus sebelum semua route)
// ==========================================
// Di belakang Nginx/Cloudflare/Railway isi TRUST_PROXY=1. Di lokal biarkan 0.
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 1 : 0)));
app.use(helmet({
  // CSP bawaan helmet akan memblokir script Google Sign-In, Midtrans Snap, dan audio dari Supabase.
  // Nyalakan lagi nanti setelah daftar domainnya disusun.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  // Wajib 'same-origin-allow-popups' supaya popup Google Sign-In bisa kirim hasilnya balik.
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
// credentials:true wajib karena sesi sekarang berupa cookie; origin '*' tidak boleh dipakai bersama credentials.
app.use(cors({ origin: (origin, cb) => cb(null, isAllowedOrigin(origin)), credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' })); // kuis dengan media base64 bisa > 100kb (default)
app.use(originGuard);
// Foto profil disajikan sebagai gambar biasa (bukan data URL di JSON) supaya ringan dan bisa
// dipakai pemain lain (mis. Multiplayer menolak data URL & hanya menerima URL http/relatif ≤500 karakter).
// Publik tanpa login: id akun acak (usr_<uuid>) tidak bisa ditebak, dan ?v=<hash> memecah cache saat foto diganti.
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

app.use('/api/auth', authRouter); // login/daftar/verifikasi/reset/google/me/logout (sesi cookie httpOnly)

// ==========================================
// AUTENTIKASI SESI PENGGUNA (cookie httpOnly + tabel `sessions`)
// ==========================================
// Sesi dicek lewat requireAuth (server/auth/authRoutes.ts). Middleware ini membungkusnya supaya
// handler lama yang membaca (req as any).userEmail / req.body.email tetap jalan tanpa diubah:
// email SELALU diambil dari sesi, bukan dari kiriman klien.
const requireUser: express.RequestHandler = (req, res, next) => {
  requireAuth(req, res, (err?: unknown) => {
    if (err) return next(err);
    if (!req.user) return; // requireAuth sudah membalas 401
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

Promise.resolve(initDatabase())
  .then(() => ensurePaymentTables())
  .then(() => ensureThemeSchema(pool)) // tabel themes & user_theme_prefs
  .catch((err) => console.error('[DB] init gagal:', err));

// 1. Folder penyimpanan file fisik (Audio MP3/WAV/M4A/FLAC & PDF)
const uploadsDir = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
// Menggunakan process.cwd() agar aman di ES Module tanpa __dirname
const uploadsFolder = path.resolve(process.cwd(), 'uploads');

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
  const allowedExts = ['.mp3', '.wav', '.m4a', '.flac', '.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format file tidak didukung. Harap unggah MP3, WAV, M4A, FLAC, atau PDF.'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 150 * 1024 * 1024 } });

// Middleware verifikasi Admin Token
// BUG KRITIS SEBELUMNYA: header apa pun berbentuk "Bearer xxx" dianggap admin,
// jadi siapa saja bisa menghapus lagu/kuis, mengekspor data user, dsb.
// Sekarang token harus benar-benar diterbitkan oleh /api/admin/login.
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
interface AdminTokenInfo {
  exp: number;
  email: string | null; // null untuk login lewat kata sandi server (dianggap setara super admin)
  isSuper: boolean;
}
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
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Akses ditolak: token admin tidak ditemukan.' });
  }
  const info = getAdminTokenInfo(auth.slice(7).trim());
  if (!info) {
    return res.status(401).json({ error: 'Token admin tidak valid atau sudah kedaluwarsa. Silakan login admin ulang.' });
  }
  (req as any).adminEmail = info.email;
  (req as any).isSuperAdmin = info.isSuper;
  next();
};
// Dipakai setelah requireAdmin, untuk aksi sensitif (kelola daftar admin lain)
// yang hanya boleh dilakukan super admin (frfrareu@gmail.com) atau siapa pun
// yang masuk lewat kata sandi server (dianggap pemilik/operator server).
const requireSuperAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (!(req as any).isSuperAdmin) {
    return res.status(403).json({ error: 'Hanya Super Admin yang bisa melakukan aksi ini.' });
  }
  next();
};

// ---- Tema: /api/me/theme*, /api/admin/themes*, /api/admin/users/:email/theme ----
// Sebelumnya router ini TIDAK PERNAH dipasang, jadi semua endpoint tema membalas 404.
app.use(createThemeRouter({ db: pool, requireUser, requireAdmin }));

// ---- Tema massal: /api/admin/theme-bulk/* (daftar pengguna, terapkan, reset) + /api/me/notifications* ----
// PERBAIKAN: router ini sebelumnya TIDAK PERNAH dipasang, jadi GET /api/admin/theme-bulk/users membalas 404
// dan daftar pengguna di panel admin selalu kosong ("Belum ada pengguna").
app.use(createThemeBulkRoutes({ pool, requireAdmin, requireSuperAdmin, requireUser }));

// ---- Kepemilikan: admin biasa hanya boleh mengubah audio/kuis BUATANNYA SENDIRI ----
// Super Admin boleh semuanya. Baris lama tanpa owner_email, deck bawaan, dan deck buatan
// pengguna (is_custom) hanya bisa diubah Super Admin.
const OWN_ONLY_MSG = 'Kamu hanya bisa mengubah audio/kuis buatanmu sendiri. Milik admin lain, data lama, dan bawaan hanya bisa diubah Super Admin.';
const adminEmailOf = (req: express.Request): string | null => {
  const e = (req as any).adminEmail;
  return e ? String(e).toLowerCase() : null;
};
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

// Helper format data track PostgreSQL ke bentuk AudioTrackItem
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

// ==========================================
// A. AUTHENTICATION ADMIN
// ==========================================
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  const a = Buffer.from(String(password || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
    // Kata sandi server dianggap setara super admin (pemilik/operator server).
    return res.json({ token: issueAdminToken(null, true) });
  }
  return res.status(401).json({ error: 'Kata sandi admin salah.' });
});

// Login admin lewat akun Google SUNGGUHAN (tombol "Masuk dengan Google" di
// /admin). PERBAIKAN KRITIS: versi sebelumnya menerima `email` mentah dari
// body request dan mempercayainya begitu saja — artinya siapa pun bisa POST
// {"email":"frfrareu@gmail.com"} tanpa bukti apa pun dan mendapat token admin.
// Sekarang klien wajib mengirim `credential` (ID token JWT asli dari Google
// Identity Services), dan server memverifikasinya ke Google sebelum mengecek
// apakah emailnya ada di daftar admin.
app.post('/api/admin/google-login', async (req, res) => {
  try {
    const { credential } = req.body || {};
    const verified = await verifyGoogleIdToken(String(credential || ''));
    if (!verified) {
      return res.status(401).json({ error: 'Token Google tidak valid atau tidak bisa diverifikasi.' });
    }
    if (!(await isServerAdminEmail(verified.email))) {
      return res.status(403).json({ error: `Akses ditolak: email "${verified.email}" bukan Administrator terdaftar.` });
    }
    const token = issueAdminToken(verified.email, verified.email === SUPER_ADMIN_EMAIL);
    res.json({ token, email: verified.email });
  } catch (err) {
    console.error('[admin] google-login error:', err);
    res.status(500).json({ error: 'Gagal memproses login Google.' });
  }
});

// Login admin memakai sesi login SITUS UTAMA yang sedang aktif (dipakai saat
// pengguna sudah login di halaman klien lalu memilih "Masuk sebagai Admin").
// Alih-alih mempercayai email yang dikirim klien, endpoint ini memverifikasi
// SESI cookie asli (tabel `sessions`, diterbitkan /api/auth/login atau /api/auth/google)
// sehingga emailnya dijamin benar-benar milik sesi yang sedang login.
app.post('/api/admin/session-login', requireAuth, async (req, res) => {
  const email = String(req.user!.email).toLowerCase();
  if (!(await isServerAdminEmail(email))) {
    return res.status(403).json({ error: `Akses ditolak: email "${email}" bukan Administrator terdaftar.` });
  }
  const token = issueAdminToken(email, email === SUPER_ADMIN_EMAIL);
  res.json({ token, email });
});

app.post('/api/admin/logout', (req, res) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) adminTokens.delete(auth.slice(7).trim());
  res.json({ success: true });
});

// Info admin yang sedang login (dipakai UI untuk menampilkan email & apakah
// dia super admin, misalnya untuk menampilkan/menyembunyikan panel kelola admin).
app.get('/api/admin/me', requireAdmin, (req, res) => {
  res.json({ email: (req as any).adminEmail || null, isSuperAdmin: Boolean((req as any).isSuperAdmin) });
});

// ==========================================
// A2. AUTENTIKASI PENGGUNA (LOGIN & REGISTER SUNGGUHAN)
// ==========================================
// PERBAIKAN: sebelumnya "login" di frontend cuma memvalidasi format email &
// panjang kata sandi di sisi klien lalu langsung meloloskan siapapun tanpa
// pernah mengecek ke database — artinya SEMUA kata sandi untuk email manapun
// dianggap benar, dan tidak ada perbedaan nyata antar akun. Sekarang kata
// sandi di-hash dengan bcrypt & benar-benar dicocokkan ke tabel `users`.

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ''));

// Route /api/auth/* (signup, verify-email, login, forgot/reset-password, google, me, logout)
// sekarang ada di server/auth/authRoutes.ts. Route lama (register, login, forgot-password,
// reset-password, google) DIHAPUS, termasuk /api/auth/demo-login yang bisa masuk ke akun
// tanpa kata sandi.

// ==========================================
// B. ADMIN TRACKS & AUDIO UPLOADS (AudioPage)
// ==========================================
app.get('/api/admin/tracks', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audio_tracks ORDER BY id DESC');
    res.json(rows.map(mapAdminTrack));
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil data katalog audio.' });
  }
});

app.post('/api/admin/tracks', requireAdmin, async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah track baru.' });
  }
});

app.put('/api/admin/tracks/:id', requireAdmin, async (req, res) => {
  try {
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
    if (!rows.length) return res.status(404).json({ error: 'Track tidak ditemukan.' });
    res.json(mapAdminTrack(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui katalog audio.' });
  }
});

app.delete('/api/admin/tracks/:id', requireAdmin, async (req, res) => {
  try {
    if (!(await guardTrack(req, res, req.params.id))) return;
    await pool.query('DELETE FROM audio_tracks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus track.' });
  }
});

app.post('/api/admin/tracks/:id/audio', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    if (!(await guardTrack(req, res, req.params.id))) return;
    const { id } = req.params;
    const { kind, stemId, duration } = req.query as { kind: string; stemId?: string; duration?: string };

    if (!req.file) return res.status(400).json({ error: 'Tidak ada berkas yang diunggah.' });

    const fileUrl = await uploadToSupabase(req.file.buffer, req.file.originalname, req.file.mimetype);
    const { rows } = await pool.query('SELECT * FROM audio_tracks WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Track target tidak ditemukan.' });

    const currentTrack = rows[0];
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
      const stems = typeof currentTrack.stems === 'string' ? JSON.parse(currentTrack.stems) : currentTrack.stems || [];
      const updatedStems = stems.map((s: any) => (s.id === stemId ? { ...s, audioUrl: fileUrl } : s));
      query = 'UPDATE audio_tracks SET stems = $1 WHERE id = $2 RETURNING *;';
      params = [JSON.stringify(updatedStems), id];
    } else {
      return res.status(400).json({ error: 'Jenis berkas unggahan tidak valid.' });
    }

    const updated = await pool.query(query, params);
    res.json(mapAdminTrack(updated.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memproses berkas audio.' });
  }
});

app.delete('/api/admin/tracks/:id/file', requireAdmin, async (req, res) => {
  try {
    if (!(await guardTrack(req, res, req.params.id))) return;
    const { id } = req.params;
    const { kind, stemId } = req.query as { kind: string; stemId?: string };

    let query = '';
    let params: any[] = [id];

    if (kind === 'master') {
      query = 'UPDATE audio_tracks SET audio_url = NULL WHERE id = $1 RETURNING *;';
    } else if (kind === 'loop') {
      query = 'UPDATE audio_tracks SET loop_audio_url = NULL WHERE id = $1 RETURNING *;';
    } else if (kind === 'sheet') {
      query = 'UPDATE audio_tracks SET sheet_music_url = NULL WHERE id = $1 RETURNING *;';
    } else if (kind === 'cover') {
      query = 'UPDATE audio_tracks SET cover_image_url = NULL WHERE id = $1 RETURNING *;';
    } else if (kind === 'stem' && stemId) {
      const { rows } = await pool.query('SELECT stems FROM audio_tracks WHERE id = $1', [id]);
      const stems = typeof rows[0]?.stems === 'string' ? JSON.parse(rows[0].stems) : rows[0]?.stems || [];
      const updatedStems = stems.map((s: any) => (s.id === stemId ? { ...s, audioUrl: null } : s));
      query = 'UPDATE audio_tracks SET stems = $1 WHERE id = $2 RETURNING *;';
      params = [JSON.stringify(updatedStems), id];
    }

    const updated = await pool.query(query, params);
    res.json(mapAdminTrack(updated.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal menghapus berkas' });
  }
});

// ==========================================
// C. ADMIN TOPIK & DECKS (ContentPage)
// ==========================================
app.get('/api/admin/topics', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM topics ORDER BY id ASC');
    res.json(rows.map(t => ({
      id: t.id, title: t.title, iconName: t.icon_name,
      description: t.description, price: t.price, originalPrice: t.original_price, badge: t.badge
    })));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat topik kuis.' });
  }
});

app.post('/api/admin/topics', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const t = req.body;
    const topicId = t.id || `topic-${Date.now()}`;
    const query = `
      INSERT INTO topics (id, title, icon_name, description, price, original_price, badge)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *;
    `;
    const { rows } = await pool.query(query, [
      topicId, t.title, t.iconName || 'Sparkles', t.description || '',
      Number(t.price) || 0, Number(t.originalPrice) || 0, t.badge || ''
    ]);
    const saved = rows[0];
    res.status(201).json({ id: saved.id, title: saved.title, iconName: saved.icon_name, description: saved.description, price: saved.price, originalPrice: saved.original_price, badge: saved.badge });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan topik.' });
  }
});

app.put('/api/admin/topics/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const t = req.body;
    const query = `
      UPDATE topics SET title = $1, icon_name = $2, description = $3, price = $4, original_price = $5, badge = $6
      WHERE id = $7 RETURNING *;
    `;
    const { rows } = await pool.query(query, [t.title, t.iconName, t.description, Number(t.price) || 0, Number(t.originalPrice) || 0, t.badge, id]);
    const saved = rows[0];
    res.json({ id: saved.id, title: saved.title, iconName: saved.icon_name, description: saved.description, price: saved.price, originalPrice: saved.original_price, badge: saved.badge });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui topik.' });
  }
});

app.delete('/api/admin/topics/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM topics WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus topik.' });
  }
});

// Pemetaan baris deck -> payload admin. `isCustom`/`ownerEmail` membedakan
// kuis buatan admin (is_custom FALSE) dari kuis buatan pengguna (is_custom TRUE).
const mapAdminDeck = (d: any) => ({
  id: d.id, topicId: d.topic_id || '', title: d.title, description: d.description,
  cardCount: d.card_count, difficulty: d.difficulty, isFree: Boolean(d.is_free),
  price: d.price, badge: d.badge, settings: d.settings || {},
  isCustom: d.is_custom === true, ownerEmail: d.owner_email || null,
  questions: typeof d.questions === 'string' ? JSON.parse(d.questions) : d.questions || [],
});

app.get('/api/admin/decks', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM decks ORDER BY COALESCE(is_custom, FALSE), id ASC');
    res.json(rows.map(mapAdminDeck));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat deck kuis.' });
  }
});

app.post('/api/admin/decks', requireAdmin, async (req, res) => {
  try {
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
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan deck kuis.' });
  }
});

app.put('/api/admin/decks/:id', requireAdmin, async (req, res) => {
  try {
    if (!(await guardDeck(req, res, req.params.id))) return;
    const { id } = req.params;
    const d = req.body;
    const questions = Array.isArray(d.questions) ? d.questions : [];
    const query = `
      UPDATE decks SET topic_id = $1, title = $2, description = $3, card_count = $4, difficulty = $5, is_free = $6, price = $7, badge = $8, questions = $9,
        settings = COALESCE($10::jsonb, settings)
      WHERE id = $11 RETURNING *;
    `;
    // Kalau klien tidak mengirim settings, nilai lama dibiarkan (tidak ditimpa {}).
    const settingsJson = d.settings && typeof d.settings === 'object' ? JSON.stringify(d.settings) : null;
    const { rows } = await pool.query(query, [
      d.topicId || null, d.title, d.description || '', questions.length, d.difficulty, Boolean(d.isFree), Number(d.price) || 0, d.badge || '', JSON.stringify(questions), settingsJson, id
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Deck tidak ditemukan.' });
    res.json(mapAdminDeck(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui deck kuis.' });
  }
});

app.delete('/api/admin/decks/:id', requireAdmin, async (req, res) => {
  try {
    if (!(await guardDeck(req, res, req.params.id))) return;
    await pool.query('DELETE FROM decks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus deck.' });
  }
});

// Import JSON konten kuis secara instan
app.post('/api/admin/import-content', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { topics = [], decks = [] } = req.body;
    for (const t of topics) {
      await pool.query(`
        INSERT INTO topics (id, title, icon_name, description, price, original_price, badge)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description;
      `, [t.id, t.title, t.iconName || 'Sparkles', t.description || '', Number(t.price) || 0, Number(t.originalPrice) || 0, t.badge || '']);
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
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengimpor file JSON.' });
  }
});

// ==========================================
// D. ANALYTICS, OPS, & SETTINGS (Dasbor Admin)
// ==========================================
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
    console.error('[admin] analytics:', err);
    res.status(500).json({ error: 'Gagal memuat analitik.' });
  }
});

app.post('/api/admin/clear-analytics', requireAdmin, requireSuperAdmin, async (_req, res) => {
  await pool.query('DELETE FROM analytics_events');
  res.json({ success: true });
});

app.get('/api/admin/orders', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  res.json(rows.map(o => ({
    id: o.id, customer_name: o.customer_name, customer_email: o.customer_email,
    total: o.total, status: o.status, created_at: o.created_at,
    items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items || []
  })));
});

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

const GLOBAL_KEYS = new Set(['fullEditor8Bar', 'audioToolsSuite', 'quizCreatorSuite']);
const refKey = (r: CollectionRef) => (GLOBAL_KEYS.has(r.typeKey) ? `G|${r.typeKey}` : `${r.category}|${r.id}|${r.typeKey}`);

// Fitur permanen cukup SATU baris per akun, berapa kali pun dibeli.
async function insertRef(client: any, email: string, r: CollectionRef) {
  if (GLOBAL_KEYS.has(r.typeKey)) {
    const ex = await client.query(
      `SELECT 1 FROM public.user_collections WHERE user_email = $1 AND item_type_key = $2 LIMIT 1`,
      [email, r.typeKey]
    );
    if (ex.rowCount) return;
  }
  await client.query(
    `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [email, r.category, r.id, r.typeKey]
  );
}

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
    for (const r of await collectionRefsForItems(client, items)) await insertRef(client, email, r);
  }

  await client.query(
    `INSERT INTO orders (id, customer_email, customer_name, items, total, status)
     VALUES ($1, $2::varchar, (SELECT name FROM users WHERE email = $2::varchar), $3::jsonb, $4::int, 'completed')
     ON CONFLICT (id) DO UPDATE SET items = EXCLUDED.items, total = EXCLUDED.total, status = 'completed'`,
    [`pay_${order.order_id}`, email, JSON.stringify(items), Number(order.gross_amount) || 0]
  );
}

async function revokeOrderAccess(client: any, order: any) {
  const items: any[] = typeof order.items === 'string' ? JSON.parse(order.items) : order.items || [];
  const email = order.user_email;

  if (order.kind === 'donation') {
    await client.query('DELETE FROM donations WHERE id = $1', [`don_${order.order_id}`]);
    const { rows } = await client.query('SELECT COALESCE(MAX(amount),0) AS biggest FROM donations WHERE user_email = $1', [email]);
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
        for (const r of await collectionRefsForItems(client, its)) keep.add(refKey(r));
      } catch { /* abaikan item tak dikenali */ }
    }
    for (const r of mine) {
      if (keep.has(refKey(r))) continue;
      if (GLOBAL_KEYS.has(r.typeKey)) {
        await client.query(`DELETE FROM public.user_collections WHERE user_email = $1 AND item_type_key = $2`, [email, r.typeKey]);
      } else {
        await client.query(
          `DELETE FROM public.user_collections WHERE user_email = $1 AND item_category = $2 AND item_id = $3 AND item_type_key = $4`,
          [email, r.category, r.id, r.typeKey]
        );
      }
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
  expires_at: o.expires_at ?? null,
  cancelled_at: o.cancelled_at ?? null,
  cancel_reason: o.cancel_reason ?? null,
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

const NO_OWN: AudioOwn = { fullMaster: false, loopVersion: false, separatedStems: false, sheetMusic: false, fullEditor8Bar: false, audioToolsSuite: false };
const TRACK_KEYS = ['fullMaster', 'loopVersion', 'separatedStems', 'sheetMusic'];

app.get('/api/admin/product-catalog', requireAdmin, async (_req, res) => {
  try {
    const [tr, dk, tp] = await Promise.all([
      pool.query('SELECT id, title, artist, price FROM audio_tracks ORDER BY title'),
      pool.query(`SELECT id, topic_id, title, price, badge, is_free FROM decks WHERE COALESCE(is_custom, FALSE) = FALSE ORDER BY title`),
      pool.query('SELECT id, title, price, badge FROM topics ORDER BY title'),
    ]);
    res.json({
      tracks: tr.rows.map((t) => {
        const c = calcAudioPricing(Number(t.price) || 70000, NO_OWN);
        return { id: t.id, title: t.title, artist: t.artist, products: c.products, bundle: c.bundle };
      }),
      decks: dk.rows.map((d) => ({ ...d, price: Number(d.price) || 0 })),
      topics: tp.rows.map((t) => ({ ...t, price: Number(t.price) || 0 })),
      features: {
        editor8Bar: calcAudioPricing(70000, NO_OWN).products.fullEditor8Bar,
        audioTools: calcAudioPricing(70000, NO_OWN).products.audioToolsSuite,
        quizCreator: CREATOR_SUITE_PRICE,
      },
    });
  } catch (err) {
    console.error('[admin] product-catalog:', err);
    res.status(500).json({ error: 'Gagal memuat katalog produk.' });
  }
});

// Ubah referensi ringan dari form -> item pesanan kanonik. Semua produk DIVALIDASI ke database
// dan harganya dihitung server (tidak percaya angka dari browser).
async function buildManualItems(db: { query: (q: string, p?: any[]) => Promise<any> }, raw: any[]) {
  const items: any[] = [];
  const seen = new Set<string>();
  let total = 0;
  const add = (dedupe: string, item: any) => {
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    items.push(item);
    total += Number(item.price) || 0;
  };

  for (const r of raw.slice(0, 100)) {
    const kind = String(r?.kind || '');
    if (kind === 'audio') {
      const trackId = String(r.trackId || '');
      const t = await db.query('SELECT id, title, price FROM audio_tracks WHERE id = $1', [trackId]);
      if (!t.rows[0]) throw new Error(`Track "${trackId}" tidak ada di database.`);
      const calc = calcAudioPricing(Number(t.rows[0].price) || 70000, NO_OWN);
      if (r.bundle) {
        add(`audio|${trackId}|all`, { category: 'audio', id: trackId, trackId, itemTypeKey: 'all', title: t.rows[0].title, price: calc.bundle });
      } else {
        const keys: string[] = (Array.isArray(r.keys) ? r.keys : []).map(String);
        if (!keys.length) throw new Error('Pilih minimal satu jenis produk audio.');
        for (const k of keys) {
          if (!TRACK_KEYS.includes(k)) throw new Error(`Jenis produk audio "${k}" tidak dikenali.`);
          add(`audio|${trackId}|${k}`, { category: 'audio', id: trackId, trackId, itemTypeKey: k, title: t.rows[0].title, price: calc.products[k as keyof AudioOwn] });
        }
      }
    } else if (kind === 'editor8Bar') {
      add('G|fullEditor8Bar', { category: 'audio', id: 'feature-editor-8bar', trackId: 'feature-editor-8bar', itemTypeKey: 'fullEditor8Bar', title: 'Editor 8 Bar (permanen)', price: NO_OWN_PRICES.editor });
    } else if (kind === 'audioTools') {
      add('G|audioToolsSuite', { category: 'audio', id: 'feature-audio-tools', trackId: 'feature-audio-tools', itemTypeKey: 'audioToolsSuite', title: 'Audio Tools (permanen)', price: NO_OWN_PRICES.tools });
    } else if (kind === 'quizCreator') {
      add('G|quizCreatorSuite', { category: 'feature', id: 'quiz-creator-suite', itemTypeKey: 'quizCreatorSuite', title: 'Kreator Kuis (permanen)', price: CREATOR_SUITE_PRICE });
    } else if (kind === 'deck') {
      const d = await db.query(`SELECT id, title, price, badge FROM decks WHERE id = $1 AND COALESCE(is_custom, FALSE) = FALSE`, [String(r.deckId || '')]);
      if (!d.rows[0]) throw new Error(`Deck "${r.deckId}" tidak ada di database.`);
      add(`deck|${d.rows[0].id}`, { category: 'deck', id: d.rows[0].id, deckId: d.rows[0].id, title: d.rows[0].title, badge: d.rows[0].badge || undefined, price: Number(d.rows[0].price) || 0 });
    } else if (kind === 'topic') {
      const t = await db.query('SELECT id, title, price FROM topics WHERE id = $1', [String(r.topicId || '')]);
      if (!t.rows[0]) throw new Error(`Topik "${r.topicId}" tidak ada di database.`);
      add(`topic|${t.rows[0].id}`, { category: 'topic', id: t.rows[0].id, topicId: t.rows[0].id, title: t.rows[0].title, price: Number(t.rows[0].price) || 0 });
    } else {
      throw new Error(`Jenis produk "${kind}" tidak dikenali.`);
    }
  }
  return { items, total };
}
const NO_OWN_PRICES = {
  editor: calcAudioPricing(70000, NO_OWN).products.fullEditor8Bar,
  tools: calcAudioPricing(70000, NO_OWN).products.audioToolsSuite,
};

// CREATE pesanan manual — pesanan manual sekarang hanya menerima
// produk yang ada di DB, pengguna harus sudah terdaftar, dan nominal otomatis dari harga server.
app.post('/api/admin/payment-orders', requireAdmin, requireSuperAdmin, async (req, res) => {
  const email = String(req.body?.user_email || '').trim().toLowerCase();
  const kind = req.body?.kind === 'donation' ? 'donation' : 'cart';
  const status = MANUAL_STATUSES.includes(req.body?.status) ? req.body.status : 'pending';
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email pengguna tidak valid.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query('SELECT 1 FROM users WHERE lower(email) = $1', [email]);
    if (!u.rowCount) throw new Error('Pengguna belum terdaftar di database. Buat akunnya dulu di tab Pengguna.');
    const accountEmail = (await client.query('SELECT email FROM users WHERE lower(email) = $1', [email])).rows[0].email;

    let storedItems: any[];
    let gross: number;
    const override = req.body?.gross_amount;
    const hasOverride = override !== null && override !== undefined && override !== '';
    if (kind === 'donation') {
      gross = Math.max(0, Math.round(Number(override) || 0));
      if (gross <= 0) throw new Error('Nominal donasi harus lebih dari 0.');
      storedItems = [{ category: 'donation', price: gross }];
    } else {
      const raw = Array.isArray(req.body?.items) ? req.body.items : [];
      if (!raw.length) throw new Error('Pilih minimal satu produk.');
      const built = await buildManualItems(client, raw);
      storedItems = built.items;
      gross = hasOverride ? Math.max(0, Math.round(Number(override) || 0)) : built.total;
      await collectionRefsForItems(client, storedItems); // validasi terakhir
    }

    const orderId = `man_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await client.query(
      `INSERT INTO payment_orders (order_id, user_email, kind, gross_amount, items, status, fulfilled) VALUES ($1, $2, $3, $4, $5, $6, FALSE)`,
      [orderId, accountEmail, kind, gross, JSON.stringify(storedItems), status]
    );
    if (status === 'paid') {
      await grantOrderAccess(client, { order_id: orderId, user_email: accountEmail, kind, gross_amount: gross, items: storedItems });
      await client.query('UPDATE payment_orders SET fulfilled = TRUE WHERE order_id = $1', [orderId]);
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, order_id: orderId, gross_amount: gross });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] create payment-order:', err);
    res.status(400).json({ error: err?.message || 'Gagal membuat pesanan.' });
  } finally {
    client.release();
  }
});

// UPDATE: ubah status (dan nominal). paid -> beri akses; keluar dari paid -> cabut akses.
app.patch('/api/admin/payment-orders/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
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

    // Pesanan Midtrans yang masih menunggu dibatalkan admin -> transaksi di Midtrans ikut dibatalkan (best-effort).
    if (newStatus === 'cancelled' && order.status === 'pending' && !String(order.order_id).startsWith('man_')) {
      await midtransCancel(order.order_id);
    }

    if (wasAccess && newStatus !== 'paid') {
      if (req.body?.revoke !== false) await revokeOrderAccess(client, order);
      await client.query('UPDATE payment_orders SET status = $1, gross_amount = $2, fulfilled = FALSE WHERE order_id = $3', [newStatus, newAmount, order.order_id]);
    } else if (newStatus === 'paid') {
      await grantOrderAccess(client, next);
      await client.query('UPDATE payment_orders SET status = $1, gross_amount = $2, fulfilled = TRUE WHERE order_id = $3', [newStatus, newAmount, order.order_id]);
    } else {
      await client.query('UPDATE payment_orders SET status = $1, gross_amount = $2 WHERE order_id = $3', [newStatus, newAmount, order.order_id]);
    }
    if (newStatus === 'cancelled') {
      await client.query(
        `UPDATE payment_orders SET cancelled_at = COALESCE(cancelled_at, NOW()), cancel_reason = COALESCE(cancel_reason, 'dibatalkan admin'), snap_token = NULL WHERE order_id = $1`,
        [order.order_id]
      );
    } else if (newStatus === 'pending' && order.status !== 'pending') {
      // Dikembalikan ke Menunggu oleh admin: beri batas bayar baru supaya tidak langsung disapu.
      await client.query(
        `UPDATE payment_orders SET cancelled_at = NULL, cancel_reason = NULL, expires_at = NOW() + ($2 || ' minutes')::interval WHERE order_id = $1`,
        [order.order_id, String(PENDING_ORDER_TTL_MIN)]
      );
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
app.delete('/api/admin/payment-orders/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
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

// ==========================================
// CUSTOM AUDIO / PESAN MASUK (tabel inquiries) — CRUD penuh.
// Nilai status di DB: 'baru' (Menunggu), 'proses' (Diproses), 'selesai' (Selesai).
// ==========================================
const INQUIRY_STATUSES = ['baru', 'proses', 'selesai'];

app.get('/api/admin/inquiries', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM inquiries ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('[admin] inquiries:', err);
    res.status(500).json({ error: 'Gagal memuat permintaan.' });
  }
});

app.post('/api/admin/inquiries', requireAdmin, requireSuperAdmin, async (req, res) => {
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
    console.error('[admin] create inquiry:', err);
    res.status(500).json({ error: err?.message || 'Gagal membuat permintaan.' });
  }
});

app.patch('/api/admin/inquiries/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const b = req.body || {};
    if (b.status !== undefined && !INQUIRY_STATUSES.includes(b.status)) return res.status(400).json({ error: 'Status tidak valid.' });
    const cols: Array<[string, string, number]> = [
      ['status', 'status', 50], ['title', 'title', 255], ['email', 'email', 255],
      ['genre', 'genre', 100], ['mood', 'mood', 100], ['notes', 'notes', 20000],
    ];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const [key, col, max] of cols) {
      if (b[key] !== undefined) { vals.push(String(b[key]).slice(0, max)); sets.push(`${col} = $${vals.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE inquiries SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    if (!r.rowCount) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin] patch inquiry:', err);
    res.status(500).json({ error: err?.message || 'Gagal memperbarui permintaan.' });
  }
});

app.delete('/api/admin/inquiries/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM inquiries WHERE id = $1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Permintaan tidak ditemukan.' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin] delete inquiry:', err);
    res.status(500).json({ error: err?.message || 'Gagal menghapus permintaan.' });
  }
});

// ==========================================
// PENGGUNA (tabel users) — CRUD murni dari database. password_hash TIDAK PERNAH dikirim ke browser.
// Email tidak bisa diubah: tabel lain (koleksi, donasi, pesanan) merujuk ke email.
// ==========================================
const USER_ROLES = ['user', 'admin'];

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.role, u.active_frame_id, u.created_at, u.last_seen,
              u.suspended_at, u.suspended_reason, u.email_verified_at,
              (u.password_hash IS NOT NULL) AS has_password,
              (u.google_sub IS NOT NULL) AS has_google,
              (SELECT COUNT(*) FROM public.user_collections c WHERE c.user_email = u.email AND c.item_category <> 'frame')::int AS owned_items,
              (SELECT COUNT(*) FROM payment_orders p WHERE p.user_email = u.email AND p.status = 'paid')::int AS paid_orders
       FROM users u ORDER BY u.created_at DESC`
    );
    res.json(rows.map((u) => ({ ...u, last_seen: u.last_seen || u.created_at, is_super_admin: u.email === SUPER_ADMIN_EMAIL })));
  } catch (err) {
    console.error('[admin] users:', err);
    res.status(500).json({ error: 'Gagal memuat pengguna.' });
  }
});

app.post('/api/admin/users', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { email, name, role, password } = req.body || {};
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) return res.status(400).json({ error: 'Alamat email tidak valid.' });
    if (password && String(password).length < 4) return res.status(400).json({ error: 'Kata sandi minimal 4 karakter.' });
    const exists = await pool.query('SELECT 1 FROM users WHERE LOWER(email) = $1', [cleanEmail]);
    if (exists.rows.length) return res.status(409).json({ error: 'Email ini sudah terdaftar.' });
    const hash = password ? await bcrypt.hash(String(password), 10) : null;
    const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    // email_verified_at diisi: akun buatan admin tidak perlu verifikasi email lagi, jadi bisa langsung login.
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

app.patch('/api/admin/users/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const { name, role, password } = req.body || {};
    if (role !== undefined && !USER_ROLES.includes(role)) return res.status(400).json({ error: 'Role tidak valid.' });
    if (password && String(password).length < 4) return res.status(400).json({ error: 'Kata sandi minimal 4 karakter.' });
    const sets: string[] = [];
    const vals: any[] = [];
    if (name !== undefined) { vals.push(String(name).trim().slice(0, 255)); sets.push(`name = $${vals.length}`); }
    if (role !== undefined) { vals.push(role); sets.push(`role = $${vals.length}`); }
    if (password) { vals.push(await bcrypt.hash(String(password), 10)); sets.push(`password_hash = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'Tidak ada perubahan.' });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals);
    if (!r.rowCount) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin] patch user:', err);
    res.status(500).json({ error: err?.message || 'Gagal memperbarui pengguna.' });
  }
});

// Menghapus pengguna ikut menghapus koleksi, donasi, dan token reset miliknya (ON DELETE CASCADE).
// Riwayat pesanan (payment_orders / orders) tetap ada.
app.delete('/api/admin/users/:id', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const found = await pool.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
    if (!found.rows[0]) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    if (found.rows[0].email === SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Akun Super Admin tidak bisa dihapus.' });
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin] delete user:', err);
    res.status(500).json({ error: err?.message || 'Gagal menghapus pengguna.' });
  }
});

app.post('/api/admin/users/:id/suspend', requireAdmin, requireSuperAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const reason = String(req.body?.reason || '').trim().slice(0, 500);
    const found = await client.query('SELECT email FROM users WHERE id = $1', [req.params.id]);
    if (!found.rows[0]) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    const email = found.rows[0].email;
    if (email === SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Akun Super Admin tidak bisa ditangguhkan.' });
    if (await isServerAdminEmail(email)) return res.status(403).json({ error: 'Akun ini admin. Cabut akses adminnya dulu di menu Admin & Akses.' });

    await client.query('BEGIN');
    await client.query(
      `UPDATE users SET suspended_at = NOW(), suspended_reason = $2 WHERE id = $1`,
      [req.params.id, reason || null]
    );
    await client.query('DELETE FROM sessions WHERE user_id = $1', [req.params.id]); // langsung ter-logout
    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[admin] suspend user:', err);
    res.status(500).json({ error: err?.message || 'Gagal menangguhkan akun.' });
  } finally {
    client.release();
  }
});

app.post('/api/admin/users/:id/restore', requireAdmin, requireSuperAdmin, async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = $1`,
      [req.params.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin] restore user:', err);
    res.status(500).json({ error: err?.message || 'Gagal mengaktifkan kembali akun.' });
  }
});

// Kirim email ke pengguna lewat SMTP yang SAMA dengan email verifikasi/reset password (sendMailStrict di authRoutes.ts).
app.post('/api/admin/users/:id/email', requireAdmin, requireSuperAdmin, async (req, res) => {
  const subject = String(req.body?.subject || '').trim().slice(0, 200);
  const message = String(req.body?.message || '').trim().slice(0, 5000);
  if (!subject || !message) return res.status(400).json({ error: 'Subjek dan isi pesan wajib diisi.' });
  try {
    const found = await pool.query('SELECT email, name FROM users WHERE id = $1', [req.params.id]);
    const user = found.rows[0];
    if (!user) return res.status(404).json({ error: 'Pengguna tidak ditemukan.' });

    if (!process.env.SMTP_HOST) {
      return res.status(503).json({ error: 'Email server belum aktif: SMTP_HOST (dan SMTP_PORT / SMTP_USER / SMTP_PASS / alamat pengirim) belum diisi di .env server. Pakai tombol "Buka Gmail" / "Buka di aplikasi email" sebagai gantinya.' });
    }
    await sendMailStrict(user.email, subject, message);
    await pool.query('INSERT INTO analytics_events (id, event_type, payload) VALUES ($1, $2, $3)', [
      `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      'admin_email',
      JSON.stringify({ to: user.email, subject, by: (req as any).adminEmail || 'server-password' }),
    ]);
    res.json({ success: true });
  } catch (err: any) {
    console.error('[admin] email user:', err);
    res.status(500).json({ error: err?.message || 'Gagal mengirim email.' });
  }
});

// Detail satu pembeli: semua pesanan (id, status, tanggal, isi) + produk yang saat ini dimiliki.
app.get('/api/admin/buyers/:email', requireAdmin, async (req, res) => {
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
      orders: orders.rows.map(mapPaymentOrder),
      owned: owned.rows.map((r) => ({
        category: r.item_category, id: r.item_id, type_key: r.item_type_key,
        title: r.title || r.item_id, purchased_at: r.purchased_at,
      })),
    });
  } catch (err) {
    console.error('[admin] buyer detail:', err);
    res.status(500).json({ error: 'Gagal memuat detail pembeli.' });
  }
});


// ==========================================
// KELOLA DAFTAR ADMIN (hanya Super Admin: frfrareu@gmail.com, atau login
// lewat kata sandi server, yang boleh menambah/mencabut). Admin lain hanya
// bisa melihat daftarnya (transparan), tidak bisa mengubahnya.
// ==========================================
app.get('/api/admin/admins', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT email, granted_by, created_at FROM admin_emails ORDER BY created_at ASC');
  res.json(
    rows.map((r) => ({
      email: r.email,
      grantedBy: r.granted_by,
      createdAt: r.created_at,
      isSuperAdmin: r.email === SUPER_ADMIN_EMAIL,
    }))
  );
});

app.post('/api/admin/admins', requireAdmin, requireSuperAdmin, async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Alamat email tidak valid.' });
  }
  const grantedBy = (req as any).adminEmail || 'password-admin';
  await pool.query(
    'INSERT INTO admin_emails (email, granted_by) VALUES ($1, $2) ON CONFLICT (email) DO NOTHING',
    [email, grantedBy]
  );
  res.json({ success: true });
});

app.delete('/api/admin/admins/:email', requireAdmin, requireSuperAdmin, async (req, res) => {
  const email = String(req.params.email || '').trim().toLowerCase();
  if (email === SUPER_ADMIN_EMAIL) {
    return res.status(400).json({ error: 'Super Admin tidak bisa dicabut.' });
  }
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

// ==========================================
// E. RUTE PUBLIK (DIPANGGIL OLEH FRONTEND CLIENT)
// ==========================================
app.get('/api/public/catalog', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audio_tracks WHERE is_published = TRUE ORDER BY id DESC');
    const catalog = rows.map((t) => {
      const trackData = mapTrackRow(t);
      const basePrice = Math.max(50000, Number(trackData.price) || 50000);
      return {
        ...trackData,
        price: basePrice, // Menyimpan Harga Dasar Bundle
        pricingBreakdown: computePricing(basePrice, false),
      };
    });
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat catalog' });
  }
});

app.get('/api/public/topics', async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM topics ORDER BY id ASC');
  res.json(rows.map(t => ({ id: t.id, title: t.title, iconName: t.icon_name, description: t.description, price: t.price, originalPrice: t.original_price, badge: t.badge })));
});

app.get('/api/public/decks', async (_req, res) => {
  // PERBAIKAN: sebelumnya endpoint ini mengambil SEMUA baris di tabel `decks`,
  // termasuk deck kustom (is_custom = TRUE) milik pengguna lain hasil Quiz
  // Editor. Akibatnya kuis buatan satu pemain ikut muncul di Perpustakaan
  // Kuis pemain lain, padahal seharusnya deck kustom itu privat untuk
  // pembuatnya saja (diakses lewat /api/user/collections). Sekarang hanya
  // deck resmi/bawaan (is_custom bukan TRUE) yang tampil di daftar publik.
  const { rows } = await pool.query(
    "SELECT * FROM decks WHERE is_custom IS NOT TRUE ORDER BY id ASC"
  );
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
    // Frontend (analytics.ts) mengirim `eventType`, bukan `event` -> sebelumnya SEMUA
    // event tercatat sebagai 'page_view'.
    const { event, eventType, path: p, ...payload } = req.body || {};
    await pool.query(
      'INSERT INTO analytics_events (id, event_type, payload) VALUES ($1, $2, $3)',
      [`evt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`, String(eventType || event || 'page_view').slice(0, 60), JSON.stringify({ path: p, ...payload })]
    );
  } catch {}
  res.json({ success: true });
});

// Akun dibuat lewat /api/auth/signup atau /api/auth/google, jadi di sini hanya memperbarui akun yang sedang login.
app.post('/api/users', requireUser, async (req, res) => {
  const name = String(req.body?.name || '').replace(/[<>]/g, '').trim().slice(0, 60);
  await pool.query(
    `UPDATE users SET name = COALESCE(NULLIF($2, ''), name), last_seen = NOW() WHERE id = $1`,
    [req.user!.id, name]
  );
  res.json({ success: true });
});

// Simpan profil (nama, foto, bio, sapaan) ke DATABASE — sebelumnya tombol "Simpan Perubahan"
// hanya mengubah state React sehingga hilang saat refresh / login ulang.
// Email sengaja TIDAK bisa diubah di sini (jadi kunci akun, koleksi & sesi).
// Field yang tidak dikirim tidak diubah; string kosong = hapus (kecuali nama).
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
      if (a && !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/.test(a)) {
        return res.status(400).json({ error: 'Format foto tidak valid.' });
      }
      if (a.length > 300_000) return res.status(413).json({ error: 'Foto terlalu besar. Pilih foto lain.' });
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
    console.error('Error menyimpan profil:', err);
    res.status(500).json({ error: 'Gagal menyimpan profil.' });
  }
});

app.post('/api/orders', async (req, res) => {
  const { items, customerEmail, customerName } = req.body;
  const email = customerEmail || 'guest@PlayMuzeck.local';

  // 1. Cek langsung ke database apakah pengguna pernah membeli Drum & Chord Editor
  const userPurchases = await pool.query(
    `SELECT items FROM orders WHERE customer_email = $1 AND status = 'completed'`,
    [email]
  );

  let userHasEditor = false;
  for (const row of userPurchases.rows) {
    const orderItems = typeof row.items === 'string' ? JSON.parse(row.items) : row.items || [];
    if (orderItems.some((i: any) => i.itemTypeKey === 'fullEditor8Bar' || i.itemTypeKey === 'all')) {
      userHasEditor = true;
      break;
    }
  }

  // 2. Hitung ulang total harga riil dari database (Anti-Tamper Frontend)
  let calculatedTotal = 0;
  for (const item of items) {
    if (item.category === 'audio') {
      const trackRes = await pool.query('SELECT price FROM audio_tracks WHERE id = $1', [item.trackId || item.id]);
      const basePrice = trackRes.rows[0] ? Number(trackRes.rows[0].price) : 50000;
      const pricing = computePricing(basePrice, userHasEditor);

      if (item.itemTypeKey === 'all') {
        calculatedTotal += pricing.bundlePrice;
      } else if (item.itemTypeKey && item.itemTypeKey in pricing.products) {
        calculatedTotal += (pricing.products as any)[item.itemTypeKey];
      }
    } else if (item.category === 'deck') {
      // Anti-Tamper: hitung ulang harga deck dari database, bukan dari body request.
      const deckRes = await pool.query('SELECT price FROM decks WHERE id = $1', [item.deckId || item.id]);
      calculatedTotal += deckRes.rows[0] ? Number(deckRes.rows[0].price) : 0;
    } else if (item.category === 'topic') {
      const topicRes = await pool.query('SELECT price FROM topics WHERE id = $1', [item.topicId || item.id]);
      calculatedTotal += topicRes.rows[0] ? Number(topicRes.rows[0].price) : 0;
    } else {
      calculatedTotal += Number(item.price) || 0;
    }
  } 

  const orderId = `ord_${Date.now()}`;
  await pool.query(
    'INSERT INTO orders (id, customer_email, customer_name, items, total) VALUES ($1, $2, $3, $4, $5)',
    [orderId, email, customerName || 'Tamu', JSON.stringify(items || []), calculatedTotal]
  );

  res.json({ success: true, orderId, verifiedTotal: calculatedTotal });
});

// Helper pricing di backend (server/index.ts)
function computePricing(basePrice: number, hasEditor: boolean) {
  const base = Math.max(50000, Math.round((Number(basePrice) || 50000) / 1000) * 1000);
  const pool = base - 15000;
  const fullMaster = Math.max(5000, Math.round((pool * 9 / 35) / 1000) * 1000);
  const loopVersion = Math.max(5000, Math.round((pool * 5 / 35) / 1000) * 1000);
  const sheetMusic = Math.max(5000, Math.round((pool * 7 / 35) / 1000) * 1000);
  const separatedStems = pool - (fullMaster + loopVersion + sheetMusic);
  const discount = hasEditor ? 20000 : 10000;

  return {
    base,
    products: {
      fullMaster,
      loopVersion,
      separatedStems,
      sheetMusic,
      fullEditor8Bar: 15000,
    },
    bundlePrice: base - discount,
  };
}

// ==========================================
// F. INTEGRASI KOLEKSI PENGGUNA (POSTGRESQL MURNI)
// ==========================================

const AUDIO_BUNDLE = ['fullMaster', 'loopVersion', 'separatedStems', 'sheetMusic', 'fullEditor8Bar', 'audioToolsSuite'];
const AUDIO_KEY_SET = new Set(AUDIO_BUNDLE);

// Alias nama produk yang mungkin dikirim frontend -> kunci kanonik di database.
const AUDIO_KEY_ALIASES: Record<string, string> = {
  master: 'fullMaster',
  loop: 'loopVersion',
  stems: 'separatedStems',
  stem: 'separatedStems',
  sheet: 'sheetMusic',
  partitur: 'sheetMusic',
  editor: 'fullEditor8Bar',
  fullEditor: 'fullEditor8Bar',
  full16BarEditor: 'fullEditor8Bar',
  tools: 'audioToolsSuite',
  audioTools: 'audioToolsSuite',
};
const normalizeAudioKey = (k: unknown) => {
  const raw = String(k || '');
  return AUDIO_KEY_ALIASES[raw] || raw;
};

class CheckoutError extends Error {}

// PERBAIKAN BUG BUNDLE: sebelumnya hanya itemTypeKey === 'all' yang dianggap
// bundle; nilai lain (mis. 'bundle', atau bundle yang membawa daftar produk)
// dicatat apa adanya sebagai SATU baris dengan kunci asing, sehingga tidak
// ada produk yang terbuka. Sekarang bundle dikenali lewat: daftar produk
// eksplisit di item, kunci 'all', atau kata "bundle"/"lengkap" pada kunci/id.
// Kunci audio yang tidak dikenali TIDAK LAGI dicatat diam-diam: checkout
// ditolak dengan pesan jelas supaya penyebabnya langsung terlihat.
function resolveAudioKeys(item: any): string[] | null {
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

const stripProductSuffix = (id: string) =>
  id.replace(/[-_:](fullMaster|loopVersion|separatedStems|sheetMusic|fullEditor8Bar|audioToolsSuite|all|bundle)$/i, '');

// PERBAIKAN UTAMA: sebelumnya deck kuis yang dibuat sendiri oleh pengguna
// (lewat Quiz Editor) HANYA disimpan di localStorage browser
// (storage.saveCustomDeck()) dan TIDAK PERNAH dikirim ke server. Akibatnya
// deck itu hilang di perangkat lain, tidak muncul untuk admin, dan
// menyebabkan Koleksi Saya tidak konsisten dengan database. Endpoint ini
// menyimpan deck kustom ke tabel `decks` (ditandai is_custom + owner_email)
// dan langsung mencatat kepemilikannya di `user_collections`, dalam satu
// transaksi, sehingga langsung konsisten dengan seluruh sistem.
app.post('/api/user/decks', async (req, res) => {
  const { email, deck } = req.body || {};
  if (!email || !deck || !deck.title) {
    return res.status(400).json({ error: 'Data deck kuis tidak lengkap.' });
  }
  // Kreator Kuis adalah produk berbayar: dicek di SERVER (sebelumnya hanya disembunyikan di UI).
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

    await client.query(
      `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [`usr_${Date.now()}`, email, email.split('@')[0]]
    );

    const deckId = deck.id || `deck-custom-${Date.now()}`;
    const questions = Array.isArray(deck.questions) ? deck.questions : [];

    // Pengaturan skor dari Quiz Editor (dipakai Multiplayer): persen minus saat salah & satuan skor.
    // Diterima dari deck.settings atau field datar deck.penaltyPercent / deck.scoreUnit.
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
         title = EXCLUDED.title, description = EXCLUDED.description,
         card_count = EXCLUDED.card_count, questions = EXCLUDED.questions,
         settings = EXCLUDED.settings
       -- Hanya pemilik asli yang boleh menimpa. Tanpa ini, user mana pun bisa menimpa
       -- deck kustom orang lain ATAU deck resmi dengan mengirim id yang sama.
       WHERE decks.is_custom IS TRUE AND decks.owner_email = EXCLUDED.owner_email
       RETURNING *;`,
      [
        deckId, deck.topicId || null, deck.title, deck.description || '',
        questions.length, deck.difficulty || 'Sedang', true, 0,
        deck.badge || 'Kustom Kamu', JSON.stringify(questions), email, JSON.stringify(deckSettings),
      ]
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
    const saved = rows[0];
    res.status(201).json({
      ...saved, topicId: saved.topic_id, cardCount: saved.card_count,
      isFree: Boolean(saved.is_free), questions,
      settings: saved.settings || deckSettings,
      penaltyPercent: deckSettings.penaltyPercent,
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error menyimpan deck kustom:', error);
    res.status(500).json({ error: 'Gagal menyimpan kuis buatanmu ke database.', detail: error.message });
  } finally {
    client.release();
  }
});

// PERBAIKAN BUG UTAMA: sebelumnya tombol "Hapus Kuis" di frontend HANYA
// menghapus dari localStorage browser (QuizLibrary.tsx: handleDeleteDeck) —
// TIDAK PERNAH memanggil server sama sekali. Endpoint DELETE ini memang
// belum ada sebelumnya. Akibatnya row di tabel `decks` dan kepemilikannya di
// `user_collections` tidak pernah benar-benar terhapus, sehingga kuis yang
// "sudah dihapus" tetap ada di database dan bisa muncul lagi (misalnya lewat
// cache localStorage lama, atau di akun/perangkat lain yang masih
// menyimpan referensinya). Sekarang penghapusan benar-benar menghapus data
// permanen: baris deck (kalau memang dibuat oleh user itu sendiri) DAN
// seluruh baris kepemilikannya di `user_collections`.
app.delete('/api/user/decks/:id', async (req, res) => {
  const { id } = req.params;
  const email = String((req as any).userEmail || '');
  if (!email) return res.status(400).json({ error: 'Email wajib disertakan.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Hanya pemilik asli (owner_email) yang boleh menghapus deck kustomnya.
    const deckRes = await client.query(
      `SELECT id, owner_email, is_custom FROM decks WHERE id = $1`,
      [id]
    );

    if (deckRes.rows.length) {
      const deck = deckRes.rows[0];
      if (deck.is_custom && deck.owner_email && deck.owner_email !== email) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Anda bukan pemilik kuis ini, tidak bisa menghapusnya.' });
      }
      // Hanya hapus baris deck sungguhan bila memang deck kustom milik user
      // ini (deck bawaan/starter TIDAK dihapus dari tabel `decks`, cukup
      // kepemilikannya di user_collections yang dilepas di bawah).
      if (deck.is_custom) {
        await client.query('DELETE FROM decks WHERE id = $1', [id]);
      }
    }

    // Lepas kepemilikan/akses deck ini utk user yang memintanya (berlaku utk
    // deck kustom miliknya sendiri MAUPUN deck bawaan berbayar yang ingin ia
    // sembunyikan dari koleksinya).
    await client.query(
      `DELETE FROM public.user_collections WHERE user_email = $1 AND item_category = 'quiz' AND item_id = $2`,
      [email, id]
    );

    await client.query('COMMIT');
    res.json({ success: true });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error menghapus deck kuis:', err);
    res.status(500).json({ error: 'Gagal menghapus kuis dari database.', detail: err.message });
  } finally {
    client.release();
  }
});

app.post('/api/user/checkout', async (req, res) => {
  const { email, items: requestItems } = req.body;
  if (!email || !Array.isArray(requestItems)) {
    return res.status(400).json({ error: 'Data tidak lengkap' });
  }

  // PEMBAYARAN WAJIB TERVERIFIKASI. Sebelumnya endpoint ini langsung memberi kepemilikan
  // tanpa bukti bayar apa pun. Item diambil dari pesanan yang dikunci saat /api/payment/charge
  // (harga & isi tidak bisa diubah klien), bukan dari body request.
  const invoiceId = String(req.body?.invoiceId || '');
  const pay = await requirePaidOrder(invoiceId, email, 'cart');
  if (!pay.ok) return res.status(pay.status).json({ error: pay.error });
  if (pay.order?.fulfilled) return res.json({ success: true, savedCount: 0, alreadyFulfilled: true });
  const items: any[] = pay.order ? (pay.order.items as any[]) : requestItems;

  const client = await pool.connect();
  const failed: { item: any; reason: string }[] = [];
  const succeeded: any[] = [];

  try {
    await client.query('BEGIN');

    // Baris user ini sendiri dibuat di transaksi terpisah & di luar loop
    // per-item, karena SEMUA insert di bawah butuh baris ini ada duluan
    // (FOREIGN KEY user_collections.user_email -> users.email).
    await pool.query(
      `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [`usr_${Date.now()}`, email, email.split('@')[0]]
    );

    const insert = async (category: string, id: string, typeKey = '') => {
      const r = await client.query(
        `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key)
        VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING *`,
        [email, category, id, typeKey]
      );
      console.log('[insert-debug]', { email, category, id, typeKey, rowCountInserted: r.rowCount, rows: r.rows });
      return r;
    };

    console.log(
      '[checkout]',
      email,
      JSON.stringify(items.map((i: any) => ({ id: i.id, trackId: i.trackId, category: i.category, itemTypeKey: i.itemTypeKey })))
    );

    // PERBAIKAN BUG UTAMA: sebelumnya SELURUH item dalam satu kali checkout
    // diproses dalam SATU transaksi besar (BEGIN...COMMIT). Kalau HANYA
    // SATU item gagal dikenali (mis. bundle dengan itemTypeKey yang tidak
    // cocok persis), CheckoutError dilempar dan SELURUH transaksi
    // di-ROLLBACK — termasuk item lain yang sebenarnya valid, ikut batal
    // tersimpan tanpa pesan yang jelas ke pengguna. Ini penyebab utama
    // laporan "beli bundle/beberapa produk sekaligus, tapi cuma 1 yang
    // benar-benar kecatat". Sekarang setiap item diproses dalam SAVEPOINT
    // TERPISAH: item yang gagal di-rollback SENDIRI saja (tidak menyentuh
    // item lain yang sudah berhasil), dan pengguna mendapat rincian persis
    // item mana yang gagal beserta alasannya.
    for (const item of items) {
      await client.query('SAVEPOINT item_sp');
      try {
        // Kreator Deck & Topik (Quiz Editor): dikenali dari kunci ATAU
        // id-nya, apa pun kategori yang dikirim frontend.
        if (item.itemTypeKey === 'quizCreatorSuite' || /quiz.?(creator|editor)/i.test(String(item.id || ''))) {
          await insert('feature', 'quiz-creator-suite', 'quizCreatorSuite');
          succeeded.push(item);
          continue;
        }

        const audioKeys = resolveAudioKeys(item);
        if (item.category === 'audio' || audioKeys) {
          if (!audioKeys) {
            throw new CheckoutError(
              `Produk audio tidak dikenali (itemTypeKey="${item.itemTypeKey ?? ''}", id="${item.id ?? ''}").`
            );
          }
          const trackId = stripProductSuffix(String(item.trackId || item.id));
          for (const k of audioKeys) await insert('audio', trackId, k);
          succeeded.push(item);
        } else if (item.category === 'deck') {
          // PERBAIKAN LEBIH DALAM: pendekatan sebelumnya (mencari topic_id
          // lewat tabel `decks`) TIDAK PERNAH bekerja untuk deck bawaan
          // berbayar (mis. "Olahraga Dunia", "Matematika Esensial") karena
          // deck semacam itu memang TIDAK PERNAH ada barisnya di tabel SQL
          // `decks` — ia murni data statis di frontend (BUILTIN_DECKS), jadi
          // `SELECT * FROM decks WHERE id = ANY($1)` selalu kosong untuknya.
          // Sekarang tema deck (mis. "Olahraga") langsung disimpan ke
          // item_type_key saat checkout, apa adanya dari data keranjang
          // (item.badge), sehingga tidak butuh lookup tabel sama sekali.
          const deckThemeBadge = typeof item.badge === 'string' ? item.badge.trim() : '';
          await insert('quiz', item.deckId || item.id, deckThemeBadge ? `theme:${deckThemeBadge}` : 'quizDeck');
          succeeded.push(item);
        } else if (item.category === 'topic') {
          const topicId = item.topicId || item.id;
          await insert('topic', topicId, 'topic'); // deck bawaan tidak ada di tabel decks, jadi topiknya dicatat langsung
          const { rows } = await client.query('SELECT id, badge FROM decks WHERE topic_id = $1', [topicId]);
          for (const d of rows) {
            const badge = typeof d.badge === 'string' ? d.badge.trim() : '';
            await insert('quiz', d.id, badge ? `theme:${badge}` : 'quizDeck');
          }
          succeeded.push(item);
        } else {
          await insert(item.category, item.id, item.itemTypeKey || '');
          succeeded.push(item);
        }
        await client.query('RELEASE SAVEPOINT item_sp');
      } catch (itemErr: any) {
        await client.query('ROLLBACK TO SAVEPOINT item_sp');
        const reason = itemErr instanceof CheckoutError ? itemErr.message : (itemErr?.message || 'Gagal diproses.');
        console.error('[checkout] item gagal:', item?.id, reason);
        failed.push({ item, reason });
      }
    }

    if (succeeded.length === 0 && failed.length > 0) {
      // Tidak ada satupun item yang berhasil -> batalkan semuanya & beri
      // tahu pengguna secara jelas apa yang salah.
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Seluruh ${failed.length} item gagal dicatat.`,
        failed,
      });
    }

    if (pay.order) {
      await client.query('UPDATE payment_orders SET fulfilled = TRUE WHERE order_id = $1', [invoiceId]);
    }
    await client.query('COMMIT');

    if (failed.length > 0) {
      // Sukses SEBAGIAN: beri tahu jujur item mana yang tidak tersimpan,
      // supaya tidak ada lagi "kelihatannya sukses, ternyata cuma sebagian".
      return res.status(207).json({
        success: true,
        partial: true,
        savedCount: succeeded.length,
        failed,
      });
    }

    res.json({ success: true, savedCount: succeeded.length });
  } catch (error: any) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Error Checkout DB:', error);
    res.status(500).json({ error: 'Gagal mencatat transaksi.', detail: error.message });
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

    // PERBAIKAN LANJUTAN: pendekatan berbasis dbDecks/topics di bawah ini
    // TIDAK PERNAH mengenali tema deck bawaan berbayar (Olahraga, Matematika,
    // dst.) karena deck itu tidak pernah punya baris di tabel `decks`.
    // Sumber kebenaran yang sesungguhnya sekarang adalah item_type_key
    // berformat "theme:<nama>" yang disimpan langsung saat checkout (lihat
    // /api/user/checkout). Kita baca itu dulu sebagai sumber utama.
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

    // Jaring pengaman untuk data LAMA yang sudah kadung tersimpan sebelum
    // perbaikan ini ada (item_type_key masih 'quizDeck' polos, bukan
    // "theme:..."): tetap coba turunkan dari tabel decks/topics kalau
    // barisnya kebetulan ada (mis. deck kustom/admin yang memang tercatat).
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
      // Jaring pengaman TERAKHIR untuk pembelian LAMA (sebelum perbaikan ini
      // ada, item_type_key masih 'quizDeck' polos & deck-nya tidak tercatat
      // di tabel decks sama sekali): banyak ID deck bawaan memuat nama
      // temanya sendiri (mis. "deck-olahraga-dunia"), jadi kita cocokkan
      // langsung dari item_id-nya supaya pembelian lama tetap ikut terbuka
      // tanpa perlu migrasi data manual.
      ...quizRows
        .map((r) => {
          const found = THEME_SLUG_RULES.find(([re]) => re.test(String(r.item_id || '')));
          return found ? found[1] : null;
        })
        .filter((v): v is string => v !== null),
    ]));

    // PERBAIKAN: bingkai berbasis donasi & kontak sebelumnya TIDAK PERNAH
    // benar-benar tersimpan (tombol donasi/kontak cuma menampilkan toast),
    // dan `frames.unlockedIds` di response ini HARDCODE ['none'] terus,
    // sehingga Album Bingkai tidak pernah sinkron dengan misi yang sudah
    // dicapai. Sekarang bingkai yang terbuka lewat donasi/kontak/bundle
    // dicatat di user_collections (kategori 'frame') dan dibaca di sini.
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

// Menyimpan bingkai profil yang sedang dipakai user (sebelumnya endpoint ini
// TIDAK ADA sama sekali di backend — ProfileDashboardModal memanggil
// '/api/user/frame' yang selalu 404, gagal diam-diam, dan pilihan bingkai
// selalu kembali ke 'Klasik PlayMuzeck' setiap dibuka ulang).
app.post('/api/user/frame', async (req, res) => {
  const { email, frameId } = req.body || {};
  if (!email || !frameId) return res.status(400).json({ error: 'Data bingkai tidak lengkap.' });
  try {
    // Sebelumnya bingkai apa pun (termasuk yang belum terbuka) bisa dipasang.
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

// Mencatat donasi ke database & membuka bingkai sesuai tingkatan nominal
// (sebelumnya donasi hanya menampilkan toast tanpa tersimpan sama sekali).
const DONATION_FRAME_TIERS: { min: number; frameId: string }[] = [
  { min: 100000, frameId: 'frame-sultan' },
  { min: 50000, frameId: 'frame-warp' },
  { min: 25000, frameId: 'frame-neon' },
  { min: 10000, frameId: 'frame-coffee' },
];

app.post('/api/user/donate', async (req, res) => {
  const { email, amount, orderId } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Data donasi tidak valid.' });
  const pay = await requirePaidOrder(String(orderId || ''), email, 'donation');
  if (!pay.ok) return res.status(pay.status).json({ error: pay.error });
  // Nominal diambil dari pesanan yang benar-benar dibayar, bukan dari body request.
  const amt = pay.order ? Number(pay.order.gross_amount) : Number(amount) || 0;
  if (amt <= 0) return res.status(400).json({ error: 'Data donasi tidak valid.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO users (id, email, name) VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
      [`usr_${Date.now()}`, email, email.split('@')[0]]
    );
    await client.query(
      // Memakai orderId QRIS sebagai id supaya "coba simpan ulang" tidak
      // menggandakan donasi yang sama.
      'INSERT INTO donations (id, user_email, amount) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [orderId ? `don_${orderId}` : `don_${Date.now()}`, email, amt]
    );

    const tier = DONATION_FRAME_TIERS.find((t) => amt >= t.min);
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

// Mengirim masukan/aduan & sekaligus membuka bingkai "Sinyal Resonansi
// Pengembang" (frame-contact) yang syaratnya memang mengirim masukan.
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
    await client.query(
      `INSERT INTO inquiries (id, title, email, genre, mood, notes) VALUES ($1, $2, $3, $4, $5, $6)`,
      [`inq_${Date.now()}`, subject || 'Masukan Pengguna', email, category || 'feedback', 'contact-form', message]
    );
    await client.query(
      `INSERT INTO public.user_collections (user_email, item_category, item_id, item_type_key)
       VALUES ($1, 'frame', 'frame-contact', 'contact') ON CONFLICT DO NOTHING`,
      [email]
    );
    await client.query('COMMIT');
    res.json({ success: true, unlockedFrameId: 'frame-contact' });
  } catch (err: any) {
    await client.query('ROLLBACK');
    console.error('Error mengirim masukan:', err);
    res.status(500).json({ error: 'Gagal mengirim masukan.', detail: err.message });
  } finally {
    client.release();
  }
});



// ==========================================
// G. PEMBAYARAN MIDTRANS (SERVER-SIDE)
// ==========================================
// Alur: klien -> POST /api/payment/charge (server hitung harga sendiri, buat pesanan
// 'pending', minta Snap token) -> bayar di Snap -> POST /api/user/checkout|donate dengan
// invoiceId/orderId. Server MEMVERIFIKASI status pesanan langsung ke Midtrans sebelum
// memberi kepemilikan. Webhook /api/payment/notification ikut memperbarui status.
const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
const MIDTRANS_PROD = process.env.MIDTRANS_IS_PRODUCTION === 'true';
const MIDTRANS_SNAP_URL = MIDTRANS_PROD
  ? 'https://app.midtrans.com/snap/v1/transactions'
  : 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const MIDTRANS_API_URL = MIDTRANS_PROD ? 'https://api.midtrans.com' : 'https://api.sandbox.midtrans.com';
// HANYA untuk pengembangan lokal tanpa Midtrans. Jangan aktifkan di produksi!
// MODE DEMO otomatis: kalau kunci Midtrans tidak diisi dan server tidak berjalan sebagai production,
// checkout & donasi langsung lolos tanpa bayar (untuk demo/tes). Matikan dengan ALLOW_UNPAID_CHECKOUT=false,
// dan SELALU set NODE_ENV=production saat dipasang di server publik.
const HAS_MIDTRANS_KEYS = Boolean(process.env.MIDTRANS_SERVER_KEY && process.env.MIDTRANS_CLIENT_KEY);
const ALLOW_UNPAID_CHECKOUT =
  process.env.ALLOW_UNPAID_CHECKOUT === 'true' ||
  (!HAS_MIDTRANS_KEYS && process.env.NODE_ENV !== 'production' && process.env.ALLOW_UNPAID_CHECKOUT !== 'false');
if (!MIDTRANS_SERVER_KEY) console.warn('[PAYMENT] MIDTRANS_SERVER_KEY belum diset — /api/payment/charge akan membalas 503.');
if (ALLOW_UNPAID_CHECKOUT) console.warn('[SECURITY] ALLOW_UNPAID_CHECKOUT=true — checkout & donasi TANPA verifikasi pembayaran!');
const midtransAuth = () => 'Basic ' + Buffer.from(`${MIDTRANS_SERVER_KEY}:`).toString('base64');

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  // Model Shopee: pesanan 'pending' punya batas bayar; yang dibatalkan/kedaluwarsa jadi 'cancelled' (tetap tercatat).
  await pool.query(`
    ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
    ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;
    ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
    ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS snap_token TEXT;
  `);
}

// ---- Harga audio di server: cerminan src/services/pricing.ts (harus dijaga tetap sama) ----
type AudioOwn = Record<'fullMaster' | 'loopVersion' | 'separatedStems' | 'sheetMusic' | 'fullEditor8Bar' | 'audioToolsSuite', boolean>;

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
    fullMaster: pMaster, loopVersion: pLoop, separatedStems: pStems, sheetMusic: pSheet,
    fullEditor8Bar: FIXED_EDITOR, audioToolsSuite: FIXED_TOOLS,
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

const CREATOR_SUITE_PRICE = 25000;
const DEFAULT_DECK_PRICE = 3000;

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

// Cek kesiapan pembayaran. Buka http://localhost:8787/api/payment/status
//   mode "sandbox"/"production" + ready:true  -> siap dipakai
//   mode "demo"                              -> checkout tanpa bayar (ALLOW_UNPAID_CHECKOUT=true), hanya untuk dev
//   mode "not-configured"                    -> kunci Midtrans belum diisi di .env
app.get('/api/payment/status', (_req, res) => {
  const configured = Boolean(MIDTRANS_SERVER_KEY && MIDTRANS_CLIENT_KEY);
  const mode = ALLOW_UNPAID_CHECKOUT ? 'demo' : configured ? (MIDTRANS_PROD ? 'production' : 'sandbox') : 'not-configured';
  res.json({
    mode,
    ready: configured && !ALLOW_UNPAID_CHECKOUT,
    clientKey: MIDTRANS_CLIENT_KEY || null, // client key memang publik
    snapUrl: MIDTRANS_PROD ? 'https://app.midtrans.com/snap/snap.js' : 'https://app.sandbox.midtrans.com/snap/snap.js',
  });
});

// Produk di sini sistemnya BELI SEKALI = AKSES LANGSUNG TERBUKA. Jadi item yang sudah dimiliki
// (atau muncul dobel di keranjang yang sama) ditolak di server sebelum pembayaran dibuat.
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
    // Deck/topik/fitur: cukup cocok (kategori + id). Audio: kategori + id + jenis produk harus sama.
    const looseCats = new Set(['quiz', 'topic', 'feature']);
    const owns = (r: { category: string; id: string; typeKey: string }) =>
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

app.post('/api/payment/charge', requireUser, async (req, res) => {
  const email = String((req as any).userEmail);
  const { orderId, items, customerDetails } = req.body || {};
  if (!MIDTRANS_SERVER_KEY) return res.status(503).json({ error: 'Gateway pembayaran belum dikonfigurasi di server.' });
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(String(orderId || ''))) return res.status(400).json({ error: 'ID pesanan tidak valid.' });
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
        const item = {
          ...raw,
          id: raw.category === 'audio' ? raw.trackId || raw.id : raw.deckId || raw.topicId || raw.id,
          cartItemId: raw.id,
        };
        storedItems.push(item);
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

    // Satu pesanan menunggu per jenis (keranjang / donasi), seperti marketplace: selesaikan atau batalkan dulu.
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

    const snapRes = await fetch(MIDTRANS_SNAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: midtransAuth() },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: gross },
        expiry: { unit: 'minute', duration: PENDING_ORDER_TTL_MIN },
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
      [orderId, email, kind, gross, JSON.stringify(storedItems), snap.token, String(PENDING_ORDER_TTL_MIN)]
    );
    console.log(`[payment] pesanan pending dibuat: ${orderId} (${email}, Rp${gross})`);
    res.json({ snapToken: snap.token, amount: gross, expiresAt: ins.rows[0]?.expires_at ?? null });
  } catch (err: any) {
    if (err instanceof CheckoutError) { console.warn(`[payment] charge ditolak (${email}): ${err.message}`); return res.status(400).json({ error: err.message }); }
    console.error('[payment] charge error:', err);
    res.status(500).json({ error: 'Gagal membuat transaksi pembayaran.' });
  }
});

/** Tanya status resmi ke Midtrans lalu simpan ke tabel (status 'paid' tidak pernah diturunkan). */
async function refreshPaymentStatus(orderId: string) {
  if (!MIDTRANS_SERVER_KEY) return;
  const r = await fetch(`${MIDTRANS_API_URL}/v2/${encodeURIComponent(orderId)}/status`, {
    headers: { Accept: 'application/json', Authorization: midtransAuth() },
  });
  const d: any = await r.json().catch(() => null);
  if (!d?.transaction_status) return;
  const { rows } = await pool.query('SELECT gross_amount, status FROM payment_orders WHERE order_id = $1', [orderId]);
  const order = rows[0];
  if (!order || order.status === 'paid') return;
  const amountOk = Number(d.gross_amount) === Number(order.gross_amount);
  const paid = amountOk && (d.transaction_status === 'settlement' || (d.transaction_status === 'capture' && d.fraud_status === 'accept'));
  if (order.status === 'cancelled' && !paid) return; // sudah dibatalkan: jangan dihidupkan lagi oleh status Midtrans
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

// ---------- Siklus hidup pesanan (model marketplace) ----------
// 'pending' punya batas bayar (expires_at; bawaan 24 jam, ubah lewat PENDING_ORDER_TTL_MIN dalam menit).
// Menutup popup Snap TIDAK membatalkan pesanan: pembeli bisa melanjutkan bayar atau membatalkan sendiri.
// Dibatalkan / lewat batas bayar -> status 'cancelled' (tetap tercatat & terlihat di admin, tidak dihapus).
const PENDING_ORDER_TTL_MIN = Math.max(5, Number(process.env.PENDING_ORDER_TTL_MIN) || 1440);

/** Batalkan transaksi di Midtrans (best-effort) supaya tidak bisa dibayar belakangan. */
async function midtransCancel(orderId: string) {
  if (!MIDTRANS_SERVER_KEY) return;
  try {
    await fetch(`${MIDTRANS_API_URL}/v2/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: midtransAuth() },
    });
  } catch { /* Midtrans tidak terjangkau: status lokal tetap dibatalkan */ }
}

/**
 * Ubah pesanan 'pending' menjadi 'cancelled'. Tidak menyentuh pesanan yang sudah lunas atau sudah diproses.
 * `email` null = dipanggil sistem (sapuan kedaluwarsa).
 */
async function cancelOrder(orderId: string, email: string | null, reason: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT user_email, status, fulfilled FROM payment_orders WHERE order_id = $1', [orderId]);
  const o = rows[0];
  if (!o) return false;
  if (email && o.user_email !== email) return false;
  if (o.status !== 'pending' || o.fulfilled) return false;
  if (MIDTRANS_SERVER_KEY) {
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

// Pembeli membatalkan pesanannya sendiri (tombol "Batalkan pesanan").
app.post('/api/payment/cancel', requireUser, async (req, res) => {
  const email = String((req as any).userEmail);
  const orderId = String(req.body?.orderId || '');
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(orderId)) return res.status(400).json({ error: 'ID pesanan tidak valid.' });
  try {
    const cancelled = await cancelOrder(orderId, email, 'dibatalkan pembeli');
    res.json({ success: true, cancelled });
  } catch (err) {
    console.error('[payment] cancel error:', err);
    res.status(500).json({ error: 'Gagal membatalkan pesanan.' });
  }
});

// Pesanan milik pembeli yang belum selesai: menunggu bayar (belum lewat batas) ATAU sudah dibayar tapi
// aksesnya belum diaktifkan (mis. pembeli menutup popup setelah membayar).
app.get('/api/payment/pending', requireUser, async (req, res) => {
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
    res.json(rows.map((r) => ({
      orderId: r.order_id,
      kind: r.kind,
      amount: Number(r.gross_amount),
      status: r.status,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      items: typeof r.items === 'string' ? JSON.parse(r.items) : r.items || [],
    })));
  } catch (err) {
    console.error('[payment] pending error:', err);
    res.status(500).json({ error: 'Gagal memuat pesanan menunggu.' });
  }
});

// Lanjutkan pembayaran pesanan yang sama (membuka Snap lagi dengan token yang tersimpan).
app.post('/api/payment/resume', requireUser, async (req, res) => {
  const email = String((req as any).userEmail);
  const orderId = String(req.body?.orderId || '');
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(orderId)) return res.status(400).json({ error: 'ID pesanan tidak valid.' });
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

// Sapu otomatis: pesanan 'Menunggu' dari checkout (bukan pesanan manual admin) yang lewat batas bayar -> 'Dibatalkan'.
async function purgeExpiredPendingOrders() {
  try {
    const { rows } = await pool.query(
      `SELECT order_id FROM payment_orders
        WHERE status = 'pending' AND fulfilled = FALSE AND order_id NOT LIKE 'man\\_%'
          AND COALESCE(expires_at, created_at + ($1 || ' minutes')::interval) < NOW()
        LIMIT 50`,
      [String(PENDING_ORDER_TTL_MIN)]
    );
    for (const r of rows) await cancelOrder(r.order_id, null, 'melewati batas pembayaran').catch(() => false);
  } catch (e) {
    console.error('[payment] sapu kedaluwarsa gagal:', e);
  }
}
setInterval(purgeExpiredPendingOrders, 2 * 60 * 1000).unref();
setTimeout(purgeExpiredPendingOrders, 15 * 1000).unref();

async function requirePaidOrder(
  invoiceId: string,
  email: string,
  kind: 'cart' | 'donation'
): Promise<{ ok: true; order: any | null } | { ok: false; status: number; error: string }> {
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
      if (order.status === 'paid' || ALLOW_UNPAID_CHECKOUT) return { ok: true, order };
      return { ok: false, status: 402, error: 'Pembayaran belum terkonfirmasi oleh Midtrans. Selesaikan pembayaran lalu coba lagi.' };
    }
  }
  if (ALLOW_UNPAID_CHECKOUT) return { ok: true, order: null };
  return { ok: false, status: 402, error: 'Pembayaran belum terkonfirmasi. Selesaikan pembayaran QRIS terlebih dahulu.' };
}

// Webhook Midtrans (daftarkan URL ini di dashboard Midtrans -> Settings -> Payment Notification URL).
app.post('/api/payment/notification', async (req, res) => {
  const { order_id, status_code, gross_amount, signature_key } = req.body || {};
  if (!MIDTRANS_SERVER_KEY || !order_id) return res.sendStatus(400);
  const expected = crypto.createHash('sha512').update(`${order_id}${status_code}${gross_amount}${MIDTRANS_SERVER_KEY}`).digest('hex');
  if (expected !== String(signature_key || '')) return res.sendStatus(403);
  try { await refreshPaymentStatus(String(order_id)); } catch (e) { console.error('[payment] webhook error:', e); }
  res.sendStatus(200);
});

const distDir = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api|uploads).*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

const httpServer = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server aktif di http://localhost:${PORT} terhubung ke PostgreSQL.`);
  const ok = (v: unknown) => (v ? '✔' : '✘');
  console.log('--- KESIAPAN ---');
  console.log(`${ok(process.env.MIDTRANS_SERVER_KEY)} MIDTRANS_SERVER_KEY`);
  console.log(`${ok(process.env.MIDTRANS_CLIENT_KEY)} MIDTRANS_CLIENT_KEY`);
  console.log(`${ok(process.env.APP_URL)} APP_URL (dipakai untuk link email & cek origin)`);
  console.log(`${ok(process.env.ADMIN_PASSWORD)} ADMIN_PASSWORD`);
  console.log(`${ok(process.env.GOOGLE_CLIENT_ID)} GOOGLE_CLIENT_ID (tombol "Masuk dengan Google")`);
  console.log(`${ok(process.env.SMTP_HOST)} SMTP_HOST (email reset kata sandi asli; tanpa ini, tautan reset dicetak ke console)`);
  console.log(
    ALLOW_UNPAID_CHECKOUT
      ? '⚠ MODE DEMO: checkout tanpa pembayaran (jangan dipakai di produksi)'
      : MIDTRANS_SERVER_KEY && MIDTRANS_CLIENT_KEY
      ? `✔ Pembayaran siap (${MIDTRANS_PROD ? 'PRODUKSI' : 'SANDBOX'})`
      : '✘ Pembayaran BELUM siap: isi MIDTRANS_SERVER_KEY & MIDTRANS_CLIENT_KEY di .env'
  );
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
