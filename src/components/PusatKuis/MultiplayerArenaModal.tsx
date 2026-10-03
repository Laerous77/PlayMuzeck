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
  Shuffle,
  Save,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  LogOut,
  Eye,
  EyeOff,
  UserX,
  ShieldAlert,
  SkipForward,
  UserRound,
} from 'lucide-react';
import { Deck, QuizQuestion } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { io, Socket } from 'socket.io-client';

/** Semua pemberitahuan di modal hilang sendiri setelah 5 detik. */
const NOTICE_AUTO_HIDE_MS = 5000;

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
  /** Dari layar setup Pusat Kuis: deck terpilih, jumlah soal & acak urutan. */
  initialDeckId?: string;
  questionLimit?: number;
  shuffleQuestions?: boolean;
  /** Dipanggil saat pemain dikeluarkan host. Modal langsung ditutup, pesan ditampilkan oleh halaman induk. */
  onKicked?: (message: string) => void;
}

type LeavePolicy = 'next' | 'end' | 'choose';

interface RoomPlayer {
  id: string;
  name: string;
  avatarUrl?: string;
  frameId?: string;
  isHost: boolean;
  isReady: boolean;
  /** false = pemain sedang offline (ditahan di ruangan, bisa kembali). */
  connected?: boolean;
  score: number;
  streak: number;
  lastAnswerStatus?: 'correct' | 'wrong';
  lastPointsAwarded?: number;
  /** Host pengawas: tidak ikut menjawab & tidak masuk papan skor. */
  observer?: boolean;
  /** Bergabung setelah sesi utama selesai (sesi susulan). */
  late?: boolean;
  madeUp?: boolean;
  /** Boleh menjawab di sesi yang sedang berjalan. */
  participating?: boolean;
  /** Sudah menjawab soal yang sedang berjalan. */
  answered?: boolean;
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
  hostId: string;
  totalQuestions: number;
  /** Host menahan pemain agar tidak bisa keluar saat permainan berjalan. */
  lockPlayers: boolean;
  /** Apa yang terjadi saat host keluar. */
  hostLeavePolicy: LeavePolicy;
  /** Dijeda oleh host (hanya di layar jeda antar soal). */
  paused: boolean;
  endNotice: string | null;
  /** ID pemain yang meminta host mengulang permainan. */
  rematchRequestIds?: string[];
  makeupActive?: boolean;
  /** Jumlah pemain susulan yang menunggu sesi susulan. */
  makeupPending?: number;
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

const FALLBACK_COLORS = ['bg-accent2', 'bg-blue-600', 'bg-emerald-600', 'bg-accent', 'bg-purple-600', 'bg-sky-600'];
const fallbackColorFor = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
};

/** ID stabil per browser: server memakainya untuk mengenali pemain yang kembali setelah refresh / tutup tab. */
const CLIENT_ID_KEY = 'muzeck_mp_client_id';
const getClientId = (): string => {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage tidak tersedia: ID sementara (tidak bisa dipulihkan setelah refresh).
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
};

/** Batas jeda antar soal (detik). */
const MIN_GAP_SEC = 3;
const MAX_GAP_SEC = 60;
const LB_PAGE_SIZE = 5;

// Urutan: api, tepuk tangan, ketawa, menangis, terkejut, kecewa, marah, skull, hati.
const REACTION_EMOJIS = ['🔥', '👏', '😂', '😭', '😮', '😞', '😡', '💀', '❤️'];

