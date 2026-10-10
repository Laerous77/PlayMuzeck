// src/services/sfxSettings.ts
// Pengaturan EFEK SUARA KLIK. Sumber kebenaran = DATABASE (users.sfx_settings,
// lewat /api/me/sfx). TIDAK memakai localStorage: data hanya ada di memori
// selama sesi, dimuat dari server saat login, dan disimpan ke server tiap diubah.
//
// Sengaja TIDAK mengimpor audioEngine (audioEngine yang mengimpor file ini),
// supaya tidak terjadi import melingkar.
//
// Aturan produk:
//  - Default: semua bagian HENING.
//  - Mode "Bawaan": audio = 2 efek unik, kuis = 2 efek unik, lainnya = 1 efek.
//  - Mode "Nada GM" (hanya jika punya Full 64-Bar Editor): 1 slot per bagian,
//    tiap slot = 1 nada dari salah satu 128 instrumen GM. Bisa disamakan untuk
//    semua bagian atau dibedakan, bisa diacak, bisa diatur manual.

export type SfxSection = 'audio' | 'quiz' | 'other';
export const SFX_SECTIONS: SfxSection[] = ['audio', 'quiz', 'other'];

export const SFX_SECTION_LABEL: Record<SfxSection, string> = {
  audio: 'Audio Studio',
  quiz: 'Pusat Kuis',
  other: 'Bagian Lainnya',
};

export type BuiltinSfxId = 'audio-hat' | 'audio-kick' | 'quiz-bell' | 'quiz-pop' | 'other-tok';

export interface BuiltinSfxOption {
  id: BuiltinSfxId;
  label: string;
  desc: string;
}

// 2 + 2 + 1. "other-tok" memadukan transien noise (ala audio) dengan nada
// pendek (ala kuis) sehingga terdengar sebagai jembatan keduanya.
export const BUILTIN_SFX: Record<SfxSection, BuiltinSfxOption[]> = {
  audio: [
    { id: 'audio-hat', label: 'Hi-Hat Tik', desc: 'Desis cymbal tipis dan renyah' },
    { id: 'audio-kick', label: 'Kick Mini', desc: 'Dentum bass pendek ala drum machine' },
  ],
  quiz: [
    { id: 'quiz-bell', label: 'Ding Bel', desc: 'Denting bel cerah seperti papan skor' },
    { id: 'quiz-pop', label: 'Pop Gelembung', desc: 'Letupan kecil yang naik, ringan dan ceria' },
  ],
  other: [{ id: 'other-tok', label: 'Tok Lembut', desc: 'Ketukan netral: setengah perkusi, setengah nada' }],
};

export interface GmSlot {
  /** Nomor program GM 0-127 (indeks INSTRUMENTS_128 di audioEngine). */
  program: number;
  /** Nomor not MIDI. */
  note: number;
  /** true = tiap klik memakai nada acak (pentatonik) di atas `note`. */
  randomPitch: boolean;
}

export interface SfxSettings {
  v: 1;
  mode: 'builtin' | 'gm';
  /** 'off' = hening (DEFAULT). */
  builtin: Record<SfxSection, BuiltinSfxId | 'off'>;
  /** true: satu slot GM dipakai semua bagian; false: slot berbeda per bagian. */
  gmLinked: boolean;
  gmShared: GmSlot;
  gm: Record<SfxSection, GmSlot>;
}

export const GM_NOTE_MIN = 36; // C2
export const GM_NOTE_MAX = 96; // C7

const DEFAULT_SLOT: GmSlot = { program: 12, note: 72, randomPitch: false }; // Marimba, C5

export const makeDefaultSfx = (): SfxSettings => ({
  v: 1,
  mode: 'builtin',
  builtin: { audio: 'off', quiz: 'off', other: 'off' },
  gmLinked: true,
  gmShared: { ...DEFAULT_SLOT },
  gm: { audio: { ...DEFAULT_SLOT }, quiz: { ...DEFAULT_SLOT }, other: { ...DEFAULT_SLOT } },
});

/** Efek yang akan dimainkan untuk satu klik. */
export type ClickEffect =
  | { kind: 'builtin'; id: BuiltinSfxId }
  | { kind: 'gm'; program: number; note: number };

// ── Validasi (sama dengan server/soundFxRoutes.ts) ──────────────────────────
const clampInt = (n: unknown, lo: number, hi: number, fb: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fb;
  return Math.min(hi, Math.max(lo, v));
};
const cleanSlot = (raw: any): GmSlot => ({
  program: clampInt(raw?.program, 0, 127, DEFAULT_SLOT.program),
  note: clampInt(raw?.note, GM_NOTE_MIN, GM_NOTE_MAX, DEFAULT_SLOT.note),
  randomPitch: raw?.randomPitch === true,
});
const cleanBuiltin = (s: SfxSection, id: unknown): BuiltinSfxId | 'off' =>
  BUILTIN_SFX[s].some((o) => o.id === id) ? (id as BuiltinSfxId) : 'off';

export function sanitizeSfx(raw: any): SfxSettings {
  if (!raw || typeof raw !== 'object') return makeDefaultSfx();
  return {
    v: 1,
    mode: raw.mode === 'gm' ? 'gm' : 'builtin',
    builtin: {
      audio: cleanBuiltin('audio', raw.builtin?.audio),
      quiz: cleanBuiltin('quiz', raw.builtin?.quiz),
      other: cleanBuiltin('other', raw.builtin?.other),
    },
    gmLinked: raw.gmLinked !== false,
    gmShared: cleanSlot(raw.gmShared),
    gm: { audio: cleanSlot(raw.gm?.audio), quiz: cleanSlot(raw.gm?.quiz), other: cleanSlot(raw.gm?.other) },
  };
}

