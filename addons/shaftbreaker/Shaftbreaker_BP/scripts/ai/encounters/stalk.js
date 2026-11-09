// @ts-check
/**
 * The visible stalker. These two sequences are the heart of the Shaftbreaker; the director starts them
 * on its own clock (they are not part of the weighted encounter mix).
 *
 *  stalk_show   It appears silently where you will notice it and stays perfectly still: on the ground,
 *               on a high ledge above you, hanging upside down from a cave ceiling, right behind you,
 *               or hidden behind a tree trunk / pillar, peeking out (looked at, it ducks back; looked
 *               away from, it peeks out again from the other side).
 *               Once spotted it decides: vanish, flee, lunge, snap into a rage, or a standoff in which
 *               it tests you (neck crack, head tilt, one slow step) and is a little closer every time
 *               you look away. Stare too long, shoot or hit it and it snaps. Run at it and it either
 *               attacks or vanishes to ambush you later. Walk right up to it and it strikes.
 *  stalk_ambush The ambush it promised: it appears behind you at a worse moment and lunges.
 */
import { world } from '@minecraft/server';
import { ACT } from '../../generated/acts.js';
import { W, seen, sighted, appear, inAnyonesView, passiveExit, hiddenRetreat } from './common.js';
import { huntSequence } from './hunt.js';
import { now, sec, valid, sub, lenXZ, dist, norm, rand, randi, chance, pick, center, floor3, clamp, safe, angleTo, shuffle } from '../../core/util.js';
import { config, freqMul, intensityMul } from '../../core/config.js';
import { creature, SPEED, isDamageable } from '../creature.js';
import { findSpot, lineOfSight, BlockCache } from '../../world/space.js';
import { playAt, setDanger, caption, startMusic, stopMusic, currentMusic } from '../../audio.js';
import { log } from '../../core/log.js';

/** @typedef {import('../creature.js').Creature} Creature */

const isTrunk = (id) => id.endsWith('_log') || id.endsWith('_wood') || id.endsWith('_stem') || id.endsWith('mushroom_stem');

function diffMul() {
  try { const d = String(world.getDifficulty()).toLowerCase(); return d === 'easy' ? 0.6 : d === 'hard' ? 1.4 : d === 'peaceful' ? 0 : 1.0; } catch { return 1; }
}
const canHurt = (ctx) => (pl) => valid(pl) && now() >= ctx.ps.graceUntil && !config().harmless;

// ------------------------------------------------------------------ tension & hunt cadence
export function tension(s) { return s.tension || 0; }
export function addTension(s, v) { s.tension = clamp((s.tension || 0) + v * intensityMul(), 0, 100); }
/** a real chase is due once a few minutes have passed since the last one */
export function huntDue(s) {
  if (!s.huntGap) s.huntGap = sec(rand(240, 400) * freqMul() / intensityMul());
  return now() - (s.lastHuntEnd ?? s.arrivedAt ?? now()) >= s.huntGap;
}

// ------------------------------------------------------------------ show placement
function maxLight(ctx) { return ctx.ps.underground ? 9 : undefined; }

function notWatched(ctx) { return (n, c) => !inAnyonesView(ctx.player.dimension, c); }

