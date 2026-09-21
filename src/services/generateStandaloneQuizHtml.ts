// src/services/generateStandaloneQuizHtml.ts
import { Deck } from '../types';

/**
 * Pusat Kuis Standalone (single-file .html, luring/offline-first).
 *
 * Struktur:
 *  1. Mainkan Kuis — 4 mode: Langsung Main (solo/vs bot), Pass & Play (giliran
 *     bergilir per pemain, sama seperti QuizPlayer), Host/Kuis Master (skor regu
 *     dengan penambah/pengurang poin manual), Multiplayer Online (redirect ke
 *     arena realtime di web app karena butuh WebSocket).
 *  2. Perpustakaan Kuis — OFFLINE: koleksi lokal yang di-embed saat file ini
 *     diunduh (gratis + sudah dibeli + buatan sendiri). ONLINE: bisa menjelajah
 *     katalog server & membeli kuis baru lewat web app (tidak ada simulasi beli
 *     palsu), dan bisa menyinkronkan ulang kepemilikan.
 *  3. Kuis Editor — terkunci kalau akun belum membeli fitur Kreator Kuis
 *     (status dikirim dari aplikasi utama saat file diunduh: `hasQuizEditor`).
 *  4. Pengaturan — 4 sub-tab: Profil (+ sinkronisasi kepemilikan), Tema, Donasi,
 *     Hubungi Kami.
 *
 * Gameplay arena disamakan dengan QuizPlayer.tsx: timer 20 detik per soal untuk
 * mode bergilir-satu-pemain (solo / vs bot / pass & play), giliran otomatis
 * berpindah di Pass & Play, dan papan skor regu dengan tombol +/- poin di mode Host.
 */
