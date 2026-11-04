// Minimal, faithful Bedrock entity loader for three.js.
// Reads a .geo.json (box UV) + .animation.json and reproduces Blockbench's
// preview conventions exactly: x is mirrored between Bedrock and three.js
// space, euler order 'ZYX', rotations x/y negated, animation position x negated.
import * as THREE from 'three';

const D2R = Math.PI / 180;

function toThree(v) { return new THREE.Vector3(-v[0], v[1], v[2]); }

// Bedrock-space box UV mapping for one cube -> list of quads with uv
function cubeQuads(c) {
  const [x0, y0, z0] = c.origin;
  const [w, h, d] = c.size;
  const x1 = x0 + w, y1 = y0 + h, z1 = z0 + d;
  const [U, V] = c.uv;
  const q = [];
  // each quad: 4 corners [x,y,z,u,v] in order TL, TR, BR, BL (as seen on the texture), plus outward normal
  q.push({ n: [0, 0, -1], p: [[x0, y1, z0, U + d, V + d], [x1, y1, z0, U + d + w, V + d], [x1, y0, z0, U + d + w, V + d + h], [x0, y0, z0, U + d, V + d + h]] });            // north
  q.push({ n: [0, 0, 1], p: [[x1, y1, z1, U + 2 * d + w, V + d], [x0, y1, z1, U + 2 * d + 2 * w, V + d], [x0, y0, z1, U + 2 * d + 2 * w, V + d + h], [x1, y0, z1, U + 2 * d + w, V + d + h]] }); // south
  q.push({ n: [-1, 0, 0], p: [[x0, y1, z1, U, V + d], [x0, y1, z0, U + d, V + d], [x0, y0, z0, U + d, V + d + h], [x0, y0, z1, U, V + d + h]] });                       // east (model right)
  q.push({ n: [1, 0, 0], p: [[x1, y1, z0, U + d + w, V + d], [x1, y1, z1, U + 2 * d + w, V + d], [x1, y0, z1, U + 2 * d + w, V + d + h], [x1, y0, z0, U + d + w, V + d + h]] }); // west (model left)
  q.push({ n: [0, 1, 0], p: [[x0, y1, z1, U + d, V], [x1, y1, z1, U + d + w, V], [x1, y1, z0, U + d + w, V + d], [x0, y1, z0, U + d, V + d]] });                       // up
  q.push({ n: [0, -1, 0], p: [[x0, y0, z1, U + d + w, V], [x1, y0, z1, U + d + 2 * w, V], [x1, y0, z0, U + d + 2 * w, V + d], [x0, y0, z0, U + d + w, V + d]] });     // down
  return q;
}

