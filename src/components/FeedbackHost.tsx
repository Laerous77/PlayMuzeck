import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ToastCard } from './Toast';
import { ModalPortal } from './AudioStudio/ModalPortal';
import {
  registerFeedbackHost,
  type DialogRequest,
  type ToastItem,
} from '../services/notify';

const MAX_TOASTS = 4;

const lifetimeMs = (t: ToastItem) => Math.min(12000, Math.max(t.kind === 'error' ? 6000 : 3500, t.message.length * 45));

/**
 * Host tunggal untuk toast + dialog konfirmasi/isian. Dipasang sekali di main.tsx
 * (situs utama dan konsol admin), menggantikan alert()/confirm()/prompt() bawaan browser.
 */
export const FeedbackHost: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [queue, setQueue] = useState<DialogRequest[]>([]);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  useEffect(() => {
    const unregister = registerFeedbackHost({
      toast: (item) => {
        setToasts((prev) => {
          // Pesan identik yang masih tampil tidak digandakan.
          if (prev.some((p) => p.message === item.message && p.kind === item.kind)) return prev;
          return [...prev, item].slice(-MAX_TOASTS);
        });
        timers.current.set(item.id, window.setTimeout(() => dismiss(item.id), lifetimeMs(item)));
      },
      dialog: (req) => setQueue((prev) => [...prev, req]),
    });
    const pending = timers.current;
    return () => {
      unregister();
      pending.forEach((t) => window.clearTimeout(t));
      pending.clear();
    };
  }, [dismiss]);

  const current = queue[0] ?? null;
  const settle = (value: boolean | string | null) => {
    if (!current) return;
    current.resolve(value);
    setQueue((prev) => prev.slice(1));
  };

  return (
    <>
      <div
        className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:right-6 z-[130] flex flex-col items-end gap-2 pointer-events-none"
        aria-label="Notifikasi"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <ToastCard key={t.id} message={t.message} type={t.kind} onClose={() => dismiss(t.id)} />
          ))}
        </AnimatePresence>
      </div>
      {current && <DialogView key={current.id} req={current} onSettle={settle} />}
    </>
  );
};

const DialogView: React.FC<{ req: DialogRequest; onSettle: (v: boolean | string | null) => void }> = ({ req, onSettle }) => {
  const [value, setValue] = useState(req.defaultValue ?? '');
  const isPrompt = req.type === 'prompt';
  const { title, confirmLabel, cancelLabel, danger } = req.options;
  const okRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (isPrompt ? inputRef.current : okRef.current)?.focus();
    if (isPrompt) inputRef.current?.select();
  }, [isPrompt]);

  const cancel = () => onSettle(isPrompt ? null : false);
  const ok = () => onSettle(isPrompt ? value : true);

  return (
    <ModalPortal onClose={cancel} zIndexClass="z-[120]">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title || (isPrompt ? 'Isi data' : 'Konfirmasi')}
        className="w-full max-w-sm rounded-2xl bg-surface border border-white/10 shadow-2xl p-5 space-y-4"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {title && <h2 className="text-base font-black text-white">{title}</h2>}
        <p className="text-sm text-gray-200 whitespace-pre-line break-words">{req.message}</p>
        {isPrompt && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') ok();
            }}
            className="w-full px-3 py-2 rounded-xl bg-black/40 border border-white/10 text-white text-sm focus:border-accent outline-none"
          />
        )}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={cancel}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/10 text-xs font-bold text-white cursor-pointer"
          >
            {cancelLabel || 'Batal'}
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={ok}
            className={`px-4 py-2 rounded-xl text-xs font-black cursor-pointer ${
              danger ? 'bg-red-500 hover:bg-red-400 text-white' : 'bg-accent text-on-accent hover:opacity-90'
            }`}
          >
            {confirmLabel || (isPrompt ? 'Simpan' : 'Ya, lanjutkan')}
          </button>
        </div>
      </div>
    </ModalPortal>
  );
};
