// @ts-check
// Environmental manipulation mechanics. Every block change goes through the ledger.
//
//  M1 doors        toggle door / trapdoor / fence-gate open state            (manipulation >= 1)
//  M2 lights       remove torches & lanterns, extinguish candles & campfires  (manipulation >= 2; candles/campfires >= 1)
//  M3 turn         rotate pumpkins / stonecutters / anvils to face a point    (manipulation >= 1)
//  M4 veil         temporary obstruction blocks in open air                   (manipulation >= 1)
//  M5 mimic        natural-looking blocks that alter a familiar route         (manipulation >= 2)
//  M6 effigy       staged evidence figure; breaking it yields a Vestige       (manipulation >= 1)
//  M7 carve        temporarily open a natural wall (restored later)           (manipulation >= 3)
//  M8 animals      nearby animals turn to face where it stands                (no block change)
import { BlockPermutation, BlockVolume, system } from "@minecraft/server";
import { BLOCKS, DOORS, TRAPDOORS, GATES, REMOVABLE_LIGHTS, CANDLES, CAMPFIRES, TURNABLE, NATURAL, MIMIC_AS, PARTICLES } from "../core/constants.js";
import { V, safe, dimIndex } from "../core/util.js";
import { S } from "../core/settings.js";
import * as ledger from "./ledger.js";
import { isReplaceable, isWarded } from "./space.js";

/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {{x:number,y:number,z:number}} Vec */

export const manip = () => (S().enabled ? S().manipulation : 0);

/**
 * Native, bounded block search.
 * @param {Dimension} dim @param {Vec} center @param {number} r horizontal radius @param {number} ry vertical radius
 * @param {Iterable<string>} types @param {number} [limit]
 * @returns {Vec[]} closest first
 */
