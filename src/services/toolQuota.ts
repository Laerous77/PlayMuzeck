// src/services/toolQuota.ts
// Klien kuota harian Audio Tools: 2x gratis per alat per hari. SUMBER KEBENARAN = DATABASE di server
// (lihat server/toolQuotaCore.ts), bukan localStorage. Di sini hanya ada salinan sementara di memori halaman
// supaya UI bisa menampilkan sisa jatah tanpa menunggu jaringan.
//
// Bila server tidak terjangkau, dipakai penghitung memori (hilang saat halaman dimuat ulang) agar alat tidak
// jadi tanpa batas selama halaman terbuka. Penghitung ini TIDAK ditulis ke localStorage.
export const DAILY_FREE_QUOTA = 2;

export interface Reservation {
  allowed: boolean;
  /** Kunci penggunaan (dipakai untuk refund & agar permintaan ulang tidak dihitung dua kali). */
  useKey: string;
  remaining: number;
  /** true bila server tidak terjangkau dan keputusan dibuat dari penghitung memori. */
  offline?: boolean;
}

const remaining = new Map<string, number>();
const offlineUsed = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let loadedDay = '';
let inflight: Promise<void> | null = null;
let lastFetch = 0;

const localDay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
};
const emit = () => listeners.forEach((l) => { try { l(); } catch { /* abaikan */ } });
const newKey = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`);

/** Sisa jatah gratis hari ini untuk satu alat (Infinity bila Audio Tools sudah dimiliki). */
export function remainingQuota(toolId: string, unlimited = false): number {
  if (unlimited) return Infinity;
  const v = remaining.get(toolId);
  if (typeof v === 'number') return v;
  const off = offlineUsed.get(toolId)?.size ?? 0;
  return Math.max(0, DAILY_FREE_QUOTA - off);
}

export function subscribeQuota(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

async function postJson(url: string, body: object) {
  const res = await fetch(url, {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Ambil sisa jatah dari server. Aman dipanggil sering (digabung & dibatasi). */
export function refreshQuota(force = false): Promise<void> {
  if (inflight) return inflight;
  if (!force && Date.now() - lastFetch < 1500) return Promise.resolve();
  inflight = (async () => {
    try {
      const res = await fetch('/api/tool-quota', { credentials: 'include', cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { day: string; remaining: Record<string, number> };
      loadedDay = data.day;
      remaining.clear();
      Object.entries(data.remaining).forEach(([k, v]) => remaining.set(k, Math.max(0, Math.min(DAILY_FREE_QUOTA, Number(v) || 0))));
      offlineUsed.clear(); // data server menggantikan hitungan sementara
      lastFetch = Date.now();
      emit();
    } catch {
      /* server tidak terjangkau: tampilan memakai nilai terakhir / penghitung memori */
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Pesan satu jatah di SERVER. `useKey` sama = tidak dihitung dua kali (mis. mengunduh hasil yang sama). */
export async function reserveQuota(toolId: string, useKey?: string): Promise<Reservation> {
  const key = useKey && /^[A-Za-z0-9:_|.\-]{1,120}$/.test(useKey) ? useKey : newKey();
  try {
    const r = await postJson('/api/tool-quota/reserve', { toolId, useKey: key }) as { allowed: boolean; remaining: number; useKey: string };
    remaining.set(toolId, Math.max(0, Number(r.remaining) || 0));
    lastFetch = Date.now();
    emit();
    return { allowed: Boolean(r.allowed), remaining: remaining.get(toolId) ?? 0, useKey: r.useKey || key };
  } catch {
    // Server tidak terjangkau: penghitung memori (tanpa localStorage).
    const set = offlineUsed.get(toolId) ?? new Set<string>();
    offlineUsed.set(toolId, set);
    const known = set.has(key);
    const base = remaining.get(toolId) ?? DAILY_FREE_QUOTA;
    if (!known && set.size >= base) return { allowed: false, remaining: 0, useKey: key, offline: true };
    set.add(key);
    remaining.set(toolId, Math.max(0, base - (known ? 0 : 1)));
    emit();
    return { allowed: true, remaining: remaining.get(toolId) ?? 0, useKey: key, offline: true };
  }
}

/** Kembalikan jatah yang tadi dipesan (proses gagal / dibatalkan). Aman dipanggil dengan null. */
export async function refundReservation(toolId: string, res: Reservation | null | undefined): Promise<void> {
  if (!res || !res.allowed) return;
  if (res.offline) {
    const set = offlineUsed.get(toolId);
    if (set?.delete(res.useKey)) {
      remaining.set(toolId, Math.min(DAILY_FREE_QUOTA, (remaining.get(toolId) ?? 0) + 1));
      emit();
    }
    return;
  }
  try {
    const r = await postJson('/api/tool-quota/refund', { toolId, useKey: res.useKey }) as { remaining: number };
    remaining.set(toolId, Math.max(0, Math.min(DAILY_FREE_QUOTA, Number(r.remaining) || 0)));
    emit();
  } catch {
    void refreshQuota(true);
  }
}

/** Hari server terakhir yang diketahui (untuk debugging / tampilan). */
export const quotaDay = () => loadedDay || localDay();
