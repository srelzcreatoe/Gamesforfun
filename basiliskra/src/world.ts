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

const SOFT = /(^minecraft:(air|light_block.*|structure_void|short_grass|tall_grass|fern|large_fern|deadbush|seagrass|kelp|vine|.*_vines.*|snow_layer|.*carpet|.*torch|redstone_wire|.*_button|lever|.*rail|.*sapling|.*_flower|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|wheat|carrots|potatoes|beetroot|reeds|sugar_cane|bamboo_sapling|waterlily|.*sign|.*banner|.*pressure_plate|trip_?wire.*|ladder|scaffolding|fire|soul_fire|cobweb|web|.*mushroom|nether_wart|sweet_berry_bush|.*coral_fan.*|sea_pickle|frog_spawn|leaf_litter|bush|firefly_bush|cactus_flower|wildflowers|pink_petals)$)/;

/** Does this block hold up a giant's foot or stop a body?  Liquids and small plants do not. */
export function isSolidBlock(b: Block | undefined): boolean {
  if (!b) return false;
  if (b.isAir || b.isLiquid) return false;
  return !SOFT.test(b.typeId);
}

/** Trees and other growth: a giant shoulders through these, he does not go round them. */
const PLANT = /^minecraft:(?!stripped_)(.*_log|.*_wood|.*_stem|.*_hyphae|.*leaves.*|azalea|flowering_azalea|bamboo|cactus|melon_block|pumpkin|.*mushroom_block|mushroom_stem|mangrove_roots|bee_nest|chorus_plant|chorus_flower|pointed_dripstone|big_dripleaf|hanging_roots)$/;
/** Ground the world made.  Anything solid that is not this (and not growth) is treated as built. */
const NATURAL = /^minecraft:(stone|granite|diorite|andesite|deepslate|tuff|calcite|dirt|coarse_dirt|grass_block|podzol|mycelium|dirt_with_roots|mud|clay|sand|red_sand|gravel|suspicious_sand|suspicious_gravel|sandstone|red_sandstone|snow|ice|packed_ice|blue_ice|powder_snow|moss_block|pale_moss_block|hardened_clay|.*_terracotta|netherrack|basalt|smooth_basalt|blackstone|end_stone|dripstone_block|.*_ore|bedrock|obsidian|magma|soul_sand|soul_soil|muddy_mangrove_roots|amethyst_block|budding_amethyst|.*coral_block|cobbled_deepslate|packed_mud)$/;
export const isPlantBlock = (id: string): boolean => PLANT.test(id);
// his own marks on the world count as the world's ground (irradiated soil, scarlet trinitite)
export const isNaturalGround = (id: string): boolean => (NATURAL.test(id) && !id.includes("glazed")) || id === "basiliskra:irradiated_soil" || id === "basiliskra:scarlet_trinitite";

/**
 * Would a trunk `radius` wide standing at `at` (feet at feetY) be inside a wall?  Built blocks stop
 * him from `built` heights up, the world's own ground only from `cliff` up (lower rises he climbs),
 * and trees never do.  Unloaded columns do not answer.
 */
export function trunkBlocked(dim: Dimension, at: V3, feetY: number, radius: number, built: readonly number[], cliff: number, full: boolean, smash = false): boolean {
  const ring = full
    ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]]
    : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of ring) {
    const x = at.x + dx * radius, z = at.z + dz * radius;
    const top = blockAt(dim, { x, y: feetY + cliff, z });
    // smashing through, a built wall is not in his way however high: only the world's own rock is
    if (top && isSolidBlock(top) && !isPlantBlock(top.typeId) && (!smash || isNaturalGround(top.typeId))) return true;
    if (smash) continue;
    for (const h of built) {
      const b = blockAt(dim, { x, y: feetY + h, z });
      if (b && isSolidBlock(b) && !isPlantBlock(b.typeId) && !isNaturalGround(b.typeId)) return true;
    }
  }
  return false;
}

/** Is there water standing `depth` blocks above the floor at x,z?  One read. */
export function waterOver(dim: Dimension, x: number, z: number, floorY: number, depth: number): boolean {
  return isWaterId(idAt(dim, { x, y: floorY + depth, z }));
}

