// src/admin/AdminApp.tsx
import React, { useEffect, useMemo, useState } from 'react';
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
  adminFetch,
  clearAdminToken,
  elevateToAdminViaSession,
  getAdminMe,
  getAdminToken,
  loginAdminWithGoogle,
  setAdminToken,
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
import { applyCachedPalette } from '../theme/theme';

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
  // Admin berada di halaman terpisah dari situs utama: pasang palette tema terakhir (cache) supaya
  // variabel --t-* terisi sebelum komponen admin dirender.
  useEffect(() => {
    applyCachedPalette();
  }, []);

  const [token, setToken] = useState(getAdminToken());
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [me, setMe] = useState<AdminMe | null>(null);
  const [page, setPage] = useState<AdminPage>(() => {
    const hash = window.location.hash.replace('#', '') as AdminPage;
    return NAV.some((item) => item.id === hash) ? hash : 'dashboard';
  });

  // Sesi situs utama = cookie httpOnly, tidak bisa dibaca JavaScript. Satu-satunya
  // cara tahu apakah masih berlaku adalah bertanya ke server (/api/auth/me).
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

  // Setiap kali token admin berubah (habis login / logout), tanyakan ke
  // server siapa sebenarnya yang sedang login (email asli + status Super
  // Admin) — dipakai untuk menampilkan menu "Admin & Akses" dengan benar.
  useEffect(() => {
    if (!token) {
      setMe(null);
      return;
    }
    getAdminMe()
      .then(setMe)
      .catch(() => setMe(null));
  }, [token]);

  // "Masuk pakai sesi situs utama": server memverifikasi cookie sesi asli dan
  // mengecek daftar admin, jadi tidak ada email yang bisa dipalsukan dari browser.
  const handleSessionLogin = async () => {
    if (!mainSiteEmail) return;
    setError('');
    try {
      const adminToken = await elevateToAdminViaSession();
      setToken(adminToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Akun ini bukan Administrator terdaftar.');
    }
  };

  // Login dengan Google Sign-In SUNGGUHAN langsung dari halaman /admin
  // (dipakai kalau belum login sama sekali di situs utama). credential adalah
  // ID token asli dari Google yang diverifikasi server sebelum mengecek
  // apakah emailnya terdaftar sebagai admin.
  const handleGoogleCredential = async (credential: string) => {
    setError('');
    try {
      const adminToken = await loginAdminWithGoogle(credential);
      setToken(adminToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login admin dengan akun Google gagal.');
    }
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login gagal');
      setAdminToken(data.token);
      setToken(data.token);
    } catch (err) {
      // PERBAIKAN: fallback kata sandi lokal ('PlayMuzeck-admin') dihapus.
      // Fallback itu membuat token palsu ('dev-admin-token-PlayMuzeck') yang
      // tidak dikenal server, sehingga login "berhasil" di UI tapi semua
      // permintaan data admin tetap gagal (401). Sekarang login hanya sah
      // jika server benar-benar mengeluarkan token.
      setError(err instanceof Error ? err.message : 'Kata sandi admin tidak tepat atau server API belum aktif.');
    }
  };

  const handleLogout = async () => {
    try {
      await adminFetch('/api/admin/logout', { method: 'POST' });
    } catch {}
    clearAdminToken();
    setToken('');
  };

  const current = useMemo(() => NAV.find((item) => item.id === page) || NAV[0], [page]);

  if (!token) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4">
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

          {/* Opsi 1: Sudah login di situs utama -> naikkan sesi itu jadi admin,
              tanpa perlu login Google kedua kalinya. Server yang memverifikasi
              token sesi & mengecek daftar admin. */}
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

          {/* Opsi 2: Login dengan Google Sign-In sungguhan (tanpa perlu login di situs utama dulu) */}
          <div className="space-y-2">
            <GoogleSignInButton onCredential={handleGoogleCredential} onError={setError} text="signin_with" />
          </div>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-white/10 w-full" />
            <span className="bg-surface px-3 text-[11px] text-gray-500 uppercase font-mono">atau kata sandi</span>
          </div>

          {/* Opsi 3: Login Kata Sandi Cadangan */}
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

            {error && <p className="text-xs text-red-400 font-medium">{error}</p>}

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

  // Email & status Super Admin didapat dari server (/api/admin/me), bukan
  // ditebak dari sesi klien — supaya benar-benar mencerminkan siapa yang
  // sedang login (bisa jadi Super Admin, admin yang di-grant, atau lewat
  // kata sandi server yang diperlakukan setara Super Admin).
  const activeAdminEmail = me?.email || (me?.isSuperAdmin ? 'Operator Server (kata sandi)' : 'Admin');

  return (
    <div className="min-h-screen bg-black text-[#E5E5E5] flex">
      <aside className="w-64 shrink-0 bg-surface border-r border-white/10 hidden md:flex flex-col">
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.2em] text-accent font-bold">Developer Console</p>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-accent/20 text-accent border border-accent/30">
              {me?.isSuperAdmin ? 'Super Admin' : 'Admin'}
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