function planStill(ctx) {
  const s = findSpot(ctx.map, ctx.player, { minDist: 11, maxDist: 30, los: true, maxAngle: 125, crawl: false, maxLight: maxLight(ctx), maxChecks: 90, test: notWatched(ctx) });
  return s && { kind: 'still', pos: s.pos };
}
function planLedge(ctx) {
  const s = findSpot(ctx.map, ctx.player, { minDist: 7, maxDist: 26, los: true, dy: [3, 16], maxAngle: 150, crawl: false, maxLight: maxLight(ctx), maxChecks: 110, test: notWatched(ctx) });
  return s && { kind: 'ledge', pos: s.pos };
}
function planBehind(ctx) {
  const s = findSpot(ctx.map, ctx.player, { minDist: 6, maxDist: 13, los: true, minAngle: 125, crawl: false, maxLight: maxLight(ctx), maxChecks: 80, test: notWatched(ctx) });
  return s && { kind: 'behind', pos: s.pos };
}
function planCeiling(ctx) {
  if (!ctx.ps.underground) return null;
  const c = ctx.map.cache;
  const dim = ctx.player.dimension;
  const eye = ctx.player.getHeadLocation();
  const s = findSpot(ctx.map, ctx.player, {
    minDist: 7, maxDist: 22, minHeadroom: 4, crawl: false, minAngle: 50, maxLight: maxLight(ctx), maxChecks: 110,
    test: (n, cc) => {
      const h = c.headroom(n.x, n.y, n.z);
      if (h < 4 || h > 7) return false;
      n.ceil = n.y + h;
      const a = { x: cc.x, y: n.ceil - 1.2, z: cc.z };
      return lineOfSight(dim, eye, a) && !inAnyonesView(dim, a);
    },
  });
  return s && { kind: 'ceiling', pos: s.pos, anchor: { x: s.pos.x, y: s.node.ceil - 2.0, z: s.pos.z } };
}

/** behind a real tree trunk (surface) or a pillar / corner (caves): fully hidden, with a side to peek from */
function planPeek(ctx) {
  const p = ctx.player;
  const dim = p.dimension;
  const eye = p.getHeadLocation();
  const c = ctx.map.cache;
  const trees = !ctx.ps.underground;
  let checked = 0;
  for (const n of shuffle(ctx.map.list().filter((q) => !q.crawl && q.d >= 6))) {
    const pos = center(n);
    const d = lenXZ(sub(pos, eye));
    if (d < 9 || d > 28) continue;
    if (checked++ > 140) break;
    if (!c.passable(n.x, n.y + 1, n.z)) continue;
    const f = norm({ x: pos.x - eye.x, y: 0, z: pos.z - eye.z });        // player -> hiding cell
    const cx = Math.floor(pos.x - f.x), cz = Math.floor(pos.z - f.z);     // the cover, one step toward the player
    if (c.passable(cx, n.y, cz) || c.passable(cx, n.y + 1, cz)) continue;
    const trunk = isTrunk(c.id(cx, n.y + 1, cz));
    if (trees && !trunk) continue;
    const head = { x: pos.x, y: n.y + 2.4, z: pos.z };
    if (lineOfSight(dim, eye, head) || lineOfSight(dim, eye, { x: pos.x, y: n.y + 1.2, z: pos.z })) continue;   // fully hidden
    const r = { x: f.z, z: -f.x };                                        // the creature's right (it faces the player)
    const sides = [];
    for (const sg of [1, -1]) {
      const pt = { x: pos.x + r.x * 0.95 * sg, y: n.y + 2.3, z: pos.z + r.z * 0.95 * sg };
      if (!c.passable(Math.floor(pt.x), n.y + 1, Math.floor(pt.z))) continue;
      if (lineOfSight(dim, eye, pt)) sides.push({ name: sg > 0 ? 'right' : 'left', step: { x: Math.floor(pos.x + r.x * sg), y: n.y, z: Math.floor(pos.z + r.z * sg) } });
    }
    if (!sides.length) continue;
    return { kind: 'peek', pos, sides, trunk };
  }
  return null;
}

function planShow(ctx) {
  const ug = ctx.ps.underground;
  /** @type {{name:string, fn:(ctx:any)=>any, w:number}[]} */
  const pool = ug
    ? [{ name: 'still', fn: planStill, w: 2.2 }, { name: 'ledge', fn: planLedge, w: 1.6 }, { name: 'ceiling', fn: planCeiling, w: 1.6 }, { name: 'behind', fn: planBehind, w: 1.3 }, { name: 'peek', fn: planPeek, w: 1.6 }]
    : [{ name: 'peek', fn: planPeek, w: 4.0 }, { name: 'still', fn: planStill, w: 2.0 }, { name: 'behind', fn: planBehind, w: 1.4 }, { name: 'ledge', fn: planLedge, w: 1.0 }];
  while (pool.length) {                                                  // weighted order, falling back through the rest
    const tot = pool.reduce((a, o) => a + o.w, 0);
    let r = Math.random() * tot;
    let i = 0;
    for (; i < pool.length - 1; i++) { r -= pool[i].w; if (r <= 0) break; }
    const o = pool.splice(i, 1)[0];
    const pl = safe(`show:${o.name}`, () => o.fn(ctx), null);
    if (pl) return pl;
  }
  return null;
}

