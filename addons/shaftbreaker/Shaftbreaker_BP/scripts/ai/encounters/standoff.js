// @ts-check
import { ACT } from '../../generated/acts.js';
import { W, seen, sighted, appear, hold, passiveExit, hiddenRetreat, sfx, scratchNear, soundSpot, wantsHunt } from './common.js';
import { huntSequence } from './hunt.js';
import { now, sec, rand, randi, chance, pick, dist, sub, lenXZ, norm, safe, weighted, worldTicks, mins, valid, yawTo } from '../../core/util.js';
import { config, intensityMul } from '../../core/config.js';
import { findSpot, lineOfSight } from '../../world/space.js';
import { profile, markDirty, curious } from '../memory.js';
import { ws, wsDirty, nearestDen } from '../worldstate.js';
import { caption, setDanger, startMusic, stopMusic } from '../../audio.js';
import { spawnMoths } from '../../world/den.js';

const ST = { family: 'standoff', needsCreature: true };

/** history-aware weighted reaction pick (L23): recently used reactions are less likely */
function pickReaction(ctx, weights) {
  const pf = profile(ctx.player);
  pf.standoffHist = pf.standoffHist || [];
  const pairs = Object.entries(weights).map(([k, w]) => [k, w * (pf.standoffHist.includes(k) ? 0.35 : 1)]);
  const r = weighted(pairs) || 'retreat';
  pf.standoffHist.push(r); if (pf.standoffHist.length > 4) pf.standoffHist.shift();
  markDirty(ctx.player);
  return r;
}

