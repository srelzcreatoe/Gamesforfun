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

export function makeModel(template = 'humanoid') {
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

/** Paints every cube face with its bone colour, light-direction shading and noise. */
export function autoPaint(model, opts = {}) {
  const { noise = 0.07, outline = true, eyes = true, seed = 7, eyeStyle = 'normal', eyeColor = '#ff2a2a', mouth = 'line' } = opts;
  const R = new Raster(model.texW, model.texH);
  const FACE_LIGHT = { up: 1.14, down: 0.72, north: 1.0, south: 0.9, east: 0.84, west: 0.84 };
  for (const bone of model.bones) {
    const base = hexToRgb(bone.color);
    const accent = hexToRgb(bone.color2 || '#ffffff');
    const rand = rng(seed + hashStr(bone.name));
    for (const cube of bone.cubes) {
      const rects = faceRects(cube);
      for (const [face, r] of Object.entries(rects)) {
        const x0 = Math.floor(r.x), y0 = Math.floor(r.y), w = Math.ceil(r.w), h = Math.ceil(r.h);
        const col = shade(base, FACE_LIGHT[face]);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          let c = col;
          if (bone.pattern === 'stripes' && Math.floor((x + y) / 2) % 3 === 0) c = shade(accent, FACE_LIGHT[face]);
          else if (bone.pattern === 'gradient') { const t = h > 1 ? y / (h - 1) : 0; c = [0, 1, 2].map((i) => col[i] * (1 - t * 0.35) + shade(accent, FACE_LIGHT[face])[i] * t * 0.35); }
          else if (bone.pattern === 'spots' && rand() < 0.11) c = shade(accent, FACE_LIGHT[face] * 0.95);
          else if (bone.pattern === 'grime' && rand() < 0.28) c = [0, 1, 2].map((i) => col[i] * 0.5 + shade(accent, FACE_LIGHT[face])[i] * 0.5);
          else if (bone.pattern === 'cracks' && crackAt(x, y, w, h, seed + hashStr(bone.name + face))) c = shade(accent, FACE_LIGHT[face]);
          const n = 1 + (rand() * 2 - 1) * noise;
          let px = shade(c, n);
          if (outline && w > 2 && h > 2 && (x === 0 || y === 0 || x === w - 1 || y === h - 1)) px = shade(px, 0.82);
          R.set(x0 + x, y0 + y, px[0], px[1], px[2], 255);
        }
      }
      if (eyes && eyeStyle !== 'normal' && bone.role === 'head' && cube === bone.cubes[0]) {
        paintHorrorFace(R, rects.north, eyeStyle, hexToRgb(eyeColor), mouth, shade(base, 0.35));
      } else if (eyes && (bone.role === 'head' || (model.template === 'blob' && bone.role === 'body'))) {
        const f = rects.north;
        const fw = Math.round(f.w), fh = Math.round(f.h);
        if (fw >= 4 && fh >= 3) {
          const ey = Math.floor(f.y) + Math.max(1, Math.floor(fh * 0.38));
          const inset = Math.max(1, Math.floor(fw * 0.22));
          const ew = fw >= 8 ? 2 : 1;
          for (const ex of [Math.floor(f.x) + inset, Math.floor(f.x) + fw - inset - ew]) {
            for (let i = 0; i < ew; i++) {
              R.set(ex + i, ey, 245, 245, 245, 255);
              R.set(ex + (ex < f.x + fw / 2 ? ew - 1 : 0), ey, 32, 28, 40, 255);
            }
          }
          if (fh >= 6 && fw >= 6 && model.template !== 'blob') {
            const my = ey + Math.max(2, Math.floor(fh * 0.3));
            const mx = Math.floor(f.x + fw / 2) - 1;
            R.set(mx, my, ...shade(base, 0.55), 255); R.set(mx + 1, my, ...shade(base, 0.55), 255);
          }
        }
      }
    }
  }
  return R;
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

/** Horror faces: glowing or hollow eyes plus an optional grin. */
function paintHorrorFace(R, f, style, eyeRgb, mouth, dark) {
  const x0 = Math.floor(f.x), y0 = Math.floor(f.y), fw = Math.round(f.w), fh = Math.round(f.h);
  if (fw < 4 || fh < 4) return;
  const ey = y0 + Math.max(1, Math.floor(fh * 0.3));
  const ew = fw >= 7 ? 2 : 1, eh = fh >= 8 ? 2 : 1;
  const inset = Math.max(1, Math.floor(fw * 0.18));
  for (const ex of [x0 + inset, x0 + fw - inset - ew]) {
    for (let dy = -1; dy <= eh; dy++) for (let dx = -1; dx <= ew; dx++) R.set(ex + dx, ey + dy, dark[0] * 0.4, dark[1] * 0.4, dark[2] * 0.4, 255);
    for (let dy = 0; dy < eh; dy++) for (let dx = 0; dx < ew; dx++) {
      if (style === 'glow') R.set(ex + dx, ey + dy, eyeRgb[0], eyeRgb[1], eyeRgb[2], 255);
      else R.set(ex + dx, ey + dy, 4, 3, 6, 255);
    }
    if (style === 'hollow' && ew > 1) R.set(ex + (ex < x0 + fw / 2 ? ew - 1 : 0), ey + eh - 1, eyeRgb[0], eyeRgb[1], eyeRgb[2], 255);
  }
  if (mouth === 'none') return;
  const my = ey + eh + Math.max(2, Math.floor(fh * 0.25));
  if (my >= y0 + fh) return;
  const mx0 = x0 + Math.max(1, Math.floor(fw * (mouth === 'grin' ? 0.12 : 0.3))), mx1 = x0 + fw - 1 - Math.max(1, Math.floor(fw * (mouth === 'grin' ? 0.12 : 0.3)));
  for (let x = mx0; x <= mx1; x++) {
    R.set(x, my, 10, 6, 8, 255);
    if (mouth === 'grin') {
      if (my + 1 < y0 + fh) R.set(x, my + 1, (x - mx0) % 2 ? 230 : 10, (x - mx0) % 2 ? 224 : 6, (x - mx0) % 2 ? 210 : 8, 255);
      if (x === mx0 || x === mx1) R.set(x, my - 1, 10, 6, 8, 255);
    }
  }
}

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
