// src/services/payment.ts
// Pembayaran QRIS bersama (dipakai Keranjang Belanja DAN Donasi & Dukungan).
// Harga & pencatatan kepemilikan ditentukan SERVER; klien hanya membuka Snap.
//
// Model pesanan (seperti marketplace): begitu checkout dibuka, pesanan 'Menunggu' dibuat di server
// dengan batas bayar (bawaan 24 jam). Menutup popup Snap TIDAK membatalkan pesanan. Pembeli bisa
// melanjutkan bayar (resumePayment) atau membatalkan sendiri (cancelPendingOrder). Lewat batas bayar,
// server otomatis mengubah status jadi 'Dibatalkan'.

export interface QrisChargeParams {
  orderId: string;
  amount: number;
  customer: { name: string; email: string };
  items?: unknown[];
}

export interface QrisHandlers {
  /** Snap melaporkan sukses. Server tetap memverifikasi ulang ke Midtrans saat checkout. */
  onSuccess: () => void;
  onPending?: () => void;
  /** message = alasan dari server bila tersedia; code mis. 'PENDING_EXISTS' (masih ada pesanan menunggu) / 'GONE'. */
  onError?: (message?: string, code?: string) => void;
  /** Popup ditutup. Pesanan TETAP ada di server (menunggu pembayaran). */
  onClose?: () => void;
  /** Pesanan 'Menunggu' sudah dibuat di server (sebelum popup Snap dibuka). */
  onCreated?: (info: { orderId: string; expiresAt: string | null }) => void;
}

export interface PaymentStatus {
  mode: 'production' | 'sandbox' | 'demo' | 'not-configured' | 'unreachable';
  ready: boolean;
  clientKey?: string | null;
  snapUrl?: string;
}

/** Pesanan milik pembeli yang belum selesai (menunggu bayar, atau sudah dibayar tapi akses belum diaktifkan). */
export interface PendingOrder {
  orderId: string;
  kind: 'cart' | 'donation';
  amount: number;
  status: 'pending' | 'paid';
  createdAt: string;
  expiresAt: string | null;
  items: any[];
}

export async function getPaymentStatus(): Promise<PaymentStatus> {
  try {
    const res = await fetch('/api/payment/status');
    if (!res.ok) return { mode: 'unreachable', ready: false };
    return await res.json();
  } catch {
    return { mode: 'unreachable', ready: false };
  }
}

/**
 * Memuat skrip Midtrans Snap memakai snapUrl & client key dari server (tak perlu edit index.html).
 * Kalau sudah ada snap.js dari lingkungan LAIN (mis. sandbox sisa cache/PWA) dibuang dan dimuat ulang,
 * karena token production tidak dikenali oleh snap.js sandbox ("Transaksi tidak ditemukan").
 */
const SNAP_SELECTOR = 'script[src*="midtrans.com/snap/snap.js"]';

