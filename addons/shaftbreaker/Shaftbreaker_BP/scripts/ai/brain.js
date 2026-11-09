// @ts-check
/**
 * The persistent stalker. Once a player has spent a little time underground the Shaftbreaker arrives
 * somewhere out of sight and stays: it shadows the player through the real cave, keeps to the dark,
 * makes itself heard, and is occasionally caught looking. The director's scripted beats (encounters)
 * borrow this same creature and hand it back afterwards.
 */
import { world } from '@minecraft/server';
import { now, sec, mins, rand, randi, chance, pick, dist, valid, safe, worldTicks, OVERWORLD, clamp } from '../core/util.js';
import { config, freqMul, prefs } from '../core/config.js';
import { WalkMap, findSpot, isUnderground, BlockCache } from '../world/space.js';
import { creature, spawnCreature, seenByAnyone, SPEED } from './creature.js';
import { noteSighting } from './memory.js';
import { ws } from './worldstate.js';
import { playAt, setDanger, startMusic, stopMusic, currentMusic } from '../audio.js';
import { inAnyonesView } from './encounters/common.js';
import { log } from '../core/log.js';

const B = {
  targetId: null, map: null, mapT: -1e9, mapJob: null, mapFor: null,
  nextMove: 0, nextCue: 0, withdrawSince: 0, nextArrival: 0, caughtUntil: 0, retreatAt: 0,
  lastSeenTick: -1e9, arrivedAt: 0, shyUntil: 0, lastSightNote: -1e9, nextReplan: 0, closeSince: 0, lastSpike: -1e9, mapOutside: false,
  /** @type {Record<string, {since:number}>} */
  music: {},
};
let api = null;

/** @param {{pstate:Function, running:Function, onArrive:Function, provoke:Function}} deps */
export function initBrain(deps) { api = deps; }
export const brainState = () => B;

function peaceful() {
  try { return String(world.getDifficulty()).toLowerCase() === 'peaceful'; } catch { return false; }
}

/** may the creature be around this player right now? */
export function presenceEligible(p, manual = false) {
  const cfg = config();
  if (!cfg.enabled || !valid(p) || p.dimension.id !== OVERWORLD) return false;
  let gm = 'survival';
  try { gm = String(p.getGameMode()).toLowerCase(); } catch { /* ignore */ }
  if (gm === 'spectator') return false;
  if (gm === 'creative' && !cfg.creativeEncounters && !manual) return false;
  if (manual) return true;
  if (!cfg.naturalEncounters || peaceful() || worldTicks() < ws().defeatedUntil) return false;
  const s = api.pstate(p);
  if (now() < s.graceUntil) return false;
  return s.underground || s.night || cfg.surfaceMode;
}

function target() {
  const id = B.targetId;
  if (!id) return null;
  const p = world.getAllPlayers().find((q) => q.id === id);
  return p && valid(p) ? p : null;
}
export const brainTarget = target;

/** a spot near the player that nobody can see, from the brain's current walk map */
export function hiddenSpot(p, minD, maxD, preferBehind = false) {
  const m = B.map;
  if (!m || B.mapFor !== p.id) return null;
  const dim = p.dimension;
  const dark = api && api.pstate(p).underground ? 8 : undefined;          // on the surface at night: out of sight is enough
  const base = { minDist: minD, maxDist: maxD, los: false, maxLight: dark, crawl: false, maxChecks: 90, test: (n, c) => !inAnyonesView(dim, c) };
  const s = (preferBehind && findSpot(m, p, { ...base, minAngle: 100 })) || findSpot(m, p, base);
  return s ? s.pos : null;
}

