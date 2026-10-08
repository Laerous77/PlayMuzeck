// src/services/audioMetadata.ts
// Baca & tulis metadata (tag) berkas audio TANPA mengubah datanya: audio TIDAK di-decode dan TIDAK di-encode ulang,
// jadi kualitasnya identik dan prosesnya instan. Hanya blok tag yang diganti; sisanya disalin byte demi byte.
//
// Format yang didukung:
//  - MP3   : ID3v2 (dibaca v2.2/2.3/2.4, ditulis v2.3 agar cocok di pemutar lama). ID3v1 yang sudah ada ikut disegarkan.
//  - FLAC  : Vorbis Comment + blok PICTURE.
//  - WAV   : LIST/INFO (terbaca di Windows) + chunk "id3 " (cover, lirik, dan semua kolom).
//  - M4A / MP4 / AAC : atom iTunes (moov/udta/meta/ilst). Offset chunk (stco/co64) disesuaikan otomatis.
//
// Tag di luar daftar kolom yang dikelola (mis. ReplayGain, SYLT, atom iTunes khusus, foto cover tambahan)
// DIPERTAHANKAN apa adanya.

export type MetaFormat = 'mp3' | 'flac' | 'wav' | 'm4a';

export interface AudioPicture {
  mime: string;
  data: Uint8Array;
  width?: number;
  height?: number;
}

export interface AudioTags {
  title: string;
  artist: string;
  album: string;
  albumArtist: string;
  composer: string;
  genre: string;
  /** "2024" atau "2024-05-17". */
  date: string;
  track: string;
  trackTotal: string;
  disc: string;
  discTotal: string;
  bpm: string;
  publisher: string;
  copyright: string;
  isrc: string;
  grouping: string;
  comment: string;
  lyrics: string;
  cover: AudioPicture | null;
}

export type TextField = Exclude<keyof AudioTags, 'cover'>;

export const TEXT_FIELDS: readonly TextField[] = [
  'title', 'artist', 'album', 'albumArtist', 'composer', 'genre', 'date', 'track', 'trackTotal', 'disc', 'discTotal',
  'bpm', 'publisher', 'copyright', 'isrc', 'grouping', 'comment', 'lyrics',
] as const;

export const emptyTags = (): AudioTags => ({
  title: '', artist: '', album: '', albumArtist: '', composer: '', genre: '', date: '', track: '', trackTotal: '',
  disc: '', discTotal: '', bpm: '', publisher: '', copyright: '', isrc: '', grouping: '', comment: '', lyrics: '', cover: null,
});

export interface AudioTechInfo {
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  durationSec?: number;
}

export interface ReadResult {
  format: MetaFormat;
  tags: AudioTags;
  info: AudioTechInfo;
  /** Jumlah kolom tag di berkas yang tidak dikelola editor ini, tetapi akan dipertahankan. */
  preservedCount: number;
}

export class MetadataError extends Error {}

export const FORMAT_LABEL: Record<MetaFormat, string> = { mp3: 'MP3', flac: 'FLAC', wav: 'WAV', m4a: 'M4A / MP4' };

/** Batas ukuran berkas & cover yang dibaca editor (berkas dibaca utuh ke memori). */
export const MAX_FILE_BYTES = 300 * 1024 * 1024;
export const MAX_COVER_BYTES = 8 * 1024 * 1024;

// ───────────────────────── utilitas byte ─────────────────────────

const te = new TextEncoder();
const td8 = new TextDecoder('utf-8');

const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u16be = (b: Uint8Array, o: number) => (b[o] << 8) | b[o + 1];
const syncsafe = (b: Uint8Array, o: number) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);

const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const be16 = (n: number) => new Uint8Array([(n >>> 8) & 255, n & 255]);
const toSyncsafe = (n: number) => new Uint8Array([(n >>> 21) & 0x7f, (n >>> 14) & 0x7f, (n >>> 7) & 0x7f, n & 0x7f]);

const ascii = (b: Uint8Array, o: number, n: number) => {
  let s = '';
  for (let i = 0; i < n && o + i < b.length; i++) s += String.fromCharCode(b[o + i]);
  return s;
};
const asciiBytes = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
};

export function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const decodeLatin1 = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return s;
};

function decodeUtf16(b: Uint8Array, defaultLE: boolean | null): string {
  let le = defaultLE;
  let start = 0;
  if (b.length >= 2) {
    if (b[0] === 0xff && b[1] === 0xfe) { le = true; start = 2; }
    else if (b[0] === 0xfe && b[1] === 0xff) { le = false; start = 2; }
  }
  if (le === null) le = false;
  let s = '';
  for (let i = start; i + 1 < b.length; i += 2) {
    s += String.fromCharCode(le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
  }
  return s;
}

const stripNul = (s: string) => s.replace(/\u0000+$/g, '');
const normNewlines = (s: string) => s.replace(/\r\n?/g, '\n');

/** Teks ID3 menurut byte encoding: 0 Latin-1, 1 UTF-16 (BOM), 2 UTF-16BE, 3 UTF-8. */
function decodeId3Text(enc: number, b: Uint8Array): string {
  if (enc === 1) return stripNul(decodeUtf16(b, null));
  if (enc === 2) return stripNul(decodeUtf16(b, false));
  if (enc === 3) return stripNul(td8.decode(b));
  return stripNul(decodeLatin1(b));
}

/** Cari terminator string menurut encoding mulai dari `from`; kembalikan indeks awal terminator (atau -1). */
function findTerminator(b: Uint8Array, from: number, enc: number): number {
  if (enc === 1 || enc === 2) {
    for (let i = from; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return -1;
  }
  for (let i = from; i < b.length; i++) if (b[i] === 0) return i;
  return -1;
}
const termLen = (enc: number) => (enc === 1 || enc === 2 ? 2 : 1);

const clean = (s: string) => s.replace(/\u0000/g, '').trim();

// ───────────────────────── gambar ─────────────────────────

/** Kenali PNG/JPEG/GIF/WebP/BMP dari byte awal dan ambil ukurannya bila bisa. */
export function sniffImage(b: Uint8Array): { mime: string; width?: number; height?: number } | null {
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { mime: 'image/png', width: u32be(b, 16), height: u32be(b, 20) };
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      const len = u16be(b, i + 2);
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { mime: 'image/jpeg', height: u16be(b, i + 5), width: u16be(b, i + 7) };
      }
      i += 2 + len;
    }
    return { mime: 'image/jpeg' };
  }
  if (b.length >= 10 && ascii(b, 0, 3) === 'GIF') {
    return { mime: 'image/gif', width: b[6] | (b[7] << 8), height: b[8] | (b[9] << 8) };
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { mime: 'image/webp' };
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) {
    return { mime: 'image/bmp', width: u32le(b, 18), height: u32le(b, 22) };
  }
  return null;
}

const normalizeMime = (mime: string, data: Uint8Array): string => {
  const sn = sniffImage(data);
  if (sn) return sn.mime;
  const m = mime.toLowerCase().trim();
  if (m === 'jpg' || m === 'image/jpg' || m === 'jpeg') return 'image/jpeg';
  if (m === 'png') return 'image/png';
  return m.includes('/') ? m : 'image/jpeg';
};

const makePicture = (mime: string, data: Uint8Array): AudioPicture => {
  const sn = sniffImage(data);
  return { mime: sn?.mime ?? normalizeMime(mime, data), data, width: sn?.width, height: sn?.height };
};

// ───────────────────────── genre ID3v1 ─────────────────────────

