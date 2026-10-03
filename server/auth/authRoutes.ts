// server/auth/authRoutes.ts
// npm i argon2 express-rate-limit helmet cookie-parser zod google-auth-library nodemailer
// npm i -D @types/cookie-parser @types/nodemailer
//
// ENV yang dibutuhkan:
//   APP_URL=https://domainlo.com        GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / MAIL_FROM="PlayMuzeck <noreply@domainlo.com>"
//   NODE_ENV=production
//   ALLOWED_ORIGINS=http://localhost:5173   (opsional, pisah koma; origin tambahan yang boleh kirim POST)
//
// Kalau SMTP_HOST kosong, email (link verifikasi / reset) dicetak ke console server (mode dev).
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import nodemailer from 'nodemailer';
import bcrypt from 'bcryptjs'; // hanya untuk memverifikasi hash lama (bcrypt) milik user yang sudah ada
import { pool, SUPER_ADMIN_EMAIL } from '../db';

const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'muzeck_sid';
const SESSION_DAYS = 30;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
// Port 465 = SSL langsung (secure: true); 587/25 = STARTTLS (secure: false). SMTP_SECURE di .env tetap boleh
// menimpa, tapi kalau tidak diisi, ditebak dari port supaya 465 tidak menggantung menunggu sapaan server.
const SMTP_SECURE = process.env.SMTP_SECURE !== undefined && process.env.SMTP_SECURE !== ''
  ? process.env.SMTP_SECURE === 'true'
  : SMTP_PORT === 465;
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      // Batas waktu: bawaan nodemailer terlalu panjang (koneksi 2 menit) sehingga panel admin terlihat "loading terus"
      // bila port diblokir hosting / host salah. Lebih baik gagal cepat dengan pesan yang jelas.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    })
  : null;

// Origin yang boleh mengirim request pengubah data (POST/PATCH/DELETE).
const ALLOWED_ORIGINS = new Set<string>([
  new URL(APP_URL).origin,
  ...(process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  ...(IS_PROD ? [] : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:8787']),
]);
export const isAllowedOrigin = (origin?: string) => !origin || ALLOWED_ORIGINS.has(origin);

// ---------- helper kecil ----------
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const newSecret = () => crypto.randomBytes(32).toString('base64url');
const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

// Hash palsu supaya waktu respons login sama baik email ada maupun tidak (anti user-enumeration).
const DUMMY_HASH = argon2.hash('dummy-password-untuk-timing', { type: argon2.argon2id });

/** Cek password. Mendukung hash argon2 (baru) dan bcrypt ($2...) dari sistem login lama. */
export async function verifyPassword(stored: string | null | undefined, plain: string): Promise<{ ok: boolean; legacy: boolean }> {
  const hash = stored || (await DUMMY_HASH);
  try {
    if (hash.startsWith('$2')) return { ok: !!stored && (await bcrypt.compare(plain, hash)), legacy: true };
    return { ok: !!stored && (await argon2.verify(hash, plain)), legacy: false };
  } catch {
    return { ok: false, legacy: false };
  }
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(10).max(128);
const nameSchema = z.string().trim().min(1).max(60).transform((s) => s.replace(/[<>]/g, ''));
const tokenSchema = z.string().min(20).max(100);

async function sendMail(to: string, subject: string, text: string) {
  if (!mailer) {
    console.log(`\n[EMAIL:DEV — SMTP belum dikonfigurasi]\nKe     : ${to}\nSubjek : ${subject}\n${text}\n`);
    return;
  }
  try {
    const info = await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text }); // teks polos: tidak ada celah injeksi HTML
    console.log(`[mail] terkirim ke ${to} (${subject}) | diterima SMTP: ${(info.accepted || []).join(',') || '-'} | ditolak: ${(info.rejected || []).join(',') || '-'}`);
  } catch (e) {
    console.error('[mail] gagal kirim:', e);
  }
}

const SUSPENDED_MSG = 'Akun kamu sedang ditangguhkan. Hubungi admin untuk informasi lebih lanjut.';

/** Dipakai panel admin (server/index.ts): kirim email TANPA menelan error, supaya admin tahu kalau gagal. */
export async function sendMailStrict(to: string, subject: string, text: string) {
  if (!mailer) throw new Error('SMTP belum dikonfigurasi di .env (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM).');
  try {
    await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
  } catch (e: any) {
    console.error('[mail] gagal kirim (strict):', e?.code, e?.command, e?.message);
    const where = `${process.env.SMTP_HOST}:${SMTP_PORT} (${SMTP_SECURE ? 'SSL' : 'STARTTLS'})`;
    switch (e?.code) {
      case 'ETIMEDOUT':
      case 'ESOCKET':
      case 'ECONNECTION':
        throw new Error(`Tidak bisa tersambung ke server email ${where}. Biasanya port diblokir oleh hosting, atau host/port salah. Pakai tombol "Buka Gmail" sebagai gantinya.`);
      case 'EDNS':
      case 'ENOTFOUND':
        throw new Error(`Alamat server email tidak ditemukan (${process.env.SMTP_HOST}). Periksa SMTP_HOST di .env.`);
      case 'EAUTH':
        throw new Error('Server email menolak login. Periksa SMTP_USER / SMTP_PASS (untuk Gmail pakai App Password).');
      default:
        throw new Error(`Gagal mengirim email lewat ${where}: ${e?.message || 'galat tidak diketahui'}`);
    }
  }
}

type Purpose = 'verify_email' | 'reset_password';

/** Buat token sekali pakai. Maks 5 per jam per user per tujuan (anti spam email). */
async function issueToken(userId: string, purpose: Purpose, ttlMin: number): Promise<string | null> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM auth_tokens
      WHERE user_id=$1 AND purpose=$2 AND created_at > now() - interval '1 hour'`,
    [userId, purpose]
  );
  if (rows[0].n >= 5) return null;
  await pool.query(`UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL`, [userId, purpose]);
  const raw = newSecret();
  await pool.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
     VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [userId, purpose, sha256(raw), ttlMin]
  );
  return raw;
}

/** Pakai token secara atomik: sekali pakai, belum kedaluwarsa. */
async function consumeToken(raw: string, purpose: Purpose): Promise<string | null> {
  const { rows } = await pool.query(
    `UPDATE auth_tokens SET used_at=now()
      WHERE token_hash=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(raw), purpose]
  );
  return rows[0]?.user_id ?? null;
}

