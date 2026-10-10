// Jalankan: npx tsx tests/themeContrast.test.ts   (atau: npm run test:theme)
// Memastikan tema TETAP terbaca apa pun pilihan penggunanya: preset, palet acak, dan palet yang sengaja jelek.
import {
  BUILTIN_THEME, PRESETS, Palette, contrastRatio, isPalette, mixOk, normalizePalette, paletteVars,
  parseHex, resolvePalette, samePalette, toCustom, withMode,
} from '../src/theme/theme.ts';

let bad = 0;
const ok = (n: string, c: boolean, extra = '') => { if (!c) { bad++; console.log('GAGAL', n, extra); } };

// pembangkit acak yang bisa diulang
let seed = 20260101;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const rhex = () => '#' + Array.from({ length: 6 }, () => '0123456789abcdef'[Math.floor(rnd() * 16)]).join('');

const NEUTRAL = ['gray', 'zinc', 'slate', 'neutral', 'stone'];
const STATUS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'];

function check(label: string, p: Palette) {
  const r = resolvePalette(p);
  const v = paletteVars(p);
  const grounds = [r.bg, r.surface, r.deep];
  const worst = (c: string, gs = grounds) => Math.min(...gs.map((g) => contrastRatio(c, g)));

  ok(`${label}: teks utama ≥ 4.5`, worst(v['--color-white']) >= 4.5 - 0.02, String(worst(v['--color-white'])));
  ok(`${label}: teks body ≥ 4.5`, worst(v['--t-fg']) >= 4.5 - 0.02);
  for (const n of NEUTRAL) {
    for (const s of [50, 100, 200, 300, 400, 500]) {
      ok(`${label}: ${n}-${s} ≥ 4.5`, worst(v[`--color-${n}-${s}`]) >= 4.5 - 0.05, `${worst(v[`--color-${n}-${s}`])}`);
    }
    ok(`${label}: ${n}-600 ≥ 3`, worst(v[`--color-${n}-600`]) >= 3 - 0.05);
  }
  for (const h of STATUS) {
    const tint = mixOk(r.surface, v[`--color-${h}-500`], 0.25);
    for (const s of [50, 100, 200, 300, 400]) {
      const c = v[`--color-${h}-${s}`];
      ok(`${label}: ${h}-${s} teks ≥ 4.5`, worst(c) >= 4.5 - 0.05, `${worst(c)}`);
      ok(`${label}: ${h}-${s} di atas noda ≥ 3`, contrastRatio(c, tint) >= 3 - 0.05, `${contrastRatio(c, tint)}`);
    }
  }
  // aksen
  ok(`${label}: aksen terlihat ≥ 3`, contrastRatio(r.accent, r.surface) >= 3 - 0.05 && contrastRatio(r.accent2, r.surface) >= 3 - 0.05);
  ok(`${label}: teks aksen ≥ 4.5`, worst(r.accentText) >= 4.5 - 0.05 && worst(r.accent2Text) >= 4.5 - 0.05);
  ok(`${label}: on-accent ≥ 4.5`, contrastRatio(r.onAccent, r.accent) >= 4.5 && contrastRatio(r.onAccent2, r.accent2) >= 4.5);
  // isian solid dengan teks "white"/"black" tidak boleh < 3
  for (const h of STATUS) {
    const s5 = v[`--color-${h}-500`];
    const need = Math.min(3, Math.sqrt(contrastRatio(r.text, r.bg)) - 0.15); // batas yang mungkin dicapai
    ok(`${label}: ${h}-500 vs teks/latar`, contrastRatio(s5, r.text) >= need - 0.1 && contrastRatio(s5, r.bg) >= need - 0.1,
      `${contrastRatio(s5, r.text).toFixed(2)} / ${contrastRatio(s5, r.bg).toFixed(2)}`);
  }
}

// 1. bawaan + semua preset
check('bawaan', BUILTIN_THEME.palette);
for (const p of PRESETS) check(`preset ${p.id}`, p.palette);

// 2. palet acak (3 warna)
for (let i = 0; i < 80; i++) check(`acak3 #${i}`, { surface: rhex(), accent: rhex(), accent2: rhex() });

// 3. palet acak mode Kustom (5 warna, termasuk teks yang sengaja salah)
for (let i = 0; i < 80; i++) check(`acak5 #${i}`, { surface: rhex(), accent: rhex(), accent2: rhex(), bg: rhex(), text: rhex() });

