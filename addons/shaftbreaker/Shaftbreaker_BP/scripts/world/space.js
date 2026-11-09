// @ts-check
import { world } from '@minecraft/server';
import { key, sub, len, norm, angleTo, floor3, center, add, clamp, rand, shuffle, reportError, OVERWORLD } from '../core/util.js';
import { isPassableId, isSolidFloorId, blocksSight, isLiquidId, DAMAGING } from '../core/blocks.js';

/** @typedef {import('@minecraft/server').Dimension} Dimension */
/** @typedef {import('@minecraft/server').Player} Player */
/** @typedef {import('@minecraft/server').Entity} Entity */
/** @typedef {{x:number,y:number,z:number}} Vec3 */

let budgetUsed = 0;
/** per-tick soft budget for block lookups (keeps mid-range devices smooth) */
export function resetBudget() { budgetUsed = 0; }
export function budgetLeft() { return 2600 - budgetUsed; }

/** Cached block lookups. Unknown/unloaded cells read as '?' (treated as solid, never walked). */
export class BlockCache {
  /** @param {Dimension} dim */
  constructor(dim) { this.dim = dim; this.m = new Map(); }
  id(x, y, z) {
    const k = `${x},${y},${z}`;
    let v = this.m.get(k);
    if (v !== undefined) return v;
    budgetUsed++;
    try {
      const b = this.dim.getBlock({ x, y, z });
      v = b ? b.typeId : '?';
      // an open door / gate / trapdoor can be walked through (breaching opens them during a rage)
      if (b && (v.endsWith('_door') || v.endsWith('fence_gate') || v.endsWith('trapdoor') || v === 'minecraft:wooden_door') && b.permutation.getState('open_bit') === true) v += '#open';
    } catch { v = '?'; }
    this.m.set(k, v);
    return v;
  }
  passable(x, y, z) { const i = this.id(x, y, z); return i !== '?' && isPassableId(i); }
  floor(x, y, z) { const i = this.id(x, y, z); return i !== '?' && isSolidFloorId(i); }
  liquid(x, y, z) { return isLiquidId(this.id(x, y, z)); }
  standable(x, y, z) { return this.floor(x, y - 1, z) && this.passable(x, y, z) && this.passable(x, y + 1, z) && !DAMAGING.has(this.id(x, y, z)); }
  crawlable(x, y, z) { return this.floor(x, y - 1, z) && this.passable(x, y, z) && !this.passable(x, y + 1, z); }
  /** count of open cells above the floor at this column (max 6) */
  headroom(x, y, z) { let h = 0; while (h < 6 && this.passable(x, y + h, z)) h++; return h; }
}

// ---------------------------------------------------------------- perception
/** line of sight from a to b through see-through blocks */
export function lineOfSight(dim, a, b) {
  const d = sub(b, a); const L = len(d);
  if (L < 0.5) return true;
  const dir = norm(d);
  let from = a; let remaining = L;
  for (let i = 0; i < 4 && remaining > 0.3; i++) {
    let hit;
    try { hit = dim.getBlockFromRay(from, dir, { maxDistance: remaining, includeLiquidBlocks: false, includePassableBlocks: false }); } catch { return false; }
    if (!hit) return true;
    const hp = add(hit.block.location, hit.faceLocation);
    const travelled = len(sub(hp, from));
    if (travelled >= remaining - 0.35) return true;
    if (blocksSight(hit.block.typeId)) return false;
    from = add(hp, { x: dir.x * 0.6, y: dir.y * 0.6, z: dir.z * 0.6 });
    remaining -= travelled + 0.6;
  }
  return true;
}

/** creature body sample points for a stance */
export function bodyPoints(loc, stance = 0) {
  const h = stance === 2 ? 0.8 : stance === 1 ? 1.75 : 2.75;
  return [{ x: loc.x, y: loc.y + h, z: loc.z }, { x: loc.x, y: loc.y + h * 0.55, z: loc.z }, { x: loc.x, y: loc.y + 0.35, z: loc.z }];
}

/**
 * How a player perceives a world point/creature.
 * @returns {{visible:boolean, angle:number, dist:number, headVisible:boolean}}
 */
export function perceive(player, points) {
  let eye, view;
  try { eye = player.getHeadLocation(); view = player.getViewDirection(); } catch { return { visible: false, angle: 180, dist: 999, headVisible: false }; }
  let visible = false; let best = 180; let headVisible = false;
  const dist = len(sub(points[0], eye));
  if (dist > 96) return { visible: false, angle: 180, dist, headVisible };
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const ang = angleTo(view, eye, p);
    if (ang > 80) { best = Math.min(best, ang); continue; }
    if (lineOfSight(player.dimension, eye, p)) {
      visible = true; best = Math.min(best, ang);
      if (i === 0) headVisible = true;
    } else best = Math.min(best, Math.max(ang, 90));
  }
  return { visible, angle: best, dist, headVisible };
}

