// Tes Simpan / Muat / Ekspor MIDI di SERVER: hak akses, enkripsi berkas, validasi, anti-pemalsuan.
// Jalankan: npx tsx tests/padFiles.test.ts
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { createPadEditorRouter } from '../server/padEditorRoutes';
import { IMPORT_CTX } from '../src/components/AudioStudio/padContext';
import { normalizeProject } from '../src/components/AudioStudio/midiProject';

process.env.PAD_PROJECT_KEY = 'k'.repeat(40);

const PAID = new Set(['paid@x.id']);
const db: any = {
  query: async (sql: string, params: any[]) => {
    if (/user_collections/.test(sql)) return { rows: PAID.has(params[0]) ? [{ 1: 1 }] : [] };
    if (/SELECT pad_settings/.test(sql)) return { rows: [] };
    return { rows: [], rowCount: 1 };
  },
};
// requireUser tiruan: identitas dari header uji (di server asli: dari sesi), 401 bila tidak ada.
const requireUser: express.RequestHandler = (req, res, next) => {
  const email = req.header('x-test-user');
  if (!email) return void res.status(401).json({ error: 'Belum login.' });
  (req as any).userEmail = email;
  next();
};

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(createPadEditorRouter({ db, requireUser }));
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

const post = (path: string, body: unknown, user?: string) =>
  fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
    body: JSON.stringify(body),
  });

const sample = normalizeProject({ bpm: 133, timeSig: '4/4', drum: { kick: '1000100010001000' } }, IMPORT_CTX);
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

let n = 0;
const ok = (name: string) => console.log(`  ✓ ${++n}. ${name}`);

