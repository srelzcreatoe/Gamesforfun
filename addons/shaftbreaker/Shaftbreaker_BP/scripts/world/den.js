// @ts-check
import { system, BlockPermutation } from '@minecraft/server';
import { now, sec, mins, rand, randi, chance, pick, dist, distXZ, sub, norm, center, floor3, key, safe, valid, worldTicks, OVERWORLD } from '../core/util.js';
import { config } from '../core/config.js';
import { isPlayerMadeHint, NATURAL_BREAKABLE } from '../core/blocks.js';
import { BlockCache, lineOfSight, lightAt, isChunkLoaded, hiddenAirNear } from './space.js';
import { canDress, wasPlaced } from './protection.js';
import { ws, wsDirty, activeDens, nearestDen } from '../ai/worldstate.js';
import { profile, evidence } from '../ai/memory.js';
import { caption } from '../audio.js';
import { log } from '../core/log.js';

export const MOTH_ID = 'shaftbreaker:shaft_moth';

/** Shaft Moths (L75-L80): original ecology. Clue moths drift toward a den. */
export function spawnMoths(dim, near, n, den) {
  for (let i = 0; i < n; i++) {
    const pos = hiddenAirNear(dim, near, { x: near.x, y: near.y + 1.6, z: near.z }, 7) || { x: near.x + rand(-4, 4), y: near.y + 2, z: near.z + rand(-4, 4) };
    safe('moth', () => {
      const m = dim.spawnEntity(MOTH_ID, pos);
      m.setProperty('shaftbreaker:clue', !!den);
      if (den) m.setDynamicProperty('sb:den', den.id);
      m.setDynamicProperty('sb:born', worldTicks());
    });
  }
}

/** steer clue moths toward their den with small impulses; physics keeps them out of walls */
export function tickMoths(players) {
  const dens = activeDens();
  for (const p of players) {
    if (p.dimension.id !== OVERWORLD) continue;
    let moths = [];
    try { moths = p.dimension.getEntities({ type: MOTH_ID, location: p.location, maxDistance: 64 }); } catch { continue; }
    for (const m of moths) {
      if (!valid(m)) continue;
      const born = /** @type {number} */ (m.getDynamicProperty('sb:born') ?? 0);
      if (born && worldTicks() - born > mins(4)) { safe('mothExpire', () => m.remove()); continue; }
      const denId = m.getDynamicProperty('sb:den');
      let den = denId ? dens.find((d) => d.id === denId) : null;
      if (!den) { const nd = nearestDen(m.location, 64); den = nd ? nd.den : null; }
      if (!den) continue;
      const d = sub(center(den), m.location);
      const dd = Math.sqrt(d.x * d.x + d.z * d.z);
      if (dd < 3) continue;
      const n = norm({ x: d.x, y: d.y * 0.3, z: d.z });
      const swirl = Math.sin(now() / 13 + born) * 0.025;
      safe('mothPush', () => m.applyImpulse({ x: n.x * 0.04 - n.z * swirl, y: n.y * 0.02 + 0.004, z: n.z * 0.04 + n.x * swirl }));
    }
    // ambient moths near an active den
    const nd = nearestDen(p.location, 56);
    if (nd && moths.length < 2 && chance(0.25)) spawnMoths(p.dimension, p.location, 1, nd.den);
    if (nd && nd.dist < 16) {
      const pf = profile(p);
      const k = `den${nd.den.id}`;
      pf.denSeen = pf.denSeen || {};
      if (!pf.denSeen[k] || worldTicks() - pf.denSeen[k] > mins(20)) { pf.denSeen[k] = worldTicks(); evidence(p, 'den_interference', 0.5, 'found the den by following clues'); }
      if (now() % 80 < 40) safe('aura', () => p.dimension.spawnParticle('shaftbreaker:den_aura', { x: nd.den.x + 0.5, y: nd.den.y + 1.2, z: nd.den.z + 0.5 }));
    }
  }
}

// ------------------------------------------------------------------ den generation (L68-L72, N48, N49)
let building = false;

