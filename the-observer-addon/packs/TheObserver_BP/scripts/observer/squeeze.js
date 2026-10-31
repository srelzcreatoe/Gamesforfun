// @ts-check
// Tight spaces. When it cannot get any closer to someone it is coming for — a wall with a hole a block
// high, a closed door, a window, a crawlspace — it finds its own way through: it opens doors, breaks glass
// and leaves out of its way, and crawls flat on its front through gaps a single block high. Its walking AI
// cannot do this (its body is three blocks tall), so the route is searched here, block by block, and the
// body is moved along it. Every door and broken block is in the ledger: put back afterwards, nothing dropped,
// never inside a Ward Lantern's radius. Opening doors needs manipulation 1+, breaking blocks 2+.
import { BlockPermutation } from "@minecraft/server";
import * as body from "./body.js";
import * as ledger from "../world/ledger.js";
import { manip, OPENABLE } from "../world/manipulate.js";
import { isWarded } from "../world/space.js";
import { DOORS, DANGER } from "../core/constants.js";
import { V, safe, dimIndex, emit } from "../core/util.js";

/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {{x:number,y:number,z:number,act?:"break"|"door",tight:boolean}} Node */

/** What it will break out of its way. */
const BREAKABLE = /glass|leaves|^minecraft:(web|vine|.+_carpet|bamboo|.+_pane)$/;
/** No collision: it moves through these as if they were air. */
const THROUGH = /^minecraft:(air|short_grass|tall_grass|fern|large_fern|snow_layer|deadbush|short_dry_grass|tall_dry_grass|leaf_litter|torch|soul_torch|redstone_torch|.+_button|lever|rail|.+_rail|redstone_wire|.+_pressure_plate|.+_sign|.+_flower|dandelion|poppy|blue_orchid|allium|azure_bluet|.+_tulip|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|.+_sapling|.+_mushroom)$/;
const MAX_NODES = 5000;
const RADIUS = 28;

/** @param {import("@minecraft/server").Block|undefined} b */
const through = (b) => !!b && (b.isAir || THROUGH.test(b.typeId));

/**
 * Search a way to `to` through tight spaces. @param {import("@minecraft/server").Dimension} dim
 * @param {Vec} from @param {Vec} to
 * @returns {Node[]|undefined} cells to pass through, in order (the first is the next one)
 */