/** Avatar bulat + bingkai profil asli pemain (fallback: inisial warna kalau tidak ada foto). */
const PlayerAvatar: React.FC<{ player: RoomPlayer; size?: 'sm' | 'md' }> = ({ player, size = 'sm' }) => {
  const frame = PROFILE_FRAMES.find((f) => f.id === player.frameId) || PROFILE_FRAMES[0];
  const dim = size === 'md' ? 'w-9 h-9' : 'w-6 h-6';
  return (
    <div className={`relative ${dim} shrink-0 ${player.connected === false ? 'opacity-40' : ''}`}>
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

/** Papan skor yang SAMA dipakai di layar jeda & layar akhir (pageSize = paginasi, kosong = tampil semua). */
const Leaderboard: React.FC<{
  players: RoomPlayer[];
  myId: string;
  page?: number;
  pageSize?: number;
  onPage?: (n: number) => void;
  canKick?: (p: RoomPlayer) => boolean;
  onKick?: (p: RoomPlayer) => void;
}> = ({ players, myId, page = 0, pageSize, onPage, canKick, onKick }) => {
  const pageCount = pageSize ? Math.max(1, Math.ceil(players.length / pageSize)) : 1;
  const cur = Math.min(page, pageCount - 1);
  const slice = pageSize ? players.slice(cur * pageSize, cur * pageSize + pageSize) : players;
  const offset = pageSize ? cur * pageSize : 0;
  return (
    <div className="max-w-sm mx-auto space-y-2 text-left">
      {slice.map((p, i) => {
        const rank = offset + i;
        return (
          <div
            key={p.id}
            className={`flex items-center justify-between p-3 rounded-xl border ${
              rank === 0 ? 'bg-accent/10 border-accent/40' : p.id === myId ? 'bg-accent2/10 border-accent2/30' : 'bg-black/40 border-white/[0.08]'
            }`}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {rank === 0 ? (
                <Crown className="w-4 h-4 text-accent shrink-0" />
              ) : (
                <span className="text-xs font-mono font-bold text-gray-400 w-4 text-center shrink-0">{rank + 1}</span>
              )}
              <PlayerAvatar player={p} size="md" />
              <span className="text-sm font-bold text-white truncate">
                {p.name}
                {p.id === myId && <span className="text-[10px] text-gray-400 ml-1">(Kamu)</span>}
                {p.late && <span className="text-[9px] font-bold text-sky-300 ml-1.5 px-1.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30">Sesi susulan</span>}
                {p.connected === false && <span className="text-[10px] text-amber-300/80 ml-1">(offline)</span>}
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-sm font-mono font-black text-accent2">{p.score} Poin</span>
              {canKick?.(p) && onKick && (
                <button
                  onClick={() => onKick(p)}
                  title="Keluarkan pemain"
                  className="p-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 cursor-pointer"
                >
                  <UserX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      {pageSize && pageCount > 1 && onPage && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            onClick={() => onPage(Math.max(0, cur - 1))}
            disabled={cur === 0}
            className="p-1 rounded-lg bg-black/40 border border-white/10 text-gray-300 disabled:opacity-30 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-[11px] font-mono text-gray-400">
            {cur + 1}/{pageCount}
          </span>
          <button
            onClick={() => onPage(Math.min(pageCount - 1, cur + 1))}
            disabled={cur >= pageCount - 1}
            className="p-1 rounded-lg bg-black/40 border border-white/10 text-gray-300 disabled:opacity-30 cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

const POLICY_OPTIONS: { id: LeavePolicy; title: string; desc: string }[] = [
  { id: 'next', title: 'Pindah ke pemain berikutnya', desc: 'Pemain yang bergabung tepat setelah host otomatis jadi host baru.' },
  { id: 'choose', title: 'Host menunjuk pengganti', desc: 'Saat keluar, host memilih sendiri siapa host barunya.' },
  { id: 'end', title: 'Akhiri permainan', desc: 'Host keluar = permainan langsung selesai untuk semua pemain.' },
];

/** Peran host: ikut bermain atau hanya memantau (guru + pengawas). */
const HostRoleToggle: React.FC<{ observer: boolean; onChange: (v: boolean) => void }> = ({ observer, onChange }) => (
  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-2.5 text-left">
    <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
      <Eye className="w-3.5 h-3.5" /> Peran Host
    </span>
    <div className="grid grid-cols-2 gap-2">
      {[
        { v: false, t: 'Ikut Bermain', d: 'Kamu menjawab dan masuk papan skor.' },
        { v: true, t: 'Pantau Saja', d: 'Tidak menjawab, tidak masuk papan skor, tidak kirim emoji. Kontrol host tetap aktif.' },
      ].map((o) => (
        <button
          key={String(o.v)}
          type="button"
          onClick={() => onChange(o.v)}
          className={`p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
            observer === o.v ? 'bg-accent2/20 border-accent2/60' : 'bg-black/40 border-white/10 hover:border-white/30'
          }`}
        >
          <span className="text-[11px] font-bold text-white block">{o.t}</span>
          <span className="text-[10px] text-gray-500 block">{o.d}</span>
        </button>
      ))}
    </div>
  </div>
);

/** Aturan ruangan yang diatur host sebelum mulai: tahan pemain keluar + apa yang terjadi bila host keluar. */
const RoomRulesSetting: React.FC<{
  lockPlayers: boolean;
  onLockChange: (v: boolean) => void;
  policy: LeavePolicy;
  onPolicyChange: (v: LeavePolicy) => void;
}> = ({ lockPlayers, onLockChange, policy, onPolicyChange }) => (
  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-3 text-left">
    <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
      <ShieldAlert className="w-3.5 h-3.5" /> Aturan Ruangan
    </span>
    <button type="button" onClick={() => onLockChange(!lockPlayers)} className="w-full flex items-center justify-between gap-3 cursor-pointer text-left">
      <span className="min-w-0">
        <span className="text-xs font-bold text-white block">Tahan pemain keluar</span>
        <span className="text-[10px] text-gray-500 block">
          Setelah mulai, pemain tidak bisa keluar sampai selesai. Kalau menutup web, mereka tetap kembali ke permainan yang sama.
        </span>
      </span>
      <span className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${lockPlayers ? 'bg-accent2' : 'bg-white/15'}`}>
        <span className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${lockPlayers ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </span>
    </button>
    <div className="space-y-1.5 pt-2 border-t border-white/[0.06]">
      <span className="text-[11px] font-bold text-gray-300 block">Kalau host keluar</span>
      {POLICY_OPTIONS.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onPolicyChange(o.id)}
          className={`w-full p-2.5 rounded-lg border text-left transition-all cursor-pointer ${
            policy === o.id ? 'bg-accent2/20 border-accent2/60' : 'bg-black/40 border-white/10 hover:border-white/30'
          }`}
        >
          <span className="text-[11px] font-bold text-white block">
            {o.title}
            {o.id === 'next' && <span className="ml-1.5 text-[9px] font-bold text-accent2">BAWAAN</span>}
          </span>
          <span className="text-[10px] text-gray-500 block">{o.desc}</span>
        </button>
      ))}
    </div>
  </div>
);

export const MultiplayerArenaModal: React.FC<MultiplayerArenaModalProps> = ({
  isOpen,
  onClose,
  decks,
  unlockedDeckIds,
  isOnline,
  userNickname,
  userAvatarUrl,
  userFrameId,
  initialDeckId,
  questionLimit,
  shuffleQuestions,
  onKicked,
}) => {
  const socketRef = useRef<Socket | null>(null);
  // Ref supaya handler socket (dibuat sekali per pembukaan modal) selalu memanggil callback terbaru.
  const onCloseRef = useRef(onClose);
  const onKickedRef = useRef(onKicked);
  onCloseRef.current = onClose;
  onKickedRef.current = onKicked;
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'error'>('connecting');
  const [errorMsg, setErrorMsg] = useState('');

  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');
  const playableDecks = useMemo(
    () => decks.filter((d) => d.isFree || unlockedDeckIds.includes(d.id)),
    [decks, unlockedDeckIds]
  );
  // Paket kuis, jumlah soal & acak urutan SELALU mengikuti layar Konfigurasi Sesi (sama seperti mode lain).
  const selectedDeckId = playableDecks.find((d) => d.id === initialDeckId)?.id || playableDecks[0]?.id || '';
  const [roundTimeChoice, setRoundTimeChoice] = useState<number>(DEFAULT_QUESTION_TIME);
  // Skema poin berbasis waktu: SATU pengaturan saja. Poin penuh soal (dari Quiz Editor)
  // turun linear dari 100% (jawab seketika) menuju `minPointsPercent` (jawab di detik
  // terakhir). Karena rumusnya linear dari 100% ke X%, poin hasil penurunan tidak mungkin
  // lebih kecil dari poin minimal, dan poin minimal tidak mungkin lebih besar dari poin penuh.
  const [decayEnabled, setDecayEnabled] = useState<boolean>(true);
  const [minPointsPercent, setMinPointsPercent] = useState<number>(30); // 0-90 %
  // Jeda antar soal: 3 detik s/d 1 menit.
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
  // ID stabil per browser (bukan socket.id) supaya bisa kembali ke permainan yang sama.
  const [clientId] = useState<string>(getClientId);
  // ID PUBLIK milik kita di ruangan (dari server). `clientId` tetap rahasia dan tidak ditampilkan.
  const [mySocketId, setMySocketId] = useState<string>('');
  const [userSelectedOption, setUserSelectedOption] = useState<number | null>(null);
  const [answerResult, setAnswerResult] = useState<{ isCorrect: boolean; pointsAwarded: number; correctIndex: number; explanation: string } | null>(null);
  // Jawaban benar + penjelasan per soal. Server baru mengirimnya SETELAH soal dijawab / waktu habis,
  // jadi soal yang dimuat di browser tidak membawa kunci jawaban.
  const revealedRef = useRef<Record<number, { correctIndex: number; explanation: string }>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [questionsSnapshot, setQuestionsSnapshot] = useState<QuizQuestion[]>([]);
  // Indeks soal terakhir yang sudah tersimpan ke riwayat (null = belum pernah disimpan).
  const [savedUpTo, setSavedUpTo] = useState<number | null>(null);
  const [lbPage, setLbPage] = useState(0);
  const [gapLeft, setGapLeft] = useState(0);
  const [floatingReactions, setFloatingReactions] = useState<{ id: string; emoji: string; name: string }[]>([]);
  const [lockPlayers, setLockPlayers] = useState(false);
  const [hostLeavePolicy, setHostLeavePolicy] = useState<LeavePolicy>('next');
  const [showAnswer, setShowAnswer] = useState(false);
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [successorId, setSuccessorId] = useState<string>('');
  const [roomNotice, setRoomNotice] = useState('');
  // Info singkat di dalam ruangan (mis. pergantian host); hilang sendiri.
  const [hostNotice, setHostNotice] = useState('');
  // Identitas di permainan: nama & foto bisa disamarkan tanpa mengubah akun asli.
  const [displayName, setDisplayName] = useState<string>(userNickname || '');
  const [showAvatar, setShowAvatar] = useState<boolean>(true);
  // Peran host: ikut bermain, atau hanya memantau (guru/pengawas).
  const [hostObserver, setHostObserver] = useState<boolean>(false);
  // Pengawas boleh mencoba semua opsi untuk melihat jawaban benar & penjelasan (tanpa poin).
  const [peek, setPeek] = useState<{ qIndex: number; selected: number; correctIndex: number; explanation: string } | null>(null);
  // Host: pemain yang akan dikeluarkan (dialog konfirmasi).
  const [kickTarget, setKickTarget] = useState<RoomPlayer | null>(null);

  // Untuk menyusun riwayat permainan (sama seperti mode lain) begitu game selesai.
  // Pilihan jawaban pemain per indeks soal (sumber riwayat; tidak bergantung urutan event socket).
  const answersByIndexRef = useRef<Record<number, number | null>>({});

  const activeDeck = decks.find((d) => d.id === selectedDeckId) || decks[0];
  const deckTotal = activeDeck?.questions?.length || 0;
  // Persen minus saat jawaban salah, dari Quiz Editor (disimpan di deck.penaltyPercent atau deck.settings).
  const deckPenaltyPercent = Math.min(
    100,
    Math.max(0, Number((activeDeck as any)?.penaltyPercent ?? (activeDeck as any)?.settings?.penaltyPercent) || 0)
  );
  const questionCount = Math.max(1, Math.min(questionLimit ?? deckTotal, deckTotal || 1));
  const shuffleOn = Boolean(shuffleQuestions);

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
    answersByIndexRef.current = {};
    revealedRef.current = {};
    setMySocketId('');
    setSavedUpTo(null);
    setLbPage(0);
    setJoinMode('code');
    setGlobalRooms([]);
    setPendingGlobalCode(null);
    setGlobalPasswordInput('');
    setRoomVisibility('invite');
    setRoomPassword('');
    setLeaveDialogOpen(false);
    setShowAnswer(false);
    setRoomNotice('');
    setHostNotice('');
    setDisplayName(userNickname || '');
    setShowAvatar(true);
    setHostObserver(false);
    setPeek(null);
    setKickTarget(null);
  }, [isOpen]);

  // ---- Koneksi socket: dibuat setiap modal dibuka; otomatis menyambung ke permainan yang masih berlangsung ----
  useEffect(() => {
    if (!isOpen || !isOnline) return;

    const socket = io(SOCKET_URL, { path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const resetLocal = () => {
      setQuestionsSnapshot([]);
      setUserSelectedOption(null);
      setAnswerResult(null);
      setShowAnswer(false);
      setLeaveDialogOpen(false);
      setSavedUpTo(null);
      answersByIndexRef.current = {};
      revealedRef.current = {};
    };

    // Pulihkan layar pemain dari data server (soal, jawaban sendiri, hasil ronde).
    const applySync = (sync: any) => {
      if (!sync) return;
      setQuestionsSnapshot(Array.isArray(sync.questions) ? sync.questions : []);
      answersByIndexRef.current = { ...(sync.myAnswers || {}) };
      revealedRef.current = { ...(sync.revealed || {}) };
      const sel = answersByIndexRef.current[sync.currentQIndex ?? 0];
      setUserSelectedOption(sel === undefined ? null : sel);
      if (sync.myResult) setAnswerResult(sync.myResult);
      else if (sync.roundResult) setAnswerResult({ isCorrect: false, pointsAwarded: 0, ...sync.roundResult });
      else setAnswerResult(null);
    };

    socket.on('connect', () => {
      setConnectionState('connected');
      socket.emit('room:rejoin', { clientId });
    });
    socket.on('connect_error', () => {
      setConnectionState('error');
      setErrorMsg('Gagal terhubung ke server multiplayer. Coba lagi beberapa saat.');
    });

    socket.on('room:created', (p: { state: RoomState; you: string }) => {
      setRoom(p.state);
      setMySocketId(p.you);
      setErrorMsg('');
    });
    socket.on('room:joined', (p: { state: RoomState; sync: any; you: string }) => {
      setRoom(p.state);
      setMySocketId(p.you);
      applySync(p.sync);
      setErrorMsg('');
    });
    socket.on('room:resumed', (p: { state: RoomState; sync: any; you: string }) => {
      setRoom(p.state);
      setMySocketId(p.you);
      applySync(p.sync);
      setErrorMsg('');
    });
    socket.on('room:update', (state: RoomState) => setRoom(state));
    socket.on('room:error', (msg: string) => setErrorMsg(msg));
    socket.on('room:left', () => {
      setRoom(null);
      resetLocal();
    });
    socket.on('room:closed', (reason: string) => {
      setRoom(null);
      resetLocal();
      setRoomNotice(reason);
    });
    socket.on('room:kicked', (p: { banned: boolean }) => {
      const msg = p?.banned
        ? 'Kamu dikeluarkan oleh host dan diblokir dari ruangan ini.'
        : 'Kamu dikeluarkan oleh host. Skor dari ruangan itu tidak disimpan.';
      // Langsung keluar dari modal ke halaman Mainkan Kuis (tanpa tertahan di layar jeda/lobby),
      // pesannya ditampilkan oleh halaman induk lewat onKicked.
      if (onKickedRef.current) {
        onKickedRef.current(msg);
        onCloseRef.current();
      } else {
        setRoom(null);
        resetLocal();
        setRoomNotice(msg);
      }
    });
    socket.on('game:peekResult', (r: { currentQIndex: number; optionIndex: number; correctIndex: number; explanation: string }) => {
      setPeek({ qIndex: r.currentQIndex, selected: r.optionIndex, correctIndex: r.correctIndex, explanation: r.explanation });
    });
    socket.on('room:notice', (msg: string) => {
      setHostNotice(msg);
      setTimeout(() => setHostNotice((cur) => (cur === msg ? '' : cur)), NOTICE_AUTO_HIDE_MS);
    });
    socket.on('room:replaced', () => {
      setRoom(null);
      resetLocal();
      setRoomNotice('Sesi ini dilanjutkan di tab/perangkat lain.');
    });
    socket.on('room:globalList', (list: GlobalRoomListing[]) => {
      setGlobalRooms(list);
      setIsLoadingGlobalRooms(false);
    });

    socket.on('game:started', (payload: { questions: QuizQuestion[]; roundEndsAt: number; currentQIndex: number; makeup?: boolean; participating?: boolean }) => {
      // Sesi susulan untuk pemain lain: jangan hapus jawaban & hasil sesi utamaku (masih bisa disimpan).
      if (payload.makeup && payload.participating === false) {
        setQuestionsSnapshot((prev) => (prev.length ? prev : payload.questions));
        setShowAnswer(false);
        return;
      }
      setQuestionsSnapshot(payload.questions);
      setUserSelectedOption(null);
      setAnswerResult(null);
      setShowAnswer(false);
      answersByIndexRef.current = {};
      revealedRef.current = {};
      setSavedUpTo(null);
      audioEngine.playClickSound();
    });

    socket.on(
      'game:answerResult',
      (result: { currentQIndex: number; isCorrect: boolean; pointsAwarded: number; correctIndex: number; explanation: string }) => {
        revealedRef.current[result.currentQIndex] = { correctIndex: result.correctIndex, explanation: result.explanation };
        setAnswerResult(result);
        if (result.isCorrect) audioEngine.playCorrectSound();
        else if (typeof (audioEngine as any).playIncorrectSound === 'function') (audioEngine as any).playIncorrectSound();
      }
    );

    // Waktu jawab habis: server masuk 'round-result'. Yang belum menjawab tetap dapat info jawaban benar.
    socket.on(
      'game:roundEnded',
      (payload: { currentQIndex: number; correctIndex: number; explanation: string; roundResultEndsAt: number; isLastQuestion: boolean }) => {
        revealedRef.current[payload.currentQIndex] = { correctIndex: payload.correctIndex, explanation: payload.explanation };
        setAnswerResult((prev) =>
          prev ? prev : { isCorrect: false, pointsAwarded: 0, correctIndex: payload.correctIndex, explanation: payload.explanation }
        );
      }
    );

    socket.on('game:nextRound', (_payload: { currentQIndex: number; roundEndsAt: number }) => {
      setUserSelectedOption(null);
      setAnswerResult(null);
      setShowAnswer(false);
    });

    socket.on('game:ended', (p: { state: RoomState; revealed: Record<number, { correctIndex: number; explanation: string }> }) => {
      revealedRef.current = { ...revealedRef.current, ...(p.revealed || {}) };
      setRoom(p.state);
      setLeaveDialogOpen(false);
    });

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

  // ---- Pemberitahuan (merah/kuning) hilang sendiri setelah 5 detik ----
  useEffect(() => {
    if (!roomNotice) return;
    const t = setTimeout(() => setRoomNotice(''), NOTICE_AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [roomNotice]);

  useEffect(() => {
    if (!errorMsg || connectionState !== 'connected') return;
    const t = setTimeout(() => setErrorMsg(''), NOTICE_AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [errorMsg, connectionState]);

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

  // ---- Hitung mundur jeda antar soal ----
  useEffect(() => {
    if (!room || room.status !== 'round-result' || !room.roundResultEndsAt) return;
    const tick = () => setGapLeft(Math.max(0, Math.ceil((room.roundResultEndsAt! - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [room?.roundResultEndsAt, room?.status]);

  // Papan skor jeda selalu mulai dari halaman 1 di tiap jeda baru.
  useEffect(() => {
    setLbPage(0);
    setPeek(null);
  }, [room?.currentQIndex, room?.status]);

  if (!isOpen) return null;

  const currentQ: QuizQuestion | undefined = questionsSnapshot[room?.currentQIndex ?? 0];
  const me = room?.players.find((p) => p.id === mySocketId);
  const isHost = Boolean(me?.isHost);
  const hasAnswered = userSelectedOption !== null;
  // Pengawas tidak masuk papan skor.
  const sortedPlayers = room ? [...room.players].filter((p) => !p.observer).sort((a, b) => b.score - a.score) : [];
  const isObserver = Boolean(me?.observer);
  /** Selama sesi susulan, pemain lain (bukan host) tetap di layar akhir; hanya host & peserta susulan yang melihat soal. */
  const viewPodium = Boolean(room && (room.status === 'podium' || (room.makeupActive && me && !me.isHost && !me.participating)));
  const makeupRunningForOthers = Boolean(room?.makeupActive && room.status !== 'podium' && viewPodium);
  /** Menonton saja: host pengawas, atau sesi susulan milik pemain lain. */
  const spectating = Boolean(me && (me.observer || (room?.makeupActive && !me.participating)));
  const pendingLateMe = Boolean(me?.late && !me?.madeUp);
  const activeCount = room ? room.players.filter((p) => !p.observer && (room.status !== 'podium' || p.connected !== false)).length : 0;
  const minToStart = isObserver ? 1 : 2;
  const canStart = activeCount >= minToStart;
  const answeredCount = room ? room.players.filter((p) => p.participating && !p.observer && p.answered).length : 0;
  const participantCount = room ? room.players.filter((p) => p.participating && !p.observer).length : 0;
  const running = room?.status === 'in-game' || room?.status === 'round-result';
  // Host menahan pemain: non-host tidak bisa keluar selama permainan berjalan.
  const leaveLocked = Boolean(room?.lockPlayers && running && !isHost && !viewPodium);
  const needsSuccessor = Boolean(isHost && room?.hostLeavePolicy === 'choose' && (room?.players.length ?? 0) > 1 && room?.status !== 'podium');
  // Soal terakhir yang sudah selesai dikerjakan (untuk Simpan Hasil sebagian di tengah permainan).
  const saveUpTo = viewPodium ? questionsSnapshot.length - 1 : room?.currentQIndex ?? 0;
  const isResultSaved = savedUpTo === saveUpTo;
  /** Calon host otomatis (kebijakan 'next'): pemain online tepat setelah host, atau yang pertama. */
  const autoNextHost = (() => {
    if (!room) return undefined;
    const others = room.players.filter((p) => !p.isHost && p.connected !== false);
    const hostIdx = room.players.findIndex((p) => p.isHost);
    return room.players.slice(hostIdx + 1).find((p) => others.includes(p)) || others[0];
  })();

  /** Identitas yang dikirim ke server: nama pilihan sendiri, foto/bingkai hanya bila ditampilkan. */
  const identity = (fallback: string) => ({
    name: displayName.trim().slice(0, 40) || userNickname || fallback,
    avatarUrl: showAvatar ? userAvatarUrl || '' : '',
    frameId: showAvatar ? userFrameId || 'none' : 'none',
  });

  const handleCreateRoom = () => {
    if (!activeDeck) return;
    audioEngine.playClickSound();
    socketRef.current?.emit('room:create', {
      clientId,
      ...identity('Host'),
      hostObserver,
      lockPlayers,
      hostLeavePolicy,
      deckId: activeDeck.id,
      deckTitle: activeDeck.title,
      roundTimeSec: getPlayTime(activeDeck, activeDeck.questions?.[0], roundTimeChoice),
      roundGapSec: Math.min(MAX_GAP_SEC, Math.max(MIN_GAP_SEC, Math.round(roundGapSec))),
      // Satu skema: poin turun linear dari 100% ke minPointsPercent. Bila nonaktif, poin tetap penuh.
      timeDecay: decayEnabled,
      minPointsPercent: Math.min(0.9, Math.max(0, minPointsPercent / 100)),
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
      clientId,
      ...identity('Pemain'),
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
      clientId,
      ...identity('Pemain'),
    });
  };

  /** Konfirmasi password untuk Room Global yang terkunci password. */
  const handleConfirmGlobalPassword = () => {
    if (!pendingGlobalCode) return;
    setErrorMsg('');
    socketRef.current?.emit('room:join', {
      code: pendingGlobalCode,
      clientId,
      ...identity('Pemain'),
      password: globalPasswordInput.trim(),
    });
  };

  const handleCopyCode = () => {
    if (!room) return;
    navigator.clipboard?.writeText(room.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  /** Susun soal sesuai pengaturan: acak (opsional) lalu ambil sejumlah yang dipilih. */
  const prepareQuestions = (): QuizQuestion[] => {
    const all = [...(activeDeck?.questions || [])];
    if (shuffleOn) {
      for (let i = all.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [all[i], all[j]] = [all[j], all[i]];
      }
    }
    return all.slice(0, Math.max(1, Math.min(questionCount, all.length)));
  };

  const handleStartGame = () => {
    if (!activeDeck || !isHost) return;
    audioEngine.playClickSound();
    const picked = prepareQuestions();
    socketRef.current?.emit('room:start', {
      questions: picked,
      // Batas waktu per soal mengikuti pengaturan soal (Editor) atau pilihan host.
      questionTimes: picked.map((q) => getPlayTime(activeDeck, q, roundTimeChoice)),
      // Sistem minus: persen dari poin soal yang dikurangi bila salah (0 = tanpa minus).
      wrongPenaltyPercent: Math.max(0, Math.min(100, deckPenaltyPercent)),
    });
  };

  const handleSelectOption = (idx: number) => {
    if (isObserver && currentQ) {
      socketRef.current?.emit('game:peek', { optionIndex: idx });
      return;
    }
    if (hasAnswered || !currentQ || spectating) return;
    setUserSelectedOption(idx);
    answersByIndexRef.current[room?.currentQIndex ?? 0] = idx;
    audioEngine.playClickSound(); // bunyi benar/salah diputar saat server membalas hasil jawaban
    socketRef.current?.emit('game:answer', { optionIndex: idx });
  };

  /** Simpan riwayat (manual). Bisa dipakai di tengah permainan (disimpan sampai soal terakhir yang selesai) maupun di akhir. */
  const handleSaveResult = () => {
    if (!room || isResultSaved || !questionsSnapshot.length) return;
    const upTo = Math.min(saveUpTo, questionsSnapshot.length - 1);
    const final = viewPodium;
    const answers: AnswerLogEntry[] = questionsSnapshot.slice(0, upTo + 1).map((q, i) => {
      const sel = answersByIndexRef.current[i] ?? null;
      const rv = revealedRef.current[i];
      return {
        questionId: (q as any).id || `mp-q-${i}`,
        number: i + 1,
        question: q.question,
        options: q.options,
        correctIndex: rv?.correctIndex ?? -1,
        // Tidak menjawab = -1 (waktu habis). null akan salah terbaca sebagai "Dinilai host" di riwayat.
        selectedIndex: sel === null ? -1 : sel,
        isCorrect: sel !== null && rv !== undefined && sel === rv.correctIndex,
        category: q.category,
        explanation: rv?.explanation || undefined,
      };
    });
    const mine = room.players.find((p) => p.id === mySocketId);
    const entry: SavedQuizResult = {
      id: `mp-${Date.now()}`,
      savedAt: Date.now(),
      deckId: room.deckId,
      deckTitle: room.deckTitle,
      mode: 'multiplayer',
      totalQuestions: answers.length,
      summary: isObserver
        ? `Dipantau sebagai pengawas (${final ? 'permainan selesai' : `sampai soal ${upTo + 1}/${questionsSnapshot.length}`}), ${room.players.filter((p) => !p.observer).length} peserta.`
        : `${final ? 'Skor akhir' : `Skor sementara (setelah soal ${upTo + 1}/${questionsSnapshot.length})`}: ${mine?.score ?? 0} poin di antara ${room.players.filter((p) => !p.observer).length} pemain.`,
      data: { finalRank: [...room.players].filter((p) => !p.observer).sort((a, b) => b.score - a.score).map((p) => ({ name: p.late ? `${p.name} (sesi susulan)` : p.name, score: p.score })) },
      answers,
    };
    if (addSavedResult(entry)) setSavedUpTo(upTo);
    else alert('Hasil gagal disimpan: penyimpanan lokal perangkat penuh atau tidak tersedia.');
  };

  /** Host: dijeda / lanjutkan hitung mundur antar soal. */
  const handlePause = () => socketRef.current?.emit('game:pause');
  const handleResume = () => socketRef.current?.emit('game:resume');
  /** Host: lewati sisa jeda dan langsung ke soal berikutnya. */
  const handleSkipGap = () => {
    audioEngine.playClickSound();
    socketRef.current?.emit('game:skipGap');
  };
  /** Host: tombol kick tampil di lobby, jeda antar soal, dan (hanya pemain susulan) di layar akhir. */
  const canKick = (p: RoomPlayer) =>
    Boolean(room && isHost && !p.isHost && p.id !== mySocketId && (room.status === 'lobby' || room.status === 'round-result' || (room.status === 'podium' && p.late)));
  const confirmKick = (ban: boolean) => {
    if (!kickTarget) return;
    socketRef.current?.emit('room:kick', { playerId: kickTarget.id, ban });
    setKickTarget(null);
  };
  /** Host: akhiri permainan sekarang untuk semua pemain. */
  const handleEndGame = () => {
    if (window.confirm('Akhiri permainan sekarang untuk semua pemain?')) socketRef.current?.emit('game:end');
  };
  /** Host: jalankan sesi susulan khusus pemain yang bergabung belakangan. */
  const handleStartMakeup = () => {
    audioEngine.playClickSound();
    socketRef.current?.emit('room:startMakeup');
  };
  /** Host: ganti peran (ikut bermain / pantau saja) di lobby atau layar akhir. */
  const handleObserverChange = (v: boolean) => {
    setHostObserver(v);
    if (room && isHost) socketRef.current?.emit('room:settings', { hostObserver: v });
  };
  /** Non-host: minta host mengulang permainan. */
  const handleRequestRematch = () => {
    audioEngine.playClickSound();
    socketRef.current?.emit('room:requestRematch');
  };

  /** Host mengubah aturan selama masih di lobby. */
  const handleLockChange = (v: boolean) => {
    setLockPlayers(v);
    if (room && isHost) socketRef.current?.emit('room:settings', { lockPlayers: v });
  };
  const handlePolicyChange = (v: LeavePolicy) => {
    setHostLeavePolicy(v);
    if (room && isHost) socketRef.current?.emit('room:settings', { hostLeavePolicy: v });
  };

  /** Keluar dari permainan lewat dialog konfirmasi. */
  const handleLeave = () => {
    socketRef.current?.emit('room:leave', needsSuccessor && successorId ? { successorId } : undefined);
    setLeaveDialogOpen(false);
  };
  const openLeaveDialog = () => {
    setSuccessorId('');
    setLeaveDialogOpen(true);
  };
  /** Dari layar akhir: keluar dari ruangan dulu supaya tidak jadi pemain "hantu", lalu tutup modal. */
  const handleClosePodium = () => {
    socketRef.current?.emit('room:leave');
    setTimeout(onClose, 150);
  };

  const handleSendReaction = (emoji: string) => {
    socketRef.current?.emit('room:reaction', { emoji });
  };

  const screen: 'lobby-menu' | 'waiting-room' | 'in-game' | 'round-result' | 'podium' = !room
    ? 'lobby-menu'
    : room.status === 'lobby'
    ? 'waiting-room'
    : viewPodium
    ? 'podium'
    : room.status === 'in-game'
    ? 'in-game'
    : room.status === 'round-result'
    ? 'round-result'
    : 'podium';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-3xl rounded-2xl bg-surface border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh] relative"
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
            <div className="p-2.5 rounded-xl bg-accent2 text-on-accent2 shadow-md shadow-accent2/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">Multiplayer Arena</h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent2/20 text-accent2 border border-accent2/30">
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
          <div className="bg-red-900/40 border-b border-accent2/30 px-5 py-2.5 flex items-center gap-2.5 text-xs text-red-200">
            <WifiOff className="w-4 h-4 text-accent2 flex-shrink-0" />
            <span>Mode Offline Terdeteksi. Fitur Multiplayer membutuhkan koneksi jaringan aktif.</span>
          </div>
        )}

        {isOnline && connectionState !== 'connected' && (
          <div className="bg-black/40 border-b border-white/10 px-5 py-2.5 flex items-center gap-2.5 text-xs text-gray-300">
            {connectionState === 'connecting' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
                <span>Menghubungkan ke server multiplayer...</span>
              </>
            ) : (
              <span className="text-red-300">{errorMsg || 'Gagal terhubung ke server.'}</span>
            )}
          </div>
        )}

        {hostNotice && room && (
          <div className="bg-accent2/15 border-b border-accent2/30 px-5 py-2 text-xs text-accent2 font-bold">{hostNotice}</div>
        )}

        {errorMsg && connectionState === 'connected' && (
          <div className="bg-red-900/30 border-b border-red-500/20 px-5 py-2 text-xs text-red-200">{errorMsg}</div>
        )}

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {screen === 'lobby-menu' ? (
            <div className="space-y-6">
              {roomNotice && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-start justify-between gap-3">
                  <span>{roomNotice}</span>
                  <button onClick={() => setRoomNotice('')} className="text-amber-200/70 hover:text-white cursor-pointer">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-3">
                <span className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                  <UserRound className="w-3.5 h-3.5" />
                  Identitas di Permainan
                </span>
                <div className="flex items-center gap-3">
                  {/* Pratinjau identik dengan yang dilihat pemain lain: foto + bingkai profil asli */}
                  <PlayerAvatar
                    size="md"
                    player={{
                      id: displayName || 'x',
                      name: displayName.trim() || userNickname || '?',
                      avatarUrl: showAvatar ? userAvatarUrl || '' : '',
                      frameId: showAvatar ? userFrameId || 'none' : 'none',
                    } as any}
                  />
                  <input
                    type="text"
                    value={displayName}
                    maxLength={40}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder={userNickname || 'Nama kamu di permainan'}
                    className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-black/60 border border-white/10 text-white text-sm outline-none focus:border-accent2"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowAvatar((v) => !v)}
                  className={`w-full px-3 py-2 rounded-lg border text-[11px] font-bold flex items-center justify-center gap-2 cursor-pointer transition-all ${
                    showAvatar ? 'bg-accent2/15 border-accent2/40 text-accent2' : 'bg-black/40 border-white/10 text-gray-400'
                  }`}
                >
                  {showAvatar ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  <span>{showAvatar ? 'Foto profil ditampilkan' : 'Foto profil disembunyikan'}</span>
                </button>
                <p className="text-[10px] text-gray-500">
                  Nama dan foto ini hanya berlaku di ruangan ini, akun aslimu tidak berubah. Kosongkan nama untuk memakai nama akun.
                </p>
              </div>

              <div className="flex rounded-xl bg-black/40 p-1 border border-white/[0.08]">
                <button
                  onClick={() => setActiveTab('create')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'create' ? 'bg-accent2 text-on-accent2 shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  Buat Ruangan Baru
                </button>
                <button
                  onClick={() => setActiveTab('join')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${activeTab === 'join' ? 'bg-accent2 text-on-accent2 shadow' : 'text-gray-400 hover:text-white'}`}
                >
                  Gabung dengan Kode Room
                </button>
              </div>

              {activeTab === 'create' ? (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-2">
                    <span className="text-xs font-bold text-gray-300 block">Kuis yang Dimainkan</span>
                    <p className="text-sm font-bold text-white">{activeDeck?.title || 'Belum ada kuis yang bisa dimainkan'}</p>
                    <div className="flex flex-wrap gap-2 text-[11px] text-gray-300">
                      <span className="px-2.5 py-1 rounded-full bg-black/40 border border-white/10 font-mono">
                        {questionCount} dari {deckTotal} soal
                      </span>
                      <span className="px-2.5 py-1 rounded-full bg-black/40 border border-white/10 flex items-center gap-1">
                        <Shuffle className="w-3 h-3" /> {shuffleOn ? 'Urutan diacak' : 'Urutan berurutan'}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500">
                      Mengikuti Konfigurasi Sesi (sama seperti mode lain). Untuk mengubah paket, jumlah soal, atau acak urutan,
                      tutup jendela ini dan ubah di layar konfigurasi.
                    </p>
                  </div>

                  <HostRoleToggle observer={hostObserver} onChange={setHostObserver} />

                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-3">
                    <span className="text-xs font-bold text-gray-300 block">Visibilitas Ruangan</span>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setRoomVisibility('invite')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          roomVisibility === 'invite'
                            ? 'bg-accent2 border-accent2 text-on-accent2'
                            : 'bg-black/40 border-white/10 text-gray-300 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <Lock className="w-3.5 h-3.5" />
                          <span>Undangan</span>
                        </div>
                        <p className={`text-[10px] mt-0.5 ${roomVisibility === 'invite' ? 'text-on-accent2/80' : 'text-gray-500'}`}>
                          Hanya bisa dimasuki lewat kode ruangan.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRoomVisibility('global')}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          roomVisibility === 'global'
                            ? 'bg-accent2 border-accent2 text-on-accent2'
                            : 'bg-black/40 border-white/10 text-gray-300 hover:border-white/30'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 font-bold text-xs">
                          <Globe className="w-3.5 h-3.5" />
                          <span>Global</span>
                        </div>
                        <p className={`text-[10px] mt-0.5 ${roomVisibility === 'global' ? 'text-on-accent2/80' : 'text-gray-500'}`}>
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
                          className="w-full p-2.5 rounded-lg bg-black/50 border border-white/[0.08] text-white text-xs focus:border-accent2 focus:outline-none"
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
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-300">Poin Turun Seiring Waktu</span>
                      <button
                        type="button"
                        onClick={() => setDecayEnabled((v) => !v)}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <span className={`w-9 h-5 rounded-full relative transition-colors ${decayEnabled ? 'bg-accent2' : 'bg-white/15'}`}>
                          <span
                            className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${decayEnabled ? 'translate-x-4' : 'translate-x-0.5'}`}
                          />
                        </span>
                        <span className="text-[11px] text-gray-400">{decayEnabled ? 'Aktif' : 'Nonaktif'}</span>
                      </button>
                    </div>
                    <p className="text-[10px] text-gray-500 -mt-1">
                      Poin penuh tiap soal mengikuti pengaturan Quiz Editor ("Poin Sama Rata" atau "Poin Berbeda").
                    </p>
                    {decayEnabled ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[11px] text-gray-400">
                          <span>Poin terendah di detik terakhir</span>
                          <span className="font-mono font-bold text-white">{minPointsPercent}% dari poin soal</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={90}
                          step={5}
                          value={minPointsPercent}
                          onChange={(e) => setMinPointsPercent(Number(e.target.value))}
                          className="w-full accent-accent2"
                        />
                        <p className="text-[10px] text-gray-500">
                          Jawab langsung = 100% poin. Makin lama menjawab, poin turun merata hingga {minPointsPercent}% di
                          detik terakhir. Karena satu skala ini, poin terendah selalu di bawah poin penuh dan tidak
                          pernah lebih besar dari poin hasil penurunan. Salah atau tidak menjawab tidak mendapat poin
                          kecuali soal memakai sistem minus.
                        </p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-gray-500">
                        Jawaban benar selalu mendapat poin penuh soal, seberapa cepat pun dijawab.
                      </p>
                    )}
                    {(deckPenaltyPercent) > 0 && (
                      <p className="text-[10px] text-amber-300/90 pt-1 border-t border-white/[0.06]">
                        Kuis ini memakai sistem minus: jawaban salah mengurangi {deckPenaltyPercent}% dari poin soal.
                      </p>
                    )}
                  </div>

                  <div className="p-3.5 rounded-xl bg-black/30 border border-white/[0.06] space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-400">
                      <span className="text-xs font-bold text-gray-300">Jeda Sebelum Soal Berikutnya</span>
                      <span className="font-mono font-bold text-white">
                        {roundGapSec >= 60 ? '1 mnt' : `${roundGapSec}s`}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={MIN_GAP_SEC}
                      max={MAX_GAP_SEC}
                      step={1}
                      value={roundGapSec}
                      onChange={(e) => setRoundGapSec(Math.min(MAX_GAP_SEC, Math.max(MIN_GAP_SEC, Number(e.target.value))))}
                      className="w-full accent-accent2"
                    />
                    <p className="text-[10px] text-gray-500">
                      Setelah waktu jawab habis, semua pemain melihat jawaban benar & 5 besar papan skor selama jeda
                      ini. Minimal {MIN_GAP_SEC} detik, maksimal 1 menit.
                    </p>
                  </div>

                  <RoomRulesSetting
                    lockPlayers={lockPlayers}
                    onLockChange={handleLockChange}
                    policy={hostLeavePolicy}
                    onPolicyChange={handlePolicyChange}
                  />

                  <button
                    onClick={handleCreateRoom}
                    disabled={!isOnline || connectionState !== 'connected' || !activeDeck}
                    className="w-full py-3 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 font-extrabold text-xs shadow-lg shadow-accent2/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
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
                          placeholder="Misal: MZK-7K2P"
                          className="w-full p-3 rounded-xl bg-black/50 border border-white/[0.08] text-white text-xs font-mono uppercase tracking-widest focus:border-accent2 focus:outline-none"
                        />
                      </div>

                      <button
                        onClick={handleJoinRoom}
                        disabled={!isOnline || connectionState !== 'connected'}
                        className="w-full py-3 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 font-extrabold text-xs shadow-lg shadow-accent2/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
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
                                  <span className="text-xs font-mono font-black text-accent2">{r.code}</span>
                                  {r.hasPassword && <Lock className="w-3 h-3 text-accent shrink-0" />}
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
                                    className="w-24 p-1.5 rounded-lg bg-black/60 border border-white/10 text-white text-[11px] focus:border-accent2 focus:outline-none"
                                  />
                                  <button
                                    onClick={handleConfirmGlobalPassword}
                                    className="px-2.5 py-1.5 rounded-lg bg-accent2 hover:bg-accent2/80 text-on-accent2 text-[11px] font-bold cursor-pointer"
                                  >
                                    OK
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => handlePickGlobalRoom(r)}
                                  className="px-3 py-1.5 rounded-lg bg-accent2 hover:bg-accent2/80 text-on-accent2 text-[11px] font-bold shrink-0 cursor-pointer"
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
                    <span className="text-xl font-mono font-black text-accent2 tracking-wider">{room.code}</span>
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
                    disabled={!canStart}
                    className="px-6 py-2.5 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 font-extrabold text-xs shadow-lg shadow-accent2/25 transition-all cursor-pointer disabled:opacity-40"
                  >
                    {!canStart ? (isObserver ? 'Menunggu Peserta...' : 'Menunggu Pemain Lain...') : 'Mulai Kuis'}
                  </button>
                ) : (
                  <span className="text-xs text-gray-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Menunggu host memulai...
                  </span>
                )}
              </div>

              {isHost && <HostRoleToggle observer={isObserver} onChange={handleObserverChange} />}

              {isHost ? (
                <RoomRulesSetting
                  lockPlayers={room.lockPlayers}
                  onLockChange={handleLockChange}
                  policy={room.hostLeavePolicy}
                  onPolicyChange={handlePolicyChange}
                />
              ) : (
                <div className="flex flex-wrap gap-2 text-[10px] text-gray-400">
                  <span className="px-2.5 py-1 rounded-full bg-black/40 border border-white/10">
                    {room.lockPlayers ? 'Pemain ditahan: tidak bisa keluar saat permainan berjalan' : 'Pemain bebas keluar'}
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-black/40 border border-white/10">
                    Host keluar: {POLICY_OPTIONS.find((o) => o.id === room.hostLeavePolicy)?.title}
                  </span>
                </div>
              )}

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
                      {p.isHost && <Crown className="w-3.5 h-3.5 text-accent" />}
                      {p.observer && <span className="text-[10px] font-bold text-sky-300 px-1.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-500/30">Pengawas</span>}
                      {p.connected === false && <span className="text-[10px] text-amber-300/80">offline</span>}
                    </div>
                    {canKick(p) && (
                      <button
                        onClick={() => setKickTarget(p)}
                        title="Keluarkan pemain"
                        className="p-1.5 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 cursor-pointer"
                      >
                        <UserX className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex justify-center">
                <button
                  onClick={openLeaveDialog}
                  className="px-4 py-2 rounded-xl bg-black/60 hover:bg-black/90 border border-white/[0.08] text-gray-300 text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Keluar dari Ruangan</span>
                </button>
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

              {(spectating || isHost) && (
                <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-[11px] text-sky-200">
                  <span>
                    {isObserver
                      ? 'Mode pantau: kamu tidak ikut menjawab.'
                      : spectating
                      ? 'Sesi susulan untuk pemain lain sedang berlangsung. Kamu menonton.'
                      : 'Kamu host.'}
                    {participantCount > 0 && ` ${answeredCount}/${participantCount} sudah menjawab.`}
                  </span>
                  {isHost && (
                    <button
                      onClick={handleEndGame}
                      className="px-3 py-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white font-bold shrink-0 cursor-pointer"
                    >
                      Akhiri Permainan
                    </button>
                  )}
                </div>
              )}

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
                  const peekHere = isObserver && peek && peek.qIndex === room.currentQIndex ? peek : null;
                  const isSelected = peekHere ? peekHere.selected === oIdx : userSelectedOption === oIdx;
                  const isCorrectOption = peekHere ? peekHere.selected === oIdx && oIdx === peekHere.correctIndex : answerResult !== null && oIdx === answerResult.correctIndex;
                  let optStyle = 'border-white/10 bg-black/40 text-gray-200 hover:border-white/30';
                  if (peekHere) {
                    if (peekHere.selected === oIdx) optStyle = isCorrectOption ? 'border-emerald-500 bg-emerald-950/40 text-emerald-100 font-semibold' : 'border-red-500/60 bg-red-950/30 text-red-100 font-semibold';
                    else if (oIdx === peekHere.correctIndex) optStyle = 'border-emerald-500/50 bg-emerald-950/20 text-emerald-200';
                  } else if (hasAnswered) {
                    if (isCorrectOption) optStyle = 'border-emerald-500 bg-emerald-950/40 text-emerald-100 font-semibold';
                    else if (isSelected) optStyle = 'border-accent2 bg-accent2/40 text-white font-semibold';
                    else optStyle = 'border-white/[0.04] bg-black/20 opacity-40 text-gray-400';
                  }
                  return (
                    <button
                      key={oIdx}
                      disabled={isObserver ? false : hasAnswered || spectating}
                      onClick={() => handleSelectOption(oIdx)}
                      className={`w-full text-left p-3.5 rounded-xl border text-xs transition-all ${optStyle}`}
                    >
                      <strong>{String.fromCharCode(65 + oIdx)}.</strong> {opt}
                    </button>
                  );
                })}
              </div>

              {isObserver && (
                <div className="p-3.5 rounded-xl bg-black/40 border border-white/[0.08] text-xs space-y-1.5">
                  {peek && peek.qIndex === room.currentQIndex ? (
                    <>
                      <span className={`font-bold block ${peek.selected === peek.correctIndex ? 'text-emerald-300' : 'text-red-300'}`}>
                        {peek.selected === peek.correctIndex
                          ? 'Opsi ini benar.'
                          : `Opsi ini salah. Jawaban benar: ${String.fromCharCode(65 + peek.correctIndex)}.`}
                      </span>
                      {peek.explanation && (
                        <div className="flex items-start gap-2 text-gray-300 pt-1 border-t border-white/[0.06]">
                          <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                          <p className="leading-relaxed">{peek.explanation}</p>
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-gray-400">Klik opsi mana pun untuk memeriksa benar/salahnya beserta penjelasan. Tidak memengaruhi poin.</span>
                  )}
                </div>
              )}

              {hasAnswered && answerResult && (
                <div
                  className={`p-3.5 rounded-xl border text-xs space-y-1.5 ${
                    answerResult.isCorrect ? 'bg-emerald-950/30 border-emerald-500/30' : 'bg-accent2/25 border-red-500/30'
                  }`}
                >
                  <div className="flex items-center justify-between font-bold">
                    <span className={answerResult.isCorrect ? 'text-emerald-300' : 'text-red-300'}>
                      {answerResult.isCorrect
                        ? `Benar! +${answerResult.pointsAwarded} poin`
                        : answerResult.pointsAwarded < 0
                        ? `Kurang tepat, ${answerResult.pointsAwarded} poin.`
                        : 'Kurang tepat, 0 poin.'}
                    </span>
                  </div>
                  {answerResult.explanation && (
                    <div className="flex items-start gap-2 text-gray-300 pt-1 border-t border-white/[0.06]">
                      <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                      <p className="leading-relaxed">{answerResult.explanation}</p>
                    </div>
                  )}
                </div>
              )}

              {hasAnswered && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[11px] text-gray-400">Menunggu pemain lain ({timeLeft}s)...</span>
                  <div className="flex -space-x-2">
                    {room.players.filter((p) => !p.observer && p.participating).map((p) => (
                      <span key={p.id} title={p.name} className="inline-block">
                        <PlayerAvatar player={p} size="sm" />
                      </span>
                    ))}
                  </div>
                </div>
              )}

            </div>
          ) : screen === 'round-result' && room ? (
            <div className="text-center space-y-5 py-2">
              <div className="flex items-center justify-between text-xs">
                <span className="px-3 py-1 rounded-full bg-black/40 text-gray-300 font-bold border border-white/[0.08]">
                  Soal {room.currentQIndex + 1} / {questionsSnapshot.length || room.totalQuestions}
                </span>
                <span className="font-mono font-bold text-white">
                  {room.paused
                    ? 'Dijeda host'
                    : `${room.currentQIndex + 1 >= (questionsSnapshot.length || room.totalQuestions) ? 'Hasil akhir' : 'Soal berikutnya'} dalam ${gapLeft}s`}
                </span>
              </div>

              <div className="w-14 h-14 rounded-full bg-accent2/20 border border-accent2 text-accent2 mx-auto flex items-center justify-center">
                {room.paused ? <Pause className="w-7 h-7" /> : <Award className="w-7 h-7" />}
              </div>
              <h3 className="text-xl font-black text-white">{room.paused ? 'Permainan Dijeda' : 'Papan Skor Sementara'}</h3>
              <p className="text-[11px] text-gray-500">
                {room.paused
                  ? isHost
                    ? 'Tekan Lanjutkan kalau semua sudah siap.'
                    : 'Menunggu host melanjutkan permainan.'
                  : 'Skor setelah soal ini. Soal berikutnya mulai otomatis.'}
              </p>

              <Leaderboard players={sortedPlayers} myId={mySocketId} page={lbPage} pageSize={LB_PAGE_SIZE} onPage={setLbPage} canKick={canKick} onKick={setKickTarget} />

              {!isObserver && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
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
              )}

              {showAnswer && currentQ && (
                <div className="max-w-md mx-auto text-left space-y-2.5 p-4 rounded-xl bg-black/40 border border-white/[0.08]">
                  <h4 className="text-sm font-bold text-white leading-relaxed">{currentQ.question}</h4>
                  <div className="space-y-1.5">
                    {(currentQ.options || []).map((opt, oIdx) => {
                      const isCorrectOption = answerResult !== null && oIdx === answerResult.correctIndex;
                      const isSelected = userSelectedOption === oIdx;
                      const style = isCorrectOption
                        ? 'border-emerald-500 bg-emerald-950/40 text-emerald-100 font-semibold'
                        : isSelected
                        ? 'border-accent2 bg-accent2/40 text-white font-semibold'
                        : 'border-white/[0.04] bg-black/20 opacity-40 text-gray-400';
                      return (
                        <div key={oIdx} className={`w-full p-2.5 rounded-lg border text-xs ${style}`}>
                          <strong>{String.fromCharCode(65 + oIdx)}.</strong> {opt}
                        </div>
                      );
                    })}
                  </div>
                  {answerResult && (
                    <p className={`text-xs font-bold ${answerResult.isCorrect ? 'text-emerald-300' : 'text-red-300'}`}>
                      {answerResult.isCorrect
                        ? `Benar! +${answerResult.pointsAwarded} poin`
                        : !hasAnswered
                        ? 'Tidak menjawab, 0 poin.'
                        : answerResult.pointsAwarded < 0
                        ? `Kurang tepat, ${answerResult.pointsAwarded} poin.`
                        : 'Kurang tepat, 0 poin.'}
                    </p>
                  )}
                  {answerResult?.explanation ? (
                    <div className="flex items-start gap-2 text-xs text-gray-300 pt-1 border-t border-white/[0.06]">
                      <Lightbulb className="w-3.5 h-3.5 text-accent shrink-0 mt-0.5" />
                      <p className="leading-relaxed">{answerResult.explanation}</p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-gray-500">Soal ini tidak punya penjelasan.</p>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setShowAnswer((v) => !v)}
                  className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 border border-white/[0.08] text-gray-200 text-xs font-bold flex items-center gap-2 cursor-pointer"
                >
                  {showAnswer ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{showAnswer ? 'Sembunyikan Jawaban' : 'Tampilkan Jawaban & Penjelasan'}</span>
                </button>
                <button
                  onClick={handleSaveResult}
                  disabled={isResultSaved}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer border transition-all ${
                    isResultSaved
                      ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                      : 'bg-black/60 hover:bg-black/90 border-white/[0.08] text-gray-200'
                  }`}
                >
                  {isResultSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                  <span>{isResultSaved ? 'Hasil Tersimpan' : 'Simpan Hasil'}</span>
                </button>
                {isHost && (
                  <button
                    onClick={room.paused ? handleResume : handlePause}
                    className="px-5 py-2.5 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all"
                  >
                    {room.paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    <span>{room.paused ? 'Lanjutkan' : 'Jeda Permainan'}</span>
                  </button>
                )}
                {isHost && (
                  <button
                    onClick={handleSkipGap}
                    className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 border border-accent2/40 text-accent2 text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                    <span>Lewati Jeda</span>
                  </button>
                )}
                {isHost && (
                  <button
                    onClick={handleEndGame}
                    className="px-5 py-2.5 rounded-xl bg-red-600/80 hover:bg-red-600 text-white text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Akhiri Permainan</span>
                  </button>
                )}
                <button
                  onClick={openLeaveDialog}
                  disabled={leaveLocked}
                  title={leaveLocked ? 'Host menahan pemain sampai permainan selesai' : undefined}
                  className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 border border-white/[0.08] text-gray-300 text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Keluar dari Permainan</span>
                </button>
              </div>
              {leaveLocked && (
                <p className="text-[10px] text-amber-300/80">Host menahan pemain: kamu baru bisa keluar setelah permainan selesai.</p>
              )}
            </div>
          ) : screen === 'podium' && room ? (
            <div className="text-center space-y-5 py-2">
              <div className="w-14 h-14 rounded-full bg-accent2/20 border border-accent2 text-accent2 mx-auto flex items-center justify-center">
                <Award className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-black text-white">Pertandingan Selesai</h3>
              {makeupRunningForOthers && (
                <p className="text-[11px] font-bold text-sky-200 px-3 py-1.5 rounded-lg bg-sky-500/10 border border-sky-500/30 inline-block">
                  Sesi susulan sedang berlangsung untuk pemain yang bergabung belakangan. Skor mereka diperbarui di bawah.
                </p>
              )}
              {room.endNotice && (
                <p className="text-[11px] font-bold text-amber-300 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 inline-block">
                  {room.endNotice}
                </p>
              )}
              <p className="text-[11px] text-gray-500">Simpan hasil ini kalau mau dilihat lagi di riwayat permainanmu.</p>

              <Leaderboard players={sortedPlayers} myId={mySocketId} canKick={canKick} onKick={setKickTarget} />
              {sortedPlayers.some((p) => p.late) && (
                <p className="text-[10px] text-sky-300/80">
                  "Sesi susulan" = bergabung setelah permainan utama selesai, jadi skornya dari sesi terpisah.
                </p>
              )}
              {pendingLateMe && (
                <p className="text-xs font-bold text-sky-200 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 inline-block">
                  Kamu bergabung setelah permainan selesai. Tunggu host memulai sesi susulan untukmu.
                </p>
              )}

              {!isObserver && (
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
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
              )}

              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                {questionsSnapshot.length > 0 && (
                  <button
                    onClick={handleSaveResult}
                    disabled={isResultSaved}
                    className={`px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 cursor-pointer border transition-all ${
                      isResultSaved
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                        : 'bg-black/60 hover:bg-black/90 border-white/[0.08] text-gray-200'
                    }`}
                  >
                    {isResultSaved ? <Check className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
                    <span>{isResultSaved ? 'Hasil Tersimpan' : 'Simpan Hasil'}</span>
                  </button>
                )}
                {isHost && (room.makeupPending ?? 0) > 0 && (
                  <button
                    onClick={handleStartMakeup}
                    className="px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Mulai Sesi Susulan ({room.makeupPending})</span>
                  </button>
                )}
                {isHost && (room.rematchRequestIds?.length ?? 0) > 0 && (
                  <p className="w-full text-[11px] text-accent2 font-bold">
                    {room.players
                      .filter((p) => room.rematchRequestIds!.includes(p.id))
                      .map((p) => p.name)
                      .join(', ')}{' '}
                    minta main lagi
                  </p>
                )}
                {isHost ? (
                  <button
                    onClick={handleStartGame}
                    disabled={!canStart}
                    className="px-5 py-2.5 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{!canStart ? `Main Lagi (butuh ${minToStart} ${isObserver ? 'peserta' : 'pemain'})` : 'Main Lagi'}</span>
                  </button>
                ) : pendingLateMe || makeupRunningForOthers ? null : (
                  room.rematchRequestIds?.includes(mySocketId) ? (
                    <span className="px-5 py-2.5 rounded-xl bg-black/40 border border-white/[0.08] text-gray-400 text-xs font-bold flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Permintaan terkirim, menunggu host</span>
                    </span>
                  ) : (
                    <button
                      onClick={handleRequestRematch}
                      className="px-5 py-2.5 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Minta Main Lagi</span>
                    </button>
                  )
                )}
                <button
                  onClick={handleClosePodium}
                  className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 text-gray-300 text-xs font-bold cursor-pointer border border-white/[0.08]"
                >
                  Tutup Multiplayer
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Dialog keluarkan pemain */}
        {kickTarget && room && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-[#0b1512] border border-white/10 p-5 space-y-3 text-left">
              <h4 className="text-sm font-black text-white flex items-center gap-2">
                <UserX className="w-4 h-4 text-red-300" />
                Keluarkan {kickTarget.name}?
              </h4>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                Skornya di ruangan ini ({kickTarget.score} poin) dibuang dan tidak bisa dipulihkan. Pilih apakah dia boleh gabung lagi.
              </p>
              <button
                onClick={() => confirmKick(false)}
                className="w-full p-2.5 rounded-lg bg-black/60 hover:bg-black/90 border border-white/10 text-left cursor-pointer"
              >
                <span className="text-xs font-bold text-white block">Keluarkan saja</span>
                <span className="text-[10px] text-gray-500 block">Boleh gabung lagi lewat kode/Room Global, dihitung pemain baru (skor 0).</span>
              </button>
              <button
                onClick={() => confirmKick(true)}
                className="w-full p-2.5 rounded-lg bg-red-600/20 hover:bg-red-600/30 border border-red-500/40 text-left cursor-pointer"
              >
                <span className="text-xs font-bold text-red-200 block">Keluarkan &amp; blokir</span>
                <span className="text-[10px] text-red-200/60 block">Tidak bisa gabung lagi ke ruangan ini sampai ruangan dihapus.</span>
              </button>
              <button onClick={() => setKickTarget(null)} className="w-full py-2 text-xs font-bold text-gray-400 hover:text-white cursor-pointer">
                Batal
              </button>
            </div>
          </div>
        )}

        {/* Dialog konfirmasi keluar */}
        {leaveDialogOpen && room && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-4">
            <div className="w-full max-w-sm rounded-2xl bg-surface border border-white/10 p-5 space-y-3 shadow-2xl">
              <h4 className="text-base font-black text-white flex items-center gap-2">
                <LogOut className="w-4 h-4 text-accent2" /> Keluar dari permainan?
              </h4>
              {isHost ? (
                room.status === 'podium' || room.hostLeavePolicy === 'next' ? (
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Kamu host.{' '}
                    {room.players.length > 1
                      ? `Host akan berpindah ke ${autoNextHost?.name || 'pemain lain'} dan permainan berlanjut.`
                      : 'Karena tidak ada pemain lain, ruangan akan ditutup.'}
                  </p>
                ) : room.hostLeavePolicy === 'end' ? (
                  <p className="text-xs text-gray-300 leading-relaxed">
                    Kamu host. Kalau kamu keluar, permainan langsung diakhiri untuk semua pemain
                    {room.status === 'lobby' ? ' dan ruangan ditutup.' : '.'}
                  </p>
                ) : needsSuccessor ? (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-300">Kamu host. Pilih siapa yang jadi host berikutnya:</p>
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {room.players
                        .filter((p) => !p.isHost)
                        .map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setSuccessorId(p.id)}
                            className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left cursor-pointer ${
                              successorId === p.id ? 'bg-accent2/20 border-accent2/60' : 'bg-black/40 border-white/10'
                            }`}
                          >
                            <PlayerAvatar player={p} size="sm" />
                            <span className="text-xs font-bold text-white truncate">{p.name}</span>
                            {p.connected === false && <span className="text-[10px] text-amber-300/80">offline</span>}
                          </button>
                        ))}
                    </div>
                    <p className="text-[10px] text-gray-500">Kalau tidak memilih, host berpindah ke pemain yang bergabung setelahmu.</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-300">Karena tidak ada pemain lain, ruangan akan ditutup.</p>
                )
              ) : (
                <p className="text-xs text-gray-300 leading-relaxed">
                  {running ? 'Kamu akan keluar dan skormu hilang dari papan skor. ' : ''}Simpan hasil dulu kalau perlu.
                </p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  onClick={() => setLeaveDialogOpen(false)}
                  className="px-4 py-2 rounded-xl bg-black/60 border border-white/10 text-gray-300 text-xs font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  onClick={handleLeave}
                  className="px-4 py-2 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 text-xs font-extrabold cursor-pointer"
                >
                  Ya, Keluar
                </button>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
};
