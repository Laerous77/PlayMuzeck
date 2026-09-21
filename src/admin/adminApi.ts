// src/admin/adminApi.ts
export const ADMIN_TOKEN_KEY = 'muzeck_admin_token';

// PERBAIKAN: sebelumnya fungsi ini "menebak" token admin sendiri di browser
// (`admin-google-<email>`) hanya berdasarkan isUserAdmin(email) di klien.
// Server tidak pernah menerbitkan atau mengenal token itu, jadi requireAdmin
// di server SELALU menolaknya (401) dan seluruh halaman admin gagal memuat
// data dari database. Sekarang getAdminToken() murni membaca token asli yang
// sebelumnya disimpan lewat setAdminToken() setelah login berhasil ke server
// (baik lewat /api/admin/login maupun /api/admin/google-login).
export function getAdminToken(): string {
  return localStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

/**
 * Login admin lewat Google Sign-In SUNGGUHAN. `credential` adalah ID token
 * (JWT) asli dari Google Identity Services — server yang memverifikasinya ke
 * Google dan mengecek daftar admin, bukan klien yang mengaku-aku emailnya.
 */
export async function loginAdminWithGoogle(credential: string): Promise<string> {
  const res = await fetch('/api/admin/google-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Login admin dengan akun Google gagal.');
  }
  setAdminToken(data.token);
  return data.token as string;
}

/**
 * Menaikkan sesi login SITUS UTAMA (token dari services/authToken, hasil
 * login email/password, Google, atau demo) menjadi sesi admin, tanpa perlu
 * login Google kedua kalinya. Server memverifikasi tanda tangan token sesi
 * itu sendiri sebelum mengecek daftar admin, jadi email tidak bisa dipalsukan.
 */
export async function elevateToAdminViaSession(userSessionToken: string): Promise<string> {
  const res = await fetch('/api/admin/session-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userSessionToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Akun ini bukan Administrator terdaftar.');
  }
  setAdminToken(data.token);
  return data.token as string;
}

export interface AdminAccount {
  email: string;
  grantedBy: string;
  createdAt: string;
  isSuperAdmin: boolean;
}

export interface AdminMe {
  email: string | null;
  isSuperAdmin: boolean;
}

/** Info admin yang sedang login (email & apakah dia Super Admin). */
export const getAdminMe = () => adminFetch<AdminMe>('/api/admin/me');

/** Daftar semua email yang punya akses admin (bisa dilihat semua admin). */
export const listAdmins = () => adminFetch<AdminAccount[]>('/api/admin/admins');

/** Beri akses admin ke email baru — hanya berhasil jika pemanggil Super Admin. */
export const grantAdmin = (email: string) =>
  adminFetch('/api/admin/admins', { method: 'POST', body: JSON.stringify({ email }) });

/** Cabut akses admin dari sebuah email — hanya berhasil jika pemanggil Super Admin. */
export const revokeAdmin = (email: string) =>
  adminFetch(`/api/admin/admins/${encodeURIComponent(email)}`, { method: 'DELETE' });

/**
 * Fetch untuk endpoint publik (tanpa token admin), dipakai misalnya oleh cms.ts
 * untuk memuat katalog audio, topik, deck, dan pengaturan situs yang memang
 * boleh diakses semua pengunjung tanpa login.
 */
export async function publicFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    let errMsg = `Permintaan ke server gagal (${res.status})`;
    try {
      const errData = await res.json();
      errMsg = errData.error || errData.message || errMsg;
    } catch {
      try {
        const text = await res.text();
        if (text) errMsg = text;
      } catch {}
    }
    throw new Error(errMsg);
  }

  return res.json();
}

export async function adminFetch<T = any>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const headers = new Headers(options.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    clearAdminToken();
    throw new Error('Sesi admin tidak valid atau telah berakhir. Silakan login kembali.');
  }

  if (!res.ok) {
    let errMsg = `Permintaan ke server gagal (${res.status})`;
    try {
      const errData = await res.json();
      errMsg = errData.error || errData.message || errMsg;
    } catch {
      try {
        const text = await res.text();
        if (text) errMsg = text;
      } catch {}
    }
    throw new Error(errMsg);
  }

  return res.json();
}