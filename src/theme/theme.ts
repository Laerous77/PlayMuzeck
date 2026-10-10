// src/theme/theme.ts
// Tipe, batas, preset, dan mesin warna untuk sistem tema.
//
// PRINSIP: pengguna boleh memilih warna apa pun, tetapi yang DITERAPKAN ke layar selalu lolos
// pemeriksaan kontras. Simpanan tema tetap berisi pilihan asli pengguna; penyesuaian dilakukan
// saat menerapkan (resolvePalette), jadi tidak ada data yang diubah diam-diam.
//
// Cara kerjanya:
//   1. Dari palette (3 warna, atau 5 warna di mode Kustom) dihitung "Resolved": warna efektif
//      yang sudah dijamin terbaca (teks ≥ 4.5:1, aksen terlihat ≥ 3:1, dst).
//   2. Dari Resolved dibangkitkan SELURUH skala warna Tailwind yang dipakai kode lama
//      (white/black, gray/zinc/slate/neutral/stone, red/emerald/amber/… 50–950) sebagai
//      variabel CSS. Jadi ratusan kelas lama (text-gray-400, text-red-300, bg-black/40, …)
//      otomatis ikut tema tanpa mengedit komponen satu per satu.

export interface Palette {
  surface: string; // warna panel/kartu
  accent: string;  // aksen Audio Studio
  accent2: string; // aksen Pusat Kuis
  /** Mode Kustom: latar halaman. Kosong = diturunkan otomatis (hitam/putih-ish). */
  bg?: string;
  /** Mode Kustom: warna teks utama. Kosong = diturunkan otomatis. */
  text?: string;
}

/** Nada hasil turunan (bukan pilihan pengguna). */
export type Mode = 'dark' | 'light';
/** Pilihan di UI: gelap, terang, atau kustom (bebas dari dasar hitam/putih). */
export type ThemeMode = Mode | 'custom';
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

// ── Preset ───────────────────────────────────────────────────────────────────
type Preset = { id: string; label: string; palette: Palette };

export const DARK_PRESETS: Preset[] = [
  { id: 'oxford-amber', label: 'Oxford Amber', palette: { surface: '#14213D', accent: '#FCA311', accent2: '#FC1212' } },
  { id: 'crimson-night', label: 'Crimson Night', palette: { surface: '#2A0F1A', accent: '#E11D48', accent2: '#FB7185' } },
  { id: 'emerald-studio', label: 'Emerald Studio', palette: { surface: '#0F2A24', accent: '#34D399', accent2: '#22D3EE' } },
  { id: 'violet-arena', label: 'Violet Arena', palette: { surface: '#1E1B3A', accent: '#A78BFA', accent2: '#F472B6' } },
  { id: 'ocean-sunset', label: 'Ocean Sunset', palette: { surface: '#0B2545', accent: '#38BDF8', accent2: '#FB923C' } },
  { id: 'forest-gold', label: 'Forest Gold', palette: { surface: '#142A1C', accent: '#EAB308', accent2: '#F97316' } },
];

export const LIGHT_PRESETS: Preset[] = [
  { id: 'daylight-sky', label: 'Daylight Sky', palette: { surface: '#FFFFFF', accent: '#0284C7', accent2: '#E11D48' } },
  { id: 'paper-amber', label: 'Paper Amber', palette: { surface: '#FFF8EB', accent: '#C2410C', accent2: '#7C3AED' } },
  { id: 'mint-light', label: 'Mint Light', palette: { surface: '#F0FDF4', accent: '#15803D', accent2: '#0E7490' } },
  { id: 'lavender-light', label: 'Lavender Light', palette: { surface: '#F5F3FF', accent: '#6D28D9', accent2: '#BE185D' } },
  { id: 'rose-light', label: 'Rose Light', palette: { surface: '#FFF1F2', accent: '#BE123C', accent2: '#0369A1' } },
  { id: 'ocean-light', label: 'Ocean Light', palette: { surface: '#F0F9FF', accent: '#0369A1', accent2: '#C2410C' } },
];

