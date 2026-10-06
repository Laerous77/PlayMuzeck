// Uji logika kuota server (server/toolQuotaCore.ts) tanpa PostgreSQL sungguhan: `FakePool` meniru tabel tool_quota_uses,
// transaksi, dan advisory lock (permintaan serentak untuk identity+alat yang sama dijalankan bergantian, seperti di PostgreSQL).
// Jalankan: tsx tests/toolQuotaCore.test.ts
import { DAILY_FREE_QUOTA, QUOTA_TOOL_IDS, refund, remainingMap, reserve, serverDay } from '../server/toolQuotaCore';

type Row = { identity: string; tool_id: string; day: string; use_key: string };

class FakePool {
  rows: Row[] = [];
  today = '2026-10-06';
  private locks = new Map<string, Promise<void>>();
  async query(sql: string, p: any[] = []) { return this.run(sql, p, null); }
  async connect() {
    const held: { release: (() => void) | null } = { release: null };
    const pool = this;
    return {
      query: (sql: string, p: any[] = []) => pool.run(sql, p, held),
      release() { held.release?.(); held.release = null; },
    } as any;
  }
  private async run(sql: string, p: any[], held: { release: (() => void) | null } | null): Promise<{ rows: any[] }> {
    await Promise.resolve(); // beri kesempatan permintaan lain berselang-seling
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s === 'BEGIN') return { rows: [] };
    if (s === 'COMMIT' || s === 'ROLLBACK') { held?.release?.(); if (held) held.release = null; return { rows: [] }; }
    if (s.startsWith('SELECT pg_advisory_xact_lock')) {
      const key = String(p[0]);
      const prev = this.locks.get(key) ?? Promise.resolve();
      let rel!: () => void;
      const mine = new Promise<void>((r) => { rel = r; });
      this.locks.set(key, prev.then(() => mine));
      await prev;
      if (held) held.release = rel;
      return { rows: [] };
    }
    if (s.startsWith("SELECT to_char((now() AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day")) return { rows: [{ day: this.today }] };
    if (s.startsWith('SELECT 1 FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=$3::date AND use_key=$4')) {
      return { rows: this.rows.filter((r) => r.identity === p[0] && r.tool_id === p[1] && r.day === p[2] && r.use_key === p[3]).map(() => ({ '?column?': 1 })) };
    }
    if (s.startsWith('SELECT count(*)::int AS n FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=$3::date')) {
      return { rows: [{ n: this.rows.filter((r) => r.identity === p[0] && r.tool_id === p[1] && r.day === p[2]).length }] };
    }
    if (s.startsWith('SELECT count(*)::int AS n FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND day=(now() AT TIME ZONE $3)::date')) {
      return { rows: [{ n: this.rows.filter((r) => r.identity === p[0] && r.tool_id === p[1] && r.day === this.today).length }] };
    }
    if (s.startsWith('INSERT INTO tool_quota_uses')) {
      if (this.rows.some((r) => r.identity === p[0] && r.tool_id === p[1] && r.day === p[2] && r.use_key === p[3])) throw new Error('duplicate key (PRIMARY KEY)');
      this.rows.push({ identity: p[0], tool_id: p[1], day: p[2], use_key: p[3] });
      return { rows: [] };
    }
    if (s.startsWith('DELETE FROM tool_quota_uses WHERE identity=$1 AND tool_id=$2 AND use_key=$3 AND day = (now() AT TIME ZONE $4)::date')) {
      this.rows = this.rows.filter((r) => !(r.identity === p[0] && r.tool_id === p[1] && r.use_key === p[2] && r.day === this.today));
      return { rows: [] };
    }
    if (s.startsWith('SELECT tool_id, count(*)::int AS used FROM tool_quota_uses WHERE identity = $1 AND day = $2::date GROUP BY tool_id')) {
      const m = new Map<string, number>();
      this.rows.filter((r) => r.identity === p[0] && r.day === p[1]).forEach((r) => m.set(r.tool_id, (m.get(r.tool_id) ?? 0) + 1));
      return { rows: [...m].map(([tool_id, used]) => ({ tool_id, used })) };
    }
    throw new Error(`SQL tidak dikenal oleh FakePool: ${s}`);
  }
}

let bad = 0;
const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };

