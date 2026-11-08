// lib_dormant.mjs: helpers for the "dormant" animation group generator (tools/anim/dormant.mjs).
//
// The generator describes every animation as an analytic POSE FUNCTION  pose(t) -> { bone: { rotation, position } }
// (base pose + layered, eased micro-events, legs solved with tools/lib/legik.mjs at every sample so planted feet
// never slide). bakeAnimation() samples that function on a fine grid and reduces each channel to a sparse set of
// catmullrom keyframes (greedy insertion on the 0.05 s = 1 game-tick grid until the interpolated curve -- evaluated
// exactly like tools/lib/anim.js / Bedrock -- matches the analytic curve within a tolerance). Output is fully
// deterministic: no randomness, fixed rounding.
//
// Conventions: SPEC.md section 2 (Bedrock FILE convention, degrees, -Z = front, -X = creature's right).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRig, solveLegWorld } from '../lib/legik.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ADDON_ROOT = path.resolve(HERE, '..', '..');
export const ANIM_DIR = path.join(ADDON_ROOT, 'Shaftbreaker_RP', 'animations');

// ------------------------------------------------------------------------------------------- math / easing
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); };
export const easeIn = (t) => { t = clamp(t, 0, 1); return t * t * t; };
export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const mirror3 = (v) => [v[0], -v[1], -v[2]]; // right-side rotation -> left-side rotation (X mirror)
export const mirrorPos = (v) => [-v[0], v[1], v[2]];

/**
 * Envelope of a one-shot "event" that loops with period `len`:
 *   0 before t0, rises to 1 over `attack` (sharp ease-out = a jolt), holds `hold`, falls back to 0 over `release`
 *   (slow ease-in-out = the creature settling). Wraps around the loop seam correctly.
 */
export function pulse(t, len, t0, attack, hold, release, rise = easeOut, fall = smoother) {
  let d = t - t0;
  if (len > 0) d = ((d % len) + len) % len;
  if (d < attack) return rise(d / attack);
  d -= attack;
  if (d < hold) return 1;
  d -= hold;
  if (d < release) return 1 - fall(d / release);
  return 0;
}

/**
 * A damped "shudder" after a jolt: tiny decaying oscillation (stone grinding to rest), 0 outside [t0, t0+dur].
 */
export function shudder(t, len, t0, dur, freq, amp) {
  let d = t - t0;
  if (len > 0) d = ((d % len) + len) % len;
  if (d < 0 || d > dur) return 0;
  const env = Math.sin(Math.PI * d / dur) * (1 - d / dur);
  return amp * env * Math.sin(2 * Math.PI * freq * d);
}

/**
 * Irregular breathing: a list of breaths [{start, inhale, hold, exhale, depth}] inside one loop of length len.
 * Returns 0 (empty) .. ~1 (full). Inhale is a quick smooth rise, exhale a long smoother fall: never a sine.
 */
export function breath(t, len, breaths) {
  let v = 0;
  for (const b of breaths) v += b.depth * pulse(t, len, b.start, b.inhale, b.hold || 0, b.exhale, smooth, smoother);
  return v;
}

// ------------------------------------------------------------------------------------------- legs (legik)
let RIG = null;
export function rig() { return RIG || (RIG = loadRig()); }

/**
 * Solve both legs so that each foot is FLAT on the ground at a fixed entity-space spot.
 *   pose: { root: {rotation, position}, body: {rotation, position} } (animation values)
 *   feet: { right: { ground: [x, z], yaw }, left: {...} }  yaw = world foot yaw (deg, +Y = toes toward creature's right)
 * Returns { leg_right_upper: {rotation}, leg_right_lower: {rotation}, foot_right: {rotation}, ... }.
 */
export function solveLegs(pose, feet) {
  const r = rig();
  const root = pose.root || {}, body = pose.body || {};
  const out = {};
  for (const side of ['right', 'left']) {
    const f = feet[side];
    const res = solveLegWorld(r, side, {
      ground: f.ground,
      rootPos: root.position || [0, 0, 0], rootRot: root.rotation || [0, 0, 0],
      bodyPos: body.position || [0, 0, 0], bodyRot: body.rotation || [0, 0, 0],
      footRotation: [f.pitch || 0, f.yaw || 0, f.roll || 0],
      hipZ: f.hipZ === undefined ? 'auto' : f.hipZ,
    });
    if (!res.reachable || res.error > 0.05) throw new Error(`leg ${side} unreachable (error ${res.error})`);
    out[`leg_${side}_upper`] = { rotation: res.thigh };
    out[`leg_${side}_lower`] = { rotation: res.knee };
    out[`foot_${side}`] = { rotation: res.foot };
  }
  return out;
}

// ------------------------------------------------------------------------------------------- baking
// Uniform catmull-rom exactly as tools/lib/anim.js (end keys duplicated).
function catmull(u, p0, p1, p2, p3) {
  const u2 = u * u, u3 = u2 * u;
  return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
}
function interp(keys, t, mode) {
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 1 && !(t >= keys[i].t && t < keys[i + 1].t)) i++;
  const a = keys[i], b = keys[i + 1];
  const u = (t - a.t) / (b.t - a.t);
  if (mode === 'catmullrom') {
    const p = keys[i - 1] ? keys[i - 1].v : a.v, n = keys[i + 2] ? keys[i + 2].v : b.v;
    return [0, 1, 2].map((j) => catmull(u, p[j], a.v[j], b.v[j], n[j]));
  }
  return [0, 1, 2].map((j) => a.v[j] + (b.v[j] - a.v[j]) * u);
}
const round = (v, d) => { const m = 10 ** d; const r = Math.round(v * m) / m; return Object.is(r, -0) ? 0 : r; };

