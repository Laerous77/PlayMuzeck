// src/components/IndexView.tsx
import React from 'react';
import { motion } from 'motion/react';
import {
  Sparkles,
  Headphones,
  Brain,
  Sliders,
  ArrowRight,
  ShieldCheck,
  Zap,
  CheckCircle2,
  FolderLock,
  Download,
  WifiOff,
  BookOpen,
  Layers,
} from 'lucide-react';
import { audioEngine } from '../services/audioEngine';

interface IndexViewProps {
  onNavigateAudio: () => void;
  onNavigateQuiz: () => void;
  onOpenProfile: () => void;
}

export const IndexView: React.FC<IndexViewProps> = ({
  onNavigateAudio,
  onNavigateQuiz,
}) => {
  return (
    <div className="w-full space-y-12 pb-16">
      {/* 1. HERO SECTION */}
      <section id="index-hero-section" className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-[#14213D]/80 via-[#14213D]/40 to-black border border-white/[0.1] p-6 sm:p-12 text-center shadow-2xl scroll-mt-20">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-[#FCA311]/15 blur-3xl rounded-full pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 max-w-3xl mx-auto space-y-5"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#FCA311]/10 border border-[#FCA311]/30 text-[#FCA311] text-xs font-bold tracking-wide">
            <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: '4s' }} />
            <span>Platform Audio DAW & Brain Trivia Arena Terpadu</span>
          </div>

          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight">
            Kreasikan Harmoni Musik, <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FCA311] via-amber-200 to-amber-500">
              Taklukkan Arena Wawasan.
            </span>
          </h1>

          <p className="text-sm sm:text-base text-gray-300 leading-relaxed font-medium">
            PlayMuzeck memadukan studio produksi audio profesional bebas latensi dengan arena kuis trivia adaptif.
            Aransemen not akustik orisinal, mainkan pola ritmis, dan asah kecerdasan Anda dalam satu ekosistem kreatif.
          </p>
        </motion.div>
      </section>

      {/* 2. DUA PILAR UTAMA: KEUNGGULAN AUDIO & KUIS */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* PILAR 1: KEUNGGULAN AUDIO STUDIO */}
        <motion.div
          id="index-audio-section"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="rounded-3xl bg-gradient-to-b from-[#14213D]/60 to-black/80 border border-white/[0.1] p-6 sm:p-8 flex flex-col justify-between hover:border-[#FCA311]/50 transition-all shadow-xl group scroll-mt-20"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-[#FCA311]/15 text-[#FCA311] flex items-center justify-center group-hover:scale-110 transition-transform border border-[#FCA311]/30">
              <Sliders className="w-6 h-6 stroke-[2.5]" />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-bold text-[#FCA311] uppercase tracking-wider font-mono">
                Workstation Audio Terintegrasi
              </span>
              <h3 className="text-2xl font-black text-white">Audio Studio</h3>
            </div>

            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
              Workstation sintesis dan aransemen langsung dari browser tanpa perlu menginstal aplikasi DAW berat.
            </p>

            <ul className="space-y-2.5 text-xs text-gray-300 pt-1">
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#FCA311] shrink-0" />
                <span><strong>128 SoundFont GM & 7 Kit Drum:</strong> Sampel instrumen akustik orisinal beresolusi tinggi.</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#FCA311] shrink-0" />
                <span><strong>4 Track Progresi Akor Independen:</strong> Polifoni murni tanpa saling menimpa (*anti-voice-choking*).</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#FCA311] shrink-0" />
                <span><strong>Step Sequencer 16-Bar & ADSR:</strong> Kontrol kurva Attack, Decay, Sustain, dan Release mandiri.</span>
              </li>
              <li className="flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-[#FCA311] shrink-0" />
                <span><strong>Stem Mixer & 9 Audio Tools:</strong> Pemisah vokal instan, pengatur nada, mastering gain, dan konversi format.</span>
              </li>
            </ul>
          </div>

          <button
            onClick={() => {
              audioEngine.playClickSound();
              onNavigateAudio();
            }}
            className="mt-6 w-full py-3 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-amber-500/20 active:scale-95"
          >
            <Headphones className="w-4 h-4" />
            <span>Masuk ke Audio Studio</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>

        {/* PILAR 2: KEUNGGULAN QUIZ ARENA */}
        <motion.div
          id="index-quiz-section"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: 0.2 }}
          className="rounded-3xl bg-gradient-to-b from-[#14213D]/60 to-black/80 border border-white/[0.1] p-6 sm:p-8 flex flex-col justify-between hover:border-red-500/50 transition-all shadow-xl group scroll-mt-20"
        >
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-red-500/15 text-red-400 flex items-center justify-center group-hover:scale-110 transition-transform border border-red-500/30">
              <Brain className="w-6 h-6 stroke-[2.5]" />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider font-mono">
                Trivia & Brain Challenge
              </span>
              <h3 className="text-2xl font-black text-white">Pusat Kuis</h3>
            </div>

            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
              Arena pengasah wawasan interaktif yang fleksibel untuk belajar dan bertanding kuis trivia.
            </p>

            <ul className="space-y-2.5 text-xs text-gray-300 pt-1">
              <li className="flex items-center gap-2.5">
                <WifiOff className="w-4 h-4 text-red-400 shrink-0" />
                <span><strong>Bisa Offline & Online PWA:</strong> Tetap lancar dimainkan kapan saja meski tanpa jaringan internet.</span>
              </li>
              <li className="flex items-center gap-2.5">
                <BookOpen className="w-4 h-4 text-red-400 shrink-0" />
                <span><strong>Beragam Topik Trivia:</strong> Kategori luas mulai dari wawasan umum, sains, musik, hingga sejarah.</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-red-400 shrink-0" />
                <span><strong>Tersedia 3 Paket Kuis Bawaan:</strong> Starter deck siap main langsung begitu Anda bergabung.</span>
              </li>
              <li className="flex items-center gap-2.5">
                <Sparkles className="w-4 h-4 text-red-400 shrink-0" />
                <span><strong>Fitur Kuis Kustom & Forum:</strong> Pembuat deck mandiri dan komunitas.</span>
              </li>
            </ul>
          </div>

          <button
            onClick={() => {
              audioEngine.playClickSound();
              onNavigateQuiz();
            }}
            className="mt-6 w-full py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-red-500/20 active:scale-95"
          >
            <Brain className="w-4 h-4" />
            <span>Masuk ke Pusat Kuis</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </motion.div>
      </section>

      {/* 3. FITUR UNGGULAN & EKOSISTEM */}
      <section id="index-features-section" className="rounded-3xl bg-black/50 border border-white/[0.08] p-6 sm:p-8 space-y-6 scroll-mt-20">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <span className="text-[11px] font-bold text-[#FCA311] uppercase tracking-wider font-mono">Fitur Ekosistem</span>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Dirancang Cepat, Ringan & Fleksibel</h2>
          <p className="text-xs text-gray-400">
            Aset lagu, stem multi-track, lisensi komersial, hingga album bingkai tersimpan aman di profil Anda.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-[#14213D]/30 border border-white/[0.06] space-y-2">
            <Zap className="w-5 h-5 text-[#FCA311]" />
            <h4 className="text-sm font-bold text-white">Tanpa Instalasi DAW</h4>
            <p className="text-xs text-gray-400">
              Workstation langsung berjalan dari browser ponsel maupun desktop tanpa instalasi driver berat.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#14213D]/30 border border-white/[0.06] space-y-2">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
            <h4 className="text-sm font-bold text-white">Client-Side Offline First</h4>
            <p className="text-xs text-gray-400">
              Data dek kuis dan preferensi audio tersimpan lokal sehingga tidak terganggu koneksi lambat.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#14213D]/30 border border-white/[0.06] space-y-2">
            <Download className="w-5 h-5 text-sky-400" />
            <h4 className="text-sm font-bold text-white">Ekspor Fleksibel</h4>
            <p className="text-xs text-gray-400">
              Unduh hasil sequencer ke format MIDI multi-track DAW, WAV, MP3, FLAC, atau M4A secara instan.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#14213D]/30 border border-white/[0.06] space-y-2">
            <FolderLock className="w-5 h-5 text-amber-300" />
            <h4 className="text-sm font-bold text-white">Dasbor Profil Terpadu</h4>
            <p className="text-xs text-gray-400">
              Koleksi lagu, album bingkai kehormatan, dukungan donasi, dan layanan aduan terintegrasi.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};