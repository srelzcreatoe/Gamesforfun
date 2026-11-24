// @ts-nocheck
// The Brinesleeper's own pathfinder (7.0): an A* search over the blocks around it, made for its body.
//   * it walks, wades shallow water, steps up one block, climbs ledges of two or three blocks (long arms), and drops
//     from up to six; it fits wherever there are two blocks of room (on all fours) and stands where there are four
//   * the world is read sixteen blocks at a time (one call per 16x16x16 section, cached), never block by block, so a
//     search across a cave costs a few milliseconds; a search runs a little each tick until it is done
//   * the path is pulled straight wherever the ground allows, so it heads for you, it does not zig-zag along a grid
// Exported: findPath (a generator, stepped by the brain), cellAt, standable, headroomAt, lineClear, forget.
import { world, system, BlockVolume } from '@minecraft/server';

// what its body goes through (everything else is a wall or a floor); every id checked against the game's block list
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown',
  'green', 'red', 'black'];
const OPEN = ['minecraft:air', 'minecraft:structure_void', 'minecraft:cave_vines', 'minecraft:cave_vines_body_with_berries',
  'minecraft:cave_vines_head_with_berries', 'minecraft:glow_lichen', 'minecraft:weeping_vines', 'minecraft:twisting_vines', 'minecraft:hanging_roots',
  'minecraft:moss_carpet', 'minecraft:short_grass', 'minecraft:tall_grass', 'minecraft:fern', 'minecraft:large_fern', 'minecraft:deadbush',
  'minecraft:torch', 'minecraft:soul_torch', 'minecraft:redstone_torch', 'minecraft:unlit_redstone_torch', 'minecraft:ladder', 'minecraft:vine',
  'minecraft:sculk_vein', 'minecraft:snow_layer', 'minecraft:rail', 'minecraft:golden_rail', 'minecraft:detector_rail', 'minecraft:activator_rail',
  'minecraft:red_mushroom', 'minecraft:brown_mushroom', 'minecraft:spore_blossom', 'minecraft:small_dripleaf_block', 'minecraft:seagrass',
  'minecraft:kelp', 'minecraft:bubble_column', 'minecraft:web', 'minecraft:redstone_wire', 'minecraft:lever', 'minecraft:stone_button',
  'minecraft:wooden_button', 'minecraft:standing_sign', 'minecraft:wall_sign', 'minecraft:candle', ...COLORS.map((c) => `minecraft:${c}_candle`),
  'minecraft:poppy', 'minecraft:dandelion', 'minecraft:blue_orchid', 'minecraft:azure_bluet', 'minecraft:oxeye_daisy', 'minecraft:cornflower',
  'minecraft:lily_of_the_valley', 'minecraft:sweet_berry_bush', 'minecraft:light_block_15', 'minecraft:pink_petals', 'minecraft:crimson_roots',
  'minecraft:warped_roots', 'minecraft:nether_sprouts', 'minecraft:fire', 'minecraft:soul_fire',
  'brine:bloodroot', 'brine:pallid_cap', 'brine:bone_coral'];
const WATER = ['minecraft:water', 'minecraft:flowing_water'];
export const SOLID = 0, AIR = 1, WET = 2;
const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

// ------------------------------------------------------------------ the world, sixteen blocks at a time
const sections = new Map();                                         // key -> { data: Uint8Array(4096), used: tick }
let openList = OPEN;
let tickNow = 0;
const skey = (sx, sy, sz) => ((sx + 8192) * 16384 + (sz + 8192)) * 64 + (sy + 32);
let lastKey = -1, lastData = null;
function loadSection(dim, sx, sy, sz) {
  const k = skey(sx, sy, sz);
  if (k === lastKey) return lastData;
  const have = sections.get(k);
  if (have) { have.used = tickNow; lastKey = k; lastData = have.data; return have.data; }
  if (sy < -4 || sy > 19) return null;                              // outside the world: solid
  const min = { x: sx * 16, y: sy * 16, z: sz * 16 };
  try { if (!dim.isChunkLoaded(min)) return null; } catch (e) { return null; }
  const data = new Uint8Array(4096);
  const max = { x: min.x + 15, y: min.y + 15, z: min.z + 15 };
  const fill = (types, v) => {
    const list = dim.getBlocks(new BlockVolume(min, max), { includeTypes: types }, true);
    for (const l of list.getBlockLocationIterator()) data[(l.x - min.x) + ((l.z - min.z) << 4) + ((l.y - min.y) << 8)] = v;
  };
  try { fill(openList, AIR); }
  catch (e) {
    if (openList === OPEN) { openList = ['minecraft:air']; try { fill(openList, AIR); } catch (e2) { return null; } } else return null;
  }
  try { fill(WATER, WET); } catch (e) { /* no water here */ }
  sections.set(k, { data, used: tickNow });
  lastKey = k;
  lastData = data;
  if (sections.size > 3000) {                                       // forget the sections nobody has needed for longest
    const old = [...sections.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, 800);
    for (const [ok] of old) sections.delete(ok);
  }
  return data;
}
/** SOLID, AIR (anything it passes through) or WET, for one block */
export function cellAt(dim, x, y, z) {
  const data = loadSection(dim, x >> 4, y >> 4, z >> 4);
  if (!data) return SOLID;
  return data[(x & 15) + ((z & 15) << 4) + ((y & 15) << 8)];
}
/** a block changed (a player built or broke something): read that section again next time */
export function forget(x, y, z) { sections.delete(skey(x >> 4, y >> 4, z >> 4)); lastKey = -1; }
/** is this part of the world already read? (so a search can read the rest a little at a time) */
const known = (x, y, z) => sections.has(skey(x >> 4, y >> 4, z >> 4));
const changed = ({ block }) => { const l = block?.location; if (l) forget(l.x, l.y, l.z); };
world.afterEvents.playerBreakBlock.subscribe(changed);
world.afterEvents.playerPlaceBlock.subscribe(changed);
system.runInterval(() => { tickNow = system.currentTick; }, 1);
system.runInterval(() => { for (const [k, s] of sections) if (tickNow - s.used > 2400) sections.delete(k); lastKey = -1; }, 1200);

