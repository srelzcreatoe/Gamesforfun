// @ts-check
import { world, system } from '@minecraft/server';
import { ACT } from '../../generated/acts.js';
import { W, seen, sighted, appear, hiddenRetreat, passiveExit, sfx, scratchNear, soundSpot } from './common.js';
import { now, sec, valid, sub, len, lenXZ, dist, norm, rand, chance, pick, center, floor3, clamp, safe } from '../../core/util.js';
import { config } from '../../core/config.js';
import { MEATS, DAMAGING, isWoodenDoorId } from '../../core/blocks.js';
import { creature } from '../creature.js';
import { profile, evidence, weaken, trait, unlocked, curious, bumpRegion, regionCenter, markDirty } from '../memory.js';
import { ws, wsDirty, addDanger } from '../worldstate.js';
import { setDanger, startMusic, stopMusic, caption, playAt } from '../../audio.js';
import { isUnderground, skyLightAt, findSpot, lineOfSight, BlockCache } from '../../world/space.js';
import { canBreak } from '../../world/protection.js';
import { log } from '../../core/log.js';

function diffMul() {
  try {
    const d = String(world.getDifficulty()).toLowerCase();
    return d === 'easy' ? 0.6 : d === 'hard' ? 1.4 : d === 'peaceful' ? 0 : 1.0;
  } catch { return 1; }
}

function canHurt(ctx) {
  return (pl) => valid(pl) && now() >= ctx.ps.graceUntil && !config().harmless;
}

/** narrow corridor test (walls on both sides of the line toward the player) */
function narrowCorridor(cr, toward) {
  const c = new BlockCache(cr.dim);
  const l = floor3(cr.loc);
  const f = norm({ x: toward.x - cr.loc.x, y: 0, z: toward.z - cr.loc.z });
  const r = { x: Math.round(-f.z), z: Math.round(f.x) };
  let walls = 0;
  for (const s of [1, -1]) if (!c.passable(l.x + r.x * s, l.y + 1, l.z + r.z * s)) walls++;
  return walls === 2;
}

// ------------------------------------------------------------------ special attacks (all telegraphed)
function* cornerLunge(ctx, cr) {                                     // N21
  const pl = ctx.player;
  ctx.tel.notes.push('N21 corner lunge');
  cr.setMode('scripted'); cr.face(pl.location);
  cr.setAct(ACT.BRACE);
  playAt(cr.dim, 'shaftbreaker.scrape', cr.loc, 0.9, 0.8);
  yield W(sec(1.0));                                                // one-second wall brace = dodge window
  if (!cr.valid) return;
  const d = norm(sub(pl.location, cr.loc));
  cr.setAct(ACT.LUNGE);
  safe('lunge', () => cr.e.applyImpulse({ x: d.x * 1.15, y: 0.28, z: d.z * 1.15 }));
  yield W(sec(0.38));
  if (cr.inFront(pl, 2.8, 65) || dist(cr.loc, pl.location) < 2.0) {
    if (cr.strike(pl, 8 * diffMul(), canHurt(ctx))) ctx.hits++;
  }
  yield W(sec(0.5));
}

function* rupture(ctx, cr) {                                         // ground rupture
  const pl = ctx.player;
  ctx.tel.notes.push('rupture');
  cr.setMode('scripted'); cr.face(pl.location);
  cr.setAct(ACT.RUPTURE);
  yield W(sec(0.15));
  safe('warn', () => cr.dim.spawnParticle('shaftbreaker:warning_ring', cr.loc));
  yield W(sec(0.83));
  if (!cr.valid) return;
  safe('rupt', () => cr.dim.spawnParticle('shaftbreaker:rupture', cr.loc));
  for (const p of cr.dim.getPlayers({ location: cr.loc, maxDistance: 3.6 })) {
    if (Math.abs(p.location.y - cr.loc.y) > 2) continue;
    if (cr.strike(p, 8 * diffMul(), canHurt(ctx))) { ctx.hits++; safe('slow', () => p.addEffect('slowness', 40, { amplifier: 1, showParticles: false })); }
  }
  yield W(sec(0.6));
}

