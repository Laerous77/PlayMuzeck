// Pure Client-Side Audio & MIDI Exporter for PlayMuzeck
// Generates real, binary playable files without server backend

// 1. WAV Encoder (PCM, bit depth dapat dipilih 8, 16, atau 24 bit)
// bitDepth 8 dipakai sebagai fallback kompresi nyata (ukuran file benar-benar
// mengecil ~50% dibanding 16-bit) ketika browser tidak mendukung encoder
// codec asli (MediaRecorder/Opus/AAC).
export function audioBufferToWav(buffer: AudioBuffer, bitDepth: 8 | 16 | 24 = 16): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bytesPerSample = bitDepth / 8;

  const length = buffer.length * numChannels * bytesPerSample;
  const headerLength = 44;
  const outBuffer = new ArrayBuffer(headerLength + length);
  const view = new DataView(outBuffer);

  // RIFF identifier
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(view, 8, 'WAVE');

  // fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // subchunk1size (16 for PCM)
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true); // byteRate
  view.setUint16(32, numChannels * bytesPerSample, true); // blockAlign
  view.setUint16(34, bitDepth, true);

  // data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, length, true);

  // Write audio samples
  let offset = 44;
  const channels: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channels[c][i];
      // Clamping between -1 and 1
      sample = Math.max(-1, Math.min(1, sample));
      if (bitDepth === 24) {
        // 24-bit signed little-endian (3 byte per sampel)
        const v = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff);
        view.setUint8(offset, v & 0xff);
        view.setUint8(offset + 1, (v >> 8) & 0xff);
        view.setUint8(offset + 2, (v >> 16) & 0xff);
        offset += 3;
      } else if (bitDepth === 16) {
        // Scale to 16-bit signed int
        const intSample = Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
        view.setInt16(offset, intSample, true);
        offset += 2;
      } else {
        // 8-bit PCM WAV bersifat unsigned, titik tengah di 128
        const intSample = Math.max(0, Math.min(255, Math.round((sample * 0.5 + 0.5) * 255)));
        view.setUint8(offset, intSample);
        offset += 1;
      }
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

// 1b. Kompresi Audio NYATA (Real Codec) untuk fitur Compress
// Masalah sebelumnya: tombol "Compress" hanya mengubah sample rate lalu
// tetap mengekspor PCM mentah (WAV) — jadi ukurannya SELALU lebih besar
// daripada file sumber yang biasanya sudah terkompresi (mis. MP3). Fungsi
// ini memakai MediaRecorder browser untuk benar-benar meng-encode audio ke
// codec lossy asli (Opus/AAC) dengan bitrate sesuai tier yang dipilih,
// sehingga ukuran file benar-benar mengecil dan 5 tingkatan benar-benar
// berbeda. Jika browser tidak punya encoder sama sekali (sangat jarang),
// baru fallback ke WAV bit-depth rendah (tetap nyata lebih kecil, bukan
// sekadar ganti label ekstensi).
export interface CompressedAudioResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  isRealCodec: boolean;
}

export async function encodeCompressedAudio(
  buffer: AudioBuffer,
  targetBitrateKbps: number,
  onProgress?: (percent: number) => void
): Promise<CompressedAudioResult> {
  const codecCandidates: { mime: string; ext: string }[] = [
    { mime: 'audio/mp4;codecs=mp4a.40.2', ext: 'm4a' }, // AAC (Safari umumnya mendukung ini)
    { mime: 'audio/webm;codecs=opus', ext: 'webm' }, // Opus (Chrome/Edge/Firefox)
    { mime: 'audio/ogg;codecs=opus', ext: 'ogg' }, // Opus (Firefox)
    { mime: 'audio/webm', ext: 'webm' },
  ];

  const hasMediaRecorder = typeof (window as any).MediaRecorder !== 'undefined';
  const supported = hasMediaRecorder
    ? codecCandidates.find((c) => {
        try {
          return MediaRecorder.isTypeSupported(c.mime);
        } catch {
          return false;
        }
      })
    : undefined;

  if (supported) {
    try {
      const blob = await recordBufferAsCompressed(buffer, supported.mime, targetBitrateKbps, onProgress);
      if (blob && blob.size > 0) {
        return { blob, mimeType: supported.mime, extension: supported.ext, isRealCodec: true };
      }
    } catch {
      // Lanjut ke fallback di bawah jika perekaman gagal di tengah jalan
    }
  }

  // Fallback: PCM dengan bit-depth diturunkan sesuai keagresifan tier.
  // Ini TETAP nyata lebih kecil (bukan cuma ganti label), karena jumlah
  // byte per sample benar-benar berkurang.
  const bitDepth: 8 | 16 = targetBitrateKbps <= 96 ? 8 : 16;
  const wavBlob = audioBufferToWav(buffer, bitDepth);
  onProgress?.(100);
  return { blob: wavBlob, mimeType: 'audio/wav', extension: 'wav', isRealCodec: false };
}

