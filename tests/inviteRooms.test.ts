// Jalankan: npx tsx tests/inviteRooms.test.ts
// Mode Undangan (ruangan berkode) harus tetap multiplayer, tetapi TIDAK PERNAH masuk papan peringkat,
// dan tidak mengganggu Arena Global yang dipasang pada server socket.io yang sama.
let failed = 0;
const ok = (name: string, cond: boolean) => {
  console.log(`${cond ? 'ok  ' : 'GAGAL'} ${name}`);
  if (!cond) failed++;
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

class FakeSocket {
  static seq = 0;
  id = `i${++FakeSocket.seq}`;
  data: Record<string, any> = {};
  rooms = new Set<string>();
  handlers = new Map<string, (p?: any) => void>();
  log: Array<[string, any]> = [];
  on(ev: string, fn: (p?: any) => void) { this.handlers.set(ev, fn); }
  emit(ev: string, payload?: any) { this.log.push([ev, payload]); }
  join(r: string) { this.rooms.add(r); }
  leave(r: string) { this.rooms.delete(r); }
  fire(ev: string, payload?: any) { this.handlers.get(ev)?.(payload); }
  last(ev: string) { return [...this.log].reverse().find((l) => l[0] === ev)?.[1]; }
  has(ev: string) { return this.log.some((l) => l[0] === ev); }
}
class FakeIo {
  sockets = { sockets: new Map<string, FakeSocket>() };
  conns: Array<(s: FakeSocket) => void> = [];
  on(ev: string, fn: (s: FakeSocket) => void) { if (ev === 'connection') this.conns.push(fn); }
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
    for (const c of this.conns) c(s);
    return s;
  }
}

const { attachGlobalArena } = await import('../server/globalArena.ts');
const { attachInviteRooms } = await import('../server/inviteRooms.ts');

let arenaFinished = 0;
const io = new FakeIo();
attachGlobalArena(io as any, { onFinished: async () => { arenaFinished++; } });
attachInviteRooms(io as any);

const host = io.connect('user-host');
const guest = io.connect('user-guest');
host.fire('room:create', { clientId: 'host-client-01', name: 'Host', deckId: 'deck-builtin-alam', deckTitle: 'Alam', roundTimeSec: 1, roundGapSec: 3, visibility: 'global', password: 'x' });
const created = host.last('room:created');
ok('host berhasil membuat ruangan berkode', Boolean(created?.state?.code));
ok('visibilitas dipaksa "invite" walau klien minta global', created?.state?.visibility === 'invite');
ok('daftar ruangan global tidak ada lagi', (() => { host.fire('room:listGlobal'); return !host.has('room:globalList'); })());

guest.fire('room:join', { clientId: 'guest-client-02', code: created.state.code, name: 'Tamu' });
ok('pemain lain bisa gabung lewat kode', Boolean(guest.last('room:joined')?.you));

const questions = [0, 1].map((i) => ({ question: `Soal ${i}?`, options: ['A', 'B', 'C', 'D'], correctIndex: 1 }));
host.fire('room:start', { questions });
ok('permainan undangan dimulai', host.has('game:started') && guest.has('game:started'));

guest.fire('game:answer', { optionIndex: 1 });
host.fire('game:answer', { optionIndex: 1 });
await sleep(1500);
for (let i = 0; i < 40 && !guest.has('game:ended'); i++) {
  guest.fire('game:answer', { optionIndex: 1 });
  host.fire('game:answer', { optionIndex: 1 });
  await sleep(500);
}
ok('permainan undangan tuntas sampai podium', host.has('game:ended') || host.last('room:update')?.status === 'podium' || guest.has('game:ended'));
ok('TIDAK ada pencatatan ke papan peringkat (onFinished Arena tidak terpanggil)', arenaFinished === 0);
ok('TIDAK ada event game:leaderboard ke pemain', !host.has('game:leaderboard') && !guest.has('game:leaderboard'));

// --- Kapasitas: 100 pemain di luar host (total 101) ---
{
  const capHost = io.connect('cap-host');
  capHost.fire('room:create', { clientId: 'cap-host-client', name: 'HostKap', deckId: 'd', deckTitle: 'Kap', roundTimeSec: 10 });
  const capCode = capHost.last('room:created').state.code;
  let joined = 0;
  for (let i = 1; i <= 100; i++) {
    const s = io.connect();
    s.fire('room:join', { clientId: `cap-guest-${String(i).padStart(4, '0')}`, code: capCode, name: `P${i}` });
    if (s.last('room:joined')?.you) joined++;
  }
  ok('100 pemain di luar host semuanya bisa bergabung', joined === 100);
  ok('total 101 orang (100 pemain + host)', capHost.last('room:update')?.players?.length === 101);
  const extra = io.connect();
  extra.fire('room:join', { clientId: 'cap-guest-0101', code: capCode, name: 'P101' });
  ok('pemain ke-101 (di luar host) ditolak', !extra.last('room:joined') && String(extra.last('room:error') || '').includes('penuh'));
  ok('jumlah pemain tetap 101 setelah penolakan', capHost.last('room:update')?.players?.length === 101);
}

const a = io.connect();
a.fire('arena:join', { clientId: 'arena-client-9', name: 'Budi' });
ok('Arena Global tetap jalan di server yang sama', Boolean(a.last('arena:joined')?.you));

console.log(failed ? `\n${failed} tes gagal.` : '\nSemua tes Mode Undangan lulus.');
process.exit(failed ? 1 : 0);
