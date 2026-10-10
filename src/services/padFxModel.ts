// src/services/padFxModel.ts
// MODEL EFEK PAD STUDIO — murni (tanpa Web Audio / DOM), jadi aman diimpor oleh SERVER
// (midiProject.normalizeProject) maupun UI (PadEffectsModal) dan engine audio.
//
// Konsep:
//   - 7 efek: Equalizer, Reverb, Delay, Chorus, Filter, Distortion, Limiter.
//   - Satu "rantai efek" (FxChain) = ketujuh efek itu, masing-masing punya saklar on/off + parameter.
//   - Rantai dipasang pada beberapa tingkat:
//       Drum : [tiap bagian drum] -> [Semua Drum]  -> master
//       Akor : [tiap instrumen]   -> [Semua Instrumen] -> master
//     Jadi efek bisa diterapkan ke SATU bagian / SATU instrumen, atau ke SEMUANYA sekaligus.
//   - Urutan sinyal di dalam rantai tetap (FX_SIGNAL_ORDER), tidak bergantung urutan tampil di UI.

export type FxId = 'eq' | 'reverb' | 'delay' | 'chorus' | 'filter' | 'distortion' | 'limiter';

// Urutan tampil di UI (sesuai permintaan: equalizer, reverb, delay, chorus, filter, distortion, limiter).
export const FX_UI_ORDER: FxId[] = ['eq', 'reverb', 'delay', 'chorus', 'filter', 'distortion', 'limiter'];

// Urutan sinyal sebenarnya: filter -> eq -> distortion -> chorus -> delay -> reverb -> limiter.
export const FX_SIGNAL_ORDER: FxId[] = ['filter', 'eq', 'distortion', 'chorus', 'delay', 'reverb', 'limiter'];

export interface FxParamDef {
  key: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  def: number;
  decimals: number;
  // Skala logaritmik (untuk frekuensi): slider & tombol +/- bergerak per rasio, bukan per selisih.
  log?: boolean;
  // Parameter pilihan (mis. jenis filter): ditampilkan sebagai tombol pilihan, bukan slider.
  options?: Array<{ value: number; label: string }>;
  hint?: string;
}

export interface FxDef {
  id: FxId;
  label: string;
  desc: string;
  params: FxParamDef[];
}

