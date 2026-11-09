// @ts-check
import { system } from '@minecraft/server';
import { ACT } from '../../generated/acts.js';
import { now, sec, valid, sub, len, lenXZ, dist, center, rand, randi, chance, pick, floor3, angleTo, norm } from '../../core/util.js';
import { findSpot, perceive, bodyPoints, creatureMap, lineOfSight, lightAt } from '../../world/space.js';
import { creature, spawnCreature, seenByAnyone } from '../creature.js';
import { noteSighting } from '../memory.js';
import { playAt, playFor, setDanger, caption } from '../../audio.js';
import { log } from '../../core/log.js';
import { spawnMoths } from '../../world/den.js';

/** @typedef {import('../creature.js').Creature} Creature */

/** pause n ticks inside an encounter generator */
export const W = (n) => Math.max(1, Math.round(n));

export function seen(ctx, cr) {
  if (!cr || !cr.valid) return { visible: false, angle: 180, dist: 999, headVisible: false };
  return perceive(ctx.player, bodyPoints(cr.loc, cr.stance));
}

/** mark a confirmed sighting once per encounter */
export function sighted(ctx) {
  if (ctx.spotted) return;
  ctx.spotted = true;
  noteSighting(ctx.player);
  ctx.tel.notes.push('sighted');
}

/**
 * Spawn the creature at a validated spot from the walk map.
 * @returns {Creature|null}
 */
export function appear(ctx, query, opts = {}) {
  let spot = query.pos ? { pos: query.pos, node: null } : findSpot(ctx.map, ctx.player, query);
  if (!spot) return null;
  // re-validate at the moment of spawning: never pop into direct view (the player may have turned)
  if (!opts.allowInView) {
    if (inAnyonesView(ctx.player.dimension, spot.pos)) {
      ctx.tel.notes.push('spawn spot now in view: re-planned');
      const q = query.pos ? (ctx.plan && ctx.plan.q) || { minDist: 8, maxDist: 26, los: false, maxLight: 7, crawl: false } : query;
      const ok = (n, c, m) => !inAnyonesView(ctx.player.dimension, c) && (!q.test || q.test(n, c, m));
      spot = findSpot(ctx.map, ctx.player, { ...q, minAngle: Math.max(q.minAngle || 0, 58), test: ok }) || findSpot(ctx.map, ctx.player, { ...q, los: false, test: ok });
      if (!spot) return null;
    }
  }
  const facePos = opts.face === 'away' ? awayPoint(spot.pos, ctx.player.location) : ctx.player.getHeadLocation();
  const existing = creature();
  if (existing) {
    // the creature already lives in these caves: it moves to the spot while nobody is looking
    if (seenByAnyone(existing) || inAnyonesView(existing.dim, existing.loc)) { ctx.tel.notes.push('creature watched: could not reposition'); return null; }
    existing.stop(); existing.releaseTarget(); existing.setGravity(true); existing.lockStance = false;
    existing.setGait(0); existing.setSpectral(!!opts.spectral); existing.setEyes(opts.eyes ?? 0.85);
    try { existing.e.teleport(spot.pos, { keepVelocity: false }); } catch { return null; }
    existing.setMode('still');
    existing.setPhase(opts.phase || 'watching');
    existing.setAct(opts.act || 0, !!opts.act);
    existing.face(facePos);
    ctx.creatureSpot = spot;
    ctx.tel.notes.push(`moved into position d=${spot.dist?.toFixed?.(1)} light=${lightAt(ctx.player.dimension, spot.pos)}`);
    return existing;
  }
  const cr = spawnCreature(ctx.player.dimension, spot.pos, { phase: opts.phase || 'watching', act: opts.act || 0, eyes: opts.eyes ?? 0.85, spectral: opts.spectral, face: facePos });
  if (cr) { ctx.creatureSpot = spot; ctx.tel.notes.push(`arrived d=${spot.dist?.toFixed?.(1)} light=${lightAt(ctx.player.dimension, spot.pos)}`); }
  return cr;
}

