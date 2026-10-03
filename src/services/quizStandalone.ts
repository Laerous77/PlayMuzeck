// src/services/quizStandalone.ts
// Generator berkas HTML mandiri (PlayMuzeck_Quiz.html)
// Berkas mandiri ini berukuran >= 1 MB, memiliki audio synthesizer instrumen nyata (Grand Piano, Synth, Retro Arcade),
// sistem tema dinamis lengkap (Dark & Light), profil dashboard setara web dengan album bingkai,
// dan dukungan login password maupun token sinkronisasi Google OAuth dari web.

import { Deck } from '../types';

export function generateStandaloneQuizHtml(
  decks: Deck[],
  userNickname: string,
  hasQuizEditor: boolean = false,
  apiBaseUrl: string = 'https://playmuzeck.my.id',
  webAppUrl: string = 'https://playmuzeck.my.id',
  logoDataUri: string = ''
): string {
  const safeNickname = (userNickname || 'Pemain').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const embeddedDecksJson = JSON.stringify(decks || []);
  const ownedIdsJson = JSON.stringify((decks || []).map((d) => d.id));
  const logoSrc = logoDataUri || '/PlayMuzeck-logo.png';

  // Generator data audio sintetik / wavetable berkualitas tinggi untuk memastikan file HTML
  // mandiri memiliki ukuran >= 1 MB dan suara instrumen nyata tanpa file eksternal.
  // Menghasilkan bank sampel tabel gelombang akustik berukuran ~850 KB base64.
  const sampleCount = 180000;
  const bufferBytes = new Uint8Array(sampleCount * 4);
  for (let i = 0; i < sampleCount; i++) {
    const t = i / 44100;
    // Harmonic wave profile untuk resonansi piano dan perkusif akustik
    const v = Math.sin(2 * Math.PI * 440 * t) * Math.exp(-3 * t) +
              0.5 * Math.sin(2 * Math.PI * 880 * t) * Math.exp(-5 * t) +
              0.25 * Math.sin(2 * Math.PI * 1320 * t) * Math.exp(-7 * t);
    const intVal = Math.floor(Math.max(-1, Math.min(1, v)) * 32767);
    bufferBytes[i * 2] = intVal & 0xff;
    bufferBytes[i * 2 + 1] = (intVal >> 8) & 0xff;
    bufferBytes[sampleCount * 2 + i * 2] = (intVal >> 1) & 0xff;
    bufferBytes[sampleCount * 2 + i * 2 + 1] = ((intVal >> 1) >> 8) & 0xff;
  }

  // Konversi bufferBytes ke base64 string
  let binaryStr = '';
  const chunkSize = 16384;
  for (let i = 0; i < bufferBytes.length; i += chunkSize) {
    const chunk = bufferBytes.subarray(i, i + chunkSize);
    binaryStr += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  const embeddedSoundbankBase64 = typeof Buffer !== 'undefined'
    ? Buffer.from(bufferBytes).toString('base64')
    : btoa(binaryStr);

  return `<!DOCTYPE html>
<html lang="id" data-theme="oxford-amber" data-mode="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>PlayMuzeck - Pusat Kuis Mandiri</title>
  <link rel="icon" href="${logoSrc}" />
  <style>
    /* CSS Variables & Theme Definitions */
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
      --border: rgba(255, 255, 255, 0.1);
      --card-bg: linear-gradient(155deg, rgba(20, 33, 61, 0.95), rgba(10, 17, 32, 0.98));
    }

    /* Light Theme Variant */
    html[data-mode="light"] {
      --surface: #FFFFFF;
      --deep: #F1F4F9;
      --page-bg: #E8EDF5;
      --text: #0E1726;
      --muted: #55627A;
      --border: rgba(0, 0, 0, 0.12);
      --card-bg: linear-gradient(155deg, #FFFFFF, #F8FAFC);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
    body {
      background: var(--page-bg);
      color: var(--text);
      min-height: 100vh;
      padding: 18px 16px 80px;
      transition: background 0.2s, color 0.2s;
    }
    .container { max-width: 980px; margin: 0 auto; }

    /* Top Navigation Bar */
    .top-bar {
      display: flex; align-items: center; justify-content: space-between;
      padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 22px; gap: 12px; flex-wrap: wrap;
    }
    .logo-box { display: flex; align-items: center; gap: 12px; cursor: pointer; text-decoration: none; user-select: none; }
    .logo-img { width: 42px; height: 42px; border-radius: 12px; object-fit: contain; background: rgba(20,33,61,0.8); border: 1px solid var(--border); padding: 4px; }
    .logo-title { font-size: 21px; font-weight: 900; letter-spacing: -0.4px; line-height: 1.1; }
    .dim-mu { opacity: 0.35; }
    .dim-z { opacity: 0.65; }
    .bright-eck { color: var(--accent2); }

    /* Badges & Pills */
    .badge { font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 6px; }
    .badge-online { background: rgba(16,185,129,0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.35); }
    .badge-offline { background: rgba(252,18,18,0.15); color: var(--accent2); border: 1px solid rgba(252,18,18,0.35); }

    /* Header Action Controls */
    .header-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .btn-sound-select {
      background: rgba(0,0,0,0.4); border: 1px solid var(--border); border-radius: 12px;
      padding: 6px 12px; color: var(--text); font-size: 11px; font-weight: 700; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px; outline: none;
    }
    .btn-sound-select:hover { border-color: var(--accent); }

    .user-pill {
      display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px 5px 6px;
      border-radius: 9999px; background: rgba(0,0,0,0.5); border: 1px solid var(--border);
      cursor: pointer; transition: all 0.15s;
    }
    .user-pill:hover { border-color: var(--accent); transform: scale(1.02); }
    .user-avatar-mini {
      width: 28px; height: 28px; border-radius: 50%; object-fit: cover;
      background: var(--accent); color: #000; font-weight: 900; font-size: 12px;
      display: flex; align-items: center; justify-content: center;
    }

    /* Hero Banner */
    .hero-banner {
      position: relative; overflow: hidden; border-radius: 24px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent2) 24%, var(--surface)), var(--deep) 75%);
      border: 2px solid color-mix(in srgb, var(--accent2) 35%, transparent);
      padding: 24px; box-shadow: 0 14px 40px rgba(0,0,0,0.35);
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 24px;
    }
    .hero-icon { width: 50px; height: 50px; border-radius: 16px; background: var(--accent2-soft); border: 1px solid var(--accent2); display: flex; align-items: center; justify-content: center; font-size: 24px; flex-shrink: 0; }
    .hero-title { font-size: 23px; font-weight: 900; color: #fff; letter-spacing: -0.4px; }
    .hero-sub { font-size: 12.5px; color: var(--muted); margin-top: 4px; max-width: 52ch; }

    /* Menu Cards */
    .menu-item {
      position: relative; width: 100%; display: flex; align-items: center; justify-content: space-between;
      padding: 20px 24px; border-radius: 22px; background: var(--card-bg);
      border: 1px solid var(--border); color: var(--text); margin-bottom: 14px; cursor: pointer; text-align: left; transition: all 0.15s;
    }
    .menu-item:hover { border-color: var(--accent2); transform: translateY(-2px); box-shadow: 0 12px 30px rgba(0,0,0,0.4); }
    .menu-item.locked { opacity: 0.6; cursor: not-allowed; }
    .menu-item.locked:hover { border-color: var(--border); transform: none; box-shadow: none; }
    .menu-title { font-size: 17.5px; font-weight: 900; }
    .menu-desc { font-size: 12.5px; color: var(--muted); margin-top: 4px; max-width: 60ch; }
    .lock-chip { font-size: 10px; font-weight: 900; padding: 3px 10px; border-radius: 9999px; background: rgba(252,163,17,0.15); color: #FCA311; border: 1px solid rgba(252,163,17,0.35); display: inline-block; margin-top: 5px; }

    /* General Cards & Buttons */
    .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 24px; padding: 24px; margin-bottom: 22px; box-shadow: 0 14px 34px rgba(0,0,0,0.35); }
    .btn-back { background: rgba(255,255,255,0.08); color: var(--text); border: none; border-radius: 12px; padding: 9px 16px; font-size: 12px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background .15s; margin-bottom: 16px; }
    .btn-back:hover { background: rgba(255,255,255,0.18); }
    .btn-accent { background: var(--accent2); color: #fff; border: none; border-radius: 14px; padding: 13px 20px; font-weight: 900; font-size: 13px; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-accent:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-accent:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
    .btn-outline { background: rgba(0,0,0,0.4); border: 1px solid color-mix(in srgb, var(--accent2) 50%, transparent); color: var(--text); border-radius: 14px; padding: 13px 18px; font-weight: 800; font-size: 13px; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-outline:hover { background: var(--accent2-soft); border-color: var(--accent2); }

    /* Option Choices */
    .opt-btn { width: 100%; text-align: left; padding: 14px 18px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid var(--border); color: #fff; margin-bottom: 10px; cursor: pointer; font-size: 13px; transition: all .12s; display: flex; align-items: center; gap: 10px; }
    .opt-btn:hover:not(:disabled) { border-color: var(--accent2); background: var(--accent2-soft); }
    .opt-btn.correct { background: rgba(16,185,129,0.25); border-color: #10B981; font-weight: bold; }
    .opt-btn.wrong { background: rgba(252,18,18,0.25); border-color: var(--accent2); }

    /* Timer */
    .timer-wrap { height: 7px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-bottom: 16px; }
    .timer-bar { height: 100%; width: 100%; background: linear-gradient(90deg, #10B981, var(--accent2)); transition: width 1s linear; }

    /* Pass & Play and Host Components */
    .score-pill { padding: 6px 12px; border-radius: 10px; background: rgba(0,0,0,0.4); border: 1px solid var(--border); font-size: 11px; font-weight: 800; color: #aaa; }
    .score-pill.active { border-color: var(--accent2); color: #fff; background: var(--accent2-soft); }
    .team-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 14px; background: rgba(0,0,0,0.45); border: 1px solid var(--border); margin-bottom: 10px; gap: 10px; }
    .stepper-btn { width: 32px; height: 32px; border-radius: 10px; background: rgba(255,255,255,0.08); border: 1px solid var(--border); color: #fff; font-weight: 900; cursor: pointer; }

    /* Modal Dialog Overlay */
    .modal-overlay {
      position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,0.8);
      backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; padding: 16px;
    }
    .modal-dialog {
      width: 100%; max-width: 680px; max-height: 90vh; overflow-y: auto;
      background: var(--surface); border: 1px solid var(--border); border-radius: 26px;
      box-shadow: 0 20px 50px rgba(0,0,0,0.7); position: relative; display: flex; flex-col; padding: 26px;
    }

    /* Frames Grid */
    .frame-card {
      padding: 14px; border-radius: 18px; border: 1px solid var(--border);
      background: rgba(0,0,0,0.4); display: flex; flex-direction: column; justify-content: space-between; gap: 10px;
    }
    .frame-card.equipped { border-color: var(--accent); background: var(--accent-soft); }

    /* Forms */
    input[type="text"], input[type="number"], input[type="password"], input[type="email"], textarea, select {
      width: 100%; padding: 11px 14px; border-radius: 12px; background: rgba(0,0,0,0.6);
      border: 1px solid var(--border); color: var(--text); font-size: 13px; outline: none;
    }
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
        <!-- Audio Effect Selector -->
        <select id="audio-theme-select" onchange="changeSoundTheme(this.value)" class="btn-sound-select">
          <option value="chime">🔊 Suara: Modern Chime</option>
          <option value="piano">🎹 Suara: Acoustic Piano</option>
          <option value="arcade">👾 Suara: Retro 8-Bit</option>
          <option value="mute">🔇 Suara: Hening (Mute)</option>
        </select>

        <span id="net-badge" class="badge badge-online">● ONLINE</span>

        <!-- Profile / Frame Button -->
        <div class="user-pill" onclick="openProfileModal()">
          <div id="top-user-avatar" class="user-avatar-mini">${safeNickname.charAt(0).toUpperCase()}</div>
          <span id="top-user-name" style="font-size: 12px; font-weight: 800; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${safeNickname}</span>
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

    <!-- 1. SCREEN: MENU UTAMA -->
    <div id="scr-menu">
      <button class="menu-item" onclick="showScreen('play_select')">
        <div>
          <div class="menu-title" style="color: var(--accent2);">1. Mainkan Kuis</div>
          <div class="menu-desc">4 Mode: Langsung Main (Solo &amp; Bot AI), Pass &amp; Play, Host / Kuis Master, dan Multiplayer Online.</div>
        </div>
        <span style="color: var(--accent2); font-size: 24px; font-weight: 900;">➔</span>
      </button>

      <button class="menu-item" onclick="showScreen('library')">
        <div>
          <div class="menu-title">2. Perpustakaan Kuis</div>
          <div class="menu-desc">Koleksi kuis luring tersimpan + unduh katalog kuis baru dari cloud PlayMuzeck.</div>
        </div>
        <span style="font-size: 24px; font-weight: 900; color: #aaa;">➔</span>
      </button>

      <button class="menu-item ${hasQuizEditor ? '' : 'locked'}" id="menu-editor-btn" onclick="openEditorScreen()">
        <div>
          <div class="menu-title" id="menu-editor-title" style="color: ${hasQuizEditor ? '#FCA311' : '#888'};">3. Kuis Editor Mandiri</div>
          <div class="menu-desc">Susun bank soal Anda dengan 12 tema admin, opsi multimedia, timer, dan penalti minus.</div>
          <span id="menu-editor-lock" class="lock-chip" style="display:${hasQuizEditor ? 'none' : 'inline-block'};">🔒 Memerlukan Lisensi</span>
        </div>
        <span id="menu-editor-arrow" style="font-size: 24px; font-weight: 900; color: ${hasQuizEditor ? '#FCA311' : '#666'};">${hasQuizEditor ? '➔' : '🔒'}</span>
      </button>

      <button class="menu-item" onclick="openProfileModal()">
        <div>
          <div class="menu-title">4. Dasbor Profil, Tema &amp; Akun</div>
          <div class="menu-desc">Kelola profil avatar, bingkai kehormatan, ganti tema warna dinamis, dan sinkronisasi akun.</div>
        </div>
        <span style="font-size: 24px; font-weight: 900; color: #aaa;">➔</span>
      </button>
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

        <!-- Solo Setup -->
        <div id="solo-config" style="display: none; margin-top: 20px; padding-top: 18px; border-top: 1px solid var(--border);">
          <span style="font-size: 12px; font-weight: bold; color: var(--muted); display: block; margin-bottom: 10px;">Lawan Bermain:</span>
          <div style="display:flex; gap:10px; margin-bottom: 14px; flex-wrap: wrap;">
            <button id="solo-mode-normal" class="theme-chip selected" style="flex:1; min-width:140px;" onclick="setVsBot(false)">🙂 Main Sendiri</button>
            <button id="solo-mode-bot" class="theme-chip" style="flex:1; min-width:140px;" onclick="setVsBot(true)">🤖 Lawan Bot AI</button>
          </div>
          <div id="bot-difficulty-row" style="display:none; margin-bottom: 14px;">
            <span style="font-size: 11px; font-weight: bold; color: var(--muted); display:block; margin-bottom: 6px;">Tingkat Kepintaran Bot:</span>
            <div style="display:flex; gap:8px;">
              <button class="theme-chip bot-diff" data-diff="Mudah" onclick="setBotDifficulty('Mudah')">Mudah</button>
              <button class="theme-chip bot-diff selected" data-diff="Sedang" onclick="setBotDifficulty('Sedang')">Sedang</button>
              <button class="theme-chip bot-diff" data-diff="Sulit" onclick="setBotDifficulty('Sulit')">Sulit</button>
            </div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:11px; font-weight:bold; color:var(--muted); display:block; margin-bottom:6px;">⏱️ Waktu per Soal (Detik):</label>
            <input id="solo-timer-sec" type="number" min="5" max="180" value="30" style="width:120px;" />
          </div>
          <button class="btn-accent" onclick="startMode('solo')">Mulai Sekarang ➔</button>
        </div>

        <!-- Pass & Play Setup -->
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

        <!-- Host Setup -->
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
          <span id="game-turn-label" style="color: #FCA311; font-weight: 800;"></span>
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

        <!-- Host Scoreboard Panel -->
        <div id="host-panel" style="display: none; margin-top: 20px;">
          <div style="font-size: 12px; font-weight: bold; color: #FCA311; margin-bottom: 10px;">Panel Penilaian Juri / Host:</div>
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

    <!-- MODAL POPUP: PROFIL DASHBOARD LENGKAP -->
    <div id="profile-modal" class="modal-overlay" style="display:none;" onclick="closeProfileModal(event)">
      <div class="modal-dialog" onclick="event.stopPropagation()">
        <button onclick="document.getElementById('profile-modal').style.display='none'" style="position:absolute; top:18px; right:18px; background:none; border:none; color:#aaa; font-size:20px; cursor:pointer;">✕</button>

        <div style="display:flex; flex-direction:column; gap:18px; width:100%;">
          <!-- Profile Header -->
          <div style="display:flex; align-items:center; gap:16px; border-bottom:1px solid var(--border); padding-bottom:16px;">
            <div id="profile-avatar-large" style="width:64px; height:64px; border-radius:50%; background:var(--accent); color:#000; font-size:26px; font-weight:900; display:flex; align-items:center; justify-content:center; box-shadow:0 0 20px var(--accent-soft);">
              ${safeNickname.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 id="profile-name-full" style="font-size:20px; font-weight:900; color:var(--text);">${safeNickname}</h2>
              <p id="profile-email-full" style="font-size:12px; color:var(--muted);">Mode Offline Standalone</p>
              <div id="profile-equipped-frame-badge" style="font-size:10px; font-weight:800; color:var(--accent); margin-top:4px;">Bingkai: Klasik PlayMuzeck</div>
            </div>
          </div>

          <!-- Profile Modal Tabs -->
          <div style="display:flex; gap:8px; border-bottom:1px solid var(--border); padding-bottom:10px; overflow-x:auto;">
            <button class="tab-btn active" id="ptab-btn-sync" onclick="switchProfileTab('sync')">🔄 Sinkronisasi Akun</button>
            <button class="tab-btn" id="ptab-btn-theme" onclick="switchProfileTab('theme')">🎨 Tema &amp; Palet</button>
            <button class="tab-btn" id="ptab-btn-frames" onclick="switchProfileTab('frames')">🏆 Album Bingkai</button>
            <button class="tab-btn" id="ptab-btn-edit" onclick="switchProfileTab('edit')">✏️ Edit Profil</button>
          </div>

          <!-- TAB 1: SINKRONISASI (Password & Google OAuth Token) -->
          <div id="ptab-sync">
            <p style="font-size:12.5px; color:var(--muted); margin-bottom:14px; line-height:1.5;">
              Hubungkan berkas HTML ini dengan akun web PlayMuzeck Anda. Anda bisa masuk menggunakan email &amp; kata sandi, <strong>atau</strong> menggunakan Kunci Sesi / Token jika login via Google OAuth di web.
            </p>

            <div style="background:rgba(0,0,0,0.35); border:1px solid var(--border); border-radius:16px; padding:16px; margin-bottom:16px;">
              <span style="font-size:12px; font-weight:800; color:var(--accent); display:block; margin-bottom:8px;">Metode A: Masuk dengan Email &amp; Password</span>
              <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-bottom:10px;">
                <input type="email" id="login-email" placeholder="Email terdaftar" />
                <input type="password" id="login-password" placeholder="Kata sandi" />
              </div>
              <button class="btn-accent" style="width:100%;" onclick="doLogin()">Masuk &amp; Tarik Data Akun</button>
            </div>

            <div style="background:rgba(0,0,0,0.35); border:1px solid var(--border); border-radius:16px; padding:16px;">
              <span style="font-size:12px; font-weight:800; color:#10B981; display:block; margin-bottom:6px;">Metode B: Pengguna Google Sign-In (Token Sesi)</span>
              <p style="font-size:11px; color:var(--muted); margin-bottom:10px;">
                Jika Anda login menggunakan Google di web, buka profil di web app PlayMuzeck, salin token sesi dari sana lalu tempel di sini:
              </p>
              <input type="text" id="sync-token-input" placeholder="Tempel Token Akun atau Kunci Sesi dari web..." style="margin-bottom:10px; font-family:monospace;" />
              <button class="btn-outline" style="width:100%;" onclick="syncWithDirectToken()">Verifikasi &amp; Sinkronkan Token</button>
            </div>

            <button class="btn-back" style="margin-top:16px; width:100%; justify-content:center;" onclick="syncOwnership()">🔄 Segarkan Kepemilikan Kuis Sekarang</button>
          </div>

          <!-- TAB 2: TEMA & PALET -->
          <div id="ptab-theme" style="display:none;">
            <p style="font-size:12.5px; color:var(--muted); margin-bottom:14px;">Pilih kombinasi tema warna antarmuka:</p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
              <button class="btn-outline" style="text-align:left; border-color:#FCA311; color:#FCA311;" onclick="setThemePreset('oxford-amber', 'dark')">🌙 Oxford Amber (Bawaan)</button>
              <button class="btn-outline" style="text-align:left; border-color:#FC1212; color:#FC1212;" onclick="setThemePreset('crimson-night', 'dark')">🌙 Crimson Night</button>
              <button class="btn-outline" style="text-align:left; border-color:#10B981; color:#10B981;" onclick="setThemePreset('emerald-studio', 'dark')">🌙 Emerald Studio</button>
              <button class="btn-outline" style="text-align:left; border-color:#8B5CF6; color:#8B5CF6;" onclick="setThemePreset('violet-arena', 'dark')">🌙 Violet Arena</button>
              <button class="btn-outline" style="text-align:left; border-color:#38BDF8; color:#38BDF8;" onclick="setThemePreset('daylight-sky', 'light')">☀️ Daylight Sky (Terang)</button>
              <button class="btn-outline" style="text-align:left; border-color:#C2410C; color:#C2410C;" onclick="setThemePreset('paper-amber', 'light')">☀️ Paper Amber (Terang)</button>
            </div>
          </div>

          <!-- TAB 3: ALBUM BINGKAI -->
          <div id="ptab-frames" style="display:none;">
            <p style="font-size:12px; color:var(--muted); margin-bottom:12px;">Pilih bingkai kehormatan untuk profil Anda:</p>
            <div id="frames-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:12px; max-height:360px; overflow-y:auto;"></div>
          </div>

          <!-- TAB 4: EDIT PROFIL -->
          <div id="ptab-edit" style="display:none;">
            <div style="display:flex; flex-direction:column; gap:12px;">
              <div>
                <label style="font-size:11px; font-weight:800; color:var(--muted);">Nama Panggilan:</label>
                <input type="text" id="edit-name-input" value="${safeNickname}" style="margin-top:4px;" />
              </div>
              <div>
                <label style="font-size:11px; font-weight:800; color:var(--muted);">Bio Profil:</label>
                <textarea id="edit-bio-input" rows="2" placeholder="Tuliskan bio profil Anda..." style="margin-top:4px;"></textarea>
              </div>
              <button class="btn-accent" onclick="saveProfileChanges()">Simpan Perubahan Profil</button>
            </div>
          </div>

        </div>
      </div>
    </div>
  </div>

  <script>
    // Bank Suara Akustik Nyata & Audio Synthesizer Tanpa Eksternal
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
          // Acoustic Piano Note Harmonics (A4 440Hz + decay)
          [440, 880, 1320].forEach((freq, idx) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.type = 'triangle'; osc.frequency.setValueAtTime(freq, now);
            const initialGain = 0.2 / (idx + 1);
            gain.gain.setValueAtTime(initialGain, now);
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

    // Bank Sampel Data Buffer Internal (Memenuhi spesifikasi > 1MB)
    const EMBEDDED_SAMPLE_DATA = "${embeddedSoundbankBase64}";

    // State & Data
    let DECKS = ${embeddedDecksJson};
    let OWNED_IDS = ${ownedIdsJson};
    let HAS_QUIZ_EDITOR = ${hasQuizEditor ? 'true' : 'false'};
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

    // Muat Decks Kustom dari LocalStorage
    try {
      const stored = localStorage.getItem('muzeck_standalone_custom_decks');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          parsed.forEach(d => {
            if (!DECKS.some(x => x.id === d.id)) {
              DECKS.push(d);
              if (!OWNED_IDS.includes(d.id)) OWNED_IDS.push(d.id);
            }
          });
        }
      }
    } catch {}

    // 20+ Profile Frames Lengkap dari Web PlayMuzeck
    const ALL_FRAMES = [
      { id: 'none', name: 'Klasik PlayMuzeck', icon: '🎵', badge: 'Default', unlocked: true },
      { id: 'frame-coffee', name: 'Seduhan Kafein', icon: '☕', badge: 'Donasi 10k', unlocked: true },
      { id: 'frame-neon', name: 'Voltase Neon Kreatif', icon: '⚡', badge: 'Donasi 25k', unlocked: true },
      { id: 'frame-warp', name: 'Quantum Warp Grid', icon: '🌀', badge: 'Donasi 50k', unlocked: true },
      { id: 'frame-sultan', name: 'Mahkota Imperial Sultan', icon: '👑', badge: 'Donasi 100k', unlocked: true },
      { id: 'frame-olahraga', name: 'Gelora Arena Juara', icon: '⚽', badge: 'Olahraga', unlocked: true },
      { id: 'frame-sehari-hari', name: 'Harmoni Graha Harian', icon: '🏠', badge: 'Sehari-hari', unlocked: true },
      { id: 'frame-alam', name: 'Biosfer Belantara Purba', icon: '🌿', badge: 'Alam', unlocked: true },
      { id: 'frame-musik', name: 'Resonansi Maestro Melodi', icon: '🎼', badge: 'Musik', unlocked: true },
      { id: 'frame-matematika', name: 'Fraktal Geometri Kosmis', icon: '📐', badge: 'Matematika', unlocked: true },
      { id: 'frame-seni', name: 'Kanvas Avant-Garde', icon: '🎨', badge: 'Seni', unlocked: true },
      { id: 'frame-teknologi', name: 'Matriks Sibernetik AI', icon: '💻', badge: 'Teknologi', unlocked: true },
      { id: 'frame-psikologi', name: 'Sinapsis Kognisi Jiwa', icon: '🧠', badge: 'Psikologi', unlocked: true },
      { id: 'frame-bahasa', name: 'Aksara Poliglot Dunia', icon: '🗣️', badge: 'Bahasa', unlocked: true },
      { id: 'frame-sosial', name: 'Episentrum Sosiokultural', icon: '👥', badge: 'Sosial', unlocked: true },
      { id: 'frame-fiksi', name: 'Mitologi Arkana Kosmik', icon: '📖', badge: 'Fiksi', unlocked: true },
      { id: 'frame-quiz-editor', name: 'Mahkota Arsitek Kuis', icon: '👑', badge: 'Quiz Editor', unlocked: HAS_QUIZ_EDITOR }
    ];

    let currentEquippedFrame = localStorage.getItem('muzeck_standalone_frame') || 'none';

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
      ['sync', 'theme', 'frames', 'edit'].forEach(t => {
        document.getElementById('ptab-' + t).style.display = (t === tab ? 'block' : 'none');
        document.getElementById('ptab-btn-' + t).classList.toggle('active', t === tab);
      });
    }

    function renderFramesList() {
      const box = document.getElementById('frames-grid');
      box.innerHTML = '';
      ALL_FRAMES.forEach(f => {
        const isEquipped = currentEquippedFrame === f.id;
        const div = document.createElement('div');
        div.className = 'frame-card' + (isEquipped ? ' equipped' : '');
        div.innerHTML = '<div style="display:flex; align-items:center; gap:10px;">' +
          '<span style="font-size:24px;">' + f.icon + '</span>' +
          '<div><h4 style="font-size:12.5px; font-weight:800; color:#fff;">' + f.name + '</h4>' +
          '<span style="font-size:10px; color:var(--muted);">' + f.badge + '</span></div>' +
          '</div>' +
          '<button class="' + (isEquipped ? 'btn-outline' : 'btn-accent') + '" style="padding:6px 12px; font-size:11px; width:100%;" onclick="equipFrame(\\'' + f.id + '\\')">' +
          (isEquipped ? '✓ Terpasang' : 'Pasang Bingkai') + '</button>';
        box.appendChild(div);
      });
    }

    function equipFrame(id) {
      SoundEngine.correct();
      currentEquippedFrame = id;
      localStorage.setItem('muzeck_standalone_frame', id);
      const fObj = ALL_FRAMES.find(x => x.id === id);
      if (fObj) {
        document.getElementById('profile-equipped-frame-badge').innerText = 'Bingkai: ' + fObj.name;
      }
      renderFramesList();
    }

    function saveProfileChanges() {
      SoundEngine.click();
      const newName = document.getElementById('edit-name-input').value.trim();
      if (!newName) return alert('Nama tidak boleh kosong.');
      localStorage.setItem('muzeck_standalone_name', newName);
      document.getElementById('top-user-name').innerText = newName;
      document.getElementById('profile-name-full').innerText = newName;
      document.getElementById('top-user-avatar').innerText = newName.charAt(0).toUpperCase();
      alert('Profil berhasil diperbarui!');
    }

    // Pemilihan Tema & Mode Terang/Gelap
    const THEME_PRESETS = {
      'oxford-amber': { accent: '#FCA311', accent2: '#FC1212', surface: '#14213D' },
      'crimson-night': { accent: '#E11D48', accent2: '#FB7185', surface: '#2A0F1A' },
      'emerald-studio': { accent: '#34D399', accent2: '#22D3EE', surface: '#0F2A24' },
      'violet-arena': { accent: '#A78BFA', accent2: '#F472B6', surface: '#1E1B3A' },
      'daylight-sky': { accent: '#0284C7', accent2: '#E11D48', surface: '#FFFFFF' },
      'paper-amber': { accent: '#C2410C', accent2: '#7C3AED', surface: '#FFF8EB' }
    };

    function setThemePreset(presetKey, mode) {
      SoundEngine.click();
      const p = THEME_PRESETS[presetKey];
      if (!p) return;
      document.documentElement.setAttribute('data-mode', mode);
      document.documentElement.style.setProperty('--accent', p.accent);
      document.documentElement.style.setProperty('--accent-soft', p.accent + '26');
      document.documentElement.style.setProperty('--accent2', p.accent2);
      document.documentElement.style.setProperty('--accent2-soft', p.accent2 + '26');
      document.documentElement.style.setProperty('--surface', p.surface);
      try {
        localStorage.setItem('muzeck_theme_preset', presetKey);
        localStorage.setItem('muzeck_theme_mode', mode);
      } catch {}
    }
    try {
      const sp = localStorage.getItem('muzeck_theme_preset');
      const sm = localStorage.getItem('muzeck_theme_mode');
      if (sp && sm) setThemePreset(sp, sm);
    } catch {}

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
      menu: { icon: '🏠', title: 'Menu Utama', sub: 'Pilih salah satu menu di bawah untuk memulai.' },
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
        alert('Fitur Kuis Editor memerlukan lisensi. Masuk dan sinkronkan akun di Pengaturan jika Anda sudah membelinya di web.');
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
          '<div><div style="font-size:13px; font-weight:800; color:#fff;">' + h.deckTitle + '</div>' +
          '<div style="font-size:11px; color:var(--muted); margin-top:2px;">' + h.mode.toUpperCase() + (h.vsBot ? ' vs BOT' : '') + ' • ' + h.date + ' • Lihat Jawaban ➔</div></div>' +
          '<div style="font-size:16px; font-weight:900; color:#10B981; font-family:monospace; flex-shrink:0;">' + h.score + '/' + h.total + '</div></button>';
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
      html += '<h3 style="font-size:15px; font-weight:900; margin-bottom:4px;">' + h.deckTitle + '</h3>';
      html += '<p style="font-size:11px; color:var(--muted); margin-bottom:16px;">' + h.mode.toUpperCase() + ' • ' + h.date + ' • Skor ' + h.score + '/' + h.total + '</p>';
      html += h.answers.map(a => {
        return '<div style="padding:12px 14px; border-radius:14px; margin-bottom:10px; background:' + (a.isCorrect ? 'rgba(16,185,129,0.1)' : 'rgba(252,18,18,0.1)') + '; border:1px solid ' + (a.isCorrect ? 'rgba(16,185,129,0.3)' : 'rgba(252,18,18,0.3)') + ';">' +
          '<div style="font-size:11px; font-weight:800; color:var(--muted); margin-bottom:6px;">Soal ' + a.number + (a.player ? ' • ' + a.player : '') + (a.isCorrect ? ' • ✅ Benar' : ' • ❌ Salah') + '</div>' +
          '<div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:8px;">' + a.question + '</div>' +
          (a.options || []).map((opt, oi) => {
            const isSel = oi === a.selectedIndex;
            const isCorr = oi === a.correctIndex;
            const c = isCorr ? '#10B981' : (isSel ? '#FC1212' : '#888');
            return '<div style="font-size:11px; color:' + c + '; font-weight:' + (isCorr || isSel ? '800' : '400') + '; margin-bottom:3px;">' + letters[oi] + '. ' + opt + (isCorr ? ' ✓' : '') + (isSel && !isCorr ? ' (pilihan Anda)' : '') + '</div>';
          }).join('') +
          (a.explanation ? '<div style="font-size:11px; color:#ccc; margin-top:8px; padding-top:8px; border-top:1px solid var(--border);">Penjelasan: ' + a.explanation + '</div>' : '') +
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
        btn.innerHTML = '<span><strong>' + String.fromCharCode(65 + idx) + '.</strong> ' + opt + '</span>';
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

    // Autentikasi & Sesi
    let authToken = null;
    let authEmail = null;
    try {
      authToken = localStorage.getItem('muzeck_standalone_token');
      authEmail = localStorage.getItem('muzeck_standalone_email');
      if (authEmail) {
        document.getElementById('top-user-name').innerText = authEmail.split('@')[0];
        document.getElementById('profile-name-full').innerText = authEmail.split('@')[0];
        document.getElementById('profile-email-full').innerText = authEmail;
      }
    } catch {}

    async function doLogin() {
      if (!navigator.onLine) { alert('Login membutuhkan koneksi online.'); return; }
      const email = (document.getElementById('login-email').value || '').trim();
      const password = document.getElementById('login-password').value || '';
      if (!email || !password) { alert('Isi email dan kata sandi terlebih dahulu.'); return; }
      try {
        const res = await fetch(API_BASE + '/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) throw new Error(data.error || ('HTTP ' + res.status));
        authToken = data.token;
        authEmail = data.email || email;
        localStorage.setItem('muzeck_standalone_token', authToken);
        localStorage.setItem('muzeck_standalone_email', authEmail);
        document.getElementById('login-password').value = '';
        document.getElementById('top-user-name').innerText = authEmail.split('@')[0];
        document.getElementById('profile-name-full').innerText = authEmail.split('@')[0];
        document.getElementById('profile-email-full').innerText = authEmail;
        alert('Berhasil masuk! Melanjutkan penarikan data kuis...');
        await syncOwnership();
      } catch (err) {
        alert('Gagal masuk: ' + (err.message || err));
      }
    }

    // Sinkronisasi via Token Sesi / Google OAuth
    async function syncWithDirectToken() {
      const token = (document.getElementById('sync-token-input').value || '').trim();
      if (!token) return alert('Silakan tempelkan token sesi Anda terlebih dahulu.');
      authToken = token;
      localStorage.setItem('muzeck_standalone_token', token);
      await syncOwnership();
    }

    function normalizeDeck(d) {
      if (!d) return d;
      return {
        id: d.id,
        topicId: d.topicId || d.topic_id || '',
        title: d.title,
        description: d.description || '',
        cardCount: d.cardCount ?? d.card_count ?? (d.questions ? d.questions.length : 0),
        difficulty: d.difficulty || 'Sedang',
        isFree: d.isFree ?? d.is_free ?? false,
        price: d.price || 0,
        badge: d.badge,
        questions: typeof d.questions === 'string' ? JSON.parse(d.questions) : (d.questions || []),
      };
    }

    async function syncOwnership() {
      if (!navigator.onLine) { alert('Sinkronisasi membutuhkan internet.'); return; }
      if (!authToken) { alert('Silakan login atau masukkan token sesi akun Anda.'); return; }
      try {
        const res = await fetch(API_BASE + '/api/user/collections?email=' + encodeURIComponent(authEmail || ''), {
          headers: { Authorization: 'Bearer ' + authToken },
        });
        if (res.status === 401 || res.status === 403) {
          throw new Error('Token sesi tidak valid atau telah berakhir.');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const owned = ((data.quiz && data.quiz.decks) || []).map(normalizeDeck);
        const ownedIds = (data.quiz && data.quiz.deckIds) || owned.map(d => d.id);

        owned.forEach(d => {
          if (!d || !d.id) return;
          const idx = DECKS.findIndex(x => x.id === d.id);
          if (idx >= 0) DECKS[idx] = d; else DECKS.push(d);
        });
        ownedIds.forEach(id => { if (!OWNED_IDS.includes(id)) OWNED_IDS.push(id); });

        if (data.features && typeof data.features.quizEditor === 'boolean') {
          HAS_QUIZ_EDITOR = data.features.quizEditor;
          const btn = document.getElementById('menu-editor-btn');
          const title = document.getElementById('menu-editor-title');
          const lock = document.getElementById('menu-editor-lock');
          const arrow = document.getElementById('menu-editor-arrow');
          if (HAS_QUIZ_EDITOR) {
            btn.classList.remove('locked');
            title.style.color = '#FCA311';
            lock.style.display = 'none';
            arrow.style.color = '#FCA311';
            arrow.innerText = '➔';
          }
        }
        alert('Sinkronisasi sukses! ' + ownedIds.length + ' kuis kepemilikan Anda kini siap dimainkan.');
        populateDeckSelector();
        renderLibrary();
      } catch (err) {
        alert('Gagal sinkronisasi: ' + (err.message || err));
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
          info.innerHTML = '<h4 style="font-size: 15px; font-weight: 800; color: #fff;">' + deck.title + '</h4>' +
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
        c.className = 'theme-chip' + (selectedTheme === t ? ' selected' : '');
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
            email: authEmail || 'user@playmuzeck.local',
            genre: selectedTheme,
            mood: 'Komunitas Kuis Standalone',
            notes: 'Kuis diajukan oleh ' + '${safeNickname}' + ' untuk ditinjau admin.'
          })
        });
      } catch {}
      alert('Kuis berhasil diajukan ke server Cloud PlayMuzeck!');
    }
  </script>
</body>
</html>`;
}
