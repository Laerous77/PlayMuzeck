// Tes: Arena Global HANYA memakai kuis Komunitas yang disetujui. Tanpa kuis Komunitas, lobi menunggu (tidak jatuh ke
// deck bawaan gratis/berbayar). Memakai io/socket palsu dan jam terkendali. Jalankan: npx tsx tests/globalArenaCommunityOnly.test.ts
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
const ident = (n: string) => ({ clientId: `client-${n}-0000000000`, name: n, avatarUrl: '', frameId: 'none' });
const communityDeck = (suffix: string, from: number) => ({
  deckId: `deck-custom-shared-shq_${suffix}`,
  title: `Kuis Komunitas ${suffix}`,
  source: 'community' as const,
  ownerName: 'Pembuat Uji',
  questions: (BUILTIN_DECKS as any[])[from].questions, // hanya bahan uji; bukan sumber arena
});

// ── 1. Tanpa kuis Komunitas: lobi menunggu, lalu menemukan kuis saat sudah ada ──
{
  const arena = await fresh('kosong');
  const io = new FakeIo();
  let calls = 0;
  let pool: any[] = [];
  arena.attachGlobalArena(io as any, {
    pickCommunityDeck: async () => {
      calls++;
      return pool[0] ?? null;
    },
  });
  const t = io.connect();
  t.fire('arena:join', ident('Sendiri'));
  await flush();
  await flush();
  const st = t.last('arena:update');
  ok('tanpa kuis Komunitas: lobi menunggu kuis', st.waitingForQuiz === true && !st.deckTitle);
  ok('tanpa kuis Komunitas: tidak ada hitung mundur dan tidak ada deck bawaan', st.phaseEndsAt === null && st.deckSource === null);
  const before = calls;
  advance(2_000);
  await flush();
  ok('pencarian ulang dibatasi (tidak tiap tick)', calls === before);
  pool = [communityDeck('cccccccccccc', 5)];
  advance(11_000);
  await flush();
  const st2 = t.last('arena:update');
  ok('kuis Komunitas baru terdeteksi saat dicoba lagi', st2.waitingForQuiz === false && st2.deckSource === 'community' && st2.phaseEndsAt !== null);
}

// ── 2. Pemilih yang mengembalikan deck bawaan (walau berpura-pura komunitas) ditolak server ──
{
  const arena = await fresh('bawaan');
  const io = new FakeIo();
  const first = (BUILTIN_DECKS as any[])[0];
  arena.attachGlobalArena(io as any, {
    pickCommunityDeck: async () => ({ deckId: first.id, title: first.title, source: 'community', questions: first.questions }) as any,
  });
  const t = io.connect();
  t.fire('arena:join', ident('Penguji'));
  await flush();
  await flush();
  const st = t.last('arena:update');
  ok('deck bawaan yang menyelinap lewat pemilih ditolak server', st.waitingForQuiz === true && !st.deckTitle && st.deckSource === null);
}

if (bad) process.exitCode = 1;
else console.log('\nSemua tes "hanya kuis Komunitas" lulus.');
