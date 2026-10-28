// Bedrock entity geometry (format 1.12+/1.16) + animation sampler for three.js.
// Mirrors Blockbench's import conventions: X is flipped (BB space), bone/cube
// rotations use Euler order ZYX with X and Y negated, per-face UVs keep their
// face names and up/down faces are stored with negative uv_size.
import * as THREE from 'three';

const D2R = Math.PI / 180;
const FACE_ORDER = ['east', 'west', 'up', 'down', 'south', 'north']; // BoxGeometry groups px nx py ny pz nz

function bbRot(r) {
  const e = new THREE.Euler(-(r?.[0] || 0) * D2R, -(r?.[1] || 0) * D2R, (r?.[2] || 0) * D2R, 'ZYX');
  return e;
}

function boxUV(size, off, mirror) {
  const [w, h, d] = size.map((s) => Math.floor(s + 1e-7));
  const list = {
    east: { from: [0, d], size: [d, h] },
    west: { from: [d + w, d], size: [d, h] },
    up: { from: [d + w, d], size: [-w, -d] },
    down: { from: [d + w * 2, 0], size: [-w, d] },
    south: { from: [d * 2 + w, d], size: [w, h] },
    north: { from: [d, d], size: [w, h] },
  };
  if (mirror) {
    for (const k of Object.keys(list)) {
      list[k].from[0] += list[k].size[0];
      list[k].size[0] *= -1;
    }
    const t = list.east.from; list.east.from = list.west.from; list.west.from = t;
  }
  const out = {};
  for (const [k, f] of Object.entries(list)) {
    out[k] = [f.from[0] + off[0], f.from[1] + off[1], f.from[0] + f.size[0] + off[0], f.from[1] + f.size[1] + off[1]];
  }
  return out;
}

export function faceUVs(cube) {
  if (Array.isArray(cube.uv)) return boxUV(cube.size, cube.uv, !!cube.mirror);
  const out = {};
  for (const k of FACE_ORDER) {
    const f = cube.uv?.[k];
    if (!f) { out[k] = null; continue; }
    const [u, v] = f.uv; const [us, vs] = f.uv_size ?? [0, 0];
    out[k] = (k === 'up' || k === 'down') ? [u + us, v + vs, u, v] : [u, v, u + us, v + vs];
  }
  return out;
}

function cubeGeometry(cube, tw, th) {
  const inf = cube.inflate || 0;
  const [sx, sy, sz] = cube.size;
  const g = new THREE.BoxGeometry(Math.max(sx + 2 * inf, 0.001) / 16, Math.max(sy + 2 * inf, 0.001) / 16, Math.max(sz + 2 * inf, 0.001) / 16);
  const uvs = faceUVs(cube);
  const uv = g.attributes.uv;
  const keep = [];
  FACE_ORDER.forEach((k, fi) => {
    const r = uvs[k];
    if (!r) return;
    keep.push(fi);
    const pts = [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]];
    for (let i = 0; i < 4; i++) uv.setXY(fi * 4 + i, pts[i][0] / tw, 1 - pts[i][1] / th);
  });
  // Drop faces without UVs (index groups of 6 per face).
  if (keep.length < 6) {
    const idx = g.index.array; const ni = [];
    for (const fi of keep) for (let i = 0; i < 6; i++) ni.push(idx[fi * 6 + i]);
    g.setIndex(ni);
    g.clearGroups();
  }
  uv.needsUpdate = true;
  return g;
}

/**
 * Build a model. Returns { root, bones } where bones maps name -> { node, base: {pos, rot} }.
 * root's local frame is BB space in blocks (1 unit = 16 px); the model's front faces -Z.
 */
