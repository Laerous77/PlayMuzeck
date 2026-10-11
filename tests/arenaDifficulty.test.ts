// Tes sistem tingkat kesulitan Arena Global: aturan 4 tingkat (waktu, jumlah soal, penalti, porsi soal komunitas),
// penyusun permainan (server/arenaMatch.ts), tidak ada soal kembar dalam satu permainan, dan pemuat kumpulan soal.
// Tanpa jaringan, tanpa database asli. Jalankan: npx tsx tests/arenaDifficulty.test.ts
import { BUILTIN_DECKS } from '../src/data/quiz/index.ts';
import {
  ARENA_DIFFICULTIES,
  ARENA_DIFFICULTY_IDS,
  ARENA_HARD_PENALTY_POINTS,
  arenaNegativeScoring,
  arenaWrongPenalty,
  mixDeckId,
  parseArenaDifficulty,
  parseMixDeckId,
  type ArenaDifficulty,
} from '../src/data/quiz/arenaDifficulty.ts';
import { ARENA_MIN_QUESTIONS, cleanPool, composeMatch, hasDuplicateQuestions, isPlayableQuestion, normalizeQuestionText, type Rng } from '../server/arenaMatch.ts';
import { communityQuestionsFromRows, createQuestionPoolLoader } from '../server/arenaQuestionPools.ts';

let bad = 0;
const ok = (n: string, c: boolean) => {
  console.log(c ? 'ok  ' : 'GAGAL', n);
  if (!c) bad++;
};

// ── Pengacak yang bisa diulang (mulberry32) supaya tes deterministik ──
const seeded = (seed: number): Rng => {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { float: next, int: (max) => Math.floor(next() * max) };
};

const decks = (BUILTIN_DECKS as any[]).filter((d) => d.id.startsWith('deck-builtin-'));
// Bahan uji saja: deck bawaan dipinjam sebagai "soal resmi" dan "soal komunitas" palsu.
const official = decks.slice(0, 6).flatMap((d) => d.questions);
const community = decks.slice(6, 12).flatMap((d) => d.questions.map((q: any) => ({ ...q, ownerEmail: 'pembuat@contoh.id' })));
const pools = { official, community };

// ── Aturan tingkat ──
ok('ada 4 tingkat berurutan', ARENA_DIFFICULTY_IDS.join(',') === 'easy,normal,hard,extreme');
const T = ARENA_DIFFICULTIES;
ok('Mudah: 30-60 dtk, 10-20 soal, 10-25% komunitas', T.easy.timeSec.min === 30 && T.easy.timeSec.max === 60 && T.easy.questions.min === 10 && T.easy.questions.max === 20 && T.easy.communityShare.min === 0.1 && T.easy.communityShare.max === 0.25);
ok('Normal: 25-50 dtk, 15-30 soal, 20-40% komunitas', T.normal.timeSec.min === 25 && T.normal.timeSec.max === 50 && T.normal.questions.min === 15 && T.normal.questions.max === 30 && T.normal.communityShare.min === 0.2 && T.normal.communityShare.max === 0.4);
ok('Sulit: 15-40 dtk, 20-50 soal, 40-65% komunitas', T.hard.timeSec.min === 15 && T.hard.timeSec.max === 40 && T.hard.questions.min === 20 && T.hard.questions.max === 50 && T.hard.communityShare.min === 0.4 && T.hard.communityShare.max === 0.65);
ok('Ekstrem: 10-30 dtk, 30-100 soal, 65-95% komunitas', T.extreme.timeSec.min === 10 && T.extreme.timeSec.max === 30 && T.extreme.questions.min === 30 && T.extreme.questions.max === 100 && T.extreme.communityShare.min === 0.65 && T.extreme.communityShare.max === 0.95);
ok('Mudah & Normal: pengurangan skor tidak aktif', !arenaNegativeScoring('easy') && !arenaNegativeScoring('normal') && arenaWrongPenalty('easy') === 0 && arenaWrongPenalty('normal') === 0);
ok('Sulit: pengurangan skor aktif', arenaNegativeScoring('hard') && arenaWrongPenalty('hard') === ARENA_HARD_PENALTY_POINTS && ARENA_HARD_PENALTY_POINTS > 0);
ok('Ekstrem: penalti tepat 1,5 kali Sulit', arenaNegativeScoring('extreme') && arenaWrongPenalty('extreme') === ARENA_HARD_PENALTY_POINTS * 1.5 && Number.isInteger(arenaWrongPenalty('extreme')));
ok('makin sulit makin ketat (waktu turun, soal naik, komunitas naik)', ARENA_DIFFICULTY_IDS.every((id, i, a) => i === 0 || (T[id].timeSec.max < T[a[i - 1]].timeSec.max && T[id].questions.max > T[a[i - 1]].questions.max && T[id].communityShare.max > T[a[i - 1]].communityShare.max)));
ok('parse tingkat: kosong = Normal, ngawur = null', parseArenaDifficulty(undefined) === 'normal' && parseArenaDifficulty('hard') === 'hard' && parseArenaDifficulty('gila') === null && parseArenaDifficulty(7) === null);
ok('id campuran bolak-balik', ARENA_DIFFICULTY_IDS.every((d) => parseMixDeckId(mixDeckId(d)) === d) && parseMixDeckId('arena-mix-gila') === null && parseMixDeckId('deck-builtin-alam') === null);

