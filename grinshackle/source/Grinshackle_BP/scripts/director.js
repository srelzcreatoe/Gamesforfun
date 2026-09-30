// The encounter director: a server-authoritative state machine.
//   DORMANT → OMENS → EMERGE → OBSERVE / INVESTIGATE / STALK / FLANK → WARNING → HUNT → SEARCH / RETREAT → COOLDOWN
// Attacks, crawling, hurt reactions and enrage are substates/overlays handled here with attacks.js / navigation.js / animation.js.
// Every state: entry actions, per-tick rules, valid targets, timers and exit are in the functions below (enterState / tick).
import { world, ItemStack } from '@minecraft/server';
import { IDS, ATTACKS, CLIPS, SOUNDS, PARTICLES, VARIANTS, ENRAGE_TICKS, SNAP_COOLDOWN, HURT_COOLDOWN, REAL_HEALTH_POOL } from './constants.js';
import { S, newRecord } from './state.js';
import { dist, flatDist, safe, isValid, rand, randInt, chance, pick, clamp, jsonParse, log, headingOf, yawToDir } from './util.js';
import * as timers from './timers.js';
import * as config from './config.js';
import * as gates from './gates.js';
import * as scan from './world_scan.js';
import * as reservation from './reservation.js';
import * as perception from './perception.js';
import * as memory from './memory.js';
import * as navigation from './navigation.js';
import * as attacks from './attacks.js';
import * as animation from './animation.js';
import * as audio from './audio.js';
import * as markers from './markers.js';
import * as omens from './omens.js';
import * as text from './text.js';

const T = (s) => Math.round(s * 20);
let lastSpawnFailure = '';

// ------------------------------------------------------------------ helpers
function cfg(k) { return config.get(k); }
function target() { return perception.targetOf(S.record); }
function entity() { return S.active; }
function alive() { return S.record && isValid(S.active) && reservation.validate(S.active); }
function age() { return S.tick - S.record.stateEntered; }
function huntBudgetLeft() { const r = S.record; return r.huntBudgetTicks - (r.huntStart ? S.tick - r.huntStart : 0); }
function eligibleTarget(p) { return isValid(p) && gates.playerEligible(p) && isValid(S.active) && safe(() => p.dimension.id, 'a') === safe(() => S.active.dimension.id, 'b'); }
function motionFor(base) {
  const r = S.record; const speed = cfg('speedScale');
  if (base === 'hunt') { if (S.tick < r.enragedUntil) return 'hunt_fast'; return speed < 0.9 ? 'hunt_slow' : speed > 1.1 ? 'hunt_fast' : 'hunt'; }
  if (base === 'crawl') { if (S.tick < r.enragedUntil) return 'crawl_fast'; return speed < 0.9 ? 'crawl_slow' : speed > 1.1 ? 'crawl_fast' : 'crawl'; }
  return base;
}
function moving() { const e = entity(); const v = safe(() => e.getVelocity(), undefined); return !!v && Math.hypot(v.x, v.z) > 0.02; }
function particles(id, pos, n = 1) {
  const e = entity(); if (!isValid(e) || !pos) return;
  const density = cfg('effectDensity'); if (density <= 0) return;
  for (let i = 0; i < Math.min(6, Math.ceil(n * density)); i++) safe(() => e.dimension.spawnParticle(id, pos));
}
function ambientEffects() {
  const e = entity(); if (!isValid(e) || S.tick % 20 !== 0) return;
  const loc = e.location; if (chance(0.7 * cfg('effectDensity'))) particles(PARTICLES.ink_motes, { x: loc.x, y: loc.y + 1.2, z: loc.z });
  if (chance(0.15 * cfg('effectDensity'))) particles(PARTICLES.ink_drip, { x: loc.x, y: loc.y + 2.4, z: loc.z });
}

// ------------------------------------------------------------------ variants / history
export function chooseVariant() {
  const hist = Array.isArray(S.history) ? S.history : [];
  let pool = VARIANTS.filter((v) => !hist.slice(-2).includes(v));
  if (!cfg('lastLink')) pool = pool.filter((v) => v !== 'last_link');
  if (!cfg('cornerWatch')) pool = pool.filter((v) => v !== 'watcher');
  if (!cfg('thresholds')) pool = pool.filter((v) => v !== 'ambusher');
  if (!pool.length) pool = ['shadow'];
  const v = pick(pool);
  hist.push(v); while (hist.length > 4) hist.shift(); S.history = hist;
  safe(() => world.setDynamicProperty(IDS.PROP_HISTORY, JSON.stringify(hist)));
  return v;
}
export function loadHistory() { S.history = jsonParse(safe(() => world.getDynamicProperty(IDS.PROP_HISTORY), undefined), []) || []; }

