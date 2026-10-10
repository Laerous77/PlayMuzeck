// Tes deck preset Arena Global: validasi 20 soal, id/tema, kelayakan di arena, pemilih campuran Komunitas + preset,
// dan rute admin (hanya admin, tidak bisa aktif bila belum 20 soal). Memakai database palsu.
// Jalankan: npx tsx tests/arenaPreset.test.ts
import { BUILTIN_DECKS } from '../src/data/quiz/index.ts';
import { ARENA_DECK_SIZE, ARENA_THEMES, ARENA_THEME_IDS, parsePresetDeckId, presetDeckId } from '../src/data/quiz/arenaThemes.ts';
import { isArenaEligibleDeck } from '../server/globalArena.ts';
import { listActivePresetDecks, pickArenaDeck, sanitizePresetQuestions, createArenaPresetRouter } from '../server/arenaPresetRoutes.ts';

let bad = 0;
const ok = (n: string, c: boolean) => {
  console.log(c ? 'ok  ' : 'GAGAL', n);
  if (!c) bad++;
};

const mkQs = (n: number, tag = 'Q') =>
  Array.from({ length: n }, (_, i) => ({ question: `${tag} pertanyaan ke-${i + 1}?`, options: ['A', 'B', 'C', 'D'], correctIndex: i % 4, explanation: 'x', category: 'Umum' }));

// ── Tema ──
ok('ada tepat 12 tema', ARENA_THEMES.length === 12 && new Set(ARENA_THEME_IDS).size === 12);
ok('urut dari alam sampai teknologi', ARENA_THEME_IDS[0] === 'alam' && ARENA_THEME_IDS[11] === 'teknologi');
ok('ukuran deck 20', ARENA_DECK_SIZE === 20);
ok('id preset bolak-balik', parsePresetDeckId(presetDeckId('seni')) === 'seni');
ok('id preset palsu ditolak', parsePresetDeckId('arena-preset-ngawur') === null && parsePresetDeckId('deck-builtin-alam') === null);

// ── Validasi soal ──
{
  const r = sanitizePresetQuestions(mkQs(20), 'alam');
  ok('20 soal sah lolos', r.errors.length === 0 && r.questions.length === 20 && r.questions[0].id === 'ap-alam-01');
  ok('lebih dari 20 soal ditolak', sanitizePresetQuestions(mkQs(21), 'alam').errors.length > 0);
  const dup = mkQs(3);
  dup[2].question = dup[0].question;
  ok('soal kembar ditolak', sanitizePresetQuestions(dup, 'alam').errors.some((e) => /sama/.test(e)));
  ok('correctIndex di luar rentang ditolak', sanitizePresetQuestions([{ ...mkQs(1)[0], correctIndex: 9 }], 'alam').errors.length === 1);
  ok('pilihan kembar ditolak', sanitizePresetQuestions([{ ...mkQs(1)[0], options: ['A', 'a', 'C', 'D'] }], 'alam').errors.length === 1);
  ok('media non-https ditolak', sanitizePresetQuestions([{ ...mkQs(1)[0], mediaType: 'image', mediaUrl: 'http://x.test/a.png' }], 'alam').errors.length === 1);
  const html = sanitizePresetQuestions([{ ...mkQs(1)[0], question: '<b>Halo dunia</b>?' }], 'alam');
  ok('tag HTML dibersihkan', !/[<>]/.test(html.questions[0].question));
}

// ── Kelayakan di arena ──
const preset = (theme: string, n = 20) => ({ deckId: presetDeckId(theme), title: `Preset ${theme}`, source: 'preset' as const, questions: mkQs(n) });
ok('deck preset sah diterima arena', isArenaEligibleDeck(preset('alam') as any));
ok('preset dengan id tema palsu ditolak', !isArenaEligibleDeck({ ...preset('alam'), deckId: 'arena-preset-ngawur' } as any));
ok('preset berpura-pura komunitas ditolak', !isArenaEligibleDeck({ ...preset('alam'), source: 'community' } as any));
ok('id komunitas berpura-pura preset ditolak', !isArenaEligibleDeck({ ...preset('alam'), deckId: 'deck-custom-shared-shq_aaaaaaaaaaaa' } as any));
ok('deck bawaan tetap ditolak walau source preset', (BUILTIN_DECKS as any[]).every((d) => !isArenaEligibleDeck({ deckId: d.id, title: d.title, source: 'preset', questions: d.questions } as any)));

// ── Database palsu ──
type Row = { theme_id: string; title: string; questions: any[]; enabled: boolean; updated_by?: string };
const mkDb = (rows: Row[], communityCount: number) => ({
  rows,
  async query(sql: string, params: any[] = []) {
    if (/FROM arena_preset_decks\s+WHERE enabled/.test(sql)) {
      return { rows: rows.filter((r) => r.enabled && r.questions.length === params[0]) };
    }
    if (/count\(\*\)/.test(sql)) return { rows: [{ n: communityCount }] };
    return { rows: [] };
  },
});
const community = { deckId: 'deck-custom-shared-shq_aaaaaaaaaaaa', title: 'Komunitas', source: 'community' as const, questions: mkQs(8) };

