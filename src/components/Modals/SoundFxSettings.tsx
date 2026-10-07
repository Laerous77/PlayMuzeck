// src/components/Modals/SoundFxSettings.tsx
// Isi tab "Efek Suara" di dasbor profil.
import React, { useEffect, useState } from 'react';
import { Volume2, VolumeX, Lock, Play, Shuffle, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { audioEngine, INSTRUMENTS_128, SOUND_BANK_READY_MESSAGE } from '../../services/audioEngine';
import { SoundBankCredits } from '../AudioStudio/SoundBankCredits';
import {
  SFX_SECTIONS,
  SFX_SECTION_LABEL,
  BUILTIN_SFX,
  GM_NOTE_MIN,
  GM_NOTE_MAX,
  getSfxSettings,
  getSfxSaveState,
  isGmUnlocked,
  getSfxLoadState,
  retrySfxLoad,
  SfxLoadState,
  updateSfx,
  subscribeSfx,
  resolveSlotNote,
  SfxSettings,
  SfxSection,
  GmSlot,
  BuiltinSfxId,
} from '../../services/sfxSettings';

interface Props {
  isLoggedIn: boolean;
  /** Dipanggil saat pengguna menekan ajakan membuka Full 16-Bar Editor. */
  onGetPadEditor?: () => void;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const noteName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const NOTE_OPTIONS = Array.from({ length: GM_NOTE_MAX - GM_NOTE_MIN + 1 }, (_, i) => GM_NOTE_MIN + i);

// Daftar kategori diambil dari INSTRUMENTS_128, sama seperti PadStudio.
const INSTRUMENT_CATEGORIES = Array.from(new Set(INSTRUMENTS_128.map((inst) => inst.category)));

// Acak hanya dari instrumen musikal (0-119). Kategori "Sound Effects" (120-127:
// tembakan, helikopter, dsb.) tidak cocok untuk suara klik, tapi tetap bisa dipilih manual.
const randomSlotValues = (): Pick<GmSlot, 'program' | 'note'> => ({
  program: Math.floor(Math.random() * 120),
  note: 48 + Math.floor(Math.random() * 37), // C3..C6
});

const sectionHint: Record<SfxSection, string> = {
  audio: 'Klik di Audio Studio (pad, stem, audio tools)',
  quiz: 'Klik di Pusat Kuis dan saat bermain kuis',
  other: 'Beranda, keranjang, profil, dan sisanya',
};

export const SoundFxSettings: React.FC<Props> = ({ isLoggedIn, onGetPadEditor }) => {
  const [s, setS] = useState<SfxSettings>(() => getSfxSettings());
  const [padUnlocked, setPadUnlocked] = useState(() => isGmUnlocked());
  const [loadState, setLoadState] = useState<SfxLoadState>(() => getSfxLoadState());
  const [save, setSave] = useState(() => getSfxSaveState());
  const [engineStatus, setEngineStatus] = useState<string>('');
  const [bankReady, setBankReady] = useState<boolean>(() => audioEngine.isLoaded);

  // Ikuti perubahan dari server (mis. data selesai dimuat setelah tab dibuka).
  useEffect(() => {
    const sync = () => {
      setS(getSfxSettings());
      setPadUnlocked(isGmUnlocked());
      setLoadState(getSfxLoadState());
      setSave(getSfxSaveState());
    };
    sync();
    return subscribeSfx(sync);
  }, []);

  const gmActive = s.mode === 'gm' && padUnlocked;

  // Muat bank sampel SF2 (Hugging Face) dengan cara yang SAMA seperti PadStudio:
  // audioEngine.initBank(onProgress) + status yang hilang 2 detik setelah siap.
  useEffect(() => {
    if (!padUnlocked) return;
    let hideTimer: number | undefined;
    audioEngine.initBank((msg: string) => {
      setEngineStatus(msg);
      if (msg === SOUND_BANK_READY_MESSAGE) {
        setBankReady(true);
        hideTimer = window.setTimeout(() => setEngineStatus(''), 2000);
      }
    });
    // initBank langsung return kalau bank sedang dimuat oleh pemanggil lain
    // (mis. preload di App) -> cek berkala sampai siap.
    const poll = window.setInterval(() => {
      if (audioEngine.isLoaded) {
        setBankReady(true);
        window.clearInterval(poll);
      }
    }, 500);
    return () => {
      if (hideTimer) clearTimeout(hideTimer);
      window.clearInterval(poll);
    };
  }, [padUnlocked]);

  const update = (patch: Partial<SfxSettings>) => updateSfx({ ...s, ...patch });

  const previewBuiltin = (id: BuiltinSfxId) => audioEngine.playClickEffect({ kind: 'builtin', id });
  const previewGm = (slot: GmSlot) =>
    audioEngine.playClickEffect({ kind: 'gm', program: slot.program, note: resolveSlotNote(slot) });

  const setBuiltin = (section: SfxSection, id: BuiltinSfxId | 'off') => {
    update({ builtin: { ...s.builtin, [section]: id } });
    if (id !== 'off') previewBuiltin(id);
  };

  const setSlot = (section: SfxSection | 'shared', patch: Partial<GmSlot>, preview = false) => {
    const base = section === 'shared' ? s.gmShared : s.gm[section];
    const slot = { ...base, ...patch };
    updateSfx(section === 'shared' ? { ...s, gmShared: slot } : { ...s, gm: { ...s.gm, [section]: slot } });
    if (preview) previewGm({ ...slot, randomPitch: false });
  };

  const randomizeAll = () => {
    const next: SfxSettings = { ...s };
    if (s.gmLinked) next.gmShared = { ...s.gmShared, ...randomSlotValues() };
    else
      next.gm = {
        audio: { ...s.gm.audio, ...randomSlotValues() },
        quiz: { ...s.gm.quiz, ...randomSlotValues() },
        other: { ...s.gm.other, ...randomSlotValues() },
      };
    updateSfx(next);
    previewGm(s.gmLinked ? next.gmShared : next.gm.audio);
  };

  const pill = (active: boolean) =>
    `px-3 py-1.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center gap-1.5 ${
      active ? 'bg-accent/20 border-accent text-accent' : 'bg-black/40 border-white/10 text-gray-300 hover:border-white/30 hover:text-white'
    }`;

  const selectCls =
    'w-full bg-black/60 border border-white/15 focus:border-accent rounded-lg px-2.5 py-1.5 text-xs text-white outline-none';

  // Fungsi render biasa (BUKAN komponen anonim) supaya <select> tidak di-remount
  // dan kehilangan fokus setiap kali state berubah.
  const renderSlot = (title: string, hint: string | undefined, section: SfxSection | 'shared') => {
    const slot = section === 'shared' ? s.gmShared : s.gm[section];
    return (
      <div className="p-3.5 rounded-2xl bg-black/40 border border-white/10 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h5 className="text-xs font-black text-white">{title}</h5>
            {hint && <p className="text-[10px] text-gray-400">{hint}</p>}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => { const r = randomSlotValues(); setSlot(section, r, true); }}
              className="px-2.5 py-1.5 rounded-lg bg-white/10 hover:bg-accent text-white hover:text-on-accent text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Acak instrumen dan nada"
            >
              <Shuffle className="w-3.5 h-3.5" /> Acak
            </button>
            <button
              type="button"
              disabled={!bankReady}
              onClick={() => previewGm(slot)}
              className="px-2.5 py-1.5 rounded-lg bg-accent/20 hover:bg-accent text-accent hover:text-on-accent text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play className="w-3.5 h-3.5" /> Coba
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-2">
          <label className="space-y-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            Instrumen (128 nada GM)
            <select
              value={slot.program}
              onChange={(e) => setSlot(section, { program: Number(e.target.value) }, true)}
              className={selectCls}
            >
              {INSTRUMENT_CATEGORIES.map((cat) => (
                <optgroup key={cat} label={`── ${cat} ──`} className="bg-surface text-gray-300 font-bold">
                  {INSTRUMENTS_128.filter((i) => i.category === cat).map((inst) => (
                    <option key={inst.id} value={inst.id} className="text-white font-normal bg-black">
                      #{inst.id + 1} {inst.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-[10px] font-bold text-gray-400 uppercase tracking-wider">
            Nada
            <select value={slot.note} onChange={(e) => setSlot(section, { note: Number(e.target.value) }, true)} className={selectCls}>
              {NOTE_OPTIONS.map((n) => (
                <option key={n} value={n} className="text-white bg-black">
                  {noteName(n)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={slot.randomPitch}
            onChange={(e) => setSlot(section, { randomPitch: e.target.checked })}
            className="accent-(--t-accent) w-3.5 h-3.5"
          />
          Nada acak tiap klik <span className="text-gray-500">(nada di atas jadi nada dasar)</span>
        </label>
      </div>
    );
  };

  // ── Tamu: pengaturan disimpan di database akun, jadi wajib masuk ──
  if (!isLoggedIn) {
    return (
      <div className="p-4 rounded-2xl bg-black/30 border border-dashed border-white/15 text-center space-y-1">
        <VolumeX className="w-5 h-5 text-gray-400 mx-auto" />
        <p className="text-xs text-gray-300">Masuk ke akunmu untuk mengatur efek suara klik. Pengaturannya tersimpan di akun.</p>
      </div>
    );
  }

  if (loadState === 'failed') {
    return (
      <div className="p-4 rounded-2xl bg-red-900/20 border border-red-900 text-center space-y-2">
        <p className="text-xs text-red-200">Pengaturan efek suara gagal dimuat dari server.</p>
        <button type="button" onClick={() => void retrySfxLoad()} className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-accent text-white hover:text-on-accent text-xs font-bold cursor-pointer transition-colors">
          Coba lagi
        </button>
      </div>
    );
  }

  if (loadState !== 'ready') {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-xs text-gray-400">
        <Loader2 className="w-4 h-4 animate-spin text-accent" /> Memuat pengaturan efek suara…
      </div>
    );
  }

  const silentNow = !gmActive && SFX_SECTIONS.every((sec) => s.builtin[sec] === 'off');

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      <div className="p-4 rounded-2xl bg-gradient-to-r from-accent/15 via-accent2/10 to-transparent border border-accent/30 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-black text-white flex items-center gap-2">
            {silentNow ? <VolumeX className="w-4 h-4 text-accent" /> : <Volume2 className="w-4 h-4 text-accent" />} Efek Suara Klik
          </h4>
          <span className="text-[10px] font-mono flex items-center gap-1 text-gray-400">
            {save.state === 'saving' && (<><Loader2 className="w-3 h-3 animate-spin" /> Menyimpan…</>)}
            {save.state === 'saved' && (<><Check className="w-3 h-3 text-emerald-400" /> Tersimpan</>)}
            {save.state === 'error' && (<span className="text-red-300 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {save.error || 'Gagal menyimpan'}</span>)}
          </span>
        </div>
        <p className="text-xs text-gray-300 leading-relaxed">
          Secara bawaan klik di website ini <b className="text-white">hening</b>. Aktifkan efek suara untuk tiap bagian di bawah.
        </p>
      </div>

      {/* PILIH MODE */}
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={s.mode === 'builtin'} onClick={() => update({ mode: 'builtin' })} className={pill(!gmActive)}>
          <Volume2 className="w-3.5 h-3.5" /> Efek Bawaan
        </button>
        <button
          type="button"
          aria-pressed={gmActive}
          onClick={() => (padUnlocked ? update({ mode: 'gm' }) : onGetPadEditor?.())}
          className={pill(gmActive)}
        >
          {!padUnlocked && <Lock className="w-3.5 h-3.5" />} Nada GM (128 instrumen)
        </button>
        {engineStatus && padUnlocked && (
          <span className="self-center text-[10px] text-accent font-mono bg-accent/10 px-2 py-0.5 rounded border border-accent/20">
            {engineStatus}
          </span>
        )}
      </div>

      {!padUnlocked && (
        <div className="p-3.5 rounded-2xl bg-black/30 border border-dashed border-white/15 text-xs text-gray-300 leading-relaxed space-y-2">
          <p>
            <b className="text-white">Mode Nada GM terkunci.</b> Buka dengan memiliki <b className="text-white">Full 16-Bar Editor</b>: tiap
            bagian bisa memakai satu nada dari salah satu 128 instrumen GM, diacak atau diatur sendiri.
          </p>
          {onGetPadEditor && (
            <button
              type="button"
              onClick={onGetPadEditor}
              className="px-3 py-1.5 rounded-lg bg-accent/20 hover:bg-accent text-accent hover:text-on-accent font-bold cursor-pointer transition-colors"
            >
              Lihat Full 16-Bar Editor →
            </button>
          )}
        </div>
      )}

      {/* MODE BAWAAN */}
      {!gmActive && (
        <div className="space-y-3">
          {SFX_SECTIONS.map((section) => (
            <div key={section} className="p-3.5 rounded-2xl bg-black/40 border border-white/10 space-y-2.5">
              <div>
                <h5 className="text-xs font-black text-white">{SFX_SECTION_LABEL[section]}</h5>
                <p className="text-[10px] text-gray-400">{sectionHint[section]}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" aria-pressed={s.builtin[section] === 'off'} onClick={() => setBuiltin(section, 'off')} className={pill(s.builtin[section] === 'off')}>
                  <VolumeX className="w-3.5 h-3.5" /> Hening
                </button>
                {BUILTIN_SFX[section].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={s.builtin[section] === opt.id}
                    onClick={() => setBuiltin(section, opt.id)}
                    title={opt.desc}
                    className={pill(s.builtin[section] === opt.id)}
                  >
                    <Play className="w-3 h-3" /> {opt.label}
                  </button>
                ))}
              </div>
              {s.builtin[section] !== 'off' && (
                <p className="text-[10px] text-gray-500">{BUILTIN_SFX[section].find((o) => o.id === s.builtin[section])?.desc}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MODE GM */}
      {gmActive && (
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 p-3.5 rounded-2xl bg-black/40 border border-white/10 cursor-pointer select-none">
            <div>
              <h5 className="text-xs font-black text-white">Samakan untuk semua bagian</h5>
              <p className="text-[10px] text-gray-400">
                {s.gmLinked ? 'Satu efek dipakai di Audio, Kuis, dan Lainnya.' : 'Tiap bagian punya efeknya sendiri (satu slot per bagian).'}
              </p>
            </div>
            <input type="checkbox" checked={s.gmLinked} onChange={(e) => update({ gmLinked: e.target.checked })} className="accent-(--t-accent) w-4 h-4 shrink-0" />
          </label>

          {s.gmLinked
            ? renderSlot('Semua bagian', 'Audio Studio, Pusat Kuis, dan bagian lainnya', 'shared')
            : SFX_SECTIONS.map((section) => (
                <React.Fragment key={section}>{renderSlot(SFX_SECTION_LABEL[section], sectionHint[section], section)}</React.Fragment>
              ))}

          <button
            type="button"
            onClick={randomizeAll}
            className="w-full px-3 py-2 rounded-xl bg-white/10 hover:bg-accent text-white hover:text-on-accent text-xs font-bold flex items-center justify-center gap-2 cursor-pointer transition-colors"
          >
            <Shuffle className="w-3.5 h-3.5" /> Acak {s.gmLinked ? 'efek' : 'semua efek'}
          </button>

          <SoundBankCredits />
        </div>
      )}
    </div>
  );
};
