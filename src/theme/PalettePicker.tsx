// src/theme/PalettePicker.tsx
// Dipakai di sisi pengguna (ThemeSettings) DAN admin (AdminThemeManager).
// Warna bisa dipilih lewat color picker, kode hex, atau nilai RGB.
//
// Tiga mode:
//   Gelap / Terang — 3 warna (panel + 2 aksen); latar & teks diturunkan otomatis.
//   Kustom         — 5 warna bebas (latar, panel, teks, 2 aksen), tidak terikat dasar hitam/putih.
// Apa pun pilihannya, tampilan yang diterapkan selalu dijaga terbaca (lihat resolvePalette di theme.ts).
import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Moon, SlidersHorizontal, Sun, TriangleAlert } from 'lucide-react';
import {
  Palette, ThemeMode, auditPalette, hexToRgb, normalizePalette, paletteVars, parseHex, presetsFor,
  resolvePalette, rgbToHex, samePalette, themeModeOf, toCustom, withMode,
} from './theme';

interface Props {
  value: Palette;
  onChange: (p: Palette) => void;
  disabled?: boolean;
}

type FieldKey = 'bg' | 'surface' | 'text' | 'accent' | 'accent2';

const FIELD_LABEL: Record<FieldKey, string> = {
  bg: 'Latar halaman',
  surface: 'Warna panel',
  text: 'Warna teks',
  accent: 'Aksen Audio',
  accent2: 'Aksen Kuis',
};

const BASIC_FIELDS: FieldKey[] = ['surface', 'accent', 'accent2'];
const CUSTOM_FIELDS: FieldKey[] = ['bg', 'surface', 'text', 'accent', 'accent2'];

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

const MODES: Array<{ id: ThemeMode; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dark', label: 'Gelap', Icon: Moon },
  { id: 'light', label: 'Terang', Icon: Sun },
  { id: 'custom', label: 'Kustom', Icon: SlidersHorizontal },
];

const MODE_HINT: Record<ThemeMode, string> = {
  dark: 'Latar hitam, teks terang. Kamu cukup memilih warna panel dan aksen.',
  light: 'Latar terang, teks gelap. Kamu cukup memilih warna panel dan aksen.',
  custom:
    'Bebas dari dasar hitam/putih: tentukan sendiri latar, panel, teks, dan aksen. Kalau ada pasangan warna yang sulit dibaca, tampilan akan disesuaikan otomatis.',
};