function recordBufferAsCompressed(
  buffer: AudioBuffer,
  mimeType: string,
  bitrateKbps: number,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const AudioCtxCtor = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AudioCtxCtor();
    // Tanpa resume(), AudioContext bisa 'suspended' (kebijakan autoplay) -> hasil rekaman kosong/hening.
    ctx.resume?.().catch(() => {});
    const dest = ctx.createMediaStreamDestination();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(dest);

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(dest.stream, {
        mimeType,
        audioBitsPerSecond: Math.max(8000, Math.round(bitrateKbps * 1000)),
      });
    } catch (err) {
      ctx.close();
      reject(err);
      return;
    }

    const chunks: BlobPart[] = [];
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    const startedAt = ctx.currentTime;

    const cleanup = () => {
      if (progressTimer) clearInterval(progressTimer);
      ctx.close().catch(() => {});
    };

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      cleanup();
      reject(e);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      cleanup();
      onProgress?.(100);
      resolve(blob);
    };

    recorder.start(250);
    src.start(0);

    if (onProgress) {
      progressTimer = setInterval(() => {
        const elapsed = ctx.currentTime - startedAt;
        const pct = Math.min(99, Math.round((elapsed / Math.max(0.01, buffer.duration)) * 100));
        onProgress(pct);
      }, 150);
    }

    // Encoding berjalan real-time (durasi encode = durasi audio), karena
    // browser tidak menyediakan encoder Opus/AAC yang lebih cepat dari
    // waktu nyata tanpa pustaka pihak ketiga.
    src.onended = () => {
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, 80);
    };

    // Pengaman jika event 'ended' tidak terpicu (mis. buffer sangat pendek)
    const safetyMs = buffer.duration * 1000 + 1500;
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, safetyMs);
  });
}

