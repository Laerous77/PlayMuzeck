// src/components/Header.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  ShoppingBag,
  Menu,
  ChevronDown,
  Music,
  Sliders,
  Wrench,
  CreditCard,
  Download,
  Play,
  Layers,
  Globe,
  ListChecks,
  HelpCircle,
  Info,
  Lightbulb,
  Compass,
} from 'lucide-react';
import { AppMode, CartItem, UserSession, AudioEntitlements } from '../types';
import { PROFILE_FRAMES, FrameOrnament } from './Modals/ProfileDashboardModal';
import { audioEngine } from '../services/audioEngine';
import { NotificationBell } from './NotificationBell';
import type { QuizSegment } from './PusatKuis/quizSegments';

// Papan Peringkat kini menyatu dengan Komunitas Kuis dalam satu segmen ('community'), tampil sebagai "Aula Komunitas" (URL: /quiz/hall).
export type { QuizSegment };

interface HeaderProps {
  currentMode: AppMode | 'index';
  onModeChange: (mode: AppMode) => void;
  onNavigateIndex: () => void;
  activeAudioSection?: 'assets' | 'pad' | 'tools' | 'pricing';
  onSelectAudioSection?: (sec: 'assets' | 'pad' | 'tools' | 'pricing') => void;
  activeQuizSection?: QuizSegment;
  onSelectQuizSection?: (sec: QuizSegment) => void;
  cartItems: CartItem[];
  onOpenCart: () => void;
  onOpenProfileDashboard: () => void;
  userSession: UserSession;
  entitlements: AudioEntitlements;
  unlockedDecksCount: number;
  siteName?: string;
  tagline?: string;
  accentAudio?: string;
  accentQuiz?: string;
}

// Urutan menu Halaman Utama = urutan bagian di IndexView:
// Kenapa PlayMuzeck (solusi) -> Langkah Awal (mulai dalam 3 langkah) -> Eksplor Fitur (dua kartu produk) -> Pertanyaan Umum (FAQ).
// `spotIds`: elemen yang menyala (spotlight) setelah gulir; bila kosong, elemen tujuan itu sendiri yang menyala.
const INDEX_ITEMS: readonly {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: 'accent' | 'accent2';
  title: string;
  desc: string;
  spotIds?: readonly string[];
}[] = [
  { id: 'index-solutions-section', icon: Lightbulb, tone: 'accent', title: 'Kenapa PlayMuzeck', desc: 'Solusi untuk kebutuhan musik & kuismu' },
  { id: 'index-steps-section', icon: ListChecks, tone: 'accent', title: 'Langkah Awal', desc: 'Mulai dalam 3 langkah' },
  {
    id: 'index-products-section',
    icon: Compass,
    tone: 'accent',
    title: 'Eksplor Fitur',
    desc: 'Kartu Audio Studio & Pusat Kuis',
    spotIds: ['index-audio-section', 'index-quiz-section'],
  },
  { id: 'index-faq-section', icon: HelpCircle, tone: 'accent', title: 'Pertanyaan Umum', desc: 'Jawaban singkat seputar layanan' },
];

const AUDIO_ITEMS = [
  { key: 'assets', icon: Music, title: 'Aset Audio', desc: 'Katalog lagu, stems & lisensi' },
  { key: 'pad', icon: Sliders, title: 'Pad Editor', desc: 'Drum & chord pad gratis, rekam live, 11 birama' },
  { key: 'tools', icon: Wrench, title: 'Audio Tools', desc: '20 alat: edit, rekam & latihan' },
  { key: 'pricing', icon: CreditCard, title: 'Harga & Lisensi', desc: 'Paket bundle 6 produk lengkap' },
] as const;

const QUIZ_ITEMS = [
  { key: 'pwa', icon: Download, iconIdle: 'text-accent2', title: 'Unduh Web App', desc: 'PWA mandiri & 3 starter pack' },
  { key: 'play', icon: Play, iconIdle: 'text-emerald-400', title: 'Mainkan Kuis', desc: 'Putar langsung deck yang siap dimainkan' },
  { key: 'all', icon: Layers, iconIdle: 'text-accent', title: 'Perpustakaan Kuis', desc: 'Koleksi seluruh tema & deck kuis' },
  { key: 'community', icon: Globe, iconIdle: 'text-sky-300', title: 'Aula Komunitas', desc: 'Kuis buatan pengguna & papan peringkat' },
] as const;

