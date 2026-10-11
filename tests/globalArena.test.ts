// Tes Arena Global: siklus lobi -> soal -> jeda -> podium, kunci jawaban tidak bocor, pencatatan skor oleh server,
// kanal terpisah per tingkat kesulitan, pengurangan skor di Sulit/Ekstrem, dan sumber soal HANYA soal resmi Arena (deck preset admin)
// + kuis Komunitas yang disetujui (deck bawaan gratis/berbayar tidak pernah dipakai).
// Tes aturan tingkat & penyusun soal ada di tests/arenaDifficulty.test.ts; tes deck preset (12 tema x 20 soal, rute admin) di tests/arenaPreset.test.ts.
// Memakai io/socket palsu dan jam terkendali, jadi tidak butuh jaringan. Jalankan: npx tsx tests/globalArena.test.ts
import { BUILTIN_DECKS } from '../src/data/quiz/index.ts';

let bad = 0;
const ok = (n: string, c: boolean) => {
  console.log(c ? 'ok  ' : 'GAGAL', n);
  if (!c) bad++;
};

// ── Jam & timer terkendali (harus dipasang SEBELUM modul dimuat) ──
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

const arena = await import('../server/globalArena.ts');

// ── Kumpulan soal palsu (isi soal dipinjam dari data bawaan hanya sebagai bahan uji) ──
const deckQs = (from: number) => (BUILTIN_DECKS as any[])[from].questions as any[];
const communityDeck = (suffix: string, from: number) => ({
  deckId: `deck-custom-shared-shq_${suffix}`,
  title: `Kuis Komunitas ${suffix}`,
  source: 'community' as const,
  ownerName: 'Pembuat Uji',
  questions: deckQs(from),
});
// Soal resmi: deck 3-5 (90 soal). Soal komunitas: deck 6-8 (90 soal) milik pembuat@contoh.id.
const poolsNow = {
  official: [3, 4, 5].flatMap(deckQs),
  community: [6, 7, 8].flatMap((i) => deckQs(i).map((q) => ({ ...q, ownerEmail: 'pembuat@contoh.id' }))),
};
let poolCalls = 0;
let pools: { official: any[]; community: any[] } = poolsNow;
const loadQuestionPools = async () => {
  poolCalls++;
  return pools;
};

// ── io/socket palsu ──
class FakeSocket {
  static seq = 0;
  id = `s${++FakeSocket.seq}`;
  data: Record<string, any> = {};
  rooms = new Set<string>();
  handlers = new Map<string, (p?: any) => void>();
  log: Array<[string, any]> = [];
  constructor(private io: FakeIo) {}
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
    const s = new FakeSocket(this);
    if (userId) s.data.userId = userId;
    this.sockets.sockets.set(s.id, s);
    this.conn!(s);
    return s;
  }
}

// ── Fungsi murni ──
ok('poin penuh bila dijawab seketika', arena.arenaPoints(0) === 100);
ok('poin turun linear sampai 30%', arena.arenaPoints(1) === 30 && arena.arenaPoints(0.5) === 65);
ok('poin tidak keluar rentang', arena.arenaPoints(-1) === 100 && arena.arenaPoints(9) === 30);
const deck = communityDeck('aaaaaaaaaaaa', 3);
ok('deck komunitas sah untuk arena', arena.isArenaEligibleDeck(deck));
ok('deck bawaan/starter DITOLAK arena (gratis & berbayar)', (BUILTIN_DECKS as any[]).every((d) => !arena.isArenaEligibleDeck({ deckId: d.id, title: d.title, source: 'builtin', questions: d.questions } as any)));
ok('deck bawaan ditolak walau berpura-pura source community', (BUILTIN_DECKS as any[]).every((d) => !arena.isArenaEligibleDeck({ deckId: d.id, title: d.title, source: 'community', questions: d.questions } as any)));
ok('deck komunitas dengan soal terlalu sedikit ditolak', !arena.isArenaEligibleDeck({ ...deck, questions: deck.questions.slice(0, arena.ARENA_MIN_QUESTIONS - 1) }));
ok('penalti jawaban salah: 0 / 0 / Sulit / 1,5x Sulit', arena.applyWrongAnswer(50, 0).score === 50 && arena.applyWrongAnswer(50, 20).score === 30 && arena.applyWrongAnswer(50, 30).delta === -30);
ok('skor tidak pernah turun di bawah 0', arena.applyWrongAnswer(10, 30).score === 0 && arena.applyWrongAnswer(10, 30).delta === -10 && arena.applyWrongAnswer(0, 30).delta === 0);

