// scripts/build-standalone.mjs
// Generator berkas mandiri (versi statis/demo): menyatukan src/standalone/* menjadi dist/PlayMuzeck_Quiz.html
// Versi yang diunduh pengguna dari situs dirakit oleh src/services/quizStandalone.ts dengan template yang sama.
// Pemakaian: npm run build:standalone   (jalankan SETELAH "npm run build", karena vite mengosongkan dist/)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src', 'standalone');
const outFile = join(root, 'dist', 'PlayMuzeck_Quiz.html');

const read = (name) => readFileSync(join(srcDir, name), 'utf8');

// Cegah teks "</script" di dalam JS menutup tag <script> lebih awal.
const safeScript = (js) => js.replace(/<\/script/gi, '<\\/script');
const safeStyle = (css) => css.replace(/<\/style/gi, '<\\/style');

const parts = {
  // Build statis: tanpa data akun. Unduhan dari situs mengisi PM_BOOT lewat src/services/quizStandalone.ts.
  '/*__BOOT_JS__*/': 'window.PM_BOOT = null;',
  '/*__CSS__*/': safeStyle(read('standalone.css') + '\n' + read('standalone.extra.css')),
  '/*__THEME_JS__*/': safeScript(read('standalone.theme.js')),
  '/*__DATA_JS__*/': safeScript(read('standalone.data.js')),
  '/*__CORE_JS__*/': safeScript(read('standalone.core.js')),
  '/*__APP_JS__*/': safeScript(read('standalone.app.js')),
};

let html = read('standalone.template.html');
for (const [token, content] of Object.entries(parts)) {
  if (!html.includes(token)) throw new Error(`Penanda ${token} tidak ditemukan di standalone.template.html`);
  html = html.replace(token, () => content); // fungsi: hindari pola khusus "$&" pada String.replace
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, html, 'utf8');
console.log(`OK  ${outFile}  (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
