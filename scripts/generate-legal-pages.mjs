// generate-legal-pages.mjs
// Membuat halaman statis PlayMuzeck: /about, /contact, /privacy, /terms, /cookie, /copyright, /support
// (semua path berbahasa Inggris dan seragam; label di layar tetap Indonesia).
// Otomatis dijalankan oleh `npm run build` dan `npm run dev` (lihat package.json). Manual: npm run legal
// Output: public/{privacy,terms,cookie,contact,about,copyright,support}/index.html (di-gitignore, dibuat ulang tiap build)
// URL lama (/dukung, /hak-cipta) dialihkan 301 lewat public/_redirects; folder lamanya dihapus otomatis di sini.
//
// Tata letak: header dan footer meniru aplikasi. Header hanya berisi logo + tombol "Buka PlayMuzeck";
// SEMUA tautan navigasi ada di footer (sama seperti di aplikasi), jadi tidak ada menu yang muncul dua kali.
//
// Tema: halaman-halaman ini memakai variabel warna yang SAMA dengan aplikasi (--t-surface, --t-accent, dst).
// Skrip kecil di <head> membaca palet tersimpan di localStorage ('pm_palette', ditulis oleh aplikasi saat
// pengguna memilih/mendapat tema), jadi halaman ini ikut tema pengguna, termasuk mode terang.
import fs from 'node:fs';
import path from 'node:path';

// Konfigurasi dibaca dari legal.config.json di folder utama proyek (email, nama pemilik, biaya).
// Argumen CLI (opsional) menimpa: node scripts/generate-legal-pages.mjs "email" "nama"
const ARGS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const ALLOW_PLACEHOLDER = process.argv.includes('--allow-placeholder');
let CFG = {};
try { CFG = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'legal.config.json'), 'utf8')); } catch {}
const EMAIL = ARGS[0] || process.env.LEGAL_EMAIL || CFG.email || 'GANTI-EMAIL@contoh.com';
const OWNER = ARGS[1] || process.env.LEGAL_OWNER || CFG.owner || 'GANTI NAMA PEMILIK';
const OUT = path.resolve(process.cwd(), 'public');
const isPlaceholder = (v) => !v || /GANTI|contoh\.com|@example\./i.test(v);
if (isPlaceholder(EMAIL) || isPlaceholder(OWNER)) {
  const msg = 'legal.config.json belum diisi: isi "email" (email bisnis) dan "owner" (nama pemilik atau nama brand/tim) lalu jalankan lagi. Halaman hukum TIDAK boleh dipublikasikan dengan data placeholder.';
  if (!ALLOW_PLACEHOLDER) { console.error('GAGAL: ' + msg); process.exit(1); }
  console.warn('PERINGATAN (mode dev): ' + msg);
}

const SITE = 'PlayMuzeck';
const ORIGIN = 'https://playmuzeck.my.id';
const UPDATED = '9 Oktober 2026';
const UPDATED_ISO = '2026-10-09';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ───────────────────────── TEMA ─────────────────────────
// Skrip ini berjalan SEBELUM <body> digambar supaya tidak ada kedipan warna.
// Rumusnya sama persis dengan paletteVars() di src/theme/theme.ts.
const THEME_SCRIPT = `(function(){try{
var p=JSON.parse(localStorage.getItem('pm_palette')||'null');
var H=/^#[0-9a-fA-F]{6}$/;
if(!p||!H.test(p.surface)||!H.test(p.accent)||!H.test(p.accent2))return;
function rgb(x){var n=parseInt(x.slice(1),16);return[n>>16,(n>>8)&255,n&255];}
function lum(x){var c=rgb(x);return .299*c[0]+.587*c[1]+.114*c[2];}
function mix(a,b,t){var A=rgb(a),B=rgb(b);return '#'+A.map(function(v,i){return Math.round(v+(B[i]-v)*t).toString(16).padStart(2,'0');}).join('');}
function on(x){return lum(x)>150?'#000000':'#ffffff';}
var light=lum(p.surface)>140,r=document.documentElement;
var v={'--t-surface':p.surface,'--t-accent':p.accent,'--t-accent2':p.accent2,'--t-on-accent':on(p.accent),'--t-on-accent2':on(p.accent2),
'--t-deep':mix(p.surface,'#000000',light?0.035:0.35),'--t-bg':light?mix(p.surface,'#000000',0.05):'#000000','--t-fg':light?'#1f2937':'#E5E5E5'};
for(var k in v)r.style.setProperty(k,v[k]);
r.setAttribute('data-mode',light?'light':'dark');
}catch(e){}})();`;

const CSS = `
:root{
  --t-surface:#14213D;--t-accent:#FCA311;--t-accent2:#FC1212;--t-on-accent:#000000;--t-on-accent2:#ffffff;
  --t-deep:#0d1628;--t-bg:#000000;--t-fg:#E5E5E5;
  --ink:#ffffff;--muted:#9ca3af;--faint:#6b7280;--line:rgba(255,255,255,.1);--foot-bg:rgba(0,0,0,.3);
  color-scheme:dark;
}
html[data-mode="light"]{
  --ink:#0f172a;--muted:#4b5563;--faint:#6b7280;--line:rgba(15,23,42,.14);--foot-bg:rgba(15,23,42,.04);
  color-scheme:light;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;flex-direction:column;background:var(--t-bg);color:var(--t-fg);font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
a{color:var(--t-accent)}
code{font-size:.85em;word-break:break-all}

/* Header: sama dengan header aplikasi (bg panel + blur, logo + nama di kiri, satu tombol aksi di kanan).
   Menu navigasi TIDAK ditaruh di sini: semuanya ada di footer, persis seperti di aplikasi. */
header.top{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--t-surface) 95%,transparent);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);padding:max(.625rem,env(safe-area-inset-top,0px)) .75rem .625rem}
header.top .in{max-width:80rem;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.brand{display:flex;align-items:center;gap:.5rem;text-decoration:none;color:var(--ink);min-width:0}
.brand .logo{width:2.25rem;height:2.25rem;flex:none;border-radius:1rem;overflow:hidden;padding:.25rem;background:var(--t-surface);border:1px solid var(--line);box-shadow:0 4px 6px -1px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .15s}
.brand:hover .logo{transform:scale(1.05)}
.brand .logo img{width:100%;height:100%;object-fit:contain;border-radius:.75rem;display:block}
.brand .name{display:flex;flex-direction:column;min-width:0}
.brand .name b{font-size:1rem;font-weight:900;letter-spacing:-.025em;line-height:1;color:var(--ink);white-space:nowrap}
.brand .name b i{font-style:normal;color:var(--t-accent)}
.brand .name small{font:400 .625rem ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;color:var(--muted);white-space:nowrap}
@media (max-width:399px){header.top .brand .name{display:none}}
/* Tombol di header: ukuran & gaya sama dengan tombol "Tentang Kami" di header aplikasi */
.hbtn{display:inline-flex;align-items:center;height:2.5rem;padding:0 .75rem;border-radius:.75rem;border:1px solid var(--t-accent);background:var(--t-accent);color:var(--t-on-accent);font-size:.75rem;font-weight:900;text-decoration:none;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.25)}
.hbtn:hover{opacity:.9}
@media (min-width:640px){
  header.top{padding-left:2rem;padding-right:2rem}
  .brand .logo{width:2.5rem;height:2.5rem}
  .brand .name b{font-size:1.125rem}
  .hbtn{height:2.25rem;padding:0 .875rem}
}

main{width:100%;max-width:52rem;margin:0 auto;padding:2rem 1rem 3rem;flex:1 0 auto}
h1{font-size:1.9rem;line-height:1.25;margin:.2rem 0 .3rem;color:var(--ink)}
h2{font-size:1.25rem;margin:2.1rem 0 .5rem;color:var(--ink);padding-top:.4rem;border-top:1px solid var(--line)}
h3{font-size:1.02rem;margin:1.2rem 0 .3rem;color:var(--ink)}
p,li{color:var(--t-fg)}
ul,ol{padding-left:1.3rem}
li{margin:.25rem 0}
.meta{color:var(--muted);font-size:.9rem;margin-bottom:1.4rem}
.note{background:var(--t-surface);border:1px solid var(--line);border-left:3px solid var(--t-accent);border-radius:.6rem;padding:.8rem 1rem;margin:1rem 0}
table{width:100%;border-collapse:collapse;margin:.8rem 0;font-size:.92rem}
th,td{border:1px solid var(--line);padding:.5rem .6rem;text-align:left;vertical-align:top}
th{background:var(--t-surface);color:var(--ink)}
.card{background:var(--t-surface);border:1px solid var(--line);border-radius:.8rem;padding:1rem 1.1rem;margin:1rem 0}
.btn{display:inline-block;background:var(--t-accent);color:var(--t-on-accent);font-weight:800;text-decoration:none;padding:.6rem 1.1rem;border-radius:.6rem}
button.btn{border:0;cursor:pointer;font:inherit;font-weight:800;line-height:1.4}
button.btn:disabled{opacity:.5;cursor:not-allowed}
.btn.alt{background:transparent;color:var(--ink);border:1px solid var(--line)}
.muted{color:var(--muted)}

/* Footer: sama dengan footer aplikasi.
   Kiri = logo, tengah = dua baris tautan, kanan = hak cipta.
   Kiri dan kanan berada di tengah vertikal terhadap SELURUH blok tautan. */
footer.bot{border-top:1px solid var(--line);background:var(--foot-bg);margin-top:auto}
footer.bot .in{max-width:80rem;margin:0 auto;padding:1.5rem 1rem max(1.5rem,env(safe-area-inset-bottom,0px));display:flex;flex-direction:column;align-items:center;gap:1rem;font-size:.75rem;line-height:1.5;color:var(--muted);text-align:center}
footer.bot .mid{display:flex;flex-direction:column;align-items:center;gap:.75rem;min-width:0}
footer.bot .row{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.5rem 1.25rem}
footer.bot .row.legal{color:var(--faint)}
footer.bot a{color:inherit;text-decoration:none}
footer.bot a:hover{color:var(--ink)}
footer.bot a[aria-current]{color:var(--ink)}
@media (min-width:640px){footer.bot .in{padding-left:2rem;padding-right:2rem}}
footer.bot .brand .name b{font-size:.875rem;font-weight:800}
footer.bot .brand .name{display:flex}
footer.bot .brand:hover .logo{transform:none}
@media (min-width:1024px){
  footer.bot .in{display:grid;grid-template-columns:1fr minmax(0,auto) 1fr;align-items:center;gap:1.5rem}
  footer.bot .brand{justify-self:start}
  footer.bot .copy{justify-self:end}
}
@media (max-width:480px){h1{font-size:1.5rem}}
`;

