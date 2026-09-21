// src/admin/pages/AudioPage.tsx
import React, { useEffect, useState } from 'react';
import {
  Plus,
  Trash2,
  Upload,
  Save,
  FileText,
  Layers,
  CheckCircle2,
  Image as ImageIcon,
  AlertCircle,
  FileCode,
} from 'lucide-react';
import { adminFetch } from '../adminApi';
import { AudioTrackItem } from '../../types';
import { calculateAudioPricing } from '../../services/pricing';

type AdminTrack = AudioTrackItem & {
  isPublished?: boolean;
  loopAudioUrl?: string;
  loopDuration?: string;
  sheetMusicUrl?: string;
  coverImageUrl?: string;
  licenseFileUrl?: string;
  licenseText?: string;
};

const FIXED_LICENSE = 'Lisensi Komersial PlayMuzeck';

const emptyTrack = (): Partial<AdminTrack> => ({
  title: '',
  artist: 'PlayMuzeck Studio',
  genre: '',
  bpm: 120,
  duration: '00:00',
  durationSec: 0,
  loopDuration: '00:00',
  coverGradient: 'from-amber-500/30 via-orange-950/40 to-black',
  coverIcon: 'Music',
  coverImageUrl: '',
  licenseInfo: FIXED_LICENSE,
  licenseText: '',
  licenseFileUrl: '',
  sheetMusicUrl: '',
  price: 50000,
  isFlagship: false,
  isPublished: true,
  description: '',
  stems: [],
  chordSequence: ['Am', 'F', 'C', 'G'],
  bassSequence: [110, 87.31, 130.81, 98],
  melodySequence: [440, 523.25, 659.25, 523.25],
});

const getAudioDuration = (file: File): Promise<{ text: string; sec: number }> => {
  return new Promise((resolve) => {
    const audio = new Audio();
    const objectUrl = URL.createObjectURL(file);
    audio.src = objectUrl;
    audio.onloadedmetadata = () => {
      const sec = Math.round(audio.duration);
      const mm = Math.floor(sec / 60).toString().padStart(2, '0');
      const ss = (sec % 60).toString().padStart(2, '0');
      URL.revokeObjectURL(objectUrl);
      resolve({ text: `${mm}:${ss}`, sec });
    };
    audio.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ text: '00:00', sec: 0 });
    };
  });
};

