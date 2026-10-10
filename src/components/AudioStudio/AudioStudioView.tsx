// src/components/AudioStudio/AudioStudioView.tsx
import React, { useState, useEffect } from 'react';
import { AudioCatalogCarousel } from './AudioCatalogCarousel';
import { FeaturedShowcase } from './FeaturedShowcase';
import { LoopShowcase } from './LoopShowcase';
import { StemMixer } from './StemMixer';
import { PadStudio } from './PadStudio';
import { AudioToolsSuite, TOOL_SLUG_TO_ID } from './AudioToolsSuite';
import { ModularPurchaseBox } from './ModularPurchaseBox';
import { AudioEntitlements, CartItem, AudioTrackItem } from '../../types';
import { storage } from '../../services/storage';
import { calculateAudioPricing } from '../../services/pricing';
import { audioEngine } from '../../services/audioEngine';
import { findCartConflict } from '../../services/cartRules';
import { peekInitialToolSlug, clearInitialToolSlug } from '../../services/routes';
import {
  Music,
  Sliders,
  Wrench,
  CreditCard,
  Radio,
  Activity,
  Cpu,
  ShieldCheck,
  ArrowRight,
} from 'lucide-react';
import { SheetMusicAndLicense } from './SheetMusicAndLicense';

interface AudioStudioViewProps {
  tracks?: AudioTrackItem[];
  entitlements: AudioEntitlements;
  activeSection?: StudioSection;
  onSectionChange?: (sec: StudioSection) => void;
  onRequestCustom: () => void;
  onAddToCart: (items: CartItem[]) => void;
  onOpenCart: () => void;
  onSuccessToast: (msg: string) => void;
  /** Isi keranjang saat ini, dipakai untuk mencegah produk ganda. */
  cartItems?: CartItem[];
}

export type StudioSection = 'assets' | 'pad' | 'tools' | 'pricing';

