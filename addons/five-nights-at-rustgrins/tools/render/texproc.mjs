// Node-side texture processing for the world renderer (pngjs; no premultiplied-alpha losses).
// Produces cached PNGs under tools/.cache/render/tex/:
//   color  : flipbook frame 0, biome tint applied
//   pbr    : three.js layout  G = roughness, B = metalness  (from Bedrock MER(S): R metal, G emissive, B rough)
//   emi    : emissive colour = albedo * MER.G
//   nrm    : tangent-space normal map derived from a heightmap (per texel, VV-like faceting)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { ROOT } from './fetch_vanilla.mjs';

export const RENDER_CACHE = path.join(ROOT, 'tools/.cache/render');
const TEX_DIR = path.join(RENDER_CACHE, 'tex');

export function readPNG(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
}
export function writePNGFile(file, img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, PNG.sync.write(png));
  return file;
}
function keyOf(parts) {
  const h = crypto.createHash('sha1');
  for (const p of parts) {
    if (typeof p === 'string' && fs.existsSync(p)) { h.update(p); h.update(String(fs.statSync(p).mtimeMs)); }
    else h.update(JSON.stringify(p ?? null));
  }
  return h.digest('hex').slice(0, 20);
}
function cached(parts, kind, make) {
  const file = path.join(TEX_DIR, `${keyOf(parts)}_${kind}.png`);
  if (fs.existsSync(file)) return file;
  const img = make();
  if (!img) return null;
  return writePNGFile(file, img);
}
function crop(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) out.set(img.data.subarray(y * img.width * 4, y * img.width * 4 + w * 4), y * w * 4);
  return { width: w, height: h, data: out };
}
function resizeNearest(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = Math.floor(x * img.width / w), sy = Math.floor(y * img.height / h);
    out.set(img.data.subarray((sy * img.width + sx) * 4, (sy * img.width + sx) * 4 + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, data: out };
}
const frame0 = (img, frames) => (frames > 1 ? crop(img, img.width, img.width) : img);
const hexRGB = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);

/** Generated magenta/black "missing" texture. */
export function missingTexture() {
  return cached(['missing-v1'], 'color', () => {
    const d = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const m = ((x >> 3) ^ (y >> 3)) & 1;
      d.set(m ? [248, 0, 248, 255] : [0, 0, 0, 255], (y * 16 + x) * 4);
    }
    return { width: 16, height: 16, data: d };
  });
}

/**
 * Process one texture descriptor (in place). Fields read: file, frames, tint, tintMode, mers, mersKind,
 * mersUniform, height, normal, autoEmissive. Fields written: colorFile, pbrFile, emiFile, nrmFile,
 * emissive (bool), roughAvg, metalAvg.
 */
