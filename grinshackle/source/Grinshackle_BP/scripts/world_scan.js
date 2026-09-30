// Bounded block scans. Nothing here places or breaks blocks. All getBlock calls are wrapped; unloaded chunks read as "unknown" (false).
import { IDS, LIGHT_BLOCKS, MINESHAFT_BLOCKS, NON_FLOOR } from './constants.js';
import { S } from './state.js';
import { dist, flatDist, floorPos, dot, norm, sub, rand, safe } from './util.js';

// Read budget: a scan (findSpawnPoint, lightApprox, ...) may read at most MAX_CALLS blocks per call. Simple helpers reset the
// budget when they are called on their own and share the outer budget when called from inside a scan.
const MAX_CALLS = 400;
let calls = 0, scanning = false;
function begin() { if (!scanning) calls = 0; }
function budget() { calls = 0; scanning = true; }
function done() { scanning = false; }
function block(dim, x, y, z) {
  if (++calls > MAX_CALLS) return undefined;
  try { return dim.getBlock({ x, y, z }); } catch { return undefined; }
}
export function isAir(dim, p) { begin(); const b = block(dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return !!b && b.isAir === true; }
export function isPassable(dim, p) { begin(); const b = block(dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return !!b && (b.isAir === true || b.isLiquid === false && /(:air|_carpet|snow_layer|torch|rail|web|flower|grass|tallgrass|fern|sapling|vine|button|lever|pressure_plate)/.test(b.typeId)); }
export function typeAt(dim, p) { begin(); const b = block(dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)); return b ? b.typeId : ''; }

/** Solid, non-liquid floor block directly under p. */
export function isSolidFloor(dim, p) {
  begin();
  const b = block(dim, Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z));
  if (!b || b.isAir || b.isLiquid) return false;
  return !NON_FLOOR.test(b.typeId);
}
/** `height` blocks of air starting at p (feet). */
export function standRoom(dim, p, height = 3) {
  begin();
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  for (let i = 0; i < height; i++) { const b = block(dim, x, y + i, z); if (!b || !b.isAir) return false; }
  return true;
}
/** Underground = Overworld and a non-air block somewhere in the 24 blocks above, or already at/below the sea of stone (y < 0 counts if the 8 blocks above are not all air). */
export function isUnderground(dim, p) {
  begin();
  if (safe(() => dim.id, '') !== IDS.OVERWORLD) return false;
  const x = Math.floor(p.x), z = Math.floor(p.z), y = Math.floor(p.y);
  let solidAbove = false;
  for (let dy = 2; dy <= 24; dy++) { const b = block(dim, x, y + dy, z); if (!b) return false; if (!b.isAir) { solidAbove = true; break; } }
  return solidAbove;
}

/** Placed-light approximation: counts light-emitting blocks near p that have an unobstructed ray to p. NOT a light-level reading. */
export function lightApprox(dim, p, radius = 4, threshold = 3) {
  budget();
  try {
  return (() => {
  const cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z);
  let count = 0, rays = 0;
  const target = { x: cx + 0.5, y: cy + 1.0, z: cz + 0.5 };
  for (let dx = -radius; dx <= radius; dx++) for (let dy = -1; dy <= 3; dy++) for (let dz = -radius; dz <= radius; dz++) {
    const b = block(dim, cx + dx, cy + dy, cz + dz);
    if (!b || b.isAir || !LIGHT_BLOCKS.test(b.typeId)) continue;
    if (rays < 12) {
      rays++;
      const from = { x: cx + dx + 0.5, y: cy + dy + 0.5, z: cz + dz + 0.5 };
      const d = sub(target, from); const L = Math.hypot(d.x, d.y, d.z);
      if (L > 0.6) {
        const hit = safe(() => dim.getBlockFromRay(from, norm(d), { maxDistance: L - 0.5, includeLiquidBlocks: false, includePassableBlocks: false }), undefined);
        if (hit) continue;
      }
    }
    count++;
  }
  return { count, strong: count >= threshold };
  })();
  } finally { done(); }
}

export function materialAt(dim, p) {
  const t = typeAt(dim, { x: p.x, y: p.y - 1, z: p.z });
  if (/deepslate|tuff|basalt|blackstone/.test(t)) return 'deepslate';
  if (/gravel|sand/.test(t)) return 'gravel';
  if (/planks|log|wood|fence|chest|barrel/.test(t)) return 'wood';
  if (/dirt|grass|mud|clay|moss|podzol|mycelium|soul_soil|farmland/.test(t)) return 'dirt';
  if (/stone|cobble|andesite|diorite|granite|ore|obsidian|brick|slab|stairs|dripstone|calcite|smooth/.test(t)) return 'stone';
  return 'stone';
}
/** Nearby-block heuristic for mineshaft-like areas (not structure recognition). */
export function mineshaftScore(dim, p) {
  budget();
  try {
  return (() => {
  const cx = Math.floor(p.x), cy = Math.floor(p.y), cz = Math.floor(p.z);
  let n = 0;
  for (let dx = -4; dx <= 4; dx += 2) for (let dy = -1; dy <= 2; dy++) for (let dz = -4; dz <= 4; dz += 2) {
    const b = block(dim, cx + dx, cy + dy, cz + dz); if (b && MINESHAFT_BLOCKS.test(b.typeId)) n++;
  }
  return n;
  })();
  } finally { done(); }
}

