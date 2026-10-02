import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import AdminApp from './admin/AdminApp.tsx';
import { applyCachedPalette } from './theme/theme';
import './index.css';

const isAdmin = window.location.pathname.startsWith('/admin');

// Pasang tema terakhir yang dipakai pengguna SEBELUM render, supaya tidak ada
// kedipan warna bawaan. Panel admin sengaja tidak ikut ditema.
if (!isAdmin) applyCachedPalette();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isAdmin ? <AdminApp /> : <App />}
  </StrictMode>,
);
