// src/services/routes.ts
// Pemetaan URL <-> halaman PlayMuzeck (tanpa dependensi React supaya mudah dites).
//
//   /                  Halaman Utama
//   /audio             -> dialihkan ke bagian Audio Studio terakhir yang dibuka, bila belum ada ke /audio/tools
//   /audio/assets      Aset Audio
//   /audio/pad         Pad Editor
//   /audio/tools       Audio Tools   (/audio/tools/<slug-alat> membuka alat tertentu)
//   /audio/pricing     Harga & Lisensi
//   /quiz              -> dialihkan ke segmen Pusat Kuis terakhir yang dibuka, bila belum ada ke /quiz/library
//   /quiz/download     Unduh Web App
//   /quiz/play         Mainkan Kuis
//   /quiz/library      Perpustakaan Kuis
//   /quiz/hall         Aula Komunitas
//
// Tautan lama dari halaman SEO (/alat-audio dan /alat-audio/<slug>) tetap berfungsi dan membuka Audio Tools.
import { QUIZ_SEGMENTS, DEFAULT_QUIZ_SEGMENT, normalizeQuizSegment, type QuizSegment } from '../components/PusatKuis/quizSegments';

export type AudioSection = 'assets' | 'pad' | 'tools' | 'pricing';
export type RouteMode = 'index' | 'audio' | 'quiz';

export const AUDIO_SECTIONS: readonly AudioSection[] = ['assets', 'pad', 'tools', 'pricing'];
export const DEFAULT_AUDIO_SECTION: AudioSection = 'tools';

// Nama internal segmen kuis tetap ('pwa' | 'play' | 'all' | 'community') supaya data tersimpan pengguna lama tidak rusak;
// yang berubah hanya slug di URL.
export const QUIZ_SLUG: Record<QuizSegment, string> = {
  pwa: 'download',
  play: 'play',
  all: 'library',
  community: 'hall',
};
const QUIZ_FROM_SLUG: Record<string, QuizSegment> = Object.fromEntries(
  (Object.keys(QUIZ_SLUG) as QuizSegment[]).map((k) => [QUIZ_SLUG[k], k])
);

export function isAudioSection(v: unknown): v is AudioSection {
  return (AUDIO_SECTIONS as readonly unknown[]).includes(v);
}

/** Nilai tersimpan -> bagian audio yang valid; kosong/rusak -> Audio Tools. */
export function resolveAudioSection(saved: unknown): AudioSection {
  return isAudioSection(saved) ? saved : DEFAULT_AUDIO_SECTION;
}

/** Nilai tersimpan -> segmen kuis yang valid; kosong/rusak -> Perpustakaan Kuis. */
export function resolveQuizSegment(saved: unknown): QuizSegment {
  return normalizeQuizSegment(saved);
}

export type ParsedRoute =
  | { kind: 'index' }
  | { kind: 'audio'; section: AudioSection | null; toolSlug: string | null }
  | { kind: 'quiz'; segment: QuizSegment | null }
  | { kind: 'legacy-tools'; toolSlug: string | null } // /alat-audio[/<slug>] dari halaman SEO
  | { kind: 'passthrough' } // /verify-email, /reset-password: ditangani sendiri oleh App
  | { kind: 'unknown' };

const PASSTHROUGH = new Set(['verify-email', 'reset-password']);

export function parseRoute(pathname: string): ParsedRoute {
  const parts = String(pathname || '/')
    .split('/')
    .filter(Boolean)
    .map((p) => {
      try { return decodeURIComponent(p).toLowerCase(); } catch { return p.toLowerCase(); }
    });
  if (parts.length === 0) return { kind: 'index' };
  const [root, second, third] = parts;
  if (PASSTHROUGH.has(root)) return { kind: 'passthrough' };
  if (root === 'alat-audio') return { kind: 'legacy-tools', toolSlug: second || null };
  if (root === 'audio') {
    const section = isAudioSection(second) ? second : null;
    return { kind: 'audio', section, toolSlug: section === 'tools' ? third || null : null };
  }
  if (root === 'quiz') {
    return { kind: 'quiz', segment: second && QUIZ_FROM_SLUG[second] ? QUIZ_FROM_SLUG[second] : null };
  }
  return { kind: 'unknown' };
}

export function buildPath(mode: RouteMode, audio: AudioSection, quiz: QuizSegment): string {
  if (mode === 'audio') return `/audio/${audio}`;
  if (mode === 'quiz') return `/quiz/${QUIZ_SLUG[quiz]}`;
  return '/';
}

/** URL yang masih perlu dirapikan (dialihkan dengan replace, bukan menambah riwayat). */
export function isAliasRoute(r: ParsedRoute): boolean {
  return (
    r.kind === 'unknown' ||
    r.kind === 'legacy-tools' ||
    (r.kind === 'audio' && (!r.section || (r.section === 'tools' && !!r.toolSlug))) ||
    (r.kind === 'quiz' && !r.segment)
  );
}

export { QUIZ_SEGMENTS, DEFAULT_QUIZ_SEGMENT };

// ── Slug alat yang ada di URL saat halaman pertama dimuat ─────────────────────
// Dibaca pada saat modul dimuat (sebelum App merapikan URL) supaya tamu yang harus masuk dulu
// tetap dibawa ke alat yang dituju setelah login.
let initialToolSlug: string | null = null;
try {
  if (typeof window !== 'undefined') {
    const r = parseRoute(window.location.pathname);
    if (r.kind === 'legacy-tools' || r.kind === 'audio') initialToolSlug = r.toolSlug;
  }
} catch {}
export function peekInitialToolSlug(): string | null {
  return initialToolSlug;
}
export function clearInitialToolSlug(): void {
  initialToolSlug = null;
}