// Footer baris 1 (sama dengan footer aplikasi)
const FOOT_MAIN = [
  ['/', 'Beranda'],
  ['/audio/tools', 'Audio Studio'],
  ['/quiz/library', 'Pusat Kuis'],
];
// Footer baris 2 (sama dengan footer aplikasi). Pengaturan cookie sengaja TIDAK jadi tautan terpisah:
// pengaturannya ada di halaman Kebijakan Cookie (/cookie), satu sumber yang sama dengan kebijakannya.
const FOOT_LEGAL = [
  ['/support', 'Dukung Kami'],
  ['/about', 'Tentang'],
  ['/contact', 'Kontak'],
  ['/privacy', 'Privasi'],
  ['/cookie', 'Kebijakan Cookie'],
  ['/terms', 'Syarat & Ketentuan'],
  ['/copyright', 'Hak Cipta'],
];

// withTagline = true -> versi header (ikon logo + nama + tagline). false -> versi footer (teks nama saja, tanpa ikon).
const brandBlock = (withTagline) => `<a class="brand" href="/" aria-label="Ke Halaman Utama ${SITE}" title="Ke Halaman Utama ${SITE}">
${withTagline ? `<span class="logo"><img src="/PlayMuzeck-logo.png" alt="${SITE} Logo" width="40" height="40" /></span>\n` : ''}<span class="name"><b>${SITE}<i>.</i></b>${withTagline ? '<small>AUDIO &amp; KUIS</small>' : ''}</span>
</a>`;

function page({ slug, title, desc, h1, body }) {
  const url = `${ORIGIN}/${slug}`;
  const ld = {
    '@context': 'https://schema.org',
    '@type': slug === 'about' ? 'AboutPage' : slug === 'contact' ? 'ContactPage' : 'WebPage',
    name: title, url, description: desc, inLanguage: 'id-ID',
    isPartOf: { '@type': 'WebSite', name: SITE, url: `${ORIGIN}/` },
    dateModified: UPDATED_ISO,
  };
  const plain = ([h, t]) => `<a href="${h}"${h === '/' + slug ? ' aria-current="page"' : ''}>${esc(t)}</a>`;
  return `<!doctype html>
<html lang="id" data-mode="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="index, follow" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${SITE}" />
<meta property="og:locale" content="id_ID" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${ORIGIN}/PlayMuzeck-logo.png" />
<meta name="theme-color" content="#14213D" />
<link rel="icon" type="image/png" href="/PlayMuzeck-logo.png" />
<link rel="apple-touch-icon" href="/PlayMuzeck-logo.png" />
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>
<script>${THEME_SCRIPT}</script>
<style>${CSS}</style>
</head>
<body>
<header class="top"><div class="in">
${brandBlock(true)}
<a class="hbtn" href="/">Buka PlayMuzeck</a>
</div></header>
<main>
<h1>${esc(h1)}</h1>
<p class="meta">Terakhir diperbarui: ${UPDATED}</p>
${body}
</main>
<footer class="bot"><div class="in">
${brandBlock(false)}
<div class="mid">
<nav class="row" aria-label="Navigasi footer">${FOOT_MAIN.map(plain).join('')}</nav>
<nav class="row legal" aria-label="Tautan hukum">${FOOT_LEGAL.map(plain).join('')}</nav>
</div>
<span class="copy">&copy; ${new Date().getFullYear()} ${SITE}</span>
</div></footer>
</body>
</html>
`;
}

const mail = `<a href="mailto:${EMAIL}">${EMAIL}</a>`;

