// src/components/QuizArena/QuizInstall.tsx
import React from 'react';
import {
  Download,
  CheckCircle2,
  HardDrive,
  ShieldCheck,
  Cpu,
  FileCode2,
  Sparkles,
  ArrowRight,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Deck } from '../../types';

interface QuizInstallProps {
  starterDecks: Deck[];
  isOnline: boolean;
  canInstallPwa?: boolean;
  onInstallPwa?: () => void;
  onDownloadStandalone: () => void;
  onNavigateLibrary: () => void;
}

export const QuizInstall: React.FC<QuizInstallProps> = ({
  starterDecks,
  isOnline,
  canInstallPwa,
  onInstallPwa,
  onDownloadStandalone,
  onNavigateLibrary,
}) => {
  return (
    <section className="space-y-6 animate-in fade-in duration-200">
      
      {/* BANNER INSTALASI LENGKAP DENGAN AKSES UNDUH NYATA */}
      <div className="rounded-3xl bg-gradient-to-r from-[#20080b] via-[#14213D] to-[#101b33] border-2 border-[#FC1212]/40 p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="space-y-2.5 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#FC1212]/20 text-[#FC1212] border border-[#FC1212]/30 text-xs font-bold">
              <Cpu className="w-3.5 h-3.5" />
              <span>Teknologi Progressive Web App (PWA) Standalone</span>
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Pasang &amp; Jalankan Pusat Kuis Tanpa Kuota Internet
            </h2>
            <p className="text-xs sm:text-sm text-gray-300 leading-relaxed">
              Aplikasi ini dirancang terpisah khusus modul kuis sehingga berukuran sangat ringan. Anda dapat
              memasang aplikasi langsung ke beranda sistem operasi atau mengunduh bundel mandiri untuk pemakaian luring.
            </p>
          </div>

          {/* Aksi Unduh Riil & Instalasi */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-3 shrink-0">
            <button
              type="button"
              onClick={() => {
                if (canInstallPwa && onInstallPwa) {
                  onInstallPwa();
                } else {
                  alert('Gunakan menu browser Anda (titik tiga atau tombol bagikan) lalu pilih "Tambahkan ke Layar Utama / Install App".');
                }
              }}
              className="px-6 py-3.5 rounded-2xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-xl shadow-red-600/30 cursor-pointer active:scale-95 transition-all"
            >
              <Download className="w-4 h-4" />
              <span>Instal Web App (PWA)</span>
            </button>

            <button
              type="button"
              onClick={onDownloadStandalone}
              className="px-6 py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 border border-white/15 text-white font-black text-xs sm:text-sm flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all shadow-md"
            >
              <FileCode2 className="w-4 h-4 text-[#FCA311]" />
              <span>Unduh Berkas Standalone (.html)</span>
            </button>
          </div>
        </div>

        {/* Parameter Teknis Aplikasi Mandiri */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 pt-4 border-t border-white/10 text-xs text-gray-300">
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 flex items-center gap-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <div>
              <span className="font-bold text-white block">Modul Terisolasi</span>
              <span className="text-[11px] text-gray-400">Khusus kuis (zeck) tanpa beban audio</span>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 flex items-center gap-3">
            <HardDrive className="w-4 h-4 text-[#FCA311] shrink-0" />
            <div>
              <span className="font-bold text-white block">Penyimpanan Luring Penuh</span>
              <span className="text-[11px] text-gray-400">Skor dan bank soal tersimpan lokal</span>
            </div>
          </div>
          <div className="p-3.5 rounded-xl bg-black/40 border border-white/5 flex items-center gap-3">
            <ShieldCheck className="w-4 h-4 text-sky-400 shrink-0" />
            <div>
              <span className="font-bold text-white block">Tanpa Instalasi Driver</span>
              <span className="text-[11px] text-gray-400">Kompatibel di semua browser modern</span>
            </div>
          </div>
        </div>
      </div>

      {/* INFORMASI 3 PAKET STARTER TANPA TOMBOL MAIN (DIARAHKAN KE PERPUSTAKAAN) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-black text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#FC1212]" />
              <span>3 Paket Kuis Bawaan (Starter Decks)</span>
            </h3>
            <p className="text-xs text-gray-400">
              Paket kartu trivia bawaan yang tersinkronisasi otomatis dan dapat dimainkan melalui Perpustakaan Kuis.
            </p>
          </div>

          <button
            type="button"
            onClick={onNavigateLibrary}
            className="px-4 py-2 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-black text-xs flex items-center gap-1.5 cursor-pointer shadow-md shadow-red-600/20 active:scale-95 transition-all"
          >
            <span>Buka Perpustakaan</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {starterDecks.slice(0, 3).map((deck, idx) => (
            <div
              key={deck.id || idx}
              className="rounded-3xl bg-[#14213D] border border-white/10 p-5 flex flex-col justify-between shadow-xl space-y-3"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-red-500/20 text-[#FC1212] border border-red-500/30">
                    PAKET #{idx + 1}
                  </span>
                  <span className="text-[11px] font-mono text-gray-400">
                    {deck.difficulty}
                  </span>
                </div>

                <h4 className="text-base font-black text-white leading-snug">
                  {deck.title}
                </h4>
                <p className="text-xs text-gray-300 leading-relaxed line-clamp-3">
                  {deck.description}
                </p>
              </div>

              <div className="flex items-center justify-between text-[11px] text-gray-400 font-mono pt-3 border-t border-white/5">
                <span>{deck.cardCount} Kartu Soal</span>
                <span className="text-emerald-400 font-bold">Tersedia di Perpustakaan</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};