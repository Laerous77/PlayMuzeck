// src/theme/ThemeContext.tsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  BUILTIN_THEME, LIMITS, Palette, ThemeRecord,
  applyPalette, cachePalette, clearCachedPalette,
} from './theme';
import * as api from './themeApi';

const EMPTY: api.MyThemeState = { activeId: null, active: null, mine: [], locked: false, maxMine: LIMITS.user };

interface ThemeCtx {
  palette: Palette;                 // palette yang sedang berlaku
  loaded: boolean;                  // sudah sinkron dengan server
  activeId: number | null;
  mine: ThemeRecord[];
  assigned: ThemeRecord | null;     // tema dari admin yang sedang dipakai (kalau ada)
  locked: boolean;
  maxMine: number;
  activate: (id: number | null) => Promise<void>;
  /** Simpan tema (baru kalau tanpa id) lalu langsung dipakai. Mengembalikan id tema aktif. */
  save: (input: { id?: number; name: string; palette: Palette }) => Promise<number | null>;
  remove: (id: number) => Promise<void>;
  /** Kembali ke tema bawaan. Tema tersimpan tidak dihapus. */
  reset: () => Promise<void>;
  /** Pratinjau sementara tanpa menyimpan. null = batalkan pratinjau. */
  preview: (p: Palette | null) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);

export const useTheme = () => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme harus dipakai di dalam <ThemeProvider>.');
  return v;
};

interface Props {
  isLoggedIn: boolean;
  /** Identitas akun (mis. email). Berubah = tema diambil ulang untuk akun baru. */
  userKey?: string;
  /** Opsional: kalau auth lo pakai header Authorization. Untuk sesi cookie httpOnly tidak perlu. */
  getToken?: () => string | null | undefined;
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<Props> = ({ isLoggedIn, userKey, getToken, children }) => {
  const [data, setData] = useState<api.MyThemeState>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const wasLoggedIn = useRef(isLoggedIn);

  const effective = useMemo<Palette>(() => data.active?.palette ?? BUILTIN_THEME.palette, [data.active]);
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;

  // Login → ambil tema tersimpan dari server (inilah yang bikin tema "ikut" akun).
  useEffect(() => {
    if (!isLoggedIn) return;
    wasLoggedIn.current = true;
    setData(EMPTY);
    setLoaded(false);
    api.setThemeUserKey(userKey);
    if (getToken) api.setThemeTokenGetter(getToken);
    let cancelled = false;
    api.fetchMyTheme()
      .then((s) => { if (!cancelled) { setData(s); setLoaded(true); } })
      .catch(() => { /* offline: tetap pakai cache sampai berhasil */ });
    return () => { cancelled = true; };
  }, [isLoggedIn, userKey, getToken]);

  // Sinkron ulang diam-diam: kalau admin menerapkan/mengunci/mereset tema, pengguna yang
  // sedang membuka situs ikut berubah saat tab kembali aktif atau tiap 30 detik.
  useEffect(() => {
    if (!isLoggedIn || !loaded) return;
    let stop = false;
    const sync = () => {
      if (stop || document.visibilityState === 'hidden') return;
      api.fetchMyTheme()
        .then((s) => {
          if (stop) return;
          setData((prev) => (JSON.stringify(prev) === JSON.stringify(s) ? prev : s));
        })
        .catch(() => { /* abaikan, coba lagi nanti */ });
    };
    const timer = window.setInterval(sync, 30000);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    return () => {
      stop = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
    };
  }, [isLoggedIn, loaded]);

  // Logout → balik ke bawaan & buang cache supaya akun lain di browser yang sama tidak ketularan.
  useEffect(() => {
    if (isLoggedIn || !wasLoggedIn.current) return;
    wasLoggedIn.current = false;
    setData(EMPTY);
    setLoaded(false);
    clearCachedPalette();
    applyPalette(BUILTIN_THEME.palette);
  }, [isLoggedIn]);

  // Terapkan hanya setelah server menjawab; sebelum itu biarkan cache dari main.tsx.
  useEffect(() => {
    if (!loaded) return;
    applyPalette(effective);
    cachePalette(effective);
  }, [loaded, effective]);

  const run = useCallback(async (p: Promise<api.MyThemeState>) => {
    const s = await p;
    setData(s);
    setLoaded(true);
    return s;
  }, []);

  const preview = useCallback((p: Palette | null) => {
    if (!p && !loadedRef.current) return;
    applyPalette(p ?? effectiveRef.current);
  }, []);

  const value: ThemeCtx = {
    palette: effective,
    loaded,
    activeId: data.activeId,
    mine: data.mine,
    assigned: data.active && data.active.scope === 'admin' ? data.active : null,
    locked: data.locked,
    maxMine: data.maxMine,
    activate: async (id) => { await run(api.setActiveTheme(id)); },
    save: async ({ id, name, palette }) => {
      const s = await run(id ? api.updateMyTheme(id, name, palette) : api.createMyTheme(name, palette));
      return s.activeId;
    },
    remove: async (id) => { await run(api.deleteMyTheme(id)); },
    reset: async () => { await run(api.setActiveTheme(null)); },
    preview,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
