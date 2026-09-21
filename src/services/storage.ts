import { AudioEntitlements, CartItem, UserSession, CustomAudioInquiry, Deck, Topic } from '../types';
import { scopedKey, removeAllScopedVariants } from './userScope';

const STORAGE_KEYS = {
  CART: 'muzeck_cart_v1',
  ENTITLEMENTS: 'muzeck_audio_entitlements_v1',
  UNLOCKED_DECKS: 'muzeck_unlocked_decks_v1',
  UNLOCKED_TOPICS: 'muzeck_unlocked_topics_v1',
  CUSTOM_DECKS: 'muzeck_custom_decks_v1',
  CUSTOM_TOPICS: 'muzeck_custom_topics_v1',
  USER_SESSION: 'muzeck_user_session_v1',
  USER_CHOICE_CLAIMED: 'muzeck_user_choice_claimed_v1',
  CUSTOM_INQUIRIES: 'muzeck_custom_inquiries_v1',
  ACTIVE_AUDIO_ID: 'muzeck_active_audio_id_v1',
};

export const defaultEntitlements: AudioEntitlements = {
  fullMaster: false,
  loopVersion: false,
  separatedStems: false,
  sheetMusic: false,
  fullEditor8Bar: false,
  ownedAudioIds: [],
};

export const defaultUserSession: UserSession = {
  isLoggedIn: false,
  name: 'Tamu PlayMuzeck',
  email: '',
};

// Security sanitization helper
export function sanitizeInput(input: string): string {
  if (!input) return '';
  return input
    .replace(/[<>]/g, '') // remove HTML tags
    .trim()
    .slice(0, 500); // limit length
}

// PERBAIKAN BUG KEBOCORAN DATA ANTAR AKUN: sebelumnya kunci localStorage
// untuk deck & topik kustom (muzeck_custom_decks_v1 / muzeck_custom_topics_v1)
// SAMA RATA untuk siapapun yang memakai browser/perangkat yang sama, tidak
// terikat ke akun sama sekali. Akibatnya kuis buatan Akun A masih tersimpan
// di localStorage device tsb, dan begitu Akun B login di device yang sama,
// kuis milik Akun A ikut muncul (bahkan bisa diedit/dihapus Akun B), padahal
// keduanya sudah beda email/username. Sekarang kunci localStorage untuk data
// kustom di-scope per email pengguna yang sedang login, sehingga tiap akun
// hanya melihat kuis kustomnya sendiri di localStorage perangkat tsb.
const getScopedCustomKey = scopedKey;

