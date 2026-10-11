import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Info, X, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'info' | 'error';

interface ToastCardProps {
  message: string;
  type?: ToastType;
  onClose: () => void;
}

/** Satu kartu toast. Dipakai oleh <Toast> (tunggal) dan <FeedbackHost> (tumpukan). */
export const ToastCard: React.FC<ToastCardProps> = ({ message, type = 'success', onClose }) => {
  const isError = type === 'error';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      role={isError ? 'alert' : 'status'}
      aria-live={isError ? 'assertive' : 'polite'}
      className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl bg-surface border shadow-2xl text-white text-sm font-medium w-full sm:max-w-md ${
        isError ? 'border-red-500/60' : 'border-accent/40'
      }`}
    >
      {type === 'success' ? (
        <CheckCircle2 className="w-4 h-4 text-accent shrink-0 mt-0.5" />
      ) : isError ? (
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
      ) : (
        <Info className="w-4 h-4 text-gray-300 shrink-0 mt-0.5" />
      )}
      <span className="min-w-0 flex-1 break-words whitespace-pre-line">{message}</span>
      <button
        onClick={onClose}
        aria-label="Tutup pesan"
        className="shrink-0 p-2.5 -m-2 hover:bg-black/40 rounded-lg text-gray-400 hover:text-white transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
};

interface ToastProps {
  message: string | null;
  type?: ToastType;
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'success', onClose }) => (
  <div className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:right-6 z-[130] flex flex-col items-end pointer-events-none">
    <AnimatePresence>{message && <ToastCard key={message} message={message} type={type} onClose={onClose} />}</AnimatePresence>
  </div>
);
