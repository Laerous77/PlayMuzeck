// src/App.tsx
import React, { useState, useEffect, useRef, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Header } from './components/Header';
import { type QuizSegment } from './components/PusatKuis/quizSegments';
import {
  parseRoute,
  buildPath,
  isAliasRoute,
  resolveAudioSection,
  resolveQuizSegment,
  type AudioSection,
  type RouteMode,
} from './services/routes';
import { IndexView } from './components/IndexView';
import { AudioStudioView } from './components/AudioStudio/AudioStudioView';
import { QuizIndex } from './components/PusatKuis/QuizIndex';
import { QuizPlayer } from './components/PusatKuis/QuizPlayer';
import { CartDrawer } from './components/Modals/CartDrawer';
import { AuthModal, announceAccountDeletion } from './components/Modals/AuthModal';
import { CustomAudioModal } from './components/Modals/CustomAudioModal';
import { ProfileDashboardModal } from './components/Modals/ProfileDashboardModal';
import { DestinationModal } from './components/Modals/DestinationModal';
import { Toast } from './components/Toast';
import { ThemeProvider } from './theme/ThemeContext';
import { AppMode, CartItem, AudioEntitlements, UserSession, Deck, Topic, AudioTrackItem } from './types';
import { storage } from './services/storage';
import { audioEngine } from './services/audioEngine';
import { setSfxSection, loadSfxForUser, needsSoundBank, subscribeSfx } from './services/sfxSettings';
import { loadCmsContent, mergeWithLocalCustom, SiteSettings } from './services/cms';
import { submitUser } from './services/analytics';
import { isUserAdmin } from './services/adminConfig';
import { clearAdminToken, elevateToAdminViaSession } from './admin/adminApi';
import { fetchUserCollectionsFromDB } from './services/userCollections';
import { cartKeyOf, findCartConflict } from './services/cartRules';
import { removeDeckFromJsonStore } from './services/quizJsonStore';
import { notifyUserScopeChanged } from './services/userScope';
import { isBuiltinDeckId } from './data/quiz';
import { installAuthFetch, clearUserToken, authApi, AUTH_EXPIRED_EVENT } from './services/authToken';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { CookieConsent } from './components/CookieConsent';

installAuthFetch(); // semua request /api/* otomatis membawa cookie sesi httpOnly

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
        <div className="min-h-dvh bg-black text-white p-4 sm:p-6 flex flex-col items-center justify-center text-center">
          <div className="max-w-xl w-full bg-red-950/40 border border-red-500/30 rounded-3xl p-6 sm:p-8 space-y-4 shadow-2xl">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto" />
            <h2 className="text-xl font-black text-white">Terjadi Kendala Komponen Klien</h2>
            <p className="text-xs text-gray-400">
              React mendeteksi error pada salah satu komponen. Salin pesan di bawah untuk pengecekan:
            </p>
            <div className="bg-black/80 p-3.5 rounded-xl border border-white/10 text-left overflow-auto max-h-48 text-xs font-mono text-red-300">
              {this.state.error?.message || 'Unknown render error'}
            </div>
            <div className="flex flex-col min-[400px]:flex-row gap-2 justify-center pt-2">
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

