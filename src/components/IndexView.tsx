// src/components/IndexView.tsx
import React from 'react';
import { motion } from 'motion/react';
import {
  Headphones,
  Brain,
  Sliders,
  ArrowRight,
  CheckCircle2,
  Zap,
  Download,
  FolderLock,
  Layers,
  Wrench,
  Music,
  Users,
  ShieldCheck,
  MessageSquare,
  ChevronDown,
  UserPlus,
  MousePointerClick,
  Package,
} from 'lucide-react';
import { audioEngine } from '../services/audioEngine';

interface IndexViewProps {
  onNavigateAudio: () => void;
  onNavigateQuiz: () => void;
  onOpenProfile: () => void;
}

// Semua angka & klaim di bawah mengacu pada isi kode (DRUM_KITS, INSTRUMENTS_128, TOOLS, mode kuis, dsb).
const PROBLEMS = [
  {
    icon: Sliders,
    problem: 'Aplikasi musik terasa berat dan rumit?',
    solution:
      'Susun ritme dan progresi akor langsung di browser: 10 pad drum dengan 7 kit, 8 bank × 16 pad akor (128 akor) yang bisa kamu racik sendiri, 128 instrumen General MIDI, dan 4 track akor independen. Drum Pad dan Chord Pad gratis dicoba di Bar 1. Tanpa instalasi.',
  },
  {
    icon: Music,
    problem: 'Butuh musik untuk konten, tapi bingung soal lisensi?',
    solution:
      'Katalog lagu orisinal dengan lisensi komersial non-eksklusif. Beli hanya yang dibutuhkan: master, loop, stem, atau partitur.',
  },
  {
    icon: Wrench,
    problem: 'Hanya perlu edit audio cepat?',
    solution:
      '20 Audio Tools (potong, gabung, ulangi, volume, pitch, tempo, konversi, kompres, perekam, deteksi BPM, metronom, tuner, dan lainnya) diproses di perangkatmu. Setiap alat gratis dipakai 2 kali per hari.',
  },
  {
    icon: Brain,
    problem: 'Ingin belajar sambil bersenang-senang?',
    solution:
      'Pusat Kuis punya mode solo (bisa lawan bot), pass & play, host kuis, dan multiplayer online, lengkap dengan timer per soal.',
  },
];

const STEPS = [
  { icon: UserPlus, title: 'Buat akun gratis', desc: 'Masuk dengan Google atau email. Akun dibutuhkan untuk membuka Audio Studio dan Pusat Kuis.' },
  { icon: MousePointerClick, title: 'Pilih yang ingin dikerjakan', desc: 'Buat pola musik, olah berkas audio, atau langsung main kuis bersama teman.' },
  { icon: Package, title: 'Simpan atau unduh hasilnya', desc: 'Ekspor ke format yang kamu perlukan. Upgrade hanya bila memang butuh modul lengkap.' },
];

const AUDIO_POINTS = [
  { title: 'Pad Editor: drum & akor', desc: '10 pad drum dengan 7 kit, plus 8 bank × 16 pad akor (128 akor) yang formulanya bisa diubah (kualitas, tension, inversi, slash bass, oktaf). Drum Pad dan Chord Pad gratis di Bar 1.' },
  { title: '4 track akor, 128 instrumen GM', desc: 'Tiap track punya instrumen, volume, mute/solo, dan kurva ADSR sendiri. Suara memakai bank sampel SoundFont. Versi gratis: 1 track dengan Grand Piano.' },
  { title: 'Sequencer 16 bar, 11 birama', desc: 'Dari 2/4 sampai 12/8, tempo 60–200 BPM, dengan wilayah loop yang bisa diatur. Gratis: Bar 1, 3 kit drum, dan 1 track akor Grand Piano. Full 16-Bar Editor membuka 16 bar, 7 kit drum, 4 track akor dengan 128 instrumen, ekspor, serta simpan dan muat proyek.' },
  { title: 'Rekam live, dinamika, undo/redo', desc: 'Mainkan pad drum dan akor langsung ke sequencer, lengkap dengan hitung mundur dan metronom pengiring. Atur dinamika pukulan (pp sampai ff), lalu rapikan dengan undo/redo serta salin, potong, dan tempel.' },
  { title: 'Ekspor MIDI, WAV, MP3, M4A, FLAC', desc: 'Ekspor drum saja, akor saja, atau keduanya sekaligus. Format audio bisa diulang menjadi satu berkas loop. Proyek juga bisa disimpan dan dimuat lagi dari perangkatmu (berkas MIDI). Ekspor dan proyek termasuk Full 16-Bar Editor.' },
  { title: 'Stem mixer & 20 Audio Tools', desc: 'Potong, gabung, ulangi, volume, pitch, tempo, vokal isolator, konversi, kompres, edit metadata & cover, perekam, deteksi BPM & kunci, metronom, tuner, tes vocal range, dan latihan cocokkan nada.' },
];

