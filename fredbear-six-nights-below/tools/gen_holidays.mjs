// Generates the seasonal decorations (scripts/data/holiday_decor.generated.js):
// Halloween jack o'lanterns, pumpkin piles and cobwebs; Christmas trees with
// lights and presents (where a safe 3 x 3 spot exists), and string lights
// along the top of the walls.
//
// Every cell is chosen from the voxel model of the build plan so that it is
// AIR in the built map and never touches what the game relies on:
//   * camera sight lines (1.4 blocks around every ray to a watched node),
//   * animatronic routes (route polylines, 1 block around, 3 high),
//   * the player route-guidance graph (every edge, 1 block around, 2 high),
//   * doorways, physical controls and the office (lights stay 16+ blocks away
//     from the office and the dark halls so the darkness mechanics hold).
// mc/holidays.js places / removes them (removal = back to air).
//
//   node tools/gen_holidays.mjs   (tests/holidays.test.mjs re-checks walkability)
import fs from 'node:fs';
import path from 'node:path';
import { buildVoxel, canStand } from './voxel.mjs';
import { ROOMS, OPENINGS, interior } from '../packs/FredbearBP/scripts/data/layout.js';
import { CAMERAS } from '../packs/FredbearBP/scripts/data/cameras.js';
import { NODE_BY_ID, EDGES, edgePolyline } from '../packs/FredbearBP/scripts/data/nodes.js';
import { INPUTS, inputControlPos } from '../packs/FredbearBP/scripts/data/inputs.js';
import { GUIDE_NODES, GUIDE_EDGES } from '../packs/FredbearBP/scripts/data/guide_graph.generated.js';
import { Rng } from '../packs/FredbearBP/scripts/core/rng.js';

const ROOT = new URL('../', import.meta.url).pathname;
const OUT = path.join(ROOT, 'packs/FredbearBP/scripts/data/holiday_decor.generated.js');
const KEEP_DARK = [86, -1, 100, 116, 6, 140]; // office, both door alcoves and both halls (x1, y1, z1, x2, y2, z2)
const LIT_ROOMS = new Set(['DINING', 'RECEPTION', 'EMPLOYEE', 'PARTY_A', 'PARTY_B', 'PARTY_C', 'PARTY_D', 'GIFT', 'PRIZE', 'ARCADE', 'STAFF_BREAK', 'GOLDEN_PARTY']);
const TREE_ROOMS = { EMPLOYEE: [166, 111], RECEPTION: [100, 145], DINING: [100, 86] }; // preferred tree centres (x, z); skipped if no safe spot
const key = (x, y, z) => `${x},${y},${z}`;

function distToBox(x, y, z, b) {
  return Math.max(b[0] - x, 0, x - b[3]) + Math.max(b[1] - y, 0, y - b[4]) + Math.max(b[2] - z, 0, z - b[5]);
}

function segmentCells(a, b, radius, step = 0.25) {
  const out = [];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const n = Math.max(1, Math.ceil(len / step));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    const r = Math.ceil(radius);
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
      const c = [Math.floor(p[0]) + dx, Math.floor(p[1]) + dy, Math.floor(p[2]) + dz];
      if (Math.hypot(c[0] + 0.5 - p[0], c[1] + 0.5 - p[1], c[2] + 0.5 - p[2]) <= radius + 0.5) out.push(c);
    }
  }
  return out;
}

