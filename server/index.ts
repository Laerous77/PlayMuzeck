// server/index.ts
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { pool, initDatabase, SUPER_ADMIN_EMAIL } from './db';
import { fileURLToPath } from 'url'; // <-- WAJIB ADA

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

/**
 * Kirim email lewat SMTP (nodemailer) jika sudah dikonfigurasi di .env
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS). Kalau belum, tautan/kode
 * hanya dicetak ke console server supaya alur reset password tetap bisa
 * diuji saat development tanpa perlu SMTP asli.
 */
async function sendEmail(to: string, subject: string, html: string) {
  if (process.env.SMTP_HOST) {
    try {
      const nodemailer: any = await import('nodemailer');
      const transporter = nodemailer.default.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      });
      await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, html });
      return;
    } catch (err) {
      console.error('[email] Gagal mengirim lewat SMTP, fallback ke console:', err);
    }
  }
  console.log(`\n[EMAIL:DEV MODE — SMTP belum dikonfigurasi]\nKe      : ${to}\nSubjek  : ${subject}\nIsi     :\n${html}\n`);
}

app.use(cors());
app.use(express.json({ limit: '10mb' })); // kuis dengan media base64 bisa > 100kb (default)

// ==========================================
// AUTENTIKASI SESI PENGGUNA (token HMAC stateless)
// ==========================================
// Sebelumnya semua /api/user/* mempercayai `email` dari body/query tanpa bukti apa pun,
// sehingga siapa saja bisa membaca/mengubah koleksi akun lain.
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET) {
  console.warn('[SECURITY] SESSION_SECRET belum diset di .env — semua sesi login akan hangus setiap server restart.');
}
const USER_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function signUserToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ e: email, exp: Date.now() + USER_TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyUserToken(token: string): string | null {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { e, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return typeof e === 'string' && exp > Date.now() ? e : null;
  } catch {
    return null;
  }
}

const requireUser = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const auth = req.headers.authorization;
  const tokenEmail = auth?.startsWith('Bearer ') ? verifyUserToken(auth.slice(7).trim()) : null;
  if (!tokenEmail) {
    return res.status(401).json({ error: 'Sesi login tidak valid atau sudah berakhir. Silakan masuk kembali.' });
  }
  const claimed = String((req.body && req.body.email) ?? req.query?.email ?? '').trim();
  if (claimed && claimed.toLowerCase() !== tokenEmail.toLowerCase()) {
    return res.status(403).json({ error: 'Email pada permintaan tidak sesuai dengan akun yang sedang login.' });
  }
  if (req.body && typeof req.body === 'object') req.body.email = tokenEmail;
  (req as any).userEmail = tokenEmail;
  next();
};
app.use('/api/user', requireUser);

// Pembatas percobaan login (anti brute-force), per IP + email.
const loginAttempts = new Map<string, number[]>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const loginKey = (req: express.Request, email: string) => `${req.ip}|${String(email).toLowerCase()}`;
const isLoginLimited = (key: string) => {
  const recent = (loginAttempts.get(key) || []).filter((t) => t > Date.now() - LOGIN_WINDOW_MS);
  loginAttempts.set(key, recent);
  return recent.length >= LOGIN_MAX_ATTEMPTS;
};

Promise.resolve(initDatabase())
  .then(() => ensurePaymentTables())
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

