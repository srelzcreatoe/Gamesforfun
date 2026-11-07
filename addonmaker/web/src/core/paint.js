// High-detail procedural texture painter.
// Paints every cube face at 1-4 pixels per model texel (the PNG is larger than
// the geometry's texture_width/height, which the game supports, as HD packs
// do), with face lighting, soft edge shading, skin variation, patterns and
// detailed faces. Glowing eyes get a low alpha, the same trick vanilla uses for
// enderman eyes: with the entity_emissive_alpha material those pixels glow in
// the dark while staying opaque.
import { Raster } from './png.js';
import { faceRects } from './geo.js';
import { hexToRgb, hashStr } from './util.js';

export const GLOW_ALPHA = 24;
export const EMISSIVE_MATERIAL = 'entity_emissive_alpha';
const GLOW_STYLES = new Set(['glow', 'rect', 'many', 'single', 'hollow']);
export const eyesGlow = (opts = {}) => opts.glowEyes !== false && opts.eyes !== false && GLOW_STYLES.has(opts.eyeStyle);

/** Pixels per model texel for the painted PNG (up to 512 px). */
export const hdScale = (model) => Math.max(1, Math.min(4, Math.floor(512 / Math.max(model.texW || 64, model.texH || 64))));

// ---- small math helpers ----
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const add = (a, b, f = 1) => [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f];
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(s | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y, s) => vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;
function rngOf(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0; s ^= s >>> 13; return (s >>> 0) / 4294967296; };
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  const t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
/** Wandering lines (cracks/veins) inside a w×h texel face. */
function walks(w, h, seed, n, branch) {
  const r = rngOf(seed), segs = [];
  const walk = (x, y, len, dir, depth) => {
    for (let i = 0; i < len; i++) {
      const nx = clamp(x + (r() - 0.5) * 1.4 + dir * 0.25, 0, w), ny = y + 0.6 + r() * 0.5;
      if (ny > h) break;
      segs.push([x, y, nx, ny]);
      if (branch && depth < 2 && r() < 0.12) walk(nx, ny, Math.floor(len * 0.4), r() < 0.5 ? -1.6 : 1.6, depth + 1);
      x = nx; y = ny;
    }
  };
  for (let i = 0; i < n; i++) walk(r() * w, r() * h * 0.3, Math.ceil(h * 1.4), 0, 0);
  return segs;
}
const minSeg = (segs, x, y) => { let m = 9; for (const s of segs) { const d = segDist(x, y, s[0], s[1], s[2], s[3]); if (d < m) m = d; } return m; };

const FACE_LIGHT = { up: 1.1, down: 0.66, north: 1.0, south: 0.88, east: 0.84, west: 0.84 };

/**
 * Options: noise, outline, outlineColor, eyes, eyeStyle (normal|glow|hollow|rect|sunken|many|single|button|none),
 * eyeColor, mouth (none|line|grin|bigGrin|stitched|gape), faceColor, dripColor, toothColor, glowEyes, hd (false = 1:1)
 */
export function paintModel(model, opts = {}) {
  const {
    noise = 0.07, outline = true, outlineColor = null, eyes = true, seed = 7, eyeStyle = 'normal',
    eyeColor = '#ff2a2a', mouth = 'line', faceColor = null, dripColor = '#7a0d0d', toothColor = '#efe4bf',
  } = opts;
  const k = opts.hd === false ? 1 : hdScale(model);
  const R = new Raster(model.texW * k, model.texH * k);
  const oc = outlineColor ? hexToRgb(outlineColor) : null;
  const glow = eyesGlow(opts);
  for (const bone of model.bones) {
    const base = hexToRgb(bone.color || '#8a8a8a');
    const accent = hexToRgb(bone.color2 || '#ffffff');
    bone.cubes.forEach((cube, ci) => {
      const rects = faceRects(cube);
      for (const [face, r] of Object.entries(rects)) {
        if (r.w <= 0 || r.h <= 0) continue;
        paintSurface(R, k, r, face, { base, accent, pattern: bone.pattern, noise, outline, oc, seed: seed + hashStr(`${bone.name}${face}${ci}`), front: ci === 0 && bone.role === 'body' });
      }
      const f = rects.north;
      if (eyes && eyeStyle !== 'none' && ci === 0 && bone.role === 'head') {
        const light = FACE_LIGHT.north;
        paintFace(R, k, f, {
          style: eyeStyle, eye: hexToRgb(eyeColor), mouth: eyeStyle === 'normal' ? (model.template === 'blob' ? 'none' : mouth === 'line' ? 'smile' : mouth) : mouth,
          skin: mul(base, light), dark: mul(base, 0.3), drip: hexToRgb(dripColor), tooth: hexToRgb(toothColor),
          face: faceColor ? mul(hexToRgb(faceColor), light) : null, glow, seed: seed + hashStr(`${bone.name}face`),
        });
      } else if (eyes && eyeStyle !== 'none' && model.template === 'blob' && bone.role === 'body' && ci === 0) {
        paintFace(R, k, f, { style: 'normal', mouth: 'smile', skin: base, dark: mul(base, 0.3), eye: [30, 30, 40], drip: [0, 0, 0], tooth: [255, 255, 255], glow: false, seed });
      }
    });
  }
  return R;
}