export function forbiddenCells() {
  const F = new Set();
  const add = (c) => F.add(key(...c));
  for (const cam of CAMERAS) {
    const targets = [cam.look, ...cam.sees.map((id) => [NODE_BY_ID[id].x, NODE_BY_ID[id].y + 1.4, NODE_BY_ID[id].z])];
    for (const t of targets) for (const c of segmentCells(cam.loc, t, 1.4)) add(c);
  }
  for (const e of EDGES) {
    const pts = edgePolyline(e, e.a);
    for (let i = 1; i < pts.length; i++) {
      for (const c of segmentCells(pts[i - 1], pts[i], 0.9)) for (let dy = 0; dy <= 3; dy++) add([c[0], c[1] + dy, c[2]]);
    }
  }
  for (let i = 0; i < GUIDE_EDGES.length; i += 3) {
    const a = GUIDE_EDGES[i] * 4;
    const b = GUIDE_EDGES[i + 1] * 4;
    const pa = [GUIDE_NODES[a] + 0.5, GUIDE_NODES[a + 1], GUIDE_NODES[a + 2] + 0.5];
    const pb = [GUIDE_NODES[b] + 0.5, GUIDE_NODES[b + 1], GUIDE_NODES[b + 2] + 0.5];
    for (const c of segmentCells(pa, pb, 0.9)) for (let dy = 0; dy <= 2; dy++) add([c[0], c[1] + dy, c[2]]);
  }
  for (const o of OPENINGS) {
    for (let a = o.a1 - 2; a <= o.a2 + 2; a++) for (let y = o.y1 - 1; y <= o.y2 + 1; y++) for (let d = -2; d <= 2; d++) {
      add(o.axis === 'x' ? [o.c + d, y, a] : [a, y, o.c + d]);
    }
  }
  for (const inp of INPUTS) {
    const [x, y, z] = inputControlPos(inp);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 2; dy++) add([x + dx, y + dy, z + dz]);
  }
  return F;
}

export function generateHolidays() {
  const V = buildVoxel();
  const F = forbiddenCells();
  const rng = new Rng(1031);
  const isAir = (x, y, z) => V.get(x, y, z) === 'air';
  const ok = (x, y, z, light = false) => isAir(x, y, z) && !F.has(key(x, y, z)) && (!light || distToBox(x, y, z, KEEP_DARK) >= 16);
  const solid = (k) => k !== undefined && k !== 'air' && !k.startsWith('light_') && !k.startsWith('sign') && k !== 'web';
  const halloween = new Map();
  const christmas = new Map();
  const put = (m, x, y, z, k) => m.set(key(x, y, z), [x, y, z, k]);

  for (const room of ROOMS) {
    if (room.level === 'L0') continue;
    const i = interior(room);
    const lit = LIT_ROOMS.has(room.id);
    const cx = (i.x1 + i.x2) / 2;
    const cz = (i.z1 + i.z2) / 2;
    // ---- Halloween: jack o'lanterns on tables and counters (lit public rooms), facing the room centre.
    if (lit) {
      const tops = [];
      for (let x = i.x1; x <= i.x2; x++) for (let z = i.z1; z <= i.z2; z++) {
        const below = V.get(x, i.y1, z);
        if ((below === 'quartz_slab_top' || below === 'spruce_slab_top') && ok(x, i.y1 + 1, z, true)) tops.push([x, i.y1 + 1, z]);
      }
      const want = Math.min(tops.length, Math.max(1, Math.round(tops.length / 4)));
      for (let k = tops.length - 1; k > 0; k--) {
        const j = rng.int(0, k);
        [tops[k], tops[j]] = [tops[j], tops[k]];
      }
      for (const [x, y, z] of tops.slice(0, want)) {
        const dx = cx - x;
        const dz = cz - z;
        const face = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
        put(halloween, x, y, z, `jack_${face}`);
      }
      // Pumpkin piles in the room corners (floor), never on a route.
      for (const [x, z] of [[i.x1, i.z1], [i.x2, i.z1], [i.x1, i.z2], [i.x2, i.z2]]) {
        if (ok(x, i.y1, z) && canStand(V, x, i.y1, z) && ok(x, i.y1 + 1, z)) {
          put(halloween, x, i.y1, z, 'pumpkin');
          if (rng.chance(0.5)) put(halloween, x, i.y1 + 1, z, 'pumpkin');
        }
      }
    }
    // Cobwebs in upper corners of every public / staff room on the upper two floors.
    for (const [x, z] of [[i.x1, i.z1], [i.x2, i.z1], [i.x1, i.z2], [i.x2, i.z2]]) {
      const y = i.ceilY - 1;
      if (ok(x, y, z) && rng.chance(0.7)) put(halloween, x, y, z, 'web');
    }
    // ---- Christmas: string lights along the top of the walls (lit rooms), alternating colours.
    if (lit) {
      const y = i.ceilY - 1;
      const colours = ['ochre', 'verdant', 'pearl', 'red_wool'];
      let n = 0;
      const edge = [];
      for (let x = i.x1; x <= i.x2; x++) edge.push([x, i.z1, 0, -1], [x, i.z2, 0, 1]);
      for (let z = i.z1 + 1; z < i.z2; z++) edge.push([i.x1, z, -1, 0], [i.x2, z, 1, 0]);
      for (const [x, z, wx, wz] of edge) {
        if ((x + z) % 3 !== 0) continue;
        if (!solid(V.get(x + wx, y, z + wz)) || !ok(x, y, z, true)) continue;
        put(christmas, x, y, z, colours[n++ % colours.length]);
      }
    }
  }

  // ---- Christmas trees: a free 3 x 3 spot (6 high) nearest the preferred centre; presents beside it where free.
  const trees = [];
  for (const [id, [px, pz]] of Object.entries(TREE_ROOMS)) {
    const room = ROOMS.find((r) => r.id === id);
    const i = interior(room);
    const y0 = i.y1;
    let best = null;
    for (let x = i.x1 + 1; x <= i.x2 - 3; x++) for (let z = i.z1 + 1; z <= i.z2 - 3; z++) {
      let good = true;
      for (let dx = 0; dx < 3 && good; dx++) for (let dz = 0; dz < 3 && good; dz++) {
        if (!canStand(V, x + dx, y0, z + dz)) good = false;
        for (let dy = 0; dy <= 5 && good; dy++) if (!ok(x + dx, y0 + dy, z + dz, true)) good = false;
      }
      if (!good) continue;
      const d = Math.hypot(x + 1 - px, z + 1 - pz);
      if (!best || d < best.d) best = { x, z, d };
    }
    if (!best) continue;
    const tx = best.x + 1;
    const tz = best.z + 1;
    trees.push({ room: id, x: tx, z: tz });
    const lights = ['ochre', 'verdant', 'pearl'];
    for (let dy = 0; dy <= 3; dy++) put(christmas, tx, y0 + dy, tz, 'spruce_log');
    for (const [dy, r] of [[1, 1], [2, 1], [3, 1], [4, 0]]) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (dx === 0 && dz === 0 && dy < 4) continue;
        if (dy === 3 && dx !== 0 && dz !== 0) continue; // rounder top layer
        const lightHere = (dx + dz + dy + 6) % 3 === 0;
        put(christmas, tx + dx, y0 + dy, tz + dz, lightHere ? lights[(dx + 2 * dz + dy + 9) % 3] : 'spruce_leaves');
      }
    }
    put(christmas, tx, y0 + 5, tz, 'gold');
    // Presents (one block each) on free floor right next to the tree.
    const gifts = ['red_wool', 'green_wool', 'white_wool', 'red_wool'];
    let g = 0;
    for (const [dx, dz] of [[-2, -1], [2, 1], [-1, 2], [1, -2], [-2, 1], [2, -1]]) {
      const x = tx + dx;
      const z = tz + dz;
      if (g < 4 && ok(x, y0, z) && canStand(V, x, y0, z) && ok(x, y0 + 1, z)) put(christmas, x, y0, z, gifts[g++]);
    }
  }
  return { halloween: [...halloween.values()], christmas: [...christmas.values()], trees };
}

