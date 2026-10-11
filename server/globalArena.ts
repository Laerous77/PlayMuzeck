// server/globalArena.ts
//
// ARENA GLOBAL — multiplayer publik tanpa kode ruangan, dengan EMPAT TINGKAT KESULITAN.
//
// Cara kerja:
//   - Pemain memilih tingkat (Mudah / Normal / Sulit / Ekstrem) lalu menekan "Gabung Arena Global"; server menempatkan
//     mereka ke kanal TINGKAT ITU yang masih punya tempat. Tidak ada kode, tidak ada host, tidak ada daftar ruangan.
//   - Aturan tiap tingkat (waktu per soal, jumlah soal, pengurangan skor, porsi soal komunitas) ada di
//     src/data/quiz/arenaDifficulty.ts; penyusunan soalnya di server/arenaMatch.ts. Server mengundi angka di dalam rentang
//     tingkat itu SETIAP permainan.
//   - Soal tiap permainan DICAMPUR dari dua kumpulan (bukan satu kuis utuh):
//       1. soal resmi Arena Global: deck PRESET ARENA, 12 tema x 20 soal yang diatur admin (server/arenaPresetRoutes.ts), dan
//       2. soal dari kuis Komunitas yang SUDAH DISETUJUI moderasi dan lolos validasi soal.
//     Deck bawaan Pusat Kuis (3 starter gratis maupun 12 deck berbayar) TIDAK PERNAH dipakai di Arena Global, supaya isi
//     deck berbayar tidak bisa dimainkan gratis lewat arena. Klien tidak pernah mengirim soal, jadi skor tidak bisa
//     dipalsukan lewat soal buatan sendiri.
//   - Dalam satu permainan tidak ada soal yang sama (peluang 0%): soal kembar dibuang sebelum diundi.
//   - Bila stok soal belum cukup (kurang dari ARENA_MIN_QUESTIONS), lobi menunggu dan server mencoba lagi berkala.
//   - Permainan berjalan terus dalam siklus:  LOBI (hitung mundur) -> SOAL -> JEDA (jawaban benar + papan skor) -> ... -> PODIUM -> LOBI.
//   - Tingkat Sulit & Ekstrem: jawaban SALAH mengurangi skor (skor tidak turun di bawah 0). Tidak menjawab sampai waktu
//     habis tidak dihukum. Tingkat Mudah & Normal tidak mengurangi skor.
//   - Pemain yang masuk saat permainan berjalan menonton dulu (tanpa kunci jawaban) dan ikut di permainan berikutnya.
//   - Saat permainan TUNTAS sampai soal terakhir, skor tiap akun yang ikut dari awal dicatat ke Papan Peringkat oleh server
//     (onFinished -> recordMultiplayerGame). Keluar di tengah permainan = skor tidak dicatat.
//
// Keamanan (sama seperti multiplayerSocket.ts): kunci jawaban tidak dikirim bersama soal; `clientId` rahasia & tidak disiarkan;
// email pembuat soal komunitas tidak pernah dikirim ke klien; batas laju per socket; nama/avatar divalidasi; emoji dibatasi daftar putih.
import type { Server, Socket } from 'socket.io';
import { randomBytes } from 'crypto';
import { ruleScan } from './quizModeration';
import { isBadName } from './nameFilter';
import { ARENA_THEME_IDS } from '../src/data/quiz/arenaThemes';
import {
  ARENA_DIFFICULTIES,
  ARENA_DIFFICULTY_IDS,
  arenaNegativeScoring,
  mixDeckId,
  parseArenaDifficulty,
  type ArenaDifficulty,
} from '../src/data/quiz/arenaDifficulty';
import {
  ARENA_MIN_QUESTIONS,
  composeMatch,
  hasDuplicateQuestions,
  isPlayableQuestion,
  type ArenaQuestion,
  type ArenaQuestionPools,
  type ComposedMatch,
  type MatchQuestion,
} from './arenaMatch';

export { ARENA_MIN_QUESTIONS };
export type { ArenaQuestion, ArenaQuestionPools, ComposedMatch, MatchQuestion };

/* ───────────────────────────── Pengaturan ───────────────────────────── */