export const FX_DEFS: Record<FxId, FxDef> = {
  eq: {
    id: 'eq',
    label: 'Equalizer',
    desc: 'Atur bass, mid, dan treble (4 pita).',
    params: [
      { key: 'low', label: 'Bass (100 Hz)', unit: 'dB', min: -12, max: 12, step: 0.5, def: 0, decimals: 1 },
      { key: 'lowMid', label: 'Low-Mid (500 Hz)', unit: 'dB', min: -12, max: 12, step: 0.5, def: 0, decimals: 1 },
      { key: 'highMid', label: 'High-Mid (2,5 kHz)', unit: 'dB', min: -12, max: 12, step: 0.5, def: 0, decimals: 1 },
      { key: 'high', label: 'Treble (8 kHz)', unit: 'dB', min: -12, max: 12, step: 0.5, def: 0, decimals: 1 },
    ],
  },
  reverb: {
    id: 'reverb',
    label: 'Reverb',
    desc: 'Gema ruangan. Makin besar ukuran, makin panjang ekornya.',
    params: [
      { key: 'size', label: 'Ukuran (Decay)', unit: 'dtk', min: 0.2, max: 8, step: 0.1, def: 2, decimals: 1 },
      { key: 'pre', label: 'Pre-Delay', unit: 'ms', min: 0, max: 200, step: 1, def: 20, decimals: 0 },
      { key: 'damp', label: 'Redaman Treble', unit: 'Hz', min: 1000, max: 16000, step: 100, def: 6000, decimals: 0, log: true, hint: 'Makin rendah = ruangan makin "gelap" / empuk.' },
      { key: 'mix', label: 'Campuran (Mix)', unit: '%', min: 0, max: 100, step: 1, def: 30, decimals: 0 },
    ],
  },
  delay: {
    id: 'delay',
    label: 'Delay',
    desc: 'Gema berulang (echo).',
    params: [
      { key: 'time', label: 'Waktu', unit: 'ms', min: 10, max: 1500, step: 5, def: 320, decimals: 0 },
      { key: 'fb', label: 'Feedback (Pengulangan)', unit: '%', min: 0, max: 90, step: 1, def: 35, decimals: 0 },
      { key: 'tone', label: 'Nada Gema', unit: 'Hz', min: 500, max: 16000, step: 100, def: 5000, decimals: 0, log: true, hint: 'Makin rendah = gema makin redup.' },
      { key: 'mix', label: 'Campuran (Mix)', unit: '%', min: 0, max: 100, step: 1, def: 30, decimals: 0 },
    ],
  },
  chorus: {
    id: 'chorus',
    label: 'Chorus',
    desc: 'Menebalkan suara dengan modulasi pitch halus.',
    params: [
      { key: 'rate', label: 'Kecepatan (Rate)', unit: 'Hz', min: 0.05, max: 10, step: 0.05, def: 1.2, decimals: 2 },
      { key: 'depth', label: 'Kedalaman (Depth)', unit: '%', min: 0, max: 100, step: 1, def: 50, decimals: 0 },
      { key: 'mix', label: 'Campuran (Mix)', unit: '%', min: 0, max: 100, step: 1, def: 50, decimals: 0 },
    ],
  },
  filter: {
    id: 'filter',
    label: 'Filter',
    desc: 'Memotong frekuensi (low-pass, high-pass, band-pass, notch).',
    params: [
      {
        key: 'type',
        label: 'Jenis',
        unit: '',
        min: 0,
        max: 3,
        step: 1,
        def: 0,
        decimals: 0,
        options: [
          { value: 0, label: 'Low-pass' },
          { value: 1, label: 'High-pass' },
          { value: 2, label: 'Band-pass' },
          { value: 3, label: 'Notch' },
        ],
      },
      { key: 'cutoff', label: 'Cutoff', unit: 'Hz', min: 20, max: 20000, step: 10, def: 2000, decimals: 0, log: true },
      { key: 'q', label: 'Resonansi (Q)', unit: '', min: 0.1, max: 20, step: 0.1, def: 0.7, decimals: 1 },
    ],
  },
  distortion: {
    id: 'distortion',
    label: 'Distortion',
    desc: 'Menambah gigitan / kekasaran suara.',
    params: [
      { key: 'drive', label: 'Drive', unit: '%', min: 0, max: 100, step: 1, def: 40, decimals: 0 },
      { key: 'tone', label: 'Nada', unit: 'Hz', min: 500, max: 16000, step: 100, def: 8000, decimals: 0, log: true, hint: 'Makin rendah = distorsi makin halus.' },
      { key: 'level', label: 'Level Keluaran', unit: 'dB', min: -24, max: 6, step: 0.5, def: -3, decimals: 1 },
      { key: 'mix', label: 'Campuran (Mix)', unit: '%', min: 0, max: 100, step: 1, def: 100, decimals: 0 },
    ],
  },
  limiter: {
    id: 'limiter',
    label: 'Limiter',
    desc: 'Menahan puncak volume supaya tidak pecah.',
    params: [
      { key: 'thr', label: 'Ambang (Threshold)', unit: 'dB', min: -30, max: 0, step: 0.5, def: -6, decimals: 1 },
      { key: 'rel', label: 'Release', unit: 'ms', min: 10, max: 1000, step: 5, def: 100, decimals: 0 },
      { key: 'gain', label: 'Penguatan (Makeup)', unit: 'dB', min: -12, max: 12, step: 0.5, def: 0, decimals: 1 },
    ],
  },
};

