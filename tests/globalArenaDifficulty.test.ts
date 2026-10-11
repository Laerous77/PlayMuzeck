// Tes simulasi Arena Global per tingkat kesulitan: kanal terpisah per tingkat, aturan yang diumumkan server, pengurangan skor
// untuk jawaban salah di Sulit/Ekstrem (tidak di Mudah/Normal), skor tidak di bawah 0, tidak menjawab tidak dihukum, dan
// laporan permainan ke pencatat peringkat. Memakai io/socket palsu dan jam terkendali.
// Jalankan: npx tsx tests/globalArenaDifficulty.test.ts
import { BUILTIN_DECKS } from '../src/data/quiz/index.ts';

let bad = 0;
const ok = (n: string, c: boolean) => {
  console.log(c ? 'ok  ' : 'GAGAL', n);
  if (!c) bad++;
};

let clock = 1_800_000_000_000;
Date.now = () => clock;
let tick: () => void = () => {};
(globalThis as any).setInterval = (fn: () => void) => {
  tick = fn;
  return { unref() {}, ref() {} };
};
const advance = (ms: number) => {
  clock += ms;
  tick();
};
const flush = () => new Promise<void>((r) => setImmediate(r));

class FakeSocket {
  static seq = 0;
  id = `s${++FakeSocket.seq}`;
  data: Record<string, any> = {};
  rooms = new Set<string>();
  handlers = new Map<string, (p?: any) => void>();
  log: Array<[string, any]> = [];
  on(ev: string, fn: (p?: any) => void) {
    this.handlers.set(ev, fn);
  }
  emit(ev: string, payload?: any) {
    this.log.push([ev, payload]);
  }
  join(r: string) {
    this.rooms.add(r);
  }
  leave(r: string) {
    this.rooms.delete(r);
  }
  fire(ev: string, payload?: any) {
    this.handlers.get(ev)?.(payload);
  }
  last(ev: string) {
    return [...this.log].reverse().find((l) => l[0] === ev)?.[1];
  }
  all(ev: string) {
    return this.log.filter((l) => l[0] === ev).map((l) => l[1]);
  }
}
class FakeIo {
  sockets = { sockets: new Map<string, FakeSocket>() };
  conn: ((s: FakeSocket) => void) | null = null;
  on(ev: string, fn: (s: FakeSocket) => void) {
    if (ev === 'connection') this.conn = fn;
  }
  to(target: string) {
    return {
      emit: (ev: string, payload?: any) => {
        const direct = this.sockets.sockets.get(target);
        if (direct) return direct.emit(ev, payload);
        for (const s of this.sockets.sockets.values()) if (s.rooms.has(target)) s.emit(ev, payload);
      },
    };
  }
  connect(userId?: string) {
    const s = new FakeSocket();
    if (userId) s.data.userId = userId;
    this.sockets.sockets.set(s.id, s);
    this.conn!(s);
    return s;
  }
}

const arena = await import('../server/globalArena.ts');
const io = new FakeIo();
const deckQs = (i: number) => (BUILTIN_DECKS as any[])[i].questions as any[];
// Bahan uji: 120 soal "resmi" + 120 soal "komunitas" (stok cukup untuk semua tingkat kecuali Ekstrem yang dipersingkat bila perlu).
const pools = {
  official: [3, 4, 5, 6].flatMap(deckQs),
  community: [7, 8, 9, 10].flatMap((i) => deckQs(i).map((q) => ({ ...q, ownerEmail: 'pembuat@contoh.id' }))),
};
const finished: any[] = [];
arena.attachGlobalArena(io as any, {
  loadQuestionPools: async () => pools,
  onFinished: async (game) => {
    finished.push(game);
    return {};
  },
});

const ident = (n: string, difficulty?: string) => ({ clientId: `client-${n}-0000000000`, name: n, avatarUrl: '', frameId: 'none', ...(difficulty ? { difficulty } : {}) });
const allQs = [...pools.official, ...pools.community];
const correctIdxOf = (publicQ: any) => {
  const src = allQs.find((x: any) => x.question === publicQ.question)!;
  return publicQ.options.indexOf(src.options[src.correctIndex]);
};
const wrongIdxOf = (publicQ: any) => (correctIdxOf(publicQ) + 1) % publicQ.options.length;
const me = (s: FakeSocket, name: string) => s.last('arena:update').players.find((p: any) => p.name === name);