export function hasLineOfSight(dim, from, to) {
  const d = sub(to, from); const L = Math.hypot(d.x, d.y, d.z);
  if (L < 0.1) return true;
  const hit = safe(() => dim.getBlockFromRay(from, norm(d), { maxDistance: L, includeLiquidBlocks: false, includePassableBlocks: false }), 'err');
  if (hit === 'err') return false;
  return !hit;
}

/**
 * Find a collision-safe spawn point around `player`.
 * opts: { min, max, height (3 standing / 2 crawling), testing (ignore view cone, closer), darkOnly }
 */
export function findSpawnPoint(player, opts = {}) {
  budget();
  try {
  return (() => {
  const dim = player.dimension; const loc = player.location;
  const min = opts.min ?? 12, max = opts.max ?? 24, height = opts.height ?? 3;
  const view = safe(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  const cfg = S.config || {};
  let best; let bestScore = -Infinity;
  const tries = opts.testing ? 16 : 24;
  for (let i = 0; i < tries; i++) {
    const a = Math.random() * Math.PI * 2; const r = opts.testing ? rand(5, 9) : rand(min, max);
    const x = Math.floor(loc.x + Math.cos(a) * r) + 0.5, z = Math.floor(loc.z + Math.sin(a) * r) + 0.5;
    for (const dy of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
      const q = { x, y: Math.floor(loc.y) + dy, z };
      if (!standRoom(dim, q, height) || !isSolidFloor(dim, q)) continue;
      const dx = q.x - loc.x, dz = q.z - loc.z; const fl = Math.hypot(dx, dz) || 1;
      const inView = (dx * view.x + dz * view.z) / fl;
      if (!opts.testing && inView > 0.45) continue;
      if (opts.testing && Math.hypot(dx, dz) < 3) continue;
      if (!opts.testing && !isUnderground(dim, q)) continue;
      const light = lightApprox(dim, q, 3, cfg.lightThreshold || 3);
      if (light.strong) continue;
      let score = -light.count * 2 + (inView < 0 ? 1.5 : 0) + Math.min(3, mineshaftScore(dim, q)) * 0.5 + Math.random();
      if (score > bestScore) { bestScore = score; best = q; }
      break;
    }
    if (calls > MAX_CALLS) break;
  }
  return best;
  })();
  } finally { done(); }
}

/** A walkable floor point near `pos` (radius r) with 2 blocks of headroom, optionally out of the player's line of sight. */
export function walkableNear(dim, pos, radius = 6, opts = {}) {
  budget();
  try {
  return (() => {
  let best;
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2; const r = rand(Math.max(1, radius * 0.5), radius);
    const x = Math.floor(pos.x + Math.cos(a) * r) + 0.5, z = Math.floor(pos.z + Math.sin(a) * r) + 0.5;
    for (const dy of [0, -1, 1, -2, 2]) {
      const q = { x, y: Math.floor(pos.y) + dy, z };
      if (!standRoom(dim, q, opts.height ?? 2) || !isSolidFloor(dim, q)) continue;
      if (opts.hiddenFrom && hasLineOfSight(dim, { x: q.x, y: q.y + 1.5, z: q.z }, opts.hiddenFrom)) continue;
      return q;
    }
    if (calls > MAX_CALLS) break;
  }
  return best;
  })();
  } finally { done(); }
}

/**
 * Cover for THE CORNER THAT WATCHES: a floor point with no line of sight to the player's head, adjacent to a floor point that has one.
 * Returns { cover, reveal } or undefined.
 */
export function findCoverPoint(dim, fromPos, playerHead, opts = {}) {
  budget();
  try {
  return (() => {
  const min = opts.min ?? 6, max = opts.max ?? 14;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2; const r = rand(min, max);
    const x = Math.floor(playerHead.x + Math.cos(a) * r) + 0.5, z = Math.floor(playerHead.z + Math.sin(a) * r) + 0.5;
    for (const dy of [0, -1, 1, -2, 2, -3]) {
      const q = { x, y: Math.floor(playerHead.y) + dy, z };
      if (!standRoom(dim, q, 3) || !isSolidFloor(dim, q)) continue;
      const eye = { x: q.x, y: q.y + 2.2, z: q.z };
      if (hasLineOfSight(dim, eye, playerHead)) { // visible -> this could be a reveal point; look for a covered neighbour
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = { x: q.x + ox, y: q.y, z: q.z + oz };
          if (standRoom(dim, c, 3) && isSolidFloor(dim, c) && !hasLineOfSight(dim, { x: c.x, y: c.y + 2.2, z: c.z }, playerHead)) return { cover: c, reveal: q };
        }
      } else { // covered -> look for a visible neighbour
        for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rv = { x: q.x + ox, y: q.y, z: q.z + oz };
          if (standRoom(dim, rv, 3) && isSolidFloor(dim, rv) && hasLineOfSight(dim, { x: rv.x, y: rv.y + 2.2, z: rv.z }, playerHead)) return { cover: q, reveal: rv };
        }
      }
      break;
    }
    if (calls > MAX_CALLS) break;
  }
  return undefined;
  })();
  } finally { done(); }
}

/** Count air blocks in the 8 horizontal neighbours at feet level (low = narrow passage / bend). */
export function openness(dim, p) {
  begin();
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
  let n = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { if (!dx && !dz) continue; const b = block(dim, x + dx, y, z + dz); if (b && b.isAir) n++; }
  return n;
}