// ───────────────────────── KEBIJAKAN PRIVASI ─────────────────────────
const privacy = `
<p>Kebijakan Privasi ini menjelaskan data apa yang ${SITE} ("<strong>kami</strong>") kumpulkan saat kamu memakai situs <a href="${ORIGIN}/">${ORIGIN.replace('https://', '')}</a>, untuk apa data itu dipakai, siapa saja yang menerimanya, dan hak-hakmu. Dengan memakai ${SITE} kamu menyetujui praktik yang dijelaskan di sini. Kebijakan ini disusun dengan memperhatikan Undang-Undang No. 27 Tahun 2022 tentang Pelindungan Data Pribadi (UU PDP) dan UU ITE.</p>

<h2>1. Pengendali data</h2>
<p>Pengendali data pribadi adalah <strong>${esc(OWNER)}</strong>, pengelola ${SITE}, berdomisili di Indonesia. Pertanyaan soal data pribadi dapat dikirim ke ${mail}.</p>

<h2>2. Data yang kami kumpulkan</h2>
<h3>a. Data yang kamu berikan</h3>
<ul>
<li><strong>Akun:</strong> nama tampilan, alamat email, dan kata sandi (disimpan dalam bentuk hash satu arah, bukan teks asli). Bila kamu memilih <em>Masuk dengan Google</em>, kami menerima nama, email, dan foto profil dari akun Google-mu. Kami tidak menerima kata sandi Google-mu.</li>
<li><strong>Profil:</strong> bio singkat, avatar/bingkai, tema, dan pengaturan suara yang kamu pilih.</li>
<li><strong>Konten buatanmu:</strong> kuis yang kamu bagikan di Aula Komunitas, proyek Pad Editor yang kamu simpan, dan permintaan custom audio.</li>
<li><strong>Pesan:</strong> masukan, aduan, atau laporan bug yang kamu kirim, termasuk alamat email pengirim.</li>
<li><strong>Transaksi:</strong> daftar pesanan, produk yang dibeli, status pembayaran, dan catatan donasi.</li>
</ul>
<h3>b. Data yang dikumpulkan otomatis</h3>
<ul>
<li><strong>Aktivitas penggunaan:</strong> hasil dan riwayat kuis, skor papan peringkat, koleksi aset, pemakaian kuota harian Audio Tools (dicatat per akun), serta, <strong>hanya bila kamu menyetujuinya</strong> lewat banner cookie, peristiwa analitik ringan (misalnya kuis dimulai atau selesai) yang dikaitkan dengan <em>ID sesi acak</em> di perangkatmu.</li>
<li><strong>Data teknis:</strong> alamat IP, jenis peramban/perangkat, dan waktu akses pada log server. Kami memakainya untuk keamanan, pembatasan laju permintaan (<em>rate limiting</em>), dan pencegahan penyalahgunaan.</li>
</ul>
<h3>c. File audio yang kamu olah</h3>
<div class="note">Alat di Audio Tools (potong, gabung, konversi, kompres, ubah nada, deteksi BPM, dan sebagainya) berjalan <strong>di dalam peramban/perangkatmu</strong>. File yang kamu pilih untuk diolah <strong>tidak diunggah ke server kami</strong>. Server hanya mencatat jumlah pemakaian alat untuk kuota harian. Pengecualian hanya bila kamu sendiri mengirim berkas lewat fitur yang jelas meminta unggahan, misalnya permintaan custom audio.</div>
<h3>d. Pembayaran</h3>
<p>Pembayaran diproses oleh <strong>Midtrans</strong>. Pembayaran dilakukan di jendela pembayaran Midtrans, terutama lewat QRIS, dan metode lain mengikuti yang tersedia di sana. Kredensial pembayaranmu (misalnya nomor kartu atau PIN, bila memakai metode itu) diproses langsung oleh Midtrans dan penyedia pembayaran terkait; <strong>kami tidak menyimpannya</strong>. Kami hanya menerima status transaksi dan rincian pesanan.</p>

<h2>3. Untuk apa data dipakai</h2>
<table>
<tr><th>Tujuan</th><th>Dasar pemrosesan</th></tr>
<tr><td>Membuat dan mengelola akun, login, verifikasi email, reset kata sandi</td><td>Pelaksanaan layanan / perjanjian</td></tr>
<tr><td>Memproses pesanan, memberi akses ke produk yang dibeli, mengirim bukti dan berkas lisensi</td><td>Pelaksanaan perjanjian, kewajiban hukum</td></tr>
<tr><td>Menjalankan kuis, multiplayer, papan peringkat, dan Aula Komunitas</td><td>Pelaksanaan layanan</td></tr>
<tr><td>Moderasi konten dan nama untuk mencegah konten melanggar hukum</td><td>Kepentingan sah, kewajiban hukum</td></tr>
<tr><td>Keamanan, anti-bot (Cloudflare Turnstile), pembatasan kuota dan penyalahgunaan</td><td>Kepentingan sah</td></tr>
<tr><td>Analitik untuk memperbaiki fitur dan performa</td><td><strong>Persetujuan</strong> (opsional, dapat ditarik kapan saja)</td></tr>
<tr><td>Membalas pesanmu dan mengirim pemberitahuan layanan</td><td>Pelaksanaan layanan, kepentingan sah</td></tr>
</table>
<p>Kami <strong>tidak menjual</strong> data pribadimu.</p>

<h2>4. Cookie dan penyimpanan lokal</h2>
<p>Kami memakai dua jenis:</p>
<ul>
<li><strong>Wajib</strong> (tanpa persetujuan, karena layanan tidak bisa berjalan tanpanya): cookie sesi login <code>muzeck_sid</code>, cookie pengikat pendaftaran <code>muzeck_signup</code>, serta data di <em>localStorage</em>/<em>sessionStorage</em> untuk keranjang, progres kuis, tema dan suara pilihanmu, dan catatan pilihan cookie-mu sendiri. Anti-bot Cloudflare Turnstile dan penyedia pembayaran juga bekerja saat kamu mendaftar atau membayar.</li>
<li><strong>Analitik</strong> (opsional, <strong>default mati</strong>): hanya aktif jika kamu menekan "Terima" di banner cookie atau mengaktifkannya di bagian Pengaturan Cookie pada halaman <a href="/cookie">Kebijakan Cookie</a>.</li>
</ul>
<p>Kamu dapat <strong>menolak, menerima, atau mengubah pilihan kapan saja</strong> lewat bagian Pengaturan Cookie di halaman <a href="/cookie#consent-box">Kebijakan Cookie</a>. Menolak tidak mengurangi fitur apa pun. Peramban yang mengirim sinyal Global Privacy Control atau "Do Not Track" kami anggap sebagai penolakan analitik. Daftar lengkap setiap cookie dan penyimpanan lokal ada di <a href="/cookie">Kebijakan Cookie</a>.</p>

<h2>5. Tanpa iklan</h2>
<p>${SITE} <strong>tidak menayangkan iklan</strong> dan tidak menjual data pribadimu kepada pengiklan atau pialang data. Karena itu kami tidak memasang cookie iklan atau pelacak periklanan pihak ketiga. Biaya operasional ditopang dari penjualan aset/modul dan donasi sukarela (lihat <a href="/support">Dukung PlayMuzeck</a>). Bila di masa depan kebijakan ini berubah, kami akan memperbarui halaman ini lebih dulu dan memberi tahu pengguna.</p>

<h2>5b. Data donasi</h2>
<p>Data donasi (nominal, waktu, dan akun donatur) kami simpan untuk memberikan bingkai profil, mencatat total donasi, dan pembukuan. Hanya <strong>total dan jumlah donatur</strong> yang ditampilkan ke publik, tanpa nama atau email. Pembayaran diproses oleh Midtrans (lihat bagian 2d).</p>

<h2>6. Pihak ketiga yang menerima data</h2>
<p>Kami memakai penyedia layanan berikut untuk menjalankan ${SITE}. Mereka hanya memproses data sebatas yang diperlukan untuk layanannya:</p>
<table>
<tr><th>Penyedia</th><th>Fungsi</th></tr>
<tr><td>Railway</td><td>Hosting server aplikasi dan basis data (menyimpan data akun, pesanan, dan aktivitas)</td></tr>
<tr><td>Google (Sign-In)</td><td>Masuk dengan Google</td></tr>
<tr><td>Cloudflare (Turnstile)</td><td>Anti-bot pada formulir daftar, masuk, dan lupa kata sandi</td></tr>
<tr><td>Midtrans</td><td>Pemrosesan pembayaran</td></tr>
<tr><td>Resend</td><td>Pengiriman email (verifikasi, reset kata sandi, notifikasi, bukti pembelian)</td></tr>
<tr><td>Supabase</td><td>Penyimpanan berkas</td></tr>
</table>
<p>Kami juga dapat mengungkapkan data bila diwajibkan oleh hukum, putusan pengadilan, atau permintaan resmi aparat berwenang, atau untuk melindungi hak, keamanan, dan properti kami maupun pengguna. Bila usaha ini dialihkan ke pihak lain, data dapat ikut dialihkan dengan perlindungan yang setara.</p>

<h2>7. Penyimpanan dan penghapusan data</h2>
<ul>
<li>Data akun disimpan selama akunmu aktif.</li>
<li>Kamu dapat meminta <strong>penghapusan akun</strong> lewat Dasbor Profil atau email. Akun dijadwalkan dihapus <strong>3 hari</strong> setelah permintaan dan tetap bisa dipakai selama masa tunggu itu; kamu dapat membatalkannya. Setelah masa tunggu, akun dan data pribadi terkait dihapus permanen.</li>
<li>Catatan transaksi dan data yang wajib kami simpan menurut ketentuan perpajakan, akuntansi, atau hukum lain dapat disimpan lebih lama sebatas yang diwajibkan.</li>
<li>Kuis yang sudah kamu bagikan ke komunitas dapat dihapus atau dianonimkan sesuai permintaan.</li>
<li>Log keamanan dan cadangan dihapus secara berkala.</li>
</ul>

<h2>8. Keamanan</h2>
<p>Kami menerapkan langkah wajar: koneksi HTTPS, hash kata sandi, cookie sesi HttpOnly, pembatasan laju permintaan, anti-bot, kontrol akses admin, dan header keamanan peramban. Tidak ada sistem yang 100% aman, jadi kami tidak dapat menjamin keamanan mutlak. Jaga kerahasiaan kata sandimu dan segera hubungi kami bila menduga akunmu disalahgunakan.</p>

<h2>9. Hakmu atas data pribadi</h2>
<p>Sesuai UU PDP, kamu berhak untuk: mengakses dan meminta salinan datamu; memperbaiki data yang keliru; meminta penghapusan atau penghentian pemrosesan; menarik persetujuan; mengajukan keberatan atas pemrosesan tertentu; dan menunda atau membatasi pemrosesan. Kirim permintaan ke ${mail} dari email akunmu. Kami berupaya menjawab dalam <strong>3 x 24 jam kerja</strong> untuk konfirmasi dan menyelesaikan permintaan sesuai batas waktu hukum yang berlaku.</p>

<h2>10. Anak-anak</h2>
<p>${SITE} tidak ditujukan untuk anak di bawah 13 tahun. Pengguna di bawah 18 tahun harus memakai layanan dengan izin dan pengawasan orang tua atau wali. Bila kamu orang tua dan mengetahui anakmu memberi data tanpa izin, hubungi kami agar data tersebut dihapus.</p>

<h2>11. Transfer data lintas negara</h2>
<p>Sebagian penyedia layanan kami (misalnya Railway, Google, Cloudflare, Resend, Supabase) memproses data di server di luar Indonesia. Server aplikasi dan basis data kami berada di kawasan Asia Tenggara. Kami memilih penyedia yang menerapkan perlindungan data yang memadai dan hanya mengirim data yang diperlukan.</p>

<h2>12. Tautan ke situs lain</h2>
<p>${SITE} dapat memuat tautan ke situs pihak ketiga. Kami tidak mengendalikan dan tidak bertanggung jawab atas kebijakan privasi situs tersebut.</p>

<h2>12b. Pengguna di Uni Eropa, EEA, dan Inggris</h2>
<p>${SITE} ditujukan terutama untuk pengguna di Indonesia. Bila kamu berada di Uni Eropa/EEA atau Inggris, GDPR/UK GDPR memberimu hak yang sejalan dengan hak di atas, yaitu akses, perbaikan, penghapusan, pembatasan, keberatan, portabilitas data, dan menarik persetujuan kapan saja tanpa memengaruhi pemrosesan sebelumnya. Dasar hukum kami: pelaksanaan perjanjian (akun, pesanan), kewajiban hukum (pembukuan), kepentingan sah (keamanan, moderasi), dan persetujuan (analitik). Kamu juga berhak mengadu ke otoritas pelindungan data di negaramu. Data dapat diproses di luar wilayahmu (lihat bagian 11) dengan perlindungan yang disediakan penyedia layanan kami. Gunakan ${mail} untuk menjalankan hakmu.</p>

<h2>13. Perubahan kebijakan</h2>
<p>Kebijakan ini dapat diperbarui. Tanggal "Terakhir diperbarui" di atas menunjukkan versi terkini. Untuk perubahan penting, kami akan memberi tahu lewat situs atau email. Memakai layanan setelah perubahan berarti kamu menerima versi baru.</p>

<h2>14. Kontak</h2>
<p>Pertanyaan, permintaan data, atau keluhan: ${mail}. Lihat juga <a href="/contact">halaman Kontak</a> dan <a href="/terms">Syarat &amp; Ketentuan</a>.</p>
`;

