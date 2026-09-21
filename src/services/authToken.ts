// src/services/authToken.ts
// Token sesi pengguna yang diterbitkan server saat login/daftar. Semua request
// ke /api/user/*, /api/users dan /api/payment/charge otomatis membawa token ini
// (lewat installAuthFetch), sehingga server bisa memastikan "email" di request
// benar-benar milik akun yang sedang login.
const TOKEN_KEY = 'muzeck_user_token_v1';
export const AUTH_EXPIRED_EVENT = 'muzeck-auth-expired';

export const getUserToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setUserToken = (token: string) => {
  try { localStorage.setItem(TOKEN_KEY, token); } catch {}
};
export const clearUserToken = () => {
  try { localStorage.removeItem(TOKEN_KEY); } catch {}
};

const PROTECTED = /^\/api\/(user\/|users(\?|$)|payment\/charge)/;
let installed = false;

/** Memasang pembungkus window.fetch (sekali saja). */
export function installAuthFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = rawUrl.replace(/^https?:\/\/[^/]+/, '');
    if (!PROTECTED.test(path)) return original(input, init);

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const token = getUserToken();
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    const res = await original(input, { ...init, headers });
    if (res.status === 401) window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    return res;
  };
}
