// src/services/padPolicy.ts
// Klien aturan akses Pad Editor. SUMBER KEBENARAN = SERVER (lihat server/padEditorRoutes.ts), bukan localStorage.
// Konstanta di sini hanya dipakai UI untuk menampilkan batas dan menolak lebih awal; server tetap yang memutuskan.
// Harus sama dengan server/padEditorRoutes.ts.

export const FREE_MAX_BARS = 1;
export const FREE_DRUM_KITS: string[] = ['80s Kit', 'Ambient', 'Industrial'];
export const FREE_CHORD_PROGRAMS: number[] = [0]; // 0 = Grand Piano
export const FREE_CHORD_SLOTS = 1;

export type PadAction = 'export' | 'save' | 'load';

export interface PadPolicy {
  paid: boolean;
  limits: {
    totalBars: number;
    maxBars: number;
    drumKits: string[];
    chordPrograms: number[] | 'all';
    chordSlots: number;
    canExport: boolean;
    canSaveProject: boolean;
    canLoadProject: boolean;
  };
}

export interface PadSettings {
  v: 1;
  drumKit: string;
  chord: { enabled: boolean; program: number }[];
}

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  let data: any = null;
  try {
    data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

/** Kebijakan akses dari server. null = tidak bisa dipastikan (belum login / server tak terjangkau). */
export async function fetchPadPolicy(): Promise<PadPolicy | null> {
  try {
    const r = await call('/api/pad/policy');
    return r.ok && r.data && typeof r.data.paid === 'boolean' ? (r.data as PadPolicy) : null;
  } catch {
    return null;
  }
}

/** Pengaturan pad tersimpan di akun (sudah dipaksa sesuai hak akses oleh server). */
export async function loadPadSettings(): Promise<PadSettings | null> {
  try {
    const r = await call('/api/pad/settings');
    return r.ok && r.data?.settings ? (r.data.settings as PadSettings) : null;
  } catch {
    return null;
  }
}

export type SaveResult = 'ok' | 'denied' | 'error';
export async function savePadSettings(settings: PadSettings): Promise<SaveResult> {
  try {
    const r = await call('/api/pad/settings', { method: 'PUT', body: JSON.stringify({ settings }) });
    if (r.ok) return 'ok';
    return r.status === 403 ? 'denied' : 'error';
  } catch {
    return 'error';
  }
}

/** Izin server untuk Ekspor / Simpan / Muat. 'error' (jaringan, 401, 5xx) diperlakukan sebagai DITOLAK oleh pemanggil. */
export async function authorizePadAction(action: PadAction): Promise<'ok' | 'denied' | 'error'> {
  try {
    const r = await call('/api/pad/authorize', { method: 'POST', body: JSON.stringify({ action }) });
    if (r.ok && r.data?.ok === true) return 'ok';
    return r.status === 403 ? 'denied' : 'error';
  } catch {
    return 'error';
  }
}

/** Pagar sisi klien (cermin aturan server) agar UI tidak pernah menampilkan keadaan terlarang. */
export function enforcePadSettings(s: PadSettings, paid: boolean): PadSettings {
  if (paid) return s;
  return {
    v: 1,
    drumKit: FREE_DRUM_KITS.includes(s.drumKit) ? s.drumKit : FREE_DRUM_KITS[0],
    chord: s.chord.map((c, i) => ({
      enabled: i === 0 ? true : i < FREE_CHORD_SLOTS ? c.enabled : false,
      program: FREE_CHORD_PROGRAMS.includes(c.program) ? c.program : FREE_CHORD_PROGRAMS[0],
    })),
  };
}

// ---------------------------------------------------------------------------
// BERKAS YANG DIBUAT / DIBUKA SERVER (Simpan Proyek, Muat Proyek, Ekspor MIDI)
// Browser hanya mengirim data & menerima hasil. Pembuatan berkas dan kunci enkripsinya ada di server, jadi tanpa
// hak akses yang sah tidak ada cara memintanya hanya dengan mengubah JavaScript di klien.
// ---------------------------------------------------------------------------
export type FileCallResult<T> =
  | { result: 'ok'; value: T }
  | { result: 'denied'; message: string } // 403: tidak punya hak akses
  | { result: 'error'; message: string }; // 401 / 4xx / 5xx / jaringan

async function postForFile(url: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(url, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

async function failureOf(res: Response | null): Promise<FileCallResult<never>> {
  if (!res) return { result: 'error', message: 'Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.' };
  let message = 'Terjadi kesalahan di server.';
  try {
    const j = await res.json();
    if (j && typeof j.error === 'string') message = j.error;
  } catch {}
  return { result: res.status === 403 ? 'denied' : 'error', message };
}

async function midiFrom(res: Response | null): Promise<FileCallResult<Blob>> {
  if (!res || !res.ok) return failureOf(res);
  return { result: 'ok', value: await res.blob() };
}

/** Simpan Proyek: server memvalidasi, mengenkripsi, dan mengembalikan berkas .mid. */
export async function saveProjectOnServer(project: unknown): Promise<FileCallResult<Blob>> {
  return midiFrom(await postForFile('/api/pad/project/save', { project }));
}

export interface LoadedProject<P = unknown> {
  project: P;
  warnings: string[];
  summary: string;
}

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('Berkas tidak dapat dibaca.'));
    r.readAsDataURL(file);
  });

/** Muat Proyek: berkas dikirim ke server, yang membuka (dekripsi) lalu mengembalikan proyek yang sudah divalidasi. */
export async function loadProjectOnServer<P = unknown>(file: File): Promise<FileCallResult<LoadedProject<P>>> {
  let data: string;
  try {
    data = await fileToBase64(file);
  } catch (e) {
    return { result: 'error', message: e instanceof Error ? e.message : 'Berkas tidak dapat dibaca.' };
  }
  const res = await postForFile('/api/pad/project/load', { data });
  if (!res || !res.ok) return failureOf(res);
  try {
    const j = await res.json();
    if (!j || typeof j.project !== 'object') return { result: 'error', message: 'Jawaban server tidak valid.' };
    return { result: 'ok', value: { project: j.project as P, warnings: Array.isArray(j.warnings) ? j.warnings : [], summary: String(j.summary || '') } };
  } catch {
    return { result: 'error', message: 'Jawaban server tidak valid.' };
  }
}

export interface MidiExportRequest {
  bpm: number;
  timeSignature: { num: number; den: number };
  programs: number[];
  events: Array<{ step: number; note: number; velocity?: number; durationSteps?: number; isDrum?: boolean; channel?: number }>;
  title: string;
  project?: unknown;
}

/** Ekspor MIDI: server yang menulis berkas .mid (termasuk proyek terenkripsi di dalamnya). */
export async function exportMidiOnServer(req: MidiExportRequest): Promise<FileCallResult<Blob>> {
  return midiFrom(await postForFile('/api/pad/export/midi', req));
}