function* heavyStrike(ctx, cr) {                                     // heavy + L38 shield pressure
  const pl = ctx.player;
  ctx.tel.notes.push('heavy');
  cr.setMode('scripted'); cr.face(pl.location);
  cr.setAct(ACT.HEAVY);
  yield W(sec(1.05));                                               // long wind-up
  if (!cr.valid) return;
  if (cr.inFront(pl, 3.4, 75)) {
    const blocking = safe('sneak', () => /** @type {any} */ (pl).isSneaking, false) && holdsShield(pl);
    if (blocking && unlocked(pl, 'shield_dependence')) {
      safe('shield', () => pl.startItemCooldown('shield', 100));
      caption(pl, 'Your shield is wrenched aside');
      ctx.tel.notes.push('L38 shield pressure');
    }
    if (cr.strike(pl, 9 * diffMul(), canHurt(ctx))) ctx.hits++;
    if (blocking) evidence(pl, 'shield_dependence', 1, 'blocked a heavy strike');
  }
  yield W(sec(0.7));
}

function holdsShield(pl) {
  return !!safe('shield?', () => {
    const eq = pl.getComponent('minecraft:equippable');
    const off = eq?.getEquipment(/** @type {any} */ ('Offhand'));
    const main = eq?.getEquipment(/** @type {any} */ ('Mainhand'));
    return (off && off.typeId === 'minecraft:shield') || (main && main.typeId === 'minecraft:shield');
  }, false);
}

function* vehicleStrike(ctx, cr, vehicle) {                          // L37
  ctx.tel.notes.push('L37 vehicle strike');
  cr.setMode('scripted'); cr.face(vehicle.location);
  cr.setAct(ACT.CLAW_RIGHT);
  playAt(cr.dim, 'shaftbreaker.growl', cr.loc, 0.9, 1.0);
  yield W(sec(0.55));
  if (dist(cr.loc, vehicle.location) < 3.4) {
    safe('eject', () => vehicle.getComponent('minecraft:rideable')?.ejectRiders());
    caption(ctx.player, 'It tore you from the cart');
  }
  yield W(sec(0.4));
}

/** L82 meat distraction: non-guaranteed, limited uses */
function findMeat(cr) {
  try {
    for (const it of cr.dim.getEntities({ type: 'minecraft:item', location: cr.loc, maxDistance: 9 })) {
      const stack = it.getComponent('minecraft:item')?.itemStack;
      if (stack && MEATS.has(stack.typeId)) return it;
    }
  } catch { /* ignore */ }
  return null;
}

function* eatMeat(ctx, cr, item) {
  ctx.tel.notes.push('L82 meat taken');
  cr.setPhase('stalking');
  cr.moveTo(item.location, true);
  const until = now() + sec(6);
  while (now() < until && cr.valid && valid(item) && !cr.arrived(1.6)) yield W(4);
  cr.setMode('scripted');
  cr.setAct(ACT.EAT, true);
  safe('meat', () => valid(item) && item.remove());
  yield W(sec(rand(3.5, 5.5)));
  cr.clearAct();
}

// ------------------------------------------------------------------ the pursuit
/**
 * Shared pursuit loop (Breaker -> Frenzy). Returns an outcome string.
 * @param {any} ctx
 * @param {import('../creature.js').Creature} cr
 */
