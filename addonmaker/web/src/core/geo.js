// Entity model templates, box-UV layout, auto-UV packing and procedural
// texture painting. Coordinates follow Bedrock geometry: pixels (1/16 block),
// y up, the entity faces -Z (north).
import { uid, clone } from './util.js';
import { paintModel } from './paint.js';

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

/**
 * Procedural texture for a model (see paint.js): face lighting, soft edges,
 * patterns, faces and glowing eyes, at up to 4 pixels per texel.
 */
export function autoPaint(model, opts = {}) {
  return paintModel(model, opts);
}

// ---------------------------------------------------------------------------
// Dweller body builder: proportions → bones. Pixel units, entity faces -Z.
export const DEFAULT_BODY = {
  legLen: 22, legW: 2, footL: 0, hipW: 6,
  torsoW: 8, torsoH: 12, torsoD: 4,
  neck: 1, neckW: 3,
  headW: 6, headH: 9, headD: 6, headForward: 0, brow: false,
  armLen: 26, armW: 2, handSize: 3, hands: 'block', clawLen: 5,
  extraArms: false, antlers: false, hat: false, hood: false, horns: false, spikes: false, spine: false, tail: 0,
  quad: false, float: false, hunch: 1,
};

const r1 = (v) => Math.round(v * 4) / 4; // keep sizes on quarter pixels

/**
 * Anatomy-style body: shoulders, chest, waist and hips; two-part limbs with
 * elbows and knees (child bones with a slight bend); hands with fingers and
 * claws; feet with toes. Roles stay on the main limb bones so built-in
 * animations move whole limbs; the lower parts follow.
 */