// ------------------------------------------------------------------ small moves
/** quietly a little closer while nobody looks: a cell nearer the player, visible from them but outside their view cone */
function creepCloser(ctx, cr, stepMin = 2, stepMax = 4.5, minD = 3.4) {
  const p = ctx.player;
  const dim = p.dimension;
  const eye = p.getHeadLocation();
  const view = p.getViewDirection();
  const from = cr.loc;
  const d0 = lenXZ(sub(from, p.location));
  if (d0 <= minD + 0.5 || !ctx.map) return false;
  if (inAnyonesView(dim, from)) return false;                          // only when nobody has it anywhere in view
  const ceiling = cr.act === ACT.CEILING_HANG;
  const c = ctx.map.cache;
  let best = null; let bestScore = 1e9;
  for (const n of ctx.map.list()) {
    if (n.crawl) continue;
    const q = center(n);
    const d = lenXZ(sub(q, p.location));
    if (d < Math.max(minD, d0 - stepMax) || d > d0 - stepMin) continue;
    if (lenXZ(sub(q, from)) > stepMax + 2) continue;
    let anchor = q;
    if (ceiling) {
      const h = c.headroom(n.x, n.y, n.z);
      if (h < 4 || h > 7) continue;
      anchor = { x: q.x, y: n.y + h - 2.0, z: q.z };
    }
    const head = { x: q.x, y: (ceiling ? anchor.y + 0.8 : q.y + 2.3), z: q.z };
    if (angleTo(view, eye, head) < 55) continue;                         // never moves inside your view
    if (!lineOfSight(dim, eye, head)) continue;                           // you will see it when you look back
    // stay close to the line it was already on
    const lat = Math.abs((q.x - from.x) * (p.location.z - from.z) - (q.z - from.z) * (p.location.x - from.x)) / Math.max(1, d0);
    const score = lat + Math.abs(d - (d0 - 3));
    if (score < bestScore) { bestScore = score; best = anchor; }
  }
  if (!best || inAnyonesView(dim, best)) return false;
  safe('creep', () => cr.e.teleport(best, { keepVelocity: false, facingLocation: p.getHeadLocation() }));
  playAt(dim, 'shaftbreaker.step_soft', best, 0.35, rand(0.85, 1.0));
  ctx.tel.notes.push(`crept to ${lenXZ(sub(best, p.location)).toFixed(1)}`);
  return true;
}

/** the lunge: a short coil, then a burst straight at you (through open cells only); strikes if it reaches */
function* lunge(ctx, cr) {
  const pl = ctx.player;
  ctx.tel.notes.push('lunge');
  yield* dropDown(ctx, cr);
  cr.halt();
  cr.setGravity(true); cr.lockStance = false;
  cr.face(pl.getHeadLocation());
  cr.setPhase('breaker');
  cr.setEyes(1.0);
  cr.setAct(ACT.LUNGE);
  playAt(cr.dim, 'shaftbreaker.growl', cr.loc, 1.0, rand(1.1, 1.25));
  setDanger(pl, 0.9);
  yield W(4);                                                           // the coil: a fifth of a second
  const c = new BlockCache(cr.dim);
  for (let i = 0; i < 14 && cr.valid; i++) {
    const l = cr.loc;
    const to = sub(pl.location, l);
    const dxz = lenXZ(to);
    if (dxz < 1.6) break;
    const step = Math.min(0.62, dxz - 1.4);
    const nx = l.x + to.x / dxz * step, nz = l.z + to.z / dxz * step;
    const fx = Math.floor(nx), fz = Math.floor(nz), fy = Math.floor(l.y + 0.05);
    let ny = l.y;
    if (!c.passable(fx, fy, fz) || !c.passable(fx, fy + 1, fz)) {
      if (!c.passable(fx, fy, fz) && c.passable(fx, fy + 1, fz) && c.passable(fx, fy + 2, fz)) ny = fy + 1;   // bounds up a block
      else break;
    }
    safe('lungeStep', () => cr.e.teleport({ x: nx, y: ny, z: nz }, { keepVelocity: false, facingLocation: pl.getHeadLocation() }));
    yield 1;
  }
  let hit = false;
  if (cr.valid && dist(cr.loc, pl.location) < 3.0) {
    hit = cr.strike(pl, 8 * diffMul(), canHurt(ctx));
    if (hit) { ctx.hits = (ctx.hits || 0) + 1; ctx.tel.notes.push('lunge hit'); }
  }
  yield W(sec(0.35));
  return hit;
}

