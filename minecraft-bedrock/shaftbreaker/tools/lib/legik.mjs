#!/usr/bin/env node
// legik.mjs: planar two-bone leg IK for the Shaftbreaker rig (Minecraft Bedrock).
// Helps animators place feet: it turns an ankle position into leg_*_upper / leg_*_lower / foot_* rotations.
//
// Conventions follow SPEC.md §2 exactly (Bedrock FILE space, degrees):
//   +Y up, ground y = 0, the creature faces -Z, its RIGHT side is -X.
//   +X rotation pitches a bone forward: for a hanging leg that swings the lower end BACKWARD.
//   Hip flexion (thigh forward) = negative X; knee flexion = positive X (always >= 0 here).
//   Right leg +Z = abduction (outward, toward -X); left leg -Z = abduction (toward +X).
//   A bone's rotation matrix acting on file-space vectors is R = Rz(-z) · Ry(y) · Rx(-x)
//   (standard right-handed matrices). This is what tools/lib/model.js does after its X mirror.
//
// API (all angles in degrees, all positions in geometry file units):
//   loadRig(geo?)  geo = path to a .geo.json | parsed geo JSON | a geometry object.
//                  Default: Shaftbreaker_RP/models/entity/shaftbreaker.geo.json.
//     -> rig { legs: { right, left }, bodyPivot, rootPivot }
//        legs.<side> = { hip, knee, ankle, thighLen, shinLen, maxReach, soleY, ankleHeight, rest: {thigh, shin, foot},
//                        bones: {upper, lower, foot} }
//        ankleHeight = ankle pivot height above the sole when the foot is level (6 for the SPEC rig).
//
//   solveLeg(rig, side, opts) -> result
//     opts.target          [x, y, z] desired ANKLE PIVOT position RELATIVE TO THE HIP PIVOT, in entity file axes.
//     opts.pitch           total X rotation (deg) of the hip's parent frame (root.x + body.x); + = hunched forward.
//                          Use opts.parentRotation (a 3x3 matrix from boneRotation / chainRotation) for yaw/roll too.
//     opts.hipZ            'auto' (default: abduct so the leg plane passes through the target), a number, or 0.
//     opts.footRotation    desired WORLD rotation of the foot [x, y, z] (default [0,0,0] = sole level).
//     opts.footPitch       shorthand for footRotation [footPitch, 0, 0] (toes down = +).
//     result = { side, thigh: [x, 0, z], knee: [x, 0, 0], foot: [x, y, z],   <- ANIMATION values (total - rest)
//                thighX, thighZ, kneeX, reach, maxReach, minReach, reachable, ankle (achieved, rel hip), error }
//     The knee always bends the anatomically correct way (kneeX >= 0). If the target is out of reach the leg
//     points straight at it (reachable = false, error = remaining distance).
//
//   solveLegWorld(rig, side, opts) -> result (+ result.hip = hip pivot in entity space)
//     opts.ankle           desired ankle pivot in ENTITY file space (e.g. [-5, 6, -12] = right foot flat, 12 forward).
//     opts.ground          [x, z]: put the foot flat on the ground there (ankle = [x, ankleHeight, z]).
//     opts.bodyPos / opts.rootPos   animation position offsets of `body` / `root` ([0, -6, 0] = hips lowered 6).
//     opts.bodyPitch / opts.rootPitch  X rotations, or opts.bodyRot / opts.rootRot full [x, y, z].
//     plus hipZ / footRotation / footPitch as in solveLeg.
//
//   hipWorld(rig, side, opts)          hip pivot in entity space for the given root/body offsets & rotations.
//   fkLeg(rig, side, {thigh, knee, pitch|parentRotation})  ankle position relative to the hip (verification).
//   boneRotation([x, y, z]) / eulerFromMatrix(R) / chainRotation([[x,y,z], ...])   matrix helpers.
//
// CLI (run from minecraft-bedrock/shaftbreaker):
//   node tools/lib/legik.mjs --side right --rel 0,-35,-16.5 [--pitch 0]
//   node tools/lib/legik.mjs --side left  --ankle 5,6,12 --body-pos 0,-6,0 [--body-pitch 30] [--root-pos 0,0,0]
//   node tools/lib/legik.mjs --side right --ground -6,-14 --body-pos 0,-8,2 --body-pitch 25 --foot-pitch 0
//   options: --hip-z auto|<deg>|0   --foot-pitch <deg>   --geo <path>   --json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEG = Math.PI / 180;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADDON_ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_GEO = path.join(ADDON_ROOT, 'Shaftbreaker_RP/models/entity/shaftbreaker.geo.json');

