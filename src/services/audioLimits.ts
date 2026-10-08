// src/services/audioLimits.ts
// Batas panjang audio untuk SEMUA berkas yang dimasukkan ke, atau dihasilkan oleh, Audio Tools.
//
//  - 90 menit: alat yang lazim dipakai untuk audio panjang (podcast, kuliah, rekaman acara, audiobook):
//    potong, atur volume, konversi, kompres, gabung, dan rapikan.
//  - 60 menit: semua alat lain (olah nada & tempo, balik, ulangi, noise, vokal, deteksi, rekam, latihan).
//    Alat-alat ini memakan memori/CPU jauh lebih besar per menit audio, atau memang tidak lazim untuk audio panjang.
//
// Batas berlaku di dua tempat: (1) berkas MASUK (durasi hasil decode), dan (2) berkas KELUAR (hasil yang akan diunduh),
// karena sebagian alat mengubah durasi (tempo, ulangi, gabung, pitch tanpa kunci tempo).
// Pengecualian: alat 'metadata' (Edit Metadata) tidak men-decode audio sama sekali, jadi tidak dibatasi durasi;
// batasnya ukuran berkas (lihat MAX_FILE_BYTES di audioMetadata.ts).

export const LONG_AUDIO_MAX_MINUTES = 90;
export const STANDARD_AUDIO_MAX_MINUTES = 60;

/** Alat yang umum dipakai untuk audio panjang (batas 90 menit). Semua ID lain memakai 60 menit. */
export const LONG_AUDIO_TOOL_IDS = [
  'trim', 'volume', 'convert', 'compress', 'merge', 'clean',
] as const;

const LONG_SET = new Set<string>(LONG_AUDIO_TOOL_IDS);

/** Toleransi (detik) untuk pembulatan durasi hasil decode, mis. berkas "60:00" yang terbaca 3600,02 dtk. */
const TOLERANCE_SEC = 1;

export const maxMinutesFor = (toolId: string): number =>
  LONG_SET.has(toolId) ? LONG_AUDIO_MAX_MINUTES : STANDARD_AUDIO_MAX_MINUTES;

export const maxSecondsFor = (toolId: string): number => maxMinutesFor(toolId) * 60;

export const limitLabelFor = (toolId: string): string => `${maxMinutesFor(toolId)} menit`;

/** 5425 -> "1 jam 30 menit", 754 -> "12 menit 34 dtk", 40 -> "40 dtk". */
export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h} jam ${m} menit` : `${h} jam`;
  if (m > 0) return r > 0 ? `${m} menit ${r} dtk` : `${m} menit`;
  return `${r} dtk`;
}

export const isOverLimit = (toolId: string, sec: number): boolean =>
  Number.isFinite(sec) && sec > maxSecondsFor(toolId) + TOLERANCE_SEC;

/** Pesan galat bila berkas MASUK terlalu panjang untuk alat ini; null bila aman. */
export function checkInputDuration(toolId: string, sec: number): string | null {
  if (!isOverLimit(toolId, sec)) return null;
  const limit = maxMinutesFor(toolId);
  const hint =
    limit < LONG_AUDIO_MAX_MINUTES && sec <= LONG_AUDIO_MAX_MINUTES * 60 + TOLERANCE_SEC
      ? ` Potong dulu lewat alat Trim / Cut (batasnya ${LONG_AUDIO_MAX_MINUTES} menit).`
      : ' Gunakan berkas yang lebih pendek.';
  return `Durasi audio ${formatDuration(sec)} melebihi batas alat ini (maks. ${limit} menit).${hint}`;
}

/** Pesan galat bila berkas KELUAR (hasil yang akan diunduh) terlalu panjang; null bila aman. */
export function checkOutputDuration(toolId: string, sec: number): string | null {
  if (!isOverLimit(toolId, sec)) return null;
  return `Hasil akan berdurasi ${formatDuration(sec)}, melebihi batas ${maxMinutesFor(toolId)} menit per berkas untuk alat ini. Perpendek audio atau kurangi pengaturannya.`;
}

/** Berapa kali audio berdurasi `sec` boleh diulang (maks `cap`) supaya hasilnya tidak melewati batas alat. */
export function maxRepeatsFor(toolId: string, sec: number, cap = 5, crossfadeSec = 0): number {
  if (!(sec > 0)) return 0;
  const limit = maxSecondsFor(toolId) + TOLERANCE_SEC;
  const cf = Math.max(0, Math.min(crossfadeSec, sec / 2));
  let n = 0;
  // durasi hasil = n * sec - (n - 1) * crossfade
  while (n < cap && (n + 1) * sec - n * cf <= limit) n++;
  return n;
}

/** Durasi hasil pengulangan `times` kali dengan crossfade antar-ulangan (detik). */
export const repeatedDuration = (sec: number, times: number, crossfadeSec = 0): number => {
  const cf = Math.max(0, Math.min(crossfadeSec, sec / 2));
  return times * sec - Math.max(0, times - 1) * cf;
};
