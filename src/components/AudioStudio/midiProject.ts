// src/components/AudioStudio/midiProject.ts
// Simpan & muat proyek Pad Studio lewat berkas MIDI.
//
// 1) Berkas yang diekspor Pad Studio membawa data proyek utuh (pola, mixer, ADSR, formula pad akor, dst.)
//    di dalam meta-event "Sequencer Specific" (0xFF 0x7F). DAW mengabaikannya, Pad Studio memulihkannya persis.
// 2) Berkas MIDI dari tempat lain (tanpa data itu) diimpor sebisanya: drum dari channel 10 (General MIDI),
//    nada-nada serentak dari channel lain dijadikan akor.
//
// Semua fungsi di sini murni (tanpa React), sehingga mudah diuji.

import { buildHarmonicChord, ChordFormulaDef, CHORD_QUALITIES, CHORD_TENSIONS, NOTE_ROOTS } from '../../services/audioEngine';
import { generateMidiFile } from '../../services/exporters';
import { DRUM_LEVEL_MIDI, emptyTrackData, insertNote } from './padModel';

// ---------------------------------------------------------------------------
// MODEL PROYEK
// ---------------------------------------------------------------------------
export type Adsr4 = [number, number, number, number]; // attack, decay, sustain, release
export type PadTuple = [string, string, string, string, number, number]; // root, type, tension, bass, inversion, octave

export interface ProjectDrumMix {
  v: number; // volume 0–100
  m: boolean; // mute
  s: boolean; // solo
  a: Adsr4;
}

export interface ProjectChordTrack {
  id: number;
  label: string;
  on: boolean;
  program: number;
  vol: number; // 0–100
  m: boolean;
  s: boolean;
  a: Adsr4;
  notes: Array<[number, number, number]>; // [step awal, panjang (step), indeks pad]
}

export interface PadProject {
  bpm: number;
  timeSig: string;
  kit: string;
  drumVolume: number;
  chordVolume: number;
  barsPerView: number;
  newChordLen: number;
  loop: { sb: number; sbt: number; eb: number; ebt: number };
  pads: PadTuple[];
  drum: Record<string, string>; // id drum -> deretan digit kekuatan 0–4, satu digit per step
  drumMix: Record<string, ProjectDrumMix>;
  chords: ProjectChordTrack[];
}

export type Range4 = [[number, number], [number, number], [number, number], [number, number]];

// Nilai dari Pad Studio yang dibutuhkan untuk validasi/konversi (dikirim sebagai parameter supaya modul ini
// tidak mengimpor PadStudio — menghindari impor melingkar).
export interface ImportContext {
  drumIds: string[];
  totalBars: number;
  timeSigs: Array<{ id: string; num: number; den: number; steps: number }>;
  kits: string[];
  defaultKit: string;
  barsPerViewOptions: number[];
  defaultBarsPerView: (stepsPerBar: number) => number;
  defaultPads: ChordFormulaDef[];
  drumAdsr: Adsr4;
  drumAdsrRanges: Range4;
  chordAdsrRanges: Range4;
  chordDefaults: Array<{ label: string; program: number; volume: number; adsr: Adsr4 }>;
  bpmRange: [number, number];
}

export class MidiProjectError extends Error {}

export const padToTuple = (c: ChordFormulaDef): PadTuple => [
  c.root,
  c.type,
  c.tension || 'none',
  c.bass || 'none',
  c.inversion || 0,
  c.octaveOffset || 0,
];

export const tupleToPad = (t: PadTuple): ChordFormulaDef => ({
  root: t[0],
  type: t[1],
  tension: t[2],
  bass: t[3],
  inversion: t[4],
  octaveOffset: t[5],
});

// ---------------------------------------------------------------------------
// PAYLOAD (data proyek di dalam berkas MIDI)
// Format: [0x7D (ID produsen non-komersial)] + "PMZK1" + JSON UTF-8
// ---------------------------------------------------------------------------
const MFR_ID = 0x7d;
const MAGIC = 'PMZK1';

export function encodeProjectPayload(project: PadProject): Uint8Array {
  const json = JSON.stringify({ app: 'PlayMuzeck PadStudio', version: 1, project });
  const body = new TextEncoder().encode(json);
  const out = new Uint8Array(1 + MAGIC.length + body.length);
  out[0] = MFR_ID;
  for (let i = 0; i < MAGIC.length; i++) out[1 + i] = MAGIC.charCodeAt(i);
  out.set(body, 1 + MAGIC.length);
  return out;
}

