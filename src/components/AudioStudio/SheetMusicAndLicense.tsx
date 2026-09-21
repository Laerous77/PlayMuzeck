// src/components/AudioStudio/SheetMusicAndLicense.tsx
import React, { useState } from 'react';
import {
  FileText,
  Lock,
  Download,
  Printer,
  ShieldCheck,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileCode,
  Check,
} from 'lucide-react';
import { AudioTrackItem, AudioEntitlements, CartItem } from '../../types';
import { calculateAudioPricing } from '../../services/pricing';

interface SheetMusicAndLicenseProps {
  activeTrack: AudioTrackItem;
  entitlements: AudioEntitlements;
  onAddToCart: (items: CartItem[]) => void;
  onOpenCart: () => void;
  onSuccessToast: (msg: string) => void;
}

export const SheetMusicAndLicense: React.FC<SheetMusicAndLicenseProps> = ({
  activeTrack,
  entitlements,
  onAddToCart,
  onOpenCart,
  onSuccessToast,
}) => {
  const [isCopied, setIsCopied] = useState(false);

  const trackIdStr = String(activeTrack?.id || '');
  const trackOwnership = entitlements?.byTrack?.[trackIdStr] || entitlements?.byTrack?.[activeTrack?.id] || {};

  // Status Kepemilikan Partitur
  const isSheetMusicOwned = Boolean(trackOwnership.sheetMusic);

  // Status Kepemilikan Minimal 1 Produk untuk Mendapatkan Lisensi
  const hasAnyLicense = Boolean(
    trackOwnership.fullMaster ||
    trackOwnership.loopVersion ||
    trackOwnership.separatedStems ||
    trackOwnership.sheetMusic ||
    entitlements.fullEditor8Bar ||
    (entitlements as any)?.audioToolsSuite
  );

  const pricing = calculateAudioPricing(activeTrack?.price || 50000, {});
  const sheetMusicPrice = pricing.products.sheetMusic || 25000;

  // Berkas PDF Asli dari Admin
  const pdfUrl = (activeTrack as any).sheetMusicUrl || (activeTrack as any).sheetUrl || '';

  // Kode Lisensi Unik
  const licenseKey = `PMZ-LIC-${(activeTrack?.title || 'AUDIO')
    .slice(0, 3)
    .toUpperCase()}-${String(activeTrack?.id).replace(/[^a-zA-Z0-9]/g, '').slice(-6)}-COMMERCIAL`;

  // Teks Lisensi: gunakan teks .txt unggahan admin jika ada, atau template resmi PlayMuzeck
  const defaultLicenseText = `================================================================================
                PLAYMUZECK COMMERCIAL ROYALTY-FREE LICENSE
================================================================================

Judul Lagu        : ${activeTrack?.title || 'Untitled'}
Artis / Produser  : ${(activeTrack as any)?.artist || (activeTrack as any)?.producer || 'PlayMuzeck Studio'}
BPM               : ${activeTrack?.bpm || 120}
Kode Lisensi      : ${licenseKey}
Penerima Lisensi  : Pengguna Terverifikasi PlayMuzeck
Status Hak Cipta  : Aktif & Terverifikasi (Bebas Royalti Permanen)

1. HAK PENGGUNAAN KOMERSIAL:
Pemegang lisensi diberikan izin komersial seumur hidup non-eksklusif di seluruh
dunia untuk menggunakan, menyinkronkan, dan menyiarkan aset audio ini dalam:
- Konten YouTube, Media Sosial & Siaran Streaming (Monetisasi Aktif)
- Produksi Film Layar Lebar, Serial Televisi, Video Promosi & Iklan Komersial
- Game Video (PC, Mobile, Konsol), Aplikasi Interaktif & Software
- Podcast, Pameran Virtual, Musik Latar Ruang Publik & Presentasi Korporat

2. BATASAN LISENSI:
- Dilarang menjual ulang, melisensikan ulang, atau menyebarkan berkas audio mentah
  secara terpisah sebagai aset stock audio.
- Dilarang mendaftarkan karya ini ke Content ID fingerprinting pihak ketiga
  tanpa izin tertulis dari PlayMuzeck.

================================================================================
PLAYMUZECK AUDIO WORKSTATION • DIGITAL ASSET MANAGEMENT • DRM-FREE PASS
================================================================================`;

  const licenseContent = (activeTrack as any).licenseText || defaultLicenseText;

  const handleBuySheetMusic = () => {
    onAddToCart([
      {
        id: `sheet-music-${activeTrack.id}-${Date.now()}`,
        title: `Partitur Notasi Balok PDF: ${activeTrack.title}`,
        category: 'audio',
        price: sheetMusicPrice,
        description: `Partitur notasi balok aransemen lengkap format PDF standar konser untuk lagu "${activeTrack.title}".`,
        itemTypeKey: 'sheetMusic',
        trackId: activeTrack.id,
      } as any,
    ]);
    onOpenCart();
    onSuccessToast(`Partitur "${activeTrack.title}" ditambahkan ke keranjang!`);
  };

  const handleDownloadSheetPdf = () => {
    if (pdfUrl) {
      const link = document.createElement('a');
      link.href = pdfUrl;
      link.download = `${(activeTrack.title || 'Partitur').replace(/\s+/g, '_')}_Sheet_Music.pdf`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // Fallback jika admin belum mengunggah file PDF fisik
      const blob = new Blob([`%PDF-1.4\n% PlayMuzeck Sheet Music: ${activeTrack.title}`], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${(activeTrack.title || 'Partitur').replace(/\s+/g, '_')}_Sheet_Music.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }
    onSuccessToast(`Berkas partitur PDF "${activeTrack.title}" berhasil diunduh!`);
  };

  const handleDownloadLicenseTxt = () => {
    const blob = new Blob([licenseContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Readme_License_${(activeTrack.title || 'Audio').replace(/\s+/g, '_')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onSuccessToast('Berkas Readme_License.txt berhasil diunduh!');
  };

  const handleCopyLicenseKey = () => {
    navigator.clipboard.writeText(licenseKey);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
    onSuccessToast('Kode lisensi komersial berhasil disalin!');
  };

  return (
    <div className="space-y-6">
      {/* 1. LEMBAR PARTITUR PDF ASLI */}
      <div className="rounded-3xl bg-[#0d1527] border border-white/10 p-6 sm:p-7 shadow-2xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-amber-500/15 border border-[#FCA311]/40 flex items-center justify-center text-[#FCA311] shadow-lg shadow-amber-500/20 shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-black text-white">Lembar Partitur PDF (Sheet Music)</h3>
                {isSheetMusicOwned ? (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    DIMILIKI
                  </span>
                ) : (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-[#FCA311] border border-amber-500/30 flex items-center gap-1">
                    <Lock className="w-2.5 h-2.5" /> Berbayar
                  </span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-0.5">
                Dokumen partitur PDF resmi notasi balok konser, progresi akor, dan birama studio.
              </p>
            </div>
          </div>

          <div>
            {isSheetMusicOwned ? (
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleDownloadSheetPdf}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs flex items-center gap-1.5 shadow-md shadow-emerald-500/20 cursor-pointer active:scale-95 transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Partitur PDF</span>
                </button>
                {pdfUrl && (
                  <a
                    href={pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-gray-300 hover:text-white cursor-pointer"
                    title="Buka di Tab Baru"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleBuySheetMusic}
                className="px-5 py-2.5 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-black text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/25 cursor-pointer active:scale-95 transition-all"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Beli Partitur (Rp {sheetMusicPrice.toLocaleString('id-ID')})</span>
              </button>
            )}
          </div>
        </div>

        {/* Kotak Tampilan Berkas PDF */}
        <div className="relative rounded-2xl bg-black/50 border border-white/5 overflow-hidden">
          {isSheetMusicOwned ? (
            pdfUrl ? (
              <div className="w-full h-[70vh] max-h-[550px] min-h-[320px] bg-zinc-900 flex flex-col">
                <iframe
                  src={`${pdfUrl}#toolbar=1&navpanes=0`}
                  className="w-full h-full border-0 rounded-2xl"
                  title={`Partitur ${activeTrack.title}`}
                />
              </div>
            ) : (
              <div className="p-12 text-center space-y-3">
                <FileText className="w-10 h-10 text-[#FCA311] mx-auto opacity-80" />
                <h4 className="text-sm font-bold text-white">Partitur Sudah Dimiliki</h4>
                <p className="text-xs text-gray-400 max-w-md mx-auto leading-relaxed">
                  Berkas partitur PDF untuk lagu ini sedang diproses atau dapat diunduh langsung menggunakan tombol unduh di atas.
                </p>
                <button
                  type="button"
                  onClick={handleDownloadSheetPdf}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Dokumen PDF</span>
                </button>
              </div>
            )
          ) : (
            <div className="p-12 text-center space-y-3.5 bg-gradient-to-b from-black/40 to-black/80">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-[#FCA311] mx-auto flex items-center justify-center">
                <Lock className="w-6 h-6" />
              </div>
              <div className="max-w-md mx-auto space-y-1">
                <h4 className="text-base font-black text-white">Lembar Partitur Terkunci</h4>
                <p className="text-xs text-gray-300 leading-relaxed">
                  Miliki dokumen berkas PDF aransemen lengkap lagu <strong>{activeTrack?.title}</strong> untuk membuka tampilan partitur dan mengunduh berkasnya.
                </p>
              </div>
              <button
                type="button"
                onClick={handleBuySheetMusic}
                className="px-6 py-2.5 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-xs cursor-pointer shadow-lg shadow-amber-500/25 active:scale-95 transition-all"
              >
                Beli Lisensi Partitur Rp {sheetMusicPrice.toLocaleString('id-ID')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 2. SERTIFIKAT & BERKAS LISENSI RESMI (.TXT) */}
      <div className="rounded-3xl bg-[#0d1527] border border-white/10 p-6 sm:p-7 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-black text-white">
                  Lisensi Hak Cipta Komersial (Readme_License.txt)
                </h3>
              </div>
              <p className="text-xs text-gray-400">
                Sertifikat bukti lisensi bebas royalti komersial resmi PlayMuzeck.
              </p>
            </div>
          </div>

          <span
            className={`px-3 py-1 rounded-full text-xs font-black font-mono self-start sm:self-auto ${
              hasAnyLicense
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                : 'bg-black/60 text-gray-400 border border-white/10'
            }`}
          >
            {hasAnyLicense ? 'LISENSI AKTIF' : 'BELUM BERLISENSI'}
          </span>
        </div>

        {hasAnyLicense ? (
          <div className="space-y-4">
            {/* Tampilan Dokumen Teks .TXT Asli */}
            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
                <span className="flex items-center gap-1.5 text-gray-300 font-bold">
                  <FileCode className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Readme_License.txt</span>
                </span>
                <span className="text-emerald-400">Bebas Royalti Seumur Hidup</span>
              </div>

              <pre className="p-4 rounded-2xl bg-black/60 border border-white/10 font-mono text-[11px] text-emerald-300/90 whitespace-pre-wrap max-h-56 overflow-y-auto leading-relaxed no-scrollbar select-text">
                {licenseContent}
              </pre>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
              <div className="space-y-0.5">
                <span className="text-gray-400 text-[10px] uppercase font-mono">Kode Sertifikasi:</span>
                <p className="text-[#FCA311] font-mono font-bold text-xs select-all">{licenseKey}</p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyLicenseKey}
                  className="px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopied ? 'Tersalin' : 'Salin Kode'}</span>
                </button>

                <button
                  type="button"
                  onClick={handleDownloadLicenseTxt}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 cursor-pointer active:scale-95 transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Unduh Readme_License.txt</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-5 rounded-2xl bg-black/40 border border-dashed border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs">
            <p className="text-gray-400 text-center sm:text-left leading-relaxed">
              Beli minimal salah satu produk dari lagu ini (Full Audio, Loop, Stem, Partitur, atau Bundle) untuk membuka hak cipta komersial dan mengunduh berkas <strong>Readme_License.txt</strong>[cite: 28].
            </p>
            <button
              type="button"
              onClick={onOpenCart}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold shrink-0 cursor-pointer"
            >
              Lihat Pilihan Produk
            </button>
          </div>
        )}
      </div>
    </div>
  );
};