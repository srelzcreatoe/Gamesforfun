// @ts-check
import { system, world } from '@minecraft/server';

/** @typedef {{x:number,y:number,z:number}} Vec3 */

export const TPS = 20;
export const OVERWORLD = 'minecraft:overworld';

export const v3 = (x, y, z) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
export const lenXZ = (a) => Math.sqrt(a.x * a.x + a.z * a.z);
export const dist = (a, b) => len(sub(a, b));
export const distXZ = (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };
export const floor3 = (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) });
export const center = (b) => ({ x: b.x + 0.5, y: b.y, z: b.z + 0.5 });
export const key = (b) => `${b.x},${b.y},${b.z}`;
export const unkey = (k) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z }; };
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const DEG = 180 / Math.PI;

/** angle in degrees between a direction and the vector from->to */
export function angleTo(dir, from, to) {
  const d = norm(sub(to, from));
  return Math.acos(clamp(dot(norm(dir), d), -1, 1)) * DEG;
}

/** yaw (Minecraft convention, degrees) that faces from -> to */
export function yawTo(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  return Math.atan2(-dx, dz) * DEG;
}

export function dirFromYaw(yaw) {
  const r = yaw / DEG;
  return { x: -Math.sin(r), y: 0, z: Math.cos(r) };
}

// -------------------------------------------------------------- deterministic-enough RNG
export const rnd = Math.random;
export const rand = (a, b) => a + Math.random() * (b - a);
export const randi = (a, b) => Math.floor(rand(a, b + 1));
export const chance = (p) => Math.random() < p;
export function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
/** weighted pick over [item, weight] pairs; returns undefined when all weights are 0 */
export function weighted(pairs) {
  let total = 0;
  for (const [, w] of pairs) total += Math.max(0, w);
  if (total <= 0) return undefined;
  let r = Math.random() * total;
  for (const [it, w] of pairs) { r -= Math.max(0, w); if (r <= 0) return it; }
  return pairs[pairs.length - 1][0];
}

// -------------------------------------------------------------- time
export const now = () => system.currentTick;
export const sec = (s) => Math.round(s * TPS);
export const mins = (m) => Math.round(m * 60 * TPS);
/** absolute world time in ticks (persists across sessions) */
export function worldTicks() { try { return world.getAbsoluteTime(); } catch { return system.currentTick; } }

// -------------------------------------------------------------- safety helpers
export function valid(e) {
  try { return !!e && e.isValid; } catch { return false; }
}

/** run fn, swallow + report errors (never let one subsystem crash the pack) */
export function safe(label, fn, fallback = undefined) {
  try { return fn(); } catch (err) { reportError(label, err); return fallback; }
}

const errCounts = new Map();
export function reportError(label, err) {
  const c = (errCounts.get(label) || 0) + 1;
  errCounts.set(label, c);
  if (c <= 3 || c % 200 === 0) console.warn(`[Shaftbreaker] ${label}: ${err && err.stack ? err.stack : err} (x${c})`);
}

export function parseJSON(s, fallback) {
  if (typeof s !== 'string' || !s.length) return fallback;
  try { const v = JSON.parse(s); return v ?? fallback; } catch { return fallback; }
}

export function compassName(from, to) {
  const yaw = (yawTo(from, to) + 360) % 360;
  const names = ['south', 'south-west', 'west', 'north-west', 'north', 'north-east', 'east', 'south-east'];
  return names[Math.round(yaw / 45) % 8];
}

export function gameModeOf(player) {
  try { return String(player.getGameMode()).toLowerCase(); } catch { return 'survival'; }
}

export function isPlayableTarget(player) {
  const gm = gameModeOf(player);
  return gm === 'survival' || gm === 'adventure';
}

export function isOperator(player) {
  try {
    if (player.hasTag('sb_admin')) return true;
    const lvl = /** @type {any} */ (player).playerPermissionLevel;
    return lvl === 2 || String(lvl).toLowerCase() === 'operator';
  } catch { return false; }
}
