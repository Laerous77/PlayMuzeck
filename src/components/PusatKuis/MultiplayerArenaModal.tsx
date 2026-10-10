// src/components/PusatKuis/MultiplayerArenaModal.tsx
//
// ARENA GLOBAL — multiplayer publik TANPA kode ruangan (server/globalArena.ts).
//
// Pemain cukup menekan "Gabung Arena Global". Server menempatkan pemain di kanal yang masih punya tempat, memilih
// kuisnya (deck bawaan / starter, atau kuis Komunitas yang SUDAH DISETUJUI), mengacak soalnya, dan menjalankan
// siklus:  LOBI (hitung mundur) -> SOAL -> JEDA (jawaban benar + papan skor) -> ... -> PODIUM -> LOBI berikutnya.
// Tidak ada host, tidak ada kode, tidak ada daftar ruangan, dan klien tidak pernah mengirim soal.
//
// Pemain yang masuk saat permainan berjalan menonton dulu (tanpa kunci jawaban) dan ikut di permainan berikutnya.
// Skor akun login dicatat server ke Papan Peringkat saat permainan tuntas sampai soal terakhir.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Users, WifiOff, Crown, Loader2, Lightbulb, Globe, LogOut, Eye, Save, Check, Timer, Flame, ShieldCheck } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { PlayerAvatar } from './PlayerAvatar';
import { addSavedResult, type AnswerLogEntry, type SavedQuizResult } from '../../services/quizResultsStore';
import { audioEngine } from '../../services/audioEngine';
import { storage } from '../../services/storage';
import type { QuizQuestion } from '../../types';

interface MultiplayerArenaModalProps {
  isOpen: boolean;
  onClose: () => void;
  isOnline: boolean;
  userNickname: string;
  /** Foto profil & bingkai milik pemain saat ini, supaya pemain lain melihat identitas asli. */
  userAvatarUrl?: string;
  userFrameId?: string;
}

/* ───────────────────────────── Tipe data dari server ───────────────────────────── */

type Phase = 'lobby' | 'question' | 'reveal' | 'podium';

interface ArenaPlayer {
  id: string;
  name: string;
  avatarUrl: string;
  frameId: string;
  connected: boolean;
  score: number;
  streak: number;
  /** Ikut permainan yang sedang berjalan (false = menonton dulu). */
  participating: boolean;
  answered: boolean;
  lastAnswerStatus?: 'correct' | 'wrong';
  lastPointsAwarded?: number;
  loggedIn: boolean;
}

interface ArenaState {
  channel: string;
  phase: Phase;
  deckTitle: string;
  deckSource: 'builtin' | 'community' | null;
  ownerName: string;
  currentQIndex: number;
  totalQuestions: number;
  phaseEndsAt: number | null;
  capacity: number;
  playersOnline: number;
  players: ArenaPlayer[];
}

interface Reveal {
  correctIndex: number;
  explanation: string;
}

interface MyResult extends Reveal {
  isCorrect: boolean;
  pointsAwarded: number;
}

interface LeaderboardOutcome {
  counted: boolean;
  points?: number;
  message?: string;
}

interface ArenaSync {
  questions?: QuizQuestion[];
  currentQIndex?: number;
  myAnswers?: Record<number, number>;
  revealed?: Record<number, Reveal>;
  myResult?: MyResult | null;
  roundResult?: Reveal | null;
}

/* ───────────────────────────── Pembantu ───────────────────────────── */

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : '';

/** Urutan sama dengan daftar putih emoji di server. */
const REACTION_EMOJIS = ['🔥', '👏', '😂', '😭', '😮', '😞', '😡', '💀', '❤️'];

/** ID stabil per browser: server memakainya untuk mengenali pemain yang kembali setelah refresh / tutup tab. */
const CLIENT_ID_KEY = 'muzeck_mp_client_id';
const randomHex = () => {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
};
const getClientId = (): string => {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      id = randomHex();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage tidak tersedia: ID sementara (tidak bisa dipulihkan setelah refresh).
    return randomHex();
  }
};

const isRunning = (p: Phase) => p === 'question' || p === 'reveal';

