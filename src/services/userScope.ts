// src/services/userScope.ts
// Satu-satunya tempat yang menentukan "milik siapa" data localStorage.
// Semua data per-akun (kuis kustom, hasil main, pembelian, hak akses) harus
// memakai scopedKey() supaya akun lain di perangkat yang sama tidak melihatnya.
const SESSION_KEY = 'muzeck_user_session_v1';
export const USER_SCOPE_EVENT = 'muzeck-user-scope-changed';

export function currentScope(): string {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const s = raw ? JSON.parse(raw) : null;
    return s && s.isLoggedIn && s.email ? String(s.email).trim().toLowerCase() : '__guest__';
  } catch {
    return '__guest__';
  }
}

export const scopedKey = (base: string) => `${base}::${currentScope()}`;

/** Panggil setelah login / logout agar hook & komponen membaca ulang data akun baru. */
export function notifyUserScopeChanged() {
  window.dispatchEvent(new Event(USER_SCOPE_EVENT));
}

/** Hapus semua varian ber-scope dari sebuah kunci dasar. */
export function removeAllScopedVariants(bases: string[]) {
  const doomed: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && bases.some((b) => k.startsWith(`${b}::`))) doomed.push(k);
  }
  doomed.forEach((k) => localStorage.removeItem(k));
}