export function decodeProjectPayload(data: Uint8Array): unknown | null {
  if (data.length < 2 + MAGIC.length || data[0] !== MFR_ID) return null;
  for (let i = 0; i < MAGIC.length; i++) if (data[1 + i] !== MAGIC.charCodeAt(i)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data.subarray(1 + MAGIC.length)));
    return parsed && typeof parsed === 'object' ? (parsed as { project?: unknown }).project ?? null : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TULIS: proyek -> berkas MIDI (dipakai tombol "Simpan Proyek")
// ---------------------------------------------------------------------------
const DRUM_NOTE_MAP: Record<string, number> = {
  kick: 36,
  snare: 38,
  clap: 39,
  closedhat: 42,
  openhat: 46,
  tom: 45,
  splash: 55,
  ride: 51,
  perc: 60,
  fx: 39,
};

export function projectToMidiBlob(project: PadProject, title = 'PlayMuzeck Project'): Blob {
  const [numStr, denStr] = project.timeSig.split('/');
  const timeSignature = { num: Number(numStr) || 4, den: Number(denStr) || 4 };

  const events: Array<{ step: number; note: number; velocity?: number; durationSteps?: number; isDrum?: boolean; channel?: number }> = [];

  Object.keys(project.drum).forEach((id) => {
    const note = DRUM_NOTE_MAP[id] ?? 36;
    const row = project.drum[id];
    for (let i = 0; i < row.length; i++) {
      const level = row.charCodeAt(i) - 48;
      if (level >= 1 && level <= 4) {
        events.push({ step: i, note, velocity: DRUM_LEVEL_MIDI[level], isDrum: true, durationSteps: 1 });
      }
    }
  });

  const enabled = project.chords.filter((t) => t.on);
  enabled.forEach((track, channel) => {
    track.notes.forEach(([start, len, pad]) => {
      const def = project.pads[pad];
      if (!def) return;
      buildHarmonicChord(tupleToPad(def)).midiNotes.forEach((note) => {
        events.push({
          step: start,
          note,
          velocity: Math.max(1, Math.round((95 * track.vol) / 100)),
          durationSteps: len,
          channel,
        });
      });
    });
  });

  const programs = enabled.map((t) => t.program);
  return generateMidiFile(project.bpm, events, title, programs[0] ?? 0, programs[1], timeSignature, encodeProjectPayload(project), programs);
}

// ---------------------------------------------------------------------------
// BACA: berkas MIDI standar (format 0 / 1 / 2, PPQ)
// ---------------------------------------------------------------------------
export interface ParsedMidiNote {
  ch: number;
  note: number;
  vel: number;
  tick: number;
  dur: number;
}

export interface ParsedMidi {
  format: number;
  division: number; // tick per not seperempat
  notes: ParsedMidiNote[];
  tempos: Array<{ tick: number; mpqn: number }>;
  timeSigs: Array<{ tick: number; num: number; den: number }>;
  programs: Record<number, number>; // program pertama per channel
  payload?: Uint8Array;
  warnings: string[];
}

const ascii = (d: Uint8Array, at: number, n: number) => String.fromCharCode(...Array.from(d.subarray(at, at + n)));

