// @ts-check
import { system, BlockPermutation } from '@minecraft/server';
import { now, sec, mins, rand, randi, chance, pick, dist, distXZ, sub, norm, center, floor3, key, safe, valid, worldTicks, OVERWORLD } from '../core/util.js';
import { config } from '../core/config.js';
import { isPlayerMadeHint, NATURAL_BREAKABLE, isPassableId } from '../core/blocks.js';
import { BlockCache, lineOfSight, lightAt, isChunkLoaded, hiddenAirNear } from './space.js';
import { canDress, wasPlaced } from './protection.js';
import { ws, wsDirty, activeDens, nearestDen } from '../ai/worldstate.js';
import { profile, evidence } from '../ai/memory.js';
import { caption } from '../audio.js';
import { log } from '../core/log.js';

export const MOTH_ID = 'shaftbreaker:shaft_moth';

/** Shaft Moths (L75-L80): original ecology. Clue moths drift toward a den. */
export function spawnMoths(dim, near, n, den, follower = null) {
  for (let i = 0; i < n; i++) {
    const pos = hiddenAirNear(dim, near, { x: near.x, y: near.y + 1.6, z: near.z }, 7) || { x: near.x + rand(-1.5, 1.5), y: near.y + 1.5, z: near.z + rand(-1.5, 1.5) };
    safe('moth', () => {
      const m = dim.spawnEntity(MOTH_ID, pos);
      m.setDynamicProperty('sb:born', worldTicks());
      if (den && follower && i === 0) startGuide(m, den, follower);
    });
  }
}

// ------------------------------------------------------------------ guide moths (L78/L80): they lead you to the den
/** @type {Map<string, any>} */
const guides = new Map();
/** guides each player let fly off unfollowed: moths come less often for people who ignore them */
const ignored = new Map();
let lastGuideAt = -1e9;

class MinHeap {
  constructor() { this.a = []; }
  push(n) { const a = this.a; a.push(n); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length && last) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

/** incremental A* through open air (moths fly; they never pass through blocks) */
class AirPath {
  constructor(dim, from, to) {
    this.cache = new BlockCache(dim);
    this.goal = floor3(to); this.done = false; this.path = null; this.best = null;
    const s = floor3(from);
    this.open = new MinHeap(); this.came = new Map(); this.g = new Map();
    const k = key(s); this.g.set(k, 0); this.came.set(k, null);
    this.open.push({ ...s, f: this.h(s) });
    this.best = { ...s, hh: this.h(s) };
    this.expanded = 0;
  }
  h(c) { return Math.abs(c.x - this.goal.x) + Math.abs(c.y - this.goal.y) * 1.2 + Math.abs(c.z - this.goal.z); }
  air(x, y, z) { return this.cache.passable(x, y, z); }
  step(n = 220) {
    while (n-- > 0 && !this.done) {
      if (!this.open.size || this.expanded > 3500) { this.finish(this.best); return; }
      const c = this.open.pop(); this.expanded++;
      const hh = this.h(c);
      if (hh < this.best.hh) this.best = { x: c.x, y: c.y, z: c.z, hh };
      if (hh <= 2.5) { this.finish(c); return; }
      const gc = this.g.get(key(c));
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
        const nb = { x: c.x + dx, y: c.y + dy, z: c.z + dz };
        if (!this.air(nb.x, nb.y, nb.z)) continue;
        const k = key(nb); const ng = gc + 1;
        if (this.g.has(k) && this.g.get(k) <= ng) continue;
        this.g.set(k, ng); this.came.set(k, key(c));
        this.open.push({ ...nb, f: ng + this.h(nb) * 1.3 });
      }
    }
  }
  finish(c) {
    const out = []; let k = key(c); let guard = 0;
    while (k && guard++ < 600) { const [x, y, z] = k.split(',').map(Number); out.push({ x: x + 0.5, y: y + 0.4, z: z + 0.5 }); k = this.came.get(k); }
    this.path = out.reverse(); this.done = true;
  }
}

/** turn a moth into a guide for a player toward a den */
export function startGuide(m, den, player) {
  safe('guide', () => { m.triggerEvent('sb:become_guide'); m.setProperty('shaftbreaker:clue', true); m.setDynamicProperty('sb:den', den.id); });
  guides.set(m.id, { m, den, follower: player.id, born: now(), job: null, route: null, ri: 0, nextPlan: 0, orbit: 0, arrivedAt: 0 });
}

export function guideCount() { return guides.size; }

