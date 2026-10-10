// src/components/AudioStudio/PadEffectsModal.tsx
// Popup "Efek" Pad Studio: Equalizer, Reverb, Delay, Chorus, Filter, Distortion, Limiter.
//
// - Target efek: SEMUA drum / SEMUA instrumen akor, atau SATU bagian drum / SATU instrumen akor.
//   (sinyal: bagian -> semua -> master, jadi efek per-bagian dan efek "semua" bisa dipakai bersamaan)
// - Setiap parameter: slider + kolom angka (bisa diketik manual) + tombol − / + (tahan untuk mengulang).
// - Perubahan langsung terdengar (state naik ke PadStudio -> audioEngine.setPadEffects) dan ikut tersimpan di proyek
//   serta dirender saat ekspor audio.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Play, Square, Volume2, RotateCcw, Copy, ChevronDown, ChevronUp, Minus, Plus, PowerOff } from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import {
  FX_DEFS,
  FX_PRESETS,
  FX_UI_ORDER,
  FX_TARGET_ALL,
  EMPTY_CHAIN,
  activeFxCount,
  clampParam,
  cloneChain,
  emptyChain,
  emptyFx,
  getChain,
  isChainActive,
  isPresetActive,
  setChain,
  setUnit,
  totalActiveFx,
  unitFromPreset,
  type FxChain,
  type FxDomain,
  type FxId,
  type FxParamDef,
  type FxPreset,
  type PadFxState,
} from '../../services/padFxModel';

interface PadEffectsModalProps {
  onClose: () => void;
  fx: PadFxState;
  onChange: (next: PadFxState) => void;
  initialDomain: FxDomain;
  drumParts: Array<{ id: string; label: string }>;
  chordTracks: Array<{ id: number; label: string }>;
  isPlaying: boolean;
  onTogglePlay: () => void;
  // Bunyikan contoh suara target yang sedang dipilih (satu pukulan drum / satu akor).
  onAudition: (domain: FxDomain, target: string) => void;
}

// ---------------------------------------------------------------------------
// Tahan tombol = ulangi (seperti tombol +/- pada perangkat audio)
// ---------------------------------------------------------------------------
const useHoldRepeat = (fn: () => void) => {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const delayTimer = useRef<number | undefined>(undefined);
  const repeatTimer = useRef<number | undefined>(undefined);
  const stop = useCallback(() => {
    window.clearTimeout(delayTimer.current);
    window.clearInterval(repeatTimer.current);
    delayTimer.current = undefined;
    repeatTimer.current = undefined;
  }, []);
  useEffect(() => stop, [stop]);
  return {
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      stop();
      fnRef.current();
      delayTimer.current = window.setTimeout(() => {
        repeatTimer.current = window.setInterval(() => fnRef.current(), 70);
      }, 380);
    },
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
    // Klik dari keyboard (Enter / Spasi) tidak melewati pointer event; detail === 0 menandai klik keyboard.
    onClick: (e: React.MouseEvent) => {
      if (e.detail === 0) fnRef.current();
    },
  };
};

