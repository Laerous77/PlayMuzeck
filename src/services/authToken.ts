// src/services/authApi.ts  — GANTI isi src/services/authToken.ts dengan file ini
// (atau simpan sebagai authToken.ts). Tidak ada lagi token di localStorage:
// sesi dipegang cookie httpOnly yang diatur server, jadi JavaScript (dan XSS) tidak bisa mencurinya.

export const AUTH_EXPIRED_EVENT = 'muzeck-auth-expired';

// Stub supaya import lama di App.tsx tidak error. Tidak melakukan apa-apa lagi.
export const getUserToken = (): string | null => null;
export const setUserToken = (_token: string) => {};
export const clearUserToken = () => {
  try { localStorage.removeItem('muzeck_user_token_v1'); } catch {} // bersihkan sisa token lama
};

let installed = false;
/** Semua request ke /api/ otomatis membawa cookie sesi; 401 -> kabari aplikasi. */
export function installAuthFetch() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = rawUrl.replace(/^https?:\/\/[^/]+/, '');
    if (!path.startsWith('/api/')) return original(input, init);
    const res = await original(input, { ...init, credentials: 'include' });
    // 401 dari /api/auth/* (salah password, belum login) dan /api/admin/* (token admin sendiri
    // kedaluwarsa) bukan berarti sesi pengguna habis, jadi tidak boleh memicu logout.
    if (res.status === 401 && !path.startsWith('/api/auth/') && !path.startsWith('/api/admin/')) {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    }
    return res;
  };
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
  // Profil (dikirim server lewat /api/auth/me); opsional supaya aman bila server belum mengirimnya.
  avatarUrl?: string;
  bio?: string;
  greeting?: string;
  frameId?: string;
  // Jadwal penghapusan akun (null / tidak ada = tidak sedang dijadwalkan).
  deletion?: { scheduledAt: string; requestedBy: 'self' | 'admin' } | null;
}

// Semua respons bisa membawa pesan galat dari server.
interface ApiResult<T = any> { ok: boolean; status: number; data: T & { message?: string } }

async function call<T = any>(url: string, body?: object): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: { message: 'Tidak bisa terhubung ke server.' } as T & { message?: string } };
  }
}

export const authApi = {
  signup: (name: string, email: string, password: string) => call('/api/auth/signup', { name, email, password }),
  verifyEmail: (token: string) => call<{ user: AuthUser }>('/api/auth/verify-email', { token }),
  resendVerification: (email: string) => call('/api/auth/resend-verification', { email }),
  login: (email: string, password: string) => call<{ user: AuthUser }>('/api/auth/login', { email, password }),
  forgotPassword: (email: string) => call('/api/auth/forgot-password', { email }),
  resetPassword: (token: string, password: string) => call('/api/auth/reset-password', { token, password }),
  google: (credential: string) => call<{ user: AuthUser }>('/api/auth/google', { credential }),
  me: () => call<{ user: AuthUser }>('/api/auth/me'),
  logout: () => call('/api/auth/logout', {}),
};

/* ---------------- Tombol Google (Google Identity Services) ----------------
   1. Google Cloud Console -> APIs & Services -> Credentials -> OAuth client ID (Web application).
      Authorized JavaScript origins: https://domainlo.com (+ http://localhost:5173 untuk dev).
   2. Di index.html:  <script src="https://accounts.google.com/gsi/client" async defer></script>
   3. Di komponen login:

      useEffect(() => {
        (window as any).google?.accounts.id.initialize({
          client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
          callback: async ({ credential }: { credential: string }) => {
            const r = await authApi.google(credential);          // kirim credential, BUKAN email/nama
            if (r.ok) handleLoginSuccess(r.data.user);           // user datang dari SERVER
            else showToast('Login Google gagal.');
          },
        });
        (window as any).google?.accounts.id.renderButton(btnRef.current, { theme: 'outline', size: 'large' });
      }, []);

   Halaman yang perlu dibuat (main.tsx tinggal cek window.location.pathname seperti /admin):
     /verify-email?token=...   -> panggil authApi.verifyEmail(token), sukses = langsung login
     /forgot-password          -> form email -> authApi.forgotPassword(email)
     /reset-password?token=... -> form password baru -> authApi.resetPassword(token, password)
   Pastikan server meng-serve index.html untuk path-path itu (SPA fallback).
--------------------------------------------------------------------------- */
</file>