/** you walked right up to it */
function* closeStrike(ctx, cr) {
  const pl = ctx.player;
  ctx.tel.notes.push('close strike');
  yield* dropDown(ctx, cr);
  cr.halt(); cr.setGravity(true); cr.lockStance = false;
  cr.face(pl.getHeadLocation());
  cr.setPhase('breaker');
  cr.setAct(chance(0.5) ? ACT.CLAW_RIGHT : ACT.CLAW_LEFT);
  playAt(cr.dim, 'shaftbreaker.swing', cr.loc, 1.0, 1.0);
  yield W(sec(0.35));
  if (cr.valid && cr.inFront(pl, 3.2, 90) && cr.strike(pl, 8 * diffMul(), canHurt(ctx))) { ctx.hits = (ctx.hits || 0) + 1; ctx.tel.notes.push('struck at close range'); }
  yield W(sec(0.45));
}

/** hanging from the ceiling: drop down properly before anything else */
function* dropDown(ctx, cr) {
  if (!cr.valid) return;
  if (cr.act === ACT.CEILING_HANG || cr.act === ACT.CEILING_REACH || !cr.grav) {
    cr.halt();
    cr.setAct(ACT.CEILING_DROP);
    cr.setGravity(true);
    cr.lockStance = false;
    playAt(cr.dim, 'shaftbreaker.debris_fall', cr.loc, 0.7, 1.0);
    yield W(sec(0.6));
  }
}

function* rage(ctx, why, lunged = false) {
  yield* dropDown(ctx, creature());
  addTension(ctx.ps, -40);
  ctx.raged = true;
  return yield* huntSequence(ctx, { reuse: true, rage: true, why, lunged });
}

function* vanishHere(ctx, cr, note = 'vanished in place') {
  ctx.tel.notes.push(note);
  yield* passiveExit(ctx, cr);
}

/** flees: scrambles off out of sight, then is gone */
function* flee(ctx, cr) {
  ctx.tel.notes.push('fled');
  yield* dropDown(ctx, cr);
  const r = hiddenRetreat(ctx, cr, 5, 20);
  if (!r) { yield* vanishHere(ctx, cr); return; }
  cr.setGravity(true); cr.lockStance = false; cr.clearAct();
  cr.setPhase('frenzy');
  cr.setAct(ACT.SCRAMBLE, true);
  playAt(cr.dim, 'shaftbreaker.scrape', cr.loc, 1.0, 1.3);
  cr.moveTo(r.pos, SPEED.rage);
  const until = now() + sec(4);
  while (now() < until && cr.valid && cr.moving) { yield W(3); if (!seen(ctx, cr).visible && dist(cr.loc, ctx.player.location) > 10) break; }
  cr.clearAct();
  cr.vanish(!seen(ctx, cr).visible);
}

