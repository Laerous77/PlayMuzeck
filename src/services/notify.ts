// src/services/notify.ts
// Pusat umpan balik UI: pengganti alert()/confirm()/prompt() bawaan browser.
// Dirender oleh <FeedbackHost /> (dipasang sekali di main.tsx, mencakup situs utama DAN konsol admin).
// Bila host belum terpasang (mis. saat tes), otomatis jatuh balik ke dialog bawaan browser supaya tidak ada pesan yang hilang.

export type ToastKind = 'success' | 'info' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Tombol konfirmasi berwarna merah (hapus, batalkan, dll). */
  danger?: boolean;
}

export interface DialogRequest {
  id: number;
  type: 'confirm' | 'prompt';
  message: string;
  options: ConfirmOptions;
  defaultValue?: string;
  resolve: (value: boolean | string | null) => void;
}

interface HostApi {
  toast: (item: ToastItem) => void;
  dialog: (req: DialogRequest) => void;
}

let host: HostApi | null = null;
let seq = 0;

export const registerFeedbackHost = (api: HostApi): (() => void) => {
  host = api;
  return () => {
    if (host === api) host = null;
  };
};

const show = (message: string, kind: ToastKind) => {
  const text = String(message ?? '');
  if (!text) return;
  if (!host) {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(text);
    return;
  }
  host.toast({ id: ++seq, message: text, kind });
};

export const notify = Object.assign((message: string, kind: ToastKind = 'info') => show(message, kind), {
  success: (message: string) => show(message, 'success'),
  info: (message: string) => show(message, 'info'),
  error: (message: string) => show(message, 'error'),
});

/** Pengganti confirm(): `if (!(await confirmDialog('Hapus?'))) return;` */
export const confirmDialog = (message: string, options: ConfirmOptions = {}): Promise<boolean> => {
  if (!host) return Promise.resolve(typeof window !== 'undefined' ? window.confirm(message) : false);
  const opts: ConfirmOptions = { ...options };
  if (opts.danger === undefined) opts.danger = /^(hapus|batalkan|cabut|tangguhkan|akhiri|keluar|pulihkan)/i.test(message.trim());
  return new Promise<boolean>((resolve) => {
    host!.dialog({
      id: ++seq,
      type: 'confirm',
      message,
      options: opts,
      resolve: (v) => resolve(v === true),
    });
  });
};

/** Pengganti prompt(): mengembalikan teks, atau null bila dibatalkan. */
export const promptDialog = (message: string, defaultValue = '', options: ConfirmOptions = {}): Promise<string | null> => {
  if (!host) return Promise.resolve(typeof window !== 'undefined' ? window.prompt(message, defaultValue) : null);
  return new Promise<string | null>((resolve) => {
    host!.dialog({
      id: ++seq,
      type: 'prompt',
      message,
      options,
      defaultValue,
      resolve: (v) => resolve(typeof v === 'string' ? v : null),
    });
  });
};