// ───────────────────────── SYARAT & KETENTUAN ─────────────────────────
const terms = `
<p>Selamat datang di ${SITE}. Dengan mengakses atau memakai <a href="${ORIGIN}/">${ORIGIN.replace('https://', '')}</a> ("<strong>Layanan</strong>") kamu setuju terikat pada Syarat &amp; Ketentuan ini dan <a href="/privacy">Kebijakan Privasi</a>. Bila tidak setuju, mohon jangan memakai Layanan.</p>

<h2>1. Tentang Layanan</h2>
<p>${SITE} adalah platform berbahasa Indonesia yang menyediakan: (a) <strong>Audio Tools</strong>, alat pengolah audio di peramban; (b) <strong>Aset Audio</strong>, lagu orisinal berlisensi komersial non-eksklusif beserta loop, stem, dan partitur; (c) <strong>Pad Editor</strong> (drum pad dan chord pad); dan (d) <strong>Pusat Kuis</strong>, kuis trivia, multiplayer, dan Aula Komunitas. Layanan dikelola oleh ${esc(OWNER)}, Indonesia.</p>

<h2>2. Akun</h2>
<ul>
<li>Beberapa fitur, termasuk Audio Tools dan Pusat Kuis, memerlukan akun. Data yang kamu berikan harus benar dan terbaru.</li>
<li>Kamu bertanggung jawab atas kerahasiaan kata sandi dan seluruh aktivitas di akunmu.</li>
<li>Pengguna di bawah 18 tahun memakai Layanan dengan izin orang tua atau wali.</li>
<li>Satu orang sebaiknya memakai satu akun. Kami dapat menggabungkan, membatasi, atau menutup akun ganda atau yang disalahgunakan.</li>
</ul>

<h2>3. Audio Tools dan file milikmu</h2>
<ul>
<li>File yang kamu olah diproses di perangkatmu dan tidak diunggah ke server kami (lihat Kebijakan Privasi).</li>
<li><strong>Kamu menyatakan dan menjamin</strong> bahwa kamu memiliki file tersebut atau memiliki izin/lisensi yang sah untuk mengolahnya dan memakai hasilnya. Memotong, mengonversi, memisahkan vokal, atau membuat nada dering dari karya orang lain tanpa hak yang sah dapat melanggar hukum hak cipta, dan itu sepenuhnya tanggung jawabmu.</li>
<li>Kami tidak menyediakan, menyimpan, atau mendistribusikan lagu berhak cipta pihak lain lewat Audio Tools.</li>
<li>Versi gratis dibatasi (saat ini 2 kali per alat per hari untuk setiap akun). Batas dan fitur dapat berubah. Hasil alat otomatis (misalnya deteksi BPM dan kunci nada, pemisah vokal berbasis center-phase) berupa perkiraan dan tidak dijamin akurat.</li>
</ul>

<h2>4. Aset Audio dan lisensi</h2>
<p>Lagu, loop, stem, dan partitur di katalog adalah karya orisinal yang hak ciptanya tetap pada pemiliknya. Setelah pembelian lunas, kamu mendapat <strong>lisensi non-eksklusif, tidak dapat dipindahtangankan, dan berlaku permanen</strong> untuk memakai aset yang kamu beli di proyekmu, termasuk proyek komersial, sesuai rincian pada berkas <strong>Readme_License.txt</strong> yang menyertai pembelian. Bila ringkasan ini berbeda dengan Readme_License.txt, isi Readme_License.txt yang berlaku.</p>
<p>Kamu <strong>tidak boleh</strong>:</p>
<ul>
<li>menjual, menyewakan, membagikan, atau mengunggah ulang berkas aset mentah (master, loop, stem, partitur) sebagai produk berdiri sendiri atau ke pustaka/marketplace audio;</li>
<li>mengklaim dirimu sebagai pencipta asli aset tersebut, atau mendaftarkannya sebagai karya/hak ciptamu sendiri, termasuk mendaftarkannya ke sistem klaim hak cipta (misalnya Content ID) atas nama orang lain;</li>
<li>memberikan akses berkas ke orang lain di luar lisensi (satu pembelian berlaku untuk pembelinya);</li>
<li>memakai aset untuk melatih model AI/machine learning atau untuk konten yang melanggar hukum, mengandung kebencian, atau menyesatkan.</li>
</ul>
<p>Lisensi dapat dicabut bila kamu melanggar ketentuan ini.</p>

<h2>5. Harga, pembayaran, dan pengembalian dana</h2>
<ul>
<li>Harga dalam Rupiah (IDR) dan dapat berubah sewaktu-waktu; harga yang berlaku adalah yang tampil saat checkout. Modul bersifat "beli sekali, berlaku permanen" selama Layanan beroperasi.</li>
<li>Pembayaran diproses oleh Midtrans dan mitra pembayarannya. Pesanan aktif setelah pembayaran terkonfirmasi.</li>
<li><strong>Produk digital.</strong> Karena berupa produk digital yang aksesnya langsung terbuka, pembelian pada dasarnya <strong>tidak dapat dikembalikan</strong> setelah berkas diunduh atau akses dibuka, kecuali: (i) pembayaran ganda, (ii) produk tidak dapat diakses atau diunduh karena kesalahan dari pihak kami dan tidak dapat kami perbaiki, atau (iii) produk sangat berbeda dari yang dijelaskan. Ajukan dalam <strong>7 hari</strong> sejak pembelian lewat ${mail} dengan menyertakan bukti pembayaran. Hak konsumenmu menurut UU Perlindungan Konsumen tidak berkurang oleh ketentuan ini.</li>
<li><strong>Donasi</strong> bersifat sukarela dan tidak dapat dikembalikan, kecuali pembayaran ganda atau salah nominal yang kamu laporkan dalam 7 hari. Donasi bukan pembelian barang/jasa, bukan investasi, dan bukan sumbangan yang dapat dikurangkan dari pajak. Bingkai profil yang terbuka setelah berdonasi adalah ucapan terima kasih digital tanpa nilai tukar, dan dapat berubah bentuk atau tampilannya. Lihat <a href="/support">Dukung PlayMuzeck</a>.</li>
</ul>

<h2>6. Konten buatan pengguna</h2>
<ul>
<li>Kamu tetap memiliki konten yang kamu buat (misalnya kuis di Aula Komunitas). Dengan membagikannya, kamu memberi ${SITE} <strong>lisensi non-eksklusif, bebas royalti, berlaku di seluruh dunia</strong> untuk menampilkan, menyimpan, menyalin seperlunya, dan membagikannya di dalam Layanan selama konten itu ada.</li>
<li>Kamu menjamin kontenmu orisinal atau kamu berhak memakainya, dan tidak melanggar hak pihak lain maupun hukum.</li>
<li>Dilarang konten yang: mengandung SARA, ujaran kebencian, pornografi, kekerasan ekstrem, perundungan, perjudian, hoaks yang merugikan, data pribadi orang lain, atau melanggar hak cipta/merek.</li>
<li>Kami memoderasi konten dan nama pengguna (otomatis maupun manual) dan berhak menolak, menyembunyikan, atau menghapus konten, serta mengubah atau memblokir nama tampilan yang melanggar, tanpa pemberitahuan terlebih dahulu.</li>
</ul>

<h2>7. Perilaku di multiplayer dan komunitas</h2>
<p>Bersikaplah sopan. Dilarang curang (misalnya memakai bot atau skrip untuk menjawab), memanipulasi papan peringkat, mengganggu pemain lain, atau memakai nama yang menyesatkan atau menyinggung.</p>

<h2>8. Larangan umum</h2>
<p>Kamu tidak boleh: (a) membobol, menguji celah, atau mengganggu keamanan dan ketersediaan Layanan; (b) mengakali batas kuota, pembayaran, atau lisensi; (c) mengambil data secara massal (<em>scraping</em>) tanpa izin tertulis; (d) menyebarkan malware; (e) menyamar sebagai orang lain atau sebagai ${SITE}; (f) memakai Layanan untuk tujuan melanggar hukum.</p>

<h2>9. Hak kekayaan intelektual ${SITE}</h2>
<p>Nama dan logo ${SITE}, tampilan, kode, teks, katalog musik, serta konten kuis bawaan dilindungi hukum. Selain yang diizinkan secara tegas oleh Syarat ini atau lisensi aset, tidak ada hak yang dialihkan kepadamu. Pustaka suara pihak ketiga yang dipakai di Layanan tunduk pada lisensinya masing-masing (lihat bagian kredit di aplikasi).</p>

<h2>10. Pelanggaran hak cipta</h2>
<p>Kami menghormati hak kekayaan intelektual. Tata cara pelaporan dan sanggahan ada di halaman <a href="/copyright">Hak Cipta &amp; Pelaporan</a>.</p>

<h2>11. Tautan pihak ketiga</h2>
<p>Layanan dapat memuat tautan ke situs lain. Kami tidak bertanggung jawab atas konten, produk, atau kebijakan pihak ketiga tersebut. ${SITE} tidak menayangkan iklan.</p>

<h2>12. Penangguhan dan penutupan</h2>
<p>Kami dapat membatasi, menangguhkan, atau menutup akun dan akses ke Layanan bila kamu melanggar Syarat ini, merugikan pengguna lain atau Layanan, atau karena kewajiban hukum. Kamu dapat berhenti memakai Layanan atau meminta penghapusan akun kapan saja (lihat Kebijakan Privasi). Ketentuan yang secara sifatnya tetap berlaku setelah penutupan (misalnya kekayaan intelektual, pembatasan tanggung jawab) tetap berlaku.</p>

<h2>13. Penafian jaminan</h2>
<p>Layanan disediakan "<strong>sebagaimana adanya</strong>" dan "sebagaimana tersedia". Kami berusaha menjaganya berjalan baik, tetapi tidak menjamin Layanan bebas gangguan, kesalahan, atau cocok untuk tujuan tertentu, dan tidak menjamin hasil olahan Audio Tools. Simpan salinan file pentingmu sendiri.</p>

<h2>14. Batasan tanggung jawab</h2>
<p>Sepanjang diizinkan hukum, ${SITE} dan pengelolanya tidak bertanggung jawab atas kerugian tidak langsung, insidental, khusus, atau konsekuensial (termasuk hilangnya data, keuntungan, atau reputasi) yang timbul dari pemakaian Layanan. Total tanggung jawab kami atas klaim apa pun dibatasi hingga jumlah yang kamu bayarkan kepada kami dalam <strong>12 bulan terakhir</strong>, atau Rp100.000 bila kamu belum pernah membayar. Ketentuan ini tidak membatasi tanggung jawab yang menurut hukum tidak boleh dibatasi, termasuk hak konsumen yang dijamin undang-undang.</p>

<h2>15. Ganti rugi</h2>
<p>Kamu setuju membebaskan ${SITE} dan pengelolanya dari klaim pihak ketiga yang timbul akibat pelanggaranmu terhadap Syarat ini, konten yang kamu unggah atau bagikan, atau file yang kamu olah tanpa hak yang sah.</p>

<h2>16. Hukum yang berlaku dan penyelesaian sengketa</h2>
<p>Syarat ini tunduk pada hukum Republik Indonesia. Sengketa diupayakan diselesaikan lebih dulu secara musyawarah. Bila tidak tercapai, sengketa diselesaikan melalui pengadilan negeri yang berwenang di wilayah domisili pengelola ${SITE}, tanpa mengurangi hakmu mengadu ke Badan Penyelesaian Sengketa Konsumen (BPSK) atau lembaga konsumen lain.</p>

<h2>17. Perubahan Syarat</h2>
<p>Kami dapat memperbarui Syarat ini. Versi terbaru selalu ada di halaman ini dengan tanggal pembaruan. Memakai Layanan setelah perubahan berarti kamu menerimanya. Untuk perubahan material, kami berupaya memberi tahu sebelumnya.</p>

<h2>18. Kontak</h2>
<p>Pertanyaan tentang Syarat ini: ${mail}, atau lewat <a href="/contact">halaman Kontak</a>.</p>
`;

