// src/components/PusatKuis/QuizLeaderboard.tsx
// Papan Peringkat Pusat Kuis (tab di segmen "Komunitas & Peringkat"): harian, bulanan, dan sepanjang waktu.
// Isinya HANYA skor dari multiplayer Arena Global (ruang publik tanpa kode ruangan). Bisa dilihat siapa saja.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Trophy, Crown, Medal, RefreshCw, Play, Users, Info, Clock, AlertTriangle } from 'lucide-react';
import {
  fetchLeaderboard,
  type LeaderboardData,
  type LeaderboardEntry,
  type LeaderboardPeriod,
} from '../../services/quizCommunityApi';
import { PlayerAvatar } from './PlayerAvatar';

interface QuizLeaderboardProps {
  isLoggedIn: boolean;
  onPlayNow: () => void;
  onOpenCommunity: () => void;
}

const TABS: { key: LeaderboardPeriod; label: string; hint: string }[] = [
  { key: 'daily', label: 'Harian', hint: 'Hari ini (WIB)' },
  { key: 'monthly', label: 'Bulanan', hint: 'Bulan ini (WIB)' },
  { key: 'all', label: 'Sepanjang Waktu', hint: 'Sejak awal' },
];

const REFRESH_MS = 30_000;

function formatResetIn(resetsAt: string | null, now: number): string {
  if (!resetsAt) return '';
  const ms = new Date(resetsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'segera diperbarui';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d} hari ${h} jam lagi`;
  if (h > 0) return `${h} jam ${m} menit lagi`;
  return `${Math.max(1, m)} menit lagi`;
}

const RankBadge: React.FC<{ rank: number }> = ({ rank }) => {
  if (rank === 1) return <Crown className="w-5 h-5 text-yellow-300" aria-label="Peringkat 1" />;
  if (rank === 2) return <Medal className="w-5 h-5 text-gray-200" aria-label="Peringkat 2" />;
  if (rank === 3) return <Medal className="w-5 h-5 text-amber-600" aria-label="Peringkat 3" />;
  return <span className="text-xs font-mono font-black text-gray-400">#{rank}</span>;
};

const Row: React.FC<{ e: LeaderboardEntry; highlight?: boolean }> = ({ e, highlight }) => {
  const top = e.rank <= 3;
  return (
    <li
      className={`flex items-center gap-3 px-3.5 py-2.5 rounded-2xl border transition-colors ${
        e.isMe || highlight
          ? 'bg-accent2/15 border-accent2/60'
          : top
          ? 'bg-black/50 border-white/15'
          : 'bg-black/35 border-white/[0.07]'
      }`}
    >
      <div className="w-9 shrink-0 flex items-center justify-center">
        <RankBadge rank={e.rank} />
      </div>
      <PlayerAvatar name={e.name} avatarUrl={e.avatarUrl} frameId={e.frameId} size="md" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-black text-white truncate">{e.name}</span>
          {e.isMe && (
            <span className="shrink-0 text-[9px] font-mono font-black uppercase px-1.5 py-0.5 rounded-md bg-accent2 text-on-accent2">Kamu</span>
          )}
        </div>
        <span className="text-[11px] text-gray-400">
          {e.decks} kuis dimainkan • {e.correct} jawaban benar
        </span>
      </div>
      <div className="text-right shrink-0">
        <span className="text-base font-black font-mono text-accent2">{e.points.toLocaleString('id-ID')}</span>
        <span className="text-[10px] text-gray-400 block -mt-0.5">poin</span>
      </div>
    </li>
  );
};

export const QuizLeaderboard: React.FC<QuizLeaderboardProps> = ({ isLoggedIn, onPlayNow, onOpenCommunity }) => {
  const [period, setPeriod] = useState<LeaderboardPeriod>('daily');
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const reqId = useRef(0);

  const load = useCallback(
    async (p: LeaderboardPeriod, silent = false) => {
      const id = ++reqId.current;
      if (!silent) {
        setLoading(true);
        setError('');
      }
      try {
        const res = await fetchLeaderboard(p);
        if (id !== reqId.current) return; // jawaban usang (pengguna sudah pindah tab)
        setData(res);
        setError('');
      } catch (e: any) {
        if (id !== reqId.current) return;
        if (!silent) setError(e?.message || 'Gagal memuat papan peringkat.');
      } finally {
        if (id === reqId.current && !silent) setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    setData(null);
    void load(period);
  }, [period, load]);

  // Segarkan otomatis selama tab terlihat; hitung mundur reset ikut berjalan.
  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
      if (document.visibilityState === 'visible') void load(period, true);
    }, REFRESH_MS);
    return () => window.clearInterval(t);
  }, [period, load]);

  const entries = data?.entries ?? [];
  const meOutside = data?.me && !entries.some((e) => e.isMe) ? data.me : null;
  const activeTab = TABS.find((t) => t.key === period)!;

  return (
    <section className="space-y-5 animate-in fade-in duration-200">
      <div className="rounded-3xl bg-surface border border-white/10 p-4 sm:p-7 shadow-2xl space-y-5">
        {/* Tab periode + info reset + tombol muat ulang */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Periode papan peringkat"
            className="grid grid-cols-3 gap-1 sm:gap-1.5 p-1 rounded-2xl bg-black/50 border border-white/10 min-w-0 sm:min-w-[360px]"
          >
            {TABS.map((t) => {
              const on = t.key === period;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setPeriod(t.key)}
                  className={`min-w-0 px-1.5 sm:px-4 py-2.5 rounded-xl text-[11px] sm:text-xs leading-tight text-center font-black transition-all cursor-pointer ${
                    on ? 'bg-accent2 text-on-accent2 shadow' : 'text-gray-300 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between sm:justify-end gap-2 text-[11px] text-gray-400">
            {data?.resetsAt ? (
              <span className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-black/50 border border-white/10 whitespace-nowrap min-w-0">
                <Clock className="w-3.5 h-3.5 shrink-0 text-accent2" />
                <span className="truncate">Reset {formatResetIn(data.resetsAt, now)}</span>
              </span>
            ) : (
              <span className="sm:hidden" />
            )}
            <button
              type="button"
              onClick={() => void load(period)}
              disabled={loading}
              aria-label="Muat ulang papan peringkat"
              className="shrink-0 w-9 h-9 rounded-xl bg-black/50 hover:bg-black/80 border border-white/10 text-gray-300 hover:text-white flex items-center justify-center cursor-pointer disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Judul papan + jumlah pemain */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="shrink-0 w-11 h-11 rounded-2xl bg-yellow-400/15 border border-yellow-300/30 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-yellow-300" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-black text-white leading-snug">
                Papan Peringkat {activeTab.label}
              </h2>
              <p className="text-[11px] text-gray-400 mt-0.5">{activeTab.hint}</p>
            </div>
          </div>
          {data && data.totalPlayers > 0 && (
            <span className="self-start sm:self-auto shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/50 border border-white/10 text-[11px] text-gray-200 font-mono whitespace-nowrap">
              <Users className="w-3.5 h-3.5 shrink-0" />
              {data.totalPlayers.toLocaleString('id-ID')} pemain
            </span>
          )}
        </div>

        {/* Isi */}
        {loading && !data ? (
          <ul className="space-y-2" aria-busy="true" aria-label="Memuat">
            {Array.from({ length: 6 }).map((_, i) => (
              <li key={i} className="h-[58px] rounded-2xl bg-white/[0.04] animate-pulse" />
            ))}
          </ul>
        ) : error && !data ? (
          <div className="py-10 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
            <p className="text-sm text-gray-200">{error}</p>
            <button
              type="button"
              onClick={() => void load(period)}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold cursor-pointer"
            >
              Coba Lagi
            </button>
          </div>
        ) : entries.length === 0 ? (
          <div className="py-10 text-center space-y-3">
            <Trophy className="w-10 h-10 text-gray-500 mx-auto" />
            <p className="text-sm font-bold text-white">
              {period === 'daily' ? 'Belum ada skor multiplayer hari ini.' : period === 'monthly' ? 'Belum ada skor multiplayer bulan ini.' : 'Belum ada skor multiplayer tercatat.'}
            </p>
            <p className="text-xs text-gray-400">Jadilah yang pertama di puncak papan peringkat!</p>
            <button
              type="button"
              onClick={onPlayNow}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 text-xs font-black cursor-pointer active:scale-95 transition-all"
            >
              <Play className="w-3.5 h-3.5 fill-current" /> Gabung Arena Global
            </button>
          </div>
        ) : (
          <>
            <ol className="space-y-2">
              {entries.map((e) => (
                <Row key={e.userId} e={e} />
              ))}
            </ol>
            {meOutside && (
              <div className="pt-1 space-y-1.5">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-400 px-1">Peringkatmu</p>
                <ol>
                  <Row e={meOutside} highlight />
                </ol>
              </div>
            )}
          </>
        )}

        {/* Ajakan bila belum punya skor */}
        {isLoggedIn && data && !data.me && entries.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-2xl bg-accent2/10 border border-accent2/30">
            <p className="text-xs text-gray-200">Kamu belum punya skor di periode ini. Selesaikan satu permainan di Arena Global untuk masuk papan peringkat.</p>
            <button
              type="button"
              onClick={onPlayNow}
              className="shrink-0 px-4 py-2 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 text-xs font-black cursor-pointer active:scale-95 transition-all"
            >
              Gabung Arena Global
            </button>
          </div>
        )}
      </div>

      {/* Aturan poin */}
      <div className="rounded-3xl bg-black/40 border border-white/10 p-5 sm:p-6 space-y-3">
        <h3 className="text-sm font-black text-white flex items-center gap-2">
          <Info className="w-4 h-4 text-accent" /> Cara poin dihitung
        </h3>
        <ul className="text-xs text-gray-300 space-y-1.5 leading-relaxed list-disc pl-5">
          <li>Papan peringkat <strong className="text-white">hanya berasal dari multiplayer Arena Global</strong>: ruang publik tanpa kode ruangan, tinggal tekan Gabung. Sesi Solo dan Pass &amp; Play tidak dihitung.</li>
          <li>Setiap jawaban benar bernilai 10 poin, ditambah bonus 20% bila semua soal benar. Skor dinilai server dan dicatat otomatis saat permainan selesai sampai soal terakhir. Keluar di tengah permainan berarti skor tidak dicatat.</li>
          <li>Syaratnya: minimal 5 soal dan minimal 2 pemain yang masuk akun. Per kuis, hanya skor <strong className="text-white">terbaik</strong> dalam periode yang dihitung, jadi mengulang kuis yang sama tidak menggandakan poin. Mainkan kuis lain untuk menambah poin.</li>
          <li>
            Berlaku untuk deck bawaan, starter, dan kuis <button type="button" onClick={onOpenCommunity} className="underline text-accent2 hover:text-accent2/80 cursor-pointer">Komunitas</button> yang
            sudah lolos pemeriksaan. Skor di kuis buatanmu sendiri tidak dihitung. Kuis pribadi tidak pernah tampil di Arena Global.
          </li>
          <li>Harian dan bulanan mengikuti waktu Indonesia Barat (WIB). Nama dan foto profil pemain tampil di papan ini.</li>
        </ul>
      </div>
    </section>
  );
};
