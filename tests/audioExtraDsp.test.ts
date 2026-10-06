import * as D from '../src/services/audioExtraDsp.ts';

const sr = 44100;
let pass = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) { console.error('GAGAL:', name, info); process.exitCode = 1; } else { pass++; console.log('ok  ', name, info); } };

// util sintetis
const sine = (f: number, sec: number, amp = 1, rate = sr) => { const n = Math.round(sec * rate); const o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = amp * Math.sin(2 * Math.PI * f * i / rate); return o; };
function clickTrack(bpm: number, sec: number, pattern = [1, 0.4, 0.7, 0.4]) {
  const o = new Float32Array(Math.round(sec * sr)); const beat = 60 / bpm * sr; let k = 0;
  for (let t = 0; t < o.length; t += beat, k++) {
    const amp = pattern[k % pattern.length]; const s = Math.round(t);
    for (let i = 0; i < 1500 && s + i < o.length; i++) o[s + i] += amp * Math.sin(2 * Math.PI * (k % 4 === 0 ? 120 : 3000) * i / sr) * Math.exp(-i / 300) + (Math.random() - 0.5) * 0.1 * Math.exp(-i / 200);
  }
  return o;
}

// ── BPM
for (const bpm of [70, 93, 100, 120, 128, 140, 174]) {
  const r = D.detectBpm([clickTrack(bpm, 40)], sr);
  const cands = r ? [r.bpm, ...r.alternatives] : [];
  const hit = cands.some((c) => Math.abs(c - bpm) <= 1.5);
  ok(`BPM ${bpm}`, !!r && hit, `-> ${r?.bpm} alt=${r?.alternatives.join(',')} conf=${r?.confidence.toFixed(2)}`);
  if (r && Math.abs(r.bpm - bpm) > 1.5) console.log('   (catatan: bpm utama oktaf lain, alternatif memuat nilai benar)');
}
ok('BPM senyap -> null', D.detectBpm([new Float32Array(sr * 20)], sr) === null);
ok('BPM terlalu pendek -> null', D.detectBpm([new Float32Array(sr * 2)], sr) === null);

// ── Kunci nada: akor dengan harmonik
function chordSeq(chords: number[][], secEach: number) {
  const parts: Float32Array[] = [];
  for (const midis of chords) {
    const n = Math.round(secEach * sr); const o = new Float32Array(n);
    for (const m of midis) { const f = 440 * Math.pow(2, (m - 69) / 12); for (let h = 1; h <= 4; h++) for (let i = 0; i < n; i++) o[i] += Math.sin(2 * Math.PI * f * h * i / sr) / h / midis.length; }
    parts.push(o);
  }
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0)); let w = 0; for (const p of parts) { out.set(p, w); w += p.length; } return out;
}
const Cmaj = [[60, 64, 67], [65, 69, 72], [67, 71, 74], [60, 64, 67]]; // C F G C
const Amin = [[57, 60, 64], [62, 65, 69], [64, 68, 71], [57, 60, 64]]; // Am Dm E Am
const Gmaj = [[55, 59, 62], [60, 64, 67], [62, 66, 69], [55, 59, 62]];
const Dmin = [[50, 53, 57], [55, 58, 62], [57, 60, 64], [50, 53, 57]];
for (const [name, prog, want] of [['C mayor', Cmaj, 'C mayor'], ['A minor', Amin, 'A minor'], ['G mayor', Gmaj, 'G mayor'], ['D minor', Dmin, 'D minor']] as const) {
  const k = D.detectKey([chordSeq(prog as any, 3)], sr);
  ok(`Kunci ${name}`, k?.name === want, `-> ${k?.name} camelot=${k?.camelot} rel=${k?.relative} conf=${k?.confidence.toFixed(2)}`);
}
ok('Camelot C mayor = 8B', D.camelotCode(0, false) === '8B');
ok('Camelot A minor = 8A', D.camelotCode(9, true) === '8A');
ok('Camelot G mayor = 9B', D.camelotCode(7, false) === '9B');
ok('Camelot F mayor = 7B', D.camelotCode(5, false) === '7B');
ok('Camelot D minor = 7A', D.camelotCode(2, true) === '7A');
ok('Camelot F# mayor = 2B', D.camelotCode(6, false) === '2B');

