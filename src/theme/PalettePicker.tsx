// src/theme/PalettePicker.tsx
// Dipakai di sisi pengguna (ThemeSettings) DAN admin (AdminThemeManager).
import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { PRESETS, Palette, contrastRatio, modeOf, readableOn, samePalette, withMode } from './theme';

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

export const PalettePicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const mode = modeOf(value.surface);
  const weak = (['accent', 'accent2'] as const).filter((k) => contrastRatio(value[k], value.surface) < 3);

  return (
    <div className={`space-y-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Mode tampilan</p>
        <div className="inline-flex rounded-xl border border-white/10 p-0.5">
          {([['dark', 'Gelap', Moon], ['light', 'Terang', Sun]] as const).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => onChange(withMode(value, m))}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-bold cursor-pointer ${
                mode === m ? 'bg-accent text-on-accent' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Mode mengikuti warna panel: panel terang = mode terang. Tombol ini menyesuaikan warna panel otomatis.
        </p>
      </div>

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

      {weak.length > 0 && (
        <p className="text-[11px] text-amber-200">
          {weak.map((k) => (k === 'accent' ? 'Aksen Audio' : 'Aksen Kuis')).join(' dan ')} kurang kontras dengan warna
          panel — teks atau ikon berwarna aksen bisa susah dibaca. Pilih warna yang lebih {mode === 'dark' ? 'terang' : 'gelap'}.
        </p>
      )}

      <div className="rounded-xl p-3 flex flex-wrap items-center gap-2 border border-black/10" style={{ background: value.surface }}>
        <span className="px-3 py-1 rounded-lg text-xs font-bold" style={{ background: value.accent, color: readableOn(value.accent) }}>
          Audio
        </span>
        <span className="px-3 py-1 rounded-lg text-xs font-bold" style={{ background: value.accent2, color: readableOn(value.accent2) }}>
          Kuis
        </span>
        <span className="text-xs" style={{ color: readableOn(value.surface) }}>
          Pratinjau tema · mode {mode === 'dark' ? 'gelap' : 'terang'}
        </span>
      </div>
    </div>
  );
};
