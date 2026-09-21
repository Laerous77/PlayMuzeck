import React, { useEffect, useState } from 'react';
import { ShieldCheck, Trash2, UserPlus, Loader2 } from 'lucide-react';
import { AdminAccount, grantAdmin, listAdmins, revokeAdmin } from '../adminApi';

interface AdminsPageProps {
  isSuperAdmin: boolean;
  currentEmail?: string | null;
}

// Halaman ini dulu TIDAK ADA SAMA SEKALI — daftar admin hanya berupa
// hardcode/env yang tidak bisa diubah tanpa deploy ulang. Sekarang daftar
// admin tersimpan di database (tabel admin_emails) dan bisa dikelola dari
// sini. Menambah/mencabut admin HANYA berhasil kalau pemanggilnya Super
// Admin (frfrareu@gmail.com) atau login lewat kata sandi server — server
// yang menegakkan ini lewat requireSuperAdmin, bukan sekadar UI.
export const AdminsPage: React.FC<AdminsPageProps> = ({ isSuperAdmin, currentEmail }) => {
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [newEmail, setNewEmail] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const load = async () => {
    try {
      setAdmins(await listAdmins());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar admin.');
    }
  };

  useEffect(() => {
    load();
  }, []);

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
      setError(err instanceof Error ? err.message : 'Gagal memberi akses admin.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (email: string) => {
    if (!confirm(`Cabut akses admin dari ${email}?`)) return;
    setError('');
    setStatus('');
    try {
      await revokeAdmin(email);
      setStatus(`Akses admin ${email} dicabut.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mencabut akses admin.');
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#FCA311]" />
          <h3 className="font-bold text-white">Siapa saja yang bisa masuk sebagai admin</h3>
        </div>
        <p className="text-xs text-gray-400">
          Super Admin (<span className="font-mono text-gray-300">frfrareu@gmail.com</span>) selalu punya akses dan
          tidak bisa dicabut.
          {isSuperAdmin
            ? ' Sebagai Super Admin, kamu bisa menambah atau mencabut admin lain di bawah ini.'
            : ' Hanya Super Admin yang bisa mengubah daftar ini — kamu bisa melihatnya, tapi tidak mengeditnya.'}
        </p>

        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}
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
              {admins.map((a) => (
                <tr key={a.email} className="border-t border-white/5">
                  <td className="p-3 font-mono text-white">
                    {a.email}
                    {a.email === currentEmail && <span className="ml-2 text-[10px] text-[#FCA311]">(kamu)</span>}
                  </td>
                  <td className="text-gray-400 text-xs">
                    {a.isSuperAdmin ? (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-[#FCA311] font-bold text-[10px]">
                        SUPER ADMIN
                      </span>
                    ) : (
                      a.grantedBy
                    )}
                  </td>
                  <td className="text-right pr-3">
                    {isSuperAdmin && !a.isSuperAdmin && (
                      <button
                        onClick={() => handleRevoke(a.email)}
                        className="p-1.5 rounded-lg text-red-300 hover:bg-red-500/10"
                        title="Cabut akses admin"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {admins.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-3 text-gray-500 text-center text-xs">
                    Memuat...
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
              className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-[#FCA311]"
            />
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-60"
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