/** is this spot inside any nearby player's direct view right now? (multiplayer-safe spawning) */
export function inAnyonesView(dim, pos) {
  const pts = [{ x: pos.x, y: pos.y + 2.3, z: pos.z }, { x: pos.x, y: pos.y + 1.5, z: pos.z }, { x: pos.x, y: pos.y + 0.6, z: pos.z }];
  for (const p of dim.getPlayers({ location: pos, maxDistance: 56 })) {
    let eye; try { eye = p.getHeadLocation(); } catch { continue; }
    for (const pt of pts) if (angleTo(p.getViewDirection(), eye, pt) < 52 && lineOfSight(dim, eye, pt)) return true;
  }
  return false;
}

export function awayPoint(from, player) {
  const d = sub(from, player);
  return { x: from.x + d.x, y: from.y + 1.6, z: from.z + d.z };
}

/**
 * Hold while observing the player. Resolves with the first event that happens:
 *  'spotted'   player looks straight at it (sustained)
 *  'contact'   prolonged eye contact accumulated beyond `stareLimit`
 *  'approach'  player walks inside `approachDist`
 *  'touched'   player within 2.2 blocks
 *  'timeout'   nothing happened
 *  'gone'      creature vanished / invalid
 */
export function* hold(ctx, cr, o = {}) {
  const until = now() + (o.ticks ?? sec(20));
  let lookTicks = 0; let contact = ctx.contact ?? 0;
  const spotNeed = o.spotTicks ?? 5;
  while (now() < until) {
    yield W(o.every ?? 4);
    if (!cr.valid) return 'gone';
    if (o.faceEvery && now() % o.faceEvery < 4) cr.face(ctx.player.getHeadLocation());
    const s = seen(ctx, cr);
    ctx.lastSeen = s;
    if (s.visible && s.angle < 60) setDanger(ctx.player, Math.max(0.15, Math.min(0.55, 1.2 - s.dist / 40)));
    if (s.dist < 2.4) return 'touched';
    if (o.approachDist && s.dist < o.approachDist) return 'approach';
    if (s.visible && s.angle < (o.spotAngle ?? 24)) {
      lookTicks += o.every ?? 4;
      if (s.headVisible && s.angle < 12) contact += o.every ?? 4;
      if (lookTicks >= spotNeed) { sighted(ctx); if (o.returnOnSpot !== false) return 'spotted'; }
    } else lookTicks = Math.max(0, lookTicks - 2);
    ctx.contact = contact;
    if (o.stareLimit && contact >= o.stareLimit) return 'contact';
    if (o.custom) { const r = o.custom(s); if (r) return r; }
  }
  return 'timeout';
}

/** a creature-reachable cell hidden from the player, away from them */
export function hiddenRetreat(ctx, cr, minPath = 4, maxPath = 18) {
  const m = creatureMap(cr.e, 450, maxPath + 2);
  if (!m) return null;
  m.finish(3000);
  const eye = ctx.player.getHeadLocation();
  const from = cr.loc;
  const pl = ctx.player.location;
  const cands = m.list().filter((n) => n.d >= minPath && n.d <= maxPath).sort((a, b) => lenXZ(sub(center(b), pl)) - lenXZ(sub(center(a), pl)));
  let tries = 0;
  for (const n of cands) {
    if (tries++ > 40) break;
    const c = center(n);
    if (lenXZ(sub(c, pl)) < lenXZ(sub(from, pl)) - 1) continue; // must not move toward the player
    if (!lineOfSight(ctx.player.dimension, eye, { x: c.x, y: c.y + 1.6, z: c.z }) && !lineOfSight(ctx.player.dimension, eye, { x: c.x, y: c.y + 2.6, z: c.z })) {
      return { node: n, pos: c, path: m.pathTo(n) };
    }
  }
  return null;
}

/**
 * Standard non-violent ending. It never walks away from you: unseen, it is simply gone; seen, it
 * vanishes where it stands (or, now and then, bursts into shaft moths).
 */
