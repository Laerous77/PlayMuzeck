// src/components/DonationCard.tsx
// Kartu "Dukung PlayMuzeck" yang tampil publik (beranda, Audio Tools, Pusat Kuis).
// Gaya mengikuti Musical Artifacts: jujur soal biaya, bebas iklan, progress target bulan ini, tombol donasi.
// Data progress dari GET /api/public/donation-goal (angka asli dari tabel donations).
import React, { useEffect, useState } from 'react';
import { Heart, Coffee, ShieldCheck, Server, ExternalLink, X } from 'lucide-react';

interface Goal { month: string; goal: number; raised: number; donors: number; daysLeft: number }

const rupiah = (n: number) => 'Rp' + Math.round(n).toLocaleString('id-ID');

const DISMISS_KEY = 'muzeck_donation_banner_dismissed_v1';

function useGoal() {
  const [data, setData] = useState<Goal | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/public/donation-goal')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive && j && typeof j.raised === 'number') setData(j as Goal); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return data;
}

function GoalBar({ g }: { g: Goal }) {
  if (!g.goal) return null; // tanpa target: jangan tampilkan bar
  const pct = Math.min(100, Math.round((g.raised / g.goal) * 100));
  const met = g.raised >= g.goal;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[11px] font-mono text-gray-400">
        <span>Biaya operasional bulan ini</span>
        <span className="text-white font-bold">{rupiah(g.raised)} / {rupiah(g.goal)}</span>
      </div>
      <div
        role="progressbar" aria-valuemin={0} aria-valuemax={g.goal} aria-valuenow={Math.min(g.raised, g.goal)}
        aria-label="Progres donasi bulan ini"
        className="h-3 w-full rounded-full bg-white/10 overflow-hidden"
      >
        <div className="h-full rounded-full bg-accent transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-[11px] text-gray-400">
        {met
          ? <>Target bulan ini <strong className="text-white">sudah tercapai</strong>. Terima kasih! Donasi berikutnya membantu bulan depan.</>
          : <>{pct}% tercapai{g.daysLeft > 0 ? <> · bulan ini berakhir dalam <strong className="text-white">{g.daysLeft} hari</strong></> : null}</>}
        {g.donors > 0 && <> · {g.donors} donatur</>}
      </p>
    </div>
  );
}

interface Props {
  /** Dipanggil saat tombol Donasi ditekan. Buka Dasbor Profil di tab "Donasi & Dukungan" (pengguna harus masuk). */
  onDonate: () => void;
  variant?: 'card' | 'banner';
  className?: string;
}

export const DonationCard: React.FC<Props> = ({ onDonate, variant = 'card', className = '' }) => {
  const g = useGoal();
  const [hidden, setHidden] = useState(() => {
    try { return variant === 'banner' && localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });

  if (variant === 'banner') {
    if (hidden) return null;
    return (
      <div className={`relative flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-white/[0.08] bg-black/50 px-4 py-3 pr-10 ${className}`}>
        <Heart className="w-4 h-4 text-accent shrink-0" aria-hidden />
        <p className="text-xs text-gray-300 flex-1 min-w-[min(14rem,100%)]">
          <strong className="text-white">PlayMuzeck bebas iklan.</strong> Biaya server dan penyimpanan ditopang dari pembelian aset dan donasi pengguna.
          {g?.goal ? <> Bulan ini baru <strong className="text-white">{rupiah(g.raised)}</strong> dari {rupiah(g.goal)}.</> : null}
        </p>
        <button type="button" onClick={onDonate} className="px-3.5 py-1.5 rounded-lg bg-accent text-on-accent text-xs font-extrabold cursor-pointer hover:bg-accent/90">
          Donasi
        </button>
        <a href="/support" className="text-xs text-accent underline">Ke mana dananya?</a>
        <button
          type="button" aria-label="Tutup"
          onClick={() => { setHidden(true); try { localStorage.setItem(DISMISS_KEY, '1'); } catch {} }}
          className="absolute top-2 right-2 p-1 text-gray-500 hover:text-white cursor-pointer"
        ><X className="w-4 h-4" /></button>
      </div>
    );
  }

  return (
    <aside
      aria-label="Dukung PlayMuzeck"
      className={`rounded-3xl bg-gradient-to-b from-surface/60 to-black/70 border border-white/[0.1] p-5 sm:p-6 space-y-4 ${className}`}
    >
      <div className="flex items-center gap-2">
        <Heart className="w-5 h-5 text-accent" aria-hidden />
        <h2 className="text-lg sm:text-xl font-black text-white">Bantu PlayMuzeck tetap hidup</h2>
      </div>

      <p className="text-sm text-gray-300 leading-relaxed">
        PlayMuzeck dikerjakan satu orang di waktu luang, dan <strong className="text-white">tidak memasang iklan satu pun</strong>.
        Artinya tidak ada banner yang menutupi alat, tidak ada pop-up, dan datamu tidak dijual.
        Tapi server, penyimpanan file, domain, dan email tetap ada tagihannya setiap bulan.
        Kalau PlayMuzeck pernah menghemat waktumu, donasi berapa pun langsung dipakai untuk menjaganya tetap online dan gratis dicoba.
      </p>

      {g && <GoalBar g={g} />}

      <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-gray-300">
        <li className="flex items-start gap-2 rounded-xl bg-black/40 border border-white/[0.06] p-2.5"><ShieldCheck className="w-4 h-4 text-accent shrink-0 mt-px" aria-hidden /><span>Bebas iklan, tanpa jual data</span></li>
        <li className="flex items-start gap-2 rounded-xl bg-black/40 border border-white/[0.06] p-2.5"><Server className="w-4 h-4 text-accent shrink-0 mt-px" aria-hidden /><span>Dana untuk server, storage, domain</span></li>
        <li className="flex items-start gap-2 rounded-xl bg-black/40 border border-white/[0.06] p-2.5"><Coffee className="w-4 h-4 text-accent shrink-0 mt-px" aria-hidden /><span>Mulai Rp1.000 via QRIS/e-wallet</span></li>
      </ul>

      <p className="text-[11px] text-gray-400">
        Sebagai ucapan terima kasih, donatur mendapat <strong className="text-gray-200">bingkai profil eksklusif</strong> mulai donasi
        Rp10.000 (Secangkir Kopi), Rp25.000 (Energi Kreatif), Rp50.000 (Server Boost), dan Rp100.000 (Pendukung Sultan).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onDonate}
          className="px-5 py-2.5 rounded-xl bg-accent hover:bg-accent/90 text-on-accent text-sm font-extrabold inline-flex items-center gap-2 cursor-pointer shadow-md">
          <Heart className="w-4 h-4" aria-hidden /> Donasi sekarang
        </button>
        <a href="/support" className="text-xs text-accent underline inline-flex items-center gap-1">
          Lihat ke mana dananya <ExternalLink className="w-3 h-3" aria-hidden />
        </a>
      </div>
    </aside>
  );
};

export default DonationCard;
