// src/components/AudioStudio/ModalPortal.tsx
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';

// Penghitung kunci scroll: beberapa popup bisa terbuka bersamaan tanpa saling membuka kunci.
let lockCount = 0;
let savedBodyOverflow = '';
let savedHtmlOverflow = '';
let savedPaddingRight = '';

const lockBodyScroll = () => {
  if (lockCount === 0) {
    const body = document.body;
    const html = document.documentElement;
    const scrollbarW = window.innerWidth - html.clientWidth;
    savedBodyOverflow = body.style.overflow;
    savedHtmlOverflow = html.style.overflow;
    savedPaddingRight = body.style.paddingRight;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    // Cegah layout "loncat" saat scrollbar hilang.
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;
  }
  lockCount++;
};

const unlockBodyScroll = () => {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = savedBodyOverflow;
    document.documentElement.style.overflow = savedHtmlOverflow;
    document.body.style.paddingRight = savedPaddingRight;
  }
};

export const useBodyScrollLock = (active: boolean) => {
  useEffect(() => {
    if (!active) return;
    lockBodyScroll();
    return unlockBodyScroll;
  }, [active]);
};

interface ModalPortalProps {
  children: React.ReactNode;
  // Jika diisi: Esc dan klik di area gelap akan memanggil fungsi ini.
  onClose?: () => void;
  // Atur false agar popup tidak bisa ditutup lewat Esc/klik latar (mis. saat proses ekspor).
  dismissible?: boolean;
  zIndexClass?: string;
}

/**
 * Popup yang dirender langsung ke <body> (di atas header sticky), mengunci scroll latar,
 * dan hanya konten popup yang bisa di-scroll.
 */
export const ModalPortal: React.FC<ModalPortalProps> = ({
  children,
  onClose,
  dismissible = true,
  zIndexClass = 'z-[100]',
}) => {
  useBodyScrollLock(true);

  useEffect(() => {
    if (!onClose || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, dismissible]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClass} flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overscroll-none`}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && onClose && dismissible) onClose();
      }}
    >
      {children}
    </div>,
    document.body
  );
};