// ── Simulasi permainan ──
const io = new FakeIo();
const finished: any[] = [];
arena.attachGlobalArena(io as any, {
  loadQuestionPools,
  onFinished: async (game) => {
    finished.push(game);
    return Object.fromEntries(game.players.map((p) => [p.userId, { counted: true, points: p.correct * 10 }]));
  },
});

const s1 = io.connect('user-1');
const s2 = io.connect('user-2');
const guest = io.connect();
const ident = (n: string, difficulty: string = 'easy') => ({ clientId: `client-${n}-0000000000`, name: n, avatarUrl: 'javascript:alert(1)', frameId: 'none', difficulty });

s1.fire('arena:join', ident('Ani'));
s2.fire('arena:join', ident('Budi'));
await flush();

const joined1 = s1.last('arena:joined');
ok('pemain masuk tanpa kode ruangan', Boolean(joined1) && !('code' in joined1.state));
ok('keadaan awal: lobi dengan permainan disusun server', joined1.state.phase === 'lobby');
await flush();
const lobbyState = s1.last('arena:update');
ok('server menyusun permainan untuk lobi berikutnya', Boolean(lobbyState?.deckTitle) && Boolean(lobbyState.matchInfo));
ok('soal permainan campuran (resmi + komunitas), bukan satu kuis utuh', lobbyState.deckSource === 'mixed' && lobbyState.deckTitle === 'Arena Global · Mudah');
ok('kanal bertingkat Mudah: aturan sesuai tingkat', lobbyState.difficulty === 'easy' && lobbyState.difficultyLabel === 'Mudah' && lobbyState.negativeScoring === false && lobbyState.matchInfo.penalty === 0 && lobbyState.channel.startsWith('Mudah'));
ok('jumlah soal & waktu di dalam rentang Mudah', lobbyState.matchInfo.questions >= 10 && lobbyState.matchInfo.questions <= 20 && lobbyState.matchInfo.secPerQuestion >= 30 && lobbyState.matchInfo.secPerQuestion <= 60);
ok('ringkasan permainan tidak memuat soal atau kunci', !('questions' in lobbyState.matchInfo && Array.isArray(lobbyState.matchInfo.questions)) && !JSON.stringify(lobbyState).includes('correctIndex'));
ok('lobi tidak menunggu kuis bila kuis tersedia', s1.last('arena:update').waitingForQuiz === false);
ok('avatar berbahaya dibuang', s1.last('arena:update').players.every((p: any) => p.avatarUrl === ''));
ok('dua pemain berada di kanal yang sama', s1.last('arena:update').players.length === 2);

// Pemain baru lewat refresh: id publik sama, bukan pemain ganda.
const s1b = io.connect('user-1');
s1b.fire('arena:join', ident('Ani'));
ok('refresh memulihkan pemain yang sama', s1b.last('arena:joined').you === joined1.you && s1b.last('arena:update').players.length === 2);
ok('tab lama diberi tahu sudah digantikan', s1.all('arena:replaced').length === 1);

