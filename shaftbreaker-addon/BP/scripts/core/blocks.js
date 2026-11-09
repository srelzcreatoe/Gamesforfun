// @ts-check
// Block classification. Everything that edits the world goes through these whitelists, so the
// add-on never touches containers, beds, portals, redstone or other player builds by accident.

const PASSABLE = new Set([
  "minecraft:air", "minecraft:light_block", "minecraft:torch", "minecraft:soul_torch", "minecraft:redstone_torch",
  "minecraft:unlit_redstone_torch", "minecraft:copper_torch", "minecraft:short_grass", "minecraft:tall_grass",
  "minecraft:fern", "minecraft:large_fern", "minecraft:deadbush", "minecraft:dead_bush", "minecraft:vine",
  "minecraft:glow_lichen", "minecraft:sculk_vein", "minecraft:cave_vines", "minecraft:cave_vines_body_with_berries",
  "minecraft:cave_vines_head_with_berries", "minecraft:hanging_roots", "minecraft:moss_carpet", "minecraft:snow_layer",
  "minecraft:rail", "minecraft:golden_rail", "minecraft:detector_rail", "minecraft:activator_rail", "minecraft:lever",
  "minecraft:tripwire_hook", "minecraft:trip_wire", "minecraft:web", "minecraft:cobweb", "minecraft:ladder",
  "minecraft:redstone_wire", "minecraft:spore_blossom", "minecraft:small_dripleaf_block", "minecraft:seagrass",
  "minecraft:kelp", "minecraft:brown_mushroom", "minecraft:red_mushroom", "minecraft:sweet_berry_bush",
  "minecraft:structure_void", "minecraft:pink_petals", "minecraft:leaf_litter", "minecraft:wildflowers",
  "shaftbreaker:bloodroot_vines", "shaftbreaker:hanging_tissue", "shaftbreaker:crimson_thorns",
  "shaftbreaker:glowspore_cluster", "shaftbreaker:skull_pile", "shaftbreaker:dweller_droppings",
  "shaftbreaker:bloodmoss_carpet", "shaftbreaker:sinew_membrane", "shaftbreaker:bone_chime",
]);
const PASSABLE_SUFFIX = ["_carpet", "_button", "_pressure_plate", "_sign", "_banner", "_sapling", "_torch", "_flower",
  "light_block_0", "_tulip", "_coral_fan", "_wall_fan"];
const PASSABLE_PREFIX = ["minecraft:light_block"];

/** @param {string} id */
export function idPassable(id) {
  if (PASSABLE.has(id)) return true;
  for (const s of PASSABLE_SUFFIX) if (id.endsWith(s)) return true;
  for (const p of PASSABLE_PREFIX) if (id.startsWith(p)) return true;
  return false;
}

/** @param {import("@minecraft/server").Block | undefined} b */
export function passable(b) {
  if (!b) return false;
  try {
    if (b.isAir) return true;
    if (b.isLiquid) return true;
    return idPassable(b.typeId);
  } catch {
    return false;
  }
}

/** Solid enough to stand on / blocks movement. @param {import("@minecraft/server").Block | undefined} b */
export function solid(b) {
  if (!b) return false;
  try {
    if (b.isAir || b.isLiquid) return false;
    return !idPassable(b.typeId);
  } catch {
    return false;
  }
}

