// scripts/generate-seo-pages.mjs
// Dijalankan SETELAH `vite build`. Membuat halaman HTML statis per Audio Tool
// (judul, deskripsi, canonical, JSON-LD, dan teks sendiri), halaman per bagian aplikasi (Aset Audio, Pad Editor,
// Harga, Pusat Kuis), + sitemap.xml lengkap di dist/.
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
  { slug: 'ulangi-audio', name: 'Ulangi Audio (Loop)',
    title: 'Ulangi Audio Online: Loop Lagu atau Rekaman 2 sampai 5 Kali | PlayMuzeck',
    desc: 'Ulangi file audio 2, 3, 4, atau 5 kali menjadi satu berkas, dengan crossfade opsional agar sambungan mulus. Diproses di browser.',
    h1: 'Ulangi Audio Online', body: 'Buat versi berulang dari lagu, efek suara, atau rekaman latihan. Pilih diulang 2 sampai 5 kali, atur crossfade agar akhir dan awal menyatu, lalu unduh sebagai satu berkas (maksimal 60 menit per hasil).' },
  { slug: 'edit-metadata-audio', name: 'Edit Metadata & Cover Audio (Tag ID3)',
    title: 'Edit Metadata Audio Online: Ubah Judul, Artis, Cover & Lirik | PlayMuzeck',
    desc: 'Edit tag MP3, FLAC, WAV, dan M4A langsung di browser: judul, artis, album, cover, lirik, tahun, genre, dan lainnya. Kualitas audio tidak berubah, file tidak diunggah.',
    h1: 'Edit Metadata & Cover Audio Online', body: 'Rapikan tag lagu koleksimu: ubah judul, artis, album, artis album, genre, tahun, nomor trek, komposer, hak cipta, ISRC, komentar, dan lirik, lalu ganti atau hapus gambar cover. Mendukung MP3 (ID3), FLAC, WAV, dan M4A. Audio tidak di-encode ulang sehingga kualitasnya persis sama, dan berkas diproses di perangkatmu.' },
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


// Isi tambahan untuk alat dengan kata kunci paling diperebutkan: langkah singkat + FAQ.
// Teks FAQ tampil di halaman DAN dipakai untuk schema FAQPage (harus selalu sama, sesuai pedoman Google).
// Hanya memuat hal yang memang dilakukan alatnya; sesuaikan bila fitur alat berubah.
const EXTRA = {
  'konversi-audio': {
    steps: ['Pilih file audio atau video dari perangkatmu.', 'Pilih format tujuan: MP3, WAV, FLAC, atau M4A.', 'Proses berjalan di browser, lalu unduh hasilnya.'],
    faq: [
      ['Format apa saja yang bisa dipilih untuk konversi audio?', 'Kamu bisa mengubah audio ke MP3, WAV, FLAC, atau M4A. M4A bergantung dukungan browser dan kadang menjadi .webm/.ogg.'],
      ['Apakah file saya diunggah ke server saat konversi?', 'Tidak. File dibaca dan diproses langsung di browser kamu, bukan di server PlayMuzeck.'],
      ['Bisakah mengambil audio dari file video?', 'Bisa. Alat ini dapat mengekstrak suara dari file video milikmu ke format audio pilihanmu.'],
      ['Apakah konversi audio ini gratis?', 'Gratis dicoba 2 kali per alat per hari. Untuk pemakaian tanpa batas harian tersedia paket Audio Tools berbayar (beli sekali).'],
    ],
  },
  'potong-audio': {
    steps: ['Pilih file lagu atau rekaman.', 'Tentukan titik awal dan akhir bagian yang ingin disimpan.', 'Dengarkan hasilnya, lalu unduh.'],
    faq: [
      ['Bagaimana cara memotong lagu atau rekaman di browser?', 'Pilih file, tentukan titik awal dan akhir, dengarkan hasilnya, lalu unduh potongannya. Tidak perlu memasang aplikasi.'],
      ['Apakah file saya diunggah ke server?', 'Tidak. Pemotongan berjalan di browser kamu dan file tidak diunggah ke server.'],
      ['Apakah potong audio ini gratis?', 'Gratis dicoba 2 kali per alat per hari; pemakaian tanpa batas harian memerlukan paket Audio Tools.'],
    ],
  },
  'gabung-audio': {
    steps: ['Tambahkan beberapa file audio.', 'Atur urutannya dan, bila perlu, tambahkan crossfade.', 'Unduh hasil gabungan sebagai MP3 atau WAV.'],
    faq: [
      ['Bagaimana cara menggabungkan beberapa lagu menjadi satu file?', 'Tambahkan file-filenya, atur urutan, pilih crossfade bila ingin sambungan halus, lalu unduh sebagai MP3 atau WAV.'],
      ['Apakah file saya diunggah ke server?', 'Tidak. Penggabungan diproses di browser kamu.'],
      ['Apakah gabung audio ini gratis?', 'Gratis dicoba 2 kali per alat per hari; pemakaian tanpa batas harian memerlukan paket Audio Tools.'],
    ],
  },
  'kompres-audio': {
    steps: ['Pilih file audio yang ingin diperkecil.', 'Pilih satu dari 5 tingkat kompresi dan lihat estimasi ukuran serta bitrate.', 'Unduh versi yang lebih kecil.'],
    faq: [
      ['Bagaimana cara memperkecil ukuran file audio?', 'Pilih satu dari 5 tingkat kompresi, lihat estimasi ukuran dan bitrate sebelum mengunduh, lalu unduh versi yang lebih kecil.'],
      ['Apakah file saya diunggah ke server?', 'Tidak. Kompresi berjalan di browser kamu.'],
      ['Apakah kompres audio ini gratis?', 'Gratis dicoba 2 kali per alat per hari; pemakaian tanpa batas harian memerlukan paket Audio Tools.'],
    ],
  },
};