// ───────────────────────── HAK CIPTA & PELAPORAN ─────────────────────────
const copyright = `
<p>${SITE} menghormati hak kekayaan intelektual dan mengharapkan pengguna melakukan hal yang sama. Halaman ini menjelaskan kebijakan hak cipta kami dan cara melapor bila kamu menemukan konten yang melanggar haknya. Kebijakan ini mengacu pada UU No. 28 Tahun 2014 tentang Hak Cipta, UU ITE, dan prinsip <em>notice-and-takedown</em> (termasuk DMCA bagi pemegang hak di luar Indonesia).</p>

<h2>1. Konten kami sendiri</h2>
<p>Lagu, loop, stem, dan partitur di katalog Aset Audio ${SITE} adalah karya orisinal. Pembeli mendapat lisensi sesuai <a href="/terms">Syarat &amp; Ketentuan</a> dan berkas <strong>Readme_License.txt</strong> pada tiap pembelian. Pustaka suara pihak ketiga yang dipakai di aplikasi dicantumkan beserta lisensinya pada bagian kredit di dalam aplikasi.</p>

<h2>2. Audio Tools dan file pengguna</h2>
<p>Audio Tools mengolah file <strong>di perangkat pengguna</strong>; kami tidak menyimpan atau menerbitkan file tersebut. Pengguna wajib memiliki hak atas file yang diolah. Kami tidak mendukung pelanggaran hak cipta dan akan menutup akun yang terbukti memakai Layanan untuk mendistribusikan karya berhak cipta tanpa izin.</p>

<h2>3. Cara melapor pelanggaran</h2>
<p>Bila kamu pemegang hak (atau perwakilannya) dan yakin konten di ${SITE}, misalnya kuis di Aula Komunitas, gambar, atau teks yang dibagikan pengguna, melanggar hakmu, kirim email ke ${mail} dengan subjek <strong>"Laporan Hak Cipta"</strong> dan sertakan:</p>
<ol>
<li>nama lengkap, alamat, email, dan nomor telepon pelapor;</li>
<li>deskripsi karya yang dilindungi dan bukti kepemilikan atau kewenangan (misalnya tautan karya asli atau bukti pendaftaran);</li>
<li>alamat URL tepat konten yang dilaporkan di ${SITE};</li>
<li>pernyataan bahwa kamu yakin dengan itikad baik bahwa pemakaian itu tidak diizinkan oleh pemegang hak, hukum, atau lisensi;</li>
<li>pernyataan bahwa informasi dalam laporan akurat, dan bahwa kamu pemegang hak atau berwenang bertindak atas namanya;</li>
<li>tanda tangan (fisik atau elektronik) pelapor.</li>
</ol>
<div class="note">Laporan yang sengaja memuat klaim palsu dapat berakibat tanggung jawab hukum bagi pelapor. Laporan yang tidak lengkap mungkin tidak dapat kami proses.</div>

<h2>4. Tindak lanjut kami</h2>
<ul>
<li>Kami berupaya meninjau laporan lengkap dalam <strong>3 x 24 jam kerja</strong>.</li>
<li>Bila laporan beralasan, konten dapat dihapus atau dinonaktifkan sementara dan pengunggahnya diberi tahu.</li>
<li>Pengguna yang berulang kali melanggar akan ditangguhkan atau ditutup akunnya.</li>
</ul>

<h2>5. Sanggahan (counter-notice)</h2>
<p>Bila kontenmu dihapus dan kamu yakin itu keliru atau kamu berhak memakainya, kirim email ke ${mail} dengan subjek <strong>"Sanggahan Hak Cipta"</strong> berisi: identitas dan kontakmu, URL konten yang dihapus, alasan dan bukti haknya, serta pernyataan bahwa informasimu benar. Kami dapat meneruskan sanggahan ke pelapor. Bila pelapor tidak menempuh jalur hukum dalam waktu wajar (sekitar 10 hari kerja), konten dapat dipulihkan.</p>

<h2>6. Laporan konten lain</h2>
<p>Untuk konten yang melanggar hukum selain hak cipta (SARA, pornografi, penipuan, data pribadi), gunakan alamat yang sama dengan subjek <strong>"Laporan Konten"</strong>. Lihat juga <a href="/contact">halaman Kontak</a>.</p>
`;

