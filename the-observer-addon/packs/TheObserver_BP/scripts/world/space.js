// @ts-check
// Where the Observer can stand. Every placement goes through standAt(), which
// rejects unloaded chunks, solid/dangerous blocks, insufficient headroom, warded
// areas and (optionally) liquid surfaces. findSpot() samples candidates around a
// player and scores them by concealment, cover and distance.
import { DANGER } from "../core/constants.js";
import { V, safe, dimIndex, rand, yawDelta } from "../core/util.js";
import { W } from "../core/state.js";
import { visibility, lineOfSight, bodyPoints } from "./sight.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {{x:number,y:number,z:number}} Vec */

export const WARD_RADIUS = 12;
const STOOP_MIN = 3;    // collision box is 2.9 tall
const UPRIGHT_MIN = 5;  // model is ~4.02 blocks tall; 5 air blocks avoids clipping

/** @param {number} d @param {Vec} loc */
export function isWarded(d, loc) {
  for (const w of W.wards) {
    if (w[0] !== d) continue;
    const dx = w[1] + 0.5 - loc.x, dy = w[2] + 0.5 - loc.y, dz = w[3] + 0.5 - loc.z;
    if (dx * dx + dy * dy + dz * dz <= WARD_RADIUS * WARD_RADIUS) return true;
  }
  return false;
}

/** @param {Dimension} dim @param {Vec} loc */
export function loaded(dim, loc) {
  return !!safe(() => dim.isChunkLoaded(loc), false);
}

/**
 * Find a standing position in column (x,z) by scanning down from yTop.
 * @param {Dimension} dim @param {number} x @param {number} z @param {number} yTop @param {number} maxDown
 * @param {{liquidSurface?:boolean}} [o]
 * @returns {{loc:Vec, clearance:number, ground:string, liquid:boolean, stoop:boolean}|undefined}
 */
export function standAt(dim, x, z, yTop, maxDown, o = {}) {
  const bx = Math.floor(x), bz = Math.floor(z);
  const probe = { x: bx + 0.5, y: yTop, z: bz + 0.5 };
  if (!loaded(dim, probe)) return undefined;
  const range = dim.heightRange;
  if (yTop >= range.max) probe.y = range.max - 1;
  // must start in open space, otherwise we'd find the surface of the rock we're inside
  const startBlock = safe(() => dim.getBlock(probe));
  if (!startBlock || !(startBlock.isAir || startBlock.isLiquid || isReplaceable(startBlock))) return undefined;
  const ground = safe(() => dim.getBlockBelow(probe, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: maxDown }));
  if (!ground) return undefined;
  const g = ground.location;
  if (g.y + 1 >= range.max - 5 || g.y <= range.min + 1) return undefined;
  const liquid = ground.isLiquid;
  if (liquid && !o.liquidSurface) return undefined;
  if (DANGER.has(ground.typeId) || /leaves/.test(ground.typeId)) return undefined;
  const feet = { x: bx + 0.5, y: g.y + 1, z: bz + 0.5 };
  const feetBlock = safe(() => dim.getBlock(feet));
  if (!feetBlock || DANGER.has(feetBlock.typeId) || feetBlock.isLiquid) return undefined;
  // getBlockAbove includes the block containing the start point, so start inside the (open) feet block
  const ceil = safe(() => dim.getBlockAbove({ x: feet.x, y: feet.y + 0.1, z: feet.z }, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: UPRIGHT_MIN + 1 }));
  const clearance = ceil ? ceil.location.y - feet.y : UPRIGHT_MIN + 1;
  if (clearance < STOOP_MIN) return undefined;
  // keep clear of fire/lava immediately around the feet
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const n = safe(() => dim.getBlock({ x: feet.x + dx, y: feet.y, z: feet.z + dz }));
    if (n && (n.typeId === "minecraft:lava" || n.typeId === "minecraft:fire")) return undefined;
  }
  if (isWarded(dimIndex(dim.id), feet)) return undefined;
  return { loc: feet, clearance, ground: ground.typeId, liquid, stoop: clearance < UPRIGHT_MIN };
}

/**
 * standAt() for a point at roughly height y: tries head height, then a little higher (for slopes),
 * never starting inside rock. @returns {ReturnType<typeof standAt>}
 */
