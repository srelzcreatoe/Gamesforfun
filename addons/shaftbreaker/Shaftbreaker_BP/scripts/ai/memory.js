// @ts-check
import { parseJSON, clamp, worldTicks, mins } from '../core/util.js';
import { config, decayMul } from '../core/config.js';

/**
 * Persistent, bounded, decaying behaviour profile (one per player, stored on the player).
 * Nothing here is unobserved: every increment comes from a concrete in-game event.
 */
export const SIGNALS = Object.freeze([
  'escape_stairs', 'escape_door', 'escape_surface', 'escape_water', 'escape_pillars', 'mine_straight', 'mine_stop_listen',
  'uses_torches', 'melee_retreat', 'shield_dependence', 'trap_reuse', 'group_together', 'group_separated', 'den_interference',
]);

export const SIGNAL_TEXT = Object.freeze({
  escape_stairs: 'It has learned you flee upward through stairs and shafts.',
  escape_door: 'It has learned you hide behind doors.',
  escape_surface: 'It watches the cave mouths you run for.',
  escape_water: 'It has noticed you take to the water.',
  escape_pillars: 'It has seen you pillar up out of reach.',
  mine_straight: 'It anticipates where your tunnels lead.',
  mine_stop_listen: 'It knows you stop and listen.',
  uses_torches: 'It keeps to the edges of your torchlight.',
  melee_retreat: 'It expects you to back away after a swing.',
  shield_dependence: 'It has studied your shield.',
  trap_reuse: 'It has grown wary of your traps.',
  group_together: 'It avoids your group and watches from afar.',
  group_separated: 'It waits for one of you to wander off.',
  den_interference: 'It remembers what you did to its den.',
});

const KEY = 'sb:profile';
const VERSION = 2;

function blank() {
  const traits = {};
  for (const s of SIGNALS) traits[s] = { s: 0, c: 0, n: 0, t: 0, burst: 0, bt: 0 };
  return {
    v: VERSION,
    traits,
    sightings: 0,          // times it was actually seen
    encounters: 0,
    hunts: 0, huntsEscaped: 0, huntsCaught: 0, deaths: 0, defeats: 0,
    lastFamilies: [],      // ring of recent encounter families (novelty)
    lastIds: [],           // ring of recent encounter ids
    routes: [],            // [{x,y,z,n,t}] escape route buckets (8x8x8)
    shelters: [],          // [{x,y,z,n,t}] repeatedly used safe spots
    traps: {},             // damage cause -> count against the creature
    undergroundSec: 0,
    familiarity: 0,        // 0..100 long-term progression
    learnLog: [],          // last adaptation notes (debug / dial)
    rareSeen: [],          // rare cinematic ids already played
    lastSeenWorldTick: 0,
  };
}

/** @type {Map<string, any>} */
const cache = new Map();
const dirty = new Set();

export function profile(player) {
  const id = player.id;
  let p = cache.get(id);
  if (p) return p;
  try { p = parseJSON(/** @type {string} */ (player.getDynamicProperty(KEY)), null); } catch { p = null; }
  if (!p || p.v !== VERSION) p = { ...blank(), ...(p && typeof p === 'object' ? migrate(p) : {}) };
  for (const s of SIGNALS) if (!p.traits[s]) p.traits[s] = { s: 0, c: 0, n: 0, t: 0, burst: 0, bt: 0 };
  cache.set(id, p);
  return p;
}

function migrate(old) {
  const b = blank();
  if (old.traits) for (const s of SIGNALS) if (old.traits[s]) b.traits[s] = { ...b.traits[s], ...old.traits[s] };
  for (const k of ['sightings', 'encounters', 'hunts', 'huntsEscaped', 'huntsCaught', 'deaths', 'defeats', 'undergroundSec', 'familiarity']) if (typeof old[k] === 'number') b[k] = old[k];
  return b;
}

export function markDirty(player) { dirty.add(player.id); }

export function saveDirty(players) {
  for (const p of players) {
    if (!dirty.has(p.id)) continue;
    try { p.setDynamicProperty(KEY, JSON.stringify(cache.get(p.id))); dirty.delete(p.id); } catch { /* retry later */ }
  }
}

export function forget(playerId) { cache.delete(playerId); dirty.delete(playerId); }

export function resetProfile(player) {
  cache.set(player.id, blank());
  try { player.setDynamicProperty(KEY, JSON.stringify(cache.get(player.id))); } catch { /* ignore */ }
}

