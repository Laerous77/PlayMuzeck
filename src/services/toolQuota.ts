// src/services/toolQuota.ts
// Klien kuota harian Audio Tools: 2x gratis per alat per hari. SUMBER KEBENARAN = DATABASE di server
// (lihat server/toolQuotaCore.ts), bukan localStorage. Di sini hanya ada salinan sementara di memori halaman
// supaya UI bisa menampilkan sisa jatah tanpa menunggu jaringan.
//
// Bila server tidak terjangkau, pemakaian DITOLAK (gagal tertutup): tidak ada penghitung cadangan di browser,
// karena penghitung di browser akan kembali nol saat halaman dimuat ulang / penyimpanan dihapus.
export const DAILY_FREE_QUOTA = 2;

export interface Reservation {
  allowed: boolean;
  /** Kunci penggunaan (dipakai untuk refund & agar permintaan ulang tidak dihitung dua kali). */
  useKey: string;
  remaining: number;
  /** true bila jatah TIDAK bisa diperiksa karena server tidak terjangkau (bukan karena jatah habis). */
  unavailable?: boolean;
  /** true bila pemakai belum masuk akun (jatah hanya untuk akun yang login). */
  loginRequired?: boolean;
}

const remaining = new Map<string, number>();
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
  return typeof v === 'number' ? v : DAILY_FREE_QUOTA;
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
      lastFetch = Date.now();
      emit();
    } catch {
      /* server tidak terjangkau: tampilan memakai nilai terakhir; pemakaian tetap ditolak sampai server menjawab */
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
    const r = await postJson('/api/tool-quota/reserve', { toolId, useKey: key }) as { allowed: boolean; remaining: number; useKey: string; loginRequired?: boolean };
    remaining.set(toolId, Math.max(0, Number(r.remaining) || 0));
    lastFetch = Date.now();
    emit();
    return { allowed: Boolean(r.allowed), remaining: remaining.get(toolId) ?? 0, useKey: r.useKey || key, loginRequired: Boolean(r.loginRequired) };
  } catch {
    // Server tidak terjangkau / galat: tolak. Jatah tidak boleh diputuskan di browser.
    return { allowed: false, remaining: remaining.get(toolId) ?? 0, useKey: key, unavailable: true };
  }
}

/** Kembalikan jatah yang tadi dipesan (proses gagal / dibatalkan). Aman dipanggil dengan null. */
export async function refundReservation(toolId: string, res: Reservation | null | undefined): Promise<void> {
  if (!res || !res.allowed) return;
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
