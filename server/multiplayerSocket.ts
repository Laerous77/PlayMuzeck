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
/** Reaksi yang diizinkan (urutan sama dengan tombol di klien). Selain ini ditolak. */
const ALLOWED_EMOJIS = new Set(['🔥', '👏', '😂', '😭', '😮', '😞', '😡', '💀', '❤️']);
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
  /** Host pengawas: memantau & mengatur, tidak ikut menjawab, tidak masuk papan skor, tidak kirim emoji. */
  observer: boolean;
  /** Bergabung setelah permainan utama selesai (atau saat sesi susulan berjalan): bukan dari sesi yang sama. */
  late: boolean;
  /** Sudah menjalani sesi susulan. */
  madeUp: boolean;
  /** Boleh menjawab di sesi yang sedang berjalan (di sesi susulan hanya peserta susulan). */
  participating: boolean;
  /** ID akun (dari sesi login) kalau pemain sedang login. RAHASIA: tidak pernah disiarkan. */
  userId?: string;
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
  /** ID publik pemain non-host yang meminta main lagi (layar akhir). */
  rematchRequests: Set<string>;
  /** Sedang menjalankan sesi susulan (hanya pemain susulan yang menjawab). */
  makeupActive: boolean;
  /** clientId pemain yang dikeluarkan + diblokir host; tidak bisa gabung lagi ke ruangan ini. */
  banned: Set<string>;
  /** ID akun yang diblokir dari ruangan ini (berlaku walau ganti browser/hapus data). */
  bannedUsers: Set<string>;
  /** Snapshot pemain yang keluar/terputus lama saat permainan berjalan, supaya skornya tidak hilang. */
  departed: Map<string, DepartedSnapshot>;
}

interface DepartedSnapshot {
  id: string;
  name: string;
  avatarUrl?: string;
  frameId?: string;
  joinedAt: number;
  score: number;
  streak: number;
  answers: Record<number, number>;
  lastAnswerStatus?: 'correct' | 'wrong';
  lastPointsAwarded?: number;
  /** 'manual' = menekan Keluar (tidak ditarik balik otomatis), 'timeout' = terputus > batas waktu. */
  reason: 'manual' | 'timeout';
  observer: boolean;
  late: boolean;
  madeUp: boolean;
  participating: boolean;
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

const isHeldIn = (room: Room, p: Player) =>
  room.lockPlayers && isRunning(room) && !p.isHost && !(room.makeupActive && !p.participating);

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

/** Pemain susulan yang belum main: tidak boleh melihat kunci jawaban. */
const isPendingLate = (room: Room, p: Player) => p.late && !p.madeUp && !p.observer && !(room.makeupActive && p.participating);

/** Kirim event berisi kunci jawaban ke semua pemain KECUALI pemain susulan yang belum main. */
function emitReveal(io: Server, room: Room, event: string, payload: unknown) {
  for (const p of room.players.values()) {
    if (p.socketId && !isPendingLate(room, p)) io.to(p.socketId).emit(event, payload);
  }
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
    rematchRequestIds: Array.from(room.rematchRequests).filter(
      (id) => id !== room.hostId && Array.from(room.players.values()).some((p) => p.id === id)
    ),
    makeupActive: room.makeupActive,
    makeupPending: Array.from(room.players.values()).filter((p) => p.late && !p.madeUp && !p.observer).length,
    currentQuestionBasePoints: isRunning(room) ? basePointsForQuestion(room, room.currentQIndex) : null,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl || '',
      frameId: p.frameId || 'none',
      isHost: p.isHost,
      isReady: p.isReady,
      observer: p.observer,
      late: p.late,
      madeUp: p.madeUp,
      participating: room.makeupActive || isRunning(room) ? p.participating : !p.observer,
      answered: room.status === 'in-game' && p.hasAnsweredThisRound,
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
  if (isPendingLate(room, p) && room.status !== 'lobby') {
    return {
      questions: isRunning(room) ? publicQuestions(room) : [],
      currentQIndex: room.currentQIndex,
      roundEndsAt: room.roundEndsAt,
      myAnswers: {},
      revealed: {},
      myResult: null,
      roundResult: null,
    };
  }
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
    observer: false,
    late: false,
    madeUp: false,
    participating: true,
    answers: {},
  };
}