export function buildModel(geoJson, texture, opts = {}) {
  const geo = geoJson['minecraft:geometry'][0];
  const TW = geo.description.texture_width, TH = geo.description.texture_height;
  const material = opts.material || new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.0, alphaTest: 0.5 });
  const bones = new Map();
  const root = new THREE.Group();
  root.name = 'model';
  for (const b of geo.bones) {
    const g = new THREE.Group();
    g.name = b.name;
    g.rotation.order = 'ZYX';
    const pivot = toThree(b.pivot);
    const parent = b.parent ? bones.get(b.parent) : null;
    const parentPivot = parent ? parent.pivot : new THREE.Vector3();
    const rest = b.rotation || [0, 0, 0];
    bones.set(b.name, { def: b, group: g, pivot, rest, basePos: pivot.clone().sub(parentPivot) });
    (parent ? parent.group : root).add(g);
    g.position.copy(pivot).sub(parentPivot);
    if (b.cubes && b.cubes.length) {
      const pos = [], uv = [], nor = [], idx = [];
      for (const c of b.cubes) {
        for (const quad of cubeQuads(c)) {
          const base = pos.length / 3;
          const pts = quad.p.map(([x, y, z, u, v]) => ({ p: toThree([x, y, z]).sub(pivot), u: u / TW, v: 1 - v / TH }));
          for (const pt of pts) { pos.push(pt.p.x, pt.p.y, pt.p.z); uv.push(pt.u, pt.v); }
          const n = toThree(quad.n);
          for (let k = 0; k < 4; k++) nor.push(n.x, n.y, n.z);
          // pick winding so the triangle faces outward after the x mirror
          const e1 = pts[1].p.clone().sub(pts[0].p), e2 = pts[2].p.clone().sub(pts[0].p);
          const fn = e1.clone().cross(e2);
          if (fn.dot(n) >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
          else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        }
      }
      const bg = new THREE.BufferGeometry();
      bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      bg.setIndex(idx);
      const mesh = new THREE.Mesh(bg, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.name = b.name + '_mesh';
      g.add(mesh);
    }
  }
  const model = { root, bones, material };
  applyPose(model, {});
  return model;
}

// poses: { bone: {rotation:[x,y,z], position:[x,y,z], scale:[x,y,z]} } in Bedrock animation values
export function applyPose(model, poses) {
  for (const [name, b] of model.bones) {
    const a = poses[name] || {};
    const r = a.rotation || [0, 0, 0];
    const p = a.position || [0, 0, 0];
    const s = a.scale || [1, 1, 1];
    b.group.rotation.set(-(b.rest[0] + r[0]) * D2R, -(b.rest[1] + r[1]) * D2R, (b.rest[2] + r[2]) * D2R, 'ZYX');
    b.group.position.set(b.basePos.x - p[0], b.basePos.y + p[1], b.basePos.z + p[2]);
    b.group.scale.set(s[0], s[1], s[2]);
  }
}

// ---------------------------------------------------------------- animations
function parseChannel(ch) {
  if (ch === undefined || ch === null) return null;
  if (Array.isArray(ch) || typeof ch === 'number' || typeof ch === 'string') {
    return [{ t: 0, pre: vec(ch), post: vec(ch), lerp: 'linear' }];
  }
  const keys = Object.keys(ch).map(k => {
    const v = ch[k];
    if (Array.isArray(v) || typeof v !== 'object') return { t: parseFloat(k), pre: vec(v), post: vec(v), lerp: 'linear' };
    const pre = v.pre !== undefined ? vec(v.pre) : vec(v.post);
    const post = v.post !== undefined ? vec(v.post) : vec(v.pre);
    return { t: parseFloat(k), pre, post, lerp: v.lerp_mode || 'linear' };
  });
  keys.sort((a, b) => a.t - b.t);
  return keys;
}
function vec(v) {
  if (typeof v === 'number') return [v, v, v];
  if (typeof v === 'string') { const n = parseFloat(v) || 0; return [n, n, n]; }
  return v.map(x => (typeof x === 'number' ? x : (parseFloat(x) || 0)));
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

function sampleChannel(keys, time) {
  if (!keys || !keys.length) return null;
  if (time <= keys[0].t) return keys[0].pre;
  const last = keys[keys.length - 1];
  if (time >= last.t) return last.post;
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= time) i++;
  const a = keys[i], b = keys[i + 1];
  const f = (time - a.t) / (b.t - a.t);
  if (a.lerp === 'step') return a.post;
  if (a.lerp === 'catmullrom' || b.lerp === 'catmullrom') {
    const a0 = keys[Math.max(0, i - 1)], b1 = keys[Math.min(keys.length - 1, i + 2)];
    return [0, 1, 2].map(k => catmull(a0.post[k], a.post[k], b.pre[k], b1.pre[k], f));
  }
  return [0, 1, 2].map(k => a.post[k] + (b.pre[k] - a.post[k]) * f);
}

export function compileAnimations(animJson) {
  const out = {};
  for (const [name, a] of Object.entries(animJson.animations || {})) {
    const bones = {};
    for (const [bn, chs] of Object.entries(a.bones || {})) {
      bones[bn] = { rotation: parseChannel(chs.rotation), position: parseChannel(chs.position), scale: parseChannel(chs.scale) };
    }
    out[name] = { name, loop: a.loop === true || a.loop === 'hold_on_last_frame' ? a.loop : false, length: a.animation_length || 0, bones };
  }
  return out;
}

export function samplePose(anim, time) {
  let t = time;
  if (anim.loop === true && anim.length > 0) t = ((time % anim.length) + anim.length) % anim.length;
  const poses = {};
  for (const [bn, ch] of Object.entries(anim.bones)) {
    const p = {};
    const r = sampleChannel(ch.rotation, t); if (r) p.rotation = r;
    const q = sampleChannel(ch.position, t); if (q) p.position = q;
    const s = sampleChannel(ch.scale, t); if (s) p.scale = s;
    poses[bn] = p;
  }
  return poses;
}

export function mixPoses(a, b, w) {
  // linear blend of two pose dicts (w=0 -> a, w=1 -> b)
  const out = {};
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const n of names) {
    const pa = a[n] || {}, pb = b[n] || {};
    const o = {};
    for (const ch of ['rotation', 'position', 'scale']) {
      const def = ch === 'scale' ? [1, 1, 1] : [0, 0, 0];
      const va = pa[ch] || def, vb = pb[ch] || def;
      if (pa[ch] || pb[ch]) o[ch] = [0, 1, 2].map(k => va[k] + (vb[k] - va[k]) * w);
    }
    out[n] = o;
  }
  return out;
}
