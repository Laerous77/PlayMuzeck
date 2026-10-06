// src/admin/adminApi.ts
// Helper API khusus panel admin + fetch publik.
// Token admin disimpan di sessionStorage (hilang saat tab ditutup) dan dikirim sebagai Bearer.

const ADMIN_TOKEN_KEY = 'muzeck_admin_token_v1';

export interface AdminMe {
  email: string | null;
  isSuperAdmin: boolean;
}

export interface AdminAccount {
  email: string;
  grantedBy: string | null;
  createdAt: string;
  isSuperAdmin: boolean;
}

/* ---------------- Token admin ---------------- */

export function getAdminToken(): string {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {}
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {}
}

/* ---------------- Fetch ---------------- */

async function readError(res: Response, prefix: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  return new Error(body?.error || body?.message || `${prefix} HTTP ${res.status}: ${res.statusText}`);
}

export async function publicFetch<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const res = await fetch(endpoint, init);
  if (!res.ok) throw await readError(res, 'Public');
  return res.json() as Promise<T>;
}

export async function adminFetch<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const token = getAdminToken();
  const res = await fetch(endpoint, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) throw await readError(res, 'Admin');
  return res.json() as Promise<T>;
}

/* ---------------- Login admin ---------------- */

/** Tukar sesi (cookie httpOnly) pengguna yang sedang login menjadi token admin. */
export async function elevateToAdminViaSession(): Promise<string> {
  const res = await fetch('/api/admin/session-login', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw await readError(res, 'Admin');
  const data = await res.json();
  setAdminToken(data.token);
  return data.token as string;
}

/** Login admin memakai credential Google (Google Identity Services). */
export async function loginAdminWithGoogle(credential: string): Promise<string> {
  const res = await fetch('/api/admin/google-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw await readError(res, 'Admin');
  const data = await res.json();
  setAdminToken(data.token);
  return data.token as string;
}

export const getAdminMe = () => adminFetch<AdminMe>('/api/admin/me');

/* ---------------- Kelola daftar admin ---------------- */

export const listAdmins = () => adminFetch<AdminAccount[]>('/api/admin/admins');

export const grantAdmin = (email: string) =>
  adminFetch<{ success: boolean }>('/api/admin/admins', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });

export const revokeAdmin = (email: string) =>
  adminFetch<{ success: boolean }>(`/api/admin/admins/${encodeURIComponent(email)}`, {
    method: 'DELETE',
  });
