// src/theme/ThemeSettings.tsx
// Pengaturan tema untuk PENGGUNA: 1 tema bawaan + maksimal 2 tema sendiri.
// Pasang di halaman profil / menu pengaturan akun.
import React, { useEffect, useState } from 'react';
import { Lock, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { PalettePicker } from './PalettePicker';
import { useTheme } from './ThemeContext';
import { BUILTIN_THEME, NAME_MAX, Palette } from './theme';
import { isLocalMode } from './themeApi';

type Sel = 'builtin' | 'assigned' | 'new' | number;

interface CardProps {
  title: string;
  sub?: string;
  palette?: Palette;
  selected: boolean;
  inUse: boolean;
  onClick: () => void;
}

const Card: React.FC<CardProps> = ({ title, sub, palette, selected, inUse, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`rounded-xl border p-3 text-left cursor-pointer min-h-[84px] ${
      selected ? 'border-accent bg-white/5' : 'border-white/10 hover:border-white/30'
    }`}
  >
    <div className="flex gap-1 mb-2 h-4 items-center">
      {palette ? (
        [palette.bg, palette.surface, palette.accent, palette.accent2]
          .filter((c): c is string => !!c)
          .map((c, i) => (
            <span key={i} className="w-4 h-4 rounded-full border border-white/20" style={{ background: c }} />
          ))
      ) : (
        <Plus className="w-4 h-4 text-gray-500" />
      )}
    </div>
    <p className="text-xs font-semibold text-white truncate">{title}</p>
    <p className="text-[10px] text-gray-500">
      {inUse ? <span className="text-accent font-bold">Sedang dipakai</span> : sub}
    </p>
  </button>
);

export const ThemeSettings: React.FC<{ embedded?: boolean }> = ({ embedded = false }) => {
  const { palette, loaded, activeId, mine, assigned, locked, maxMine, activate, save, remove, reset, preview } = useTheme();

  const [sel, setSel] = useState<Sel>('builtin');
  const [name, setName] = useState('');
  const [draft, setDraft] = useState<Palette>(palette);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = (s: Sel, from?: { name: string; palette: Palette }) => {
    setSel(s);
    setErr('');
    if (from) { setName(from.name); setDraft(from.palette); }
    else if (s === 'builtin') { setName(''); setDraft(BUILTIN_THEME.palette); }
    else if (s === 'new') { setName(`Tema ${mine.length + 1}`); setDraft(palette); }
  };

  // Sinkronkan pilihan awal dengan tema aktif begitu data server masuk.
  useEffect(() => {
    if (!loaded) return;
    if (activeId == null) choose('builtin');
    else if (assigned && assigned.id === activeId) choose('assigned', assigned);
    else {
      const t = mine.find((x) => x.id === activeId);
      if (t) choose(t.id, t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // Pratinjau langsung saat mengedit; batalkan saat pindah kartu / keluar halaman.
  useEffect(() => {
    if (sel === 'new' || typeof sel === 'number') preview(draft);
    else preview(null);
  }, [draft, sel, preview]);
  useEffect(() => () => preview(null), [preview]);

  const guard = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setErr(''); setMsg('');
    try { await fn(); setMsg(ok); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Terjadi kesalahan.'); }
    finally { setBusy(false); }
  };

  const useBuiltin = () => { choose('builtin'); return guard(() => activate(null), 'Memakai tema bawaan.'); };
  const useOwn = (id: number) => {
    const t = mine.find((x) => x.id === id)!;
    choose(id, t);
    return guard(() => activate(id), `Memakai "${t.name}".`);
  };

  const onSave = () =>
    guard(async () => {
      const id = typeof sel === 'number' ? sel : undefined;
      const newActive = await save({ id, name: name.trim(), palette: draft });
      if (newActive != null) setSel(newActive);
    }, isLocalMode() ? 'Tema disimpan dan dipakai di browser ini.' : 'Tema disimpan dan dipakai. Akan tetap sama setiap kamu login.');

  const onDelete = () => {
    if (typeof sel !== 'number') return;
    if (!confirm('Hapus tema ini?')) return;
    const id = sel;
    choose('builtin');
    return guard(() => remove(id), 'Tema dihapus.');
  };

  const onReset = () => { choose('builtin'); return guard(reset, 'Kembali ke tema bawaan. Tema tersimpanmu tidak ikut terhapus.'); };

  const editing = sel === 'new' || typeof sel === 'number';
  const slots = Array.from({ length: maxMine }, (_, i) => mine[i]);
  const isFull = mine.length >= maxMine;

  return (
    <section className={`space-y-4 ${embedded ? '' : 'rounded-2xl bg-surface border border-white/10 p-5 max-w-2xl'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-white">Tema saya</h3>
          <p className="text-xs text-gray-400">
            Tema bawaan + maksimal {maxMine} tema buatanmu (gelap, terang, atau kustom bebas). Tersimpan di akun, jadi tetap sama waktu login lagi.
          </p>
        </div>
        <button
          type="button"
          onClick={onReset}
          disabled={locked || busy || (activeId == null && !assigned)}
          className="shrink-0 flex items-center gap-1.5 rounded-xl border border-white/15 px-3 py-1.5 text-xs text-gray-200 disabled:opacity-40 cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset
        </button>
      </div>

      {locked && (
        <p className="flex items-center gap-2 text-xs rounded-xl bg-amber-500/10 border border-amber-400/30 text-amber-200 px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          Tema kamu dikunci admin{assigned ? ` (“${assigned.name}”)` : ''}, jadi belum bisa diubah.
        </p>
      )}
      {!locked && assigned && (
        <p className="text-xs rounded-xl bg-white/5 border border-white/10 text-gray-300 px-3 py-2">
          Admin menerapkan tema “{assigned.name}” untukmu. Kamu masih boleh menggantinya.
        </p>
      )}

      <div className={`space-y-4 ${locked ? 'opacity-60 pointer-events-none' : ''}`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Card
            title={BUILTIN_THEME.name}
            sub="Bawaan"
            palette={BUILTIN_THEME.palette}
            selected={sel === 'builtin'}
            inUse={activeId == null}
            onClick={useBuiltin}
          />
          {assigned && (
            <Card
              title={assigned.name}
              sub="Dari admin"
              palette={assigned.palette}
              selected={sel === 'assigned'}
              inUse={activeId === assigned.id}
              onClick={() => { choose('assigned', assigned); guard(() => activate(assigned.id), `Memakai "${assigned.name}".`); }}
            />
          )}
          {slots.map((t, i) =>
            t ? (
              <Card
                key={t.id}
                title={t.name}
                sub="Tema saya"
                palette={t.palette}
                selected={sel === t.id}
                inUse={activeId === t.id}
                onClick={() => useOwn(t.id)}
              />
            ) : (
              <Card
                key={`empty-${i}`}
                title="Slot kosong"
                sub="Klik untuk membuat"
                selected={sel === 'new' && i === mine.length}
                inUse={false}
                onClick={() => choose('new')}
              />
            ),
          )}
        </div>

        {sel === 'builtin' && <p className="text-xs text-gray-500">Tema bawaan tidak bisa diubah. Pilih slot kosong untuk bikin tema sendiri.</p>}

        {editing && (
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
                onClick={onSave}
                disabled={busy || !name.trim() || (sel === 'new' && isFull)}
                className="rounded-xl bg-accent text-on-accent font-bold px-4 py-2 text-sm disabled:opacity-50 cursor-pointer"
              >
                {sel === 'new' ? 'Simpan & pakai' : 'Perbarui & pakai'}
              </button>
              {typeof sel === 'number' && (
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                  className="rounded-xl border border-red-400/40 text-red-300 px-4 py-2 text-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" /> Hapus
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {isLocalMode() && (
        <p className="text-[11px] text-gray-500">Tema disimpan di browser ini (server tema belum tersedia).</p>
      )}
      {err && <p className="text-xs text-red-400 font-medium">{err}</p>}
      {msg && <p className="text-xs text-emerald-400 font-medium">{msg}</p>}
    </section>
  );
};
