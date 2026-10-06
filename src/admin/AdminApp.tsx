// src/admin/AdminApp.tsx
import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Brain,
  LogOut,
  Music,
  Palette,
  ShoppingBag,
  ShieldCheck,
  LogIn,
  Lock,
  Users,
} from 'lucide-react';
import {
  ADMIN_EXPIRED_EVENT,
  ADMIN_EXPIRED_MSG,
  clearAdminToken,
  elevateToAdminViaSession,
  getAdminMe,
  getAdminToken,
  loginAdminWithGoogle,
  loginAdminWithPassword,
  AdminMe,
} from './adminApi';
import { authApi } from '../services/authToken';
import { storage } from '../services/storage';
import { GoogleSignInButton } from '../components/GoogleSignInButton';
import { DashboardPage } from './pages/DashboardPage';
import { AudioPage } from './pages/AudioPage';
import { ContentPage } from './pages/ContentPage';
import { OpsPage } from './pages/OpsPage';
import { SettingsPage } from './pages/SettingsPage';
import { AdminsPage } from './pages/AdminsPage';
import { applyCachedPalette, applyPalette } from '../theme/theme';
import { ADMIN_PALETTE_EVENT, adminVars, loadAdminPalette } from './adminTheme';

type AdminPage = 'dashboard' | 'audio' | 'content' | 'ops' | 'settings' | 'admins';

const NAV: Array<{ id: AdminPage; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'dashboard', label: 'Analitik', icon: BarChart3 },
  { id: 'audio', label: 'Katalog Audio', icon: Music },
  { id: 'content', label: 'Topik & Deck', icon: Brain },
  { id: 'ops', label: 'Pesanan & User', icon: ShoppingBag },
  { id: 'settings', label: 'Tema & Pengaturan', icon: Palette },
  { id: 'admins', label: 'Admin & Akses', icon: Users },
];

