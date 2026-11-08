// @ts-check
import { world, system } from '@minecraft/server';
import { now, sec, mins, rand, randi, chance, dist, distXZ, sub, norm, lenXZ, clamp, weighted, valid, safe, reportError, worldTicks, isPlayableTarget, OVERWORLD, floor3, key } from '../core/util.js';
import { config, freqMul, intensityMul, prefs } from '../core/config.js';
import { WalkMap, isUnderground, resetBudget, BlockCache } from '../world/space.js';
import { profile, evidence, decay, noteEncounter, saveDirty, trait, curious, markDirty, forget, bumpRegion } from './memory.js';
import { ws, wsDirty, wsSave, addDanger, pushHistory, suppressionAt, pruneSuppression, nearestDen } from './worldstate.js';
import { creature, despawnAll } from './creature.js';
import { tickHeart, stopAllFor, maybeRoomTone, setDanger } from '../audio.js';
import { record, log } from '../core/log.js';
import { tryGenerateDen, tickMoths } from '../world/den.js';
import { MINOR_TEMPLATES } from './encounters/minor.js';
import { OBSERVE_TEMPLATES } from './encounters/observe.js';
import { STANDOFF_TEMPLATES } from './encounters/standoff.js';
import { HUNT_TEMPLATES } from './encounters/hunt.js';

export const TEMPLATES = [...MINOR_TEMPLATES, ...OBSERVE_TEMPLATES, ...STANDOFF_TEMPLATES, ...HUNT_TEMPLATES];
const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
const STATES = ['dormant', 'interested', 'observing', 'provoked', 'hunting'];
const FAMILY_WEIGHT = { stalk: 30, uncanny: 20, audio: 15, env: 15, standoff: 10, hunt: 8, rare: 2 };

// ------------------------------------------------------------------ per-player director state
/** @type {Map<string, any>} */
const players = new Map();

export function pstate(player) {
  let s = players.get(player.id);
  if (!s) {
    const t = now();
    s = {
      id: player.id, name: player.name,
      underground: false, ugTicks: 0, sessionStart: t,
      interest: 12, provocation: 0, state: 'dormant',
      nextMinor: 0, nextMajor: 0, firstContactAt: 0, scheduled: false,
      graceUntil: t + sec(120),               // re-entry grace
      breaks: [], breakCount: 0, recentBreaks: 0, lastBreakTick: -1e9, lastBreakPos: null, mineHeading: null,
      moves: [], moving: false, stillTicks: 0,
      torches: [], cairns: [],
      huntPlaced: 0, huntDoors: 0, retaliationArmed: 0,
      cooldowns: {}, lastEncounterEnd: -1e9, lastHurtBy: 0,
      listenUntil: 0, listenRef: null,
      lastShelterCheck: 0, shelterAnchor: null,
      isolated: false,
    };
    players.set(player.id, s);
  }
  return s;
}

export function dropPlayer(id) { players.delete(id); forget(id); }

function scheduleFresh(s, pf) {
  const t = now(); const m = freqMul();
  const familiar = pf.familiarity > 40;
  s.nextMinor = t + mins(rand(1.5, 4) * m);
  s.firstContactAt = t + mins((familiar ? rand(4, 9) : rand(6, 14)) * m);
  s.nextMajor = s.firstContactAt;
  s.scheduled = true;
}

