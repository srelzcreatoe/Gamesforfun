// Block palette for the build plan. Every name and state below is checked
// against Mojang's 1.26.50 block metadata by tools/validate_blocks.mjs.

const B = (name, states) => Object.freeze(states ? { name: `minecraft:${name}`, states: Object.freeze(states) } : { name: `minecraft:${name}` });

// Stairs: weirdo_direction 0 = ascending toward +X (east), 1 = -X, 2 = +Z (south), 3 = -Z (north).
const STAIR_DIR = { '+x': 0, '-x': 1, '+z': 2, '-z': 3 };
const stairs = (wood) => Object.fromEntries(Object.entries(STAIR_DIR).flatMap(([d, v]) => [
  [`${wood}_stairs${d}`, B(`${wood}_stairs`, { weirdo_direction: v, upside_down_bit: false })],
  [`${wood}_stairs${d}_top`, B(`${wood}_stairs`, { weirdo_direction: v, upside_down_bit: true })],
]));

// facing_direction: 0 down, 1 up, 2 north(-Z), 3 south(+Z), 4 west(-X), 5 east(+X)
const FACE = { down: 0, up: 1, north: 2, south: 3, west: 4, east: 5 };
const faced = (key, name, extra = {}) => Object.fromEntries(Object.entries(FACE).map(([f, v]) => [`${key}_${f}`, B(name, { facing_direction: v, ...extra })]));