// Bagian aplikasi yang bisa dibuka langsung lewat URL (lihat src/services/routes.ts).
const SECTIONS = [
  { path: 'audio/tools', name: 'Audio Tools', parent: 'Audio Studio',
    title: 'Audio Tools Online Gratis: Potong, Gabung, Konversi Audio | PlayMuzeck',
    desc: 'Alat audio online di browser: potong, gabung, ulangi, konversi MP3/WAV/FLAC/M4A, kompres, ubah nada & tempo, deteksi BPM & kunci, metronom, tuner. Gratis dicoba.',
    h1: 'Audio Tools Online', body: 'Olah file audio langsung di browser: potong, gabung, ulangi, konversi ke MP3, WAV, FLAC, atau M4A, kompres, ubah nada dan tempo, deteksi BPM dan kunci nada, metronom, hingga tuner. File diproses di perangkatmu dan tidak diunggah ke server. Setiap alat gratis dicoba 2 kali per hari.' },
  { path: 'audio/assets', name: 'Aset Audio', parent: 'Audio Studio',
    title: 'Aset Audio: Beli Lagu Orisinal Berlisensi Komersial (WAV, FLAC, Stem) | PlayMuzeck',
    desc: 'Katalog aset audio orisinal berlisensi komersial non-eksklusif. Beli per lagu: master WAV/FLAC/MP3/M4A, versi loop, stem, atau partitur PDF. Dengarkan stem di browser.',
    h1: 'Aset Audio: Katalog & Lisensi', body: 'Katalog lagu orisinal dengan lisensi komersial non-eksklusif. Beli per lagu hanya yang dibutuhkan: master (WAV, FLAC, MP3, M4A), versi loop, stem, atau partitur PDF. Dengarkan dan campur stem multi-track tiap lagu langsung di browser: atur volume, pan, mute, dan solo per instrumen.' },
  { path: 'audio/pad', name: 'Pad Editor', parent: 'Audio Studio',
    title: 'Drum Pad & Chord Pad Online: Buat Beat dan Progresi Akor | PlayMuzeck',
    desc: '10 pad drum, 128 akor, 4 track akor dengan 128 instrumen GM, sequencer 16 bar, dan rekam live di browser. Gratis Bar 1; ekspor MIDI/audio di editor penuh.',
    h1: 'Drum Pad & Chord Pad Online', body: 'Susun ritme dan progresi akor langsung di browser: 10 pad drum dengan 7 kit, 128 akor, 4 track akor dengan 128 instrumen GM, sequencer 16 bar, serta rekam live dengan dinamika dan undo/redo. Gratis: Bar 1, 3 kit drum, dan 1 track Grand Piano.' },
  { path: 'audio/pricing', name: 'Harga & Lisensi', parent: 'Audio Studio',
    title: 'Harga & Lisensi Audio Studio: Beli Sekali, Berlaku Permanen | PlayMuzeck',
    desc: 'Beli sekali, berlaku permanen: modul per lagu, Full 16-Bar Editor, Audio Tools tanpa batas harian, atau paket bundle 6 produk. Lisensi komersial non-eksklusif.',
    h1: 'Harga & Lisensi Audio Studio', body: 'Beli sekali, berlaku permanen: modul per lagu, Full 16-Bar Editor (16 bar, ekspor MIDI/audio, simpan proyek), Audio Tools tanpa batas harian, atau paket bundle 6 produk. Setiap pembelian lagu menyertakan berkas Readme_License.txt berisi ketentuan lisensi komersial non-eksklusif.' },
  { path: 'quiz/play', name: 'Mainkan Kuis', parent: 'Pusat Kuis',
    title: 'Main Kuis Multiplayer Online: Solo, Pass & Play, Host 10 Regu | PlayMuzeck',
    desc: 'Main kuis trivia berbahasa Indonesia: solo (opsional lawan bot), pass & play, host kuis hingga 10 regu, dan kuis multiplayer online dengan timer per soal.',
    h1: 'Main Kuis Multiplayer Online', body: 'Empat mode permainan: Solo (opsional lawan bot), pass and play, host kuis hingga 10 regu, dan multiplayer online, lengkap dengan timer per soal. Simpan hasil permainan dan tinjau jawaban per soal kapan saja.' },
  { path: 'quiz/library', name: 'Perpustakaan Kuis', parent: 'Pusat Kuis',
    title: 'Kuis Trivia Indonesia: Sains, Sejarah, Musik, Seni, Kuliner | PlayMuzeck',
    desc: 'Perpustakaan kuis trivia berbahasa Indonesia: sains, sejarah, musik, seni, teknologi, kuliner, dan lainnya. 3 starter deck gratis, deck tambahan tersedia.',
    h1: 'Perpustakaan Kuis Trivia', body: 'Belasan topik trivia: sains, sejarah, musik, seni, teknologi, kuliner, dan lainnya. Tiga starter deck bawaan siap main, deck tambahan tersedia di Perpustakaan.' },
  { path: 'quiz/hall', name: 'Aula Komunitas', parent: 'Pusat Kuis',
    title: 'Aula Komunitas Kuis: Kuis Buatan Pengguna & Papan Peringkat | PlayMuzeck',
    desc: 'Mainkan kuis buatan pengguna lain dan bagikan kuismu lewat Kuis Editor. Papan peringkat harian, bulanan, dan sepanjang waktu dari multiplayer online.',
    h1: 'Aula Komunitas Kuis', body: 'Mainkan kuis buatan pengguna lain; pemilik Kuis Editor bisa membagikan kuisnya. Papan peringkat harian, bulanan, dan sepanjang waktu berasal dari multiplayer online.' },
  { path: 'quiz/download', name: 'Pasang Web App', parent: 'Pusat Kuis',
    title: 'Pasang Pusat Kuis sebagai Aplikasi (PWA) & Main Kuis Luring | PlayMuzeck',
    desc: 'Pasang Pusat Kuis sebagai PWA atau unduh berkas standalone untuk main kuis tanpa internet. Multiplayer online tetap butuh koneksi.',
    h1: 'Pasang Pusat Kuis & Main Luring', body: 'Pasang sebagai PWA atau unduh berkas standalone untuk memainkan kuis tanpa internet. Multiplayer online tetap butuh internet.' },
];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
// Untuk di dalam <script type="application/ld+json">: cegah "</script>" memutus blok.
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

