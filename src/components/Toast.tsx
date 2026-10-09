import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Info, X } from 'lucide-react';

interface ToastProps {
  message: string | null;
  type?: 'success' | 'info';
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type = 'success', onClose }) => {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          role="status"
          aria-live="polite"
          className="fixed bottom-[max(1.5rem,env(safe-area-inset-bottom))] right-4 left-4 sm:left-auto sm:right-6 z-[90] flex items-center gap-3 px-4 py-3 rounded-xl bg-surface border border-accent/40 shadow-2xl text-white text-sm font-medium sm:max-w-md"
        >
          {type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-gray-300 shrink-0" />
          )}
          <span className="min-w-0 flex-1 break-words">{message}</span>
          <button
            onClick={onClose}
            aria-label="Tutup pesan"
            className="shrink-0 p-2.5 -m-2 hover:bg-black/40 rounded-lg text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