export function* pursue(ctx, cr, opts = {}) {
  const pl = ctx.player;
  const cfg = config();
  const pf = profile(pl);
  ctx.hits = 0;
  ctx.huntLog = [];
  ctx.ps.huntPlaced = 0;
  ctx.ps.huntDoors = 0;
  const maxT = sec(cfg.maxHuntSeconds);
  const t0 = now();
  let phase = 'breaker';
  let frenzyTicks = 0;
  let lostLOS = 0;
  let nextSpecial = now() + sec(rand(3, 5));
  let stuckFails = 0;
  let meatUsed = 0;
  let surfaceT = 0;
  let trapPause = 0;
  let lastDoorRattle = 0;
  let vehicleSince = 0;
  // adaptive navigation unlocks
  if (unlocked(pl, 'escape_door')) { cr.setNav('doors'); ctx.tel.notes.push('L45 doors unlocked'); }
  if (unlocked(pl, 'escape_pillars') && chance(0.7)) { cr.setNav('climb'); ctx.tel.notes.push('L47 climbing approach'); }
  cr.setPhase('breaker');
  cr.huntTarget(pl, false);
  ctx.tel.phases.push('breaker');
  const quiet = !!opts.quiet;
  if (!quiet) startMusic(pl, 'music.shaftbreaker.chase');

  while (true) {
    yield W(5);
    if (!valid(pl)) return 'player_left';
    if (!cr.valid) return cr.defeated ? 'defeated' : 'lost';
    let hp = 1;
    try { const h = cr.e.getComponent('minecraft:health'); hp = h ? h.currentValue / h.effectiveMax : 1; } catch { /* ignore */ }
    if (safe('dead?', () => pl.getComponent('minecraft:health')?.currentValue ?? 1, 1) <= 0) return 'caught';
    const el = now() - t0;
    const d = dist(cr.loc, pl.location);
    const s = seen(ctx, cr);
    if (s.visible) { lostLOS = 0; if (s.angle < 40) sighted(ctx); } else lostLOS += 5;
    setDanger(pl, clamp(1.15 - d / 30, 0.35, 1));
    // learning samples (one per second)
    if (el % 20 < 5) {
      ctx.huntLog.push({
        t: now(), x: pl.location.x, y: pl.location.y, z: pl.location.z,
        water: safe('w', () => pl.isInWater || pl.isSwimming, false), climb: safe('c', () => pl.isClimbing, false),
        ride: !!safe('r', () => pl.getComponent('minecraft:riding')?.entityRidingOn, null), vis: s.visible,
      });
    }
    // ---- end conditions
    if (el >= maxT) return 'cap';
    if (phase === 'frenzy' && frenzyTicks >= sec(Math.min(30, cfg.maxHuntSeconds))) return 'cap';
    if (d > 48 || (lostLOS > sec(12) && d > 22)) return 'escaped';
    if (!isUnderground(pl)) {
      surfaceT += 5;
      if (!cfg.surfaceMode || surfaceT > sec(6)) return 'surface';      // L52 / L53
    } else surfaceT = 0;
    if (hp < 0.4 && el > sec(3)) return 'low_health';                     // L40 / L41
    if (cr.act && cr.act !== ACT.CLIMB) continue;
    // ---- trap recognition (N17): hesitate near a hazard type that hurt it before
    if (unlocked(pl, 'trap_reuse') && now() > trapPause && hazardAhead(cr, pl.location) && chance(0.55)) {
      trapPause = now() + sec(8);
      ctx.tel.notes.push('N17 tested a step');
      cr.setMode('scripted'); cr.setAct(ACT.LISTEN);
      yield W(sec(1.4));
      cr.clearAct(); cr.huntTarget(pl, phase === 'frenzy');
      continue;
    }
    // ---- meat distraction
    if (meatUsed < 2) {
      const meat = findMeat(cr);
      if (meat) {
        meatUsed++;
        const p = 0.65 - meatUsed * 0.15 - Math.min(0.3, (pf.meatTaken || 0) * 0.05);
        if (chance(p)) {
          pf.meatTaken = (pf.meatTaken || 0) + 1; markDirty(pl);
          yield* eatMeat(ctx, cr, meat);
          if (chance(0.6)) return 'distracted';
          cr.huntTarget(pl, phase === 'frenzy');
        }
      }
    }
    // ---- vehicles
    const veh = safe('veh', () => pl.getComponent('minecraft:riding')?.entityRidingOn, null);
    if (veh) {
      if (!vehicleSince) { vehicleSince = now(); cr.setMode('frenzy'); }
      if (now() - vehicleSince > sec(5) && dist(cr.loc, veh.location) < 3.2) { yield* vehicleStrike(ctx, cr, veh); vehicleSince = now(); cr.huntTarget(pl, true); }
    } else vehicleSince = 0;
    // ---- stuck: break / climb / disengage
    if (cr.stuck && d < 30) {
      const doorNear = doorBetween(cr, pl.location);
      if (doorNear && cr.nav !== 'doors' && now() > lastDoorRattle) {
        lastDoorRattle = now() + sec(4);
        playAt(cr.dim, 'shaftbreaker.scrape', doorNear, 1.0, 1.2);
        playAt(cr.dim, 'random.door_close', doorNear, 0.7, 0.7);
        ctx.tel.notes.push('door rattle (not unlocked)');
      }
      const started = cr.breakToward(pl.location, () => cr.huntTarget(pl, phase === 'frenzy'));
      if (started) { ctx.tel.notes.push('breaker cleared path'); yield W(sec(1.3)); cr.stuckTicks = 0; continue; }
      if (cr.nav !== 'climb' && curious(pl, 'escape_pillars')) { cr.setNav('climb'); cr.stuckTicks = 20; continue; }
      stuckFails++;
      cr.stuckTicks = 20;
      if (stuckFails >= 4) return 'no_path';
    }
    // ---- N26 failed leap: when the player is above it, it sometimes misses the ledge (a fair opening)
    if (!ctx.leapTried && pl.location.y - cr.loc.y >= 2 && lenXZ(sub(pl.location, cr.loc)) < 5 && chance(0.2)) {
      ctx.leapTried = true;
      ctx.tel.notes.push('N26 failed leap');
      cr.setMode('scripted'); cr.face(pl.location); cr.setAct(ACT.FAILED_LEAP);
      yield W(sec(2.0));
      cr.huntTarget(pl, phase === 'frenzy');
      continue;
    }
    // ---- N46 blocked return: a little natural gravel drops into the corridor ahead of a fleeing player (never seals)
    if (!ctx.blockTried && d > 9 && d < 24 && el > sec(6) && chance(0.04)) {
      ctx.blockTried = true;
      yield* blockedReturn(ctx, cr);
    }
    // ---- escalation to Frenzy
    if (phase === 'breaker' && ((s.visible && d < 14 && el > sec(3)) || el > sec(9))) {
      phase = 'frenzy';
      ctx.tel.phases.push('frenzy');
      cr.setPhase('frenzy');
      const g = Math.random();
      cr.setGait(g < 0.16 ? 1 : g < 0.23 ? 2 : 0);               // N23 crooked / N28 broken-leg sprint
      if (!quiet) playAt(cr.dim, 'shaftbreaker.screech', cr.loc, 1.0, rand(0.92, 1.05));
      cr.huntTarget(pl, true);
    }
    if (phase === 'frenzy') frenzyTicks += 5;
    // ---- specials
    if (now() >= nextSpecial && s.visible) {
      let did = false;
      if (d > 3.5 && d < 8 && narrowCorridor(cr, pl.location) && chance(0.5)) { yield* cornerLunge(ctx, cr); did = true; }
      else if (phase === 'breaker' && d < 4.2 && chance(0.4)) { yield* rupture(ctx, cr); did = true; }
      else if (phase === 'frenzy' && d < 3.2 && chance(0.35 + (unlocked(pl, 'shield_dependence') ? 0.25 : 0))) { yield* heavyStrike(ctx, cr); did = true; }
      else if (unlocked(pl, 'melee_retreat') && d < 5 && chance(0.3)) {     // lateral approach with warning
        ctx.tel.notes.push('L44 lateral approach');
        const side = norm({ x: -(pl.location.z - cr.loc.z), y: 0, z: pl.location.x - cr.loc.x });
        const sgn = chance(0.5) ? 1 : -1;
        playAt(cr.dim, 'shaftbreaker.click', cr.loc, 0.9, 1.1);
        safe('side', () => cr.e.applyImpulse({ x: side.x * 0.6 * sgn, y: 0.15, z: side.z * 0.6 * sgn }));
        did = true;
      }
      nextSpecial = now() + sec(did ? rand(4, 6.5) : 1.5);
      if (did && cr.valid) cr.huntTarget(pl, phase === 'frenzy');
    }
  }
}

