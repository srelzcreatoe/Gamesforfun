export interface V3 { x: number; y: number; z: number }

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul = (a: V3, k: number): V3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3): number => Math.sqrt(dot(a, a));
export const dist = (a: V3, b: V3): number => len(sub(a, b));
export const distXZ = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a: V3): V3 => { const l = len(a); return l > 1e-9 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 }; };
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const floorV = (a: V3): V3 => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) });
export const D2R = Math.PI / 180;

/** Minecraft yaw (degrees): 0 faces +Z (south), 90 faces -X (west). */
export const forwardOf = (yaw: number): V3 => ({ x: -Math.sin(yaw * D2R), y: 0, z: Math.cos(yaw * D2R) });
/** The animal's left for a given yaw. */
export const leftOf = (yaw: number): V3 => ({ x: Math.cos(yaw * D2R), y: 0, z: Math.sin(yaw * D2R) });
export const yawTo = (from: V3, to: V3): number => Math.atan2(-(to.x - from.x), to.z - from.z) / D2R;
export const wrapDeg = (a: number): number => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
/** Turn `from` towards `to` by at most `maxStep` degrees. */
export const turnTowards = (from: number, to: number, maxStep: number): number => {
  const d = wrapDeg(to - from);
  return wrapDeg(from + clamp(d, -maxStep, maxStep));
};

/** Deterministic 32-bit mix for reproducible choices (no Math.random in story-critical paths). */
export function hash(...n: number[]): number {
  let h = 0x811c9dc5;
  for (const v of n) { h ^= (v | 0) + 0x9e3779b9 + (h << 6) + (h >>> 2); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