export const ARENA_LOBBY_SEC = 20;
export const ARENA_GAP_SEC = 6;
export const ARENA_PODIUM_SEC = 15;
export const ARENA_CAPACITY = 60;
/** Batas kanal per tingkat (4 tingkat, jadi total paling banyak 4 x ini). */
export const MAX_CHANNELS_PER_DIFFICULTY = 6;
const ALL_ANSWERED_GRACE_MS = 3000;
/** Pemain offline dipertahankan segini lama supaya bisa kembali setelah refresh. */
const GRACE_MS = 45_000;
const BASE_POINTS = 100;
const MIN_POINTS_PERCENT = 0.3;
/** Jeda sebelum server mencari soal lagi saat stok belum cukup. */
const NO_DECK_RETRY_MS = 10_000;
/** Id kuis Komunitas yang sah: deck-custom-shared-shq_<12 hex>. */
const COMMUNITY_DECK_ID_RE = /^deck-custom-shared-shq_[0-9a-f]{12}$/;
/** Id deck preset Arena yang sah: arena-preset-<id tema> (hanya 12 tema resmi). Id deck bawaan/starter ditolak. */
const PRESET_DECK_ID_RE = new RegExp(`^arena-preset-(?:${ARENA_THEME_IDS.join('|')})$`);
const EMPTY_CHANNEL_MS = 10 * 60_000;
const ALLOWED_EMOJIS = new Set(['🔥', '👏', '😂', '😭', '😮', '😞', '😡', '💀', '❤️']);

/* ───────────────────────────── Tipe ───────────────────────────── */

export interface ArenaDeck {
  /** Id deck: "deck-custom-shared-shq_xxx" (kuis Komunitas) atau "arena-preset-<tema>" (deck preset admin). */
  deckId: string;
  title: string;
  /** Sumber soal Arena Global hanyalah kuis Komunitas yang disetujui dan deck preset Arena buatan admin. */
  source: 'community' | 'preset';
  /** Pembuat kuis komunitas (tampil di layar). Kosong untuk deck preset. */
  ownerName?: string;
  questions: ArenaQuestion[];
}

export interface ArenaOutcome {
  counted: boolean;
  points?: number;
  message?: string;
}

export interface ArenaFinishedGame {
  /** Id campuran per tingkat: "arena-mix-<tingkat>" (lihat mixDeckId). */
  deckId: string;
  deckTitle: string;
  difficulty: ArenaDifficulty;
  questions: unknown[];
  players: { userId: string; correct: number }[];
  /** Email pembuat soal komunitas yang ikut di permainan ini: mereka tidak mendapat poin peringkat (tahu jawabannya). */
  ownerEmails: string[];
}

export interface ArenaDeps {
  /** Ambil kumpulan soal saat ini: soal resmi (deck preset aktif) + soal kuis Komunitas yang disetujui. */
  loadQuestionPools?: () => Promise<ArenaQuestionPools>;
  /** Dipanggil saat permainan tuntas; hasilnya (per userId) dikirim ke pemain di layar podium. */
  onFinished?: (game: ArenaFinishedGame) => Promise<Record<string, ArenaOutcome> | void>;
}

type Phase = 'lobby' | 'question' | 'reveal' | 'podium';

interface ArenaPlayer {
  /** clientId RAHASIA dari browser. */
  key: string;
  /** ID publik acak. */
  id: string;
  socketId: string | null;
  connected: boolean;
  disconnectedAt: number | null;
  joinedAt: number;
  name: string;
  avatarUrl: string;
  frameId: string;
  /** ID akun (rahasia) bila login. */
  userId?: string;
  score: number;
  streak: number;
  /** Ikut permainan yang sedang berjalan (masuk saat lobi / sebelum soal pertama). */
  participating: boolean;
  hasAnswered: boolean;
  lastStatus?: 'correct' | 'wrong';
  lastPoints?: number;
  answers: Record<number, number>;
}

interface Channel {
  id: string;
  label: string;
  difficulty: ArenaDifficulty;
  phase: Phase;
  players: Map<string, ArenaPlayer>;
  /** Permainan yang sudah disusun untuk giliran berikutnya / yang sedang berjalan. */
  match: ComposedMatch | null;
  questions: MatchQuestion[];
  currentQIndex: number;
  roundStartedAt: number | null;
  phaseEndsAt: number | null;
  emptySince: number | null;
  /** Mencegah dua penyusunan permainan bersamaan. */
  preparing: boolean;
  /** Stok soal belum cukup; server mencoba lagi pada `deckRetryAt`. */
  noDeck: boolean;
  deckRetryAt: number | null;
  gameNo: number;
}

/* ───────────────────────────── Util ───────────────────────────── */

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const cleanClientId = (v: unknown): string | null => (/^[A-Za-z0-9_-]{8,64}$/.test(String(v ?? '')) ? String(v) : null);
const cleanText = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max);
/** Nama tampilan di ruang publik: yang memuat kata kasar / SARA / seksual diganti \"Pemain\" (memakai pemindai aturan yang sama dengan moderasi kuis). */
export function safeDisplayName(raw: unknown): string {
  const name = cleanText(raw, 40) || 'Pemain';
  // Filter khusus nama (leetspeak, huruf dipisah, kata kasar sehari-hari) — lihat nameFilter.ts.
  if (isBadName(name)) return 'Pemain';
  try {
    const report = ruleScan({ title: name, description: '', questions: [] });
    if (report.flags.some((f) => f.severity !== 'low')) return 'Pemain';
  } catch {
    /* pemindai gagal: pakai nama apa adanya (sudah dibersihkan dari karakter berbahaya) */
  }
  return name;
}

