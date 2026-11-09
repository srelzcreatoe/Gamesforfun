// @ts-check
// Reachability map: a budgeted flood fill of standable cells around a player. Every vantage point,
// spawn point, ambush point and search spot is chosen from this map, so the creature only ever
// appears where it could physically have walked (no spawning inside sealed rooms or walls).
import { system } from "@minecraft/server";
import { now, getBlock, distXZ } from "../core/util.js";
import { idPassable } from "../core/blocks.js";

/** @typedef {{x:number,y:number,z:number,d:number,tall:boolean,water:boolean}} Cell */

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DYS = [0, 1, -1, -2, -3];

let running = 0;

/**
 * @param {import("@minecraft/server").Player} pl
 * @param {any} p runtime player state (p.nav receives the result)
 * @param {number} [maxNodes]
 */
export function requestNav(pl, p, maxNodes = 2400) {
  if (p.navBusy || running >= 2) return;
  const loc = pl.location;
  if (p.nav && now() - p.nav.t < 80 && distXZ(loc, p.nav.origin) < 5) return;
  p.navBusy = true;
  running++;
  const dim = pl.dimension;
  const origin = { x: Math.floor(loc.x), y: Math.floor(loc.y + 0.01), z: Math.floor(loc.z) };
  system.runJob(bfs(dim, origin, p, maxNodes));
}

/** @param {import("@minecraft/server").Dimension} dim */
function* bfs(dim, origin, p, maxNodes) {
  try {
    /** @type {Map<string, number>} 0 solid, 1 open, 2 lava, 3 water, 4 unknown/unloaded */
    const bc = new Map();
    let lookups = 0;
    const kind = (x, y, z) => {
      const k = x + "," + y + "," + z;
      let v = bc.get(k);
      if (v !== undefined) return v;
      const b = getBlock(dim, { x, y, z });
      lookups++;
      if (!b) v = 4;
      else {
        const id = b.typeId;
        if (id === "minecraft:lava" || id === "minecraft:flowing_lava") v = 2;
        else if (id === "minecraft:water" || id === "minecraft:flowing_water") v = 3;
        else if (b.isAir || idPassable(id)) v = 1;
        else v = 0;
      }
      bc.set(k, v);
      return v;
    };
    const open = (v) => v === 1 || v === 3;
    const standable = (x, y, z) => open(kind(x, y, z)) && open(kind(x, y + 1, z)) && kind(x, y - 1, z) === 0;

    // find a standable start near the player's feet
    let start = null;
    for (const dy of [0, 1, -1]) {
      if (standable(origin.x, origin.y + dy, origin.z)) { start = { x: origin.x, y: origin.y + dy, z: origin.z }; break; }
    }
    /** @type {Cell[]} */
    const cells = [];
    /** @type {Map<string, Cell>} */
    const map = new Map();
    if (start) {
      const q = [start];
      const s0 = { ...start, d: 0, tall: open(kind(start.x, start.y + 2, start.z)), water: kind(start.x, start.y, start.z) === 3 };
      map.set(start.x + "," + start.y + "," + start.z, s0);
      cells.push(s0);
      let qi = 0;
      while (qi < q.length && cells.length < maxNodes) {
        const c = q[qi++];
        const cd = map.get(c.x + "," + c.y + "," + c.z).d;
        for (const [dx, dz] of DIRS) {
          const nx = c.x + dx;
          const nz = c.z + dz;
          if (Math.abs(nx - origin.x) > 44 || Math.abs(nz - origin.z) > 44) continue;
          for (const dy of DYS) {
            const ny = c.y + dy;
            const k = nx + "," + ny + "," + nz;
            if (map.has(k)) break;
            if (dy === 1 && !open(kind(c.x, c.y + 2, c.z))) continue; // no head room to step up
            if (dy < 0) {
              // must be able to move horizontally first then drop
              if (!open(kind(nx, c.y, nz)) || !open(kind(nx, c.y + 1, nz))) break;
            }
            if (standable(nx, ny, nz)) {
              const cell = { x: nx, y: ny, z: nz, d: cd + 1, tall: open(kind(nx, ny + 2, nz)), water: kind(nx, ny, nz) === 3 };
              map.set(k, cell);
              cells.push(cell);
              q.push({ x: nx, y: ny, z: nz });
              break;
            }
          }
        }
        if (lookups > 60) { lookups = 0; yield; }
      }
    }
    p.nav = { t: now(), origin, cells, map, ok: !!start };
  } catch {
    p.nav = { t: now(), origin, cells: [], map: new Map(), ok: false };
  } finally {
    p.navBusy = false;
    running = Math.max(0, running - 1);
  }
}

/** @param {any} p @param {(c: Cell) => boolean} fn @returns {Cell[]} */
export function cellsWhere(p, fn) {
  if (!p.nav || !p.nav.cells) return [];
  return p.nav.cells.filter(fn);
}

/** @param {any} p @param {{x:number,y:number,z:number}} loc */
export function inNav(p, loc) {
  if (!p.nav || !p.nav.map) return false;
  return p.nav.map.has(Math.floor(loc.x) + "," + Math.floor(loc.y) + "," + Math.floor(loc.z));
}
