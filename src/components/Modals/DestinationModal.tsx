import React from 'react';
import { Headphones, Brain, ShieldAlert, ArrowRight, X, CheckCircle2 } from 'lucide-react';
import { audioEngine } from '../../services/audioEngine';

interface DestinationModalProps {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  isAdmin: boolean;
  onSelectDestination: (destination: 'audio' | 'quiz' | 'admin' | 'index') => void;
}

export const DestinationModal: React.FC<DestinationModalProps> = ({
  isOpen,
  onClose,
  userName,
  isAdmin,
  onSelectDestination,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="w-full max-w-xl max-h-[92dvh] overflow-y-auto rounded-3xl bg-surface border border-white/20 p-6 sm:p-8 shadow-2xl relative space-y-6 my-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-xl bg-black/40 text-gray-400 hover:text-white hover:bg-black/70 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/15 text-accent text-xs font-black border border-accent/30">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Login Berhasil</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Selamat Datang, {userName}!
          </h2>
          <p className="text-xs sm:text-sm text-gray-300">
            Silakan pilih destinasi yang ingin Anda tuju terlebih dahulu:
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Opsi 1: Audio Studio */}
          <button
            type="button"
            onClick={() => {
              audioEngine.playClickSound();
              onSelectDestination('audio');
            }}
            className="p-5 rounded-2xl bg-black/50 hover:bg-accent text-left border border-white/10 hover:border-accent transition-all group cursor-pointer shadow-lg"
          >
            <div className="w-12 h-12 rounded-xl bg-accent/20 group-hover:bg-black text-accent flex items-center justify-center mb-3.5 transition-colors">
              <Headphones className="w-6 h-6 stroke-[2.5]" />
            </div>
            <h3 className="text-base font-black text-white group-hover:text-on-accent transition-colors flex items-center justify-between">
              <span>Studio Audio</span>
              <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </h3>
            <p className="text-xs text-gray-400 group-hover:text-on-accent/80 mt-1 transition-colors leading-relaxed">
              Katalog musik orisinal, 16-bar sequencer, 4 track akor, dan 9 Audio Tools.
            </p>
          </button>

          {/* Opsi 2: Quiz Arena */}
          <button
            type="button"
            onClick={() => {
              audioEngine.playClickSound();
              onSelectDestination('quiz');
            }}
            className="p-5 rounded-2xl bg-black/50 hover:bg-accent2 text-left border border-white/10 hover:border-accent2 transition-all group cursor-pointer shadow-lg"
          >
            <div className="w-12 h-12 rounded-xl bg-accent2/20 group-hover:bg-black text-accent2 flex items-center justify-center mb-3.5 transition-colors">
              <Brain className="w-6 h-6 stroke-[2.5]" />
            </div>
            <h3 className="text-base font-black text-white group-hover:text-on-accent2 transition-colors flex items-center justify-between">
              <span>Pusat Kuis</span>
              <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
            </h3>
            <p className="text-xs text-gray-400 group-hover:text-on-accent2/90 mt-1 transition-colors leading-relaxed">
              Tantangan trivia multi-topik, 3 starter deck bawaan, dan fitur offline PWA.
            </p>
          </button>
        </div>

        {/* Akses Khusus Admin Utama */}
        {isAdmin && (
          <div className="p-4 rounded-2xl bg-accent/10 border border-accent/40 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="w-5 h-5 text-accent shrink-0" />
              <div>
                <h4 className="text-xs font-black text-white">Akun Administrator Terdeteksi</h4>
                <p className="text-[11px] text-gray-300">Anda memiliki izin penuh untuk mengelola server & CMS.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onSelectDestination('admin')}
              className="px-3.5 py-1.5 rounded-xl bg-accent hover:bg-accent/80 text-on-accent font-black text-xs cursor-pointer whitespace-nowrap shadow"
            >
              Buka Developer Console
            </button>
          </div>
        )}

        <div className="text-center pt-1">
          <button
            type="button"
            onClick={() => onSelectDestination('index')}
            className="text-xs text-gray-400 hover:text-white underline cursor-pointer"
          >
            Tetap di Halaman Utama
          </button>
        </div>
      </div>
    </div>
  );
};