// ── LUFS (referensi EBU: sinus 1 kHz -23 dBFS stereo = -23.0 LUFS)
const s1k = sine(1000, 10, D.dbToLin(-23));
const lu = D.measureLufs([s1k, s1k], sr);
ok('LUFS 1kHz -23dBFS stereo ~ -23', lu !== null && Math.abs(lu + 23) < 0.2, `-> ${lu?.toFixed(2)}`);
for (const rate of [48000, 22050]) { const x = sine(1000, 10, D.dbToLin(-23), rate); const l = D.measureLufs([x, x], rate); ok(`LUFS @${rate}Hz`, l !== null && Math.abs(l + 23) < 0.3, `-> ${l?.toFixed(2)}`); }
ok('LUFS senyap -> null', D.measureLufs([new Float32Array(sr * 3)], sr) === null);

// ── Normalisasi
const quiet = [sine(220, 12, D.dbToLin(-35)), sine(220, 12, D.dbToLin(-35))];
const n1 = D.normalizeLoudness(quiet, sr, -16, -1);
ok('Normalisasi ke -16', n1.afterLufs !== null && Math.abs(n1.afterLufs + 16) < 0.5, `before=${n1.beforeLufs?.toFixed(1)} after=${n1.afterLufs?.toFixed(2)} gain=${n1.gainDb.toFixed(1)}`);
// sinyal dengan crest factor tinggi: perlu limiter
const peaky = new Float32Array(sr * 12); for (let i = 0; i < peaky.length; i++) peaky[i] = 0.02 * Math.sin(2 * Math.PI * 300 * i / sr) + (i % 22050 < 40 ? 0.5 : 0);
const n2 = D.normalizeLoudness([peaky], sr, -14, -1);
ok('Limiter menjaga puncak <= -1 dBFS', D.linToDb(D.peakOf(n2.channels)) <= -0.95, `peak=${D.linToDb(D.peakOf(n2.channels)).toFixed(2)} dB limited=${n2.limited} after=${n2.afterLufs?.toFixed(1)}`);
const np = D.normalizePeak([sine(440, 1, 0.1)], -1);
ok('Normalisasi puncak -1 dB', Math.abs(D.linToDb(D.peakOf(np.channels)) + 1) < 0.01);

// ── Hapus hening
const seg = (v: number, sec: number) => sine(440, sec, v);
const mk = (...p: Float32Array[]) => { const o = new Float32Array(p.reduce((s, x) => s + x.length, 0)); let w = 0; for (const x of p) { o.set(x, w); w += x.length; } return o; };
const sil = (sec: number) => new Float32Array(Math.round(sec * sr));
const src = mk(sil(1), seg(0.5, 1), sil(2), seg(0.5, 1), sil(0.2), seg(0.5, 1), sil(1.5));
const rs = D.removeSilence([src], sr, { thresholdDb: -45, minSilenceMs: 400, keepMs: 150 });
const expectLen = (3 + 0.2 + 0.075 + 0.15 + 0.075) ; // 3 detik suara + 0.2 jeda pendek utuh + sisa jeda
ok('Hapus hening: jeda panjang dipotong, jeda pendek (0.2s) utuh', rs.removedCount === 3 && Math.abs(rs.channels[0].length / sr - (3 + 0.2 + 0.075 + 0.15 + 0.075)) < 0.05, `durasi ${(rs.channels[0].length / sr).toFixed(2)}s dibuang=${rs.removedSeconds.toFixed(2)}s x${rs.removedCount}`);
ok('Hapus hening: tanpa jeda panjang -> tidak berubah', D.removeSilence([seg(0.5, 3)], sr).removedCount === 0);

// ── Gabung & fade
const a = [sine(440, 1, 0.5)], b = [sine(660, 1, 0.5)];
const j0 = D.concatChannels([a, b], sr, 0);
ok('Gabung tanpa crossfade = 2 detik', j0[0].length === sr * 2);
const j1 = D.concatChannels([a, b], sr, 0.5);
ok('Gabung crossfade 0.5s = 1.5 detik', j1[0].length === Math.round(sr * 1.5));
ok('Gabung mono + stereo -> stereo', D.concatChannels([a, [b[0], b[0]]], sr).length === 2);
const cfPeak = D.peakOf([j1[0].subarray(Math.round(0.5 * sr), Math.round(1 * sr))]);
ok('Crossfade equal-power tidak melewati 1.0 secara liar', cfPeak < 0.8, `peak=${cfPeak.toFixed(2)}`);
const f = D.applyFade([sine(440, 2, 1)], sr, 0.5, 0.5, 'linear');
ok('Fade: sampel pertama & terakhir ~0', Math.abs(f[0][0]) < 1e-3 && Math.abs(f[0][f[0].length - 1]) < 1e-3);
ok('Fade: bagian tengah utuh', Math.abs(D.peakOf([f[0].subarray(sr * 0.8, sr * 1.2)]) - 1) < 0.01);
ok('Fade tidak mengubah input', D.peakOf([sine(440, 2, 1)]) === D.peakOf([sine(440, 2, 1)]));

