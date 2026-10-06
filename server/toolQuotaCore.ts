// server/toolQuotaCore.ts
// Kuota pemakaian gratis Audio Tools, DISIMPAN DI POSTGRESQL (bukan localStorage).
// Aturan: 2 penggunaan gratis per alat per hari (hari mengikuti zona waktu TOOL_QUOTA_TZ, bawaan Asia/Jakarta).
//
// Satu "penggunaan" = satu baris di tabel tool_quota_uses dengan kunci (identity, tool_id, day, use_key):
//  - reserve dengan use_key yang SAMA tidak menambah pemakaian (idempoten): dipakai untuk "satu hasil = satu penggunaan".
//  - refund menghapus baris itu (mis. perekaman gagal / mikrofon ditolak), jadi jatah kembali.
//  - pemeriksaan batas dilakukan di dalam transaksi + advisory lock, sehingga dua permintaan serentak
//    tidak bisa menembus batas.
// identity: "u:<email>" untuk akun yang login, "g:<id perangkat>" untuk tamu (cookie httpOnly dari server).
import type { Pool } from 'pg';

export const DAILY_FREE_QUOTA = 2;

/** Daftar alat yang kuotanya dicatat. Harus sama dengan ID alat di AudioToolsSuite. */
export const QUOTA_TOOL_IDS = [
  'trim', 'volume', 'pitch', 'tempo', 'reverse', 'convert', 'compress', 'noise_reduction', 'vocal_separator',
  'merge', 'clean', 'recorder', 'bpm', 'metronome', 'tuner',
  'pitch_detect', 'vocal_range',
] as const;
export type QuotaToolId = (typeof QUOTA_TOOL_IDS)[number];
export const isQuotaTool = (id: unknown): id is QuotaToolId => typeof id === 'string' && (QUOTA_TOOL_IDS as readonly string[]).includes(id);

export const TOOL_QUOTA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tool_quota_uses (
  identity   VARCHAR(160) NOT NULL,
  tool_id    VARCHAR(40)  NOT NULL,
  day        DATE         NOT NULL,
  use_key    VARCHAR(120) NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (identity, tool_id, day, use_key)
);
CREATE INDEX IF NOT EXISTS tool_quota_uses_day_idx ON tool_quota_uses (day);
`;

type Db = Pick<Pool, 'query'> & { connect?: Pool['connect'] };

export const ensureToolQuotaSchema = (db: Db) => db.query(TOOL_QUOTA_SCHEMA_SQL);

const TZ = process.env.TOOL_QUOTA_TZ || 'Asia/Jakarta';

/** Tanggal "hari ini" menurut server (YYYY-MM-DD). */
export async function serverDay(db: Db): Promise<string> {
  const { rows } = await db.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day`, [TZ]);
  return rows[0].day as string;
}

export async function remainingMap(db: Db, identity: string, day: string): Promise<Record<string, number>> {
  const { rows } = await db.query(
    `SELECT tool_id, count(*)::int AS used FROM tool_quota_uses WHERE identity = $1 AND day = $2::date GROUP BY tool_id`,
    [identity, day],
  );
  const out: Record<string, number> = {};
  for (const id of QUOTA_TOOL_IDS) out[id] = DAILY_FREE_QUOTA;
  for (const r of rows) out[r.tool_id] = Math.max(0, DAILY_FREE_QUOTA - Number(r.used));
  return out;
}

export interface ReserveResult { allowed: boolean; remaining: number; useKey: string }

/** Pesan satu jatah. Atomik: tidak mungkin melewati DAILY_FREE_QUOTA walau permintaan datang bersamaan. */
export async function reserve(db: Db, identity: string, toolId: QuotaToolId, useKey: string): Promise<ReserveResult> {
  if (!db.connect) throw new Error('Pool dengan connect() dibutuhkan untuk transaksi kuota.');
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: d } = await client.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day`, [TZ]);
    const day = d[0].day as string; // string (bukan Date) agar tidak bergeser zona waktu oleh driver pg
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${identity}|${toolId}`]);
    const same = await client.query(
      `SELECT 1 FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=$3::date AND use_key=$4`,
      [identity, toolId, day, useKey],
    );
    const cnt = await client.query(
      `SELECT count(*)::int AS n FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=$3::date`,
      [identity, toolId, day],
    );
    const used = Number(cnt.rows[0].n);
    if (same.rows.length > 0) {
      await client.query('COMMIT');
      return { allowed: true, remaining: Math.max(0, DAILY_FREE_QUOTA - used), useKey };
    }
    if (used >= DAILY_FREE_QUOTA) {
      await client.query('COMMIT');
      return { allowed: false, remaining: 0, useKey };
    }
    await client.query(
      `INSERT INTO tool_quota_uses (identity, tool_id, day, use_key) VALUES ($1,$2,$3::date,$4)`,
      [identity, toolId, day, useKey],
    );
    await client.query('COMMIT');
    return { allowed: true, remaining: DAILY_FREE_QUOTA - used - 1, useKey };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* abaikan */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Kembalikan jatah (hanya baris milik identity ini, hari ini). Mengembalikan sisa jatah terbaru. */
export async function refund(db: Db, identity: string, toolId: QuotaToolId, useKey: string): Promise<number> {
  await db.query(
    `DELETE FROM tool_quota_uses
      WHERE identity=$1 AND tool_id=$2 AND use_key=$3 AND day = (now() AT TIME ZONE $4)::date`,
    [identity, toolId, useKey, TZ],
  );
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=(now() AT TIME ZONE $3)::date`,
    [identity, toolId, TZ],
  );
  return Math.max(0, DAILY_FREE_QUOTA - Number(rows[0].n));
}

/** Hapus catatan lama (>7 hari) supaya tabel tidak membengkak. */
export const purgeOld = (db: Db) =>
  db.query(`DELETE FROM tool_quota_uses WHERE day < ((now() AT TIME ZONE $1)::date - 7)`, [TZ]);