// ------------------------------------------------------------------ events from main.js
export function onBreak(player, pos) {
  const s = pstate(player);
  s.breakCount++; s.lastBreakTick = now(); s.lastBreakPos = pos;
  s.breaks.push({ t: now(), x: pos.x, y: pos.y, z: pos.z });
  if (s.breaks.length > 14) s.breaks.shift();
  if (s.underground) s.interest = clamp(s.interest + 0.12, 0, 100);
  // N48 listening chamber: inside an echoing den region your mining carries further (and it hears it)
  const den = nearestDen(pos, 16);
  if (den && den.den.listen && s.underground) {
    s.interest = clamp(s.interest + 0.6, 0, 100);
    const echo = { x: den.den.x + (den.den.x - pos.x) * 0.5, y: den.den.y + 2, z: den.den.z + (den.den.z - pos.z) * 0.5 };
    system.runTimeout(() => safe('echo', () => player.dimension.playSound('dig.stone', echo, { volume: 0.5, pitch: 0.8 })), 8);
  }
  // N13 heading estimate: >= 6 recent breaks aligned along one axis
  const recent = s.breaks.filter((b) => now() - b.t < sec(90));
  s.recentBreaks = recent.filter((b) => now() - b.t < sec(20)).length;
  if (recent.length >= 6) {
    const a = recent[0], b = recent[recent.length - 1];
    const d = { x: b.x - a.x, y: 0, z: b.z - a.z };
    const L = Math.sqrt(d.x * d.x + d.z * d.z);
    if (L >= 4) {
      const n = { x: d.x / L, y: 0, z: d.z / L };
      let dev = 0;
      for (const r of recent) { const px = r.x - a.x, pz = r.z - a.z; dev = Math.max(dev, Math.abs(px * -n.z + pz * n.x)); }
      if (dev <= 2.2) {
        s.mineHeading = n;
        if (!s.lastHeadingEvidence || now() - s.lastHeadingEvidence > mins(3)) { s.lastHeadingEvidence = now(); evidence(player, 'mine_straight', 0.6, 'straight tunnel'); }
      }
    }
  }
}

/** N19: it watches how you fight other mobs underground (only broad habits, capped) */
export function onPlayerHitMob(player) {
  const s = pstate(player);
  if (!s.underground || now() - (s.lastMobWatch || 0) < sec(20)) return;
  s.lastMobWatch = now();
  const start = player.location;
  system.runTimeout(() => { if (valid(player) && lenXZ(sub(player.location, start)) > 1.6) evidence(player, 'melee_retreat', 0.25, 'watched you fight'); }, sec(1));
}

export function onPlace(player, pos, typeId) {
  const s = pstate(player);
  if (cur && cur.ctx.player.id === player.id && cur.ctx.tpl.family === 'hunt') {
    const p = player.location;
    if (Math.abs(pos.x + 0.5 - p.x) < 1.2 && Math.abs(pos.z + 0.5 - p.z) < 1.2 && pos.y < p.y) s.huntPlaced++;
    if (typeId === 'minecraft:tnt') { cur.ctx.tel.notes.push('L51 TNT placed during hunt'); evidence(player, 'trap_reuse', 0.8, 'explosive trap'); }
  }
  if (/torch|lantern/.test(typeId) && s.underground) {
    s.torches.push(pos); if (s.torches.length > 24) s.torches.shift();
    if (!s.lastTorchEvidence || now() - s.lastTorchEvidence > sec(90)) { s.lastTorchEvidence = now(); evidence(player, 'uses_torches', 0.22); }
  }
  if (typeId === 'shaftbreaker:cairn_marker') { s.cairns.push(pos); if (s.cairns.length > 12) s.cairns.shift(); }
}

export function onDoorUse(player) {
  const s = pstate(player);
  if (cur && cur.ctx.player.id === player.id && cur.ctx.tpl.family === 'hunt') s.huntDoors++;
}

export function onPlayerDeath(player) {
  const s = pstate(player);
  s.graceUntil = now() + sec(config().deathGraceSeconds);
  s.nextMajor = Math.max(s.nextMajor, now() + mins(rand(6, 10) * freqMul()));
  profile(player).deaths++; markDirty(player);
  if (cur && cur.ctx.player.id === player.id) cur.abort('player_died');
}

export function onPlayerSpawn(player) { const s = pstate(player); s.graceUntil = Math.max(s.graceUntil, now() + sec(config().deathGraceSeconds)); }

export function onCreatureHurtByPlayer(player, amount) {
  const pf = profile(player);
  pf.hitsOnCreature = (pf.hitsOnCreature || 0) + 1;
  pf.lastHurtCreature = worldTicks();
  markDirty(player);
  const s = pstate(player);
  s.interest = clamp(s.interest + 10, 0, 100);
  provoke(player, 35, 'struck it');
  s.provokedUntil = now() + mins(3);
  const start = player.location;
  system.runTimeout(() => {                                    // L44 melee_retreat evidence
    if (!valid(player)) return;
    const c = creature();
    if (c && dist(player.location, c.loc) - dist(start, c.loc) > 1.8) evidence(player, 'melee_retreat', 0.8, 'backed off after a swing');
  }, sec(1));
  if (cur && cur.ctx.player.id === player.id) cur.ctx.provoked = true;
}