// ------------------------------------------------------------------ lifecycle
/** Start (or resume) an encounter for an already-spawned creature. mode: natural|test|egg. */
export function beginEncounter(ent, mode, player, opts = {}) {
  if (!isValid(ent)) return false;
  if (S.record && S.record.state === 'OMENS') { omens.end(S.record); S.record = undefined; }
  if (S.record && S.active && isValid(S.active) && S.active.id !== ent.id) { safe(() => ent.remove()); return false; }
  const res = reservation.current() && reservation.current().entityId === ent.id ? reservation.current() : reservation.reserve(ent, mode);
  S.active = ent;
  const variant = opts.variant || chooseVariant();
  const r = newRecord(res.generation, mode, variant, player ? player.id : undefined, S.tick);
  r.huntBudgetTicks = T(cfg('huntCapSeconds'));
  r.stalkLength = T(rand(cfg('stalkMinSeconds'), cfg('stalkMaxSeconds')));
  r.sightingOnly = variant === 'watcher' && chance(0.5);
  r.virtualHealth = cfg('health');
  r.lastLink.active = variant === 'last_link';
  S.record = r;
  S.lures.length = 0;
  safe(() => ent.getComponent('minecraft:health')?.resetToMaxValue());
  safe(() => ent.triggerEvent('gs:stand'));
  r.low = false;
  perception.setTargetTag(player);
  enterState('EMERGE');
  log('info', `encounter begin mode=${mode} variant=${variant} target=${player ? player.name : 'none'}`);
  return true;
}

/** Idempotent cleanup. reason: vanished|defeated|master_off|reset|unloaded|invalid|peaceful|... */
export function endEncounter(reason = 'end', opts = {}) {
  const r = S.record; const e = S.active;
  timers.cancelTag('encounter'); timers.cancelTag('omen');
  omens.clearAll();
  markers.clear();
  if (isValid(e)) navigation.sweepWaypoints(safe(() => e.dimension, undefined));
  S.waypoints.length = 0;
  perception.clearTargetTags();
  audio.stopAll();
  S.lures.length = 0;
  if (r && r.target) memory.decay(r.target);
  if (isValid(e) && reason !== 'unloaded') safe(() => e.remove());
  if (reason !== 'unloaded') reservation.release();
  S.active = undefined; S.record = undefined;
  if (reason !== 'unloaded') {
    const mult = reason === 'defeated' ? 1.5 : reason === 'no_spawn' ? 0.5 : 1;
    S.nextNaturalCheck = S.tick + Math.round(T(rand(cfg('cooldownMinSeconds'), cfg('cooldownMaxSeconds'))) * mult);
  }
  log('info', 'encounter end: ' + reason);
}
export function masterOff() {
  if (S.record || S.active) endEncounter('master_off');
  else { timers.cancelTag('encounter'); timers.cancelTag('omen'); omens.clearAll(); markers.clear(); perception.clearTargetTags(); audio.stopAll(); reservation.release(); }
  S.nextNaturalCheck = S.tick + T(cfg('graceSeconds'));
}
export function masterOn() { S.naturalGraceUntil = S.tick + T(cfg('graceSeconds')); S.nextNaturalCheck = S.tick; }
export function resetCooldown() { S.nextNaturalCheck = S.tick; S.naturalGraceUntil = S.tick; }
export function forceVanish() { if (S.record && S.record.state !== 'RETREAT' && S.record.state !== 'OMENS') { S.record.retreatPause.used = true; enterState('RETREAT', { vanishNow: true }); } else if (S.record) endEncounter('reset'); }

/** Called when the reserved creature became invalid (unloaded chunk). Keeps the reservation; drops the live record. */
export function onUnloaded() {
  if (!S.record || S.record.state === 'OMENS') return;
  reservation.markUnloaded();
  endEncounter('unloaded');
}

// ------------------------------------------------------------------ spawning
function trySpawn(player, mode, testing) {
  const height = 3;
  const q = scan.findSpawnPoint(player, { min: cfg('minSpawnDistance'), max: cfg('maxSpawnDistance'), height, testing });
  if (!q) { lastSpawnFailure = 'no_safe_location'; return undefined; }
  const e = safe(() => player.dimension.spawnEntity(IDS.ENTITY, q), undefined);
  if (!e) { lastSpawnFailure = 'spawn_failed'; return undefined; }
  lastSpawnFailure = '';
  return e;
}
/** Operator test spawn near the player (ignores natural gates but not master/peaceful/reservation). */
export function spawnTest(player) {
  if (!gates.masterEnabled()) return 'Master is OFF.';
  if (!gates.worldAllowsEncounters()) return 'Difficulty is Peaceful.';
  if (S.preview) return 'A preview is running; stop it first.';
  if (reservation.current()) return text.gateSentence(S.active && isValid(S.active) ? 'reserved_active' : 'reserved_unloaded', S.record ? S.record.state : '');
  if (S.record && S.record.state === 'OMENS') { omens.end(S.record); S.record = undefined; }
  const e = trySpawn(player, 'test', true);
  if (!e) return text.gateSentence('no_safe_location');
  const tgt = gates.playerEligible(player, { ignoreJoinProtection: true }) ? player : perception.chooseTarget(e, 32);
  const ok = beginEncounter(e, 'test', tgt);
  if (!ok) return 'Spawn failed.';
  return tgt ? `Grinshackle spawned (variant ${S.record.variant}). Target: ${tgt.name}.` : 'Grinshackle spawned, but no Survival/Adventure target is eligible — it will only linger and leave.';
}
/** Every 100 ticks. */
export function naturalSpawnTick() {
  if (S.record || S.preview) return;
  const g = gates.spawnGate();
  if (!g.ok) return;
  S.nextNaturalCheck = S.tick + 200; // retry cadence while the gate stays open
  if (!chance(cfg('spawnChance'))) return;
  const player = pick(g.players);
  const variant = chooseVariant();
  const r = newRecord(0, 'natural', variant, player.id, S.tick);
  r.state = 'OMENS'; r.stateEntered = S.tick; r.omenBudgetEnd = S.tick + T(rand(15, 60)); r.omensPlayed = 0; r.omensEndWithoutSpawn = chance(0.35);
  r.sightingOnly = variant === 'watcher' && chance(0.5);
  S.record = r;
  if (chance(0.35)) r.omenBudgetEnd = S.tick + 20; // some encounters emerge without a warning
  log('info', `omens begin variant=${variant} target=${player.name}`);
}
function omensTick() {
  const r = S.record; const p = target();
  if (!p || !gates.playerEligible(p) || !gates.habitatOK(p) || !gates.worldAllowsEncounters()) { omens.end(r); S.record = undefined; S.nextNaturalCheck = S.tick + 400; return; }
  if (omens.tick(r, p)) return;
  if (S.tick < r.omenBudgetEnd) {
    if (r.omensPlayed < 2 && S.tick >= r.omens.nextAllowed) { const k = omens.pick(r, p); if (k && omens.start(k, r, p)) { r.omensPlayed++; r.omens.lastKind = k; r.omens.nextAllowed = S.tick + T(8); } }
    return;
  }
  omens.end(r);
  if (r.omensEndWithoutSpawn) { S.record = undefined; S.nextNaturalCheck = S.tick + T(rand(90, 150)); log('info', 'omens ended without a spawn'); return; }
  r.spawnTries = (r.spawnTries || 0) + 1;
  const e = trySpawn(p, 'natural', false);
  if (!e) { if (r.spawnTries >= 3) { S.record = undefined; S.nextNaturalCheck = S.tick + T(rand(60, 120)); log('info', 'no safe location; encounter skipped'); } else r.omenBudgetEnd = S.tick + 100; return; }
  const variant = r.variant;
  S.record = undefined;
  beginEncounter(e, 'natural', p, { variant });
}

