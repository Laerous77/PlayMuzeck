// src/components/PusatKuis/PlayerAvatar.tsx
// Avatar pemain (foto profil / inisial) dengan bingkai profil, dipakai papan peringkat & Komunitas Kuis.
import React, { useState } from 'react';
import { PROFILE_FRAMES, FrameOrnament } from '../Modals/ProfileDashboardModal';

interface PlayerAvatarProps {
  name: string;
  avatarUrl?: string | null;
  frameId?: string;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS = { sm: 'w-8 h-8 text-xs', md: 'w-10 h-10 text-sm', lg: 'w-14 h-14 text-lg' } as const;

export const PlayerAvatar: React.FC<PlayerAvatarProps> = ({ name, avatarUrl, frameId = 'none', size = 'md' }) => {
  const [broken, setBroken] = useState(false);
  const frame = PROFILE_FRAMES.find((f) => f.id === frameId) || PROFILE_FRAMES[0];
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  const showImg = Boolean(avatarUrl) && !broken;

  return (
    <div className={`relative shrink-0 ${SIZE_CLASS[size]}`}>
      <div
        className={`w-full h-full rounded-xl overflow-hidden flex items-center justify-center bg-[#0a1120] font-black text-on-accent ${frame.borderClass}`}
      >
        {showImg ? (
          <img src={avatarUrl as string} alt="" onError={() => setBroken(true)} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-linear-to-tr from-accent to-accent/70 flex items-center justify-center">{initial}</div>
        )}
      </div>
      {size !== 'sm' && (
        <span className="absolute -top-1.5 -right-1.5 z-10 flex items-center justify-center pointer-events-none">
          <FrameOrnament iconType={frame.iconType} size="sm" />
        </span>
      )}
    </div>
  );
};