export const ID3V1_GENRES: readonly string[] = [
  'Blues', 'Classic Rock', 'Country', 'Dance', 'Disco', 'Funk', 'Grunge', 'Hip-Hop', 'Jazz', 'Metal', 'New Age', 'Oldies',
  'Other', 'Pop', 'R&B', 'Rap', 'Reggae', 'Rock', 'Techno', 'Industrial', 'Alternative', 'Ska', 'Death Metal', 'Pranks',
  'Soundtrack', 'Euro-Techno', 'Ambient', 'Trip-Hop', 'Vocal', 'Jazz+Funk', 'Fusion', 'Trance', 'Classical', 'Instrumental',
  'Acid', 'House', 'Game', 'Sound Clip', 'Gospel', 'Noise', 'AlternRock', 'Bass', 'Soul', 'Punk', 'Space', 'Meditative',
  'Instrumental Pop', 'Instrumental Rock', 'Ethnic', 'Gothic', 'Darkwave', 'Techno-Industrial', 'Electronic', 'Pop-Folk',
  'Eurodance', 'Dream', 'Southern Rock', 'Comedy', 'Cult', 'Gangsta', 'Top 40', 'Christian Rap', 'Pop/Funk', 'Jungle',
  'Native American', 'Cabaret', 'New Wave', 'Psychadelic', 'Rave', 'Showtunes', 'Trailer', 'Lo-Fi', 'Tribal', 'Acid Punk',
  'Acid Jazz', 'Polka', 'Retro', 'Musical', 'Rock & Roll', 'Hard Rock', 'Folk', 'Folk-Rock', 'National Folk', 'Swing',
  'Fast Fusion', 'Bebop', 'Latin', 'Revival', 'Celtic', 'Bluegrass', 'Avantgarde', 'Gothic Rock', 'Progressive Rock',
  'Psychedelic Rock', 'Symphonic Rock', 'Slow Rock', 'Big Band', 'Chorus', 'Easy Listening', 'Acoustic', 'Humour', 'Speech',
  'Chanson', 'Opera', 'Chamber Music', 'Sonata', 'Symphony', 'Booty Bass', 'Primus', 'Porn Groove', 'Satire', 'Slow Jam',
  'Club', 'Tango', 'Samba', 'Folklore', 'Ballad', 'Power Ballad', 'Rhythmic Soul', 'Freestyle', 'Duet', 'Punk Rock',
  'Drum Solo', 'A capella', 'Euro-House', 'Dance Hall',
];

/** Saran genre populer untuk daftar isian (bukan batasan: pengguna boleh mengetik bebas). */
export const GENRE_SUGGESTIONS: readonly string[] = [
  'Pop', 'Rock', 'Hip-Hop', 'R&B', 'Jazz', 'Blues', 'Classical', 'Country', 'Electronic', 'Dance', 'Reggae', 'Folk', 'Metal',
  'Punk', 'Soul', 'Funk', 'Disco', 'Indie', 'Alternative', 'Ambient', 'Lo-Fi', 'Soundtrack', 'Instrumental', 'Acoustic',
  'Gospel', 'Latin', 'K-Pop', 'J-Pop', 'Dangdut', 'Keroncong', 'Campursari', 'Pop Indonesia', 'Podcast', 'Audiobook',
];

/** "(17)", "(17)Rock", "17" -> nama genre; selain itu dikembalikan apa adanya. */
export function resolveGenre(raw: string): string {
  const s = raw.trim();
  const m = /^\((\d{1,3})\)\s*(.*)$/.exec(s);
  if (m) {
    if (m[2]) return m[2];
    return ID3V1_GENRES[Number(m[1])] ?? '';
  }
  if (/^\d{1,3}$/.test(s)) return ID3V1_GENRES[Number(s)] ?? s;
  return s;
}

// ───────────────────────── deteksi format ─────────────────────────

export function detectFormat(b: Uint8Array): MetaFormat | null {
  if (b.length < 12) return null;
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return 'wav';
  if (ascii(b, 4, 4) === 'ftyp') return 'm4a';
  if (ascii(b, 0, 3) === 'ID3') {
    // FLAC dengan ID3 di depan
    const size = 10 + syncsafe(b, 6);
    if (size + 4 <= b.length && ascii(b, size, 4) === 'fLaC') return 'flac';
    return 'mp3';
  }
  // MP3 tanpa ID3: cari sinkronisasi frame (11 bit 1) dalam 64 KB pertama
  const lim = Math.min(b.length - 3, 65536);
  for (let i = 0; i < lim; i++) {
    if (b[i] === 0xff && (b[i + 1] & 0xe0) === 0xe0) {
      const ver = (b[i + 1] >> 3) & 3;
      const layer = (b[i + 1] >> 1) & 3;
      const br = (b[i + 2] >> 4) & 15;
      const sr = (b[i + 2] >> 2) & 3;
      if (ver !== 1 && layer !== 0 && br !== 15 && br !== 0 && sr !== 3) return 'mp3';
    }
  }
  return null;
}

// ═════════════════════════════════════════════════════════════
//  ID3v2
// ═════════════════════════════════════════════════════════════

interface Id3Frame { id: string; data: Uint8Array }
interface Id3Parsed {
  version: number;          // 2, 3, atau 4
  frames: Id3Frame[];       // id sudah dinormalkan ke gaya v2.3/2.4 (4 huruf); frame tak dikenal v2.2 dibuang
  totalSize: number;        // ukuran tag di berkas, termasuk header 10 byte (dan footer bila ada)
}

const V22_TO_V23: Record<string, string> = {
  TT2: 'TIT2', TP1: 'TPE1', TAL: 'TALB', TP2: 'TPE2', TCM: 'TCOM', TCO: 'TCON', TYE: 'TYER', TDA: 'TDAT', TRK: 'TRCK',
  TPA: 'TPOS', TBP: 'TBPM', TPB: 'TPUB', TCR: 'TCOP', TRC: 'TSRC', COM: 'COMM', ULT: 'USLT', PIC: 'APIC', TT1: 'TIT1',
  TXX: 'TXXX', TLE: 'TLEN', TKE: 'TKEY', TLA: 'TLAN', TEN: 'TENC', TSS: 'TSSE', TOA: 'TOPE', TOT: 'TOAL', TT3: 'TIT3',
  TXT: 'TEXT', TMT: 'TMED', TCP: 'TCMP',
};

function deunsync(b: Uint8Array): Uint8Array {
  const out = new Uint8Array(b.length);
  let o = 0;
  for (let i = 0; i < b.length; i++) {
    out[o++] = b[i];
    if (b[i] === 0xff && i + 1 < b.length && b[i + 1] === 0x00) i++;
  }
  return out.subarray(0, o);
}

function parseId3(b: Uint8Array, start = 0): Id3Parsed | null {
  if (b.length < start + 10 || ascii(b, start, 3) !== 'ID3') return null;
  const version = b[start + 3];
  if (version < 2 || version > 4) return null;
  const flags = b[start + 5];
  const bodySize = syncsafe(b, start + 6);
  const hasFooter = version === 4 && (flags & 0x10) !== 0;
  const totalSize = 10 + bodySize + (hasFooter ? 10 : 0);
  let body = b.subarray(start + 10, Math.min(b.length, start + 10 + bodySize));
  const tagUnsync = (flags & 0x80) !== 0;
  if (tagUnsync && version !== 4) body = deunsync(body);
  let p = 0;
  if (version >= 3 && (flags & 0x40) !== 0 && body.length >= 4) {
    // header tambahan: lewati
    const ext = version === 4 ? syncsafe(body, 0) : u32be(body, 0) + 4;
    p = Math.min(body.length, ext);
  }
  const frames: Id3Frame[] = [];
  if (version === 2) {
    while (p + 6 <= body.length && body[p] !== 0) {
      const id = ascii(body, p, 3);
      const size = (body[p + 3] << 16) | (body[p + 4] << 8) | body[p + 5];
      p += 6;
      if (size < 0 || p + size > body.length) break;
      const mapped = V22_TO_V23[id];
      if (mapped) {
        let data = body.subarray(p, p + size);
        if (mapped === 'APIC' && data.length > 5) {
          // PIC: enc(1) + format(3) + type(1) + desc + data -> ubah ke APIC: enc + mime + 0 + type + desc + data
          const fmt = ascii(data, 1, 3).toUpperCase();
          const mime = fmt === 'PNG' ? 'image/png' : fmt === 'JPG' ? 'image/jpeg' : fmt.toLowerCase();
          data = concat([data.subarray(0, 1), asciiBytes(mime), new Uint8Array([0]), data.subarray(4)]);
        }
        frames.push({ id: mapped, data: data.slice() });
      }
      p += size;
    }
  } else {
    while (p + 10 <= body.length && body[p] !== 0) {
      const id = ascii(body, p, 4);
      if (!/^[A-Z0-9]{4}$/.test(id)) break;
      const size = version === 4 ? syncsafe(body, p + 4) : u32be(body, p + 4);
      const fl2 = body[p + 9];
      p += 10;
      if (p + size > body.length) break;
      let data = body.subarray(p, p + size);
      p += size;
      if (version === 4) {
        // v2.4: bit 0x40 grouping id, 0x08 kompresi, 0x04 enkripsi, 0x02 unsync, 0x01 data length indicator
        if (fl2 & (0x08 | 0x04)) continue;
        if (fl2 & 0x40) data = data.subarray(1);
        if (fl2 & 0x01) data = data.subarray(4);
        if ((fl2 & 0x02) || tagUnsync) data = deunsync(data);
      } else {
        // v2.3: bit 0x80 kompresi, 0x40 enkripsi, 0x20 grouping identity (byte flag kedua)
        if (fl2 & (0x80 | 0x40)) continue;
        if (fl2 & 0x20) data = data.subarray(1);
      }
      frames.push({ id, data: data.slice() });
    }
  }
  return { version, frames, totalSize };
}

