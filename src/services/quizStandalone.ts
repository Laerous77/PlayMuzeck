// src/services/quizStandalone.ts
// Perakit berkas HTML mandiri PlayMuzeck_Quiz.html (segmen Pusat Kuis + Profil Pengguna).
//
// Isi aplikasi ada di src/standalone/* (template, CSS, tema, logika, antarmuka). Berkas ini hanya:
//   1) mengubah data situs (deck, profil, bingkai, tema aktif) menjadi PM_BOOT + PM_BUILTIN_DECKS,
//   2) menempelkannya ke template yang sama dengan scripts/build-standalone.mjs.
// Fungsi ini async (isi aplikasi dimuat malas); pemanggil cukup memakai await.

import type { Deck } from '../types';
import { BUILTIN_DECKS, isBuiltinDeckId } from '../data/quiz';

// Isi aplikasi dimuat malas (code-splitting) supaya tidak menambah ukuran bundle utama situs.
let assetsPromise: Promise<{ tpl: string; css: string; cssExtra: string; theme: string; core: string; app: string }> | null = null;
const loadAssets = () =>
  (assetsPromise ??= Promise.all([
    import('../standalone/standalone.template.html?raw'),
    import('../standalone/standalone.css?raw'),
    import('../standalone/standalone.extra.css?raw'),
    import('../standalone/standalone.theme.js?raw'),
    import('../standalone/standalone.core.js?raw'),
    import('../standalone/standalone.app.js?raw'),
  ]).then(([tpl, css, cssExtra, theme, core, app]) => ({
    tpl: tpl.default,
    css: css.default,
    cssExtra: cssExtra.default,
    theme: theme.default,
    core: core.default,
    app: app.default,
  })));

export interface StandaloneUserData {
  email?: string;
  avatarUrl?: string;
  frameId?: string;
  bio?: string;
  greeting?: string;
  unlockedDeckIds?: string[];
  purchasedThemeIds?: string[];
  unlockedFrameIds?: string[];
  hasEditor?: boolean;
}

/** Badge deck (huruf kecil) -> id bingkai tema di standalone.core.js. */
const BADGE_TO_FRAME: Record<string, string> = {
  alam: 'frame-alam',
  bahasa: 'frame-bahasa',
  fiksi: 'frame-fiksi',
  lainnya: 'frame-lainnya',
  matematika: 'frame-matematika',
  musik: 'frame-musik',
  olahraga: 'frame-olahraga',
  psikologi: 'frame-psikologi',
  seni: 'frame-seni',
  sosial: 'frame-sosial',
  teknologi: 'frame-teknologi',
  'kehidupan sehari hari': 'frame-sehari-hari',
  'kehidupan sehari-hari': 'frame-sehari-hari',
};

/** id tema yang dipakai backend (purchasedThemeIds) -> id bingkai. */
const THEME_ID_TO_FRAME: Record<string, string> = {
  sehari_hari: 'frame-sehari-hari',
};

const BADGE_TO_ICON: Record<string, string> = {
  alam: '🌿',
  bahasa: '🗣️',
  fiksi: '📖',
  lainnya: '✨',
  matematika: '📐',
  musik: '🎵',
  olahraga: '⚽',
  psikologi: '🧠',
  seni: '🎨',
  sosial: '👥',
  teknologi: '💻',
  'kehidupan sehari hari': '🏠',
  'kehidupan sehari-hari': '🏠',
};

const badgeKey = (badge?: string) => String(badge || '').trim().toLowerCase();

/** Cegah "</script" atau "<!--" di dalam data menutup tag <script> lebih awal. */
const jsonForScript = (v: unknown): string =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

const safeScript = (js: string) => js.replace(/<\/script/gi, '<\\/script');
const safeStyle = (css: string) => css.replace(/<\/style/gi, '<\\/style');

interface StandaloneQuestion {
  id: string;
  text: string;
  options: string[];
  answer: number;
  explain: string;
  media: { type: string; url: string; credit?: string; source?: string } | null;
}

interface StandaloneDeck {
  id: string;
  builtin: boolean;
  title: string;
  category: string;
  icon: string;
  desc: string;
  questions: StandaloneQuestion[];
}

function toStandaloneDeck(d: Deck, builtin: boolean): StandaloneDeck {
  const key = badgeKey(d.badge);
  return {
    id: d.id,
    builtin,
    title: d.title,
    category: (builtin ? d.badge : '') || 'Umum',
    icon: BADGE_TO_ICON[key] || (builtin ? '🎵' : '📝'),
    desc: d.description || '',
    questions: (d.questions || []).map((q) => ({
      id: q.id,
      text: q.question,
      options: q.options,
      answer: q.correctIndex,
      explain: q.explanation || '',
      media:
        q.mediaType && q.mediaUrl
          ? {
              type: q.mediaType,
              url: q.mediaUrl,
              ...(q.mediaCredit ? { credit: q.mediaCredit } : {}),
              ...(q.mediaSourceUrl ? { source: q.mediaSourceUrl } : {}),
            }
          : null,
    })),
  };
}