export function standNear(dim, x, z, y, o = {}) {
  for (const dy of [1.5, 0.5, 4.5, 8.5]) {
    const st = standAt(dim, x, z, y + dy, 12, o);
    if (st) return st;
  }
  return undefined;
}

/** Is there a solid block beside loc (perpendicular to the line of sight) that can hide/peek from? */
export function coverSide(dim, feet, eye) {
  const toEye = V.flat(V.sub(eye, feet));
  const side = { x: -toEye.z, y: 0, z: toEye.x };
  const solidAt = (dir) => {
    for (const h of [1, 2]) {
      const b = safe(() => dim.getBlock({ x: feet.x + dir.x * 0.9, y: feet.y + h, z: feet.z + dir.z * 0.9 }));
      if (b && !b.isAir && !b.isLiquid && !/grass|flower|fern|bush|vine/.test(b.typeId)) return true;
    }
    return false;
  };
  const left = solidAt(side), right = solidAt(V.scale(side, -1));
  if (left && !right) return { side: -1, has: true };
  if (right && !left) return { side: 1, has: true };
  return { side: 1, has: left && right };
}

/**
 * @typedef {Object} SpotSpec
 * @property {number} minDist
 * @property {number} maxDist
 * @property {number[]} [bearings]  degrees relative to the player's view yaw (0 = straight ahead, 180 = behind)
 * @property {number} [spread]      +/- degrees around each bearing
 * @property {"hidden"|"partial"|"visible"|"any"} [concealment]  how visible from the player's current view
 * @property {boolean} [needLOS]    the Observer's head must have line of sight to the player's head (it watches)
 * @property {boolean} [watchLOSIgnoringView] if true, LOS required but view cone ignored (visible once the player turns)
 * @property {Vec} [losTarget]      require line of sight from its head to this point instead of the player's eye
 * @property {"near"|"surface"|"below"} [yMode]
 * @property {boolean} [liquidSurface]
 * @property {boolean} [preferLiquid]   strongly prefer standing on a liquid surface (water encounters)
 * @property {Player[]} [hideFrom]  other players that must not currently see it
 * @property {Player[]} [showTo]    players that must currently be able to see it
 * @property {number} [samples]
 * @property {Vec} [origin]         centre of the search (defaults to player)
 * @property {number} [baseYaw]     yaw used for bearings (defaults to player view yaw)
 */

/**
 * Search for an Observer position around a player.
 * @param {Player} p @param {SpotSpec} spec
 * @returns {{loc:Vec, stoop:boolean, vis:number, side:number, score:number, liquid:boolean}|undefined}
 */