export const PalettePicker: React.FC<Props> = ({ value, onChange, disabled }) => {
  const mode = themeModeOf(value);
  const presets = presetsFor(mode);
  const resolved = useMemo(() => resolvePalette(value), [value]);
  const rows = useMemo(() => auditPalette(value), [value]);
  const fields = mode === 'custom' ? CUSTOM_FIELDS : BASIC_FIELDS;
  const vars = useMemo(() => paletteVars(value), [value]);

  const pickMode = (m: ThemeMode) => {
    if (m === mode) return;
    onChange(m === 'custom' ? toCustom(value) : withMode(value, m));
  };

  // Nilai awal untuk bg/teks diambil dari yang sedang berlaku, jadi berpindah ke Kustom tidak mengubah tampilan.
  const valueOf = (k: FieldKey): string => {
    if (k === 'bg') return value.bg ?? resolved.bg;
    if (k === 'text') return value.text ?? resolved.text;
    return value[k];
  };

  return (
    <div className={`space-y-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <div>
        <p className="text-xs text-gray-400 mb-1.5">Mode tampilan</p>
        <div className="inline-flex rounded-xl border border-white/10 p-0.5">
          {MODES.map(({ id, label, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => pickMode(id)}
              aria-pressed={mode === id}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-bold cursor-pointer ${
                mode === id ? 'bg-accent text-on-accent' : 'text-gray-300 hover:bg-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500 mt-1">{MODE_HINT[mode]}</p>
      </div>

      <div>
        <p className="text-xs text-gray-400 mb-1.5">
          Palette siap pakai · {mode === 'dark' ? 'gelap' : mode === 'light' ? 'terang' : 'kustom'}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(p.palette)}
              className={`rounded-xl border p-2.5 text-left cursor-pointer ${
                samePalette(normalizePalette(p.palette), normalizePalette(value)) ? 'border-accent' : 'border-white/10 hover:border-white/30'
              }`}
            >
              <div className="flex gap-1 mb-1.5">
                {[p.palette.bg, p.palette.surface, p.palette.text, p.palette.accent, p.palette.accent2]
                  .filter((c): c is string => !!c)
                  .map((c, i) => (
                    <span key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
                  ))}
              </div>
              <p className="text-xs font-semibold text-white">{p.label}</p>
            </button>
          ))}
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${mode === 'custom' ? 'sm:grid-cols-2 lg:grid-cols-3' : 'sm:grid-cols-3'}`}>
        {fields.map((k) => (
          <ColorField
            key={k}
            label={FIELD_LABEL[k]}
            value={valueOf(k)}
            onChange={(hex) => onChange({ ...(mode === 'custom' ? toCustom(value) : value), [k]: hex })}
          />
        ))}
      </div>

      {/* Pemeriksa kontras: menilai pilihan ASLI pengguna. */}
      <div className="rounded-xl border border-white/10 p-3 space-y-1.5">
        <p className="text-xs font-semibold text-white">Keterbacaan</p>
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 text-[11px]">
              {r.ok ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <TriangleAlert className="w-3.5 h-3.5 text-amber-300 shrink-0" />
              )}
              <span className="text-gray-300 flex-1">{r.label}</span>
              <span className={`font-mono ${r.ok ? 'text-gray-400' : 'text-amber-300'}`}>
                {r.ratio.toFixed(1)}:1
              </span>
            </li>
          ))}
        </ul>
        {resolved.notes.length > 0 && (
          <ul className="text-[11px] text-amber-300 space-y-0.5 pt-1">
            {resolved.notes.map((n) => (
              <li key={n}>• {n}</li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-gray-500">
          Warna pilihanmu tetap tersimpan apa adanya. Saat dipakai, warna yang terlalu sulit dibaca digeser otomatis (hanya di layar).
        </p>
      </div>

      {/* Pratinjau memakai variabel tema sungguhan, jadi hasilnya sama dengan di situs. */}
      <div
        className="rounded-xl p-3 border border-white/10 bg-page text-fg space-y-2"
        style={vars as React.CSSProperties}
        aria-label="Pratinjau tema"
      >
        <div className="rounded-lg bg-surface border border-white/10 p-3 space-y-2">
          <p className="text-sm font-bold text-white">Pratinjau tema</p>
          <p className="text-xs text-gray-300">Teks biasa di atas panel.</p>
          <p className="text-xs text-gray-400">Teks redup untuk keterangan kecil.</p>
          <p className="text-xs text-accent">Tautan atau penekanan beraksen Audio</p>
          <p className="text-xs text-accent2">Penekanan beraksen Kuis</p>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-accent text-on-accent">Audio</span>
            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-accent2 text-on-accent2">Kuis</span>
            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-emerald-500 text-black">Benar</span>
            <span className="px-3 py-1 rounded-lg text-xs font-bold bg-red-500 text-white">Salah</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="px-2 py-1 rounded-md text-[11px] bg-emerald-500/20 text-emerald-400">Berhasil disimpan</span>
            <span className="px-2 py-1 rounded-md text-[11px] bg-red-500/10 text-red-300">Terjadi kesalahan</span>
            <span className="px-2 py-1 rounded-md text-[11px] bg-amber-500/10 text-amber-300">Perhatian</span>
          </div>
          <input
            readOnly
            value="Kolom isian"
            className="w-full rounded-lg bg-black/40 border border-white/10 px-2 py-1 text-xs text-white outline-none"
          />
        </div>
      </div>
    </div>
  );
};
