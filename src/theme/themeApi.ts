// src/theme/themeApi.ts
// Klien API tema untuk PENGGUNA. (Admin memakai adminFetch di AdminThemeManager.)
//
// Jika endpoint /api/me/theme* belum ada di server (404/405/5xx gateway, jaringan putus,
// atau server membalas HTML), klien otomatis beralih ke penyimpanan lokal (localStorage per akun).
// Pengguna tidak melihat error; tema tetap bisa dibuat, dipakai, dihapus, dan direset.
// Server selalu dicoba lagi pada panggilan berikutnya (tidak ada mode lokal permanen).
import { LIMITS, NAME_MAX, Palette, ThemeRecord, isPalette } from './theme';

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

let userKey = 'anon';
/** Dipanggil ThemeProvider: memisahkan tema lokal per akun. */
export const setThemeUserKey = (k?: string) => { userKey = k || 'anon'; };

// ── Mode server / lokal ──────────────────────────────────────────────────────
// PERBAIKAN: dulu begitu SATU request gagal (server restart, 404 sebelum router dipasang, jaringan putus),
// mode "lokal" disimpan di sessionStorage dan klien TIDAK PERNAH bertanya ke server lagi selama tab terbuka —
// akibatnya tema yang diterapkan admin tidak pernah sampai ke pengguna. Sekarang server selalu dicoba lagi
// di setiap panggilan (termasuk sinkron 30 detik). Lokal hanya cadangan sementara.
const LEGACY_MODE_KEY = 'pm_theme_api_mode';
try { sessionStorage.removeItem(LEGACY_MODE_KEY); } catch { /* abaikan */ }

let localOnly = false;   // true = panggilan terakhir memakai penyimpanan browser
let serverSeen = false;  // true = server tema pernah menjawab di halaman ini
/** true = tema sedang disimpan di browser ini, bukan di server. */
export const isLocalMode = () => localOnly;

class Unavailable extends Error {}

const looksLikeState = (b: any): b is MyThemeState =>
  !!b && typeof b === 'object' && Array.isArray(b.mine) && 'activeId' in b;

async function userFetch<T extends MyThemeState>(url: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init.headers || {}),
      },
    });
  } catch {
    throw new Unavailable('network');
  }

  const isJson = (res.headers.get('content-type') || '').includes('json');
  if ([404, 405, 501, 502, 503, 504].includes(res.status)) throw new Unavailable(String(res.status));
  if (res.ok && !isJson) throw new Unavailable('non-json'); // mis. SPA membalas index.html

  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `Permintaan gagal (${res.status})`);
  if (!looksLikeState(body)) throw new Unavailable('bad-shape');
  return body as T;
}

// ── Penyimpanan lokal (cadangan) ─────────────────────────────────────────────
interface Stored { activeId: number | null; mine: ThemeRecord[]; nextId: number }
const storeKey = () => `pm_themes_v1:${userKey}`;

function readStore(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey()) || 'null');
    if (raw && Array.isArray(raw.mine) && typeof raw.nextId === 'number') {
      const mine = (raw.mine as ThemeRecord[]).filter((t) => t && typeof t.id === 'number' && isPalette(t.palette));
      const activeId = mine.some((t) => t.id === raw.activeId) ? raw.activeId : null;
      return { activeId, mine, nextId: raw.nextId };
    }
  } catch { /* data rusak → mulai kosong */ }
  return { activeId: null, mine: [], nextId: 1 };
}

function writeStore(s: Stored) {
  try { localStorage.setItem(storeKey(), JSON.stringify(s)); }
  catch { throw new Error('Penyimpanan browser penuh atau diblokir. Izinkan penyimpanan situs lalu coba lagi.'); }
}

function toState(s: Stored): MyThemeState {
  const active = s.mine.find((t) => t.id === s.activeId) ?? null;
  return { activeId: active ? active.id : null, active, mine: s.mine, locked: false, maxMine: LIMITS.user };
}

function checkInput(name: string, palette: Palette): string {
  const n = (name || '').trim();
  if (!n) throw new Error('Nama tema wajib diisi.');
  if (n.length > NAME_MAX) throw new Error(`Nama tema maksimal ${NAME_MAX} karakter.`);
  if (!isPalette(palette)) throw new Error('Warna tidak valid. Gunakan format hex 6 digit, mis. #FCA311.');
  return n;
}

const local = {
  get: () => toState(readStore()),

  setActive(themeId: number | null) {
    const s = readStore();
    if (themeId != null && !s.mine.some((t) => t.id === themeId)) throw new Error('Tema tidak ditemukan.');
    s.activeId = themeId;
    writeStore(s);
    return toState(s);
  },

  create(name: string, palette: Palette) {
    const n = checkInput(name, palette);
    const s = readStore();
    if (s.mine.length >= LIMITS.user) throw new Error(`Slot tema penuh (maksimal ${LIMITS.user}). Hapus salah satu dulu.`);
    const rec: ThemeRecord = { id: s.nextId++, name: n, scope: 'user', palette };
    s.mine.push(rec);
    s.activeId = rec.id;
    writeStore(s);
    return toState(s);
  },

  update(id: number, name: string, palette: Palette) {
    const n = checkInput(name, palette);
    const s = readStore();
    const i = s.mine.findIndex((t) => t.id === id);
    if (i < 0) throw new Error('Tema tidak ditemukan.');
    s.mine[i] = { ...s.mine[i], name: n, palette };
    s.activeId = id;
    writeStore(s);
    return toState(s);
  },

  remove(id: number) {
    const s = readStore();
    s.mine = s.mine.filter((t) => t.id !== id);
    if (s.activeId === id) s.activeId = null;
    writeStore(s);
    return toState(s);
  },
};

/** Coba server dulu. Lokal hanya dipakai kalau server belum pernah menjawab di halaman ini. */
async function call(remote: () => Promise<MyThemeState>, fallback: () => MyThemeState): Promise<MyThemeState> {
  try {
    const s = await remote();
    serverSeen = true;
    localOnly = false;
    return s;
  } catch (e) {
    if (!(e instanceof Unavailable)) throw e;
    // Server pernah menjawab → gangguan sementara: JANGAN ganti ke data lokal (bisa menimpa tema dari server).
    if (serverSeen) throw new Error('Server tema sedang tidak bisa dihubungi. Coba lagi sebentar lagi.');
    localOnly = true;
  }
  return fallback();
}

// ── API publik (tanda tangan tidak berubah) ──────────────────────────────────
export const fetchMyTheme = () =>
  call(() => userFetch<MyThemeState>('/api/me/theme'), local.get);

export const setActiveTheme = (themeId: number | null) =>
  call(
    () => userFetch<MyThemeState>('/api/me/theme/active', { method: 'PUT', body: JSON.stringify({ themeId }) }),
    () => local.setActive(themeId),
  );

export const createMyTheme = (name: string, palette: Palette) =>
  call(
    () => userFetch<MyThemeState>('/api/me/themes', { method: 'POST', body: JSON.stringify({ name, palette }) }),
    () => local.create(name, palette),
  );

export const updateMyTheme = (id: number, name: string, palette: Palette) =>
  call(
    () => userFetch<MyThemeState>(`/api/me/themes/${id}`, { method: 'PUT', body: JSON.stringify({ name, palette }) }),
    () => local.update(id, name, palette),
  );

export const deleteMyTheme = (id: number) =>
  call(() => userFetch<MyThemeState>(`/api/me/themes/${id}`, { method: 'DELETE' }), () => local.remove(id));
