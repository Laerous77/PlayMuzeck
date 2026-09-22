// server/multiplayerSocket.ts
//
// Multiplayer kuis REAL-TIME lewat WebSocket (socket.io, gratis, menumpang di
// server Express yang sama).
//
// v3 — perbaikan dari v2 (lihat catatan sebelumnya untuk histori v1 -> v2):
//  - POIN TIDAK LAGI HARDCODE 100. Poin penuh per ronde sekarang diambil dari
//    `points` milik soal itu sendiri (yang diatur kreator di Quiz Editor —
//    baik pakai skema "Poin Sama Rata" maupun "Poin Berbeda" per soal).
//    Kalau soal freeform tidak punya field `points` sama sekali, baru fallback
//    ke 100. Ini menyatukan sumber kebenaran poin: satu-satunya tempat atur
//    poin dasar adalah Editor, multiplayer cuma menentukan BERAPA PERSEN dari
//    poin itu yang didapat berdasarkan kecepatan jawab.
//  - `minPoints` (angka absolut) diganti `minPointsPercent` (0.0 - 0.9, alias
//    0%-90% dari poin soal). Sebelumnya minPoints berupa angka tetap (mis. 10)
//    yang bisa lebih besar dari poin soal itu sendiri kalau soalnya cuma
//    bernilai kecil (mis. 2 poin) — jelas tidak logis (minimal > maksimal).
//    Dengan persentase, secara matematis poin minimal SELALU lebih kecil dari
//    poin penuh berapa pun nilai poin soalnya, jadi otomatis konsisten &
//    dinamis mengikuti tiap soal, bukan cuma dinamis di UI slider-nya doang.
//  - Tambah JEDA ANTAR SOAL (`roundGapSec`, diatur host). Setelah waktu jawab
//    (roundTimeSec) habis, room masuk status sementara 'round-result' selama
//    `roundGapSec` detik — client bisa menampilkan jawaban benar & papan skor
//    dulu — baru lanjut ke soal berikutnya. Sebelumnya soal berikutnya
//    langsung muncul detik itu juga tanpa jeda sama sekali.

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
  /** Jeda (detik) menampilkan hasil ronde sebelum pindah ke soal berikutnya. */
  roundGapSec: number;
  players: Map<string, Player>;
  status: 'lobby' | 'in-game' | 'round-result' | 'podium';
  currentQIndex: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  /** Terisi hanya saat status 'round-result': kapan jeda ini berakhir & pindah ronde. */
  roundResultEndsAt: number | null;
  hostSocketId: string;
  /**
   * 'invite'  -> hanya bisa dimasuki lewat kode ruangan, tidak muncul di
   *              daftar publik. Tidak pernah butuh password.
   * 'global'  -> muncul di daftar "Room Global" (bisa dicari & digabung
   *              tanpa kode). Password OPSIONAL — kalau diisi host, pemain
   *              lain wajib memasukkan password itu sebelum join.
   */
  visibility: 'invite' | 'global';
  /** Hanya dipakai kalau visibility === 'global'. Kosong = room global tanpa password. */
  password?: string;
  /** 0.1 - 0.9: porsi waktu pertama yang masih dapat poin penuh. Diatur host. */
  fullPointRatio: number;
  /**
   * 0 - 0.9: persentase dari poin ASLI SOAL (bukan angka tetap) yang tetap
   * didapat kalau menjawab benar mepet waktu habis. Diatur host. Karena ini
   * persentase dari poin soal itu sendiri, nilainya otomatis selalu < poin
   * penuh berapa pun besar poin soalnya (2, 10, 1000, dst) — tidak mungkin
   * "poin minimal" jadi lebih besar dari "poin maksimal" seperti sebelumnya.
   */
  minPointsPercent: number;
}

const rooms = new Map<string, Room>();

function genRoomCode(): string {
  let code: string;
  do {
    code = 'MZK-' + Math.floor(100 + Math.random() * 900);
  } while (rooms.has(code));
  return code;
}

/** Poin dasar (poin penuh) untuk soal ke-`idx`, diambil dari Quiz Editor. */
function basePointsForQuestion(room: Room, idx: number): number {
  const q = room.questions[idx];
  const p = Number(q?.points);
  // Fallback 100 HANYA kalau soal memang tidak punya field points sama
  // sekali (mis. deck lama / sumber lain di luar Editor). Kalau Editor
  // sudah mengisi q.points (termasuk skema "Poin Sama Rata"), itu yang dipakai.
  return Number.isFinite(p) && p > 0 ? p : 100;
}