export function armRetaliation(player, at) { pstate(player).retaliationArmed = at; provoke(player, 25, 'den'); }

/** event-driven provocation (eye contact, approaching it, striking it, repeated escapes, den damage) */
export function provoke(player, amount, why = '') {
  const s = pstate(player);
  s.provocation = clamp(s.provocation + amount * intensityMul(), 0, 100);
  if (why && config().debug === 'verbose') log('verbose', `provocation +${amount} (${why}) -> ${s.provocation.toFixed(0)}`);
}

// ------------------------------------------------------------------ the running encounter
class Running {
  constructor(tpl, ctx, gen) { this.tpl = tpl; this.ctx = ctx; this.gen = gen; this.resume = now(); this.done = false; this.reason = ''; }
  abort(reason) { this.reason = reason; this.done = true; }
}
/** @type {Running|null} */
let cur = null;
export const running = () => cur;

function startEncounter(tpl, player, s, map, plan) {
  const pf = profile(player);
  const ctx = {
    player, ps: s, tpl, plan, map, t0: now(), spotted: false, contact: 0, prefs: prefs(player), isolated: s.isolated, allowHunt: true,
    tel: { id: tpl.id, family: tpl.family, features: tpl.features, player: player.name, trigger: tpl.trigger, telegraph: tpl.telegraph, counterplay: tpl.counterplay, phases: [], notes: [], outcome: '', reason: s.reason || '' },
    later: (ticks, fn) => system.runTimeout(() => safe('later', fn), ticks),
    *refreshMap() {
      if (ctx.map && now() - ctx.mapT < sec(4)) return;
      const m = new WalkMap(player.dimension, player.location, { maxNodes: 900, maxDist: 36 });
      while (!m.done) { m.step(140); if (!m.done) yield 1; }
      ctx.map = m; ctx.mapT = now();
    },
    mapT: now(),
  };
  noteEncounter(player, tpl.id, tpl.family);
  s.cooldowns[tpl.id] = now();
  const gen = tpl.run(ctx, plan);
  cur = new Running(tpl, ctx, gen);
  log('basic', `encounter ${tpl.id} [${tpl.features.join(',')}] for ${player.name} (state=${s.state}, int=${s.interest.toFixed(0)}) ${s.reason || ''}`);
}

function finishEncounter(outcome) {
  if (!cur) return;
  const { ctx, tpl } = cur;
  const s = ctx.ps;
  const pl = ctx.player;
  const t = now();
  const m = freqMul();
  ctx.tel.outcome = ctx.tel.outcome || outcome;
  ctx.tel.duration = ((t - ctx.t0) / 20).toFixed(1) + 's';
  record(ctx.tel);
  pushHistory({ id: tpl.id, f: tpl.family, p: ctx.tel.player, t: worldTicks(), o: ctx.tel.outcome });
  const minor = tpl.family === 'audio' || tpl.family === 'env';
  if (minor) s.nextMinor = t + mins(rand(2, 4.5) * m);
  else if (tpl.family === 'hunt') { s.nextMajor = t + mins(rand(5, 9) + rand(2, 4) * m); s.nextMinor = t + mins(3 * m); s.interest = clamp(s.interest - 25, 10, 100); s.provocation = clamp(s.provocation - 60, 0, 100); }
  else { s.nextMajor = t + mins(rand(7, 13) * m); s.nextMinor = t + mins(rand(1.5, 3) * m); s.interest = clamp(s.interest - 6, 10, 100); }
  if (ctx.spotted) provoke(pl, 7, 'seen');
  if ((ctx.contact || 0) > sec(3)) provoke(pl, 12, 'held eye contact');
  if (ctx.tel.outcome === 'approach' || ctx.tel.outcome === 'touched') provoke(pl, 14, 'approached it');
  if (tpl.family === 'hunt' && ['escaped', 'cap', 'surface', 'no_path'].includes(ctx.tel.outcome)) provoke(pl, 18, 'escaped a hunt');
  s.lastEncounterEnd = t;
  lastGlobalEnd = t;
  if (!minor) lastGlobalMajorEnd = t;
  if (!minor && valid(pl)) {
    for (const q of world.getAllPlayers()) {                     // witnesses share the experience
      if (q.id === pl.id || q.dimension.id !== pl.dimension.id || dist(q.location, pl.location) > 24) continue;
      const qs = pstate(q); qs.nextMajor = Math.max(qs.nextMajor, t + mins(rand(4, 7) * m));
    }
  }
  addDanger(tpl.family === 'hunt' ? -20 : tpl.family === 'standoff' ? -8 : minor ? -1 : -4);
  if (ctx.listenWatch && valid(pl)) { s.listenUntil = t + sec(9); s.listenRef = { breaks: s.breakCount, pos: pl.location, mining: s.recentBreaks >= 2 }; }
  // cleanup: never leave the creature, its music or its tag behind
  const c = creature();
  if (c && tpl.needsCreature) { c.releaseTarget(); c.vanish(true); }
  if (valid(pl)) stopAllFor(pl);
  cur = null;
  log('basic', `encounter ${tpl.id} ended: ${ctx.tel.outcome} (${ctx.tel.duration})`);
}