// ------------------------------------------------------------------ states
function enterState(next, opts = {}) {
  const r = S.record; const e = entity(); const p = target();
  if (!r) return;
  const prev = r.state;
  r.state = next; r.stateEntered = S.tick; r.since = S.tick;
  navigation.resetProgress();
  if (next !== 'HUNT') { r.fragmentsEnabled = false; }
  if (S.debug) log('debug', `${prev} -> ${next}`);
  switch (next) {
    case 'EMERGE':
      navigation.setMotion('still'); navigation.targetNone(); animation.setPose('emerge'); animation.clearAction(); animation.setOverlay(0); animation.setTrack(false);
      if (p) navigation.snapFace(p.location);
      audio.fxAt(SOUNDS.ink, e, { volume: 0.7, radius: 20 }); particles(PARTICLES.ink_puff, safe(() => e.location, undefined), 1);
      break;
    case 'OBSERVE':
      navigation.setMotion('still'); navigation.targetPlayer(p); animation.setTrack(true);
      animation.setPose(p && perception.lineOfSight(e, p) ? 'stare' : 'idle');
      r.corner.active = false; r.corner.watchedTicks = 0; r.corner.hesitateUntil = 0; r.observeUntil = S.tick + T(r.sightingOnly ? rand(5, 12) : rand(10, 20));
      if (cfg('cornerWatch') && p && chance(r.variant === 'watcher' ? 0.9 : 0.5)) {
        const cv = scan.findCoverPoint(e.dimension, e.location, safe(() => p.getHeadLocation(), p.location), { min: 6, max: 14 });
        if (cv) { r.corner.active = true; r.corner.coverPoint = cv.cover; r.corner.revealPoint = cv.reveal; r.corner.phase = 'to_cover'; navigation.targetWaypoint(cv.cover); navigation.setMotion('walk'); animation.setPose('walk'); animation.setTrack(false); }
      }
      if (p && chance(0.3)) text.line(p, 'watched');
      break;
    case 'INVESTIGATE':
      navigation.setMotion('walk'); animation.setPose('walk'); animation.setTrack(false); animation.setOverlay(r.lastLink.active ? 1 : 0);
      if (opts.point) { r.investigatePoint = opts.point; navigation.targetWaypoint(opts.point); }
      break;
    case 'STALK':
      r.stalkStart = S.tick; navigation.targetPlayer(p); animation.setTrack(false);
      if (r.lastLink.active) { navigation.setMotion('creep'); animation.setOverlay(1); animation.setPose('stalk'); if (p) text.line(p, 'silent'); }
      else { navigation.setMotion('stalk'); animation.setOverlay(0); animation.setPose('stalk'); }
      if (p) audio.music(p, r.tension > 30 ? 'stalk' : null);
      break;
    case 'FLANK':
      navigation.setMotion('walk'); animation.setPose('walk'); animation.setTrack(false); animation.setOverlay(0);
      r.flank.active = true; r.flank.since = S.tick; r.flank.point = opts.point; r.flank.arrived = false; navigation.targetWaypoint(opts.point);
      break;
    case 'WARNING': {
      navigation.setMotion('still'); navigation.targetPlayer(p); animation.setTrack(false);
      if (p) navigation.snapFace(p.location);
      let ticks;
      if (r.lastLink.active) { r.lastLink.active = false; r.lastLink.releasedAt = S.tick; animation.setOverlay(0); audio.fxAt(SOUNDS.click_release, e, { volume: 0.7, radius: 16 }); if (p) text.cue(p, 'release'); ticks = animation.setAction('alert'); audio.fxAt(SOUNDS.alert, e, { volume: 0.8, radius: 20 }); }
      else if (!r.warned && chance(0.25)) { ticks = animation.setAction('roar'); audio.fxAt(SOUNDS.roar, e, { volume: 0.85, radius: 32 }); if (p) text.cue(p, 'roar'); }
      else { ticks = animation.setAction('chain_whip'); audio.fxAt(SOUNDS.warning, e, { volume: 0.9, radius: 24 }); if (p) text.cue(p, 'warning'); }
      r.warned = true; r.warningUntil = S.tick + (ticks || 30);
      if (p) audio.music(p, 'stalk');
      break;
    }
    case 'HUNT':
      if (!r.huntStart) r.huntStart = S.tick;
      navigation.targetPlayer(p); animation.setOverlay(0); animation.setTrack(false);
      navigation.setMotion(motionFor(r.low ? 'crawl' : 'hunt')); animation.setPose(r.low ? 'crawl' : 'run');
      r.fragmentsEnabled = !!cfg('chainFragments');
      if (p) audio.music(p, 'hunt');
      break;
    case 'SEARCH':
      navigation.setMotion('walk'); animation.setPose('walk'); animation.setOverlay(0); animation.setTrack(false);
      r.searchPoint = opts.point || (p ? { ...p.location } : undefined);
      if (r.searchPoint) navigation.targetWaypoint(r.searchPoint); else navigation.targetNone();
      if (p) { audio.music(p, 'stalk'); text.cue(p, 'lost'); }
      break;
    case 'RETREAT':
      markers.clear(); r.fragmentsEnabled = false; attacks.cancel('retreat'); animation.setOverlay(0); animation.setTrack(false);
      if (p) audio.music(p, null);
      if (!opts.vanishNow && cfg('unfinishedRetreat') && !r.retreatPause.used && huntBudgetLeft() >= T(12) && r.warned && p && chance(0.5)) {
        const cv = scan.findCoverPoint(e.dimension, e.location, safe(() => p.getHeadLocation(), p.location), { min: 6, max: 14 });
        if (cv) { r.retreatPause.used = true; r.retreatPause.active = true; r.retreatPause.phase = 'to_cover'; r.retreatPause.point = cv.cover; navigation.targetWaypoint(cv.cover); navigation.setMotion('walk'); animation.setPose('walk'); break; }
      }
      r.retreatPause.active = false;
      navigation.targetNone(); navigation.setMotion('retreat'); animation.setPose('run');
      if (opts.vanishNow) r.vanishAt = S.tick + 1; else r.vanishAt = S.tick + T(5);
      break;
    case 'VANISH':
      navigation.setMotion('still'); navigation.targetNone(); animation.clearAction(); animation.setPose('vanish'); animation.setOverlay(0); animation.setTrack(false);
      audio.fxAt(SOUNDS.ink, e, { volume: 0.7, radius: 20 }); particles(PARTICLES.ink_puff, safe(() => e.location, undefined), 1);
      if (p) { text.cue(p, 'gone'); if (chance(0.4)) text.line(p, 'gone'); }
      r.vanishDone = S.tick + CLIPS.vanish.ticks;
      break;
    case 'COLLAPSE':
      navigation.setMotion('still'); navigation.targetNone(); attacks.cancel('collapse'); animation.clearAction(); animation.setOverlay(0); animation.setTrack(false);
      animation.setPose('collapse'); markers.clear(); r.fragmentsEnabled = false;
      audio.fxAt(SOUNDS.defeat, e, { volume: 1.0, radius: 28 });
      if (p) audio.music(p, null);
      r.collapseDone = S.tick + CLIPS.collapse.ticks;
      break;
    default: break;
  }
}

