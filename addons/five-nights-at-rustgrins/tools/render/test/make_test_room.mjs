// Generates tools/render/test/test_room.json: a small pizzeria-like test building that exercises every
// block shape the renderer supports, the lighting cases (lit / unlit / coloured / invisible light
// blocks / sky light / dark corners) and the synthetic custom blocks from test/fixtures (fnartest:*).
// Real fnar:* blocks found in packs/BP/blocks are placed in a showcase row (zone E) when present.
// Usage: node tools/render/test/make_test_room.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoxelBuilder } from './voxels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SIZE = [44, 14, 40];
const ORIGIN = [-22, 60, -16];
const v = new VoxelBuilder(SIZE, ORIGIN);
const B = (x, y, z, n, s) => v.set(x, y, z, n, s);
const F = (x0, y0, z0, x1, y1, z1, n, s) => v.fill(x0, y0, z0, x1, y1, z1, n, s);
const door = (x, y, z, n, dir, open, hinge) => {
  B(x, y, z, n, { 'minecraft:cardinal_direction': dir, open_bit: open, door_hinge_bit: hinge, upper_block_bit: false });
  B(x, y + 1, z, n, { 'minecraft:cardinal_direction': dir, open_bit: open, door_hinge_bit: hinge, upper_block_bit: true });
};

// ---------------------------------------------------------------- shell
F(0, 0, 0, 43, 0, 39, 'stone');
F(32, 0, 0, 43, 0, 39, 'grass_block'); // exterior east
F(0, 0, 28, 31, 0, 39, 'grass_block'); // exterior south
F(34, 0, 10, 41, 0, 17, 'smooth_stone'); // path to the door
for (let x = 1; x <= 30; x++) for (let z = 1; z <= 26; z++) B(x, 0, z, (x + z) % 2 ? 'black_concrete' : 'white_concrete');
F(16, 0, 1, 30, 0, 12, 'fnartest:tile'); // custom glossy floor (MER + heightmap)
F(0, 1, 0, 31, 7, 0, 'polished_andesite'); F(0, 1, 27, 31, 7, 27, 'polished_andesite');
F(0, 1, 0, 0, 7, 27, 'polished_andesite'); F(31, 1, 0, 31, 7, 27, 'polished_andesite');
F(0, 1, 0, 31, 1, 0, 'quartz_block'); F(0, 1, 27, 31, 1, 27, 'quartz_block'); // wainscot-ish band
F(0, 8, 0, 31, 8, 27, 'smooth_stone'); // ceiling
F(0, 9, 0, 31, 9, 27, 'dark_oak_planks'); // roof
// partition x=15 (low wall + iron bars, full wall at the ends)
F(15, 1, 1, 15, 1, 26, 'polished_andesite');
F(15, 2, 1, 15, 3, 26, 'iron_bars');
F(15, 1, 1, 15, 7, 3, 'stone_bricks'); F(15, 1, 24, 15, 7, 26, 'stone_bricks');
F(15, 4, 4, 15, 7, 23, 'stone_bricks');
F(15, 1, 12, 15, 3, 14, 'air'); // opening
// partition z=13 between north and south halves (east part only, with a door)
F(16, 1, 13, 30, 7, 13, 'stone_bricks');
door(17, 1, 13, 'dark_oak_door', 'south', false, false);
door(28, 1, 13, 'spruce_door', 'north', true, true);
F(20, 2, 13, 22, 3, 13, 'glass_pane'); // pane window, connections computed from neighbours
F(24, 2, 13, 25, 3, 13, 'glass_pane', { 'minecraft:connection_east': true, 'minecraft:connection_west': true, 'minecraft:connection_north': false, 'minecraft:connection_south': false });