const ITEM_BASE =
  'w-full min-h-11 text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer active:scale-[0.98]';

// Gulir mulus ke sebuah bagian halaman lalu beri efek "spotlight" (cincin cahaya + kilau tombol)
// supaya mata pengguna langsung tertuju ke kartu/bagian yang dituju dari menu navigasi.
const spotlightTimers = new WeakMap<HTMLElement, number[]>();

function scrollToAndSpotlight(id: string, durationMs = 2600, spotIds?: readonly string[]): void {
  const el = document.getElementById(id);
  if (!el) return;
  const targets = (spotIds && spotIds.length ? spotIds : [id])
    .map((sid) => document.getElementById(sid))
    .filter((t): t is HTMLElement => Boolean(t));
  if (targets.length === 0) targets.push(el);
  const reduce =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  for (const t of targets) {
    (spotlightTimers.get(t) || []).forEach((timer) => window.clearTimeout(timer));
    t.classList.remove('pm-spotlight');
  }
  el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });

  for (const t of targets) {
    const start = window.setTimeout(() => {
      void t.offsetWidth; // paksa reflow supaya animasi bisa diulang
      t.classList.add('pm-spotlight');
      const end = window.setTimeout(() => t.classList.remove('pm-spotlight'), durationMs);
      spotlightTimers.set(t, [start, end]);
    }, reduce ? 0 : 450);
    spotlightTimers.set(t, [start]);
  }
}

// Id bagian halaman utama yang sedang "aktif" untuk menandai menu. Aturannya:
//  1. Bagian yang baru dipilih dari menu (preferId) menang selama masih terlihat.
//  2. Selain itu, ambil bagian yang menutupi garis offset; bila beberapa bagian sebaris, ambil yang paling kiri.
function getActiveSectionId(ids: string[], offset = 140, preferId: string | null = null): string | null {
  const rects: Record<string, DOMRect> = {};
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) rects[id] = el.getBoundingClientRect();
  }
  const present = ids.filter((id) => rects[id]);
  if (present.length === 0) return null;

  if (preferId && rects[preferId]) {
    const r = rects[preferId];
    if (r.bottom > offset && r.top < window.innerHeight * 0.6) return preferId;
  }

  // Di dasar halaman, bagian terakhir mungkin tidak pernah mencapai batas atas layar.
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  if (atBottom) return present[present.length - 1];

  const covering = present.filter((id) => rects[id].top <= offset && rects[id].bottom > offset);
  const pool = covering.length > 0 ? covering : present.filter((id) => rects[id].top <= offset);
  if (pool.length === 0) return null;

  const maxTop = Math.max(...pool.map((id) => rects[id].top));
  const sameRow = pool.filter((id) => maxTop - rects[id].top <= 4);
  return sameRow[0];
}

