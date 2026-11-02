// @ts-check
// Finding the way for a creature it drives (1.4.0). Its puppets do not walk with their own legs while it has them —
// it moves them — so it finds their way itself, block by block, the way it finds its own through tight spaces:
//   straight      is the way straight to them walkable (steps up of one, drops of up to three, nothing in the way)?
//                 Then it goes straight at them.
//   search        otherwise a route (A*): round walls, up steps, down drops, through doors it opens, and up the face
//                 of a wall of up to five blocks — its puppets climb like it does. The search is spread over several
//                 ticks (a job) so a long one never stalls the game; until it is done the creature keeps coming.
//   chokepoint    a doorway or a gap a block or two wide ahead of someone running: where one of its pack waits.
// It depends on nothing but the world (and the list of doors), so anything can load it at any time.
import { system } from "@minecraft/server";
import { DANGER, DOORS, GATES } from "../core/constants.js";
import { safe, V } from "../core/util.js";

/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {{x:number,y:number,z:number,act?:"climb"|"door"|"drop"}} PathNode  a cell its feet pass through */

/** No collision: it walks through these as if they were air. */
const THROUGH = /^minecraft:(air|short_grass|tall_grass|fern|large_fern|snow_layer|deadbush|short_dry_grass|tall_dry_grass|leaf_litter|torch|soul_torch|redstone_torch|.+_button|lever|rail|.+_rail|redstone_wire|.+_pressure_plate|.+_sign|.+_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.+_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|.+_sapling|.+_mushroom|vine|glow_lichen|sculk_vein|.+_carpet|carpet|cave_vines.*|hanging_roots|sweet_berry_bush|.+_wall_banner|.+_banner|ladder|scaffolding)$/;
/** Taller than a block (fences, walls): neither through nor something to stand on top of. */
const TALL = /fence$|_wall$|^minecraft:(cobblestone_wall|mossy_cobblestone_wall|.+_fence|iron_bars|.+_pane|glass_pane|chain)$/;
const OPENABLE = new Set([...DOORS, ...GATES]);
const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

// cell kinds
const SOLID = 0, OPEN = 1, DOOR = 2, LIQUID = 3;

/**
 * A view of the world's cells, cached for one search or one check. @param {Dimension} dim
 */
function cells(dim) {
  /** @type {Map<string, number>} */
  const kinds = new Map();
  /** @type {Map<string, boolean>} */
  const floors = new Map();
  const kind = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    const k = `${x},${y},${z}`;
    let v = kinds.get(k);
    if (v !== undefined) return v;
    const b = safe(() => dim.getBlock({ x, y, z }));
    if (!b) v = SOLID;
    else if (b.isLiquid) v = LIQUID;
    else if (DANGER.has(b.typeId)) v = SOLID;
    else if (b.isAir || THROUGH.test(b.typeId)) v = OPEN;
    else if (OPENABLE.has(b.typeId)) v = safe(() => b.permutation.getState("open_bit"), false) ? OPEN : DOOR;
    else v = SOLID;
    kinds.set(k, v);
    return v;
  };
  /** Something to stand on, under (x,y,z). */
  const floor = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    const k = `${x},${y},${z}`;
    let v = floors.get(k);
    if (v !== undefined) return v;
    const b = safe(() => dim.getBlock({ x, y: y - 1, z }));
    v = !!b && !b.isAir && !b.isLiquid && !THROUGH.test(b.typeId) && !TALL.test(b.typeId) && !DANGER.has(b.typeId) && !OPENABLE.has(b.typeId);
    floors.set(k, v);
    return v;
  };
  /** Room for a body h cells tall with its feet in (x,y,z) (closed doors count as room: they are opened). */
  const room = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z, /** @type {number} */ h, doors = true) => {
    for (let i = 0; i < h; i++) {
      const k = kind(x, y + i, z);
      if (k === SOLID || k === LIQUID || (k === DOOR && !doors)) return false;
    }
    return true;
  };
  return { kind, floor, room };
}

/** The height in cells a creature needs (1 or 2; anything taller squeezes, as it does). @param {import("@minecraft/server").Entity} e */
export function bodyCells(e) {
  const h = safe(() => e.getHeadLocation().y - e.location.y, 1.5) ?? 1.5;
  return h < 0.9 ? 1 : 2;
}

/**
 * Is the way from `from` straight to `to` walkable — no wall, no step up of more than one, no drop of more than three,
 * no water? (Up to 48 blocks.) @param {Dimension} dim @param {Vec} from @param {Vec} to @param {number} [h]
 */