async function startSession(req: Request, res: Response, userId: string) {
  const raw = newSecret();
  await pool.query(
    `INSERT INTO sessions (id_hash, user_id, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(days => $3), $4)`,
    [sha256(raw), userId, SESSION_DAYS, (req.get('user-agent') || '').slice(0, 200)]
  );
  res.cookie(SESSION_COOKIE, raw, {
    httpOnly: true,          // tidak bisa dibaca JavaScript -> kebal dicuri lewat XSS
    secure: IS_PROD,         // hanya lewat HTTPS
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 86400_000,
    path: '/',
  });
}

async function publicUser(userId: string) {
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role, left(md5(u.avatar_url), 8) AS avatar_v, u.bio, u.greeting, u.active_frame_id,
            u.deletion_scheduled_at, u.deletion_requested_by,
            (u.role = 'admin'
             OR lower(u.email) = $2
             OR EXISTS (SELECT 1 FROM admin_emails a WHERE lower(a.email) = lower(u.email))) AS is_admin
       FROM users u WHERE u.id = $1`,
    [userId, SUPER_ADMIN_EMAIL.toLowerCase()]
  );
  const u = rows[0];
  return {
    id: u.id, email: u.email, name: u.name, isAdmin: Boolean(u.is_admin),
    avatarUrl: u.avatar_v ? `/api/avatar/${u.id}?v=${u.avatar_v}` : '', bio: u.bio || '', greeting: u.greeting || '', frameId: u.active_frame_id || 'none',
    // Dikirim setiap login / verifikasi / Google / me, supaya klien selalu bisa memperingatkan pengguna.
    deletion: u.deletion_scheduled_at
      ? {
          scheduledAt: new Date(u.deletion_scheduled_at).toISOString(),
          msLeft: Math.max(0, new Date(u.deletion_scheduled_at).getTime() - Date.now()),
          requestedBy: u.deletion_requested_by === 'self' ? 'self' : 'admin',
        }
      : null,
  };
}

// ---------- middleware (pakai di route lain juga) ----------
export interface AuthedUser { id: string; email: string; name: string | null; role: string }
declare module 'express-serve-static-core' {
  interface Request { user?: AuthedUser }
}

export const requireAuth = wrap(async (req, res, next) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (!sid) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.name, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash=$1 AND s.expires_at > now() AND u.email_verified_at IS NOT NULL
        AND u.suspended_at IS NULL`,
    [sha256(sid)]
  );
  if (!rows[0]) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  req.user = rows[0];
  next();
});

// CATATAN: panel admin memakai token admin sendiri (Bearer adm_...) di server/index.ts,
// jadi requireAdmin TIDAK diekspor dari sini (menghindari bentrok nama dengan index.ts).

// Tolak request yang mengubah data dari origin asing (lapisan tambahan anti-CSRF).
// Request tanpa header Origin (server-to-server, mis. webhook Midtrans) dibiarkan lewat.
export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!isAllowedOrigin(req.get('origin'))) return res.status(403).json({ error: 'BAD_ORIGIN' });
  next();
}

// ---------- rate limit ----------
const strict = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const mailLimit = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });

const r = Router();

