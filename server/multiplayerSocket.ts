// server/multiplayerSocket.ts
//
// Multiplayer kuis REAL-TIME lewat WebSocket (socket.io, gratis, menumpang di
// server Express yang sama).
//
// v4 — perubahan dari v3:
//  - SATU skema skor berbasis waktu. Poin penuh soal (`points` dari Quiz Editor,
//    fallback 100) turun LINEAR dari 100% (jawab seketika) ke `minPointsPercent`
//    (jawab di detik terakhir). Karena rumusnya linear dari 100% ke X%, poin hasil
//    penurunan tidak mungkin di bawah poin minimal, dan poin minimal tidak mungkin
//    di atas poin penuh. Host juga bisa mematikan penurunan (`timeDecay: false`)
//    sehingga jawaban benar selalu dapat poin penuh.
//  - SISTEM MINUS mengikuti Quiz Editor: `wrongPenaltyPercent` (0-100, dari
//    pengaturan deck) mengurangi poin bila jawaban SALAH. Tidak menjawab = 0.
//  - WAKTU PER SOAL: `questionTimes` (satu angka per soal) dikirim host saat start,
//    mengikuti aturan questionTime.ts (deck Editor = waktu dari pembuat kuis).
//    Kalau tidak ada, dipakai `roundTimeSec` room.
//  - JEDA ANTAR SOAL dibatasi 3 detik - 1 menit (divalidasi di server).
//  - Validasi payload `room:start` (jumlah soal, bentuk soal) dan hanya boleh dari
//    status 'lobby' atau 'podium' (Main Lagi).

import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';

export const MIN_GAP_SEC = 3;
export const MAX_GAP_SEC = 60;
const MIN_ROUND_SEC = 1;
const MAX_ROUND_SEC = 180;
const MAX_QUESTIONS = 100;
const DEFAULT_BASE_POINTS = 100;

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
  /** Waktu jawab bawaan (detik); dipakai bila soal tidak punya waktu sendiri. */
  roundTimeSec: number;
  /** Waktu jawab per soal (detik), sejajar dengan `questions`. */
  questionTimes: number[];
  /** Jeda (detik) menampilkan hasil ronde sebelum pindah ke soal berikutnya (3 - 60). */
  roundGapSec: number;
  players: Map<string, Player>;
  status: 'lobby' | 'in-game' | 'round-result' | 'podium';
  currentQIndex: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  /** Terisi hanya saat status 'round-result'. */
  roundResultEndsAt: number | null;
  hostSocketId: string;
  /**
   * 'invite' -> hanya lewat kode ruangan. 'global' -> tampil di daftar "Room Global";
   * password opsional hanya untuk 'global'.
   */
  visibility: 'invite' | 'global';
  password?: string;
  /** true: poin turun linear mengikuti waktu. false: jawaban benar selalu poin penuh. */
  timeDecay: boolean;
  /** 0 - 0.9: poin terendah (persen dari poin soal) saat menjawab di detik terakhir. */
  minPointsPercent: number;
  /** 0 - 100: persen poin soal yang dikurangi bila jawaban salah (sistem minus). 0 = nonaktif. */
  wrongPenaltyPercent: number;
}

const rooms = new Map<string, Room>();