// ------------------------------------------------------------------ every 40 ticks
export function brainTick() {
  const c = creature();
  if (c && c.defeated) return;
  const players = world.getAllPlayers();
  const manual = !!(c && c.manual);
  let t = target();
  if (!t || !presenceEligible(t, manual)) {
    t = null;
    if (c) {
      let best = null; let bd = manual ? 96 : 120;
      for (const p of players) { if (!presenceEligible(p, manual)) continue; const d = dist(p.location, c.loc); if (d < bd) { bd = d; best = p; } }
      t = best;
    } else {
      let best = null; let bt = -1;
      for (const p of players) { if (!presenceEligible(p)) continue; const s = api.pstate(p); if (s.ugTicks > bt) { bt = s.ugTicks; best = p; } }
      t = best;
    }
  }
  B.targetId = t ? t.id : null;
  if (!c) {
    if (!t || api.running() || now() < B.nextArrival) return;
    const s = api.pstate(t);
    if (!s.arrivalDelay) s.arrivalDelay = sec(rand(50, 95) * freqMul());
    if (s.ugTicks < s.arrivalDelay) return;
    if (B.map && B.mapFor === t.id && now() - B.mapT < sec(8)) arrive(t);
    return;
  }
  if (!t) {
    if (!B.withdrawSince) B.withdrawSince = now();
    if (now() - B.withdrawSince > sec(30) && !seenByAnyone(c) && !api.running()) {
      log('basic', 'withdrew: nobody left to stalk');
      c.despawn();
      B.nextArrival = now() + mins(rand(1.5, 3));
    }
    return;
  }
  B.withdrawSince = 0;
  c.relocator = () => hiddenSpot(t, 20, 38, true);
}

function arrive(p) {
  const pos = hiddenSpot(p, 18, 40, true) || hiddenSpot(p, 14, 44);
  if (!pos) { B.nextArrival = now() + sec(20); return; }
  const c = spawnCreature(p.dimension, pos, { phase: 'stalking', eyes: 0.7 });
  if (!c) { B.nextArrival = now() + sec(30); return; }
  c.relocator = () => hiddenSpot(p, 20, 38, true);
  B.arrivedAt = now(); B.nextMove = now() + sec(rand(3, 8)); B.nextCue = now() + sec(rand(6, 14));
  const s = api.pstate(p);
  s.firstContactAt = Math.max(s.firstContactAt, now() + mins(rand(1.5, 3.5) * freqMul()));
  s.nextMajor = Math.max(s.nextMajor, s.firstContactAt);
  if (chance(0.6)) playAt(p.dimension, pick(['shaftbreaker.knock', 'shaftbreaker.call', 'shaftbreaker.distant_impact']), pos, 0.8, rand(0.85, 1.0));
  log('basic', `arrived near ${p.name} (${Math.round(dist(pos, p.location))} blocks away, unseen)`);
  api.onArrive(p);
}

/** a standable surface cell outside around a player shut inside a building (night stalking) */
function outsideOrigin(p) {
  const dim = p.dimension;
  const c = new BlockCache(dim);
  for (let i = 0; i < 28; i++) {
    const a = rand(0, Math.PI * 2), r = rand(7, 20);
    const x = Math.floor(p.location.x + Math.cos(a) * r), z = Math.floor(p.location.z + Math.sin(a) * r);
    const top = safe('top', () => dim.getTopmostBlock({ x, z }), null);
    if (!top) continue;
    const id = top.typeId;
    if (id.endsWith('leaves') || id.endsWith('_log') || id.includes('glass') || id.includes('planks')) continue;
    const y = top.location.y + 1;
    if (Math.abs(y - p.location.y) > 8) continue;
    if (c.standable(x, y, z)) return { x: x + 0.5, y, z: z + 0.5 };
  }
  return null;
}

