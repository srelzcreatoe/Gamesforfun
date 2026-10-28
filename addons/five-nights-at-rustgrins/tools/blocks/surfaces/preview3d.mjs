// 3-D self-review renders for the section-A blocks (surfaces, signage, lights).
// Usage: node tools/blocks/surfaces/preview3d.mjs [outDir]   (default: tools/blocks/surfaces)
// Reuses tools/render (Playwright + three.js + bedrock_model.js); the scene
// builder resolves blocks straight from packs/BP/blocks and packs/RP.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withRenderer } from '../../render/render.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const OUT = path.resolve(process.argv[2] ?? HERE);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- scene helpers
class Scene {
  constructor() { this.blocks = []; this.map = new Map(); }
  set(x, y, z, name, states = {}, extra = {}) {
    const k = `${x},${y},${z}`;
    const b = { name, pos: [x, y, z], states, ...extra };
    if (this.map.has(k)) this.blocks[this.map.get(k)] = b; else { this.map.set(k, this.blocks.length); this.blocks.push(b); }
  }
  fill(x1, y1, z1, x2, y2, z2, name, states) {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) this.set(x, y, z, name, states);
  }
  // (x,y,z) = top-left tile as seen from the front; tiles run to the viewer's right and down.
  // A viewer looking at a picture that faces north looks south, so their right is west (-x), etc.
  picture(name, x, y, z, dir, w, h, variant = null) {
    const right = { n: [-1, 0], s: [1, 0], e: [0, -1], w: [0, 1] }[dir];
    const card = { n: 'north', s: 'south', e: 'east', w: 'west' }[dir];
    for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
      this.set(x + right[0] * c, y - r, z + right[1] * c, name, { 'fnar:tile': variant ?? r * w + c, 'minecraft:cardinal_direction': card });
    }
  }
}