// 1c. Penggabung Buffer (dipakai Vocal Isolator untuk output ke-3:
// "Vokal + Musik" sebagai satu file gabungan yang tetap terpisah dari
// file vokal-saja dan musik-saja)
export function mixBuffers(a: AudioBuffer, b: AudioBuffer): AudioBuffer {
  const numChannels = Math.max(a.numberOfChannels, b.numberOfChannels);
  const length = Math.max(a.length, b.length);
  const sampleRate = a.sampleRate;
  const out = new AudioBuffer({ length, numberOfChannels: numChannels, sampleRate });

  for (let c = 0; c < numChannels; c++) {
    const chA = c < a.numberOfChannels ? a.getChannelData(c) : null;
    const chB = c < b.numberOfChannels ? b.getChannelData(c) : null;
    const outData = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      const va = chA ? chA[i] || 0 : 0;
      const vb = chB ? chB[i] || 0 : 0;
      outData[i] = Math.max(-1, Math.min(1, va + vb));
    }
    out.copyToChannel(outData, c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1d. FLAC Encoder NYATA (lossless, 16/24-bit) — murni TypeScript, tanpa dependensi.
// Memakai prediktor FIXED (order 0-4) + Rice coding, dan decorrelation stereo
// (L/R, L/S, R/S, M/S) yang dipilih per frame. Hasilnya berkas .flac valid.
// ---------------------------------------------------------------------------
class BitWriter {
  buf = new Uint8Array(1 << 16);
  len = 0;
  private cur = 0;
  private nbits = 0;

  private push(b: number) {
    if (this.len >= this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf);
      this.buf = nb;
    }
    this.buf[this.len++] = b;
  }
  /** Tulis `n` bit (n <= 32) dari `value` (>= 0, < 2^n). */
  write(value: number, n: number) {
    while (n > 0) {
      const take = Math.min(8 - this.nbits, n);
      const shift = n - take;
      const chunk = Math.floor(value / Math.pow(2, shift)) & ((1 << take) - 1);
      this.cur = (this.cur << take) | chunk;
      this.nbits += take;
      n -= take;
      if (this.nbits === 8) {
        this.push(this.cur & 0xff);
        this.cur = 0;
        this.nbits = 0;
      }
    }
  }
  writeSigned(value: number, n: number) {
    this.write(value < 0 ? value + Math.pow(2, n) : value, n);
  }
  writeUnary(q: number) {
    // q nol diikuti satu bit 1
    while (q > 0 && this.nbits !== 0) {
      this.write(0, 1);
      q--;
    }
    while (q >= 8) {
      this.push(0);
      q -= 8;
    }
    while (q > 0) {
      this.write(0, 1);
      q--;
    }
    this.write(1, 1);
  }
  align() {
    if (this.nbits !== 0) this.write(0, 8 - this.nbits);
  }
  bytes() {
    return this.buf.subarray(0, this.len);
  }
}

const CRC8_TABLE = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff;
    t[i] = c;
  }
  return t;
})();
const CRC16_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 8;
    for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff;
    t[i] = c;
  }
  return t;
})();
const crc8 = (b: Uint8Array) => {
  let c = 0;
  for (let i = 0; i < b.length; i++) c = CRC8_TABLE[c ^ b[i]];
  return c;
};
const crc16 = (b: Uint8Array) => {
  let c = 0;
  for (let i = 0; i < b.length; i++) c = ((c << 8) & 0xffff) ^ CRC16_TABLE[((c >> 8) ^ b[i]) & 0xff];
  return c;
};

interface SubframePlan {
  kind: 'constant' | 'verbatim' | 'fixed';
  order: number;
  partOrder: number;
  params: number[];
  residual: Int32Array;
  bits: number;
}

function planSubframe(x: Int32Array, bps: number): SubframePlan {
  const n = x.length;
  const verbatimBits = 8 + n * bps;

  let allSame = true;
  for (let i = 1; i < n; i++) {
    if (x[i] !== x[0]) {
      allSame = false;
      break;
    }
  }
  if (allSame) {
    return { kind: 'constant', order: 0, partOrder: 0, params: [], residual: new Int32Array(0), bits: 8 + bps };
  }

  // Pilih order FIXED terbaik lewat jumlah |residual|
  const maxOrder = Math.min(4, n - 1);
  let bestOrder = 0;
  let bestSum = Infinity;
  for (let o = 0; o <= maxOrder; o++) {
    let sum = 0;
    for (let i = o; i < n; i++) {
      let r: number;
      switch (o) {
        case 0: r = x[i]; break;
        case 1: r = x[i] - x[i - 1]; break;
        case 2: r = x[i] - 2 * x[i - 1] + x[i - 2]; break;
        case 3: r = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
        default: r = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
      }
      sum += r < 0 ? -r : r;
    }
    if (sum < bestSum) {
      bestSum = sum;
      bestOrder = o;
    }
  }

  const order = bestOrder;
  const residual = new Int32Array(n - order);
  for (let i = order; i < n; i++) {
    let r: number;
    switch (order) {
      case 0: r = x[i]; break;
      case 1: r = x[i] - x[i - 1]; break;
      case 2: r = x[i] - 2 * x[i - 1] + x[i - 2]; break;
      case 3: r = x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3]; break;
      default: r = x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
    residual[i - order] = r;
  }
  // folded (zigzag) value u = 2r (r>=0) | -2r-1 (r<0)
  const u = new Float64Array(residual.length);
  for (let i = 0; i < residual.length; i++) {
    const r = residual[i];
    u[i] = r >= 0 ? 2 * r : -2 * r - 1;
  }

  // Cari partition order terbaik
  let maxP = 0;
  while (maxP < 8 && n % (1 << (maxP + 1)) === 0 && (n >> (maxP + 1)) > order) maxP++;
  let best: { p: number; params: number[]; bits: number } | null = null;
  for (let p = 0; p <= maxP; p++) {
    const parts = 1 << p;
    const psize = n >> p;
    const params: number[] = [];
    let bits = 0;
    let idx = 0;
    for (let k = 0; k < parts; k++) {
      const cnt = k === 0 ? psize - order : psize;
      let sum = 0;
      for (let i = 0; i < cnt; i++) sum += u[idx + i];
      idx += cnt;
      let bestK = 0;
      let bestB = Infinity;
      for (let kk = 0; kk <= 30; kk++) {
        const b = cnt * (kk + 1) + Math.floor(sum / Math.pow(2, kk));
        if (b < bestB) {
          bestB = b;
          bestK = kk;
        }
        if (Math.pow(2, kk) > sum + 1) break;
      }
      params.push(bestK);
      bits += 5 + bestB;
    }
    if (!best || bits < best.bits) best = { p, params, bits };
  }
  const totalBits = 8 + order * bps + 2 + 4 + best!.bits;
  if (totalBits >= verbatimBits) {
    return { kind: 'verbatim', order: 0, partOrder: 0, params: [], residual: new Int32Array(0), bits: verbatimBits };
  }
  return { kind: 'fixed', order, partOrder: best!.p, params: best!.params, residual, bits: totalBits };
}

