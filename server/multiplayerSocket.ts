// server/multiplayerSocket.ts
//
// Multiplayer kuis REAL-TIME lewat WebSocket (socket.io, gratis & open-source,
// jalan menumpang di server Express yang sama — tidak ada server/biaya baru).
//
// Menggantikan simulasi bot lokal di MultiplayerArenaModal.tsx (yang sebelumnya
// generate "pemain lain" pakai Math.random() di browser masing-masing, sehingga
// tidak sinkron antar device). Sekarang SATU sumber kebenaran (room state) ada
// di server ini, dan semua pemain di room yang sama menerima update yang identik.

import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

interface Player {
  socketId: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  score: number;
  streak: number;
  lastAnswerStatus?: 'correct' | 'wrong';
  hasAnsweredThisRound: boolean;
}

interface Room {
  code: string;
  deckId: string;
  deckTitle: string;
  questions: any[]; // snapshot soal dikirim sekali saat game dimulai (host yang kirim)
  roundTimeSec: number;
  players: Map<string, Player>; // key = socketId
  status: 'lobby' | 'in-game' | 'podium';
  currentQIndex: number;
  roundEndsAt: number | null; // epoch ms, dipakai SEMUA klien supaya timer sinkron
  hostSocketId: string;
}

const rooms = new Map<string, Room>();

function genRoomCode(): string {
  let code: string;
  do {
    code = 'MZK-' + Math.floor(100 + Math.random() * 900);
  } while (rooms.has(code));
  return code;
}

function publicRoomState(room: Room) {
  return {
    code: room.code,
    deckId: room.deckId,
    deckTitle: room.deckTitle,
    roundTimeSec: room.roundTimeSec,
    status: room.status,
    currentQIndex: room.currentQIndex,
    roundEndsAt: room.roundEndsAt,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.socketId,
      name: p.name,
      isHost: p.isHost,
      isReady: p.isReady,
      score: p.score,
      streak: p.streak,
      lastAnswerStatus: p.lastAnswerStatus,
    })),
  };
}

function broadcastRoom(io: Server, room: Room) {
  io.to(room.code).emit('room:update', publicRoomState(room));
}

function clearRoomIfEmpty(room: Room) {
  if (room.players.size === 0) rooms.delete(room.code);
}

