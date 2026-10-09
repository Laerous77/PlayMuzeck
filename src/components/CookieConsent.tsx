// src/components/CookieConsent.tsx
// Banner + panel pengaturan persetujuan cookie. Pasang SEKALI di App.tsx (di luar router), mis.
//   <CookieConsent />
// Prinsip: tombol Tolak setara dengan Terima (ukuran & visibilitas sama), analitik default mati,
// pilihan bisa diubah kapan saja di halaman Kebijakan Cookie (/cookie), bagian "Pengaturan cookie".
// (Tidak ada lagi tautan "Pengaturan Cookie" terpisah di footer: kebijakan dan pengaturannya satu halaman.)
import React, { useEffect, useRef, useState } from 'react';
import { Cookie, X } from 'lucide-react';
import { getConsent, setConsent, OPEN_SETTINGS_EVENT, browserSaysNoTracking } from '../services/consent';

export const CookieConsent: React.FC = () => {
  const [visible, setVisible] = useState(false);   // banner bawah
  const [panel, setPanel] = useState(false);       // panel pengaturan
  const [analytics, setAnalytics] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const gpc = browserSaysNoTracking();

  useEffect(() => {
    const c = getConsent();
    setAnalytics(!!c?.analytics && !gpc);
    // Pernah memilih? jangan tampilkan lagi. Belum / versi lama? tampilkan.
    if (!c) setVisible(true);
    const open = () => { setAnalytics(!!getConsent()?.analytics && !gpc); prevFocus.current = document.activeElement as HTMLElement; setPanel(true); };
    window.addEventListener(OPEN_SETTINGS_EVENT, open);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open);
  }, [gpc]);

  // Fokus ke panel saat dibuka, Esc untuk menutup, kembalikan fokus saat ditutup.
  useEffect(() => {
    if (!panel) return;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closePanel(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel]);

  const closePanel = () => { setPanel(false); prevFocus.current?.focus?.(); };
  const decide = (a: boolean) => { setConsent(a); setAnalytics(a); setVisible(false); setPanel(false); };

  const btn = 'px-4 py-2.5 rounded-xl text-xs font-extrabold border border-white/20 bg-black/60 text-white hover:border-accent cursor-pointer min-w-[7.5rem]';

  return (
    <>
      {visible && !panel && (
        <div role="region" aria-label="Pemberitahuan cookie"
          className="fixed inset-x-0 bottom-0 z-[90] p-3 sm:p-4 pointer-events-none">
          <div className="pointer-events-auto mx-auto max-w-3xl rounded-2xl border border-white/[0.12] bg-[#0b1326]/95 backdrop-blur p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <Cookie className="w-5 h-5 text-accent shrink-0 mt-0.5" aria-hidden />
              <div className="text-xs text-gray-300 leading-relaxed">
                <p className="font-bold text-white text-sm mb-1">Soal cookie dan data kamu</p>
                PlayMuzeck memakai cookie dan penyimpanan lokal yang <strong className="text-white">wajib</strong> agar login, keranjang, dan pengaturanmu berfungsi.
                Kami juga ingin memakai <strong className="text-white">analitik ringan</strong> (halaman/fitur yang dipakai) untuk memperbaiki layanan, hanya bila kamu setuju.
                Tidak ada iklan dan tidak ada penjualan data.{' '}
                <a href="/cookie" className="text-accent underline">Kebijakan Cookie</a> · <a href="/privacy" className="text-accent underline">Privasi</a>
                {gpc && <p className="mt-1 text-gray-400">Peramban kamu mengirim sinyal "jangan lacak"; analitik tetap nonaktif.</p>}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 justify-end">
              <button type="button" className={btn} onClick={() => decide(false)}>Tolak</button>
              <button type="button" className={btn} onClick={() => { prevFocus.current = document.activeElement as HTMLElement; setPanel(true); }}>Atur pilihan</button>
              <button type="button" className={btn} onClick={() => decide(true)} disabled={gpc} style={gpc ? { opacity: .5, cursor: 'not-allowed' } : undefined}>Terima</button>
            </div>
          </div>
        </div>
      )}

      {panel && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4" onClick={closePanel}>
          <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="consent-title"
            onClick={(e) => e.stopPropagation()}
            className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl border border-white/[0.12] bg-[#0b1326] p-5 outline-none">
            <div className="flex items-start justify-between gap-3">
              <h2 id="consent-title" className="text-lg font-black text-white">Pengaturan cookie</h2>
              <button type="button" aria-label="Tutup" onClick={closePanel} className="p-1 text-gray-400 hover:text-white cursor-pointer"><X className="w-5 h-5" /></button>
            </div>

            <div className="mt-4 space-y-3 text-xs text-gray-300">
              <section className="rounded-xl border border-white/[0.08] bg-black/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-white text-sm">Wajib</h3>
                  <span className="text-[11px] text-gray-400">Selalu aktif</span>
                </div>
                <p className="mt-1 leading-relaxed">Menjaga kamu tetap masuk, menyimpan keranjang, progres kuis, tema dan suara pilihanmu, serta keamanan (anti-bot Cloudflare Turnstile saat masuk/daftar). Tanpa ini layanan tidak bisa berjalan.</p>
              </section>

              <section className="rounded-xl border border-white/[0.08] bg-black/40 p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-bold text-white text-sm"><label htmlFor="consent-analytics">Analitik</label></h3>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input id="consent-analytics" type="checkbox" className="sr-only peer" checked={analytics} disabled={gpc}
                      onChange={(e) => setAnalytics(e.target.checked)} />
                    <span className="w-10 h-6 rounded-full bg-white/15 peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-white transition-colors" />
                    <span className="absolute left-0.5 top-0.5 w-5 h-5 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                  </label>
                </div>
                <p className="mt-1 leading-relaxed">Mencatat peristiwa seperti kuis dimulai/selesai dengan ID acak di perangkatmu (<code>muzeck_analytics_session_v1</code>) agar kami tahu fitur mana yang berguna. Tidak dipakai untuk iklan dan tidak dijual.</p>
                {gpc && <p className="mt-1 text-gray-400">Dinonaktifkan karena peramban mengirim sinyal "jangan lacak".</p>}
              </section>
            </div>

            <div className="mt-5 flex flex-wrap gap-2 justify-end">
              <button type="button" className={btn} onClick={() => decide(false)}>Tolak semua</button>
              <button type="button" className={btn} onClick={() => decide(analytics)}>Simpan pilihan</button>
              <button type="button" className={btn} onClick={() => decide(true)} disabled={gpc} style={gpc ? { opacity: .5, cursor: 'not-allowed' } : undefined}>Terima semua</button>
            </div>
            <p className="mt-3 text-[11px] text-gray-500">Kamu bisa mengubah pilihan kapan saja di halaman <a href="/cookie#consent-box" className="text-accent underline">Kebijakan Cookie</a>, bagian Pengaturan cookie. Daftar lengkap cookie juga ada di sana.</p>
          </div>
        </div>
      )}
    </>
  );
};

export default CookieConsent;
