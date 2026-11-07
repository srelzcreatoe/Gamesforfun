// Entity model templates, box-UV layout, auto-UV packing and procedural
// texture painting. Coordinates follow Bedrock geometry: pixels (1/16 block),
// y up, the entity faces -Z (north).
import { uid, hexToRgb, rng, hashStr, clone } from './util.js';
import { Raster } from './png.js';

const C = (origin, size, extra = {}) => ({ uid: uid(), origin, size, uv: [0, 0], inflate: 0, mirror: false, ...extra });
const B = (name, role, pivot, cubes, extra = {}) => ({ uid: uid(), name, role, parent: '', pivot, rotation: [0, 0, 0], color: '#8a8a8a', pattern: 'none', color2: '#ffffff', cubes, ...extra });

export const TEMPLATES = {
  humanoid: {
    label: 'Humanoid',
    hint: 'Two arms, two legs. Villagers, zombies, guards.',
    collision: [0.6, 1.9],
    bones: () => [
      B('body', 'body', [0, 24, 0], [C([-4, 12, -2], [8, 12, 4])], { color: '#4f7cc4' }),
      B('head', 'head', [0, 24, 0], [C([-4, 24, -4], [8, 8, 8])], { parent: 'body', color: '#e0ac86' }),
      B('rightArm', 'armR', [-5, 22, 0], [C([-8, 12, -2], [4, 12, 4])], { parent: 'body', color: '#e0ac86' }),
      B('leftArm', 'armL', [5, 22, 0], [C([4, 12, -2], [4, 12, 4])], { parent: 'body', color: '#e0ac86' }),
      B('rightItem', 'item', [-6, 15, 1], [], { parent: 'rightArm' }),
      B('rightLeg', 'legR', [-1.9, 12, 0], [C([-3.9, 0, -2], [4, 12, 4])], { color: '#3b3f63' }),
      B('leftLeg', 'legL', [1.9, 12, 0], [C([-0.1, 0, -2], [4, 12, 4])], { color: '#3b3f63' }),
    ],
  },
  golem: {
    label: 'Golem',
    hint: 'Big, heavy guardian with long arms.',
    collision: [1.4, 2.9],
    bones: () => [
      B('body', 'body', [0, 31, 0], [C([-9, 21, -6], [18, 12, 11]), C([-4.5, 16, -3], [9, 5, 6])], { color: '#9a9488', pattern: 'spots', color2: '#6f8f4a' }),
      B('head', 'head', [0, 31, -2], [C([-4, 33, -7.5], [8, 10, 8]), C([-1, 32, -9.5], [2, 4, 2])], { parent: 'body', color: '#b3ab9d' }),
      B('rightArm', 'armR', [-9.5, 31, -1], [C([-13, 3.5, -3], [4, 30, 6])], { parent: 'body', color: '#9a9488' }),
      B('leftArm', 'armL', [9.5, 31, -1], [C([9, 3.5, -3], [4, 30, 6])], { parent: 'body', color: '#9a9488' }),
      B('rightLeg', 'legR', [-4, 16, 0], [C([-7.5, 0, -3], [6, 16, 5])], { color: '#867f73' }),
      B('leftLeg', 'legL', [5, 16, 0], [C([1.5, 0, -3], [6, 16, 5])], { color: '#867f73' }),
    ],
  },
  quadruped: {
    label: 'Four-legged',
    hint: 'Animals and mounts: pigs, wolves, horses.',
    collision: [0.9, 0.9],
    bones: () => [
      B('body', 'body', [0, 10, 0], [C([-5, 6, -8], [10, 8, 16])], { color: '#c98f5e', pattern: 'spots', color2: '#f0d2b0' }),
      B('head', 'head', [0, 12, -8], [C([-4, 9, -15], [8, 8, 7]), C([-2, 9, -17], [4, 3, 2])], { parent: 'body', color: '#d79f70' }),
      B('leg0', 'legBR', [-3, 6, 6], [C([-5, 0, 4], [4, 6, 4])], { color: '#a8744a' }),
      B('leg1', 'legBL', [3, 6, 6], [C([1, 0, 4], [4, 6, 4])], { color: '#a8744a' }),
      B('leg2', 'legFR', [-3, 6, -6], [C([-5, 0, -8], [4, 6, 4])], { color: '#a8744a' }),
      B('leg3', 'legFL', [3, 6, -6], [C([1, 0, -8], [4, 6, 4])], { color: '#a8744a' }),
      B('tail', 'tail', [0, 13, 8], [C([-1, 9, 8], [2, 4, 2])], { parent: 'body', color: '#a8744a' }),
    ],
  },
  flyer: {
    label: 'Flyer',
    hint: 'Wings that flap. Birds, bats, sprites.',
    collision: [0.6, 0.7],
    bones: () => [
      B('body', 'body', [0, 7, 0], [C([-3, 4, -4], [6, 6, 8])], { color: '#6fb0d8' }),
      B('head', 'head', [0, 9, -4], [C([-2.5, 7, -9], [5, 5, 5]), C([-1, 8, -11], [2, 2, 2])], { parent: 'body', color: '#7cc0e8' }),
      B('leftWing', 'wingL', [3, 9, 0], [C([3, 9, -3], [10, 1, 6])], { parent: 'body', color: '#4c8fb8' }),
      B('rightWing', 'wingR', [-3, 9, 0], [C([-13, 9, -3], [10, 1, 6])], { parent: 'body', color: '#4c8fb8' }),
      B('tail', 'tail', [0, 6, 4], [C([-2, 6, 4], [4, 1, 5])], { parent: 'body', color: '#4c8fb8' }),
      B('leftLeg', 'legL', [1.5, 4, 0], [C([0.5, 0, -0.5], [2, 4, 1])], { color: '#e6b84a' }),
      B('rightLeg', 'legR', [-1.5, 4, 0], [C([-2.5, 0, -0.5], [2, 4, 1])], { color: '#e6b84a' }),
    ],
  },
  fish: {
    label: 'Swimmer',
    hint: 'Fish, sea creatures; tail sways.',
    collision: [0.6, 0.5],
    bones: () => [
      B('body', 'body', [0, 4, 0], [C([-1.5, 1, -5], [3, 6, 9]), C([-0.5, 7, -2], [1, 2, 4])], { color: '#e88b3c', pattern: 'stripes', color2: '#fbe3c4' }),
      B('tail', 'tail', [0, 4, 4], [C([-0.5, 1, 4], [1, 6, 5])], { parent: 'body', color: '#d06f28' }),
      B('leftFin', 'finL', [1.5, 2, -1], [C([1.5, 1, -2], [2, 1, 3])], { parent: 'body', color: '#d06f28' }),
      B('rightFin', 'finR', [-1.5, 2, -1], [C([-3.5, 1, -2], [2, 1, 3])], { parent: 'body', color: '#d06f28' }),
    ],
  },
  gaunt: {
    label: 'Gaunt',
    horror: true,
    hint: 'Tall, thin, hunched. Arms that reach past its knees.',
    collision: [0.7, 2.9],
    bones: () => [
      B('body', 'body', [0, 22, 0], [C([-4, 26, -2], [8, 12, 4]), C([-3, 22, -1.5], [6, 4, 3])], { color: '#cfc8bd', pattern: 'cracks', color2: '#6d6258' }),
      B('head', 'head', [0, 38, 0], [C([-3, 38, -3], [6, 9, 6])], { parent: 'body', color: '#ddd6cb' }),
      B('rightArm', 'armR', [-5, 37, 0], [C([-7, 12, -1], [2, 26, 2]), C([-7.5, 8, -1.5], [3, 4, 3])], { parent: 'body', color: '#c4bcb0' }),
      B('leftArm', 'armL', [5, 37, 0], [C([5, 12, -1], [2, 26, 2]), C([4.5, 8, -1.5], [3, 4, 3])], { parent: 'body', color: '#c4bcb0' }),
      B('rightLeg', 'legR', [-2, 22, 0], [C([-3, 0, -1], [2, 22, 2])], { color: '#b5ada1' }),
      B('leftLeg', 'legL', [2, 22, 0], [C([1, 0, -1], [2, 22, 2])], { color: '#b5ada1' }),
    ],
  },
  crawler: {
    label: 'Crawler',
    horror: true,
    hint: 'Low, spidery limbs splayed out. Climbs walls.',
    collision: [1.1, 0.9],
    bones: () => [
      B('body', 'body', [0, 10, 0], [C([-4, 8, -8], [8, 5, 16])], { color: '#3a3438', pattern: 'grime', color2: '#121014' }),
      B('head', 'head', [0, 12, -8], [C([-3.5, 8, -15], [7, 7, 7])], { parent: 'body', color: '#4a4248' }),
      B('frontRight', 'legFR', [-4, 12, -6], [C([-9, 11, -7], [5, 2, 2]), C([-9, 0, -7], [2, 11, 2])], { color: '#2e292d' }),
      B('frontLeft', 'legFL', [4, 12, -6], [C([4, 11, -7], [5, 2, 2]), C([7, 0, -7], [2, 11, 2])], { color: '#2e292d' }),
      B('backRight', 'legBR', [-4, 11, 6], [C([-9, 10, 5], [5, 2, 2]), C([-9, 0, 5], [2, 10, 2])], { color: '#2e292d' }),
      B('backLeft', 'legBL', [4, 11, 6], [C([4, 10, 5], [5, 2, 2]), C([7, 0, 5], [2, 10, 2])], { color: '#2e292d' }),
    ],
  },
  shade: {
    label: 'Shade',
    horror: true,
    hint: 'A floating hooded shape. No legs.',
    collision: [0.8, 2.2],
    bones: () => [
      B('body', 'body', [0, 20, 0], [C([-5, 6, -3], [10, 16, 6]), C([-6, 3, -4], [12, 4, 8])], { color: '#17151c', pattern: 'gradient', color2: '#3b3550' }),
      B('head', 'head', [0, 22, 0], [C([-4, 22, -4], [8, 8, 8])], { parent: 'body', color: '#1d1a24' }),
      B('rightArm', 'armR', [-5, 21, 0], [C([-8, 8, -2], [3, 13, 4])], { parent: 'body', color: '#1b1822' }),
      B('leftArm', 'armL', [5, 21, 0], [C([5, 8, -2], [3, 13, 4])], { parent: 'body', color: '#1b1822' }),
    ],
  },
  blob: {
    label: 'Blob',
    hint: 'One bouncy cube. Slimes, jellies.',
    collision: [1, 1],
    bones: () => [
      B('body', 'body', [0, 0, 0], [C([-6, 0, -6], [12, 12, 12])], { color: '#7ac96a' }),
      B('head', 'head', [0, 0, 0], [], { parent: 'body' }),
    ],
  },
};

