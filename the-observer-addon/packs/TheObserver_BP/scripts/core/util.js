// @ts-check
import { world, system } from "@minecraft/server";
import { DIMENSIONS } from "./constants.js";

/** @typedef {{x:number,y:number,z:number}} Vec */

export const V = {
  /** @param {Vec} a @param {Vec} b */ add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  /** @param {Vec} a @param {Vec} b */ sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  /** @param {Vec} a @param {number} s */ scale: (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  /** @param {Vec} a @param {Vec} b */ dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  /** @param {Vec} a */ len: (a) => Math.hypot(a.x, a.y, a.z),
  /** @param {Vec} a @param {Vec} b */ dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  /** horizontal distance @param {Vec} a @param {Vec} b */ hdist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  /** @param {Vec} a */ norm: (a) => {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
  /** @param {Vec} a */ flat: (a) => {
    const l = Math.hypot(a.x, a.z) || 1;
    return { x: a.x / l, y: 0, z: a.z / l };
  },
  /** @param {Vec} a */ floor: (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) }),
  /** block centre at feet level @param {Vec} b */ center: (b) => ({ x: Math.floor(b.x) + 0.5, y: Math.floor(b.y), z: Math.floor(b.z) + 0.5 }),
  /** @param {Vec} a @param {Vec} b @param {number} t */ lerp: (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t }),
  /** Minecraft yaw (0 = +Z/south, 90 = -X/west) to a horizontal unit vector. @param {number} yawDeg */
  fromYaw: (yawDeg) => {
    const r = (yawDeg * Math.PI) / 180;
    return { x: -Math.sin(r), y: 0, z: Math.cos(r) };
  },
  /** Yaw that looks from a to b. @param {Vec} a @param {Vec} b */
  yawTo: (a, b) => (Math.atan2(-(b.x - a.x), b.z - a.z) * 180) / Math.PI,
  /** Pitch that looks from a to b (negative = up). @param {Vec} a @param {Vec} b */
  pitchTo: (a, b) => (-Math.atan2(b.y - a.y, Math.hypot(b.x - a.x, b.z - a.z)) * 180) / Math.PI,
  /** Angle in degrees between two vectors. @param {Vec} a @param {Vec} b */
  angle: (a, b) => {
    const d = V.dot(V.norm(a), V.norm(b));
    return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
  },
  /** @param {Vec} a */ str: (a) => `${a.x.toFixed(1)},${a.y.toFixed(1)},${a.z.toFixed(1)}`,
};

/** Signed difference between two yaw angles in [-180, 180). @param {number} a @param {number} b */
export function yawDelta(a, b) {
  let d = (a - b) % 360;
  if (d < -180) d += 360;
  if (d >= 180) d -= 360;
  return d;
}

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const chance = (p) => Math.random() < p;
/** @template T @param {T[]} arr @returns {T} */
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
/** @template T @param {T[]} arr @returns {T[]} */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/**
 * @template T
 * @param {T[]} items
 * @param {(t:T)=>number} weight
 * @returns {T|undefined}
 */
export function weightedPick(items, weight) {
  let total = 0;
  const ws = items.map((i) => {
    const w = Math.max(0, weight(i));
    total += w;
    return w;
  });
  if (total <= 0) return undefined;
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= ws[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Online players, never containing invalid entries. (Some player kinds, e.g. GameTest simulated
 * players seen from another pack, can surface as undefined in getAllPlayers().)
 * @returns {import("@minecraft/server").Player[]}
 */
export function allPlayers() {
  return world.getAllPlayers().filter((p) => p && p.isValid);
}

/** @param {string} id */
export const dimIndex = (id) => Math.max(0, DIMENSIONS.indexOf(id));
/** @param {number} i */
export const dimByIndex = (i) => world.getDimension(DIMENSIONS[i] ?? DIMENSIONS[0]);
/** @param {number} d @param {Vec} b */
export const blockKey = (d, b) => `${d},${Math.floor(b.x)},${Math.floor(b.y)},${Math.floor(b.z)}`;

/**
 * Run fn and swallow errors from unloaded chunks / invalid handles.
 * @template T @param {()=>T} fn @param {T} [fallback] @returns {T|undefined}
 */
export function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    if (DEBUG.on) DEBUG.log(`safe(): ${e}`);
    return fallback;
  }
}

/** Debug logging is opt-in (dev mode setting or /observer:debug). */
export const DEBUG = {
  on: false,
  /** tests: "always" / "never" override the lunge chance ("auto" = normal play) */
  lunge: "auto",
  /** low-volume lifecycle lines (encounter start/end); enabled in dev mode and by the test kit */
  trace: false,
  /** @param {string} msg */
  log(msg) {
    if (this.on) console.warn(`[Observer] ${msg}`);
  },
};

/**
 * Test/dev event channel: when tracing is on, publish a structured event as a script event
 * (observer_evt:<kind>) that the separate test pack can listen to. Silent in normal play.
 * @param {string} kind @param {Record<string, any>} data
 */
export function emit(kind, data) {
  if (!DEBUG.trace && !DEBUG.on) return;
  try {
    system.sendScriptEvent(`observer_evt:${kind}`, JSON.stringify(data));
  } catch {}
}

/** Lifecycle log line (encounter start/end, restorations). Silent unless dev tracing is on. */
export function trace(msg) {
  if (DEBUG.trace || DEBUG.on) console.warn(`[Observer] ${msg}`);
}

export class AbortError extends Error {
  /** @param {string} reason */
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