function* standoffCore(ctx, cr, o = {}) {
  const pl = ctx.player;
  startMusic(pl, 'music.shaftbreaker.standoff');
  cr.setAct(ACT.STARE, true);
  const window = sec(rand(3, 10));                                   // standoff window 3-10 s
  let r = yield* hold(ctx, cr, { ticks: sec(rand(16, 26) * intensityMul()), approachDist: 5, stareLimit: window, returnOnSpot: false, faceEvery: 10 });
  ctx.tel.notes.push(`standoff:${r}`);
  for (let round = 0; round < 3 && cr.valid; round++) {
    if (r === 'touched' || r === 'approach') {                         // L17/L21 close-range confrontation
      if (wantsHunt(ctx, o.contactHunt ?? 0.4)) { stopMusic(pl); return yield* huntSequence(ctx, { reuse: true, short: true }); }
      break;
    }
    if (r !== 'contact') break;
    setDanger(pl, 0.6);
    const choice = pickReaction(ctx, {
      scream: 1.2, tilt: 1.2, advance: 0.9, retreat: 1.0, vanish: 0.7, false_retreat: 0.8,
      aggress: ctx.allowHunt === false ? 0 : (o.aggress ?? 0.35) * (ctx.ps.state === 'provoked' ? 2 : 1),
    });
    ctx.tel.notes.push(`L23 reaction=${choice}`);
    if (choice === 'scream') {                                         // N36 interrupted scream
      cr.setAct(ACT.SCREAM_CUT);
      sfx(ctx, 'shaftbreaker.roar_cut', cr.loc, 1.0, rand(0.95, 1.05));
      yield W(sec(1.9));
      cr.setAct(ACT.STARE, true);
    } else if (choice === 'tilt') {                                    // N06 unnatural adjustment
      cr.setAct(ACT.HEAD_TILT, true);
      sfx(ctx, 'shaftbreaker.click', cr.loc, 0.7, 1.0);
      yield W(sec(2.6));
    } else if (choice === 'advance') {
      const s = findSpot(ctx.map, pl, { minDist: Math.max(4.5, dist(cr.loc, pl.location) - 3), maxDist: dist(cr.loc, pl.location) - 0.8, los: true, inViewOk: true, crawl: false, maxChecks: 30 });
      if (s) { cr.clearAct(); cr.setPhase('stalking'); cr.moveTo(s.pos, false); yield W(sec(2)); cr.halt(); cr.setPhase('watching'); cr.face(pl.getHeadLocation()); cr.setAct(ACT.STARE, true); }
    } else if (choice === 'retreat') {
      stopMusic(pl);
      yield* passiveExit(ctx, cr, 'backward');                         // N02
      return 'retreated';
    } else if (choice === 'false_retreat') {                           // N12: withdraw for real, then come back another way
      stopMusic(pl);
      const away = hiddenRetreat(ctx, cr, 5, 16);
      if (!away) { yield* passiveExit(ctx, cr, 'backward'); return 'retreated'; }
      cr.clearAct(); cr.setPhase('stalking'); cr.moveTo(away.pos, false);
      const t1 = now() + sec(7);
      while (now() < t1 && cr.valid && !cr.arrived(1.4)) yield W(5);
      yield W(sec(rand(4, 7)));                                         // footsteps go silent unusually early
      yield* ctx.refreshMap();
      const before = sub(away.pos, pl.location);
      const back = findSpot(ctx.map, pl, { minDist: 7, maxDist: 15, los: true, inViewOk: false, crawl: false, maxChecks: 60,
        test: (n, c) => { const now2 = sub(c, pl.location); return (before.x * now2.x + before.z * now2.z) / ((lenXZ(before) * lenXZ(now2)) || 1) < -0.1; } });
      if (!back || !cr.valid) { if (cr.valid) cr.vanish(!seen(ctx, cr).visible); return 'false_retreat_aborted'; }
      ctx.tel.notes.push('N12 false retreat: returned from another side');
      cr.moveTo(back.pos, false);
      const t2 = now() + sec(12);
      while (now() < t2 && cr.valid && !cr.arrived(1.4)) yield W(5);
      if (!cr.valid) return 'lost';
      cr.halt(); cr.setPhase('watching'); cr.face(pl.getHeadLocation()); cr.setAct(ACT.STARE, true);
      yield* hold(ctx, cr, { ticks: sec(rand(6, 10)), approachDist: 6, returnOnSpot: false });
      yield* passiveExit(ctx, cr, 'backward');
      return 'false_retreat';
    } else if (choice === 'vanish') {                                  // L24 quiet ending after a distinctive head move
      cr.setAct(ACT.HEAD_TILT, true);
      const r2 = yield* hold(ctx, cr, { ticks: sec(8), returnOnSpot: false, custom: (s) => (!s.visible || s.angle > 65 ? 'away' : null) });
      stopMusic(pl);
      if (r2 === 'away') { cr.vanish(true); return 'vanished'; }
      yield* passiveExit(ctx, cr, 'glance');
      return 'vanished_late';
    } else if (choice === 'aggress') {                                 // L25 readable escalation
      stopMusic(pl);
      return yield* huntSequence(ctx, { reuse: true });
    }
    ctx.contact = 0;
    r = yield* hold(ctx, cr, { ticks: sec(rand(6, 12)), approachDist: 5, stareLimit: sec(rand(3, 7)), returnOnSpot: false, faceEvery: 10 });
  }
  stopMusic(pl);
  if (r === 'timeout' && chance(0.5)) {                               // L20: when you look away
    const away = yield* hold(ctx, cr, { ticks: sec(6), returnOnSpot: false, custom: (s) => (s.angle > 70 ? 'away' : null) });
    if (away === 'away') { cr.vanish(true); return 'gone_when_looked_away'; }
  }
  yield* passiveExit(ctx, cr, chance(0.5) ? 'backward' : 'glance');
  return r;
}