function* blockedReturn(ctx, cr) {
  const pl = ctx.player;
  const cfg = config();
  if (cfg.harmless || cfg.blockDestruction !== 'natural') return;
  const v = safe('pv', () => pl.getVelocity(), { x: 0, y: 0, z: 0 });
  const sp = Math.sqrt(v.x * v.x + v.z * v.z);
  if (sp < 0.08) return;
  const f = { x: v.x / sp, z: v.z / sp };
  const c = new BlockCache(cr.dim);
  for (let k = 5; k <= 8; k++) {
    const q = floor3({ x: pl.location.x + f.x * k, y: pl.location.y, z: pl.location.z + f.z * k });
    // floor cell with two open cells above it and natural stone around: a 1-high bump you can hop or mine
    if (!c.floor(q.x, q.y - 1, q.z) || !c.passable(q.x, q.y, q.z) || !c.passable(q.x, q.y + 1, q.z) || !c.passable(q.x, q.y + 2, q.z)) continue;
    const below = { x: q.x, y: q.y - 1, z: q.z };
    if (!canBreak(cr.dim, below)) continue;                      // natural surroundings only, nothing built nearby
    ctx.tel.notes.push('N46 blocked return (1-high gravel, not sealed)');
    safe('warn', () => cr.dim.spawnParticle('shaftbreaker:dust_fall', { x: q.x + 0.5, y: q.y + 2.8, z: q.z + 0.5 }));
    playAt(cr.dim, 'shaftbreaker.debris_fall', center(q), 0.9, 0.9);
    caption(pl, 'Gravel shifts ahead of you', q);
    yield W(sec(1.2));
    safe('gravel', () => { const b = cr.dim.getBlock(q); if (b && b.isAir) b.setType('minecraft:gravel'); });
    return;
  }
}

