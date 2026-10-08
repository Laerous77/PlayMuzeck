// Uji editor metadata audio (src/services/audioMetadata.ts).
// Jalankan: tsx tests/audioMetadata.test.ts
// Berkas uji dibuat sintetis di memori (tanpa ffmpeg / berkas eksternal).
import {
  MetadataError, concat, detectFormat, emptyTags, readTags, resolveGenre, sniffImage, writeTags,
  type AudioTags, type MetaFormat,
} from '../src/services/audioMetadata.ts';

let bad = 0;
const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };
const throwsMeta = (fn: () => unknown) => { try { fn(); return false; } catch (e) { return e instanceof MetadataError; } };

const enc = new TextEncoder();
const A = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const le16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
const find = (hay: Uint8Array, needle: Uint8Array, from = 0) => {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
};

// gambar uji
const PNG = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 0);
  b.set(be32(w), 16); b.set(be32(h), 20);
  for (let i = 24; i < 40; i++) b[i] = (i * 7) & 255;
  return b;
};
const JPG = (w: number, h: number) => new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46, 0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255,
  0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01, 0xff, 0xd9,
]);

const FULL: AudioTags = {
  title: 'Cinta di Ujung Senja 🎵', artist: 'Budi Santoso', album: 'Album Ôâ Pertama', albumArtist: 'Various Artists', composer: 'Siti Aminah',
  genre: 'Pop Indonesia', date: '2024-05-17', track: '3', trackTotal: '12', disc: '1', discTotal: '2', bpm: '120',
  publisher: 'PlayMuzeck Records', copyright: '© 2024 PlayMuzeck', isrc: 'IDABC2400001', grouping: 'Single',
  comment: 'Rekaman studio\nbaris kedua', lyrics: 'Baris satu\nBaris dua\n\nBait kedua 日本語',
  cover: { mime: 'image/png', data: PNG(600, 400), width: 600, height: 400 },
};

const sameTags = (a: AudioTags, b: AudioTags) => {
  const keys = Object.keys(emptyTags()).filter((k) => k !== 'cover') as (keyof AudioTags)[];
  for (const k of keys) if (a[k] !== b[k]) { console.log('   beda:', k, JSON.stringify(a[k]), '!=', JSON.stringify(b[k])); return false; }
  const ca = a.cover, cb = b.cover;
  if (!!ca !== !!cb) return false;
  if (ca && cb && (ca.mime !== cb.mime || !eq(ca.data, cb.data))) return false;
  return true;
};

// ───────── pembuat berkas sintetis ─────────
const AUDIO_PAYLOAD = Uint8Array.from({ length: 4000 }, (_, i) => (i * 31 + 7) & 255);

function makeMp3(withV1 = false): Uint8Array {
  const frame = new Uint8Array(417); frame.set([0xff, 0xfb, 0x90, 0x00], 0);
  for (let i = 4; i < 417; i++) frame[i] = (i * 13) & 127;
  const parts = [frame, frame, frame, frame, frame];
  if (withV1) {
    const v1 = new Uint8Array(128); v1.set(A('TAG'), 0); v1.set(A('Judul Lama'), 3); v1.set(A('Artis Lama'), 33); v1[127] = 17;
    parts.push(v1);
  }
  return concat(parts);
}

function makeWav(): Uint8Array {
  const data = AUDIO_PAYLOAD;
  const fmt = concat([A('fmt '), le32(16), le16(1), le16(2), le32(44100), le32(44100 * 4), le16(4), le16(16)]);
  const dat = concat([A('data'), le32(data.length), data]);
  return concat([A('RIFF'), le32(4 + fmt.length + dat.length), A('WAVE'), fmt, dat]);
}