function stepEncounter() {
  if (!cur) return;
  const r = cur;
  const pl = r.ctx.player;
  const cfg = config();
  if (!valid(pl)) r.abort('player_left');
  else if (!cfg.enabled) r.abort('disabled');
  else if (pl.dimension.id !== OVERWORLD) r.abort('dimension');
  if (r.done) {
    safe('genReturn', () => r.gen.return(undefined));
    const c = creature();
    if (c) { c.releaseTarget(); c.vanish(true); }
    finishEncounter(r.reason);
    return;
  }
  if (now() < r.resume) return;
  let res;
  try { res = r.gen.next(); } catch (e) { reportError(`encounter:${r.tpl.id}`, e); finishEncounter('error'); return; }
  if (res.done) { finishEncounter(String(res.value ?? 'done')); return; }
  const v = res.value;
  r.resume = now() + (typeof v === 'number' && v > 0 ? v : 1);
  // hard safety cap on any encounter's length
  if (now() - r.ctx.t0 > mins(4)) { r.abort('timeout_cap'); }
}

// ------------------------------------------------------------------ periodic evaluation (every 40 ticks)
let pendingScan = null;
let lastGlobalEnd = -1e9;
let lastGlobalMajorEnd = -1e9;
export const planFails = {};   // { player, map, minor, started }

function updatePlayer(p, dt) {
  const s = pstate(p);
  const pf = profile(p);
  const ug = isUnderground(p);
  if (ug && !s.underground) { s.underground = true; if (!s.scheduled) scheduleFresh(s, pf); }
  if (!ug && s.underground) { s.underground = false; }
  if (ug) {
    s.ugTicks += dt; pf.undergroundSec += dt / 20; markDirty(p);
    s.interest = clamp(s.interest + 0.09 * intensityMul(), 0, 100);       // ~ +2.7 per minute underground
    const den = nearestDen(p.location, 48);
    if (den) s.interest = clamp(s.interest + 0.15, 0, 100);
  } else s.interest = clamp(s.interest - 0.6, 0, 100);
  s.provocation = clamp(s.provocation - 0.04, 0, 100);                   // fades over ~80 minutes
  if (ug) s.provocation = clamp(s.provocation + 0.035 * (ws().danger / 40) * (0.5 + pf.familiarity / 100), 0, 100); // slow drift: even passive players are eventually hunted
  // movement samples
  const l = p.location;
  const last = s.moves[s.moves.length - 1];
  const moved = last ? lenXZ(sub(l, last)) : 0;
  s.moves.push({ x: l.x, y: l.y, z: l.z, t: now() }); if (s.moves.length > 30) s.moves.shift();
  s.moving = moved > 1.2;
  s.stillTicks = moved < 0.4 ? s.stillTicks + dt : 0;
  if (now() - s.lastBreakTick > sec(25)) s.recentBreaks = 0;
  // N7 listen check after an audio scare
  if (s.listenUntil && now() > s.listenUntil) {
    const ref = s.listenRef;
    if (ref && ref.mining && s.breakCount === ref.breaks && lenXZ(sub(l, ref.pos)) < 1.5) evidence(p, 'mine_stop_listen', 1, 'froze after a sound');
    s.listenUntil = 0; s.listenRef = null;
  }
  // N14 shelters: a player that lingers in the same spot underground after an escape
  if (ug && s.stillTicks > sec(60) && now() - s.lastShelterCheck > mins(5) && now() - s.lastEncounterEnd < mins(6)) {
    s.lastShelterCheck = now();
    bumpRegion(pf.shelters, l, 4); markDirty(p);
  }
  // provoked state
  const prov = s.provokedUntil && now() < s.provokedUntil;
  const fam = pf.familiarity;
  const th = [14 - fam * 0.06, 36 - fam * 0.12];
  s.state = cur && cur.ctx.player.id === p.id && cur.tpl.family === 'hunt' ? 'hunting'
    : prov || s.provocation >= 45 ? 'provoked' : s.interest >= th[1] || (pf.sightings >= 2 && s.interest >= th[0]) ? 'observing' : s.interest >= th[0] ? 'interested' : 'dormant';
  tickHeart(p);
  if (ug && s.state !== 'dormant') maybeRoomTone(p, s.interest / 100);
  if (ug) decay(p, dt / 20);
}