/** Papan skor dipakai di layar jeda & podium. */
const Scoreboard: React.FC<{ players: ArenaPlayer[]; myId: string; limit?: number }> = ({ players, myId, limit }) => {
  const list = limit ? players.slice(0, limit) : players;
  const meIdx = players.findIndex((p) => p.id === myId);
  const showMeBelow = Boolean(limit) && meIdx >= (limit ?? 0);
  const row = (p: ArenaPlayer, rank: number) => (
    <div
      key={p.id}
      className={`flex items-center justify-between p-3 rounded-xl border ${
        rank === 0 ? 'bg-accent/10 border-accent/40' : p.id === myId ? 'bg-accent2/10 border-accent2/30' : 'bg-black/40 border-white/[0.08]'
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        {rank === 0 ? <Crown className="w-4 h-4 text-accent shrink-0" /> : <span className="text-xs font-mono font-bold text-gray-400 w-4 text-center shrink-0">{rank + 1}</span>}
        <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} frameId={p.frameId} size="sm" />
        <span className="text-sm font-bold text-white truncate">
          {p.name}
          {p.id === myId && <span className="text-[10px] text-gray-400 ml-1">(Kamu)</span>}
          {!p.connected && <span className="text-[10px] text-amber-300/80 ml-1">(offline)</span>}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {p.streak >= 3 && (
          <span className="flex items-center gap-0.5 text-[10px] font-bold text-orange-300">
            <Flame className="w-3 h-3" />
            {p.streak}
          </span>
        )}
        <span className="text-sm font-mono font-black text-accent2">{p.score} Poin</span>
      </div>
    </div>
  );
  return (
    <div className="max-w-sm mx-auto space-y-2 text-left">
      {list.map((p, i) => row(p, i))}
      {showMeBelow && (
        <>
          <p className="text-center text-[10px] text-gray-500">…</p>
          {row(players[meIdx], meIdx)}
        </>
      )}
    </div>
  );
};

/* ───────────────────────────── Komponen utama ───────────────────────────── */

export const MultiplayerArenaModal: React.FC<MultiplayerArenaModalProps> = ({ isOpen, onClose, isOnline, userNickname, userAvatarUrl, userFrameId }) => {
  const socketRef = useRef<Socket | null>(null);
  const [clientId] = useState<string>(getClientId);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');
  const [notice, setNotice] = useState('');

  // null = belum bergabung (layar sambutan).
  const [arena, setArena] = useState<ArenaState | null>(null);
  const [joining, setJoining] = useState(false);
  const [myId, setMyId] = useState('');

  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [revealed, setRevealed] = useState<Record<number, Reveal>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<MyResult | null>(null);
  const [outcome, setOutcome] = useState<LeaderboardOutcome | null>(null);
  const [savedGame, setSavedGame] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [floating, setFloating] = useState<{ id: string; emoji: string; name: string }[]>([]);

  // Identitas di permainan: nama & foto bisa disamarkan tanpa mengubah akun asli.
  const [displayName, setDisplayName] = useState<string>(userNickname || '');
  const [showAvatar, setShowAvatar] = useState(true);

  const arenaRef = useRef<ArenaState | null>(null);
  arenaRef.current = arena;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const resetGameLocal = useCallback(() => {
    setQuestions([]);
    setAnswers({});
    setRevealed({});
    setSelected(null);
    setResult(null);
    setSavedGame(false);
  }, []);

  const applySync = useCallback((sync: ArenaSync | undefined) => {
    if (!sync) return;
    setQuestions(Array.isArray(sync.questions) ? sync.questions : []);
    const mine = { ...(sync.myAnswers || {}) };
    setAnswers(mine);
    setRevealed({ ...(sync.revealed || {}) });
    const sel = mine[sync.currentQIndex ?? 0];
    setSelected(sel === undefined ? null : sel);
    if (sync.myResult) setResult(sync.myResult);
    else if (sync.roundResult) setResult({ isCorrect: false, pointsAwarded: 0, ...sync.roundResult });
    else setResult(null);
  }, []);

  // ---- Tutup modal: putuskan koneksi & kembalikan ke layar sambutan ----
  useEffect(() => {
    if (isOpen) return;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setArena(null);
    setMyId('');
    setJoining(false);
    setConnection('connecting');
    setErrorMsg('');
    setNotice('');
    setOutcome(null);
    setFloating([]);
    resetGameLocal();
    setDisplayName(userNickname || '');
    setShowAvatar(true);
  }, [isOpen, resetGameLocal, userNickname]);

  // ---- Koneksi socket: dibuat tiap modal dibuka; otomatis kembali ke arena bila masih terdaftar (refresh) ----
  useEffect(() => {
    if (!isOpen || !isOnline) return;
    const socket = io(SOCKET_URL, { path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnection('connected');
      setErrorMsg('');
      socket.emit('arena:rejoin', { clientId });
    });
    socket.on('connect_error', () => setConnection('error'));
    socket.on('disconnect', () => setConnection('connecting'));

    socket.on('arena:joined', (p: { state: ArenaState; sync: ArenaSync; you: string }) => {
      setJoining(false);
      setMyId(p.you);
      setArena(p.state);
      setOutcome(null);
      applySync(p.sync);
    });
    socket.on('arena:update', (state: ArenaState) => {
      setArena(state);
      // Siklus baru dimulai: bersihkan sisa permainan sebelumnya.
      if (state.phase === 'lobby') {
        setQuestions([]);
        setAnswers({});
        setRevealed({});
        setSelected(null);
        setResult(null);
        setOutcome(null);
        setSavedGame(false);
      }
    });
    socket.on('arena:started', (p: { questions: QuizQuestion[] }) => {
      setQuestions(Array.isArray(p.questions) ? p.questions : []);
      setAnswers({});
      setRevealed({});
      setSelected(null);
      setResult(null);
      setOutcome(null);
      setSavedGame(false);
      audioEngine.playClickSound();
    });
    socket.on('arena:nextRound', () => {
      setSelected(null);
      setResult(null);
    });
    socket.on('arena:answerResult', (r: { currentQIndex: number; isCorrect: boolean; pointsAwarded: number; correctIndex: number; explanation: string }) => {
      setResult({ isCorrect: r.isCorrect, pointsAwarded: r.pointsAwarded, correctIndex: r.correctIndex, explanation: r.explanation });
      setRevealed((prev) => ({ ...prev, [r.currentQIndex]: { correctIndex: r.correctIndex, explanation: r.explanation } }));
      if (r.isCorrect) audioEngine.playCorrectSound();
      else audioEngine.playWrongSound();
    });
    socket.on('arena:roundEnded', (r: { currentQIndex: number; correctIndex: number; explanation: string }) => {
      const rv = { correctIndex: r.correctIndex, explanation: r.explanation || '' };
      setRevealed((prev) => ({ ...prev, [r.currentQIndex]: rv }));
      // Belum menjawab sampai waktu habis: tampilkan jawaban benar tanpa poin.
      setResult((prev) => prev ?? { isCorrect: false, pointsAwarded: 0, ...rv });
    });
    socket.on('arena:ended', (p: { state: ArenaState; revealed: Record<number, Reveal> }) => {
      setArena(p.state);
      setRevealed((prev) => ({ ...prev, ...(p.revealed || {}) }));
    });
    socket.on('arena:leaderboard', (o: LeaderboardOutcome) => setOutcome(o));
    socket.on('arena:reactionReceived', (p: { playerId: string; playerName: string; emoji: string }) => {
      const id = `${p.playerId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      setFloating((prev) => [...prev.slice(-12), { id, emoji: p.emoji, name: p.playerName }]);
      window.setTimeout(() => setFloating((prev) => prev.filter((r) => r.id !== id)), 2200);
    });
    socket.on('arena:resumeFailed', () => {
      /* Belum terdaftar di arena: tetap di layar sambutan. */
    });
    socket.on('arena:replaced', () => {
      setArena(null);
      setMyId('');
      setJoining(false);
      resetGameLocal();
      setNotice('Arena Global dibuka di tab atau perangkat lain, jadi sesi di sini dihentikan.');
    });
    socket.on('arena:left', () => {
      setArena(null);
      setMyId('');
      setJoining(false);
      setOutcome(null);
      resetGameLocal();
    });
    socket.on('arena:error', (msg: string) => {
      setJoining(false);
      setErrorMsg(String(msg || 'Terjadi kesalahan.'));
    });

    return () => {
      socket.disconnect();
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [isOpen, isOnline, clientId, applySync, resetGameLocal]);

  // ---- Jam: dipakai hitung mundur (server mengirim waktu berakhir fase) ----
  useEffect(() => {
    if (!isOpen || !arena) return;
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [isOpen, Boolean(arena)]);

  // Pemberitahuan hilang sendiri.
  useEffect(() => {
    if (!notice && !errorMsg) return;
    const t = window.setTimeout(() => {
      setNotice('');
      setErrorMsg('');
    }, 6000);
    return () => window.clearTimeout(t);
  }, [notice, errorMsg]);

  /* ───────── Turunan ───────── */

  const me = arena?.players.find((p) => p.id === myId);
  const phase: Phase = arena?.phase ?? 'lobby';
  const secLeft = arena?.phaseEndsAt ? Math.max(0, Math.ceil((arena.phaseEndsAt - now) / 1000)) : 0;
  const qIndex = arena?.currentQIndex ?? 0;
  const currentQ: QuizQuestion | undefined = questions[qIndex];
  const iAmPlaying = Boolean(me?.participating);
  const ranked = useMemo(() => (arena ? [...arena.players].filter((p) => p.participating).sort((a, b) => b.score - a.score) : []), [arena]);
  const watchers = useMemo(() => (arena ? arena.players.filter((p) => !p.participating) : []), [arena]);
  const answeredCount = ranked.filter((p) => p.answered).length;
  const hasAnswered = selected !== null;
  const revealNow = revealed[qIndex];
  const isLoggedIn = Boolean(storage.getUserSession()?.isLoggedIn);

  /* ───────── Aksi ───────── */

  const handleJoin = () => {
    if (!socketRef.current || connection !== 'connected') return;
    audioEngine.playClickSound();
    setJoining(true);
    setErrorMsg('');
    socketRef.current.emit('arena:join', {
      clientId,
      name: displayName.trim().slice(0, 40) || userNickname || 'Pemain',
      avatarUrl: showAvatar ? userAvatarUrl || '' : '',
      frameId: showAvatar ? userFrameId || 'none' : 'none',
    });
  };

  const handleAnswer = (idx: number) => {
    if (!iAmPlaying || phase !== 'question' || hasAnswered) return;
    audioEngine.playClickSound();
    setSelected(idx);
    setAnswers((prev) => ({ ...prev, [qIndex]: idx }));
    socketRef.current?.emit('arena:answer', { optionIndex: idx });
  };

  const handleReaction = (emoji: string) => socketRef.current?.emit('arena:reaction', { emoji });

  /** Keluar dari arena (modal tetap terbuka di layar sambutan). Saat bertanding, skor permainan ini tidak dicatat. */
  const handleLeave = () => {
    if (arenaRef.current && iAmPlaying && isRunning(arenaRef.current.phase)) {
      if (!window.confirm('Keluar dari Arena Global? Skor permainan yang sedang berjalan tidak akan dicatat.')) return;
    }
    audioEngine.playClickSound();
    socketRef.current?.emit('arena:leave');
  };

  /** Menutup modal: bila sedang bertanding, keluar berarti skor permainan ini tidak dicatat. */
  const handleClose = () => {
    if (arenaRef.current && iAmPlaying && isRunning(arenaRef.current.phase)) {
      if (!window.confirm('Keluar dari Arena Global? Skor permainan yang sedang berjalan tidak akan dicatat.')) return;
    }
    if (arenaRef.current) socketRef.current?.emit('arena:leave');
    onCloseRef.current();
  };

  /** Simpan hasil permainan ke riwayat perangkat (sama seperti mode lain). */
  const handleSaveResult = () => {
    if (!arena || !questions.length) return;
    const log: AnswerLogEntry[] = questions.map((q: any, i) => {
      const sel = answers[i];
      const rv = revealed[i];
      return {
        questionId: String(q.id ?? `q${i + 1}`),
        number: i + 1,
        question: q.question,
        options: q.options || [],
        correctIndex: rv ? rv.correctIndex : -1,
        selectedIndex: sel === undefined ? -1 : sel,
        isCorrect: sel !== undefined && rv !== undefined && sel === rv.correctIndex,
        category: q.category,
        explanation: rv?.explanation || undefined,
        mediaType: q.mediaType === 'image' || q.mediaType === 'audio' || q.mediaType === 'video' ? q.mediaType : undefined,
        mediaUrl: typeof q.mediaUrl === 'string' && !q.mediaUrl.startsWith('data:') ? q.mediaUrl : undefined,
        mediaCredit: q.mediaCredit,
      };
    });
    const rank = ranked.findIndex((p) => p.id === myId) + 1;
    const entry: SavedQuizResult = {
      id: `mp-${Date.now()}`,
      savedAt: Date.now(),
      deckId: `arena-${arena.channel.toLowerCase().replace(/\s+/g, '-')}`,
      deckTitle: arena.deckTitle || 'Arena Global',
      mode: 'multiplayer',
      totalQuestions: log.length,
      summary: `Arena Global (${arena.channel}): peringkat ${rank || '-'} dari ${ranked.length} pemain dengan ${me?.score ?? 0} poin.`,
      data: { finalRank: ranked.map((p) => ({ name: p.name, score: p.score })) },
      answers: log,
    };
    if (addSavedResult(entry)) setSavedGame(true);
    else alert('Hasil gagal disimpan: penyimpanan lokal perangkat penuh atau tidak tersedia.');
  };

  if (!isOpen) return null;

  /* ───────── Tampilan ───────── */

  const deckBadge = arena?.deckSource === 'community' ? (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
      <ShieldCheck className="w-3 h-3" />
      Kuis Komunitas{arena.ownerName ? ` oleh ${arena.ownerName}` : ''}
    </span>
  ) : arena?.deckSource === 'builtin' ? (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/10 text-gray-300 border border-white/10">Kuis Bawaan</span>
  ) : null;

  const connectedAndIdle = connection === 'connected' && !arena;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-3xl rounded-2xl bg-surface border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92dvh] relative"
      >
        {/* Emoji reaksi melayang */}
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          <AnimatePresence>
            {floating.map((r) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 0, x: Math.random() * 80 - 40 }}
                animate={{ opacity: 1, y: -140 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 2 }}
                className="absolute bottom-24 left-1/2 text-3xl"
                title={r.name}
              >
                {r.emoji}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        <div className="p-4 sm:p-5 border-b border-white/[0.08] bg-black/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent2 text-on-accent2 shadow-md shadow-accent2/20">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-base sm:text-lg font-bold text-white">Arena Global</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent2/20 text-accent2 border border-accent2/30">
                  {arena ? arena.channel : 'Tanpa kode ruangan'}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                {arena ? `${arena.playersOnline} pemain online di kanal ini` : 'Ruang publik: tinggal gabung, lawan pemain sungguhan secara real-time.'}
              </p>
            </div>
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer" aria-label="Tutup">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!isOnline && (
          <div className="bg-red-900/40 border-b border-accent2/30 px-5 py-2.5 flex items-center gap-2.5 text-xs text-red-200">
            <WifiOff className="w-4 h-4 text-accent2 shrink-0" />
            <span>Mode Offline Terdeteksi. Arena Global membutuhkan koneksi jaringan aktif.</span>
          </div>
        )}
        {isOnline && connection !== 'connected' && (
          <div className="bg-black/40 border-b border-white/10 px-5 py-2.5 flex items-center gap-2.5 text-xs text-gray-300">
            {connection === 'connecting' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                <span>Menyambungkan ke server…</span>
              </>
            ) : (
              <>
                <WifiOff className="w-4 h-4 text-amber-400" />
                <span>Tidak bisa tersambung ke server. Mencoba lagi otomatis…</span>
              </>
            )}
          </div>
        )}
        {(notice || errorMsg) && (
          <div role="alert" className="bg-amber-500/10 border-b border-amber-500/30 px-5 py-2.5 text-xs text-amber-200">
            {errorMsg || notice}
          </div>
        )}

        <div className="p-5 sm:p-6 overflow-y-auto flex-1">
          {/* ───────── Belum bergabung ───────── */}
          {!arena ? (
            <div className="space-y-5 max-w-lg mx-auto">
              <div className="p-4 rounded-2xl bg-black/40 border border-white/[0.08] space-y-2 text-xs text-gray-300 leading-relaxed">
                <p className="text-sm font-black text-white">Cara kerja</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Tidak ada kode, host, atau daftar ruangan. Server menempatkanmu di kanal yang ramai dan memilihkan kuisnya.</li>
                  <li>Kuis berasal dari deck bawaan dan kuis Komunitas yang <strong className="text-white">sudah lolos pemeriksaan</strong>. Permainan berjalan terus: lobi, soal, jeda, podium.</li>
                  <li>Masuk saat permainan berjalan? Kamu menonton dulu dan ikut di permainan berikutnya.</li>
                  <li>Skor akun login masuk <strong className="text-white">Papan Peringkat</strong> bila permainan tuntas dan minimal 2 pemain yang masuk akun ikut bermain.</li>
                </ul>
              </div>

              <div className="space-y-3">
                <label className="block text-[11px] font-bold text-gray-300">
                  Nama di arena
                  <input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={40}
                    placeholder={userNickname || 'Pemain'}
                    className="mt-1 w-full px-3 py-2 rounded-xl bg-black/50 border border-white/10 focus:border-accent2 outline-none text-sm text-white"
                  />
                </label>
                <label className="flex items-center gap-2 text-[11px] text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={showAvatar} onChange={(e) => setShowAvatar(e.target.checked)} className="accent-current" />
                  Tampilkan foto profil dan bingkaiku
                </label>
              </div>

              {!isLoggedIn && (
                <p className="text-[11px] text-amber-200/90 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30">
                  Kamu belum masuk akun. Tamu boleh bermain, tetapi skornya tidak masuk Papan Peringkat.
                </p>
              )}

              <button
                type="button"
                onClick={handleJoin}
                disabled={!connectedAndIdle || joining}
                className="w-full py-3 rounded-xl bg-accent2 hover:bg-accent2/80 disabled:opacity-50 text-on-accent2 text-sm font-black cursor-pointer active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                {joining ? 'Bergabung…' : 'Gabung Arena Global'}
              </button>
            </div>
          ) : phase === 'lobby' ? (
            /* ───────── Lobi ───────── */
            <div className="space-y-5 text-center">
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Permainan berikutnya</p>
                {arena.deckTitle ? (
                  <>
                    <h4 className="text-lg font-black text-white">{arena.deckTitle}</h4>
                    {deckBadge}
                  </>
                ) : (
                  <p className="text-sm text-gray-300 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Memilih kuis…
                  </p>
                )}
              </div>
              {arena.phaseEndsAt && (
                <div className="inline-flex flex-col items-center px-5 sm:px-8 py-4 rounded-2xl bg-black/40 border border-white/10">
                  <span className="text-4xl font-mono font-black text-white">{secLeft}</span>
                  <span className="text-[11px] text-gray-400">detik lagi mulai</span>
                </div>
              )}
              <div className="max-w-md mx-auto space-y-2 text-left">
                <p className="text-[11px] font-bold text-gray-400">Pemain di kanal ({arena.players.length}/{arena.capacity})</p>
                {arena.players.map((p) => (
                  <div key={p.id} className={`flex items-center gap-2.5 p-2.5 rounded-xl border ${p.id === myId ? 'bg-accent2/10 border-accent2/30' : 'bg-black/40 border-white/[0.08]'}`}>
                    <PlayerAvatar name={p.name} avatarUrl={p.avatarUrl} frameId={p.frameId} size="sm" />
                    <span className="text-sm font-bold text-white truncate flex-1">
                      {p.name}
                      {p.id === myId && <span className="text-[10px] text-gray-400 ml-1">(Kamu)</span>}
                    </span>
                    {!p.connected && <span className="text-[10px] text-amber-300/80">offline</span>}
                    {!p.loggedIn && <span className="text-[9px] text-gray-500">tamu</span>}
                  </div>
                ))}
              </div>
              {!isLoggedIn && <p className="text-[11px] text-gray-400">Masuk ke akunmu supaya skor tercatat di Papan Peringkat.</p>}
              <LeaveButton onLeave={handleLeave} />
            </div>
          ) : phase === 'podium' ? (
            /* ───────── Podium ───────── */
            <div className="space-y-4 text-center">
              <h3 className="text-xl font-black text-white">Pertandingan Selesai</h3>
              <p className="text-xs text-gray-400">{arena.deckTitle}</p>
              {iAmPlaying && outcome && (
                <p
                  role="status"
                  className={`text-[11px] font-bold px-3 py-1.5 rounded-lg border inline-block ${
                    outcome.counted ? 'bg-yellow-400/10 border-yellow-400/40 text-yellow-200' : 'bg-black/40 border-white/10 text-gray-300'
                  }`}
                >
                  {outcome.counted ? `+${outcome.points ?? 0} poin tercatat di Papan Peringkat` : outcome.message || 'Skor permainan ini tidak dihitung ke Papan Peringkat.'}
                </p>
              )}
              {iAmPlaying && !outcome && !isLoggedIn && <p className="text-[11px] text-gray-400">Masuk ke akunmu supaya skor tercatat di Papan Peringkat.</p>}
              {!iAmPlaying && <p className="text-[11px] text-sky-200">Kamu menonton permainan ini. Kamu ikut di permainan berikutnya.</p>}

              <Scoreboard players={ranked} myId={myId} />

              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {REACTION_EMOJIS.map((emoji) => (
                  <button key={emoji} onClick={() => handleReaction(emoji)} className="w-9 h-9 rounded-full bg-black/40 border border-white/10 hover:bg-white/10 hover:scale-110 transition-all text-base cursor-pointer">
                    {emoji}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                {iAmPlaying && questions.length > 0 && (
                  <button
                    type="button"
                    onClick={handleSaveResult}
                    disabled={savedGame}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white text-xs font-bold flex items-center gap-2 cursor-pointer"
                  >
                    {savedGame ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Save className="w-3.5 h-3.5" />}
                    {savedGame ? 'Tersimpan di Riwayat' : 'Simpan Hasil'}
                  </button>
                )}
                <LeaveButton onLeave={handleLeave} />
              </div>
              <p className="text-[11px] text-gray-500">Permainan berikutnya dimulai dalam {secLeft} detik.</p>
            </div>
          ) : (
            /* ───────── Soal & jeda ───────── */
            <div className="space-y-5">
              <div className="flex items-center justify-between text-xs gap-2">
                <span className="px-3 py-1 rounded-full bg-black/40 text-gray-300 font-bold border border-white/[0.08]">
                  Soal {qIndex + 1} / {arena.totalQuestions || questions.length}
                </span>
                {deckBadge}
                <span className="font-mono font-bold text-white flex items-center gap-1">
                  <Timer className="w-3.5 h-3.5 text-gray-400" />
                  {secLeft}s
                </span>
              </div>

              {!iAmPlaying && (
                <div className="flex items-center gap-2 p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-200">
                  <Eye className="w-4 h-4 shrink-0" />
                  <span>Permainan sedang berjalan. Kamu menonton dulu dan ikut di permainan berikutnya.</span>
                </div>
              )}
              {iAmPlaying && phase === 'question' && ranked.length > 0 && (
                <p className="text-[11px] text-gray-400">
                  {answeredCount}/{ranked.length} pemain sudah menjawab. Makin cepat menjawab, makin besar poinnya.
                </p>
              )}

              {currentQ ? (
                <>
                  <h4 className="text-base sm:text-lg font-bold text-white leading-relaxed">{currentQ.question}</h4>

                  {(currentQ as any).mediaUrl && (currentQ as any).mediaType && (
                    <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-black/40 flex items-center justify-center">
                      {(currentQ as any).mediaType === 'image' && <img src={(currentQ as any).mediaUrl} alt="Lampiran soal" className="max-h-48 w-full object-contain" />}
                      {(currentQ as any).mediaType === 'audio' && <audio src={(currentQ as any).mediaUrl} controls className="w-full h-10 p-2" />}
                      {(currentQ as any).mediaType === 'video' && <video src={(currentQ as any).mediaUrl} controls className="max-h-56 w-full" />}
                    </div>
                  )}

                  <div className="space-y-2.5">
                    {(currentQ.options || []).map((opt, oIdx) => {
                      const correctIdx = revealNow?.correctIndex;
                      const showKey = correctIdx !== undefined && (phase === 'reveal' || hasAnswered);
                      const isCorrectOpt = showKey && oIdx === correctIdx;
                      const isMine = selected === oIdx;
                      let style = 'border-white/10 bg-black/40 text-gray-200 hover:border-white/30';
                      if (showKey) {
                        if (isCorrectOpt) style = 'border-emerald-500 bg-emerald-950/40 text-emerald-100 font-semibold';
                        else if (isMine) style = 'border-red-500/60 bg-red-950/30 text-red-100 font-semibold';
                        else style = 'border-white/[0.04] bg-black/20 opacity-40 text-gray-400';
                      } else if (isMine) {
                        style = 'border-accent2 bg-accent2/40 text-white font-semibold';
                      }
                      return (
                        <button
                          key={oIdx}
                          type="button"
                          disabled={!iAmPlaying || phase !== 'question' || hasAnswered}
                          onClick={() => handleAnswer(oIdx)}
                          className={`w-full text-left p-3.5 rounded-xl border text-xs transition-all ${style}`}
                        >
                          <strong>{String.fromCharCode(65 + oIdx)}.</strong> {opt}
                        </button>
                      );
                    })}
                  </div>

                  {iAmPlaying && hasAnswered && phase === 'question' && !result && (
                    <p className="text-[11px] text-gray-400 flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Jawabanmu terkirim. Menunggu pemain lain…
                    </p>
                  )}

                  {iAmPlaying && result && (
                    <div className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${result.isCorrect ? 'bg-emerald-950/30 border-emerald-500/30' : 'bg-accent2/25 border-red-500/30'}`}>
                      <span className={`font-bold block ${result.isCorrect ? 'text-emerald-300' : 'text-red-300'}`}>
                        {result.isCorrect ? `Benar! +${result.pointsAwarded} poin` : hasAnswered ? 'Kurang tepat, 0 poin.' : 'Waktu habis, 0 poin.'}
                      </span>
                      {result.explanation && (
                        <div className="flex items-start gap-2 text-gray-300 pt-1 border-t border-white/[0.06]">
                          <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                          <p className="leading-relaxed">{result.explanation}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {!iAmPlaying && phase === 'reveal' && revealNow?.explanation && (
                    <div className="flex items-start gap-2 text-xs text-gray-300 p-3.5 rounded-xl bg-black/40 border border-white/[0.08]">
                      <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                      <p className="leading-relaxed">{revealNow.explanation}</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-gray-300 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Memuat soal…
                </p>
              )}

              {phase === 'reveal' && (
                <div className="space-y-2 pt-1">
                  <p className="text-[11px] font-bold text-gray-400 text-center">Papan skor sementara</p>
                  <Scoreboard players={ranked} myId={myId} limit={5} />
                </div>
              )}

              {watchers.length > 0 && phase !== 'reveal' && <p className="text-[10px] text-gray-500">{watchers.length} pemain menonton dan ikut di permainan berikutnya.</p>}

              <div className="flex justify-center">
                <LeaveButton onLeave={handleLeave} label={iAmPlaying ? 'Keluar (skor tidak dicatat)' : 'Keluar dari Arena'} />
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};

const LeaveButton: React.FC<{ onLeave: () => void; label?: string }> = ({ onLeave, label = 'Keluar dari Arena' }) => (
  <button
    type="button"
    onClick={onLeave}
    className="px-4 py-2 rounded-xl bg-black/60 hover:bg-black/90 border border-white/[0.08] text-gray-300 text-xs font-bold flex items-center gap-2 cursor-pointer mx-auto"
  >
    <LogOut className="w-3.5 h-3.5" />
    <span>{label}</span>
  </button>
);
