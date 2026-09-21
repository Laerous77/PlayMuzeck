// src/components/PusatKuis/QuizResultHistory.tsx
// Riwayat hasil permainan + tinjauan jawaban per soal (soal, semua pilihan,
// pilihan pengguna, dan jawaban benar).
import React, { useMemo, useState } from 'react';
import {
  History,
  X,
  Trash2,
  Save,
  ChevronLeft,
  CheckCircle,
  XCircle,
  Clock,
  Download,
  Mic,
  ListChecks,
} from 'lucide-react';
import {
  AnswerLogEntry,
  SavedQuizResult,
  clearSavedResults,
  deleteSavedResult,
  downloadResultsJson,
  loadSavedResults,
  summarizeAnswers,
} from '../../services/quizResultsStore';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];

const modeLabel = (m: SavedQuizResult['mode']) =>
  m === 'solo' ? 'Solo' : m === 'pass_play' ? 'Pass & Play' : 'Host';

const MediaPreview: React.FC<{ a: AnswerLogEntry }> = ({ a }) => {
  if (!a.mediaType) return null;
  if (!a.mediaUrl) {
    return (
      <p className="text-[10px] text-gray-500 italic">
        (Soal ini memiliki lampiran {a.mediaType === 'image' ? 'gambar' : a.mediaType === 'audio' ? 'audio' : 'video'} yang tidak disimpan di riwayat)
      </p>
    );
  }
  return (
    <div className="rounded-lg overflow-hidden border border-white/[0.08] bg-black/40 flex flex-col items-center justify-center">
      {a.mediaType === 'image' && <img src={a.mediaUrl} alt="Lampiran soal" className="max-h-40 w-full object-contain" />}
      {a.mediaType === 'audio' && <audio src={a.mediaUrl} controls className="w-full h-10 p-1.5" />}
      {a.mediaType === 'video' && <video src={a.mediaUrl} controls className="max-h-48 w-full" />}
      {a.mediaCredit && <span className="text-[9px] text-gray-500 px-2 py-1 text-center">{a.mediaCredit}</span>}
    </div>
  );
};

/** Daftar tinjauan jawaban: dipakai di riwayat dan di layar hasil akhir. */
export const AnswerReviewList: React.FC<{ answers: AnswerLogEntry[] }> = ({ answers }) => (
  <div className="space-y-3">
    {answers.map((a, idx) => {
      const isHost = a.selectedIndex === null;
      const status = isHost ? 'host' : a.selectedIndex === -1 ? 'timeout' : a.isCorrect ? 'correct' : 'wrong';
      return (
        <div
          key={`${a.questionId}-${a.playerName || ''}-${idx}`}
          className={`p-3.5 rounded-2xl border space-y-2.5 ${
            status === 'correct'
              ? 'bg-emerald-950/20 border-emerald-500/30'
              : status === 'host'
              ? 'bg-black/40 border-white/10'
              : 'bg-red-950/20 border-red-500/30'
          }`}
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] font-mono font-bold text-gray-300 bg-white/10 px-2 py-0.5 rounded-full">
                Soal {a.number}
              </span>
              {a.playerName && (
                <span className="text-[10px] font-bold text-blue-200 bg-blue-500/15 border border-blue-500/30 px-2 py-0.5 rounded-full">
                  {a.playerName}
                </span>
              )}
              {a.category && <span className="text-[10px] text-gray-400">{a.category}</span>}
            </div>
            <span
              className={`flex items-center gap-1 text-[10px] font-black px-2 py-0.5 rounded-full ${
                status === 'correct'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : status === 'host'
                  ? 'bg-purple-500/20 text-purple-300'
                  : 'bg-red-500/20 text-red-300'
              }`}
            >
              {status === 'correct' && <><CheckCircle className="w-3 h-3" /> Benar</>}
              {status === 'wrong' && <><XCircle className="w-3 h-3" /> Salah</>}
              {status === 'timeout' && <><Clock className="w-3 h-3" /> Waktu habis</>}
              {status === 'host' && <><Mic className="w-3 h-3" /> Dinilai host</>}
            </span>
          </div>

          <p className="text-sm font-bold text-white leading-relaxed">{a.question}</p>
          <MediaPreview a={a} />

          <div className="space-y-1.5">
            {a.options.map((opt, oi) => {
              const isCorrect = oi === a.correctIndex;
              const isChosen = oi === a.selectedIndex;
              const cls = isCorrect
                ? 'bg-emerald-950/40 border-emerald-500/60 text-emerald-100'
                : isChosen
                ? 'bg-red-950/40 border-red-500/60 text-red-100'
                : 'bg-black/30 border-white/[0.06] text-gray-300';
              return (
                <div key={oi} className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-xs ${cls}`}>
                  <span
                    className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                      isCorrect ? 'bg-emerald-500 text-black' : isChosen ? 'bg-red-500 text-white' : 'bg-[#14213D] text-gray-300'
                    }`}
                  >
                    {LETTERS[oi] || oi + 1}
                  </span>
                  <span className="flex-1">{opt}</span>
                  {isChosen && (
                    <span className="text-[10px] font-bold shrink-0">
                      {isCorrect ? 'Pilihanmu ✓' : 'Pilihanmu'}
                    </span>
                  )}
                  {isCorrect && !isChosen && <span className="text-[10px] font-bold shrink-0">Jawaban benar</span>}
                </div>
              );
            })}
          </div>

          {status === 'timeout' && (
            <p className="text-[11px] text-red-300">Tidak ada jawaban dipilih karena waktu habis.</p>
          )}
          {status === 'host' && (
            <p className="text-[11px] text-gray-400">Mode Host: jawaban dilontarkan lisan oleh regu, kunci ditandai hijau.</p>
          )}
          {a.explanation && <p className="text-[11px] text-gray-400 leading-relaxed">💡 {a.explanation}</p>}
        </div>
      );
    })}
  </div>
);

