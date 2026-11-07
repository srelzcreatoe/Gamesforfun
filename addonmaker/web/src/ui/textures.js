// Texture helpers for the UI: auto-paint cache, image loading and the
// front-view sprite used for thumbnails and pack icons.
import { autoPaint, faceRects } from '../core/geo.js';
import { hexToRgb } from '../core/util.js';

const autoCache = new Map();
export function autoTextureURL(entity) {
  const key = JSON.stringify([entity.model.texW, entity.model.texH, entity.model.bones, entity.autoPaint]);
  let url = autoCache.get(key);
  if (!url) {
    url = autoPaint(entity.model, entity.autoPaint || {}).toDataURL();
    if (autoCache.size > 40) autoCache.clear();
    autoCache.set(key, url);
  }
  return url;
}
export function entityTextureURL(entity, idx = 0) {
  const t = entity.textures?.[idx] || entity.textures?.[0];
  return t ? t.data : autoTextureURL(entity);
}

const imgCache = new Map();
export function loadImage(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = url;
  });
  if (imgCache.size > 60) imgCache.clear();
  imgCache.set(url, p);
  return p;
}

const splitCache = new Map();
/**
 * For emissive-alpha textures: a fully opaque colour image, and a glow map
 * (colour × how transparent the pixel was). Mirrors how the game draws them.
 */
export function splitEmissive(key, img) {
  if (splitCache.has(key)) return splitCache.get(key);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const color = mk(), glow = mk();
  const g = color.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, w, h);
  const gd = glow.getContext('2d').createImageData(w, h);
  for (let i = 0; i < d.data.length; i += 4) {
    const a = d.data[i + 3];
    const e = a < 250 ? 1 - a / 255 : 0;
    gd.data[i] = d.data[i] * e; gd.data[i + 1] = d.data[i + 1] * e; gd.data[i + 2] = d.data[i + 2] * e; gd.data[i + 3] = 255;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  glow.getContext('2d').putImageData(gd, 0, 0);
  const out = { color, glow };
  if (splitCache.size > 30) splitCache.clear();
  splitCache.set(key, out);
  return out;
}

/** Same image with every pixel made opaque (emissive textures keep glow pixels at low alpha). */
async function opaqueImage(url) {
  const img = await loadImage(url);
  return splitEmissive(url, img).color;
}

/** Draws the model from the front (north faces) as a crisp pixel sprite. */
export async function renderFrontSprite(entity, size = 128, { background = true } = {}) {
  const url = entityTextureURL(entity);
  const img = /emissive/.test(entity.model.material || '') ? await opaqueImage(url) : await loadImage(url);
  const k = (img.naturalWidth || img.width) / (entity.model.texW || 64); // HD textures: pixels per texel
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  if (background) {
    const [r1, g1, b1] = hexToRgb(entity.egg?.base || '#3f6fb5');
    const [r2, g2, b2] = hexToRgb(entity.egg?.overlay || '#f2c14e');
    const grad = g.createLinearGradient(0, 0, 0, size);
    grad.addColorStop(0, `rgb(${r1 * 0.55 + 40},${g1 * 0.55 + 40},${b1 * 0.55 + 40})`);
    grad.addColorStop(1, `rgb(${r1 * 0.3},${g1 * 0.3},${b1 * 0.3})`);
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    g.fillStyle = `rgba(${r2},${g2},${b2},0.18)`;
    g.beginPath(); g.arc(size / 2, size * 0.58, size * 0.42, 0, Math.PI * 2); g.fill();
  }
  // Project cubes: screen x = -bedrock x (we look at the entity's face), y up.
  const cubes = [];
  for (const b of entity.model.bones) for (const cu of b.cubes) cubes.push(cu);
  if (!cubes.length) return c.toDataURL('image/png');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const cu of cubes) {
    minX = Math.min(minX, -(cu.origin[0] + cu.size[0])); maxX = Math.max(maxX, -cu.origin[0]);
    minY = Math.min(minY, cu.origin[1]); maxY = Math.max(maxY, cu.origin[1] + cu.size[1]);
  }
  const w = maxX - minX, h = maxY - minY;
  let scale = (size * 0.86) / Math.max(w, h, 1);
  if (scale >= 2) scale = Math.floor(scale);
  const ox = Math.round((size - w * scale) / 2), oy = Math.round((size - h * scale) / 2 + size * 0.04);
  cubes.sort((a, b) => (b.origin[2]) - (a.origin[2]));
  for (const cu of cubes) {
    const f = faceRects(cu).north;
    if (f.w <= 0 || f.h <= 0) continue;
    const sx = -(cu.origin[0] + cu.size[0]) - minX, sy = maxY - (cu.origin[1] + cu.size[1]);
    g.save();
    if (cu.mirror) {
      g.translate(ox + (sx + cu.size[0]) * scale, oy + sy * scale);
      g.scale(-1, 1);
      g.drawImage(img, f.x * k, f.y * k, f.w * k, f.h * k, 0, 0, cu.size[0] * scale, cu.size[1] * scale);
    } else {
      g.drawImage(img, f.x * k, f.y * k, f.w * k, f.h * k, ox + sx * scale, oy + sy * scale, cu.size[0] * scale, cu.size[1] * scale);
    }
    g.restore();
  }
  return c.toDataURL('image/png');
}