function id3TextOf(frame: Id3Frame): string {
  const d = frame.data;
  if (d.length < 1) return '';
  const enc = d[0];
  const raw = d.subarray(1);
  // beberapa nilai dipisah NUL (v2.4); ambil semuanya
  if (enc === 1 || enc === 2) {
    const parts: string[] = [];
    let s = 0;
    for (let i = 0; i + 1 <= raw.length; i += 2) {
      if (i + 1 < raw.length && raw[i] === 0 && raw[i + 1] === 0) {
        parts.push(decodeId3Text(enc, raw.subarray(s, i)));
        s = i + 2;
      }
    }
    if (s < raw.length) parts.push(decodeId3Text(enc, raw.subarray(s)));
    return parts.filter((x) => x.length).join('; ');
  }
  const parts: string[] = [];
  let s = 0;
  for (let i = 0; i <= raw.length; i++) {
    if (i === raw.length || raw[i] === 0) {
      if (i > s) parts.push(decodeId3Text(enc, raw.subarray(s, i)));
      s = i + 1;
    }
  }
  return parts.join('; ');
}

/** Frame USLT/COMM: enc, bahasa(3), deskripsi (terminator), teks. */
function id3LangText(frame: Id3Frame): { lang: string; desc: string; text: string } {
  const d = frame.data;
  if (d.length < 5) return { lang: 'eng', desc: '', text: '' };
  const enc = d[0];
  const lang = ascii(d, 1, 3);
  const t = findTerminator(d, 4, enc);
  if (t < 0) return { lang, desc: '', text: decodeId3Text(enc, d.subarray(4)) };
  return { lang, desc: decodeId3Text(enc, d.subarray(4, t)), text: normNewlines(decodeId3Text(enc, d.subarray(t + termLen(enc)))) };
}

function id3Picture(frame: Id3Frame): { type: number; pic: AudioPicture } | null {
  const d = frame.data;
  if (d.length < 4) return null;
  const enc = d[0];
  const mEnd = d.indexOf(0, 1);
  if (mEnd < 0) return null;
  const mime = decodeLatin1(d.subarray(1, mEnd));
  const type = d[mEnd + 1];
  const t = findTerminator(d, mEnd + 2, enc);
  if (t < 0) return null;
  const data = d.subarray(t + termLen(enc));
  if (!data.length) return null;
  return { type, pic: makePicture(mime, data.slice()) };
}

const ID3_MANAGED = new Set(['TIT2', 'TPE1', 'TALB', 'TPE2', 'TCOM', 'TCON', 'TDRC', 'TYER', 'TDAT', 'TIME', 'TRCK', 'TPOS', 'TBPM',
  'TPUB', 'TCOP', 'TSRC', 'TIT1', 'COMM', 'USLT', 'APIC']);

function tagsFromId3(frames: Id3Frame[]): { tags: AudioTags; preserved: number } {
  const t = emptyTags();
  let preserved = 0;
  const firstText = (id: string) => {
    const f = frames.find((x) => x.id === id);
    return f ? clean(id3TextOf(f)) : '';
  };
  t.title = firstText('TIT2');
  t.artist = firstText('TPE1');
  t.album = firstText('TALB');
  t.albumArtist = firstText('TPE2');
  t.composer = firstText('TCOM');
  t.genre = resolveGenre(firstText('TCON'));
  t.publisher = firstText('TPUB');
  t.copyright = firstText('TCOP');
  t.isrc = firstText('TSRC');
  t.grouping = firstText('TIT1');
  t.bpm = firstText('TBPM').replace(/[^\d.]/g, '');

  const tdrc = firstText('TDRC');
  if (tdrc) t.date = tdrc.slice(0, 10);
  else {
    const yer = firstText('TYER');
    const dat = firstText('TDAT'); // DDMM
    t.date = yer;
    if (yer && /^\d{4}$/.test(dat)) t.date = `${yer}-${dat.slice(2, 4)}-${dat.slice(0, 2)}`;
  }
  const [trk, trkTot] = firstText('TRCK').split('/');
  t.track = (trk ?? '').trim(); t.trackTotal = (trkTot ?? '').trim();
  const [dsc, dscTot] = firstText('TPOS').split('/');
  t.disc = (dsc ?? '').trim(); t.discTotal = (dscTot ?? '').trim();

  const comms = frames.filter((f) => f.id === 'COMM').map(id3LangText);
  const mainComm = comms.find((c) => c.desc === '') ?? null;
  t.comment = mainComm ? mainComm.text : '';
  const lyr = frames.filter((f) => f.id === 'USLT').map(id3LangText);
  t.lyrics = (lyr.find((l) => l.desc === '') ?? lyr[0])?.text ?? '';

  const pics = frames.filter((f) => f.id === 'APIC').map(id3Picture).filter(Boolean) as { type: number; pic: AudioPicture }[];
  const front = pics.find((p) => p.type === 3) ?? pics.find((p) => p.type === 0) ?? pics[0];
  t.cover = front ? front.pic : null;

  for (const f of frames) {
    if (!ID3_MANAGED.has(f.id)) preserved++;
  }
  preserved += comms.filter((c) => c.desc !== '').length + Math.max(0, pics.length - (front ? 1 : 0));
  return { tags: t, preserved };
}

function id3Frame(id: string, data: Uint8Array): Uint8Array {
  return concat([asciiBytes(id), be32(data.length), new Uint8Array([0, 0]), data]);
}

/** Teks ID3v2.3: Latin-1 bila aman, selain itu UTF-16 LE dengan BOM. */
function id3Str(s: string): { enc: number; bytes: Uint8Array } {
  let latin = true;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xff) { latin = false; break; }
  if (latin) return { enc: 0, bytes: asciiBytes(s) };
  const out = new Uint8Array(2 + s.length * 2);
  out[0] = 0xff; out[1] = 0xfe;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 + i * 2] = c & 255; out[3 + i * 2] = c >> 8;
  }
  return { enc: 1, bytes: out };
}
const id3Term = (enc: number) => new Uint8Array(enc === 1 ? [0, 0] : [0]);

function id3TextFrame(id: string, value: string): Uint8Array {
  const { enc, bytes } = id3Str(value);
  return id3Frame(id, concat([new Uint8Array([enc]), bytes]));
}

function id3LangFrame(id: 'COMM' | 'USLT', lang: string, value: string): Uint8Array {
  const { enc, bytes } = id3Str(value);
  return id3Frame(id, concat([new Uint8Array([enc]), asciiBytes((lang + 'eng').slice(0, 3)), id3Term(enc), bytes]));
}

function id3PictureFrame(pic: AudioPicture, type: number): Uint8Array {
  return id3Frame('APIC', concat([new Uint8Array([0]), asciiBytes(pic.mime), new Uint8Array([0, type, 0]), pic.data]));
}

const yearOf = (d: string) => (/^\d{4}/.test(d) ? d.slice(0, 4) : '');

