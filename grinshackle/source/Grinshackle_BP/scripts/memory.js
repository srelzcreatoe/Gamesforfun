// Bounded, explainable memory. (1) Encounter thresholds: passages the player keeps fleeing through. (2) Adaptive profile per player:
// a few decaying counters that shift probabilities, patience and route choice — never damage, speed without a visible mechanic, or immunity.
import { world } from '@minecraft/server';
import { IDS } from './constants.js';
import { S } from './state.js';
import { flatDist, safe, isValid, jsonParse, headingOf, angleDiff, clamp } from './util.js';
import { openness } from './world_scan.js';
import { isFleeing, movementHeading } from './perception.js';

const THRESHOLD_MAX = 6, THRESHOLD_EXPIRE = 1800, MERGE_DIST = 3;

/** Every 20 ticks: remember narrow passages the player moves through. */
export function notePosition(record, entity, player) {
  if (!record || !isValid(player) || !(S.config && S.config.thresholds)) return;
  const loc = player.location;
  for (let i = record.thresholds.length - 1; i >= 0; i--) if (S.tick - record.thresholds[i].lastTick > THRESHOLD_EXPIRE) record.thresholds.splice(i, 1);
  const open = openness(player.dimension, loc);
  if (open > 4) return;
  const heading = movementHeading(player.id, 10); if (heading === undefined) return;
  const fleeing = isValid(entity) && isFleeing(entity, player, 10);
  const hit = record.thresholds.find((t) => flatDist(t, loc) < MERGE_DIST && Math.abs(t.y - loc.y) < 2);
  if (hit) { if (S.tick - hit.lastTick > 60) { hit.uses++; if (fleeing) hit.fleeUses++; } hit.lastTick = S.tick; hit.heading = heading; return; }
  if (record.thresholds.length >= THRESHOLD_MAX) record.thresholds.shift();
  record.thresholds.push({ x: loc.x, y: loc.y, z: loc.z, heading, uses: 1, fleeUses: fleeing ? 1 : 0, lastTick: S.tick });
}
/** A passage the player has fled through at least twice, or undefined. */
export function repeatedThreshold(record) {
  if (!record) return undefined;
  let best; for (const t of record.thresholds) if (t.fleeUses >= 2 && (!best || t.fleeUses > best.fleeUses)) best = t; return best;
}
export function clearThresholds(record) { if (record) record.thresholds.length = 0; }
export function describeThresholds(record) {
  if (!record || !record.thresholds.length) return 'no remembered passages';
  return record.thresholds.map((t) => `${Math.round(t.x)},${Math.round(t.y)},${Math.round(t.z)} uses ${t.uses} fled ${t.fleeUses}`).join('; ');
}