// ── Validasi soal ──
const good = { question: 'Ibu kota Indonesia adalah?', options: ['Jakarta', 'Bandung', 'Medan'], correctIndex: 0 };
ok('soal normal layak', isPlayableQuestion(good));
ok('kunci di luar rentang ditolak', !isPlayableQuestion({ ...good, correctIndex: 3 }) && !isPlayableQuestion({ ...good, correctIndex: -1 }) && !isPlayableQuestion({ ...good, correctIndex: 0.5 }));
ok('pilihan kembar / kosong / terlalu sedikit ditolak', !isPlayableQuestion({ ...good, options: ['A', 'a', 'C'] }) && !isPlayableQuestion({ ...good, options: ['A', ' ', 'C'] }) && !isPlayableQuestion({ ...good, options: ['A'] }));
ok('teks soal terlalu pendek ditolak', !isPlayableQuestion({ ...good, question: 'a?' }));
ok('media data: (base64) ditolak, media https diterima', !isPlayableQuestion({ ...good, mediaType: 'image', mediaUrl: 'data:image/png;base64,AAAA' }) && isPlayableQuestion({ ...good, mediaType: 'image', mediaUrl: 'https://x.test/a.png' }));
ok('mediaType tanpa alamat ditolak', !isPlayableQuestion({ ...good, mediaType: 'audio' }));
ok('normalisasi teks: huruf besar/tanda baca/spasi diabaikan', normalizeQuestionText('  Ibu-kota   INDONESIA, apa?! ') === normalizeQuestionText('ibu kota indonesia apa'));
{
  const dup = [good, { ...good, question: 'IBU KOTA Indonesia adalah??' }, { ...good, question: 'Soal lain yang berbeda?' }];
  ok('cleanPool membuang soal kembar', cleanPool(dup).length === 2);
}

