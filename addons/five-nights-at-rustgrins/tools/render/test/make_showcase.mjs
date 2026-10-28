// Pizzeria-like demo snapshot built from the add-on's real fnar:* blocks (packs/BP/blocks), with
// vanilla fallbacks for blocks that do not exist (yet). Follows docs/BLOCKS.md conventions:
// wall decor back on the south side of its cell (state = facing), multi-tile pictures numbered
// row-major from the top-left as seen from the front, ceiling lamps / vents IN the ceiling,
// spotlights and pendant lamps hanging at the top of their cell.
// Writes tools/render/test/showcase.json and prints which real blocks were used / missing.
// Usage: node tools/render/test/make_showcase.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoxelBuilder } from './voxels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const real = new Set();
for (const f of fs.existsSync(path.join(ROOT, 'packs/BP/blocks')) ? fs.readdirSync(path.join(ROOT, 'packs/BP/blocks')) : []) {
  try { const id = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs/BP/blocks', f), 'utf8'))['minecraft:block'].description.identifier; real.add(id); } catch { /* partial file */ }
}
const used = new Set(), missing = new Set();
const pick = (id, fallback) => { if (real.has(id)) { used.add(id); return id; } missing.add(id); return fallback; };

const SIZE = [42, 10, 30], ORIGIN = [100, 64, 200];
const v = new VoxelBuilder(SIZE, ORIGIN);
const B = (x, y, z, n, s) => { if (n) v.set(x, y, z, n, s); };
const F = (x0, y0, z0, x1, y1, z1, n, s) => { if (n) v.fill(x0, y0, z0, x1, y1, z1, n, s); };
const C = (d, extra = {}) => ({ 'minecraft:cardinal_direction': d, ...extra });

const RIGHT_OF = { south: [1, 0], north: [-1, 0], east: [0, -1], west: [0, 1] }; // viewer's right, by picture facing
const poster = (id, w, h, x, y0, z, facing) => { // (x, z) = cell of the top-left tile as seen from the front
  if (!real.has(id)) { missing.add(id); return; }
  used.add(id);
  const [dx, dz] = RIGHT_OF[facing];
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) B(x + c * dx, y0 + h - 1 - r, z + c * dz, id, C(facing, { 'fnar:tile': r * w + c }));
};
// ---------------------------------------------------------------- shell
const floorA = pick('fnar:tile_checker', 'white_concrete'), floorB = pick('fnar:tile_checker_worn', 'light_gray_concrete');
const wallP = pick('fnar:wall_plaster', 'light_gray_concrete'), wallPS = pick('fnar:wall_plaster_stained', 'gray_concrete');
const wainscot = pick('fnar:wall_checker', 'polished_blackstone_bricks'), trim = pick('fnar:wall_trim', 'polished_blackstone');
const ceil = pick('fnar:ceiling_tile', 'smooth_stone'), ceilS = pick('fnar:ceiling_tile_stained', 'smooth_stone');
F(0, 0, 0, 41, 0, 29, 'stone');
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
for (let x = 1; x <= 40; x++) for (let z = 1; z <= 28; z++) B(x, 0, z, rnd() < 0.18 ? floorB : floorA);
for (let x = 0; x <= 41; x++) for (let z = 0; z <= 29; z++) B(x, 7, z, rnd() < 0.08 ? ceilS : ceil);
F(0, 8, 0, 41, 8, 29, 'dark_oak_planks');
const wall = (x0, z0, x1, z1) => {
  F(x0, 1, z0, x1, 1, z1, wainscot); F(x0, 2, z0, x1, 2, z1, trim);
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++) for (let y = 3; y <= 6; y++) B(x, y, z, rnd() < 0.15 ? wallPS : wallP);
};
wall(0, 0, 41, 0); wall(0, 29, 41, 29); wall(0, 0, 0, 29); wall(41, 0, 41, 29);
// office (NE) walls x=31, z=9 with a shutter doorway at x=31 z=4..5? -> doorway in the west office wall
wall(31, 1, 31, 9); wall(31, 9, 40, 9);
F(31, 1, 4, 31, 3, 4, 'air');
const shutter = pick('fnar:door_shutter', 'iron_block');
B(31, 1, 4, shutter, real.has('fnar:door_shutter') ? { 'fnar:part': 1 } : {}); // closed-ish: bottom panel only, rest open
B(31, 4, 4, shutter, real.has('fnar:door_shutter') ? { 'fnar:part': 0 } : {});
F(32, 0, 1, 40, 0, 8, pick('fnar:tile_office', 'gray_concrete'));

