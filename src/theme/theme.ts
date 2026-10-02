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

/** Palette siap pakai: 6 gelap + 6 terang. Daftar yang tampil mengikuti mode. Tidak dihitung ke batas slot. */
export const DARK_PRESETS: Array<{ id: string; label: string; palette: Palette }> = [
  { id: 'oxford-amber', label: 'Oxford Amber', palette: { surface: '#14213D', accent: '#FCA311', accent2: '#FC1212' } },
  { id: 'crimson-night', label: 'Crimson Night', palette: { surface: '#2A0F1A', accent: '#E11D48', accent2: '#FB7185' } },
  { id: 'emerald-studio', label: 'Emerald Studio', palette: { surface: '#0F2A24', accent: '#34D399', accent2: '#22D3EE' } },
  { id: 'violet-arena', label: 'Violet Arena', palette: { surface: '#1E1B3A', accent: '#A78BFA', accent2: '#F472B6' } },
  { id: 'ocean-sunset', label: 'Ocean Sunset', palette: { surface: '#0B2545', accent: '#38BDF8', accent2: '#FB923C' } },
  { id: 'forest-gold', label: 'Forest Gold', palette: { surface: '#142A1C', accent: '#EAB308', accent2: '#F97316' } },
];

export const LIGHT_PRESETS: Array<{ id: string; label: string; palette: Palette }> = [
  { id: 'daylight-sky', label: 'Daylight Sky', palette: { surface: '#FFFFFF', accent: '#0284C7', accent2: '#E11D48' } },
  { id: 'paper-amber', label: 'Paper Amber', palette: { surface: '#FFF8EB', accent: '#C2410C', accent2: '#7C3AED' } },
  { id: 'mint-light', label: 'Mint Light', palette: { surface: '#F0FDF4', accent: '#15803D', accent2: '#0E7490' } },
  { id: 'lavender-light', label: 'Lavender Light', palette: { surface: '#F5F3FF', accent: '#6D28D9', accent2: '#BE185D' } },
  { id: 'rose-light', label: 'Rose Light', palette: { surface: '#FFF1F2', accent: '#BE123C', accent2: '#0369A1' } },
  { id: 'ocean-light', label: 'Ocean Light', palette: { surface: '#F0F9FF', accent: '#0369A1', accent2: '#C2410C' } },
];

export const PRESETS = [...DARK_PRESETS, ...LIGHT_PRESETS];
export const presetsFor = (mode: Mode) => (mode === 'light' ? LIGHT_PRESETS : DARK_PRESETS);

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

export const hexToRgb = (hex: string): [number, number, number] => toRgb(hex);

export const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** Terima "#abc", "abc", "#AABBCC", "aabbcc" → "#aabbcc"; selain itu null. */
export function parseHex(input: string): string | null {
  const t = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(t)) return ('#' + t.split('').map((c) => c + c).join('')).toLowerCase();
  if (/^[0-9a-fA-F]{6}$/.test(t)) return ('#' + t).toLowerCase();
  return null;
}

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

/** Geser warna aksen sampai cukup kontras dengan panel (min rasio WCAG 3). */
function ensureContrast(hex: string, surface: string, min = 3): string {
  const target = modeOf(surface) === 'dark' ? '#ffffff' : '#000000';
  let c = hex;
  for (let i = 0; i < 12 && contrastRatio(c, surface) < min; i++) c = mixHex(c, target, 0.12);
  return c;
}

/** Ubah palette ke mode lain: rona panel dipertahankan, aksen disesuaikan agar tetap terbaca. */
export function withMode(p: Palette, mode: Mode): Palette {
  if (modeOf(p.surface) === mode) return p;
  const surface = mode === 'light' ? mixHex(p.surface, '#ffffff', 0.92) : mixHex(p.surface, '#000000', 0.85);
  return { surface, accent: ensureContrast(p.accent, surface), accent2: ensureContrast(p.accent2, surface) };
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
