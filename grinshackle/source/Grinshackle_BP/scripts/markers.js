// CHAIN SNAP markers: script-side positions with a particle, bounded ring of 12, 6-second life. Never blocks, never items.
import { PARTICLES, FRAGMENT_LIFE, FRAGMENT_MAX, SOUNDS } from './constants.js';
import { S } from './state.js';
import { dist, flatDist, safe, isValid } from './util.js';
import * as audio from './audio.js';
import { isSolidFloor } from './world_scan.js';

const MIN_SPACING = 1.5;
const DROP_INTERVAL = 30;

/** Drop a fragment at the creature's feet (rate-limited, spaced, never on the player's own block). */
export function drop(entity, player) {
  const r = S.record; if (!r || !r.fragmentsEnabled || !isValid(entity)) return false;
  if (S.tick - r.lastFragment < DROP_INTERVAL) return false;
  const pos = safe(() => entity.location, undefined); if (!pos) return false;
  if (!isSolidFloor(entity.dimension, pos)) return false;
  if (isValid(player) && flatDist(pos, player.location) < 1.2) return false;
  for (const f of S.markers) if (flatDist(f.pos, pos) < MIN_SPACING) return false;
  r.lastFragment = S.tick;
  S.markers.push({ pos: { x: pos.x, y: Math.floor(pos.y), z: pos.z }, until: S.tick + FRAGMENT_LIFE, dimensionId: safe(() => entity.dimension.id, '') });
  while (S.markers.length > FRAGMENT_MAX) S.markers.shift();
  return true;
}

/** Per tick while hunting: expire, show, and detect a walking/sprinting player stepping on a fragment. Returns true when a snap triggers. */
export function update(entity, player) {
  const r = S.record;
  for (let i = S.markers.length - 1; i >= 0; i--) if (S.markers[i].until <= S.tick) S.markers.splice(i, 1);
  if (!S.markers.length) return false;
  const dim = isValid(entity) ? entity.dimension : undefined;
  if (dim && S.tick % 10 === 0) {
    const density = S.config ? S.config.effectDensity : 1;
    let shown = 0;
    for (const f of S.markers) { if (shown++ >= 6 * density) break; safe(() => dim.spawnParticle(PARTICLES.chain_fragment, { x: f.pos.x, y: f.pos.y + 0.08, z: f.pos.z })); }
  }
  if (!r || !isValid(player)) return false;
  const ploc = safe(() => player.location, undefined); if (!ploc) return false;
  const sneaking = safe(() => player.isSneaking, false);
  const onGround = safe(() => player.isOnGround, true);
  for (let i = S.markers.length - 1; i >= 0; i--) {
    const f = S.markers[i];
    if (dist(ploc, f.pos) >= 0.85) continue;
    if (sneaking || !onGround) continue;           // sneaking over a fragment never snaps
    S.markers.splice(i, 1);
    audio.fx(SOUNDS.rattle, f.pos, { volume: 0.9, radius: 20, dimensionId: f.dimensionId });
    if (S.tick < r.snapCooldownUntil) return false;  // cue plays, but no second enrage during the cooldown
    r.snapPending = true;
    return true;
  }
  return false;
}
export function clear() { S.markers.length = 0; }
export function count() { return S.markers.length; }
