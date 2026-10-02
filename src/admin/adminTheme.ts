// src/admin/adminTheme.ts
// Tampilan konsol admin. Terpisah dari tema pengguna:
// - cache sendiri ('pm_admin_palette'), tidak menyentuh 'pm_palette' milik situs utama,
// - default slate + teal, tapi admin sekarang BISA menggantinya lewat "Tema & Pengaturan".
import type { CSSProperties } from 'react';
import { Palette, isPalette, paletteVars } from '../theme/theme';

export const ADMIN_PALETTE: Palette = {
  surface: '#0F172A',
  accent: '#2DD4BF',
  accent2: '#818CF8',
};

const KEY = 'pm_admin_palette';
export const ADMIN_PALETTE_EVENT = 'pm-admin-palette-change';

export function loadAdminPalette(): Palette {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (isPalette(p)) return p;
  } catch { /* abaikan */ }
  return ADMIN_PALETTE;
}

/** null = kembali ke tampilan admin bawaan. */
export function saveAdminPalette(p: Palette | null) {
  try {
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
  } catch { /* storage diblokir */ }
  window.dispatchEvent(new Event(ADMIN_PALETTE_EVENT));
}

export const adminVars = (p: Palette) => paletteVars(p) as CSSProperties;
