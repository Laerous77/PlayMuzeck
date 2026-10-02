#!/usr/bin/env node
// Ganti warna hardcode (mode gelap) menjadi token tema di file KLIEN.
//
//   node scripts/apply-theme-vars.mjs [folder=src] [--dry] [--amber=AudioStudio] [--red=PusatKuis]
//
// - Selalu: #FCA311 -> accent, #14213D -> surface, panel gelap (#0d1527 dst) -> deep,
//   text-black -> text-on-accent (pada baris bertombol accent) / text-neutral-950 (pada tombol hijau dkk).
// - --amber=<bagian-path,...> : di file yang path-nya memuat teks itu, amber-* dianggap aksen Audio -> accent.
// - --red=<bagian-path,...>   : idem untuk red-* sebagai aksen Kuis -> accent2. DEFAULT MATI karena red juga
//                               dipakai untuk "jawaban salah"/error. Cek `git diff` kalau dinyalakan.
// Folder src/admin dan src/theme dilewati. Aman dijalankan ulang. Commit dulu, lalu cek `git diff`.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d = '') => (args.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=')[1];
const root = args.find((a) => !a.startsWith('--')) || 'src';
const dry = args.includes('--dry');
const amberPaths = flag('amber').split(',').filter(Boolean);
const redPaths = flag('red').split(',').filter(Boolean);
const SKIP = new Set(['node_modules', 'admin', 'theme', 'dist', '.git']);

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (/\.(tsx|ts|jsx|js|css)$/.test(e.name) && !/index\.css$/.test(e.name)) yield full;
  }
}

function convert(line, useAmber, useRed, note) {
  let l = line;
  l = l
    .replace(/hover:bg-\[#e58e00\]/g, 'hover:bg-accent/80')
    .replace(/\[#FCA311\]/g, 'accent')
    .replace(/\[#14213D\]/g, 'surface')
    .replace(/\[#(0d1527|090D16|0a1120)\]/gi, 'deep');

  if (useAmber) {
    l = l
      .replace(/group-hover:bg-amber-\d+(?![\d/])/g, 'group-hover:bg-accent/70')
      .replace(/hover:bg-amber-\d+(?![\d/])/g, 'hover:bg-accent/80')
      .replace(/\b(bg|text|border|shadow|ring|from|via|to)-amber-\d+/g, '$1-accent');
  }
  if (useRed) {
    l = l
      .replace(/hover:bg-red-\d+(?![\d/])/g, 'hover:bg-accent2/80')
      .replace(/\b(bg|text|border|shadow|ring)-red-\d+/g, '$1-accent2');
    if (/bg-accent2(?![\d/])/.test(l)) l = l.replace(/\btext-white\b/g, 'text-on-accent2');
  }

  if (/text-black|fill-black/.test(l)) {
    const onAccent = /bg-accent(?!2)/.test(l);
    const onOther = /bg-(emerald|green|yellow|orange|sky|blue|red|rose|pink|cyan)-\d+/.test(l);
    if (onAccent) {
      l = l.replace(/text-black/g, 'text-on-accent').replace(/fill-black/g, 'fill-on-accent');
      if (onOther) note('text-black pada baris dengan accent DAN warna lain — cek manual');
    } else if (onOther) {
      l = l.replace(/text-black/g, 'text-neutral-950');
    } else {
      note('text-black tanpa bg-accent di baris yang sama — dibiarkan (ikut berbalik di mode terang)');
    }
  }
  return l;
}

let changedFiles = 0;
const todo = [];
for (const file of walk(root)) {
  const src = fs.readFileSync(file, 'utf8');
  const useAmber = amberPaths.some((p) => file.includes(p));
  const useRed = redPaths.some((p) => file.includes(p));
  const notes = [];
  const out = src.split('\n').map((line, i) => convert(line, useAmber, useRed, (m) => notes.push(`  L${i + 1}: ${m}`))).join('\n');
  if (out !== src) {
    changedFiles++;
    if (!dry) fs.writeFileSync(file, out);
    console.log(`✔ ${file}`);
  }
  const left = out.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /#[0-9a-fA-F]{6}\b|\b(amber|red)-\d{3}/.test(l));
  if (notes.length || left.length) todo.push({ file, notes, left: left.length, sample: left.slice(0, 3) });
}

console.log(`\n${dry ? '[dry-run] ' : ''}${changedFiles} file diubah.\n`);
if (todo.length) console.log('Perlu dicek manual:');
for (const t of todo) {
  console.log(`- ${t.file}${t.left ? `  (${t.left} baris masih berwarna hardcode)` : ''}`);
  t.notes.slice(0, 5).forEach((n) => console.log(n));
  t.sample.forEach(([n, l]) => console.log(`  L${n}: ${l.trim().slice(0, 110)}`));
}
