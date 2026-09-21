// src/components/PusatKuis/QuizLibrary.tsx
import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers,
  CheckCircle2,
  Lock,
  Sparkles,
  Edit3,
  Wifi,
  WifiOff,
  Search,
  Trash2,
  Eye,
  X,
  BookOpen,
  ArrowRight,
  Download,
} from 'lucide-react';
import { Deck, Topic, CartItem } from '../../types';
import { QuizEditor } from './QuizEditor';
import { isUserAdmin } from '../../services/adminConfig';
import { storage } from '../../services/storage';
import { BUILTIN_DECKS, BUILTIN_TOPICS, isBuiltinDeckId } from '../../data/quiz';
import { downloadDeckJson, removeDeckFromJsonStore } from '../../services/quizJsonStore';
import { deckToCartItem, usePurchasedDeckIds } from '../../services/quizPurchases';

interface QuizLibraryProps {
  decks: Deck[];
  topics: Topic[];
  unlockedDeckIds: string[];
  unlockedTopicIds: string[];
  userChoiceClaimed: boolean;
  isOnline: boolean;
  onClaimFreeChoice: (deckId: string) => void;
  onPlayDeck: (deck: Deck) => void;
  onAddToCart: (items: CartItem[]) => void;
  onOpenCart: () => void;
  onDeckCreatedOrUpdated: (deck: Deck) => void;
  onTopicCreatedOrUpdated: (topic: Topic) => void;
  onDeckDeleted?: (deckId: string) => void;
  onTopicDeleted?: (topicId: string) => void;
  onSuccessToast?: (msg: string) => void;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
}

// Deck & topik bawaan (3 starter gratis + Olahraga, Kehidupan Sehari-hari, Matematika)
// dimuat dari berkas JSON di src/data/quiz/.
const PERMANENT_STARTER_DECKS: Deck[] = BUILTIN_DECKS;
const PERMANENT_TOPICS: Topic[] = BUILTIN_TOPICS;