export function makeModel(template = 'humanoid', spec = null, colors = {}) {
  if (spec) {
    const model = { template, texW: 64, texH: 64, autoUv: true, material: 'entity_alphatest', bones: dwellerBody(spec, colors), spec };
    packUVs(model);
    return model;
  }
  const t = TEMPLATES[template] || TEMPLATES.humanoid;
  const model = { template, texW: 64, texH: 64, autoUv: true, material: 'entity_alphatest', bones: t.bones() };
  packUVs(model);
  return model;
}

const sz = (v) => Math.max(0, v);
/** Box-UV face rectangles (texture pixels) for a cube, before mirroring. */
export function faceRects(cube) {
  const [w, h, d] = cube.size.map(sz);
  const [u, v] = cube.uv || [0, 0];
  return {
    east: { x: u, y: v + d, w: d, h },
    north: { x: u + d, y: v + d, w, h },
    west: { x: u + d + w, y: v + d, w: d, h },
    south: { x: u + 2 * d + w, y: v + d, w, h },
    up: { x: u + d, y: v, w, h: d },
    down: { x: u + d + w, y: v, w, h: d },
  };
}
export const cubeFootprint = (cube) => {
  const [w, h, d] = cube.size.map(sz);
  return [Math.ceil(2 * (d + w)), Math.ceil(d + h)];
};

