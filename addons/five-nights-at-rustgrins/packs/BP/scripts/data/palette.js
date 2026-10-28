// Block palette for the build plan and the runtime actuators.
// Every vanilla name and state below is checked against Mojang's 1.26.50
// block metadata, and every fnar:* block against packs/BP/blocks, by
// tools/validate_blocks.mjs.

const B = (name, states) => Object.freeze(states ? { name, states: Object.freeze(states) } : { name });
const M = (name, states) => B(`minecraft:${name}`, states);
const F = (name, states) => B(`fnar:${name}`, states);

// Stairs: weirdo_direction 0 = ascending toward +X (east), 1 = -X, 2 = +Z (south), 3 = -Z (north).
const STAIR_DIR = { e: 0, w: 1, s: 2, n: 3 };
const stairs = (key, name) => Object.fromEntries(Object.entries(STAIR_DIR).flatMap(([d, v]) => [
  [`${key}_stairs_${d}`, M(`${name}_stairs`, { weirdo_direction: v, upside_down_bit: false, 'minecraft:corner': 'none' })],
  [`${key}_stairs_${d}_top`, M(`${name}_stairs`, { weirdo_direction: v, upside_down_bit: true, 'minecraft:corner': 'none' })],
]));
const slabs = (key, name) => ({
  [`${key}_slab`]: M(`${name}_slab`, { 'minecraft:vertical_half': 'bottom' }),
  [`${key}_slab_top`]: M(`${name}_slab`, { 'minecraft:vertical_half': 'top' }),
});

/** facing_direction: 0 down, 1 up, 2 north(-Z), 3 south(+Z), 4 west(-X), 5 east(+X). */
export const FACING = Object.freeze({ down: 0, up: 1, n: 2, s: 3, w: 4, e: 5 });
const faced = (key, name, extra = {}) => Object.fromEntries(['n', 's', 'w', 'e'].map((f) => [`${key}_${f}`, M(name, { facing_direction: FACING[f], ...extra })]));
/** Custom blocks with minecraft:cardinal_direction (the direction the front faces). */
const CARD = { n: 'north', s: 'south', w: 'west', e: 'east' };
const card = (key, name, extra = {}) => Object.fromEntries(Object.entries(CARD).map(([k, v]) => [`${key}_${k}`, F(name, { 'minecraft:cardinal_direction': v, ...extra })]));
const cardStates = (key, name, state, values, extra = {}) => Object.fromEntries(values.flatMap((val) => Object.entries(CARD).map(([k, v]) => [`${key}${val === undefined ? '' : `_${val}`}_${k}`, F(name, { 'minecraft:cardinal_direction': v, [state]: val, ...extra })])));
// iron trapdoor direction: 0 = east... (only used closed/flat as a vent grate texture on floors and ceilings)