export const PALETTE = Object.freeze({
  air: B('air'),
  barrier: B('barrier'),
  stone: B('stone'),
  dirt: B('dirt'),
  grass: B('grass_block'),
  coarse: B('coarse_dirt'),
  podzol: B('podzol'),
  gravel: B('gravel'),
  // concrete
  white_c: B('white_concrete'), black_c: B('black_concrete'), lgray_c: B('light_gray_concrete'), gray_c: B('gray_concrete'),
  red_c: B('red_concrete'), purple_c: B('purple_concrete'), yellow_c: B('yellow_concrete'), brown_c: B('brown_concrete'),
  orange_c: B('orange_concrete'), cyan_c: B('cyan_concrete'), lime_c: B('lime_concrete'), magenta_c: B('magenta_concrete'),
  lblue_c: B('light_blue_concrete'), blue_c: B('blue_concrete'), pink_c: B('pink_concrete'), green_c: B('green_concrete'),
  // terracotta
  white_t: B('white_terracotta'), black_t: B('black_terracotta'), red_t: B('red_terracotta'), lgray_t: B('light_gray_terracotta'),
  gray_t: B('gray_terracotta'), cyan_t: B('cyan_terracotta'), yellow_t: B('yellow_terracotta'), brown_t: B('brown_terracotta'),
  purple_t: B('purple_terracotta'), magenta_t: B('magenta_terracotta'), lime_t: B('lime_terracotta'), lblue_t: B('light_blue_terracotta'),
  orange_t: B('orange_terracotta'), terracotta: B('hardened_clay'),
  glazed_yellow: B('yellow_glazed_terracotta'), glazed_purple: B('purple_glazed_terracotta'), glazed_red: B('red_glazed_terracotta'),
  glazed_black: B('black_glazed_terracotta'), glazed_magenta: B('magenta_glazed_terracotta'), glazed_cyan: B('cyan_glazed_terracotta'),
  glazed_orange: B('orange_glazed_terracotta'), glazed_lime: B('lime_glazed_terracotta'),
  // wood
  dark_oak: B('dark_oak_planks'), spruce: B('spruce_planks'), oak: B('oak_planks'), birch: B('birch_planks'),
  dark_oak_log: B('dark_oak_log', { pillar_axis: 'y' }), stripped_dark_oak: B('stripped_dark_oak_log', { pillar_axis: 'y' }),
  quartz_slab_top: B('quartz_slab', { 'minecraft:vertical_half': 'top' }),
  dark_oak_slab: B('dark_oak_slab', { 'minecraft:vertical_half': 'bottom' }),
  dark_oak_slab_top: B('dark_oak_slab', { 'minecraft:vertical_half': 'top' }),
  spruce_slab_top: B('spruce_slab', { 'minecraft:vertical_half': 'top' }),
  smooth_stone_slab: B('smooth_stone_slab', { 'minecraft:vertical_half': 'bottom' }),
  smooth_stone_slab_top: B('smooth_stone_slab', { 'minecraft:vertical_half': 'top' }),
  ...stairs('dark_oak'),
  ...stairs('spruce'),
  ...stairs('stone_brick'),
  ...stairs('quartz'),
  // masonry
  stone_bricks: B('stone_bricks'), cracked_sb: B('cracked_stone_bricks'), mossy_sb: B('mossy_stone_bricks'),
  deepslate_bricks: B('deepslate_bricks'), deepslate_tiles: B('deepslate_tiles'), cracked_dt: B('cracked_deepslate_tiles'),
  polished_deepslate: B('polished_deepslate'), cobbled_deepslate: B('cobbled_deepslate'),
  smooth_stone: B('smooth_stone'), polished_andesite: B('polished_andesite'), andesite: B('andesite'),
  tuff: B('tuff'), polished_tuff: B('polished_tuff'), tuff_bricks: B('tuff_bricks'), calcite: B('calcite'),
  polished_blackstone: B('polished_blackstone'), pb_bricks: B('polished_blackstone_bricks'), blackstone: B('blackstone'),
  smooth_basalt: B('smooth_basalt'), bricks: B('brick_block'), mud_bricks: B('mud_bricks'),
  quartz: B('quartz_block'), smooth_quartz: B('smooth_quartz'), bone: B('bone_block', { pillar_axis: 'y' }),
  sb_wall: B('stone_brick_wall'), cobble_wall: B('cobblestone_wall'),
  // metal
  iron_block: B('iron_block'), iron_bars: B('iron_bars'), iron_chain: B('iron_chain', { pillar_axis: 'y' }),
  copper: B('copper_block'), wcopper: B('weathered_copper'), ocopper: B('oxidized_copper'),
  wcopper_grate: B('waxed_weathered_copper_grate'), heavy_core: B('heavy_core'),
  iron_trapdoor_closed: B('iron_trapdoor', { direction: 0, open_bit: false, upside_down_bit: true }),
  iron_trapdoor_open: B('iron_trapdoor', { direction: 0, open_bit: true, upside_down_bit: true }),
  // glass
  glass: B('glass'), glass_pane: B('glass_pane'), tinted_glass: B('tinted_glass'),
  black_sg: B('black_stained_glass'), white_sg: B('white_stained_glass'), gray_sg_pane: B('gray_stained_glass_pane'),
  // light
  ...Object.fromEntries(Array.from({ length: 16 }, (_, n) => [`light_${n}`, B(`light_block_${n}`)])),
  sea_lantern: B('sea_lantern'), glowstone: B('glowstone'), shroomlight: B('shroomlight'),
  lantern_hang: B('lantern', { hanging: true }), soul_lantern_hang: B('soul_lantern', { hanging: true }), lantern: B('lantern', { hanging: false }),
  ochre: B('ochre_froglight', { pillar_axis: 'y' }), verdant: B('verdant_froglight', { pillar_axis: 'y' }), pearl: B('pearlescent_froglight', { pillar_axis: 'y' }),
  redstone_lamp: B('redstone_lamp'),
  end_rod_down: B('end_rod', { facing_direction: 0 }),
  // furniture & props
  barrel: B('barrel', { facing_direction: 1, open_bit: false }), cauldron: B('cauldron'),
  furnace: B('furnace', { 'minecraft:cardinal_direction': 'south' }), smoker: B('smoker', { 'minecraft:cardinal_direction': 'north' }),
  crafting_table: B('crafting_table'), bookshelf: B('bookshelf'), loom: B('loom', { direction: 0 }),
  observer: B('observer', { 'minecraft:facing_direction': 'up', powered_bit: false }), jukebox: B('jukebox'), noteblock: B('noteblock'),
  cake: B('cake', { bite_counter: 0 }), cake_bitten: B('cake', { bite_counter: 3 }), flower_pot: B('flower_pot'),
  decorated_pot: B('decorated_pot'), hopper: B('hopper', { facing_direction: 0, toggle_bit: false }),
  anvil: B('anvil', { 'minecraft:cardinal_direction': 'south' }), target: B('target'), hay: B('hay_block', { pillar_axis: 'y' }),
  web: B('web'), ladder_north: B('ladder', { facing_direction: 2 }), ladder_south: B('ladder', { facing_direction: 3 }),
  ladder_west: B('ladder', { facing_direction: 4 }), ladder_east: B('ladder', { facing_direction: 5 }),
  dark_oak_fence: B('dark_oak_fence'), oak_fence: B('oak_fence'), nether_fence: B('nether_brick_fence'),
  packed_ice: B('packed_ice'), blue_ice: B('blue_ice'), snow: B('snow'),
  gold: B('gold_block'), raw_gold: B('raw_gold_block'), gilded: B('gilded_blackstone'), crying_obsidian: B('crying_obsidian'),
  amethyst: B('amethyst_block'), purpur: B('purpur_block'),
  oak_leaves: B('oak_leaves', { persistent_bit: true, update_bit: false }),
  // seasonal decorations (data/holiday_decor.generated.js, mc/holidays.js)
  jack_north: B('lit_pumpkin', { 'minecraft:cardinal_direction': 'north' }), jack_south: B('lit_pumpkin', { 'minecraft:cardinal_direction': 'south' }),
  jack_east: B('lit_pumpkin', { 'minecraft:cardinal_direction': 'east' }), jack_west: B('lit_pumpkin', { 'minecraft:cardinal_direction': 'west' }),
  pumpkin: B('pumpkin', { 'minecraft:cardinal_direction': 'south' }),
  spruce_leaves: B('spruce_leaves', { persistent_bit: true, update_bit: false }), spruce_log: B('spruce_log', { pillar_axis: 'y' }),
  green_wool: B('green_wool'), dark_oak_log_x: B('dark_oak_log', { pillar_axis: 'x' }),
  deadbush: B('deadbush'), brewing_stand: B('brewing_stand', { brewing_stand_slot_a_bit: false, brewing_stand_slot_b_bit: false, brewing_stand_slot_c_bit: false }),
  // carpets & wool
  white_carpet: B('white_carpet'), red_carpet: B('red_carpet'), black_carpet: B('black_carpet'), purple_carpet: B('purple_carpet'),
  yellow_carpet: B('yellow_carpet'), gray_carpet: B('gray_carpet'), lgray_carpet: B('light_gray_carpet'), blue_carpet: B('blue_carpet'),
  cyan_carpet: B('cyan_carpet'), brown_carpet: B('brown_carpet'),
  white_wool: B('white_wool'), red_wool: B('red_wool'), purple_wool: B('purple_wool'), yellow_wool: B('yellow_wool'),
  brown_wool: B('brown_wool'), black_wool: B('black_wool'), orange_wool: B('orange_wool'), blue_wool: B('blue_wool'),
  lime_wool: B('lime_wool'), magenta_wool: B('magenta_wool'), gray_wool: B('gray_wool'),
  // controls (placed after the command-block structures)
  button_up: B('stone_button', { facing_direction: 1, button_pressed_bit: false }),
  dark_button_up: B('polished_blackstone_button', { facing_direction: 1, button_pressed_bit: false }),
  lever_up: B('lever', { lever_direction: 'up_north_south', open_bit: false }),
  plate: B('stone_pressure_plate', { redstone_signal: 0 }),
  // decorative buttons used as "eyes" on spare heads (no command block behind them)
  ...faced('eye_button', 'stone_button', { button_pressed_bit: false }),
  // signs
  ...faced('sign', 'darkoak_wall_sign'),
  ...faced('sign_spruce', 'spruce_wall_sign'),
  // consoles (pedestals that carry the input buttons; all solid, conductive)
  console_red: B('red_terracotta'), console_white: B('white_concrete'), console_dark: B('polished_deepslate'),
  console_gold: B('yellow_terracotta'), console_strobe: B('orange_terracotta'), console_green: B('lime_terracotta'),
  console_map: B('gray_concrete'), console_hidden: B('spruce_planks'),
  // indicator lamps (set by command-block actuators)
  ind_ok: B('verdant_froglight', { pillar_axis: 'y' }), ind_warn: B('ochre_froglight', { pillar_axis: 'y' }),
  ind_off: B('gray_concrete'), ind_fault: B('red_concrete'),
});

export const STAIR_KEY = (material, dir, top = false) => `${material}_stairs${dir}${top ? '_top' : ''}`;
export const FACING = FACE;
