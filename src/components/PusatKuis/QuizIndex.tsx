// src/components/PusatKuis/QuizIndex.tsx
import React, { useState } from 'react';
import {
  Download,
  Play,
  Layers,
  Zap,
  Smartphone,
  Users,
  Mic,
  Shuffle,
  Plus,
  Minus,
  ListOrdered,
  History,
} from 'lucide-react';
import { QuizInstall } from './QuizInstall';
import { QuizLibrary } from './QuizLibrary';
import { QuizPlayer } from './QuizPlayer';
import type { QuizPlayMode } from './QuizPlayer';
import { MAX_TEAMS } from './QuizPlayer';
import { QuizResultHistory } from './QuizResultHistory';
import { MultiplayerArenaModal } from './MultiplayerArenaModal';
import { generateStandaloneQuizHtml } from '../../services/generateStandaloneQuizHtml';
import { Deck, Topic, CartItem } from '../../types';
import type { QuizSegment } from '../Header';
import { STARTER_DECKS, BUILTIN_DECKS, BUILTIN_TOPICS, isBuiltinDeckId } from '../../data/quiz';
import { loadCustomQuizJson } from '../../services/quizJsonStore';
import { usePurchasedDeckIds } from '../../services/quizPurchases';

interface QuizIndexProps {
  decks: Deck[];
  topics: Topic[];
  unlockedDeckIds: string[];
  unlockedTopicIds: string[];
  userChoiceClaimed: boolean;
  isOnline: boolean;
  userNickname: string;
  activeSection?: QuizSegment;
  onSectionChange?: (sec: QuizSegment) => void;
  onClaimFreeChoice: (deckId: string) => void;
  onAddToCart: (items: CartItem[]) => void;
  onOpenCart: () => void;
  onDeckCreatedOrUpdated: (deck: Deck) => void;
  onTopicCreatedOrUpdated: (topic: Topic) => void;
  onDeckDeleted?: (deckId: string) => void;
  onTopicDeleted?: (topicId: string) => void;
  onSuccessToast?: (msg: string) => void;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
  /** Status kepemilikan fitur Kreator Kuis (dari database), dipakai untuk mengunci menu "Kuis Editor" di berkas standalone. */
  hasQuizEditor?: boolean;
}

