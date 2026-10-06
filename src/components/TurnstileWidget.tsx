// src/components/TurnstileWidget.tsx
// Widget Cloudflare Turnstile. Tidak dirender sama sekali kalau VITE_TURNSTILE_SITE_KEY belum diisi.
import React, { useEffect, useRef } from 'react';

declare global {
  interface Window {
    turnstile?: any;
  }
}

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('Gagal memuat CAPTCHA.'));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export const turnstileSiteKey = (): string =>
  String((import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || '');

interface Props {
  onToken: (token: string) => void;
  /** Ubah nilai ini (mis. naikkan angka) untuk memaksa widget dimuat ulang setelah submit. */
  resetKey?: number;
  className?: string;
}

export const TurnstileWidget: React.FC<Props> = ({ onToken, resetKey = 0, className }) => {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const siteKey = turnstileSiteKey();

  useEffect(() => {
    if (!siteKey) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return;
        if (widgetId.current) {
          try { window.turnstile.remove(widgetId.current); } catch {}
          widgetId.current = null;
        }
        onToken('');
        widgetId.current = window.turnstile.render(ref.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (t: string) => onToken(t),
          'expired-callback': () => onToken(''),
          'error-callback': () => onToken(''),
        });
      })
      .catch(() => onToken(''));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try { window.turnstile.remove(widgetId.current); } catch {}
        widgetId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey, resetKey]);

  if (!siteKey) return null;
  return <div ref={ref} className={className || 'flex justify-center'} />;
};
