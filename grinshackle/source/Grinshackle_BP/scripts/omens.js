// Omens: the sounds that come before (or instead of) an encounter — BORROWED FOOTSTEPS, ANSWERING THE MINE and a distant chain drag.
// Audio and text only: nothing here spawns, damages, teleports or touches a block. One omen runs at a time (S.omen); every delayed
// step is scheduled through timers.js under the tag 'omen' and re-checks the master gate and the player when it fires. The mine
// listener (S.mine) is fed by main.js through onBlockBreak / onLoudEvent and is the only world-level state this module keeps.
import { world } from '@minecraft/server';
import { SOUNDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid, rand, randInt, chance, dist, flatDist, norm, sub, clamp, bounded, yawToDir, pick as pickOne } from './util.js';
import { schedule, cancelTag } from './timers.js';
import { get } from './config.js';
import { masterEnabled } from './gates.js';
import { walkableNear, materialAt } from './world_scan.js';
import * as perception from './perception.js';
import * as audio from './audio.js';
import { cue, line } from './text.js';

const KINDS = ['borrowed_footsteps', 'answering_mine', 'distant_drag'];
/** @type {Record<string, string>} */
const TOGGLE = { borrowed_footsteps: 'omenFootsteps', answering_mine: 'omenMine', distant_drag: 'omenDrag' };
/** @type {Record<string, string>} */
const USED = { borrowed_footsteps: 'footstepsUsed', answering_mine: 'mineUsed', distant_drag: 'dragUsed' };
/** @type {Record<string, number>} */
const COOLDOWN = { borrowed_footsteps: 1800, answering_mine: 2400, distant_drag: 1200 }; // 90 s / 120 s / 60 s
/** @type {Record<string, number>} */
const LIFETIME = { borrowed_footsteps: 240, answering_mine: 300, distant_drag: 120 };    // cap on the silent phase (ticks); extended once sound is scheduled
const OMEN_GAP = 160;   // at least 8 s of silence between two omens
const RETRY_GAP = 400;  // shorter cooldown for an omen abandoned before it made any sound
const MINE = { min: 8, max: 40, reset: 100, ring: 8, fresh: 400, interrupt: 60, radius: 24 };
const TAG = 'omen';

/** kind -> tick until which that omen stays on cooldown. Module-level so it survives encounter records. */
/** @type {Record<string, number>} */
const cooldownUntil = { borrowed_footsteps: 0, answering_mine: 0, distant_drag: 0 };
let serial = 0;

// ---------------------------------------------------------------- helpers
function mine() {
  if (!S.mine) S.mine = { intervals: [], lastBreak: 0, playerId: undefined, interruptedUntil: 0 };
  return S.mine;
}
function creature() { return S.active && isValid(S.active) ? S.active : undefined; }
function dimOf(e) { return safe(() => e.dimension.id, ''); }
/** The omen's player while it is still valid and in the omen's dimension. */
function livePlayer() {
  const o = S.omen; if (!o) return undefined;
  return isValid(o.player) && dimOf(o.player) === o.dimensionId ? o.player : undefined;
}
/** Schedule one step of the running omen. Dropped if the omen ended; aborts the omen if a gate closed or the player is gone. */
function later(ticks, fn) {
  if (!S.omen) return false;
  const id = S.omen.id;
  const t = schedule(ticks, () => {
    if (!S.omen || S.omen.id !== id) return;
    if (!masterEnabled()) { abort(); return; }
    const p = livePlayer(); if (!p) { abort(); return; }
    fn(p);
  }, TAG);
  if (t < 0) abort();
  return t >= 0;
}
function randomDir() { const a = rand(0, Math.PI * 2); return { x: Math.cos(a), y: 0, z: Math.sin(a) }; }
/** Horizontal unit vector: toward the creature (when asked and present), else behind the player's movement, else behind their gaze. */
function awayDir(player, preferCreature) {
  const c = preferCreature ? creature() : undefined;
  if (c && flatDist(c.location, player.location) > 1) { const d = sub(c.location, player.location); d.y = 0; return norm(d); }
  const h = perception.movementHeading(player.id, 10) ?? perception.movementHeading(player.id, 40);
  if (h !== undefined) { const f = yawToDir(h); return { x: -f.x, y: 0, z: -f.z }; }
  const v = safe(() => player.getViewDirection(), { x: 0, y: 0, z: 1 });
  return Math.hypot(v.x, v.z) > 0.05 ? norm({ x: -v.x, y: 0, z: -v.z }) : { x: 0, y: 0, z: 1 };
}
/**
 * A floor point min..max blocks from the player, out of the player's line of sight: walkableNear is centred min..max along `dir`
 * (then once along a random direction). Falls back to an unverified point `fallback` blocks along `dir` — sound needs no floor.
 */