/** Preset Kustom: latar & teks BUKAN hitam/putih. Contoh cara memakai mode bebas. */
export const CUSTOM_PRESETS: Preset[] = [
  { id: 'cafe-sepia', label: 'Café Sepia', palette: { bg: '#241a12', surface: '#3a2b1e', text: '#f3e5d0', accent: '#e0a458', accent2: '#e07a5f' } },
  { id: 'nord-frost', label: 'Nord Frost', palette: { bg: '#2e3440', surface: '#3b4252', text: '#eceff4', accent: '#88c0d0', accent2: '#ebcb8b' } },
  { id: 'cream-ink', label: 'Cream & Ink', palette: { bg: '#fdf6e3', surface: '#eee8d5', text: '#073642', accent: '#9a6b00', accent2: '#b23a1d' } },
  { id: 'midnight-plum', label: 'Midnight Plum', palette: { bg: '#1a1023', surface: '#2a1b3a', text: '#f1e7ff', accent: '#ff9ecb', accent2: '#7dd3fc' } },
  { id: 'slate-steel', label: 'Slate Steel', palette: { bg: '#cbd5e1', surface: '#e2e8f0', text: '#0f172a', accent: '#1d4ed8', accent2: '#be123c' } },
  { id: 'terminal-green', label: 'Terminal Green', palette: { bg: '#07140b', surface: '#0f2a18', text: '#d1fae5', accent: '#4ade80', accent2: '#facc15' } },
];

export const PRESETS: Preset[] = [...DARK_PRESETS, ...LIGHT_PRESETS, ...CUSTOM_PRESETS];
export const presetsFor = (mode: ThemeMode): Preset[] =>
  mode === 'light' ? LIGHT_PRESETS : mode === 'custom' ? CUSTOM_PRESETS : DARK_PRESETS;

// ── Validasi & perbandingan ──────────────────────────────────────────────────
export const isHex = (s: unknown): s is string => typeof s === 'string' && /^#[0-9a-fA-F]{6}$/.test(s);

const optHex = (v: unknown) => v === undefined || v === null || v === '' || isHex(v);

export const isPalette = (p: any): p is Palette =>
  !!p && isHex(p.surface) && isHex(p.accent) && isHex(p.accent2) && optHex(p.bg) && optHex(p.text);

/** Rapikan: huruf kecil, buang bg/text kosong. Aman dipanggil berulang. */
export function normalizePalette(p: Palette): Palette {
  const out: Palette = { surface: p.surface.toLowerCase(), accent: p.accent.toLowerCase(), accent2: p.accent2.toLowerCase() };
  if (isHex(p.bg)) out.bg = p.bg.toLowerCase();
  if (isHex(p.text)) out.text = p.text.toLowerCase();
  return out;
}

const lc = (s?: string) => (s ? s.toLowerCase() : '');
export const samePalette = (a: Palette, b: Palette) =>
  lc(a.surface) === lc(b.surface) && lc(a.accent) === lc(b.accent) && lc(a.accent2) === lc(b.accent2) &&
  lc(a.bg) === lc(b.bg) && lc(a.text) === lc(b.text);

/** Mode Kustom = pengguna menentukan latar atau teks sendiri. */
export const isCustom = (p: Palette) => isHex(p.bg) || isHex(p.text);

// ── Warna dasar ──────────────────────────────────────────────────────────────
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

/** Kecerahan 0–255 (rumus luma). Dipertahankan untuk kode lama. */
export function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Campur dua warna di ruang sRGB; t=0 → a, t=1 → b. */
export function mixHex(a: string, b: string, t: number): string {
  const A = toRgb(a), B = toRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}