// ---------------------------------------------------------------- zone A (NW): stairs, slabs, carpet, trapdoors, logs
const STAIR = 'oak_stairs';
for (let d = 0; d < 4; d++) { B(2 + d * 2, 1, 2, STAIR, { weirdo_direction: d, upside_down_bit: false }); B(2 + d * 2, 1, 4, STAIR, { weirdo_direction: d, upside_down_bit: true }); }
// stair corners (computed): an L of north-facing + east-facing stairs, and a U for inner corners
B(10, 1, 2, 'spruce_stairs', { weirdo_direction: 3, upside_down_bit: false }); B(11, 1, 2, 'spruce_stairs', { weirdo_direction: 3, upside_down_bit: false });
B(12, 1, 2, 'spruce_stairs', { weirdo_direction: 3, upside_down_bit: false }); B(12, 1, 3, 'spruce_stairs', { weirdo_direction: 0, upside_down_bit: false });
B(12, 1, 4, 'spruce_stairs', { weirdo_direction: 0, upside_down_bit: false });
B(10, 1, 4, 'spruce_stairs', { weirdo_direction: 2, upside_down_bit: false }); B(10, 1, 3, 'spruce_stairs', { weirdo_direction: 1, upside_down_bit: false });
// explicit corner states
B(13, 1, 6, 'stone_brick_stairs', { weirdo_direction: 3, upside_down_bit: false, 'minecraft:corner': 'outer_left' });
B(13, 1, 8, 'stone_brick_stairs', { weirdo_direction: 3, upside_down_bit: false, 'minecraft:corner': 'inner_right' });
B(13, 2, 10, 'stone_brick_stairs', { weirdo_direction: 2, upside_down_bit: true, 'minecraft:corner': 'outer_right' });
for (let x = 2; x <= 5; x++) { B(x, 1, 6, 'smooth_stone_slab', { 'minecraft:vertical_half': 'bottom' }); B(x, 1, 7, 'smooth_stone_slab', { 'minecraft:vertical_half': 'top' }); }
B(6, 1, 6, 'smooth_stone_double_slab'); B(6, 1, 7, 'dark_oak_slab', { 'minecraft:vertical_half': 'bottom' }); B(6, 2, 7, 'dark_oak_slab', { 'minecraft:vertical_half': 'top' });
F(2, 1, 9, 7, 1, 10, 'red_carpet'); F(3, 1, 9, 4, 1, 10, 'black_carpet');
for (let d = 0; d < 4; d++) {
  B(9 + d, 1, 6, 'iron_trapdoor', { direction: d, open_bit: false, upside_down_bit: false });
  B(9 + d, 1, 8, 'dark_oak_trapdoor', { direction: d, open_bit: false, upside_down_bit: true });
  B(9 + d, 1, 10, 'iron_trapdoor', { direction: d, open_bit: true, upside_down_bit: false });
}
F(1, 1, 11, 1, 3, 11, 'dark_oak_log', { pillar_axis: 'y' }); F(2, 1, 11, 4, 1, 11, 'dark_oak_log', { pillar_axis: 'x' });
F(5, 1, 11, 5, 1, 12, 'stripped_spruce_log', { pillar_axis: 'z' }); B(6, 1, 11, 'oak_log', { pillar_axis: 'y' });
// light: hanging lantern on a chain + standing lantern + invisible light block
B(7, 7, 5, 'iron_chain', { pillar_axis: 'y' }); B(7, 6, 5, 'iron_chain', { pillar_axis: 'y' }); B(7, 5, 5, 'lantern', { hanging: true });
B(2, 1, 8, 'lantern', { hanging: false }); B(12, 2, 11, 'soul_lantern', { hanging: false }); B(12, 1, 11, 'polished_andesite');
B(4, 6, 12, 'light_block_9');

