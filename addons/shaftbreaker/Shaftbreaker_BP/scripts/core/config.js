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
  nightStalking: true,                // at night it stalks players on the surface too (trees, houses)
  dayStalking: true,                  // it stalks players on the surface by day as well (anywhere, any time)
  daylightSafe: false,                // daylight ends its chases (off: nowhere is safe)
  difficulty: 'normal',               // easy | normal | hard | nightmare (the Wheel: how hard it is)
  jumpscares: true,                   // its face in yours: lunges, ambushes, sudden appearances
  mindGames: true,                    // whispers, its words on your screen, fourth-wall scares
  darkness: true,                     // red rage fog, the dark closing in near it, darkness pulses
  cameraShake: true,                  // the roar and its lunges shake the camera
  eyesInDark: true,                   // two pale points in the dark that go out when you look
  mimicry: true,                      // it imitates your sounds: doors, chests, footsteps, your pickaxe
  giveWheel: true,                    // players get the Breaker's Wheel when they first join and after dying
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
  frequency: ['rare', 'balanced', 'frequent', 'relentless'],
  difficulty: ['easy', 'normal', 'hard', 'nightmare'],
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
  c.maxHuntSeconds = clamp(Number(c.maxHuntSeconds) || 25, 10, 45);
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
  return cfg.frequency === 'rare' ? 1.6 : cfg.frequency === 'frequent' ? 0.62 : cfg.frequency === 'relentless' ? 0.38 : 1.0;
}
export function intensityMul() {
  return cfg.stalkIntensity === 'subtle' ? 0.7 : cfg.stalkIntensity === 'aggressive' ? 1.35 : 1.0;
}
/**
 * How hard it is (the Wheel). dmg: damage multiplier; speed: chase speed; huntGap/show: time between
 * chases / sightings; stare: how long you may stare; snap: how readily it lunges/rages instead of
 * vanishing; scare: how often the jumpscares and mind games fire; chase: chase length (s).
 */
export const DIFFICULTY = Object.freeze({
  easy: { dmg: 0.55, speed: 0.9, huntGap: 1.7, show: 1.35, stare: 1.5, snap: 0.6, scare: 0.6, chase: 16, label: 'Easy', blurb: 'It watches more than it hunts. Chases are short and slower than you. Hits sting.' },
  normal: { dmg: 1.0, speed: 1.0, huntGap: 1.0, show: 1.0, stare: 1.0, snap: 1.0, scare: 1.0, chase: 25, label: 'Normal', blurb: 'It shows itself often and snaps when provoked. Chases are faster than a sprint.' },
  hard: { dmg: 1.35, speed: 1.1, huntGap: 0.72, show: 0.8, stare: 0.75, snap: 1.35, scare: 1.3, chase: 32, label: 'Hard', blurb: 'It rarely just leaves. It comes faster, hits harder and loses patience quickly.' },
  nightmare: { dmg: 1.75, speed: 1.2, huntGap: 0.5, show: 0.62, stare: 0.55, snap: 1.8, scare: 1.7, chase: 40, label: 'Nightmare', blurb: 'It wants you dead. Short stares, long chases, no mercy, and it is always close.' },
});
export function diff() { return DIFFICULTY[cfg.difficulty] || DIFFICULTY.normal; }

export function decayMul() {
  return cfg.memoryDecay === 'fast' ? 2.0 : cfg.memoryDecay === 'slow' ? 0.5 : 1.0;
}

// -------------------------------------------------------------- per-player accessibility prefs
export const PREF_DEFAULTS = Object.freeze({
  reducedAudio: false,     // softer stingers, no heartbeat spikes
  reducedFlicker: false,   // no camera fades / flashes (on: jumpscares skip the black flash)
  reducedChase: false,     // no chase music for me
  captions: false,         // threat subtitles in the action bar
  heartbeat: true,
  trophyFilter: false,
  jumpscares: true,        // personal opt-out of jumpscares
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