export function lightAt(dim, pos) {
  try { return dim.getLightLevel(floor3(pos)); } catch { return 0; }
}
export function skyLightAt(dim, pos) {
  try { return dim.getSkyLightLevel(floor3(pos)); } catch { return 15; }
}

/** underground = in the Overworld, out of the sky and below the local surface */
export function isUnderground(player) {
  try {
    if (player.dimension.id !== OVERWORLD) return false;
    const head = player.getHeadLocation();
    const sky = skyLightAt(player.dimension, head);
    if (sky >= 6) return false;
    const top = player.dimension.getTopmostBlock({ x: Math.floor(head.x), z: Math.floor(head.z) });
    if (top && top.location.y - head.y < 3) return head.y < 20 && sky === 0;
    return sky <= 3 || head.y < 30;
  } catch { return false; }
}

export function isChunkLoaded(dim, pos) {
  try { return dim.isChunkLoaded(pos); } catch { return false; }
}

// ---------------------------------------------------------------- walk map (BFS over real cave space)
/**
 * Flood-fills the walkable space connected to an origin. Cells are feet positions.
 * Nodes: { x, y, z, d (path steps), crawl }
 */
export class WalkMap {
  /**
   * @param {Dimension} dim
   * @param {Vec3} origin
   * @param {{maxNodes?:number, maxDist?:number, allowCrawl?:boolean, goal?:(n:any)=>boolean}} opts
   */
  constructor(dim, origin, opts = {}) {
    this.dim = dim;
    this.cache = new BlockCache(dim);
    this.maxNodes = opts.maxNodes ?? 1400;
    this.maxDist = opts.maxDist ?? 48;
    this.allowCrawl = opts.allowCrawl ?? true;
    this.goal = opts.goal || null;      // optional early exit: (node) => boolean
    this.found = null;
    this.nodes = new Map();
    this.queue = [];
    this.done = false;
    this.created = Date.now();
    const o = floor3(origin);
    const start = this.settle(o.x, o.y, o.z);
    if (start) { const n = { ...start, d: 0, crawl: !this.cache.passable(start.x, start.y + 1, start.z), p: null }; this.nodes.set(key(n), n); this.queue.push(n); }
    else this.done = true;
    this.origin = start || o;
  }

  /** find a standable/crawlable cell at or just below p */
  settle(x, y, z) {
    for (let dy = 0; dy >= -3; dy--) {
      if (this.cache.floor(x, y + dy - 1, z) && this.cache.passable(x, y + dy, z)) return { x, y: y + dy, z };
    }
    for (let dy = 1; dy <= 1; dy++) {
      if (this.cache.floor(x, y + dy - 1, z) && this.cache.passable(x, y + dy, z)) return { x, y: y + dy, z };
    }
    return null;
  }

  /** process up to `steps` nodes; returns true when finished */
  step(steps = 120) {
    const c = this.cache;
    while (steps-- > 0 && this.queue.length && !this.done) {
      if (budgetLeft() <= 0) return false;
      const n = this.queue.shift();
      if (n.d >= this.maxDist) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = n.x + dx, z = n.z + dz;
        for (const dy of [0, 1, -1, -2, -3]) {
          const y = n.y + dy;
          if (dy === 1 && (!c.passable(n.x, n.y + 1, n.z) || !c.passable(n.x, n.y + 2, n.z))) continue; // stepping up needs room above the current cell
          if (!c.floor(x, y - 1, z) || !c.passable(x, y, z)) continue;
          const crawl = !c.passable(x, y + 1, z);
          if (crawl && !this.allowCrawl) break;
          if (dy < 0) { // dropping: the column above the landing must be open
            let ok = true; for (let k = y + 1; k <= n.y; k++) if (!c.passable(x, k, z)) { ok = false; break; }
            if (!ok) continue;
          }
          const k2 = `${x},${y},${z}`;
          if (!this.nodes.has(k2)) {
            const m = { x, y, z, d: n.d + 1, crawl, p: key(n) };
            this.nodes.set(k2, m); this.queue.push(m);
            if (this.goal && this.goal(m)) { this.found = m; this.done = true; return true; }
            if (this.nodes.size >= this.maxNodes) { this.done = true; return true; }
          }
          break;
        }
      }
    }
    if (!this.queue.length) this.done = true;
    return this.done;
  }

  finish(maxSteps = 6000) { let s = 0; while (!this.done && s < maxSteps && budgetLeft() > 0) { this.step(200); s += 200; } return this.done; }

  /** path of node keys from origin to target node */
  pathTo(n) {
    const out = []; let cur = n; let guard = 0;
    while (cur && guard++ < 400) { out.push(cur); cur = cur.p ? this.nodes.get(cur.p) : null; }
    return out.reverse();
  }

  list() { return [...this.nodes.values()]; }
}

