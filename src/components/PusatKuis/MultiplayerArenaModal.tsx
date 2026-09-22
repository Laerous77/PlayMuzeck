// src/components/PusatKuis/MultiplayerArenaModal.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  getPlayTime,
  isEditorDeck,
  describeEditorDeckTime,
  DEFAULT_QUESTION_TIME,
} from '../../services/questionTime';
import { QuestionTimerSetting } from './QuestionTimerSetting';
import { PROFILE_FRAMES, FrameOrnament } from '../Modals/ProfileDashboardModal';
import { addSavedResult, AnswerLogEntry, SavedQuizResult } from '../../services/quizResultsStore';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Users,
  WifiOff,
  Copy,
  Check,
  Sparkles,
  Award,
  Crown,
  RotateCcw,
  Loader2,
  Lightbulb,
  Globe,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { Deck, QuizQuestion } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { io, Socket } from 'socket.io-client';

interface MultiplayerArenaModalProps {
  isOpen: boolean;
  onClose: () => void;
  decks: Deck[];
  unlockedDeckIds: string[];
  isOnline: boolean;
  userNickname: string;
  /** Foto profil & bingkai milik pemain saat ini, supaya pemain lain melihat identitas asli. */
  userAvatarUrl?: string;
  userFrameId?: string;
}

interface RoomPlayer {
  id: string;
  name: string;
  avatarUrl?: string;
  frameId?: string;
  isHost: boolean;
  isReady: boolean;
  score: number;
  streak: number;
  lastAnswerStatus?: 'correct' | 'wrong';
  lastPointsAwarded?: number;
}

interface RoomState {
  code: string;
  deckId: string;
  deckTitle: string;
  roundTimeSec: number;
  /** Jeda (detik) antar soal, diatur host — supaya pemain tak perlu tunggu waktu jawab habis untuk lihat hasil. */
  roundGapSec: number;
  /** 'round-result' = jeda menampilkan jawaban benar & skor sebelum soal berikutnya. */
  status: 'lobby' | 'in-game' | 'round-result' | 'podium';
  currentQIndex: number;
  roundEndsAt: number | null;
  /** Terisi hanya saat status 'round-result'. */
  roundResultEndsAt: number | null;
  /** Poin penuh soal SAAT INI, diambil server dari Quiz Editor (bukan angka 100 tetap). */
  currentQuestionBasePoints: number | null;
  /** 'invite' = hanya lewat kode, tidak tampil di daftar publik. 'global' = tampil di "Room Global". */
  visibility: 'invite' | 'global';
  /** Room global dengan password wajib mengisi password saat join. Password asli tidak pernah dikirim ke client. */
  hasPassword: boolean;
  players: RoomPlayer[];
}

/** Satu baris di daftar "Room Global" — data ringkas, tanpa password asli. */
interface GlobalRoomListing {
  code: string;
  deckTitle: string;
  playerCount: number;
  hasPassword: boolean;
}

const SOCKET_URL = typeof window !== 'undefined' ? window.location.origin : '';

const FALLBACK_COLORS = ['bg-[#FC1212]', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-600', 'bg-purple-600', 'bg-sky-600'];
const fallbackColorFor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
};

const REACTION_EMOJIS = ['🔥', '👏', '😂', '😮', '💀', '❤️'];

/** Avatar bulat + bingkai profil asli pemain (fallback: inisial warna kalau tidak ada foto). */
const PlayerAvatar: React.FC<{ player: RoomPlayer; size?: 'sm' | 'md' }> = ({ player, size = 'sm' }) => {
  const frame = PROFILE_FRAMES.find((f) => f.id === player.frameId) || PROFILE_FRAMES[0];
  const dim = size === 'md' ? 'w-9 h-9' : 'w-6 h-6';
  return (
    <div className={`relative ${dim} shrink-0`}>
      {player.avatarUrl ? (
        <img
          src={player.avatarUrl}
          alt={player.name}
          className={`${dim} rounded-full object-cover ${frame.borderClass || 'border-2 border-white/20'}`}
        />
      ) : (
        <div
          className={`${dim} rounded-full ${fallbackColorFor(player.id)} ${frame.borderClass || 'border-2 border-white/20'} flex items-center justify-center text-white font-bold text-[10px]`}
        >
          {(player.name || '?').charAt(0).toUpperCase()}
        </div>
      )}
      <FrameOrnament iconType={frame.iconType} size={size === 'md' ? 'lg' : 'sm'} />
    </div>
  );
};

