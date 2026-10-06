// server/auth/authRoutes.ts
// Modul autentikasi pengguna PlayMuzeck:
// - Argon2 password hashing (dengan auto-upgrade dari bcrypt lama)
// - Sesi cookie httpOnly yang aman
// - Verifikasi email pendaftaran & reset kata sandi didukung Resend SDK resmi
// - Integrasi Google Identity Services (OAuth Google)
// - Rate limiting & origin CSRF protection

import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import argon2 from 'argon2';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import bcrypt from 'bcryptjs';
import { pool, SUPER_ADMIN_EMAIL } from '../db';
import {
  sendMail,
  sendMailStrict,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from '../emailService';

// Ekspor kembali sendMailStrict agar kompatibel dengan modul lain (seperti accountDeletion dan index.ts)
export { sendMailStrict };

const APP_URL = (process.env.APP_URL || 'http://localhost:5173').replace(/\/+$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';
const SESSION_COOKIE = 'muzeck_sid';
const SESSION_DAYS = 30;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
const passwordSchema = z
  .string()
  .min(8, 'Kata sandi minimal 8 karakter.')
  .max(128, 'Kata sandi maksimal 128 karakter.')
  .regex(/[A-Z]/, 'Kata sandi harus memiliki minimal 1 huruf kapital (A-Z).')
  .regex(/[0-9]/, 'Kata sandi harus memiliki minimal 1 angka (0-9).')
  .regex(/[^A-Za-z0-9]/, 'Kata sandi harus memiliki minimal 1 simbol unik (!@#$%^&* dll).');
const nameSchema = z.string().trim().min(1).max(60).transform((s) => s.replace(/[<>]/g, ''));
const tokenSchema = z.string().min(20).max(100);

const SUSPENDED_MSG = 'Akun kamu sedang ditangguhkan. Hubungi admin untuk informasi lebih lanjut.';

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
    httpOnly: true,
    secure: IS_PROD,
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
    deletion: u.deletion_scheduled_at
      ? {
          scheduledAt: new Date(u.deletion_scheduled_at).toISOString(),
          msLeft: Math.max(0, new Date(u.deletion_scheduled_at).getTime() - Date.now()),
          requestedBy: u.deletion_requested_by === 'self' ? 'self' : 'admin',
        }
      : null,
  };
}

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

export function originGuard(req: Request, res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!isAllowedOrigin(req.get('origin'))) return res.status(403).json({ error: 'BAD_ORIGIN' });
  next();
}

const strict = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false });
const mailLimit = rateLimit({ windowMs: 60 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false });

const r = Router();

// ---------- DAFTAR ----------
const GENERIC_SIGNUP = {
  message: 'Kalau data valid, kami sudah kirim link verifikasi ke email kamu. Cek inbox/spam (berlaku 24 jam).',
};

r.post('/signup', strict, wrap(async (req, res) => {
  const p = z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }).safeParse(req.body);
  if (!p.success) {
    const msg = p.error.issues[0]?.message || 'Cek lagi nama, email, dan password Anda.';
    return res.status(400).json({ error: 'INVALID_INPUT', message: msg });
  }
  const { name, email, password } = p.data;

  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const existing = (await pool.query(`SELECT id, email_verified_at FROM users WHERE lower(email)=$1`, [email])).rows[0];

  let userId: string;
  if (!existing) {
    userId = `usr_${crypto.randomUUID()}`;
    await pool.query(`INSERT INTO users (id, email, name, password_hash) VALUES ($1,$2,$3,$4)`, [userId, email, name, hash]);
  } else if (!existing.email_verified_at) {
    userId = existing.id;
    await pool.query(`UPDATE users SET name=$2, password_hash=$3 WHERE id=$1`, [userId, name, hash]);
  } else {
    // Email sudah terdaftar & terverifikasi: jangan bocorkan, cukup beri tahu pemiliknya via Resend
    void sendMail({
      to: email,
      subject: 'Ada yang mencoba mendaftar dengan emailmu di PlayMuzeck',
      text: `Seseorang mencoba mendaftar PlayMuzeck memakai emailmu, padahal akunnya sudah ada.\n` +
        `Kalau itu kamu, silakan masuk atau reset password di ${APP_URL}/forgot-password\nKalau bukan, abaikan saja.`
    });
    return res.json(GENERIC_SIGNUP);
  }

  const token = await issueToken(userId, 'verify_email', 60 * 24);
  if (token) {
    const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
    void sendVerificationEmail(email, verifyUrl);
  }
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
      if (token) {
        const verifyUrl = `${APP_URL}/verify-email?token=${token}`;
        void sendVerificationEmail(e.data, verifyUrl);
      }
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
    // PERBAIKAN: hitungan gagal di-reset saat akun dikunci. Dulu hitungan tetap >= 5 sesudah kunci 15 menit
    // berakhir, jadi SATU salah ketik berikutnya langsung mengunci akun lagi 15 menit.
    if (u) await pool.query(
      `UPDATE users SET failed_logins = CASE WHEN failed_logins + 1 >= 5 THEN 0 ELSE failed_logins + 1 END,
              locked_until = CASE WHEN failed_logins + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
        WHERE id=$1`, [u.id]);
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', message: 'Email atau password salah.' });
  }

  if (u.suspended_at)
    return res.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: SUSPENDED_MSG });
  if (!u.email_verified_at)
    return res.status(403).json({ error: 'EMAIL_NOT_VERIFIED', message: 'Email belum diverifikasi. Cek inbox kamu atau kirim ulang link verifikasi.' });

  await pool.query(`UPDATE users SET failed_logins=0, locked_until=NULL, last_seen=now() WHERE id=$1`, [u.id]);
  if (check.legacy) {
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
    // Alamat email tidak lagi ditulis ke log (data pribadi).
    if (u) {
      const token = await issueToken(u.id, 'reset_password', 30);
      if (!token) console.log(`[forgot] DITAHAN: akun ${u.id} sudah minta reset 5x dalam 1 jam.`);
      if (token) {
        const resetUrl = `${APP_URL}/reset-password?token=${token}`;
        void sendPasswordResetEmail(e.data, resetUrl);
      }
    }
  }
  res.json({ message: 'Kalau email terdaftar, link reset password sudah dikirim. Cek inbox/spam.' });
}));

r.post('/reset-password', strict, wrap(async (req, res) => {
  const p = z.object({ token: tokenSchema, password: passwordSchema }).safeParse(req.body);
  if (!p.success) {
    const msg = p.error.issues[0]?.message || 'Kata sandi baru belum memenuhi standar keamanan.';
    return res.status(400).json({ error: 'INVALID_INPUT', message: msg });
  }
  const userId = await consumeToken(p.data.token, 'reset_password');
  if (!userId) return res.status(400).json({ error: 'TOKEN_INVALID', message: 'Link tidak valid atau sudah kedaluwarsa.' });

  const hash = await argon2.hash(p.data.password, { type: argon2.argon2id });
  await pool.query(
    `UPDATE users SET password_hash=$2, email_verified_at=COALESCE(email_verified_at, now()),
            failed_logins=0, locked_until=NULL WHERE id=$1`, [userId, hash]);
  await pool.query(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
  res.json({ ok: true, message: 'Password berhasil diganti. Silakan login.' });
}));

// ---------- GOOGLE ----------
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
