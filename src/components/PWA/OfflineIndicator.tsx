import React from 'react';
import { WifiOff, ShieldCheck } from 'lucide-react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      id="pwa-offline-banner"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-[#14213D] border border-amber-500/60 shadow-2xl text-xs font-semibold text-amber-200 backdrop-blur-md animate-bounce"
    >
      <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
      <WifiOff className="w-4 h-4 text-amber-400" />
      <span>Mode Offline Aktif — Kuis & Audio tersimpan di peramban tetap dapat dimainkan.</span>
    </div>
  );
};