export function plan(dim, from, to) {
  const d = dimIndex(dim.id);
  const level = manip();
  /** @type {Map<string, number>} 0 solid, 1 open, 2 door, 3 breakable */
  const cache = new Map();
  const kind = (x, y, z) => {
    const k = `${x},${y},${z}`;
    let v = cache.get(k);
    if (v !== undefined) return v;
    const b = safe(() => dim.getBlock({ x, y, z }));
    if (!b || b.isLiquid || DANGER.has(b.typeId)) v = 0;
    else if (through(b)) v = 1;
    else if (OPENABLE.has(b.typeId) && level >= 1) v = safe(() => b.permutation.getState("open_bit"), false) ? 1 : 2;
    else if (BREAKABLE.test(b.typeId) && level >= 2 && !isWarded(d, { x, y, z })) v = 3;
    else v = 0;
    cache.set(k, v);
    return v;
  };
  // something to lie on: not air, not something it would fall through
  const floor = (x, y, z) => {
    const b = safe(() => dim.getBlock({ x, y: y - 1, z }));
    return !!b && !b.isAir && !through(b) && !b.isLiquid;
  };
  const sx = Math.floor(from.x), sy = Math.floor(from.y), sz = Math.floor(from.z);
  const gx = Math.floor(to.x), gy = Math.floor(to.y), gz = Math.floor(to.z);
  const h = (x, y, z) => Math.abs(x - gx) + Math.abs(z - gz) + Math.abs(y - gy);
  /** @type {Map<string, {x:number,y:number,z:number,g:number,f:number,prev:string|undefined,k:number}>} */
  const nodes = new Map();
  const startKey = `${sx},${sy},${sz}`;
  nodes.set(startKey, { x: sx, y: sy, z: sz, g: 0, f: h(sx, sy, sz), prev: undefined, k: 1 });
  const open = heap();
  open.push(startKey, nodes.get(startKey).f);
  const closed = new Set();
  let found;
  while (open.size() && closed.size < MAX_NODES) {
    const key = open.pop();
    if (closed.has(key)) continue;
    closed.add(key);
    const n = nodes.get(key);
    if (Math.abs(n.x - gx) + Math.abs(n.z - gz) <= 1 && Math.abs(n.y - gy) <= 1) {
      found = key;
      break;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = n.x + dx, nz = n.z + dz;
      if (Math.abs(nx - sx) > RADIUS || Math.abs(nz - sz) > RADIUS) continue;
      for (const dy of [0, 1, -1]) {
        const ny = n.y + dy;
        const k = kind(nx, ny, nz);
        if (k === 0 || !floor(nx, ny, nz)) continue;
        // stepping up needs room above where it is; stepping down, room above where it goes
        if (dy === 1 && kind(n.x, n.y + 1, n.z) !== 1) continue;
        if (dy === -1 && kind(nx, ny + 1, nz) === 0) continue;
        const nk = `${nx},${ny},${nz}`;
        if (closed.has(nk)) continue;
        const tight = kind(nx, ny + 1, nz) === 0 || kind(nx, ny + 2, nz) === 0;
        const g = n.g + 1 + (k === 3 ? 3 : k === 2 ? 1 : 0) + (tight ? 0.4 : 0);
        const old = nodes.get(nk);
        if (old && old.g <= g) continue;
        nodes.set(nk, { x: nx, y: ny, z: nz, g, f: g + h(nx, ny, nz), prev: key, k });
        open.push(nk, g + h(nx, ny, nz));
        break; // one height per direction: the first that works
      }
    }
  }
  if (!found) return undefined;
  /** @type {Node[]} */
  const path = [];
  for (let k = found; k && k !== startKey; k = nodes.get(k).prev) {
    const n = nodes.get(k);
    // lower than three blocks once doors are open and glass is broken: it crawls
    const tight = kind(n.x, n.y + 1, n.z) === 0 || kind(n.x, n.y + 2, n.z) === 0;
    path.push({ x: n.x, y: n.y, z: n.z, act: n.k === 3 ? "break" : n.k === 2 ? "door" : undefined, tight });
  }
  return path.reverse();
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

/** Does the plan need anything its walking AI could not do (a door, glass, a low gap)? @param {Node[]} path */
export const special = (path) => path.some((n) => n.act || n.tight);

/**
 * Move along a planned way: doors opened, blocks broken out of the way, flat on its front wherever the gap is
 * lower than three blocks. Stops when it is within reach of the target, when the target moves well away from
 * where the plan led, or when the way turns out to be blocked after all.
 * @param {import("../director/encounter.js").Encounter} enc @param {Node[]} path
 * @returns {Promise<"reached"|"done"|"replan"|"blocked">}
 */
export async function traverse(enc, path) {
  const p = enc.p;
  const dim = enc.dim;
  const goal = { ...p.location };
  body.setMode("still");
  let broke = 0, doors = 0, crawled = false;
  /** a block or the upper half of the gap that has to go */
  const clear = (loc) => {
    const b = safe(() => dim.getBlock(loc));
    if (!b || through(b)) return true;
    if (OPENABLE.has(b.typeId)) {
      if (safe(() => b.permutation.getState("open_bit"), false)) return true;
      const ok = enc.toggle(loc) !== undefined;
      if (ok) {
        doors++;
        enc.worldSound(DOORS.has(b.typeId) ? "random.door_open" : "random.wood_click", loc, 1);
      }
      return ok;
    }
    if (BREAKABLE.test(b.typeId)) {
      const sound = /glass|pane/.test(b.typeId) ? "random.glass" : "dig.grass";
      const e = ledger.change(dim, loc, BlockPermutation.resolve("minecraft:air"), {
        enc: enc.id, kind: "break", restoreIn: enc.restoreDelay + 600, flags: ledger.F.NODROP, expect: (x) => x.typeId === b.typeId,
      });
      if (e) {
        broke++;
        enc.worldSound(sound, loc, 1);
      }
      return !!e;
    }
    return false;
  };
  for (let i = 0; i < path.length; i++) {
    enc.check();
    const n = path[i];
    if (!body.get() || !p.isValid) return "blocked";
    const cell = { x: n.x, y: n.y, z: n.z };
    // whatever is in the way: the cell itself, and above it while it is standing
    if (!clear(cell)) return "blocked";
    if (n.act === "door" || n.act === "break") await enc.wait(4);
    const crawl = n.tight;
    if (!crawl) for (const dy of [1, 2]) clear({ x: n.x, y: n.y + dy, z: n.z });
    body.setCrawl(crawl);
    body.setState(crawl ? "crawl" : "surge");
    crawled ||= crawl;
    const next = path[Math.min(path.length - 1, i + 1)];
    const at = { x: n.x + 0.5, y: n.y, z: n.z + 0.5 };
    const look = i + 1 < path.length ? { x: next.x + 0.5, y: next.y + (crawl ? 0.4 : 3), z: next.z + 0.5 } : p.getHeadLocation();
    body.moveTo(at, look);
    await enc.wait(crawl ? 4 : 3);
    // in reach — and through: it does not strike from the gap, it comes in and stands up first
    if (!crawl && V.dist(at, p.location) <= 2.6) break;
    if (V.dist(p.location, goal) > 5) {
      finish();
      return "replan";
    }
  }
  finish();
  return V.dist(body.loc() ?? goal, p.location) <= 3 ? "reached" : "done";

  function finish() {
    // it stands up again where there is room for it
    const l = body.loc();
    const room = l && [1, 2].every((dy) => through(safe(() => dim.getBlock({ x: l.x, y: l.y + dy, z: l.z }))));
    if (room) body.setCrawl(false);
    enc.emit("squeeze", { what: "through", steps: path.length, broke, doors, crawled, standing: !!room });
  }
}

/**
 * Inside an attack or a chase loop: is it stuck short of the target? Call every tick of the loop with the
 * current distance; when it has made no headway for 1.5 s, plan a way through and take it.
 * @param {import("../director/encounter.js").Encounter} enc @param {{best:number, since:number}} track
 * @param {number} t loop clock (ticks) @param {number} d distance to the target
 * @returns {Promise<boolean>} it moved along a planned way (the caller should carry on from where it is now)
 */
export async function unstick(enc, track, t, d) {
  if (d < track.best - 0.75) {
    track.best = d;
    track.since = t;
    return false;
  }
  if (t - track.since < 30 || d > RADIUS) return false;
  track.since = t;
  const l = body.loc();
  if (!l) return false;
  const path = plan(enc.dim, l, enc.p.location);
  if (!path || !path.length || !special(path)) return false;
  emit("squeeze", { what: "plan", steps: path.length, doors: path.filter((n) => n.act === "door").length, breaks: path.filter((n) => n.act === "break").length, tight: path.filter((n) => n.tight).length });
  enc.data.squeezed = true;
  await traverse(enc, path);
  track.best = V.dist(body.loc() ?? l, enc.p.location);
  track.since = t;
  return true;
}
