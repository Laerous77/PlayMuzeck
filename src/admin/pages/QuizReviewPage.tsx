// src/admin/pages/QuizReviewPage.tsx
//
// Antrean tinjauan Kuis Komunitas. Kuis yang tidak bisa disetujui otomatis (tanpa API key AI, AI ragu, ada gambar yang belum
// terperiksa, audio/video, atau dilaporkan pengguna) menunggu di sini sampai admin menyetujui / menolaknya.
// Memakai endpoint /api/admin/shared-quizzes* (server/quizCommunityRoutes.ts).
import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, XCircle, RefreshCw, Loader2, Trash2, ScanSearch, ChevronDown, ChevronUp, Flag } from 'lucide-react';
import { AdminSessionError, adminFetch } from '../adminApi';

type Status = 'pending' | 'approved' | 'rejected';

interface AdminQuizItem {
  id: string;
  title: string;
  description: string;
  difficulty: string;
  questionCount: number;
  playCount: number;
  ownerEmail: string;
  ownerName: string;
  updatedAt: string;
  moderationStatus: Status;
  moderationReason: string;
  moderationSource: string;
  moderatedBy: string | null;
  reportCount: number;
  scan: {
    verdict: string;
    risk: number;
    flagCount: number;
    highFlags: number;
    unverifiedMedia: number;
    ai: Array<{ provider: string; ran: boolean; verdict: string | null; summary: string; error: string }>;
  } | null;
}

interface ListResponse {
  items: AdminQuizItem[];
  total: number;
  counts: Record<Status, number>;
  ai: { anthropic: boolean; openai: boolean; autoApprove: string };
}

interface QuizDetail extends AdminQuizItem {
  questions: Array<{ question?: string; options?: string[]; correctIndex?: number; explanation?: string; mediaUrl?: string; mediaType?: string }>;
  scanReport: { flags?: Array<{ severity: string; code?: string; where?: string; detail?: string }> } | null;
  reports: Array<{ reason: string; createdAt: string }>;
}

const TABS: Array<{ id: Status; label: string }> = [
  { id: 'pending', label: 'Menunggu' },
  { id: 'approved', label: 'Disetujui' },
  { id: 'rejected', label: 'Ditolak' },
];

const fmt = (iso: string) => {
  try {
    return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return iso;
  }
};

