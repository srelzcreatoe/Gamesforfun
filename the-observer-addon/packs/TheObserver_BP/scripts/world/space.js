// @ts-check
// Where the Observer can stand. Every placement goes through standAt(), which
// rejects unloaded chunks, solid/dangerous blocks, insufficient headroom, warded
// areas and (optionally) liquid surfaces. findSpot() samples candidates around a
// player and scores them by concealment, cover and distance.
import { BlockVolume } from "@minecraft/server";
import { DANGER, TRUNKS, MIRE_TRUNKS } from "../core/constants.js";
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
  let ground = safe(() => dim.getBlockBelow(probe, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: maxDown }));
  if (o.liquidSurface) {
    // the raycast can pass through water (it counts as passable), so look for the surface explicitly
    const bottom = ground ? ground.location.y : Math.floor(probe.y) - maxDown;
    for (let y = Math.floor(probe.y); y > bottom; y--) {
      const b = safe(() => dim.getBlock({ x: bx, y, z: bz }));
      if (b && b.isLiquid) {
        ground = b;
        break;
      }
    }
  }
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
  // side is the peek clip's lean: +1 leans toward -side, so it leans out away from the cover (1.1.0: it used to be
  // the other way round, leaning into the cover)
  if (left && !right) return { side: 1, has: true, one: true };
  if (right && !left) return { side: -1, has: true, one: true };
  return { side: 1, has: left && right, one: false };
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
 * @property {number} [minRise]     stand at least this many blocks above the origin (a high ledge)
 * @property {boolean} [liquidSurface]
 * @property {boolean} [preferLiquid]   strongly prefer standing on a liquid surface (water encounters)
 * @property {boolean} [preferCover]    strongly prefer spots with cover on one side (it peeks from behind it)
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
    if (spec.minRise !== undefined && st.loc.y - origin.y < spec.minRise) continue;
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
      // both ways: a ray that starts inside a block does not see it, so a head poking into leaves would see
      // out while nobody could see it (sight.visibility looks from the eye)
      const to = spec.losTarget ?? eye;
      if (!lineOfSight(dim, head, to).clear || !lineOfSight(dim, to, head).clear) continue;
    }
    if (spec.hideFrom && spec.hideFrom.some((o) => o.id !== p.id && visibility(o, st.loc, { stooped: st.stoop, fov: 70 }).points > 0)) continue;
    if (spec.showTo && !spec.showTo.every((o) => visibility(o, st.loc, { stooped: st.stoop, fov: 55 }).points > 0)) continue;
    const cover = coverSide(dim, st.loc, eye);
    if (cover.has) score += 3;
    if (cover.one) score += spec.preferCover ? 10 : 2; // a trunk or wall corner to lean out from
    const light = safe(() => dim.getLightLevel({ x: st.loc.x, y: st.loc.y + 1, z: st.loc.z }), 8) ?? 8;
    score += (15 - light) * 0.25; // prefers darker spots
    if (spec.preferLiquid && st.liquid) score += 8;
    // stay near the player's own level (a figure far below or above is rarely what an encounter wants)
    if (spec.yMode !== "below") score -= Math.max(0, Math.abs(st.loc.y - origin.y) - 6) * 0.5;
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

/** Tree trunks (and the Weeping Mire's): what it hides behind. */
const TRUNK_IDS = [...TRUNKS, ...MIRE_TRUNKS];
const TRUNK_SET = new Set(TRUNK_IDS);
const LOOK_THROUGH = /^minecraft:(air|short_grass|tall_grass|fern|large_fern|vine|.+_leaves)$|^wmire:(weeping_leaves|weeping_tendril)$/;

/**
 * Hiding behind a tree (1.1.0): a trunk at least three logs high, some 8-28 blocks off, and the spot straight behind
 * it as the player sees it — where the trunk hides its body — with a side it can look round: its head, leaning about
 * a block out at head height, in sight both ways. The other side too, if it is open (it switches sides when it keeps
 * being caught on one). side follows the peek clip (+1 leans toward -sideVec; see coverSide).
 * @param {Player} p @param {{minDist?:number, maxDist?:number, samples?:number}} [o]
 * @returns {{loc:Vec, stoop:boolean, vis:number, side:number, score:number, liquid:boolean, hide:{trunk:Vec, side:number, peek:Vec, alt?:{loc:Vec, side:number, peek:Vec}}}|undefined}
 */