// ------------------------------------------------------------------ every tick: keep a fresh walk map around the target
export function brainFast() {
  const p = target();
  if (!p) return;
  if (!B.mapJob && now() - B.mapT > sec(5)) B.mapJob = { m: new WalkMap(p.dimension, p.location, { maxNodes: 1300, maxDist: 46 }), id: p.id, outside: false };
  if (B.mapJob) {
    B.mapJob.m.step(110);
    if (B.mapJob.m.done) {
      // shut in (a house at night): the creature works from the ground outside instead
      if (!B.mapJob.outside && B.mapJob.m.nodes.size < 90 && !api.pstate(p).underground) {
        const o = outsideOrigin(p);
        if (o) { B.mapJob = { m: new WalkMap(p.dimension, o, { maxNodes: 1300, maxDist: 40 }), id: p.id, outside: true }; return; }
      }
      B.map = B.mapJob.m; B.mapFor = B.mapJob.id; B.mapT = now(); B.mapOutside = B.mapJob.outside; B.mapJob = null;
    }
  }
}

// ------------------------------------------------------------------ every 5 ticks while no scripted beat runs
export function lurkTick() {
  const c = creature();
  const p = target();
  if (!c || !p || c.defeated || api.running()) return;
  const s = api.pstate(p);
  const d = dist(c.loc, p.location);
  const seen = seenByAnyone(c);
  if (seen) {
    B.lastSeenTick = now();
    if (!c.act && now() > B.caughtUntil) {                  // caught lurking: it freezes, then slips away
      B.caughtUntil = now() + sec(rand(16, 28));
      B.shyUntil = now() + sec(60);                          // keeps a wider berth for a while
      if (now() - (B.lastSightNote || -1e9) > mins(2)) { B.lastSightNote = now(); noteSighting(p); api.provoke(p, 2, 'caught it lurking'); }
      c.halt(); c.face(p.getHeadLocation()); c.setPhase('watching');
      if (chance(0.35)) c.setAct(pick([1, 2, 40]));          // twitch / head tilt / stare
      B.retreatAt = now() + sec(rand(1.0, 2.6));
      if (d < 24 && now() - (B.lastSpike || -1e9) > sec(45)) { B.lastSpike = now(); setDanger(p, d < 14 ? 0.7 : 0.55); }
    }
    if (B.retreatAt && now() >= B.retreatAt) {
      B.retreatAt = 0;
      const spot = hiddenSpot(p, Math.max(18, d + 6), 42);
      if (spot) { c.clearAct(); c.setPhase('stalking'); c.moveTo(spot, SPEED.fast); }
    }
    return;
  }
  B.retreatAt = 0;
  const shy = now() < (B.shyUntil || 0) ? 10 : 0;
  const band = s.state === 'provoked' ? [12 + shy, 26 + shy] : s.state === 'observing' ? [16 + shy, 30 + shy] : [22 + shy, 38 + shy];
  const hidden = !inAnyonesView(c.dim, c.loc);                // stricter than 'seen': nobody even faces it
  if (c.moving && c.stuck && hidden) {                                  // never let it get wedged: unseen, it simply moves on
    const spot = hiddenSpot(p, band[0], band[1]);
    if (spot) safe('unstick', () => c.e.teleport(spot, { keepVelocity: false }));
    c.stop(); c.stuckTicks = 0;
  }
  if (d < 10) { if (!B.closeSince) B.closeSince = now(); } else B.closeSince = 0;
  if (B.closeSince && now() - B.closeSince > sec(2.5) && hidden) {         // cornered at close range, unseen: it is simply gone
    const spot = hiddenSpot(p, band[0], band[1], true);
    if (spot) {
      playAt(c.dim, 'shaftbreaker.scrape', { x: c.loc.x, y: c.loc.y + 1, z: c.loc.z }, 0.5, rand(0.9, 1.05));
      safe('slip', () => c.e.teleport(spot, { keepVelocity: false })); c.stop();
      B.nextMove = now() + sec(rand(6, 12));
    }
    B.closeSince = 0;
  } else if (d > 72 && hidden) {                                        // fell far behind: it catches up through the dark
    const spot = hiddenSpot(p, band[0] + 6, band[1] + 6, true);
    if (spot) { safe('catchup', () => c.e.teleport(spot, { keepVelocity: false })); c.stop(); }
  } else {
    // the player walked toward it: it gives ground at once (and abandons a goal that is now too near them)
    const tooClose = d < band[0] - 5;
    const goalBad = c.moving && c.goal && dist(c.goal, p.location) < band[0] - 4 && now() >= (B.nextReplan || 0);
    if ((!c.moving || goalBad) && (now() >= B.nextMove || d > band[1] + 8 || tooClose)) {
      const spot = hiddenSpot(p, band[0], band[1], !tooClose && chance(0.7));
      if (spot) {
        c.clearAct(); c.setPhase('stalking');
        c.moveTo(spot, tooClose ? (d < 10 ? SPEED.scramble : SPEED.fast) : d > band[1] + 12 ? SPEED.walk : SPEED.stalk);
      }
      B.nextMove = now() + sec(rand(9, 22));
      B.nextReplan = now() + sec(1.5);
    }
  }
  if (!c.moving && c.mode !== 'still') { c.setMode('still'); c.setPhase(chance(0.5) ? 'dormant' : 'watching'); }
  if (now() >= B.nextCue && d < 40) {                         // presence: it is heard where it really is
    const cue = d < 12 ? pick(['shaftbreaker.breath', 'shaftbreaker.growl', 'shaftbreaker.click'])
      : d < 24 ? pick(['shaftbreaker.click', 'shaftbreaker.scrape', 'shaftbreaker.breath', 'shaftbreaker.creak'])
        : pick(['shaftbreaker.knock', 'shaftbreaker.scrape', 'shaftbreaker.click', 'shaftbreaker.call']);
    playAt(c.dim, cue, { x: c.loc.x, y: c.loc.y + 1.5, z: c.loc.z }, d < 12 ? 0.6 : 0.85, rand(0.88, 1.05));
    B.nextCue = now() + sec(rand(12, 30) * clamp(1.3 - s.interest / 160, 0.6, 1.3));
  }
}