const QUIZ_POINTS = [
  { title: '4 mode permainan', desc: 'Solo (opsional lawan bot), pass & play, host kuis hingga 10 regu, dan multiplayer online.' },
  { title: 'Belasan topik trivia', desc: 'Sains, sejarah, musik, seni, teknologi, kuliner, dan lainnya.' },
  { title: '3 starter deck bawaan', desc: 'Siap main begitu masuk. Deck topik tambahan tersedia di Perpustakaan.' },
  { title: 'Bisa dipasang & dimainkan luring', desc: 'Pasang sebagai PWA atau unduh berkas standalone. Multiplayer online tetap butuh internet.' },
  { title: 'Papan peringkat & riwayat hasil', desc: 'Peringkat pemain tampil langsung di setiap ronde multiplayer, dan hasil permainanmu tersimpan lengkap dengan tinjauan jawaban per soal.' },
];

const ECOSYSTEM = [
  { icon: Zap, color: 'text-accent', title: 'Tanpa instalasi', desc: 'Berjalan di browser ponsel maupun desktop, tanpa driver atau aplikasi berat.' },
  { icon: ShieldCheck, color: 'text-emerald-400', title: 'Audio diproses di perangkatmu', desc: 'Berkas yang kamu olah di Audio Tools dibaca dan diproses di browser, tidak diunggah ke server.' },
  { icon: Download, color: 'text-sky-400', title: 'Ekspor fleksibel', desc: 'MIDI, WAV, MP3, FLAC, atau M4A. M4A bergantung dukungan browser dan kadang menjadi .webm/.ogg.' },
  { icon: FolderLock, color: 'text-amber-300', title: 'Dasbor profil terpadu', desc: 'Koleksi lagu, album bingkai, tema, donasi sukarela, dan pengiriman masukan atau aduan.' },
];

const FAQ = [
  {
    q: 'Apa saja yang gratis dan apa yang berbayar?',
    a: 'Gratis: akun, 3 starter deck, Drum Pad dan Chord Pad di Bar 1 (3 kit drum, 1 track akor Grand Piano, rekam live, dinamika, undo/redo), dan 2 penggunaan per alat per hari di Audio Tools (20 alat). Kuota Audio Tools dicatat di server; bila server tidak terjangkau, alat belum bisa dipakai sampai koneksi pulih. Berbayar (beli sekali): modul per lagu seperti master, loop, stem, dan partitur; Full 16-Bar Editor (16 bar, 7 kit drum, 4 track akor dengan 128 instrumen, ekspor MIDI/audio, simpan dan muat proyek); Audio Tools tanpa batas harian; serta deck topik tambahan. Donasi bersifat sukarela.',
  },
  {
    q: 'Apakah berkas audio saya diunggah ke server?',
    a: 'Untuk Audio Tools, tidak. Berkas dibaca dan diproses langsung di browser kamu. Yang dicatat server hanya hitungan pemakaian harian per alat.',
  },
  {
    q: 'Kenapa Chord Pad butuh waktu memuat suara?',
    a: 'Chord Pad memakai bank sampel SoundFont yang berukuran besar, diunduh sekali lalu disimpan di cache browser. Selama belum selesai, pad tetap berbunyi dengan suara sintesis sementara, dan otomatis pindah ke suara instrumen asli begitu bank siap.',
  },
  {
    q: 'Apakah Vokal Isolator memakai AI?',
    a: 'Tidak. Alat ini memakai teknik center-phase: memisahkan suara yang berada di tengah stereo. Hasil terbaik pada rekaman stereo dengan vokal di tengah. Bass, kick, atau snare yang juga di tengah bisa ikut terbawa ke hasil vokal.',
  },
  {
    q: 'Bagaimana lisensi lagunya?',
    a: 'Setiap pembelian lagu membuka berkas Readme_License.txt yang memuat ketentuan lisensi komersial non-eksklusif. Baca isinya sebelum memakai lagu untuk proyekmu.',
  },
];

