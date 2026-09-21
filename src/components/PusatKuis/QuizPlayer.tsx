// src/components/PusatKuis/QuizPlayer.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  getQuestionTime,
  getPlayTime,
  isEditorDeck,
  clampQuestionTime,
  describeEditorDeckTime,
  describeHostDeckTime,
  DEFAULT_QUESTION_TIME,
} from '../../services/questionTime';
import { QuestionTimerSetting } from './QuestionTimerSetting';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  CheckCircle,
  XCircle,
  ArrowRight,
  RotateCcw,
  Award,
  Check,
  HelpCircle,
  Clock,
  Volume2,
  VolumeX,
  Users,
  Mic,
  Plus,
  Minus,
  Crown,
  Eye,
  Bot,
  Swords,
  User,
  Save,
  Trash2,
  History,
  Edit3,
  Sparkles,
  ListChecks,
} from 'lucide-react';
import { Deck, QuizQuestion } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { trackEvent } from '../../services/analytics';
import {
  AnswerLogEntry,
  SavedQuizResult,
  addSavedResult,
} from '../../services/quizResultsStore';
import { QuizResultHistory, AnswerReviewModal } from './QuizResultHistory';

export type QuizPlayMode = 'solo' | 'pass_play' | 'host';
type PlayPhase = 'setup' | 'quiz' | 'finished';
type BotDifficulty = 'Mudah' | 'Sedang' | 'Sulit';

interface QuizPlayerProps {
  deck: Deck;
  onClose: () => void;
  mode?: QuizPlayMode;
  playerCount?: number; // dipakai untuk mode pass_play (2-6 pemain)
  playerNames?: string[]; // opsional, nama awal tiap pemain untuk pass_play (bisa diubah lagi di layar setup)
  teamCount?: number; // dipakai untuk mode host (jumlah regu)
  teamNames?: string[]; // opsional, nama awal tiap regu untuk host (bisa diubah lagi di layar setup)
  questionLimit?: number; // berapa butir soal yang dimainkan dari total deck
  shuffleQuestions?: boolean; // acak urutan soal
}

// Batas waktu per soal kini dibaca dari pengaturan tiap soal (lihat services/questionTime.ts)

// Probabilitas bot menjawab benar, berdasarkan tingkat kesulitan bot yang dipilih pemain
const BOT_SKILL: Record<BotDifficulty, number> = {
  Mudah: 0.35,
  Sedang: 0.6,
  Sulit: 0.85,
};

export const MAX_TEAMS = 10; // Host / Kuis Master mendukung hingga 10 regu
const MIN_TEAM_SCORE = -1000;
const MAX_TEAM_SCORE = 1000;

// Susun satu entri rincian jawaban (soal + semua pilihan + pilihan pemain + kunci benar)
function buildAnswerEntry(
  q: QuizQuestion,
  qIndex: number,
  selectedIndex: number | null,
  playerName?: string
): AnswerLogEntry {
  const anyQ = q as any;
  const rawUrl = typeof anyQ.mediaUrl === 'string' ? anyQ.mediaUrl : undefined;
  const hasMedia = anyQ.mediaType && anyQ.mediaType !== 'none' && rawUrl;
  return {
    questionId: q.id,
    number: qIndex + 1,
    question: q.question,
    options: [...(q.options || [])],
    correctIndex: q.correctIndex,
    selectedIndex,
    isCorrect: selectedIndex === null ? null : selectedIndex === q.correctIndex,
    playerName,
    category: q.category,
    explanation: q.explanation,
    mediaType: hasMedia ? anyQ.mediaType : undefined,
    // data: URL (unggahan lokal) tidak disimpan agar riwayat tidak membengkak
    mediaUrl: hasMedia && !rawUrl.startsWith('data:') ? rawUrl : undefined,
    mediaCredit: hasMedia ? anyQ.mediaCredit : undefined,
  };
}

// Fisher-Yates shuffle, tidak memutasi array asli
function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const QuestionMedia: React.FC<{ q?: QuizQuestion }> = ({ q }) => {
  const mediaType = (q as any)?.mediaType;
  const mediaUrl = (q as any)?.mediaUrl;
  if (!mediaUrl || !mediaType || mediaType === 'none') return null;

  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-black/40 flex flex-col items-center justify-center">
      {mediaType === 'image' && (
        <img src={mediaUrl} alt="Lampiran soal" className="max-h-56 w-full object-contain" />
      )}
      {mediaType === 'audio' && (
        <audio src={mediaUrl} controls className="w-full h-11 p-2" />
      )}
      {mediaType === 'video' && (
        <video src={mediaUrl} controls className="max-h-64 w-full" />
      )}
      {(q as any)?.mediaCredit && (
        <span className="w-full text-[9px] text-gray-500 px-2 py-1 text-center border-t border-white/[0.06]">
          {(q as any).mediaCredit}
        </span>
      )}
    </div>
  );
};