/** @param {import("@minecraft/server").Block | undefined} b */
export function isWater(b) {
  try { return !!b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water"); } catch { return false; }
}
/** @param {import("@minecraft/server").Block | undefined} b */
export function isLava(b) {
  try { return !!b && (b.typeId === "minecraft:lava" || b.typeId === "minecraft:flowing_lava"); } catch { return false; }
}

// Stone that turns into Veinstone inside the territory
export const INFECT_STONE = ["minecraft:stone", "minecraft:andesite", "minecraft:diorite", "minecraft:granite",
  "minecraft:tuff", "minecraft:calcite"];
export const INFECT_DEEP = ["minecraft:deepslate"];

const ORES = ["coal", "iron", "copper", "gold", "redstone", "lit_redstone", "lapis", "diamond", "emerald"];
export const NATURAL = new Set([
  ...INFECT_STONE, ...INFECT_DEEP, "minecraft:dirt", "minecraft:coarse_dirt", "minecraft:rooted_dirt", "minecraft:gravel",
  "minecraft:clay", "minecraft:dripstone_block", "minecraft:smooth_basalt", "minecraft:moss_block", "minecraft:mossy_cobblestone",
  "minecraft:sandstone", "minecraft:infested_stone", "minecraft:infested_deepslate",
  ...ORES.map((o) => `minecraft:${o}_ore`), ...ORES.map((o) => `minecraft:deepslate_${o}_ore`),
  "shaftbreaker:veinstone", "shaftbreaker:deep_veinstone", "shaftbreaker:cracked_veinstone", "shaftbreaker:scored_stone",
  "shaftbreaker:scored_deepslate", "shaftbreaker:fleshstone", "shaftbreaker:bloodmoss",
]);

/** Blocks that may be removed when carving the territory's caverns (natural terrain + loose cave decor). */
export const CARVABLE = [
  ...NATURAL, "minecraft:glow_lichen", "minecraft:pointed_dripstone", "minecraft:moss_carpet", "minecraft:cave_vines",
  "minecraft:cave_vines_body_with_berries", "minecraft:cave_vines_head_with_berries", "minecraft:hanging_roots",
  "minecraft:short_grass", "minecraft:sculk_vein", "minecraft:sand", "minecraft:red_sand",
].filter((v, i, a) => a.indexOf(v) === i);

// Basic building blocks the creature may smash through when allowed (mode 2)
const BASIC_BUILD = new Set(["minecraft:cobblestone", "minecraft:cobbled_deepslate", "minecraft:dirt", "minecraft:glass",
  "minecraft:sand", "minecraft:netherrack", "minecraft:mossy_cobblestone", "minecraft:gravel", "minecraft:cobblestone_slab",
  "minecraft:stone_bricks", "minecraft:deepslate_bricks", "minecraft:tuff_bricks"]);
const BASIC_SUFFIX = ["_planks", "_glass"];
const FLESH = new Set(["shaftbreaker:fleshstone", "shaftbreaker:pulsing_flesh", "shaftbreaker:sinew_membrane",
  "shaftbreaker:bloodmoss", "shaftbreaker:bloodmoss_carpet", "shaftbreaker:hanging_tissue", "shaftbreaker:bloodroot_vines"]);

/** @param {string} id @param {number} mode 0 none, 1 natural, 2 natural + basic builds */
export function breakable(id, mode) {
  if (mode <= 0) return false;
  if (NATURAL.has(id) || FLESH.has(id) || id === "minecraft:pointed_dripstone" || id === "shaftbreaker:dripfang") return true;
  if (mode >= 2) {
    if (BASIC_BUILD.has(id)) return true;
    for (const s of BASIC_SUFFIX) if (id.endsWith(s)) return true;
  }
  return false;
}

/** Natural stone where scratch marks can appear */
export function scorable(id) {
  return id === "minecraft:stone" || id === "minecraft:andesite" || id === "minecraft:tuff" || id === "minecraft:deepslate"
    || id === "shaftbreaker:veinstone" || id === "shaftbreaker:deep_veinstone" || id === "minecraft:diorite"
    || id === "minecraft:granite" || id === "shaftbreaker:scored_stone" || id === "shaftbreaker:scored_deepslate";
}

/** @param {string} id */
export function isWoodDoor(id) {
  return id.endsWith("_door") && !id.includes("iron") && !id.includes("trap");
}
/** @param {string} id */
export function isTorch(id) {
  return id === "minecraft:torch" || id === "minecraft:soul_torch" || id === "minecraft:copper_torch";
}

export const ORGAN_BLOCKS = new Set(["shaftbreaker:organ_core", "shaftbreaker:watcher_pod", "shaftbreaker:watcher_pod_open",
  "shaftbreaker:dwelling_heart"]);
export const FLESH_BLOCKS = FLESH;