export function dwellerBody(spec = {}, colors = {}) {
  const s = { ...DEFAULT_BODY, ...spec };
  const col = (role, d) => colors[role] || d;
  const bones = [];
  const push = (b) => { bones.push(b); return b; };
  if (s.quad) return quadBody(s, col);
  const bend = Math.max(0, Number(s.hunch) || 0);
  const legTop = s.float ? 4 : s.legLen;
  if (!s.float) {
    const lx = s.hipW / 2 - s.legW / 2;
    const knee = r1(s.legLen * 0.5);
    for (const [side, role, name] of [[-1, 'legR', 'rightLeg'], [1, 'legL', 'leftLeg']]) {
      const px = side * lx;
      const lw = s.legW, tw = r1(lw + (lw >= 2 ? 0.5 : 0.25));
      const legColor = col(role, col('legs', '#2a2a2e'));
      // Thigh (tapers into the knee).
      push(B(name, role, [px, s.legLen, 0], [
        C([px - tw / 2, knee + 1, -tw / 2], [tw, s.legLen - knee - 1, tw]),
        C([px - lw / 2, knee, -lw / 2], [lw, 1.5, lw]),
      ], { color: legColor, rotation: [r1(-5 * bend), 0, 0] }));
      // Shin + knee cap + foot + toes.
      const sw = r1(Math.max(1, lw - (lw >= 3 ? 0.5 : 0)));
      const fl = s.footL > 0 ? s.footL : Math.max(1.5, lw * 0.75);
      const shin = [
        C([px - sw / 2, 1.5, -sw / 2], [sw, knee - 1, sw]),
        C([px - lw / 2 - 0.25, knee - 1, -lw / 2 - 0.5], [lw + 0.5, 2, 1]),
        C([px - lw / 2 - 0.25, 0, -lw / 2 - fl], [lw + 0.5, 1.5, lw + fl]),
      ];
      const toes = s.hands === 'claws' ? 3 : 0;
      for (let i = 0; i < toes; i++) shin.push(C([px - lw / 2 + i * (lw - 0.5) / 2, 0, -lw / 2 - fl - 1.5], [0.5, 0.75, 1.75]));
      push(B(`${name}Lower`, 'none', [px, knee, 0], shin, { parent: name, color: legColor, rotation: [r1(9 * bend), 0, 0] }));
    }
  }
  // Torso: hips, waist, chest, shoulders (+ spine knobs and spikes).
  const torsoBottom = s.float ? 0 : legTop + 2;
  const topY = s.float ? s.torsoH + legTop : torsoBottom + s.torsoH;
  const W = s.torsoW, D = s.torsoD;
  const waistW = r1(Math.max(W * 0.72, W - 3)), chestH = r1(s.torsoH * 0.58), waistH = r1(s.torsoH - chestH);
  const bodyCubes = [];
  if (s.float) {
    // Robe that widens to the bottom, with ragged strips hanging off the hem.
    const H = s.torsoH + legTop;
    bodyCubes.push(C([-W / 2, r1(H * 0.45), -D / 2], [W, r1(H * 0.55), D]));
    bodyCubes.push(C([-W / 2 - 1, 2, -D / 2 - 1], [W + 2, r1(H * 0.45) - 2, D + 2]));
    const rr = rngLite(hashLite(`${W}${H}`));
    for (let i = 0; i < 5; i++) {
      const x = -W / 2 - 1 + i * ((W + 2) / 5);
      bodyCubes.push(C([r1(x), 0, -D / 2 - 1.1], [r1((W + 2) / 5 - 0.25), r1(1 + rr() * 2), 0.5]));
      bodyCubes.push(C([r1(x), 0, D / 2 + 0.6], [r1((W + 2) / 5 - 0.25), r1(1 + rr() * 2), 0.5]));
    }
  } else {
    bodyCubes.push(C([-s.hipW / 2 - 0.5, legTop, -D / 2 + 0.25], [s.hipW + 1, 2.5, Math.max(2, D - 0.5)]));
    bodyCubes.push(C([-waistW / 2, torsoBottom, -D / 2 + 0.5], [waistW, waistH, Math.max(2, D - 1)]));
    bodyCubes.push(C([-W / 2, torsoBottom + waistH, -D / 2], [W, chestH, D]));
    bodyCubes.push(C([-W / 2 - 0.5, topY - 2, -D / 2 + 0.25], [W + 1, 2, D - 0.5])); // shoulders / collarbones
  }
  if (s.spine) for (let i = 0; i < 4; i++) bodyCubes.push(C([-0.5, topY - 2.5 - i * 3, D / 2], [1, 1.25, 0.75]));
  if (s.spikes) for (let i = 0; i < 3; i++) bodyCubes.push(C([-0.5, topY - 3 - i * 4, D / 2], [1, 2, 2]));
  if (s.tail > 0) bodyCubes.push(C([-0.75, legTop + 1, D / 2], [1.5, 1.5, s.tail]));
  push(B('body', 'body', [0, legTop, 0], bodyCubes, { color: col('body', '#1d1b20') }));
  // Head (with neck, brow ridge, cheekbones).
  const hz = -s.headD / 2 - s.headForward;
  const headCubes = [C([-s.headW / 2, topY + s.neck, hz], [s.headW, s.headH, s.headD])];
  if (s.neck > 0) headCubes.push(C([-s.neckW / 2, topY - 0.5, -s.neckW / 2 - s.headForward / 2], [s.neckW, s.neck + 1, s.neckW]));
  if (s.brow) headCubes.push(C([-s.headW / 2, topY + s.neck + s.headH - 1.25, hz - 0.75], [s.headW, 1, 0.75])); // above the eye sockets
  const hTop = topY + s.neck + s.headH;
  if (s.hood) headCubes.push(C([-s.headW / 2 - 1, topY + s.neck - 1, hz + 0.5], [s.headW + 2, s.headH + 2, s.headD + 1.5]));
  push(B('head', 'head', [0, topY, 0], headCubes, { parent: 'body', color: col('head', '#cfc8bd') }));
  if (s.antlers || s.hat || s.horns) {
    const ex = [];
    if (s.antlers) {
      for (const side of [-1, 1]) {
        const bx = side * (s.headW / 2 - 1);
        ex.push(C([bx - 0.5, hTop, -0.5 - s.headForward], [1, 6, 1]), C([bx + (side > 0 ? 0 : -3), hTop + 4, -0.5 - s.headForward], [3.5, 1, 1]), C([bx + side * 3 - 0.5, hTop + 4, -0.5 - s.headForward], [1, 4, 1]), C([bx + side * 1 - 0.5, hTop + 6, -0.5 - s.headForward], [1, 3, 1]));
      }
    }
    if (s.horns) for (const side of [-1, 1]) ex.push(C([side * (s.headW / 2) - 1, hTop - 2, -1 - s.headForward], [2, 4, 2]), C([side * (s.headW / 2 + 1) - 0.5, hTop + 1, -0.5 - s.headForward], [1, 3, 1]), C([side * (s.headW / 2 + 1.5) - 0.25, hTop + 3.5, -0.25 - s.headForward], [0.5, 2, 0.5]));
    if (s.hat) ex.push(C([-s.headW / 2 - 2, hTop, -s.headD / 2 - 2 - s.headForward], [s.headW + 4, 1, s.headD + 4]), C([-s.headW / 2 + 0.5, hTop + 1, -s.headD / 2 + 0.5 - s.headForward], [s.headW - 1, Math.round(s.headH * 1.1), s.headD - 1]));
    push(B('headwear', 'none', [0, topY, 0], ex, { parent: 'head', color: col('extra', '#e9e2d0') }));
  }
  // Arms: shoulder + upper arm, then a forearm bone (elbow bend) and a hand bone.
  const shoulderY = topY - 1;
  const armSets = [[shoulderY, s.armLen, '']];
  if (s.extraArms) armSets.push([shoulderY - Math.round(s.torsoH * 0.45), Math.round(s.armLen * 0.8), 'Lower']);
  for (const [sy, len, tag] of armSets) {
    for (const [side, role, name] of [[-1, 'armR', 'rightArm'], [1, 'armL', 'leftArm']]) {
      const aw = s.armW, px = side * (W / 2 + aw / 2);
      const upper = r1(len * 0.48), elbowY = sy - upper;
      const armColor = col('arms', col('body', '#1d1b20'));
      push(B(`${name}${tag}`, tag ? 'none' : role, [px, sy, 0], [
        C([px - aw / 2 - 0.25, sy - 3, -aw / 2 - 0.25], [aw + 0.5, 3.5, aw + 0.5]), // shoulder
        C([px - aw / 2, elbowY, -aw / 2], [aw, upper - 2.5, aw]),
      ], { parent: 'body', color: armColor }));
      const fw = r1(Math.max(1, aw - (aw >= 3 ? 0.5 : 0))), fore = len - upper;
      const foreName = `${name}${tag}Fore`;
      push(B(foreName, 'none', [px, elbowY, 0], [
        C([px - fw / 2, elbowY - fore, -fw / 2], [fw, fore, fw]),
        C([px - aw / 2 - 0.25, elbowY - 1, -aw / 2 + 0.25], [aw + 0.5, 1.5, aw]), // elbow
      ], { parent: `${name}${tag}`, color: armColor, rotation: [r1(-10 * Math.min(1, bend + 0.3)), 0, 0] }));
      if (s.hands !== 'none') {
        const hs = s.handSize, hy = elbowY - fore;
        const palmH = r1(Math.max(1.5, hs * 0.7));
        const cubes = [C([px - hs / 2, hy - palmH + 0.25, -hs / 2], [hs, palmH, hs * 0.75])];
        const fingers = 3, fwid = r1(Math.max(0.5, Math.min(1.25, hs / 3.5))), flen = r1(Math.max(1.25, hs * 0.75));
        for (let i = 0; i < fingers; i++) {
          const fx = px - hs / 2 + 0.15 + i * (hs - fwid - 0.3) / (fingers - 1);
          cubes.push(C([r1(fx), hy - palmH - flen + 0.5, -hs / 2 + 0.1], [fwid, flen, fwid]));
          if (s.hands === 'claws') cubes.push(C([r1(fx + fwid / 2 - 0.25), hy - palmH - flen + 0.5 - s.clawLen, -hs / 2 - 0.15], [0.5, s.clawLen, 0.5]));
        }
        // Thumb on the inner side.
        cubes.push(C([side > 0 ? px - hs / 2 - fwid + 0.25 : px + hs / 2 - 0.25, hy - palmH * 0.8, -hs / 2 - 0.25], [fwid, r1(flen * 0.8), fwid]));
        push(B(`${name}${tag}Hand`, 'none', [px, hy, 0], cubes, { parent: foreName, color: col('hands', '#e8b878') }));
      }
    }
  }
  if (s.hunch) for (const b of bones) b.hunch = s.hunch;
  return bones;
}