export function findBlocks(dim, center, r, ry, types, limit = 24) {
  const c = V.floor(center);
  const vol = new BlockVolume({ x: c.x - r, y: c.y - ry, z: c.z - r }, { x: c.x + r, y: c.y + ry, z: c.z + r });
  const list = safe(() => dim.getBlocks(vol, { includeTypes: [...types] }, false));
  if (!list) return [];
  const out = [];
  for (const loc of list.getBlockLocationIterator()) {
    out.push({ x: loc.x, y: loc.y, z: loc.z });
    if (out.length >= 200) break;
  }
  out.sort((a, b) => V.dist(a, center) - V.dist(b, center));
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- M1 doors

export const OPENABLE = new Set([...DOORS, ...TRAPDOORS, ...GATES]);

/**
 * Toggle a door/trapdoor/gate. For doors, both halves are written and recorded.
 * @param {Dimension} dim @param {Vec} loc @param {number} enc @param {number} restoreIn
 * @returns {boolean} new open state, or undefined on failure
 */
export function toggleOpenable(dim, loc, enc, restoreIn) {
  if (manip() < 1) return undefined;
  const block = safe(() => dim.getBlock(loc));
  if (!block || !OPENABLE.has(block.typeId)) return undefined;
  let lower = block;
  if (DOORS.has(block.typeId) && block.permutation.getState("upper_block_bit")) lower = /** @type {any} */ (block.below());
  if (!lower) return undefined;
  const open = !lower.permutation.getState("open_bit");
  const upper = DOORS.has(lower.typeId) ? lower.above() : undefined;
  const linked = upper && upper.typeId === lower.typeId ? upper.location : undefined;
  const first = ledger.change(dim, lower.location, lower.permutation.withState("open_bit", open), { enc, kind: "door", restoreIn, link: linked });
  if (!first) return undefined;
  // the upper half mirrors the lower one; it is not a separate ledger entry
  if (upper && linked && upper.permutation.getState("open_bit") !== open) safe(() => upper.setPermutation(upper.permutation.withState("open_bit", open)));
  return open;
}

// ---------------------------------------------------------------- M2 lights

export const LIGHT_TYPES = new Set([...REMOVABLE_LIGHTS, ...CANDLES, ...CAMPFIRES]);

/**
 * Put out a light. Torches/lanterns are removed (no drop), candles and campfires change state.
 * @returns {boolean}
 */
export function snuffLight(dim, loc, enc, restoreIn) {
  const block = safe(() => dim.getBlock(loc));
  if (!block) return false;
  const t = block.typeId;
  const level = manip();
  if (REMOVABLE_LIGHTS.has(t)) {
    if (level < 2) return false;
    return !!ledger.change(dim, loc, BlockPermutation.resolve("minecraft:air"), { enc, kind: "light", restoreIn });
  }
  if (CANDLES.has(t)) {
    if (level < 1 || !block.permutation.getState("lit")) return false;
    return !!ledger.change(dim, loc, block.permutation.withState("lit", false), { enc, kind: "light", restoreIn });
  }
  if (CAMPFIRES.has(t)) {
    if (level < 1 || block.permutation.getState("extinguished")) return false;
    return !!ledger.change(dim, loc, block.permutation.withState("extinguished", true), { enc, kind: "light", restoreIn });
  }
  return false;
}

/** Lights near a point that are currently lit. */
export function litLightsNear(dim, center, r = 12, limit = 12) {
  return findBlocks(dim, center, r, 5, LIGHT_TYPES, 40).filter((l) => {
    const b = safe(() => dim.getBlock(l));
    if (!b) return false;
    if (CANDLES.has(b.typeId)) return !!b.permutation.getState("lit");
    if (CAMPFIRES.has(b.typeId)) return !b.permutation.getState("extinguished");
    return true;
  }).slice(0, limit);
}

// ---------------------------------------------------------------- M3 turned objects

/** @type {[string, {x:number, z:number}][]} */
const CARDINALS = [
  ["south", { x: 0, z: 1 }], ["north", { x: 0, z: -1 }], ["east", { x: 1, z: 0 }], ["west", { x: -1, z: 0 }],
];

/** Rotate a turnable object so its front faces toward a point. Returns the direction or undefined. */
export function turnToward(dim, loc, toward, enc, restoreIn) {
  if (manip() < 1) return undefined;
  const block = safe(() => dim.getBlock(loc));
  if (!block || !TURNABLE.has(block.typeId)) return undefined;
  const dir = V.flat(V.sub(toward, { x: loc.x + 0.5, y: loc.y, z: loc.z + 0.5 }));
  let best = CARDINALS[0];
  for (const c of CARDINALS) if (c[1].x * dir.x + c[1].z * dir.z > best[1].x * dir.x + best[1].z * dir.z) best = c;
  if (block.permutation.getState("minecraft:cardinal_direction") === best[0]) return undefined;
  const e = ledger.change(dim, loc, block.permutation.withState("minecraft:cardinal_direction", best[0]), { enc, kind: "turn", restoreIn });
  if (!e) return undefined;
  safe(() => dim.spawnParticle(PARTICLES.dust, { x: loc.x + 0.5, y: loc.y + 0.6, z: loc.z + 0.5 }));
  return best[0];
}

// ---------------------------------------------------------------- M4 veil / M5 mimic

/** Fill open cells with Veil (dark, drop-free, breakable by hand). */
export function placeVeil(dim, cells, enc, restoreIn) {
  if (manip() < 1) return 0;
  let n = 0;
  for (const c of cells) {
    const e = ledger.change(dim, c, BlockPermutation.resolve(BLOCKS.veil), {
      enc, kind: "veil", restoreIn, flags: ledger.F.NODROP, expect: (b) => isReplaceable(b),
    });
    if (e) n++;
  }
  return n;
}

/** Most common natural block around a location (for imitation), or undefined. */
export function surroundingNatural(dim, loc, r = 3) {
  const counts = {};
  for (const l of findBlocks(dim, loc, r, 2, NATURAL, 60)) {
    const t = safe(() => dim.getBlock(l)?.typeId);
    if (t) counts[t] = (counts[t] || 0) + 1;
  }
  let best, n = 0;
  for (const [t, c] of Object.entries(counts)) if (c > n) { best = t; n = c; }
  return best ? (MIMIC_AS[best] ?? best) : undefined;
}

/** Place natural-looking blocks into open cells (route alteration). */
export function placeMimic(dim, cells, enc, restoreIn, typeId) {
  if (manip() < 2) return 0;
  let n = 0;
  for (const c of cells) {
    const t = typeId ?? surroundingNatural(dim, c);
    if (!t) continue;
    const e = ledger.change(dim, c, BlockPermutation.resolve(t), {
      enc, kind: "mimic", restoreIn, flags: ledger.F.NODROP, expect: (b) => isReplaceable(b),
    });
    if (e) n++;
  }
  return n;
}

// ---------------------------------------------------------------- M6 effigy

const EFFIGY_LIFETIME = 45 * 60;

/** Find a free floor cell near a point for an effigy. */
export function effigyCell(dim, near, r = 3) {
  const base = V.floor(near);
  for (let i = 0; i < 24; i++) {
    const c = { x: base.x + Math.round((Math.random() * 2 - 1) * r), y: base.y + 2, z: base.z + Math.round((Math.random() * 2 - 1) * r) };
    for (let dy = 0; dy < 5; dy++) {
      const cell = { x: c.x, y: c.y - dy, z: c.z };
      const b = safe(() => dim.getBlock(cell));
      const below = b && safe(() => b.below());
      if (b && below && isReplaceable(b) && !below.isAir && !below.isLiquid && !/leaves|slab|stairs|fence|wall|door|glass|pane|carpet|snow_layer/.test(below.typeId)) {
        if (ledger.at(dimIndex(dim.id), cell) || isWarded(dimIndex(dim.id), cell)) break;
        return cell;
      }
    }
  }
  return undefined;
}

/** Place an effigy facing a point. Breaking it gives a Vestige (handled in progression). */
export function placeEffigy(dim, cell, facing, enc) {
  if (manip() < 1) return undefined;
  const dir = V.flat(V.sub(facing, { x: cell.x + 0.5, y: cell.y, z: cell.z + 0.5 }));
  let best = CARDINALS[0];
  for (const c of CARDINALS) if (c[1].x * dir.x + c[1].z * dir.z > best[1].x * dir.x + best[1].z * dir.z) best = c;
  const perm = safe(() => BlockPermutation.resolve(BLOCKS.effigy, { "minecraft:cardinal_direction": best[0] }));
  if (!perm) return undefined;
  return ledger.change(dim, cell, perm, {
    enc, kind: "effigy", restoreIn: EFFIGY_LIFETIME, flags: ledger.F.NODROP | ledger.F.EFFIGY,
    expect: (b) => isReplaceable(b),
  });
}

// ---------------------------------------------------------------- M7 carve

/** Temporarily remove natural blocks (Unsettling level only). */
export function carve(dim, cells, enc, restoreIn) {
  if (manip() < 3) return 0;
  let n = 0;
  for (const c of cells) {
    const e = ledger.change(dim, c, BlockPermutation.resolve("minecraft:air"), {
      enc, kind: "carve", restoreIn, expect: (b) => NATURAL.has(b.typeId),
    });
    if (e) n++;
  }
  return n;
}

// ---------------------------------------------------------------- M8 animals

const WATCHERS = ["minecraft:cow", "minecraft:sheep", "minecraft:pig", "minecraft:chicken", "minecraft:horse",
  "minecraft:donkey", "minecraft:goat", "minecraft:llama", "minecraft:villager_v2", "minecraft:cat", "minecraft:wolf",
  "minecraft:fox", "minecraft:rabbit", "minecraft:mooshroom", "minecraft:camel", "minecraft:armadillo"];

/**
 * Nearby animals stop and turn toward where the Observer stands, for durationTicks.
 * Purely rotational and temporary; returns the number of animals affected.
 */
export function animalsFace(dim, around, observerLoc, radius = 20, durationTicks = 120) {
  const mobs = safe(() => dim.getEntities({ location: around, maxDistance: radius }), []) ?? [];
  const chosen = mobs.filter((m) => WATCHERS.includes(m.typeId)).slice(0, 12);
  if (chosen.length === 0) return 0;
  let t = 0;
  const id = system.runInterval(() => {
    t += 4;
    for (const m of chosen) {
      if (!m.isValid) continue;
      const yaw = V.yawTo(m.location, observerLoc);
      const pitch = V.pitchTo(m.getHeadLocation(), { x: observerLoc.x, y: observerLoc.y + 3.2, z: observerLoc.z });
      safe(() => m.setRotation({ x: pitch, y: yaw }));
      safe(() => m.clearVelocity());
    }
    if (t >= durationTicks) system.clearRun(id);
  }, 4);
  return chosen.length;
}
