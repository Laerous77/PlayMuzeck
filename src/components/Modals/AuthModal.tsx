import React, { useEffect, useState, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  X,
  User,
  Lock,
  Mail,
  LogOut,
  CheckCircle2,
  ArrowRight,
  Loader2,
  KeyRound,
  ShieldCheck,
  Eye,
  EyeOff,
  Check,
} from 'lucide-react';
import { UserSession } from '../../types';
import { authApi } from '../../services/authToken';
import { GoogleSignInButton } from '../GoogleSignInButton';
import { TurnstileWidget, turnstileSiteKey } from '../TurnstileWidget';

type AuthMode = 'signin' | 'signup' | 'forgot' | 'reset';

export function announceAccountDeletion(user: any) {
  const d = user?.deletion;
  if (!d?.scheduledAt) return;
  const at = new Date(d.scheduledAt);
  const ms = Math.max(0, at.getTime() - Date.now());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  const left = days > 0 ? `${days} hari ${hours} jam` : hours > 0 ? `${hours} jam ${mins} menit` : `${Math.max(1, mins)} menit`;
  const when = at.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' });
  window.dispatchEvent(new CustomEvent('muzeck:account-deletion', { detail: d }));
  alert(
    `⚠️ AKUNMU AKAN DIHAPUS PERMANEN\n\n` +
      `Sisa waktu: ${left}\nDihapus pada: ${when} WIB\n` +
      `${d.requestedBy === 'self' ? 'Kamu sendiri yang meminta penghapusan ini.' : 'Penghapusan ini dijadwalkan oleh admin.'}\n\n` +
      `Akunmu masih bisa dipakai sampai waktu itu. Untuk membatalkan, buka Profil lalu tekan "Batalkan Penghapusan Akun". ` +
      `Kalau tidak dibatalkan, akun, koleksi, dan kuis buatanmu akan hilang selamanya.`
  );
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  userSession: UserSession;
  onLogin: (email: string, name: string) => void;
  onLogout: () => void;
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
  const [needsVerify, setNeedsVerify] = useState(false);
  const [signupDone, setSignupDone] = useState(false);
  const [cfToken, setCfToken] = useState('');
  const [cfReset, setCfReset] = useState(0);
  const captchaOn = Boolean(turnstileSiteKey());

  // State untuk melihat/menyembunyikan kata sandi (View / Hide password)
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (initialResetToken) {
      setAuthMode('reset');
      setErrorMsg('');
      setInfoMsg('');
    }
  }, [initialResetToken]);

  // Validasi Kriteria Keamanan Kata Sandi
  const passwordCriteria = useMemo(() => {
    return {
      hasMinLength: password.length >= 8,
      hasUpperCase: /[A-Z]/.test(password),
      hasNumber: /[0-9]/.test(password),
      hasSymbol: /[^A-Za-z0-9]/.test(password),
    };
  }, [password]);

  const isPasswordStrong =
    passwordCriteria.hasMinLength &&
    passwordCriteria.hasUpperCase &&
    passwordCriteria.hasNumber &&
    passwordCriteria.hasSymbol;

  if (!isOpen) return null;

  const switchMode = (mode: AuthMode) => {
    setAuthMode(mode);
    setErrorMsg('');
    setInfoMsg('');
    setNeedsVerify(false);
    setSignupDone(false);
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const handleGoogleCredential = async (credential: string) => {
    setErrorMsg('');
    setInfoMsg('');
    setIsSubmitting(true);
    try {
      const r = await authApi.google(credential);
      if (!r.ok || !r.data?.user?.email) {
        setErrorMsg(r.data?.message || 'Login dengan Google gagal. Coba lagi.');
        return;
      }
      onLogin(r.data.user.email, r.data.user.name || r.data.user.email.split('@')[0]);
      onClose();
      announceAccountDeletion(r.data.user);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    if (!email.includes('@')) {
      setErrorMsg('Isi alamat email dulu.');
      return;
    }
    setIsSubmitting(true);
    const r = await authApi.resendVerification(email.trim());
    setIsSubmitting(false);
    if (r.ok) {
      setErrorMsg('');
      setInfoMsg(r.data?.message || 'Link verifikasi baru sudah dikirim. Cek inbox/spam.');
    } else {
      setErrorMsg(r.data?.message || 'Gagal mengirim ulang. Coba lagi beberapa saat lagi.');
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
    if (captchaOn && !cfToken) {
      setErrorMsg('Selesaikan verifikasi "saya bukan robot" dulu.');
      return;
    }
    setIsSubmitting(true);
    try {
      const r = await authApi.forgotPassword(email.trim(), cfToken || undefined);
      setCfReset((n) => n + 1);
      if (!r.ok) {
        setErrorMsg(r.data?.message || 'Gagal memproses permintaan reset kata sandi.');
        return;
      }
      setInfoMsg(r.data?.message || 'Jika email tersebut terdaftar, tautan reset kata sandi sudah dikirim. Periksa inbox dan folder spam.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    if (!initialResetToken) {
      setErrorMsg('Tautan reset tidak valid. Minta tautan baru lewat "Lupa kata sandi".');
      return;
    }
    if (!isPasswordStrong) {
      setErrorMsg('Kata sandi harus minimal 8 karakter, mengandung huruf kapital, angka, dan simbol unik.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Konfirmasi kata sandi tidak cocok.');
      return;
    }
    setIsSubmitting(true);
    try {
      const r = await authApi.resetPassword(initialResetToken, password);
      if (!r.ok) {
        setErrorMsg(r.data?.message || 'Gagal mengatur ulang kata sandi.');
        return;
      }
      setPassword('');
      setConfirmPassword('');
      setAuthMode('signin');
      setInfoMsg('Kata sandi berhasil diganti. Silakan masuk dengan kata sandi baru.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setInfoMsg('');
    setNeedsVerify(false);

    if (!email || !email.includes('@')) {
      setErrorMsg('Masukkan alamat surel (email) yang valid.');
      return;
    }

    if (authMode === 'signup') {
      if (name.trim().length < 2) {
        setErrorMsg('Isi nama panggilan (minimal 2 karakter).');
        return;
      }
      if (!isPasswordStrong) {
        setErrorMsg('Kata sandi harus minimal 8 karakter, ada huruf kapital, angka, dan simbol.');
        return;
      }
    } else {
      if (!password) {
        setErrorMsg('Kata sandi wajib diisi.');
        return;
      }
    }

    if (authMode === 'signup' && captchaOn && !cfToken) {
      setErrorMsg('Selesaikan verifikasi "saya bukan robot" dulu.');
      return;
    }
    setIsSubmitting(true);
    try {
      if (authMode === 'signup') {
        const r = await authApi.signup(name.trim(), email.trim(), password, cfToken || undefined);
        setCfReset((n) => n + 1);
        if (!r.ok) {
          if (r.data?.error === 'EMAIL_NOT_VERIFIED') setNeedsVerify(true);
          setErrorMsg(r.data?.message || 'Gagal mendaftar. Coba lagi.');
          return;
        }
        setPassword('');
        setSignupDone(true);
        setInfoMsg(r.data?.message || 'Kami sudah mengirim link verifikasi ke email kamu. Cek inbox/spam.');
        return;
      }

      const r = await authApi.login(email.trim(), password);
      if (!r.ok) {
        if (r.status === 403 && r.data?.error === 'EMAIL_NOT_VERIFIED') setNeedsVerify(true);
        setErrorMsg(r.data?.message || 'Email atau password salah.');
        return;
      }
      if (!r.data?.user?.email) {
        setErrorMsg('Login berhasil, tetapi data akun tidak diterima. Muat ulang halaman lalu coba lagi.');
        return;
      }
      onLogin(r.data.user.email, r.data.user.name || r.data.user.email.split('@')[0]);
      setPassword('');
      onClose();
      announceAccountDeletion(r.data.user);
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
        className="w-full max-w-md rounded-2xl bg-surface border border-white/[0.1] shadow-2xl overflow-hidden my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/[0.08] bg-black/40">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-accent text-on-accent flex items-center justify-center font-bold text-sm">
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
        <div className="p-4 sm:p-6">
          {userSession.isLoggedIn ? (
            /* Logged In State */
            <div className="space-y-6 text-center">
              <div className="w-16 h-16 rounded-full bg-accent text-on-accent text-2xl font-black mx-auto flex items-center justify-center shadow-lg">
                {(userSession.name || userSession.email || 'M').charAt(0).toUpperCase()}
              </div>

              <div className="space-y-1">
                <div className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2.5 py-0.5 rounded-full border border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3" /> Akun Terhubung
                </div>
                <h4 className="text-lg font-bold text-white">{userSession.name || userSession.email}</h4>
                <p className="text-xs text-gray-400 font-mono">{userSession.email}</p>
              </div>

              <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] text-left text-xs text-gray-300 space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-400">Status Keanggotaan:</span>
                  <span className="text-accent font-bold">PlayMuzeck Explorer</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Penyimpanan Sesi:</span>
                  <span className="text-white font-mono">Cookie Aman (Server)</span>
                </div>
              </div>

              <button
                id="btn-logout"
                onClick={() => {
                  onLogout();
                  onClose();
                }}
                className="w-full py-2.5 rounded-xl bg-red-900/30 hover:bg-red-900/50 text-red-200 border border-red-900 text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <LogOut className="w-4 h-4" />
                <span>Keluar dari Akun</span>
              </button>
            </div>
          ) : authMode === 'forgot' ? (
            /* Lupa Kata Sandi */
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <KeyRound className="w-4 h-4 text-accent" />
                <h4 className="text-sm font-bold">Lupa kata sandi?</h4>
              </div>
              <p className="text-xs text-gray-400">
                Masukkan email akun Anda. Kami akan mengirim tautan untuk mengatur ulang kata sandi (berlaku 30 menit).
              </p>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-900/20 border border-red-900 text-red-200 text-xs">{errorMsg}</div>
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
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-accent rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                  </div>
                </div>
                <TurnstileWidget onToken={setCfToken} resetKey={cfReset} />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-on-accent font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
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
                onClick={() => switchMode('signin')}
                className="w-full text-center text-[11px] text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                ← Kembali ke halaman masuk
              </button>
            </div>
          ) : authMode === 'reset' ? (
            /* Atur Ulang Kata Sandi */
            <div className="space-y-5">
              <div className="flex items-center gap-2 text-white">
                <ShieldCheck className="w-4 h-4 text-accent" />
                <h4 className="text-sm font-bold">Atur ulang kata sandi</h4>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-900/20 border border-red-900 text-red-200 text-xs">{errorMsg}</div>
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
                      type={showPassword ? 'text' : 'password'}
                      required
                      autoComplete="new-password"
                      placeholder="Masukkan kata sandi baru"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-accent rounded-xl pl-9 pr-10 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                      title={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Indikator Standar Keamanan Kata Sandi */}
                {password.length > 0 && (
                  <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1.5 text-[11px]">
                    <span className="font-bold text-gray-400 block text-[10px] uppercase tracking-wider mb-1">
                      Kriteria Keamanan Sandi:
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <span className={`flex items-center gap-1.5 ${passwordCriteria.hasMinLength ? 'text-emerald-400' : 'text-gray-500'}`}>
                        <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasMinLength ? 'text-emerald-400' : 'text-gray-600'}`} />
                        Minimal 8 karakter
                      </span>
                      <span className={`flex items-center gap-1.5 ${passwordCriteria.hasUpperCase ? 'text-emerald-400' : 'text-gray-500'}`}>
                        <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasUpperCase ? 'text-emerald-400' : 'text-gray-600'}`} />
                        Huruf kapital (A-Z)
                      </span>
                      <span className={`flex items-center gap-1.5 ${passwordCriteria.hasNumber ? 'text-emerald-400' : 'text-gray-500'}`}>
                        <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasNumber ? 'text-emerald-400' : 'text-gray-600'}`} />
                        Angka (0-9)
                      </span>
                      <span className={`flex items-center gap-1.5 ${passwordCriteria.hasSymbol ? 'text-emerald-400' : 'text-gray-500'}`}>
                        <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasSymbol ? 'text-emerald-400' : 'text-gray-600'}`} />
                        Simbol unik (!@#$ dll)
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Ulangi Kata Sandi Baru</label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      placeholder="Ketik ulang kata sandi baru"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-accent rounded-xl pl-9 pr-10 py-2 text-xs text-white placeholder-gray-500 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-2.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                      title={showConfirmPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                    >
                      {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting || !isPasswordStrong || password !== confirmPassword}
                  className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-on-accent font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
              <div className="grid grid-cols-2 p-1 bg-black/60 rounded-xl border border-white/[0.08]">
                <button
                  type="button"
                  onClick={() => switchMode('signin')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    authMode === 'signin'
                      ? 'bg-accent text-on-accent shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Masuk
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('signup')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    authMode === 'signup'
                      ? 'bg-accent text-on-accent shadow-sm'
                      : 'text-gray-400 hover:text-white'
                  }`}
                >
                  Daftar
                </button>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-900/20 border border-red-900 text-red-200 text-xs space-y-2">
                  <p>{errorMsg}</p>
                  {needsVerify && (
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={isSubmitting}
                      className="font-bold text-accent hover:underline disabled:opacity-60 cursor-pointer"
                    >
                      Kirim ulang link verifikasi
                    </button>
                  )}
                </div>
              )}
              {infoMsg && !signupDone && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{infoMsg}</span>
                </div>
              )}

              {signupDone ? (
                <div className="space-y-4 text-center py-2">
                  <div className="w-14 h-14 rounded-full bg-accent/15 border border-accent/30 text-accent mx-auto flex items-center justify-center">
                    <Mail className="w-6 h-6" />
                  </div>
                  <h4 className="text-base font-bold text-white">Cek email kamu</h4>
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {infoMsg || 'Kami sudah mengirim link verifikasi.'}
                    <br />
                    Akun baru aktif setelah link di email diklik. Link berlaku 24 jam.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleResendVerification}
                      disabled={isSubmitting}
                      className="w-full py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition-all disabled:opacity-60 cursor-pointer"
                    >
                      {isSubmitting ? 'Mengirim...' : 'Kirim ulang link verifikasi'}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode('signin')}
                      className="text-[11px] text-gray-400 hover:text-white transition-colors cursor-pointer"
                    >
                      Sudah verifikasi? Masuk di sini
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <GoogleSignInButton onCredential={handleGoogleCredential} onError={setErrorMsg} text="continue_with" />

                  <div className="relative flex items-center justify-center">
                    <div className="border-t border-white/10 w-full" />
                    <span className="bg-surface px-3 text-[11px] text-gray-500 uppercase font-mono">atau pakai email</span>
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
                            className="w-full bg-black/60 border border-white/[0.08] focus:border-accent rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
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
                          className="w-full bg-black/60 border border-white/[0.08] focus:border-accent rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-gray-300">Kata Sandi</label>
                        {authMode === 'signin' && (
                          <button
                            type="button"
                            onClick={() => switchMode('forgot')}
                            className="text-[11px] text-accent hover:underline cursor-pointer"
                          >
                            Lupa kata sandi?
                          </button>
                        )}
                      </div>
                      <div className="relative">
                        <Lock className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                          placeholder={authMode === 'signup' ? 'Minimal 8 karakter' : '••••••••'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="w-full bg-black/60 border border-white/[0.08] focus:border-accent rounded-xl pl-9 pr-10 py-2 text-xs text-white placeholder-gray-500 outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3 top-2.5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                          title={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Standar Keamanan Kata Sandi saat Daftar */}
                    {authMode === 'signup' && password.length > 0 && (
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5 space-y-1 text-[11px]">
                        <span className="font-bold text-gray-400 block text-[10px] uppercase tracking-wider mb-1">
                          Standar Keamanan Sandi:
                        </span>
                        <div className="grid grid-cols-2 gap-1">
                          <span className={`flex items-center gap-1 ${passwordCriteria.hasMinLength ? 'text-emerald-400' : 'text-gray-500'}`}>
                            <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasMinLength ? 'text-emerald-400' : 'text-gray-600'}`} />
                            Min. 8 karakter
                          </span>
                          <span className={`flex items-center gap-1 ${passwordCriteria.hasUpperCase ? 'text-emerald-400' : 'text-gray-500'}`}>
                            <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasUpperCase ? 'text-emerald-400' : 'text-gray-600'}`} />
                            Huruf kapital (A-Z)
                          </span>
                          <span className={`flex items-center gap-1 ${passwordCriteria.hasNumber ? 'text-emerald-400' : 'text-gray-500'}`}>
                            <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasNumber ? 'text-emerald-400' : 'text-gray-600'}`} />
                            Angka (0-9)
                          </span>
                          <span className={`flex items-center gap-1 ${passwordCriteria.hasSymbol ? 'text-emerald-400' : 'text-gray-500'}`}>
                            <Check className={`w-3.5 h-3.5 ${passwordCriteria.hasSymbol ? 'text-emerald-400' : 'text-gray-600'}`} />
                            Simbol unik (!@#$)
                          </span>
                        </div>
                      </div>
                    )}

                    {authMode === 'signup' && <TurnstileWidget onToken={setCfToken} resetKey={cfReset} />}

                    <button
                      type="submit"
                      id="btn-submit-auth"
                      disabled={isSubmitting || (authMode === 'signup' && !isPasswordStrong)}
                      className="w-full py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-on-accent font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
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
                </>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