function tensionUpdate(p, watched) {
  const r = S.record; const mult = r.state === 'OBSERVE' ? 0.5 : 1;
  r.tension = clamp(r.tension + perception.tensionDelta(entity(), p, r, watched) * mult, 0, 100);
}
function learnFromTarget(p) {
  const r = S.record; if (!p || S.tick % 20 !== 0) return;
  if (safe(() => p.isSprinting, false)) memory.observe(p.id, 'sprint', 1);
  if (safe(() => p.isSneaking, false)) memory.observe(p.id, 'sneak', 1);
  const h = perception.movementHeading(p.id, 20);
  if (h !== undefined && perception.isFleeing(entity(), p, 20)) memory.observe(p.id, 'escape', 1, h);
  if (scan.openness(p.dimension, p.location) <= 4 && h !== undefined) memory.observe(p.id, 'tight', 1);
}

// ------------------------------------------------------------------ per-tick brain
export function tick() {
  const r = S.record;
  if (!r) return;
  if (r.state === 'OMENS') { if (S.tick % 5 === 0) omensTick(); return; }
  const e = entity();
  if (!isValid(e)) { onUnloaded(); return; }
  if (!reservation.validate(e)) { log('warn', 'active creature failed reservation validation; removing'); endEncounter('invalid'); return; }
  if (!gates.masterEnabled()) { endEncounter('master_off'); return; }
  if (!gates.worldAllowsEncounters()) { endEncounter('peaceful'); return; }
  reservation.touch(e);
  animation.syncFromRecord(e);
  ambientEffects();
  const p = target();

  // terminal states first
  if (r.state === 'COLLAPSE') { if (S.tick >= r.collapseDone) finishCollapse(); return; }
  if (r.state === 'VANISH') { if (S.tick % 5 === 0) particles(PARTICLES.ink_puff, e.location, 1); if (S.tick >= r.vanishDone) endEncounter('vanished'); return; }
  if (r.state === 'EMERGE') { if (p) navigation.faceToward(p.location, 8); if (age() >= CLIPS.emerge.ticks) enterState(r.variant === 'watcher' || r.variant === 'last_link' ? 'OBSERVE' : 'STALK'); return; }

  // target validity (Creative/Spectator/Peaceful/death/dimension/disconnect)
  if (!eligibleTarget(p)) {
    const alt = perception.chooseTarget(e, 24);
    if (alt) { r.target = alt.id; perception.setTargetTag(alt); if (r.state === 'HUNT' || r.state === 'STALK') navigation.targetPlayer(alt); }
    else if (r.state !== 'RETREAT') { r.target = undefined; perception.clearTargetTags(); attacks.cancel('target_lost'); enterState('RETREAT', { vanishNow: r.mode === 'egg' && age() > 200 }); return; }
  }
  if (p) { perception.sampleMovement(p); learnFromTarget(p); if (S.tick % 20 === 0 && cfg('thresholds')) memory.notePosition(r, e, p); }
  const watched = p && S.tick % 5 === 0 ? perception.isWatched(e, p) : false;
  if (watched) { r.staredTotal += 5; memory.observe(p.id, 'stare', 1); }

  // hurt flinch restore
  if (r.flinchUntil && S.tick >= r.flinchUntil) { r.flinchUntil = 0; if (!r.pendingAttack && r.state === 'HUNT') navigation.setMotion(motionFor(r.low ? 'crawl' : 'hunt')); else if (!r.pendingAttack && r.state === 'STALK') navigation.setMotion(r.lastLink.active ? 'creep' : 'stalk'); }

  // active one-shot that blocks the brain
  if (r.pendingAttack) { const res = attacks.update(e); if (res === 'done' && r.state === 'HUNT') { navigation.setMotion(motionFor(r.low ? 'crawl' : 'hunt')); } return; }
  if (r.snapUntil) { if (S.tick >= r.snapUntil) { r.snapUntil = 0; r.enragedUntil = S.tick + ENRAGE_TICKS; if (p) text.cue(p, 'snap'); navigation.setMotion(motionFor(r.low ? 'crawl' : 'hunt')); } return; }
  if (r.state === 'WARNING') { if (p) navigation.faceToward(p.location, 4); if (S.tick >= r.warningUntil) { if (p && eligibleTarget(p) && gates.worldAllowsEncounters()) enterState('HUNT'); else enterState('RETREAT'); } return; }

  if (S.tick % 5 !== 0) { if (r.state === 'HUNT') huntFast(e, p); return; }
  if (p) tensionUpdate(p, watched);
  navigation.trackProgress(e);
  navigation.updateLight(e);

  switch (r.state) {
    case 'OBSERVE': observeTick(e, p, watched); break;
    case 'INVESTIGATE': investigateTick(e, p); break;
    case 'STALK': stalkTick(e, p, watched); break;
    case 'FLANK': flankTick(e, p); break;
    case 'HUNT': huntTick(e, p); break;
    case 'SEARCH': searchTick(e, p); break;
    case 'RETREAT': retreatTick(e, p); break;
    default: break;
  }
}