function showroom() {
  const s = new Scene();
  // shell: floor y=-1, ceiling y=4, walls x=-1 / x=13 / z=-1, interior x 0..12, z 0..8
  s.fill(-1, -1, -1, 13, -1, 9, 'tile_checker');
  s.fill(2, -1, 5, 4, -1, 7, 'tile_checker_worn');
  s.fill(9, -1, 0, 12, -1, 3, 'carpet_party');
  s.fill(0, -1, 0, 2, -1, 2, 'stage_floor');
  s.fill(9, -1, 6, 12, -1, 9, 'tile_kitchen');
  s.fill(5, -1, 8, 8, -1, 9, 'tile_office');
  s.fill(-1, 4, -1, 13, 4, 9, 'ceiling_tile');
  s.fill(7, 4, 4, 8, 4, 5, 'ceiling_tile_stained');
  s.fill(-1, 4, 7, 13, 4, 7, 'duct_metal');
  // north wall: trim, checker band, maroon wallpaper
  s.fill(-1, 0, -1, 13, 0, -1, 'wall_trim');
  s.fill(-1, 1, -1, 13, 1, -1, 'wall_checker');
  s.fill(-1, 2, -1, 13, 3, -1, 'wallpaper_maroon');
  // west wall: plaster with a shutter doorway
  s.fill(-1, 0, 0, -1, 3, 9, 'wall_plaster');
  s.fill(-1, 1, 0, -1, 1, 9, 'wall_checker');
  s.fill(-1, 2, 1, -1, 3, 2, 'wall_plaster_stained');
  s.set(-1, 0, 6, 'door_shutter', { 'fnar:part': 1 });
  s.set(-1, 1, 6, 'door_shutter', { 'fnar:part': 0 });
  // east wall: purple curtain booth, cinder block, circus tent
  s.fill(13, 0, -1, 13, 3, 9, 'cinderblock_painted');
  s.fill(13, 0, 0, 13, 2, 2, 'curtain_purple');
  s.fill(13, 0, 5, 13, 2, 8, 'tent_stripe');
  s.fill(13, 0, 3, 13, 2, 3, 'curtain_red');
  // pictures
  s.picture('poster_revue', 0, 3, 0, 's', 2, 3);
  s.picture('poster_cabaret', 3, 3, 0, 's', 2, 3);
  s.picture('poster_midway', 6, 3, 0, 's', 2, 3);
  s.picture('poster_party', 9, 3, 0, 's', 2, 2);
  s.picture('poster_rules', 11, 1, 0, 's', 2, 2);
  s.picture('poster_missing', 0, 3, 1, 'e', 1, 2);
  for (let i = 0; i < 6; i++) s.picture('drawing', 0, 1, 2 + i, 'e', 1, 1, i);
  for (let i = 0; i < 4; i++) s.picture('sign_staff', 0, 3, 2 + i, 'e', 1, 1, i);
  s.picture('sign_cabaret', 12, 3, 0, 'w', 3, 1);
  s.picture('sign_midway', 12, 3, 5, 'w', 4, 1);
  s.picture('sign_out_of_order', 12, 1, 3, 'w', 2, 1);
  // lights
  s.set(0, 3, 6, 'exit_sign', { 'minecraft:cardinal_direction': 'east', 'fnar:lit': true }, { lightOffset: [0, 0.75, 0.42] });
  s.set(0, 2, 8, 'wall_sconce', { 'minecraft:cardinal_direction': 'east', 'fnar:lit': true }, { lightOffset: [0, 0.55, 0.25] });
  s.set(12, 2, 4, 'wall_sconce', { 'minecraft:cardinal_direction': 'west', 'fnar:lit': false });
  s.set(4, 4, 3, 'ceiling_lamp', { 'fnar:lit': true }, { lightOffset: [0, -0.1, 0] });
  s.set(10, 4, 5, 'ceiling_lamp', { 'fnar:lit': false });
  s.set(8, 3, 3, 'hanging_lamp', { 'fnar:lit': true }, { lightOffset: [0, 0.25, 0] });
  s.set(2, 3, 3, 'stage_spotlight', { 'minecraft:cardinal_direction': 'north', 'fnar:lit': true }, { lightOffset: [0, 0.5, -0.3], spot: [2.5, 1.5, -0.5] });
  return s.blocks;
}

function facingTest(name, states, extra = {}) {
  const s = new Scene();
  s.fill(0, 0, 0, 0, 1, 0, 'cinderblock_painted');
  s.fill(-3, -1, -3, 3, -1, 3, 'tile_office');
  const sides = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const y = extra.y ?? 1;
  for (const [d, [dx, dz]] of Object.entries(sides)) s.set(dx, y, dz, name, { ...states, 'minecraft:cardinal_direction': d, ...(extra.tile ? { 'fnar:tile': extra.tile[d] } : {}) });
  return s.blocks;
}

function exterior() {
  const s = new Scene();
  s.fill(-2, -1, -2, 9, -1, 4, 'tile_office');
  s.fill(-2, 0, -1, 9, 4, -1, 'cinderblock_painted');
  s.picture('sign_revue', 1, 3, 0, 's', 6, 2);
  s.set(0, 0, 0, 'door_shutter', { 'fnar:part': 1 });
  s.set(0, 1, 0, 'door_shutter', { 'fnar:part': 0 });
  s.set(8, 1, 0, 'poster_missing', { 'fnar:tile': 0, 'minecraft:cardinal_direction': 'south' });
  s.set(8, 0, 0, 'poster_missing', { 'fnar:tile': 1, 'minecraft:cardinal_direction': 'south' });
  s.set(-1, 1, 0, 'wall_sconce', { 'fnar:lit': true, 'minecraft:cardinal_direction': 'south' }, { lightOffset: [0, 0.55, 0.25] });
  return s.blocks;
}