export const AudioPage: React.FC = () => {
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [selectedId, setSelectedId] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<Partial<AdminTrack>>(emptyTrack());
  const [status, setStatus] = useState('');
  const [uploading, setUploading] = useState('');

  const [pendingMasterFile, setPendingMasterFile] = useState<File | null>(null);
  const [pendingLoopFile, setPendingLoopFile] = useState<File | null>(null);
  const [pendingCoverFile, setPendingCoverFile] = useState<File | null>(null);
  const [pendingSheetFile, setPendingSheetFile] = useState<File | null>(null);
  const [pendingLicenseFile, setPendingLicenseFile] = useState<File | null>(null);

  const load = async () => {
    try {
      const data = await adminFetch<AdminTrack[]>('/api/admin/tracks');
      setTracks(data);
      if (!selectedId && data[0]) {
        setSelectedId(data[0].id);
        setForm({ ...data[0], licenseInfo: FIXED_LICENSE });
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Gagal memuat katalog.');
    }
  };

  useEffect(() => {
    load();
  }, []);

  const selectTrack = (track: AdminTrack) => {
    setSelectedId(track.id);
    setForm({ ...track, licenseInfo: FIXED_LICENSE });
    setPendingMasterFile(null);
    setPendingLoopFile(null);
    setPendingCoverFile(null);
    setPendingSheetFile(null);
    setPendingLicenseFile(null);
    setStatus('');
  };

  const handleStartNewTrack = () => {
    setSelectedId('new');
    setForm(emptyTrack());
    setPendingMasterFile(null);
    setPendingLoopFile(null);
    setPendingCoverFile(null);
    setPendingSheetFile(null);
    setPendingLicenseFile(null);
    setStatus('Silakan isi metadata dan pilih minimal file Full Audio Master.');
  };

  const executeUpload = async (
    trackId: string,
    kind: 'master' | 'loop' | 'stem' | 'sheet' | 'cover' | 'license',
    file: File,
    stemId?: string,
    durationText?: string
  ) => {
    const body = new FormData();
    body.append('file', file);
    body.append('kind', kind);
    if (stemId) body.append('stemId', stemId);

    const query = new URLSearchParams({
      kind,
      ...(stemId ? { stemId } : {}),
      ...(durationText ? { duration: durationText } : {}),
    });

    return await adminFetch<AdminTrack>(`/api/admin/tracks/${trackId}/audio?${query}`, {
      method: 'POST',
      body,
    });
  };

  const handleSaveTrack = async () => {
    if (!form.title?.trim()) {
      alert('Judul lagu wajib diisi.');
      return;
    }

    const hasMasterAudio = Boolean(form.audioUrl || pendingMasterFile);
    if (!hasMasterAudio) {
      alert('Wajib memilih berkas Full Audio Master sebelum lagu disimpan.');
      return;
    }

    setUploading('Menyimpan data dan berkas...');
    try {
      const payload = {
        ...form,
        licenseInfo: FIXED_LICENSE,
        bpm: Number(form.bpm) || 120,
        price: Math.max(50000, Number(form.price) || 50000),
      };

      let activeId = selectedId;
      let savedRecord: AdminTrack;

      if (!selectedId || selectedId === 'new') {
        const generatedId = `track-${Date.now()}`;
        savedRecord = await adminFetch<AdminTrack>('/api/admin/tracks', {
          method: 'POST',
          body: JSON.stringify({ ...payload, id: generatedId }),
        });
        activeId = savedRecord.id;
        setSelectedId(activeId);
      } else {
        savedRecord = await adminFetch<AdminTrack>(`/api/admin/tracks/${selectedId}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
      }

      if (pendingMasterFile && activeId) {
        savedRecord = await executeUpload(activeId, 'master', pendingMasterFile);
        setPendingMasterFile(null);
      }
      if (pendingLoopFile && activeId) {
        savedRecord = await executeUpload(activeId, 'loop', pendingLoopFile);
        setPendingLoopFile(null);
      }
      if (pendingCoverFile && activeId) {
        savedRecord = await executeUpload(activeId, 'cover', pendingCoverFile);
        setPendingCoverFile(null);
      }
      if (pendingSheetFile && activeId) {
        savedRecord = await executeUpload(activeId, 'sheet', pendingSheetFile);
        setPendingSheetFile(null);
      }
      if (pendingLicenseFile && activeId) {
        try {
          savedRecord = await executeUpload(activeId, 'license', pendingLicenseFile);
        } catch {}
        setPendingLicenseFile(null);
      }

      setForm(savedRecord);
      setStatus('Perubahan berhasil disimpan ke database PostgreSQL.');
      await load();
      selectTrack(savedRecord);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Gagal menyimpan data.');
    } finally {
      setUploading('');
    }
  };

  const removeTrack = async () => {
    if (!selectedId || selectedId === 'new') return;
    if (!confirm('Hapus permanen track ini dari database?')) return;
    await adminFetch(`/api/admin/tracks/${selectedId}`, { method: 'DELETE' });
    setSelectedId(null);
    setForm(emptyTrack());
    await load();
  };

  const handleSelectMasterFile = async (file: File) => {
    setUploading('Membaca durasi file master...');
    const dur = await getAudioDuration(file);
    setUploading('');

    setForm((prev) => ({ ...prev, duration: dur.text, durationSec: dur.sec }));

    if (!selectedId || selectedId === 'new') {
      setPendingMasterFile(file);
    } else {
      setUploading(`Mengunggah ${file.name}...`);
      try {
        const updated = await executeUpload(selectedId, 'master', file, undefined, dur.text);
        setForm(updated);
        setStatus(`Master audio diperbarui. Durasi: ${dur.text}`);
        await load();
      } catch {
        setStatus('Gagal mengunggah file master.');
      } finally {
        setUploading('');
      }
    }
  };

  const handleSelectLoopFile = async (file: File) => {
    const dur = await getAudioDuration(file);
    setForm((prev) => ({ ...prev, loopDuration: dur.text }));

    if (!selectedId || selectedId === 'new') {
      setPendingLoopFile(file);
    } else {
      setUploading(`Mengunggah ${file.name}...`);
      try {
        const updated = await executeUpload(selectedId, 'loop', file, undefined, dur.text);
        setForm(updated);
        await load();
      } catch {
        setStatus('Gagal mengunggah file loop.');
      } finally {
        setUploading('');
      }
    }
  };

  const handleSelectCoverFile = async (file: File) => {
    if (!selectedId || selectedId === 'new') {
      setPendingCoverFile(file);
      setForm((prev) => ({ ...prev, coverImageUrl: URL.createObjectURL(file) }));
    } else {
      setUploading('Mengunggah cover...');
      try {
        const updated = await executeUpload(selectedId, 'cover', file);
        setForm(updated);
        await load();
      } catch {
        setStatus('Gagal mengunggah cover.');
      } finally {
        setUploading('');
      }
    }
  };

  const handleSelectSheetFile = async (file: File) => {
    if (!selectedId || selectedId === 'new') {
      setPendingSheetFile(file);
    } else {
      setUploading('Mengunggah partitur PDF...');
      try {
        const updated = await executeUpload(selectedId, 'sheet', file);
        setForm(updated);
        await load();
      } catch {
        setStatus('Gagal mengunggah partitur PDF.');
      } finally {
        setUploading('');
      }
    }
  };

  // Unggah & Baca Berkas .txt Lisensi
  const handleSelectLicenseFile = async (file: File) => {
    const textContent = await file.text();
    setForm((prev) => ({ ...prev, licenseText: textContent }));

    if (!selectedId || selectedId === 'new') {
      setPendingLicenseFile(file);
    } else {
      setUploading('Mengunggah berkas lisensi .txt...');
      try {
        try {
          const updated = await executeUpload(selectedId, 'license', file);
          setForm({ ...updated, licenseText: textContent });
        } catch {
          const updated = await adminFetch<AdminTrack>(`/api/admin/tracks/${selectedId}`, {
            method: 'PUT',
            body: JSON.stringify({ ...form, licenseText: textContent, licenseInfo: FIXED_LICENSE }),
          });
          setForm(updated);
        }
        await load();
        setStatus('Berkas lisensi .txt berhasil diunggah.');
      } catch {
        setStatus('Gagal mengunggah berkas lisensi .txt.');
      } finally {
        setUploading('');
      }
    }
  };

  const addStemSlot = async () => {
    const stemName = prompt('Nama instrumen stem (misal: Drums, Bass, Melodi Synth):');
    if (!stemName) return;

    const newStem = {
      id: `stem-${Date.now()}`,
      name: stemName,
      type: 'synth',
      color: '#FCA311',
      defaultVolume: 80,
      duration: form.duration !== '00:00' ? form.duration : '00:00',
    };

    const updatedStems = [...(form.stems || []), newStem];
    const updatedForm = { ...form, stems: updatedStems };
    setForm(updatedForm);

    if (selectedId && selectedId !== 'new') {
      try {
        await adminFetch(`/api/admin/tracks/${selectedId}`, {
          method: 'PUT',
          body: JSON.stringify({ ...updatedForm, licenseInfo: FIXED_LICENSE }),
        });
      } catch {}
    }
  };

  const removeStemSlot = async (id: string) => {
    const updatedStems = (form.stems || []).filter((s: any) => s.id !== id);
    const updatedForm = { ...form, stems: updatedStems };
    setForm(updatedForm);

    if (selectedId && selectedId !== 'new') {
      try {
        await adminFetch(`/api/admin/tracks/${selectedId}`, {
          method: 'PUT',
          body: JSON.stringify({ ...updatedForm, licenseInfo: FIXED_LICENSE }),
        });
      } catch {}
    }
  };

  const handleUploadStemAudio = async (stemId: string, file: File) => {
    if (!selectedId || selectedId === 'new') {
      alert('Simpan data track terlebih dahulu sebelum mengunggah stems terpisah.');
      return;
    }
    const dur = await getAudioDuration(file);
    setUploading(`Mengunggah stem ${file.name}...`);
    try {
      const stems = (form.stems || []).map((s: any) =>
        s.id === stemId ? { ...s, duration: dur.text } : s
      );
      await adminFetch(`/api/admin/tracks/${selectedId}`, {
        method: 'PUT',
        body: JSON.stringify({ ...form, stems, licenseInfo: FIXED_LICENSE }),
      });

      const updated = await executeUpload(selectedId, 'stem', file, stemId);
      setForm(updated);
      await load();
    } catch {
      setStatus('Gagal mengunggah berkas stem.');
    } finally {
      setUploading('');
    }
  };

  const deleteFile = async (
    kind: 'master' | 'loop' | 'sheet' | 'cover' | 'stem' | 'license',
    stemId?: string
  ) => {
    if (!selectedId || selectedId === 'new') return;
    if (!confirm(`Hapus berkas ${kind} ini?`)) return;

    if (kind === 'license') {
      const updatedForm = { ...form, licenseFileUrl: '', licenseText: '' };
      setForm(updatedForm);
      try {
        await adminFetch(`/api/admin/tracks/${selectedId}`, {
          method: 'PUT',
          body: JSON.stringify(updatedForm),
        });
        setStatus('Berkas lisensi .txt berhasil dihapus.');
        await load();
      } catch {
        setStatus('Gagal menghapus berkas lisensi.');
      }
      return;
    }

    try {
      const query = new URLSearchParams({ kind, ...(stemId ? { stemId } : {}) });
      const updated = await adminFetch<AdminTrack>(`/api/admin/tracks/${selectedId}/file?${query}`, {
        method: 'DELETE',
      });
      setForm(updated);
      setStatus(`Berkas ${kind} berhasil dihapus.`);
      await load();
    } catch {
      setStatus('Gagal menghapus berkas.');
    }
  };

  const currentPricing = calculateAudioPricing(form.price || 50000, {});

  return (
    <div className="grid lg:grid-cols-[300px_1fr] items-start gap-6">
      {/* 1. Sidebar Track Terkunci Sticky */}
      <aside className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-2xl bg-[#14213D] border border-white/10 p-4 space-y-3 shadow-xl">
        <button
          onClick={handleStartNewTrack}
          className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#FCA311] text-black font-bold py-2.5 text-sm hover:brightness-110 cursor-pointer shadow-md"
        >
          <Plus className="w-4 h-4" /> Track Baru
        </button>

        <div className="space-y-1.5 pr-1">
          {tracks.map((track) => (
            <button
              key={track.id}
              onClick={() => selectTrack(track)}
              className={`w-full text-left rounded-xl p-3 border transition-all cursor-pointer ${
                selectedId === track.id ? 'border-[#FCA311] bg-black/40' : 'border-white/5 hover:bg-black/20'
              }`}
            >
              <p className="text-sm font-semibold text-white truncate">{track.title || 'Untitled'}</p>
              <div className="flex items-center gap-2 text-[11px] text-gray-400 mt-1">
                <span>{track.genre || 'Tanpa Genre'}</span>
              </div>
            </button>
          ))}
          {tracks.length === 0 && (
            <p className="text-xs text-gray-400 text-center py-4">Katalog masih kosong.</p>
          )}
        </div>
      </aside>

      {/* 2. Formulir & File Manager */}
      <section className="rounded-2xl bg-[#14213D] border border-white/10 p-6 space-y-6 shadow-xl">
        {!selectedId && <p className="text-gray-400">Pilih track dari daftar sebelah kiri atau klik "Track Baru".</p>}
        {selectedId && (
          <>
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div>
                <h2 className="text-xl font-extrabold text-white">{form.title || 'Track Baru'}</h2>
                <p className="text-xs text-gray-400 mt-0.5">
                  Wajib mengisi judul lagu dan memilih berkas Full Audio Master.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleSaveTrack}
                  className="flex items-center gap-2 rounded-xl bg-[#FCA311] text-black font-bold px-4 py-2 hover:brightness-110 cursor-pointer text-sm"
                >
                  <Save className="w-4 h-4" /> Simpan Data
                </button>
                {selectedId !== 'new' && (
                  <button
                    onClick={removeTrack}
                    className="flex items-center gap-2 rounded-xl border border-red-500/40 text-red-300 px-3 py-2 hover:bg-red-500/10 cursor-pointer text-sm"
                  >
                    <Trash2 className="w-4 h-4" /> Hapus
                  </button>
                )}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
              <label className="text-xs text-gray-400">
                Judul Lagu *
                <input
                  value={form.title || ''}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Contoh: Clockwork Steps"
                  className="mt-1.5 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white focus:border-[#FCA311] outline-none"
                />
              </label>
              <label className="text-xs text-gray-400">
                Artis / Produser
                <input
                  value={form.artist || ''}
                  onChange={(e) => setForm({ ...form, artist: e.target.value })}
                  className="mt-1.5 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white focus:border-[#FCA311] outline-none"
                />
              </label>
              <label className="text-xs text-gray-400">
                Genre
                <input
                  value={form.genre || ''}
                  onChange={(e) => setForm({ ...form, genre: e.target.value })}
                  placeholder="Masukkan genre musik..."
                  className="mt-1.5 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white focus:border-[#FCA311] outline-none"
                />
              </label>
              <label className="text-xs text-gray-400">
                BPM / Tempo
                <input
                  type="number"
                  value={Number(form.bpm || 120)}
                  onChange={(e) => setForm({ ...form, bpm: Number(e.target.value) })}
                  className="mt-1.5 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white focus:border-[#FCA311] outline-none"
                />
              </label>
              <label className="text-xs text-gray-400">
                Durasi Full Track
                <input
                  readOnly
                  value={form.duration || '00:00'}
                  className="mt-1.5 w-full rounded-lg bg-black/20 border border-white/5 px-3 py-2 text-sm text-emerald-400 font-mono outline-none cursor-not-allowed"
                />
              </label>
              <label className="text-xs text-gray-400">
                Harga Dasar Bundle (Min. Rp70.000)
                <input
                  type="number"
                  step={1000}
                  min={70000}
                  value={Number(form.price || 70000)}
                  onChange={(e) => setForm({ ...form, price: Math.max(70000, Number(e.target.value)) })}
                  className="mt-1.5 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white font-mono focus:border-[#FCA311] outline-none"
                />
              </label>
            </div>

            <label className="text-xs text-gray-400 block">
              Jenis Lisensi (Terkunci ke Komersial)
              <input
                readOnly
                value={FIXED_LICENSE}
                className="mt-1.5 w-full rounded-lg bg-black/20 border border-white/5 px-3 py-2 text-sm text-gray-400 cursor-not-allowed"
              />
            </label>

            <label className="text-xs text-gray-400 block">
              Deskripsi Lagu
              <textarea
                value={form.description || ''}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Tuliskan catatan produksi atau deskripsi lagu..."
                className="mt-1.5 w-full rounded-lg bg-black/40 border border-white/10 px-3 py-2 text-sm text-white min-h-20 focus:border-[#FCA311] outline-none"
              />
            </label>

            {/* SEKSI FILE UPLOAD */}
            <div className="space-y-5 rounded-xl bg-black/30 border border-white/10 p-5">
              <div>
                <h3 className="font-bold text-white flex items-center gap-2">
                  <Upload className="w-4 h-4 text-[#FCA311]" /> Unggah Berkas Studio, Partitur &amp; Lisensi
                </h3>
                <p className="text-xs text-gray-400 mt-1">
                  Kelola gambar sampul, master audio, loop, partitur PDF, dan dokumen lisensi Readme_License.txt.
                </p>
              </div>

              {/* 1. Cover Gambar */}
              <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-[#FCA311]" /> Gambar Sampul / Cover Audio
                  </span>
                  {(form.coverImageUrl || pendingCoverFile) && (
                    <button
                      onClick={() => {
                        setPendingCoverFile(null);
                        deleteFile('cover');
                      }}
                      className="text-red-400 hover:text-red-300 text-xs cursor-pointer font-semibold"
                    >
                      Hapus Cover
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {form.coverImageUrl ? (
                    <img
                      src={form.coverImageUrl}
                      alt="Cover Preview"
                      className="w-16 h-16 rounded-xl object-cover border border-white/10"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-amber-500/30 via-[#14213D] to-black border border-white/10 flex items-center justify-center text-[10px] text-gray-400 text-center p-1">
                      Gradasi Standar
                    </div>
                  )}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={Boolean(uploading)}
                    onChange={(e) => e.target.files?.[0] && handleSelectCoverFile(e.target.files[0])}
                    className="block w-full text-xs text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-[#FCA311] file:text-black file:font-semibold cursor-pointer"
                  />
                </div>
              </div>

              {/* 2. Full Audio Master & Loop */}
              <div className="grid md:grid-cols-2 gap-4">
                <div
                  className={`p-4 rounded-xl border space-y-2 ${
                    !form.audioUrl && !pendingMasterFile
                      ? 'bg-amber-500/5 border-amber-500/30'
                      : 'bg-black/40 border-white/5'
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                      Full Audio Master <span className="text-amber-400 font-bold">*Wajib</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {(form.audioUrl || pendingMasterFile) && (
                        <>
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> {form.duration}
                          </span>
                          <button
                            onClick={() => {
                              setPendingMasterFile(null);
                              setForm((prev) => ({ ...prev, duration: '00:00', durationSec: 0, audioUrl: '' }));
                              deleteFile('master');
                            }}
                            className="text-red-400 hover:text-red-300 text-xs cursor-pointer font-semibold"
                          >
                            Hapus
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {form.audioUrl && <audio controls preload="auto" src={form.audioUrl} className="w-full h-8 mt-1" />}
                  <input
                    type="file"
                    accept=".mp3,.wav,.m4a,.flac,audio/*"
                    disabled={Boolean(uploading)}
                    onChange={(e) => e.target.files?.[0] && handleSelectMasterFile(e.target.files[0])}
                    className="block w-full text-xs text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-[#FCA311] file:text-black file:font-semibold cursor-pointer"
                  />
                </div>

                <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-semibold text-white">Seamless Loop Audio</span>
                    <div className="flex items-center gap-2">
                      {(form.loopAudioUrl || pendingLoopFile) && (
                        <>
                          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> {form.loopDuration || 'Loop Aktif'}
                          </span>
                          <button
                            onClick={() => {
                              setPendingLoopFile(null);
                              setForm((prev) => ({ ...prev, loopDuration: '00:00', loopAudioUrl: '' }));
                              deleteFile('loop');
                            }}
                            className="text-red-400 hover:text-red-300 text-xs cursor-pointer font-semibold"
                          >
                            Hapus
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {form.loopAudioUrl && <audio controls preload="auto" src={form.loopAudioUrl} className="w-full h-8 mt-1" />}
                  <input
                    type="file"
                    accept=".mp3,.wav,.m4a,.flac,audio/*"
                    disabled={Boolean(uploading)}
                    onChange={(e) => e.target.files?.[0] && handleSelectLoopFile(e.target.files[0])}
                    className="block w-full text-xs text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-[#FCA311] file:text-black file:font-semibold cursor-pointer"
                  />
                </div>
              </div>

              {/* 3. Lembar Partitur PDF */}
              <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#FCA311]" /> Lembar Partitur (Sheet Music PDF)
                  </span>
                  <div className="flex items-center gap-3">
                    {form.sheetMusicUrl && (
                      <>
                        <a
                          href={form.sheetMusicUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[11px] text-[#FCA311] hover:underline font-semibold"
                        >
                          Lihat PDF Terunggah
                        </a>
                        <button
                          onClick={() => {
                            setPendingSheetFile(null);
                            deleteFile('sheet');
                          }}
                          className="text-red-400 hover:text-red-300 text-xs cursor-pointer font-semibold"
                        >
                          Hapus
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={Boolean(uploading)}
                  onChange={(e) => e.target.files?.[0] && handleSelectSheetFile(e.target.files[0])}
                  className="block w-full text-xs text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-[#FCA311] file:text-black file:font-semibold cursor-pointer"
                />
              </div>

              {/* 4. Berkas Lisensi Resmi (.txt / Readme_License) */}
              <div className="p-4 rounded-xl bg-black/40 border border-white/5 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                    <FileCode className="w-3.5 h-3.5 text-emerald-400" /> Berkas Lisensi Resmi (.txt / Readme_License)
                  </span>
                  <div className="flex items-center gap-3">
                    {(form.licenseText || form.licenseFileUrl || pendingLicenseFile) && (
                      <>
                        <span className="text-[11px] text-emerald-400 font-mono font-semibold flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Berkas Terunggah
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPendingLicenseFile(null);
                            deleteFile('license');
                          }}
                          className="text-red-400 hover:text-red-300 text-xs cursor-pointer font-semibold"
                        >
                          Hapus
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <input
                  type="file"
                  accept=".txt,text/plain"
                  disabled={Boolean(uploading)}
                  onChange={(e) => e.target.files?.[0] && handleSelectLicenseFile(e.target.files[0])}
                  className="block w-full text-xs text-gray-400 file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-[#FCA311] file:text-black file:font-semibold cursor-pointer"
                />
                {form.licenseText && (
                  <div className="mt-2 p-2.5 rounded-lg bg-black/60 border border-white/5 max-h-24 overflow-y-auto">
                    <p className="text-[10px] text-gray-400 font-mono whitespace-pre-wrap line-clamp-3">
                      {form.licenseText}
                    </p>
                  </div>
                )}
              </div>

              {/* 5. Separated Tracks (Stems) */}
              <div className="space-y-3 pt-2">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5 uppercase tracking-wider">
                    <Layers className="w-3.5 h-3.5 text-[#FCA311]" /> Separated Tracks ({form.stems?.length || 0} Stems)
                  </span>
                  <button
                    type="button"
                    onClick={addStemSlot}
                    className="text-xs bg-[#14213D] border border-[#FCA311] text-[#FCA311] px-3 py-1 rounded-lg hover:bg-[#FCA311] hover:text-black font-semibold cursor-pointer"
                  >
                    + Tambah Instrumen Stem
                  </button>
                </div>

                <div className="grid sm:grid-cols-2 gap-3">
                  {(form.stems || []).map((stem: any) => (
                    <div key={stem.id} className="p-3.5 rounded-xl bg-black/40 border border-white/10 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-bold text-white">{stem.name}</span>
                        <div className="flex items-center gap-2">
                          {stem.duration && (
                            <span className="text-[10px] text-gray-400 font-mono">
                              Durasi: {stem.duration}
                            </span>
                          )}
                          <button
                            onClick={() => removeStemSlot(stem.id)}
                            className="text-red-400 hover:text-red-300 text-xs cursor-pointer font-semibold"
                          >
                            Hapus
                          </button>
                        </div>
                      </div>

                      {stem.audioUrl && <audio controls preload="auto" src={stem.audioUrl} className="w-full h-8" />}

                      <input
                        type="file"
                        accept=".mp3,.wav,.m4a,.flac,audio/*"
                        disabled={Boolean(uploading)}
                        onChange={(e) => e.target.files?.[0] && handleUploadStemAudio(stem.id, e.target.files[0])}
                        className="block w-full text-[11px] text-gray-400 file:mr-2 file:py-0.5 file:px-2 file:rounded file:border-0 file:bg-[#FCA311] file:text-black cursor-pointer"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {uploading && <p className="text-xs text-[#FCA311] animate-pulse">{uploading}</p>}
            </div>

            {status && (
              <div className="p-3 rounded-xl border bg-amber-950/40 border-amber-500/20 text-amber-300 text-sm flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{status}</span>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
};