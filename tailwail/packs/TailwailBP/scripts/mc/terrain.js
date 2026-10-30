// Block classification and clearance scans.  The stable API has no "isSolid", so
// walkable space is classified with an explicit passable list; line of sight uses the
// engine's own ray test (Dimension.getBlockFromRay), see mc/perception.js.

const PASSABLE = new Set([
  "minecraft:air", "minecraft:cave_air", "minecraft:void_air", "minecraft:light_block",
  "minecraft:short_grass", "minecraft:tall_grass", "minecraft:fern", "minecraft:large_fern", "minecraft:deadbush",
  "minecraft:dead_bush", "minecraft:snow_layer", "minecraft:vine", "minecraft:glow_lichen", "minecraft:sculk_vein",
  "minecraft:hanging_roots", "minecraft:cave_vines", "minecraft:cave_vines_body_with_berries",
  "minecraft:cave_vines_head_with_berries", "minecraft:torch", "minecraft:soul_torch", "minecraft:redstone_torch",
  "minecraft:copper_torch", "minecraft:redstone_wire", "minecraft:rail", "minecraft:golden_rail", "minecraft:detector_rail",
  "minecraft:activator_rail", "minecraft:lever", "minecraft:tripwire", "minecraft:trip_wire", "minecraft:tripwire_hook",
  "minecraft:moss_carpet", "minecraft:pink_petals", "minecraft:sugar_cane", "minecraft:spore_blossom",
  "minecraft:small_dripleaf_block", "minecraft:seagrass", "minecraft:brown_mushroom", "minecraft:red_mushroom",
  "minecraft:crimson_roots", "minecraft:warped_roots", "minecraft:nether_sprouts", "minecraft:structure_void",
  "minecraft:leaf_litter", "minecraft:wildflowers", "minecraft:bush", "minecraft:firefly_bush", "minecraft:short_dry_grass",
  "minecraft:tall_dry_grass", "minecraft:resin_clump",
]);
const PASSABLE_RE = [/_button$/, /_pressure_plate$/, /_carpet$/, /_sign$/, /_banner$/, /_sapling$/, /_torch$/,
  /^minecraft:(dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|torchflower|pitcher_plant|sunflower|lilac|rose_bush|peony|open_eyeblossom|closed_eyeblossom)$/];
const DANGER = new Set([
  "minecraft:lava", "minecraft:flowing_lava", "minecraft:magma", "minecraft:fire", "minecraft:soul_fire",
  "minecraft:campfire", "minecraft:soul_campfire", "minecraft:cactus", "minecraft:sweet_berry_bush",
  "minecraft:powder_snow", "minecraft:pointed_dripstone", "minecraft:wither_rose", "minecraft:sculk_shrieker",
]);
// blocks a player can see through; rays continue past them
const SEE_THROUGH_RE = [/glass/, /iron_bars$/, /_fence$/, /^minecraft:chain$/, /scaffolding$/, /ladder$/, /^minecraft:barrier$/];

export function isPassableId(id) {
  if (PASSABLE.has(id)) return true;
  for (const re of PASSABLE_RE) if (re.test(id)) return true;
  return false;
}
export const isDangerId = (id) => DANGER.has(id);
export function isSeeThroughId(id) {
  for (const re of SEE_THROUGH_RE) if (re.test(id)) return true;
  return false;
}

export function safeBlock(dim, pos) {
  try {
    return dim.getBlock(pos);
  } catch {
    return undefined;
  }
}

/** Air-like for clearance: passable and not liquid. Unloaded counts as blocked. */
export function isOpen(block) {
  if (!block) return false;
  if (block.isLiquid) return false;
  return block.isAir || isPassableId(block.typeId);
}

/** Something a creature can stand on. */
export function isFloor(block) {
  if (!block || block.isAir || block.isLiquid) return false;
  const id = block.typeId;
  return !isPassableId(id) && !isDangerId(id);
}

/** Clear blocks above the floor at an integer column position (feet block = pos.y). Max 8. */
export function headroom(dim, pos, max = 8) {
  const x = Math.floor(pos.x);
  const z = Math.floor(pos.z);
  const y0 = Math.floor(pos.y);
  let n = 0;
  for (let y = y0; y < y0 + max; y++) {
    if (!isOpen(safeBlock(dim, { x, y, z }))) break;
    n++;
  }
  return n;
}

/**
 * Finds standable ground in a column near `aroundY`.  Returns {x, y, z, head} where y is the
 * feet block, or null.  Scans from top to bottom so ledges above the start are preferred less.
 */
export function findGround(dim, x, z, aroundY, up = 4, down = 6, minHead = 2) {
  const bx = Math.floor(x);
  const bz = Math.floor(z);
  const top = Math.floor(aroundY) + up;
  const bottom = Math.floor(aroundY) - down;
  let above = safeBlock(dim, { x: bx, y: top + 1, z: bz });
  let cur = safeBlock(dim, { x: bx, y: top, z: bz });
  if (cur === undefined) return null; // unloaded column
  for (let y = top; y > bottom; y--) {
    const below = safeBlock(dim, { x: bx, y: y - 1, z: bz });
    if (isOpen(cur) && isFloor(below)) {
      const head = headroom(dim, { x: bx, y, z: bz });
      if (head >= minHead) {
        // reject spots next to lava / inside fluids
        return { x: bx + 0.5, y, z: bz + 0.5, head };
      }
    }
    above = cur;
    cur = below;
  }
  return null;
}
