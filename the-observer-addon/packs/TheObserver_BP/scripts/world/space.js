// @ts-check
// Where the Observer can stand. Every placement goes through standAt(), which
// rejects unloaded chunks, solid/dangerous blocks, insufficient headroom, warded
// areas and (optionally) liquid surfaces. findSpot() samples candidates around a
// player and scores them by concealment, cover and distance.
import { BlockVolume, BlockTypes } from "@minecraft/server";
import { DANGER, TRUNKS, MIRE_TRUNKS, RIFT_TRUNKS } from "../core/constants.js";
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

/**
 * Is there a solid block beside loc (perpendicular to the line of sight) that can hide/peek from? Only real cover
 * counts (1.5.1): not leaves, glass, bars, fences or plants. tall: a column from its feet to above its head (0-3).
 * @param {Dimension} dim @param {Vec} feet @param {Vec} eye @param {{tall?:boolean}} [o]
 */
export function coverSide(dim, feet, eye, o = {}) {
  const toEye = V.flat(V.sub(eye, feet));
  const side = { x: -toEye.z, y: 0, z: toEye.x };
  const heights = o.tall ? [0, 1, 2, 3] : [1, 2];
  const solidAt = (dir) => {
    let n = 0;
    for (const h of heights) {
      const b = safe(() => dim.getBlock({ x: feet.x + dir.x * 0.9, y: feet.y + h, z: feet.z + dir.z * 0.9 }));
      if (isCover(b)) n++;
      else if (o.tall) return false;
    }
    return n > 0;
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
    const cover = coverSide(dim, st.loc, eye, { tall: true });
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

/** Tree trunks (and the Weeping Mire's, and the Rift's): what it hides behind. */
const TRUNK_IDS = [...TRUNKS, ...MIRE_TRUNKS, ...RIFT_TRUNKS];
const TRUNK_SET = new Set(TRUNK_IDS);
const LOOK_THROUGH = /^minecraft:(air|short_grass|tall_grass|fern|large_fern|vine|.+_leaves)$|^wmire:(weeping_leaves|weeping_tendril)$/;

/**
 * What is not cover (1.5.1): what you can see through or past — leaves, glass, bars, fences — and plants, lights and
 * the like. Everything else that is a block, not air or liquid, hides it.
 */
const NOT_COVER = /leaves|tendril|glass|pane|_bars|fence|vine|grass|fern|flower|bush|sapling|roots|torch|lantern|candle|sign|banner|carpet|rail|button|pressure_plate|lever|ladder|scaffolding|web|snow_layer|light_block|kelp|seagrass|coral_fan|lily|dripleaf|azalea$|mushroom$|wheat|carrots|potatoes|beetroot|sweet_berry|cactus|bamboo|chain$|eyebloom/;
/** @param {import("@minecraft/server").Block|undefined} b */
export function isCover(b) {
  return !!b && !b.isAir && !b.isLiquid && !NOT_COVER.test(b.typeId);
}

/** Places round a column of cover, nearest first: beside it and along the walls that meet there, up to three blocks off. */
const ROUND = (() => {
  const out = [];
  for (let ox = -3; ox <= 3; ox++) for (let oz = -3; oz <= 3; oz++) if ((ox || oz) && Math.min(Math.abs(ox), Math.abs(oz)) <= 1) out.push([ox, oz]);
  return out.sort((a, b) => Math.hypot(a[0], a[1]) - Math.hypot(b[0], b[1]));
})();

/** The building blocks it can hide behind besides trees — walls of houses, pillars, rock (built once). @type {string[]|undefined} */
let coverIds;
function buildingCover() {
  if (coverIds) return coverIds;
  const ok = /(_planks|_log|_wood|_stem|_hyphae|brick|bricks|cobblestone|stone_bricks|^minecraft:stone$|smooth_stone|sandstone|_concrete$|terracotta|_wool$|quartz_block|purpur_block|_tiles$|polished_|blackstone|basalt|obsidian|bookshelf|^minecraft:(andesite|diorite|granite|tuff|calcite|deepslate|cobbled_deepslate|mossy_cobblestone|packed_mud|mud_bricks|hay_block|bone_block|crafting_table|barrel)$|^wmire:)/;
  const no = /slab|stairs|wall$|_wall|fence|door|button|pressure|sign|pane|glass|leaves|tendril|carpet|_ore$|eyebloom|page|torn|grass|sprout/;
  const ids = (safe(() => BlockTypes.getAll().map((t) => t.id), []) ?? []).filter((id) => ok.test(id) && !no.test(id));
  coverIds = [...new Set([...TRUNK_IDS, ...ids])];
  return coverIds;
}

/**
 * Every block cell a straight line from a to b passes through, between distances d0 and d1 along it (an exact
 * voxel walk). @param {Vec} a @param {Vec} b @param {number} d0 @param {number} d1 @returns {Generator<Vec>}
 */
function* cellsAlong(a, b, d0, d1) {
  const len = V.len(V.sub(b, a));
  if (len < 1e-6) return;
  const dx = (b.x - a.x) / len, dy = (b.y - a.y) / len, dz = (b.z - a.z) / len;
  const px = a.x + dx * d0, py = a.y + dy * d0, pz = a.z + dz * d0;
  let x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tx = sx > 0 ? (x + 1 - px) / dx : sx < 0 ? (x - px) / dx : Infinity;
  let ty = sy > 0 ? (y + 1 - py) / dy : sy < 0 ? (y - py) / dy : Infinity;
  let tz = sz > 0 ? (z + 1 - pz) / dz : sz < 0 ? (z - pz) / dz : Infinity;
  for (let n = 0; n < 64; n++) {
    yield { x, y, z };
    const next = Math.min(tx, ty, tz);
    if (d0 + next > d1) return;
    if (tx === next) {
      x += sx;
      tx += tdx;
    } else if (ty === next) {
      y += sy;
      ty += tdy;
    } else {
      z += sz;
      tz += tdz;
    }
  }
}

/**
 * Is there a block that passes test in the last `near` blocks of the line from a to b (an exact walk, cell by cell —
 * the engine's own ray steps about a block at a time and can slip past the corner of a block a line only clips)?
 * @param {Dimension} dim @param {Vec} a @param {Vec} b @param {number} near @param {(b: import("@minecraft/server").Block|undefined) => boolean} test
 */
export function nearBlocked(dim, a, b, near, test) {
  const len = V.len(V.sub(b, a));
  for (const c of cellsAlong(a, b, Math.max(0, len - near), len - 0.05)) if (test(safe(() => dim.getBlock(c)))) return true;
  return false;
}

/** Blocks the view of its head: solid cover, or leaves. @param {import("@minecraft/server").Block|undefined} b */
const blocksView = (b) => isCover(b) || (!!b && /leaves/.test(b.typeId));

/**
 * Does solid cover (not leaves, glass and the like) stand between a and b? Leaves and see-through blocks on the way
 * are passed through and the ray goes on (1.5.1). @param {Dimension} dim @param {Vec} a @param {Vec} b
 */
export function solidBlocked(dim, a, b) {
  let from = a;
  for (let hop = 0; hop < 6; hop++) {
    const delta = V.sub(b, from);
    const dist = V.len(delta);
    if (dist < 0.3) return false;
    const dir = V.scale(delta, 1 / dist);
    // (the engine's ray can miss a block that ends just short of maxDistance: cast a little further and keep only
    // what it hits before the point)
    const hit = safe(() => dim.getBlockFromRay(from, dir, { maxDistance: dist + 2, includeLiquidBlocks: false, includePassableBlocks: false }));
    if (!hit) return false;
    const at = V.add(hit.block.location, hit.faceLocation);
    if (V.dot(V.sub(at, from), dir) > dist - 0.05) return false;
    const hl = hit.block.location;
    if (hl.x === Math.floor(b.x) && hl.y === Math.floor(b.y) && hl.z === Math.floor(b.z)) return false;
    if (isCover(hit.block)) return true;
    const bl = hit.block.location;
    const center = { x: bl.x + 0.5, y: bl.y + 0.5, z: bl.z + 0.5 };
    const along = V.dot(V.sub(center, from), dir) + 0.9;
    from = V.add(from, V.scale(dir, Math.max(along, 0.5)));
  }
  return true;
}

/**
 * Solid cover between a and b — what the engine's ray finds, and, walked exactly cell by cell, anything in the last few
 * blocks before b (where the trunk or wall it hides behind stands). @param {Dimension} dim @param {Vec} a @param {Vec} b
 */
function coverBetween(dim, a, b) {
  return solidBlocked(dim, a, b) || nearBlocked(dim, a, b, 5, isCover);
}

/** Its whole body at feet — feet, chest, the top of its head — behind solid cover from eye. @param {Dimension} dim @param {Vec} feet @param {Vec} eye @param {boolean} stoop */
export function hiddenBehind(dim, feet, eye, stoop) {
  for (const pt of bodyPoints(feet, stoop)) if (!coverBetween(dim, eye, pt)) return false;
  return true;
}

/**
 * Hiding at feet from eye, as body.js keeps it: the cover between, the side it looks round, and the other side.
 * @param {Dimension} dim @param {Vec} feet @param {Vec} eye @param {boolean} stoop
 * @returns {{trunk:Vec, side:number, peek:Vec, alt?:{loc:Vec, side:number, peek:Vec}}|undefined}
 */
export function hideAt(dim, feet, eye, stoop) {
  const sides = peekCheck(dim, feet, eye, stoop);
  if (!sides) return undefined;
  const u = V.flat(V.sub(eye, feet));
  return { trunk: { x: feet.x + u.x, y: feet.y, z: feet.z + u.z }, side: sides[0].side, peek: sides[0].peek, alt: sides[1] };
}

/**
 * Standing at feet, is it hidden from eye — its whole body, feet to the top of its head, behind solid cover as tall as
 * it is — with a side it can lean its head out from, seen and seeing? (1.5.1: the only way it peeks.) side follows the
 * peek clip (+1 leans toward -sideVec; see coverSide).
 * @param {Dimension} dim @param {Vec} feet @param {Vec} eye @param {boolean} stoop
 * @returns {{loc:Vec, side:number, peek:Vec}[]|undefined} one entry per side it can look round, best first
 */
export function peekCheck(dim, feet, eye, stoop) {
  if (!hiddenBehind(dim, feet, eye, stoop)) return undefined;
  const toEye = V.flat(V.sub(eye, feet));
  const sideVec = { x: -toEye.z, y: 0, z: toEye.x };
  /** @type {{loc:Vec, side:number, peek:Vec}[]} */
  const sides = [];
  for (const s of [1, -1]) {
    const lean = V.scale(sideVec, -s);
    // its head, leaning about a block out — seen if its middle is, or its outer half (a line grazing the corner of the
    // cover still shows half a face)
    const y = feet.y + (stoop ? 2.5 : 3.4);
    const head = [1.0, 1.3].map((k) => ({ x: feet.x + lean.x * k, y, z: feet.z + lean.z * k })).find((pt) => {
      const cell = safe(() => dim.getBlock(pt));
      if (cell && !LOOK_THROUGH.test(cell.typeId)) return false;
      return lineOfSight(dim, eye, pt).clear && lineOfSight(dim, pt, eye).clear && !nearBlocked(dim, eye, pt, 4, blocksView);
    });
    if (!head) continue;
    // standing a touch away from the side it looks round, so its body stays behind the cover and only its head, a
    // shoulder and the hand on the edge come round it
    const nudge = V.scale(sideVec, s * 0.06);
    sides.push({ loc: { x: feet.x + nudge.x, y: feet.y, z: feet.z + nudge.z }, side: s, peek: head });
  }
  return sides.length ? sides : undefined;
}

/**
 * Hiding behind something (1.1.0 trees; 1.5.1 anything solid as tall as it is — a trunk, the wall or corner of a
 * house, a pillar, a rock): a column of cover some 8-28 blocks off, and a spot beside it where the column hides its
 * whole body from the player — straight behind it, or round the corner of a wall — with a side it can look round:
 * its head, leaning about a block out at head height, in sight both ways. The other side too, if it is open (it
 * switches sides when it keeps being caught on one).
 * @param {Player} p @param {{minDist?:number, maxDist?:number, samples?:number, treesOnly?:boolean}} [o]
 * @returns {{loc:Vec, stoop:boolean, vis:number, side:number, score:number, liquid:boolean, hide:{trunk:Vec, side:number, peek:Vec, alt?:{loc:Vec, side:number, peek:Vec}}}|undefined}
 */
export function hideSpot(p, o = {}) {
  const dim = p.dimension;
  const eye = p.getHeadLocation();
  const base = p.location;
  const min = o.minDist ?? 8, max = o.maxDist ?? 28;
  const others = o.treesOnly ? [] : buildingCover().filter((id) => !TRUNK_SET.has(id));
  const idSet = new Set([...TRUNK_IDS, ...others]);
  const typeAt = (x, y, z) => safe(() => dim.getBlock({ x, y, z })?.typeId, "") ?? "";
  const isCol = (x, y, z) => idSet.has(typeAt(x, y, z));
  // every column of cover within reach at about the player's height: the trees in one query, the rest in another
  const bx = Math.floor(base.x), by = Math.floor(base.y), bz = Math.floor(base.z);
  const box = new BlockVolume({ x: bx - max, y: by - 1, z: bz - max }, { x: bx + max, y: by + 4, z: bz + max });
  /** @type {Map<number, {x:number, z:number, d:number, tree:boolean}>} */
  const cols = new Map();
  for (const [types, tree] of /** @type {[string[], boolean][]} */ ([[TRUNK_IDS, true], [others, false]])) {
    if (!types.length) continue;
    const found = safe(() => dim.getBlocks(box, { includeTypes: types }, true));
    if (!found) continue;
    for (const l of found.getBlockLocationIterator()) {
      const k = l.x * 100003 + l.z;
      if (cols.has(k)) continue;
      const d = Math.hypot(l.x + 0.5 - base.x, l.z + 0.5 - base.z);
      if (d >= min && d <= max) cols.set(k, { x: l.x, z: l.z, d, tree });
    }
  }
  // trees first (shuffled), then the rest (shuffled)
  const all = [...cols.values()].sort(() => Math.random() - 0.5);
  const list = [...all.filter((c) => c.tree), ...all.filter((c) => !c.tree)].slice(0, o.samples ?? 48);
  let best;
  let checks = 0;
  for (const { x, z, d, tree } of list) {
    if (checks > 140) break;
    let ty;
    for (const dy of [1, 2, 0, 3, -1, 4]) if (isCol(x, by + dy, z)) {
      ty = by + dy;
      break;
    }
    if (ty === undefined) continue;
    let bottom = ty, top = ty;
    while (bottom > ty - 6 && isCol(x, bottom - 1, z)) bottom--;
    while (top < ty + 8 && isCol(x, top + 1, z)) top++;
    // as tall as a tree: at least three blocks of it above the ground it stands on
    if (top - bottom + 1 < 3) continue;
    const trunk = { x: x + 0.5, y: bottom, z: z + 0.5 };
    const u = V.flat(V.sub(trunk, eye));
    // a wall's middle hides nothing it can lean round: only columns with open air on two sides at right angles
    // (a corner, a wall's end, a pillar, a trunk)
    const open = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([ox, oz]) => !isCover(safe(() => dim.getBlock({ x: x + ox, y: bottom + 1, z: z + oz }))));
    if (!open.some((v, i) => v && open[(i + 1) % 4])) continue;
    // where it could stand: straight behind it (one more behind a thick trunk), then round its far side — along the
    // walls that meet there, up to three blocks back (the corner of a house: round it, where the walls hide it and its
    // head comes past the edge)
    const at = [[u.x * 1.05, u.z * 1.05], [u.x * 2.05, u.z * 2.05], ...ROUND.filter(([ox, oz]) => ox * u.x + oz * u.z > 0.1)];
    for (const [ox, oz] of at) {
      const hx = trunk.x + ox, hz = trunk.z + oz;
      const dd = Math.hypot(hx - base.x, hz - base.z);
      if (dd < min || dd > max + 2) continue;
      const st = standAt(dim, hx, hz, bottom + 2.5, 4);
      if (!st || st.liquid || Math.abs(st.loc.y - bottom) > 1.1 || isCover(safe(() => dim.getBlock({ x: Math.floor(hx), y: Math.floor(st.loc.y) + 1, z: Math.floor(hz) })))) continue;
      checks++;
      const sides = peekCheck(dim, st.loc, eye, st.stoop);
      if (!sides) continue;
      if (Math.random() < 0.5) sides.reverse();
      const light = safe(() => dim.getLightLevel({ x: st.loc.x, y: st.loc.y + 1, z: st.loc.z }), 8) ?? 8;
      const score = (15 - light) * 0.2 - Math.abs(d - (min + max) / 2) * 0.05 + rand(0, 1) + (tree ? 0.5 : 0);
      if (!best || score > best.score) {
        best = { loc: sides[0].loc, stoop: st.stoop, vis: 1, side: sides[0].side, score, liquid: false,
          hide: { trunk, side: sides[0].side, peek: sides[0].peek, alt: sides[1] } };
      }
      break;
    }
  }
  return best;
}
