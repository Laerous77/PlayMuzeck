// src/App.tsx
import React, { useState, useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Header, QuizSegment } from './components/Header';
import { IndexView } from './components/IndexView';
import { AudioStudioView } from './components/AudioStudio/AudioStudioView';
import { QuizIndex } from './components/PusatKuis/QuizIndex';
import { QuizPlayer } from './components/PusatKuis/QuizPlayer';
import { CartDrawer } from './components/Modals/CartDrawer';
import { AuthModal } from './components/Modals/AuthModal';
import { CustomAudioModal } from './components/Modals/CustomAudioModal';
import { ProfileDashboardModal } from './components/Modals/ProfileDashboardModal';
import { DestinationModal } from './components/Modals/DestinationModal';
import { Toast } from './components/Toast';
import { AppMode, CartItem, AudioEntitlements, UserSession, Deck, Topic, AudioTrackItem } from './types';
import { storage } from './services/storage';
import { audioEngine } from './services/audioEngine';
import { loadCmsContent, mergeWithLocalCustom, SiteSettings } from './services/cms';
import { submitUser } from './services/analytics';
import { isUserAdmin } from './services/adminConfig';
import { clearAdminToken, elevateToAdminViaSession } from './admin/adminApi';
import { fetchUserCollectionsFromDB } from './services/userCollections';
import { cartKeyOf, findCartConflict } from './services/cartRules';
import { removeDeckFromJsonStore } from './services/quizJsonStore';
import { notifyUserScopeChanged } from './services/userScope';
import { isBuiltinDeckId } from './data/quiz';
import { installAuthFetch, clearUserToken, getUserToken, AUTH_EXPIRED_EVENT } from './services/authToken';
import { RotateCcw, ShieldCheck, AlertTriangle } from 'lucide-react';