function hiddenPoint(player, min, max, dir, fallback) {
  const loc = player.location; const dim = player.dimension; const mid = (min + max) / 2;
  const head = safe(() => player.getHeadLocation(), { x: loc.x, y: loc.y + 1.6, z: loc.z });
  for (let i = 0; i < 2; i++) {
    const d = i === 0 ? dir : randomDir();
    const centre = { x: loc.x + d.x * mid, y: loc.y, z: loc.z + d.z * mid };
    const q = walkableNear(dim, centre, max - mid, { hiddenFrom: head, height: 2 });
    if (q && flatDist(q, loc) >= min - 1 && flatDist(q, loc) <= max + 1) return q;
  }
  return { x: Math.floor(loc.x + dir.x * fallback) + 0.5, y: Math.floor(loc.y), z: Math.floor(loc.z + dir.z * fallback) + 0.5 };
}
function play(id, point, volume, radius, pitch) {
  const o = S.omen; if (!o || !point) return;
  audio.fx(id, point, { volume, radius, pitch, dimensionId: o.dimensionId });
  o.sounded = true;
}
function footstepsDisrupted(player) {
  return !perception.playerStopped(player.id, 10) || perception.headingChanged(player.id, 60);
}

// ---------------------------------------------------------------- selection
function available(kind, player) {
  if (kind === 'borrowed_footsteps') return perception.stepCadence(player.id) !== undefined && perception.playerStopped(player.id, 10);
  if (kind === 'answering_mine') {
    const m = mine();
    return m.playerId === player.id && m.intervals.length >= 3 && S.tick >= m.interruptedUntil && S.tick - m.lastBreak <= MINE.fresh;
  }
  const c = creature();
  return !c || dist(c.location, player.location) >= 10;
}
/** Choose the next omen for `player`, or undefined. One at a time, ≥ 8 s apart, never the same kind twice in a row, per-kind cooldowns. */
export function pick(record, player) {
  if (S.omen || !masterEnabled() || !isValid(player)) return undefined;
  const om = record && record.omens;
  if (om && S.tick < (om.nextAllowed || 0)) return undefined;
  const candidates = KINDS.filter((k) => !!get(TOGGLE[k]) && S.tick >= cooldownUntil[k] && !(om && om.lastKind === k) && available(k, player));
  if (!candidates.length) return undefined;
  return candidates.includes('answering_mine') && chance(0.7) ? 'answering_mine' : pickOne(candidates);
}

// ---------------------------------------------------------------- lifecycle
/** Begin `kind` for `player`. Stamps the cooldown and record bookkeeping immediately. Returns false if nothing started. */
export function start(kind, record, player) {
  if (S.omen || !KINDS.includes(kind) || !masterEnabled() || !isValid(player)) return false;
  S.omen = { id: ++serial, kind, player, playerId: player.id, dimensionId: dimOf(player), record, started: S.tick,
    deadline: S.tick + LIFETIME[kind], phase: 'wait', sounded: false, pause: 0, point: undefined };
  cooldownUntil[kind] = S.tick + COOLDOWN[kind];
  if (record && record.omens) { record.omens.lastKind = kind; record.omens[USED[kind]] = (record.omens[USED[kind]] || 0) + 1; }
  if (kind === 'borrowed_footsteps') later(randInt(30, 60), footstepsBegin);
  else if (kind === 'answering_mine') { S.omen.pause = randInt(40, 80); S.omen.phase = 'listen'; }
  else dragBegin(player);
  return !!S.omen;
}
/** Movement samples feed stepCadence/playerStopped. In OMENS there is no creature yet, so fill the ring in if nobody sampled this tick. */
function sampleOnce(player) {
  const ring = perception.samplesOf(player.id);
  if (!ring.length || ring[ring.length - 1].tick !== S.tick) perception.sampleMovement(player);
}
/** Per tick (or per 5 ticks) from the director while in OMENS. Returns true while an omen is still running. */
export function tick(record, player) {
  if (isValid(player)) sampleOnce(player);
  const o = S.omen; if (!o) return false;
  if (!masterEnabled()) { abort(); return false; }
  if (!isValid(player) || player.id !== o.playerId || dimOf(player) !== o.dimensionId) { abort(); return false; }
  if (S.tick > o.deadline) { abort(); return false; }
  if (o.kind === 'borrowed_footsteps' && footstepsDisrupted(player)) { abort(); return false; }
  if (o.kind === 'answering_mine') mineTick(player);
  return !!S.omen;
}
/** Stop the running omen (if any), cancel its timers and start the 8 s pause before the next one. Idempotent. */
export function end(record) {
  cancelTag(TAG);
  const o = S.omen; S.omen = undefined;
  const r = record || (o && o.record);
  if (r && r.omens) r.omens.nextAllowed = Math.max(r.omens.nextAllowed || 0, S.tick + OMEN_GAP);
}
function finish() { end(S.omen && S.omen.record); }
/** Silent stop: the omen never reached the player, so let its kind retry sooner than the full cooldown. */
function abort() {
  const o = S.omen;
  if (o && !o.sounded) cooldownUntil[o.kind] = Math.min(cooldownUntil[o.kind], S.tick + RETRY_GAP);
  end(o && o.record);
}
export function active() { return S.omen ? S.omen.kind : undefined; }
/** Master OFF / full cleanup: drop the running omen and forget the listened rhythm. Cooldowns are kept. */
export function clearAll() {
  cancelTag(TAG); S.omen = undefined;
  const m = mine(); m.intervals.length = 0; m.playerId = undefined; m.lastBreak = 0; m.interruptedUntil = 0;
}