// Lobi -> permainan dimulai
advance(arena.ARENA_LOBBY_SEC * 1000 + 1);
const started = s1b.last('arena:started');
const SECS = started.matchInfo.secPerQuestion;
ok('permainan dimulai otomatis setelah hitung mundur', Boolean(started) && started.questions.length === lobbyState.matchInfo.questions);
ok('soal yang dikirim TIDAK memuat kunci/penjelasan', started.questions.every((q: any) => !('correctIndex' in q) && !('explanation' in q)));
ok('email pembuat soal komunitas tidak bocor ke klien', !JSON.stringify(started).includes('pembuat@contoh.id') && started.questions.every((q: any) => !('ownerEmail' in q)));
ok('tiap soal diberi asal (resmi/komunitas) dan waktu sesuai tingkat', started.questions.every((q: any) => (q.origin === 'official' || q.origin === 'community') && q.timeLimitSec === SECS));
ok('tidak ada soal kembar dalam satu permainan', new Set(started.questions.map((q: any) => q.question)).size === started.questions.length);
ok('pemain lobi ikut bermain', started.participating === true);

// Penonton yang masuk saat permainan berjalan
guest.fire('arena:join', ident('Tamu'));
const gj = guest.last('arena:joined');
ok('pemain yang masuk saat berjalan menonton dulu', gj.state.players.find((p: any) => p.id === gj.you).participating === false);
ok('penonton tidak menerima kunci soal yang belum selesai', Object.keys(gj.sync.revealed).length === 0);
guest.fire('arena:answer', { optionIndex: 0 });
ok('penonton tidak bisa menjawab', guest.all('arena:answerResult').length === 0);

const correctIdxOf = (publicQ: any) => {
  const src = (BUILTIN_DECKS as any[]).flatMap((d) => d.questions).find((x: any) => x.question === publicQ.question);
  return publicQ.options.indexOf(src.options[src.correctIndex]);
};
const wrongIdxOf = (publicQ: any) => (correctIdxOf(publicQ) + 1) % publicQ.options.length;

let questions = started.questions as any[];
const total = questions.length;
for (let i = 0; i < total; i++) {
  const q = questions[i];
  s1b.fire('arena:answer', { optionIndex: correctIdxOf(q) });
  if (i === 0) {
    const r = s1b.last('arena:answerResult');
    ok('jawaban benar dinilai server & kunci baru dikirim setelah menjawab', r.isCorrect === true && r.correctIndex === correctIdxOf(q) && r.pointsAwarded > 0);
    s1b.fire('arena:answer', { optionIndex: wrongIdxOf(q) });
    ok('menjawab dua kali diabaikan', s1b.all('arena:answerResult').length === 1);
  }
  s2.fire('arena:answer', { optionIndex: wrongIdxOf(q) });
  advance(SECS * 1000 + 1); // waktu soal habis -> jeda
  ok(`soal ${i + 1}: jeda menampilkan jawaban benar`, s1b.last('arena:roundEnded')?.currentQIndex === i);
  advance(arena.ARENA_GAP_SEC * 1000 + 1); // jeda habis -> soal berikut / podium
}

const ended = s1b.last('arena:ended');
ok('permainan berakhir di podium', Boolean(ended) && ended.state.phase === 'podium');
const scores = Object.fromEntries(ended.state.players.map((p: any) => [p.name, p.score]));
ok('skor pemain yang benar semua > 0, yang salah semua = 0', scores['Ani'] > 0 && scores['Budi'] === 0);
ok('podium membuka seluruh kunci jawaban', Object.keys(ended.revealed).length === total);

