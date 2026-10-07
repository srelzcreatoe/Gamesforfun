// @ts-check
// A snapshot of the player's situation, used to choose encounters and placements.
import { world, GameMode } from "@minecraft/server";
import { V, safe, dimIndex } from "../core/util.js";
import { motion, primaryHaunt, routeFamiliarity } from "../observer/memory.js";

/** @typedef {import("@minecraft/server").Player} Player */

/**
 * @typedef {Object} Ctx
 * @property {Player} p
 * @property {number} d            dimension index (0 overworld, 1 nether, 2 end)
 * @property {boolean} eligible    survival/adventure, alive, not riding/flying in creative
 * @property {boolean} night
 * @property {number} light        light at the player's head
 * @property {number} sky          sky light at the player's head
 * @property {boolean} underground
 * @property {boolean} sheltered   roof within 6 blocks
 * @property {boolean} water       in water or in a boat
 * @property {boolean} gliding
 * @property {number} height       blocks above the ground below
 * @property {boolean} elevated    > 12 blocks above ground (pillars, sky bases, cliff edges)
 * @property {number} speed        horizontal blocks per second
 * @property {number} stillFor     seconds without moving
 * @property {boolean} moving
 * @property {ReturnType<typeof primaryHaunt>} haunt
 * @property {number} hauntDist
 * @property {number} familiarity  distinct visits to the current route cell
 * @property {number} hp           health fraction
 */

/** @param {Player} p @returns {Ctx} */
export function context(p) {
  const dim = p.dimension;
  const d = dimIndex(dim.id);
  const head = p.getHeadLocation();
  const mode = safe(() => p.getGameMode(), GameMode.Survival);
  const hpc = p.getComponent("minecraft:health");
  const hp = hpc ? hpc.currentValue / Math.max(1, hpc.effectiveMax) : 1;
  const m = motion(p);
  const light = safe(() => dim.getLightLevel(head), 15) ?? 15;
  const sky = safe(() => dim.getSkyLightLevel(head), 15) ?? 15;
  const roof = safe(() => dim.getBlockAbove(head, { includePassableBlocks: false, includeLiquidBlocks: false, maxDistance: 6 }));
  const top = d === 0 ? safe(() => dim.getTopmostBlock({ x: p.location.x, z: p.location.z })) : undefined;
  const underground = d === 0 ? sky === 0 && !!top && top.location.y - p.location.y > 6 : d === 1 && !!roof;
  const below = safe(() => dim.getBlockBelow(p.location, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: 64 }));
  const height = below ? p.location.y - (below.location.y + 1) : 64;
  const riding = safe(() => p.getComponent("minecraft:riding")?.entityRidingOn?.typeId, undefined);
  const water = !!safe(() => p.isInWater, false) || !!safe(() => p.isSwimming, false) || /boat|raft/.test(riding ?? "");
  const tod = world.getTimeOfDay();
  const haunt = primaryHaunt(p);
  return {
    p,
    d,
    eligible: (mode === GameMode.Survival || mode === GameMode.Adventure) && hp > 0 && !safe(() => p.isSleeping, false),
    night: d === 0 && tod > 12800 && tod < 23200,
    light,
    sky,
    underground,
    sheltered: !!roof,
    water,
    gliding: !!safe(() => p.isGliding, false),
    height,
    elevated: height > 12 && !water,
    speed: m.speed,
    stillFor: m.still,
    moving: m.speed > 1.5,
    haunt,
    hauntDist: haunt ? V.hdist(p.location, haunt.center) : Infinity,
    familiarity: routeFamiliarity(p),
    hp,
  };
}

/** Darkness/danger mood factor used to bias encounter timing (0.6..1.25). */
export function moodFactor(c) {
  let f = 1;
  if (c.night) f *= 0.8;
  if (c.underground) f *= 0.85;
  if (c.light <= 6) f *= 0.9;
  if (c.d !== 0) f *= 0.9;
  return Math.max(0.6, f);
}
