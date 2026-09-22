// server/multiplayerSocket.ts
//
// Multiplayer kuis REAL-TIME lewat WebSocket (socket.io, gratis, menumpang di
// server Express yang sama).
//
// v2 — perubahan dari versi pertama:
//  - Setiap ronde SELALU berdurasi tetap (roundTimeSec). Sebelumnya ronde
//    dipercepat begitu semua pemain sudah menjawab; ini dihapus supaya semua
//    pemain punya waktu berpikir yang sama & adil, tidak dikejar-kejar pemain
//    yang menjawab duluan.
//  - Skor sekarang berbasis KAPAN pemain menjawab (dari total durasi ronde),
//    dibagi 5 segmen: 0-40% waktu = 100% poin, 40-60% = 80%, 60-80% = 60%,
//    80-100% = 40%, telat/tidak jawab = 0.
//  - Pemain membawa avatarUrl & frameId (dari profil PlayMuzeck-nya) saat
//    membuat/join room, supaya semua pemain lain bisa melihat foto & bingkai
//    profil asli, bukan avatar warna generik.
//  - Reaction emoji: pemain bisa kirim emoji singkat yang di-broadcast ke
//    semua orang di room (dipakai di layar hasil akhir/podium).

import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

interface Player {
  socketId: string;
  name: string;
  avatarUrl?: string;
  frameId?: string;
  isHost: boolean;
  isReady: boolean;
  score: number;
  streak: number;
  lastAnswerStatus?: 'correct' | 'wrong';
  lastPointsAwarded?: number;
  hasAnsweredThisRound: boolean;
}

interface Room {
  code: string;
  deckId: string;
  deckTitle: string;
  questions: any[];
  roundTimeSec: number;
  players: Map<string, Player>;
  status: 'lobby' | 'in-game' | 'podium';
  currentQIndex: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  hostSocketId: string;
  /** 0.1 - 0.9: porsi waktu pertama yang masih dapat poin penuh. Diatur host. */
  fullPointRatio: number;
  /** Poin minimal kalau menjawab benar mepet waktu habis. Diatur host, minimal 1. */
  minPoints: number;
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
    fullPointRatio: room.fullPointRatio,
    minPoints: room.minPoints,
    status: room.status,
    currentQIndex: room.currentQIndex,
    roundEndsAt: room.roundEndsAt,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.socketId,
      name: p.name,
      avatarUrl: p.avatarUrl || '',
      frameId: p.frameId || 'none',
      isHost: p.isHost,
      isReady: p.isReady,
      score: p.score,
      streak: p.streak,
      lastAnswerStatus: p.lastAnswerStatus,
      lastPointsAwarded: p.lastPointsAwarded,
    })),
  };
}

function broadcastRoom(io: Server, room: Room) {
  io.to(room.code).emit('room:update', publicRoomState(room));
}

function clearRoomIfEmpty(room: Room) {
  if (room.players.size === 0) rooms.delete(room.code);
}

/**
 * Skor berbasis waktu jawab, DINAMIS sesuai pengaturan host:
 *  - 0% sampai `fullPointRatio` dari total waktu  -> poin penuh (BASE_POINTS)
 *  - `fullPointRatio` sampai 100% waktu           -> turun LINEAR dari
 *    BASE_POINTS menuju `minPoints` (bukan step kaku, jadi mulus mengikuti
 *    berapa pun persen & poin minimal yang dipilih host)
 *  - waktu habis / tidak menjawab                 -> 0
 */
const BASE_POINTS = 100;
function pointsForElapsedRatio(elapsedRatio: number, fullPointRatio: number, minPoints: number): number {
  if (elapsedRatio >= 1) return 0;
  if (elapsedRatio <= fullPointRatio) return BASE_POINTS;
  const decayProgress = (elapsedRatio - fullPointRatio) / (1 - fullPointRatio); // 0..1
  const pts = BASE_POINTS - decayProgress * (BASE_POINTS - minPoints);
  return Math.max(minPoints, Math.round(pts));
}

