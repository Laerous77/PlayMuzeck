// Uji logika musik alat suara: jalankan dengan `tsx tests/voiceDsp.test.ts`
import { detectPitch } from '../src/services/audioExtraDsp';
import {
  NoteSegmenter, StableNoteDetector, centsOff, classifyVoice, describeSpan, estimateKey, keyName, midiToFreq, noteName,
  summarize, tessituraFrom, warmupStart, WARMUPS,
} from '../src/services/voiceDsp';
import { SONGS, fitSongs } from '../src/data/vocalRangeSongs';

let bad = 0;
const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };

// Nama nada & frekuensi
ok('MIDI 60 = C4', noteName(60) === 'C4');
ok('MIDI 69 = A4 440 Hz', noteName(69) === 'A4' && Math.abs(midiToFreq(69) - 440) < 1e-9);
ok('MIDI 40 = E2 (bass bawah)', noteName(40) === 'E2');
ok('MIDI 84 = C6', noteName(84) === 'C6');
ok('kunci Bb untuk 70', keyName(70) === 'Bb');
ok('cent +0 pada 261.63 Hz', Math.abs(centsOff(261.6256).cents) < 0.1 && centsOff(261.6256).midi === 60);
ok('cent +40 tepat terbaca', Math.abs(centsOff(261.6256 * Math.pow(2, 0.4 / 12)).cents - 40) < 0.5 && centsOff(261.6256 * Math.pow(2, 0.4 / 12)).midi === 60);
ok('cent -40 tepat terbaca', Math.abs(centsOff(261.6256 * Math.pow(2, -0.4 / 12)).cents + 40) < 0.5);
ok('describeSpan', describeSpan(12) === '1 oktaf' && describeSpan(19) === '1 oktaf + 7 semiton' && describeSpan(7) === '7 semiton');

// YIN pada gelombang sinus sintetis, rentang suara manusia
const sr = 44100;
const tone = (f: number, n = 4096) => Float32Array.from({ length: n }, (_, i) => 0.4 * Math.sin((2 * Math.PI * f * i) / sr));
for (const m of [40, 48, 57, 60, 69, 72, 81, 84]) {
  const f = midiToFreq(m);
  const p = detectPitch(tone(f), sr, 60, 1400);
  ok(`YIN ${noteName(m)} (${f.toFixed(1)} Hz) -> ${p ? p.freq.toFixed(1) : 'null'}`, !!p && Math.abs(1200 * Math.log2(p.freq / f)) < 8);
}
// sinus + harmonik (mirip suara) tidak boleh lompat oktaf
const rich = (f: number) => Float32Array.from({ length: 4096 }, (_, i) => { const t = (2 * Math.PI * f * i) / sr; return 0.3 * Math.sin(t) + 0.2 * Math.sin(2 * t) + 0.12 * Math.sin(3 * t); });
{ const f = midiToFreq(55); const p = detectPitch(rich(f), sr, 60, 1400); ok('YIN G3 dengan harmonik tidak lompat oktaf', !!p && Math.abs(1200 * Math.log2(p.freq / f)) < 10); }

// Segmentasi: C4 0.5s, E4 0.5s (frame 50 ms), dengan vibrato ±30 cent
{
  const seg = new NoteSegmenter();
  let t = 0;
  const feedNote = (m: number, sec: number) => { for (let i = 0; i < sec / 0.05; i++) { seg.feed(t, midiToFreq(m + 0.3 * Math.sin(i))); t += 0.05; } };
  feedNote(60, 0.5); feedNote(64, 0.5); seg.feed(t, null); t += 0.3; seg.feed(t, null); feedNote(67, 0.4);
  const out = seg.finish();
  ok('3 segmen (C4, E4, G4)', out.length === 3 && out[0].midi === 60 && out[1].midi === 64 && out[2].midi === 67);
  ok('durasi segmen ≈ 0,5 s', Math.abs(out[0].duration - 0.5) < 0.12 && Math.abs(out[1].duration - 0.5) < 0.12);
  const glitch = new NoteSegmenter();
  let tg = 0; for (let i = 0; i < 10; i++) { glitch.feed(tg, midiToFreq(60)); tg += 0.05; }
  glitch.feed(tg, midiToFreq(72)); tg += 0.05; // satu frame lompatan oktaf = glitch
  for (let i = 0; i < 10; i++) { glitch.feed(tg, midiToFreq(60)); tg += 0.05; }
  const g = glitch.finish();
  ok('glitch 1 frame tidak membuat nada baru', g.length === 1 && g[0].midi === 60);
}

// Nada stabil
{
  const d = new StableNoteDetector(7, 0.9);
  let got: number | null = null;
  for (let i = 0; i < 6; i++) got = d.feed(midiToFreq(50), 0.95);
  ok('belum stabil di frame ke-6', got === null);
  got = d.feed(midiToFreq(50), 0.95);
  ok('stabil di frame ke-7 = D3', got === 50);
  ok('kejernihan rendah mereset', d.feed(midiToFreq(50), 0.5) === null && d.progress === 0);
  d.reset();
  let r: number | null = null;
  for (let i = 0; i < 20; i++) r = d.feed(midiToFreq(i % 2 ? 50 : 62), 0.95);
  ok('lompat-lompat oktaf tidak pernah stabil', r === null);
}

