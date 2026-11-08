// @ts-check
import { ACT } from '../../generated/acts.js';
import { W, seen, sighted, appear, hold, passiveExit, hiddenRetreat, sfx, scratchNear, soundSpot, wantsHunt } from './common.js';
import { huntSequence } from './hunt.js';
import { now, sec, rand, randi, chance, pick, dist, sub, lenXZ, center, floor3, norm, dot, yawTo, safe, angleTo } from '../../core/util.js';
import { config, intensityMul } from '../../core/config.js';
import { findSpot, coverSide, lightAt, isUnderground } from '../../world/space.js';
import { profile, curious, unlocked, trait, regionCenter, evidence } from '../memory.js';
import { caption, setDanger } from '../../audio.js';

const S = { family: 'stalk', needsCreature: true };
const U = { family: 'uncanny', needsCreature: true };
const holdT = (a, b) => sec(rand(a, b) * intensityMul());

/** generic "seen it, now what" reaction for observation encounters */
function* react(ctx, cr, r, o = {}) {
  if (r === 'gone') return 'gone';
  if (r === 'spotted' || r === 'contact') {
    cr.face(ctx.player.getHeadLocation());
    const r2 = yield* hold(ctx, cr, { ticks: holdT(2.5, 7), returnOnSpot: false, approachDist: o.approach ?? 9, stareLimit: sec(rand(6, 10)) });
    if (r2 === 'contact' && wantsHunt(ctx, o.huntChance ?? 0.08)) { ctx.tel.notes.push('L25 escalated from a stare'); return yield* huntSequence(ctx, {}); }
    if (r2 === 'touched' && wantsHunt(ctx, 0.35)) { ctx.tel.notes.push('L21 contact provoked it'); return yield* huntSequence(ctx, { short: true }); }
  }
  yield* passiveExit(ctx, cr, o.exit || (chance(0.35) ? 'glance' : 'auto'));
  return r;
}