const StatsBar: React.FC<{ answers: AnswerLogEntry[] }> = ({ answers }) => {
  const s = summarizeAnswers(answers);
  if (s.total === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 text-center">
      <div className="p-2 rounded-xl bg-emerald-950/30 border border-emerald-500/30">
        <span className="text-lg font-black text-emerald-300 font-mono">{s.correct}</span>
        <span className="block text-[10px] text-gray-400">Benar</span>
      </div>
      <div className="p-2 rounded-xl bg-red-950/30 border border-red-500/30">
        <span className="text-lg font-black text-red-300 font-mono">{s.wrong}</span>
        <span className="block text-[10px] text-gray-400">Salah</span>
      </div>
      <div className="p-2 rounded-xl bg-black/40 border border-white/10">
        <span className="text-lg font-black text-gray-200 font-mono">{s.timedOut}</span>
        <span className="block text-[10px] text-gray-400">Waktu habis</span>
      </div>
    </div>
  );
};

/** Modal tinjauan jawaban untuk sesi yang baru selesai (belum tentu disimpan). */
export const AnswerReviewModal: React.FC<{ title: string; answers: AnswerLogEntry[]; onClose: () => void }> = ({
  title,
  answers,
  onClose,
}) => (
  <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
    <div className="w-full max-w-lg max-h-[85vh] bg-[#14213D] border border-white/15 rounded-3xl p-5 shadow-2xl flex flex-col space-y-3">
      <div className="flex items-center justify-between border-b border-white/10 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks className="w-5 h-5 text-[#FC1212] shrink-0" />
          <h3 className="text-base font-black text-white truncate">Tinjau Jawaban — {title}</h3>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer">
          <X className="w-5 h-5" />
        </button>
      </div>
      <StatsBar answers={answers} />
      <div className="flex-1 overflow-y-auto pr-1">
        <AnswerReviewList answers={answers} />
      </div>
    </div>
  </div>
);

export const QuizResultHistory: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [results, setResults] = useState<SavedQuizResult[]>(() => loadSavedResults());
  const [selected, setSelected] = useState<SavedQuizResult | null>(null);
  const [playerFilter, setPlayerFilter] = useState<string>('all');

  const players = useMemo(() => {
    const set = new Set<string>();
    selected?.answers?.forEach((a) => a.playerName && set.add(a.playerName));
    return Array.from(set);
  }, [selected]);

  const visibleAnswers = useMemo(() => {
    const list = selected?.answers || [];
    return playerFilter === 'all' ? list : list.filter((a) => a.playerName === playerFilter);
  }, [selected, playerFilter]);

  const openDetail = (r: SavedQuizResult) => {
    setPlayerFilter('all');
    setSelected(r);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[85vh] bg-[#14213D] border border-white/15 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col space-y-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-3 gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {selected ? (
              <button
                onClick={() => setSelected(null)}
                className="p-1.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 cursor-pointer shrink-0"
                title="Kembali ke daftar"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            ) : (
              <History className="w-5 h-5 text-[#FC1212] shrink-0" />
            )}
            <div className="min-w-0">
              <h3 className="text-base font-black text-white truncate">
                {selected ? selected.deckTitle : 'Riwayat Hasil Permainan'}
              </h3>
              <p className="text-[11px] text-gray-400 truncate">
                {selected
                  ? `${modeLabel(selected.mode)} • ${new Date(selected.savedAt).toLocaleString('id-ID')}`
                  : `${results.length} hasil tersimpan di perangkat ini`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-white cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {selected ? (
          <div className="flex-1 overflow-y-auto pr-1 space-y-3">
            <p className="text-xs text-gray-300">{selected.summary}</p>

            {selected.answers && selected.answers.length > 0 ? (
              <>
                <StatsBar answers={visibleAnswers} />
                {players.length > 1 && (
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {['all', ...players].map((p) => (
                      <button
                        key={p}
                        onClick={() => setPlayerFilter(p)}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${
                          playerFilter === p ? 'bg-[#FC1212] text-white' : 'bg-black/40 text-gray-400 hover:text-white'
                        }`}
                      >
                        {p === 'all' ? 'Semua pemain' : p}
                      </button>
                    ))}
                  </div>
                )}
                <AnswerReviewList answers={visibleAnswers} />
              </>
            ) : (
              <div className="text-center py-8 space-y-2">
                <ListChecks className="w-8 h-8 text-gray-500 mx-auto" />
                <p className="text-xs text-gray-400">
                  Hasil ini disimpan sebelum fitur rincian jawaban tersedia, jadi hanya ringkasan skor yang ada.
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
              {results.length === 0 ? (
                <div className="text-center py-10 space-y-2">
                  <Save className="w-8 h-8 text-gray-500 mx-auto" />
                  <p className="text-xs text-gray-400">Belum ada hasil permainan yang disimpan.</p>
                </div>
              ) : (
                results.map((r) => {
                  const s = r.answers ? summarizeAnswers(r.answers) : null;
                  return (
                    <div
                      key={r.id}
                      className="p-3.5 rounded-2xl bg-black/40 border border-white/5 flex items-start justify-between gap-3"
                    >
                      <button onClick={() => openDetail(r)} className="min-w-0 space-y-1 text-left flex-1 cursor-pointer">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-black text-white truncate">{r.deckTitle}</span>
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold bg-white/10 text-gray-300 border border-white/10">
                            {modeLabel(r.mode)}
                          </span>
                        </div>
                        <p className="text-[11px] text-gray-300">{r.summary}</p>
                        <p className="text-[10px] text-gray-500 font-mono">
                          {new Date(r.savedAt).toLocaleString('id-ID')}
                          {s && s.total > 0 ? ` • ${s.correct} benar / ${s.total} jawaban` : ''}
                        </p>
                        <span className="text-[10px] font-bold text-[#FC1212]">
                          {r.answers?.length ? 'Lihat jawaban →' : 'Lihat ringkasan →'}
                        </span>
                      </button>
                      <button
                        onClick={() => setResults(deleteSavedResult(r.id))}
                        title="Hapus hasil ini"
                        className="p-2 rounded-xl bg-white/5 hover:bg-red-500/20 text-red-400 transition-colors cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {results.length > 0 && (
              <div className="pt-3 border-t border-white/10 flex justify-between items-center gap-2 flex-wrap">
                <button
                  onClick={() => {
                    if (confirm('Hapus semua riwayat hasil permainan?')) {
                      clearSavedResults();
                      setResults([]);
                    }
                  }}
                  className="px-4 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Hapus Semua</span>
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => downloadResultsJson(results)}
                    className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh JSON</span>
                  </button>
                  <button onClick={onClose} className="px-4 py-2 rounded-xl bg-white/10 text-white text-xs font-bold cursor-pointer">
                    Tutup
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