// ------------------------------------------------------------------ waiting to be noticed
function* waitNoticed(ctx, cr, plan) {
  const pl = ctx.player;
  let lookT = 0;
  let nextCreep = now() + sec(rand(9, 14));
  let creeps = 0;
  const until = now() + sec(rand(45, 70));
  while (now() < until) {
    yield W(4);
    if (!cr.valid) return 'gone';
    if (ctx.provoked) return 'hurt';
    const s = seen(ctx, cr);
    if (s.dist < 3.0) return 'touched';
    if (s.visible && s.angle < 26) { lookT += 4; if (lookT >= 6) return 'spotted'; }
    else {
      lookT = Math.max(0, lookT - 2);
      // unnoticed for a while: a little closer (never while anyone is looking at it)
      if (now() >= nextCreep && creeps < 3 && !s.visible && plan.kind !== 'behind') {
        nextCreep = now() + sec(rand(8, 13));
        if (creepCloser(ctx, cr, 2.5, 6, 7)) creeps++;
      }
    }
    if (!s.visible && now() % 40 < 4) cr.face(pl.getHeadLocation());     // perfectly still while watched; turned to you when not
  }
  return 'timeout';
}

/** hide-and-peek behind a trunk or pillar */
function* peekGame(ctx, cr, plan) {
  const pl = ctx.player;
  let side = pick(plan.sides);
  let peeking = true;
  let ducks = 0; let lookT = 0; let awayT = 0;
  const want = randi(2, 4);
  const peekAct = (sd) => (sd.name === 'left' ? ACT.PEEK_LEFT : ACT.PEEK_RIGHT);
  cr.setAct(peekAct(side), true);
  const until = now() + sec(rand(45, 70));
  let awayNeed = sec(rand(0.8, 1.6));
  while (now() < until) {
    yield W(3);
    if (!cr.valid) return { r: 'gone' };
    if (ctx.provoked) return { r: 'hurt' };
    const eye = pl.getHeadLocation();
    const at = { x: cr.loc.x, y: cr.loc.y + 2.2, z: cr.loc.z };
    const ang = angleTo(pl.getViewDirection(), eye, at);
    const d = dist(pl.location, cr.loc);
    if (d < 3.0) return { r: 'touched' };
    if (d < 7.5) return { r: 'charged', side };
    const looking = ang < 18;
    if (peeking) {
      if (looking) {
        lookT += 3;
        if (lookT >= 6) {                                                // looked at: it ducks back behind the trunk
          peeking = false; ducks++; lookT = 0; awayNeed = sec(rand(0.8, 1.8));
          cr.clearAct();
          sighted(ctx);
          setDanger(pl, 0.45);
          playAt(cr.dim, 'shaftbreaker.scrape', cr.loc, 0.3, 1.25);
          if (ducks >= want) return { r: 'spotted', side };
        }
      } else lookT = Math.max(0, lookT - 1);
    } else if (ang > 32) {
      awayT += 3;
      if (awayT >= awayNeed) {                                            // looked away: out again, from the other side
        awayT = 0; peeking = true;
        if (plan.sides.length > 1) side = plan.sides.find((q) => q.name !== side.name) || side;
        cr.setAct(peekAct(side), true);
        if (chance(0.3)) playAt(cr.dim, 'shaftbreaker.click', cr.loc, 0.4, 1.1);
      }
    } else awayT = 0;
    if (!looking && now() % 40 < 3) cr.face(eye);
  }
  return { r: ducks ? 'spotted' : 'timeout', side };
}

// ------------------------------------------------------------------ the standoff
const TESTS = ['crack', 'tilt', 'step'];

function* testYou(ctx, cr, last) {
  const pl = ctx.player;
  const d = dist(cr.loc, pl.location);
  let t = pick(TESTS.filter((x) => x !== last));
  if (t === 'step' && d < 4.5) t = 'tilt';
  ctx.tel.notes.push(`test:${t}`);
  if (t === 'crack') {
    cr.setAct(ACT.TWITCH);
    playAt(cr.dim, 'shaftbreaker.neck_crack', { x: cr.loc.x, y: cr.loc.y + 2.4, z: cr.loc.z }, 0.9, rand(0.9, 1.1));
  } else if (t === 'tilt') {
    cr.setAct(ACT.HEAD_TILT);
    if (chance(0.5)) playAt(cr.dim, 'shaftbreaker.click', cr.loc, 0.6, 0.9);
  } else {                                                              // one slow step while you watch
    const f = norm(sub(pl.location, cr.loc));
    const cell = floor3({ x: cr.loc.x + f.x, y: cr.loc.y + 0.1, z: cr.loc.z + f.z });
    const c = new BlockCache(cr.dim);
    if (c.standable(cell.x, cell.y, cell.z)) {
      cr.setAct(ACT.FINISH_STEP);
      cr.stepAlong([cell], pl.getHeadLocation(), 0.045);
      playAt(cr.dim, 'shaftbreaker.step', cr.loc, 0.8, 0.8);
    } else cr.setAct(ACT.HEAD_TILT);
  }
  return t;
}