// Konfigurasi Multer untuk validasi ekstensi audio & sheet music PDF
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const fileFilter = (_req: express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExts = ['.mp3', '.wav', '.m4a', '.flac', '.pdf', '.jpg', '.jpeg', '.png', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  // Ekstensi WAJIB ada di daftar putih. Sebelumnya cukup mimetype 'audio/*' (bisa dipalsukan)
  // sehingga file .html/.js bisa terunggah lalu disajikan dari /uploads (stored XSS).
  if (allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Format file tidak didukung. Harap unggah MP3, WAV, M4A, FLAC, atau PDF.'));
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 150 * 1024 * 1024 } }); // Maksimal 150MB

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
// TOKEN SESI asli (HMAC bertanda tangan server, dari /api/auth/login,
// /api/auth/register, /api/auth/google, atau /api/auth/demo-login) sehingga
// emailnya dijamin benar-benar milik sesi yang sedang login.
app.post('/api/admin/session-login', async (req, res) => {
  const auth = req.headers.authorization;
  const email = auth?.startsWith('Bearer ') ? verifyUserToken(auth.slice(7).trim()) : null;
  if (!email) {
    return res.status(401).json({ error: 'Sesi login situs utama tidak valid atau sudah berakhir.' });
  }
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

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, name, password } = req.body || {};
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Alamat surel (email) tidak valid.' });
    }
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Kata sandi minimal 4 karakter.' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      return res.status(409).json({ error: 'Email ini sudah terdaftar. Silakan masuk (login).' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const displayName = (name && String(name).trim()) || email.split('@')[0];
    const userId = `usr_${Date.now()}`;

    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, last_seen) VALUES ($1, $2, $3, $4, NOW())`,
      [userId, email, displayName, passwordHash]
    );

    return res.status(201).json({ success: true, email, name: displayName, token: signUserToken(email) });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ error: 'Gagal membuat akun baru.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!isValidEmail(email) || !password) {
      return res.status(400).json({ error: 'Email dan kata sandi wajib diisi.' });
    }
    const attemptKey = loginKey(req, email);
    if (isLoginLimited(attemptKey)) {
      return res.status(429).json({ error: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' });
    }
    loginAttempts.set(attemptKey, [...(loginAttempts.get(attemptKey) || []), Date.now()]);

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = rows[0];

    // Pesan generik disengaja (tidak membedakan "email tidak ada" vs "kata
    // sandi salah") supaya tidak membocorkan email mana yang terdaftar.
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Email atau kata sandi salah.' });
    }

    const match = await bcrypt.compare(String(password), user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'Email atau kata sandi salah.' });
    }

    loginAttempts.delete(attemptKey);
    await pool.query('UPDATE users SET last_seen = NOW() WHERE email = $1', [email]);
    return res.json({ success: true, email: user.email, name: user.name, token: signUserToken(user.email) });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Gagal memproses login.' });
  }
});

// PERBAIKAN: sebelumnya tidak ada jalur "lupa kata sandi" sama sekali — kalau
// pengguna lupa, akunnya buntu selamanya. Sekarang tautan reset dikirim ke
// email terdaftar (token acak, hash-nya disimpan di DB, kedaluwarsa 30 menit,
// sekali pakai). Balasan selalu generik ("jika email terdaftar...") supaya
// endpoint ini tidak bisa dipakai untuk menebak email mana yang punya akun.
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Alamat email tidak valid.' });
    }

    const { rows } = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
    if (rows.length) {
      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
      await pool.query(
        'INSERT INTO password_resets (token_hash, user_email, expires_at) VALUES ($1, $2, $3)',
        [tokenHash, email, expiresAt]
      );
      const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/?resetToken=${rawToken}`;
      await sendEmail(
        email,
        'Reset Kata Sandi PlayMuzeck',
        `<p>Kami menerima permintaan reset kata sandi untuk akun ini.</p>
         <p>Klik tautan berikut untuk mengatur kata sandi baru (berlaku 30 menit):</p>
         <p><a href="${resetLink}">${resetLink}</a></p>
         <p>Jika Anda tidak meminta ini, abaikan saja email ini.</p>`
      );
    }

    // Balasan selalu sukses & generik, terlepas email terdaftar atau tidak.
    res.json({ success: true, message: 'Jika email terdaftar, tautan reset kata sandi sudah dikirim.' });
  } catch (err) {
    console.error('forgot-password error:', err);
    res.status(500).json({ error: 'Gagal memproses permintaan reset kata sandi.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Token reset tidak ditemukan atau tidak valid.' });
    }
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'Kata sandi minimal 4 karakter.' });
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const { rows } = await pool.query(
      'SELECT * FROM password_resets WHERE token_hash = $1 AND used = FALSE AND expires_at > NOW()',
      [tokenHash]
    );
    const record = rows[0];
    if (!record) {
      return res.status(400).json({ error: 'Tautan reset tidak valid atau sudah kedaluwarsa. Minta tautan baru.' });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE email = $2', [passwordHash, record.user_email]);
    await pool.query('UPDATE password_resets SET used = TRUE WHERE token_hash = $1', [tokenHash]);
    // Token lain yang belum dipakai untuk email ini ikut dianggap basi.
    await pool.query('UPDATE password_resets SET used = TRUE WHERE user_email = $1 AND used = FALSE', [record.user_email]);

    res.json({ success: true, email: record.user_email, token: signUserToken(record.user_email) });
  } catch (err) {
    console.error('reset-password error:', err);
    res.status(500).json({ error: 'Gagal mengatur ulang kata sandi.' });
  }
});