// 4. kasus ekstrem yang sengaja jelek
const nasty: Array<[string, Palette]> = [
  ['semua sama', { surface: '#808080', accent: '#808080', accent2: '#808080', bg: '#808080', text: '#808080' }],
  ['putih di atas putih', { surface: '#ffffff', accent: '#ffffff', accent2: '#ffffff', bg: '#ffffff', text: '#ffffff' }],
  ['hitam di atas hitam', { surface: '#000000', accent: '#000000', accent2: '#000000', bg: '#000000', text: '#000000' }],
  ['latar hitam, panel putih', { surface: '#ffffff', accent: '#ff00ff', accent2: '#00ffff', bg: '#000000', text: '#888888' }],
  ['latar putih, panel hitam', { surface: '#000000', accent: '#ff00ff', accent2: '#00ffff', bg: '#ffffff', text: '#777777' }],
  ['abu-abu menengah', { surface: '#777777', accent: '#7a7a7a', accent2: '#757575' }],
  ['tepat di titik silang', { surface: '#767676', accent: '#767676', accent2: '#767676' }],
  ['neon di atas neon', { surface: '#00ff00', accent: '#00ff00', accent2: '#ff0000' }],
  ['hanya latar kustom', { surface: '#14213d', accent: '#fca311', accent2: '#fc1212', bg: '#ffffff' }],
  ['hanya teks kustom', { surface: '#ffffff', accent: '#0284c7', accent2: '#e11d48', text: '#ffff00' }],
];
for (const [n, p] of nasty) check(`ekstrem: ${n}`, p);

// 5. perilaku fungsi pendukung
ok('parseHex 3 digit', parseHex('#FA3') === '#ffaa33');
ok('isPalette menerima 5 warna', isPalette({ surface: '#000000', accent: '#111111', accent2: '#222222', bg: '#333333', text: '#ffffff' }));
ok('isPalette menolak bg rusak', !isPalette({ surface: '#000000', accent: '#111111', accent2: '#222222', bg: 'merah' }));
ok('isPalette menerima tanpa bg/text', isPalette(BUILTIN_THEME.palette));
ok('normalizePalette buang bg kosong', !('bg' in normalizePalette({ ...BUILTIN_THEME.palette, bg: undefined })));
ok('samePalette peka bg', !samePalette(BUILTIN_THEME.palette, { ...BUILTIN_THEME.palette, bg: '#000000' }));

const light = withMode(BUILTIN_THEME.palette, 'light');
ok('withMode terang → mode terang', resolvePalette(light).tone === 'light');
ok('withMode tidak membawa bg/text', !light.bg && !light.text);
const cu = toCustom(BUILTIN_THEME.palette);
ok('toCustom mempertahankan tampilan', resolvePalette(cu).bg === resolvePalette(BUILTIN_THEME.palette).bg);
const keep = resolvePalette({ bg: '#2e3440', surface: '#3b4252', text: '#eceff4', accent: '#88c0d0', accent2: '#ebcb8b' });
ok('mode Kustom tidak diubah kalau sudah bagus', keep.text === '#eceff4' && keep.bg === '#2e3440' && keep.notes.length === 0, JSON.stringify(keep.notes));
const bad1 = resolvePalette({ surface: '#ffffff', accent: '#0284c7', accent2: '#e11d48', bg: '#ffffff', text: '#ffffff' });
ok('teks putih di atas putih dikoreksi + ada catatan', bad1.text !== '#ffffff' && bad1.notes.length > 0);

// bawaan: tampilan lama harus nyaris sama
const d = paletteVars(BUILTIN_THEME.palette);
ok('bawaan: white=#fff & black=#000', d['--color-white'] === '#ffffff' && d['--color-black'] === '#000000');
ok('bawaan: aksen tidak berubah', d['--t-accent'] === '#fca311' && d['--t-accent2'] === '#fc1212');

// 6. kecepatan
const t0 = Date.now();
for (let i = 0; i < 20; i++) paletteVars({ surface: rhex(), accent: rhex(), accent2: rhex(), bg: rhex(), text: rhex() });
const per = (Date.now() - t0) / 20;
ok(`kecepatan paletteVars (${per.toFixed(1)} ms/panggilan)`, per < 80);

console.log(bad ? `\n${bad} pemeriksaan GAGAL` : '\nSemua pemeriksaan lolos');
process.exit(bad ? 1 : 0);
