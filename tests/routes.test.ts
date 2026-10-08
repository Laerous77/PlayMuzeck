// Jalankan: npx tsx tests/routes.test.ts   (atau: npm run test:routes)
import { parseRoute, buildPath, resolveAudioSection, resolveQuizSegment, isAliasRoute, QUIZ_SLUG } from '../src/services/routes.ts';

let bad = 0;
const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };
const j = JSON.stringify;

ok('/ -> index', parseRoute('/').kind === 'index');
for (const s of ['assets', 'pad', 'tools', 'pricing']) {
  const r: any = parseRoute(`/audio/${s}`);
  ok(`/audio/${s}`, r.kind === 'audio' && r.section === s);
  ok(`buildPath audio ${s}`, buildPath('audio', s as any, 'all') === `/audio/${s}`);
}
const quizMap: Record<string, string> = { download: 'pwa', play: 'play', library: 'all', hall: 'community' };
for (const [slug, seg] of Object.entries(quizMap)) {
  const r: any = parseRoute(`/quiz/${slug}`);
  ok(`/quiz/${slug} -> ${seg}`, r.kind === 'quiz' && r.segment === seg);
  ok(`buildPath quiz ${seg}`, buildPath('quiz', 'tools', seg as any) === `/quiz/${slug}`);
  ok(`QUIZ_SLUG ${seg}`, (QUIZ_SLUG as any)[seg] === slug);
}
ok('/audio polos tanpa bagian', j(parseRoute('/audio')) === j({ kind: 'audio', section: null, toolSlug: null }));
ok('/audio/ (garis miring akhir)', (parseRoute('/audio/') as any).section === null);
ok('/audio/xyz tak dikenal -> tanpa bagian', (parseRoute('/audio/xyz') as any).section === null);
ok('/AUDIO/Pad tidak peka huruf besar', (parseRoute('/AUDIO/Pad') as any).section === 'pad');
ok('/audio/tools/tuner-gitar membawa slug', (parseRoute('/audio/tools/tuner-gitar') as any).toolSlug === 'tuner-gitar');
ok('/audio/pad/abc tidak membawa slug', (parseRoute('/audio/pad/abc') as any).toolSlug === null);
ok('/quiz polos tanpa segmen', (parseRoute('/quiz') as any).segment === null);
ok('/quiz/leaderboard lama -> tanpa segmen', (parseRoute('/quiz/leaderboard') as any).segment === null);
ok('/alat-audio -> legacy-tools', parseRoute('/alat-audio').kind === 'legacy-tools');
ok('/alat-audio/tuner-gitar -> slug', (parseRoute('/alat-audio/tuner-gitar') as any).toolSlug === 'tuner-gitar');
ok('/verify-email dibiarkan', parseRoute('/verify-email').kind === 'passthrough');
ok('/reset-password dibiarkan', parseRoute('/reset-password').kind === 'passthrough');
ok('/foo -> unknown', parseRoute('/foo').kind === 'unknown');
ok('buildPath index', buildPath('index', 'pad', 'hall' as any) === '/');

ok('simpanan kosong -> tools', resolveAudioSection(undefined) === 'tools');
ok('simpanan rusak -> tools', resolveAudioSection('zzz') === 'tools');
ok('simpanan pad dipakai', resolveAudioSection('pad') === 'pad');
ok('simpanan kuis kosong -> library (all)', resolveQuizSegment(undefined) === 'all');
ok('simpanan kuis leaderboard lama -> hall (community)', resolveQuizSegment('leaderboard') === 'community');

ok('alias: /audio', isAliasRoute(parseRoute('/audio')));
ok('alias: /quiz', isAliasRoute(parseRoute('/quiz')));
ok('alias: /alat-audio/x', isAliasRoute(parseRoute('/alat-audio/x')));
ok('alias: /audio/tools/slug', isAliasRoute(parseRoute('/audio/tools/slug')));
ok('bukan alias: /audio/pad', !isAliasRoute(parseRoute('/audio/pad')));
ok('bukan alias: /quiz/hall', !isAliasRoute(parseRoute('/quiz/hall')));
ok('bukan alias: /', !isAliasRoute(parseRoute('/')));

if (bad) process.exitCode = 1; else console.log('\nSemua tes routing lulus.');