export function parseMidiFile(buf: ArrayBuffer): ParsedMidi {
  const d = new Uint8Array(buf);
  if (d.length < 14 || ascii(d, 0, 4) !== 'MThd') {
    throw new MidiProjectError('Ini bukan berkas MIDI yang valid (header MThd tidak ditemukan).');
  }
  const u16 = (p: number) => (d[p] << 8) | d[p + 1];
  const u32 = (p: number) => ((d[p] << 24) | (d[p + 1] << 16) | (d[p + 2] << 8) | d[p + 3]) >>> 0;
  const headerLen = u32(4);
  const format = u16(8);
  const division = u16(12);
  if (division & 0x8000) throw new MidiProjectError('MIDI dengan timing SMPTE belum didukung. Gunakan MIDI berbasis PPQ (standar DAW).');
  if (division === 0) throw new MidiProjectError('Berkas MIDI rusak (resolusi waktu 0).');

  const out: ParsedMidi = { format, division, notes: [], tempos: [], timeSigs: [], programs: {}, warnings: [] };
  let pos = 8 + headerLen;
  let damaged = false;

  while (pos + 8 <= d.length) {
    const id = ascii(d, pos, 4);
    const len = u32(pos + 4);
    const start = pos + 8;
    const end = Math.min(d.length, start + len);
    pos = end;
    if (id !== 'MTrk') continue;

    let p = start;
    let tick = 0;
    let running = 0;
    const open = new Map<number, Array<{ tick: number; vel: number }>>();
    const readVar = (): number => {
      let v = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= end) throw new Error('eof');
        const b = d[p++];
        v = (v << 7) | (b & 0x7f);
        if (!(b & 0x80)) return v;
      }
      throw new Error('varint');
    };
    const closeNote = (ch: number, note: number, at: number) => {
      const stack = open.get(ch * 128 + note);
      const on = stack?.shift();
      if (on) out.notes.push({ ch, note, vel: on.vel, tick: on.tick, dur: Math.max(1, at - on.tick) });
    };

    try {
      while (p < end) {
        tick += readVar();
        if (p >= end) break;
        let status = d[p];
        if (status & 0x80) {
          p++;
          if (status < 0xf0) running = status;
        } else {
          if (!running) throw new Error('running');
          status = running;
        }

        if (status === 0xff) {
          running = 0;
          const type = d[p++];
          const mlen = readVar();
          const data = d.subarray(p, p + mlen);
          p += mlen;
          if (type === 0x51 && mlen === 3) out.tempos.push({ tick, mpqn: (data[0] << 16) | (data[1] << 8) | data[2] });
          else if (type === 0x58 && mlen >= 2) out.timeSigs.push({ tick, num: data[0], den: 2 ** data[1] });
          else if (type === 0x7f && !out.payload && decodeProjectPayload(data) !== null) out.payload = new Uint8Array(data);
          else if (type === 0x2f) break;
        } else if (status === 0xf0 || status === 0xf7) {
          running = 0;
          p += readVar();
        } else {
          const hi = status & 0xf0;
          const ch = status & 0x0f;
          const d1 = d[p++];
          const d2 = hi === 0xc0 || hi === 0xd0 ? 0 : d[p++];
          if (hi === 0x90 && d2 > 0) {
            const key = ch * 128 + d1;
            const stack = open.get(key) ?? [];
            stack.push({ tick, vel: d2 });
            open.set(key, stack);
          } else if (hi === 0x80 || hi === 0x90) {
            closeNote(ch, d1, tick);
          } else if (hi === 0xc0 && out.programs[ch] === undefined) {
            out.programs[ch] = d1 & 0x7f;
          }
        }
      }
    } catch {
      damaged = true;
    }

    // Nada yang tidak pernah dimatikan: beri panjang minimal 1 step.
    open.forEach((stack, key) => {
      stack.forEach((on) =>
        out.notes.push({ ch: Math.floor(key / 128), note: key % 128, vel: on.vel, tick: on.tick, dur: Math.max(1, Math.round(division / 4)) })
      );
    });
  }

  if (damaged) out.warnings.push('Sebagian isi berkas rusak atau terpotong; bagian yang bisa dibaca tetap diimpor.');
  out.notes.sort((a, b) => a.tick - b.tick || a.note - b.note);
  return out;
}

// ---------------------------------------------------------------------------
// VALIDASI proyek (dari berkas apa pun — jangan percaya isinya)
// ---------------------------------------------------------------------------
const clampNum = (v: unknown, min: number, max: number, fb: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fb;
};
const clampInt = (v: unknown, min: number, max: number, fb: number): number => Math.round(clampNum(v, min, max, fb));

const cleanAdsr = (raw: unknown, ranges: Range4, fb: Adsr4): Adsr4 => {
  const a = Array.isArray(raw) ? raw : [];
  return [0, 1, 2, 3].map((i) => clampNum(a[i], ranges[i][0], ranges[i][1], fb[i])) as Adsr4;
};

