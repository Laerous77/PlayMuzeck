// src/services/pricing.ts

export interface AudioOwnershipStatus {
  fullMaster?: boolean;
  loopVersion?: boolean;
  separatedStems?: boolean;
  sheetMusic?: boolean;
  fullEditor8Bar?: boolean;
  audioToolsSuite?: boolean;
}

export interface AudioProductPrices {
  fullMaster: number;
  loopVersion: number;
  separatedStems: number;
  sheetMusic: number;
  fullEditor8Bar: number;
  audioToolsSuite: number;
}

export interface AudioBundleCalculation {
  baseBundlePrice: number;
  products: AudioProductPrices;
  bundleUserPrice: number;
  totalDiscount: number;
  isFullyOwned: boolean;
  unownedCount: number;
  totalPriceOfOwnedProducts: number;
  totalUnownedPrice: number;
}

export function calculateAudioPricing(
  basePrice: number = 70000,
  ownership: AudioOwnershipStatus = {}
): AudioBundleCalculation {
  const FIXED_EDITOR = 15000;
  const FIXED_TOOLS = 20000;

  // Diskon bundle penuh (basePrice = Rp70.000): Base Rp10.000 + Editor
  // Rp10.000 + Tools Rp5.000 = Rp25.000 -> Rp70.000 - Rp25.000 = Rp45.000.
  const BASE_BUNDLE_DISCOUNT = 10000;
  const EDITOR_DISCOUNT = 10000;
  const TOOLS_DISCOUNT = 5000;

  // 1. Harga Dasar Bundle Minimum Rp70.000 kelipatan Rp1.000
  const hargaDasarBundle = Math.max(70000, Math.round(Number(basePrice || 70000) / 1000) * 1000);
  const poolRasio = hargaDasarBundle - FIXED_EDITOR - FIXED_TOOLS; // Rp35.000 pada harga minimum

  // 2. Alokasi 4 Produk Rasio (9 : 5 : 14 : 7, total 35 bagian)
  // Pada harga dasar Rp70.000: poolRasio = 35.000 -> menghasilkan 9.000, 5.000, 14.000, 7.000
  let pMaster = Math.max(5000, Math.round((poolRasio * (9 / 35)) / 1000) * 1000);
  let pLoop = Math.max(5000, Math.round((poolRasio * (5 / 35)) / 1000) * 1000);
  let pStems = Math.max(5000, Math.round((poolRasio * (14 / 35)) / 1000) * 1000);
  let pSheet = Math.max(5000, Math.round((poolRasio * (7 / 35)) / 1000) * 1000);

  // Pastikan total keempat produk rasio persis sama dengan poolRasio
  const diff = poolRasio - (pMaster + pLoop + pStems + pSheet);
  pStems += diff;

  const products: AudioProductPrices = {
    fullMaster: pMaster,
    loopVersion: pLoop,
    separatedStems: pStems,
    sheetMusic: pSheet,
    fullEditor8Bar: FIXED_EDITOR,
    audioToolsSuite: FIXED_TOOLS,
  };

  const isMasterOwned = Boolean(ownership.fullMaster);
  const isLoopOwned = Boolean(ownership.loopVersion);
  const isStemsOwned = Boolean(ownership.separatedStems);
  const isSheetOwned = Boolean(ownership.sheetMusic);
  const isEditorOwned = Boolean(ownership.fullEditor8Bar);
  const isToolsOwned = Boolean(ownership.audioToolsSuite);

  const productList = [
    { key: 'fullMaster', price: products.fullMaster, owned: isMasterOwned },
    { key: 'loopVersion', price: products.loopVersion, owned: isLoopOwned },
    { key: 'separatedStems', price: products.separatedStems, owned: isStemsOwned },
    { key: 'sheetMusic', price: products.sheetMusic, owned: isSheetOwned },
    { key: 'fullEditor8Bar', price: products.fullEditor8Bar, owned: isEditorOwned },
    { key: 'audioToolsSuite', price: products.audioToolsSuite, owned: isToolsOwned },
  ];

  const unowned = productList.filter((p) => !p.owned);
  const unownedCount = unowned.length;
  const isFullyOwned = unownedCount === 0;

  const totalPriceOfOwnedProducts = productList
    .filter((p) => p.owned)
    .reduce((sum, p) => sum + p.price, 0);

  const totalUnownedPrice = unowned.reduce((sum, p) => sum + p.price, 0);

  if (isFullyOwned) {
    return {
      baseBundlePrice: hargaDasarBundle,
      products,
      bundleUserPrice: 0,
      totalDiscount: 0,
      isFullyOwned: true,
      unownedCount: 0,
      totalPriceOfOwnedProducts,
      totalUnownedPrice: 0,
    };
  }

  // -------------------------------------------------------------------
  // DISKON BUNDLE BERBASIS SET KEPEMILIKAN (bukan urutan transaksi)
  //
  // SEBELUMNYA diskon "produk utama" (Master/Loop/Stems/Sheet) dihitung
  // proporsional dari BERAPA BANYAK di antara ke-4 produk itu yang masih
  // belum dimiliki (unownedMain.length), dan diskon Editor/Tools baru
  // muncul kalau unownedCount > 1. Ini salah: begitu satu produk apa pun
  // sudah dimiliki, potongan yang tersisa jadi tidak match dengan aturan
  // bisnis yang sebenarnya diinginkan (Base 10rb SELALU ada selama belum
  // fully-owned; Editor & Tools masing-masing punya potongan sendiri yang
  // HANYA hilang kalau produk itu sendiri yang sudah dimiliki).
  //
  // Sekarang: murni dihitung dari SET kepemilikan akhir (owned/unowned),
  // bukan dari riwayat/urutan transaksi — beli Editor lalu Tools akan
  // menghasilkan harga akhir yang identik dengan beli Tools lalu Editor.
  //
  //   remainingDiscount = BASE_BUNDLE_DISCOUNT
  //                      + (Editor belum dimiliki ? EDITOR_DISCOUNT : 0)
  //                      + (Tools belum dimiliki  ? TOOLS_DISCOUNT  : 0)
  //   bundleUserPrice   = max(0, totalUnownedPrice - remainingDiscount)
  // -------------------------------------------------------------------
  let remainingDiscount = BASE_BUNDLE_DISCOUNT;
  if (!isEditorOwned) remainingDiscount += EDITOR_DISCOUNT;
  if (!isToolsOwned) remainingDiscount += TOOLS_DISCOUNT;

  // Diskon tidak boleh melebihi harga produk yang tersisa (mis. kalau cuma
  // 1 produk murah yang tersisa, "hemat Rp X" tidak masuk akal lebih besar
  // dari harga produk itu sendiri).
  // BUG SEBELUMNYA: bila sisa produk murah (mis. tinggal Loop Rp5.000, Master
  // Rp9.000, Sheet Rp7.000, atau Editor Rp15.000 dgn diskon Rp20.000), diskon
  // >= harga produk sehingga bundleUserPrice = Rp0 -> produk GRATIS.
  // Sekarang ada harga minimum tagihan (Rp5.000, atau harga produknya bila lebih murah).
  const MIN_CHARGE = 5000;
  const floorPrice = Math.min(MIN_CHARGE, totalUnownedPrice);
  const discounted = Math.round((totalUnownedPrice - Math.min(remainingDiscount, totalUnownedPrice)) / 1000) * 1000;
  const bundleUserPrice = Math.max(floorPrice, discounted);
  const totalDiscount = totalUnownedPrice - bundleUserPrice;

  return {
    baseBundlePrice: hargaDasarBundle,
    products,
    bundleUserPrice,
    totalDiscount,
    isFullyOwned: false,
    unownedCount,
    totalPriceOfOwnedProducts,
    totalUnownedPrice,
  };
}