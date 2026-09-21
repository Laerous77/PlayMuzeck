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
          className="fixed bottom-6 right-4 left-4 sm:left-auto sm:right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#14213D] border border-[#FCA311]/40 shadow-2xl text-white text-xs sm:text-sm font-medium max-w-md sm:ml-auto"
        >
          {type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 text-[#FCA311] shrink-0" />
          ) : (
            <Info className="w-4 h-4 text-gray-300 shrink-0" />
          )}
          <span>{message}</span>
          <button
            onClick={onClose}
            className="p-1 hover:bg-black/40 rounded text-gray-400 hover:text-white transition-colors ml-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
