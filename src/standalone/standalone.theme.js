/* src/standalone/standalone.theme.js
   Mesin tema berkas mandiri PlayMuzeck_Quiz.html.
   Mengisi variabel yang dipakai standalone.css (--t-*, --color-*) dan mengatur mode gelap/terang.
   Dimuat di <head> supaya warna sudah benar sebelum halaman pertama tergambar. */
(function (root) {
  'use strict';

  var KEY = 'playmuzeck.standalone.theme.v1';
  var mem = {};

  /* ── Penyimpanan aman (jatuh ke memori jika localStorage diblokir) ── */
  function lsGet(k) {
    try { var v = root.localStorage.getItem(k); return v === null ? (mem[k] || null) : v; }
    catch (e) { return mem[k] || null; }
  }
  function lsSet(k, v) {
    mem[k] = v;
    try { root.localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }

  /* ── Utilitas warna ── */
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function hexToRgb(hex) {
    var h = String(hex || '').trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
    }).join('');
  }
  function normHex(hex, fallback) {
    var rgb = hexToRgb(hex);
    return rgb ? rgbToHex(rgb[0], rgb[1], rgb[2]) : fallback;
  }
  function luminance(rgb) {
    var a = rgb.map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  /* Hitam atau putih, mana yang lebih kontras di atas warna latar tertentu */
  function onColor(bg) {
    return contrast(bg, [0, 0, 0]) >= contrast(bg, [255, 255, 255]) ? '#000000' : '#ffffff';
  }
  /* Geser warna ke arah putih/hitam sampai kontras terhadap `against` mencapai target */
  function readable(color, against, target, toward) {
    var out = color, t = 0;
    while (t < 1 && contrast(out, against) < target) { t += 0.05; out = mix(color, toward, t); }
    return out;
  }

  /* ── Palet dasar per mode (nama variabel sama dengan mesin tema situs) ── */
  var PALETTE = {
    dark: {
      '--color-black': '#000000', '--color-white': '#ffffff',
      '--color-gray-200': '#e5e7eb', '--color-gray-300': '#d1d5db', '--color-gray-400': '#9ca3af', '--color-gray-500': '#6b7280',
      '--color-emerald-100': '#d1fae5', '--color-emerald-300': '#6ee7b7', '--color-emerald-400': '#34d399', '--color-emerald-500': '#10b981', '--color-emerald-950': '#022c22',
      '--color-red-100': '#fee2e2', '--color-red-300': '#fca5a5', '--color-red-400': '#f87171', '--color-red-500': '#ef4444', '--color-red-900': '#7f1d1d', '--color-red-950': '#450a0a',
      '--color-purple-400': '#c084fc', '--color-purple-500': '#a855f7', '--color-purple-600': '#9333ea',
      '--color-blue-500': '#3b82f6', '--color-amber-300': '#fcd34d', '--color-amber-500': '#f59e0b',
      '--color-sky-300': '#7dd3fc', '--color-yellow-300': '#fde047'
    },
    /* Mode terang: "putih" menjadi tinta gelap dan "hitam" menjadi kertas, sehingga
       semua kelas di standalone.css (border w10, latar k40, dst.) otomatis terbalik. */
    light: {
      '--color-black': '#ffffff', '--color-white': '#0f172a',
      '--color-gray-200': '#1e293b', '--color-gray-300': '#334155', '--color-gray-400': '#475569', '--color-gray-500': '#64748b',
      '--color-emerald-100': '#064e3b', '--color-emerald-300': '#065f46', '--color-emerald-400': '#047857', '--color-emerald-500': '#10b981', '--color-emerald-950': '#d1fae5',
      '--color-red-100': '#7f1d1d', '--color-red-300': '#b91c1c', '--color-red-400': '#b91c1c', '--color-red-500': '#dc2626', '--color-red-900': '#fecaca', '--color-red-950': '#fee2e2',
      '--color-purple-400': '#7e22ce', '--color-purple-500': '#9333ea', '--color-purple-600': '#7e22ce',
      '--color-blue-500': '#2563eb', '--color-amber-300': '#b45309', '--color-amber-500': '#d97706',
      '--color-sky-300': '#0369a1', '--color-yellow-300': '#a16207'
    }
  };

  /* ── Tema bawaan ──
     Sama dengan tema situs PlayMuzeck: 6 gelap, 6 terang, dan 6 palet khusus.
     Situs hanya mendefinisikan satu mode per tema; mode lainnya diturunkan dari warna aksen. */
  function mixHex(a, b, k) { var m = mix(hexToRgb(a), hexToRgb(b), k); return rgbToHex(m[0], m[1], m[2]); }
  function mk(id, name, home, surface, accent, accent2, bg) {
    var dark, light;
    if (home === 'dark') {
      dark = { bg: bg || mixHex(surface, '#000000', 0.5), surface: surface };
      light = { bg: mixHex(accent, '#ffffff', 0.93), surface: '#ffffff' };
    } else {
      light = { bg: bg || mixHex(surface, '#000000', 0.06), surface: surface };
      dark = { bg: mixHex(accent, '#000000', 0.9), surface: mixHex(accent, '#000000', 0.78) };
    }
    return { id: id, name: name, note: home === 'dark' ? 'Gelap' : 'Terang', accent: accent, accent2: accent2, dark: dark, light: light };
  }
  var PRESETS = [
    mk('oxford-amber', 'Oxford Amber', 'dark', '#14213D', '#FCA311', '#FC1212'),
    mk('crimson-night', 'Crimson Night', 'dark', '#2A0F1A', '#E11D48', '#FB7185'),
    mk('emerald-studio', 'Emerald Studio', 'dark', '#0F2A24', '#34D399', '#22D3EE'),
    mk('violet-arena', 'Violet Arena', 'dark', '#1E1B3A', '#A78BFA', '#F472B6'),
    mk('ocean-sunset', 'Ocean Sunset', 'dark', '#0B2545', '#38BDF8', '#FB923C'),
    mk('forest-gold', 'Forest Gold', 'dark', '#142A1C', '#EAB308', '#F97316'),
    mk('daylight-sky', 'Daylight Sky', 'light', '#FFFFFF', '#0284C7', '#E11D48'),
    mk('paper-amber', 'Paper Amber', 'light', '#FFF8EB', '#C2410C', '#7C3AED'),
    mk('mint-light', 'Mint Light', 'light', '#F0FDF4', '#15803D', '#0E7490'),
    mk('lavender-light', 'Lavender Light', 'light', '#F5F3FF', '#6D28D9', '#BE185D'),
    mk('rose-light', 'Rose Light', 'light', '#FFF1F2', '#BE123C', '#0369A1'),
    mk('ocean-light', 'Ocean Light', 'light', '#F0F9FF', '#0369A1', '#C2410C'),
    mk('cafe-sepia', 'Café Sepia', 'dark', '#3a2b1e', '#e0a458', '#e07a5f', '#241a12'),
    mk('nord-frost', 'Nord Frost', 'dark', '#3b4252', '#88c0d0', '#ebcb8b', '#2e3440'),
    mk('cream-ink', 'Cream & Ink', 'light', '#eee8d5', '#9a6b00', '#b23a1d', '#fdf6e3'),
    mk('midnight-plum', 'Midnight Plum', 'dark', '#2a1b3a', '#ff9ecb', '#7dd3fc', '#1a1023'),
    mk('slate-steel', 'Slate Steel', 'light', '#e2e8f0', '#1d4ed8', '#be123c', '#cbd5e1'),
    mk('terminal-green', 'Terminal Green', 'dark', '#0f2a18', '#4ade80', '#facc15', '#07140b')
  ];

  function presetById(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return PRESETS[0];
  }

  function defaultState() {
    var b = root.PM_BOOT && root.PM_BOOT.theme;
    if (b && typeof b === 'object') {
      var bg = normHex(b.bg, null), sf = normHex(b.surface, null), a1 = normHex(b.accent, null), a2 = normHex(b.accent2, null);
      if (bg && sf && a1 && a2) {
        return { preset: 'custom', mode: b.mode === 'light' ? 'light' : 'dark', custom: { accent: a1, accent2: a2, bg: bg, surface: sf } };
      }
    }
    var p = PRESETS[0];
    return { preset: p.id, mode: 'dark', custom: { accent: p.accent, accent2: p.accent2, bg: p.dark.bg, surface: p.dark.surface } };
  }

  function fixState(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== 'object') return d;
    var isCustom = raw.preset === 'custom';
    var ok = isCustom || PRESETS.some(function (p) { return p.id === raw.preset; });
    d.preset = ok ? raw.preset : d.preset;
    d.mode = raw.mode === 'light' ? 'light' : 'dark';
    var c = raw.custom || {};
    ['accent', 'accent2', 'bg', 'surface'].forEach(function (k) { d.custom[k] = normHex(c[k], d.custom[k]); });
    return d;
  }

  /* Hasilkan warna akhir + mode untuk sebuah status tema */
  function resolve(st) {
    if (st.preset === 'custom') {
      var c = st.custom;
      var mode = luminance(hexToRgb(c.bg)) > 0.35 ? 'light' : 'dark'; /* mode otomatis mengikuti kecerahan latar */
      return { mode: mode, bg: c.bg, surface: c.surface, accent: c.accent, accent2: c.accent2 };
    }
    var p = presetById(st.preset), m = st.mode === 'light' ? 'light' : 'dark';
    return { mode: m, bg: p[m].bg, surface: p[m].surface, accent: p.accent, accent2: p.accent2 };
  }

  /* Turunan warna yang menjamin keterbacaan (WCAG) */
  function derive(r) {
    var dark = r.mode === 'dark';
    var toward = dark ? [255, 255, 255] : [0, 0, 0];
    var surface = hexToRgb(r.surface), ac = hexToRgb(r.accent), ac2 = hexToRgb(r.accent2);
    function hx(rgb) { return rgbToHex(rgb[0], rgb[1], rgb[2]); }
    return {
      '--t-bg': r.bg,
      '--t-fg': dark ? '#f8fafc' : '#0f172a',
      '--t-surface': r.surface,
      '--t-scrim': dark ? '#000000' : '#0f172a',
      '--t-accent': r.accent,
      '--t-on-accent': onColor(ac),
      '--t-accent-text': hx(readable(ac, surface, 4.5, toward)),
      '--t-accent-line': hx(readable(ac, surface, 3, toward)),
      '--t-accent2': r.accent2,
      '--t-on-accent2': onColor(ac2),
      '--t-accent2-text': hx(readable(ac2, surface, 4.5, toward)),
      '--t-accent2-line': hx(readable(ac2, surface, 3, toward))
    };
  }

  var state = fixState((function () {
    var t = lsGet(KEY);
    try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
  })());

  function apply() {
    if (typeof document === 'undefined') return;
    var r = resolve(state), vars = derive(r), pal = PALETTE[r.mode];
    var el = document.documentElement;
    Object.keys(pal).forEach(function (k) { el.style.setProperty(k, pal[k]); });
    Object.keys(vars).forEach(function (k) { el.style.setProperty(k, vars[k]); });
    el.setAttribute('data-mode', r.mode);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', r.surface);
  }

  function persist() { lsSet(KEY, JSON.stringify(state)); }

  var Theme = {
    PRESETS: PRESETS,
    get: function () { return JSON.parse(JSON.stringify(state)); },
    resolve: function (st) { return resolve(st || state); },
    derive: derive,
    setMode: function (mode) {
      mode = mode === 'light' ? 'light' : 'dark';
      if (state.preset === 'custom') {
        /* Pada tema kustom, mode mengikuti latar; pindah mode berarti memakai latar bawaan mode tsb. */
        var base = PRESETS[0][mode];
        state.custom.bg = base.bg; state.custom.surface = base.surface;
      }
      state.mode = mode;
      persist(); apply();
    },
    setPreset: function (id) {
      if (id === 'custom') {
        if (state.preset !== 'custom') {
          var r = resolve(state);
          state.custom = { accent: r.accent, accent2: r.accent2, bg: r.bg, surface: r.surface };
          state.mode = r.mode;
        }
        state.preset = 'custom';
      } else {
        var p = presetById(id);
        state.preset = p.id;
      }
      persist(); apply();
    },
    setCustom: function (key, hex) {
      if (['accent', 'accent2', 'bg', 'surface'].indexOf(key) < 0) return;
      var h = normHex(hex, null);
      if (!h) return;
      state.preset = 'custom';
      state.custom[key] = h;
      persist(); apply();
    },
    load: function (raw) { state = fixState(raw); persist(); apply(); },
    reset: function () { state = defaultState(); persist(); apply(); },
    hexToRgb: hexToRgb, rgbToHex: rgbToHex, contrast: contrast, luminance: luminance, onColor: onColor
  };

  root.PMTheme = Theme;
  apply();

  if (typeof module !== 'undefined' && module.exports) module.exports = Theme;
})(typeof window !== 'undefined' ? window : globalThis);
