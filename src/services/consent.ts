// src/services/consent.ts
// Penyimpan pilihan persetujuan cookie/penyimpanan lokal (sesuai GDPR/ePrivacy & UU PDP).
// Kategori:
//   necessary : selalu aktif (login, keranjang, keamanan, pengaturan yang kamu pilih sendiri). Tidak butuh persetujuan.
//   analytics : OPSIONAL, default MATI. Hanya aktif bila pengguna menerima secara aktif.
// Pilihan disimpan di localStorage 'muzeck_consent_v1' (catatan pilihan itu sendiri termasuk "penting").
// Halaman statis (/cookie) memakai kunci & format yang sama, jadi pengguna bisa mengubah pilihan dari sana.

export const CONSENT_KEY = 'muzeck_consent_v1';
/** Naikkan angka ini bila jenis pemakaian data berubah: banner akan muncul lagi untuk semua pengguna. */
export const CONSENT_VERSION = 1;
export const ANALYTICS_SESSION_KEY = 'muzeck_analytics_session_v1';
export const OPEN_SETTINGS_EVENT = 'muzeck:open-consent';
const CHANGE_EVENT = 'muzeck:consent-changed';

export interface ConsentState {
  v: number;
  analytics: boolean;
  ts: string; // ISO waktu pilihan dibuat (bukti persetujuan)
}

export function getConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || j.v !== CONSENT_VERSION || typeof j.analytics !== 'boolean') return null;
    return j as ConsentState;
  } catch {
    return null;
  }
}

/** Sinyal Global Privacy Control dari peramban: dianggap penolakan analitik. */
export function browserSaysNoTracking(): boolean {
  try {
    return (navigator as any).globalPrivacyControl === true || navigator.doNotTrack === '1';
  } catch {
    return false;
  }
}

export function hasConsent(category: 'analytics'): boolean {
  if (browserSaysNoTracking()) return false;
  const c = getConsent();
  return !!c && c[category] === true;
}

export function setConsent(analytics: boolean): ConsentState {
  const state: ConsentState = { v: CONSENT_VERSION, analytics, ts: new Date().toISOString() };
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(state)); } catch {}
  // Persetujuan ditarik -> hapus pengenal analitik yang sudah ada.
  if (!analytics) {
    try { localStorage.removeItem(ANALYTICS_SESSION_KEY); } catch {}
  }
  try { window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: state })); } catch {}
  return state;
}

export function onConsentChange(cb: (s: ConsentState | null) => void): () => void {
  const h = () => cb(getConsent());
  window.addEventListener(CHANGE_EVENT, h);
  window.addEventListener('storage', h); // sinkron antar tab
  return () => { window.removeEventListener(CHANGE_EVENT, h); window.removeEventListener('storage', h); };
}

/** Dipanggil dari tautan footer "Pengaturan Cookie". */
export function openConsentSettings(): void {
  try { window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT)); } catch {}
}
