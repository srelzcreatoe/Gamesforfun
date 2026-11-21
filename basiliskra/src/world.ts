/**
 * Careful access to the world.  Nothing here ever loads a chunk: an unloaded position answers
 * "unknown", which is a different answer from "nothing there".
 */
import { Block, Dimension, world } from "@minecraft/server";
import { OVERWORLD } from "./config";
import type { V3 } from "./vec";

export const overworld = (): Dimension => world.getDimension(OVERWORLD);

export function isLoaded(dim: Dimension, p: V3): boolean {
  try { return dim.isChunkLoaded(p); } catch { return false; }
}

export function blockAt(dim: Dimension, p: V3): Block | undefined {
  if (!isLoaded(dim, p)) return undefined;
  try { return dim.getBlock({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }) ?? undefined; } catch { return undefined; }
}

export const idAt = (dim: Dimension, p: V3): string | undefined => blockAt(dim, p)?.typeId;
export const isWaterId = (id: string | undefined): boolean => id === "minecraft:water" || id === "minecraft:flowing_water";

const SOFT = /(^minecraft:(air|light_block.*|structure_void|short_grass|tall_grass|fern|large_fern|deadbush|seagrass|kelp|vine|.*_vines.*|snow_layer|.*carpet|.*torch|redstone_wire|.*_button|lever|.*rail|.*sapling|.*_flower|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|wheat|carrots|potatoes|beetroot|reeds|sugar_cane|bamboo_sapling|waterlily|.*sign|.*banner|.*pressure_plate|tripwire.*|ladder|scaffolding|fire|soul_fire|cobweb|web|.*mushroom|nether_wart|sweet_berry_bush|.*coral_fan.*|sea_pickle|frog_spawn|leaf_litter|bush|firefly_bush|cactus_flower|wildflowers|pink_petals)$)/;

/** Does this block hold up a giant's foot or stop a body?  Liquids and small plants do not. */
export function isSolidBlock(b: Block | undefined): boolean {
  if (!b) return false;
  if (b.isAir || b.isLiquid) return false;
  return !SOFT.test(b.typeId);
}

export const UNLOADED = Symbol("unloaded");
export const NONE = Symbol("none");
export type Probe = number | typeof UNLOADED | typeof NONE;

/** Top surface (y of the first free block) of the ground in one column, searched from yTop down. */
export function groundY(dim: Dimension, x: number, z: number, yTop: number, depth: number): Probe {
  const range = dim.heightRange;
  let y = Math.min(Math.floor(yTop), range.max - 1);
  const stop = Math.max(Math.floor(yTop - depth), range.min);
  if (!isLoaded(dim, { x, y, z })) return UNLOADED;
  for (; y >= stop; y--) {
    const b = blockAt(dim, { x, y, z });
    if (!b) return UNLOADED;
    if (isSolidBlock(b)) return y + 1;
  }
  return NONE;         // "no ground" is its own answer, never the bottom of the search
}

/**
 * Ground under a wide footprint: the lower median of nine column floors, so one tree or one
 * pit under a foot does not jolt the body.
 */
export function footprintY(dim: Dimension, at: V3, radius: number, yTop: number, depth: number): Probe {
  const ys: number[] = [];
  let unloaded = 0;
  for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) {
    const g = groundY(dim, at.x + dx, at.z + dz, yTop, depth);
    if (g === UNLOADED) unloaded++;
    else if (g !== NONE) ys.push(g as number);
  }
  if (unloaded > 4) return UNLOADED;
  if (ys.length < 3) return NONE;
  ys.sort((a, b) => a - b);
  return ys[Math.floor((ys.length - 1) / 2)];
}