/** One cube face: lighting, soft edges, skin variation, pattern and outline. */
function paintSurface(R, k, r, face, o) {
  const X0 = Math.round(r.x * k), Y0 = Math.round(r.y * k);
  const PW = Math.max(1, Math.round((r.x + r.w) * k) - X0), PH = Math.max(1, Math.round((r.y + r.h) * k) - Y0);
  const w = r.w, h = r.h, side = face !== 'up' && face !== 'down';
  const big = w >= 1.5 && h >= 1.5;
  const lw = Math.max(1, Math.round(k / 2));
  const cracks = o.pattern === 'cracks' || o.pattern === 'veins' || o.pattern === 'ribs' ? walks(w, h, o.seed, o.pattern === 'veins' ? 3 : 2, o.pattern !== 'cracks') : null;
  const grain = Math.max(1, Math.round(k / 2));
  for (let j = 0; j < PH; j++) {
    for (let i = 0; i < PW; i++) {
      const u = (i + 0.5) / k, v = (j + 0.5) / k; // texel coords inside the face
      const tv = clamp(v / h);
      let c = o.base;
      let t = 0;
      switch (o.pattern) {
        case 'stripes': { const f = ((u + v) / 3.2) % 1; t = smooth(0.0, 0.08, f) * (1 - smooth(0.36, 0.44, f)); break; }
        case 'gradient': t = tv * 0.6; break;
        case 'fade': t = clamp(Math.pow(tv, 1.3) + (fbm(u * 0.6, v * 0.6, o.seed) - 0.5) * 0.25); break;
        case 'spots': t = smooth(0.6, 0.66, fbm(u * 0.45, v * 0.45, o.seed)); break;
        case 'grime': t = smooth(0.48, 0.78, fbm(u * 0.8, v * 0.8, o.seed)) * 0.65 + tv * 0.15; break;
        case 'cracks': { const d = minSeg(cracks, u, v); t = d < 0.16 ? 1 : d < 0.32 ? -0.35 : 0; break; }
        case 'veins': { const d = minSeg(cracks, u, v); t = d < 0.12 ? 0.85 : d < 0.4 ? 0.25 * (1 - (d - 0.12) / 0.28) : 0; break; }
        case 'ribs': t = ribsAt(face, u, v, w, h, cracks); break;
        default: break;
      }
      if (t > 0) c = mix(c, o.accent, t);
      else if (t < 0) c = mul(c, 1 - t * 0.6); // light rim beside a crack
      // Light: face direction, darker towards the bottom of side faces, soft edge shading.
      let L = FACE_LIGHT[face] * (side ? 1.06 - 0.16 * tv : 1);
      if (big) { const e = Math.min(u, w - u, v, h - v); L *= 1 - 0.22 * Math.exp(-e * 1.5); }
      const g = hash2(Math.floor(i / grain), Math.floor(j / grain), o.seed);
      const n = (fbm(u * 0.7, v * 0.7, o.seed + 3) - 0.5) * 1.4 + (g - 0.5) * 0.9;
      c = mul(c, L * (1 + o.noise * n));
      const edge = PW > 2 * lw + 1 && PH > 2 * lw + 1 && (i < lw || j < lw || i >= PW - lw || j >= PH - lw);
      if (edge && o.oc) c = mix(c, o.oc, 0.85);
      else if (edge && o.outline) c = mul(c, 0.66);
      R.set(X0 + i, Y0 + j, clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255), 255);
    }
  }
}

