/* src/standalone/standalone.data.js
   Kuis bawaan Pusat Kuis. Format soal: { id, text, options[], answer (indeks 0-based), explain, media? }
   Kuis buatan pengguna disimpan terpisah di penyimpanan peramban dan memakai format yang sama. */
(function (root) {
  'use strict';

  function deck(id, title, category, icon, desc, rows) {
    return {
      id: id, builtin: true, title: title, category: category, icon: icon, desc: desc,
      questions: rows.map(function (r, i) {
        return { id: id + '-' + (i + 1), text: r[0], options: r[1], answer: r[2], explain: r[3], media: null };
      })
    };
  }

  root.PM_BUILTIN_DECKS = [
    deck('b-teori', 'Teori Musik Dasar', 'Teori', '🎼',
      'Paranada, birama, tangga nada, dan istilah yang sering muncul saat belajar membaca not.', [
      ['Berapa jumlah garis pada sebuah paranada (staff)?', ['4', '5', '6', '7'], 1,
        'Paranada terdiri dari lima garis dan empat spasi.'],
      ['Kunci mana yang juga disebut kunci G?', ['Kunci Treble', 'Kunci Bass', 'Kunci Alto', 'Kunci Tenor'], 0,
        'Lengkung kunci treble melingkari garis kedua, yaitu garis nada G.'],
      ['Dalam birama 4/4, not bulat bernilai berapa ketuk?', ['1 ketuk', '2 ketuk', '3 ketuk', '4 ketuk'], 3,
        'Not bulat mengisi satu birama penuh pada 4/4, yaitu empat ketuk.'],
      ['Tangga nada mayor mana yang tidak memiliki tanda kres maupun mol?', ['G mayor', 'F mayor', 'C mayor', 'D mayor'], 2,
        'C mayor hanya memakai nada putih pada piano: C D E F G A B.'],
      ['Jarak nada dari C ke G disebut interval apa?', ['Kuart murni', 'Kuint murni', 'Sekt mayor', 'Septim mayor'], 1,
        'C ke G berjarak lima nada tangga (C D E F G) dan tujuh semiton: kuint murni.'],
      ['Istilah tempo "Allegro" berarti...', ['Lambat dan khidmat', 'Cepat dan riang', 'Sangat keras', 'Makin pelan'], 1,
        'Allegro adalah tempo cepat dan bersemangat.'],
      ['Simbol dinamika "p" (piano) berarti...', ['Sangat keras', 'Sedang', 'Lembut', 'Tiba-tiba keras'], 2,
        'Piano berarti dimainkan lembut; "pp" berarti sangat lembut.'],
      ['Akor C mayor tersusun dari nada...', ['C – E – G', 'C – Eb – G', 'C – F – A', 'C – D – G'], 0,
        'Akor mayor memakai terts mayor lalu terts minor: C, E, G.'],
      ['Ada berapa nada berbeda dalam satu oktaf tangga nada kromatis (tanpa mengulang nada oktaf di atasnya)?', ['7', '8', '10', '12'], 3,
        'Dua belas semiton: C, C#, D, D#, E, F, F#, G, G#, A, A#, B.'],
      ['Dalam birama 4/4, not seperdelapan bernilai berapa ketuk?', ['Setengah ketuk', '1 ketuk', '2 ketuk', 'Seperempat ketuk'], 0,
        'Not seperempat bernilai satu ketuk, sehingga not seperdelapan bernilai setengahnya.']
    ]),

    deck('b-sejarah', 'Sejarah Musik Dunia', 'Sejarah', '🌍',
      'Dari komponis klasik sampai bintang pop: tokoh, karya, dan tempat lahirnya genre.', [
      ['Siapa komponis pencipta Simfoni No. 9 yang tetap berkarya meski kehilangan pendengarannya?', ['Mozart', 'Beethoven', 'Haydn', 'Schubert'], 1,
        'Ludwig van Beethoven menyelesaikan Simfoni No. 9 ketika pendengarannya sudah sangat berkurang.'],
      ['Wafatnya komponis mana pada tahun 1750 sering dipakai sebagai penanda berakhirnya zaman Barok?', ['Handel', 'Vivaldi', 'Johann Sebastian Bach', 'Telemann'], 2,
        'J.S. Bach wafat pada 1750, tahun yang lazim dijadikan batas akhir periode Barok.'],
      ['"The Four Seasons" (Empat Musim) adalah karya...', ['Antonio Vivaldi', 'Claude Debussy', 'Franz Liszt', 'Giuseppe Verdi'], 0,
        'Empat konserto biola Vivaldi yang menggambarkan musim semi, panas, gugur, dan dingin.'],
      ['Di kota mana Wolfgang Amadeus Mozart dilahirkan?', ['Wina', 'Salzburg', 'Praha', 'Berlin'], 1,
        'Mozart lahir di Salzburg pada 1756.'],
      ['The Beatles berasal dari kota...', ['London', 'Manchester', 'Liverpool', 'Glasgow'], 2,
        'Keempat personelnya berasal dari Liverpool, Inggris.'],
      ['Aliran musik jazz secara luas dianggap lahir di kota...', ['New Orleans', 'Chicago', 'Memphis', 'Detroit'], 0,
        'Jazz tumbuh di New Orleans pada awal abad ke-20.'],
      ['Album "Thriller" milik Michael Jackson dirilis pada tahun...', ['1979', '1982', '1985', '1991'], 1,
        'Thriller dirilis pada November 1982.'],
      ['Hip hop berkembang pada 1970-an di wilayah mana?', ['Harlem, Manhattan', 'The Bronx, New York', 'Compton, Los Angeles', 'South Side, Chicago'], 1,
        'Pesta jalanan para DJ di The Bronx sering disebut sebagai awal mula hip hop.'],
      ['Frédéric Chopin, komponis dan pianis romantik, berasal dari negara...', ['Prancis', 'Austria', 'Hungaria', 'Polandia'], 3,
        'Chopin lahir di Polandia dan kemudian menetap di Paris.'],
      ['Piano pertama dibuat oleh Bartolomeo Cristofori di Italia sekitar tahun...', ['1500', '1700', '1850', '1920'], 1,
        'Cristofori membangun instrumen "gravicembalo col piano e forte" di Florensia sekitar 1700.']
    ]),

    deck('b-nusantara', 'Alat Musik Nusantara', 'Budaya', '🥁',
      'Kenali alat musik tradisional Indonesia: asal daerah, cara memainkan, dan golongannya.', [
      ['Angklung, alat musik dari bambu yang digoyangkan, berasal dari daerah...', ['Jawa Barat', 'Bali', 'Sumatera Utara', 'Sulawesi Selatan'], 0,
        'Angklung dikenal sebagai alat musik tradisional masyarakat Sunda di Jawa Barat.'],
      ['Sasando, alat musik petik dengan resonator daun lontar, berasal dari...', ['Pulau Rote, NTT', 'Pulau Bali', 'Maluku Utara', 'Aceh'], 0,
        'Sasando adalah alat musik khas Pulau Rote, Nusa Tenggara Timur.'],
      ['Ansambel gamelan paling dikenal berasal dari...', ['Jawa dan Bali', 'Sumatera dan Kalimantan', 'Sulawesi dan Papua', 'Maluku dan NTT'], 0,
        'Gamelan berkembang pesat di Jawa dan Bali, masing-masing dengan gaya sendiri.'],
      ['Tifa, alat musik pukul berbentuk silinder, banyak dijumpai di...', ['Jawa Tengah', 'Papua dan Maluku', 'Sumatera Barat', 'Kalimantan Barat'], 1,
        'Tifa menjadi pengiring tarian dan upacara adat di Papua dan Maluku.'],
      ['Sape (sampek) adalah alat musik petik khas suku...', ['Dayak', 'Bugis', 'Minang', 'Sasak'], 0,
        'Sape berasal dari suku Dayak di Kalimantan.'],
      ['Kolintang, alat musik bilah kayu, berasal dari...', ['Toraja', 'Minahasa', 'Gorontalo', 'Banggai'], 1,
        'Kolintang berasal dari tanah Minahasa, Sulawesi Utara.'],
      ['Hasapi adalah alat musik petik khas suku...', ['Batak', 'Betawi', 'Asmat', 'Baduy'], 0,
        'Hasapi, semacam kecapi, dimainkan dalam musik tradisional Batak.'],
      ['Rebab termasuk golongan alat musik...', ['Tiup', 'Pukul', 'Gesek', 'Petik'], 2,
        'Rebab memiliki dawai yang digesek dengan penggesek.'],
      ['Kendang pada umumnya dimainkan dengan cara...', ['Ditiup', 'Dipukul atau ditepuk dengan tangan', 'Digesek', 'Dipetik'], 1,
        'Kendang adalah alat musik membranofon yang ditepuk dengan telapak tangan dan jari.'],
      ['Talempong, alat musik logam berbentuk gong kecil, berasal dari...', ['Sumatera Barat', 'Nusa Tenggara Barat', 'Papua Barat', 'Kalimantan Timur'], 0,
        'Talempong adalah alat musik tradisional Minangkabau, Sumatera Barat.']
    ]),

    deck('b-genre', 'Tebak Era & Genre', 'Populer', '🎧',
      'Musik populer dari berbagai negara dan dekade: band, penyanyi, genre, dan format audio.', [
      ['Nama genre "dangdut" diyakini berasal dari tiruan bunyi alat musik...', ['Gendang', 'Gitar listrik', 'Terompet', 'Biola'], 0,
        '"Dang" dan "dut" menirukan bunyi gendang (tabla) yang menonjol di musik dangdut.'],
      ['Siapa musisi yang dijuluki "Raja Dangdut" Indonesia?', ['Rhoma Irama', 'A. Rafiq', 'Elvy Sukaesih', 'Meggy Z'], 0,
        'Rhoma Irama bersama Soneta Group menjadi tokoh paling berpengaruh dalam dangdut.'],
      ['"Bohemian Rhapsody" adalah lagu dari band...', ['Led Zeppelin', 'Queen', 'The Rolling Stones', 'Pink Floyd'], 1,
        'Lagu ini ada di album "A Night at the Opera" (1975) karya Queen.'],
      ['"Imagine" dipopulerkan oleh...', ['Paul McCartney', 'Elton John', 'John Lennon', 'Bob Dylan'], 2,
        'John Lennon merilis "Imagine" pada 1971.'],
      ['Aliran reggae berasal dari negara...', ['Jamaika', 'Kuba', 'Brasil', 'Trinidad dan Tobago'], 0,
        'Reggae lahir di Jamaika pada akhir 1960-an.'],
      ['"Gangnam Style" dibawakan oleh...', ['BTS', 'Rain', 'PSY', 'Big Bang'], 2,
        'PSY merilis lagu ini pada 2012 dan videonya viral di seluruh dunia.'],
      ['Piringan hitam LP 12 inci umumnya diputar pada kecepatan...', ['16⅔ RPM', '33⅓ RPM', '45 RPM', '78 RPM'], 1,
        'LP standar berputar 33⅓ putaran per menit; single 7 inci biasanya 45 RPM.'],
      ['Band mana yang sering disebut sebagai pelopor heavy metal?', ['Black Sabbath', 'ABBA', 'The Carpenters', 'Bee Gees'], 0,
        'Album debut Black Sabbath (1970) dianggap membentuk dasar suara heavy metal.'],
      ['MP3 adalah singkatan dari...', ['Media Player 3', 'Music Portable 3', 'MPEG Audio Layer III', 'Multi Pulse Code 3'], 2,
        'MP3 merupakan format kompresi audio MPEG-1 Audio Layer III.'],
      ['Grup musik Indonesia yang populer pada 1960–1970-an dengan lagu "Kolam Susu" adalah...', ['Koes Plus', 'Dewa 19', 'Sheila on 7', 'Slank'], 0,
        'Koes Plus (sebelumnya Koes Bersaudara) berasal dari Tuban, Jawa Timur.']
    ])
  ];
})(typeof window !== 'undefined' ? window : globalThis);