// Login/daftar akun otomatis lewat Google Sign-In (Google Identity Services
// di klien mengirim `credential` berupa ID token JWT). Server memverifikasi
// token itu langsung ke Google (tokeninfo) sebelum membuat/mengenali akun,
// jadi tidak ada email yang bisa dipalsukan dari sisi klien.
app.post('/api/auth/google', async (req, res) => {
  try {
    const verified = await verifyGoogleIdToken(String(req.body?.credential || ''));
    if (!verified) {
      return res.status(401).json({ error: 'Token Google tidak valid atau tidak bisa diverifikasi.' });
    }
    const { email, name } = verified;
    // Akun Google tidak pakai kata sandi manual; simpan hash acak sebagai
    // placeholder supaya kolom password_hash tetap terisi (bukan login palsu:
    // tidak ada cara login pakai "kata sandi" untuk akun ini selain Google).
    const placeholderHash = await bcrypt.hash(crypto.randomBytes(24).toString('hex'), 10);
    const userId = `usr_${Date.now()}`;

    const existing = await pool.query('SELECT name FROM users WHERE email = $1', [email]);
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, last_seen) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email) DO UPDATE SET last_seen = NOW()`,
      [userId, email, existing.rows[0]?.name || name, placeholderHash]
    );

    res.json({ success: true, email, name: existing.rows[0]?.name || name, token: signUserToken(email) });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(500).json({ error: 'Gagal memproses login Google.' });
  }
});

// Login cepat 1-klik untuk akun demo bawaan (tidak butuh kata sandi manual),
// tapi tetap membuat/menggunakan baris `users` yang sesungguhnya di database
// sehingga datanya tetap konsisten & terisolasi per-akun seperti user biasa.
const DEMO_ACCOUNTS: Record<string, string> = {
  'soundcreator@PlayMuzeck.id': 'Aris Musik',
  'triviageek@PlayMuzeck.id': 'Nadia Trivia',
};

app.post('/api/auth/demo-login', async (req, res) => {
  try {
    const { email } = req.body || {};
    const demoName = DEMO_ACCOUNTS[email];
    if (!demoName) {
      return res.status(400).json({ error: 'Akun demo tidak dikenali.' });
    }
    const passwordHash = await bcrypt.hash('demo-password', 10);
    await pool.query(
      `INSERT INTO users (id, email, name, password_hash, last_seen) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email) DO UPDATE SET last_seen = NOW()`,
      [`usr_${Date.now()}`, email, demoName, passwordHash]
    );
    return res.json({ success: true, email, name: demoName, token: signUserToken(email) });
  } catch (err) {
    console.error('Demo login error:', err);
    return res.status(500).json({ error: 'Gagal masuk dengan akun demo.' });
  }
});

// ==========================================
// B. ADMIN TRACKS & AUDIO UPLOADS (AudioPage)
// ==========================================
app.get('/api/admin/tracks', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM audio_tracks ORDER BY id DESC');
    res.json(rows.map(mapTrackRow));
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
        description, audio_url, loop_audio_url, sheet_music_url, stems, chord_sequence, bass_sequence, melody_sequence
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
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
      JSON.stringify(d.bassSequence || []), JSON.stringify(d.melodySequence || [])
    ];
    const { rows } = await pool.query(query, values);
    res.status(201).json(mapTrackRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Gagal menambah track baru.' });
  }
});

app.put('/api/admin/tracks/:id', requireAdmin, async (req, res) => {
  try {
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
    res.json(mapTrackRow(rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui katalog audio.' });
  }
});

app.delete('/api/admin/tracks/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM audio_tracks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus track.' });
  }
});

// Endpoint upload file fisik (Master, Loop, Stems, atau Sheet Music PDF)
app.post('/api/admin/tracks/:id/audio', requireAdmin, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const { kind, stemId, duration } = req.query as { kind: string; stemId?: string; duration?: string };

    if (!req.file) return res.status(400).json({ error: 'Tidak ada berkas yang diunggah.' });

    const fileUrl = `/uploads/${req.file.filename}`;
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
    res.json(mapTrackRow(updated.rows[0]));
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Gagal memproses berkas audio.' });
  }
});

app.delete('/api/admin/tracks/:id/file', requireAdmin, async (req, res) => {
  try {
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
    res.json(mapTrackRow(updated.rows[0]));
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

app.post('/api/admin/topics', requireAdmin, async (req, res) => {
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

app.put('/api/admin/topics/:id', requireAdmin, async (req, res) => {
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

app.delete('/api/admin/topics/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM topics WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus topik.' });
  }
});

app.get('/api/admin/decks', requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM decks ORDER BY id ASC');
    res.json(rows.map(d => ({
      id: d.id, topicId: d.topic_id, title: d.title, description: d.description,
      cardCount: d.card_count, difficulty: d.difficulty, isFree: Boolean(d.is_free),
      price: d.price, badge: d.badge, settings: d.settings || {},
      questions: typeof d.questions === 'string' ? JSON.parse(d.questions) : d.questions || []
    })));
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
      INSERT INTO decks (id, topic_id, title, description, card_count, difficulty, is_free, price, badge, questions, settings)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb) RETURNING *;
    `;
    const settings = d.settings && typeof d.settings === 'object' ? d.settings : {};
    const { rows } = await pool.query(query, [
      deckId, d.topicId, d.title, d.description || '', questions.length,
      d.difficulty || 'Sedang', Boolean(d.isFree), Number(d.price) || 0, d.badge || '', JSON.stringify(questions),
      JSON.stringify(settings)
    ]);
    const r = rows[0];
    res.status(201).json({ ...r, topicId: r.topic_id, cardCount: r.card_count, isFree: Boolean(r.is_free), questions });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan deck kuis.' });
  }
});