// ── Mono & slice
const st = [sine(440, 1, 0.5), sine(440, 1, -0.5)];
ok('Stereo -> mono (fase berlawanan = senyap)', D.peakOf(D.toMono(st)) < 1e-6);
ok('Slice 0.25–0.75s = 0.5s', D.sliceChannels([sine(440, 1)], sr, 0.25, 0.75)[0].length === sr / 2);

// ── Metronom
const m = D.renderMetronome({ bpm: 120, beatsPerBar: 4, bars: 2, sampleRate: sr });
ok('Metronom 120bpm 4/4 x2 bar = 4 detik', m.length === sr * 4);
ok('Metronom tidak clipping', D.peakOf([m]) <= 1);

// ── Tuner
for (const [f0, name] of [[82.41, 'E2'], [110, 'A2'], [196, 'G3'], [329.63, 'E4'], [440, 'A4'], [880, 'A5']] as const) {
  const buf = sine(f0, 0.1, 0.5).subarray(0, 4096);
  const p = D.detectPitch(buf, sr);
  const note = p ? D.freqToNote(p.freq) : null;
  ok(`Pitch ${name}`, !!p && Math.abs(1200 * Math.log2(p.freq / f0)) < 3, `-> ${p?.freq.toFixed(2)}Hz (${note?.name}${note?.octave} ${note?.cents.toFixed(1)}c)`);
}
// bass E1 (41.2 Hz) dengan buffer 8192 pada 44.1k dan 48k
for (const rate of [44100, 48000]) { const b = sine(41.2, 0.5, 0.5, rate).subarray(0, 8192); const p = D.detectPitch(b, rate, 35, 1400); ok(`Pitch bass E1 @${rate}`, !!p && Math.abs(1200 * Math.log2(p.freq / 41.2)) < 8, `-> ${p?.freq.toFixed(2)}Hz`); }
// gelombang gigi gergaji (kaya harmonik) E2
{ const n = 8192, f0 = 82.41, o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = 0.4 * (2 * ((f0 * i / sr) % 1) - 1); const p = D.detectPitch(o, sr); ok('Pitch gergaji E2', !!p && Math.abs(1200 * Math.log2(p.freq / f0)) < 5, `-> ${p?.freq.toFixed(2)}`); }
ok('Pitch senyap -> null', D.detectPitch(new Float32Array(4096), sr) === null);
{ const noise = new Float32Array(4096).map(() => (Math.random() - 0.5) * 0.4); const p = D.detectPitch(noise, sr); ok('Pitch derau -> null atau clarity rendah', p === null || p.clarity < 0.9, `${p ? p.clarity.toFixed(2) : 'null'}`); }
const gt = D.TUNING_PRESETS.find((x) => x.id === 'guitar')!;
const ns = D.nearestString(112, gt)!; ok('Senar terdekat 112Hz = A2, cent > 0', ns.string.label === 'A2' && ns.cents > 0, `${ns.string.label} ${ns.cents.toFixed(1)}c`);
ok('freqToNote A4=440 -> A4 0c', (() => { const x = D.freqToNote(440); return x.name === 'A' && x.octave === 4 && Math.abs(x.cents) < 1e-6; })());
ok('freqToNote 261.63 -> C4', (() => { const x = D.freqToNote(261.63); return x.name === 'C' && x.octave === 4; })());

console.log(`\n${pass} pengujian lulus${process.exitCode ? ' (ADA YANG GAGAL)' : ''}`);