// ---------------------------------------------------------------------------
// PRESET BAWAAN
// Setiap efek punya beberapa preset siap pakai (nilai SEMUA parameter diisi lengkap). Memilih preset menyalakan efek
// dan mengisi parameternya; pengguna tetap bebas menggeser slider sesudahnya.
// ---------------------------------------------------------------------------
export interface FxPreset {
  id: string;
  label: string; // singkat, tampil di tombol
  desc: string; // tooltip
  p: Record<string, number>;
}

export const FX_PRESETS: Record<FxId, FxPreset[]> = {
  eq: [
    { id: 'bass-boost', label: 'Bass Boost', desc: 'Bass tebal dan berisi.', p: { low: 7, lowMid: 2, highMid: 0, high: -1 } },
    { id: 'hangat', label: 'Hangat', desc: 'Suara empuk, treble dilembutkan.', p: { low: 3, lowMid: 2, highMid: -1, high: -2 } },
    { id: 'jernih', label: 'Jernih', desc: 'Bass dirampingkan, bagian atas lebih jelas.', p: { low: -2, lowMid: -1, highMid: 3, high: 4 } },
    { id: 'cerah', label: 'Cerah', desc: 'Treble menonjol, terdengar berkilau.', p: { low: -1, lowMid: 0, highMid: 3, high: 6 } },
    { id: 'smiley', label: 'Smiley (V)', desc: 'Bass dan treble naik, mid dipangkas.', p: { low: 5, lowMid: -4, highMid: -2, high: 5 } },
    { id: 'bersih', label: 'Bersihkan Mid', desc: 'Mengurangi suara "kotak" / berlumpur.', p: { low: -3, lowMid: -5, highMid: 1, high: 2 } },
    { id: 'telepon', label: 'Telepon', desc: 'Bass dan treble dibuang, hanya mid.', p: { low: -12, lowMid: 5, highMid: 6, high: -10 } },
  ],
  reverb: [
    { id: 'kamar', label: 'Ruang Kecil', desc: 'Pantulan pendek, terasa dekat.', p: { size: 0.6, pre: 5, damp: 7000, mix: 18 } },
    { id: 'studio', label: 'Studio', desc: 'Ruang rekaman yang natural.', p: { size: 1.2, pre: 10, damp: 8000, mix: 22 } },
    { id: 'plate', label: 'Plate', desc: 'Reverb plat klasik, terang dan halus.', p: { size: 1.8, pre: 0, damp: 10000, mix: 28 } },
    { id: 'hall', label: 'Hall Konser', desc: 'Gedung konser yang lapang.', p: { size: 2.8, pre: 25, damp: 6000, mix: 30 } },
    { id: 'katedral', label: 'Katedral', desc: 'Ruang sangat besar, ekor panjang.', p: { size: 6, pre: 45, damp: 5000, mix: 40 } },
    { id: 'melayang', label: 'Melayang', desc: 'Ambient gelap yang panjang dan tebal.', p: { size: 7, pre: 60, damp: 3000, mix: 55 } },
  ],
  delay: [
    { id: 'slapback', label: 'Slapback', desc: 'Gema sangat cepat, satu kali pantul.', p: { time: 90, fb: 12, tone: 7000, mix: 22 } },
    { id: 'pendek', label: 'Echo Pendek', desc: 'Gema ringan yang rapat.', p: { time: 250, fb: 35, tone: 5000, mix: 28 } },
    { id: 'panjang', label: 'Echo Panjang', desc: 'Gema lebar dan jelas.', p: { time: 500, fb: 45, tone: 4500, mix: 30 } },
    { id: 'tape', label: 'Tape Echo', desc: 'Gema hangat ala pita analog.', p: { time: 380, fb: 50, tone: 2800, mix: 32 } },
    { id: 'ambient', label: 'Ambient', desc: 'Gema panjang yang meluas.', p: { time: 750, fb: 60, tone: 3500, mix: 40 } },
    { id: 'dub', label: 'Dub', desc: 'Pengulangan banyak dan redup.', p: { time: 600, fb: 70, tone: 2000, mix: 38 } },
  ],
  chorus: [
    { id: 'halus', label: 'Halus', desc: 'Penebalan tipis, nyaris tak terasa.', p: { rate: 0.6, depth: 25, mix: 30 } },
    { id: 'klasik', label: 'Klasik', desc: 'Chorus standar yang seimbang.', p: { rate: 1.2, depth: 50, mix: 50 } },
    { id: 'ensemble', label: 'Ensemble', desc: 'Terdengar seperti beberapa pemain sekaligus.', p: { rate: 0.4, depth: 60, mix: 60 } },
    { id: 'lebar', label: 'Lebar', desc: 'Suara tebal dan lebar.', p: { rate: 0.8, depth: 75, mix: 55 } },
    { id: 'dreamy', label: 'Dreamy', desc: 'Goyangan lambat yang mengambang.', p: { rate: 0.25, depth: 85, mix: 65 } },
    { id: 'vibrato', label: 'Vibrato', desc: 'Pitch bergetar cepat.', p: { rate: 5.5, depth: 35, mix: 100 } },
  ],
  filter: [
    { id: 'teredam', label: 'Teredam', desc: 'Treble dipotong, suara empuk.', p: { type: 0, cutoff: 1800, q: 0.7 } },
    { id: 'bawah-air', label: 'Bawah Air', desc: 'Seperti terdengar dari dalam air.', p: { type: 0, cutoff: 500, q: 2 } },
    { id: 'sapuan', label: 'Resonan', desc: 'Low-pass dengan resonansi menonjol.', p: { type: 0, cutoff: 900, q: 8 } },
    { id: 'tipis', label: 'Tipis', desc: 'Bass dibuang, suara ramping.', p: { type: 1, cutoff: 300, q: 0.7 } },
    { id: 'radio', label: 'Radio', desc: 'Hanya frekuensi tengah, ala radio lawas.', p: { type: 2, cutoff: 1800, q: 1.5 } },
    { id: 'telepon', label: 'Telepon', desc: 'Band-pass sempit seperti suara telepon.', p: { type: 2, cutoff: 1200, q: 3 } },
    { id: 'hisap-mid', label: 'Hisap Mid', desc: 'Memotong area tengah yang sempit.', p: { type: 3, cutoff: 1000, q: 2 } },
  ],
  distortion: [
    { id: 'saturasi', label: 'Saturasi Tipis', desc: 'Menambah kehangatan tanpa terdengar pecah.', p: { drive: 15, tone: 9000, level: -1, mix: 40 } },
    { id: 'overdrive', label: 'Overdrive', desc: 'Gigitan ringan yang hangat.', p: { drive: 25, tone: 7000, level: -2, mix: 60 } },
    { id: 'lofi', label: 'Lo-Fi', desc: 'Kasar dan kusam ala kaset.', p: { drive: 35, tone: 2500, level: -3, mix: 70 } },
    { id: 'crunch', label: 'Crunch', desc: 'Garang tapi tetap jelas.', p: { drive: 50, tone: 6000, level: -4, mix: 80 } },
    { id: 'berat', label: 'Distorsi Berat', desc: 'Agresif dan tebal.', p: { drive: 80, tone: 5000, level: -6, mix: 100 } },
    { id: 'fuzz', label: 'Fuzz', desc: 'Pecah total, sangat kasar.', p: { drive: 95, tone: 3500, level: -8, mix: 100 } },
  ],
  limiter: [
    { id: 'pengaman', label: 'Pengaman', desc: 'Hanya menahan puncak agar tidak pecah.', p: { thr: -1.5, rel: 100, gain: 0 } },
    { id: 'alami', label: 'Alami', desc: 'Pengendalian lembut, dinamika terjaga.', p: { thr: -5, rel: 250, gain: 1 } },
    { id: 'keras', label: 'Keras', desc: 'Volume lebih tebal dan kencang.', p: { thr: -8, rel: 80, gain: 4 } },
    { id: 'punchy', label: 'Punchy', desc: 'Respons cepat, pukulan terasa menghentak.', p: { thr: -10, rel: 30, gain: 5 } },
    { id: 'super', label: 'Super Keras', desc: 'Sangat dipadatkan, volume maksimal.', p: { thr: -14, rel: 50, gain: 7 } },
  ],
};

