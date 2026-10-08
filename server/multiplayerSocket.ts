// server/multiplayerSocket.ts
//
// Pintu masuk multiplayer REAL-TIME (socket.io) Pusat Kuis. Ada DUA mode, satu server socket.io:
//
//   1. ARENA GLOBAL (server/globalArena.ts) — ruang publik tanpa kode/host. Server memilih kuisnya dan menilai
//      jawaban, jadi HANYA mode ini yang dicatat ke Papan Peringkat (onFinished -> recordMultiplayerGame).
//   2. MODE UNDANGAN (server/inviteRooms.ts) — ruangan berkode buatan host untuk teman/kelas. Tetap multiplayer,
//      tetapi TIDAK PERNAH masuk Papan Peringkat (kuisnya dikirim host, skornya tidak bisa dipercaya).
//
// File ini hanya:
//   - membuat server socket.io di atas server HTTP yang sama dengan Express,
//   - mengenali akun login pemain dari cookie sesi (tamu tetap boleh main; skornya tidak masuk peringkat),
//   - memasang kedua mode. Kaitan arenaDeps (pickCommunityDeck, onFinished) HANYA diberikan ke Arena Global.
import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { attachGlobalArena, getArenaSummary, type ArenaDeps } from './globalArena';
import { attachInviteRooms } from './inviteRooms';

export type { ArenaDeck, ArenaDeps, ArenaFinishedGame, ArenaOutcome } from './globalArena';

/** Mengubah cookie sesi pada handshake socket menjadi ID akun (null = tamu / sesi tidak valid). */
export type ResolveUserId = (cookieHeader: string | undefined, handshake: any) => Promise<string | null>;

export function attachMultiplayerSocket(httpServer: HttpServer, resolveUserId?: ResolveUserId, arenaDeps: ArenaDeps = {}) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
  });

  // Kenali akun login pemain (kalau ada). Tidak pernah menolak koneksi: gagal = dianggap tamu.
  io.use((socket, next) => {
    if (!resolveUserId) return next();
    resolveUserId(socket.handshake.headers.cookie, socket.handshake)
      .then((id) => {
        if (id) socket.data.userId = id;
      })
      .catch(() => {})
      .finally(() => next());
  });

  attachGlobalArena(io, arenaDeps);
  attachInviteRooms(io);

  return { io, getArenaSummary };
}
