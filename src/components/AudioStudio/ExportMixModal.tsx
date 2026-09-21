import React, { useState } from 'react';
import { X, Download, FileAudio, Check, Loader2, Sparkles, Sliders } from 'lucide-react';
import { AudioTrackItem, StemChannelState } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { exportAudioFile } from '../../services/exporters';

interface ExportMixModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTrack: AudioTrackItem;
  channelStates: StemChannelState[];
  onSuccessToast: (msg: string) => void;
}

export const ExportMixModal: React.FC<ExportMixModalProps> = ({
  isOpen,
  onClose,
  activeTrack,
  channelStates,
  onSuccessToast,
}) => {
  const [fileName, setFileName] = useState(`PlayMuzeck_Mix_${activeTrack.title.replace(/\s+/g, '_')}`);
  const [selectedFormat, setSelectedFormat] = useState<'WAV' | 'MP3' | 'M4A' | 'FLAC'>('WAV');
  const [exportDuration, setExportDuration] = useState<number>(16); // seconds
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  if (!isOpen) return null;

  const handleStartExport = async () => {
    setIsExporting(true);
    setExportProgress(15);

    try {
      // Step 1: Render audio offline with user stem volumes and EQ
      setExportProgress(45);
      const audioBuffer = await audioEngine.renderOfflineAudio(
        activeTrack,
        exportDuration,
        channelStates
      );

      setExportProgress(85);
      // Step 2: Encode to requested format and initiate real browser download
      await exportAudioFile(audioBuffer, fileName, selectedFormat);
      setExportProgress(100);

      onSuccessToast(`Berkas ${fileName}.${selectedFormat.toLowerCase()} berhasil diekspor!`);
      setTimeout(() => {
        setIsExporting(false);
        onClose();
      }, 600);
    } catch (err: unknown) {
      setIsExporting(false);
      const errorMsg = err instanceof Error ? err.message : 'Gagal mengekspor audio.';
      alert(`Gagal mengekspor: ${errorMsg}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto animate-fade-in">
      <div className="w-full max-w-md max-h-[92vh] overflow-y-auto my-auto rounded-2xl bg-[#14213D] border border-white/[0.12] p-6 shadow-2xl relative">
        <button
          onClick={onClose}
          disabled={isExporting}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/50 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Modal Title */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-[#FCA311]/20 text-[#FCA311] flex items-center justify-center">
            <FileAudio className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Ekspor Hasil Mixing Audio</h3>
            <p className="text-xs text-gray-400">Rendering client-side kualitas tinggi dari browser</p>
          </div>
        </div>

        {/* Active Track Info */}
        <div className="bg-black/40 p-3 rounded-xl border border-white/[0.06] mb-4 flex items-center justify-between">
          <div className="truncate pr-2">
            <p className="text-xs font-bold text-white truncate">{activeTrack.title}</p>
            <p className="text-[11px] text-gray-400">{activeTrack.genre} • {activeTrack.bpm} BPM</p>
          </div>
          <span className="px-2 py-0.5 rounded-full bg-amber-500/20 text-[#FCA311] text-[10px] font-bold">
            {channelStates.filter((s) => !s.muted).length} Stems Aktif
          </span>
        </div>

        {/* Filename Input */}
        <div className="space-y-1.5 mb-4">
          <label className="text-xs font-semibold text-gray-300">Nama Berkas</label>
          <div className="flex items-center bg-black/50 rounded-xl border border-white/[0.1] px-3 py-2 text-sm text-white focus-within:border-[#FCA311]">
            <input
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              disabled={isExporting}
              className="w-full bg-transparent focus:outline-none text-xs font-mono"
              placeholder="Masukkan nama berkas"
            />
            <span className="text-xs font-mono text-gray-500">.{selectedFormat.toLowerCase()}</span>
          </div>
        </div>

        {/* Format Selection */}
        <div className="space-y-1.5 mb-4">
          <label className="text-xs font-semibold text-gray-300">Pilih Format Audio</label>
          <div className="grid grid-cols-2 xs:grid-cols-4 gap-2">
            {(['WAV', 'MP3', 'M4A', 'FLAC'] as const).map((fmt) => (
              <button
                key={fmt}
                type="button"
                onClick={() => setSelectedFormat(fmt)}
                disabled={isExporting}
                className={`py-2 px-2 rounded-xl text-xs font-bold border transition-all cursor-pointer text-center ${
                  selectedFormat === fmt
                    ? 'bg-[#FCA311] text-black border-[#FCA311] shadow-md'
                    : 'bg-black/40 text-gray-300 border-white/[0.08] hover:border-white/20'
                }`}
              >
                {fmt}
                <div className="text-[9px] font-normal opacity-80 mt-0.5">
                  {fmt === 'WAV' ? 'Studio 24-bit' : fmt === 'MP3' ? '320 kbps' : fmt === 'M4A' ? 'AAC Audio' : 'Lossless'}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Duration Selection */}
        <div className="space-y-1.5 mb-5">
          <label className="text-xs font-semibold text-gray-300">Durasi Render</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: '8 Detik (Loop)', val: 8 },
              { label: '16 Detik (Standar)', val: 16 },
              { label: '30 Detik (Full Preview)', val: 30 },
            ].map((d) => (
              <button
                key={d.val}
                type="button"
                onClick={() => setExportDuration(d.val)}
                disabled={isExporting}
                className={`py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer ${
                  exportDuration === d.val
                    ? 'bg-white text-black border-white'
                    : 'bg-black/30 text-gray-400 border-white/[0.06] hover:text-white'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Progress Bar if Exporting */}
        {isExporting && (
          <div className="mb-4 space-y-1.5">
            <div className="flex justify-between text-xs text-gray-300">
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FCA311]" />
                Meresolusi dan merender offline buffer...
              </span>
              <span className="font-mono">{exportProgress}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-black/60 overflow-hidden border border-white/[0.08]">
              <div
                className="h-full bg-gradient-to-r from-[#FCA311] to-amber-300 transition-all duration-300"
                style={{ width: `${exportProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Action Button */}
        <button
          id="btn-confirm-export"
          onClick={handleStartExport}
          disabled={isExporting}
          className="w-full py-3 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] text-black font-extrabold text-sm shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50 active:scale-[0.99]"
        >
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Memproses Export...</span>
            </>
          ) : (
            <>
              <Download className="w-4 h-4" />
              <span>Unduh Berkas {selectedFormat}</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
