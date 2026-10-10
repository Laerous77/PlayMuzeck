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
  { id: 'alam', title: 'Alam & Lingkungan', description: 'Geologi, cuaca, hewan, tumbuhan, dan fenomena bumi.' },
  { id: 'bahasa', title: 'Bahasa & Linguistik', description: 'Tata bahasa, asal-usul aksara, dan ragam bahasa dunia.' },
  { id: 'fiksi', title: 'Fiksi & Imajinasi', description: 'Novel, dongeng, dan tokoh-tokoh dunia khayal.' },
  { id: 'kuliner', title: 'Kuliner Dunia', description: 'Makanan, rempah, dan minuman khas Nusantara dan dunia.' },
  { id: 'matematika', title: 'Matematika Esensial', description: 'Hitungan, geometri, dan logika.' },
  { id: 'musikdunia', title: 'Musik Dunia', description: 'Tokoh, genre, dan instrumen musik dari berbagai benua.' },
  { id: 'olahraga', title: 'Olahraga Dunia', description: 'Aturan, sejarah, dan lambang olahraga dunia.' },
  { id: 'psikologi', title: 'Psikologi', description: 'Perilaku, pikiran, kepribadian, dan eksperimen klasik.' },
  { id: 'seharihari', title: 'Hidup Sehari-hari', description: 'Kesehatan, keuangan, dan urusan rumah tangga.' },
  { id: 'seni', title: 'Seni & Budaya', description: 'Lukisan, musik, tari, dan warisan budaya dunia.' },
  { id: 'sosial', title: 'Masyarakat & Organisasi Dunia', description: 'Struktur sosial, organisasi internasional, dan isu kemasyarakatan.' },
  { id: 'teknologi', title: 'Teknologi Digital', description: 'Komputer, internet, AI, dan penemuan teknologi dunia.' },
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