// ───────────────────────── KONTAK ─────────────────────────
const contact = `
<p>Ada pertanyaan, masukan, kendala pembayaran, atau laporan bug? Hubungi kami. Kami membaca setiap pesan.</p>

<div class="card">
<h3 style="margin-top:0">Email</h3>
<p style="margin:.2rem 0 .8rem">${mail}</p>
<a class="btn" href="mailto:${EMAIL}?subject=Halo%20PlayMuzeck">Kirim email</a>
<p class="meta" style="margin:.8rem 0 0">Waktu respons: umumnya dalam 1 sampai 3 hari kerja (Senin-Jumat, 09.00-17.00 WIB).</p>
</div>

<h2>Topik yang bisa kamu kirim</h2>
<ul>
<li><strong>Bantuan akun:</strong> tidak bisa masuk, email verifikasi tidak datang, atau lupa kata sandi.</li>
<li><strong>Pembayaran dan lisensi:</strong> sertakan email akun dan nomor/bukti pesanan. Lihat kebijakan di <a href="/terms">Syarat &amp; Ketentuan</a>.</li>
<li><strong>Custom audio dan kerja sama.</strong></li>
<li><strong>Laporan bug atau ide fitur.</strong></li>
<li><strong>Hak cipta atau konten bermasalah:</strong> ikuti panduan di <a href="/copyright">Hak Cipta &amp; Pelaporan</a>.</li>
<li><strong>Data pribadi dan penghapusan akun:</strong> lihat <a href="/privacy">Kebijakan Privasi</a>. Kamu juga bisa menghapus akun sendiri lewat Dasbor Profil (dihapus permanen setelah masa tunggu 3 hari).</li>
</ul>

<h2>Sudah punya akun?</h2>
<p>Pengguna yang sudah masuk dapat mengirim masukan atau aduan langsung dari <strong>Dasbor Profil &rarr; Hubungi Kami</strong> di <a href="/">beranda</a>. Pesanmu tersimpan dan tercatat di akunmu.</p>

<h2>Tips agar cepat dibantu</h2>
<ul>
<li>Tulis email yang kamu pakai mendaftar.</li>
<li>Jelaskan langkah yang kamu lakukan, perangkat, dan peramban (misalnya Chrome di Android).</li>
<li>Lampirkan tangkapan layar bila ada pesan error.</li>
</ul>
`;

// ───────────────────────── TENTANG ─────────────────────────
const about = `
<p>${SITE} adalah platform audio interaktif dan pusat kuis berbahasa Indonesia. Kami ingin berkarya dengan musik dan mengasah wawasan terasa ringan: cukup buka peramban, tanpa instalasi yang merepotkan.</p>

<h2>Apa yang ada di ${SITE}</h2>
<h3>Audio Tools</h3>
<p>20 alat audio yang berjalan langsung di peramban: potong, gabung, ulangi, konversi (MP3, WAV, FLAC, M4A), kompres, ubah nada dan tempo, deteksi BPM dan kunci nada, normalisasi volume, hapus jeda hening, rekam suara, pembuat nada dering, metronom, tuner, dan lainnya. File diproses di perangkatmu dan tidak diunggah ke server kami. Pemakaian gratis dibatasi 2 kali per alat per hari untuk setiap akun, dan untuk memakainya kamu perlu masuk dengan akun.</p>
<h3>Aset Audio</h3>
<p>Katalog lagu orisinal dengan lisensi komersial non-eksklusif. Kamu bisa membeli hanya yang dibutuhkan: master, versi loop, stem, atau partitur PDF. Setiap pembelian menyertakan berkas lisensi yang sebaiknya dibaca sebelum dipakai di proyekmu.</p>
<h3>Pad Editor</h3>
<p>Drum pad dan chord pad dengan sequencer hingga 16 bar, banyak instrumen General MIDI, dan rekam live, untuk menyusun ritme dan progresi akor langsung di browser.</p>
<h3>Pusat Kuis</h3>
<p>Perpustakaan kuis trivia berbahasa Indonesia (sains, sejarah, musik, seni, kuliner, dan lainnya), mode solo, pass and play, host kuis hingga 10 regu, multiplayer online, serta Aula Komunitas untuk kuis buatan pengguna dan papan peringkat.</p>

<h2>Prinsip kami</h2>
<ul>
<li><strong>Jujur soal gratis dan berbayar.</strong> Batas versi gratis dan harga modul dijelaskan terbuka, tanpa langganan tersembunyi.</li>
<li><strong>Musik orisinal, lisensi jelas.</strong> Kami tidak menjual atau menyediakan lagu berhak cipta milik orang lain.</li>
<li><strong>Bebas iklan.</strong> Tidak ada banner atau pop-up. Operasional ditopang pembelian aset dan donasi sukarela, lihat <a href="/support">Dukung PlayMuzeck</a>.</li>
<li><strong>Privasi.</strong> File audiomu diolah di perangkatmu. Lihat <a href="/privacy">Kebijakan Privasi</a>.</li>
<li><strong>Masukanmu didengar.</strong> Kirim ide atau aduan lewat <a href="/contact">halaman Kontak</a>.</li>
</ul>

<h2>Siapa di balik ${SITE}</h2>
<p>${SITE} dikelola oleh ${esc(OWNER)} dari Indonesia. Hubungi kami di ${mail}.</p>

<p><a class="btn" href="/">Mulai di beranda</a></p>
`;