function encode(cells) {
  const keys = [...new Set(cells.map((c) => c[3]))].sort();
  const flat = [];
  for (const [x, y, z, k] of cells.sort((a, b) => a[0] - b[0] || a[2] - b[2] || a[1] - b[1])) flat.push(x, y, z, keys.indexOf(k));
  return { keys, flat };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { halloween, christmas, trees } = generateHolidays();
  const h = encode(halloween);
  const c = encode(christmas);
  const src = `// Generated by tools/gen_holidays.mjs - do not edit.\n// Seasonal decorations: [x, y, z, keyIndex] per cell (local coordinates), placed into air by mc/holidays.js.\n`
    + `export const HOLIDAY_DECOR = Object.freeze({\n  halloween: Object.freeze({ keys: ${JSON.stringify(h.keys)}, cells: Object.freeze(${JSON.stringify(h.flat)}) }),\n`
    + `  christmas: Object.freeze({ keys: ${JSON.stringify(c.keys)}, cells: Object.freeze(${JSON.stringify(c.flat)}) }),\n});\n`
    + `export const HOLIDAY_TREES = Object.freeze(${JSON.stringify(trees)});\n`;
  fs.writeFileSync(OUT, src);
  console.log(`holidays: halloween ${halloween.length} cells, christmas ${christmas.length} cells, trees ${trees.map((t) => `${t.room}@${t.x},${t.z}`).join(' ')}`);
}