const StepButton: React.FC<{ dir: -1 | 1; onStep: (dir: -1 | 1) => void; label: string }> = ({ dir, onStep, label }) => {
  const handlers = useHoldRepeat(() => onStep(dir));
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (tahan untuk mengulang)`}
      {...handlers}
      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 active:bg-accent/30 border border-white/10 text-gray-200 cursor-pointer touch-none select-none"
    >
      {dir < 0 ? <Minus className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
    </button>
  );
};

// ---------------------------------------------------------------------------
// Kolom angka yang bisa diketik manual. Nilai dipakai saat Enter / blur, dijepit ke rentang sah.
// ---------------------------------------------------------------------------
const NumberBox: React.FC<{ def: FxParamDef; value: number; onCommit: (v: number) => void; ariaLabel: string }> = ({
  def,
  value,
  onCommit,
  ariaLabel,
}) => {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = value.toFixed(def.decimals);

  const commit = () => {
    if (draft !== null) {
      const n = parseFloat(draft.replace(',', '.'));
      if (Number.isFinite(n)) onCommit(clampParam(def, n));
    }
    setDraft(null);
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={ariaLabel}
      value={draft ?? shown}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d.,-]/g, '').slice(0, 8))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        else if (e.key === 'Escape' && draft !== null) {
          e.stopPropagation(); // batalkan ketikan saja, jangan sekalian menutup popup
          setDraft(null);
        }
      }}
      className="w-[4.5rem] bg-black/80 rounded-md border border-white/15 px-1.5 py-1 text-xs font-mono text-accent text-right outline-none focus:border-accent"
    />
  );
};

const logPos = (d: FxParamDef, v: number) => Math.round((1000 * Math.log(Math.max(d.min, v) / d.min)) / Math.log(d.max / d.min));
const logVal = (d: FxParamDef, pos: number) => d.min * Math.pow(d.max / d.min, pos / 1000);

const ParamRow: React.FC<{
  def: FxParamDef;
  value: number;
  onChange: (v: number) => void;
  onReset: () => void;
  idPrefix: string;
}> = ({ def, value, onChange, onReset, idPrefix }) => {
  // Pilihan (mis. jenis filter): deretan tombol.
  if (def.options) {
    return (
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold text-gray-400">{def.label}</span>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {def.options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={value === o.value}
              onClick={() => onChange(o.value)}
              className={`py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors ${
                value === o.value ? 'bg-accent text-on-accent border-accent' : 'bg-black/40 text-gray-300 border-white/10 hover:border-white/25'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const step = (dir: -1 | 1) => {
    // Skala log (frekuensi): tiap klik = 1 semitone (rasio 2^(1/12)); skala linear: sebesar `step`.
    const next = def.log ? value * Math.pow(2, dir / 12) : value + dir * def.step;
    let q = clampParam(def, next);
    // Pastikan log tetap bergerak walau pembulatan menghasilkan nilai sama.
    if (def.log && q === value) q = clampParam(def, value + dir * Math.max(1, def.step));
    onChange(q);
  };

  const isDef = Math.abs(value - def.def) < 1e-9;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-bold text-gray-400 min-w-0 truncate" title={def.hint}>
          {def.label}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <StepButton dir={-1} onStep={step} label={`Kurangi ${def.label}`} />
          <NumberBox def={def} value={value} onCommit={onChange} ariaLabel={`${def.label}${def.unit ? ` dalam ${def.unit}` : ''}`} />
          <span className="font-mono text-[11px] text-gray-500 w-7 shrink-0">{def.unit}</span>
          <StepButton dir={1} onStep={step} label={`Tambah ${def.label}`} />
          <button
            type="button"
            onClick={onReset}
            disabled={isDef}
            title={`Kembalikan ke bawaan (${def.def.toFixed(def.decimals)} ${def.unit})`}
            aria-label={`Kembalikan ${def.label} ke bawaan`}
            className="w-7 h-7 shrink-0 flex items-center justify-center rounded-lg text-gray-400 hover:text-white hover:bg-white/10 disabled:opacity-25 disabled:hover:bg-transparent cursor-pointer disabled:cursor-default"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <input
        id={`${idPrefix}-${def.key}`}
        type="range"
        aria-label={def.label}
        min={def.log ? 0 : def.min}
        max={def.log ? 1000 : def.max}
        step={def.log ? 1 : def.step}
        value={def.log ? logPos(def, value) : value}
        onChange={(e) => {
          const raw = Number(e.target.value);
          onChange(clampParam(def, def.log ? logVal(def, raw) : raw));
        }}
        className="w-full h-1.5 bg-zinc-800 rounded appearance-none cursor-pointer accent-accent"
      />
    </div>
  );
};