/**
 * Try to grow a Shaft Den in a real deep chamber 30-56 blocks from the player, out of sight.
 * Only natural blocks are swapped, only air cells are filled, everything protected is skipped.
 */
export function tryGenerateDen(player) {
  const cfg = config();
  if (!cfg.denGeneration || cfg.harmless || building) return false;
  if (activeDens().length >= 6) return false;
  if (nearestDen(player.location, 140)) return false;
  const dim = player.dimension;
  const eye = player.getHeadLocation();
  const cache = new BlockCache(dim);
  for (let attempt = 0; attempt < 8; attempt++) {                       // bounded work per call (called at most every 5 min)
    const a = rand(0, Math.PI * 2); const r = rand(30, 56);
    const x = Math.floor(player.location.x + Math.cos(a) * r);
    const z = Math.floor(player.location.z + Math.sin(a) * r);
    let y = Math.floor(Math.min(36, player.location.y + rand(-14, 6)));
    if (!isChunkLoaded(dim, { x, y, z })) continue;
    // settle onto a floor
    let F = null;
    for (let dy = 0; dy > -8; dy--) if (cache.floor(x, y + dy - 1, z) && cache.passable(x, y + dy, z)) { F = y + dy; break; }
    if (F === null) continue;
    // chamber test: 5x5 open floor with >= 3 headroom
    let open = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const ok = (cache.floor(x + dx, F - 1, z + dz) && cache.headroom(x + dx, F, z + dz) >= 3);
      if (ok) open++;
    }
    if (open < 16) continue;
    if (lightAt(dim, { x, y: F + 1, z }) > 4) continue;
    if (lineOfSight(dim, eye, { x: x + 0.5, y: F + 1.2, z: z + 0.5 })) continue;
    // no sign of players nearby
    let clean = true;
    for (let i = 0; i < 60 && clean; i++) {
      const q = { x: x + randi(-4, 4), y: F + randi(-1, 4), z: z + randi(-4, 4) };
      const id = cache.id(q.x, q.y, q.z);
      if (id === '?' || isPlayerMadeHint(id) || wasPlaced(q)) clean = false;
    }
    if (!clean) continue;
    buildDen(dim, { x, y: F, z }, cache);
    return true;
  }
  return false;
}