function makeFlac(extraBlocks: { type: number; data: Uint8Array }[] = []): Uint8Array {
  const si = new Uint8Array(34);
  si.set([0x10, 0x00, 0x10, 0x00], 0);              // blok min/maks
  // 44100 Hz (20 bit), 2 kanal (3 bit: 1), 16 bit (5 bit: 15), total sampel 44100 (36 bit)
  const sr = 44100;
  si[10] = (sr >> 12) & 255; si[11] = (sr >> 4) & 255;
  si[12] = ((sr & 15) << 4) | ((1) << 1) | ((15 >> 4) & 1);
  si[13] = ((15 & 15) << 4) | 0;
  si.set(be32(44100), 14);
  const blocks = [{ type: 0, data: si }, ...extraBlocks];
  const parts: Uint8Array[] = [A('fLaC')];
  blocks.forEach((b, i) => {
    parts.push(new Uint8Array([(i === blocks.length - 1 ? 0x80 : 0) | b.type, (b.data.length >> 16) & 255, (b.data.length >> 8) & 255, b.data.length & 255]), b.data);
  });
  parts.push(AUDIO_PAYLOAD);
  return concat(parts);
}

const vorbis = (vendor: string, entries: string[]) => {
  const v = enc.encode(vendor);
  return concat([le32(v.length), v, le32(entries.length), ...entries.flatMap((e) => { const b = enc.encode(e); return [le32(b.length), b]; })]);
};

const box = (type: string, ...payload: Uint8Array[]) => { const p = concat(payload); return concat([be32(8 + p.length), A(type), p]); };

function makeM4a(moovFirst: boolean, withUdta = false): { file: Uint8Array; mdatStart: () => number; chunkOffsets: number[] } {
  const ftyp = box('ftyp', A('M4A '), be32(0), A('M4A '), A('mp42'));
  const mdatPayload = AUDIO_PAYLOAD;
  const mdat = box('mdat', mdatPayload);
  const mvhd = box('mvhd', new Uint8Array([0, 0, 0, 0]), be32(0), be32(0), be32(1000), be32(5000), new Uint8Array(80));
  const buildMoov = (chunkStart: number) => {
    const stco = box('stco', new Uint8Array([0, 0, 0, 0]), be32(2), be32(chunkStart), be32(chunkStart + 1000));
    const stbl = box('stbl', stco);
    const trak = box('trak', box('mdia', box('minf', stbl)));
    const extra = withUdta
      ? box('udta', box('meta', new Uint8Array(4), box('hdlr', new Uint8Array(8), A('mdir'), A('appl'), new Uint8Array(10)),
        box('ilst',
          box('\u00a9nam', box('data', new Uint8Array([0, 0, 0, 1]), new Uint8Array(4), enc.encode('Judul Lama'))),
          box('----',
            box('mean', new Uint8Array(4), enc.encode('com.apple.iTunes')),
            box('name', new Uint8Array(4), enc.encode('iTunNORM')),
            box('data', new Uint8Array([0, 0, 0, 1]), new Uint8Array(4), enc.encode(' 000001AB 000001CD'))),
          box('cpil', box('data', new Uint8Array([0, 0, 0, 21]), new Uint8Array(4), new Uint8Array([1]))))))
      : new Uint8Array(0);
    return box('moov', mvhd, trak, extra);
  };
  if (moovFirst) {
    const m0 = buildMoov(0);
    const start = ftyp.length + m0.length + 8;
    const moov = buildMoov(start);
    const file = concat([ftyp, moov, mdat]);
    return { file, mdatStart: () => start - 8, chunkOffsets: [start, start + 1000] };
  }
  const start = ftyp.length + 8;
  const moov = buildMoov(start);
  const file = concat([ftyp, mdat, moov]);
  return { file, mdatStart: () => ftyp.length, chunkOffsets: [start, start + 1000] };
}

function m4aChunkOffsets(b: Uint8Array): number[] {
  // cari 'stco' dan baca dua offset
  const i = find(b, A('stco'));
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = dv.getUint32(i + 8);
  return Array.from({ length: n }, (_, k) => dv.getUint32(i + 12 + k * 4));
}

// ═════════ deteksi & utilitas ═════════
ok('deteksi MP3', detectFormat(makeMp3()) === 'mp3');
ok('deteksi WAV', detectFormat(makeWav()) === 'wav');
ok('deteksi FLAC', detectFormat(makeFlac()) === 'flac');
ok('deteksi M4A', detectFormat(makeM4a(true).file) === 'm4a');
ok('sampah -> null', detectFormat(new Uint8Array(500).fill(7)) === null);
ok('berkas terlalu pendek -> null', detectFormat(new Uint8Array(4)) === null);
ok('readTags pada sampah -> MetadataError', throwsMeta(() => readTags(new Uint8Array(500).fill(7))));

