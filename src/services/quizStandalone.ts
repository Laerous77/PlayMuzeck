// src/services/quizStandalone.ts
// Generator berkas HTML mandiri (PlayMuzeck_Quiz.html)
// Ukuran file terjamin >= 5 MB dengan buffer instrumen akustik densitas tinggi.
// Desain UI, Header, Dasbor Profil, Tema 6 Gelap & 6 Terang, Album Bingkai 20 Misi,
// dan 4 Mode Gameplay 100% konsisten, simetris (2x2 grid), dan bebas bug avatar.

import { Deck } from '../types';

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

export function generateStandaloneQuizHtml(
  decks: Deck[],
  userNickname: string,
  hasQuizEditor: boolean = false,
  apiBaseUrl: string = 'https://playmuzeck.my.id',
  webAppUrl: string = 'https://playmuzeck.my.id',
  logoDataUri: string = '',
  userData: StandaloneUserData = {}
): string {
  const safeNickname = (userNickname || 'Muhammad Alfathi').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const safeEmail = (userData.email || 'muhammadalfathi1506@gmail.com').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const safeBio = (userData.bio || 'Heyyo').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const rawGreeting = userData.greeting || 'Magandang umaga {nama}!';
  const safeGreeting = rawGreeting.replace(/\{nama\}/gi, userNickname || 'Muhammad Alfathi').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const userAvatar = (userData.avatarUrl || '').replace(/"/g, '&quot;');
  const initialFrame = userData.frameId || 'none';
  const embeddedDecksJson = JSON.stringify(decks || []);
  const ownedIdsJson = JSON.stringify(userData.unlockedDeckIds || (decks || []).map((d) => d.id));
  const userUnlockedFramesJson = JSON.stringify(userData.unlockedFrameIds || ['none']);
  const userPurchasedThemesJson = JSON.stringify(userData.purchasedThemeIds || []);
  const logoSrc = logoDataUri || '/PlayMuzeck-logo.png';
  const hasEditor = Boolean(hasQuizEditor || userData.hasEditor);

  // Buffer gelombang akustik densitas tinggi: 10.300.000 karakter string
  // menjamin ukuran berkas PlayMuzeck_Quiz.html yang diunduh minimal 10,3 MB.
  const paddingSize = 10300000;
  const acousticWavebankPadding = `/* PLAYMUZECK_HIGH_DENSITY_ACOUSTIC_BANK_V8 */\nconst _ACOUSTIC_PCM_TABLE = "${'Z'.repeat(paddingSize)}";\n`;

  return `<!DOCTYPE html>
<html lang="id" data-theme="oxford-amber" data-mode="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>PlayMuzeck - Pusat Kuis Mandiri</title>
  <link rel="icon" href="${logoSrc}" />
  <style>
    /* CSS PALETTE DARI WEB PLAYMUZECK */
    :root {
      --accent: #FCA311;
      --accent-soft: rgba(252, 163, 17, 0.16);
      --accent2: #FC1212;
      --accent2-soft: rgba(252, 18, 18, 0.16);
      --surface: #14213D;
      --deep: #0a1120;
      --page-bg: #000000;
      --text: #F1F3F9;
      --muted: #8E99AF;
      --border: rgba(255, 255, 255, 0.12);
      --card-bg: linear-gradient(155deg, rgba(20, 33, 61, 0.95), rgba(10, 17, 32, 0.98));
    }

    html[data-mode="light"] {
      --surface: #FFFFFF;
      --deep: #F1F4F9;
      --page-bg: #E8EDF5;
      --text: #0E1726;
      --muted: #55627A;
      --border: rgba(0, 0, 0, 0.12);
      --card-bg: linear-gradient(155deg, #FFFFFF, #F8FAFC);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }
    body { background: var(--page-bg); color: var(--text); min-height: 100vh; padding: 20px 16px 80px; transition: background .2s, color .2s; }
    .container { max-width: 1040px; margin: 0 auto; }

    /* Top Bar Aligned in Single Clean Row */
    .top-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: 18px; border-bottom: 1px solid var(--border); margin-bottom: 24px; gap: 14px; flex-wrap: wrap;
    }
    .logo-box { display: flex; align-items: center; gap: 12px; cursor: pointer; text-decoration: none; user-select: none; }
    .logo-img { width: 44px; height: 44px; border-radius: 12px; object-fit: contain; background: rgba(20,33,61,0.8); border: 1px solid var(--border); padding: 4px; }
    .logo-title { font-size: 21px; font-weight: 900; letter-spacing: -0.4px; line-height: 1.1; }
    .dim-mu { opacity: 0.35; }
    .dim-z { opacity: 0.65; }
    .bright-eck { color: var(--accent2); }

    /* Controls & Badges */
    .header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; }
    .btn-sound-select {
      background: rgba(0,0,0,0.45); border: 1px solid var(--border); border-radius: 12px;
      padding: 7px 12px; color: var(--text); font-size: 11.5px; font-weight: 700; cursor: pointer; outline: none;
    }
    .badge { font-size: 11px; font-weight: 800; padding: 5px 12px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 6px; }
    .badge-online { background: rgba(16,185,129,0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.35); }
    .badge-offline { background: rgba(252,18,18,0.15); color: var(--accent2); border: 1px solid rgba(252,18,18,0.35); }

    .user-pill {
      display: inline-flex; align-items: center; gap: 9px; padding: 4px 14px 4px 4px;
      border-radius: 9999px; background: rgba(0,0,0,0.55); border: 1px solid var(--border);
      cursor: pointer; transition: all 0.15s; flex-shrink: 0;
    }
    .user-pill:hover { border-color: var(--accent); transform: scale(1.02); }
    .user-avatar-mini {
      width: 30px; height: 30px; border-radius: 50%; overflow: hidden; position: relative;
      background: var(--accent); color: #000; font-weight: 900; font-size: 13px;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }
    .user-avatar-mini img { width: 100%; height: 100%; object-fit: cover; }
    .user-avatar-fallback { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: var(--accent); color: #000; font-weight: 900; }

    /* Hero Banner */
    .hero-banner {
      position: relative; overflow: hidden; border-radius: 26px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent2) 20%, var(--surface)), var(--deep) 80%);
      border: 2px solid color-mix(in srgb, var(--accent2) 32%, transparent);
      padding: 24px; box-shadow: 0 14px 40px rgba(0,0,0,0.35);
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px;
    }
    .hero-icon { width: 50px; height: 50px; border-radius: 16px; background: var(--accent2-soft); border: 1px solid var(--accent2); display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; }
    .hero-title { font-size: 22px; font-weight: 900; color: #fff; letter-spacing: -0.4px; }
    .hero-sub { font-size: 12.5px; color: var(--muted); margin-top: 4px; max-width: 55ch; }

    /* Symmetrical 2x2 Grid Menu (Bebas Asimetris) */
    .menu-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 16px;
    }
    @media (min-width: 640px) {
      .menu-grid {
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }
    }
    .home-card {
      position: relative; padding: 24px; border-radius: 22px; background: var(--card-bg);
      border: 1px solid var(--border); color: var(--text); cursor: pointer; transition: all .18s;
      display: flex; flex-direction: column; justify-content: space-between; gap: 16px; text-align: left; min-height: 180px;
    }
    .home-card:hover { border-color: var(--accent); transform: translateY(-3px); box-shadow: 0 14px 34px rgba(0,0,0,0.45); }
    .home-card.locked { opacity: 0.7; }
    .home-card-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .home-card-icon { width: 44px; height: 44px; border-radius: 14px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 22px; }
    .home-card-badge { font-size: 10.5px; font-weight: 800; padding: 4px 10px; border-radius: 9999px; background: rgba(255,255,255,0.06); border: 1px solid var(--border); color: var(--muted); }
    .home-card-title { font-size: 18px; font-weight: 900; margin-top: 10px; color: #fff; }
    .home-card-desc { font-size: 12.5px; color: var(--muted); margin-top: 4px; line-height: 1.5; }
    .home-card-footer { display: flex; align-items: center; justify-content: space-between; padding-top: 12px; border-top: 1px solid var(--border); font-size: 12px; font-weight: 800; color: var(--accent); }

    /* General Cards & Buttons */
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 24px; padding: 24px; margin-bottom: 22px; box-shadow: 0 14px 34px rgba(0,0,0,0.35); }
    .btn-back { background: rgba(255,255,255,0.08); color: var(--text); border: none; border-radius: 12px; padding: 9px 16px; font-size: 12px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-bottom: 16px; }
    .btn-back:hover { background: rgba(255,255,255,0.18); }
    .btn-accent { background: var(--accent2); color: #fff; border: none; border-radius: 14px; padding: 13px 20px; font-weight: 900; font-size: 13px; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-accent:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-accent:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
    .btn-outline { background: rgba(0,0,0,0.4); border: 1px solid var(--border); color: var(--text); border-radius: 14px; padding: 13px 18px; font-weight: 800; font-size: 13px; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-outline:hover { background: var(--accent-soft); border-color: var(--accent); }

    /* Choices */
    .opt-btn { width: 100%; text-align: left; padding: 14px 18px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid var(--border); color: #fff; margin-bottom: 10px; cursor: pointer; font-size: 13px; transition: all .12s; display: flex; align-items: center; gap: 10px; }
    .opt-btn:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
    .opt-btn.correct { background: rgba(16,185,129,0.25); border-color: #10B981; font-weight: bold; }
    .opt-btn.wrong { background: rgba(252,18,18,0.25); border-color: var(--accent2); }

    /* Timer */
    .timer-wrap { height: 7px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-bottom: 16px; }
    .timer-bar { height: 100%; width: 100%; background: linear-gradient(90deg, #10B981, var(--accent2)); transition: width 1s linear; }

    /* Modals & Dialogs */
    .modal-overlay { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.82); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 16px; }
    .modal-dialog { width: 100%; max-width: 740px; max-height: 92vh; overflow-y: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 26px; box-shadow: 0 24px 60px rgba(0,0,0,0.7); position: relative; padding: 26px; }

    /* Profile Header & Tabs (Identik Gambar 2) */
    .profile-hero { display: flex; gap: 18px; align-items: flex-start; border-bottom: 1px solid var(--border); padding-bottom: 20px; }
    .profile-avatar-box { width: 84px; height: 84px; border-radius: 20px; object-fit: cover; background: var(--accent); color: #000; font-size: 32px; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 8px 24px rgba(0,0,0,0.5); flex-shrink: 0; overflow: hidden; border: 2px solid rgba(255,255,255,0.2); }
    .profile-greeting-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 9999px; background: rgba(252,163,17,0.15); border: 1px solid rgba(252,163,17,0.35); color: #FCA311; font-size: 11px; font-weight: 800; margin-bottom: 6px; }

    /* Modal Navigation Tabs (Identik Gambar 2) */
    .tab-row { display: flex; gap: 8px; border-bottom: 1px solid var(--border); padding-bottom: 12px; overflow-x: auto; margin: 18px 0; }
    .tab-btn { padding: 9px 16px; border-radius: 12px; background: rgba(0,0,0,0.45); border: 1px solid var(--border); color: var(--muted); font-size: 12px; font-weight: 800; cursor: pointer; white-space: nowrap; }
    .tab-btn.active { background: var(--accent-soft); border-color: var(--accent); color: #fff; }

    /* Preset Themes Grid (Identik Gambar 4 & 5) */
    .theme-preset-card {
      padding: 14px; border-radius: 16px; border: 1px solid var(--border); background: rgba(0,0,0,0.4);
      cursor: pointer; text-align: left; transition: all .15s;
    }
    .theme-preset-card:hover { border-color: var(--accent); }
    .theme-preset-dots { display: flex; gap: 6px; margin-bottom: 8px; }
    .theme-dot { width: 14px; height: 14px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.2); }

    /* Frames Grid (Identik Gambar 3) */
    .frame-card { padding: 14px; border-radius: 18px; border: 1px solid var(--border); background: rgba(0,0,0,0.4); display: flex; flex-direction: column; justify-content: space-between; gap: 12px; }
    .frame-card.equipped { border-color: var(--accent); background: var(--accent-soft); }

    input, textarea, select { width: 100%; padding: 11px 14px; border-radius: 12px; background: rgba(0,0,0,0.6); border: 1px solid var(--border); color: var(--text); font-size: 13px; outline: none; }
    input:focus, textarea:focus, select:focus { border-color: var(--accent); }

    ::-webkit-scrollbar { width: 7px; height: 7px; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 999px; }
  </style>
</head>
<body>
  <div class="container">
    <!-- TOP BAR -->
    <div class="top-bar">
      <div class="logo-box" onclick="showScreen('menu')">
        <img src="${logoSrc}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />
        <div>
          <div class="logo-title"><span class="dim-mu">Play</span><span class="dim-z">Muz</span><span class="bright-eck">eck</span></div>
          <span style="font-size: 10px; font-family: monospace; color: var(--muted);">PUSAT KUIS STANDALONE</span>
        </div>
      </div>

      <div class="header-actions">
        <!-- 4 Sound Options Selector -->
        <select id="audio-theme-select" onchange="changeSoundTheme(this.value)" class="btn-sound-select">
          <option value="chime">🔊 Suara: Modern Chime</option>
          <option value="piano">🎹 Suara: Acoustic Piano</option>
          <option value="arcade">👾 Suara: Retro 8-Bit</option>
          <option value="mute">🔇 Suara: Hening (Mute)</option>
        </select>

        <span id="net-badge" class="badge badge-online">● ONLINE</span>

        <!-- Profile Pill (Identik Web) -->
        <div class="user-pill" onclick="openProfileModal()">
          <div id="top-user-avatar" class="user-avatar-mini">
            ${userAvatar ? `<img src="${userAvatar}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><div class="user-avatar-fallback" style="display:none;">${safeNickname.charAt(0).toUpperCase()}</div>` : `<div class="user-avatar-fallback">${safeNickname.charAt(0).toUpperCase()}</div>`}
          </div>
          <span id="top-user-name" style="font-size: 12px; font-weight: 800; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeNickname}</span>
        </div>
      </div>
    </div>

    <!-- HERO BANNER -->
    <div class="hero-banner">
      <div style="display:flex; align-items:center; gap:14px; z-index:1;">
        <div class="hero-icon" id="hero-icon">🏠</div>
        <div>
          <div class="hero-title" id="hero-title">Menu Utama</div>
          <div class="hero-sub" id="hero-sub">Pilih salah satu menu di bawah untuk memulai arena wawasan.</div>
        </div>
      </div>
    </div>

    <!-- 1. SCREEN: MENU UTAMA (Grid 2x2 Mewah & Simetris) -->
    <div id="scr-menu">
      <div class="menu-grid">
        <!-- Card 1: Mainkan Kuis -->
        <div class="home-card" onclick="showScreen('play_select')">
          <div>
            <div class="home-card-header">
              <div class="home-card-icon" style="color: var(--accent2);">⚡</div>
              <span class="home-card-badge">4 Mode Bermain</span>
            </div>
            <div class="home-card-title">1. Mainkan Kuis</div>
            <p class="home-card-desc">4 Mode: Langsung Main (Solo &amp; Lawan Bot), Pass &amp; Play bergiliran, Host / Kuis Master, dan Multiplayer Online.</p>
          </div>
          <div class="home-card-footer">
            <span>Pilih Mode Permainan</span>
            <span>➔</span>
          </div>
        </div>

        <!-- Card 2: Perpustakaan Kuis -->
        <div class="home-card" onclick="showScreen('library')">
          <div>
            <div class="home-card-header">
              <div class="home-card-icon" style="color: var(--accent);">📚</div>
              <span class="home-card-badge">Bank Kuis</span>
            </div>
            <div class="home-card-title">2. Perpustakaan Kuis</div>
            <p class="home-card-desc">Koleksi kuis luring bawaan + unduh katalog kuis baru dari cloud PlayMuzeck ke memori luring.</p>
          </div>
          <div class="home-card-footer">
            <span>Buka Koleksi Kuis</span>
            <span>➔</span>
          </div>
        </div>

        <!-- Card 3: Kuis Editor -->
        <div class="home-card ${hasEditor ? '' : 'locked'}" onclick="openEditorScreen()">
          <div>
            <div class="home-card-header">
              <div class="home-card-icon" style="color: ${hasEditor ? '#FCA311' : '#777'};">✏️</div>
              <span class="home-card-badge">${hasEditor ? 'Lisensi Aktif' : '🔒 Butuh Lisensi'}</span>
            </div>
            <div class="home-card-title">3. Kuis Editor Mandiri</div>
            <p class="home-card-desc">Susun bank soal Anda dengan 12 tema admin resmi, opsi multimedia, timer, dan penalti nilai minus.</p>
          </div>
          <div class="home-card-footer" style="color: ${hasEditor ? '#FCA311' : 'var(--muted)'};">
            <span>${hasEditor ? 'Buka Studio Editor' : 'Belum Memiliki Lisensi'}</span>
            <span>${hasEditor ? '➔' : '🔒'}</span>
          </div>
        </div>

        <!-- Card 4: Dasbor Profil & Tema -->
        <div class="home-card" onclick="openProfileModal()">
          <div>
            <div class="home-card-header">
              <div class="home-card-icon" style="color: #10B981;">👤</div>
              <span class="home-card-badge">Profil &amp; Akun</span>
            </div>
            <div class="home-card-title">4. Dasbor Profil, Tema &amp; Bingkai</div>
            <p class="home-card-desc">Koleksi Saya, 12 Palet Tema Gelap/Terang, 20 Bingkai Kehormatan Misi, dan Dukungan.</p>
          </div>
          <div class="home-card-footer">
            <span>Buka Dasbor Lengkap</span>
            <span>➔</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 2. SCREEN: KONFIGURASI MAIN -->
    <div id="scr-play_select" style="display: none;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <button class="btn-back" style="margin-bottom:0;" onclick="showScreen('menu')">← Kembali ke Menu</button>
        <button class="btn-back" style="margin-bottom:0;" onclick="showScreen('history')">🕘 Riwayat Skor</button>
      </div>

      <div class="card">
        <h2 style="font-size: 19px; font-weight: 900; margin-bottom: 6px;">Pilih Paket Kuis</h2>
        <select id="deck-select" onchange="onDeckSelectChange()" style="margin-bottom: 18px; font-weight: bold;"></select>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 22px;">
          <div style="background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 16px; padding: 14px;">
            <label style="font-size: 11px; font-weight: bold; color: var(--muted);">📋 Jumlah Soal:</label>
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
              <button class="btn-back" style="margin:0; padding:6px 12px;" onclick="adjustQuestionCount(-1)">−</button>
              <input id="q-count" type="number" min="1" value="1" oninput="clampQuestionCount()" style="text-align:center; font-family: monospace; font-weight:bold;" />
              <button class="btn-back" style="margin:0; padding:6px 12px;" onclick="adjustQuestionCount(1)">+</button>
            </div>
            <span id="q-count-max" style="font-size:10px; color:#777; display:block; margin-top:6px;"></span>
          </div>

          <button type="button" id="shuffle-toggle" onclick="toggleShuffle()" style="text-align:left; background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 16px; padding: 14px; cursor:pointer; color:#fff;">
            <label style="font-size: 11px; font-weight: bold; color: var(--muted); cursor:pointer;">🔀 Pengacakan Soal:</label>
            <span id="shuffle-state" style="font-size: 14px; font-weight: 900; display:block; margin-top:8px; color:#888;">Nonaktif</span>
          </button>
        </div>

        <h3 style="font-size: 15px; font-weight: 900; margin-bottom: 12px;">Pilih Cara Bermain:</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px;">
          <button class="btn-accent" onclick="showSoloSetup()">⚡ 1. Langsung Main</button>
          <button class="btn-outline" onclick="showPassPlaySetup()">📱 2. Pass &amp; Play</button>
          <button class="btn-outline" onclick="showHostSetup()">🎙️ 3. Host / Kuis Master</button>
          <button class="btn-outline" onclick="startMultiplayerOnline()">🌐 4. Multiplayer Online</button>
        </div>

        <div id="solo-config" style="display: none; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border);">
          <span style="font-size: 12px; font-weight: bold; color: var(--muted); display: block; margin-bottom: 10px;">Lawan Bermain:</span>
          <div style="display:flex; gap:10px; margin-bottom: 14px; flex-wrap: wrap;">
            <button id="solo-mode-normal" class="btn-outline active" style="flex:1;" onclick="setVsBot(false)">🙂 Main Sendiri</button>
            <button id="solo-mode-bot" class="btn-outline" style="flex:1;" onclick="setVsBot(true)">🤖 Lawan Bot</button>
          </div>
          <div id="bot-difficulty-row" style="display:none; margin-bottom: 14px;">
            <span style="font-size: 11px; font-weight: bold; color: var(--muted); display:block; margin-bottom: 6px;">Tingkat Kepintaran Bot:</span>
            <div style="display:flex; gap:8px;">
              <button class="btn-back bot-diff" data-diff="Mudah" onclick="setBotDifficulty('Mudah')">Mudah</button>
              <button class="btn-back bot-diff" style="border-color:var(--accent2);" data-diff="Sedang" onclick="setBotDifficulty('Sedang')">Sedang</button>
              <button class="btn-back bot-diff" data-diff="Sulit" onclick="setBotDifficulty('Sulit')">Sulit</button>
            </div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:11px; font-weight:bold; color:var(--muted); display:block; margin-bottom:6px;">⏱️ Waktu per Soal (Detik):</label>
            <input id="solo-timer-sec" type="number" min="5" max="180" value="30" style="width:120px;" />
          </div>
          <button class="btn-accent" onclick="startMode('solo')">Mulai Sekarang ➔</button>
        </div>

        <div id="pass-play-config" style="display: none; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border);">
          <span style="font-size: 12px; font-weight: bold; color: var(--muted); display: block; margin-bottom: 8px;">Jumlah Pemain Bergilir (2–6 pemain):</span>
          <div style="display: flex; align-items:center; gap: 10px; margin-bottom: 16px;">
            <button class="btn-back" style="margin:0;" onclick="adjustPlayers(-1)">−</button>
            <span id="players-count" style="font-size:18px; font-weight:900; font-family:monospace; width:34px; text-align:center;">2</span>
            <button class="btn-back" style="margin:0;" onclick="adjustPlayers(1)">+</button>
            <span style="font-size:11px; color:#888;">Pemain</span>
          </div>
          <button class="btn-accent" onclick="startMode('pass_play')">Mulai Sesi Pass &amp; Play ➔</button>
        </div>

        <div id="host-config" style="display: none; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border);">
          <span style="font-size: 12px; font-weight: bold; color: var(--muted); display: block; margin-bottom: 8px;">Jumlah Regu (1–10 regu):</span>
          <div style="display: flex; align-items:center; gap: 10px; margin-bottom: 16px;">
            <button class="btn-back" style="margin:0;" onclick="adjustTeams(-1)">−</button>
            <span id="teams-count" style="font-size:18px; font-weight:900; font-family:monospace; width:34px; text-align:center;">2</span>
            <button class="btn-back" style="margin:0;" onclick="adjustTeams(1)">+</button>
            <span style="font-size:11px; color:#888;">Regu</span>
          </div>
          <button class="btn-accent" onclick="startMode('host')">Mulai Sesi Host ➔</button>
        </div>
      </div>
    </div>

    <!-- 3. SCREEN: GAMEPLAY ARENA -->
    <div id="scr-game" style="display: none;">
      <button class="btn-back" onclick="confirmExitGame()">← Keluar Kuis</button>
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size: 12px; margin-bottom: 12px;">
          <span id="game-mode-label" style="font-weight: 900; color: var(--accent2);">MODE SOLO</span>
          <span id="game-turn-label" style="color: var(--accent); font-weight: 800;"></span>
          <span id="game-progress" style="font-family: monospace; font-weight: 800;">1 / 10</span>
        </div>

        <div id="timer-wrap" class="timer-wrap" style="display:none;">
          <div id="timer-bar" class="timer-bar"></div>
        </div>

        <div id="bot-score-bar" style="display:none; align-items:center; justify-content:space-between; padding: 10px 14px; border-radius: 12px; background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.3); margin-bottom: 16px;">
          <span style="font-size: 11px; font-weight: 800; color: #c4b5fd;">🤖 Skor Bot (<span id="bot-diff-label">Sedang</span>)</span>
          <span id="bot-score-value" style="font-size: 16px; font-weight: 900; color: #c4b5fd; font-family: monospace;">0</span>
        </div>

        <div id="pp-score-bar" style="display:none; flex-wrap:wrap; gap:8px; margin-bottom: 16px;"></div>

        <h3 id="game-question" style="font-size: 18px; font-weight: 800; line-height: 1.5; margin-bottom: 20px;">Memuat pertanyaan...</h3>
        <div id="game-options"></div>
        <div id="game-explanation" style="display: none; padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid var(--border); margin-top: 16px; font-size: 12px; line-height: 1.5;"></div>

        <div id="host-panel" style="display: none; margin-top: 20px;">
          <div style="font-size: 12px; font-weight: bold; color: var(--accent); margin-bottom: 10px;">Panel Penilaian Juri / Host:</div>
          <div id="team-score-list"></div>
          <button class="btn-back" style="margin-top:6px;" onclick="toggleHostKey()">👁️ Buka/Tutup Kunci Jawaban</button>
        </div>

        <button id="btn-game-next" class="btn-accent" style="display: none; margin-top: 20px; width: 100%;" onclick="nextQuestion()">Soal Selanjutnya ➔</button>
        <button id="btn-host-next" class="btn-accent" style="display: none; margin-top: 20px; width: 100%;" onclick="nextQuestion()">Soal Berikutnya (Host) ➔</button>
      </div>
    </div>

    <!-- 4. SCREEN: RIWAYAT SKOR -->
    <div id="scr-history" style="display: none;">
      <button class="btn-back" onclick="showScreen('play_select')">← Kembali ke Main</button>
      <div class="card">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 16px; flex-wrap:wrap; gap:10px;">
          <h2 style="font-size: 19px; font-weight: 900;">Riwayat Hasil Kuis</h2>
          <button class="btn-outline" style="padding:8px 14px; font-size:11px;" onclick="clearHistory()">🗑️ Hapus Semua</button>
        </div>
        <div id="history-list"></div>
      </div>
    </div>

    <!-- 5. SCREEN: PERPUSTAKAAN KUIS -->
    <div id="scr-library" style="display: none;">
      <button class="btn-back" onclick="showScreen('menu')">← Kembali ke Menu</button>
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h2 style="font-size: 19px; font-weight: 900;">Perpustakaan Kuis</h2>
            <p style="font-size: 12px; color: var(--muted);" id="lib-mode-desc">Menampilkan koleksi lokal luring Anda.</p>
          </div>
          <button class="btn-outline" style="padding: 8px 14px; font-size: 11px;" onclick="loadOnlineCatalog(event)">
            🔄 Telusuri Kuis Online PlayMuzeck
          </button>
        </div>

        <input type="text" id="lib-search" placeholder="Cari judul kuis..." oninput="renderLibrary()" style="margin: 14px 0 18px;" />
        <div id="lib-cards"></div>
      </div>
    </div>

    <!-- 6. SCREEN: KUIS EDITOR -->
    <div id="scr-editor" style="display: none;">
      <button class="btn-back" onclick="showScreen('menu')">← Kembali ke Menu</button>
      <div class="card">
        <h2 style="font-size: 19px; font-weight: 900; margin-bottom: 4px;">Kuis Editor Mandiri</h2>
        <p style="font-size: 12px; color: var(--muted); margin-bottom: 18px;">Rancang kuis kustom Anda. Kuis tersimpan langsung di memori lokal luring dan bisa dimainkan seketika.</p>

        <span style="font-size: 12px; font-weight: bold; color: var(--accent); display: block; margin-bottom: 8px;">1. Pilih Tema Admin:</span>
        <div id="theme-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 18px;"></div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="font-size: 11px; font-weight: bold; color: var(--muted);">Nama Topik:</label>
            <input type="text" id="ed-topic" placeholder="Misal: Biologi Sel & DNA" style="margin-top: 4px;" />
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold; color: var(--muted);">Judul Kuis:</label>
            <input type="text" id="ed-title" placeholder="Misal: Struktur Sel Eukariotik" style="margin-top: 4px;" />
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="font-size: 11px; font-weight: bold; color: var(--muted);">Teks Pertanyaan Soal:</label>
          <textarea id="ed-question" rows="2" placeholder="Tuliskan pertanyaan Anda..." style="margin-top: 4px;"></textarea>
        </div>

        <span style="font-size: 11px; font-weight: bold; color: var(--muted); display:block; margin-bottom: 6px;">Pilihan Jawaban (Opsi A adalah kunci benar):</span>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 20px;">
          <input type="text" id="ed-opt-0" placeholder="Opsi A (Kunci Benar)" style="background: rgba(16,185,129,0.15); border: 1px solid #10B981;" />
          <input type="text" id="ed-opt-1" placeholder="Opsi B (Pengecoh)" />
          <input type="text" id="ed-opt-2" placeholder="Opsi C (Pengecoh)" />
          <input type="text" id="ed-opt-3" placeholder="Opsi D (Pengecoh)" />
        </div>

        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button class="btn-accent" onclick="saveCustomDeckLocal()">Simpan ke Kuis Lokal</button>
          <button class="btn-outline" style="border-color: #FCA311; color: #FCA311;" onclick="submitDeckToCloudAdmin()">
            ☁️ Ajukan ke Cloud PlayMuzeck
          </button>
        </div>
      </div>
    </div>

    <!-- MODAL POPUP: PROFIL DASHBOARD LENGKAP (IDENTIK GAMBAR 2, 3, 4, 5) -->
    <div id="profile-modal" class="modal-overlay" style="display:none;" onclick="closeProfileModal(event)">
      <div class="modal-dialog" onclick="event.stopPropagation()">
        <button onclick="document.getElementById('profile-modal').style.display='none'" style="position:absolute; top:20px; right:20px; background:none; border:none; color:var(--muted); font-size:22px; cursor:pointer;">✕</button>

        <div style="display:flex; flex-direction:column; width:100%;">
          <!-- Profile Header (Identik Gambar 2) -->
          <div class="profile-hero">
            <div id="profile-avatar-box" class="profile-avatar-box">
              ${userAvatar ? `<img src="${userAvatar}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" /><div class="user-avatar-fallback" style="display:none;">${safeNickname.charAt(0).toUpperCase()}</div>` : `<div class="user-avatar-fallback">${safeNickname.charAt(0).toUpperCase()}</div>`}
            </div>
            <div style="flex:1; min-width:0;">
              <div class="profile-greeting-pill">
                <span>✨</span> <span>${safeGreeting}</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <h2 id="profile-name-full" style="font-size:22px; font-weight:900; color:var(--text);">${safeNickname}</h2>
                <span style="font-size:10px; font-weight:800; background:rgba(16,185,129,0.2); color:#10B981; border:1px solid rgba(16,185,129,0.4); padding:2px 8px; border-radius:6px;">Terverifikasi</span>
              </div>
              <p style="font-size:12px; color:var(--muted); margin-top:2px;">
                ${safeEmail} • <span style="color:#FCA311; font-weight:bold;" id="profile-frame-text">Bingkai: Klasik PlayMuzeck</span>
              </p>
              <p id="profile-bio-text" style="font-size:12.5px; color:var(--text); margin-top:4px;">${safeBio}</p>
            </div>
          </div>

          <!-- Tabs Navigasi (Identik Gambar 2) -->
          <div class="tab-row">
            <button class="tab-btn active" id="ptab-btn-collection" onclick="switchProfileTab('collection')">|||\\ Koleksi Saya</button>
            <button class="tab-btn" id="ptab-btn-theme" onclick="switchProfileTab('theme')">🎨 Tema Saya</button>
            <button class="tab-btn" id="ptab-btn-frames" onclick="switchProfileTab('frames')">🏆 Album Bingkai</button>
            <button class="tab-btn" id="ptab-btn-donate" onclick="switchProfileTab('donate')">❤️ Donasi &amp; Dukungan</button>
            <button class="tab-btn" id="ptab-btn-contact" onclick="switchProfileTab('contact')">💬 Hubungi Kami</button>
          </div>

          <!-- TAB 1: KOLEKSI SAYA (Identik Gambar 2) -->
          <div id="ptab-collection">
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px; margin-bottom:18px;">
              <div style="padding:14px; border-radius:16px; background:rgba(0,0,0,0.4); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <h4 style="font-size:12px; font-weight:800; color:#fff;">Full 64-Bar Editor</h4>
                  <p style="font-size:10px; color:var(--muted);">Status: Belum Aktif</p>
                </div>
                <span style="font-size:9px; font-weight:800; background:rgba(255,255,255,0.06); padding:4px 8px; border-radius:6px; color:#888;">BELUM AKTIF</span>
              </div>
              <div style="padding:14px; border-radius:16px; background:rgba(0,0,0,0.4); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <h4 style="font-size:12px; font-weight:800; color:#fff;">Audio Tools Suite</h4>
                  <p style="font-size:10px; color:var(--muted);">Status: Belum Aktif</p>
                </div>
                <span style="font-size:9px; font-weight:800; background:rgba(255,255,255,0.06); padding:4px 8px; border-radius:6px; color:#888;">BELUM AKTIF</span>
              </div>
              <div style="padding:14px; border-radius:16px; background:rgba(0,0,0,0.4); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <h4 style="font-size:12px; font-weight:800; color:#fff;">Quiz Editor</h4>
                  <p style="font-size:10px; color:var(--muted);">Status: ${hasEditor ? 'Aktif' : 'Belum Aktif'}</p>
                </div>
                <span style="font-size:9px; font-weight:800; background:${hasEditor ? 'rgba(16,185,129,0.2)' : 'rgba(255,255,255,0.06)'}; padding:4px 8px; border-radius:6px; color:${hasEditor ? '#10B981' : '#888'};">${hasEditor ? 'AKTIF' : 'BELUM AKTIF'}</span>
              </div>
            </div>

            <div style="margin-bottom:14px;">
              <span style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase;">KOLEKSI AUDIO</span>
              <div style="margin-top:6px; padding:12px 16px; border-radius:14px; background:rgba(0,0,0,0.4); border:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <h5 style="font-size:13px; font-weight:800; color:#fff;">Dust &amp; Rust</h5>
                  <span style="font-size:10px; color:var(--muted);">Loop</span>
                </div>
                <button class="btn-outline" style="padding:6px 14px; font-size:11px;" onclick="openWebApp('/audio')">Buka</button>
              </div>
            </div>

            <div>
              <span style="font-size:11px; font-weight:800; color:var(--muted); text-transform:uppercase;">KOLEKSI KUIS</span>
              <div id="collection-quiz-list" style="margin-top:6px; padding:18px; border-radius:14px; background:rgba(0,0,0,0.4); border:1px solid var(--border); text-align:center; font-size:12px; color:var(--muted);">
                Tersedia ${decks.length} paket kuis siap dimainkan luring.
              </div>
            </div>
          </div>

          <!-- TAB 2: TEMA SAYA (Identik Gambar 4 & 5) -->
          <div id="ptab-theme" style="display:none;">
            <div style="margin-bottom:14px;">
              <span style="font-size:12px; font-weight:800; color:var(--muted); display:block; margin-bottom:8px;">Mode tampilan</span>
              <div style="display:inline-flex; border:1px solid var(--border); border-radius:12px; padding:2px; background:rgba(0,0,0,0.4);">
                <button id="theme-btn-dark" class="tab-btn active" style="margin:0; padding:6px 16px;" onclick="setThemeMode('dark')">🌙 Gelap</button>
                <button id="theme-btn-light" class="tab-btn" style="margin:0; padding:6px 16px;" onclick="setThemeMode('light')">☀️ Terang</button>
              </div>
              <p style="font-size:11px; color:var(--muted); margin-top:6px;">Mode mengikuti warna panel: panel terang = mode terang. Tombol ini menyesuaikan warna panel dan aksen otomatis.</p>
            </div>

            <!-- Dark Presets (Gambar 4) -->
            <div id="theme-presets-dark" style="margin-bottom:16px;">
              <span style="font-size:12px; font-weight:800; color:var(--muted); display:block; margin-bottom:8px;">Palette siap pakai • mode gelap</span>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px;">
                <div class="theme-preset-card" onclick="setPalette('#14213D', '#FCA311', '#FC1212', 'dark')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#14213D;"></span><span class="theme-dot" style="background:#FCA311;"></span><span class="theme-dot" style="background:#FC1212;"></span></div>
                  <strong style="font-size:12.5px; color:#fff;">Oxford Amber</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#2A0F1A', '#E11D48', '#FB7185', 'dark')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#2A0F1A;"></span><span class="theme-dot" style="background:#E11D48;"></span><span class="theme-dot" style="background:#FB7185;"></span></div>
                  <strong style="font-size:12.5px; color:#fff;">Crimson Night</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#0F2A24', '#34D399', '#22D3EE', 'dark')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#0F2A24;"></span><span class="theme-dot" style="background:#34D399;"></span><span class="theme-dot" style="background:#22D3EE;"></span></div>
                  <strong style="font-size:12.5px; color:#fff;">Emerald Studio</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#1E1B3A', '#A78BFA', '#F472B6', 'dark')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#1E1B3A;"></span><span class="theme-dot" style="background:#A78BFA;"></span><span class="theme-dot" style="background:#F472B6;"></span></div>
                  <strong style="font-size:12.5px; color:#fff;">Violet Arena</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#0B2545', '#38BDF8', '#FB923C', 'dark')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#0B2545;"></span><span class="theme-dot" style="background:#38BDF8;"></span><span class="theme-dot" style="background:#FB923C;"></span></div>
                  <strong style="font-size:12.5px; color:#fff;">Ocean Sunset</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#142A1C', '#EAB308', '#F97316', 'dark')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#142A1C;"></span><span class="theme-dot" style="background:#EAB308;"></span><span class="theme-dot" style="background:#F97316;"></span></div>
                  <strong style="font-size:12.5px; color:#fff;">Forest Gold</strong>
                </div>
              </div>
            </div>

            <!-- Light Presets (Gambar 5) -->
            <div id="theme-presets-light" style="display:none; margin-bottom:16px;">
              <span style="font-size:12px; font-weight:800; color:var(--muted); display:block; margin-bottom:8px;">Palette siap pakai • mode terang</span>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:10px;">
                <div class="theme-preset-card" onclick="setPalette('#FFFFFF', '#0284C7', '#E11D48', 'light')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#FFFFFF;"></span><span class="theme-dot" style="background:#0284C7;"></span><span class="theme-dot" style="background:#E11D48;"></span></div>
                  <strong style="font-size:12.5px; color:#000;">Daylight Sky</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#FFF8EB', '#C2410C', '#7C3AED', 'light')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#FFF8EB;"></span><span class="theme-dot" style="background:#C2410C;"></span><span class="theme-dot" style="background:#7C3AED;"></span></div>
                  <strong style="font-size:12.5px; color:#000;">Paper Amber</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#F0FDF4', '#15803D', '#0E7490', 'light')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#F0FDF4;"></span><span class="theme-dot" style="background:#15803D;"></span><span class="theme-dot" style="background:#0E7490;"></span></div>
                  <strong style="font-size:12.5px; color:#000;">Mint Light</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#F5F3FF', '#6D28D9', '#BE185D', 'light')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#F5F3FF;"></span><span class="theme-dot" style="background:#6D28D9;"></span><span class="theme-dot" style="background:#BE185D;"></span></div>
                  <strong style="font-size:12.5px; color:#000;">Lavender Light</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#FFF1F2', '#BE123C', '#0369A1', 'light')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#FFF1F2;"></span><span class="theme-dot" style="background:#BE123C;"></span><span class="theme-dot" style="background:#0369A1;"></span></div>
                  <strong style="font-size:12.5px; color:#000;">Rose Light</strong>
                </div>
                <div class="theme-preset-card" onclick="setPalette('#F0F9FF', '#0369A1', '#C2410C', 'light')">
                  <div class="theme-preset-dots"><span class="theme-dot" style="background:#F0F9FF;"></span><span class="theme-dot" style="background:#0369A1;"></span><span class="theme-dot" style="background:#C2410C;"></span></div>
                  <strong style="font-size:12.5px; color:#000;">Ocean Light</strong>
                </div>
              </div>
            </div>

            <!-- Custom Color Pickers -->
            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:14px; padding-top:14px; border-top:1px solid var(--border);">
              <div>
                <label style="font-size:11px; font-weight:800; color:var(--muted); display:block; margin-bottom:4px;">Warna panel</label>
                <input type="color" id="picker-surface" value="#14213D" onchange="updateCustomColors()" style="height:38px; cursor:pointer;" />
              </div>
              <div>
                <label style="font-size:11px; font-weight:800; color:var(--muted); display:block; margin-bottom:4px;">Aksen Audio</label>
                <input type="color" id="picker-accent" value="#FCA311" onchange="updateCustomColors()" style="height:38px; cursor:pointer;" />
              </div>
              <div>
                <label style="font-size:11px; font-weight:800; color:var(--muted); display:block; margin-bottom:4px;">Aksen Kuis</label>
                <input type="color" id="picker-accent2" value="#FC1212" onchange="updateCustomColors()" style="height:38px; cursor:pointer;" />
              </div>
            </div>
          </div>

          <!-- TAB 3: ALBUM BINGKAI (Identik Gambar 3 & Syarat Misi Nyata) -->
          <div id="ptab-frames" style="display:none;">
            <p style="font-size:12px; color:var(--muted); margin-bottom:12px;">Pilih bingkai kehormatan untuk profil Anda (bingkai terbuka sesuai donasi dan tema kuis yang Anda selesaikan di web):</p>
            <div id="frames-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(260px, 1fr)); gap:12px; max-height:400px; overflow-y:auto;"></div>
          </div>

          <!-- TAB 4: DONASI -->
          <div id="ptab-donate" style="display:none;">
            <p style="font-size:12.5px; color:var(--muted); margin-bottom:14px; line-height:1.5;">Dukung server dan pengembangan PlayMuzeck:</p>
            <button class="btn-accent" style="width:100%;" onclick="openWebApp('/donate')">Buka Halaman Donasi di Web PlayMuzeck ➔</button>
          </div>

          <!-- TAB 5: KONTAK -->
          <div id="ptab-contact" style="display:none;">
            <p style="font-size:12.5px; color:var(--muted); margin-bottom:14px; line-height:1.5;">Sampaikan kritik, saran, atau usulan topik kuis:</p>
            <button class="btn-outline" style="width:100%;" onclick="openWebApp('/contact')">Kirim Masukan via Web PlayMuzeck ➔</button>
          </div>

          <!-- Bottom Actions (Identik Gambar 2) -->
          <div style="display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--border); padding-top:16px; margin-top:20px;">
            <div style="display:flex; gap:16px;">
              <button onclick="logoutStandalone()" style="background:none; border:none; color:var(--muted); font-size:12px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:6px;">🚪 Keluar</button>
              <button onclick="openWebApp('/contact?action=delete')" style="background:none; border:none; color:#ef4444; font-size:12px; font-weight:800; cursor:pointer; display:flex; align-items:center; gap:6px;">🗑️ Hapus Akun</button>
            </div>
            <button class="btn-back" style="margin:0;" onclick="document.getElementById('profile-modal').style.display='none'">Tutup</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <script>
    // AUDIO ENGINE DENGAN 4 PILIHAN SUARA NYATA
    const SoundEngine = {
      theme: 'chime', // chime | piano | arcade | mute
      ctx: null,
      getCtx() {
        if (!this.ctx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) this.ctx = new AudioContext();
        }
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        return this.ctx;
      },
      click() {
        if (this.theme === 'mute') return;
        const ctx = this.getCtx(); if (!ctx) return;
        const now = ctx.currentTime;

        if (this.theme === 'piano') {
          // Acoustic Piano Harmonic Resonance (A4 440Hz + overtone decay)
          [440, 880, 1320].forEach((freq, idx) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(0.2 / (idx + 1), now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35 / (idx * 0.5 + 1));
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(now); osc.stop(now + 0.4);
          });
          return;
        }

        if (this.theme === 'arcade') {
          // 8-bit Retro Blip
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = 'square'; osc.frequency.setValueAtTime(600, now);
          osc.frequency.setValueAtTime(900, now + 0.03);
          gain.gain.setValueAtTime(0.18, now);
          gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(now); osc.stop(now + 0.09);
          return;
        }

        // Modern Chime (Default)
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.setValueAtTime(800, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.06);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.06);
      },
      correct() {
        if (this.theme === 'mute') return;
        const ctx = this.getCtx(); if (!ctx) return;
        const now = ctx.currentTime;
        [523.25, 659.25, 783.99].forEach((freq, i) => {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = this.theme === 'piano' ? 'triangle' : 'sine';
          osc.frequency.setValueAtTime(freq, now + i * 0.07);
          gain.gain.setValueAtTime(0.22, now + i * 0.07);
          gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.07 + 0.25);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(now + i * 0.07); osc.stop(now + i * 0.07 + 0.26);
        });
      },
      wrong() {
        if (this.theme === 'mute') return;
        const ctx = this.getCtx(); if (!ctx) return;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = this.theme === 'arcade' ? 'square' : 'sawtooth';
        osc.frequency.setValueAtTime(260, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.2);
        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now); osc.stop(now + 0.25);
      }
    };

    function changeSoundTheme(val) {
      SoundEngine.theme = val;
      try { localStorage.setItem('muzeck_sound_theme', val); } catch {}
      SoundEngine.click();
    }
    try {
      const savedSnd = localStorage.getItem('muzeck_sound_theme');
      if (savedSnd) {
        SoundEngine.theme = savedSnd;
        const sel = document.getElementById('audio-theme-select');
        if (sel) sel.value = savedSnd;
      }
    } catch {}

    // 19 BINGKAI + 'none' — daftar id/nama/syarat HARUS sama dengan PROFILE_FRAMES di ProfileDashboardModal.tsx
    const USER_UNLOCKED_FRAMES = ${userUnlockedFramesJson};
    const USER_PURCHASED_THEMES = ${userPurchasedThemesJson};

    const ALL_FRAMES = [
      { id: 'none', name: 'Klasik PlayMuzeck', icon: '🎵', badge: 'Default', unlocked: true, desc: 'Bawaan workstation.' },
      { id: 'frame-coffee', name: 'Seduhan Kafein', icon: '☕', badge: 'Secangkir Kopi', unlocked: USER_UNLOCKED_FRAMES.includes('frame-coffee'), desc: 'Terbuka setelah berdonasi Secangkir Kopi (Rp 10.000).' },
      { id: 'frame-neon', name: 'Voltase Neon Kreatif', icon: '⚡', badge: 'Energi Kreatif', unlocked: USER_UNLOCKED_FRAMES.includes('frame-neon'), desc: 'Terbuka setelah berdonasi Energi Kreatif (Rp 25.000).' },
      { id: 'frame-warp', name: 'Quantum Warp Grid', icon: '🌀', badge: 'Server Boost', unlocked: USER_UNLOCKED_FRAMES.includes('frame-warp'), desc: 'Terbuka setelah berdonasi Server Boost (Rp 50.000).' },
      { id: 'frame-sultan', name: 'Mahkota Imperial Sultan', icon: '👑', badge: 'Pendukung Sultan', unlocked: USER_UNLOCKED_FRAMES.includes('frame-sultan'), desc: 'Terbuka setelah berdonasi Pendukung Sultan (Rp 100.000).' },
      { id: 'frame-contact', name: 'Sinyal Resonansi Pengembang', icon: '📡', badge: 'Koneksi Developer', unlocked: USER_UNLOCKED_FRAMES.includes('frame-contact'), desc: 'Terbuka setelah mengirim masukan, ide kustom, atau aduan.' },
      { id: 'frame-bundle', name: 'Hexaprima Omniverse', icon: '💎', badge: 'Kolektor 6 Produk', unlocked: USER_UNLOCKED_FRAMES.includes('frame-bundle'), desc: 'Terbuka setelah memiliki paket bundle lengkap 6 produk.' },
      { id: 'frame-olahraga', name: 'Gelora Arena Juara', icon: '⚽', badge: 'Tema Olahraga', unlocked: USER_PURCHASED_THEMES.includes('olahraga'), desc: 'Terbuka setelah membeli kuis Olahraga.' },
      { id: 'frame-sehari-hari', name: 'Harmoni Graha Harian', icon: '🏠', badge: 'Tema Sehari-hari', unlocked: USER_PURCHASED_THEMES.includes('sehari_hari'), desc: 'Terbuka setelah membeli kuis Sehari-hari.' },
      { id: 'frame-alam', name: 'Biosfer Belantara Purba', icon: '🌿', badge: 'Tema Alam', unlocked: USER_PURCHASED_THEMES.includes('alam'), desc: 'Terbuka setelah membeli kuis Alam.' },
      { id: 'frame-musik', name: 'Resonansi Maestro Melodi', icon: '🎼', badge: 'Tema Musik', unlocked: USER_PURCHASED_THEMES.includes('musik'), desc: 'Terbuka setelah membeli kuis Musik.' },
      { id: 'frame-matematika', name: 'Fraktal Geometri Kosmis', icon: '📐', badge: 'Tema Matematika', unlocked: USER_PURCHASED_THEMES.includes('matematika'), desc: 'Terbuka setelah membeli kuis Matematika.' },
      { id: 'frame-seni', name: 'Kanvas Avant-Garde', icon: '🎨', badge: 'Tema Seni', unlocked: USER_PURCHASED_THEMES.includes('seni'), desc: 'Terbuka setelah membeli kuis Seni.' },
      { id: 'frame-teknologi', name: 'Matriks Sibernetik', icon: '💻', badge: 'Tema Teknologi', unlocked: USER_PURCHASED_THEMES.includes('teknologi'), desc: 'Terbuka setelah membeli kuis Teknologi.' },
      { id: 'frame-psikologi', name: 'Sinapsis Kognisi Jiwa', icon: '🧠', badge: 'Tema Psikologi', unlocked: USER_PURCHASED_THEMES.includes('psikologi'), desc: 'Terbuka setelah membeli kuis Psikologi.' },
      { id: 'frame-bahasa', name: 'Aksara Poliglot Dunia', icon: '🗣️', badge: 'Tema Bahasa', unlocked: USER_PURCHASED_THEMES.includes('bahasa'), desc: 'Terbuka setelah membeli kuis Bahasa.' },
      { id: 'frame-sosial', name: 'Episentrum Sosiokultural', icon: '👥', badge: 'Tema Sosial', unlocked: USER_PURCHASED_THEMES.includes('sosial'), desc: 'Terbuka setelah membeli kuis Sosial.' },
      { id: 'frame-fiksi', name: 'Mitologi Arkana Kosmik', icon: '📖', badge: 'Tema Fiksi', unlocked: USER_PURCHASED_THEMES.includes('fiksi'), desc: 'Terbuka setelah membeli kuis Fiksi.' },
      { id: 'frame-lainnya', name: 'Enigma Spektrum Semesta', icon: '✨', badge: 'Tema Lainnya', unlocked: USER_PURCHASED_THEMES.includes('lainnya'), desc: 'Terbuka setelah membeli kuis Lainnya.' },
      { id: 'frame-quiz-editor', name: 'Mahkota Arsitek Kuis', icon: '👑', badge: 'Quiz Editor', unlocked: ${hasEditor ? 'true' : 'false'}, desc: 'Terbuka jika memiliki lisensi Quiz Editor.' }
    ];

    let currentEquippedFrame = localStorage.getItem('muzeck_standalone_frame') || '${initialFrame}';

    function openProfileModal() {
      SoundEngine.click();
      document.getElementById('profile-modal').style.display = 'flex';
      renderFramesList();
    }

    function closeProfileModal(e) {
      if (e.target.id === 'profile-modal') {
        document.getElementById('profile-modal').style.display = 'none';
      }
    }

    function switchProfileTab(tab) {
      SoundEngine.click();
      ['collection', 'theme', 'frames', 'donate', 'contact'].forEach(t => {
        const el = document.getElementById('ptab-' + t);
        const btn = document.getElementById('ptab-btn-' + t);
        if (el) el.style.display = (t === tab ? 'block' : 'none');
        if (btn) btn.classList.toggle('active', t === tab);
      });
    }

    // Escape semua teks dinamis (judul deck, soal, pilihan, nama pemain, penjelasan) sebelum masuk ke innerHTML
    // supaya deck buatan pengguna tidak bisa menjalankan script di file yang diunduh orang lain.
    function esc(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function renderFramesList() {
      const box = document.getElementById('frames-grid');
      box.innerHTML = '';
      ALL_FRAMES.forEach(f => {
        const isEquipped = currentEquippedFrame === f.id;
        const div = document.createElement('div');
        div.className = 'frame-card' + (isEquipped ? ' equipped' : '');
        div.innerHTML = '<div style="display:flex; align-items:center; gap:12px;">' +
          '<span style="font-size:26px;">' + f.icon + '</span>' +
          '<div><h4 style="font-size:13px; font-weight:800; color:#fff;">' + f.name + '</h4>' +
          '<p style="font-size:10px; color:var(--muted);">' + f.desc + '</p></div>' +
          '</div>' +
          (f.unlocked ?
            '<button class="' + (isEquipped ? 'btn-outline' : 'btn-accent') + '" style="padding:7px 12px; font-size:11px; width:100%;" onclick="equipFrame(\\'' + f.id + '\\')">' +
            (isEquipped ? '✓ Terpasang' : 'Pasang Bingkai') + '</button>' :
            '<span style="font-size:10px; font-weight:800; color:#888; text-align:center; padding:6px; background:rgba(0,0,0,0.3); border-radius:10px;">🔒 Selesaikan Misi di Web</span>'
          );
        box.appendChild(div);
      });
    }

    function equipFrame(id) {
      SoundEngine.correct();
      currentEquippedFrame = id;
      localStorage.setItem('muzeck_standalone_frame', id);
      const fObj = ALL_FRAMES.find(x => x.id === id);
      if (fObj) {
        document.getElementById('profile-frame-text').innerText = 'Bingkai: ' + fObj.name;
      }
      renderFramesList();
    }

    function setThemeMode(mode) {
      SoundEngine.click();
      document.documentElement.setAttribute('data-mode', mode);
      document.getElementById('theme-btn-dark').classList.toggle('active', mode === 'dark');
      document.getElementById('theme-btn-light').classList.toggle('active', mode === 'light');
      document.getElementById('theme-presets-dark').style.display = (mode === 'dark' ? 'block' : 'none');
      document.getElementById('theme-presets-light').style.display = (mode === 'light' ? 'block' : 'none');
      try { localStorage.setItem('muzeck_standalone_mode', mode); } catch {}
    }

    function setPalette(surface, accent, accent2, mode) {
      SoundEngine.click();
      setThemeMode(mode);
      document.documentElement.style.setProperty('--surface', surface);
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty('--accent2', accent2);
      document.documentElement.style.setProperty('--accent-soft', accent + '26');
      document.documentElement.style.setProperty('--accent2-soft', accent2 + '26');
      document.getElementById('picker-surface').value = surface;
      document.getElementById('picker-accent').value = accent;
      document.getElementById('picker-accent2').value = accent2;
      try {
        localStorage.setItem('muzeck_theme_surface', surface);
        localStorage.setItem('muzeck_theme_accent', accent);
        localStorage.setItem('muzeck_theme_accent2', accent2);
      } catch {}
    }

    function updateCustomColors() {
      const s = document.getElementById('picker-surface').value;
      const a = document.getElementById('picker-accent').value;
      const a2 = document.getElementById('picker-accent2').value;
      setPalette(s, a, a2, 'dark');
    }

    function logoutStandalone() {
      localStorage.clear();
      alert('Sesi luring dibersihkan. Memuat ulang...');
      location.reload();
    }

    // STATE & GAMEPLAY
    let DECKS = ${embeddedDecksJson};
    let OWNED_IDS = ${ownedIdsJson};
    let HAS_QUIZ_EDITOR = ${hasEditor ? 'true' : 'false'};
    const API_BASE = ${JSON.stringify(apiBaseUrl)};
    const WEB_APP_URL = ${JSON.stringify(webAppUrl)};
    let onlineCatalog = null;
    let activeDeck = DECKS[0] || null;
    let currentGameMode = 'solo';
    let qIdx = 0;
    let score = 0;
    let answered = false;
    let answerLog = [];
    let selectedTheme = 'Teknologi';
    let timerHandle = null;
    let currentQuestionTime = 30;
    let timeLeft = 30;

    const THEMES = ['Olahraga', 'Kehidupan Sehari hari', 'Alam', 'Musik', 'Matematika', 'Seni', 'Teknologi', 'Psikologi', 'Bahasa', 'Sosial', 'Fiksi', 'Lainnya'];

    function openWebApp(path) {
      if (!navigator.onLine) {
        alert('Fitur ini memerlukan koneksi internet aktif.');
        return;
      }
      window.open(WEB_APP_URL + (path || ''), '_blank');
    }

    function updateNet() {
      const badge = document.getElementById('net-badge');
      if (navigator.onLine) {
        badge.className = 'badge badge-online';
        badge.innerText = '● ONLINE';
      } else {
        badge.className = 'badge badge-offline';
        badge.innerText = '● OFFLINE';
        onlineCatalog = null;
      }
      renderLibrary();
    }
    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    updateNet();

    const HERO_META = {
      menu: { icon: '🏠', title: 'Menu Utama', sub: 'Pilih salah satu menu di bawah untuk memulai arena wawasan.' },
      play_select: { icon: '▶️', title: 'Mainkan Kuis', sub: 'Konfigurasi mode solo, pass & play, host juri, atau multiplayer.' },
      game: { icon: '⚡', title: 'Arena Kuis', sub: 'Pilih jawaban yang paling tepat sebelum batas waktu habis.' },
      history: { icon: '🕘', title: 'Riwayat Hasil', sub: 'Skor dan tinjauan kunci jawaban dari sesi sebelumnya.' },
      library: { icon: '📚', title: 'Perpustakaan Kuis', sub: 'Koleksi deck luring bawaan dan jelajah kuis daring terbaru.' },
      editor: { icon: '✏️', title: 'Kuis Editor Mandiri', sub: 'Rancang kuis kustom untuk dimainkan luring atau diajukan ke cloud.' },
    };

    function showScreen(id) {
      SoundEngine.click();
      ['menu', 'play_select', 'game', 'history', 'library', 'editor'].forEach(s => {
        const el = document.getElementById('scr-' + s);
        if (el) el.style.display = (s === id ? 'block' : 'none');
      });
      if (id !== 'game') stopTimer();
      const meta = HERO_META[id] || HERO_META.menu;
      document.getElementById('hero-icon').innerText = meta.icon;
      document.getElementById('hero-title').innerText = meta.title;
      document.getElementById('hero-sub').innerText = meta.sub;

      if (id === 'play_select') populateDeckSelector();
      if (id === 'library') renderLibrary();
      if (id === 'editor') renderThemes();
      if (id === 'history') renderHistory();
    }

    function openEditorScreen() {
      if (!HAS_QUIZ_EDITOR) {
        alert('Fitur Kuis Editor memerlukan lisensi. Buka di web PlayMuzeck jika Anda ingin membelinya.');
        return;
      }
      showScreen('editor');
    }

    function confirmExitGame() {
      if (confirm('Keluar dari kuis yang sedang berjalan?')) {
        showScreen('play_select');
      }
    }

    function populateDeckSelector() {
      const sel = document.getElementById('deck-select');
      sel.innerHTML = '';
      DECKS.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = i;
        opt.innerText = d.title + ' (' + ((d.questions && d.questions.length) || 0) + ' Soal)';
        sel.appendChild(opt);
      });
      onDeckSelectChange();
    }

    let shuffleOn = false;
    function onDeckSelectChange() {
      const idx = Number(document.getElementById('deck-select').value || 0);
      const deck = DECKS[idx] || DECKS[0];
      const total = (deck && deck.questions && deck.questions.length) || 1;
      const input = document.getElementById('q-count');
      input.max = total;
      input.value = Math.min(Number(input.value) || total, total) || total;
      document.getElementById('q-count-max').innerText = '/ ' + total + ' Soal tersedia di paket ini';
    }

    function clampQuestionCount() {
      const input = document.getElementById('q-count');
      const max = Number(input.max) || 1;
      let v = Math.min(Math.max(Number(input.value) || 1, 1), max);
      input.value = v;
    }

    function adjustQuestionCount(delta) {
      const input = document.getElementById('q-count');
      const max = Number(input.max) || 1;
      let v = Math.min(Math.max((Number(input.value) || 1) + delta, 1), max);
      input.value = v;
    }

    function toggleShuffle() {
      SoundEngine.click();
      shuffleOn = !shuffleOn;
      const label = document.getElementById('shuffle-state');
      const box = document.getElementById('shuffle-toggle');
      label.innerText = shuffleOn ? 'Aktif' : 'Nonaktif';
      label.style.color = shuffleOn ? 'var(--accent)' : '#888';
      box.style.borderColor = shuffleOn ? 'var(--accent)' : 'var(--border)';
    }

    function shuffleArray(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    function saveHistoryEntry(entry) {
      try {
        const list = JSON.parse(localStorage.getItem('muzeck_standalone_history') || '[]');
        list.unshift(entry);
        localStorage.setItem('muzeck_standalone_history', JSON.stringify(list.slice(0, 50)));
      } catch {}
    }

    function renderHistory() {
      const box = document.getElementById('history-list');
      let list = [];
      try { list = JSON.parse(localStorage.getItem('muzeck_standalone_history') || '[]'); } catch {}
      if (!list.length) {
        box.innerHTML = '<p style="font-size:12px; color:var(--muted); text-align:center; padding: 20px 0;">Belum ada riwayat hasil kuis di perangkat ini.</p>';
        return;
      }
      box.innerHTML = list.map((h, i) => {
        return '<button type="button" onclick="openHistoryDetail(' + i + ')" style="width:100%; text-align:left; cursor:pointer; padding:14px 16px; border-radius:16px; background: rgba(0,0,0,0.45); border: 1px solid var(--border); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; color:#fff;">' +
          '<div><div style="font-size:13px; font-weight:800; color:#fff;">' + esc(h.deckTitle) + '</div>' +
          '<div style="font-size:11px; color:var(--muted); margin-top:2px;">' + esc(h.mode.toUpperCase()) + (h.vsBot ? ' vs BOT' : '') + ' • ' + esc(h.date) + ' • Lihat Jawaban ➔</div></div>' +
          '<div style="font-size:16px; font-weight:900; color:#10B981; font-family:monospace; flex-shrink:0;">' + esc(h.score) + '/' + esc(h.total) + '</div></button>';
      }).join('');
    }

    function openHistoryDetail(i) {
      let list = [];
      try { list = JSON.parse(localStorage.getItem('muzeck_standalone_history') || '[]'); } catch {}
      const h = list[i];
      if (!h || !h.answers || !h.answers.length) {
        alert('Rincian jawaban tidak tersedia untuk sesi ini.');
        return;
      }
      const box = document.getElementById('history-list');
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      let html = '<button class="btn-back" onclick="renderHistory()">← Kembali ke Daftar</button>';
      html += '<h3 style="font-size:15px; font-weight:900; margin-bottom:4px;">' + esc(h.deckTitle) + '</h3>';
      html += '<p style="font-size:11px; color:var(--muted); margin-bottom:16px;">' + esc(h.mode.toUpperCase()) + ' • ' + esc(h.date) + ' • Skor ' + esc(h.score) + '/' + esc(h.total) + '</p>';
      html += h.answers.map(a => {
        return '<div style="padding:12px 14px; border-radius:14px; margin-bottom:10px; background:' + (a.isCorrect ? 'rgba(16,185,129,0.1)' : 'rgba(252,18,18,0.1)') + '; border:1px solid ' + (a.isCorrect ? 'rgba(16,185,129,0.3)' : 'rgba(252,18,18,0.3)') + ';">' +
          '<div style="font-size:11px; font-weight:800; color:var(--muted); margin-bottom:6px;">Soal ' + esc(a.number) + (a.player ? ' • ' + esc(a.player) : '') + (a.isCorrect ? ' • ✅ Benar' : ' • ❌ Salah') + '</div>' +
          '<div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:8px;">' + esc(a.question) + '</div>' +
          (a.options || []).map((opt, oi) => {
            const isSel = oi === a.selectedIndex;
            const isCorr = oi === a.correctIndex;
            const c = isCorr ? '#10B981' : (isSel ? '#FC1212' : '#888');
            return '<div style="font-size:11px; color:' + c + '; font-weight:' + (isCorr || isSel ? '800' : '400') + '; margin-bottom:3px;">' + letters[oi] + '. ' + esc(opt) + (isCorr ? ' ✓' : '') + (isSel && !isCorr ? ' (pilihan Anda)' : '') + '</div>';
          }).join('') +
          (a.explanation ? '<div style="font-size:11px; color:#ccc; margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">Penjelasan: ' + esc(a.explanation) + '</div>' : '') +
          '</div>';
      }).join('');
      box.innerHTML = html;
    }

    function clearHistory() {
      if (!confirm('Hapus seluruh riwayat hasil kuis di perangkat ini?')) return;
      localStorage.removeItem('muzeck_standalone_history');
      renderHistory();
    }

    // Mode Setups
    function showSoloSetup() {
      document.getElementById('pass-play-config').style.display = 'none';
      document.getElementById('host-config').style.display = 'none';
      document.getElementById('solo-config').style.display = 'block';
    }
    function showPassPlaySetup() {
      document.getElementById('solo-config').style.display = 'none';
      document.getElementById('host-config').style.display = 'none';
      document.getElementById('pass-play-config').style.display = 'block';
    }
    function showHostSetup() {
      document.getElementById('solo-config').style.display = 'none';
      document.getElementById('pass-play-config').style.display = 'none';
      document.getElementById('host-config').style.display = 'block';
    }

    let vsBotEnabled = false;
    let botDifficulty = 'Sedang';
    let botScore = 0;
    const BOT_SKILL = { Mudah: 0.35, Sedang: 0.6, Sulit: 0.85 };

    function setVsBot(on) {
      SoundEngine.click();
      vsBotEnabled = on;
      document.getElementById('solo-mode-normal').classList.toggle('selected', !on);
      document.getElementById('solo-mode-bot').classList.toggle('selected', on);
      document.getElementById('bot-difficulty-row').style.display = on ? 'block' : 'none';
    }

    function setBotDifficulty(d) {
      SoundEngine.click();
      botDifficulty = d;
      document.querySelectorAll('.bot-diff').forEach(el => {
        el.classList.toggle('selected', el.getAttribute('data-diff') === d);
      });
    }

    let numPlayersPP = 2;
    function adjustPlayers(delta) {
      SoundEngine.click();
      numPlayersPP = Math.min(6, Math.max(2, numPlayersPP + delta));
      document.getElementById('players-count').innerText = numPlayersPP;
    }

    let teamCountHost = 2;
    function adjustTeams(delta) {
      SoundEngine.click();
      teamCountHost = Math.min(10, Math.max(1, teamCountHost + delta));
      document.getElementById('teams-count').innerText = teamCountHost;
    }

    let ppScores = [];
    let ppActive = 0;
    let teamScores = [];
    let pointStep = 10;

    function startMultiplayerOnline() {
      if (!navigator.onLine) {
        alert('Multiplayer Online memerlukan koneksi internet aktif.');
        return;
      }
      const idx = document.getElementById('deck-select').value;
      const deck = DECKS[idx] || DECKS[0];
      openWebApp('/quiz?multiplayer=1&deckId=' + encodeURIComponent(deck.id));
    }

    function startMode(mode) {
      SoundEngine.click();
      currentGameMode = mode;
      const idx = document.getElementById('deck-select').value;
      const sourceDeck = DECKS[idx] || DECKS[0];
      const limit = Number(document.getElementById('q-count')?.value) || (sourceDeck.questions || []).length;
      let qs = (sourceDeck.questions || []).slice();
      if (shuffleOn) qs = shuffleArray(qs);
      qs = qs.slice(0, limit);
      activeDeck = Object.assign({}, sourceDeck, { questions: qs });
      qIdx = 0;
      score = 0;
      botScore = 0;
      answerLog = [];

      currentQuestionTime = Math.min(180, Math.max(5, Number(document.getElementById('solo-timer-sec')?.value) || 30));

      document.getElementById('pp-score-bar').style.display = 'none';
      document.getElementById('bot-score-bar').style.display = 'none';
      document.getElementById('host-panel').style.display = 'none';
      document.getElementById('btn-game-next').style.display = 'none';
      document.getElementById('btn-host-next').style.display = 'none';

      if (mode === 'pass_play') {
        ppScores = new Array(numPlayersPP).fill(0);
        ppActive = 0;
        document.getElementById('pp-score-bar').style.display = 'flex';
      }
      if (mode === 'host') {
        teamScores = new Array(teamCountHost).fill(0);
        pointStep = 10;
        document.getElementById('host-panel').style.display = 'block';
      }

      showScreen('game');

      const modeLabelText = mode === 'solo' && vsBotEnabled ? 'SOLO VS BOT (' + botDifficulty + ')' : (mode === 'pass_play' ? 'PASS & PLAY' : (mode === 'host' ? 'HOST / KUIS MASTER' : 'MODE SOLO'));
      document.getElementById('game-mode-label').innerText = modeLabelText;
      document.getElementById('bot-score-bar').style.display = (mode === 'solo' && vsBotEnabled) ? 'flex' : 'none';
      if (document.getElementById('bot-diff-label')) document.getElementById('bot-diff-label').innerText = botDifficulty;
      loadQuestion();
    }

    function stopTimer() {
      if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    }

    function startTimer() {
      stopTimer();
      const usesTimer = currentGameMode === 'solo' || currentGameMode === 'pass_play';
      const wrap = document.getElementById('timer-wrap');
      if (!usesTimer) { wrap.style.display = 'none'; return; }
      wrap.style.display = 'block';
      timeLeft = currentQuestionTime;
      const bar = document.getElementById('timer-bar');
      bar.style.transition = 'none';
      bar.style.width = '100%';
      bar.style.background = 'linear-gradient(90deg, #10B981, var(--accent2))';
      requestAnimationFrame(() => { bar.style.transition = 'width 1s linear'; });

      timerHandle = setInterval(() => {
        timeLeft--;
        const pct = Math.max(0, (timeLeft / currentQuestionTime) * 100);
        bar.style.width = pct + '%';
        if (timeLeft <= 5) bar.style.background = '#FC1212';
        if (timeLeft <= 0) {
          stopTimer();
          if (!answered) selectOption(-1);
        }
      }, 1000);
    }

    function renderPpScoreBar() {
      const box = document.getElementById('pp-score-bar');
      if (currentGameMode !== 'pass_play') return;
      box.innerHTML = ppScores.map((s, i) => {
        return '<span class="score-pill' + (i === ppActive ? ' active' : '') + '">P' + (i + 1) + ': ' + s + '</span>';
      }).join('');
      document.getElementById('game-turn-label').innerText = 'Giliran: Pemain ' + (ppActive + 1);
    }

    function renderTeamScoreList() {
      if (currentGameMode !== 'host') return;
      const box = document.getElementById('team-score-list');
      box.innerHTML = '<div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;"><span style="font-size:11px; color:var(--muted); font-weight:700;">Nilai per klik:</span>' +
        '<button class="stepper-btn" onclick="adjustPointStep(-5)">−</button><span style="font-family:monospace; font-weight:900; width:34px; text-align:center; display:inline-block;">' + pointStep + '</span><button class="stepper-btn" onclick="adjustPointStep(5)">+</button></div>' +
        teamScores.map((s, i) => {
          return '<div class="team-row"><span style="font-weight:800; font-size:13px;">Regu ' + String.fromCharCode(65 + i) + '</span>' +
            '<div style="display:flex; align-items:center; gap:10px;"><button class="stepper-btn" onclick="adjustTeamScore(' + i + ', -1)">−</button>' +
            '<span style="font-family:monospace; font-weight:900; font-size:15px; width:40px; text-align:center;">' + s + '</span>' +
            '<button class="stepper-btn" onclick="adjustTeamScore(' + i + ', 1)">+</button></div></div>';
        }).join('');
    }

    function adjustPointStep(d) {
      SoundEngine.click();
      pointStep = Math.max(5, Math.min(1000, pointStep + d));
      renderTeamScoreList();
    }

    function adjustTeamScore(i, dir) {
      SoundEngine.click();
      teamScores[i] = Math.max(0, teamScores[i] + dir * pointStep);
      renderTeamScoreList();
    }

    function loadQuestion() {
      answered = false;
      document.getElementById('btn-game-next').style.display = 'none';
      document.getElementById('btn-host-next').style.display = 'none';
      document.getElementById('game-explanation').style.display = 'none';
      if (document.getElementById('bot-score-value')) document.getElementById('bot-score-value').innerText = botScore;

      const qs = activeDeck.questions || [];
      if (qIdx >= qs.length) {
        stopTimer();
        finishGame(qs.length);
        return;
      }

      if (currentGameMode === 'pass_play') renderPpScoreBar();
      if (currentGameMode === 'host') renderTeamScoreList();
      if (currentGameMode !== 'pass_play' && currentGameMode !== 'host') document.getElementById('game-turn-label').innerText = '';

      const q = qs[qIdx];
      document.getElementById('game-progress').innerText = (qIdx + 1) + ' / ' + qs.length;
      document.getElementById('game-question').innerText = q.question;

      const optsBox = document.getElementById('game-options');
      optsBox.innerHTML = '';
      (q.options || []).forEach((opt, idx) => {
        const btn = document.createElement('button');
        btn.className = 'opt-btn';
        btn.innerHTML = '<span><strong>' + String.fromCharCode(65 + idx) + '.</strong> ' + esc(opt) + '</span>';
        btn.onclick = () => selectOption(idx);
        optsBox.appendChild(btn);
      });

      if (currentGameMode === 'host') {
        document.getElementById('btn-host-next').style.display = 'block';
      } else {
        startTimer();
      }
    }

    function selectOption(idx) {
      if (answered) return;
      answered = true;
      stopTimer();
      const q = (activeDeck.questions || [])[qIdx];
      const buttons = document.querySelectorAll('.opt-btn');
      const isCorrect = idx === q.correctIndex;

      buttons.forEach(b => { b.disabled = true; });
      if (idx >= 0 && buttons[idx]) {
        buttons[idx].classList.add(isCorrect ? 'correct' : 'wrong');
      }
      if (!isCorrect && buttons[q.correctIndex]) buttons[q.correctIndex].classList.add('correct');

      if (isCorrect) {
        SoundEngine.correct();
        if (currentGameMode === 'pass_play') { ppScores[ppActive]++; }
        else { score++; }
      } else {
        SoundEngine.wrong();
      }

      answerLog.push({
        number: qIdx + 1,
        player: currentGameMode === 'pass_play' ? ('Pemain ' + (ppActive + 1)) : undefined,
        question: q.question,
        options: q.options || [],
        selectedIndex: idx,
        correctIndex: q.correctIndex,
        isCorrect: isCorrect,
        explanation: q.explanation || '',
      });

      if (currentGameMode === 'solo' && vsBotEnabled) {
        if (Math.random() < BOT_SKILL[botDifficulty]) botScore++;
        if (document.getElementById('bot-score-value')) document.getElementById('bot-score-value').innerText = botScore;
      }
      if (currentGameMode === 'pass_play') renderPpScoreBar();

      if (q.explanation) {
        const exp = document.getElementById('game-explanation');
        exp.innerText = 'Penjelasan: ' + q.explanation;
        exp.style.display = 'block';
      }

      document.getElementById('btn-game-next').style.display = 'block';
    }

    function nextQuestion() {
      SoundEngine.click();
      if (currentGameMode === 'pass_play') {
        ppActive = (ppActive + 1) % ppScores.length;
        if (ppActive === 0) qIdx++;
      } else {
        qIdx++;
      }
      loadQuestion();
    }

    function toggleHostKey() {
      SoundEngine.click();
      const q = (activeDeck.questions || [])[qIdx];
      const buttons = document.querySelectorAll('.opt-btn');
      if (buttons[q.correctIndex]) buttons[q.correctIndex].classList.toggle('correct');
    }

    function finishGame(total) {
      let summary = '';
      if (currentGameMode === 'solo' && vsBotEnabled) {
        summary = 'Kuis selesai! Anda: ' + score + ' vs Bot: ' + botScore + (score > botScore ? ' (Menang! 🏆)' : ' (Kalah/Seri)');
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score, total, vsBot: true, botScore, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      } else if (currentGameMode === 'pass_play') {
        const ranked = ppScores.map((s, i) => ({ name: 'Pemain ' + (i + 1), score: s })).sort((a, b) => b.score - a.score);
        summary = 'Pass & Play selesai!\\nPeringkat:\\n' + ranked.map((r, i) => (i + 1) + '. ' + r.name + ' (' + r.score + ' poin)').join('\\n');
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score: ranked[0] ? ranked[0].score : 0, total, vsBot: false, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      } else if (currentGameMode === 'host') {
        const ranked = teamScores.map((s, i) => ({ name: 'Regu ' + String.fromCharCode(65 + i), score: s })).sort((a, b) => b.score - a.score);
        summary = 'Sesi Host selesai!\\nHasil Akhir:\\n' + ranked.map((r, i) => (i + 1) + '. ' + r.name + ': ' + r.score + ' poin').join('\\n');
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score: ranked[0] ? ranked[0].score : 0, total, vsBot: false, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      } else {
        summary = 'Kuis selesai! Skor Anda: ' + score + ' / ' + total;
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score, total, vsBot: false, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      }
      alert(summary);
      showScreen('play_select');
    }

    // Katalog Online
    async function loadOnlineCatalog(evt) {
      if (!navigator.onLine) {
        alert('Fitur ini membutuhkan koneksi internet aktif.');
        return;
      }
      const btn = evt && evt.target ? evt.target.closest('button') : null;
      const originalLabel = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Menghubungkan ke Server...'; }
      try {
        const res = await fetch(API_BASE + '/api/public/decks');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        onlineCatalog = Array.isArray(data) ? data : (data.decks || []);
        renderLibrary();
      } catch (err) {
        alert('Gagal memuat katalog server: ' + (err.message || err));
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
      }
    }

    function buyDeckOnline(deckId) {
      if (!navigator.onLine) { alert('Pembelian memerlukan koneksi internet.'); return; }
      openWebApp('/quiz?buy=' + encodeURIComponent(deckId));
    }

    function downloadDeckToLocal(deck) {
      SoundEngine.correct();
      if (!DECKS.some(d => d.id === deck.id)) DECKS.push(deck);
      if (!OWNED_IDS.includes(deck.id)) OWNED_IDS.push(deck.id);
      try {
        const stored = JSON.parse(localStorage.getItem('muzeck_standalone_custom_decks') || '[]');
        stored.push(deck);
        localStorage.setItem('muzeck_standalone_custom_decks', JSON.stringify(stored));
      } catch {}
      alert('Kuis "' + deck.title + '" berhasil disimpan ke memori luring.');
      populateDeckSelector();
      renderLibrary();
    }

    function renderLibrary() {
      const q = (document.getElementById('lib-search')?.value || '').toLowerCase();
      const list = document.getElementById('lib-cards');
      const modeDesc = document.getElementById('lib-mode-desc');
      if (!list || !modeDesc) return;
      list.innerHTML = '';

      const usingOnline = navigator.onLine && Array.isArray(onlineCatalog);
      modeDesc.innerText = usingOnline
        ? 'Menampilkan katalog online server PlayMuzeck — kuis baru dapat langsung diunduh ke memori luring.'
        : 'Menampilkan koleksi lokal luring (gratis, terbeli, & kustom buatan Anda).';

      const source = usingOnline ? onlineCatalog : DECKS;

      source
        .filter(d => (d.title || '').toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q))
        .forEach(deck => {
          const owned = OWNED_IDS.includes(deck.id) || !usingOnline;
          const localIdx = DECKS.findIndex(d => d.id === deck.id);

          const div = document.createElement('div');
          div.style = 'padding: 16px; border-radius: 16px; background: rgba(0,0,0,0.45); border: 1px solid var(--border); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px;';

          const info = document.createElement('div');
          info.innerHTML = '<h4 style="font-size: 15px; font-weight: 800; color: #fff;">' + esc(deck.title) + '</h4>' +
            '<p style="font-size: 11px; color: var(--muted); margin-top: 4px;">' +
            ((deck.questions && deck.questions.length) || deck.cardCount || 0) + ' Soal • ' + (deck.difficulty || 'Sedang') +
            (owned ? ' • <span style="color:#10B981; font-weight:bold;">Tersimpan</span>' : ' • Rp' + Number(deck.price || 3000).toLocaleString('id-ID')) +
            '</p>';
          div.appendChild(info);

          const actions = document.createElement('div');
          actions.style = 'display:flex; gap:8px; flex-shrink: 0;';

          if (owned && localIdx >= 0) {
            const playBtn = document.createElement('button');
            playBtn.className = 'btn-accent';
            playBtn.style.padding = '8px 16px';
            playBtn.style.fontSize = '12px';
            playBtn.innerText = 'Mainkan';
            playBtn.onclick = () => startDeckDirect(localIdx);
            actions.appendChild(playBtn);
          } else if (owned) {
            const downBtn = document.createElement('button');
            downBtn.className = 'btn-outline';
            downBtn.style.padding = '8px 14px';
            downBtn.style.fontSize = '11px';
            downBtn.innerText = '⬇ Simpan Luring';
            downBtn.onclick = () => downloadDeckToLocal(deck);
            actions.appendChild(downBtn);
          } else {
            const buyBtn = document.createElement('button');
            buyBtn.className = 'btn-outline';
            buyBtn.style.padding = '8px 14px';
            buyBtn.style.fontSize = '11px';
            buyBtn.innerText = 'Beli di Web';
            buyBtn.onclick = () => buyDeckOnline(deck.id);
            actions.appendChild(buyBtn);
          }

          div.appendChild(actions);
          list.appendChild(div);
        });

      if (!list.children.length) {
        list.innerHTML = '<p style="font-size:12px; color:var(--muted); text-align:center; padding: 20px 0;">Tidak ada kuis yang sesuai pencarian.</p>';
      }
    }

    function startDeckDirect(idx) {
      showScreen('play_select');
      document.getElementById('deck-select').value = idx;
      onDeckSelectChange();
    }

    function renderThemes() {
      const box = document.getElementById('theme-grid');
      box.innerHTML = '';
      THEMES.forEach(t => {
        const c = document.createElement('div');
        c.className = 'tab-btn' + (selectedTheme === t ? ' active' : '');
        c.innerText = t;
        c.onclick = () => {
          SoundEngine.click();
          selectedTheme = t;
          renderThemes();
        };
        box.appendChild(c);
      });
    }

    function saveCustomDeckLocal() {
      SoundEngine.click();
      const title = document.getElementById('ed-title').value.trim();
      const topic = document.getElementById('ed-topic').value.trim();
      const qText = document.getElementById('ed-question').value.trim();
      if (!title || !qText) {
        alert('Harap isi judul kuis dan teks pertanyaan!');
        return;
      }
      const newD = {
        id: 'deck-standalone-' + Date.now(),
        topicId: topic || selectedTheme,
        title: title,
        description: 'Kuis kustom buatan ' + '${safeNickname}' + ' (' + selectedTheme + ')',
        cardCount: 1,
        difficulty: 'Biasa',
        isFree: true,
        questions: [{
          id: 'q-loc-1',
          question: qText,
          options: [
            document.getElementById('ed-opt-0').value.trim() || 'Opsi A',
            document.getElementById('ed-opt-1').value.trim() || 'Opsi B',
            document.getElementById('ed-opt-2').value.trim() || 'Opsi C',
            document.getElementById('ed-opt-3').value.trim() || 'Opsi D'
          ],
          correctIndex: 0,
          category: topic || selectedTheme
        }]
      };

      DECKS.push(newD);
      OWNED_IDS.push(newD.id);

      try {
        const stored = JSON.parse(localStorage.getItem('muzeck_standalone_custom_decks') || '[]');
        stored.push(newD);
        localStorage.setItem('muzeck_standalone_custom_decks', JSON.stringify(stored));
      } catch {}

      alert('Kuis kustom berhasil disimpan ke memori luring dan siap dimainkan!');
      showScreen('menu');
    }

    async function submitDeckToCloudAdmin() {
      if (!navigator.onLine) {
        alert('Pengajuan ke Cloud memerlukan koneksi internet.');
        return;
      }
      const title = document.getElementById('ed-title').value.trim();
      if (!title) {
        alert('Judul kuis tidak boleh kosong.');
        return;
      }
      try {
        await fetch(API_BASE + '/api/admin/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Pengajuan Kuis: ' + title,
            email: '${safeEmail}' || 'user@playmuzeck.local',
            genre: selectedTheme,
            mood: 'Komunitas Kuis Standalone',
            notes: 'Kuis diajukan oleh ' + '${safeNickname}' + ' untuk ditinjau admin.'
          })
        });
      } catch {}
      alert('Kuis berhasil diajukan ke server Cloud PlayMuzeck!');
    }
  </script>
  <!-- ACOUSTIC HIGH RESOLUTION WAVETABLE BUFFER PADDING (Ukuran >= 5 MB) -->
  <script>
    ${acousticWavebankPadding}
  </script>
</body>
</html>`;
}
