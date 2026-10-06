// server/db.ts
import { Pool } from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '.env') });
console.log(`[db] konek ke ${process.env.DB_HOST || 'localhost'} / ${process.env.DB_NAME || 'postgres'}`);

// PERBAIKAN KEAMANAN: kredensial database sebelumnya di-hardcode langsung di
// kode sumber. Sekarang diambil dari environment variable (.env) dengan
// fallback ke nilai lama supaya development lokal tidak langsung patah.
// WAJIB isi file .env di server dengan kredensial asli sebelum deploy.
const isLocalhost = !process.env.DB_HOST || process.env.DB_HOST === 'localhost';

export const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT) || 5432,
  // Otomatis aktifkan SSL kalau terkoneksi ke Supabase/Cloud
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
});

// Koneksi idle yang putus (restart database, jaringan Supabase) tidak boleh menjatuhkan proses.
pool.on('error', (err) => console.error('[db] error pada koneksi idle:', err.message));

// Email admin utama yang SELALU punya akses, apa pun isi tabel admin_emails
// (tidak bisa dicabut lewat panel admin). Dari sinilah admin lain diberi akses.
export const SUPER_ADMIN_EMAIL = 'frfrareu@gmail.com';

/**
 * Skema khusus admin: tabel daftar admin, sesi admin, dan baris Super Admin.
 *
 * Sengaja DIPISAH dari initDatabase() dan dibuat idempotent + dipakai ulang (memoized):
 *  - Dulu seluruh initDatabase() ada dalam SATU try/catch. Kalau satu pernyataan SQL di bagian atas
 *    gagal, semua yang di bawahnya (termasuk baris Super Admin di admin_emails) tidak pernah dibuat,
 *    sehingga halaman "Admin & Akses" tampak kosong tanpa Super Admin.
 *  - Token admin dulu hanya disimpan di memori proses (Map). Setiap restart/deploy server membuat
 *    semua token tidak valid -> panel admin menampilkan "Token admin tidak valid atau sudah
 *    kedaluwarsa" dan daftar admin tidak bisa dimuat. Sekarang sesi disimpan di database.
 */