function ribsAt(face, u, v, w, h, cracks) {
  if (face === 'north' && w >= 4 && h >= 6) {
    const cx = w / 2;
    if (Math.abs(u - cx) < 0.3 && v > h * 0.12 && v < h * 0.72) return 0.55; // sternum
    for (let i = 0; i < 5; i++) {
      const y0 = h * (0.16 + i * 0.115);
      if (y0 > h * 0.72) break;
      const q = (u - cx) / cx;
      const yr = y0 + Math.abs(q) * Math.abs(q) * h * 0.08;
      if (Math.abs(q) < 0.12 || Math.abs(q) > 0.95) continue;
      const d = v - yr;
      if (d > -0.28 && d < 0.18) return -0.45; // rib top catches light
      if (d >= 0.18 && d < 0.62) return 0.85; // shadow under the rib
    }
    return 0;
  }
  if (face === 'south' && w >= 3) {
    const cx = w / 2;
    if (Math.abs(u - cx) < 0.45 && v % 1.6 < 0.9) return -0.4; // spine knobs
    if (Math.abs(u - cx) < 0.7 && v % 1.6 >= 0.9) return 0.7;
  }
  return minSeg(cracks, u, v) < 0.14 ? 0.7 : 0;
}

/** Faces on the front of the head: eyes, sockets, glow, drips, mouths and teeth. */
function paintFace(R, k, f, o) {
  const X0 = Math.round(f.x * k), Y0 = Math.round(f.y * k);
  const PW = Math.round((f.x + f.w) * k) - X0, PH = Math.round((f.y + f.h) * k) - Y0;
  const fw = f.w, fh = f.h;
  if (fw < 3 || fh < 3) return;
  const r = rngOf(o.seed);
  const black = [8, 5, 7];
  const white = [255, 252, 240];
  const isRect = o.style === 'rect';
  const ey = fh * (isRect ? 0.3 : o.style === 'sunken' ? 0.33 : 0.34);
  const exs = [fw * 0.3, fw * 0.7];
  const erx = fw * (isRect ? 0.13 : o.style === 'sunken' ? 0.11 : 0.12), ery = fh * (isRect ? 0.065 : o.style === 'sunken' ? 0.14 : 0.08);
  // Drips under rectangular eyes.
  const drips = [];
  if (isRect) for (const ex of exs) for (let n = 0; n < 3; n++) drips.push({ x: ex - erx * 0.8 + r() * erx * 1.6, y: ey + ery, w: 0.22 + r() * 0.22, len: 0.8 + r() * fh * 0.22 });
  const many = [];
  if (o.style === 'many') for (let n = 0; n < Math.max(5, Math.floor(fw * fh / 10)); n++) many.push({ x: 1 + r() * (fw - 2), y: 0.8 + r() * fh * 0.55, s: 0.35 + r() * 0.6 });
  const mouthY = o.style === 'many' ? fh * 0.8 : fh * (o.mouth === 'bigGrin' ? 0.7 : 0.74);
  for (let j = 0; j < PH; j++) {
    for (let i = 0; i < PW; i++) {
      const x = (i + 0.5) / k, y = (j + 0.5) / k;
      const px = R.get(X0 + i, Y0 + j);
      let c = [px[0], px[1], px[2]];
      let glow = 0; // 0..1: how much this pixel is a glowing eye core
      // Face mask (e.g. a dark red face on a black body).
      if (o.face) {
        const d = Math.hypot((x - fw / 2) / (fw * 0.5), (y - fh * 0.56) / (fh * 0.52));
        c = mix(c, mul(o.face, 1 + (fbm(x * 0.8, y * 0.8, o.seed) - 0.5) * 0.3), (1 - smooth(0.7, 1.05, d)) * 0.92);
      }
      // Eyes.
      switch (o.style) {
        case 'normal': {
          for (const ex of exs) {
            const dx = Math.abs(x - ex) / (fw * 0.1), dy = Math.abs(y - ey) / (fh * 0.075);
            if (dx < 1 && dy < 1) {
              c = white;
              const pupX = ex + (ex < fw / 2 ? 1 : -1) * fw * 0.035;
              if (Math.abs(x - pupX) < fw * 0.055 && dy < 1) c = [40, 30, 36];
              if (Math.abs(x - pupX + fw * 0.02) < 0.3 && y < ey - fh * 0.02) c = [255, 255, 255];
            }
          }
          break;
        }
        case 'many': {
          for (const m of many) {
            const d = Math.hypot(x - m.x, (y - m.y) * 1.3) / m.s;
            if (d < 1.6) c = mix(c, black, (1 - smooth(1, 1.6, d)) * 0.85);
            if (d < 1) { const core = 1 - d; c = mix(o.eye, white, core * core * 0.7); glow = Math.max(glow, smooth(0.2, 0.6, core)); }
          }
          break;
        }
        case 'single': {
          const cx = fw / 2, cy = fh * 0.38, R0 = Math.min(fw, fh) * 0.24;
          const d = Math.hypot(x - cx, y - cy) / R0;
          if (d < 1.25) c = mix(c, black, (1 - smooth(1, 1.25, d)) * 0.9);
          if (d < 1) {
            c = mix([235, 225, 205], [200, 60, 50], smooth(0.6, 1, d) * 0.5 * (fbm(x * 3, y * 3, o.seed) > 0.55 ? 1 : 0.2));
            if (d < 0.58) { c = mix(o.eye, mul(o.eye, 0.55), d / 0.58); glow = smooth(0.25, 0.5, 1 - d); }
            if (d < 0.26) { c = black; glow = 0; }
            if (Math.hypot(x - cx + R0 * 0.25, y - cy + R0 * 0.25) < R0 * 0.12) c = white;
          }
          break;
        }
        case 'button': {
          for (const ex of exs) {
            const d = Math.hypot(x - ex, y - ey) / (fw * 0.12);
            if (d < 1) {
              c = mix([20, 16, 18], [60, 50, 54], 1 - d);
              const hx = Math.abs(x - ex) - fw * 0.035, hy = Math.abs(y - ey) - fw * 0.035;
              if (Math.hypot(hx, hy) < fw * 0.025) c = [5, 4, 4];
              if ((Math.abs(x - ex - (y - ey)) < 0.15 || Math.abs(x - ex + (y - ey)) < 0.15) && d < 0.7) c = mix(o.eye, [255, 255, 255], 0.1);
            }
          }
          break;
        }
        case 'none': break;
        default: {
          // glow, rect, hollow, sunken: a dark socket, then the eye inside it.
          for (const ex of exs) {
            const nx = (x - ex) / erx, ny = (y - ey) / ery;
            const box = isRect ? Math.max(Math.abs(nx), Math.abs(ny)) : Math.hypot(nx, ny);
            const sock = isRect ? 1.25 : o.style === 'sunken' ? 1.55 : 1.45;
            if (box < sock) c = mix(c, o.style === 'sunken' ? mix(o.dark, black, 0.55) : black, (1 - smooth(isRect ? 1.05 : 0.9, sock, box)) * (o.style === 'sunken' ? 0.95 : 0.9));
            if (o.style === 'sunken') {
              if (box < 1) c = mix(c, black, (1 - box) * 0.6);
              const pd = Math.hypot(x - (ex + (ex < fw / 2 ? 0.15 : -0.15)), y - ey * 1.02);
              if (pd < 0.42) { c = mix(white, o.eye, 0.1); glow = 0; }
              else if (pd < 0.7) c = mix(c, white, (0.7 - pd) * 0.6);
            } else if (o.style === 'hollow') {
              const pd = Math.hypot(x - ex, y - ey - ery * 0.25);
              if (pd < 0.45) { c = mix(o.eye, white, 0.3); glow = 1; } else if (pd < 1.1) c = add(c, o.eye, 0.25 * (1.1 - pd));
            } else if (box < 1) {
              const core = 1 - box;
              const hot = isRect ? smooth(0.3, 1, 1 - (ny + 1) / 2) * 0.5 : core * core * 0.75;
              c = mix(o.eye, white, hot);
              if (isRect && ny > 0.35) c = mul(o.eye, 0.82);
              glow = 1;
            } else if (box < 2.4 && !isRect) {
              c = add(c, o.eye, 0.32 * Math.pow(1 - (box - 1) / 1.4, 2)); // glow spilling onto the skin
            }
          }
          for (const d of drips) {
            const inX = Math.abs(x - d.x) < d.w, below = y - d.y;
            if (inX && below > 0 && below < d.len) c = mix(o.drip, mul(o.drip, 0.55), Math.abs(x - d.x) / d.w + below / d.len * 0.3);
            if (Math.hypot(x - d.x, y - d.y - d.len) < d.w * 1.35) c = mix(o.drip, [255, 120, 110], Math.max(0, 0.35 - Math.hypot(x - d.x + d.w * 0.4, y - d.y - d.len + d.w * 0.4)) * 1.5);
          }
        }
      }
      // Mouths.
      c = mouthAt(c, x, y, fw, fh, mouthY, o, black);
      const a = o.glow && glow > 0.5 ? GLOW_ALPHA : 255;
      R.set(X0 + i, Y0 + j, clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255), a);
    }
  }
}

