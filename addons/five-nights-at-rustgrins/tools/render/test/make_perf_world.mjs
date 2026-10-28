// Procedural 110x40x100 two-storey "pizzeria" for the renderer performance test.
// Writes tools/.cache/render/perf_world.json (git-ignored) and tools/render/test/scenes_perf/perf_hall.json.
// Usage: node tools/render/test/make_perf_world.mjs && node tools/render/render_world.mjs tools/render/test/scenes_perf/perf_hall.json /tmp/perf.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VoxelBuilder } from './voxels.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SX = 110, SY = 40, SZ = 100;
const O = [-55, 40, -50];
const v = new VoxelBuilder([SX, SY, SZ], O);
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

v.fill(0, 0, 0, SX - 1, 2, SZ - 1, 'stone');
v.fill(0, 3, 0, SX - 1, 3, SZ - 1, 'grass_block');
for (const [y0, h] of [[3, 9], [13, 8]]) {
  const y1 = y0 + h; // ceiling
  v.fill(3, y0, 3, SX - 4, y0, SZ - 4, 'smooth_stone');
  v.fill(3, y1, 3, SX - 4, y1, SZ - 4, 'smooth_stone');
  // outer walls
  v.fill(3, y0 + 1, 3, SX - 4, y1 - 1, 3, 'polished_andesite'); v.fill(3, y0 + 1, SZ - 4, SX - 4, y1 - 1, SZ - 4, 'polished_andesite');
  v.fill(3, y0 + 1, 3, 3, y1 - 1, SZ - 4, 'polished_andesite'); v.fill(SX - 4, y0 + 1, 3, SX - 4, y1 - 1, SZ - 4, 'polished_andesite');
  // room grid 12x12 with doorways
  for (let x = 3; x < SX - 4; x += 13) v.fill(x, y0 + 1, 3, x, y1 - 1, SZ - 4, 'stone_bricks');
  for (let z = 3; z < SZ - 4; z += 13) v.fill(3, y0 + 1, z, SX - 4, y1 - 1, z, 'stone_bricks');
  for (let x = 3; x < SX - 4; x += 13) for (let z = 3; z < SZ - 4; z += 13) {
    v.fill(x + 5, y0 + 1, z, x + 7, y0 + 3, z, 'air');
    v.fill(x, y0 + 1, z + 5, x, y0 + 3, z + 7, 'air');
    // room contents
    const kind = Math.floor(rnd() * 4);
    for (let i = 1; i < 12; i++) for (let k = 1; k < 12; k++) {
      const X = x + i, Z = z + k;
      if (X >= SX - 4 || Z >= SZ - 4) continue;
      v.set(X, y0, Z, kind === 0 ? ((i + k) % 2 ? 'black_concrete' : 'white_concrete') : kind === 1 ? 'dark_oak_planks' : kind === 2 ? 'red_carpet' === '' ? 'stone' : 'gray_wool' : 'polished_blackstone_bricks');
    }
    if (kind === 2) v.fill(x + 1, y0 + 1, z + 1, x + 11, y0 + 1, z + 11, 'red_carpet');
    // lamps every 4 blocks (some dead)
    for (let i = 3; i < 12; i += 4) for (let k = 3; k < 12; k += 4) {
      if (x + i >= SX - 4 || z + k >= SZ - 4) continue;
      const r = rnd();
      v.set(x + i, y1, z + k, r < 0.55 ? 'sea_lantern' : r < 0.75 ? 'lit_redstone_lamp' : 'redstone_lamp');
    }
    // tables + chairs
    for (let t = 0; t < 3; t++) {
      const tx = x + 2 + Math.floor(rnd() * 8), tz = z + 2 + Math.floor(rnd() * 8);
      if (tx >= SX - 5 || tz >= SZ - 5) continue;
      v.set(tx, y0 + 1, tz, 'oak_fence'); v.set(tx, y0 + 2, tz, 'white_carpet');
      v.set(tx + 1, y0 + 1, tz, 'oak_stairs', { weirdo_direction: 0, upside_down_bit: false });
      v.set(tx - 1, y0 + 1, tz, 'oak_stairs', { weirdo_direction: 1, upside_down_bit: false });
      if (rnd() < 0.5) v.set(tx, y0 + 3, tz, 'cake', { bite_counter: Math.floor(rnd() * 4) });
    }
    // wall decor
    v.set(x + 3, y0 + 3, z + 1, 'wall_sign', { facing_direction: 3 }); v.sign(x + 3, y0 + 3, z + 1, ['ROOM', `${x},${z}`, '', '']);
    v.fill(x + 6, y0 + 2, z + 1, x + 9, y0 + 2, z + 1, 'iron_bars');
    v.set(x + 1, y0 + 1, z + 11, 'barrel', { facing_direction: 1, open_bit: false });
    v.set(x + 11, y0 + 1, z + 11, 'smooth_stone_slab', { 'minecraft:vertical_half': 'bottom' });
  }
  // windows
  for (let x = 6; x < SX - 6; x += 6) v.fill(x, y0 + 3, 3, x + 2, y0 + 5, 3, 'glass_pane');
}
// stairs between floors
for (let k = 0; k < 9; k++) v.set(10 + k, 13 - 9 + k + 1, 10, 'stone_brick_stairs', { weirdo_direction: 0, upside_down_bit: false });
// roof
v.fill(2, 22, 2, SX - 3, 22, SZ - 3, 'dark_oak_planks');
v.fill(2, 23, 2, SX - 3, 23, SZ - 3, 'dark_oak_slab', { 'minecraft:vertical_half': 'bottom' });
// exterior lamp posts
for (let x = 8; x < SX - 8; x += 12) { v.fill(x, 4, 1, x, 6, 1, 'dark_oak_fence'); v.set(x, 7, 1, 'lantern', { hanging: false }); }

const out = path.join(ROOT, 'tools/.cache/render/perf_world.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(v.toJSON()));
const sceneDir = path.join(HERE, 'scenes_perf');
fs.mkdirSync(sceneDir, { recursive: true });
const w = (p) => [p[0] + O[0], p[1] + O[1], p[2] + O[2]];
fs.writeFileSync(path.join(sceneDir, 'perf_hall.json'), JSON.stringify({
  width: 1920, height: 1080, voxels: path.relative(sceneDir, out), style: 'vibrant',
  camera: { pos: w([22.5, 6.5, 18.5]), target: w([70, 4, 60]), fov: 75 },
  entities: [{ id: 'fnar:rustgrin', pos: w([30, 4, 26]), yaw: 210, anim: 'idle', t: 0.5 }],
}, null, 1));
console.log(`perf world ${SX}x${SY}x${SZ} palette ${v.palette.length} -> ${path.relative(process.cwd(), out)}`);
