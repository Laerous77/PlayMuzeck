import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, Trash2, UserPlus, Loader2, RefreshCw } from 'lucide-react';
import { AdminAccount, AdminSessionError, grantAdmin, listAdmins, revokeAdmin } from '../adminApi';

interface AdminsPageProps {
  isSuperAdmin: boolean;
  currentEmail?: string | null;
}

// Harus sama dengan SUPER_ADMIN_EMAIL di server/db.ts.
const SUPER_ADMIN_EMAIL = 'frfrareu@gmail.com';

// Halaman ini dulu TIDAK ADA SAMA SEKALI — daftar admin hanya berupa
// hardcode/env yang tidak bisa diubah tanpa deploy ulang. Sekarang daftar
// admin tersimpan di database (tabel admin_emails) dan bisa dikelola dari
// sini. Menambah/mencabut admin HANYA berhasil kalau pemanggilnya Super
// Admin (frfrareu@gmail.com) atau login lewat kata sandi server — server
// yang menegakkan ini lewat requireSuperAdmin, bukan sekadar UI.
export const AdminsPage: React.FC<AdminsPageProps> = ({ isSuperAdmin, currentEmail }) => {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setAdmins(await listAdmins());
      setLoadFailed(false);
      setError('');
    } catch (err) {
      // Sesi habis ditangani global (kembali ke layar login); jangan tampilkan galat ganda.
      if (err instanceof AdminSessionError) return;
      setLoadFailed(true);
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar admin.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Super Admin SELALU tampil di paling atas, walau server belum sempat menyimpannya di tabel
  // atau daftar gagal dimuat — dia memang tidak bergantung pada tabel itu.
  const rows = useMemo<AdminAccount[]>(() => {
    const others = admins.filter((a) => a.email.toLowerCase() !== SUPER_ADMIN_EMAIL);
    const fromServer = admins.find((a) => a.email.toLowerCase() === SUPER_ADMIN_EMAIL);
    const superRow: AdminAccount = fromServer
      ? { ...fromServer, isSuperAdmin: true }
      : { email: SUPER_ADMIN_EMAIL, grantedBy: 'system', createdAt: '', isSuperAdmin: true };
    return [superRow, ...others];
  }, [admins]);

  const me = (currentEmail || '').toLowerCase();

  const handleGrant = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setStatus('');
    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Alamat email tidak valid.');
      return;
    }
    setIsSubmitting(true);
    try {
      await grantAdmin(email);
      setNewEmail('');
      setStatus(`${email} sekarang punya akses admin.`);
      await load();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Gagal memberi akses admin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (email: string) => {
    if (!confirm(`Cabut akses admin dari ${email}?`)) return;
    setError('');
    setStatus('');
    setRevoking(email);
    try {
      await revokeAdmin(email);
      setStatus(`Akses admin ${email} dicabut.`);
      await load();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setError(err instanceof Error ? err.message : 'Gagal mencabut akses admin.');
    } finally {
      setRevoking(null);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <section className="rounded-2xl bg-surface border border-white/10 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <h3 className="font-bold text-white">Siapa saja yang bisa masuk sebagai admin</h3>
        </div>
        <p className="text-xs text-gray-400">
          Super Admin (<span className="font-mono text-gray-300">{SUPER_ADMIN_EMAIL}</span>) selalu punya akses dan
          tidak bisa dicabut.
          {isSuperAdmin
            ? ' Sebagai Super Admin, kamu bisa menambah atau mencabut admin lain di bawah ini.'
            : ' Hanya Super Admin yang bisa mengubah daftar ini — kamu bisa melihatnya, tapi tidak mengeditnya.'}
        </p>

        {error && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-red-400 font-medium">{error}</p>
            {loadFailed && (
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="shrink-0 flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1 rounded-lg border border-white/10 disabled:opacity-60"
              >
                <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Coba lagi
              </button>
            )}
          </div>
        )}
        {status && <p className="text-xs text-emerald-400 font-medium">{status}</p>}

        <div className="rounded-xl border border-white/10 overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead className="text-gray-400 text-left bg-black/30">
              <tr>
                <th className="p-3">Email</th>
                <th>Diberi oleh</th>
                <th className="w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.email} className="border-t border-white/5">
                  <td className="p-3 font-mono text-white">
                    {a.email}
                    {a.email.toLowerCase() === me && <span className="ml-2 text-[10px] text-accent">(kamu)</span>}
                  </td>
                  <td className="text-gray-400 text-xs">
                    {a.isSuperAdmin ? (
                      <span className="px-1.5 py-0.5 rounded bg-accent/20 text-accent font-bold text-[10px]">
                        SUPER ADMIN
                      </span>
                    ) : (
                      a.grantedBy || '—'
                    )}
                  </td>
                  <td className="text-right pr-3">
                    {isSuperAdmin && !a.isSuperAdmin && (
                      <button
                        onClick={() => handleRevoke(a.email)}
                        disabled={revoking === a.email}
                        className="p-1.5 rounded-lg text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                        title="Cabut akses admin"
                      >
                        {revoking === a.email ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={3} className="p-3 text-gray-500 text-center text-xs">
                    Memuat daftar admin lain...
                  </td>
                </tr>
              )}
              {!loading && !loadFailed && rows.length === 1 && (
                <tr>
                  <td colSpan={3} className="p-3 text-gray-500 text-center text-xs">
                    Belum ada admin lain. Tambahkan lewat form di bawah.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {isSuperAdmin && (
          <form onSubmit={handleGrant} className="flex gap-2 pt-1">
            <input
              type="email"
              required
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="email@contoh.com"
              className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-accent"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60"
            >
              {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              <span>Beri akses admin</span>
            </button>
          </form>
        )}
      </section>

      <p className="text-xs text-gray-500">
        Orang yang diberi akses bisa masuk lewat "Masuk dengan Google" atau "Masuk sebagai Admin dengan Akun Ini" di
        halaman login admin — asalkan email Google mereka sama dengan yang terdaftar di sini.
      </p>
    </div>
  );
};
