import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Library,
  Music,
  Brain,
  Download,
  Play,
  Sliders,
  CheckCircle2,
  FileText,
  ExternalLink,
} from 'lucide-react';
import { AudioEntitlements, Deck } from '../../types';

interface LibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
  entitlements: AudioEntitlements;
  unlockedDecks: Deck[];
  onPlayDeck: (deck: Deck) => void;
  onNavigateAudio: () => void;
}

export const LibraryModal: React.FC<LibraryModalProps> = ({
  isOpen,
  onClose,
  entitlements,
  unlockedDecks,
  onPlayDeck,
  onNavigateAudio,
}) => {
  const [activeTab, setActiveTab] = useState<'audio' | 'quiz'>('audio');

  if (!isOpen) return null;

  // Generate downloadable simulation file
  const handleDownloadItem = (itemName: string, format: string) => {
    const fileData = `PlayMuzeck DIGITAL AUDIO ASSET
------------------------------------------------
Item: ${itemName}
Lisensi: PlayMuzeck Standard Royalty-Free Creative License
Format: ${format}
Tanggal Unduh: ${new Date().toLocaleDateString('id-ID')}
Hak Penggunaan: Video streaming, YouTube, Podcast, Game, Edukasi.
------------------------------------------------
Terima kasih telah mendukung PlayMuzeck Music Collective.`;

    const blob = new Blob([fileData], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `PlayMuzeck_${itemName.replace(/\s+/g, '_')}.${format.toLowerCase().includes('wav') ? 'txt' : 'txt'}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const hasAnyAudioOwned =
    entitlements.fullMaster ||
    entitlements.loopVersion ||
    entitlements.separatedStems ||
    entitlements.sheetMusic ||
    entitlements.fullEditor8Bar;

  return (
    <div
      id="library-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-3xl rounded-2xl bg-[#14213D] border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 sm:p-6 border-b border-white/[0.08] bg-black/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FCA311] text-black flex items-center justify-center shadow-md">
              <Library className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl font-bold text-white">Koleksi Saya (My Library)</h3>
              <p className="text-xs text-gray-300">
                Akses semua audio berlisensi, stems, dan deck kuis yang telah kamu miliki.
              </p>
            </div>
          </div>

          <button
            id="btn-close-library"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b border-white/[0.06] bg-black/20">
          <button
            onClick={() => setActiveTab('audio')}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'audio'
                ? 'border-[#FCA311] text-[#FCA311]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Music className="w-4 h-4" />
            <span>Audio Dimiliki</span>
          </button>

          <button
            onClick={() => setActiveTab('quiz')}
            className={`pb-3 px-3 text-xs sm:text-sm font-bold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'quiz'
                ? 'border-[#FC1212] text-[#FC1212]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Brain className="w-4 h-4" />
            <span>Deck Kuis Dimiliki ({unlockedDecks.length})</span>
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 max-h-[65vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {activeTab === 'audio' ? (
              <motion.div key="audio-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
                {!hasAnyAudioOwned ? (
                  <div className="text-center py-12 space-y-3">
                    <Music className="w-12 h-12 text-gray-500 mx-auto" />
                    <h4 className="text-sm font-bold text-white">Belum Ada Paket Audio Dimiliki</h4>
                    <p className="text-xs text-gray-400 max-w-sm mx-auto">
                      Dapatkan Audio Master, Separated Stems, atau Lembar Partitur di Audio Studio untuk mengunduh berkas kualitas studio.
                    </p>
                    <button
                      onClick={() => {
                        onClose();
                        onNavigateAudio();
                      }}
                      className="px-4 py-2 rounded-xl bg-[#FCA311] text-black font-bold text-xs shadow hover:bg-[#FCA311]/90 transition-all cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Kunjungi Audio Studio</span>
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Full Master */}
                    {entitlements.fullMaster && (
                      <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">
                              Cahaya Cakrawala - Full Audio Master
                            </span>
                            <span className="text-[10px] font-bold text-black bg-[#FCA311] px-1.5 py-0.2 rounded">
                              24-bit WAV / 320kbps MP3
                            </span>
                          </div>
                          <p className="text-xs text-gray-400">
                            Versi master tanpa batasan durasi 5 detik, cocok untuk penyiaran dan produksi komersial.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleDownloadItem('Cahaya_Cakrawala_Master', 'WAV')}
                            className="px-3.5 py-2 rounded-lg bg-black/60 hover:bg-black text-white text-xs font-bold border border-white/[0.1] flex items-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-[#FCA311]" />
                            <span>Unduh Audio</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Separated Stems */}
                    {entitlements.separatedStems && (
                      <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-white text-sm">
                              Separated Track / 4-Channel Audio Stems
                            </span>
                            <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.2 rounded border border-emerald-500/30">
                              Stem Mixer Aktif
                            </span>
                          </div>
                          <p className="text-xs text-gray-400">
                            Trek terpisah Melodi, Drum, Bass, dan Vokal/Akustik dengan kontrol penuh di Web Mixer.
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              onClose();
                              onNavigateAudio();
                            }}
                            className="px-3 py-2 rounded-lg bg-[#FCA311] text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-[#FCA311]/90"
                          >
                            <Sliders className="w-3.5 h-3.5" />
                            <span>Buka Mixer</span>
                          </button>
                          <button
                            onClick={() => handleDownloadItem('Cahaya_Cakrawala_4Stems_ZIP', 'ZIP')}
                            className="px-3 py-2 rounded-lg bg-black/60 hover:bg-black text-white text-xs font-bold border border-white/[0.1] flex items-center gap-1.5 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-[#FCA311]" />
                            <span>Unduh Stems</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Loop Version */}
                    {entitlements.loopVersion && (
                      <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <span className="font-bold text-white text-sm">
                            Seamless Loop Video & Stream Version
                          </span>
                          <p className="text-xs text-gray-400">
                            Potongan loop tanpa batas (zero crossfade) ideal untuk musik latar livestream dan game.
                          </p>
                        </div>
                        <button
                          onClick={() => handleDownloadItem('Cahaya_Cakrawala_Seamless_Loop', 'WAV')}
                          className="px-3.5 py-2 rounded-lg bg-black/60 hover:bg-black text-white text-xs font-bold border border-white/[0.1] flex items-center gap-1.5 cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5 text-[#FCA311]" />
                          <span>Unduh Loop</span>
                        </button>
                      </div>
                    )}

                    {/* Sheet Music */}
                    {entitlements.sheetMusic && (
                      <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <span className="font-bold text-white text-sm">
                            Lembar Partitur & Notasi Balok (Sheet Music PDF)
                          </span>
                          <p className="text-xs text-gray-400">
                            Notasi lengkap nada utama, akor piano, dan progresi bass format digital PDF.
                          </p>
                        </div>
                        <button
                          onClick={() => handleDownloadItem('Cahaya_Cakrawala_Partitur_Resmi', 'PDF')}
                          className="px-3.5 py-2 rounded-lg bg-black/60 hover:bg-black text-white text-xs font-bold border border-white/[0.1] flex items-center gap-1.5 cursor-pointer"
                        >
                          <FileText className="w-3.5 h-3.5 text-[#FCA311]" />
                          <span>Unduh Partitur</span>
                        </button>
                      </div>
                    )}

                    {/* 8-Bar Editor */}
                    {entitlements.fullEditor8Bar && (
                      <div className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                        <div className="space-y-1">
                          <span className="font-bold text-white text-sm">
                            Full 8-Bar Sequencer & Drum/Chord Pad Editor
                          </span>
                          <p className="text-xs text-gray-400">
                            Akses tak terbatas untuk menyusun sekuens ritme drum dan progresi akor hingga 8 bar.
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            onClose();
                            onNavigateAudio();
                          }}
                          className="px-3.5 py-2 rounded-lg bg-[#FCA311] text-black text-xs font-bold flex items-center gap-1.5 cursor-pointer hover:bg-[#FCA311]/90"
                        >
                          <Sliders className="w-3.5 h-3.5" />
                          <span>Buka Pad Studio</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            ) : (
              /* Quiz Decks Tab */
              <motion.div key="quiz-tab" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                {unlockedDecks.map((deck) => (
                  <div
                    key={deck.id}
                    className="p-4 rounded-xl bg-black/40 border border-white/[0.08] flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-white/[0.2] transition-colors"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-bold text-white">{deck.title}</h4>
                        {deck.badge === 'Kustom Kamu' ? (
                          <span className="text-[10px] font-bold text-[#FC1212] bg-[#FC1212]/15 px-2 py-0.5 rounded border border-[#FC1212]/30">
                            Kustom Buatanmu
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/30">
                            {deck.isFree ? 'Starter Gratis' : 'Ekspansi Dimiliki'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 line-clamp-1">{deck.description}</p>
                      <div className="text-[11px] text-gray-500">
                        {deck.cardCount} Kartu Pertanyaan • Tingkat: {deck.difficulty}
                      </div>
                    </div>

                    <button
                      onClick={() => {
                        onClose();
                        onPlayDeck(deck);
                      }}
                      className="px-4 py-2 rounded-xl bg-[#FC1212] hover:bg-[#e01010] text-white font-extrabold text-xs shadow-md shadow-red-600/25 transition-all cursor-pointer flex items-center justify-center gap-2 shrink-0 active:scale-95"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Mainkan Sekarang</span>
                    </button>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
