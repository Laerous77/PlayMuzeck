// Jalankan: npx tsx tests/quizSegments.test.ts   (atau: npm run test:quiz)
import { normalizeQuizSegment, QUIZ_SEGMENTS, DEFAULT_QUIZ_SEGMENT } from '../src/components/PusatKuis/quizSegments.ts';

let bad = 0;
const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };

for (const s of QUIZ_SEGMENTS) ok(`segmen "${s}" dipertahankan`, normalizeQuizSegment(s) === s);
ok('"leaderboard" lama dipetakan ke community', normalizeQuizSegment('leaderboard') === 'community');
ok('nilai tak dikenal -> bawaan', normalizeQuizSegment('xyz') === DEFAULT_QUIZ_SEGMENT);
ok('undefined -> bawaan', normalizeQuizSegment(undefined) === DEFAULT_QUIZ_SEGMENT);
ok('null -> bawaan', normalizeQuizSegment(null) === DEFAULT_QUIZ_SEGMENT);
ok('angka -> bawaan', normalizeQuizSegment(5) === DEFAULT_QUIZ_SEGMENT);
ok('tidak ada lagi segmen "leaderboard" terpisah', !(QUIZ_SEGMENTS as readonly string[]).includes('leaderboard'));

if (bad) process.exitCode = 1; else console.log('\nSemua tes segmen Pusat Kuis lulus.');
