// Small helpers. Everything that touches the game goes through safe() so a stale entity never throws out of the tick loop.
import { S } from './state.js';

export const v = (x, y, z) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const flatDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a) => { const l = len(a); return l > 1e-6 ? scale(a, 1 / l) : v(0, 0, 0); };
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const floorPos = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
export const center = (p) => ({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y), z: Math.floor(p.z) + 0.5 });
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(rand(lo, hi + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const nowTick = () => S.tick;

/** Bedrock yaw (degrees) that faces from `from` toward `to`. 0 = +Z (south), 90 = -X (west). */
export function yawTo(from, to) {
  return Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI;
}
export function yawToDir(yawDeg) {
  const r = yawDeg * Math.PI / 180;
  return { x: -Math.sin(r), y: 0, z: Math.cos(r) };
}
export function angleDiff(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  return d;
}
/** Turn `current` toward `target` by at most `maxDeg`. */
export function turnToward(current, target, maxDeg) {
  const d = angleDiff(current, target);
  return current + clamp(d, -maxDeg, maxDeg);
}
export function headingOf(dx, dz) { return Math.atan2(-dx, dz) * 180 / Math.PI; }

export function safe(fn, fallback) {
  try { return fn(); } catch (e) { if (S.debug) log('debug', 'safe: ' + String(e)); return fallback; }
}
export function isValid(e) {
  try { return !!e && e.isValid === true; } catch { return false; }
}

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
export function log(level, msg) {
  const lvl = LEVELS[level] ?? 2;
  if (lvl >= 3 && !S.debug) return;
  try { console.warn('[Grinshackle] ' + msg); } catch { /* ignore */ }
}
/** Throttled error log: one line per 200 ticks. */
export function logError(err) {
  if (S.tick - S.lastError > 200) { S.lastError = S.tick; log('error', String(err && err.stack ? err.stack : err)); }
}
export function jsonParse(text, fallback) {
  try { return typeof text === 'string' ? JSON.parse(text) : fallback; } catch { return fallback; }
}
export function bounded(arr, max) { while (arr.length > max) arr.shift(); return arr; }
