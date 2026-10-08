// server/padEditorRoutes.ts
// Aturan akses PAD EDITOR (Drum Pad + Chord Pad) — SUMBER KEBENARAN ADA DI SERVER, bukan di UI / localStorage.
//
//   Gratis  : Bar 1 saja • kit drum 80s Kit / Ambient / Industrial • akor hanya Grand Piano, 1 dari 4 slot • toolbar bebas
//   Berbayar: 16 bar • semua kit & instrumen • 4 slot akor • Ekspor Pola • Simpan Proyek • Muat Proyek
//
// Status berbayar DIBACA ULANG DARI DATABASE di setiap permintaan (tabel user_collections, aturan yang sama dengan
// server/soundFxRoutes.ts dan GET /api/user/collections). Tidak ada cache, jadi refund / pembelian berlaku seketika
// dan identik di semua perangkat / platform.
//
// Pengaturan pad (kit drum + konfigurasi 4 slot akor) disimpan per akun di users.pad_settings (JSONB),
// divalidasi saat DITULIS (403 bila melanggar) dan dipaksa ulang saat DIBACA (mis. setelah refund).
//
// Dipasang di server/index.ts (3 baris, sama seperti soundFxRoutes):
//   import { createPadEditorRouter, ensurePadEditorSchema } from './padEditorRoutes';
//   .then(() => ensurePadEditorSchema(pool))
//   app.use(createPadEditorRouter({ db: pool, requireUser }));
//
// Endpoint:
//   GET  /api/pad/policy      -> { paid, limits }
//   GET  /api/pad/settings    -> { settings, policy }          (sudah dipaksa sesuai hak akses)
//   PUT  /api/pad/settings    -> { settings, policy }          (403 bila melanggar batas gratis)
//   POST /api/pad/authorize   -> { ok } | 403                  body: { action: 'export' | 'save' | 'load' }
//   POST /api/pad/project/save -> berkas .mid (proyek TERENKRIPSI)   body: { project }
//   POST /api/pad/project/load -> { project, warnings, summary }     body: { data: <berkas .mid dalam base64> }
//   POST /api/pad/export/midi  -> berkas .mid                        body: { bpm, timeSignature, programs, events, title?, project? }
//
// KEAMANAN: berkas proyek & MIDI DIBUAT dan DIBUKA di server. Kuncinya (env PAD_PROJECT_KEY) tidak pernah sampai ke
// browser, jadi mengutak-atik JavaScript di klien tidak membuat Simpan / Muat / Ekspor MIDI jalan tanpa hak akses.
// Kepemilikan dibaca ulang dari database di SETIAP permintaan.
import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Pool } from 'pg';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { generateMidiFile } from '../src/services/exporters';
import { IMPORT_CTX } from '../src/components/AudioStudio/padContext';
import {
  MidiProjectError,
  encodeProjectPayload,
  importMidiBuffer,
  normalizeProject,
  projectToMidiBlob,
  type PayloadCodec,
} from '../src/components/AudioStudio/midiProject';

type Db = Pick<Pool, 'query'>;

export const PAD_SCHEMA_SQL = `
ALTER TABLE users ADD COLUMN IF NOT EXISTS pad_settings JSONB;
`;
export const ensurePadEditorSchema = (db: Db) => db.query(PAD_SCHEMA_SQL);

// ── Harus sama dengan src/services/padPolicy.ts ─────────────────────────────
const TOTAL_BARS = 16;
const FREE_MAX_BARS = 1;
const ALL_DRUM_KITS = ['80s Kit', 'Ambient', 'Industrial', 'Breakbeat', 'Jazzy', 'Electro', 'Hiphop'];
const FREE_DRUM_KITS = ['80s Kit', 'Ambient', 'Industrial'];
const CHORD_SLOTS = 4;
const FREE_CHORD_SLOTS = 1;
const FREE_CHORD_PROGRAMS = [0]; // 0 = Grand Piano
const PAID_ACTIONS = ['export', 'save', 'load'] as const;
type PaidAction = (typeof PAID_ACTIONS)[number];