function lureCheck(r) { const l = r.lureRedirect; if (l && S.tick <= l.until && l.strength >= 0.6) { r.lureRedirect = undefined; return l.point; } return undefined; }
function loudCheck(e) { const n = perception.loudestRecent(e.location, 24, 40); return n && n.loudness >= 2 ? n.pos : undefined; }

function observeTick(e, p, watched) {
  const r = S.record; if (!p) { enterState('RETREAT', { vanishNow: true }); return; }
  const lure = lureCheck(r); if (lure) { enterState('INVESTIGATE', { point: lure }); return; }
  const loud = loudCheck(e); if (loud && chance(0.6)) { enterState('INVESTIGATE', { point: loud }); return; }
  if (r.tension >= 100) { enterState('WARNING'); return; }
  const c = r.corner;
  if (c.active) {
    if (c.phase === 'to_cover') { if (navigation.waypointReached(c.coverPoint, e) || navigation.stalled(160)) { c.phase = 'peek'; navigation.targetWaypoint(c.revealPoint); navigation.setMotion('walk'); } return; }
    if (c.phase === 'peek') { if (navigation.waypointReached(c.revealPoint, e, 1.0) || navigation.stalled(100)) { c.phase = 'watch'; navigation.setMotion('still'); navigation.targetPlayer(p); animation.setPose('stare'); animation.setTrack(true); r.observeUntil = S.tick + T(r.sightingOnly ? rand(5, 10) : rand(10, 18)); } return; }
    if (c.phase === 'relocate') { if (navigation.waypointReached(c.coverPoint, e) || navigation.stalled(160)) { c.phase = 'peek'; navigation.targetWaypoint(c.revealPoint); } return; }
  }
  // watching phase (corner or plain)
  if (watched) {
    navigation.facePlayerGradual(p);               // head first (track overlay), body follows slowly
    c.watchedTicks += 5;
    if (!c.hesitateUntil) c.hesitateUntil = S.tick + T(rand(2, 4));
    if (c.watchedTicks >= 120 && !c.tightened) { c.tightened = true; animation.setOverlay(2); animation.setAction('twitch'); }
    if (c.watchedTicks >= 220) { c.tightened = false; c.watchedTicks = 0; animation.setOverlay(0); r.tension = clamp(r.tension + 15, 0, 100); if (chance(0.5)) { enterState('STALK'); return; } }
  } else {
    if (S.tick % 40 === 0 && chance(0.25)) animation.setAction('twitch');
    if (c.active && c.tightened && c.moves < 2 && chance(0.5)) {
      const cv = scan.findCoverPoint(e.dimension, e.location, safe(() => p.getHeadLocation(), p.location), { min: 5, max: 12 });
      if (cv) { c.moves++; c.tightened = false; c.watchedTicks = 0; animation.setOverlay(0); animation.setTrack(false); c.coverPoint = cv.cover; c.revealPoint = cv.reveal; c.phase = 'relocate'; navigation.targetWaypoint(cv.cover); navigation.setMotion('walk'); animation.setPose('walk'); return; }
    }
  }
  audio.breath(e); if (S.tick % 60 === 0 && chance(0.4)) audio.wristClick(e);
  if (S.tick >= r.observeUntil) {
    if (r.sightingOnly) { enterState('RETREAT', { vanishNow: true }); return; }
    enterState('STALK');
  }
  if (dist(e.location, p.location) > 40) enterState('RETREAT');
}