export function straight(dim, from, to, h = 2) {
  const c = cells(dim);
  const len = V.hdist(from, to);
  if (len > 48) return false;
  const dir = V.flat(V.sub(to, from));
  let y = Math.floor(from.y + 0.05);
  let lx = Math.floor(from.x), lz = Math.floor(from.z);
  for (let s = 0.5; s < len; s += 0.5) {
    const x = Math.floor(from.x + dir.x * s), z = Math.floor(from.z + dir.z * s);
    if (x === lx && z === lz) continue;
    // a diagonal step must not cut a corner
    if (x !== lx && z !== lz && !(c.room(x, y, lz, h, false) || c.room(lx, y, z, h, false))) return false;
    lx = x;
    lz = z;
    let ny;
    for (const dy of [0, 1, -1, -2, -3]) {
      const yy = y + dy;
      if (!c.room(x, yy, z, h, false) || !c.floor(x, yy, z)) continue;
      if (dy === 1 && !c.room(x - Math.sign(dir.x), y + h, z - Math.sign(dir.z), 1, false) && c.kind(x, y + h, z) !== OPEN) continue;
      ny = yy;
      break;
    }
    if (ny === undefined) return false;
    y = ny;
  }
  return Math.abs(y - Math.floor(to.y + 0.05)) <= 2;
}

/**
 * Search a route from `from` to `to` (A*), as a job: returns a generator to hand to system.runJob, which calls `done`
 * with the cells to pass through (the first is the next one) — or the route to the nearest cell it could reach.
 * @param {Dimension} dim @param {Vec} from @param {Vec} to
 * @param {{h?:number, climb?:number, doors?:boolean, radius?:number, maxNodes?:number, perTick?:number}} o
 * @param {(path:PathNode[]|undefined, reached:boolean)=>void} done
 */
export function* search(dim, from, to, o, done) {
  const h = o.h ?? 2;
  const climbMax = o.climb ?? 5;
  const doors = o.doors !== false;
  const radius = o.radius ?? 40;
  const maxNodes = o.maxNodes ?? 2500;
  const perTick = o.perTick ?? 120;
  const c = cells(dim);
  const sx = Math.floor(from.x), sy = Math.floor(from.y + 0.05), sz = Math.floor(from.z);
  const gx = Math.floor(to.x), gy = Math.floor(to.y + 0.05), gz = Math.floor(to.z);
  const H = (/** @type {number} */ x, /** @type {number} */ y, /** @type {number} */ z) => {
    const dx = Math.abs(x - gx), dz = Math.abs(z - gz);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz) + Math.abs(y - gy) * 0.8;
  };
  /** @type {Map<string, {x:number,y:number,z:number,g:number,prev:string|undefined,act?:PathNode["act"]}>} */
  const nodes = new Map();
  const startKey = `${sx},${sy},${sz}`;
  nodes.set(startKey, { x: sx, y: sy, z: sz, g: 0, prev: undefined });
  const open = heap();
  open.push(startKey, H(sx, sy, sz));
  const closed = new Set();
  let found, best = startKey, bestH = H(sx, sy, sz);
  let n = 0;
  while (open.size() && closed.size < maxNodes) {
    if (++n % perTick === 0) yield;
    const key = open.pop();
    if (closed.has(key)) continue;
    closed.add(key);
    const cur = nodes.get(key);
    if (!cur) continue;
    const hc = H(cur.x, cur.y, cur.z);
    if (hc < bestH) {
      bestH = hc;
      best = key;
    }
    if (Math.max(Math.abs(cur.x - gx), Math.abs(cur.z - gz)) <= 1 && Math.abs(cur.y - gy) <= 1) {
      found = key;
      break;
    }
    /** @param {number} x @param {number} y @param {number} z @param {number} cost @param {PathNode["act"]} [act] */
    const add = (x, y, z, cost, act) => {
      const k = `${x},${y},${z}`;
      if (closed.has(k)) return;
      const g = cur.g + cost;
      const old = nodes.get(k);
      if (old && old.g <= g) return;
      nodes.set(k, { x, y, z, g, prev: key, act });
      open.push(k, g + H(x, y, z));
    };
    for (const [dx, dz] of DIRS8) {
      const x = cur.x + dx, z = cur.z + dz;
      if (Math.abs(x - sx) > radius || Math.abs(z - sz) > radius) continue;
      const diag = dx !== 0 && dz !== 0;
      // no cutting corners on a diagonal
      if (diag && !(c.room(cur.x + dx, cur.y, cur.z, h, false) && c.room(cur.x, cur.y, cur.z + dz, h, false))) continue;
      const step = diag ? 1.414 : 1;
      let placed = false;
      // level, a step up (room above it first), or a drop of up to three
      for (const dy of [0, 1, -1, -2, -3]) {
        const y = cur.y + dy;
        if (!c.room(x, y, z, h, doors && !diag) || !c.floor(x, y, z)) continue;
        if (dy === 1 && !c.room(cur.x, cur.y + h, cur.z, 1, false)) continue;
        if (dy < 0) {
          let clear = true;
          for (let yy = y + h; yy < cur.y + h; yy++) if (!c.room(x, yy, z, 1, false)) clear = false;
          if (!clear) continue;
        }
        const door = c.kind(x, y, z) === DOOR || c.kind(x, y + 1, z) === DOOR;
        add(x, y, z, step + (dy === 1 ? 0.3 : dy < 0 ? 0.2 * -dy : 0) + (door ? 2 : 0), door ? "door" : dy < -1 ? "drop" : undefined);
        placed = true;
        break;
      }
      if (placed || diag || climbMax < 2) continue;
      // a wall: up its face (room all the way up beside it, and at the top) — it climbs, as it does
      for (let k = 2; k <= climbMax; k++) {
        const y = cur.y + k;
        if (!c.room(cur.x, cur.y + h, cur.z, k, false)) break;
        if (c.room(x, y, z, h, false) && c.floor(x, y, z)) {
          add(x, y, z, 2 + k * 1.2, "climb");
          break;
        }
      }
    }
  }
  const end = found ?? best;
  if (end === startKey) {
    done(undefined, false);
    return;
  }
  /** @type {PathNode[]} */
  const path = [];
  for (let k = end; k && k !== startKey; k = nodes.get(k)?.prev) {
    const nd = nodes.get(k);
    if (!nd) break;
    path.push({ x: nd.x, y: nd.y, z: nd.z, act: nd.act });
  }
  done(path.reverse(), !!found);
}