export const storage = {
  getCart(): CartItem[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CART);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  setCart(cart: CartItem[]) {
    try {
      localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(cart));
    } catch {}
  },

  getEntitlements(): AudioEntitlements {
    try {
      const data = localStorage.getItem(scopedKey(STORAGE_KEYS.ENTITLEMENTS));
      return data ? { ...defaultEntitlements, ...JSON.parse(data) } : defaultEntitlements;
    } catch {
      return defaultEntitlements;
    }
  },

  setEntitlements(entitlements: AudioEntitlements) {
    try {
      localStorage.setItem(scopedKey(STORAGE_KEYS.ENTITLEMENTS), JSON.stringify(entitlements));
    } catch {}
  },

  // --- TOPICS & DECKS OWNERSHIP ---
  getUnlockedTopics(): string[] {
    try {
      const data = localStorage.getItem(scopedKey(STORAGE_KEYS.UNLOCKED_TOPICS));
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  setUnlockedTopics(topicIds: string[]) {
    try {
      localStorage.setItem(scopedKey(STORAGE_KEYS.UNLOCKED_TOPICS), JSON.stringify(topicIds));
    } catch {}
  },

  getUnlockedDecks(): string[] {
    try {
      const data = localStorage.getItem(scopedKey(STORAGE_KEYS.UNLOCKED_DECKS));
      const defaultUnlocked = ['deck-starter-1', 'deck-starter-2', 'deck-starter-3']; // 3 deck gratis
      if (!data) return defaultUnlocked;
      const parsed = JSON.parse(data);
      return Array.from(new Set([...defaultUnlocked, ...parsed]));
    } catch {
      return ['deck-starter-1', 'deck-starter-2', 'deck-starter-3'];
    }
  },

  setUnlockedDecks(deckIds: string[]) {
    try {
      localStorage.setItem(scopedKey(STORAGE_KEYS.UNLOCKED_DECKS), JSON.stringify(deckIds));
    } catch {}
  },

  // --- CUSTOM DECKS & TOPICS (PERSISTEN DI LOCALSTORAGE, DI-SCOPE PER AKUN) ---
  getCustomDecks(): Deck[] {
    try {
      const data = localStorage.getItem(getScopedCustomKey(STORAGE_KEYS.CUSTOM_DECKS));
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveCustomDeck(deck: Deck) {
    try {
      const key = getScopedCustomKey(STORAGE_KEYS.CUSTOM_DECKS);
      const current = this.getCustomDecks();
      const existingIdx = current.findIndex((d) => d.id === deck.id);
      if (existingIdx >= 0) {
        current[existingIdx] = deck;
      } else {
        current.unshift(deck);
      }
      localStorage.setItem(key, JSON.stringify(current));

      // Automatically unlock custom decks created by user
      const unlocked = this.getUnlockedDecks();
      if (!unlocked.includes(deck.id)) {
        unlocked.push(deck.id);
        this.setUnlockedDecks(unlocked);
      }
    } catch {}
  },

  deleteCustomDeck(deckId: string) {
    try {
      const key = getScopedCustomKey(STORAGE_KEYS.CUSTOM_DECKS);
      const current = this.getCustomDecks().filter((d) => d.id !== deckId);
      localStorage.setItem(key, JSON.stringify(current));
    } catch {}
  },

  getCustomTopics(): Topic[] {
    try {
      const data = localStorage.getItem(getScopedCustomKey(STORAGE_KEYS.CUSTOM_TOPICS));
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  saveCustomTopic(topic: Topic) {
    try {
      const key = getScopedCustomKey(STORAGE_KEYS.CUSTOM_TOPICS);
      const current = this.getCustomTopics();
      const existingIdx = current.findIndex((t) => t.id === topic.id);
      if (existingIdx >= 0) {
        current[existingIdx] = topic;
      } else {
        current.unshift(topic);
      }
      localStorage.setItem(key, JSON.stringify(current));
    } catch {}
  },

  deleteCustomTopic(topicId: string) {
    try {
      const key = getScopedCustomKey(STORAGE_KEYS.CUSTOM_TOPICS);
      const current = this.getCustomTopics().filter((t) => t.id !== topicId);
      localStorage.setItem(key, JSON.stringify(current));
    } catch {}
  },

  getAllTopics(): Topic[] {
    return this.getCustomTopics();
  },

  getAllDecks(): Deck[] {
    return this.getCustomDecks();
  },

  // Active audio selection
  getActiveAudioId(): string {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_AUDIO_ID) || 'track-cahaya-cakrawala';
  },

  setActiveAudioId(id: string) {
    try {
      localStorage.setItem(STORAGE_KEYS.ACTIVE_AUDIO_ID, id);
    } catch {}
  },

  // User session
  getUserSession(): UserSession {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.USER_SESSION);
      return data ? JSON.parse(data) : defaultUserSession;
    } catch {
      return defaultUserSession;
    }
  },

  setUserSession(session: UserSession) {
    try {
      localStorage.setItem(STORAGE_KEYS.USER_SESSION, JSON.stringify(session));
    } catch {}
  },

  getUserChoiceClaimed(): boolean {
    try {
      return localStorage.getItem(scopedKey(STORAGE_KEYS.USER_CHOICE_CLAIMED)) === 'true';
    } catch {
      return false;
    }
  },

  setUserChoiceClaimed(claimed: boolean) {
    try {
      localStorage.setItem(scopedKey(STORAGE_KEYS.USER_CHOICE_CLAIMED), claimed ? 'true' : 'false');
    } catch {}
  },

  getCustomInquiries(): CustomAudioInquiry[] {
    try {
      const data = localStorage.getItem(STORAGE_KEYS.CUSTOM_INQUIRIES);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  addCustomInquiry(inquiry: CustomAudioInquiry) {
    try {
      const list = this.getCustomInquiries();
      list.unshift(inquiry);
      localStorage.setItem(STORAGE_KEYS.CUSTOM_INQUIRIES, JSON.stringify(list));
    } catch {}
  },

  resetAllData() {
    try {
      Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
      // Key deck/topik kustom sekarang di-scope per akun (mis.
      // "muzeck_custom_decks_v1::budi@mail.com"), jadi tidak akan langsung
      // cocok dengan STORAGE_KEYS di atas. Sapu bersih semua varian
      // ber-scope juga supaya tombol "Reset Semua Data" tetap berfungsi utuh.
      removeAllScopedVariants([
        STORAGE_KEYS.CUSTOM_DECKS,
        STORAGE_KEYS.CUSTOM_TOPICS,
        STORAGE_KEYS.ENTITLEMENTS,
        STORAGE_KEYS.UNLOCKED_DECKS,
        STORAGE_KEYS.UNLOCKED_TOPICS,
        STORAGE_KEYS.USER_CHOICE_CLAIMED,
        'muzeck_custom_decks_json',
        'muzeck_quiz_results',
        'muzeck_quiz_purchased_decks',
      ]);
    } catch {}
  },
};
