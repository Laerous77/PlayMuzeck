// src/services/quizStandalone.ts
// Generator berkas HTML mandiri (PlayMuzeck_Quiz.html)
// Berkas mandiri ini dapat dibuka langsung di browser mana pun (luring/offline-first)
// dan memiliki sinkronisasi online penuh saat terhubung ke internet.

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

  return `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>PlayMuzeck - Pusat Kuis Mandiri</title>
  <link rel="icon" href="${logoSrc}" />
  <style>
    :root {
      --accent: #FC1212;
      --accent-soft: rgba(252, 18, 18, 0.18);
      --surface: #14213D;
      --deep: #0a1120;
      --page-bg: #000000;
      --text: #E9E9EE;
      --muted: #9aa1b5;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body {
      background: radial-gradient(circle at 15% 0%, #1a0a0f 0%, #060b17 50%, var(--page-bg) 100%);
      color: var(--text);
      min-height: 100vh;
      padding: 20px 16px 80px;
    }
    .container { max-width: 960px; margin: 0 auto; animation: fadeIn .25s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

    /* Top Bar */
    .top-bar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 20px; gap: 12px; flex-wrap: wrap; }
    .logo-box { display: flex; align-items: center; gap: 12px; cursor: pointer; text-decoration: none; user-select: none; }
    .logo-img { width: 42px; height: 42px; border-radius: 12px; object-fit: contain; background: rgba(20,33,61,0.8); border: 1px solid rgba(255,255,255,0.15); padding: 4px; }
    .logo-title { font-size: 20px; font-weight: 900; letter-spacing: -0.4px; line-height: 1.1; color: #fff; }
    .dim-mu { opacity: 0.35; }
    .dim-z { opacity: 0.65; }
    .bright-eck { color: var(--accent); }
    .badge { font-size: 11px; font-weight: 800; padding: 4px 12px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; }
    .badge-online { background: rgba(16,185,129,0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.35); }
    .badge-offline { background: rgba(252,18,18,0.15); color: var(--accent); border: 1px solid rgba(252,18,18,0.35); }

    /* Hero Banner */
    .hero-banner {
      position: relative; overflow: hidden; border-radius: 24px;
      background: linear-gradient(135deg, color-mix(in srgb, var(--accent) 22%, var(--surface)), var(--deep) 70%);
      border: 2px solid color-mix(in srgb, var(--accent) 35%, transparent);
      padding: 22px 24px; box-shadow: 0 14px 40px rgba(0,0,0,0.4);
      display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px;
    }
    .hero-icon { width: 48px; height: 48px; border-radius: 16px; background: var(--accent-soft); border: 1px solid var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; }
    .hero-title { font-size: 22px; font-weight: 900; color: #fff; letter-spacing: -0.4px; }
    .hero-sub { font-size: 12px; color: var(--muted); margin-top: 3px; max-width: 50ch; }

    /* Menu Cards */
    .menu-item {
      position: relative; width: 100%; display: flex; align-items: center; justify-content: space-between;
      padding: 18px 22px; border-radius: 20px; background: linear-gradient(145deg, #16223d, #0d1526);
      border: 1px solid rgba(255,255,255,0.08); color: #fff; margin-bottom: 12px; cursor: pointer; text-align: left; transition: all 0.15s;
    }
    .menu-item:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 10px 28px rgba(0,0,0,0.5); }
    .menu-item.locked { opacity: 0.6; cursor: not-allowed; }
    .menu-item.locked:hover { border-color: rgba(255,255,255,0.08); transform: none; box-shadow: none; }
    .menu-title { font-size: 17px; font-weight: 900; }
    .menu-desc { font-size: 12px; color: var(--muted); margin-top: 4px; max-width: 58ch; }
    .lock-chip { font-size: 10px; font-weight: 800; padding: 3px 10px; border-radius: 9999px; background: rgba(252,163,17,0.15); color: #FCA311; border: 1px solid rgba(252,163,17,0.35); display: inline-block; margin-top: 5px; }

    /* General Components */
    .btn-back { background: rgba(255,255,255,0.08); color: #ddd; border: none; border-radius: 12px; padding: 9px 16px; font-size: 12px; font-weight: 800; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; transition: background .15s; margin-bottom: 16px; }
    .btn-back:hover { background: rgba(255,255,255,0.18); }
    .card { background: linear-gradient(160deg, #152038, #0b1322); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 24px; margin-bottom: 20px; box-shadow: 0 14px 34px rgba(0,0,0,0.55); }
    .btn-accent { background: var(--accent); color: #fff; border: none; border-radius: 14px; padding: 13px 20px; font-weight: 900; font-size: 13px; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-accent:hover { filter: brightness(1.1); transform: translateY(-1px); }
    .btn-accent:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
    .btn-outline { background: rgba(0,0,0,0.45); border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent); color: #fff; border-radius: 14px; padding: 13px 18px; font-weight: 800; font-size: 13px; cursor: pointer; transition: all 0.15s; display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-outline:hover { background: var(--accent-soft); border-color: var(--accent); }
    .btn-outline:disabled { opacity: 0.4; cursor: not-allowed; }

    .opt-btn { width: 100%; text-align: left; padding: 14px 18px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.09); color: #fff; margin-bottom: 10px; cursor: pointer; font-size: 13px; transition: all .12s; display: flex; align-items: center; gap: 10px; }
    .opt-btn:hover:not(:disabled) { border-color: var(--accent); background: var(--accent-soft); }
    .opt-btn.correct { background: rgba(16,185,129,0.22); border-color: #10B981; font-weight: bold; }
    .opt-btn.wrong { background: rgba(252,18,18,0.25); border-color: var(--accent); }

    .timer-wrap { height: 7px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-bottom: 16px; }
    .timer-bar { height: 100%; width: 100%; background: linear-gradient(90deg, #10B981, var(--accent)); transition: width 1s linear; }

    .score-pill { padding: 6px 12px; border-radius: 10px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); font-size: 11px; font-weight: 800; color: #aaa; }
    .score-pill.active { border-color: var(--accent); color: #fff; background: var(--accent-soft); }

    .team-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 14px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 10px; gap: 10px; }
    .stepper-btn { width: 30px; height: 30px; border-radius: 9px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #fff; font-weight: 900; cursor: pointer; }
    .stepper-btn:hover { background: rgba(255,255,255,0.18); }

    .theme-chip { padding: 10px 14px; border-radius: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 12px; font-weight: bold; text-align: center; color: #ccc; }
    .theme-chip.selected { background: var(--accent-soft); border-color: var(--accent); color: #fff; font-weight: 900; }
    .tab-row { display: flex; gap: 8px; margin-bottom: 18px; flex-wrap: wrap; }
    .tab-btn { padding: 9px 16px; border-radius: 12px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.1); color: #aaa; font-size: 12px; font-weight: 800; cursor: pointer; }
    .tab-btn.active { background: var(--accent-soft); border-color: var(--accent); color: #fff; }

    input[type="text"], input[type="number"], input[type="password"], input[type="email"], textarea, select {
      width: 100%; padding: 11px 14px; border-radius: 12px; background: rgba(0,0,0,0.6);
      border: 1px solid rgba(255,255,255,0.12); color: #fff; font-size: 12.5px; outline: none; transition: border-color .15s;
    }
    input:focus, textarea:focus, select:focus { border-color: var(--accent); }

    /* Custom Scrollbar */
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
          <span style="font-size: 10px; font-family: monospace; color: #888;">PUSAT KUIS STANDALONE</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <span id="net-badge" class="badge badge-online">● ONLINE</span>
        <span id="user-display-name" style="color: var(--accent); font-size: 12px; font-weight: 900;">${safeNickname}</span>
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
          <div class="menu-title" style="color: var(--accent);">1. Mainkan Kuis</div>
          <div class="menu-desc">4 Mode: Langsung Main (Solo &amp; Bot), Pass &amp; Play, Host / Kuis Master, dan Multiplayer Online.</div>
        </div>
        <span style="color: var(--accent); font-size: 22px; font-weight: 900;">➔</span>
      </button>

      <button class="menu-item" onclick="showScreen('library')">
        <div>
          <div class="menu-title">2. Perpustakaan Kuis</div>
          <div class="menu-desc">Koleksi lokal luring (3 starter, kuis terbeli &amp; buatan sendiri) + unduh kuis online dari server.</div>
        </div>
        <span style="font-size: 22px; font-weight: 900; color: #aaa;">➔</span>
      </button>

      <button class="menu-item ${hasQuizEditor ? '' : 'locked'}" id="menu-editor-btn" onclick="openEditorScreen()">
        <div>
          <div class="menu-title" id="menu-editor-title" style="color: ${hasQuizEditor ? '#FCA311' : '#888'};">3. Kuis Editor</div>
          <div class="menu-desc">Susun bank kuis mandiri dengan 12 tema admin, bobot skor, timer, dan penalti minus.</div>
          <span id="menu-editor-lock" class="lock-chip" style="display:${hasQuizEditor ? 'none' : 'inline-block'};">🔒 Memerlukan Lisensi</span>
        </div>
        <span id="menu-editor-arrow" style="font-size: 22px; font-weight: 900; color: ${hasQuizEditor ? '#FCA311' : '#666'};">${hasQuizEditor ? '➔' : '🔒'}</span>
      </button>

      <button class="menu-item" onclick="showScreen('settings')">
        <div>
          <div class="menu-title">4. Pengaturan &amp; Akun</div>
          <div class="menu-desc">Sinkronisasi data akun PlayMuzeck, tema palet warna, dukungan donasi, dan bantuan.</div>
        </div>
        <span style="font-size: 22px; font-weight: 900; color: #aaa;">➔</span>
      </button>
    </div>

    <!-- 2. SCREEN: KONFIGURASI MAIN (4 MODE) -->
    <div id="scr-play_select" style="display: none;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <button class="btn-back" style="margin-bottom:0;" onclick="showScreen('menu')">← Kembali ke Menu</button>
        <button class="btn-back" style="margin-bottom:0;" onclick="showScreen('history')">🕘 Riwayat Skor</button>
      </div>

      <div class="card">
        <h2 style="font-size: 19px; font-weight: 900; margin-bottom: 6px;">Pilih Paket Kuis</h2>
        <p style="font-size: 12px; color: var(--muted); margin-bottom: 14px;">Pilih kuis dari memori lokal Anda:</p>
        <select id="deck-select" onchange="onDeckSelectChange()" style="margin-bottom: 18px; font-weight: bold;"></select>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 22px;">
          <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 14px;">
            <label style="font-size: 11px; font-weight: bold; color: #aaa;">📋 Jumlah Soal:</label>
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
              <button class="btn-back" style="margin:0; padding:6px 12px;" onclick="adjustQuestionCount(-1)">−</button>
              <input id="q-count" type="number" min="1" value="1" oninput="clampQuestionCount()" style="text-align:center; font-family: monospace; font-weight:bold;" />
              <button class="btn-back" style="margin:0; padding:6px 12px;" onclick="adjustQuestionCount(1)">+</button>
            </div>
            <span id="q-count-max" style="font-size:10px; color:#777; display:block; margin-top:6px;"></span>
          </div>

          <button type="button" id="shuffle-toggle" onclick="toggleShuffle()" style="text-align:left; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 14px; cursor:pointer; color:#fff;">
            <label style="font-size: 11px; font-weight: bold; color: #aaa; cursor:pointer;">🔀 Pengacakan Soal:</label>
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
        <div id="solo-config" style="display: none; margin-top: 20px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.08);">
          <span style="font-size: 12px; font-weight: bold; color: #bbb; display: block; margin-bottom: 10px;">Lawan Bermain:</span>
          <div style="display:flex; gap:10px; margin-bottom: 14px; flex-wrap: wrap;">
            <button id="solo-mode-normal" class="theme-chip selected" style="flex:1; min-width:140px;" onclick="setVsBot(false)">🙂 Main Sendiri</button>
            <button id="solo-mode-bot" class="theme-chip" style="flex:1; min-width:140px;" onclick="setVsBot(true)">🤖 Lawan Bot AI</button>
          </div>
          <div id="bot-difficulty-row" style="display:none; margin-bottom: 14px;">
            <span style="font-size: 11px; font-weight: bold; color: #aaa; display:block; margin-bottom: 6px;">Tingkat Kepintaran Bot:</span>
            <div style="display:flex; gap:8px;">
              <button class="theme-chip bot-diff" data-diff="Mudah" onclick="setBotDifficulty('Mudah')">Mudah</button>
              <button class="theme-chip bot-diff selected" data-diff="Sedang" onclick="setBotDifficulty('Sedang')">Sedang</button>
              <button class="theme-chip bot-diff" data-diff="Sulit" onclick="setBotDifficulty('Sulit')">Sulit</button>
            </div>
          </div>
          <div style="margin-bottom:14px;">
            <label style="font-size:11px; font-weight:bold; color:#aaa; display:block; margin-bottom:6px;">⏱️ Waktu per Soal (Detik):</label>
            <input id="solo-timer-sec" type="number" min="5" max="180" value="30" style="width:120px;" />
          </div>
          <button class="btn-accent" onclick="startMode('solo')">Mulai Sekarang ➔</button>
        </div>

        <!-- Pass & Play Setup -->
        <div id="pass-play-config" style="display: none; margin-top: 20px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.08);">
          <span style="font-size: 12px; font-weight: bold; color: #bbb; display: block; margin-bottom: 8px;">Jumlah Pemain Bergilir (2–6 pemain dalam 1 perangkat):</span>
          <div style="display: flex; align-items:center; gap: 10px; margin-bottom: 16px;">
            <button class="btn-back" style="margin:0;" onclick="adjustPlayers(-1)">−</button>
            <span id="players-count" style="font-size:18px; font-weight:900; font-family:monospace; width:34px; text-align:center;">2</span>
            <button class="btn-back" style="margin:0;" onclick="adjustPlayers(1)">+</button>
            <span style="font-size:11px; color:#888;">Pemain</span>
          </div>
          <button class="btn-accent" onclick="startMode('pass_play')">Mulai Sesi Pass &amp; Play ➔</button>
        </div>

        <!-- Host Setup -->
        <div id="host-config" style="display: none; margin-top: 20px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.08);">
          <span style="font-size: 12px; font-weight: bold; color: #bbb; display: block; margin-bottom: 8px;">Jumlah Regu (1–10 regu). Host bertindak sebagai pembaca soal &amp; juri skor:</span>
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
          <span id="game-mode-label" style="font-weight: 900; color: var(--accent);">MODE SOLO</span>
          <span id="game-turn-label" style="color: #FCA311; font-weight: 800;"></span>
          <span id="game-progress" style="font-family: monospace; font-weight: 800; color: #fff;">1 / 10</span>
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
        <div id="game-explanation" style="display: none; padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1); margin-top: 16px; font-size: 12px; color: #ddd; line-height: 1.5;"></div>

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
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline" style="padding: 8px 14px; font-size: 11px;" onclick="loadOnlineCatalog(event)">
              🔄 Telusuri Kuis Online PlayMuzeck
            </button>
          </div>
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
        <p style="font-size: 12px; color: var(--muted); margin-bottom: 18px;">Susun kuis kustom Anda. Kuis tersimpan langsung di memori lokal dan bisa dimainkan luring.</p>

        <span style="font-size: 12px; font-weight: bold; color: var(--accent); display: block; margin-bottom: 8px;">1. Pilih Tema:</span>
        <div id="theme-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 18px;"></div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="font-size: 11px; font-weight: bold; color: #aaa;">Nama Topik:</label>
            <input type="text" id="ed-topic" placeholder="Misal: Biologi Sel & DNA" style="margin-top: 4px;" />
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold; color: #aaa;">Judul Kuis:</label>
            <input type="text" id="ed-title" placeholder="Misal: Struktur Sel Eukariotik" style="margin-top: 4px;" />
          </div>
        </div>

        <div style="margin-bottom: 16px;">
          <label style="font-size: 11px; font-weight: bold; color: #aaa;">Teks Pertanyaan Soal:</label>
          <textarea id="ed-question" rows="2" placeholder="Tuliskan pertanyaan Anda..." style="margin-top: 4px;"></textarea>
        </div>

        <span style="font-size: 11px; font-weight: bold; color: #aaa; display:block; margin-bottom: 6px;">Pilihan Jawaban (Opsi A adalah kunci benar):</span>
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

    <!-- 7. SCREEN: PENGATURAN & AKUN -->
    <div id="scr-settings" style="display: none;">
      <button class="btn-back" onclick="showScreen('menu')">← Kembali ke Menu</button>
      <div class="card">
        <h2 style="font-size: 19px; font-weight: 900; margin-bottom: 16px;">Pengaturan &amp; Akun</h2>
        <div class="tab-row">
          <button class="tab-btn active" id="set-tab-profil" onclick="showSettingsTab('profil')">👤 Akun &amp; Sinkronisasi</button>
          <button class="tab-btn" id="set-tab-tema" onclick="showSettingsTab('tema')">🎨 Palet Warna</button>
          <button class="tab-btn" id="set-tab-donasi" onclick="showSettingsTab('donasi')">❤️ Donasi</button>
          <button class="tab-btn" id="set-tab-kontak" onclick="showSettingsTab('kontak')">💬 Hubungi Kami</button>
        </div>

        <!-- Tab Profil -->
        <div id="set-panel-profil">
          <p style="font-size: 13px; color: #bbb; margin-bottom: 6px;">Pemain: <strong id="profil-name-label" style="color: #fff;">${safeNickname}</strong></p>
          <p style="font-size: 13px; color: #bbb; margin-bottom: 6px;">Status Kuis Editor: <strong id="profil-editor-status" style="color:${hasQuizEditor ? '#10B981' : '#FC1212'};">${hasQuizEditor ? 'Lisensi Aktif ✓' : 'Belum Memiliki Lisensi'}</strong></p>
          <p style="font-size: 13px; color: #bbb; margin-bottom: 16px;">Alamat Server Web: <strong>${apiBaseUrl}</strong></p>

          <div id="login-box" style="background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px; margin-bottom: 16px;">
            <p id="login-status" style="font-size: 12px; color: #bbb; margin-bottom: 10px;">Masuk dengan akun PlayMuzeck Anda untuk menyinkronkan kuis yang sudah dibeli dan lisensi Editor.</p>
            <div id="login-form" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin-bottom: 10px;">
              <input type="email" id="login-email" placeholder="Email akun PlayMuzeck" />
              <input type="password" id="login-password" placeholder="Kata sandi" />
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn-accent" onclick="doLogin()" id="login-btn">🔑 Masuk &amp; Sinkronkan</button>
              <button class="btn-back" id="logout-btn" style="display:none; margin:0;" onclick="doLogout()">Keluar Akun</button>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn-outline" onclick="syncOwnership()">🔄 Sinkronkan Kepemilikan Kuis</button>
            <button class="btn-back" style="margin:0;" onclick="clearLocalMemory()">Bersihkan Memori Lokal</button>
          </div>
        </div>

        <!-- Tab Tema -->
        <div id="set-panel-tema" style="display: none;">
          <p style="font-size: 12px; color: #aaa; margin-bottom: 14px;">Pilih warna aksen tampilan aplikasi kuis mandiri ini:</p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button class="btn-accent" onclick="applyAccent('#FC1212')">Oxford Crimson (Bawaan)</button>
            <button class="btn-outline" onclick="applyAccent('#FCA311')">Amber Gold</button>
            <button class="btn-outline" onclick="applyAccent('#10B981')">Emerald Green</button>
            <button class="btn-outline" onclick="applyAccent('#8B5CF6')">Violet Night</button>
            <button class="btn-outline" onclick="applyAccent('#3B82F6')">Electric Blue</button>
          </div>
        </div>

        <!-- Tab Donasi -->
        <div id="set-panel-donasi" style="display: none;">
          <p style="font-size: 12.5px; color: #bbb; margin-bottom: 14px; line-height: 1.5;">Dukung operasional server dan pengembangan bank soal PlayMuzeck lewat portal resmi web app:</p>
          <button class="btn-accent" onclick="openWebApp('/donate')">Buka Halaman Donasi di Web PlayMuzeck ➔</button>
        </div>

        <!-- Tab Kontak -->
        <div id="set-panel-kontak" style="display: none;">
          <p style="font-size: 12.5px; color: #bbb; margin-bottom: 14px; line-height: 1.5;">Ada pertanyaan atau usulan topik kuis baru?</p>
          <button class="btn-outline" onclick="openWebApp('/contact')">Kirim Masukan via Web App ➔</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    // Audio Synthesizer Tanpa Berkas Eksternal (Web Audio API)
    const AudioSynthesizer = {
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
        try {
          const ctx = this.getCtx(); if (!ctx) return;
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = 'sine'; osc.frequency.setValueAtTime(800, ctx.currentTime);
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(); osc.stop(ctx.currentTime + 0.05);
        } catch {}
      },
      correct() {
        try {
          const ctx = this.getCtx(); if (!ctx) return;
          [523.25, 659.25].forEach((f, i) => {
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.frequency.setValueAtTime(f, ctx.currentTime + i * 0.08);
            gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.08);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.08 + 0.2);
            osc.connect(gain); gain.connect(ctx.destination);
            osc.start(ctx.currentTime + i * 0.08); osc.stop(ctx.currentTime + i * 0.08 + 0.22);
          });
        } catch {}
      },
      wrong() {
        try {
          const ctx = this.getCtx(); if (!ctx) return;
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = 'sawtooth'; osc.frequency.setValueAtTime(220, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.18);
          gain.gain.setValueAtTime(0.25, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
          osc.connect(gain); gain.connect(ctx.destination);
          osc.start(); osc.stop(ctx.currentTime + 0.22);
        } catch {}
      }
    };

    // State Aplikasi
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

    function openWebApp(path) {
      if (!navigator.onLine) {
        alert('Fitur ini memerlukan koneksi internet aktif.');
        return;
      }
      window.open(WEB_APP_URL + (path || ''), '_blank');
    }

    // Aksen Tema Warna
    let currentAccent = '#FC1212';
    function applyAccent(hex) {
      currentAccent = hex;
      document.documentElement.style.setProperty('--accent', hex);
      document.documentElement.style.setProperty('--accent-soft', hex + '2e');
      try { localStorage.setItem('muzeck_standalone_accent', hex); } catch {}
    }
    try {
      const saved = localStorage.getItem('muzeck_standalone_accent');
      if (saved) applyAccent(saved);
    } catch {}

    function showSettingsTab(tab) {
      ['profil', 'tema', 'donasi', 'kontak'].forEach(t => {
        document.getElementById('set-panel-' + t).style.display = (t === tab ? 'block' : 'none');
        document.getElementById('set-tab-' + t).classList.toggle('active', t === tab);
      });
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
      settings: { icon: '⚙️', title: 'Pengaturan & Akun', sub: 'Sinkronisasi kepemilikan kuis, tema warna, dan dukungan.' },
    };

    function showScreen(id) {
      AudioSynthesizer.click();
      ['menu', 'play_select', 'game', 'history', 'library', 'editor', 'settings'].forEach(s => {
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
      AudioSynthesizer.click();
      shuffleOn = !shuffleOn;
      const label = document.getElementById('shuffle-state');
      const box = document.getElementById('shuffle-toggle');
      label.innerText = shuffleOn ? 'Aktif' : 'Nonaktif';
      label.style.color = shuffleOn ? currentAccent : '#888';
      box.style.borderColor = shuffleOn ? currentAccent : 'rgba(255,255,255,0.08)';
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
        box.innerHTML = '<p style="font-size:12px; color:#666; text-align:center; padding: 20px 0;">Belum ada riwayat hasil kuis di perangkat ini.</p>';
        return;
      }
      box.innerHTML = list.map((h, i) => {
        return '<button type="button" onclick="openHistoryDetail(' + i + ')" style="width:100%; text-align:left; cursor:pointer; padding:14px 16px; border-radius:16px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; color:#fff;">' +
          '<div><div style="font-size:13px; font-weight:800; color:#fff;">' + h.deckTitle + '</div>' +
          '<div style="font-size:11px; color:#888; margin-top:2px;">' + h.mode.toUpperCase() + (h.vsBot ? ' vs BOT' : '') + ' • ' + h.date + ' • Lihat Jawaban ➔</div></div>' +
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
      html += '<p style="font-size:11px; color:#888; margin-bottom:16px;">' + h.mode.toUpperCase() + ' • ' + h.date + ' • Skor ' + h.score + '/' + h.total + '</p>';
      html += h.answers.map(a => {
        return '<div style="padding:12px 14px; border-radius:14px; margin-bottom:10px; background:' + (a.isCorrect ? 'rgba(16,185,129,0.1)' : 'rgba(252,18,18,0.1)') + '; border:1px solid ' + (a.isCorrect ? 'rgba(16,185,129,0.3)' : 'rgba(252,18,18,0.3)') + ';">' +
          '<div style="font-size:11px; font-weight:800; color:#aaa; margin-bottom:6px;">Soal ' + a.number + (a.player ? ' • ' + a.player : '') + (a.isCorrect ? ' • ✅ Benar' : ' • ❌ Salah') + '</div>' +
          '<div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:8px;">' + a.question + '</div>' +
          (a.options || []).map((opt, oi) => {
            const isSel = oi === a.selectedIndex;
            const isCorr = oi === a.correctIndex;
            const c = isCorr ? '#10B981' : (isSel ? '#FC1212' : '#888');
            return '<div style="font-size:11px; color:' + c + '; font-weight:' + (isCorr || isSel ? '800' : '400') + '; margin-bottom:3px;">' + letters[oi] + '. ' + opt + (isCorr ? ' ✓' : '') + (isSel && !isCorr ? ' (pilihan Anda)' : '') + '</div>';
          }).join('') +
          (a.explanation ? '<div style="font-size:11px; color:#ccc; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">Penjelasan: ' + a.explanation + '</div>' : '') +
          '</div>';
      }).join('');
      box.innerHTML = html;
    }

    function clearHistory() {
      if (!confirm('Hapus seluruh riwayat hasil kuis di perangkat ini?')) return;
      localStorage.removeItem('muzeck_standalone_history');
      renderHistory();
    }

    function clearLocalMemory() {
      if (!confirm('Bersihkan seluruh memori lokal (kuis kustom, tema, dan token akun)?')) return;
      localStorage.removeItem('muzeck_standalone_custom_decks');
      localStorage.removeItem('muzeck_standalone_history');
      localStorage.removeItem('muzeck_standalone_accent');
      localStorage.removeItem('muzeck_standalone_token');
      localStorage.removeItem('muzeck_standalone_email');
      alert('Memori lokal dibersihkan.');
      location.reload();
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
      AudioSynthesizer.click();
      vsBotEnabled = on;
      document.getElementById('solo-mode-normal').classList.toggle('selected', !on);
      document.getElementById('solo-mode-bot').classList.toggle('selected', on);
      document.getElementById('bot-difficulty-row').style.display = on ? 'block' : 'none';
    }

    function setBotDifficulty(d) {
      AudioSynthesizer.click();
      botDifficulty = d;
      document.querySelectorAll('.bot-diff').forEach(el => {
        el.classList.toggle('selected', el.getAttribute('data-diff') === d);
      });
    }

    let numPlayersPP = 2;
    function adjustPlayers(delta) {
      AudioSynthesizer.click();
      numPlayersPP = Math.min(6, Math.max(2, numPlayersPP + delta));
      document.getElementById('players-count').innerText = numPlayersPP;
    }

    let teamCountHost = 2;
    function adjustTeams(delta) {
      AudioSynthesizer.click();
      teamCountHost = Math.min(10, Math.max(1, teamCountHost + delta));
      document.getElementById('teams-count').innerText = teamCountHost;
    }

    let ppScores = [];
    let ppActive = 0;
    let teamScores = [];
    let pointStep = 10;

    // Multiplayer Online: Menghubungkan langsung ke web app PlayMuzeck
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
      AudioSynthesizer.click();
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
      bar.style.background = 'linear-gradient(90deg, #10B981, var(--accent))';
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
      box.innerHTML = '<div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;"><span style="font-size:11px; color:#aaa; font-weight:700;">Nilai per klik:</span>' +
        '<button class="stepper-btn" onclick="adjustPointStep(-5)">−</button><span style="font-family:monospace; font-weight:900; width:34px; text-align:center; display:inline-block;">' + pointStep + '</span><button class="stepper-btn" onclick="adjustPointStep(5)">+</button></div>' +
        teamScores.map((s, i) => {
          return '<div class="team-row"><span style="font-weight:800; font-size:13px;">Regu ' + String.fromCharCode(65 + i) + '</span>' +
            '<div style="display:flex; align-items:center; gap:10px;"><button class="stepper-btn" onclick="adjustTeamScore(' + i + ', -1)">−</button>' +
            '<span style="font-family:monospace; font-weight:900; font-size:15px; width:40px; text-align:center;">' + s + '</span>' +
            '<button class="stepper-btn" onclick="adjustTeamScore(' + i + ', 1)">+</button></div></div>';
        }).join('');
    }

    function adjustPointStep(d) {
      AudioSynthesizer.click();
      pointStep = Math.max(5, Math.min(1000, pointStep + d));
      renderTeamScoreList();
    }

    function adjustTeamScore(i, dir) {
      AudioSynthesizer.click();
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
        AudioSynthesizer.correct();
        if (currentGameMode === 'pass_play') { ppScores[ppActive]++; }
        else { score++; }
      } else {
        AudioSynthesizer.wrong();
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
      AudioSynthesizer.click();
      if (currentGameMode === 'pass_play') {
        ppActive = (ppActive + 1) % ppScores.length;
        if (ppActive === 0) qIdx++;
      } else {
        qIdx++;
      }
      loadQuestion();
    }

    function toggleHostKey() {
      AudioSynthesizer.click();
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

    // Katalog Online PlayMuzeck
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
      if (authToken && authEmail) updateLoginUi();
    } catch {}

    function updateLoginUi() {
      const statusEl = document.getElementById('login-status');
      const btn = document.getElementById('login-btn');
      const logoutBtn = document.getElementById('logout-btn');
      const emailInput = document.getElementById('login-email');
      const passInput = document.getElementById('login-password');
      if (authToken && authEmail) {
        statusEl.innerHTML = 'Masuk sebagai <strong style="color:#10B981;">' + authEmail + '</strong>.';
        btn.style.display = 'none';
        logoutBtn.style.display = 'inline-flex';
        if (emailInput) emailInput.style.display = 'none';
        if (passInput) passInput.style.display = 'none';
      } else {
        statusEl.innerText = 'Masuk dengan akun PlayMuzeck Anda untuk menyinkronkan kuis yang sudah dibeli dan lisensi Editor.';
        btn.style.display = 'inline-flex';
        logoutBtn.style.display = 'none';
        if (emailInput) emailInput.style.display = 'block';
        if (passInput) passInput.style.display = 'block';
      }
    }

    async function doLogin() {
      if (!navigator.onLine) { alert('Login membutuhkan koneksi online.'); return; }
      const email = (document.getElementById('login-email').value || '').trim();
      const password = document.getElementById('login-password').value || '';
      if (!email || !password) { alert('Isi email dan kata sandi terlebih dahulu.'); return; }
      const btn = document.getElementById('login-btn');
      const original = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '⏳ Menghubungkan...';
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
        try {
          localStorage.setItem('muzeck_standalone_token', authToken);
          localStorage.setItem('muzeck_standalone_email', authEmail);
        } catch {}
        document.getElementById('login-password').value = '';
        updateLoginUi();
        await syncOwnership();
      } catch (err) {
        alert('Gagal masuk: ' + (err.message || err));
      } finally {
        btn.disabled = false; btn.innerHTML = original;
      }
    }

    function doLogout() {
      authToken = null; authEmail = null;
      try {
        localStorage.removeItem('muzeck_standalone_token');
        localStorage.removeItem('muzeck_standalone_email');
      } catch {}
      updateLoginUi();
      alert('Berhasil keluar akun.');
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
      if (!authToken) { alert('Silakan login akun PlayMuzeck Anda terlebih dahulu.'); return; }
      try {
        const res = await fetch(API_BASE + '/api/user/collections?email=' + encodeURIComponent(authEmail || ''), {
          headers: { Authorization: 'Bearer ' + authToken },
        });
        if (res.status === 401 || res.status === 403) {
          doLogout();
          throw new Error('Sesi login telah berakhir, silakan masuk ulang.');
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
          const status = document.getElementById('profil-editor-status');
          if (HAS_QUIZ_EDITOR) {
            btn.classList.remove('locked');
            title.style.color = '#FCA311';
            lock.style.display = 'none';
            arrow.style.color = '#FCA311';
            arrow.innerText = '➔';
          }
          if (status) {
            status.innerText = HAS_QUIZ_EDITOR ? 'Lisensi Aktif ✓' : 'Belum Memiliki Lisensi';
            status.style.color = HAS_QUIZ_EDITOR ? '#10B981' : '#FC1212';
          }
        }
        alert('Sinkronisasi berhasil! ' + ownedIds.length + ' kuis kepemilikan Anda kini siap dimainkan.');
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

    // Unduh Kuis Online ke Memori Lokal HTML
    function downloadDeckToLocal(deck) {
      AudioSynthesizer.correct();
      if (!DECKS.some(d => d.id === deck.id)) {
        DECKS.push(deck);
      }
      if (!OWNED_IDS.includes(deck.id)) {
        OWNED_IDS.push(deck.id);
      }
      try {
        const stored = JSON.parse(localStorage.getItem('muzeck_standalone_custom_decks') || '[]');
        stored.push(deck);
        localStorage.setItem('muzeck_standalone_custom_decks', JSON.stringify(stored));
      } catch {}
      alert('Kuis "' + deck.title + '" berhasil diunduh dan tersimpan ke memori luring.');
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
          div.style = 'padding: 16px; border-radius: 16px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px;';

          const info = document.createElement('div');
          info.innerHTML = '<h4 style="font-size: 15px; font-weight: 800; color: #fff;">' + deck.title + '</h4>' +
            '<p style="font-size: 11px; color: #888; margin-top: 4px;">' +
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
        list.innerHTML = '<p style="font-size:12px; color:#666; text-align:center; padding: 20px 0;">Tidak ada kuis yang sesuai pencarian.</p>';
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
          AudioSynthesizer.click();
          selectedTheme = t;
          renderThemes();
        };
        box.appendChild(c);
      });
    }

    function saveCustomDeckLocal() {
      AudioSynthesizer.click();
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