export function processTexture(t) {
  if (!t.file) { t.colorFile = missingTexture(); return t; }
  const frames = t.frames ?? 1;
  let src = null;
  const color = () => (src ??= frame0(readPNG(t.file), frames));
  // colour
  if (frames > 1 || t.tint) {
    t.colorFile = cached([t.file, frames, t.tint, t.tintMode, 'c2'], 'color', () => {
      const img = color();
      const out = new Uint8Array(img.data);
      if (t.tint) {
        const [tr, tg, tb] = hexRGB(t.tint);
        for (let k = 0; k < out.length; k += 4) {
          const a = out[k + 3] / 255;
          const f = t.tintMode === 'overlay' ? a : 1;
          out[k] = out[k] * (1 - f + f * tr); out[k + 1] = out[k + 1] * (1 - f + f * tg); out[k + 2] = out[k + 2] * (1 - f + f * tb);
          if (t.tintMode === 'overlay') out[k + 3] = 255;
        }
      }
      return { width: img.width, height: img.height, data: out };
    });
  } else t.colorFile = t.file;
  // MER(S)
  if (t.mers) {
    const merFrames = (() => { try { const m = readPNG(t.mers); return m.height > m.width && m.height % m.width === 0 && frames > 1 ? m.height / m.width : 1; } catch { return 1; } })();
    let stats = null;
    const loadMer = () => { const c = color(); return resizeNearest(frame0(readPNG(t.mers), merFrames), c.width, c.height); };
    t.pbrFile = cached([t.file, t.mers, frames, 'p2'], 'pbr', () => {
      const m = loadMer();
      const out = new Uint8Array(m.data.length);
      for (let k = 0; k < out.length; k += 4) { out[k] = 0; out[k + 1] = m.data[k + 2]; out[k + 2] = m.data[k]; out[k + 3] = 255; }
      return { width: m.width, height: m.height, data: out };
    });
    t.emiFile = cached([t.file, t.mers, frames, t.tint, 'e2'], 'emi', () => {
      const m = loadMer(), c = color();
      let any = 0;
      const out = new Uint8Array(m.data.length);
      for (let k = 0; k < out.length; k += 4) {
        const g = m.data[k + 1] / 255 * (c.data[k + 3] / 255);
        if (g > 0.02) any++;
        out[k] = c.data[k] * g; out[k + 1] = c.data[k + 1] * g; out[k + 2] = c.data[k + 2] * g; out[k + 3] = 255;
      }
      return any ? { width: m.width, height: m.height, data: out } : null;
    });
    // averages (cheap, for logging / fallbacks)
    try {
      const m = loadMer(); let r = 0, mt = 0, n = 0;
      for (let k = 0; k < m.data.length; k += 4) { if (color().data[k + 3] < 8) continue; r += m.data[k + 2]; mt += m.data[k]; n++; }
      stats = n ? { rough: r / n / 255, metal: mt / n / 255 } : null;
    } catch { /* ignore */ }
    t.roughAvg = stats?.rough ?? null; t.metalAvg = stats?.metal ?? null;
  } else if (t.autoEmissive) {
    t.emiFile = cached([t.file, frames, t.tint, 'ae2'], 'emi', () => {
      const c = color();
      let any = 0;
      const out = new Uint8Array(c.data.length);
      for (let k = 0; k < out.length; k += 4) {
        const l = (0.3 * c.data[k] + 0.59 * c.data[k + 1] + 0.11 * c.data[k + 2]) / 255;
        const g = c.data[k + 3] > 8 && l > 0.62 ? Math.min(1, (l - 0.55) * 3) : 0;
        if (g) any++;
        out[k] = c.data[k] * g; out[k + 1] = c.data[k + 1] * g; out[k + 2] = c.data[k + 2] * g; out[k + 3] = 255;
      }
      return any ? { width: c.width, height: c.height, data: out } : null;
    });
  }
  t.emissive = !!t.emiFile;
  // normal map (given) or from heightmap
  if (t.normal) {
    t.nrmFile = cached([t.normal, frames, 'n1'], 'nrm', () => { const c = color(); const n = readPNG(t.normal); return resizeNearest(frame0(n, n.height > n.width && frames > 1 ? n.height / n.width : 1), c.width, c.height); });
  } else if (t.height) {
    t.nrmFile = cached([t.height, t.file, frames, 'h3'], 'nrm', () => {
      const c = color();
      const h0 = readPNG(t.height);
      const hm = resizeNearest(frame0(h0, h0.height > h0.width && frames > 1 ? h0.height / h0.width : 1), c.width, c.height);
      const W = hm.width, H = hm.height;
      const hv = (x, y) => hm.data[(((y + H) % H) * W + ((x + W) % W)) * 4] / 255;
      const s = 2.0 * (W / 16); // strength scales with texel density (16 px per block)
      const out = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (hv(x + 1, y) - hv(x - 1, y)) * 0.5, dy = (hv(x, y + 1) - hv(x, y - 1)) * 0.5;
        let nx = -dx * s, ny = dy * s, nz = 1;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const k = (y * W + x) * 4;
        out[k] = (nx * 0.5 + 0.5) * 255; out[k + 1] = (ny * 0.5 + 0.5) * 255; out[k + 2] = (nz * 0.5 + 0.5) * 255; out[k + 3] = 255;
      }
      return { width: W, height: H, data: out };
    });
  }
  return t;
}
