// server/multiplayerSocket.ts
//
// Multiplayer kuis REAL-TIME lewat WebSocket (socket.io).
//
// v5 — perubahan dari v4:
//  - Pemain dikenali lewat `clientId` stabil (dari browser), BUKAN socket.id. Jadi kalau
//    tab ditutup / halaman di-refresh / koneksi putus, pemain tetap ada di ruangan dan
//    bisa lanjut lewat event `room:rejoin` selama permainan masih berlangsung.
//  - Host bisa "Tahan Pemain Keluar" (`lockPlayers`): selama permainan berjalan, pemain
//    non-host tidak bisa keluar & tidak dihapus walau offline.
//  - Aturan host keluar (`hostLeavePolicy`): 'next' (bawaan, pemain yang join tepat
//    setelah host), 'choose' (host menunjuk pengganti), 'end' (permainan diakhiri).
//  - Jeda/Lanjutkan permainan oleh host (`game:pause` / `game:resume`) di layar jeda antar soal.
//  - Pengaturan bisa diubah host selama masih di lobby (`room:settings`).
//
// v5.1 — keamanan:
//  - Kunci jawaban (`correctIndex`) & penjelasan TIDAK lagi dikirim bersama soal. Soal yang
//    dikirim ke pemain sudah dibersihkan; jawaban benar baru dikirim setelah pemain menjawab
//    atau setelah waktu soal habis.
//  - `clientId` bersifat rahasia (hanya dipegang pemilik) dan tidak pernah disiarkan. Pemain
//    lain hanya melihat ID publik acak (`id`), jadi tidak ada yang bisa menyamar jadi pemain lain.
//  - Kode ruangan 4 karakter acak (bukan 3 digit), batas percobaan join, batas jumlah ruangan
//    & pemain, batas laju event, dan validasi avatar/nama/jawaban.

import type { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { randomBytes, randomInt } from 'crypto';

export const MIN_GAP_SEC = 3;
export const MAX_GAP_SEC = 60;
const MIN_ROUND_SEC = 1;
const MAX_ROUND_SEC = 180;
const MAX_QUESTIONS = 100;
const DEFAULT_BASE_POINTS = 100;
/** Pemain offline dibiarkan segini lama sebelum dihapus (kecuali ditahan host saat permainan berjalan). */
const GRACE_MS = 60_000;
const MAX_ROOMS = 500;
const MAX_PLAYERS = 50;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // tanpa 0/O/1/I agar tidak membingungkan
/** Ruangan tanpa satu pun pemain online selama ini akan dihapus. */
const ROOM_IDLE_MS = 10 * 60_000;

type LeavePolicy = 'next' | 'end' | 'choose';

interface Player {
  /** clientId RAHASIA dari browser (kunci identitas, tidak pernah disiarkan). */
  key: string;
  /** ID publik acak, aman dilihat pemain lain. */
  id: string;
  socketId: string | null;
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
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
  /** Pilihan jawaban per indeks soal (dipakai untuk riwayat & pemulihan setelah reconnect). */
  answers: Record<number, number>;
}

interface Room {
  code: string;
  deckId: string;
  deckTitle: string;
  questions: any[];
  roundTimeSec: number;
  questionTimes: number[];
  roundGapSec: number;
  players: Map<string, Player>;
  status: 'lobby' | 'in-game' | 'round-result' | 'podium';
  currentQIndex: number;
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  roundResultEndsAt: number | null;
  hostId: string;
  visibility: 'invite' | 'global';
  password?: string;
  timeDecay: boolean;
  minPointsPercent: number;
  wrongPenaltyPercent: number;
  /** Host menahan pemain agar tidak bisa keluar selama permainan berjalan. */
  lockPlayers: boolean;
  hostLeavePolicy: LeavePolicy;
  /** Jeda oleh host (hanya pada status 'round-result'). */
  paused: boolean;
  pausedRemainingMs: number | null;
  /** Pesan untuk semua pemain, mis. "Host keluar, permainan diakhiri." */
  endNotice: string | null;
  emptySince: number | null;
}

const rooms = new Map<string, Room>();

function genRoomCode(): string {
  let code: string;
  do {
    let tail = '';
    for (let i = 0; i < 4; i++) tail += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    code = 'MZK-' + tail;
  } while (rooms.has(code));
  return code;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function cleanClientId(v: unknown): string | null {
  const s = String(v ?? '');
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

const cleanPolicy = (v: unknown): LeavePolicy => (v === 'end' || v === 'choose' ? v : 'next');

const cleanText = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);

/** Hanya URL http(s) atau path lokal; tolak data:/javascript: dan URL kelewat panjang. */
function cleanAvatar(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s.length > 500) return '';
  return /^(https?:\/\/|\/(?!\/))/i.test(s) ? s : '';
}

/** Buang field yang membocorkan jawaban sebelum soal dikirim ke pemain. */
function publicQuestion(q: any) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(q || {})) {
    if (/correct|answer|explan|kunci|jawaban|penjelasan/i.test(k)) continue;
    out[k] = q[k];
  }
  return out;
}
const publicQuestions = (room: Room) => room.questions.map(publicQuestion);