installAuthFetch(); // semua request /api/user/* otomatis membawa token sesi

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('PlayMuzeck Crash Log:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white p-6 flex flex-col items-center justify-center text-center">
          <div className="max-w-xl w-full bg-red-950/40 border border-red-500/30 rounded-3xl p-6 sm:p-8 space-y-4 shadow-2xl">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
            <h2 className="text-xl font-black text-white">Terjadi Kendala Komponen Klien</h2>
            <p className="text-xs text-gray-400">
              React mendeteksi error pada salah satu komponen. Salin pesan di bawah untuk pengecekan:
            </p>
            <div className="bg-black/80 p-3.5 rounded-xl border border-white/10 text-left overflow-auto max-h-48 text-xs font-mono text-red-300">
              {this.state.error?.message || 'Unknown render error'}
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('muzeck_session');
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-xs cursor-pointer"
              >
                Reset Sesi & Muat Ulang
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-200 font-bold text-xs cursor-pointer"
              >
                Bersihkan Seluruh Cache
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function MainApp() {
  const [userSession, setUserSession] = useState<UserSession>(() => {
    try {
      const s = storage.getUserSession();
      if (s && typeof s === 'object' && typeof s.isLoggedIn !== 'undefined') {
        return s;
      }
    } catch {}
    return { isLoggedIn: false, name: 'Tamu PlayMuzeck', email: '' };
  });

  const [currentMode, setCurrentMode] = useState<AppMode | 'index'>(() => {
    try {
      const s = storage.getUserSession();
      return s?.isLoggedIn ? 'audio' : 'index';
    } catch {
      return 'index';
    }
  });

  const [activeAudioSection, setActiveAudioSection] = useState<'assets' | 'pad' | 'tools' | 'pricing'>('assets');
  const [activeQuizSection, setActiveQuizSection] = useState<QuizSegment>('all');
  const [cartItems, setCartItems] = useState<CartItem[]>(() => {
    try {
      return storage.getCart() || [];
    } catch {
      return [];
    }
  });

  const [isDestinationModalOpen, setIsDestinationModalOpen] = useState(false);

  const [entitlements, setEntitlements] = useState<AudioEntitlements>(() => {
    try {
      const current: any = storage.getEntitlements() || { byTrack: {} };
      const byTrack: Record<string, any> = current.byTrack || {};
      let modified = false;

      Object.keys(byTrack).forEach((tId) => {
        const t = byTrack[tId] || {};
        if (t.fullMaster && t.separatedStems && !t.audioToolsSuite) {
          t.audioToolsSuite = true;
          modified = true;
        }
      });

      if (current.fullEditor8Bar && !current.audioToolsSuite) {
        current.audioToolsSuite = true;
        modified = true;
      }

      if (modified) {
        storage.setEntitlements(current as AudioEntitlements);
      }
      return current as AudioEntitlements;
    } catch {
      return { byTrack: {} } as AudioEntitlements;
    }
  });

  const [unlockedDeckIds, setUnlockedDeckIds] = useState<string[]>(() => {
    try {
      return storage.getUnlockedDecks() || ['deck-starter-1', 'deck-starter-2', 'deck-starter-3'];
    } catch {
      return ['deck-starter-1', 'deck-starter-2', 'deck-starter-3'];
    }
  });

  const [unlockedTopicIds, setUnlockedTopicIds] = useState<string[]>(() => {
    try {
      return storage.getUnlockedTopics() || [];
    } catch {
      return [];
    }
  });

  const [userChoiceClaimed, setUserChoiceClaimed] = useState<boolean>(() => {
    try {
      return Boolean(storage.getUserChoiceClaimed());
    } catch {
      return false;
    }
  });

  const [decks, setDecks] = useState<Deck[]>(() => {
    try {
      return storage.getAllDecks() || [];
    } catch {
      return [];
    }
  });

  const [topics, setTopics] = useState<Topic[]>(() => {
    try {
      return storage.getAllTopics() || [];
    } catch {
      return [];
    }
  });

  const [catalog, setCatalog] = useState<AudioTrackItem[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings>({
    siteName: 'PlayMuzeck',
    tagline: 'Audio & Trivia Arena',
    accentAudio: '#FCA311',
    accentQuiz: '#FC1212',
    themeId: 'oxford-amber',
    footerNote: 'Platform Audio Interaktif & Pusat Kuis',
  });

  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProfileDashboardOpen, setIsProfileDashboardOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isCustomAudioOpen, setIsCustomAudioOpen] = useState(false);
  const [deckToPlay, setDeckToPlay] = useState<Deck | null>(null);

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3500);
  };

  useEffect(() => {
    if (!userSession?.isLoggedIn && currentMode !== 'index') {
      setCurrentMode('index');
    }
  }, [userSession?.isLoggedIn, currentMode]);

  // Tautan reset kata sandi dari email berbentuk /?resetToken=<token>. Kalau
  // ditemukan, buka langsung form "Atur Ulang Kata Sandi" di AuthModal, lalu
  // bersihkan query string dari URL supaya token tidak tertinggal di riwayat
  // browser / bisa dipakai ulang tanpa sengaja (mis. tombol back, share link).
  const [resetToken, setResetToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('resetToken');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (resetToken) {
      setIsAuthOpen(true);
      const url = new URL(window.location.href);
      url.searchParams.delete('resetToken');
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      storage.setCart(cartItems);
    } catch {}
  }, [cartItems]);

  useEffect(() => {
    try {
      storage.setEntitlements(entitlements);
    } catch {}
  }, [entitlements]);

  useEffect(() => {
    try {
      storage.setUnlockedDecks(unlockedDeckIds);
    } catch {}
  }, [unlockedDeckIds]);

  useEffect(() => {
    try {
      if (typeof storage.setUnlockedTopics === 'function') {
        storage.setUnlockedTopics(unlockedTopicIds);
      }
    } catch {}
  }, [unlockedTopicIds]);

  useEffect(() => {
    try {
      storage.setUserSession(userSession);
    } catch {}
  }, [userSession]);

  useEffect(() => {
    try {
      storage.setUserChoiceClaimed(userChoiceClaimed);
    } catch {}
  }, [userChoiceClaimed]);

  // ==== PENYEBAB UTAMA BUG "KUIS AKUN A MUNCUL DI AKUN B" ====
  // state `decks`/`topics`/`unlocked*`/`entitlements` dibaca dari localStorage
  // HANYA SEKALI saat komponen pertama kali dibuat. Saat user logout lalu
  // login sebagai akun lain TANPA reload, state di memori masih berisi kuis
  // kustom akun sebelumnya (walau localStorage sudah di-scope per akun).
  // Efek ini memuat ulang semuanya setiap kali identitas akun berubah.
  const emailRef = useRef<string>(
    userSession?.isLoggedIn ? String(userSession.email || '').trim().toLowerCase() : ''
  );
  const scopeInitRef = useRef(true);
  // Daftar deck RESMI (tanpa kuis kustom siapa pun). Dipakai membangun ulang `decks`
  // saat ganti akun tanpa bergantung pada penanda badge/id yang tidak konsisten.
  const officialDecksRef = useRef<Deck[]>((() => {
    try {
      const mine = new Set(storage.getCustomDecks().map((d) => d.id));
      return storage.getAllDecks().filter((d) => !mine.has(d.id));
    } catch { return []; }
  })());
  const customTopicIdsRef = useRef<string[]>((() => {
    try { return storage.getCustomTopics().map((t) => t.id); } catch { return []; }
  })());

  useEffect(() => {
    emailRef.current = userSession?.isLoggedIn ? String(userSession.email || '').trim().toLowerCase() : '';
    if (scopeInitRef.current) {
      scopeInitRef.current = false;
      return;
    }
    try {
      {
        const official = officialDecksRef.current;
        const ids = new Set(official.map((d) => d.id));
        setDecks([...official, ...storage.getCustomDecks().filter((d) => !ids.has(d.id))]);
      }
      setTopics((prev) => {
        const stale = new Set(customTopicIdsRef.current);
        const keep = (prev || []).filter((t) => !stale.has(t.id));
        const mine = storage.getCustomTopics();
        customTopicIdsRef.current = mine.map((t) => t.id);
        const ids = new Set(keep.map((t) => t.id));
        return [...keep, ...mine.filter((t) => !ids.has(t.id))];
      });
      const e: any = storage.getEntitlements();
      setEntitlements((e && e.byTrack ? e : { byTrack: {} }) as AudioEntitlements);
      setUnlockedDeckIds(storage.getUnlockedDecks());
      setUnlockedTopicIds(storage.getUnlockedTopics());
      setUserChoiceClaimed(storage.getUserChoiceClaimed());
    } catch {}
    notifyUserScopeChanged();
  }, [userSession?.isLoggedIn, userSession?.email]);

  useEffect(() => {
    loadCmsContent()
      .then(({ catalog: remoteCatalog, topics: remoteTopics, decks: remoteDecks, settings }) => {
        if (remoteDecks) officialDecksRef.current = remoteDecks;
        const merged = mergeWithLocalCustom(remoteTopics, remoteDecks);
        if (remoteCatalog && remoteCatalog.length > 0) setCatalog(remoteCatalog);
        if (merged.topics) setTopics(merged.topics);
        if (merged.decks) setDecks(merged.decks);
        if (settings) {
          setSiteSettings({
            ...settings,
            siteName: settings.siteName === 'Muzeck' ? 'PlayMuzeck' : (settings.siteName || 'PlayMuzeck'),
          });
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      showToast('Koneksi internet terhubung kembali.');
    };
    const handleOffline = () => {
      setIsOnline(false);
      showToast('Mode Offline aktif: Anda dapat tetap memainkan semua kuis tersimpan.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstallPwa = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('PlayMuzeck berhasil diinstal sebagai aplikasi PWA!');
      }
      setDeferredPrompt(null);
    } else {
      showToast('Gunakan opsi browser Anda untuk "Tambahkan ke Layar Utama".');
    }
  };

  // Sumber kebenaran ASLI untuk status kepemilikan: tabel user_collections di
  // PostgreSQL, bukan localStorage. Dipanggil saat login & setelah checkout
  // benar-benar dikonfirmasi tersimpan di server (bukan cuma optimistic UI).
  const refreshEntitlementsFromDB = async (email?: string) => {
    if (!email) return;
    const emailKey = email.trim().toLowerCase();
    try {
      const dbData = await fetchUserCollectionsFromDB(email);
      // Balapan: bila user sudah logout / ganti akun selama request berjalan,
      // JANGAN menulis data akun lama ke state akun yang sekarang aktif.
      if (emailRef.current !== emailKey) return;
      const byTrack: Record<string, any> = {};
      (dbData.audio?.items || []).forEach(({ track, ownership }) => {
        byTrack[String(track.id)] = {
          fullMaster: Boolean(ownership.fullMaster),
          loopVersion: Boolean(ownership.loopVersion),
          separatedStems: Boolean(ownership.separatedStems),
          sheetMusic: Boolean(ownership.sheetMusic),
        };
      });
      const updated: AudioEntitlements = {
        fullEditor8Bar: Boolean(dbData.features?.full16BarEditor),
        audioToolsSuite: Boolean(dbData.features?.audioToolsSuite),
        byTrack,
      } as any;
      setEntitlements(updated);
      storage.setEntitlements(updated);

      // Status "Kreator Deck & Topik" kini mengikuti DATABASE (bukan hanya
      // penanda localStorage yang sebelumnya bisa tidak pernah terpasang, atau
      // malah tertinggal dari akun lain di perangkat yang sama).
      // Kunci ini HARUS per-email (huruf kecil) karena begitulah QuizLibrary
      // membacanya: `muzeck_quiz_creator_unlocked_<email>`. Versi sebelumnya
      // menulis kunci tanpa email sehingga modal tetap "Terkunci".
      try {
        const scopedKey = `muzeck_quiz_creator_unlocked_${email.trim().toLowerCase()}`;
        if (dbData.features?.quizEditor) localStorage.setItem(scopedKey, 'true');
        else localStorage.removeItem(scopedKey);
        window.dispatchEvent(new Event('muzeck-quiz-purchases-changed')); // memicu QuizLibrary menghitung ulang
      } catch {}

      // PERBAIKAN INKONSISTENSI UTAMA: sebelumnya unlockedDeckIds &
      // unlockedTopicIds HANYA di-update secara optimistik dari isi
      // keranjang saat checkout (handleCheckoutSuccess), lalu disimpan ke
      // localStorage — tidak pernah disinkronkan ulang dari database yang
      // sesungguhnya (dbData.quiz.deckIds / topicIds). Akibatnya status
      // "Dimiliki" di Perpustakaan Kuis (QuizLibrary, prop unlockedDeckIds)
      // bisa berbeda dari yang tercatat di tab "Koleksi Saya" (yang memang
      // membaca langsung dari database). Sekarang setiap refresh dari
      // database, kedua state ini juga disamakan dengan sumber kebenaran
      // (database), dan digabung (bukan ditimpa) dengan starter deck bawaan
      // supaya tidak ada yang "terkunci lagi" secara keliru.
      const dbDeckIds: string[] = dbData.quiz?.deckIds || [];
      const dbTopicIds: string[] = dbData.quiz?.topicIds || [];
      const STARTER = ['deck-starter-1', 'deck-starter-2', 'deck-starter-3'];
      setUnlockedDeckIds(Array.from(new Set([...STARTER, ...dbDeckIds])));
      setUnlockedTopicIds(dbTopicIds);

      // Kuis kustom milik akun ini yang tersimpan di server (ikut tampil di
      // perangkat lain). Hanya deck yang owner_email-nya benar-benar user ini.
      const mine: Deck[] = ((dbData.quiz as any)?.decks || [])
        .filter((d: any) => d.is_custom && String(d.owner_email || '').trim().toLowerCase() === emailKey)
        .map((d: any) => ({
          id: d.id, topicId: d.topic_id, title: d.title, description: d.description,
          cardCount: d.card_count, difficulty: d.difficulty, isFree: true, price: 0,
          badge: d.badge || 'Kustom Kamu', questions: d.questions || [],
        }) as Deck);
      if (mine.length) {
        setDecks((prev) => {
          const ids = new Set(mine.map((m) => m.id));
          return [...mine, ...(prev || []).filter((d) => !ids.has(d.id))];
        });
      }
    } catch (err) {
      console.error('[Entitlements] Gagal sinkron dari database:', err);
    }
  };

  useEffect(() => {
    if (userSession?.isLoggedIn && userSession?.email) {
      refreshEntitlementsFromDB(userSession.email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSession?.isLoggedIn, userSession?.email]);

  // Salinan keranjang yang selalu terbaru, supaya klik beruntun (double-click)
  // tidak lolos dari pengecekan bentrok sebelum state sempat ter-render.
  const cartRef = useRef<CartItem[]>(cartItems);
  useEffect(() => {
    cartRef.current = cartItems;
  }, [cartItems]);

  const handleAddToCart = (newItems: CartItem[]) => {
    audioEngine.playClickSound();

    const working: CartItem[] = [...(cartRef.current || [])];
    const added: CartItem[] = [];
    const rejectedReasons: string[] = [];

    for (const item of newItems) {
      const conflict = findCartConflict(working, item);
      if (conflict) {
        rejectedReasons.push(conflict);
      } else {
        working.push(item);
        added.push(item);
      }
    }

    if (added.length) {
      cartRef.current = working;
      setCartItems(working);
    }

    // Toast sebelumnya SELALU bilang "N produk berhasil ditambahkan" walau
    // item sebenarnya dibuang sebagai duplikat. Sekarang jujur sesuai hasil.
    if (added.length && !rejectedReasons.length) {
      showToast(`${added.length} produk berhasil ditambahkan ke keranjang.`);
    } else if (added.length) {
      showToast(`${added.length} produk ditambahkan. ${rejectedReasons[0]}`);
    } else if (rejectedReasons.length) {
      showToast(rejectedReasons[0]);
    }
  };

  const handleRemoveItem = (id: string) => {
    setCartItems((prev) => (prev || []).filter((i) => cartKeyOf(i) !== id && i.id !== id));
    audioEngine.playClickSound();
  };

  const handleCheckoutSuccess = () => {
    // CATATAN PENTING: CartDrawer HANYA memanggil onCheckoutSuccess() setelah
    // POST /api/user/checkout benar-benar sukses (res.ok true). Jadi di sini
    // kita TIDAK BOLEH lagi menebak-nebak status kepemilikan dari isi
    // keranjang secara lokal (itu sumber bug "Sudah Dimiliki" palsu yang
    // tidak sinkron dengan Koleksi Saya / database). Sebagai gantinya kita
    // tarik ulang status kepemilikan ASLI dari server.
    const newUnlockedDeckIds = [...unlockedDeckIds];
    const newUnlockedTopicIds = [...unlockedTopicIds];

    (cartItems || []).forEach((item) => {
      if (item.category === 'deck' && item.deckId) {
        if (!newUnlockedDeckIds.includes(item.deckId)) newUnlockedDeckIds.push(item.deckId);
      } else if (item.category === 'topic' && item.topicId) {
        if (!newUnlockedTopicIds.includes(item.topicId)) newUnlockedTopicIds.push(item.topicId);
        (decks || [])
          .filter((d) => d.topicId === item.topicId)
          .forEach((d) => {
            if (!newUnlockedDeckIds.includes(d.id)) newUnlockedDeckIds.push(d.id);
          });
      }
      if (item.itemTypeKey === 'quizCreatorSuite' && userSession?.email) {
        localStorage.setItem(`muzeck_quiz_creator_unlocked_${userSession.email.trim().toLowerCase()}`, 'true');
      }
    });

    setUnlockedDeckIds(newUnlockedDeckIds);
    setUnlockedTopicIds(newUnlockedTopicIds);
    setCartItems([]);
    refreshEntitlementsFromDB(userSession?.email);
    showToast('Pembayaran berhasil! Seluruh item bundle telah aktif.');
  };

  const handleClaimFreeChoice = (deckId: string) => {
    const targetDeck = (decks || []).find((d) => d.id === deckId);
    if (!targetDeck) return;

    audioEngine.playCorrectSound();
    setUnlockedDeckIds((prev) => [...prev, deckId]);
    setUserChoiceClaimed(true);
    showToast(`Deck "${targetDeck.title}" berhasil dibuka secara gratis!`);
  };

  const handleDeckCreatedOrUpdated = (newDeck: Deck) => {
    setDecks((prev) => {
      const copy = [...(prev || [])];
      const idx = copy.findIndex((d) => d.id === newDeck.id);
      if (idx >= 0) {
        copy[idx] = newDeck;
        return copy;
      }
      return [newDeck, ...copy];
    });
    setUnlockedDeckIds((prev) => (prev.includes(newDeck.id) ? prev : [...prev, newDeck.id]));

    // PERBAIKAN: deck kuis buatan sendiri (Quiz Editor, ditandai badge
    // 'Kustom Kamu') sebelumnya HANYA tersimpan di localStorage browser dan
    // tidak pernah masuk ke database — jadi hilang jika ganti perangkat, dan
    // tidak konsisten dengan tab "Koleksi Saya" yang bersumber dari
    // PostgreSQL. Sekarang setiap deck kustom milik user yang sedang login
    // otomatis disinkronkan ke server & dicatat sebagai kepemilikannya.
    // (hanya dipanggil untuk deck buatan user dari Quiz Editor; badge bisa berupa nama tema, bukan 'Kustom Kamu')
    if (userSession?.isLoggedIn && userSession?.email) {
      fetch('/api/user/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userSession.email, deck: newDeck }),
      })
        .then((res) => {
          if (res.ok) {
            refreshEntitlementsFromDB(userSession.email);
          } else {
            showToast('Peringatan: kuis kustommu gagal tersimpan ke database server.');
          }
        })
        .catch(() => {
          showToast('Peringatan: kuis kustommu gagal tersimpan ke database server.');
        });
    }
  };

  const handleTopicCreatedOrUpdated = (newTopic: Topic) => {
    setTopics((prev) => {
      const copy = [...(prev || [])];
      const idx = copy.findIndex((t) => t.id === newTopic.id);
      if (idx >= 0) {
        copy[idx] = newTopic;
        return copy;
      }
      return [...copy, newTopic];
    });
  };

  // Handler Penghapusan Deck
  const handleDeckDeleted = (deckId: string) => {
    setDecks((prev) => prev.filter((d) => d.id !== deckId));
    setUnlockedDeckIds((prev) => prev.filter((id) => id !== deckId));
    // BUG SEBELUMNYA: menulis ke kunci 'muzeck_custom_decks' yang tidak pernah
    // dipakai (kunci asli: muzeck_custom_decks_v1::<email> dan JSON store), jadi
    // kuis yang dihapus muncul lagi setelah refresh.
    try {
      storage.deleteCustomDeck(deckId);
      removeDeckFromJsonStore(deckId);
    } catch {}
  };

  // Handler Penghapusan Topik
  const handleTopicDeleted = (topicId: string) => {
    setTopics((prev) => prev.filter((t) => t.id !== topicId && t.title.toLowerCase() !== topicId.toLowerCase()));
    try {
      storage.deleteCustomTopic(topicId);
    } catch {}
  };

  const handleLogin = (email: string, name: string) => {
    const adminStatus = isUserAdmin(email);
    const session: UserSession = {
      isLoggedIn: true,
      email,
      name,
    };
    (session as any).isAdmin = adminStatus;

    setUserSession(session);
    try {
      storage.setUserSession(session);
    } catch {}
    audioEngine.playCorrectSound();
    submitUser({ email, name }).then((ok) => {
      if (!ok) {
        showToast('Peringatan: gagal mendaftarkan akun ke server. Pembelian mungkin gagal tersimpan.');
      } else {
        // Baris user sudah pasti ada di tabel `users` sekarang, aman untuk
        // menarik status kepemilikan (kalau sebelumnya pernah dibeli lewat
        // sesi lain dengan email yang sama).
        refreshEntitlementsFromDB(email);
      }
    });

    if (adminStatus) {
      // Token admin palsu (`admin-google-<email>`) DIHAPUS: token admin sekarang
      // hanya sah bila diterbitkan server lewat /api/admin/login (kata sandi admin).
      showToast(`Salam hormat Admin Utama (${email})!`);
    } else {
      showToast(`Selamat datang kembali, ${name}!`);
    }

    setIsDestinationModalOpen(true);
  };

  const handleLogout = () => {
    const defaultSession: UserSession = { isLoggedIn: false, name: 'Tamu PlayMuzeck', email: '' };
    setUserSession(defaultSession);
    try {
      storage.setUserSession(defaultSession);
      clearAdminToken();
      clearUserToken();
    } catch {}

    // WAJIB: reset semua state turunan localStorage global, supaya akun
    // berikutnya yang login di browser ini TIDAK mewarisi data akun sebelumnya.
    const STARTER = ['deck-starter-1', 'deck-starter-2', 'deck-starter-3'];
    storage.setUnlockedDecks(STARTER);
    storage.setUnlockedTopics([]);
    setUnlockedDeckIds(STARTER);
    setUnlockedTopicIds([]);
    setEntitlements({ byTrack: {} } as AudioEntitlements);
    storage.setEntitlements({ byTrack: {} } as AudioEntitlements);
    emailRef.current = ''; // batalkan refresh server yang masih berjalan untuk akun lama
    setCartItems([]); // keranjang bersifat global per-perangkat: jangan diwariskan ke akun berikutnya
    setUserChoiceClaimed(false);

    setCurrentMode('index');
    audioEngine.playClickSound();
    showToast('Anda telah keluar dari akun.');
  };

  // Sesi kedaluwarsa / token hilang (mis. sesi lama sebelum sistem token ada) -> paksa login ulang.
  const logoutRef = useRef<() => void>(() => {});
  logoutRef.current = handleLogout;
  useEffect(() => {
    const expire = () => {
      if (!emailRef.current) return;
      logoutRef.current();
      showToast('Sesi login berakhir. Silakan masuk kembali.');
    };
    if (userSession?.isLoggedIn && !getUserToken()) expire();
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expire);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset Demo yang sudah bersih dari pemanggilan Hook ilegal
  const handleResetDemo = () => {
    try {
      storage.resetAllData();
      setCartItems([]);
      setEntitlements(storage.getEntitlements());
      setUnlockedDeckIds(['deck-starter-1', 'deck-starter-2', 'deck-starter-3']);
      setUnlockedTopicIds([]);
      setDecks(storage.getAllDecks());
      setTopics(storage.getAllTopics());
      const guestSession = { isLoggedIn: false, name: 'Tamu PlayMuzeck', email: '' };
      setUserSession(guestSession);
      storage.setUserSession(guestSession);
      setUserChoiceClaimed(false);
      setCurrentMode('index');

      loadCmsContent()
        .then(({ catalog: remoteCatalog, topics: remoteTopics, decks: remoteDecks, settings }) => {
          if (remoteDecks) officialDecksRef.current = remoteDecks;
          const merged = mergeWithLocalCustom(remoteTopics, remoteDecks);
          if (remoteCatalog && remoteCatalog.length > 0) setCatalog(remoteCatalog);
          if (merged.topics) setTopics(merged.topics);
          if (merged.decks) setDecks(merged.decks);
          if (settings) {
            setSiteSettings({
              ...settings,
              siteName: settings.siteName === 'Muzeck' ? 'PlayMuzeck' : (settings.siteName || 'PlayMuzeck'),
            });
          }
        })
        .catch(() => {});

      showToast('Semua data simulasi berhasil direset ke kondisi awal.');
    } catch {
      window.location.reload();
    }
  };

  // Hanya dua jenis deck yang boleh tampil: deck bawaan resmi (data/quiz: 3 gratis + sisanya berbayar)
  // dan kuis buatan akun ini. Deck lain (sisa data contoh mockData / seed database lama) dibuang,
  // karena sebelumnya semua deck non-bawaan otomatis dianggap GRATIS.
  const visibleDecks = useMemo(() => {
    let mine = new Set<string>();
    try { mine = new Set(storage.getCustomDecks().map((d) => d.id)); } catch {}
    return (decks || []).filter(
      (d) => isBuiltinDeckId(d.id) || String(d.id).startsWith('deck-custom-') || mine.has(d.id)
    );
  }, [decks, userSession?.email, userSession?.isLoggedIn]);

  const unlockedDecksList = visibleDecks.filter(
    (d) => d.isFree || (unlockedDeckIds || []).includes(d.id)
  );

  const isAdmin = Boolean(userSession?.email && isUserAdmin(userSession.email));

  return (
    <div className="min-h-screen bg-[#000000] text-[#E5E5E5] flex flex-col selection:bg-[#FCA311] selection:text-black">
      <Header
        currentMode={currentMode}
        onModeChange={(mode) => {
          if (!userSession?.isLoggedIn) {
            setIsAuthOpen(true);
            return;
          }
          audioEngine.playClickSound();
          setCurrentMode(mode);
        }}
        onNavigateIndex={() => {
          audioEngine.playClickSound();
          setCurrentMode('index');
        }}
        activeAudioSection={activeAudioSection}
        onSelectAudioSection={(sec) => {
          setActiveAudioSection(sec);
        }}
        activeQuizSection={activeQuizSection}
        onSelectQuizSection={(sec) => {
          setActiveQuizSection(sec);
        }}
        cartItems={cartItems || []}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenProfileDashboard={() => setIsProfileDashboardOpen(true)}
        userSession={userSession}
        entitlements={entitlements}
        unlockedDecksCount={(unlockedDeckIds || []).length}
        siteName={siteSettings.siteName}
        tagline={siteSettings.tagline}
        accentAudio={siteSettings.accentAudio}
        accentQuiz={siteSettings.accentQuiz}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-6">
        <AnimatePresence mode="wait">
          {currentMode === 'index' ? (
            <motion.div
              key="mode-index"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              <IndexView
                onNavigateAudio={() => {
                  if (!userSession?.isLoggedIn) {
                    setIsAuthOpen(true);
                    return;
                  }
                  setCurrentMode('audio');
                }}
                onNavigateQuiz={() => {
                  if (!userSession?.isLoggedIn) {
                    setIsAuthOpen(true);
                    return;
                  }
                  setCurrentMode('quiz');
                }}
                onOpenProfile={() => setIsProfileDashboardOpen(true)}
              />
            </motion.div>
          ) : currentMode === 'audio' ? (
            <motion.div
              key="mode-audio"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              <AudioStudioView
                cartItems={cartItems}
                tracks={catalog}
                entitlements={entitlements}
                activeSection={activeAudioSection}
                onSectionChange={setActiveAudioSection}
                onRequestCustom={() => setIsCustomAudioOpen(true)}
                onAddToCart={handleAddToCart}
                onOpenCart={() => setIsCartOpen(true)}
                onSuccessToast={showToast}
              />
            </motion.div>
          ) : (
            <motion.div
              key="mode-quiz"
              initial={{ opacity: 0, y: 15 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -15 }}
              transition={{ duration: 0.25 }}
            >
              <QuizIndex
                decks={visibleDecks}
                topics={topics}
                unlockedDeckIds={unlockedDeckIds}
                unlockedTopicIds={unlockedTopicIds}
                userChoiceClaimed={userChoiceClaimed}
                isOnline={isOnline}
                userNickname={userSession?.name}
                activeSection={activeQuizSection}
                onSectionChange={setActiveQuizSection}
                onClaimFreeChoice={handleClaimFreeChoice}
                onAddToCart={handleAddToCart}
                onOpenCart={() => setIsCartOpen(true)}
                onDeckCreatedOrUpdated={handleDeckCreatedOrUpdated}
                onTopicCreatedOrUpdated={handleTopicCreatedOrUpdated}
                onDeckDeleted={handleDeckDeleted}
                onTopicDeleted={handleTopicDeleted}
                onSuccessToast={showToast}
                canInstallPwa={Boolean(deferredPrompt)}
                onInstallPwa={handleInstallPwa}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="w-full bg-[#14213D]/40 border-t border-white/[0.08] py-8 px-4 sm:px-8 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-gray-400">
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-white text-sm tracking-tight">
              {siteSettings.siteName}<span className="text-[#FCA311]">.</span>
            </span>
            <span>— {siteSettings.footerNote}</span>
          </div>

          <div className="flex items-center gap-4 flex-wrap justify-center">
            <span className="flex items-center gap-1 text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" /> Client-Side Offline First
            </span>
            {isAdmin && (
              <a href="/admin" className="text-[#FCA311] font-bold hover:underline">
                Developer Console ⚙️
              </a>
            )}
            <button
              type="button"
              onClick={() => setCurrentMode('index')}
              className="text-gray-400 hover:text-[#FCA311] transition-colors cursor-pointer"
            >
              Halaman Utama
            </button>
            <button
              type="button"
              onClick={handleResetDemo}
              className="flex items-center gap-1 text-gray-400 hover:text-[#FCA311] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Data Demo</span>
            </button>
          </div>
        </div>
      </footer>

      {/* Modal Pemilih Destinasi Pasca-Login */}
      <DestinationModal
        isOpen={isDestinationModalOpen}
        onClose={() => setIsDestinationModalOpen(false)}
        userName={userSession?.name || 'Maestro'}
        isAdmin={Boolean(isAdmin)}
        onSelectDestination={(dest) => {
          setIsDestinationModalOpen(false);
          if (dest === 'admin') {
            // PERBAIKAN KRITIS: sebelumnya kode ini membuat token admin palsu
            // (`admin-google-<email>`) langsung di browser lalu redirect ke
            // /admin — server tidak pernah memverifikasi apa pun, jadi token
            // itu selalu ditolak (401) dan halaman admin gagal memuat data.
            // Sekarang kita memakai token sesi ASLI yang sudah ditandatangani
            // server (dari login/daftar/Google/demo) untuk membuktikan email
            // ini betul-betul sedang login, lalu server yang mengecek daftar
            // admin & menerbitkan token admin sungguhan sebelum redirect.
            const userToken = getUserToken();
            if (!userToken) {
              showToast('Sesi login tidak ditemukan. Silakan masuk ulang.');
              return;
            }
            elevateToAdminViaSession(userToken)
              .then(() => {
                window.location.href = '/admin';
              })
              .catch((err) => {
                showToast(err instanceof Error ? err.message : 'Akun ini bukan Administrator terdaftar.');
              });
          } else if (dest === 'audio') {
            setCurrentMode('audio');
          } else if (dest === 'quiz') {
            setCurrentMode('quiz');
          } else {
            setCurrentMode('index');
          }
        }}
      />

      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cartItems={cartItems || []}
        onRemoveItem={handleRemoveItem}
        onCheckoutSuccess={handleCheckoutSuccess}
        onOpenLibrary={() => setIsProfileDashboardOpen(true)}
        onSuccessToast={showToast}
      />

      <ProfileDashboardModal
        isOpen={isProfileDashboardOpen}
        onClose={() => setIsProfileDashboardOpen(false)}
        userSession={userSession}
        catalogTracks={catalog}
        onPlayDeck={(deck) => {
          setIsProfileDashboardOpen(false);
          setDeckToPlay(deck);
          setCurrentMode('quiz');
        }}
        onNavigateAudio={() => {
          setIsProfileDashboardOpen(false);
          setCurrentMode('audio');
        }}
        onLoginRequest={() => {
          setIsProfileDashboardOpen(false);
          setIsAuthOpen(true);
        }}
        onLogout={handleLogout}
        onUpdateProfile={(updated) => {
          // Email TIDAK boleh diganti lewat form profil: server memakai email sesi sebagai identitas,
          // jadi mengubahnya = mengambil alih akun orang lain.
          const { email: _ignoredEmail, ...safeUpdate } = updated;
          const newSession = { ...userSession, ...safeUpdate };
          setUserSession(newSession);
          try {
            storage.setUserSession(newSession);
          } catch {}
          showToast('Profil Anda berhasil diperbarui!');
        }}
        onSuccessToast={showToast}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => {
          setIsAuthOpen(false);
          setResetToken(null);
        }}
        userSession={userSession}
        onLogin={handleLogin}
        onLogout={handleLogout}
        initialResetToken={resetToken || undefined}
      />

      <CustomAudioModal
        isOpen={isCustomAudioOpen}
        onClose={() => setIsCustomAudioOpen(false)}
        userEmail={userSession?.email}
      />

      {deckToPlay && (
        <QuizPlayer
          deck={deckToPlay}
          onClose={() => setDeckToPlay(null)}
        />
      )}

      <Toast message={toastMessage} onClose={() => setToastMessage(null)} />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}