// ── 1. Kanal terpisah per tingkat ──
const sEasy = io.connect('u-easy');
const sNormal = io.connect('u-normal');
const sHard = io.connect('u-hard');
const sHard2 = io.connect('u-hard2');
const sExtreme = io.connect('u-extreme');
const sDefault = io.connect();
sEasy.fire('arena:join', ident('Mudah1', 'easy'));
sNormal.fire('arena:join', ident('Normal1', 'normal'));
sHard.fire('arena:join', ident('Sulit1', 'hard'));
sHard2.fire('arena:join', ident('Sulit2', 'hard'));
sExtreme.fire('arena:join', ident('Ekstrem1', 'extreme'));
sDefault.fire('arena:join', ident('Default1')); // tanpa tingkat -> Normal
await flush();
await flush();

const chOf = (s: FakeSocket) => s.last('arena:update');
ok('tiap tingkat punya kanal sendiri', new Set([sEasy, sNormal, sHard, sExtreme].map((s) => chOf(s).channel)).size === 4);
ok('label kanal memuat nama tingkat', chOf(sEasy).channel.startsWith('Mudah') && chOf(sNormal).channel.startsWith('Normal') && chOf(sHard).channel.startsWith('Sulit') && chOf(sExtreme).channel.startsWith('Ekstrem'));
ok('dua pemain Sulit berada di kanal yang sama', chOf(sHard).channel === chOf(sHard2).channel && chOf(sHard).players.length === 2);
ok('pemain tanpa tingkat masuk Normal (bareng pemain Normal)', chOf(sDefault).difficulty === 'normal' && chOf(sDefault).channel === chOf(sNormal).channel && chOf(sNormal).players.length === 2);
ok('pemain tingkat lain tidak tercampur', chOf(sEasy).players.length === 1 && chOf(sExtreme).players.length === 1);

const bogus = io.connect();
bogus.fire('arena:join', ident('Nakal', 'gila'));
ok('tingkat tidak dikenal ditolak', Boolean(bogus.last('arena:error')) && !bogus.last('arena:joined'));
const bogus2 = io.connect();
bogus2.fire('arena:join', ident('Nakal2', '__proto__'));
ok('tingkat berbahaya ditolak', Boolean(bogus2.last('arena:error')) && !bogus2.last('arena:joined'));

// ── 2. Aturan yang diumumkan server sesuai tingkat ──
const R = (s: FakeSocket) => chOf(s).matchInfo;
ok('Mudah: tanpa penalti, 10-20 soal, 30-60 dtk', R(sEasy).penalty === 0 && !chOf(sEasy).negativeScoring && R(sEasy).questions >= 10 && R(sEasy).questions <= 20 && R(sEasy).secPerQuestion >= 30 && R(sEasy).secPerQuestion <= 60);
ok('Normal: tanpa penalti, 15-30 soal, 25-50 dtk', R(sNormal).penalty === 0 && R(sNormal).questions >= 15 && R(sNormal).questions <= 30 && R(sNormal).secPerQuestion >= 25 && R(sNormal).secPerQuestion <= 50);
ok('Sulit: penalti aktif, 20-50 soal, 15-40 dtk', R(sHard).penalty > 0 && chOf(sHard).negativeScoring && R(sHard).questions >= 20 && R(sHard).questions <= 50 && R(sHard).secPerQuestion >= 15 && R(sHard).secPerQuestion <= 40);
ok('Ekstrem: penalti 1,5x Sulit, 30-100 soal (atau sebanyak stok), 10-30 dtk', R(sExtreme).penalty === R(sHard).penalty * 1.5 && R(sExtreme).questions >= 30 && R(sExtreme).questions <= 100 && R(sExtreme).secPerQuestion >= 10 && R(sExtreme).secPerQuestion <= 30);
ok('judul permainan memuat tingkat', chOf(sHard).deckTitle === 'Arena Global · Sulit' && chOf(sExtreme).deckTitle === 'Arena Global · Ekstrem');
ok('ringkasan arena memuat jumlah pemain per tingkat', (() => {
  const sm: any = arena.getArenaSummary();
  return sm.byDifficulty.hard.playersOnline === 2 && sm.byDifficulty.easy.playersOnline === 1 && sm.byDifficulty.extreme.channels === 1 && sm.playersOnline >= 6;
})());