function hazardAhead(cr, toward) {
  const c = new BlockCache(cr.dim);
  const f = norm(sub(toward, cr.loc));
  for (let i = 1; i <= 3; i++) {
    const p = floor3({ x: cr.loc.x + f.x * i, y: cr.loc.y, z: cr.loc.z + f.z * i });
    if (DAMAGING.has(c.id(p.x, p.y, p.z)) || DAMAGING.has(c.id(p.x, p.y - 1, p.z))) return true;
  }
  return false;
}

function doorBetween(cr, toward) {
  const c = new BlockCache(cr.dim);
  const f = norm(sub(toward, cr.loc));
  for (let i = 1; i <= 3; i++) {
    const p = floor3({ x: cr.loc.x + f.x * i, y: cr.loc.y, z: cr.loc.z + f.z * i });
    for (const dy of [0, 1]) if (isWoodenDoorId(c.id(p.x, p.y + dy, p.z))) return center(p);
  }
  return null;
}

/** post-hunt learning: classify the escape from what was observed (never guessed) */
export function learnFromHunt(ctx, outcome) {
  const pl = ctx.player;
  if (!valid(pl)) return;
  const pf = profile(pl);
  pf.hunts++;
  const log8 = (ctx.huntLog || []).slice(-16);
  const escaped = outcome === 'escaped' || outcome === 'cap' || outcome === 'surface' || outcome === 'no_path';
  if (outcome === 'caught') pf.huntsCaught++;
  if (escaped && log8.length >= 2) {
    pf.huntsEscaped++;
    const minY = Math.min(...log8.map((q) => q.y));
    const dy = log8[log8.length - 1].y - minY;
    ctx.tel.notes.push(`learn: dy=${dy.toFixed(1)} samples=${log8.length} climb=${log8.some((q) => q.climb)} water=${log8.some((q) => q.water)} doors=${ctx.ps.huntDoors || 0} placed=${ctx.ps.huntPlaced || 0}`);
    if (outcome === 'surface') evidence(pl, 'escape_surface', 1.2, 'ran for daylight');
    if (log8.some((s) => s.water)) evidence(pl, 'escape_water', 1, 'escaped through water');
    if ((ctx.ps.huntPlaced || 0) >= 3 && dy > 2.5) evidence(pl, 'escape_pillars', 1.1, 'pillared up');
    else if (dy >= 4 || log8.some((s) => s.climb)) evidence(pl, 'escape_stairs', 1, 'escaped upward');
    if ((ctx.ps.huntDoors || 0) >= 1 && (outcome === 'no_path' || outcome === 'escaped')) evidence(pl, 'escape_door', 1.2, 'closed a door on it');
    // N11: remember a few real escape routes (8-block regions)
    const lost = log8.find((s) => !s.vis) || log8[Math.floor(log8.length / 2)];
    if (lost) {
      const r = bumpRegion(pf.routes, lost);
      if (ctx.routeTried && (Math.abs(ctx.routeTried.x - r.x) + Math.abs(ctx.routeTried.z - r.z) > 1)) {
        weaken(pl, 'escape_stairs', 12, 'player used a different route');
      }
    }
  }
  if (outcome === 'low_health' || outcome === 'defeated') pf.defeats += outcome === 'defeated' ? 1 : 0;
  markDirty(pl);
}

// ------------------------------------------------------------------ hunt templates
const HUNT_BASE = {
  family: 'hunt', needsCreature: true, phases: ['breaker', 'frenzy'],
  trigger: 'provoked director state, navigable route, protection checks pass',
  telegraph: 'roar (or silent: dust, breath, raised arm) and 2-3 s brace before any hit; music starts',
  counterplay: 'break line of sight, change routes, doors/water/height, regroup, meat bait, fight back',
};