/** Bangun tag ID3v2.3 lengkap (header + frame + padding) dari `tags`, mempertahankan frame lama yang tidak dikelola. */
function buildId3v23(tags: AudioTags, old: Id3Parsed | null, paddingBytes: number): Uint8Array {
  const parts: Uint8Array[] = [];
  const text = (id: string, v: string) => { const s = v.trim(); if (s) parts.push(id3TextFrame(id, s)); };
  text('TIT2', tags.title);
  text('TPE1', tags.artist);
  text('TALB', tags.album);
  text('TPE2', tags.albumArtist);
  text('TCOM', tags.composer);
  text('TCON', tags.genre);
  const yr = yearOf(tags.date);
  if (yr) {
    parts.push(id3TextFrame('TYER', yr));
    const m = /^\d{4}-(\d{2})-(\d{2})/.exec(tags.date);
    if (m) parts.push(id3TextFrame('TDAT', m[2] + m[1]));
  } else if (tags.date.trim()) {
    parts.push(id3TextFrame('TYER', tags.date.trim()));
  }
  const trk = tags.track.trim() ? (tags.trackTotal.trim() ? `${tags.track.trim()}/${tags.trackTotal.trim()}` : tags.track.trim()) : '';
  const dsc = tags.disc.trim() ? (tags.discTotal.trim() ? `${tags.disc.trim()}/${tags.discTotal.trim()}` : tags.disc.trim()) : '';
  text('TRCK', trk);
  text('TPOS', dsc);
  text('TBPM', tags.bpm);
  text('TPUB', tags.publisher);
  text('TCOP', tags.copyright);
  text('TSRC', tags.isrc);
  text('TIT1', tags.grouping);
  if (tags.comment.trim()) parts.push(id3LangFrame('COMM', 'eng', normNewlines(tags.comment)));
  if (tags.lyrics.trim()) parts.push(id3LangFrame('USLT', 'eng', normNewlines(tags.lyrics)));
  if (tags.cover) parts.push(id3PictureFrame(tags.cover, 3));

  // Pertahankan frame lama yang tidak dikelola.
  if (old) {
    const keepIds = new Set<string>();
    const hasFront = old.frames.some((x) => x.id === 'APIC' && id3Picture(x)?.type === 3);
    for (const f of old.frames) {
      if (ID3_MANAGED.has(f.id)) {
        if (f.id === 'COMM') { if (id3LangText(f).desc !== '') parts.push(id3Frame(f.id, f.data)); }
        else if (f.id === 'USLT') { if (id3LangText(f).desc !== '') parts.push(id3Frame(f.id, f.data)); }
        else if (f.id === 'APIC') {
          const p = id3Picture(f);
          // Sampul depan (tipe 3) diganti; gambar bertipe 0 dianggap sampul bila tidak ada tipe 3. Gambar lain dipertahankan.
          const isCover = !!p && (p.type === 3 || (p.type === 0 && !hasFront));
          if (p && !isCover) parts.push(id3Frame(f.id, f.data));
        }
        continue;
      }
      if (f.id === 'TXXX' || f.id === 'UFID' || f.id === 'PRIV' || f.id === 'WXXX' || f.id === 'GEOB') {
        parts.push(id3Frame(f.id, f.data));
        continue;
      }
      if (keepIds.has(f.id) && f.id.startsWith('T')) continue;
      keepIds.add(f.id);
      // frame v2.4 saja yang tidak ada di v2.3 dibuang agar tag tetap valid
      if (old.version === 4 && /^(TDEN|TDOR|TDRL|TDTG|TIPL|TMCL|TMOO|TPRO|TSOA|TSOP|TSOT|TSST|TSO2|TSOC|ASPI|EQU2|RVA2|SEEK|SIGN)$/.test(f.id)) continue;
      parts.push(id3Frame(f.id, f.data));
    }
  }

  const frames = concat(parts);
  const size = frames.length + paddingBytes;
  const out = new Uint8Array(10 + size);
  out.set(asciiBytes('ID3'), 0);
  out[3] = 3; out[4] = 0; out[5] = 0;
  out.set(toSyncsafe(size), 6);
  out.set(frames, 10);
  return out;
}

function buildId3v1(tags: AudioTags): Uint8Array {
  const out = new Uint8Array(128);
  out.set(asciiBytes('TAG'), 0);
  const put = (s: string, off: number, len: number) => {
    const clip = [...s].map((ch) => (ch.charCodeAt(0) > 0xff ? '?' : ch)).join('').slice(0, len);
    out.set(asciiBytes(clip), off);
  };
  put(tags.title, 3, 30); put(tags.artist, 33, 30); put(tags.album, 63, 30);
  put(yearOf(tags.date), 93, 4);
  put(tags.comment.replace(/\s+/g, ' '), 97, 28);
  const trk = Math.max(0, Math.min(255, parseInt(tags.track, 10) || 0));
  if (trk > 0) { out[125] = 0; out[126] = trk; }
  const gi = ID3V1_GENRES.findIndex((g) => g.toLowerCase() === tags.genre.trim().toLowerCase());
  out[127] = gi >= 0 && gi < 148 ? gi : 255;
  return out;
}

function readMp3(b: Uint8Array): { tags: AudioTags; preserved: number } {
  const id3 = parseId3(b, 0);
  if (id3) return tagsFromId3(id3.frames);
  // tanpa ID3v2: coba ID3v1
  const t = emptyTags();
  if (b.length >= 128 && ascii(b, b.length - 128, 3) === 'TAG') {
    const o = b.length - 128;
    const f = (s: number, l: number) => clean(decodeLatin1(b.subarray(o + s, o + s + l)));
    t.title = f(3, 30); t.artist = f(33, 30); t.album = f(63, 30); t.date = f(93, 4);
    if (b[o + 125] === 0 && b[o + 126] !== 0) { t.comment = f(97, 28); t.track = String(b[o + 126]); } else t.comment = f(97, 30);
    t.genre = ID3V1_GENRES[b[o + 127]] ?? '';
  }
  return { tags: t, preserved: 0 };
}

function writeMp3(b: Uint8Array, tags: AudioTags): Uint8Array {
  const old = parseId3(b, 0);
  let audioStart = old ? Math.min(b.length, old.totalSize) : 0;
  // Beberapa berkas punya padding nol setelah tag: lewati nol di awal audio.
  while (audioStart < b.length && b[audioStart] === 0) audioStart++;
  let audioEnd = b.length;
  const hadV1 = b.length - audioStart >= 128 && ascii(b, b.length - 128, 3) === 'TAG';
  if (hadV1) audioEnd -= 128;
  const tag = buildId3v23(tags, old, 512);
  const parts = [tag, b.subarray(audioStart, audioEnd)];
  if (hadV1) parts.push(buildId3v1(tags));
  return concat(parts);
}

// ═════════════════════════════════════════════════════════════
//  FLAC
// ═════════════════════════════════════════════════════════════

interface FlacBlock { type: number; data: Uint8Array }

function flacStart(b: Uint8Array): number {
  if (ascii(b, 0, 3) === 'ID3') return 10 + syncsafe(b, 6);
  return 0;
}

function parseFlac(b: Uint8Array): { blocks: FlacBlock[]; audioStart: number } {
  const s = flacStart(b);
  if (ascii(b, s, 4) !== 'fLaC') throw new MetadataError('Berkas FLAC tidak valid.');
  let p = s + 4;
  const blocks: FlacBlock[] = [];
  for (;;) {
    if (p + 4 > b.length) throw new MetadataError('Berkas FLAC terpotong atau rusak.');
    const hdr = b[p];
    const last = (hdr & 0x80) !== 0;
    const type = hdr & 0x7f;
    const len = (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3];
    p += 4;
    if (p + len > b.length) throw new MetadataError('Berkas FLAC terpotong atau rusak.');
    blocks.push({ type, data: b.subarray(p, p + len) });
    p += len;
    if (last) break;
  }
  return { blocks, audioStart: p };
}

interface VorbisComments { vendor: string; entries: { key: string; value: string }[] }

function parseVorbis(d: Uint8Array): VorbisComments {
  const out: VorbisComments = { vendor: '', entries: [] };
  if (d.length < 8) return out;
  const vl = u32le(d, 0);
  out.vendor = td8.decode(d.subarray(4, 4 + vl));
  let p = 4 + vl;
  if (p + 4 > d.length) return out;
  const n = u32le(d, p); p += 4;
  for (let i = 0; i < n && p + 4 <= d.length; i++) {
    const l = u32le(d, p); p += 4;
    if (p + l > d.length) break;
    const s = td8.decode(d.subarray(p, p + l)); p += l;
    const eq = s.indexOf('=');
    if (eq > 0) out.entries.push({ key: s.slice(0, eq).toUpperCase(), value: s.slice(eq + 1) });
  }
  return out;
}

