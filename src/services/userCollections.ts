// src/services/userCollections.ts
import { Deck, AudioTrackItem } from '../types';
import { BUILTIN_DECKS } from '../data/quiz';

export interface UserCollectionsData {
  features: {
    full16BarEditor: boolean;
    audioToolsSuite: boolean;
    quizEditor: boolean;
  };
  audio: {
    items: {
      track: AudioTrackItem;
      ownership: {
        fullMaster: boolean;
        loopVersion: boolean;
        separatedStems: boolean;
        sheetMusic: boolean;
      };
    }[];
    totalCount: number;
  };
  quiz: {
    decks: Deck[];
    /** ID deck kuis yang dimiliki user (sumber kebenaran dari database). */
    deckIds: string[];
    /** ID topik kuis yang dimiliki user. */
    topicIds: string[];
    purchasedThemeIds: string[];
    totalCount: number;
  };
  frames: {
    unlockedIds: string[];
    activeId: string;
  };
}

export const EMPTY_COLLECTIONS: UserCollectionsData = {
  features: { full16BarEditor: false, audioToolsSuite: false, quizEditor: false },
  audio: { items: [], totalCount: 0 },
  quiz: { decks: [], deckIds: [], topicIds: [], purchasedThemeIds: [], totalCount: 0 },
  frames: { unlockedIds: ['none'], activeId: 'none' },
};

// 1. FALLBACK FUNGSI LAMA:
// Dikembalikan agar komponen lain (seperti Header) yang masih memanggilnya tidak menyebabkan blank screen.
export const loadAllUserCollections = (): UserCollectionsData => {
  return EMPTY_COLLECTIONS;
};

const toStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];


/**
 * Badge deck → ID tema yang dipakai bingkai profil (lihat PROFILE_FRAMES.checkUnlocked).
 * Ditambahkan di sisi klien agar deck bawaan baru (mis. Kuliner → 'lainnya') tetap
 * membuka bingkai temanya, walau backend belum memetakan topik barunya.
 */
const BADGE_TO_THEME_ID: Record<string, string> = {
  olahraga: 'olahraga',
  'kehidupan sehari hari': 'sehari_hari',
  'kehidupan sehari-hari': 'sehari_hari',
  alam: 'alam',
  musik: 'musik',
  matematika: 'matematika',
  seni: 'seni',
  teknologi: 'teknologi',
  psikologi: 'psikologi',
  bahasa: 'bahasa',
  sosial: 'sosial',
  fiksi: 'fiksi',
  lainnya: 'lainnya',
};

const themeIdFromBadge = (badge?: string): string | null => {
  if (!badge) return null;
  const key = badge.trim().toLowerCase();
  return BADGE_TO_THEME_ID[key] ?? null;
};

const deriveThemeIdsFromOwnedBuiltins = (deckIds: string[], topicIds: string[]): string[] => {
  const ownedDecks = new Set(deckIds);
  const ownedTopics = new Set(topicIds);
  const out = new Set<string>();
  for (const d of BUILTIN_DECKS) {
    if (d.isFree) continue;
    const owned = ownedDecks.has(d.id) || Boolean(d.topicId && ownedTopics.has(d.topicId));
    if (!owned) continue;
    const themeId = themeIdFromBadge(d.badge);
    if (themeId) out.add(themeId);
  }
  return Array.from(out);
};

// 2. FUNGSI API BARU YANG TANGGUH:
export const fetchUserCollectionsFromDB = async (email?: string): Promise<UserCollectionsData> => {
  if (!email || !email.trim()) return EMPTY_COLLECTIONS;

  try {
    const response = await fetch(`/api/user/collections?email=${encodeURIComponent(email.trim())}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error('Gagal mengambil data dari database PostgreSQL');
    }

    const data = await response.json();

    // 3. JARING PENGAMAN (SAFETY NET):
    // Memaksa penggabungan data backend dengan format standar.
    // Jika backend lupa mengirim objek `frames`, `features`, dll., web tidak akan crash.
    const rawQuiz = data.quiz || {};
    const decks: Deck[] = Array.isArray(rawQuiz.decks) ? rawQuiz.decks : [];
    const backendThemeIds = toStringArray(rawQuiz.purchasedThemeIds);

    // deckIds: pakai yang dikirim backend; jika tidak ada, turunkan dari daftar decks.
    const deckIds = Array.from(
      new Set([
        ...toStringArray(rawQuiz.deckIds),
        ...decks.map((d) => d?.id).filter((id): id is string => typeof id === 'string'),
      ])
    );

    // topicIds: pakai yang dikirim backend; jika tidak ada, jatuh ke ID tema dari backend.
    const topicIds = Array.from(
      new Set([...toStringArray(rawQuiz.topicIds), ...backendThemeIds])
    );

    // purchasedThemeIds: gabungan dari backend + turunan deck bawaan yang dimiliki.
    const purchasedThemeIds = Array.from(
      new Set([...backendThemeIds, ...deriveThemeIdsFromOwnedBuiltins(deckIds, topicIds)])
    );

    return {
      features: { ...EMPTY_COLLECTIONS.features, ...(data.features || {}) },
      audio: { ...EMPTY_COLLECTIONS.audio, ...(data.audio || {}) },
      quiz: {
        ...EMPTY_COLLECTIONS.quiz,
        ...rawQuiz,
        decks,
        deckIds,
        topicIds,
        purchasedThemeIds,
      },
      frames: { ...EMPTY_COLLECTIONS.frames, ...(data.frames || {}) },
    };
  } catch (error) {
    console.error('[DB Sync Error] Koneksi ke database gagal:', error);
    return EMPTY_COLLECTIONS;
  }
};