/** Pulihkan pemain dari snapshot (skor, streak, jawaban) dan keluarkan dari daftar `departed`. */
function reviveDeparted(room: Room, key: string, socketId: string, ident?: { name?: string; avatarUrl?: string; frameId?: string }): Player | null {
  const snap = room.departed.get(key);
  if (!snap) return null;
  room.departed.delete(key);
  const p = newPlayer(key, socketId, false, ident ?? snap);
  p.id = snap.id;
  p.joinedAt = snap.joinedAt;
  p.score = snap.score;
  p.streak = snap.streak;
  p.answers = { ...snap.answers };
  p.lastAnswerStatus = snap.lastAnswerStatus;
  p.lastPointsAwarded = snap.lastPointsAwarded;
  p.observer = snap.observer;
  p.late = snap.late;
  p.madeUp = snap.madeUp;
  p.participating = snap.participating;
  p.hasAnsweredThisRound = room.status === 'in-game' && snap.answers[room.currentQIndex] !== undefined;
  if (room.status === 'in-game' && !p.hasAnsweredThisRound) {
    p.lastAnswerStatus = undefined;
    p.lastPointsAwarded = undefined;
  }
  room.players.set(key, p);
  return p;
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
  room.rematchRequests.clear();
  // Pemain yang terputus/keluar saat permainan tetap tampil di papan akhir (ditandai offline).
  for (const key of Array.from(room.departed.keys())) {
    const g = reviveDeparted(room, key, '');
    if (g) {
      g.socketId = null;
      g.connected = false;
      g.disconnectedAt = null;
    }
  }
  room.departed.clear();
  if (room.makeupActive) {
    for (const p of room.players.values()) if (p.participating && !p.observer) p.madeUp = true;
    room.makeupActive = false;
  }
  const revealed: Record<number, { correctIndex: number; explanation: string }> = {};
  room.questions.forEach((_, i) => {
    const r = revealOf(room, i);
    if (r) revealed[i] = r;
  });
  const state = publicRoomState(room);
  for (const p of room.players.values()) {
    if (p.socketId) io.to(p.socketId).emit('game:ended', { state, revealed: isPendingLate(room, p) ? {} : revealed });
  }
}

function emitStarted(io: Server, room: Room, makeup: boolean) {
  const questions = publicQuestions(room);
  for (const p of room.players.values()) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('game:started', {
      questions,
      roundEndsAt: room.roundEndsAt,
      currentQIndex: 0,
      makeup,
      participating: p.participating,
    });
  }
}

function closeRoom(io: Server, room: Room, reason: string) {
  io.to(room.code).emit('room:closed', reason);
  rooms.delete(room.code);
}

/** Hapus pemain dari ruangan dengan menerapkan aturan host keluar. */
function removePlayer(io: Server, room: Room, p: Player, successorId?: string, reason: 'manual' | 'timeout' | 'kicked' = 'manual') {
  if (!room.players.has(p.key)) return;
  if (isRunning(room) && reason !== 'kicked') {
    room.departed.set(p.key, {
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      frameId: p.frameId,
      joinedAt: p.joinedAt,
      score: p.score,
      streak: p.streak,
      answers: { ...p.answers },
      lastAnswerStatus: p.lastAnswerStatus,
      lastPointsAwarded: p.lastPointsAwarded,
      reason,
      observer: p.observer,
      late: p.late,
      madeUp: p.madeUp,
      participating: p.participating,
    });
  }
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
    announceHost(io, room);
    return;
  }

  room.players.delete(p.key);
  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }
  if (wasHost) {
    assignHost(room, p, room.hostLeavePolicy === 'choose' ? successorId : undefined);
    announceHost(io, room);
    if (room.paused) {
      // jeda yang dipegang host lama tidak boleh menggantung tanpa pemegang
      resumeRoom(room);
    }
  }
  broadcastRoom(io, room);
}