// ── 3. Pengurangan skor ──
// Mulai semua kanal.
advance(arena.ARENA_LOBBY_SEC * 1000 + 1);
const started = (s: FakeSocket) => s.last('arena:started');
ok('semua kanal tingkat memulai permainan sendiri', [sEasy, sNormal, sHard, sExtreme].every((s) => Boolean(started(s))));
const secs = (s: FakeSocket) => started(s).matchInfo.secPerQuestion as number;
ok('waktu soal yang diumumkan sama dengan yang dipakai server', [sEasy, sNormal, sHard, sExtreme].every((s) => Math.round((chOf(s).phaseEndsAt - clock) / 1000) === secs(s)));

const qOf = (s: FakeSocket, i: number) => started(s).questions[i];
const lastPts = (s: FakeSocket) => s.last('arena:answerResult').pointsAwarded as number;

// Soal 1: Sulit1 menjawab SALAH saat skor masih 0 -> tetap 0 (tidak negatif). Sulit2 menjawab benar seketika (100).
sHard.fire('arena:answer', { optionIndex: wrongIdxOf(qOf(sHard, 0)) });
sHard2.fire('arena:answer', { optionIndex: correctIdxOf(qOf(sHard2, 0)) });
ok('Sulit: salah saat skor 0 tidak membuat skor negatif', me(sHard, 'Sulit1').score === 0 && lastPts(sHard) === 0);
ok('Sulit: benar seketika = +100', me(sHard2, 'Sulit2').score === 100 && lastPts(sHard2) === 100);
// Pemain Mudah/Normal menjawab salah di soal 1: tidak ada pengurangan (dan skor memang 0).
sEasy.fire('arena:answer', { optionIndex: wrongIdxOf(qOf(sEasy, 0)) });
sNormal.fire('arena:answer', { optionIndex: wrongIdxOf(qOf(sNormal, 0)) });
sDefault.fire('arena:answer', { optionIndex: correctIdxOf(qOf(sDefault, 0)) });
sExtreme.fire('arena:answer', { optionIndex: correctIdxOf(qOf(sExtreme, 0)) });
ok('Ekstrem: benar seketika = +100 (poin benar sama di semua tingkat)', me(sExtreme, 'Ekstrem1').score === 100);
// Kanal-kanal punya waktu soal berbeda; maju per kanal: karena jam global, maju sebesar waktu terpanjang cukup untuk semua.
const advanceAllRound = () => {
  const longest = Math.max(...[sEasy, sNormal, sHard, sExtreme].map(secs));
  advance(longest * 1000 + 1);
  advance(arena.ARENA_GAP_SEC * 1000 + 1);
};
advanceAllRound();

// Soal 2 (semua kanal sudah di soal ke-2; kanal yang lebih cepat mungkin sudah lanjut lebih jauh -> pakai indeks dari server).
const curIdx = (s: FakeSocket) => chOf(s).currentQIndex as number;
ok('semua kanal maju ke soal berikutnya setelah jeda', [sEasy, sNormal, sHard, sExtreme].every((s) => chOf(s).phase === 'question' || chOf(s).phase === 'reveal'));

// Pastikan kita berada di fase soal untuk kanal yang diuji: bila kanal sudah melewati soal akibat selisih waktu, uji tetap valid
// karena penalti dihitung per jawaban pada fase 'question'. Untuk menghindari selisih, gunakan kanal yang fase-nya 'question'.
const inQuestion = (s: FakeSocket) => chOf(s).phase === 'question';

// Sulit2 (skor 100) menjawab SALAH -> 100 - penalti.
if (inQuestion(sHard2)) {
  const i = curIdx(sHard2);
  const before = me(sHard2, 'Sulit2').score;
  sHard2.fire('arena:answer', { optionIndex: wrongIdxOf(qOf(sHard2, i)) });
  const hardPenalty = R(sHard).penalty;
  ok(`Sulit: jawaban salah mengurangi skor sebesar penalti (${hardPenalty})`, me(sHard2, 'Sulit2').score === before - hardPenalty && lastPts(sHard2) === -hardPenalty);
  ok('Sulit: jawaban salah memutus streak', me(sHard2, 'Sulit2').streak === 0);
  const res = sHard2.last('arena:answerResult');
  ok('hasil jawaban memuat selisih negatif dan kunci', res.isCorrect === false && res.pointsAwarded === -hardPenalty && Number.isInteger(res.correctIndex));
} else ok('Sulit2 berada di fase soal', false);

