// src/components/PusatKuis/QuizEditor.tsx
import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  AlertCircle,
  Sliders,
  Award,
  BookOpen,
  Image as ImageIcon,
  Music,
  Video,
  Trash2,
  Save,
  Clock,
  Shuffle,
  Plus,
  Minus,
  Upload,
  ChevronDown,
  ChevronUp,
  HelpCircle,
  ArrowUp,
  ArrowDown,
  Info,
} from 'lucide-react';
import { Deck, Topic, QuizQuestion } from '../../types';
import { sanitizeInput, storage } from '../../services/storage';
import { BUILTIN_DECKS } from '../../data/quiz';
import { saveDeckToJsonStore, findDuplicateQuestions } from '../../services/quizJsonStore';

export const ADMIN_THEMES = [
  { id: 'olahraga', name: 'Olahraga', icon: '⚽', desc: 'Aktivitas fisik, atletik, kejuaraan, dan cabang olahraga dunia' },
  { id: 'sehari_hari', name: 'Kehidupan Sehari hari', icon: '🏠', desc: 'Kebiasaan hidup, rutinitas, finansial rumah tangga, dan gaya hidup' },
  { id: 'alam', name: 'Alam', icon: '🌿', desc: 'Ekosistem, flora, fauna, geografi, iklim, dan konservasi bumi' },
  { id: 'musik', name: 'Musik', icon: '🎵', desc: 'Teori musik, instrumen, genre, musisi legendaris, dan akustik' },
  { id: 'matematika', name: 'Matematika', icon: '📐', desc: 'Aritmatika, logika, aljabar, geometri, kalkulus, dan probabilitas' },
  { id: 'seni', name: 'Seni', icon: '🎨', desc: 'Seni rupa, arsitektur, desain visual, sastra, teater, dan budaya' },
  { id: 'teknologi', name: 'Teknologi', icon: '💻', desc: 'Pemrograman, kecerdasan buatan, perangkat keras, dan inovasi web' },
  { id: 'psikologi', name: 'Psikologi', icon: '🧠', desc: 'Perilaku kognitif, emosi, kepribadian, persepsi, dan interaksi sosial' },
  { id: 'bahasa', name: 'Bahasa', icon: '🗣️', desc: 'Linguistik, kosakata, tata bahasa, etimologi, dan aksara dunia' },
  { id: 'sosial', name: 'Sosial', icon: '👥', desc: 'Sosiologi, hubungan kemasyarakatan, antropologi, dan sejarah dunia' },
  { id: 'fiksi', name: 'Fiksi', icon: '📖', desc: 'Dunia fantasi, mitologi, komik, film, karakter novel, dan cerita rekaan' },
  { id: 'lainnya', name: 'Lainnya', icon: '✨', desc: 'Topik pengetahuan umum dan kategori minat khusus lainnya' },
];

export type EditorStep = 'theme' | 'topic' | 'info' | 'settings' | 'questions' | 'review';
export type QuizDifficulty = 'Mudah' | 'Biasa' | 'Sulit' | 'Ekstrem' | 'Tidak dispesifikasikan';

export interface QuestionChoice {
  text: string;
  mediaType?: 'none' | 'image' | 'audio' | 'video';
  mediaUrl?: string;
  isCorrect: boolean;
  pointsAllocated: number;
  explanationCorrect?: string;
  explanationWrong?: string;
  showExplanation?: boolean;
}

export interface DetailedQuestion {
  id: string;
  text: string;
  mediaType?: 'none' | 'image' | 'audio' | 'video';
  mediaUrl?: string;
  points: number;
  timeLimitSec: number;
  generalCorrectExplanation?: string;
  showGeneralExplanation?: boolean;
  choices: QuestionChoice[];
}

interface QuizEditorProps {
  isOpen: boolean;
  onClose: () => void;
  topics?: Topic[];
  editingDeck?: Deck | null;
  onDeckCreatedOrUpdated: (deck: Deck) => void;
  onTopicCreatedOrUpdated: (topic: Topic) => void;
  onSuccessToast?: (msg: string) => void;
}

