// src/components/Modals/ProfileDashboardModal.tsx
import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  Sparkles,
  Library,
  Heart,
  MessageSquare,
  LogOut,
  LogIn,
  Music,
  ArrowRight,
  Send,
  Sliders,
  Wrench,
  QrCode,
  Edit3,
  Camera,
  Trash2,
  Check,
  CheckCircle,
  Lock,
  Award,
  Coffee,
  Zap,
  Orbit,
  Crown,
  Radio,
  Gem,
  Loader2,
  Wallet,
  Flag,
  Lightbulb,
  HelpCircle,
  ChevronLeft,
} from 'lucide-react';
import { UserSession, Deck, AudioTrackItem } from '../../types';
import { storage } from '../../services/storage';
import { BUILTIN_DECKS } from '../../data/quiz';
import { payWithQris, getPaymentStatus, formatIDR } from '../../services/payment';
import { QrisPanel } from './QrisPanel';
import { 
  fetchUserCollectionsFromDB, 
  UserCollectionsData, 
  EMPTY_COLLECTIONS 
} from '../../services/userCollections';

export interface ProfileFrame {
  id: string;
  name: string;
  badge: string;
  description: string;
  requirement: string;
  borderClass: string;
  iconType: string;
  ornamentStyle?: {
    type: 'badge' | 'crown';
    bg: string;
    border: string;
    shadow: string;
    emoji: string;
    animate?: string;
  };
  checkUnlocked?: (collections: UserCollectionsData) => boolean;
}