export const Header: React.FC<HeaderProps> = ({
  currentMode,
  onNavigateIndex,
  activeAudioSection = 'tools',
  onSelectAudioSection,
  activeQuizSection = 'all',
  onSelectQuizSection,
  cartItems,
  onOpenCart,
  onOpenProfileDashboard,
  userSession,
  siteName = 'PlayMuzeck',
}) => {
  const [isSectionMenuOpen, setIsSectionMenuOpen] = useState(false);
  const [activeIndexId, setActiveIndexId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  // Bagian yang baru dipilih dari menu; dipertahankan sebagai yang aktif (termasuk selama scroll mulus berlangsung).
  const pickedRef = useRef<{ id: string; until: number } | null>(null);

  const totalCartCount = cartItems?.length || 0;
  const userInitial = (userSession?.name || 'M').charAt(0).toUpperCase();

  const activeFrameId = (userSession as any)?.frameId || 'none';
  const avatarUrl = (userSession as any)?.avatarUrl;
  const currentFrameObj = PROFILE_FRAMES.find((f) => f.id === activeFrameId) || PROFILE_FRAMES[0];

  // Tutup menu saat klik/sentuh di luar, atau menekan Escape. pointerdown mencakup mouse & layar sentuh.
  useEffect(() => {
    if (!isSectionMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setIsSectionMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsSectionMenuOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [isSectionMenuOpen]);

  // Tutup menu bila halaman berganti.
  useEffect(() => {
    setIsSectionMenuOpen(false);
  }, [currentMode]);

  // Halaman Utama: sorotan menu selalu mengikuti posisi scroll (bukan hanya saat menu dibuka).
  const computeActiveIndex = (ids: string[]): string | null => {
    const picked = pickedRef.current;
    if (picked && Date.now() < picked.until) return picked.id; // sedang scroll mulus ke bagian yang dipilih
    const res = getActiveSectionId(ids, 140, picked ? picked.id : null);
    if (picked && res !== picked.id) pickedRef.current = null;
    return res;
  };

  useEffect(() => {
    if (currentMode !== 'index') {
      pickedRef.current = null;
      setActiveIndexId(null);
      return;
    }
    const ids = INDEX_ITEMS.map((i) => i.id);
    let raf = 0;
    const sync = () => {
      raf = 0;
      setActiveIndexId(computeActiveIndex(ids));
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(sync);
    };
    sync();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMode]);

  const toggleMenu = () => {
    audioEngine.playClickSound();
    if (!isSectionMenuOpen && currentMode === 'index') {
      setActiveIndexId(computeActiveIndex(INDEX_ITEMS.map((i) => i.id)));
    }
    setIsSectionMenuOpen((v) => !v);
  };

  const pickAudio = (key: (typeof AUDIO_ITEMS)[number]['key']) => {
    audioEngine.playClickSound();
    onSelectAudioSection?.(key);
    setIsSectionMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pickQuiz = (key: (typeof QUIZ_ITEMS)[number]['key']) => {
    audioEngine.playClickSound();
    onSelectQuizSection?.(key);
    setIsSectionMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const pickIndex = (id: string) => {
    audioEngine.playClickSound();
    pickedRef.current = { id, until: Date.now() + 1400 };
    setActiveIndexId(id);
    setIsSectionMenuOpen(false);
    const item = INDEX_ITEMS.find((i) => i.id === id);
    scrollToAndSpotlight(id, 2600, item?.spotIds);
  };

  const menuLabel =
    currentMode === 'audio' ? 'Halaman Audio' : currentMode === 'quiz' ? 'Pusat Kuis' : 'Halaman Utama';
  const menuHeading =
    currentMode === 'audio'
      ? 'PILIH SEGMEN STUDIO AUDIO:'
      : currentMode === 'quiz'
      ? 'PILIH SEGMEN PUSAT KUIS:'
      : 'SEGMEN HALAMAN UTAMA:';

  return (
    <header className="sticky top-0 z-40 w-full bg-surface/95 backdrop-blur-md border-b border-white/[0.08] px-[10px] pb-2.5 pt-[max(0.625rem,env(safe-area-inset-top))]">
      <div className="w-full flex items-center justify-between gap-2 sm:gap-3">
        {/* SISI KIRI: DROPDOWN SEGMEN HALAMAN AKTIF + LOGO */}
        <div className="flex items-center gap-2 sm:gap-3.5 min-w-0">
          {userSession?.isLoggedIn && (
            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                onClick={toggleMenu}
                aria-haspopup="menu"
                aria-expanded={isSectionMenuOpen}
                aria-label={`Buka navigasi: ${menuLabel}`}
                className={`h-10 sm:h-9 px-3 sm:px-3 rounded-xl border text-xs font-black flex items-center gap-1.5 sm:gap-2 transition-all cursor-pointer shadow-sm ${
                  isSectionMenuOpen
                    ? 'bg-accent text-on-accent border-accent'
                    : 'bg-black/60 text-gray-200 hover:text-white border-white/[0.12] hover:border-accent/50'
                }`}
                title="Buka Navigasi Segmen Halaman"
              >
                <Menu className={`w-4 h-4 shrink-0 stroke-[2.5] ${isSectionMenuOpen ? 'text-on-accent' : 'text-accent'}`} />
                <span className="hidden sm:inline whitespace-nowrap">{menuLabel}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 shrink-0 transition-transform ${
                    isSectionMenuOpen ? 'rotate-180 text-on-accent' : 'rotate-0 text-gray-400'
                  }`}
                />
              </button>

              {/* POPUP DROPDOWN SEGMEN INTERNAL */}
              {isSectionMenuOpen && (
                <div
                  role="menu"
                  className="absolute top-full left-0 mt-2 w-[min(20rem,calc(100vw-1.5rem))] max-h-[calc(100dvh-5rem)] overflow-y-auto overscroll-contain rounded-2xl bg-surface border border-white/20 p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 space-y-1.5"
                >
                  <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 block px-2 pb-1 border-b border-white/10">
                    {menuHeading}
                  </span>

                  {/* 1. AUDIO STUDIO */}
                  {currentMode === 'audio' &&
                    AUDIO_ITEMS.map((it) => {
                      const on = activeAudioSection === it.key;
                      return (
                        <button
                          key={it.key}
                          type="button"
                          role="menuitem"
                          onClick={() => pickAudio(it.key)}
                          className={`${ITEM_BASE} ${
                            on ? 'bg-accent text-on-accent font-black shadow' : 'bg-black/40 text-gray-200 hover:bg-white/10'
                          }`}
                        >
                          <it.icon className={`w-4 h-4 shrink-0 stroke-[2.5] ${on ? 'text-on-accent' : 'text-accent'}`} />
                          <div className="min-w-0">
                            <div className="leading-tight">{it.title}</div>
                            <div className={`text-[11px] font-normal ${on ? 'text-on-accent/80' : 'text-gray-400'}`}>{it.desc}</div>
                          </div>
                        </button>
                      );
                    })}

                  {/* 2. PUSAT KUIS */}
                  {currentMode === 'quiz' &&
                    QUIZ_ITEMS.map((it) => {
                      const on = activeQuizSection === it.key;
                      return (
                        <button
                          key={it.key}
                          type="button"
                          role="menuitem"
                          onClick={() => pickQuiz(it.key)}
                          className={`${ITEM_BASE} ${
                            on ? 'bg-accent2 text-on-accent2 font-black shadow' : 'bg-black/40 text-gray-200 hover:bg-white/10'
                          }`}
                        >
                          <it.icon className={`w-4 h-4 shrink-0 stroke-[2.5] ${on ? 'text-on-accent2' : it.iconIdle}`} />
                          <div className="min-w-0">
                            <div className="leading-tight">{it.title}</div>
                            <div className={`text-[11px] font-normal ${on ? 'text-on-accent2/80' : 'text-gray-400'}`}>{it.desc}</div>
                          </div>
                        </button>
                      );
                    })}

                  {/* 3. HALAMAN UTAMA: Kenapa PlayMuzeck -> Langkah Awal -> Eksplor Fitur -> Pertanyaan Umum */}
                  {currentMode === 'index' &&
                    INDEX_ITEMS.map((it) => {
                      const on = activeIndexId === it.id;
                      return (
                        <button
                          key={it.id}
                          type="button"
                          role="menuitem"
                          onClick={() => pickIndex(it.id)}
                          className={`${ITEM_BASE} bg-black/40 text-gray-200 hover:bg-white/10 border ${
                            on ? (it.tone === 'accent2' ? 'border-accent2/60' : 'border-accent/60') : 'border-transparent'
                          }`}
                        >
                          <it.icon className={`w-4 h-4 shrink-0 ${it.tone === 'accent2' ? 'text-accent2' : 'text-accent'}`} />
                          <div className="min-w-0">
                            <div className="leading-tight">{it.title}</div>
                            <div className="text-[11px] font-normal text-gray-400">{it.desc}</div>
                          </div>
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          )}

          {/* Logo PlayMuzeck */}
          <button
            type="button"
            onClick={onNavigateIndex}
            aria-label="Ke Halaman Utama PlayMuzeck"
            className="flex items-center gap-2 cursor-pointer select-none group min-w-0 text-left rounded-2xl"
            title="Ke Halaman Utama PlayMuzeck"
          >
            <div className="w-9 h-9 sm:w-10 sm:h-10 shrink-0 rounded-2xl overflow-hidden p-1 bg-surface border border-white/10 shadow-md flex items-center justify-center group-hover:scale-105 transition-transform">
              <img src="/PlayMuzeck-logo.png" alt="PlayMuzeck Logo" className="w-full h-full object-contain rounded-xl" />
            </div>

            {/* Teks logo disembunyikan di layar sangat sempit supaya tombol kanan tidak terdorong keluar */}
            <div className="hidden min-[400px]:flex flex-col min-w-0">
              <span className="text-base sm:text-lg font-black tracking-tight text-white leading-none truncate">
                {siteName}
                <span className="text-accent">.</span>
              </span>
              <span className="text-[10px] text-gray-400 font-mono tracking-wider whitespace-nowrap">AUDIO & KUIS</span>
            </div>
          </button>
        </div>

        {/* SISI KANAN: TENTANG KAMI + NOTIFIKASI + KERANJANG + AVATAR */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            type="button"
            onClick={onNavigateIndex}
            aria-label="Tentang Platform PlayMuzeck"
            className={`h-10 sm:h-9 px-3 sm:px-3.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
              currentMode === 'index'
                ? 'bg-accent text-on-accent border-accent shadow font-black'
                : 'bg-black/50 text-accent hover:text-accent/80 border-white/[0.1] hover:border-accent/40'
            }`}
            title="Tentang Platform PlayMuzeck"
          >
            <Info className="w-4 h-4 sm:hidden" />
            <span className="hidden sm:inline font-black whitespace-nowrap">Tentang Kami</span>
          </button>

          {/* Lonceng notifikasi: hapus akun, tema dari admin, dst. */}
          <NotificationBell isLoggedIn={Boolean(userSession?.isLoggedIn)} userKey={userSession?.email || ''} />

          <button
            type="button"
            onClick={onOpenCart}
            aria-label="Keranjang Belanja"
            className="h-10 w-10 sm:h-9 sm:w-9 flex items-center justify-center rounded-xl bg-black/50 hover:bg-black/80 border border-white/[0.08] text-gray-300 hover:text-white relative transition-colors cursor-pointer"
            title="Keranjang Belanja"
          >
            <ShoppingBag className="w-4 h-4" />
            {totalCartCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-4 h-4 px-0.5 rounded-full bg-accent text-on-accent font-mono font-black text-[9px] flex items-center justify-center shadow">
                {totalCartCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenProfileDashboard}
            className="flex items-center gap-2.5 bg-black/60 hover:bg-black/90 border border-white/[0.1] hover:border-accent/50 rounded-2xl p-1.5 sm:p-1.5 sm:pr-3.5 transition-all cursor-pointer group"
            title={`Buka Dasbor Profil (Bingkai: ${currentFrameObj.name})`}
            aria-label="Buka Dasbor Profil"
          >
            <div className="relative shrink-0 w-7 h-7 sm:w-9 sm:h-9">
              <div
                className={`w-full h-full rounded-xl flex items-center justify-center text-on-accent font-black text-xs overflow-hidden transition-all bg-[#0a1120] ${currentFrameObj.borderClass}`}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profil" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-tr from-accent to-accent/70 flex items-center justify-center text-on-accent font-black text-xs">
                    {userInitial}
                  </div>
                )}
              </div>

              {/* Ornamen bingkai: lencana kecil di pojok kanan atas */}
              <span className="absolute -top-1.5 -right-1.5 z-10 flex items-center justify-center pointer-events-none">
                <FrameOrnament iconType={currentFrameObj.iconType} size="sm" />
              </span>
            </div>

            <span className="text-xs font-bold text-white max-w-[140px] truncate leading-none hidden sm:block group-hover:text-accent transition-colors">
              {userSession?.name || 'Profil'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};
