'use strict';

const zlib = require('node:zlib');

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  length.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** Encode 8-bit RGBA pixels as a non-interlaced PNG. */
function encodePNG({ width, height, data }) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || data?.length !== width * height * 4) throw new Error('Provide RGBA pixels matching the image dimensions.');
  const stride = width * 4, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 6; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** Decode 8-bit grayscale, RGB, or RGBA non-interlaced PNGs into RGBA pixels. */
function decodePNG(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('Not a PNG image.');
  let offset = 8, width = 0, height = 0, colorType = 0;
  const idat = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); colorType = data[9];
      if (data[8] !== 8 || data[12] !== 0 || ![0, 2, 6].includes(colorType)) throw new Error('Only 8-bit non-interlaced grayscale, RGB, or RGBA PNGs are supported.');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || !height || !idat.length) throw new Error('The PNG has no image data.');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1, stride = width * channels;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  if (raw.length < (stride + 1) * height) throw new Error('The PNG image data is truncated.');
  const pixels = Buffer.alloc(stride * height), out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)], source = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? pixels[row + x - channels] : 0, b = y ? pixels[row - stride + x] : 0;
      const c = x >= channels && y ? pixels[row - stride + x - channels] : 0, value = raw[source + x];
      pixels[row + x] = filter === 0 ? value : filter === 1 ? value + a : filter === 2 ? value + b
        : filter === 3 ? value + ((a + b) >> 1) : filter === 4 ? value + paeth(a, b, c) : (() => { throw new Error('Unsupported PNG filter.'); })();
    }
  }
  for (let p = 0; p < width * height; p++) {
    const i = p * channels;
    if (channels === 1) out.set([pixels[i], pixels[i], pixels[i], 255], p * 4);
    else out.set([pixels[i], pixels[i + 1], pixels[i + 2], channels === 4 ? pixels[i + 3] : 255], p * 4);
  }
  return { width, height, data: out };
}

/** Area-average downscale so the longest side is at most maxSide, as the browser studio does before analysis. */
function downscale(image, maxSide = 1200) {
  const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
  if (scale === 1) return image;
  const width = Math.max(1, Math.round(image.width * scale)), height = Math.max(1, Math.round(image.height * scale));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const x0 = Math.floor(x / scale), x1 = Math.min(image.width, Math.max(x0 + 1, Math.floor((x + 1) / scale)));
    const y0 = Math.floor(y / scale), y1 = Math.min(image.height, Math.max(y0 + 1, Math.floor((y + 1) / scale)));
    const sum = [0, 0, 0, 0];
    for (let sy = y0; sy < y1; sy++) for (let sx = x0; sx < x1; sx++) {
      const i = (sy * image.width + sx) * 4;
      sum[0] += image.data[i]; sum[1] += image.data[i + 1]; sum[2] += image.data[i + 2]; sum[3] += image.data[i + 3];
    }
    const count = (x1 - x0) * (y1 - y0);
    data.set(sum.map(v => Math.round(v / count)), (y * width + x) * 4);
  }
  return { width, height, data };
}

module.exports = { encodePNG, decodePNG, downscale, crc32 };