// ───────────────────────── DUKUNG ─────────────────────────
// Angka biaya diisi di legal.config.json ("costs"). Jika kosong/0, angkanya tidak ditampilkan.
// Jangan mengisi angka yang bukan tagihan sebenarnya: halaman ini bersifat transparansi ke donatur.
//   serverDb : server aplikasi + basis data (satu penyedia), Rupiah per BULAN
//   domain   : perpanjangan domain, Rupiah per TAHUN
//   storage  : penyimpanan berkas, Rupiah per bulan (0 = sesuai pemakaian)
//   email    : email transaksional, Rupiah per bulan (0 = sesuai pemakaian)
//   payment  : biaya pembayaran dipotong per transaksi, jadi tidak ditampilkan sebagai angka bulanan
const COSTS = [
  { key: 'serverDb', name: 'Server aplikasi dan basis data', note: 'Satu penyedia hosting yang menjalankan situs, akun, kuis multiplayer, pembayaran, dan menyimpan seluruh datanya.', per: 'bulan', unit: 'month', empty: 'Sesuai pemakaian', amount: null },
  { key: 'domain', name: 'Domain playmuzeck.my.id', note: 'Perpanjangan domain tahunan.', per: 'tahun', unit: 'year', empty: 'Tagihan tahunan', amount: null },
  { key: 'storage', name: 'Penyimpanan berkas', note: 'Katalog aset audio, stem, partitur, dan unggahan.', per: 'bulan', unit: 'month', empty: 'Sesuai pemakaian', amount: null },
  { key: 'email', name: 'Email transaksional', note: 'Verifikasi akun, reset kata sandi, bukti pembelian.', per: 'bulan', unit: 'month', empty: 'Sesuai pemakaian', amount: null },
  { key: 'payment', name: 'Biaya pembayaran', note: 'Potongan penyedia pembayaran pada tiap transaksi.', per: 'bulan', unit: 'month', empty: 'Dipotong per transaksi', amount: null },
];
const COST_CFG = CFG.costs || {};
if (COST_CFG.serverDb === undefined && COST_CFG.server !== undefined) COST_CFG.serverDb = COST_CFG.server; // kompatibel dengan format lama
COSTS.forEach((c) => { const v = Number(COST_CFG[c.key]); if (Number.isFinite(v) && v > 0) c.amount = v; });
const rp = (n) => 'Rp' + Math.round(n).toLocaleString('id-ID');
const costRows = COSTS.map((c) => `<tr><td><strong>${esc(c.name)}</strong><br><span class="muted">${esc(c.note)}</span></td><td style="white-space:nowrap">${c.amount ? rp(c.amount) + ' / ' + c.per : esc(c.empty)}</td></tr>`).join('');
const known = COSTS.filter((c) => c.amount);
const monthlyTotal = known.reduce((a, c) => a + (c.unit === 'year' ? c.amount / 12 : c.amount), 0);
const totalLine = known.length
  ? `<p>Biaya tetap yang sudah pasti sekitar <strong>${rp(monthlyTotal)} per bulan</strong> (${known.map((c) => `${rp(c.amount)} per ${c.per} untuk ${esc(c.name.toLowerCase())}`).join(', ditambah ')}). Pos lain mengikuti pemakaian dan jumlah transaksi.</p>`
  : '';

const support = `
<p>PlayMuzeck dikelola secara mandiri. Situs ini <strong>tidak menayangkan iklan</strong>: tidak ada banner, tidak ada pop-up, dan datamu tidak dijual. Satu-satunya "penghasilan" kami adalah penjualan aset audio dan donasi dari pengguna yang merasa PlayMuzeck berguna.</p>

<div class="card">
<h3 style="margin-top:0">Kenapa donasi?</h3>
<p style="margin:.3rem 0 0">Server, basis data, domain, dan layanan pendukung tetap ada tagihannya, dan makin besar seiring bertambahnya pengguna. Donasi berapa pun menjaga PlayMuzeck tetap online, tetap bebas iklan, dan tetap bisa dicoba gratis.</p>
</div>

<h2>Ke mana uangnya dipakai</h2>
<table><tr><th>Pos biaya</th><th>Perkiraan</th></tr>${costRows}</table>
${totalLine}
<p>Kalau donasi bulan tertentu melebihi kebutuhan operasional, kelebihannya dipakai untuk menambah kapasitas, membuat fitur baru, dan memperbarui katalog.</p>

<h2>Cara berdonasi</h2>
<ol>
<li><a href="/">Masuk ke akunmu</a> di PlayMuzeck (donasi tercatat di akunmu agar bingkai terbuka otomatis).</li>
<li>Buka <strong>Dasbor Profil &rarr; Donasi &amp; Dukungan</strong>.</li>
<li>Pilih nominal (minimal Rp1.000) dan bayar lewat QRIS di jendela pembayaran Midtrans.</li>
</ol>
<p><a class="btn" href="/">Buka PlayMuzeck untuk berdonasi</a></p>

<h2>Ucapan terima kasih</h2>
<p>Donatur mendapat bingkai profil eksklusif:</p>
<table>
<tr><th>Donasi</th><th>Bingkai</th></tr>
<tr><td>Rp10.000 · Secangkir Kopi</td><td>Seduhan Kafein</td></tr>
<tr><td>Rp25.000 · Energi Kreatif</td><td>Voltase Neon Kreatif</td></tr>
<tr><td>Rp50.000 · Server Boost</td><td>Quantum Warp Grid</td></tr>
<tr><td>Rp100.000 · Pendukung Sultan</td><td>Mahkota Imperial Sultan</td></tr>
</table>

<h2>Cara lain membantu tanpa uang</h2>
<ul>
<li>Ceritakan PlayMuzeck ke temanmu atau komunitas musikmu.</li>
<li>Bagikan kuis buatanmu di Aula Komunitas.</li>
<li>Kirim masukan atau laporan bug lewat <a href="/contact">halaman Kontak</a>.</li>
</ul>

<h2>Catatan penting</h2>
<p>Donasi bersifat sukarela dan tidak dapat dikembalikan (kecuali pembayaran ganda). Donasi bukan investasi dan bukan sumbangan yang dikurangkan dari pajak. Rinciannya ada di <a href="/terms">Syarat &amp; Ketentuan</a>. Yang ditampilkan ke publik hanya total dan jumlah donatur, tanpa nama atau email (lihat <a href="/privacy">Kebijakan Privasi</a>).</p>
`;

// ───────────────────────── KEBIJAKAN COOKIE ─────────────────────────
const COOKIE_ROWS = [
  // [nama, jenis, pihak, tujuan, durasi, kategori]
  ['muzeck_sid', 'Cookie', 'Kami (first-party)', 'Menjaga kamu tetap masuk. HttpOnly, Secure, SameSite=Lax.', '30 hari', 'Wajib'],
  ['muzeck_signup', 'Cookie', 'Kami (first-party)', 'Mengikat tautan verifikasi email ke peramban yang dipakai mendaftar (anti pembajakan akun). HttpOnly.', '24 jam', 'Wajib'],
  ['muzeck_consent_v1', 'localStorage', 'Kami', 'Mengingat pilihan cookie-mu.', 'Sampai kamu menghapusnya / versi kebijakan berubah', 'Wajib'],
  ['muzeck_user_session_v1, muzeck_cart_v1, muzeck_audio_entitlements_v1, muzeck_unlocked_*, muzeck_user_choice_claimed_v1, muzeck_custom_*', 'localStorage', 'Kami', 'Status masuk di antarmuka, keranjang, dan akses produk yang kamu miliki.', 'Sampai keluar / dihapus', 'Wajib'],
  ['muzeck_quiz_*, muzeck_selected_quiz_deck_id, muzeck_active_quiz_segment, muzeck_last_nav, muzeck_standalone_*', 'localStorage', 'Kami', 'Progres, hasil, dan pilihan kuis; halaman terakhir yang dibuka; mode luring.', 'Sampai dihapus', 'Wajib'],
  ['muzeck_cms_*', 'localStorage', 'Kami', 'Salinan sementara katalog dan pengaturan situs agar halaman terbuka lebih cepat.', 'Sampai dihapus / diperbarui', 'Wajib'],
  ['muzeck_mp_client_id', 'localStorage', 'Kami', 'Pengenal perangkat untuk sesi multiplayer.', 'Sampai dihapus', 'Wajib'],
  ['muzeck_theme_*, pm_palette, pm_theme_api_mode, muzeck_sound_theme, padstudio.*, muzeck_pwa_installed, muzeck_donation_banner_dismissed_v1', 'localStorage', 'Kami', 'Tema warna (dipakai juga oleh halaman statis ini), pengaturan suara, preferensi editor, dan banner yang sudah kamu tutup.', 'Sampai dihapus', 'Wajib'],
  ['muzeck_deletion_notice', 'sessionStorage', 'Kami', 'Menampilkan pemberitahuan penghapusan akun sekali per sesi.', 'Sampai tab ditutup', 'Wajib'],
  ['Cloudflare Turnstile', 'Skrip pihak ketiga', 'Cloudflare', 'Anti-bot saat masuk/daftar. Dimuat hanya di formulir itu.', 'Sesuai kebijakan Cloudflare', 'Wajib (keamanan)'],
  ['Google Sign-In', 'Skrip pihak ketiga', 'Google', 'Tombol Masuk dengan Google. Dimuat saat kamu membuka formulir masuk.', 'Sesuai kebijakan Google', 'Wajib bila dipakai'],
  ['Midtrans Snap', 'Skrip pihak ketiga', 'Midtrans', 'Jendela pembayaran. Dimuat hanya saat kamu membayar atau berdonasi.', 'Sesuai kebijakan Midtrans', 'Wajib bila dipakai'],
  ['muzeck_analytics_session_v1', 'localStorage', 'Kami', 'ID acak untuk analitik peristiwa (misalnya kuis dimulai/selesai). Dibuat HANYA setelah kamu menerima, dan dihapus saat kamu menolak.', 'Sampai dihapus / persetujuan ditarik', 'Analitik (opsional)'],
];
const cookieTable = `<table><tr><th>Nama</th><th>Jenis</th><th>Pihak</th><th>Tujuan</th><th>Durasi</th><th>Kategori</th></tr>${COOKIE_ROWS.map((r) => `<tr>${r.map((c, i) => `<td>${i === 0 ? '<code>' + esc(c) + '</code>' : esc(c)}</td>`).join('')}</tr>`).join('')}</table>`;

