// lib_stalk.mjs: helpers for the "stalk" animation group generator (tools/anim/stalk.mjs).
// Shaftbreaker, Minecraft Bedrock add-on. Pure, deterministic math: no randomness, no Date.
//
// Conventions: SPEC.md §2 (Bedrock FILE space, degrees; +Y up, creature faces -Z, its RIGHT is -X;
// hip flexion = -X, knee = +X, shoulder flexion = -X, elbow = -X, finger curl = -X, torso hunch = +X).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadRig, solveLegWorld, boneRotation, chainRotation, eulerFromMatrix, mul3, mulv3, transpose3,
} from '../lib/legik.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ADDON_ROOT = path.resolve(HERE, '..', '..');
export const UPB = 16 / 0.58; // geometry units per block of world travel (client scale 0.58)
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const rig = loadRig();
export { boneRotation, chainRotation, eulerFromMatrix, mul3, mulv3, transpose3 };

// ------------------------------------------------------------------------------------------- scalar helpers
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrap01 = (x) => x - Math.floor(x);
export const smooth = (x) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (x) => { const t = clamp(x, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vmap = (v, f) => (Array.isArray(v) ? v.map(f) : f(v));
const vzip = (a, b, f) => (Array.isArray(a) ? a.map((x, i) => f(x, b[i])) : f(a, b));

// periodic sine with phase in cycles: s(ph) = sin(2π(ph - at)) (peaks at ph = at + 0.25)
export const psin = (ph, at = 0) => Math.sin(TAU * (ph - at));
export const pcos = (ph, at = 0) => Math.cos(TAU * (ph - at)); // peaks at ph = at

// smooth periodic bump on [0,1): 1 at `center`, falls to 0 at ±width (cosine window), wraps around the loop
export function bump(ph, center, width) {
  let d = wrap01(ph - center + 0.5) - 0.5;
  d = Math.abs(d) / width;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}
// asymmetric bump: fast rise (rise width), slow decay (fall width) -> "twitch then relax"
export function twitch(ph, center, rise, fall) {
  let d = wrap01(ph - center + 0.5) - 0.5;
  if (d < 0) return d <= -rise ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / rise);
  return d >= fall ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / fall);
}

// Cyclic cubic (Catmull-Rom style, non-uniform) spline through keys [[phase, value, flat?], ...] on [0, 1).
// value: number or array. A key with third element true ('flat') gets a zero tangent (a held extreme / ease).
export function cyc(keys, ph) {
  const k = keys.slice().sort((a, b) => a[0] - b[0]);
  const n = k.length;
  if (n === 1) return k[0][1];
  ph = wrap01(ph);
  let i = n - 1;
  for (let j = 0; j < n; j++) if (k[j][0] <= ph) i = j;
  const P = (j) => { const q = ((j % n) + n) % n; const off = Math.floor(j / n); return { t: k[q][0] + off, v: k[q][1], flat: !!k[q][2] }; };
  let a = P(i), b = P(i + 1);
  let base = i;
  if (ph < k[0][0]) { a = P(-1); b = P(0); base = -1; }
  const pm = P(base - 1), pn = P(base + 2);
  const tan = (prev, cur, next) => (cur.flat ? vmap(cur.v, () => 0) : vzip(next.v, prev.v, (x, y) => (x - y) / (next.t - prev.t)));
  const m0 = tan(pm, a, b), m1 = tan(a, b, pn);
  const h = b.t - a.t;
  let s = (ph - a.t) / h;
  if (s < 0) s += 1 / h; // wrapped
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return vzip(vzip(a.v, b.v, (x, y) => h00 * x + h01 * y), vzip(m0, m1, (x, y) => h10 * h * x + h11 * h * y), (x, y) => x + y);
}

