import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Sparkles, Send, CheckCircle2, Music, Clock, FileText, Mail } from 'lucide-react';
import { CustomAudioInquiry } from '../../types';
import { storage } from '../../services/storage';
import { submitInquiry } from '../../services/analytics';

interface CustomAudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  userEmail: string;
}

export const CustomAudioModal: React.FC<CustomAudioModalProps> = ({
  isOpen,
  onClose,
  userEmail,
}) => {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('Ambient Synthwave');
  const [mood, setMood] = useState('Misterius & Sinematik');
  const [duration, setDuration] = useState('2 Menit (Format Standar)');
  const [notes, setNotes] = useState('');
  const [email, setEmail] = useState(userEmail || '');
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const newInquiry: CustomAudioInquiry = {
      id: `inquiry-${Date.now()}`,
      title: title.trim() || 'Komposisi Custom PlayMuzeck',
      genre,
      mood,
      duration,
      notes,
      email: email.trim() || userEmail || 'guest@PlayMuzeck.id',
      createdAt: new Date().toISOString(),
    };

    storage.addCustomInquiry(newInquiry);
    submitInquiry({ ...newInquiry }).catch(() => {});
    setIsSubmitted(true);
  };

  const handleReset = () => {
    setIsSubmitted(false);
    setTitle('');
    setNotes('');
    onClose();
  };

  return (
    <div
      id="custom-audio-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg rounded-2xl bg-[#14213D] border border-white/[0.1] shadow-2xl overflow-hidden my-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/[0.08] bg-black/40">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#FCA311] text-black">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Request Custom Audio</h3>
              <p className="text-xs text-gray-400">Pesan aransemen musik orisinal dari PlayMuzeck Collective</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <AnimatePresence mode="wait">
            {isSubmitted ? (
              <motion.div
                key="submitted"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center py-6 space-y-4"
              >
                <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-500 text-emerald-400 mx-auto flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-white">Permintaan Terkirim!</h4>
                  <p className="text-xs text-gray-300 max-w-sm mx-auto mt-1 leading-relaxed">
                    Brief musikmu untuk proyek <strong className="text-white">"{title || 'Musik Custom'}"</strong> telah diterima tim produser PlayMuzeck. Estimasi draf sampel audio akan diproses ke surel <span className="text-[#FCA311]">{email}</span>.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-black/40 border border-white/[0.06] text-xs text-gray-400 text-left space-y-1">
                  <div>Genre: <span className="text-white font-medium">{genre}</span></div>
                  <div>Suasana / Mood: <span className="text-white font-medium">{mood}</span></div>
                  <div>Durasi: <span className="text-white font-medium">{duration}</span></div>
                </div>

                <button
                  onClick={handleReset}
                  className="px-6 py-2.5 rounded-xl bg-[#FCA311] text-black font-extrabold text-xs shadow hover:bg-[#FCA311]/90 transition-all cursor-pointer"
                >
                  Selesai & Tutup
                </button>
              </motion.div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Judul Proyek / Nama Lagu</label>
                  <input
                    type="text"
                    required
                    placeholder="Contoh: Tema Game Petualangan Luar Angkasa"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300">Genre Musik</label>
                    <select
                      value={genre}
                      onChange={(e) => setGenre(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl px-3 py-2 text-xs text-white outline-none"
                    >
                      <option value="Ambient Synthwave">Ambient Synthwave</option>
                      <option value="Cinematic Orchestral">Cinematic Orchestral</option>
                      <option value="Lofi Chill & Beats">Lofi Chill & Beats</option>
                      <option value="Cyberpunk Electronic">Cyberpunk Electronic</option>
                      <option value="Acoustic Folk Minimalist">Acoustic Folk Minimalist</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-300">Durasi Target</label>
                    <select
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl px-3 py-2 text-xs text-white outline-none"
                    >
                      <option value="30 Detik (Jingle / Teaser)">30 Detik (Jingle / Teaser)</option>
                      <option value="1 Menit (Video Pendek)">1 Menit (Video Pendek)</option>
                      <option value="2-3 Menit (Full Song)">2-3 Menit (Full Song)</option>
                      <option value="Seamless Loop BGM (Tak Terbatas)">Seamless Loop BGM</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Suasana / Mood yang Diinginkan</label>
                  <input
                    type="text"
                    placeholder="Contoh: Misterius, hangat, megah dengan reverb luas"
                    value={mood}
                    onChange={(e) => setMood(e.target.value)}
                    className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Catatan Tambahan & Brief</label>
                  <textarea
                    rows={3}
                    placeholder="Tuliskan referensi musisi, instrumen utama yang diinginkan, atau penggunaan video..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl p-3 text-xs text-white placeholder-gray-500 outline-none resize-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-300">Kontak Email Pengirim</label>
                  <input
                    type="email"
                    required
                    placeholder="nama@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full bg-black/60 border border-white/[0.08] focus:border-[#FCA311] rounded-xl px-3 py-2 text-xs text-white placeholder-gray-500 outline-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 rounded-xl bg-[#FCA311] hover:bg-[#FCA311]/90 text-black font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 mt-2"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Kirim Permintaan Custom Audio</span>
                </button>
              </form>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
};
