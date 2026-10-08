// Jalankan: npx tsx tests/quizCommunity.test.ts   (atau: npm run test:quiz)
import {
  computePoints,
  periodRange,
  parseSharedDeckId,
  toClientDeckId,
  isBuiltinDeckKey,
  sanitizeSharedQuestions,
  sanitizeSharedSettings,
  MAX_QUESTIONS_PER_SHARE,
} from '../server/quizCommunityRoutes.ts';

let bad = 0;
const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };

// ── Poin ──
ok('10 poin per jawaban benar', computePoints(3, 10) === 30);
ok('semua salah = 0', computePoints(0, 10) === 0);
ok('bonus 20% bila semua benar (10/10 = 100 + 20)', computePoints(10, 10) === 120);
ok('bonus dibulatkan (5/5 = 50 + 10)', computePoints(5, 5) === 60);
ok('hampir sempurna tanpa bonus (9/10 = 90)', computePoints(9, 10) === 90);

// ── Periode (WIB = UTC+7) ──
// 2026-10-08 20:30 UTC = 2026-10-09 03:30 WIB -> "hari ini" menurut WIB adalah 9 Oktober.
const t1 = new Date('2026-10-08T20:30:00Z');
const d = periodRange('daily', t1);
ok('harian mulai 00:00 WIB (= 17:00 UTC hari sebelumnya)', d.start!.toISOString() === '2026-10-08T17:00:00.000Z');
ok('harian berakhir 24 jam kemudian', d.end!.toISOString() === '2026-10-09T17:00:00.000Z');
const m = periodRange('monthly', t1);
ok('bulanan mulai tanggal 1 00:00 WIB', m.start!.toISOString() === '2026-09-30T17:00:00.000Z');
ok('bulanan berakhir awal bulan berikutnya', m.end!.toISOString() === '2026-10-31T17:00:00.000Z');
// Pergantian bulan oleh WIB, padahal UTC masih bulan lama: 2026-10-31 18:00 UTC = 1 Nov 01:00 WIB
const m2 = periodRange('monthly', new Date('2026-10-31T18:00:00Z'));
ok('pergantian bulan mengikuti WIB', m2.start!.toISOString() === '2026-10-31T17:00:00.000Z');
const dec = periodRange('monthly', new Date('2026-12-15T05:00:00Z'));
ok('Desember berakhir 1 Januari tahun depan', dec.end!.toISOString() === '2026-12-31T17:00:00.000Z');
const all = periodRange('all', t1);
ok('sepanjang waktu tanpa batas', all.start === null && all.end === null);

// ── Id deck ──
ok('id komunitas bolak-balik', parseSharedDeckId(toClientDeckId('shq_0123456789ab')) === 'shq_0123456789ab');
ok('id komunitas palsu ditolak', parseSharedDeckId('deck-custom-shared-abc') === null);
ok('id komunitas dengan injeksi ditolak', parseSharedDeckId("deck-custom-shared-shq_0123456789ab'; DROP") === null);
ok('deck bawaan dikenali', isBuiltinDeckKey('deck-builtin-alam') && isBuiltinDeckKey('deck-starter-2'));
ok('kuis pribadi bukan deck bawaan', !isBuiltinDeckKey('deck-custom-1700000000000'));

// ── Validasi soal ──
const good = { id: 'a', question: ' Ibu kota Indonesia? ', options: ['Jakarta', 'Medan'], correctIndex: 0, explanation: '', category: 'Umum', timeLimitSec: 20 };
const r1 = sanitizeSharedQuestions([good]);
ok('soal valid diterima & dirapikan', !r1.error && r1.questions.length === 1 && r1.questions[0].question === 'Ibu kota Indonesia?');
ok('kosong ditolak', !!sanitizeSharedQuestions([]).error);
ok('bukan array ditolak', !!sanitizeSharedQuestions('x').error);
ok('pilihan < 2 ditolak', !!sanitizeSharedQuestions([{ ...good, options: ['saja'] }]).error);
ok('pilihan kosong ditolak', !!sanitizeSharedQuestions([{ ...good, options: ['a', ' '] }]).error);
ok('pilihan > 6 ditolak', !!sanitizeSharedQuestions([{ ...good, options: ['1', '2', '3', '4', '5', '6', '7'] }]).error);
ok('kunci jawaban di luar rentang ditolak', !!sanitizeSharedQuestions([{ ...good, correctIndex: 2 }]).error);
ok('kunci jawaban pecahan ditolak', !!sanitizeSharedQuestions([{ ...good, correctIndex: 0.5 }]).error);
ok('teks soal kosong ditolak', !!sanitizeSharedQuestions([{ ...good, question: '   ' }]).error);
ok('melebihi batas jumlah soal ditolak', !!sanitizeSharedQuestions(Array.from({ length: MAX_QUESTIONS_PER_SHARE + 1 }, () => good)).error);
ok('timeLimit dibatasi 180 detik', sanitizeSharedQuestions([{ ...good, timeLimitSec: 999 }]).questions[0].timeLimitSec === 180);
ok('timeLimit negatif jadi 0', sanitizeSharedQuestions([{ ...good, timeLimitSec: -5 }]).questions[0].timeLimitSec === 0);
ok('media javascript: dibuang', sanitizeSharedQuestions([{ ...good, mediaType: 'image', mediaUrl: 'javascript:alert(1)' }]).questions[0].mediaUrl === undefined);
ok('media https diterima', sanitizeSharedQuestions([{ ...good, mediaType: 'image', mediaUrl: 'https://x.test/a.png' }]).questions[0].mediaUrl === 'https://x.test/a.png');
ok('media data:image base64 diterima', sanitizeSharedQuestions([{ ...good, mediaType: 'image', mediaUrl: 'data:image/png;base64,AAAA' }]).questions[0].mediaType === 'image');
ok('media data:text/html dibuang', sanitizeSharedQuestions([{ ...good, mediaType: 'image', mediaUrl: 'data:text/html;base64,AAAA' }]).questions[0].mediaUrl === undefined);
ok('field asing tidak ikut tersimpan', !('evil' in (sanitizeSharedQuestions([{ ...good, evil: '<script>' }]).questions[0] as any)));

// ── Pengaturan ──
ok('penalti dibatasi 0-100', sanitizeSharedSettings({ penaltyPercent: 500 }).penaltyPercent === 100 && sanitizeSharedSettings({ penaltyPercent: -3 }).penaltyPercent === 0);
ok('satuan skor tidak dikenal -> point', sanitizeSharedSettings({ scoreUnit: 'x' }).scoreUnit === 'point');
ok('satuan skor percent dipertahankan', sanitizeSharedSettings({ scoreUnit: 'percent' }).scoreUnit === 'percent');

if (bad) process.exitCode = 1; else console.log('\nSemua tes Komunitas Kuis & papan peringkat lulus.');