/** Warna tema situs yang sedang aktif, dibaca dari variabel CSS (di-set oleh src/theme/theme.ts). */
function readWebTheme() {
  if (typeof document === 'undefined') return null;
  try {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const hex = (name: string) => {
      const v = cs.getPropertyValue(name).trim();
      return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '';
    };
    const bg = hex('--t-bg');
    const surface = hex('--t-surface');
    const accent = hex('--t-accent');
    const accent2 = hex('--t-accent2');
    if (!bg || !surface || !accent || !accent2) return null;
    return { mode: root.dataset.mode === 'light' ? 'light' : 'dark', bg, surface, accent, accent2 };
  } catch {
    return null;
  }
}

export async function generateStandaloneQuizHtml(
  decks: Deck[],
  userNickname: string,
  hasQuizEditor: boolean = false,
  apiBaseUrl: string = 'https://playmuzeck.my.id',
  webAppUrl: string = 'https://playmuzeck.my.id',
  logoDataUri: string = '',
  userData: StandaloneUserData = {}
): Promise<string> {
  void apiBaseUrl; // dipertahankan agar tanda tangan lama tetap cocok; berkas ini berjalan tanpa server.

  const assets = await loadAssets();
  const list = Array.isArray(decks) ? decks : [];
  const name = (userNickname || '').trim() || 'Pemain';
  const hasEditor = Boolean(hasQuizEditor || userData.hasEditor);

  // Kuis bawaan (read-only) vs kuis buatan pengguna (disalin ke penyimpanan lokal sekali, bisa diedit/dihapus).
  const builtinDecks = list.filter((d) => isBuiltinDeckId(d.id)).map((d) => toStandaloneDeck(d, true));
  const userDecks = list.filter((d) => !isBuiltinDeckId(d.id)).map((d) => toStandaloneDeck(d, false));

  // Bingkai yang terbuka: dari kuis tema yang dimiliki, tema yang dibeli, lisensi editor, dan yang dikirim pemanggil.
  const ownedIds = new Set(userData.unlockedDeckIds ?? list.map((d) => d.id));
  const frames = new Set<string>(['none']);
  BUILTIN_DECKS.forEach((d) => {
    if (d.isFree || !ownedIds.has(d.id)) return;
    const f = BADGE_TO_FRAME[badgeKey(d.badge)];
    if (f) frames.add(f);
  });
  (userData.purchasedThemeIds || []).forEach((t) => frames.add(THEME_ID_TO_FRAME[t] || `frame-${t}`));
  (userData.unlockedFrameIds || []).forEach((f) => frames.add(f));
  if (hasEditor) frames.add('frame-quiz-editor');
  const activeFrame = userData.frameId || 'none';
  frames.add(activeFrame);

  const greeting = (userData.greeting || '').replace(/\{nama\}/gi, name).trim();
  const logo = /^data:image\//i.test(logoDataUri) ? logoDataUri : '';

  const boot = {
    v: 1,
    stamp: Date.now(),
    webUrl: webAppUrl,
    hasEditor,
    logo,
    theme: readWebTheme(),
    user: {
      name,
      email: (userData.email || '').trim(),
      bio: userData.bio || '',
      greeting,
      avatar: userData.avatarUrl || '',
      frame: activeFrame,
    },
    unlockedFrameIds: Array.from(frames),
    userDecks,
  };

  const tokens: Record<string, string> = {
    '/*__BOOT_JS__*/': `window.PM_BOOT = ${jsonForScript(boot)};`,
    '/*__CSS__*/': safeStyle(`${assets.css}\n${assets.cssExtra}`),
    '/*__THEME_JS__*/': safeScript(assets.theme),
    '/*__DATA_JS__*/': `window.PM_BUILTIN_DECKS = ${jsonForScript(builtinDecks)};`,
    '/*__CORE_JS__*/': safeScript(assets.core),
    '/*__APP_JS__*/': safeScript(assets.app),
  };

  let html = assets.tpl;
  for (const [token, content] of Object.entries(tokens)) {
    if (!html.includes(token)) throw new Error(`Penanda ${token} tidak ditemukan di standalone.template.html`);
    html = html.replace(token, () => content); // fungsi: hindari pola khusus "$&" pada String.replace
  }
  if (logo) html = html.replace(/<link rel="icon"[^>]*>/, () => `<link rel="icon" href="${logo}">`);
  return html;
}
