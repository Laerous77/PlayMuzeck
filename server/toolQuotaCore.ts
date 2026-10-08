// server/toolQuotaCore.ts
// Kuota pemakaian gratis Audio Tools, DISIMPAN DI POSTGRESQL (bukan localStorage).
// Aturan: 2 penggunaan gratis per alat per hari (hari mengikuti zona waktu TOOL_QUOTA_TZ, bawaan Asia/Jakarta).
//
// Satu "penggunaan" = satu baris di tabel tool_quota_uses dengan kunci (identity, tool_id, day, use_key):
//  - reserve dengan use_key yang SAMA tidak menambah pemakaian (idempoten): dipakai untuk "satu hasil = satu penggunaan".
//  - refund menghapus baris itu (mis. perekaman gagal / mikrofon ditolak), jadi jatah kembali.
//  - pemeriksaan batas dilakukan di dalam transaksi + advisory lock, sehingga dua permintaan serentak
//    tidak bisa menembus batas.
// Identitas (lihat toolQuotaRoutes.ts): "g:<id perangkat>" (cookie httpOnly dari server, untuk semua pemakai),
// "u:<email>" untuk akun yang login, dan "ip:<hash jaringan>" untuk tamu. Jatah harus tersedia di semua identitas.
import type { Pool } from 'pg';

export const DAILY_FREE_QUOTA = 2;