function investigateTick(e, p) {
  const r = S.record; if (!p) { enterState('RETREAT', { vanishNow: true }); return; }
  const lure = lureCheck(r); if (lure) { r.investigatePoint = lure; navigation.targetWaypoint(lure); }
  const loud = loudCheck(e); if (loud && (!r.investigatePoint || dist(loud, r.investigatePoint) > 4)) { r.investigatePoint = loud; navigation.targetWaypoint(loud); }
  if (p && dist(e.location, p.location) < 10) animation.setPose('stalk'); else animation.setPose('walk');
  audio.chainDrag(e, moving(), r.lastLink.active);
  if (!r.investigatePoint || navigation.waypointReached(r.investigatePoint, e) || navigation.stalled(160) || age() > T(20)) { enterState(r.tension > 50 ? 'STALK' : 'OBSERVE'); return; }
  if (r.tension >= 100) enterState('WARNING');
}

function stalkTick(e, p, watched) {
  const r = S.record; if (!p) { enterState('RETREAT', { vanishNow: true }); return; }
  const d = dist(e.location, p.location);
  if (d > 40 || !gates.habitatOK(p) && (r.outsideTicks += 5) >= 100) { enterState('RETREAT'); return; }
  if (gates.habitatOK(p)) r.outsideTicks = 0;
  const lure = lureCheck(r); if (lure && r.tension < 70) { enterState('INVESTIGATE', { point: lure }); return; }
  // light threshold: hesitate at the edge, inspect, then withdraw when it cannot approach fairly
  const lit = navigation.hesitateAtLight(e);
  if (lit === 'hesitate') { navigation.setMotion('still'); animation.setPose('stare'); if (r.lit.until - S.tick > 100 && p) text.cue(p, 'light'); navigation.facePlayerGradual(p); if (S.tick % 40 === 0) particles(PARTICLES.lit_edge, e.location, 1); return; }
  if (lit === 'withdraw') { r.lit.hesitating = false; if (chance(0.5)) enterState('SEARCH', { point: scan.walkableNear(e.dimension, e.location, 8, { hiddenFrom: safe(() => p.getHeadLocation(), p.location) }) }); else enterState('RETREAT'); return; }
  navigation.setMotion(r.lastLink.active ? 'creep' : 'stalk'); animation.setPose('stalk');
  if (r.lastLink.active) { if (moving() && S.tick % 30 === 0) audio.fx(SOUNDS.step(scan.materialAt(e.dimension, e.location)), e.location, { volume: 0.25, radius: 8, dimensionId: e.dimension.id }); if (S.tick % 80 === 0 && chance(0.5)) audio.wristClick(e); }
  else audio.chainDrag(e, moving(), false);
  if (d < 8) audio.breath(e);
  if (watched && d < 12 && S.tick % 40 === 0 && chance(0.2)) animation.setAction('twitch');
  if (p) audio.music(p, r.tension > 30 ? 'stalk' : null);
  const elapsed = S.tick - r.stalkStart;
  if (r.tension >= 100 || d < 3.0) { enterState('WARNING'); return; }
  if (cfg('thresholds') && r.variant === 'ambusher' && !r.flank.done) {
    const th = memory.repeatedThreshold(r);
    if (th) { const pt = scan.walkableNear(e.dimension, th, 5, { hiddenFrom: safe(() => p.getHeadLocation(), p.location) }); if (pt) { r.flank.done = true; enterState('FLANK', { point: pt }); return; } }
  }
  if (elapsed >= r.stalkLength) {
    if (r.variant === 'feint' && !r.feintDone && d <= 6 && d >= 2.5 && perception.lineOfSight(e, p)) { r.feintDone = true; navigation.setMotion('still'); navigation.snapFace(p.location); animation.setAction('lunge'); audio.fxAt(SOUNDS.strike, e, { volume: 0.6, radius: 16 }); r.stalkStart = S.tick; r.stalkLength = T(6); return; }
    if (r.tension >= 45) enterState('WARNING'); else enterState('RETREAT');
  }
}

