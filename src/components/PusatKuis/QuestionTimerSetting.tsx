// src/components/PusatKuis/QuestionTimerSetting.tsx
// Pengaturan "Waktu per Soal" (1 detik - 3 menit), dipakai di layar setup semua mode permainan.
// Bila `locked`, tampil sebagai info terkunci (kuis buatan Editor tidak bisa diubah pemain).
import React, { useEffect, useState } from 'react';
import { Clock, Lock } from 'lucide-react';
import {
  MIN_QUESTION_TIME,
  MAX_QUESTION_TIME,
  clampQuestionTime,
  formatTimeLabel,
} from '../../services/questionTime';

type Accent = 'red' | 'amber' | 'purple';

const ACCENT: Record<Accent, { active: string; focus: string }> = {
  red: { active: 'bg-[#FC1212] border-[#FC1212] text-white', focus: 'focus:border-[#FC1212]' },
  amber: { active: 'bg-amber-500 border-amber-400 text-black', focus: 'focus:border-amber-400' },
  purple: { active: 'bg-purple-600 border-purple-500 text-white', focus: 'focus:border-purple-400' },
};

const PRESETS = [10, 20, 30, 60, 120, 180];

interface QuestionTimerSettingProps {
  value: number;
  onChange: (sec: number) => void;
  /** Terkunci: tampilkan `lockedNote` saja, tanpa kontrol. */
  locked?: boolean;
  lockedNote?: string;
  accent?: Accent;
  /** null = tanpa judul (dipakai saat sudah ada judul di luar komponen). */
  title?: string | null;
}

export const QuestionTimerSetting: React.FC<QuestionTimerSettingProps> = ({
  value,
  onChange,
  locked = false,
  lockedNote,
  accent = 'red',
  title = 'Waktu per Soal',
}) => {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => {
    setRaw(String(value));
  }, [value]);

  const a = ACCENT[accent];

  if (locked) {
    return (
      <div className="flex items-start gap-2.5 p-3 rounded-xl bg-black/40 border border-white/10">
        <Lock className="w-4 h-4 text-gray-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          {title && <span className="text-xs font-bold text-white block">{title}</span>}
          <span className="text-[11px] text-gray-400 block">
            {lockedNote} Tidak dapat diubah untuk kuis buatan Editor.
          </span>
        </div>
      </div>
    );
  }

  const handleInput = (text: string) => {
    setRaw(text);
    const n = Number(text);
    if (text !== '' && Number.isFinite(n) && n >= MIN_QUESTION_TIME && n <= MAX_QUESTION_TIME) {
      onChange(Math.round(n));
    }
  };

  const commit = () => {
    const c = clampQuestionTime(raw === '' ? value : raw);
    setRaw(String(c));
    onChange(c);
  };

  return (
    <div className="space-y-2.5">
      {title && (
        <span className="text-xs font-bold text-gray-300 uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          {title}
        </span>
      )}

      <div className="flex flex-wrap gap-2">
        {PRESETS.map((sec) => (
          <button
            key={sec}
            type="button"
            onClick={() => onChange(sec)}
            className={`px-3 py-1.5 rounded-lg border text-[11px] font-bold transition-all cursor-pointer ${
              value === sec ? a.active : 'bg-black/40 border-white/10 text-gray-400 hover:border-white/30'
            }`}
          >
            {sec < 60 ? `${sec}s` : `${sec / 60} mnt`}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-gray-300">
        <input
          type="number"
          inputMode="numeric"
          min={MIN_QUESTION_TIME}
          max={MAX_QUESTION_TIME}
          value={raw}
          onChange={(e) => handleInput(e.target.value)}
          onBlur={commit}
          className={`w-20 px-2 py-1.5 rounded-lg bg-black/60 border border-white/10 text-white font-mono font-bold text-center outline-none ${a.focus}`}
        />
        <span>detik per soal{value >= 60 ? ` (${formatTimeLabel(value)})` : ''}</span>
      </div>
      <p className="text-[10px] text-gray-500">
        Bisa diatur {MIN_QUESTION_TIME} detik sampai {MAX_QUESTION_TIME / 60} menit. Bawaan 30 detik.
      </p>
    </div>
  );
};