/** Daftar alat yang kuotanya dicatat (20 alat). Harus sama dengan ID alat di AudioToolsSuite + AudioExtraTools. */
export const QUOTA_TOOL_IDS = [
  'trim', 'volume', 'pitch', 'tempo', 'reverse', 'convert', 'compress', 'noise_reduction', 'vocal_separator',
  'merge', 'clean', 'recorder', 'bpm', 'metronome', 'tuner',
  'pitch_detect', 'vocal_range',
  'loop', 'metadata',
  'pitch_match',
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

/**
 * Satu "identitas" pemakai. Satu pemakai bisa punya beberapa identitas sekaligus (akun, perangkat, jaringan);
 * jatah dihitung di SETIAP identitas dan pemakaian ditolak bila salah satunya sudah penuh. Dengan begitu
 * menghapus cookie, keluar akun, atau ganti perangkat tidak mengembalikan jatah yang sudah terpakai hari ini.
 * `limit` bawaannya DAILY_FREE_QUOTA.
 */
export type Identity = string | { id: string; limit?: number };
interface Dim { id: string; limit: number }

const normalizeIdentities = (identity: Identity | Identity[]): Dim[] => {
  const list = Array.isArray(identity) ? identity : [identity];
  const byId = new Map<string, Dim>();
  for (const i of list) {
    const id = typeof i === 'string' ? i : i.id;
    const limit = typeof i === 'string' ? DAILY_FREE_QUOTA : Math.max(1, Math.floor(i.limit ?? DAILY_FREE_QUOTA));
    const prev = byId.get(id);
    byId.set(id, { id, limit: prev ? Math.min(prev.limit, limit) : limit });
  }
  // Urutan tetap (menurut id) supaya kunci advisory selalu diambil berurutan dan tidak terjadi deadlock.
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
};

const clampLeft = (n: number) => Math.max(0, Math.min(DAILY_FREE_QUOTA, n));

export async function remainingMap(db: Db, identity: Identity | Identity[], day: string): Promise<Record<string, number>> {
  const dims = normalizeIdentities(identity);
  const { rows } = await db.query(
    `SELECT identity, tool_id, count(*)::int AS used FROM tool_quota_uses WHERE identity = ANY($1::text[]) AND day = $2::date GROUP BY identity, tool_id`,
    [dims.map((d) => d.id), day],
  );
  const limitOf = new Map(dims.map((d) => [d.id, d.limit] as const));
  const out: Record<string, number> = {};
  for (const id of QUOTA_TOOL_IDS) out[id] = DAILY_FREE_QUOTA;
  for (const r of rows) {
    const left = clampLeft((limitOf.get(r.identity as string) ?? DAILY_FREE_QUOTA) - Number(r.used));
    out[r.tool_id] = Math.min(out[r.tool_id] ?? DAILY_FREE_QUOTA, left);
  }
  return out;
}

export interface ReserveResult { allowed: boolean; remaining: number; useKey: string }

/**
 * Pesan satu jatah. Atomik: tidak mungkin melewati batas walau permintaan datang bersamaan.
 * Bila `identity` berupa daftar, jatah harus tersedia di SEMUA identitas dan satu baris dicatat di tiap identitas.
 */
export async function reserve(db: Db, identity: Identity | Identity[], toolId: QuotaToolId, useKey: string): Promise<ReserveResult> {
  if (!db.connect) throw new Error('Pool dengan connect() dibutuhkan untuk transaksi kuota.');
  const dims = normalizeIdentities(identity);
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const { rows: d } = await client.query(`SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day`, [TZ]);
    const day = d[0].day as string; // string (bukan Date) agar tidak bergeser zona waktu oleh driver pg
    for (const dim of dims) await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${dim.id}|${toolId}`]);

    const state: Array<Dim & { has: boolean; used: number }> = [];
    for (const dim of dims) {
      const same = await client.query(
        `SELECT 1 FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=$3::date AND use_key=$4`,
        [dim.id, toolId, day, useKey],
      );
      const cnt = await client.query(
        `SELECT count(*)::int AS n FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=$3::date`,
        [dim.id, toolId, day],
      );
      state.push({ ...dim, has: same.rows.length > 0, used: Number(cnt.rows[0].n) });
    }

    const leftNow = () => clampLeft(Math.min(...state.map((x) => x.limit - x.used)));
    if (state.every((x) => x.has)) {
      await client.query('COMMIT');
      return { allowed: true, remaining: leftNow(), useKey };
    }
    if (state.some((x) => !x.has && x.used >= x.limit)) {
      await client.query('COMMIT');
      return { allowed: false, remaining: 0, useKey };
    }
    for (const x of state) {
      if (x.has) continue;
      await client.query(
        `INSERT INTO tool_quota_uses (identity, tool_id, day, use_key) VALUES ($1,$2,$3::date,$4)`,
        [x.id, toolId, day, useKey],
      );
      x.used += 1;
    }
    await client.query('COMMIT');
    return { allowed: true, remaining: leftNow(), useKey };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* abaikan */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Kembalikan jatah (hanya baris milik identitas ini, hari ini). Mengembalikan sisa jatah terbaru. */
export async function refund(db: Db, identity: Identity | Identity[], toolId: QuotaToolId, useKey: string): Promise<number> {
  const dims = normalizeIdentities(identity);
  const ids = dims.map((d) => d.id);
  await db.query(
    `DELETE FROM tool_quota_uses
      WHERE identity = ANY($1::text[]) AND tool_id=$2 AND use_key=$3 AND day = (now() AT TIME ZONE $4)::date`,
    [ids, toolId, useKey, TZ],
  );
  const { rows } = await db.query(
    `SELECT identity, count(*)::int AS n FROM tool_quota_uses WHERE identity = ANY($1::text[]) AND tool_id=$2 AND day=(now() AT TIME ZONE $3)::date GROUP BY identity`,
    [ids, toolId, TZ],
  );
  const usedBy = new Map<string, number>(rows.map((r: any) => [r.identity as string, Number(r.n)] as const));
  return clampLeft(Math.min(...dims.map((d) => d.limit - (usedBy.get(d.id) ?? 0))));
}

/** Hapus catatan lama (>7 hari) supaya tabel tidak membengkak. */
export const purgeOld = (db: Db) =>
  db.query(`DELETE FROM tool_quota_uses WHERE day < ((now() AT TIME ZONE $1)::date - 7)`, [TZ]);