function flankTick(e, p) {
  const r = S.record; if (!p) { enterState('RETREAT', { vanishNow: true }); return; }
  if (!r.flank.arrived) {
    if (navigation.waypointReached(r.flank.point, e)) { r.flank.arrived = true; navigation.setMotion('still'); navigation.targetPlayer(p); animation.setPose('crouch'); r.flank.waitUntil = S.tick + T(15); }
    else if (navigation.stalled(160)) { enterState('STALK'); }
    return;
  }
  navigation.facePlayerGradual(p);
  if (dist(e.location, p.location) < 6) { enterState('WARNING'); return; }
  if (S.tick >= r.flank.waitUntil) enterState('STALK');
}

function huntFast(e, p) {
  // runs on the ticks between the 5-tick brain: attack starts need tick precision
  const r = S.record; if (!p || !eligibleTarget(p)) return;
  if (r.state !== 'HUNT') return;
  const kind = attacks.chooseKind(p);
  if (attacks.canStart(kind, e, p)) attacks.start(kind, e, p);
}
function huntTick(e, p) {
  const r = S.record; if (!p) { enterState('SEARCH'); return; }
  const d = dist(e.location, p.location);
  if (huntBudgetLeft() <= 0) { enterState('RETREAT'); return; }
  if (d > 42) { enterState('SEARCH'); return; }
  // posture through real two-block passages
  if (cfg('crawling')) { if (navigation.crampedAhead(e)) navigation.setPosture(true); else if (r.low && scan.standRoom(e.dimension, e.location, 3)) navigation.setPosture(false); }
  else if (r.low) navigation.setPosture(false);
  navigation.setMotion(motionFor(r.low ? 'crawl' : 'hunt')); animation.setPose(r.low ? 'crawl' : 'run');
  audio.chainDrag(e, moving(), false);
  if (moving()) markers.drop(e, p);
  if (markers.update(e, p) && r.snapPending) { r.snapPending = false; r.snapCooldownUntil = S.tick + SNAP_COOLDOWN; navigation.setMotion('still'); const t = animation.setAction('chain_snap'); r.snapUntil = S.tick + t; audio.fxAt(SOUNDS.chain_snap, e, { volume: 0.9, radius: 22 }); particles(PARTICLES.snap_sparks, { x: e.location.x, y: e.location.y + 1.2, z: e.location.z }, 1); text.line(p, 'steps'); return; }
  // lit refuge: hesitate at the threshold, then give up on this approach
  if (cfg('lightAvoidance') && S.tick % 20 === 0) { const lp = scan.lightApprox(p.dimension, p.location, 4, cfg('lightThreshold')); r.targetLit = lp.strong; }
  if (r.targetLit && d < 6) { const lit = navigation.hesitateAtLight(e); if (r.lit.strong) { if (lit === 'hesitate') { navigation.setMotion('still'); animation.setPose('run'); navigation.facePlayerGradual(p); text.cue(p, 'light'); return; } if (lit === 'withdraw') { enterState('SEARCH', { point: scan.walkableNear(e.dimension, e.location, 8, { hiddenFrom: safe(() => p.getHeadLocation(), p.location) }) }); return; } } }
  if (!perception.lineOfSight(e, p)) { r.noLosTicks = (r.noLosTicks || 0) + 5; } else r.noLosTicks = 0;
  if (navigation.stalled(160) || r.noLosTicks >= 120) { enterState('SEARCH'); return; }
  const kind = attacks.chooseKind(p);
  if (attacks.canStart(kind, e, p)) attacks.start(kind, e, p);
}
function searchTick(e, p) {
  const r = S.record;
  const lure = lureCheck(r); if (lure) { r.searchPoint = lure; navigation.targetWaypoint(lure); }
  const loud = loudCheck(e); if (loud) { r.searchPoint = loud; navigation.targetWaypoint(loud); }
  audio.chainDrag(e, moving(), false);
  if (p && eligibleTarget(p) && perception.lineOfSight(e, p) && dist(e.location, p.location) < 24 && huntBudgetLeft() > T(5)) { enterState('HUNT'); return; }
  if (r.searchPoint && navigation.waypointReached(r.searchPoint, e)) { navigation.setMotion('still'); animation.setPose('stare'); if (p) navigation.facePlayerGradual(p); }
  if (age() >= T(12) || navigation.stalled(200)) enterState('RETREAT');
}
function retreatTick(e, p) {
  const r = S.record; const rp = r.retreatPause;
  if (rp.active) {
    if (rp.phase === 'to_cover') { if (navigation.waypointReached(rp.point, e) || navigation.stalled(160)) { rp.phase = 'listen'; rp.until = S.tick + T(rand(6, 10)); navigation.setMotion('still'); navigation.targetNone(); animation.setPose('crouch'); } return; }
    if (rp.phase === 'listen') {
      const n = p ? perception.loudestRecent(e.location, 20, 40) : undefined;
      if (n && n.loudness >= 1.5 && p && eligibleTarget(p) && huntBudgetLeft() > T(5)) { rp.active = false; animation.setPose('idle'); enterState('WARNING'); return; }
      if (S.tick >= rp.until) { rp.active = false; enterState('VANISH'); }
      return;
    }
  }
  if (S.tick >= r.vanishAt || (p && dist(e.location, p.location) > 32) || !p) enterState('VANISH');
}