// ---------- DAFTAR ----------
const GENERIC_SIGNUP = {
  message: 'Kalau data valid, kami sudah kirim link verifikasi ke email kamu. Cek inbox/spam (berlaku 24 jam).',
};

r.post('/signup', strict, wrap(async (req, res) => {
  const p = z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Cek lagi nama, email, dan password (minimal 10 karakter).' });
  const { name, email, password } = p.data;

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const existing = (await pool.query(`SELECT id, email_verified_at FROM users WHERE lower(email)=$1`, [email])).rows[0];

  let userId: string;
  if (!existing) {
    userId = `usr_${crypto.randomUUID()}`;
    await pool.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)`, [userId, email, name, hash]);
  } else if (!existing.email_verified_at) {
    // Akun belum terverifikasi: timpa dengan data pendaftar terbaru (akun ini belum bisa dipakai login).
    userId = existing.id;
    await pool.query(`UPDATE users SET name=$2, password_hash=$3 WHERE id=$1`, [userId, name, hash]);
  } else {
    // Email sudah terdaftar & terverifikasi: jangan bocorkan, cukup kabari pemiliknya.
    void sendMail(email, 'Ada yang mencoba mendaftar dengan emailmu',
      `Seseorang mencoba mendaftar PlayMuzeck memakai emailmu, padahal akunnya sudah ada.\n` +
      `Kalau itu kamu, silakan masuk atau reset password di ${APP_URL}/forgot-password\nKalau bukan, abaikan saja.`);
    return res.json(GENERIC_SIGNUP);
  }

  const token = await issueToken(userId, 'verify_email', 60 * 24);
  if (token) void sendMail(email, 'Verifikasi email PlayMuzeck',
    `Halo! Klik link ini untuk mengaktifkan akunmu (berlaku 24 jam):\n${APP_URL}/verify-email?token=${token}\n\nKalau kamu tidak merasa mendaftar, abaikan email ini.`);
  res.json(GENERIC_SIGNUP);
}));

r.post('/verify-email', strict, wrap(async (req, res) => {
  const t = tokenSchema.safeParse(req.body?.token);
  if (!t.success) return res.status(400).json({ error: 'TOKEN_INVALID' });
  const userId = await consumeToken(t.data, 'verify_email');
  if (!userId) return res.status(400).json({ error: 'TOKEN_INVALID', message: 'Link tidak valid atau sudah kedaluwarsa.' });
  await pool.query(`UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id=$1`, [userId]);
  await startSession(req, res, userId);
  res.json({ user: await publicUser(userId) });
}));

r.post('/resend-verification', mailLimit, wrap(async (req, res) => {
  const e = emailSchema.safeParse(req.body?.email);
  if (e.success) {
    const u = (await pool.query(`SELECT id FROM users WHERE lower(email)=$1 AND email_verified_at IS NULL`, [e.data])).rows[0];
    if (u) {
      const token = await issueToken(u.id, 'verify_email', 60 * 24);
      if (token) void sendMail(e.data, 'Verifikasi email PlayMuzeck', `Link verifikasi (berlaku 24 jam):\n${APP_URL}/verify-email?token=${token}`);
    }
  }
  res.json(GENERIC_SIGNUP);
}));

// ---------- LOGIN ----------
r.post('/login', strict, wrap(async (req, res) => {
  const p = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'INVALID_INPUT' });
  const { email, password } = p.data;

  const u = (await pool.query(
    `SELECT id, password_hash, email_verified_at, locked_until, suspended_at FROM users WHERE lower(email)=$1`, [email]
  )).rows[0];

  if (u?.locked_until && new Date(u.locked_until) > new Date())
    return res.status(429).json({ error: 'LOCKED', message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' });

  const check = await verifyPassword(u?.password_hash, password);
  const ok = !!u && check.ok;

  if (!ok) {
    if (u) await pool.query(
      `UPDATE users SET failed_logins = failed_logins + 1,
              locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
        WHERE id=$1`, [u.id]);
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email atau password salah.' });
  }
  // Dicek SETELAH password benar supaya status akun tidak bocor ke orang yang bukan pemiliknya.
  if (u.suspended_at)
    return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: SUSPENDED_MSG });
  if (!u.email_verified_at)
    return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', message: 'Email belum diverifikasi. Cek inbox kamu atau kirim ulang link verifikasi.' });

  await pool.query(`UPDATE users SET failed_logins=0, locked_until=NULL, last_seen=now() WHERE id=$1`, [u.id]);
  if (check.legacy) {
    // Naikkan hash bcrypt lama ke argon2 begitu user berhasil login.
    const upgraded = await argon2.hash(password, { type: argon2.argon2id });
    await pool.query(`UPDATE users SET password_hash=$2 WHERE id=$1`, [u.id, upgraded]);
  }
  await startSession(req, res, u.id);
  res.json({ user: await publicUser(u.id) });
}));

// ---------- LUPA / RESET PASSWORD ----------
r.post('/forgot-password', mailLimit, wrap(async (req, res) => {
  const e = emailSchema.safeParse(req.body?.email);
  if (e.success) {
    const u = (await pool.query(`SELECT id FROM users WHERE lower(email)=$1`, [e.data])).rows[0];
    if (!u) console.log(`[forgot] email tidak terdaftar: ${e.data}`);
    if (u) {
      const token = await issueToken(u.id, 'reset_password', 30);
      if (!token) console.log(`[forgot] DITAHAN: ${e.data} sudah minta reset 5x dalam 1 jam, tidak ada email dikirim. Tunggu 1 jam.`);
      if (token) void sendMail(e.data, 'Reset password PlayMuzeck',
        `Klik untuk membuat password baru (berlaku 30 menit, sekali pakai):\n${APP_URL}/reset-password?token=${token}\n\nBukan kamu? Abaikan email ini, passwordmu tetap aman.`);
    }
  }
  // Respons SAMA entah email ada atau tidak.
  res.json({ message: 'Kalau email terdaftar, link reset password sudah dikirim. Cek inbox/spam.' });
}));

r.post('/reset-password', strict, wrap(async (req, res) => {
  const p = z.object({ token: tokenSchema, password: passwordSchema }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: 'INVALID_INPUT', message: 'Password minimal 10 karakter.' });
  const userId = await consumeToken(p.data.token, 'reset_password');
  if (!userId) return res.status(400).json({ error: 'TOKEN_INVALID', message: 'Link tidak valid atau sudah kedaluwarsa.' });

  const hash = await argon2.hash(p.data.password, { type: argon2.argon2id });
  await pool.query(
    `UPDATE users SET password_hash=$2, email_verified_at=COALESCE(email_verified_at, now()),
            failed_logins=0, locked_until=NULL WHERE id=$1`, [userId, hash]);
  await pool.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]); // tendang semua perangkat lama
  res.json({ ok: true, message: 'Password berhasil diganti. Silakan login.' });
}));

// ---------- GOOGLE ----------
// Frontend kirim `credential` (ID token dari Google Identity Services), BUKAN email/nama.
// Server yang memverifikasi tanda tangan Google & mengambil email dari token itu.
r.post('/google', strict, wrap(async (req, res) => {
  const c = z.string().min(20).max(4096).safeParse(req.body?.credential);
  if (!c.success) return res.status(400).json({ error: 'INVALID_INPUT' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: c.data, audience: process.env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    return res.status(401).json({ error: 'GOOGLE_TOKEN_INVALID' });
  }
  if (!payload?.sub || !payload.email || !payload.email_verified)
    return res.status(401).json({ error: 'GOOGLE_EMAIL_UNVERIFIED' });

  const email = payload.email.trim().toLowerCase();
  const name = (payload.name || email.split('@')[0]).replace(/[<>]/g, '').slice(0, 60);

  const blocked = (await pool.query(
    `SELECT 1 FROM users WHERE (google_sub=$1 OR lower(email)=$2) AND suspended_at IS NOT NULL`, [payload.sub, email]
  )).rowCount;
  if (blocked) return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: SUSPENDED_MSG });

  let u = (await pool.query(`SELECT id FROM users WHERE google_sub=$1`, [payload.sub])).rows[0];
  if (!u) {
    u = (await pool.query(`SELECT id FROM users WHERE lower(email)=$1`, [email])).rows[0];
    if (u) {
      // Tautkan ke akun yang sudah ada. Kalau akun itu belum terverifikasi, BUANG password-nya
      // (mencegah orang iseng yang daftar duluan pakai email korban lalu mengambil alih).
      await pool.query(
        `UPDATE users SET google_sub=$2,
                password_hash = CASE WHEN email_verified_at IS NULL THEN NULL ELSE password_hash END,
                email_verified_at = COALESCE(email_verified_at, now())
          WHERE id=$1`, [u.id, payload.sub]);
    } else {
      const id = `usr_${crypto.randomUUID()}`;
      await pool.query(`INSERT INTO users (id, email, name, google_sub, email_verified_at) VALUES ($1,$2,$3,$4,now())`,
        [id, email, name, payload.sub]);
      u = { id };
    }
  }
  await startSession(req, res, u.id);
  res.json({ user: await publicUser(u.id) });
}));

// ---------- SESI ----------
r.get('/me', requireAuth, wrap(async (req, res) => res.json({ user: await publicUser(req.user!.id) })));

r.post('/logout', wrap(async (req, res) => {
  const sid = req.cookies?.[SESSION_COOKIE];
  if (sid) await pool.query(`DELETE FROM sessions WHERE id_hash=$1`, [sha256(sid)]);
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: IS_PROD, sameSite: 'lax' });
  res.json({ ok: true });
}));

export const authRouter = r;