interface ChordSlotCfg {
  enabled: boolean;
  program: number;
}
export interface PadSettings {
  v: 1;
  drumKit: string;
  chord: ChordSlotCfg[];
}

const defaultSettings = (): PadSettings => ({
  v: 1,
  drumKit: FREE_DRUM_KITS[0],
  chord: Array.from({ length: CHORD_SLOTS }, (_, i) => ({ enabled: i === 0, program: i === 0 ? 0 : 0 })),
});

const clampInt = (n: unknown, lo: number, hi: number, fb: number) => {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : fb;
  return Math.min(hi, Math.max(lo, v));
};

// Bentuk & rentang data (bukan hak akses): whitelist ketat, nilai asing dibuang.
export function sanitizePadSettings(raw: any): PadSettings {
  const base = defaultSettings();
  const kit = typeof raw?.drumKit === 'string' && ALL_DRUM_KITS.includes(raw.drumKit) ? raw.drumKit : base.drumKit;
  const src: any[] = Array.isArray(raw?.chord) ? raw.chord : [];
  const chord = base.chord.map((d, i) => ({
    enabled: i === 0 ? true : src[i]?.enabled === true, // slot 1 selalu aktif
    program: clampInt(src[i]?.program, 0, 127, d.program),
  }));
  return { v: 1, drumKit: kit, chord };
}

// Daftar pelanggaran batas gratis (kosong = sah).
function freeViolations(s: PadSettings): string[] {
  const out: string[] = [];
  if (!FREE_DRUM_KITS.includes(s.drumKit)) out.push(`Kit "${s.drumKit}" butuh Full 16-Bar Editor.`);
  s.chord.forEach((c, i) => {
    if (c.enabled && i >= FREE_CHORD_SLOTS) out.push(`Slot instrumen akor ${i + 1} butuh Full 16-Bar Editor.`);
    if (c.enabled && !FREE_CHORD_PROGRAMS.includes(c.program)) out.push('Instrumen akor selain Grand Piano butuh Full 16-Bar Editor.');
  });
  return out;
}

// Paksa ke batas gratis (dipakai saat membaca, mis. setelah refund).
function clampToFree(s: PadSettings): PadSettings {
  return {
    v: 1,
    drumKit: FREE_DRUM_KITS.includes(s.drumKit) ? s.drumKit : FREE_DRUM_KITS[0],
    chord: s.chord.map((c, i) => ({
      enabled: i === 0 ? true : i < FREE_CHORD_SLOTS ? c.enabled : false,
      program: FREE_CHORD_PROGRAMS.includes(c.program) ? c.program : FREE_CHORD_PROGRAMS[0],
    })),
  };
}

const policyFor = (paid: boolean) => ({
  paid,
  limits: paid
    ? {
        totalBars: TOTAL_BARS,
        maxBars: TOTAL_BARS,
        drumKits: ALL_DRUM_KITS,
        chordPrograms: 'all' as const,
        chordSlots: CHORD_SLOTS,
        canExport: true,
        canSaveProject: true,
        canLoadProject: true,
      }
    : {
        totalBars: TOTAL_BARS,
        maxBars: FREE_MAX_BARS,
        drumKits: FREE_DRUM_KITS,
        chordPrograms: FREE_CHORD_PROGRAMS,
        chordSlots: FREE_CHORD_SLOTS,
        canExport: false,
        canSaveProject: false,
        canLoadProject: false,
      },
});

// ── Penyegel berkas proyek (AES-256-GCM). Kunci HANYA ada di server. ─────────────────────────────────────
// Tanpa PAD_PROJECT_KEY (produksi) => Simpan / Muat / Ekspor MIDI ditolak (fail-closed), bukan jatuh ke mode tak terkunci.
let cachedKey: Buffer | null = null;
function getProjectKey(): Buffer | null {
  if (cachedKey) return cachedKey;
  let secret = String(process.env.PAD_PROJECT_KEY || '');
  if (secret.length < 32) {
    if (process.env.NODE_ENV === 'production') return null;
    secret = 'dev-only-pad-project-key-do-not-use-in-production';
    console.warn('[pad] PAD_PROJECT_KEY belum diisi (min. 32 karakter) — memakai kunci DEV. Wajib diisi di produksi.');
  }
  cachedKey = scryptSync(secret, 'playmuzeck-pad-project-v1', 32);
  return cachedKey;
}

