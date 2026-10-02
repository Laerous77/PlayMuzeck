// src/theme/PalettePicker.tsx
// Dipakai di sisi pengguna (ThemeSettings) DAN admin (AdminThemeManager).
// Warna bisa dipilih lewat color picker, kode hex, atau nilai RGB.
import React, { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import {
  Palette, contrastRatio, hexToRgb, modeOf, parseHex, presetsFor, readableOn, rgbToHex, samePalette, withMode,
} from './theme';

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

const CHANNELS = ['R', 'G', 'B'] as const;

const inputCls =
  'w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1 text-xs text-white font-mono outline-none focus:border-accent';

interface ColorFieldProps {
  label: string;
  value: string;
  onChange: (hex: string) => void;
}

const ColorField: React.FC<ColorFieldProps> = ({ label, value, onChange }) => {
  const [hex, setHex] = useState(value.toUpperCase());
  const [rgb, setRgb] = useState<string[]>(() => hexToRgb(value).map(String));

  // Sinkron saat nilai berubah dari luar (preset, picker, mode).
  useEffect(() => {
    setHex(value.toUpperCase());
    setRgb(hexToRgb(value).map(String));
  }, [value]);

  const onHexInput = (text: string) => {
    setHex(text);
    // Terapkan langsung hanya untuk 6 digit; bentuk 3 digit (#FA3) diterapkan saat blur.
    if (/^#?[0-9a-fA-F]{6}$/.test(text.trim())) {
      const p = parseHex(text);
      if (p) onChange(p);
    }
  };
  const commitHex = () => {
    const p = parseHex(hex);
    if (p) onChange(p);
    else setHex(value.toUpperCase());
  };

  const onChannelInput = (i: number, text: string) => {
    const next = [...rgb];
    next[i] = text.replace(/[^0-9]/g, '').slice(0, 3);
    setRgb(next);
    if (next.every((v) => v !== '' && Number(v) <= 255)) {
      onChange(rgbToHex(Number(next[0]), Number(next[1]), Number(next[2])));
    }
  };
  const commitChannels = () => {
    const nums = rgb.map((v) => Math.max(0, Math.min(255, Number(v) || 0)));
    onChange(rgbToHex(nums[0], nums[1], nums[2]));
    setRgb(nums.map(String));
  };

  return (
    <div className="text-xs text-gray-400 space-y-1.5">
      <span className="block">{label}</span>
      <input
        type="color"
        aria-label={`${label} (pemilih warna)`}
        value={value}
        onChange={(e) => onChange(e.target.value.toLowerCase())}
        className="h-10 w-full bg-transparent cursor-pointer"
      />
      <input
        type="text"
        aria-label={`${label} (kode hex)`}
        value={hex}
        maxLength={7}
        spellCheck={false}
        onChange={(e) => onHexInput(e.target.value)}
        onBlur={commitHex}
        onKeyDown={(e) => e.key === 'Enter' && commitHex()}
        placeholder="#FCA311"
        className={inputCls}
      />
      <div className="grid grid-cols-3 gap-1">
        {CHANNELS.map((c, i) => (
          <label key={c} className="block">
            <span className="sr-only">{`${label} kanal ${c}`}</span>
            <input
              type="text"
              inputMode="numeric"
              value={rgb[i]}
              onChange={(e) => onChannelInput(i, e.target.value)}
              onBlur={commitChannels}
              onKeyDown={(e) => e.key === 'Enter' && commitChannels()}
              placeholder={c}
              title={c}
              className={`${inputCls} text-center`}
            />
          </label>
        ))}
      </div>
      <span className="block text-[10px] text-gray-500">Hex atau RGB (0–255)</span>
    </div>
  );
};

export const PalettePicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const mode = modeOf(value.surface);
  const presets = presetsFor(mode);
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
          Mode mengikuti warna panel: panel terang = mode terang. Tombol ini menyesuaikan warna panel dan aksen otomatis.
        </p>
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1.5">
          Palette siap pakai · mode {mode === 'dark' ? 'gelap' : 'terang'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {presets.map((p) => (
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {FIELDS.map((f) => (
          <ColorField
            key={f.key}
            label={f.label}
            value={value[f.key]}
            onChange={(hex) => onChange({ ...value, [f.key]: hex })}
          />
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