app.put('/api/admin/decks/:id', requireAdmin, async (req, res) => {
  try {
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
      d.topicId, d.title, d.description || '', questions.length, d.difficulty, Boolean(d.isFree), Number(d.price) || 0, d.badge || '', JSON.stringify(questions), settingsJson, id
    ]);
    const r = rows[0];
    res.json({ ...r, topicId: r.topic_id, cardCount: r.card_count, isFree: Boolean(r.is_free), questions });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memperbarui deck kuis.' });
  }
});

app.delete('/api/admin/decks/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM decks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menghapus deck.' });
  }
});

// Import JSON konten kuis secara instan
app.post('/api/admin/import-content', requireAdmin, async (req, res) => {
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
      `, [d.id, d.topicId, d.title, d.description || '', q.length, d.difficulty || 'Sedang', Boolean(d.isFree), Number(d.price) || 0, d.badge || '', JSON.stringify(q)]);
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
    const [cTracks, cTopics, cDecks, cUsers, cOrders, cInq, cEvt] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM audio_tracks'),
      pool.query('SELECT COUNT(*) FROM topics'),
      pool.query('SELECT COUNT(*) FROM decks'),
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*), COALESCE(SUM(total), 0) as rev FROM orders'),
      pool.query("SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'baru') as open FROM inquiries"),
      pool.query('SELECT COUNT(*) FROM analytics_events'),
    ]);

    const daysRes = await pool.query(`
      SELECT TO_CHAR(created_at, 'YYYY-MM-DD') as date, COUNT(*)::int as count
      FROM analytics_events
      GROUP BY date ORDER BY date DESC LIMIT 14
    `);

    const byTypeRes = await pool.query(`
      SELECT event_type as type, COUNT(*)::int as count
      FROM analytics_events
      GROUP BY event_type ORDER BY count DESC LIMIT 5
    `);

    const recentRes = await pool.query('SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT 10');

    res.json({
      totals: {
        tracks: parseInt(cTracks.rows[0].count),
        topics: parseInt(cTopics.rows[0].count),
        decks: parseInt(cDecks.rows[0].count),
        users: parseInt(cUsers.rows[0].count),
        orders: parseInt(cOrders.rows[0].count),
        revenue: parseInt(cOrders.rows[0].rev),
        inquiries: parseInt(cInq.rows[0].count),
        openInquiries: parseInt(cInq.rows[0].open || 0),
        events: parseInt(cEvt.rows[0].count),
      },
      days: daysRes.rows,
      byType: byTypeRes.rows,
      recentEvents: recentRes.rows,
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal memuat analitik.' });
  }
});

app.post('/api/admin/clear-analytics', requireAdmin, async (_req, res) => {
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

app.get('/api/admin/inquiries', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM inquiries ORDER BY created_at DESC');
  res.json(rows);
});

app.patch('/api/admin/inquiries/:id', requireAdmin, async (req, res) => {
  await pool.query('UPDATE inquiries SET status = $1 WHERE id = $2', [req.body.status, req.params.id]);
  res.json({ success: true });
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  res.json(rows.map(u => ({ ...u, last_seen: u.last_seen || u.created_at })));
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

app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  const s = req.body;
  for (const [k, v] of Object.entries(s)) {
    await pool.query('INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value', [k, String(v)]);
  }
  res.json(s);
});

app.get('/api/admin/export', requireAdmin, async (_req, res) => {
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

app.post('/api/users', requireUser, async (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email wajib diisi' });
  await pool.query(`
    INSERT INTO users (id, email, name, last_seen) VALUES ($1, $2, $3, NOW())
    ON CONFLICT(email) DO UPDATE SET name = EXCLUDED.name, last_seen = NOW();
  `, [`usr_${Date.now()}`, email, name || 'Pengguna']);
  res.json({ success: true });
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

    const { rows } = await client.query(
      `INSERT INTO decks (id, topic_id, title, description, card_count, difficulty, is_free, price, badge, questions, is_custom, owner_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description,
         card_count = EXCLUDED.card_count, questions = EXCLUDED.questions
       -- Hanya pemilik asli yang boleh menimpa. Tanpa ini, user mana pun bisa menimpa
       -- deck kustom orang lain ATAU deck resmi dengan mengirim id yang sama.
       WHERE decks.is_custom IS TRUE AND decks.owner_email = EXCLUDED.owner_email
       RETURNING *;`,
      [
        deckId, deck.topicId || null, deck.title, deck.description || '',
        questions.length, deck.difficulty || 'Sedang', true, 0,
        deck.badge || 'Kustom Kamu', JSON.stringify(questions), email,
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

app.post('/api/payment/charge', requireUser, async (req, res) => {
  const email = String((req as any).userEmail);
  const { orderId, items, customerDetails } = req.body || {};
  if (!MIDTRANS_SERVER_KEY) return res.status(503).json({ error: 'Gateway pembayaran belum dikonfigurasi di server.' });
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(String(orderId || ''))) return res.status(400).json({ error: 'ID pesanan tidak valid.' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Item pembayaran kosong.' });

  try {
    const existing = await pool.query('SELECT user_email, fulfilled FROM payment_orders WHERE order_id = $1', [orderId]);
    if (existing.rows[0] && (existing.rows[0].user_email !== email || existing.rows[0].fulfilled)) {
      return res.status(409).json({ error: 'ID pesanan sudah dipakai. Ulangi pembayaran.' });
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
        const price = await serverItemPrice(item, email);
        subtotal += price;
        storedItems.push({ ...item, price });
      }
      gross = subtotal + Math.round(subtotal * 0.11); // PPN 11%, sama dengan keranjang di klien
      if (gross < 1) return res.status(400).json({ error: 'Total pembayaran tidak valid.' });
    }

    const snapRes = await fetch(MIDTRANS_SNAP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: midtransAuth() },
      body: JSON.stringify({
        transaction_details: { order_id: orderId, gross_amount: gross },
        customer_details: { first_name: String(customerDetails?.name || 'Pelanggan').slice(0, 50), email },
      }),
    });
    const snap: any = await snapRes.json().catch(() => null);
    if (!snapRes.ok || !snap?.token) {
      console.error('[payment] Midtrans menolak:', snapRes.status, snap);
      return res.status(502).json({ error: 'Gateway pembayaran menolak transaksi. Coba lagi.' });
    }

    await pool.query(
      `INSERT INTO payment_orders (order_id, user_email, kind, gross_amount, items, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       ON CONFLICT (order_id) DO UPDATE SET kind = EXCLUDED.kind, gross_amount = EXCLUDED.gross_amount, items = EXCLUDED.items, status = 'pending'
       WHERE payment_orders.user_email = EXCLUDED.user_email AND payment_orders.fulfilled = FALSE`,
      [orderId, email, kind, gross, JSON.stringify(storedItems)]
    );
    res.json({ snapToken: snap.token, amount: gross });
  } catch (err: any) {
    if (err instanceof CheckoutError) return res.status(400).json({ error: err.message });
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
  const failed = ['deny', 'cancel', 'expire', 'failure'].includes(d.transaction_status);
  const status = paid ? 'paid' : failed ? 'failed' : 'pending';
  if (status !== order.status) await pool.query('UPDATE payment_orders SET status = $1 WHERE order_id = $2', [status, orderId]);
}

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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server aktif di http://localhost:${PORT} terhubung ke PostgreSQL.`);
  const ok = (v: unknown) => (v ? '✔' : '✘');
  console.log('--- KESIAPAN ---');
  console.log(`${ok(process.env.MIDTRANS_SERVER_KEY)} MIDTRANS_SERVER_KEY`);
  console.log(`${ok(process.env.MIDTRANS_CLIENT_KEY)} MIDTRANS_CLIENT_KEY`);
  console.log(`${ok(process.env.SESSION_SECRET)} SESSION_SECRET`);
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