(async () => {
  const db = new FakePool() as any;
  const me = 'u:budi@example.com';

  ok('batas harian = 2', DAILY_FREE_QUOTA === 2);
  ok('pitch_detect & vocal_range termasuk alat berkuota', QUOTA_TOOL_IDS.includes('pitch_detect') && QUOTA_TOOL_IDS.includes('vocal_range'));
  ok('hari server mengikuti DB', (await serverDay(db)) === '2026-10-06');

  for (const tool of ['pitch_detect', 'vocal_range', 'trim', 'tuner'] as const) {
    const a = await reserve(db, me, tool, `${tool}-1`);
    const b = await reserve(db, me, tool, `${tool}-2`);
    const c = await reserve(db, me, tool, `${tool}-3`);
    ok(`${tool}: pemakaian #1 diizinkan, sisa 1`, a.allowed && a.remaining === 1);
    ok(`${tool}: pemakaian #2 diizinkan, sisa 0`, b.allowed && b.remaining === 0);
    ok(`${tool}: pemakaian #3 ditolak`, !c.allowed && c.remaining === 0);
    ok(`${tool}: yang ditolak tidak tercatat`, db.rows.filter((r: Row) => r.tool_id === tool && r.identity === me).length === 2);
  }

  // idempoten: kunci yang sama tidak menambah pemakaian, termasuk saat jatah sudah habis
  const again = await reserve(db, me, 'pitch_detect', 'pitch_detect-1');
  ok('kunci sama saat jatah habis tetap diizinkan & tidak menambah baris', again.allowed && db.rows.filter((r: Row) => r.tool_id === 'pitch_detect').length === 2);

  // refund mengembalikan jatah, dan jatah itu bisa dipakai lagi
  const rem = await refund(db, me, 'vocal_range', 'vocal_range-2');
  ok('refund -> sisa 1', rem === 1);
  const reuse = await reserve(db, me, 'vocal_range', 'vocal_range-4');
  ok('setelah refund, pemakaian baru diizinkan', reuse.allowed && reuse.remaining === 0);
  ok('refund kunci yang tidak ada tidak mengubah apa pun', (await refund(db, me, 'vocal_range', 'nope')) === 0);

  // per alat & per identitas terpisah
  const other = await reserve(db, 'u:siti@example.com', 'pitch_detect', 'x1');
  ok('identitas lain punya jatah sendiri', other.allowed && other.remaining === 1);
  const guest = await reserve(db, 'g:11111111-1111-1111-1111-111111111111', 'pitch_detect', 'g1');
  ok('tamu (cookie perangkat) punya jatah sendiri', guest.allowed && guest.remaining === 1);
  const m = await remainingMap(db, me, '2026-10-06');
  ok('remainingMap: pitch_detect 0, vocal_range 0, bpm 2', m.pitch_detect === 0 && m.vocal_range === 0 && m.bpm === 2);

  // ganti hari = jatah baru
  db.today = '2026-10-07';
  const next = await reserve(db, me, 'pitch_detect', 'hari-baru-1');
  ok('hari berikutnya jatah kembali penuh', next.allowed && next.remaining === 1);
  const mNext = await remainingMap(db, me, '2026-10-07');
  ok('remainingMap hari baru: pitch_detect 1', mNext.pitch_detect === 1);
  db.today = '2026-10-06';
  ok('refund kunci hari lain tidak menghapus pemakaian hari ini', (await refund(db, me, 'pitch_detect', 'hari-baru-1')) === 0);

  // permintaan serentak tidak bisa menembus batas
  const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => reserve(db, 'u:rame@example.com', 'vocal_range', `burst-${i}`)));
  ok('8 permintaan serentak: tepat 2 diizinkan', burst.filter((r) => r.allowed).length === 2);
  ok('8 permintaan serentak: baris di DB = 2', db.rows.filter((r: Row) => r.identity === 'u:rame@example.com').length === 2);
  const dup = await Promise.all(Array.from({ length: 5 }, () => reserve(db, 'u:dobel@example.com', 'pitch_detect', 'kunci-sama')));
  ok('5 permintaan serentak dengan kunci sama: 1 baris, semua diizinkan', dup.every((r) => r.allowed) && db.rows.filter((r: Row) => r.identity === 'u:dobel@example.com').length === 1);

  console.log(bad ? `\n${bad} uji GAGAL` : '\nSemua uji kuota server lulus');
  process.exit(bad ? 1 : 0);
})();