export const AudioStudioView: React.FC<AudioStudioViewProps> = ({
  tracks = [],
  entitlements,
  activeSection = 'tools',
  onSectionChange,
  onRequestCustom,
  onAddToCart,
  onOpenCart,
  onSuccessToast,
  cartItems = [],
}) => {
  const [activeTrackId, setActiveTrackId] = useState<string>(() => {
    return storage.getActiveAudioId();
  });

  const [targetedPricingKey, setTargetedPricingKey] = useState<string | null>(null);
  const [pricingNonce, setPricingNonce] = useState(0);
  const [isCarouselPlaying, setIsCarouselPlaying] = useState(false);
  // Audio Tools tetap ter-mount (hanya disembunyikan) setelah pernah dibuka, supaya berkas yang
  // diunggah dan hasil prosesnya tidak hilang saat pengguna pindah seksi (mis. ke Harga & Lisensi).
  const [toolsMounted, setToolsMounted] = useState(activeSection === 'tools');
  useEffect(() => {
    if (activeSection === 'tools') setToolsMounted(true);
  }, [activeSection]);

  // Audio Tools (20 alat dalam satu suite): slug di URL (/alat-audio/<slug> dari halaman SEO, atau /audio/tools/<slug>)
  // memilih alat yang dibuka pertama kali. Slug dicatat saat modul routes dimuat (sebelum App merapikan URL ke
  // /audio/tools), jadi tamu yang harus login dulu pun tetap dibawa ke alat yang dituju. Dipakai sekali saja.
  const [initialTool] = useState(() => {
    const slug = peekInitialToolSlug();
    return slug ? TOOL_SLUG_TO_ID[slug] ?? null : null;
  });
  useEffect(() => {
    if (initialTool) document.getElementById('audio-tools-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    clearInitialToolSlug();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const catalog: AudioTrackItem[] = tracks;
  const activeTrack = catalog.find((t) => String(t.id) === String(activeTrackId)) || catalog[0];

  // Katalog sekarang murni dari database. Saat masih dimuat / kosong, tampilkan
  // pesan alih-alih crash (activeTrack.id di bawah akan error kalau undefined).
  if (!activeTrack) {
    return (
      <div className="w-full py-20 text-center text-gray-400">
        <Music className="w-10 h-10 mx-auto mb-3 text-accent" />
        <p className="font-bold text-white">Katalog audio belum tersedia</p>
        <p className="text-xs mt-1">Sedang memuat, atau belum ada lagu yang dipublikasikan di database.</p>
      </div>
    );
  }

  const handleSelectTrack = (track: AudioTrackItem) => {
    const sId = String(track.id);
    setActiveTrackId(sId);
    storage.setActiveAudioId(sId);
    onSuccessToast(`Audio "${track.title}" dimuat ke Studio.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const trackOwnership: any = entitlements?.byTrack?.[activeTrack.id] || {};
  const hasEditor = Boolean(entitlements?.fullEditor8Bar);
  const hasAudioTools = Boolean(
    (entitlements as any)?.audioToolsSuite ||
    trackOwnership?.audioToolsSuite ||
    Object.values(entitlements?.byTrack || {}).some((t: any) => t?.audioToolsSuite)
  );

  // Latihan Nada boleh memakai trek studio sebagai acuan hanya bila akun memiliki Master-nya: berkas master bisa diunduh
  // siapa saja yang tahu URL-nya, dan batas pratinjau 7 detik hanya ada di UI, jadi tidak boleh ditawarkan ke semua orang.
  const studioTrackForTools =
    trackOwnership.fullMaster && activeTrack.audioUrl
      ? { id: String(activeTrack.id), title: activeTrack.title, audioUrl: activeTrack.audioUrl }
      : null;

  const handleUnlockAudioTools = () => {
    handleNavigateToPricing('audioToolsSuite');
    const toolsItem = {
      id: `audio-tools-${Date.now()}`,
      title: 'Audio Tools Suite (20 Tools Studio)',
      category: 'audio',
      price: 20000,
      description: 'Akses penuh permanen tanpa batasan kuota harian untuk seluruh 20 alat studio audio.',
      itemTypeKey: 'audioToolsSuite',
    } as any;

    // Jangan menambah lagi (dan jangan berbohong lewat toast) bila sudah ada di keranjang.
    const conflict = findCartConflict(cartItems, toolsItem);
    if (conflict) {
      onOpenCart();
      onSuccessToast(conflict);
      return;
    }
    onAddToCart([toolsItem]);
    onOpenCart();
    onSuccessToast('Audio Tools Suite ditambahkan ke keranjang!');
  };

  const pricing = calculateAudioPricing(activeTrack?.price || 50000, {
    fullMaster: Boolean(trackOwnership.fullMaster),
    loopVersion: Boolean(trackOwnership.loopVersion),
    separatedStems: Boolean(trackOwnership.separatedStems),
    sheetMusic: Boolean(trackOwnership.sheetMusic),
    fullEditor8Bar: hasEditor,
    audioToolsSuite: hasAudioTools,
  } as any);

  const isTrackFullyOwned = Boolean(
    pricing.isFullyOwned ||
    pricing.bundleUserPrice <= 0 ||
    (trackOwnership.fullMaster &&
      trackOwnership.loopVersion &&
      trackOwnership.separatedStems &&
      trackOwnership.sheetMusic &&
      hasEditor &&
      hasAudioTools)
  );

  const handleToggleCarouselPlay = (_track: AudioTrackItem) => {
    setIsCarouselPlaying(!isCarouselPlaying);
  };

  const handleNavigateToPricing = (productKey: string) => {
    setTargetedPricingKey(productKey);
    setPricingNonce((n) => n + 1);
    onSectionChange?.('pricing');
  };

  const handleGoToBundlePricing = () => {
    audioEngine.playClickSound();
    setTargetedPricingKey('bundle');
    setPricingNonce((n) => n + 1);
    onSectionChange?.('pricing');
  };

  return (
    <div className="w-full py-2 space-y-7 pb-20">
      
      {/* BANNER JUDUL SEGMEN DENGAN WIDGET STATUS KANAN */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-surface via-surface/80 to-surface border-2 border-accent/40 p-5 sm:p-6 shadow-[0_10px_35px_color-mix(in_srgb,var(--t-accent)_15%,transparent)] flex flex-col md:flex-row md:items-center justify-between gap-5">
        
        {/* Sisi Kiri: Judul Segmen Dinamis */}
        <div className="flex items-center gap-3.5 z-10">
          <div className="w-13 h-13 rounded-2xl bg-accent/15 border border-accent/40 flex items-center justify-center text-accent shadow-lg shadow-accent/20 shrink-0">
            {activeSection === 'assets' && <Music className="w-6 h-6 text-accent" />}
            {activeSection === 'pad' && <Sliders className="w-6 h-6 text-accent" />}
            {activeSection === 'tools' && <Wrench className="w-6 h-6 text-accent" />}
            {activeSection === 'pricing' && <CreditCard className="w-6 h-6 text-accent" />}
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              {activeSection === 'assets' && 'Aset Audio'}
              {activeSection === 'pad' && 'Pad Editor'}
              {activeSection === 'tools' && 'Audio Tools'}
              {activeSection === 'pricing' && 'Harga & Lisensi'}
            </h1>
            <p className="text-xs text-gray-300 font-medium mt-0.5">
              {activeSection === 'assets' && 'Katalog lagu orisinal, stem mixer & lisensi modular.'}
              {activeSection === 'pad' && 'Drum Pad & Chord Pad (gratis di Bar 1), rekam live ke sequencer, 11 birama, dinamika, undo/redo. Editor penuh: 64 bar, 4 track akor, ekspor, dan simpan proyek.'}
              {activeSection === 'tools' && '20 alat dalam 6 kelompok: potong & susun, perbaiki suara, nada & tempo, format & ukuran, rekam & analisis, latihan musik.'}
              {activeSection === 'pricing' && 'Buka modul produksi lengkap dengan kepemilikan permanen.'}
            </p>
          </div>
        </div>

        {/* Sisi Kanan: Status Widget Sesuai Segmen Aktif */}
        <div className="z-10 self-stretch sm:self-start md:self-auto min-w-0">
          {activeSection === 'assets' && (
            <div className="flex items-center gap-3.5 bg-black/55 px-3 sm:px-4 py-2.5 w-full sm:w-auto rounded-2xl border border-accent/25 shadow-inner">
              <div className="flex items-end gap-1 h-6">
                <span className="w-1 bg-accent rounded-full animate-pulse h-5" style={{ animationDuration: '0.6s' }} />
                <span className="w-1 bg-accent rounded-full animate-pulse h-3" style={{ animationDuration: '0.4s' }} />
                <span className="w-1 bg-yellow-300 rounded-full animate-pulse h-6" style={{ animationDuration: '0.8s' }} />
                <span className="w-1 bg-accent rounded-full animate-pulse h-4" style={{ animationDuration: '0.5s' }} />
                <span className="w-1 bg-accent rounded-full animate-pulse h-5" style={{ animationDuration: '0.7s' }} />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
                  <span>Hi-Res Stream</span>
                </span>
                <span className="text-xs font-black text-accent">Audio, Loop, dan Stem Master</span>
              </div>
            </div>
          )}

          {activeSection === 'pad' && (
            <div className="flex items-center gap-3.5 bg-black/55 px-3 sm:px-4 py-2.5 w-full sm:w-auto rounded-2xl border border-accent/25 shadow-inner">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-accent animate-ping" style={{ animationDuration: '0.8s' }} />
                <span className="w-2 h-2 rounded-full bg-accent opacity-70" />
                <span className="w-2 h-2 rounded-full bg-accent opacity-50" />
                <span className="w-2 h-2 rounded-full bg-yellow-400 opacity-30" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-accent" />
                  <span>Sequencer Clock Sync</span>
                </span>
                <span className="text-xs font-black text-accent">Rekam Live, 11 Birama & Dinamika</span>
              </div>
            </div>
          )}

          {activeSection === 'tools' && (
            <div className="flex items-center gap-3.5 bg-black/55 px-3 sm:px-4 py-2.5 w-full sm:w-auto rounded-2xl border border-accent/30 shadow-inner">
              <div className="w-7 h-7 rounded-xl bg-accent/20 border border-accent/40 flex items-center justify-center text-accent">
                <Cpu className="w-4 h-4 animate-spin" style={{ animationDuration: '8s' }} />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold text-accent uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent animate-ping" />
                  <span>Client-Side Processing</span>
                </span>
                <span className="text-xs font-black text-white">20 Alat: Vokal, Pitch, Tuner, Metronom & Lainnya</span>
              </div>
            </div>
          )}

          {activeSection === 'pricing' && (
            <div className="flex items-center gap-3.5 bg-black/55 px-3 sm:px-4 py-2.5 w-full sm:w-auto rounded-2xl border border-emerald-500/30 shadow-inner">
              <div className="w-7 h-7 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider">
                  Commercial License Pass
                </span>
                <span className="text-xs font-black text-white">Royalty-Free • DRM-Free</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* KONTEN SEGMEN AKTIF */}
      {activeSection === 'assets' && (
        <section className="space-y-8 animate-in fade-in duration-200">
          <FeaturedShowcase
            activeTrack={activeTrack}
            entitlements={entitlements}
            onRequestCustom={onRequestCustom}
            onUnlockMaster={() => handleNavigateToPricing('fullMaster')}
          />

          {!isTrackFullyOwned && (
            <div className="p-5 rounded-2xl bg-gradient-to-r from-surface via-black to-surface border border-accent/40 shadow-xl">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <span className="text-xs font-bold text-accent uppercase tracking-wider">
                    Paket Lengkap Studio Bundle
                  </span>
                  <h3 className="text-lg font-extrabold text-white mt-0.5">
                    {activeTrack.title} — Full Package
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-2xl font-black text-white font-mono">
                      Rp {pricing.bundleUserPrice.toLocaleString('id-ID')}
                    </span>
                    <span className="text-xs text-gray-500 line-through font-mono">
                      Rp {pricing.baseBundlePrice.toLocaleString('id-ID')}
                    </span>
                  </div>
                  <p className="text-xs text-accent font-medium mt-1">
                    Hemat Rp {(pricing.baseBundlePrice - pricing.bundleUserPrice).toLocaleString('id-ID')} dibanding membeli modul secara terpisah.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleGoToBundlePricing}
                  className="px-6 py-3 rounded-xl font-extrabold text-sm transition-all whitespace-nowrap bg-accent text-on-accent hover:bg-accent/80 cursor-pointer shadow-lg shadow-accent/20 flex items-center gap-2 active:scale-95"
                >
                  <span>Beli Bundle Sekarang</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <LoopShowcase
            activeTrack={activeTrack}
            entitlements={entitlements}
            onNavigateToPricing={handleNavigateToPricing}
          />

          <StemMixer
            activeTrack={activeTrack}
            entitlements={entitlements}
            onOpenBundlePurchase={() => handleNavigateToPricing('separatedStems')}
            onSuccessToast={onSuccessToast}
          />

          <SheetMusicAndLicense
            activeTrack={activeTrack}
            entitlements={entitlements}
            onAddToCart={onAddToCart}
            onOpenCart={onOpenCart}
            onSuccessToast={onSuccessToast}
          />

          <AudioCatalogCarousel
            tracks={catalog}
            activeTrackId={activeTrack.id}
            onSelectTrack={handleSelectTrack}
            isPlaying={isCarouselPlaying}
            onTogglePlay={handleToggleCarouselPlay}
          />
        </section>
      )}

      {activeSection === 'pad' && (
        <section className="space-y-6 animate-in fade-in duration-200">
          <PadStudio
            entitlements={entitlements}
            onUnlockEditor={() => handleNavigateToPricing('fullEditor8Bar')}
            onSuccessToast={onSuccessToast}
          />
        </section>
      )}

      {(toolsMounted || activeSection === 'tools') && (
        <section className={`space-y-6 animate-in fade-in duration-200 ${activeSection === 'tools' ? '' : 'hidden'}`}>
          <AudioToolsSuite
            entitlements={entitlements}
            onUnlockEditor={handleUnlockAudioTools}
            onQuotaExhausted={() => handleNavigateToPricing('audioToolsSuite')}
            onSuccessToast={onSuccessToast}
            isActive={activeSection === 'tools'}
            initialTool={initialTool}
            studioActiveTrack={studioTrackForTools}
          />
        </section>
      )}

      {activeSection === 'pricing' && (
        <section className="space-y-6 animate-in fade-in duration-200">
          <ModularPurchaseBox
            activeTrack={activeTrack}
            entitlements={entitlements}
            onAddToCart={onAddToCart}
            onOpenCart={onOpenCart}
            onSuccessToast={onSuccessToast}
            cartItems={cartItems}
            highlightKey={targetedPricingKey}
            highlightNonce={pricingNonce}
          />
        </section>
      )}
    </div>
  );
};
