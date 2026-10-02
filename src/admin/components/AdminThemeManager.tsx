// src/admin/components/AdminThemeManager.tsx
// Admin: kelola maksimal 7 tema, pakai di konsol admin, + terapkan/kunci tema untuk pengguna tertentu.
import React, { useEffect, useState } from 'react';
import { Lock, Monitor, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { adminFetch } from '../adminApi';
import { PalettePicker } from '../../theme/PalettePicker';
import { BUILTIN_THEME, LIMITS, NAME_MAX, Palette, ThemeRecord, samePalette } from '../../theme/theme';
import { loadAdminPalette, saveAdminPalette } from '../adminTheme';

type Sel = number | 'new' | null;

interface UserThemeState {
  activeId: number | null;
  active: ThemeRecord | null;
  mine: ThemeRecord[];
  locked: boolean;
}

// 404 dari /api/admin/themes artinya router tema belum terpasang di server.
const explain = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : fallback;
  return m.includes('(404)')
    ? 'Endpoint tema belum ada di server (404). Pasang themeRoutes di server/index.ts lalu restart server.'
    : m;
};

const Dots: React.FC<{ p?: Palette }> = ({ p }) => (
  <div className="flex gap-1 mb-2 h-4 items-center">
    {p ? (
      [p.surface, p.accent, p.accent2].map((c, i) => (
        <span key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
      ))
    ) : (
      <Plus className="w-4 h-4 text-gray-500" />
    )}
  </div>
);