/**
 * Reduce a sampled channel to sparse keys.
 *   samples: array of [x,y,z] at times i*fine (i = 0..N), N*fine = length.
 *   every:   candidate key spacing in samples (keys only on this grid).
 *   tol:     max abs error (per component) of the interpolated curve vs samples.
 * Returns null (all ~zero), {constant: v}, or {keys: [{t, v}]}.
 */
export function reduceChannel(samples, { fine, every, tol, mode = 'catmullrom', seeds = [], loop = true, digits = 3 }) {
  const N = samples.length - 1;
  const rv = (v) => v.map((x) => round(x, digits));
  const maxAbs = Math.max(...samples.map((v) => Math.max(...v.map(Math.abs))));
  const flat = samples.every((v) => v.every((x, j) => Math.abs(x - samples[0][j]) <= tol * 0.5));
  if (flat) return maxAbs <= tol * 0.5 ? null : { constant: rv(samples[0]) };
  const cand = (i) => Math.min(N, Math.round(i / every) * every);
  const set = new Set([0, N, ...seeds.map((s) => cand(Math.round(s / fine)))]);
  const build = () => {
    const idx = [...set].sort((a, b) => a - b);
    const keys = idx.map((i) => ({ i, t: i * fine, v: rv(samples[i]) }));
    if (loop) keys[keys.length - 1].v = keys[0].v.slice();
    return keys;
  };
  const skip = new Set(); // samples whose error the 1-tick key grid cannot reduce further (sharp jolts)
  for (let iter = 0; iter < 400; iter++) {
    const keys = build();
    let worst = -1, werr = tol;
    for (let i = 0; i <= N; i++) {
      if (skip.has(i)) continue;
      const p = interp(keys, i * fine, mode);
      const e = Math.max(...p.map((x, j) => Math.abs(x - samples[i][j])));
      if (e > werr) { werr = e; worst = i; }
    }
    if (worst < 0) return { keys };
    // add the nearest free grid key around the worst sample (only its immediate neighbours: if both are already
    // keys the residual is a sub-tick detail of a sharp event and is accepted)
    const lo = Math.floor(worst / every) * every, hi = Math.min(N, lo + every);
    const opts = [cand(worst), lo, hi, lo - every, hi + every].filter((c) => c >= 0 && c <= N && !set.has(c));
    if (opts.length) set.add(opts[0]);
    else skip.add(worst);
  }
  return { keys: build() };
}

function channelJSON(red, mode, tdigits = 2) {
  if (!red) return undefined;
  if (red.constant) return red.constant;
  const out = {};
  for (const k of red.keys) {
    let ts = String(round(k.t, tdigits));
    if (!ts.includes('.')) ts += '.0';
    out[ts] = mode === 'catmullrom' ? { post: k.v, lerp_mode: 'catmullrom' } : k.v;
  }
  return out;
}

/**
 * Bake a pose function into a Bedrock animation object.
 *   poseFn(t) -> { bone: { rotation?: [x,y,z], position?: [x,y,z] } }  (animation values, file convention)
 *   opts: { length, loop, fine = 1/60, every = 3 (0.05 s), rotTol = 0.03, posTol = 0.01, seeds: {bone: [times]},
 *           mode: {bone/channel: 'linear'} (default catmullrom), extra: {...merged into the animation object} }
 */
export function bakeAnimation(poseFn, opts) {
  const { length, loop = true, fine = 1 / 60, every = 3, rotTol = 0.03, posTol = 0.01 } = opts;
  const N = Math.round(length / fine);
  const frames = [];
  for (let i = 0; i <= N; i++) frames.push(poseFn(loop && i === N ? 0 : i * fine)); // exact seam
  const names = new Set();
  for (const f of frames) for (const b of Object.keys(f)) names.add(b);
  const bones = {};
  for (const b of opts.order ? opts.order.filter((n) => names.has(n)) : [...names]) {
    const entry = {};
    for (const ch of ['rotation', 'position']) {
      if (!frames.some((f) => f[b] && f[b][ch])) continue;
      const samples = frames.map((f) => (f[b] && f[b][ch]) || [0, 0, 0]);
      const mode = (opts.mode && (opts.mode[`${b}.${ch}`] || opts.mode[b])) || 'catmullrom';
      const red = reduceChannel(samples, {
        fine, every, mode, loop,
        tol: ch === 'rotation' ? rotTol : posTol,
        seeds: (opts.seeds && opts.seeds[b]) || [],
      });
      const j = channelJSON(red, mode);
      if (j !== undefined) entry[ch] = j;
    }
    if (Object.keys(entry).length) bones[b] = entry;
  }
  return { loop, animation_length: length, ...(opts.extra || {}), bones };
}

export function writeAnimationFile(file, animations) {
  const json = { format_version: '1.8.0', animations };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(json, null, '\t') + '\n');
  return file;
}

// count keys (report)
export function keyStats(anim) {
  let ch = 0, keys = 0;
  for (const b of Object.values(anim.bones || {})) for (const c of Object.values(b)) {
    ch++;
    keys += c && typeof c === 'object' && !Array.isArray(c) ? Object.keys(c).length : 0;
  }
  return { channels: ch, keys };
}