/** room above a place it could stand (water counts as room), up to 5 */
export function headroomAt(dim, x, y, z) {
  let n = 0;
  while (n < 5 && cellAt(dim, x, y + n, z) !== SOLID) n++;
  return n;
}
/** it can stand here: ground under its feet and at least two blocks of room */
export function standable(dim, x, y, z) {
  return cellAt(dim, x, y - 1, z) === SOLID && cellAt(dim, x, y, z) !== SOLID && cellAt(dim, x, y + 1, z) !== SOLID;
}
/** the nearest place to stand at (or just under, or just over) a position */
export function standNear(dim, p) {
  const x = Math.floor(p.x), z = Math.floor(p.z), y = Math.floor(p.y + 0.5);
  for (const dy of [0, -1, 1, -2, 2, -3]) if (standable(dim, x, y + dy, z)) return { x, y: y + dy, z };
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (const dy of [0, -1, 1]) {
    if (standable(dim, x + dx, y + dy, z + dz)) return { x: x + dx, y: y + dy, z: z + dz };
  }
  return undefined;
}

// ------------------------------------------------------------------ the search
class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(n) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}
const nkey = (x, y, z) => ((x + 1048576) * 2097152 + (z + 1048576)) * 512 + (y + 128);

/** the place it reaches stepping from (x, y, z) in direction (dx, dz), or undefined: { y, cost, climb } */
function stepTo(dim, x, y, z, dx, dz) {
  const nx = x + dx, nz = z + dz;
  if (dx && dz) {                                                   // diagonal: never through a corner
    for (const yy of [y, y + 1]) if (cellAt(dim, x + dx, yy, z) === SOLID || cellAt(dim, x, yy, z + dz) === SOLID) return undefined;
  }
  if (standable(dim, nx, y, nz)) return { y, cost: 0, climb: false };                   // level
  if (cellAt(dim, nx, y, nz) !== SOLID && cellAt(dim, nx, y + 1, nz) !== SOLID) {        // open ahead: it drops to the floor
    for (let dy = -1; dy >= -6; dy--) {
      if (standable(dim, nx, y + dy, nz)) return { y: y + dy, cost: 0.25 * -dy, climb: false };
      if (cellAt(dim, nx, y + dy, nz) === SOLID) return undefined;
    }
    return undefined;                                               // deeper than six: not that way
  }
  for (let dy = 1; dy <= 3; dy++) {                                 // a wall: up one, or climb two or three (room above it here)
    if (cellAt(dim, x, y + 1 + dy, z) === SOLID) return undefined;
    if (standable(dim, nx, y + dy, nz)) return { y: y + dy, cost: dy === 1 ? 0.4 : 1.6 * dy, climb: dy >= 2 };
  }
  return undefined;
}

/**
 * A path from `from` toward `to` (positions of its feet). A generator: each next() does a slice of the search and yields;
 * when it is done it returns { pts, complete } (pts: [{x, y, z, c, w, climb}]) or undefined if there is nowhere to go.
 * opts: { max: nodes, radius: blocks, near: how close counts as there }
 */