export default function AdminApp() {
  // Palette konsol admin: punya cache sendiri (pm_admin_palette), TIDAK ikut tema pengguna
  // (pm_palette). Berubah langsung saat admin menekan "Pakai di konsol admin".
  const [palette, setPalette] = useState(loadAdminPalette);
  useEffect(() => {
    const sync = () => setPalette(loadAdminPalette());
    window.addEventListener(ADMIN_PALETTE_EVENT, sync);
    return () => window.removeEventListener(ADMIN_PALETTE_EVENT, sync);
  }, []);
  const ADMIN_VARS = useMemo(() => adminVars(palette), [palette]);

  useLayoutEffect(() => {
    applyPalette(palette);
  }, [palette]);
  // Saat keluar dari admin, tema pengguna dipulihkan dari cache.
  useLayoutEffect(() => () => applyCachedPalette(), []);

  const [token, setToken] = useState(getAdminToken());
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [me, setMe] = useState<AdminMe | null>(null);
  const [page, setPage] = useState<AdminPage>(() => {
    const hash = window.location.hash.replace('#', '') as AdminPage;
    return NAV.some((item) => item.id === hash) ? hash : 'dashboard';
  });

  // Sesi situs utama = cookie httpOnly; satu-satunya cara tahu masih berlaku adalah tanya server.
  const clientSession = storage.getUserSession();
  const [mainSiteEmail, setMainSiteEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!clientSession?.isLoggedIn) return;
    let cancelled = false;
    authApi.me().then((r) => {
      if (!cancelled && r.ok && r.data?.user?.email) setMainSiteEmail(r.data.user.email);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onHash = () => {
      const hash = window.location.hash.replace('#', '') as AdminPage;
      if (NAV.some((item) => item.id === hash)) setPage(hash);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Server menolak token admin (kedaluwarsa, server restart pada versi lama, atau akses dicabut):
  // kembali ke layar login dengan pesan yang jelas, bukan panel kosong yang tampak "login".
  useEffect(() => {
    const onExpired = () => {
      setToken('');
      setMe(null);
      setError(ADMIN_EXPIRED_MSG);
    };
    window.addEventListener(ADMIN_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(ADMIN_EXPIRED_EVENT, onExpired);
  }, []);

  const [meLoading, setMeLoading] = useState(false);
  useEffect(() => {
    if (!token) {
      setMe(null);
      setMeLoading(false);
      return;
    }
    let cancelled = false;
    setMeLoading(true);
    getAdminMe()
      .then((m) => {
        if (!cancelled) setMe(m);
      })
      .catch(() => {
        if (!cancelled) setMe(null);
      })
      .finally(() => {
        if (!cancelled) setMeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleSessionLogin = async () => {
    if (!mainSiteEmail) return;
    setError('');
    try {
      const adminToken = await elevateToAdminViaSession();
      setError('');
      setToken(adminToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Akun ini bukan Administrator terdaftar.');
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setError('');
    try {
      const adminToken = await loginAdminWithGoogle(credential);
      setError('');
      setToken(adminToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login admin dengan akun Google gagal.');
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const adminToken = await loginAdminWithPassword(password);
      setPassword('');
      setError('');
      setToken(adminToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kata sandi admin tidak tepat atau server API belum aktif.');
    }
  };

  const handleLogout = async () => {
    // Pakai fetch biasa (bukan adminFetch) supaya 401 saat logout tidak memicu pesan "sesi berakhir".
    try {
      const t = getAdminToken();
      if (t) await fetch('/api/admin/logout', { method: 'POST', headers: { Authorization: `Bearer ${t}` } });
    } catch {}
    clearAdminToken();
    setMe(null);
    setError('');
    setToken('');
  };

  const current = useMemo(() => NAV.find((item) => item.id === page) || NAV[0], [page]);

  if (!token) {
    return (
      <div style={ADMIN_VARS} data-mode="dark" className="min-h-screen bg-black text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-surface border border-white/15 p-8 shadow-2xl space-y-6">
          <div className="text-center space-y-1.5">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/15 text-accent text-xs font-black border border-accent/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Developer Console</span>
            </div>
            <h1 className="text-2xl font-black mt-1">
              PlayMuzeck<span className="text-accent">.</span> Admin
            </h1>
            <p className="text-xs text-gray-400">
              Portal manajemen katalog audio, database kuis, analitik, dan pengaturan tema.
            </p>
          </div>

          {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

          {mainSiteEmail && (
            <div className="p-4 rounded-2xl bg-accent/10 border border-accent/40 space-y-2.5">
              <div className="flex items-center gap-2 text-xs font-bold text-accent">
                <ShieldCheck className="w-4 h-4" />
                <span>Sesi situs utama terdeteksi</span>
              </div>
              <p className="text-xs text-white font-mono">{mainSiteEmail}</p>
              <button
                type="button"
                onClick={handleSessionLogin}
                className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent/80 text-on-accent font-black text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-accent/20 active:scale-95 transition-all"
              >
                <LogIn className="w-4 h-4" />
                <span>Masuk sebagai Admin dengan Akun Ini</span>
              </button>
              <p className="text-[10px] text-gray-400">
                Hanya berhasil jika email ini terdaftar sebagai admin. Server yang memutuskan, bukan tombol ini.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <GoogleSignInButton onCredential={handleGoogleCredential} onError={setError} text="signin_with" />
          </div>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-white/10 w-full" />
            <span className="bg-surface px-3 text-[11px] text-gray-500 uppercase font-mono">atau kata sandi</span>
          </div>

          <form onSubmit={handlePasswordLogin} className="space-y-3">
            <label className="block text-xs font-semibold text-gray-300">
              Kata Sandi Admin Server
              <div className="relative mt-1">
                <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-xl bg-black/50 border border-white/10 pl-9 pr-3 py-2 text-xs text-white outline-none focus:border-accent"
                  placeholder="ADMIN_PASSWORD"
                />
              </div>
            </label>

            <button
              type="submit"
              className="w-full rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold py-2 text-xs transition-colors cursor-pointer border border-white/10"
            >
              Masuk dengan Sandi
            </button>
          </form>

          <div className="text-center pt-1 border-t border-white/5">
            <a href="/" className="text-xs text-gray-400 hover:text-white transition-colors">
              ← Kembali ke Situs Klien
            </a>
          </div>
        </div>
      </div>
    );
  }

  const activeAdminEmail = me?.email || (me?.isSuperAdmin ? 'Operator Server (kata sandi)' : meLoading ? 'Memuat…' : 'Admin');

  return (
    <div style={ADMIN_VARS} data-mode="dark" className="min-h-screen bg-black text-[#E5E5E5] flex">
      <aside className="w-64 shrink-0 bg-surface border-r border-white/10 hidden md:flex flex-col">
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.2em] text-accent font-bold">Developer Console</p>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30">
              {me?.isSuperAdmin ? 'Super Admin' : meLoading ? '…' : 'Admin'}
            </span>
          </div>
          <h1 className="text-xl font-extrabold text-white mt-1">
            PlayMuzeck<span className="text-accent">.</span>
          </h1>
          <p className="text-[11px] text-gray-400 font-mono truncate mt-0.5" title={activeAdminEmail}>
            {activeAdminEmail}
          </p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = item.id === page;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setPage(item.id);
                  window.location.hash = item.id;
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                  active ? 'bg-accent text-on-accent font-bold shadow' : 'text-gray-300 hover:bg-black/30'
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-white/10 space-y-2">
          <a href="/" className="block text-xs text-gray-400 hover:text-white px-3 py-2 transition-colors">
            ← Kembali ke situs klien
          </a>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" /> Keluar dari Admin
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-black/90 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <current.icon className="w-4 h-4 text-accent" />
            <h2 className="font-bold text-white">{current.label}</h2>
          </div>
          <button
            onClick={handleLogout}
            title="Keluar dari Admin"
            className="md:hidden ml-auto p-1.5 rounded-lg text-red-300 hover:bg-red-500/10 cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
          <select
            className="md:hidden bg-surface border border-white/10 rounded-lg px-2 py-1 text-sm text-white"
            value={page}
            onChange={(e) => {
              const next = e.target.value as AdminPage;
              setPage(next);
              window.location.hash = next;
            }}
          >
            {NAV.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </header>
        <main className="flex-1 p-4 sm:p-6 overflow-auto">
          {page === 'dashboard' && <DashboardPage />}
          {page === 'audio' && <AudioPage />}
          {page === 'content' && <ContentPage />}
          {page === 'ops' && <OpsPage />}
          {page === 'settings' && <SettingsPage />}
          {page === 'admins' && <AdminsPage isSuperAdmin={Boolean(me?.isSuperAdmin)} currentEmail={me?.email} />}
        </main>
      </div>
    </div>
  );
}