// ── Penyusun permainan: tiap tingkat, banyak undian ──
const TRIALS = 300;
for (const id of ARENA_DIFFICULTY_IDS) {
  const cfg = T[id];
  const rng = seeded(1000 + ARENA_DIFFICULTY_IDS.indexOf(id));
  let allInRange = true;
  let noDup = true;
  let keysKept = true;
  let shareSum = 0;
  let communitySum = 0;
  let totalSum = 0;
  let minTotal = Infinity;
  let maxTotal = 0;
  let minSec = Infinity;
  let maxSec = 0;
  let ownerHidden = true;
  for (let i = 0; i < TRIALS; i++) {
    const m = composeMatch(pools, id, rng);
    if (!m) {
      allInRange = false;
      continue;
    }
    const n = m.questions.length;
    minTotal = Math.min(minTotal, n);
    maxTotal = Math.max(maxTotal, n);
    minSec = Math.min(minSec, m.secPerQuestion);
    maxSec = Math.max(maxSec, m.secPerQuestion);
    // Stok (180 resmi + 180 komunitas = 360) cukup untuk semua tingkat, jadi jumlah soal selalu di dalam rentang.
    if (n < cfg.questions.min || n > cfg.questions.max || m.shortened) allInRange = false;
    if (m.secPerQuestion < cfg.timeSec.min || m.secPerQuestion > cfg.timeSec.max || !Number.isInteger(m.secPerQuestion)) allInRange = false;
    if (m.communityChance < cfg.communityShare.min || m.communityChance > cfg.communityShare.max) allInRange = false;
    if (m.officialQuestions + m.communityQuestions !== n) allInRange = false;
    if (m.questions.filter((q) => q.origin === 'community').length !== m.communityQuestions) allInRange = false;
    if (m.penalty !== arenaWrongPenalty(id)) allInRange = false;
    if (hasDuplicateQuestions(m.questions)) noDup = false;
    if (new Set(m.questions.map((q) => q.id)).size !== n) noDup = false;
    for (const q of m.questions) {
      const src = [...official, ...community].find((s: any) => s.question === q.question) as any;
      if (!src || src.options[src.correctIndex] !== q.options[q.correctIndex]) keysKept = false;
      if (q.timeLimitSec !== m.secPerQuestion) allInRange = false;
      if (q.origin === 'official' && q.ownerEmail) ownerHidden = false;
    }
    shareSum += m.communityQuestions / n;
    communitySum += m.communityQuestions;
    totalSum += n;
  }
  ok(`${cfg.label}: waktu, jumlah soal, dan peluang komunitas selalu di dalam rentang`, allInRange);
  ok(`${cfg.label}: rentang jumlah soal terpakai penuh (${minTotal}-${maxTotal})`, minTotal <= cfg.questions.min + 2 && maxTotal >= cfg.questions.max - 2);
  ok(`${cfg.label}: rentang waktu terpakai penuh (${minSec}-${maxSec} dtk)`, minSec <= cfg.timeSec.min + 2 && maxSec >= cfg.timeSec.max - 2);
  ok(`${cfg.label}: tidak ada soal kembar dalam satu permainan (${TRIALS} permainan)`, noDup);
  ok(`${cfg.label}: kunci jawaban tetap benar setelah pengacakan pilihan`, keysKept);
  const avg = communitySum / totalSum;
  ok(`${cfg.label}: rata-rata soal komunitas ${(avg * 100).toFixed(1)}% ada di rentang ${cfg.communityShare.min * 100}-${cfg.communityShare.max * 100}%`, avg >= cfg.communityShare.min - 0.02 && avg <= cfg.communityShare.max + 0.02);
  ok(`${cfg.label}: porsi komunitas bervariasi antar permainan (hasil pengacakan, bukan angka tetap)`, shareSum / TRIALS > 0 && new Set(Array.from({ length: 20 }, () => composeMatch(pools, id, rng)!.communityQuestions)).size > 1);
  ok(`${cfg.label}: email pembuat hanya melekat pada soal komunitas`, ownerHidden);
}