export function* findPath(dim, from, to, opts = {}) {
  const max = opts.max ?? 3000, radius = opts.radius ?? 56, near = opts.near ?? 1.6;
  // read the ground between here and there first, a few sections per tick
  const x0 = Math.floor(Math.min(from.x, to.x)) - 12, x1 = Math.floor(Math.max(from.x, to.x)) + 12;
  const z0 = Math.floor(Math.min(from.z, to.z)) - 12, z1 = Math.floor(Math.max(from.z, to.z)) + 12;
  const y0 = Math.floor(Math.min(from.y, to.y)) - 8, y1 = Math.floor(Math.max(from.y, to.y)) + 8;
  let loads = 0;
  for (let sx = x0 >> 4; sx <= x1 >> 4 && sx - (x0 >> 4) < 6; sx++) for (let sz = z0 >> 4; sz <= z1 >> 4 && sz - (z0 >> 4) < 6; sz++) {
    for (let sy = y0 >> 4; sy <= y1 >> 4 && sy - (y0 >> 4) < 3; sy++) {
      if (known(sx * 16, sy * 16, sz * 16)) continue;
      loadSection(dim, sx, sy, sz);
      if (++loads % 4 === 0) yield;
    }
  }
  const s = standNear(dim, from);
  if (!s) return undefined;
  const gx = Math.floor(to.x), gy = Math.floor(to.y + 0.5), gz = Math.floor(to.z);
  const h = (x, y, z) => {
    const ax = Math.abs(x - gx), az = Math.abs(z - gz);
    return Math.max(ax, az) + 0.414 * Math.min(ax, az) + 0.6 * Math.abs(y - gy);
  };
  const start = { x: s.x, y: s.y, z: s.z, g: 0, f: h(s.x, s.y, s.z), parent: null, climb: false };
  const open = new Heap();
  open.push(start);
  const best = new Map([[nkey(s.x, s.y, s.z), 0]]);
  let closest = start, closestH = start.f, expanded = 0, slice = 0;
  while (open.size) {
    const n = open.pop();
    if (n.g > (best.get(nkey(n.x, n.y, n.z)) ?? Infinity)) continue;
    const hn = h(n.x, n.y, n.z);
    if (hn < closestH) { closest = n; closestH = hn; }
    if (Math.hypot(n.x - gx, n.z - gz) <= near && Math.abs(n.y - gy) <= 2) return finish(dim, n, true);
    if (++expanded > max) break;
    if (++slice >= 120) { slice = 0; yield; }                       // a slice per tick (more if there is time)
    const roomHere = headroomAt(dim, n.x, n.y, n.z);
    for (const [dx, dz, base] of DIRS) {
      const st = stepTo(dim, n.x, n.y, n.z, dx, dz);
      if (!st) continue;
      const nx = n.x + dx, nz = n.z + dz, ny = st.y;
      if (Math.abs(nx - s.x) > radius || Math.abs(nz - s.z) > radius) continue;
      const room = headroomAt(dim, nx, ny, nz);
      const wet = cellAt(dim, nx, ny, nz) === WET;
      let cost = base + st.cost;
      if (room < 4) cost *= 1.5;                                    // on all fours: slower, it prefers to stand
      if (wet) cost *= 1.3;
      if (roomHere < 2 + Math.max(0, ny - n.y)) continue;
      const g = n.g + cost;
      const k = nkey(nx, ny, nz);
      if (g >= (best.get(k) ?? Infinity)) continue;
      best.set(k, g);
      open.push({ x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), parent: n, climb: st.climb });
    }
  }
  return closest === start ? undefined : finish(dim, closest, false);
}

/** cells to points, then pulled straight wherever the ground between allows */
function finish(dim, end, complete) {
  const cells = [];
  for (let n = end; n; n = n.parent) cells.push(n);
  cells.reverse();
  const pts = cells.map((n) => ({ x: n.x + 0.5, y: n.y, z: n.z + 0.5, c: headroomAt(dim, n.x, n.y, n.z),
    w: cellAt(dim, n.x, n.y, n.z) === WET, climb: n.climb, floor: true, gap: false }));
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = Math.min(pts.length - 1, i + 10);
    for (; j > i + 1; j--) {
      if (pts.slice(i + 1, j + 1).some((p) => p.climb || p.y !== pts[i].y)) continue;   // only flat ground is pulled straight
      if (lineClear(dim, pts[i], pts[j], Math.min(...pts.slice(i, j + 1).map((p) => p.c)))) break;
    }
    out.push(pts[j]);
    i = j;
  }
  return { pts: out.slice(1), complete };
}

/** can it go straight from a to b over the ground (steps of one, no room lower than `room`)? */
export function lineClear(dim, a, b, room = 2) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(1, Math.ceil(d / 0.25));
  let y = Math.floor(a.y + 0.5);
  for (let i = 1; i <= steps; i++) {
    const x = Math.floor(a.x + (b.x - a.x) * i / steps), z = Math.floor(a.z + (b.z - a.z) * i / steps);
    let ok = false;
    for (const dy of [0, 1, -1]) {
      if (standable(dim, x, y + dy, z) && headroomAt(dim, x, y + dy, z) >= Math.min(room, 4)) { y += dy; ok = true; break; }
    }
    if (!ok) return false;
  }
  return true;
}