try {
  // 1) tanpa login -> 401 di semua endpoint berkas
  for (const p of ['/api/pad/project/save', '/api/pad/project/load', '/api/pad/export/midi']) {
    assert.equal((await post(p, {})).status, 401);
  }
  ok('tanpa login: 401');

  // 2) bukan pemilik -> 403, tidak ada berkas
  for (const [p, body] of [
    ['/api/pad/project/save', { project: sample }],
    ['/api/pad/project/load', { data: 'AAAA' }],
    ['/api/pad/export/midi', { bpm: 120, timeSignature: { num: 4, den: 4 }, programs: [0], events: [] }],
  ] as const) {
    const r = await post(p, body, 'free@x.id');
    assert.equal(r.status, 403, p);
    assert.ok(!(r.headers.get('content-type') || '').includes('midi'));
  }
  ok('akun gratis: 403 di save / load / export MIDI');

  // 3) pemilik: simpan -> berkas .mid, isi proyek TIDAK terbaca (terenkripsi)
  const saved = await post('/api/pad/project/save', { project: sample }, 'paid@x.id');
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get('content-type'), 'audio/midi');
  const bytes = new Uint8Array(await saved.arrayBuffer());
  assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'MThd');
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.includes('PMZK2') && !text.includes('PMZK1'));
  assert.ok(!text.includes('"bpm"') && !text.includes('PlayMuzeck PadStudio'), 'payload harus terenkripsi');
  ok('simpan: .mid valid, payload terenkripsi (PMZK2)');

  // 4) muat berkas itu -> proyek identik
  const loaded = await post('/api/pad/project/load', { data: b64(bytes) }, 'paid@x.id');
  assert.equal(loaded.status, 200);
  const lj: any = await loaded.json();
  assert.equal(lj.source, 'project');
  assert.deepEqual(lj.project, sample);
  ok('muat: proyek kembali persis sama');

  // 5) berkas dimodifikasi (satu byte payload dibalik) -> ditolak
  const tampered = Uint8Array.from(bytes);
  const at = Buffer.from(tampered).indexOf('PMZK2') + 5 + 12 + 16 + 3;
  tampered[at] ^= 0xff;
  const bad = await post('/api/pad/project/load', { data: b64(tampered) }, 'paid@x.id');
  assert.equal(bad.status, 422);
  ok('berkas dimodifikasi: 422');

  // 6) pemalsuan: JSON proyek polos dibungkus format resmi PMZK2 tanpa kunci -> ditolak
  const forged = Buffer.from(bytes);
  const fi = forged.indexOf('PMZK2') + 5;
  Buffer.from('{"project":{"bpm":999}}').copy(forged, fi);
  assert.equal((await post('/api/pad/project/load', { data: forged.toString('base64') }, 'paid@x.id')).status, 422);
  ok('berkas palsu (tanpa kunci server): 422');

  // 7) sampah / terlalu besar
  assert.equal((await post('/api/pad/project/load', { data: b64(new Uint8Array([1, 2, 3, 4])) }, 'paid@x.id')).status, 422);
  assert.equal((await post('/api/pad/project/load', { data: 'A'.repeat(7_000_000) }, 'paid@x.id')).status, 400);
  ok('sampah: 422, terlalu besar: 400');

  // 8) simpan: data proyek ngawur dibersihkan, bukan membuat server error
  const junk = await post('/api/pad/project/save', { project: { bpm: 1e9, drum: { kick: 'x'.repeat(100) }, pads: 'lol' } }, 'paid@x.id');
  assert.equal(junk.status, 200);
  const back: any = await (await post('/api/pad/project/load', { data: b64(new Uint8Array(await junk.arrayBuffer())) }, 'paid@x.id')).json();
  assert.ok(back.project.bpm >= IMPORT_CTX.bpmRange[0] && back.project.bpm <= IMPORT_CTX.bpmRange[1]);
  assert.equal((await post('/api/pad/project/save', {}, 'paid@x.id')).status, 400);
  ok('data proyek ngawur dijepit / ditolak (bukan 500)');

  // 9) ekspor MIDI: sah, dan validasi menolak nilai liar
  const midi = await post(
    '/api/pad/export/midi',
    { bpm: 120, timeSignature: { num: 4, den: 4 }, programs: [0, 12], title: 'Tes', events: [{ step: 0, note: 36, velocity: 100, isDrum: true, durationSteps: 1 }, { step: 4, note: 60, channel: 0, durationSteps: 8 }], project: sample },
    'paid@x.id'
  );
  assert.equal(midi.status, 200);
  const mb = new Uint8Array(await midi.arrayBuffer());
  assert.equal(Buffer.from(mb.subarray(0, 4)).toString(), 'MThd');
  const reload: any = await (await post('/api/pad/project/load', { data: b64(mb) }, 'paid@x.id')).json();
  assert.deepEqual(reload.project, sample);
  for (const evil of [
    { bpm: 0 }, { bpm: 'abc' }, { timeSignature: { num: 4, den: 3 } }, { programs: [999] }, { events: [{ step: -1, note: 60 }] },
    { events: [{ step: 0, note: 200 }] }, { events: Array.from({ length: 30001 }, () => ({ step: 0, note: 60 })) },
  ]) {
    const r = await post('/api/pad/export/midi', { bpm: 120, timeSignature: { num: 4, den: 4 }, programs: [0], events: [], ...evil }, 'paid@x.id');
    assert.equal(r.status, 400, JSON.stringify(evil).slice(0, 60));
  }
  ok('ekspor MIDI: sah jalan, masukan liar 400, proyek tersisip & bisa dimuat');

  // 10) identitas hanya dari sesi: email di body diabaikan (akun gratis tak bisa "meminjam" email pemilik)
  const spoof = await post('/api/pad/project/save', { project: sample, email: 'paid@x.id' }, 'free@x.id');
  assert.equal(spoof.status, 403);
  ok('email palsu di body diabaikan: 403');

  console.log(`\nSemua ${n} tes lulus.`);
} catch (e) {
  console.error('\nGAGAL:', e);
  process.exitCode = 1;
} finally {
  server.close();
}