// ---------------------------------------------------------------- zone B (SW): barrels, cake, pots, fence, ladder, buttons, signs, torches, rods
for (let f = 0; f < 6; f++) B(2 + f, 1, 15, 'barrel', { facing_direction: f, open_bit: f === 1 });
// table: fence legs + pressure plate top is not solid; use a slab top instead
B(3, 1, 18, 'oak_fence'); B(3, 2, 18, 'oak_slab', { 'minecraft:vertical_half': 'top' }); B(3, 3, 18, 'cake', { bite_counter: 0 });
B(5, 1, 18, 'oak_fence'); B(5, 2, 18, 'oak_slab', { 'minecraft:vertical_half': 'top' }); B(5, 3, 18, 'cake', { bite_counter: 3 });
B(4, 1, 18, 'oak_fence'); B(4, 2, 18, 'oak_slab', { 'minecraft:vertical_half': 'top' }); B(4, 3, 18, 'flower_pot');
B(7, 1, 18, 'flower_pot'); B(8, 1, 18, 'wooden_pressure_plate');
F(2, 1, 21, 6, 1, 21, 'oak_fence'); F(6, 1, 22, 6, 1, 24, 'oak_fence'); B(7, 1, 21, 'fence_gate', { direction: 0, open_bit: false, in_wall_bit: false });
B(9, 1, 21, 'dark_oak_fence'); // isolated post
F(1, 1, 23, 1, 5, 23, 'ladder', { facing_direction: 5 });
B(1, 2, 25, 'stone_button', { facing_direction: 5, button_pressed_bit: false }); // on west wall
B(3, 1, 25, 'wooden_button', { facing_direction: 1, button_pressed_bit: false }); // floor
B(3, 7, 25, 'stone_button', { facing_direction: 0, button_pressed_bit: false }); // ceiling
B(5, 2, 26, 'polished_blackstone_button', { facing_direction: 2, button_pressed_bit: true }); // south wall, pressed
B(14, 2, 20, 'stone_button', { facing_direction: 4, button_pressed_bit: false }); // on partition, facing west
B(8, 3, 26, 'wall_sign', { facing_direction: 2 }); v.sign(8, 3, 26, ["RUSTGRIN'S", 'PIZZA', 'REVUE', 'est. 1984']);
B(1, 3, 17, 'darkoak_wall_sign', { facing_direction: 5 }); v.sign(1, 3, 17, ['STAFF', 'ONLY', '', '']);
B(10, 1, 24, 'standing_sign', { ground_sign_direction: 8 }); v.sign(10, 1, 24, ['WET', 'FLOOR', '', '']);
B(12, 1, 24, 'spruce_standing_sign', { ground_sign_direction: 12 }); v.sign(12, 1, 24, ['<- EXIT', '', '', '']);
B(1, 4, 15, 'torch', { torch_facing_direction: 'east' }); B(9, 1, 16, 'torch', { torch_facing_direction: 'top' });
B(14, 3, 17, 'soul_torch', { torch_facing_direction: 'west' }); B(14, 2, 17, 'polished_andesite');
B(12, 1, 18, 'end_rod', { facing_direction: 1 }); B(12, 4, 26, 'end_rod', { facing_direction: 2 });
B(6, 8, 19, 'glowstone'); B(11, 8, 15, 'lit_redstone_lamp'); B(9, 8, 22, 'redstone_lamp');
// dark corner: nothing lights x 1..3, z 24..26 except the far light blocks

// ---------------------------------------------------------------- zone C (NE): custom fixtures
const dirs = ['north', 'east', 'south', 'west'];
dirs.forEach((d, k) => B(18 + k * 3, 1, 3, 'fnartest:orient_cube', { 'minecraft:cardinal_direction': d }));
dirs.forEach((d, k) => B(18 + k * 3, 1, 6, 'fnartest:orient_geo', { 'minecraft:cardinal_direction': d }));
B(19, 7, 5, 'fnartest:lamp', { 'fnartest:lit': true }); B(26, 7, 5, 'fnartest:lamp', { 'fnartest:lit': true }); B(22, 7, 10, 'fnartest:lamp', { 'fnartest:lit': false });
[[27, 3, 0], [28, 3, 1], [27, 2, 2], [28, 2, 3]].forEach(([x, y, t]) => B(x, y, 1, 'fnartest:panel', { 'minecraft:cardinal_direction': 'south', 'fnartest:tile': t }));
B(28, 7, 9, 'fnartest:grate'); B(28, 8, 9, 'air');
B(17, 1, 10, 'fnartest:glass_panel', { 'minecraft:cardinal_direction': 'north' }); B(17, 2, 10, 'fnartest:glass_panel', { 'minecraft:cardinal_direction': 'north' });
B(30, 5, 6, 'fnartest:flip_sign', { 'minecraft:cardinal_direction': 'west' });
F(29, 1, 10, 30, 3, 11, 'fnartest:metal');
B(24, 1, 10, 'fnartest:nonexistent_block'); // unknown custom block -> missing texture