if (inQuestion(sExtreme)) {
  const i = curIdx(sExtreme);
  const before = me(sExtreme, 'Ekstrem1').score; // 100
  sExtreme.fire('arena:answer', { optionIndex: wrongIdxOf(qOf(sExtreme, i)) });
  const extremePenalty = R(sExtreme).penalty;
  ok(`Ekstrem: jawaban salah mengurangi ${extremePenalty} poin (1,5x Sulit)`, me(sExtreme, 'Ekstrem1').score === before - extremePenalty && extremePenalty === R(sHard).penalty * 1.5);
} else ok('Ekstrem berada di fase soal', false);

// Mudah & Normal: bangun skor lalu salah -> skor tetap.
if (inQuestion(sNormal) && inQuestion(sDefault)) {
  const i = curIdx(sNormal);
  sDefault.fire('arena:answer', { optionIndex: correctIdxOf(qOf(sDefault, i)) });
  const before = me(sDefault, 'Default1').score; // sudah > 100
  ok('Normal: skor bertambah setelah jawaban benar', before > 100);
  sNormal.fire('arena:answer', { optionIndex: wrongIdxOf(qOf(sNormal, i)) });
  ok('Normal: jawaban salah tidak mengurangi skor', me(sNormal, 'Normal1').score === 0 && lastPts(sNormal) === 0);
} else ok('Normal berada di fase soal', false);

// Tidak menjawab sampai waktu habis tidak dihukum: Sulit2 diam di soal berikutnya.
{
  const keep = me(sHard2, 'Sulit2').score;
  advanceAllRound();
  ok('Sulit: tidak menjawab sampai waktu habis tidak mengurangi skor', me(sHard2, 'Sulit2').score === keep);
}

// ── 4. Permainan tuntas -> laporan ke pencatat peringkat ──
{
  let guard = 0;
  const wanted = ['arena-mix-easy', 'arena-mix-normal', 'arena-mix-hard', 'arena-mix-extreme'];
  while (!wanted.every((id) => finished.some((g) => g.deckId === id)) && guard++ < 30_000) {
    for (const s of [sEasy, sNormal, sHard, sHard2, sExtreme, sDefault]) {
      if (chOf(s).phase === 'question') {
        const i = curIdx(s);
        const q = started(s)?.questions?.[i];
        if (q) s.fire('arena:answer', { optionIndex: correctIdxOf(q) });
      }
    }
    advance(1000);
    // Maju sampai fase berubah: waktu soal/jeda/podium berjalan lewat tick 250 ms.
  }
  await flush();
  const byId = (id: string) => finished.filter((g) => g.deckId === id);
  ok('tiap tingkat yang tuntas melapor dengan id campuran masing-masing', ['arena-mix-easy', 'arena-mix-normal', 'arena-mix-hard', 'arena-mix-extreme'].every((id) => byId(id).length >= 1));
  const g = byId('arena-mix-hard')[0];
  ok('laporan Sulit memuat tingkat dan nama permainan', g.difficulty === 'hard' && g.deckTitle === 'Arena Global · Sulit');
  ok('laporan memuat jumlah soal sesuai rentang tingkat', g.questions.length >= 20 && g.questions.length <= 50);
  ok('laporan memuat email pembuat soal komunitas (untuk pengecualian poin)', g.ownerEmails.includes('pembuat@contoh.id'));
  ok('laporan hanya memuat akun login peserta', g.players.every((p: any) => p.userId.startsWith('u-')));
  ok('tidak ada soal kembar di permainan yang dilaporkan', new Set(g.questions.map((q: any) => q.question)).size === g.questions.length);
  const easyGame = byId('arena-mix-easy')[0];
  ok('jawaban benar dihitung server di tingkat Mudah', easyGame.players.find((p: any) => p.userId === 'u-easy').correct >= 1);
}

if (bad) process.exitCode = 1;
else console.log('\nSemua tes simulasi tingkat kesulitan lulus.');
