// Shape gallery: every vanilla shape variant on a grid (rows along X, one row per Z band),
// used to verify geometry and texture orientation. Writes tools/render/test/gallery.json.
// Rows (z):  2 stairs | 5 stair corners | 8 trapdoors | 11 doors | 14 panes/bars/fences/walls/chains/lanterns
//           17 wall-mounted (buttons, ladders, wall signs, wall torches) | 20 standing signs, torches, rods
//           23 misc (cake, pot, logs, barrels, carpet, slabs, pressure plate, plants)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoxelBuilder } from './voxels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const v = new VoxelBuilder([56, 8, 27], [0, 64, 0]);
const B = (x, y, z, n, s) => v.set(x, y, z, n, s);
v.fill(0, 0, 0, 55, 0, 26, 'smooth_stone');
const FACE = { north: 2, south: 3, west: 4, east: 5 };
const OFF = { north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0] }; // support block offset for wall items facing <dir>
let x;

// stairs: weirdo 0..3 (E W S N), bottom then upside down
x = 1; for (const ud of [false, true]) for (let d = 0; d < 4; d++) { B(x, ud ? 2 : 1, 2, 'oak_stairs', { weirdo_direction: d, upside_down_bit: ud }); if (ud) B(x, 1, 2, 'glass'); x += 2; }
// explicit corners for north-facing stairs, bottom and top
x = 1; for (const ud of [false, true]) for (const c of ['none', 'outer_left', 'outer_right', 'inner_left', 'inner_right']) { B(x, ud ? 2 : 1, 5, 'stone_brick_stairs', { weirdo_direction: 3, upside_down_bit: ud, 'minecraft:corner': c }); x += 2; }
// computed corners: a ring of stairs around a 1x1 hole (outer corners) at x 22..24
for (const [dx, dz, d] of [[0, 0, 3], [1, 0, 3], [2, 0, 0], [2, 1, 0], [2, 2, 2], [1, 2, 2], [0, 2, 1], [0, 1, 1]]) B(22 + dx, 1, 4 + dz, 'spruce_stairs', { weirdo_direction: d, upside_down_bit: false });
// trapdoors direction 0..3: open / closed bottom / closed top
x = 1; for (let d = 0; d < 4; d++) { B(x, 1, 8, 'iron_trapdoor', { direction: d, open_bit: true, upside_down_bit: false }); B(x + 9, 1, 8, 'trapdoor', { direction: d, open_bit: false, upside_down_bit: false }); B(x + 18, 1, 8, 'dark_oak_trapdoor', { direction: d, open_bit: false, upside_down_bit: true }); x += 2; }
// doors: 4 dirs closed, 4 dirs open hinge left, 4 dirs open hinge right
x = 1;
for (const [open, hinge] of [[false, false], [true, false], [true, true]]) for (const d of ['north', 'east', 'south', 'west']) {
  B(x, 1, 11, 'wooden_door', { 'minecraft:cardinal_direction': d, open_bit: open, door_hinge_bit: hinge, upper_block_bit: false });
  B(x, 2, 11, 'wooden_door', { 'minecraft:cardinal_direction': d, open_bit: open, door_hinge_bit: hinge, upper_block_bit: true });
  x += 2;
}
B(x, 1, 11, 'iron_door', { 'minecraft:cardinal_direction': 'south', open_bit: false, door_hinge_bit: false, upper_block_bit: false });
B(x, 2, 11, 'iron_door', { 'minecraft:cardinal_direction': 'south', open_bit: false, door_hinge_bit: false, upper_block_bit: true });
// panes, bars, fences, walls, chains, lanterns
B(1, 1, 14, 'glass_pane'); for (let k = 3; k <= 5; k++) B(k, 1, 14, 'glass_pane'); B(5, 1, 15, 'glass_pane');
B(7, 1, 14, 'iron_bars'); for (let k = 9; k <= 11; k++) B(k, 1, 14, 'iron_bars'); B(11, 1, 13, 'iron_bars'); B(12, 1, 14, 'stone');
B(14, 1, 14, 'oak_fence'); for (let k = 16; k <= 18; k++) B(k, 1, 14, 'oak_fence'); B(18, 1, 15, 'oak_fence'); B(19, 1, 14, 'fence_gate', { direction: 0, open_bit: false, in_wall_bit: false });
B(21, 1, 14, 'cobblestone_wall'); B(22, 1, 14, 'cobblestone_wall'); B(23, 1, 14, 'cobblestone_wall'); B(23, 1, 15, 'cobblestone_wall');
B(25, 1, 14, 'iron_chain', { pillar_axis: 'y' }); B(25, 2, 14, 'iron_chain', { pillar_axis: 'y' });
B(27, 1, 14, 'iron_chain', { pillar_axis: 'x' }); B(29, 1, 14, 'iron_chain', { pillar_axis: 'z' });
B(31, 1, 14, 'lantern', { hanging: false }); B(33, 3, 14, 'stone'); B(33, 2, 14, 'lantern', { hanging: true }); B(35, 1, 14, 'soul_lantern', { hanging: false });
B(37, 1, 14, 'glass_pane', { 'minecraft:connection_north': true, 'minecraft:connection_east': true, 'minecraft:connection_south': false, 'minecraft:connection_west': false });
// wall-mounted: buttons (6 facings), ladders, wall signs, wall torches; support block behind each
x = 1;
for (const d of ['north', 'south', 'west', 'east']) {
  const o = OFF[d];
  B(x + o[0], 1, 17 + o[2], 'stone'); B(x, 1, 17, 'stone_button', { facing_direction: FACE[d], button_pressed_bit: false }); x += 3;
}
B(x, 1, 17, 'stone_button', { facing_direction: 1, button_pressed_bit: false }); x += 2;
B(x, 2, 17, 'stone'); B(x, 1, 17, 'stone_button', { facing_direction: 0, button_pressed_bit: false }); x += 2;
for (const d of ['north', 'south', 'west', 'east']) { const o = OFF[d]; B(x + o[0], 1, 17 + o[2], 'stone'); B(x + o[0], 2, 17 + o[2], 'stone'); B(x, 1, 17, 'ladder', { facing_direction: FACE[d] }); B(x, 2, 17, 'ladder', { facing_direction: FACE[d] }); x += 3; }
for (const d of ['north', 'south', 'west', 'east']) { const o = OFF[d]; B(x + o[0], 1, 17 + o[2], 'stone'); B(x, 1, 17, 'wall_sign', { facing_direction: FACE[d] }); v.sign(x, 1, 17, ['SIGN', d.toUpperCase(), 'facing', String(FACE[d])]); x += 3; }
for (const d of ['north', 'south', 'west', 'east']) { const o = OFF[d]; B(x + o[0], 1, 17 + o[2], 'stone'); B(x, 1, 17, 'torch', { torch_facing_direction: d }); x += 3; }
// standing signs (rotations 0,4,8,12), standing torch, end rods (6 facings)
x = 1; for (const r of [0, 4, 8, 12, 2]) { B(x, 1, 20, 'standing_sign', { ground_sign_direction: r }); v.sign(x, 1, 20, ['ROT', String(r), '', '']); x += 2; }
B(x, 1, 20, 'torch', { torch_facing_direction: 'top' }); x += 2;
for (let f = 0; f < 6; f++) { B(x, f === 0 ? 2 : 1, 20, 'end_rod', { facing_direction: f }); x += 2; }
// misc
x = 1;
for (let b = 0; b <= 6; b += 2) { B(x, 1, 23, 'cake', { bite_counter: b }); x += 2; }
B(x, 1, 23, 'flower_pot'); x += 2;
for (const a of ['x', 'y', 'z']) { B(x, 1, 23, 'oak_log', { pillar_axis: a }); x += 2; }
for (let f = 0; f < 6; f++) { B(x, 1, 23, 'barrel', { facing_direction: f, open_bit: false }); x += 2; }
B(x, 1, 23, 'red_carpet'); x += 2;
B(x, 1, 23, 'smooth_stone_slab', { 'minecraft:vertical_half': 'bottom' }); x += 2;
B(x, 1, 23, 'smooth_stone_slab', { 'minecraft:vertical_half': 'top' }); x += 2;
B(x, 1, 23, 'wooden_pressure_plate'); x += 2;
B(x, 1, 23, 'poppy'); x += 2;
B(x, 1, 23, 'grass_block'); x += 2;
B(x, 1, 23, 'oak_leaves'); x += 2;
fs.writeFileSync(path.join(HERE, 'gallery.json'), JSON.stringify(v.toJSON()));
console.log('gallery.json palette', v.palette.length);