/** Jawaban benar + penjelasan soal yang sudah terbuka (selesai / sudah dijawab). */
function revealOf(room: Room, idx: number) {
  const q = room.questions[idx];
  return q ? { correctIndex: q.correctIndex, explanation: q.explanation || '' } : null;
}

/** Pembatas laju sederhana per socket: maksimal `max` kejadian per `windowMs`. */
function makeLimiter(max: number, windowMs: number) {
  let stamps: number[] = [];
  return () => {
    const now = Date.now();
    stamps = stamps.filter((t) => now - t < windowMs);
    if (stamps.length >= max) return false;
    stamps.push(now);
    return true;
  };
}

const isRunning = (room: Room) => room.status === 'in-game' || room.status === 'round-result';

function basePointsForQuestion(room: Room, idx: number): number {
  const p = Number(room.questions[idx]?.points);
  return Number.isFinite(p) && p > 0 ? p : DEFAULT_BASE_POINTS;
}

function roundSecForQuestion(room: Room, idx: number): number {
  const t = Number(room.questionTimes[idx]);
  return Number.isFinite(t) && t >= MIN_ROUND_SEC ? clamp(Math.round(t), MIN_ROUND_SEC, MAX_ROUND_SEC) : room.roundTimeSec;
}

function pointsForCorrect(room: Room, basePoints: number, elapsedRatio: number): number {
  if (!room.timeDecay) return basePoints;
  const ratio = clamp(elapsedRatio, 0, 1);
  const floorPts = Math.round(basePoints * room.minPointsPercent);
  const pts = Math.round(basePoints * (1 - (1 - room.minPointsPercent) * ratio));
  return clamp(pts, floorPts, basePoints);
}

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
    hasPassword: Boolean(room.password),
    status: room.status,
    currentQIndex: room.currentQIndex,
    totalQuestions: room.questions.length,
    roundEndsAt: room.roundEndsAt,
    roundResultEndsAt: room.roundResultEndsAt,
    hostId: room.hostId,
    lockPlayers: room.lockPlayers,
    hostLeavePolicy: room.hostLeavePolicy,
    paused: room.paused,
    endNotice: room.endNotice,
    currentQuestionBasePoints: isRunning(room) ? basePointsForQuestion(room, room.currentQIndex) : null,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl || '',
      frameId: p.frameId || 'none',
      isHost: p.isHost,
      isReady: p.isReady,
      connected: p.connected,
      score: p.score,
      streak: p.streak,
      lastAnswerStatus: p.lastAnswerStatus,
      lastPointsAwarded: p.lastPointsAwarded,
    })),
  };
}

/** Data untuk memulihkan layar pemain yang baru tersambung kembali. */
function syncPayloadFor(room: Room, p: Player) {
  const q = room.questions[room.currentQIndex];
  // Hanya soal yang sudah selesai (atau seluruhnya bila permainan sudah berakhir) yang dibuka.
  const lastOpen = room.status === 'podium' ? room.questions.length - 1 : room.status === 'round-result' ? room.currentQIndex : room.currentQIndex - 1;
  const revealed: Record<number, { correctIndex: number; explanation: string }> = {};
  for (let i = 0; i <= lastOpen; i++) {
    const r = revealOf(room, i);
    if (r) revealed[i] = r;
  }
  return {
    questions: room.status === 'lobby' ? [] : publicQuestions(room),
    currentQIndex: room.currentQIndex,
    roundEndsAt: room.roundEndsAt,
    myAnswers: p.answers,
    revealed,
    myResult:
      room.status === 'in-game' && p.hasAnsweredThisRound && q
        ? {
            isCorrect: p.lastAnswerStatus === 'correct',
            pointsAwarded: p.lastPointsAwarded ?? 0,
            correctIndex: q.correctIndex,
            explanation: q.explanation || '',
          }
        : room.status === 'round-result' && p.hasAnsweredThisRound && q
        ? {
            isCorrect: p.lastAnswerStatus === 'correct',
            pointsAwarded: p.lastPointsAwarded ?? 0,
            correctIndex: q.correctIndex,
            explanation: q.explanation || '',
          }
        : null,
    roundResult: room.status === 'round-result' ? revealOf(room, room.currentQIndex) : null,
  };
}