function buildVorbis(v: VorbisComments): Uint8Array {
  const parts: Uint8Array[] = [];
  const vb = te.encode(v.vendor);
  parts.push(le32(vb.length), vb, le32(v.entries.length));
  for (const e of v.entries) {
    const eb = te.encode(`${e.key}=${e.value}`);
    parts.push(le32(eb.length), eb);
  }
  return concat(parts);
}

const VC_MANAGED_KEYS = new Set([
  'TITLE', 'ARTIST', 'ALBUM', 'ALBUMARTIST', 'COMPOSER', 'GENRE', 'DATE', 'YEAR', 'TRACKNUMBER', 'TRACKTOTAL', 'TOTALTRACKS',
  'DISCNUMBER', 'DISCTOTAL', 'TOTALDISCS', 'BPM', 'PUBLISHER', 'ORGANIZATION', 'LABEL', 'COPYRIGHT', 'ISRC', 'COMMENT',
  'DESCRIPTION', 'LYRICS', 'UNSYNCEDLYRICS', 'GROUPING', 'CONTENTGROUP', 'METADATA_BLOCK_PICTURE',
]);

function parseFlacPicture(d: Uint8Array): { type: number; pic: AudioPicture } | null {
  if (d.length < 32) return null;
  let p = 0;
  const type = u32be(d, p); p += 4;
  const ml = u32be(d, p); p += 4;
  const mime = ascii(d, p, ml); p += ml;
  const dl = u32be(d, p); p += 4 + dl;
  p += 16; // lebar, tinggi, kedalaman, jumlah warna
  if (p + 4 > d.length) return null;
  const len = u32be(d, p); p += 4;
  if (p + len > d.length) return null;
  const data = d.subarray(p, p + len).slice();
  return data.length ? { type, pic: makePicture(mime, data) } : null;
}

function buildFlacPicture(pic: AudioPicture, type: number): Uint8Array {
  const mime = asciiBytes(pic.mime);
  const sn = sniffImage(pic.data);
  return concat([
    be32(type), be32(mime.length), mime, be32(0),
    be32(sn?.width ?? pic.width ?? 0), be32(sn?.height ?? pic.height ?? 0),
    be32(pic.mime === 'image/png' ? 32 : 24), be32(0),
    be32(pic.data.length), pic.data,
  ]);
}

function vorbisToTags(v: VorbisComments): AudioTags {
  const t = emptyTags();
  const all = (...keys: string[]) => v.entries.filter((e) => keys.includes(e.key)).map((e) => e.value.trim()).filter(Boolean);
  const one = (...keys: string[]) => all(...keys).join('; ');
  t.title = one('TITLE'); t.artist = one('ARTIST'); t.album = one('ALBUM'); t.albumArtist = one('ALBUMARTIST');
  t.composer = one('COMPOSER'); t.genre = one('GENRE'); t.date = one('DATE') || one('YEAR');
  const trk = (all('TRACKNUMBER')[0] ?? '').split('/');
  t.track = (trk[0] ?? '').trim();
  t.trackTotal = (all('TRACKTOTAL', 'TOTALTRACKS')[0] ?? trk[1] ?? '').trim();
  const dsc = (all('DISCNUMBER')[0] ?? '').split('/');
  t.disc = (dsc[0] ?? '').trim();
  t.discTotal = (all('DISCTOTAL', 'TOTALDISCS')[0] ?? dsc[1] ?? '').trim();
  t.bpm = (all('BPM')[0] ?? '').replace(/[^\d.]/g, '');
  t.publisher = one('PUBLISHER', 'ORGANIZATION', 'LABEL');
  t.copyright = one('COPYRIGHT'); t.isrc = one('ISRC'); t.grouping = one('GROUPING', 'CONTENTGROUP');
  t.comment = normNewlines(all('COMMENT', 'DESCRIPTION')[0] ?? '');
  t.lyrics = normNewlines(v.entries.find((e) => e.key === 'LYRICS' || e.key === 'UNSYNCEDLYRICS')?.value ?? '');
  return t;
}

function readFlac(b: Uint8Array): { tags: AudioTags; preserved: number; info: AudioTechInfo } {
  const { blocks } = parseFlac(b);
  const vc = blocks.find((x) => x.type === 4);
  const v = vc ? parseVorbis(vc.data) : { vendor: '', entries: [] };
  const tags = vorbisToTags(v);
  const pics = blocks.filter((x) => x.type === 6).map((x) => parseFlacPicture(x.data)).filter(Boolean) as { type: number; pic: AudioPicture }[];
  const front = pics.find((p) => p.type === 3) ?? pics.find((p) => p.type === 0) ?? pics[0];
  tags.cover = front ? front.pic : null;
  const preserved = v.entries.filter((e) => !VC_MANAGED_KEYS.has(e.key)).length + pics.filter((p) => p !== front).length;
  const info: AudioTechInfo = {};
  const si = blocks.find((x) => x.type === 0);
  if (si && si.data.length >= 18) {
    const d = si.data;
    info.sampleRate = (d[10] << 12) | (d[11] << 4) | (d[12] >> 4);
    info.channels = ((d[12] >> 1) & 7) + 1;
    info.bitDepth = (((d[12] & 1) << 4) | (d[13] >> 4)) + 1;
    const total = (d[13] & 15) * 4294967296 + u32be(d, 14);
    if (info.sampleRate > 0 && total > 0) info.durationSec = total / info.sampleRate;
  }
  return { tags, preserved, info };
}

function writeFlac(b: Uint8Array, tags: AudioTags): Uint8Array {
  const { blocks, audioStart } = parseFlac(b);
  const oldVc = blocks.find((x) => x.type === 4);
  const old = oldVc ? parseVorbis(oldVc.data) : { vendor: 'PlayMuzeck', entries: [] };
  const entries: { key: string; value: string }[] = old.entries.filter((e) => !VC_MANAGED_KEYS.has(e.key));
  const put = (k: string, v: string) => { const s = v.trim(); if (s) entries.push({ key: k, value: s }); };
  put('TITLE', tags.title); put('ARTIST', tags.artist); put('ALBUM', tags.album); put('ALBUMARTIST', tags.albumArtist);
  put('COMPOSER', tags.composer); put('GENRE', tags.genre); put('DATE', tags.date);
  put('TRACKNUMBER', tags.track); put('TRACKTOTAL', tags.trackTotal);
  put('DISCNUMBER', tags.disc); put('DISCTOTAL', tags.discTotal);
  put('BPM', tags.bpm); put('PUBLISHER', tags.publisher); put('COPYRIGHT', tags.copyright); put('ISRC', tags.isrc);
  put('GROUPING', tags.grouping);
  if (tags.comment.trim()) entries.push({ key: 'COMMENT', value: normNewlines(tags.comment) });
  if (tags.lyrics.trim()) entries.push({ key: 'LYRICS', value: normNewlines(tags.lyrics) });
  const vcData = buildVorbis({ vendor: old.vendor, entries });

  const out: FlacBlock[] = [];
  const keepPictures: FlacBlock[] = [];
  for (const bl of blocks) {
    if (bl.type === 4 || bl.type === 1) continue; // komentar lama & padding lama diganti
    if (bl.type === 6) {
      const p = parseFlacPicture(bl.data);
      const pics = blocks.filter((x) => x.type === 6).length;
      // sampul depan (atau satu-satunya gambar bertipe 0) diganti; gambar lain dipertahankan
      if (p && (p.type === 3 || (p.type === 0 && pics === 1))) continue;
      keepPictures.push(bl);
      continue;
    }
    out.push(bl);
  }
  // urutan: STREAMINFO dulu (wajib), lalu blok lain, Vorbis, gambar, padding
  const si = out.filter((x) => x.type === 0);
  const rest = out.filter((x) => x.type !== 0);
  const final: FlacBlock[] = [...si, ...rest, { type: 4, data: vcData }];
  if (tags.cover) final.push({ type: 6, data: buildFlacPicture(tags.cover, 3) });
  final.push(...keepPictures);
  final.push({ type: 1, data: new Uint8Array(1024) });

  const parts: Uint8Array[] = [asciiBytes('fLaC')];
  final.forEach((bl, i) => {
    if (bl.data.length > 0xffffff) throw new MetadataError('Satu blok metadata FLAC melebihi 16 MB (cover terlalu besar).');
    const last = i === final.length - 1;
    parts.push(new Uint8Array([(last ? 0x80 : 0) | bl.type, (bl.data.length >> 16) & 255, (bl.data.length >> 8) & 255, bl.data.length & 255]), bl.data);
  });
  parts.push(b.subarray(audioStart));
  return concat(parts);
}

