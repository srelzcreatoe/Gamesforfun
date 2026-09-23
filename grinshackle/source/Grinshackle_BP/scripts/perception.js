// What Grinshackle can perceive: line of sight, being watched, noise events, and a bounded sample of the target's movement.
// Nothing here reads anything outside the game world.
import { world } from '@minecraft/server';
import { IDS } from './constants.js';
import { S } from './state.js';
import { dist, flatDist, sub, norm, dot, safe, isValid, bounded, headingOf, angleDiff } from './util.js';
import { playerEligible } from './gates.js';
import { hasLineOfSight } from './world_scan.js';

const NOISE_MAX = 32, SAMPLE_MAX = 64;
const LOUDNESS = { sprint: 1.0, jump: 0.8, break: 2.0, place: 1.2, bell: 6.0, plate: 2.5, lever: 1.5, button: 1.5, lure: 3.0, hit: 3.0, door: 1.5 };

export function eyeOf(entity) { const l = entity.location; return { x: l.x, y: l.y + ((S.record && S.record.low) ? 1.2 : 2.2), z: l.z }; }
export function lineOfSight(entity, player) {
  if (!isValid(entity) || !isValid(player)) return false;
  if (safe(() => entity.dimension.id, 'a') !== safe(() => player.dimension.id, 'b')) return false;
  return hasLineOfSight(entity.dimension, eyeOf(entity), safe(() => player.getHeadLocation(), player.location));
}
/** Is the player looking at the creature (view cone) with a clear line? cone = cosine threshold (0.91 ≈ 25°). */
export function isWatched(entity, player, cone = 0.91) {
  if (!lineOfSight(entity, player)) return false;
  const head = safe(() => player.getHeadLocation(), undefined); if (!head) return false;
  const to = sub({ x: entity.location.x, y: entity.location.y + 1.6, z: entity.location.z }, head);
  const L = Math.hypot(to.x, to.y, to.z); if (L < 0.5) return true;
  const v = safe(() => player.getViewDirection(), undefined); if (!v) return false;
  return dot(v, to) / L > cone;
}
export function targetOf(record) {
  if (!record || !record.target) return undefined;
  const p = safe(() => world.getEntity(record.target), undefined);
  return p && isValid(p) && p.typeId === 'minecraft:player' ? p : undefined;
}
/** Closest eligible player in the creature's dimension (optionally within maxDist). */
export function chooseTarget(entity, maxDist = 48) {
  if (!isValid(entity)) return undefined;
  const dimId = entity.dimension.id; const loc = entity.location;
  let best, bd = maxDist;
  for (const p of safe(() => world.getAllPlayers(), [])) {
    if (!playerEligible(p) || safe(() => p.dimension.id, '') !== dimId) continue;
    const d = dist(p.location, loc); if (d < bd) { bd = d; best = p; }
  }
  return best;
}
export function setTargetTag(player) {
  for (const p of safe(() => world.getAllPlayers(), [])) if (isValid(p) && p.hasTag(IDS.TARGET_TAG) && (!player || p.id !== player.id)) safe(() => p.removeTag(IDS.TARGET_TAG));
  if (isValid(player) && !player.hasTag(IDS.TARGET_TAG)) safe(() => player.addTag(IDS.TARGET_TAG));
}
export function clearTargetTags() { setTargetTag(undefined); }

/** Record a noise event (bounded ring). */
export function recordNoise(kind, pos, playerId, loudness) {
  if (!pos) return;
  S.noise.push({ tick: S.tick, kind, pos: { x: pos.x, y: pos.y, z: pos.z }, playerId, loudness: loudness ?? LOUDNESS[kind] ?? 1 });
  bounded(S.noise, NOISE_MAX);
}
export function recentNoise(pos, radius, ticks, minLoudness = 0) {
  const out = [];
  for (const n of S.noise) if (S.tick - n.tick <= ticks && n.loudness >= minLoudness && dist(n.pos, pos) <= radius) out.push(n);
  return out;
}
export function loudestRecent(pos, radius, ticks) {
  let best; for (const n of recentNoise(pos, radius, ticks)) if (!best || n.loudness > best.loudness) best = n; return best;
}
export function clearNoise() { S.noise.length = 0; }

