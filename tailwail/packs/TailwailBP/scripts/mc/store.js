// Persistence: compact, versioned JSON in dynamic properties.
//   world  tailwail:settings   host/operator settings
//   player tailwail:prefs      per-player presentation preferences
//   player tailwail:mem        behavioural memory (core/memory.js)
//   player tailwail:sched2     waits, escalation stage, journal (core/scheduler.js)
import { world } from "@minecraft/server";
import { PLAYER_DEFAULTS, PRESETS, WORLD_DEFAULTS, WORLD_LIMITS } from "../config.js";
import { emptyMemory, parseMemory, serializeMemory } from "../core/memory.js";
import { emptySchedule, parseSchedule, serializeSchedule } from "../core/scheduler.js";

const K = { settings: "tailwail:settings2", prefs: "tailwail:prefs2", mem: "tailwail:mem", sched: "tailwail:sched2" };

const clampNum = (v, [lo, hi], d) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : d);

export function sanitizeSettings(raw) {
  const s = { ...WORLD_DEFAULTS };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(WORLD_DEFAULTS)) {
      if (!(k in raw)) continue;
      const d = WORLD_DEFAULTS[k];
      if (typeof d === "boolean") s[k] = !!raw[k];
      else if (typeof d === "number") s[k] = WORLD_LIMITS[k] ? clampNum(raw[k], WORLD_LIMITS[k], d) : d;
      else if (k === "preset") s[k] = [...Object.keys(PRESETS), "custom"].includes(raw[k]) ? raw[k] : d;
    }
  }
  s.v = 2;
  s.maxConcurrent = Math.round(s.maxConcurrent);
  s.presence = Math.round(s.presence);
  s.strugglePresses = Math.round(s.strugglePresses);
  if (s.cooldownMax < s.cooldownMin) s.cooldownMax = s.cooldownMin;
  if (s.firstMax < s.firstMin) s.firstMax = s.firstMin;
  return s;
}

let cached = null;
export function getSettings() {
  if (cached) return cached;
  let raw = null;
  try {
    const j = world.getDynamicProperty(K.settings);
    if (typeof j === "string") raw = JSON.parse(j);
  } catch {
    raw = null;
  }
  cached = sanitizeSettings(raw);
  return cached;
}

export function saveSettings(s) {
  cached = sanitizeSettings(s);
  world.setDynamicProperty(K.settings, JSON.stringify(cached));
  return cached;
}

export function presetSettings(base, name) {
  const p = PRESETS[name];
  if (!p) return sanitizeSettings({ ...base, preset: "custom" });
  return sanitizeSettings({ ...base, ...p, preset: name });
}

function readJson(entity, key) {
  try {
    const j = entity.getDynamicProperty(key);
    return typeof j === "string" ? j : "";
  } catch {
    return "";
  }
}

const prefCache = new Map(); // player id -> prefs (dynamic properties are slow to parse every tick)

export function getPrefs(player) {
  const hit = prefCache.get(player.id);
  if (hit) return hit;
  const j = readJson(player, K.prefs);
  let raw = {};
  try {
    raw = j ? JSON.parse(j) : {};
  } catch {
    raw = {};
  }
  const p = {
    v: 2,
    volume: clampNum(raw.volume, [0, 1], PLAYER_DEFAULTS.volume),
    camera: [0, 1, 2].includes(raw.camera) ? raw.camera : PLAYER_DEFAULTS.camera,
    music: typeof raw.music === "boolean" ? raw.music : PLAYER_DEFAULTS.music,
    fog: typeof raw.fog === "boolean" ? raw.fog : PLAYER_DEFAULTS.fog,
    captions: typeof raw.captions === "boolean" ? raw.captions : PLAYER_DEFAULTS.captions,
    guideGiven: !!raw.guideGiven,
  };
  prefCache.set(player.id, p);
  return p;
}

export function setPrefs(player, prefs) {
  prefCache.set(player.id, { ...prefs });
  player.setDynamicProperty(K.prefs, JSON.stringify(prefs));
}

export function forgetPrefs(id) {
  prefCache.delete(id);
}

export function getMemory(player) {
  return parseMemory(readJson(player, K.mem));
}

export function saveMemory(player, m) {
  player.setDynamicProperty(K.mem, serializeMemory(m));
}

export function resetMemory(player) {
  player.setDynamicProperty(K.mem, undefined);
  player.setDynamicProperty(K.sched, undefined);
  return emptyMemory();
}

export function getSchedule(player) {
  const j = readJson(player, K.sched);
  return j ? parseSchedule(j) : emptySchedule();
}

export function saveSchedule(player, s) {
  player.setDynamicProperty(K.sched, serializeSchedule(s));
}