export function attachMultiplayerSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' }, // sama seperti app.use(cors()) yang sudah dipakai di index.ts
    path: '/socket.io',
  });

  io.on('connection', (socket: Socket) => {
    let joinedRoomCode: string | null = null;

    socket.on('room:create', (payload: { name: string; deckId: string; deckTitle: string; roundTimeSec: number }) => {
      const code = genRoomCode();
      const room: Room = {
        code,
        deckId: payload.deckId,
        deckTitle: payload.deckTitle,
        questions: [],
        roundTimeSec: payload.roundTimeSec || 20,
        players: new Map(),
        status: 'lobby',
        currentQIndex: 0,
        roundEndsAt: null,
        hostSocketId: socket.id,
      };
      room.players.set(socket.id, {
        socketId: socket.id,
        name: payload.name || 'Host',
        isHost: true,
        isReady: true,
        score: 0,
        streak: 0,
        hasAnsweredThisRound: false,
      });
      rooms.set(code, room);
      socket.join(code);
      joinedRoomCode = code;
      socket.emit('room:created', publicRoomState(room));
    });

    socket.on('room:join', (payload: { code: string; name: string }) => {
      const room = rooms.get(String(payload.code || '').toUpperCase());
      if (!room) return socket.emit('room:error', 'Kode ruangan tidak ditemukan.');
      if (room.status !== 'lobby') return socket.emit('room:error', 'Pertandingan sudah dimulai, tidak bisa join.');

      room.players.set(socket.id, {
        socketId: socket.id,
        name: payload.name || 'Pemain',
        isHost: false,
        isReady: false,
        score: 0,
        streak: 0,
        hasAnsweredThisRound: false,
      });
      socket.join(room.code);
      joinedRoomCode = room.code;
      socket.emit('room:joined', publicRoomState(room));
      broadcastRoom(io, room);
    });

    socket.on('room:toggleReady', () => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room) return;
      const p = room.players.get(socket.id);
      if (!p) return;
      p.isReady = !p.isReady;
      broadcastRoom(io, room);
    });

    // Hanya host yang boleh mulai; server yang menegakkan aturan ini (bukan cuma UI klien).
    socket.on('room:start', (payload: { questions: any[] }) => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room || room.hostSocketId !== socket.id) return;

      room.questions = Array.isArray(payload.questions) ? payload.questions : [];
      room.status = 'in-game';
      room.currentQIndex = 0;
      room.roundEndsAt = Date.now() + room.roundTimeSec * 1000;
      for (const p of room.players.values()) {
        p.score = 0;
        p.streak = 0;
        p.hasAnsweredThisRound = false;
        p.lastAnswerStatus = undefined;
      }
      io.to(room.code).emit('game:started', {
        questions: room.questions,
        roundEndsAt: room.roundEndsAt,
        currentQIndex: 0,
      });
      broadcastRoom(io, room);
    });

    socket.on('game:answer', (payload: { optionIndex: number }) => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room || room.status !== 'in-game') return;
      const p = room.players.get(socket.id);
      if (!p || p.hasAnsweredThisRound) return;

      const q = room.questions[room.currentQIndex];
      const isCorrect = q && payload.optionIndex === q.correctIndex;
      p.hasAnsweredThisRound = true;
      if (isCorrect) {
        const speedBonus = Math.max(0, Math.round(((room.roundEndsAt! - Date.now()) / (room.roundTimeSec * 1000)) * 100));
        p.score += 100 + speedBonus;
        p.streak += 1;
        p.lastAnswerStatus = 'correct';
      } else {
        p.streak = 0;
        p.lastAnswerStatus = 'wrong';
      }
      broadcastRoom(io, room);

      // Kalau semua pemain sudah jawab, langsung lanjut ke soal berikutnya tanpa nunggu timer habis.
      const allAnswered = Array.from(room.players.values()).every((pl) => pl.hasAnsweredThisRound);
      if (allAnswered) advanceRound(io, room);
    });

    socket.on('disconnect', () => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room) return;
      room.players.delete(socket.id);
      if (room.hostSocketId === socket.id && room.players.size > 0) {
        // Host keluar: limpahkan status host ke pemain berikutnya supaya room tidak macet.
        const next = room.players.values().next().value as Player;
        next.isHost = true;
        room.hostSocketId = next.socketId;
      }
      broadcastRoom(io, room);
      clearRoomIfEmpty(room);
    });
  });

  // Timer server-side: cek tiap detik, kalau roundEndsAt lewat, paksa lanjut ronde
  // (menangani pemain yang tidak menjawab sama sekali sebelum waktu habis).
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status === 'in-game' && room.roundEndsAt && now >= room.roundEndsAt) {
        advanceRound(io, room);
      }
    }
  }, 1000);

  function advanceRound(ioRef: Server, room: Room) {
    const isLastQuestion = room.currentQIndex >= room.questions.length - 1;
    if (isLastQuestion) {
      room.status = 'podium';
      room.roundEndsAt = null;
      ioRef.to(room.code).emit('game:ended', publicRoomState(room));
      return;
    }
    room.currentQIndex += 1;
    room.roundEndsAt = Date.now() + room.roundTimeSec * 1000;
    for (const p of room.players.values()) {
      p.hasAnsweredThisRound = false;
      p.lastAnswerStatus = undefined;
    }
    ioRef.to(room.code).emit('game:nextRound', {
      currentQIndex: room.currentQIndex,
      roundEndsAt: room.roundEndsAt,
    });
    broadcastRoom(ioRef, room);
  }

  return io;
}