/**
 * Start a search as a job (spread over ticks). @param {Dimension} dim @param {Vec} from @param {Vec} to
 * @param {Parameters<typeof search>[3]} o @param {(path:PathNode[]|undefined, reached:boolean)=>void} done
 */
export function plan(dim, from, to, o, done) {
  try {
    system.runJob(search(dim, from, to, o, done));
  } catch {
    done(undefined, false);
  }
}

/**
 * A doorway or a gap one or two blocks wide (walls on both sides) ahead of someone running, 5-14 blocks on, along
 * `dir` (give or take 35°). @param {Dimension} dim @param {Vec} at @param {Vec} dir horizontal unit vector
 * @returns {Vec|undefined} where to stand in it (feet)
 */
export function chokepoint(dim, at, dir) {
  const c = cells(dim);
  for (let d = 5; d <= 14; d++) {
    for (const off of [0, 20, -20, 35, -35]) {
      const v = V.rotY(dir, off);
      const x = Math.floor(at.x + v.x * d), z = Math.floor(at.z + v.z * d);
      for (const dy of [0, 1, -1, 2, -2]) {
        const y = Math.floor(at.y + 0.05) + dy;
        if (!c.room(x, y, z, 2) || !c.floor(x, y, z)) continue;
        if (c.kind(x, y, z) === DOOR || OPENABLE.has(safe(() => dim.getBlock({ x, y, z })?.typeId, "") ?? "")) return { x: x + 0.5, y, z: z + 0.5 };
        // across the way (perpendicular to it): open cells to each side until a wall
        const ax = Math.abs(v.x) > Math.abs(v.z) ? 0 : 1, az = ax === 0 ? 1 : 0;
        let left = 0, right = 0, lw = false, rw = false;
        for (let i = 1; i <= 3; i++) {
          if (c.room(x + ax * i, y, z + az * i, 2, false)) left++;
          else {
            lw = true;
            break;
          }
        }
        for (let i = 1; i <= 3; i++) {
          if (c.room(x - ax * i, y, z - az * i, 2, false)) right++;
          else {
            rw = true;
            break;
          }
        }
        if (lw && rw && left + right + 1 <= 2) return { x: x + 0.5, y, z: z + 0.5 };
        break;
      }
    }
  }
  return undefined;
}

/** A binary min-heap of keys by priority. */
function heap() {
  /** @type {[number, string][]} */
  const a = [];
  return {
    size: () => a.length,
    /** @param {string} k @param {number} f */
    push(k, f) {
      a.push([f, k]);
      for (let i = a.length - 1; i > 0;) {
        const pi = (i - 1) >> 1;
        if (a[pi][0] <= a[i][0]) break;
        [a[pi], a[i]] = [a[i], a[pi]];
        i = pi;
      }
    },
    pop() {
      const top = a[0];
      const last = a.pop();
      if (a.length && last) {
        a[0] = last;
        for (let i = 0; ;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < a.length && a[l][0] < a[m][0]) m = l;
          if (r < a.length && a[r][0] < a[m][0]) m = r;
          if (m === i) break;
          [a[m], a[i]] = [a[i], a[m]];
          i = m;
        }
      }
      return top[1];
    },
  };
}