export const QuizEditor: React.FC<QuizEditorProps> = ({
  isOpen,
  onClose,
  topics = [],
  editingDeck,
  onDeckCreatedOrUpdated,
  onTopicCreatedOrUpdated,
  onSuccessToast,
}) => {
  const [currentStep, setCurrentStep] = useState<EditorStep>('theme');

  // Step 1: Tema
  const [selectedThemeId, setSelectedThemeId] = useState<string>('teknologi');

  // Step 2: Topik
  const [topicName, setTopicName] = useState<string>('');
  const [topicDesc, setTopicDesc] = useState<string>('');

  // Step 3: Info Kuis
  const [quizTitle, setQuizTitle] = useState<string>('');
  const [quizDesc, setQuizDesc] = useState<string>('');
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('Tidak dispesifikasikan');

  // Step 4: Pengaturan Kuis
  const [totalQuestions, setTotalQuestions] = useState<number>(3);
  const [scoreUnit, setScoreUnit] = useState<'point' | 'percent'>('point');
  const [roundScores, setRoundScores] = useState<boolean>(true);
  const [pointSystem, setPointSystem] = useState<'equal' | 'variable'>('equal');
  const [equalScorePerQuestion, setEqualScorePerQuestion] = useState<number>(10);
  const [choicesPerQuestion, setChoicesPerQuestion] = useState<number>(4);
  const [correctAnswerMode, setCorrectAnswerMode] = useState<'single' | 'multiple'>('single');
  const [multiEvaluationMode, setMultiEvaluationMode] = useState<'all_or_nothing' | 'partial'>('partial');
  const [enablePenaltyMinus, setEnablePenaltyMinus] = useState<boolean>(false);
  const [penaltyPercentage, setPenaltyPercentage] = useState<number>(25);
  const [shuffleChoices, setShuffleChoices] = useState<boolean>(false);
  const [hasGlobalTimer, setHasGlobalTimer] = useState<boolean>(false);
  const [globalTimeLimitSec, setGlobalTimeLimitSec] = useState<number>(60);
  const [showDifficultyHelp, setShowDifficultyHelp] = useState<boolean>(false);

  // Step 5: Soal
  const [questions, setQuestions] = useState<DetailedQuestion[]>([]);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeUploadTarget, setActiveUploadTarget] = useState<{ type: 'q' | 'choice'; choiceIdx?: number } | null>(null);

  // Mode Edit: Ambil Nama Topik dari objek Topic, bukan string ID
  useEffect(() => {
    if (editingDeck && isOpen) {
      setQuizTitle(editingDeck.title || '');
      setQuizDesc(editingDeck.description || '');
      setDifficulty(
        ['Mudah', 'Biasa', 'Sulit', 'Ekstrem'].includes(editingDeck.difficulty)
          ? (editingDeck.difficulty as QuizDifficulty)
          : 'Tidak dispesifikasikan'
      );

      // Cari Topik Berdasarkan ID atau Title
      const foundTopic = topics.find(
        (t) => t.id === editingDeck.topicId || t.title.toLowerCase() === editingDeck.topicId?.toLowerCase()
      );

      if (foundTopic) {
        setTopicName(foundTopic.title);
        setTopicDesc(foundTopic.description || '');
        const matchingTheme = ADMIN_THEMES.find(
          (th) => th.name.toLowerCase() === (foundTopic.badge || editingDeck.badge || '').toLowerCase()
        );
        if (matchingTheme) setSelectedThemeId(matchingTheme.id);
      } else {
        // Pembersihan jika tersimpan ID acak
        let rawName = editingDeck.topicId || '';
        if (rawName.startsWith('topic-')) {
          const parts = rawName.split('-');
          rawName = parts.slice(2).join(' ') || parts[1] || 'Topik Kuis';
        }
        setTopicName(rawName);
      }

      if (editingDeck.questions && editingDeck.questions.length > 0) {
        setTotalQuestions(editingDeck.questions.length);
        const loadedQuestions: DetailedQuestion[] = editingDeck.questions.map((q, idx) => ({
          id: q.id || `q-${idx + 1}`,
          text: q.question,
          mediaType: (q as any).mediaType || 'none',
          mediaUrl: (q as any).mediaUrl || '',
          points: 10,
          timeLimitSec: Number((q as any).timeLimitSec) || 0,
          choices: (q.options || []).map((opt, oIdx) => ({
            text: opt,
            isCorrect: oIdx === q.correctIndex,
            pointsAllocated: oIdx === q.correctIndex ? 10 : 0,
            explanationCorrect: oIdx === q.correctIndex ? q.explanation : '',
            explanationWrong: '',
            showExplanation: false,
          })),
        }));
        setQuestions(loadedQuestions);
        const savedTime = Number((editingDeck.questions[0] as any)?.timeLimitSec) || 0;
        if (savedTime > 0) {
          setHasGlobalTimer(true);
          setGlobalTimeLimitSec(savedTime);
        }
        setChoicesPerQuestion(editingDeck.questions[0]?.options?.length || 4);
      }
    }
  }, [editingDeck, isOpen, topics]);

  // Aturan Batasan Tingkat Kesulitan
  useEffect(() => {
    if (difficulty === 'Mudah') {
      if (totalQuestions > 25) setTotalQuestions(25);
      if (choicesPerQuestion > 5) setChoicesPerQuestion(5);
      setPointSystem('equal');
      setEnablePenaltyMinus(false);
      setShuffleChoices(false);
      setMultiEvaluationMode('partial');
    } else if (difficulty === 'Biasa') {
      if (totalQuestions > 50) setTotalQuestions(50);
      if (penaltyPercentage > 50) setPenaltyPercentage(50);
      setShuffleChoices(false);
    } else if (difficulty === 'Sulit') {
      if (totalQuestions > 100) setTotalQuestions(100);
    } else if (difficulty === 'Ekstrem') {
      if (totalQuestions > 100) setTotalQuestions(100);
      setEnablePenaltyMinus(true);
      setPenaltyPercentage(100);
      setShuffleChoices(true);
      setMultiEvaluationMode('all_or_nothing');
    }
  }, [difficulty]);

  useEffect(() => {
    if (choicesPerQuestion === 2 && correctAnswerMode === 'multiple') {
      setCorrectAnswerMode('single');
    }
  }, [choicesPerQuestion, correctAnswerMode]);

  if (!isOpen) return null;

  const maxAllowedPenalty = difficulty === 'Biasa' ? 50 : 100;

  const handleStepClick = (targetStep: EditorStep) => {
    setErrorMsg(null);
    // PERBAIKAN BUG: sebelumnya rebuild array pilihan jawaban (sesuai
    // choicesPerQuestion terbaru) HANYA terjadi kalau soal belum pernah
    // dibuat sama sekali (questions.length === 0). Akibatnya jika pengguna
    // sudah pernah masuk ke tahap Soal (misalnya dengan 4 pilihan default),
    // lalu kembali ke Pengaturan dan mengubah jadi 2 atau 10 pilihan, dan
    // langsung klik tab "5. Butir Soal" di navigasi atas (bukan tombol
    // footer "Terapkan & Mulai Buat Soal"), perubahan jumlah pilihan itu
    // TIDAK PERNAH diterapkan — soal tetap memakai jumlah pilihan lama.
    // Sekarang: setiap kali user berpindah step KELUAR dari 'settings' menuju
    // 'questions'/'review', pengaturan selalu diterapkan ulang dulu agar
    // jumlah pilihan jawaban selalu sinkron dengan yang dipilih di Pengaturan.
    if ((targetStep === 'questions' || targetStep === 'review') && (questions.length === 0 || currentStep === 'settings')) {
      handleApplySettingsAndProceed();
      return;
    }
    setCurrentStep(targetStep);
  };

  const handleApplySettingsAndProceed = () => {
    setErrorMsg(null);
    const maxQ = difficulty === 'Mudah' ? 25 : difficulty === 'Biasa' ? 50 : 100;
    if (totalQuestions < 1 || totalQuestions > maxQ) {
      setErrorMsg(`Jumlah butir soal adalah antara 1 hingga ${maxQ}.`);
      return;
    }

    setQuestions((prev) => {
      const result: DetailedQuestion[] = [];
      for (let i = 0; i < totalQuestions; i++) {
        const existing = prev[i];
        const initialPoints = pointSystem === 'equal' ? equalScorePerQuestion : (existing?.points || 10);
        
        const choices: QuestionChoice[] = [];
        for (let c = 0; c < choicesPerQuestion; c++) {
          const oldChoice = existing?.choices?.[c];
          choices.push({
            text: oldChoice?.text || '',
            mediaType: oldChoice?.mediaType || 'none',
            mediaUrl: oldChoice?.mediaUrl || '',
            isCorrect: oldChoice ? oldChoice.isCorrect : (correctAnswerMode === 'single' && c === 0),
            pointsAllocated: oldChoice?.pointsAllocated || 0,
            explanationCorrect: oldChoice?.explanationCorrect || '',
            explanationWrong: oldChoice?.explanationWrong || '',
            showExplanation: false,
          });
        }

        result.push({
          id: existing?.id || `q-${i + 1}`,
          text: existing?.text || '',
          mediaType: existing?.mediaType || 'none',
          mediaUrl: existing?.mediaUrl || '',
          points: initialPoints,
          timeLimitSec: hasGlobalTimer ? globalTimeLimitSec : (existing?.timeLimitSec || 0),
          generalCorrectExplanation: existing?.generalCorrectExplanation || '',
          showGeneralExplanation: false,
          choices,
        });
      }
      return result;
    });

    setActiveQuestionIndex(0);
    setCurrentStep('questions');
  };

  const curQ = questions[activeQuestionIndex];

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeUploadTarget || !curQ) return;

    let maxBytes = 2 * 1024 * 1024;
    let mediaCat: 'image' | 'audio' | 'video' = 'image';

    if (file.type.startsWith('audio/')) {
      maxBytes = 5 * 1024 * 1024;
      mediaCat = 'audio';
    } else if (file.type.startsWith('video/')) {
      maxBytes = 10 * 1024 * 1024;
      mediaCat = 'video';
    }

    if (file.size > maxBytes) {
      alert(`Ukuran berkas melebihi batas maksimal (${Math.round(maxBytes / (1024 * 1024))}MB).`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        setQuestions((prev) =>
          prev.map((q, qi) => {
            if (qi !== activeQuestionIndex) return q;
            if (activeUploadTarget.type === 'q') {
              return { ...q, mediaType: mediaCat, mediaUrl: dataUrl };
            }
            if (typeof activeUploadTarget.choiceIdx === 'number') {
              return {
                ...q,
                choices: q.choices.map((c, ci) =>
                  ci === activeUploadTarget.choiceIdx ? { ...c, mediaType: mediaCat, mediaUrl: dataUrl } : c
                ),
              };
            }
            return q;
          })
        );
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleToggleChoiceCorrect = (choiceIdx: number) => {
    if (!curQ) return;
    setQuestions((prev) =>
      prev.map((q, qi) => {
        if (qi !== activeQuestionIndex) return q;
        const newChoices = q.choices.map((c) => ({ ...c }));

        if (correctAnswerMode === 'single') {
          const isAlreadySoleCorrect = newChoices[choiceIdx].isCorrect && newChoices.filter((c) => c.isCorrect).length === 1;
          newChoices.forEach((c, idx) => {
            const shouldCorrect = isAlreadySoleCorrect ? false : idx === choiceIdx;
            c.isCorrect = shouldCorrect;
            c.pointsAllocated = shouldCorrect ? q.points : 0;
          });
        } else {
          const currentlyCorrect = newChoices.filter((c) => c.isCorrect).length;
          const willBeCorrect = !newChoices[choiceIdx].isCorrect;

          if (willBeCorrect && currentlyCorrect + 1 >= newChoices.length) {
            alert(`Maksimal jawaban benar adalah ${newChoices.length - 1} dari ${newChoices.length} pilihan.`);
            return q;
          }

          newChoices[choiceIdx].isCorrect = willBeCorrect;
          if (!willBeCorrect) newChoices[choiceIdx].pointsAllocated = 0;

          if (multiEvaluationMode === 'partial') {
            const correctOnes = newChoices.filter((c) => c.isCorrect);
            if (correctOnes.length > 0) {
              const split = roundScores
                ? Math.round(q.points / correctOnes.length)
                : Number((q.points / correctOnes.length).toFixed(1));
              let sumAllocated = 0;
              correctOnes.forEach((c, i) => {
                if (i === correctOnes.length - 1) {
                  c.pointsAllocated = Math.max(0, q.points - sumAllocated);
                } else {
                  c.pointsAllocated = split;
                  sumAllocated += split;
                }
              });
            }
          }
        }

        return { ...q, choices: newChoices };
      })
    );
  };

  const handleUpdateChoicePoint = (choiceIndex: number, newPointVal: number) => {
    if (!curQ) return;
    setQuestions((prev) =>
      prev.map((q, qi) => {
        if (qi !== activeQuestionIndex) return q;
        const correctIndices = q.choices.map((c, idx) => (c.isCorrect ? idx : -1)).filter((idx) => idx !== -1);

        if (correctIndices.length <= 1) {
          return {
            ...q,
            choices: q.choices.map((c, ci) => (ci === choiceIndex ? { ...c, pointsAllocated: q.points } : c)),
          };
        }

        const lastCorrectIdx = correctIndices[correctIndices.length - 1];
        const newChoices = q.choices.map((c) => ({ ...c }));

        if (choiceIndex !== lastCorrectIdx) {
          const sumOthers = correctIndices
            .filter((idx) => idx !== choiceIndex && idx !== lastCorrectIdx)
            .reduce((acc, idx) => acc + (newChoices[idx].pointsAllocated || 0), 0);

          const maxAllowed = Math.max(0, q.points - sumOthers);
          const clamped = Math.max(0, Math.min(maxAllowed, newPointVal));
          newChoices[choiceIndex].pointsAllocated = clamped;

          const remaining = Math.max(0, q.points - (sumOthers + clamped));
          newChoices[lastCorrectIdx].pointsAllocated = remaining;
        } else {
          const sumOthers = correctIndices
            .filter((idx) => idx !== lastCorrectIdx)
            .reduce((acc, idx) => acc + (newChoices[idx].pointsAllocated || 0), 0);
          const maxAllowed = Math.max(0, q.points - sumOthers);
          newChoices[lastCorrectIdx].pointsAllocated = Math.max(0, Math.min(maxAllowed, newPointVal));
        }

        return { ...q, choices: newChoices };
      })
    );
  };

  const handleMoveChoice = (cIdx: number, direction: 'up' | 'down') => {
    if (!curQ) return;
    const targetIdx = direction === 'up' ? cIdx - 1 : cIdx + 1;
    if (targetIdx < 0 || targetIdx >= curQ.choices.length) return;

    setQuestions((prev) =>
      prev.map((q, qi) => {
        if (qi !== activeQuestionIndex) return q;
        const chs = [...q.choices];
        const temp = chs[cIdx];
        chs[cIdx] = chs[targetIdx];
        chs[targetIdx] = temp;
        return { ...q, choices: chs };
      })
    );
  };

  const handleProceedQuestionStep = () => {
    setErrorMsg(null);
    if (!curQ.text.trim()) {
      setErrorMsg(`Soal nomor ${activeQuestionIndex + 1} belum memiliki teks pertanyaan.`);
      return;
    }

    const filled = curQ.choices.filter((c) => c.text.trim() !== '');
    if (filled.length < choicesPerQuestion) {
      setErrorMsg(`Semua ${choicesPerQuestion} pilihan jawaban pada soal ini wajib diisi teksnya.`);
      return;
    }

    const correctCount = curQ.choices.filter((c) => c.isCorrect).length;
    if (correctCount === 0) {
      setErrorMsg('Wajib menentukan minimal 1 jawaban benar pada soal ini.');
      return;
    }

    if (activeQuestionIndex < totalQuestions - 1) {
      setActiveQuestionIndex((prev) => prev + 1);
    } else {
      setCurrentStep('review');
    }
  };

  // Simpan Kuis: ID Topik Bersih & Konsisten
  const handleSaveQuiz = () => {
    const selectedThemeObj = ADMIN_THEMES.find((t) => t.id === selectedThemeId) || ADMIN_THEMES[0];
    const cleanTopicTitle = sanitizeInput(topicName).trim();
    const topicSlug = cleanTopicTitle.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const cleanTopicId = `topic-${selectedThemeId}-${topicSlug}`;
    const generatedDeckId = editingDeck?.id || `deck-custom-${Date.now()}`;

    const newTopic: Topic = {
      id: cleanTopicId,
      title: cleanTopicTitle,
      description: sanitizeInput(topicDesc) || `Topik ${cleanTopicTitle} dalam tema ${selectedThemeObj.name}.`,
      badge: selectedThemeObj.name,
      iconName: 'Sparkles',
      price: 0,
      isCustom: true,
    };

    const formattedQuestions: QuizQuestion[] = questions.map((q, idx) => {
      const correctIdx = q.choices.findIndex((c) => c.isCorrect);
      return {
        id: `q-det-${idx + 1}-${Date.now()}`,
        question: sanitizeInput(q.text),
        options: q.choices.map((c) => sanitizeInput(c.text)),
        correctIndex: correctIdx >= 0 ? correctIdx : 0,
        explanation: q.choices.find((c) => c.isCorrect)?.explanationCorrect || q.generalCorrectExplanation || 'Kunci jawaban benar.',
        category: cleanTopicTitle,
        mediaType: q.mediaType && q.mediaType !== 'none' ? q.mediaType : undefined,
        mediaUrl: q.mediaType && q.mediaType !== 'none' && q.mediaUrl ? q.mediaUrl : undefined,
        // Batas waktu per soal (detik). 0 = tanpa batas waktu.
        timeLimitSec: q.timeLimitSec > 0 ? q.timeLimitSec : 0,
      };
    });

    const newDeck: Deck = {
      id: generatedDeckId,
      topicId: cleanTopicId,
      title: sanitizeInput(quizTitle),
      description: sanitizeInput(quizDesc) || `Kuis ${quizTitle} dengan ${questions.length} butir soal.`,
      cardCount: questions.length,
      difficulty: difficulty === 'Tidak dispesifikasikan' ? 'Sedang' : (difficulty as any),
      isFree: true,
      price: 0,
      badge: selectedThemeObj.name,
      questions: formattedQuestions,
    };

    storage.saveCustomTopic(newTopic);
    storage.saveCustomDeck(newDeck);
    // Salinan JSON: soal, semua pilihan, kunci jawaban, penjelasan, dan media tersimpan sebagai dokumen JSON
    const jsonSaved = saveDeckToJsonStore(newDeck, newTopic);
    onTopicCreatedOrUpdated(newTopic);
    onDeckCreatedOrUpdated(newDeck);

    // Peringatan bila ada soal yang sama persis dengan soal deck bawaan
    const dupes = findDuplicateQuestions([...BUILTIN_DECKS, newDeck]).filter((d) =>
      d.where.some((w) => w.startsWith(newDeck.title))
    );

    if (onSuccessToast) {
      onSuccessToast(
        `Kuis "${newDeck.title}" berhasil disimpan ke Koleksi Anda${jsonSaved ? ' (tersimpan sebagai JSON)' : ' (JSON gagal disimpan: penyimpanan penuh)'}!` +
          (dupes.length ? ` Perhatian: ${dupes.length} soal sama dengan soal bawaan.` : '')
      );
    }
    onClose();
  };

  const selectedThemeObj = ADMIN_THEMES.find((t) => t.id === selectedThemeId) || ADMIN_THEMES[0];
  const calculatedPenaltyVal = roundScores
    ? Math.round(equalScorePerQuestion * (penaltyPercentage / 100))
    : Number((equalScorePerQuestion * (penaltyPercentage / 100)).toFixed(1));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-md overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        className="w-full max-w-4xl rounded-3xl bg-[#14213D] border border-white/[0.12] shadow-2xl overflow-hidden flex flex-col my-auto max-h-[94vh]"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,audio/*,video/*"
          className="hidden"
          onChange={handleFileUpload}
        />

        {/* Header Atas */}
        <div className="p-4 sm:p-5 border-b border-white/10 bg-black/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FC1212] text-white flex items-center justify-center shadow-lg shadow-red-600/20 font-black">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-black text-white">Studio Quiz Editor Mandiri</h3>
              <p className="text-xs text-gray-400">
                Alur bertahap: Tema → Topik → Info Kuis → Pengaturan → Soal → Review
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-gray-400 hover:text-white hover:bg-black/60 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Bilah 6 Stepper Atas */}
        <div className="flex items-center border-b border-white/[0.08] bg-black/40 px-4 sm:px-6 py-3 overflow-x-auto no-scrollbar gap-2 shrink-0">
          {[
            { id: 'theme', label: '1. Tema' },
            { id: 'topic', label: '2. Topik' },
            { id: 'info', label: '3. Info Kuis' },
            { id: 'settings', label: '4. Pengaturan' },
            { id: 'questions', label: '5. Butir Soal' },
            { id: 'review', label: '6. Review & Simpan' },
          ].map((st) => (
            <button
              key={st.id}
              type="button"
              onClick={() => handleStepClick(st.id as EditorStep)}
              className={`shrink-0 min-w-max px-4 py-2 rounded-full font-bold text-xs inline-flex items-center justify-center transition-all cursor-pointer ${
                currentStep === st.id
                  ? 'bg-[#FC1212] text-white shadow-lg shadow-red-600/30 font-black'
                  : 'text-gray-400 bg-white/[0.04] hover:text-white hover:bg-white/10'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="p-3 bg-red-950/60 border-b border-red-500/40 px-6 text-xs text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#FC1212] shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="p-5 sm:p-7 overflow-y-auto space-y-6 flex-1">
          {/* STEP 1: TEMA */}
          {currentStep === 'theme' && (
            <div className="space-y-4">
              <div>
                <span className="text-xs font-mono font-bold text-[#FC1212] uppercase tracking-wider block mb-1">Langkah 1 dari 6</span>
                <h4 className="text-xl font-black text-white">Tentukan Tema Kuis</h4>
                <p className="text-xs text-gray-400 mt-1">Pilih kategori induk yang telah ditentukan oleh admin:</p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 pt-2">
                {ADMIN_THEMES.map((theme) => (
                  <div
                    key={theme.id}
                    onClick={() => setSelectedThemeId(theme.id)}
                    className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                      selectedThemeId === theme.id
                        ? 'bg-[#FC1212]/15 border-[#FC1212] ring-2 ring-[#FC1212]/40 shadow-lg'
                        : 'bg-black/40 border-white/10 hover:border-white/20'
                    }`}
                  >
                    <div>
                      <span className="text-2xl block mb-2">{theme.icon}</span>
                      <h5 className="text-sm font-bold text-white">{theme.name}</h5>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-2 line-clamp-2">{theme.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* STEP 2: TOPIK */}
          {currentStep === 'topic' && (
            <div className="space-y-5 max-w-2xl">
              <div>
                <span className="text-xs font-mono font-bold text-[#FC1212] uppercase tracking-wider block mb-1">Langkah 2 dari 6</span>
                <h4 className="text-xl font-black text-white">Tentukan Topik Kuis</h4>
                <p className="text-xs text-gray-400 mt-1">Topik adalah turunan bebas di bawah Tema <strong>{selectedThemeObj.name}</strong>:</p>
              </div>

              <div className="space-y-4 bg-black/40 p-5 rounded-2xl border border-white/10">
                <div>
                  <label className="text-xs font-bold text-gray-300 block mb-1">Nama Topik <span className="text-[#FC1212]">*</span></label>
                  <input
                    type="text"
                    required
                    value={topicName}
                    onChange={(e) => setTopicName(e.target.value)}
                    placeholder="Contoh: Pemrograman React & Arsitektur Cloud"
                    className="w-full bg-black/60 border border-white/15 focus:border-[#FC1212] rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-300 block mb-1">Deskripsi Topik</label>
                  <textarea
                    rows={3}
                    value={topicDesc}
                    onChange={(e) => setTopicDesc(e.target.value)}
                    placeholder="Jelaskan cakupan materi topik ini..."
                    className="w-full bg-black/60 border border-white/15 focus:border-[#FC1212] rounded-xl p-3 text-xs text-white outline-none resize-none"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: INFO KUIS */}
          {currentStep === 'info' && (
            <div className="space-y-5 max-w-2xl">
              <div>
                <span className="text-xs font-mono font-bold text-[#FC1212] uppercase tracking-wider block mb-1">Langkah 3 dari 6</span>
                <h4 className="text-xl font-black text-white">Informasi Spesifik Kuis</h4>
                <p className="text-xs text-gray-400 mt-1">Judul kuis berada di bawah Topik <strong>{topicName || 'Topik Anda'}</strong>:</p>
              </div>

              <div className="space-y-4 bg-black/40 p-5 rounded-2xl border border-white/10">
                <div>
                  <label className="text-xs font-bold text-gray-300 block mb-1">Judul Kuis <span className="text-[#FC1212]">*</span></label>
                  <input
                    type="text"
                    required
                    value={quizTitle}
                    onChange={(e) => setQuizTitle(e.target.value)}
                    placeholder="Contoh: Evaluasi Sintaksis Hooks & State Management"
                    className="w-full bg-black/60 border border-white/15 focus:border-[#FC1212] rounded-xl px-3.5 py-2.5 text-xs text-white outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-300 block mb-1">Deskripsi Kuis</label>
                  <textarea
                    rows={3}
                    value={quizDesc}
                    onChange={(e) => setQuizDesc(e.target.value)}
                    placeholder="Ringkasan atau instruksi pengerjaan kuis..."
                    className="w-full bg-black/60 border border-white/15 focus:border-[#FC1212] rounded-xl p-3 text-xs text-white outline-none resize-none"
                  />
                </div>
                <div className="relative">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <label className="text-xs font-bold text-gray-300">Tingkat Kesulitan (Opsional):</label>
                    <button
                      type="button"
                      onClick={() => setShowDifficultyHelp((v) => !v)}
                      className="text-gray-400 hover:text-[#FCA311] cursor-pointer"
                      title="Perbedaan tiap tingkat kesulitan"
                    >
                      <HelpCircle className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {showDifficultyHelp && (
                    <div className="mb-3 p-3.5 rounded-2xl bg-black/70 border border-[#FCA311]/40 text-[11px] text-gray-300 space-y-1.5 leading-relaxed">
                      <p><strong className="text-white">Mudah:</strong> Maks 25 soal, maks 5 opsi, poin wajib sama rata, tanpa nilai minus.</p>
                      <p><strong className="text-white">Biasa:</strong> Maks 50 soal, maks 10 opsi, poin berbeda boleh, nilai minus 0–50%.</p>
                      <p><strong className="text-white">Sulit:</strong> Maks 100 soal, nilai minus 0–100%, acak opsi dapat diaktifkan.</p>
                      <p><strong className="text-white">Ekstrem:</strong> Maks 100 soal, acak opsi dan nilai minus 100% wajib aktif.</p>
                      <p><strong className="text-white">Tidak dispesifikasikan:</strong> Seluruh fitur bebas digunakan tanpa paksaan.</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                    {(['Mudah', 'Biasa', 'Sulit', 'Ekstrem', 'Tidak dispesifikasikan'] as const).map((diff) => (
                      <button
                        key={diff}
                        type="button"
                        onClick={() => setDifficulty(diff)}
                        className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                          difficulty === diff ? 'bg-[#FC1212] text-white border-[#FC1212] shadow' : 'bg-black/50 text-gray-400 border-white/10 hover:text-white'
                        }`}
                      >
                        {diff}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: PENGATURAN KUIS */}
          {currentStep === 'settings' && (
            <div className="space-y-5 max-w-3xl">
              <div>
                <span className="text-xs font-mono font-bold text-[#FC1212] uppercase tracking-wider block mb-1">Langkah 4 dari 6</span>
                <h4 className="text-xl font-black text-white">Pengaturan &amp; Aturan Penilaian</h4>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Jumlah Soal (Hingga 100) */}
                <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-300">Jumlah Butir Soal:</label>
                    <span className="text-[10px] font-mono text-[#FCA311]">
                      Maks {difficulty === 'Mudah' ? 25 : difficulty === 'Biasa' ? 50 : 100} Soal
                    </span>
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={difficulty === 'Mudah' ? 25 : difficulty === 'Biasa' ? 50 : 100}
                    value={totalQuestions}
                    onChange={(e) => setTotalQuestions(Number(e.target.value) || 1)}
                    className="w-full bg-black/60 border border-white/15 focus:border-[#FC1212] rounded-xl px-3 py-2 text-xs font-mono font-bold text-white outline-none"
                  />
                </div>

                {/* Jumlah Pilihan Jawaban */}
                <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-300">Jumlah Pilihan Jawaban:</label>
                    <span className="text-[10px] font-mono text-[#FCA311]">
                      {difficulty === 'Mudah' ? 'Maks 5 Opsi' : '2 s/d 10 Opsi'}
                    </span>
                  </div>
                  <select
                    value={choicesPerQuestion}
                    onChange={(e) => setChoicesPerQuestion(Number(e.target.value))}
                    className="w-full bg-black/60 border border-white/15 focus:border-[#FC1212] rounded-xl px-3 py-2 text-xs font-bold text-white outline-none cursor-pointer"
                  >
                    {[2, 3, 4, 5, 6, 7, 8, 9, 10]
                      .filter((n) => (difficulty === 'Mudah' ? n <= 5 : true))
                      .map((num) => (
                        <option key={num} value={num} className="bg-[#14213D] text-white">
                          {num} Pilihan ({String.fromCharCode(65)} s/d {String.fromCharCode(65 + num - 1)})
                        </option>
                      ))}
                  </select>
                </div>

                {/* Pembobotan & Satuan Nilai */}
                <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-2.5">
                  <label className="text-xs font-bold text-gray-300 block">Sistem &amp; Satuan Penilaian:</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setScoreUnit('point')}
                      className={`p-2 rounded-xl border text-xs font-bold cursor-pointer ${scoreUnit === 'point' ? 'bg-[#FC1212] text-white border-[#FC1212]' : 'bg-black/50 text-gray-400 border-white/10'}`}
                    >
                      Poin (1 s/d 1000)
                    </button>
                    <button
                      type="button"
                      onClick={() => setScoreUnit('percent')}
                      className={`p-2 rounded-xl border text-xs font-bold cursor-pointer ${scoreUnit === 'percent' ? 'bg-[#FC1212] text-white border-[#FC1212]' : 'bg-black/50 text-gray-400 border-white/10'}`}
                    >
                      Persentase (0% - 100%)
                    </button>
                  </div>

                  {pointSystem === 'equal' && (
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <label className="text-[11px] text-gray-300 shrink-0">Nilai Tiap Soal:</label>
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min={scoreUnit === 'percent' ? 0 : 1}
                          max={scoreUnit === 'percent' ? 100 : 1000}
                          value={equalScorePerQuestion}
                          onChange={(e) => setEqualScorePerQuestion(Number(e.target.value) || 0)}
                          className="w-20 bg-black/80 border border-white/20 rounded-lg px-2 py-1 text-center text-xs font-mono font-bold text-white outline-none focus:border-[#FC1212]"
                        />
                        <span className="text-[11px] text-gray-400 font-mono">{scoreUnit === 'percent' ? '%' : 'pt'}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <label className="text-[11px] text-gray-300 flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={roundScores}
                        onChange={(e) => setRoundScores(e.target.checked)}
                        className="accent-[#FC1212]"
                      />
                      <span>Bulatkan Nilai</span>
                    </label>

                    <button
                      type="button"
                      disabled={difficulty === 'Mudah'}
                      onClick={() => setPointSystem(pointSystem === 'equal' ? 'variable' : 'equal')}
                      className="text-[11px] font-bold text-[#FCA311] underline disabled:opacity-30 cursor-pointer"
                    >
                      {pointSystem === 'equal' ? 'Ganti ke Poin Berbeda' : 'Ganti ke Poin Sama Rata'}
                    </button>
                  </div>
                </div>

                {/* Penalti Nilai Minus */}
                <div className="p-4 rounded-2xl bg-black/40 border border-white/10 space-y-2.5">
                  <label className="text-xs font-bold text-gray-300 block">Penalti &amp; Tata Letak Opsi:</label>
                  <div className="space-y-2 text-xs">
                    <label className="flex items-center justify-between cursor-pointer">
                      <span className="text-gray-300">Penalti Nilai Minus (Salah):</span>
                      <input
                        type="checkbox"
                        disabled={difficulty === 'Mudah' || difficulty === 'Ekstrem'}
                        checked={enablePenaltyMinus}
                        onChange={(e) => setEnablePenaltyMinus(e.target.checked)}
                        className="accent-[#FC1212] w-4 h-4 cursor-pointer"
                      />
                    </label>

                    {enablePenaltyMinus && (
                      <div className="p-2.5 rounded-xl bg-black/50 border border-white/5 space-y-1.5">
                        <div className="flex justify-between items-center text-[11px]">
                          <span className="text-gray-400">Besaran Penalti:</span>
                          <span className="font-mono font-bold text-red-400">
                            {penaltyPercentage}% (setara -{calculatedPenaltyVal} {scoreUnit === 'percent' ? '%' : 'pt'})
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max={maxAllowedPenalty}
                          value={penaltyPercentage}
                          onChange={(e) => setPenaltyPercentage(Number(e.target.value))}
                          className="w-full h-1.5 bg-zinc-800 rounded appearance-none accent-[#FC1212] cursor-pointer"
                        />
                      </div>
                    )}

                    <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-white/5">
                      <span className="text-gray-300">Acak Pilihan Jawaban:</span>
                      <input
                        type="checkbox"
                        disabled={difficulty === 'Mudah' || difficulty === 'Biasa' || difficulty === 'Ekstrem'}
                        checked={shuffleChoices}
                        onChange={(e) => setShuffleChoices(e.target.checked)}
                        className="accent-[#FC1212] w-4 h-4 cursor-pointer"
                      />
                    </label>
                  </div>
                </div>

                {/* Kriteria Jawaban Benar */}
                <div className="p-5 rounded-2xl bg-black/40 border border-white/10 space-y-4 sm:col-span-2">
                  <div className="flex justify-between items-center">
                    <label className="text-xs font-bold text-gray-300">Kriteria Jawaban Benar:</label>
                    {choicesPerQuestion === 2 && (
                      <span className="text-[10px] text-gray-400 font-mono">
                        *Opsi &gt;1 jawaban benar mati karena pilihan hanya 2
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setCorrectAnswerMode('single')}
                      className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-all ${
                        correctAnswerMode === 'single'
                          ? 'bg-[#FC1212] text-white border-[#FC1212] shadow-md'
                          : 'bg-black/50 text-gray-400 border-white/10 hover:text-white'
                      }`}
                    >
                      1 Jawaban Benar
                    </button>
                    <button
                      type="button"
                      disabled={choicesPerQuestion === 2}
                      onClick={() => setCorrectAnswerMode('multiple')}
                      className={`p-2.5 rounded-xl border text-xs font-bold cursor-pointer transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
                        correctAnswerMode === 'multiple'
                          ? 'bg-[#FC1212] text-white border-[#FC1212] shadow-md'
                          : 'bg-black/50 text-gray-400 border-white/10 hover:text-white'
                      }`}
                    >
                      &gt;1 Jawaban Benar
                    </button>
                  </div>

                  {/* Sub-Mode Jawaban Ganda Langsung Tampil */}
                  {correctAnswerMode === 'multiple' && (
                    <div className="pt-3 border-t border-white/10 space-y-2.5 animate-in fade-in duration-150">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-white flex items-center gap-1.5">
                          <span>Aturan Penilaian Jawaban Ganda:</span>
                          <span className="text-[10px] font-mono text-[#FCA311]">
                            ({multiEvaluationMode === 'all_or_nothing' ? 'Harus Benar Semua' : 'Atur Poin Sendiri'})
                          </span>
                        </span>
                        {difficulty === 'Mudah' && (
                          <span className="text-[10px] text-amber-300 font-mono">*Tingkat Mudah: wajib atur poin per opsi</span>
                        )}
                        {difficulty === 'Ekstrem' && (
                          <span className="text-[10px] text-amber-300 font-mono">*Tingkat Ekstrem: wajib benar semua</span>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <button
                          type="button"
                          disabled={difficulty === 'Mudah'}
                          onClick={() => setMultiEvaluationMode('all_or_nothing')}
                          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            multiEvaluationMode === 'all_or_nothing'
                              ? 'bg-[#FC1212] text-white border-[#FC1212] font-black shadow-lg shadow-red-600/20'
                              : 'bg-black/60 text-gray-300 border-white/10 hover:border-white/25'
                          }`}
                        >
                          <div className="text-xs font-black">A. Seluruh Jawaban Benar Harus Dipilih</div>
                          <div className="text-[11px] opacity-80 mt-1 leading-relaxed">
                            Peserta wajib memilih seluruh jawaban benar untuk mendapatkan nilai penuh. Jika ada yang kurang atau salah pilih, nilai 0.
                          </div>
                        </button>

                        <button
                          type="button"
                          disabled={difficulty === 'Ekstrem'}
                          onClick={() => setMultiEvaluationMode('partial')}
                          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
                            multiEvaluationMode === 'partial'
                              ? 'bg-[#FC1212] text-white border-[#FC1212] font-black shadow-lg shadow-red-600/20'
                              : 'bg-black/60 text-gray-300 border-white/10 hover:border-white/25'
                          }`}
                        >
                          <div className="text-xs font-black">B. Nilai Berdasarkan Jumlah Jawaban Benar</div>
                          <div className="text-[11px] opacity-80 mt-1 leading-relaxed">
                            Peserta memperoleh sebagian poin sesuai opsi benar yang dipilih. Poin untuk masing-masing opsi benar dapat Anda atur sendiri di tahap Soal.
                          </div>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Batas Waktu per Soal */}
                  <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={hasGlobalTimer}
                        onChange={(e) => setHasGlobalTimer(e.target.checked)}
                        className="accent-[#FC1212] w-4 h-4"
                      />
                      <span>Batasi Waktu Pengerjaan Soal (Maksimal 3 Menit / 180s)</span>
                    </label>

                    {hasGlobalTimer && (
                      <div className="flex items-center gap-1.5 font-mono">
                        <input
                          type="number"
                          min={1}
                          max={180}
                          value={globalTimeLimitSec}
                          onChange={(e) => setGlobalTimeLimitSec(Math.min(180, Math.max(1, Number(e.target.value) || 1)))}
                          className="w-16 bg-black/80 border border-white/20 rounded px-2 py-1 text-center text-[#FC1212] font-bold"
                        />
                        <span>Detik</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: BUTIR SOAL */}
          {currentStep === 'questions' && curQ && (
            <div className="space-y-5">
              {/* Stepper Indeks Soal */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-white/10 no-scrollbar">
                {questions.map((q, idx) => {
                  const isCur = activeQuestionIndex === idx;
                  const isReady = q.text.trim() && q.choices.filter((c) => c.isCorrect).length > 0;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setActiveQuestionIndex(idx)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                        isCur ? 'bg-[#FC1212] text-white shadow' : isReady ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-black/50 text-gray-400 border border-white/10'
                      }`}
                    >
                      Soal {idx + 1} {isReady ? '✓' : '•'}
                    </button>
                  );
                })}
              </div>

              {/* Kontainer Soal Aktif */}
              <div className="p-5 rounded-3xl bg-black/40 border border-white/10 space-y-5">
                <div className="flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full bg-[#FC1212] text-white text-xs font-black">
                    Soal #{activeQuestionIndex + 1} dari {totalQuestions}
                  </span>

                  {pointSystem === 'variable' && (
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-gray-300 font-bold">Bobot Soal:</span>
                      <input
                        type="number"
                        value={curQ.points}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setQuestions((prev) =>
                            prev.map((q, qi) => (qi === activeQuestionIndex ? { ...q, points: val } : q))
                          );
                        }}
                        className="w-16 bg-black/80 border border-white/20 rounded-lg px-2 py-1 text-center font-mono font-bold text-[#FC1212]"
                      />
                      <span className="font-mono">{scoreUnit === 'percent' ? '%' : 'Poin'}</span>
                    </div>
                  )}
                </div>

                {/* Teks Pertanyaan */}
                <div>
                  <label className="text-xs font-bold text-gray-300 block mb-1">Teks Pertanyaan *</label>
                  <textarea
                    rows={2}
                    value={curQ.text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQuestions((prev) =>
                        prev.map((q, qi) => (qi === activeQuestionIndex ? { ...q, text: val } : q))
                      );
                    }}
                    placeholder="Tuliskan pertanyaan di sini..."
                    className="w-full bg-black/60 border border-white/15 focus:border-[#FC1212] rounded-xl p-3 text-xs text-white outline-none resize-none"
                  />
                </div>

                {/* Lampiran Media Soal */}
                <div className="p-3 rounded-2xl bg-black/50 border border-white/5 space-y-2">
                  <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                    <span className="font-bold text-gray-300">Lampiran Media Soal:</span>
                    <div className="flex items-center gap-2">
                      {curQ.mediaUrl && curQ.mediaType && curQ.mediaType !== 'none' && (
                        <button
                          type="button"
                          onClick={() => {
                            setQuestions((prev) =>
                              prev.map((q, qi) => (qi === activeQuestionIndex ? { ...q, mediaUrl: '', mediaType: 'none' } : q))
                            );
                          }}
                          className="px-2.5 py-1 rounded-lg bg-red-950/50 hover:bg-red-900/60 text-red-300 text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Hapus</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveUploadTarget({ type: 'q' });
                          fileInputRef.current?.click();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Upload className="w-3 h-3 text-[#FC1212]" />
                        <span>Unggah Lokal (Gambar &le;2MB, Audio &le;5MB, Video &le;10MB)</span>
                      </button>
                    </div>
                  </div>
                  <input
                    type="url"
                    value={curQ.mediaUrl || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      const lower = val.toLowerCase();
                      let detectedType: 'none' | 'image' | 'audio' | 'video' = 'none';
                      if (val) {
                        if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/.test(lower)) {
                          detectedType = 'audio';
                        } else if (/\.(mp4|webm|mov|ogv|m3u8)(\?.*)?$/.test(lower)) {
                          detectedType = 'video';
                        } else {
                          detectedType = 'image';
                        }
                      }
                      setQuestions((prev) =>
                        prev.map((q, qi) => (qi === activeQuestionIndex ? { ...q, mediaUrl: val, mediaType: detectedType } : q))
                      );
                    }}
                    placeholder="Atau tautkan URL media online (https://...)"
                    className="w-full bg-black/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-[#FC1212]"
                  />
                  {curQ.mediaUrl && curQ.mediaType && curQ.mediaType !== 'none' && (
                    <div className="pt-1">
                      {curQ.mediaType === 'image' && (
                        <img src={curQ.mediaUrl} alt="Pratinjau lampiran" className="max-h-32 rounded-lg border border-white/10 object-cover" />
                      )}
                      {curQ.mediaType === 'audio' && (
                        <audio src={curQ.mediaUrl} controls className="w-full h-9" />
                      )}
                      {curQ.mediaType === 'video' && (
                        <video src={curQ.mediaUrl} controls className="max-h-40 rounded-lg border border-white/10" />
                      )}
                    </div>
                  )}
                </div>

                {/* Penjelasan Umum Jawaban Benar */}
                {correctAnswerMode === 'multiple' && (
                  <div className="p-3 rounded-2xl bg-black/50 border border-white/5 space-y-2">
                    <button
                      type="button"
                      onClick={() => {
                        setQuestions((prev) =>
                          prev.map((q, qi) =>
                            qi === activeQuestionIndex ? { ...q, showGeneralExplanation: !q.showGeneralExplanation } : q
                          )
                        );
                      }}
                      className="text-xs font-bold text-amber-300 flex items-center gap-1.5 cursor-pointer w-full text-left"
                    >
                      {curQ.showGeneralExplanation ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>Penjelasan Umum Jika Seluruh Jawaban Benar Terpilih (Opsional)</span>
                    </button>
                    {curQ.showGeneralExplanation && (
                      <textarea
                        rows={2}
                        value={curQ.generalCorrectExplanation || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setQuestions((prev) =>
                            prev.map((q, qi) =>
                              qi === activeQuestionIndex ? { ...q, generalCorrectExplanation: val } : q
                            )
                          );
                        }}
                        placeholder="Uraikan penjelasan konsep menyeluruh..."
                        className="w-full bg-black/80 border border-white/10 rounded-lg p-2 text-xs text-white outline-none"
                      />
                    )}
                  </div>
                )}

                {/* Pilihan Jawaban */}
                <div className="space-y-3 pt-1">
                  <span className="text-xs font-bold text-gray-300 block">
                    Pilihan Jawaban (Klik tombol huruf untuk menandai/batalkan kunci benar):
                  </span>

                  {curQ.choices.map((ch, cIdx) => (
                    <div
                      key={cIdx}
                      className={`p-3.5 rounded-2xl border transition-all space-y-2 ${
                        ch.isCorrect ? 'bg-emerald-950/20 border-emerald-500/60' : 'bg-black/50 border-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex flex-col gap-0.5 shrink-0">
                          <button
                            type="button"
                            disabled={cIdx === 0}
                            onClick={() => handleMoveChoice(cIdx, 'up')}
                            className="p-0.5 text-gray-500 hover:text-white disabled:opacity-20 cursor-pointer"
                          >
                            <ArrowUp className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            disabled={cIdx === curQ.choices.length - 1}
                            onClick={() => handleMoveChoice(cIdx, 'down')}
                            className="p-0.5 text-gray-500 hover:text-white disabled:opacity-20 cursor-pointer"
                          >
                            <ArrowDown className="w-3 h-3" />
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleToggleChoiceCorrect(cIdx)}
                          className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 cursor-pointer border transition-colors ${
                            ch.isCorrect ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-black/60 text-gray-400 border-white/20'
                          }`}
                        >
                          {ch.isCorrect ? <Check className="w-4 h-4 stroke-[3]" /> : String.fromCharCode(65 + cIdx)}
                        </button>

                        <input
                          type="text"
                          required
                          value={ch.text}
                          onChange={(e) => {
                            const val = e.target.value;
                            setQuestions((prev) =>
                              prev.map((q, qi) =>
                                qi === activeQuestionIndex
                                  ? {
                                      ...q,
                                      choices: q.choices.map((c, ci) => (ci === cIdx ? { ...c, text: val } : c)),
                                    }
                                  : q
                              )
                            );
                          }}
                          placeholder={`Pilihan ${String.fromCharCode(65 + cIdx)}...`}
                          className="flex-1 bg-black/80 border border-white/15 focus:border-[#FC1212] rounded-xl px-3 py-2 text-xs text-white outline-none"
                        />

                        {correctAnswerMode === 'multiple' && ch.isCorrect && multiEvaluationMode === 'partial' && (
                          <div className="flex items-center gap-1 text-xs shrink-0">
                            <span className="text-emerald-400 font-bold">Poin:</span>
                            <input
                              type="number"
                              min={0}
                              max={curQ.points}
                              value={ch.pointsAllocated}
                              onChange={(e) => handleUpdateChoicePoint(cIdx, Number(e.target.value) || 0)}
                              className="w-14 bg-black/90 border border-emerald-500/50 rounded-lg px-1.5 py-1 text-xs font-mono font-bold text-emerald-300 text-center"
                            />
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setQuestions((prev) =>
                              prev.map((q, qi) =>
                                qi === activeQuestionIndex
                                  ? {
                                      ...q,
                                      choices: q.choices.map((c, ci) =>
                                        ci === cIdx ? { ...c, showExplanation: !c.showExplanation } : c
                                      ),
                                    }
                                  : q
                              )
                            );
                          }}
                          className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                            ch.showExplanation ? 'bg-[#FC1212] text-white border-[#FC1212]' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'
                          }`}
                          title="Tampilkan / Sembunyikan Penjelasan Opsi"
                        >
                          <HelpCircle className="w-4 h-4" />
                        </button>
                      </div>

                      {ch.showExplanation && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1">
                          <input
                            type="text"
                            placeholder="Penjelasan jika opsi ini benar..."
                            value={ch.explanationCorrect || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setQuestions((prev) =>
                                prev.map((q, qi) =>
                                  qi === activeQuestionIndex
                                    ? {
                                        ...q,
                                        choices: q.choices.map((c, ci) => (ci === cIdx ? { ...c, explanationCorrect: val } : c)),
                                      }
                                    : q
                                )
                              );
                            }}
                            className="bg-black/60 border border-white/10 rounded-lg px-2.5 py-1 text-gray-300 outline-none focus:border-emerald-500"
                          />
                          <input
                            type="text"
                            placeholder="Penjelasan jika opsi ini salah..."
                            value={ch.explanationWrong || ''}
                            onChange={(e) => {
                              const val = e.target.value;
                              setQuestions((prev) =>
                                prev.map((q, qi) =>
                                  qi === activeQuestionIndex
                                    ? {
                                        ...q,
                                        choices: q.choices.map((c, ci) => (ci === cIdx ? { ...c, explanationWrong: val } : c)),
                                      }
                                    : q
                                )
                              );
                            }}
                            className="bg-black/60 border border-white/10 rounded-lg px-2.5 py-1 text-gray-300 outline-none focus:border-red-500"
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: REVIEW */}
          {currentStep === 'review' && (
            <div className="space-y-6">
              <div>
                <span className="text-xs font-mono font-bold text-emerald-400 uppercase tracking-wider block mb-1">Langkah 6 dari 6</span>
                <h4 className="text-xl font-black text-white">Review Kuis Sebelum Disimpan</h4>
              </div>

              <div className="p-5 rounded-2xl bg-black/40 border border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-gray-400 block font-mono text-[10px]">TEMA:</span>
                  <span className="font-black text-[#FC1212] text-sm">{selectedThemeObj.name}</span>
                </div>
                <div>
                  <span className="text-gray-400 block font-mono text-[10px]">TOPIK:</span>
                  <span className="font-bold text-white text-sm">{topicName}</span>
                </div>
                <div>
                  <span className="text-gray-400 block font-mono text-[10px]">JUDUL KUIS:</span>
                  <span className="font-bold text-white text-sm">{quizTitle}</span>
                </div>
                {difficulty !== 'Tidak dispesifikasikan' && (
                  <div>
                    <span className="text-gray-400 block font-mono text-[10px]">KESULITAN:</span>
                    <span className="font-bold text-white text-sm">{difficulty}</span>
                  </div>
                )}
                <div>
                  <span className="text-gray-400 block font-mono text-[10px]">TOTAL SOAL:</span>
                  <span className="font-bold text-white">{questions.length} Butir</span>
                </div>
                <div>
                  <span className="text-gray-400 block font-mono text-[10px]">SATUAN SKOR:</span>
                  <span className="font-bold text-white">{scoreUnit === 'percent' ? 'Persentase' : 'Poin'}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Navigasi Bawah */}
        <div className="p-4 sm:p-5 border-t border-white/10 bg-black/60 flex items-center justify-between">
          <div>
            {currentStep !== 'theme' && (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  if (currentStep === 'topic') setCurrentStep('theme');
                  else if (currentStep === 'info') setCurrentStep('topic');
                  else if (currentStep === 'settings') setCurrentStep('info');
                  else if (currentStep === 'questions') {
                    if (activeQuestionIndex > 0) setActiveQuestionIndex((prev) => prev - 1);
                    else setCurrentStep('settings');
                  } else if (currentStep === 'review') setCurrentStep('questions');
                }}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Sebelumnya</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl text-gray-400 hover:text-white text-xs font-bold cursor-pointer">
              Batal
            </button>

            {currentStep === 'theme' && (
              <button
                type="button"
                onClick={() => setCurrentStep('topic')}
                className="px-5 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>Lanjut ke Topik</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 'topic' && (
              <button
                type="button"
                onClick={() => {
                  if (!topicName.trim()) {
                    setErrorMsg('Nama topik wajib diisi.');
                    return;
                  }
                  setErrorMsg(null);
                  setCurrentStep('info');
                }}
                className="px-5 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>Lanjut ke Info Kuis</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 'info' && (
              <button
                type="button"
                onClick={() => {
                  if (!quizTitle.trim()) {
                    setErrorMsg('Judul kuis wajib diisi.');
                    return;
                  }
                  setErrorMsg(null);
                  setCurrentStep('settings');
                }}
                className="px-5 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>Lanjut ke Pengaturan Kuis</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 'settings' && (
              <button
                type="button"
                onClick={handleApplySettingsAndProceed}
                className="px-5 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>Terapkan &amp; Mulai Buat Soal</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 'questions' && (
              <button
                type="button"
                onClick={handleProceedQuestionStep}
                className="px-5 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-red-600/30"
              >
                <span>{activeQuestionIndex < totalQuestions - 1 ? 'Soal Selanjutnya' : 'Lanjut ke Review & Simpan'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}

            {currentStep === 'review' && (
              <button
                type="button"
                onClick={handleSaveQuiz}
                className="px-6 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/20"
              >
                <Save className="w-4 h-4" />
                <span>Simpan Kuis ke Koleksi</span>
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};