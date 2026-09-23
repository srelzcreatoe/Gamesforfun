// Every gate the encounter must pass. Delayed callbacks re-check these when they fire; never cache a gate result across ticks.
import { world, GameMode, Difficulty } from '@minecraft/server';
import { IDS } from './constants.js';
import { S } from './state.js';
import { safe, isValid } from './util.js';
import { get } from './config.js';
import { isUnderground } from './world_scan.js';
import * as reservation from './reservation.js';

const RESPAWN_PROTECT_TICKS = 1200; // 60 s after a death or (re)spawn

export function masterEnabled() { return !!(S.config && S.config.master); }
export function naturalEnabled() { return masterEnabled() && !!S.config.naturalSpawning; }
export function worldAllowsEncounters() { return safe(() => world.getDifficulty() !== Difficulty.Peaceful, false); }

/** Survival/Adventure, alive, not respawn-protected, in the Overworld. */
export function playerEligible(p) {
  if (!isValid(p)) return false;
  const mode = safe(() => p.getGameMode(), undefined);
  if (mode !== GameMode.Survival && mode !== GameMode.Adventure) return false;
  const hp = safe(() => p.getComponent('minecraft:health'), undefined);
  if (!hp || !(hp.currentValue > 0)) return false;
  if (safe(() => p.dimension.id, '') !== IDS.OVERWORLD) return false;
  const lastDeath = safe(() => p.getDynamicProperty(IDS.PLAYER_LAST_DEATH), undefined);
  if (typeof lastDeath === 'number' && S.tick - lastDeath < RESPAWN_PROTECT_TICKS) return false;
  const lastSpawn = safe(() => p.getDynamicProperty(IDS.PLAYER_LAST_SPAWN), undefined);
  if (typeof lastSpawn === 'number' && S.tick - lastSpawn < RESPAWN_PROTECT_TICKS) return false;
  return true;
}

/** Overworld, at or below the configured spawn ceiling, and not sky-exposed. */
export function habitatOK(p) {
  if (!isValid(p)) return false;
  if (safe(() => p.dimension.id, '') !== IDS.OVERWORLD) return false;
  const loc = safe(() => p.location, undefined);
  if (!loc || loc.y > get('maxSpawnY')) return false;
  return isUnderground(p.dimension, loc);
}

export function eligiblePlayers() {
  return safe(() => world.getAllPlayers(), []).filter(playerEligible);
}

/** Explains the natural spawn gate. `reason` strings are used verbatim by text.gateSentence. */
export function spawnGate() {
  if (!masterEnabled()) return { ok: false, reason: 'disabled', detail: '' };
  if (!S.config.naturalSpawning) return { ok: false, reason: 'natural_off', detail: '' };
  if (!worldAllowsEncounters()) return { ok: false, reason: 'peaceful', detail: '' };
  const res = reservation.current();
  if (res) {
    const live = S.active && isValid(S.active);
    return { ok: false, reason: live ? 'reserved_active' : 'reserved_unloaded', detail: live ? (S.record ? S.record.state : 'active') : `${res.dimensionId} ${Math.round(res.x)},${Math.round(res.y)},${Math.round(res.z)}` };
  }
  if (S.tick < S.naturalGraceUntil) return { ok: false, reason: 'grace', detail: String(Math.ceil((S.naturalGraceUntil - S.tick) / 20)) };
  if (S.tick < S.nextNaturalCheck) return { ok: false, reason: 'cooldown', detail: String(Math.ceil((S.nextNaturalCheck - S.tick) / 20)) };
  const players = eligiblePlayers();
  if (!players.length) return { ok: false, reason: 'no_eligible_player', detail: '' };
  const habitat = players.filter(habitatOK);
  if (!habitat.length) return { ok: false, reason: 'wrong_habitat', detail: `maxY ${get('maxSpawnY')}` };
  return { ok: true, reason: 'ok', detail: '', players: habitat };
}