export const QuizReviewPage: React.FC = () => {
  const [tab, setTab] = useState<Status>('pending');
  const [search, setSearch] = useState('');
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<QuizDetail | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ status: tab, limit: '30' });
      if (search.trim()) qs.set('q', search.trim());
      setData(await adminFetch<ListResponse>(`/api/admin/shared-quizzes?${qs.toString()}`));
      setError('');
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Gagal memuat antrean kuis.');
    } finally {
      setLoading(false);
    }
  }, [tab, search]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      setDetail(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await adminFetch<QuizDetail>(`/api/admin/shared-quizzes/${encodeURIComponent(id)}`));
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Gagal memuat isi kuis.');
    }
  };

  const act = async (id: string, label: string, run: () => Promise<unknown>) => {
    setBusy(id);
    setError('');
    setNotice('');
    try {
      await run();
      setNotice(label);
      setOpenId(null);
      setDetail(null);
      setRejectFor(null);
      setRejectReason('');
      await load();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Aksi gagal.');
    } finally {
      setBusy(null);
    }
  };

  const review = (id: string, decision: 'approve' | 'reject', reason?: string) =>
    act(id, decision === 'approve' ? 'Kuis disetujui.' : 'Kuis ditolak; pemilik diberi tahu.', () =>
      adminFetch(`/api/admin/shared-quizzes/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ decision, reason }) })
    );
  const rescan = (id: string) =>
    act(id, 'Pemeriksaan ulang selesai.', () => adminFetch(`/api/admin/shared-quizzes/${encodeURIComponent(id)}/rescan`, { method: 'POST', body: '{}' }));
  const remove = (id: string) => {
    if (!window.confirm('Hapus kuis ini permanen? Skor peringkat yang berasal darinya ikut terhapus.')) return;
    void act(id, 'Kuis dihapus.', () => adminFetch(`/api/admin/shared-quizzes/${encodeURIComponent(id)}`, { method: 'DELETE' }));
  };

  return (
    <div className="space-y-4 max-w-4xl">
      <section className="rounded-2xl bg-surface border border-white/10 p-5 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-bold text-white">Tinjau Kuis Komunitas</h3>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="flex items-center gap-1 text-xs text-gray-300 hover:text-white px-2 py-1 rounded-lg border border-white/10 disabled:opacity-60"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} /> Muat ulang
          </button>
        </div>

        {data && (
          <p className="text-xs text-gray-400">
            Pemeriksaan AI:{' '}
            {data.ai.anthropic || data.ai.openai ? (
              <span className="text-emerald-400 font-medium">
                aktif ({[data.ai.anthropic && 'Claude', data.ai.openai && 'OpenAI Moderation'].filter(Boolean).join(' + ')})
              </span>
            ) : (
              <span className="text-amber-400 font-medium">belum aktif — pasang OPENAI_API_KEY atau ANTHROPIC_API_KEY; semua kuis menunggu admin</span>
            )}
            {' · '}Setujui otomatis: <span className="text-gray-200">{data.ai.autoApprove === 'off' ? 'mati' : 'jika AI menyatakan aman'}</span>
          </p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                setOpenId(null);
                setDetail(null);
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                tab === t.id ? 'bg-accent text-on-accent border-accent' : 'bg-black/30 text-gray-300 border-white/10 hover:text-white'
              }`}
            >
              {t.label} {data ? `(${data.counts[t.id] ?? 0})` : ''}
            </button>
          ))}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari judul / email pemilik"
            className="ml-auto min-w-[10rem] flex-1 sm:flex-none sm:w-60 p-2 rounded-lg bg-black/40 border border-white/10 text-white text-xs focus:border-accent focus:outline-none"
          />
        </div>

        {error && <p className="text-xs text-red-400 font-medium">{error}</p>}
        {notice && <p className="text-xs text-emerald-400 font-medium">{notice}</p>}

        {loading && !data ? (
          <p className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat...</p>
        ) : data && data.items.length === 0 ? (
          <p className="text-xs text-gray-500 text-center py-6 border border-dashed border-white/10 rounded-xl">Tidak ada kuis di daftar ini.</p>
        ) : (
          <ul className="space-y-2">
            {data?.items.map((q) => {
              const open = openId === q.id;
              const working = busy === q.id;
              return (
                <li key={q.id} className="rounded-xl border border-white/10 bg-black/30">
                  <button type="button" onClick={() => toggle(q.id)} className="w-full text-left p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-white truncate">{q.title}</p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {q.ownerName || q.ownerEmail} · {q.ownerEmail} · {q.questionCount} soal · {fmt(q.updatedAt)}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap mt-1">
                        {q.scan && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-gray-300">
                            aturan: {q.scan.verdict} · {q.scan.flagCount} temuan{q.scan.highFlags ? ` (${q.scan.highFlags} berat)` : ''}
                          </span>
                        )}
                        {q.scan?.ai.map((a) => (
                          <span key={a.provider} className={`text-[10px] px-1.5 py-0.5 rounded ${a.ran ? 'bg-emerald-500/15 text-emerald-300' : 'bg-white/10 text-gray-400'}`}>
                            {a.provider}: {a.ran ? a.verdict ?? 'selesai' : a.error || 'tidak jalan'}
                          </span>
                        ))}
                        {q.scan && q.scan.unverifiedMedia > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300">{q.scan.unverifiedMedia} media belum diperiksa</span>
                        )}
                        {q.reportCount > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 inline-flex items-center gap-1">
                            <Flag className="w-2.5 h-2.5" /> {q.reportCount} laporan
                          </span>
                        )}
                      </div>
                      {q.moderationReason && <p className="text-[11px] text-gray-500 mt-1">{q.moderationReason}</p>}
                    </div>
                    {open ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                  </button>

                  {open && (
                    <div className="border-t border-white/10 p-3 space-y-3">
                      {!detail ? (
                        <p className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Memuat isi kuis...</p>
                      ) : (
                        <>
                          {detail.description && <p className="text-xs text-gray-300">{detail.description}</p>}
                          {detail.reports.length > 0 && (
                            <div className="text-[11px] text-red-300 space-y-0.5">
                              {detail.reports.map((r, i) => (
                                <p key={i}>• Laporan ({fmt(r.createdAt)}): {r.reason || '(tanpa alasan)'}</p>
                              ))}
                            </div>
                          )}
                          {detail.scanReport?.flags && detail.scanReport.flags.length > 0 && (
                            <div className="text-[11px] text-amber-300 space-y-0.5">
                              {detail.scanReport.flags.slice(0, 20).map((f, i) => (
                                <p key={i}>• [{f.severity}] {f.detail || f.code || ''} {f.where ? `(${f.where})` : ''}</p>
                              ))}
                            </div>
                          )}
                          <ol className="space-y-2 max-h-80 overflow-y-auto pr-1">
                            {detail.questions.map((qq, i) => (
                              <li key={i} className="text-xs text-gray-200">
                                <p className="font-bold">{i + 1}. {qq.question}</p>
                                {qq.mediaUrl && <p className="text-[10px] text-gray-500 break-all">media ({qq.mediaType}): {qq.mediaUrl}</p>}
                                <ul className="ml-4 mt-0.5">
                                  {(qq.options || []).map((o, j) => (
                                    <li key={j} className={j === qq.correctIndex ? 'text-emerald-300 font-bold' : 'text-gray-400'}>
                                      {String.fromCharCode(65 + j)}. {o}{j === qq.correctIndex ? '  ✓' : ''}
                                    </li>
                                  ))}
                                </ul>
                                {qq.explanation && <p className="ml-4 text-[11px] text-gray-500">Penjelasan: {qq.explanation}</p>}
                              </li>
                            ))}
                          </ol>
                        </>
                      )}

                      {rejectFor === q.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Alasan penolakan (dikirim ke pemilik agar bisa memperbaiki)"
                            maxLength={400}
                            rows={2}
                            className="w-full p-2 rounded-lg bg-black/40 border border-white/10 text-white text-xs focus:border-accent focus:outline-none"
                          />
                          <div className="flex gap-2">
                            <button type="button" disabled={working || !rejectReason.trim()} onClick={() => review(q.id, 'reject', rejectReason.trim())} className="px-3 py-1.5 rounded-lg bg-red-500/80 hover:bg-red-500 text-white text-xs font-bold disabled:opacity-50">
                              Kirim Penolakan
                            </button>
                            <button type="button" onClick={() => setRejectFor(null)} className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 text-xs">Batal</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                          {q.moderationStatus !== 'approved' && (
                            <button type="button" disabled={working} onClick={() => review(q.id, 'approve')} className="px-3 py-1.5 rounded-lg bg-emerald-500/80 hover:bg-emerald-500 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                              {working ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Setujui
                            </button>
                          )}
                          {q.moderationStatus !== 'rejected' && (
                            <button type="button" disabled={working} onClick={() => { setRejectFor(q.id); setRejectReason(''); }} className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-200 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                              <XCircle className="w-3.5 h-3.5" /> Tolak
                            </button>
                          )}
                          {q.moderationStatus === 'pending' && (
                            <button type="button" disabled={working} onClick={() => rescan(q.id)} className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-300 hover:text-white text-xs inline-flex items-center gap-1 disabled:opacity-50">
                              <ScanSearch className="w-3.5 h-3.5" /> Pindai ulang
                            </button>
                          )}
                          <button type="button" disabled={working} onClick={() => remove(q.id)} className="ml-auto p-1.5 rounded-lg text-red-300 hover:bg-red-500/10 disabled:opacity-50" title="Hapus permanen">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
};