export const HUNT_TEMPLATES = [
  {
    ...HUNT_BASE,
    id: 'hunt', features: ['N26', 'N46', 'N49', 'N22', 'L25', 'L27', 'L28', 'L29', 'L30', 'L31', 'L32', 'L33', 'L34', 'L35', 'L37', 'L38', 'L39', 'L40', 'L41', 'L42', 'L43', 'L45', 'L47', 'L48', 'L52', 'L53', 'L63', 'L82', 'N17', 'N21', 'N23', 'N27', 'N28', 'N30', 'N35'],
    minState: 'observing', minSightings: 2, cooldownMin: 9,
    weight: () => 1,
    plan(ctx) {
      const existing = creature();
      if (existing) return { reuse: true };
      const q = { minPath: 12, maxPath: 30, minDist: 12, maxDist: 26, los: false, maxLight: 7, crawl: false, maxChecks: 80 };
      return findSpot(ctx.map, ctx.player, q) ? { q } : null;
    },
    *run(ctx, plan) {
      return yield* huntSequence(ctx, plan);
    },
  },
  {
    ...HUNT_BASE,
    id: 'ambush', features: ['N11', 'N12', 'N14', 'N18', 'L54'], minState: 'observing', minSightings: 3, cooldownMin: 14,
    trigger: 'player near a remembered escape route or shelter (3+ uses)',
    telegraph: 'distant scratching near the familiar path; dust from the hiding spot if it gives up',
    counterplay: 'use another route, keep line of sight, light the route, travel together',
    weight(ctx) { const pf = profile(ctx.player); return pf.routes.some((r) => r.n >= 3) || pf.shelters.some((r) => r.n >= 3) ? 1.6 : 0; },
    plan(ctx) {
      const pf = profile(ctx.player);
      const regions = [...pf.routes, ...pf.shelters].filter((r) => r.n >= 3);
      for (const r of regions) {
        const rc = regionCenter(r);
        if (lenXZ(sub(rc, ctx.player.location)) > 40) continue;
        const spot = findSpot(ctx.map, ctx.player, { minDist: 9, maxDist: 30, los: false, maxLight: 7, crawl: false, test: (n, c) => lenXZ(sub(c, rc)) < 9 });
        if (spot) return { spot, region: r };
      }
      return null;
    },
    *run(ctx, plan) {
      const pl = ctx.player;
      ctx.routeTried = plan.region;
      ctx.tel.notes.push('N11 interception at remembered route');
      sfx(ctx, 'shaftbreaker.scrape', plan.spot.pos, 0.6, 0.85);
      const cr = appear(ctx, { pos: plan.spot.pos }, { phase: 'dormant', eyes: 0.35 });
      if (!cr) return 'no_spawn';
      cr.setMode('still');
      yield W(sec(2));
      // N18: abort when the setup is unfavourable (group, light, success cap)
      const cancel = () => {
        const mates = world.getAllPlayers().filter((p) => p.id !== pl.id && dist(p.location, pl.location) < 9).length;
        const lit = safe('light', () => cr.dim.getLightLevel(floor3(cr.loc)), 0) >= 9;
        return mates > 0 || lit;
      };
      const until = now() + sec(60);
      while (now() < until && cr.valid) {
        yield W(10);
        if (cancel()) {
          ctx.tel.notes.push('N18 ambush cancelled');
          safe('dust', () => cr.dim.spawnParticle('shaftbreaker:dust_fall', { x: cr.loc.x, y: cr.loc.y + 2.8, z: cr.loc.z }));
          sfx(ctx, 'shaftbreaker.debris_fall', cr.loc, 0.6, 1);
          if (!seen(ctx, cr).visible) cr.vanish(true); else yield* passiveExit(ctx, cr, 'backward');
          return 'ambush_cancelled';
        }
        const s = seen(ctx, cr);
        if (dist(cr.loc, pl.location) < 11 || (s.visible && s.angle < 25)) {
          if (!chance(0.65)) { ctx.tel.notes.push('fairness cap: no interception'); yield* passiveExit(ctx, cr, 'backward'); return 'ambush_declined'; }
          return yield* huntSequence(ctx, { reuse: true, short: true });
        }
      }
      cr.vanish(!seen(ctx, cr).visible);
      return 'ambush_expired';
    },
  },
  {
    ...HUNT_BASE,
    id: 'isolation', features: ['N15'], minState: 'observing', minSightings: 2, cooldownMin: 12,
    trigger: 'multiplayer: this player is far from every teammate',
    telegraph: 'faint throat clicks for the isolated player, then the normal hunt tell',
    counterplay: 'regroup: teammates nearby suppress it',
    weight(ctx) { return ctx.isolated ? 1.5 + trait(ctx.player, 'group_separated') * 2 : 0; },
    plan(ctx) { return ctx.isolated ? HUNT_TEMPLATES[0].plan(ctx) : null; },
    *run(ctx, plan) {
      for (let i = 0; i < 2; i++) { sfx(ctx, 'shaftbreaker.click', soundSpot(ctx, 8, 16), 0.7, 1); yield W(sec(rand(2, 4))); }
      const mates = world.getAllPlayers().filter((p) => p.id !== ctx.player.id && dist(p.location, ctx.player.location) < 16);
      if (mates.length) { ctx.tel.notes.push('regrouped: isolation aborted'); return 'regrouped'; }
      return yield* huntSequence(ctx, plan);
    },
  },
];