function writeSubframe(w: BitWriter, plan: SubframePlan, x: Int32Array, bps: number) {
  const n = x.length;
  w.write(0, 1);
  if (plan.kind === 'constant') {
    w.write(0, 6);
    w.write(0, 1);
    w.writeSigned(x[0], bps);
    return;
  }
  if (plan.kind === 'verbatim') {
    w.write(1, 6);
    w.write(0, 1);
    for (let i = 0; i < n; i++) w.writeSigned(x[i], bps);
    return;
  }
  w.write(8 + plan.order, 6);
  w.write(0, 1);
  for (let i = 0; i < plan.order; i++) w.writeSigned(x[i], bps);
  w.write(1, 2); // metode residual: parameter Rice 5-bit
  w.write(plan.partOrder, 4);
  const parts = 1 << plan.partOrder;
  const psize = n >> plan.partOrder;
  let idx = 0;
  for (let k = 0; k < parts; k++) {
    const cnt = k === 0 ? psize - plan.order : psize;
    const par = plan.params[k];
    w.write(par, 5);
    const div = Math.pow(2, par);
    for (let i = 0; i < cnt; i++) {
      const r = plan.residual[idx + i];
      const u = r >= 0 ? 2 * r : -2 * r - 1;
      const q = Math.floor(u / div);
      w.writeUnary(q);
      if (par > 0) w.write(u - q * div, par);
    }
    idx += cnt;
  }
}