function genRoomCode(): string {
  let code: string;
  do {
    code = 'MZK-' + Math.floor(100 + Math.random() * 900);
  } while (rooms.has(code));
  return code;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Poin dasar (poin penuh) soal ke-`idx`, dari Quiz Editor. Fallback 100 untuk deck tanpa field points. */
function basePointsForQuestion(room: Room, idx: number): number {
  const p = Number(room.questions[idx]?.points);
  return Number.isFinite(p) && p > 0 ? p : DEFAULT_BASE_POINTS;
}

/** Durasi jawab (detik) soal ke-`idx`. */
function roundSecForQuestion(room: Room, idx: number): number {
  const t = Number(room.questionTimes[idx]);
  return Number.isFinite(t) && t >= MIN_ROUND_SEC ? clamp(Math.round(t), MIN_ROUND_SEC, MAX_ROUND_SEC) : room.roundTimeSec;
}

/**
 * Poin jawaban BENAR.
 *  - timeDecay aktif : base * (1 - (1 - minPercent) * elapsedRatio)  -> 100% .. minPercent
 *  - timeDecay mati  : base
 * Hasil selalu berada di antara round(base * minPercent) dan base.
 */
function pointsForCorrect(room: Room, basePoints: number, elapsedRatio: number): number {
  if (!room.timeDecay) return basePoints;
  const ratio = clamp(elapsedRatio, 0, 1);
  const floorPts = Math.round(basePoints * room.minPointsPercent);
  const pts = Math.round(basePoints * (1 - (1 - room.minPointsPercent) * ratio));
  return clamp(pts, floorPts, basePoints);
}

/** Pengurangan jawaban SALAH (angka negatif, atau 0 bila sistem minus nonaktif). */
function penaltyForWrong(room: Room, basePoints: number): number {
  if (room.wrongPenaltyPercent <= 0) return 0;
  return -Math.round(basePoints * (room.wrongPenaltyPercent / 100));
}

function publicRoomState(room: Room) {
  return {
    code: room.code,
    deckId: room.deckId,
    deckTitle: room.deckTitle,
    roundTimeSec: room.roundTimeSec,
    roundGapSec: room.roundGapSec,
    timeDecay: room.timeDecay,
    minPointsPercent: room.minPointsPercent,
    wrongPenaltyPercent: room.wrongPenaltyPercent,
    visibility: room.visibility,
    // Jangan pernah kirim password asli; cukup flag apakah perlu input password.
    hasPassword: Boolean(room.password),
    status: room.status,
    currentQIndex: room.currentQIndex,
    roundEndsAt: room.roundEndsAt,
    roundResultEndsAt: room.roundResultEndsAt,
    currentQuestionBasePoints:
      room.status === 'in-game' || room.status === 'round-result'
        ? basePointsForQuestion(room, room.currentQIndex)
        : null,
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

/** Pastikan tiap soal punya bentuk minimal yang valid sebelum dipakai game. */
function sanitizeQuestions(raw: unknown): any[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_QUESTIONS)
    .filter(
      (q: any) =>
        q &&
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length >= 2 &&
        Number.isInteger(q.correctIndex) &&
        q.correctIndex >= 0 &&
        q.correctIndex < q.options.length
    );
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
        roundGapSec?: number;
        timeDecay?: boolean;
        minPointsPercent?: number;
        visibility?: 'invite' | 'global';
        password?: string;
      }) => {
        const code = genRoomCode();
        // Validasi input host:
        //  - roundGapSec: 3 - 60 detik.
        //  - minPointsPercent: 0 - 0.9 dari poin soal.
        //  - timeDecay: default aktif.
        const roundGapSec = clamp(Math.round(Number(payload.roundGapSec) || 5), MIN_GAP_SEC, MAX_GAP_SEC);
        const minRaw = Number(payload.minPointsPercent);
        const minPointsPercent = clamp(Number.isFinite(minRaw) ? minRaw : 0.3, 0, 0.9);
        const timeDecay = payload.timeDecay !== false;
        const visibility: 'invite' | 'global' = payload.visibility === 'global' ? 'global' : 'invite';
        const password =
          visibility === 'global' && payload.password ? String(payload.password).trim().slice(0, 32) : undefined;
        const room: Room = {
          code,
          deckId: String(payload.deckId || ''),
          deckTitle: String(payload.deckTitle || 'Kuis').slice(0, 255),
          questions: [],
          roundTimeSec: clamp(Math.round(Number(payload.roundTimeSec) || 20), MIN_ROUND_SEC, MAX_ROUND_SEC),
          questionTimes: [],
          roundGapSec,
          players: new Map(),
          status: 'lobby',
          currentQIndex: 0,
          roundStartedAt: null,
          roundEndsAt: null,
          roundResultEndsAt: null,
          hostSocketId: socket.id,
          visibility,
          password: password || undefined,
          timeDecay,
          minPointsPercent,
          wrongPenaltyPercent: 0,
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

    socket.on(
      'room:join',
      (payload: { code: string; name: string; avatarUrl?: string; frameId?: string; password?: string }) => {
        const room = rooms.get(String(payload.code || '').toUpperCase());
        if (!room) return socket.emit('room:error', 'Kode ruangan tidak ditemukan.');
        if (room.status !== 'lobby') return socket.emit('room:error', 'Pertandingan sudah dimulai, tidak bisa join.');
        if (room.visibility === 'global' && room.password) {
          if (String(payload.password || '').trim() !== room.password) {
            return socket.emit('room:error', 'Password ruangan salah.');
          }
        }

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
      }
    );

    // Daftar room 'global' yang masih di lobby. Password asli tidak dikirim.
    socket.on('room:listGlobal', () => {
      const list = Array.from(rooms.values())
        .filter((r) => r.visibility === 'global' && r.status === 'lobby')
        .map((r) => ({
          code: r.code,
          deckTitle: r.deckTitle,
          playerCount: r.players.size,
          hasPassword: Boolean(r.password),
        }));
      socket.emit('room:globalList', list);
    });

    socket.on(
      'room:start',
      (payload: { questions: any[]; questionTimes?: number[]; wrongPenaltyPercent?: number }) => {
        if (!joinedRoomCode) return;
        const room = rooms.get(joinedRoomCode);
        if (!room || room.hostSocketId !== socket.id) return;
        // Boleh mulai dari lobby, atau "Main Lagi" dari podium. Tidak boleh di tengah permainan.
        if (room.status !== 'lobby' && room.status !== 'podium') return;

        const questions = sanitizeQuestions(payload?.questions);
        if (!questions.length) return socket.emit('room:error', 'Tidak ada soal valid untuk dimainkan.');

        room.questions = questions;
        // `questionTimes` sejajar dengan soal yang dikirim; angka tak valid jatuh ke roundTimeSec.
        const times = Array.isArray(payload?.questionTimes) ? payload.questionTimes : [];
        room.questionTimes = questions.map((_, i) => {
          const t = Number(times[i]);
          return Number.isFinite(t) && t >= MIN_ROUND_SEC ? clamp(Math.round(t), MIN_ROUND_SEC, MAX_ROUND_SEC) : room.roundTimeSec;
        });
        room.wrongPenaltyPercent = clamp(Number(payload?.wrongPenaltyPercent) || 0, 0, 100);

        room.status = 'in-game';
        room.currentQIndex = 0;
        room.roundStartedAt = Date.now();
        room.roundEndsAt = Date.now() + roundSecForQuestion(room, 0) * 1000;
        room.roundResultEndsAt = null;
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
      }
    );

    // Jawaban dicatat, ronde tidak dipercepat — semua pemain punya waktu penuh.
    socket.on('game:answer', (payload: { optionIndex: number }) => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room || room.status !== 'in-game' || !room.roundStartedAt || !room.roundEndsAt) return;
      if (Date.now() >= room.roundEndsAt) return; // lewat waktu = tidak dihitung
      const p = room.players.get(socket.id);
      if (!p || p.hasAnsweredThisRound) return;

      const q = room.questions[room.currentQIndex];
      const isCorrect = Boolean(q) && payload.optionIndex === q.correctIndex;
      p.hasAnsweredThisRound = true;
      const basePoints = basePointsForQuestion(room, room.currentQIndex);

      if (isCorrect) {
        const totalMs = room.roundEndsAt - room.roundStartedAt;
        const elapsedRatio = totalMs > 0 ? (Date.now() - room.roundStartedAt) / totalMs : 1;
        const pts = pointsForCorrect(room, basePoints, elapsedRatio);
        p.score += pts;
        p.streak += 1;
        p.lastAnswerStatus = 'correct';
        p.lastPointsAwarded = pts;
      } else {
        const penalty = penaltyForWrong(room, basePoints); // 0 atau negatif
        p.score += penalty;
        p.streak = 0;
        p.lastAnswerStatus = 'wrong';
        p.lastPointsAwarded = penalty;
      }
      // Kirim balik ke pengirim saja (penjelasan langsung muncul).
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

  // Loop utama:
  //  1) 'in-game' & waktu jawab habis  -> masuk 'round-result' (jeda).
  //  2) 'round-result' & jeda selesai  -> pindah ronde / selesai game.
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status === 'in-game' && room.roundEndsAt && now >= room.roundEndsAt) {
        enterRoundResult(io, room);
      } else if (room.status === 'round-result' && room.roundResultEndsAt && now >= room.roundResultEndsAt) {
        advanceRound(io, room);
      }
    }
  }, 250);

  /** Waktu jawab habis: tampilkan jawaban benar & skor selama roundGapSec (3 - 60 detik). */
  function enterRoundResult(ioRef: Server, room: Room) {
    room.status = 'round-result';
    room.roundResultEndsAt = Date.now() + room.roundGapSec * 1000;
    const q = room.questions[room.currentQIndex];
    ioRef.to(room.code).emit('game:roundEnded', {
      currentQIndex: room.currentQIndex,
      correctIndex: q?.correctIndex,
      explanation: q?.explanation || '',
      roundResultEndsAt: room.roundResultEndsAt,
      isLastQuestion: room.currentQIndex >= room.questions.length - 1,
    });
    broadcastRoom(ioRef, room);
  }

  function advanceRound(ioRef: Server, room: Room) {
    const isLastQuestion = room.currentQIndex >= room.questions.length - 1;
    room.roundResultEndsAt = null;
    if (isLastQuestion) {
      room.status = 'podium';
      room.roundStartedAt = null;
      room.roundEndsAt = null;
      ioRef.to(room.code).emit('game:ended', publicRoomState(room));
      return;
    }
    room.status = 'in-game';
    room.currentQIndex += 1;
    room.roundStartedAt = Date.now();
    room.roundEndsAt = Date.now() + roundSecForQuestion(room, room.currentQIndex) * 1000;
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
