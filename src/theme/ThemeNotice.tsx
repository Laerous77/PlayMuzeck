// src/theme/ThemeNotice.tsx
// Menampilkan notifikasi dari admin (mis. "Admin menerapkan tema X ke akunmu") di sisi PENGGUNA.
// Pasang sekali di dalam <ThemeProvider>, mis. di App.tsx:
//   <ThemeNotice isLoggedIn={isLoggedIn} userKey={email} />
// Jika endpoint belum ada di server, komponen diam saja (tanpa error).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, X } from 'lucide-react';

interface Notice {
  id: number;
  title: string;
  message: string;
  createdAt: string;
}

interface Props {
  isLoggedIn: boolean;
  /** Berubah = daftar notifikasi diambil ulang untuk akun baru. */
  userKey?: string;
  /** Opsional: kalau auth memakai header Authorization. Sesi cookie httpOnly tidak perlu. */
  getToken?: () => string | null | undefined;
}

export const ThemeNotice: React.FC<Props> = ({ isLoggedIn, userKey, getToken }) => {
  const [items, setItems] = useState<Notice[]>([]);
  const dismissed = useRef<Set<number>>(new Set());

  const request = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const token = getToken?.();
      const res = await fetch(url, {
        credentials: 'include',
        ...init,
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) throw new Error('unavailable');
      return res.json();
    },
    [getToken],
  );

  const fetchNotices = useCallback(async () => {
    try {
      const body = await request('/api/me/notifications');
      if (!Array.isArray(body?.notifications)) return;
      setItems((body.notifications as Notice[]).filter((n) => !dismissed.current.has(n.id)));
    } catch {
      /* endpoint belum ada / offline: abaikan */
    }
  }, [request]);

  useEffect(() => {
    if (!isLoggedIn) { setItems([]); dismissed.current.clear(); return; }
    fetchNotices();
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'hidden') fetchNotices();
    }, 30000);
    window.addEventListener('focus', fetchNotices);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', fetchNotices);
    };
  }, [isLoggedIn, userKey, fetchNotices]);

  const dismiss = async (id: number) => {
    dismissed.current.add(id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    try {
      await request('/api/me/notifications/read', { method: 'POST', body: JSON.stringify({ ids: [id] }) });
    } catch {
      /* akan muncul lagi nanti kalau gagal tersimpan — wajar */
    }
  };

  if (!isLoggedIn || items.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] w-[calc(100vw-2rem)] max-w-sm space-y-2" role="status" aria-live="polite">
      {items.map((n) => (
        <div key={n.id} className="rounded-2xl bg-surface border border-accent/40 shadow-2xl p-4 flex gap-3">
          <Bell className="w-4 h-4 text-accent shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-white">{n.title}</p>
            <p className="text-xs text-gray-300 mt-0.5 break-words">{n.message}</p>
            <button
              type="button"
              onClick={() => dismiss(n.id)}
              className="mt-2 rounded-lg bg-accent text-on-accent text-xs font-bold px-3 py-1 cursor-pointer"
            >
              Mengerti
            </button>
          </div>
          <button type="button" onClick={() => dismiss(n.id)} aria-label="Tutup" className="text-gray-400 hover:text-white cursor-pointer self-start">
            <X className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
