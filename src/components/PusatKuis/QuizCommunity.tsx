// src/components/PusatKuis/QuizCommunity.tsx
// Segmen "Komunitas Kuis": semua orang bisa menelusuri & memainkan kuis yang dibagikan pengguna lain.
// Hanya akun yang sudah membuka fitur Kuis Editor yang bisa membagikan kuis buatannya (dicek server).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  Play,
  Users,
  Share2,
  Lock,
  Trash2,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Globe,
  PencilLine,
  ListOrdered,
  Flame,
  Clock,
} from 'lucide-react';
import type { Deck } from '../../types';
import {
  ApiError,
  countSharedQuizPlay,
  fetchMySharing,
  fetchSharedQuiz,
  fetchSharedQuizzes,
  formatRelativeId,
  shareQuiz,
  sharedQuizToDeck,
  unshareQuiz,
  type MySharingState,
  type SharedQuizSummary,
} from '../../services/quizCommunityApi';
import { PlayerAvatar } from './PlayerAvatar';

interface QuizCommunityProps {
  isLoggedIn: boolean;
  /** Kuis buatan Kuis Editor milik akun ini (kandidat untuk dibagikan). */
  ownDecks: Deck[];
  onPlay: (deck: Deck) => void;
  onOpenLibrary: () => void;
  onToast?: (msg: string) => void;
}

const PAGE_SIZE = 12;
const MIN_SCORED = 5;

