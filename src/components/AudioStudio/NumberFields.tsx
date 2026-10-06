// src/components/AudioStudio/NumberFields.tsx
import React, { useState } from 'react';

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

interface IntFieldProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

/**
 * Input bilangan bulat yang bisa dikosongkan & diketik bebas.
 * Nilai baru dipakai (dan dibatasi min–max) saat blur atau Enter.
 */
export const IntField: React.FC<IntFieldProps> = ({ value, min, max, onChange, disabled, className, ariaLabel }) => {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft !== null) {
      const n = parseInt(draft, 10);
      if (!Number.isNaN(n)) onChange(clamp(n, min, max));
    }
    setDraft(null);
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={ariaLabel}
      disabled={disabled}
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(null);
      }}
      className={
        className ??
        'w-14 bg-black/80 rounded-lg border border-white/15 px-2 py-1 text-xs font-mono text-white text-center outline-none focus:border-accent'
      }
    />
  );
};

interface AdsrFieldProps {
  label: string; // contoh: "A (Attack)"
  kind: 'time' | 'percent';
  // time: detik; percent: 0–1
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

/**
 * Satu parameter ADSR: slider + kolom angka manual.
 * time → diketik dalam ms, percent → diketik dalam %.
 */
export const AdsrField: React.FC<AdsrFieldProps> = ({ label, kind, value, min, max, step, onChange }) => {
  const [draft, setDraft] = useState<string | null>(null);
  const factor = kind === 'time' ? 1000 : 100;
  const unit = kind === 'time' ? 'ms' : '%';
  const shown = Math.round(value * factor);

  const commit = () => {
    if (draft !== null) {
      const n = parseFloat(draft.replace(',', '.'));
      if (!Number.isNaN(n)) onChange(clamp(Math.round(n) / factor, min, max));
    }
    setDraft(null);
  };

  return (
    <div className="bg-black/40 px-3 py-2.5 rounded-lg border border-white/[0.04] space-y-2 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-400 font-bold">{label}</span>
        <div className="flex items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${label} dalam ${unit}`}
            value={draft ?? String(shown)}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, '').slice(0, 6))}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setDraft(null);
            }}
            className="w-16 bg-black/80 rounded-md border border-white/15 px-1.5 py-0.5 text-xs font-mono text-accent text-right outline-none focus:border-accent"
          />
          <span className="font-mono text-[11px] text-gray-500 w-5">{unit}</span>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
      />
    </div>
  );
};
