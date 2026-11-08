// @ts-check
import { ItemStack } from '@minecraft/server';
import { W, soundSpot, sfx, scratchNear, seen } from './common.js';
import { now, sec, rand, randi, chance, pick, dist, sub, len, lenXZ, center, floor3, norm, safe, valid, worldTicks } from '../../core/util.js';
import { config } from '../../core/config.js';
import { TORCHES, isWoodenDoorId, oreForDepth, NATURAL_BREAKABLE } from '../../core/blocks.js';
import { findSpot, hiddenAirNear, lineOfSight, BlockCache } from '../../world/space.js';
import { canBreak, canDress, wasPlaced } from '../../world/protection.js';
import { profile, curious, trait, evidence, regionCenter } from '../memory.js';
import { caption, playFor, setDanger } from '../../audio.js';
import { nearestDen } from '../worldstate.js';

const A = { family: 'audio', needsCreature: false, phases: ['dormant', 'stalking'], minState: 'dormant' };
const E = { family: 'env', needsCreature: false, phases: ['stalking', 'watching'], minState: 'dormant' };

export const MINOR_TEMPLATES = [
  {
    ...A, id: 'knock3', features: ['N34', 'L57', 'L66'], cooldownMin: 7,
    trigger: 'audio encounter after cooldown', telegraph: 'three knocks, then a long gap', counterplay: 'tracing the sound is optional and safe with caution',
    weight: () => 1.3,
    plan: (ctx) => ({ pos: soundSpot(ctx, 10, 26, true) }),
    *run(ctx, plan) {
      caption(ctx.player, 'Three slow knocks', plan.pos);
      for (let i = 0; i < 3; i++) {
        sfx(ctx, 'shaftbreaker.knock', { x: plan.pos.x + rand(-0.4, 0.4), y: plan.pos.y, z: plan.pos.z + rand(-0.4, 0.4) }, 0.9, rand(0.95, 1.03));
        yield W(sec(rand(0.6, 0.8)));
      }
      if (chance(0.4)) scratchNear(ctx.player.dimension, plan.pos);
      ctx.listenWatch = true;
      yield W(sec(4));
      return 'played';
    },
  },
  {
    ...A, id: 'second_pickaxe', features: ['N31', 'L60'], cooldownMin: 9,
    trigger: 'recent sequential block-break samples', telegraph: 'an extra strike with slightly wrong timbre', counterplay: 'stop mining: the decoy keeps going one or two strikes and gives itself away',
    weight: (ctx) => (ctx.ps.recentBreaks >= 4 ? 1.8 + trait(ctx.player, 'mine_stop_listen') * 2 : 0),
    plan(ctx) { const pos = hiddenAirNear(ctx.player.dimension, ctx.player.location, ctx.player.getHeadLocation(), 9); return pos ? { pos } : null; },
    *run(ctx, plan) {
      let seenBreaks = ctx.ps.breakCount;
      let lastBreak = now();
      const until = now() + sec(rand(16, 26));
      let extra = randi(1, 2);
      while (now() < until) {
        yield W(2);
        if (ctx.ps.breakCount !== seenBreaks) {
          seenBreaks = ctx.ps.breakCount; lastBreak = now();
          const p = plan.pos;
          ctx.later(randi(5, 9), () => sfx(ctx, 'shaftbreaker.pickaxe', p, 0.65, rand(0.86, 0.9)));
        } else if (now() - lastBreak > sec(1.3) && extra > 0) {
          sfx(ctx, 'shaftbreaker.pickaxe', plan.pos, 0.65, rand(0.84, 0.9));
          extra--; lastBreak = now() - sec(0.6);
          if (extra === 0) { caption(ctx.player, 'Someone else is mining', plan.pos); ctx.listenWatch = true; yield W(sec(5)); return 'decoy_exposed'; }
        }
      }
      return 'played';
    },
  },
  {
    ...A, id: 'wrong_footsteps', features: ['N33'], cooldownMin: 10,
    trigger: 'player walks through an enclosed cave', telegraph: 'one extra step after you freeze', counterplay: 'no forced combat follows',
    weight: (ctx) => (ctx.ps.moving ? 1.1 : 0.2),
    plan: () => ({}),
    *run(ctx) {
      let walked = 0; let stillT = 0;
      const until = now() + sec(40);
      while (now() < until) {
        yield W(2);
        const v = safe('vel', () => ctx.player.getVelocity(), { x: 0, y: 0, z: 0 });
        const sp = Math.sqrt(v.x * v.x + v.z * v.z);
        if (sp > 0.06) { walked += 2; stillT = 0; } else stillT += 2;
        if (walked > sec(3) && stillT >= 6) {
          const view = ctx.player.getViewDirection();
          const p = { x: ctx.player.location.x - view.x * 3.2, y: ctx.player.location.y + 0.1, z: ctx.player.location.z - view.z * 3.2 };
          yield W(randi(6, 11));
          sfx(ctx, 'shaftbreaker.pstep', p, 0.5, rand(0.9, 1.0));
          caption(ctx.player, 'A footstep behind you', p);
          setDanger(ctx.player, 0.35);
          return 'played';
        }
      }
      return 'no_opportunity';
    },
  },
  {
    ...A, id: 'breathing_stone', features: ['N32'], cooldownMin: 10, minState: 'interested',
    trigger: 'an open cavity right behind the wall', telegraph: 'soft breathing that stops when you dig toward it', counterplay: 'inspect or avoid the area',
    weight: () => 0.9,
    plan(ctx) { const pos = hiddenAirNear(ctx.player.dimension, ctx.player.location, ctx.player.getHeadLocation(), 5); return pos ? { pos } : null; },
    *run(ctx, plan) {
      const startBreaks = ctx.ps.breakCount;
      for (let i = 0; i < randi(2, 3); i++) {
        sfx(ctx, 'shaftbreaker.breath', plan.pos, 0.5, rand(0.92, 1.0));
        for (let k = 0; k < 15; k++) {
          yield W(4);
          if (ctx.ps.breakCount !== startBreaks && ctx.ps.lastBreakPos && dist(ctx.ps.lastBreakPos, plan.pos) < 4) {
            safe('stop', () => ctx.player.runCommand('stopsound @s shaftbreaker.breath'));
            return 'halted_by_digging';
          }
        }
      }
      return 'played';
    },
  },
  {
    ...A, id: 'distant_impact', features: ['N38'], cooldownMin: 9,
    trigger: 'mapped stone chamber, cooldown', telegraph: 'one low impact, dust follows', counterplay: 'no damaging cave-in follows',
    weight: () => 1.0,
    plan: (ctx) => ({ pos: soundSpot(ctx, 22, 40, true) }),
    *run(ctx, plan) {
      sfx(ctx, 'shaftbreaker.distant_impact', plan.pos, 1.0, rand(0.85, 1.0));
      caption(ctx.player, 'A distant collapse', plan.pos);
      yield W(sec(0.7));
      const h = ctx.player.location;
      safe('dust', () => ctx.player.dimension.spawnParticle('shaftbreaker:dust_fall', { x: h.x + rand(-1, 1), y: h.y + 3.2, z: h.z + rand(-1, 1) }));
      playFor(ctx.player, 'shaftbreaker.debris_fall', { x: h.x, y: h.y + 3, z: h.z }, 0.35);
      yield W(sec(3));
      return 'played';
    },
  },
  {
    ...A, id: 'false_chase', features: ['N37'], cooldownMin: 14, minState: 'observing', minFamiliarity: 10,
    trigger: 'valid adjacent tunnel, no ongoing hunt', telegraph: 'fast footsteps approach and cross to the side', counterplay: 'verify with line of sight: nothing is there',
    weight: () => 0.8,
    plan(ctx) {
      const a = findSpot(ctx.map, ctx.player, { minDist: 9, maxDist: 16, los: false });
      const b = a && findSpot(ctx.map, ctx.player, { minDist: 9, maxDist: 16, los: false, test: (n, c) => dist(c, a.pos) > 12 });
      return a && b ? { a: a.pos, b: b.pos } : null;
    },
    *run(ctx, plan) {
      caption(ctx.player, 'Running footsteps', plan.a);
      const steps = 14;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const p = { x: plan.a.x + (plan.b.x - plan.a.x) * t, y: plan.a.y + (plan.b.y - plan.a.y) * t, z: plan.a.z + (plan.b.z - plan.a.z) * t };
        sfx(ctx, 'shaftbreaker.step', p, 0.75 * (1 - t * 0.6), rand(1.05, 1.2));
        yield W(4);
      }
      setDanger(ctx.player, 0.5);
      yield W(sec(3));
      return 'played';
    },
  },
  {
    ...A, id: 'moving_echo', features: ['N40', 'L60'], cooldownMin: 14, minState: 'interested', minFamiliarity: 6,
    trigger: 'multi-passage cave', telegraph: 'three calls; the one that lags is closest to the truth', counterplay: 'attentive players gain location information',
    weight: () => 0.8,
    plan(ctx) {
      const pts = [];
      for (let i = 0; i < 3; i++) { const s = findSpot(ctx.map, ctx.player, { minDist: 14, maxDist: 30, los: false, test: (n, c) => pts.every((p) => dist(p, c) > 10) }); if (s) pts.push(s.pos); }
      return pts.length === 3 ? { pts } : null;
    },
    *run(ctx, plan) {
      const real = randi(0, 2);
      for (let i = 0; i < 3; i++) {
        yield W(i === real ? sec(1.2) : sec(0.55));
        sfx(ctx, 'shaftbreaker.call', plan.pts[i], i === real ? 0.75 : 0.5, rand(0.95, 1.05));
      }
      ctx.ps.echoTruth = plan.pts[real];
      caption(ctx.player, 'Calls from three directions', plan.pts[real]);
      yield W(sec(4));
      return 'played';
    },
  },
  {
    ...A, id: 'breath_sync', features: ['N39'], cooldownMin: 18, minState: 'interested',
    trigger: 'player idle in a safe cave pocket', telegraph: 'breathing that becomes too regular, then stops', counterplay: 'purely atmospheric',
    weight: (ctx) => (ctx.ps.stillTicks > sec(15) ? 1.6 : 0),
    plan(ctx) { const pos = hiddenAirNear(ctx.player.dimension, ctx.player.location, ctx.player.getHeadLocation(), 8); return pos ? { pos } : null; },
    *run(ctx, plan) {
      const n = randi(4, 6);
      for (let i = 0; i < n; i++) {
        sfx(ctx, 'shaftbreaker.breath', plan.pos, 0.45, 1.0);
        const irregular = (n - i) / n;
        yield W(sec(3.0 + irregular * rand(0.4, 1.4)));
      }
      sfx(ctx, 'shaftbreaker.breath', plan.pos, 0.45, 1.0);
      yield W(sec(1.2));
      safe('cut', () => ctx.player.runCommand('stopsound @s shaftbreaker.breath'));
      return 'played';
    },
  },
  {
    ...A, id: 'beam_creak', features: ['L58', 'L56'], cooldownMin: 6,
    trigger: 'valid shaft or timber node', telegraph: 'support beam creaks, a little dust', counterplay: 'none needed',
    weight: (ctx) => (ctx.nearWood ? 1.4 : 0),
    plan(ctx) { return ctx.nearWood ? { pos: ctx.nearWood } : null; },
    *run(ctx, plan) {
      sfx(ctx, 'shaftbreaker.creak', plan.pos, 0.8, rand(0.85, 1.1));
      safe('dust', () => ctx.player.dimension.spawnParticle('shaftbreaker:dust_fall', { x: plan.pos.x, y: plan.pos.y - 0.2, z: plan.pos.z }));
      yield W(sec(rand(2, 4)));
      if (chance(0.5)) sfx(ctx, 'shaftbreaker.creak', plan.pos, 0.6, rand(0.8, 1.0));
      return 'played';
    },
  },
  {
    ...A, id: 'distant_call', features: ['L59', 'L67', 'L65'], cooldownMin: 12, minState: 'interested',
    trigger: 'deep exploration', telegraph: 'a long call echoing from far away', counterplay: 'none needed',
    weight: () => 0.9,
    plan: (ctx) => ({ pos: soundSpot(ctx, 26, 44, true) }),
    *run(ctx, plan) { sfx(ctx, 'shaftbreaker.call', plan.pos, 0.85, rand(0.85, 1.0)); caption(ctx.player, 'A distant call', plan.pos); yield W(sec(4)); return 'played'; },
  },
  // ------------------------------------------------------------------ environment
  {
    ...E, id: 'scratches', features: ['N43', 'L72', 'N11'], cooldownMin: 8,
    trigger: 'natural stone near your path (or a remembered escape route)', telegraph: 'fresh claw marks, faint scraping', counterplay: 'a clue only; marks fade on their own',
    weight: () => 1.2,
    plan(ctx) {
      const pf = profile(ctx.player);
      const route = pf.routes.find((r) => r.n >= 2 && lenXZ(sub(regionCenter(r), ctx.player.location)) < 36);
      const s = findSpot(ctx.map, ctx.player, { minDist: 6, maxDist: 16, los: false, test: route ? (n, c) => dist(c, regionCenter(route)) < 10 : undefined })
        || findSpot(ctx.map, ctx.player, { minDist: 6, maxDist: 14, los: false });
      return s ? { pos: s.pos, route: !!route } : null;
    },
    *run(ctx, plan) {
      sfx(ctx, 'shaftbreaker.scrape', plan.pos, 0.55, rand(0.8, 0.95));
      let n = 0;
      for (let i = 0; i < 4; i++) if (scratchNear(ctx.player.dimension, plan.pos, 12)) n++;
      if (plan.route) ctx.tel.notes.push('scratches at remembered route');
      yield W(sec(2));
      return n ? 'played' : 'no_wall';
    },
  },
  {
    ...E, id: 'shaft_dust', features: ['L72', 'L58'], cooldownMin: 6,
    trigger: 'timber or stone ceiling nearby', telegraph: 'dust trickles down', counterplay: 'none needed',
    weight: () => 0.8,
    plan(ctx) { const s = findSpot(ctx.map, ctx.player, { minDist: 5, maxDist: 12, los: true, minHeadroom: 3 }); return s ? { pos: s.pos } : null; },
    *run(ctx, plan) {
      const c = new BlockCache(ctx.player.dimension);
      const p = floor3(plan.pos); const h = c.headroom(p.x, p.y, p.z);
      safe('dust', () => ctx.player.dimension.spawnParticle('shaftbreaker:dust_fall', { x: plan.pos.x, y: p.y + h - 0.1, z: plan.pos.z }));
      sfx(ctx, 'shaftbreaker.debris_fall', { x: plan.pos.x, y: p.y + h, z: plan.pos.z }, 0.6, 1.0);
      yield W(sec(2));
      return 'played';
    },
  },
  {
    ...E, id: 'ore_bait', features: ['N41'], cooldownMin: 30, minState: 'interested', minFamiliarity: 12,
    trigger: 'rare exploration event in natural terrain', telegraph: 'an unusually convenient ore beside fresh scratches', counterplay: 'take the ore and leave: it is real',
    weight: () => (config().blockDestruction === 'natural' ? 0.6 : 0),
    plan(ctx) {
      const dim = ctx.player.dimension; const c = ctx.map.cache;
      const s = findSpot(ctx.map, ctx.player, {
        minDist: 7, maxDist: 16, los: false, test: (n) => {
          for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [1, 1, 0], [-1, 1, 0]]) {
            const q = { x: n.x + dx, y: n.y + dy, z: n.z + dz };
            const id = c.id(q.x, q.y, q.z);
            if ((id === 'minecraft:stone' || id === 'minecraft:deepslate' || id === 'minecraft:tuff') && canDress(dim, q)) { n.bait = q; return true; }
          }
          return false;
        },
      });
      return s ? { q: s.node.bait, pos: s.pos } : null;
    },
    *run(ctx, plan) {
      const dim = ctx.player.dimension;
      if (!canDress(dim, plan.q)) return 'blocked';
      const ore = oreForDepth(plan.q.y);
      safe('ore', () => dim.getBlock(plan.q)?.setType(ore));
      scratchNear(dim, plan.pos, 8); scratchNear(dim, plan.pos, 8);
      ctx.tel.notes.push(`exposed ${ore}`);
      yield W(sec(1));
      return 'played';
    },
  },
  {
    ...E, id: 'abandoned_meal', features: ['N44', 'L71', 'L72'], cooldownMin: 25, minState: 'interested',
    trigger: 'a dead-end alcove', telegraph: 'bones and rubble, faint clicks nearby', counterplay: 'optional investigation, no trap',
    weight: () => 0.6,
    plan(ctx) {
      const s = findSpot(ctx.map, ctx.player, {
        minDist: 8, maxDist: 22, los: false, crawl: false, test: (n, c, m) => {
          let open = 0;
          for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (m.nodes.has(`${n.x + dx},${n.y},${n.z + dz}`)) open++;
          return open === 1;
        },
      });
      return s ? { pos: s.pos } : null;
    },
    *run(ctx, plan) {
      const dim = ctx.player.dimension;
      safe('meal', () => {
        dim.spawnItem(new ItemStack('minecraft:bone', randi(1, 3)), plan.pos);
        if (chance(0.5)) dim.spawnItem(new ItemStack('minecraft:rotten_flesh', 1), plan.pos);
        dim.spawnItem(new ItemStack(pick(['minecraft:cobblestone', 'minecraft:cobbled_deepslate', 'minecraft:raw_iron', 'minecraft:coal']), randi(1, 2)), plan.pos);
      });
      scratchNear(dim, plan.pos, 10);
      sfx(ctx, 'shaftbreaker.click', plan.pos, 0.45, 1.0);
      yield W(sec(2));
      return 'played';
    },
  },
  {
    ...E, id: 'torch_snuff', features: ['L49', 'L50'], cooldownMin: 30, minState: 'observing',
    trigger: 'your torch, out of view; configurable', telegraph: 'a faint exhale, then that corner goes dark', counterplay: 'the torch is dropped, not destroyed: pick it up',
    weight(ctx) {
      const mode = config().torchManipulation;
      if (mode === 'off' || config().harmless) return 0;
      const base = mode === 'moderate' ? 0.8 : 0.35;
      return curious(ctx.player, 'uses_torches') || mode === 'moderate' ? base * (1 + trait(ctx.player, 'uses_torches')) : 0;
    },
    plan(ctx) {
      const dim = ctx.player.dimension; const eye = ctx.player.getHeadLocation();
      for (const t of [...(ctx.ps.torches || [])].reverse()) {
        const d = dist(t, ctx.player.location);
        if (d < 8 || d > 22) continue;
        let id = ''; try { id = dim.getBlock(t)?.typeId ?? ''; } catch { continue; }
        if (!TORCHES.has(id)) continue;
        if (lineOfSight(dim, eye, center({ ...t, y: t.y + 0.5 }))) continue;
        return { pos: t };
      }
      return null;
    },
    *run(ctx, plan) {
      const dim = ctx.player.dimension;
      sfx(ctx, 'shaftbreaker.vanish', center(plan.pos), 0.35, 1.2);
      yield W(sec(0.4));
      safe('snuff', () => dim.runCommand(`setblock ${plan.pos.x} ${plan.pos.y} ${plan.pos.z} air destroy`));
      evidence(ctx.player, 'uses_torches', 0.3);
      return 'played';
    },
  },
  {
    ...E, id: 'door_taunt', features: ['L46'], cooldownMin: 60, minState: 'observing', minFamiliarity: 8,
    trigger: 'you have escaped through doors before', telegraph: 'a door opens once and closes again', counterplay: 'nothing comes through',
    weight: (ctx) => (curious(ctx.player, 'escape_door') ? 0.9 : 0),
    plan(ctx) {
      const dim = ctx.player.dimension; const c = ctx.map.cache;
      for (const n of ctx.map.list()) {
        if (n.d < 4 || n.d > 20) continue;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const id = c.id(n.x + dx, n.y, n.z + dz);
          if (isWoodenDoorId(id)) return { pos: { x: n.x + dx, y: n.y, z: n.z + dz } };
        }
      }
      return null;
    },
    *run(ctx, plan) {
      const dim = ctx.player.dimension;
      const toggle = (open) => safe('door', () => {
        for (const dy of [0, 1]) {
          const b = dim.getBlock({ ...plan.pos, y: plan.pos.y + dy });
          if (b && isWoodenDoorId(b.typeId)) b.setPermutation(b.permutation.withState(/** @type {any} */ ('open_bit'), open));
        }
      });
      toggle(true); sfx(ctx, 'random.door_open', center(plan.pos), 0.8, 0.85);
      yield W(sec(1.3));
      toggle(false); sfx(ctx, 'random.door_close', center(plan.pos), 0.8, 0.8);
      return 'played';
    },
  },
  {
    ...E, id: 'unstable_ceiling', features: ['N42'], cooldownMin: 20, minState: 'observing', phases: ['breaker'],
    trigger: 'natural loose gravel overhead', telegraph: 'debris trickle and grinding for 1.6 s before anything moves', counterplay: 'step out of the marked lane',
    weight: () => (config().blockDestruction === 'natural' ? 0.5 : 0),
    plan(ctx) {
      const c = ctx.map.cache; const dim = ctx.player.dimension;
      const s = findSpot(ctx.map, ctx.player, {
        minDist: 4, maxDist: 12, test: (n) => {
          const h = c.headroom(n.x, n.y, n.z);
          const top = { x: n.x, y: n.y + h, z: n.z };
          if (c.id(top.x, top.y, top.z) !== 'minecraft:gravel') return false;
          if (wasPlaced(top) || !canBreak(dim, top)) return false;
          n.top = top; return true;
        },
      });
      return s ? { top: s.node.top } : null;
    },
    *run(ctx, plan) {
      const dim = ctx.player.dimension;
      const t = plan.top;
      safe('warn', () => dim.spawnParticle('shaftbreaker:dust_fall', { x: t.x + 0.5, y: t.y - 0.05, z: t.z + 0.5 }));
      sfx(ctx, 'shaftbreaker.debris_fall', center(t), 0.8, 0.8);
      caption(ctx.player, 'Grit falls from the ceiling', t);
      yield W(sec(1.6));
      const pl = ctx.player.location;
      if (Math.abs(pl.x - (t.x + 0.5)) < 1.6 && Math.abs(pl.z - (t.z + 0.5)) < 1.6) { ctx.tel.notes.push('player under lane: held'); return 'held'; }
      safe('drop', () => { const b = dim.getBlock(t); if (b && b.typeId === 'minecraft:gravel') { b.setType('minecraft:air'); b.setType('minecraft:gravel'); } });
      return 'played';
    },
  },
  {
    ...E, id: 'cairn_shift', features: ['N45', 'N47'], cooldownMin: 25, minState: 'interested',
    trigger: 'opt-in cairn markers you placed (cosmetic setting on)', telegraph: 'one marker points the wrong way', counterplay: 'markers can be reset; disable in settings',
    weight: (ctx) => (config().playerBuildAlteration === 'cosmetic' && (ctx.ps.cairns || []).length ? 1.0 : 0),
    plan(ctx) {
      const dim = ctx.player.dimension; const eye = ctx.player.getHeadLocation();
      for (const k of ctx.ps.cairns || []) {
        if (dist(k, ctx.player.location) > 28) continue;
        let b; try { b = dim.getBlock(k); } catch { continue; }
        if (!b || b.typeId !== 'shaftbreaker:cairn_marker') continue;
        if (lineOfSight(dim, eye, center({ ...k, y: k.y + 0.5 }))) continue;
        return { pos: k };
      }
      return null;
    },
    *run(ctx, plan) {
      const dim = ctx.player.dimension;
      safe('cairn', () => {
        const b = dim.getBlock(plan.pos);
        if (!b) return;
        const cur = b.permutation.getState(/** @type {any} */ ('minecraft:cardinal_direction'));
        const next = pick(['north', 'south', 'east', 'west'].filter((d) => d !== cur));
        b.setPermutation(b.permutation.withState(/** @type {any} */ ('minecraft:cardinal_direction'), next));
      });
      sfx(ctx, 'shaftbreaker.scrape', center(plan.pos), 0.35, 1.3);
      return 'played';
    },
  },
];

export { valid, worldTicks, NATURAL_BREAKABLE, nearestDen, seen, len, norm };
