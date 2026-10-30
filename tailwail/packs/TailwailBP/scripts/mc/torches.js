// Torch snuffing.  Tailwail puts lights out; the burnt stick stays where the torch was
// (tailwail:snuffed_torch keeps the torch's facing and kind) and can be relit with flint
// and steel, a fire charge or another torch.  Breaking it drops the torch back.
import { BlockPermutation, BlockTypes, BlockVolume } from "@minecraft/server";
import { SNUFFED_TORCH_ID } from "../config.js";
import { dist } from "../util/vec.js";
import { dlog } from "./log.js";

export const TORCH_KINDS = ["minecraft:torch", "minecraft:soul_torch", "minecraft:copper_torch"];
const FACINGS = ["top", "north", "south", "east", "west"];
const LIGHTERS = new Set(["minecraft:flint_and_steel", "minecraft:fire_charge", "minecraft:torch", "minecraft:soul_torch", "minecraft:copper_torch"]);

let kinds = null;
function liveKinds() {
  // copper torches only exist in newer versions; never ask the engine for a type it lacks
  if (!kinds) kinds = TORCH_KINDS.filter((id) => !!BlockTypes.get(id));
  return kinds;
}

/** Torch blocks within `radius` of `center` (cheap engine-side query), nearest first. */
export function findTorches(dim, center, radius, max = 12) {
  const r = Math.ceil(radius);
  const c = { x: Math.floor(center.x), y: Math.floor(center.y), z: Math.floor(center.z) };
  let list = [];
  try {
    const vol = new BlockVolume({ x: c.x - r, y: c.y - Math.min(r, 6), z: c.z - r }, { x: c.x + r, y: c.y + Math.min(r, 6), z: c.z + r });
    const found = dim.getBlocks(vol, { includeTypes: liveKinds() }, false);
    for (const loc of found.getBlockLocationIterator()) {
      if (dist(loc, c) <= radius) list.push({ x: loc.x, y: loc.y, z: loc.z });
    }
  } catch (e) {
    dlog("findTorches", e);
    return [];
  }
  list.sort((a, b) => dist(a, c) - dist(b, c));
  if (list.length > max) list = list.slice(0, max);
  return list;
}

/** Puts one torch out.  Returns true if a torch became a snuffed stick. */
export function snuff(dim, loc) {
  let block;
  try {
    block = dim.getBlock(loc);
  } catch {
    return false;
  }
  if (!block) return false;
  const kind = TORCH_KINDS.indexOf(block.typeId);
  if (kind < 0) return false;
  let facing = "top";
  try {
    const f = block.permutation.getState("torch_facing_direction");
    if (typeof f === "string" && FACINGS.includes(f)) facing = f;
  } catch {
    /* keep top */
  }
  try {
    block.setPermutation(BlockPermutation.resolve(SNUFFED_TORCH_ID, { "tailwail:facing": facing, "tailwail:kind": kind }));
    const tip = { x: loc.x + 0.5, y: loc.y + 0.7, z: loc.z + 0.5 };
    dim.playSound("random.fizz", tip, { volume: 0.35, pitch: 1.7 });
    try {
      dim.spawnParticle("tailwail:snuff_smoke", tip);
    } catch {
      /* particle is cosmetic */
    }
    return true;
  } catch (e) {
    dlog("snuff", e);
    return false;
  }
}

/** Restores the original torch on a snuffed stick. */
export function relight(block) {
  try {
    const kind = block.permutation.getState("tailwail:kind");
    const facing = block.permutation.getState("tailwail:facing");
    const id = TORCH_KINDS[typeof kind === "number" ? kind : 0] || TORCH_KINDS[0];
    if (!BlockTypes.get(id)) return false;
    block.setPermutation(BlockPermutation.resolve(id, { torch_facing_direction: FACINGS.includes(facing) ? facing : "top" }));
    const c = block.location;
    block.dimension.playSound("fire.ignite", { x: c.x + 0.5, y: c.y + 0.6, z: c.z + 0.5 }, { volume: 0.8, pitch: 1.0 });
    return true;
  } catch (e) {
    dlog("relight", e);
    return false;
  }
}

/** Custom block component: interact with a lighter in hand to relight. */
export const relightComponent = {
  onPlayerInteract(ev) {
    const p = ev.player;
    if (!p) return;
    let held;
    try {
      held = p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex);
    } catch {
      held = undefined;
    }
    if (held && LIGHTERS.has(held.typeId)) {
      relight(ev.block);
    } else {
      try {
        p.onScreenDisplay.setActionBar("§7The stick is still warm. §fFlint and steel§7 or a §ftorch§7 would light it.");
      } catch {
        /* left */
      }
    }
  },
};