export function normalizeProject(raw: unknown, ctx: ImportContext): PadProject {
  if (!raw || typeof raw !== 'object') throw new MidiProjectError('Data proyek di dalam berkas tidak valid.');
  const r = raw as Record<string, any>;

  const ts = ctx.timeSigs.find((t) => t.id === r.timeSig) ?? ctx.timeSigs.find((t) => t.id === '4/4') ?? ctx.timeSigs[0];
  const totalSteps = ts.steps * ctx.totalBars;

  const pads: PadTuple[] = ctx.defaultPads.map((def, i) => {
    const t = Array.isArray(r.pads) ? r.pads[i] : undefined;
    if (!Array.isArray(t)) return padToTuple(def);
    const root = NOTE_ROOTS.includes(t[0]) ? t[0] : def.root;
    const type = CHORD_QUALITIES.includes(t[1]) ? t[1] : def.type;
    const tension = CHORD_TENSIONS.includes(t[2]) ? t[2] : 'none';
    const bass = t[3] === 'none' || NOTE_ROOTS.includes(t[3]) ? t[3] : 'none';
    return [root, type, tension, bass, clampInt(t[4], 0, 3, 0), clampInt(t[5], -2, 2, 0)] as PadTuple;
  });

  const drum: Record<string, string> = {};
  const drumMix: Record<string, ProjectDrumMix> = {};
  ctx.drumIds.forEach((id) => {
    const src = typeof r.drum?.[id] === 'string' ? (r.drum[id] as string) : '';
    let row = '';
    for (let i = 0; i < totalSteps; i++) {
      const c = src.charCodeAt(i) - 48;
      row += c >= 1 && c <= 4 ? String(c) : '0';
    }
    drum[id] = row;
    const m = r.drumMix?.[id] ?? {};
    drumMix[id] = {
      v: clampInt(m.v, 0, 100, 100),
      m: m.m === true,
      s: m.s === true,
      a: cleanAdsr(m.a, ctx.drumAdsrRanges, ctx.drumAdsr),
    };
  });

  const chords: ProjectChordTrack[] = ctx.chordDefaults.map((def, i) => {
    const t = Array.isArray(r.chords) ? r.chords[i] ?? {} : {};
    const notes: Array<[number, number, number]> = [];
    if (Array.isArray(t.notes)) {
      t.notes.forEach((n: unknown) => {
        if (!Array.isArray(n)) return;
        const start = Number(n[0]);
        const pad = Number(n[2]);
        if (!Number.isFinite(start) || start < 0 || start >= totalSteps) return;
        if (!Number.isFinite(pad) || pad < 0 || pad >= pads.length) return;
        notes.push([Math.round(start), clampInt(n[1], 1, totalSteps, 1), Math.round(pad)]);
      });
    }
    notes.sort((a, b) => a[0] - b[0]);
    return {
      id: i + 1,
      label: typeof t.label === 'string' && t.label.trim() ? t.label.slice(0, 40) : def.label,
      on: i === 0 ? true : t.on === true,
      program: clampInt(t.program, 0, 127, 0),
      vol: clampInt(t.vol, 0, 100, def.volume),
      m: t.m === true,
      s: t.s === true,
      a: cleanAdsr(t.a, ctx.chordAdsrRanges, def.adsr),
      notes,
    };
  });

  const bars = ctx.totalBars;
  const loop = r.loop ?? {};
  const bpmMin = ctx.bpmRange[0];
  const bpmMax = ctx.bpmRange[1];
  return {
    bpm: clampInt(r.bpm, bpmMin, bpmMax, 115),
    timeSig: ts.id,
    kit: ctx.kits.includes(r.kit) ? r.kit : ctx.defaultKit,
    drumVolume: clampInt(r.drumVolume, 0, 100, 85),
    chordVolume: clampInt(r.chordVolume, 0, 100, 80),
    barsPerView: ctx.barsPerViewOptions.includes(r.barsPerView) ? r.barsPerView : ctx.defaultBarsPerView(ts.steps),
    newChordLen: clampInt(r.newChordLen, 1, totalSteps, ts.steps),
    loop: {
      sb: clampInt(loop.sb, 1, bars, 1),
      sbt: clampInt(loop.sbt, 1, ts.steps, 1),
      eb: clampInt(loop.eb, 1, bars, Math.min(4, bars)),
      ebt: clampInt(loop.ebt, 1, ts.steps, ts.steps),
    },
    pads,
    drum,
    drumMix,
    chords,
  };
}

