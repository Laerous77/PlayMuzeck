// Pure Client-Side Audio & MIDI Exporter for PlayMuzeck
// Generates real, binary playable files without server backend

// 1. WAV Encoder (PCM, bit depth dapat dipilih 8 atau 16 bit)
// bitDepth 8 dipakai sebagai fallback kompresi nyata (ukuran file benar-benar
// mengecil ~50% dibanding 16-bit) ketika browser tidak mendukung encoder
// codec asli (MediaRecorder/Opus/AAC).
export function audioBufferToWav(buffer: AudioBuffer, bitDepth: 8 | 16 = 16): Blob {
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
      if (bitDepth === 16) {
        // Scale to 16-bit signed int
        const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
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

// 1c. Penggabung Buffer (dipakai AI Vocal Separator untuk output ke-3:
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

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

// 2. Export Helper with MIME format selection
// Sebelumnya MP3/M4A/FLAC hanya mengganti ekstensi dari data WAV (file "palsu":
// ekstensi .mp3 tapi isinya WAV, sering gagal dibuka DAW/HP). Sekarang format
// yang tidak bisa di-encode browser diekspor jujur sebagai WAV.
export async function exportAudioFile(
  buffer: AudioBuffer,
  fileName: string,
  format: 'WAV' | 'MP3' | 'M4A' | 'FLAC'
): Promise<{ success: boolean; mimeType: string; actualFormat: string }> {
  let blob: Blob;
  let ext = 'wav';
  let mimeType = 'audio/wav';

  if (format === 'M4A') {
    const enc = await encodeCompressedAudio(buffer, 192);
    blob = enc.blob;
    ext = enc.extension;
    mimeType = enc.mimeType;
  } else {
    // MP3 & FLAC butuh encoder pihak ketiga (mis. lamejs / libflac.js) -> WAV asli.
    blob = audioBufferToWav(buffer);
  }

  const cleanName = fileName.replace(/[^\w\s.-]/gi, '').trim() || 'PlayMuzeck_Export';
  downloadBlob(blob, `${cleanName}.${ext}`);
  return { success: true, mimeType, actualFormat: ext.toUpperCase() };
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