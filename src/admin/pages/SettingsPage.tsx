import React, { useEffect, useState } from 'react';
import { adminFetch } from '../adminApi';
import { SiteSettings } from '../../services/cms';
import { useAdminRole, READONLY_MSG } from '../useAdminRole';
import { AdminThemeManager } from '../components/AdminThemeManager';

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [status, setStatus] = useState('');
  const { isSuperAdmin } = useAdminRole();

  useEffect(() => {
    adminFetch<SiteSettings>('/api/admin/settings').then(setSettings).catch((err) => setStatus(err.message));
  }, []);

  if (!settings) return <p className="text-gray-400">{status || 'Memuat pengaturan...'}</p>;

  const save = async () => {
    if (!isSuperAdmin) { setStatus(READONLY_MSG); return; }
    const saved = await adminFetch<SiteSettings>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    setSettings(saved);
    setStatus('Identitas situs disimpan. Refresh klien untuk melihat perubahan.');
  };

  const exportDb = async () => {
    if (!isSuperAdmin) { setStatus(READONLY_MSG); return; }
    const data = await adminFetch('/api/admin/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PlayMuzeck-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-3xl">
      {!isSuperAdmin && (
        <p className="text-xs rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 px-3 py-2">
          Mode hanya-baca: identitas situs hanya bisa diubah Super Admin.
        </p>
      )}

      <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 space-y-3">
        <h3 className="font-bold text-white">Identitas situs</h3>
        <label className="text-xs text-gray-400 block">
          Nama situs
          <input className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white" value={settings.siteName} onChange={(e) => setSettings({ ...settings, siteName: e.target.value })} />
        </label>
        <label className="text-xs text-gray-400 block">
          Tagline
          <input className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white" value={settings.tagline} onChange={(e) => setSettings({ ...settings, tagline: e.target.value })} />
        </label>
        <label className="text-xs text-gray-400 block">
          Catatan footer
          <input className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-white" value={settings.footerNote} onChange={(e) => setSettings({ ...settings, footerNote: e.target.value })} />
        </label>
        <button onClick={save} className="rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2">
          Simpan identitas
        </button>
      </section>

      {/* Tema: 1 bawaan + 7 tema admin, plus terapkan/kunci per pengguna */}
      <AdminThemeManager />

      <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 space-y-3">
        <h3 className="font-bold text-white">Database</h3>
        <p className="text-sm text-gray-400">Data tersimpan di PostgreSQL (lihat DB_HOST / DB_NAME di .env). Audio unggahan disimpan di Supabase Storage (bucket audio-products) atau folder uploads/ di server.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportDb} className="rounded-xl border border-white/15 px-4 py-2 text-sm">
            Unduh backup JSON
          </button>
          <button
            onClick={async () => {
              if (!isSuperAdmin) { setStatus(READONLY_MSG); return; }
              if (!confirm('Hapus semua event analitik?')) return;
              await adminFetch('/api/admin/clear-analytics', { method: 'POST' });
              setStatus('Analitik dikosongkan.');
            }}
            className="rounded-xl border border-red-400/40 text-red-300 px-4 py-2 text-sm"
          >
            Reset analitik
          </button>
        </div>
        <p className="text-xs text-gray-500">Kata sandi admin diatur lewat `ADMIN_PASSWORD` di file `.env`.</p>
      </section>
      {status && <p className="text-sm text-amber-200">{status}</p>}
    </div>
  );
};