// Deterministic helpers for body details (independent of util.js's rng).
const hashLite = (str) => { let h = 2166136261; for (const ch of String(str)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
const rngLite = (seed) => { let x = seed || 1; return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 10000) / 10000; }; };

function quadBody(s, col) {
  const bones = [];
  const L = s.bodyLen || 18, W = s.torsoW || 8, H = s.torsoH || 7, legLen = s.legLen || 14, lw = s.legW || 2;
  const bodyY = legLen;
  const bodyCubes = [
    C([-W / 2, bodyY, -L / 2], [W, H, r1(L * 0.55)]), // chest
    C([-W / 2 + 0.75, bodyY + 0.5, r1(-L / 2 + L * 0.55)], [W - 1.5, H - 1, r1(L * 0.45)]), // flank, slimmer
  ];
  if (s.spikes) for (let i = 0; i < 4; i++) bodyCubes.push(C([-0.5, bodyY + H, -L / 2 + 2 + i * 4], [1, 2, 2]));
  else for (let i = 0; i < 4; i++) bodyCubes.push(C([-0.5, bodyY + H, -L / 2 + 2 + i * (L / 4.5)], [1, 0.75, 1.25])); // spine ridge
  bones.push(B('body', 'body', [0, bodyY + H / 2, 0], bodyCubes, { color: col('body', '#2b2622') }));
  const hz = -L / 2 - (s.neck || 2);
  const hy = bodyY + H - 2 - s.headH / 2;
  const snout = Math.max(2, Math.round(s.headD * 0.4));
  const headCubes = [
    C([-s.headW / 2, hy, hz - s.headD + snout], [s.headW, s.headH, s.headD - snout]),
    C([-s.headW / 2 + 1, hy, hz - s.headD], [s.headW - 2, r1(s.headH * 0.6), snout]), // snout / jaw
  ];
  if (!s.splay) headCubes.push(C([-s.headW / 2, hy + s.headH, hz - s.headD + snout + 1], [1.5, 2, 1]), C([s.headW / 2 - 1.5, hy + s.headH, hz - s.headD + snout + 1], [1.5, 2, 1])); // ears
  if (s.neck) headCubes.push(C([-s.neckW / 2, bodyY + H - 3, hz], [s.neckW, s.neckW, s.neck + 1]));
  bones.push(B('head', 'head', [0, bodyY + H - 1, -L / 2], headCubes, { parent: 'body', color: col('head', '#3a332c') }));
  const legs = [['frontRight', 'legFR', -1, -1], ['frontLeft', 'legFL', 1, -1], ['backRight', 'legBR', -1, 1], ['backLeft', 'legBL', 1, 1]];
  for (const [name, role, sx, sz] of legs) {
    const px = sx * (W / 2 + (s.splay ? 2 : -lw / 2)), pz = sz * (L / 2 - 2);
    const knee = r1(legLen * 0.5);
    const upper = [C([px - (lw + 0.5) / 2, knee, pz - (lw + 0.5) / 2], [lw + 0.5, legLen - knee + 1, lw + 0.5])];
    if (s.splay) upper.push(C([Math.min(px, sx * W / 2), legLen, pz - lw / 2], [Math.abs(px - sx * W / 2) + lw / 2, lw, lw]));
    bones.push(B(name, role, [px, legLen, pz], upper, { color: col('legs', '#221e1a') }));
    const lower = [C([px - lw / 2, 0.75, pz - lw / 2], [lw, knee - 0.75, lw]), C([px - lw / 2 - 0.25, 0, pz - lw / 2 - 1], [lw + 0.5, 1, lw + 1])];
    if (s.hands === 'claws') for (let i = 0; i < 3; i++) lower.push(C([px - lw / 2 + i * (lw - 0.5) / 2, 0, pz - lw / 2 - 2.5], [0.5, 0.6, 1.75]));
    bones.push(B(`${name}Lower`, 'none', [px, knee, pz], lower, { parent: name, color: col('legs', '#221e1a'), rotation: [sz < 0 ? -6 : 8, 0, 0] }));
  }
  if (s.tail > 0) {
    const t1 = r1(s.tail * 0.55);
    bones.push(B('tail', 'tail', [0, bodyY + H - 1, L / 2], [C([-0.75, bodyY + H - 2, L / 2], [1.5, 1.5, t1])], { parent: 'body', color: col('body', '#2b2622'), rotation: [-20, 0, 0] }));
    bones.push(B('tailTip', 'none', [0, bodyY + H - 1.25, L / 2 + t1], [C([-0.5, bodyY + H - 1.75, L / 2 + t1], [1, 1, s.tail - t1])], { parent: 'tail', color: col('body', '#2b2622'), rotation: [15, 0, 0] }));
  }
  return bones;
}

/** Dweller body presets usable as model templates. */
export const DWELLER_BODIES = {
  grinner: { label: 'Grinner', hint: 'Tall, boxy head, big hands.', spec: { legLen: 24, legW: 3, footL: 3, hipW: 7, torsoW: 10, torsoH: 13, torsoD: 6, neck: 1, neckW: 4, headW: 8, headH: 12, headD: 8, armLen: 28, armW: 4, handSize: 4 }, collision: [0.8, 2.9] },
  lurker: { label: 'Lurker', hint: 'Skeletal, long claws, ribs.', spec: { legLen: 22, legW: 3, footL: 3, hipW: 6, torsoW: 9, torsoH: 14, torsoD: 5, neck: 2, neckW: 3, headW: 8, headH: 12, headD: 8, headForward: 1, brow: true, spine: true, armLen: 32, armW: 3, handSize: 3, hands: 'claws', clawLen: 6 }, collision: [0.7, 2.8] },
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
