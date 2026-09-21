// src/services/quizPurchases.ts
// Akses deck kuis: 3 starter GRATIS, kuis buatan sendiri (Kuis Editor) GRATIS,
// deck bawaan lain berbayar (Rp3.000/deck) lewat keranjang -> tersimpan di profil setelah dibeli.
import { useEffect, useState } from 'react';
import type { CartItem, Deck } from '../types';
import { BUILTIN_DECKS, isBuiltinDeckId } from '../data/quiz';
import { scopedKey, USER_SCOPE_EVENT } from './userScope';

export const PURCHASED_DECKS_KEY = 'muzeck_quiz_purchased_decks';
export const PURCHASES_EVENT = 'muzeck-quiz-purchases-changed';
export const DECK_PRICE = 3000;
export const QUIZ_DECK_ITEM_KEY = 'quizDeck';

export function getPurchasedDeckIds(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(scopedKey(PURCHASED_DECKS_KEY)) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function markDecksPurchased(ids: string[]) {
  if (!ids.length) return;
  const merged = Array.from(new Set([...getPurchasedDeckIds(), ...ids]));
  try {
    localStorage.setItem(scopedKey(PURCHASED_DECKS_KEY), JSON.stringify(merged));
  } catch {
    /* abaikan */
  }
  window.dispatchEvent(new Event(PURCHASES_EVENT));
}

/** Dipanggil CartDrawer saat pembayaran sukses: tandai deck kuis di keranjang sebagai terbeli. */
export function recordQuizDeckPurchases(items: CartItem[]) {
  markDecksPurchased(
    items.filter((i: any) => i.itemTypeKey === QUIZ_DECK_ITEM_KEY).map((i) => i.id)
  );
}

/** true bila deck boleh dimainkan: gratis, buatan sendiri, sudah dibeli, atau sudah di-unlock induk. */
export function isDeckAccessible(deck: Deck, extraUnlockedIds: string[] = []): boolean {
  if (!isBuiltinDeckId(deck.id)) return true; // kuis buatan sendiri
  if (deck.isFree) return true; // 3 starter
  return getPurchasedDeckIds().includes(deck.id) || extraUnlockedIds.includes(deck.id);
}

export function getPurchasedBuiltinDecks(): Deck[] {
  const ids = getPurchasedDeckIds();
  return BUILTIN_DECKS.filter((d) => !d.isFree && ids.includes(d.id));
}

export function deckToCartItem(deck: Deck): CartItem {
  return {
    id: deck.id,
    title: `Deck Kuis: ${deck.title}`,
    category: 'deck',
    price: deck.price || DECK_PRICE,
    description: `${deck.cardCount} soal • ${deck.description}`,
    itemTypeKey: QUIZ_DECK_ITEM_KEY,
  } as any;
}

/** Hook: render ulang komponen saat ada pembelian baru. Mengembalikan id deck yang sudah dibeli. */
export function usePurchasedDeckIds(): string[] {
  const [ids, setIds] = useState<string[]>(() => getPurchasedDeckIds());
  useEffect(() => {
    const sync = () => setIds(getPurchasedDeckIds());
    window.addEventListener(PURCHASES_EVENT, sync);
    window.addEventListener('storage', sync);
    window.addEventListener(USER_SCOPE_EVENT, sync);
    return () => {
      window.removeEventListener(PURCHASES_EVENT, sync);
      window.removeEventListener('storage', sync);
      window.removeEventListener(USER_SCOPE_EVENT, sync);
    };
  }, []);
  return ids;
}
