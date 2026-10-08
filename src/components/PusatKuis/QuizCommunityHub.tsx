// src/components/PusatKuis/QuizCommunityHub.tsx
// Segmen gabungan "Komunitas & Peringkat" Pusat Kuis: satu tempat untuk menelusuri/membagikan kuis
// buatan pengguna (Komunitas Kuis) dan melihat Papan Peringkat (harian, bulanan, sepanjang waktu).
import React, { useState } from 'react';
import { Globe, Trophy } from 'lucide-react';
import type { Deck } from '../../types';
import { QuizCommunity } from './QuizCommunity';
import { QuizLeaderboard } from './QuizLeaderboard';

export type CommunityHubTab = 'community' | 'leaderboard';

const TAB_KEY = 'muzeck_quiz_hub_tab';

function readSavedTab(): CommunityHubTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'leaderboard' ? 'leaderboard' : 'community';
  } catch {
    return 'community';
  }
}

interface QuizCommunityHubProps {
  isLoggedIn: boolean;
  /** Kuis buatan Kuis Editor milik akun ini (kandidat untuk dibagikan). */
  ownDecks: Deck[];
  onPlay: (deck: Deck) => void;
  /** Dipakai tombol "Main Multiplayer" di papan peringkat (membuka modal Multiplayer Online). */
  onPlayNow: () => void;
  onOpenLibrary: () => void;
  onToast?: (msg: string) => void;
}

const TABS: { key: CommunityHubTab; label: string; icon: typeof Globe }[] = [
  { key: 'community', label: 'Kuis Komunitas', icon: Globe },
  { key: 'leaderboard', label: 'Papan Peringkat', icon: Trophy },
];

export const QuizCommunityHub: React.FC<QuizCommunityHubProps> = ({
  isLoggedIn,
  ownDecks,
  onPlay,
  onPlayNow,
  onOpenLibrary,
  onToast,
}) => {
  const [tab, setTab] = useState<CommunityHubTab>(readSavedTab);

  const selectTab = (next: CommunityHubTab) => {
    setTab(next);
    try {
      localStorage.setItem(TAB_KEY, next);
    } catch {
      /* penyimpanan penuh / diblokir: abaikan, tab tetap berganti */
    }
  };

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = tab === 'community' ? 'leaderboard' : 'community';
    selectTab(next);
    document.getElementById(`quiz-hub-tab-${next}`)?.focus();
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div
        role="tablist"
        aria-label="Komunitas dan peringkat"
        className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-surface border border-white/10 max-w-md"
      >
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              id={`quiz-hub-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`quiz-hub-panel-${t.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => selectTab(t.key)}
              onKeyDown={onTabKeyDown}
              className={`px-3 sm:px-5 py-2.5 rounded-xl text-xs font-black flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                on ? 'bg-accent2 text-on-accent2 shadow' : 'text-gray-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <t.icon className="w-4 h-4 shrink-0" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Komunitas tetap terpasang (hanya disembunyikan) supaya pencarian & daftar yang sudah dimuat tidak hilang
          saat pindah tab. Papan peringkat hanya dipasang saat dibuka, jadi segar otomatis dan tidak menyegarkan di latar belakang. */}
      <div id="quiz-hub-panel-community" role="tabpanel" aria-labelledby="quiz-hub-tab-community" hidden={tab !== 'community'}>
        <QuizCommunity isLoggedIn={isLoggedIn} ownDecks={ownDecks} onPlay={onPlay} onOpenLibrary={onOpenLibrary} onToast={onToast} />
      </div>

      {tab === 'leaderboard' && (
        <div id="quiz-hub-panel-leaderboard" role="tabpanel" aria-labelledby="quiz-hub-tab-leaderboard">
          <QuizLeaderboard isLoggedIn={isLoggedIn} onPlayNow={onPlayNow} onOpenCommunity={() => selectTab('community')} />
        </div>
      )}
    </div>
  );
};
