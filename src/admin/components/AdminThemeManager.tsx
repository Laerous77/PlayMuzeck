// src/admin/components/AdminThemeManager.tsx
// Admin: kelola maksimal 7 tema, pakai di konsol admin, + terapkan/kunci/reset tema untuk
// SEMUA pengguna atau pengguna terpilih, lengkap dengan notifikasi (template / tulis sendiri).
import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Lock, Monitor, Plus, RotateCcw, Send, Trash2, Users } from 'lucide-react';
import { adminFetch } from '../adminApi';
import { PalettePicker } from '../../theme/PalettePicker';
import { BUILTIN_THEME, LIMITS, NAME_MAX, Palette, ThemeRecord, samePalette } from '../../theme/theme';
import { loadAdminPalette, saveAdminPalette } from '../adminTheme';
import { READONLY_MSG, useAdminRole } from '../useAdminRole';
import {
  APPLY_TEMPLATES, NOTICE_MESSAGE_MAX, NOTICE_TITLE_MAX, NoticeTemplate, RESET_TEMPLATES, fillNotice,
} from '../themeNotice';

type Sel = number | 'new' | null;
type TargetMode = 'selected' | 'all';

interface NoticeDraft { title: string; message: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 404 dari endpoint tema artinya router tema belum terpasang di server.
const explain = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : fallback;
  return m.includes('(404)')
    ? 'Endpoint tema belum ada di server (404). Pastikan themeRoutes & themeBulkRoutes terpasang di server/index.ts, lalu restart server.'
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

const initNotice = (list: NoticeTemplate[]): NoticeDraft => ({
  title: list[0].title,
  message: list[0].message,
});

interface NoticeEditorProps {
  label: string;
  value: NoticeDraft;
  onChange: (v: NoticeDraft) => void;
  disabled: boolean;
}

const NoticeEditor: React.FC<NoticeEditorProps> = ({ label, value, onChange, disabled }) => {
  return (
    <div className={`space-y-2 rounded-xl border border-white/10 p-3 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      <p className="text-xs font-semibold text-white">{label}</p>
      <input
        value={value.title}
        maxLength={NOTICE_TITLE_MAX}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        placeholder="Judul notifikasi"
        className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-accent"
      />
      <textarea
        value={value.message}
        maxLength={NOTICE_MESSAGE_MAX}
        rows={3}
        onChange={(e) => onChange({ ...value, message: e.target.value })}
        placeholder="Isi pesan"
        className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-accent resize-y"
      />
      <p className="text-[10px] text-gray-500">
        Tulis <span className="font-mono">{'{tema}'}</span> untuk menyisipkan nama tema otomatis. {value.message.length}/{NOTICE_MESSAGE_MAX}
      </p>
    </div>
  );
};

interface BulkResult {
  total?: number;
  updated?: number;
  restored?: number;
  skipped?: string[];
  notified?: number;
}

export const AdminThemeManager: React.FC = () => {
  const { isSuperAdmin } = useAdminRole();

  const [themes, setThemes] = useState<ThemeRecord[]>([]);
  const [max, setMax] = useState<number>(LIMITS.admin);
  const [sel, setSel] = useState<Sel>(null);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Palette>(BUILTIN_THEME.palette);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [consolePalette, setConsolePalette] = useState<Palette>(loadAdminPalette);

  // ── Terapkan ke pengguna ───────────────────────────────────────────────
  const [users, setUsers] = useState<string[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersFailed, setUsersFailed] = useState(false);
  const [targetMode, setTargetMode] = useState<TargetMode>('selected');
  const [chosen, setChosen] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [manual, setManual] = useState('');
  const [pick, setPick] = useState('');
  const [lock, setLock] = useState(false);
  const [notifyOn, setNotifyOn] = useState(true);
  const [applyNotice, setApplyNotice] = useState<NoticeDraft>(() => initNotice(APPLY_TEMPLATES));
  const [resetNotice, setResetNotice] = useState<NoticeDraft>(() => initNotice(RESET_TEMPLATES));
  const [uBusy, setUBusy] = useState(false);
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

  const loadUsers = () => {
    setUsersFailed(false);
    adminFetch<{ users: Array<{ email: string }> }>('/api/admin/theme-bulk/users')
      .then((r) => {
        setUsers(r.users.map((u) => u.email.toLowerCase()));
        setUsersLoaded(true);
        setUErr('');
      })
      .catch((e) => {
        setUsersFailed(true);
        setUErr(explain(e, 'Gagal memuat daftar pengguna.'));
      });
  };

  // Endpoint ini khusus Super Admin; useAdminRole memuat perannya secara asinkron,
  // jadi baru dipanggil setelah peran diketahui.
  useEffect(() => {
    if (isSuperAdmin) loadUsers();
  }, [isSuperAdmin]);

  // Pilih tema pertama otomatis agar tombol Terapkan langsung siap.
  useEffect(() => {
    if (themes.length === 0) { setPick(''); return; }
    if (!themes.some((t) => String(t.id) === pick)) setPick(String(themes[0].id));
  }, [themes, pick]);

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

  // ── Pemilihan pengguna ──────────────────────────────────────────────────
  const userSet = useMemo(() => new Set(users), [users]);
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return users.filter((u) => !s || u.includes(s)).slice(0, 200);
  }, [users, q]);

  const toggle = (e: string) =>
    setChosen((prev) => (prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]));
  const selectVisible = () => setChosen((prev) => Array.from(new Set([...prev, ...filtered])));

  const addManual = () => {
    setUErr('');
    const e = manual.trim().toLowerCase();
    if (!EMAIL_RE.test(e)) { setUErr('Alamat email tidak valid.'); return; }
    if (usersLoaded && !userSet.has(e)) { setUErr('Email ini belum terdaftar sebagai pengguna.'); return; }
    setChosen((prev) => (prev.includes(e) ? prev : [...prev, e]));
    setManual('');
  };

  // ── Kirim ke server ─────────────────────────────────────────────────────
  const themeName = themes.find((t) => String(t.id) === pick)?.name ?? '';
  const targetCount = targetMode === 'all' ? users.length : chosen.length;
  const targetLabel = targetMode === 'all' ? `SEMUA pengguna (${users.length})` : `${chosen.length} pengguna terpilih`;

  const buildNotify = (n: NoticeDraft, tema: string) => {
    if (!notifyOn) return null;
    const title = fillNotice(n.title, { tema }).trim();
    const message = fillNotice(n.message, { tema }).trim();
    if (!title || !message) throw new Error('Judul dan isi notifikasi tidak boleh kosong (atau matikan notifikasi).');
    return { title, message };
  };

  const describeSkipped = (skipped?: string[]) =>
    skipped && skipped.length
      ? ` Dilewati ${skipped.length}: ${skipped.slice(0, 5).join(', ')}${skipped.length > 5 ? ', …' : ''}.`
      : '';

  const runBulk = async (action: 'apply' | 'reset-previous' | 'reset-builtin') => {
    setUErr(''); setUMsg('');
    if (!isSuperAdmin) { setUErr(READONLY_MSG); return; }
    if (targetMode === 'all' && !usersLoaded) { setUErr('Daftar pengguna belum berhasil dimuat. Klik "Coba lagi" atau cek koneksi/server.'); return; }
    if (targetCount === 0) { setUErr(targetMode === 'all' ? 'Belum ada pengguna terdaftar di database.' : 'Pilih minimal satu pengguna.'); return; }
    if (action === 'apply' && !pick) { setUErr('Pilih tema admin dulu.'); return; }

    const verb =
      action === 'apply' ? `Terapkan tema "${themeName}"${lock ? ' (dikunci)' : ''}`
      : action === 'reset-previous' ? 'Kembalikan ke tema sebelumnya'
      : 'Kembalikan ke tema bawaan & buka kunci';
    if (!confirm(`${verb} untuk ${targetLabel}?${notifyOn ? ' Notifikasi akan dikirim ke pengguna.' : ''}`)) return;

    setUBusy(true);
    try {
      const scopeBody = { scope: targetMode, emails: targetMode === 'selected' ? chosen : undefined };
      if (action === 'apply') {
        const r = await adminFetch<BulkResult>('/api/admin/theme-bulk/apply', {
          method: 'POST',
          body: JSON.stringify({
            ...scopeBody,
            themeId: Number(pick),
            locked: lock,
            notify: buildNotify(applyNotice, themeName),
          }),
        });
        setUMsg(
          `Tema "${themeName}" diterapkan ke ${r.updated ?? 0} pengguna${lock ? ' (terkunci)' : ''}.` +
          `${notifyOn ? ` Notifikasi terkirim: ${r.notified ?? 0}.` : ''}${describeSkipped(r.skipped)} ` +
          'Pengguna melihatnya otomatis dalam ±30 detik.',
        );
      } else {
        const mode = action === 'reset-previous' ? 'previous' : 'builtin';
        const r = await adminFetch<BulkResult>('/api/admin/theme-bulk/reset', {
          method: 'POST',
          body: JSON.stringify({
            ...scopeBody,
            mode,
            notify: buildNotify(resetNotice, mode === 'builtin' ? BUILTIN_THEME.name : 'sebelumnya'),
          }),
        });
        setUMsg(
          `${r.restored ?? 0} pengguna ${mode === 'previous' ? 'dikembalikan ke tema sebelumnya' : 'dikembalikan ke tema bawaan'}.` +
          `${notifyOn ? ` Notifikasi terkirim: ${r.notified ?? 0}.` : ''}` +
          `${mode === 'previous' && r.skipped?.length ? ` ${r.skipped.length} dilewati karena tidak ada riwayat tema sebelumnya.` : ''}`,
        );
      }
    } catch (er) {
      setUErr(explain(er, 'Gagal memproses permintaan.'));
    } finally {
      setUBusy(false);
    }
  };

  const slots = Array.from({ length: max }, (_, i) => themes[i]);
  const isFull = themes.length >= max;
  const consoleIsDefault = samePalette(consolePalette, loadAdminPalette()) && !localStorage.getItem('pm_admin_palette');

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

      <section className="rounded-2xl bg-surface border border-white/10 p-5 space-y-4">
        <div>
          <h3 className="font-bold text-white flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" /> Terapkan tema ke pengguna
          </h3>
          <p className="text-xs text-gray-400">
            Terapkan satu tema admin ke semua pengguna atau ke pengguna yang dipilih manual. Tema yang dipakai sebelumnya
            disimpan otomatis, jadi bisa dikembalikan kapan saja lewat tombol reset.
          </p>
        </div>

        {!isSuperAdmin && (
          <p className="text-xs rounded-xl bg-accent/10 border border-accent/30 text-accent px-3 py-2">{READONLY_MSG}</p>
        )}

        <div className={`space-y-4 ${isSuperAdmin ? '' : 'opacity-60 pointer-events-none'}`}>
          {/* 1. Target */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400">1. Siapa yang kena?</p>
            <div className="inline-flex rounded-xl border border-white/10 p-0.5">
              {([['selected', 'Pengguna terpilih'], ['all', 'Semua pengguna']] as const).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setTargetMode(m)}
                  className={`px-3 py-1.5 rounded-[10px] text-xs font-bold cursor-pointer ${
                    targetMode === m ? 'bg-accent text-on-accent' : 'text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {targetMode === 'all' ? (
              usersFailed ? (
                <p className="text-xs text-red-300 rounded-xl bg-red-500/10 border border-red-400/30 px-3 py-2 flex items-center gap-2">
                  <span>Daftar pengguna gagal dimuat dari server.</span>
                  <button type="button" onClick={loadUsers} className="underline font-bold cursor-pointer">Coba lagi</button>
                </p>
              ) : (
                <p className="text-xs text-amber-200 rounded-xl bg-amber-500/10 border border-amber-400/30 px-3 py-2">
                  Perubahan berlaku ke {usersLoaded ? users.length : '…'} pengguna terdaftar.
                </p>
              )
            ) : (
              <div className="space-y-2 rounded-xl border border-white/10 p-3">
                <div className="flex gap-2">
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Cari email pengguna…"
                    className="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-accent"
                  />
                  <button type="button" onClick={selectVisible} className="rounded-lg border border-white/15 px-3 py-2 text-xs cursor-pointer">
                    Pilih hasil
                  </button>
                  <button type="button" onClick={() => setChosen([])} disabled={chosen.length === 0} className="rounded-lg border border-white/15 px-3 py-2 text-xs cursor-pointer disabled:opacity-40">
                    Kosongkan
                  </button>
                </div>

                <div className="max-h-48 overflow-auto rounded-lg border border-white/5 divide-y divide-white/5">
                  {!usersLoaded && <p className="p-3 text-xs text-gray-500">Memuat pengguna…</p>}
                  {usersLoaded && filtered.length === 0 && <p className="p-3 text-xs text-gray-500">Tidak ada yang cocok.</p>}
                  {filtered.map((e) => (
                    <label key={e} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-200 cursor-pointer hover:bg-white/5">
                      <input type="checkbox" checked={chosenSet.has(e)} onChange={() => toggle(e)} />
                      <span className="font-mono truncate">{e}</span>
                    </label>
                  ))}
                </div>
                {users.length > 200 && <p className="text-[10px] text-gray-500">Menampilkan 200 pertama — persempit dengan pencarian, atau tambah manual di bawah.</p>}

                <div className="flex gap-2">
                  <input
                    type="email"
                    value={manual}
                    onChange={(e) => setManual(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addManual()}
                    placeholder="Tambah manual: email pengguna"
                    className="flex-1 rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-accent"
                  />
                  <button type="button" onClick={addManual} className="rounded-lg border border-white/15 px-3 py-2 text-xs cursor-pointer">
                    Tambah
                  </button>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-auto">
                  {chosen.length === 0 && <span className="text-[11px] text-gray-500">Belum ada yang dipilih.</span>}
                  {chosen.map((e) => (
                    <button
                      key={e}
                      type="button"
                      onClick={() => toggle(e)}
                      title="Klik untuk hapus"
                      className="rounded-full bg-accent/15 border border-accent/30 text-accent px-2 py-0.5 text-[10px] font-mono cursor-pointer"
                    >
                      {e} ×
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 2. Tema */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400">2. Tema yang diterapkan</p>
            {themes.length === 0 ? (
              <p className="text-xs text-gray-500">Buat dulu minimal satu tema admin di atas.</p>
            ) : (
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                className="w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white"
              >
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 text-xs text-gray-300">
              <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
              <Lock className="w-3 h-3" /> Kunci (pengguna tidak bisa mengganti tema sendiri)
            </label>
          </div>

          {/* 3. Notifikasi */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-xs text-gray-400">
              <input type="checkbox" checked={notifyOn} onChange={(e) => setNotifyOn(e.target.checked)} />
              <Bell className="w-3.5 h-3.5" /> 3. Kirim notifikasi ke pengguna
            </label>
            <div className="grid md:grid-cols-2 gap-3">
              <NoticeEditor
                label="Pesan saat tema diterapkan"
                value={applyNotice}
                onChange={setApplyNotice}
                disabled={!notifyOn}
              />
              <NoticeEditor
                label="Pesan saat tema direset"
                value={resetNotice}
                onChange={setResetNotice}
                disabled={!notifyOn}
              />
            </div>
          </div>

          {/* Aksi */}
          <div className="flex flex-wrap gap-2 border-t border-white/10 pt-3">
            <button
              type="button"
              onClick={() => runBulk('apply')}
              disabled={uBusy || !pick}
              className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <Send className="w-4 h-4" /> Terapkan ke {targetMode === 'all' ? 'semua' : `${chosen.length} pengguna`}
            </button>
            <button
              type="button"
              onClick={() => runBulk('reset-previous')}
              disabled={uBusy}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" /> Reset ke tema sebelumnya
            </button>
            <button
              type="button"
              onClick={() => runBulk('reset-builtin')}
              disabled={uBusy}
              className="rounded-xl border border-white/15 px-4 py-2 text-sm disabled:opacity-50 cursor-pointer"
            >
              Reset ke bawaan & buka kunci
            </button>
          </div>
        </div>

        {uErr && <p className="text-xs text-red-400 font-medium">{uErr}</p>}
        {uMsg && <p className="text-xs text-emerald-400 font-medium">{uMsg}</p>}
      </section>
    </>
  );
};
