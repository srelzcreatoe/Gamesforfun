// @ts-check
import { world } from '@minecraft/server';
import { parseJSON, clamp } from './util.js';

/**
 * World configuration (operators edit it with the Resonance Dial or /shaftbreaker:sb).
 * All values here are the "Balanced" defaults from the design bible.
 */
export const DEFAULTS = Object.freeze({
  enabled: true,
  naturalEncounters: true,
  preset: 'balanced',                 // atmospheric | balanced | relentless | harmless | accessibility
  spawnGeography: 'underground',      // underground | cave_mouths | expanded
  frequency: 'balanced',              // rare | balanced | frequent
  stalkIntensity: 'balanced',         // subtle | balanced | aggressive
  learning: true,
  memoryDecay: 'normal',              // fast | normal | slow
  blockDestruction: 'natural',        // off | den | natural
  playerBuildAlteration: 'off',       // off | cosmetic
  denGeneration: true,
  torchManipulation: 'rare',          // off | rare | moderate
  maxHuntSeconds: 25,                 // 10..40
  deathGraceSeconds: 90,              // 60..180
  flashes: 'off',                     // off | low
  chaseMusic: true,
  quietHunt: true,                    // ultra-rare silent-music hunt (safety tells remain)
  surfaceMode: false,                 // advanced: short cave-mouth pursuit + surface silhouettes
  trophyDrop: true,
  trophyVision: true,
  trophyFilter: false,
  harmless: false,                    // creature never damages players or edits blocks
  creativeEncounters: true,           // creative players are stalked too (no damage; hunts become chases)
  debug: 'off',                       // off | basic | verbose
});

/** preset overrides */
export const PRESETS = Object.freeze({
  atmospheric: { frequency: 'rare', stalkIntensity: 'subtle', blockDestruction: 'off', maxHuntSeconds: 15, deathGraceSeconds: 150, torchManipulation: 'off', harmless: false, quietHunt: false },
  balanced: { frequency: 'balanced', stalkIntensity: 'balanced', blockDestruction: 'natural', maxHuntSeconds: 25, deathGraceSeconds: 90, torchManipulation: 'rare', harmless: false },
  relentless: { frequency: 'frequent', stalkIntensity: 'aggressive', blockDestruction: 'natural', maxHuntSeconds: 32, deathGraceSeconds: 75, torchManipulation: 'moderate', harmless: false },
  harmless: { frequency: 'balanced', stalkIntensity: 'balanced', blockDestruction: 'off', torchManipulation: 'off', harmless: true },
  accessibility: { frequency: 'rare', stalkIntensity: 'subtle', flashes: 'off', quietHunt: false, chaseMusic: false, maxHuntSeconds: 15, harmless: false },
});

export const ENUMS = Object.freeze({
  preset: ['atmospheric', 'balanced', 'relentless', 'harmless', 'accessibility'],
  spawnGeography: ['underground', 'cave_mouths', 'expanded'],
  frequency: ['rare', 'balanced', 'frequent'],
  stalkIntensity: ['subtle', 'balanced', 'aggressive'],
  memoryDecay: ['fast', 'normal', 'slow'],
  blockDestruction: ['off', 'den', 'natural'],
  playerBuildAlteration: ['off', 'cosmetic'],
  torchManipulation: ['off', 'rare', 'moderate'],
  flashes: ['off', 'low'],
  debug: ['off', 'basic', 'verbose'],
});

const KEY = 'sb:config';
/** @type {Record<string, any>} */
let cfg = { ...DEFAULTS };

export function loadConfig() {
  const stored = parseJSON(/** @type {string} */ (world.getDynamicProperty(KEY)), {});
  cfg = sanitize({ ...DEFAULTS, ...stored });
  return cfg;
}

function sanitize(c) {
  for (const [k, vals] of Object.entries(ENUMS)) if (!vals.includes(c[k])) c[k] = DEFAULTS[k];
  for (const k of Object.keys(DEFAULTS)) if (typeof DEFAULTS[k] === 'boolean') c[k] = !!c[k];
  c.maxHuntSeconds = clamp(Number(c.maxHuntSeconds) || 25, 10, 40);
  c.deathGraceSeconds = clamp(Number(c.deathGraceSeconds) || 90, 60, 180);
  return c;
}

export function saveConfig() {
  try { world.setDynamicProperty(KEY, JSON.stringify(cfg)); } catch (e) { console.warn('[Shaftbreaker] config save failed ' + e); }
}

/** @returns {Record<string, any>} */
export const config = () => cfg;

export function setConfig(k, v) {
  if (!(k in DEFAULTS)) return false;
  cfg[k] = v;
  cfg = sanitize(cfg);
  saveConfig();
  return true;
}

export function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return false;
  cfg = sanitize({ ...cfg, ...p, preset: name });
  saveConfig();
  return true;
}

/** pacing multipliers derived from config */
export function freqMul() {
  return cfg.frequency === 'rare' ? 1.6 : cfg.frequency === 'frequent' ? 0.62 : 1.0;
}
export function intensityMul() {
  return cfg.stalkIntensity === 'subtle' ? 0.7 : cfg.stalkIntensity === 'aggressive' ? 1.35 : 1.0;
}
export function decayMul() {
  return cfg.memoryDecay === 'fast' ? 2.0 : cfg.memoryDecay === 'slow' ? 0.5 : 1.0;
}

// -------------------------------------------------------------- per-player accessibility prefs
export const PREF_DEFAULTS = Object.freeze({
  reducedAudio: false,     // softer stingers, no heartbeat spikes
  reducedFlicker: true,    // no camera fades / flashes
  reducedChase: false,     // no chase music for me
  captions: false,         // threat subtitles in the action bar
  heartbeat: true,
  trophyFilter: false,
});
const PREF_KEY = 'sb:prefs';

export function prefs(player) {
  try {
    return { ...PREF_DEFAULTS, ...parseJSON(/** @type {string} */ (player.getDynamicProperty(PREF_KEY)), {}) };
  } catch { return { ...PREF_DEFAULTS }; }
}

export function setPrefs(player, p) {
  try { player.setDynamicProperty(PREF_KEY, JSON.stringify({ ...prefs(player), ...p })); } catch { /* ignore */ }
}