function mouthAt(c, x, y, fw, fh, my, o, black) {
  const cx = fw / 2;
  switch (o.mouth) {
    case 'bigGrin': case 'grin': {
      const big = o.mouth === 'bigGrin';
      const half = fw * (big ? 0.43 : 0.28);
      const q = (x - cx) / half;
      if (Math.abs(q) > 1.12) return c;
      const curve = fh * (big ? 0.11 : 0.06) * q * q;
      const open = fh * (big ? 0.15 : 0.07) * Math.sqrt(Math.max(0, 1 - q * q));
      const mid = my - curve;
      const top = mid - open * 0.5, bot = mid + open * 0.5;
      // Smile creases past the corners.
      if (Math.abs(q) > 0.95 && Math.abs(q) < 1.12 && Math.abs(y - (mid - (Math.abs(q) - 0.95) * fh * 0.25)) < 0.22) return mix(c, black, 0.75);
      if (Math.abs(q) > 1) return c;
      const lip = 0.32;
      if (y < top - lip || y > bot + lip) return c;
      if (y < top || y > bot) return mix(o.drip, black, 0.45); // lips
      // Inside: dark throat, then jagged teeth meeting in the middle.
      let m = mix([60, 8, 10], black, 0.6 + Math.abs(q) * 0.3);
      const n = big ? Math.max(6, Math.round(fw / 1.1)) : Math.max(4, Math.round(fw / 1.4));
      const tw = (2 * half) / n;
      const pos = (x - (cx - half)) / tw;
      const fi = pos - Math.floor(pos);
      const tri = 1 - Math.abs(fi - 0.5) * 2; // 0 at tooth edges, 1 at tooth centre
      const span = bot - top;
      const upLen = span * (0.5 + 0.12 * (hash2(Math.floor(pos), 1, o.seed) - 0.5)) * tri;
      const posL = pos + 0.5, fl = posL - Math.floor(posL);
      const triL = 1 - Math.abs(fl - 0.5) * 2;
      const loLen = span * (0.48 + 0.12 * (hash2(Math.floor(posL), 2, o.seed) - 0.5)) * triL;
      if (y - top < upLen) {
        const s = (y - top) / Math.max(0.01, upLen);
        m = mix(o.tooth, mul(o.tooth, 0.62), s * 0.8);
        if (tri < 0.12) m = mul(m, 0.6);
      } else if (bot - y < loLen) {
        const s = (bot - y) / Math.max(0.01, loLen);
        m = mix(mul(o.tooth, 0.86), mul(o.tooth, 0.55), s * 0.8);
        if (triL < 0.12) m = mul(m, 0.6);
      }
      return m;
    }
    case 'smile': {
      const q = (x - cx) / (fw * 0.16);
      if (Math.abs(q) > 1) return c;
      return Math.abs(y - (my - 0.4 + q * q * -0.5 + 0.5)) < 0.26 ? mul(o.skin, 0.5) : c;
    }
    case 'stitched': {
      if (Math.abs(x - cx) > fw * 0.28) return c;
      if (Math.abs(y - my) < 0.2) return [26, 18, 14];
      const s = (x - (cx - fw * 0.28)) % 1.2;
      if (s < 0.24 && Math.abs(y - my) < 0.75) return [40, 28, 20];
      return c;
    }
    case 'gape': {
      const d = Math.hypot((x - cx) / (fw * 0.15), (y - my) / (fh * 0.13));
      if (d < 1) return mix(black, [70, 10, 12], (1 - d) * 0.25);
      if (d < 1.25) return mix(c, mix(o.drip, black, 0.5), 0.8);
      return c;
    }
    case 'line': {
      if (Math.abs(x - cx) > fw * 0.22) return c;
      return Math.abs(y - my) < 0.22 ? [14, 9, 11] : c;
    }
    default: return c;
  }
}
