// src/theme/theme.ts
// Tipe, batas, preset, dan helper murni untuk sistem tema.

export interface Palette {
  surface: string; // warna panel/kartu
  accent: string;  // aksen Audio Studio
  accent2: string; // aksen Pusat Kuis
}

export type ThemeScope = 'admin' | 'user';

export interface ThemeRecord {
  id: number;
  name: string;
  scope: ThemeScope;
  palette: Palette;
}

/** Jumlah tema tersimpan (di luar tema bawaan). Server menegakkan angka yang sama. */
export const LIMITS = { admin: 7, user: 2 } as const;
export const NAME_MAX = 24;

/** Satu-satunya tema bawaan. Tidak bisa diubah/dihapus siapa pun. */
export const BUILTIN_THEME = {
  name: 'Oxford Amber',
  palette: { surface: '#14213D', accent: '#FCA311', accent2: '#FC1212' } as Palette,
};

/** Palette siap pakai sebagai titik awal. Tidak dihitung ke batas slot. */
export const PRESETS: Array<{ id: string; label: string; palette: Palette }> = [
  { id: 'oxford-amber', label: 'Oxford Amber', palette: { surface: '#14213D', accent: '#FCA311', accent2: '#FC1212' } },
  { id: 'crimson-night', label: 'Crimson Night', palette: { surface: '#2A0F1A', accent: '#E11D48', accent2: '#FB7185' } },
  { id: 'emerald-studio', label: 'Emerald Studio', palette: { surface: '#0F2A24', accent: '#34D399', accent2: '#22D3EE' } },
  { id: 'violet-arena', label: 'Violet Arena', palette: { surface: '#1E1B3A', accent: '#A78BFA', accent2: '#F472B6' } },
  { id: 'ocean-sunset', label: 'Ocean Sunset', palette: { surface: '#0B2545', accent: '#38BDF8', accent2: '#FB923C' } },
  { id: 'forest-gold', label: 'Forest Gold', palette: { surface: '#142A1C', accent: '#EAB308', accent2: '#F97316' } },
];

export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

export const isPalette = (p: any): p is Palette =>
  !!p && isHex(p.surface) && isHex(p.accent) && isHex(p.accent2);

export const samePalette = (a: Palette, b: Palette) =>
  a.surface.toLowerCase() === b.surface.toLowerCase() &&
  a.accent.toLowerCase() === b.accent.toLowerCase() &&
  a.accent2.toLowerCase() === b.accent2.toLowerCase();

/** Kecerahan 0–255 (rumus luma). */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
}

/** Warna teks yang terbaca di atas `hex`. */
export const readableOn = (hex: string) => (luminance(hex) > 150 ? '#000000' : '#ffffff');

export function applyPalette(p: Palette) {
  const s = document.documentElement.style;
  s.setProperty('--t-surface', p.surface);
  s.setProperty('--t-accent', p.accent);
  s.setProperty('--t-accent2', p.accent2);
  s.setProperty('--t-on-accent', readableOn(p.accent));
  s.setProperty('--t-on-accent2', readableOn(p.accent2));
}

// ── Cache lokal ────────────────────────────────────────────────────────────
// Hanya untuk menghindari kedipan saat halaman dibuka. Sumber kebenarannya
// tetap server; cache dibuang saat logout.
const CACHE_KEY = 'pm_palette';

export function cachePalette(p: Palette) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch { /* storage penuh/diblokir */ }
}
export function clearCachedPalette() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* abaikan */ }
}
export function applyCachedPalette() {
  try {
    const p = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (isPalette(p)) applyPalette(p);
  } catch { /* abaikan */ }
}
