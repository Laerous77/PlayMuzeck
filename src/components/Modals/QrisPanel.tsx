// src/components/Modals/QrisPanel.tsx
import React from 'react';
import { motion } from 'motion/react';
import { QrCode, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { formatIDR } from '../../services/payment';

interface QrisPanelProps {
  amount: number;
  isBusy?: boolean;
  busyLabel?: string;
  confirmLabel?: string;
  errorMessage?: string | null;
  onConfirm: () => void;
}

export const QrisPanel: React.FC<QrisPanelProps> = ({
  amount,
  isBusy = false,
  busyLabel = 'Menyimpan ke Database...',
  confirmLabel = 'Konfirmasi Pembayaran QRIS Selesai',
  errorMessage,
  onConfirm,
}) => (
  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
    <div className="p-5 rounded-2xl bg-black/60 border border-white/[0.08] text-center space-y-3.5">
      <span className="text-xs font-black text-black bg-[#FCA311] px-3 py-1 rounded-full uppercase tracking-wider">
        MODE DEMO • Tanpa Pembayaran Nyata
      </span>

      <div className="w-48 h-48 mx-auto bg-white p-3.5 rounded-2xl shadow-xl flex flex-col items-center justify-center border-2 border-black">
        <QrCode className="w-32 h-32 text-black" />
        <span className="text-[10px] font-black text-black font-mono tracking-widest mt-1">DEMO • BUKAN QRIS ASLI</span>
      </div>

      <div>
        <span className="text-xs text-gray-400">Total Pembayaran:</span>
        <div className="text-2xl font-black text-[#FCA311] font-mono">{formatIDR(amount)}</div>
      </div>
    </div>

    {errorMessage && (
      <div className="p-3 rounded-xl bg-[#780000]/25 border border-[#780000] text-red-200 text-xs flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>{errorMessage}</span>
      </div>
    )}

    <button
      type="button"
      disabled={isBusy}
      onClick={onConfirm}
      className="w-full py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-emerald-500/20 disabled:opacity-50"
    >
      {isBusy ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{busyLabel}</span>
        </>
      ) : (
        <>
          <CheckCircle2 className="w-4 h-4" />
          <span>{errorMessage ? 'Coba Simpan Ulang' : confirmLabel}</span>
        </>
      )}
    </button>
  </motion.div>
);