// ---------------------------------------------------------------- BORROWED FOOTSTEPS
function footstepsBegin(player) {
  const o = S.omen;
  if (footstepsDisrupted(player)) { abort(); return; }
  const cadence = clamp((perception.stepCadence(player.id) || 8) * rand(0.85, 1.15), 4, 30);
  o.point = hiddenPoint(player, 6, 10, awayDir(player, false), 7);
  o.phase = 'play';
  const second = Math.max(2, Math.round(cadence)), third = second + randInt(20, 40);
  later(1, (p) => footstep(p, false));
  later(second, (p) => footstep(p, false));
  later(third, (p) => footstep(p, true));
  o.deadline = S.tick + third + 20;
}
function footstep(player, last) {
  const o = S.omen;
  if (footstepsDisrupted(player)) { abort(); return; }
  play(SOUNDS.step(materialAt(player.dimension, o.point)), o.point, 0.5, 16, rand(0.95, 1.05));
  if (!last) return;
  cue(player, 'footsteps');
  if (chance(0.2)) line(player, 'counted');
  finish();
}

// ---------------------------------------------------------------- ANSWERING THE MINE
function mineTick(player) {
  const o = S.omen; const m = mine();
  if (o.phase !== 'listen') return;
  if (S.tick < m.interruptedUntil) return;                                  // a bell or plate broke its concentration: hold
  if (m.playerId !== player.id || m.intervals.length < 3) { abort(); return; }
  if (S.tick - m.lastBreak < o.pause) return;                               // the player is still tapping: keep listening
  const seq = m.intervals.slice(-MINE.ring);
  o.point = hiddenPoint(player, 14, 20, awayDir(player, true), 17);
  o.phase = 'play';
  let at = 1;
  for (const gap of seq) { later(at, (p) => tap(p, false)); at += gap; }
  later(at, (p) => tap(p, false));                                          // completes the player's own sequence
  at += seq[seq.length - 1];
  later(at, (p) => tap(p, true));                                           // one tap the player never made
  o.deadline = S.tick + at + 20;
  m.intervals.length = 0;                                                   // answered; listen for a new rhythm
}
function tap(player, last) {
  play(SOUNDS.answer_tap, S.omen.point, 0.45, 24, rand(0.96, 1.04));
  if (!last) return;
  cue(player, 'tap');
  if (chance(0.25)) line(player, 'tap');
  finish();
}

// ---------------------------------------------------------------- distant drag
function dragBegin(player) {
  const o = S.omen;
  o.point = hiddenPoint(player, 12, 20, creature() ? awayDir(player, true) : randomDir(), 16);
  o.phase = 'play';
  for (let i = 0; i < 3; i++) later(1 + i * 20, () => play(SOUNDS.chain_drag, S.omen.point, 0.5, 24, rand(0.9, 1.0)));
  later(61, (p) => { cue(p, 'drag'); finish(); });
}

// ---------------------------------------------------------------- listeners (called from main.js)
/** world.afterEvents.playerBreakBlock: keep the rhythm of one player's last breaks (ring of 8 intervals of 8..40 ticks). */
export function onBlockBreak(event) {
  const player = event && event.player; if (!isValid(player)) return;
  const m = mine(); const gap = S.tick - m.lastBreak;
  if (m.playerId !== player.id || !m.lastBreak || gap > MINE.reset) { m.intervals.length = 0; m.playerId = player.id; }
  else if (gap >= MINE.min && gap <= MINE.max) { m.intervals.push(gap); bounded(m.intervals, MINE.ring); }
  m.lastBreak = S.tick;
}
/** bell / plate / lever / button: recorded as noise; within 24 blocks of the listened player it breaks the listening posture. */
export function onLoudEvent(kind, pos, playerId) {
  if (!pos) return;
  const newest = S.noise[S.noise.length - 1];                              // main.js may have logged this same event already
  if (!(newest && newest.tick === S.tick && newest.kind === kind && dist(newest.pos, pos) < 0.01)) perception.recordNoise(kind, pos, playerId);
  if (!masterEnabled()) return;
  const m = mine();
  const listener = m.playerId ? safe(() => world.getEntity(m.playerId), undefined) : undefined;
  if (isValid(listener) && dist(listener.location, pos) <= MINE.radius) m.interruptedUntil = S.tick + MINE.interrupt;
  const r = S.record;
  if (r && typeof r.tension === 'number') r.tension = clamp(r.tension + 8, 0, 100);
}