/** Shelf-packs every cube's box-UV footprint and picks a texture size. */
export function packUVs(model) {
  const items = [];
  for (const b of model.bones) for (const c of b.cubes) {
    const [fw, fh] = cubeFootprint(c);
    if (fw > 0 && fh > 0) items.push({ c, fw, fh });
  }
  items.sort((a, b) => b.fh - a.fh || b.fw - a.fw);
  const tryW = (W) => {
    let x = 0, y = 0, rowH = 0;
    const placed = [];
    for (const it of items) {
      if (it.fw > W) return null;
      if (x + it.fw > W) { y += rowH; x = 0; rowH = 0; }
      placed.push([it, x, y]);
      x += it.fw;
      rowH = Math.max(rowH, it.fh);
    }
    return { placed, H: y + rowH };
  };
  const p2 = (n) => { let p = 16; while (p < n) p *= 2; return p; };
  let best = null;
  for (const W of [16, 32, 64, 128, 256, 512]) {
    const r = tryW(W);
    if (!r) continue;
    const H = p2(r.H);
    if (H <= W) { best = { W, H, r }; break; }
    if (!best && H <= W * 2) best = { W, H, r };
  }
  if (!best) { const r = tryW(512) || { placed: [], H: 16 }; best = { W: 512, H: p2(r.H), r }; }
  for (const [it, x, y] of best.r.placed) it.c.uv = [x, y];
  model.texW = best.W;
  model.texH = best.H;
  return model;
}

export function modelBounds(model) {
  let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const b of model.bones) for (const c of b.cubes) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], c.origin[i] - (c.inflate || 0));
      max[i] = Math.max(max[i], c.origin[i] + c.size[i] + (c.inflate || 0));
    }
  }
  if (!Number.isFinite(min[0])) { min = [-8, 0, -8]; max = [8, 16, 8]; }
  return { min, max };
}

function shade([r, g, b], f) { return [Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)]; }
const mix3 = (a, b, t) => [0, 1, 2].map((i) => a[i] * (1 - t) + b[i] * t);

/**
 * Paints every cube face with its bone colour, light-direction shading, a
 * pattern and noise, then draws a face on the head. Options:
 *  noise, outline, outlineColor, eyes, eyeStyle (normal|glow|hollow|rect|sunken|many|single|button|none),
 *  eyeColor, mouth (none|line|grin|bigGrin|stitched|gape), faceColor, dripColor, toothColor
 */
