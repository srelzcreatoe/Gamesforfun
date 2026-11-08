// lib_breaker.mjs: helpers for the "breaker" animation group generator (tools/anim/breaker.mjs).
// Shaftbreaker, Minecraft Bedrock add-on. Pure, deterministic math: no randomness, no Date.
//
// Conventions: SPEC.md §2 (Bedrock FILE space, degrees; +Y up, creature faces -Z, its RIGHT is -X;
// hip flexion = -X, knee = +X, shoulder flexion = -X, elbow = -X, finger curl = -X, torso hunch = +X,
// +Y turns a bone's front toward the creature's RIGHT).
// (Own copy of the generic pose / IK / bake helpers so this group never depends on another group's files.)
import path from 'node:path';
import fs from 'node:fs';
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
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const mirrorX = (v) => [-v[0], v[1], v[2]];
const vmap = (v, f) => (Array.isArray(v) ? v.map(f) : f(v));
const vzip = (a, b, f) => (Array.isArray(a) ? a.map((x, i) => f(x, b[i])) : f(a, b));

// periodic sine / cosine with phase in cycles
export const psin = (ph, at = 0) => Math.sin(TAU * (ph - at));
export const pcos = (ph, at = 0) => Math.cos(TAU * (ph - at)); // peaks at ph = at

// smooth periodic bump on [0,1): 1 at `center`, 0 beyond ±width (cosine window), wraps around the loop
export function bump(ph, center, width) {
  let d = wrap01(ph - center + 0.5) - 0.5;
  d = Math.abs(d) / width;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
}
// asymmetric periodic bump: rise over `rise`, peak at `center`, decay over `fall` (a hit, then a slow settle)
export function twitch(ph, center, rise, fall) {
  let d = wrap01(ph - center + 0.5) - 0.5;
  if (d < 0) return d <= -rise ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / rise);
  return d >= fall ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / fall);
}
// decaying shudder after an impact at `center` (periodic): damped sine, 0 outside [center, center + dur]
export function shudder(ph, center, dur, cycles = 2.5) {
  const d = wrap01(ph - center);
  if (d >= dur) return 0;
  const x = d / dur;
  return Math.sin(TAU * cycles * x) * (1 - x) * (1 - x);
}

// Cyclic cubic Hermite spline through keys [[phase, value, flat?], ...] on [0, 1) (Catmull-Rom tangents,
// non-uniform). value: number or array. A key with third element true ('flat') gets a zero tangent: an eased
// extreme / hold. Third element may also be a number = explicit tangent scale (0 = flat, 1 = Catmull-Rom).
export function cyc(keys, ph) {
  const k = keys.slice().sort((a, b) => a[0] - b[0]);
  const n = k.length;
  if (n === 1) return k[0][1];
  ph = wrap01(ph);
  let i = n - 1;
  for (let j = 0; j < n; j++) if (k[j][0] <= ph) i = j;
  const P = (j) => {
    const q = ((j % n) + n) % n; const off = Math.floor(j / n);
    const f = k[q][2];
    return { t: k[q][0] + off, v: k[q][1], s: f === true ? 0 : typeof f === 'number' ? f : 1 };
  };
  let a = P(i), b = P(i + 1);
  let base = i;
  if (ph < k[0][0]) { a = P(-1); b = P(0); base = -1; }
  const pm = P(base - 1), pn = P(base + 2);
  const tan = (prev, cur, next) => vmap(vzip(next.v, prev.v, (x, y) => (x - y) / (next.t - prev.t)), (x) => x * cur.s);
  const m0 = tan(pm, a, b), m1 = tan(a, b, pn);
  const h = b.t - a.t;
  let s = (ph - a.t) / h;
  if (s < 0) s += 1 / h;
  const s2 = s * s, s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1, h10 = s3 - 2 * s2 + s, h01 = -2 * s3 + 3 * s2, h11 = s3 - s2;
  return vzip(vzip(a.v, b.v, (x, y) => h00 * x + h01 * y), vzip(m0, m1, (x, y) => h10 * h * x + h11 * h * y), (x, y) => x + y);
}

// Open cubic Hermite spline through points [{u, v, m?}] (u increasing; interior tangents Catmull-Rom unless m given)
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