export function createPayloadCodec(): PayloadCodec | null {
  const key = getProjectKey();
  if (!key) return null;
  return {
    seal(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', key, iv);
      const ct = Buffer.concat([c.update(plain), c.final()]);
      return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), ct]));
    },
    open(sealed) {
      if (sealed.length < 12 + 16 + 1) return null;
      try {
        const buf = Buffer.from(sealed);
        const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
        d.setAuthTag(buf.subarray(12, 28));
        return new Uint8Array(Buffer.concat([d.update(buf.subarray(28)), d.final()]));
      } catch {
        return null; // dimodifikasi / kunci berbeda
      }
    },
  };
}

// ── Validasi ketat permintaan Ekspor MIDI (nilai asing dibuang / ditolak) ───────────────────────────────
const MAX_EVENTS = 30000;
const MAX_STEP = 4095;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

interface MidiEventIn {
  step: number;
  note: number;
  velocity: number;
  durationSteps: number;
  isDrum: boolean;
  channel: number;
}
interface MidiExportIn {
  bpm: number;
  timeSignature: { num: number; den: number };
  programs: number[];
  events: MidiEventIn[];
  title: string;
}

const isInt = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export function parseMidiExport(body: any): MidiExportIn | string {
  if (!body || typeof body !== 'object') return 'Data ekspor tidak valid.';
  const bpm = Number(body.bpm);
  if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) return 'BPM tidak valid.';
  const ts = body.timeSignature;
  if (!ts || !isInt(ts.num, 1, 32) || ![1, 2, 4, 8, 16].includes(ts.den)) return 'Birama tidak valid.';
  const programs: number[] = Array.isArray(body.programs) ? body.programs : [];
  if (programs.length > 16 || !programs.every((p) => isInt(p, 0, 127))) return 'Daftar instrumen tidak valid.';
  const rawEvents: any[] = Array.isArray(body.events) ? body.events : [];
  if (rawEvents.length > MAX_EVENTS) return 'Terlalu banyak not.';
  const events: MidiEventIn[] = [];
  for (const e of rawEvents) {
    if (!e || !isInt(e.step, 0, MAX_STEP) || !isInt(e.note, 0, 127)) return 'Data not tidak valid.';
    events.push({
      step: e.step,
      note: e.note,
      velocity: isInt(e.velocity, 1, 127) ? e.velocity : 100,
      durationSteps: isInt(e.durationSteps, 1, MAX_STEP + 1) ? e.durationSteps : 1,
      isDrum: e.isDrum === true,
      channel: isInt(e.channel, 0, 15) ? e.channel : 0,
    });
  }
  const title = String(body.title ?? 'PlayMuzeck Pattern').replace(/[^\w\s().,#&+-]/g, '').trim().slice(0, 120) || 'PlayMuzeck Pattern';
  return { bpm, timeSignature: { num: ts.num, den: ts.den }, programs, events, title };
}

// Pembatas laju sederhana per akun (memori proses): cegah spam tulis / probing.
const hits = new Map<string, { n: number; reset: number }>();
function limited(key: string, max: number, windowMs = 60_000): boolean {
  const now = Date.now();
  if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  const cur = hits.get(key);
  if (!cur || cur.reset <= now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return false;
  }
  cur.n += 1;
  return cur.n > max;
}

interface Options {
  db: Db;
  requireUser: RequestHandler;
  getUserEmail?: (req: Request) => string | undefined;
}

export function createPadEditorRouter({
  db,
  requireUser,
  getUserEmail = (req) => (req as any).userEmail || (req as any).user?.email,
}: Options) {
  const router = Router();

  // Jawaban terkait hak akses tidak boleh di-cache browser / CDN / proxy.
  router.use('/api/pad', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Vary', 'Cookie, Authorization');
    next();
  });

  const h = (fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler => (req: Request, res: Response) => {
    Promise.resolve(fn(req, res)).catch((err) => {
      console.error('[pad]', err);
      if (!res.headersSent) res.status(500).json({ error: 'Terjadi kesalahan server.' });
    });
  };

  // Aturan SAMA dengan has16BarEditor di GET /api/user/collections dan ownsPadEditor di soundFxRoutes.
  async function ownsPadEditor(email: string): Promise<boolean> {
    const { rows } = await db.query(
      `SELECT 1 FROM public.user_collections
        WHERE lower(user_email) = $1 AND item_category = 'audio'
          AND item_type_key IN ('fullEditor8Bar', 'all')
        LIMIT 1`,
      [email]
    );
    return rows.length > 0;
  }

  // Identitas HANYA dari sesi (requireUser), tidak pernah dari body / query.
  const own = (req: Request) => String(getUserEmail(req) || '').trim().toLowerCase();

  async function loadSettings(email: string) {
    const [paid, { rows }] = await Promise.all([
      ownsPadEditor(email),
      db.query(`SELECT pad_settings FROM users WHERE lower(email) = $1 LIMIT 1`, [email]),
    ]);
    let settings = sanitizePadSettings(rows[0]?.pad_settings);
    if (!paid) settings = clampToFree(settings); // mis. refund: otomatis kembali ke batas gratis
    return { settings, policy: policyFor(paid) };
  }

  router.get('/api/pad/policy', requireUser, h(async (req, res) => {
    const email = own(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    res.json(policyFor(await ownsPadEditor(email)));
  }));

  router.get('/api/pad/settings', requireUser, h(async (req, res) => {
    const email = own(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    res.json(await loadSettings(email));
  }));

  router.put('/api/pad/settings', requireUser, h(async (req, res) => {
    const email = own(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    if (limited(`set:${email}`, 40)) return res.status(429).json({ error: 'Terlalu sering. Coba sebentar lagi.' });

    const body = req.body?.settings;
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 2000) {
      return res.status(400).json({ error: 'Data pengaturan tidak valid.' });
    }
    const settings = sanitizePadSettings(body);
    const paid = await ownsPadEditor(email);
    if (!paid) {
      const bad = freeViolations(settings);
      if (bad.length > 0) {
        console.warn('[pad] pelanggaran batas gratis ditolak:', email, bad[0]);
        return res.status(403).json({ error: bad[0], policy: policyFor(false) });
      }
    }
    const { rowCount } = await db.query(`UPDATE users SET pad_settings = $2::jsonb WHERE lower(email) = $1`, [
      email,
      JSON.stringify(settings),
    ]);
    if (!rowCount) return res.status(404).json({ error: 'Akun tidak ditemukan.' });
    res.json({ settings, policy: policyFor(paid) });
  }));

  // Izin untuk aksi berbayar. Tiap Ekspor / Simpan / Muat meminta izin ini; tanpa kepemilikan => 403.
  router.post('/api/pad/authorize', requireUser, h(async (req, res) => {
    const email = own(req);
    if (!email) return res.status(401).json({ error: 'Belum login.' });
    if (limited(`auth:${email}`, 60)) return res.status(429).json({ error: 'Terlalu sering. Coba sebentar lagi.' });

    const action = req.body?.action as PaidAction;
    if (!PAID_ACTIONS.includes(action)) return res.status(400).json({ error: 'Aksi tidak dikenal.' });
    if (!(await ownsPadEditor(email))) {
      console.warn('[pad] aksi berbayar ditolak:', email, action);
      return res.status(403).json({ ok: false, error: 'Fitur ini butuh Full 16-Bar Editor.' });
    }
    res.json({ ok: true, action });
  }));

  // ── Berkas yang dibuat / dibuka SERVER ──────────────────────────────────────────────────────────────
  // Urutan tiap permintaan: sesi -> laju -> kepemilikan (DB) -> kunci server -> validasi -> kerjakan.
  async function gate(req: Request, res: Response, bucket: string, max: number): Promise<{ email: string; codec: PayloadCodec } | null> {
    const email = own(req);
    if (!email) {
      res.status(401).json({ error: 'Belum login.' });
      return null;
    }
    if (limited(`${bucket}:${email}`, max)) {
      res.status(429).json({ error: 'Terlalu sering. Coba sebentar lagi.' });
      return null;
    }
    if (!(await ownsPadEditor(email))) {
      console.warn('[pad] aksi berbayar ditolak:', email, bucket);
      res.status(403).json({ ok: false, error: 'Fitur ini butuh Full 16-Bar Editor.' });
      return null;
    }
    const codec = createPayloadCodec();
    if (!codec) {
      console.error('[pad] PAD_PROJECT_KEY belum diatur: fitur berkas dinonaktifkan.');
      res.status(503).json({ error: 'Fitur ini sedang tidak tersedia. Hubungi admin.' });
      return null;
    }
    return { email, codec };
  }

  const sendMidi = async (res: Response, blob: Blob) => {
    const bytes = Buffer.from(await blob.arrayBuffer());
    res.set('Content-Type', 'audio/midi');
    res.set('Content-Disposition', 'attachment; filename="PlayMuzeck.mid"');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(bytes);
  };

  router.post('/api/pad/project/save', requireUser, h(async (req, res) => {
    const g = await gate(req, res, 'save', 30);
    if (!g) return;
    let project;
    try {
      project = normalizeProject(req.body?.project, IMPORT_CTX); // dibersihkan & dijepit ke rentang sah
    } catch (err) {
      return res.status(400).json({ error: err instanceof MidiProjectError ? err.message : 'Data proyek tidak valid.' });
    }
    await sendMidi(res, projectToMidiBlob(project, 'PlayMuzeck Project', g.codec));
  }));

  router.post('/api/pad/project/load', requireUser, h(async (req, res) => {
    const g = await gate(req, res, 'load', 30);
    if (!g) return;
    const b64 = req.body?.data;
    if (typeof b64 !== 'string' || b64.length === 0 || b64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8) {
      return res.status(400).json({ error: 'Berkas kosong atau terlalu besar (maksimal 5 MB).' });
    }
    const raw = Buffer.from(b64, 'base64');
    if (raw.length === 0 || raw.length > MAX_UPLOAD_BYTES) return res.status(400).json({ error: 'Berkas kosong atau terlalu besar (maksimal 5 MB).' });
    try {
      const ab = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
      const out = importMidiBuffer(ab, IMPORT_CTX, g.codec);
      res.json({ project: out.project, warnings: out.warnings, source: out.source, summary: out.summary });
    } catch (err) {
      res.status(422).json({ error: err instanceof MidiProjectError ? err.message : 'Berkas tidak dapat dibaca.' });
    }
  }));

  router.post('/api/pad/export/midi', requireUser, h(async (req, res) => {
    const g = await gate(req, res, 'xmidi', 40);
    if (!g) return;
    const parsed = parseMidiExport(req.body);
    if (typeof parsed === 'string') return res.status(400).json({ error: parsed });
    let payload: Uint8Array | undefined;
    if (req.body?.project !== undefined) {
      try {
        payload = encodeProjectPayload(normalizeProject(req.body.project, IMPORT_CTX), g.codec);
      } catch (err) {
        return res.status(400).json({ error: err instanceof MidiProjectError ? err.message : 'Data proyek tidak valid.' });
      }
    }
    const blob = generateMidiFile(
      parsed.bpm,
      parsed.events,
      parsed.title,
      parsed.programs[0] ?? 0,
      parsed.programs[1],
      parsed.timeSignature,
      payload,
      parsed.programs
    );
    await sendMidi(res, blob);
  }));

  return router;
}
