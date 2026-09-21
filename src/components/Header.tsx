// src/components/Header.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  Sparkles,
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
  Trophy,
} from 'lucide-react';
import { AppMode, CartItem, UserSession, AudioEntitlements } from '../types';
import { PROFILE_FRAMES, FrameOrnament } from './Modals/ProfileDashboardModal';
import { audioEngine } from '../services/audioEngine';

export type QuizSegment = 'pwa' | 'play' | 'all' | 'leaderboard';

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

export const Header: React.FC<HeaderProps> = ({
  currentMode,
  onNavigateIndex,
  activeAudioSection = 'assets',
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
  const menuRef = useRef<HTMLDivElement | null>(null);

  const totalCartCount = cartItems?.length || 0;
  const userInitial = (userSession?.name || 'M').charAt(0).toUpperCase();

  const activeFrameId = (userSession as any)?.frameId || 'none';
  const avatarUrl = (userSession as any)?.avatarUrl;
  const currentFrameObj = PROFILE_FRAMES.find((f) => f.id === activeFrameId) || PROFILE_FRAMES[0];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsSectionMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const scrollToElement = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-[#14213D]/95 backdrop-blur-md border-b border-white/[0.08] px-3 sm:px-8 py-2.5">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        
        {/* SISI KIRI: DROPDOWN SEGMEN KHUSUS HALAMAN AKTIF + LOGO */}
        <div className="flex items-center gap-2.5 sm:gap-3.5">
          {userSession?.isLoggedIn && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => {
                  audioEngine.playClickSound();
                  setIsSectionMenuOpen(!isSectionMenuOpen);
                }}
                className={`px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-2 transition-all cursor-pointer shadow-sm ${
                  isSectionMenuOpen
                    ? 'bg-[#FCA311] text-black border-[#FCA311]'
                    : 'bg-black/60 text-gray-200 hover:text-white border-white/[0.12] hover:border-[#FCA311]/50'
                }`}
                title="Buka Navigasi Segmen Halaman"
              >
                <Menu className={`w-4 h-4 shrink-0 stroke-[2.5] ${isSectionMenuOpen ? 'text-black' : 'text-[#FCA311]'}`} />
                <span className="hidden sm:inline">
                  {currentMode === 'audio'
                    ? 'Halaman Audio'
                    : currentMode === 'quiz'
                    ? 'Pusat Kuis'
                    : 'Halaman Utama'}
                </span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${isSectionMenuOpen ? 'rotate-180 text-black' : 'rotate-0 text-gray-400'}`} />
              </button>

              {/* POPUP DROPDOWN SEGMEN INTERNAL */}
              {isSectionMenuOpen && (
                <div className="absolute top-full left-0 mt-2 w-[calc(100vw-2rem)] max-w-80 rounded-2xl bg-[#14213D] border border-white/20 p-3 shadow-2xl z-50 animate-in fade-in zoom-in-95 space-y-1.5">
                  
                  {/* 1. SEGMEN HALAMAN AUDIO STUDIO */}
                  {currentMode === 'audio' && (
                    <>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 block px-2 pb-1 border-b border-white/10">
                        PILIH SEGMEN STUDIO AUDIO:
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          onSelectAudioSection?.('assets');
                          setIsSectionMenuOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer ${
                          activeAudioSection === 'assets'
                            ? 'bg-[#FCA311] text-black font-black shadow'
                            : 'bg-black/40 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        <Music className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeAudioSection === 'assets' ? 'text-black' : 'text-[#FCA311]'}`} />
                        <div>
                          <div className="leading-tight">Aset Audio</div>
                          <div className={`text-[10px] font-normal ${activeAudioSection === 'assets' ? 'text-black/80' : 'text-gray-400'}`}>
                            Katalog lagu, stems & lisensi
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          onSelectAudioSection?.('pad');
                          setIsSectionMenuOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer ${
                          activeAudioSection === 'pad'
                            ? 'bg-[#FCA311] text-black font-black shadow'
                            : 'bg-black/40 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        <Sliders className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeAudioSection === 'pad' ? 'text-black' : 'text-[#FCA311]'}`} />
                        <div>
                          <div className="leading-tight">Pad Editor</div>
                          <div className={`text-[10px] font-normal ${activeAudioSection === 'pad' ? 'text-black/80' : 'text-gray-400'}`}>
                            Drum kit & 4 track akor
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          onSelectAudioSection?.('tools');
                          setIsSectionMenuOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer ${
                          activeAudioSection === 'tools'
                            ? 'bg-[#FCA311] text-black font-black shadow'
                            : 'bg-black/40 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        <Wrench className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeAudioSection === 'tools' ? 'text-black' : 'text-[#FCA311]'}`} />
                        <div>
                          <div className="leading-tight">Audio Tools</div>
                          <div className={`text-[10px] font-normal ${activeAudioSection === 'tools' ? 'text-black/80' : 'text-gray-400'}`}>
                            Pemisah vokal & utilitas studio
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          onSelectAudioSection?.('pricing');
                          setIsSectionMenuOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer ${
                          activeAudioSection === 'pricing'
                            ? 'bg-[#FCA311] text-black font-black shadow'
                            : 'bg-black/40 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        <CreditCard className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeAudioSection === 'pricing' ? 'text-black' : 'text-[#FCA311]'}`} />
                        <div>
                          <div className="leading-tight">Harga & Lisensi</div>
                          <div className={`text-[10px] font-normal ${activeAudioSection === 'pricing' ? 'text-black/80' : 'text-gray-400'}`}>
                            Paket bundle 6 produk lengkap
                          </div>
                        </div>
                      </button>
                    </>
                  )}

                  {/* 2. SEGMEN HALAMAN PUSAT KUIS DENGAN LABEL RESMI BARU */}
                  {currentMode === 'quiz' && (
                    <>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 block px-2 pb-1 border-b border-white/10">
                        PILIH SEGMEN PUSAT KUIS:
                      </span>

                      {/* Segmen 1: Unduh Web App */}
                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          onSelectQuizSection?.('pwa');
                          setIsSectionMenuOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer ${
                          activeQuizSection === 'pwa'
                            ? 'bg-red-500 text-white font-black shadow'
                            : 'bg-black/40 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        <Download className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeQuizSection === 'pwa' ? 'text-white' : 'text-red-400'}`} />
                        <div>
                          <div className="leading-tight">Unduh Web App</div>
                          <div className={`text-[10px] font-normal ${activeQuizSection === 'pwa' ? 'text-white/80' : 'text-gray-400'}`}>
                            PWA mandiri & 3 starter pack
                          </div>
                        </div>
                      </button>

                      {/* Segmen 2: Mainkan Kuis */}
                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          onSelectQuizSection?.('play');
                          setIsSectionMenuOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer ${
                          activeQuizSection === 'play'
                            ? 'bg-red-500 text-white font-black shadow'
                            : 'bg-black/40 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        <Play className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeQuizSection === 'play' ? 'text-white' : 'text-emerald-400'}`} />
                        <div>
                          <div className="leading-tight">Mainkan Kuis</div>
                          <div className={`text-[10px] font-normal ${activeQuizSection === 'play' ? 'text-white/80' : 'text-gray-400'}`}>
                            Putar langsung deck yang siap dimainkan
                          </div>
                        </div>
                      </button>

                      {/* Segmen 3: Perpustakaan Kuis */}
                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          onSelectQuizSection?.('all');
                          setIsSectionMenuOpen(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 transition-all cursor-pointer ${
                          activeQuizSection === 'all'
                            ? 'bg-red-500 text-white font-black shadow'
                            : 'bg-black/40 text-gray-200 hover:bg-white/10'
                        }`}
                      >
                        <Layers className={`w-4 h-4 shrink-0 stroke-[2.5] ${activeQuizSection === 'all' ? 'text-white' : 'text-amber-400'}`} />
                        <div>
                          <div className="leading-tight">Perpustakaan Kuis</div>
                          <div className={`text-[10px] font-normal ${activeQuizSection === 'all' ? 'text-white/80' : 'text-gray-400'}`}>
                            Koleksi seluruh tema & deck kuis
                          </div>
                        </div>
                      </button>
                    </>
                  )}

                  {/* 3. SEGMEN HALAMAN UTAMA */}
                  {currentMode === 'index' && (
                    <>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 block px-2 pb-1 border-b border-white/10">
                        SEGMEN HALAMAN UTAMA:
                      </span>

                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          setIsSectionMenuOpen(false);
                          scrollToElement('index-hero-section');
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 bg-black/40 text-gray-200 hover:bg-white/10 transition-all cursor-pointer"
                      >
                        <Sparkles className="w-4 h-4 text-[#FCA311] shrink-0" />
                        <div>
                          <div className="leading-tight">Harmoni & Wawasan</div>
                          <div className="text-[10px] font-normal text-gray-400">Visi & ekosistem PlayMuzeck</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          setIsSectionMenuOpen(false);
                          scrollToElement('index-audio-section');
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 bg-black/40 text-gray-200 hover:bg-white/10 transition-all cursor-pointer"
                      >
                        <Music className="w-4 h-4 text-[#FCA311] shrink-0" />
                        <div>
                          <div className="leading-tight">Keunggulan Studio Audio</div>
                          <div className="text-[10px] font-normal text-gray-400">128 SoundFont & 4-track akor</div>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          audioEngine.playClickSound();
                          setIsSectionMenuOpen(false);
                          scrollToElement('index-quiz-section');
                        }}
                        className="w-full text-left px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 bg-black/40 text-gray-200 hover:bg-white/10 transition-all cursor-pointer"
                      >
                        <Play className="w-4 h-4 text-red-400 shrink-0" />
                        <div>
                          <div className="leading-tight">Keunggulan Pusat Kuis</div>
                          <div className="text-[10px] font-normal text-gray-400">Offline PWA & 3 paket kartu starter</div>
                        </div>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Logo PlayMuzeck dengan Sudut Lengkung Halus */}
          <div
            onClick={onNavigateIndex}
            className="flex items-center gap-2 cursor-pointer select-none group"
            title="Ke Halaman Utama PlayMuzeck"
          >
            <div className="w-10 h-10 shrink-0 rounded-2xl overflow-hidden p-1 bg-[#14213D] border border-white/10 shadow-md flex items-center justify-center group-hover:scale-105 transition-transform">
              <img
                src="/PlayMuzeck-logo.png"
                alt="PlayMuzeck Logo"
                className="w-full h-full object-contain rounded-xl"
              />
            </div>

            <div className="flex flex-col">
              <span className="text-base sm:text-lg font-black tracking-tight text-white leading-none">
                {siteName}
                <span className="text-[#FCA311]">.</span>
              </span>
              <span className="text-[10px] text-gray-400 font-mono tracking-wider">AUDIO & KUIS</span>
            </div>
          </div>
        </div>

        {/* SISI KANAN: TENTANG PlayMuzeck + KERANJANG + AVATAR */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onNavigateIndex}
            className={`px-2.5 sm:px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer ${
              currentMode === 'index'
                ? 'bg-[#FCA311] text-black border-[#FCA311] shadow font-black'
                : 'bg-black/50 text-[#FCA311] hover:text-amber-300 border-white/[0.1] hover:border-[#FCA311]/40'
            }`}
            title="Tentang Platform PlayMuzeck"
          >
            <Sparkles
              className={`w-3.5 h-3.5 shrink-0 stroke-[2.5] ${
                currentMode === 'index' ? 'text-black fill-black' : 'text-[#FCA311]'
              }`}
            />
            <span className="hidden md:inline font-black">Tentang PlayMuzeck</span>
            <span className="md:hidden font-black">Tentang</span>
          </button>

          <button
            type="button"
            onClick={onOpenCart}
            className="p-2 rounded-xl bg-black/50 hover:bg-black/80 border border-white/[0.08] text-gray-300 hover:text-white relative transition-colors cursor-pointer"
            title="Keranjang Belanja"
          >
            <ShoppingBag className="w-4 h-4" />
            {totalCartCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#FCA311] text-black font-mono font-black text-[9px] flex items-center justify-center shadow">
                {totalCartCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onOpenProfileDashboard}
            className="flex items-center gap-2 bg-black/60 hover:bg-black/90 border border-white/[0.1] hover:border-[#FCA311]/50 px-2 sm:px-2.5 py-1.5 rounded-xl transition-all cursor-pointer group"
            title={`Buka Dasbor Profil (Bingkai: ${currentFrameObj.name})`}
          >
            <div className="relative shrink-0">
              <FrameOrnament iconType={currentFrameObj.iconType} size="sm" />

              <div
                className={`w-7 h-7 sm:w-8 sm:h-8 rounded-xl flex items-center justify-center text-black font-black text-xs overflow-hidden transition-all bg-[#0a1120] ${currentFrameObj.borderClass}`}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="Profil" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-tr from-[#FCA311] via-amber-300 to-amber-500 flex items-center justify-center text-black font-black text-xs">
                    {userInitial}
                  </div>
                )}
              </div>
            </div>

            <span className="text-xs font-bold text-white max-w-[80px] sm:max-w-[120px] truncate hidden sm:inline group-hover:text-[#FCA311] transition-colors">
              {userSession?.name || 'Profil'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
};