// Open cubic Hermite spline through points [{u, v, m?}] (u increasing, v number or array, m optional tangent dv/du;
// interior tangents default to Catmull-Rom, end tangents default to one-sided differences).
export function hspline(pts, u) {
  const n = pts.length;
  if (u <= pts[0].u) return pts[0].v;
  if (u >= pts[n - 1].u) return pts[n - 1].v;
  let i = 0;
  while (i < n - 2 && u > pts[i + 1].u) i++;
  const tanAt = (j) => {
    if (pts[j].m !== undefined) return pts[j].m;
    const a = pts[Math.max(0, j - 1)], b = pts[Math.min(n - 1, j + 1)];
    return vzip(b.v, a.v, (x, y) => (x - y) / (b.u - a.u));
  };
  const a = pts[i], b = pts[i + 1];
  const h = b.u - a.u, s = (u - a.u) / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  const m0 = tanAt(i), m1 = tanAt(i + 1);
  return vzip(vzip(a.v, b.v, (x, y) => h00 * x + h01 * y), vzip(m0, m1, (x, y) => h10 * h * x + h11 * h * y), (x, y) => x + y);
}

// ------------------------------------------------------------------------------------------- pose container
// A pose is { bone: { rotation: [x,y,z], position: [x,y,z] } } (animation values, added to the rest pose).
export class Pose {
  constructor() { this.b = {}; }
  ent(bone) { return (this.b[bone] ||= { rotation: [0, 0, 0], position: [0, 0, 0] }); }
  rot(bone, r) { const e = this.ent(bone); e.rotation = add3(e.rotation, r); return this; }
  setRot(bone, r) { this.ent(bone).rotation = r.slice(); return this; }
  pos(bone, p) { const e = this.ent(bone); e.position = add3(e.position, p); return this; }
  getRot(bone) { return this.b[bone] ? this.b[bone].rotation : [0, 0, 0]; }
  getPos(bone) { return this.b[bone] ? this.b[bone].position : [0, 0, 0]; }
}

// World rotation matrix of a bone chain (all rest rotations are 0 in this rig) from the pose.
export function worldRot(pose, chain) { return chainRotation(chain.map((b) => pose.getRot(b))); }

// Local rotation for `bone` (child of the last bone of `parentChain`) so that its WORLD rotation equals `world`
// ([x, y, z] Bedrock degrees). Used to stabilise the head (level, locked forward) while the torso moves.
export function localFor(pose, parentChain, world) {
  const P = worldRot(pose, parentChain);
  return eulerFromMatrix(mul3(transpose3(P), boneRotation(world)));
}

// Leg via the shared two-bone IK (tools/lib/legik.mjs). foot = { ankle:[x,y,z] } in entity space,
// footRot = world foot rotation [pitch, yaw, roll]. Writes leg_<side>_upper / _lower / foot_<side> into the pose.
export function setLeg(pose, side, ankle, footRot = [0, 0, 0]) {
  const r = solveLegWorld(rig, side, {
    ankle, footRotation: footRot, hipZ: 'auto',
    bodyPos: pose.getPos('body'), bodyRot: pose.getRot('body'),
  });
  if (!r.reachable || r.error > 0.05) throw new Error(`stalk: ${side} ankle ${ankle.map((v) => v.toFixed(2))} unreachable (error ${r.error})`);
  pose.setRot(`leg_${side}_upper`, r.thigh);
  pose.setRot(`leg_${side}_lower`, r.knee);
  pose.setRot(`foot_${side}`, r.foot);
  return r;
}

// Ankle pivot position for a foot whose sole pivots about a ground contact line.
// contact = [x, 0, z] point on the ground; pivotRel = that point relative to the ankle in the (level) foot frame;
// footRot = world rotation of the foot. Returns the ankle pivot in entity space.
export function ankleFromContact(contact, pivotRel, footRot) {
  return sub3(contact, mulv3(boneRotation(footRot), pivotRel));
}