{
  const db = mkDb(
    [
      { theme_id: 'alam', title: 'Alam', questions: mkQs(20), enabled: true },
      { theme_id: 'seni', title: 'Seni', questions: mkQs(19), enabled: true }, // belum lengkap
      { theme_id: 'bahasa', title: 'Bahasa', questions: mkQs(20), enabled: false }, // nonaktif
    ],
    0
  );
  const active = await listActivePresetDecks(db as any);
  ok('hanya preset aktif & lengkap yang masuk rotasi', active.length === 1 && active[0].deckId === 'arena-preset-alam');
  const d = await pickArenaDeck(db as any, async () => null);
  ok('tanpa komunitas, arena memakai preset', d?.source === 'preset' && d.deckId === 'arena-preset-alam');
  ok('hasil pemilih lolos kelayakan arena', isArenaEligibleDeck(d));
}
{
  const db = mkDb([], 0);
  ok('tanpa komunitas dan tanpa preset: tidak ada kuis', (await pickArenaDeck(db as any, async () => null)) === null);
  const c = await pickArenaDeck(db as any, async () => community);
  ok('hanya komunitas: komunitas dipakai', c?.source === 'community');
}
{
  const db = mkDb(ThemeRows(), 12);
  let comm = 0;
  let pre = 0;
  for (let i = 0; i < 600; i++) {
    const d = await pickArenaDeck(db as any, async () => community);
    if (d?.source === 'community') comm++;
    else if (d?.source === 'preset') pre++;
  }
  ok('campuran: komunitas dan preset sama-sama terpilih', comm > 100 && pre > 100);
}
function ThemeRows(): Row[] {
  return ARENA_THEME_IDS.map((id) => ({ theme_id: id, title: id, questions: mkQs(20), enabled: true }));
}

// ── Rute admin ──
{
  const store = new Map<string, any>();
  const db: any = {
    async query(sql: string, params: any[] = []) {
      if (/^\s*CREATE TABLE/.test(sql)) return { rows: [] };
      if (/SELECT theme_id, title, questions, enabled/.test(sql)) return { rows: [...store.entries()].map(([k, v]) => ({ theme_id: k, ...v })) };
      if (/SELECT title, questions, enabled/.test(sql)) return { rows: store.has(params[0]) ? [store.get(params[0])] : [] };
      if (/SELECT questions FROM/.test(sql)) return { rows: store.has(params[0]) ? [{ questions: store.get(params[0]).questions }] : [] };
      if (/INSERT INTO arena_preset_decks/.test(sql)) {
        store.set(params[0], { title: params[1], questions: JSON.parse(params[2]), enabled: params[3], updated_by: params[4] });
        return { rows: [] };
      }
      if (/UPDATE arena_preset_decks SET enabled/.test(sql)) {
        store.get(params[0]).enabled = params[1];
        return { rows: [] };
      }
      if (/DELETE FROM arena_preset_decks/.test(sql)) {
        store.delete(params[0]);
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  let isAdmin = true;
  const router: any = createArenaPresetRouter({
    db,
    requireAdmin: (req: any, res: any, next: any) => (isAdmin ? ((req.adminEmail = 'a@b.c'), next()) : res.status(401).json({ error: 'x' })),
  });
  const layer = (method: string, path: string) =>
    router.stack.find((l: any) => l.route && l.route.path === path && l.route.methods[method]).route.stack.map((s: any) => s.handle);
  const call = async (method: string, path: string, params: any, body: any) => {
    const req: any = { params, body, headers: {} };
    let status = 200;
    let json: any;
    const res: any = {
      headersSent: false,
      status(c: number) {
        status = c;
        return res;
      },
      json(j: any) {
        json = j;
        res.headersSent = true;
        return res;
      },
    };
    const handlers = layer(method, path);
    let i = 0;
    const next = async (): Promise<void> => {
      const h = handlers[i++];
      if (h) await h(req, res, next);
    };
    await next();
    await new Promise((r) => setImmediate(r));
    return { status, json };
  };

  const P = '/api/admin/arena-decks/:theme';
  const list0 = await call('get', '/api/admin/arena-decks', {}, {});
  ok('daftar menampilkan 12 tema kosong', list0.json.themes.length === 12 && list0.json.themes.every((t: any) => t.questionCount === 0 && !t.enabled));
  ok('tema tidak dikenal 404', (await call('put', P, { theme: 'ngawur' }, { questions: [] })).status === 404);
  ok('draf 10 soal boleh disimpan', (await call('put', P, { theme: 'alam' }, { questions: mkQs(10), enabled: false })).json?.questionCount === 10);
  ok('draf 10 soal TIDAK bisa diaktifkan (PUT)', (await call('put', P, { theme: 'alam' }, { questions: mkQs(10), enabled: true })).status === 400);
  ok('draf 10 soal TIDAK bisa diaktifkan (PATCH)', (await call('patch', P, { theme: 'alam' }, { enabled: true })).status === 400);
  ok('21 soal ditolak', (await call('put', P, { theme: 'alam' }, { questions: mkQs(21) })).status === 400);
  const full = await call('put', P, { theme: 'alam' }, { title: 'Alam Arena', questions: mkQs(20), enabled: true });
  ok('20 soal bisa disimpan dan diaktifkan', full.json?.enabled === true && store.get('alam').enabled === true);
  const list1 = await call('get', '/api/admin/arena-decks', {}, {});
  const alam = list1.json.themes.find((t: any) => t.id === 'alam');
  ok('ringkasan: alam 20/20 aktif', alam.questionCount === 20 && alam.complete && alam.enabled && alam.title === 'Alam Arena');
  ok('GET deck memuat soal & kunci untuk admin', (await call('get', P, { theme: 'alam' }, {})).json.questions.length === 20);
  ok('nonaktifkan lewat PATCH', (await call('patch', P, { theme: 'alam' }, { enabled: false })).json?.enabled === false);
  ok('hapus deck', (await call('delete', P, { theme: 'alam' }, {})).json?.success === true && !store.has('alam'));
  isAdmin = false;
  ok('non-admin ditolak', (await call('get', '/api/admin/arena-decks', {}, {})).status === 401);
}

if (bad) process.exitCode = 1;
else console.log('\nSemua tes deck preset Arena lulus.');