// ---------------------------------------------------------------------------
// Deretan tombol preset (ditaruh di bawah slider terakhir tiap efek). Membungkus ke baris baru bila sempit.
// ---------------------------------------------------------------------------
const PresetRow: React.FC<{
  presets: FxPreset[];
  isActive: (p: FxPreset) => boolean;
  onPick: (p: FxPreset) => void;
}> = ({ presets, isActive, onPick }) => (
  <div className="space-y-1.5 pt-1" role="group" aria-label="Preset">
    <span className="text-[11px] font-bold text-gray-400">Preset</span>
    <div className="flex flex-wrap gap-1.5">
      {presets.map((pr) => {
        const on = isActive(pr);
        return (
          <button
            key={pr.id}
            type="button"
            aria-pressed={on}
            title={pr.desc}
            onClick={() => onPick(pr)}
            className={`max-w-full px-2.5 py-1.5 rounded-lg text-[11px] font-bold leading-tight border cursor-pointer transition-colors ${
              on ? 'bg-accent text-on-accent border-accent' : 'bg-black/40 text-gray-300 border-white/10 hover:border-white/25 hover:text-white'
            }`}
          >
            <span className="block truncate">{pr.label}</span>
          </button>
        );
      })}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Popup utama
// ---------------------------------------------------------------------------
export const PadEffectsModal: React.FC<PadEffectsModalProps> = ({
  onClose,
  fx,
  onChange,
  initialDomain,
  drumParts,
  chordTracks,
  isPlaying,
  onTogglePlay,
  onAudition,
}) => {
  const [domain, setDomain] = useState<FxDomain>(initialDomain);
  const [target, setTarget] = useState<string>(FX_TARGET_ALL);
  const [open, setOpen] = useState<Partial<Record<FxId, boolean>>>({});

  // Ganti tab: kembali ke "Semua". Bila target spesifik hilang (mis. instrumen dinonaktifkan), kembali ke "Semua".
  const targets = useMemo(
    () =>
      domain === 'drum'
        ? drumParts.map((d) => ({ key: d.id, label: d.label }))
        : chordTracks.map((t) => ({ key: String(t.id), label: t.label || `Instrumen ${t.id}` })),
    [domain, drumParts, chordTracks]
  );
  useEffect(() => {
    if (target !== FX_TARGET_ALL && !targets.some((t) => t.key === target)) setTarget(FX_TARGET_ALL);
  }, [targets, target]);

  const chain = getChain(fx, domain, target);
  const allLabel = domain === 'drum' ? 'Semua Drum' : 'Semua Instrumen';
  const targetLabel = target === FX_TARGET_ALL ? allLabel : targets.find((t) => t.key === target)?.label ?? target;
  const totalOn = totalActiveFx(fx);

  const patchParam = (id: FxId, key: string, v: number, enable: boolean) => {
    const cur = chain[id];
    const base = chain === EMPTY_CHAIN ? emptyChain()[id] : cur;
    onChange(setUnit(fx, domain, target, id, { on: enable ? true : base.on, p: { ...base.p, [key]: v } }));
  };

  const toggleFx = (id: FxId) => {
    const base = chain === EMPTY_CHAIN ? emptyChain()[id] : chain[id];
    const nextOn = !base.on;
    onChange(setUnit(fx, domain, target, id, { ...base, on: nextOn }));
    if (nextOn) setOpen((o) => ({ ...o, [id]: true }));
  };

  const applyPreset = (id: FxId, preset: FxPreset) => {
    onChange(setUnit(fx, domain, target, id, unitFromPreset(id, preset)));
  };

  const resetTarget = () => onChange(setChain(fx, domain, target, emptyChain()));

  const copyToAll = () => {
    let next = fx;
    targets.forEach((t) => {
      if (t.key !== target) next = setChain(next, domain, t.key, cloneChain(chain));
    });
    onChange(next);
  };

  const clearEverything = () => onChange(emptyFx());

  const signalPath =
    target === FX_TARGET_ALL ? `${allLabel} → Master` : `${targetLabel} → ${allLabel} → Master`;

  return (
    <ModalPortal onClose={onClose}>
      <div
        className="w-full max-w-2xl max-h-[92dvh] flex flex-col rounded-2xl bg-[#14213D] border border-white/[0.12] shadow-2xl overflow-hidden"
        role="document"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3 border-b border-white/[0.08] shrink-0">
          <div className="w-9 h-9 rounded-xl bg-accent/20 text-accent flex items-center justify-center shrink-0">
            <Volume2 className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-white leading-tight">Efek Suara</h3>
            <p className="text-[11px] text-gray-400 truncate">
              {totalOn > 0 ? `${totalOn} efek aktif` : 'Belum ada efek aktif'} · ikut tersimpan di proyek & ikut diekspor ke audio
            </p>
          </div>
          <button
            type="button"
            onClick={onTogglePlay}
            title={isPlaying ? 'Hentikan pemutaran' : 'Putar pola sambil mengatur efek'}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer transition-colors ${
              isPlaying ? 'bg-accent text-on-accent border-accent' : 'bg-white/5 text-gray-200 border-white/10 hover:bg-white/10'
            }`}
          >
            {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            <span>{isPlaying ? 'Henti' : 'Putar'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup"
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-black/50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
          {/* Tab Drum / Akor */}
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-black/50 border border-white/[0.08]" role="tablist" aria-label="Jenis suara">
            {(['drum', 'chord'] as const).map((d) => {
              const perTarget: Record<string, FxChain> = d === 'drum' ? fx.drumParts : fx.chordTracks;
              const on = isChainActive(d === 'drum' ? fx.drumAll : fx.chordAll) || Object.values(perTarget).some((c) => isChainActive(c));
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={domain === d}
                  onClick={() => {
                    setDomain(d);
                    setTarget(FX_TARGET_ALL);
                  }}
                  className={`py-2 rounded-lg text-xs font-bold cursor-pointer transition-colors flex items-center justify-center gap-1.5 ${
                    domain === d ? 'bg-accent text-on-accent' : 'text-gray-300 hover:bg-white/5'
                  }`}
                >
                  {d === 'drum' ? 'Drum Kit' : 'Instrumen Akor'}
                  {on && <span className={`w-1.5 h-1.5 rounded-full ${domain === d ? 'bg-on-accent' : 'bg-accent'}`} />}
                </button>
              );
            })}
          </div>

          {/* Pilih target */}
          <div className="space-y-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Terapkan efek ke:</span>
            <div className="flex flex-wrap gap-1.5">
              {[{ key: FX_TARGET_ALL, label: allLabel }, ...targets].map((t) => {
                const c = getChain(fx, domain, t.key);
                const n = activeFxCount(c);
                const sel = target === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={sel}
                    onClick={() => setTarget(t.key)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition-colors flex items-center gap-1.5 ${
                      sel ? 'bg-accent/20 text-accent border-accent/50' : 'bg-black/40 text-gray-300 border-white/10 hover:border-white/25'
                    }`}
                  >
                    <span className="truncate max-w-[9rem]">{t.label}</span>
                    {n > 0 && (
                      <span className="min-w-[1rem] h-4 px-1 rounded-full bg-accent text-on-accent text-[9px] font-black flex items-center justify-center">
                        {n}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-mono text-gray-500">Jalur sinyal: {signalPath}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onAudition(domain, target)}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/5 hover:bg-white/15 text-gray-200 border border-white/10 cursor-pointer flex items-center gap-1.5"
                  title="Bunyikan contoh suara target ini"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  Coba Bunyi
                </button>
                {target !== FX_TARGET_ALL && targets.length > 1 && (
                  <button
                    type="button"
                    onClick={copyToAll}
                    disabled={!isChainActive(chain)}
                    className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/5 hover:bg-white/15 text-gray-200 border border-white/10 cursor-pointer flex items-center gap-1.5 disabled:opacity-35 disabled:cursor-default"
                    title={`Salin pengaturan ${targetLabel} ke semua ${domain === 'drum' ? 'bagian drum' : 'instrumen'}`}
                  >
                    <Copy className="w-3.5 h-3.5" />
                    Salin ke Semua {domain === 'drum' ? 'Bagian' : 'Instrumen'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetTarget}
                  disabled={chain === EMPTY_CHAIN}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-white/5 hover:bg-white/15 text-gray-200 border border-white/10 cursor-pointer flex items-center gap-1.5 disabled:opacity-35 disabled:cursor-default"
                  title={`Matikan dan kembalikan semua efek ${targetLabel} ke bawaan`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </div>
            </div>
          </div>

          {/* Daftar efek */}
          <div className="space-y-2">
            {FX_UI_ORDER.map((id) => {
              const def = FX_DEFS[id];
              const unit = chain[id];
              const expanded = !!open[id];
              return (
                <div
                  key={id}
                  className={`rounded-xl border transition-colors ${
                    unit.on ? 'border-accent/40 bg-accent/[0.06]' : 'border-white/10 bg-black/30'
                  }`}
                >
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={unit.on}
                      aria-label={`${unit.on ? 'Matikan' : 'Nyalakan'} ${def.label}`}
                      onClick={() => toggleFx(id)}
                      className={`relative w-10 h-5 rounded-full shrink-0 cursor-pointer transition-colors ${unit.on ? 'bg-accent' : 'bg-zinc-700'}`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                          unit.on ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [id]: !o[id] }))}
                      aria-expanded={expanded}
                      className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                    >
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm font-bold ${unit.on ? 'text-white' : 'text-gray-300'}`}>{def.label}</span>
                        <span className="block text-[11px] text-gray-500 truncate">{def.desc}</span>
                      </span>
                      {expanded ? <ChevronUp className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />}
                    </button>
                  </div>
                  {expanded && (
                    <div className={`px-3 pb-3 pt-1 space-y-3 border-t border-white/[0.06] ${unit.on ? '' : 'opacity-60'}`}>
                      {!unit.on && (
                        <p className="text-[11px] text-gray-400 pt-2">Efek mati. Mengubah nilai atau memilih preset di bawah akan menyalakannya otomatis.</p>
                      )}
                      <div className="space-y-3 pt-1">
                        {def.params.map((pd) => (
                          <ParamRow
                            key={pd.key}
                            idPrefix={`fx-${domain}-${target}-${id}`}
                            def={pd}
                            value={unit.p[pd.key] ?? pd.def}
                            onChange={(v) => patchParam(id, pd.key, v, true)}
                            onReset={() => patchParam(id, pd.key, pd.def, false)}
                          />
                        ))}
                        <PresetRow
                          presets={FX_PRESETS[id]}
                          isActive={(pr) => isPresetActive(id, unit, pr)}
                          onPick={(pr) => applyPreset(id, pr)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-[10.5px] text-gray-500 leading-snug max-w-md">
              Urutan sinyal di setiap rantai: Filter → Equalizer → Distortion → Chorus → Delay → Reverb → Limiter. Efek per-bagian
              diteruskan ke efek "Semua", lalu ke master.
            </p>
            <button
              type="button"
              onClick={clearEverything}
              disabled={totalOn === 0}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 cursor-pointer flex items-center gap-1.5 disabled:opacity-35 disabled:cursor-default"
            >
              <PowerOff className="w-3.5 h-3.5" />
              Matikan Semua Efek
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};