function groupSignals(list) {
  const ug = list.filter((p) => pstate(p).underground);
  for (const p of ug) {
    const s = pstate(p);
    const mates = ug.filter((q) => q.id !== p.id && q.dimension.id === p.dimension.id);
    if (!mates.length) { s.isolated = false; continue; }
    const nearest = Math.min(...mates.map((q) => dist(q.location, p.location)));
    s.isolated = nearest > 28 && nearest < 200;
    if (!s.lastGroupEv || now() - s.lastGroupEv > mins(2)) {
      s.lastGroupEv = now();
      if (nearest < 12) evidence(p, 'group_together', 0.5);
      else if (s.isolated) evidence(p, 'group_separated', 0.6, 'wandered away from the group');
    }
  }
}

function eligible(p) {
  const cfg = config();
  if (!cfg.enabled || !cfg.naturalEncounters) return false;
  if (!valid(p) || p.dimension.id !== OVERWORLD || !isPlayableTarget(p)) return false;
  const s = pstate(p);
  if (now() < s.graceUntil) return false;
  if (!s.underground && !cfg.surfaceMode) return false;
  return true;
}

function familyMul(s, pf, fam, major) {
  if (!major) return fam === 'audio' || fam === 'env' ? 1 : 0;
  if (fam === 'audio' || fam === 'env') return 0;
  const st = s.state;
  let m = 1;
  if (fam === 'hunt') m = st === 'provoked' ? 2.2 : st === 'observing' ? 0.6 : 0;
  if (fam === 'standoff') m = st === 'provoked' ? 1.6 : st === 'observing' ? 1 : 0.25;
  if (fam === 'rare') m = worldTicks() - ws().lastRare > mins(120) ? 1 : 0;
  if (fam === 'stalk' || fam === 'uncanny') m = st === 'dormant' ? 0.6 : 1;
  // L55 aggression balancing
  if (fam === 'hunt') {
    const caughtRatio = pf.hunts ? pf.huntsCaught / pf.hunts : 0;
    m *= (0.4 + ws().danger / 60) * (caughtRatio > 0.5 ? 0.5 : pf.huntsEscaped > 3 ? 1.2 : 1) * intensityMul();
    if (now() - s.lastEncounterEnd < mins(2)) m *= 0.3;
  }
  // novelty: same family blocked for 3 intervening encounters (soft for common families)
  const recentFam = pf.lastFamilies.slice(-3);
  if (recentFam.includes(fam)) m *= fam === 'hunt' || fam === 'rare' ? 0 : 0.12;
  return m;
}