function cleanAvatar(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s || s.length > 500) return '';
  return /^(https?:\/\/|\/(?!\/))/i.test(s) ? s : '';
}

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

/** Buang field yang membocorkan jawaban atau identitas pembuat soal. */
function publicQuestion(q: MatchQuestion) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(q)) {
    if (/correct|answer|explan|kunci|jawaban|penjelasan/i.test(k)) continue;
    if (k === 'ownerEmail') continue;
    out[k] = (q as any)[k];
  }
  return out;
}

/**
 * Deck yang sah sebagai SUMBER soal Arena Global: kuis Komunitas (id shq_...) ATAU deck preset Arena (id arena-preset-<tema>),
 * dengan cukup soal yang layak. Id dan sumber harus cocok; deck bawaan/starter selalu ditolak.
 */
export function isArenaEligibleDeck(d: ArenaDeck | null | undefined): d is ArenaDeck {
  return Boolean(
    d &&
      ((d.source === 'community' && COMMUNITY_DECK_ID_RE.test(String(d.deckId))) ||
        (d.source === 'preset' && PRESET_DECK_ID_RE.test(String(d.deckId)))) &&
      Array.isArray(d.questions) &&
      d.questions.filter(isPlayableQuestion).length >= ARENA_MIN_QUESTIONS
  );
}

/** Poin jawaban benar: turun linear dari 100% ke MIN_POINTS_PERCENT sepanjang waktu soal. */
export function arenaPoints(elapsedRatio: number): number {
  const r = clamp(elapsedRatio, 0, 1);
  return clamp(Math.round(BASE_POINTS * (1 - (1 - MIN_POINTS_PERCENT) * r)), Math.round(BASE_POINTS * MIN_POINTS_PERCENT), BASE_POINTS);
}

/**
 * Skor setelah jawaban salah: dikurangi `penalty`, tetapi tidak pernah di bawah 0.
 * Mengembalikan skor baru dan selisih yang benar-benar berlaku (<= 0).
 */
export function applyWrongAnswer(score: number, penalty: number): { score: number; delta: number } {
  const cut = Math.min(Math.max(0, penalty), Math.max(0, score));
  return { score: score - cut, delta: cut ? -cut : 0 };
}

/* ───────────────────────────── Status publik ───────────────────────────── */

const channels = new Map<string, Channel>();
let channelSeq = 0;

/** Ringkasan aturan permainan yang sudah disusun (aman dikirim ke klien: tidak memuat soal maupun kunci). */
function matchInfoOf(m: ComposedMatch | null) {
  if (!m) return null;
  return {
    questions: m.questions.length,
    secPerQuestion: m.secPerQuestion,
    penalty: m.penalty,
    negativeScoring: m.penalty > 0,
    officialQuestions: m.officialQuestions,
    communityQuestions: m.communityQuestions,
  };
}

const matchTitle = (d: ArenaDifficulty) => `Arena Global · ${ARENA_DIFFICULTIES[d].label}`;

function publicState(ch: Channel) {
  const list = Array.from(ch.players.values());
  return {
    channel: ch.label,
    difficulty: ch.difficulty,
    difficultyLabel: ARENA_DIFFICULTIES[ch.difficulty].label,
    negativeScoring: arenaNegativeScoring(ch.difficulty),
    phase: ch.phase,
    deckTitle: ch.match ? matchTitle(ch.difficulty) : '',
    /** Soal tiap permainan dicampur dari soal resmi Arena dan soal kuis Komunitas. */
    deckSource: ch.match ? ('mixed' as const) : null,
    ownerName: '',
    matchInfo: matchInfoOf(ch.match),
    /** Lobi menunggu karena stok soal belum cukup (Komunitas kosong dan belum cukup deck preset aktif). */
    waitingForQuiz: ch.phase === 'lobby' && !ch.match && ch.noDeck,
    currentQIndex: ch.currentQIndex,
    totalQuestions: ch.questions.length,
    phaseEndsAt: ch.phaseEndsAt,
    capacity: ARENA_CAPACITY,
    playersOnline: list.filter((p) => p.connected).length,
    players: list.map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      frameId: p.frameId,
      connected: p.connected,
      score: p.score,
      streak: p.streak,
      participating: p.participating,
      answered: ch.phase === 'question' && p.hasAnswered,
      lastAnswerStatus: p.lastStatus,
      lastPointsAwarded: p.lastPoints,
      loggedIn: Boolean(p.userId),
    })),
  };
}

