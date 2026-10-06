import { DAILY_FREE_QUOTA, consumeQuota, dayKey, refundQuota, remainingQuota } from '../src/services/extraToolsQuota.ts';
const mem = new Map<string, string>();
const fake = { get length() { return mem.size; }, key: (i: number) => [...mem.keys()][i] ?? null, getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
let bad = 0; const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };

ok('batas harian = 2', DAILY_FREE_QUOTA === 2);
const TOOLS = ['trim', 'volume', 'pitch', 'tempo', 'reverse', 'convert', 'compress', 'noise_reduction', 'vocal_separator', 'merge', 'clean', 'recorder', 'bpm', 'metronome', 'tuner'];
for (const t of TOOLS) {
  ok(`${t}: jatah awal 2`, remainingQuota(t, false, fake) === 2);
  ok(`${t}: pakai #1`, consumeQuota(t, false, fake) === true);
  ok(`${t}: pakai #2`, consumeQuota(t, false, fake) === true);
  ok(`${t}: sisa 0`, remainingQuota(t, false, fake) === 0);
  ok(`${t}: pakai #3 ditolak`, consumeQuota(t, false, fake) === false);
  ok(`${t}: penolakan tidak mengubah hitungan`, remainingQuota(t, false, fake) === 0);
}
mem.clear();
consumeQuota('merge', false, fake);
ok('alat lain tidak terpengaruh', remainingQuota('bpm', false, fake) === 2);
ok('pemilik modul = tanpa batas', consumeQuota('merge', true, fake) === true && remainingQuota('merge', true, fake) === Infinity);
refundQuota('merge', false, fake);
ok('refund mengembalikan 1 jatah', remainingQuota('merge', false, fake) === 2);
refundQuota('merge', false, fake);
ok('refund tidak melebihi batas awal', remainingQuota('merge', false, fake) === 2);
mem.set('pm_tool_quota_2000-01-01_merge', '2'); mem.set('muzeck_daily_quota_2000-01-01', '{"trim":0}'); mem.set('pm_extra_quota_2000-01-01_bpm', '2');
consumeQuota('merge', false, fake);
ok('kunci hari lama dibersihkan', ![...mem.keys()].some((k) => k.includes('2000-01-01')));
mem.clear();
mem.set(`muzeck_daily_quota_${dayKey()}`, '{"trim":0,"volume":1}');
ok('migrasi format lama: trim habis', remainingQuota('trim', false, fake) === 0 && consumeQuota('trim', false, fake) === false);
ok('migrasi format lama: volume sisa 1', remainingQuota('volume', false, fake) === 1);
mem.clear(); mem.set(`pm_extra_quota_${dayKey()}_bpm`, '1');
ok('migrasi format extra: bpm sisa 1', remainingQuota('bpm', false, fake) === 1);
mem.clear(); mem.set(`pm_tool_quota_${dayKey()}_tuner`, 'abc');
ok('data rusak dianggap 0, tidak crash', remainingQuota('tuner', false, fake) === 2);
// tanpa localStorage: tetap dibatasi 2x lewat memori (bukan tanpa batas)
ok('tanpa penyimpanan #1', consumeQuota('zz_nostore', false, null) === true);
ok('tanpa penyimpanan #2', consumeQuota('zz_nostore', false, null) === true);
ok('tanpa penyimpanan #3 ditolak', consumeQuota('zz_nostore', false, null) === false);
if (bad) process.exitCode = 1; else console.log('\nSemua tes kuota lulus.');