export const AdminThemeManager: React.FC = () => {
  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [max, setMax] = useState<number>(LIMITS.admin);
  const [sel, setSel] = useState<Sel>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Palette>(BUILTIN_THEME.palette);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [consolePalette, setConsolePalette] = useState<Palette>(loadAdminPalette);

  // Terapkan ke pengguna
  const [email, setEmail] = useState('');
  const [target, setTarget] = useState<{ email: string; state: UserThemeState } | null>(null);
  const [pick, setPick] = useState('builtin'); // 'builtin' | id tema admin
  const [lock, setLock] = useState(false);
  const [uErr, setUErr] = useState('');
  const [uMsg, setUMsg] = useState('');

  const load = async () => {
    const r = await adminFetch<{ themes: ThemeRecord[]; max: number }>('/api/admin/themes');
    setThemes(r.themes);
    setMax(r.max);
  };

  useEffect(() => {
    load().catch((e) => setErr(explain(e, 'Gagal memuat tema.')));
  }, []);

  const choose = (s: Sel) => {
    setSel(s);
    setErr(''); setMsg('');
    if (s === 'new') { setName(`Tema ${themes.length + 1}`); setDraft(BUILTIN_THEME.palette); }
    else if (typeof s === 'number') {
      const t = themes.find((x) => x.id === s);
      if (t) { setName(t.name); setDraft(t.palette); }
    }
  };

  const submit = async () => {
    setBusy(true); setErr(''); setMsg('');
    try {
      const body = JSON.stringify({ name: name.trim(), palette: draft });
      if (sel === 'new') {
        const r = await adminFetch<{ theme: ThemeRecord }>('/api/admin/themes', { method: 'POST', body });
        setSel(r.theme.id);
      } else if (typeof sel === 'number') {
        await adminFetch(`/api/admin/themes/${sel}`, { method: 'PUT', body });
      }
      await load();
      setMsg('Tema disimpan.');
    } catch (e) {
      setErr(explain(e, 'Gagal menyimpan tema.'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (typeof sel !== 'number') return;
    if (!confirm('Hapus tema ini? Pengguna yang sedang memakainya akan kembali ke tema bawaan.')) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await adminFetch(`/api/admin/themes/${sel}`, { method: 'DELETE' });
      setSel(null);
      await load();
      setMsg('Tema dihapus.');
    } catch (e) {
      setErr(explain(e, 'Gagal menghapus tema.'));
    } finally {
      setBusy(false);
    }
  };

  // ── Konsol admin ────────────────────────────────────────────────────────
  const useForConsole = (p: Palette | null) => {
    saveAdminPalette(p);
    setConsolePalette(loadAdminPalette());
    setErr('');
    setMsg(p ? 'Tampilan konsol admin diganti (hanya di browser ini).' : 'Tampilan konsol admin dikembalikan ke bawaan.');
  };

  // ── Terapkan ke pengguna ────────────────────────────────────────────────
  const syncTarget = (e: string, state: UserThemeState) => {
    setTarget({ email: e, state });
    setPick(state.active?.scope === 'admin' ? String(state.active.id) : 'builtin');
    setLock(state.locked);
  };

  const loadUser = async () => {
    setUErr(''); setUMsg('');
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setUErr('Alamat email tidak valid.'); return; }
    try {
      const state = await adminFetch<UserThemeState>(`/api/admin/users/${encodeURIComponent(e)}/theme`);
      syncTarget(e, state);
    } catch (er) {
      setTarget(null);
      setUErr(explain(er, 'Gagal memuat tema pengguna.'));
    }
  };

  const applyToUser = async (reset = false) => {
    if (!target) return;
    setUErr(''); setUMsg('');
    const themeId = reset || pick === 'builtin' ? null : Number(pick);
    const wantLock = themeId != null && !reset && lock;
    try {
      // Server membalas state TERBARU pengguna; pesan sukses hanya muncul kalau state itu cocok.
      const state = await adminFetch<UserThemeState>(
        `/api/admin/users/${encodeURIComponent(target.email)}/theme`,
        { method: 'PUT', body: JSON.stringify({ themeId, locked: wantLock }) },
      );
      if ((state?.activeId ?? null) !== themeId) throw new Error('Server tidak menyimpan tema ini.');
      if (!!state.locked !== wantLock) throw new Error('Server tidak menyimpan status kunci.');
      syncTarget(target.email, state);
      setUMsg(
        themeId == null
          ? 'Tersimpan: pengguna kembali ke tema bawaan.'
          : `Tersimpan: ${state.active?.name ?? 'tema admin'}${state.locked ? ' (terkunci)' : ''}. Pengguna melihatnya setelah halaman dibuka/di-refresh.`,
      );
    } catch (er) {
      setUErr(explain(er, 'Gagal menerapkan tema.'));
    }
  };

  const slots = Array.from({ length: max }, (_, i) => themes[i]);
  const isFull = themes.length >= max;
  const consoleIsDefault = samePalette(consolePalette, loadAdminPalette()) && !localStorage.getItem('pm_admin_palette');
  const userActiveLabel = target
    ? target.state.active
      ? `${target.state.active.name} (${target.state.active.scope === 'admin' ? 'dari admin' : 'tema buatan user'})`
      : `${BUILTIN_THEME.name} (bawaan)`
    : '';

  return (
    <>
      <section className="rounded-2xl bg-surface border border-white/10 p-5 space-y-4">
        <div>
          <h3 className="font-bold text-white">Tema admin</h3>
          <p className="text-xs text-gray-400">
            1 tema bawaan (tetap) + maksimal {max} tema buatan admin ({themes.length}/{max} terpakai). Tema ini bisa
            diterapkan ke pengguna di bagian bawah, atau dipakai untuk konsol admin ini. Pengguna sendiri punya batas{' '}
            {LIMITS.user} tema pribadi.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-xl border border-white/10 p-3 min-h-[84px]">
            <Dots p={BUILTIN_THEME.palette} />
            <p className="text-xs font-semibold text-white">{BUILTIN_THEME.name}</p>
            <p className="text-[10px] text-gray-500">Bawaan · tidak bisa diubah</p>
          </div>
          {slots.map((t, i) =>
            t ? (
              <button
                key={t.id}
                type="button"
                onClick={() => choose(t.id)}
                className={`rounded-xl border p-3 text-left min-h-[84px] cursor-pointer ${sel === t.id ? 'border-accent bg-white/5' : 'border-white/10 hover:border-white/30'}`}
              >
                <Dots p={t.palette} />
                <p className="text-xs font-semibold text-white truncate">{t.name}</p>
                <p className="text-[10px] text-gray-500">Tema admin</p>
              </button>
            ) : (
              <button
                key={`empty-${i}`}
                type="button"
                onClick={() => choose('new')}
                className={`rounded-xl border border-dashed p-3 text-left min-h-[84px] cursor-pointer ${sel === 'new' && i === themes.length ? 'border-accent' : 'border-white/15 hover:border-white/30'}`}
              >
                <Dots />
                <p className="text-xs font-semibold text-gray-300">Slot kosong</p>
                <p className="text-[10px] text-gray-500">Klik untuk membuat</p>
              </button>
            ),
          )}
        </div>

        {(sel === 'new' || typeof sel === 'number') && (
          <div className="space-y-3 rounded-xl border border-white/10 p-4">
            <label className="text-xs text-gray-400 block">
              Nama tema
              <input
                value={name}
                maxLength={NAME_MAX}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-accent"
              />
            </label>
            <PalettePicker value={draft} onChange={setDraft} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={submit}
                disabled={busy || !name.trim() || (sel === 'new' && isFull)}
                className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm disabled:opacity-50 cursor-pointer"
              >
                {sel === 'new' ? 'Simpan tema' : 'Perbarui tema'}
              </button>
              <button
                type="button"
                onClick={() => useForConsole(draft)}
                className="rounded-xl border border-white/15 px-4 py-2 text-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Monitor className="w-4 h-4" /> Pakai di konsol admin
              </button>
              {typeof sel === 'number' && (
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="rounded-xl border border-red-400/40 text-red-300 px-4 py-2 text-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> Hapus
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 text-xs text-gray-400 border-t border-white/10 pt-3">
          <span>Tampilan konsol admin sekarang:</span>
          {[consolePalette.surface, consolePalette.accent, consolePalette.accent2].map((c, i) => (
            <span key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
          ))}
          <button
            type="button"
            onClick={() => useForConsole(null)}
            disabled={consoleIsDefault}
            className="ml-auto rounded-xl border border-white/15 px-3 py-1.5 text-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Kembalikan tampilan admin
          </button>
        </div>

        {err && <p className="text-xs text-red-400 font-medium">{err}</p>}
        {msg && <p className="text-xs text-emerald-400 font-medium">{msg}</p>}
      </section>

      <section className="rounded-2xl bg-surface border border-white/10 p-5 space-y-3">
        <div>
          <h3 className="font-bold text-white">Terapkan tema ke pengguna</h3>
          <p className="text-xs text-gray-400">
            Masukkan email pengguna terdaftar, pilih tema admin, dan kunci kalau pengguna tidak boleh menggantinya
            sendiri.
          </p>
        </div>

        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadUser()}
            placeholder="email pengguna"
            className="flex-1 rounded-xl bg-black/40 border border-white/10 px-3 py-2 text-sm text-white outline-none focus:border-accent"
          />
          <button type="button" onClick={loadUser} className="rounded-xl border border-white/15 px-4 py-2 text-sm cursor-pointer">
            Muat
          </button>
        </div>

        {target && (
          <div className="space-y-3 rounded-xl border border-white/10 p-4">
            <p className="text-xs text-gray-300">
              <span className="font-mono text-white">{target.email}</span> sedang memakai{' '}
              <strong>{userActiveLabel}</strong>
              {target.state.locked && (
                <span className="ml-2 inline-flex items-center gap-1 text-amber-200">
                  <Lock className="w-3 h-3" /> terkunci
                </span>
              )}
              . Tema pribadi: {target.state.mine.length ? target.state.mine.map((t) => t.name).join(', ') : 'belum ada'}.
            </p>

            <label className="text-xs text-gray-400 block">
              Tema untuk pengguna ini
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="mt-1 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white"
              >
                <option value="builtin">{BUILTIN_THEME.name} (bawaan)</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </label>

            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={lock} disabled={pick === 'builtin'} onChange={(e) => setLock(e.target.checked)} />
              Kunci (pengguna tidak bisa mengganti tema sendiri)
            </label>

            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => applyToUser(false)} className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm cursor-pointer">
                Terapkan
              </button>
              <button type="button" onClick={() => applyToUser(true)} className="rounded-xl border border-white/15 px-4 py-2 text-sm cursor-pointer">
                Reset ke bawaan & buka kunci
              </button>
            </div>
          </div>
        )}
        {uErr && <p className="text-xs text-red-400 font-medium">{uErr}</p>}
        {uMsg && <p className="text-xs text-emerald-400 font-medium">{uMsg}</p>}
      </section>
    </>
  );
};