function* standoff(ctx, cr) {
  const pl = ctx.player;
  const s = ctx.ps;
  cr.stop();
  cr.setMode('scripted');
  if (cr.act !== ACT.CEILING_HANG) cr.clearAct();
  cr.face(pl.getHeadLocation());
  cr.setPhase('watching');
  cr.setEyes(0.95);
  if (currentMusic(pl) !== 'music.shaftbreaker.chase') startMusic(pl, 'music.shaftbreaker.standoff');
  ctx.standoffMusic = true;
  const T = tension(s);
  const stareLimit = sec(clamp(rand(6, 10) * (1 - T / 300) / intensityMul(), 3, 11));
  let stare = 0; let away = 0; let crept = false; let lastTest = '';
  let nextTest = now() + sec(rand(1.0, 2.2));
  const hist = [];
  const until = now() + sec(rand(30, 48));
  ctx.creeps = 0;
  while (now() < until) {
    yield W(4);
    if (!cr.valid) return 'gone';
    if (ctx.provoked) return 'hurt';
    const sv = seen(ctx, cr);
    const d = dist(cr.loc, pl.location);
    hist.push({ t: now(), d }); while (hist.length && now() - hist[0].t > sec(1.6)) hist.shift();
    if (d < 2.9) return 'touched';
    const looking = sv.visible && sv.angle < 30;
    if (looking && hist.length > 3 && hist[0].d - d > 2.8 && d < 13) return 'charged';
    if (looking) {
      stare += 4; away = 0; crept = false;
      setDanger(pl, clamp(0.45 + (12 - d) / 24, 0.45, 0.8));
      if (stare >= stareLimit) return 'stared';
      if (now() >= nextTest && !cr.act && !cr.moving) {                // (hanging from the ceiling it only stares)
        lastTest = yield* testYou(ctx, cr, lastTest);
        nextTest = now() + sec(rand(2.4, 4.2));
      }
      if (ctx.creeps >= 2 && d < 5.5) return 'close';                    // it got this close: it lunges when you look
    } else {
      away += 4; stare = Math.max(0, stare - 3);
      if (!crept && away >= 10) {                                         // every time you look away it is a little closer
        crept = true;
        if (creepCloser(ctx, cr)) { ctx.creeps++; addTension(s, 4); }
      }
      if (away > sec(15)) return 'ignored';
    }
  }
  return 'timeout';
}

/** decide what being spotted means this time */
function reaction(ctx) {
  const s = ctx.ps;
  const T = tension(s);
  const due = huntDue(s);
  const w = {
    vanish: 0.1,
    flee: 0.06,
    lunge: 0.09 + T / 700 + (due ? 0.06 : 0),
    rage: (due ? 0.24 : 0.03 + T / 700) * intensityMul(),
    standoff: 0,
  };
  w.standoff = Math.max(0.3, 1 - w.vanish - w.flee - w.lunge - w.rage);
  let r = Math.random() * Object.values(w).reduce((a, b) => a + b, 0);
  for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; }
  return 'standoff';
}

/** after a lunge or close strike: keep coming, or gone */
function* afterStrike(ctx, cr, pRage) {
  if (!cr.valid) return 'gone';
  if (chance(huntDue(ctx.ps) ? Math.max(pRage, 0.6) : pRage * 0.6)) return yield* rage(ctx, 'pressed the attack', true);
  yield* vanishHere(ctx, cr);
  return 'struck_and_vanished';
}