ok('sniff PNG + ukuran', (() => { const s = sniffImage(PNG(640, 480)); return s?.mime === 'image/png' && s.width === 640 && s.height === 480; })());
ok('sniff JPEG + ukuran', (() => { const s = sniffImage(JPG(800, 600)); return s?.mime === 'image/jpeg' && s.width === 800 && s.height === 600; })());
ok('sniff bukan gambar -> null', sniffImage(new Uint8Array(40)) === null);
ok('genre numerik ID3v1', resolveGenre('(17)') === 'Rock' && resolveGenre('17') === 'Rock' && resolveGenre('(17)Rock') === 'Rock' && resolveGenre('Jazz') === 'Jazz');

// ═════════ bolak-balik semua format ═════════
const makers: Record<MetaFormat, () => Uint8Array> = { mp3: () => makeMp3(), wav: makeWav, flac: () => makeFlac(), m4a: () => makeM4a(true).file };
for (const fmt of ['mp3', 'flac', 'wav', 'm4a'] as MetaFormat[]) {
  const src = makers[fmt]();
  const before = readTags(src);
  ok(`${fmt}: berkas polos dibaca dengan tag kosong`, before.format === fmt && !before.tags.title && !before.tags.cover);

  const out = writeTags(src, FULL);
  const back = readTags(out);
  ok(`${fmt}: format tetap ${fmt}`, back.format === fmt && detectFormat(out) === fmt);
  let expected = FULL;
  if (fmt === 'wav') expected = { ...FULL };
  ok(`${fmt}: semua kolom + cover kembali persis`, sameTags(back.tags, expected));
  ok(`${fmt}: ukuran cover terbaca`, back.tags.cover?.width === 600 && back.tags.cover?.height === 400);

  // data audio identik
  const payloadAt = find(out, AUDIO_PAYLOAD.subarray(0, 64));
  if (fmt !== 'mp3') ok(`${fmt}: byte audio identik`, payloadAt > 0 && eq(out.subarray(payloadAt, payloadAt + AUDIO_PAYLOAD.length), AUDIO_PAYLOAD));
  else {
    const frame = src.subarray(0, 417);
    const at = find(out, frame);
    ok('mp3: seluruh frame audio identik', at > 0 && eq(out.subarray(at, at + src.length), src));
  }

  // tulis dua kali: hasil stabil, tidak menumpuk
  const out2 = writeTags(out, back.tags);
  ok(`${fmt}: tulis ulang tidak mengubah isi tag`, sameTags(readTags(out2).tags, FULL));
  ok(`${fmt}: ukuran tidak membengkak saat tulis ulang`, Math.abs(out2.length - out.length) <= 600);

  // ubah satu kolom + hapus kolom lain
  const edited: AudioTags = { ...back.tags, title: 'Judul Baru', lyrics: '', cover: null, trackTotal: '' };
  const r3 = readTags(writeTags(out2, edited)).tags;
  ok(`${fmt}: ubah judul`, r3.title === 'Judul Baru');
  ok(`${fmt}: hapus lirik & cover & total trek`, r3.lyrics === '' && r3.cover === null && r3.trackTotal === '' && r3.track === '3');
  ok(`${fmt}: kolom lain tetap`, r3.artist === FULL.artist && r3.album === FULL.album && r3.composer === FULL.composer);

  // tag kosong total
  const wiped = readTags(writeTags(out2, emptyTags())).tags;
  ok(`${fmt}: kosongkan semua tag`, sameTags(wiped, emptyTags()));
  const dur = readTags(out).info;
  if (fmt === 'wav') ok('wav: info teknis (44100 Hz, 2 kanal, 16-bit)', dur.sampleRate === 44100 && dur.channels === 2 && dur.bitDepth === 16);
  if (fmt === 'flac') ok('flac: info teknis (44100 Hz, 2 kanal, 16-bit, 1 dtk)', dur.sampleRate === 44100 && dur.channels === 2 && dur.bitDepth === 16 && Math.abs((dur.durationSec ?? 0) - 1) < 1e-6);
  if (fmt === 'm4a') ok('m4a: durasi dari mvhd (5 dtk)', Math.abs((dur.durationSec ?? 0) - 5) < 1e-6);
}