// ------------------------------------------------------------------ events
export function onHurt(ev) {
  const r = S.record; const e = entity(); if (!r || !isValid(e) || ev.hurtEntity.id !== e.id) return;
  if (r.state === 'COLLAPSE' || r.state === 'VANISH') return;
  const dmg = Math.max(0, ev.damage || 0);
  r.virtualHealth = (r.virtualHealth ?? cfg('health')) - dmg;
  safe(() => { const h = e.getComponent('minecraft:health'); if (h && h.currentValue < REAL_HEALTH_POOL * 0.5) h.resetToMaxValue(); });
  const attacker = safe(() => ev.damageSource.damagingEntity, undefined);
  if (attacker && attacker.typeId === 'minecraft:player') { memory.observe(attacker.id, 'rush', dist(attacker.location, e.location) < 2.5 ? 1 : 0); r.tension = clamp(r.tension + (r.state === 'HUNT' ? 5 : 25), 0, 100); if (!r.target) { r.target = attacker.id; perception.setTargetTag(attacker); } }
  if (r.virtualHealth <= 0) { enterState('COLLAPSE'); return; }
  if (S.tick >= r.hurtCooldownUntil && !r.pendingAttack && !r.snapUntil && r.state !== 'EMERGE') {
    r.hurtCooldownUntil = S.tick + HURT_COOLDOWN;
    const t = animation.setAction('hurt'); audio.fxAt(SOUNDS.hurt, e, { volume: 0.7, radius: 16 });
    if (r.state === 'HUNT' || r.state === 'STALK') { navigation.setMotion('still'); r.flinchUntil = S.tick + t; }
  }
  if ((r.state === 'OBSERVE' || r.state === 'STALK' || r.state === 'INVESTIGATE') && r.tension >= 60 && S.tick - r.stateEntered > 40) enterState('WARNING');
}
function finishCollapse() {
  const r = S.record; const e = entity(); if (!isValid(e)) { endEncounter('defeated'); return; }
  const loc = e.location; const dim = e.dimension;
  particles(PARTICLES.collapse_chains, { x: loc.x, y: loc.y + 1, z: loc.z }, 1);
  audio.fx(SOUNDS.collapse_chains, loc, { volume: 0.9, radius: 24, dimensionId: dim.id });
  dropLoot(dim, loc);
  endEncounter('defeated');
}
function dropLoot(dim, loc) {
  /** @type {Array<[string, number]>} */
  const drops = [[IDS.ITEM_CHAIN, randInt(2, 4)], [IDS.ITEM_SCRAP, randInt(1, 3)]];
  if (chance(0.3)) drops.push([IDS.ITEM_FANG, 1]);
  for (const [id, n] of drops) safe(() => dim.spawnItem(new ItemStack(id, n), { x: loc.x, y: loc.y + 0.5, z: loc.z }));
  for (let i = 0; i < 4; i++) safe(() => dim.spawnEntity('minecraft:xp_orb', { x: loc.x + rand(-0.5, 0.5), y: loc.y + 0.5, z: loc.z + rand(-0.5, 0.5) }));
}
/** Real death (e.g. /kill): cleanup only — the vanilla loot table handles drops in that case. */
export function onDied(ev) {
  const e = entity(); if (!isValid(e) && !(S.reservation && ev.deadEntity.id === S.reservation.entityId)) return;
  if (ev.deadEntity.id !== (S.reservation && S.reservation.entityId)) return;
  endEncounter('defeated');
}
export function onTargetLost(playerId) { const r = S.record; if (r && r.target === playerId) { r.target = undefined; perception.clearTargetTags(); attacks.cancel('target_lost'); } }
export function onSnapTriggered() { const r = S.record; if (r) r.snapPending = true; }

// ------------------------------------------------------------------ status
export function statusLine() {
  const c = S.config || {};
  const g = gates.spawnGate();
  const r = S.record;
  const lines = [];
  lines.push(`Master ${c.master ? 'ON' : 'OFF'} · natural ${c.naturalSpawning ? 'ON' : 'OFF'} · preset ${c.preset} · learning ${c.learning ? 'ON' : 'OFF'} · ${audio.isMuted() ? 'muted' : 'sounds on'}`);
  lines.push('Gate: ' + text.gateSentence(g.reason, g.detail) + (lastSpawnFailure ? ` (last attempt: ${text.gateSentence(lastSpawnFailure)})` : ''));
  if (r) {
    const p = target();
    lines.push(`Encounter: ${r.state} (${r.variant}, ${r.mode}) · tension ${Math.round(r.tension)} · target ${p ? p.name : 'none'} · hunt budget ${Math.max(0, Math.round(huntBudgetLeft() / 20))} s · health ${Math.round(r.virtualHealth ?? 0)}/${c.health}`);
    lines.push(`Markers ${markers.count()} · pending timers ${timers.pendingCount()} · crawl ${r.low ? 'yes' : 'no'} · enraged ${S.tick < r.enragedUntil ? 'yes' : 'no'} · thresholds: ${memory.describeThresholds(r)}`);
  } else if (S.preview) lines.push('Preview running.');
  else if (S.reservation) lines.push(`Reserved generation ${S.reservation.generation} (${S.reservation.mode}) at ${Math.round(S.reservation.x)},${Math.round(S.reservation.y)},${Math.round(S.reservation.z)}${S.reservation.unloadedSinceTick ? ' — unloaded' : ''}`);
  else lines.push('No encounter.');
  return lines.join('\n');
}
