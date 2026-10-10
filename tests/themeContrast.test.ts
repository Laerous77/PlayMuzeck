// Jalankan: npx tsx tests/themeContrast.test.ts   (atau: npm run test:theme)
// Dua tujuan sekaligus:
//   1. Tema TETAP terbaca apa pun pilihan penggunanya: preset, palet acak, dan palet yang sengaja jelek.
//   2. Tema TIDAK merusak palet yang sudah bagus: pastel tetap pastel, warna aksen dipakai apa adanya.
import {
  BUILTIN_THEME, PRESETS, Palette, contrastRatio, isPalette, mixOk, normalizePalette, paletteVars,
  parseHex, resolvePalette, samePalette, toCustom, withMode, inkOn, colorDistance,
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
  // aksen: isian hanya digeser kalau praktis sama dengan panel (< 1.12:1); sisanya dihormati apa adanya
  const FILL = 1.12 - 0.01;
  const seen = (c: string, g: string) => contrastRatio(c, g) >= FILL || colorDistance(c, g) >= 0.05 - 0.005;
  const fillOk = (c: string) => seen(c, r.surface) && seen(c, r.bg);
  const bothSame = contrastRatio(r.surface, r.bg) < 1.05; // panel = latar: di tepi gamut (hitam/putih murni) mustahil terlihat di atas keduanya
  ok(`${label}: isian aksen terlihat (≥ 1.12:1 atau jelas beda rona)`, (fillOk(r.accent) && fillOk(r.accent2)) || bothSame || contrastRatio(r.accent, r.surface) >= 1.05,
    `${contrastRatio(r.accent, r.surface)} / ${contrastRatio(r.accent2, r.surface)}`);
  ok(`${label}: garis aksen terlihat ≥ 3`, contrastRatio(r.accentLine, r.surface) >= 3 - 0.05 && contrastRatio(r.accent2Line, r.surface) >= 3 - 0.05);
  ok(`${label}: teks aksen ≥ 4.5`, worst(r.accentText) >= 4.5 - 0.05 && worst(r.accent2Text) >= 4.5 - 0.05);
  ok(`${label}: teks besar aksen ≥ 3`, worst(r.accentDisplay) >= 3 - 0.05 && worst(r.accent2Display) >= 3 - 0.05, `${worst(r.accentDisplay)} / ${worst(r.accent2Display)}`);
  ok(`${label}: on-accent ≥ 4.5`, contrastRatio(r.onAccent, r.accent) >= 4.5 && contrastRatio(r.onAccent2, r.accent2) >= 4.5, `${contrastRatio(r.onAccent, r.accent)} / ${contrastRatio(r.onAccent2, r.accent2)}`);
  ok(`${label}: var --t-on-accent & --t-scrim ada`, !!v['--t-on-accent'] && !!v['--t-on-accent2'] && /^#[0-9a-f]{6}$/.test(v['--t-scrim']));
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

// palet pastel (Earthy Tones): warna aksen TIDAK boleh diubah sama sekali; label tetap terbaca
const earthy: Palette = { bg: '#f7e1d7', surface: '#dedbd2', text: '#4a5759', accent: '#b0c4b1', accent2: '#edafb8' };
check('Earthy Tones', earthy);
const er = resolvePalette(earthy);
ok('Earthy: isian aksen = pilihan pengguna (tidak digelapkan)', er.accent === earthy.accent && er.accent2 === earthy.accent2, `${er.accent} ${er.accent2}`);
ok('Earthy: tidak ada catatan penyesuaian', er.notes.length === 0, JSON.stringify(er.notes));
ok('Earthy: bg/surface/teks dipakai apa adanya', er.bg === earthy.bg && er.surface === earthy.surface && er.text === earthy.text);
ok('Earthy: label tombol ≥ 7 dan gelap-berona-slate (bukan hitam pekat)', contrastRatio(er.onAccent, er.accent) >= 7 && contrastRatio(er.onAccent2, er.accent2) >= 7 && er.onAccent !== '#000000' && er.onAccent2 !== '#000000', `${er.onAccent} ${er.onAccent2}`);
ok('Earthy: garis aksen ≥ 3 di atas panel & latar', contrastRatio(er.accentLine, er.surface) >= 3 - 0.05 && contrastRatio(er.accentLine, er.bg) >= 3 - 0.05);
ok('Earthy: judul bergradasi lebih cerah dari teks aksen kecil', contrastRatio(er.accentDisplay, er.bg) < contrastRatio(er.accentText, er.bg) && contrastRatio(er.accent2Display, er.bg) < contrastRatio(er.accent2Text, er.bg));

// palet UMUM yang sudah bagus: aksen, latar, panel, dan teks tidak boleh diubah satu karakter pun
const COMMON: Array<[string, Palette]> = [
  ['Nord', { bg: '#2e3440', surface: '#3b4252', text: '#eceff4', accent: '#88c0d0', accent2: '#ebcb8b' }],
  ['Dracula', { bg: '#282a36', surface: '#44475a', text: '#f8f8f2', accent: '#bd93f9', accent2: '#ff79c6' }],
  ['Gruvbox Dark', { bg: '#282828', surface: '#3c3836', text: '#ebdbb2', accent: '#fabd2f', accent2: '#fb4934' }],
  ['Solarized Light', { bg: '#fdf6e3', surface: '#eee8d5', text: '#073642', accent: '#268bd2', accent2: '#cb4b16' }],
  ['Catppuccin Latte', { bg: '#eff1f5', surface: '#e6e9ef', text: '#4c4f69', accent: '#8839ef', accent2: '#ea76cb' }],
  ['Catppuccin Mocha', { bg: '#1e1e2e', surface: '#313244', text: '#cdd6f4', accent: '#cba6f7', accent2: '#f5c2e7' }],
  ['Pastel Mint', { bg: '#eef7f1', surface: '#d8ecdf', text: '#2f4a3b', accent: '#a8d5ba', accent2: '#f4b6c2' }],
  ['Pastel Lavender', { bg: '#f4effa', surface: '#e3d9f2', text: '#3b3355', accent: '#c3b1e1', accent2: '#f7c6d9' }],
  ['Sunset Peach', { bg: '#fff1e6', surface: '#fde2cf', text: '#5a3a2e', accent: '#ffb88c', accent2: '#f4978e' }],
  ['Midnight Blue', { bg: '#0b132b', surface: '#1c2541', text: '#e0e6f5', accent: '#5bc0be', accent2: '#ff9f1c' }],
];
for (const [n, p] of COMMON) {
  check(`umum: ${n}`, p);
  const r = resolvePalette(p);
  ok(`umum ${n}: aksen dipakai apa adanya`, r.accent === p.accent && r.accent2 === p.accent2, `${r.accent} ${r.accent2}`);
  ok(`umum ${n}: latar/panel/teks tidak berubah`, r.bg === p.bg && r.surface === p.surface && r.text === p.text);
  ok(`umum ${n}: tidak ada catatan penyesuaian`, r.notes.length === 0, JSON.stringify(r.notes));
}
// tiga warna (mode Gelap/Terang) dengan pastel: aksen pastel juga tidak boleh digelapkan
for (const surf of ['#e8e4dc', '#f1ece4', '#dfe8e2']) {
  const r = resolvePalette({ surface: surf, accent: '#b0c4b1', accent2: '#edafb8' });
  ok(`3 warna terang (${surf}): pastel dipakai apa adanya`, r.accent === '#b0c4b1' && r.accent2 === '#edafb8', `${r.accent} ${r.accent2}`);
}

// inkOn: tinta dari palet sendiri, jatuh ke hitam/putih hanya bila terpaksa
ok('inkOn: isian terang → tinta gelap ≥ 7', contrastRatio(inkOn('#b0c4b1', ['#4a5759', '#f7e1d7', '#dedbd2']), '#b0c4b1') >= 7);
ok('inkOn: isian gelap → tinta terang ≥ 4.5', contrastRatio(inkOn('#7c3aed', ['#ffffff', '#000000', '#14213d']), '#7c3aed') >= 4.5);
ok('inkOn: palet tanpa tinta layak → hitam/putih', contrastRatio(inkOn('#808080', ['#808080', '#858585']), '#808080') >= 4.5);

// tirai popup: tema terang punya tirai gelap sungguhan, tema gelap tetap hitam
ok('scrim: tema terang gelap & berona teks', contrastRatio(resolvePalette(earthy).scrim, '#ffffff') >= 10);
ok('scrim: tema gelap = hitam', resolvePalette(BUILTIN_THEME.palette).scrim === '#000000');
// bawaan: garis = isian (tidak ada yang berubah untuk tema bawaan)
ok('bawaan: garis aksen = isian', resolvePalette(BUILTIN_THEME.palette).accentLine === resolvePalette(BUILTIN_THEME.palette).accent);

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
