// @ts-check
/** Block classification used by perception, navigation sampling and grief protection. */

const P = 'minecraft:';
const set = (...ids) => new Set(ids.map((i) => (i.includes(':') ? i : P + i)));

export const AIR = set('air', 'structure_void', ...Array.from({ length: 16 }, (_, i) => `light_block_${i}`));

/** non-solid blocks an entity (or a gaze) can pass through */
export const SOFT = set(
  'short_grass', 'tall_grass', 'fern', 'large_fern', 'deadbush', 'glow_lichen', 'vine', 'cave_vines', 'cave_vines_body_with_berries',
  'cave_vines_head_with_berries', 'weeping_vines', 'twisting_vines', 'hanging_roots', 'spore_blossom', 'moss_carpet', 'sculk_vein',
  'torch', 'soul_torch', 'redstone_torch', 'unlit_redstone_torch', 'copper_torch', 'rail', 'golden_rail', 'detector_rail', 'activator_rail',
  'lever', 'stone_button', 'wooden_button', 'trip_wire', 'tripwire_hook', 'redstone_wire', 'snow_layer', 'ladder', 'scaffolding',
  'brown_mushroom', 'red_mushroom', 'small_dripleaf_block', 'pink_petals', 'leaf_litter', 'firefly_bush', 'bush', 'short_dry_grass', 'tall_dry_grass',
  'resin_clump', 'pale_hanging_moss', 'seagrass', 'kelp', 'frame', 'glow_frame', 'structure_void', 'web', 'pale_moss_carpet',
);

export const LIQUID = set('water', 'flowing_water', 'lava', 'flowing_lava');
export const DAMAGING = set('lava', 'flowing_lava', 'magma', 'fire', 'soul_fire', 'campfire', 'soul_campfire', 'sweet_berry_bush',
  'cactus', 'powder_snow', 'wither_rose', 'pointed_dripstone');

/** natural cave/terrain material the Breaker may move (never player builds, never ores) */
export const NATURAL_BREAKABLE = set('stone', 'deepslate', 'tuff', 'granite', 'diorite', 'andesite', 'calcite', 'dripstone_block',
  'dirt', 'coarse_dirt', 'dirt_with_roots', 'gravel', 'clay', 'moss_block', 'web', 'infested_stone', 'infested_deepslate', 'sand', 'red_sand');

export const MINESHAFT_WOOD = set('oak_planks', 'oak_fence', 'dark_oak_planks', 'dark_oak_fence', 'web');

export const ORES = set('coal_ore', 'iron_ore', 'copper_ore', 'gold_ore', 'redstone_ore', 'lit_redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore',
  'deepslate_coal_ore', 'deepslate_iron_ore', 'deepslate_copper_ore', 'deepslate_gold_ore', 'deepslate_redstone_ore', 'lit_deepslate_redstone_ore',
  'deepslate_lapis_ore', 'deepslate_diamond_ore', 'deepslate_emerald_ore', 'raw_iron_block', 'raw_copper_block', 'raw_gold_block');

/** everything that can appear in an untouched cave; anything else nearby is treated as a player build */
export const NATURAL = new Set([...AIR, ...SOFT, ...LIQUID, ...NATURAL_BREAKABLE, ...ORES, ...set(
  'bedrock', 'obsidian', 'magma', 'amethyst_block', 'budding_amethyst', 'amethyst_cluster', 'large_amethyst_bud', 'medium_amethyst_bud',
  'small_amethyst_bud', 'smooth_basalt', 'pointed_dripstone', 'sculk', 'sculk_sensor', 'sculk_catalyst', 'sculk_shrieker', 'azalea', 'flowering_azalea',
  'big_dripleaf', 'small_dripleaf_block', 'mossy_cobblestone', 'cobblestone', 'grass_block', 'podzol', 'mycelium', 'snow', 'ice', 'packed_ice',
  'blue_ice', 'sandstone', 'red_sandstone', 'hardened_clay', 'white_terracotta', 'orange_terracotta', 'yellow_terracotta', 'brown_terracotta',
  'red_terracotta', 'light_gray_terracotta', 'oak_log', 'oak_planks', 'oak_fence', 'dark_oak_log', 'dark_oak_planks', 'dark_oak_fence',
  'mud', 'packed_mud', 'water', 'lava', 'glow_lichen', 'brown_mushroom_block', 'red_mushroom_block', 'mushroom_stem', 'rail',
)]);
// note: cobblestone/mossy cobblestone/planks appear in natural structures too, so they count as "natural" for the
// neighbourhood test but are NOT in NATURAL_BREAKABLE (the creature never breaks them).

/** containers, spawn infrastructure and valuables: never touched, and their neighbourhood is protected */
export const PROTECTED_HINTS = ['chest', 'barrel', 'shulker', 'bed', 'furnace', 'smoker', 'crafting', 'anvil', 'enchanting', 'brewing',
  'portal', 'respawn_anchor', 'lodestone', 'beacon', 'spawner', 'vault', 'trial', 'hopper', 'dispenser', 'dropper', 'sign', 'banner',
  'lectern', 'jukebox', 'decorated_pot', 'crafter', 'ender_chest', 'conduit', 'campfire', 'composter', 'cauldron', 'bell'];

export const LIGHT_SOURCES = set('torch', 'soul_torch', 'copper_torch', 'lantern', 'soul_lantern', 'copper_lantern', 'glowstone', 'sea_lantern',
  'shroomlight', 'lit_pumpkin', 'campfire', 'soul_campfire', 'end_rod', 'ochre_froglight', 'verdant_froglight', 'pearlescent_froglight',
  'redstone_lamp', 'lit_redstone_lamp', 'beacon', 'candle');

export const TORCHES = set('torch', 'soul_torch', 'copper_torch');

export const MEATS = set('beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'rotten_flesh', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken');

export function isAirId(id) { return AIR.has(id); }
export function isLiquidId(id) { return LIQUID.has(id); }
/** can a body occupy this cell? */
export function isPassableId(id) { return AIR.has(id) || id.endsWith('#open') || SOFT.has(id) || id === 'shaftbreaker:den_dust' || id === 'shaftbreaker:den_spine' || id.endsWith('_carpet') || id.endsWith('_button') || id.endsWith('pressure_plate'); }
/** does it block a line of sight? (glass and leaves are see-through) */
export function blocksSight(id) {
  if (isPassableId(id) || LIQUID.has(id)) return false;
  if (id.includes('glass') || id.includes('leaves') || id.includes('fence') || id.includes('bars') || id.includes('chain')) return false;
  return true;
}
/** a block you can stand on */
export function isSolidFloorId(id) {
  if (isPassableId(id) || LIQUID.has(id)) return false;
  if (DAMAGING.has(id)) return false;
  return true;
}
export function isWoodenDoorId(id) { return id.endsWith('_door') && !id.includes('iron') && !id.includes('copper'); }
export function isProtectedId(id) { return PROTECTED_HINTS.some((h) => id.includes(h)); }
export function isPlayerMadeHint(id) { return !NATURAL.has(id) && !id.startsWith('shaftbreaker:'); }

export function oreForDepth(y) {
  if (y < 0) return Math.random() < 0.6 ? 'minecraft:deepslate_iron_ore' : 'minecraft:deepslate_copper_ore';
  return Math.random() < 0.5 ? 'minecraft:iron_ore' : Math.random() < 0.5 ? 'minecraft:coal_ore' : 'minecraft:copper_ore';
}