function broadcastRoom(io: Server, room: Room) {
  io.to(room.code).emit('room:update', publicRoomState(room));
}

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

function newPlayer(key: string, socketId: string, isHost: boolean, d: { name?: string; avatarUrl?: string; frameId?: string }): Player {
  return {
    key,
    id: 'p' + randomBytes(6).toString('hex'),
    socketId,
    connected: true,
    disconnectedAt: null,
    joinedAt: Date.now(),
    name: cleanText(d.name, 40) || (isHost ? 'Host' : 'Pemain'),
    avatarUrl: cleanAvatar(d.avatarUrl),
    frameId: cleanText(d.frameId, 40) || 'none',
    isHost,
    isReady: isHost,
    score: 0,
    streak: 0,
    hasAnsweredThisRound: false,
    answers: {},
  };
}

function findRoomOf(clientKey: string): Room | undefined {
  for (const r of rooms.values()) if (r.players.has(clientKey)) return r;
  return undefined;
}

/** Pilih host pengganti. Dipakai setelah host lama sudah dihapus dari `room.players`. */
function assignHost(room: Room, oldHost: Player, successorId?: string) {
  const all = Array.from(room.players.values()).sort((a, b) => a.joinedAt - b.joinedAt);
  if (!all.length) return;
  let next = successorId ? all.find((p) => p.id === successorId) : undefined;
  if (!next) {
    // Bawaan: pemain yang bergabung TEPAT setelah host (kalau host paling akhir -> yang paling awal).
    const pool = all.some((p) => p.connected) ? all.filter((p) => p.connected) : all;
    next = pool.find((p) => p.joinedAt > oldHost.joinedAt) || pool[0];
  }
  for (const p of room.players.values()) p.isHost = false;
  next.isHost = true;
  next.isReady = true;
  room.hostId = next.id;
}

function endGameNow(io: Server, room: Room, notice: string) {
  room.status = 'podium';
  room.roundStartedAt = null;
  room.roundEndsAt = null;
  room.roundResultEndsAt = null;
  room.paused = false;
  room.pausedRemainingMs = null;
  room.endNotice = notice;
  const revealed: Record<number, { correctIndex: number; explanation: string }> = {};
  room.questions.forEach((_, i) => {
    const r = revealOf(room, i);
    if (r) revealed[i] = r;
  });
  io.to(room.code).emit('game:ended', { state: publicRoomState(room), revealed });
}

function closeRoom(io: Server, room: Room, reason: string) {
  io.to(room.code).emit('room:closed', reason);
  rooms.delete(room.code);
}

/** Hapus pemain dari ruangan dengan menerapkan aturan host keluar. */
function removePlayer(io: Server, room: Room, p: Player, successorId?: string) {
  if (!room.players.has(p.key)) return;
  const wasHost = room.hostId === p.id;
  if (p.socketId) io.sockets.sockets.get(p.socketId)?.leave(room.code);

  if (wasHost && room.hostLeavePolicy === 'end' && room.status !== 'podium') {
    if (room.status === 'lobby') {
      closeRoom(io, room, 'Host keluar, ruangan ditutup.');
      return;
    }
    room.players.delete(p.key);
    if (room.players.size === 0) {
      rooms.delete(room.code);
      return;
    }
    assignHost(room, p); // supaya ruangan tidak yatim; permainan tetap diakhiri
    endGameNow(io, room, 'Host keluar, permainan diakhiri.');
    return;
  }

  room.players.delete(p.key);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (wasHost) {
    assignHost(room, p, room.hostLeavePolicy === 'choose' ? successorId : undefined);
    if (room.paused) {
      // jeda yang dipegang host lama tidak boleh menggantung tanpa pemegang
      resumeRoom(room);
    }
  }
  broadcastRoom(io, room);
}