export const PROFILE_FRAMES: ProfileFrame[] = [
  {
    id: 'none',
    name: 'Klasik PlayMuzeck',
    badge: 'Default',
    description: 'Tampilan minimalis elegan bawaan workstation PlayMuzeck.',
    requirement: 'Terbuka untuk semua pengguna.',
    borderClass: 'border-2 border-white/20 ring-2 ring-[#14213D]',
    iconType: 'none',
  },
  {
    id: 'frame-coffee',
    name: 'Seduhan Kafein',
    badge: 'Secangkir Kopi',
    description: 'Aroma seduhan kopi hangat penyemangat ritme aransemen.',
    requirement: 'Terbuka setelah berdonasi Secangkir Kopi (Rp 10.000).',
    borderClass: 'border-2 border-amber-600 ring-4 ring-amber-900/60 shadow-[0_0_18px_rgba(217,119,6,0.6)]',
    iconType: 'coffee',
  },
  {
    id: 'frame-neon',
    name: 'Voltase Neon Kreatif',
    badge: 'Energi Kreatif',
    description: 'Kilatan petir amber berdaya tinggi yang memicu inspirasi.',
    requirement: 'Terbuka setelah berdonasi Energi Kreatif (Rp 25.000).',
    borderClass: 'border-2 border-yellow-300 ring-4 ring-[#FCA311] shadow-[0_0_22px_rgba(252,163,17,0.85)] animate-pulse',
    iconType: 'neon',
  },
  {
    id: 'frame-warp',
    name: 'Quantum Warp Grid',
    badge: 'Server Boost',
    description: 'Sirkuit matriks kuantum penyokong kecepatan server workstation.',
    requirement: 'Terbuka setelah berdonasi Server Boost (Rp 50.000).',
    borderClass: 'border-2 border-cyan-300 ring-4 ring-cyan-600/80 shadow-[0_0_22px_rgba(6,182,212,0.8)]',
    iconType: 'warp',
  },
  {
    id: 'frame-sultan',
    name: 'Mahkota Imperial Sultan',
    badge: 'Pendukung Sultan',
    description: 'Kemewahan emas murni sang pelindung jagat kreasi seni.',
    requirement: 'Terbuka setelah berdonasi Pendukung Sultan (Rp 100.000).',
    borderClass: 'border-3 border-yellow-200 ring-4 ring-amber-500 shadow-[0_0_30px_rgba(251,191,36,0.95)]',
    iconType: 'sultan',
  },
  {
    id: 'frame-contact',
    name: 'Sinyal Resonansi Pengembang',
    badge: 'Koneksi Developer',
    description: 'Frekuensi radar komunikasi langsung dengan tim pengembang.',
    requirement: 'Terbuka setelah mengirim masukan, ide kustom, atau aduan.',
    borderClass: 'border-2 border-teal-300 ring-4 ring-emerald-600/80 shadow-[0_0_20px_rgba(16,185,129,0.75)]',
    iconType: 'contact',
  },
  {
    id: 'frame-bundle',
    name: 'Hexaprima Omniverse',
    badge: 'Kolektor 6 Produk',
    description: 'Pendaran prisma pelangi holografik penguasa seluruh aset audio.',
    requirement: 'Terbuka setelah memiliki paket bundle lengkap 6 produk.',
    borderClass: 'border-2 border-violet-200 ring-4 ring-pink-500 shadow-[0_0_28px_rgba(236,72,153,0.9)]',
    iconType: 'bundle',
  },
  {
    id: 'frame-olahraga',
    name: 'Gelora Arena Juara',
    badge: 'Tema Olahraga',
    description: 'Aura kobaran semangat atletis, rekor laga, dan kejuaraan akbar dunia.',
    requirement: 'Terbuka setelah membeli kuis tema Olahraga.',
    borderClass: 'border-2 border-emerald-400 ring-4 ring-emerald-950 shadow-[0_0_25px_rgba(52,211,153,0.85)]',
    iconType: 'theme-olahraga',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-emerald-900 via-emerald-600 to-green-400', border: 'border-emerald-200', shadow: 'shadow-[0_0_15px_rgba(16,185,129,0.8)]', emoji: '⚽', animate: 'animate-bounce' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('olahraga'),
  },
  {
    id: 'frame-sehari-hari',
    name: 'Harmoni Graha Harian',
    badge: 'Kehidupan Sehari-hari',
    description: 'Pendar hangat keteraturan domestik, rutinitas cerdas, dan finansial cermat.',
    requirement: 'Terbuka setelah membeli kuis tema Kehidupan Sehari-hari.',
    borderClass: 'border-2 border-amber-300 ring-4 ring-amber-950 shadow-[0_0_24px_rgba(251,191,36,0.85)]',
    iconType: 'theme-sehari-hari',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-amber-900 via-amber-600 to-yellow-300', border: 'border-amber-200', shadow: 'shadow-[0_0_15px_rgba(245,158,11,0.8)]', emoji: '🏠' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('sehari_hari'),
  },
  {
    id: 'frame-alam',
    name: 'Biosfer Belantara Purba',
    badge: 'Tema Alam',
    description: 'Rona zamrud ekosistem belantara bumi, keanekaragaman flora, dan fauna.',
    requirement: 'Terbuka setelah membeli kuis tema Alam.',
    borderClass: 'border-2 border-lime-400 ring-4 ring-green-950 shadow-[0_0_26px_rgba(132,204,22,0.85)]',
    iconType: 'theme-alam',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-green-950 via-emerald-700 to-lime-300', border: 'border-lime-200', shadow: 'shadow-[0_0_16px_rgba(132,204,22,0.85)]', emoji: '🌿', animate: 'animate-pulse' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('alam'),
  },
  {
    id: 'frame-musik',
    name: 'Resonansi Maestro Melodi',
    badge: 'Tema Musik',
    description: 'Gelombang frekuensi nada murni sang maestro instrumen dan partitur melodi.',
    requirement: 'Terbuka setelah membeli kuis tema Musik.',
    borderClass: 'border-2 border-violet-300 ring-4 ring-purple-950 shadow-[0_0_28px_rgba(168,85,247,0.9)] animate-pulse',
    iconType: 'theme-musik',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-purple-950 via-violet-600 to-fuchsia-300', border: 'border-violet-200', shadow: 'shadow-[0_0_18px_rgba(168,85,247,0.9)]', emoji: '🎵' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('musik'),
  },
  {
    id: 'frame-matematika',
    name: 'Fraktal Geometri Kosmis',
    badge: 'Tema Matematika',
    description: 'Presisi kalkulus mutlak, deret aljabar murni, dan keindahan geometri aksiomatik.',
    requirement: 'Terbuka setelah membeli kuis tema Matematika.',
    borderClass: 'border-2 border-sky-300 ring-4 ring-blue-950 shadow-[0_0_25px_rgba(14,165,233,0.85)]',
    iconType: 'theme-matematika',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-blue-950 via-indigo-600 to-cyan-300', border: 'border-cyan-200', shadow: 'shadow-[0_0_15px_rgba(14,165,233,0.85)]', emoji: '📐' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('matematika'),
  },
  {
    id: 'frame-seni',
    name: 'Kanvas Avant-Garde',
    badge: 'Tema Seni',
    description: 'Gradasi palet estetika visual, tata arsitektur megah, dan goresan mahakarya.',
    requirement: 'Terbuka setelah membeli kuis tema Seni.',
    borderClass: 'border-2 border-rose-300 ring-4 ring-rose-950 shadow-[0_0_26px_rgba(244,63,94,0.85)]',
    iconType: 'theme-seni',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-rose-950 via-rose-600 to-pink-300', border: 'border-rose-200', shadow: 'shadow-[0_0_16px_rgba(244,63,94,0.85)]', emoji: '🎨' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('seni'),
  },
  {
    id: 'frame-teknologi',
    name: 'Matriks Sibernetik AI',
    badge: 'Tema Teknologi',
    description: 'Kilau sirkuit semikonduktor masa depan, kecerdasan buatan, dan arsitektur kode.',
    requirement: 'Terbuka setelah membeli kuis tema Teknologi.',
    borderClass: 'border-2 border-cyan-300 ring-4 ring-teal-950 shadow-[0_0_28px_rgba(34,211,238,0.9)] animate-pulse',
    iconType: 'theme-teknologi',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-cyan-950 via-cyan-600 to-teal-200', border: 'border-cyan-200', shadow: 'shadow-[0_0_18px_rgba(34,211,238,0.9)]', emoji: '💻', animate: 'animate-pulse' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('teknologi'),
  },
  {
    id: 'frame-psikologi',
    name: 'Sinapsis Kognisi Jiwa',
    badge: 'Tema Psikologi',
    description: 'Pendar intrik persepsi batin, dinamika emosi, dan kedalaman psikofisik manusia.',
    requirement: 'Terbuka setelah membeli kuis tema Psikologi.',
    borderClass: 'border-2 border-fuchsia-300 ring-4 ring-purple-950 shadow-[0_0_26px_rgba(217,70,239,0.85)]',
    iconType: 'theme-psikologi',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-purple-950 via-fuchsia-600 to-pink-300', border: 'border-fuchsia-200', shadow: 'shadow-[0_0_16px_rgba(217,70,239,0.85)]', emoji: '🧠' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('psikologi'),
  },
  {
    id: 'frame-bahasa',
    name: 'Aksara Poliglot Dunia',
    badge: 'Tema Bahasa',
    description: 'Koleksi glosarium etimologi kuno, sintaksis linguistik, dan aksara peradaban.',
    requirement: 'Terbuka setelah membeli kuis tema Bahasa.',
    borderClass: 'border-2 border-teal-300 ring-4 ring-teal-950 shadow-[0_0_24px_rgba(20,184,166,0.85)]',
    iconType: 'theme-bahasa',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-teal-950 via-teal-600 to-emerald-200', border: 'border-teal-200', shadow: 'shadow-[0_0_15px_rgba(20,184,166,0.85)]', emoji: '🗣️' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('bahasa'),
  },
  {
    id: 'frame-sosial',
    name: 'Episentrum Sosiokultural',
    badge: 'Tema Sosial',
    description: 'Jalinan ikatan peradaban umat manusia, sosiologi, dan sejarah pergerakan dunia.',
    requirement: 'Terbuka setelah membeli kuis tema Sosial.',
    borderClass: 'border-2 border-orange-300 ring-4 ring-orange-950 shadow-[0_0_25px_rgba(249,115,22,0.85)]',
    iconType: 'theme-sosial',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-orange-950 via-orange-600 to-amber-200', border: 'border-orange-200', shadow: 'shadow-[0_0_16px_rgba(249,115,22,0.85)]', emoji: '👥' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('sosial'),
  },
  {
    id: 'frame-fiksi',
    name: 'Mitologi Arkana Kosmik',
    badge: 'Tema Fiksi',
    description: 'Gerbang narasi fajar fantasi, legenda semesta novel, dan karakter kisah epik.',
    requirement: 'Terbuka setelah membeli kuis tema Fiksi.',
    borderClass: 'border-2 border-indigo-300 ring-4 ring-indigo-950 shadow-[0_0_28px_rgba(99,102,241,0.9)]',
    iconType: 'theme-fiksi',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-indigo-950 via-indigo-600 to-purple-300', border: 'border-indigo-200', shadow: 'shadow-[0_0_18px_rgba(99,102,241,0.9)]', emoji: '📖', animate: 'animate-pulse' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('fiksi'),
  },
  {
    id: 'frame-lainnya',
    name: 'Enigma Spektrum Semesta',
    badge: 'Tema Lainnya',
    description: 'Khazanah trivia tak terduga, ensiklopedia serbaneka, dan wawasan pengetahuan unik.',
    requirement: 'Terbuka setelah membeli kuis tema Lainnya.',
    borderClass: 'border-2 border-yellow-200 ring-4 ring-amber-950 shadow-[0_0_25px_rgba(234,179,8,0.85)]',
    iconType: 'theme-lainnya',
    ornamentStyle: { type: 'badge', bg: 'bg-gradient-to-tr from-amber-950 via-yellow-500 to-amber-100', border: 'border-yellow-200', shadow: 'shadow-[0_0_16px_rgba(234,179,8,0.85)]', emoji: '✨' },
    checkUnlocked: (col) => col.quiz.purchasedThemeIds.includes('lainnya'),
  },
  {
    id: 'frame-quiz-editor',
    name: 'Mahkota Arsitek Kuis',
    badge: 'Quiz Editor Suite',
    description: 'Mahkota megah perancang kuis mandiri dengan kendali mutlak 12 tema, media, dan sistem skor.',
    requirement: 'Terbuka setelah membeli lisensi Quiz Editor (Rp 10.000).',
    borderClass: 'border-3 border-red-400 ring-4 ring-[#FC1212] shadow-[0_0_35px_rgba(252,18,18,0.95)] animate-pulse',
    iconType: 'quiz-editor-crown',
    ornamentStyle: { type: 'crown', bg: 'bg-gradient-to-r from-red-800 via-[#FC1212] to-amber-500', border: 'border-yellow-200', shadow: 'shadow-[0_0_24px_rgba(252,18,18,1)]', emoji: '👑', animate: 'animate-pulse' },
    checkUnlocked: (col) => col.features.quizEditor,
  },
];

