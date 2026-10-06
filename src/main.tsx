import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AdminApp from './admin/AdminApp.tsx';
import { applyCachedPalette } from './theme/theme';
import './index.css';

// PERBAIKAN: cocokkan "/admin" persis (atau /admin/...), bukan sembarang path berawalan "admin".
const isAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname);

// Pasang tema terakhir yang dipakai pengguna SEBELUM render, supaya tidak ada
// kedipan warna bawaan. Panel admin sengaja tidak ikut ditema.
if (!isAdmin) applyCachedPalette();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <AdminApp /> : <App />}
  </StrictMode>,
);