/** telegraph -> pursuit -> ending (shared by all hunts and escalations) */
export function* huntSequence(ctx, plan = {}) {
  const pl = ctx.player;
  const cfg = config();
  let cr = creature();
  if (!cr) cr = appear(ctx, plan.q || { minPath: 12, maxPath: 30, minDist: 12, maxDist: 26, los: false, maxLight: 8, crawl: false }, { phase: 'watching', eyes: 0.9 });
  if (!cr) return 'no_spawn';
  ctx.allowHunt = false;
  ws().hunts++; wsDirty();
  // ---- TELEGRAPH (no damage possible yet: no attack goal is active)
  cr.setMode('scripted');
  cr.face(pl.location);
  cr.setPhase('breaker');
  cr.setEyes(1.0);
  const quiet = cfg.quietHunt && !cfg.harmless && chance(0.05) && ctx.prefs && !ctx.prefs.reducedChase;
  if (quiet) {                                                         // N35: silent hunt, safety tells remain
    ctx.tel.notes.push('N35 silent pursuit');
    cr.setAct(ACT.BRACE);
    safe('dust', () => cr.dim.spawnParticle('shaftbreaker:dust_fall', { x: cr.loc.x, y: cr.loc.y + 2.6, z: cr.loc.z }));
    sfx(ctx, 'shaftbreaker.breath', cr.loc, 1.0, 0.9);
    caption(pl, 'Heavy breathing. It is coming', cr.loc);
    yield W(sec(2.4));
  } else {
    cr.setAct(ACT.ROAR);
    caption(pl, 'A roar shakes the tunnel', cr.loc);
    yield W(sec(plan.short ? 1.8 : 2.6));
  }
  setDanger(pl, 0.85);
  if (!cr.valid) return 'lost';
  cr.clearAct();
  const outcome = yield* pursue(ctx, cr, { quiet });
  ctx.tel.outcome = outcome;
  stopMusic(pl);
  if (cr.valid) cr.releaseTarget();
  learnFromHunt(ctx, outcome);
  addDanger(-30);
  ws().lastHuntEnd = now(); wsDirty();
  // ---- ENDINGS
  if (!cr.valid) return outcome;
  cr.setGait(0);
  if (outcome === 'low_health') {                                       // N30 desperate scramble
    cr.setAct(ACT.SCRAMBLE, true);
    const r = hiddenRetreat(ctx, cr, 6, 22);
    if (r) cr.moveTo(r.pos, true);
    const until = now() + sec(10);
    while (now() < until && cr.valid && !(r && cr.arrived(1.5))) { yield W(5); if (!seen(ctx, cr).visible && dist(cr.loc, pl.location) > 10) break; }
    cr.vanish(!seen(ctx, cr).visible);
    return outcome;
  }
  if (outcome === 'distracted') { yield* passiveExit(ctx, cr, 'walk'); return outcome; }
  cr.setMode('scripted');
  cr.setAct(ACT.FRENZY_HALT);
  cr.setPhase('watching');
  yield W(sec(1.3));
  if (outcome === 'surface') {
    caption(pl, 'It will not follow you into the light');
    cr.face(pl.location);
    cr.setAct(ACT.STARE, true);
    yield W(sec(3));
  }
  if (outcome === 'caught' || outcome === 'player_left') { cr.vanish(!seen(ctx, cr).visible); return outcome; }
  yield* passiveExit(ctx, cr, 'backward');
  return outcome;
}

export { scratchNear };