// ═════════ MP3 spesifik ═════════
{
  const v1 = makeMp3(true);
  const r = readTags(v1);
  ok('mp3 tanpa ID3v2: membaca ID3v1 (judul, artis, genre)', r.tags.title === 'Judul Lama' && r.tags.artist === 'Artis Lama' && r.tags.genre === 'Rock');
  const out = writeTags(v1, { ...emptyTags(), title: 'Judul Baru', artist: 'Artis Baru', genre: 'Jazz', date: '2020', track: '5' });
  ok('mp3: ID3v1 lama disegarkan (bukan dibiarkan basi)', ascii(out.subarray(out.length - 125, out.length - 95)).startsWith('Judul Baru') && out[out.length - 1] === 8);
  ok('mp3: ID3v2 baru terbaca', readTags(out).tags.title === 'Judul Baru');
}
function ascii(b: Uint8Array) { return String.fromCharCode(...b); }

{
  // frame tak dikelola (TXXX) dipertahankan; gambar tipe lain dipertahankan; sampul depan diganti
  const mk = (id: string, data: Uint8Array) => concat([A(id), be32(data.length), new Uint8Array(2), data]);
  const txxx = mk('TXXX', concat([new Uint8Array([0]), A('REPLAYGAIN_TRACK_GAIN'), new Uint8Array([0]), A('-6.50 dB')]));
  const apic = (type: number, bytes: Uint8Array) => mk('APIC', concat([new Uint8Array([0]), A('image/png'), new Uint8Array([0, type, 0]), bytes]));
  const frames = concat([txxx, apic(3, PNG(10, 10)), apic(4, PNG(20, 20)), mk('TIT2', concat([new Uint8Array([0]), A('Lama')]))]);
  const hdr = new Uint8Array(10); hdr.set(A('ID3'), 0); hdr[3] = 3;
  const sz = frames.length;
  hdr.set([(sz >>> 21) & 127, (sz >>> 14) & 127, (sz >>> 7) & 127, sz & 127], 6);
  const file = concat([hdr, frames, makeMp3()]);
  const out = writeTags(file, { ...emptyTags(), title: 'Baru', cover: { mime: 'image/png', data: PNG(99, 99) } });
  ok('mp3: frame TXXX (ReplayGain) dipertahankan', find(out, A('REPLAYGAIN_TRACK_GAIN')) > 0 && find(out, A('-6.50 dB')) > 0);
  const r = readTags(out);
  ok('mp3: sampul depan diganti', r.tags.cover?.width === 99 && r.tags.title === 'Baru');
  ok('mp3: gambar bertipe lain (artis) tetap ada', find(out, concat([A('image/png'), new Uint8Array([0, 4, 0])])) > 0);
  ok('mp3: dihitung sebagai kolom yang dipertahankan', readTags(file).preservedCount >= 2);
}

