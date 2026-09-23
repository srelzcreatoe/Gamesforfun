// One Grinshackle per world. The reservation lives in a world dynamic property and survives reloads and unloaded chunks.
// Every creature carries gs:generation; a creature whose generation is not the reserved one is inert and removes itself when loaded.
import { world } from '@minecraft/server';
import { IDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid, jsonParse, log } from './util.js';

function read() { return jsonParse(safe(() => world.getDynamicProperty(IDS.PROP_RESERVATION), undefined), undefined); }
function write(res) { safe(() => world.setDynamicProperty(IDS.PROP_RESERVATION, res ? JSON.stringify(res) : undefined)); S.reservation = res; }

export function load() { S.reservation = read(); return S.reservation; }
export function current() { return S.reservation; }
export function generation() { return (S.reservation && S.reservation.generation) || 0; }

/** Reserve the world for `entity`. Increments the generation so that every older creature becomes stale. */
export function reserve(entity, mode) {
  const prev = read();
  const gen = ((prev && prev.generation) || safe(() => world.getDynamicProperty('gs:generation_counter'), 0) || 0) + 1;
  safe(() => world.setDynamicProperty('gs:generation_counter', gen));
  const loc = entity.location;
  const res = { entityId: entity.id, generation: gen, dimensionId: entity.dimension.id, x: loc.x, y: loc.y, z: loc.z, mode, createdTick: S.tick, lastSeenTick: S.tick, unloadedSinceTick: 0 };
  safe(() => entity.setDynamicProperty(IDS.ENT_GENERATION, gen));
  safe(() => entity.setDynamicProperty(IDS.ENT_MODE, mode));
  write(res);
  return res;
}
export function release() { write(undefined); }

/** True only if `entity` is the reserved creature of the current generation. Called before every AI update and attack. */
export function validate(entity) {
  const res = S.reservation;
  if (!res || !isValid(entity)) return false;
  if (entity.id !== res.entityId) return false;
  const gen = safe(() => entity.getDynamicProperty(IDS.ENT_GENERATION), undefined);
  return gen === res.generation;
}
export function touch(entity) {
  const res = S.reservation; if (!res || !isValid(entity)) return;
  const loc = safe(() => entity.location, undefined); if (!loc) return;
  res.lastSeenTick = S.tick; res.x = loc.x; res.y = loc.y; res.z = loc.z; res.unloadedSinceTick = 0;
  if (S.tick % 100 === 0) write(res);
}
export function markUnloaded() {
  const res = S.reservation; if (!res) return;
  if (!res.unloadedSinceTick) { res.unloadedSinceTick = S.tick; write(res); }
}

/**
 * Decide what to do with a creature that just spawned or loaded.
 * Returns 'active' | 'duplicate_removed' | 'stale_removed' | 'disabled_removed' | 'legacy_removed'.
 */
export function adopt(entity, masterEnabled) {
  if (!isValid(entity)) return 'stale_removed';
  if (entity.typeId === IDS.LEGACY_ENTITY) { safe(() => entity.remove()); return 'legacy_removed'; }
  const res = read(); S.reservation = res;
  const gen = safe(() => entity.getDynamicProperty(IDS.ENT_GENERATION), undefined);
  if (!masterEnabled) {
    if (res && res.entityId === entity.id) release();
    safe(() => entity.remove());
    return 'disabled_removed';
  }
  if (res) {
    if (res.entityId === entity.id && gen === res.generation) return 'active';
    if (typeof gen === 'number' && gen !== res.generation) { safe(() => entity.remove()); return 'stale_removed'; }
    // Same generation but different id, or an untagged creature (egg / summon) while a reservation exists: duplicate.
    safe(() => entity.remove());
    return 'duplicate_removed';
  }
  // No reservation: an untagged creature (spawn egg, /summon, test) becomes the reserved one. A tagged stale one is removed.
  if (typeof gen === 'number') { safe(() => entity.remove()); return 'stale_removed'; }
  return 'active';
}

/** If the reserved creature has been unloaded too long and cannot be found anywhere, retire that generation (it self-removes on load). */
export function retireIfLost(lostMinutes) {
  const res = S.reservation; if (!res) return false;
  if (!res.unloadedSinceTick) return false;
  if (S.tick - res.unloadedSinceTick < lostMinutes * 60 * 20) return false;
  for (const id of ['overworld', 'nether', 'the_end']) {
    const found = safe(() => world.getDimension(id).getEntities({ type: IDS.ENTITY }), []).some((e) => e.id === res.entityId);
    if (found) { res.unloadedSinceTick = 0; write(res); return false; }
  }
  log('info', `retiring lost reservation generation ${res.generation}`);
  release();
  return true;
}

/** One-time migration from the v1 "Chainreaver" pack: clear cr:* properties and remove any legacy entity. */
export function migrateV1() {
  if (safe(() => world.getDynamicProperty(IDS.PROP_MIGRATED), false) === true) return;
  for (const k of ['cr:active_id', 'cr:enabled', 'cr:muted', 'cr:fast']) safe(() => world.setDynamicProperty(k, undefined));
  for (const id of ['overworld', 'nether', 'the_end']) for (const e of safe(() => world.getDimension(id).getEntities({ type: IDS.LEGACY_ENTITY }), [])) safe(() => e.remove());
  safe(() => world.setDynamicProperty(IDS.PROP_MIGRATED, true));
}