export const MultiplayerArenaModal: React.FC<MultiplayerArenaModalProps> = ({
  isOpen,
  onClose,
  decks,
  unlockedDeckIds,
  isOnline,
  userNickname,
  userAvatarUrl,
  userFrameId,
}) => {
  const socketRef = useRef<Socket | null>(null);
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const playableDecks = useMemo(
    () => decks.filter((d) => d.isFree || unlockedDeckIds.includes(d.id)),
    [decks, unlockedDeckIds]
  );
  const [selectedDeckId, setSelectedDeckId] = useState<string>(playableDecks[0]?.id || 'deck-starter-1');
  const [roundTimeChoice, setRoundTimeChoice] = useState<number>(DEFAULT_QUESTION_TIME);
  // Skema poin dinamis, diatur host: persen waktu pertama yang masih dapat
  // poin penuh, dan poin minimal saat mepet waktu habis.
  // PENTING: poin dasar/penuh tidak diatur di sini lagi — itu sudah jadi
  // wewenang Quiz Editor (q.points, per soal). Di sini host hanya mengatur
  // BERAPA PERSEN dari poin soal itu yang tetap didapat kalau jawab mepet
  // waktu habis, supaya selalu masuk akal berapa pun besar poin soalnya
  // (poin minimal = persen x poin soal, jadi otomatis selalu < poin penuh).
  const [fullPointPercent, setFullPointPercent] = useState<number>(40);
  const [minPointsPercent, setMinPointsPercent] = useState<number>(10); // dalam %, 0-90
  // Jeda (detik) menampilkan jawaban benar & skor sebelum lanjut ke soal
  // berikutnya — supaya pemain tidak harus menunggu roundTimeSec penuh
  // habis dulu baru bisa lihat hasil & pindah soal.
  const [roundGapSec, setRoundGapSec] = useState<number>(5);
  // Visibilitas ruangan yang mau dibuat: 'invite' (hanya lewat kode, bawaan)
  // atau 'global' (tampil di daftar "Room Global", bisa digabung tanpa kode).
  // Password HANYA relevan & dikirim ke server kalau visibility = 'global',
  // dan itu pun opsional — boleh dikosongkan supaya room global bebas masuk.
  const [roomVisibility, setRoomVisibility] = useState<'invite' | 'global'>('invite');
  const [roomPassword, setRoomPassword] = useState<string>('');
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [copied, setCopied] = useState(false);

  // Sub-mode tab "Gabung": lewat kode ruangan (seperti sebelumnya), atau
  // menelusuri daftar Room Global yang sedang terbuka.
  const [joinMode, setJoinMode] = useState<'code' | 'global'>('code');
  const [globalRooms, setGlobalRooms] = useState<GlobalRoomListing[]>([]);
  const [isLoadingGlobalRooms, setIsLoadingGlobalRooms] = useState(false);
  // Kode room global yang sedang diminta password-nya sebelum join.
  const [pendingGlobalCode, setPendingGlobalCode] = useState<string | null>(null);
  const [globalPasswordInput, setGlobalPasswordInput] = useState<string>('');

  const [room, setRoom] = useState<RoomState | null>(null);
  const [mySocketId, setMySocketId] = useState<string>('');
  const [userSelectedOption, setUserSelectedOption] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<{ isCorrect: boolean; pointsAwarded: number; correctIndex: number; explanation: string } | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [questionsSnapshot, setQuestionsSnapshot] = useState<QuizQuestion[]>([]);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; name: string }[]>([]);

  // Untuk menyusun riwayat permainan (sama seperti mode lain) begitu game selesai.
  const answerLogRef = useRef<AnswerLogEntry[]>([]);
  const hasSavedResultRef = useRef(false);

  const activeDeck = decks.find((d) => d.id === selectedDeckId) || decks[0];

  // ---- Reset total setiap kali modal ditutup, supaya dibuka lagi selalu bersih (tidak ada podium nyangkut) ----
  useEffect(() => {
    if (isOpen) return;
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRoom(null);
    setConnectionState('connecting');
    setErrorMsg('');
    setUserSelectedOption(null);
    setAnswerResult(null);
    setQuestionsSnapshot([]);
    setFloatingReactions([]);
    answerLogRef.current = [];
    hasSavedResultRef.current = false;
    setJoinMode('code');
    setGlobalRooms([]);
    setPendingGlobalCode(null);
    setGlobalPasswordInput('');
    setRoomVisibility('invite');
    setRoomPassword('');
  }, [isOpen]);

  // ---- Koneksi socket: dibuat setiap modal dibuka ----
  useEffect(() => {
    if (!isOpen || !isOnline) return;

    const socket = io(SOCKET_URL, { path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionState('connected');
      setMySocketId(socket.id || '');
    });
    socket.on('connect_error', () => {
      setConnectionState('error');
      setErrorMsg('Gagal terhubung ke server multiplayer. Coba lagi beberapa saat.');
    });

    socket.on('room:created', (state: RoomState) => setRoom(state));
    socket.on('room:joined', (state: RoomState) => setRoom(state));
    socket.on('room:update', (state: RoomState) => setRoom(state));
    socket.on('room:error', (msg: string) => setErrorMsg(msg));
    socket.on('room:globalList', (list: GlobalRoomListing[]) => {
      setGlobalRooms(list);
      setIsLoadingGlobalRooms(false);
    });

    socket.on('game:started', (payload: { questions: QuizQuestion[]; roundEndsAt: number; currentQIndex: number }) => {
      setQuestionsSnapshot(payload.questions);
      setUserSelectedOption(null);
      setAnswerResult(null);
      answerLogRef.current = [];
      hasSavedResultRef.current = false;
      audioEngine.playClickSound();
    });

    socket.on('game:answerResult', (result: { isCorrect: boolean; pointsAwarded: number; correctIndex: number; explanation: string }) => {
      setAnswerResult(result);
    });

    // Waktu jawab habis: server masuk status 'round-result' selama roundGapSec
    // detik. `answerResult` dari jawaban sendiri tetap tampil kalau sudah
    // menjawab; kalau belum menjawab sama sekali, tampilkan juga jawaban
    // benarnya di sini supaya semua pemain lihat hasil, bukan cuma yang jawab.
    socket.on(
      'game:roundEnded',
      (payload: { currentQIndex: number; correctIndex: number; explanation: string; roundResultEndsAt: number; isLastQuestion: boolean }) => {
        setAnswerResult((prev) =>
          prev
            ? prev
            : { isCorrect: false, pointsAwarded: 0, correctIndex: payload.correctIndex, explanation: payload.explanation }
        );
      }
    );

    socket.on('game:nextRound', (_payload: { currentQIndex: number; roundEndsAt: number }) => {
      setUserSelectedOption(null);
      setAnswerResult(null);
    });

    socket.on('game:ended', (state: RoomState) => setRoom(state));

    socket.on('room:reactionReceived', (payload: { playerId: string; playerName: string; emoji: string }) => {
      const id = `${Date.now()}-${Math.random()}`;
      setFloatingReactions((prev) => [...prev, { id, emoji: payload.emoji, name: payload.playerName }]);
      setTimeout(() => setFloatingReactions((prev) => prev.filter((r) => r.id !== id)), 2200);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isOnline]);

  // ---- Muat daftar Room Global begitu tab "Room Global" dibuka ----
  useEffect(() => {
    if (!isOpen || room || activeTab !== 'join' || joinMode !== 'global') return;
    if (connectionState !== 'connected') return;
    setIsLoadingGlobalRooms(true);
    socketRef.current?.emit('room:listGlobal');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, joinMode, connectionState]);

  // ---- Timer tampilan (sumber kebenaran waktu tetap di server) ----
  useEffect(() => {
    if (!room || room.status !== 'in-game' || !room.roundEndsAt) return;
    const tick = () => setTimeLeft(Math.max(0, Math.ceil((room.roundEndsAt! - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [room?.roundEndsAt, room?.status]);

  // ---- Catat log jawaban tiap kali ronde berpindah (untuk riwayat, sama seperti mode lain) ----
  const prevQIndexRef = useRef<number>(-1);
  useEffect(() => {
    if (!room || !questionsSnapshot.length) return;
    if (room.status === 'in-game' && room.currentQIndex !== prevQIndexRef.current) {
      // Ronde baru dimulai: catat hasil ronde SEBELUMNYA (kalau ada) ke log.
      const prevIdx = prevQIndexRef.current;
      if (prevIdx >= 0 && prevIdx < questionsSnapshot.length) {
        const q = questionsSnapshot[prevIdx];
        answerLogRef.current.push({
          questionId: (q as any).id || `mp-q-${prevIdx}`,
          number: prevIdx + 1,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          selectedIndex: userSelectedOption,
          isCorrect: userSelectedOption !== null ? userSelectedOption === q.correctIndex : null,
          category: q.category,
          explanation: q.explanation,
        });
      }
      prevQIndexRef.current = room.currentQIndex;
    }
    if (room.status === 'podium' && !hasSavedResultRef.current) {
      // Ronde terakhir: catat juga, lalu simpan seluruh riwayat sekali saja.
      const lastIdx = prevQIndexRef.current;
      if (lastIdx >= 0 && lastIdx < questionsSnapshot.length) {
        const q = questionsSnapshot[lastIdx];
        answerLogRef.current.push({
          questionId: (q as any).id || `mp-q-${lastIdx}`,
          number: lastIdx + 1,
          question: q.question,
          options: q.options,
          correctIndex: q.correctIndex,
          selectedIndex: userSelectedOption,
          isCorrect: userSelectedOption !== null ? userSelectedOption === q.correctIndex : null,
          category: q.category,
          explanation: q.explanation,
        });
      }
      const me = room.players.find((p) => p.id === mySocketId);
      const entry: SavedQuizResult = {
        id: `mp-${Date.now()}`,
        savedAt: Date.now(),
        deckId: room.deckId,
        deckTitle: room.deckTitle,
        mode: 'multiplayer' as any,
        totalQuestions: questionsSnapshot.length,
        summary: `Skor akhir: ${me?.score ?? 0} poin di antara ${room.players.length} pemain.`,
        data: { finalRank: [...room.players].sort((a, b) => b.score - a.score).map((p) => ({ name: p.name, score: p.score })) },
        answers: answerLogRef.current,
      };
      addSavedResult(entry);
      hasSavedResultRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status, room?.currentQIndex]);

  if (!isOpen) return null;

  const currentQ: QuizQuestion | undefined = questionsSnapshot[room?.currentQIndex ?? 0];
  const me = room?.players.find((p) => p.id === mySocketId);
  const isHost = Boolean(me?.isHost);
  const hasAnswered = userSelectedOption !== null;
  const sortedPlayers = room ? [...room.players].sort((a, b) => b.score - a.score) : [];

  const handleCreateRoom = () => {
    if (!activeDeck) return;
    audioEngine.playClickSound();
    socketRef.current?.emit('room:create', {
      name: userNickname || 'Host',
      avatarUrl: userAvatarUrl || '',
      frameId: userFrameId || 'none',
      deckId: activeDeck.id,
      deckTitle: activeDeck.title,
      roundTimeSec: getPlayTime(activeDeck, activeDeck.questions?.[0], roundTimeChoice),
      roundGapSec,
      fullPointRatio: fullPointPercent / 100,
      minPointsPercent: minPointsPercent / 100,
      visibility: roomVisibility,
      password: roomVisibility === 'global' ? roomPassword.trim() : undefined,
    });
  };

  const handleJoinRoom = () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      setErrorMsg('Masukkan kode ruangan terlebih dahulu.');
      return;
    }
    setErrorMsg('');
    socketRef.current?.emit('room:join', {
      code,
      name: userNickname || 'Pemain',
      avatarUrl: userAvatarUrl || '',
      frameId: userFrameId || 'none',
    });
  };

  const handleRefreshGlobalRooms = () => {
    setIsLoadingGlobalRooms(true);
    socketRef.current?.emit('room:listGlobal');
  };

  /** Klik "Gabung" di daftar Room Global: langsung join kalau tanpa password, atau buka input password dulu. */
  const handlePickGlobalRoom = (r: GlobalRoomListing) => {
    setErrorMsg('');
    if (r.hasPassword) {
      setPendingGlobalCode(r.code);
      setGlobalPasswordInput('');
      return;
    }
    socketRef.current?.emit('room:join', {
      code: r.code,
      name: userNickname || 'Pemain',
      avatarUrl: userAvatarUrl || '',
      frameId: userFrameId || 'none',
    });
  };

  /** Konfirmasi password untuk Room Global yang terkunci password. */
  const handleConfirmGlobalPassword = () => {
    if (!pendingGlobalCode) return;
    setErrorMsg('');
    socketRef.current?.emit('room:join', {
      code: pendingGlobalCode,
      name: userNickname || 'Pemain',
      avatarUrl: userAvatarUrl || '',
      frameId: userFrameId || 'none',
      password: globalPasswordInput.trim(),
    });
  };

  const handleCopyCode = () => {
    if (!room) return;
    navigator.clipboard?.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartGame = () => {
    if (!activeDeck || !isHost) return;
    audioEngine.playClickSound();
    socketRef.current?.emit('room:start', { questions: activeDeck.questions });
  };

  const handleSelectOption = (idx: number) => {
    if (hasAnswered || !currentQ) return;
    setUserSelectedOption(idx);
    const isCorrect = idx === currentQ.correctIndex;
    if (isCorrect) audioEngine.playCorrectSound();
    else if (typeof (audioEngine as any).playIncorrectSound === 'function') (audioEngine as any).playIncorrectSound();
    else audioEngine.playClickSound();
    socketRef.current?.emit('game:answer', { optionIndex: idx });
  };

  const handleSendReaction = (emoji: string) => {
    socketRef.current?.emit('room:reaction', { emoji });
  };

  const screen: 'lobby-menu' | 'waiting-room' | 'in-game' | 'podium' = !room
    ? 'lobby-menu'
    : room.status === 'lobby'
    ? 'waiting-room'
    : room.status === 'in-game'
    ? 'in-game'
    : 'podium';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-3xl rounded-2xl bg-[#14213D] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh] relative"
      >
        {/* Overlay reaction emoji melayang */}
        <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
          <AnimatePresence>
            {floatingReactions.map((r) => (
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
            <div className="p-2.5 rounded-xl bg-[#FC1212] text-white shadow-md shadow-red-600/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">Multiplayer Arena</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FC1212]/20 text-[#FC1212] border border-[#FC1212]/30">
                  Online Match
                </span>
              </div>
              <p className="text-xs text-gray-400">Tantang pemain lain sungguhan secara real-time lewat kode ruangan.</p>
            </div>
          </div>

          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {!isOnline && (
          <div className="bg-[#780000]/40 border-b border-[#FC1212]/30 px-5 py-2.5 flex items-center gap-2.5 text-xs text-red-200">
            <WifiOff className="w-4 h-4 text-[#FC1212] flex-shrink-0" />
            <span>Mode Offline Terdeteksi. Fitur Multiplayer membutuhkan koneksi jaringan aktif.</span>
          </div>
        )}

        {isOnline && connectionState !== 'connected' && (
          <div className="bg-black/40 border-b border-white/10 px-5 py-2.5 flex items-center gap-2.5 text-xs text-gray-300">
            {connectionState === 'connecting' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-[#FCA311]" />
                <span>Menghubungkan ke server multiplayer...</span>
              </>
            ) : (
              <span className="text-red-300">{errorMsg || 'Gagal terhubung ke server.'}</span>
            )}
          </div>
        )}

        {errorMsg && connectionState === 'connected' && (
          <div className="bg-[#780000]/30 border-b border-red-500/20 px-5 py-2 text-xs text-red-200">{errorMsg}</div>
        )}

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {screen === 'lobby-menu' ? (
            <div className="space-y-6">
              <div className="flex rounded-xl bg-black/40 p-1 border border-white/[0.08]">
                <button
                  onClick={() => setActiveTab('create')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'create' ? 'bg-[#FC1212] text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  Buat Ruangan Baru
                </button>
                <button
                  onClick={() => setActiveTab('join')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'join' ? 'bg-[#FC1212] text-white shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  Gabung dengan Kode Room
                </button>
              </div>

              {activeTab === 'create' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-300 mb-1">Pilih Deck Kuis Pertandingan</label>
                    <select
                      value={selectedDeckId}
                      onChange={(e) => setSelectedDeckId(e.target.value)}
                      className="w-full p-3 rounded-xl bg-black/50 border border-white/[0.08] text-white text-xs focus:border-[#FC1212] focus:outline-none"
                    >
                      {playableDecks.map((d) => (
                        <option key={d.id} value={d.id} className="bg-[#14213D] text-white">
                          {d.title} ({d.cardCount} Soal • {d.difficulty})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-3">
                    <span className="text-xs font-bold text-gray-300 block">Visibilitas Ruangan</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRoomVisibility('invite')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          roomVisibility === 'invite'
                            ? 'bg-[#FC1212] border-[#FC1212] text-white'
                            : 'bg-black/40 border-white/10 text-gray-300 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Undangan</span>
                        </div>
                        <p className={`text-[10px] mt-0.5 ${roomVisibility === 'invite' ? 'text-red-100' : 'text-gray-500'}`}>
                          Hanya bisa dimasuki lewat kode ruangan.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRoomVisibility('global')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          roomVisibility === 'global'
                            ? 'bg-[#FC1212] border-[#FC1212] text-white'
                            : 'bg-black/40 border-white/10 text-gray-300 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <Globe className="w-3.5 h-3.5" />
                          <span>Global</span>
                        </div>
                        <p className={`text-[10px] mt-0.5 ${roomVisibility === 'global' ? 'text-red-100' : 'text-gray-500'}`}>
                          Muncul di daftar publik, bisa digabung tanpa kode.
                        </p>
                      </button>
                    </div>

                    {roomVisibility === 'global' && (
                      <div className="space-y-1.5 pt-1">
                        <label className="text-[11px] text-gray-400 flex items-center gap-1.5">
                          <Lock className="w-3 h-3" />
                          <span>Password Ruangan (opsional)</span>
                        </label>
                        <input
                          type="text"
                          value={roomPassword}
                          onChange={(e) => setRoomPassword(e.target.value)}
                          placeholder="Kosongkan agar bebas dimasuki siapa saja"
                          maxLength={32}
                          className="w-full p-2.5 rounded-lg bg-black/50 border border-white/[0.08] text-white text-xs focus:border-[#FC1212] focus:outline-none"
                        />
                        <p className="text-[10px] text-gray-500">
                          Kalau diisi, pemain lain harus memasukkan password ini dulu sebelum bisa join dari daftar
                          Room Global.
                        </p>
                      </div>
                    )}
                  </div>

                  <QuestionTimerSetting
                    value={roundTimeChoice}
                    onChange={setRoundTimeChoice}
                    locked={isEditorDeck(activeDeck)}
                    lockedNote={describeEditorDeckTime(activeDeck)}
                    accent="red"
                  />

                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-3">
                    <span className="text-xs font-bold text-gray-300 block">Skor Berbasis Kecepatan Jawab</span>
                    <p className="text-[10px] text-gray-500 -mt-1">
                      Poin penuh tiap soal mengikuti poin yang sudah diatur di Quiz Editor (skema "Poin Sama Rata" atau
                      "Poin Berbeda"). Di sini host hanya mengatur seberapa cepat poin itu berkurang seiring waktu.
                    </p>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span>Poin penuh jika jawab dalam</span>
                        <span className="font-mono font-bold text-white">{fullPointPercent}% waktu pertama</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={90}
                        step={5}
                        value={fullPointPercent}
                        onChange={(e) => setFullPointPercent(Number(e.target.value))}
                        className="w-full accent-[#FC1212]"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-gray-400">
                        <span>Poin minimal saat mepet waktu habis</span>
                        <span className="font-mono font-bold text-white">{minPointsPercent}% dari poin soal</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={90}
                        step={5}
                        value={minPointsPercent}
                        onChange={(e) => setMinPointsPercent(Number(e.target.value))}
                        className="w-full accent-[#FC1212]"
                      />
                      <p className="text-[10px] text-gray-500">
                        Dihitung sebagai persentase dari poin soal itu sendiri (bukan angka tetap), jadi otomatis selalu
                        lebih kecil dari poin penuhnya — berapa pun besar poin soal itu (2, 10, atau 1000 sekalipun).
                      </p>
                    </div>

                    <p className="text-[10px] text-gray-500 pt-1 border-t border-white/[0.06]">
                      Antara {fullPointPercent}% sampai 100% waktu, poin turun bertahap halus dari poin penuh soal
                      menuju {minPointsPercent}% -nya. Lewat waktu / tidak menjawab = 0 poin.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-400">
                      <span className="text-xs font-bold text-gray-300">Jeda Sebelum Soal Berikutnya</span>
                      <span className="font-mono font-bold text-white">{roundGapSec}s</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={15}
                      step={1}
                      value={roundGapSec}
                      onChange={(e) => setRoundGapSec(Number(e.target.value))}
                      className="w-full accent-[#FC1212]"
                    />
                    <p className="text-[10px] text-gray-500">
                      Setelah waktu jawab habis, semua pemain melihat jawaban benar & papan skor selama jeda ini
                      sebelum otomatis lanjut ke soal berikutnya. Atur ke 0 detik untuk langsung lanjut tanpa jeda.
                    </p>
                  </div>

                  <button
                    onClick={handleCreateRoom}
                    disabled={!isOnline || connectionState !== 'connected'}
                    className="w-full py-3 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-xs shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Buat Ruangan &amp; Undang Teman</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex rounded-xl bg-black/30 p-1 border border-white/[0.06]">
                    <button
                      onClick={() => setJoinMode('code')}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        joinMode === 'code' ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Lock className="w-3 h-3" />
                      <span>Kode Ruangan</span>
                    </button>
                    <button
                      onClick={() => setJoinMode('global')}
                      className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                        joinMode === 'global' ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white'
                      }`}
                    >
                      <Globe className="w-3 h-3" />
                      <span>Room Global</span>
                    </button>
                  </div>

                  {joinMode === 'code' ? (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-300 mb-1">Kode Ruangan (Room Code)</label>
                        <input
                          type="text"
                          value={joinCodeInput}
                          onChange={(e) => setJoinCodeInput(e.target.value)}
                          placeholder="Misal: MZK-842"
                          className="w-full p-3 rounded-xl bg-black/50 border border-white/[0.08] text-white text-xs font-mono uppercase tracking-widest focus:border-[#FC1212] focus:outline-none"
                        />
                      </div>

                      <button
                        onClick={handleJoinRoom}
                        disabled={!isOnline || connectionState !== 'connected'}
                        className="w-full py-3 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-xs shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                      >
                        <Users className="w-4 h-4" />
                        <span>Masuk ke Ruangan</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-[11px] text-gray-400">
                          Ruangan publik yang bisa langsung digabung tanpa kode.
                        </p>
                        <button
                          onClick={handleRefreshGlobalRooms}
                          disabled={connectionState !== 'connected'}
                          className="p-1.5 rounded-lg bg-black/40 border border-white/10 text-gray-300 hover:text-white transition-colors cursor-pointer disabled:opacity-40"
                          title="Muat ulang daftar"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isLoadingGlobalRooms ? 'animate-spin' : ''}`} />
                        </button>
                      </div>

                      {isLoadingGlobalRooms ? (
                        <div className="flex items-center justify-center gap-2 text-xs text-gray-400 py-6">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span>Memuat daftar ruangan...</span>
                        </div>
                      ) : globalRooms.length === 0 ? (
                        <div className="text-center text-xs text-gray-500 py-6 border border-dashed border-white/10 rounded-xl">
                          Belum ada Room Global yang terbuka saat ini. Ajak temanmu membuat satu!
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {globalRooms.map((r) => (
                            <div
                              key={r.code}
                              className="p-3 rounded-xl bg-black/40 border border-white/[0.08] flex items-center justify-between gap-3"
                            >
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-xs font-mono font-black text-[#FC1212]">{r.code}</span>
                                  {r.hasPassword && <Lock className="w-3 h-3 text-amber-400 shrink-0" />}
                                </div>
                                <p className="text-[11px] text-gray-300 truncate">{r.deckTitle}</p>
                                <p className="text-[10px] text-gray-500">{r.playerCount} pemain di lobby</p>
                              </div>

                              {pendingGlobalCode === r.code ? (
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <input
                                    type="text"
                                    autoFocus
                                    value={globalPasswordInput}
                                    onChange={(e) => setGlobalPasswordInput(e.target.value)}
                                    placeholder="Password"
                                    className="w-24 p-1.5 rounded-lg bg-black/60 border border-white/10 text-white text-[11px] focus:border-[#FC1212] focus:outline-none"
                                  />
                                  <button
                                    onClick={handleConfirmGlobalPassword}
                                    className="px-2.5 py-1.5 rounded-lg bg-[#FC1212] hover:bg-[#e01010] text-white text-[11px] font-bold cursor-pointer"
                                  >
                                    OK
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handlePickGlobalRoom(r)}
                                  className="px-3 py-1.5 rounded-lg bg-[#FC1212] hover:bg-[#e01010] text-white text-[11px] font-bold shrink-0 cursor-pointer"
                                >
                                  Gabung
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : screen === 'waiting-room' && room ? (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-black/60 border border-white/[0.08] flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Kode Ruangan Kuis</span>
                    <span
                      className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        room.visibility === 'global'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : 'bg-white/10 text-gray-300 border-white/15'
                      }`}
                    >
                      {room.visibility === 'global' ? <Globe className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                      <span>{room.visibility === 'global' ? (room.hasPassword ? 'Global · Terkunci' : 'Global') : 'Undangan'}</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xl font-mono font-black text-[#FC1212] tracking-wider">{room.code}</span>
                    <button onClick={handleCopyCode} className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-xs transition-colors cursor-pointer">
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {room.visibility === 'global'
                      ? 'Ruangan ini juga muncul di daftar Room Global — siapapun bisa join langsung.'
                      : 'Bagikan kode ini ke teman untuk join ruangan.'}
                  </p>
                </div>
                {isHost ? (
                  <button
                    onClick={handleStartGame}
                    disabled={room.players.length < 2}
                    className="px-6 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-xs shadow-lg shadow-red-600/25 transition-all cursor-pointer disabled:opacity-40"
                  >
                    {room.players.length < 2 ? 'Menunggu Pemain Lain...' : 'Mulai Kuis'}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Menunggu host memulai...
                  </span>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">Pemain di Ruangan ({room.players.length})</span>
                {room.players.map((p) => (
                  <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/[0.08]">
                    <div className="flex items-center gap-2.5">
                      <PlayerAvatar player={p} size="md" />
                      <span className="text-sm font-bold text-white">
                        {p.name}
                        {p.id === mySocketId && <span className="text-[10px] text-gray-400 ml-1">(Kamu)</span>}
                      </span>
                      {p.isHost && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : screen === 'in-game' && currentQ && room ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between text-xs">
                <span className="px-3 py-1 rounded-full bg-black/40 text-gray-300 font-bold border border-white/[0.08]">
                  Soal {room.currentQIndex + 1} / {questionsSnapshot.length}
                </span>
                <span className="font-mono font-bold text-white">{timeLeft}s</span>
              </div>

              <h4 className="text-base sm:text-lg font-bold text-white leading-relaxed">{currentQ.question}</h4>

              {(currentQ as any).mediaUrl && (currentQ as any).mediaType && (currentQ as any).mediaType !== 'none' && (
                <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-black/40 flex items-center justify-center">
                  {(currentQ as any).mediaType === 'image' && <img src={(currentQ as any).mediaUrl} alt="Lampiran soal" className="max-h-48 w-full object-contain" />}
                  {(currentQ as any).mediaType === 'audio' && <audio src={(currentQ as any).mediaUrl} controls className="w-full h-10 p-2" />}
                  {(currentQ as any).mediaType === 'video' && <video src={(currentQ as any).mediaUrl} controls className="max-h-56 w-full" />}
                </div>
              )}

              <div className="space-y-2.5">
                {(currentQ.options || []).map((opt, oIdx) => {
                  const isSelected = userSelectedOption === oIdx;
                  const isCorrectOption = oIdx === currentQ.correctIndex;
                  let optStyle = 'border-white/10 bg-black/40 text-gray-200 hover:border-white/30';
                  if (hasAnswered) {
                    if (isCorrectOption) optStyle = 'border-emerald-500 bg-emerald-950/40 text-emerald-100 font-semibold';
                    else if (isSelected) optStyle = 'border-[#FC1212] bg-[#780000]/40 text-red-100 font-semibold';
                    else optStyle = 'border-white/[0.04] bg-black/20 opacity-40 text-gray-400';
                  }
                  return (
                    <button
                      key={oIdx}
                      disabled={hasAnswered}
                      onClick={() => handleSelectOption(oIdx)}
                      className={`w-full text-left p-3.5 rounded-xl border text-xs transition-all ${optStyle}`}
                    >
                      <strong>{String.fromCharCode(65 + oIdx)}.</strong> {opt}
                    </button>
                  );
                })}
              </div>

              {hasAnswered && answerResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    answerResult.isCorrect ? 'bg-emerald-950/30 border-emerald-500/30' : 'bg-[#780000]/25 border-red-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className={answerResult.isCorrect ? 'text-emerald-300' : 'text-red-300'}>
                      {answerResult.isCorrect ? `Benar! +${answerResult.pointsAwarded} poin` : 'Kurang tepat, 0 poin.'}
                    </span>
                  </div>
                  {currentQ.explanation && (
                    <div className="flex items-start gap-2 text-gray-300 pt-1 border-t border-white/[0.06]">
                      <Lightbulb className="w-3.5 h-3.5 text-[#FCA311] shrink-0 mt-0.5" />
                      <p className="leading-relaxed">{currentQ.explanation}</p>
                    </div>
                  )}
                </div>
              )}

              {hasAnswered && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-gray-400">Menunggu ronde berakhir ({timeLeft}s)...</span>
                  <div className="flex -space-x-2">
                    {room.players.map((p) => (
                      <span key={p.id} title={p.name} className="inline-block">
                        <PlayerAvatar player={p} size="sm" />
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
                {sortedPlayers.map((p, rank) => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-gray-300">
                      <span className="text-gray-500 font-mono w-3">{rank + 1}</span>
                      <PlayerAvatar player={p} size="sm" />
                      {p.name}
                      {p.id === mySocketId && <span className="text-[10px] text-gray-500">(Kamu)</span>}
                    </span>
                    <span className="font-mono font-bold text-[#FC1212]">{p.score}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : screen === 'podium' && room ? (
            <div className="text-center space-y-5 py-2">
              <div className="w-14 h-14 rounded-full bg-[#FC1212]/20 border border-[#FC1212] text-[#FC1212] mx-auto flex items-center justify-center">
                <Award className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-black text-white">Pertandingan Selesai</h3>
              <p className="text-[11px] text-gray-500">Hasil ini otomatis tersimpan di riwayat permainanmu.</p>

              <div className="max-w-sm mx-auto space-y-2 text-left">
                {sortedPlayers.map((p, rank) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-3 rounded-xl border ${
                      rank === 0 ? 'bg-amber-950/30 border-amber-500/40' : p.id === mySocketId ? 'bg-[#FC1212]/10 border-[#FC1212]/30' : 'bg-black/40 border-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {rank === 0 ? <Crown className="w-4 h-4 text-amber-400 shrink-0" /> : <span className="text-xs font-mono font-bold text-gray-400 w-4 text-center shrink-0">{rank + 1}</span>}
                      <PlayerAvatar player={p} size="md" />
                      <span className="text-sm font-bold text-white truncate">
                        {p.name}
                        {p.id === mySocketId && <span className="text-[10px] text-gray-400 ml-1">(Kamu)</span>}
                      </span>
                    </div>
                    <span className="text-sm font-mono font-black text-[#FC1212] shrink-0">{p.score} Poin</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-center gap-2 pt-1">
                {REACTION_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    onClick={() => handleSendReaction(emoji)}
                    className="w-9 h-9 rounded-full bg-black/40 border border-white/10 hover:bg-white/10 hover:scale-110 transition-all text-base cursor-pointer"
                  >
                    {emoji}
                  </button>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                {isHost && (
                  <button
                    onClick={handleStartGame}
                    className="px-5 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Main Lagi</span>
                  </button>
                )}
                <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 text-gray-300 text-xs font-bold cursor-pointer border border-white/[0.08]">
                  Tutup Multiplayer
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </motion.div>
    </div>
  );
};