export function buildModel(geoJson, material, { identifier } = {}) {
  const geos = geoJson['minecraft:geometry'];
  const geo = identifier ? geos.find((g) => g.description.identifier === identifier) : geos[0];
  const tw = geo.description.texture_width, th = geo.description.texture_height;
  const root = new THREE.Group();
  const bones = new Map();
  const pivotOf = (b) => new THREE.Vector3(-(b.pivot?.[0] || 0), b.pivot?.[1] || 0, b.pivot?.[2] || 0);
  const byName = new Map(geo.bones.map((b) => [b.name, b]));
  const make = (b) => {
    if (bones.has(b.name)) return bones.get(b.name).node;
    const node = new THREE.Group();
    node.name = b.name;
    const piv = pivotOf(b);
    const parent = b.parent && byName.get(b.parent);
    const ppiv = parent ? pivotOf(parent) : new THREE.Vector3();
    node.position.copy(piv.clone().sub(ppiv).multiplyScalar(1 / 16));
    node.rotation.copy(bbRot(b.rotation));
    const base = { pos: node.position.clone(), rot: node.rotation.clone() };
    bones.set(b.name, { node, base, def: b });
    (parent ? make(parent) : root).add(node);
    for (const c of b.cubes || []) {
      const geom = cubeGeometry(c, tw, th);
      const mesh = new THREE.Mesh(geom, material);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.cube = c; mesh.userData.bone = b.name;
      const from = new THREE.Vector3(-(c.origin[0] + c.size[0]), c.origin[1], c.origin[2]);
      const center = from.clone().add(new THREE.Vector3(c.size[0] / 2, c.size[1] / 2, c.size[2] / 2));
      if (c.rotation) {
        const cp = new THREE.Vector3(-(c.pivot?.[0] || 0), c.pivot?.[1] || 0, c.pivot?.[2] || 0);
        const holder = new THREE.Group();
        holder.position.copy(cp.clone().sub(piv).multiplyScalar(1 / 16));
        holder.rotation.copy(bbRot(c.rotation));
        mesh.position.copy(center.clone().sub(cp).multiplyScalar(1 / 16));
        holder.add(mesh);
        node.add(holder);
      } else {
        mesh.position.copy(center.clone().sub(piv).multiplyScalar(1 / 16));
        node.add(mesh);
      }
    }
    return node;
  };
  for (const b of geo.bones) make(b);
  return { root, bones, geo };
}

// ---------------------------------------------------------------- animation sampling
function evalValue(v, t) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const s = v.toLowerCase().replace(/query\.anim_time|q\.anim_time/g, String(t)).replace(/query\.life_time|q\.life_time/g, String(t))
      .replace(/math\.sin\(/g, 'Math.sin((Math.PI/180)*').replace(/math\.cos\(/g, 'Math.cos((Math.PI/180)*')
      .replace(/math\./g, 'Math.');
    try { return Number(Function(`return (${s});`)()) || 0; } catch { return 0; }
  }
  return 0;
}
function vec(v, t) {
  if (Array.isArray(v)) return v.map((x) => evalValue(x, t));
  if (v && typeof v === 'object') return vec(v.post ?? v.pre, t);
  const n = evalValue(v, t);
  return [n, n, n];
}
function sampleChannel(ch, t) {
  if (ch === undefined) return null;
  if (Array.isArray(ch) || typeof ch !== 'object' || ch.pre || ch.post) return vec(ch, t);
  const keys = Object.keys(ch).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  const k = (x) => ch[Object.keys(ch).find((s) => Number(s) === x)];
  if (t <= keys[0]) return vec(k(keys[0]), t);
  if (t >= keys[keys.length - 1]) return vec(k(keys[keys.length - 1]), t);
  let i = 0;
  while (keys[i + 1] < t) i++;
  const a = keys[i], b = keys[i + 1];
  const va = k(a), vb = k(b);
  const pa = Array.isArray(va) ? vec(va, t) : vec(va.post ?? va.pre, t);
  const pb = Array.isArray(vb) ? vec(vb, t) : vec(vb.pre ?? vb.post, t);
  const f = (t - a) / (b - a);
  return pa.map((x, j) => x + (pb[j] - x) * f);
}

/** Apply an animation (bedrock JSON object) at time t (seconds) on top of the rest pose. */
export function applyAnimation(model, anim, t) {
  for (const { node, base } of model.bones.values()) {
    node.position.copy(base.pos); node.rotation.copy(base.rot); node.scale.set(1, 1, 1);
  }
  if (!anim) return;
  const len = anim.animation_length ?? 0;
  if (anim.loop === true && len > 0) t = t % len;
  else if (len > 0) t = Math.min(t, len);
  for (const [name, chans] of Object.entries(anim.bones || {})) {
    const b = model.bones.get(name);
    if (!b) continue;
    const r = sampleChannel(chans.rotation, t);
    if (r) b.node.rotation.set(b.base.rot.x - r[0] * D2R, b.base.rot.y - r[1] * D2R, b.base.rot.z + r[2] * D2R, 'ZYX');
    const p = sampleChannel(chans.position, t);
    if (p) b.node.position.set(b.base.pos.x - p[0] / 16, b.base.pos.y + p[1] / 16, b.base.pos.z + p[2] / 16);
    const s = sampleChannel(chans.scale, t);
    if (s) b.node.scale.set(s[0] || 1e-4, s[1] || 1e-4, s[2] || 1e-4);
  }
}