/** Ringkasan untuk kartu "Arena Global" di Pusat Kuis (tanpa socket). */
export function getArenaSummary() {
  const list = Array.from(channels.values());
  const online = list.reduce((s, c) => s + Array.from(c.players.values()).filter((p) => p.connected).length, 0);
  const best = [...list].sort((a, b) => b.players.size - a.players.size)[0];
  const byDifficulty = Object.fromEntries(
    ARENA_DIFFICULTY_IDS.map((id) => {
      const mine = list.filter((c) => c.difficulty === id);
      return [id, { playersOnline: mine.reduce((s, c) => s + Array.from(c.players.values()).filter((p) => p.connected).length, 0), channels: mine.length }];
    })
  ) as Record<ArenaDifficulty, { playersOnline: number; channels: number }>;
  return {
    playersOnline: online,
    channels: list.length,
    phase: best?.phase ?? 'lobby',
    deckTitle: best?.match ? matchTitle(best.difficulty) : '',
    phaseEndsAt: best?.phaseEndsAt ?? null,
    byDifficulty,
  };
}

function revealOf(ch: Channel, idx: number) {
  const q = ch.questions[idx];
  return q ? { correctIndex: q.correctIndex, explanation: q.explanation || '' } : null;
}

/** Data untuk memulihkan layar pemain yang baru masuk / tersambung kembali. */
function syncFor(ch: Channel, p: ArenaPlayer) {
  const running = ch.phase === 'question' || ch.phase === 'reveal';
  const revealed: Record<number, { correctIndex: number; explanation: string }> = {};
  // Pemain yang tidak ikut hanya boleh melihat jawaban soal yang sudah selesai (sama seperti peserta).
  const lastOpen = ch.phase === 'podium' ? ch.questions.length - 1 : ch.phase === 'reveal' ? ch.currentQIndex : ch.currentQIndex - 1;
  if (ch.phase !== 'lobby') {
    for (let i = 0; i <= lastOpen; i++) {
      const r = revealOf(ch, i);
      if (r) revealed[i] = r;
    }
  }
  const q = ch.questions[ch.currentQIndex];
  const mine =
    p.participating && p.hasAnswered && q && (ch.phase === 'question' || ch.phase === 'reveal')
      ? { isCorrect: p.lastStatus === 'correct', pointsAwarded: p.lastPoints ?? 0, correctIndex: q.correctIndex, explanation: q.explanation || '' }
      : null;
  return {
    questions: running || ch.phase === 'podium' ? ch.questions.map(publicQuestion) : [],
    currentQIndex: ch.currentQIndex,
    myAnswers: p.answers,
    revealed,
    myResult: mine,
    roundResult: ch.phase === 'reveal' ? revealOf(ch, ch.currentQIndex) : null,
  };
}

/* ───────────────────────────── Server ───────────────────────────── */