// ---------------------------------------------------------------------------
// IMPOR MIDI DARI LUAR (tanpa data proyek Pad Studio)
// ---------------------------------------------------------------------------
// Pemetaan nada drum General MIDI -> instrumen Pad Studio.
const GM_DRUM_MAP: Record<number, string> = {};
const mapGm = (id: string, notes: number[]) => notes.forEach((n) => (GM_DRUM_MAP[n] = id));
mapGm('kick', [35, 36]);
mapGm('snare', [37, 38, 40]);
mapGm('clap', [39]);
mapGm('closedhat', [42, 44]);
mapGm('openhat', [46]);
mapGm('tom', [41, 43, 45, 47, 48, 50]);
mapGm('splash', [49, 52, 55, 57]);
mapGm('ride', [51, 53, 59]);
mapGm('perc', [54, 56, 58, ...Array.from({ length: 22 }, (_, i) => 60 + i)]);

// Velocity MIDI -> level 1–4 (batas di tengah-tengah nilai ekspor 45 / 75 / 100 / 127).
const levelFromVelocity = (v: number): number => (v < 60 ? 1 : v < 88 ? 2 : v < 114 ? 3 : 4);

interface FormulaEntry {
  def: ChordFormulaDef;
  notes: number[];
  key: string;
}
let formulaTable: { byKey: Map<string, FormulaEntry>; all: FormulaEntry[] } | null = null;

// Semua kombinasi formula (tanpa slash-bass), diurutkan dari yang paling sederhana supaya kecocokan pertama = paling polos.
function getFormulaTable() {
  if (formulaTable) return formulaTable;
  const byKey = new Map<string, FormulaEntry>();
  const all: FormulaEntry[] = [];
  for (const tension of CHORD_TENSIONS) {
    for (const inversion of [0, 1, 2, 3]) {
      for (const octaveOffset of [0, -1, 1, -2, 2]) {
        for (const type of CHORD_QUALITIES) {
          const isDyad = type.startsWith('dyad');
          if (isDyad && (tension !== 'none' || inversion > 1)) continue;
          for (const root of NOTE_ROOTS) {
            const def: ChordFormulaDef = { root, type, tension, bass: 'none', inversion, octaveOffset };
            const notes = buildHarmonicChord(def).midiNotes;
            const key = notes.join(',');
            if (byKey.has(key)) continue;
            const entry = { def, notes, key };
            byKey.set(key, entry);
            all.push(entry);
          }
        }
      }
    }
  }
  formulaTable = { byKey, all };
  return formulaTable;
}

