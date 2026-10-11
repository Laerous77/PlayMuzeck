// Tes: Arena Global hanya memakai soal dari kumpulan yang diberikan pemuat server (soal resmi Arena + soal Komunitas yang disetujui),
// tidak pernah deck bawaan gratis/berbayar, dan hanya soal yang layak. Tanpa stok soal yang cukup (Komunitas kosong dan tidak ada
// deck preset aktif), lobi menunggu. Memakai io/socket palsu dan jam terkendali. Jalankan: npx tsx tests/globalArenaCommunityOnly.test.ts
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
  connect() {
    const s = new FakeSocket();
    this.sockets.sockets.set(s.id, s);
    this.conn!(s);
    return s;
  }
}

// Modul dimuat ulang per skenario supaya daftar kanal (state modul) tidak tercampur.
const fresh = (tag: string) => import(`../server/globalArena.ts?skenario=${tag}`) as Promise<typeof import('../server/globalArena')>;
const ident = (n: string) => ({ clientId: `client-${n}-0000000000`, name: n, avatarUrl: '', frameId: 'none', difficulty: 'easy' });
const communityQs = (from: number) => (BUILTIN_DECKS as any[])[from].questions.map((q: any) => ({ ...q, ownerEmail: 'pembuat@contoh.id' })); // hanya bahan uji; bukan sumber arena

// ── 1. Tanpa kuis Komunitas: lobi menunggu, lalu menemukan kuis saat sudah ada ──
{
  const arena = await fresh('kosong');
  const io = new FakeIo();
  let calls = 0;
  let pool: any[] = [];
  arena.attachGlobalArena(io as any, {
    loadQuestionPools: async () => {
      calls++;
      return { official: [], community: pool };
    },
  });
  const t = io.connect();
  t.fire('arena:join', ident('Sendiri'));
  await flush();
  await flush();
  const st = t.last('arena:update');
  ok('tanpa stok soal: lobi menunggu', st.waitingForQuiz === true && !st.deckTitle && st.matchInfo === null);
  ok('tanpa stok soal: tidak ada hitung mundur dan tidak ada deck bawaan', st.phaseEndsAt === null && st.deckSource === null);
  const before = calls;
  advance(2_000);
  await flush();
  ok('pencarian ulang dibatasi (tidak tiap tick)', calls === before);
  pool = communityQs(5);
  advance(11_000);
  await flush();
  const st2 = t.last('arena:update');
  ok('soal Komunitas baru terdeteksi saat dicoba lagi', st2.waitingForQuiz === false && st2.deckSource === 'mixed' && st2.phaseEndsAt !== null && st2.matchInfo.communityQuestions === st2.matchInfo.questions);
}

// ── 2. Soal yang tidak layak (kunci rusak, pilihan kembar, media data:) ditolak server; soal bagus yang tersisa < minimum = menunggu ──
{
  const arena = await fresh('rusak');
  const io = new FakeIo();
  const good = communityQs(0).slice(0, 4); // hanya 4 soal layak: di bawah minimum 5
  const broken = [
    { question: 'Kunci jawaban di luar rentang?', options: ['a', 'b'], correctIndex: 7 },
    { question: 'Pilihan kembar atau tidak?', options: ['sama', 'SAMA', 'lain'], correctIndex: 0 },
    { question: 'Soal dengan media base64?', options: ['a', 'b'], correctIndex: 0, mediaType: 'image', mediaUrl: 'data:image/png;base64,AAAA' },
  ];
  arena.attachGlobalArena(io as any, { loadQuestionPools: async () => ({ official: [], community: [...good, ...broken] }) });
  const t = io.connect();
  t.fire('arena:join', ident('Penguji'));
  await flush();
  await flush();
  const st = t.last('arena:update');
  ok('soal rusak tidak dihitung: stok layak < 5, lobi menunggu', st.waitingForQuiz === true && !st.deckTitle && st.deckSource === null);
}

// ── 3. Deret soal kembar tidak menambah stok ──
{
  const arena = await fresh('kembar');
  const io = new FakeIo();
  const one = communityQs(1)[0];
  arena.attachGlobalArena(io as any, { loadQuestionPools: async () => ({ official: [one, one, one], community: [one, one, one] }) });
  const t = io.connect();
  t.fire('arena:join', ident('Penguji'));
  await flush();
  await flush();
  ok('soal yang sama berulang-ulang dihitung satu: stok kurang, lobi menunggu', t.last('arena:update').waitingForQuiz === true);
}

if (bad) process.exitCode = 1;
else console.log('\nSemua tes "hanya kuis Komunitas" lulus.');
