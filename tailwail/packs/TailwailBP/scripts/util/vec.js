// Small immutable vector helpers (plain {x, y, z} objects).
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const hdist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : { x: 0, y: 0, z: 0 };
};
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
export const floor = (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) });
export const center = (a) => ({ x: Math.floor(a.x) + 0.5, y: Math.floor(a.y), z: Math.floor(a.z) + 0.5 });
export const key = (a) => `${Math.floor(a.x)},${Math.floor(a.y)},${Math.floor(a.z)}`;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// Minecraft yaw: 0 = +Z (south), 90 = -X (west).  Returns degrees in (-180, 180].
export function yawTo(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  return (Math.atan2(-dx, dz) * 180) / Math.PI;
}
// Minecraft pitch: positive looks down.
export function pitchTo(from, to) {
  const dy = to.y - from.y;
  const h = Math.hypot(to.x - from.x, to.z - from.z);
  return (-Math.atan2(dy, h) * 180) / Math.PI;
}
export function wrapDeg(a) {
  let r = ((a + 180) % 360 + 360) % 360 - 180;
  if (r === -180) r = 180;
  return r;
}
export function dirFromYaw(yawDeg) {
  const r = (yawDeg * Math.PI) / 180;
  return { x: -Math.sin(r), y: 0, z: Math.cos(r) };
}