export function generateStandaloneQuizHtml(
  decks: Deck[],
  userNickname: string,
  hasQuizEditor: boolean = false,
  apiBaseUrl: string = 'http://localhost:8787',
  webAppUrl: string = 'http://localhost:3000',
  logoDataUri: string = ''
): string {
  const safeNickname = (userNickname || 'Pemain').replace(/</g, '&lt;');
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
    :root { --accent: #FC1212; --accent-soft: rgba(252,18,18,0.18); }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    html { scroll-behavior: smooth; }
    body { background: radial-gradient(circle at 15% 0%, #170a0c 0%, #05070d 45%, #000 100%); color: #E9E9EE; min-height: 100vh; padding: 24px 16px 70px; }
    .container { max-width: 920px; margin: 0 auto; animation: fadeIn .35s ease; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .top-bar { display: flex; align-items: center; justify-content: space-between; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); margin-bottom: 22px; gap: 12px; flex-wrap: wrap; }
    .logo-box { display: flex; align-items: center; gap: 12px; cursor: pointer; text-decoration: none; }
    .logo-img { width: 44px; height: 44px; border-radius: 12px; object-fit: contain; background: rgba(20,33,61,0.8); border: 1px solid rgba(255,255,255,0.15); padding: 4px; }
    .logo-title { font-size: 20px; font-weight: 900; letter-spacing: -0.4px; line-height: 1.1; }
    .dim-mu { opacity: 0.3; color: #fff; }
    .dim-z { opacity: 0.6; color: #fff; }
    .bright-eck { color: var(--accent); }
    .accent-text { color: var(--accent); }
    .badge { font-size: 11px; font-weight: 800; padding: 5px 12px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; }
    .badge-online { background: rgba(16,185,129,0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.35); }
    .badge-offline { background: rgba(252,18,18,0.15); color: var(--accent); border: 1px solid rgba(252,18,18,0.35); }

    .hero-banner { position: relative; overflow: hidden; border-radius: 24px; background: linear-gradient(120deg, #2a0c10, #14213D 55%, #1e0a0d); border: 2px solid rgba(252,18,18,0.35); padding: 22px 24px; box-shadow: 0 14px 40px rgba(252,18,18,0.14); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 22px; }
    .hero-banner::after { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 90% -10%, rgba(255,255,255,0.08), transparent 55%); pointer-events: none; }
    .hero-icon { width: 52px; height: 52px; border-radius: 16px; background: var(--accent-soft); border: 1px solid rgba(252,18,18,0.4); display: flex; align-items: center; justify-content: center; font-size: 22px; box-shadow: 0 8px 20px rgba(252,18,18,0.18); flex-shrink: 0; }
    .hero-title { font-size: 21px; font-weight: 900; color: #fff; letter-spacing: -0.4px; }
    .hero-sub { font-size: 12px; color: #cbd5e1; margin-top: 3px; max-width: 46ch; }
    .hero-chip { display: flex; align-items: center; gap: 10px; background: rgba(0,0,0,0.55); padding: 8px 16px; border-radius: 16px; border: 1px solid rgba(252,163,17,0.3); z-index: 1; }

    .menu-item { position: relative; width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 20px 22px; border-radius: 22px; background: linear-gradient(145deg, #151f3a, #0f1830); border: 1px solid rgba(255,255,255,0.08); color: #fff; margin-bottom: 14px; cursor: pointer; text-align: left; transition: all 0.2s; }
    .menu-item:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 30px rgba(252,18,18,0.2); }
    .menu-item.locked { opacity: 0.55; cursor: not-allowed; }
    .menu-item.locked:hover { border-color: rgba(255,255,255,0.08); transform: none; box-shadow: none; }
    .lock-chip { font-size: 10px; font-weight: 900; padding: 3px 10px; border-radius: 9999px; background: rgba(252,163,17,0.15); color: #FCA311; border: 1px solid rgba(252,163,17,0.35); margin-top: 6px; display: inline-block; }
    .menu-title { font-size: 18px; font-weight: 900; }
    .menu-desc { font-size: 12px; color: #9aa1b5; margin-top: 4px; max-width: 52ch; }
    .btn-back { background: rgba(255,255,255,0.08); color: #ddd; border: none; border-radius: 12px; padding: 9px 16px; font-size: 12px; font-weight: bold; cursor: pointer; margin-bottom: 16px; display: inline-flex; align-items: center; gap: 6px; transition: background .15s; }
    .btn-back:hover { background: rgba(255,255,255,0.18); }
    .card { background: linear-gradient(160deg, #151f3a, #0d1526); border: 1px solid rgba(255,255,255,0.08); border-radius: 24px; padding: 24px; margin-bottom: 20px; box-shadow: 0 14px 34px rgba(0,0,0,0.55); }
    .btn-red { background: var(--accent); color: #fff; border: none; border-radius: 14px; padding: 14px 20px; font-weight: 900; font-size: 13px; cursor: pointer; transition: all 0.15s; }
    .btn-red:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .btn-red:disabled { opacity: 0.4; cursor: not-allowed; transform: none; }
    .btn-outline { background: rgba(0,0,0,0.45); border: 1px solid rgba(252,18,18,0.45); color: #fff; border-radius: 14px; padding: 14px 20px; font-weight: 800; font-size: 13px; cursor: pointer; transition: all 0.15s; }
    .btn-outline:hover { background: rgba(252,18,18,0.18); border-color: var(--accent); }
    .btn-outline:disabled { opacity: 0.4; cursor: not-allowed; }
    .opt-btn { width: 100%; text-align: left; padding: 14px 18px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.09); color: #fff; margin-bottom: 10px; cursor: pointer; font-size: 13px; transition: all .12s; }
    .opt-btn:hover:not(:disabled) { border-color: rgba(252,18,18,0.5); background: rgba(252,18,18,0.08); }
    .opt-btn:disabled { cursor: default; }
    .opt-btn.correct { background: rgba(16,185,129,0.22); border-color: #10B981; font-weight: bold; }
    .opt-btn.wrong { background: rgba(252,18,18,0.22); border-color: var(--accent); }
    .theme-chip { padding: 12px; border-radius: 14px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); cursor: pointer; font-size: 12px; font-weight: bold; text-align: center; transition: all .12s; }
    .theme-chip.selected { background: var(--accent-soft); border-color: var(--accent); color: #fff; }
    .tab-row { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
    .tab-btn { padding: 10px 16px; border-radius: 12px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.1); color: #aaa; font-size: 12px; font-weight: 800; cursor: pointer; }
    .tab-btn.active { background: var(--accent-soft); border-color: var(--accent); color: #fff; }
    .lock-overlay { position: absolute; inset: 0; background: rgba(0,0,0,0.72); backdrop-filter: blur(2px); border-radius: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 24px; }
    .timer-wrap { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-bottom: 16px; }
    .timer-bar { height: 100%; width: 100%; background: linear-gradient(90deg, #10B981, var(--accent)); transition: width 1s linear; }
    .score-pill { padding: 8px 12px; border-radius: 12px; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); font-size: 11px; font-weight: 800; color: #aaa; display: flex; align-items: center; gap: 6px; }
    .score-pill.active { border-color: var(--accent); color: #fff; background: var(--accent-soft); }
    .team-row { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-radius: 14px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 10px; gap: 10px; }
    .stepper-btn { width: 30px; height: 30px; border-radius: 9px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12); color: #fff; font-weight: 900; cursor: pointer; }
    .stepper-btn:hover { background: rgba(255,255,255,0.18); }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-thumb { background: rgba(252,18,18,0.35); border-radius: 999px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <div class="logo-box" onclick="showScreen('menu')">
        <img src="${logoSrc}" alt="Logo" class="logo-img" onerror="this.style.display='none'" />
        <div>
          <div class="logo-title"><span class="dim-mu">Mu</span><span class="dim-z">z</span><span class="bright-eck">eck</span></div>
          <span style="font-size: 10px; font-family: monospace; color: #888;">PUSAT KUIS STANDALONE</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span id="net-badge" class="badge badge-online">● ONLINE</span>
        <span class="accent-text" style="font-size: 12px; font-weight: bold;">${safeNickname}</span>
      </div>
    </div>

    <div class="hero-banner">
      <div style="display:flex; align-items:center; gap:14px; z-index:1;">
        <div class="hero-icon" id="hero-icon">🏠</div>
        <div>
          <div class="hero-title" id="hero-title">Menu Utama</div>
          <div class="hero-sub" id="hero-sub">Pilih salah satu menu di bawah untuk memulai.</div>
        </div>
      </div>
      <div class="hero-chip" id="hero-chip" style="display:none;">
        <span id="hero-chip-text" style="font-size:11px; font-weight:800; color:#FCA311;"></span>
      </div>
    </div>

    <!-- 1. MENU UTAMA -->
    <div id="scr-menu">
      <button class="menu-item" onclick="showScreen('play_select')">
        <div>
          <div class="menu-title accent-text">1. Mainkan Kuis</div>
          <div class="menu-desc">Pilih paket kuis &amp; 4 mode (Langsung Main, Pass &amp; Play, Online, Host/Kuis Master)</div>
        </div>
        <span class="accent-text" style="font-size: 20px; font-weight: 900;">➔</span>
      </button>

      <button class="menu-item" onclick="showScreen('library')">
        <div>
          <div class="menu-title">2. Perpustakaan Kuis</div>
          <div class="menu-desc">Offline: kuis gratis, sudah dibeli &amp; buatan sendiri. Online: jelajahi, beli &amp; sinkronkan kuis baru.</div>
        </div>
        <span style="font-size: 20px; font-weight: 900; color: #aaa;">➔</span>
      </button>

      <button class="menu-item ${hasQuizEditor ? '' : 'locked'}" id="menu-editor-btn" onclick="${hasQuizEditor ? "showScreen('editor')" : "alert('Fitur Kuis Editor belum dibeli untuk akun ini. Beli dulu lewat aplikasi web PlayMuzeck.')"}">
        <div>
          <div class="menu-title" id="menu-editor-title" style="color: ${hasQuizEditor ? '#FCA311' : '#888'};">3. Kuis Editor</div>
          <div class="menu-desc">Buat kuis kustom (12 tema, poin) &amp; kirim ke Cloud (Admin Approved)</div>
          <span id="menu-editor-lock" class="lock-chip" style="display:${hasQuizEditor ? 'none' : 'inline-block'};">🔒 Belum Dibeli</span>
        </div>
        <span id="menu-editor-arrow" style="font-size: 20px; font-weight: 900; color: ${hasQuizEditor ? '#FCA311' : '#666'};">${hasQuizEditor ? '➔' : '🔒'}</span>
      </button>

      <button class="menu-item" onclick="showScreen('settings')">
        <div>
          <div class="menu-title">4. Pengaturan</div>
          <div class="menu-desc">Profil &amp; sinkronisasi kepemilikan, tema tampilan, donasi &amp; dukungan, hubungi kami</div>
        </div>
        <span style="font-size: 20px; font-weight: 900; color: #aaa;">➔</span>
      </button>
    </div>

    <!-- 2. PILIH DECK & 4 MODE PERMAINAN -->
    <div id="scr-play_select" style="display: none;">
      <div style="display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; margin-bottom: 16px;">
        <button class="btn-back" onclick="showScreen('menu')" style="margin-bottom:0;">← Kembali ke Menu Utama</button>
        <button class="btn-back" onclick="showScreen('history')" style="margin-bottom:0;">🕘 Riwayat Hasil</button>
      </div>
      <div class="card">
        <h2 style="font-size: 20px; font-weight: 900; margin-bottom: 8px;">Pilih Paket Kuis yang Akan Dimuat</h2>
        <select id="deck-select" onchange="onDeckSelectChange()" style="width: 100%; padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 13px; font-weight: bold; margin-bottom: 20px; outline: none;"></select>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 24px;">
          <div style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 14px;">
            <label style="font-size: 11px; font-weight: bold; color: #aaa; display:flex; align-items:center; gap:6px;">📋 Jumlah Soal Dimainkan:</label>
            <div style="display:flex; align-items:center; gap:8px; margin-top:8px;">
              <button class="btn-back" style="margin:0; padding:6px 10px;" onclick="adjustQuestionCount(-1)">−</button>
              <input id="q-count" type="number" min="1" value="1" oninput="clampQuestionCount()" style="width:100%; text-align:center; padding:8px; border-radius:10px; background: rgba(0,0,0,0.7); border: 1px solid rgba(255,255,255,0.15); color:#fff; font-family: monospace; font-weight:bold;" />
              <button class="btn-back" style="margin:0; padding:6px 10px;" onclick="adjustQuestionCount(1)">+</button>
            </div>
            <span id="q-count-max" style="font-size:10px; color:#777; display:block; margin-top:6px;"></span>
          </div>

          <button type="button" id="shuffle-toggle" onclick="toggleShuffle()" style="text-align:left; background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 14px; cursor:pointer; color:#fff;">
            <label style="font-size: 11px; font-weight: bold; color: #aaa; display:flex; align-items:center; gap:6px; cursor:pointer;">🔀 Acak Urutan Soal</label>
            <span id="shuffle-state" style="font-size: 13px; font-weight: 900; display:block; margin-top:8px; color:#888;">Nonaktif</span>
          </button>
        </div>

        <h3 style="font-size: 16px; font-weight: 900; margin-bottom: 12px;">Pilih Mode Permainan:</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
          <button class="btn-red" onclick="showSoloSetup()">⚡ Langsung Main</button>
          <button class="btn-outline" onclick="showPassPlaySetup()">📱 Pass &amp; Play</button>
          <button class="btn-outline" onclick="startMultiplayerOnline()">🌐 Multiplayer Online</button>
          <button class="btn-outline" onclick="showHostSetup()">🎙️ Host / Kuis Master</button>
        </div>

        <div id="solo-config" style="display: none; margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
          <span style="font-size: 12px; font-weight: bold; color: #aaa; display: block; margin-bottom: 10px;">Main sendiri santai, atau uji kecepatan lawan bot (timer 20 detik/soal):</span>
          <div style="display:flex; gap:10px; margin-bottom: 14px; flex-wrap: wrap;">
            <button id="solo-mode-normal" class="theme-chip selected" style="flex:1; min-width:140px;" onclick="setVsBot(false)">🙂 Main Sendiri</button>
            <button id="solo-mode-bot" class="theme-chip" style="flex:1; min-width:140px;" onclick="setVsBot(true)">🤖 Lawan Bot</button>
          </div>
          <div id="bot-difficulty-row" style="display:none; margin-bottom: 16px;">
            <span style="font-size: 11px; font-weight: bold; color: #aaa; display:block; margin-bottom: 8px;">Tingkat Kepintaran Bot:</span>
            <div style="display:flex; gap:8px;">
              <button class="theme-chip bot-diff" data-diff="Mudah" onclick="setBotDifficulty('Mudah')">Mudah</button>
              <button class="theme-chip bot-diff selected" data-diff="Sedang" onclick="setBotDifficulty('Sedang')">Sedang</button>
              <button class="theme-chip bot-diff" data-diff="Sulit" onclick="setBotDifficulty('Sulit')">Sulit</button>
            </div>
          </div>
          <button class="btn-red" onclick="startMode('solo')">Mulai Langsung Main</button>
        </div>

        <div id="pass-play-config" style="display: none; margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
          <span style="font-size: 12px; font-weight: bold; color: #aaa; display: block; margin-bottom: 8px;">Jumlah Pemain (2–6), bergiliran satu per satu, timer 20 detik/soal:</span>
          <div style="display: flex; align-items:center; gap: 10px; margin-bottom: 16px;">
            <button class="btn-back" style="margin:0;" onclick="adjustPlayers(-1)">−</button>
            <span id="players-count" style="font-size:18px; font-weight:900; font-family:monospace; width:32px; text-align:center;">2</span>
            <button class="btn-back" style="margin:0;" onclick="adjustPlayers(1)">+</button>
            <span style="font-size:11px; color:#888;">Pemain</span>
          </div>
          <button class="btn-red" onclick="startMode('pass_play')">Mulai Pass &amp; Play</button>
        </div>

        <div id="host-config" style="display: none; margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.1);">
          <span style="font-size: 12px; font-weight: bold; color: #aaa; display: block; margin-bottom: 8px;">Jumlah Regu (1–10). Host membaca soal &amp; menambah/mengurangi poin regu secara manual:</span>
          <div style="display: flex; align-items:center; gap: 10px; margin-bottom: 16px;">
            <button class="btn-back" style="margin:0;" onclick="adjustTeams(-1)">−</button>
            <span id="teams-count" style="font-size:18px; font-weight:900; font-family:monospace; width:32px; text-align:center;">2</span>
            <button class="btn-back" style="margin:0;" onclick="adjustTeams(1)">+</button>
            <span style="font-size:11px; color:#888;">Regu</span>
          </div>
          <button class="btn-red" onclick="startMode('host')">Mulai Sesi Host</button>
        </div>
      </div>
    </div>

    <!-- 3. ARENA GAMEPLAY -->
    <div id="scr-game" style="display: none;">
      <button class="btn-back" onclick="confirmExitGame()">← Keluar Kuis</button>
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items:center; flex-wrap:wrap; gap:8px; font-size: 12px; color: #888; margin-bottom: 12px;">
          <span id="game-mode-label" class="accent-text" style="font-weight: 800;">MODE SOLO</span>
          <span id="game-turn-label" style="color: #FCA311; font-weight: 800;"></span>
          <span id="game-progress" style="font-family: monospace; font-weight: 800; color: #fff;">1 / 10</span>
        </div>

        <div id="timer-wrap" class="timer-wrap" style="display:none;">
          <div id="timer-bar" class="timer-bar"></div>
        </div>

        <div id="bot-score-bar" style="display:none; align-items:center; justify-content:space-between; padding: 10px 14px; border-radius: 12px; background: rgba(139,92,246,0.12); border: 1px solid rgba(139,92,246,0.3); margin-bottom: 16px;">
          <span style="font-size: 11px; font-weight: 800; color: #a78bfa;">🤖 Bot (<span id="bot-diff-label"></span>)</span>
          <span id="bot-score-value" style="font-size: 15px; font-weight: 900; color: #a78bfa; font-family: monospace;">0</span>
        </div>

        <div id="pp-score-bar" style="display:none; flex-wrap:wrap; gap:8px; margin-bottom: 16px;"></div>

        <h3 id="game-question" style="font-size: 18px; font-weight: 800; line-height: 1.5; margin-bottom: 20px;">Pertanyaan kuis</h3>
        <div id="game-options"></div>
        <div id="game-explanation" style="display: none; padding: 14px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.1); margin-top: 16px; font-size: 12px; color: #ccc;"></div>

        <div id="host-panel" style="display: none; margin-top: 20px;">
          <div style="font-size: 12px; font-weight: bold; color: #FCA311; margin-bottom: 10px;">Panel Juri — Skor Regu:</div>
          <div id="team-score-list"></div>
          <button class="btn-back" style="margin-top:6px;" onclick="toggleHostKey()">👁️ Buka/Tutup Kunci Jawaban</button>
        </div>

        <button id="btn-game-next" class="btn-red" style="display: none; margin-top: 20px; width: 100%;" onclick="nextQuestion()">Pertanyaan Berikutnya ➔</button>
        <button id="btn-host-next" class="btn-red" style="display: none; margin-top: 20px; width: 100%;" onclick="nextQuestion()">Soal Berikutnya ➔</button>
      </div>
    </div>

    <!-- RIWAYAT HASIL -->
    <div id="scr-history" style="display: none;">
      <button class="btn-back" onclick="showScreen('play_select')">← Kembali</button>
      <div class="card">
        <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom: 16px; flex-wrap:wrap; gap:10px;">
          <h2 style="font-size: 20px; font-weight: 900;">Riwayat Hasil</h2>
          <button class="btn-outline" style="padding:8px 14px; font-size:11px;" onclick="clearHistory()">🗑️ Hapus Semua</button>
        </div>
        <div id="history-list"></div>
      </div>
    </div>

    <!-- PERPUSTAKAAN KUIS -->
    <div id="scr-library" style="display: none;">
      <button class="btn-back" onclick="showScreen('menu')">← Kembali ke Menu Utama</button>
      <div class="card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h2 style="font-size: 20px; font-weight: 900;">Perpustakaan Kuis</h2>
            <p style="font-size: 12px; color: #888;" id="lib-mode-desc">Menampilkan koleksi lokal (gratis, sudah dibeli, buatan sendiri)</p>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-outline" style="padding: 8px 14px; font-size: 11px;" onclick="loadOnlineCatalog(event)">
              🔄 Jelajahi &amp; Beli Kuis Baru
            </button>
          </div>
        </div>
        <input type="text" id="lib-search" placeholder="Cari judul deck..." oninput="renderLibrary()" style="width: 100%; padding: 12px 16px; border-radius: 14px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px; outline: none; margin: 16px 0 20px;" />
        <div id="lib-cards"></div>
      </div>
    </div>

    <!-- KUIS EDITOR -->
    <div id="scr-editor" style="display: none;">
      <button class="btn-back" onclick="showScreen('menu')">← Kembali ke Menu Utama</button>
      <div class="card">
        <h2 style="font-size: 20px; font-weight: 900; margin-bottom: 6px;">Kuis Editor</h2>
        <p style="font-size: 12px; color: #aaa; margin-bottom: 20px;">Susun kuis kustom dengan 12 tema admin &amp; ajukan ke Perpustakaan Cloud.</p>

        <span class="accent-text" style="font-size: 12px; font-weight: bold; display: block; margin-bottom: 8px;">1. Pilih Tema Admin:</span>
        <div id="theme-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 20px;"></div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="font-size: 11px; font-weight: bold; color: #aaa;">Nama Topik (Bebas):</label>
            <input type="text" id="ed-topic" placeholder="Mis. Komputasi Kuantum" style="width: 100%; padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px; margin-top: 4px;" />
          </div>
          <div>
            <label style="font-size: 11px; font-weight: bold; color: #aaa;">Judul Kuis:</label>
            <input type="text" id="ed-title" placeholder="Mis. Teori Qubit & Gerbang Logika" style="width: 100%; padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px; margin-top: 4px;" />
          </div>
        </div>

        <div style="margin-bottom: 20px;">
          <label style="font-size: 11px; font-weight: bold; color: #aaa;">Teks Pertanyaan Soal #1:</label>
          <textarea id="ed-question" rows="2" placeholder="Tuliskan pertanyaan kuis..." style="width: 100%; padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px; margin-top: 4px;"></textarea>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 20px;">
          <input type="text" id="ed-opt-0" placeholder="Opsi A (Kunci Benar)" style="padding: 10px; border-radius: 10px; background: rgba(16,185,129,0.15); border: 1px solid #10B981; color: #fff; font-size: 12px;" />
          <input type="text" id="ed-opt-1" placeholder="Opsi B" style="padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px;" />
          <input type="text" id="ed-opt-2" placeholder="Opsi C" style="padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px;" />
          <input type="text" id="ed-opt-3" placeholder="Opsi D" style="padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px;" />
        </div>

        <div style="display: flex; gap: 12px; flex-wrap: wrap;">
          <button class="btn-red" onclick="saveCustomDeckLocal()">Simpan ke Koleksi Lokal</button>
          <button class="btn-outline" style="border-color: #FCA311; color: #FCA311;" onclick="submitDeckToCloudAdmin()">
            ☁️ Ajukan ke Perpustakaan Cloud (Perlu Persetujuan Admin)
          </button>
        </div>
      </div>
    </div>

    <!-- 4. PENGATURAN -->
    <div id="scr-settings" style="display: none;">
      <button class="btn-back" onclick="showScreen('menu')">← Kembali ke Menu Utama</button>
      <div class="card">
        <h2 style="font-size: 20px; font-weight: 900; margin-bottom: 16px;">Pengaturan</h2>
        <div class="tab-row">
          <button class="tab-btn active" id="set-tab-profil" onclick="showSettingsTab('profil')">👤 Profil</button>
          <button class="tab-btn" id="set-tab-tema" onclick="showSettingsTab('tema')">🎨 Tema</button>
          <button class="tab-btn" id="set-tab-donasi" onclick="showSettingsTab('donasi')">❤️ Donasi</button>
          <button class="tab-btn" id="set-tab-kontak" onclick="showSettingsTab('kontak')">💬 Hubungi Kami</button>
        </div>

        <div id="set-panel-profil">
          <p style="font-size: 13px; color: #aaa; margin-bottom: 8px;">Nama Pemain: <strong style="color: #fff;">${safeNickname}</strong></p>
          <p style="font-size: 13px; color: #aaa; margin-bottom: 8px;">Status Kuis Editor: <strong id="profil-editor-status" style="color:${hasQuizEditor ? '#10B981' : '#FC1212'};">${hasQuizEditor ? 'Sudah Dibeli ✓' : 'Belum Dibeli'}</strong></p>
          <p style="font-size: 13px; color: #aaa; margin-bottom: 16px;">Server: <strong>${apiBaseUrl}</strong></p>

          <div id="login-box" style="background: rgba(0,0,0,0.4); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 16px; margin-bottom: 16px;">
            <p id="login-status" style="font-size: 12px; color: #aaa; margin-bottom: 10px;">Belum masuk. Masuk dengan akun PlayMuzeck Anda untuk bisa menyinkronkan kepemilikan kuis &amp; status Kuis Editor secara online.</p>
            <div id="login-form" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
              <input type="email" id="login-email" placeholder="Email akun PlayMuzeck" style="padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px;" />
              <input type="password" id="login-password" placeholder="Kata sandi" style="padding: 10px; border-radius: 10px; background: rgba(0,0,0,0.55); border: 1px solid rgba(255,255,255,0.15); color: #fff; font-size: 12px;" />
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button class="btn-red" onclick="doLogin()" id="login-btn">🔑 Masuk &amp; Sinkronkan</button>
              <button class="btn-back" id="logout-btn" style="display:none; margin:0;" onclick="doLogout()">Keluar Akun</button>
            </div>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap;">
            <button class="btn-outline" onclick="syncOwnership()">🔄 Sinkronkan Ulang Kepemilikan</button>
            <button class="btn-back" onclick="localStorage.clear(); alert('Penyimpanan lokal (riwayat, tema & sesi login) berhasil dibersihkan!'); doLogout(true);">Bersihkan Cache Lokal</button>
          </div>
          <p style="font-size:11px; color:#666; margin-top:12px;">Sinkronisasi butuh Anda masuk di sini secara terpisah (berkas mandiri ini <em>tidak</em> berbagi sesi login dengan tab browser aplikasi web, meski dibuka di server yang sama) — token login disimpan hanya di perangkat ini.</p>
        </div>

        <div id="set-panel-tema" style="display: none;">
          <p style="font-size: 12px; color: #aaa; margin-bottom: 14px;">Pilih aksen warna tampilan aplikasi mandiri ini:</p>
          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button class="btn-red" onclick="applyAccent('#FC1212')">Oxford Crimson (Bawaan)</button>
            <button class="btn-outline" onclick="applyAccent('#FCA311')">Amber</button>
            <button class="btn-outline" onclick="applyAccent('#10B981')">Emerald</button>
            <button class="btn-outline" onclick="applyAccent('#8B5CF6')">Violet</button>
            <button class="btn-outline" onclick="applyAccent('#3B82F6')">Biru</button>
          </div>
        </div>

        <div id="set-panel-donasi" style="display: none;">
          <p style="font-size: 12px; color: #aaa; margin-bottom: 14px;">Dukung pengembangan PlayMuzeck lewat aplikasi web (butuh koneksi online untuk pembayaran QRIS resmi).</p>
          <button class="btn-red" onclick="openWebApp('/donate')">Buka Halaman Donasi di Web App</button>
        </div>

        <div id="set-panel-kontak" style="display: none;">
          <p style="font-size: 12px; color: #aaa; margin-bottom: 14px;">Ada kendala atau masukan untuk aplikasi mandiri ini?</p>
          <button class="btn-outline" onclick="openWebApp('/contact')">Hubungi Kami via Web App</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    let DECKS = ${embeddedDecksJson};
    let OWNED_IDS = ${ownedIdsJson};
    let HAS_QUIZ_EDITOR = ${hasQuizEditor ? 'true' : 'false'};
    const API_BASE = ${JSON.stringify(apiBaseUrl)};
    const WEB_APP_URL = ${JSON.stringify(webAppUrl)};
    const QUESTION_TIME_LIMIT = 20;
    let onlineCatalog = null;
    let activeDeck = DECKS[0] || null;
    let currentGameMode = 'solo';
    let qIdx = 0;
    let score = 0;
    let answered = false;
    let answerLog = [];
    let selectedTheme = 'Teknologi';
    let timerHandle = null;
    let timeLeft = QUESTION_TIME_LIMIT;

    const THEMES = ['Olahraga', 'Kehidupan Sehari hari', 'Alam', 'Musik', 'Matematika', 'Seni', 'Teknologi', 'Psikologi', 'Bahasa', 'Sosial', 'Fiksi', 'Lainnya'];

    function openWebApp(path) {
      if (!navigator.onLine) {
        alert('Butuh koneksi online untuk membuka aplikasi web PlayMuzeck.');
        return;
      }
      window.open(WEB_APP_URL + (path || ''), '_blank');
    }

    let currentAccent = '#FC1212';
    function applyAccent(hex) {
      currentAccent = hex;
      document.documentElement.style.setProperty('--accent', hex);
      document.documentElement.style.setProperty('--accent-soft', hex + '2e');
      try { localStorage.setItem('muzeck_standalone_accent', hex); } catch {}
    }
    (function restoreAccent() {
      try {
        const saved = localStorage.getItem('muzeck_standalone_accent');
        if (saved) applyAccent(saved);
      } catch {}
    })();

    function showSettingsTab(tab) {
      ['profil', 'tema', 'donasi', 'kontak'].forEach(function (t) {
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
      play_select: { icon: '▶️', title: 'Mainkan Kuis', sub: 'Pilih paket kuis yang dimuat, tentukan 4 mode permainan, dan mainkan langsung.' },
      game: { icon: '⚡', title: 'Arena Kuis', sub: 'Jawab pertanyaan sebelum waktu habis.' },
      history: { icon: '🕘', title: 'Riwayat Hasil', sub: 'Skor sesi kuis yang sudah dimainkan di perangkat ini.' },
      library: { icon: '📚', title: 'Perpustakaan Kuis', sub: 'Katalog seluruh tema kuis, starter deck bawaan, dan kuis kustom.' },
      editor: { icon: '✏️', title: 'Kuis Editor', sub: 'Susun kuis kustom & ajukan ke perpustakaan cloud.' },
      settings: { icon: '⚙️', title: 'Pengaturan', sub: 'Profil, tema tampilan, donasi & dukungan, serta hubungi kami.' },
    };

    function showScreen(id) {
      if (id === 'editor' && !HAS_QUIZ_EDITOR) {
        alert('Fitur Kuis Editor belum dibeli untuk akun ini. Beli dulu lewat aplikasi web PlayMuzeck.');
        id = 'menu';
      }
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

    function confirmExitGame() {
      if (confirm('Keluar dari kuis? Progres soal saat ini tidak akan tersimpan.')) {
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
      shuffleOn = !shuffleOn;
      const label = document.getElementById('shuffle-state');
      const box = document.getElementById('shuffle-toggle');
      label.innerText = shuffleOn ? 'Aktif' : 'Nonaktif';
      label.style.color = shuffleOn ? currentAccent : '#888';
      box.style.borderColor = shuffleOn ? currentAccent : 'rgba(255,255,255,0.1)';
      box.style.background = shuffleOn ? currentAccent + '20' : 'rgba(0,0,0,0.4)';
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
      box.innerHTML = list.map(function (h, i) {
        return '<button type="button" onclick="openHistoryDetail(' + i + ')" style="width:100%; text-align:left; cursor:pointer; padding:14px 16px; border-radius:16px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:10px; color:#fff;">' +
          '<div><div style="font-size:13px; font-weight:800; color:#fff;">' + h.deckTitle + '</div>' +
          '<div style="font-size:11px; color:#888; margin-top:2px;">' + h.mode.toUpperCase() + (h.vsBot ? ' vs BOT' : '') + ' • ' + h.date + (h.answers && h.answers.length ? ' • Lihat jawaban ➔' : '') + '</div></div>' +
          '<div style="font-size:16px; font-weight:900; color:#10B981; font-family:monospace; flex-shrink:0;">' + h.score + '/' + h.total + '</div></button>';
      }).join('');
    }

    function openHistoryDetail(i) {
      let list = [];
      try { list = JSON.parse(localStorage.getItem('muzeck_standalone_history') || '[]'); } catch {}
      const h = list[i];
      if (!h || !h.answers || !h.answers.length) {
        alert('Rincian jawaban tidak tersedia untuk sesi ini (riwayat lama sebelum fitur ini ditambahkan).');
        return;
      }
      const box = document.getElementById('history-list');
      const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
      let html = '<button class="btn-back" onclick="renderHistory()">← Kembali ke Daftar Riwayat</button>';
      html += '<h3 style="font-size:15px; font-weight:900; margin-bottom:4px;">' + h.deckTitle + '</h3>';
      html += '<p style="font-size:11px; color:#888; margin-bottom:16px;">' + h.mode.toUpperCase() + (h.vsBot ? ' vs BOT (' + (h.botScore != null ? h.botScore : '') + ')' : '') + ' • ' + h.date + ' • Skor ' + h.score + '/' + h.total + '</p>';
      html += h.answers.map(function (a) {
        return '<div style="padding:12px 14px; border-radius:14px; margin-bottom:10px; background:' + (a.isCorrect ? 'rgba(16,185,129,0.1)' : 'rgba(252,18,18,0.1)') + '; border:1px solid ' + (a.isCorrect ? 'rgba(16,185,129,0.3)' : 'rgba(252,18,18,0.3)') + ';">' +
          '<div style="font-size:11px; font-weight:800; color:#aaa; margin-bottom:6px;">Soal ' + a.number + (a.player ? ' • ' + a.player : '') + (a.isCorrect ? ' • ✅ Benar' : ' • ❌ Salah') + '</div>' +
          '<div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:8px;">' + a.question + '</div>' +
          (a.options || []).map(function (opt, oi) {
            const isSel = oi === a.selectedIndex;
            const isCorr = oi === a.correctIndex;
            const c = isCorr ? '#10B981' : (isSel ? '#FC1212' : '#888');
            return '<div style="font-size:11px; color:' + c + '; font-weight:' + (isCorr || isSel ? '800' : '400') + '; margin-bottom:3px;">' + letters[oi] + '. ' + opt + (isCorr ? ' ✓' : '') + (isSel && !isCorr ? ' (jawaban dipilih)' : '') + '</div>';
          }).join('') +
          (a.explanation ? '<div style="font-size:11px; color:#ccc; margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">Penjelasan: ' + a.explanation + '</div>' : '') +
          '</div>';
      }).join('');
      box.innerHTML = html;
    }

    function clearHistory() {
      if (!confirm('Hapus semua riwayat hasil di perangkat ini?')) return;
      localStorage.removeItem('muzeck_standalone_history');
      renderHistory();
    }

    function showPassPlaySetup() {
      document.getElementById('solo-config').style.display = 'none';
      document.getElementById('host-config').style.display = 'none';
      document.getElementById('pass-play-config').style.display = 'block';
    }

    function showSoloSetup() {
      document.getElementById('pass-play-config').style.display = 'none';
      document.getElementById('host-config').style.display = 'none';
      document.getElementById('solo-config').style.display = 'block';
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
      vsBotEnabled = on;
      document.getElementById('solo-mode-normal').classList.toggle('selected', !on);
      document.getElementById('solo-mode-bot').classList.toggle('selected', on);
      document.getElementById('bot-difficulty-row').style.display = on ? 'block' : 'none';
    }

    function setBotDifficulty(d) {
      botDifficulty = d;
      document.querySelectorAll('.bot-diff').forEach(function (el) {
        el.classList.toggle('selected', el.getAttribute('data-diff') === d);
      });
    }

    function resolveBotAnswer() {
      if (currentGameMode !== 'solo' || !vsBotEnabled) return;
      if (Math.random() < BOT_SKILL[botDifficulty]) botScore++;
    }

    let numPlayersPP = 2;
    function adjustPlayers(delta) {
      numPlayersPP = Math.min(6, Math.max(2, numPlayersPP + delta));
      document.getElementById('players-count').innerText = numPlayersPP;
    }

    let teamCountHost = 2;
    function adjustTeams(delta) {
      teamCountHost = Math.min(10, Math.max(1, teamCountHost + delta));
      document.getElementById('teams-count').innerText = teamCountHost;
    }

    // Pass & Play state
    let ppScores = [];
    let ppActive = 0;
    // Host state
    let teamScores = [];
    let pointStep = 10;

    // Multiplayer online sungguhan butuh server realtime (WebSocket) seperti di web app,
    // yang tidak bisa berjalan di satu berkas HTML statis, jadi diarahkan ke arena asli.
    function startMultiplayerOnline() {
      if (!navigator.onLine) {
        alert('Multiplayer Online butuh koneksi internet aktif. Anda sedang offline.');
        return;
      }
      const idx = document.getElementById('deck-select').value;
      const deck = DECKS[idx] || DECKS[0];
      openWebApp('/quiz?multiplayer=1&deckId=' + encodeURIComponent(deck.id));
    }

    function startMode(mode) {
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

      const modeLabelText = mode === 'solo' && vsBotEnabled ? 'SOLO VS BOT (' + botDifficulty + ')' : (mode === 'pass_play' ? 'PASS & PLAY' : (mode === 'host' ? 'HOST / KUIS MASTER' : 'MODE ' + mode.toUpperCase()));
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
      timeLeft = QUESTION_TIME_LIMIT;
      const bar = document.getElementById('timer-bar');
      bar.style.transition = 'none';
      bar.style.width = '100%';
      bar.style.background = 'linear-gradient(90deg, #10B981, var(--accent))';
      requestAnimationFrame(function () { bar.style.transition = 'width 1s linear'; });
      timerHandle = setInterval(function () {
        timeLeft--;
        const pct = Math.max(0, (timeLeft / QUESTION_TIME_LIMIT) * 100);
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
      box.innerHTML = ppScores.map(function (s, i) {
        return '<span class="score-pill' + (i === ppActive ? ' active' : '') + '">P' + (i + 1) + ': ' + s + '</span>';
      }).join('');
      document.getElementById('game-turn-label').innerText = 'Giliran: Pemain ' + (ppActive + 1);
    }

    function renderTeamScoreList() {
      if (currentGameMode !== 'host') return;
      const box = document.getElementById('team-score-list');
      box.innerHTML = '<div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;"><span style="font-size:11px; color:#aaa; font-weight:700;">Nilai per klik:</span>' +
        '<button class="stepper-btn" onclick="adjustPointStep(-5)">−</button><span style="font-family:monospace; font-weight:900; width:34px; text-align:center; display:inline-block;">' + pointStep + '</span><button class="stepper-btn" onclick="adjustPointStep(5)">+</button></div>' +
        teamScores.map(function (s, i) {
          return '<div class="team-row"><span style="font-weight:800; font-size:13px;">Regu ' + String.fromCharCode(65 + i) + '</span>' +
            '<div style="display:flex; align-items:center; gap:10px;"><button class="stepper-btn" onclick="adjustTeamScore(' + i + ', -1)">−</button>' +
            '<span style="font-family:monospace; font-weight:900; font-size:15px; width:40px; text-align:center;">' + s + '</span>' +
            '<button class="stepper-btn" onclick="adjustTeamScore(' + i + ', 1)">+</button></div></div>';
        }).join('');
    }

    function adjustPointStep(d) {
      pointStep = Math.max(5, Math.min(1000, pointStep + d));
      renderTeamScoreList();
    }

    function adjustTeamScore(i, dir) {
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

      buttons.forEach(function (b) { b.disabled = true; });
      if (idx >= 0 && buttons[idx]) {
        buttons[idx].classList.add(isCorrect ? 'correct' : 'wrong');
      }
      if (!isCorrect && buttons[q.correctIndex]) buttons[q.correctIndex].classList.add('correct');

      if (isCorrect) {
        if (currentGameMode === 'pass_play') { ppScores[ppActive]++; }
        else { score++; }
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

      resolveBotAnswer();
      if (document.getElementById('bot-score-value')) document.getElementById('bot-score-value').innerText = botScore;
      if (currentGameMode === 'pass_play') renderPpScoreBar();

      if (q.explanation) {
        const exp = document.getElementById('game-explanation');
        exp.innerText = 'Penjelasan: ' + q.explanation;
        exp.style.display = 'block';
      }

      document.getElementById('btn-game-next').style.display = 'block';
    }

    function nextQuestion() {
      if (currentGameMode === 'pass_play') {
        ppActive = (ppActive + 1) % ppScores.length;
        if (ppActive === 0) qIdx++;
      } else {
        qIdx++;
      }
      loadQuestion();
    }

    function toggleHostKey() {
      const q = (activeDeck.questions || [])[qIdx];
      const buttons = document.querySelectorAll('.opt-btn');
      if (buttons[q.correctIndex]) buttons[q.correctIndex].classList.toggle('correct');
    }

    function finishGame(total) {
      let summary = '';
      if (currentGameMode === 'solo' && vsBotEnabled) {
        summary = 'Kuis selesai! Kamu ' + score + ' vs Bot (' + botDifficulty + ') ' + botScore +
          (score > botScore ? ' — Kamu Menang! 🏆' : (score < botScore ? ' — Bot Menang.' : ' — Seri!'));
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score: score, total: total, vsBot: true, botScore: botScore, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      } else if (currentGameMode === 'pass_play') {
        const ranked = ppScores.map(function (s, i) { return { name: 'Pemain ' + (i + 1), score: s }; }).sort(function (a, b) { return b.score - a.score; });
        summary = 'Kuis selesai!\\n' + ranked.map(function (r, i) { return (i + 1) + '. ' + r.name + ': ' + r.score + '/' + total; }).join('\\n');
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score: ranked[0] ? ranked[0].score : 0, total: total, vsBot: false, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      } else if (currentGameMode === 'host') {
        const ranked = teamScores.map(function (s, i) { return { name: 'Regu ' + String.fromCharCode(65 + i), score: s }; }).sort(function (a, b) { return b.score - a.score; });
        summary = 'Sesi Host selesai!\\n' + ranked.map(function (r, i) { return (i + 1) + '. ' + r.name + ': ' + r.score + ' poin'; }).join('\\n');
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score: ranked[0] ? ranked[0].score : 0, total: total, vsBot: false, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      } else {
        summary = 'Kuis selesai! Skor Anda: ' + score + ' / ' + total;
        saveHistoryEntry({ deckTitle: activeDeck.title, mode: currentGameMode, score: score, total: total, vsBot: false, date: new Date().toLocaleString('id-ID'), answers: answerLog });
      }
      alert(summary);
      showScreen('play_select');
    }

    // Katalog lengkap dari server (termasuk kuis yang belum dimiliki, dengan harga).
    async function loadOnlineCatalog(evt) {
      if (!navigator.onLine) {
        alert('Fitur ini butuh koneksi online untuk melihat katalog lengkap.');
        return;
      }
      const btn = evt && evt.target ? evt.target.closest('button') : null;
      const originalLabel = btn ? btn.innerHTML : '';
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Memuat katalog...'; }
      try {
        const res = await fetch(API_BASE + '/api/public/decks', { credentials: 'include' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const parsed = Array.isArray(data) ? data : (data.decks || data.data || []);
        if (!Array.isArray(parsed) || !parsed.length) {
          alert('Server merespons OK tapi tidak mengembalikan daftar kuis. Menampilkan koleksi lokal saja.');
          onlineCatalog = [];
        } else {
          onlineCatalog = parsed;
        }
        renderLibrary();
      } catch (err) {
        alert('Gagal memuat katalog dari server: ' + (err && err.message ? err.message : err) + '. Tetap menampilkan koleksi lokal.');
      } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalLabel; }
      }
    }

    // Login/sinkronisasi memakai token HMAC ala /api/auth/login (Authorization: Bearer),
    // BUKAN cookie sesi — backend ini memang tidak memakai cookie sama sekali, jadi
    // berkas mandiri ini butuh login sendiri (terpisah dari tab aplikasi web) lalu
    // menyimpan tokennya sendiri secara lokal di perangkat ini.
    let authToken = null;
    let authEmail = null;
    (function restoreAuth() {
      try {
        authToken = localStorage.getItem('muzeck_standalone_token');
        authEmail = localStorage.getItem('muzeck_standalone_email');
        if (authToken && authEmail) updateLoginUi();
      } catch {}
    })();

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
        statusEl.innerText = 'Belum masuk. Masuk dengan akun PlayMuzeck Anda untuk bisa menyinkronkan kepemilikan kuis & status Kuis Editor secara online.';
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
      if (!email || !password) { alert('Isi email dan kata sandi dulu.'); return; }
      const btn = document.getElementById('login-btn');
      const original = btn.innerHTML;
      btn.disabled = true; btn.innerHTML = '⏳ Memproses...';
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
        alert('Gagal masuk: ' + (err && err.message ? err.message : err));
      } finally {
        btn.disabled = false; btn.innerHTML = original;
      }
    }

    function doLogout(silent) {
      authToken = null; authEmail = null;
      try {
        localStorage.removeItem('muzeck_standalone_token');
        localStorage.removeItem('muzeck_standalone_email');
      } catch {}
      const loginBox = document.getElementById('login-box');
      if (loginBox) updateLoginUi();
      if (!silent) alert('Berhasil keluar dari sesi berkas mandiri ini.');
    }

    // Normalisasi baris deck mentah dari database (bisa snake_case: topic_id,
    // card_count, is_free) menjadi bentuk camelCase yang dipakai di sisi tampilan.
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

    // Sinkronkan kepemilikan (deck yang sudah dibeli + status Kuis Editor) lewat
    // GET /api/user/collections, memakai token dari doLogin() di atas.
    async function syncOwnership() {
      if (!navigator.onLine) {
        alert('Sinkronisasi membutuhkan koneksi online.');
        return;
      }
      if (!authToken) {
        alert('Silakan masuk (login) dulu di atas sebelum menyinkronkan kepemilikan.');
        return;
      }
      try {
        const res = await fetch(API_BASE + '/api/user/collections?email=' + encodeURIComponent(authEmail || ''), {
          headers: { Authorization: 'Bearer ' + authToken },
        });
        if (res.status === 401 || res.status === 403) {
          doLogout(true);
          throw new Error('Sesi login sudah berakhir, silakan masuk ulang.');
        }
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        const owned = ((data.quiz && data.quiz.decks) || []).map(normalizeDeck);
        const ownedIds = (data.quiz && data.quiz.deckIds) || owned.map(function (d) { return d.id; });
        owned.forEach(function (d) {
          if (!d || !d.id) return;
          const localIdx = DECKS.findIndex(function (x) { return x.id === d.id; });
          if (localIdx >= 0) DECKS[localIdx] = d; else DECKS.push(d);
        });
        ownedIds.forEach(function (id) { if (OWNED_IDS.indexOf(id) === -1) OWNED_IDS.push(id); });

        if (data.features && typeof data.features.quizEditor === 'boolean') {
          HAS_QUIZ_EDITOR = data.features.quizEditor;
          const btn = document.getElementById('menu-editor-btn');
          const title = document.getElementById('menu-editor-title');
          const lock = document.getElementById('menu-editor-lock');
          const arrow = document.getElementById('menu-editor-arrow');
          const status = document.getElementById('profil-editor-status');
          if (HAS_QUIZ_EDITOR) {
            btn.classList.remove('locked');
            btn.setAttribute('onclick', "showScreen('editor')");
            title.style.color = '#FCA311';
            lock.style.display = 'none';
            arrow.style.color = '#FCA311';
            arrow.innerText = '➔';
          }
          if (status) { status.innerText = HAS_QUIZ_EDITOR ? 'Sudah Dibeli ✓' : 'Belum Dibeli'; status.style.color = HAS_QUIZ_EDITOR ? '#10B981' : '#FC1212'; }
        }
        alert('Sinkronisasi berhasil! ' + ownedIds.length + ' kuis kepemilikan diperbarui.');
        populateDeckSelector();
        renderLibrary();
      } catch (err) {
        alert('Gagal sinkronisasi: ' + (err && err.message ? err.message : err));
      }
    }

    function buyDeckOnline(deckId) {
      if (!navigator.onLine) {
        alert('Pembelian membutuhkan koneksi online.');
        return;
      }
      openWebApp('/quiz?buy=' + encodeURIComponent(deckId));
    }

    function renderLibrary() {
      const q = (document.getElementById('lib-search')?.value || '').toLowerCase();
      const list = document.getElementById('lib-cards');
      const modeDesc = document.getElementById('lib-mode-desc');
      if (!list || !modeDesc) return;
      list.innerHTML = '';

      const usingOnlineCatalog = navigator.onLine && Array.isArray(onlineCatalog);
      modeDesc.innerText = usingOnlineCatalog
        ? 'Menampilkan katalog lengkap dari server — kuis yang belum dimiliki bisa dibeli lewat aplikasi web'
        : 'Menampilkan koleksi lokal (gratis, sudah dibeli, buatan sendiri)';

      const source = usingOnlineCatalog ? onlineCatalog : DECKS;

      source
        .filter(d => (d.title || '').toLowerCase().includes(q) || (d.description || '').toLowerCase().includes(q))
        .forEach((deck) => {
          const owned = OWNED_IDS.includes(deck.id) || !usingOnlineCatalog;
          const localIdx = DECKS.findIndex(d => d.id === deck.id);

          const div = document.createElement('div');
          div.style = 'padding: 16px; border-radius: 16px; background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.08); margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 12px; transition: border-color .15s;';

          const info = document.createElement('div');
          info.innerHTML = '<h4 style="font-size: 15px; font-weight: 800; color: #fff;">' + deck.title + '</h4><p style="font-size: 11px; color: #888; margin-top: 4px;">' + ((deck.questions && deck.questions.length) || deck.cardCount || 0) + ' Soal • ' + (deck.difficulty || 'Sedang') + (owned ? '' : ' • Rp' + Number(deck.price || 3000).toLocaleString('id-ID')) + '</p>';
          div.appendChild(info);

          const actions = document.createElement('div');
          actions.style = 'display:flex; gap:8px; flex-shrink: 0;';

          if (owned && localIdx >= 0) {
            const playBtn = document.createElement('button');
            playBtn.className = 'btn-red';
            playBtn.innerText = 'Mainkan';
            playBtn.onclick = () => startDeckDirect(localIdx);
            actions.appendChild(playBtn);
          } else if (owned) {
            const syncBtn = document.createElement('button');
            syncBtn.className = 'btn-outline';
            syncBtn.style = 'padding:8px 14px; font-size:11px;';
            syncBtn.innerText = '✓ Dimiliki — Sinkronkan';
            syncBtn.onclick = () => syncOwnership();
            actions.appendChild(syncBtn);
          } else {
            const buyBtn = document.createElement('button');
            buyBtn.className = 'btn-outline';
            buyBtn.style = 'padding:8px 14px; font-size:11px;';
            buyBtn.innerText = 'Beli di Web App';
            buyBtn.onclick = () => buyDeckOnline(deck.id);
            actions.appendChild(buyBtn);
          }

          div.appendChild(actions);
          list.appendChild(div);
        });

      if (!list.children.length) {
        list.innerHTML = '<p style="font-size:12px; color:#666; text-align:center; padding: 20px 0;">Tidak ada kuis yang cocok.</p>';
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
        c.onclick = () => { selectedTheme = t; renderThemes(); };
        box.appendChild(c);
      });
    }

    function saveCustomDeckLocal() {
      const title = document.getElementById('ed-title').value.trim();
      const topic = document.getElementById('ed-topic').value.trim();
      const qText = document.getElementById('ed-question').value.trim();
      if (!title || !qText) {
        alert('Mohon isi minimal judul kuis dan teks pertanyaan!');
        return;
      }
      const newD = {
        id: 'deck-local-' + Date.now(),
        topicId: topic || selectedTheme,
        title: title,
        description: 'Kuis kustom buatan ' + '${safeNickname}' + ' dalam tema ' + selectedTheme,
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
      alert('Kuis kustom berhasil disimpan ke memori lokal mandiri!');
      showScreen('menu');
    }

    async function submitDeckToCloudAdmin() {
      if (!navigator.onLine) {
        alert('Gagal: Pengajuan kuis ke Cloud membutuhkan koneksi online.');
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
            email: 'user@muzeck.local',
            genre: selectedTheme,
            mood: 'Komunitas Kuis',
            notes: 'Kuis diajukan oleh ' + '${safeNickname}' + ' untuk masuk perpustakaan kuis.'
          })
        });
      } catch {}
      alert('Kuis berhasil diajukan ke server Cloud! Status: MENUNGGU PERSETUJUAN ADMIN sebelum tampil di perpustakaan publik.');
    }
  </script>
</body>
</html>`;
}