// ---------------- adaptive profile ----------------
const EMPTY = () => ({ samples: 0, sprint: 0, sneak: 0, stare: 0, lights: 0, escapeBins: [0, 0, 0, 0, 0, 0, 0, 0], tight: 0, rush: 0, dodgeL: 0, dodgeR: 0, updated: 0 });
const cache = new Map();
function key(id) { return IDS.PROP_PROFILE_PREFIX + id; }
export function profile(playerId) {
  if (cache.has(playerId)) return cache.get(playerId);
  const raw = jsonParse(safe(() => world.getDynamicProperty(key(playerId)), undefined), undefined);
  const p = EMPTY();
  if (raw && typeof raw === 'object') for (const k of Object.keys(p)) if (k in raw && typeof raw[k] === typeof p[k]) p[k] = raw[k];
  if (!Array.isArray(p.escapeBins) || p.escapeBins.length !== 8) p.escapeBins = [0, 0, 0, 0, 0, 0, 0, 0];
  cache.set(playerId, p); return p;
}
function save(playerId) {
  const p = cache.get(playerId); if (!p) return;
  const text = JSON.stringify(p); if (text.length > 2048) return;
  safe(() => world.setDynamicProperty(key(playerId), text));
}
/** Record an observed behaviour. keys: sprint, sneak, stare, lights, tight, rush, dodgeL, dodgeR, escape(heading) */
export function observe(playerId, k, amount = 1, heading) {
  if (!(S.config && S.config.learning)) return;
  const p = profile(playerId);
  if (k === 'escape' && heading !== undefined) { const bin = ((Math.round(((heading % 360) + 360) % 360 / 45)) % 8); p.escapeBins[bin] = Math.min(50, p.escapeBins[bin] + amount); }
  else if (k in p && typeof p[k] === 'number' && k !== 'samples' && k !== 'updated') p[k] = Math.min(200, p[k] + amount);
  p.samples = Math.min(500, p.samples + amount); p.updated = S.tick;
  if (S.tick % 100 === 0) save(playerId);
}
export function flush(playerId) { if (playerId) save(playerId); else for (const id of cache.keys()) save(id); }
/** Called at encounter end: decay so one action never labels someone permanently. */
export function decay(playerId) {
  const p = profile(playerId);
  for (const k of ['sprint', 'sneak', 'stare', 'lights', 'tight', 'rush', 'dodgeL', 'dodgeR']) p[k] *= 0.97;
  p.escapeBins = p.escapeBins.map((b) => b * 0.97); p.samples *= 0.97; save(playerId);
}
export function confident(p, k) { return p.samples >= 5 && p[k] / Math.max(1, p.samples) >= 0.6; }
/** Coarse, explainable traits with confidence gating. */
export function traits(playerId) {
  const p = profile(playerId); const n = Math.max(1, p.samples);
  const ratio = (k) => p[k] / n;
  const maxBin = p.escapeBins.reduce((m, v, i, a) => (v > a[m] ? i : m), 0);
  const binTotal = p.escapeBins.reduce((a, b) => a + b, 0);
  return {
    samples: p.samples,
    runner: p.samples >= 5 && ratio('sprint') >= 0.5,
    sneaker: p.samples >= 5 && ratio('sneak') >= 0.5,
    starer: p.samples >= 5 && ratio('stare') >= 0.4,
    lighter: p.samples >= 5 && ratio('lights') >= 0.3,
    rusher: p.samples >= 3 && p.rush >= 3,
    tightUser: p.samples >= 3 && p.tight >= 3,
    routeBias: binTotal >= 4 && p.escapeBins[maxBin] / binTotal >= 0.5 ? maxBin * 45 : undefined,
    dodgeSide: p.dodgeL + p.dodgeR >= 4 ? (p.dodgeL > p.dodgeR * 1.5 ? 'left' : p.dodgeR > p.dodgeL * 1.5 ? 'right' : undefined) : undefined,
  };
}
export function forget(playerId) { cache.delete(playerId); safe(() => world.setDynamicProperty(key(playerId), undefined)); }
export function forgetAll() {
  for (const id of safe(() => world.getDynamicPropertyIds(), []).filter((k) => k.startsWith(IDS.PROP_PROFILE_PREFIX))) safe(() => world.setDynamicProperty(id, undefined));
  cache.clear();
}
export function describe(playerId) {
  const t = traits(playerId); const p = profile(playerId);
  const parts = [];
  if (t.runner) parts.push('runs a lot → it prefers approaching from the side');
  if (t.sneaker) parts.push('moves quietly → its searches are less precise');
  if (t.starer) parts.push('watches it constantly → longer standoffs, more covered movement');
  if (t.lighter) parts.push('places lights → it expects lit refuges');
  if (t.rusher) parts.push('rushes into melee → slower, clearly telegraphed slams');
  if (t.tightUser) parts.push('uses tight passages → it waits near passage entrances');
  if (t.routeBias !== undefined) parts.push(`tends to flee toward heading ${t.routeBias}°`);
  if (t.dodgeSide) parts.push(`dodges to the ${t.dodgeSide}`);
  return `${Math.round(p.samples)} samples; ` + (parts.length ? parts.join('; ') : 'no confident traits yet') + '.';
}