// ═════════════════════════════════════════════════════════════
//  WAV (RIFF)
// ═════════════════════════════════════════════════════════════

interface RiffChunk { id: string; data: Uint8Array }

function parseRiff(b: Uint8Array): RiffChunk[] {
  if (ascii(b, 0, 4) === 'RF64' || ascii(b, 0, 4) === 'BW64') throw new MetadataError('WAV format RF64 (lebih dari 4 GB) belum didukung.');
  const chunks: RiffChunk[] = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const id = ascii(b, p, 4);
    let size = u32le(b, p + 4);
    const start = p + 8;
    if (id === 'data' && (size === 0 || size === 0xffffffff || start + size > b.length)) size = b.length - start; // aliran/terpotong
    if (start + size > b.length) size = b.length - start;
    chunks.push({ id, data: b.subarray(start, start + size) });
    p = start + size + (size & 1);
  }
  return chunks;
}

const INFO_MAP: [string, TextField][] = [
  ['INAM', 'title'], ['IART', 'artist'], ['IPRD', 'album'], ['ICRD', 'date'], ['IGNR', 'genre'], ['ITRK', 'track'], ['IPRT', 'track'],
  ['ICMT', 'comment'], ['ICOP', 'copyright'], ['IPUB', 'publisher'], ['IMUS', 'composer'],
];

function parseInfoList(d: Uint8Array): { id: string; data: Uint8Array }[] {
  const out: { id: string; data: Uint8Array }[] = [];
  let p = 4; // lewati "INFO"
  while (p + 8 <= d.length) {
    const id = ascii(d, p, 4);
    const size = u32le(d, p + 4);
    const s = p + 8;
    if (s + size > d.length) break;
    out.push({ id, data: d.subarray(s, s + size) });
    p = s + size + (size & 1);
  }
  return out;
}

const infoText = (d: Uint8Array) => {
  let e = d.length;
  while (e > 0 && d[e - 1] === 0) e--;
  return clean(td8.decode(d.subarray(0, e)));
};

function readWav(b: Uint8Array): { tags: AudioTags; preserved: number; info: AudioTechInfo } {
  const chunks = parseRiff(b);
  const info: AudioTechInfo = {};
  const fmt = chunks.find((c) => c.id === 'fmt ');
  const data = chunks.find((c) => c.id === 'data');
  if (fmt && fmt.data.length >= 16) {
    info.channels = fmt.data[2] | (fmt.data[3] << 8);
    info.sampleRate = u32le(fmt.data, 4);
    info.bitDepth = fmt.data[14] | (fmt.data[15] << 8);
    const byteRate = u32le(fmt.data, 8);
    if (data && byteRate > 0) info.durationSec = data.data.length / byteRate;
  }
  let tags = emptyTags();
  let preserved = 0;
  const idc = chunks.find((c) => c.id.toLowerCase() === 'id3 ');
  if (idc) {
    const p = parseId3(idc.data, 0);
    if (p) { const r = tagsFromId3(p.frames); tags = r.tags; preserved += r.preserved; }
  }
  const list = chunks.find((c) => c.id === 'LIST' && ascii(c.data, 0, 4) === 'INFO');
  if (list) {
    const items = parseInfoList(list.data);
    for (const it of items) {
      const m = INFO_MAP.find(([k]) => k === it.id);
      if (!m) { preserved++; continue; }
      const f = m[1];
      if (!tags[f]) {
        let v = infoText(it.data);
        if (f === 'track') v = v.split('/')[0];
        (tags as unknown as Record<string, string>)[f] = f === 'genre' ? resolveGenre(v) : v;
      }
    }
  }
  return { tags, preserved, info };
}

function riffChunk(id: string, data: Uint8Array): Uint8Array {
  const pad = data.length & 1 ? new Uint8Array(1) : new Uint8Array(0);
  return concat([asciiBytes(id), le32(data.length), data, pad]);
}

function writeWav(b: Uint8Array, tags: AudioTags): Uint8Array {
  const chunks = parseRiff(b);
  const oldList = chunks.find((c) => c.id === 'LIST' && ascii(c.data, 0, 4) === 'INFO');
  const oldId3 = chunks.find((c) => c.id.toLowerCase() === 'id3 ');
  const oldParsed = oldId3 ? parseId3(oldId3.data, 0) : null;

  const kept: Uint8Array[] = [];
  for (const c of chunks) {
    if (c === oldList || c === oldId3) continue;
    if (c.id === 'LIST' && ascii(c.data, 0, 4) === 'INFO') continue; // INFO ganda: gabung ke satu
    kept.push(riffChunk(c.id, c.data));
  }

  // LIST/INFO: kolom dasar + sub-chunk lama yang tidak dikelola
  const infoParts: Uint8Array[] = [asciiBytes('INFO')];
  const addInfo = (id: string, v: string) => {
    const s = v.trim();
    if (!s) return;
    const enc = te.encode(s);
    const withNul = concat([enc, new Uint8Array([0])]);
    infoParts.push(riffChunk(id, withNul));
  };
  addInfo('INAM', tags.title); addInfo('IART', tags.artist); addInfo('IPRD', tags.album); addInfo('ICRD', tags.date);
  addInfo('IGNR', tags.genre); addInfo('ITRK', tags.track); addInfo('ICMT', tags.comment.replace(/\s*\n\s*/g, ' '));
  addInfo('ICOP', tags.copyright); addInfo('IPUB', tags.publisher); addInfo('IMUS', tags.composer);
  if (oldList) {
    const managed = new Set(INFO_MAP.map(([k]) => k));
    for (const it of parseInfoList(oldList.data)) if (!managed.has(it.id)) infoParts.push(riffChunk(it.id, it.data));
  }
  const tail: Uint8Array[] = [];
  if (infoParts.length > 1) tail.push(riffChunk('LIST', concat(infoParts)));

  // chunk "id3 " untuk cover, lirik, artis album, dll. (tanpa padding agar kecil)
  const hasId3Content = TEXT_FIELDS.some((f) => tags[f].trim()) || tags.cover || (oldParsed && oldParsed.frames.length);
  if (hasId3Content) tail.push(riffChunk('id3 ', buildId3v23(tags, oldParsed, 0)));

  const body = concat([asciiBytes('WAVE'), ...kept, ...tail]);
  const total = body.length;
  if (total + 4 > 0xffffffff) throw new MetadataError('Berkas WAV terlalu besar (maks. 4 GB).');
  return concat([asciiBytes('RIFF'), le32(total), body]);
}

// ═════════════════════════════════════════════════════════════
//  M4A / MP4
// ═════════════════════════════════════════════════════════════

interface Mp4Box { type: string; start: number; end: number; headerLen: number }

function readBoxes(b: Uint8Array, from: number, to: number): Mp4Box[] {
  const out: Mp4Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = u32be(b, p);
    const type = decodeLatin1(b.subarray(p + 4, p + 8));
    let headerLen = 8;
    if (size === 1) {
      if (p + 16 > to) break;
      const hi = u32be(b, p + 8), lo = u32be(b, p + 12);
      size = hi * 4294967296 + lo; headerLen = 16;
    } else if (size === 0) size = to - p;
    if (size < headerLen || p + size > to) break;
    out.push({ type, start: p, end: p + size, headerLen });
    p += size;
  }
  return out;
}

const mp4Box = (type: string, payload: Uint8Array): Uint8Array => concat([be32(8 + payload.length), asciiBytes(type), payload]);
const MP4_NAMES = {
  title: '\u00a9nam', artist: '\u00a9ART', album: '\u00a9alb', albumArtist: 'aART', composer: '\u00a9wrt', genre: '\u00a9gen',
  date: '\u00a9day', comment: '\u00a9cmt', lyrics: '\u00a9lyr', grouping: '\u00a9grp', copyright: 'cprt',
} as const;

const latin1Name = (s: string) => {
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
};

function dataBox(typeFlag: number, value: Uint8Array): Uint8Array {
  return mp4Box('data', concat([new Uint8Array([0, (typeFlag >> 16) & 255, (typeFlag >> 8) & 255, typeFlag & 255]), new Uint8Array(4), value]));
}
const textItem = (name: string, v: string) => mp4Box(decodeLatin1(latin1Name(name)), dataBox(1, te.encode(v)));