const boneDef = new Map(rig.geo.bones.map((b) => [b.name, b]));
export function chainOf(bone) {
  const out = [];
  for (let b = boneDef.get(bone); b; b = b.parent ? boneDef.get(b.parent) : null) out.unshift(b.name);
  return out;
}
export const pivotOf = (bone) => boneDef.get(bone).pivot;
// World frame of a bone (entity file space): { R: world rotation, p: world pivot }
export function boneFrame(pose, bone) {
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
// world position of a point given in REST entity coordinates that rides on `bone`
export function pointOn(pose, bone, restPoint) {
  const f = boneFrame(pose, bone);
  return add3(f.p, mulv3(f.R, sub3(restPoint, boneDef.get(bone).pivot)));
}

export function worldRot(pose, chain) { return chainRotation(chain.map((b) => pose.getRot(b))); }
// Local rotation for `bone` (child of the last bone of parentChain) so that its WORLD rotation equals `world`.
export function localFor(pose, parentChain, world) {
  const P = worldRot(pose, parentChain);
  return eulerFromMatrix(mul3(transpose3(P), boneRotation(world)));
}

// ------------------------------------------------------------------------------------------- legs (shared IK)
export function setLeg(pose, side, ankle, footRot = [0, 0, 0], tag = 'breaker') {
  const r = solveLegWorld(rig, side, {
    ankle, footRotation: footRot, hipZ: 'auto',
    bodyPos: pose.getPos('body'), bodyRot: pose.getRot('body'),
  });
  if (!r.reachable || r.error > 0.05) throw new Error(`${tag}: ${side} ankle ${ankle.map((v) => v.toFixed(2))} unreachable (error ${r.error})`);
  pose.setRot(`leg_${side}_upper`, r.thigh);
  pose.setRot(`leg_${side}_lower`, r.knee);
  pose.setRot(`foot_${side}`, r.foot);
  return r;
}
// Ankle pivot for a foot pivoting about a ground contact point: contact = [x,0,z] on the ground; pivotRel = that
// point relative to the ankle in the level foot frame; footRot = world foot rotation.
export function ankleFromContact(contact, pivotRel, footRot) {
  return sub3(contact, mulv3(boneRotation(footRot), pivotRel));
}

// ------------------------------------------------------------------------------------------- arms (two-bone IK)
// Puts the wrist (hand pivot) of `side` at world position `wrist`, elbow toward world direction `pole`.
// Writes arm_<side>_upper (rotation) and arm_<side>_lower (elbow flexion, always <= 0).
export function setArm(pose, side, wrist, pole) {
  const up = `arm_${side}_upper`, lo = `arm_${side}_lower`, hd = `hand_${side}`;
  const a = Math.hypot(...sub3(boneDef.get(lo).pivot, boneDef.get(up).pivot));
  const b = Math.hypot(...sub3(boneDef.get(hd).pivot, boneDef.get(lo).pivot));
  pose.setRot(up, [0, 0, 0]);
  const parent = boneFrame(pose, boneDef.get(up).parent);
  const S = boneFrame(pose, up).p;
  const D = sub3(wrist, S);
  const dRaw = Math.hypot(...D);
  const u = norm3(D);
  const d = clamp(dRaw, Math.abs(a - b) + 1e-6, a + b - 1e-6);
  const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
  const alpha = Math.acos(cosA);
  const cosE = clamp((a * a + b * b - d * d) / (2 * a * b), -1, 1);
  const flex = Math.PI - Math.acos(cosE);
  const pp = norm3(sub3(pole, scale3(u, dot3(pole, u))));
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
  return { upper: local, elbowX: -flex / DEG, elbow: E, reach: dRaw, maxReach: a + b, shoulder: S };
}

// Hand rotation relative to the forearm: twist about the hand's own long axis, then wrist flexion/extension and
// side bend in the forearm frame: R = Rz(side) · Rx(flex) · Ry(twist) (Bedrock degrees), as Bedrock Z·Y·X euler.
export function handRot(flex, twist, sideBend = 0) {
  return eulerFromMatrix(mul3(mul3(boneRotation([0, 0, sideBend]), boneRotation([flex, 0, 0])), boneRotation([0, twist, 0])));
}

// ------------------------------------------------------------------------------------------- baking
const r2 = (v) => { const x = Math.round(v * 100) / 100; return Object.is(x, -0) ? 0 : x; };
const r4 = (v) => { const x = Math.round(v * 10000) / 10000; return Object.is(x, -0) ? 0 : x; };
export const fmtT = (t) => { const s = r4(t).toFixed(4).replace(/0+$/, ''); return s.endsWith('.') ? s + '0' : s; };

// Ramer-Douglas-Peucker on a vector time series (linear reconstruction within tol per axis); ends always kept.
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

// Joint limits (tools/joint_limits.json, same table check_anims.mjs enforces) for picking Euler representations.
const LIMITS = JSON.parse(fs.readFileSync(path.join(ADDON_ROOT, 'tools/joint_limits.json'), 'utf8')).joints;
const globRe = (g) => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
export function limitsOf(bone) {
  if (LIMITS[bone]) return LIMITS[bone];
  for (const [k, v] of Object.entries(LIMITS)) if (k.includes('*') && globRe(k).test(bone)) return v;
  return null;
}
// All Euler triples (Bedrock Z·Y·X) equal to rotation r: (x, y, z) and (x+180, 180-y, z+180), each axis +-360.
function eulerCandidates(r) {
  const out = [];
  for (const base of [r, [r[0] + 180, 180 - r[1], r[2] + 180]]) {
    for (const dx of [-360, 0, 360]) for (const dy of [-360, 0, 360]) for (const dz of [-360, 0, 360]) out.push([base[0] + dx, base[1] + dy, base[2] + dz]);
  }
  return out;
}
const overLimit = (v, lim) => (lim ? ['x', 'y', 'z'].reduce((s, a, i) => s + Math.max(0, lim[a][0] - v[i], v[i] - lim[a][1]), 0) : 0);
// Make a rotation track continuous and inside the joint limits where possible: for every sample pick the equivalent
// Euler triple with the smallest limit overshoot, then the one closest to the previous sample.
export function unwrapTrack(bone, vals) {
  const lim = limitsOf(bone);
  let prev = null;
  return vals.map((r) => {
    let best = null, bs = Infinity;
    for (const c of eulerCandidates(r)) {
      const d = prev ? Math.hypot(c[0] - prev[0], c[1] - prev[1], c[2] - prev[2]) : Math.hypot(...c);
      const sc = overLimit(c, lim) * 1000 + d;
      if (sc < bs) { bs = sc; best = c; }
    }
    prev = best;
    return best;
  });
}

// Sample poseFn(t) at n+1 evenly spaced times over [0, len] and build the Bedrock "bones" object. Every animated
// channel is written as LINEAR keys (one interpolation mode per channel), simplified within tolerance
// (tol.rotation deg / tol.position units, per-bone overrides in tol.bones[name]). t = 0 and t = len come from the
// same periodic functions, so loops are exactly seamless.
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
      let raw = samples.map((s) => (s.b[bone] ? s.b[bone][ch] : [0, 0, 0]));
      if (ch === 'rotation') raw = unwrapTrack(bone, raw);
      const vals = raw.map((v) => v.map(r2));
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

export function writeJSON(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}