await flush();
ok('skor dicatat SEKALI oleh server', finished.length === 1);
const g = finished[0];
ok('catatan memuat id campuran per tingkat (bukan deck bawaan)', g.deckId === 'arena-mix-easy' && g.difficulty === 'easy' && !BUILTIN_DECKS.some((d: any) => d.id === g.deckId));
ok('pembuat soal komunitas yang ikut dilaporkan ke pencatat skor', JSON.stringify(g.ownerEmails) === JSON.stringify(g.questions.some((q: any) => q.origin === 'community') ? ['pembuat@contoh.id'] : []));
ok('hanya akun login peserta yang dicatat (tamu penonton tidak)', g.players.length === 2 && g.players.every((p: any) => p.userId.startsWith('user-')));
ok('jawaban benar dihitung server', g.players.find((p: any) => p.userId === 'user-1').correct === total && g.players.find((p: any) => p.userId === 'user-2').correct === 0);
ok('hasil peringkat dikirim ke pemain di podium', s1b.last('arena:leaderboard')?.points === total * 10);

// Podium -> lobi -> permainan berikutnya otomatis
advance(arena.ARENA_PODIUM_SEC * 1000 + 1);
await flush();
ok('setelah podium kembali ke lobi dengan kuis baru', s1b.last('arena:update').phase === 'lobby');
ok('penonton kini ikut permainan berikutnya', s1b.last('arena:update').players.length === 3);
advance(arena.ARENA_LOBBY_SEC * 1000 + 1);
ok('permainan berikutnya berjalan otomatis', s1b.last('arena:started') !== started && guest.last('arena:started')?.participating === true);
const SECS2 = s1b.last('arena:started').matchInfo.secPerQuestion;

// Keluar di tengah permainan = tidak dicatat
questions = s1b.last('arena:started').questions;
s2.fire('arena:leave');
ok('keluar mengirim arena:left', s2.all('arena:left').length === 1);
for (let i = 0; i < questions.length; i++) {
  s1b.fire('arena:answer', { optionIndex: correctIdxOf(questions[i]) });
  advance(SECS2 * 1000 + 1);
  advance(arena.ARENA_GAP_SEC * 1000 + 1);
}
await flush();
ok('permainan kedua dicatat tanpa pemain yang sudah keluar', finished.length === 2 && finished[1].players.every((p: any) => p.userId !== 'user-2'));

// Reaksi emoji: daftar putih
const before = s1b.all('arena:reactionReceived').length;
s1b.fire('arena:reaction', { emoji: '🔥' });
s1b.fire('arena:reaction', { emoji: '<script>' });
ok('emoji terdaftar diteruskan, lainnya ditolak', s1b.all('arena:reactionReceived').length === before + 1);

// Nama tampilan kasar diganti \"Pemain\"; nama biasa dipertahankan
ok('nama biasa dipertahankan', arena.safeDisplayName('Budi Santoso') === 'Budi Santoso');
for (const bad of ['anjing banget', 'n4zi', 'nazi', 'k0nt0l', 'a.n.j.i.n.g', 'bab1', 'kontol123']) {
  ok(`nama kasar "${bad}" diganti Pemain`, arena.safeDisplayName(bad) === 'Pemain');
}
for (const fine of ['Nazirah', 'Taira', 'Dewi Cantik', 'Scunthorpe', 'Cukup Sabar', 'Dickson']) {
  ok(`nama wajar "${fine}" tidak terblokir`, arena.safeDisplayName(fine) === fine);
}
ok('nama kosong menjadi Pemain', arena.safeDisplayName('   ') === 'Pemain');
ok('nama berisi tag HTML dibersihkan', !/[<>]/.test(arena.safeDisplayName('<b>Andi</b>')));

// Identitas tidak valid
const bogus = io.connect();
bogus.fire('arena:join', { clientId: 'x', name: 'Z' });
ok('clientId tidak valid ditolak', Boolean(bogus.last('arena:error')));

// Semua peserta menjawab -> sisa waktu dipangkas jadi 3 detik
const fast = io.connect('user-9');
fast.fire('arena:join', ident('Cepat'));
ok('summary arena tersedia untuk kartu Pusat Kuis', arena.getArenaSummary().playersOnline >= 1);

if (bad) process.exitCode = 1;
else console.log('\nSemua tes Arena Global lulus.');