// ---------------------------------------------------------------- 3x3 matrix helpers (row-major arrays of 9)
const I3 = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function mul3(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
  return C;
}
export function mulv3(A, v) {
  return [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
}
export function transpose3(A) { return [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]; }
const Rx = (a) => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const Ry = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const Rz = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

// Bedrock bone rotation [x, y, z] (deg, file convention) -> matrix acting on file-space vectors.
export function boneRotation(r = [0, 0, 0]) {
  return mul3(mul3(Rz(-(r[2] || 0) * DEG), Ry((r[1] || 0) * DEG)), Rx(-(r[0] || 0) * DEG));
}
// Product of several bone rotations, outermost (closest to root) first.
export function chainRotation(list) { return list.reduce((M, r) => mul3(M, boneRotation(r)), I3()); }
// Inverse of boneRotation: matrix -> Bedrock [x, y, z] degrees.
export function eulerFromMatrix(R) {
  // R = Rz(g) Ry(b) Rx(a)  =>  b = asin(-R20), a = atan2(R21, R22), g = atan2(R10, R00)
  const b = Math.asin(Math.max(-1, Math.min(1, -R[6])));
  let a, g;
  if (Math.abs(R[6]) < 0.999999) { a = Math.atan2(R[7], R[8]); g = Math.atan2(R[3], R[0]); }
  else { a = Math.atan2(-R[5], R[4]); g = 0; } // gimbal lock
  return [-a / DEG, b / DEG, -g / DEG].map(clean);
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);
const wrap = (d) => { let x = ((d + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return x; };
function clean(v) { const r = Math.round(v * 1e6) / 1e6; return Object.is(r, -0) ? 0 : r; }

// ---------------------------------------------------------------- rig
function geometryOf(src) {
  if (src === undefined || src === null) src = DEFAULT_GEO;
  if (typeof src === 'string') src = JSON.parse(fs.readFileSync(src, 'utf8'));
  if (src['minecraft:geometry']) return src['minecraft:geometry'][0];
  if (src.bones) return src;
  throw new Error('legik: not a geometry');
}

export function loadRig(src) {
  const geo = geometryOf(src);
  const bones = new Map(geo.bones.map((b) => [b.name.toLowerCase(), b]));
  const need = (n) => { const b = bones.get(n); if (!b) throw new Error(`legik: geometry has no bone "${n}"`); return b; };
  const legs = {};
  for (const side of ['right', 'left']) {
    const up = need(`leg_${side}_upper`), lo = need(`leg_${side}_lower`), ft = need(`foot_${side}`);
    const hip = up.pivot, knee = lo.pivot, ankle = ft.pivot;
    // sole: the foot locator if present, else the lowest cube bottom of the foot
    const loc = ft.locators && ft.locators[`foot_${side}`];
    let soleY = loc ? (Array.isArray(loc) ? loc[1] : loc.offset[1]) : Infinity;
    if (!Number.isFinite(soleY)) for (const c of ft.cubes || []) soleY = Math.min(soleY, c.origin[1] - (c.inflate || 0));
    if (!Number.isFinite(soleY)) soleY = 0;
    const thighLen = len(sub(knee, hip)), shinLen = len(sub(ankle, knee));
    legs[side] = {
      side, hip, knee, ankle, soleY, thighLen, shinLen,
      maxReach: thighLen + shinLen,
      minReach: Math.abs(thighLen - shinLen),
      ankleHeight: ankle[1] - soleY,
      rest: { thigh: up.rotation || [0, 0, 0], shin: lo.rotation || [0, 0, 0], foot: ft.rotation || [0, 0, 0] },
      bones: { upper: up.name, lower: lo.name, foot: ft.name },
      parent: up.parent,
    };
  }
  const body = bones.get('body');
  const root = bones.get('root');
  return { legs, bodyPivot: body ? body.pivot : [0, 0, 0], rootPivot: root ? root.pivot : [0, 0, 0], geo };
}

// ---------------------------------------------------------------- forward kinematics
// ankle relative to hip (entity axes) for TOTAL rotations thigh=[x,y,z], knee=[x,y,z]
export function fkLeg(rig, side, { thigh = [0, 0, 0], knee = [0, 0, 0], pitch = 0, parentRotation } = {}) {
  const L = rig.legs[side];
  const P = parentRotation || boneRotation([pitch, 0, 0]);
  const a = sub(L.knee, L.hip), b = sub(L.ankle, L.knee);
  const Rt = boneRotation(thigh), Rk = boneRotation(knee);
  return mulv3(P, mulv3(Rt, add(a, mulv3(Rk, b))));
}

// ---------------------------------------------------------------- inverse kinematics
export function solveLeg(rig, side, opts = {}) {
  const L = rig.legs[side];
  if (!L) throw new Error(`legik: unknown side "${side}" (use right|left)`);
  const P = opts.parentRotation || boneRotation([opts.pitch || 0, 0, 0]);
  const t = mulv3(transpose3(P), opts.target); // target in the hip's parent frame
  const a = sub(L.knee, L.hip), b = sub(L.ankle, L.knee);
  const x0 = a[0] + b[0];
  // hip Z (roll of the leg plane about the forward axis, applied after X in Bedrock's Z·Y·X order)
  let zDeg = 0;
  const hz = opts.hipZ === undefined ? 'auto' : opts.hipZ;
  if (hz === 'auto') {
    const Rr = Math.hypot(t[0], t[1]);
    if (Rr > 1e-9 && Math.abs(x0) <= Rr) {
      const d = Math.atan2(t[1], t[0]);
      const ac = Math.acos(x0 / Rr);
      const c1 = wrap((ac - d) / DEG), c2 = wrap((-ac - d) / DEG);
      zDeg = Math.abs(c1) <= Math.abs(c2) ? c1 : c2;
    }
  } else if (typeof hz === 'number') zDeg = hz;
  // bring the target into the leg's sagittal plane: w = Rz(+z)·t  (inverse of the bone's Rz(-z))
  const w = mulv3(Rz(zDeg * DEG), t);
  // planar solve in (y, z): a Bedrock X rotation theta multiplies (y + i z) by e^{-i theta}
  const A = [a[1], a[2]], B = [b[1], b[2]], W = [w[1], w[2]];
  const nA = Math.hypot(...A), nB = Math.hypot(...B);
  const reach = Math.hypot(...W);
  const argA = Math.atan2(A[1], A[0]), argB = Math.atan2(B[1], B[0]);
  let c = (reach * reach - nA * nA - nB * nB) / (2 * nA * nB);
  const reachable = c >= -1 - 1e-9 && c <= 1 + 1e-9;
  c = Math.max(-1, Math.min(1, c));
  const kneeRad = Math.acos(c) - (argA - argB); // + branch: shin folds BACK (knee forward)
  const Kc = [A[0] + nB * Math.cos(argB - kneeRad), A[1] + nB * Math.sin(argB - kneeRad)];
  const thighRad = Math.atan2(Kc[1], Kc[0]) - Math.atan2(W[1], W[0]);
  const thighTot = [wrap(thighRad / DEG), 0, zDeg];
  const kneeTot = [wrap(kneeRad / DEG), 0, 0];
  // foot: world rotation wanted -> local
  const footWorld = opts.footRotation || [opts.footPitch || 0, 0, 0];
  const chain = mul3(mul3(P, boneRotation(thighTot)), boneRotation(kneeTot));
  const footTot = eulerFromMatrix(mul3(transpose3(chain), boneRotation(footWorld)));
  // achieved ankle
  const ach = fkLeg(rig, side, { thigh: thighTot, knee: kneeTot, parentRotation: P });
  const r = L.rest;
  const thigh = [clean(thighTot[0] - r.thigh[0]), clean(-(r.thigh[1] || 0)), clean(thighTot[2] - r.thigh[2])];
  const knee = [clean(kneeTot[0] - r.shin[0]), clean(-(r.shin[1] || 0)), clean(-(r.shin[2] || 0))];
  const foot = [clean(footTot[0] - r.foot[0]), clean(footTot[1] - r.foot[1]), clean(footTot[2] - r.foot[2])];
  return {
    side, thigh, knee, foot,
    thighX: thigh[0], thighZ: thigh[2], kneeX: knee[0],
    reach: clean(reach), maxReach: clean(nA + nB), minReach: clean(Math.abs(nA - nB)), reachable,
    ankle: ach.map(clean), error: clean(len(sub(ach, opts.target))),
  };
}

// hip pivot in entity space after root/body animation offsets & rotations
function frames(rig, opts) {
  const Rroot = boneRotation(opts.rootRot || [opts.rootPitch || 0, 0, 0]);
  const Rbody = boneRotation(opts.bodyRot || [opts.bodyPitch || 0, 0, 0]);
  const rootPos = opts.rootPos || [0, 0, 0], bodyPos = opts.bodyPos || [0, 0, 0];
  const rp = rig.rootPivot, bp = rig.bodyPivot;
  // point p (rest entity coords) on body -> world
  const bodyToWorld = (p) => {
    const inRoot = add(add(sub(bp, rp), bodyPos), mulv3(Rbody, sub(p, bp)));
    return add(add(rp, rootPos), mulv3(Rroot, inRoot));
  };
  return { parentRotation: mul3(Rroot, Rbody), bodyToWorld };
}
export function hipWorld(rig, side, opts = {}) { return frames(rig, opts).bodyToWorld(rig.legs[side].hip).map(clean); }

export function solveLegWorld(rig, side, opts = {}) {
  const L = rig.legs[side];
  if (!L) throw new Error(`legik: unknown side "${side}" (use right|left)`);
  const f = frames(rig, opts);
  const hip = f.bodyToWorld(L.hip);
  let ankle = opts.ankle;
  if (!ankle && opts.ground) ankle = [opts.ground[0], (opts.groundY || 0) + L.ankleHeight, opts.ground[1]];
  if (!ankle) throw new Error('legik: give ankle [x,y,z] or ground [x,z]');
  const res = solveLeg(rig, side, { ...opts, target: sub(ankle, hip), parentRotation: f.parentRotation });
  return { ...res, hip: hip.map(clean), ankleTarget: ankle, ankleWorld: add(hip, res.ankle).map(clean) };
}

// ---------------------------------------------------------------- CLI
function cli(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const v = argv[i + 1] !== undefined && !/^--[a-z]/.test(argv[i + 1]) ? argv[++i] : true;
    a[k] = v;
  }
  const vec = (s) => (s === undefined ? undefined : String(s).split(',').map(Number));
  const num = (s) => (s === undefined ? undefined : Number(s));
  if (a.help || (!a.rel && !a.ankle && !a.ground)) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
    process.exit(a.help ? 0 : 2);
  }
  const rig = loadRig(a.geo ? path.resolve(process.cwd(), a.geo) : undefined);
  const sides = a.side === 'both' ? ['right', 'left'] : [a.side || 'right'];
  const hipZ = a['hip-z'] === undefined || a['hip-z'] === 'auto' ? 'auto' : Number(a['hip-z']);
  const common = { hipZ, footPitch: num(a['foot-pitch']) || 0 };
  const out = [];
  for (const side of sides) {
    let r;
    if (a.rel) r = solveLeg(rig, side, { ...common, target: vec(a.rel), pitch: num(a.pitch) || 0 });
    else {
      const opts = { ...common, bodyPos: vec(a['body-pos']), rootPos: vec(a['root-pos']), bodyPitch: num(a['body-pitch']), rootPitch: num(a['root-pitch']), bodyRot: vec(a['body-rot']), rootRot: vec(a['root-rot']) };
      let ankle = vec(a.ankle);
      if (ankle && sides.length > 1) ankle = [side === 'left' ? Math.abs(ankle[0]) : -Math.abs(ankle[0]), ankle[1], ankle[2]];
      let ground = vec(a.ground);
      if (ground && sides.length > 1) ground = [side === 'left' ? Math.abs(ground[0]) : -Math.abs(ground[0]), ground[1]];
      r = solveLegWorld(rig, side, { ...opts, ankle, ground });
    }
    out.push(r);
  }
  if (a.json) { console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2)); return; }
  const f = (v) => '[' + v.map((x) => (+x).toFixed(2)).join(', ') + ']';
  for (const r of out) {
    const L = rig.legs[r.side];
    console.log(`leg ${r.side}: ${r.hip ? `hip ${f(r.hip)}  ankle target ${f(r.ankleTarget)}  ` : ''}reach ${r.reach.toFixed(2)} (min ${r.minReach.toFixed(2)}, max ${r.maxReach.toFixed(2)})${r.reachable ? '' : '  ** OUT OF REACH **'}`);
    console.log(`  ${L.bones.upper.padEnd(16)} "rotation": ${JSON.stringify(r.thigh)}`);
    console.log(`  ${L.bones.lower.padEnd(16)} "rotation": ${JSON.stringify(r.knee)}`);
    console.log(`  ${L.bones.foot.padEnd(16)} "rotation": ${JSON.stringify(r.foot)}   (foot world rotation ${a['foot-pitch'] ? `pitch ${a['foot-pitch']}` : 'level'})`);
    console.log(`  achieved ankle${r.hip ? ' (entity space) ' + f(r.ankleWorld) : ' rel hip ' + f(r.ankle)}  error ${r.error.toFixed(3)}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { cli(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(2); }
}