export interface FrameOrnamentProps {
  iconType?: string;
  frame?: ProfileFrame;
  size: 'lg' | 'sm';
}

export const FrameOrnament: React.FC<FrameOrnamentProps> = ({ iconType: propIconType, frame: propFrame, size }) => {
  const isLg = size === 'lg';
  const frameObj = propFrame || PROFILE_FRAMES.find((f) => f.iconType === propIconType || f.id === propIconType) || null;
  const currentIcon = frameObj?.iconType || propIconType || 'none';

  if (currentIcon === 'none') return null;

  if (frameObj?.ornamentStyle?.type === 'crown' || currentIcon === 'quiz-editor-crown') {
    const orn = frameObj?.ornamentStyle;
    return (
      <div
        className={`absolute ${isLg ? '-top-4 left-1/2 -translate-x-1/2 px-2.5 py-0.5' : '-top-2.5 left-1/2 -translate-x-1/2 px-1.5 py-0.2'} rounded-full ${orn?.bg || 'bg-gradient-to-r from-red-700 via-[#FC1212] to-amber-500'} border ${orn?.border || 'border-yellow-200'} flex items-center justify-center gap-1 ${orn?.shadow || 'shadow-[0_0_20px_rgba(252,18,18,1)]'} ${orn?.animate || 'animate-pulse'} z-10`}
        title={frameObj?.name || 'Mahkota Arsitek Kuis'}
      >
        <Crown className={`${isLg ? 'w-4 h-4' : 'w-2.5 h-2.5'} text-yellow-200 fill-yellow-200`} />
        <span className={`${isLg ? 'text-[10px]' : 'text-[8px]'} font-black text-white font-mono`}>EDITOR</span>
      </div>
    );
  }

  if (frameObj?.ornamentStyle?.type === 'badge') {
    const orn = frameObj.ornamentStyle;
    return (
      <div className={`absolute ${isLg ? '-top-2.5 -right-2.5 w-7 h-7 text-xs' : '-top-1.5 -right-1.5 w-4 h-4 text-[9px]'} rounded-full ${orn.bg} border ${orn.border} flex items-center justify-center shadow-lg ${orn.shadow} ${orn.animate || ''} z-10`} title={frameObj.name}>
        <span>{orn.emoji}</span>
      </div>
    );
  }

  switch (currentIcon) {
    case 'coffee': return <div className={`absolute ${isLg ? '-top-2.5 -right-2.5 w-7 h-7' : '-top-1.5 -right-1.5 w-4 h-4'} rounded-full bg-amber-950 border border-amber-500 flex items-center justify-center shadow-lg shadow-amber-900/80 z-10`}><Coffee className={`${isLg ? 'w-3.5 h-3.5' : 'w-2 h-2'} text-amber-300 fill-amber-700/40`} /></div>;
    case 'neon': return <div className={`absolute ${isLg ? '-top-2.5 -right-2.5 w-7 h-7' : '-top-1.5 -right-1.5 w-4 h-4'} rounded-full bg-yellow-400 border border-amber-100 flex items-center justify-center shadow-lg shadow-yellow-500/90 animate-bounce z-10`}><Zap className={`${isLg ? 'w-3.5 h-3.5' : 'w-2 h-2'} text-black fill-black`} /></div>;
    case 'warp': return <div className={`absolute ${isLg ? '-top-2.5 -right-2.5 w-7 h-7' : '-top-1.5 -right-1.5 w-4 h-4'} rounded-full bg-cyan-950 border border-cyan-300 flex items-center justify-center shadow-lg shadow-cyan-500/80 z-10`}><Orbit className={`${isLg ? 'w-3.5 h-3.5' : 'w-2 h-2'} text-cyan-300 animate-spin`} style={{ animationDuration: '6s' }} /></div>;
    case 'sultan': return <div className={`absolute ${isLg ? '-top-4 left-1/2 -translate-x-1/2 px-2 py-0.5' : '-top-2.5 left-1/2 -translate-x-1/2 px-1 py-0.2'} rounded-full bg-gradient-to-r from-amber-300 via-yellow-400 to-amber-500 border border-yellow-100 flex items-center justify-center shadow-lg shadow-amber-500/90 z-10`}><Crown className={`${isLg ? 'w-4 h-4' : 'w-2.5 h-2.5'} text-yellow-950 fill-yellow-950`} /></div>;
    case 'contact': return <div className={`absolute ${isLg ? '-top-2.5 -right-2.5 w-7 h-7' : '-top-1.5 -right-1.5 w-4 h-4'} rounded-full bg-emerald-950 border border-teal-300 flex items-center justify-center shadow-lg shadow-emerald-500/80 animate-pulse z-10`}><Radio className={`${isLg ? 'w-3.5 h-3.5' : 'w-2 h-2'} text-teal-300`} /></div>;
    case 'bundle': return <div className={`absolute ${isLg ? '-top-2.5 -right-2.5 w-7 h-7' : '-top-1.5 -right-1.5 w-4 h-4'} rounded-full bg-gradient-to-tr from-violet-600 via-pink-500 to-amber-400 border border-white flex items-center justify-center shadow-lg shadow-pink-500/80 z-10`}><Gem className={`${isLg ? 'w-3.5 h-3.5' : 'w-2 h-2'} text-white fill-white/80`} /></div>;
    default: return null;
  }
};

interface ProfileDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  userSession: UserSession;
  catalogTracks: AudioTrackItem[];
  onPlayDeck: (deck: Deck) => void;
  onNavigateAudio: () => void;
  onLoginRequest: () => void;
  onLogout: () => void;
  onUpdateProfile?: (updated: { name: string; email: string; avatarUrl?: string; frameId?: string }) => void;
  onSuccessToast: (msg: string) => void;
}

type ProfileTab = 'collection' | 'frames' | 'donate' | 'contact';