export function autoPaint(model, opts = {}) {
  const {
    noise = 0.07, outline = true, outlineColor = null, eyes = true, seed = 7, eyeStyle = 'normal',
    eyeColor = '#ff2a2a', mouth = 'line', faceColor = null, dripColor = '#7a0d0d', toothColor = '#efe4bf',
  } = opts;
  const R = new Raster(model.texW, model.texH);
  const FACE_LIGHT = { up: 1.14, down: 0.72, north: 1.0, south: 0.9, east: 0.84, west: 0.84 };
  const oc = outlineColor ? hexToRgb(outlineColor) : null;
  for (const bone of model.bones) {
    const base = hexToRgb(bone.color);
    const accent = hexToRgb(bone.color2 || '#ffffff');
    const rand = rng(seed + hashStr(bone.name));
    bone.cubes.forEach((cube, ci) => {
      const rects = faceRects(cube);
      const isFaceCube = bone.role === 'head' && ci === 0;
      for (const [face, r] of Object.entries(rects)) {
        const x0 = Math.floor(r.x), y0 = Math.floor(r.y), w = Math.ceil(r.w), h = Math.ceil(r.h);
        const light = FACE_LIGHT[face];
        const col = shade(base, light);
        const acc = shade(accent, light);
        const fseed = seed + hashStr(bone.name + face + ci);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let c = col;
          const ty = h > 1 ? y / (h - 1) : 0;
          switch (bone.pattern) {
            case 'stripes': if (Math.floor((x + y) / 2) % 3 === 0) c = acc; break;
            case 'gradient': c = mix3(col, acc, ty * 0.6); break;
            case 'fade': c = mix3(col, acc, Math.pow(ty, 1.3)); break;
            case 'spots': if (rand() < 0.11) c = shade(accent, light * 0.95); break;
            case 'grime': if (rand() < 0.28) c = mix3(col, acc, 0.5); break;
            case 'cracks': if (crackAt(x, y, w, h, fseed)) c = acc; break;
            case 'veins': if (crackAt(x, y, w, h, fseed) || crackAt(x, y, w, h, fseed + 99)) c = mix3(col, acc, 0.75); break;
            case 'ribs':
              if (face === 'north' && w >= 4 && y > h * 0.15 && y < h * 0.62 && y % 2 === 0 && x > 0 && x < w - 1 && Math.abs(x - (w - 1) / 2) > 0.6) c = mix3(col, acc, 0.8);
              else if (crackAt(x, y, w, h, fseed)) c = mix3(col, acc, 0.6);
              break;
            default: break;
          }
          if (isFaceCube && faceColor && face === 'north') c = mix3(col, shade(hexToRgb(faceColor), light), Math.min(1, ty * 1.6));
          let px = shade(c, 1 + (rand() * 2 - 1) * noise);
          const edge = w > 2 && h > 2 && (x === 0 || y === 0 || x === w - 1 || y === h - 1);
          if (edge && oc) px = mix3(px, oc, 0.85);
          else if (edge && outline) px = shade(px, 0.82);
          R.set(x0 + x, y0 + y, px[0], px[1], px[2], 255);
        }
      }
      if (eyes && bone.role === 'head' && ci === 0 && eyeStyle !== 'none') {
        if (eyeStyle === 'normal') paintFriendlyFace(R, rects.north, base, model.template !== 'blob');
        else paintHorrorFace(R, rects.north, { style: eyeStyle, eye: hexToRgb(eyeColor), mouth, dark: shade(base, 0.35), drip: hexToRgb(dripColor), tooth: hexToRgb(toothColor), seed: fseedOf(bone, seed) });
      } else if (eyes && model.template === 'blob' && bone.role === 'body' && ci === 0) {
        paintFriendlyFace(R, rects.north, base, false);
      }
    });
  }
  return R;
}
const fseedOf = (bone, seed) => seed + hashStr(bone.name + 'face');

function paintFriendlyFace(R, f, base, withMouth) {
  const fw = Math.round(f.w), fh = Math.round(f.h);
  if (fw < 4 || fh < 3) return;
  const ey = Math.floor(f.y) + Math.max(1, Math.floor(fh * 0.38));
  const inset = Math.max(1, Math.floor(fw * 0.22));
  const ew = fw >= 8 ? 2 : 1;
  for (const ex of [Math.floor(f.x) + inset, Math.floor(f.x) + fw - inset - ew]) {
    for (let i = 0; i < ew; i++) R.set(ex + i, ey, 245, 245, 245, 255);
    R.set(ex + (ex < f.x + fw / 2 ? ew - 1 : 0), ey, 32, 28, 40, 255);
  }
  if (withMouth && fh >= 6 && fw >= 6) {
    const my = ey + Math.max(2, Math.floor(fh * 0.3));
    const mx = Math.floor(f.x + fw / 2) - 1;
    R.set(mx, my, ...shade(base, 0.55), 255); R.set(mx + 1, my, ...shade(base, 0.55), 255);
  }
}

function crackAt(x, y, w, h, seed) {
  // Thin wandering lines: a few deterministic "cracks" per face.
  const r = rng(seed);
  for (let k = 0; k < 2; k++) {
    let cx = Math.floor(r() * w);
    for (let yy = 0; yy < h; yy++) {
      if (r() < 0.45) cx += r() < 0.5 ? -1 : 1;
      if (yy === y && cx === x && r() < 0.95) return true;
    }
  }
  return false;
}

