/* src/standalone/standalone.core.js
   Logika murni (tanpa DOM) untuk Pusat Kuis + Profil Pengguna:
   penyimpanan, profil, XP/level, bingkai, pencapaian, pembuat sesi kuis, penilaian, impor/ekspor. */
(function (root) {
  'use strict';

  var KEY = 'playmuzeck.standalone.v1';
  var APP = 'PlayMuzeck_Quiz';
  var MEDIA_TYPES = ['image', 'audio', 'video'];

  /* ── Penyimpanan aman ── */
  var mem = {};
  var storageOK = null;

  function lsGet(k) {
    try { var v = root.localStorage.getItem(k); return v === null ? (mem[k] || null) : v; }
    catch (e) { return mem[k] || null; }
  }
  function lsSet(k, v) {
    mem[k] = v;
    try { root.localStorage.setItem(k, v); storageOK = true; return true; }
    catch (e) { storageOK = false; return false; }
  }
  function lsDel(k) {
    delete mem[k];
    try { root.localStorage.removeItem(k); } catch (e) { /* diabaikan */ }
  }
  function canStore() {
    if (storageOK !== null) return storageOK;
    try { root.localStorage.setItem('__pm_probe', '1'); root.localStorage.removeItem('__pm_probe'); storageOK = true; }
    catch (e) { storageOK = false; }
    return storageOK;
  }

  /* ── Utilitas ── */
  function clamp(n, a, b) { return Math.min(b, Math.max(a, n)); }
  function uid(prefix) { return (prefix || 'x') + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function todayKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function isDay(s) { return typeof s === 'string' && /^\d{4}-\d\d-\d\d$/.test(s); }
  function dayDiff(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }
  function hashStr(s) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rnd) {
    var a = arr.slice(); rnd = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString('id-ID'); }
  function fmtDuration(ms) {
    var s = Math.round((ms || 0) / 1000);
    if (s < 60) return s + ' dtk';
    var m = Math.floor(s / 60), r = s % 60;
    if (m < 60) return m + ' mnt' + (r ? ' ' + r + ' dtk' : '');
    var h = Math.floor(m / 60);
    return h + ' jam ' + (m % 60) + ' mnt';
  }
  function fmtDate(ts) {
    try { return new Date(ts).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch (e) { return ''; }
  }
  function fmtDateTime(ts) {
    try {
      return new Date(ts).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  function safeUrl(u) {
    u = String(u || '').trim();
    return /^(https?:\/\/|data:(image|audio|video)\/)/i.test(u) && u.length <= 400000 ? u : '';
  }
  function firstChars(s, n) { return Array.from(String(s || '')).slice(0, n).join(''); }

  /* ── XP & level ── */
  function xpForLevel(l) { return 40 * l * (l - 1); } /* total XP untuk mencapai level l */
  function levelInfo(xp) {
    xp = Math.max(0, xp || 0);
    var l = 1;
    while (xpForLevel(l + 1) <= xp) l++;
    var base = xpForLevel(l), next = xpForLevel(l + 1);
    return { level: l, cur: xp - base, need: next - base, pct: Math.min(100, Math.round((xp - base) / (next - base) * 100)), next: next };
  }

  /* ── Bingkai profil ── */
  var FRAMES = [
    { id: 'none', name: 'Polos', level: 1, bg: 'var(--w15)' },
    { id: 'bronze', name: 'Perunggu', level: 3, bg: 'linear-gradient(135deg,#92400e,#f59e0b 50%,#78350f)', badge: '🥉' },
    { id: 'silver', name: 'Perak', level: 6, bg: 'linear-gradient(135deg,#64748b,#f1f5f9 50%,#94a3b8)', badge: '🥈' },
    { id: 'gold', name: 'Emas', level: 10, bg: 'linear-gradient(135deg,#b45309,#fde047 50%,#f59e0b)', badge: '🥇', glow: true },
    { id: 'musik', name: 'Not Balok', ach: 'maker', bg: 'linear-gradient(135deg,var(--t-accent),var(--t-accent2))', badge: '🎵' },
    { id: 'neon', name: 'Neon', level: 15, bg: 'linear-gradient(135deg,#22d3ee,#a855f7,#ec4899)', glow: true, pill: 'NEON', pillBg: 'linear-gradient(90deg,#0891b2,#9333ea)' },
    { id: 'legend', name: 'Legenda', level: 20, bg: 'conic-gradient(from 0deg,#f43f5e,#f59e0b,#84cc16,#22d3ee,#8b5cf6,#f43f5e)', glow: true, badge: '👑', pill: 'LEGENDA', pillBg: 'linear-gradient(90deg,#be123c,#7c3aed)' }
  ];

  /* Bingkai akun PlayMuzeck (sama dengan situs). Terbuka lewat akun: donasi, kuis tema, lisensi, dst.
     Daftar yang terbuka dikirim situs saat berkas diunduh (PM_BOOT.unlockedFrameIds). */
  function wf(id, name, req, bg, badge, extra) {
    var f = { id: id, name: name, web: true, req: req, bg: bg, badge: badge };
    if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
    return f;
  }
  var WEB_FRAMES = [
    wf('frame-coffee', 'Seduhan Kafein', 'Donasi Secangkir Kopi (Rp 10.000)', 'linear-gradient(135deg,#451a03,#d97706 50%,#78350f)', '☕'),
    wf('frame-neon', 'Voltase Neon Kreatif', 'Donasi Energi Kreatif (Rp 25.000)', 'linear-gradient(135deg,#fca311,#fde047 50%,#b45309)', '⚡', { glow: true }),
    wf('frame-warp', 'Quantum Warp Grid', 'Donasi Server Boost (Rp 50.000)', 'linear-gradient(135deg,#0e7490,#67e8f9 50%,#0891b2)', '🌀', { glow: true }),
    wf('frame-sultan', 'Mahkota Imperial Sultan', 'Donasi Pendukung Sultan (Rp 100.000)', 'linear-gradient(135deg,#b45309,#fef08a 50%,#f59e0b)', '👑', { glow: true }),
    wf('frame-contact', 'Sinyal Resonansi Pengembang', 'Kirim masukan, ide, atau aduan ke pengembang', 'linear-gradient(135deg,#047857,#5eead4 50%,#059669)', '📡'),
    wf('frame-bundle', 'Hexaprima Omniverse', 'Miliki paket bundle lengkap 6 produk', 'linear-gradient(135deg,#ddd6fe,#ec4899 50%,#8b5cf6)', '💎', { glow: true }),
    wf('frame-olahraga', 'Gelora Arena Juara', 'Beli kuis tema Olahraga', 'linear-gradient(135deg,#064e3b,#34d399 50%,#10b981)', '⚽'),
    wf('frame-sehari-hari', 'Harmoni Graha Harian', 'Beli kuis tema Kehidupan Sehari-hari', 'linear-gradient(135deg,#451a03,#fcd34d 50%,#d97706)', '🏠'),
    wf('frame-alam', 'Biosfer Belantara Purba', 'Beli kuis tema Alam', 'linear-gradient(135deg,#052e16,#a3e635 50%,#16a34a)', '🌿'),
    wf('frame-musik', 'Resonansi Maestro Melodi', 'Beli kuis tema Musik', 'linear-gradient(135deg,#3b0764,#c4b5fd 50%,#9333ea)', '🎵', { glow: true }),
    wf('frame-matematika', 'Fraktal Geometri Kosmis', 'Beli kuis tema Matematika', 'linear-gradient(135deg,#172554,#7dd3fc 50%,#4f46e5)', '📐'),
    wf('frame-seni', 'Kanvas Avant-Garde', 'Beli kuis tema Seni', 'linear-gradient(135deg,#4c0519,#fda4af 50%,#e11d48)', '🎨'),
    wf('frame-teknologi', 'Matriks Sibernetik', 'Beli kuis tema Teknologi', 'linear-gradient(135deg,#042f2e,#67e8f9 50%,#0891b2)', '💻', { glow: true }),
    wf('frame-psikologi', 'Sinapsis Kognisi Jiwa', 'Beli kuis tema Psikologi', 'linear-gradient(135deg,#3b0764,#f0abfc 50%,#c026d3)', '🧠'),
    wf('frame-bahasa', 'Aksara Poliglot Dunia', 'Beli kuis tema Bahasa', 'linear-gradient(135deg,#042f2e,#5eead4 50%,#0d9488)', '🗣️'),
    wf('frame-sosial', 'Episentrum Sosiokultural', 'Beli kuis tema Sosial', 'linear-gradient(135deg,#431407,#fdba74 50%,#ea580c)', '👥'),
    wf('frame-fiksi', 'Mitologi Arkana Kosmik', 'Beli kuis tema Fiksi', 'linear-gradient(135deg,#1e1b4b,#a5b4fc 50%,#4f46e5)', '📖'),
    wf('frame-lainnya', 'Enigma Spektrum Semesta', 'Beli kuis tema Lainnya', 'linear-gradient(135deg,#422006,#fef08a 50%,#ca8a04)', '✨'),
    wf('frame-quiz-editor', 'Mahkota Arsitek Kuis', 'Beli lisensi Kuis Editor (Rp 10.000)', 'linear-gradient(135deg,#450a0a,#f87171 50%,#b91c1c)', '👑')
  ];
  FRAMES = FRAMES.concat(WEB_FRAMES);

  function frameOf(id) {
    for (var i = 0; i < FRAMES.length; i++) if (FRAMES[i].id === id) return FRAMES[i];
    return FRAMES[0];
  }

  /* ── Pencapaian ── */
  var ACH = [
    { id: 'first', icon: '🎯', name: 'Langkah Pertama', desc: 'Selesaikan 1 kuis.', xp: 20, test: function (p) { return p.stats.games >= 1; } },
    { id: 'regular', icon: '📚', name: 'Kutu Buku', desc: 'Selesaikan 10 kuis.', xp: 50, test: function (p) { return p.stats.games >= 10; } },
    { id: 'perfect', icon: '💯', name: 'Sempurna', desc: 'Raih 100% pada kuis minimal 5 soal.', xp: 60, test: function (p) { return p.stats.perfect >= 1; } },
    { id: 'hundred', icon: '🏆', name: 'Seratus Benar', desc: 'Jawab 100 soal dengan benar.', xp: 80, test: function (p) { return p.stats.correct >= 100; } },
    { id: 'streak5', icon: '🔥', name: 'Api Semangat', desc: 'Jawab 5 soal benar berturut-turut.', xp: 40, test: function (p) { return p.stats.bestStreak >= 5; } },
    { id: 'streak10', icon: '⚡', name: 'Tak Terhentikan', desc: 'Jawab 10 soal benar berturut-turut.', xp: 80, test: function (p) { return p.stats.bestStreak >= 10; } },
    { id: 'days3', icon: '📅', name: 'Konsisten', desc: 'Main 3 hari berturut-turut.', xp: 60, test: function (p) { return p.days.best >= 3; } },
    { id: 'daily', icon: '🌞', name: 'Penantang Harian', desc: 'Selesaikan Tantangan Harian.', xp: 30, test: function (p) { return p.stats.dailyDone >= 1; } },
    { id: 'maker', icon: '✍️', name: 'Kreator', desc: 'Buat 1 kuis sendiri.', xp: 40, test: function (p) { return p.stats.decksMade >= 1; } },
    { id: 'lv5', icon: '⭐', name: 'Naik Daun', desc: 'Capai level 5.', xp: 50, test: function (p) { return levelInfo(p.xp).level >= 5; } }
  ];
  function evalAch(p) {
    var got = [], again = true;
    while (again) {
      again = false;
      ACH.forEach(function (a) {
        if (!p.ach[a.id] && a.test(p)) { p.ach[a.id] = Date.now(); p.xp += a.xp; got.push(a); again = true; }
      });
    }
    return got;
  }
  function frameUnlocked(p, f) {
    if (f.web) return webFrames().indexOf(f.id) >= 0;
    if (f.ach) return !!p.ach[f.ach];
    return levelInfo(p.xp).level >= (f.level || 1);
  }

  /* ── Profil & status ── */
  function newProfile(name) {
    return {
      id: uid('p'), name: String(name || 'Pemain').trim().slice(0, 24) || 'Pemain', bio: '', greeting: '', acct: '', webStamp: 0, avatar: null, shape: 'sq', frame: 'none',
      created: Date.now(), xp: 0,
      stats: { games: 0, answered: 0, correct: 0, bestStreak: 0, perfect: 0, timeMs: 0, decksMade: 0, dailyDone: 0 },
      days: { last: null, streak: 0, best: 0 },
      history: [], wrong: {}, ach: {}, daily: { date: null }, bestByDeck: {}
    };
  }
  function isObj(o) { return o && typeof o === 'object' && !Array.isArray(o); }

  function fixProfile(raw) {
    var d = newProfile(raw && raw.name);
    if (!isObj(raw)) return d;
    if (typeof raw.id === 'string' && raw.id) d.id = raw.id.slice(0, 40);
    d.bio = String(raw.bio || '').slice(0, 120);
    d.greeting = String(raw.greeting || '').slice(0, 160);
    d.acct = typeof raw.acct === 'string' ? raw.acct.slice(0, 120) : '';
    d.webStamp = Math.max(0, +raw.webStamp || 0);
    d.avatar = typeof raw.avatar === 'string' && /^(data:image\/(jpeg|png|webp|gif);base64,|https:\/\/)/i.test(raw.avatar) ? raw.avatar : null;
    d.shape = raw.shape === 'rnd' ? 'rnd' : 'sq';
    d.frame = typeof raw.frame === 'string' ? raw.frame : 'none';
    d.created = +raw.created || d.created;
    d.xp = Math.max(0, +raw.xp || 0);
    var s = isObj(raw.stats) ? raw.stats : {};
    Object.keys(d.stats).forEach(function (k) { d.stats[k] = Math.max(0, +s[k] || 0); });
    var dy = isObj(raw.days) ? raw.days : {};
    d.days = { last: isDay(dy.last) ? dy.last : null, streak: Math.max(0, +dy.streak || 0), best: Math.max(0, +dy.best || 0) };
    d.history = (Array.isArray(raw.history) ? raw.history : []).filter(isObj).slice(0, 60);
    d.wrong = isObj(raw.wrong) ? raw.wrong : {};
    d.ach = isObj(raw.ach) ? raw.ach : {};
    d.daily = { date: isDay((raw.daily || {}).date) ? raw.daily.date : null };
    d.bestByDeck = isObj(raw.bestByDeck) ? raw.bestByDeck : {};
    return d;
  }

  function defaultSettings() { return { count: 10, seconds: 20, shuffleQ: true, shuffleO: true }; }

  function defaultState() {
    var p = newProfile('Pemain'), o = {};
    o[p.id] = p;
    return { v: 1, activeId: p.id, profiles: o, decks: [], seeded: [], settings: defaultSettings() };
  }

  function fixState(raw) {
    if (!isObj(raw)) return defaultState();
    var profiles = {}, n = 0;
    if (isObj(raw.profiles)) {
      Object.keys(raw.profiles).forEach(function (k) {
        var p = fixProfile(raw.profiles[k]);
        if (profiles[p.id]) p.id = uid('p');
        profiles[p.id] = p; n++;
      });
    }
    if (!n) { var p0 = newProfile('Pemain'); profiles[p0.id] = p0; }
    var activeId = profiles[raw.activeId] ? raw.activeId : Object.keys(profiles)[0];
    var decks = [];
    (Array.isArray(raw.decks) ? raw.decks : []).forEach(function (d) {
      try { decks.push(sanitizeDeck(d, true)); } catch (e) { /* lewati kuis rusak */ }
    });
    var st = isObj(raw.settings) ? raw.settings : {}, ds = defaultSettings();
    return {
      v: 1, activeId: activeId, profiles: profiles, decks: decks,
      seeded: (Array.isArray(raw.seeded) ? raw.seeded : []).filter(function (x) { return typeof x === 'string'; }).slice(0, 500),
      settings: {
        count: clamp(parseInt(st.count, 10) || ds.count, 3, 30),
        seconds: [10, 15, 20, 30, 45, 60].indexOf(+st.seconds) >= 0 ? +st.seconds : ds.seconds,
        shuffleQ: st.shuffleQ !== false, shuffleO: st.shuffleO !== false
      }
    };
  }

  function load() {
    var t = lsGet(KEY), S;
    if (!t) S = defaultState();
    else { try { S = fixState(JSON.parse(t)); } catch (e) { S = defaultState(); } }
    if (applyBoot(S)) save(S);
    return S;
  }
  function save(S) { return lsSet(KEY, JSON.stringify(S)); }
  function wipe() { lsDel(KEY); }
  function usageBytes(S) { try { return JSON.stringify(S).length; } catch (e) { return 0; } }

  /* ── Kuis: validasi & pembersihan ── */
  function sanitizeDeck(raw, keepId) {
    if (!isObj(raw)) throw new Error('Format kuis tidak valid.');
    var title = String(raw.title || '').trim().slice(0, 80);
    if (!title) throw new Error('Judul kuis belum diisi.');
    if (!Array.isArray(raw.questions) || !raw.questions.length) throw new Error('Kuis harus punya minimal 1 soal.');
    if (raw.questions.length > 200) throw new Error('Satu kuis maksimal 200 soal.');
    var seen = {};
    var qs = raw.questions.map(function (q, i) {
      var no = '#' + (i + 1);
      if (!isObj(q)) throw new Error('Soal ' + no + ' tidak valid.');
      var text = String(q.text || '').trim().slice(0, 500);
      if (!text) throw new Error('Soal ' + no + ' belum ada pertanyaannya.');
      var opts = (Array.isArray(q.options) ? q.options : []).map(function (o) { return String(o == null ? '' : o).trim().slice(0, 200); });
      var kept = [], newAns = -1;
      opts.forEach(function (o, idx) {
        if (!o) return;
        if (idx === +q.answer) newAns = kept.length;
        kept.push(o);
      });
      if (kept.length < 2) throw new Error('Soal ' + no + ' butuh minimal 2 pilihan jawaban yang terisi.');
      if (kept.length > 6) throw new Error('Soal ' + no + ' maksimal 6 pilihan jawaban.');
      if (newAns < 0) throw new Error('Soal ' + no + ': pilih jawaban benar dari pilihan yang terisi.');
      var media = null;
      if (isObj(q.media) && MEDIA_TYPES.indexOf(q.media.type) >= 0) {
        var u = safeUrl(q.media.url);
        if (u) media = { type: q.media.type, url: u };
      }
      var id = typeof q.id === 'string' && q.id ? q.id.slice(0, 60) : uid('q');
      if (seen[id]) id = uid('q');
      seen[id] = 1;
      return { id: id, text: text, options: kept, answer: newAns, explain: String(q.explain || '').trim().slice(0, 400), media: media };
    });
    return {
      id: keepId && typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 40) : uid('d'),
      builtin: false, title: title,
      desc: String(raw.desc || '').trim().slice(0, 200),
      category: String(raw.category || '').trim().slice(0, 24) || 'Umum',
      icon: firstChars(raw.icon, 2) || '🎵',
      created: +raw.created || Date.now(), updated: Date.now(),
      questions: qs
    };
  }

  /* ── Sesi kuis ── */
  function makeItem(d, q, shuffleO, rnd) {
    var order = q.options.map(function (_, i) { return i; });
    if (shuffleO) order = shuffle(order, rnd);
    return {
      deckId: d.id, deckTitle: d.title, qid: q.id, text: q.text, media: q.media || null, explain: q.explain || '',
      options: order.map(function (i) { return q.options[i]; }),
      correct: order.indexOf(q.answer)
    };
  }

  /* cfg: { mode, title, deckKey, decks[], only?{qid:1}, count (0 = semua), shuffleQ, shuffleO, timed, seconds, rnd? } */
  function buildSession(cfg) {
    var rnd = cfg.rnd || Math.random, pool = [];
    cfg.decks.forEach(function (d) {
      d.questions.forEach(function (q) { if (!cfg.only || cfg.only[q.id]) pool.push({ d: d, q: q }); });
    });
    if (cfg.shuffleQ !== false) pool = shuffle(pool, rnd);
    if (cfg.count > 0) pool = pool.slice(0, cfg.count);
    return {
      id: uid('s'), mode: cfg.mode, title: cfg.title, deckKey: cfg.deckKey || 'mix',
      timed: !!cfg.timed, seconds: cfg.seconds || 0,
      items: pool.map(function (x) { return makeItem(x.d, x.q, cfg.shuffleO !== false, rnd); })
    };
  }

  function scoreAnswer(session, correct, remainMs) {
    if (!correct) return { points: 0, xp: 0 };
    var pts = 100, xp = 10;
    if (session.timed && session.seconds > 0) {
      var f = clamp(remainMs / (session.seconds * 1000), 0, 1);
      pts += Math.round(50 * f); xp += Math.round(5 * f);
    }
    return { points: pts, xp: xp };
  }

  /* answers[i] = { sel, correct, ms, points, xp }. Memperbarui profil `p` langsung. */
  function finalize(p, session, answers) {
    var total = session.items.length, correct = 0, points = 0, xp = 0, ms = 0, run = 0, best = 0;
    var lvBefore = levelInfo(p.xp).level;

    answers.forEach(function (a, i) {
      var it = session.items[i];
      ms += a.ms || 0;
      if (a.correct) {
        correct++; run++; if (run > best) best = run;
        points += a.points; xp += a.xp;
        delete p.wrong[it.qid];
      } else {
        run = 0; p.wrong[it.qid] = it.deckId;
      }
    });
    var wk = Object.keys(p.wrong);
    if (wk.length > 300) wk.slice(0, wk.length - 300).forEach(function (k) { delete p.wrong[k]; });

    var acc = total ? correct / total : 0;
    var perfect = total >= 5 && correct === total;
    if (acc >= 0.6) xp += 20;
    if (perfect) xp += 30;

    var today = todayKey(), dailyBonus = 0;
    if (session.mode === 'daily' && p.daily.date !== today) {
      p.daily.date = today; dailyBonus = 25; xp += dailyBonus; p.stats.dailyDone++;
    }

    p.stats.games++; p.stats.answered += total; p.stats.correct += correct; p.stats.timeMs += ms;
    if (perfect) p.stats.perfect++;
    if (best > p.stats.bestStreak) p.stats.bestStreak = best;

    if (p.days.last !== today) {
      p.days.streak = (p.days.last && dayDiff(p.days.last, today) === 1) ? p.days.streak + 1 : 1;
      p.days.last = today;
      if (p.days.streak > p.days.best) p.days.best = p.days.streak;
    }

    var key = session.deckKey || 'mix';
    var b = p.bestByDeck[key] || { pct: 0, points: 0, plays: 0 };
    b.pct = Math.max(b.pct, Math.round(acc * 100));
    b.points = Math.max(b.points, points);
    b.plays++;
    p.bestByDeck[key] = b;

    p.xp += xp;
    p.history.unshift({ id: session.id, ts: Date.now(), mode: session.mode, title: session.title, deckKey: key, total: total, correct: correct, points: points, xp: xp, ms: ms });
    p.history = p.history.slice(0, 60);

    var newAch = evalAch(p);
    var lvAfter = levelInfo(p.xp).level;
    return {
      total: total, correct: correct, wrong: total - correct, acc: acc, points: points, xp: xp, dailyBonus: dailyBonus,
      ms: ms, bestRun: best, perfect: perfect, newAch: newAch, levelFrom: lvBefore, levelTo: lvAfter
    };
  }

  /* ── Data akun dari situs (PM_BOOT) ──
     Situs menyisipkan PM_BOOT saat berkas diunduh: identitas, bingkai terbuka, kuis buatan, dan hak Kuis Editor.
     Berkas hasil build statis (tanpa situs) memiliki PM_BOOT = null dan semua bagian ini dilewati. */
  function boot() { var b = root.PM_BOOT; return isObj(b) ? b : null; }
  function webFrames() {
    var b = boot();
    if (!b) return [];
    var l = Array.isArray(b.unlockedFrameIds) ? b.unlockedFrameIds.slice() : [];
    if (isObj(b.user) && b.user.frame) l.push(b.user.frame);
    return l;
  }
  function applyBoot(S) {
    var b = boot();
    if (!b || !isObj(b.user)) return false;
    var u = b.user, changed = false;
    var key = String(u.email || u.name || '').trim().toLowerCase().slice(0, 120);
    if (!key) return false;
    var stamp = +b.stamp || 0, p = null, ids = Object.keys(S.profiles);
    ids.forEach(function (k) { if (!p && S.profiles[k].acct === key) p = S.profiles[k]; });
    if (!p) {
      var only = ids.length === 1 ? S.profiles[ids[0]] : null;
      if (only && !only.acct && !only.xp && !only.stats.games && only.name === 'Pemain') p = only; /* pakai profil kosong bawaan */
      else { p = newProfile(u.name); S.profiles[p.id] = p; S.activeId = p.id; }
      p.acct = key; p.webStamp = 0; changed = true;
    }
    if (stamp > (p.webStamp || 0)) {
      p.name = String(u.name || p.name).trim().slice(0, 24) || p.name;
      p.bio = String(u.bio || '').trim().slice(0, 120);
      p.greeting = String(u.greeting || '').trim().slice(0, 160);
      if (typeof u.avatar === 'string' && /^(data:image\/(jpeg|png|webp|gif);base64,|https:\/\/)/i.test(u.avatar)) p.avatar = u.avatar;
      if (typeof u.frame === 'string' && u.frame) p.frame = u.frame;
      p.webStamp = stamp; changed = true;
    }
    var have = {};
    S.decks.forEach(function (d) { have[d.id] = 1; });
    (Array.isArray(b.userDecks) ? b.userDecks : []).forEach(function (d) {
      if (!isObj(d) || typeof d.id !== 'string' || S.seeded.indexOf(d.id) >= 0) return;
      if (S.seeded.length < 500) S.seeded.push(d.id);
      changed = true;
      if (have[d.id.slice(0, 40)]) return;
      try { S.decks.push(sanitizeDeck(d, true)); } catch (e) { /* lewati kuis rusak */ }
    });
    return changed;
  }

  /* ── Peringkat perangkat ── */
  function ranking(S) {
    return Object.keys(S.profiles).map(function (k) {
      var p = S.profiles[k];
      return { p: p, level: levelInfo(p.xp).level, acc: p.stats.answered ? Math.round(p.stats.correct / p.stats.answered * 100) : 0 };
    }).sort(function (a, b) { return b.p.xp - a.p.xp || b.p.stats.games - a.p.stats.games || a.p.created - b.p.created; });
  }

  /* ── Impor / ekspor ── */
  function exportAll(S, theme) {
    return JSON.stringify({ app: APP, type: 'backup', version: 1, exportedAt: new Date().toISOString(), state: S, theme: theme || null }, null, 2);
  }
  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { throw new Error('Berkas bukan JSON yang valid.'); }
  }
  function parseBackup(text) {
    var raw = parseJson(text);
    if (!isObj(raw) || raw.app !== APP || raw.type !== 'backup' || !isObj(raw.state)) throw new Error('Berkas ini bukan cadangan PlayMuzeck.');
    return { state: fixState(raw.state), theme: isObj(raw.theme) ? raw.theme : null };
  }
  function exportDeck(d) {
    return JSON.stringify({
      app: APP, type: 'deck', version: 1,
      deck: { title: d.title, desc: d.desc, category: d.category, icon: d.icon,
        questions: d.questions.map(function (q) { return { text: q.text, options: q.options, answer: q.answer, explain: q.explain, media: q.media || null }; }) }
    }, null, 2);
  }
  function parseDecks(text) {
    var raw = parseJson(text), list;
    if (isObj(raw) && raw.type === 'deck' && isObj(raw.deck)) list = [raw.deck];
    else if (Array.isArray(raw)) list = raw;
    else if (isObj(raw) && Array.isArray(raw.decks)) list = raw.decks;
    else if (isObj(raw) && Array.isArray(raw.questions)) list = [raw];
    else throw new Error('Format berkas kuis tidak dikenali.');
    if (!list.length) throw new Error('Berkas tidak berisi kuis.');
    return list.map(function (d) { return sanitizeDeck(d, false); });
  }

  var Core = {
    KEY: KEY, APP: APP, FRAMES: FRAMES, ACH: ACH, MEDIA_TYPES: MEDIA_TYPES,
    canStore: canStore, load: load, save: save, wipe: wipe, usageBytes: usageBytes,
    defaultState: defaultState, defaultSettings: defaultSettings, newProfile: newProfile, fixState: fixState,
    xpForLevel: xpForLevel, levelInfo: levelInfo, frameOf: frameOf, frameUnlocked: frameUnlocked, evalAch: evalAch,
    sanitizeDeck: sanitizeDeck, safeUrl: safeUrl, boot: boot, applyBoot: applyBoot, webFrames: webFrames,
    buildSession: buildSession, scoreAnswer: scoreAnswer, finalize: finalize, ranking: ranking,
    exportAll: exportAll, parseBackup: parseBackup, exportDeck: exportDeck, parseDecks: parseDecks,
    uid: uid, todayKey: todayKey, dayDiff: dayDiff, hashStr: hashStr, mulberry32: mulberry32, shuffle: shuffle, clamp: clamp,
    fmtNum: fmtNum, fmtDuration: fmtDuration, fmtDate: fmtDate, fmtDateTime: fmtDateTime
  };

  root.PMCore = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