/** Unit efek siap pakai dari sebuah preset: menyala, semua parameter terisi dan dijepit ke rentang sah. */
export const unitFromPreset = (id: FxId, preset: FxPreset): FxUnit => {
  const p: Record<string, number> = {};
  FX_DEFS[id].params.forEach((d) => (p[d.key] = clampParam(d, preset.p[d.key] ?? d.def)));
  return { on: true, p };
};

/** Apakah nilai parameter sekarang sama persis dengan preset ini (untuk menandai preset yang sedang dipakai). */
export const isPresetActive = (id: FxId, unit: FxUnit | undefined, preset: FxPreset): boolean =>
  !!unit && unit.on && FX_DEFS[id].params.every((d) => Math.abs((unit.p[d.key] ?? d.def) - clampParam(d, preset.p[d.key] ?? d.def)) < 1e-9);

// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
export interface FxUnit {
  on: boolean;
  p: Record<string, number>;
}
export type FxChain = Record<FxId, FxUnit>;

export interface PadFxState {
  drumAll: FxChain; // semua bagian drum
  drumParts: Record<string, FxChain>; // kunci = id drum (kick, snare, ...)
  chordAll: FxChain; // semua instrumen akor
  chordTracks: Record<string, FxChain>; // kunci = id instrumen akor (1..4) dalam bentuk teks
}

