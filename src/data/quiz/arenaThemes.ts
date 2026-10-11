// src/data/quiz/arenaThemes.ts
//
// Daftar 12 tema DECK PRESET ARENA GLOBAL (urut dari "Alam" sampai "Teknologi"), dipakai bersama oleh server
// (server/arenaPresetRoutes.ts, server/globalArena.ts, server/quizCommunityRoutes.ts) dan panel admin
// (src/admin/pages/ArenaDecksPage.tsx). Satu tema = satu deck berisi tepat ARENA_DECK_SIZE soal.
//
// Deck preset Arena TIDAK termasuk BUILTIN_DECKS / STARTER_DECKS, jadi tidak pernah muncul di Perpustakaan Pusat Kuis.
// Isinya disimpan di database (tabel arena_preset_decks) dan hanya bisa diubah oleh admin.

export const ARENA_DECK_SIZE = 20;

export interface ArenaTheme {
  id: string;
  title: string;
  description: string;
}

export const ARENA_THEMES: readonly ArenaTheme[] = [
  { id: 'alam', title: 'Alam', description: 'Ekosistem, flora, fauna, geografi, iklim, dan konservasi bumi.' },
  { id: 'bahasa', title: 'Bahasa', description: 'Linguistik, kosakata, tata bahasa, etimologi, dan aksara dunia.' },
  { id: 'fiksi', title: 'Fiksi', description: 'Dunia fantasi, mitologi, komik, film, karakter novel, dan cerita rekaan.' },
  { id: 'lainnya', title: 'Lainnya', description: 'Topik pengetahuan umum dan kategori minat khusus lainnya.' },
  { id: 'matematika', title: 'Matematika', description: 'Aritmetika, logika, aljabar, geometri, kalkulus, dan probabilitas.' },
  { id: 'musikdunia', title: 'Musik', description: 'Teori musik, instrumen, genre, musisi legendaris, dan akustik.' },
  { id: 'olahraga', title: 'Olahraga', description: 'Aktivitas fisik, atletik, kejuaraan, dan cabang olahraga dunia.' },
  { id: 'psikologi', title: 'Psikologi', description: 'Perilaku kognitif, emosi, kepribadian, persepsi, dan interaksi sosial.' },
  { id: 'seharihari', title: 'Kehidupan Sehari hari', description: 'Kebiasaan hidup, rutinitas, finansial rumah tangga, dan gaya hidup.' },
  { id: 'seni', title: 'Seni', description: 'Seni rupa, arsitektur, desain visual, sastra, teater, dan budaya.' },
  { id: 'sosial', title: 'Sosial', description: 'Sosiologi, hubungan kemasyarakatan, antropologi, dan sejarah dunia.' },
  { id: 'teknologi', title: 'Teknologi', description: 'Pemrograman, kecerdasan buatan, perangkat keras, dan inovasi web.' },
] as const;

export const ARENA_THEME_IDS: readonly string[] = ARENA_THEMES.map((t) => t.id);

export const isArenaThemeId = (id: unknown): id is string => typeof id === 'string' && ARENA_THEME_IDS.includes(id);

export const getArenaTheme = (id: string): ArenaTheme | undefined => ARENA_THEMES.find((t) => t.id === id);

const PRESET_PREFIX = 'arena-preset-';

/** Id deck di sisi arena / papan peringkat untuk sebuah tema, mis. "arena-preset-alam". */
export const presetDeckId = (themeId: string) => `${PRESET_PREFIX}${themeId}`;

/** Kebalikannya: id tema bila `deckId` adalah deck preset Arena yang sah, selain itu null. */
export function parsePresetDeckId(deckId: unknown): string | null {
  const s = String(deckId ?? '');
  if (!s.startsWith(PRESET_PREFIX)) return null;
  const theme = s.slice(PRESET_PREFIX.length);
  return isArenaThemeId(theme) ? theme : null;
}