function writeUtf8Number(w: BitWriter, v: number) {
  if (v < 0x80) { w.write(v, 8); return; }
  if (v < 0x800) { w.write(0xc0 | (v >> 6), 8); w.write(0x80 | (v & 0x3f), 8); return; }
  if (v < 0x10000) { w.write(0xe0 | (v >> 12), 8); w.write(0x80 | ((v >> 6) & 0x3f), 8); w.write(0x80 | (v & 0x3f), 8); return; }
  w.write(0xf0 | (v >> 18), 8);
  w.write(0x80 | ((v >> 12) & 0x3f), 8);
  w.write(0x80 | ((v >> 6) & 0x3f), 8);
  w.write(0x80 | (v & 0x3f), 8);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Encode AudioBuffer menjadi FLAC lossless sungguhan.
 * @param bitDepth 16 atau 24 (nilai PCM yang disimpan di berkas)
 */
export async function encodeFlac(
  buffer: AudioBuffer,
  bitDepth: 16 | 24 = 16,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const nCh = Math.min(8, buffer.numberOfChannels);
  const total = buffer.length;
  const bps = bitDepth;
  const blockSize = 4096;
  const posScale = Math.pow(2, bps - 1) - 1;
  const negScale = Math.pow(2, bps - 1);

  // Kuantisasi sekali untuk seluruh berkas
  const pcm: Int32Array[] = [];
  for (let c = 0; c < nCh; c++) {
    const src = buffer.getChannelData(c);
    const q = new Int32Array(total);
    for (let i = 0; i < total; i++) {
      const s = Math.max(-1, Math.min(1, src[i]));
      q[i] = Math.round(s < 0 ? s * negScale : s * posScale);
    }
    pcm.push(q);
  }

  const frames: Uint8Array[] = [];
  let minFrame = Infinity;
  let maxFrame = 0;
  const bpsCode = bps === 16 ? 4 : 6; // 100 = 16-bit, 110 = 24-bit

  for (let start = 0, fno = 0; start < total; start += blockSize, fno++) {
    const n = Math.min(blockSize, total - start);
    const chans = pcm.map((p) => p.subarray(start, start + n));

    // Pilih penugasan kanal & rencana subframe
    let assign = nCh - 1;
    let subs: { x: Int32Array; bps: number; plan: SubframePlan }[];
    if (nCh === 2) {
      const L = chans[0];
      const R = chans[1];
      const M = new Int32Array(n);
      const S = new Int32Array(n);
      for (let i = 0; i < n; i++) {
        M[i] = (L[i] + R[i]) >> 1;
        S[i] = L[i] - R[i];
      }
      const pL = planSubframe(L, bps);
      const pR = planSubframe(R, bps);
      const pM = planSubframe(M, bps);
      const pS = planSubframe(S, bps + 1);
      const options = [
        { a: 1, bits: pL.bits + pR.bits, s: [{ x: L, bps, plan: pL }, { x: R, bps, plan: pR }] },
        { a: 8, bits: pL.bits + pS.bits, s: [{ x: L, bps, plan: pL }, { x: S, bps: bps + 1, plan: pS }] },
        { a: 9, bits: pS.bits + pR.bits, s: [{ x: S, bps: bps + 1, plan: pS }, { x: R, bps, plan: pR }] },
        { a: 10, bits: pM.bits + pS.bits, s: [{ x: M, bps, plan: pM }, { x: S, bps: bps + 1, plan: pS }] },
      ];
      const best = options.reduce((a, b) => (b.bits < a.bits ? b : a));
      assign = best.a === 1 ? 1 : best.a;
      subs = best.s;
    } else {
      subs = chans.map((x) => ({ x, bps, plan: planSubframe(x, bps) }));
    }

    const w = new BitWriter();
    // Header frame
    w.write(0xfff8, 16); // sync + fixed block size
    const bsCode = n === 4096 ? 12 : n <= 256 ? 6 : 7;
    w.write(bsCode, 4);
    w.write(0, 4); // sample rate dari STREAMINFO
    w.write(assign, 4);
    w.write(bpsCode, 3);
    w.write(0, 1);
    writeUtf8Number(w, fno);
    if (bsCode === 6) w.write(n - 1, 8);
    else if (bsCode === 7) w.write(n - 1, 16);
    w.write(crc8(w.bytes()), 8);

    for (const s of subs) writeSubframe(w, s.plan, s.x, s.bps);
    w.align();
    w.write(crc16(w.bytes()), 16);

    const bytes = w.bytes().slice();
    frames.push(bytes);
    minFrame = Math.min(minFrame, bytes.length);
    maxFrame = Math.max(maxFrame, bytes.length);

    if ((fno & 7) === 0) {
      onProgress?.(Math.min(99, Math.round((start / total) * 100)));
      await tick();
    }
  }

  // STREAMINFO (34 byte). MD5 diisi nol = "tidak diset" (valid menurut spesifikasi).
  const si = new BitWriter();
  const siBlock = Math.max(16, Math.min(blockSize, total)); // dekoder menolak blocksize STREAMINFO < 16
  si.write(siBlock, 16);
  si.write(siBlock, 16);
  si.write(frames.length ? minFrame : 0, 24);
  si.write(frames.length ? maxFrame : 0, 24);
  si.write(buffer.sampleRate, 20);
  si.write(nCh - 1, 3);
  si.write(bps - 1, 5);
  si.write(Math.floor(total / 4294967296), 4);
  si.write(total % 4294967296, 32);
  for (let i = 0; i < 16; i++) si.write(0, 8);

  const head = new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x80, 0x00, 0x00, 0x22]);
  onProgress?.(100);
  return new Blob([head, si.bytes().slice(), ...frames], { type: 'audio/flac' });
}