async function ensureSnap(): Promise<boolean> {
  const st = await getPaymentStatus();
  if (!st.clientKey || !st.snapUrl) return typeof (window as any).snap !== 'undefined';

  const existing = Array.from(document.querySelectorAll<HTMLScriptElement>(SNAP_SELECTOR));
  if (typeof (window as any).snap !== 'undefined' && existing.length > 0 && existing.every((s) => s.src === st.snapUrl)) {
    return true;
  }

  existing.forEach((s) => s.remove());
  try {
    delete (window as any).snap;
  } catch {
    (window as any).snap = undefined;
  }

  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = st.snapUrl!;
    s.setAttribute('data-client-key', st.clientKey!);
    s.onload = () => resolve(typeof (window as any).snap !== 'undefined');
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** Buka popup Snap. Menutup popup TIDAK membatalkan pesanan. */
function openSnap(snapToken: string, handlers: QrisHandlers) {
  const snap = (window as any).snap;
  snap.pay(snapToken, {
    onSuccess: () => handlers.onSuccess(),
    onPending: () => handlers.onPending?.(),
    onError: () => handlers.onError?.(),
    onClose: () => handlers.onClose?.(),
  });
}

/**
 * Buat pesanan 'Menunggu' di server lalu buka Snap.
 * @returns true bila Snap dibuka (atau galat sudah dilaporkan lewat onError);
 *          false bila gateway belum dikonfigurasi (HTTP 503) / Snap tidak ada,
 *          sehingga pemanggil menampilkan panel QRIS lokal (hanya berguna untuk mode demo server).
 */
export async function payWithQris(params: QrisChargeParams, handlers: QrisHandlers): Promise<boolean> {
  if (!(await ensureSnap())) return false;

  try {
    const res = await fetch('/api/payment/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        orderId: params.orderId,
        grossAmount: params.amount,
        customerDetails: { name: params.customer.name, email: params.customer.email },
        items: params.items || [],
      }),
    });
    if (!res.ok) {
      if (res.status === 503) return false; // gateway belum dikonfigurasi
      const body = await res.json().catch(() => null);
      handlers.onError?.(body?.error, body?.code);
      return true;
    }

    const { snapToken, expiresAt } = await res.json();
    if (!snapToken) return false;

    handlers.onCreated?.({ orderId: params.orderId, expiresAt: expiresAt ?? null });
    openSnap(snapToken, handlers);
    return true;
  } catch {
    console.warn('Backend Midtrans belum aktif, beralih ke panel QRIS lokal.');
    return false;
  }
}

/**
 * Lanjutkan pembayaran pesanan 'Menunggu' yang sama (membuka Snap lagi dengan token tersimpan).
 * @returns true bila Snap dibuka atau galat sudah dilaporkan lewat onError.
 */
export async function resumePayment(orderId: string, handlers: QrisHandlers): Promise<boolean> {
  if (!(await ensureSnap())) {
    handlers.onError?.('Jendela pembayaran tidak bisa dimuat. Periksa koneksi lalu coba lagi.');
    return true;
  }
  try {
    const res = await fetch('/api/payment/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ orderId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      handlers.onError?.(body?.error || 'Pesanan ini tidak bisa dilanjutkan.', 'GONE');
      return true;
    }
    const { snapToken } = await res.json();
    if (!snapToken) {
      handlers.onError?.('Pesanan ini tidak bisa dilanjutkan.', 'GONE');
      return true;
    }
    openSnap(snapToken, handlers);
    return true;
  } catch {
    handlers.onError?.('Tidak dapat menghubungi server pembayaran. Coba lagi.');
    return true;
  }
}

/**
 * Daftar pesanan pembeli yang belum selesai.
 * @returns null bila gagal memuat (jangan anggap "tidak ada pesanan").
 */
export async function getPendingOrders(): Promise<PendingOrder[] | null> {
  try {
    const res = await fetch('/api/payment/pending', { credentials: 'include' });
    if (!res.ok) return null;
    const list = await res.json();
    return Array.isArray(list) ? (list as PendingOrder[]) : null;
  } catch {
    return null;
  }
}

/**
 * Batalkan pesanan 'Menunggu' milik sendiri (tombol "Batalkan pesanan").
 * Status di server jadi 'Dibatalkan' dan transaksi Midtrans ikut dibatalkan.
 * @returns true bila pesanan benar-benar dibatalkan; false bila sudah lunas / sudah dibatalkan / gagal terhubung.
 */
export async function cancelPendingOrder(orderId: string): Promise<boolean> {
  if (!orderId) return false;
  try {
    const res = await fetch('/api/payment/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ orderId }),
    });
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return Boolean(body?.cancelled);
  } catch {
    return false;
  }
}

export const formatIDR = (val: number) => `Rp${val.toLocaleString('id-ID')}`;

/** "3 Okt 2026 14.30 WIB" */
export function formatDeadline(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  })} WIB`;
}

/** "23 jam 12 menit" / "45 menit" / "kurang dari 1 menit" / "habis" */
export function timeLeftLabel(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return 'habis';
  const totalMin = Math.floor(ms / 60000);
  if (totalMin < 1) return 'kurang dari 1 menit';
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
}
