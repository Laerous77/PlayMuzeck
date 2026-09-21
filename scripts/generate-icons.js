import fs from 'fs';
import zlib from 'zlib';

// Minimal PNG encoder in pure JS without external dependencies
function createPng(width, height, r, g, b, innerShape = 'circle') {
  // 4 bytes signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth 8
  ihdr.writeUInt8(6, 9); // RGBA color type
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // Raw image data with filter type 0 for each row
  const rowBytes = width * 4 + 1;
  const rawData = Buffer.alloc(height * rowBytes);

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.42;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowBytes;
    rawData[rowOffset] = 0; // Filter None

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      // Gradient background in dark oxford blue #14213D -> #000000
      const normY = y / height;
      let pr = Math.round(20 * (1 - normY));
      let pg = Math.round(33 * (1 - normY));
      let pb = Math.round(61 * (1 - normY));
      let pa = 255;

      // Draw stylized icon inside
      if (dist < radius) {
        // Inner circle with golden/red accents
        if (Math.abs(dist - radius * 0.8) < 4) {
          // Ring
          pr = 252; pg = 163; pb = 17; // #FCA311
        } else if (Math.abs(dist - radius * 0.5) < 3) {
          pr = 252; pg = 18; pb = 18; // #FC1212
        } else if (dist < radius * 0.3) {
          // Center core
          pr = 252; pg = 163; pb = 17;
        }
      }

      rawData[pxOffset] = pr;
      rawData[pxOffset + 1] = pg;
      rawData[pxOffset + 2] = pb;
      rawData[pxOffset + 3] = pa;
    }
  }

  const compressedData = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressedData);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(len + 12);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, 'ascii');
  data.copy(buf, 8);

  const crc = calculateCrc(buf.subarray(4, len + 8));
  buf.writeUInt32BE(crc, len + 8);
  return buf;
}

function calculateCrc(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xedb88320;
      } else {
        crc = crc >>> 1;
      }
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

if (!fs.existsSync('public')) {
  fs.mkdirSync('public', { recursive: true });
}

fs.writeFileSync('public/PlayMuzeck-logo.png', createPng(192, 192));
fs.writeFileSync('public/PlayMuzeck-logo.png', createPng(512, 512));
fs.writeFileSync('public/PlayMuzeck-logo.png', createPng(512, 512));
fs.writeFileSync('public/PlayMuzeck-logo.png', createPng(180, 180));
console.log('PNG Icons successfully generated in /public!');