// Posisi terakhir pengguna disimpan di localStorage. URL (/audio/..., /quiz/...) adalah sumber utama halaman yang
// dibuka; nilai tersimpan dipakai saat pengguna membuka /audio atau /quiz polos (dialihkan ke bagian terakhir yang
// dibuka; bila belum ada: /audio/tools dan /quiz/library).
const NAV_KEY = 'muzeck_last_nav';
type SavedNav = { mode?: string; audio?: string; quiz?: string };
function readSavedNav(): SavedNav {
  try {
    const raw = localStorage.getItem(NAV_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// Halaman awal yang dituju URL saat aplikasi pertama dimuat. Bagian yang tidak disebut di URL diambil dari posisi
// terakhir yang tersimpan. Tautan lama /alat-audio[/<slug>] dari halaman SEO membuka Audio Tools.
function readInitialRoute(): { mode: RouteMode; audio: AudioSection; quiz: QuizSegment } {
  const saved = readSavedNav();
  let mode: RouteMode = 'index';
  let audio = resolveAudioSection(saved.audio);
  let quiz = resolveQuizSegment(saved.quiz);
  try {
    const r = parseRoute(window.location.pathname);
    if (r.kind === 'audio') {
      mode = 'audio';
      if (r.section) audio = r.section;
    } else if (r.kind === 'legacy-tools') {
      mode = 'audio';
      audio = 'tools';
    } else if (r.kind === 'quiz') {
      mode = 'quiz';
      if (r.segment) quiz = r.segment;
    }
  } catch {}
  return { mode, audio, quiz };
}

function hasCachedLogin(): boolean {
  try {
    const s = storage.getUserSession();
    return Boolean(s?.isLoggedIn && String(s.email || '').trim());
  } catch {
    return false;
  }
}

function MainApp() {
  const [userSession, setUserSession] = useState<UserSession>(() => {
    try {
      const s = storage.getUserSession();
      // Sesi hanya dipercaya kalau punya email. Sesi "hantu" (isLoggedIn true tapi email kosong)
      // dibuang; sesi asli akan dipulihkan dari server lewat /api/auth/me (cookie httpOnly).
      if (s && typeof s === 'object' && s.isLoggedIn && String(s.email || '').trim()) {
        return s;
      }
    } catch {}
    return { isLoggedIn: false, name: 'Tamu PlayMuzeck', email: '' };
  });

  // Halaman yang dituju URL saat pertama dimuat (/audio/..., /quiz/..., atau tautan lama /alat-audio/...).
  const [initialRoute] = useState(readInitialRoute);
  const [bootCachedLogin] = useState(hasCachedLogin);

  const [currentMode, setCurrentMode] = useState<AppMode | 'index'>(() =>
    bootCachedLogin ? initialRoute.mode : 'index'
  );
  const [activeAudioSection, setActiveAudioSection] = useState<AudioSection>(initialRoute.audio);
  // Nilai lama / tak dikenal (mis. 'leaderboard' sebelum digabung ke Aula Komunitas) sudah dinormalkan di readInitialRoute.
  const [activeQuizSection, setActiveQuizSection] = useState<QuizSegment>(initialRoute.quiz);

  // Tamu yang membuka tautan dalam (/audio/..., /quiz/..., /alat-audio/...) harus masuk dulu. Tujuannya dicatat di sini,
  // URL dibiarkan apa adanya, dan begitu login berhasil pengguna langsung dibawa ke halaman itu.
  const pendingRouteRef = useRef<{ mode: 'audio' | 'quiz' } | null>(
    !bootCachedLogin && initialRoute.mode !== 'index' ? { mode: initialRoute.mode } : null
  );
  const loggedInRef = useRef(userSession.isLoggedIn);
  loggedInRef.current = userSession.isLoggedIn;

  // Tamu kembali ke Halaman Utama lewat logo: lepaskan tujuan tadi dan rapikan URL ke "/".
  // (Sengaja tidak dipanggil saat form login ditutup: AuthModal memanggil onLogin lalu onClose pada login sukses.)
  const dropPendingRoute = () => {
    if (!pendingRouteRef.current) return;
    pendingRouteRef.current = null;
    try { window.history.replaceState(null, '', '/'); } catch {}
  };

  // Simpan posisi terakhir setiap kali berpindah.
  useEffect(() => {
    try {
      localStorage.setItem(
        NAV_KEY,
        JSON.stringify({ mode: currentMode, audio: activeAudioSection, quiz: activeQuizSection })
      );
    } catch {}
  }, [currentMode, activeAudioSection, activeQuizSection]);

  // ROUTING (1/3): state -> URL. Halaman Utama = "/", Audio Studio = "/audio/<bagian>", Pusat Kuis = "/quiz/<segmen>".
  // Alamat polos ("/audio", "/quiz") dan tautan lama dirapikan dengan replaceState (tidak menambah riwayat);
  // perpindahan biasa memakai pushState supaya tombol Kembali/Maju browser berfungsi.
  // PENTING: efek ini harus dideklarasikan SEBELUM efek "tujuan tamu" di bawah, supaya pada render saat login
  // tujuan itu masih tercatat dan URL tidak sempat tertimpa "/".
  const firstSyncRef = useRef(true);
  useEffect(() => {
    if (pendingRouteRef.current) return;
    let cur;
    try { cur = parseRoute(window.location.pathname); } catch { return; }
    if (cur.kind === 'passthrough') return; // /verify-email, /reset-password: ditangani efek lain di bawah
    const target = buildPath(currentMode, activeAudioSection, activeQuizSection);
    const here = window.location.pathname.replace(/\/+$/, '') || '/';
    if (here === target) {
      firstSyncRef.current = false;
      return;
    }
    const replace = firstSyncRef.current || isAliasRoute(cur) || !userSession.isLoggedIn;
    firstSyncRef.current = false;
    try {
      if (replace) window.history.replaceState(null, '', target + window.location.search + window.location.hash);
      else window.history.pushState(null, '', target);
    } catch {}
  }, [currentMode, activeAudioSection, activeQuizSection, userSession.isLoggedIn]);

  // ROUTING (2/3): tujuan tamu. Setelah login, buka halaman yang tadi dituju sekali saja.
  useEffect(() => {
    const p = pendingRouteRef.current;
    if (!userSession.isLoggedIn || !p) return;
    pendingRouteRef.current = null;
    setCurrentMode(p.mode);
  }, [userSession.isLoggedIn]);

  // ROUTING (3/3): URL -> state, untuk tombol Kembali/Maju browser.
  useEffect(() => {
    const onPop = () => {
      let r;
      try { r = parseRoute(window.location.pathname); } catch { return; }
      if (r.kind === 'passthrough') return;
      if (r.kind === 'index' || r.kind === 'unknown' || !loggedInRef.current) {
        setCurrentMode('index');
        return;
      }
      if (r.kind === 'quiz') {
        if (r.segment) setActiveQuizSection(r.segment);
        setCurrentMode('quiz');
      } else {
        setActiveAudioSection(r.kind === 'audio' ? r.section ?? 'tools' : 'tools');
        setCurrentMode('audio');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Efek suara klik: (1) bagian yang sedang aktif, (2) muat pengaturan akun dari
  // database saat login / ganti akun / logout, (3) preload bank SF2 kalau mode Nada GM.
  useEffect(() => {
    setSfxSection(currentMode === 'audio' ? 'audio' : currentMode === 'quiz' ? 'quiz' : 'other');
  }, [currentMode]);

  useEffect(() => {
    void loadSfxForUser(userSession.isLoggedIn ? userSession.email : null);
  }, [userSession.isLoggedIn, userSession.email]);

  useEffect(() => {
    const preload = () => {
      if (needsSoundBank()) void audioEngine.initBank();
    };
    preload();
    return subscribeSfx(preload);
  }, []);
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
  // Status PWA: sedang berjalan sebagai aplikasi (standalone) atau sudah pernah terinstal di perangkat ini.
  const [isStandalone] = useState<boolean>(() => {
    try {
      return window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
    } catch { return false; }
  });
  const [isPwaInstalled, setIsPwaInstalled] = useState<boolean>(() => {
    try { return localStorage.getItem('muzeck_pwa_installed') === '1'; } catch { return false; }
  });

  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProfileDashboardOpen, setIsProfileDashboardOpen] = useState(false);
  const [profileInitialTab, setProfileInitialTab] = useState<'donate' | undefined>(undefined);
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
      const q = new URLSearchParams(window.location.search);
      if (window.location.pathname === '/reset-password') return q.get('token');
      return q.get('resetToken');
    } catch {
      return null;
    }
  });

  useEffect(() => {
    if (resetToken) {
      setIsAuthOpen(true);
      // Bersihkan token dari URL (riwayat browser) dan kembalikan ke halaman utama.
      window.history.replaceState({}, '', '/');
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

  // Deteksi PWA yang sudah terinstal (event appinstalled + getInstalledRelatedApps bila didukung).
  useEffect(() => {
    const markInstalled = () => {
      setIsPwaInstalled(true);
      setDeferredPrompt(null);
      try { localStorage.setItem('muzeck_pwa_installed', '1'); } catch {}
    };
    window.addEventListener('appinstalled', markInstalled);
    if (isStandalone) markInstalled();
    try {
      (navigator as any).getInstalledRelatedApps?.()
        .then((apps: any[]) => { if (apps?.length) markInstalled(); })
        .catch(() => {});
    } catch {}
    return () => window.removeEventListener('appinstalled', markInstalled);
  }, [isStandalone]);

  const handleInstallPwa = async () => {
    if (isStandalone) {
      showToast('Kamu sudah memakai PlayMuzeck sebagai aplikasi.');
      return;
    }
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('PlayMuzeck berhasil diinstal sebagai aplikasi PWA!');
      }
      setDeferredPrompt(null);
    } else if (isPwaInstalled) {
      // Browser tidak mengizinkan web membuka PWA yang sudah terinstal secara paksa.
      showToast('PlayMuzeck sudah terinstal. Buka lewat ikon aplikasi, atau tombol "Open in app" di address bar browser.');
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

  const handleCheckoutSuccess = (purchasedItems?: CartItem[]) => {
    // CATATAN PENTING: CartDrawer HANYA memanggil onCheckoutSuccess() setelah
    // POST /api/user/checkout benar-benar sukses (res.ok true). Jadi di sini
    // kita TIDAK BOLEH lagi menebak-nebak status kepemilikan dari isi
    // keranjang secara lokal (itu sumber bug "Sudah Dimiliki" palsu yang
    // tidak sinkron dengan Koleksi Saya / database). Sebagai gantinya kita
    // tarik ulang status kepemilikan ASLI dari server.
    const newUnlockedDeckIds = [...unlockedDeckIds];
    const newUnlockedTopicIds = [...unlockedTopicIds];

    // Yang dibuka & dibuang dari keranjang hanya item pada pesanan yang dibayar. Item yang baru ditambahkan
    // selama pesanan menunggu tetap di keranjang. Tanpa daftar (mode demo) -> seluruh keranjang, seperti dulu.
    const bought: CartItem[] = purchasedItems && purchasedItems.length ? purchasedItems : cartItems || [];
    const boughtKeys = new Set(bought.map((b: any) => `${b.cartItemId ?? b.id}::${b.itemTypeKey || ''}`));

    bought.forEach((item) => {
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
    if (purchasedItems && purchasedItems.length) {
      setCartItems((prev) => (prev || []).filter((i) => !boughtKeys.has(cartKeyOf(i))));
    } else {
      setCartItems([]);
    }
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

  // Login sekarang sesi cookie dari server; data akun resminya = respons { user: {...} } dari /api/auth/*.
  // Kalau AuthModal masih mengirim email/nama kosong (format respons lama), ambil langsung dari
  // server lewat /api/auth/me supaya sesi tidak terisi `undefined` (tampil sebagai "Mode Tamu").
  const handleLogin = async (emailArg?: string, nameArg?: string) => {
    let email = String(emailArg || '').trim();
    let name = String(nameArg || '').trim();
    let serverAdmin: boolean | undefined;
    if (!email) {
      const r = await authApi.me();
      if (!r.ok || !r.data?.user?.email) {
        showToast('Login berhasil, tetapi data akun gagal dimuat. Muat ulang halaman lalu coba lagi.');
        return;
      }
      email = r.data.user.email;
      name = r.data.user.name || '';
      serverAdmin = r.data.user.isAdmin;
    }
    if (!name) name = email.split('@')[0];
    const adminStatus = serverAdmin ?? isUserAdmin(email);
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
    // Ambil foto/bio/sapaan/bingkai dari server supaya langsung tampil setelah login.
    authApi.me().then((mr) => {
      const u = mr.ok ? mr.data?.user : null;
      if (!u?.email) return;
      setUserSession((prev) => {
        const next = { ...prev, avatarUrl: u.avatarUrl || '', bio: u.bio || '', greeting: u.greeting || '', frameId: u.frameId || 'none' };
        try { storage.setUserSession(next); } catch {}
        return next;
      });
    });
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

    // Kalau pengguna masuk karena membuka tautan dalam (/audio/..., /quiz/...), langsung bawa ke sana tanpa menanyakan tujuan.
    if (!pendingRouteRef.current) setIsDestinationModalOpen(true);
  };

  const handleLogout = () => {
    const defaultSession: UserSession = { isLoggedIn: false, name: 'Tamu PlayMuzeck', email: '' };
    setUserSession(defaultSession);
    try {
      storage.setUserSession(defaultSession);
      clearAdminToken();
      clearUserToken();
    } catch {}
    void authApi.logout(); // hapus sesi di server + cookie httpOnly (JS tidak bisa menghapusnya sendiri)

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

  // Sesi kedaluwarsa / cookie hilang -> paksa login ulang.
  const logoutRef = useRef<() => void>(() => {});
  logoutRef.current = handleLogout;
  const handleLoginRef = useRef(handleLogin);
  handleLoginRef.current = handleLogin;

  useEffect(() => {
    const expire = () => {
      if (!emailRef.current) return;
      logoutRef.current();
      showToast('Sesi login berakhir. Silakan masuk kembali.');
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);

    // 1) Link verifikasi dari email: /verify-email?token=...  (server langsung membuat sesi cookie)
    const isVerifyPage = window.location.pathname === '/verify-email';
    const verifyToken = isVerifyPage ? new URLSearchParams(window.location.search).get('token') : null;
    if (isVerifyPage) window.history.replaceState({}, '', '/'); // token jangan tertinggal di URL

    if (verifyToken) {
      authApi.verifyEmail(verifyToken).then((r) => {
        if (r.ok && r.data?.user?.email) {
          showToast('Email terverifikasi!');
          void handleLoginRef.current(r.data.user.email, r.data.user.name);
          announceAccountDeletion(r.data.user);
        } else {
          showToast(r.data?.message || 'Link verifikasi tidak valid atau sudah kedaluwarsa.');
          setIsAuthOpen(true);
        }
      });
    } else {
      // 2) SERVER = sumber kebenaran. Cookie httpOnly tidak bisa dibaca JS, jadi tanya /api/auth/me.
      //    - 200 -> pulihkan sesi dari data server (nama/email/isAdmin pasti benar)
      //    - 401 -> jadi tamu (termasuk membuang sesi hantu dari localStorage)
      //    - status 0 (server mati/offline) -> jangan ubah apa pun
      authApi.me().then((r) => {
        if (r.ok && r.data?.user?.email) {
          const u = r.data.user;
          const session: UserSession = {
            isLoggedIn: true,
            email: u.email,
            name: u.name || u.email.split('@')[0],
            // Server = sumber kebenaran untuk profil (foto, bio, sapaan, bingkai).
            avatarUrl: u.avatarUrl || '',
            bio: u.bio || '',
            greeting: u.greeting || '',
            frameId: u.frameId || 'none',
          };
          (session as any).isAdmin = u.isAdmin;
          setUserSession((prev) => ({ ...prev, ...session }));
          try { storage.setUserSession(session); } catch {}
          // Sesi dipulihkan dari cookie (buka ulang situs tanpa login ulang): ingatkan soal
          // penghapusan akun sekali per sesi browser, supaya tidak muncul tiap refresh.
          if (u.deletion?.scheduledAt) {
            let shown = false;
            try { shown = sessionStorage.getItem('muzeck_deletion_notice') === u.deletion.scheduledAt; } catch {}
            if (!shown) {
              try { sessionStorage.setItem('muzeck_deletion_notice', u.deletion.scheduledAt); } catch {}
              announceAccountDeletion(u);
            }
          }
        } else if (r.status === 401) {
          const guest: UserSession = { isLoggedIn: false, name: 'Tamu PlayMuzeck', email: '' };
          setUserSession(guest);
          try { storage.setUserSession(guest); } catch {}
          setCurrentMode('index');
          // Sedang di /audio/... atau /quiz/... tanpa sesi yang sah (tamu, atau sesi sudah kedaluwarsa): catat tujuannya,
          // minta masuk, lalu bawa kembali ke halaman itu setelah login.
          try {
            const here = parseRoute(window.location.pathname);
            if (here.kind === 'audio' || here.kind === 'legacy-tools' || here.kind === 'quiz') {
              if (!pendingRouteRef.current) pendingRouteRef.current = { mode: here.kind === 'quiz' ? 'quiz' : 'audio' };
              setIsAuthOpen(true);
            }
          } catch {}
        }
      });
    }

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

  const isAdmin = Boolean(
    userSession?.email && ((userSession as any).isAdmin === true || isUserAdmin(userSession.email))
  );

  return (
    <ThemeProvider isLoggedIn={Boolean(userSession?.isLoggedIn)} userKey={userSession?.email || ''}>
    {/* Notifikasi dari admin (tema, hapus akun, dst.) sekarang tampil di lonceng Header (NotificationBell), bukan popup. */}
    <div className="min-h-dvh w-full overflow-x-clip bg-page text-fg flex flex-col selection:bg-accent selection:text-on-accent">
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
          dropPendingRoute();
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

      <main className="flex-1 min-w-0 w-full px-[20px] pt-4 sm:pt-6">
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
                onOpenProfile={() => { setProfileInitialTab(undefined); setIsProfileDashboardOpen(true); }}
                onOpenDonation={() => {
                  if (!userSession?.isLoggedIn) {
                    setIsAuthOpen(true);
                    showToast('Masuk dulu agar donasimu tercatat dan bingkai terbuka otomatis.');
                    return;
                  }
                  setProfileInitialTab('donate');
                  setIsProfileDashboardOpen(true);
                }}
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
                userAvatarUrl={userSession?.avatarUrl}
                userFrameId={userSession?.frameId}
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
                canInstallPwa={Boolean(deferredPrompt) || isPwaInstalled || isStandalone}
                onInstallPwa={handleInstallPwa}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="w-full border-t border-white/[0.08] bg-black/30 mt-auto">
        {/* Tata letak: kiri = logo, tengah = dua baris tautan, kanan = hak cipta.
            Kiri dan kanan berada di tengah-tengah secara vertikal terhadap SELURUH blok tautan (dua baris). */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 pt-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] flex flex-col items-center gap-4 lg:grid lg:grid-cols-[1fr_minmax(0,auto)_1fr] lg:items-center lg:gap-6 text-xs text-gray-400 text-center">
          {/* Nama PlayMuzeck (teks saja, tanpa ikon logo) */}
          <button
            type="button"
            onClick={() => {
              audioEngine.playClickSound();
              dropPendingRoute();
              setCurrentMode('index');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            aria-label="Ke Halaman Utama PlayMuzeck"
            title="Ke Halaman Utama PlayMuzeck"
            className="flex items-center gap-2 cursor-pointer select-none group text-left rounded-2xl lg:justify-self-start"
          >
            <span className="font-extrabold text-white text-sm tracking-tight leading-none">
              {siteSettings.siteName}<span className="text-accent">.</span>
            </span>
          </button>

          <div className="flex flex-col items-center gap-3 min-w-0">
            <nav aria-label="Navigasi footer" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {([
                { label: 'Beranda', mode: 'index' as const },
                { label: 'Audio Studio', mode: 'audio' as const },
                { label: 'Pusat Kuis', mode: 'quiz' as const },
              ]).map((l) => (
                <button
                  key={l.mode}
                  type="button"
                  onClick={() => {
                    if (l.mode !== 'index' && !userSession?.isLoggedIn) {
                      setIsAuthOpen(true);
                      return;
                    }
                    audioEngine.playClickSound();
                    setCurrentMode(l.mode);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {l.label}
                </button>
              ))}
              {isAdmin && (
                <a href="/admin" className="text-accent font-bold hover:underline">
                  Admin
                </a>
              )}
            </nav>

            <nav aria-label="Tautan hukum" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-gray-500">
              <a href="/support" className="hover:text-white transition-colors">Dukung Kami</a>
              <a href="/about" className="hover:text-white transition-colors">Tentang</a>
              <a href="/contact" className="hover:text-white transition-colors">Kontak</a>
              <a href="/privacy" className="hover:text-white transition-colors">Privasi</a>
              <a href="/cookie" className="hover:text-white transition-colors">Kebijakan Cookie</a>
              <a href="/terms" className="hover:text-white transition-colors">Syarat &amp; Ketentuan</a>
              <a href="/copyright" className="hover:text-white transition-colors">Hak Cipta</a>
            </nav>
          </div>

          <span className="lg:justify-self-end">&copy; {new Date().getFullYear()} {siteSettings.siteName}</span>
        </div>
      </footer>

      <CookieConsent />

      {/* Modal Pemilih Destinasi Pasca-Login */}
      <DestinationModal
        isOpen={isDestinationModalOpen}
        onClose={() => setIsDestinationModalOpen(false)}
        userName={userSession?.name || 'Maestro'}
        isAdmin={Boolean(isAdmin)}
        onSelectDestination={(dest) => {
          setIsDestinationModalOpen(false);
          if (dest === 'admin') {
            // Server memverifikasi cookie sesi httpOnly yang asli (tabel `sessions`),
            // mengecek daftar admin, lalu menerbitkan token admin sebelum redirect.
            elevateToAdminViaSession()
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
        onClose={() => { setIsProfileDashboardOpen(false); setProfileInitialTab(undefined); }}
        initialTab={profileInitialTab}
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
          // Toast ditampilkan oleh ProfileDashboardModal (setelah server benar-benar menyimpan).
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
    </ThemeProvider>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <MainApp />
    </ErrorBoundary>
  );
}