export function hideSpot(p, o = {}) {
  const dim = p.dimension;
  const eye = p.getHeadLocation();
  const base = p.location;
  const min = o.minDist ?? 8, max = o.maxDist ?? 28;
  const isTrunk = (x, y, z) => TRUNK_SET.has(safe(() => dim.getBlock({ x, y, z })?.typeId, "") ?? "");
  // every trunk within reach at about the player's height, in one query
  const bx = Math.floor(base.x), by = Math.floor(base.y), bz = Math.floor(base.z);
  /** @type {Map<number, {x:number, z:number, d:number}>} */
  const cols = new Map();
  const found = safe(() => dim.getBlocks(new BlockVolume({ x: bx - max, y: by - 1, z: bz - max }, { x: bx + max, y: by + 4, z: bz + max }), { includeTypes: TRUNK_IDS }, true));
  if (found) {
    for (const l of found.getBlockLocationIterator()) {
      const k = l.x * 100003 + l.z;
      if (cols.has(k)) continue;
      const d = Math.hypot(l.x + 0.5 - base.x, l.z + 0.5 - base.z);
      if (d >= min && d <= max) cols.set(k, { x: l.x, z: l.z, d });
    }
  }
  const list = [...cols.values()].sort(() => Math.random() - 0.5).slice(0, o.samples ?? 40);
  let best;
  for (const { x, z, d } of list) {
    let ty;
    for (const dy of [1, 2, 0, 3, -1, 4]) if (isTrunk(x, Math.floor(base.y) + dy, z)) {
      ty = Math.floor(base.y) + dy;
      break;
    }
    if (ty === undefined) continue;
    let bottom = ty, top = ty;
    while (bottom > ty - 6 && isTrunk(x, bottom - 1, z)) bottom--;
    while (top < ty + 8 && isTrunk(x, top + 1, z)) top++;
    if (top - bottom + 1 < 3) continue;
    const trunk = { x: x + 0.5, y: bottom, z: z + 0.5 };
    const u = V.flat(V.sub(trunk, eye));
    // straight behind it (one block more behind a thick trunk)
    let st;
    for (const k of [1.05, 2.05]) {
      const hx = trunk.x + u.x * k, hz = trunk.z + u.z * k;
      const s = standAt(dim, hx, hz, bottom + 2.5, 4);
      if (!s || s.liquid || Math.abs(s.loc.y - bottom) > 1.1 || isTrunk(Math.floor(hx), Math.floor(s.loc.y) + 1, Math.floor(hz))) continue;
      st = s;
      break;
    }
    if (!st) continue;
    // hidden there: the trunk stands between the player and its chest
    if (lineOfSight(dim, eye, { x: st.loc.x, y: st.loc.y + 1.9, z: st.loc.z }).clear) continue;
    const toEye = V.flat(V.sub(eye, st.loc));
    const sideVec = { x: -toEye.z, y: 0, z: toEye.x };
    const sides = [];
    for (const s of [1, -1]) {
      const lean = V.scale(sideVec, -s);
      const head = { x: st.loc.x + lean.x * 1.0, y: st.loc.y + (st.stoop ? 2.5 : 3.4), z: st.loc.z + lean.z * 1.0 };
      const cell = safe(() => dim.getBlock(head));
      if (cell && !LOOK_THROUGH.test(cell.typeId)) continue;
      if (!lineOfSight(dim, eye, head).clear || !lineOfSight(dim, head, eye).clear) continue;
      // standing a touch away from the side it looks round, so its body stays behind the trunk and only its head,
      // a shoulder and the hand on the bark come round the edge
      const nudge = V.scale(sideVec, s * 0.06);
      sides.push({ loc: { x: st.loc.x + nudge.x, y: st.loc.y, z: st.loc.z + nudge.z }, side: s, peek: head });
    }
    if (!sides.length) continue;
    if (Math.random() < 0.5) sides.reverse();
    const light = safe(() => dim.getLightLevel({ x: st.loc.x, y: st.loc.y + 1, z: st.loc.z }), 8) ?? 8;
    const score = (15 - light) * 0.2 - Math.abs(d - (min + max) / 2) * 0.05 + rand(0, 1);
    if (!best || score > best.score) {
      best = { loc: sides[0].loc, stoop: st.stoop, vis: 1, side: sides[0].side, score, liquid: false,
        hide: { trunk, side: sides[0].side, peek: sides[0].peek, alt: sides[1] } };
    }
  }
  return best;
}