// ── OKLab (campuran & pengaturan terang-gelap yang selaras dengan mata) ──────
type Vec3 = [number, number, number];
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lin = (v255: number) => {
  const c = v255 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const delin = (l: number) => {
  const c = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  return Math.round(clamp01(c) * 255);
};

function hexToOklab(hex: string): Vec3 {
  const [R, G, B] = toRgb(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear(L: number, a: number, b: number): Vec3 {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const linToHex = ([r, g, b]: Vec3) => rgbToHex(delin(r), delin(g), delin(b));
const inGamut = (v: Vec3) => v.every((c) => c >= -0.0005 && c <= 1.0005);

function oklabToHex(lab: Vec3): string {
  return linToHex(oklabToLinear(lab[0], lab[1], lab[2]));
}

/** OKLCH → hex. Kalau di luar gamut sRGB, kroma dikurangi (rona & terang tetap). */
function oklchToHex(L: number, C: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  const at = (c: number) => oklabToLinear(L, c * Math.cos(rad), c * Math.sin(rad));
  if (inGamut(at(C))) return linToHex(at(C));
  let lo = 0, hi = C;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid; else hi = mid;
  }
  return linToHex(at(lo));
}

/** Campur di ruang OKLab (lebih rata daripada sRGB). */
export function mixOk(a: string, b: string, t: number): string {
  const A = hexToOklab(a), B = hexToOklab(b);
  return oklabToHex([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
}

// ── Kontras (WCAG) ───────────────────────────────────────────────────────────
/** Luminans relatif WCAG (0–1). */
export const relLum = (hex: string) => {
  const [r, g, b] = toRgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Rasio kontras WCAG (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relLum(a), lb = relLum(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

const minContrast = (c: string, bgs: string[]) => Math.min(...bgs.map((b) => contrastRatio(c, b)));

/** Syarat kontras: [latar, rasio minimum]. */
type Req = Array<[string, number]>;
/** Seberapa terpenuhi semua syarat: ≥ 1 berarti semuanya lolos. */
const slack = (c: string, req: Req) => Math.min(...req.map(([b, m]) => contrastRatio(c, b) / m));

/** Warna teks (hitam/putih) dengan kontras terbaik di atas `hex`. Selalu ≥ 4.58:1. */
export const readableOn = (hex: string) =>
  contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000000' : '#ffffff';

/**
 * Geser `hex` (rona dipertahankan) sampai SEMUA syarat kontras terpenuhi.
 * Arah (ke putih/ke hitam) dipilih otomatis dari yang paling memungkinkan, jadi tidak bergantung
 * pada asumsi "gelap/terang". Kalau tidak ada warna yang bisa memenuhi semuanya (mis. latar campuran
 * hitam dan putih), dicari yang paling mendekati.
 */
export function pushReq(hex: string, req: Req): string {
  if (slack(hex, req) >= 1) return hex;
  const ends = ['#ffffff', '#000000'].sort((x, y) => slack(y, req) - slack(x, req));
  const target = ends[0];
  if (slack(target, req) >= 1) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (slack(mixOk(hex, target, mid), req) >= 1) hi = mid; else lo = mid;
    }
    const r = mixOk(hex, target, hi);
    return slack(r, req) >= 1 ? r : target;
  }
  const [, a, b] = hexToOklab(hex);
  const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180) / Math.PI;
  let best = target, bestScore = slack(target, req);
  for (let i = 0; i <= 50; i++) {
    const c = oklchToHex(i / 50, C, h);
    const sc = slack(c, req);
    if (sc > bestScore) { best = c; bestScore = sc; }
  }
  return best;
}

/** Versi sederhana: satu rasio minimum untuk semua latar. */
export const pushContrast = (hex: string, bgs: string[], min: number): string =>
  pushReq(hex, bgs.map((b) => [b, min] as [string, number]));

const TEXT_MIN = 4.5;

/** Teks berwarna di atas latar utama (≥ 4.5:1) dan di atas noda warna yang sama (≥ 3.5:1). */
function pushText(hex: string, grounds: string[], tint: string): string {
  const strict: Req = [...grounds.map((g) => [g, TEXT_MIN] as [string, number]), [tint, 3.5]];
  const r = pushReq(hex, strict);
  if (slack(r, strict) >= 1) return r;
  // Panel bernada menengah: utamakan latar & panel, noda hanya pelengkap.
  return pushReq(hex, grounds.map((g) => [g, TEXT_MIN] as [string, number]));
}

/** Cari warna ber-rona `h` & kroma `C` yang luminans relatifnya ≈ `target`. */
function colorAtLum(C: number, h: number, target: number): string {
  let lo = 0, hi = 1, best = oklchToHex(0.6, C, h);
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    best = oklchToHex(mid, C, h);
    if (relLum(best) < target) lo = mid; else hi = mid;
  }
  return best;
}

// ── Mode terang / gelap ──────────────────────────────────────────────────────
// Titik silang WCAG: pada luminans ini kontras terhadap hitam = terhadap putih (4.58:1).
// Panel di atasnya lebih terbaca dengan teks gelap, di bawahnya dengan teks terang.
const CROSSOVER = 0.179;
export const modeOf = (surface: string): Mode => (relLum(surface) > CROSSOVER ? 'light' : 'dark');
/** Pilihan mode di UI untuk sebuah palette. */
export const themeModeOf = (p: Palette): ThemeMode => (isCustom(p) ? 'custom' : modeOf(p.surface));

/**
 * Pindah ke mode gelap/terang bawaan: latar & teks kustom dibuang, rona panel dipertahankan,
 * aksen disesuaikan agar tetap terlihat.
 */
export function withMode(p: Palette, mode: Mode): Palette {
  const keep = !isCustom(p) && modeOf(p.surface) === mode;
  if (keep) return p;
  const flip = modeOf(p.surface) !== mode;
  const surface = !flip ? p.surface : mode === 'light' ? mixHex(p.surface, '#ffffff', 0.92) : mixHex(p.surface, '#000000', 0.85);
  const bg = mode === 'dark' ? '#000000' : mixHex(surface, '#000000', 0.05);
  return {
    surface,
    accent: pushContrast(p.accent, [surface, bg], 3),
    accent2: pushContrast(p.accent2, [surface, bg], 3),
  };
}

/** Masuk mode Kustom tanpa mengubah tampilan: latar & teks yang sedang berlaku dijadikan nilai eksplisit. */
export function toCustom(p: Palette): Palette {
  const r = resolvePalette(p);
  // Hanya mengisi yang belum ada; pilihan asli pengguna tidak ditimpa nilai hasil penyesuaian.
  return { surface: p.surface, accent: p.accent, accent2: p.accent2, bg: p.bg ?? r.bg, text: p.text ?? r.text };
}

// ── Palette → warna efektif yang dijamin terbaca ─────────────────────────────
export interface Resolved {
  tone: Mode;        // terang/gelap hasil turunan (dari latar vs teks)
  custom: boolean;
  surface: string;
  bg: string;        // latar halaman
  deep: string;      // panel yang lebih dalam dari surface
  text: string;      // teks utama (jadi "white" di kelas lama)
  fg: string;        // teks dasar body
  accent: string;    // aksen untuk isian/garis (sudah dipastikan terlihat)
  accent2: string;
  accentText: string;  // aksen versi teks (kontras ≥ 4.5 di atas panel)
  accent2Text: string;
  onAccent: string;    // teks di atas tombol aksen
  onAccent2: string;
  /** Penjelasan penyesuaian otomatis untuk ditampilkan ke pengguna. */
  notes: string[];
}

const TEXT_GOOD = 7;
const ACCENT_MIN = 3;

export function resolvePalette(p: Palette): Resolved {
  const notes: string[] = [];
  const surface = p.surface.toLowerCase();
  const custom = isCustom(p);
  const surfaceTone = modeOf(surface);

  // Latar halaman & panel dalam.
  let bg: string, deep: string;
  if (custom) {
    bg = isHex(p.bg) ? p.bg.toLowerCase() : surfaceTone === 'dark' ? '#000000' : mixHex(surface, '#000000', 0.05);
    deep = mixHex(surface, bg, 0.4);
  } else {
    bg = surfaceTone === 'dark' ? '#000000' : mixHex(surface, '#000000', 0.05);
    deep = mixHex(surface, '#000000', surfaceTone === 'dark' ? 0.35 : 0.035);
  }

  // Harus ada SATU warna teks (hitam atau putih) yang terbaca di atas latar, panel, dan panel dalam.
  // Kalau tidak (mis. panel terang di atas latar gelap, atau panel tepat di titik silang), latar digeser
  // mendekati panel secukupnya.
  const feasible = (b: string, d: string) =>
    Math.max(minContrast('#ffffff', [b, surface, d]), minContrast('#000000', [b, surface, d])) >= TEXT_MIN;
  if (!feasible(bg, deep)) {
    const bg0 = bg, deep0 = deep;
    const at = (t: number): [string, string] => {
      const b2 = mixOk(bg0, surface, t);
      return [b2, custom ? mixHex(surface, b2, 0.4) : mixOk(deep0, surface, t)];
    };
    let lo = 0, hi = 1;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      const [b2, d2] = at(mid);
      if (feasible(b2, d2)) hi = mid; else lo = mid;
    }
    [bg, deep] = at(hi);
    if (custom) {
      notes.push('Latar halaman digeser mendekati warna panel, karena panel dan latar berlawanan terang-gelap sehingga satu warna teks tidak bisa terbaca di keduanya.');
    }
  }

  const text0 = custom && isHex(p.text) ? p.text.toLowerCase() : relLum(bg) > CROSSOVER ? '#0f172a' : '#ffffff';
  const fg0 = custom ? text0 : relLum(bg) > CROSSOVER ? '#1f2937' : '#e5e5e5';
  const tone: Mode = custom ? (relLum(bg) < relLum(text0) ? 'dark' : 'light') : surfaceTone;

  // Teks harus terbaca di atas latar, panel, dan panel dalam sekaligus.
  const grounds = [bg, surface, deep];
  const fixText = (c: string) => {
    if (minContrast(c, grounds) >= TEXT_MIN) return c;
    const hi = pushContrast(c, grounds, TEXT_GOOD);
    return minContrast(hi, grounds) >= TEXT_GOOD ? hi : pushContrast(c, grounds, TEXT_MIN);
  };
  const text = fixText(text0);
  const fg = custom ? text : fixText(fg0);
  if (custom && text !== text0) notes.push('Warna teks disesuaikan otomatis agar terbaca di atas latar dan panel.');

  // Aksen untuk isian/garis: minimal terlihat jelas (3:1) di atas panel dan latar.
  const fixAccent = (c: string, label: string) => {
    const eff = pushContrast(c.toLowerCase(), [surface, bg], ACCENT_MIN);
    if (eff !== c.toLowerCase()) notes.push(`${label} terlalu mirip warna panel/latar, jadi dicerahkan atau digelapkan sedikit agar terlihat.`);
    return eff;
  };
  const accent = fixAccent(p.accent, 'Aksen Audio');
  const accent2 = fixAccent(p.accent2, 'Aksen Kuis');

  // Aksen sebagai TEKS (text-accent): kontras 4.5:1 di atas panel, latar, dan panel bernoda aksen.
  const accentText = pushText(accent, grounds, mixOk(surface, accent, 0.25));
  const accent2Text = pushText(accent2, grounds, mixOk(surface, accent2, 0.25));

  return {
    tone, custom, surface, bg, deep, text, fg,
    accent, accent2, accentText, accent2Text,
    onAccent: readableOn(accent),
    onAccent2: readableOn(accent2),
    notes,
  };
}

// ── Skala warna turunan ──────────────────────────────────────────────────────
const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

// Posisi tiap langkah pada garis teks → latar (0 = teks, 1 = latar). Nilai berasal dari skala
// Tailwind bawaan (gelap) dan versi cerminnya (terang), sehingga tampilan bawaan nyaris sama.
const T_DARK: Record<number, number> = { 50: 0, 100: 0.021, 200: 0.067, 300: 0.132, 400: 0.325, 500: 0.507, 600: 0.63, 700: 0.717, 800: 0.827, 900: 0.905, 950: 1 };
const T_LIGHT: Record<number, number> = { 50: 0, 100: 0.095, 200: 0.173, 300: 0.283, 400: 0.37, 500: 0.493, 600: 0.675, 700: 0.868, 800: 0.933, 900: 0.979, 950: 1 };

const NEUTRALS = ['gray', 'zinc', 'slate', 'neutral', 'stone'] as const;

// [kroma, rona] (OKLCH) dari warna 500 Tailwind v4.
const HUES: Record<string, [number, number]> = {
  red: [0.237, 25.331], orange: [0.213, 47.604], amber: [0.188, 70.08], yellow: [0.184, 86.047],
  lime: [0.233, 130.85], green: [0.219, 149.579], emerald: [0.17, 162.48], teal: [0.14, 182.503],
  cyan: [0.143, 215.221], sky: [0.169, 237.323], blue: [0.214, 259.815], indigo: [0.233, 277.117],
  violet: [0.25, 292.717], purple: [0.265, 303.9], fuchsia: [0.295, 322.15], pink: [0.241, 354.308],
  rose: [0.246, 16.439],
};

// Kode lama memakai teks "hitam" (text-black) di atas isian hijau/kuning/jingga-muda dan teks "putih"
// di atas merah/ungu/biru. Tiap rona diberi luminans isian yang mengutamakan pasangan itu (kontras ≈ 6.5:1)
// sambil tetap ≥ 3:1 untuk pasangan sebaliknya.
const BLACK_TEXT_HUES = new Set(['emerald', 'green', 'lime', 'amber', 'yellow', 'teal', 'cyan']);
const SOLID_TARGET = 6.5;

function solidLumFor(hue: string, r: Resolved): number {
  const Lt = relLum(r.text), Lb = relLum(r.bg);
  const cross = Math.min(0.5, Math.max(0.02, Math.sqrt((Lt + 0.05) * (Lb + 0.05)) - 0.05));
  const pref = BLACK_TEXT_HUES.has(hue) ? Lb : Lt;
  const other = BLACK_TEXT_HUES.has(hue) ? Lt : Lb;
  // Turunkan sasaran dari 6.5:1 sampai pasangan sebaliknya masih ≥ 3:1. Kalau tidak ada yang cocok,
  // pakai titik silang (kontras sama besar ke keduanya).
  for (let T = SOLID_TARGET; T >= 3 - 1e-9; T -= 0.25) {
    if (pref > other) {
      const lum = (pref + 0.05) / T - 0.05;             // isian lebih gelap dari teks pilihan
      if (lum >= 0.005 && (lum + 0.05) / (other + 0.05) >= 3) return lum;
    } else {
      const lum = T * (pref + 0.05) - 0.05;             // isian lebih terang dari teks pilihan
      if (lum <= 0.7 && (other + 0.05) / (lum + 0.05) >= 3) return lum;
    }
  }
  return cross;
}

/** Abu-abu: teks → latar. Langkah yang dipakai sebagai teks (50–600) dijaga tetap terbaca. */
function neutralScale(r: Resolved): Record<number, string> {
  const table = r.tone === 'dark' ? T_DARK : T_LIGHT;
  const grounds = [r.bg, r.surface, r.deep];
  const maxT = (min: number) => {
    let lo = 0, hi = 1;
    if (minContrast(mixOk(r.text, r.bg, 1), grounds) >= min) return 1;
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (minContrast(mixOk(r.text, r.bg, mid), grounds) >= min) lo = mid; else hi = mid;
    }
    return lo;
  };
  const t45 = maxT(TEXT_MIN), t30 = maxT(3);
  const out: Record<number, string> = {};
  for (const s of STEPS) {
    let t = table[s];
    if (s <= 500) t = Math.min(t, t45);
    else if (s === 600) t = Math.min(t, t30);
    out[s] = t >= 1 ? r.bg : mixOk(r.text, r.bg, t);
  }
  return out;
}

// Sasaran terang (OKLab L) & kadar kroma untuk langkah teks 50–400.
const TXT_DARK = { L: [0.975, 0.94, 0.89, 0.82, 0.74], k: [0.05, 0.1, 0.25, 0.5, 0.8] };
const TXT_LIGHT = { L: [0.28, 0.34, 0.4, 0.46, 0.52], k: [0.4, 0.45, 0.5, 0.6, 0.75] };

/**
 * Warna status (merah, hijau, dst):
 *  50–400  = teks: dipaksa ≥ 4.5:1 di atas latar, panel, dan panel bernoda warna itu sendiri.
 *  500–700 = isian solid: luminans dipilih agar pasangan teks yang lazim dipakai kode lama
 *            (text-black atau text-white) ≥ 6.5:1 dan pasangan sebaliknya tetap ≥ 3:1.
 *  800–950 = noda tipis di atas panel (bg-red-900/25, border-red-900, …).
 */
function statusScale(name: string, r: Resolved): Record<number, string> {
  const [C, h] = HUES[name];
  const dark = r.tone === 'dark';
  const solidLum = solidLumFor(name, r);
  const shade = !BLACK_TEXT_HUES.has(name);          // rona berteks gelap tidak digeser luminansnya
  const s500 = colorAtLum(C, h, solidLum);
  const s600 = colorAtLum(C * 0.95, h, shade ? Math.min(0.5, Math.max(0.02, solidLum * (dark ? 0.85 : 1.15))) : solidLum);
  const s700 = colorAtLum(C * 0.88, h, shade ? Math.min(0.5, Math.max(0.02, solidLum * (dark ? 0.65 : 1.3))) : solidLum);
  const grounds = [r.bg, r.surface, r.deep];
  const tint = mixOk(r.surface, s500, 0.25);
  const tbl = dark ? TXT_DARK : TXT_LIGHT;
  const out: Record<number, string> = { 500: s500, 600: s600, 700: s700 };
  [50, 100, 200, 300, 400].forEach((s, i) => {
    out[s] = pushText(oklchToHex(tbl.L[i], C * tbl.k[i], h), grounds, tint);
  });
  out[800] = mixOk(r.surface, s500, 0.45);
  out[900] = mixOk(r.surface, s500, 0.3);
  out[950] = mixOk(r.surface, s500, 0.18);
  return out;
}

// ── Palette → variabel CSS ───────────────────────────────────────────────────
let lastKey = '';
let lastVars: Record<string, string> = {};

/** Variabel CSS (--t-*, --color-*) untuk sebuah palette. Dipakai applyPalette dan konsol admin/pratinjau (terbatas di satu elemen). */
export function paletteVars(p: Palette): Record<string, string> {
  const key = JSON.stringify(normalizePalette(p));
  if (key === lastKey) return lastVars;

  const r = resolvePalette(p);
  const vars: Record<string, string> = {
    '--t-surface': r.surface,
    '--t-accent': r.accent,
    '--t-accent2': r.accent2,
    '--t-accent-text': r.accentText,
    '--t-accent2-text': r.accent2Text,
    '--t-on-accent': r.onAccent,
    '--t-on-accent2': r.onAccent2,
    '--t-deep': r.deep,
    '--t-bg': r.bg,
    '--t-fg': r.fg,
    // Kode lama memakai text-white / bg-black sebagai "tinta" dan "kertas".
    '--color-white': r.text,
    '--color-black': r.bg,
  };

  const neutral = neutralScale(r);
  for (const n of NEUTRALS) for (const s of STEPS) vars[`--color-${n}-${s}`] = neutral[s];

  for (const name of Object.keys(HUES)) {
    const scale = statusScale(name, r);
    for (const s of STEPS) vars[`--color-${name}-${s}`] = scale[s];
  }

  lastKey = key;
  lastVars = vars;
  return vars;
}

function setMetaThemeColor(color: string) {
  try {
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', color);
  } catch { /* abaikan */ }
}

export function applyPalette(p: Palette) {
  const root = document.documentElement;
  const vars = paletteVars(p);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const r = resolvePalette(p);
  root.dataset.mode = r.tone;
  setMetaThemeColor(r.surface);
}

// ── Audit kontras (untuk pemeriksa di pengaturan & tes) ─────────────────────
export interface ContrastRow {
  id: string;
  label: string;
  ratio: number;
  min: number;
  ok: boolean;
}

/** Kontras dari pilihan ASLI pengguna (sebelum disesuaikan), supaya pengguna tahu mana yang bermasalah. */
export function auditPalette(p: Palette): ContrastRow[] {
  const r = resolvePalette({ ...p, bg: p.bg, text: p.text });
  const rawText = isHex(p.text) ? p.text : r.text;
  const row = (id: string, label: string, a: string, b: string, min: number): ContrastRow => {
    const ratio = contrastRatio(a, b);
    return { id, label, ratio, min, ok: ratio >= min };
  };
  const rows: ContrastRow[] = [];
  if (r.custom) {
    rows.push(row('text-bg', 'Teks di atas latar', rawText, r.bg, TEXT_MIN));
    rows.push(row('text-surface', 'Teks di atas panel', rawText, r.surface, TEXT_MIN));
  }
  rows.push(row('accent', 'Aksen Audio di atas panel', p.accent, r.surface, ACCENT_MIN));
  rows.push(row('accent2', 'Aksen Kuis di atas panel', p.accent2, r.surface, ACCENT_MIN));
  rows.push(row('on-accent', 'Teks di tombol Aksen Audio', r.onAccent, r.accent, TEXT_MIN));
  rows.push(row('on-accent2', 'Teks di tombol Aksen Kuis', r.onAccent2, r.accent2, TEXT_MIN));
  return rows;
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
/** Pasang tema tersimpan; kalau belum ada (tamu / pengunjung baru), pasang tema bawaan supaya semua token tersedia. */
export function applyCachedPalette() {
  let p: unknown = null;
  try { p = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); } catch { /* abaikan */ }
  applyPalette(isPalette(p) ? p : BUILTIN_THEME.palette);
}