// Formula terdekat untuk sekumpulan nada (kemiripan Jaccard pada nomor MIDI, lalu pada kelas nada).
function closestFormula(notes: number[]): { entry: FormulaEntry; exact: boolean } {
  const table = getFormulaTable();
  const exact = table.byKey.get(notes.join(','));
  if (exact) return { entry: exact, exact: true };
  const q = new Set(notes);
  const qc = new Set(notes.map((n) => n % 12));
  let best = table.all[0];
  let bestScore = -1;
  for (const e of table.all) {
    let inter = 0;
    for (const n of e.notes) if (q.has(n)) inter++;
    const union = q.size + e.notes.length - inter;
    let interC = 0;
    const ec = new Set(e.notes.map((n) => n % 12));
    ec.forEach((c) => {
      if (qc.has(c)) interC++;
    });
    const unionC = qc.size + ec.size - interC;
    const score = inter / union + 0.5 * (interC / unionC);
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return { entry: best, exact: false };
}

export interface ForeignImportResult {
  project: PadProject;
  warnings: string[];
  stats: { drumHits: number; chords: number; approximated: number };
}

export function convertForeignMidi(m: ParsedMidi, ctx: ImportContext): ForeignImportResult {
  const warnings: string[] = [...m.warnings];

  // Tempo & birama (memakai yang pertama).
  const mpqn = m.tempos[0]?.mpqn || 500000;
  let bpm = Math.round(60000000 / mpqn);
  if (m.tempos.length > 1) warnings.push('Berkas ini punya perubahan tempo; hanya tempo pertama yang dipakai.');
  if (bpm < ctx.bpmRange[0] || bpm > ctx.bpmRange[1]) {
    warnings.push(`Tempo ${bpm} BPM di luar rentang editor, disesuaikan menjadi ${Math.max(ctx.bpmRange[0], Math.min(ctx.bpmRange[1], bpm))} BPM.`);
    bpm = Math.max(ctx.bpmRange[0], Math.min(ctx.bpmRange[1], bpm));
  }
  const sig = m.timeSigs[0];
  let ts = sig ? ctx.timeSigs.find((t) => t.num === sig.num && t.den === sig.den) : undefined;
  if (sig && !ts) warnings.push(`Birama ${sig.num}/${sig.den} belum tersedia di editor, dipakai 4/4.`);
  if (!ts) ts = ctx.timeSigs.find((t) => t.id === '4/4') ?? ctx.timeSigs[0];
  if (m.timeSigs.length > 1) warnings.push('Berkas ini punya perubahan birama; hanya birama pertama yang dipakai.');

  const S = ts.steps;
  const totalSteps = S * ctx.totalBars;
  const ticksPerStep = m.division / 4;
  const toStep = (tick: number) => Math.round(tick / ticksPerStep);

  // --- Drum (channel 10) ---
  const rows: Record<string, number[]> = {};
  ctx.drumIds.forEach((id) => (rows[id] = Array(totalSteps).fill(0)));
  let drumHits = 0;
  let drumUnmapped = 0;
  let outOfRange = 0;
  let lastStep = 0;
  m.notes
    .filter((n) => n.ch === 9)
    .forEach((n) => {
      const id = GM_DRUM_MAP[n.note];
      if (!id || !rows[id]) {
        drumUnmapped++;
        return;
      }
      const step = toStep(n.tick);
      if (step >= totalSteps) {
        outOfRange++;
        return;
      }
      const level = levelFromVelocity(n.vel);
      if (level > rows[id][step]) rows[id][step] = level;
      drumHits++;
      lastStep = Math.max(lastStep, step);
    });
  if (drumUnmapped > 0) warnings.push(`${drumUnmapped} pukulan drum dilewati karena alatnya tidak ada di Pad Studio.`);

  // --- Akor (channel selain 10) ---
  type Group = { step: number; notes: Set<number>; dur: number };
  const byChannel = new Map<number, Map<number, Group>>();
  m.notes
    .filter((n) => n.ch !== 9)
    .forEach((n) => {
      const step = toStep(n.tick);
      if (step >= totalSteps) {
        outOfRange++;
        return;
      }
      const groups = byChannel.get(n.ch) ?? new Map<number, Group>();
      const g = groups.get(step) ?? { step, notes: new Set<number>(), dur: 0 };
      g.notes.add(n.note);
      g.dur = Math.max(g.dur, n.dur);
      groups.set(step, g);
      byChannel.set(n.ch, groups);
    });
  if (outOfRange > 0) warnings.push(`${outOfRange} nada berada di luar ${ctx.totalBars} bar pertama dan dilewati.`);

  let singles = 0;
  const channelChords = Array.from(byChannel.entries())
    .map(([ch, groups]) => {
      const chordGroups = Array.from(groups.values())
        .filter((g) => {
          if (g.notes.size >= 2) return true;
          singles++;
          return false;
        })
        .sort((a, b) => a.step - b.step);
      return { ch, groups: chordGroups };
    })
    .filter((c) => c.groups.length > 0)
    .sort((a, b) => a.ch - b.ch);
  if (singles > 0) warnings.push(`${singles} nada tunggal (melodi/bass) dilewati: Chord Pad hanya memutar akor (2 nada atau lebih sekaligus).`);
  if (channelChords.length > ctx.chordDefaults.length) {
    warnings.push(`Ada ${channelChords.length} channel akor; hanya ${ctx.chordDefaults.length} pertama yang dimuat.`);
  }
  const usedChannels = channelChords.slice(0, ctx.chordDefaults.length);

  // Cocokkan tiap akor ke pad: pakai pad bawaan yang persis sama, kalau tidak ada pasang formula terdekat di slot bebas.
  const pads = ctx.defaultPads.map(padToTuple);
  const keyToPad = new Map<string, number>();
  ctx.defaultPads.forEach((def, i) => {
    const key = buildHarmonicChord(def).midiNotes.join(',');
    if (!keyToPad.has(key)) keyToPad.set(key, i);
  });
  const taken = new Set<number>();
  let approximated = 0;
  let nextFree = pads.length - 1;
  const allocSlot = (): number => {
    while (nextFree >= 0 && taken.has(nextFree)) nextFree--;
    return nextFree >= 0 ? nextFree-- : -1;
  };

  const padFor = (notes: number[]): number => {
    const key = notes.join(',');
    const known = keyToPad.get(key);
    if (known !== undefined) {
      taken.add(known);
      return known;
    }
    const { entry, exact } = closestFormula(notes);
    const sameFormula = keyToPad.get(entry.key);
    if (sameFormula !== undefined) {
      taken.add(sameFormula);
      keyToPad.set(key, sameFormula);
      if (!exact) approximated++;
      return sameFormula;
    }
    const slot = allocSlot();
    if (slot < 0) return 0;
    keyToPad.forEach((v, k) => {
      if (v === slot) keyToPad.delete(k);
    });
    pads[slot] = padToTuple(entry.def);
    keyToPad.set(entry.key, slot);
    keyToPad.set(key, slot);
    taken.add(slot);
    if (!exact) approximated++;
    return slot;
  };

  // Pad bawaan yang cocok persis harus "diambil" dulu supaya slot baru tidak menimpanya.
  usedChannels.forEach((c) =>
    c.groups.forEach((g) => {
      const known = keyToPad.get(Array.from(g.notes).sort((a, b) => a - b).join(','));
      if (known !== undefined) taken.add(known);
    })
  );

  let chordCount = 0;
  const chords: ProjectChordTrack[] = ctx.chordDefaults.map((def, i) => {
    const src = usedChannels[i];
    let steps = emptyTrackData(totalSteps).steps;
    let lens = emptyTrackData(totalSteps).lens;
    if (src) {
      src.groups.forEach((g) => {
        const pad = padFor(Array.from(g.notes).sort((a, b) => a - b));
        const len = Math.max(1, Math.round(g.dur / ticksPerStep));
        ({ steps, lens } = insertNote(steps, lens, g.step, pad, len));
        chordCount++;
        lastStep = Math.max(lastStep, g.step + len - 1);
      });
    }
    const notes: Array<[number, number, number]> = [];
    steps.forEach((pad, step) => {
      if (pad >= 0) notes.push([step, lens[step] || 1, pad]);
    });
    return {
      id: i + 1,
      label: def.label,
      on: i === 0 || Boolean(src),
      program: src ? m.programs[src.ch] ?? def.program : def.program,
      vol: def.volume,
      m: false,
      s: false,
      a: def.adsr,
      notes,
    };
  });
  if (approximated > 0) {
    warnings.push(`${approximated} akor tidak persis sama dengan formula Pad Studio; dipakai formula terdekat.`);
  }

  if (drumHits === 0 && chordCount === 0) {
    throw new MidiProjectError('Tidak ada drum (channel 10) atau akor (2 nada serentak) yang bisa diimpor dari berkas ini.');
  }

  const endBar = Math.max(1, Math.min(ctx.totalBars, Math.floor(lastStep / S) + 1));
  const drum: Record<string, string> = {};
  const drumMix: Record<string, ProjectDrumMix> = {};
  ctx.drumIds.forEach((id) => {
    drum[id] = rows[id].join('');
    drumMix[id] = { v: 100, m: false, s: false, a: ctx.drumAdsr };
  });

  const project: PadProject = {
    bpm,
    timeSig: ts.id,
    kit: ctx.defaultKit,
    drumVolume: 85,
    chordVolume: 80,
    barsPerView: ctx.defaultBarsPerView(S),
    newChordLen: S,
    loop: { sb: 1, sbt: 1, eb: endBar, ebt: S },
    pads,
    drum,
    drumMix,
    chords,
  };
  return { project, warnings, stats: { drumHits, chords: chordCount, approximated } };
}

// Pintu masuk tunggal: ArrayBuffer berkas .mid -> proyek siap dimuat.
export function importMidiBuffer(
  buf: ArrayBuffer,
  ctx: ImportContext
): { project: PadProject; warnings: string[]; source: 'project' | 'foreign'; summary: string } {
  const parsed = parseMidiFile(buf);
  if (parsed.payload) {
    const raw = decodeProjectPayload(parsed.payload);
    const project = normalizeProject(raw, ctx);
    return { project, warnings: parsed.warnings, source: 'project', summary: 'Proyek Pad Studio dipulihkan utuh.' };
  }
  const res = convertForeignMidi(parsed, ctx);
  const project = normalizeProject(res.project, ctx);
  return {
    project,
    warnings: res.warnings,
    source: 'foreign',
    summary: `Impor MIDI: ${res.stats.drumHits} pukulan drum dan ${res.stats.chords} akor.`,
  };
}
