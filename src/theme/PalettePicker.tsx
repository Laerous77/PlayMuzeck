// src/theme/PalettePicker.tsx
// Dipakai di sisi pengguna (ThemeSettings) DAN admin (AdminThemeManager).
import React from 'react';
import { PRESETS, Palette, luminance, readableOn, samePalette } from './theme';

interface Props {
  value: Palette;
  onChange: (p: Palette) => void;
  disabled?: boolean;
}

const FIELDS: Array<{ key: keyof Palette; label: string }> = [
  { key: 'surface', label: 'Warna panel' },
  { key: 'accent', label: 'Aksen Audio' },
  { key: 'accent2', label: 'Aksen Kuis' },
];

export const PalettePicker: React.FC<Props> = ({ value, onChange, disabled }) => (
  <div className={`space-y-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
    <div>
      <p className="text-xs text-gray-400 mb-1.5">Mulai dari palette siap pakai</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.palette)}
            className={`rounded-xl border p-2.5 text-left cursor-pointer ${
              samePalette(p.palette, value) ? 'border-accent' : 'border-white/10 hover:border-white/30'
            }`}
          >
            <div className="flex gap-1 mb-1.5">
              {[p.palette.surface, p.palette.accent, p.palette.accent2].map((c, i) => (
                <span key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
              ))}
            </div>
            <p className="text-xs font-semibold text-white">{p.label}</p>
          </button>
        ))}
      </div>
    </div>

    <div className="grid grid-cols-3 gap-3">
      {FIELDS.map((f) => (
        <label key={f.key} className="text-xs text-gray-400">
          {f.label}
          <input
            type="color"
            value={value[f.key]}
            onChange={(e) => onChange({ ...value, [f.key]: e.target.value })}
            className="mt-1 h-10 w-full bg-transparent cursor-pointer"
          />
          <span className="font-mono text-[10px] text-gray-500">{value[f.key].toUpperCase()}</span>
        </label>
      ))}
    </div>

    {luminance(value.surface) > 120 && (
      <p className="text-[11px] text-amber-200">
        Warna panel ini terlalu terang — teks putih di dalam kartu bakal susah dibaca. Pilih yang lebih gelap.
      </p>
    )}

    <div className="rounded-xl p-3 flex flex-wrap items-center gap-2 border border-white/10" style={{ background: value.surface }}>
      <span className="px-3 py-1 rounded-lg text-xs font-bold" style={{ background: value.accent, color: readableOn(value.accent) }}>
        Audio
      </span>
      <span className="px-3 py-1 rounded-lg text-xs font-bold" style={{ background: value.accent2, color: readableOn(value.accent2) }}>
        Kuis
      </span>
      <span className="text-xs text-gray-300">Pratinjau tema</span>
    </div>
  </div>
);
