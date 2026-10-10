// src/admin/pages/ArenaDecksPage.tsx
//
// Panel admin "Deck Arena Global": 12 tema (Alam ... Teknologi) x 20 soal. Deck ini HANYA dipakai Arena Global
// (bersama kuis Komunitas), tidak muncul di Perpustakaan Pusat Kuis, dan hanya admin yang bisa mengubahnya.
// Memakai endpoint /api/admin/arena-decks* (server/arenaPresetRoutes.ts).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  EyeOff,
  Loader2,
  Plus,
  Power,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AdminSessionError, adminFetch } from '../adminApi';
import { ARENA_DECK_SIZE } from '../../data/quiz/arenaThemes';

/* ───────────────────────────── Tipe ───────────────────────────── */

interface ThemeSummary {
  id: string;
  themeTitle: string;
  description: string;
  title: string;
  questionCount: number;
  complete: boolean;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

interface ListResponse {
  deckSize: number;
  themes: ThemeSummary[];
}

interface EditQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  category: string;
  /** Field opsional (media, batas waktu) dipertahankan apa adanya saat deck dimuat / diimpor. */
  extra?: Record<string, unknown>;
}

interface DeckResponse {
  id: string;
  themeTitle: string;
  description: string;
  deckSize: number;
  title: string;
  questions: Array<Record<string, any>>;
  enabled: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

const MAX_OPTIONS = 6;
const MIN_OPTIONS = 2;
const EXTRA_KEYS = ['timeLimitSec', 'mediaType', 'mediaUrl', 'mediaCredit', 'mediaSourceUrl'];

const fmt = (iso: string | null) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

const blankQuestion = (): EditQuestion => ({ question: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', category: '' });

const isBlank = (q: EditQuestion) => !q.question.trim() && q.options.every((o) => !o.trim()) && !q.explanation.trim();

/** Ubah soal mentah (dari server / berkas JSON) menjadi soal yang bisa disunting. */
function toEditQuestion(raw: any): EditQuestion {
  const options = Array.isArray(raw?.options) ? raw.options.map((o: unknown) => String(o ?? '')) : [];
  while (options.length < MIN_OPTIONS) options.push('');
  const extra: Record<string, unknown> = {};
  for (const k of EXTRA_KEYS) if (raw?.[k] !== undefined && raw[k] !== '') extra[k] = raw[k];
  const ci = Number(raw?.correctIndex);
  return {
    question: String(raw?.question ?? ''),
    options: options.slice(0, MAX_OPTIONS),
    correctIndex: Number.isInteger(ci) && ci >= 0 && ci < options.length ? ci : 0,
    explanation: String(raw?.explanation ?? ''),
    category: String(raw?.category ?? ''),
    extra: Object.keys(extra).length ? extra : undefined,
  };
}

/** Isi 20 slot dari daftar soal (sisa slot kosong). */
const toSlots = (list: unknown[]): EditQuestion[] => {
  const slots = list.slice(0, ARENA_DECK_SIZE).map(toEditQuestion);
  while (slots.length < ARENA_DECK_SIZE) slots.push(blankQuestion());
  return slots;
};

/** Galat untuk satu soal (null = sah). Mencerminkan aturan server. */
function problemOf(q: EditQuestion): string | null {
  if (q.question.trim().length < 5) return 'Pertanyaan minimal 5 karakter.';
  const opts = q.options.map((o) => o.trim());
  if (opts.length < MIN_OPTIONS) return 'Minimal 2 pilihan jawaban.';
  if (opts.some((o) => !o)) return 'Ada pilihan jawaban yang kosong.';
  if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return 'Ada pilihan jawaban yang kembar.';
  if (q.correctIndex < 0 || q.correctIndex >= opts.length) return 'Pilih jawaban yang benar.';
  return null;
}

const toPayloadQuestion = (q: EditQuestion) => ({
  question: q.question.trim(),
  options: q.options.map((o) => o.trim()),
  correctIndex: q.correctIndex,
  explanation: q.explanation.trim(),
  category: q.category.trim(),
  ...(q.extra || {}),
});

const downloadJson = (name: string, data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const TEMPLATE = Array.from({ length: ARENA_DECK_SIZE }, (_, i) => ({
  question: `Tulis pertanyaan nomor ${i + 1} di sini`,
  options: ['Pilihan A', 'Pilihan B', 'Pilihan C', 'Pilihan D'],
  correctIndex: 0,
  explanation: 'Penjelasan singkat jawaban yang benar (opsional).',
  category: 'Kategori (opsional)',
}));

/* ───────────────────────────── Halaman ───────────────────────────── */

export const ArenaDecksPage: React.FC = () => {
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const handleErr = (e: unknown) => {
    if (e instanceof AdminSessionError) return; // AdminApp sudah mengembalikan ke layar login
    setError(e instanceof Error ? e.message : 'Terjadi kesalahan.');
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await adminFetch<ListResponse>('/api/admin/arena-decks'));
    } catch (e) {
      handleErr(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (t: ThemeSummary) => {
    setBusy(t.id);
    setError('');
    setNotice('');
    try {
      await adminFetch(`/api/admin/arena-decks/${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !t.enabled }),
      });
      setNotice(`Deck "${t.themeTitle}" ${t.enabled ? 'dinonaktifkan' : 'diaktifkan'}.`);
      await load();
    } catch (e) {
      handleErr(e);
    } finally {
      setBusy(null);
    }
  };

  const stats = useMemo(() => {
    const themes = data?.themes ?? [];
    return {
      active: themes.filter((t) => t.enabled).length,
      complete: themes.filter((t) => t.complete).length,
      questions: themes.reduce((s, t) => s + t.questionCount, 0),
      total: themes.length,
    };
  }, [data]);

  if (editing) {
    return (
      <DeckEditor
        themeId={editing}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          setNotice(msg);
          void load();
        }}
      />
    );
  }

  return (
    <div className="space-y-5 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="text-lg font-black text-white">Deck Arena Global</h3>
          <p className="text-xs text-gray-400 max-w-2xl leading-relaxed">
            Arena Global memutar kuis Komunitas yang sudah disetujui <strong className="text-gray-200">ditambah</strong> deck di bawah ini: satu
            deck per tema, masing-masing tepat {ARENA_DECK_SIZE} soal. Deck ini <strong className="text-gray-200">tidak tampil di Perpustakaan</strong>{' '}
            dan hanya bisa diatur dari panel ini.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Deck aktif di arena', value: `${stats.active}/${stats.total}` },
          { label: 'Deck lengkap (20 soal)', value: `${stats.complete}/${stats.total}` },
          { label: 'Total soal tersimpan', value: String(stats.questions) },
          { label: 'Target total soal', value: String(stats.total * ARENA_DECK_SIZE) },
        ].map((c) => (
          <div key={c.label} className="rounded-2xl bg-surface border border-white/10 p-3">
            <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{c.label}</p>
            <p className="text-xl font-black text-white mt-0.5">{c.value}</p>
          </div>
        ))}
      </div>

      {error && <p className="text-xs text-red-400 font-medium">{error}</p>}
      {notice && <p className="text-xs text-emerald-300 font-medium">{notice}</p>}

      {loading && !data ? (
        <p className="text-sm text-gray-400 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Memuat deck…
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {(data?.themes ?? []).map((t) => {
            const pct = Math.min(100, Math.round((t.questionCount / ARENA_DECK_SIZE) * 100));
            const status = t.enabled
              ? { label: 'Aktif', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' }
              : t.complete
                ? { label: 'Lengkap • nonaktif', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' }
                : t.questionCount > 0
                  ? { label: 'Draf', cls: 'bg-white/10 text-gray-300 border-white/15' }
                  : { label: 'Belum dibuat', cls: 'bg-white/5 text-gray-500 border-white/10' };
            return (
              <div key={t.id} className="rounded-2xl bg-surface border border-white/10 p-4 flex flex-col gap-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-white truncate">{t.themeTitle}</p>
                    <p className="text-[11px] text-gray-400 leading-snug mt-0.5">{t.description}</p>
                  </div>
                  <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border ${status.cls}`}>{status.label}</span>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] font-mono text-gray-300 mb-1">
                    <span>
                      {t.questionCount}/{ARENA_DECK_SIZE} soal
                    </span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div className={`h-full rounded-full ${t.complete ? 'bg-emerald-400' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>

                {t.updatedAt && (
                  <p className="text-[10px] text-gray-500 truncate">
                    Diubah {fmt(t.updatedAt)}
                    {t.updatedBy ? ` oleh ${t.updatedBy}` : ''}
                  </p>
                )}

                <div className="flex gap-2 mt-auto">
                  <button
                    type="button"
                    onClick={() => setEditing(t.id)}
                    className="flex-1 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black cursor-pointer"
                  >
                    {t.questionCount ? 'Edit deck' : 'Buat deck'}
                  </button>
                  <button
                    type="button"
                    disabled={busy === t.id || (!t.enabled && !t.complete)}
                    onClick={() => void toggle(t)}
                    title={!t.enabled && !t.complete ? `Butuh tepat ${ARENA_DECK_SIZE} soal untuk diaktifkan` : t.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                    className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1.5"
                  >
                    {busy === t.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t.enabled ? <EyeOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                    {t.enabled ? 'Matikan' : 'Aktifkan'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ───────────────────────────── Editor satu deck ───────────────────────────── */

interface EditorProps {
  themeId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const DeckEditor: React.FC<EditorProps> = ({ themeId, onClose, onSaved }) => {
  const [meta, setMeta] = useState<DeckResponse | null>(null);
  const [title, setTitle] = useState('');
  const [slots, setSlots] = useState<EditQuestion[]>(() => toSlots([]));
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminFetch<DeckResponse>(`/api/admin/arena-decks/${encodeURIComponent(themeId)}`)
      .then((d) => {
        if (cancelled) return;
        setMeta(d);
        setTitle(d.title);
        setSlots(toSlots(d.questions));
        setEnabled(d.enabled);
        setDirty(false);
      })
      .catch((e) => {
        if (!cancelled && !(e instanceof AdminSessionError)) setError(e instanceof Error ? e.message : 'Gagal memuat deck.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [themeId]);

  // Peringatan bila meninggalkan halaman dengan perubahan yang belum disimpan.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = (i: number, patch: Partial<EditQuestion>) => {
    setSlots((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
    setDirty(true);
  };

  const filled = useMemo(() => slots.map((q, i) => ({ q, i })).filter(({ q }) => !isBlank(q)), [slots]);
  const problems = useMemo(() => filled.map(({ q, i }) => ({ i, msg: problemOf(q) })).filter((p) => p.msg), [filled]);
  const duplicates = useMemo(() => {
    const seen = new Map<string, number>();
    const dup = new Set<number>();
    for (const { q, i } of filled) {
      const k = q.question.trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) {
        dup.add(i);
        dup.add(seen.get(k)!);
      } else seen.set(k, i);
    }
    return dup;
  }, [filled]);

  const validCount = filled.length - problems.length;
  const readyToActivate = filled.length === ARENA_DECK_SIZE && problems.length === 0 && duplicates.size === 0;

  const save = async (activate: boolean) => {
    setError('');
    setNotice('');
    if (problems.length) {
      setError(`Soal ${problems[0].i + 1}: ${problems[0].msg}`);
      setOpenIdx(problems[0].i);
      return;
    }
    if (duplicates.size) {
      const first = Math.min(...duplicates);
      setError(`Soal ${first + 1}: pertanyaan kembar dengan soal lain.`);
      setOpenIdx(first);
      return;
    }
    if (activate && filled.length !== ARENA_DECK_SIZE) {
      setError(`Deck baru bisa diaktifkan bila berisi tepat ${ARENA_DECK_SIZE} soal (sekarang ${filled.length}).`);
      return;
    }
    setSaving(true);
    try {
      const nextEnabled = activate ? true : enabled && filled.length === ARENA_DECK_SIZE;
      await adminFetch(`/api/admin/arena-decks/${encodeURIComponent(themeId)}`, {
        method: 'PUT',
        body: JSON.stringify({ title: title.trim(), questions: filled.map(({ q }) => toPayloadQuestion(q)), enabled: nextEnabled }),
      });
      setEnabled(nextEnabled);
      setDirty(false);
      const msg = `Deck "${meta?.themeTitle ?? themeId}" disimpan (${filled.length}/${ARENA_DECK_SIZE} soal${nextEnabled ? ', aktif di Arena Global' : ', belum aktif'}).`;
      setNotice(msg);
      onSaved(msg);
    } catch (e) {
      if (!(e instanceof AdminSessionError)) setError(e instanceof Error ? e.message : 'Gagal menyimpan.');
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async () => {
    setSaving(true);
    setError('');
    try {
      await adminFetch(`/api/admin/arena-decks/${encodeURIComponent(themeId)}`, { method: 'PATCH', body: JSON.stringify({ enabled: false }) });
      setEnabled(false);
      const msg = `Deck "${meta?.themeTitle ?? themeId}" dinonaktifkan.`;
      setNotice(msg);
      onSaved(msg);
    } catch (e) {
      if (!(e instanceof AdminSessionError)) setError(e instanceof Error ? e.message : 'Gagal menonaktifkan.');
    } finally {
      setSaving(false);
    }
  };

  const clearDeck = async () => {
    if (!window.confirm(`Hapus seluruh soal deck "${meta?.themeTitle ?? themeId}"? Deck akan keluar dari rotasi Arena Global.`)) return;
    setSaving(true);
    setError('');
    try {
      await adminFetch(`/api/admin/arena-decks/${encodeURIComponent(themeId)}`, { method: 'DELETE' });
      setSlots(toSlots([]));
      setTitle(meta?.themeTitle ?? '');
      setEnabled(false);
      setDirty(false);
      const msg = `Deck "${meta?.themeTitle ?? themeId}" dikosongkan.`;
      setNotice(msg);
      onSaved(msg);
    } catch (e) {
      if (!(e instanceof AdminSessionError)) setError(e instanceof Error ? e.message : 'Gagal menghapus.');
    } finally {
      setSaving(false);
    }
  };

  /** Impor soal dari JSON: array soal, atau objek { title?, questions: [...] }. Menimpa isi editor (belum disimpan). */
  const applyImport = (text: string) => {
    setError('');
    setNotice('');
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      setError('JSON tidak valid. Periksa tanda kurung, koma, dan tanda kutip.');
      return;
    }
    const list: unknown[] | null = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.questions) ? parsed.questions : null;
    if (!list) {
      setError('Format harus berupa array soal, atau objek dengan properti "questions".');
      return;
    }
    if (!list.length) {
      setError('Tidak ada soal di JSON.');
      return;
    }
    if (list.length > ARENA_DECK_SIZE) {
      setError(`JSON berisi ${list.length} soal; satu deck maksimal ${ARENA_DECK_SIZE}.`);
      return;
    }
    setSlots(toSlots(list));
    if (!Array.isArray(parsed) && typeof parsed?.title === 'string' && parsed.title.trim()) setTitle(parsed.title.trim().slice(0, 120));
    setDirty(true);
    setOpenIdx(0);
    setImportOpen(false);
    setImportText('');
    setNotice(`${list.length} soal diimpor ke editor. Periksa lalu tekan Simpan.`);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError('Berkas terlalu besar (maksimal 2 MB).');
      return;
    }
    applyImport(await f.text());
  };

  const exportDeck = () => downloadJson(`arena-${themeId}.json`, { title: title.trim(), questions: filled.map(({ q }) => toPayloadQuestion(q)) });

  const addOption = (i: number) => {
    const q = slots[i];
    if (q.options.length >= MAX_OPTIONS) return;
    update(i, { options: [...q.options, ''] });
  };
  const removeOption = (i: number, oi: number) => {
    const q = slots[i];
    if (q.options.length <= MIN_OPTIONS) return;
    const options = q.options.filter((_, idx) => idx !== oi);
    const correctIndex = q.correctIndex === oi ? 0 : q.correctIndex > oi ? q.correctIndex - 1 : q.correctIndex;
    update(i, { options, correctIndex });
  };

  const inputCls = 'w-full rounded-xl bg-black/50 border border-white/10 px-3 py-2 text-xs text-white outline-none focus:border-accent';

  if (loading) {
    return (
      <p className="text-sm text-gray-400 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Memuat deck…
      </p>
    );
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <button
        type="button"
        onClick={() => {
          if (dirty && !window.confirm('Ada perubahan yang belum disimpan. Tetap kembali?')) return;
          onClose();
        }}
        className="flex items-center gap-1.5 text-xs font-bold text-gray-300 hover:text-white cursor-pointer"
      >
        <ArrowLeft className="w-3.5 h-3.5" /> Semua tema
      </button>

      <div className="rounded-2xl bg-surface border border-white/10 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-accent font-bold">Tema</p>
            <h3 className="text-lg font-black text-white">{meta?.themeTitle}</h3>
            <p className="text-[11px] text-gray-400">{meta?.description}</p>
          </div>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
              enabled ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-white/10 text-gray-300 border-white/15'
            }`}
          >
            {enabled ? 'Aktif di Arena Global' : 'Tidak aktif'}
          </span>
        </div>

        <label className="block text-xs font-semibold text-gray-300">
          Judul deck (tampil di layar Arena)
          <input
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
            className={`${inputCls} mt-1`}
            placeholder={meta?.themeTitle}
          />
        </label>

        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          <span className={`px-2 py-1 rounded-lg border ${filled.length === ARENA_DECK_SIZE ? 'border-emerald-500/40 text-emerald-300' : 'border-white/15 text-gray-300'}`}>
            {filled.length}/{ARENA_DECK_SIZE} soal terisi
          </span>
          <span className="px-2 py-1 rounded-lg border border-white/15 text-gray-300">{validCount} valid</span>
          {problems.length > 0 && <span className="px-2 py-1 rounded-lg border border-red-500/40 text-red-300">{problems.length} bermasalah</span>}
          {duplicates.size > 0 && <span className="px-2 py-1 rounded-lg border border-red-500/40 text-red-300">{duplicates.size} soal kembar</span>}
          {dirty && <span className="px-2 py-1 rounded-lg border border-amber-500/40 text-amber-300">belum disimpan</span>}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setImportOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" /> Impor JSON
          </button>
          <button
            type="button"
            onClick={() => downloadJson(`templat-arena-${themeId}.json`, { title: meta?.themeTitle, questions: TEMPLATE })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Unduh templat
          </button>
          <button
            type="button"
            disabled={!filled.length}
            onClick={exportDeck}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white disabled:opacity-40 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" /> Ekspor deck
          </button>
        </div>

        {importOpen && (
          <div className="rounded-xl bg-black/40 border border-white/10 p-3 space-y-2">
            <p className="text-[11px] text-gray-400 leading-relaxed">
              Tempel JSON berisi array soal (atau objek <code className="text-gray-200">{'{ "title": "...", "questions": [...] }'}</code>). Tiap soal:{' '}
              <code className="text-gray-200">question, options[], correctIndex, explanation, category</code>. Isi editor akan diganti; belum tersimpan sampai kamu menekan Simpan.
            </p>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={8} className={`${inputCls} font-mono`} placeholder='[{"question":"…","options":["A","B","C","D"],"correctIndex":0}]' />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!importText.trim()}
                onClick={() => applyImport(importText)}
                className="px-3 py-1.5 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black disabled:opacity-40 cursor-pointer"
              >
                Terapkan
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white cursor-pointer"
              >
                Pilih berkas .json
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={onFile} />
              <button type="button" onClick={() => setImportOpen(false)} className="ml-auto p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer" aria-label="Tutup">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <p className="text-xs text-red-400 font-medium flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {error}
        </p>
      )}
      {notice && (
        <p className="text-xs text-emerald-300 font-medium flex items-start gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {notice}
        </p>
      )}

      <div className="space-y-2">
        {slots.map((q, i) => {
          const blank = isBlank(q);
          const msg = blank ? null : problemOf(q) || (duplicates.has(i) ? 'Pertanyaan kembar dengan soal lain.' : null);
          const open = openIdx === i;
          return (
            <div key={i} className={`rounded-2xl bg-surface border ${msg ? 'border-red-500/40' : 'border-white/10'}`}>
              <button type="button" onClick={() => setOpenIdx(open ? null : i)} className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
                <span
                  className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center text-[11px] font-black ${
                    blank ? 'bg-white/5 text-gray-500' : msg ? 'bg-red-500/20 text-red-300' : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {i + 1}
                </span>
                <span className={`flex-1 min-w-0 text-xs truncate ${blank ? 'text-gray-500 italic' : 'text-white font-medium'}`}>
                  {blank ? 'Slot kosong' : q.question || '(tanpa pertanyaan)'}
                </span>
                {msg && <span className="hidden sm:block text-[10px] text-red-300 truncate max-w-[40%]">{msg}</span>}
                {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              {open && (
                <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
                  <label className="block text-[11px] font-semibold text-gray-300">
                    Pertanyaan
                    <textarea value={q.question} maxLength={500} rows={2} onChange={(e) => update(i, { question: e.target.value })} className={`${inputCls} mt-1`} />
                  </label>

                  <div className="space-y-1.5">
                    <p className="text-[11px] font-semibold text-gray-300">Pilihan jawaban (pilih bulatan untuk jawaban yang benar)</p>
                    {q.options.map((o, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`correct-${i}`}
                          checked={q.correctIndex === oi}
                          onChange={() => update(i, { correctIndex: oi })}
                          className="accent-emerald-400 cursor-pointer"
                          aria-label={`Jawaban benar: pilihan ${oi + 1}`}
                        />
                        <input
                          value={o}
                          maxLength={200}
                          onChange={(e) => update(i, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)) })}
                          className={`${inputCls} ${q.correctIndex === oi ? 'border-emerald-500/50' : ''}`}
                          placeholder={`Pilihan ${String.fromCharCode(65 + oi)}`}
                        />
                        <button
                          type="button"
                          disabled={q.options.length <= MIN_OPTIONS}
                          onClick={() => removeOption(i, oi)}
                          className="p-1.5 rounded-lg text-gray-500 hover:text-red-300 disabled:opacity-30 cursor-pointer"
                          aria-label="Hapus pilihan"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                    {q.options.length < MAX_OPTIONS && (
                      <button type="button" onClick={() => addOption(i)} className="flex items-center gap-1 text-[11px] font-bold text-accent hover:text-accent/80 cursor-pointer">
                        <Plus className="w-3 h-3" /> Tambah pilihan
                      </button>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-3 gap-3">
                    <label className="block text-[11px] font-semibold text-gray-300 sm:col-span-2">
                      Penjelasan (tampil setelah jawaban dibuka)
                      <input value={q.explanation} maxLength={600} onChange={(e) => update(i, { explanation: e.target.value })} className={`${inputCls} mt-1`} />
                    </label>
                    <label className="block text-[11px] font-semibold text-gray-300">
                      Kategori
                      <input value={q.category} maxLength={40} onChange={(e) => update(i, { category: e.target.value })} className={`${inputCls} mt-1`} placeholder="Umum" />
                    </label>
                  </div>

                  {q.extra && (
                    <p className="text-[10px] text-gray-500">Soal ini membawa data tambahan (media / batas waktu) dari impor; tetap disimpan apa adanya.</p>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setSlots((prev) => prev.map((x, xi) => (xi === i ? blankQuestion() : x)));
                      setDirty(true);
                    }}
                    className="flex items-center gap-1 text-[11px] font-bold text-red-300 hover:text-red-200 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" /> Kosongkan slot ini
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="sticky bottom-0 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-black/90 backdrop-blur border-t border-white/10 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save(false)}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white disabled:opacity-50 cursor-pointer"
        >
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Simpan
        </button>
        <button
          type="button"
          disabled={saving || !readyToActivate}
          onClick={() => void save(true)}
          title={readyToActivate ? '' : `Butuh tepat ${ARENA_DECK_SIZE} soal valid dan tanpa soal kembar`}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          <Power className="w-3.5 h-3.5" /> {enabled ? 'Simpan & tetap aktif' : 'Simpan & aktifkan'}
        </button>
        {enabled && (
          <button type="button" disabled={saving} onClick={() => void deactivate()} className="px-3 py-2 rounded-xl text-xs font-bold text-amber-300 hover:bg-amber-500/10 cursor-pointer">
            Nonaktifkan
          </button>
        )}
        <button type="button" disabled={saving} onClick={() => void clearDeck()} className="ml-auto flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-red-300 hover:bg-red-500/10 cursor-pointer">
          <Trash2 className="w-3.5 h-3.5" /> Hapus deck
        </button>
      </div>
    </div>
  );
};

export default ArenaDecksPage;