function choosePlayer(list) {
  let best = null; let bestScore = -1;
  const t = now();
  for (const p of list) {
    if (!eligible(p)) continue;
    const s = pstate(p);
    if (!s.scheduled) continue;
    if (t - lastGlobalEnd < sec(30)) continue;                       // world-level breathing room
    const minorDue = t >= s.nextMinor;
    const majorDue = t >= s.nextMajor && t >= s.firstContactAt && t - lastGlobalMajorEnd >= mins(2.5);
    if (!minorDue && !majorDue) continue;
    let score = (majorDue ? 2 : 1) + (t - Math.min(s.nextMinor, s.nextMajor)) / 1200 + (s.isolated ? 1.5 * (1 + trait(p, 'group_separated')) : 0);
    if (score > bestScore) { bestScore = score; best = { p, major: majorDue }; }
  }
  return best;
}

function candidates(p, s, map, major) {
  const pf = profile(p);
  const cfg = config();
  const t = now();
  let peaceful = false;
  try { peaceful = String(world.getDifficulty()).toLowerCase() === 'peaceful'; } catch { /* ignore */ }
  const supp = suppressionAt(p.location);
  const ctx = { player: p, ps: s, map, isolated: s.isolated, nearWood: findWood(map) };
  const out = [];
  for (const tpl of TEMPLATES) {
    if (tpl.needsCreature && (peaceful || (cfg.harmless && tpl.family === 'hunt'))) continue;
    if (tpl.needsCreature && worldTicks() < ws().defeatedUntil) continue;
    if (tpl.surface && s.underground) continue;
    if (!tpl.surface && !s.underground) continue;
    if (STATES.indexOf(s.state) < STATES.indexOf(tpl.minState || 'dormant')) continue;
    if ((tpl.minFamiliarity || 0) > pf.familiarity) continue;
    if ((tpl.minSightings || 0) > pf.sightings && !(tpl.family === 'hunt' && s.provokedUntil > t)) continue;
    const cd = s.cooldowns[tpl.id];
    if (cd && t - cd < mins((tpl.cooldownMin || 5) * freqMul())) continue;
    let w = FAMILY_WEIGHT[tpl.family] * familyMul(s, pf, tpl.family, major);
    if (w <= 0) continue;
    const tw = safe('weight', () => tpl.weight(ctx), 0);
    if (!(tw > 0)) continue;
    let rel = tw;
    if (pf.lastIds.slice(-4).includes(tpl.id)) rel *= 0.25;
    if (supp > 0 && tpl.id !== 'den_retaliation') w *= 1 - supp;
    out.push([tpl, w, ctx, rel]);
  }
  // a family's design weight is shared among its eligible templates (more templates != more often)
  const famSum = {};
  for (const c of out) famSum[c[0].family] = (famSum[c[0].family] || 0) + c[3];
  return out.map((c) => [c[0], c[1] * (c[3] / famSum[c[0].family]) * Math.min(1.6, famSum[c[0].family] / Math.max(1, countFam(c[0].family)) + 0.6), c[2]]).filter((c) => c[1] > 0);
}

const famCount = {};
for (const t of TEMPLATES) famCount[t.family] = (famCount[t.family] || 0) + 1;
function countFam(f) { return famCount[f] || 1; }

function findWood(map) {
  if (!map) return null;
  const c = map.cache;
  const list = map.list();
  for (let i = 0; i < 30 && list.length; i++) {
    const n = list[randi(0, list.length - 1)];
    for (const dy of [2, 3]) {
      const id = c.id(n.x, n.y + dy, n.z);
      if (id === 'minecraft:oak_planks' || id === 'minecraft:oak_fence' || id === 'minecraft:dark_oak_fence' || id === 'minecraft:dark_oak_planks') return { x: n.x + 0.5, y: n.y + dy, z: n.z + 0.5 };
    }
  }
  return null;
}

/** pick and start an encounter (weighted, validated; falls back to a quiet event or nothing) */
function select(p, map, major) {
  const s = pstate(p);
  let cands = candidates(p, s, map, major);
  // a chosen encounter must still pass placement/visibility/safety validation (plan); up to 5 tries
  for (let i = 0; i < 5 && cands.length; i++) {
    const pick = weighted(cands.map((c) => [c, c[1]]));
    if (!pick) break;
    const [tpl, , ctx] = pick;
    cands = cands.filter((c) => c !== pick);
    const plan = safe(`plan:${tpl.id}`, () => tpl.plan(ctx), null);
    if (!plan) { planFails[tpl.id] = (planFails[tpl.id] || 0) + 1; continue; }
    s.reason = `w=${pick[1].toFixed(1)} state=${s.state}`;
    startEncounter(tpl, p, s, map, plan);
    return true;
  }
  // nothing valid: a quiet room-tone beat or no event at all
  const t = now();
  if (major) s.nextMajor = t + sec(rand(40, 90)); else s.nextMinor = t + sec(rand(30, 60));
  return false;
}