// ---------------------------------------------------------------- stage (south)
const stageFloor = pick('fnar:stage_floor', 'dark_oak_planks');
F(9, 1, 21, 30, 1, 28, stageFloor);
for (let x = 9; x <= 30; x++) B(x, 1, 20, 'dark_oak_slab', { 'minecraft:vertical_half': 'bottom' });
F(9, 2, 28, 30, 6, 28, pick('fnar:curtain_red', 'red_wool'));
F(9, 2, 21, 9, 6, 27, pick('fnar:curtain_purple', 'purple_wool')); F(30, 2, 21, 30, 6, 27, pick('fnar:curtain_purple', 'purple_wool'));
F(10, 6, 21, 29, 6, 21, pick('fnar:curtain_red', 'red_wool'));
B(11, 2, 27, pick('fnar:stage_speaker'), C('north')); B(28, 2, 27, pick('fnar:stage_speaker'), C('north'));
B(15, 2, 25, pick('fnar:guitar_amp'), C('north'));
B(19, 4, 27, pick('fnar:stage_star'), C('north'));
for (const x of [13, 19, 26]) B(x, 6, 18, pick('fnar:stage_spotlight'), C('south', { 'fnar:lit': true }));
B(24, 2, 26, pick('fnar:show_tape'), C('north', { 'fnar:level': 3 }));
// sign above the stage opening
poster('fnar:sign_cabaret', 3, 1, 20, 6, 20, 'north'); // on the curtain pelmet, facing the hall

// ---------------------------------------------------------------- dining hall
const table = pick('fnar:party_table'), chair = pick('fnar:party_chair'), hat = pick('fnar:party_hat'), plate = pick('fnar:plate_set'), pizza = pick('fnar:pizza_box'), balloons = pick('fnar:balloons');
const tableRow = (x, z0, len) => { // long axis north-south (facing north)
  for (let k = 0; k < len; k++) {
    const z = z0 + k;
    const part = len === 1 ? 0 : k === 0 || k === len - 1 ? 1 : 2;
    const facing = len > 1 && k === len - 1 ? 'south' : 'north';
    B(x, 1, z, table ?? 'oak_fence', table ? C(facing, { 'fnar:part': part }) : undefined);
    if (!table) B(x, 2, z, 'white_carpet');
    B(x - 1, 1, z, chair ?? 'oak_stairs', chair ? C('east') : { weirdo_direction: 1, upside_down_bit: false });
    B(x + 1, 1, z, chair ?? 'oak_stairs', chair ? C('west') : { weirdo_direction: 0, upside_down_bit: false });
    const r = rnd();
    if (hat && r < 0.35) B(x, 2, z, hat, { 'fnar:color': Math.floor(rnd() * 4) });
    else if (plate && r < 0.65) B(x, 2, z, plate);
    else if (pizza && r < 0.8) B(x, 2, z, pizza, C('north', { 'fnar:count': 1 + Math.floor(rnd() * 3) }));
  }
};
tableRow(8, 5, 5); tableRow(15, 5, 5); tableRow(22, 5, 5); tableRow(8, 12, 4); tableRow(15, 12, 4); tableRow(22, 12, 4);
if (balloons) { B(8, 2, 10, balloons, C('north', { 'fnar:color': 0 })); B(22, 2, 16, balloons, C('north', { 'fnar:color': 2 })); }
F(13, 0, 11, 17, 0, 16, pick('fnar:carpet_party', 'purple_carpet') === 'purple_carpet' ? null : 'fnar:carpet_party');
// ceiling lamps (in the ceiling), one dead, one missing tube; pendant lamps over the stage edge
const lamp = pick('fnar:ceiling_lamp', 'sea_lantern');
for (const [x, z, lit] of [[8, 7, true], [15, 7, true], [22, 7, false], [8, 14, true], [15, 14, true], [22, 14, true], [27, 10, true], [4, 24, false], [35, 15, true]]) B(x, 7, z, lamp, real.has('fnar:ceiling_lamp') ? { 'fnar:lit': lit } : undefined);
B(35, 6, 22, pick('fnar:hanging_lamp', 'lantern'), real.has('fnar:hanging_lamp') ? { 'fnar:lit': true } : { hanging: true });
// vent in the ceiling with a duct above
B(28, 7, 4, pick('fnar:vent_cover', 'iron_trapdoor'), real.has('fnar:vent_cover') ? { 'fnar:closed': false } : { direction: 0, open_bit: false, upside_down_bit: true });
F(27, 8, 3, 29, 8, 5, pick('fnar:duct_metal', 'iron_block'));

