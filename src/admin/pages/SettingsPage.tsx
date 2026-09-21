import React, { useEffect, useState } from 'react';
import { adminFetch } from '../adminApi';
import { SiteSettings } from '../../services/cms';

const THEMES = [
  { id: 'oxford-amber', label: 'Oxford Amber', accentAudio: '#FCA311', accentQuiz: '#FC1212' },
  { id: 'crimson-night', label: 'Crimson Night', accentAudio: '#E11D48', accentQuiz: '#FB7185' },
  { id: 'emerald-studio', label: 'Emerald Studio', accentAudio: '#34D399', accentQuiz: '#22D3EE' },
  { id: 'violet-arena', label: 'Violet Arena', accentAudio: '#A78BFA', accentQuiz: '#F472B6' },
];

export const SettingsPage: React.FC = () => {
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    adminFetch<SiteSettings>('/api/admin/settings').then(setSettings).catch((err) => setStatus(err.message));
  }, []);

  if (!settings) return <p className="text-gray-400">Memuat pengaturan...</p>;

  const save = async () => {
    const saved = await adminFetch<SiteSettings>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    setSettings(saved);
    setStatus('Tema dan pengaturan situs disimpan. Refresh klien untuk melihat perubahan.');
  };

  const exportDb = async () => {
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
      <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 space-y-3">
        <h3 className="font-bold text-white">Identitas & tema visual</h3>
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {THEMES.map((theme) => (
            <button
              key={theme.id}
              onClick={() =>
                setSettings({
                  ...settings,
                  themeId: theme.id,
                  accentAudio: theme.accentAudio,
                  accentQuiz: theme.accentQuiz,
                })
              }
              className={`rounded-xl border p-3 text-left ${settings.themeId === theme.id ? 'border-[#FCA311]' : 'border-white/10'}`}
            >
              <div className="flex gap-1 mb-2">
                <span className="w-4 h-4 rounded-full" style={{ background: theme.accentAudio }} />
                <span className="w-4 h-4 rounded-full" style={{ background: theme.accentQuiz }} />
              </div>
              <p className="text-xs font-semibold">{theme.label}</p>
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="text-xs text-gray-400">
            Aksen Audio Studio
            <input type="color" className="mt-1 h-10 w-full bg-transparent" value={settings.accentAudio} onChange={(e) => setSettings({ ...settings, accentAudio: e.target.value })} />
          </label>
          <label className="text-xs text-gray-400">
            Aksen Pusat Kuis
            <input type="color" className="mt-1 h-10 w-full bg-transparent" value={settings.accentQuiz} onChange={(e) => setSettings({ ...settings, accentQuiz: e.target.value })} />
          </label>
        </div>
        <button onClick={save} className="rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2">
          Simpan tema
        </button>
      </section>

      <section className="rounded-2xl bg-[#14213D] border border-white/10 p-5 space-y-3">
        <h3 className="font-bold text-white">Database</h3>
        <p className="text-sm text-gray-400">SQLite tersimpan di `data/PlayMuzeck.sqlite`. Audio unggahan ada di `data/uploads`.</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={exportDb} className="rounded-xl border border-white/15 px-4 py-2 text-sm">
            Unduh backup JSON
          </button>
          <button
            onClick={async () => {
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