export const PALETTE = Object.freeze({
  air: M('air'),
  barrier: M('barrier'),
  light0: M('light_block_0'),
  ...Object.fromEntries([3, 5, 7, 9, 10, 11, 12, 13, 14, 15].map((n) => [`light${n}`, M(`light_block_${n}`)])),

  // ---------------------------------------------------------------- ground / exterior
  stone: M('stone'), dirt: M('dirt'), grass: M('grass_block'), coarse: M('coarse_dirt'), gravel: M('gravel'),
  asphalt: M('black_concrete_powder'), asphalt2: M('gray_concrete_powder'), curb: M('smooth_stone'),
  paint_line: M('white_concrete'), paint_yellow: M('yellow_concrete'),
  sidewalk: M('smooth_stone'), sidewalk_slab: M('smooth_stone_slab', { 'minecraft:vertical_half': 'bottom' }),
  tall_grass: M('short_grass'),
  fence_dark: M('dark_oak_fence'), fence_iron: M('iron_bars'),
  sea_lantern: M('sea_lantern'), lamp_post: M('polished_blackstone_wall'),

  // ---------------------------------------------------------------- shell
  foundation: M('polished_andesite'), roof: M('gray_concrete'), roof_edge: M('polished_blackstone_bricks'),
  ext_wall: M('brick_block'), ext_wall2: M('mud_bricks'), ext_trim: M('polished_blackstone'), ext_band: M('red_terracotta'),
  ext_base: M('polished_blackstone_bricks'),
  int_core: M('gray_concrete'), // hidden wall core
  window: M('glass_pane'), window_tint: M('tinted_glass'), glass: M('glass'),
  iron_bars: M('iron_bars'),

  // ---------------------------------------------------------------- vanilla interior
  black_c: M('black_concrete'), white_c: M('white_concrete'), gray_c: M('gray_concrete'), lgray_c: M('light_gray_concrete'),
  red_c: M('red_concrete'), purple_c: M('purple_concrete'), yellow_c: M('yellow_concrete'), blue_c: M('blue_concrete'),
  red_t: M('red_terracotta'), black_t: M('black_terracotta'), gray_t: M('gray_terracotta'), white_t: M('white_terracotta'),
  brown_t: M('brown_terracotta'), purple_t: M('purple_terracotta'),
  red_wool: M('red_wool'), white_wool: M('white_wool'), purple_wool: M('purple_wool'), black_wool: M('black_wool'), gray_wool: M('gray_wool'),
  red_carpet: M('red_carpet'), white_carpet: M('white_carpet'), purple_carpet: M('purple_carpet'), black_carpet: M('black_carpet'),
  gray_carpet: M('gray_carpet'), lgray_carpet: M('light_gray_carpet'), brown_carpet: M('brown_carpet'),
  dark_oak: M('dark_oak_planks'), spruce: M('spruce_planks'), oak: M('oak_planks'),
  dark_oak_log: M('dark_oak_log', { pillar_axis: 'y' }), stripped_dark_oak: M('stripped_dark_oak_log', { pillar_axis: 'y' }),
  stripped_dark_oak_x: M('stripped_dark_oak_log', { pillar_axis: 'x' }), stripped_dark_oak_z: M('stripped_dark_oak_log', { pillar_axis: 'z' }),
  smooth_stone: M('smooth_stone'), stone_bricks: M('stone_bricks'), cracked_bricks: M('cracked_stone_bricks'),
  polished_andesite: M('polished_andesite'), polished_deepslate: M('polished_deepslate'), deepslate_tiles: M('deepslate_tiles'),
  polished_tuff: M('polished_tuff'), tuff_bricks: M('tuff_bricks'),
  blackstone: M('polished_blackstone'), blackstone_bricks: M('polished_blackstone_bricks'),
  iron_block: M('iron_block'), gold_block: M('gold_block'), smooth_quartz: M('smooth_quartz'), quartz_pillar: M('quartz_pillar', { pillar_axis: 'y' }),
  anvil: M('damaged_anvil', { 'minecraft:cardinal_direction': 'north' }),
  bookshelf: M('bookshelf'), cauldron: M('cauldron'), smoker_n: M('smoker', { 'minecraft:cardinal_direction': 'north' }),
  smoker_s: M('smoker', { 'minecraft:cardinal_direction': 'south' }), blast_s: M('blast_furnace', { 'minecraft:cardinal_direction': 'south' }),
  furnace_s: M('furnace', { 'minecraft:cardinal_direction': 'south' }),
  chain_y: M('iron_chain', { pillar_axis: 'y' }), chain_x: M('iron_chain', { pillar_axis: 'x' }), chain_z: M('iron_chain', { pillar_axis: 'z' }),
  lantern_hang: M('lantern', { hanging: true }), lantern: M('lantern', { hanging: false }),
  cake: M('cake', { bite_counter: 2 }), cake_full: M('cake', { bite_counter: 0 }),
  flower_pot: M('flower_pot'),
  hopper: M('hopper', { facing_direction: 0, toggle_bit: false }),
  ...slabs('smooth_stone', 'smooth_stone'), ...slabs('dark_oak', 'dark_oak'), ...slabs('spruce', 'spruce'),
  ...slabs('quartz', 'quartz'), ...slabs('andesite', 'polished_andesite'), ...slabs('blackstone', 'polished_blackstone'),
  ...stairs('dark_oak', 'dark_oak'), ...stairs('blackstone', 'polished_blackstone'), ...stairs('quartz', 'quartz'),
  ...faced('barrel', 'barrel', { open_bit: false }),
  ...faced('sign', 'darkoak_wall_sign'),
  ...faced('button', 'polished_blackstone_button', { button_pressed_bit: false }),
  iron_trapdoor_floor: M('iron_trapdoor', { direction: 0, open_bit: false, upside_down_bit: false }),
  iron_trapdoor_ceiling: M('iron_trapdoor', { direction: 0, open_bit: false, upside_down_bit: true }),
  dark_trapdoor_top: M('dark_oak_trapdoor', { direction: 0, open_bit: false, upside_down_bit: true }),
  ...Object.fromEntries(Object.entries({ e: 'east', w: 'west', n: 'north', s: 'south' }).flatMap(([k, d]) => [
    [`iron_door_${k}`, M('iron_door', { 'minecraft:cardinal_direction': d, open_bit: false, door_hinge_bit: false, upper_block_bit: false })],
    [`iron_door_${k}_top`, M('iron_door', { 'minecraft:cardinal_direction': d, open_bit: false, door_hinge_bit: false, upper_block_bit: true })],
  ])),

  // ---------------------------------------------------------------- fnar surfaces (docs/BLOCKS.md A)
  tile: F('tile_checker'), tile_worn: F('tile_checker_worn'), tile_office: F('tile_office'), tile_kitchen: F('tile_kitchen'),
  wall_checker: F('wall_checker'), plaster: F('wall_plaster'), plaster_stained: F('wall_plaster_stained'),
  wallpaper: F('wallpaper_maroon'), trim: F('wall_trim'), cinder: F('cinderblock_painted'),
  ceiling: F('ceiling_tile'), ceiling_stained: F('ceiling_tile_stained'),
  carpet: F('carpet_party'), curtain_purple: F('curtain_purple'), curtain_red: F('curtain_red'), tent: F('tent_stripe'),
  duct: F('duct_metal'), stage_floor: F('stage_floor'),
  shutter: F('door_shutter', { 'fnar:part': 0 }), shutter_bottom: F('door_shutter', { 'fnar:part': 1 }),
  lamp_on: F('ceiling_lamp', { 'fnar:lit': true }), lamp_off: F('ceiling_lamp', { 'fnar:lit': false }),
  ...cardStates('exit', 'exit_sign', 'fnar:lit', [true]),
  ...cardStates('sconce', 'wall_sconce', 'fnar:lit', [true, false]),
  ...cardStates('spot', 'stage_spotlight', 'fnar:lit', [true, false]),
  hanging_on: F('hanging_lamp', { 'fnar:lit': true }), hanging_off: F('hanging_lamp', { 'fnar:lit': false }),

  // ---------------------------------------------------------------- fnar props (docs/BLOCKS.md B)
  ...cardStates('door_btn', 'door_button', 'fnar:on', [false, true]),
  ...cardStates('light_btn', 'light_button', 'fnar:on', [false, true]),
  vent_open: F('vent_cover', { 'fnar:closed': false }), vent_closed: F('vent_cover', { 'fnar:closed': true }),
  ...cardStates('crt', 'crt_monitor', 'fnar:on', [true, false]),
  ...card('fan', 'desk_fan'),
  ...cardStates('phone', 'desk_phone', 'fnar:ringing', [false, true]),
  ...card('clutter', 'desk_clutter'),
  ...card('plush', 'plush_rat'),
  ...cardStates('table', 'party_table', 'fnar:part', [0, 1, 2]),
  ...card('chair', 'party_chair'),
  ...Object.fromEntries([0, 1, 2, 3].map((c) => [`hat_${c}`, F('party_hat', { 'fnar:color': c })])),
  ...cardStates('pizza', 'pizza_box', 'fnar:count', [1, 2, 3]),
  plates: F('plate_set'),
  ...Object.fromEntries([0, 1, 2].map((c) => [`balloons_${c}`, F('balloons', { 'fnar:color': c })])),
  ...card('bunting', 'bunting'),
  ...cardStates('arcade', 'arcade_cabinet', 'fnar:half', [0, 1]),
  ...cardStates('tape', 'show_tape', 'fnar:level', [0, 1, 2, 3, 4]),
  ...card('cctv', 'security_camera'),
  ...card('pa', 'pa_speaker'),
  ...card('speaker', 'stage_speaker'),
  ...card('amp', 'guitar_amp'),
  ...card('timeclock', 'time_clock'),
  ...card('star', 'stage_star'),
  ...card('wetsign', 'wet_floor_sign'),
  ...card('mop', 'mop_bucket'),
  ...card('trash', 'trash_can'),
  ...card('shelf', 'parts_shelf'),
  ...card('toilet', 'toilet'),
  ...card('sink', 'sink'),
  ...cardStates('locker', 'locker', 'fnar:half', [0, 1]),
});

/** Picture panels (docs/BLOCKS.md A): name -> [tiles wide, tiles high]. Keys are generated as `${name}_${tile}_${dir}`. */
export const PICTURES = Object.freeze({
  poster_revue: [2, 3], poster_party: [2, 2], poster_cabaret: [2, 3], poster_midway: [2, 3], poster_rules: [2, 2],
  poster_missing: [1, 2], drawing: [1, 1], sign_cabaret: [3, 1], sign_out_of_order: [2, 1], sign_midway: [4, 1],
  sign_revue: [6, 2], sign_staff: [1, 1],
});
/** Variant counts for 1x1 pictures that use fnar:tile as a variant index. */
export const PICTURE_VARIANTS = Object.freeze({ drawing: 6, sign_staff: 4 });

/** Palette entry for one picture tile (built on demand, not stored in PALETTE). */
export function pictureBlock(name, tile, dir) {
  return F(name, { 'minecraft:cardinal_direction': CARD[dir], 'fnar:tile': tile });
}