/** Is the water at x,z open from just under `surface` down `need` blocks?  A handful of reads. */
export function deepHere(dim: Dimension, x: number, z: number, surface: number, need: number): boolean | typeof UNLOADED {
  if (!isLoaded(dim, { x, y: surface, z })) return UNLOADED;
  for (let d = 1; d <= need; d++) if (!isWaterId(idAt(dim, { x, y: surface - d, z }))) return false;
  return true;
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
    // a canopy is not a floor: trunks and leaves are passed through, the ground is what is under them
    if (isSolidBlock(b) && !PLANT.test(b.typeId)) return y + 1;
  }
  return NONE;         // "no ground" is its own answer, never the bottom of the search
}

/**
 * Ground under a wide footprint: the lower median of nine column floors, so one tree or one
 * pit under a foot does not jolt the body.
 */
export function footprintY(dim: Dimension, at: V3, radius: number, yTop: number, depth: number, floatY: number | null = null): Probe {
  const ys: number[] = [];
  let unloaded = 0;
  for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) {
    const x = at.x + dx, z = at.z + dz;
    let g = groundY(dim, x, z, yTop, depth);
    // over water deeper than he stands in, the level he swims at is his floor
    if (floatY !== null && g !== UNLOADED && (g === NONE || (g as number) < floatY) && isWaterId(idAt(dim, { x, y: floatY, z }))) g = floatY;
    if (g === UNLOADED) unloaded++;
    else if (g !== NONE) ys.push(g as number);
  }
  if (unloaded > 4) return UNLOADED;
  if (ys.length < 3) return NONE;
  ys.sort((a, b) => a - b);
  return ys[Math.floor((ys.length - 1) / 2)];
}

/** Water column at x,z near y: surface (top of the top water block) and floor, or why not. */
export function waterColumn(dim: Dimension, x: number, z: number, y: number, reach = 24, deep = 64): { surface: number; floor: number } | typeof UNLOADED | typeof NONE {
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
  while (bottom > dim.heightRange.min + 1 && bottom > top - deep && isWaterId(idAt(dim, { x, y: bottom - 1, z }))) bottom--;
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
};
// (podzol, mycelium, moss, mud, clay and snow are left alone: a player can only bring those home with silk touch)
const BREAKABLE = new Set<string>([...Object.keys(SCORCH), "minecraft:smooth_basalt", "minecraft:coarse_dirt", "minecraft:sand", "minecraft:red_sand", "minecraft:gravel"]);

export const scorchOf = (id: string): string | undefined => SCORCH[id];
export const isBreakableNatural = (id: string): boolean => BREAKABLE.has(id);

/** Ground that takes a furrow or a footprint, and what it becomes. */
const MARK: Record<string, string> = { "minecraft:grass_block": "minecraft:dirt", "minecraft:dirt": "minecraft:coarse_dirt" };
const PRINT: Record<string, string> = { "minecraft:grass_block": "minecraft:mud", "minecraft:dirt": "minecraft:mud", "minecraft:coarse_dirt": "minecraft:mud" };
export const furrowOf = (id: string): string | undefined => MARK[id];
export const printOf = (id: string): string | undefined => PRINT[id];
/** What may lie on ground that takes a mark: nothing, or wild growth.  A carpet, a rail, a crop or redstone means somebody's floor. */
const WILD = /^minecraft:(air|short_grass|tall_grass|fern|large_fern|deadbush|snow_layer|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|leaf_litter|bush|firefly_bush|wildflowers|pink_petals)$/;
/** Open, unbuilt ground: the block above is empty or wild, and nothing built touches it on any side. */
export function takesMark(dim: Dimension, at: V3): Block | undefined {
  const b = blockAt(dim, at);
  if (!b) return undefined;
  const above = blockAt(dim, { x: at.x, y: at.y + 1, z: at.z });
  if (!above || !WILD.test(above.typeId)) return undefined;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, 1]) {
      const n = blockAt(dim, { x: at.x + dx, y: at.y + dy, z: at.z + dz });
      if (n && isSolidBlock(n) && !isNaturalGround(n.typeId) && !isPlantBlock(n.typeId)) return undefined;
    }
  }
  return b;
}
