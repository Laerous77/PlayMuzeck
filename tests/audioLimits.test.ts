// Uji batas durasi Audio Tools (src/services/audioLimits.ts).
// Jalankan: tsx tests/audioLimits.test.ts
import {
  LONG_AUDIO_TOOL_IDS, checkInputDuration, checkOutputDuration, formatDuration, isOverLimit,
  maxMinutesFor, maxRepeatsFor, maxSecondsFor, repeatedDuration,
} from '../src/services/audioLimits.ts';

let bad = 0;
const ok = (n: string, c: boolean) => { console.log(c ? 'ok  ' : 'GAGAL', n); if (!c) bad++; };

// tingkat batas
for (const id of LONG_AUDIO_TOOL_IDS) ok(`${id}: batas 90 menit`, maxMinutesFor(id) === 90 && maxSecondsFor(id) === 5400);
for (const id of ['pitch', 'tempo', 'reverse', 'loop', 'noise_reduction', 'vocal_separator', 'recorder', 'bpm', 'pitch_detect', 'vocal_range', 'pitch_match', 'metronome', 'tuner']) {
  ok(`${id}: batas 60 menit`, maxMinutesFor(id) === 60 && maxSecondsFor(id) === 3600);
}
ok('alat tak dikenal -> 60 menit (aman)', maxMinutesFor('alat_baru') === 60);
ok('trim termasuk alat audio panjang', (LONG_AUDIO_TOOL_IDS as readonly string[]).includes('trim'));
ok('loop BUKAN alat audio panjang', !(LONG_AUDIO_TOOL_IDS as readonly string[]).includes('loop'));

// pemeriksaan batas (dengan toleransi 1 dtk)
ok('60:00 pas lolos di alat 60 menit', !isOverLimit('pitch', 3600));
ok('60:00,9 (pembulatan decode) lolos', !isOverLimit('pitch', 3600.9));
ok('60:02 ditolak di alat 60 menit', isOverLimit('pitch', 3602));
ok('75 menit lolos di trim (90)', checkInputDuration('trim', 75 * 60) === null);
ok('75 menit ditolak di tempo (60)', checkInputDuration('tempo', 75 * 60) !== null);
ok('91 menit ditolak di trim', checkInputDuration('trim', 91 * 60) !== null);
ok('NaN tidak dianggap melebihi batas', checkInputDuration('trim', NaN) === null);

// pesan galat berguna
const m75 = checkInputDuration('tempo', 75 * 60) ?? '';
ok('pesan menyebut durasi & batas', m75.includes('1 jam 15 menit') && m75.includes('60 menit'));
ok('pesan menyarankan Trim bila masih <= 90 menit', m75.includes('Trim / Cut'));
const m120 = checkInputDuration('tempo', 120 * 60) ?? '';
ok('pesan tidak menyarankan Trim bila > 90 menit', !m120.includes('Trim / Cut') && m120.includes('lebih pendek'));
ok('pesan keluaran menyebut batas', (checkOutputDuration('loop', 3700) ?? '').includes('60 menit'));
ok('keluaran aman -> null', checkOutputDuration('merge', 80 * 60) === null);

// format durasi
ok('formatDuration jam', formatDuration(5400) === '1 jam 30 menit' && formatDuration(3600) === '1 jam');
ok('formatDuration menit', formatDuration(754) === '12 menit 34 dtk' && formatDuration(120) === '2 menit');
ok('formatDuration detik', formatDuration(40) === '40 dtk' && formatDuration(-5) === '0 dtk');

// pengulangan: hasil tidak boleh > 60 menit
ok('audio 3 menit: boleh 5x', maxRepeatsFor('loop', 180) === 5);
ok('audio 12 menit: boleh 5x (60 menit pas)', maxRepeatsFor('loop', 720) === 5);
ok('audio 15 menit: maks 4x', maxRepeatsFor('loop', 900) === 4);
ok('audio 20 menit: maks 3x', maxRepeatsFor('loop', 1200) === 3);
ok('audio 30 menit: maks 2x', maxRepeatsFor('loop', 1800) === 2);
ok('audio 31 menit: hanya 1x (= tidak bisa diulang)', maxRepeatsFor('loop', 1860) === 1);
ok('audio 0 dtk: 0', maxRepeatsFor('loop', 0) === 0);
ok('crossfade memperpanjang jatah ulangan', maxRepeatsFor('loop', 1801, 5, 2) === 2 && maxRepeatsFor('loop', 1801, 5, 0) === 1);
ok('repeatedDuration tanpa crossfade', repeatedDuration(10, 3) === 30);
ok('repeatedDuration dengan crossfade', Math.abs(repeatedDuration(10, 3, 1) - 28) < 1e-9);
ok('repeatedDuration: crossfade dibatasi setengah durasi', Math.abs(repeatedDuration(2, 2, 5) - 3) < 1e-9);

console.log(bad ? `\n${bad} uji GAGAL` : '\nSemua uji batas durasi lulus');
if (bad) process.exitCode = 1;