function freeformItem(mean: string, name: string, v: string): Uint8Array {
  const meanBox = mp4Box('mean', concat([new Uint8Array(4), te.encode(mean)]));
  const nameBox = mp4Box('name', concat([new Uint8Array(4), te.encode(name)]));
  return mp4Box('----', concat([meanBox, nameBox, dataBox(1, te.encode(v))]));
}

interface IlstItem { name: string; raw: Uint8Array; payload: Uint8Array }

function parseIlst(b: Uint8Array, box: Mp4Box): IlstItem[] {
  const items: IlstItem[] = [];
  for (const it of readBoxes(b, box.start + box.headerLen, box.end)) {
    items.push({ name: it.type, raw: b.subarray(it.start, it.end), payload: b.subarray(it.start + it.headerLen, it.end) });
  }
  return items;
}

function itemData(it: IlstItem): { flag: number; value: Uint8Array }[] {
  const out: { flag: number; value: Uint8Array }[] = [];
  const boxes = readBoxes(it.payload, 0, it.payload.length);
  for (const bx of boxes) {
    if (bx.type !== 'data') continue;
    const d = it.payload.subarray(bx.start + bx.headerLen, bx.end);
    if (d.length < 8) continue;
    out.push({ flag: (d[1] << 16) | (d[2] << 8) | d[3], value: d.subarray(8) });
  }
  return out;
}

function freeformInfo(it: IlstItem): { mean: string; name: string } {
  let mean = '', name = '';
  for (const bx of readBoxes(it.payload, 0, it.payload.length)) {
    const d = it.payload.subarray(bx.start + bx.headerLen + 4, bx.end);
    if (bx.type === 'mean') mean = td8.decode(d);
    if (bx.type === 'name') name = td8.decode(d);
  }
  return { mean, name };
}

const FREEFORM_MANAGED = new Set(['LABEL', 'ISRC', 'PUBLISHER']);
const isManagedFreeform = (it: IlstItem) => {
  if (it.name !== '----') return false;
  const f = freeformInfo(it);
  return f.mean === 'com.apple.iTunes' && FREEFORM_MANAGED.has(f.name.toUpperCase());
};
const MP4_MANAGED = new Set<string>([...Object.values(MP4_NAMES), 'gnre', 'trkn', 'disk', 'tmpo', 'covr']);

interface Mp4Locations { moov: Mp4Box; udta: Mp4Box | null; meta: Mp4Box | null; ilst: Mp4Box | null }

function locateMp4(b: Uint8Array): { top: Mp4Box[]; loc: Mp4Locations } {
  const top = readBoxes(b, 0, b.length);
  if (!top.some((x) => x.type === 'ftyp')) throw new MetadataError('Berkas M4A/MP4 tidak valid.');
  if (top.some((x) => x.type === 'moof')) throw new MetadataError('MP4 terfragmentasi (fMP4/DASH) belum didukung.');
  const moov = top.find((x) => x.type === 'moov');
  if (!moov) throw new MetadataError('Berkas M4A/MP4 tidak punya blok moov (rusak atau belum selesai ditulis).');
  const udta = readBoxes(b, moov.start + moov.headerLen, moov.end).find((x) => x.type === 'udta') ?? null;
  let meta: Mp4Box | null = null; let ilst: Mp4Box | null = null;
  if (udta) {
    meta = readBoxes(b, udta.start + udta.headerLen, udta.end).find((x) => x.type === 'meta') ?? null;
    if (meta) ilst = readBoxes(b, meta.start + meta.headerLen + 4, meta.end).find((x) => x.type === 'ilst') ?? null;
  }
  return { top, loc: { moov, udta, meta, ilst } };
}

function readM4a(b: Uint8Array): { tags: AudioTags; preserved: number; info: AudioTechInfo } {
  const { loc } = locateMp4(b);
  const tags = emptyTags();
  const info: AudioTechInfo = {};
  // durasi dari mvhd
  const mvhd = readBoxes(b, loc.moov.start + loc.moov.headerLen, loc.moov.end).find((x) => x.type === 'mvhd');
  if (mvhd) {
    const o = mvhd.start + mvhd.headerLen;
    const ver = b[o];
    const ts = ver === 1 ? u32be(b, o + 20) : u32be(b, o + 12);
    const dur = ver === 1 ? u32be(b, o + 24) * 4294967296 + u32be(b, o + 28) : u32be(b, o + 16);
    if (ts > 0 && dur > 0) info.durationSec = dur / ts;
  }
  let preserved = 0;
  if (!loc.ilst) return { tags, preserved, info };
  const items = parseIlst(b, loc.ilst);
  const text = (name: string) => {
    const it = items.find((x) => x.name === name);
    if (!it) return '';
    return itemData(it).map((d) => clean(td8.decode(d.value))).filter(Boolean).join('; ');
  };
  tags.title = text(MP4_NAMES.title); tags.artist = text(MP4_NAMES.artist); tags.album = text(MP4_NAMES.album);
  tags.albumArtist = text(MP4_NAMES.albumArtist); tags.composer = text(MP4_NAMES.composer);
  tags.date = text(MP4_NAMES.date); tags.comment = normNewlines(text(MP4_NAMES.comment));
  tags.lyrics = normNewlines(text(MP4_NAMES.lyrics)); tags.grouping = text(MP4_NAMES.grouping); tags.copyright = text(MP4_NAMES.copyright);
  tags.genre = text(MP4_NAMES.genre);
  if (!tags.genre) {
    const g = items.find((x) => x.name === 'gnre');
    const d = g ? itemData(g)[0] : null;
    if (d && d.value.length >= 2) tags.genre = ID3V1_GENRES[u16be(d.value, 0) - 1] ?? '';
  }
  const trkn = items.find((x) => x.name === 'trkn');
  const trd = trkn ? itemData(trkn)[0] : null;
  if (trd && trd.value.length >= 6) {
    const n = u16be(trd.value, 2), t = u16be(trd.value, 4);
    tags.track = n ? String(n) : ''; tags.trackTotal = t ? String(t) : '';
  }
  const disk = items.find((x) => x.name === 'disk');
  const dkd = disk ? itemData(disk)[0] : null;
  if (dkd && dkd.value.length >= 6) {
    const n = u16be(dkd.value, 2), t = u16be(dkd.value, 4);
    tags.disc = n ? String(n) : ''; tags.discTotal = t ? String(t) : '';
  }
  const tmpo = items.find((x) => x.name === 'tmpo');
  const tmd = tmpo ? itemData(tmpo)[0] : null;
  if (tmd && tmd.value.length >= 2) { const v = u16be(tmd.value, 0); tags.bpm = v ? String(v) : ''; }
  for (const it of items.filter((x) => x.name === '----')) {
    const f = freeformInfo(it);
    if (f.mean !== 'com.apple.iTunes') continue;
    const v = itemData(it).map((d) => clean(td8.decode(d.value))).join('; ');
    const key = f.name.toUpperCase();
    if (key === 'LABEL' || key === 'PUBLISHER') tags.publisher = v;
    else if (key === 'ISRC') tags.isrc = v;
  }
  const covr = items.find((x) => x.name === 'covr');
  const cd = covr ? itemData(covr)[0] : null;
  if (cd && cd.value.length) tags.cover = makePicture(cd.flag === 14 ? 'image/png' : 'image/jpeg', cd.value.slice());
  for (const it of items) {
    if (MP4_MANAGED.has(it.name) || isManagedFreeform(it)) continue;
    preserved++;
  }
  if (covr && itemData(covr).length > 1) preserved += itemData(covr).length - 1;
  return { tags, preserved, info };
}