function setMeta(html, attr, key, value) {
  const re = new RegExp(`<meta\\s+${attr}="${key}"[\\s\\S]*?>`);
  return html.replace(re, `<meta ${attr}="${key}" content="${esc(value)}" />`);
}

function buildPage(tpl, { url, title, desc, bodyHtml, ld }) {
  let h = tpl;
  h = h.replace(/<title>[\s\S]*?<\/title>/, () => `<title>${esc(title)}</title>`);
  h = setMeta(h, 'name', 'description', desc);
  h = setMeta(h, 'property', 'og:title', title);
  h = setMeta(h, 'property', 'og:description', desc);
  h = setMeta(h, 'property', 'og:url', url);
  h = setMeta(h, 'name', 'twitter:title', title);
  h = setMeta(h, 'name', 'twitter:description', desc);
  h = h.replace(/<link rel="canonical"[^>]*>/, `<link rel="canonical" href="${url}" />`);
  h = h.replace(/<link rel="alternate" hreflang="id-ID"[^>]*>/, `<link rel="alternate" hreflang="id-ID" href="${url}" />`);
  h = h.replace(/<link rel="alternate" hreflang="x-default"[^>]*>/, `<link rel="alternate" hreflang="x-default" href="${url}" />`);
  // JSON-LD khusus halaman ini menggantikan blok milik beranda (FAQ/ItemList beranda tidak diulang di tiap halaman).
  h = h.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${jsonLd(ld)}</script>`);
  // Konten statis di dalam #root. createRoot() React akan menimpanya saat JS jalan.
  h = h.replace(/<div id="root">[\s\S]*?<\/div>\s*<script type="module"/, () => `<div id="root">${bodyHtml}</div>\n    <script type="module"`);
  return h;
}

const tpl = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');

const toolLinks = TOOLS.map((t) => `<li><a href="/alat-audio/${t.slug}">${esc(t.name)}</a></li>`).join('');
const sectionLinks = SECTIONS.map((x) => `<li><a href="/${x.path}">${esc(x.parent)}: ${esc(x.name)}</a></li>`).join('');
const nav = `<nav><a href="/">Beranda</a> · <a href="/alat-audio">Semua Audio Tools</a></nav>`;
const wrap = (inner) => `<main style="max-width:48rem;margin:2rem auto;padding:1rem;color:#e5e5e5;font-family:system-ui,sans-serif;line-height:1.6">${nav}${inner}</main>`;

const crumbs = (items) => ({
  '@type': 'BreadcrumbList',
  itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })),
});
const app = (name, url, description) => ({
  '@type': 'WebApplication', name, url, description, applicationCategory: 'MultimediaApplication',
  operatingSystem: 'All', inLanguage: 'id-ID', isPartOf: { '@id': `${ORIGIN}/#website` },
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'IDR', availability: 'https://schema.org/InStock' },
});