export const IndexView: React.FC<IndexViewProps> = ({ onNavigateAudio, onNavigateQuiz, onOpenProfile }) => {
  const goAudio = () => {
    audioEngine.playClickSound();
    onNavigateAudio();
  };
  const goQuiz = () => {
    audioEngine.playClickSound();
    onNavigateQuiz();
  };
  const fadeUp = {
    initial: { opacity: 0, y: 18 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: '-40px' },
    transition: { duration: 0.4 },
  };

  return (
    <div className="w-full min-w-0 space-y-10 sm:space-y-12 pb-16 break-words">
      {/* 1. HERO: mengajak & menawarkan solusi */}
      <section
        id="index-hero-section"
        className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-surface/80 via-surface/40 to-black border border-white/[0.1] px-4 py-8 sm:p-12 text-center shadow-2xl scroll-mt-20"
      >
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-72 h-72 sm:w-96 sm:h-96 bg-accent/15 blur-3xl rounded-full pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative z-10 max-w-3xl mx-auto space-y-5"
        >
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-accent/10 border border-accent/30 text-accent text-xs font-bold tracking-wide">
            <Headphones className="w-3.5 h-3.5" />
            <span>Studio audio & arena kuis, langsung di browser</span>
          </div>

          <h1 className="text-[1.75rem] min-[400px]:text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight text-balance">
            Punya ide musik atau butuh tantangan baru? <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-accent to-accent2">Mulai dari sini.</span>
          </h1>

          <p className="text-sm sm:text-base text-gray-300 leading-relaxed font-medium">
            PlayMuzeck menyatukan studio audio ringan dan arena kuis trivia. Susun ritme dan akor, olah berkas audio, atau
            ajak teman bertanding, tanpa memasang aplikasi berat.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
            <button
              onClick={goAudio}
              className="pm-shine w-full sm:w-auto px-6 py-3 rounded-xl bg-accent hover:bg-accent/80 text-on-accent font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-accent/20 active:scale-95 transition-all"
            >
              <Headphones className="w-4 h-4" />
              <span>Coba Audio Studio</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={goQuiz}
              className="pm-shine w-full sm:w-auto px-6 py-3 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 font-black text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-accent2/20 active:scale-95 transition-all"
            >
              <Brain className="w-4 h-4" />
              <span>Main Pusat Kuis</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[11px] text-gray-400">
            Perlu masuk dengan akun gratis. Drum Pad dan Chord Pad (Bar 1) serta 20 Audio Tools bisa dicoba tanpa biaya (2x per alat per hari); editor penuh dan modul lengkap bersifat berbayar.
          </p>
        </motion.div>
      </section>

      {/* 1b. MASALAH -> SOLUSI */}
      <section id="index-solutions-section" className="space-y-5 scroll-mt-20">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <span className="text-[11px] font-bold text-accent uppercase tracking-wider font-mono">Solusi</span>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Kenali kebutuhanmu, kami siapkan jalannya</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PROBLEMS.map((p, i) => (
            <motion.div
              key={p.problem}
              {...fadeUp}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="p-5 rounded-2xl bg-surface/30 border border-white/[0.08] hover:border-accent/40 transition-colors space-y-2"
            >
              <div className="flex items-center gap-2.5">
                <p.icon className="w-5 h-5 text-accent shrink-0" />
                <h3 className="text-sm font-bold text-white">{p.problem}</h3>
              </div>
              <p className="text-xs text-gray-300 leading-relaxed">{p.solution}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* 1c. CARA MULAI */}
      <section id="index-steps-section" className="rounded-3xl bg-black/50 border border-white/[0.08] p-4 sm:p-8 space-y-5 scroll-mt-20 transition-colors">
        <h2 className="text-xl sm:text-2xl font-black text-white text-center">Mulai dalam 3 langkah</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {STEPS.map((s, i) => (
            <div key={s.title} className="p-4 rounded-2xl bg-surface/30 border border-white/[0.06] space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-accent text-on-accent text-xs font-black flex items-center justify-center">{i + 1}</span>
                <s.icon className="w-4 h-4 text-accent" />
              </div>
              <h4 className="text-sm font-bold text-white">{s.title}</h4>
              <p className="text-xs text-gray-400">{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 2. FITUR UNGGULAN */}
      <section id="index-features-section" className="space-y-6 scroll-mt-20">
        <div className="text-center max-w-xl mx-auto space-y-2">
          <span className="text-[11px] font-bold text-accent uppercase tracking-wider font-mono">Fitur Unggulan</span>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Dua ruang, satu akun</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {[
            {
              id: 'index-audio-section',
              tone: 'accent',
              icon: Sliders,
              label: 'Workstation Audio',
              title: 'Audio Studio',
              points: AUDIO_POINTS,
              cta: 'Masuk ke Audio Studio',
              ctaIcon: Headphones,
              onClick: goAudio,
            },
            {
              id: 'index-quiz-section',
              tone: 'accent2',
              icon: Brain,
              label: 'Trivia & Brain Challenge',
              title: 'Pusat Kuis',
              points: QUIZ_POINTS,
              cta: 'Masuk ke Pusat Kuis',
              ctaIcon: Brain,
              onClick: goQuiz,
            },
          ].map((c) => {
            const a = c.tone === 'accent';
            return (
              <motion.div
                key={c.id}
                id={c.id}
                {...fadeUp}
                style={{ '--pm-spot': a ? 'var(--t-accent)' : 'var(--t-accent2)' } as React.CSSProperties}
                className={`rounded-3xl bg-gradient-to-b from-surface/60 to-black/80 border border-white/[0.1] p-5 sm:p-8 flex flex-col justify-between transition-all duration-300 shadow-xl group scroll-mt-20 min-w-0 ${
                  a ? 'hover:border-accent/50 hover:shadow-accent/20' : 'hover:border-accent2/50 hover:shadow-accent2/20'
                }`}
              >
                <div className="space-y-4">
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform border ${
                      a ? 'bg-accent/15 text-accent border-accent/30' : 'bg-accent2/15 text-accent2 border-accent2/30'
                    }`}
                  >
                    <c.icon className="w-6 h-6 stroke-[2.5]" />
                  </div>
                  <div className="space-y-1">
                    <span className={`text-[11px] font-bold uppercase tracking-wider font-mono ${a ? 'text-accent' : 'text-accent2'}`}>{c.label}</span>
                    <h3 className="text-xl sm:text-2xl font-black text-white">{c.title}</h3>
                  </div>
                  <ul className="space-y-3 text-xs text-gray-300">
                    {c.points.map((pt) => (
                      <li key={pt.title} className="flex items-start gap-2.5">
                        <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${a ? 'text-accent' : 'text-accent2'}`} />
                        <span>
                          <strong className="text-white">{pt.title}:</strong> {pt.desc}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  onClick={c.onClick}
                  className={`pm-shine mt-6 w-full py-3 px-4 rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg active:scale-95 ${
                    a
                      ? 'bg-accent hover:bg-accent/80 text-on-accent shadow-accent/20'
                      : 'bg-accent2 hover:bg-accent2/80 text-on-accent2 shadow-accent2/20'
                  }`}
                >
                  <c.ctaIcon className="w-4 h-4" />
                  <span>{c.cta}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {ECOSYSTEM.map((f) => (
            <div key={f.title} className="p-4 rounded-2xl bg-surface/30 border border-white/[0.06] space-y-2">
              <f.icon className={`w-5 h-5 ${f.color}`} />
              <h4 className="text-sm font-bold text-white">{f.title}</h4>
              <p className="text-xs text-gray-400">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 3. TENTANG KAMI */}
      <section
        id="index-about-section"
        className="rounded-3xl bg-gradient-to-b from-surface/50 to-black/70 border border-white/[0.1] p-4 sm:p-10 space-y-6 scroll-mt-20"
      >
        <div className="max-w-2xl mx-auto text-center space-y-3">
          <span className="text-[11px] font-bold text-accent uppercase tracking-wider font-mono">Tentang Kami</span>
          <h2 className="text-2xl sm:text-3xl font-black text-white">Musik dan kuis, di satu tempat yang sama</h2>
          <p className="text-sm text-gray-300 leading-relaxed">
            PlayMuzeck adalah platform audio interaktif dan pusat kuis berbahasa Indonesia. Kami ingin membuat berkarya dengan
            musik dan mengasah wawasan terasa ringan: cukup buka browser, tanpa instalasi yang merepotkan.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: ShieldCheck, title: 'Jujur soal gratis & berbayar', desc: 'Batas versi gratis dan harga modul dijelaskan terbuka, tanpa langganan tersembunyi.' },
            { icon: Layers, title: 'Musik orisinal, lisensi jelas', desc: 'Setiap lagu punya berkas lisensi yang bisa dibaca sebelum dipakai di proyekmu.' },
            { icon: Users, title: 'Masukanmu didengar', desc: 'Kirim ide atau aduan lewat Dasbor Profil. Pesanmu tersimpan dan sampai ke tim.' },
          ].map((v) => (
            <div key={v.title} className="p-4 rounded-2xl bg-black/40 border border-white/[0.06] space-y-2">
              <v.icon className="w-5 h-5 text-accent" />
              <h4 className="text-sm font-bold text-white">{v.title}</h4>
              <p className="text-xs text-gray-400">{v.desc}</p>
            </div>
          ))}
        </div>
        <div className="text-center">
          <button
            onClick={onOpenProfile}
            className="px-5 py-2.5 rounded-xl bg-black/60 hover:bg-black/80 border border-white/[0.12] hover:border-accent/50 text-xs font-bold text-white inline-flex items-center gap-2 cursor-pointer transition-all"
          >
            <MessageSquare className="w-4 h-4 text-accent" />
            <span>Kirim masukan atau aduan</span>
          </button>
        </div>
      </section>

      {/* 4. FAQ */}
      <section id="index-faq-section" className="max-w-3xl mx-auto w-full space-y-4 scroll-mt-20 rounded-3xl p-3 sm:p-4 border border-transparent transition-colors">
        <h2 className="text-xl sm:text-2xl font-black text-white text-center">Pertanyaan yang sering muncul</h2>
        <div className="space-y-2.5">
          {FAQ.map((f) => (
            <details key={f.q} className="group rounded-2xl bg-surface/30 border border-white/[0.08] open:border-accent/40 transition-colors">
              <summary className="flex items-center justify-between gap-3 p-4 cursor-pointer list-none text-sm font-bold text-white [&::-webkit-details-marker]:hidden">
                <span>{f.q}</span>
                <ChevronDown className="w-4 h-4 text-accent shrink-0 transition-transform group-open:rotate-180" />
              </summary>
              <p className="px-4 pb-4 text-xs text-gray-300 leading-relaxed">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 5. CTA PENUTUP */}
      <section className="text-center space-y-4">
        <h2 className="text-xl sm:text-2xl font-black text-white">Siap mencoba?</h2>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <button
            onClick={goAudio}
            className="pm-shine w-full sm:w-auto px-6 py-3 rounded-xl bg-accent hover:bg-accent/80 text-on-accent font-black text-sm inline-flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all"
          >
            <Headphones className="w-4 h-4" />
            <span>Buka Audio Studio</span>
          </button>
          <button
            onClick={goQuiz}
            className="pm-shine w-full sm:w-auto px-6 py-3 rounded-xl bg-accent2 hover:bg-accent2/80 text-on-accent2 font-black text-sm inline-flex items-center justify-center gap-2 cursor-pointer active:scale-95 transition-all"
          >
            <Brain className="w-4 h-4" />
            <span>Buka Pusat Kuis</span>
          </button>
        </div>
      </section>
    </div>
  );
};