// ---------------------------------------------------------------- zone D (SE): stage for the animatronics
F(17, 1, 20, 30, 1, 26, 'dark_oak_planks');
for (let x = 17; x <= 30; x++) B(x, 1, 19, 'dark_oak_slab', { 'minecraft:vertical_half': 'bottom' });
F(17, 2, 26, 30, 6, 26, 'red_wool');
F(16, 2, 20, 16, 6, 20, 'red_wool'); F(31, 2, 20, 31, 6, 20, 'red_wool');
B(18, 2, 21, 'lantern', { hanging: false }); B(29, 2, 21, 'lantern', { hanging: false });
B(23, 7, 22, 'light_block_8');
F(20, 6, 17, 22, 6, 17, 'iron_chain', { pillar_axis: 'x' }); F(26, 6, 15, 26, 6, 17, 'iron_chain', { pillar_axis: 'z' });
B(23, 7, 16, 'iron_chain', { pillar_axis: 'y' }); B(23, 6, 16, 'iron_chain', { pillar_axis: 'y' }); B(23, 5, 16, 'lantern', { hanging: true });
// party tables in front of the stage
for (const [x, z] of [[19, 16], [26, 16]]) { B(x, 1, z, 'oak_fence'); B(x, 2, z, 'white_carpet'); }
B(16, 1, 17, 'trapdoor', { direction: 3, open_bit: true, upside_down_bit: false });

// ---------------------------------------------------------------- east wall: doors + windows, exterior
door(31, 1, 12, 'iron_door', 'east', false, false);
door(31, 1, 15, 'wooden_door', 'west', true, false);
door(31, 1, 16, 'wooden_door', 'west', true, true);
F(31, 3, 4, 31, 5, 7, 'glass_pane'); F(31, 3, 19, 31, 5, 22, 'iron_bars');
B(32, 5, 10, 'wall_sign', { facing_direction: 5 }); v.sign(32, 5, 10, ['NOW', 'HIRING', 'NIGHT GUARD', '']);
// lamp post outside
F(37, 1, 9, 37, 3, 9, 'dark_oak_fence'); B(37, 4, 9, 'lantern', { hanging: false });
B(40, 1, 20, 'poppy'); B(41, 1, 21, 'short_grass'); B(39, 1, 22, 'oak_leaves');
F(34, 1, 26, 34, 3, 26, 'oak_log', { pillar_axis: 'y' }); F(33, 4, 25, 35, 5, 27, 'oak_leaves');
B(36, 1, 30, 'cobblestone_wall'); B(37, 1, 30, 'cobblestone_wall'); B(38, 1, 30, 'cobblestone_wall');
B(36, 1, 4, 'barrier'); B(36, 2, 4, 'structure_void');

// ---------------------------------------------------------------- zone E: every real fnar:* block (if any exist)
// Rows on the south lawn (z = 30 / 33 / 36), each block against a backing wall on its south side,
// facing north, booleans true (lit / on), ints at their minimum; two-block-tall blocks get their upper half.
const bpDir = path.join(ROOT, 'packs/BP/blocks');
const real = fs.existsSync(bpDir) ? fs.readdirSync(bpDir).filter((f) => f.endsWith('.json')).sort() : [];
let placed = 0;
for (const f of real) {
  let j;
  try { j = JSON.parse(fs.readFileSync(path.join(bpDir, f), 'utf8')); } catch { continue; }
  const id = j?.['minecraft:block']?.description?.identifier;
  if (!id) continue;
  const desc = j['minecraft:block'].description;
  const st = {};
  if (desc.traits?.['minecraft:placement_direction']?.enabled_states?.includes('minecraft:cardinal_direction')) st['minecraft:cardinal_direction'] = 'north';
  for (const [k, vals] of Object.entries(desc.states ?? {})) {
    if (Array.isArray(vals)) st[k] = vals.includes(true) ? true : vals[0];
    else if (vals?.values) st[k] = vals.values.min ?? 0;
  }
  const row = Math.floor(placed / 22), col = placed % 22;
  if (row > 2) break;
  const x = 1 + col * 2, z = 30 + row * 3;
  const ceilingType = /ceiling|vent_cover/.test(id);
  const hanging = /spotlight|hanging_lamp/.test(id);
  B(x, 1, z + 1, 'polished_andesite'); B(x, 2, z + 1, 'polished_andesite'); B(x, 3, z + 1, 'polished_andesite');
  if (ceilingType) { B(x, 3, z, id, st); }
  else if (hanging) { B(x, 3, z, 'polished_andesite'); B(x, 2, z, id, st); }
  else {
    B(x, 1, z, id, st);
    if ('fnar:half' in st) B(x, 2, z, id, { ...st, 'fnar:half': 1 });
  }
  placed++;
}
fs.writeFileSync(path.join(HERE, 'test_room.json'), JSON.stringify(v.toJSON()));
console.log(`test_room.json: ${SIZE.join('x')} origin ${ORIGIN.join(',')}, palette ${v.palette.length}, signs ${v.signs.length}, real fnar blocks placed ${placed}`);
