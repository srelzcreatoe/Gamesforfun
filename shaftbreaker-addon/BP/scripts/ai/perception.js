// @ts-check
import { dist, norm, sub, dot, getBlock, now } from "../core/util.js";

/** Eye height of the creature for its current pose. @param {number} pose */
export function eyeHeight(pose) {
  return pose === 2 ? 0.7 : pose === 1 ? 1.7 : 2.6;
}

/**
 * True if nothing solid blocks the straight line between two points.
 * @param {import("@minecraft/server").Dimension} dim
 * @param {{x:number,y:number,z:number}} from
 * @param {{x:number,y:number,z:number}} to
 */
export function clearLine(dim, from, to) {
  const d = dist(from, to);
  if (d < 0.5) return true;
  const dir = norm(sub(to, from));
  try {
    const hit = dim.getBlockFromRay(from, dir, { maxDistance: d, includeLiquidBlocks: false, includePassableBlocks: false });
    if (!hit) return true;
    const b = hit.block.location;
    const hp = { x: b.x + hit.faceLocation.x, y: b.y + hit.faceLocation.y, z: b.z + hit.faceLocation.z };
    return dist(from, hp) >= d - 0.7;
  } catch {
    return false;
  }
}

/**
 * How directly the player is looking at a point: dot of view direction with direction to point.
 * @param {import("@minecraft/server").Player} pl @param {{x:number,y:number,z:number}} pt
 */
export function lookDot(pl, pt) {
  try {
    const head = pl.getHeadLocation();
    return dot(pl.getViewDirection(), norm(sub(pt, head)));
  } catch {
    return -1;
  }
}

/** Points on the creature's body used for visibility tests. @param {import("@minecraft/server").Entity} e @param {number} pose */
export function bodyPoints(e, pose) {
  const l = e.location;
  const h = eyeHeight(pose);
  return [{ x: l.x, y: l.y + h, z: l.z }, { x: l.x, y: l.y + h * 0.55, z: l.z }];
}

/**
 * Can the player currently see the creature (in view cone + line of sight)?
 * Returns 0 (no), 1 (in view), 2 (looking right at it).
 * @param {import("@minecraft/server").Player} pl @param {import("@minecraft/server").Entity} e @param {number} pose
 * @param {boolean} concealed eyes hidden -> harder to notice in the dark
 */
export function playerSees(pl, e, pose, concealed = false) {
  try {
    if (pl.dimension.id !== e.dimension.id) return 0;
    const head = pl.getHeadLocation();
    const pts = bodyPoints(e, pose);
    const d = dist(head, pts[0]);
    if (d > 72) return 0;
    const ld = Math.max(lookDot(pl, pts[0]), lookDot(pl, pts[1]));
    if (ld < 0.55) return 0;
    if (concealed && d > 10) {
      let light = 0;
      try { light = e.dimension.getLightLevel({ x: Math.floor(e.location.x), y: Math.floor(e.location.y + 1), z: Math.floor(e.location.z) }); } catch { /* */ }
      if (light < 5) return 0;
    }
    if (!clearLine(pl.dimension, head, pts[0]) && !clearLine(pl.dimension, head, pts[1])) return 0;
    // angular size of the creature's head/upper body ~ 0.9 blocks
    const thresh = Math.cos(Math.max(Math.atan(1.1 / Math.max(1, d)), 0.07) + 0.06);
    return ld >= thresh ? 2 : 1;
  } catch {
    return 0;
  }
}

/**
 * Can the creature see the player?
 * @param {import("@minecraft/server").Entity} e @param {number} pose @param {import("@minecraft/server").Player} pl
 * @param {number} range @param {boolean} needFacing
 */
export function creatureSees(e, pose, pl, range, needFacing) {
  try {
    if (pl.dimension.id !== e.dimension.id) return false;
    const eye = { x: e.location.x, y: e.location.y + eyeHeight(pose), z: e.location.z };
    const head = pl.getHeadLocation();
    const d = dist(eye, head);
    if (d > range) return false;
    if (needFacing && d > 4) {
      const vd = e.getViewDirection();
      if (dot(norm({ x: vd.x, y: 0, z: vd.z }), norm({ x: head.x - eye.x, y: 0, z: head.z - eye.z })) < -0.2) return false;
    }
    return clearLine(e.dimension, eye, head) || clearLine(e.dimension, eye, pl.location);
  } catch {
    return false;
  }
}

/** Light carried/near the player increases how far it can be seen. @param {import("@minecraft/server").Player} pl */
export function playerLightBonus(pl) {
  try {
    const l = pl.location;
    const lvl = pl.dimension.getLightLevel({ x: Math.floor(l.x), y: Math.floor(l.y + 1), z: Math.floor(l.z) });
    return lvl >= 10 ? 20 : lvl >= 6 ? 10 : 0;
  } catch {
    return 0;
  }
}

// --------------------------------------------------------------------------------------------- hearing
/** @typedef {{x:number,y:number,z:number,r:number,t:number,kind:string,pid:string|undefined}} Noise */
/** @type {Noise[]} */
export const noises = [];
/**
 * Records a noise. r = audible radius in blocks.
 * @param {{x:number,y:number,z:number}} loc @param {number} r @param {string} kind @param {string} [pid]
 */
export function makeNoise(loc, r, kind, pid) {
  noises.push({ x: loc.x, y: loc.y, z: loc.z, r, t: now(), kind, pid });
  if (noises.length > 48) noises.splice(0, noises.length - 48);
}

/** ceiling clearance above a position: number of passable blocks above feet (max 4) */
export function headroom(dim, loc, passableFn) {
  let n = 0;
  for (let i = 0; i < 4; i++) {
    if (passableFn(getBlock(dim, { x: loc.x, y: loc.y + i, z: loc.z }))) n++;
    else break;
  }
  return n;
}
