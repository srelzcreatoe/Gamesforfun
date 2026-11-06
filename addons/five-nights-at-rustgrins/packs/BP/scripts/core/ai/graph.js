// Route-graph helpers for the animatronic AI: neighbours, edge lengths, weighted shortest
// paths and distance fields over data/nodes.js. Only node ids, edges and node flags are
// used (door / window / vent / crawl / dark / pose), never hard-coded coordinates, so the
// AI keeps working when the map's coordinates, edges or waypoints change.
// Pure (no @minecraft imports). Results are deterministic: neighbours are visited in the
// order data/nodes.js lists the edges, ties keep the first path found.

import { NODES, ADJ, pathBetween } from '../../data/nodes.js';
import { CAMERA_BY_ID, CAMS_FOR_NODE } from '../../data/cameras.js';

const lenCache = new Map();
const nbCache = new Map();
const camCache = new Map();
const fieldCache = new Map();

/** Walking length of the edge a-b in blocks (Infinity when they are not adjacent). */
export function edgeLength(a, b) {
  const key = `${a}|${b}`;
  let l = lenCache.get(key);
  if (l !== undefined) return l;
  const p = pathBetween(a, b);
  if (!p) l = Infinity;
  else {
    l = 0;
    for (let i = 1; i < p.length; i++) l += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i][2] - p[i - 1][2]);
  }
  lenCache.set(key, l);
  return l;
}

/** @returns {readonly string[]} */
export function neighbors(n) {
  let out = nbCache.get(n);
  if (!out) {
    out = Object.freeze(Object.keys(ADJ[n] ?? {}).filter((m) => !!NODES[m]));
    nbCache.set(n, out);
  }
  return out;
}

export function adjacent(a, b) {
  return !!ADJ[a]?.[b];
}

/** Working video cameras that show this node (audio-only feeds do not count). */
export function videoCams(n) {
  let out = camCache.get(n);
  if (!out) {
    out = Object.freeze((CAMS_FOR_NODE[n] ?? []).filter((id) => CAMERA_BY_ID[id] && !CAMERA_BY_ID[id].audioOnly));
    camCache.set(n, out);
  }
  return out;
}

/** No video camera sees it: the kitchen, the nook, the dark corners. */
export function isDark(n) {
  return videoCams(n).length === 0;
}

export const isCrawl = (n) => !!NODES[n]?.crawl;
export const isStage = (n) => NODES[n]?.pose === 'stage';
/** The side of the office a door / window node opens onto ('L' | 'R'), or null. */
export const doorSide = (n) => NODES[n]?.door ?? null;
/** The side of the office a vent node drops into ('L' | 'R'), or null. */
export const ventSide = (n) => NODES[n]?.vent ?? null;

/** Every door / window node of the office, by side. */
export const DOOR_NODES = Object.freeze({
  L: Object.freeze(Object.keys(NODES).filter((n) => NODES[n].door === 'L')),
  R: Object.freeze(Object.keys(NODES).filter((n) => NODES[n].door === 'R')),
});

/**
 * Weighted shortest path (Dijkstra). `cost(a, b)` adds to the walking length of each step
 * (Infinity forbids it); `blocked(n)` keeps the path out of a node (never the start or the goal).
 * @param {string} from
 * @param {string | ((n: string) => boolean)} goal a node id, or a predicate for "any of these"
 * @param {{ cost?: (a: string, b: string) => number, blocked?: (n: string) => boolean }} [o]
 * @returns {string[] | null} from ... goal inclusive
 */
export function planPath(from, goal, { cost, blocked } = {}) {
  if (!NODES[from]) return null;
  const isGoal = typeof goal === 'function' ? goal : (n) => n === goal;
  if (isGoal(from)) return [from];
  const dist = new Map([[from, 0]]);
  const prev = new Map();
  const done = new Set();
  const open = [from];
  let found = null;
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const u = open[bi];
    open.splice(bi, 1);
    if (done.has(u)) continue;
    done.add(u);
    if (isGoal(u)) {
      found = u;
      break;
    }
    const du = dist.get(u);
    for (const v of neighbors(u)) {
      if (done.has(v)) continue;
      if (!isGoal(v) && blocked?.(v)) continue;
      const c = edgeLength(u, v) + (cost ? cost(u, v) : 0);
      if (!(c < Infinity)) continue;
      const nd = du + Math.max(0, c);
      if (nd < (dist.get(v) ?? Infinity)) {
        dist.set(v, nd);
        prev.set(v, u);
        open.push(v);
      }
    }
  }
  if (!found) return null;
  const out = [found];
  while (out[0] !== from) out.unshift(prev.get(out[0]));
  return out;
}

/** Total walking length of a node list. */
export function pathLength(nodes) {
  let l = 0;
  for (let i = 1; i < nodes.length; i++) l += edgeLength(nodes[i - 1], nodes[i]);
  return l;
}

/**
 * Walking distance from every node to the nearest of `targets` (cached), crawling only
 * where `crawl` is true. Unreachable nodes are missing from the map.
 * @param {readonly string[]} targets
 */
export function distanceField(targets, crawl = false) {
  const key = `${targets.join(',')}|${crawl}`;
  let d = fieldCache.get(key);
  if (d) return d;
  d = new Map();
  const open = [];
  for (const t of targets) {
    if (!NODES[t]) continue;
    d.set(t, 0);
    open.push(t);
  }
  const done = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (d.get(open[i]) < d.get(open[bi])) bi = i;
    const u = open[bi];
    open.splice(bi, 1);
    if (done.has(u)) continue;
    done.add(u);
    for (const v of neighbors(u)) {
      if (!crawl && isCrawl(v)) continue;
      const nd = d.get(u) + edgeLength(u, v);
      if (nd < (d.get(v) ?? Infinity)) {
        d.set(v, nd);
        open.push(v);
      }
    }
  }
  fieldCache.set(key, d);
  return d;
}

/** Walking distance from a node to that side's door / window (Infinity when cut off). */
export function distToDoor(n, side) {
  return distanceField(DOOR_NODES[side]).get(n) ?? Infinity;
}

/** Walking distance to the nearer office door. */
export function distToOffice(n) {
  return Math.min(distToDoor(n, 'L'), distToDoor(n, 'R'));
}

/** Which half of the building a walkable node belongs to: 'L', 'R', or null (the middle). */
export function sideOf(n) {
  const l = distToDoor(n, 'L');
  const r = distToDoor(n, 'R');
  if (!(l < Infinity) && !(r < Infinity)) return null;
  if (l < r * 0.8) return 'L';
  if (r < l * 0.8) return 'R';
  return null;
}
