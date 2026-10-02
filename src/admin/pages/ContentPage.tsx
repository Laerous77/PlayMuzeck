import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Save,
  Trash2,
  Upload,
  Download,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Check,
  AlertCircle,
  HelpCircle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { adminFetch } from '../adminApi';
import { useAdminRole } from '../useAdminRole';
import { Deck, Topic, QuizQuestion } from '../../types';
import { BUILTIN_DECKS } from '../../data/quiz';
import { findDuplicateQuestions } from '../../services/quizJsonStore';

/* -------------------------------------------------------------------------- */
/*  Konstanta & tipe (diserap dari QuizEditor)                                 */
/* -------------------------------------------------------------------------- */

const THEMES = [
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

const DIFFICULTIES: Deck['difficulty'][] = ['Mudah', 'Biasa', 'Sedang', 'Sulit', 'Ekstrem', 'Tidak dispesifikasikan'];

type WizardStep = 'theme' | 'info' | 'settings' | 'questions' | 'review';
type MediaKind = 'none' | 'image' | 'audio' | 'video';
interface DeckSettings {
  scoreUnit: 'point' | 'percent';
  roundScores: boolean;
  pointSystem: 'equal' | 'variable';
  equalScorePerQuestion: number;
  correctAnswerMode: 'single' | 'multiple';
  multiEvaluationMode: 'all_or_nothing' | 'partial';
  enablePenaltyMinus: boolean;
  penaltyPercentage: number;
  shuffleChoices: boolean;
  hasGlobalTimer: boolean;
  globalTimeLimitSec: number;
}

/** Deck + pengaturan penilaian (kolom `settings` JSONB di tabel decks). */
type DeckWithSettings = Partial<Deck> & { settings?: Partial<DeckSettings> };

/** Field tambahan per soal; tersimpan di dalam kolom JSONB `questions`. */
type QuestionExtras = {
  timeLimitSec?: number;
  points?: number;
  correctIndexes?: number[];
  choicePoints?: number[];
  optionExplanations?: { correct?: string; wrong?: string }[];
  generalExplanation?: string;
};
type QuestionWithTimer = QuizQuestion & QuestionExtras;

interface QuestionChoice {
  text: string;
  isCorrect: boolean;
  pointsAllocated: number;
  explanationCorrect?: string;
  explanationWrong?: string;
  showExplanation?: boolean;
}

interface DetailedQuestion {
  id: string;
  text: string;
  mediaType: MediaKind;
  mediaUrl: string;
  mediaCredit: string;
  mediaSourceUrl: string;
  category?: string;
  points: number;
  timeLimitSec: number;
  generalCorrectExplanation?: string;
  showGeneralExplanation?: boolean;
  choices: QuestionChoice[];
}

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'theme', label: '1. Tema' },
  { id: 'info', label: '2. Info Kuis' },
  { id: 'settings', label: '3. Pengaturan' },
  { id: 'questions', label: '4. Butir Soal' },
  { id: 'review', label: '5. Review' },
];

const inputCls = 'mt-1 w-full rounded-lg bg-black/40 border border-white/10 focus:border-accent outline-none px-3 py-2 text-sm text-white';
const chipCls = (active: boolean) =>
  `px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
    active ? 'bg-accent text-on-accent border-accent' : 'bg-black/40 text-gray-400 border-white/10 hover:text-white'
  }`;

const baseMaxQuestions = (d: Deck['difficulty']) => (d === 'Mudah' ? 25 : d === 'Biasa' ? 50 : 100);

const newQuestionId = (i: number) => `q-${Date.now()}-${i}`;

/** Tebak tipe media dari ekstensi URL (sama seperti QuizEditor). */
const detectMediaType = (url: string): MediaKind => {
  if (!url) return 'none';
  const lower = url.toLowerCase();
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(\?.*)?$/.test(lower)) return 'audio';
  if (/\.(mp4|webm|mov|ogv|m3u8)(\?.*)?$/.test(lower)) return 'video';
  return 'image';
};

/** Bikin slug id yang rapi dari judul, dipakai untuk nama file & id deck saat ekspor. */
const slugify = (text: string): string =>
  text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'deck';

/**
 * Ekspor deck menjadi berkas JSON dengan format yang SAMA dengan deck bawaan
 * (mis. deck-builtin-olahraga.json). Taruh di src/data/quiz/decks/ lalu daftarkan
 * di src/data/quiz/index.ts (EXTRA_BUILTIN_DECKS/BUILTIN_DECKS).
 */