export function attachMultiplayerSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
  });

  io.on('connection', (socket: Socket) => {
    let joinedRoomCode: string | null = null;

    socket.on(
      'room:create',
      (payload: {
        name: string;
        avatarUrl?: string;
        frameId?: string;
        deckId: string;
        deckTitle: string;
        roundTimeSec: number;
        fullPointRatio?: number;
        minPoints?: number;
      }) => {
        const code = genRoomCode();
        // Validasi & batasi input host: rasio 10%-90%, poin minimal >= 1 (dan
        // secara desain UI klien sudah memaksa minimal 2 supaya tetap "terasa
        // beda dari 0"), tidak boleh melebihi BASE_POINTS.
        const fullPointRatio = Math.min(0.9, Math.max(0.1, Number(payload.fullPointRatio) || 0.4));
        const minPoints = Math.min(BASE_POINTS - 1, Math.max(1, Math.round(Number(payload.minPoints) || 10)));
        const room: Room = {
          code,
          deckId: payload.deckId,
          deckTitle: payload.deckTitle,
          questions: [],
          roundTimeSec: payload.roundTimeSec || 20,
          players: new Map(),
          status: 'lobby',
          currentQIndex: 0,
          roundStartedAt: null,
          roundEndsAt: null,
          hostSocketId: socket.id,
          fullPointRatio,
          minPoints,
        };
        room.players.set(socket.id, {
          socketId: socket.id,
          name: payload.name || 'Host',
          avatarUrl: payload.avatarUrl,
          frameId: payload.frameId,
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
      }
    );

    socket.on('room:join', (payload: { code: string; name: string; avatarUrl?: string; frameId?: string }) => {
      const room = rooms.get(String(payload.code || '').toUpperCase());
      if (!room) return socket.emit('room:error', 'Kode ruangan tidak ditemukan.');
      if (room.status !== 'lobby') return socket.emit('room:error', 'Pertandingan sudah dimulai, tidak bisa join.');

      room.players.set(socket.id, {
        socketId: socket.id,
        name: payload.name || 'Pemain',
        avatarUrl: payload.avatarUrl,
        frameId: payload.frameId,
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

    socket.on('room:start', (payload: { questions: any[] }) => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room || room.hostSocketId !== socket.id) return;

      room.questions = Array.isArray(payload.questions) ? payload.questions : [];
      room.status = 'in-game';
      room.currentQIndex = 0;
      room.roundStartedAt = Date.now();
      room.roundEndsAt = Date.now() + room.roundTimeSec * 1000;
      for (const p of room.players.values()) {
        p.score = 0;
        p.streak = 0;
        p.hasAnsweredThisRound = false;
        p.lastAnswerStatus = undefined;
        p.lastPointsAwarded = undefined;
      }
      io.to(room.code).emit('game:started', {
        questions: room.questions,
        roundEndsAt: room.roundEndsAt,
        currentQIndex: 0,
      });
      broadcastRoom(io, room);
    });

    // Jawaban dicatat, TAPI ronde tidak dipercepat — semua pemain tetap
    // punya waktu penuh sampai roundEndsAt (adil, tidak dikejar pemain lain).
    socket.on('game:answer', (payload: { optionIndex: number }) => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room || room.status !== 'in-game' || !room.roundStartedAt || !room.roundEndsAt) return;
      const p = room.players.get(socket.id);
      if (!p || p.hasAnsweredThisRound) return;

      const q = room.questions[room.currentQIndex];
      const isCorrect = q && payload.optionIndex === q.correctIndex;
      p.hasAnsweredThisRound = true;

      if (isCorrect) {
        const totalMs = room.roundEndsAt - room.roundStartedAt;
        const elapsedMs = Date.now() - room.roundStartedAt;
        const elapsedRatio = totalMs > 0 ? elapsedMs / totalMs : 1;
        const pts = pointsForElapsedRatio(elapsedRatio, room.fullPointRatio, room.minPoints);
        p.score += pts;
        p.streak += 1;
        p.lastAnswerStatus = 'correct';
        p.lastPointsAwarded = pts;
      } else {
        p.streak = 0;
        p.lastAnswerStatus = 'wrong';
        p.lastPointsAwarded = 0;
      }
      // Kirim balik ke pengirim saja: dipakai untuk menampilkan penjelasan
      // soal SEKARANG JUGA, tanpa perlu menunggu ronde berakhir.
      socket.emit('game:answerResult', {
        isCorrect,
        pointsAwarded: p.lastPointsAwarded,
        correctIndex: q?.correctIndex,
        explanation: q?.explanation || '',
      });
      broadcastRoom(io, room);
    });

    socket.on('room:reaction', (payload: { emoji: string }) => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room) return;
      const p = room.players.get(socket.id);
      if (!p) return;
      const emoji = String(payload.emoji || '').slice(0, 8);
      if (!emoji) return;
      io.to(room.code).emit('room:reactionReceived', { playerId: socket.id, playerName: p.name, emoji });
    });

    socket.on('disconnect', () => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room) return;
      room.players.delete(socket.id);
      if (room.hostSocketId === socket.id && room.players.size > 0) {
        const next = room.players.values().next().value as Player;
        next.isHost = true;
        room.hostSocketId = next.socketId;
      }
      broadcastRoom(io, room);
      clearRoomIfEmpty(room);
    });
  });

  // Satu-satunya pemicu perpindahan ronde: waktu habis (roundEndsAt lewat).
  // Tidak ada lagi percepatan karena "semua sudah jawab".
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status === 'in-game' && room.roundEndsAt && now >= room.roundEndsAt) {
        advanceRound(io, room);
      }
    }
  }, 500);

  function advanceRound(ioRef: Server, room: Room) {
    const isLastQuestion = room.currentQIndex >= room.questions.length - 1;
    if (isLastQuestion) {
      room.status = 'podium';
      room.roundStartedAt = null;
      room.roundEndsAt = null;
      ioRef.to(room.code).emit('game:ended', publicRoomState(room));
      return;
    }
    room.currentQIndex += 1;
    room.roundStartedAt = Date.now();
    room.roundEndsAt = Date.now() + room.roundTimeSec * 1000;
    for (const p of room.players.values()) {
      p.hasAnsweredThisRound = false;
      p.lastAnswerStatus = undefined;
      p.lastPointsAwarded = undefined;
    }
    ioRef.to(room.code).emit('game:nextRound', {
      currentQIndex: room.currentQIndex,
      roundEndsAt: room.roundEndsAt,
    });
    broadcastRoom(ioRef, room);
  }

  return io;
}
