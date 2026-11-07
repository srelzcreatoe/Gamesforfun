// Tiny PNG encoder/decoder-free helpers that work without a canvas, so the
// pack generator and tests can create textures and icons anywhere.
import { crc32 } from './zip.js';
import { bytesToBase64 } from './util.js';

function adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) { a = (a + data[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** Encodes RGBA pixels as a PNG using stored (uncompressed) deflate blocks. */
export function encodePNG(width, height, rgba) {
  const rowLen = width * 4 + 1;
  const raw = new Uint8Array(rowLen * height);
  for (let y = 0; y < height; y++) {
    raw[y * rowLen] = 0;
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * rowLen + 1);
  }
  const blocks = [];
  const MAX = 65535;
  for (let i = 0; i < raw.length || i === 0; i += MAX) {
    const chunk = raw.subarray(i, Math.min(raw.length, i + MAX));
    const last = i + MAX >= raw.length ? 1 : 0;
    const hdr = new Uint8Array(5);
    hdr[0] = last;
    hdr[1] = chunk.length & 0xff; hdr[2] = chunk.length >> 8;
    hdr[3] = ~chunk.length & 0xff; hdr[4] = (~chunk.length >> 8) & 0xff;
    blocks.push(hdr, chunk);
    if (raw.length === 0) break;
  }
  const zlen = 2 + blocks.reduce((a, b) => a + b.length, 0) + 4;
  const z = new Uint8Array(zlen);
  z[0] = 0x78; z[1] = 0x01;
  let p = 2;
  for (const b of blocks) { z.set(b, p); p += b.length; }
  const ad = adler32(raw);
  z[p++] = ad >>> 24; z[p++] = (ad >>> 16) & 0xff; z[p++] = (ad >>> 8) & 0xff; z[p++] = ad & 0xff;

  const chunks = [];
  const chunk = (type, data) => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    chunks.push(out);
  };
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, width); iv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('IDAT', z);
  chunk('IEND', new Uint8Array(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  const total = 8 + chunks.reduce((a, c) => a + c.length, 0);
  const png = new Uint8Array(total);
  png.set(sig, 0);
  let q = 8;
  for (const c of chunks) { png.set(c, q); q += c.length; }
  return png;
}

export const pngDataURL = (w, h, rgba) => 'data:image/png;base64,' + bytesToBase64(encodePNG(w, h, rgba));

/** Simple RGBA raster used by auto-paint and icon rendering. */
export class Raster {
  constructor(w, h) { this.w = w; this.h = h; this.px = new Uint8Array(w * h * 4); }
  set(x, y, r, g, b, a = 255) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = a;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return [0, 0, 0, 0];
    const i = (y * this.w + x) * 4;
    return [this.px[i], this.px[i + 1], this.px[i + 2], this.px[i + 3]];
  }
  blend(x, y, r, g, b, a) {
    if (a >= 255) return this.set(x, y, r, g, b, 255);
    if (a <= 0) return;
    const [r0, g0, b0, a0] = this.get(x, y);
    const t = a / 255, oa = t + (a0 / 255) * (1 - t);
    if (oa <= 0) return;
    this.set(x, y,
      (r * t + r0 * (a0 / 255) * (1 - t)) / oa,
      (g * t + g0 * (a0 / 255) * (1 - t)) / oa,
      (b * t + b0 * (a0 / 255) * (1 - t)) / oa,
      oa * 255);
  }
  toPNG() { return encodePNG(this.w, this.h, this.px); }
  toDataURL() { return pngDataURL(this.w, this.h, this.px); }
}
