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

// Email admin utama yang SELALU punya akses, apa pun isi tabel admin_emails
// (tidak bisa dicabut lewat panel admin). Dari sinilah admin lain diberi akses.
export const SUPER_ADMIN_EMAIL = 'frfrareu@gmail.com';

export async function initDatabase() {
  const client = await pool.connect();
  try {
    // 1. Tabel Topik Kuis
    await client.query(`
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
    await client.query(`
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
    // PERBAIKAN: deck yang dibuat sendiri oleh pengguna (Quiz Editor) kini
    // ditandai is_custom + owner_email supaya konsisten tersimpan di database
    // (bukan hanya di localStorage browser) dan hanya muncul di Koleksi Saya
    // milik pembuatnya sendiri.

    // 3. Tabel Audio Tracks (Mendukung Master, Loop, Stems, & Partitur PDF)
    await client.query(`
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
    `);

    // 4. Tabel Pengguna
    // PERBAIKAN: menambahkan kolom password_hash agar simulasi login benar-
    // benar memverifikasi username (email) + kata sandi terhadap database,
    // bukan sekadar menerima input apapun seperti sebelumnya. Kolom
    // active_frame_id menyimpan bingkai profil yang sedang dipakai user
    // (sebelumnya TIDAK PERNAH tersimpan ke database sama sekali).
    await client.query(`
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
    await client.query(`
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
    await client.query(`
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
    await client.query(`
      CREATE TABLE IF NOT EXISTS analytics_events (
        id VARCHAR(100) PRIMARY KEY,
        event_type VARCHAR(100),
        payload JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 8. Tabel Pengaturan Website
    await client.query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    await client.query(`
      ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT TRUE;
      ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS loop_audio_url TEXT;
      ALTER TABLE audio_tracks ADD COLUMN IF NOT EXISTS sheet_music_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    await client.query(`
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
  await client.query(`
    ALTER TABLE user_collections ADD COLUMN IF NOT EXISTS item_type_key VARCHAR(100) DEFAULT '';
    CREATE UNIQUE INDEX IF NOT EXISTS user_collections_uniq
      ON user_collections (user_email, item_category, item_id, item_type_key);
  `);
    // 9. Tabel Donasi (dulu tombol "Konfirmasi Donasi" hanya menampilkan toast
    // tanpa pernah menyimpan apapun — donasi tidak pernah tercatat dan
    // bingkai profil berbasis donasi tidak pernah benar-benar terbuka).
    await client.query(`
      CREATE TABLE IF NOT EXISTS donations (
        id VARCHAR(100) PRIMARY KEY,
        user_email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
        amount INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 10. Tabel Daftar Admin (grant akses admin per-email)
    // Sebelumnya daftar admin HANYA berupa daftar hardcode/env di kode
    // (ADMIN_EMAILS / isUserAdmin di frontend) — tidak bisa diubah tanpa
    // deploy ulang, dan bahkan tidak pernah benar-benar dicek oleh server.
    // Sekarang tersimpan di database & bisa dikelola dari panel admin oleh
    // super admin (SUPER_ADMIN_EMAIL selalu diizinkan, tidak tergantung tabel ini).
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_emails (
        email VARCHAR(255) PRIMARY KEY,
        granted_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(
      `INSERT INTO admin_emails (email, granted_by) VALUES ($1, 'system') ON CONFLICT (email) DO NOTHING`,
      [SUPER_ADMIN_EMAIL]
    );

    // 11. Tabel Reset Kata Sandi (lupa password)
    // Token mentah dikirim lewat email, hanya HASH-nya yang disimpan di sini
    // (mirip prinsip password_hash) supaya kalau database bocor, tautan reset
    // tidak bisa dipakai ulang oleh siapa pun.
    await client.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash VARCHAR(255) PRIMARY KEY,
        user_email VARCHAR(255) REFERENCES users(email) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('PostgreSQL PlayMuzeck siap & seluruh skema tabel tervalidasi.');
  } catch (error) {
    console.error('Inisialisasi tabel PostgreSQL gagal:', error);
  } finally {
    client.release();
  }
}