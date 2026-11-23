// @ts-check
// The corruption (1.5.0). The world around you glitches: for a few seconds the ground under and around you breaks up
// into black, blood-red and crying obsidian, torn fragments flicker where it happens, there is a burst of static — and
// then it is all exactly as it was. Only natural ground (grass, dirt, stone, sand ...) is ever touched, never anything
// you built and never a block that holds something; every change is in the ledger and put back after a few seconds
// (or at once with Undo its changes). Needs manipulation at Subtle or above; never inside a Ward Lantern's light.
import { BlockPermutation } from "@minecraft/server";
import * as ledger from "../world/ledger.js";
import { manip } from "../world/manipulate.js";
import { isWarded } from "../world/space.js";
import { NATURAL, PARTICLES, SOUNDS } from "../core/constants.js";
import { V, safe, emit, rand, pick, dimIndex } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */

const PALETTE = ["minecraft:black_concrete", "minecraft:red_concrete", "minecraft:crying_obsidian", "minecraft:black_concrete", "minecraft:redstone_block"];

/**
 * The ground around them breaks up for a few seconds. @param {Player} p @param {{n?:number, seconds?:number, r?:number}} [o]
 * @returns {number} how many blocks it broke up
 */
export function corrupt(p, o = {}) {
  if (manip() < 1 || !p.isValid) return 0;
  const dim = p.dimension;
  const d = dimIndex(dim.id);
  const n = o.n ?? 12;
  const r = o.r ?? 7;
  const seconds = o.seconds ?? 3;
  let done = 0;
  for (let i = 0; i < n * 5 && done < n; i++) {
    const off = V.scale(V.fromYaw(rand(0, 360)), rand(1.5, r));
    const top = { x: p.location.x + off.x, y: p.location.y + 2, z: p.location.z + off.z };
    const ground = safe(() => dim.getBlockBelow(top, { includePassableBlocks: false, includeLiquidBlocks: false, maxDistance: 6 }), undefined);
    if (!ground || !NATURAL.has(ground.typeId)) continue;
    const loc = ground.location;
    if (isWarded(d, loc) || ledger.at(d, loc)) continue;
    const perm = safe(() => BlockPermutation.resolve(pick(PALETTE)), undefined);
    if (!perm) continue;
    if (!ledger.change(dim, loc, perm, { enc: 0, kind: "corrupt", restoreIn: seconds + rand(0, 1.5) })) continue;
    done++;
    if (done % 3 === 1) safe(() => dim.spawnParticle(PARTICLES.glitchBurst, { x: loc.x + 0.5, y: loc.y + 1, z: loc.z + 0.5 }));
  }
  if (done) {
    safe(() => p.playSound(SOUNDS.static, { volume: 0.8, pitch: 0.9 }));
    emit("corrupt", { what: "corrupt", player: p.name, n: done });
  }
  return done;
}