const downloadDeckAsJson = (deck: DeckWithSettings, topics: Topic[]) => {
  const questions = (deck.questions || []).map((q) => {
    const src = q as QuestionWithTimer;
    const cleaned: QuestionWithTimer = {
      id: src.id,
      question: src.question,
      options: src.options,
      correctIndex: src.correctIndex,
      explanation: src.explanation,
      category: src.category,
    };
    if (src.timeLimitSec && src.timeLimitSec > 0) cleaned.timeLimitSec = src.timeLimitSec;
    if (src.points !== undefined) cleaned.points = src.points;
    if (src.correctIndexes?.length) cleaned.correctIndexes = src.correctIndexes;
    if (src.choicePoints?.length) cleaned.choicePoints = src.choicePoints;
    if (src.optionExplanations?.some((e) => e.correct || e.wrong)) cleaned.optionExplanations = src.optionExplanations;
    if (src.generalExplanation) cleaned.generalExplanation = src.generalExplanation;
    // Field media hanya disertakan kalau diisi, supaya JSON tetap bersih.
    if (src.mediaType && src.mediaUrl) {
      cleaned.mediaType = src.mediaType;
      cleaned.mediaUrl = src.mediaUrl;
      if (src.mediaCredit) cleaned.mediaCredit = src.mediaCredit;
      if (src.mediaSourceUrl) cleaned.mediaSourceUrl = src.mediaSourceUrl;
    }
    return cleaned;
  });

  const topic = topics.find((t) => t.id === deck.topicId);
  const idSlug = deck.id || `deck-builtin-${slugify(deck.title || 'baru')}`;

  const exportObj = {
    id: idSlug,
    topicId: deck.topicId || '',
    title: deck.title || '',
    description: deck.description || '',
    cardCount: questions.length,
    difficulty: deck.difficulty || 'Sedang',
    isFree: Boolean(deck.isFree),
    price: Number(deck.price || 0),
    badge: deck.badge || topic?.badge || '',
    ...(deck.settings ? { settings: deck.settings } : {}),
    questions,
  };

  const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${idSlug}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

/** Ubah Deck dari server menjadi state awal wizard. */
const deriveInitial = (deck: DeckWithSettings, topics: Topic[]) => {
  const foundTopic = topics.find((t) => t.id === deck.topicId);
  const badge = (foundTopic?.badge || deck.badge || '').toLowerCase();
  const themeId = THEMES.find((th) => th.name.toLowerCase() === badge)?.id || 'lainnya';

  const questions: DetailedQuestion[] = (deck.questions || []).map((raw, idx) => {
    const q = raw as QuestionWithTimer;
    const correctSet = new Set(q.correctIndexes?.length ? q.correctIndexes : [q.correctIndex]);
    const points = q.points ?? 10;
    const generalExplanation = q.generalExplanation || '';
    return {
      id: q.id || newQuestionId(idx),
      text: q.question || '',
      mediaType: q.mediaType || 'none',
      mediaUrl: q.mediaUrl || '',
      mediaCredit: q.mediaCredit || '',
      mediaSourceUrl: q.mediaSourceUrl || '',
      category: q.category,
      points,
      timeLimitSec: Number(q.timeLimitSec) || 0,
      generalCorrectExplanation: generalExplanation,
      showGeneralExplanation: Boolean(generalExplanation),
      choices: (q.options || []).map((opt, oi) => {
        const explanationCorrect = q.optionExplanations?.[oi]?.correct ?? (oi === q.correctIndex ? q.explanation || '' : '');
        const explanationWrong = q.optionExplanations?.[oi]?.wrong ?? '';
        return {
          text: opt,
          isCorrect: correctSet.has(oi),
          pointsAllocated: q.choicePoints?.[oi] ?? (correctSet.has(oi) ? points : 0),
          explanationCorrect,
          explanationWrong,
          showExplanation: Boolean(explanationCorrect || explanationWrong),
        };
      }),
    };
  });

  const maxOptions = questions.reduce((m, q) => Math.max(m, q.choices.length), 0);
  const firstTimer = questions[0]?.timeLimitSec || 0;
  const sharedTimer = firstTimer > 0 && questions.every((q) => q.timeLimitSec === firstTimer);

  const saved = deck.settings || {};
  const anyMultiple = questions.some((q) => q.choices.filter((c) => c.isCorrect).length > 1);
  const settings: DeckSettings = {
    scoreUnit: saved.scoreUnit ?? 'point',
    roundScores: saved.roundScores ?? true,
    pointSystem: saved.pointSystem ?? 'equal',
    equalScorePerQuestion: saved.equalScorePerQuestion ?? 10,
    correctAnswerMode: saved.correctAnswerMode ?? (anyMultiple ? 'multiple' : 'single'),
    multiEvaluationMode: saved.multiEvaluationMode ?? 'partial',
    enablePenaltyMinus: saved.enablePenaltyMinus ?? false,
    penaltyPercentage: saved.penaltyPercentage ?? 25,
    shuffleChoices: saved.shuffleChoices ?? false,
    hasGlobalTimer: saved.hasGlobalTimer ?? sharedTimer,
    globalTimeLimitSec: saved.globalTimeLimitSec ?? (sharedTimer ? firstTimer : 60),
  };

  return {
    themeId,
    topicId: deck.topicId || topics[0]?.id || '',
    questions,
    totalQuestions: questions.length || 3,
    choicesPerQuestion: maxOptions ? Math.min(10, Math.max(2, maxOptions)) : 4,
    settings,
  };
};

/* -------------------------------------------------------------------------- */
/*  Wizard editor deck                                                         */
/* -------------------------------------------------------------------------- */

interface DeckWizardProps {
  /** true = deck milik admin lain / bawaan / pengguna: hanya bisa dilihat & diekspor. */
  readOnly?: boolean;
  deck: DeckWithSettings;
  topics: Topic[];
  allDecks: Deck[];
  onSave: (deck: DeckWithSettings) => Promise<Deck | null>;
  onDelete?: () => Promise<void>;
  onStatus: (msg: string) => void;
}

const DeckWizard: React.FC<DeckWizardProps> = ({ deck, topics, allDecks, onSave, onDelete, onStatus, readOnly = false }) => {
  const initial = useMemo(() => deriveInitial(deck, topics), []); // eslint-disable-line react-hooks/exhaustive-deps
  const legacyQuestionCount = useRef(initial.questions.length);
  const legacyChoiceCount = useRef(initial.questions.length ? initial.choicesPerQuestion : 0);

  const [step, setStep] = useState<WizardStep>(deck.id ? 'info' : 'theme');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Tema & topik
  const [themeId, setThemeId] = useState(initial.themeId);
  const [themeTouched, setThemeTouched] = useState(!deck.id);
  const topicId = initial.topicId; // topik tidak lagi dikelola admin; deck lama mempertahankan topicId-nya

  // Info kuis
  const [quizTitle, setQuizTitle] = useState(deck.title || '');
  const [quizDesc, setQuizDesc] = useState(deck.description || '');
  const [difficulty, setDifficulty] = useState<Deck['difficulty']>(deck.difficulty || 'Sedang');
  const [isFree, setIsFree] = useState(Boolean(deck.isFree));
  const [price, setPrice] = useState(Number(deck.price ?? (deck.id ? 0 : 15000)));
  const [showDifficultyHelp, setShowDifficultyHelp] = useState(false);

  // Pengaturan
  const [totalQuestions, setTotalQuestions] = useState(initial.totalQuestions);
  const [choicesPerQuestion, setChoicesPerQuestion] = useState(initial.choicesPerQuestion);
  const [scoreUnit, setScoreUnit] = useState<'point' | 'percent'>(initial.settings.scoreUnit);
  const [roundScores, setRoundScores] = useState(initial.settings.roundScores);
  const [pointSystem, setPointSystem] = useState<'equal' | 'variable'>(initial.settings.pointSystem);
  const [equalScorePerQuestion, setEqualScorePerQuestion] = useState(initial.settings.equalScorePerQuestion);
  const [correctAnswerMode, setCorrectAnswerMode] = useState<'single' | 'multiple'>(initial.settings.correctAnswerMode);
  const [multiEvaluationMode, setMultiEvaluationMode] = useState<'all_or_nothing' | 'partial'>(initial.settings.multiEvaluationMode);
  const [enablePenaltyMinus, setEnablePenaltyMinus] = useState(initial.settings.enablePenaltyMinus);
  const [penaltyPercentage, setPenaltyPercentage] = useState(initial.settings.penaltyPercentage);
  const [shuffleChoices, setShuffleChoices] = useState(initial.settings.shuffleChoices);
  const [hasGlobalTimer, setHasGlobalTimer] = useState(initial.settings.hasGlobalTimer);
  const [globalTimeLimitSec, setGlobalTimeLimitSec] = useState(initial.settings.globalTimeLimitSec);

  // Soal
  const [questions, setQuestions] = useState<DetailedQuestion[]>(initial.questions);
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Batas jumlah soal / opsi mengikuti tingkat kesulitan, tapi deck lama yang sudah
  // melewati batas tidak dikunci keluar dari editor.
  const maxQuestions = Math.max(baseMaxQuestions(difficulty), legacyQuestionCount.current);
  const maxChoices = difficulty === 'Mudah' ? Math.max(5, legacyChoiceCount.current) : 10;
  const maxAllowedPenalty = difficulty === 'Biasa' ? 50 : 100;

  // Aturan tingkat kesulitan
  useEffect(() => {
    if (difficulty === 'Mudah') {
      setTotalQuestions((n) => Math.min(n, maxQuestions));
      setChoicesPerQuestion((n) => Math.min(n, maxChoices));
      setPointSystem('equal');
      setEnablePenaltyMinus(false);
      setShuffleChoices(false);
      setMultiEvaluationMode('partial');
    } else if (difficulty === 'Biasa') {
      setTotalQuestions((n) => Math.min(n, maxQuestions));
      setPenaltyPercentage((p) => Math.min(p, 50));
      setShuffleChoices(false);
    } else if (difficulty === 'Sulit') {
      setTotalQuestions((n) => Math.min(n, maxQuestions));
    } else if (difficulty === 'Ekstrem') {
      setTotalQuestions((n) => Math.min(n, maxQuestions));
      setEnablePenaltyMinus(true);
      setPenaltyPercentage(100);
      setShuffleChoices(true);
      setMultiEvaluationMode('all_or_nothing');
    }
  }, [difficulty]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (choicesPerQuestion === 2 && correctAnswerMode === 'multiple') setCorrectAnswerMode('single');
  }, [choicesPerQuestion, correctAnswerMode]);

  const theme = THEMES.find((t) => t.id === themeId) || THEMES[THEMES.length - 1];
  const curQ = questions[activeIdx];
  const calculatedPenaltyVal = roundScores
    ? Math.round(equalScorePerQuestion * (penaltyPercentage / 100))
    : Number((equalScorePerQuestion * (penaltyPercentage / 100)).toFixed(1));

  /* ------------------------------ helper state ----------------------------- */

  const updateActiveQ = (fn: (q: DetailedQuestion) => DetailedQuestion) =>
    setQuestions((prev) => prev.map((q, i) => (i === activeIdx ? fn(q) : q)));

  const updateChoice = (cIdx: number, patch: Partial<QuestionChoice>) =>
    updateActiveQ((q) => ({ ...q, choices: q.choices.map((c, ci) => (ci === cIdx ? { ...c, ...patch } : c)) }));

  /* ------------------------------ navigasi step ---------------------------- */

  const applySettings = (target: WizardStep = 'questions') => {
    setErrorMsg(null);
    if (totalQuestions < 1 || totalQuestions > maxQuestions) {
      setErrorMsg(`Jumlah butir soal adalah antara 1 hingga ${maxQuestions}.`);
      return;
    }

    // Jangan diam-diam membuang soal/opsi yang sudah terisi.
    const dropsQuestions = questions.slice(totalQuestions).some((q) => q.text.trim() || q.choices.some((c) => c.text.trim()));
    const dropsChoices = questions.some((q) => q.choices.slice(choicesPerQuestion).some((c) => c.text.trim()));
    if ((dropsQuestions || dropsChoices) && !window.confirm('Pengaturan ini akan membuang soal atau opsi yang sudah terisi. Lanjutkan?')) {
      return;
    }

    const result: DetailedQuestion[] = [];
    for (let i = 0; i < totalQuestions; i++) {
      const existing = questions[i];
      const points = pointSystem === 'equal' ? equalScorePerQuestion : existing?.points || 10;
      const choices: QuestionChoice[] = [];
      for (let c = 0; c < choicesPerQuestion; c++) {
        const old = existing?.choices?.[c];
        choices.push({
          text: old?.text || '',
          isCorrect: old ? old.isCorrect : correctAnswerMode === 'single' && c === 0,
          pointsAllocated: old?.pointsAllocated || 0,
          explanationCorrect: old?.explanationCorrect || '',
          explanationWrong: old?.explanationWrong || '',
          showExplanation: old?.showExplanation ?? false,
        });
      }
      const correct = choices.filter((c) => c.isCorrect);
      if (correct.length === 1) correct[0].pointsAllocated = points;

      result.push({
        id: existing?.id || newQuestionId(i),
        text: existing?.text || '',
        mediaType: existing?.mediaType || 'none',
        mediaUrl: existing?.mediaUrl || '',
        mediaCredit: existing?.mediaCredit || '',
        mediaSourceUrl: existing?.mediaSourceUrl || '',
        category: existing?.category,
        points,
        timeLimitSec: hasGlobalTimer ? globalTimeLimitSec : existing?.timeLimitSec || 0,
        generalCorrectExplanation: existing?.generalCorrectExplanation || '',
        showGeneralExplanation: false,
        choices,
      });
    }
    setQuestions(result);
    setActiveIdx((i) => Math.min(i, result.length - 1));
    setStep(target);
  };

  const goToStep = (target: WizardStep) => {
    setErrorMsg(null);
    // Setiap keluar dari "Pengaturan" menuju soal/review, pengaturan diterapkan ulang
    // supaya jumlah opsi jawaban selalu sinkron.
    if ((target === 'questions' || target === 'review') && (questions.length === 0 || step === 'settings')) {
      applySettings(target);
      return;
    }
    setStep(target);
  };

  const validateQuestion = (q: DetailedQuestion, idx: number): string | null => {
    if (!q.text.trim()) return `Soal nomor ${idx + 1} belum memiliki teks pertanyaan.`;
    if (q.choices.some((c) => !c.text.trim())) return `Soal nomor ${idx + 1}: semua ${q.choices.length} pilihan jawaban wajib diisi.`;
    if (!q.choices.some((c) => c.isCorrect)) return `Soal nomor ${idx + 1}: wajib menentukan minimal 1 jawaban benar.`;
    return null;
  };

  const validateAll = (): string | null => {
    if (!quizTitle.trim()) return 'Judul kuis wajib diisi.';
    if (questions.length === 0) return 'Belum ada soal. Terapkan pengaturan dulu di langkah 4.';
    for (let i = 0; i < questions.length; i++) {
      const err = validateQuestion(questions[i], i);
      if (err) return err;
    }
    return null;
  };

  const handleNextQuestion = () => {
    setErrorMsg(null);
    if (!curQ) return;
    const err = validateQuestion(curQ, activeIdx);
    if (err) {
      setErrorMsg(err);
      return;
    }
    if (activeIdx < questions.length - 1) setActiveIdx((i) => i + 1);
    else setStep('review');
  };

  const handlePrev = () => {
    setErrorMsg(null);
    if (step === 'info') setStep('theme');
    else if (step === 'settings') setStep('info');
    else if (step === 'questions') {
      if (activeIdx > 0) setActiveIdx((i) => i - 1);
      else setStep('settings');
    } else if (step === 'review') setStep('questions');
  };

  /* ------------------------------ pilihan jawaban -------------------------- */

  const toggleChoiceCorrect = (choiceIdx: number) => {
    if (!curQ) return;
    updateActiveQ((q) => {
      const newChoices = q.choices.map((c) => ({ ...c }));

      if (correctAnswerMode === 'single') {
        const alreadySole = newChoices[choiceIdx].isCorrect && newChoices.filter((c) => c.isCorrect).length === 1;
        newChoices.forEach((c, idx) => {
          const should = alreadySole ? false : idx === choiceIdx;
          c.isCorrect = should;
          c.pointsAllocated = should ? q.points : 0;
        });
        return { ...q, choices: newChoices };
      }

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
          const split = roundScores ? Math.round(q.points / correctOnes.length) : Number((q.points / correctOnes.length).toFixed(1));
          let sum = 0;
          correctOnes.forEach((c, i) => {
            if (i === correctOnes.length - 1) c.pointsAllocated = Math.max(0, q.points - sum);
            else {
              c.pointsAllocated = split;
              sum += split;
            }
          });
        }
      }
      return { ...q, choices: newChoices };
    });
  };

  const updateChoicePoint = (choiceIndex: number, value: number) => {
    if (!curQ) return;
    updateActiveQ((q) => {
      const correctIdxs = q.choices.map((c, i) => (c.isCorrect ? i : -1)).filter((i) => i !== -1);
      if (correctIdxs.length <= 1) {
        return { ...q, choices: q.choices.map((c, ci) => (ci === choiceIndex ? { ...c, pointsAllocated: q.points } : c)) };
      }
      const last = correctIdxs[correctIdxs.length - 1];
      const chs = q.choices.map((c) => ({ ...c }));
      const sumOthers = correctIdxs
        .filter((i) => i !== choiceIndex && i !== last)
        .reduce((acc, i) => acc + (chs[i].pointsAllocated || 0), 0);

      if (choiceIndex !== last) {
        const clamped = Math.max(0, Math.min(Math.max(0, q.points - sumOthers), value));
        chs[choiceIndex].pointsAllocated = clamped;
        chs[last].pointsAllocated = Math.max(0, q.points - (sumOthers + clamped));
      } else {
        const sumBeforeLast = correctIdxs.filter((i) => i !== last).reduce((acc, i) => acc + (chs[i].pointsAllocated || 0), 0);
        chs[last].pointsAllocated = Math.max(0, Math.min(Math.max(0, q.points - sumBeforeLast), value));
      }
      return { ...q, choices: chs };
    });
  };

  const moveChoice = (cIdx: number, dir: 'up' | 'down') => {
    if (!curQ) return;
    const target = dir === 'up' ? cIdx - 1 : cIdx + 1;
    if (target < 0 || target >= curQ.choices.length) return;
    updateActiveQ((q) => {
      const chs = [...q.choices];
      [chs[cIdx], chs[target]] = [chs[target], chs[cIdx]];
      return { ...q, choices: chs };
    });
  };

  /* ------------------------------ media lokal ------------------------------ */

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !curQ) return;

    let maxBytes = 2 * 1024 * 1024;
    let kind: MediaKind = 'image';
    if (file.type.startsWith('audio/')) {
      maxBytes = 5 * 1024 * 1024;
      kind = 'audio';
    } else if (file.type.startsWith('video/')) {
      maxBytes = 10 * 1024 * 1024;
      kind = 'video';
    }
    if (file.size > maxBytes) {
      alert(`Ukuran berkas melebihi batas maksimal (${Math.round(maxBytes / (1024 * 1024))}MB).`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        const dataUrl = reader.result;
        updateActiveQ((q) => ({ ...q, mediaType: kind, mediaUrl: dataUrl }));
      }
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* ------------------------------ susun payload ---------------------------- */

  const buildDraft = (): { deck: DeckWithSettings } => {
    const existingTopic = topics.find((t) => t.id === topicId);
    const topicTitle = existingTopic?.title || '';
    const badge = themeTouched || !deck.badge ? theme.name : deck.badge;

    const formatted: QuizQuestion[] = questions.map((q) => {
      const correctIdx = q.choices.findIndex((c) => c.isCorrect);
      const out: QuestionWithTimer = {
        id: q.id,
        question: q.text.trim(),
        options: q.choices.map((c) => c.text.trim()),
        correctIndex: correctIdx >= 0 ? correctIdx : 0,
        explanation: q.choices.find((c) => c.isCorrect)?.explanationCorrect || q.generalCorrectExplanation || '',
        category: q.category && q.category !== 'Umum' ? q.category : topicTitle || 'Umum',
      };
      if (q.timeLimitSec > 0) out.timeLimitSec = q.timeLimitSec;
      out.points = q.points;
      const correctIdxs = q.choices.map((c, i) => (c.isCorrect ? i : -1)).filter((i) => i >= 0);
      if (correctIdxs.length > 1) {
        out.correctIndexes = correctIdxs;
        out.choicePoints = q.choices.map((c) => c.pointsAllocated || 0);
      }
      const optionExplanations = q.choices.map((c) => ({ correct: c.explanationCorrect || '', wrong: c.explanationWrong || '' }));
      if (optionExplanations.some((e) => e.correct || e.wrong)) out.optionExplanations = optionExplanations;
      if (q.generalCorrectExplanation) out.generalExplanation = q.generalCorrectExplanation;
      if (q.mediaType !== 'none' && q.mediaUrl) {
        out.mediaType = q.mediaType;
        out.mediaUrl = q.mediaUrl;
        if (q.mediaCredit) out.mediaCredit = q.mediaCredit;
        if (q.mediaSourceUrl) out.mediaSourceUrl = q.mediaSourceUrl;
      }
      return out;
    });

    return {
      deck: {
        ...deck,
        topicId: topicId || '',
        title: quizTitle.trim(),
        description: quizDesc.trim() || `Kuis ${quizTitle.trim()} dengan ${formatted.length} butir soal.`,
        cardCount: formatted.length,
        difficulty,
        isFree,
        price: isFree ? 0 : Number(price) || 0,
        badge,
        settings: {
          scoreUnit,
          roundScores,
          pointSystem,
          equalScorePerQuestion,
          correctAnswerMode,
          multiEvaluationMode,
          enablePenaltyMinus,
          penaltyPercentage,
          shuffleChoices,
          hasGlobalTimer,
          globalTimeLimitSec,
        },
        questions: formatted,
      },
    };
  };

  // Peringatan soal kembar dengan deck bawaan / deck lain (dihitung hanya saat Review)
  const duplicates = useMemo(() => {
    if (step !== 'review') return [];
    try {
      const draft = buildDraft().deck as Deck;
      const draftId = draft.id || '__draft__';
      const others = allDecks.filter((d) => d.id !== draft.id);
      return findDuplicateQuestions([...BUILTIN_DECKS, ...others, { ...draft, id: draftId }]).filter((d) =>
        d.where.some((w) => w.startsWith(draft.title))
      );
    } catch {
      return [];
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const err = validateAll();
    if (err) {
      setErrorMsg(err);
      return;
    }
    setErrorMsg(null);
    setSaving(true);
    try {
      const { deck: draft } = buildDraft();
      const saved = await onSave(draft);
      if (saved) {
        const dupes = duplicates.length;
        onStatus(`Deck "${saved.title}" disimpan.` + (dupes ? ` Perhatian: ${dupes} soal sama dengan soal deck lain.` : ''));
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Gagal menyimpan deck.');
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    const err = validateAll();
    if (err) {
      setErrorMsg(err);
      return;
    }
    const { deck: draft } = buildDraft();
    downloadDeckAsJson(draft, topics);
  };

  /* --------------------------------- render -------------------------------- */


  return (
    <section className="rounded-2xl bg-surface border border-white/10 p-5 space-y-4">
      <input ref={fileInputRef} type="file" accept="image/*,audio/*,video/*" className="hidden" onChange={handleFileUpload} />

      {/* Stepper */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {STEPS.map((st) => (
          <button key={st.id} type="button" onClick={() => goToStep(st.id)} className={`shrink-0 ${chipCls(step === st.id)}`}>
            {st.label}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div className="p-3 rounded-xl bg-red-950/60 border border-red-500/40 text-xs text-red-200 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {readOnly && (
        <div className="p-3 rounded-xl bg-accent/10 border border-accent/30 text-xs text-accent">
          Mode hanya-baca: kuis ini bukan buatanmu, jadi tidak bisa disimpan atau dihapus. Kamu masih bisa melihat isinya, mengekspor JSON, atau membuat kuis baru.
        </div>
      )}

      {/* STEP 1: TEMA */}
      {step === 'theme' && (
        <div className="space-y-3">
          <div>
            <h4 className="text-lg font-bold">Tentukan tema</h4>
            <p className="text-xs text-gray-400">Tema menentukan badge deck (pengelompokan di Perpustakaan Kuis).</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setThemeId(t.id);
                  setThemeTouched(true);
                }}
                className={`text-left p-4 rounded-2xl border transition-all ${
                  themeId === t.id ? 'bg-accent/15 border-accent ring-2 ring-accent/40' : 'bg-black/40 border-white/10 hover:border-white/20'
                }`}
              >
                <span className="text-2xl block mb-2">{t.icon}</span>
                <span className="text-sm font-bold block">{t.name}</span>
                <span className="text-[10px] text-gray-400 mt-1 line-clamp-2 block">{t.desc}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* STEP 3: INFO */}
      {step === 'info' && (
        <div className="space-y-3 max-w-2xl">
          <div>
            <h4 className="text-lg font-bold">Informasi kuis</h4>
            <p className="text-xs text-gray-400">Judul, deskripsi, tingkat kesulitan, dan harga kuis.</p>
          </div>
          <label className="text-xs text-gray-400 block">
            Judul deck *
            <input className={inputCls} value={quizTitle} onChange={(e) => setQuizTitle(e.target.value)} />
          </label>
          <label className="text-xs text-gray-400 block">
            Deskripsi
            <textarea rows={3} className={inputCls} value={quizDesc} onChange={(e) => setQuizDesc(e.target.value)} />
          </label>

          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className="text-xs text-gray-400">Tingkat kesulitan</span>
              <button type="button" onClick={() => setShowDifficultyHelp((v) => !v)} className="text-gray-400 hover:text-accent" title="Perbedaan tiap tingkat kesulitan">
                <HelpCircle className="w-3.5 h-3.5" />
              </button>
            </div>
            {showDifficultyHelp && (
              <div className="mb-3 p-3.5 rounded-xl bg-black/60 border border-accent/40 text-[11px] text-gray-300 space-y-1.5 leading-relaxed">
                <p><strong className="text-white">Mudah:</strong> maks 25 soal, maks 5 opsi, poin sama rata, tanpa nilai minus.</p>
                <p><strong className="text-white">Biasa:</strong> maks 50 soal, poin berbeda boleh, nilai minus 0–50%.</p>
                <p><strong className="text-white">Sedang:</strong> maks 100 soal, tanpa aturan khusus.</p>
                <p><strong className="text-white">Sulit:</strong> maks 100 soal, nilai minus 0–100%, acak opsi boleh diaktifkan.</p>
                <p><strong className="text-white">Ekstrem:</strong> maks 100 soal, acak opsi dan nilai minus 100% wajib aktif.</p>
                <p><strong className="text-white">Tidak dispesifikasikan:</strong> semua fitur bebas dipakai.</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {DIFFICULTIES.map((d) => (
                <button key={d} type="button" onClick={() => setDifficulty(d)} className={chipCls(difficulty === d)}>
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="text-xs text-gray-400">
              Harga
              <input type="number" disabled={isFree} className={`${inputCls} disabled:opacity-40`} value={isFree ? 0 : price} onChange={(e) => setPrice(Number(e.target.value))} />
            </label>
            <label className="text-xs text-gray-400 flex items-center gap-2 mt-6">
              <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} className="accent-accent" />
              Gratis
            </label>
          </div>
        </div>
      )}

      {/* STEP 4: PENGATURAN */}
      {step === 'settings' && (
        <div className="space-y-4 max-w-3xl">
          <div>
            <h4 className="text-lg font-bold">Pengaturan & aturan penilaian</h4>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-black/30 border border-white/10 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-300">Jumlah butir soal</span>
                <span className="text-[10px] text-accent">Maks {maxQuestions}</span>
              </div>
              <input
                type="number"
                min={1}
                max={maxQuestions}
                value={totalQuestions}
                onChange={(e) => setTotalQuestions(Number(e.target.value) || 1)}
                className={inputCls}
              />
            </div>

            <div className="p-4 rounded-2xl bg-black/30 border border-white/10 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-300">Jumlah pilihan jawaban</span>
                <span className="text-[10px] text-accent">{difficulty === 'Mudah' ? `Maks ${maxChoices} opsi` : '2 s/d 10 opsi'}</span>
              </div>
              <select value={choicesPerQuestion} onChange={(e) => setChoicesPerQuestion(Number(e.target.value))} className={inputCls}>
                {[2, 3, 4, 5, 6, 7, 8, 9, 10]
                  .filter((n) => n <= maxChoices)
                  .map((n) => (
                    <option key={n} value={n} className="bg-surface">
                      {n} pilihan (A s/d {String.fromCharCode(64 + n)})
                    </option>
                  ))}
              </select>
            </div>

            <div className="p-4 rounded-2xl bg-black/30 border border-white/10 space-y-2.5">
              <span className="text-xs font-bold text-gray-300 block">Sistem & satuan penilaian</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => setScoreUnit('point')} className={chipCls(scoreUnit === 'point')}>Poin (1–1000)</button>
                <button type="button" onClick={() => setScoreUnit('percent')} className={chipCls(scoreUnit === 'percent')}>Persentase</button>
              </div>
              {pointSystem === 'equal' && (
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="text-[11px] text-gray-300">Nilai tiap soal</span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={scoreUnit === 'percent' ? 0 : 1}
                      max={scoreUnit === 'percent' ? 100 : 1000}
                      value={equalScorePerQuestion}
                      onChange={(e) => setEqualScorePerQuestion(Number(e.target.value) || 0)}
                      className="w-20 bg-black/60 border border-white/20 rounded-lg px-2 py-1 text-center text-xs font-bold text-white outline-none focus:border-accent"
                    />
                    <span className="text-[11px] text-gray-400">{scoreUnit === 'percent' ? '%' : 'pt'}</span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between pt-1">
                <label className="text-[11px] text-gray-300 flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={roundScores} onChange={(e) => setRoundScores(e.target.checked)} className="accent-accent" />
                  Bulatkan nilai
                </label>
                <button
                  type="button"
                  disabled={difficulty === 'Mudah'}
                  onClick={() => setPointSystem(pointSystem === 'equal' ? 'variable' : 'equal')}
                  className="text-[11px] font-bold text-accent underline disabled:opacity-30"
                >
                  {pointSystem === 'equal' ? 'Ganti ke poin berbeda' : 'Ganti ke poin sama rata'}
                </button>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-black/30 border border-white/10 space-y-2.5 text-xs">
              <span className="text-xs font-bold text-gray-300 block">Penalti & tata letak opsi</span>
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-gray-300">Penalti nilai minus (salah)</span>
                <input
                  type="checkbox"
                  disabled={difficulty === 'Mudah' || difficulty === 'Ekstrem'}
                  checked={enablePenaltyMinus}
                  onChange={(e) => setEnablePenaltyMinus(e.target.checked)}
                  className="accent-accent w-4 h-4"
                />
              </label>
              {enablePenaltyMinus && (
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5 space-y-1.5">
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="text-gray-400">Besaran penalti</span>
                    <span className="font-bold text-red-400">
                      {penaltyPercentage}% (setara -{calculatedPenaltyVal} {scoreUnit === 'percent' ? '%' : 'pt'})
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={maxAllowedPenalty}
                    value={penaltyPercentage}
                    onChange={(e) => setPenaltyPercentage(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                </div>
              )}
              <label className="flex items-center justify-between cursor-pointer pt-1 border-t border-white/5">
                <span className="text-gray-300">Acak pilihan jawaban</span>
                <input
                  type="checkbox"
                  disabled={difficulty === 'Mudah' || difficulty === 'Biasa' || difficulty === 'Ekstrem'}
                  checked={shuffleChoices}
                  onChange={(e) => setShuffleChoices(e.target.checked)}
                  className="accent-accent w-4 h-4"
                />
              </label>
            </div>

            <div className="p-5 rounded-2xl bg-black/30 border border-white/10 space-y-4 sm:col-span-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-bold text-gray-300">Kriteria jawaban benar</span>
                {choicesPerQuestion === 2 && <span className="text-[10px] text-gray-400">*Jawaban ganda nonaktif karena pilihan hanya 2</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button type="button" onClick={() => setCorrectAnswerMode('single')} className={chipCls(correctAnswerMode === 'single')}>1 jawaban benar</button>
                <button
                  type="button"
                  disabled={choicesPerQuestion === 2}
                  onClick={() => setCorrectAnswerMode('multiple')}
                  className={`${chipCls(correctAnswerMode === 'multiple')} disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  &gt;1 jawaban benar
                </button>
              </div>

              {correctAnswerMode === 'multiple' && (
                <div className="pt-3 border-t border-white/10 space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-white">
                      Aturan penilaian jawaban ganda{' '}
                      <span className="text-[10px] text-accent">({multiEvaluationMode === 'all_or_nothing' ? 'harus benar semua' : 'atur poin sendiri'})</span>
                    </span>
                    {difficulty === 'Mudah' && <span className="text-[10px] text-accent">*Mudah: wajib atur poin per opsi</span>}
                    {difficulty === 'Ekstrem' && <span className="text-[10px] text-accent">*Ekstrem: wajib benar semua</span>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button
                      type="button"
                      disabled={difficulty === 'Mudah'}
                      onClick={() => setMultiEvaluationMode('all_or_nothing')}
                      className={`p-3.5 rounded-xl border text-left disabled:opacity-30 disabled:cursor-not-allowed ${
                        multiEvaluationMode === 'all_or_nothing' ? 'bg-accent text-on-accent border-accent' : 'bg-black/40 text-gray-300 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="text-xs font-black">A. Seluruh jawaban benar harus dipilih</div>
                      <div className="text-[11px] opacity-80 mt-1 leading-relaxed">Kurang atau salah pilih satu saja, nilai 0.</div>
                    </button>
                    <button
                      type="button"
                      disabled={difficulty === 'Ekstrem'}
                      onClick={() => setMultiEvaluationMode('partial')}
                      className={`p-3.5 rounded-xl border text-left disabled:opacity-30 disabled:cursor-not-allowed ${
                        multiEvaluationMode === 'partial' ? 'bg-accent text-on-accent border-accent' : 'bg-black/40 text-gray-300 border-white/10 hover:border-white/25'
                      }`}
                    >
                      <div className="text-xs font-black">B. Nilai berdasarkan jumlah jawaban benar</div>
                      <div className="text-[11px] opacity-80 mt-1 leading-relaxed">Poin tiap opsi benar diatur di langkah Butir Soal.</div>
                    </button>
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-white/10 flex items-center justify-between text-xs flex-wrap gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={hasGlobalTimer} onChange={(e) => setHasGlobalTimer(e.target.checked)} className="accent-accent w-4 h-4" />
                  <span>Batasi waktu tiap soal (maks 180 detik)</span>
                </label>
                {hasGlobalTimer && (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={globalTimeLimitSec}
                      onChange={(e) => setGlobalTimeLimitSec(Math.min(180, Math.max(1, Number(e.target.value) || 1)))}
                      className="w-16 bg-black/60 border border-white/20 rounded px-2 py-1 text-center text-accent font-bold"
                    />
                    <span>detik</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 5: SOAL */}
      {step === 'questions' && curQ && (
        <div className="space-y-4">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-2 border-b border-white/10">
            {questions.map((q, idx) => {
              const ready = q.text.trim() && q.choices.some((c) => c.isCorrect);
              return (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setActiveIdx(idx)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap border ${
                    activeIdx === idx
                      ? 'bg-accent text-on-accent border-accent'
                      : ready
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : 'bg-black/40 text-gray-400 border-white/10'
                  }`}
                >
                  Soal {idx + 1} {ready ? '✓' : '•'}
                </button>
              );
            })}
          </div>

          <div className="p-5 rounded-3xl bg-black/30 border border-white/10 space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="px-3 py-1 rounded-full bg-accent text-on-accent text-xs font-black">
                Soal #{activeIdx + 1} dari {questions.length}
              </span>
              {pointSystem === 'variable' && (
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-gray-300 font-bold">Bobot soal</span>
                  <input
                    type="number"
                    value={curQ.points}
                    onChange={(e) => updateActiveQ((q) => ({ ...q, points: Number(e.target.value) || 0 }))}
                    className="w-16 bg-black/60 border border-white/20 rounded-lg px-2 py-1 text-center font-bold text-accent"
                  />
                  <span>{scoreUnit === 'percent' ? '%' : 'poin'}</span>
                </div>
              )}
            </div>

            <label className="text-xs text-gray-400 block">
              Teks pertanyaan *
              <textarea rows={2} value={curQ.text} onChange={(e) => updateActiveQ((q) => ({ ...q, text: e.target.value }))} placeholder="Tuliskan pertanyaan di sini..." className={inputCls} />
            </label>

            {/* Media */}
            <div className="p-3 rounded-2xl bg-black/40 border border-white/5 space-y-2">
              <div className="flex items-center justify-between text-xs flex-wrap gap-2">
                <span className="font-bold text-gray-300">Lampiran media (opsional)</span>
                <div className="flex items-center gap-2">
                  {curQ.mediaUrl && (
                    <button
                      type="button"
                      onClick={() => updateActiveQ((q) => ({ ...q, mediaUrl: '', mediaType: 'none', mediaCredit: '', mediaSourceUrl: '' }))}
                      className="px-2.5 py-1 rounded-lg bg-red-950/50 hover:bg-red-900/60 text-red-300 text-[11px] font-bold flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" /> Hapus
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white text-[11px] font-bold flex items-center gap-1"
                  >
                    <Upload className="w-3 h-3 text-accent" /> Unggah lokal (gambar ≤2MB, audio ≤5MB, video ≤10MB)
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-[130px_1fr] gap-2">
                <select
                  value={curQ.mediaType}
                  onChange={(e) => updateActiveQ((q) => ({ ...q, mediaType: e.target.value as MediaKind }))}
                  className="rounded-lg bg-black/60 border border-white/10 px-2 py-1.5 text-xs text-white"
                >
                  <option value="none">Tanpa media</option>
                  <option value="image">Gambar</option>
                  <option value="audio">Audio</option>
                  <option value="video">Video</option>
                </select>
                <input
                  type="url"
                  value={curQ.mediaUrl.startsWith('data:') ? '' : curQ.mediaUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    updateActiveQ((q) => ({ ...q, mediaUrl: val, mediaType: val ? detectMediaType(val) : 'none' }));
                  }}
                  placeholder={curQ.mediaUrl.startsWith('data:') ? 'Berkas lokal terpasang' : 'Atau tautkan URL media online (https://...)'}
                  className="w-full bg-black/60 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none focus:border-accent"
                />
              </div>
              {curQ.mediaUrl && curQ.mediaType !== 'none' && (
                <div className="pt-1">
                  {curQ.mediaType === 'image' && <img src={curQ.mediaUrl} alt="Pratinjau lampiran" className="max-h-40 rounded-lg border border-white/10 object-cover" />}
                  {curQ.mediaType === 'audio' && <audio src={curQ.mediaUrl} controls className="w-full h-9" />}
                  {curQ.mediaType === 'video' && <video src={curQ.mediaUrl} controls className="max-h-52 rounded-lg border border-white/10" />}
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <label className="text-xs text-gray-400 block">
                  Kredit media
                  <input
                    value={curQ.mediaCredit}
                    placeholder="Nama file — Pembuat, Sumber (Lisensi)"
                    onChange={(e) => updateActiveQ((q) => ({ ...q, mediaCredit: e.target.value }))}
                    className="mt-1 w-full rounded-lg bg-black/60 border border-white/10 px-2 py-1.5 text-xs text-white"
                  />
                </label>
                <label className="text-xs text-gray-400 block">
                  URL sumber media
                  <input
                    value={curQ.mediaSourceUrl}
                    placeholder="https://commons.wikimedia.org/..."
                    onChange={(e) => updateActiveQ((q) => ({ ...q, mediaSourceUrl: e.target.value }))}
                    className="mt-1 w-full rounded-lg bg-black/60 border border-white/10 px-2 py-1.5 text-xs text-white"
                  />
                </label>
              </div>
            </div>

            {/* Penjelasan umum (jawaban ganda) */}
            {correctAnswerMode === 'multiple' && (
              <div className="p-3 rounded-2xl bg-black/40 border border-white/5 space-y-2">
                <button
                  type="button"
                  onClick={() => updateActiveQ((q) => ({ ...q, showGeneralExplanation: !q.showGeneralExplanation }))}
                  className="text-xs font-bold text-accent flex items-center gap-1.5 w-full text-left"
                >
                  {curQ.showGeneralExplanation ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  Penjelasan umum jika seluruh jawaban benar terpilih (opsional)
                </button>
                {curQ.showGeneralExplanation && (
                  <textarea
                    rows={2}
                    value={curQ.generalCorrectExplanation || ''}
                    onChange={(e) => updateActiveQ((q) => ({ ...q, generalCorrectExplanation: e.target.value }))}
                    placeholder="Uraikan penjelasan konsep menyeluruh..."
                    className="w-full bg-black/60 border border-white/10 rounded-lg p-2 text-xs text-white outline-none"
                  />
                )}
              </div>
            )}

            {/* Pilihan jawaban */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-gray-300 block">Pilihan jawaban (klik tombol huruf untuk menandai / membatalkan kunci benar)</span>
              {curQ.choices.map((ch, cIdx) => (
                <div key={cIdx} className={`p-3.5 rounded-2xl border space-y-2 ${ch.isCorrect ? 'bg-emerald-950/20 border-emerald-500/60' : 'bg-black/40 border-white/10'}`}>
                  <div className="flex items-center gap-3">
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button type="button" disabled={cIdx === 0} onClick={() => moveChoice(cIdx, 'up')} className="p-0.5 text-gray-500 hover:text-white disabled:opacity-20">
                        <ArrowUp className="w-3 h-3" />
                      </button>
                      <button type="button" disabled={cIdx === curQ.choices.length - 1} onClick={() => moveChoice(cIdx, 'down')} className="p-0.5 text-gray-500 hover:text-white disabled:opacity-20">
                        <ArrowDown className="w-3 h-3" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => toggleChoiceCorrect(cIdx)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 border ${
                        ch.isCorrect ? 'bg-emerald-500 text-black border-emerald-400' : 'bg-black/60 text-gray-400 border-white/20'
                      }`}
                    >
                      {ch.isCorrect ? <Check className="w-4 h-4 stroke-[3]" /> : String.fromCharCode(65 + cIdx)}
                    </button>

                    <input
                      type="text"
                      value={ch.text}
                      onChange={(e) => updateChoice(cIdx, { text: e.target.value })}
                      placeholder={`Pilihan ${String.fromCharCode(65 + cIdx)}...`}
                      className="flex-1 bg-black/60 border border-white/15 focus:border-accent rounded-xl px-3 py-2 text-xs text-white outline-none"
                    />

                    {correctAnswerMode === 'multiple' && ch.isCorrect && multiEvaluationMode === 'partial' && (
                      <div className="flex items-center gap-1 text-xs shrink-0">
                        <span className="text-emerald-400 font-bold">Poin</span>
                        <input
                          type="number"
                          min={0}
                          max={curQ.points}
                          value={ch.pointsAllocated}
                          onChange={(e) => updateChoicePoint(cIdx, Number(e.target.value) || 0)}
                          className="w-14 bg-black/80 border border-emerald-500/50 rounded-lg px-1.5 py-1 text-xs font-bold text-emerald-300 text-center"
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => updateChoice(cIdx, { showExplanation: !ch.showExplanation })}
                      className={`p-1.5 rounded-lg border ${ch.showExplanation ? 'bg-accent text-on-accent border-accent' : 'bg-white/5 border-white/10 text-gray-400 hover:text-white'}`}
                      title="Tampilkan / sembunyikan penjelasan opsi"
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
                        onChange={(e) => updateChoice(cIdx, { explanationCorrect: e.target.value })}
                        className="bg-black/60 border border-white/10 rounded-lg px-2.5 py-1 text-gray-300 outline-none focus:border-emerald-500"
                      />
                      <input
                        type="text"
                        placeholder="Penjelasan jika opsi ini salah..."
                        value={ch.explanationWrong || ''}
                        onChange={(e) => updateChoice(cIdx, { explanationWrong: e.target.value })}
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

      {step === 'questions' && !curQ && (
        <p className="text-sm text-gray-400">Belum ada soal. Buka langkah 4 (Pengaturan), lalu klik “Terapkan & mulai buat soal”.</p>
      )}

      {/* STEP 6: REVIEW */}
      {step === 'review' && (
        <div className="space-y-4">
          <h4 className="text-lg font-bold">Review sebelum disimpan</h4>
          <div className="p-5 rounded-2xl bg-black/30 border border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div><span className="text-gray-400 block text-[10px]">Tema</span><span className="font-bold text-accent text-sm">{theme.name}</span></div>
            
            <div><span className="text-gray-400 block text-[10px]">Judul kuis</span><span className="font-bold text-sm">{quizTitle || '-'}</span></div>
            <div><span className="text-gray-400 block text-[10px]">Kesulitan</span><span className="font-bold text-sm">{difficulty}</span></div>
            <div><span className="text-gray-400 block text-[10px]">Total soal</span><span className="font-bold">{questions.length} butir</span></div>
            <div><span className="text-gray-400 block text-[10px]">Satuan skor</span><span className="font-bold">{scoreUnit === 'percent' ? 'Persentase' : 'Poin'}</span></div>
            <div><span className="text-gray-400 block text-[10px]">Batas waktu</span><span className="font-bold">{hasGlobalTimer ? `${globalTimeLimitSec} detik/soal` : 'Sesuai data soal'}</span></div>
            <div><span className="text-gray-400 block text-[10px]">Harga</span><span className="font-bold">{isFree ? 'Gratis' : `Rp ${Number(price).toLocaleString('id-ID')}`}</span></div>
          </div>
          {duplicates.length > 0 && (
            <div className="p-3 rounded-xl bg-accent/10 border border-accent/40 text-xs text-accent flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{duplicates.length} soal sama persis dengan soal di deck bawaan atau deck lain. Tetap bisa disimpan, tapi cek dulu supaya tidak dobel.</span>
            </div>
          )}
        </div>
      )}

      {/* Navigasi wizard */}
      <div className="flex items-center justify-between pt-3 border-t border-white/10">
        <div>
          {step !== 'theme' && (
            <button type="button" onClick={handlePrev} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 text-xs font-bold flex items-center gap-1.5">
              <ArrowLeft className="w-3.5 h-3.5" /> Sebelumnya
            </button>
          )}
        </div>
        <div>
          {step === 'theme' && (
            <button type="button" onClick={() => setStep('info')} className="px-5 py-2 rounded-xl bg-accent text-on-accent font-black text-xs flex items-center gap-1.5">
              Lanjut ke info kuis <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 'info' && (
            <button
              type="button"
              onClick={() => {
                if (!quizTitle.trim()) {
                  setErrorMsg('Judul kuis wajib diisi.');
                  return;
                }
                setErrorMsg(null);
                setStep('settings');
              }}
              className="px-5 py-2 rounded-xl bg-accent text-on-accent font-black text-xs flex items-center gap-1.5"
            >
              Lanjut ke pengaturan <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 'settings' && (
            <button type="button" onClick={() => applySettings()} className="px-5 py-2 rounded-xl bg-accent text-on-accent font-black text-xs flex items-center gap-1.5">
              Terapkan & mulai buat soal <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
          {step === 'questions' && curQ && (
            <button type="button" onClick={handleNextQuestion} className="px-5 py-2 rounded-xl bg-accent text-on-accent font-black text-xs flex items-center gap-1.5">
              {activeIdx < questions.length - 1 ? 'Soal selanjutnya' : 'Lanjut ke review'} <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Aksi deck (selalu tersedia) */}
      <div className="flex flex-wrap gap-2 pt-1">
        {!readOnly && (
          <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 rounded-xl bg-accent text-on-accent font-bold px-4 py-2 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Menyimpan...' : 'Simpan deck'}
          </button>
        )}
        <button
          onClick={handleExport}
          title="Unduh sebagai berkas JSON bawaan (format sama seperti deck-builtin-*.json) — taruh di src/data/quiz/decks/ lalu daftarkan di index.ts"
          className="flex items-center gap-2 rounded-xl border border-accent/60 text-accent px-4 py-2"
        >
          <Download className="w-4 h-4" /> Ekspor sebagai JSON
        </button>
        {!readOnly && deck.id && onDelete && (
          <button
            onClick={async () => {
              if (!confirm('Hapus deck ini?')) return;
              await onDelete();
            }}
            className="flex items-center gap-2 rounded-xl border border-red-400/40 text-red-300 px-4 py-2"
          >
            <Trash2 className="w-4 h-4" /> Hapus
          </button>
        )}
      </div>
    </section>
  );
};

/* -------------------------------------------------------------------------- */
/*  Halaman utama                                                              */
/* -------------------------------------------------------------------------- */

/** Deck dari server + penanda asal (admin / pengguna). */
type AdminDeck = Deck & { isCustom?: boolean; ownerEmail?: string | null };

const blankDeck = (topicId = '', price = 15000): DeckWithSettings => ({
  title: '',
  topicId,
  description: '',
  difficulty: 'Sedang',
  isFree: false,
  price,
  questions: [],
});

export const ContentPage: React.FC = () => {
  const { isSuperAdmin, email: myEmail } = useAdminRole();
  const [tab, setTab] = useState<'decks' | 'import'>('decks');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [decks, setDecks] = useState<AdminDeck[]>([]);
  const [deckForm, setDeckForm] = useState<DeckWithSettings>(blankDeck('', 0));
  const [newDeckKey, setNewDeckKey] = useState(0);
  const [status, setStatus] = useState('');
  const [importText, setImportText] = useState('{\n  "topics": [],\n  "decks": []\n}');

  /** Admin biasa hanya boleh mengubah deck buatannya sendiri; Super Admin semuanya. */
  const canEditDeck = (d: AdminDeck): boolean =>
    !d.id || isSuperAdmin || (!d.isCustom && Boolean(myEmail && d.ownerEmail && d.ownerEmail.toLowerCase() === myEmail));
  const adminDecks = decks.filter((d) => !d.isCustom);
  const userDecks = decks.filter((d) => d.isCustom);
  const dbIds = new Set(decks.map((d) => d.id));
  const builtinOnly = BUILTIN_DECKS.filter((d) => !dbIds.has(d.id));

  const load = async () => {
    const [t, d] = await Promise.all([adminFetch<Topic[]>('/api/admin/topics'), adminFetch<AdminDeck[]>('/api/admin/decks')]);
    setTopics(t);
    setDecks(d);
    if (!deckForm.id && d[0]) setDeckForm(d[0]);
  };

  useEffect(() => {
    load().catch((err) => setStatus(err.message));
  }, []);

  /** Simpan deck buatan admin (topik tidak dipakai lagi). */
  const saveDeck = async (draft: DeckWithSettings): Promise<Deck | null> => {
    const payload = { ...draft, topicId: draft.topicId || '' };
    const path = payload.id ? `/api/admin/decks/${payload.id}` : '/api/admin/decks';
    const method = payload.id ? 'PUT' : 'POST';
    const saved = await adminFetch<Deck>(path, { method, body: JSON.stringify(payload) });
    setDeckForm(saved);
    await load();
    return saved;
  };

  const deleteDeck = async () => {
    await adminFetch(`/api/admin/decks/${deckForm.id}`, { method: 'DELETE' });
    setDeckForm(blankDeck(''));
    setNewDeckKey((k) => k + 1);
    setStatus('Deck dihapus.');
    await load();
  };

  const importJson = async () => {
    try {
      const parsed = JSON.parse(importText);
      const res = await adminFetch<{ topics: number; decks: number }>('/api/admin/import-content', {
        method: 'POST',
        body: JSON.stringify(parsed),
      });
      setStatus(`Impor selesai: ${res.topics} topik, ${res.decks} deck.`);
      await load();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Impor gagal.');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[
          ['decks', 'Kuis'],
          ...(isSuperAdmin ? [['import', 'Unggah JSON']] : []),
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold ${tab === id ? 'bg-accent text-on-accent' : 'bg-surface border border-white/10'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'decks' && (
        <div className="grid lg:grid-cols-[260px_1fr] gap-4">
          <aside className="rounded-2xl bg-surface border border-white/10 p-3 space-y-2 max-h-[80vh] overflow-y-auto">
            <button
              onClick={() => {
                setDeckForm(blankDeck(''));
                setNewDeckKey((k) => k + 1);
              }}
              className="w-full rounded-xl bg-accent text-on-accent font-bold py-2 text-sm"
            >
              Kuis baru
            </button>

            {([
              ['Buatan admin', adminDecks, 'bg-accent/20 text-accent', 'ADMIN'],
              ['Buatan pengguna', userDecks, 'bg-sky-500/20 text-sky-300', 'USER'],
            ] as const).map(([heading, list, badgeCls, badge]) => (
              <div key={heading} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 px-1 pt-2">
                  {heading} ({list.length})
                </p>
                {list.length === 0 && <p className="text-[11px] text-gray-500 px-1">Belum ada.</p>}
                {list.map((deck) => (
                  <button
                    key={deck.id}
                    onClick={() => setDeckForm(deck)}
                    className={`w-full text-left px-3 py-2 rounded-xl ${deckForm.id === deck.id ? 'bg-black/40 border border-accent' : 'hover:bg-black/20'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold truncate">{deck.title}</p>
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black ${badgeCls}`}>{badge}</span>
                    </div>
                    <p className="text-[11px] text-gray-400 truncate">
                      {deck.cardCount} soal · {deck.difficulty}
                      {deck.ownerEmail ? ` · ${deck.ownerEmail}` : ' · super admin'}{canEditDeck(deck) ? '' : ' · hanya-baca'}
                    </p>
                  </button>
                ))}
              </div>
            ))}

            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-wider text-gray-500 px-1 pt-2">
                Bawaan aplikasi ({builtinOnly.length})
              </p>
              {builtinOnly.map((deck) => (
                <button
                  key={deck.id}
                  onClick={() => {
                    setDeckForm({ ...deck, id: undefined, title: `${deck.title} (salinan)` } as DeckWithSettings);
                    setNewDeckKey((k) => k + 1);
                    setStatus(`"${deck.title}" adalah deck bawaan (hanya-baca). Yang dibuka adalah salinannya — Simpan deck untuk menjadikannya deck admin.`);
                  }}
                  className="w-full text-left px-3 py-2 rounded-xl hover:bg-black/20"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{deck.title}</p>
                    <span className="shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black bg-white/10 text-gray-300">BAWAAN</span>
                  </div>
                  <p className="text-[11px] text-gray-400">{deck.cardCount ?? deck.questions?.length ?? 0} soal · {deck.difficulty}</p>
                </button>
              ))}
            </div>
          </aside>

          <div className="space-y-3 min-w-0">
            <p className="text-xs text-gray-400">
              Simpan deck ke database dengan <em>Simpan deck</em>, atau klik <em>Ekspor sebagai JSON</em> untuk mengunduh berkas berformat sama seperti{' '}
              <code>deck-builtin-olahraga.json</code>. Taruh di <code>src/data/quiz/decks/</code>, lalu daftarkan di <code>src/data/quiz/index.ts</code> (tambahkan ke{' '}
              <code>EXTRA_BUILTIN_DECKS</code>) supaya menjadi deck bawaan permanen.
            </p>
            <DeckWizard
              key={deckForm.id || `new-${newDeckKey}`}
              deck={deckForm}
              topics={topics}
              allDecks={decks as Deck[]}
              onSave={saveDeck}
              onDelete={deleteDeck}
              onStatus={setStatus}
              readOnly={Boolean(deckForm.id) && !canEditDeck(deckForm as AdminDeck)}
            />
          </div>
        </div>
      )}

      {tab === 'import' && (
        <section className="rounded-2xl bg-surface border border-white/10 p-5 space-y-3">
          <h3 className="font-bold flex items-center gap-2">
            <Upload className="w-4 h-4 text-accent" /> Unggah kuis (JSON)
          </h3>
          <p className="text-sm text-gray-400">
            Format: {'{ "topics": [ { id, title, iconName, description, price } ], "decks": [ { id, topicId, title, questions: [...] } ] }'}
          </p>
          <input
            type="file"
            accept="application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setImportText(await file.text());
            }}
          />
          <textarea value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full min-h-64 rounded-xl bg-black/40 border border-white/10 p-3 font-mono text-xs" />
          <button onClick={importJson} className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2">
            Impor ke database
          </button>
        </section>
      )}

      {status && <p className="text-sm text-accent">{status}</p>}
    </div>
  );
};