/** Sesuaikan offset chunk (stco/co64) di dalam moov: offset >= threshold digeser sebesar delta. */
function patchChunkOffsets(moov: Uint8Array, threshold: number, delta: number): void {
  const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);
  const walk = (from: number, to: number) => {
    for (const bx of readBoxes(moov, from, to)) {
      if (CONTAINERS.has(bx.type)) { walk(bx.start + bx.headerLen, bx.end); continue; }
      if (bx.type !== 'stco' && bx.type !== 'co64') continue;
      const o = bx.start + bx.headerLen;
      const n = u32be(moov, o + 4);
      const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
      if (bx.type === 'stco') {
        for (let i = 0; i < n; i++) {
          const pos = o + 8 + i * 4;
          if (pos + 4 > bx.end) break;
          const v = dv.getUint32(pos);
          if (v >= threshold) {
            const nv = v + delta;
            if (nv < 0 || nv > 0xffffffff) throw new MetadataError('Offset chunk M4A melebihi batas 4 GB setelah tag diperbesar.');
            dv.setUint32(pos, nv);
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          const pos = o + 8 + i * 8;
          if (pos + 8 > bx.end) break;
          const v = dv.getUint32(pos) * 4294967296 + dv.getUint32(pos + 4);
          if (v >= threshold) {
            const nv = v + delta;
            dv.setUint32(pos, Math.floor(nv / 4294967296));
            dv.setUint32(pos + 4, nv >>> 0);
          }
        }
      }
    }
  };
  walk(8, moov.length);
}

function writeM4a(b: Uint8Array, tags: AudioTags): Uint8Array {
  const { top, loc } = locateMp4(b);
  const oldItems = loc.ilst ? parseIlst(b, loc.ilst) : [];

  const items: Uint8Array[] = [];
  const put = (name: string, v: string) => { const s = v.trim(); if (s) items.push(textItem(name, s)); };
  put(MP4_NAMES.title, tags.title); put(MP4_NAMES.artist, tags.artist); put(MP4_NAMES.album, tags.album);
  put(MP4_NAMES.albumArtist, tags.albumArtist); put(MP4_NAMES.composer, tags.composer); put(MP4_NAMES.genre, tags.genre);
  put(MP4_NAMES.date, tags.date); put(MP4_NAMES.comment, normNewlines(tags.comment)); put(MP4_NAMES.lyrics, normNewlines(tags.lyrics));
  put(MP4_NAMES.grouping, tags.grouping); put(MP4_NAMES.copyright, tags.copyright);
  const trk = parseInt(tags.track, 10) || 0, trkT = parseInt(tags.trackTotal, 10) || 0;
  if (trk || trkT) items.push(mp4Box('trkn', dataBox(0, concat([new Uint8Array(2), be16(trk), be16(trkT), new Uint8Array(2)]))));
  const dsc = parseInt(tags.disc, 10) || 0, dscT = parseInt(tags.discTotal, 10) || 0;
  if (dsc || dscT) items.push(mp4Box('disk', dataBox(0, concat([new Uint8Array(2), be16(dsc), be16(dscT)]))));
  const bpm = Math.round(parseFloat(tags.bpm));
  if (Number.isFinite(bpm) && bpm > 0) items.push(mp4Box('tmpo', dataBox(21, be16(Math.min(65535, bpm)))));
  if (tags.publisher.trim()) items.push(freeformItem('com.apple.iTunes', 'LABEL', tags.publisher.trim()));
  if (tags.isrc.trim()) items.push(freeformItem('com.apple.iTunes', 'ISRC', tags.isrc.trim()));
  if (tags.cover) {
    const flag = tags.cover.mime === 'image/png' ? 14 : tags.cover.mime === 'image/bmp' ? 27 : 13;
    items.push(mp4Box('covr', dataBox(flag, tags.cover.data)));
  }
  for (const it of oldItems) {
    if (MP4_MANAGED.has(it.name) || isManagedFreeform(it)) continue;
    items.push(it.raw);
  }
  const newIlst = mp4Box('ilst', concat(items));

  // meta baru: versi/flags + hdlr + (anak lama selain ilst/free/hdlr) + ilst
  const hdlrNew = mp4Box('hdlr', concat([new Uint8Array(8), asciiBytes('mdir'), asciiBytes('appl'), new Uint8Array(10)]));
  let metaChildren: Uint8Array[] = [];
  let hdlr = hdlrNew;
  if (loc.meta) {
    const kids = readBoxes(b, loc.meta.start + loc.meta.headerLen + 4, loc.meta.end);
    const h = kids.find((k) => k.type === 'hdlr');
    if (h) {
      const handler = ascii(b, h.start + h.headerLen + 8, 4);
      if (handler !== 'mdir' && handler !== '') throw new MetadataError('Metadata M4A memakai skema QuickTime (bukan iTunes) dan belum didukung.');
      hdlr = b.slice(h.start, h.end);
    }
    metaChildren = kids.filter((k) => !['hdlr', 'ilst', 'free', 'skip'].includes(k.type)).map((k) => b.slice(k.start, k.end));
  }
  const newMeta = mp4Box('meta', concat([new Uint8Array(4), hdlr, ...metaChildren, newIlst]));

  // udta baru
  let udtaChildren: Uint8Array[] = [];
  if (loc.udta) {
    udtaChildren = readBoxes(b, loc.udta.start + loc.udta.headerLen, loc.udta.end)
      .filter((k) => k.type !== 'meta').map((k) => b.slice(k.start, k.end));
  }
  const newUdta = mp4Box('udta', concat([...udtaChildren, newMeta]));

  // moov baru
  const moovKids = readBoxes(b, loc.moov.start + loc.moov.headerLen, loc.moov.end);
  const moovParts: Uint8Array[] = [];
  let placed = false;
  for (const k of moovKids) {
    if (k.type === 'udta') { if (!placed) { moovParts.push(newUdta); placed = true; } continue; }
    moovParts.push(b.slice(k.start, k.end));
  }
  if (!placed) moovParts.push(newUdta);
  const newMoov = mp4Box('moov', concat(moovParts));
  const oldMoovLen = loc.moov.end - loc.moov.start;
  const delta = newMoov.length - oldMoovLen;
  if (delta !== 0 && loc.moov.start < (top.find((x) => x.type === 'mdat')?.start ?? Infinity)) {
    patchChunkOffsets(newMoov, loc.moov.end, delta);
  }

  const out: Uint8Array[] = [];
  for (const bx of top) out.push(bx === loc.moov ? newMoov : b.subarray(bx.start, bx.end));
  // data setelah kotak terakhir yang terbaca (jarang) tetap disalin
  const lastEnd = top.length ? top[top.length - 1].end : 0;
  if (lastEnd < b.length) out.push(b.subarray(lastEnd));
  return concat(out);
}

// ═════════════════════════════════════════════════════════════
//  API publik
// ═════════════════════════════════════════════════════════════

export function readTags(bytes: Uint8Array): ReadResult {
  const format = detectFormat(bytes);
  if (!format) throw new MetadataError('Format berkas tidak dikenali. Editor metadata mendukung MP3, FLAC, WAV, dan M4A.');
  if (format === 'mp3') { const r = readMp3(bytes); return { format, tags: r.tags, info: {}, preservedCount: r.preserved }; }
  if (format === 'flac') { const r = readFlac(bytes); return { format, tags: r.tags, info: r.info, preservedCount: r.preserved }; }
  if (format === 'wav') { const r = readWav(bytes); return { format, tags: r.tags, info: r.info, preservedCount: r.preserved }; }
  const r = readM4a(bytes);
  return { format, tags: r.tags, info: r.info, preservedCount: r.preserved };
}

/** Kembalikan berkas baru (byte audio identik) dengan tag diganti sesuai `tags`. */
export function writeTags(bytes: Uint8Array, tags: AudioTags, format: MetaFormat = detectFormat(bytes) ?? 'mp3'): Uint8Array {
  if (tags.cover && tags.cover.data.length > MAX_COVER_BYTES) throw new MetadataError('Gambar cover terlalu besar (maks. 8 MB).');
  const t: AudioTags = { ...tags, cover: tags.cover ? { ...tags.cover, mime: normalizeMime(tags.cover.mime, tags.cover.data) } : null };
  switch (format) {
    case 'mp3': return writeMp3(bytes, t);
    case 'flac': return writeFlac(bytes, t);
    case 'wav': return writeWav(bytes, t);
    default: return writeM4a(bytes, t);
  }
}

export const imageExtension = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/gif' ? 'gif' : mime === 'image/webp' ? 'webp' : mime === 'image/bmp' ? 'bmp' : 'jpg');

export const FORMAT_EXT: Record<MetaFormat, string> = { mp3: 'mp3', flac: 'flac', wav: 'wav', m4a: 'm4a' };
export const FORMAT_MIME: Record<MetaFormat, string> = { mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', m4a: 'audio/mp4' };