// ------------------------------------------------------------------------------------------- baking
const r2 = (v) => { const x = Math.round(v * 100) / 100; return Object.is(x, -0) ? 0 : x; };
const r4 = (v) => { const x = Math.round(v * 10000) / 10000; return Object.is(x, -0) ? 0 : x; };
const fmtT = (t) => { const s = r4(t).toFixed(4).replace(/0+$/, ''); return s.endsWith('.') ? s + '0' : s; };

// Ramer-Douglas-Peucker on a vector time series: keep the keys needed so that linear interpolation reproduces every
// sample within `tol` (per axis). First and last samples are always kept (loop seam stays exact).
function simplify(times, vals, tol) {
  const keep = new Uint8Array(times.length);
  keep[0] = keep[times.length - 1] = 1;
  const stack = [[0, times.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, wi = -1;
    for (let i = a + 1; i < b; i++) {
      const s = (times[i] - times[a]) / (times[b] - times[a]);
      let e = 0;
      for (let k = 0; k < 3; k++) e = Math.max(e, Math.abs(vals[a][k] + (vals[b][k] - vals[a][k]) * s - vals[i][k]));
      if (e > worst) { worst = e; wi = i; }
    }
    if (worst > tol && wi > 0) { keep[wi] = 1; stack.push([a, wi], [wi, b]); }
  }
  return keep;
}

// Sample poseFn(t) at n+1 evenly spaced times over [0, len] and build the Bedrock "bones" object.
// Channels that never change become a constant; others become linear keyframes simplified within tolerance
// (tol.rotation degrees / tol.position units; per-bone overrides via tol.bones[name]). Linear keys everywhere, so
// every channel uses a single interpolation mode and loops are exactly seamless (t = 0 and t = len are sampled
// from the same periodic functions).
export function bake(len, n, poseFn, tol = {}) {
  const times = Array.from({ length: n + 1 }, (_, i) => (i === n ? len : (len * i) / n));
  const samples = times.map((t) => poseFn(t));
  const bones = new Set();
  for (const s of samples) for (const b of Object.keys(s.b)) bones.add(b);
  const order = rig.geo.bones.map((b) => b.name).filter((b) => bones.has(b));
  const out = {};
  for (const bone of order) {
    const ent = {};
    for (const ch of ['rotation', 'position']) {
      const vals = samples.map((s) => (s.b[bone] ? s.b[bone][ch] : [0, 0, 0]).map(r2));
      const isConst = vals.every((v) => v.every((x, k) => Math.abs(x - vals[0][k]) < 0.006));
      if (isConst) {
        if (vals[0].some((x) => x !== 0)) ent[ch] = vals[0];
        continue;
      }
      const bt = (tol.bones && tol.bones[bone]) || {};
      const tl = bt[ch] ?? tol[ch] ?? (ch === 'rotation' ? 0.12 : 0.03);
      const keep = simplify(times, vals, tl);
      const keys = {};
      for (let i = 0; i < times.length; i++) if (keep[i]) keys[fmtT(times[i])] = vals[i];
      ent[ch] = keys;
    }
    if (Object.keys(ent).length) out[bone] = ent;
  }
  return out;
}

// ------------------------------------------------------------------------------------------- arm IK
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export { norm3, dot3, cross3 };

// World pivot of a bone (entity file space) for the pose: walks the chain root -> bone using rest pivots,
// animation position offsets (in the parent's frame) and rotations.
const boneDef = new Map(rig.geo.bones.map((b) => [b.name, b]));
export function chainOf(bone) {
  const out = [];
  for (let b = boneDef.get(bone); b; b = b.parent ? boneDef.get(b.parent) : null) out.unshift(b.name);
  return out;
}
export function boneFrame(pose, bone) {
  // returns { R: world rotation of the bone, p: world pivot }
  let R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  let p = [0, 0, 0];
  let prevPivot = [0, 0, 0];
  for (const name of chainOf(bone)) {
    const d = boneDef.get(name);
    const local = add3(sub3(d.pivot, prevPivot), pose.getPos(name));
    p = add3(p, mulv3(R, local));
    R = mul3(R, boneRotation(pose.getRot(name)));
    prevPivot = d.pivot;
  }
  return { R, p };
}

// Two-bone arm IK: puts the wrist (hand pivot) of `side` at world position `wrist`, elbow pointing toward `pole`
// (world direction, e.g. back/out). Writes arm_<side>_upper (rotation; keeps its position offset) and
// arm_<side>_lower (elbow flexion, always <= 0). Returns { elbowX, upper, elbow (world), reach }.
export function setArm(pose, side, wrist, pole) {
  const up = `arm_${side}_upper`, lo = `arm_${side}_lower`, hd = `hand_${side}`;
  const a = Math.hypot(...sub3(boneDef.get(lo).pivot, boneDef.get(up).pivot));
  const b = Math.hypot(...sub3(boneDef.get(hd).pivot, boneDef.get(lo).pivot));
  pose.setRot(up, [0, 0, 0]);
  const parent = boneFrame(pose, boneDef.get(up).parent);
  const S = boneFrame(pose, up).p;
  let D = sub3(wrist, S);
  let d = Math.hypot(...D);
  const u = norm3(D);
  // soft reach limit: targets beyond ~88 % of the arm length are eased toward 98.5 % (tanh, C1-continuous), so the
  // elbow never snaps straight (the IK singularity) and always keeps a slight bend (>= ~20 deg)
  const knee = 0.88 * (a + b), dMax = 0.985 * (a + b);
  if (d > knee) d = knee + (dMax - knee) * Math.tanh((d - knee) / (dMax - knee));
  d = clamp(d, Math.abs(a - b) + 1e-6, a + b - 1e-6);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  const cosE = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  const flex = Math.PI - Math.acos(cosE); // elbow flexion (rad)
  let pp = sub3(pole, scale3(u, dot3(pole, u)));
  pp = norm3(pp);
  const dir1 = add3(scale3(u, Math.cos(alpha)), scale3(pp, Math.sin(alpha)));
  const E = add3(S, scale3(dir1, a));
  const dir2 = norm3(sub3(add3(S, scale3(u, d)), E));
  let f = sub3(dir2, scale3(dir1, dot3(dir2, dir1)));
  f = Math.hypot(...f) < 1e-6 ? scale3(pp, -1) : norm3(f);
  const Y = scale3(dir1, -1), Z = scale3(f, -1), X = cross3(Y, Z);
  const Rw = [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
  const local = eulerFromMatrix(mul3(transpose3(parent.R), Rw));
  pose.setRot(up, local);
  pose.setRot(lo, [-flex / DEG, 0, 0]);
  return { upper: local, elbowX: -flex / DEG, elbow: E, reach: d };
}

// Hand rotation = twist about its own long axis first, then wrist flexion/extension and side bend in the forearm
// frame: R = Rz(side) · Rx(flex) · Ry(twist) (Bedrock degrees), converted to Bedrock Z·Y·X euler.
export function handRot(flex, twist, sideBend = 0) {
  return eulerFromMatrix(mul3(mul3(boneRotation([0, 0, sideBend]), boneRotation([flex, 0, 0])), boneRotation([0, twist, 0])));
}

// JSON with objects indented but number arrays kept on one line (keeps the animation file compact and diff-able).
export function stringifyCompact(value, indent = '') {
  const next = indent + '  ';
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v !== 'object' || v === null)) return '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
    return '[\n' + value.map((v) => next + stringifyCompact(v, next)).join(',\n') + '\n' + indent + ']';
  }
  if (value && typeof value === 'object') {
    const ents = Object.entries(value);
    if (!ents.length) return '{}';
    return '{\n' + ents.map(([k, v]) => next + JSON.stringify(k) + ': ' + stringifyCompact(v, next)).join(',\n') + '\n' + indent + '}';
  }
  return JSON.stringify(value);
}