/** Per-tick movement sample for a player (ring of 64). */
export function sampleMovement(player) {
  if (!isValid(player)) return;
  let ring = S.samples.get(player.id); if (!ring) { ring = []; S.samples.set(player.id, ring); }
  const l = player.location;
  ring.push({ tick: S.tick, x: l.x, y: l.y, z: l.z, onGround: safe(() => player.isOnGround, true), sneaking: safe(() => player.isSneaking, false), sprinting: safe(() => player.isSprinting, false) });
  bounded(ring, SAMPLE_MAX);
  if (ring.length >= 2) {
    const a = ring[ring.length - 2], b = ring[ring.length - 1];
    if (b.sprinting && S.tick % 10 === 0) recordNoise('sprint', l, player.id, 1.0);
    if (!a.onGround && b.onGround && b.y < a.y - 0.4 && S.tick % 2 === 0) recordNoise('jump', l, player.id, 0.8);
  }
}
export function samplesOf(playerId) { return S.samples.get(playerId) || []; }
/** Derived footsteps from the samples: one step per 0.6 blocks on the ground. Returns [{tick, quiet}] (bounded 16). */
export function stepEvents(playerId) {
  const ring = samplesOf(playerId); const steps = []; let acc = 0;
  for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i];
    if (!b.onGround) continue;
    acc += Math.hypot(b.x - a.x, b.z - a.z);
    if (acc >= 0.6) { acc = 0; steps.push({ tick: b.tick, quiet: b.sneaking }); }
  }
  return steps.slice(-16);
}
/** Mean interval (ticks) between the last steps, or undefined. */
export function stepCadence(playerId) {
  const s = stepEvents(playerId); if (s.length < 3) return undefined;
  let sum = 0; for (let i = 1; i < s.length; i++) sum += s[i].tick - s[i - 1].tick;
  return sum / (s.length - 1);
}
export function playerStopped(playerId, ticks = 10) {
  const ring = samplesOf(playerId); if (ring.length < ticks + 1) return false;
  const a = ring[ring.length - 1 - ticks], b = ring[ring.length - 1];
  return Math.hypot(b.x - a.x, b.z - a.z) < 0.15;
}
export function movementHeading(playerId, ticks = 10) {
  const ring = samplesOf(playerId); if (ring.length < ticks + 1) return undefined;
  const a = ring[ring.length - 1 - ticks], b = ring[ring.length - 1];
  const dx = b.x - a.x, dz = b.z - a.z; if (Math.hypot(dx, dz) < 0.3) return undefined;
  return headingOf(dx, dz);
}
export function headingChanged(playerId, degrees = 60) {
  const ring = samplesOf(playerId); if (ring.length < 30) return false;
  const h1 = movementHeadingAt(ring, ring.length - 30, 10), h2 = movementHeading(playerId, 10);
  return h1 !== undefined && h2 !== undefined && Math.abs(angleDiff(h1, h2)) > degrees;
}
function movementHeadingAt(ring, end, ticks) {
  const a = ring[end - ticks], b = ring[end]; if (!a || !b) return undefined;
  const dx = b.x - a.x, dz = b.z - a.z; if (Math.hypot(dx, dz) < 0.3) return undefined; return headingOf(dx, dz);
}
export function isFleeing(entity, player, ticks = 10) {
  const h = movementHeading(player.id, ticks); if (h === undefined || !isValid(entity)) return false;
  const away = headingOf(player.location.x - entity.location.x, player.location.z - entity.location.z);
  return Math.abs(angleDiff(h, away)) < 60;
}

/**
 * Tension change for one 5-tick evaluation (bounded by the caller to 0..100).
 * Noise, proximity, pursuit and provocation raise it; quiet separation and an established lit refuge lower it.
 */
export function tensionDelta(entity, player, record, watched) {
  if (!isValid(entity) || !isValid(player)) return 0;
  const d = dist(entity.location, player.location);
  let delta = 0;
  if (d < 4) delta += 4; else if (d < 8) delta += 2; else if (d < 14) delta += 0.6;
  if (safe(() => player.isSprinting, false)) delta += 1.5;
  if (watched) delta += 0.8;
  const noise = recentNoise(entity.location, 24, 40, 1.5); if (noise.length) delta += Math.min(4, noise.length * 1.2);
  if (safe(() => player.isSneaking, false)) delta -= 0.6;
  if (d > 16 && !lineOfSight(entity, player)) delta -= 1.2;
  if (record && record.lit && record.lit.strong) delta -= 1.5;
  return delta * ((S.config && S.config.aggression) || 1);
}
