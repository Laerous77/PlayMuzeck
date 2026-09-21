import React, { useState } from 'react';
import { Download, Share2, X, Smartphone } from 'lucide-react';
import { usePWAInstall } from '../../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  accentColor?: string;
  isQuizArena?: boolean;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  accentColor = '#FCA311',
  isQuizArena = false,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const activeColor = isQuizArena ? '#FC1212' : accentColor;

  return (
    <>
      {/* Desktop / Android Flow */}
      {isInstallable && (
        <button
          id="btn-pwa-install"
          onClick={install}
          style={{ borderColor: `${activeColor}40` }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/90 text-xs font-bold text-white border transition-all cursor-pointer shadow-sm hover:scale-105"
        >
          <Download className="w-3.5 h-3.5" style={{ color: activeColor }} />
          <span className="hidden sm:inline">Install App</span>
        </button>
      )}

      {/* iOS Safari Flow */}
      {isIOS && (
        <button
          id="btn-pwa-install-ios"
          onClick={() => setShowIOSGuide(true)}
          style={{ borderColor: `${activeColor}40` }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black/60 hover:bg-black/90 text-xs font-bold text-white border transition-all cursor-pointer shadow-sm"
        >
          <Share2 className="w-3.5 h-3.5" style={{ color: activeColor }} />
          <span className="hidden sm:inline">Install di iOS</span>
        </button>
      )}

      {/* iOS Safari Guide Modal */}
      {showIOSGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-sm max-h-[92vh] overflow-y-auto my-auto rounded-2xl bg-[#14213D] border border-white/[0.12] p-6 shadow-2xl relative">
            <button
              onClick={() => setShowIOSGuide(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/50 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{ backgroundColor: `${activeColor}20`, color: activeColor }}
              >
                <Smartphone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Pasang di iPhone / iPad</h3>
                <p className="text-xs text-gray-400">Jalankan offline tanpa browser bar</p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-300 bg-black/40 p-4 rounded-xl border border-white/[0.06] mb-4">
              <p className="flex items-start gap-2">
                <span className="font-bold text-white">1.</span>
                <span>
                  Ketuk tombol <strong>Bagikan (Share)</strong> di bilah navigasi bawah Safari.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="font-bold text-white">2.</span>
                <span>
                  Gulir ke bawah lalu pilih <strong>Tambah ke Layar Utama (Add to Home Screen)</strong>.
                </span>
              </p>
              <p className="flex items-start gap-2">
                <span className="font-bold text-white">3.</span>
                <span>
                  Tekan <strong>Tambah</strong> di sudut kanan atas untuk menyelesaikan instalasi.
                </span>
              </p>
            </div>

            <button
              onClick={() => setShowIOSGuide(false)}
              style={{ backgroundColor: activeColor }}
              className="w-full py-2.5 rounded-xl text-black font-extrabold text-xs shadow-md transition-all cursor-pointer"
            >
              Mengerti & Tutup
            </button>
          </div>
        </div>
      )}
    </>
  );
};
