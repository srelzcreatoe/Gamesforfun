// @ts-check
/**
 * Breaching: nothing stops it reaching you. During a rage it opens doors, trapdoors and fence gates
 * and smashes glass and leaves in its way. Every change is recorded (and persisted, in case the world
 * closes mid-chase) and put back exactly as it was once the chase is over and nobody stands in the way.
 */
import { world, BlockPermutation } from '@minecraft/server';
import { now, sec, center, floor3, safe, parseJSON, OVERWORLD } from '../core/util.js';
import { config } from '../core/config.js';
import { playAt } from '../audio.js';
import { log } from '../core/log.js';
import { BlockCache } from './space.js';

const KEY = 'sb:breach';
/** @type {{x:number,y:number,z:number,t:string,s:Record<string,any>,k:string,at:number}[]|null} */
let recs = null;

function list() {
  if (!recs) recs = parseJSON(/** @type {string} */ (safe('breachLoad', () => world.getDynamicProperty(KEY), '[]')), []);
  return /** @type {any[]} */ (recs);
}
function save() { safe('breachSave', () => world.setDynamicProperty(KEY, JSON.stringify(list().slice(-300)))); }

/** what kind of barrier is this block, if any? */
export function breachKind(id) {
  if (!id || !id.startsWith('minecraft:')) return null;
  if (id.endsWith('_door') || id === 'minecraft:wooden_door') return 'door';
  if (id.endsWith('trapdoor') || id.endsWith('fence_gate')) return 'gate';
  if (id.includes('glass') || id.endsWith('leaves')) return 'break';
  return null;
}

export function breachAllowed() {
  const cfg = config();
  return !cfg.harmless && cfg.blockDestruction !== 'off';
}

function record(block, kind) {
  list().push({ x: block.location.x, y: block.location.y, z: block.location.z, t: block.typeId, s: block.permutation.getAllStates(), k: kind, at: now() });
}

/**
 * Open or smash the barrier at pos. Returns the kind handled, or null.
 * @param {import('@minecraft/server').Dimension} dim
 */
export function breach(dim, pos) {
  if (!breachAllowed()) return null;
  const p = floor3(pos);
  const b = safe('breachGet', () => dim.getBlock(p), null);
  if (!b) return null;
  const id = b.typeId;
  const kind = breachKind(id);
  if (!kind) return null;
  if (kind === 'break') {
    record(b, kind);
    safe('smash', () => b.setType('minecraft:air'));                 // no drops: it is restored later, nothing duplicates
    safe('shards', () => dim.spawnParticle('shaftbreaker:debris', center(p)));
    playAt(dim, id.includes('glass') ? 'random.glass' : 'dig.grass', center(p), 1.0, 0.9);
  } else {
    const perm = b.permutation;
    if (perm.getState('open_bit') === true) return null;
    record(b, kind);
    safe('open', () => b.setPermutation(perm.withState('open_bit', true)));
    if (kind === 'door') {                                            // both halves of a door
      const up = perm.getState('upper_block_bit') === true;
      const o = safe('doorHalf', () => dim.getBlock({ x: p.x, y: p.y + (up ? -1 : 1), z: p.z }), null);
      if (o && o.typeId === id && o.permutation.getState('open_bit') !== true) {
        record(o, kind);
        safe('open2', () => o.setPermutation(o.permutation.withState('open_bit', true)));
      }
    }
    playAt(dim, id.includes('iron') ? 'open.iron_door' : 'random.door_open', center(p), 1.0, 0.7);
  }
  save();
  log('verbose', `breach ${kind} ${id} at ${p.x},${p.y},${p.z}`);
  return kind;
}

