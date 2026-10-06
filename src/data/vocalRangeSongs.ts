// src/data/vocalRangeSongs.ts
// Contoh lagu untuk hasil Tes Vocal Range.
//
// Setiap lagu ditulis relatif terhadap tonikanya (kunci acuan), jadi rentang melodi utamanya bisa digeser ke kunci
// mana pun (transposisi) agar pas dengan suara pengguna. `lo`/`hi` = semiton di bawah/atas tonika untuk nada
// terendah/tertinggi MELODI UTAMA (bukan harmoni).
//
// Hanya melodi yang notasinya diverifikasi yang dimasukkan. Daftar ini sengaja mudah ditambah: cukup tambah
// satu objek di SONGS. Rentang lagu populer sering berbeda antar versi/kunci, jadi tambahkan hanya setelah dicek ke partitur.
export interface SongEntry {
  id: string;
  title: string;
  artist: string;
  /** Tonika kunci acuan (MIDI). */
  tonic: number;
  /** Semiton dari tonika ke nada melodi terendah (boleh negatif). */
  lo: number;
  /** Semiton dari tonika ke nada melodi tertinggi. */
  hi: number;
  note?: string;
}

export const SONGS: SongEntry[] = [
  { id: 'hot-cross-buns', title: 'Hot Cross Buns', artist: 'Tradisional', tonic: 60, lo: 0, hi: 4, note: 'Tiga nada: do-re-mi. Cocok untuk suara yang baru mulai.' },
  { id: 'mary-lamb', title: 'Mary Had a Little Lamb', artist: 'Tradisional', tonic: 60, lo: 0, hi: 7 },
  { id: 'ode-to-joy', title: 'Ode to Joy (Ludwig van Beethoven)', artist: 'Beethoven', tonic: 60, lo: 0, hi: 7, note: 'Melodi tema Simfoni No. 9; bergerak selangkah demi selangkah.' },
  { id: 'saints', title: 'When the Saints Go Marching In', artist: 'Tradisional', tonic: 60, lo: 0, hi: 7 },
  { id: 'twinkle', title: 'Twinkle, Twinkle, Little Star', artist: 'Tradisional', tonic: 60, lo: 0, hi: 9 },
  { id: 'london-bridge', title: 'London Bridge Is Falling Down', artist: 'Tradisional', tonic: 60, lo: 0, hi: 9 },
  { id: 'row-boat', title: 'Row, Row, Row Your Boat', artist: 'Tradisional', tonic: 60, lo: 0, hi: 12, note: 'Tepat satu oktaf (do ke do tinggi).' },
  { id: 'joy-world', title: 'Joy to the World', artist: 'Lowell Mason / G. F. Handel', tonic: 60, lo: 0, hi: 12, note: 'Dibuka dengan tangga nada turun satu oktaf penuh.' },
  { id: 'happy-birthday', title: 'Happy Birthday to You', artist: 'Tradisional', tonic: 67, lo: -5, hi: 7, note: 'Dalam kunci G: D4 sampai D5, satu oktaf. Nada tertinggi ada pada kata "dear".' },
  { id: 'star-spangled', title: 'The Star-Spangled Banner', artist: 'John Stafford Smith', tonic: 60, lo: 0, hi: 19, note: 'Terkenal sulit: rentang melodinya satu oktaf + kuint (19 semiton).' },
];

// ───────────────────────── Pencocokan lagu dengan rentang suara ─────────────────────────

export type FitLevel = 'comfort' | 'range' | 'challenge';

export interface SongFit {
  song: SongEntry;
  level: FitLevel;
  /** Geseran kunci dalam semiton dari kunci acuan (0 = kunci asli). */
  shift: number;
  /** Nada melodi terendah/tertinggi/tonika setelah digeser (MIDI). */
  low: number;
  high: number;
  tonic: number;
  /** Untuk 'challenge': berapa semiton lagi yang dibutuhkan agar muat di rentang penuh. */
  shortBy: number;
}

const clampInt = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Untuk tiap lagu cari geseran kunci (transposisi) terkecil yang membuat seluruh melodi muat:
 *  - 'comfort'   : muat di wilayah nyaman (tessitura),
 *  - 'range'     : muat di rentang penuh (terasa menantang di ujung),
 *  - 'challenge' : kurang ≤ 3 semiton dari rentang penuh (latihan memperluas jangkauan).
 * Lagu yang lebih lebar dari itu tidak ditampilkan.
 */
export function fitSongs(userLow: number, userHigh: number, tessLow: number, tessHigh: number, songs: SongEntry[] = SONGS): SongFit[] {
  const out: SongFit[] = [];
  for (const song of songs) {
    const lo0 = song.tonic + song.lo, hi0 = song.tonic + song.hi;
    const cMin = tessLow - lo0, cMax = tessHigh - hi0;
    const rMin = userLow - lo0, rMax = userHigh - hi0;
    let level: FitLevel, shift: number, shortBy = 0;
    if (cMin <= cMax) { level = 'comfort'; shift = clampInt(0, cMin, cMax); }
    else if (rMin <= rMax) { level = 'range'; shift = clampInt(0, rMin, rMax); }
    else if (rMin - rMax <= 3) { level = 'challenge'; shift = Math.round((rMin + rMax) / 2); shortBy = rMin - rMax; }
    else continue;
    out.push({ song, level, shift, low: lo0 + shift, high: hi0 + shift, tonic: song.tonic + shift, shortBy });
  }
  const order: Record<FitLevel, number> = { comfort: 0, range: 1, challenge: 2 };
  return out.sort((a, b) =>
    order[a.level] - order[b.level] ||
    Math.abs(a.shift) - Math.abs(b.shift) ||
    (b.song.hi - b.song.lo) - (a.song.hi - a.song.lo));
}