export const QuizIndex: React.FC<QuizIndexProps> = ({
  decks = [],
  topics = [],
  unlockedDeckIds = [],
  unlockedTopicIds = [],
  userChoiceClaimed,
  isOnline,
  userNickname,
  activeSection = 'all',
  onSectionChange,
  onClaimFreeChoice,
  onAddToCart,
  onOpenCart,
  onDeckCreatedOrUpdated,
  onTopicCreatedOrUpdated,
  onDeckDeleted,
  onTopicDeleted,
  onSuccessToast,
  canInstallPwa,
  onInstallPwa,
  hasQuizEditor = false,
}) => {
  const [activeSession, setActiveSession] = useState<{
    deck: Deck;
    mode: QuizPlayMode;
    playerCount: number;
    teamCount: number;
    questionLimit: number;
    shuffleQuestions: boolean;
  } | null>(null);
  const [isMultiplayerOpen, setIsMultiplayerOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  // 3 deck gratis permanen selalu berasal dari berkas JSON (src/data/quiz/decks/deck-starter-*.json)
  const starterDecks = STARTER_DECKS;

  // Pulihkan kuis buatan pengguna dari dokumen JSON (muzeck_custom_decks_json) sekali saat dibuka,
  // sehingga kuis tidak hilang meski state induk / penyimpanan lama kosong.
  React.useEffect(() => {
    const doc = loadCustomQuizJson();
    const knownIds = new Set(decks.map((d) => d.id));
    doc.topics.forEach((t) => onTopicCreatedOrUpdated(t));
    doc.decks.forEach((d) => {
      if (!knownIds.has(d.id) && !isBuiltinDeckId(d.id)) onDeckCreatedOrUpdated(d);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PENTING: Gabungkan starter decks + kuis custom, JANGAN saling menggantikan.
  // Sebelumnya "decks.length > 0 ? decks : starterDecks" membuat 3 starter deck
  // hilang total begitu user punya 1 kuis custom saja. Sekarang digabung pakai
  // Map (key = id) supaya tidak duplikat kalau starter deck sudah ada di `decks`.
  // Urutan: 3 starter + 3 deck bawaan tambahan (JSON) -> kuis kustom dari props.
  // Deck bawaan tidak bisa ditimpa oleh props (id bawaan selalu dipakai dari JSON).
  const decksForDisplay = React.useMemo(() => {
    const map = new Map<string, Deck>();
    BUILTIN_DECKS.forEach((d) => map.set(d.id, d));
    decks.forEach((d) => {
      if (!isBuiltinDeckId(d.id)) map.set(d.id, d);
    });
    return Array.from(map.values());
  }, [decks]);

  // Akses: 3 starter gratis + kuis buatan sendiri gratis; deck bawaan lain (Rp3.000) harus dibeli dulu.
  const purchasedIds = usePurchasedDeckIds();
  const allUnlockedIds = React.useMemo(
    () => Array.from(new Set([...unlockedDeckIds, ...purchasedIds])),
    [unlockedDeckIds, purchasedIds]
  );
  const canAccess = React.useCallback(
    (d: Deck) => !isBuiltinDeckId(d.id) || d.isFree || allUnlockedIds.includes(d.id),
    [allUnlockedIds]
  );
  const accessibleDecks = React.useMemo(() => decksForDisplay.filter(canAccess), [decksForDisplay, canAccess]);

  const [selectedDeckToLoad, setSelectedDeckToLoad] = useState<string>(accessibleDecks[0]?.id || 'deck-starter-1');

  // Di dalam komponen QuizIndex:
  React.useEffect(() => {
    const handleNavigate = (e: any) => {
      const targetId = e.detail?.deckId;
      if (targetId) {
        setSelectedDeckToLoad(targetId);
        if (onSectionChange) onSectionChange('play');
      }
    };

    window.addEventListener('muzeck:navigate-quiz-play', handleNavigate);
    return () => window.removeEventListener('muzeck:navigate-quiz-play', handleNavigate);
  }, [onSectionChange]);
  const currentLoadedDeck = accessibleDecks.find((d) => d.id === selectedDeckToLoad) || accessibleDecks[0];
  const totalQuestionsInDeck = currentLoadedDeck?.questions?.length || 0;

  // Konfigurasi sesi: jumlah soal yang dimainkan, urutan acak, jumlah pemain/regu
  const [questionCount, setQuestionCount] = useState<number>(totalQuestionsInDeck || 1);
  const [shuffleOn, setShuffleOn] = useState<boolean>(false);
  const [passPlayCount, setPassPlayCount] = useState<number>(2);
  const [hostTeamCount, setHostTeamCount] = useState<number>(2);

  // Saat deck yang dimuat berganti, sesuaikan batas jumlah soal ke total soal deck baru
  React.useEffect(() => {
    setQuestionCount((prev) => {
      if (!totalQuestionsInDeck) return 1;
      return Math.min(Math.max(prev, 1), totalQuestionsInDeck);
    });
  }, [selectedDeckToLoad, totalQuestionsInDeck]);

  const launchSession = (mode: QuizPlayMode) => {
    if (!currentLoadedDeck) return;
    setActiveSession({
      deck: currentLoadedDeck,
      mode,
      playerCount: passPlayCount,
      teamCount: hostTeamCount,
      questionLimit: questionCount,
      shuffleQuestions: shuffleOn,
    });
  };

  // Ubah gambar logo (yang sama dipakai di top-bar web app) menjadi data URI base64,
  // supaya berkas standalone benar-benar mandiri (offline) dan logonya tampil tanpa
  // bergantung pada path relatif "/PlayMuzeck-logo.png" yang tidak ada saat dibuka lokal.
  const fetchLogoAsDataUri = async (): Promise<string> => {
    try {
      const res = await fetch('/PlayMuzeck-logo.png');
      if (!res.ok) return '';
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Gagal membaca logo'));
        reader.readAsDataURL(blob);
      });
    } catch {
      return '';
    }
  };

  const handleDownloadStandalone = async () => {
    // Sama seperti decksForDisplay: gabungkan, jangan gantikan, supaya
    // berkas standalone yang diunduh tetap membawa 3 starter deck + kuis custom.
    const logoDataUri = await fetchLogoAsDataUri();
    // Pakai origin nyata yang sedang berjalan (bukan localhost) supaya tombol
    // "Beli di Web App", "Ajukan ke Cloud", "Donasi", dan "Hubungi Kami" di
    // berkas standalone benar-benar tersambung ke server & web app produksi.
    const currentOrigin = window.location.origin;
    const htmlString = generateStandaloneQuizHtml(
      accessibleDecks,
      userNickname,
      hasQuizEditor,
      currentOrigin,
      currentOrigin,
      logoDataUri
    );
    const blob = new Blob([htmlString], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'PlayMuzeck-Quiz-Standalone.html';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (onSuccessToast) {
      onSuccessToast('Berkas aplikasi mandiri PlayMuzeck (zeck) berhasil diunduh!');
    }
  };

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-2 space-y-7 pb-20">
      {/* BANNER SEGMEN KUIS DINAMIS */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-[#2a0c10] via-[#14213D] to-[#1e0a0d] border-2 border-[#FC1212]/40 p-5 sm:p-6 shadow-[0_10px_35px_rgba(252,18,18,0.15)] flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="flex items-center gap-3.5 z-10">
          <div className="w-13 h-13 rounded-2xl bg-[#FC1212]/15 border border-[#FC1212]/40 flex items-center justify-center text-[#FC1212] shadow-lg shadow-red-600/20 shrink-0">
            {activeSection === 'pwa' && <Download className="w-6 h-6 stroke-[2.5]" />}
            {activeSection === 'play' && <Play className="w-6 h-6 stroke-[2.5] fill-current" />}
            {activeSection === 'all' && <Layers className="w-6 h-6 stroke-[2.5]" />}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {activeSection === 'pwa' && 'Unduh Web App'}
              {activeSection === 'play' && 'Mainkan Kuis'}
              {activeSection === 'all' && 'Perpustakaan Kuis'}
            </h1>
            <p className="text-xs text-gray-300 font-medium mt-0.5">
              {activeSection === 'pwa' && 'Pusat instalasi aplikasi web mandiri PWA & berkas aplikasi luring utuh.'}
              {activeSection === 'play' && 'Pilih paket kuis yang dimuat, tentukan 4 mode permainan, dan mainkan langsung.'}
              {activeSection === 'all' && 'Katalog seluruh tema kuis, 3 starter deck bawaan, dan kreator kuis kustom.'}
            </p>
          </div>
        </div>

        <div className="z-10 self-start md:self-auto">
          {activeSection === 'pwa' && (
            <div className="flex items-center gap-3 bg-black/55 px-4 py-2 rounded-2xl border border-red-500/30 shadow-inner">
              <div className="w-2.5 h-2.5 rounded-full bg-[#FC1212] animate-ping" />
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider">Target Standalone PWA</span>
                <span className="text-xs font-black text-white">Khusus Modul Kuis Luring</span>
              </div>
            </div>
          )}

          {activeSection === 'play' && (
            <div className="flex items-center gap-3.5 bg-black/55 px-4 py-2 rounded-2xl border border-emerald-500/30 shadow-inner">
              <Play className="w-4 h-4 text-emerald-400" />
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider">Mode Bermain</span>
                <span className="text-xs font-black text-emerald-400">4 Pilihan Mode Aktif</span>
              </div>
            </div>
          )}

          {activeSection === 'all' && (
            <div className="flex items-center gap-3.5 bg-black/55 px-4 py-2 rounded-2xl border border-amber-500/30 shadow-inner">
              <Layers className="w-4 h-4 text-amber-400" />
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider">Database Vault</span>
                <span className="text-xs font-black text-amber-300">{decksForDisplay.length} Deck • {new Set([...BUILTIN_TOPICS.map((t) => t.id), ...topics.map((t) => t.id)]).size} Kategori</span>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* SEGMEN 1: UNDUH WEB APP */}
      {activeSection === 'pwa' && (
        <QuizInstall
          starterDecks={starterDecks}
          isOnline={isOnline}
          canInstallPwa={canInstallPwa}
          onInstallPwa={onInstallPwa}
          onDownloadStandalone={handleDownloadStandalone}
          onNavigateLibrary={() => onSectionChange?.('all')}
        />
      )}

      {/* SEGMEN 2: MAINKAN KUIS */}
      {activeSection === 'play' && (
        <section className="space-y-6 animate-in fade-in duration-200">
          <div className="rounded-3xl bg-[#14213D] border border-white/10 p-6 sm:p-8 shadow-2xl space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-white">Konfigurasi Sesi Mainkan Kuis</h2>
                <p className="text-xs text-gray-400 mt-1">
                  Pilih paket kuis yang ingin dimuat, lalu tentukan cara bermain yang Anda inginkan.
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap">
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen(true)}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <History className="w-3.5 h-3.5" />
                  <span>Riwayat Hasil</span>
                </button>
                <button
                  type="button"
                  onClick={() => onSectionChange?.('all')}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Buka Perpustakaan Kuis →
                </button>
              </div>
            </div>

            {/* Pilihan Paket Kuis yang Dimuat */}
            <div className="space-y-2 bg-black/50 p-4 rounded-2xl border border-white/10">
              <label className="text-xs font-bold text-gray-300 block">
                Paket Kuis yang Dimuat:
              </label>
              <select
                value={selectedDeckToLoad}
                onChange={(e) => setSelectedDeckToLoad(e.target.value)}
                className="w-full bg-black/80 border border-white/15 focus:border-[#FC1212] rounded-xl px-3.5 py-3 text-xs text-white outline-none font-bold cursor-pointer"
              >
                {decksForDisplay.map((d) => {
                  const ok = canAccess(d);
                  return (
                    <option key={d.id} value={d.id} disabled={!ok} className="bg-[#14213D] text-white">
                      {ok ? '' : '🔒 '}
                      {d.title} ({(d.questions || []).length} Butir Soal • {d.difficulty})
                      {ok ? '' : ` — beli di Perpustakaan (Rp${(d.price || 3000).toLocaleString('id-ID')})`}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Jumlah Soal & Pengacakan Urutan */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div className="space-y-2 bg-black/50 p-4 rounded-2xl border border-white/10">
                <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                  <ListOrdered className="w-3.5 h-3.5 text-[#FC1212]" />
                  <span>Jumlah Soal Dimainkan:</span>
                </label>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => setQuestionCount((prev) => Math.max(1, prev - 1))}
                    className="w-8 h-8 shrink-0 rounded-lg bg-black/80 hover:bg-black text-white flex items-center justify-center cursor-pointer border border-white/10"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={totalQuestionsInDeck || 1}
                    value={questionCount}
                    onChange={(e) => {
                      const val = Number(e.target.value) || 1;
                      setQuestionCount(Math.min(Math.max(val, 1), totalQuestionsInDeck || 1));
                    }}
                    className="w-full bg-black/80 border border-white/15 rounded-lg px-2 py-1.5 text-center text-xs font-mono font-bold text-white outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setQuestionCount((prev) => Math.min(totalQuestionsInDeck || 1, prev + 1))}
                    className="w-8 h-8 shrink-0 rounded-lg bg-black/80 hover:bg-black text-white flex items-center justify-center cursor-pointer border border-white/10"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[11px] text-gray-400 font-mono shrink-0">
                    / {totalQuestionsInDeck} Soal
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShuffleOn((prev) => !prev)}
                className={`space-y-2 p-4 rounded-2xl border text-left transition-colors cursor-pointer ${
                  shuffleOn ? 'bg-[#FC1212]/15 border-[#FC1212]/50' : 'bg-black/50 border-white/10 hover:border-white/20'
                }`}
              >
                <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5 cursor-pointer">
                  <Shuffle className={`w-3.5 h-3.5 ${shuffleOn ? 'text-[#FC1212]' : 'text-gray-400'}`} />
                  <span>Acak Urutan Soal</span>
                </label>
                <div className="flex items-center gap-2">
                  <div
                    className={`w-9 h-5 rounded-full relative transition-colors ${shuffleOn ? 'bg-[#FC1212]' : 'bg-white/15'}`}
                  >
                    <div
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                        shuffleOn ? 'translate-x-4' : 'translate-x-0.5'
                      }`}
                    />
                  </div>
                  <span className="text-[11px] text-gray-400">{shuffleOn ? 'Aktif' : 'Nonaktif'}</span>
                </div>
              </button>
            </div>

            {/* Pilihan 4 Mode Permainan */}
            <div className="space-y-3">
              <span className="text-xs font-bold text-gray-300 uppercase tracking-wider block">
                Pilih Mode Permainan:
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div
                  onClick={() => launchSession('solo')}
                  className="p-5 rounded-2xl bg-black/40 hover:bg-[#FC1212] border border-white/10 hover:border-[#FC1212] transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#FC1212]/20 group-hover:bg-black text-[#FC1212] group-hover:text-white flex items-center justify-center mb-3">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white group-hover:text-white">1. Langsung Main</h4>
                    <p className="text-[11px] text-gray-400 group-hover:text-white/90 mt-1 leading-relaxed">
                      Mode solo mandiri dengan batas waktu berpikir per soal (bawaan 30 detik, bisa diatur).
                    </p>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-black/40 border border-white/10 hover:border-amber-400/60 transition-all group flex flex-col justify-between gap-3">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center mb-3">
                      <Smartphone className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-black text-white">2. Pass &amp; Play</h4>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                      Main bergiliran 2 hingga 6 pemain dalam 1 perangkat fisik yang sama.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPassPlayCount((p) => Math.max(2, p - 1));
                        }}
                        className="w-6 h-6 rounded-md bg-black/70 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-mono font-bold text-white w-5 text-center">{passPlayCount}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPassPlayCount((p) => Math.min(6, p + 1));
                        }}
                        className="w-6 h-6 rounded-md bg-black/70 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] text-gray-400">Pemain</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => launchSession('pass_play')}
                      className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-black cursor-pointer active:scale-95 transition-all"
                    >
                      Mulai
                    </button>
                  </div>
                </div>

                <div
                  onClick={() => setIsMultiplayerOpen(true)}
                  className="p-5 rounded-2xl bg-black/40 hover:bg-[#FC1212] border border-white/10 hover:border-[#FC1212] transition-all cursor-pointer group flex flex-col justify-between"
                >
                  <div className="w-10 h-10 rounded-xl bg-blue-500/20 group-hover:bg-black text-blue-400 group-hover:text-white flex items-center justify-center mb-3">
                    <Users className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-white group-hover:text-white">3. Multiplayer Online</h4>
                    <p className="text-[11px] text-gray-400 group-hover:text-white/90 mt-1 leading-relaxed">
                      Tanding adu cepat dan ketepatan skor bersama teman melalui jaringan online.
                    </p>
                  </div>
                </div>

                <div className="p-5 rounded-2xl bg-black/40 border border-white/10 hover:border-purple-400/60 transition-all group flex flex-col justify-between gap-3">
                  <div>
                    <div className="w-10 h-10 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center mb-3">
                      <Mic className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-black text-white">4. Host / Kuis Master</h4>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                      Bertindak sebagai pemandu kuis dengan kunci jawaban &amp; papan skor hingga 10 regu.
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHostTeamCount((p) => Math.max(1, p - 1));
                        }}
                        className="w-6 h-6 rounded-md bg-black/70 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-xs font-mono font-bold text-white w-5 text-center">{hostTeamCount}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHostTeamCount((p) => Math.min(MAX_TEAMS, p + 1));
                        }}
                        className="w-6 h-6 rounded-md bg-black/70 hover:bg-black text-white flex items-center justify-center cursor-pointer"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      <span className="text-[10px] text-gray-400">Regu</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => launchSession('host')}
                      className="px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-white text-[11px] font-black cursor-pointer active:scale-95 transition-all"
                    >
                      Mulai
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* SEGMEN 3: PERPUSTAKAAN KUIS */}
      {activeSection === 'all' && (
        <QuizLibrary
          decks={decksForDisplay}
          topics={topics}
          unlockedDeckIds={allUnlockedIds}
          unlockedTopicIds={unlockedTopicIds}
          userChoiceClaimed={userChoiceClaimed}
          isOnline={isOnline}
          onClaimFreeChoice={onClaimFreeChoice}
          onPlayDeck={(deck) => {
            setSelectedDeckToLoad(deck.id);
            if (onSectionChange) onSectionChange('play');
            if (onSuccessToast) onSuccessToast(`Paket "${deck.title}" berhasil dimuat ke Pemutar Kuis!`);
          }}
          onAddToCart={onAddToCart}
          onOpenCart={onOpenCart}
          onDeckCreatedOrUpdated={onDeckCreatedOrUpdated}
          onTopicCreatedOrUpdated={onTopicCreatedOrUpdated}
          onDeckDeleted={onDeckDeleted}
          onTopicDeleted={onTopicDeleted}
          onSuccessToast={onSuccessToast}
          canInstallPwa={canInstallPwa}
          onInstallPwa={onInstallPwa}
        />
      )}

      {/* MODAL PEMUTAR KUIS QUIZPLAYER LENGKAP */}
      {activeSession && (
        <QuizPlayer
          deck={activeSession.deck}
          mode={activeSession.mode}
          playerCount={activeSession.playerCount}
          teamCount={activeSession.teamCount}
          questionLimit={activeSession.questionLimit}
          shuffleQuestions={activeSession.shuffleQuestions}
          onClose={() => setActiveSession(null)}
        />
      )}

      {/* MODAL RIWAYAT HASIL (rincian jawaban per soal) */}
      {isHistoryOpen && <QuizResultHistory onClose={() => setIsHistoryOpen(false)} />}

      {/* MODAL MULTIPLAYER */}
      <MultiplayerArenaModal
        isOpen={isMultiplayerOpen}
        onClose={() => setIsMultiplayerOpen(false)}
        decks={accessibleDecks}
        unlockedDeckIds={allUnlockedIds}
        isOnline={isOnline}
        userNickname={userNickname}
      />
    </div>
  );
};