// Persistent configuration (world dynamic property gs:config) and per-player preferences.
import { world } from '@minecraft/server';
import { IDS } from './constants.js';
import { S } from './state.js';
import { clamp, jsonParse, safe, log } from './util.js';

/** @type {Record<string, any>} */
export const DEFAULTS = Object.freeze({
  master: true, naturalSpawning: true, spawnChance: 0.6, graceSeconds: 120, cooldownMinSeconds: 180, cooldownMaxSeconds: 360,
  stalkMinSeconds: 20, stalkMaxSeconds: 40, huntCapSeconds: 45, maxSpawnY: 0, minSpawnDistance: 12, maxSpawnDistance: 24,
  health: 80, damageScale: 1.0, speedScale: 1.0, aggression: 1.0,
  crawling: true, lightAvoidance: true, lightThreshold: 3, chainFragments: true, omenFootsteps: true, omenMine: true, omenDrag: true,
  cornerWatch: true, lastLink: true, thresholds: true, unfinishedRetreat: true, learning: true, effectDensity: 1.0,
  musicVolume: 0.6, effectsVolume: 1.0, subtitles: true, atmosphericLines: true, quietPreset: false, lostReservationMinutes: 10, debug: false,
  preset: 'balanced',
});

/** Numeric safety bounds. Anything outside is clamped on set() and on load(). */
/** @type {Record<string, [number, number]>} */
export const BOUNDS = Object.freeze({
  spawnChance: [0.05, 1], graceSeconds: [0, 900], cooldownMinSeconds: [30, 1800], cooldownMaxSeconds: [30, 3600],
  stalkMinSeconds: [5, 120], stalkMaxSeconds: [5, 180], huntCapSeconds: [10, 45], maxSpawnY: [-64, 320], minSpawnDistance: [6, 32],
  maxSpawnDistance: [8, 48], health: [40, 200], damageScale: [0, 2], speedScale: [0.6, 1.4], aggression: [0.5, 1.5],
  lightThreshold: [1, 8], effectDensity: [0, 1.5], musicVolume: [0, 1], effectsVolume: [0, 1], lostReservationMinutes: [2, 60],
});

/** @type {Record<string, Record<string, any>>} */
export const PRESETS = Object.freeze({
  balanced: {},
  slow_dread: { cooldownMinSeconds: 300, cooldownMaxSeconds: 600, stalkMinSeconds: 35, stalkMaxSeconds: 60, spawnChance: 0.4, aggression: 0.8, huntCapSeconds: 40,
    omenFootsteps: true, omenMine: true, omenDrag: true, cornerWatch: true, lastLink: true },
  relentless: { cooldownMinSeconds: 120, cooldownMaxSeconds: 240, stalkMinSeconds: 15, stalkMaxSeconds: 25, spawnChance: 0.9, aggression: 1.4, speedScale: 1.15,
    huntCapSeconds: 45, lightThreshold: 4 },
  showcase: { naturalSpawning: false, aggression: 0.5, damageScale: 0, omenFootsteps: true, omenMine: true, omenDrag: true, musicVolume: 0.7 },
});

function sanitize(raw) {
  /** @type {Record<string, any>} */
  const out = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const k of Object.keys(DEFAULTS)) {
      if (!(k in raw)) continue;
      const val = raw[k];
      if (typeof DEFAULTS[k] === 'number') { if (typeof val === 'number' && Number.isFinite(val)) out[k] = val; }
      else if (typeof DEFAULTS[k] === 'boolean') { if (typeof val === 'boolean') out[k] = val; }
      else if (typeof val === 'string') out[k] = val;
    }
  }
  for (const [k, [lo, hi]] of Object.entries(BOUNDS)) out[k] = clamp(out[k], lo, hi);
  if (out.cooldownMaxSeconds < out.cooldownMinSeconds) out.cooldownMaxSeconds = out.cooldownMinSeconds;
  if (out.stalkMaxSeconds < out.stalkMinSeconds) out.stalkMaxSeconds = out.stalkMinSeconds;
  if (!(out.preset in PRESETS)) out.preset = 'custom';
  return out;
}

export function load() {
  const raw = jsonParse(safe(() => world.getDynamicProperty(IDS.PROP_CONFIG), undefined), undefined);
  S.config = sanitize(raw);
  S.debug = !!S.config.debug;
  S.muted = S.config.effectsVolume <= 0 && S.config.musicVolume <= 0;
  return S.config;
}
export function save() {
  if (!S.config) return;
  safe(() => world.setDynamicProperty(IDS.PROP_CONFIG, JSON.stringify(S.config)));
}
export function get(key) { if (!S.config) load(); return S.config[key]; }
export function set(key, value) {
  if (!S.config) load();
  if (!(key in DEFAULTS)) { log('warn', 'unknown config key ' + key); return false; }
  const next = sanitize({ ...S.config, [key]: value, preset: 'custom' });
  S.config = next; S.debug = !!next.debug; save();
  return true;
}
export function applyPreset(name) {
  if (!(name in PRESETS)) return false;
  if (!S.config) load();
  S.config = sanitize({ ...DEFAULTS, ...PRESETS[name], preset: name, master: S.config.master, debug: S.config.debug });
  S.debug = !!S.config.debug; save();
  return true;
}
export function reset() { S.config = sanitize({}); S.debug = false; save(); }

/** @type {Record<string, any>} */
export const PREF_DEFAULTS = Object.freeze({ musicVolume: 1.0, effectsVolume: 1.0, subtitles: true, quiet: false, dialGiven: false, muted: false });
export function prefs(player) {
  const raw = jsonParse(safe(() => player.getDynamicProperty(IDS.PLAYER_PREFS), undefined), undefined);
  /** @type {Record<string, any>} */
  const out = { ...PREF_DEFAULTS };
  if (raw && typeof raw === 'object') for (const k of Object.keys(PREF_DEFAULTS)) if (typeof raw[k] === typeof PREF_DEFAULTS[k]) out[k] = raw[k];
  out.musicVolume = clamp(out.musicVolume, 0, 1); out.effectsVolume = clamp(out.effectsVolume, 0, 1);
  return out;
}
export function setPref(player, key, value) {
  const p = prefs(player);
  if (!(key in PREF_DEFAULTS)) return false;
  p[key] = value;
  safe(() => player.setDynamicProperty(IDS.PLAYER_PREFS, JSON.stringify(p)));
  return true;
}
