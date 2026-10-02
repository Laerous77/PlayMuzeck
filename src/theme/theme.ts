// src/theme/theme.ts
// Tipe, batas, preset, dan helper murni untuk sistem tema.

export interface Palette {
  surface: string; // warna panel/kartu — juga menentukan mode terang/gelap
  accent: string;  // aksen Audio Studio
  accent2: string; // aksen Pusat Kuis
}

export type Mode = 'dark' | 'light';
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
  // Mode terang
  { id: 'daylight-sky', label: 'Daylight Sky (terang)', palette: { surface: '#FFFFFF', accent: '#0284C7', accent2: '#E11D48' } },
  { id: 'paper-amber', label: 'Paper Amber (terang)', palette: { surface: '#FFF8EB', accent: '#C2410C', accent2: '#7C3AED' } },
  { id: 'mint-light', label: 'Mint Light (terang)', palette: { surface: '#F0FDF4', accent: '#15803D', accent2: '#0E7490' } },
];

export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

export const isPalette = (p: any): p is Palette =>
  !!p && isHex(p.surface) && isHex(p.accent) && isHex(p.accent2);

export const samePalette = (a: Palette, b: Palette) =>
  a.surface.toLowerCase() === b.surface.toLowerCase() &&
  a.accent.toLowerCase() === b.accent.toLowerCase() &&
  a.accent2.toLowerCase() === b.accent2.toLowerCase();

// ── Warna ────────────────────────────────────────────────────────────────────
const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

/** Kecerahan 0–255 (rumus luma). */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Campur dua warna; t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const A = toRgb(a), B = toRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

const relLum = (hex: string) => {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Rasio kontras WCAG (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relLum(a), lb = relLum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Warna teks yang terbaca di atas `hex`. */
export const readableOn = (hex: string) => (luminance(hex) > 150 ? '#000000' : '#ffffff');

// ── Mode terang / gelap ──────────────────────────────────────────────────────
// Mode DITURUNKAN dari warna panel (bukan disimpan terpisah): panel terang →
// mode terang. Jadi server tidak perlu tahu soal mode, dan teks tidak mungkin
// "putih di atas putih".
export const LIGHT_THRESHOLD = 140;
export const modeOf = (surface: string): Mode => (luminance(surface) > LIGHT_THRESHOLD ? 'light' : 'dark');

/** Ubah palette ke mode lain dengan mempertahankan rona warna panel. */
export function withMode(p: Palette, mode: Mode): Palette {
  if (modeOf(p.surface) === mode) return p;
  return {
    ...p,
    surface: mode === 'light' ? mixHex(p.surface, '#ffffff', 0.92) : mixHex(p.surface, '#000000', 0.85),
  };
}

export function applyPalette(p: Palette) {
  const root = document.documentElement;
  const s = root.style;
  const mode = modeOf(p.surface);
  s.setProperty('--t-surface', p.surface);
  s.setProperty('--t-accent', p.accent);
  s.setProperty('--t-accent2', p.accent2);
  s.setProperty('--t-on-accent', readableOn(p.accent));
  s.setProperty('--t-on-accent2', readableOn(p.accent2));
  s.setProperty('--t-deep', mixHex(p.surface, '#000000', mode === 'dark' ? 0.35 : 0.035));
  s.setProperty('--t-bg', mode === 'dark' ? '#000000' : mixHex(p.surface, '#000000', 0.05));
  s.setProperty('--t-fg', mode === 'dark' ? '#E5E5E5' : '#1f2937');
  root.dataset.mode = mode;
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