export function directorTick() {
  resetBudget();
  const list = world.getAllPlayers();
  const dt = 40;
  for (const p of list) safe('updatePlayer', () => updatePlayer(p, dt));
  safe('group', () => groupSignals(list));
  safe('moths', () => tickMoths(list));
  ws().danger = clamp(ws().danger + 0.06, 0, 100);                      // ~ +1.8 per minute
  if (cur) return;
  if (pendingScan) {
    const ps = pendingScan;
    if (!valid(ps.player)) { pendingScan = null; return; }
    if (!ps.map.done) return;
    pendingScan = null;
    safe('select', () => select(ps.player, ps.map, ps.major));
    return;
  }
  const choice = choosePlayer(list);
  if (!choice) {
    // dens grow quietly while nothing else happens
    for (const p of list) {
      const s = pstate(p); const pf = profile(p);
      if (s.underground && (pf.undergroundSec > 20 * 60 || pf.familiarity > 15) && (!s.lastDenTry || now() - s.lastDenTry > mins(5))) {
        s.lastDenTry = now();
        safe('den', () => tryGenerateDen(p));
        break;
      }
    }
    return;
  }
  pendingScan = { player: choice.p, major: choice.major, map: new WalkMap(choice.p.dimension, choice.p.location, { maxNodes: 1400, maxDist: 46 }) };
}

/** called every tick: drive the scan and the running encounter */
export function fastTick() {
  if (pendingScan && !pendingScan.map.done) safe('scan', () => pendingScan.map.step(110));
  if (cur) safe('step', () => stepEncounter());
}

export function slowTick() {
  saveDirty(world.getAllPlayers());
  pruneSuppression();
  wsSave();
}

// ------------------------------------------------------------------ manual control (commands / dial / tests)
export function forceEncounter(player, id) {
  const tpl = BY_ID.get(id);
  if (!tpl) return `unknown encounter '${id}'`;
  if (cur) cur.abort('replaced');
  stepEncounter();
  const s = pstate(player);
  const map = new WalkMap(player.dimension, player.location, { maxNodes: 1400, maxDist: 46 });
  map.finish(9000);
  const ctx = { player, ps: s, map, isolated: true, nearWood: findWood(map) };
  const plan = safe(`plan:${id}`, () => tpl.plan(ctx), null);
  if (!plan) return `no valid placement for '${id}' here`;
  s.reason = 'forced';
  startEncounter(tpl, player, s, map, plan);
  return `started ${id}`;
}

export function stopEncounter() { if (cur) cur.abort('stopped'); stepEncounter(); despawnAll(true); }

export function debugLine(p) {
  const s = pstate(p);
  const pf = profile(p);
  const c = creature();
  const tops = Object.entries(pf.traits).filter(([, t]) => t.s > 1).sort((a, b) => b[1].s - a[1].s).slice(0, 3).map(([k, t]) => `${k.replace('escape_', 'esc_')}:${t.s.toFixed(0)}/${t.c.toFixed(0)}`).join(' ');
  const enc = cur ? `${cur.tpl.id}` : '-';
  const nm = Math.max(0, (s.nextMajor - now()) / 20).toFixed(0);
  const nn = Math.max(0, (s.nextMinor - now()) / 20).toFixed(0);
  return `§7SB §f${s.state}§7 int=${s.interest.toFixed(0)} prov=${s.provocation.toFixed(0)} dng=${ws().danger.toFixed(0)} ug=${s.underground ? 1 : 0} | enc=§e${enc}§7 ph=${c ? c.phase : '-'} act=${c ? c.act : '-'} | major ${nm}s minor ${nn}s | ${tops}`;
}

export { players as _players, scheduleFresh, wsDirty, wsSave };