// ---------------------------------------------------------------- walls: posters, signs, lights
// north wall (z=0): pictures face south (viewer looks north, right = +x)
poster('fnar:poster_revue', 2, 3, 4, 3, 1, 'south');
poster('fnar:poster_party', 2, 2, 11, 3, 1, 'south');
poster('fnar:poster_rules', 2, 2, 17, 3, 1, 'south');
poster('fnar:poster_missing', 1, 2, 21, 3, 1, 'south');
const drawing = pick('fnar:drawing');
if (drawing) for (let t = 0; t < 6; t++) B(24 + t, 3 + (t % 2), 1, drawing, C('south', { 'fnar:tile': t }));
// west wall (x=0): pictures face east; viewer looks west, left = south (larger z)
// west wall (x=0): pictures face east (viewer looks west, right = -z)
poster('fnar:poster_cabaret', 2, 3, 1, 3, 9, 'east');
poster('fnar:poster_midway', 2, 3, 1, 3, 15, 'east');
B(1, 4, 18, pick('fnar:exit_sign'), C('east', { 'fnar:lit': true }));
B(1, 1, 18, 'iron_door', { 'minecraft:cardinal_direction': 'east', open_bit: false, door_hinge_bit: false, upper_block_bit: false });
B(1, 2, 18, 'iron_door', { 'minecraft:cardinal_direction': 'east', open_bit: false, door_hinge_bit: false, upper_block_bit: true });
const sconce = pick('fnar:wall_sconce');
for (const z of [4, 11, 23]) B(1, 4, z, sconce, C('east', { 'fnar:lit': z !== 11 }));
B(36, 4, 28, sconce, C('north', { 'fnar:lit': true }));
B(1, 6, 26, pick('fnar:pa_speaker'), C('east'));
B(1, 2, 26, pick('fnar:time_clock'), C('east'));
const bunting = pick('fnar:bunting');
if (bunting) for (let x = 3; x <= 29; x++) if (x < 4 || x > 6) B(x, 6, 1, bunting, C('south'));
B(40, 6, 16, pick('fnar:security_camera'), C('west'));
poster('fnar:sign_out_of_order', 2, 1, 1, 2, 22, 'east');
const staff = pick('fnar:sign_staff');
if (staff) B(30, 4, 6, staff, C('west', { 'fnar:tile': 0 }));

// ---------------------------------------------------------------- arcade corner (NE of hall), utility
const arcade = pick('fnar:arcade_cabinet');
for (const z of [12, 14]) { B(29, 1, z, arcade ?? 'black_concrete', arcade ? C('west', { 'fnar:half': 0 }) : undefined); B(29, 2, z, arcade ?? 'black_concrete', arcade ? C('west', { 'fnar:half': 1 }) : undefined); }
const locker = pick('fnar:locker');
for (const x of [36, 37, 38]) { B(x, 1, 28, locker, C('north', { 'fnar:half': 0 })); B(x, 2, 28, locker, C('north', { 'fnar:half': 1 })); }
B(39, 1, 28, pick('fnar:parts_shelf'), C('north'));
B(34, 1, 27, pick('fnar:trash_can'), C('north'));
B(33, 1, 22, pick('fnar:mop_bucket'), C('north'));
B(30, 1, 17, pick('fnar:wet_floor_sign'), C('north'));
B(40, 1, 12, pick('fnar:toilet'), C('west')); B(40, 1, 14, pick('fnar:sink'), C('west'));

// ---------------------------------------------------------------- office (NE corner)
F(33, 1, 2, 38, 1, 2, 'dark_oak_slab', { 'minecraft:vertical_half': 'top' }); // desk
B(35, 2, 2, pick('fnar:crt_monitor'), C('south', { 'fnar:on': true }));
B(34, 2, 2, pick('fnar:desk_fan'), C('south'));
B(37, 2, 2, pick('fnar:desk_phone'), C('south', { 'fnar:ringing': false }));
B(36, 2, 2, pick('fnar:desk_clutter'), C('south'));
B(33, 2, 2, pick('fnar:plush_rat'), C('south'));
B(32, 3, 3, pick('fnar:door_button'), C('east', { 'fnar:on': false })); B(32, 2, 3, pick('fnar:light_button'), C('east', { 'fnar:on': true }));
B(32, 2, 2, 'polished_blackstone'); B(32, 3, 2, 'polished_blackstone');
B(38, 6, 8, pick('fnar:security_camera'), C('north'));
B(36, 7, 5, lamp, real.has('fnar:ceiling_lamp') ? { 'fnar:lit': true } : undefined);

// ---------------------------------------------------------------- remaining surfaces / signs
const maroon = pick('fnar:wallpaper_maroon');
if (maroon) for (let z = 6; z <= 16; z++) for (let y = 3; y <= 6; y++) if (v.get(0, y, z).name !== 'minecraft:air') B(0, y, z, maroon);
const cinder = pick('fnar:cinderblock_painted');
if (cinder) { F(31, 3, 1, 31, 6, 3, cinder); F(31, 3, 5, 31, 6, 8, cinder); F(32, 3, 9, 40, 6, 9, cinder); }
F(33, 0, 18, 40, 0, 28, pick('fnar:tile_kitchen', 'red_concrete') === 'red_concrete' ? null : 'fnar:tile_kitchen');
const tent = pick('fnar:tent_stripe');
if (tent) F(1, 3, 29, 8, 6, 29, tent);
poster('fnar:sign_midway', 4, 1, 6, 6, 28, 'north'); // facing north on the south wall: top-left at the east end
poster('fnar:sign_revue', 6, 2, 39, 5, 28, 'north');

fs.writeFileSync(path.join(HERE, 'showcase.json'), JSON.stringify(v.toJSON()));
console.log(`showcase.json: ${SIZE.join('x')} origin ${ORIGIN.join(',')}, palette ${v.palette.length}; real blocks used ${used.size}/${real.size}`);
const unused = [...real].filter((r) => !used.has(r));
if (unused.length) console.log('  real blocks not placed:', unused.join(' '));
if (missing.size) console.log('  not available yet (vanilla fallback):', [...missing].join(' '));