const DIFF_CLASS: Record<string, string> = {
  Mudah: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  Biasa: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  Sedang: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  Sulit: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  Ekstrem: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export const QuizCommunity: React.FC<QuizCommunityProps> = ({ isLoggedIn, ownDecks, onPlay, onOpenLibrary, onToast }) => {
  /* ───── Telusuri ───── */
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'newest' | 'popular'>('newest');
  const [items, setItems] = useState<SharedQuizSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const reqId = useRef(0);

  // Tunda pencarian 350 ms setelah pengguna berhenti mengetik.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search.trim()), 350);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadFirst = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError('');
    try {
      const res = await fetchSharedQuizzes({ q: query, sort, limit: PAGE_SIZE, offset: 0 });
      if (id !== reqId.current) return;
      setItems(res.items);
      setTotal(res.total);
    } catch (e: any) {
      if (id !== reqId.current) return;
      setError(e?.message || 'Gagal memuat kuis komunitas.');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [query, sort]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const loadMore = async () => {
    const id = reqId.current;
    setLoadingMore(true);
    try {
      const res = await fetchSharedQuizzes({ q: query, sort, limit: PAGE_SIZE, offset: items.length });
      if (id !== reqId.current) return;
      const known = new Set(items.map((p) => p.id));
      const fresh = res.items.filter((r) => !known.has(r.id));
      if (fresh.length === 0) {
        // Tidak ada kuis baru (daftar bergeser / sudah habis): hentikan tombol agar tidak memuat berulang tanpa hasil.
        setTotal(items.length);
        return;
      }
      setItems((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...fresh.filter((r) => !seen.has(r.id))];
      });
      setTotal(res.total);
    } catch (e: any) {
      onToast?.(e?.message || 'Gagal memuat lebih banyak.');
    } finally {
      setLoadingMore(false);
    }
  };

  const handlePlay = async (s: SharedQuizSummary) => {
    if (playingId) return;
    setPlayingId(s.id);
    try {
      const full = await fetchSharedQuiz(s.id);
      if (!full.questions?.length) throw new ApiError('Kuis ini belum punya soal.', 422);
      void countSharedQuizPlay(s.id);
      onPlay(sharedQuizToDeck(full));
    } catch (e: any) {
      onToast?.(e?.status === 404 ? 'Kuis ini sudah tidak tersedia.' : e?.message || 'Gagal memuat kuis.');
      if (e?.status === 404) void loadFirst();
    } finally {
      setPlayingId(null);
    }
  };

  /* ───── Bagikan kuis sendiri ───── */
  const [sharing, setSharing] = useState<MySharingState | null>(null);
  const [sharingError, setSharingError] = useState('');
  const [sharingLoading, setSharingLoading] = useState(false);
  const [busyDeckId, setBusyDeckId] = useState<string | null>(null);

  const loadSharing = useCallback(async () => {
    if (!isLoggedIn) {
      setSharing(null);
      return;
    }
    setSharingLoading(true);
    setSharingError('');
    try {
      setSharing(await fetchMySharing());
    } catch (e: any) {
      setSharingError(e?.message || 'Gagal memeriksa akses berbagi kuis.');
    } finally {
      setSharingLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    void loadSharing();
  }, [loadSharing]);

  const sharedBySource = useMemo(() => new Map((sharing?.items || []).map((s) => [s.sourceDeckId, s])), [sharing]);

  const handleShare = async (deck: Deck) => {
    const already = sharedBySource.has(deck.id);
    if (!already && !confirm(`Bagikan "${deck.title}" ke Komunitas Kuis?\n\nSoal, pilihan jawaban, dan kunci jawabannya akan bisa dilihat dan dimainkan siapa saja. Namamu tampil sebagai pembuat.`)) return;
    setBusyDeckId(deck.id);
    try {
      const r = await shareQuiz(deck);
      onToast?.(r.updated ? `"${deck.title}" diperbarui di Komunitas Kuis.` : `"${deck.title}" berhasil dibagikan ke Komunitas Kuis!`);
      await Promise.all([loadSharing(), loadFirst()]);
    } catch (e: any) {
      onToast?.(e?.message || 'Gagal membagikan kuis.');
      if (e?.status === 403) void loadSharing();
    } finally {
      setBusyDeckId(null);
    }
  };

  const handleUnshare = async (deck: Deck, sharedId: string) => {
    if (!confirm(`Hapus "${deck.title}" dari Komunitas Kuis?\n\nKuis tidak akan bisa dimainkan orang lain lagi. Kuis aslimu di Perpustakaan tetap aman.`)) return;
    setBusyDeckId(deck.id);
    try {
      await unshareQuiz(sharedId);
      onToast?.(`"${deck.title}" dihapus dari Komunitas Kuis.`);
      await Promise.all([loadSharing(), loadFirst()]);
    } catch (e: any) {
      onToast?.(e?.message || 'Gagal menghapus kuis dari komunitas.');
    } finally {
      setBusyDeckId(null);
    }
  };

  const hasMore = items.length < total;

  return (
    <section className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-200">
      {/* ───── KOLOM KIRI: TELUSURI & MAINKAN ───── */}
      <div className="lg:col-span-2 space-y-5">
        <div className="rounded-3xl bg-surface border border-white/10 p-5 sm:p-6 shadow-2xl space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <label className="relative flex-1">
              <span className="sr-only">Cari kuis komunitas</span>
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={80}
                placeholder="Cari judul, deskripsi, atau nama pembuat…"
                className="w-full bg-black/60 border border-white/15 focus:border-accent2 rounded-xl pl-10 pr-3 py-2.5 text-xs text-white outline-none"
              />
            </label>
            <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/50 border border-white/10 shrink-0" role="group" aria-label="Urutkan">
              {([
                { k: 'newest', label: 'Terbaru', icon: Clock },
                { k: 'popular', label: 'Terpopuler', icon: Flame },
              ] as const).map((o) => (
                <button
                  key={o.k}
                  type="button"
                  onClick={() => setSort(o.k)}
                  aria-pressed={sort === o.k}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-black flex items-center justify-center gap-1.5 cursor-pointer transition-all ${
                    sort === o.k ? 'bg-accent2 text-on-accent2' : 'text-gray-300 hover:bg-white/10'
                  }`}
                >
                  <o.icon className="w-3.5 h-3.5" />
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <Globe className="w-3.5 h-3.5 text-accent2" />
              {loading ? 'Memuat…' : `${total.toLocaleString('id-ID')} kuis dari komunitas${query ? ` untuk "${query}"` : ''}`}
            </span>
            <button
              type="button"
              onClick={() => void loadFirst()}
              disabled={loading}
              className="flex items-center gap-1 hover:text-white cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
            </button>
          </div>

          {loading && items.length === 0 ? (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className="h-40 rounded-2xl bg-white/[0.04] animate-pulse" />
              ))}
            </ul>
          ) : error && items.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
              <p className="text-sm text-gray-200">{error}</p>
              <button type="button" onClick={() => void loadFirst()} className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold cursor-pointer">
                Coba Lagi
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-10 text-center space-y-2">
              <Users className="w-10 h-10 text-gray-500 mx-auto" />
              <p className="text-sm font-bold text-white">{query ? 'Tidak ada kuis yang cocok.' : 'Belum ada kuis yang dibagikan.'}</p>
              <p className="text-xs text-gray-400">
                {query ? 'Coba kata kunci lain.' : 'Pemilik Kuis Editor bisa jadi yang pertama membagikan kuisnya di sini.'}
              </p>
            </div>
          ) : (
            <>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {items.map((s) => (
                  <li key={s.id} className="p-4 rounded-2xl bg-black/45 border border-white/10 hover:border-accent2/50 transition-colors flex flex-col gap-3">
                    <div className="space-y-1.5 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-black text-white leading-snug line-clamp-2">{s.title}</h3>
                        <span className={`shrink-0 text-[9px] font-mono font-black uppercase px-1.5 py-0.5 rounded-md border ${DIFF_CLASS[s.difficulty] || 'bg-white/10 text-gray-300 border-white/15'}`}>
                          {s.difficulty}
                        </span>
                      </div>
                      <p className="text-[11px] text-gray-400 leading-relaxed line-clamp-2 min-h-[2.2rem]">{s.description || 'Tanpa deskripsi.'}</p>
                    </div>

                    <div className="flex items-center gap-3 text-[11px] text-gray-400 font-mono">
                      <span className="flex items-center gap-1"><ListOrdered className="w-3 h-3" />{s.questionCount} soal</span>
                      <span className="flex items-center gap-1"><Users className="w-3 h-3" />{s.playCount.toLocaleString('id-ID')} main</span>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 mt-auto">
                      <div className="flex items-center gap-2 min-w-0">
                        <PlayerAvatar name={s.ownerName} avatarUrl={s.ownerAvatarUrl} frameId={s.ownerFrameId} size="sm" />
                        <div className="min-w-0 leading-tight">
                          <span className="text-[11px] font-bold text-white truncate block">{s.ownerName}</span>
                          <span className="text-[10px] text-gray-500">{formatRelativeId(s.updatedAt)}</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handlePlay(s)}
                        disabled={playingId !== null}
                        className="shrink-0 px-3.5 py-1.5 rounded-lg bg-accent2 hover:bg-accent2/80 disabled:opacity-60 text-on-accent2 text-[11px] font-black cursor-pointer active:scale-95 transition-all flex items-center gap-1.5"
                      >
                        {playingId === s.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        Mainkan
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {hasMore && (
                <div className="text-center pt-1">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
                  >
                    {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Muat lebih banyak
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ───── KOLOM KANAN: BAGIKAN KUISMU ───── */}
      <aside className="space-y-4">
        <div className="rounded-3xl bg-surface border border-white/10 p-5 shadow-2xl space-y-4">
          <div>
            <h2 className="text-base font-black text-white flex items-center gap-2">
              <Share2 className="w-4 h-4 text-accent2" /> Bagikan Kuismu
            </h2>
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
              Kuis buatanmu dari Kuis Editor bisa dimainkan semua orang. Perubahan di kuis asli baru tampil di komunitas setelah kamu menekan <em>Perbarui</em>.
            </p>
          </div>

          {!isLoggedIn ? (
            <div className="p-3.5 rounded-2xl bg-black/50 border border-white/10 text-xs text-gray-300 flex items-start gap-2.5">
              <Lock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
              <span>Masuk ke akunmu dulu untuk membagikan kuis. Menelusuri dan memainkan kuis komunitas tetap terbuka untuk semua.</span>
            </div>
          ) : sharingLoading && !sharing ? (
            <div className="h-24 rounded-2xl bg-white/[0.04] animate-pulse" aria-busy="true" />
          ) : sharingError && !sharing ? (
            <div className="space-y-2 text-xs text-gray-200">
              <p className="flex items-start gap-2"><AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />{sharingError}</p>
              <button type="button" onClick={() => void loadSharing()} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold cursor-pointer">
                Coba Lagi
              </button>
            </div>
          ) : sharing && !sharing.canShare ? (
            <div className="p-4 rounded-2xl bg-black/50 border border-white/10 space-y-3">
              <p className="text-xs text-gray-200 flex items-start gap-2.5 leading-relaxed">
                <Lock className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                <span>Berbagi kuis khusus untuk pengguna yang sudah membuka fitur <strong className="text-white">Kuis Editor</strong>.</span>
              </p>
              <button
                type="button"
                onClick={onOpenLibrary}
                className="w-full px-4 py-2 rounded-xl bg-accent hover:bg-accent/80 text-on-accent text-xs font-black cursor-pointer active:scale-95 transition-all"
              >
                Buka Kuis Editor di Perpustakaan
              </button>
            </div>
          ) : sharing ? (
            ownDecks.length === 0 ? (
              <div className="p-4 rounded-2xl bg-black/50 border border-white/10 space-y-3">
                <p className="text-xs text-gray-300 flex items-start gap-2.5 leading-relaxed">
                  <PencilLine className="w-4 h-4 text-accent2 shrink-0 mt-0.5" />
                  <span>Kamu belum punya kuis buatan sendiri. Buat dulu lewat Kuis Editor, lalu bagikan di sini.</span>
                </p>
                <button type="button" onClick={onOpenLibrary} className="w-full px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold cursor-pointer">
                  Buka Perpustakaan Kuis
                </button>
              </div>
            ) : (
              <>
                <ul className="space-y-2">
                  {ownDecks.map((d) => {
                    const shared = sharedBySource.get(d.id);
                    const busy = busyDeckId === d.id;
                    const qCount = d.questions?.length || 0;
                    return (
                      <li key={d.id} className="p-3 rounded-2xl bg-black/45 border border-white/10 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-black text-white truncate">{d.title}</p>
                            <p className="text-[10px] text-gray-400 font-mono">
                              {qCount} soal{shared ? ` • ${shared.playCount.toLocaleString('id-ID')} main` : ''}
                            </p>
                          </div>
                          {shared && (
                            <span className="shrink-0 text-[9px] font-mono font-black uppercase px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                              Dibagikan
                            </span>
                          )}
                        </div>

                        {qCount < MIN_SCORED && (
                          <p className="text-[10px] text-amber-300/90 leading-snug">
                            Kurang dari {MIN_SCORED} soal: tetap bisa dimainkan, tapi skornya tidak masuk papan peringkat.
                          </p>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleShare(d)}
                            disabled={busy || qCount === 0}
                            className="flex-1 px-3 py-1.5 rounded-lg bg-accent2 hover:bg-accent2/80 disabled:opacity-50 disabled:cursor-not-allowed text-on-accent2 text-[11px] font-black cursor-pointer active:scale-95 transition-all flex items-center justify-center gap-1.5"
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
                            {shared ? 'Perbarui' : 'Bagikan'}
                          </button>
                          {shared && (
                            <button
                              type="button"
                              onClick={() => void handleUnshare(d, shared.id)}
                              disabled={busy}
                              aria-label={`Hapus ${d.title} dari komunitas`}
                              title="Hapus dari komunitas"
                              className="w-8 h-8 shrink-0 rounded-lg bg-red-500/15 hover:bg-red-500/30 text-red-300 border border-red-500/25 flex items-center justify-center cursor-pointer disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-[10px] text-gray-500 font-mono">
                  {sharing.items.length}/{sharing.limit} slot berbagi terpakai
                </p>
              </>
            )
          ) : null}
        </div>
      </aside>
    </section>
  );
};
