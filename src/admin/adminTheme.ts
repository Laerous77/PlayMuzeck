// src/admin/adminTheme.ts
// Tampilan khusus konsol admin. Sengaja TERPISAH dari sistem tema pengguna:
// - tidak membaca/menulis cache 'pm_palette' milik situs utama,
// - tidak tergantung ThemeProvider / akun pengguna,
// - tema yang dibuat/diterapkan lewat "Tema & Pengaturan" hanya untuk pengguna, bukan untuk konsol ini.
import type { CSSProperties } from 'react';
import { Palette, paletteVars } from '../theme/theme';

/** Palette konsol admin (slate + teal) — beda dari Oxford Amber bawaan situs pengguna. */
export const ADMIN_PALETTE: Palette = {
  surface: '#0F172A',
  accent: '#2DD4BF',
  accent2: '#818CF8',
};

/** Variabel --t-* untuk dipasang di style elemen root admin; menimpa apa pun yang diwarisi dari <html>. */
export const ADMIN_VARS = paletteVars(ADMIN_PALETTE) as CSSProperties;
