// scripts/generate-seo-pages.mjs
// Dijalankan SETELAH `vite build`. Membuat halaman HTML statis per Audio Tool
// (judul, deskripsi, canonical, dan teks sendiri) + sitemap.xml lengkap di dist/.
// Cloudflare Pages otomatis menyajikan dist/alat-audio/<slug>/index.html di /alat-audio/<slug>.
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.cwd(), 'dist');
const ORIGIN = 'https://playmuzeck.my.id';
const TODAY = new Date().toISOString().slice(0, 10);

const TOOLS = [
  { slug: 'potong-audio', name: 'Potong Audio (Trim / Cut)',
    title: 'Potong Audio Online Gratis, Tanpa Install | PlayMuzeck',
    desc: 'Potong lagu atau rekaman langsung di browser. Tentukan titik awal & akhir, unduh hasilnya. Gratis dicoba, file tidak diunggah ke server.',
    h1: 'Potong Audio Online', body: 'Pangkas intro, hapus bagian yang tidak perlu, atau ambil potongan untuk nada dering. Tentukan batas awal dan akhir, dengarkan hasilnya, lalu unduh.' },
  { slug: 'atur-volume-audio', name: 'Atur Volume Audio (Gain)',
    title: 'Naikkan atau Kecilkan Volume Audio Online | PlayMuzeck',
    desc: 'Naikkan atau turunkan volume file audio dalam desibel langsung di browser. Dengar hasilnya secara real-time, lalu unduh.',
    h1: 'Atur Volume Audio Online', body: 'Rekaman terlalu pelan atau terlalu keras? Atur gain dalam dB dan dengarkan perubahannya langsung sebelum mengunduh.' },
  { slug: 'ubah-nada-audio', name: 'Ubah Nada Lagu (Pitch)',
    title: 'Ubah Nada Lagu Online (Pitch / Transpose) | PlayMuzeck',
    desc: 'Naikkan atau turunkan nada lagu dalam semitone, dengan opsi mengunci tempo. Cocok untuk latihan vokal dan band. Berjalan di browser.',
    h1: 'Ubah Nada Lagu Online', body: 'Sesuaikan nada lagu dengan rentang suaramu. Geser dalam semitone dan kunci tempo supaya durasi lagu tidak berubah.' },
  { slug: 'ubah-kecepatan-audio', name: 'Ubah Kecepatan Audio (Tempo)',
    title: 'Percepat atau Perlambat Audio Tanpa Ubah Nada | PlayMuzeck',
    desc: 'Percepat atau perlambat audio tanpa mengubah nada. Berguna untuk belajar lagu, transkripsi, dan podcast. Gratis dicoba di browser.',
    h1: 'Percepat / Perlambat Audio Online', body: 'Perlambat bagian sulit untuk latihan, atau percepat rekaman wawancara. Nada tetap sama.' },
  { slug: 'balik-audio', name: 'Balik Audio (Reverse)',
    title: 'Balik Audio Online (Reverse) | PlayMuzeck',
    desc: 'Putar audio dari belakang ke depan untuk efek transisi atau sound design. Cepat, di browser, tanpa install.',
    h1: 'Balik Audio (Reverse) Online', body: 'Balikkan urutan audio untuk efek transisi, intro misterius, atau eksperimen sound design.' },
  { slug: 'konversi-audio', name: 'Konversi Audio (MP3, WAV, FLAC, M4A)',
    title: 'Konversi Audio Online: MP3, WAV, FLAC, M4A | PlayMuzeck',
    desc: 'Ubah format file audio milikmu ke MP3, WAV, FLAC, atau M4A, dan ekstrak audio dari file video. Diproses di perangkatmu.',
    h1: 'Konversi Format Audio Online', body: 'Ubah file audio atau ekstrak suara dari video milikmu ke MP3, WAV, FLAC, atau M4A. Seluruh proses berjalan di browser.' },
  { slug: 'kompres-audio', name: 'Kompres Ukuran Audio',
    title: 'Kompres Ukuran File Audio Online | PlayMuzeck',
    desc: 'Perkecil ukuran file audio dengan 5 tingkat kompresi dan estimasi ukuran sebelum diunduh. Praktis untuk kirim lewat chat atau email.',
    h1: 'Kompres Ukuran Audio Online', body: 'Pilih satu dari 5 tingkat kompresi, lihat estimasi ukuran dan bitrate, lalu unduh versi yang lebih kecil.' },
  { slug: 'kurangi-noise-audio', name: 'Kurangi Noise Audio',
    title: 'Kurangi Noise & Desis pada Rekaman Online | PlayMuzeck',
    desc: 'Redam desis dan dengung latar pada rekaman suara dengan spectral gate. Berjalan di browser, file tidak diunggah.',
    h1: 'Kurangi Noise Rekaman Online', body: 'Bersihkan desis dan dengung latar dari rekaman vokal, podcast, atau voice note.' },
  { slug: 'pisahkan-vokal', name: 'Pisahkan Vokal & Musik',
    title: 'Pisahkan Vokal dan Musik Online (Karaoke Maker) | PlayMuzeck',
    desc: 'Pisahkan vokal dan instrumental dari rekaman stereo lewat teknik center-phase. Bukan AI; hasil terbaik bila vokal berada di tengah.',
    h1: 'Pisahkan Vokal dan Musik Online', body: 'Buat versi karaoke atau ambil vokalnya saja dari file milikmu. Alat ini memakai teknik center-phase, bukan AI, jadi hasil terbaik pada rekaman stereo dengan vokal di tengah.' },
  // ── Alat tambahan (komponen AudioExtraTools) ──
  { slug: 'gabung-audio', name: 'Gabung Audio (Merge)',
    title: 'Gabung Audio Online: Satukan Beberapa Lagu Jadi Satu | PlayMuzeck',
    desc: 'Gabungkan beberapa file audio menjadi satu, atur urutan dan crossfade, lalu unduh sebagai MP3 atau WAV. Diproses di browser.',
    h1: 'Gabung Audio Online', body: 'Satukan beberapa lagu, rekaman, atau potongan suara berurutan. Atur urutannya, tambahkan crossfade agar sambungan halus, lalu unduh hasilnya.' },
  { slug: 'fade-audio', name: 'Fade In & Fade Out Audio',
    title: 'Fade In & Fade Out Audio Online Gratis | PlayMuzeck',
    desc: 'Tambahkan fade in dan fade out pada lagu atau rekaman agar awal dan akhirnya halus. Pilih kurva fade, dengarkan, lalu unduh.',
    h1: 'Fade In & Fade Out Audio Online', body: 'Buat intro yang naik perlahan dan akhir lagu yang menghilang halus. Atur durasi dan kurva fade, dengarkan hasilnya, lalu unduh.' },
  { slug: 'deteksi-bpm', name: 'Deteksi BPM Lagu',
    title: 'Deteksi BPM Lagu Online: Cari Tempo Lagu Gratis | PlayMuzeck',
    desc: 'Cari BPM (tempo) lagu dari file audio milikmu langsung di browser. Cocok untuk DJ, musisi, dan pembuat konten. Gratis dicoba.',
    h1: 'Deteksi BPM Lagu Online', body: 'Ketahui tempo lagu dalam hitungan detik. Hasil berupa perkiraan, dengan alternatif setengah atau dua kali tempo bila ketukan terasa ambigu.' },
  { slug: 'deteksi-kunci-nada', name: 'Deteksi Kunci Nada Lagu',
    title: 'Cari Kunci Nada (Key) Lagu Online + Kode Camelot | PlayMuzeck',
    desc: 'Deteksi kunci nada lagu (mayor/minor) dan kode Camelot untuk mixing DJ. Dianalisis di browser, file tidak diunggah.',
    h1: 'Deteksi Kunci Nada Lagu Online', body: 'Temukan kunci nada lagu beserta kunci relatifnya dan kode Camelot untuk harmonic mixing. Hasil berupa perkiraan otomatis.' },
  { slug: 'rekam-suara', name: 'Rekam Suara + Potong',
    title: 'Rekam Suara Online dari Mikrofon, Langsung Potong | PlayMuzeck',
    desc: 'Rekam suara dari mikrofon di browser, potong bagian awal dan akhir, lalu unduh sebagai MP3 atau WAV. Rekaman tidak diunggah.',
    h1: 'Rekam Suara Online', body: 'Rekam vokal, voice note, atau ide lagu langsung dari browser. Potong bagian yang tidak diperlukan lalu unduh hasilnya.' },
  { slug: 'buat-nada-dering', name: 'Pembuat Nada Dering',
    title: 'Buat Nada Dering Sendiri Online (MP3 & M4R) | PlayMuzeck',
    desc: 'Potong bagian favorit lagu milikmu jadi nada dering HP. Atur fade, unduh MP3 untuk Android atau M4R untuk iPhone.',
    h1: 'Buat Nada Dering Online', body: 'Pilih bagian terbaik dari lagu milikmu (maksimal 30 detik), tambahkan fade, lalu unduh sebagai nada dering. Pastikan kamu berhak memakai lagunya.' },
  { slug: 'hapus-hening-audio', name: 'Hapus Jeda Hening',
    title: 'Hapus Jeda Hening pada Audio Otomatis, Online | PlayMuzeck',
    desc: 'Hapus bagian hening pada rekaman podcast, voice-over, atau kuliah secara otomatis. Atur ambang dan sisa jeda, lalu unduh.',
    h1: 'Hapus Jeda Hening Audio Online', body: 'Pangkas jeda panjang pada rekaman suara agar lebih padat. Atur ambang hening dan jeda yang disisakan supaya ucapan tetap natural.' },
  { slug: 'normalisasi-volume-audio', name: 'Normalisasi Volume (LUFS)',
    title: 'Normalisasi Volume Audio (LUFS) untuk Podcast & YouTube | PlayMuzeck',
    desc: 'Samakan loudness audio ke target LUFS: podcast -16, YouTube/Spotify -14, TV -23. Dilengkapi limiter puncak. Diproses di browser.',
    h1: 'Normalisasi Volume Audio (LUFS)', body: 'Atur loudness sesuai standar platform dengan pengukuran LUFS (ITU-R BS.1770). Puncak dijaga agar tidak melewati -1 dBFS.' },
  { slug: 'stereo-ke-mono', name: 'Stereo ke Mono',
    title: 'Ubah Audio Stereo ke Mono Online | PlayMuzeck',
    desc: 'Ubah file audio stereo menjadi mono untuk memperkecil ukuran dan menyamakan suara. Cepat, di browser, tanpa install.',
    h1: 'Ubah Stereo ke Mono Online', body: 'Gabungkan kanal kiri dan kanan menjadi satu. Cocok untuk rekaman suara bicara dan file yang perlu lebih kecil.' },
  { slug: 'metronom-online', name: 'Metronom Online',
    title: 'Metronom Online Gratis + Tap Tempo & Unduh Klik | PlayMuzeck',
    desc: 'Metronom online dengan tap tempo, birama, dan subdivisi. Bisa mengunduh klik metronom sebagai file MP3/WAV untuk latihan.',
    h1: 'Metronom Online', body: 'Atur tempo 30-300 BPM, birama, dan subdivisi. Gunakan tap tempo, atau unduh klik metronom sebagai berkas untuk latihan dan rekaman.' },
  { slug: 'tuner-online', name: 'Tuner Gitar Online',
    title: 'Tuner Gitar Online (Bass, Ukulele, Biola, Vokal) | PlayMuzeck',
    desc: 'Setel gitar, bass, ukulele, biola, atau cek nada vokal lewat mikrofon. Tuner kromatik dengan nada acuan, langsung di browser.',
    h1: 'Tuner Gitar Online', body: 'Setel instrumenmu lewat mikrofon perangkat. Pilih mode gitar, bass, ukulele, biola, atau kromatik untuk vokal, lalu ikuti jarumnya.' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function setMeta(html, attr, key, value) {
  const re = new RegExp(`<meta\\s+${attr}="${key}"[\\s\\S]*?>`);
  return html.replace(re, `<meta ${attr}="${key}" content="${esc(value)}" />`);
}

function buildPage(tpl, { url, title, desc, bodyHtml }) {
  let h = tpl;
  h = h.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
  h = setMeta(h, 'name', 'description', desc);
  h = setMeta(h, 'property', 'og:title', title);
  h = setMeta(h, 'property', 'og:description', desc);
  h = setMeta(h, 'property', 'og:url', url);
  h = setMeta(h, 'name', 'twitter:title', title);
  h = setMeta(h, 'name', 'twitter:description', desc);
  h = h.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}" />`);
  h = h.replace(/<link rel="alternate" hreflang="id-ID"[^>]*>/, `<link rel="alternate" hreflang="id-ID" href="${url}" />`);
  h = h.replace(/<link rel="alternate" hreflang="x-default"[^>]*>/, `<link rel="alternate" hreflang="x-default" href="${url}" />`);
  // Konten statis di dalam #root. createRoot() React akan menimpanya saat JS jalan.
  h = h.replace('<div id="root"></div>', `<div id="root">${bodyHtml}</div>`);
  return h;
}

const tpl = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

const toolLinks = TOOLS.map((t) => `<li><a href="/alat-audio/${t.slug}">${esc(t.name)}</a></li>`).join('');
const nav = `<nav><a href="/">Beranda</a> · <a href="/alat-audio">Semua Audio Tools</a></nav>`;

// 1) Halaman hub: /alat-audio
const hubTitle = '20 Audio Tools Online Gratis: Potong, Gabung, Konversi, BPM, Tuner | PlayMuzeck';
const hubDesc = '20 alat audio di browser: potong, gabung, konversi, ubah nada & tempo, deteksi BPM, normalisasi, nada dering, metronom, tuner, dan lainnya. Gratis dicoba.';
const pages = [];
pages.push({
  dir: 'alat-audio', url: `${ORIGIN}/alat-audio`,
  html: buildPage(tpl, { url: `${ORIGIN}/alat-audio`, title: hubTitle, desc: hubDesc,
    bodyHtml: `<main style="max-width:48rem;margin:2rem auto;padding:1rem;color:#e5e5e5;font-family:system-ui,sans-serif">${nav}<h1>20 Audio Tools Online</h1><p>Olah file audio milikmu langsung di browser. File diproses di perangkatmu, tidak diunggah ke server. Setiap alat gratis dicoba 2 kali per hari.</p><ul>${toolLinks}</ul></main>` }),
});

// 2) Satu halaman per alat
for (const t of TOOLS) {
  const url = `${ORIGIN}/alat-audio/${t.slug}`;
  pages.push({
    dir: `alat-audio/${t.slug}`, url,
    html: buildPage(tpl, { url, title: t.title, desc: t.desc,
      bodyHtml: `<main style="max-width:48rem;margin:2rem auto;padding:1rem;color:#e5e5e5;font-family:system-ui,sans-serif">${nav}<h1>${esc(t.h1)}</h1><p>${esc(t.body)}</p><p>File diproses di browser kamu dan tidak diunggah ke server. Gratis dicoba 2 kali per hari.</p><h2>Alat audio lainnya</h2><ul>${toolLinks}</ul></main>` }),
  });
}

for (const p of pages) {
  const dir = path.join(DIST, p.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), p.html);
}

// 3) sitemap.xml lengkap (menimpa public/sitemap.xml yang hanya berisi beranda)
const urls = [`${ORIGIN}/`, ...pages.map((p) => p.url)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
console.log(`SEO: ${pages.length} halaman + sitemap (${urls.length} URL) dibuat di dist/`);
