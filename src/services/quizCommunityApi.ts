// src/services/quizCommunityApi.ts
// Klien untuk papan peringkat & Komunitas Kuis (server/quizCommunityRoutes.ts).
// Membaca = publik. Membagikan kuis = akun login (cookie sesi dibawa otomatis oleh installAuthFetch).
import type { Deck, QuizQuestion } from '../types';

export type LeaderboardPeriod = 'daily' | 'monthly' | 'all';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  avatarUrl: string | null;
  frameId: string;
  points: number;
  correct: number;
  decks: number;
  isMe: boolean;
}

export interface LeaderboardData {
  period: LeaderboardPeriod;
  since: string | null;
  resetsAt: string | null;
  totalPlayers: number;
  entries: LeaderboardEntry[];
  me: LeaderboardEntry | null;
}

export interface SharedQuizSummary {
  id: string;
  /** Id yang dipakai QuizPlayer (berawalan "deck-custom-shared-"). */
  deckId: string;
  title: string;
  description: string;
  difficulty: string;
  questionCount: number;
  playCount: number;
  ownerName: string;
  ownerAvatarUrl: string | null;
  ownerFrameId: string;
  createdAt: string;
  updatedAt: string;
}

export interface SharedQuizFull extends SharedQuizSummary {
  questions: QuizQuestion[];
  settings: { penaltyPercent?: number; scoreUnit?: 'point' | 'percent' };
}

export interface MySharedQuiz {
  id: string;
  deckId: string;
  sourceDeckId: string;
  title: string;
  questionCount: number;
  playCount: number;
  updatedAt: string;
}

export interface MySharingState {
  /** Hasil pemeriksaan SERVER: apakah akun ini sudah membuka Kuis Editor. */
  canShare: boolean;
  limit: number;
  items: MySharedQuiz[];
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new ApiError('Tidak bisa terhubung ke server. Periksa koneksi internetmu.', 0);
  }
  if (res.status === 204) return undefined as T;
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error || data?.message || 'Terjadi kesalahan. Coba lagi.', res.status);
  return data as T;
}

/* ───────── Papan peringkat ───────── */

export const fetchLeaderboard = (period: LeaderboardPeriod) =>
  request<LeaderboardData>(`/api/public/quiz-leaderboard?period=${period}`);

// Skor TIDAK dikirim dari klien: server mencatatnya sendiri saat permainan Multiplayer Online selesai.

/* ───────── Komunitas kuis ───────── */

export const fetchSharedQuizzes = (opts: { q?: string; sort?: 'newest' | 'popular'; limit?: number; offset?: number } = {}) => {
  const p = new URLSearchParams();
  if (opts.q) p.set('q', opts.q);
  if (opts.sort) p.set('sort', opts.sort);
  if (opts.limit) p.set('limit', String(opts.limit));
  if (opts.offset) p.set('offset', String(opts.offset));
  return request<{ items: SharedQuizSummary[]; total: number }>(`/api/public/shared-quizzes?${p.toString()}`);
};

export const fetchSharedQuiz = (id: string) => request<SharedQuizFull>(`/api/public/shared-quizzes/${encodeURIComponent(id)}`);

export const countSharedQuizPlay = (id: string) =>
  request<void>(`/api/public/shared-quizzes/${encodeURIComponent(id)}/play`, { method: 'POST', body: '{}' }).catch(() => undefined);

export const fetchMySharing = () => request<MySharingState>('/api/user/shared-quizzes/mine');

export const shareQuiz = (deck: Deck) =>
  request<{ id: string; deckId: string; updated: boolean; questionCount: number }>('/api/user/shared-quizzes', {
    method: 'POST',
    body: JSON.stringify({
      deck: {
        id: deck.id,
        title: deck.title,
        description: deck.description,
        difficulty: deck.difficulty,
        questions: deck.questions,
        settings: (deck as any).settings,
      },
    }),
  });

export const unshareQuiz = (id: string) =>
  request<{ success: boolean }>(`/api/user/shared-quizzes/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Ubah kuis komunitas menjadi Deck yang bisa dimainkan QuizPlayer. */
export function sharedQuizToDeck(q: SharedQuizFull): Deck {
  const deck: any = {
    id: q.deckId,
    topicId: '',
    title: q.title,
    description: q.description,
    cardCount: q.questions.length,
    difficulty: (q.difficulty as Deck['difficulty']) || 'Sedang',
    isFree: true,
    price: 0,
    badge: `Komunitas • ${q.ownerName}`,
    questions: q.questions,
    settings: q.settings || {},
  };
  return deck as Deck;
}

/** Jam/tanggal ringkas berbahasa Indonesia. */
export function formatRelativeId(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Math.max(0, Date.now() - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} jam lalu`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} hari lalu`;
  return new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}
