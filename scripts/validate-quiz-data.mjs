// Jalankan: node scripts/validate-quiz-data.mjs
// Memvalidasi seluruh deck bawaan di src/data/quiz/decks/*.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data', 'quiz', 'decks');
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const errors = [];
const seenIds = new Map();
const seenText = new Map();
let total = 0;

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
  const deck = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const where = deck.id || file;
  if (deck.cardCount !== deck.questions.length) errors.push(`${where}: cardCount ${deck.cardCount} != ${deck.questions.length}`);
  for (const q of deck.questions) {
    total++;
    const tag = `${where}/${q.id}`;
    if (seenIds.has(q.id)) errors.push(`ID ganda: ${tag} (juga di ${seenIds.get(q.id)})`);
    seenIds.set(q.id, where);
    const key = norm(q.question);
    if (seenText.has(key)) errors.push(`Soal sama: ${tag} == ${seenText.get(key)}`);
    seenText.set(key, tag);
    if (!Array.isArray(q.options) || q.options.length < 2) errors.push(`${tag}: opsi kurang`);
    if (new Set(q.options.map((o) => o.trim().toLowerCase())).size !== q.options.length) errors.push(`${tag}: opsi ganda`);
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex >= q.options.length)
      errors.push(`${tag}: correctIndex tidak valid`);
    if (q.mediaType && !q.mediaUrl) errors.push(`${tag}: mediaType tanpa mediaUrl`);
  }
  console.log(`${where}: ${deck.questions.length} soal, media: ${deck.questions.filter((q) => q.mediaUrl).length}`);
}
console.log(`Total ${total} soal`);
if (errors.length) { console.error('\nGAGAL:\n' + errors.join('\n')); process.exit(1); }
console.log('OK: tidak ada soal ganda, semua valid.');
