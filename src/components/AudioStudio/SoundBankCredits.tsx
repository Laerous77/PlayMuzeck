// src/components/AudioStudio/SoundBankCredits.tsx
// Kredit & lisensi bank suara (SoundFont) yang dipakai Pad Studio.
// Lisensi MIT mewajibkan pemberitahuan hak cipta dan teks izin disertakan; komponen ini menampilkannya di aplikasi.
import React from 'react';

const MIT_TEXT = `Mono version:  Copyright (c) 2014-16 Michael Cowgill
Copyright (c) 2000-2002, 2008 Frank Wen <getfrank@gmail.com>

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.`;

const CREDITS = [
  'FluidR3 (versi asli) oleh Frank Wen, Copyright (c) 2000-2002, 2008',
  'Konversi mono (FluidR3Mono) oleh Michael Cowgill, Copyright (c) 2014-17',
  'Adaptasi untuk MuseScore_General.sf2 oleh S. Christian Collins, Copyright (c) 2018-19',
  'Instrumen Temple Blocks oleh Ethan Winer, Copyright (c) 2002',
  'Drumline Cymbals oleh Michael Schorsch, Copyright (c) 2016',
];

const FLUID_THANKS = [
  'Suren M. Seron',
  'Scott Hanan',
  'Steve Aupperle',
  'Chris Gillman',
  'Alex Taubr',
  'Chris Prola',
  'Andrew Klenk',
  'Winfried Hubbe',
  'Dylan',
  'Tim',
  'Gort',
  'Uros Katic',
  'Ethan Winer',
];

export const SoundBankCredits: React.FC = () => (
  <details className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-gray-400">
    <summary className="cursor-pointer select-none font-bold text-gray-300 hover:text-white">
      Kredit & lisensi bank suara (SoundFont)
    </summary>
    <div className="mt-2 space-y-3 leading-relaxed">
      <p>
        Suara instrumen akor memakai <b className="text-gray-200">MuseScore_General.sf2</b> (versi 0.2, 13 Mei 2020), dibagikan di bawah lisensi MIT.
        Informasi sumber sampel lengkap ada di berkas &quot;MuseScore_General_Sample_Sources.csv&quot; milik bank suara tersebut. Instrumen tanpa
        atribusi khusus memakai sampel dari FluidR3Mono.
      </p>
      <ul className="list-disc pl-5 space-y-0.5">
        {CREDITS.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p>
        FluidR3 dibuat sebagian dari sampel domain publik yang diedit dan diprogram ulang, serta rekaman milik sendiri bersama bantuan: {FLUID_THANKS.join(', ')}.
      </p>
      <p>
        Sumber:{' '}
        <a
          className="text-accent underline"
          href="https://ftp.osuosl.org/pub/musescore/soundfont/MuseScore_General/"
          target="_blank"
          rel="noreferrer"
        >
          MuseScore_General (OSUOSL mirror)
        </a>
      </p>
      <pre className="whitespace-pre-wrap font-mono text-[10px] text-gray-500 max-h-48 overflow-y-auto rounded-lg bg-black/40 border border-white/10 p-2 select-text">
        {MIT_TEXT}
      </pre>
    </div>
  </details>
);