export type FxDomain = 'drum' | 'chord';
export const FX_TARGET_ALL = 'all';

export const clampParam = (def: FxParamDef, v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return def.def;
  const c = Math.max(def.min, Math.min(def.max, n));
  if (def.options) {
    // Pilihan: bulatkan ke nilai opsi terdekat.
    let best = def.options[0].value;
    for (const o of def.options) if (Math.abs(o.value - c) < Math.abs(best - c)) best = o.value;
    return best;
  }
  const f = Math.pow(10, def.decimals + 1);
  return Math.round(c * f) / f;
};

export const defaultUnit = (id: FxId): FxUnit => {
  const p: Record<string, number> = {};
  FX_DEFS[id].params.forEach((d) => (p[d.key] = d.def));
  return { on: false, p };
};

export const emptyChain = (): FxChain => {
  const c = {} as FxChain;
  FX_UI_ORDER.forEach((id) => (c[id] = defaultUnit(id)));
  return c;
};

// Rantai kosong bersama (identitas objek tetap) — dipakai sebagai nilai "tidak ada pengaturan".
export const EMPTY_CHAIN: FxChain = Object.freeze(emptyChain()) as FxChain;

export const emptyFx = (): PadFxState => ({
  drumAll: emptyChain(),
  drumParts: {},
  chordAll: emptyChain(),
  chordTracks: {},
});

export const isChainActive = (chain: FxChain | undefined): boolean =>
  !!chain && FX_UI_ORDER.some((id) => chain[id]?.on);

export const activeFxCount = (chain: FxChain | undefined): number =>
  chain ? FX_UI_ORDER.filter((id) => chain[id]?.on).length : 0;

export const isFxStateActive = (s: PadFxState): boolean =>
  isChainActive(s.drumAll) ||
  isChainActive(s.chordAll) ||
  Object.values(s.drumParts).some(isChainActive) ||
  Object.values(s.chordTracks).some(isChainActive);

// Jumlah efek aktif di seluruh tingkat (untuk lencana di tombol toolbar).
export const totalActiveFx = (s: PadFxState): number =>
  activeFxCount(s.drumAll) +
  activeFxCount(s.chordAll) +
  Object.values(s.drumParts).reduce((a, c) => a + activeFxCount(c), 0) +
  Object.values(s.chordTracks).reduce((a, c) => a + activeFxCount(c), 0);

