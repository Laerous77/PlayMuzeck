// src/components/AudioStudio/InstrumentPickerModal.tsx
import React, { useMemo, useState } from 'react';
import { Search, X, Lock, Check } from 'lucide-react';
import { INSTRUMENTS_128 } from '../../services/audioEngine';
import { ModalPortal } from './ModalPortal';

interface InstrumentPickerModalProps {
  isOpen: boolean;
  title: string; // contoh: "Progresi Akor 2"
  currentProgram: number;
  isUnlocked: boolean; // pengguna gratis hanya boleh instrumen di freePrograms (default: Grand Piano)
  freePrograms?: number[]; // id program yang gratis; default [0] = Grand Piano
  onSelect: (program: number) => void;
  onLockedClick: () => void;
  onClose: () => void;
}

const CATEGORIES = Array.from(new Set(INSTRUMENTS_128.map((i) => i.category)));

export const InstrumentPickerModal: React.FC<InstrumentPickerModalProps> = ({
  isOpen,
  title,
  currentProgram,
  isUnlocked,
  freePrograms = [0],
  onSelect,
  onLockedClick,
  onClose,
}) => {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('Semua');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return INSTRUMENTS_128.filter((i) => {
      if (category !== 'Semua' && i.category !== category) return false;
      if (!q) return true;
      return i.name.toLowerCase().includes(q) || String(i.id + 1) === q;
    });
  }, [query, category]);

  if (!isOpen) return null;

  return (
    <ModalPortal onClose={onClose}>
      <div className="w-full max-w-lg max-h-[88dvh] flex flex-col rounded-2xl bg-surface border border-white/[0.12] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-white/10">
          <div className="min-w-0">
            <h3 className="font-bold text-white text-base truncate">Pilih Instrumen</h3>
            <p className="text-[11px] text-gray-400 truncate">Untuk {title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/15 text-gray-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-3 space-y-2.5 border-b border-white/10">
          <div className="flex items-center gap-2 bg-black/50 border border-white/[0.12] rounded-xl px-3 py-2 focus-within:border-accent">
            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Cari nama atau nomor instrumen…"
              className="flex-1 min-w-0 bg-transparent text-sm text-white placeholder:text-gray-500 outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {['Semua', ...CATEGORIES].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setCategory(cat)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors cursor-pointer ${
                  category === cat
                    ? 'bg-accent text-on-accent border-accent'
                    : 'bg-black/40 text-gray-300 border-white/10 hover:border-white/25'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain p-2">
          {filtered.length === 0 && <p className="text-center text-xs text-gray-400 py-8">Tidak ada instrumen yang cocok.</p>}
          {filtered.map((inst) => {
            const locked = !isUnlocked && !freePrograms.includes(inst.id);
            const current = inst.id === currentProgram;
            return (
              <button
                key={inst.id}
                type="button"
                onClick={() => {
                  if (locked) {
                    onLockedClick();
                    return;
                  }
                  onSelect(inst.id);
                }}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left text-sm transition-colors cursor-pointer ${
                  current ? 'bg-accent/20 text-accent font-bold' : locked ? 'text-gray-500 hover:bg-white/5' : 'text-gray-200 hover:bg-white/10'
                }`}
              >
                <span className="truncate">
                  <span className="font-mono text-[11px] text-gray-500 mr-2">#{inst.id + 1}</span>
                  {inst.name}
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-gray-500">{inst.category}</span>
                  {locked ? <Lock className="w-3.5 h-3.5 text-accent" /> : current ? <Check className="w-3.5 h-3.5" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </ModalPortal>
  );
};
