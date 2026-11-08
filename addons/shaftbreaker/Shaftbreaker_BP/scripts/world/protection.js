// @ts-check
import { world } from '@minecraft/server';
import { key, distXZ, dist, worldTicks } from '../core/util.js';
import { config } from '../core/config.js';
import { NATURAL_BREAKABLE, isProtectedId, isPlayerMadeHint, ORES } from '../core/blocks.js';
import { skyLightAt } from './space.js';

/**
 * Block provenance. The Script API cannot tell player-placed from natural blocks in general,
 * so we never guess: a block is only breakable when (a) it is a natural-cave material,
 * (b) we did not see a player place it, and (c) nothing player-made is in its neighbourhood.
 */
const SHARDS = 4;
const PER_SHARD = 900;
const placed = new Set();
const order = [];
let dirty = false;

export function loadPlaced() {
  for (let i = 0; i < SHARDS; i++) {
    const s = world.getDynamicProperty(`sb:placed:${i}`);
    if (typeof s === 'string' && s.length) for (const k of s.split(';')) if (k) { placed.add(k); order.push(k); }
  }
}

export function notePlaced(pos) {
  if (pos.y > 80) return; // only cave-ish placements matter
  const k = key(pos);
  if (placed.has(k)) return;
  placed.add(k); order.push(k); dirty = true;
  while (order.length > SHARDS * PER_SHARD) placed.delete(order.shift());
}

export function noteRemoved(pos) { const k = key(pos); if (placed.delete(k)) { const i = order.indexOf(k); if (i >= 0) order.splice(i, 1); dirty = true; } }

export function wasPlaced(pos) { return placed.has(key(pos)); }

export function savePlaced() {
  if (!dirty) return;
  for (let i = 0; i < SHARDS; i++) {
    const part = order.slice(i * PER_SHARD, (i + 1) * PER_SHARD).join(';');
    try { world.setDynamicProperty(`sb:placed:${i}`, part); } catch { /* ignore */ }
  }
  dirty = false;
}

/** protected zones: world spawn and every online player's bed/respawn point */
export function inProtectedZone(pos) {
  try {
    const sp = world.getDefaultSpawnLocation();
    if (sp && distXZ(sp, pos) < 24 && Math.abs((sp.y > 32000 ? pos.y : sp.y) - pos.y) < 48) return true;
  } catch { /* ignore */ }
  for (const p of world.getAllPlayers()) {
    try {
      const s = p.getSpawnPoint();
      if (s && dist(s, pos) < 14) return true;
    } catch { /* ignore */ }
  }
  return false;
}

/**
 * May the creature move this block?
 * @param {import('@minecraft/server').Dimension} dim
 * @param {{x:number,y:number,z:number}} pos
 * @param {{denOnly?:boolean}} [opts]
 */
export function canBreak(dim, pos, opts = {}) {
  const cfg = config();
  if (cfg.harmless || cfg.blockDestruction === 'off') return false;
  let b;
  try { b = dim.getBlock(pos); } catch { return false; }
  if (!b) return false;
  const id = b.typeId;
  if (id === 'shaftbreaker:den_crack') return true;           // its own lair wall
  if (cfg.blockDestruction === 'den' || opts.denOnly) return false;
  if (!NATURAL_BREAKABLE.has(id)) return false;
  if (ORES.has(id) || isProtectedId(id)) return false;
  if (wasPlaced(pos)) return false;
  if (skyLightAt(dim, { x: pos.x, y: pos.y + 1, z: pos.z }) > 2) return false; // never edit the surface
  if (inProtectedZone(pos)) return false;
  // neighbourhood: any sign of a player build within 2 blocks -> hands off
  for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) {
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 3) continue;
    const q = { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz };
    let nb; try { nb = dim.getBlock(q); } catch { return false; }
    if (!nb) return false;
    if (isPlayerMadeHint(nb.typeId) || isProtectedId(nb.typeId)) return false;
    if (wasPlaced(q)) return false;
  }
  return true;
}

/** may a natural, non-structural cave block be swapped for storytelling (ore bait, den dressing)? */
export function canDress(dim, pos) {
  const cfg = config();
  if (cfg.harmless || cfg.blockDestruction === 'off') return false;
  return canBreak(dim, pos);
}

export const placedCount = () => placed.size;
export { worldTicks };