export const getChain = (s: PadFxState, domain: FxDomain, target: string): FxChain => {
  if (target === FX_TARGET_ALL) return domain === 'drum' ? s.drumAll : s.chordAll;
  return (domain === 'drum' ? s.drumParts[target] : s.chordTracks[target]) ?? EMPTY_CHAIN;
};

export const setChain = (s: PadFxState, domain: FxDomain, target: string, chain: FxChain): PadFxState => {
  if (target === FX_TARGET_ALL) return domain === 'drum' ? { ...s, drumAll: chain } : { ...s, chordAll: chain };
  return domain === 'drum'
    ? { ...s, drumParts: { ...s.drumParts, [target]: chain } }
    : { ...s, chordTracks: { ...s.chordTracks, [target]: chain } };
};

export const setUnit = (s: PadFxState, domain: FxDomain, target: string, id: FxId, unit: FxUnit): PadFxState => {
  const cur = getChain(s, domain, target);
  const base: FxChain = cur === EMPTY_CHAIN ? emptyChain() : cur;
  return setChain(s, domain, target, { ...base, [id]: unit });
};

export const cloneChain = (c: FxChain): FxChain => {
  const out = {} as FxChain;
  FX_UI_ORDER.forEach((id) => (out[id] = { on: !!c[id]?.on, p: { ...c[id]?.p } }));
  return out;
};

// ---------------------------------------------------------------------------
// EKOR EFEK (dipakai ekspor: berapa detik ekstra perlu dirender agar gema / reverb tidak terpotong)
// ---------------------------------------------------------------------------
const MAX_TAIL_SEC = 10;

export const chainTailSec = (chain: FxChain | undefined): number => {
  if (!chain) return 0;
  let tail = 0;
  if (chain.reverb?.on) {
    tail = Math.max(tail, (chain.reverb.p.size ?? 2) + (chain.reverb.p.pre ?? 0) / 1000);
  }
  if (chain.delay?.on) {
    const t = (chain.delay.p.time ?? 320) / 1000;
    const fb = Math.min(0.9, Math.max(0, (chain.delay.p.fb ?? 0) / 100));
    const repeats = fb < 0.02 ? 1 : Math.min(40, Math.ceil(Math.log(0.001) / Math.log(fb)));
    tail = Math.max(tail, t * repeats);
  }
  if (chain.chorus?.on) tail = Math.max(tail, 0.1);
  if (chain.limiter?.on) tail = Math.max(tail, ((chain.limiter.p.rel ?? 100) / 1000) * 2);
  return Math.min(MAX_TAIL_SEC, tail);
};

export const fxTailSec = (s: PadFxState, includeDrum: boolean, includeChord: boolean): number => {
  let tail = 0;
  if (includeDrum) {
    tail = Math.max(tail, chainTailSec(s.drumAll), ...Object.values(s.drumParts).map(chainTailSec));
  }
  if (includeChord) {
    tail = Math.max(tail, chainTailSec(s.chordAll), ...Object.values(s.chordTracks).map(chainTailSec));
  }
  // Rantai bertingkat (bagian -> semua) menjumlahkan ekornya; dibatasi supaya ekspor tidak membengkak.
  return Math.min(MAX_TAIL_SEC, tail);
};

// ---------------------------------------------------------------------------
// SERIALISASI KE PROYEK (disimpan di dalam berkas proyek / MIDI)
// Format ringkas: setiap efek = [on(0/1), ...nilai parameter sesuai urutan FX_DEFS].
// Hanya efek yang menyala ATAU nilainya beda dari bawaan yang disimpan.
// ---------------------------------------------------------------------------
export type ProjectFxUnit = number[];
export type ProjectFxChain = Partial<Record<FxId, ProjectFxUnit>>;
export interface ProjectFx {
  da?: ProjectFxChain; // semua drum
  dp?: Record<string, ProjectFxChain>; // per bagian drum
  ca?: ProjectFxChain; // semua instrumen akor
  ct?: Record<string, ProjectFxChain>; // per instrumen akor
}