function announceHost(io: Server, room: Room) {
  const h = Array.from(room.players.values()).find((x) => x.isHost);
  if (h) io.to(room.code).emit('room:notice', `${h.name} sekarang jadi host. Aturan ruangan tetap sama.`);
}

function resumeRoom(room: Room) {
  if (!room.paused) return;
  const remain = Math.max(room.pausedRemainingMs ?? 0, MIN_GAP_SEC * 1000);
  room.paused = false;
  room.pausedRemainingMs = null;
  room.roundResultEndsAt = Date.now() + remain;
}

/** Mengubah cookie sesi pada handshake socket menjadi ID akun (null = tamu / sesi tidak valid). */
export type ResolveUserId = (cookieHeader: string | undefined, handshake: any) => Promise<string | null>;

export function attachMultiplayerSocket(httpServer: HttpServer, resolveUserId?: ResolveUserId) {
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
      if (!me.userId && socket.data.userId) me.userId = socket.data.userId;
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
      if (!room) {
        for (const r of rooms.values()) {
          if (r.departed.get(key)?.reason === 'timeout' && isRunning(r) && r.players.size < MAX_PLAYERS) {
            const back = reviveDeparted(r, key, socket.id);
            if (back) return attach(r, back, 'room:resumed');
          }
        }
        return socket.emit('room:resumeFailed');
      }
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
        hostObserver?: boolean;
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
        host.userId = socket.data.userId;
        host.observer = Boolean(payload.hostObserver);
        host.participating = !host.observer;
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
          rematchRequests: new Set<string>(),
          departed: new Map<string, DepartedSnapshot>(),
          makeupActive: false,
          banned: new Set<string>(),
          bannedUsers: new Set<string>(),
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
        if (room.banned.has(key) || (socket.data.userId && room.bannedUsers.has(socket.data.userId))) return socket.emit('room:error', 'Kamu dikeluarkan dari ruangan ini oleh host dan tidak bisa bergabung lagi.');
        // Boleh bergabung di lobby, atau di masa jeda antar soal (termasuk saat dijeda host). Tidak boleh saat soal sedang dijawab.
        if (isRunning(room) && room.departed.has(key) && room.players.size < MAX_PLAYERS) {
          const back = reviveDeparted(room, key, socket.id, payload);
          if (back) {
            const taken = new Set(Array.from(room.players.values()).filter((x) => x !== back).map((x) => x.name.toLowerCase()));
            if (taken.has(back.name.toLowerCase())) back.name = `${back.name.slice(0, 36)} (2)`;
            socket.join(room.code);
            ctx = { code: room.code, clientKey: key };
            socket.emit('room:joined', { state: publicRoomState(room), sync: syncPayloadFor(room, back), you: back.id });
            broadcastRoom(io, room);
            return;
          }
        }
        if (room.status === 'in-game') return socket.emit('room:error', 'Soal sedang berjalan. Kamu bisa bergabung saat jeda antar soal.');
        if (room.players.size >= MAX_PLAYERS) return socket.emit('room:error', 'Ruangan sudah penuh.');
        if (room.visibility === 'global' && room.password) {
          if (cleanText(payload.password, 32) !== room.password) {
            return socket.emit('room:error', 'Password ruangan salah.');
          }
        }

        const p = newPlayer(key, socket.id, false, payload);
        p.userId = socket.data.userId;
        const taken = new Set(Array.from(room.players.values()).map((x) => x.name.toLowerCase()));
        if (taken.has(p.name.toLowerCase())) {
          const base = p.name.slice(0, 36);
          let n = 2;
          while (taken.has(`${base} (${n})`.toLowerCase())) n++;
          p.name = `${base} (${n})`;
        }
        if (room.status === 'podium' || room.makeupActive) {
          p.late = true;
          p.participating = false;
        }
        room.players.set(key, p);
        socket.join(room.code);
        ctx = { code: room.code, clientKey: key };
        if (p.late) io.to(room.code).emit('room:notice', `${p.name} bergabung belakangan (sesi susulan).`);
        socket.emit('room:joined', { state: publicRoomState(room), sync: syncPayloadFor(room, p), you: p.id });
        broadcastRoom(io, room);
      }
    );

    socket.on('room:listGlobal', () => {
      if (!allow()) return;
      const list = Array.from(rooms.values())
        .filter((r) => r.visibility === 'global' && (r.status === 'lobby' || r.status === 'round-result' || r.status === 'podium'))
        .map((r) => ({
          code: r.code,
          deckTitle: r.deckTitle,
          playerCount: r.players.size,
          hasPassword: Boolean(r.password),
        }));
      socket.emit('room:globalList', list);
    });

    // Host mengubah aturan. Aturan ruangan hanya di lobby; peran host (ikut/pantau) juga boleh di layar akhir.
    socket.on('room:settings', (payload: { lockPlayers?: boolean; hostLeavePolicy?: LeavePolicy; hostObserver?: boolean }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id) return;
      const { room, me } = c;
      if (typeof payload?.hostObserver === 'boolean' && (room.status === 'lobby' || room.status === 'podium')) {
        me.observer = payload.hostObserver;
        me.participating = !me.observer;
      }
      if (room.status === 'lobby') {
        if (typeof payload?.lockPlayers === 'boolean') room.lockPlayers = payload.lockPlayers;
        if (payload?.hostLeavePolicy) room.hostLeavePolicy = cleanPolicy(payload.hostLeavePolicy);
      }
      broadcastRoom(io, room);
    });

    socket.on(
      'room:start',
      (payload: { questions: any[]; questionTimes?: number[]; wrongPenaltyPercent?: number }) => {
        if (!allow()) return;
        const c = getCtx();
        if (!c || c.room.hostId !== c.me.id) return;
        const room = c.room;
        if (room.status !== 'lobby' && room.status !== 'podium') return;

        const fromPodium = room.status === 'podium';
        const eligible = Array.from(room.players.values()).filter((x) => !x.observer && (!fromPodium || x.connected));
        if (c.me.observer ? eligible.length < 1 : eligible.length < 2) {
          return socket.emit('room:error', c.me.observer ? 'Butuh minimal 1 peserta untuk memulai.' : 'Butuh minimal 2 pemain untuk memulai.');
        }
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
        room.rematchRequests.clear();
        room.departed.clear();
        room.makeupActive = false;
        // Main lagi: pemain yang masih offline di layar akhir dilepas; semua yang tersisa jadi satu sesi.
        if (fromPodium) {
          for (const x of Array.from(room.players.values())) if (!x.connected && !x.isHost) room.players.delete(x.key);
        }
        for (const p of room.players.values()) {
          p.late = false;
          p.madeUp = false;
          p.participating = !p.observer;
          p.score = 0;
          p.streak = 0;
          p.hasAnsweredThisRound = false;
          p.lastAnswerStatus = undefined;
          p.lastPointsAwarded = undefined;
          p.answers = {};
        }
        // Soal dikirim TANPA kunci jawaban & penjelasan.
        emitStarted(io, room, false);
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
      if (p.observer || !p.participating) return;

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

    // Host melewati sisa jeda antar soal (juga berlaku saat sedang dijeda).
    socket.on('game:skipGap', () => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id) return;
      const room = c.room;
      if (room.status !== 'round-result') return;
      room.paused = false;
      room.pausedRemainingMs = null;
      advanceRound(io, room);
    });

    // Host mengeluarkan pemain: di lobby, di jeda antar soal, atau (pemain susulan saja) di layar akhir.
    socket.on('room:kick', (payload: { playerId: string; ban?: boolean }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id) return;
      const { room } = c;
      const target = Array.from(room.players.values()).find((x) => x.id === String(payload?.playerId ?? ''));
      if (!target || target.id === c.me.id) return;
      const okPhase = room.status === 'lobby' || room.status === 'round-result' || (room.status === 'podium' && target.late);
      if (!okPhase) {
        return socket.emit('room:error', 'Pemain hanya bisa dikeluarkan di lobby atau jeda antar soal. Di layar akhir hanya pemain susulan.');
      }
      const ban = Boolean(payload?.ban);
      if (ban) {
        room.banned.add(target.key);
        if (target.userId) room.bannedUsers.add(target.userId);
      }
      const sid = target.socketId;
      removePlayer(io, room, target, undefined, 'kicked');
      if (sid) io.sockets.sockets.get(sid)?.emit('room:kicked', { banned: ban });
      room.rematchRequests.delete(target.id);
      if (rooms.has(room.code)) broadcastRoom(io, room);
    });

    // Host pengawas boleh mencoba semua opsi untuk melihat jawaban benar + penjelasan (tanpa poin).
    socket.on('game:peek', (payload: { optionIndex: number }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || !c.me.observer || c.room.hostId !== c.me.id || !isRunning(c.room)) return;
      const q = c.room.questions[c.room.currentQIndex];
      const opt = Number(payload?.optionIndex);
      if (!q || !Number.isInteger(opt) || opt < 0 || opt >= q.options.length) return;
      socket.emit('game:peekResult', {
        currentQIndex: c.room.currentQIndex,
        optionIndex: opt,
        correctIndex: q.correctIndex,
        explanation: q.explanation || '',
      });
    });

    // Host mengakhiri permainan sekarang juga (saat soal berjalan atau jeda antar soal).
    socket.on('game:end', () => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id || !isRunning(c.room)) return;
      endGameNow(io, c.room, c.room.makeupActive ? 'Sesi susulan diakhiri host.' : 'Permainan diakhiri host.');
      broadcastRoom(io, c.room);
    });

    // Host menjalankan sesi susulan: hanya untuk pemain yang bergabung belakangan.
    socket.on('room:startMakeup', () => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.hostId !== c.me.id || c.room.status !== 'podium') return;
      const room = c.room;
      if (!room.questions.length) return;
      const cands = Array.from(room.players.values()).filter((x) => x.late && !x.madeUp && !x.observer && x.connected);
      if (!cands.length) return socket.emit('room:error', 'Belum ada pemain susulan yang siap (online).');
      room.makeupActive = true;
      room.rematchRequests.clear();
      room.endNotice = null;
      room.status = 'in-game';
      room.currentQIndex = 0;
      room.roundStartedAt = Date.now();
      room.roundEndsAt = Date.now() + roundSecForQuestion(room, 0) * 1000;
      room.roundResultEndsAt = null;
      room.paused = false;
      room.pausedRemainingMs = null;
      for (const x of room.players.values()) {
        x.participating = cands.includes(x);
        x.hasAnsweredThisRound = false;
        x.lastAnswerStatus = undefined;
        x.lastPointsAwarded = undefined;
        if (x.participating) {
          x.score = 0;
          x.streak = 0;
          x.answers = {};
        }
      }
      emitStarted(io, room, true);
      broadcastRoom(io, room);
    });

    // Pemain non-host meminta host mengulang permainan (layar akhir).
    socket.on('room:requestRematch', () => {
      if (!allow()) return;
      const c = getCtx();
      if (!c || c.room.status !== 'podium' || c.room.hostId === c.me.id) return;
      if (c.room.rematchRequests.has(c.me.id)) return;
      c.room.rematchRequests.add(c.me.id);
      broadcastRoom(io, c.room);
    });

    socket.on('room:reaction', (payload: { emoji: string }) => {
      if (!allow() || !allowReact()) return;
      const c = getCtx();
      if (!c || c.me.observer) return;
      const emoji = String(payload?.emoji ?? '');
      if (!ALLOWED_EMOJIS.has(emoji)) return;
      io.to(c.room.code).emit('room:reactionReceived', { playerId: c.me.id, playerName: c.me.name, emoji });
    });

    // Keluar dari permainan (tombol "Keluar").
    socket.on('room:leave', (payload?: { successorId?: string }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c) return socket.emit('room:left');
      const { room, me } = c;
      const held = isHeldIn(room, me);
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
        const held = isHeldIn(room, p);
        if (!held && (room.status !== 'podium' || p.isHost) && now - p.disconnectedAt > GRACE_MS) removePlayer(io, room, p, undefined, 'timeout');
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
    emitReveal(ioRef, room, 'game:roundEnded', {
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