export function* passiveExit(ctx, cr, style = 'auto') {
  if (!cr || !cr.valid) return;
  const s = seen(ctx, cr);
  if (!s.visible && style !== 'moths') { cr.vanish(true); return; }
  if (style === 'moths' || chance(0.12)) {                           // L26: original shaft-moth scatter exit
    ctx.tel.notes.push('L26 moth scatter');
    cr.halt();
    cr.setAct(ACT.ROAR);
    yield W(sec(0.6));
    spawnMoths(cr.dim, { x: cr.loc.x, y: cr.loc.y + 1.5, z: cr.loc.z }, randi(4, 6), null);
    try { cr.dim.spawnParticle('shaftbreaker:wisp', cr.loc); } catch { /* ignore */ }
    playAt(cr.dim, 'shaftbreaker.moth_flutter', cr.loc, 1.0, 0.8);
    cr.vanish(false);
    return;
  }
  ctx.tel.notes.push('exit: vanished in place');
  cr.halt();
  cr.face(ctx.player.getHeadLocation());
  if (style === 'glance') { cr.setAct(ACT.LAST_GLANCE, true); yield W(sec(1.6)); }
  cr.setAct(ACT.VANISH);
  yield W(sec(0.9));
  cr.vanish(false);
}

/** a plausible 3D position for a sound with no creature (behind stone / down a side tunnel) */
export function soundSpot(ctx, minD = 8, maxD = 20, hidden = true) {
  const s = findSpot(ctx.map, ctx.player, { minDist: minD, maxDist: maxD, los: hidden ? false : undefined, maxChecks: 50 });
  if (s) return { x: s.pos.x, y: s.pos.y + 1, z: s.pos.z };
  const p = ctx.player.location; const a = rand(0, Math.PI * 2); const d = rand(minD, maxD);
  return { x: p.x + Math.cos(a) * d, y: p.y + rand(-2, 3), z: p.z + Math.sin(a) * d };
}

/** sound at a world spot heard by the target (and anyone else nearby, it is a real sound) */
export function sfx(ctx, id, pos, vol = 1, pitch = 1) { playAt(ctx.player.dimension, id, pos, vol, pitch); }

/** spawn a claw-scratch decal on the nearest wall face around a point (N43) */
export function scratchNear(dim, pos, tries = 10) {
  const b = floor3(pos);
  for (let i = 0; i < tries; i++) {
    const x = b.x + randi(-2, 2), y = b.y + randi(0, 2), z = b.z + randi(-2, 2);
    let blk; try { blk = dim.getBlock({ x, y, z }); } catch { continue; }
    if (!blk || blk.isAir || blk.isLiquid) continue;
    const id = blk.typeId;
    if (!/stone|deepslate|tuff|granite|diorite|andesite|dirt|calcite|dripstone/.test(id)) continue;
    /** @type {[number, number, string, number, number][]} */
    const faces = [[1, 0, 'scratch_ew', 1.02, 0.5], [-1, 0, 'scratch_ew', -0.02, 0.5], [0, 1, 'scratch_ns', 0.5, 1.02], [0, -1, 'scratch_ns', 0.5, -0.02]];
    for (const [dx, dz, pid, ox, oz] of faces) {
      let nb; try { nb = dim.getBlock({ x: x + dx, y, z: z + dz }); } catch { continue; }
      if (nb && nb.isAir) {
        try { dim.spawnParticle(`shaftbreaker:${pid}`, { x: x + ox, y: y + 0.5 + rand(-0.15, 0.2), z: z + oz }); } catch { /* ignore */ }
        return true;
      }
    }
  }
  return false;
}

/** escalate an observation into a hunt (only through this readable path) */
export function wantsHunt(ctx, base) {
  const ps = ctx.ps;
  let p = base;
  if (ps.state === 'provoked') p *= 1.7;
  if (ctx.allowHunt === false) p = 0;
  return chance(Math.min(0.85, p));
}

export { now, sec, valid, dist, len, rand, randi, chance, pick, angleTo, norm, center, caption, playFor, setDanger, log, system, creature };