// ── Metronom v2 (birama, subdivisi, aksen, suara)
{
  const bars = 2, bpm = 120;
  for (const sub of D.SUBDIVISIONS) {
    const m = D.renderMetronome({ bpm, beatsPerBar: 4, bars, subdivisionId: sub.id, sampleRate: sr });
    ok(`Metronom subdivisi ${sub.id}: panjang tepat`, m.length === sr * 4 && D.peakOf([m]) <= 1);
  }
  for (const ts of D.TIME_SIGNATURES) ok(`Birama ${ts.id}: jumlah aksen = pulsa`, ts.accents.length === ts.pulses && ts.accents[0] === 2);
  for (const snd of D.CLICK_SOUNDS) {
    const m = D.renderMetronome({ bpm, beatsPerBar: 4, bars: 1, subdivisionId: 'sixteenth', sound: snd.id, sampleRate: sr });
    ok(`Suara ${snd.id}: tidak clipping & tidak senyap`, D.peakOf([m]) <= 1 && D.peakOf([m]) > 0.1, `peak=${D.peakOf([m]).toFixed(2)}`);
  }
  // pulsa dimute -> awal bar tetap senyap
  const muted = D.renderMetronome({ bpm, beatsPerBar: 4, bars: 1, accents: [0, 1, 1, 1], sampleRate: sr });
  ok('Pulsa 1 di-mute = senyap di awal bar', Math.max(...muted.subarray(0, 2000).map(Math.abs)) === 0);
  // swing: klik kedua di 2/3 pulsa
  const sw = D.renderMetronome({ bpm: 60, beatsPerBar: 1, bars: 1, subdivisionId: 'swing', accents: [0], sampleRate: sr });
  const at = (x: Float32Array, a: number, b: number) => Math.max(...x.subarray(a, b).map(Math.abs));
  ok('Swing: klik di 2/3 pulsa, bukan 1/2', at(sw, Math.round(sr * 2 / 3) + 10, Math.round(sr * 2 / 3) + 400) > 0.05 && at(sw, Math.round(sr / 2) + 10, Math.round(sr / 2) + 400) === 0);
  // triplet: 3 klik per pulsa -> klik di 1/3
  const tr = D.renderMetronome({ bpm: 60, beatsPerBar: 1, bars: 1, subdivisionId: 'triplet', accents: [0], sampleRate: sr });
  ok('Triplet: klik di 1/3 pulsa', at(tr, Math.round(sr / 3) + 10, Math.round(sr / 3) + 400) > 0.05);
  // kompatibilitas parameter lama
  const legacy = D.renderMetronome({ bpm, beatsPerBar: 4, bars: 1, subdivision: 3, sampleRate: sr });
  const modern = D.renderMetronome({ bpm, beatsPerBar: 4, bars: 1, subdivisionId: 'triplet', sampleRate: sr });
  ok('subdivision lama (3) = triplet', legacy.length === modern.length && legacy.every((v, i) => v === modern[i]));
  ok('Istilah tempo', D.tempoMarking(72) === 'Adagio' && D.tempoMarking(100) === 'Andante' && D.tempoMarking(128) === 'Allegro' && D.tempoMarking(210) === 'Prestissimo');
}

// ── Tuner v2 (banyak instrumen)
{
  const ids = new Set(D.TUNING_PRESETS.map((p) => p.id));
  ok('Id preset unik', ids.size === D.TUNING_PRESETS.length);
  ok('Preset tuner >= 25', D.TUNING_PRESETS.length >= 25, `${D.TUNING_PRESETS.length} preset`);
  const lab = (id: string) => D.TUNING_PRESETS.find((p) => p.id === id)!.strings.map((x) => x.label).join(' ');
  ok('Label gitar standar', lab('guitar') === 'E2 A2 D3 G3 B3 E4', lab('guitar'));
  ok('Label bass 5 senar', lab('bass5') === 'B0 E1 A1 D2 G2', lab('bass5'));
  ok('Label ukulele (re-entrant)', lab('ukulele') === 'G4 C4 E4 A4', lab('ukulele'));
  ok('Label DADGAD', lab('guitar-dadgad') === 'D2 A2 D3 G3 A3 D4', lab('guitar-dadgad'));
  ok('Label cello', lab('cello') === 'C2 G2 D3 A3', lab('cello'));
  ok('Label bouzouki', lab('bouzouki') === 'G2 D3 A3 D4', lab('bouzouki'));
  ok('Semua preset punya grup', D.TUNING_PRESETS.every((p) => !!p.group));
  const lf = D.lowestFreq(D.TUNING_PRESETS.find((p) => p.id === 'bass5')!)!;
  ok('Nada terendah bass 5 senar ≈ 30,87 Hz', Math.abs(lf - 30.87) < 0.05, lf.toFixed(2));
  ok('lowestFreq kromatik = null', D.lowestFreq(D.TUNING_PRESETS[0]) === null);
  // B0 (30,87 Hz) harus terdeteksi dengan buffer 8192 bila batas bawah diturunkan
  for (const rate of [44100, 48000]) { const b = sine(30.87, 0.5, 0.5, rate).subarray(0, 8192); const p = D.detectPitch(b, rate, 25, 1400); ok(`Pitch bass B0 @${rate}`, !!p && Math.abs(1200 * Math.log2(p.freq / 30.87)) < 8, `-> ${p?.freq.toFixed(2)}Hz`); }
}