// ---------------------------------------------------------------------------
// 1e. MP3 Encoder NYATA (LAME via lamejs). Butuh: npm i @breezystack/lamejs
// Dimuat lazy supaya tidak membebani bundle awal.
// ---------------------------------------------------------------------------
const MP3_RATES_MPEG1 = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MP3_RATES_MPEG2 = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const MP3_SAMPLE_RATES = [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];

function snapBitrate(kbps: number, sampleRate: number) {
  const list = sampleRate >= 32000 ? MP3_RATES_MPEG1 : MP3_RATES_MPEG2;
  return list.reduce((a, b) => (Math.abs(b - kbps) < Math.abs(a - kbps) ? b : a));
}

async function resampleForMp3(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil((buffer.length * targetRate) / buffer.sampleRate));
  const off = new OfflineAudioContext(Math.min(2, buffer.numberOfChannels), length, targetRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start(0);
  return off.startRendering();
}

export async function encodeMp3(
  buffer: AudioBuffer,
  kbps = 320,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const mod: any = await import('@breezystack/lamejs');
  const Mp3Encoder = mod.Mp3Encoder ?? mod.default?.Mp3Encoder;
  if (!Mp3Encoder) throw new Error('Encoder MP3 (lamejs) tidak ditemukan.');

  let work = buffer;
  if (!MP3_SAMPLE_RATES.includes(buffer.sampleRate)) {
    work = await resampleForMp3(buffer, 44100);
  }
  const channels = Math.min(2, work.numberOfChannels);
  const rate = snapBitrate(kbps, work.sampleRate);
  const encoder = new Mp3Encoder(channels, work.sampleRate, rate);

  const toInt16 = (src: Float32Array) => {
    const out = new Int16Array(src.length);
    for (let i = 0; i < src.length; i++) {
      const s = Math.max(-1, Math.min(1, src[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  };
  const left = toInt16(work.getChannelData(0));
  const right = channels === 2 ? toInt16(work.getChannelData(1)) : null;

  const parts: Uint8Array[] = [];
  const block = 1152 * 16;
  for (let i = 0, n = 0; i < left.length; i += block, n++) {
    const l = left.subarray(i, i + block);
    const chunk = right ? encoder.encodeBuffer(l, right.subarray(i, i + block)) : encoder.encodeBuffer(l);
    if (chunk.length) parts.push(new Uint8Array(chunk));
    if ((n & 15) === 0) {
      onProgress?.(Math.min(99, Math.round((i / left.length) * 100)));
      await tick();
    }
  }
  const tail = encoder.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  onProgress?.(100);
  return new Blob(parts, { type: 'audio/mpeg' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// 2. Export Helper dengan encoder nyata per format
//  - WAV : PCM 8/16/24-bit
//  - MP3 : LAME (lamejs), default 320 kbps CBR
//  - FLAC: lossless 16/24-bit (encoder bawaan di file ini)
//  - M4A : encoder bawaan browser (AAC, atau Opus bila AAC tidak ada)
// Jika sebuah encoder gagal dimuat, berkas disimpan sebagai WAV dan `note` menjelaskannya.
export interface ExportAudioOptions {
  /** Kedalaman bit untuk WAV (8/16/24) dan FLAC (16/24). Default 16. */
  bitDepth?: 8 | 16 | 24;
  /** Bitrate MP3 dalam kbps (default 320). */
  mp3Kbps?: number;
  onProgress?: (percent: number) => void;
}

export async function exportAudioFile(
  buffer: AudioBuffer,
  fileName: string,
  format: 'WAV' | 'MP3' | 'M4A' | 'FLAC',
  options: ExportAudioOptions = {}
): Promise<{ success: boolean; mimeType: string; actualFormat: string; note?: string }> {
  let blob: Blob | null = null;
  let ext = 'wav';
  let mimeType = 'audio/wav';
  let note: string | undefined;
  const depth = options.bitDepth ?? 16;

  if (format === 'M4A') {
    const enc = await encodeCompressedAudio(buffer, 192, options.onProgress);
    blob = enc.blob;
    ext = enc.extension;
    mimeType = enc.mimeType;
    if (ext !== 'm4a') {
      note = `Browser ini tidak punya encoder M4A, berkas disimpan sebagai .${ext}.`;
    }
  } else if (format === 'MP3') {
    try {
      blob = await encodeMp3(buffer, options.mp3Kbps ?? 320, options.onProgress);
      ext = 'mp3';
      mimeType = 'audio/mpeg';
    } catch (err) {
      console.error('Encode MP3 gagal:', err);
      note = 'Encoder MP3 gagal dimuat, berkas disimpan sebagai WAV.';
    }
  } else if (format === 'FLAC') {
    blob = await encodeFlac(buffer, depth === 24 ? 24 : 16, options.onProgress);
    ext = 'flac';
    mimeType = 'audio/flac';
  }

  if (!blob) {
    blob = audioBufferToWav(buffer, depth);
    options.onProgress?.(100);
  }

  const cleanName = fileName.replace(/[^\w\s.-]/gi, '').trim() || 'PlayMuzeck_Export';
  downloadBlob(blob, `${cleanName}.${ext}`);
  return { success: true, mimeType, actualFormat: ext.toUpperCase(), note };
}

// 3. Real MIDI File Generator (Standard MIDI File Type 0)
export function generateMidiFile(
  bpm: number,
  events: Array<{
    step: number; // 0 to 31 (16th notes)
    note: number; // MIDI note number (e.g. 36 = kick, 60 = middle C)
    velocity?: number;
    durationSteps?: number; // duration in 16th notes
    isDrum?: boolean;
    // Channel eksplisit (0-15). Kalau tidak diisi: drum -> channel 9,
    // melodi/akor -> channel 0. Dipakai supaya Progresi Akor 2 (opsional)
    // bisa ditulis di channel 1 dengan Program Change GM-nya sendiri,
    // terpisah dari Progresi Akor 1 di channel 0.
    channel?: number;
  }>,
  trackName: string = 'PlayMuzeck Pattern',
  // Nomor program GM (0-127) untuk channel melodi/akor UTAMA (channel 0),
  // sesuai instrumen yang sedang dipilih di editor (selectedProgram). SEBELUMNYA
  // tidak ada Program Change sama sekali di sini, jadi DAW/player selalu
  // memutar channel 0 dengan patch DEFAULT-nya sendiri (biasanya Acoustic
  // Grand Piano) berapa pun program yang sebenarnya dipilih pengguna.
  programNumber: number = 0,
  // Nomor program GM (0-127) untuk Progresi Akor 2 (channel 1), opsional.
  // Program Change untuk channel 1 HANYA ditulis kalau ada event yang
  // benar-benar memakai channel tsb.
  programNumber2?: number
): Blob {
  const division = 480; // ticks per quarter note
  const ticksPerStep = division / 4; // 120 ticks per 16th note

  // Microseconds per quarter note: 60,000,000 / BPM
  const safeBpm = Number.isFinite(bpm) && bpm > 0 ? Math.min(400, Math.max(20, bpm)) : 120;
  const mpqn = Math.round(60000000 / safeBpm);

  // Group events by tick time
  interface MidiAction {
    tick: number;
    type: 'on' | 'off';
    note: number;
    velocity: number;
    channel: number;
  }

  const actions: MidiAction[] = [];

  events.forEach((ev) => {
    const startTick = ev.step * ticksPerStep;
    const duration = (ev.durationSteps || 1) * ticksPerStep;
    const endTick = startTick + Math.max(1, duration - 10);
    const channel = ev.channel !== undefined ? ev.channel : ev.isDrum ? 9 : 0; // Channel 10 (0-indexed 9) is MIDI standard drum channel; channel 1 = Progresi Akor 2
    const vel = ev.velocity || 100;

    actions.push({
      tick: startTick,
      type: 'on',
      note: ev.note,
      velocity: vel,
      channel,
    });

    actions.push({
      tick: endTick,
      type: 'off',
      note: ev.note,
      velocity: 0,
      channel,
    });
  });

  // Sort actions by tick
  actions.sort((a, b) => a.tick - b.tick);

  // Build Track Data Chunk
  const trackBytes: number[] = [];

  // Track Name meta event
  trackName = trackName.replace(/[^\x20-\x7e]/g, '').slice(0, 100); // meta length 1 byte & harus ASCII
  trackBytes.push(0x00, 0xff, 0x03, trackName.length);
  for (let i = 0; i < trackName.length; i++) {
    trackBytes.push(trackName.charCodeAt(i));
  }

  // Set Tempo meta event (delta 0, 0xFF, 0x51, 0x03, 3 bytes tempo)
  trackBytes.push(
    0x00,
    0xff,
    0x51,
    0x03,
    (mpqn >> 16) & 0xff,
    (mpqn >> 8) & 0xff,
    mpqn & 0xff
  );

  // Time Signature meta event (4/4 time)
  trackBytes.push(0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08);

  // Program Change untuk channel 0 (melodi/akor) — pastikan DAW/player
  // membuka file ini dengan instrumen GM yang sama dengan yang dipakai
  // untuk merender chord pad di editor (selectedProgram), bukan patch
  // default channel tsb. Channel 9 (drum) sengaja TIDAK diberi Program
  // Change: di GM, not drum (36/38/42/dst) sudah tetap artinya sendiri
  // (Bass Drum/Snare/Hi-Hat) terlepas dari "kit" karakter synth yang
  // dipakai di aplikasi, jadi tidak ada program GM yang perlu disetel.
  trackBytes.push(0x00, 0xc0 | 0, programNumber & 0x7f);

  // Program Change untuk channel 1 (Progresi Akor 2, opsional) — hanya
  // ditulis kalau ada event yang benar-benar memakai channel 1, supaya
  // file MIDI tetap bersih/minimal saat Progresi Akor 2 tidak diaktifkan.
  const usesChannel1 = events.some((ev) => ev.channel === 1);
  if (usesChannel1 && programNumber2 !== undefined) {
    trackBytes.push(0x00, 0xc0 | 1, programNumber2 & 0x7f);
  }

  let lastTick = 0;

  actions.forEach((act) => {
    const delta = act.tick - lastTick;
    lastTick = act.tick;

    // Write delta time as variable length quantity
    writeVarInt(trackBytes, delta);

    if (act.type === 'on') {
      trackBytes.push(0x90 | (act.channel & 0x0f));
      trackBytes.push(act.note & 0x7f);
      trackBytes.push(act.velocity & 0x7f);
    } else {
      trackBytes.push(0x80 | (act.channel & 0x0f));
      trackBytes.push(act.note & 0x7f);
      trackBytes.push(0);
    }
  });

  // End of Track meta event
  writeVarInt(trackBytes, 0);
  trackBytes.push(0xff, 0x2f, 0x00);

  // Build Header Chunk
  const headerBytes: number[] = [
    // 'MThd'
    0x4d, 0x54, 0x68, 0x64,
    // length = 6
    0x00, 0x00, 0x00, 0x06,
    // format = 0 (single track)
    0x00, 0x00,
    // num tracks = 1
    0x00, 0x01,
    // division
    (division >> 8) & 0xff,
    division & 0xff,
  ];

  // Track chunk header: 'MTrk' + 4-byte length
  const trackLength = trackBytes.length;
  const trackHeader: number[] = [
    0x4d,
    0x54,
    0x72,
    0x6b,
    (trackLength >> 24) & 0xff,
    (trackLength >> 16) & 0xff,
    (trackLength >> 8) & 0xff,
    trackLength & 0xff,
  ];

  const fullMidi = new Uint8Array([
    ...headerBytes,
    ...trackHeader,
    ...trackBytes,
  ]);

  return new Blob([fullMidi], { type: 'audio/midi' });
}

function writeVarInt(arr: number[], value: number) {
  let buffer = value & 0x7f;
  while ((value >>= 7)) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }
  while (true) {
    arr.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
}

// 4. Download helper
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