// Estimasi kunci: tangga nada C mayor, tonika dominan
{
  const notes = [60, 62, 64, 65, 67, 69, 71, 72, 60, 64, 67, 60, 67, 64, 60];
  const segs = notes.map((m, i) => ({ midi: m, start: i, duration: m === 60 ? 1 : 0.5, avgCents: 0 }));
  const k = estimateKey(segs);
  ok('kunci C mayor terdeteksi', !!k && k.name === 'C mayor' && k.relative === 'A minor');
  const am = [57, 59, 60, 62, 64, 65, 68, 69, 57, 60, 64, 57, 64, 60, 57, 69, 57].map((m, i) => ({ midi: m, start: i, duration: m === 57 ? 1 : 0.5, avgCents: 0 }));
  const k2 = estimateKey(am);
  ok('kunci A minor terdeteksi', !!k2 && k2.name === 'A minor');
  ok('terlalu sedikit nada -> null', estimateKey(segs.slice(0, 3)) === null);
  const s = summarize(segs);
  ok('ringkasan: rendah C4, tinggi C5, sering C4', s.lowest?.midi === 60 && s.highest?.midi === 72 && s.mostSung?.midi === 60);
}

// Klasifikasi suara (rentang pengguna -> jenis)
const top = (lo: number, hi: number) => classifyVoice(lo, hi)[0].type.id;
ok('E2–E4 = Bass', top(40, 64) === 'bass');
ok('A2–A4 = Bariton', top(45, 69) === 'baritone');
ok('C3–C5 = Tenor', top(48, 72) === 'tenor');
ok('F3–F5 = Alto', top(53, 77) === 'alto');
ok('A3–A5 = Mezzo', top(57, 81) === 'mezzo');
ok('C4–C6 = Sopran', top(60, 84) === 'soprano');
ok('rentang terbalik tetap benar', top(64, 40) === 'bass');
ok('fit 0..1', classifyVoice(48, 72).every((m) => m.fit >= 0 && m.fit <= 1));
ok('rentang sangat sempit tidak crash', classifyVoice(60, 61).length === 7);

// Tessitura
{
  const t = tessituraFrom(48, 72);
  ok('tessitura perkiraan = 60% tengah', !t.measured && t.low === 53 && t.high === 67);
  const w = new Map<number, number>([[48, 0.2], [55, 3], [57, 4], [60, 5], [62, 3], [67, 0.2], [72, 0.1]]);
  const m = tessituraFrom(48, 72, w);
  ok('tessitura terukur membuang ekor jarang', m.measured && m.low >= 55 && m.high <= 62);
}

// Pencocokan lagu
{
  const fits = fitSongs(60, 84, 65, 79); // sopran C4–C6
  ok('semua lagu ≤ 12 semiton muat untuk sopran', SONGS.filter((s) => s.hi - s.lo <= 12).every((s) => fits.some((f) => f.song.id === s.id && f.level !== 'challenge')));
  ok('lagu hasil selalu di dalam rentang (kecuali tantangan)', fits.filter((f) => f.level !== 'challenge').every((f) => f.low >= 60 && f.high <= 84));
  ok('comfort selalu di dalam tessitura', fits.filter((f) => f.level === 'comfort').every((f) => f.low >= 65 && f.high <= 79));
  const narrow = fitSongs(60, 67, 61, 66); // rentang hanya 7 semiton
  ok('rentang 7 semiton: tak ada lagu >7 semiton kecuali tantangan ≤3', narrow.every((f) => f.song.hi - f.song.lo <= 7 + 3));
  ok('rentang 7 semiton: tantangan menyebut kekurangan', narrow.filter((f) => f.level === 'challenge').every((f) => f.shortBy >= 1 && f.shortBy <= 3));
  const hb = fitSongs(62, 74, 62, 74).find((f) => f.song.id === 'happy-birthday');
  ok('Happy Birthday kunci asli (G, D4–D5) pada rentang D4–D5', !!hb && hb.shift === 0 && hb.low === 62 && hb.high === 74 && hb.level === 'comfort');
  const bass = fitSongs(40, 64, 45, 59);
  ok('bass: lagu diturunkan oktaf (shift negatif) tetap ≥ E2', bass.length > 0 && bass.every((f) => f.low >= 40 || f.level === 'challenge'));
  ok('Star-Spangled tidak muat di rentang 1 oktaf', !fitSongs(60, 72, 62, 70).some((f) => f.song.id === 'star-spangled' && f.level !== 'challenge') && !fitSongs(60, 72, 62, 70).some((f) => f.song.id === 'star-spangled'));
}

// Pemanasan
{
  const five = WARMUPS.find((w) => w.id === 'five')!;
  ok('warmup muat -> nada awal = bawah tessitura', warmupStart(five, 53, 67) === 53);
  ok('warmup tidak muat -> null', warmupStart(WARMUPS.find((w) => w.id === 'octave')!, 53, 60) === null);
}

console.log(bad ? `\n${bad} uji GAGAL` : '\nSemua uji voiceDsp lulus');
process.exit(bad ? 1 : 0);
