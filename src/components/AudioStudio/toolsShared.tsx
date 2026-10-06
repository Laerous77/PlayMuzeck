// src/components/AudioStudio/toolsShared.tsx
// Komponen & gaya yang dipakai bersama oleh AudioToolsSuite (9 alat bawaan) dan AudioExtraTools (6 alat tambahan)
// supaya tampilan ke-15 alat seragam.
import React, { useEffect, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/** Popover info (ikon "i") di sebelah judul alat. */
export const InfoTip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={label}
        aria-expanded={open}
        title={label}
        className={`w-6 h-6 rounded-full flex items-center justify-center border transition-colors cursor-pointer ${
          open
            ? 'bg-accent/20 text-accent border-accent/40'
            : 'bg-black/40 text-gray-400 border-white/10 hover:text-accent hover:border-accent/40'
        }`}
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute left-0 top-full mt-2 z-30 w-72 sm:w-80 max-w-[calc(100vw-3rem)] rounded-xl bg-[#0b130e] border border-white/15 shadow-2xl p-3.5 space-y-2 text-[11px] leading-relaxed text-gray-300 font-normal normal-case tracking-normal"
        >
          {children}
        </div>
      )}
    </span>
  );
};

export const FORMAT_INFO =
  'MP3 di-encode dengan LAME (320 kbps untuk tool selain Compress), FLAC lossless 16-bit, WAV PCM 16-bit. M4A memakai encoder bawaan browser (bisa berupa .webm/.ogg).';

/** Wadah panel alat. */
export const PANEL_CLS = 'p-4 sm:p-5 rounded-xl bg-black/40 border border-white/[0.06] space-y-4';
/** Kartu di dalam panel (mis. "Batas Awal"). */
export const CARD_CLS = 'bg-black/50 p-3 rounded-xl border border-white/5';
/** Slider. */
export const SLIDER_CLS = 'w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent disabled:opacity-40';
/** Tombol utama (kuning). */
export const BTN_PRIMARY = 'px-5 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black inline-flex items-center justify-center gap-1.5 cursor-pointer shadow-md disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 transition-all';
/** Tombol sekunder (gelap). */
export const BTN_GHOST = 'px-3.5 py-2 rounded-xl bg-black/50 hover:bg-black/80 border border-white/10 text-xs font-bold text-gray-200 inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-60 transition-all';
/** Tombol unduh (hijau). */
export const BTN_DOWNLOAD = 'px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-black inline-flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50';
/** Kolom isian angka / pilihan. */
export const INPUT_CLS = 'w-full rounded-lg bg-black/60 border border-white/10 px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-accent/60';
/** Kolom angka bergaya monospasi (seperti kolom waktu di Trim / Cut). */
export const NUM_FIELD_CLS = 'w-20 bg-black/80 border border-white/15 rounded px-2 py-1 text-sm font-mono font-bold text-accent text-right focus:outline-none focus:border-accent';
/** Pil pilihan (format unduhan, dll.). */
export const pillCls = (on: boolean) =>
  `px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${on ? 'bg-accent text-on-accent shadow' : 'bg-black/60 text-gray-400 hover:text-white'}`;
