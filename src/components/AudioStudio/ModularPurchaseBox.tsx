// src/components/AudioStudio/ModularPurchaseBox.tsx
import React, { useState, useEffect } from 'react';
import {
  Check,
  Music,
  Repeat,
  Layers,
  FileText,
  Sliders,
  Wrench,
  CheckCircle2,
  ShoppingCart,
  Sparkles,
  Zap,
} from 'lucide-react';
import { AudioEntitlements, CartItem, AudioTrackItem } from '../../types';
import { calculateAudioPricing } from '../../services/pricing';
import { findCartConflict } from '../../services/cartRules';

interface ModularPurchaseBoxProps {
  activeTrack: AudioTrackItem;
  entitlements: AudioEntitlements;
  onAddToCart: (items: CartItem[]) => void;
  onOpenCart: () => void;
  onSuccessToast?: (msg: string) => void;
  highlightKey?: string | null;
  /** Isi keranjang saat ini: tombol beli dinonaktifkan bila produk sudah ada di dalamnya. */
  cartItems?: CartItem[];
}

export const ModularPurchaseBox: React.FC<ModularPurchaseBoxProps> = ({
  activeTrack,
  entitlements,
  onAddToCart,
  onOpenCart,
  onSuccessToast,
  highlightKey,
  cartItems = [],
}) => {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);

  const trackIdStr = String(activeTrack?.id || '');
  // Menggunakan type assertion 'any' agar compiler mengenali audioToolsSuite tanpa error
  const trackOwnership: any = entitlements?.byTrack?.[trackIdStr] || entitlements?.byTrack?.[activeTrack?.id] || {};

  const isMasterOwned = Boolean(trackOwnership.fullMaster);
  const isLoopOwned = Boolean(trackOwnership.loopVersion);
  const isStemsOwned = Boolean(trackOwnership.separatedStems);
  const isSheetOwned = Boolean(trackOwnership.sheetMusic);
  const isEditorOwned = Boolean(entitlements?.fullEditor8Bar);
  const isToolsOwned = Boolean((entitlements as any)?.audioToolsSuite || trackOwnership.audioToolsSuite);

  const pricing = calculateAudioPricing(activeTrack?.price || 70000, {
    fullMaster: isMasterOwned,
    loopVersion: isLoopOwned,
    separatedStems: isStemsOwned,
    sheetMusic: isSheetOwned,
    fullEditor8Bar: isEditorOwned,
    audioToolsSuite: isToolsOwned,
  } as any);

  // Otomatis scroll dan sorot kartu yang ditargetkan (termasuk 'bundle')
  useEffect(() => {
    if (highlightKey) {
      if (highlightKey === 'bundle') {
        setTimeout(() => {
          const el = document.getElementById('bundle-card-section');
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 120);
      } else {
        setSelectedKeys((prev) => (prev.includes(highlightKey) ? prev : [...prev, highlightKey]));
        setTimeout(() => {
          const el = document.getElementById(`product-card-${highlightKey}`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      }
    }
  }, [highlightKey]);

  const products = [
    {
      key: 'fullMaster',
      title: 'Full Audio Master (MP3 / 24-bit WAV)',
      description: 'Master track kualitas studio 24-bit tanpa batas preview.',
      price: pricing.products.fullMaster,
      isOwned: isMasterOwned,
      icon: Music,
    },
    {
      key: 'loopVersion',
      title: 'Separated Loop Version',
      description: 'Versi potongan loop audio mulus untuk background video & streaming.',
      price: pricing.products.loopVersion,
      isOwned: isLoopOwned,
      icon: Repeat,
    },
    {
      key: 'separatedStems',
      title: 'Separated Track (+ Buka Stem Mixer)',
      description: 'Akses penuh stem multi-track instrumen terpisah dan mixing interaktif.',
      price: pricing.products.separatedStems,
      isOwned: isStemsOwned,
      icon: Layers,
    },
    {
      key: 'sheetMusic',
      title: 'Lembar Partitur (Sheet Music PDF)',
      description: 'Notasi balok dan susunan tangga nada resmi beresolusi tinggi.',
      price: pricing.products.sheetMusic,
      isOwned: isSheetOwned,
      icon: FileText,
    },
    {
      key: 'fullEditor8Bar',
      title: 'Drum & Chord Pad Editor (Akses Permanen)',
      description: 'Buka batas 1-bar menjadi multi-bar penuh dengan ekspor MIDI/Audio.',
      price: pricing.products.fullEditor8Bar,
      isOwned: isEditorOwned,
      icon: Sliders,
    },
    {
      key: 'audioToolsSuite',
      title: 'Audio Tools Suite (9 Tools Studio & AI)',
      description: 'Akses tanpa batas harian untuk seluruh 9 utilitas audio studio & model AI.',
      price: pricing.products.audioToolsSuite,
      isOwned: isToolsOwned,
      icon: Wrench,
    },
  ];

  const makeProductItem = (p: typeof products[0]): CartItem =>
    ({
      id: `${activeTrack?.id || 'track'}-${p.key}-${Date.now()}`,
      trackId: activeTrack?.id || 'track',
      title: `${p.title} (${activeTrack?.title || 'Audio'})`,
      category: 'audio',
      price: p.price,
      description: p.description,
      itemTypeKey: p.key as any,
    } as any);

  const makeBundleItem = (): CartItem =>
    ({
      id: `${activeTrack?.id || 'track'}-bundle-${Date.now()}`,
      trackId: activeTrack?.id || 'track',
      title: `Studio Bundle: ${activeTrack?.title || 'Audio'}`,
      category: 'audio',
      price: pricing.bundleUserPrice,
      description: `Paket lengkap untuk seluruh produk yang belum dimiliki pada ${activeTrack?.title || 'Audio'}.`,
      itemTypeKey: 'all',
    } as any);

  // Sudah ada di keranjang (atau sudah tercakup bundle di keranjang)?
  const productConflict = (p: typeof products[0]) => findCartConflict(cartItems, makeProductItem(p));
  const bundleConflict = pricing.isFullyOwned ? null : findCartConflict(cartItems, makeBundleItem());

  const toggleSelect = (key: string, isOwned: boolean) => {
    if (isOwned) return;
    const p = products.find((x) => x.key === key);
    if (p && productConflict(p)) return;
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleBuySingleItem = (p: typeof products[0], e: React.MouseEvent) => {
    e.stopPropagation();
    if (p.isOwned) return;
    const conflict = productConflict(p);
    if (conflict) {
      onSuccessToast?.(conflict);
      return;
    }

    try {
      if (typeof onAddToCart === 'function') onAddToCart([makeProductItem(p)]);
      if (typeof onOpenCart === 'function') onOpenCart();
      onSuccessToast?.(`${p.title} ditambahkan ke keranjang.`);
    } catch (err) {
      console.error('Error saat menambah produk ke keranjang:', err);
      alert('Gagal menambahkan item ke keranjang.');
    }
  };

  const handleBuySelected = () => {
    const targetKeys = selectedKeys.length > 0 ? selectedKeys : (highlightKey ? [highlightKey] : []);
    const itemsToAdd: CartItem[] = products
      .filter((p) => targetKeys.includes(p.key) && !p.isOwned && !productConflict(p))
      .map((p) => makeProductItem(p));

    if (itemsToAdd.length === 0) {
      onSuccessToast?.('Item yang dipilih sudah ada di keranjang atau sudah dimiliki.');
      setSelectedKeys([]);
      return;
    }

    try {
      if (typeof onAddToCart === 'function') onAddToCart(itemsToAdd);
      setSelectedKeys([]);
      if (typeof onOpenCart === 'function') onOpenCart();
      onSuccessToast?.(`${itemsToAdd.length} produk berhasil ditambahkan ke keranjang.`);
    } catch (err) {
      console.error('Error saat menambah beberapa item:', err);
      alert('Gagal menambahkan item ke keranjang.');
    }
  };

  const handleBuyBundle = () => {
    if (pricing.isFullyOwned) return;
    if (bundleConflict) {
      onSuccessToast?.(bundleConflict);
      return;
    }
    try {
      if (typeof onAddToCart === 'function') onAddToCart([makeBundleItem()]);
      if (typeof onOpenCart === 'function') onOpenCart();
      onSuccessToast?.(`Bundle berhasil ditambahkan ke keranjang!`);
    } catch (err) {
      console.error('Error bundle:', err);
      alert('Gagal menambahkan bundle ke keranjang.');
    }
  };

  const isBundleHighlighted = highlightKey === 'bundle';

  return (
    <div className="rounded-3xl bg-[#14213D]/40 border border-white/10 p-6 sm:p-8 space-y-6">
      <div>
        <h2 className="text-xl font-black text-white">Modular Audio License & Stems Box</h2>
        <p className="text-xs text-gray-400 mt-1">
          Pilih item individual sesuai kebutuhan untuk lagu <span className="text-[#FCA311] font-semibold">{activeTrack?.title}</span>, atau beli paket komplit untuk hemat maksimal.
        </p>
      </div>

      <div className="space-y-3">
        {products.map((p) => {
          const isSelected = selectedKeys.includes(p.key);
          const isHighlighted = highlightKey === p.key;
          const inCart = !p.isOwned && Boolean(productConflict(p));

          return (
            <div
              id={`product-card-${p.key}`}
              key={p.key}
              onClick={() => toggleSelect(p.key, p.isOwned)}
              className={`p-4 rounded-2xl border transition-all flex items-center justify-between gap-4 cursor-pointer ${
                p.isOwned
                  ? 'bg-black/30 border-white/5 opacity-60 cursor-not-allowed'
                  : isHighlighted
                  ? 'bg-[#14213D] border-[#FCA311] ring-2 ring-[#FCA311] shadow-xl shadow-amber-500/20'
                  : isSelected
                  ? 'bg-[#14213D] border-[#FCA311] shadow-lg shadow-amber-500/10'
                  : 'bg-black/40 border-white/5 hover:border-white/20'
              }`}
            >
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-5 h-5 rounded-md flex items-center justify-center border transition-colors ${
                    p.isOwned
                      ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400'
                      : isSelected || isHighlighted
                      ? 'bg-[#FCA311] border-[#FCA311] text-black'
                      : 'border-white/20 bg-black/40'
                  }`}
                >
                  {(p.isOwned || isSelected || isHighlighted) && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-white">{p.title}</span>
                    {p.isOwned && (
                      <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
                        Sudah Dimiliki
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 max-w-xl line-clamp-1">{p.description}</p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-sm font-extrabold text-white font-mono">
                  Rp {p.price.toLocaleString('id-ID')}
                </span>

                {!p.isOwned && (
                  <button
                    type="button"
                    disabled={inCart}
                    onClick={(e) => handleBuySingleItem(p, e)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                      inCart
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-not-allowed'
                        : 'bg-white/10 hover:bg-[#FCA311] hover:text-black text-gray-200 cursor-pointer'
                    }`}
                  >
                    {inCart ? <Check className="w-3.5 h-3.5" /> : <ShoppingCart className="w-3.5 h-3.5" />}
                    <span>{inCart ? 'Di Keranjang' : 'Beli'}</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={handleBuySelected}
          disabled={selectedKeys.length === 0}
          className={`px-6 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 ${
            selectedKeys.length > 0
              ? 'bg-white text-black hover:bg-gray-200 cursor-pointer shadow-md'
              : 'bg-white/10 text-gray-500 cursor-not-allowed border border-white/5'
          }`}
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          <span>Beli {selectedKeys.length > 0 ? `${selectedKeys.length} Item Terpilih` : 'Item Terpilih'}</span>
        </button>
      </div>

      {/* BEST VALUE DYNAMIC BUNDLE CARD */}
      <div
        id="bundle-card-section"
        className={`p-6 rounded-3xl transition-all duration-500 relative overflow-hidden flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5 ${
          isBundleHighlighted
            ? 'bg-gradient-to-r from-amber-500/25 via-[#1a2d54] to-amber-500/20 border-2 border-[#FCA311] ring-4 ring-[#FCA311]/50 shadow-[0_0_40px_rgba(252,163,17,0.45)] scale-[1.01]'
            : 'bg-gradient-to-r from-amber-500/10 via-[#14213D] to-black border-2 border-[#FCA311]/40 shadow-xl'
        }`}
      >
        <div className="absolute -top-12 -left-12 w-36 h-36 bg-[#FCA311]/20 rounded-full blur-2xl pointer-events-none animate-pulse" />

        <div className="z-10">
          <div className="flex items-center gap-2">
            <span className="px-3 py-1 rounded-full bg-gradient-to-r from-[#FCA311] to-amber-300 text-black text-[11px] font-black uppercase tracking-wider flex items-center gap-1 shadow-md animate-bounce">
              <Sparkles className="w-3 h-3 fill-black" />
              <span>Best Value Bundle</span>
            </span>
            <span className="text-sm font-black text-white">Beli Sisa Paket Lengkap</span>
          </div>

          {pricing.isFullyOwned ? (
            <p className="text-xs text-emerald-400 mt-2 font-bold flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" /> Anda telah memiliki seluruh 6 produk untuk trek ini.
            </p>
          ) : (
            <>
              <p className="text-xs text-gray-300 mt-1.5 leading-relaxed max-w-xl font-medium">
                Dapatkan kepemilikan permanen untuk seluruh item yang belum Anda miliki (Master, Loop, Stems, Partitur, Pad Editor, & Audio Tools Suite).
              </p>
              {pricing.totalDiscount > 0 && (
                <span className="text-xs text-emerald-400 font-extrabold flex items-center gap-1 mt-1.5 animate-pulse">
                  <Zap className="w-3.5 h-3.5 fill-emerald-400" />
                  Hemat Rp {pricing.totalDiscount.toLocaleString('id-ID')} dengan paket bundle dinamis
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end z-10">
          {!pricing.isFullyOwned ? (
            <>
              <div className="text-right">
                {pricing.totalDiscount > 0 && (
                  <span className="text-xs text-gray-400 line-through block font-mono">
                    Rp {pricing.totalUnownedPrice.toLocaleString('id-ID')}
                  </span>
                )}
                <span className="text-2xl font-black text-[#FCA311] font-mono drop-shadow">
                  Rp {pricing.bundleUserPrice.toLocaleString('id-ID')}
                </span>
              </div>
              <button
                type="button"
                disabled={Boolean(bundleConflict)}
                onClick={handleBuyBundle}
                title={bundleConflict || undefined}
                className={`px-6 py-3.5 rounded-2xl font-black text-xs whitespace-nowrap transition-all flex items-center gap-1.5 ${
                  bundleConflict
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 cursor-not-allowed'
                    : 'bg-gradient-to-r from-[#FCA311] to-amber-400 text-black hover:brightness-110 shadow-xl shadow-amber-500/30 cursor-pointer active:scale-95'
                }`}
              >
                {bundleConflict ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                <span>{bundleConflict ? 'Sudah di Keranjang' : 'Beli Bundle Sekarang'}</span>
              </button>
            </>
          ) : (
            <span className="px-5 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-black text-xs">
              Sudah Dimiliki
            </span>
          )}
        </div>
      </div>
    </div>
  );
};