// ── State di memori ─────────────────────────────────────────────────────────
export type SfxSaveState = 'idle' | 'saving' | 'saved' | 'error';

let current: SfxSettings = makeDefaultSfx();
let gmUnlocked = false; // kebenaran dari SERVER (cek user_collections)
export type SfxLoadState = 'idle' | 'loading' | 'ready' | 'failed';
let loadState: SfxLoadState = 'idle';
let loadEmail: string | null = null; // akun yang sedang dipantau
let retryTimer: ReturnType<typeof setTimeout> | null = null;
const RETRY_DELAYS_MS = [2000, 5000, 10000];
let saveState: SfxSaveState = 'idle';
let saveError = '';
let editSeq = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => { try { fn(); } catch {} });

/** Berlangganan perubahan (dipakai UI dan preload bank suara di App). */
export function subscribeSfx(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const getSfxSettings = () => current;
export const isGmUnlocked = () => gmUnlocked;
export const getSfxSaveState = () => ({ state: saveState, error: saveError });
export const getSfxLoadState = () => loadState;
export const isSfxLoaded = () => loadState === 'ready';

async function api(method: 'GET' | 'PUT', body?: unknown) {
  const res = await fetch('/api/me/sfx', {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const isJson = (res.headers.get('content-type') || '').includes('json');
  const data: any = isJson ? await res.json().catch(() => ({})) : {};
  if (!res.ok || !isJson) throw new Error(data?.error || `Permintaan gagal (${res.status})`);
  return data as { settings: SfxSettings; gmUnlocked: boolean };
}

/**
 * Dipanggil App.tsx saat login / ganti akun / logout.
 * email = null (tamu / logout) -> kembali ke default HENING.
 */
export function loadSfxForUser(email: string | null): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
  editSeq++;
  loadEmail = email ? email.trim().toLowerCase() : null;
  saveState = 'idle';
  saveError = '';

  if (!loadEmail) {
    current = makeDefaultSfx();
    gmUnlocked = false;
    loadState = 'idle';
    emit();
    return Promise.resolve();
  }
  return fetchFromServer(0);
}

/** Tombol "Coba lagi" di UI. */
export const retrySfxLoad = () => (loadEmail ? fetchFromServer(0) : Promise.resolve());

async function fetchFromServer(attempt: number): Promise<void> {
  const forEmail = loadEmail;
  const seqAtStart = editSeq;
  loadState = 'loading';
  emit();
  try {
    const data = await api('GET');
    if (forEmail !== loadEmail || seqAtStart !== editSeq) return; // keburu ganti akun / diedit
    current = sanitizeSfx(data.settings);
    gmUnlocked = Boolean(data.gmUnlocked);
    if (!gmUnlocked && current.mode === 'gm') current = { ...current, mode: 'builtin' };
    loadState = 'ready';
  } catch {
    if (forEmail !== loadEmail || seqAtStart !== editSeq) return;
    // Server belum bisa dijangkau (mis. sesi baru dipulihkan): tetap HENING dan coba lagi.
    current = makeDefaultSfx();
    gmUnlocked = false;
    if (attempt < RETRY_DELAYS_MS.length) {
      retryTimer = setTimeout(() => { retryTimer = null; void fetchFromServer(attempt + 1); }, RETRY_DELAYS_MS[attempt]);
    } else {
      loadState = 'failed';
    }
  }
  emit();
}

/** Ubah pengaturan: langsung berlaku di memori, lalu disimpan ke database (debounce). */
export function updateSfx(next: SfxSettings) {
  current = sanitizeSfx(next);
  if (!gmUnlocked && current.mode === 'gm') current = { ...current, mode: 'builtin' };
  const seq = ++editSeq;
  saveState = 'saving';
  saveError = '';
  emit();

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const data = await api('PUT', { settings: current });
      if (seq !== editSeq) return; // sudah ada edit yang lebih baru; biarkan yang itu menyimpan
      gmUnlocked = Boolean(data.gmUnlocked);
      saveState = 'saved';
    } catch (e: any) {
      if (seq !== editSeq) return;
      saveState = 'error';
      saveError = e?.message || 'Gagal menyimpan.';
    }
    emit();
  }, 500);
}

// ── Pemilihan efek saat klik ────────────────────────────────────────────────
let activeSection: SfxSection = 'other';
export const setSfxSection = (s: SfxSection) => { activeSection = s; };

const PENTATONIC = [0, 2, 4, 7, 9, 12];

export const slotForSection = (s: SfxSettings, section: SfxSection): GmSlot =>
  s.gmLinked ? s.gmShared : s.gm[section];

/** Nada final untuk satu klik (menerapkan "nada acak tiap klik"). */
export function resolveSlotNote(slot: GmSlot): number {
  if (!slot.randomPitch) return slot.note;
  const off = PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)];
  return Math.min(GM_NOTE_MAX + 12, slot.note + off);
}

/** Efek yang harus berbunyi sekarang, atau null kalau hening. */
export function getActiveClickEffect(section: SfxSection = activeSection): ClickEffect | null {
  if (current.mode === 'gm' && gmUnlocked) {
    const slot = slotForSection(current, section);
    return { kind: 'gm', program: slot.program, note: resolveSlotNote(slot) };
  }
  const id = current.builtin[section];
  return id === 'off' ? null : { kind: 'builtin', id };
}

/** true kalau pengaturan saat ini butuh bank SF2 (untuk preload). */
export const needsSoundBank = () => current.mode === 'gm' && gmUnlocked;