const pages = [];

// 1) Halaman hub: /alat-audio
const hubTitle = '20 Audio Tools Online Gratis: Potong, Gabung, Konversi, BPM, Tuner | PlayMuzeck';
const hubDesc = '20 alat audio di browser: potong, gabung, konversi, ubah nada & tempo, deteksi BPM, normalisasi, nada dering, metronom, tuner, dan lainnya. Gratis dicoba.';
pages.push({
  dir: 'alat-audio', url: `${ORIGIN}/alat-audio`,
  html: buildPage(tpl, { url: `${ORIGIN}/alat-audio`, title: hubTitle, desc: hubDesc,
    ld: { '@context': 'https://schema.org', '@graph': [
      crumbs([{ name: 'PlayMuzeck', url: `${ORIGIN}/` }, { name: 'Audio Tools', url: `${ORIGIN}/alat-audio` }]),
      { '@type': 'ItemList', name: 'Audio Tools Online PlayMuzeck',
        itemListElement: TOOLS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: `${ORIGIN}/alat-audio/${t.slug}` })) },
    ] },
    bodyHtml: wrap(`<h1>Audio Tools Online</h1><p>Olah file audio milikmu langsung di browser. File diproses di perangkatmu, tidak diunggah ke server. Setiap alat gratis dicoba 2 kali per hari.</p><ul>${toolLinks}</ul><h2>Bagian lain PlayMuzeck</h2><ul>${sectionLinks}</ul>`) }),
});

// 2) Satu halaman per alat
for (const t of TOOLS) {
  const url = `${ORIGIN}/alat-audio/${t.slug}`;
  const ex = EXTRA[t.slug];
  pages.push({
    dir: `alat-audio/${t.slug}`, url,
    html: buildPage(tpl, { url, title: t.title, desc: t.desc,
      ld: { '@context': 'https://schema.org', '@graph': [
        crumbs([{ name: 'PlayMuzeck', url: `${ORIGIN}/` }, { name: 'Audio Tools', url: `${ORIGIN}/alat-audio` }, { name: t.name, url }]),
        app(t.name, url, t.desc),
        ...(ex ? [{ '@type': 'FAQPage', mainEntity: ex.faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }] : []),
      ] },
      bodyHtml: wrap(`<h1>${esc(t.h1)}</h1><p>${esc(t.body)}</p><p>File diproses di browser kamu dan tidak diunggah ke server. Gratis dicoba 2 kali per hari.</p>${ex ? `<h2>Cara menggunakan</h2><ol>${ex.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol><h2>Pertanyaan umum</h2>${ex.faq.map(([q, a]) => `<h3>${esc(q)}</h3><p>${esc(a)}</p>`).join('')}` : ''}<h2>Alat audio lainnya</h2><ul>${toolLinks}</ul>`) }),
  });
}

// 3) Halaman per bagian aplikasi (URL yang sama dengan rute di aplikasi)
for (const x of SECTIONS) {
  const url = `${ORIGIN}/${x.path}`;
  pages.push({
    dir: x.path, url,
    html: buildPage(tpl, { url, title: x.title, desc: x.desc,
      ld: { '@context': 'https://schema.org', '@graph': [
        crumbs([{ name: 'PlayMuzeck', url: `${ORIGIN}/` }, { name: x.parent, url: `${ORIGIN}/${x.path.split('/')[0] === 'audio' ? 'audio/tools' : 'quiz/library'}` }, { name: x.name, url }]),
        app(`PlayMuzeck ${x.name}`, url, x.desc),
      ] },
      bodyHtml: wrap(`<h1>${esc(x.h1)}</h1><p>${esc(x.body)}</p><h2>Jelajahi PlayMuzeck</h2><ul>${sectionLinks}</ul><h2>Audio Tools</h2><ul>${toolLinks}</ul>`) }),
  });
}

for (const p of pages) {
  const dir = path.join(DIST, p.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), p.html);
}

// 4) sitemap.xml lengkap (menimpa public/sitemap.xml)
const urls = [`${ORIGIN}/`, ...pages.map((p) => p.url)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`;
fs.writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap);
console.log(`SEO: ${pages.length} halaman + sitemap (${urls.length} URL) dibuat di dist/`);