const cookiepage = `
<p>Halaman ini menjelaskan cookie dan penyimpanan lokal yang dipakai ${SITE}. ${SITE} <strong>tidak memasang cookie iklan atau pelacak pihak ketiga</strong>. Satu-satunya yang membutuhkan persetujuanmu adalah <strong>analitik</strong>, dan itu <strong>mati secara bawaan</strong>. Pengaturannya ada di halaman ini, jadi kebijakan dan pilihanmu selalu satu sumber.</p>

<h2>Pengaturan cookie</h2>
<div class="card" id="consent-box">
<p style="margin:.2rem 0 .6rem">Status analitik saat ini: <strong id="c-status">memuat...</strong><span id="c-when" class="muted"></span></p>
<p id="c-gpc" class="muted" style="display:none;margin:.2rem 0 .6rem">Peramban kamu mengirim sinyal "jangan lacak", jadi analitik tetap nonaktif.</p>
<button class="btn" id="c-accept" type="button" style="margin-right:.5rem">Terima analitik</button>
<button class="btn alt" id="c-reject" type="button">Tolak / tarik persetujuan</button>
<noscript><p>Aktifkan JavaScript untuk mengubah pilihan di sini.</p></noscript>
</div>

<h2>Apa itu cookie dan penyimpanan lokal?</h2>
<p>Cookie adalah berkas kecil yang disimpan peramban atas permintaan situs. Penyimpanan lokal (<em>localStorage</em>/<em>sessionStorage</em>) serupa tetapi tidak ikut terkirim ke server pada setiap permintaan. Keduanya kami pakai agar kamu tetap masuk dan pengaturanmu tidak hilang.</p>

<h2>Daftar lengkap</h2>
<div style="overflow-x:auto">${cookieTable}</div>
<p>Kategori <strong>Wajib</strong> tidak memerlukan persetujuan karena dibutuhkan agar layanan yang kamu minta berfungsi (login, keranjang, keamanan, pengaturan yang kamu pilih sendiri). Penyedia pihak ketiga di atas dapat menyetel cookie mereka sendiri saat skripnya dimuat; lihat kebijakan mereka.</p>

<h2>Cara mengelola</h2>
<ul>
<li>Ubah pilihan analitik kapan saja di kotak <strong>Pengaturan cookie</strong> di bagian atas halaman ini.</li>
<li>Hapus cookie dan data situs lewat pengaturan peramban. Kamu akan keluar dari akun dan pengaturan lokal akan hilang.</li>
<li>Nyalakan <em>Global Privacy Control</em> di peramban untuk menolak analitik secara otomatis.</li>
</ul>
<p>Menolak analitik tidak mengurangi fitur apa pun. Lihat juga <a href="/privacy">Kebijakan Privasi</a>.</p>

<script>
(function(){
  var KEY='muzeck_consent_v1', VER=1, ASK='muzeck_analytics_session_v1';
  var st=document.getElementById('c-status'), when=document.getElementById('c-when'), gpcEl=document.getElementById('c-gpc');
  var gpc=false; try{ gpc = navigator.globalPrivacyControl===true || navigator.doNotTrack==='1'; }catch(e){}
  function read(){ try{ var j=JSON.parse(localStorage.getItem(KEY)||'null'); return (j&&j.v===VER&&typeof j.analytics==='boolean')?j:null; }catch(e){ return null; } }
  function render(){
    var c=read();
    st.textContent = gpc ? 'nonaktif (sinyal peramban)' : (c ? (c.analytics ? 'aktif (kamu menerima)' : 'nonaktif (kamu menolak)') : 'nonaktif (belum memilih)');
    when.textContent = c && c.ts ? ' · dipilih ' + new Date(c.ts).toLocaleString('id-ID') : '';
    if(gpc){ gpcEl.style.display='block'; document.getElementById('c-accept').disabled=true; }
  }
  function save(a){
    try{ localStorage.setItem(KEY, JSON.stringify({v:VER, analytics:a, ts:new Date().toISOString()})); if(!a) localStorage.removeItem(ASK); }catch(e){}
    render();
  }
  document.getElementById('c-accept').addEventListener('click', function(){ save(true); });
  document.getElementById('c-reject').addEventListener('click', function(){ save(false); });
  render();
})();
</script>
`;

const PAGES = [
  { slug: 'privacy', title: 'Kebijakan Privasi | PlayMuzeck', desc: 'Kebijakan Privasi PlayMuzeck: data apa yang dikumpulkan, kebijakan tanpa iklan, pihak ketiga, penyimpanan, penghapusan akun, dan hak pengguna menurut UU PDP.', h1: 'Kebijakan Privasi', body: privacy },
  { slug: 'terms', title: 'Syarat & Ketentuan | PlayMuzeck', desc: 'Syarat & Ketentuan penggunaan PlayMuzeck: akun, Audio Tools, lisensi aset audio, pembayaran dan pengembalian dana, konten pengguna, dan batasan tanggung jawab.', h1: 'Syarat & Ketentuan', body: terms },
  { slug: 'copyright', title: 'Hak Cipta & Pelaporan Pelanggaran | PlayMuzeck', desc: 'Kebijakan hak cipta PlayMuzeck dan cara melapor pelanggaran atau mengajukan sanggahan (notice-and-takedown, UU Hak Cipta, DMCA).', h1: 'Hak Cipta & Pelaporan Pelanggaran', body: copyright },
  { slug: 'contact', title: 'Kontak | PlayMuzeck', desc: 'Hubungi PlayMuzeck untuk bantuan akun, pembayaran, lisensi, custom audio, laporan bug, atau pertanyaan lain. Respons umumnya 1-3 hari kerja.', h1: 'Hubungi Kami', body: contact },
  { slug: 'support', title: 'Dukung PlayMuzeck: Bebas Iklan, Ditopang Donasi', desc: 'PlayMuzeck bebas iklan dan ditopang pembelian aset serta donasi pengguna. Lihat ke mana dana dipakai, cara berdonasi mulai Rp1.000, dan bingkai ucapan terima kasih.', h1: 'Dukung PlayMuzeck', body: support },
  { slug: 'cookie', title: 'Kebijakan Cookie | PlayMuzeck', desc: 'Kebijakan Cookie PlayMuzeck: cookie dan penyimpanan lokal yang dipakai, mana yang wajib, mana yang opsional (analitik), dan cara menolak atau mengubah pilihan.', h1: 'Kebijakan Cookie', body: cookiepage },
  { slug: 'about', title: 'Tentang PlayMuzeck | Audio Tools, Aset Audio & Kuis', desc: 'Tentang PlayMuzeck: platform audio interaktif dan pusat kuis berbahasa Indonesia dengan Audio Tools, aset audio berlisensi, Pad Editor, dan kuis multiplayer.', h1: 'Tentang PlayMuzeck', body: about },
];

// Folder URL lama yang sudah dipindah (jangan sampai halaman lama tersisa dan bentrok dengan pengalihan 301).
for (const old of ['dukung', 'hak-cipta']) fs.rmSync(path.join(OUT, old), { recursive: true, force: true });

for (const p of PAGES) {
  const dir = path.join(OUT, p.slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), page(p));
}
console.log(`Halaman hukum: ${PAGES.length} halaman dibuat di public/ (${PAGES.map((p) => p.slug).join(', ')})`);