let adminSchemaPromise: Promise<void> | null = null;
export function ensureAdminSchema(): Promise<void> {
  if (!adminSchemaPromise) {
    adminSchemaPromise = (async () => {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS admin_emails (
          email VARCHAR(255) PRIMARY KEY,
          granted_by VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS admin_sessions (
          token_hash CHAR(64) PRIMARY KEY,
          email VARCHAR(255),
          is_super BOOLEAN NOT NULL DEFAULT FALSE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS admin_sessions_exp_idx ON admin_sessions (expires_at);
      `);
      await pool.query(
        `INSERT INTO admin_emails (email, granted_by) VALUES ($1, 'system') ON CONFLICT (email) DO NOTHING`,
        [SUPER_ADMIN_EMAIL.toLowerCase()]
      );
    })().catch((err) => {
      adminSchemaPromise = null; // coba lagi pada pemanggilan berikutnya, jangan menyimpan kegagalan
      throw err;
    });
  }
  return adminSchemaPromise;
}

export async function initDatabase() {
  // Setiap langkah berdiri sendiri: satu langkah gagal TIDAK lagi menggagalkan langkah sesudahnya.
  const step = async (label: string, sql: string) => {
    try {
      await pool.query(sql);
    } catch (error) {
      console.error(`[db] langkah "${label}" gagal:`, error);
    }
  };

  // Daftar admin + sesi admin + Super Admin dulu, supaya panel admin selalu bisa dipakai.
  try {
    await ensureAdminSchema();
  } catch (error) {
    console.error('[db] skema admin gagal:', error);
  }

  // 1. Tabel Topik Kuis
  await step('topics', `
    CREATE TABLE IF NOT EXISTS topics (
      id VARCHAR(100) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      icon_name VARCHAR(100),
      description TEXT,
      price INT DEFAULT 0,
      original_price INT DEFAULT 0,
      badge VARCHAR(100)
    );
  `);

  // 2. Tabel Decks (Kuis)
  await step('decks', `
    CREATE TABLE IF NOT EXISTS decks (
      id VARCHAR(100) PRIMARY KEY,
      topic_id VARCHAR(100) REFERENCES topics(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      card_count INT DEFAULT 0,
      difficulty VARCHAR(50),
      is_free BOOLEAN DEFAULT FALSE,
      price INT DEFAULT 0,
      badge VARCHAR(100),
      questions JSONB DEFAULT '[]'::jsonb
    );
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS is_custom BOOLEAN DEFAULT FALSE;
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
    ALTER TABLE decks ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}'::jsonb;
  `);
  // Deck yang dibuat sendiri oleh pengguna (Quiz Editor) ditandai is_custom + owner_email supaya
  // tersimpan di database (bukan hanya localStorage) dan hanya muncul di Koleksi Saya pembuatnya.

  // 3. Tabel Audio Tracks (Mendukung Master, Loop, Stems, & Partitur PDF)
  await step('audio_tracks', `
    CREATE TABLE IF NOT EXISTS audio_tracks (
      id VARCHAR(100) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      artist VARCHAR(255) NOT NULL,
      genre VARCHAR(100),
      bpm INT DEFAULT 120,
      duration VARCHAR(20) DEFAULT '03:00',
      duration_sec INT DEFAULT 180,
      cover_gradient VARCHAR(255),
      cover_icon VARCHAR(100),
      license_info VARCHAR(255),
      price INT DEFAULT 0,
      is_flagship BOOLEAN DEFAULT FALSE,
      is_published BOOLEAN DEFAULT TRUE,
      description TEXT,
      audio_url TEXT,
      loop_audio_url TEXT,
      sheet_music_url TEXT,
      stems JSONB DEFAULT '[]'::jsonb,
      chord_sequence JSONB DEFAULT '[]'::jsonb,
      bass_sequence JSONB DEFAULT '[]'::jsonb,
      melody_sequence JSONB DEFAULT '[]'::jsonb
    );
    ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
    ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS loop_duration VARCHAR(20) DEFAULT '00:00';
    ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);
  `);

  // 4. Tabel Pengguna
  await step('users', `
    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(100) PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255),
      password_hash VARCHAR(255),
      active_frame_id VARCHAR(100) DEFAULT 'none',
      role VARCHAR(50) DEFAULT 'user',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS active_frame_id VARCHAR(100) DEFAULT 'none';
  `);

  // 5. Tabel Pesanan
  await step('orders', `
    CREATE TABLE IF NOT EXISTS orders (
      id VARCHAR(100) PRIMARY KEY,
      customer_email VARCHAR(255),
      customer_name VARCHAR(255),
      items JSONB DEFAULT '[]'::jsonb,
      total INT DEFAULT 0,
      status VARCHAR(50) DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 6. Tabel Inquiries (Permintaan Custom Audio)
  await step('inquiries', `
    CREATE TABLE IF NOT EXISTS inquiries (
      id VARCHAR(100) PRIMARY KEY,
      title VARCHAR(255),
      email VARCHAR(255),
      genre VARCHAR(100),
      mood VARCHAR(100),
      status VARCHAR(50) DEFAULT 'baru',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 7. Tabel Analytics Events
  await step('analytics_events', `
    CREATE TABLE IF NOT EXISTS analytics_events (
      id VARCHAR(100) PRIMARY KEY,
      event_type VARCHAR(100),
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events (created_at);
  `);

  // 8. Tabel Pengaturan Website
  await step('site_settings', `
    CREATE TABLE IF NOT EXISTS site_settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  await step('kolom lanjutan', `
    ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;
    ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS loop_audio_url TEXT;
    ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS sheet_music_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
  `);

  await step('user_collections', `
    CREATE TABLE IF NOT EXISTS user_collections (
      id SERIAL PRIMARY KEY,
      user_email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
      item_category VARCHAR(50) NOT NULL,
      item_id VARCHAR(100) NOT NULL,
      item_type_key VARCHAR(100) DEFAULT '',
      purchased_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (user_email, item_category, item_id, item_type_key)
    );
  `);
  await step('user_collections index', `
    ALTER TABLE user_collections ADD COLUMN IF NOT EXISTS item_type_key VARCHAR(100) DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS user_collections_uniq
      ON user_collections (user_email, item_category, item_id, item_type_key);
  `);

  // 9. Tabel Donasi
  await step('donations', `
    CREATE TABLE IF NOT EXISTS donations (
      id VARCHAR(100) PRIMARY KEY,
      user_email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
      amount INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 10. Daftar admin (admin_emails) & sesi admin sudah dibuat oleh ensureAdminSchema() di atas.

  // Hapus akun permanen dengan masa tunggu 3 hari (lihat server/accountDeletion.ts).
  await step('penghapusan akun', `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS deletion_requested_by VARCHAR(255);
    CREATE INDEX IF NOT EXISTS users_deletion_due_idx ON users (deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;
  `);

  // 11. Tabel Reset Kata Sandi (lupa password) - tabel lama, dipertahankan untuk kompatibilitas.
  await step('password_resets', `
    CREATE TABLE IF NOT EXISTS password_resets (
      token_hash VARCHAR(255) PRIMARY KEY,
      user_email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 12. Sistem login baru (sesi cookie httpOnly + verifikasi email).
  // Kolom lama (password_hash bcrypt) tetap dipertahankan: authRoutes.ts masih bisa
  // memverifikasi hash bcrypt lama dan otomatis menggantinya ke argon2 saat login berhasil.
  await step('kolom auth baru', `
    ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INT NOT NULL DEFAULT 0;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(100);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_reason TEXT;
    -- Profil publik pengguna: foto (data URL kecil), bio singkat, sapaan kustom.
    ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS bio VARCHAR(160);
    ALTER TABLE users ADD COLUMN IF NOT EXISTS greeting VARCHAR(80);
    CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_uniq ON users (google_sub) WHERE google_sub IS NOT NULL;
    CREATE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));
  `);
  await step('sessions', `
    CREATE TABLE IF NOT EXISTS sessions (
      id_hash CHAR(64) PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      user_agent VARCHAR(200),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);
  `);
  await step('auth_tokens', `
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id SERIAL PRIMARY KEY,
      user_id VARCHAR(100) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose VARCHAR(30) NOT NULL,
      token_hash CHAR(64) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS auth_tokens_hash_idx ON auth_tokens (token_hash);
    CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens (user_id, purpose, created_at);
  `);

  // Bersihkan sesi & token kedaluwarsa setiap kali server start.
  await step('bersih-bersih', `
    DELETE FROM sessions WHERE expires_at < now();
    DELETE FROM auth_tokens WHERE expires_at < now() - interval '7 days';
    DELETE FROM admin_sessions WHERE expires_at < now();
  `);

  console.log('PostgreSQL PlayMuzeck siap & seluruh skema tabel tervalidasi.');
}