function resumeRoom(room: Room) {
  if (!room.paused) return;
  const remain = Math.max(room.pausedRemainingMs ?? 0, MIN_GAP_SEC * 1000);
  room.paused = false;
  room.pausedRemainingMs = null;
  room.roundResultEndsAt = Date.now() + remain;
}

export function attachMultiplayerSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: '*' },
    path: '/socket.io',
  });

  io.on('connection', (socket: Socket) => {
    let ctx: { code: string; clientKey: string } | null = null;
    // Batas laju per socket supaya tidak bisa membanjiri server.
    const allow = makeLimiter(40, 5_000); // semua event
    const allowJoin = makeLimiter(8, 10_000); // percobaan join / create
    const allowReact = makeLimiter(6, 3_000); // emoji

    const getCtx = () => {
      if (!ctx) return null;
      const room = rooms.get(ctx.code);
      const me = room?.players.get(ctx.clientKey);
      if (!room || !me) return null;
      return { room, me };
    };

    /** Pasang socket ini ke pemain yang sudah ada (reconnect / buka tab baru). */
    const attach = (room: Room, p: Player, event: 'room:resumed' | 'room:joined') => {
      if (p.socketId && p.socketId !== socket.id) {
        const old = io.sockets.sockets.get(p.socketId);
        old?.emit('room:replaced');
        old?.leave(room.code);
      }
      p.socketId = socket.id;
      p.connected = true;
      p.disconnectedAt = null;
      socket.join(room.code);
      ctx = { code: room.code, clientKey: p.key };
      socket.emit(event, { state: publicRoomState(room), sync: syncPayloadFor(room, p), you: p.id });
      broadcastRoom(io, room);
    };

    // Pemulihan sesi: dipanggil klien tiap kali modal Multiplayer dibuka / koneksi tersambung.
    socket.on('room:rejoin', (payload: { clientId: string }) => {
      if (!allow() || !allowJoin()) return;
      const key = cleanClientId(payload?.clientId);
      if (!key) return;
      const room = findRoomOf(key);
      if (!room) return socket.emit('room:resumeFailed');
      attach(room, room.players.get(key)!, 'room:resumed');
    });

    socket.on(
      'room:create',
      (payload: {
        clientId: string;
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
        lockPlayers?: boolean;
        hostLeavePolicy?: LeavePolicy;
      }) => {
        if (!allow() || !allowJoin()) return socket.emit('room:error', 'Terlalu banyak permintaan. Coba lagi sebentar.');
        const key = cleanClientId(payload?.clientId);
        if (!key) return socket.emit('room:error', 'Identitas pemain tidak valid. Muat ulang halaman.');

        const existing = findRoomOf(key);
        if (existing) {
          if (isRunning(existing)) return attach(existing, existing.players.get(key)!, 'room:resumed');
          removePlayer(io, existing, existing.players.get(key)!); // keluar dari ruangan lama (lobby/podium)
        }
        if (rooms.size >= MAX_ROOMS) return socket.emit('room:error', 'Server sedang penuh. Coba lagi nanti.');

        const code = genRoomCode();
        const roundGapSec = clamp(Math.round(Number(payload.roundGapSec) || 5), MIN_GAP_SEC, MAX_GAP_SEC);
        const minRaw = Number(payload.minPointsPercent);
        const minPointsPercent = clamp(Number.isFinite(minRaw) ? minRaw : 0.3, 0, 0.9);
        const visibility: 'invite' | 'global' = payload.visibility === 'global' ? 'global' : 'invite';
        const password =
          visibility === 'global' && payload.password ? cleanText(payload.password, 32) : undefined;
        const host = newPlayer(key, socket.id, true, payload);
        const room: Room = {
          code,
          deckId: cleanText(payload.deckId, 100),
          deckTitle: cleanText(payload.deckTitle, 255) || 'Kuis',
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
          hostId: host.id,
          visibility,
          password: password || undefined,
          timeDecay: payload.timeDecay !== false,
          minPointsPercent,
          wrongPenaltyPercent: 0,
          lockPlayers: Boolean(payload.lockPlayers),
          hostLeavePolicy: cleanPolicy(payload.hostLeavePolicy),
          paused: false,
          pausedRemainingMs: null,
          endNotice: null,
          emptySince: null,
        };
        room.players.set(key, host);
        rooms.set(code, room);
        socket.join(code);
        ctx = { code, clientKey: key };
        socket.emit('room:created', { state: publicRoomState(room), you: host.id });
      }
    );

    socket.on(
      'room:join',
      (payload: { clientId: string; code: string; name: string; avatarUrl?: string; frameId?: string; password?: string }) => {
        if (!allow() || !allowJoin()) return socket.emit('room:error', 'Terlalu banyak percobaan. Coba lagi sebentar.');
        const key = cleanClientId(payload?.clientId);
        if (!key) return socket.emit('room:error', 'Identitas pemain tidak valid. Muat ulang halaman.');
        const wantedCode = cleanText(payload.code, 12).toUpperCase();

        // Pemain yang sudah terdaftar di ruangan berjalan -> langsung pulihkan, bukan join baru.
        const existing = findRoomOf(key);
        if (existing) {
          if (isRunning(existing) || existing.code === wantedCode) {
            return attach(existing, existing.players.get(key)!, 'room:resumed');
          }
          removePlayer(io, existing, existing.players.get(key)!);
        }

        const room = rooms.get(wantedCode);
        if (!room) return socket.emit('room:error', 'Kode ruangan tidak ditemukan.');
        if (room.status !== 'lobby') return socket.emit('room:error', 'Pertandingan sudah dimulai, tidak bisa join.');
        if (room.players.size >= MAX_PLAYERS) return socket.emit('room:error', 'Ruangan sudah penuh.');
        if (room.visibility === 'global' && room.password) {
          if (cleanText(payload.password, 32) !== room.password) {
            return socket.emit('room:error', 'Password ruangan salah.');
          }
        }

        const p = newPlayer(key, socket.id, false, payload);
        room.players.set(key, p);
        socket.join(room.code);
        ctx = { code: room.code, clientKey: key };
        socket.emit('room:joined', { state: publicRoomState(room), sync: syncPayloadFor(room, p), you: p.id });
        broadcastRoom(io, room);
      }
    );

    socket.on('room:listGlobal', () => {
      if (!allow()) return;
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

    // Host mengubah aturan selama masih di lobby (sebelum mulai).
    socket.on('room:settings', (payload: { lockPlayers?: boolean; hostLeavePolicy?: LeavePolicy }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id || c.room.status !== 'lobby') return;
      if (typeof payload?.lockPlayers === 'boolean') c.room.lockPlayers = payload.lockPlayers;
      if (payload?.hostLeavePolicy) c.room.hostLeavePolicy = cleanPolicy(payload.hostLeavePolicy);
      broadcastRoom(io, c.room);
    });

    socket.on(
      'room:start',
      (payload: { questions: any[]; questionTimes?: number[]; wrongPenaltyPercent?: number }) => {
        if (!allow()) return;
        const c = getCtx();
        if (!c || c.room.hostId !== c.me.id) return;
        const room = c.room;
        if (room.status !== 'lobby' && room.status !== 'podium') return;

        const questions = sanitizeQuestions(payload?.questions);
        if (!questions.length) return socket.emit('room:error', 'Tidak ada soal valid untuk dimainkan.');

        room.questions = questions;
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
        room.paused = false;
        room.pausedRemainingMs = null;
        room.endNotice = null;
        for (const p of room.players.values()) {
          p.score = 0;
          p.streak = 0;
          p.hasAnsweredThisRound = false;
          p.lastAnswerStatus = undefined;
          p.lastPointsAwarded = undefined;
          p.answers = {};
        }
        // Soal dikirim TANPA kunci jawaban & penjelasan.
        io.to(room.code).emit('game:started', {
          questions: publicQuestions(room),
          roundEndsAt: room.roundEndsAt,
          currentQIndex: 0,
        });
        broadcastRoom(io, room);
      }
    );

    socket.on('game:answer', (payload: { optionIndex: number }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c) return;
      const { room, me: p } = c;
      if (room.status !== 'in-game' || !room.roundStartedAt || !room.roundEndsAt) return;
      if (Date.now() >= room.roundEndsAt) return;
      if (p.hasAnsweredThisRound) return;

      const q = room.questions[room.currentQIndex];
      const opt = Number(payload?.optionIndex);
      if (!q || !Number.isInteger(opt) || opt < 0 || opt >= q.options.length) return;
      const isCorrect = opt === q.correctIndex;
      p.hasAnsweredThisRound = true;
      p.answers[room.currentQIndex] = opt;
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
        const penalty = penaltyForWrong(room, basePoints);
        p.score += penalty;
        p.streak = 0;
        p.lastAnswerStatus = 'wrong';
        p.lastPointsAwarded = penalty;
      }
      // Jawaban benar baru dibuka untuk pemain ini SETELAH ia menjawab.
      socket.emit('game:answerResult', {
        currentQIndex: room.currentQIndex,
        isCorrect,
        pointsAwarded: p.lastPointsAwarded,
        correctIndex: q.correctIndex,
        explanation: q.explanation || '',
      });
      broadcastRoom(io, room);
    });

    // Jeda & lanjutkan: hanya host, hanya di layar jeda antar soal.
    socket.on('game:pause', () => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id) return;
      const room = c.room;
      if (room.status !== 'round-result' || room.paused || !room.roundResultEndsAt) return;
      room.pausedRemainingMs = Math.max(0, room.roundResultEndsAt - Date.now());
      room.roundResultEndsAt = null;
      room.paused = true;
      broadcastRoom(io, room);
    });

    socket.on('game:resume', () => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id) return;
      const room = c.room;
      if (room.status !== 'round-result' || !room.paused) return;
      resumeRoom(room);
      broadcastRoom(io, room);
    });

    socket.on('room:reaction', (payload: { emoji: string }) => {
      if (!allow() || !allowReact()) return;
      const c = getCtx();
      if (!c) return;
      const emoji = cleanText(payload?.emoji, 8);
      if (!emoji) return;
      io.to(c.room.code).emit('room:reactionReceived', { playerId: c.me.id, playerName: c.me.name, emoji });
    });

    // Keluar dari permainan (tombol "Keluar").
    socket.on('room:leave', (payload?: { successorId?: string }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c) return socket.emit('room:left');
      const { room, me } = c;
      const held = room.lockPlayers && isRunning(room) && room.hostId !== me.id;
      if (held) return socket.emit('room:error', 'Host menahan pemain: kamu tidak bisa keluar sampai permainan selesai.');
      ctx = null;
      socket.emit('room:left');
      removePlayer(io, room, me, typeof payload?.successorId === 'string' ? payload.successorId : undefined);
    });

    socket.on('disconnect', () => {
      const c = getCtx();
      if (!c || c.me.socketId !== socket.id) return;
      c.me.connected = false;
      c.me.socketId = null;
      c.me.disconnectedAt = Date.now();
      broadcastRoom(io, c.room);
    });
  });

  // Loop utama (250 ms): ganti ronde + bersihkan pemain offline / ruangan kosong.
  let lastSweep = 0;
  setInterval(() => {
    const now = Date.now();
    for (const room of Array.from(rooms.values())) {
      if (room.status === 'in-game' && room.roundEndsAt && now >= room.roundEndsAt) {
        enterRoundResult(io, room);
      } else if (room.status === 'round-result' && !room.paused && room.roundResultEndsAt && now >= room.roundResultEndsAt) {
        advanceRound(io, room);
      }
    }
    if (now - lastSweep < 1000) return;
    lastSweep = now;
    for (const room of Array.from(rooms.values())) {
      const anyOnline = Array.from(room.players.values()).some((p) => p.connected);
      if (anyOnline) room.emptySince = null;
      else if (room.emptySince === null) room.emptySince = now;
      else if (now - room.emptySince > ROOM_IDLE_MS) {
        rooms.delete(room.code);
        continue;
      }
      for (const p of Array.from(room.players.values())) {
        if (p.connected || p.disconnectedAt === null) continue;
        const held = room.lockPlayers && isRunning(room) && !p.isHost;
        if (!held && now - p.disconnectedAt > GRACE_MS) removePlayer(io, room, p);
        if (!rooms.has(room.code)) break;
      }
    }
  }, 250);

  function enterRoundResult(ioRef: Server, room: Room) {
    room.status = 'round-result';
    room.paused = false;
    room.pausedRemainingMs = null;
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
      endGameNow(ioRef, room, '');
      room.endNotice = null;
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