export const OBSERVE_TEMPLATES = [
  {
    ...S, id: 'distant_watch', features: ['L01', 'L04', 'L12', 'L13', 'L14', 'N10', 'N14'], phases: ['dormant', 'watching'], minState: 'dormant', cooldownMin: 6,
    trigger: 'valid unseen vantage point with line of sight', telegraph: 'a still figure far down the tunnel', counterplay: 'keep your distance or walk toward it: it withdraws',
    weight: () => 1.4,
    plan(ctx) {
      const pf = profile(ctx.player);
      const shelter = pf.shelters.find((s) => s.n >= 2 && lenXZ(sub(regionCenter(s), ctx.player.location)) < 40);
      const q = { minDist: 16, maxDist: 40, los: true, minAngle: 35, maxAngle: 160, maxLight: 6, crawl: false, minHeadroom: 3 };
      const s = (shelter && findSpot(ctx.map, ctx.player, { ...q, test: (n, c) => dist(c, regionCenter(shelter)) < 12 })) || findSpot(ctx.map, ctx.player, q);
      return s ? { s, shelter: !!shelter, elevated: s.node.y - ctx.player.location.y >= 3 } : null;
    },
    *run(ctx, plan) {
      if (plan.elevated) ctx.tel.notes.push('L04 elevated lookout');
      if (plan.shelter) ctx.tel.notes.push('N14 near a learned shelter');
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'dormant', eyes: 0.8 });
      if (!cr) return 'no_spawn';
      const r = yield* hold(ctx, cr, { ticks: holdT(20, 34), approachDist: 12 });
      if (r === 'spotted') { cr.setAct(ACT.STARE, true); ctx.tel.notes.push('L12 long stare'); }
      if (r === 'approach') { ctx.tel.notes.push('L13 withdrew when approached'); yield* passiveExit(ctx, cr, 'backward'); return r; }
      if (r === 'timeout') { if (!seen(ctx, cr).visible) { cr.vanish(true); return 'unnoticed'; } }
      return yield* react(ctx, cr, r, { exit: chance(0.4) ? 'glance' : 'backward' });
    },
  },
  {
    ...S, id: 'peripheral', features: ['L03', 'N03'], phases: ['stalking'], minState: 'interested', cooldownMin: 7,
    trigger: 'visible cave edge at the side of your view, with a retreat lane', telegraph: 'a shape at the edge of vision for under two seconds', counterplay: 'turn quickly: it slips behind real cover',
    weight: () => 1.2,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 10, maxDist: 22, los: true, minAngle: 46, maxAngle: 72, maxLight: 6, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'stalking', eyes: 0.7 });
      if (!cr) return 'no_spawn';
      const r = yield* hold(ctx, cr, { ticks: holdT(6, 12), spotAngle: 24, spotTicks: 2, approachDist: 8 });
      if (r === 'spotted' || r === 'approach') {
        const ret = hiddenRetreat(ctx, cr, 3, 12);
        if (ret) { cr.setPhase('stalking'); cr.moveTo(ret.pos, true); yield W(sec(2.2)); }
        cr.vanish(!seen(ctx, cr).visible);
        return 'withdrew';
      }
      cr.vanish(!seen(ctx, cr).visible);
      return r;
    },
  },
  {
    ...S, id: 'corner_peek', features: ['L08'], phases: ['watching'], minState: 'interested', cooldownMin: 7,
    trigger: 'a corner with real cover between you and its body', telegraph: 'head and shoulder around the edge', counterplay: 'confront it and it pulls back',
    weight: () => 1.3,
    plan(ctx) {
      const s = findSpot(ctx.map, ctx.player, {
        minDist: 8, maxDist: 20, los: true, bodyHidden: true, maxLight: 7, crawl: false,
        test: (n, c, m) => { n.side = coverSide(m.cache, n, sub(ctx.player.location, c)); return !!n.side; },
      });
      return s ? { s, side: s.node.side } : null;
    },
    *run(ctx, plan) {
      const act = plan.side === 'right' ? ACT.PEEK_LEFT : ACT.PEEK_RIGHT;
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', act, eyes: 0.9 });
      if (!cr) return 'no_spawn';
      cr.setAct(act, true);
      const r = yield* hold(ctx, cr, { ticks: holdT(10, 22), approachDist: 8, stareLimit: sec(2.5) });
      cr.clearAct();
      yield W(sec(0.8));
      if (!seen(ctx, cr).visible) { cr.vanish(true); return 'pulled_back'; }
      return yield* react(ctx, cr, r === 'contact' ? 'spotted' : r, { exit: 'walk' });
    },
  },
  {
    ...S, id: 'failed_concealment', features: ['N09'], phases: ['stalking'], minState: 'interested', cooldownMin: 9,
    trigger: 'inadequate natural cover', telegraph: 'finger tips and one shoulder stick out', counterplay: 'spotting it may end the event',
    weight: () => 1.0,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 8, maxDist: 18, los: true, bodyHidden: true, maxLight: 7, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'stalking', act: ACT.FAILED_HIDE, eyes: 0.6 });
      if (!cr) return 'no_spawn';
      cr.setAct(ACT.FAILED_HIDE, true);
      const r = yield* hold(ctx, cr, { ticks: holdT(10, 20), approachDist: 7, spotTicks: 8 });
      cr.clearAct();
      return yield* react(ctx, cr, r, { exit: 'walk' });
    },
  },
  {
    ...S, id: 'ledge_below', features: ['L09'], phases: ['watching'], minState: 'interested', cooldownMin: 9,
    trigger: 'a lower ledge or shaft edge below you', telegraph: 'the head rises before the torso', counterplay: 'step back from the edge',
    weight: () => 1.0,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 5, maxDist: 18, dy: [-9, -3], los: true, maxLight: 7, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', act: ACT.PEEK_BELOW, eyes: 0.9 });
      if (!cr) return 'no_spawn';
      cr.setAct(ACT.PEEK_BELOW, true);
      const r = yield* hold(ctx, cr, { ticks: holdT(10, 20), approachDist: 6 });
      cr.clearAct();
      return yield* react(ctx, cr, r);
    },
  },
  {
    ...S, id: 'ceiling_watch', features: ['L05', 'L07', 'N25'], phases: ['watching', 'breaker'], minState: 'interested', minSightings: 1, cooldownMin: 12,
    trigger: 'a tall chamber with a solid ceiling anchor', telegraph: 'a hand lowers; dust falls before any drop', counterplay: 'look up and move out of the lane',
    weight: () => 0.9,
    plan(ctx) {
      const c = ctx.map.cache;
      const s = findSpot(ctx.map, ctx.player, {
        minDist: 7, maxDist: 20, minHeadroom: 4, maxLight: 5, crawl: false,
        test: (n) => { const h = c.headroom(n.x, n.y, n.z); if (h < 4 || h > 6) return false; n.ceil = n.y + h; return true; },
      });
      return s ? { s, anchor: { x: s.pos.x, y: s.node.ceil - 2.0, z: s.pos.z } } : null;
    },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.anchor }, { phase: 'watching', act: ACT.CEILING_HANG, eyes: 0.9 });
      if (!cr) return 'no_spawn';
      cr.lockStance = true;
      cr.setGravity(false); cr.halt(); cr.setAct(ACT.CEILING_HANG, true);
      safe('pin', () => cr.e.teleport(plan.anchor));
      const below = (s) => {
        const p = ctx.player.location;
        return lenXZ(sub(p, cr.loc)) < 2.6 && p.y < cr.loc.y ? 'beneath' : null;
      };
      const r = yield* hold(ctx, cr, { ticks: holdT(18, 30), custom: below, returnOnSpot: false, faceEvery: 20 });
      if (r === 'beneath') {
        cr.setAct(ACT.CEILING_REACH, true);
        safe('dust', () => cr.dim.spawnParticle('shaftbreaker:dust_fall', { x: cr.loc.x, y: cr.loc.y + 2.0, z: cr.loc.z }));
        sfx(ctx, 'shaftbreaker.debris_fall', cr.loc, 0.7, 1);
        caption(ctx.player, 'Dust falls from above', cr.loc);
        yield W(sec(2.0));
        // the anchor was built from a walk-map floor cell directly below, so the landing is known to be clear
        if (ctx.ps.state === 'provoked' && wantsHunt(ctx, 0.5)) {
          ctx.tel.notes.push('N25 suspended drop');
          cr.setAct(ACT.CEILING_DROP, true); cr.setGravity(true);
          yield W(sec(0.9));
          cr.lockStance = false; cr.clearAct();
          return yield* huntSequence(ctx, { reuse: true, short: true });
        }
        cr.setAct(ACT.CEILING_HANG, true);
        yield W(sec(1.5));
      }
      const s2 = seen(ctx, cr);
      if (s2.visible) { yield* hold(ctx, cr, { ticks: sec(8), custom: (s) => (!s.visible || s.angle > 70 ? 'looked_away' : null), returnOnSpot: false }); }
      ctx.tel.notes.push('L20 gone when you looked away');
      cr.vanish(!seen(ctx, cr).visible);
      return r;
    },
  },
  {
    ...S, id: 'wall_brace', features: ['L06'], phases: ['watching'], minState: 'interested', cooldownMin: 8,
    trigger: 'a wall rib beside a lookout', telegraph: 'one claw spread on the wall, leaning', counterplay: 'it withdraws when approached',
    weight: () => 0.9,
    plan(ctx) {
      const c = ctx.map.cache;
      const s = findSpot(ctx.map, ctx.player, { minDist: 10, maxDist: 24, los: true, maxLight: 6, crawl: false, minHeadroom: 3, test: (n) => !c.passable(n.x + 1, n.y + 1, n.z) || !c.passable(n.x - 1, n.y + 1, n.z) || !c.passable(n.x, n.y + 1, n.z + 1) || !c.passable(n.x, n.y + 1, n.z - 1) });
      return s ? { s } : null;
    },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', act: ACT.WALL_BRACE, eyes: 0.85 });
      if (!cr) return 'no_spawn';
      cr.setAct(ACT.WALL_BRACE, true);
      const r = yield* hold(ctx, cr, { ticks: holdT(12, 24), approachDist: 10 });
      cr.clearAct();
      return yield* react(ctx, cr, r);
    },
  },
  {
    ...S, id: 'stalk_follow', features: ['L02', 'L16', 'N24', 'N29', 'N03'], phases: ['stalking', 'watching'], minState: 'interested', cooldownMin: 10,
    trigger: 'you travel or mine; it keeps to cover behind you', telegraph: 'claw scrapes in alternating beats, a glimpse at a junction', counterplay: 'light and observation interrupt the approach',
    weight: () => 1.1,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 14, maxDist: 26, minPath: 14, los: false, maxLight: 6, minAngle: 90 }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'stalking', eyes: 0.7 });
      if (!cr) return 'no_spawn';
      const until = now() + holdT(35, 60);
      let hops = 0;
      while (now() < until && cr.valid) {
        yield* ctx.refreshMap();
        const low = lightAt(cr.dim, cr.loc) <= 4 && !seen(ctx, cr).visible;
        const next = findSpot(ctx.map, ctx.player, { minDist: 9, maxDist: 20, los: hops % 4 === 3 ? true : false, inViewOk: true, maxLight: 6, crawl: false, maxChecks: 50 });
        if (next) {
          if (low && chance(0.4)) { cr.setAct(ACT.CRAWL, true); ctx.tel.notes.push('N24 low-profile approach'); } else cr.clearAct();
          cr.setPhase('stalking'); cr.moveTo(next.pos, false); hops++;
        }
        const t1 = now() + sec(rand(4, 7));
        while (now() < t1 && cr.valid) {
          yield W(4);
          const s = seen(ctx, cr);
          if (s.visible && s.angle < 25) {
            sighted(ctx);
            if (s.dist > 8 && s.dist < 22 && chance(0.6)) {
              ctx.tel.notes.push('N29 dropped prone');
              cr.halt(); cr.setAct(ACT.PRONE, true);
              const r = yield* hold(ctx, cr, { ticks: sec(rand(3, 6)), approachDist: 7, returnOnSpot: false });
              cr.clearAct();
              yield* passiveExit(ctx, cr, r === 'approach' ? 'walk' : 'backward');
              return 'spotted_prone';
            }
            yield* passiveExit(ctx, cr, 'walk');
            return 'spotted';
          }
          if (cr.arrived(1.5) || cr.stuck) break;
        }
        if (cr.act === ACT.CRAWL) cr.clearAct();
      }
      if (cr.valid) cr.vanish(!seen(ctx, cr).visible);
      return 'followed';
    },
  },
  {
    ...S, id: 'mining_presence', features: ['L16', 'N13'], phases: ['stalking', 'watching'], minState: 'interested', cooldownMin: 10,
    trigger: 'you strip-mine in a straight line', telegraph: 'knocking seems to come from ahead', counterplay: 'change heading; it cannot see ore or future caves',
    weight: (ctx) => (ctx.ps.mineHeading ? 1.0 + trait(ctx.player, 'mine_straight') * 2.5 : 0),
    plan(ctx) {
      const h = ctx.ps.mineHeading; if (!h) return null;
      const eye = ctx.player.getHeadLocation();
      const s = findSpot(ctx.map, ctx.player, { minDist: 8, maxDist: 26, maxLight: 7, crawl: false, test: (n, c) => dot(norm({ x: c.x - eye.x, y: 0, z: c.z - eye.z }), h) > 0.7 });
      return s ? { s } : null;
    },
    *run(ctx, plan) {
      if (unlocked(ctx.player, 'mine_straight')) ctx.tel.notes.push('N13 predicted mining direction');
      sfx(ctx, 'shaftbreaker.knock', plan.s.pos, 0.7, 0.95);
      yield W(sec(1.6));
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'dormant', eyes: 0.75 });
      if (!cr) return 'no_spawn';
      const r = yield* hold(ctx, cr, { ticks: holdT(15, 28), approachDist: 10 });
      return yield* react(ctx, cr, r);
    },
  },
  {
    ...S, id: 'listening_pose', features: ['N07'], phases: ['stalking'], minState: 'interested', cooldownMin: 12,
    trigger: 'you mined, then went quiet', telegraph: 'its head pressed to the stone', counterplay: 'wait quietly, switch route or back away',
    weight: (ctx) => (ctx.ps.recentBreaks >= 3 || curious(ctx.player, 'mine_stop_listen') ? 1.0 + trait(ctx.player, 'mine_stop_listen') * 2 : 0),
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 12, maxDist: 24, los: true, maxLight: 6, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'stalking', act: ACT.LISTEN, eyes: 0.5 });
      if (!cr) return 'no_spawn';
      cr.setAct(ACT.LISTEN, true);
      let breaks = ctx.ps.breakCount; let moves = 0;
      const until = now() + holdT(25, 40);
      while (now() < until && cr.valid) {
        const r = yield* hold(ctx, cr, { ticks: sec(4), approachDist: 8, spotTicks: 10 });
        if (r !== 'timeout') { cr.clearAct(); return yield* react(ctx, cr, r, { exit: 'backward' }); }
        if (ctx.ps.breakCount !== breaks && moves < 3) {
          breaks = ctx.ps.breakCount; moves++;
          ctx.tel.notes.push('followed mining vibrations');
          const m = ctx.map; const pl = ctx.player.location;
          const closer = findSpot(m, ctx.player, { minDist: Math.max(8, dist(cr.loc, pl) - 5), maxDist: dist(cr.loc, pl) - 1, los: false, crawl: false });
          if (closer) { cr.clearAct(); cr.setPhase('stalking'); cr.moveTo(closer.pos); yield W(sec(3)); cr.halt(); cr.setAct(ACT.LISTEN, true); }
        }
      }
      cr.vanish(!seen(ctx, cr).visible);
      return 'listened';
    },
  },
  // ------------------------------------------------------------------ uncanny
  {
    ...U, id: 'impossible_stillness', features: ['N04', 'L02'], phases: ['dormant', 'watching'], minState: 'interested', cooldownMin: 8,
    trigger: 'stable footing with line of sight', telegraph: 'one minimal joint motion breaks the freeze', counterplay: 'any exit route stays usable',
    weight: () => 1.1,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 12, maxDist: 26, los: true, maxLight: 6, crawl: false, minAngle: 25 }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'dormant', eyes: 0.6 });
      if (!cr) return 'no_spawn';
      let r = yield* hold(ctx, cr, { ticks: holdT(14, 26), approachDist: 9 });
      if (r === 'spotted') {
        r = yield* hold(ctx, cr, { ticks: sec(rand(5, 9)), approachDist: 9, returnOnSpot: false });
        if (r === 'timeout') { cr.setAct(ACT.TWITCH); yield W(sec(1.8)); r = yield* hold(ctx, cr, { ticks: sec(rand(3, 6)), approachDist: 9, returnOnSpot: false }); }
      }
      yield* passiveExit(ctx, cr, r === 'approach' ? 'backward' : 'glance');
      return r;
    },
  },
  {
    ...U, id: 'unfinished_movement', features: ['N01'], phases: ['watching'], minState: 'interested', cooldownMin: 10,
    trigger: 'an off-angle figure you notice mid-stride', telegraph: 'a finger twitch precedes movement', counterplay: 'walk away or keep range: no forced combat',
    weight: () => 1.0,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 11, maxDist: 24, los: true, maxLight: 6, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', act: ACT.FREEZE_STEP, eyes: 0.8 });
      if (!cr) return 'no_spawn';
      cr.setAct(ACT.FREEZE_STEP, true);
      const r = yield* hold(ctx, cr, { ticks: holdT(14, 26), approachDist: 10, returnOnSpot: false });
      cr.setAct(ACT.FINISH_STEP);
      yield W(sec(1.6));
      yield* passiveExit(ctx, cr, r === 'approach' ? 'backward' : 'walk');
      return r;
    },
  },
  {
    ...U, id: 'delayed_recognition', features: ['N08'], phases: ['dormant', 'watching'], minState: 'interested', cooldownMin: 10,
    trigger: 'first encounter after a cooldown', telegraph: 'a slow head turn lasting several seconds', counterplay: 'retreat during the turn',
    weight: () => 1.0,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 10, maxDist: 22, los: true, maxLight: 6, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'dormant', face: 'away', eyes: 0.7 });
      if (!cr) return 'no_spawn';
      cr.halt();
      let r = yield* hold(ctx, cr, { ticks: holdT(12, 22), approachDist: 8 });
      if (r !== 'spotted') { yield* passiveExit(ctx, cr); return r; }
      cr.setAct(ACT.DELAYED_TURN, true);
      yield W(sec(2.6));
      // body follows the head, slowly
      const from = safe('rot', () => cr.e.getRotation().y, 0);
      const to = yawTo(cr.loc, ctx.player.location);
      let delta = ((to - from + 540) % 360) - 180;
      for (let i = 1; i <= 12; i++) { safe('turn', () => cr.e.setRotation({ x: 0, y: from + delta * i / 12 })); yield W(3); }
      cr.clearAct();
      r = yield* hold(ctx, cr, { ticks: sec(rand(4, 8)), approachDist: 8, returnOnSpot: false });
      yield* passiveExit(ctx, cr, 'backward');
      return r;
    },
  },
  {
    ...U, id: 'sudden_appearance', features: ['L10', 'L20'], phases: ['watching'], minState: 'observing', cooldownMin: 12,
    trigger: 'a dark, validated spot behind you while you look away', telegraph: 'it is simply there when you turn', counterplay: 'look away and it changes: advance, tilt, back off, or gone',
    weight: () => 0.9,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 8, maxDist: 15, los: true, minAngle: 115, maxLight: 5, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'watching', eyes: 0.9 });
      if (!cr) return 'no_spawn';
      let r = yield* hold(ctx, cr, { ticks: holdT(14, 22), approachDist: 6 });
      if (r !== 'spotted') { yield* passiveExit(ctx, cr); return r; }
      setDanger(ctx.player, 0.55);
      for (let i = 0; i < 3 && cr.valid; i++) {
        const away = yield* hold(ctx, cr, { ticks: sec(10), returnOnSpot: false, approachDist: 6, custom: (s) => (s.angle > 75 ? 'away' : null) });
        if (away !== 'away') break;
        const choice = pick(['advance', 'tilt', 'back', 'gone']);
        ctx.tel.notes.push(`L20 looked away -> ${choice}`);
        if (choice === 'gone') { cr.vanish(true); return 'gone_when_looked_away'; }
        if (choice === 'tilt') cr.setAct(ACT.HEAD_TILT, true);
        if (choice === 'advance' || choice === 'back') {
          const pl = ctx.player.location;
          const tgt = findSpot(ctx.map, ctx.player, { minDist: choice === 'advance' ? Math.max(5, dist(cr.loc, pl) - 4) : dist(cr.loc, pl) + 1, maxDist: choice === 'advance' ? dist(cr.loc, pl) - 1 : dist(cr.loc, pl) + 5, los: true, crawl: false, maxChecks: 30 });
          if (tgt) { safe('tp', () => cr.e.teleport(tgt.pos, { facingLocation: ctx.player.getHeadLocation() })); }
        }
        yield W(sec(1));
      }
      yield* passiveExit(ctx, cr, 'backward');
      return 'played';
    },
  },
  {
    ...U, id: 'behind_player', features: ['L11', 'N24', 'N29'], phases: ['stalking'], minState: 'observing', cooldownMin: 12,
    trigger: 'connected space behind you', telegraph: 'breathing and claw scrapes close behind, before anything else', counterplay: 'turn around: the response window is always there',
    weight: () => 0.9,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minPath: 14, maxPath: 26, minDist: 12, los: false, minAngle: 120, maxLight: 6 }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'stalking', eyes: 0.6 });
      if (!cr) return 'no_spawn';
      const until = now() + sec(30);
      while (now() < until && cr.valid) {
        yield* ctx.refreshMap();
        const view = ctx.player.getViewDirection();
        const pl = ctx.player.location;
        const goal = findSpot(ctx.map, ctx.player, { minDist: 5, maxDist: 8, minAngle: 110, crawl: undefined, maxChecks: 40 });
        if (!goal) break;
        if (ctx.map.cache.headroom(Math.floor(cr.loc.x), Math.floor(cr.loc.y), Math.floor(cr.loc.z)) <= 2) cr.setAct(ACT.CRAWL, true);
        cr.moveTo(goal.pos, false);
        const t1 = now() + sec(6);
        while (now() < t1 && cr.valid) {
          yield W(4);
          const s = seen(ctx, cr);
          if (s.visible && s.angle < 30) {
            sighted(ctx); cr.halt(); cr.setAct(ACT.PRONE, true);
            ctx.tel.notes.push('N29 prone when spotted');
            yield* hold(ctx, cr, { ticks: sec(rand(3, 5)), approachDist: 6, returnOnSpot: false });
            cr.clearAct(); yield* passiveExit(ctx, cr, 'walk'); return 'spotted';
          }
          if (cr.arrived(1.6)) {
            cr.halt(); cr.clearAct(); cr.face(ctx.player.getHeadLocation());
            sfx(ctx, 'shaftbreaker.breath', cr.loc, 0.8, 0.95);
            caption(ctx.player, 'Breathing, right behind you', cr.loc);
            setDanger(ctx.player, 0.7);
            const r = yield* hold(ctx, cr, { ticks: sec(6), approachDist: 3, returnOnSpot: false });
            if (r === 'touched' && wantsHunt(ctx, 0.3)) return yield* huntSequence(ctx, { reuse: true, short: true });
            yield* passiveExit(ctx, cr, 'backward');
            return 'reached';
          }
          if (cr.stuck) break;
        }
        void view; void pl;
      }
      if (cr.valid) cr.vanish(!seen(ctx, cr).visible);
      return 'played';
    },
  },
  {
    ...U, id: 'spectral', features: ['L15'], phases: ['watching'], minState: 'interested', minFamiliarity: 8, cooldownMin: 40,
    trigger: 'rare roll during distant observation', telegraph: 'a translucent shape that never casts a hit', counterplay: 'it fades when you approach',
    weight: () => 0.25,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 14, maxDist: 30, los: true, maxLight: 5, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'dormant', eyes: 0.55, spectral: true });
      if (!cr) return 'no_spawn';
      cr.halt();
      const r = yield* hold(ctx, cr, { ticks: holdT(12, 20), approachDist: 12, returnOnSpot: false });
      safe('wisp', () => cr.dim.spawnParticle('shaftbreaker:wisp', cr.loc));
      cr.vanish(true);
      return r;
    },
  },
  {
    ...U, id: 'surface_silhouette', features: ['L89'], phases: ['dormant'], minState: 'interested', cooldownMin: 45, surface: true,
    trigger: 'surface mode on, near a cave mouth at night', telegraph: 'a harmless distant figure', counterplay: 'it is gone when you approach',
    weight: () => (config().surfaceMode ? 0.7 : 0),
    plan(ctx) { if (!config().surfaceMode) return null; const s = findSpot(ctx.map, ctx.player, { minDist: 22, maxDist: 40, los: true, maxLight: 5, crawl: false }); return s ? { s } : null; },
    *run(ctx, plan) {
      const cr = appear(ctx, { pos: plan.s.pos }, { phase: 'dormant', eyes: 0.9 });
      if (!cr) return 'no_spawn';
      const r = yield* hold(ctx, cr, { ticks: sec(20), approachDist: 16, returnOnSpot: false });
      cr.vanish(!seen(ctx, cr).visible);
      return r;
    },
  },
];

export { isUnderground, scratchNear, soundSpot, evidence, angleTo, floor3, center, randi };