/** Water column at x,z near y: surface (top of the top water block) and floor, or why not. */
export function waterColumn(dim: Dimension, x: number, z: number, y: number, reach = 24): { surface: number; floor: number } | typeof UNLOADED | typeof NONE {
  if (!isLoaded(dim, { x, y, z })) return UNLOADED;
  let top = Math.floor(y);
  let b = blockAt(dim, { x, y: top, z });
  if (!b) return UNLOADED;
  if (!isWaterId(b.typeId)) {
    // look a little up and down for the surface
    let found = false;
    for (let d = 1; d <= reach && !found; d++) {
      for (const yy of [top - d, top + d]) {
        if (isWaterId(idAt(dim, { x, y: yy, z }))) { top = yy; found = true; break; }
      }
    }
    if (!found) return NONE;
  }
  while (isWaterId(idAt(dim, { x, y: top + 1, z })) && top < dim.heightRange.max - 2) top++;
  let bottom = top;
  while (bottom > dim.heightRange.min + 1 && bottom > top - 64 && isWaterId(idAt(dim, { x, y: bottom - 1, z }))) bottom--;
  return { surface: top + 1, floor: bottom };
}

/** Is there an unbroken line through air/water between two points?  Cut at unloaded chunks. */
export function clearLine(dim: Dimension, a: V3, b: V3): boolean {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  const end = { x: a.x + dx, y: a.y + dy, z: a.z + dz };
  if (!isLoaded(dim, a) || !isLoaded(dim, end)) return false;
  try {
    const hit = dim.getBlockFromRay(a, { x: dx / d, y: dy / d, z: dz / d }, { maxDistance: d, includeLiquidBlocks: false, includePassableBlocks: false });
    return !hit;
  } catch { return false; }
}

// ---- what the world-changing effects may touch ------------------------------------------
/** Natural ground only.  Anything else (planks, bricks, glass, chests, beds, portals, redstone) is never changed. */
const SCORCH: Record<string, string> = {
  "minecraft:stone": "minecraft:smooth_basalt", "minecraft:andesite": "minecraft:smooth_basalt", "minecraft:diorite": "minecraft:smooth_basalt",
  "minecraft:granite": "minecraft:smooth_basalt", "minecraft:tuff": "minecraft:smooth_basalt", "minecraft:deepslate": "minecraft:smooth_basalt",
  "minecraft:calcite": "minecraft:smooth_basalt", "minecraft:dirt": "minecraft:coarse_dirt", "minecraft:grass_block": "minecraft:coarse_dirt",
  "minecraft:podzol": "minecraft:coarse_dirt", "minecraft:mycelium": "minecraft:coarse_dirt", "minecraft:moss_block": "minecraft:coarse_dirt",
  "minecraft:mud": "minecraft:packed_mud", "minecraft:clay": "minecraft:terracotta", "minecraft:snow": "minecraft:coarse_dirt",
};
const BREAKABLE = new Set<string>([...Object.keys(SCORCH), "minecraft:smooth_basalt", "minecraft:coarse_dirt", "minecraft:sand", "minecraft:red_sand", "minecraft:gravel"]);

export const scorchOf = (id: string): string | undefined => SCORCH[id];
export const isBreakableNatural = (id: string): boolean => BREAKABLE.has(id);

/** Ground that takes a furrow or a footprint, and what it becomes. */
const MARK: Record<string, string> = {
  "minecraft:grass_block": "minecraft:dirt", "minecraft:podzol": "minecraft:dirt", "minecraft:mycelium": "minecraft:dirt",
  "minecraft:moss_block": "minecraft:dirt", "minecraft:dirt": "minecraft:coarse_dirt",
};
const PRINT: Record<string, string> = {
  "minecraft:grass_block": "minecraft:mud", "minecraft:dirt": "minecraft:mud", "minecraft:podzol": "minecraft:mud",
  "minecraft:coarse_dirt": "minecraft:mud", "minecraft:mycelium": "minecraft:mud", "minecraft:moss_block": "minecraft:mud",
};
export const furrowOf = (id: string): string | undefined => MARK[id];
export const printOf = (id: string): string | undefined => PRINT[id];