/**
 * Generic candidate search over a walk map.
 * @param {WalkMap} map
 * @param {Player} player
 * @param {object} q query
 */
export function findSpot(map, player, q) {
  const eye = player.getHeadLocation();
  const view = player.getViewDirection();
  // spawns that the player could see must start outside the view cone (no pop-in); movement targets may opt out
  if (q.los === true && !q.inViewOk) q = { ...q, minAngle: Math.max(q.minAngle ?? 0, 55) };
  const cands = shuffle(map.list().filter((n) => n.d >= (q.minPath ?? 0) && n.d <= (q.maxPath ?? 999)));
  const dim = player.dimension;
  let checked = 0;
  for (const n of cands) {
    if (checked++ > (q.maxChecks ?? 70)) break;
    const c = center(n);
    const dist = len(sub(c, eye));
    if (q.minDist !== undefined && dist < q.minDist) continue;
    if (q.maxDist !== undefined && dist > q.maxDist) continue;
    if (q.crawl === false && n.crawl) continue;
    if (q.minHeadroom) { if (map.cache.headroom(n.x, n.y, n.z) < q.minHeadroom) continue; }
    if (q.dy !== undefined) { const dy = n.y - Math.floor(player.location.y); if (dy < q.dy[0] || dy > q.dy[1]) continue; }
    const head = { x: c.x, y: c.y + (n.crawl ? 0.8 : 2.4), z: c.z };
    const ang = angleTo(view, eye, head);
    if (q.minAngle !== undefined && ang < q.minAngle) continue;
    if (q.maxAngle !== undefined && ang > q.maxAngle) continue;
    if (q.maxLight !== undefined && lightAt(dim, { x: c.x, y: c.y + 1, z: c.z }) > q.maxLight) continue;
    if (q.los !== undefined) {
      const vis = lineOfSight(dim, eye, head);
      if (vis !== q.los) continue;
    }
    if (q.bodyHidden) { // head visible but torso occluded (peek / failed concealment)
      const mid = { x: c.x, y: c.y + 1.2, z: c.z };
      if (lineOfSight(dim, eye, mid)) continue;
    }
    if (q.test && !q.test(n, c, map)) continue;
    return { node: n, pos: c, dist, angle: ang };
  }
  return null;
}

/** lateral cover test for corner peeks: which side (relative to facing the player) has a wall at body height */
export function coverSide(cache, n, towardPlayer) {
  const f = norm({ x: towardPlayer.x, y: 0, z: towardPlayer.z });
  const right = { x: -f.z, z: f.x };
  const r = { x: Math.round(n.x + right.x), z: Math.round(n.z + right.z) };
  const l = { x: Math.round(n.x - right.x), z: Math.round(n.z - right.z) };
  const wallR = !cache.passable(r.x, n.y + 1, r.z) && !cache.passable(r.x, n.y, r.z);
  const wallL = !cache.passable(l.x, n.y + 1, l.z) && !cache.passable(l.x, n.y, l.z);
  if (wallR && !wallL) return 'right';
  if (wallL && !wallR) return 'left';
  return null;
}

/** air cell beyond a thin wall next to a position (for breathing behind stone / second pickaxe) */
export function hiddenAirNear(dim, from, eye, radius = 7) {
  const cache = new BlockCache(dim);
  for (let i = 0; i < 40; i++) {
    const p = floor3({ x: from.x + rand(-radius, radius), y: from.y + rand(-2, 3), z: from.z + rand(-radius, radius) });
    if (!cache.passable(p.x, p.y, p.z)) continue;
    const c = center(p); c.y += 0.5;
    if (len(sub(c, eye)) < 4) continue;
    if (!lineOfSight(dim, eye, c)) return c;
  }
  return null;
}

/** a reachable cell for the creature itself (small BFS from its feet) */
export function creatureMap(entity, maxNodes = 500, maxDist = 24) {
  try { return new WalkMap(entity.dimension, entity.location, { maxNodes, maxDist }); } catch (e) { reportError('creatureMap', e); return null; }
}

export function overworld() { return world.getDimension(OVERWORLD); }
export { clamp };