/**
 * Record one piece of evidence for a signal.
 * - diminishing returns inside a 60 s window (no farming)
 * - score and confidence are separate and both capped 0..100
 */
export function evidence(player, signal, strength = 1, note = '') {
  if (!config().learning) return;
  const p = profile(player);
  const tr = p.traits[signal];
  if (!tr) return;
  const t = worldTicks();
  if (t - tr.bt > 1200) { tr.burst = 0; tr.bt = t; }
  tr.burst++;
  const dim = 1 / tr.burst;                          // saturation
  tr.s = clamp(tr.s + 14 * strength * dim, 0, 100);
  tr.n += 1;
  tr.c = clamp(tr.n * 15, 0, 100);
  tr.t = t;
  if (note) logLearn(p, `${signal}: ${note}`);
  markDirty(player);
}

/** counter-learning: a tactic based on this signal failed */
export function weaken(player, signal, amount = 15, note = '') {
  const p = profile(player);
  const tr = p.traits[signal];
  if (!tr) return;
  tr.s = clamp(tr.s - amount, 0, 100);
  tr.c = clamp(tr.c - amount * 1.3, 0, 100);
  if (note) logLearn(p, `${signal} weakened: ${note}`);
  markDirty(player);
}

function logLearn(p, msg) {
  p.learnLog.push(msg);
  if (p.learnLog.length > 8) p.learnLog.shift();
}

/** trait value normalised 0..1 (score weighted by confidence) */
export function trait(player, signal) {
  const tr = profile(player).traits[signal];
  if (!tr) return 0;
  return (tr.s / 100) * (0.35 + 0.65 * tr.c / 100);
}

/** "two observations make it curious, three or four unlock a cautious response" */
export function curious(player, signal) { const tr = profile(player).traits[signal]; return !!tr && tr.n >= 2 && tr.s >= 18; }
export function unlocked(player, signal) { const tr = profile(player).traits[signal]; return !!tr && tr.n >= 3 && tr.s >= 35 && tr.c >= 55; }

/** periodic decay; faster when there is no supporting evidence for a long time */
export function decay(player, playSeconds) {
  const p = profile(player);
  const t = worldTicks();
  const m = decayMul();
  let changed = false;
  for (const s of SIGNALS) {
    const tr = p.traits[s];
    if (tr.s <= 0) continue;
    const stale = t - tr.t > mins(30);
    const rate = (stale ? 0.9 : 0.2) * m * (playSeconds / 60);
    tr.s = clamp(tr.s - rate, 0, 100);
    if (stale) tr.c = clamp(tr.c - rate * 0.6, 0, 100);
    changed = true;
  }
  if (changed) markDirty(player);
}

export function noteEncounter(player, id, family) {
  const p = profile(player);
  p.encounters++;
  p.lastFamilies.push(family); if (p.lastFamilies.length > 6) p.lastFamilies.shift();
  p.lastIds.push(id); if (p.lastIds.length > 10) p.lastIds.shift();
  p.familiarity = clamp(p.familiarity + (family === 'hunt' ? 4 : family === 'audio' ? 0.6 : 1.6), 0, 100);
  markDirty(player);
}

export function noteSighting(player) {
  const p = profile(player); p.sightings++; p.lastSeenWorldTick = worldTicks(); markDirty(player);
}

/** bucket a position into an 8-block region and bump it in a small LRU list */
export function bumpRegion(list, pos, cap = 6) {
  const b = { x: Math.floor(pos.x / 8), y: Math.floor(pos.y / 8), z: Math.floor(pos.z / 8) };
  const t = worldTicks();
  let e = list.find((r) => r.x === b.x && r.y === b.y && r.z === b.z);
  if (e) { e.n++; e.t = t; } else { e = { ...b, n: 1, t }; list.push(e); }
  list.sort((a, c) => c.n * 4 + c.t / 72000 - (a.n * 4 + a.t / 72000));
  while (list.length > cap) list.pop();
  return e;
}

export function regionCenter(r) { return { x: r.x * 8 + 4, y: r.y * 8 + 4, z: r.z * 8 + 4 }; }

/** summary used by the dial and the debug overlay */
export function topTraits(player, n = 3) {
  const p = profile(player);
  return SIGNALS.map((s) => [s, p.traits[s]]).filter(([, t]) => t.s > 5).sort((a, b) => b[1].s - a[1].s).slice(0, n);
}