/** the widest open circle above the Den Heart the moth can fly around without clipping into the den walls */
function orbitRing(dim, c) {
  const open = (x, y, z) => { try { const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(y), z: Math.floor(z) }); return !b || isPassableId(b.typeId); } catch { return false; } };
  for (const dy of [0, 0.6, -0.4, 1.2]) {
    for (const rad of [1.8, 1.3, 0.9, 0.55]) {
      let ok = true;
      for (let a = 0; a < 16 && ok; a++) { const t = a / 16 * Math.PI * 2; for (const hy of [-0.2, 0.2]) if (!open(c.x + Math.cos(t) * rad, c.y + dy + hy, c.z + Math.sin(t) * rad)) { ok = false; break; } }
      if (ok) return { rad, dy };
    }
  }
  return { rad: 0.3, dy: 0 };
}

/** every tick: fly guides along their routes; wait (facing the den) when the player falls behind */
export function tickGuides() {
  for (const [id, g] of guides) {
    const m = g.m;
    if (!valid(m)) { guides.delete(id); continue; }
    const t = now();
    if (t - g.born > mins(5)) { safe('gEnd', () => m.remove()); guides.delete(id); ignored.set(g.follower, (ignored.get(g.follower) || 0) + 1); continue; }
    const denC = { x: g.den.x + 0.5, y: g.den.y + 2.0, z: g.den.z + 0.5 };
    const pos = m.location;
    let follower = null;
    for (const p of m.dimension.getPlayers({ location: pos, maxDistance: 40 })) if (p.id === g.follower) follower = p;
    if (!g.arrivedAt) {                                          // nobody is following any more: it gives up and drifts off
      if (!follower || dist(pos, follower.location) > 24) { if (!g.lostSince) g.lostSince = t; } else g.lostSince = 0;
      if (g.lostSince && t - g.lostSince > sec(60)) { safe('gLost', () => m.remove()); guides.delete(id); ignored.set(g.follower, (ignored.get(g.follower) || 0) + 1); continue; }
    }
    if (dist(pos, denC) < 3.5 || g.arrivedAt) {                 // arrived: circle the Den Heart, then fade
      if (!g.arrivedAt) { g.arrivedAt = t; if (follower && dist(follower.location, denC) < 16) ignored.set(g.follower, 0); safe('arrive', () => m.dimension.spawnParticle('shaftbreaker:den_aura', denC)); }
      if (!g.ring) g.ring = orbitRing(m.dimension, denC);
      g.orbit += 0.12;
      const r = g.ring;
      const o = { x: denC.x + Math.cos(g.orbit) * r.rad, y: denC.y + r.dy + Math.sin(g.orbit * 2) * 0.2, z: denC.z + Math.sin(g.orbit) * r.rad };
      safe('orbit', () => m.teleport(o, { facingLocation: { x: o.x - Math.sin(g.orbit), y: o.y, z: o.z + Math.cos(g.orbit) } }));
      if (t - g.arrivedAt > sec(25)) { safe('gFade', () => m.remove()); guides.delete(id); }
      continue;
    }
    if (!g.job && (!g.route || t >= g.nextPlan)) { g.job = new AirPath(m.dimension, pos, denC); }
    if (g.job) {
      g.job.step(220);
      if (g.job.done) { g.route = g.job.path; g.ri = Math.min(1, g.route.length - 1); g.job = null; g.nextPlan = t + sec(4); }
    }
    const bob = Math.sin(t / 6 + id.length) * 0.03;
    const waiting = !follower || dist(pos, follower.location) > 9;
    if (waiting || !g.route || g.ri >= g.route.length) {        // hover in place, nose pointed at the den
      safe('hover', () => m.teleport({ x: pos.x, y: pos.y + bob, z: pos.z }, { facingLocation: denC }));
      if (t % 20 === 0) safe('mote', () => m.dimension.spawnParticle('shaftbreaker:mote', pos));
      continue;
    }
    const nxt = g.route[g.ri];
    const d = sub(nxt, pos);
    const L = Math.sqrt(d.x * d.x + d.y * d.y + d.z * d.z);
    if (L < 0.35) { g.ri++; continue; }
    const sp = Math.min(0.17, L);
    const np = { x: pos.x + d.x / L * sp, y: pos.y + d.y / L * sp + bob, z: pos.z + d.z / L * sp };
    safe('fly', () => m.teleport(np, { facingLocation: { x: np.x + d.x, y: np.y, z: np.z + d.z } }));
    if (t % 12 === 0) safe('trail', () => m.dimension.spawnParticle('shaftbreaker:mote', pos));
  }
}

