// src/components/PusatKuis/PlayerAvatar.tsx
// Avatar pemain (foto profil / inisial) dengan bingkai profil, dipakai papan peringkat & Komunitas Kuis.
import React, { useState } from 'react';
import { PROFILE_FRAMES, FrameOrnament, frameBoxClass } from '../Modals/ProfileDashboardModal';

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
        className={`w-full h-full rounded-xl overflow-hidden flex items-center justify-center bg-[#0a1120] font-black text-on-accent ${frameBoxClass(frame, true)}`}
      >
        {showImg ? (
          <img src={avatarUrl as string} alt="" onError={() => setBroken(true)} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full bg-linear-to-tr from-accent to-accent/70 flex items-center justify-center">{initial}</div>
        )}
      </div>
      {/* Ornamen sudah `absolute` sendiri: tanpa wrapper absolute (lihat catatan di Header). */}
      {size !== 'sm' && <FrameOrnament frame={frame} size="sm" />}
    </div>
  );
};