// ------------------------------------------------------------------ every 20 ticks: music + heartbeat from real distance
export function presenceAudio() {
  const c = creature();
  for (const p of world.getAllPlayers()) {
    const st = (B.music[p.id] = B.music[p.id] || { since: 0 });
    if (p.dimension.id !== OVERWORLD) { if (currentMusic(p)) stopMusic(p); continue; }
    const cur = currentMusic(p);
    if (cur === 'music.shaftbreaker.chase' || cur === 'music.shaftbreaker.standoff') continue;   // owned by a scripted beat
    if (!c || c.defeated) { if (cur) stopMusic(p); continue; }
    const d = dist(c.loc, p.location);
    const recentlySeen = now() - B.lastSeenTick < sec(20);
    let want = null;
    if (d < 46 && (isUnderground(p) || c.manual || api.pstate(p).night)) {
      // hysteresis: become "close" under 14 blocks (or when just seen), fall back to "presence" only beyond 32
      const close = d < 14 || recentlySeen || (cur === 'music.shaftbreaker.close' && (d < 32 || now() - B.lastSeenTick < sec(45)));
      want = close ? 'music.shaftbreaker.close' : 'music.shaftbreaker.presence';
    } else if (cur && d < 56) want = cur;                       // do not drop the bed at the edge of range
    if (want && prefs(p).reducedAudio && want === 'music.shaftbreaker.close') want = 'music.shaftbreaker.presence';
    if (want !== cur && (now() - st.since > sec(want === 'music.shaftbreaker.close' ? 30 : 75) || !cur)) {
      st.since = now();
      if (want) startMusic(p, want); else stopMusic(p);
    }
    // heartbeat only when it is genuinely close (catching it looking gives its own short spike)
    if (d < 8 && !api.running()) setDanger(p, clamp(0.36 + (8 - d) / 8 * 0.34, 0, 0.7));
  }
}

export { randi, mins };
