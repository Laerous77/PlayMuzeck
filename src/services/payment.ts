// src/services/payment.ts
// Pembayaran QRIS bersama (dipakai Keranjang Belanja DAN Donasi & Dukungan).
// Harga & pencatatan kepemilikan ditentukan SERVER; klien hanya membuka Snap.

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
  /** message = alasan dari server bila tersedia. */
  onError?: (message?: string) => void;
  onClose?: () => void;
}

export interface PaymentStatus {
  mode: 'production' | 'sandbox' | 'demo' | 'not-configured' | 'unreachable';
  ready: boolean;
  clientKey?: string | null;
  snapUrl?: string;
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

/** Memuat skrip Midtrans Snap otomatis memakai client key dari server (tak perlu edit index.html). */
async function ensureSnap(): Promise<boolean> {
  if (typeof (window as any).snap !== 'undefined') return true;
  const st = await getPaymentStatus();
  if (!st.clientKey || !st.snapUrl) return false;
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = st.snapUrl!;
    s.setAttribute('data-client-key', st.clientKey!);
    s.onload = () => resolve(typeof (window as any).snap !== 'undefined');
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/**
 * @returns true bila Snap dibuka (atau galat sudah dilaporkan lewat onError);
 *          false bila gateway belum dikonfigurasi (HTTP 503) / Snap tidak ada,
 *          sehingga pemanggil menampilkan panel QRIS lokal (hanya berguna untuk mode demo server).
 */
export async function payWithQris(params: QrisChargeParams, handlers: QrisHandlers): Promise<boolean> {
  if (!(await ensureSnap())) return false;
  const snap = (window as any).snap;

  try {
    const res = await fetch('/api/payment/charge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
      handlers.onError?.(body?.error);
      return true;
    }

    const { snapToken } = await res.json();
    if (!snapToken) return false;

    snap.pay(snapToken, {
      onSuccess: () => handlers.onSuccess(),
      onPending: () => handlers.onPending?.(),
      onError: () => handlers.onError?.(),
      onClose: () => handlers.onClose?.(),
    });
    return true;
  } catch {
    console.warn('Backend Midtrans belum aktif, beralih ke panel QRIS lokal.');
    return false;
  }
}

export const formatIDR = (val: number) => `Rp${val.toLocaleString('id-ID')}`;