function buildDen(dim, c, cache) {
  building = true;
  const s = ws();
  const den = { id: s.nextDenId++, x: c.x, y: c.y - 1, z: c.z, created: worldTicks(), cleansed: 0, crack: [], listen: chance(0.5) };
  s.dens.push(den); wsDirty();
  log('basic', `den #${den.id} growing at ${c.x} ${c.y} ${c.z}`);
  const jobs = [];
  const heart = { x: c.x, y: c.y - 1, z: c.z };
  jobs.push(() => { if (canDress(dim, heart) || NATURAL_BREAKABLE.has(cache.id(heart.x, heart.y, heart.z))) setBlock(dim, heart, 'shaftbreaker:den_heart'); });
  const floorCells = [];
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      const y = c.y + dy;
      if (cache.floor(c.x + dx, y - 1, c.z + dz) && cache.passable(c.x + dx, y, c.z + dz) && cache.id(c.x + dx, y, c.z + dz).includes('air')) { floorCells.push({ x: c.x + dx, y, z: c.z + dz }); break; }
    }
  }
  const pickCells = (n) => { const out = []; for (let i = 0; i < n && floorCells.length; i++) out.push(floorCells.splice(randi(0, floorCells.length - 1), 1)[0]); return out; };
  for (const q of pickCells(randi(8, 12))) if (!(q.x === c.x && q.z === c.z)) jobs.push(() => setBlock(dim, q, 'shaftbreaker:den_dust'));
  for (const q of pickCells(randi(2, 4))) jobs.push(() => setBlock(dim, q, 'shaftbreaker:den_spine'));
  for (const q of pickCells(randi(1, 2))) jobs.push(() => setBlock(dim, q, 'minecraft:bone_block'));
  for (const q of pickCells(randi(2, 3))) jobs.push(() => setBlock(dim, q, pick(['minecraft:gravel', 'minecraft:cobbled_deepslate', 'minecraft:tuff'])));
  for (const q of pickCells(1)) jobs.push(() => { if (!setBlock(dim, q, 'minecraft:skeleton_skull')) setBlock(dim, q, 'minecraft:bone_block'); });
  // hanging spines + cobwebs under the ceiling
  for (let i = 0; i < 10; i++) {
    const x = c.x + randi(-3, 3), z = c.z + randi(-3, 3);
    const h = cache.headroom(x, c.y, z);
    if (h < 3 || h > 6) continue;
    const q = { x, y: c.y + h - 1, z };
    jobs.push(() => {
      if (chance(0.6)) setPerm(dim, q, 'shaftbreaker:den_spine', { 'shaftbreaker:hanging': true });
      else setBlock(dim, q, 'minecraft:web');
    });
  }
  // N49 hidden passage: a thin natural wall with open cave behind it becomes a fractured den wall
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    let wallStart = null;
    for (let d = 3; d <= 6; d++) {
      const x = c.x + dx * d, z = c.z + dz * d;
      if (!cache.passable(x, c.y, z)) { if (wallStart === null) wallStart = d; }
      else if (wallStart !== null) {
        const thick = d - wallStart;
        if (thick <= 2 && cache.passable(x, c.y + 1, z)) {
          for (let t = wallStart; t < d; t++) for (let hy = 0; hy <= 1; hy++) {
            const q = { x: c.x + dx * t, y: c.y + hy, z: c.z + dz * t };
            if (NATURAL_BREAKABLE.has(cache.id(q.x, q.y, q.z)) && !wasPlaced(q)) { den.crack.push(key(q)); jobs.push(() => setBlock(dim, q, 'shaftbreaker:den_crack')); }
          }
        }
        break;
      }
    }
    if (den.crack.length) break;
  }
  let i = 0;
  const run = () => {
    for (let k = 0; k < 4 && i < jobs.length; k++, i++) safe('denJob', jobs[i]);
    if (i < jobs.length) system.runTimeout(run, 2); else { building = false; wsDirty(); }
  };
  system.runTimeout(run, 1);
}

function setBlock(dim, q, id) {
  return !!safe('denSet', () => { const b = dim.getBlock(q); if (!b) return false; b.setType(id); return true; }, false);
}
function setPerm(dim, q, id, states) {
  return !!safe('denPerm', () => { const b = dim.getBlock(q); if (!b) return false; b.setPermutation(BlockPermutation.resolve(id, states)); return true; }, false);
}

/** L73 / L81: cleansing a den suppresses the territory for a few in-game days */
export function onDenHeartBroken(player, pos, psRetaliate) {
  const d = nearestDen(pos, 4, false);
  if (!d) return;
  const den = d.den;
  den.cleansed = worldTicks();
  ws().suppress.push({ x: den.x, z: den.z, r: 72, until: worldTicks() + 24000 * 3 });
  wsDirty();
  evidence(player, 'den_interference', 3, 'cleansed a den');
  const pf = profile(player); pf.densCleansed = (pf.densCleansed || 0) + 1;
  caption(player, 'The den falls silent');
  try { player.onScreenDisplay.setActionBar('§7The den falls silent. This territory will be quiet for a while.'); } catch { /* ignore */ }
  // open its hidden passage: it can no longer hold it shut
  for (const k of den.crack || []) {
    const [x, y, z] = k.split(',').map(Number);
    safe('crack', () => { const b = player.dimension.getBlock({ x, y, z }); if (b && b.typeId === 'shaftbreaker:den_crack') player.dimension.runCommand(`setblock ${x} ${y} ${z} air destroy`); });
  }
  if (chance(0.55)) psRetaliate(now() + sec(rand(180, 420)));
}

/** the Breaker may open its own den wall (N49) when the player is beyond it */
export function denCrackBetween(dim, from, to) {
  for (const den of activeDens()) {
    if (distXZ(den, from) > 12) continue;
    for (const k of den.crack || []) {
      const [x, y, z] = k.split(',').map(Number);
      if (dist({ x, y, z }, from) < 4 && dist({ x, y, z }, to) < dist(from, to)) return { x, y, z, den };
    }
  }
  return null;
}

export { floor3 };
