// @ts-check
import { world } from "@minecraft/server";

const KEY = "shaftbreaker:config";

/** Every tunable value of the add-on. Edited in game with the Config Wheel. */
export const DEFAULTS = {
  enabled: true,
  preset: "balanced",
  // ---- encounters & pacing
  graceMinutes: 12, // real minutes of play before the first full encounter
  encounterRate: 1.0, // 0.25 .. 3
  minEncounterGap: 150, // seconds between full encounters (minimum)
  recoverySeconds: 210, // quiet period after a hunt
  maxHuntSeconds: 80,
  minorEvents: true, // sounds/illusions between encounters
  // ---- the creature
  tier: "normal", // easy | normal | brutal (health + damage)
  aggression: 1.0, // 0.4 .. 2
  speed: 1.0, // 0.7 .. 1.4
  surfacePursuit: true,
  lowHealthEscape: true,
  shieldDisable: true,
  darknessOnHit: true,
  // ---- adaptive AI
  learning: true,
  learningStrength: 1.0, // 0.25 .. 2
  // ---- illusions & environment
  illusions: true,
  illusionRate: 1.0,
  phantoms: true,
  torchMode: 1, // 0 off, 1 during encounters, 2 frequent
  doors: true,
  breakMode: 2, // 0 never, 1 natural stone only, 2 natural + basic building blocks
  scratchMarks: true,
  pathSealing: true,
  // ---- territory & dwellings
  territory: true,
  territoryFrequency: 1, // 0 rare, 1 normal, 2 common
  territorySize: 1, // 0 small, 1 normal, 2 large
  mobFear: true,
  dwellings: true,
  loneDwellings: true,
  protectRadius: 64,
  finalConfrontation: 75, // % chance destroying a dwelling triggers the final confrontation
  moths: true,
  // ---- audio
  heartbeatVolume: 1.0,
  ambienceVolume: 1.0,
  screamVolume: 1.0,
  musicMode: 1, // 0 off, 1 music channel, 2 sound-effect channel
  musicVolume: 0.9,
  // ---- accessibility
  screenEffects: true,
  reducedParticles: false,
  captions: false,
  // ---- permissions / debug
  opsOnlyConfig: true,
  debug: false,
};

/** @type {typeof DEFAULTS} */
export const cfg = { ...DEFAULTS };

export const PRESETS = {
  atmospheric: {
    label: "Atmospheric", desc: "Mostly watching, sounds and illusions. Rare, short hunts. No block breaking.",
    values: { encounterRate: 0.7, aggression: 0.55, maxHuntSeconds: 45, breakMode: 0, torchMode: 1, illusions: true,
      illusionRate: 1.4, tier: "easy", speed: 0.85, minEncounterGap: 240, recoverySeconds: 300 },
  },
  balanced: {
    label: "Balanced", desc: "The intended experience: long stalking, tense standoffs, fair but deadly hunts.",
    values: { encounterRate: 1.0, aggression: 1.0, maxHuntSeconds: 80, breakMode: 2, torchMode: 1, illusions: true,
      illusionRate: 1.0, tier: "normal", speed: 1.0, minEncounterGap: 150, recoverySeconds: 210 },
  },
  relentless: {
    label: "Relentless", desc: "Frequent encounters, high aggression, faster and tougher, learns quickly.",
    values: { encounterRate: 1.8, aggression: 1.7, maxHuntSeconds: 140, breakMode: 2, torchMode: 2, illusions: true,
      illusionRate: 1.3, tier: "brutal", speed: 1.15, minEncounterGap: 90, recoverySeconds: 120, learningStrength: 1.6 },
  },
  harmless: {
    label: "Harmless Preview", desc: "It watches, stares and vanishes but never attacks or edits the world.",
    values: { encounterRate: 1.2, aggression: 0.0, maxHuntSeconds: 20, breakMode: 0, torchMode: 0, doors: false,
      scratchMarks: false, pathSealing: false, illusions: true, tier: "easy", minEncounterGap: 90, recoverySeconds: 90,
      graceMinutes: 1 },
  },
};

export function loadConfig() {
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      for (const k of Object.keys(DEFAULTS)) {
        if (k in parsed && typeof parsed[k] === typeof DEFAULTS[k]) cfg[k] = parsed[k];
      }
    }
  } catch {
    // keep defaults
  }
}

export function saveConfig() {
  try {
    world.setDynamicProperty(KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

/** @param {string} name */
export function applyPreset(name) {
  const p = PRESETS[name];
  if (!p) return;
  for (const [k, v] of Object.entries(p.values)) cfg[k] = v;
  cfg.preset = name;
  saveConfig();
}

export function resetConfig() {
  Object.assign(cfg, DEFAULTS);
  saveConfig();
}

export const harmless = () => cfg.aggression <= 0.01;
