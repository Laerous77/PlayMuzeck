// src/components/GoogleSignInButton.tsx
//
// Tombol "Masuk dengan Google" SUNGGUHAN, memakai Google Identity Services
// (GIS) resmi dari Google — bukan simulasi. Dipakai di AuthModal (login akun
// biasa) maupun di halaman /admin (login admin).
//
// Cara kerja singkatnya:
// 1. Skrip GIS (accounts.google.com/gsi/client) dimuat sekali secara dinamis.
// 2. window.google.accounts.id.initialize(...) didaftarkan dengan client_id
//    dari VITE_GOOGLE_CLIENT_ID (harus SAMA PERSIS dengan GOOGLE_CLIENT_ID di
//    server/.env, karena keduanya dipakai untuk saling memverifikasi token).
// 3. Saat pengguna memilih akun Google, GIS memanggil callback dengan sebuah
//    ID token (JWT) yang sudah ditandatangani Google — token inilah yang kita
//    kirim ke server (`credential`) untuk diverifikasi ulang di sana. Server
//    TIDAK PERNAH mempercayai email yang dikirim mentah dari klien.
import React, { useEffect, useId, useRef, useState } from 'react';

declare global {
  interface Window {
    google?: any;
  }
}

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';
let gisScriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (gisScriptPromise) return gisScriptPromise;
  gisScriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Gagal memuat skrip Google.')));
      return;
    }
    const script = document.createElement('script');
    script.src = GIS_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat skrip Google.'));
    document.head.appendChild(script);
  });
  return gisScriptPromise;
}

interface GoogleSignInButtonProps {
  onCredential: (credential: string) => void | Promise<void>;
  onError?: (message: string) => void;
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  className?: string;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({
  onCredential,
  onError,
  text = 'continue_with',
  className,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const elementId = useId();
  const [ready, setReady] = useState(false);
  const clientId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID as string | undefined;

  useEffect(() => {
    if (!clientId) return; // belum dikonfigurasi — tombol tidak dirender (lihat di bawah)
    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (response: { credential?: string }) => {
            if (response?.credential) {
              onCredential(response.credential);
            } else {
              onError?.('Google tidak mengembalikan kredensial. Coba lagi.');
            }
          },
        });
        if (containerRef.current) {
          window.google.accounts.id.renderButton(containerRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            text,
            shape: 'pill',
            width: Math.min(320, containerRef.current?.offsetWidth || 320),
          });
        }
        setReady(true);
      })
      .catch((err) => onError?.(err.message || 'Gagal memuat Google Sign-In.'));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) {
    // Dev tanpa VITE_GOOGLE_CLIENT_ID: sembunyikan tombol daripada menampilkan
    // tombol yang tidak akan pernah berfungsi.
    return null;
  }

  return (
    <div className={className}>
      <div ref={containerRef} id={`gsi-btn-${elementId}`} className="flex justify-center" />
      {!ready && <p className="text-[11px] text-gray-500 text-center mt-1">Memuat Google Sign-In…</p>}
    </div>
  );
};