/** run at it: attack, or vanish and wait for a worse moment */
function* chargedAt(ctx, cr) {
  const s = ctx.ps;
  const T = tension(s);
  const pAttack = clamp(0.5 + T / 200 + (huntDue(s) ? 0.2 : 0), 0.3, 0.9);
  ctx.tel.notes.push('ran at it');
  if (chance(pAttack)) {
    const hit = yield* lunge(ctx, cr);
    return yield* rage(ctx, hit ? 'charged and hit' : 'charged', true);
  }
  s.ambush = { at: now() + sec(rand(45, 120) * freqMul()), why: 'charged' };
  ctx.tel.notes.push('ambush armed');
  yield* vanishHere(ctx, cr, 'vanished to ambush later');
  return 'ambush_armed';
}

// ------------------------------------------------------------------ templates
const BASE = {
  family: 'stalk', needsCreature: true, phases: ['dormant', 'watching', 'breaker', 'frenzy'], minState: 'dormant', cooldownMin: 0,
  weight: () => 0,                                                    // started by the director's stalker clock
};

export const STALK_TEMPLATES = [
  {
    ...BASE,
    id: 'stalk_show', features: ['L01', 'L02', 'L03', 'L05', 'L07', 'L08', 'L09', 'L11', 'L17', 'L18', 'L19', 'L20', 'L21', 'N01', 'N04', 'N08'],
    trigger: 'the stalker clock (about once a minute or two while it is with you)',
    telegraph: 'it is simply there, still; standoff music; a scream before any chase, a coil before any lunge',
    counterplay: 'do not stare it down, do not run at it, keep your distance, get to daylight',
    plan(ctx) { return planShow(ctx); },
    *run(ctx, plan) {
      const pl = ctx.player;
      const s = ctx.ps;
      plan = { ...plan };
      // ---- arrive: silently, somewhere you will notice it, perfectly still
      const pos = plan.kind === 'ceiling' ? plan.anchor : plan.pos;
      const cr = appear(ctx, { pos }, { phase: 'dormant', eyes: plan.kind === 'peek' ? 0.85 : 0.75, act: plan.kind === 'ceiling' ? ACT.CEILING_HANG : 0 });
      if (!cr) return 'no_spawn';
      cr.halt();
      cr.face(pl.getHeadLocation());
      if (plan.kind === 'ceiling') {
        // the anchor may have come into view at the last moment (arrival re-planned elsewhere): then it stands instead
        if (dist(cr.loc, plan.anchor) < 0.8) { cr.lockStance = true; cr.setGravity(false); cr.setAct(ACT.CEILING_HANG, true); }
        else { cr.clearAct(); plan = { ...plan, kind: 'still' }; }
      }
      ctx.tel.notes.push(`show:${plan.kind}${plan.trunk ? ' (tree)' : ''}`);
      log('basic', `show ${plan.kind} for ${pl.name} at ${Math.round(dist(pos, pl.location))} blocks`);
      // ---- wait to be noticed
      let r;
      if (plan.kind === 'peek') {
        const pr = yield* peekGame(ctx, cr, plan);
        r = pr.r;
        if (r === 'spotted' && pr.side && cr.valid) {                     // it stops hiding and steps out
          cr.clearAct();
          const c = new BlockCache(cr.dim);
          if (c.standable(pr.side.step.x, pr.side.step.y, pr.side.step.z)) { cr.stepAlong([pr.side.step], pl.getHeadLocation(), 0.05); yield W(sec(1.0)); }
        }
      } else r = yield* waitNoticed(ctx, cr, plan);
      if (r === 'gone') return 'gone';
      if (r === 'timeout') {
        if (!seen(ctx, cr).visible) { cr.vanish(true); return 'unnoticed'; }
        r = 'spotted';
      }
      sighted(ctx);
      addTension(s, 12);
      if (r === 'hurt') return yield* rage(ctx, 'struck before the standoff');
      if (r === 'touched') { yield* closeStrike(ctx, cr); return yield* afterStrike(ctx, cr, 0.6); }
      if (r === 'charged') return yield* chargedAt(ctx, cr);
      // ---- spotted: what will it be this time?
      const what = reaction(ctx);
      ctx.tel.notes.push(`reaction:${what}`);
      if (what === 'vanish') { yield W(sec(rand(0.6, 1.6))); yield* vanishHere(ctx, cr); return 'vanished'; }
      if (what === 'flee') { yield W(sec(rand(0.3, 0.9))); yield* flee(ctx, cr); return 'fled'; }
      if (what === 'lunge') { const hit = yield* lunge(ctx, cr); return yield* afterStrike(ctx, cr, hit ? 0.55 : 0.35); }
      if (what === 'rage') return yield* rage(ctx, 'spotted');
      // ---- the standoff
      const o = yield* standoff(ctx, cr);
      ctx.tel.notes.push(`standoff:${o}`);
      if (ctx.standoffMusic && currentMusic(pl) === 'music.shaftbreaker.standoff') stopMusic(pl);
      if (o === 'gone') return o;
      if (o === 'hurt') return yield* rage(ctx, 'struck');
      if (o === 'stared') { caption(pl, 'You held its gaze too long'); return yield* rage(ctx, 'stared down'); }
      if (o === 'touched') { yield* closeStrike(ctx, cr); return yield* afterStrike(ctx, cr, 0.6); }
      if (o === 'charged') return yield* chargedAt(ctx, cr);
      if (o === 'close') {                                                // it is right there when you look back
        const hit = yield* lunge(ctx, cr);
        return yield* afterStrike(ctx, cr, hit ? 0.6 : 0.4);
      }
      if (o === 'ignored') {
        if (huntDue(s) && dist(cr.loc, pl.location) < 16) { const hit = yield* lunge(ctx, cr); return yield* rage(ctx, 'turned your back', hit); }
        cr.vanish(!seen(ctx, cr).visible);
        return 'ignored';
      }
      yield* vanishHere(ctx, cr);
      return 'standoff_over';
    },
  },
  {
    ...BASE,
    family: 'hunt',
    id: 'stalk_ambush', features: ['L11', 'L54', 'N11', 'N12'],
    trigger: 'you ran at it and it chose to vanish; it comes back at a worse moment (hurt, dark, alone)',
    telegraph: 'breathing right behind you, then a coil before the lunge',
    counterplay: 'keep your back to a wall, stay lit, stay together',
    plan(ctx) {
      const s = findSpot(ctx.map, ctx.player, { minDist: 4.5, maxDist: 9, los: true, minAngle: 125, crawl: false, maxChecks: 90, test: notWatched(ctx) });
      return s && { pos: s.pos };
    },
    *run(ctx, plan) {
      const pl = ctx.player;
      const cr = appear(ctx, { pos: plan.pos }, { phase: 'breaker', eyes: 1.0 });
      if (!cr) return 'no_spawn';
      cr.halt(); cr.face(pl.getHeadLocation());
      playAt(cr.dim, 'shaftbreaker.breath', { x: cr.loc.x, y: cr.loc.y + 2.2, z: cr.loc.z }, 1.0, 0.9);
      caption(pl, 'Breathing, right behind you', cr.loc);
      const until = now() + sec(rand(1.2, 2.2));
      while (now() < until) { yield W(3); if (!cr.valid) return 'gone'; const s = seen(ctx, cr); if (s.visible && s.angle < 40) break; }
      sighted(ctx);
      const hit = yield* lunge(ctx, cr);
      return yield* rage(ctx, 'ambush', hit || true);
    },
  },
];

/** may this player be ambushed now? (a worse moment: hurt, in the dark, alone at night) */
export function ambushMoment(p, s) {
  if (!s.ambush) return false;
  let hp = 1;
  try { const h = p.getComponent('minecraft:health'); hp = h ? h.currentValue / h.effectiveMax : 1; } catch { /* ignore */ }
  if (hp <= 0.6 && now() >= s.ambush.at - sec(30)) return true;          // hurt: sooner
  return now() >= s.ambush.at;
}

export { isDamageable };