export function attachGlobalArena(io: Server, deps: ArenaDeps = {}) {
  const room = (ch: Channel) => `arena:${ch.id}`;
  const broadcast = (ch: Channel) => io.to(room(ch)).emit('arena:update', publicState(ch));
  const toPlayer = (p: ArenaPlayer, event: string, payload: unknown) => {
    if (p.socketId) io.to(p.socketId).emit(event, payload);
  };

  const channelOf = (key: string) => {
    for (const ch of channels.values()) if (ch.players.has(key)) return ch;
    return undefined;
  };

  const channelSeqByDifficulty: Record<ArenaDifficulty, number> = { easy: 0, normal: 0, hard: 0, extreme: 0 };

  function newChannel(difficulty: ArenaDifficulty): Channel | null {
    const sameLevel = Array.from(channels.values()).filter((c) => c.difficulty === difficulty).length;
    if (sameLevel >= MAX_CHANNELS_PER_DIFFICULTY) return null;
    channelSeq += 1;
    channelSeqByDifficulty[difficulty] += 1;
    const ch: Channel = {
      id: `g${channelSeq}`,
      label: `${ARENA_DIFFICULTIES[difficulty].label} ${channelSeqByDifficulty[difficulty]}`,
      difficulty,
      phase: 'lobby',
      players: new Map(),
      match: null,
      questions: [],
      currentQIndex: 0,
      roundStartedAt: null,
      phaseEndsAt: null,
      emptySince: null,
      preparing: false,
      noDeck: false,
      deckRetryAt: null,
      gameNo: 0,
    };
    channels.set(ch.id, ch);
    return ch;
  }

  /**
   * Kanal yang dituju pemain baru DI TINGKAT YANG DIPILIH: yang paling ramai dan belum penuh, supaya pemain bertemu satu
   * sama lain (peringkat butuh minimal 2 akun). Pemain yang masuk saat permainan berjalan menonton dulu. Kanal baru
   * hanya dibuat bila semua kanal tingkat itu penuh.
   */
  function assignChannel(difficulty: ArenaDifficulty): Channel | null {
    const open = Array.from(channels.values())
      .filter((c) => c.difficulty === difficulty && c.players.size < ARENA_CAPACITY)
      .sort((a, b) => b.players.size - a.players.size || (a.phase === 'lobby' ? -1 : 0) - (b.phase === 'lobby' ? -1 : 0));
    return open[0] ?? newChannel(difficulty);
  }

  /**
   * Susun permainan berikutnya untuk kanal ini dari kumpulan soal (resmi + komunitas). Deck bawaan (starter gratis & berbayar)
   * tidak pernah dipakai. Null bila stok soal belum cukup.
   */
  async function chooseMatch(ch: Channel): Promise<ComposedMatch | null> {
    if (!deps.loadQuestionPools) return null;
    try {
      const pools = await deps.loadQuestionPools();
      const match = composeMatch(pools, ch.difficulty);
      // Sabuk pengaman: tidak boleh ada soal kembar dalam satu permainan.
      if (!match || match.questions.length < ARENA_MIN_QUESTIONS || hasDuplicateQuestions(match.questions)) return null;
      return match;
    } catch (e: any) {
      console.error('[arena] gagal menyusun permainan arena:', e?.message || e);
      return null;
    }
  }

  /** Susun permainan untuk lobi ini lalu mulai hitung mundur. Bila stok belum cukup, coba lagi setelah NO_DECK_RETRY_MS. */
  async function prepareDeck(ch: Channel) {
    if (ch.preparing) return;
    ch.preparing = true;
    try {
      const match = await chooseMatch(ch);
      // Kanal bisa sudah ditutup atau berpindah fase selagi menunggu.
      if (!channels.has(ch.id) || ch.phase !== 'lobby') return;
      ch.match = match;
      if (match) {
        ch.noDeck = false;
        ch.deckRetryAt = null;
        ch.phaseEndsAt = Date.now() + ARENA_LOBBY_SEC * 1000;
      } else {
        ch.noDeck = true;
        ch.deckRetryAt = Date.now() + NO_DECK_RETRY_MS;
        ch.phaseEndsAt = null;
      }
      broadcast(ch);
    } finally {
      ch.preparing = false;
    }
  }

  /** Masuk lobi: bersihkan sisa permainan lalu susun permainan berikutnya. */
  async function enterLobby(ch: Channel) {
    if (ch.preparing) return;
    ch.phase = 'lobby';
    ch.questions = [];
    ch.currentQIndex = 0;
    ch.roundStartedAt = null;
    ch.phaseEndsAt = null;
    ch.match = null;
    ch.noDeck = false;
    ch.deckRetryAt = null;
    for (const p of ch.players.values()) {
      p.score = 0;
      p.streak = 0;
      p.hasAnswered = false;
      p.lastStatus = undefined;
      p.lastPoints = undefined;
      p.answers = {};
      p.participating = false;
    }
    // Pemain yang offline sejak permainan lalu dilepas.
    for (const p of Array.from(ch.players.values())) if (!p.connected) ch.players.delete(p.key);
    broadcast(ch);
    await prepareDeck(ch);
  }

  function startGame(ch: Channel) {
    const match = ch.match;
    if (!match || match.questions.length < ARENA_MIN_QUESTIONS) {
      ch.match = null;
      return void prepareDeck(ch);
    }
    const players = Array.from(ch.players.values()).filter((p) => p.connected);
    if (!players.length) {
      // Belum ada peserta: ulangi hitung mundur lobi.
      ch.phaseEndsAt = Date.now() + ARENA_LOBBY_SEC * 1000;
      return void broadcast(ch);
    }
    ch.gameNo += 1;
    ch.questions = match.questions;
    ch.currentQIndex = 0;
    for (const p of ch.players.values()) {
      p.participating = p.connected;
      p.score = 0;
      p.streak = 0;
      p.answers = {};
      p.hasAnswered = false;
      p.lastStatus = undefined;
      p.lastPoints = undefined;
    }
    beginQuestion(ch, 0, true);
  }

  function beginQuestion(ch: Channel, idx: number, first = false) {
    ch.phase = 'question';
    ch.currentQIndex = idx;
    ch.roundStartedAt = Date.now();
    ch.phaseEndsAt = Date.now() + (ch.match?.secPerQuestion ?? 20) * 1000;
    for (const p of ch.players.values()) {
      p.hasAnswered = false;
      p.lastStatus = undefined;
      p.lastPoints = undefined;
    }
    if (first) {
      const questions = ch.questions.map(publicQuestion);
      for (const p of ch.players.values()) {
        toPlayer(p, 'arena:started', {
          questions,
          currentQIndex: 0,
          participating: p.participating,
          deckTitle: ch.match ? matchTitle(ch.difficulty) : '',
          difficulty: ch.difficulty,
          matchInfo: matchInfoOf(ch.match),
        });
      }
    } else {
      io.to(room(ch)).emit('arena:nextRound', { currentQIndex: idx });
    }
    broadcast(ch);
  }

  function enterReveal(ch: Channel) {
    ch.phase = 'reveal';
    ch.phaseEndsAt = Date.now() + ARENA_GAP_SEC * 1000;
    const q = ch.questions[ch.currentQIndex];
    io.to(room(ch)).emit('arena:roundEnded', {
      currentQIndex: ch.currentQIndex,
      correctIndex: q?.correctIndex,
      explanation: q?.explanation || '',
      isLastQuestion: ch.currentQIndex >= ch.questions.length - 1,
    });
    broadcast(ch);
  }

  function endGame(ch: Channel) {
    ch.phase = 'podium';
    ch.phaseEndsAt = Date.now() + ARENA_PODIUM_SEC * 1000;
    const revealed: Record<number, { correctIndex: number; explanation: string }> = {};
    ch.questions.forEach((_, i) => {
      const r = revealOf(ch, i);
      if (r) revealed[i] = r;
    });
    io.to(room(ch)).emit('arena:ended', { state: publicState(ch), revealed });
    reportFinished(ch);
  }

  /** Skor akun yang ikut dari awal dan masih ada di kanal dicatat oleh server (jawaban dinilai server). */
  function reportFinished(ch: Channel) {
    if (!deps.onFinished || !ch.match) return;
    const players: ArenaFinishedGame['players'] = [];
    for (const p of ch.players.values()) {
      if (!p.userId || !p.participating) continue;
      let correct = 0;
      ch.questions.forEach((q, i) => {
        if (p.answers[i] !== undefined && p.answers[i] === q.correctIndex) correct++;
      });
      players.push({ userId: p.userId, correct });
    }
    if (!players.length) return;
    const ownerEmails = Array.from(new Set(ch.questions.map((q) => q.ownerEmail).filter((e): e is string => Boolean(e))));
    const game: ArenaFinishedGame = {
      deckId: mixDeckId(ch.difficulty),
      deckTitle: matchTitle(ch.difficulty),
      difficulty: ch.difficulty,
      questions: ch.questions,
      players,
      ownerEmails,
    };
    void deps
      .onFinished(game)
      .then((outcomes) => {
        if (!outcomes) return;
        for (const p of ch.players.values()) {
          const o = p.userId ? outcomes[p.userId] : undefined;
          if (o) toPlayer(p, 'arena:leaderboard', o);
        }
      })
      .catch((e) => console.error('[arena] gagal mencatat skor peringkat:', e?.message || e));
  }

  function trimIfAllAnswered(ch: Channel) {
    if (ch.phase !== 'question' || !ch.phaseEndsAt) return;
    const active = Array.from(ch.players.values()).filter((p) => p.participating && p.connected);
    if (!active.length || !active.every((p) => p.hasAnswered)) return;
    const target = Date.now() + ALL_ANSWERED_GRACE_MS;
    if (ch.phaseEndsAt > target) {
      ch.phaseEndsAt = target;
      broadcast(ch);
    }
  }

  /* ───────── Koneksi ───────── */

  io.on('connection', (socket: Socket) => {
    let ctx: { channelId: string; key: string } | null = null;
    const allow = makeLimiter(40, 5_000);
    const allowJoin = makeLimiter(8, 10_000);
    const allowReact = makeLimiter(6, 3_000);

    const getCtx = () => {
      if (!ctx) return null;
      const ch = channels.get(ctx.channelId);
      const me = ch?.players.get(ctx.key);
      if (!ch || !me) return null;
      if (!me.userId && socket.data.userId) me.userId = socket.data.userId;
      return { ch, me };
    };

    const attach = (ch: Channel, p: ArenaPlayer) => {
      if (p.socketId && p.socketId !== socket.id) {
        const old = io.sockets.sockets.get(p.socketId);
        old?.emit('arena:replaced');
        old?.leave(room(ch));
      }
      p.socketId = socket.id;
      p.connected = true;
      p.disconnectedAt = null;
      if (!p.userId && socket.data.userId) p.userId = socket.data.userId;
      socket.join(room(ch));
      ctx = { channelId: ch.id, key: p.key };
      ch.emptySince = null;
      socket.emit('arena:joined', { state: publicState(ch), sync: syncFor(ch, p), you: p.id });
      broadcast(ch);
    };

    socket.on('arena:join', (payload: { clientId?: string; name?: string; avatarUrl?: string; frameId?: string; difficulty?: string }) => {
      if (!allow() || !allowJoin()) return void socket.emit('arena:error', 'Terlalu banyak percobaan. Coba lagi sebentar.');
      const key = cleanClientId(payload?.clientId);
      if (!key) return void socket.emit('arena:error', 'Identitas pemain tidak valid. Muat ulang halaman.');

      // Sudah terdaftar (refresh / tab baru): pulihkan, bukan gabung baru.
      const existing = channelOf(key);
      if (existing) {
        const p = existing.players.get(key)!;
        // Pembaruan nama/foto hanya di lobi supaya identitas tidak berubah di tengah permainan.
        if (existing.phase === 'lobby') {
          p.name = payload?.name ? safeDisplayName(payload.name) : p.name;
          p.avatarUrl = cleanAvatar(payload?.avatarUrl);
          p.frameId = cleanText(payload?.frameId, 40) || 'none';
        }
        return void attach(existing, p);
      }

      const difficulty = parseArenaDifficulty(payload?.difficulty);
      if (!difficulty) return void socket.emit('arena:error', 'Tingkat kesulitan tidak dikenal.');
      const ch = assignChannel(difficulty);
      if (!ch) return void socket.emit('arena:error', `Arena Global tingkat ${ARENA_DIFFICULTIES[difficulty].label} sedang penuh. Coba lagi beberapa saat atau pilih tingkat lain.`);

      const taken = new Set(Array.from(ch.players.values()).map((x) => x.name.toLowerCase()));
      let name = safeDisplayName(payload?.name);
      if (taken.has(name.toLowerCase())) {
        const base = name.slice(0, 36);
        let n = 2;
        while (taken.has(`${base} (${n})`.toLowerCase())) n++;
        name = `${base} (${n})`;
      }
      const p: ArenaPlayer = {
        key,
        id: 'p' + randomBytes(6).toString('hex'),
        socketId: null,
        connected: true,
        disconnectedAt: null,
        joinedAt: Date.now(),
        name,
        avatarUrl: cleanAvatar(payload?.avatarUrl),
        frameId: cleanText(payload?.frameId, 40) || 'none',
        userId: socket.data.userId,
        score: 0,
        streak: 0,
        // Masuk saat lobi = ikut permainan berikutnya; masuk saat berjalan = menonton dulu.
        participating: false,
        hasAnswered: false,
        answers: {},
      };
      ch.players.set(key, p);
      // Kanal kosong yang baru dibuat / baru dihuni: mulai mencari kuis (menghormati jeda coba-ulang).
      if (ch.phase === 'lobby' && !ch.match && !ch.preparing && (!ch.deckRetryAt || Date.now() >= ch.deckRetryAt)) void prepareDeck(ch);
      attach(ch, p);
    });

    // Klien memanggil ini tiap tersambung; bila belum terdaftar, tidak terjadi apa-apa (pemain memilih sendiri untuk bergabung).
    socket.on('arena:rejoin', (payload: { clientId?: string }) => {
      if (!allow()) return;
      const key = cleanClientId(payload?.clientId);
      if (!key) return;
      const ch = channelOf(key);
      if (!ch) return void socket.emit('arena:resumeFailed');
      attach(ch, ch.players.get(key)!);
    });

    socket.on('arena:answer', (payload: { optionIndex: number }) => {
      if (!allow()) return;
      const c = getCtx();
      if (!c) return;
      const { ch, me } = c;
      if (ch.phase !== 'question' || !ch.roundStartedAt || !ch.phaseEndsAt) return;
      if (Date.now() >= ch.phaseEndsAt || me.hasAnswered || !me.participating) return;
      const q = ch.questions[ch.currentQIndex];
      const opt = Number(payload?.optionIndex);
      if (!q || !Number.isInteger(opt) || opt < 0 || opt >= q.options.length) return;
      me.hasAnswered = true;
      me.answers[ch.currentQIndex] = opt;
      const isCorrect = opt === q.correctIndex;
      if (isCorrect) {
        const total = ch.phaseEndsAt - ch.roundStartedAt;
        const pts = arenaPoints(total > 0 ? (Date.now() - ch.roundStartedAt) / total : 1);
        me.score += pts;
        me.streak += 1;
        me.lastStatus = 'correct';
        me.lastPoints = pts;
      } else {
        // Sulit & Ekstrem: jawaban salah mengurangi skor (tidak di bawah 0). Mudah & Normal: penalti 0.
        const cut = applyWrongAnswer(me.score, ch.match?.penalty ?? 0);
        me.score = cut.score;
        me.streak = 0;
        me.lastStatus = 'wrong';
        me.lastPoints = cut.delta;
      }
      socket.emit('arena:answerResult', {
        currentQIndex: ch.currentQIndex,
        isCorrect,
        pointsAwarded: me.lastPoints,
        correctIndex: q.correctIndex,
        explanation: q.explanation || '',
      });
      broadcast(ch);
      trimIfAllAnswered(ch);
    });

    socket.on('arena:reaction', (payload: { emoji: string }) => {
      if (!allow() || !allowReact()) return;
      const c = getCtx();
      if (!c) return;
      const emoji = String(payload?.emoji ?? '');
      if (!ALLOWED_EMOJIS.has(emoji)) return;
      io.to(room(c.ch)).emit('arena:reactionReceived', { playerId: c.me.id, playerName: c.me.name, emoji });
    });

    socket.on('arena:leave', () => {
      if (!allow()) return;
      const c = getCtx();
      ctx = null;
      socket.emit('arena:left');
      if (!c) return;
      socket.leave(room(c.ch));
      c.ch.players.delete(c.me.key);
      afterLeave(c.ch);
    });

    socket.on('disconnect', () => {
      const c = getCtx();
      if (!c || c.me.socketId !== socket.id) return;
      c.me.connected = false;
      c.me.socketId = null;
      c.me.disconnectedAt = Date.now();
      broadcast(c.ch);
    });
  });

  /** Setelah pemain keluar: bila kanal kosong, hentikan permainan; kanal tambahan dihapus. */
  function afterLeave(ch: Channel) {
    const online = Array.from(ch.players.values()).some((p) => p.connected);
    if (!ch.players.size || !online) {
      if (ch.phase === 'question' || ch.phase === 'reveal') {
        // Tidak ada yang menonton: akhiri tanpa mencatat skor dan kembali ke lobi saat ada yang masuk lagi.
        ch.phase = 'lobby';
        ch.match = null;
        ch.noDeck = false;
        ch.deckRetryAt = null;
        ch.questions = [];
        ch.phaseEndsAt = null;
        ch.roundStartedAt = null;
      }
      ch.emptySince = ch.emptySince ?? Date.now();
    }
    broadcast(ch);
  }

  /* ───────── Putaran waktu ───────── */

  const timer = setInterval(() => {
    const now = Date.now();
    for (const ch of Array.from(channels.values())) {
      // Bersihkan pemain offline terlalu lama & kanal kosong.
      for (const p of Array.from(ch.players.values())) {
        if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > GRACE_MS) {
          ch.players.delete(p.key);
          afterLeave(ch);
        }
      }
      const online = Array.from(ch.players.values()).some((p) => p.connected);
      if (!online) {
        ch.emptySince = ch.emptySince ?? now;
        // Tiap tingkat menyisakan minimal satu kanal.
        const sameLevel = Array.from(channels.values()).filter((c) => c.difficulty === ch.difficulty).length;
        if (now - ch.emptySince > EMPTY_CHANNEL_MS && sameLevel > 1) {
          channels.delete(ch.id);
          continue;
        }
        // Tanpa penonton siklus dibekukan (tidak membuang sumber daya).
        continue;
      }
      ch.emptySince = null;

      switch (ch.phase) {
        case 'lobby':
          if (ch.preparing) break;
          if (!ch.match) {
            // Stok soal belum cukup: cari lagi secara berkala (bukan tiap 250 ms) supaya database tidak dibebani.
            if (!ch.deckRetryAt || now >= ch.deckRetryAt) void prepareDeck(ch);
          } else if (ch.phaseEndsAt && now >= ch.phaseEndsAt) startGame(ch);
          break;
        case 'question':
          trimIfAllAnswered(ch);
          if (ch.phaseEndsAt && now >= ch.phaseEndsAt) enterReveal(ch);
          break;
        case 'reveal':
          if (ch.phaseEndsAt && now >= ch.phaseEndsAt) {
            if (ch.currentQIndex >= ch.questions.length - 1) endGame(ch);
            else beginQuestion(ch, ch.currentQIndex + 1);
          }
          break;
        case 'podium':
          if (ch.phaseEndsAt && now >= ch.phaseEndsAt) void enterLobby(ch);
          break;
      }
    }
  }, 250);
  timer.unref?.();

  return { getSummary: getArenaSummary };
}