const serializeChain = (chain: FxChain): ProjectFxChain | undefined => {
  const out: ProjectFxChain = {};
  let any = false;
  FX_UI_ORDER.forEach((id) => {
    const u = chain[id];
    if (!u) return;
    const defs = FX_DEFS[id].params;
    const vals = defs.map((d) => clampParam(d, u.p[d.key]));
    const changed = defs.some((d, i) => vals[i] !== d.def);
    if (u.on || changed) {
      out[id] = [u.on ? 1 : 0, ...vals];
      any = true;
    }
  });
  return any ? out : undefined;
};

export const serializeFx = (s: PadFxState): ProjectFx | undefined => {
  const out: ProjectFx = {};
  const da = serializeChain(s.drumAll);
  if (da) out.da = da;
  const ca = serializeChain(s.chordAll);
  if (ca) out.ca = ca;
  const dp: Record<string, ProjectFxChain> = {};
  Object.entries(s.drumParts).forEach(([k, c]) => {
    const sc = serializeChain(c);
    if (sc) dp[k] = sc;
  });
  if (Object.keys(dp).length) out.dp = dp;
  const ct: Record<string, ProjectFxChain> = {};
  Object.entries(s.chordTracks).forEach(([k, c]) => {
    const sc = serializeChain(c);
    if (sc) ct[k] = sc;
  });
  if (Object.keys(ct).length) out.ct = ct;
  return Object.keys(out).length ? out : undefined;
};

const parseChain = (raw: unknown): FxChain | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const chain = emptyChain();
  let any = false;
  FX_UI_ORDER.forEach((id) => {
    const arr = r[id];
    if (!Array.isArray(arr)) return;
    const defs = FX_DEFS[id].params;
    const p: Record<string, number> = {};
    defs.forEach((d, i) => (p[d.key] = clampParam(d, arr[i + 1] ?? d.def)));
    chain[id] = { on: arr[0] === 1 || arr[0] === true, p };
    any = true;
  });
  return any ? chain : undefined;
};

const parseChainMap = (raw: unknown, allowed: (key: string) => boolean): Record<string, FxChain> => {
  const out: Record<string, FxChain> = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.entries(raw as Record<string, unknown>).forEach(([k, v]) => {
    if (!allowed(k)) return;
    const c = parseChain(v);
    if (c) out[k] = c;
  });
  return out;
};

/** Ubah data proyek (ProjectFx, boleh kosong / tak lengkap) menjadi state efek utuh. */
export const deserializeFx = (pf: ProjectFx | undefined | null): PadFxState => {
  const s = emptyFx();
  if (!pf || typeof pf !== 'object') return s;
  s.drumAll = parseChain(pf.da) ?? s.drumAll;
  s.chordAll = parseChain(pf.ca) ?? s.chordAll;
  s.drumParts = parseChainMap(pf.dp, () => true);
  s.chordTracks = parseChainMap(pf.ct, () => true);
  return s;
};

/**
 * Validasi data efek dari luar (berkas proyek / body request server): buang kunci asing, jepit nilai ke rentang sah.
 * Dipanggil oleh normalizeProject (juga di server), jadi efek tidak hilang & tidak bisa dipakai untuk menyelundupkan data aneh.
 */
export const normalizeProjectFx = (raw: unknown, drumIds: string[], trackCount: number): ProjectFx | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const trackIds = new Set(Array.from({ length: trackCount }, (_, i) => String(i + 1)));
  const drumSet = new Set(drumIds);
  const state: PadFxState = {
    drumAll: parseChain(r.da) ?? emptyChain(),
    chordAll: parseChain(r.ca) ?? emptyChain(),
    drumParts: parseChainMap(r.dp, (k) => drumSet.has(k)),
    chordTracks: parseChainMap(r.ct, (k) => trackIds.has(k)),
  };
  return serializeFx(state);
};
