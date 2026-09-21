// src/components/AudioStudio/AudioCatalogCarousel.tsx
import React, { useState, useMemo } from 'react';
import {
  Search,
  X,
  Download,
  ChevronLeft,
  ChevronRight,
  Layers,
  Clock,
  Music,
  Check,
  ShieldCheck,
} from 'lucide-react';
import { AudioTrackItem } from '../../types';
import { audioEngine } from '../../services/audioEngine';
import { calculateAudioPricing } from '../../services/pricing';

interface AudioCatalogCarouselProps {
  tracks: AudioTrackItem[];
  activeTrackId: string;
  onSelectTrack: (track: AudioTrackItem) => void;
  isPlaying?: boolean;
  onTogglePlay?: (track: AudioTrackItem) => void;
}

const CARDS_PER_PAGE = 8;

export const AudioCatalogCarousel: React.FC<AudioCatalogCarouselProps> = ({
  tracks = [],
  activeTrackId,
  onSelectTrack,
  isPlaying = false,
  onTogglePlay,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('all');
  const [durationRange, setDurationRange] = useState<'all' | 'short' | 'medium' | 'long'>('all');
  const [stemsFilter, setStemsFilter] = useState<'all' | '2-3' | '4' | '5+'>('all');
  const [currentPage, setCurrentPage] = useState(0);
  const [detailModalTrack, setDetailModalTrack] = useState<AudioTrackItem | null>(null);

  const getTrackCover = (t: any): string => {
    if (!t) return '';
    const candidates = [
      // 'coverImageUrl' adalah field yang BENERAN dipakai backend/admin
      // (lihat AdminTrack di src/admin/pages/AudioPage.tsx). Sebelumnya
      // field ini TIDAK ADA di daftar kandidat, jadi getTrackCover selalu
      // pulang string kosong meski admin sudah upload cover — makanya di
      // client semua kartu selalu jatuh ke ikon musik default.
      t.coverImageUrl,
      t.cover_image_url,
      t.coverUrl,
      t.cover_url,
      t.coverImage,
      t.cover_image,
      t.imageUrl,
      t.image_url,
      t.cover,
      t.image,
      t.artwork,
      t.artworkUrl,
      t.artwork_url,
      t.thumbnail,
      t.thumbnailUrl,
      t.thumbnail_url,
    ];
    for (const c of candidates) {
      if (!c) continue;
      // URL blob: hanya valid di tab/sesi browser yang membuatnya (mis. sesi
      // admin saat preview lokal sebelum upload selesai) — kalau ini yang
      // ke-simpan, jangan dipakai di client, biar jatuh ke fallback ikon
      // alih-alih nampilin gambar rusak.
      if (typeof c === 'string' && c.trim() !== '' && !c.trim().startsWith('blob:')) return c.trim();
      if (Array.isArray(c) && c.length > 0) {
        const first = c[0];
        if (typeof first === 'string' && first.trim() !== '' && !first.trim().startsWith('blob:')) return first.trim();
        if (first && typeof first === 'object' && (first.src || first.url)) {
          const val = (first.src || first.url).trim();
          if (!val.startsWith('blob:')) return val;
        }
      }
      if (typeof c === 'object' && (c.url || c.src)) {
        const val = (c.url || c.src).trim();
        if (!val.startsWith('blob:')) return val;
      }
    }
    return '';
  };

  const getDurationSec = (track: AudioTrackItem): number => {
    const rawDur =
      (track as any).durationSec ??
      (track as any).duration_sec ??
      (track as any).duration;
    if (typeof rawDur === 'number' && rawDur > 0) return rawDur;
    if (typeof rawDur === 'string' && rawDur.includes(':')) {
      const [m, s] = rawDur.split(':').map(Number);
      if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
    }
    return 168;
  };

  const formatDurationStr = (track: AudioTrackItem): string => {
    const rawDur = (track as any).duration;
    if (typeof rawDur === 'string' && rawDur.includes(':')) return rawDur;
    const sec = getDurationSec(track);
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getStemsCount = (track: AudioTrackItem): number => {
    if (typeof (track as any).stemsCount === 'number' && (track as any).stemsCount > 0) {
      return (track as any).stemsCount;
    }
    if (typeof (track as any).stems_count === 'number' && (track as any).stems_count > 0) {
      return (track as any).stems_count;
    }
    if (Array.isArray((track as any).stems) && (track as any).stems.length > 0) {
      return (track as any).stems.length;
    }
    if (Array.isArray((track as any).separatedStems) && (track as any).separatedStems.length > 0) {
      return (track as any).separatedStems.length;
    }
    return 4;
  };

  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    tracks.forEach((t) => {
      const g = (t as any).genre;
      if (g) set.add(g);
    });
    return Array.from(set);
  }, [tracks]);

  const filteredTracks = useMemo(() => {
    return tracks.filter((track) => {
      const q = searchQuery.toLowerCase().trim();
      const titleMatch = track.title?.toLowerCase().includes(q);
      const artistMatch = ((track as any).artist || (track as any).producer || 'PlayMuzeck Studio')
        .toLowerCase()
        .includes(q);
      const genreMatch = ((track as any).genre || '').toLowerCase().includes(q);

      if (q && !titleMatch && !artistMatch && !genreMatch) return false;

      if (selectedGenre !== 'all' && (track as any).genre !== selectedGenre) {
        return false;
      }

      const durSec = getDurationSec(track);
      if (durationRange === 'short' && durSec >= 120) return false;
      if (durationRange === 'medium' && (durSec < 120 || durSec > 240)) return false;
      if (durationRange === 'long' && durSec <= 240) return false;

      const stems = getStemsCount(track);
      if (stemsFilter === '2-3' && (stems < 2 || stems > 3)) return false;
      if (stemsFilter === '4' && stems !== 4) return false;
      if (stemsFilter === '5+' && stems < 5) return false;

      return true;
    });
  }, [tracks, searchQuery, selectedGenre, durationRange, stemsFilter]);

  const totalPages = Math.ceil(filteredTracks.length / CARDS_PER_PAGE);
  const safeCurrentPage = Math.min(currentPage, Math.max(0, totalPages - 1));

  const visibleTracks = useMemo(() => {
    const start = safeCurrentPage * CARDS_PER_PAGE;
    return filteredTracks.slice(start, start + CARDS_PER_PAGE);
  }, [filteredTracks, safeCurrentPage]);

  const handleResetFilters = () => {
    audioEngine.playClickSound();
    setSearchQuery('');
    setSelectedGenre('all');
    setDurationRange('all');
    setStemsFilter('all');
    setCurrentPage(0);
  };

  const isFilterActive =
    Boolean(searchQuery) ||
    selectedGenre !== 'all' ||
    durationRange !== 'all' ||
    stemsFilter !== 'all';

  return (
    <div className="space-y-6 pt-2">
      {/* Search Bar & Filter Row */}
      <div className="p-4 sm:p-5 rounded-2xl bg-[#14213D]/60 border border-white/[0.08] space-y-3.5 shadow-lg">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Cari judul musik, genre, produser..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(0);
              }}
              className="w-full bg-black/60 border border-white/10 rounded-xl pl-9 pr-8 py-2 text-xs text-white placeholder:text-gray-400 focus:outline-none focus:border-[#FCA311] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap w-full md:w-auto justify-start md:justify-end text-xs">
            <select
              value={selectedGenre}
              onChange={(e) => {
                setSelectedGenre(e.target.value);
                setCurrentPage(0);
              }}
              className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-gray-200 focus:border-[#FCA311] outline-none cursor-pointer"
            >
              <option value="all">Semua Genre</option>
              {availableGenres.map((g) => (
                <option key={g} value={g} className="bg-[#14213D] text-white">
                  {g}
                </option>
              ))}
            </select>

            <select
              value={durationRange}
              onChange={(e) => {
                setDurationRange(e.target.value as any);
                setCurrentPage(0);
              }}
              className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-gray-200 focus:border-[#FCA311] outline-none cursor-pointer"
            >
              <option value="all">Semua Durasi</option>
              <option value="short">&lt; 2 Menit</option>
              <option value="medium">2 – 4 Menit</option>
              <option value="long">&gt; 4 Menit</option>
            </select>

            <select
              value={stemsFilter}
              onChange={(e) => {
                setStemsFilter(e.target.value as any);
                setCurrentPage(0);
              }}
              className="bg-black/60 border border-white/10 rounded-xl px-3 py-2 text-gray-200 focus:border-[#FCA311] outline-none cursor-pointer"
            >
              <option value="all">Semua Stem</option>
              <option value="2-3">2 – 3 Stems</option>
              <option value="4">4 Stems</option>
              <option value="5+">5+ Stems</option>
            </select>

            {isFilterActive && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 font-bold flex items-center gap-1 transition-colors cursor-pointer border border-red-500/20"
              >
                <X className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between text-[11px] text-gray-300 pt-1 border-t border-white/5 font-mono">
          <span>
            Menampilkan <strong className="text-white">{filteredTracks.length}</strong> musik audio orisinal
          </span>
          {totalPages > 1 && (
            <span>
              Halaman {safeCurrentPage + 1} dari {totalPages}
            </span>
          )}
        </div>
      </div>

      {/* Grid 4 Kolom x 2 Baris (Maksimal 8 Kartu per Halaman) */}
      {filteredTracks.length === 0 ? (
        <div className="p-12 text-center rounded-2xl bg-black/30 border border-dashed border-white/10 space-y-3">
          <Music className="w-8 h-8 text-gray-400 mx-auto" />
          <p className="text-sm font-bold text-gray-200">Tidak ada musik yang cocok dengan filter yang dipilih.</p>
          <button
            type="button"
            onClick={handleResetFilters}
            className="px-4 py-2 rounded-xl bg-[#FCA311] text-black text-xs font-bold cursor-pointer"
          >
            Bersihkan Filter
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {visibleTracks.map((track) => {
            const isActive = String(track.id) === String(activeTrackId);
            const coverUrl = getTrackCover(track);
            const genre = (track as any).genre || 'General';
            const artist = (track as any).artist || (track as any).producer || 'PlayMuzeck Studio';
            const bpm = (track as any).bpm || 120;
            const stems = getStemsCount(track);
            const durationStr = formatDurationStr(track);

            return (
              <div
                key={track.id}
                onClick={() => {
                  audioEngine.playClickSound();
                  setDetailModalTrack(track);
                }}
                className={`rounded-2xl p-3.5 flex flex-col justify-between transition-all cursor-pointer group relative bg-[#14213D]/90 border ${
                  isActive
                    ? 'border-2 border-[#FCA311] shadow-[0_0_25px_rgba(252,163,17,0.35)] ring-2 ring-[#FCA311]/40 scale-[1.01]'
                    : 'border-white/10 hover:border-[#FCA311]/60 hover:bg-[#14213D]'
                }`}
              >
                <div>
                  {/* Artwork Box dengan Latar Jelas & Terang */}
                  <div className="w-full h-36 rounded-xl overflow-hidden relative mb-3 bg-gradient-to-tr from-[#1a294a] via-[#14213D] to-[#1f3159] flex items-center justify-center border border-white/10 shadow-inner">
                    <span className="absolute top-2 left-2 z-10 px-2.5 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[10px] font-bold text-white border border-white/15 font-mono shadow">
                      {genre}
                    </span>

                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={track.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          const fallback = e.currentTarget.nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}

                    {/* Fallback Icon Lingkaran Terang */}
                    <div
                      className="w-16 h-16 rounded-full bg-gradient-to-tr from-amber-500/30 to-amber-600/10 border border-amber-500/40 items-center justify-center shadow-lg"
                      style={{ display: coverUrl ? 'none' : 'flex' }}
                    >
                      <Music className="w-7 h-7 text-[#FCA311]" />
                    </div>

                    {/* Tombol Load — area ini SATU-SATUNYA yang langsung memuat
                        audio ke studio (stopPropagation supaya tidak ikut
                        membuka popup deskripsi di kartu bawahnya). Klik di
                        luar lingkaran ini (sisa area kartu) tetap membuka
                        popup deskripsi seperti biasa. */}
                    <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          audioEngine.playClickSound();
                          onSelectTrack(track);
                        }}
                        title="Muat langsung ke Audio Studio"
                        className="w-11 h-11 rounded-full bg-[#FCA311] text-black flex items-center justify-center shadow-xl shadow-amber-500/40 pointer-events-auto hover:scale-110 hover:brightness-110 active:scale-95 transition-transform cursor-pointer"
                      >
                        <Download className="w-5 h-5 stroke-[2.5]" />
                      </button>
                    </div>
                  </div>

                  {/* Judul & Produser */}
                  <h4 className="text-base font-black text-white truncate tracking-tight">
                    {track.title}
                  </h4>
                  <p className="text-xs text-gray-300 font-medium truncate mb-2.5">
                    {artist}
                  </p>

                  {/* Meta Pills */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-3 text-[10px] font-mono text-gray-200">
                    <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10">
                      {bpm} BPM
                    </span>
                    <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-[#FCA311]" />
                      <span>{durationStr}</span>
                    </span>
                    <span className="px-2 py-0.5 rounded bg-black/60 border border-white/10 flex items-center gap-1">
                      <Layers className="w-3 h-3 text-[#FCA311]" />
                      <span>{stems} Stems</span>
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2.5 border-t border-white/10 text-xs">
                  <span className="text-gray-300 text-[11px] font-medium">Lisensi Komersial</span>
                  <span className="font-black text-[#FCA311] font-mono">
                    Rp {(track.price || 70000).toLocaleString('id-ID')}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Navigasi Paginasi */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between p-3 rounded-2xl bg-[#14213D]/60 border border-white/[0.08]">
          <button
            type="button"
            disabled={safeCurrentPage === 0}
            onClick={() => {
              audioEngine.playClickSound();
              setCurrentPage((prev) => Math.max(0, prev - 1));
            }}
            className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-bold flex items-center gap-1.5 text-gray-200 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Sebelumnya (8 Kartu)</span>
          </button>

          <div className="flex items-center gap-1.5">
            {Array.from({ length: totalPages }).map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  audioEngine.playClickSound();
                  setCurrentPage(idx);
                }}
                className={`w-8 h-8 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                  safeCurrentPage === idx
                    ? 'bg-[#FCA311] text-black font-black shadow'
                    : 'bg-black/50 text-gray-300 hover:text-white border border-white/10'
                }`}
              >
                {idx + 1}
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={safeCurrentPage >= totalPages - 1}
            onClick={() => {
              audioEngine.playClickSound();
              setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1));
            }}
            className="px-4 py-2 rounded-xl bg-[#FCA311] hover:bg-[#e58e00] disabled:opacity-30 disabled:cursor-not-allowed text-xs font-black text-black flex items-center gap-1.5 transition-colors cursor-pointer shadow-md"
          >
            <span>Selanjutnya (8 Kartu)</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* -----------------------------------------------------------------
          POPUP DETAIL LAGU
          Sebelumnya modal ini hilang sepenuhnya saat komponen di-rewrite
          (fitur search/filter/pagination ditambahkan tapi modal deskripsi
          kepencet ke-drop). Card sekarang klik -> buka modal ini dulu;
          load ke studio dipindah jadi tombol eksplisit di dalam modal.
         ----------------------------------------------------------------- */}
      {detailModalTrack && (() => {
        const pricing = calculateAudioPricing(detailModalTrack.price || 70000, {});
        const modalCover = getTrackCover(detailModalTrack);
        const stems = (detailModalTrack as any).stems || [];
        const genre = (detailModalTrack as any).genre || 'General';
        const artist = (detailModalTrack as any).artist || (detailModalTrack as any).producer || 'PlayMuzeck Studio';

        return (
          <div
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setDetailModalTrack(null)}
          >
            <div
              className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-[#0d1527] border border-white/15 p-6 sm:p-8 space-y-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => setDetailModalTrack(null)}
                className="absolute top-5 right-5 p-2 rounded-full bg-white/10 text-gray-300 hover:text-white hover:bg-white/20 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-start gap-4 sm:gap-6">
                <div className="relative w-24 h-24 sm:w-28 sm:h-28 shrink-0 rounded-2xl overflow-hidden border-2 border-zinc-700 flex items-center justify-center shadow-lg bg-gradient-to-br from-amber-500/30 via-[#14213D] to-black">
                  <div className="w-12 h-12 rounded-full bg-[#FCA311] flex items-center justify-center shadow-md">
                    <Music className="w-6 h-6 text-black" />
                  </div>
                  {modalCover && (
                    <img
                      src={modalCover}
                      alt={detailModalTrack.title}
                      className="absolute inset-0 w-full h-full object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLElement).style.display = 'none';
                      }}
                    />
                  )}
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#FCA311]">
                    {genre}
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-black text-white">
                    {detailModalTrack.title}
                  </h2>
                  <p className="text-sm text-gray-400">Produser: {artist}</p>
                  <div className="flex flex-wrap gap-2 pt-1 text-xs">
                    <span className="px-2 py-0.5 rounded bg-white/5 font-mono text-gray-300">
                      {(detailModalTrack as any).bpm || 120} BPM
                    </span>
                    <span className="px-2 py-0.5 rounded bg-white/5 font-mono text-gray-300">
                      Full: {formatDurationStr(detailModalTrack)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 bg-black/40 p-4 rounded-2xl border border-white/5 text-xs">
                <div className="flex items-center gap-2 text-emerald-400 font-bold">
                  <ShieldCheck className="w-4 h-4" />
                  <span>Lisensi Komersial PlayMuzeck (Siaran & Produksi Bebas Royalti)</span>
                </div>
                <p className="text-gray-300 leading-relaxed">
                  {(detailModalTrack as any).description ||
                    'Karya audio profesional dengan pemisahan channel stem penuh, loop transisi mulus, dan partitur notasi balok studio.'}
                </p>
              </div>

              {stems.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Daftar Separated Tracks ({stems.length} Channel)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {stems.map((stem: any) => (
                      <div
                        key={stem.id}
                        className="p-2.5 rounded-xl bg-white/5 border border-white/5 text-xs flex justify-between items-center"
                      >
                        <span className="font-semibold text-white truncate max-w-[100px]">
                          {stem.name}
                        </span>
                        <span className="text-[10px] text-gray-400 font-mono">
                          {stem.duration || detailModalTrack.duration}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                  Rincian Harga Produk Terpisah
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <p className="text-gray-400">Full Audio</p>
                    <p className="font-bold text-white">
                      Rp {pricing.products.fullMaster.toLocaleString('id-ID')}
                    </p>
                  </div>
                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <p className="text-gray-400">Loop Version</p>
                    <p className="font-bold text-white">
                      Rp {pricing.products.loopVersion.toLocaleString('id-ID')}
                    </p>
                  </div>
                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <p className="text-gray-400">Stems</p>
                    <p className="font-bold text-white">
                      Rp {pricing.products.separatedStems.toLocaleString('id-ID')}
                    </p>
                  </div>
                  <div className="bg-black/50 p-3 rounded-xl border border-white/5">
                    <p className="text-gray-400">Partitur PDF</p>
                    <p className="font-bold text-white">
                      Rp {pricing.products.sheetMusic.toLocaleString('id-ID')}
                    </p>
                  </div>
                </div>
              </div>

              <div className="pt-2 flex gap-3">
                <button
                  onClick={() => {
                    audioEngine.playClickSound();
                    onSelectTrack(detailModalTrack);
                    setDetailModalTrack(null);
                  }}
                  className="flex-1 py-3.5 rounded-2xl bg-[#FCA311] text-black font-extrabold text-sm hover:brightness-110 cursor-pointer text-center shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
                >
                  <Check className="w-4 h-4" />
                  <span>Pilih & Muat ke Audio Studio</span>
                </button>
                <button
                  onClick={() => setDetailModalTrack(null)}
                  className="px-6 py-3.5 rounded-2xl bg-white/10 text-gray-300 font-bold text-sm hover:bg-white/20 cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};