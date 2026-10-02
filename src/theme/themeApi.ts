// src/theme/themeApi.ts
// Klien API tema untuk PENGGUNA. (Admin memakai adminFetch di AdminThemeManager.)
import { Palette, ThemeRecord } from './theme';

export interface MyThemeState {
  activeId: number | null;       // null = tema bawaan
  active: ThemeRecord | null;    // detail tema aktif (bisa tema admin kalau di-assign admin)
  mine: ThemeRecord[];           // tema milik sendiri (maks 2)
  locked: boolean;               // true = dikunci admin
  maxMine: number;
}

let getToken: () => string | null | undefined = () => null;
/** Dipanggil ThemeProvider. Isi dengan cara app lo mengambil token login. */
export const setThemeTokenGetter = (fn: () => string | null | undefined) => { getToken = fn; };

async function userFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Permintaan gagal (${res.status})`);
  return body as T;
}

export const fetchMyTheme = () => userFetch<MyThemeState>('/api/me/theme');

export const setActiveTheme = (themeId: number | null) =>
  userFetch<MyThemeState>('/api/me/theme/active', { method: 'PUT', body: JSON.stringify({ themeId }) });

export const createMyTheme = (name: string, palette: Palette) =>
  userFetch<MyThemeState>('/api/me/themes', { method: 'POST', body: JSON.stringify({ name, palette }) });

export const updateMyTheme = (id: number, name: string, palette: Palette) =>
  userFetch<MyThemeState>(`/api/me/themes/${id}`, { method: 'PUT', body: JSON.stringify({ name, palette }) });

export const deleteMyTheme = (id: number) =>
  userFetch<MyThemeState>(`/api/me/themes/${id}`, { method: 'DELETE' });