const room = showroom();
const vv = { style: 'vibrant', exposure: 1.25, fog: { color: '#07070a', density: 0.03 }, lightScale: 0.5, emissive: 2.0 };
const flat = { style: 'flat', exposure: 1.0 };
const jobs = [
  ['preview_room_north_vv.png', { ...vv, blocks: room, camera: { pos: [6.5, 1.9, 9.6], target: [6.5, 1.6, 0], fov: 62 } }],
  ['preview_room_north_flat.png', { ...flat, blocks: room, camera: { pos: [6.5, 1.9, 9.6], target: [6.5, 1.6, 0], fov: 62 } }],
  ['preview_room_west_vv.png', { ...vv, blocks: room, camera: { pos: [9.5, 1.8, 6.5], target: [0, 1.5, 3.8], fov: 60 } }],
  ['preview_room_west_flat.png', { ...flat, blocks: room, camera: { pos: [9.5, 1.8, 6.5], target: [0, 1.5, 3.8], fov: 60 } }],
  ['preview_room_east_vv.png', { ...vv, blocks: room, camera: { pos: [3, 1.8, 7.5], target: [13, 1.5, 3.5], fov: 60 } }],
  ['preview_room_up_vv.png', { ...vv, blocks: room, camera: { pos: [6.5, 0.6, 8.5], target: [6, 4, 2.5], fov: 70 } }],
  ['preview_exterior_vv.png', { ...vv, blocks: exterior(), background: '#04050a', camera: { pos: [3.5, 1.8, 7.5], target: [3.5, 2.2, 0], fov: 55 } }],
  ['preview_facing_exit.png', { ...flat, blocks: facingTest('exit_sign', { 'fnar:lit': true }), camera: { pos: [3.2, 4.2, 4.2], target: [0.5, 1.2, 0.5], fov: 45 } }],
  ['preview_facing_sconce.png', { ...flat, blocks: facingTest('wall_sconce', { 'fnar:lit': true }), camera: { pos: [3.2, 4.2, 4.2], target: [0.5, 1.2, 0.5], fov: 45 } }],
  ['preview_facing_spot.png', { ...flat, blocks: facingTest('stage_spotlight', { 'fnar:lit': true }), camera: { pos: [3.2, 4.2, 4.2], target: [0.5, 1.2, 0.5], fov: 45 } }],
  ['preview_side_spot.png', { ...flat, blocks: [{ name: 'stage_spotlight', pos: [0, 1, 0], states: { 'minecraft:cardinal_direction': 'north', 'fnar:lit': true } }, { name: 'ceiling_tile', pos: [0, 2, 0] }, { name: 'hanging_lamp', pos: [0, 1, 2], states: {} }, { name: 'ceiling_tile', pos: [0, 2, 2] }, { name: 'wall_sconce', pos: [0, 1, -3], states: { 'minecraft:cardinal_direction': 'north' } }, { name: 'cinderblock_painted', pos: [0, 1, -4] }], camera: { pos: [3.2, 1.5, -0.2], target: [0.5, 1.5, -0.2], ortho: 2.2 } }],
  ['preview_facing_poster.png', { ...flat, blocks: facingTest('sign_staff', {}, { tile: { north: 0, south: 1, east: 2, west: 3 } }), camera: { pos: [3.2, 4.2, 4.2], target: [0.5, 1.2, 0.5], fov: 45 } }],
];
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
await withRenderer(async (render, page) => {
  await page.evaluate(() => import('/S/preview_page.js'));
  await page.waitForFunction(() => window.__blocksReady === true);
  for (const [file, spec] of jobs) {
    if (only && !only.test(file)) continue;
    const url = await page.evaluate(async (S) => { document.body.innerHTML = ''; return window.renderBlocks(S); }, { width: 1280, height: 720, ...spec });
    fs.writeFileSync(path.join(OUT, file), Buffer.from(url.split(',')[1], 'base64'));
    console.log('wrote', file);
  }
}, { mounts: { '/S': HERE, '/BP': path.join(ROOT, 'packs/BP'), '/RP': path.join(ROOT, 'packs/RP') } });