{
  // ID3v2.4: TDRC, teks UTF-8, banyak nilai dipisah NUL; v2.2
  const ss = (n: number) => new Uint8Array([(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]);
  const mk4 = (id: string, data: Uint8Array) => concat([A(id), ss(data.length), new Uint8Array(2), data]);
  const frames = concat([
    mk4('TIT2', concat([new Uint8Array([3]), enc.encode('Lagu Ü')])),
    mk4('TPE1', concat([new Uint8Array([3]), enc.encode('A'), new Uint8Array([0]), enc.encode('B')])),
    mk4('TDRC', concat([new Uint8Array([3]), enc.encode('2021-03-04T10:00')])),
    mk4('TCON', concat([new Uint8Array([0]), A('(17)')])),
    mk4('TRCK', concat([new Uint8Array([0]), A('7/9')])),
  ]);
  const hdr = new Uint8Array(10); hdr.set(A('ID3'), 0); hdr[3] = 4; hdr.set(ss(frames.length), 6);
  const r = readTags(concat([hdr, frames, makeMp3()])).tags;
  ok('ID3v2.4: UTF-8, banyak nilai, TDRC, genre numerik, trek n/total', r.title === 'Lagu Ü' && r.artist === 'A; B' && r.date === '2021-03-04' && r.genre === 'Rock' && r.track === '7' && r.trackTotal === '9');

  const mk2 = (id: string, data: Uint8Array) => concat([A(id), new Uint8Array([(data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255]), data]);
  const f2 = concat([mk2('TT2', concat([new Uint8Array([0]), A('Judul v22')])), mk2('TP1', concat([new Uint8Array([0]), A('Artis v22')]))]);
  const h2 = new Uint8Array(10); h2.set(A('ID3'), 0); h2[3] = 2; h2.set(ss(f2.length), 6);
  const r2 = readTags(concat([h2, f2, makeMp3()])).tags;
  ok('ID3v2.2 dibaca (TT2, TP1)', r2.title === 'Judul v22' && r2.artist === 'Artis v22');
  const upg = readTags(writeTags(concat([h2, f2, makeMp3()]), { ...r2, album: 'X' })).tags;
  ok('ID3v2.2 ditulis ulang sebagai v2.3', upg.title === 'Judul v22' && upg.album === 'X');
}

// ═════════ FLAC spesifik ═════════
{
  const pic = (type: number, w: number) => {
    const png = PNG(w, w);
    return { type: 6, data: concat([be32(type), be32(9), A('image/png'), be32(0), be32(w), be32(w), be32(24), be32(0), be32(png.length), png]) };
  };
  const src = makeFlac([
    { type: 4, data: vorbis('libFLAC 1.4.3', ['TITLE=Lama', 'REPLAYGAIN_TRACK_GAIN=-7.00 dB', 'ARTIST=A1', 'ARTIST=A2', 'TRACKNUMBER=4/10']) },
    pic(3, 11), pic(4, 22), { type: 1, data: new Uint8Array(300) },
  ]);
  const r = readTags(src);
  ok('flac: dua ARTIST digabung, TRACKNUMBER n/total', r.tags.artist === 'A1; A2' && r.tags.track === '4' && r.tags.trackTotal === '10' && r.tags.cover?.width === 11);
  const out = writeTags(src, { ...r.tags, title: 'Baru', cover: { mime: 'image/png', data: PNG(33, 33) } });
  const b = readTags(out);
  ok('flac: ReplayGain & vendor dipertahankan', find(out, A('REPLAYGAIN_TRACK_GAIN=-7.00 dB')) > 0 && find(out, A('libFLAC 1.4.3')) > 0);
  ok('flac: sampul depan diganti, gambar tipe lain dipertahankan', b.tags.cover?.width === 33 && find(out, be32(22)) > 0 && b.preservedCount >= 2);
  ok('flac: STREAMINFO tetap blok pertama', out[4] === 0 && out[7] === 34);
  // blok terakhir bertanda "last", tepat satu
  let p = 4, lasts = 0, n = 0;
  for (;;) { const h = out[p]; const len = (out[p + 1] << 16) | (out[p + 2] << 8) | out[p + 3]; n++; if (h & 0x80) { lasts++; p += 4 + len; break; } p += 4 + len; }
  ok('flac: tepat satu blok bertanda terakhir & audio mulai tepat setelahnya', lasts === 1 && eq(out.subarray(p, p + 64), AUDIO_PAYLOAD.subarray(0, 64)));
  ok('flac: terpotong -> MetadataError', throwsMeta(() => readTags(src.subarray(0, 60))));
  ok('flac: cover > 8 MB ditolak', throwsMeta(() => writeTags(src, { ...r.tags, cover: { mime: 'image/png', data: new Uint8Array(9 * 1024 * 1024) } })));
}

// ═════════ WAV spesifik ═════════
{
  const w = makeWav();
  const bext = concat([A('bext'), le32(10), new Uint8Array(10)]);
  const list = (() => { const inam = concat([A('INAM'), le32(5), A('Lama\0'), new Uint8Array(1)]); const isft = concat([A('ISFT'), le32(8), A('Lavf60.0'), ]); const body = concat([A('INFO'), inam, isft]); return concat([A('LIST'), le32(body.length), body]); })();
  const base = w.subarray(12);
  const body = concat([A('WAVE'), base, bext, list]);
  const src = concat([A('RIFF'), le32(body.length), body]);
  const r = readTags(src);
  ok('wav: membaca LIST/INFO (judul)', r.tags.title === 'Lama');
  const out = writeTags(src, { ...r.tags, title: 'Baru', artist: 'Artis', cover: { mime: 'image/png', data: PNG(8, 8) } });
  ok('wav: chunk bext & ISFT dipertahankan', find(out, A('bext')) > 0 && find(out, A('ISFT')) > 0);
  ok('wav: LIST/INFO diperbarui (terbaca di Windows)', find(out, A('INAM')) > 0 && find(out, enc.encode('Baru')) > 0 && find(out, enc.encode('Lama')) < 0);
  ok('wav: chunk id3 berisi cover', find(out, A('id3 ')) > 0 && readTags(out).tags.cover?.width === 8);
  const sz = new DataView(out.buffer, out.byteOffset).getUint32(4, true);
  ok('wav: ukuran RIFF di header cocok dengan panjang berkas', sz === out.length - 8);
  ok('wav: RF64 ditolak dengan pesan jelas', throwsMeta(() => readTags(concat([A('RF64'), le32(0xffffffff), A('WAVE'), new Uint8Array(40)]))) || detectFormat(concat([A('RF64'), le32(0), A('WAVE'), new Uint8Array(40)])) === null);
}

// ═════════ M4A spesifik ═════════
{
  const a = makeM4a(true, true);
  const r = readTags(a.file);
  ok('m4a: membaca judul dari ilst', r.tags.title === 'Judul Lama');
  const out = writeTags(a.file, { ...r.tags, title: 'Judul Sangat Panjang Yang Memperbesar Blok Tag Supaya Offset Bergeser', cover: { mime: 'image/png', data: PNG(300, 300) } });
  const offs = m4aChunkOffsets(out);
  const newMdat = find(out, A('mdat')) - 4;
  ok('m4a: moov sebelum mdat -> offset chunk (stco) ikut bergeser benar', offs[0] === newMdat + 8 && offs[1] === newMdat + 8 + 1000);
  ok('m4a: byte audio di mdat identik', eq(out.subarray(offs[0], offs[0] + AUDIO_PAYLOAD.length), AUDIO_PAYLOAD));
  ok('m4a: atom iTunes khusus (iTunNORM) & cpil dipertahankan', find(out, A('iTunNORM')) > 0 && find(out, A('cpil')) > 0);
  ok('m4a: tag baru terbaca', readTags(out).tags.title.startsWith('Judul Sangat') && readTags(out).tags.cover?.width === 300);

  const b = makeM4a(false);
  const out2 = writeTags(b.file, { ...emptyTags(), title: 'Tanpa udta', cover: { mime: 'image/jpeg', data: JPG(50, 40) } });
  ok('m4a: mdat sebelum moov -> offset tidak diubah', eq(new Uint8Array(m4aChunkOffsets(out2)), new Uint8Array(b.chunkOffsets)));
  const r2 = readTags(out2).tags;
  ok('m4a: berkas tanpa udta/meta mendapat tag baru (cover JPEG)', r2.title === 'Tanpa udta' && r2.cover?.mime === 'image/jpeg' && r2.cover.width === 50);
  const out3 = writeTags(out2, { ...r2, title: '' });
  ok('m4a: hapus judul', readTags(out3).tags.title === '');
  ok('m4a: tanpa moov -> MetadataError', throwsMeta(() => readTags(concat([box('ftyp', A('M4A '), be32(0), A('M4A ')), box('mdat', new Uint8Array(100))]))));
  const withTrk = readTags(writeTags(b.file, { ...emptyTags(), track: '2', trackTotal: '9', disc: '1', bpm: '128.4' })).tags;
  ok('m4a: trkn/disk/tmpo', withTrk.track === '2' && withTrk.trackTotal === '9' && withTrk.disc === '1' && withTrk.bpm === '128');
}

console.log(bad ? `\n${bad} uji GAGAL` : '\nSemua uji metadata lulus');
if (bad) process.exitCode = 1;