export function findSpot(p, spec) {
  const dim = p.dimension;
  const origin = spec.origin ?? p.location;
  const eye = p.getHeadLocation();
  const baseYaw = spec.baseYaw ?? p.getRotation().y;
  const samples = spec.samples ?? 22;
  const bearings = spec.bearings ?? [0, 45, 90, 135, 180, 225, 270, 315];
  const spread = spec.spread ?? 25;
  const want = spec.concealment ?? "any";
  let best;
  for (let i = 0; i < samples; i++) {
    const b = bearings[i % bearings.length] + rand(-spread, spread);
    const d = rand(spec.minDist, spec.maxDist);
    const dir = V.fromYaw(baseYaw + b);
    const cx = origin.x + dir.x * d, cz = origin.z + dir.z * d;
    let yTop, down;
    if (spec.yMode === "surface") {
      const top = safe(() => dim.getTopmostBlock({ x: cx, z: cz }));
      if (!top) continue;
      yTop = top.location.y + 2;
      down = 6;
    } else if (spec.yMode === "below") {
      yTop = origin.y - 1;
      down = 80;
    } else {
      yTop = undefined;
      down = 14;
    }
    let st;
    if (yTop !== undefined) st = standAt(dim, cx, cz, yTop, down, { liquidSurface: spec.liquidSurface });
    else {
      // same level as the origin: start at head height first (tunnels, rooms), then a little higher (slopes)
      for (const dy of [1.5, 4.5, 8.5]) {
        st = standAt(dim, cx, cz, origin.y + dy, down, { liquidSurface: spec.liquidSurface });
        if (st) break;
      }
    }
    if (!st) continue;
    const head = bodyPoints(st.loc, st.stoop)[2];
    let score = 0;
    const vis = visibility(p, st.loc, { stooped: st.stoop });
    if (want === "hidden" && vis.points > 0) continue;
    if (want === "visible" && vis.points === 0) continue;
    if (want === "partial") {
      if (vis.points === 0 || vis.points === 3) score -= 4;
      else score += 6;
    }
    if (spec.needLOS || spec.watchLOSIgnoringView || spec.losTarget) {
      const los = lineOfSight(dim, head, spec.losTarget ?? eye);
      if (!los.clear) continue;
    }
    if (spec.hideFrom && spec.hideFrom.some((o) => o.id !== p.id && visibility(o, st.loc, { stooped: st.stoop, fov: 70 }).points > 0)) continue;
    if (spec.showTo && !spec.showTo.every((o) => visibility(o, st.loc, { stooped: st.stoop, fov: 55 }).points > 0)) continue;
    const cover = coverSide(dim, st.loc, eye);
    if (cover.has) score += 3;
    const light = safe(() => dim.getLightLevel({ x: st.loc.x, y: st.loc.y + 1, z: st.loc.z }), 8) ?? 8;
    score += (15 - light) * 0.25; // prefers darker spots
    if (spec.preferLiquid && st.liquid) score += 8;
    if (Math.abs(st.loc.y - origin.y) > 8 && spec.yMode !== "below") score -= 2;
    score += rand(0, 1.5);
    if (!best || score > best.score) best = { loc: st.loc, stoop: st.stoop, vis: vis.points, side: cover.side, score, liquid: st.liquid };
  }
  return best;
}

/** Relative bearing (deg) of a location from the player's view, 0 = ahead, 180 = behind. */
export function relBearing(p, loc) {
  return yawDelta(V.yawTo(p.location, loc), p.getRotation().y);
}

const REPLACEABLE_RX = /^minecraft:(air|short_grass|tall_grass|fern|large_fern|snow_layer|deadbush|short_dry_grass|tall_dry_grass|leaf_litter)$/;

/** @param {import("@minecraft/server").Block|undefined} b */
export function isReplaceable(b) {
  return !!b && (b.isAir || REPLACEABLE_RX.test(b.typeId));
}

/**
 * Corridor probe: find the narrowest enclosed cross-section 3-7 blocks behind
 * the player (opposite to travelDir). Only contiguous open cells bounded by
 * walls and a roof qualify, so a seal never fills open terrain.
 * @param {Player} p @param {Vec} travelDir horizontal unit vector
 * @param {number} [minD] @param {number} [maxD] distance range behind the player
 * @returns {{cells:Vec[], center:Vec, dist:number}|undefined}
 */
export function corridorBehind(p, travelDir, minD = 3, maxD = 7) {
  const dim = p.dimension;
  const back = V.scale(travelDir, -1);
  const side = { x: -travelDir.z, y: 0, z: travelDir.x };
  const base = V.floor(p.location);
  const open = (loc) => isReplaceable(safe(() => dim.getBlock(loc)));
  let best;
  for (let d = minD; d <= maxD; d++) {
    const c = { x: base.x + Math.round(back.x * d), y: base.y, z: base.z + Math.round(back.z * d) };
    if (!loaded(dim, c) || !open(c)) continue;
    let height = 0;
    while (height < 5 && open({ x: c.x, y: c.y + height, z: c.z })) height++;
    if (height < 2 || height > 4) continue;
    const cells = [];
    let enclosed = true;
    for (let h = 0; h < height && enclosed; h++) {
      for (const sign of [1, -1]) {
        for (let s = sign === 1 ? 0 : 1; s <= 3; s++) {
          const loc = { x: c.x + Math.round(side.x * s * sign), y: c.y + h, z: c.z + Math.round(side.z * s * sign) };
          if (!open(loc)) break;
          if (s === 3) { enclosed = false; break; }
          cells.push(loc);
        }
        if (!enclosed) break;
      }
    }
    if (!enclosed || cells.length === 0 || cells.length > 10) continue;
    if (!best || cells.length < best.cells.length) best = { cells, center: c, dist: d };
  }
  return best;
}
