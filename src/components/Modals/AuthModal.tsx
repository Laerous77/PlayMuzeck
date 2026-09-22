import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { X, User, Lock, Mail, LogOut, CheckCircle2, Sparkles, ArrowRight, Loader2, KeyRound, ShieldCheck } from 'lucide-react';
import { UserSession } from '../../types';
import { setUserToken } from '../../services/authToken';
import { GoogleSignInButton } from '../GoogleSignInButton';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  userSession: UserSession;
  onLogin: (email: string, name: string) => void;
  onLogout: () => void;
  /** Kalau diisi, modal langsung dibuka di form "atur ulang kata sandi" (dipakai saat pengguna klik tautan reset dari email, lihat App.tsx). */
  initialResetToken?: string;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  userSession,
  onLogin,
  onLogout,
  initialResetToken,
}) => {
  const [authMode, setAuthMode] = useState<AuthMode>(initialResetToken ? 'reset' : 'signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Kalau App.tsx mendeteksi ?resetToken=... di URL setelah modal sudah pernah
  // dibuat, pastikan kita tetap pindah ke mode reset begitu propnya berubah.
  useEffect(() => {
    if (initialResetToken) {
      setAuthMode('reset');
      setErrorMsg('');
      setInfoMsg('');
    }
  }, [initialResetToken]);

  if (!isOpen) return null;

  const handleGoogleCredential = async (credential: string) => {
    setErrorMsg('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/google', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Login dengan Google gagal.');
        return;
      }
      if (data.token) setUserToken(data.token);
      onLogin(data.email, data.name);
      onClose();
    } catch {
      setErrorMsg('Gagal terhubung ke server untuk login Google.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (!email || !email.includes('@')) {
      setErrorMsg('Masukkan alamat surel (email) yang valid.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Gagal memproses permintaan reset kata sandi.');
        return;
      }
      setInfoMsg('Jika email tersebut terdaftar, tautan reset kata sandi sudah dikirim. Periksa kotak masuk (dan folder spam) Anda.');
    } catch {
      setErrorMsg('Gagal terhubung ke server. Periksa koneksi Anda dan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (password.length < 4) {
      setErrorMsg('Kata sandi minimal 4 karakter.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: initialResetToken, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Gagal mengatur ulang kata sandi.');
        return;
      }
      if (data.token) setUserToken(data.token);
      onLogin(data.email, data.email.split('@')[0]);
      setInfoMsg('Kata sandi berhasil diperbarui. Anda sudah masuk.');
      setTimeout(() => onClose(), 1200);
    } catch {
      setErrorMsg('Gagal terhubung ke server. Periksa koneksi Anda dan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // PERBAIKAN: sebelumnya login "simulasi" ini hanya mengecek format email &
  // panjang kata sandi di sisi klien lalu langsung meloloskan SIAPAPUN tanpa
  // pernah dicek ke database — akibatnya kata sandi apapun dianggap benar
  // untuk email manapun. Sekarang kita benar-benar memanggil endpoint
  // /api/auth/login (mode Masuk) atau /api/auth/register (mode Daftar), yang
  // memverifikasi/menyimpan kata sandi ter-hash (bcrypt) di PostgreSQL.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email || !email.includes('@')) {
      setErrorMsg('Masukkan alamat surel (email) yang valid.');
      return;
    }
    if (password.length < 4) {
      setErrorMsg('Kata sandi minimal 4 karakter.');
      return;
    }

    setIsSubmitting(true);
    try {
      const endpoint = authMode === 'signin' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name: name.trim() || undefined }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data?.error || 'Terjadi kesalahan saat memproses akun Anda.');
        return;
      }

      if (data.token) setUserToken(data.token); // token sesi dari server, dipakai semua request /api/user/*
      onLogin(data.email || email, data.name || name.trim() || email.split('@')[0]);
      onClose();
    } catch (err) {
      setErrorMsg('Gagal terhubung ke server. Periksa koneksi Anda dan coba lagi.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickDemo = async (demoEmail: string, demoName: string) => {
    setErrorMsg('');
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: demoEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data?.error || 'Gagal masuk dengan akun demo.');
        return;
      }
      if (data.token) setUserToken(data.token);
      onLogin(data.email || demoEmail, data.name || demoName);
      onClose();
    } catch (err) {
      setErrorMsg('Gagal terhubung ke server untuk akun demo.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      id="auth-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md rounded-2xl bg-[#14213D] border border-white/[0.1] shadow-2xl overflow-hidden my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/[0.08] bg-black/40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#FCA311] text-black flex items-center justify-center font-bold text-sm">
              M
            </div>
            <h3 className="text-base font-bold text-white">
              {userSession.isLoggedIn
                ? 'Profil Akun PlayMuzeck'
                : authMode === 'forgot'
                ? 'Lupa Kata Sandi'
                : authMode === 'reset'
                ? 'Atur Ulang Kata Sandi'
                : 'Akun Pengguna PlayMuzeck'}
            </h3>
          </div>

          <button
            id="btn-close-auth"
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {userSession.isLoggedIn ? (
            /* Logged In State */
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 rounded-full bg-[#FCA311] text-black text-2xl font-black mx-auto flex items-center justify-center shadow-lg">
                {userSession.name.charAt(0).toUpperCase()}
              </div>

              <div className="space-y-1">
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3" /> Akun Terhubung
                </div>
                <h4 className="text-lg font-bold text-white">{userSession.name}</h4>
                <p className="text-xs text-gray-400 font-mono">{userSession.email}</p>
              </div>

              <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] text-left text-xs text-gray-300 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Status Keanggotaan:</span>
                  <span className="text-[#FCA311] font-bold">PlayMuzeck Explorer</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Penyimpanan Sesi:</span>
                  <span className="text-white font-mono">Lokal Peramban</span>
                </div>
              </div>

              <button
                id="btn-logout"
                onClick={() => {
                  onLogout();
                  onClose();
                }}
                className="w-full py-2.5 rounded-xl bg-[#780000]/30 hover:bg-[#780000]/50 text-red-200 border border-[#780000] text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Keluar dari Akun</span>
              </button>
            </div>
          ) : authMode === 'forgot' ? (
            /* Lupa Kata Sandi */
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <KeyRound className="w-4 h-4 text-[#FCA311]" />
                <h4 className="text-sm font-bold">Lupa kata sandi?</h4>
              </div>
              <p className="text-xs text-gray-400">
                Masukkan email akun Anda. Kami akan mengirim tautan untuk mengatur ulang kata sandi (berlaku 30 menit).
              </p>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-[#780000]/20 border border-[#780000] text-red-200 text-xs">{errorMsg}</div>
              )}
              {infoMsg && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{infoMsg}</span>
                </div>
              )}

              <form onSubmit={handleForgotPassword} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Alamat Surel (Email)</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      placeholder="nama@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-xl bg-[#FCA311] hover:bg-[#FCA311]/90 text-black font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Mengirim...</span>
                    </>
                  ) : (
                    <span>Kirim Tautan Reset</span>
                  )}
                </button>
              </form>

              <button
                type="button"
                onClick={() => {
                  setAuthMode('signin');
                  setErrorMsg('');
                  setInfoMsg('');
                }}
                className="w-full text-center text-[11px] text-gray-400 hover:text-white transition-colors"
              >
                ← Kembali ke halaman masuk
              </button>
            </div>
          ) : authMode === 'reset' ? (
            /* Atur Ulang Kata Sandi (dibuka dari tautan di email) */
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <ShieldCheck className="w-4 h-4 text-[#FCA311]" />
                <h4 className="text-sm font-bold">Atur ulang kata sandi</h4>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-[#780000]/20 border border-[#780000] text-red-200 text-xs">{errorMsg}</div>
              )}
              {infoMsg && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{infoMsg}</span>
                </div>
              )}

              <form onSubmit={handleResetPassword} className="space-y-3.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Kata Sandi Baru</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Ulangi Kata Sandi Baru</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-xl bg-[#FCA311] hover:bg-[#FCA311]/90 text-black font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : (
                    <span>Simpan Kata Sandi Baru</span>
                  )}
                </button>
              </form>
            </div>
          ) : (
            /* Login / Register Form */
            <div className="space-y-5">
              {/* Toggle Mode */}
              <div className="grid grid-cols-2 p-1 bg-black/60 rounded-xl border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signin');
                    setErrorMsg('');
                  }}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    authMode === 'signin'
                      ? 'bg-[#FCA311] text-black shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Masuk
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('signup');
                    setErrorMsg('');
                  }}
                  className={`py-2 text-xs font-bold rounded-lg transition-all ${
                    authMode === 'signup'
                      ? 'bg-[#FCA311] text-black shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Daftar
                </button>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-[#780000]/20 border border-[#780000] text-red-200 text-xs">
                  {errorMsg}
                </div>
              )}

              <GoogleSignInButton onCredential={handleGoogleCredential} onError={setErrorMsg} text="continue_with" />

              <div className="relative flex items-center justify-center">
                <div className="border-t border-white/10 w-full" />
                <span className="bg-[#14213D] px-3 text-[11px] text-gray-500 uppercase font-mono">atau pakai email</span>
              </div>

              <form onSubmit={handleSubmit} className="space-y-3.5">
                {authMode === 'signup' && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300">Nama Panggilan</label>
                    <div className="relative">
                      <User className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Contoh: Budi Musisi"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Alamat Surel (Email)</label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      placeholder="nama@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-gray-300">Kata Sandi</label>
                    {authMode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('forgot');
                          setErrorMsg('');
                          setInfoMsg('');
                        }}
                        className="text-[11px] text-[#FCA311] hover:underline"
                      >
                        Lupa kata sandi?
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  id="btn-submit-auth"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-xl bg-[#FCA311] hover:bg-[#FCA311]/90 text-black font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 mt-2 disabled:opacity-60"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Memproses...</span>
                    </>
                  ) : (
                    <>
                      <span>{authMode === 'signin' ? 'Masuk Sekarang' : 'Buat Akun Baru'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