export const QuizPlayer: React.FC<QuizPlayerProps> = ({
  deck,
  onClose,
  mode = 'solo',
  playerCount = 2,
  playerNames,
  teamCount = 2,
  teamNames,
  questionLimit,
  shuffleQuestions = false,
}) => {
  // Susun daftar soal efektif: acak (opsional) lalu batasi jumlah (opsional)
  const effectiveQuestions = useMemo(() => {
    let qs = [...(deck?.questions || [])];
    if (shuffleQuestions) qs = shuffleArray(qs);
    if (questionLimit && questionLimit > 0 && questionLimit < qs.length) {
      qs = qs.slice(0, questionLimit);
    }
    return qs;
  }, [deck, shuffleQuestions, questionLimit]);

  const isHostMode = mode === 'host';
  const isPassPlayMode = mode === 'pass_play';
  const isSoloMode = mode === 'solo';

  // --- Fase layar: setup (atur nama/lawan) -> quiz -> finished ---
  const [phase, setPhase] = useState<PlayPhase>('setup');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedOptionIndex, setSelectedOptionIndex] = useState<number | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);
  const [score, setScore] = useState(0);
  const [isFinished, setIsFinished] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);

  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // --- State khusus mode Solo lawan Bot ---
  const [vsBotEnabled, setVsBotEnabled] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty>('Sedang');
  const [botScore, setBotScore] = useState(0);

  // --- State khusus mode Pass & Play ---
  const clampedPlayerCount = Math.min(6, Math.max(2, playerCount || 2));
  const [playerScores, setPlayerScores] = useState<number[]>(() => Array(clampedPlayerCount).fill(0));
  const [activePlayerIndex, setActivePlayerIndex] = useState(0);
  const [playerNamesState, setPlayerNamesState] = useState<string[]>(() => {
    if (playerNames && playerNames.length >= clampedPlayerCount) return playerNames.slice(0, clampedPlayerCount);
    return Array.from({ length: clampedPlayerCount }, (_, i) => `Pemain ${i + 1}`);
  });

  // --- State khusus mode Host / Kuis Master ---
  const clampedTeamCount = Math.min(MAX_TEAMS, Math.max(1, teamCount || 2));
  const [teamScores, setTeamScores] = useState<number[]>(() => Array(clampedTeamCount).fill(0));
  const [isAnswerRevealed, setIsAnswerRevealed] = useState(false);
  const [teamNamesState, setTeamNamesState] = useState<string[]>(() => {
    if (teamNames && teamNames.length >= clampedTeamCount) return teamNames.slice(0, clampedTeamCount);
    return Array.from({ length: clampedTeamCount }, (_, i) => `Regu ${String.fromCharCode(65 + i)}`);
  });
  const [hostNameState, setHostNameState] = useState<string>('');
  const [pointStep, setPointStep] = useState<number>(10);
  // Pengaturan waktu khusus Host: ikut bawaan kuis, atur sendiri, atau tanpa timer
  const [hostTimerMode, setHostTimerMode] = useState<'deck' | 'custom' | 'off'>('deck');
  const [hostCustomTime, setHostCustomTime] = useState<number>(DEFAULT_QUESTION_TIME);
  // Waktu per soal pilihan pemain untuk kuis bawaan (Langsung Main & Pass & Play)
  const [playTime, setPlayTime] = useState<number>(DEFAULT_QUESTION_TIME);

  // --- State penyimpanan hasil permainan ---
  const [isResultSaved, setIsResultSaved] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [answerLog, setAnswerLog] = useState<AnswerLogEntry[]>([]);
  const [showReview, setShowReview] = useState(false);

  const questions = effectiveQuestions;
  const currentQ: QuizQuestion | undefined = questions[currentIndex];

  // Kuis buatan Editor: waktu dikunci sesuai pembuat kuis (kecuali di mode Host).
  const isCustomDeck = isEditorDeck(deck);
  const editorTimeNote = describeEditorDeckTime(deck);

  // Batas waktu soal aktif (detik). 0 = tanpa batas waktu (hanya mungkin di mode Host).
  //  - Host: tanpa timer / bawaan soal / atur sendiri
  //  - Langsung Main & Pass & Play: selalu ada timer (pilihan pemain, atau dikunci bila kuis Editor)
  const currentTimeLimit = isHostMode
    ? hostTimerMode === 'off'
      ? 0
      : hostTimerMode === 'custom'
        ? clampQuestionTime(hostCustomTime)
        : getQuestionTime(currentQ, DEFAULT_QUESTION_TIME)
    : getPlayTime(deck, currentQ, playTime);

  useEffect(() => {
    if (deck?.id && phase === 'quiz' && currentIndex === 0 && !isAnswerSubmitted) {
      trackEvent('quiz_start', { deckId: deck.id, title: deck.title, mode });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck?.id, deck?.title, mode, phase]);

  // Batas waktu per soal: dari pengaturan soal (atau pilihan Host). 0 = tanpa timer.
  // Mode Host: timer hanya penunjuk waktu, tidak menjawab otomatis.
  useEffect(() => {
    if (phase !== 'quiz' || isFinished) return;
    const stopped = isHostMode ? isAnswerRevealed : isAnswerSubmitted;
    if (stopped) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    if (currentTimeLimit <= 0) {
      setTimeLeft(0);
      return;
    }

    setTimeLeft(currentTimeLimit);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          if (!isHostMode) handleTimeOut();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentIndex, isAnswerSubmitted, isAnswerRevealed, isFinished, isHostMode, phase, currentTimeLimit]);

  const playWrongAudio = () => {
    if (!soundEnabled) return;
    if (typeof (audioEngine as any).playIncorrectSound === 'function') {
      (audioEngine as any).playIncorrectSound();
    } else {
      audioEngine.playClickSound();
    }
  };

  // Bot menjawab soal yang sama secara otomatis, dipanggil bersamaan jawaban pemain (mode Solo saja)
  const resolveBotAnswer = () => {
    if (!isSoloMode || !vsBotEnabled) return;
    const skill = BOT_SKILL[botDifficulty];
    const botCorrect = Math.random() < skill;
    if (botCorrect) setBotScore((prev) => prev + 1);
  };

  const handleTimeOut = () => {
    if (isAnswerSubmitted || !currentQ) return;
    setIsAnswerSubmitted(true);
    setSelectedOptionIndex(-1);
    setAnswerLog((prev) => [
      ...prev,
      buildAnswerEntry(currentQ, currentIndex, -1, isPassPlayMode ? playerNamesState[activePlayerIndex] : undefined),
    ]);
    playWrongAudio();
    resolveBotAnswer();
  };

  const handleSelectOption = (index: number) => {
    if (isAnswerSubmitted || !currentQ) return;
    if (timerRef.current) clearInterval(timerRef.current);

    setSelectedOptionIndex(index);
    setIsAnswerSubmitted(true);

    const isCorrect = index === currentQ.correctIndex;
    setAnswerLog((prev) => [
      ...prev,
      buildAnswerEntry(currentQ, currentIndex, index, isPassPlayMode ? playerNamesState[activePlayerIndex] : undefined),
    ]);
    if (isCorrect) {
      if (isPassPlayMode) {
        setPlayerScores((prev) => prev.map((s, i) => (i === activePlayerIndex ? s + 1 : s)));
      } else {
        setScore((prev) => prev + 1);
      }
      if (soundEnabled) audioEngine.playCorrectSound();
    } else {
      playWrongAudio();
    }

    resolveBotAnswer();
  };

  // Mode Pass & Play: giliran berpindah SETELAH SETIAP SOAL, bukan setelah satu pemain
  // menuntaskan semua soal. Urutannya: Soal 1 dijawab Pemain 1, lalu Pemain 2, dst,
  // baru pindah ke Soal 2 dari Pemain 1 lagi. Semua pemain tetap kebagian seluruh soal
  // yang sama (mis. 10 soal x 2 pemain = 20 giliran jawab total).
  const handleNextQuestion = () => {
    if (isPassPlayMode) {
      if (activePlayerIndex + 1 < clampedPlayerCount) {
        setActivePlayerIndex((prev) => prev + 1);
        setSelectedOptionIndex(null);
        setIsAnswerSubmitted(false);
        return;
      }
      if (currentIndex + 1 < questions.length) {
        setActivePlayerIndex(0);
        setCurrentIndex((prev) => prev + 1);
        setSelectedOptionIndex(null);
        setIsAnswerSubmitted(false);
        return;
      }
      setIsFinished(true);
      trackEvent('quiz_complete', { deckId: deck.id, total: questions.length, mode });
      return;
    }

    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((prev) => prev + 1);
      setSelectedOptionIndex(null);
      setIsAnswerSubmitted(false);
    } else {
      setIsFinished(true);
      trackEvent('quiz_complete', {
        deckId: deck.id,
        score,
        total: questions.length,
        mode,
        vsBot: vsBotEnabled,
        botScore: vsBotEnabled ? botScore : undefined,
      });
    }
  };

  const getNextTurnLabel = () => {
    if (!isPassPlayMode) return currentIndex + 1 < questions.length ? 'Pertanyaan Berikutnya' : 'Lihat Hasil Kuis';
    if (activePlayerIndex + 1 < clampedPlayerCount) {
      return `Giliran ${playerNamesState[activePlayerIndex + 1]}`;
    }
    if (currentIndex + 1 < questions.length) {
      return `Soal Berikutnya • Giliran ${playerNamesState[0]}`;
    }
    return 'Lihat Hasil Kuis';
  };

  const handleHostNextQuestion = () => {
    if (currentIndex + 1 < questions.length) {
      setCurrentIndex((prev) => prev + 1);
      setIsAnswerRevealed(false);
    } else {
      setIsFinished(true);
      trackEvent('quiz_complete', { deckId: deck.id, total: questions.length, mode });
    }
  };

  // Skor regu kini bebas ditambah/dikurangi sesuai "pointStep" yang diatur host
  // (bukan lagi terkunci +10/-10), dengan batas aman -1000 s/d 1000 per regu.
  const handleAwardTeamPoint = (teamIdx: number, direction: 1 | -1) => {
    const delta = direction * Math.max(1, Math.min(1000, Math.abs(pointStep) || 1));
    setTeamScores((prev) =>
      prev.map((s, i) => (i === teamIdx ? Math.min(MAX_TEAM_SCORE, Math.max(MIN_TEAM_SCORE, s + delta)) : s))
    );
  };

  const handleRestartQuiz = () => {
    setPhase('quiz');
    setCurrentIndex(0);
    setSelectedOptionIndex(null);
    setIsAnswerSubmitted(false);
    setScore(0);
    setBotScore(0);
    setIsFinished(false);
    setIsResultSaved(false);
    setAnswerLog([]);
    setShowReview(false);
    setPlayerScores(Array(clampedPlayerCount).fill(0));
    setActivePlayerIndex(0);
    setTeamScores(Array(clampedTeamCount).fill(0));
    setIsAnswerRevealed(false);
  };

  const handleStartFromSetup = () => {
    setPhase('quiz');
    setCurrentIndex(0);
    setSelectedOptionIndex(null);
    setIsAnswerSubmitted(false);
    setScore(0);
    setBotScore(0);
    setIsFinished(false);
    setIsResultSaved(false);
    setAnswerLog([]);
    setShowReview(false);
    setPlayerScores(Array(clampedPlayerCount).fill(0));
    setActivePlayerIndex(0);
    setTeamScores(Array(clampedTeamCount).fill(0));
  };

  const scorePercentage = questions.length > 0 ? Math.round((score / questions.length) * 100) : 0;

  const modeLabel =
    mode === 'pass_play' ? 'Pass & Play' : mode === 'host' ? 'Host / Kuis Master' : 'Langsung Main';

  // --- Simpan / hapus riwayat hasil permainan (localStorage, lintas semua deck & mode) ---
  // Mode Host: aplikasi tidak menerima pilihan pemain, jadi yang dicatat adalah soal + kunci jawaban
  const hostAnswerLog: AnswerLogEntry[] = questions.map((q, i) => buildAnswerEntry(q, i, null));
  const reviewAnswers: AnswerLogEntry[] = isHostMode ? hostAnswerLog : answerLog;

  const buildResultEntry = (): SavedQuizResult => {
    if (isPassPlayMode) {
      const players = playerNamesState.map((name, i) => ({ name, score: playerScores[i] }));
      const leader = [...players].sort((a, b) => b.score - a.score)[0];
      return {
        id: `res-${Date.now()}`,
        savedAt: Date.now(),
        deckId: deck?.id || '',
        deckTitle: deck?.title || 'Kuis',
        mode,
        totalQuestions: questions.length,
        summary: leader ? `${leader.name} unggul dengan ${leader.score} poin` : 'Sesi Pass & Play',
        data: { players },
        answers: answerLog,
      };
    }
    if (isHostMode) {
      const teams = teamNamesState.map((name, i) => ({ name, score: teamScores[i] }));
      const leader = [...teams].sort((a, b) => b.score - a.score)[0];
      return {
        id: `res-${Date.now()}`,
        savedAt: Date.now(),
        deckId: deck?.id || '',
        deckTitle: deck?.title || 'Kuis',
        mode,
        totalQuestions: questions.length,
        summary: leader ? `${leader.name} menang dengan ${leader.score} poin` : 'Sesi Host',
        data: { host: hostNameState || 'Host', teams },
        answers: hostAnswerLog,
      };
    }
    // solo
    return {
      id: `res-${Date.now()}`,
      savedAt: Date.now(),
      deckId: deck?.id || '',
      deckTitle: deck?.title || 'Kuis',
      mode,
      totalQuestions: questions.length,
      summary: vsBotEnabled
        ? `Kamu ${score} vs Bot (${botDifficulty}) ${botScore}`
        : `${score}/${questions.length} soal benar (${scorePercentage}%)`,
      data: {
        score,
        total: questions.length,
        percentage: scorePercentage,
        vsBot: vsBotEnabled,
        botDifficulty: vsBotEnabled ? botDifficulty : null,
        botScore: vsBotEnabled ? botScore : null,
      },
      answers: answerLog,
    };
  };

  const handleSaveResult = () => {
    const ok = addSavedResult(buildResultEntry());
    if (ok) {
      setIsResultSaved(true);
    } else {
      alert('Hasil gagal disimpan: penyimpanan lokal perangkat penuh atau tidak tersedia.');
    }
  };

  const openHistory = () => setShowHistory(true);

  return (
    <div
      id="quiz-player-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-2xl rounded-2xl bg-[#14213D] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col my-auto"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.08] bg-black/50">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-[#FC1212] uppercase tracking-wider shrink-0">
              {modeLabel}
            </span>
            <span className="text-gray-500 shrink-0">•</span>
            <span className="text-sm font-bold text-white truncate max-w-[110px] sm:max-w-xs">
              {deck?.title}
            </span>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={openHistory}
              title="Riwayat Hasil Tersimpan"
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
            >
              <History className="w-4 h-4" />
            </button>

            <button
              onClick={() => setSoundEnabled(!soundEnabled)}
              title={soundEnabled ? 'Matikan Suara Efek' : 'Nyalakan Suara Efek'}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-gray-300" /> : <VolumeX className="w-4 h-4 text-gray-500" />}
            </button>

            {phase === 'quiz' && !isFinished && (
              <span className="text-xs font-mono text-[#FC1212] bg-[#FC1212]/15 px-2.5 py-1 rounded-full border border-[#FC1212]/30 font-bold">
                {currentIndex + 1} / {questions.length}
              </span>
            )}

            <button
              id="btn-close-quiz-player"
              onClick={onClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {phase === 'quiz' && !isFinished && questions.length > 0 && (
          <div className="w-full h-1.5 bg-black/80">
            <div
              className="h-full bg-[#FC1212] transition-all duration-300 shadow-[0_0_8px_#FC1212]"
              style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
            />
          </div>
        )}

        {/* Bilah giliran pemain khusus Pass & Play */}
        {phase === 'quiz' && !isFinished && isPassPlayMode && questions.length > 0 && (
          <div className="px-6 py-2.5 bg-blue-950/30 border-b border-blue-500/20 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-200">
              <Users className="w-3.5 h-3.5" />
              <span>Giliran: {playerNamesState[activePlayerIndex]}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {playerNamesState.map((name, i) => (
                <span
                  key={i}
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                    i === activePlayerIndex
                      ? 'bg-[#FC1212]/20 text-[#FC1212] border-[#FC1212]/40'
                      : 'bg-black/40 text-gray-400 border-white/10'
                  }`}
                >
                  {name}: {playerScores[i]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Bilah skor Solo vs Bot */}
        {phase === 'quiz' && !isFinished && isSoloMode && vsBotEnabled && questions.length > 0 && (
          <div className="px-6 py-2.5 bg-purple-950/30 border-b border-purple-500/20 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs font-bold text-white">
              <User className="w-3.5 h-3.5 text-emerald-400" /> Kamu: {score}
            </span>
            <span className="flex items-center gap-1.5 text-xs font-bold text-purple-200">
              <Bot className="w-3.5 h-3.5" /> Bot ({botDifficulty}): {botScore}
            </span>
          </div>
        )}

        <div className="p-6 sm:p-8">
          {phase === 'setup' ? (
            // ================= LAYAR SETUP: ATUR NAMA / LAWAN SEBELUM MULAI =================
            <div className="space-y-6">
              {isSoloMode && (
                <div className="space-y-5">
                  <div className="text-center space-y-1">
                    <div className="w-14 h-14 rounded-2xl bg-[#FC1212]/15 border border-[#FC1212]/40 text-[#FC1212] mx-auto flex items-center justify-center">
                      <Swords className="w-7 h-7" />
                    </div>
                    <h3 className="text-lg font-black text-white">Atur Sesi Solo</h3>
                    <p className="text-xs text-gray-400">Main sendiri santai, atau uji kecepatan lawan bot.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setVsBotEnabled(false)}
                      className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        !vsBotEnabled
                          ? 'bg-[#FC1212]/15 border-[#FC1212] text-white'
                          : 'bg-black/40 border-white/10 text-gray-400 hover:border-white/30'
                      }`}
                    >
                      <User className="w-5 h-5 mb-2" />
                      <span className="text-sm font-black block">Solo Biasa</span>
                      <span className="text-[11px] text-gray-400">Fokus pada skor pribadi</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVsBotEnabled(true)}
                      className={`p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        vsBotEnabled
                          ? 'bg-purple-500/15 border-purple-500 text-white'
                          : 'bg-black/40 border-white/10 text-gray-400 hover:border-white/30'
                      }`}
                    >
                      <Bot className="w-5 h-5 mb-2" />
                      <span className="text-sm font-black block">Lawan Bot</span>
                      <span className="text-[11px] text-gray-400">Bertanding skor vs bot AI</span>
                    </button>
                  </div>

                  {vsBotEnabled && (
                    <div className="space-y-2">
                      <span className="text-xs font-bold text-gray-300 uppercase tracking-wider block">
                        Tingkat Kepintaran Bot
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {(['Mudah', 'Sedang', 'Sulit'] as BotDifficulty[]).map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => setBotDifficulty(d)}
                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                              botDifficulty === d
                                ? 'bg-purple-600 border-purple-500 text-white'
                                : 'bg-black/40 border-white/10 text-gray-400 hover:border-white/30'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <QuestionTimerSetting
                    value={playTime}
                    onChange={setPlayTime}
                    locked={isCustomDeck}
                    lockedNote={editorTimeNote}
                    accent="red"
                  />

                  <button
                    type="button"
                    onClick={handleStartFromSetup}
                    disabled={questions.length === 0}
                    className="w-full py-3 rounded-xl bg-[#FC1212] hover:bg-[#e01010] disabled:opacity-40 text-white font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-red-600/25"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Mulai Kuis</span>
                  </button>
                </div>
              )}

              {isPassPlayMode && (
                <div className="space-y-5">
                  <div className="text-center space-y-1">
                    <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 mx-auto flex items-center justify-center">
                      <Users className="w-7 h-7" />
                    </div>
                    <h3 className="text-lg font-black text-white">Atur Nama Pemain</h3>
                    <p className="text-xs text-gray-400">
                      Setiap pemain akan menjawab semua {questions.length} soal secara bergiliran per soal.
                    </p>
                  </div>

                  <div className="space-y-2.5">
                    {playerNamesState.map((name, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-lg bg-black/50 border border-white/10 text-gray-300 text-xs font-bold flex items-center justify-center shrink-0">
                          {i + 1}
                        </span>
                        <div className="relative flex-1">
                          <Edit3 className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={name}
                            maxLength={24}
                            onChange={(e) => {
                              const val = e.target.value;
                              setPlayerNamesState((prev) => prev.map((n, idx) => (idx === i ? val : n)));
                            }}
                            placeholder={`Pemain ${i + 1}`}
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs font-bold focus:border-amber-400 outline-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <QuestionTimerSetting
                    value={playTime}
                    onChange={setPlayTime}
                    locked={isCustomDeck}
                    lockedNote={editorTimeNote}
                    accent="amber"
                  />

                  <button
                    type="button"
                    onClick={handleStartFromSetup}
                    disabled={questions.length === 0}
                    className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-500/20"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Mulai Sesi Pass &amp; Play</span>
                  </button>
                </div>
              )}

              {isHostMode && (
                <div className="space-y-5">
                  <div className="text-center space-y-1">
                    <div className="w-14 h-14 rounded-2xl bg-purple-500/15 border border-purple-500/40 text-purple-400 mx-auto flex items-center justify-center">
                      <Mic className="w-7 h-7" />
                    </div>
                    <h3 className="text-lg font-black text-white">Atur Sesi Host</h3>
                    <p className="text-xs text-gray-400">Isi nama pemandu kuis dan nama tiap regu sebelum mulai.</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-gray-300 uppercase tracking-wider block">
                      Nama Host / Pemandu Kuis
                    </label>
                    <div className="relative">
                      <Mic className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={hostNameState}
                        maxLength={30}
                        onChange={(e) => setHostNameState(e.target.value)}
                        placeholder="Nama kamu sebagai host"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs font-bold focus:border-purple-400 outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    <span className="text-xs font-bold text-gray-300 uppercase tracking-wider block">
                      Nama Regu
                    </span>
                    {teamNamesState.map((name, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-lg bg-black/50 border border-white/10 text-gray-300 text-xs font-bold flex items-center justify-center shrink-0">
                          {String.fromCharCode(65 + i)}
                        </span>
                        <div className="relative flex-1">
                          <Edit3 className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
                          <input
                            type="text"
                            value={name}
                            maxLength={24}
                            onChange={(e) => {
                              const val = e.target.value;
                              setTeamNamesState((prev) => prev.map((n, idx) => (idx === i ? val : n)));
                            }}
                            placeholder={`Regu ${String.fromCharCode(65 + i)}`}
                            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-black/50 border border-white/10 text-white text-xs font-bold focus:border-purple-400 outline-none"
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2.5">
                    <span className="text-xs font-bold text-gray-300 uppercase tracking-wider block">
                      Waktu per Soal
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {([['deck', 'Bawaan Soal'], ['custom', 'Atur Sendiri'], ['off', 'Tanpa Timer']] as const).map(
                        ([val, label]) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setHostTimerMode(val)}
                            className={`py-2.5 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                              hostTimerMode === val
                                ? 'bg-purple-600 border-purple-500 text-white'
                                : 'bg-black/40 border-white/10 text-gray-400 hover:border-white/30'
                            }`}
                          >
                            {label}
                          </button>
                        )
                      )}
                    </div>
                    {hostTimerMode === 'custom' && (
                      <QuestionTimerSetting
                        value={hostCustomTime}
                        onChange={setHostCustomTime}
                        accent="purple"
                        title={null}
                      />
                    )}
                    {hostTimerMode === 'deck' && (
                      <p className="text-[11px] text-gray-500">
                        {describeHostDeckTime(deck)}
                      </p>
                    )}
                    {hostTimerMode === 'off' && (
                      <p className="text-[11px] text-gray-500">
                        Tanpa batas waktu. Kamu sebagai host yang menentukan kapan lanjut ke soal berikutnya.
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleStartFromSetup}
                    disabled={questions.length === 0}
                    className="w-full py-3 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-purple-600/25"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>Mulai Sesi Host</span>
                  </button>
                </div>
              )}

              {questions.length === 0 && (
                <div className="text-center py-4 space-y-2">
                  <HelpCircle className="w-8 h-8 text-gray-500 mx-auto" />
                  <p className="text-xs text-gray-400">Paket kuis ini belum memiliki butir soal.</p>
                </div>
              )}
            </div>
          ) : questions.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <HelpCircle className="w-10 h-10 text-gray-500 mx-auto" />
              <p className="text-sm text-gray-400">Paket kuis ini belum memiliki butir soal.</p>
            </div>
          ) : isHostMode ? (
            // ================= TAMPILAN MODE HOST / KUIS MASTER =================
            <AnimatePresence mode="wait">
              {!isFinished && currentQ ? (
                <motion.div
                  key={currentQ.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                    <span className="px-3 py-1 rounded-full font-bold bg-black/40 text-gray-300 border border-white/[0.08]">
                      {currentQ.category}
                    </span>
                    {currentTimeLimit > 0 && (
                      <span
                        className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-mono font-bold border ${
                          !isAnswerRevealed && timeLeft <= 5
                            ? 'bg-[#780000]/30 text-[#FC1212] border-[#FC1212] animate-pulse'
                            : 'bg-black/40 text-gray-300 border-white/[0.08]'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5" />
                        <span>{timeLeft > 0 ? `${timeLeft}s` : 'Waktu habis!'}</span>
                      </span>
                    )}
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full font-mono font-bold border bg-purple-950/30 text-purple-300 border-purple-500/30">
                      <Mic className="w-3.5 h-3.5" />
                      <span>{hostNameState ? `Host: ${hostNameState}` : 'Mode Host'}</span>
                    </span>
                  </div>

                  <h3 className="text-lg sm:text-xl font-bold text-white leading-relaxed">
                    {currentQ.question}
                  </h3>

                  <QuestionMedia q={currentQ} />

                  <div className="space-y-3 pt-2">
                    {(currentQ.options || []).map((option, idx) => {
                      const isCorrectOption = idx === currentQ.correctIndex;
                      const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
                      const revealedStyle = isAnswerRevealed && isCorrectOption
                        ? 'bg-emerald-950/40 border-emerald-500 text-emerald-100 font-semibold'
                        : 'bg-black/40 border-white/[0.08] text-gray-200';
                      return (
                        <div
                          key={idx}
                          className={`w-full text-left p-4 rounded-xl border flex items-center gap-3 transition-all ${revealedStyle}`}
                        >
                          <span
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 ${
                              isAnswerRevealed && isCorrectOption
                                ? 'bg-emerald-500 text-black font-bold'
                                : 'bg-[#14213D] text-gray-300'
                            }`}
                          >
                            {letters[idx] || idx + 1}
                          </span>
                          <span className="text-sm">{option}</span>
                          {isAnswerRevealed && isCorrectOption && (
                            <CheckCircle className="w-5 h-5 text-emerald-400 ml-auto" />
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!isAnswerRevealed ? (
                    <button
                      id="btn-reveal-answer"
                      onClick={() => setIsAnswerRevealed(true)}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-extrabold text-sm shadow-lg transition-all cursor-pointer active:scale-95"
                    >
                      <Eye className="w-4 h-4" />
                      <span>Tampilkan Kunci Jawaban</span>
                    </button>
                  ) : (
                    <>
                      {currentQ.explanation && (
                        <div className="p-4 rounded-xl bg-black/60 border border-white/[0.08] space-y-2">
                          <div className="flex items-center gap-2">
                            <HelpCircle className="w-4 h-4 text-[#FC1212]" />
                            <span className="text-xs font-bold text-white uppercase tracking-wider">Penjelasan Konsep</span>
                          </div>
                          <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">{currentQ.explanation}</p>
                        </div>
                      )}

                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <span className="text-xs font-bold text-gray-300 uppercase tracking-wider">
                            Beri Skor Regu:
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-gray-400 font-mono">Poin per klik:</span>
                            <input
                              type="number"
                              value={pointStep}
                              min={1}
                              max={1000}
                              onChange={(e) => {
                                const val = Math.max(1, Math.min(1000, Number(e.target.value) || 1));
                                setPointStep(val);
                              }}
                              className="w-16 px-2 py-1 rounded-lg bg-black/60 border border-white/10 text-white text-xs font-mono font-bold text-center outline-none focus:border-purple-400"
                            />
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-500 -mt-1">
                          Skor bebas ditambah/dikurangi sesuai bobot jawaban, dibatasi antara {MIN_TEAM_SCORE} hingga {MAX_TEAM_SCORE} poin per regu.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {teamNamesState.map((name, i) => (
                            <div
                              key={i}
                              className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-white/[0.08]"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-xs font-bold text-white truncate">{name}</span>
                                <span className="text-[11px] font-mono text-gray-400">({teamScores[i]} Poin)</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  onClick={() => handleAwardTeamPoint(i, -1)}
                                  title={`Kurangi ${pointStep} poin`}
                                  className="w-7 h-7 rounded-lg bg-black/60 hover:bg-black/90 text-gray-300 flex items-center justify-center cursor-pointer"
                                >
                                  <Minus className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleAwardTeamPoint(i, 1)}
                                  title={`Tambah ${pointStep} poin`}
                                  className="w-7 h-7 rounded-lg bg-[#FC1212] hover:bg-[#e01010] text-white flex items-center justify-center cursor-pointer"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pt-2 flex justify-end">
                        <button
                          id="btn-host-next-question"
                          onClick={handleHostNextQuestion}
                          className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-sm shadow-lg shadow-red-600/25 transition-all cursor-pointer active:scale-95"
                        >
                          <span>{currentIndex + 1 < questions.length ? 'Soal Berikutnya' : 'Selesaikan Sesi'}</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center space-y-6 py-4"
                >
                  <div className="w-16 h-16 rounded-full bg-[#14213D] border-2 border-purple-500 text-purple-400 mx-auto flex items-center justify-center shadow-lg shadow-purple-600/20">
                    <Crown className="w-8 h-8" />
                  </div>
                  <div>
                    <span className="text-xs uppercase tracking-widest text-purple-400 font-bold">Sesi Host Selesai</span>
                    <h3 className="text-2xl sm:text-3xl font-black text-white mt-1">Papan Skor Akhir Regu</h3>
                    {hostNameState && <p className="text-xs text-gray-400 mt-1">Dipandu oleh {hostNameState}</p>}
                  </div>

                  <div className="max-w-sm mx-auto space-y-2">
                    {teamNamesState
                      .map((name, i) => ({ name, score: teamScores[i] }))
                      .sort((a, b) => b.score - a.score)
                      .map((t, rank) => (
                        <div
                          key={t.name}
                          className={`flex items-center justify-between p-3 rounded-xl border ${
                            rank === 0
                              ? 'bg-amber-950/30 border-amber-500/40'
                              : 'bg-black/40 border-white/[0.08]'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            {rank === 0 && <Crown className="w-4 h-4 text-amber-400" />}
                            <span className="text-sm font-bold text-white">{t.name}</span>
                          </div>
                          <span className="text-sm font-mono font-black text-[#FC1212]">{t.score} Poin</span>
                        </div>
                      ))}
                  </div>

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                    <button
                      onClick={() => setShowReview(true)}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 font-bold text-sm transition-all cursor-pointer active:scale-95"
                    >
                      <ListChecks className="w-4 h-4" />
                      <span>Tinjau Jawaban</span>
                    </button>
                    <button
                      onClick={handleSaveResult}
                      disabled={isResultSaved}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-default text-black font-extrabold text-sm shadow-lg shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
                    >
                      {isResultSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                      <span>{isResultSaved ? 'Hasil Tersimpan' : 'Simpan Hasil'}</span>
                    </button>
                    <button
                      onClick={handleRestartQuiz}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-sm shadow-lg shadow-red-600/25 transition-all cursor-pointer active:scale-95"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Mulai Sesi Baru</span>
                    </button>
                    <button
                      onClick={onClose}
                      className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 text-gray-200 border border-white/[0.08] font-bold text-sm transition-all cursor-pointer"
                    >
                      Tutup Pemutar Kuis
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            // ================= TAMPILAN MODE SOLO & PASS & PLAY =================
            <AnimatePresence mode="wait">
              {!isFinished && currentQ ? (
                <motion.div
                  key={`${currentQ.id}-${activePlayerIndex}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="px-3 py-1 rounded-full font-bold bg-black/40 text-gray-300 border border-white/[0.08]">
                      {currentQ.category}
                    </span>

                    <div
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full font-mono font-bold border transition-colors ${
                        currentTimeLimit > 0 && timeLeft <= 5
                          ? 'bg-[#780000]/30 text-[#FC1212] border-[#FC1212] animate-pulse'
                          : 'bg-black/40 text-gray-300 border-white/[0.08]'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>{currentTimeLimit > 0 ? `${timeLeft}s` : 'Tanpa batas waktu'}</span>
                    </div>

                    <span className="text-gray-400 font-mono font-bold">
                      Skor: <span className="text-white">{(isPassPlayMode ? playerScores[activePlayerIndex] : score)} Poin</span>
                    </span>
                  </div>

                  <h3 className="text-lg sm:text-xl font-bold text-white leading-relaxed">
                    {currentQ.question}
                  </h3>

                  <QuestionMedia q={currentQ} />

                  <div className="space-y-3 pt-2">
                    {(currentQ.options || []).map((option, idx) => {
                      const isSelected = selectedOptionIndex === idx;
                      const isCorrectOption = idx === currentQ.correctIndex;

                      let btnStyle = 'bg-black/40 border-white/[0.08] hover:border-white/30 text-gray-200';
                      let badgeLetterStyle = 'bg-[#14213D] text-gray-300';

                      if (isAnswerSubmitted) {
                        if (isCorrectOption) {
                          btnStyle = 'bg-emerald-950/40 border-emerald-500 text-emerald-100 font-semibold shadow-md shadow-emerald-500/10';
                          badgeLetterStyle = 'bg-emerald-500 text-black font-bold';
                        } else if (isSelected && !isCorrectOption) {
                          btnStyle = 'bg-[#780000]/40 border-[#FC1212] text-red-100 font-semibold shadow-md shadow-red-900/20';
                          badgeLetterStyle = 'bg-[#780000] text-white font-bold';
                        } else {
                          btnStyle = 'bg-black/20 border-white/[0.04] opacity-40 text-gray-400';
                        }
                      }

                      const letters = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

                      return (
                        <button
                          key={idx}
                          id={`quiz-option-${idx}`}
                          disabled={isAnswerSubmitted}
                          onClick={() => handleSelectOption(idx)}
                          className={`w-full text-left p-4 rounded-xl border transition-all flex items-center justify-between gap-3 cursor-pointer disabled:cursor-default ${btnStyle}`}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs shrink-0 transition-colors ${badgeLetterStyle}`}
                            >
                              {letters[idx] || idx + 1}
                            </span>
                            <span className="text-sm">{option}</span>
                          </div>

                          {isAnswerSubmitted && (
                            <div className="shrink-0">
                              {isCorrectOption ? (
                                <CheckCircle className="w-5 h-5 text-emerald-400" />
                              ) : isSelected ? (
                                <XCircle className="w-5 h-5 text-[#FC1212]" />
                              ) : null}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {isAnswerSubmitted && selectedOptionIndex === -1 && (
                    <div className="p-3 rounded-xl bg-[#780000]/30 border border-[#FC1212]/50 text-xs text-red-200 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[#FC1212] flex-shrink-0" />
                      <span>Waktu habis! Kunci jawaban yang benar ditandai dengan warna hijau.</span>
                    </div>
                  )}

                  {isAnswerSubmitted && currentQ.explanation && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="p-4 rounded-xl bg-black/60 border border-white/[0.08] space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <HelpCircle className="w-4 h-4 text-[#FC1212]" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">
                          Penjelasan Konsep
                        </span>
                      </div>
                      <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
                        {currentQ.explanation}
                      </p>
                    </motion.div>
                  )}

                  {isAnswerSubmitted && (
                    <div className="pt-3 flex justify-end">
                      <button
                        id="btn-next-question"
                        onClick={handleNextQuestion}
                        className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-sm shadow-lg shadow-red-600/25 transition-all cursor-pointer active:scale-95"
                      >
                        <span>{getNextTurnLabel()}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="text-center space-y-6 py-4"
                >
                  <div className="w-16 h-16 rounded-full bg-[#14213D] border-2 border-[#FC1212] text-[#FC1212] mx-auto flex items-center justify-center shadow-lg shadow-red-600/20">
                    <Award className="w-8 h-8" />
                  </div>

                  <div>
                    <span className="text-xs uppercase tracking-widest text-[#FC1212] font-bold">
                      Kuis Selesai
                    </span>
                    <h3 className="text-2xl sm:text-3xl font-black text-white mt-1">
                      {isPassPlayMode
                        ? 'Sesi Pass & Play Selesai'
                        : vsBotEnabled
                        ? score > botScore
                          ? 'Kamu Menang Lawan Bot!'
                          : score < botScore
                          ? 'Bot Menang Kali Ini'
                          : 'Hasil Seri Lawan Bot'
                        : scorePercentage >= 80
                        ? 'Luar Biasa! Pemahaman Sempurna'
                        : scorePercentage >= 60
                        ? 'Hasil Bagus! Terus Berlatih'
                        : 'Eksplorasi Belajar Yang Bagus'}
                    </h3>
                    <p className="text-xs sm:text-sm text-gray-300 mt-1">
                      Kamu telah menyelesaikan deck <strong className="text-white">{deck?.title}</strong>
                    </p>
                  </div>

                  {isPassPlayMode ? (
                    <div className="max-w-sm mx-auto space-y-2">
                      {playerNamesState
                        .map((name, i) => ({ name, score: playerScores[i] }))
                        .sort((a, b) => b.score - a.score)
                        .map((p, rank) => (
                          <div
                            key={p.name}
                            className={`flex items-center justify-between p-3 rounded-xl border ${
                              rank === 0 ? 'bg-amber-950/30 border-amber-500/40' : 'bg-black/40 border-white/[0.08]'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {rank === 0 && <Crown className="w-4 h-4 text-amber-400" />}
                              <span className="text-sm font-bold text-white">{p.name}</span>
                            </div>
                            <span className="text-sm font-mono font-black text-[#FC1212]">{p.score} Poin</span>
                          </div>
                        ))}
                    </div>
                  ) : vsBotEnabled ? (
                    <div className="p-6 rounded-2xl bg-black/50 border border-white/[0.08] max-w-sm mx-auto flex items-center justify-around">
                      <div>
                        <span className="text-3xl sm:text-4xl font-black text-emerald-400 font-mono">{score}</span>
                        <span className="text-[11px] text-gray-400 block mt-0.5 flex items-center gap-1 justify-center">
                          <User className="w-3 h-3" /> Kamu
                        </span>
                      </div>
                      <div className="h-10 w-px bg-white/[0.1]" />
                      <div>
                        <span className="text-3xl sm:text-4xl font-black text-purple-400 font-mono">{botScore}</span>
                        <span className="text-[11px] text-gray-400 block mt-0.5 flex items-center gap-1 justify-center">
                          <Bot className="w-3 h-3" /> Bot ({botDifficulty})
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-6 rounded-2xl bg-black/50 border border-white/[0.08] max-w-sm mx-auto flex items-center justify-around">
                      <div>
                        <span className="text-3xl sm:text-4xl font-black text-[#FC1212] font-mono">
                          {scorePercentage}%
                        </span>
                        <span className="text-[11px] text-gray-400 block mt-0.5">Akurasi Jawaban</span>
                      </div>
                      <div className="h-10 w-px bg-white/[0.1]" />
                      <div>
                        <span className="text-3xl sm:text-4xl font-black text-white font-mono">
                          {score} / {questions.length}
                        </span>
                        <span className="text-[11px] text-gray-400 block mt-0.5">Pertanyaan Benar</span>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
                    <button
                      onClick={() => setShowReview(true)}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/15 font-bold text-sm transition-all cursor-pointer active:scale-95"
                    >
                      <ListChecks className="w-4 h-4" />
                      <span>Tinjau Jawaban</span>
                    </button>
                    <button
                      id="btn-save-result"
                      onClick={handleSaveResult}
                      disabled={isResultSaved}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-default text-black font-extrabold text-sm shadow-lg shadow-emerald-500/20 transition-all cursor-pointer active:scale-95"
                    >
                      {isResultSaved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                      <span>{isResultSaved ? 'Hasil Tersimpan' : 'Simpan Hasil'}</span>
                    </button>

                    <button
                      id="btn-play-again"
                      onClick={handleRestartQuiz}
                      className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-sm shadow-lg shadow-red-600/25 transition-all cursor-pointer active:scale-95"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Main Lagi</span>
                    </button>

                    <button
                      id="btn-return-arena"
                      onClick={onClose}
                      className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-black/60 hover:bg-black/90 text-gray-200 border border-white/[0.08] font-bold text-sm transition-all cursor-pointer"
                    >
                      Tutup Pemutar Kuis
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </motion.div>

      {/* ================= OVERLAY RIWAYAT HASIL TERSIMPAN (dengan rincian jawaban) ================= */}
      {showHistory && <QuizResultHistory onClose={() => setShowHistory(false)} />}

      {/* ================= TINJAU JAWABAN SESI YANG BARU SELESAI ================= */}
      {showReview && (
        <AnswerReviewModal title={deck?.title || 'Kuis'} answers={reviewAnswers} onClose={() => setShowReview(false)} />
      )}
    </div>
  );
};
