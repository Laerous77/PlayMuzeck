import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AdminApp from './admin/AdminApp.tsx';
import { applyCachedPalette } from './theme/theme';
import { storage } from './services/storage';
import './index.css';

// PERBAIKAN: cocokkan "/admin" persis (atau /admin/...), bukan sembarang path berawalan "admin".
const isAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname);

// Pasang tema terakhir yang dipakai pengguna SEBELUM render, supaya tidak ada
// kedipan warna bawaan. Panel admin sengaja tidak ikut ditema.
if (!isAdmin) applyCachedPalette();

// SEO: halaman statis hasil build (scripts/generate-seo-pages.mjs) menaruh teks khusus tiap URL di dalam #root.
// createRoot() akan menghapusnya, sehingga Google (yang membaca DOM hasil render) melihat isi beranda di semua
// URL itu dan menganggapnya duplikat. Maka teks itu dipindahkan ke luar #root lebih dulu: tamu dan crawler tetap
// melihatnya sebagai bagian "Tentang halaman ini" di bawah halaman. Pengguna yang sudah login tidak memerlukannya
// (mereka langsung masuk ke aplikasi), jadi dibuang. Beranda ("/") tidak perlu: isinya sudah sama dengan tampilan aplikasi.
try {
  const rootEl = document.getElementById('root');
  const seoMain = rootEl?.querySelector(':scope > main');
  const isHome = (window.location.pathname.replace(/\/+$/, '') || '/') === '/';
  let loggedIn = false;
  try {
    const s = storage.getUserSession();
    loggedIn = Boolean(s?.isLoggedIn && String(s.email || '').trim());
  } catch {}
  if (rootEl && seoMain && !isAdmin && !isHome && !loggedIn) {
    const sec = document.createElement('section');
    sec.id = 'seo-content';
    sec.setAttribute('aria-label', 'Tentang halaman ini');
    sec.style.cssText = 'max-width:48rem;margin:0 auto;padding:2rem 1rem 3rem;color:#9ca3af;font:14px/1.6 system-ui,sans-serif';
    sec.innerHTML = (seoMain as HTMLElement).innerHTML;
    sec.querySelectorAll('a').forEach((a) => ((a as HTMLElement).style.color = '#FCA311'));
    rootEl.after(sec);
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <AdminApp /> : <App />}
  </StrictMode>,
);