export const QuizLibrary: React.FC<QuizLibraryProps> = ({
  decks = [],
  topics = [],
  isOnline,
  unlockedDeckIds = [],
  onPlayDeck,
  onAddToCart,
  onOpenCart,
  onDeckCreatedOrUpdated,
  onTopicCreatedOrUpdated,
  onDeckDeleted,
  onTopicDeleted,
  onSuccessToast,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTheme, setSelectedTheme] = useState('all');
  const [selectedTopicId, setSelectedTopicId] = useState('all');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [deckToEdit, setDeckToEdit] = useState<Deck | null>(null);
  const [deckToView, setDeckToView] = useState<Deck | null>(null);
  const [isLockedPromptOpen, setIsLockedPromptOpen] = useState(false);
  const [deletedIds, setDeletedIds] = useState<string[]>([]);
  const purchasedIds = usePurchasedDeckIds();
  // Gratis: 3 starter + kuis buatan sendiri. Deck bawaan lain baru terbuka setelah dibeli.
  const canAccess = (d: Deck) =>
    !isBuiltinDeckId(d.id) || d.isFree || purchasedIds.includes(d.id) || unlockedDeckIds.includes(d.id);

  const userSession = storage.getUserSession();
  const userEmail = userSession?.email ? userSession.email.trim().toLowerCase() : '';

  const isCreatorUnlocked = useMemo(() => {
    if (!userSession?.isLoggedIn || !userEmail) return false;
    let purchasedQuizDeckIds: string[] = [];
    try {
      const scopedPurchases = localStorage.getItem(`muzeck_purchased_deck_ids_${userEmail}`);
      if (scopedPurchases) purchasedQuizDeckIds = JSON.parse(scopedPurchases);
    } catch {}

    const isUnlocked = 
      localStorage.getItem(`muzeck_quiz_creator_unlocked_${userEmail}`) === 'true' ||
      purchasedQuizDeckIds.includes('quiz_editor_10k') ||
      purchasedQuizDeckIds.includes('quiz-creator-suite');

    return isUnlocked;
  }, [userSession?.isLoggedIn, userEmail, purchasedIds]); // purchasedIds berubah saat event sinkron -> hitung ulang
  
  const allDecks = useMemo(() => {
    // PERBAIKAN BUG KEBOCORAN ANTAR AKUN: sebelumnya baris ini membaca
    // localStorage MENTAH dengan key hardcode 'muzeck_custom_decks_v1',
    // melewati sepenuhnya `storage.getCustomDecks()` yang sudah di-scope per
    // email login. Akibatnya deck kustom akun lain di device yang sama tetap
    // bocor tampil di sini (lengkap dengan tombol edit/hapus), walau di
    // "Koleksi Saya" (yang datanya dari database, sudah benar per akun)
    // deck itu tidak pernah muncul. Sekarang pakai storage.getCustomDecks()
    // yang sudah di-scope per akun.
    const localSaved: Deck[] = storage.getCustomDecks();

    const map = new Map<string, Deck>();
    PERMANENT_STARTER_DECKS.forEach((d) => map.set(d.id, d));
    // Hanya kuis buatan pengguna. Deck non-bawaan lain (data contoh / seed lama) dulu ikut tampil
    // sebagai GRATIS; sekarang dibuang. Deck bawaan sudah masuk lewat PERMANENT_STARTER_DECKS.
    const ownIds = new Set(localSaved.map((c) => c.id));
    decks.forEach((d) => {
      if (!isBuiltinDeckId(d.id) && (d.id.startsWith('deck-custom-') || ownIds.has(d.id))) map.set(d.id, d);
    });
    localSaved.forEach((d) => {
      if (!isBuiltinDeckId(d.id)) map.set(d.id, d);
    });

    return Array.from(map.values()).filter((d) => !deletedIds.includes(d.id));
  }, [decks, deletedIds, userEmail]);

  const allTopics = useMemo(() => {
    // Sama seperti allDecks di atas: pakai storage.getCustomTopics() yang
    // sudah di-scope per akun, bukan localStorage mentah key
    // 'muzeck_custom_topics' (yang juga sebelumnya tidak konsisten dengan
    // key asli di storage.ts, yaitu 'muzeck_custom_topics_v1').
    const localTopics: Topic[] = storage.getCustomTopics();

    const map = new Map<string, Topic>();
    PERMANENT_TOPICS.forEach((t) => map.set(t.id, t));
    topics.forEach((t) => map.set(t.id, t));
    localTopics.forEach((t) => map.set(t.id, t));

    return Array.from(map.values());
  }, [topics, userEmail]);

  // 2. Filter Topik yang HANYA Memiliki Kuis (Menghilangkan Topik Kosong/Yatim)
  const activeTopics = useMemo(() => {
    return allTopics.filter((topic) => {
      const matchingCount = allDecks.filter(
        (d) =>
          d.topicId === topic.id ||
          d.topicId?.toLowerCase() === topic.title.toLowerCase() ||
          d.topicId?.toLowerCase() === topic.id.toLowerCase()
      ).length;
      return matchingCount > 0;
    });
  }, [allTopics, allDecks]);

  // Jika topik yang aktif dipilih ternyata kuisnya sudah terhapus, kembalikan ke 'all'
  useEffect(() => {
    if (selectedTopicId !== 'all') {
      const topicStillExists = activeTopics.some(
        (t) => t.id === selectedTopicId || t.title.toLowerCase() === selectedTopicId.toLowerCase()
      );
      if (!topicStillExists) {
        setSelectedTopicId('all');
      }
    }
  }, [activeTopics, selectedTopicId]);

  // 3. Tema Admin yang Aktif Memiliki Kuis
  const themeList = useMemo(() => {
    const set = new Set<string>();
    allDecks.forEach((d) => {
      const themeName = d.badge || 'Lainnya';
      if (themeName !== 'Kuis Kustom') set.add(themeName);
    });
    return Array.from(set);
  }, [allDecks]);

  // 4. Filter Kuis Bertingkat (Tema -> Topik -> Input Pencarian)
  const filteredDecks = useMemo(() => {
    return allDecks.filter((deck) => {
      const parentTopic = allTopics.find(
        (t) => t.id === deck.topicId || t.title.toLowerCase() === deck.topicId?.toLowerCase()
      );
      const theme = deck.badge || parentTopic?.badge || 'Lainnya';
      const topicTitle = parentTopic?.title || deck.topicId || '';

      if (selectedTheme !== 'all' && theme.toLowerCase() !== selectedTheme.toLowerCase()) {
        return false;
      }

      if (selectedTopicId !== 'all') {
        const isMatchingTopic =
          deck.topicId === selectedTopicId ||
          deck.topicId?.toLowerCase() === selectedTopicId.toLowerCase() ||
          parentTopic?.id === selectedTopicId ||
          parentTopic?.title.toLowerCase() === selectedTopicId.toLowerCase();
        if (!isMatchingTopic) return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchTitle = deck.title.toLowerCase().includes(q);
        const matchTopic = topicTitle.toLowerCase().includes(q);
        const matchTheme = theme.toLowerCase().includes(q);
        if (!matchTitle && !matchTopic && !matchTheme) return false;
      }

      return true;
    });
  }, [allDecks, allTopics, selectedTheme, selectedTopicId, searchQuery]);

  const handleOpenCreator = () => {
    if (isCreatorUnlocked) {
      setDeckToEdit(null);
      setIsEditorOpen(true);
    } else {
      setIsLockedPromptOpen(true);
    }
  };

  const handleEditDeck = (deck: Deck, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeckToEdit(deck);
    setIsEditorOpen(true);
  };

  // 5. Eksekusi Hapus Kuis Seketika dan Bersihkan Topik Kosong di Penyimpanan
  const handleDeleteDeck = async (deck: Deck, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Apakah Anda yakin ingin menghapus kuis "${deck.title}"?`)) return;

    const userEmail = storage.getUserSession()?.email;
    if (!userEmail) {
      onSuccessToast?.('Gagal menghapus: sesi login tidak ditemukan.');
      return;
    }

    try {
      const res = await fetch(`/api/user/decks/${encodeURIComponent(deck.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        onSuccessToast?.(`Gagal menghapus di server: ${body?.error || res.status}`);
        return; // JANGAN hapus dari local kalau server gagal — biar tidak "ilang" palsu
      }
    } catch {
      onSuccessToast?.('Gagal terhubung ke server untuk menghapus kuis.');
      return;
    }

    // Server sudah sukses menghapus -> baru bersihkan cache lokal.
    setDeletedIds((prev) => [...prev, deck.id]);
    // BUG SEBELUMNYA: menulis ke kunci 'muzeck_custom_decks_v1' TANPA scope akun (kunci asli:
    // muzeck_custom_decks_v1::<email>), jadi salinan lokal tidak pernah terhapus & kuis muncul lagi.
    try {
      const localDecks = storage.getCustomDecks();
      const hasOtherDeckWithTopic = localDecks.some(
        (d) => d.id !== deck.id && (d.topicId === deck.topicId || d.topicId?.toLowerCase() === deck.topicId?.toLowerCase())
      );
      storage.deleteCustomDeck(deck.id);
      if (!hasOtherDeckWithTopic) {
        storage.deleteCustomTopic(deck.topicId);
        if (onTopicDeleted) onTopicDeleted(deck.topicId);
      }
    } catch {}

    removeDeckFromJsonStore(deck.id);
    if (onDeckDeleted) onDeckDeleted(deck.id);
    onSuccessToast?.(`Kuis "${deck.title}" berhasil dihapus permanen.`);
  };

  // Deck bawaan berbayar (Rp3.000/deck) -> masuk keranjang; setelah dibayar tampil di Profil
  const handleBuyDeck = (deck: Deck) => {
    onAddToCart([deckToCartItem(deck)]);
    onOpenCart();
    onSuccessToast?.(`"${deck.title}" ditambahkan ke keranjang.`);
  };

  const handleBuyCreator = () => {
    setIsLockedPromptOpen(false);
    onAddToCart([
      {
        id: `quiz-creator-suite-${Date.now()}`,
        title: 'Kreator Kuis & Topik Suite (Akses Penuh)',
        category: 'topic',
        price: 25000,
        description: 'Akses penuh penyusunan kuis mandiri dengan 12 tema admin baku, kustom topik, multimedia, dan variasi penilaian.',
        itemTypeKey: 'quizCreatorSuite',
      } as any,
    ]);
    onOpenCart();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Banner */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4 p-4 sm:p-5 rounded-3xl bg-black/40 border border-white/10">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-[#FC1212] text-white">
              Pusat Kuis
            </span>
            {isOnline ? (
              <span className="text-[11px] font-medium text-emerald-400 bg-emerald-500/15 px-2.5 py-0.5 rounded-full border border-emerald-500/30 flex items-center gap-1">
                <Wifi className="w-3 h-3" /> Online Mode Aktif
              </span>
            ) : (
              <span className="text-[11px] font-medium text-[#FC1212] bg-[#780000]/30 px-2.5 py-0.5 rounded-full border border-[#FC1212]/40 flex items-center gap-1">
                <WifiOff className="w-3 h-3" /> Offline Mode
              </span>
            )}
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white">
            Perpustakaan Kuis &amp; Tema Materi
          </h2>
          <p className="text-xs text-gray-300">
            Jelajahi seluruh bank kuis bawaan, buat kuis kustom, atau kelola koleksi kuis buatan Anda.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <button
            id="btn-open-creator-suite"
            onClick={handleOpenCreator}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-md ${
              isCreatorUnlocked
                ? 'bg-[#FC1212] hover:bg-[#e01010] text-white'
                : 'bg-black/60 hover:bg-black/90 text-gray-300 border border-[#FC1212]/40'
            }`}
          >
            {isCreatorUnlocked ? <Edit3 className="w-4 h-4" /> : <Lock className="w-4 h-4 text-[#FCA311]" />}
            <span>Kreator Deck &amp; Topik</span>
            {!isCreatorUnlocked && (
              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-[#FCA311] font-mono">
                Rp25rb
              </span>
            )}
          </button>

        </div>
      </div>

      {/* Bilah Pencarian Cerdas (Judul, Topik, atau Tema) */}
      <div className="p-4 rounded-2xl bg-[#14213D] border border-white/10 space-y-3 shadow-lg">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari kuis berdasarkan Judul, Topik, atau Tema (mis. Sains, Alam, Sejarah)..."
            className="w-full bg-black/60 border border-white/10 focus:border-[#FC1212] rounded-xl pl-9 pr-8 py-2.5 text-xs text-white placeholder:text-gray-500 outline-none transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Hierarki 1: Tema Induk */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
          <span className="text-[11px] font-bold text-gray-400 shrink-0 uppercase tracking-wider">
            Tema:
          </span>
          <button
            onClick={() => {
              setSelectedTheme('all');
              setSelectedTopicId('all');
            }}
            className={`px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer whitespace-nowrap ${
              selectedTheme === 'all'
                ? 'bg-[#FC1212] text-white'
                : 'bg-black/50 text-gray-400 hover:text-white'
            }`}
          >
            Semua Tema
          </button>
          {themeList.map((th) => (
            <button
              key={th}
              onClick={() => {
                setSelectedTheme(th);
                setSelectedTopicId('all');
              }}
              className={`px-3 py-1.5 rounded-xl font-bold transition-colors cursor-pointer whitespace-nowrap ${
                selectedTheme.toLowerCase() === th.toLowerCase()
                  ? 'bg-[#FC1212] text-white'
                  : 'bg-black/50 text-gray-400 hover:text-white'
              }`}
            >
              {th}
            </button>
          ))}
        </div>

        {/* Filter Hierarki 2: Topik (HANYA Menampilkan Topik yang Memiliki Kuis) */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar text-xs border-t border-white/5 pt-2">
          <span className="text-[11px] font-bold text-gray-400 shrink-0 uppercase tracking-wider">
            Topik:
          </span>
          <button
            onClick={() => setSelectedTopicId('all')}
            className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
              selectedTopicId === 'all'
                ? 'bg-white/20 text-white font-bold'
                : 'bg-black/30 text-gray-400 hover:text-white'
            }`}
          >
            Semua Topik
          </button>
          {activeTopics
            .filter((t) => {
              if (selectedTheme === 'all') return true;
              return t.badge?.toLowerCase() === selectedTheme.toLowerCase();
            })
            .map((top) => (
              <button
                key={top.id}
                onClick={() => setSelectedTopicId(top.id)}
                className={`px-3 py-1 rounded-lg font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  selectedTopicId === top.id
                    ? 'bg-white/20 text-white font-bold'
                    : 'bg-black/30 text-gray-400 hover:text-white'
                }`}
              >
                {top.title}
              </button>
            ))}
        </div>
      </div>

      {/* Grid Kartu Kuis */}
      {filteredDecks.length === 0 ? (
        <div className="p-12 text-center rounded-3xl bg-black/40 border border-dashed border-white/10 space-y-3">
          <BookOpen className="w-10 h-10 text-gray-500 mx-auto" />
          <h3 className="text-base font-bold text-white">Tidak ada kuis yang sesuai dengan filter pencarian.</h3>
          <button
            onClick={() => {
              setSearchQuery('');
              setSelectedTheme('all');
              setSelectedTopicId('all');
            }}
            className="px-4 py-2 rounded-xl bg-[#FC1212] text-white font-bold text-xs cursor-pointer"
          >
            Reset Semua Filter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          <AnimatePresence mode="popLayout">
            {filteredDecks.map((deck) => {
              const parentTopic = allTopics.find(
                (t) => t.id === deck.topicId || t.title.toLowerCase() === deck.topicId?.toLowerCase()
              );
              const themeName = deck.badge || parentTopic?.badge || 'Lainnya';
              const locked = !canAccess(deck);
              // Sebelumnya `Boolean(deck.badge)` -> deck resmi/admin ber-badge ikut
              // menampilkan tombol edit & hapus untuk semua pemain. Sekarang hanya
              // deck yang benar-benar tersimpan sebagai kuis kustom akun ini.
              const isCustomDeck =
                !isBuiltinDeckId(deck.id) &&
                (deck.id.startsWith('deck-custom-') || storage.getCustomDecks().some((c) => c.id === deck.id));

              return (
                <motion.div
                  layout
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  key={deck.id}
                  className="rounded-3xl bg-[#14213D] border border-white/10 p-5 flex flex-col justify-between shadow-xl"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-[#FC1212]/20 text-[#FC1212] border border-[#FC1212]/30">
                          {themeName}
                        </span>
                        <span className="text-[11px] font-medium text-gray-400 truncate max-w-[90px] sm:max-w-[140px]">
                          {parentTopic?.title || deck.topicId}
                        </span>
                      </div>
                      {locked ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-[#FCA311] border border-amber-500/30 flex items-center gap-1">
                          <Lock className="w-2.5 h-2.5" /> Rp{(deck.price || 3000).toLocaleString('id-ID')}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                          {isBuiltinDeckId(deck.id) && !deck.isFree ? 'DIMILIKI' : 'GRATIS'}
                        </span>
                      )}
                    </div>

                    <h4 className="text-base sm:text-lg font-black text-white leading-snug">
                      {deck.title}
                    </h4>

                    <p className="text-xs text-gray-300 line-clamp-2 leading-relaxed">
                      {deck.description}
                    </p>

                    <div className="flex items-center gap-2 pt-2 border-t border-white/5 text-[11px] text-gray-400 font-mono">
                      <span>{deck.cardCount} Kartu Pertanyaan</span>
                      {deck.difficulty && (deck.difficulty as string) !== 'Tidak dispesifikasikan' && (
                        <span>• Tingkat: {deck.difficulty}</span>
                      )}
                    </div>
                  </div>

                  {/* Tombol Aksi: View, Edit, Hapus, dan Muat Kuis */}
                  <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDeckToView(deck)}
                        className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-200 hover:text-white transition-colors cursor-pointer"
                        title="Lihat Pratinjau Soal"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>

                      {!locked && (
                      <button
                        type="button"
                        onClick={() => downloadDeckJson(deck, parentTopic)}
                        className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-200 hover:text-white transition-colors cursor-pointer"
                        title="Unduh kuis ini sebagai berkas JSON"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </button>
                      )}

                      {isCustomDeck && (
                        <>
                          <button
                            type="button"
                            onClick={(e) => handleEditDeck(deck, e)}
                            className="p-2 rounded-xl bg-white/10 hover:bg-amber-500/20 text-amber-300 transition-colors cursor-pointer"
                            title="Edit Kuis Ini"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteDeck(deck, e)}
                            className="p-2 rounded-xl bg-white/10 hover:bg-red-500/20 text-red-400 transition-colors cursor-pointer"
                            title="Hapus Kuis Ini"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>

                    {/* Tombol Muat Kuis */}
                    {locked ? (
                      <button
                        type="button"
                        onClick={() => handleBuyDeck(deck)}
                        className="px-4 py-2 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/25 cursor-pointer active:scale-95 transition-all"
                        title="Tambahkan deck ini ke keranjang"
                      >
                        <Lock className="w-3.5 h-3.5" />
                        <span>Beli Rp{(deck.price || 3000).toLocaleString('id-ID')}</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onPlayDeck(deck)}
                        className="px-4 py-2 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs flex items-center gap-1.5 shadow-md shadow-red-600/25 cursor-pointer active:scale-95 transition-all"
                        title="Muat kuis ini ke sesi Mainkan Kuis"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>Muat Kuis</span>
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Jendela Pratinjau Bersih: Tanpa Bocoran Kunci Jawaban & Penjelasan */}
      {deckToView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[85vh] bg-[#14213D] border border-white/15 rounded-3xl p-6 shadow-2xl flex flex-col space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-lg font-black text-white">{deckToView.title}</h3>
                <p className="text-xs text-gray-400">Pratinjau Kuis • {deckToView.cardCount} Kartu Pertanyaan</p>
              </div>
              <button onClick={() => setDeckToView(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1 text-xs">
              {(deckToView.questions || []).slice(0, canAccess(deckToView) ? undefined : 3).map((q, qIdx) => (
                <div key={q.id || qIdx} className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-[#FC1212]">Soal #{qIdx + 1}</span>
                    {q.category && <span className="text-[10px] text-gray-400 font-mono">{q.category}</span>}
                  </div>
                  <p className="text-white font-medium text-sm leading-relaxed">{q.question}</p>

                  {/* Pilihan Jawaban Tampil Netral Tanpa Warna Hijau / Kunci Jawaban */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {(q.options || []).map((opt, oIdx) => (
                      <div
                        key={oIdx}
                        className="p-2.5 rounded-xl border border-white/10 bg-black/50 text-gray-300 text-xs flex items-center gap-2"
                      >
                        <span className="w-5 h-5 rounded-md bg-white/5 text-gray-400 flex items-center justify-center font-bold text-[10px] shrink-0">
                          {String.fromCharCode(65 + oIdx)}
                        </span>
                        <span>{opt}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {!canAccess(deckToView) && (
              <p className="text-[11px] text-amber-300 text-center">
                Menampilkan 3 dari {deckToView.cardCount} soal. Beli deck ini untuk memainkan semuanya.
              </p>
            )}
            <div className="flex justify-between items-center pt-3 border-t border-white/10">
              <button
                type="button"
                onClick={() => setDeckToView(null)}
                className="px-4 py-2 rounded-xl bg-white/10 text-white font-bold text-xs cursor-pointer"
              >
                Tutup Pratinjau
              </button>
              {canAccess(deckToView) ? (
                <button
                  type="button"
                  onClick={() => {
                    const target = deckToView;
                    setDeckToView(null);
                    onPlayDeck(target);
                  }}
                  className="px-5 py-2 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs cursor-pointer flex items-center gap-1.5 shadow"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                  <span>Muat Kuis</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const target = deckToView;
                    setDeckToView(null);
                    handleBuyDeck(target);
                  }}
                  className="px-5 py-2 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-xs cursor-pointer flex items-center gap-1.5 shadow"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Beli Rp{(deckToView.price || 3000).toLocaleString('id-ID')}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal Quiz Editor */}
      <QuizEditor
        isOpen={isEditorOpen}
        topics={allTopics}
        onClose={() => {
          setIsEditorOpen(false);
          setDeckToEdit(null);
        }}
        editingDeck={deckToEdit}
        onDeckCreatedOrUpdated={onDeckCreatedOrUpdated}
        onTopicCreatedOrUpdated={onTopicCreatedOrUpdated}
        onSuccessToast={onSuccessToast}
      />

      {/* Dialog Kunci Pembelian */}
      {isLockedPromptOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#14213D] border border-[#FC1212]/40 rounded-3xl p-6 text-center space-y-4 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-[#FC1212]/20 border border-[#FC1212]/40 text-[#FC1212] mx-auto flex items-center justify-center">
              <Lock className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-lg font-black text-white">Kreator Deck &amp; Topik Terkunci</h3>
              <p className="text-xs text-gray-300 mt-1 leading-relaxed">
                Buka akses permanen Studio Kreator Kuis untuk menyusun bank soal sendiri: 12 tema admin baku, kustom topik, hingga 100 butir soal, lampiran multimedia, pembobotan poin dinamis, dan penalti nilai minus.
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-black/50 border border-white/10 flex justify-between items-center text-xs">
              <span className="text-gray-400">Lisensi Pembuat Kuis Mandiri:</span>
              <span className="text-sm font-black text-[#FC1212] font-mono">Rp 25.000</span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsLockedPromptOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 text-gray-300 text-xs font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleBuyCreator}
                className="flex-1 py-2.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white text-xs font-black shadow-lg shadow-red-600/20 cursor-pointer"
              >
                Beli Lisensi Sekarang
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};