/** every 2 s: dens attract moths; a guide appears for underground players when a den exists */
export function tickMoths(players, pstate) {
  for (const p of players) {
    if (p.dimension.id !== OVERWORLD) continue;
    const s = pstate(p);
    if (!s.underground) continue;
    const nd = nearestDen(p.location, 220);
    if (nd && nd.dist < 16) {
      const pf = profile(p);
      const k = `den${nd.den.id}`;
      pf.denSeen = pf.denSeen || {};
      if (!pf.denSeen[k] || worldTicks() - pf.denSeen[k] > mins(20)) { pf.denSeen[k] = worldTicks(); evidence(p, 'den_interference', 0.5, 'found the den by following moths'); }
      if (now() % 80 < 40) safe('aura', () => p.dimension.spawnParticle('shaftbreaker:den_aura', { x: nd.den.x + 0.5, y: nd.den.y + 1.2, z: nd.den.z + 0.5 }));
      continue;
    }
    if (!nd || guides.size >= 3) continue;
    let mine = false;
    for (const g of guides.values()) if (g.follower === p.id) mine = true;
    if (mine || now() < (s.nextGuide || 0) || now() - lastGuideAt < sec(45)) continue;
    const seen = (profile(p).denSeen || {})[`den${nd.den.id}`];
    if (seen && worldTicks() - seen < mins(15)) continue;        // you already found this den: the moths leave you be for a while
    s.nextGuide = now() + sec(rand(120, 200) * Math.min(3, 1 + 0.6 * (ignored.get(p.id) || 0)));
    lastGuideAt = now();
    // reuse a natural moth nearby, or one flutters in from the dark
    let m = null;
    safe('findMoth', () => { m = p.dimension.getEntities({ type: MOTH_ID, location: p.location, maxDistance: 14 }).find((e) => !guides.has(e.id)) || null; });
    if (!m) {
      const eye = p.getHeadLocation();
      const view = p.getViewDirection();
      const spot = { x: eye.x + view.x * 3, y: eye.y + 0.3, z: eye.z + view.z * 3 };
      const c = new BlockCache(p.dimension);
      const f = floor3(spot);
      const pos = c.passable(f.x, f.y, f.z) ? spot : (hiddenAirNear(p.dimension, p.location, eye, 4) || { x: eye.x, y: eye.y + 0.6, z: eye.z });
      safe('spawnGuide', () => { m = p.dimension.spawnEntity(MOTH_ID, pos); m.setDynamicProperty('sb:born', worldTicks()); });
    }
    if (m) { startGuide(m, nd.den, p); log('basic', `guide moth leading ${p.name} toward den #${nd.den.id} (${Math.round(nd.dist)} blocks)`); }
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

/**
 * Preferred placement: a node of the brain's walk map (so the den is provably connected to the player
 * by walkable cave), 26-46 steps away, out of sight, dark, with a little open floor around it.
 */
export function tryGenerateDenFromMap(player, map) {
  const cfg = config();
  if (!cfg.denGeneration || cfg.harmless || building || !map) return false;
  if (activeDens().length >= 6 || nearestDen(player.location, 140)) return false;
  const dim = player.dimension;
  const eye = player.getHeadLocation();
  const c = map.cache;
  const cands = map.list().filter((n) => n.d >= 26 && n.d <= 46 && !n.crawl);
  for (let i = 0; i < 40 && cands.length; i++) {
    const n = cands.splice(randi(0, cands.length - 1), 1)[0];
    if (c.headroom(n.x, n.y, n.z) < 3) continue;
    if (lightAt(dim, { x: n.x, y: n.y + 1, z: n.z }) > 6) continue;
    if (lineOfSight(dim, eye, { x: n.x + 0.5, y: n.y + 1.2, z: n.z + 0.5 })) continue;
    let open = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (c.floor(n.x + dx, n.y - 1, n.z + dz) && c.passable(n.x + dx, n.y, n.z + dz) && c.passable(n.x + dx, n.y + 1, n.z + dz)) open++;
    if (open < 9) continue;
    let clean = true;
    for (let k = 0; k < 40 && clean; k++) {
      const q = { x: n.x + randi(-4, 4), y: n.y + randi(-1, 3), z: n.z + randi(-4, 4) };
      const id = c.id(q.x, q.y, q.z);
      if (id === '?' || isPlayerMadeHint(id) || wasPlaced(q)) clean = false;
    }
    if (!clean) continue;
    buildDen(dim, { x: n.x, y: n.y, z: n.z }, c);
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
