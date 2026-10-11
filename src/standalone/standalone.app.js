/* src/standalone/standalone.app.js
   Antarmuka berkas mandiri PlayMuzeck_Quiz.html: segmen "Pusat Kuis" + segmen "Profil Pengguna".
   Memakai kelas dari standalone.css (banner, mode-card, deck-card, q-opt, rev, tabs, frame-tile, theme-card, rank-row, dst.). */
(function () {
  'use strict';

  const Core = window.PMCore;
  const Theme = window.PMTheme;
  const BUILTIN = window.PM_BUILTIN_DECKS || [];
  const BOOT = window.PM_BOOT || null; /* data akun dari situs; null pada berkas build statis */

  let S = Core.load();
  const ui = {
    view: 'quiz', menu: false, search: '', cat: 'Semua', tab: 'ringkasan',
    modal: null, play: null, editor: null, confirm: null, toastT: null, warned: false, focusModal: false
  };

  const $app = document.getElementById('app');
  const $modal = document.getElementById('modal-root');
  const $conf = document.getElementById('confirm-root');
  const $toast = document.getElementById('toast-root');

  const LET = ['A', 'B', 'C', 'D', 'E', 'F'];
  const MODE_LABEL = { quick: 'Kuis Acak', timed: 'Lawan Waktu', daily: 'Tantangan Harian', wrong: 'Latihan Soal Salah', deck: 'Kuis Pilihan' };
  const ICONS = ['🎵', '🎼', '🎸', '🥁', '🎹', '🎤', '🎧', '🎷', '🎺', '🎻', '🌍', '📚', '⭐', '🔥'];
  const LOGO_SVG = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#e11d48"/></linearGradient></defs>' +
    '<rect width="64" height="64" rx="16" fill="url(#g)"/><circle cx="24" cy="46" r="7" fill="#fff"/><circle cx="44" cy="42" r="7" fill="#fff"/>' +
    '<path d="M29 46V20l20-5v27h-5V24l-10 2.5V46z" fill="#fff"/></svg>');
  const LOGO = (BOOT && BOOT.logo) || LOGO_SVG;

  /* ───────────── Helper umum ───────────── */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const P = () => S.profiles[S.activeId];
  const fmt = (n) => Core.fmtNum(n);
  const allDecks = () => BUILTIN.concat(S.decks);
  const deckById = (id) => allDecks().find((d) => d.id === id) || null;
  const initial = (name) => (Array.from(String(name || '?').trim())[0] || '?').toUpperCase();
  const slug = (s) => String(s || 'kuis').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'kuis';
  const categoryList = () => Array.from(new Set(allDecks().map((d) => d.category))).sort((a, b) => a.localeCompare(b, 'id'));
  /* Kuis Editor: pada berkas dari situs, hanya aktif bila akun memiliki lisensinya. */
  const canEdit = () => !BOOT || BOOT.hasEditor !== false;
  const editorLocked = () => toast('Kuis Editor belum aktif di akunmu. Beli lisensinya di ' + ((BOOT && BOOT.webUrl) || 'situs PlayMuzeck') + ', lalu unduh ulang berkas ini.', true);
  /* Bingkai akun hanya ditampilkan bila berkas berasal dari situs. */
  const shownFrames = () => Core.FRAMES.filter((f) => !f.web || BOOT);

  function save() {
    const ok = Core.save(S);
    if (!ok && !ui.warned) {
      ui.warned = true;
      toast('Penyimpanan peramban penuh atau dinonaktifkan. Perubahan tidak akan tersimpan setelah halaman ditutup.', true);
    }
    return ok;
  }

  function toast(msg, err) {
    clearTimeout(ui.toastT);
    $toast.innerHTML = `<div class="toast-box fade${err ? ' err' : ''}" role="status">${esc(msg)}</div>`;
    ui.toastT = setTimeout(() => { $toast.innerHTML = ''; }, err ? 5500 : 3200);
  }

  function deckKeyLabel(k) {
    if (k === 'mix') return 'Campuran (acak)';
    if (k === 'daily') return 'Tantangan Harian';
    if (k === 'wrong') return 'Latihan Soal Salah';
    const d = deckById(k);
    return d ? d.title : '(kuis sudah dihapus)';
  }

  function wrongMap() {
    const p = P(), ids = {};
    let n = 0;
    allDecks().forEach((d) => d.questions.forEach((q) => { if (p.wrong[q.id]) { ids[q.id] = 1; n++; } }));
    return { ids, n };
  }

  function download(name, text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function readFile(input, cb) {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast('Berkas terlalu besar (maksimal 8 MB).', true); return; }
    const fr = new FileReader();
    fr.onload = () => cb(String(fr.result));
    fr.onerror = () => toast('Berkas tidak bisa dibaca.', true);
    fr.readAsText(f);
  }

  /* ───────────── Avatar + bingkai ───────────── */
  function avatarHTML(p, size, frameId) {
    const f = Core.frameOf(frameId || p.frame);
    const small = size === 'xs' || size === 'sm';
    const rnd = p.shape === 'rnd';
    const radius = rnd ? '50%' : (size === 'lg' ? '18px' : (small ? '12px' : '15px'));
    const inner = p.avatar
      ? `<img src="${esc(p.avatar)}" alt="">`
      : `<span class="av-fb">${esc(initial(p.name))}</span>`;
    let orn = '';
    if (f.badge) orn += `<span class="orn badge-c${small ? ' sm' : ''}" style="background:var(--t-surface);border:1px solid var(--w20)">${f.badge}</span>`;
    if (f.pill && !small) orn += `<span class="orn pill-c" style="background:${f.pillBg}">${esc(f.pill)}</span>`;
    return `<div class="avatar av-${size}${f.glow ? ' fr-glow' : ''}" style="padding:${small ? 2 : 3}px;background:${f.bg};border-radius:${radius}">` +
      `<div class="av-box${rnd ? ' rnd' : ''}">${inner}</div>${orn}</div>`;
  }

  /* ───────────── Kerangka & header ───────────── */
  function render() {
    const y = window.scrollY;
    $app.innerHTML = header() + (ui.view === 'profile' ? viewProfile() : viewQuiz());
    window.scrollTo(0, y);
  }

  function header() {
    const p = P(), lv = Core.levelInfo(p.xp);
    const seg = ui.view === 'profile' ? 'Profil Pengguna' : 'Pusat Kuis';
    const item = (v, ico, t, d) => `<button class="menu-item${ui.view === v ? ' on' : ''}" role="menuitem" data-act="go" data-view="${v}">
      <span class="t20">${ico}</span><span><b>${t}</b><small>${d}</small></span></button>`;
    const pop = ui.menu ? `<div class="menu-pop" role="menu">
        <div class="t11 fw8 c-g400" style="padding:0 4px 2px">Pilih segmen</div>
        ${item('quiz', '🎯', 'Pusat Kuis', 'Main kuis, perpustakaan, dan peringkat')}
        ${item('profile', '👤', 'Profil Pengguna', 'Statistik, bingkai, tema, dan data')}
      </div>` : '';
    const status = Core.canStore()
      ? '<span class="hide-sm"><span class="badge b-on" title="Data disimpan di peramban ini">● Tersimpan lokal</span></span>'
      : '<span class="badge b-off" title="Penyimpanan peramban tidak tersedia">● Tidak tersimpan</span>';
    return `<header class="hdr"><div class="hdr-in flex items-center between g3">
      <div class="flex items-center g3 min0">
        <button class="logo-btn flex items-center g25" data-act="go" data-view="quiz" aria-label="PlayMuzeck, ke Pusat Kuis">
          <span class="logo-box"><img alt="" src="${LOGO}"></span>
          <span class="logo-txt"><b class="t14 fw9 c-white">PlayMuzeck</b><span class="t11 c-g400">Quiz</span></span>
        </button>
        <div class="relative" data-menuwrap>
          <button class="menu-btn${ui.menu ? ' on' : ''}" data-act="menu" aria-haspopup="true" aria-expanded="${ui.menu}">
            <span aria-hidden="true">☰</span><span>${seg}</span><span class="t10" aria-hidden="true">▾</span>
          </button>${pop}
        </div>
      </div>
      <div class="flex items-center g25 min0">${status}
        <button class="user-pill" data-act="go" data-view="profile" title="Buka Profil Pengguna">
          ${avatarHTML(p, 'xs')}
          <span class="min0 flex col"><span class="t12 fw8 c-white trunc">${esc(p.name)}</span><span class="t10 c-ac">Level ${lv.level}</span></span>
        </button>
      </div></div></header>`;
  }

  const banner = (ico, title, sub, chips) => `<section class="banner">
      <div class="flex items-center g4 min0"><div class="banner-ico" aria-hidden="true">${ico}</div>
        <div class="min0"><h1>${title}</h1><p class="t12 c-g400 mt1 lh">${sub}</p></div></div>
      <div class="flex g3 wrap">${chips}</div></section>`;
  const bchip = (ico, top, val) => `<div class="banner-chip"><span class="t20" aria-hidden="true">${ico}</span>
      <div><div class="t11 c-g400">${top}</div><div class="t16 fw9 c-white">${val}</div></div></div>`;

  /* ───────────── SEGMEN: PUSAT KUIS ───────────── */
  function viewQuiz() {
    const p = P(), lv = Core.levelInfo(p.xp);
    const chips = bchip('⭐', 'Level', lv.level) + bchip('✨', 'Total XP', fmt(p.xp)) + bchip('🔥', 'Hari beruntun', p.days.streak);
    return `<main class="page sp5">
      ${banner('🎯', 'Pusat Kuis', 'Pilih mode, jelajahi perpustakaan, atau buat kuis sendiri. Skor dan XP tersimpan di profilmu.', chips)}
      <div class="grid lg-side">
        <div class="sp5 min0">${modesCard()}${libraryCard()}</div>
        <div class="sp5 min0">${rankCard()}${recentCard()}</div>
      </div></main>`;
  }

  function modeCard(o) {
    return `<button class="mode-card ${o.disabled ? '' : 'click '}${o.cls || ''}" data-act="mode" data-mode="${o.mode}"${o.disabled ? ' disabled style="opacity:.5"' : ''}>
      <div class="flex items-start g3"><span class="iconbox" style="background:var(--w10)" aria-hidden="true">${o.ico}</span>
        <div class="min0"><div class="mc-t">${o.title}</div><div class="mc-d">${o.desc}</div></div></div>
      <div class="mc-d" style="margin-top:0;font-weight:800">${o.meta}</div></button>`;
  }

  function modesCard() {
    const p = P(), st = S.settings, done = p.daily.date === Core.todayKey(), wn = wrongMap().n;
    const secOpts = [10, 15, 20, 30, 45, 60].map((v) => `<option value="${v}"${v === st.seconds ? ' selected' : ''}>${v} detik</option>`).join('');
    const tog = (key, label, desc) => `<button class="flex items-center between g3 w100" data-act="toggle" data-key="${key}" role="switch" aria-checked="${st[key]}">
        <span class="min0"><span class="t12 fw8 c-white" style="display:block">${label}</span><span class="t11 c-g400" style="display:block">${desc}</span></span>
        <span class="toggle${st[key] ? ' on' : ''}"><i></i></span></button>`;
    return `<section class="card sp4" aria-labelledby="h-modes">
      <div><h2 id="h-modes" class="t18 fw9 c-white">Mode Permainan</h2><p class="t12 c-g400">Pilih cara bermain. Pengaturan di bawah berlaku untuk semua mode.</p></div>
      <div class="grid cols2">
        ${modeCard({ mode: 'quick', ico: '🎲', title: 'Kuis Acak', desc: `${st.count} soal acak dari seluruh perpustakaan, tanpa batas waktu.`, meta: 'Mulai ▶' })}
        ${modeCard({ mode: 'timed', ico: '⏱️', title: 'Lawan Waktu', desc: `Batas ${st.seconds} detik per soal. Jawab cepat untuk bonus poin dan XP.`, meta: 'Mulai ▶' })}
        ${modeCard({ mode: 'daily', ico: '📅', title: 'Tantangan Harian', desc: '10 soal yang sama sepanjang hari ini. Bonus XP untuk penyelesaian pertama.', meta: done ? '✓ Sudah selesai hari ini, main lagi ▶' : 'Mulai ▶', cls: 'amb' })}
        ${modeCard({ mode: 'wrong', ico: '🔁', title: 'Latihan Soal Salah', desc: wn ? `${wn} soal yang pernah kamu jawab salah menunggu diulang.` : 'Soal yang pernah salah akan muncul di sini.', meta: wn ? 'Mulai ▶' : 'Belum ada soal', cls: 'pur', disabled: !wn })}
      </div>
      <div class="tile sp3">
        <div class="flex items-center between g3">
          <div class="min0"><div class="t12 fw8 c-white">Jumlah soal per permainan</div><div class="t11 c-g400">Untuk Kuis Acak, Lawan Waktu, dan Latihan Soal Salah</div></div>
          <div class="stepper big"><button data-act="count" data-d="-1" aria-label="Kurangi jumlah soal">−</button>
            <span class="t14 fw9 c-white mono" style="min-width:28px;text-align:center" aria-live="polite">${st.count}</span>
            <button data-act="count" data-d="1" aria-label="Tambah jumlah soal">＋</button></div>
        </div>
        <div class="flex items-center between g3">
          <label class="t12 fw8 c-white" for="sel-seconds">Batas waktu per soal</label>
          <select id="sel-seconds" class="inp" data-change="seconds" style="width:auto">${secOpts}</select>
        </div>
        ${tog('shuffleQ', 'Acak urutan soal', 'Soal tampil dalam urutan acak setiap permainan')}
        ${tog('shuffleO', 'Acak urutan pilihan jawaban', 'Posisi jawaban benar berubah setiap kali')}
      </div></section>`;
  }

  function filteredDecks() {
    const q = ui.search.trim().toLowerCase();
    return allDecks().filter((d) => {
      if (ui.cat === 'Buatanku') { if (d.builtin) return false; }
      else if (ui.cat !== 'Semua' && d.category !== ui.cat) return false;
      return !q || `${d.title} ${d.category} ${d.desc}`.toLowerCase().includes(q);
    });
  }
  const libCountText = () => `${filteredDecks().length} dari ${allDecks().length} kuis`;

  function libraryCard() {
    const cats = ['Semua', 'Buatanku'].concat(categoryList());
    const pills = cats.map((c) => `<button class="pill${ui.cat === c ? ' on' : ''}" data-act="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('');
    return `<section class="card sp4" aria-labelledby="h-lib">
      <div class="flex between items-center wrap g3">
        <div><h2 id="h-lib" class="t18 fw9 c-white">Perpustakaan Kuis</h2><p class="t12 c-g400" id="lib-count">${libCountText()}</p></div>
        <div class="flex g2"><button class="btn sm b-dk" data-act="deck-import">⬆ Impor</button><button class="btn sm b-ac2" data-act="deck-new">${canEdit() ? '＋' : '🔒'} Buat Kuis</button></div>
      </div>
      <input id="q-search" class="inp" type="search" placeholder="Cari judul, kategori, atau deskripsi" value="${esc(ui.search)}" aria-label="Cari kuis" autocomplete="off">
      <div class="flex g2 xscroll no-scrollbar" role="group" aria-label="Filter kategori">${pills}</div>
      <div id="deck-grid">${deckGrid()}</div></section>`;
  }

  function deckGrid() {
    const list = filteredDecks();
    if (!list.length) {
      return `<div class="tile dash sp2"><div class="t24" aria-hidden="true">🔎</div><div class="t13 fw8 c-white">Tidak ada kuis yang cocok</div>
        <div class="t12 c-g400">Ubah kata kunci atau kategori, atau buat kuis baru.</div></div>`;
    }
    return `<div class="grid cols2">${list.map(deckCard).join('')}</div>`;
  }

  function deckCard(d) {
    const best = P().bestByDeck[d.id], id = esc(d.id);
    let acts = d.builtin
      ? `<button class="btn xs b-line" data-act="deck-copy" data-id="${id}">⎘ Salin &amp; edit</button>`
      : `<button class="btn xs b-line" data-act="deck-edit" data-id="${id}">✎ Edit</button>`;
    acts += `<button class="btn xs b-line" data-act="deck-export" data-id="${id}">⬇ Ekspor</button>`;
    if (!d.builtin) acts += `<button class="btn xs b-rd" data-act="deck-del" data-id="${id}">🗑 Hapus</button>`;
    return `<article class="deck-card">
      <div class="sp3">
        <div class="flex items-start between g3"><span class="iconbox" style="background:var(--ac2-15)" aria-hidden="true">${esc(d.icon)}</span><span class="chip ac">${esc(d.category)}</span></div>
        <div><h3 class="t16 fw9 c-white break">${esc(d.title)}</h3><p class="t12 c-g400 clamp2 mt1 lh">${esc(d.desc || 'Tanpa deskripsi.')}</p></div>
        <div class="flex wrap g2"><span class="chip">${d.questions.length} soal</span>${best ? `<span class="chip em">Rekor ${best.pct}%</span>` : ''}${d.builtin ? '<span class="chip am">Bawaan</span>' : ''}</div>
      </div>
      <div class="sp2 mt4">
        <div class="flex g2"><button class="btn b-ac2 flex1" data-act="deck-play" data-id="${id}">▶ Main</button>
          <button class="btn b-dk" data-act="deck-timed" data-id="${id}" title="Main dengan batas waktu" aria-label="Main dengan batas waktu">⏱</button></div>
        <div class="flex g2 wrap">${acts}</div>
      </div></article>`;
  }

  function rankCard() {
    const list = Core.ranking(S);
    const rows = list.map((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || String(i + 1);
      return `<li class="rank-row${i < 3 ? ' top' : ''}${r.p.id === S.activeId ? ' me' : ''}">
        <span class="t14 fw9 c-g400 tc" style="width:24px" aria-label="Peringkat ${i + 1}">${medal}</span>
        ${avatarHTML(r.p, 'xs')}
        <div class="min0 flex1"><div class="t12 fw8 c-white trunc">${esc(r.p.name)}</div><div class="t11 c-g400 trunc">Level ${r.level} • ${r.p.stats.games} kuis • ${r.acc}% akurat</div></div>
        <span class="t12 fw9 c-ac mono">${fmt(r.p.xp)} XP</span></li>`;
    }).join('');
    return `<section class="card sp3" aria-labelledby="h-rank">
      <div><h2 id="h-rank" class="t18 fw9 c-white">Papan Peringkat</h2><p class="t12 c-g400">Pengguna di perangkat ini, diurutkan menurut total XP.</p></div>
      <ol class="sp2" style="list-style:none">${rows}</ol>
      ${list.length < 2 ? '<p class="t11 c-g400 lh">Tambahkan pengguna lain lewat Profil Pengguna → Ganti Pengguna untuk bersaing di perangkat yang sama.</p>' : ''}
    </section>`;
  }

  function recentCard() {
    const h = P().history.slice(0, 5);
    const body = h.length ? h.map((x) => `<div class="tile flex items-center between g3">
        <div class="min0"><div class="t12 fw8 c-white trunc">${esc(x.title)}</div><div class="t11 c-g400 trunc">${esc(MODE_LABEL[x.mode] || 'Kuis')} • ${Core.fmtDateTime(x.ts)}</div></div>
        <div class="tr shrink0"><div class="t13 fw9 c-white">${x.correct}/${x.total}</div><div class="t11 c-em">+${x.xp} XP</div></div></div>`).join('')
      : `<div class="tile dash"><div class="t13 fw8 c-white">Belum ada permainan</div><div class="t12 c-g400 mt1">Mulai satu kuis dan hasilnya muncul di sini.</div></div>`;
    return `<section class="card sp3" aria-labelledby="h-recent"><div class="flex items-center between g3"><h2 id="h-recent" class="t18 fw9 c-white">Permainan Terakhir</h2>
      ${P().history.length ? '<button class="b-link" data-act="tab-go" data-tab="riwayat">Semua ›</button>' : ''}</div><div class="sp2">${body}</div></section>`;
  }

  /* ───────────── SEGMEN: PROFIL PENGGUNA ───────────── */
  function viewProfile() {
    const p = P(), lv = Core.levelInfo(p.xp);
    const unlocked = shownFrames().filter((f) => Core.frameUnlocked(p, f)).length;
    const achN = Object.keys(p.ach).filter((k) => Core.ACH.some((a) => a.id === k)).length;
    const tabs = [
      ['ringkasan', '📊', 'Ringkasan', ''],
      ['bingkai', '🖼️', 'Bingkai', `${unlocked}/${shownFrames().length}`],
      ['pencapaian', '🏅', 'Pencapaian', `${achN}/${Core.ACH.length}`],
      ['riwayat', '🕘', 'Riwayat', String(p.history.length)],
      ['tema', '🎨', 'Tema', ''],
      ['data', '💾', 'Data', '']
    ].map((t) => `<button class="tab${ui.tab === t[0] ? ' on' : ''}" role="tab" aria-selected="${ui.tab === t[0]}" data-act="tab" data-tab="${t[0]}">
        <span aria-hidden="true">${t[1]}</span>${t[2]}${t[3] ? `<span class="count ac">${t[3]}</span>` : ''}</button>`).join('');
    const panels = { ringkasan: panelSummary, bingkai: panelFrames, pencapaian: panelAch, riwayat: panelHistory, tema: panelTheme, data: panelData };
    const chips = bchip('⭐', 'Level', lv.level) + bchip('✨', 'Total XP', fmt(p.xp));
    return `<main class="page sp5">
      ${banner('👤', 'Profil Pengguna', 'Atur identitas, lihat statistik, pasang bingkai dan tema, lalu cadangkan datamu.', chips)}
      <section class="card" aria-label="Identitas">
        <div class="flex wrap items-center g5">
          <div class="avatar-slot">${avatarHTML(p, 'lg')}</div>
          <div class="flex1 min0 sp2" style="min-width:220px">
            <div class="flex items-center wrap g2"><h2 class="t24 fw9 c-white break">${esc(p.name)}</h2><span class="chip ac">Level ${lv.level}</span></div>
            ${p.greeting ? `<p class="t14 fw8 c-ac lh break">👋 ${esc(p.greeting)}</p>` : ''}
            <p class="t13 c-g400 lh break">${p.bio ? esc(p.bio) : 'Belum ada bio. Pilih Edit Profil untuk menambahkannya.'}</p>
            <div class="flex wrap g2"><span class="chip">📅 Bergabung ${Core.fmtDate(p.created)}</span><span class="chip am">🔥 ${p.days.streak} hari beruntun</span></div>
            <div><div class="flex between t11 c-g400" style="margin-bottom:4px"><span>Menuju Level ${lv.level + 1}</span><span class="mono">${fmt(lv.cur)} / ${fmt(lv.need)} XP</span></div>
              <div class="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${lv.pct}"><i style="width:${lv.pct}%"></i></div></div>
          </div>
          <div class="flex col g2" style="min-width:170px">
            <button class="btn b-ac2" data-act="prof-edit">✎ Edit Profil</button>
            <button class="btn b-dk" data-act="prof-switch">⇄ Ganti Pengguna</button>
          </div>
        </div></section>
      <section class="card flat" style="padding:0;overflow:hidden" aria-label="Detail profil">
        <div class="tabs" role="tablist">${tabs}</div>
        <div style="padding:20px">${(panels[ui.tab] || panelSummary)()}</div></section>
    </main>`;
  }

  function panelSummary() {
    const p = P(), s = p.stats;
    const acc = s.answered ? Math.round(s.correct / s.answered * 100) : 0;
    const tile = (label, val, sub) => `<div class="tile"><div class="t11 c-g400">${label}</div><div class="stat-v">${val}</div>${sub ? `<div class="t11 c-g400 mt1">${sub}</div>` : ''}</div>`;
    const tiles = tile('Kuis selesai', fmt(s.games)) + tile('Soal dijawab', fmt(s.answered), `${fmt(s.correct)} benar`) +
      tile('Akurasi', acc + '%') + tile('Benar beruntun terbaik', s.bestStreak) +
      tile('Hari beruntun', p.days.streak, `Terbaik ${p.days.best} hari`) + tile('Total waktu main', Core.fmtDuration(s.timeMs));

    const days = [], counts = {};
    p.history.forEach((h) => { const k = Core.todayKey(new Date(h.ts)); counts[k] = (counts[k] || 0) + 1; });
    for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ k: Core.todayKey(d), n: d.getDate() }); }
    const max = Math.max(1, ...days.map((d) => counts[d.k] || 0));
    const bars = days.map((d) => { const n = counts[d.k] || 0; return `<div><i class="${n ? 'on' : ''}" style="height:${n ? Math.max(10, Math.round(n / max * 100)) : 0}%" title="${d.k}: ${n} kuis"></i></div>`; }).join('');
    const lbls = days.map((d) => `<span>${d.n}</span>`).join('');

    const decks = Object.keys(p.bestByDeck).sort((a, b) => p.bestByDeck[b].plays - p.bestByDeck[a].plays).slice(0, 8);
    const deckRows = decks.length ? decks.map((k) => { const b = p.bestByDeck[k]; return `<div>
        <div class="flex between g3 t12"><span class="c-white fw8 trunc">${esc(deckKeyLabel(k))}</span><span class="c-g400 shrink0">${b.pct}% terbaik • ${b.plays}×</span></div>
        <div class="meter mt1" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${b.pct}"><i style="width:${b.pct}%"></i></div></div>`; }).join('')
      : '<p class="t12 c-g400">Selesaikan satu kuis untuk melihat rekor per kuis.</p>';

    const wn = wrongMap().n;
    return `<div class="sp5">
      <div class="grid auto-fit">${tiles}</div>
      <div class="tile sp3"><div class="flex between items-center"><h3 class="t14 fw9 c-white">Aktivitas 14 hari terakhir</h3><span class="t11 c-g400">kuis per hari</span></div>
        <div class="act" role="img" aria-label="Grafik jumlah kuis selama 14 hari terakhir">${bars}</div><div class="act-lbl">${lbls}</div></div>
      <div class="tile sp3"><h3 class="t14 fw9 c-white">Rekor per kuis</h3><div class="sp3">${deckRows}</div></div>
      <div class="tile flex items-center between g3 wrap"><div class="min0"><div class="t13 fw8 c-white">Soal yang perlu diulang</div>
        <div class="t12 c-g400">${wn ? `${wn} soal pernah salah dan belum kamu jawab benar.` : 'Belum ada soal yang perlu diulang.'}</div></div>
        <button class="btn sm b-pu" data-act="mode" data-mode="wrong"${wn ? '' : ' disabled'}>🔁 Latihan sekarang</button></div>
    </div>`;
  }

  function frameTile(p, f) {
    const ok = Core.frameUnlocked(p, f), eq = p.frame === f.id;
    const req = f.web ? (ok ? f.req : 'Terbuka lewat akun: ' + f.req)
      : (f.ach ? 'Buka dengan pencapaian ' + (Core.ACH.find((a) => a.id === f.ach) || { name: '' }).name : (f.level > 1 ? 'Buka di Level ' + f.level : 'Tersedia sejak awal'));
    const btn = eq ? '<span class="chip ac">✓ Sedang dipakai</span>'
      : ok ? `<button class="btn sm b-ac" data-act="frame-set" data-id="${f.id}">Pakai bingkai</button>`
        : '<span class="chip">🔒 Terkunci</span>';
    return `<div class="frame-tile${eq ? ' eq' : ''}${ok ? '' : ' locked'}">
        <div class="flex items-center g3"><div style="padding-top:10px">${avatarHTML(p, 'md', f.id)}</div>
          <div class="min0"><div class="t13 fw9 c-white">${esc(f.name)}</div><div class="t11 c-g400">${esc(req)}</div></div></div>${btn}</div>`;
  }

  function panelFrames() {
    const p = P();
    const local = Core.FRAMES.filter((f) => !f.web).map((f) => frameTile(p, f)).join('');
    if (!BOOT) {
      return `<div class="sp4"><p class="t12 c-g400 lh">Bingkai terbuka seiring naiknya level atau lewat pencapaian tertentu. Pilih satu untuk dipakai di seluruh aplikasi.</p><div class="grid auto-fit">${local}</div></div>`;
    }
    const web = Core.FRAMES.filter((f) => f.web);
    const n = web.filter((f) => Core.frameUnlocked(p, f)).length;
    return `<div class="sp5">
      <div class="sp3"><div><h3 class="t14 fw9 c-white">Bingkai akun PlayMuzeck <span class="chip ac">${n}/${web.length}</span></h3>
        <p class="t12 c-g400 lh mt1">Bingkai yang kamu buka di situs ikut terbawa. Daftar ini diperbarui setiap kali kamu mengunduh ulang berkas dari situs.</p></div>
        <div class="grid auto-fit">${web.map((f) => frameTile(p, f)).join('')}</div></div>
      <div class="sp3"><div><h3 class="t14 fw9 c-white">Bingkai level</h3>
        <p class="t12 c-g400 lh mt1">Terbuka seiring naiknya level atau lewat pencapaian di berkas ini.</p></div>
        <div class="grid auto-fit">${local}</div></div></div>`;
  }

  function panelAch() {
    const p = P();
    const tiles = Core.ACH.map((a) => {
      const at = p.ach[a.id];
      return at ? `<div class="tile hl sp1"><div class="flex items-center g3"><span class="iconbox" style="background:var(--ac2-20)" aria-hidden="true">${a.icon}</span>
          <div class="min0"><div class="t13 fw9 c-white">${a.name}</div><div class="t11 c-g300">${a.desc}</div></div></div>
          <div class="flex g2 wrap mt2"><span class="chip em">✓ ${Core.fmtDate(at)}</span><span class="chip ac">+${a.xp} XP</span></div></div>`
        : `<div class="tile dash sp1"><div class="t24" aria-hidden="true" style="opacity:.5">🔒</div><div class="t13 fw9 c-white">${a.name}</div><div class="t11 c-g400">${a.desc}</div>
          <div class="mt2"><span class="chip">+${a.xp} XP</span></div></div>`;
    }).join('');
    return `<div class="grid auto-fit">${tiles}</div>`;
  }

  function panelHistory() {
    const h = P().history;
    if (!h.length) return `<div class="tile dash sp2"><div class="t24" aria-hidden="true">🕘</div><div class="t13 fw8 c-white">Riwayat masih kosong</div><div class="t12 c-g400">Setiap kuis yang selesai dicatat di sini (maksimal 60 terakhir).</div>
      <button class="btn sm b-ac2" data-act="go" data-view="quiz">Ke Pusat Kuis</button></div>`;
    const rows = h.map((x) => {
      const pct = x.total ? Math.round(x.correct / x.total * 100) : 0;
      return `<div class="tile flex items-center between g3 wrap"><div class="min0"><div class="t13 fw8 c-white trunc">${esc(x.title)}</div>
        <div class="flex wrap g2 mt1"><span class="chip">${esc(MODE_LABEL[x.mode] || 'Kuis')}</span><span class="t11 c-g400">${Core.fmtDateTime(x.ts)} • ${Core.fmtDuration(x.ms)}</span></div></div>
        <div class="tr shrink0"><div class="t14 fw9 c-white">${x.correct}/${x.total} <span class="t11 c-g400">(${pct}%)</span></div><div class="t11 c-em">${fmt(x.points)} poin • +${x.xp} XP</div></div></div>`;
    }).join('');
    return `<div class="sp3"><div class="flex end"><button class="btn sm b-rd" data-act="history-clear">🗑 Hapus riwayat</button></div>${rows}</div>`;
  }

  /* — Tema — */
  const COLOR_KEYS = [['accent', 'Warna aksen'], ['accent2', 'Warna aksen kedua'], ['bg', 'Warna latar'], ['surface', 'Warna permukaan kartu']];

  function contrastHTML() {
    const r = Theme.resolve(Theme.get()), v = Theme.derive(r);
    const row = (label, a, b) => {
      const c = Theme.contrast(Theme.hexToRgb(a), Theme.hexToRgb(b)), ok = c >= 4.5;
      return `<span class="chip ${ok ? 'em' : 'am'}">${ok ? '✓' : '⚠'} ${label} ${c.toFixed(1)}:1</span>`;
    };
    return row('Teks pada tombol aksen', r.accent, v['--t-on-accent']) + row('Teks pada tombol aksen kedua', r.accent2, v['--t-on-accent2']) + row('Teks utama', r.bg, v['--t-fg']);
  }

  function panelTheme() {
    const t = Theme.get(), r = Theme.resolve(t);
    const cards = Theme.PRESETS.map((pr) => {
      const c = pr[r.mode];
      return `<button class="theme-card${t.preset === pr.id ? ' on' : ''}" data-act="theme-preset" data-id="${pr.id}">
        <div class="flex g1" aria-hidden="true">${[c.bg, c.surface, pr.accent, pr.accent2].map((x) => `<span class="swatch" style="background:${x}"></span>`).join('')}</div>
        <div class="t12 fw9 c-white mt2">${pr.name}</div><div class="t11 c-g400">${pr.note}</div></button>`;
    }).join('');
    const customCard = `<button class="theme-card${t.preset === 'custom' ? ' on' : ''}" data-act="theme-preset" data-id="custom">
        <div class="flex g1" aria-hidden="true">${[t.custom.bg, t.custom.surface, t.custom.accent, t.custom.accent2].map((x) => `<span class="swatch" style="background:${x}"></span>`).join('')}</div>
        <div class="t12 fw9 c-white mt2">Kustom</div><div class="t11 c-g400">Pilih warnamu sendiri</div></button>`;
    let editor = '';
    if (t.preset === 'custom') {
      editor = `<div class="sp3"><h3 class="t14 fw9 c-white">Warna kustom</h3>
        <div class="grid cols2">${COLOR_KEYS.map(([k, label]) => {
          const hex = t.custom[k], rgb = Theme.hexToRgb(hex);
          return `<div class="tile" data-ckeywrap="${k}"><div class="flex items-center between g3 wrap"><span class="t12 fw8 c-white">${label}</span><span class="mono t11 c-g400" data-hex>${hex}</span></div>
            <div class="grid" style="grid-template-columns:1.4fr 1fr 1fr 1fr;gap:8px;align-items:end;margin-top:8px">
              <input type="color" class="color-input" data-ckey="${k}" data-c="hex" value="${hex}" aria-label="${label}">
              ${['Merah', 'Hijau', 'Biru'].map((n, i) => `<input class="rgb-in" type="number" min="0" max="255" inputmode="numeric" data-ckey="${k}" data-c="${i}" value="${rgb[i]}" aria-label="${label}: ${n}">`).join('')}
            </div></div>`;
        }).join('')}</div>
        <div><div class="t11 c-g400" style="margin-bottom:6px">Kontras (target 4,5:1 agar mudah dibaca)</div><div class="flex wrap g2" id="contrast-info">${contrastHTML()}</div></div></div>`;
    }
    return `<div class="sp5">
      <div class="sp2"><h3 class="t14 fw9 c-white">Mode tampilan</h3>
        <div class="seg seg-2" style="max-width:340px"><button class="${r.mode === 'dark' ? 'on' : ''}" data-act="theme-mode" data-mode="dark">🌙 Gelap</button><button class="${r.mode === 'light' ? 'on' : ''}" data-act="theme-mode" data-mode="light">☀️ Terang</button></div>
        ${t.preset === 'custom' ? '<p class="t11 c-g400 lh">Pada tema Kustom, mode mengikuti kecerahan warna latar. Memilih mode memasang latar bawaan mode tersebut.</p>' : ''}</div>
      <div class="sp2"><h3 class="t14 fw9 c-white">Tema warna</h3><div class="grid sm3">${cards}${customCard}</div></div>
      ${editor}</div>`;
  }

  function panelData() {
    const p = P(), kb = (Core.usageBytes(S) / 1024).toFixed(1);
    return `<div class="sp3">
      <div class="tile flex items-center between g3 wrap"><div class="min0"><div class="t13 fw8 c-white">Ekspor cadangan</div><div class="t12 c-g400">Simpan semua pengguna, kuis buatan, pengaturan, dan tema ke satu berkas JSON.</div></div>
        <button class="btn sm b-ac2" data-act="data-export">⬇ Ekspor semua</button></div>
      <div class="tile flex items-center between g3 wrap"><div class="min0"><div class="t13 fw8 c-white">Impor cadangan</div><div class="t12 c-g400">Memulihkan berkas cadangan dan mengganti seluruh data saat ini.</div></div>
        <button class="btn sm b-dk" data-act="data-import">⬆ Impor cadangan</button></div>
      <div class="tile flex items-center between g3 wrap"><div class="min0"><div class="t13 fw8 c-white">Atur ulang profil ${esc(p.name)}</div><div class="t12 c-g400">Menghapus XP, statistik, riwayat, dan pencapaian profil ini. Nama dan foto tetap.</div></div>
        <button class="btn sm b-rd" data-act="data-reset">↺ Atur ulang</button></div>
      <div class="tile flex items-center between g3 wrap"><div class="min0"><div class="t13 fw8 c-white">Hapus semua data</div><div class="t12 c-g400">Mengosongkan seluruh data aplikasi di peramban ini, termasuk kuis buatan dan tema.</div></div>
        <button class="btn sm b-rd" data-act="data-wipe">🗑 Hapus semua</button></div>
      <p class="t11 c-g400">Penyimpanan terpakai ≈ ${kb} KB. Data hanya tersimpan di peramban ini, jadi lakukan ekspor secara berkala.</p></div>`;
  }

  /* ───────────── Modal: kerangka ───────────── */
  function dlgWrap(o) {
    return `<div class="ov"${o.bd ? ' data-bd="1"' : ''}><div class="dlg ${o.size}" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
      <div class="dlg-h"><div class="min0"><div class="t16 fw9 c-white trunc">${esc(o.title)}</div>${o.sub ? `<div class="t11 c-g400 trunc">${esc(o.sub)}</div>` : ''}</div>
        <div class="flex items-center g2 shrink0">${o.right || ''}<button class="xbtn" data-act="${o.close}" aria-label="Tutup">✕</button></div></div>
      ${o.pre || ''}<div class="dlg-b sp4" id="dlg-body">${o.body}</div>
      ${o.foot !== undefined ? `<div class="dlg-f"${o.footId ? ` id="${o.footId}"` : ''}>${o.foot}</div>` : ''}</div></div>`;
  }

  function renderModal() {
    let html = '';
    if (ui.editor) html = editorModal();
    else if (ui.play) html = playerModal();
    else if (ui.modal) html = ui.modal.type === 'switch' ? switchModal() : editProfileModal();
    $modal.innerHTML = html;
    document.body.classList.toggle('modal-open', !!(html || ui.confirm));
    if (ui.focusModal && html) {
      const d = $modal.querySelector('.dlg');
      if (d) { d.setAttribute('tabindex', '-1'); d.focus({ preventScroll: true }); }
      ui.focusModal = false;
    }
  }
  function closeModal() { ui.modal = null; renderModal(); }

  function ask(o, fn) { ui.confirm = Object.assign({ fn }, o); renderConfirm(); }
  function renderConfirm() {
    const c = ui.confirm;
    $conf.innerHTML = c ? `<div class="ov hi" role="alertdialog" aria-modal="true" aria-label="${esc(c.title)}"><div class="dlg sm">
      <div class="dlg-b sp3"><h3 class="t16 fw9 c-white">${esc(c.title)}</h3><p class="t13 c-g300 lh">${esc(c.msg)}</p></div>
      <div class="dlg-f"><button class="btn b-dk" data-act="confirm-cancel">Batal</button><button class="btn ${c.danger ? 'b-rd' : 'b-ac2'}" data-act="confirm-ok">${esc(c.ok || 'Lanjutkan')}</button></div></div></div>` : '';
    document.body.classList.toggle('modal-open', !!(c || $modal.innerHTML));
    if (c) { const b = $conf.querySelector('[data-act="confirm-cancel"]'); if (b) b.focus(); }
  }
  function closeConfirm() { ui.confirm = null; renderConfirm(); }

  /* ───────────── Pemutar kuis ───────────── */
  function makeCfg(mode, deckId, timed) {
    const st = S.settings;
    const cfg = { mode, title: 'Kuis Acak', deckKey: 'mix', decks: allDecks(), count: st.count, shuffleQ: st.shuffleQ, shuffleO: st.shuffleO, timed: false, seconds: st.seconds };
    if (mode === 'timed') { cfg.timed = true; cfg.title = 'Lawan Waktu'; }
    else if (mode === 'daily') {
      cfg.title = 'Tantangan Harian'; cfg.deckKey = 'daily'; cfg.decks = BUILTIN; cfg.count = 10;
      cfg.shuffleQ = true; cfg.shuffleO = true; cfg.rnd = Core.mulberry32(Core.hashStr('pm-daily-' + Core.todayKey()));
    } else if (mode === 'wrong') { cfg.title = 'Latihan Soal Salah'; cfg.deckKey = 'wrong'; cfg.only = wrongMap().ids; }
    else if (mode === 'deck') {
      const d = deckById(deckId);
      if (d) { cfg.decks = [d]; cfg.title = d.title; cfg.deckKey = d.id; cfg.count = 0; cfg.timed = !!timed; }
    }
    return cfg;
  }

  function openSession(s, rebuild) {
    if (!s.items.length) { toast('Belum ada soal untuk dimainkan.', true); return; }
    stopTimer();
    ui.menu = false;
    ui.play = { s, rebuild, i: 0, answers: [], sel: null, revealed: false, qStart: Date.now(), timer: null, done: false, result: null };
    ui.focusModal = true;
    render(); renderModal(); startTimer();
  }
  function startMode(mode, deckId, timed) {
    if (mode === 'wrong' && !wrongMap().n) { toast('Belum ada soal yang pernah salah.', true); return; }
    const mk = () => makeCfg(mode, deckId, timed);
    openSession(Core.buildSession(mk()), mk);
  }
  function playAgain() {
    const pl = ui.play; if (!pl) return;
    const rb = pl.rebuild, s = Core.buildSession(rb());
    if (!s.items.length) { toast('Belum ada soal untuk dimainkan.', true); return; }
    ui.play = { s, rebuild: rb, i: 0, answers: [], sel: null, revealed: false, qStart: Date.now(), timer: null, done: false, result: null };
    renderModal(); startTimer();
  }
  function retryWrong() {
    const pl = ui.play, only = {};
    pl.s.items.forEach((it, i) => { if (!pl.answers[i].correct) only[it.qid] = 1; });
    const mk = () => ({ mode: 'wrong', title: 'Ulangi Soal Salah', deckKey: 'wrong', decks: allDecks(), only, count: 0, shuffleQ: S.settings.shuffleQ, shuffleO: S.settings.shuffleO, timed: false, seconds: S.settings.seconds });
    const s = Core.buildSession(mk());
    stopTimer();
    ui.play = { s, rebuild: mk, i: 0, answers: [], sel: null, revealed: false, qStart: Date.now(), timer: null, done: false, result: null };
    renderModal();
  }

  function stopTimer() { if (ui.play && ui.play.timer) { clearInterval(ui.play.timer); ui.play.timer = null; } }
  function startTimer() {
    const pl = ui.play; stopTimer();
    if (!pl || !pl.s.timed || pl.revealed || pl.done) return;
    const end = pl.qStart + pl.s.seconds * 1000;
    pl.timer = setInterval(() => {
      const left = end - Date.now();
      if (left <= 0) { stopTimer(); commit(null); return; }
      const tp = document.getElementById('tp'), pill = document.getElementById('tpill');
      if (tp) tp.textContent = String(Math.ceil(left / 1000));
      if (pill) pill.classList.toggle('hot', left <= 5000);
    }, 200);
  }

  function commit(idx) {
    const pl = ui.play;
    if (!pl || pl.done || pl.revealed) return;
    stopTimer();
    const it = pl.s.items[pl.i], ms = Date.now() - pl.qStart, limit = pl.s.timed ? pl.s.seconds * 1000 : 0;
    const correct = idx !== null && idx === it.correct;
    const sc = Core.scoreAnswer(pl.s, correct, pl.s.timed ? Math.max(0, limit - ms) : 0);
    pl.answers[pl.i] = { sel: idx, correct, ms: pl.s.timed ? Math.min(ms, limit) : ms, points: sc.points, xp: sc.xp };
    pl.sel = idx; pl.revealed = true;
    playDynamic();
  }
  function nextQ() {
    const pl = ui.play;
    if (!pl || !pl.revealed) return;
    if (pl.i + 1 >= pl.s.items.length) { finishPlay(); return; }
    pl.i++; pl.sel = null; pl.revealed = false; pl.qStart = Date.now();
    renderModal(); startTimer();
  }
  function finishPlay() {
    const pl = ui.play;
    pl.result = Core.finalize(P(), pl.s, pl.answers);
    pl.done = true;
    save(); renderModal(); render();
  }
  function closePlay() { stopTimer(); ui.play = null; renderModal(); render(); }
  function askClosePlay() {
    if (!ui.play) return;
    if (ui.play.done) { closePlay(); return; }
    ask({ title: 'Keluar dari kuis?', msg: 'Progres permainan ini tidak akan disimpan dan XP tidak bertambah.', ok: 'Keluar', danger: true }, closePlay);
  }

  const mediaHTML = (m) => {
    if (!m) return '';
    const u = esc(m.url);
    const src = m.source && Core.safeUrl(m.source) ? ` <a href="${esc(m.source)}" target="_blank" rel="noopener noreferrer" class="c-ac">Sumber</a>` : '';
    const cr = m.credit ? `<div class="t11 c-g400 lh" style="margin-top:6px">${esc(m.credit)}${src}</div>` : '';
    if (m.type === 'image') return `<div class="media-box"><img src="${u}" alt="Gambar untuk soal ini" referrerpolicy="no-referrer"></div>${cr}`;
    if (m.type === 'audio') return `<div class="media-box"><audio controls preload="none" src="${u}"></audio></div>${cr}`;
    if (m.type === 'video') return `<div class="media-box"><video controls preload="metadata" playsinline src="${u}"></video></div>${cr}`;
    return '';
  };

  function optsHTML(pl, it) {
    return it.options.map((o, i) => {
      let cls = 'q-opt', mark = '';
      if (pl.revealed) {
        if (i === it.correct) { cls += ' ok'; mark = '<span aria-hidden="true">✓</span>'; }
        else if (i === pl.sel) { cls += ' bad'; mark = '<span aria-hidden="true">✗</span>'; }
        else cls += ' dim';
      }
      return `<button class="${cls}" data-act="opt" data-i="${i}"${pl.revealed ? ' disabled' : ''}>
        <span class="flex items-center g3 min0"><span class="lt">${LET[i]}</span><span class="t14">${esc(o)}</span></span>${mark}</button>`;
    }).join('');
  }
  function fbHTML(pl, it) {
    if (!pl.revealed) return '';
    const a = pl.answers[pl.i];
    const head = a.correct ? `✓ Benar!${a.points ? ` +${a.points} poin` : ''}` : (pl.sel === null ? '⏰ Waktu habis' : '✗ Kurang tepat');
    return `<div class="expl" role="status"><div class="t13 fw9 ${a.correct ? 'c-em' : 'c-rd'}">${head}</div>
      ${a.correct ? '' : `<p class="t12 c-g400 mt2">Jawaban benar: <b class="c-white">${LET[it.correct]}. ${esc(it.options[it.correct])}</b></p>`}
      ${it.explain ? `<p class="t12 c-g300 lh mt2">${esc(it.explain)}</p>` : ''}</div>`;
  }
  function footHTML(pl) {
    const score = pl.answers.reduce((n, a) => n + (a ? a.points : 0), 0);
    const last = pl.i + 1 >= pl.s.items.length;
    return `<span class="t12 c-g300">Skor: <b class="c-white">${fmt(score)}</b> poin</span>` + (pl.revealed
      ? `<button class="btn b-ac2" data-act="next">${last ? 'Lihat hasil ✓' : 'Soal berikutnya ▶'}</button>`
      : `<span class="t11 c-g400 hide-sm">Tekan 1–${pl.s.items[pl.i].options.length} atau A–${LET[pl.s.items[pl.i].options.length - 1]}</span>`);
  }
  const barPct = (pl) => Math.round((pl.i + (pl.revealed ? 1 : 0)) / pl.s.items.length * 100);

  function playDynamic() {
    const pl = ui.play;
    if (!pl || pl.done) return;
    const it = pl.s.items[pl.i];
    const set = (id, html) => { const e = $modal.querySelector(id); if (e) e.innerHTML = html; };
    set('#pl-opts', optsHTML(pl, it)); set('#pl-fb', fbHTML(pl, it)); set('#pl-foot', footHTML(pl));
    const bar = $modal.querySelector('#pl-bar'); if (bar) bar.style.width = barPct(pl) + '%';
    const pill = $modal.querySelector('#tpill'); if (pill) pill.classList.remove('hot');
  }

  function playerModal() {
    const pl = ui.play;
    if (pl.done) return resultModal();
    const s = pl.s, it = s.items[pl.i];
    const timer = s.timed ? `<span class="tpill" id="tpill">⏱ <b id="tp">${s.seconds}</b> dtk</span>` : '';
    return dlgWrap({
      size: 'lg', title: s.title, sub: `Soal ${pl.i + 1} dari ${s.items.length} • ${it.deckTitle}`, right: timer, close: 'play-close',
      pre: `<div class="q-bar"><i id="pl-bar" style="width:${barPct(pl)}%"></i></div>`,
      body: `<div class="q-text">${esc(it.text)}</div>${mediaHTML(it.media)}<div class="sp2" id="pl-opts">${optsHTML(pl, it)}</div><div id="pl-fb">${fbHTML(pl, it)}</div>`,
      foot: footHTML(pl), footId: 'pl-foot'
    });
  }

  function resultModal() {
    const pl = ui.play, r = pl.result, s = pl.s;
    const pct = Math.round(r.acc * 100);
    const emoji = r.acc === 1 ? '🏆' : r.acc >= 0.8 ? '🎉' : r.acc >= 0.6 ? '👍' : r.acc >= 0.4 ? '💪' : '📚';
    const msg = r.acc === 1 ? 'Sempurna! Semua jawabanmu benar.' : r.acc >= 0.8 ? 'Hebat, hampir sempurna.' : r.acc >= 0.6 ? 'Bagus. Sedikit lagi menuju sempurna.' : r.acc >= 0.4 ? 'Lumayan. Ulangi soal yang salah supaya makin hafal.' : 'Tetap semangat. Coba ulangi soal yang salah.';
    const stat = (l, v) => `<div class="tile tc"><div class="t11 c-g400">${l}</div><div class="stat-v">${v}</div></div>`;
    const review = s.items.map((it, i) => {
      const a = pl.answers[i], ok = a.correct;
      const opts = it.options.map((o, j) => `<div class="rev-opt${j === it.correct ? ' c' : (j === a.sel ? ' w' : '')}"><span class="lt">${LET[j]}</span><span class="min0 break">${esc(o)}</span>${j === it.correct ? '<span class="shrink0" style="margin-left:auto">✓</span>' : (j === a.sel ? '<span class="shrink0" style="margin-left:auto">✗</span>' : '')}</div>`).join('');
      return `<div class="rev ${ok ? 'good' : 'bad'}"><div class="t12 c-g400">Soal ${i + 1} • ${ok ? 'Benar' : (a.sel === null ? 'Waktu habis' : 'Salah')}</div>
        <div class="t13 fw8 c-white mt1 break">${esc(it.text)}</div>${opts}${it.explain ? `<p class="t12 c-g300 lh mt2">${esc(it.explain)}</p>` : ''}</div>`;
    }).join('');
    const lvUp = r.levelTo > r.levelFrom ? `<div class="alert ok">🎉 Naik level! Kamu sekarang Level ${r.levelTo}.</div>` : '';
    const ach = r.newAch.length ? `<div class="grad-note sp2"><div class="t13 fw9 c-white">Pencapaian baru</div>${r.newAch.map((a) => `<div class="t12 c-g300">${a.icon} <b class="c-white">${a.name}</b> • +${a.xp} XP</div>`).join('')}</div>` : '';
    const bonus = [];
    if (r.acc >= 0.6) bonus.push('bonus selesai +20'); if (r.perfect) bonus.push('bonus sempurna +30'); if (r.dailyBonus) bonus.push('bonus harian +' + r.dailyBonus);
    return dlgWrap({
      size: 'lg', title: 'Hasil Kuis', sub: s.title, close: 'play-close',
      body: `<div class="result-hero"><div class="t30" aria-hidden="true">${emoji}</div><div class="result-score">${r.correct}/${r.total}</div>
          <div class="t13 c-g300 mt1">${pct}% akurat • ${msg}</div>
          <div class="flex center wrap g2 mt3"><span class="chip ac">${fmt(r.points)} poin</span><span class="chip em">+${r.xp} XP</span></div>
          ${bonus.length ? `<div class="t11 c-g400 mt2">Termasuk ${bonus.join(', ')}</div>` : ''}</div>
        ${lvUp}${ach}
        <div class="grid cols4 sm4">${stat('Benar', r.correct)}${stat('Salah', r.wrong)}${stat('Waktu', Core.fmtDuration(r.ms))}${stat('Beruntun', r.bestRun)}</div>
        <div class="sp2"><h3 class="t14 fw9 c-white">Pembahasan</h3>${review}</div>`,
      foot: `<button class="btn b-dk" data-act="play-close">Tutup</button><div class="flex g2 wrap end">${r.wrong ? '<button class="btn b-pu" data-act="play-retry">🔁 Ulangi soal salah</button>' : ''}<button class="btn b-ac2" data-act="play-again">▶ Main lagi</button></div>`
    });
  }

  /* ───────────── Editor kuis ───────────── */
  const blankQ = () => ({ id: '', text: '', options: ['', '', '', ''], answer: 0, explain: '', mtype: '', murl: '' });
  function draftFrom(d, asCopy) {
    return {
      id: asCopy ? null : d.id, created: asCopy ? null : d.created,
      title: asCopy ? d.title + ' (salinan)' : d.title, desc: d.desc, category: d.category, icon: d.icon,
      questions: d.questions.map((q) => {
        const o = q.options.slice(); while (o.length < 4) o.push('');
        return { id: asCopy ? '' : q.id, text: q.text, options: o, answer: q.answer, explain: q.explain || '', mtype: q.media ? q.media.type : '', murl: q.media ? q.media.url : '' };
      })
    };
  }
  function openEditor(draft) {
    ui.editor = { draft, error: '' }; ui.menu = false; ui.focusModal = true;
    render(); renderModal();
  }
  function syncEditor() {
    const ed = ui.editor; if (!ed) return;
    const v = (sel) => { const e = $modal.querySelector(sel); return e ? e.value : ''; };
    const d = ed.draft;
    d.title = v('[data-f="title"]'); d.category = v('[data-f="category"]'); d.desc = v('[data-f="desc"]'); d.icon = v('[data-f="icon"]');
    d.questions = Array.from($modal.querySelectorAll('.qbox')).map((b) => {
      const chk = b.querySelector('input[type="radio"]:checked'), val = (f) => (b.querySelector(`[data-f="${f}"]`) || {}).value || '';
      return {
        id: b.getAttribute('data-qid') || '', text: val('text'),
        options: Array.from(b.querySelectorAll('[data-f="opt"]')).map((e) => e.value),
        answer: chk ? +chk.value : 0, explain: val('explain'), mtype: val('mtype'), murl: val('murl')
      };
    });
  }
  function rerenderEditor(keepScroll) {
    const body = $modal.querySelector('#dlg-body'), top = body ? body.scrollTop : 0;
    renderModal();
    const nb = $modal.querySelector('#dlg-body'); if (nb) nb.scrollTop = keepScroll ? top : 0;
  }

  function qBox(q, i, total) {
    const opts = q.options.map((o, j) => `<div class="flex items-center g2"><input type="radio" name="ans-${i}" value="${j}"${q.answer === j ? ' checked' : ''} aria-label="Jadikan ${LET[j]} jawaban benar">
        <span class="t12 fw8 c-g400" style="width:14px" aria-hidden="true">${LET[j]}</span>
        <input class="inp flex1" data-f="opt" maxlength="200" placeholder="Pilihan ${LET[j]}${j < 2 ? '' : ' (opsional)'}" value="${esc(o)}" aria-label="Pilihan ${LET[j]}"></div>`).join('');
    const mt = (v, l) => `<option value="${v}"${q.mtype === v ? ' selected' : ''}>${l}</option>`;
    return `<div class="box sp3 qbox" data-qid="${esc(q.id)}">
      <div class="flex items-center between"><b class="t13 c-white">Soal ${i + 1}</b>${total > 1 ? `<button class="btn xs b-rd" data-act="ed-del" data-i="${i}">🗑 Hapus soal</button>` : ''}</div>
      <div><label class="lbl">Pertanyaan</label><textarea class="inp" rows="2" maxlength="500" data-f="text" placeholder="Tulis pertanyaan di sini">${esc(q.text)}</textarea></div>
      <div class="grid" style="grid-template-columns:130px 1fr;gap:8px"><select class="inp" data-f="mtype" aria-label="Jenis media">${mt('', 'Tanpa media')}${mt('image', 'Gambar')}${mt('audio', 'Audio')}${mt('video', 'Video')}</select>
        <input class="inp" data-f="murl" placeholder="URL media (https://…)" value="${esc(q.murl)}" aria-label="URL media"></div>
      <div><div class="lbl">Pilihan jawaban <span class="c-g400" style="font-weight:400">(pilih bulat di sebelah jawaban yang benar)</span></div><div class="sp2">${opts}</div></div>
      <div><label class="lbl">Pembahasan (opsional)</label><input class="inp" maxlength="400" data-f="explain" placeholder="Penjelasan singkat setelah soal dijawab" value="${esc(q.explain)}"></div></div>`;
  }

  function editorModal() {
    const ed = ui.editor, d = ed.draft;
    const icons = ICONS.includes(d.icon) ? ICONS : [d.icon].concat(ICONS);
    const cats = categoryList().map((c) => `<option value="${esc(c)}"></option>`).join('');
    return dlgWrap({
      size: 'xl', title: d.id ? 'Sunting Kuis' : 'Buat Kuis Baru', sub: `${d.questions.length} soal`, close: 'ed-close',
      body: `${ed.error ? `<div class="alert err" role="alert">${esc(ed.error)}</div>` : ''}
        <div class="grid sm2">
          <div><label class="lbl" for="ed-title">Judul kuis</label><input id="ed-title" class="inp" data-f="title" maxlength="80" placeholder="Misal: Musik Tahun 90-an" value="${esc(d.title)}"></div>
          <div><label class="lbl" for="ed-cat">Kategori</label><input id="ed-cat" class="inp" data-f="category" list="cat-list" maxlength="24" placeholder="Umum" value="${esc(d.category)}"><datalist id="cat-list">${cats}</datalist></div>
        </div>
        <div class="grid" style="grid-template-columns:1fr 110px;gap:16px">
          <div><label class="lbl" for="ed-desc">Deskripsi</label><textarea id="ed-desc" class="inp" data-f="desc" rows="2" maxlength="200" placeholder="Ceritakan singkat isi kuis ini">${esc(d.desc)}</textarea></div>
          <div><label class="lbl" for="ed-icon">Ikon</label><select id="ed-icon" class="inp" data-f="icon">${icons.map((i) => `<option value="${esc(i)}"${i === d.icon ? ' selected' : ''}>${esc(i)}</option>`).join('')}</select></div>
        </div>
        ${d.questions.map((q, i) => qBox(q, i, d.questions.length)).join('')}`,
      foot: `<button class="btn b-dk" data-act="ed-add"${d.questions.length >= 200 ? ' disabled' : ''}>＋ Tambah soal</button><div class="flex g2"><button class="btn b-dk" data-act="ed-close">Batal</button><button class="btn b-ac2" data-act="ed-save">Simpan kuis</button></div>`
    });
  }

  function saveEditor() {
    syncEditor();
    const ed = ui.editor, d = ed.draft;
    const fail = (m) => { ed.error = m; rerenderEditor(false); };
    for (let i = 0; i < d.questions.length; i++) {
      const q = d.questions[i];
      if (q.mtype && !Core.safeUrl(q.murl)) { fail(`Soal #${i + 1}: URL media harus diawali http:// atau https://.`); return; }
    }
    const old = d.id ? S.decks.find((x) => x.id === d.id) : null;
    let deck;
    try {
      deck = Core.sanitizeDeck({
        id: d.id || undefined, created: old ? old.created : undefined, title: d.title, desc: d.desc, category: d.category, icon: d.icon,
        questions: d.questions.map((q) => ({ id: q.id || undefined, text: q.text, options: q.options, answer: q.answer, explain: q.explain, media: q.mtype ? { type: q.mtype, url: q.murl } : null }))
      }, true);
    } catch (e) { fail(e.message); return; }
    let ach = [];
    if (old) S.decks[S.decks.indexOf(old)] = deck;
    else { S.decks.push(deck); const p = P(); p.stats.decksMade++; ach = Core.evalAch(p); ui.cat = 'Semua'; ui.search = ''; }
    ui.editor = null;
    save(); render(); renderModal();
    toast(ach.length ? `Kuis disimpan. Pencapaian baru: ${ach.map((a) => a.icon + ' ' + a.name).join(', ')}` : 'Kuis disimpan.');
  }
  function askCloseEditor() {
    ask({ title: 'Tutup editor?', msg: 'Perubahan yang belum disimpan akan hilang.', ok: 'Tutup tanpa menyimpan', danger: true }, () => { ui.editor = null; renderModal(); });
  }

  function purgeDeck(id) {
    S.decks = S.decks.filter((d) => d.id !== id);
    Object.keys(S.profiles).forEach((k) => {
      const p = S.profiles[k];
      delete p.bestByDeck[id];
      Object.keys(p.wrong).forEach((q) => { if (p.wrong[q] === id) delete p.wrong[q]; });
    });
  }

  /* ───────────── Modal profil ───────────── */
  function openEditProfile() {
    const p = P();
    ui.modal = { type: 'edit', name: p.name, bio: p.bio, greeting: p.greeting || '', avatar: p.avatar, shape: p.shape };
    ui.focusModal = true; renderModal();
  }
  function syncProfileModal() {
    const m = ui.modal; if (!m || m.type !== 'edit') return;
    const n = $modal.querySelector('#pf-name'), b = $modal.querySelector('#pf-bio'), g = $modal.querySelector('#pf-greet');
    if (n) m.name = n.value; if (b) m.bio = b.value; if (g) m.greeting = g.value;
  }
  function editProfileModal() {
    const m = ui.modal, tmp = Object.assign({}, P(), { name: m.name || P().name, avatar: m.avatar, shape: m.shape });
    return dlgWrap({
      size: 'md', title: 'Edit Profil', sub: 'Nama, foto, dan bio', close: 'modal-close', bd: true,
      body: `<div class="flex items-center g4 wrap"><div class="avatar-slot">${avatarHTML(tmp, 'lg')}</div>
          <div class="flex col g2"><button class="btn sm b-dk" data-act="avatar-pick">📷 Unggah foto</button><button class="btn sm b-line" data-act="avatar-clear"${m.avatar ? '' : ' disabled'}>Hapus foto</button></div></div>
        <div><label class="lbl" for="pf-name">Nama tampilan</label><input id="pf-name" class="inp" maxlength="24" value="${esc(m.name)}" placeholder="Nama kamu"></div>
        <div><label class="lbl" for="pf-bio">Bio singkat</label><textarea id="pf-bio" class="inp" rows="3" maxlength="120" placeholder="Misal: suka musik klasik dan dangdut">${esc(m.bio)}</textarea></div>
        <div><label class="lbl" for="pf-greet">Sapaan</label><input id="pf-greet" class="inp" maxlength="160" value="${esc(m.greeting)}" placeholder="Misal: Halo {nama}!"><p class="t11 c-g400 mt1">Tulis {nama} untuk menyisipkan namamu.</p></div>
        <div><div class="lbl">Bentuk foto</div><div class="seg seg-2"><button class="${m.shape === 'sq' ? 'on' : ''}" data-act="shape" data-v="sq">Persegi</button><button class="${m.shape === 'rnd' ? 'on' : ''}" data-act="shape" data-v="rnd">Bulat</button></div></div>`,
      foot: '<button class="btn b-dk" data-act="modal-close">Batal</button><button class="btn b-ac2" data-act="prof-save">Simpan profil</button>'
    });
  }
  function saveProfile() {
    syncProfileModal();
    const m = ui.modal, name = m.name.trim();
    if (!name) { toast('Nama tidak boleh kosong.', true); return; }
    const p = P();
    p.name = name.slice(0, 24); p.bio = m.bio.trim().slice(0, 120); p.avatar = m.avatar; p.shape = m.shape;
    p.greeting = String(m.greeting || '').replace(/\{nama\}/gi, p.name).trim().slice(0, 160);
    ui.modal = null; save(); render(); renderModal(); toast('Profil diperbarui.');
  }
  function processAvatar(file, cb) {
    if (!file || !/^image\//.test(file.type)) { toast('Pilih berkas gambar (JPG, PNG, atau WebP).', true); return; }
    const fr = new FileReader();
    fr.onerror = () => toast('Gambar tidak bisa dibaca.', true);
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => toast('Gambar tidak bisa dibaca.', true);
      img.onload = () => {
        const size = 160, c = document.createElement('canvas'), m = Math.min(img.width, img.height);
        c.width = c.height = size;
        c.getContext('2d').drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, size, size);
        cb(c.toDataURL('image/jpeg', 0.85));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  }

  function openSwitch() { ui.modal = { type: 'switch' }; ui.focusModal = true; renderModal(); }
  function switchModal() {
    const rows = Core.ranking(S).map((r) => {
      const act = r.p.id === S.activeId;
      return `<div class="tile flex items-center g3">${avatarHTML(r.p, 'sm')}
        <div class="min0 flex1"><div class="t13 fw8 c-white trunc">${esc(r.p.name)}</div><div class="t11 c-g400">Level ${r.level} • ${fmt(r.p.xp)} XP</div></div>
        ${act ? '<span class="chip em">✓ Aktif</span>' : `<button class="btn xs b-ac2" data-act="prof-pick" data-id="${esc(r.p.id)}">Pakai</button>`}
        ${Object.keys(S.profiles).length > 1 ? `<button class="btn xs b-rd" data-act="prof-del" data-id="${esc(r.p.id)}" aria-label="Hapus ${esc(r.p.name)}">🗑</button>` : ''}</div>`;
    }).join('');
    return dlgWrap({
      size: 'md', title: 'Ganti Pengguna', sub: 'Setiap pengguna punya XP, statistik, dan riwayat sendiri', close: 'modal-close', bd: true,
      body: `<div class="sp2">${rows}</div>
        <div><label class="lbl" for="new-name">Tambah pengguna baru</label>
          <div class="flex g2"><input id="new-name" class="inp" maxlength="24" placeholder="Nama pengguna"><button class="btn b-ac2 shrink0" data-act="prof-add">＋ Tambah</button></div></div>`,
      foot: '<span></span><button class="btn b-dk" data-act="modal-close">Selesai</button>'
    });
  }

  /* ───────────── Aksi ───────────── */
  function doReset() {
    const old = P(), np = Core.newProfile(old.name);
    np.id = old.id; np.avatar = old.avatar; np.shape = old.shape; np.bio = old.bio; np.created = old.created;
    np.frame = old.frame; np.greeting = old.greeting; np.acct = old.acct; np.webStamp = old.webStamp;
    S.profiles[old.id] = np; save(); render(); toast('Profil diatur ulang.');
  }

  function onClick(e) {
    const bd = e.target;
    if (bd.classList && bd.classList.contains('ov') && bd.hasAttribute('data-bd')) { closeModal(); return; }
    const closeMenu = ui.menu && !e.target.closest('[data-menuwrap]');
    const t = e.target.closest('[data-act]');
    if (closeMenu) { ui.menu = false; render(); }
    if (!t) return;
    const act = t.getAttribute('data-act'), id = t.getAttribute('data-id');
    switch (act) {
      case 'go': ui.view = t.getAttribute('data-view'); ui.menu = false; render(); window.scrollTo(0, 0); break;
      case 'menu': ui.menu = !ui.menu; render(); break;
      case 'tab': ui.tab = t.getAttribute('data-tab'); render(); break;
      case 'tab-go': ui.view = 'profile'; ui.tab = t.getAttribute('data-tab'); render(); window.scrollTo(0, 0); break;

      /* Pusat Kuis */
      case 'mode': startMode(t.getAttribute('data-mode')); break;
      case 'count': S.settings.count = Core.clamp(S.settings.count + (+t.getAttribute('data-d')), 3, 30); save(); render(); break;
      case 'toggle': { const k = t.getAttribute('data-key'); S.settings[k] = !S.settings[k]; save(); render(); break; }
      case 'cat': ui.cat = t.getAttribute('data-v'); render(); break;
      case 'deck-play': startMode('deck', id, false); break;
      case 'deck-timed': startMode('deck', id, true); break;
      case 'deck-new': if (!canEdit()) { editorLocked(); break; } openEditor({ id: null, created: null, title: '', desc: '', category: 'Umum', icon: '🎵', questions: [blankQ()] }); break;
      case 'deck-edit': { if (!canEdit()) { editorLocked(); break; } const d = S.decks.find((x) => x.id === id); if (d) openEditor(draftFrom(d, false)); break; }
      case 'deck-copy': { if (!canEdit()) { editorLocked(); break; } const d = deckById(id); if (d) openEditor(draftFrom(d, true)); break; }
      case 'deck-export': { const d = deckById(id); if (d) download(`PlayMuzeck_Kuis_${slug(d.title)}.json`, Core.exportDeck(d)); break; }
      case 'deck-del': { const d = S.decks.find((x) => x.id === id); if (d) ask({ title: 'Hapus kuis ini?', msg: `"${d.title}" dan rekor mainnya akan dihapus permanen.`, ok: 'Hapus', danger: true }, () => { purgeDeck(id); save(); render(); toast('Kuis dihapus.'); }); break; }
      case 'deck-import': document.getElementById('file-deck').click(); break;

      /* Pemutar */
      case 'opt': commit(+t.getAttribute('data-i')); break;
      case 'next': nextQ(); break;
      case 'play-close': askClosePlay(); break;
      case 'play-again': playAgain(); break;
      case 'play-retry': retryWrong(); break;

      /* Editor */
      case 'ed-add': syncEditor(); ui.editor.draft.questions.push(blankQ()); ui.editor.error = ''; rerenderEditor(false); { const b = $modal.querySelector('#dlg-body'); if (b) b.scrollTop = b.scrollHeight; } break;
      case 'ed-del': syncEditor(); ui.editor.draft.questions.splice(+t.getAttribute('data-i'), 1); ui.editor.error = ''; rerenderEditor(true); break;
      case 'ed-save': saveEditor(); break;
      case 'ed-close': askCloseEditor(); break;

      /* Profil */
      case 'prof-edit': openEditProfile(); break;
      case 'prof-switch': openSwitch(); break;
      case 'prof-save': saveProfile(); break;
      case 'modal-close': closeModal(); break;
      case 'avatar-pick': syncProfileModal(); document.getElementById('file-avatar').click(); break;
      case 'avatar-clear': syncProfileModal(); ui.modal.avatar = null; renderModal(); break;
      case 'shape': syncProfileModal(); ui.modal.shape = t.getAttribute('data-v'); renderModal(); break;
      case 'prof-pick': S.activeId = id; save(); ui.modal = null; render(); renderModal(); toast('Beralih ke ' + P().name + '.'); break;
      case 'prof-add': {
        const inp = $modal.querySelector('#new-name');
        if (Object.keys(S.profiles).length >= 12) { toast('Maksimal 12 pengguna per perangkat.', true); break; }
        const name = (inp && inp.value.trim()) || 'Pemain ' + (Object.keys(S.profiles).length + 1);
        const np = Core.newProfile(name); S.profiles[np.id] = np; S.activeId = np.id;
        save(); ui.modal = null; render(); renderModal(); toast('Pengguna ' + np.name + ' ditambahkan.'); break;
      }
      case 'prof-del': {
        const p = S.profiles[id]; if (!p) break;
        ask({ title: 'Hapus pengguna ini?', msg: `Semua data milik "${p.name}" akan dihapus permanen.`, ok: 'Hapus', danger: true }, () => {
          delete S.profiles[id];
          if (S.activeId === id) S.activeId = Object.keys(S.profiles)[0];
          save(); render(); renderModal(); toast('Pengguna dihapus.');
        });
        break;
      }
      case 'frame-set': { const f = Core.frameOf(id), p = P(); if (Core.frameUnlocked(p, f)) { p.frame = f.id; save(); render(); toast('Bingkai ' + f.name + ' dipakai.'); } break; }
      case 'theme-mode': Theme.setMode(t.getAttribute('data-mode')); save(); render(); break;
      case 'theme-preset': Theme.setPreset(id); render(); break;
      case 'history-clear': ask({ title: 'Hapus riwayat?', msg: 'Riwayat permainan dihapus. XP, statistik, dan pencapaian tidak berubah.', ok: 'Hapus riwayat', danger: true }, () => { P().history = []; save(); render(); }); break;

      /* Data */
      case 'data-export': download(`PlayMuzeck_Cadangan_${Core.todayKey()}.json`, Core.exportAll(S, Theme.get())); toast('Cadangan diekspor.'); break;
      case 'data-import': document.getElementById('file-backup').click(); break;
      case 'data-reset': ask({ title: 'Atur ulang profil ini?', msg: 'XP, statistik, riwayat, dan pencapaian akan dikosongkan. Tindakan ini tidak bisa dibatalkan.', ok: 'Atur ulang', danger: true }, doReset); break;
      case 'data-wipe': ask({ title: 'Hapus semua data?', msg: 'Semua pengguna, kuis buatan, pengaturan, dan tema di peramban ini akan dihapus permanen.', ok: 'Hapus semua', danger: true }, () => {
        Core.wipe(); S = Core.defaultState(); Core.applyBoot(S); Theme.reset(); save(); ui.tab = 'ringkasan'; render(); toast('Semua data dihapus.');
      }); break;

      case 'confirm-ok': { const fn = ui.confirm && ui.confirm.fn; closeConfirm(); if (fn) fn(); break; }
      case 'confirm-cancel': closeConfirm(); break;
      default: break;
    }
  }

  function onInput(e) {
    const t = e.target;
    if (t.id === 'q-search') {
      ui.search = t.value;
      const g = document.getElementById('deck-grid'), c = document.getElementById('lib-count');
      if (g) g.innerHTML = deckGrid();
      if (c) c.textContent = libCountText();
      return;
    }
    const key = t.getAttribute && t.getAttribute('data-ckey');
    if (!key) return;
    const wrap = t.closest('[data-ckeywrap]');
    let hex;
    if (t.getAttribute('data-c') === 'hex') hex = t.value;
    else {
      const v = Array.from(wrap.querySelectorAll('.rgb-in')).map((x) => Core.clamp(parseInt(x.value, 10) || 0, 0, 255));
      hex = Theme.rgbToHex(v[0], v[1], v[2]);
    }
    Theme.setCustom(key, hex);
    const rgb = Theme.hexToRgb(hex);
    const h = wrap.querySelector('[data-hex]'); if (h) h.textContent = hex.toLowerCase();
    if (t.getAttribute('data-c') !== 'hex') { const ci = wrap.querySelector('input[type="color"]'); if (ci) ci.value = hex; }
    else wrap.querySelectorAll('.rgb-in').forEach((x, i) => { x.value = rgb[i]; });
    const ci = document.getElementById('contrast-info'); if (ci) ci.innerHTML = contrastHTML();
  }

  function onChange(e) {
    const t = e.target;
    if (t.getAttribute && t.getAttribute('data-change') === 'seconds') { S.settings.seconds = +t.value; save(); render(); return; }
    if (t.id === 'file-avatar') {
      const f = t.files && t.files[0]; t.value = '';
      if (f) processAvatar(f, (url) => { syncProfileModal(); if (ui.modal && ui.modal.type === 'edit') { ui.modal.avatar = url; renderModal(); } });
    } else if (t.id === 'file-deck') {
      readFile(t, (text) => {
        try {
          const decks = Core.parseDecks(text);
          decks.forEach((d) => S.decks.push(d));
          ui.cat = 'Semua'; ui.search = ''; save(); render();
          toast(decks.length === 1 ? `Kuis "${decks[0].title}" diimpor.` : `${decks.length} kuis diimpor.`);
        } catch (err) { toast(err.message, true); }
      });
    } else if (t.id === 'file-backup') {
      readFile(t, (text) => {
        let parsed;
        try { parsed = Core.parseBackup(text); } catch (err) { toast(err.message, true); return; }
        ask({ title: 'Pulihkan cadangan?', msg: 'Seluruh data saat ini akan diganti dengan isi berkas cadangan.', ok: 'Pulihkan', danger: true }, () => {
          S = parsed.state; if (parsed.theme) Theme.load(parsed.theme);
          save(); ui.tab = 'ringkasan'; render(); toast('Cadangan dipulihkan.');
        });
      });
    }
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      if (ui.confirm) { closeConfirm(); return; }
      if (ui.menu) { ui.menu = false; render(); return; }
      if (ui.editor) { askCloseEditor(); return; }
      if (ui.play) { askClosePlay(); return; }
      if (ui.modal) closeModal();
      return;
    }
    const pl = ui.play;
    if (!pl || ui.confirm || ui.editor || pl.done) return;
    if (/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return;
    if (!pl.revealed) {
      const k = e.key.toLowerCase();
      if (k.length !== 1) return;
      const idx = /^[1-6]$/.test(k) ? +k - 1 : 'abcdef'.indexOf(k);
      if (idx >= 0 && idx < pl.s.items[pl.i].options.length) { e.preventDefault(); commit(idx); }
    } else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); nextQ(); }
  }

  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('keydown', onKey);

  render();
})();
