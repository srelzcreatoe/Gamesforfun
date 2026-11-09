// @ts-check
import { system } from "@minecraft/server";

export const NS = "shaftbreaker";
export const DWELLER_ID = "shaftbreaker:shaftbreaker";
export const PHANTOM_ID = "shaftbreaker:phantom";
export const MOTH_ID = "shaftbreaker:grinning_moth";
export const WAYPOINT_ID = "shaftbreaker:waypoint";
export const LURE_ID = "shaftbreaker:rattlebone_projectile";
export const PREY_TAG = "shaftbreaker_prey";

/** @typedef {{x:number,y:number,z:number}} V3 */

export const now = () => system.currentTick;

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
export function lerp(a, b, t) { return a + (b - a) * t; }
export function rand() { return Math.random(); }
export function randRange(a, b) { return a + Math.random() * (b - a); }
export function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
export function chance(p) { return Math.random() < p; }
/** @template T @param {T[]} arr @returns {T} */
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/** weighted pick from {key: weight} @param {Record<string, number>} w */
export function weighted(w) {
  let total = 0;
  for (const k in w) total += Math.max(0, w[k]);
  if (total <= 0) return undefined;
  let r = Math.random() * total;
  for (const k in w) {
    r -= Math.max(0, w[k]);
    if (r <= 0) return k;
  }
  return Object.keys(w)[0];
}

/** Deterministic hash -> [0,1) */
export function hash(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    let v = Math.floor(n) | 0;
    for (let i = 0; i < 4; i++) {
      h ^= v & 0xff;
      h = Math.imul(h, 16777619) >>> 0;
      v >>= 8;
    }
  }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995) >>> 0; h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** @param {V3} a @param {V3} b */
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
/** @param {V3} a @param {V3} b */
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
/** @param {V3} a @param {number} s */
export const mul = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
/** @param {V3} a */
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
/** @param {V3} a @param {V3} b */
export const dist = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
/** @param {V3} a @param {V3} b */
export const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
/** @param {V3} a @param {V3} b */
export const distXZ = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
/** @param {V3} a @param {V3} b */
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
/** @param {V3} a */
export function norm(a) {
  const l = len(a);
  return l < 1e-6 ? { x: 0, y: 0, z: 0 } : { x: a.x / l, y: a.y / l, z: a.z / l };
}
/** @param {V3} a */
export const floorV = (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) });
/** block corner -> standing centre @param {V3} a */
export const center = (a) => ({ x: Math.floor(a.x) + 0.5, y: Math.floor(a.y), z: Math.floor(a.z) + 0.5 });
/** @param {V3} a */
export const key = (a) => `${Math.floor(a.x)},${Math.floor(a.y)},${Math.floor(a.z)}`;
/** @param {string} k @returns {V3} */
export function unkey(k) {
  const [x, y, z] = k.split(",").map(Number);
  return { x, y, z };
}
/** @param {V3} a */
export const flat = (a) => norm({ x: a.x, y: 0, z: a.z });
export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
/** angle between yaw direction vectors etc. */
export function yawOf(dir) { return (Math.atan2(-dir.x, dir.z) * 180) / Math.PI; }

/** Safe getBlock (undefined when out of world / unloaded) @param {import("@minecraft/server").Dimension} dim @param {V3} loc */
export function getBlock(dim, loc) {
  try {
    if (loc.y < -64 || loc.y > 319) return undefined;
    return dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
  } catch {
    return undefined;
  }
}

/** Runs fn and swallows/logs errors so one subsystem can never stop the others. */
export function guard(label, fn) {
  try {
    return fn();
  } catch (e) {
    if (DEBUG.on) console.warn(`[Shaftbreaker] ${label}: ${e}`);
    return undefined;
  }
}
export const DEBUG = { on: false };

/** Entity validity that never throws @param {any} e */
export function alive(e) {
  try {
    return !!e && e.isValid;
  } catch {
    return false;
  }
}

/** @param {import("@minecraft/server").Entity} e */
export function safeLoc(e) {
  try { return e.location; } catch { return undefined; }
}

export function fmt(v) { return `${Math.floor(v.x)} ${Math.floor(v.y)} ${Math.floor(v.z)}`; }