function publicRoomState(room: Room) {
  return {
    code: room.code,
    deckId: room.deckId,
    deckTitle: room.deckTitle,
    roundTimeSec: room.roundTimeSec,
    roundGapSec: room.roundGapSec,
    fullPointRatio: room.fullPointRatio,
    minPointsPercent: room.minPointsPercent,
    visibility: room.visibility,
    // Kirim cuma status "ada password atau tidak", JANGAN pernah kirim
    // password aslinya ke client — client cuma perlu tahu apakah perlu
    // menampilkan kolom input password sebelum join.
    hasPassword: Boolean(room.password),
    status: room.status,
    currentQIndex: room.currentQIndex,
    roundEndsAt: room.roundEndsAt,
    roundResultEndsAt: room.roundResultEndsAt,
    // Poin penuh soal SAAT INI — dikirim ke client supaya UI bisa tampilkan
    // "poin penuh: X" yang benar-benar sesuai Editor, bukan angka 100 statis.
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

/**
 * Skor berbasis waktu jawab, mengikuti poin ASLI soal (`basePoints`, dari
 * Editor) dan pengaturan host:
 *  - 0% sampai `fullPointRatio` dari total waktu -> poin penuh (basePoints)
 *  - `fullPointRatio` sampai 100% waktu          -> turun LINEAR menuju
 *    `minPointsPercent * basePoints`
 *  - waktu habis / tidak menjawab                -> 0
 */
function pointsForElapsedRatio(
  elapsedRatio: number,
  fullPointRatio: number,
  minPointsPercent: number,
  basePoints: number
): number {
  if (elapsedRatio >= 1) return 0;
  if (elapsedRatio <= fullPointRatio) return basePoints;
  const minPoints = Math.round(basePoints * minPointsPercent);
  const decayProgress = (elapsedRatio - fullPointRatio) / (1 - fullPointRatio); // 0..1
  const pts = basePoints - decayProgress * (basePoints - minPoints);
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
        roundGapSec?: number;
        fullPointRatio?: number;
        minPointsPercent?: number;
        /** 'global' -> room muncul di daftar publik & bisa digabung tanpa kode. Default 'invite'. */
        visibility?: 'invite' | 'global';
        /** Opsional, hanya dipakai kalau visibility === 'global'. Diabaikan untuk 'invite'. */
        password?: string;
      }) => {
        const code = genRoomCode();
        // Validasi & batasi input host:
        //  - fullPointRatio: 10%-90% waktu.
        //  - minPointsPercent: 0%-90% dari poin soal (bukan angka absolut lagi,
        //    jadi tidak bisa "lebih besar dari poin soal" berapa pun poinnya).
        //  - roundGapSec: 0-30 detik jeda antar soal.
        const fullPointRatio = Math.min(0.9, Math.max(0.1, Number(payload.fullPointRatio) || 0.4));
        const minPointsPercent = Math.min(0.9, Math.max(0, Number(payload.minPointsPercent) || 0.1));
        const roundGapSec = Math.min(30, Math.max(0, Math.round(Number(payload.roundGapSec) || 5)));
        // Room 'invite' TIDAK PERNAH pakai password (tidak relevan, karena
        // hanya bisa dimasuki lewat kode). Password hanya berlaku untuk
        // 'global', dan itu pun opsional — host boleh kosongkan.
        const visibility: 'invite' | 'global' = payload.visibility === 'global' ? 'global' : 'invite';
        const password =
          visibility === 'global' && payload.password ? String(payload.password).trim().slice(0, 32) : undefined;
        const room: Room = {
          code,
          deckId: payload.deckId,
          deckTitle: payload.deckTitle,
          questions: [],
          roundTimeSec: payload.roundTimeSec || 20,
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
          fullPointRatio,
          minPointsPercent,
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
        // Password cuma relevan buat room 'global' yang diberi password oleh
        // host. Room 'invite' tidak pernah dicek password sama sekali —
        // cukup tahu kodenya saja, sesuai desainnya.
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

    // Daftar room 'global' yang masih di lobby (belum mulai) supaya client
    // bisa menampilkan "Room Global" untuk digabung tanpa kode. Password
    // asli TIDAK dikirim — cuma flag hasPassword, sama seperti publicRoomState.
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

    socket.on('room:start', (payload: { questions: any[] }) => {
      if (!joinedRoomCode) return;
      const room = rooms.get(joinedRoomCode);
      if (!room || room.hostSocketId !== socket.id) return;

      room.questions = Array.isArray(payload.questions) ? payload.questions : [];
      room.status = 'in-game';
      room.currentQIndex = 0;
      room.roundStartedAt = Date.now();
      room.roundEndsAt = Date.now() + room.roundTimeSec * 1000;
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
        const basePoints = basePointsForQuestion(room, room.currentQIndex);
        const totalMs = room.roundEndsAt - room.roundStartedAt;
        const elapsedMs = Date.now() - room.roundStartedAt;
        const elapsedRatio = totalMs > 0 ? elapsedMs / totalMs : 1;
        const pts = pointsForElapsedRatio(elapsedRatio, room.fullPointRatio, room.minPointsPercent, basePoints);
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

  // Loop utama: dua pemicu transisi sekarang berjalan bergantian.
  //  1) 'in-game' & waktu jawab habis        -> masuk 'round-result' (jeda).
  //  2) 'round-result' & jeda selesai        -> pindah ronde / selesai game.
  // Tidak ada lagi percepatan karena "semua sudah jawab" (tetap fair/v2).
  setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.status === 'in-game' && room.roundEndsAt && now >= room.roundEndsAt) {
        enterRoundResult(io, room);
      } else if (room.status === 'round-result' && room.roundResultEndsAt && now >= room.roundResultEndsAt) {
        advanceRound(io, room);
      }
    }
  }, 500);

  /** Waktu jawab habis: tampilkan jawaban benar & skor selama roundGapSec sebelum lanjut. */
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

    // roundGapSec = 0 -> lanjut langsung, tanpa nunggu tick berikutnya.
    if (room.roundGapSec <= 0) advanceRound(ioRef, room);
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
