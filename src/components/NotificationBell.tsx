// src/components/NotificationBell.tsx
// Tombol lonceng + panel notifikasi. Taruh di Header, di antara "Tentang Kami" dan tombol keranjang:
//   <NotificationBell isLoggedIn={userSession.isLoggedIn} userKey={userSession.email} />
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Trash2, CheckCircle2, Palette, Loader2, AlertTriangle } from 'lucide-react';

interface NotifItem {
  id: number;
  type: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
interface DeletionInfo {
  scheduledAt: string;
  requestedBy: 'self' | 'admin';
}

const timeLeft = (iso: string) => {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'sebentar lagi';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return d > 0 ? `${d} hari ${h} jam` : h > 0 ? `${h} jam ${m} menit` : `${Math.max(1, m)} menit`;
};

const agoLabel = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam lalu`;
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
};

const iconFor = (type: string) => {
  if (type === 'account_deletion') return <Trash2 className="w-4 h-4 text-orange-300" />;
  if (type === 'account_deletion_cancelled') return <CheckCircle2 className="w-4 h-4 text-emerald-300" />;
  if (type.startsWith('theme')) return <Palette className="w-4 h-4 text-accent" />;
  return <Bell className="w-4 h-4 text-gray-300" />;
};

// Notifikasi dari admin (tema diterapkan / direset / dikunci) datang dari sistem lama /api/me/notifications.
// Dipindahkan ke tabel notifikasi baru (riwayat), lalu ditandai terbaca di sistem lama supaya tidak dobel.
let pulling = false;
async function pullThemeNotices() {
  if (pulling) return;
  pulling = true;
  try {
    const res = await fetch('/api/me/notifications', { credentials: 'include' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('json')) return;
    const body = await res.json();
    const list: any[] = Array.isArray(body?.notifications) ? body.notifications : [];
    if (!list.length) return;
    const headers = { 'Content-Type': 'application/json' };
    const imp = await fetch('/api/user/notifications/import', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ items: list.map((n) => ({ id: n.id, title: n.title, message: n.message, createdAt: n.createdAt })) }),
    });
    if (!imp.ok) return; // gagal tersimpan: jangan tandai terbaca, coba lagi nanti
    await fetch('/api/me/notifications/read', {
      method: 'POST', credentials: 'include', headers,
      body: JSON.stringify({ ids: list.map((n) => n.id) }),
    });
  } catch {
    /* endpoint lama belum ada / offline: abaikan */
  } finally {
    pulling = false;
  }
}

export const NotificationBell: React.FC<{ isLoggedIn: boolean; userKey?: string }> = ({ isLoggedIn, userKey }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotifItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [deletion, setDeletion] = useState<DeletionInfo | null>(null);
  const [highlight, setHighlight] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (): Promise<{ items: NotifItem[]; unread: number } | null> => {
    if (!isLoggedIn) return null;
    await pullThemeNotices();
    try {
      const res = await fetch('/api/user/notifications', { credentials: 'include' });
      if (!res.ok) return null;
      const d = await res.json();
      setItems(d.items || []);
      setUnread(d.unread || 0);
      setDeletion(d.deletion || null);
      return { items: d.items || [], unread: d.unread || 0 };
    } catch {
      return null;
    }
  }, [isLoggedIn]);

  // Reset saat ganti akun / logout, lalu muat ulang + polling tiap 60 detik.
  useEffect(() => {
    setItems([]);
    setUnread(0);
    setDeletion(null);
    setOpen(false);
    if (!isLoggedIn) return;
    load();
    const t = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      load();
      setTick((n) => n + 1);
    }, 30000);
    return () => clearInterval(t);
  }, [isLoggedIn, userKey, load]);

  // Bagian lain aplikasi bisa memicu penyegaran lewat event ini.
  useEffect(() => {
    const refresh = () => { load(); };
    window.addEventListener('muzeck:notifications-refresh', refresh);
    window.addEventListener('muzeck:account-deletion', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('muzeck:notifications-refresh', refresh);
      window.removeEventListener('muzeck:account-deletion', refresh);
    };
  }, [load]);

  // Tutup saat klik di luar / tekan Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (!next) return;
    const fresh = await load();
    if (fresh && fresh.unread > 0) {
      // Simpan penanda "baru" untuk tampilan ini, lalu tandai terbaca di server.
      setHighlight(new Set(fresh.items.filter((i) => !i.read_at).map((i) => i.id)));
      setUnread(0);
      fetch('/api/user/notifications/read-all', { method: 'POST', credentials: 'include' }).catch(() => {});
    } else {
      setHighlight(new Set());
    }
  };

  const cancelDeletion = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/user/account/cancel-deletion', { method: 'POST', credentials: 'include' });
      if (res.ok) {
        setDeletion(null);
        await load();
        window.dispatchEvent(new Event('muzeck:notifications-refresh'));
      }
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    await fetch('/api/user/notifications', { method: 'DELETE', credentials: 'include' }).catch(() => {});
    setItems([]);
    setUnread(0);
    setHighlight(new Set());
  };

  if (!isLoggedIn) return null;

  const badge = unread + (deletion ? 1 : 0);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Notifikasi"
        title="Notifikasi"
        className="p-2 rounded-xl bg-black/50 hover:bg-black/80 border border-white/[0.08] text-gray-300 hover:text-white relative transition-colors cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {badge > 0 && (
          <span className={`absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-black flex items-center justify-center text-white ${deletion ? 'bg-orange-500' : 'bg-accent2'}`}>
            {badge > 9 ? '9+' : badge}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed left-3 right-3 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 z-[60] rounded-2xl bg-surface border border-white/[0.12] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-black/40">
            <h4 className="text-sm font-black text-white">Notifikasi</h4>
            {items.length > 0 && (
              <button type="button" onClick={clearAll} className="text-[11px] text-gray-400 hover:text-white cursor-pointer">
                Hapus semua
              </button>
            )}
          </div>

          <div className="max-h-[65vh] overflow-y-auto p-3 space-y-2">
            {deletion && (
              <div className="p-3 rounded-xl bg-orange-500/10 border border-orange-400/50 space-y-2">
                <div className="flex items-center gap-2 text-orange-300 font-black text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Akunmu akan dihapus permanen dalam {timeLeft(deletion.scheduledAt)}</span>
                </div>
                <p className="text-[11px] text-gray-300 leading-relaxed">
                  Dihapus pada{' '}
                  <b className="text-white">
                    {new Date(deletion.scheduledAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'full', timeStyle: 'short' })} WIB
                  </b>
                  . {deletion.requestedBy === 'self' ? 'Kamu yang meminta penghapusan ini.' : 'Penghapusan ini dijadwalkan oleh admin.'} Akun masih bisa dipakai sampai
                  waktu itu.
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={cancelDeletion}
                  className="px-3 py-1.5 rounded-lg bg-orange-400 hover:bg-orange-300 text-black font-black text-[11px] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Batalkan Penghapusan Akun
                </button>
              </div>
            )}

            {items.length === 0 && !deletion && (
              <div className="py-10 text-center text-xs text-gray-400">
                <Bell className="w-8 h-8 mx-auto mb-2 text-gray-600" />
                Belum ada notifikasi.
              </div>
            )}

            {items.map((n) => (
              <div
                key={n.id}
                className={`p-3 rounded-xl border flex gap-3 ${highlight.has(n.id) ? 'bg-accent/10 border-accent/40' : 'bg-black/30 border-white/[0.06]'}`}
              >
                <div className="w-8 h-8 rounded-lg bg-black/40 flex items-center justify-center shrink-0">{iconFor(n.type)}</div>
                <div className="min-w-0 space-y-0.5">
                  <div className="text-xs font-bold text-white leading-snug">{n.title}</div>
                  {n.body && <p className="text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap break-words">{n.body}</p>}
                  <div className="text-[10px] text-gray-500">{agoLabel(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
