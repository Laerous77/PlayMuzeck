// src/components/PusatKuis/MultiplayerArenaModal.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  getPlayTime,
  isEditorDeck,
  describeEditorDeckTime,
  DEFAULT_QUESTION_TIME,
} from '../../services/questionTime';
import { QuestionTimerSetting } from './QuestionTimerSetting';
import { motion } from 'motion/react';
import {
  X,
  Users,
  WifiOff,
  Copy,
  Check,
  Play,
  Crown,
  Sparkles,
  Clock,
  Award,
  CheckCircle2,
  XCircle,
  RotateCcw,
  ShieldAlert,
  ArrowRight,
} from 'lucide-react';
import { Deck, QuizQuestion } from '../../types';
import { audioEngine } from '../../services/audioEngine';

interface MultiplayerArenaModalProps {
  isOpen: boolean;
  onClose: () => void;
  decks: Deck[];
  unlockedDeckIds: string[];
  isOnline: boolean;
  userNickname: string;
}

interface RoomPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  avatarBg: string;
  score: number;
  streak: number;
  lastAnswerStatus?: 'correct' | 'wrong' | 'waiting';
}

export const MultiplayerArenaModal: React.FC<MultiplayerArenaModalProps> = ({
  isOpen,
  onClose,
  decks,
  unlockedDeckIds,
  isOnline,
  userNickname,
}) => {
  const [screen, setScreen] = useState<'lobby-menu' | 'waiting-room' | 'in-game' | 'podium'>('lobby-menu');
  const [activeTab, setActiveTab] = useState<'create' | 'join'>('create');

  const playableDecks = decks.filter((d) => d.isFree || unlockedDeckIds.includes(d.id));
  const [selectedDeckId, setSelectedDeckId] = useState<string>(playableDecks[0]?.id || 'deck-starter-1');
  // Waktu per soal pilihan pembuat ruangan (hanya untuk kuis bawaan; kuis Editor dikunci)
  const [roundTimeChoice, setRoundTimeChoice] = useState<number>(DEFAULT_QUESTION_TIME);

  const [roomCode, setRoomCode] = useState<string>('');
  const [joinCodeInput, setJoinCodeInput] = useState<string>('');
  const [copied, setCopied] = useState(false);

  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [isUserReady, setIsUserReady] = useState(true);

  const activeDeck = decks.find((d) => d.id === selectedDeckId) || decks[0];
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [userSelectedOption, setUserSelectedOption] = useState<number | null>(null);
  const [isRoundFinished, setIsRoundFinished] = useState(false);
  const gameTimerRef = useRef<NodeJS.Timeout | null>(null);

  if (!isOpen) return null;

  const currentQ: QuizQuestion | undefined = activeDeck?.questions[currentQIndex];
  // Multiplayer selalu memakai timer: pilihan pembuat ruangan (kuis bawaan) atau waktu dari pembuat kuis (kuis Editor).
  const roundTimerSec = getPlayTime(activeDeck, currentQ, roundTimeChoice);

  const handleCreateRoom = () => {
    const generatedCode = 'MZK-' + Math.floor(100 + Math.random() * 900);
    setRoomCode(generatedCode);

    const initialPlayers: RoomPlayer[] = [
      {
        id: 'p-me',
        name: userNickname || 'Kamu (Host)',
        isHost: true,
        isReady: true,
        avatarBg: 'bg-[#FC1212]',
        score: 0,
        streak: 0,
      },
      {
        id: 'p-bot-1',
        name: 'Rian_Beat',
        isHost: false,
        isReady: true,
        avatarBg: 'bg-blue-600',
        score: 0,
        streak: 0,
      },
      {
        id: 'p-bot-2',
        name: 'Maya_Harmoni',
        isHost: false,
        isReady: true,
        avatarBg: 'bg-emerald-600',
        score: 0,
        streak: 0,
      },
    ];

    setPlayers(initialPlayers);
    setScreen('waiting-room');
  };

  const handleJoinRoom = () => {
    const code = joinCodeInput.trim().toUpperCase();
    if (!code) {
      alert('Masukkan kode ruangan terlebih dahulu.');
      return;
    }

    setRoomCode(code);
    const initialPlayers: RoomPlayer[] = [
      {
        id: 'p-host-room',
        name: 'Kapten_Audio (Host)',
        isHost: true,
        isReady: true,
        avatarBg: 'bg-amber-600',
        score: 0,
        streak: 0,
      },
      {
        id: 'p-me',
        name: userNickname || 'Kamu',
        isHost: false,
        isReady: true,
        avatarBg: 'bg-[#FC1212]',
        score: 0,
        streak: 0,
      },
    ];

    setPlayers(initialPlayers);
    setScreen('waiting-room');
  };

  const handleCopyCode = () => {
    navigator.clipboard?.writeText(roomCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleReady = () => {
    setIsUserReady(!isUserReady);
    setPlayers((prev) =>
      prev.map((p) => (p.id === 'p-me' ? { ...p, isReady: !p.isReady } : p))
    );
  };

  const handleStartGame = () => {
    audioEngine.playClickSound();
    setCurrentQIndex(0);
    setUserSelectedOption(null);
    setIsRoundFinished(false);
    setTimeLeft(roundTimerSec);
    setPlayers((prev) => prev.map((p) => ({ ...p, score: 0, streak: 0, lastAnswerStatus: undefined })));
    setScreen('in-game');
  };

  useEffect(() => {
    if (screen !== 'in-game' || isRoundFinished) {
      if (gameTimerRef.current) clearInterval(gameTimerRef.current);
      return;
    }

    if (roundTimerSec <= 0) {
      setTimeLeft(0);
      return;
    }
    setTimeLeft(roundTimerSec);
    gameTimerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (gameTimerRef.current) clearInterval(gameTimerRef.current);
          setUserSelectedOption((sel) => {
            if (sel === null) {
              setPlayers((prevPlayers) =>
                prevPlayers.map((p) =>
                  p.id === 'p-me' ? { ...p, streak: 0, lastAnswerStatus: 'wrong' } : p
                )
              );
            }
            return sel;
          });
          setIsRoundFinished(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (gameTimerRef.current) clearInterval(gameTimerRef.current);
    };
  }, [screen, currentQIndex, isRoundFinished, roundTimerSec]);

  // Simulasikan pemain lain (bot) ikut menjawab setiap ronde selesai, agar skor & podium hidup
  useEffect(() => {
    if (screen !== 'in-game' || !isRoundFinished || !currentQ) return;
    setPlayers((prev) =>
      prev.map((p) => {
        if (p.id === 'p-me') return p;
        const botCorrect = Math.random() < 0.65;
        const botBonus = Math.round((0.15 + Math.random() * 0.7) * 150);
        return botCorrect
          ? {
              ...p,
              score: p.score + 100 + botBonus,
              streak: p.streak + 1,
              lastAnswerStatus: 'correct',
            }
          : { ...p, streak: 0, lastAnswerStatus: 'wrong' };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRoundFinished, currentQIndex, screen]);

  const handleSelectOption = (idx: number) => {
    if (isRoundFinished || !currentQ) return;
    if (gameTimerRef.current) clearInterval(gameTimerRef.current);

    setUserSelectedOption(idx);
    setIsRoundFinished(true);

    const isCorrect = idx === currentQ.correctIndex;
    if (isCorrect) {
      audioEngine.playCorrectSound();
    } else {
      if (typeof (audioEngine as any).playIncorrectSound === 'function') {
        (audioEngine as any).playIncorrectSound();
      } else {
        audioEngine.playClickSound();
      }
    }

    setPlayers((prev) =>
      prev.map((player) => {
        if (player.id === 'p-me') {
          return {
            ...player,
            score: player.score + (isCorrect ? 100 + (roundTimerSec > 0 ? Math.round((timeLeft / roundTimerSec) * 150) : 0) : 0),
            lastAnswerStatus: isCorrect ? 'correct' : 'wrong',
          };
        }
        return player;
      })
    );
  };

  const handleNextRound = () => {
    if (currentQIndex + 1 < (activeDeck?.questions.length || 0)) {
      setCurrentQIndex((prev) => prev + 1);
      setUserSelectedOption(null);
      setIsRoundFinished(false);
      setTimeLeft(roundTimerSec);
    } else {
      setScreen('podium');
    }
  };

  const sortedPlayers = [...players].sort((a, b) => b.score - a.score);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-3xl rounded-2xl bg-[#14213D] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]"
      >
        <div className="p-4 sm:p-5 border-b border-white/[0.08] bg-black/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-[#FC1212] text-white shadow-md shadow-red-600/20">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">
                  Multiplayer Arena
                </h3>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FC1212]/20 text-[#FC1212] border border-[#FC1212]/30">
                  Online Match
                </span>
              </div>
              <p className="text-xs text-gray-400">
                Tantang pemain lain dalam adu kecepatan dan ketepatan menjawab kuis interaktif.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!isOnline && (
          <div className="bg-[#780000]/40 border-b border-[#FC1212]/30 px-5 py-2.5 flex items-center gap-2.5 text-xs text-red-200">
            <WifiOff className="w-4 h-4 text-[#FC1212] flex-shrink-0" />
            <span>Mode Offline Terdeteksi. Fitur Multiplayer membutuhkan koneksi jaringan aktif.</span>
          </div>
        )}

        <div className="p-5 sm:p-6 overflow-y-auto flex-1 space-y-6">
          {screen === 'lobby-menu' ? (
            <div className="space-y-6">
              <div className="flex rounded-xl bg-black/40 p-1 border border-white/[0.08]">
                <button
                  onClick={() => setActiveTab('create')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'create' ? 'bg-[#FC1212] text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Buat Ruangan Baru
                </button>
                <button
                  onClick={() => setActiveTab('join')}
                  className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    activeTab === 'join' ? 'bg-[#FC1212] text-white shadow' : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Gabung dengan Kode Room
                </button>
              </div>

              {activeTab === 'create' ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-300 mb-1">
                      Pilih Deck Kuis Pertandingan
                    </label>
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

                  <QuestionTimerSetting
                    value={roundTimeChoice}
                    onChange={setRoundTimeChoice}
                    locked={isEditorDeck(activeDeck)}
                    lockedNote={describeEditorDeckTime(activeDeck)}
                    accent="red"
                  />

                  <button
                    onClick={handleCreateRoom}
                    disabled={!isOnline}
                    className="w-full py-3 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-xs shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Buat Ruangan &amp; Undang Teman</span>
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-300 mb-1">
                      Kode Ruangan (Room Code)
                    </label>
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
                    disabled={!isOnline}
                    className="w-full py-3 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-xs shadow-lg shadow-red-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-40"
                  >
                    <Users className="w-4 h-4" />
                    <span>Masuk ke Ruangan</span>
                  </button>
                </div>
              )}
            </div>
          ) : screen === 'waiting-room' ? (
            <div className="space-y-6">
              <div className="p-4 rounded-xl bg-black/60 border border-white/[0.08] flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                    Kode Ruangan Kuis
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xl font-mono font-black text-[#FC1212] tracking-wider">{roomCode}</span>
                    <button
                      onClick={handleCopyCode}
                      className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-gray-300 text-xs transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <button
                  onClick={handleStartGame}
                  className="px-6 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-xs shadow-lg shadow-red-600/25 transition-all cursor-pointer"
                >
                  Mulai Kuis
                </button>
              </div>
            </div>
          ) : screen === 'in-game' && currentQ ? (
            <div className="space-y-5">
              <div className="flex items-center justify-between text-xs">
                <span className="px-3 py-1 rounded-full bg-black/40 text-gray-300 font-bold border border-white/[0.08]">
                  Soal {currentQIndex + 1} / {activeDeck.questions.length}
                </span>
                <span className="font-mono font-bold text-white">{roundTimerSec > 0 ? `${timeLeft}s` : 'Tanpa batas'}</span>
              </div>

              <h4 className="text-base sm:text-lg font-bold text-white leading-relaxed">
                {currentQ.question}
              </h4>

              {(currentQ as any).mediaUrl && (currentQ as any).mediaType && (currentQ as any).mediaType !== 'none' && (
                <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-black/40 flex items-center justify-center">
                  {(currentQ as any).mediaType === 'image' && (
                    <img src={(currentQ as any).mediaUrl} alt="Lampiran soal" className="max-h-48 w-full object-contain" />
                  )}
                  {(currentQ as any).mediaType === 'audio' && (
                    <audio src={(currentQ as any).mediaUrl} controls className="w-full h-10 p-2" />
                  )}
                  {(currentQ as any).mediaType === 'video' && (
                    <video src={(currentQ as any).mediaUrl} controls className="max-h-56 w-full" />
                  )}
                </div>
              )}

              <div className="space-y-2.5">
                {(currentQ.options || []).map((opt, oIdx) => {
                  const isSelected = userSelectedOption === oIdx;
                  const isCorrectOption = oIdx === currentQ.correctIndex;
                  let optStyle = 'border-white/10 bg-black/40 text-gray-200 hover:border-white/30';
                  if (isRoundFinished) {
                    if (isCorrectOption) {
                      optStyle = 'border-emerald-500 bg-emerald-950/40 text-emerald-100 font-semibold';
                    } else if (isSelected) {
                      optStyle = 'border-[#FC1212] bg-[#780000]/40 text-red-100 font-semibold';
                    } else {
                      optStyle = 'border-white/[0.04] bg-black/20 opacity-40 text-gray-400';
                    }
                  }
                  return (
                    <button
                      key={oIdx}
                      disabled={isRoundFinished}
                      onClick={() => handleSelectOption(oIdx)}
                      className={`w-full text-left p-3.5 rounded-xl border text-xs transition-all ${optStyle}`}
                    >
                      <strong>{String.fromCharCode(65 + oIdx)}.</strong> {opt}
                    </button>
                  );
                })}
              </div>

              {isRoundFinished && (
                <div className="flex justify-end pt-2">
                  <button
                    onClick={handleNextRound}
                    className="px-5 py-2 rounded-xl bg-[#FC1212] text-white font-extrabold text-xs shadow"
                  >
                    {currentQIndex + 1 < activeDeck.questions.length ? 'Ronde Berikutnya →' : 'Lihat Hasil Akhir'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center space-y-5 py-2">
              <div className="w-14 h-14 rounded-full bg-[#FC1212]/20 border border-[#FC1212] text-[#FC1212] mx-auto flex items-center justify-center">
                <Award className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-black text-white">Pertandingan Selesai</h3>

              <div className="max-w-sm mx-auto space-y-2 text-left">
                {sortedPlayers.map((p, rank) => (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-3 rounded-xl border ${
                      rank === 0
                        ? 'bg-amber-950/30 border-amber-500/40'
                        : p.id === 'p-me'
                        ? 'bg-[#FC1212]/10 border-[#FC1212]/30'
                        : 'bg-black/40 border-white/[0.08]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      {rank === 0 ? (
                        <Crown className="w-4 h-4 text-amber-400 shrink-0" />
                      ) : (
                        <span className="text-xs font-mono font-bold text-gray-400 w-4 text-center shrink-0">
                          {rank + 1}
                        </span>
                      )}
                      <span className={`w-6 h-6 rounded-full ${p.avatarBg} shrink-0`} />
                      <span className="text-sm font-bold text-white truncate">
                        {p.name}
                        {p.id === 'p-me' && <span className="text-[10px] text-gray-400 ml-1">(Kamu)</span>}
                      </span>
                    </div>
                    <span className="text-sm font-mono font-black text-[#FC1212] shrink-0">{p.score} Poin</span>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={handleStartGame}
                  className="px-5 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white text-xs font-extrabold flex items-center gap-2 cursor-pointer active:scale-95 transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Main Lagi</span>
                </button>
                <button
                  onClick={onClose}
                  className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 text-gray-300 text-xs font-bold cursor-pointer border border-white/[0.08]"
                >
                  Tutup Multiplayer
                </button>
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};