export const STANDOFF_TEMPLATES = [
  {
    ...ST, id: 'standoff', features: ['L17', 'L18', 'L19', 'L20', 'L21', 'L22', 'L23', 'L24', 'L25', 'L64', 'N02', 'N06', 'N12', 'N20', 'N36'], phases: ['watching'], minState: 'observing', minSightings: 1, cooldownMin: 10,
    trigger: 'sustained eye contact at a confrontation distance', telegraph: 'it freezes, faces you and the drone rises', counterplay: 'stillness or retreat usually ends it; approaching provokes it',
    weight: () => 1.2,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 8, maxDist: 15, los: true, maxAngle: 110, maxLight: 8, crawl: false, minHeadroom: 3 }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', eyes: 1.0 });
      if (!cr) return 'no_spawn';
      cr.halt();
      return yield* standoffCore(ctx, cr);
    },
  },
  {
    ...ST, id: 'false_injury', features: ['N05'], phases: ['watching', 'breaker'], minState: 'observing', minSightings: 2, cooldownMin: 18,
    trigger: 'it was hurt in a recent encounter', telegraph: 'uneven gait and a throat rattle', counterplay: 'keep spacing: the fake injury never grants an instant hit',
    weight: (ctx) => (worldTicks() - (profile(ctx.player).lastHurtCreature || -1e9) < mins(40) ? 1.4 : 0),
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 10, maxDist: 18, los: true, maxLight: 8, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', eyes: 0.7 });
      if (!cr) return 'no_spawn';
      sfx(ctx, 'shaftbreaker.growl', cr.loc, 0.7, 0.8);
      const ret = hiddenRetreat(ctx, cr, 6, 20);
      cr.setAct(ACT.LIMP, true);
      if (ret) cr.moveTo(ret.pos, false);
      const r = yield* hold(ctx, cr, { ticks: sec(16), approachDist: 5, returnOnSpot: false, custom: () => (ret && cr.arrived(1.4) ? 'arrived' : null) });
      if (r === 'approach' || r === 'touched') {
        cr.clearAct(); cr.halt(); cr.face(ctx.player.location);
        if (chance(0.5)) {                                             // deceptive escape
          ctx.tel.notes.push('N05 deceptive escape');
          sfx(ctx, 'shaftbreaker.roar_cut', cr.loc, 0.9, 1.1);
          cr.setAct(ACT.SCRAMBLE, true);
          const away = hiddenRetreat(ctx, cr, 8, 22);
          if (away) cr.moveTo(away.pos, true);
          yield W(sec(4));
          cr.vanish(!seen(ctx, cr).visible);
          return 'escaped_fake';
        }
        ctx.tel.notes.push('N05 brief counter (telegraphed)');
        cr.setAct(ACT.SHOVE);
        yield W(sec(0.75));
        if (cr.inFront(ctx.player, 3.0, 70)) { cr.strike(ctx.player, 4, () => now() >= ctx.ps.graceUntil); safe('kb', () => ctx.player.applyKnockback({ x: norm(sub(ctx.player.location, cr.loc)).x * 1.2, z: norm(sub(ctx.player.location, cr.loc)).z * 1.2 }, 0.35)); }
        yield W(sec(0.9));
      }
      cr.clearAct();
      yield* passiveExit(ctx, cr, 'walk');
      return r;
    },
  },
  {
    ...ST, id: 'false_vulnerability', features: ['N16'], phases: ['breaker'], minState: 'observing', minSightings: 2, cooldownMin: 18,
    trigger: 'you have attacked it repeatedly', telegraph: 'low kneel, braced arm, a long pause', counterplay: 'do not rush into reach: the shove has a wind-up',
    weight: (ctx) => ((profile(ctx.player).hitsOnCreature || 0) >= 6 ? 1.3 : 0),
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 7, maxDist: 13, los: true, maxLight: 8, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'breaker', act: ACT.KNEEL, eyes: 0.5 });
      if (!cr) return 'no_spawn';
      cr.halt(); cr.setAct(ACT.KNEEL, true);
      const r = yield* hold(ctx, cr, { ticks: sec(rand(14, 22)), approachDist: 4, returnOnSpot: false });
      if (r === 'approach' || r === 'touched') {
        cr.setEyes(1.0); cr.face(ctx.player.location);
        cr.setAct(ACT.SHOVE);
        yield W(sec(0.75));
        if (cr.inFront(ctx.player, 3.0, 70)) {
          cr.strike(ctx.player, 4, () => now() >= ctx.ps.graceUntil);
          safe('kb', () => { const d = norm(sub(ctx.player.location, cr.loc)); ctx.player.applyKnockback({ x: d.x * 1.4, z: d.z * 1.4 }, 0.4); });
        }
        yield W(sec(0.9));
      }
      cr.clearAct();
      yield* passiveExit(ctx, cr, 'backward');
      return r;
    },
  },
  {
    ...ST, id: 'den_retaliation', features: ['L74', 'L73'], phases: ['watching', 'breaker'], minState: 'dormant', cooldownMin: 30,
    trigger: 'you cleansed its den', telegraph: 'moths flee, a call from the den, then a long readable standoff', counterplay: 'prepare during the warning window; leaving the area also works',
    weight: (ctx) => (ctx.ps.retaliationArmed && now() >= ctx.ps.retaliationArmed ? 6 : 0),
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 12, maxDist: 20, los: true, maxLight: 9, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      ctx.ps.retaliationArmed = 0;
      const pl = ctx.player;
      spawnMoths(pl.dimension, pl.location, 3, null);
      sfx(ctx, 'shaftbreaker.call', soundSpot(ctx, 24, 40), 1.0, 0.8);
      caption(pl, 'Something is coming back for its den');
      yield W(sec(rand(8, 14)));                                       // preparation window
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', eyes: 1.0 });
      if (!cr) return 'no_spawn';
      cr.halt();
      return yield* standoffCore(ctx, cr, { aggress: 1.2, contactHunt: 0.7 });
    },
  },
  // ------------------------------------------------------------------ rare cinematics
  {
    family: 'rare', needsCreature: true, id: 'last_encounter', features: ['N50'], phases: ['watching'], minState: 'dormant', minFamiliarity: 55, cooldownMin: 120,
    trigger: 'long progression, rare roll, no current danger', telegraph: 'a full-length, slow, silent sequence', counterplay: 'none needed: no attack, no grief, no music',
    weight: (ctx) => (profile(ctx.player).encounters >= 12 && !(profile(ctx.player).rareSeen || []).includes('last_encounter') ? 1 : 0),
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 14, maxDist: 22, los: true, maxLight: 6, crawl: false, minHeadroom: 3 }); return s ? { s } : null; },
    *run(ctx, plan) {
      const pf = profile(ctx.player);
      pf.rareSeen = [...(pf.rareSeen || []), 'last_encounter']; markDirty(ctx.player);
      ctx.allowHunt = false;
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'dormant', eyes: 0.5 });
      if (!cr) return 'no_spawn';
      cr.halt();
      cr.setAct(ACT.STARE, true);
      let r = yield* hold(ctx, cr, { ticks: sec(40), approachDist: 7 });
      if (r === 'spotted') r = yield* hold(ctx, cr, { ticks: sec(rand(6, 9)), approachDist: 7, returnOnSpot: false });
      const ret = hiddenRetreat(ctx, cr, 5, 18);
      if (ret) {
        cr.setAct(ACT.BACKWARD, true);
        cr.stepAlong(ret.path.slice(0, Math.max(2, Math.floor(ret.path.length * 0.6))), ctx.player.getHeadLocation(), 0.04);
        yield W(sec(5));
      }
      cr.setAct(ACT.LAST_GLANCE, true);
      yield W(sec(3));
      cr.vanish(!seen(ctx, cr).visible);
      ws().lastRare = worldTicks(); wsDirty();
      return r;
    },
  },
  {
    family: 'rare', needsCreature: false, id: 'den_omen', features: ['L68', 'L75', 'L77', 'L78', 'L79', 'L80'], phases: ['dormant'], minState: 'interested', cooldownMin: 60,
    trigger: 'an active den within range', telegraph: 'moths circle, then drift; a call from that direction', counterplay: 'follow the moths to find (and cleanse) the den',
    weight: (ctx) => (nearestDen(ctx.player.location, 110) ? 1.2 : 0),
    plan(ctx) { const d = nearestDen(ctx.player.location, 110); return d ? { den: d.den } : null; },
    *run(ctx, plan) {
      const pl = ctx.player;
      spawnMoths(pl.dimension, pl.location, randi(2, 3), plan.den, pl);
      yield W(sec(4));
      const dir = norm(sub(plan.den, pl.location));
      const callAt = { x: pl.location.x + dir.x * 26, y: pl.location.y + 1, z: pl.location.z + dir.z * 26 };
      sfx(ctx, 'shaftbreaker.call', callAt, 0.8, 0.9);
      for (let i = 1; i <= 3; i++) scratchNear(pl.dimension, { x: pl.location.x + dir.x * (5 + i * 4), y: pl.location.y, z: pl.location.z + dir.z * (5 + i * 4) }, 12);
      ws().lastRare = worldTicks(); wsDirty();
      yield W(sec(5));
      return 'played';
    },
  },
];

export { lineOfSight, valid, yawTo, lenXZ, curious, config, pick, sighted, startMusic };
