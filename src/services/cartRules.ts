// src/services/cartRules.ts
// Aturan anti-ganda keranjang, dipakai bersama oleh App.tsx (penjaga utama)
// dan komponen tombol beli (supaya tombol langsung nonaktif bila sudah ada).
import type { CartItem } from '../types';

const GLOBAL_AUDIO_KEYS = ['fullEditor8Bar', 'audioToolsSuite']; // berlaku untuk seluruh akun, bukan per-trek
const PRODUCT_SUFFIX = /[-_:](fullMaster|loopVersion|separatedStems|sheetMusic|fullEditor8Bar|audioToolsSuite|all|bundle)$/i;

/** Kunci baris keranjang (id + jenis). Dipakai untuk key React & penghapusan. */
export const cartKeyOf = (i: CartItem) => `${i.id}::${(i as any).itemTypeKey || ''}`;

export const audioTrackOf = (i: any) => String(i.trackId || i.id || '').replace(PRODUCT_SUFFIX, '');

export const isAudioBundle = (i: any) => {
  const key = String(i.itemTypeKey || '');
  return key === 'all' || /bundle|lengkap/i.test(`${key} ${i.id || ''}`);
};

/**
 * Identitas PRODUK (bukan identitas baris). Beberapa tombol membuat id dengan
 * Date.now() sehingga id selalu berbeda tiap klik; dengan identitas ini produk
 * yang sama tetap terdeteksi sebagai duplikat.
 */
export function cartIdentityOf(item: CartItem): string {
  const it: any = item;
  const key = String(it.itemTypeKey || '');
  if (key === 'quizCreatorSuite') return 'quizCreatorSuite';
  if (it.category === 'audio') {
    if (GLOBAL_AUDIO_KEYS.includes(key)) return `audio-global::${key}`;
    if (isAudioBundle(it)) return `audio-bundle::${audioTrackOf(it)}`;
    return `audio::${audioTrackOf(it)}::${key}`;
  }
  return `${it.category || ''}::${it.deckId || it.topicId || it.id}::${key}`;
}

/** Pesan alasan bila `item` bentrok dengan isi keranjang, atau null bila boleh. */
export function findCartConflict(cart: CartItem[], item: CartItem): string | null {
  const it: any = item;
  const label = it.title || 'Produk ini';
  const identity = cartIdentityOf(item);

  if (cart.some((c) => cartIdentityOf(c) === identity)) {
    return `"${label}" sudah ada di keranjang.`;
  }
  if (it.category !== 'audio') return null;

  const newIsBundle = isAudioBundle(it);
  const newKey = String(it.itemTypeKey || '');
  const newTrack = audioTrackOf(it);

  for (const c of cart as any[]) {
    if (c.category !== 'audio') continue;
    const cIsBundle = isAudioBundle(c);
    const cKey = String(c.itemTypeKey || '');
    const sameTrack = audioTrackOf(c) === newTrack;

    // Bundle mencakup SEMUA produk trek tsb -> tidak boleh digabung dengan
    // produk satuan (atau bundle lain) dari trek yang sama.
    if (sameTrack && (newIsBundle || cIsBundle) && !GLOBAL_AUDIO_KEYS.includes(newKey) && !GLOBAL_AUDIO_KEYS.includes(cKey)) {
      return newIsBundle
        ? 'Paket bundle sudah mencakup produk yang ada di keranjang. Hapus produk satuan terlebih dahulu bila ingin membeli bundle.'
        : 'Produk ini sudah termasuk di dalam paket bundle yang ada di keranjang.';
    }
    // Editor & Audio Tools bersifat global: bundle (trek mana pun) sudah memuatnya.
    if (GLOBAL_AUDIO_KEYS.includes(newKey) && cIsBundle) {
      return 'Produk ini sudah termasuk di dalam paket bundle yang ada di keranjang.';
    }
    if (newIsBundle && GLOBAL_AUDIO_KEYS.includes(cKey)) {
      return 'Paket bundle sudah mencakup Editor / Audio Tools yang ada di keranjang. Hapus item satuan tersebut terlebih dahulu.';
    }
  }
  return null;
}