// ── Stok terbatas ──
{
  const few = { official: official.slice(0, 8), community: [] as any[] };
  const m = composeMatch(few, 'extreme', seeded(7))!;
  ok('stok kurang dari jumlah undian: permainan dipersingkat, bukan gagal', m.questions.length === 8 && m.shortened && m.officialQuestions === 8 && m.communityQuestions === 0);
  ok('stok di bawah minimum: tidak ada permainan', composeMatch({ official: official.slice(0, ARENA_MIN_QUESTIONS - 1), community: [] }, 'easy', seeded(1)) === null && composeMatch({ official: [], community: [] }, 'easy', seeded(1)) === null);
  const onlyCommunity = composeMatch({ official: [], community: community.slice(0, 40) }, 'easy', seeded(2))!;
  ok('tanpa soal resmi: kekurangan ditutup soal komunitas', onlyCommunity.communityQuestions === onlyCommunity.questions.length && onlyCommunity.officialQuestions === 0);
  const onlyOfficial = composeMatch({ official: official.slice(0, 60), community: [] }, 'extreme', seeded(3))!;
  ok('tanpa soal komunitas: kekurangan ditutup soal resmi', onlyOfficial.officialQuestions === onlyOfficial.questions.length && onlyOfficial.communityQuestions === 0);
  // Soal komunitas kembar dengan soal resmi dibuang (yang resmi dipertahankan).
  const twin = { ...official[0], ownerEmail: 'x@y.z' };
  const m2 = composeMatch({ official: official.slice(0, 5), community: [twin, ...community.slice(0, 20)] }, 'normal', seeded(4))!;
  ok('soal komunitas kembar dengan soal resmi tidak muncul dua kali', !hasDuplicateQuestions(m2.questions));
  const tiny = composeMatch({ official: [], community: [twin, twin, twin, twin, twin, twin] }, 'easy', seeded(5));
  ok('enam salinan soal yang sama dihitung satu: stok kurang, tidak ada permainan', tiny === null);
  const garbage = composeMatch({ official: [{ question: 'x', options: [], correctIndex: 0 }] as any, community: null as any }, 'easy', seeded(6));
  ok('kumpulan rusak tidak membuat server error', garbage === null);
}

// ── Pemuat kumpulan soal (database palsu) ──
{
  const rows = [
    { owner_email: 'Budi@Contoh.ID', questions: community.slice(0, 6).map(({ ownerEmail, ...q }: any) => q) },
    { owner_email: 'pendek@contoh.id', questions: community.slice(6, 8).map(({ ownerEmail, ...q }: any) => q) }, // < 5 soal: dilewati
    { owner_email: 'rusak@contoh.id', questions: [...community.slice(8, 13).map(({ ownerEmail, ...q }: any) => q), { question: 'rusak', options: ['a'], correctIndex: 5 }] },
  ];
  const qs = communityQuestionsFromRows(rows);
  ok('soal komunitas diambil, kuis < 5 soal dilewati, soal rusak dibuang', qs.length === 6 + 5);
  ok('email pembuat dibersihkan ke huruf kecil', qs.slice(0, 6).every((q) => q.ownerEmail === 'budi@contoh.id'));

  let dbCalls = 0;
  let now = 1_000;
  const db: any = {
    async query(sql: string) {
      dbCalls++;
      if (/FROM arena_preset_decks/.test(sql)) return { rows: [] };
      if (/FROM shared_quizzes/.test(sql)) return { rows };
      return { rows: [] };
    },
  };
  const load = createQuestionPoolLoader(db, 60_000, () => now);
  const p1 = await load();
  const callsAfterFirst = dbCalls;
  await load();
  ok('kumpulan soal di-cache (tidak membebani database tiap permainan)', dbCalls === callsAfterFirst && p1.community.length === 11);
  now += 61_000;
  await load();
  ok('cache dimuat ulang setelah kedaluwarsa', dbCalls > callsAfterFirst);

  let seenSql = '';
  const spy: any = { async query(sql: string) { if (/FROM shared_quizzes/.test(sql)) seenSql = sql; return { rows: [] }; } };
  await createQuestionPoolLoader(spy)();
  ok('kueri komunitas memfilter status approved dan akun tidak ditangguhkan', /moderation_status = 'approved'/.test(seenSql) && /suspended_at IS NULL/.test(seenSql));
  const empty = createQuestionPoolLoader(spy, 60_000, () => now);
  const e1 = await empty();
  ok('hasil kosong tidak di-cache', e1.official.length === 0 && e1.community.length === 0);
}

if (bad) process.exitCode = 1;
else console.log('\nSemua tes tingkat kesulitan Arena Global lulus.');