/** a barrier between the creature and the player, right in front of it (feet / body / head height) */
export function barrierAhead(dim, from, toward, reach = 2) {
  const dx = toward.x - from.x, dz = toward.z - from.z;
  const L = Math.sqrt(dx * dx + dz * dz);
  if (L < 0.8) return null;
  const f = { x: dx / L, z: dz / L };
  for (let k = 0.8; k <= reach; k += 0.6) {
    for (const dy of [0, 1, 2]) {
      const q = floor3({ x: from.x + f.x * k, y: from.y + dy + 0.1, z: from.z + f.z * k });
      const b = safe('barrier', () => dim.getBlock(q), null);
      if (b && breachKind(b.typeId) && !(breachKind(b.typeId) !== 'break' && b.permutation.getState('open_bit') === true)) return q;
    }
  }
  return null;
}

export function pendingBreaches() { return list().length; }

/**
 * Put everything back. Unless forced, waits until the change is a few seconds old and the cell is clear.
 * Blocks someone changed in the meantime are left alone.
 * @param {{force?:boolean, keepNear?:{x:number,y:number,z:number}|null}} o
 */
export function restoreBreaches(o = {}) {
  const L = list();
  if (!L.length) return 0;
  let dim; try { dim = world.getDimension(OVERWORLD); } catch { return 0; }
  const keep = [];
  let done = 0;
  for (let i = L.length - 1; i >= 0; i--) {
    const r = L[i];
    if (!o.force && now() >= r.at && now() - r.at < sec(8)) { keep.push(r); continue; }
    const c = center(r);
    if (o.keepNear && Math.abs(o.keepNear.x - c.x) + Math.abs(o.keepNear.z - c.z) < 4 && !o.force) { keep.push(r); continue; }
    const b = safe('restoreGet', () => dim.getBlock(r), null);
    if (!b) { keep.push(r); continue; }                               // unloaded: try again later
    if (r.k === 'break') {
      if (!b.isAir) continue;                                         // someone filled it: leave their block
      const blocked = safe('occupied', () => dim.getEntities({ location: { x: c.x, y: r.y + 0.5, z: c.z }, maxDistance: 1.1 }).length > 0, false);
      if (blocked && !o.force) { keep.push(r); continue; }
    } else if (b.typeId !== r.t) continue;                           // the door was removed or replaced
    const ok = safe('restore', () => { b.setPermutation(BlockPermutation.resolve(r.t, r.s)); return true; }, false);
    if (ok) done++; else keep.push(r);
  }
  recs = keep.reverse();
  save();
  if (done) log('verbose', `restored ${done} breached block(s)`);
  return done;
}

/**
 * You shut yourself in: the nearest way in (a door, gate, trapdoor, window or leaves) that has open
 * ground on the outside and open space on your side. Returns the barrier and the cell to stand in.
 * @param {import('@minecraft/server').Dimension} dim
 */
export function findEntry(dim, target, from, radius = 9) {
  const c = new BlockCache(dim);
  const t = floor3(target);
  let best = null; let bestD = 1e9;
  for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) for (let dy = -1; dy <= 2; dy++) {
    const x = t.x + dx, y = t.y + dy, z = t.z + dz;
    const id = c.id(x, y, z);
    if (!breachKind(id.replace('#open', '')) || id.endsWith('#open')) continue;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ax = x + ox, az = z + oz;                                  // candidate outside cell
      const bx = x - ox, bz = z - oz;                                  // the far side must be open (it leads in)
      if (!c.passable(bx, y, bz)) continue;
      let fy = null;
      for (const yy of [y, y - 1]) if (c.standable(ax, yy, az)) { fy = yy; break; }
      if (fy === null) continue;
      const side = Math.abs(ax + 0.5 - target.x) + Math.abs(az + 0.5 - target.z);
      const far = Math.abs(bx + 0.5 - target.x) + Math.abs(bz + 0.5 - target.z);
      if (far >= side) continue;                                       // the outside cell is the one further from you
      const d = Math.abs(ax + 0.5 - from.x) + Math.abs(az + 0.5 - from.z) + Math.abs(fy - from.y) * 2;
      if (d < bestD) { bestD = d; best = { barrier: { x, y, z }, stand: { x: ax + 0.5, y: fy, z: az + 0.5 } }; }
    }
  }
  return best;
}