export const ProfileDashboardModal: React.FC<ProfileDashboardModalProps> = ({
  isOpen,
  onClose,
  userSession,
  catalogTracks,
  onPlayDeck,
  onNavigateAudio,
  onLoginRequest,
  onLogout,
  onUpdateProfile,
  onSuccessToast,
}) => {
  const [activeTab, setActiveTab] = useState<ProfileTab>('collection');
  const [dbData, setDbData] = useState<UserCollectionsData>(EMPTY_COLLECTIONS);
  const [isDbLoading, setIsDbLoading] = useState(true);

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editName, setEditName] = useState(userSession.name || '');
  const [editEmail, setEditEmail] = useState(userSession.email || '');
  const [editAvatar, setEditAvatar] = useState<string>((userSession as any).avatarUrl || '');
  const [activeFrameId, setActiveFrameId] = useState<string>('none');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [randomGreeting, setRandomGreeting] = useState('');

  // SINKRONISASI DATABASE POSTGRESQL SAAT MODAL DIBUKA
  useEffect(() => {
    let isMounted = true;
    if (isOpen) {
      setEditName(userSession.name || '');
      setEditEmail(userSession.email || '');
      setEditAvatar((userSession as any).avatarUrl || '');
      setIsEditingProfile(false);

      const displayName = userSession.name || (userSession.isLoggedIn ? 'Maestro' : 'Tamu');
      const GREETINGS = [
        `Ketukan baru menantimu, ${displayName}!`,
        `Selamat berkarya, Sang Maestro ${displayName}!`,
        `Ide brilian apa yang akan kamu ciptakan, ${displayName}?`,
        `Suara dan wawasan terbaik ada di tanganmu, ${displayName}!`
      ];
      setRandomGreeting(GREETINGS[Math.floor(Math.random() * GREETINGS.length)]);

      // PROTEKSI TAMU MURNI
      if (!userSession.isLoggedIn || !userSession.email) {
        if (isMounted) {
          setDbData(EMPTY_COLLECTIONS);
          setActiveFrameId('none');
          setIsDbLoading(false);
        }
        return;
      }

      // FETCH KE POSTGRESQL MELALUI API
      setIsDbLoading(true);
      fetchUserCollectionsFromDB(userSession.email)
        .then((data) => {
          if (isMounted) {
            setDbData(data);
            setActiveFrameId(data.frames.activeId || 'none');
          }
        })
        .finally(() => {
          if (isMounted) setIsDbLoading(false);
        });
    }
    return () => { isMounted = false; };
  }, [isOpen, userSession.isLoggedIn, userSession.email, userSession.name]);

  // Dipakai ulang setelah aksi yang mengubah data di server (donasi, kirim
  // masukan, pasang bingkai) supaya Album Bingkai & Koleksi Saya langsung
  // konsisten dengan database tanpa perlu menutup-buka modal ini lagi.
  const refetchCollections = async () => {
    if (!userSession.isLoggedIn || !userSession.email) return;
    try {
      const data = await fetchUserCollectionsFromDB(userSession.email);
      setDbData(data);
    } catch {}
  };

  const [selectedAmount, setSelectedAmount] = useState<number>(25000);
  const [customAmount, setCustomAmount] = useState<string>('');

  const [feedbackCategory, setFeedbackCategory] = useState<'feedback' | 'custom' | 'report' | 'other'>('feedback');
  const [contactSubject, setContactSubject] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [isSendingContact, setIsSendingContact] = useState(false);

  // Dipindah ke sini: SEMUA hook wajib berada di atas `if (!isOpen) return null`.
  // Sebelumnya dideklarasikan setelah early return sehingga jumlah hook berubah
  // antar render (isOpen false -> true) dan memicu "Rendered more hooks".
  const [isSendingDonation, setIsSendingDonation] = useState(false);
  const [donationStep, setDonationStep] = useState<'form' | 'qris'>('form');
  const [donationOrderId, setDonationOrderId] = useState<string | null>(null);
  const [donationError, setDonationError] = useState<string | null>(null);

  // PERBAIKAN: kuis buatan sendiri kini dikirim ke database secara otomatis
  // saat dibuat (lihat handleDeckCreatedOrUpdated di App.tsx -> POST
  // /api/user/decks), jadi untuk deck BARU cukup dbData.quiz.decks saja yang
  // sudah akurat. Merge dengan storage.getCustomDecks() di bawah ini
  // dipertahankan hanya sebagai fallback kompatibilitas untuk deck LAMA yang
  // sempat dibuat sebelum perbaikan ini dan masih tersangkut di
  // localStorage — supaya tidak tiba-tiba hilang dari tampilan pengguna.
  const mergedQuizDecks = useMemo(() => {
    const customDecks = userSession.isLoggedIn ? storage.getCustomDecks() : [];
    const dbDecks = dbData.quiz.decks || [];
    const dbIds = new Set(dbDecks.map((d) => d.id));

    // PERBAIKAN: deck BAWAAN yang dibeli hanya tercatat sebagai ID di
    // user_collections (tabel `decks` di database tidak menyimpan deck bawaan),
    // sehingga dbData.quiz.decks selalu kosong untuknya dan kuis yang sudah
    // dibeli tidak pernah muncul di Koleksi Saya. Sekarang ID yang dimiliki
    // (deck atau topiknya) dicocokkan ke daftar deck bawaan.
    const ownedDeckIds = new Set(dbData.quiz.deckIds || []);
    const ownedTopicIds = new Set(dbData.quiz.topicIds || []);
    const ownedBuiltin = userSession.isLoggedIn
      ? BUILTIN_DECKS.filter(
          (d) =>
            !d.isFree &&
            !dbIds.has(d.id) &&
            (ownedDeckIds.has(d.id) || Boolean(d.topicId && ownedTopicIds.has(d.topicId)))
        )
      : [];

    const knownIds = new Set([...dbIds, ...ownedBuiltin.map((d) => d.id)]);
    return [...dbDecks, ...ownedBuiltin, ...customDecks.filter((d) => !knownIds.has(d.id))];
  }, [dbData.quiz, userSession.isLoggedIn]);

  // Perhitungan dinamis jumlah koleksi berdasarkan data DB yang murni
  const totalUnlockedFrames = useMemo(() => {
    if (!userSession.isLoggedIn) return 1;
    return PROFILE_FRAMES.filter((f) => {
      if (typeof f.checkUnlocked === 'function') return f.checkUnlocked(dbData);
      return dbData.frames.unlockedIds.includes(f.id);
    }).length;
  }, [dbData, userSession.isLoggedIn]);

  const totalCollectionCount = useMemo(() => {
    if (!userSession.isLoggedIn) return 0;
    return (
      dbData.audio.totalCount +
      mergedQuizDecks.length +
      (dbData.features.full16BarEditor ? 1 : 0) +
      (dbData.features.audioToolsSuite ? 1 : 0) +
      (dbData.features.quizEditor ? 1 : 0)
    );
  }, [dbData, mergedQuizDecks, userSession.isLoggedIn]);

  if (!isOpen) return null;

  const userInitial = (editName || userSession.name || (userSession.isLoggedIn ? 'M' : 'T')).charAt(0).toUpperCase();

  const currentActiveFrameId = userSession.isLoggedIn ? activeFrameId : 'none';
  const currentFrameObj = PROFILE_FRAMES.find((f) => f.id === currentActiveFrameId) || PROFILE_FRAMES[0];

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      alert('Ukuran foto maksimal 3MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setEditAvatar(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) return alert('Nama pengguna tidak boleh kosong.');
    if (onUpdateProfile) {
      onUpdateProfile({ name: editName.trim(), email: userSession.email, avatarUrl: editAvatar, frameId: activeFrameId }); // email TIDAK boleh diubah dari sini
    }
    setIsEditingProfile(false);
    onSuccessToast('Informasi akun berhasil disimpan!');
  };

  const handleEquipFrame = async (frame: ProfileFrame) => {
    if (!userSession.isLoggedIn) return alert('Silakan masuk ke akun terlebih dahulu.');
    const previousFrameId = activeFrameId;
    setActiveFrameId(frame.id);

    try {
      const res = await fetch('/api/user/frame', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userSession.email, frameId: frame.id })
      });
      if (!res.ok) throw new Error('Gagal tersimpan di server');
      if (onUpdateProfile) {
        onUpdateProfile({ name: editName || userSession.name, email: editEmail || userSession.email, avatarUrl: editAvatar, frameId: frame.id });
      }
      onSuccessToast(`Bingkai "${frame.name}" berhasil dipasang!`);
    } catch {
      // PERBAIKAN: sebelumnya kegagalan di sini diabaikan diam-diam (state
      // lokal tetap berubah walau server gagal menyimpan), sehingga bingkai
      // kembali ke 'Klasik PlayMuzeck' begitu modal dibuka ulang tanpa
      // pemberitahuan yang jelas. Sekarang perubahan lokal dibatalkan lagi
      // supaya tampilan selalu konsisten dengan apa yang benar-benar
      // tersimpan di database.
      setActiveFrameId(previousFrameId);
      onSuccessToast('Gagal menyinkronkan bingkai ke server. Coba lagi.');
    }
  };

  const handleLoadDeckToPlaySegment = (deck: Deck) => {
    onClose();
    localStorage.setItem('muzeck_selected_quiz_deck_id', deck.id);
    localStorage.setItem('muzeck_active_quiz_segment', 'play');
    window.dispatchEvent(new CustomEvent('muzeck:navigate-quiz-play', { detail: { deckId: deck.id, deck } }));
    window.dispatchEvent(new CustomEvent('muzeck:switch-tab', { detail: 'quiz' }));
    if (onSuccessToast) onSuccessToast(`Paket "${deck.title}" dimuat ke sesi Mainkan Kuis!`);
  };

  // PERBAIKAN: sebelumnya fungsi ini hanya `setTimeout` + toast, TIDAK
  // PERNAH benar-benar mengirim apapun ke server. Sekarang masukan/aduan
  // sungguhan tersimpan ke tabel `inquiries`, dan bingkai "Sinyal Resonansi
  // Pengembang" langsung terbuka + Album Bingkai ikut ter-refresh.
  const handleSendContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userSession.isLoggedIn || !userSession.email) {
      onSuccessToast('Silakan masuk ke akun terlebih dahulu untuk mengirim masukan.');
      return;
    }
    if (!contactMessage.trim()) {
      onSuccessToast('Tuliskan pesan masukan/aduanmu terlebih dahulu.');
      return;
    }
    setIsSendingContact(true);
    try {
      const res = await fetch('/api/user/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userSession.email,
          category: feedbackCategory,
          subject: contactSubject.trim() || undefined,
          message: contactMessage.trim(),
        }),
      });
      if (!res.ok) throw new Error('Gagal terkirim');
      setContactSubject('');
      setContactMessage('');
      await refetchCollections();
      onSuccessToast('Terima kasih! Pesan dan masukan Anda telah kami terima.');
    } catch {
      onSuccessToast('Gagal mengirim masukan. Periksa koneksi Anda dan coba lagi.');
    } finally {
      setIsSendingContact(false);
    }
  };

  // PERBAIKAN: sebelumnya donasi hanya menampilkan toast tanpa tersimpan di
  // manapun ("Konten bagian donasi... hilang" juga karena seluruh markup tab
  // ini sebelumnya kosong / placeholder komentar). Sekarang jumlah donasi
  // benar-benar dicatat ke tabel `donations`, dan bingkai sesuai tingkatan
  // nominal langsung terbuka untuk akun yang sedang login.
  const getDonationAmount = () => (customAmount ? Number(customAmount) : selectedAmount);

  // Mencatat donasi ke database HANYA setelah pembayaran QRIS terkonfirmasi.
  // Sebelumnya tombol donasi langsung memanggil /api/user/donate tanpa
  // pembayaran apa pun, sehingga bingkai eksklusif terbuka gratis.
  const recordDonation = async (orderId: string, amount: number) => {
    setDonationError(null);
    setIsSendingDonation(true);
    try {
      const res = await fetch('/api/user/donate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userSession.email, amount, orderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setCustomAmount('');
      setDonationStep('form');
      setDonationOrderId(null);
      await refetchCollections();
      const unlockedFrame = PROFILE_FRAMES.find((f) => f.id === data.unlockedFrameId);
      onSuccessToast(
        unlockedFrame
          ? `Terima kasih atas donasimu! Bingkai "${unlockedFrame.name}" telah terbuka di Album Bingkai.`
          : 'Terima kasih banyak atas donasi dan dukungan hangat Anda!'
      );
    } catch (err: any) {
      setDonationError(`Gagal mencatat donasi: ${err?.message || 'periksa koneksi Anda'} (Order: ${orderId})`);
      setDonationStep('qris');
    } finally {
      setIsSendingDonation(false);
    }
  };

  const handleStartDonation = async () => {
    if (!userSession.isLoggedIn || !userSession.email) {
      onSuccessToast('Silakan masuk ke akun terlebih dahulu untuk berdonasi.');
      return;
    }
    const amount = getDonationAmount();
    if (!amount || amount < 1000) {
      onSuccessToast('Masukkan nominal donasi yang valid (minimal Rp1.000).');
      return;
    }

    const orderId = `DON-MUZ-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    setDonationOrderId(orderId);
    setDonationError(null);
    setIsSendingDonation(true);

    const snapOpened = await payWithQris(
      {
        orderId,
        amount,
        customer: { name: userSession.name || 'Donatur', email: userSession.email },
        items: [{ id: orderId, title: 'Donasi PlayMuzeck', price: amount, quantity: 1, category: 'donation' }],
      },
      {
        onSuccess: () => { recordDonation(orderId, amount); },
        onPending: () => {
          setIsSendingDonation(false);
          setDonationStep('qris');
          onSuccessToast('Menunggu Anda menyelesaikan pembayaran QRIS...');
        },
        onError: (msg) => {
          setIsSendingDonation(false);
          onSuccessToast(msg || 'Pembayaran QRIS gagal atau dibatalkan.');
        },
        onClose: () => setIsSendingDonation(false),
      }
    );

    if (!snapOpened) {
      setIsSendingDonation(false);
      const st = await getPaymentStatus();
      if (st.mode !== 'demo') {
        onSuccessToast('Pembayaran online belum aktif di server ini. Hubungi admin.');
        return;
      }
      setDonationStep('qris'); // panel lokal hanya untuk mode demo
    }
  };

  const handleGoogleLogin = () => {
    if (onUpdateProfile) {
      onUpdateProfile({ name: editName || 'Google User', email: editEmail || 'user@gmail.com', avatarUrl: editAvatar, frameId: 'none' });
    }
    onSuccessToast('Berhasil masuk dengan Akun Google!');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
      <div className="w-full max-w-2xl max-h-[92vh] rounded-3xl bg-[#14213D] border border-white/[0.12] shadow-2xl relative flex flex-col overflow-hidden">
        <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-xl bg-black/40 text-gray-400 hover:text-white hover:bg-black/70 transition-colors z-20 cursor-pointer">
          <X className="w-4 h-4" />
        </button>

        {/* 1. HEADER AVATAR */}
        <div className="shrink-0 p-6 sm:p-7 bg-gradient-to-b from-black/85 to-transparent border-b border-white/[0.08] flex flex-col sm:flex-row items-center sm:items-start gap-5 text-center sm:text-left">
          <div className="relative shrink-0">
            <FrameOrnament frame={currentFrameObj} size="lg" />

            <div className={`w-20 h-20 sm:w-22 sm:h-22 rounded-2xl flex items-center justify-center text-black font-black text-3xl shadow-xl overflow-hidden transition-all bg-[#0a1120] ${currentFrameObj.borderClass}`}>
              {editAvatar ? (
                <img src={editAvatar} alt="Foto Profil" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gradient-to-tr from-[#FCA311] via-amber-300 to-amber-500 flex items-center justify-center text-black font-black text-3xl">
                  {userInitial}
                </div>
              )}
            </div>

            {isEditingProfile && (
              <div className="absolute inset-0 bg-black/70 rounded-2xl flex items-center justify-center gap-2 z-20">
                <button type="button" onClick={() => fileInputRef.current?.click()} className="p-1.5 rounded-lg bg-[#FCA311] text-black hover:bg-amber-400 transition-colors cursor-pointer" title="Ganti Foto Profil">
                  <Camera className="w-4 h-4" />
                </button>
              </div>
            )}

            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
          </div>

          <div className="space-y-1.5 flex-1 min-w-0">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#FCA311]/15 text-[#FCA311] text-xs font-black tracking-wide border border-[#FCA311]/30 animate-pulse">
              <Sparkles className="w-3.5 h-3.5" />
              <span>{randomGreeting}</span>
            </div>

            <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight truncate">
                {editName || userSession.name || (userSession.isLoggedIn ? 'Pengguna PlayMuzeck' : 'Tamu PlayMuzeck')}
              </h2>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {userSession.isLoggedIn ? 'Terverifikasi' : 'Tamu'}
              </span>

              <button type="button" onClick={() => setIsEditingProfile(!isEditingProfile)} className={`p-1.5 rounded-lg transition-colors cursor-pointer ${isEditingProfile ? 'bg-[#FCA311] text-black' : 'bg-white/10 hover:bg-[#FCA311] hover:text-black text-gray-300'}`} title="Ubah Foto, Username, dan Email">
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center justify-center sm:justify-start gap-2 text-xs text-gray-400">
              <span className="truncate">{editEmail || userSession.email || 'Mode Tamu Offline-First'}</span>
              <span className="text-gray-600">•</span>
              <span className="text-[#FCA311] font-mono font-bold text-[11px] truncate">
                Bingkai: {currentFrameObj.name}
              </span>
            </div>
          </div>
        </div>

        {/* 2. FORM EDIT PROFIL */}
        {isEditingProfile && (
          <form onSubmit={handleSaveProfile} className="shrink-0 p-4 bg-black/60 border-b border-white/[0.08] space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1 border-b border-white/10 text-xs">
              <span className="font-bold text-[#FCA311]">Edit Informasi Akun & Foto Profil</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-gray-300 font-bold">Nama / Username:</label>
                <input type="text" required value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full bg-black/50 border border-white/15 focus:border-[#FCA311] rounded-lg px-3 py-1.5 text-white outline-none" />
              </div>
              <div className="space-y-1">
                <label className="text-gray-300 font-bold">Email Pengguna:</label>
                <input type="email" value={editEmail} readOnly title="Email akun tidak dapat diubah" placeholder="email@domain.com" className="w-full bg-black/50 border border-white/15 focus:border-[#FCA311] rounded-lg px-3 py-1.5 text-white outline-none" />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button type="button" onClick={() => setIsEditingProfile(false)} className="px-3 py-1 rounded-lg bg-white/10 text-gray-300 hover:text-white text-xs font-bold cursor-pointer">Batal</button>
              <button type="submit" className="px-4 py-1 rounded-lg bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-xs flex items-center gap-1.5 cursor-pointer">
                <Check className="w-3.5 h-3.5" /> Simpan Perubahan
              </button>
            </div>
          </form>
        )}

        {/* 3. TAB NAVIGASI */}
        <div className="shrink-0 flex items-center border-b border-white/[0.08] bg-black/40 px-6 overflow-x-auto no-scrollbar">
          <button type="button" onClick={() => setActiveTab('collection')} className={`py-3 px-3.5 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'collection' ? 'border-[#FCA311] text-[#FCA311]' : 'border-transparent text-gray-400 hover:text-white'}`}>
            <Library className="w-4 h-4" /> Koleksi Saya
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/10 text-white font-mono">{totalCollectionCount}</span>
          </button>
          <button type="button" onClick={() => setActiveTab('frames')} className={`py-3 px-3.5 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'frames' ? 'border-[#FCA311] text-[#FCA311]' : 'border-transparent text-gray-400 hover:text-white'}`}>
            <Award className="w-4 h-4 text-amber-400" /> Album Bingkai
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-300 font-mono">{totalUnlockedFrames}/{PROFILE_FRAMES.length}</span>
          </button>
          <button type="button" onClick={() => setActiveTab('donate')} className={`py-3 px-3.5 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'donate' ? 'border-[#FCA311] text-[#FCA311]' : 'border-transparent text-gray-400 hover:text-white'}`}>
            <Heart className="w-4 h-4 text-rose-400" /> Donasi & Dukungan
          </button>
          <button type="button" onClick={() => setActiveTab('contact')} className={`py-3 px-3.5 text-xs font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer whitespace-nowrap ${activeTab === 'contact' ? 'border-[#FCA311] text-[#FCA311]' : 'border-transparent text-gray-400 hover:text-white'}`}>
            <MessageSquare className="w-4 h-4 text-sky-400" /> Hubungi Kami
          </button>
        </div>

        {/* 4. KONTEN TAB UTAMA */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isDbLoading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <Loader2 className="w-10 h-10 text-[#FCA311] animate-spin" />
              <p className="text-sm font-bold text-gray-400 animate-pulse">Menyinkronkan data dari PostgreSQL...</p>
            </div>
          ) : activeTab === 'collection' ? (
            <div className="space-y-5 animate-in fade-in duration-300">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-[#FCA311] flex items-center justify-center"><Sliders className="w-4 h-4" /></div>
                    <div>
                      <h4 className="text-xs font-bold text-white leading-tight">Full 16-Bar Editor</h4>
                      <p className="text-[10px] text-gray-400">Status: {dbData.features.full16BarEditor ? 'Aktif' : 'Belum Aktif'}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold font-mono ${dbData.features.full16BarEditor ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400'}`}>{dbData.features.full16BarEditor ? 'AKTIF' : 'BELUM AKTIF'}</span>
                </div>

                <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-cyan-500/15 text-cyan-400 flex items-center justify-center"><Wrench className="w-4 h-4" /></div>
                    <div>
                      <h4 className="text-xs font-bold text-white leading-tight">Audio Tools Suite</h4>
                      <p className="text-[10px] text-gray-400">Status: {dbData.features.audioToolsSuite ? 'Aktif' : 'Belum Aktif'}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold font-mono ${dbData.features.audioToolsSuite ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400'}`}>{dbData.features.audioToolsSuite ? 'AKTIF' : 'BELUM AKTIF'}</span>
                </div>

                <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[#FC1212]/15 text-[#FC1212] flex items-center justify-center"><Edit3 className="w-4 h-4" /></div>
                    <div>
                      <h4 className="text-xs font-bold text-white leading-tight">Quiz Editor</h4>
                      <p className="text-[10px] text-gray-400">Status: {dbData.features.quizEditor ? 'Aktif' : 'Belum Aktif'}</p>
                    </div>
                  </div>
                  <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold font-mono ${dbData.features.quizEditor ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-white/5 text-gray-400'}`}>{dbData.features.quizEditor ? 'AKTIF' : 'BELUM AKTIF'}</span>
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">KOLEKSI AUDIO ({dbData.audio.totalCount})</span>
                {dbData.audio.totalCount === 0 ? (
                  <div className="p-4 rounded-xl bg-black/30 border border-dashed border-white/10 text-center space-y-2">
                    <p className="text-xs text-gray-400">{userSession.isLoggedIn ? 'Belum ada audio yang dibeli dari Database.' : 'Belum ada audio yang dibeli. Masuk ke akun Anda.'}</p>
                    {userSession.isLoggedIn && (
                      <button onClick={() => { onClose(); onNavigateAudio(); }} className="px-3 py-1.5 rounded-lg bg-[#FCA311]/20 hover:bg-[#FCA311] text-[#FCA311] hover:text-black text-xs font-bold transition-colors cursor-pointer">Buka Katalog Audio Studio →</button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {dbData.audio.items.map(({ track, ownership }) => (
                      <div key={track.id} className="p-3 rounded-xl bg-black/40 border border-white/[0.06] flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <Music className="w-4 h-4 text-[#FCA311] shrink-0" />
                          <div className="truncate">
                            <h5 className="text-xs font-bold text-white truncate">{track.title}</h5>
                            <p className="text-[10px] text-gray-400 truncate font-mono">
                              {[ownership.fullMaster && 'Master', ownership.loopVersion && 'Loop', ownership.separatedStems && 'Stems', ownership.sheetMusic && 'Partitur'].filter(Boolean).join(' • ')}
                            </p>
                          </div>
                        </div>
                        <button onClick={() => { onClose(); onNavigateAudio(); }} className="px-3 py-1 rounded-lg bg-white/10 hover:bg-[#FCA311] text-white hover:text-black text-xs font-bold transition-colors cursor-pointer shrink-0">Buka</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">KOLEKSI KUIS ({mergedQuizDecks.length})</span>
                {mergedQuizDecks.length === 0 ? (
                  <div className="p-4 rounded-xl bg-black/30 border border-dashed border-white/10 text-center space-y-2">
                    <p className="text-xs text-gray-400">{userSession.isLoggedIn ? 'Belum ada kuis yang dibeli atau dibuat oleh akun ini.' : 'Masuk ke akun Anda untuk melihat koleksi kuis.'}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {mergedQuizDecks.map((deck) => (
                      <div key={deck.id} className="p-3 rounded-xl bg-black/40 border border-white/[0.06] flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <h5 className="text-xs font-bold text-white truncate">{deck.title}</h5>
                          <span className="text-[10px] text-gray-400">Deck Kuis Siap Dimainkan</span>
                        </div>
                        <button type="button" onClick={() => handleLoadDeckToPlaySegment(deck)} className="px-3 py-1.5 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shrink-0 shadow-md shadow-red-600/20 active:scale-95">
                          <ArrowRight className="w-3.5 h-3.5" /> Muat
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : activeTab === 'frames' ? (
            <div className="space-y-4 animate-in fade-in duration-300">
              <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-purple-500/10 to-transparent border border-amber-500/30 space-y-1">
                <h4 className="text-sm font-black text-white flex items-center gap-2"><Award className="w-4 h-4 text-amber-400" /> Album Bingkai Kehormatan</h4>
                <p className="text-xs text-gray-300 leading-relaxed">{userSession.isLoggedIn ? 'Setiap bingkai dilengkapi lencana tematik unik yang tersimpan di Database.' : 'Masuk ke akun Anda untuk mulai mengoleksi bingkai kehormatan melalui donasi atau pembelian kuis.'}</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {PROFILE_FRAMES.map((frame) => {
                  const isUnlocked = !userSession.isLoggedIn ? frame.id === 'none' : typeof frame.checkUnlocked === 'function' ? frame.checkUnlocked(dbData) : dbData.frames.unlockedIds.includes(frame.id);
                  const isEquipped = currentActiveFrameId === frame.id;
                  return (
                    <div key={frame.id} className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 relative ${isEquipped ? 'bg-amber-500/10 border-[#FCA311]' : isUnlocked ? 'bg-black/50 border-white/10 hover:border-white/25' : 'bg-black/30 border-white/[0.04] opacity-75'}`}>
                      <div className="flex items-start gap-3.5">
                        <div className="relative shrink-0 pt-1">
                          <FrameOrnament frame={frame} size="sm" />
                          <div className={`w-13 h-13 rounded-xl flex items-center justify-center text-black font-black text-sm overflow-hidden bg-[#0a1120] ${frame.borderClass}`}>
                            {editAvatar ? <img src={editAvatar} alt="Pratinjau" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-gradient-to-tr from-[#FCA311] via-amber-300 to-amber-500 flex items-center justify-center text-black font-black text-base">{userInitial}</div>}
                          </div>
                        </div>
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <h5 className="text-xs font-bold text-white truncate">{frame.name}</h5>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-gray-300 shrink-0">{frame.badge}</span>
                          </div>
                          <p className="text-[11px] text-gray-400 leading-tight">{frame.description}</p>
                          <p className="text-[10px] text-amber-300 font-medium pt-0.5">{frame.requirement}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-white/5">
                        <div className="flex items-center gap-1 text-[10px] font-bold">
                          {isEquipped ? <span className="text-emerald-400 flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Dipakai</span> : isUnlocked ? <span className="text-[#FCA311]">Terbuka</span> : <span className="text-gray-500 flex items-center gap-1"><Lock className="w-3 h-3" /> Terkunci</span>}
                        </div>
                        {isUnlocked ? (
                          <button type="button" disabled={isEquipped} onClick={() => handleEquipFrame(frame)} className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${isEquipped ? 'bg-white/5 text-gray-500 cursor-not-allowed' : 'bg-[#FCA311] hover:bg-[#e58e00] text-black font-black'}`}>{isEquipped ? 'Aktif' : 'Pakai Bingkai'}</button>
                        ) : <span className="text-[10px] text-gray-500 italic">Selesaikan Misi</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeTab === 'donate' ? (
            <div className="space-y-5 animate-in fade-in duration-300">
               <div className="p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 via-rose-500/10 to-transparent border border-[#FCA311]/30 space-y-1.5">
                <h4 className="text-sm font-black text-white flex items-center gap-2"><Heart className="w-4 h-4 text-rose-400 fill-current" /> Dukung Kelangsungan Server PlayMuzeck</h4>
                <p className="text-xs text-gray-300 leading-relaxed">Donasi sukarela Anda langsung dialokasikan untuk pemeliharaan database PostgreSQL, bank instrumen, dan pengembangan fitur baru. Setiap tingkatan nominal membuka bingkai profil eksklusif di Album Bingkai.</p>
              </div>

              {!userSession.isLoggedIn ? (
                <div className="p-5 rounded-2xl bg-black/30 border border-dashed border-white/10 text-center space-y-2">
                  <p className="text-xs text-gray-400">Masuk ke akun Anda terlebih dahulu untuk berdonasi dan membuka bingkai eksklusif.</p>
                  <button type="button" onClick={() => { onClose(); onLoginRequest(); }} className="px-4 py-2 rounded-xl bg-[#FCA311] text-black font-bold text-xs cursor-pointer">Masuk Akun</button>
                </div>
              ) : (
                donationStep === 'qris' ? (
                  <div className="space-y-3">
                    <button
                      type="button"
                      disabled={isSendingDonation}
                      onClick={() => { setDonationStep('form'); setDonationError(null); }}
                      className="text-xs text-gray-400 hover:text-white flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    >
                      <ChevronLeft className="w-4 h-4" /> Ubah nominal donasi
                    </button>
                    <QrisPanel
                      amount={getDonationAmount()}
                      isBusy={isSendingDonation}
                      busyLabel="Mencatat Donasi..."
                      confirmLabel="Konfirmasi Pembayaran Donasi Selesai"
                      errorMessage={donationError}
                      onConfirm={() => recordDonation(donationOrderId || `DON-MUZ-${Date.now().toString().slice(-6)}`, getDonationAmount())}
                    />
                  </div>
                ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {[
                      { amount: 10000, label: 'Secangkir Kopi', frame: 'frame-coffee' },
                      { amount: 25000, label: 'Energi Kreatif', frame: 'frame-neon' },
                      { amount: 50000, label: 'Server Boost', frame: 'frame-warp' },
                      { amount: 100000, label: 'Pendukung Sultan', frame: 'frame-sultan' },
                    ].map((opt) => (
                      <button
                        key={opt.amount}
                        type="button"
                        onClick={() => { setSelectedAmount(opt.amount); setCustomAmount(''); }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${selectedAmount === opt.amount && !customAmount ? 'bg-[#FCA311]/15 border-[#FCA311]' : 'bg-black/40 border-white/10 hover:border-white/25'}`}
                      >
                        <span className="block text-sm font-black text-white">Rp{opt.amount.toLocaleString('id-ID')}</span>
                        <span className="block text-[10px] text-gray-400 mt-0.5">{opt.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-gray-300 flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5" /> Atau Masukkan Nominal Lain</label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-bold">Rp</span>
                      <input
                        type="number"
                        min={1000}
                        step={1000}
                        placeholder="Contoh: 15000"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                        className="w-full bg-black/60 border border-white/[0.1] focus:border-[#FCA311] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isSendingDonation}
                    onClick={handleStartDonation}
                    className="w-full py-3 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-sm flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                  >
                    {isSendingDonation ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> <span>Membuka QRIS...</span></>
                    ) : (
                      <><Heart className="w-4 h-4 fill-current" /> <span>Donasi via QRIS {formatIDR(customAmount ? Number(customAmount) || 0 : selectedAmount)}</span></>
                    )}
                  </button>
                </>
                )
              )}
            </div>
          ) : (
            <form onSubmit={handleSendContact} className="space-y-4 animate-in fade-in duration-300">
              <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-500/15 via-transparent to-transparent border border-sky-500/30 space-y-1">
                <h4 className="text-sm font-black text-white flex items-center gap-2"><MessageSquare className="w-4 h-4 text-sky-400" /> Hubungi Tim PlayMuzeck</h4>
                <p className="text-xs text-gray-300 leading-relaxed">Sampaikan masukan, ide kustom, atau aduan. Setiap pesan yang dikirim membuka bingkai "Sinyal Resonansi Pengembang" di Album Bingkai.</p>
              </div>

              {!userSession.isLoggedIn ? (
                <div className="p-5 rounded-2xl bg-black/30 border border-dashed border-white/10 text-center space-y-2">
                  <p className="text-xs text-gray-400">Masuk ke akun Anda terlebih dahulu untuk mengirim masukan.</p>
                  <button type="button" onClick={() => { onClose(); onLoginRequest(); }} className="px-4 py-2 rounded-xl bg-[#FCA311] text-black font-bold text-xs cursor-pointer">Masuk Akun</button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { key: 'feedback', label: 'Masukan', icon: Lightbulb },
                      { key: 'custom', label: 'Ide Kustom', icon: Sparkles },
                      { key: 'report', label: 'Laporkan Bug', icon: Flag },
                      { key: 'other', label: 'Lainnya', icon: HelpCircle },
                    ].map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setFeedbackCategory(c.key as any)}
                        className={`p-2.5 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${feedbackCategory === c.key ? 'bg-[#FCA311]/15 border-[#FCA311] text-[#FCA311]' : 'bg-black/40 border-white/10 text-gray-300 hover:border-white/25'}`}
                      >
                        <c.icon className="w-3.5 h-3.5" />
                        <span>{c.label}</span>
                      </button>
                    ))}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300">Subjek (opsional)</label>
                    <input
                      type="text"
                      placeholder="Ringkasan singkat pesan Anda"
                      value={contactSubject}
                      onChange={(e) => setContactSubject(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-gray-500 outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300">Pesan</label>
                    <textarea
                      required
                      rows={4}
                      placeholder="Tuliskan masukan, ide, atau aduan Anda secara detail..."
                      value={contactMessage}
                      onChange={(e) => setContactMessage(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl p-3.5 text-sm text-white placeholder-gray-500 outline-none resize-none"
                    />
                  </div>
                </>
              )}

               <button type="submit" disabled={isSendingContact || !userSession.isLoggedIn} className="w-full py-2.5 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-95 disabled:opacity-50"><Send className="w-3.5 h-3.5" /> <span>{isSendingContact ? 'Mengirim pesan...' : 'Kirim Masukan & Aduan'}</span></button>
            </form>
          )}
        </div>

        {/* 5. FOOTER MODAL */}
        <div className="shrink-0 p-4 bg-black/75 border-t border-white/[0.08] flex items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            {userSession.isLoggedIn ? (
              <button type="button" onClick={() => { onLogout(); onClose(); setTimeout(() => window.location.reload(), 300); }} className="flex items-center gap-1.5 text-gray-400 hover:text-red-400 font-bold transition-colors cursor-pointer"><LogOut className="w-3.5 h-3.5" /> <span>Keluar & Hapus Sesi Klien</span></button>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => { onClose(); onLoginRequest(); }} className="flex items-center gap-1.5 text-[#FCA311] hover:underline font-bold cursor-pointer"><LogIn className="w-3.5 h-3.5" /> <span>Masuk Akun</span></button>
              </div>
            )}
          </div>
          <button type="button" onClick={onClose} className="px-4 py-1.5 rounded-xl bg-white/10 hover:bg-white/15 text-white font-bold cursor-pointer">Tutup</button>
        </div>
      </div>
    </div>
  );
};