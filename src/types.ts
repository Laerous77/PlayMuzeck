export type AppMode = 'audio' | 'quiz';

export interface CartItem {
  id: string;
  trackId?: string;
  title: string;
  category: 'audio' | 'deck' | 'topic' | 'creator';
  price: number;
  originalPrice?: number;
  description: string;
  badge?: string;
  itemTypeKey?: string; // for audio bundle items (e.g. 'fullMaster', 'separatedStems', etc.)
  audioId?: string;
  deckId?: string;
  topicId?: string;
}

// Tambahkan jika belum ada di src/types.ts
export interface TrackOwnership {
  fullMaster?: boolean;
  loopVersion?: boolean;
  separatedStems?: boolean;
  sheetMusic?: boolean;
}

// Perbarui AudioEntitlements
export interface AudioEntitlements {
  fullEditor8Bar: boolean;
  audioToolsSuite?: boolean; 
  byTrack?: {
    [trackId: string]: {
      fullMaster?: boolean;
      loopVersion?: boolean;
      separatedStems?: boolean;
      sheetMusic?: boolean;
    };
  };
  [key: string]: any;
}

export interface UserSession {
  isLoggedIn: boolean;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  category: string;
  /** Opsional: lampirkan gambar/audio/video pada soal (mis. animasi bukti teorema, rekaman lagu kebangsaan). */
  mediaType?: 'image' | 'audio' | 'video';
  mediaUrl?: string;
  mediaCredit?: string;
  mediaSourceUrl?: string;
}

export interface Deck {
  id: string;
  topicId: string;
  title: string;
  description: string;
  cardCount: number;
  difficulty: 'Mudah' | 'Biasa' | 'Sedang' | 'Sulit' | 'Ekstrem' | 'Tidak dispesifikasikan';
  isFree?: boolean;
  price?: number;
  badge?: string;
  questions: QuizQuestion[];
}

export interface Topic {
  id: string;
  title: string;
  iconName: string;
  description: string;
  price?: number;
  originalPrice?: number;
  badge?: string;
  isCustom?: boolean;
}

export interface StemChannelState {
  id: string;
  name: string;
  type: string;
  volume: number; // 0 to 100
  muted: boolean;
  solo: boolean;
  pan: number; // -1 to +1
  reverb: number; // 0 to 1
  delay: number; // 0 to 1
  lowEq: number; // -12 to 12
  highEq: number; // -12 to 12
  color: string;
  meterLevel: number;
  customAudioBuffer?: AudioBuffer | null;
}

export interface AudioTrackItem {
  id: string;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  duration: string;
  durationSec: number;
  coverGradient: string;
  coverIcon: string;
  licenseInfo: string;
  price: number;
  isFlagship?: boolean;
  description: string;
  stems: Array<{
    id: string;
    name: string;
    type: string;
    color: string;
    defaultVolume: number;
    audioUrl?: string;
  }>;
  chordSequence: string[];
  bassSequence: number[];
  melodySequence: number[];
  audioUrl?: string;
  loopAudioUrl?: string;
  isPublished?: boolean;
}

export interface CustomAudioInquiry {
  id: string;
  title: string;
  genre: string;
  mood: string;
  duration: string;
  notes: string;
  email: string;
  createdAt: string;
}

export interface MultiplayerPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isReady: boolean;
  score: number;
  currentStreak: number;
  avatar: string;
  lastAnswerCorrect?: boolean;
}

export interface MultiplayerRoom {
  roomCode: string;
  deckId: string;
  deckTitle: string;
  hostName: string;
  players: MultiplayerPlayer[];
  roundDurationSec: number;
  status: 'lobby' | 'countdown' | 'playing' | 'ended';
  currentQuestionIndex: number;
  roundExpiresAt?: number;
}