/** Horror faces: many eye and mouth styles (glowing, sunken, dripping, grins…). */
function paintHorrorFace(R, f, o) {
  const x0 = Math.floor(f.x), y0 = Math.floor(f.y), fw = Math.round(f.w), fh = Math.round(f.h);
  if (fw < 4 || fh < 4) return;
  const set = (x, y, c) => { if (x >= x0 && x < x0 + fw && y >= y0 && y < y0 + fh) R.set(x, y, c[0], c[1], c[2], 255); };
  const black = [6, 4, 6];
  const ey = y0 + Math.max(1, Math.floor(fh * (fh >= 10 ? 0.28 : 0.3)));
  const ew = fw >= 8 ? (o.style === 'rect' ? 2 : 2) : 1;
  const eh = o.style === 'rect' ? (fh >= 10 ? 2 : 1) : o.style === 'sunken' ? Math.max(2, Math.floor(fh * 0.28)) : fh >= 8 ? 2 : 1;
  const inset = Math.max(1, Math.floor(fw * (o.style === 'rect' ? 0.16 : 0.18)));
  const eyeXs = [x0 + inset, x0 + fw - inset - ew];
  let mouthTop = ey + eh + Math.max(2, Math.floor(fh * 0.2));
  if (o.style === 'many') {
    const r = rng(o.seed);
    for (let k = 0; k < Math.max(4, Math.floor(fw * fh / 9)); k++) {
      const x = x0 + 1 + Math.floor(r() * (fw - 2)), y = y0 + 1 + Math.floor(r() * (fh * 0.6));
      set(x, y, o.eye); set(x + 1, y, shade(o.eye, 0.5));
    }
    mouthTop = y0 + Math.floor(fh * 0.7);
  } else if (o.style === 'single') {
    const cx = x0 + Math.floor(fw / 2) - 1, cy = y0 + Math.floor(fh * 0.35);
    for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) set(cx + dx, cy + dy, black);
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) set(cx + dx, cy + dy, o.eye);
    set(cx, cy, [255, 255, 255]);
    mouthTop = cy + 4;
  } else if (o.style === 'button') {
    for (const ex of eyeXs) {
      for (let dy = 0; dy < Math.max(2, ew); dy++) for (let dx = 0; dx < Math.max(2, ew); dx++) set(ex + dx, ey + dy, black);
      set(ex, ey, shade(o.eye, 1));
    }
  } else {
    for (const ex of eyeXs) {
      if (o.style === 'sunken') {
        // Dark vertical sockets with a white pinprick pupil (fades into the skin).
        for (let dy = -1; dy <= eh + 1; dy++) for (let dx = -1; dx <= ew; dx++) {
          const t = dy < 0 || dy > eh ? 0.45 : dx < 0 || dx >= ew ? 0.6 : 1;
          const [r0, g0, b0] = R.get(ex + dx, ey + dy);
          set(ex + dx, ey + dy, mix3([r0, g0, b0], o.dark, t));
        }
        set(ex + (ex < x0 + fw / 2 ? ew - 1 : 0), ey + Math.floor(eh / 2), [250, 250, 245]);
        continue;
      }
      for (let dy = -1; dy <= eh; dy++) for (let dx = -1; dx <= ew; dx++) set(ex + dx, ey + dy, mix3(o.dark, black, 0.6));
      for (let dy = 0; dy < eh; dy++) for (let dx = 0; dx < ew; dx++) {
        if (o.style === 'glow' || o.style === 'rect') set(ex + dx, ey + dy, dy === 0 ? mix3(o.eye, [255, 255, 230], 0.35) : o.eye);
        else set(ex + dx, ey + dy, black);
      }
      if (o.style === 'hollow' && ew > 1) set(ex + (ex < x0 + fw / 2 ? ew - 1 : 0), ey + eh - 1, o.eye);
      if (o.style === 'rect') {
        // Bloody drips running down from each eye.
        const r = rng(o.seed + ex);
        for (let dx = 0; dx < ew; dx++) {
          const len = 1 + Math.floor(r() * Math.max(2, fh * 0.25));
          for (let k = 1; k <= len; k++) set(ex + dx, ey + eh + k, shade(o.drip, 1 - k / (len + 2)));
        }
      }
    }
  }
  // Mouths.
  const mx0 = x0 + Math.max(1, Math.floor(fw * 0.1)), mx1 = x0 + fw - 1 - Math.max(1, Math.floor(fw * 0.1));
  switch (o.mouth) {
    case 'bigGrin': {
      const my = Math.max(mouthTop, y0 + Math.floor(fh * 0.62));
      const rows = Math.max(2, Math.min(4, y0 + fh - my - 1));
      for (let x = mx0; x <= mx1; x++) {
        const curve = Math.round(Math.abs(x - (mx0 + mx1) / 2) / ((mx1 - mx0) / 2 + 0.01) * 1.2);
        const top = my - curve;
        for (let k = -1; k <= rows; k++) set(x, top + k, k === -1 || k === rows ? mix3(o.drip, black, 0.5) : black);
        const tooth = (x - mx0) % 2 === 0;
        for (let k = 0; k < rows; k++) {
          const upper = k < Math.ceil(rows / 2);
          if (upper ? (tooth || k === 0) : (!tooth || k === rows - 1)) set(x, top + k, shade(o.tooth, upper ? 1 : 0.88));
        }
      }
      break;
    }
    case 'grin': {
      const my = Math.min(y0 + fh - 2, mouthTop);
      for (let x = mx0; x <= mx1; x++) {
        set(x, my, [10, 6, 8]);
        set(x, my + 1, (x - mx0) % 2 ? o.tooth : [10, 6, 8]);
        if (x === mx0 || x === mx1) set(x, my - 1, [10, 6, 8]);
      }
      break;
    }
    case 'stitched': {
      const my = Math.min(y0 + fh - 2, mouthTop);
      for (let x = mx0 + 1; x <= mx1 - 1; x++) { set(x, my, [20, 14, 10]); if ((x - mx0) % 2) { set(x, my - 1, [20, 14, 10]); set(x, my + 1, [20, 14, 10]); } }
      break;
    }
    case 'gape': {
      const my = Math.min(y0 + fh - 3, mouthTop);
      const cx = x0 + Math.floor(fw / 2);
      for (let dy = 0; dy < 3; dy++) for (let dx = -1 - (dy === 1 ? 1 : 0); dx <= 1 + (dy === 1 ? 1 : 0); dx++) set(cx + dx - 1, my + dy, black);
      break;
    }
    case 'line': {
      const my = Math.min(y0 + fh - 2, mouthTop);
      for (let x = x0 + Math.floor(fw * 0.3); x <= x0 + fw - 1 - Math.floor(fw * 0.3); x++) set(x, my, [12, 8, 10]);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Dweller body builder: proportions → bones. Pixel units, entity faces -Z.
export const DEFAULT_BODY = {
  legLen: 22, legW: 2, footL: 0, hipW: 6,
  torsoW: 8, torsoH: 12, torsoD: 4,
  neck: 1, neckW: 3,
  headW: 6, headH: 9, headD: 6, headForward: 0,
  armLen: 26, armW: 2, handSize: 3, hands: 'block', clawLen: 5,
  extraArms: false, antlers: false, hat: false, hood: false, horns: false, spikes: false, tail: 0,
  quad: false, float: false, hunch: 1,
};

export function dwellerBody(spec = {}, colors = {}) {
  const s = { ...DEFAULT_BODY, ...spec };
  const col = (role, d) => colors[role] || d;
  const bones = [];
  const push = (b) => { bones.push(b); return b; };
  if (s.quad) return quadBody(s, col);
  const legTop = s.float ? 4 : s.legLen;
  if (!s.float) {
    const lx = s.hipW / 2 - s.legW / 2;
    for (const [side, role, name] of [[-1, 'legR', 'rightLeg'], [1, 'legL', 'leftLeg']]) {
      const px = side * lx;
      const cubes = [C([px - s.legW / 2, 0, -s.legW / 2], [s.legW, s.legLen, s.legW])];
      if (s.footL > 0) cubes.push(C([px - s.legW / 2 - 0.5, 0, -s.legW / 2 - s.footL], [s.legW + 1, 2, s.footL]));
      if (s.hands === 'claws') for (let i = 0; i < 2; i++) cubes.push(C([px - s.legW / 2 + i * (s.legW - 0.6), 0, -s.legW / 2 - (s.footL || 0) - 2], [0.6, 0.6, 2]));
      push(B(name, role, [px, s.legLen, 0], cubes, { color: col(role, col('legs', '#2a2a2e')) }));
    }
  }
  const torsoBottom = s.float ? 0 : legTop + 3;
  const bodyCubes = s.float
    ? [C([-s.torsoW / 2, 0, -s.torsoD / 2 - 1], [s.torsoW, s.torsoH + legTop, s.torsoD + 2]), C([-s.torsoW / 2 - 1, 0, -s.torsoD / 2 - 2], [s.torsoW + 2, 3, s.torsoD + 4])]
    : [C([-s.torsoW / 2, torsoBottom, -s.torsoD / 2], [s.torsoW, s.torsoH, s.torsoD]), C([-s.hipW / 2, legTop, -s.torsoD / 2 + 0.5], [s.hipW, 3, Math.max(2, s.torsoD - 1)])];
  const topY = s.float ? s.torsoH + legTop : torsoBottom + s.torsoH;
  if (s.spikes) for (let i = 0; i < 3; i++) bodyCubes.push(C([-0.5, topY - 3 - i * 4, s.torsoD / 2], [1, 2, 2]));
  if (s.tail > 0) bodyCubes.push(C([-0.75, legTop + 1, s.torsoD / 2], [1.5, 1.5, s.tail]));
  push(B('body', 'body', [0, legTop, 0], bodyCubes, { color: col('body', '#1d1b20') }));
  // Head (with neck).
  const headCubes = [C([-s.headW / 2, topY + s.neck, -s.headD / 2 - s.headForward], [s.headW, s.headH, s.headD])];
  if (s.neck > 0) headCubes.push(C([-s.neckW / 2, topY, -s.neckW / 2 - s.headForward / 2], [s.neckW, s.neck + 0.5, s.neckW]));
  const hTop = topY + s.neck + s.headH;
  if (s.hood) headCubes.push(C([-s.headW / 2 - 1, topY + s.neck - 1, -s.headD / 2 - s.headForward + 0.5], [s.headW + 2, s.headH + 2, s.headD + 1.5]));
  push(B('head', 'head', [0, topY, 0], headCubes, { parent: 'body', color: col('head', '#cfc8bd') }));
  if (s.antlers || s.hat || s.horns) {
    const ex = [];
    if (s.antlers) {
      for (const side of [-1, 1]) {
        const bx = side * (s.headW / 2 - 1);
        ex.push(C([bx - 0.5, hTop, -0.5 - s.headForward], [1, 6, 1]), C([bx + (side > 0 ? 0 : -3), hTop + 4, -0.5 - s.headForward], [3.5, 1, 1]), C([bx + side * 3 - 0.5, hTop + 4, -0.5 - s.headForward], [1, 4, 1]), C([bx + side * 1 - 0.5, hTop + 6, -0.5 - s.headForward], [1, 3, 1]));
      }
    }
    if (s.horns) for (const side of [-1, 1]) ex.push(C([side * (s.headW / 2) - 1, hTop - 2, -1 - s.headForward], [2, 4, 2]), C([side * (s.headW / 2 + 1) - 0.5, hTop + 1, -0.5 - s.headForward], [1, 3, 1]));
    if (s.hat) ex.push(C([-s.headW / 2 - 2, hTop, -s.headD / 2 - 2 - s.headForward], [s.headW + 4, 1, s.headD + 4]), C([-s.headW / 2 + 0.5, hTop + 1, -s.headD / 2 + 0.5 - s.headForward], [s.headW - 1, Math.round(s.headH * 1.1), s.headD - 1]));
    push(B('headwear', 'none', [0, topY, 0], ex, { parent: 'head', color: col('extra', '#e9e2d0') }));
  }
  // Arms (+ hands / claws as their own bones so they can be coloured separately).
  const shoulderY = topY - 1;
  const armSets = [[shoulderY, s.armLen, '']];
  if (s.extraArms) armSets.push([shoulderY - Math.round(s.torsoH * 0.45), Math.round(s.armLen * 0.8), 'Lower']);
  for (const [sy, len, tag] of armSets) {
    for (const [side, role, name] of [[-1, 'armR', 'rightArm'], [1, 'armL', 'leftArm']]) {
      const px = side * (s.torsoW / 2 + s.armW / 2);
      push(B(`${name}${tag}`, tag ? 'none' : role, [px, sy, 0], [C([px - s.armW / 2, sy - len, -s.armW / 2], [s.armW, len, s.armW])], { parent: 'body', color: col('arms', col('body', '#1d1b20')) }));
      if (s.hands !== 'none') {
        const hs = s.handSize, hy = sy - len;
        const cubes = [C([px - hs / 2, hy - hs + 0.5, -hs / 2], [hs, hs, hs])];
        if (s.hands === 'claws') for (let i = 0; i < 3; i++) cubes.push(C([px - hs / 2 + 0.2 + i * (hs - 0.6) / 2, hy - hs + 0.5 - s.clawLen, -hs / 2 + 0.3], [0.6, s.clawLen, 0.6]));
        push(B(`${name}${tag}Hand`, 'none', [px, sy, 0], cubes, { parent: `${name}${tag}`, color: col('hands', '#e8b878') }));
      }
    }
  }
  if (s.hunch) for (const b of bones) b.hunch = s.hunch;
  return bones;
}

function quadBody(s, col) {
  const bones = [];
  const L = s.bodyLen || 18, W = s.torsoW || 8, H = s.torsoH || 7, legLen = s.legLen || 14, lw = s.legW || 2;
  const bodyY = legLen;
  bones.push(B('body', 'body', [0, bodyY + H / 2, 0], [C([-W / 2, bodyY, -L / 2], [W, H, L]), ...(s.spikes ? [0, 1, 2, 3].map((i) => C([-0.5, bodyY + H, -L / 2 + 2 + i * 4], [1, 2, 2])) : [])], { color: col('body', '#2b2622') }));
  const hz = -L / 2 - (s.neck || 2);
  bones.push(B('head', 'head', [0, bodyY + H - 1, -L / 2], [C([-s.headW / 2, bodyY + H - 2 - s.headH / 2, hz - s.headD], [s.headW, s.headH, s.headD]), ...(s.neck ? [C([-s.neckW / 2, bodyY + H - 3, hz], [s.neckW, s.neckW, s.neck + 1])] : [])], { parent: 'body', color: col('head', '#3a332c') }));
  const legs = [['frontRight', 'legFR', -1, -1], ['frontLeft', 'legFL', 1, -1], ['backRight', 'legBR', -1, 1], ['backLeft', 'legBL', 1, 1]];
  for (const [name, role, sx, sz] of legs) {
    const px = sx * (W / 2 + (s.splay ? 2 : -lw / 2)), pz = sz * (L / 2 - 2);
    const cubes = [C([px - lw / 2, 0, pz - lw / 2], [lw, legLen + 1, lw])];
    if (s.splay) cubes.push(C([Math.min(px, sx * W / 2) - (sx > 0 ? 0 : 0), legLen, pz - lw / 2], [Math.abs(px - sx * W / 2) + lw / 2, lw, lw]));
    if (s.hands === 'claws') for (let i = 0; i < 3; i++) cubes.push(C([px - lw / 2 + i * (lw - 0.6) / 2, 0, pz - lw / 2 - 2], [0.6, 0.6, 2.5]));
    bones.push(B(name, role, [px, legLen, pz], cubes, { color: col('legs', '#221e1a') }));
  }
  if (s.tail > 0) bones.push(B('tail', 'tail', [0, bodyY + H - 1, L / 2], [C([-0.75, bodyY + H - 2, L / 2], [1.5, 1.5, s.tail])], { parent: 'body', color: col('body', '#2b2622') }));
  return bones;
}

/** Dweller body presets usable as model templates. */
export const DWELLER_BODIES = {
  grinner: { label: 'Grinner', hint: 'Tall, boxy head, big hands.', spec: { legLen: 24, legW: 3, footL: 3, hipW: 7, torsoW: 10, torsoH: 13, torsoD: 6, neck: 1, neckW: 4, headW: 8, headH: 12, headD: 8, armLen: 28, armW: 4, handSize: 4 }, collision: [0.8, 2.9] },
  lurker: { label: 'Lurker', hint: 'Skeletal, long claws, ribs.', spec: { legLen: 22, legW: 3, footL: 3, hipW: 6, torsoW: 9, torsoH: 14, torsoD: 5, neck: 2, neckW: 3, headW: 8, headH: 12, headD: 8, headForward: 1, armLen: 32, armW: 3, handSize: 3, hands: 'claws', clawLen: 6 }, collision: [0.7, 2.8] },
  brute: { label: 'Brute', hint: 'Huge and wide, tiny head.', spec: { legLen: 14, legW: 6, hipW: 12, torsoW: 18, torsoH: 16, torsoD: 10, neck: 0, headW: 6, headH: 6, headD: 6, headForward: 2, armLen: 24, armW: 6, handSize: 7 }, collision: [1.4, 2.4] },
  longneck: { label: 'Long neck', hint: 'Peeks over walls on an impossible neck.', spec: { legLen: 18, legW: 2, hipW: 6, torsoW: 8, torsoH: 11, torsoD: 4, neck: 18, neckW: 2, headW: 6, headH: 7, headD: 6, armLen: 22, armW: 2, handSize: 3, hands: 'claws' }, collision: [0.7, 2.9] },
  doll: { label: 'Doll', hint: 'Small and uncanny.', spec: { legLen: 6, legW: 2, hipW: 4, torsoW: 6, torsoH: 6, torsoD: 3, neck: 0, headW: 7, headH: 7, headD: 7, armLen: 6, armW: 2, handSize: 2, hunch: 0 }, collision: [0.5, 1.2] },
  wraith: { label: 'Wraith', hint: 'Floating robe, no legs.', spec: { float: true, torsoW: 10, torsoH: 16, torsoD: 6, neck: 0, headW: 8, headH: 8, headD: 8, hood: true, armLen: 13, armW: 3, handSize: 3, hands: 'claws', clawLen: 4 }, collision: [0.8, 2.2] },
  hound: { label: 'Hound', hint: 'Long-legged four-legged hunter.', spec: { quad: true, bodyLen: 18, torsoW: 8, torsoH: 7, legLen: 14, legW: 2, neck: 3, neckW: 3, headW: 6, headH: 6, headD: 8, tail: 8, hands: 'claws' }, collision: [0.9, 1.4] },
  spider: { label: 'Spider-limbed', hint: 'Low body, splayed limbs.', spec: { quad: true, splay: true, bodyLen: 16, torsoW: 8, torsoH: 5, legLen: 11, legW: 2, neck: 0, headW: 7, headH: 7, headD: 7, hands: 'claws' }, collision: [0.9, 0.9] },
};

export function cloneModel(m) {
  const c = clone(m);
  for (const b of c.bones) { b.uid = uid(); for (const cu of b.cubes) cu.uid = uid(); }
  return c;
}

/** Bedrock geometry JSON (format 1.12.0). */
export function geometryJSON(model, identifier) {
  const { min, max } = modelBounds(model);
  const ext = Math.max(Math.abs(min[0]), Math.abs(max[0]), Math.abs(min[2]), Math.abs(max[2]));
  const vbw = Math.ceil(((ext * 2) / 16 + 1) * 10) / 10;
  const vbh = Math.ceil((max[1] / 16 + 1) * 10) / 10;
  const round = (v) => Math.round(v * 1000) / 1000;
  return {
    format_version: '1.12.0',
    'minecraft:geometry': [{
      description: {
        identifier,
        texture_width: model.texW,
        texture_height: model.texH,
        visible_bounds_width: vbw,
        visible_bounds_height: vbh,
        visible_bounds_offset: [0, round(vbh / 2), 0],
      },
      bones: model.bones.map((b) => {
        const o = { name: b.name };
        if (b.parent) o.parent = b.parent;
        o.pivot = b.pivot.map(round);
        if (b.rotation && b.rotation.some((v) => v)) o.rotation = b.rotation.map(round);
        if (b.cubes.length) {
          o.cubes = b.cubes.map((c) => {
            const cu = { origin: c.origin.map(round), size: c.size.map(round), uv: c.uv.map(round) };
            if (c.inflate) cu.inflate = round(c.inflate);
            if (c.mirror) cu.mirror = true;
            return cu;
          });
        }
        return o;
      }),
    }],
  };
}

/** Imports bones from a Bedrock .geo.json (first geometry). */
export function modelFromGeometry(json) {
  const geo = (json['minecraft:geometry'] || [])[0];
  if (!geo) throw new Error('No minecraft:geometry found');
  const roleFor = (n) => {
    const s = n.toLowerCase();
    if (s.includes('head')) return 'head';
    if (s.includes('body')) return 'body';
    if (/right.*arm|arm.*right/.test(s)) return 'armR';
    if (/left.*arm|arm.*left/.test(s)) return 'armL';
    if (/right.*leg|leg.*right/.test(s)) return 'legR';
    if (/left.*leg|leg.*left/.test(s)) return 'legL';
    if (/wing/.test(s)) return /right/.test(s) ? 'wingR' : 'wingL';
    if (s.includes('tail')) return 'tail';
    const m = s.match(/^leg(\d)$/);
    if (m) return ['legBR', 'legBL', 'legFR', 'legFL'][Number(m[1])] || 'legL';
    return 'none';
  };
  const model = {
    template: 'custom', autoUv: false, material: 'entity_alphatest',
    texW: geo.description?.texture_width || 64, texH: geo.description?.texture_height || 64,
    bones: (geo.bones || []).map((b) => ({
      uid: uid(), name: b.name, role: roleFor(b.name), parent: b.parent || '', pivot: b.pivot || [0, 0, 0],
      rotation: b.rotation || [0, 0, 0], color: '#8a8a8a', pattern: 'none', color2: '#ffffff',
      cubes: (b.cubes || []).filter((c) => Array.isArray(c.uv) || c.uv === undefined).map((c) => ({
        uid: uid(), origin: c.origin || [0, 0, 0], size: c.size || [1, 1, 1], uv: Array.isArray(c.uv) ? c.uv : [0, 0],
        inflate: c.inflate || 0, mirror: !!c.mirror,
      })),
    })),
  };
  return model;
}

for (const [k, d] of Object.entries(DWELLER_BODIES)) {
  TEMPLATES[k] = { label: d.label, hint: d.hint, horror: true, collision: d.collision, bones: () => dwellerBody(d.spec) };
}
