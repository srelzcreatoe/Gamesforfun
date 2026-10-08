// Persistent data in world dynamic properties.
//
//   fb:save     campaign progress + settings (survives quitting, never reset by a night)
//   fb:build    builder progress (resumable construction)
//   fb:session  marker written while a night is in progress (crash/quit recovery)
//
// Temporary night state (clock, power, AI, devices) is NEVER persisted: if
// the world is closed mid-night, the next load performs a full reset and
// returns the player to the lobby (the night must be replayed).

import { world } from '@minecraft/server';
import { log } from './log.js';

const SAVE = 'fb:save';
const BUILD = 'fb:build';
const SESSION = 'fb:session';
export const SAVE_VERSION = 1;

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    unlocked: 1, // highest night that may be started
    completed: [], // nights survived at least once
    tutorialDone: false,
    campaignDone: false,
    secrets: [],
    tasksDone: [],
    settings: { captions: true, hints: true, deterministic: false, seed: 1983, debugOverlay: false },
    stats: { deaths: 0, wins: 0 },
  };
}

function readJson(key) {
  try {
    const raw = world.getDynamicProperty(key);
    return typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch (e) {
    log.error(`corrupt dynamic property ${key}`, e);
    return undefined;
  }
}

function writeJson(key, value) {
  try {
    world.setDynamicProperty(key, value === undefined ? undefined : JSON.stringify(value));
  } catch (e) {
    log.error(`could not write ${key}`, e);
  }
}

/** Load + migrate the save (missing fields are filled from defaults). */
export function loadSave() {
  const d = defaultSave();
  const s = readJson(SAVE);
  if (!s || typeof s !== 'object') return d;
  return {
    ...d,
    ...s,
    unlocked: Math.max(1, Math.min(6, Number(s.unlocked) || 1)),
    completed: Array.isArray(s.completed) ? s.completed.filter((n) => n >= 1 && n <= 6) : [],
    secrets: Array.isArray(s.secrets) ? s.secrets : [],
    tasksDone: Array.isArray(s.tasksDone) ? s.tasksDone : [],
    settings: { ...d.settings, ...(s.settings ?? {}) },
    stats: { ...d.stats, ...(s.stats ?? {}) },
    v: SAVE_VERSION,
  };
}

export function storeSave(save) {
  writeJson(SAVE, save);
}

export function eraseSave() {
  writeJson(SAVE, undefined);
}

export function loadBuild() {
  return readJson(BUILD) ?? { version: 0, done: false };
}

export function storeBuild(b) {
  writeJson(BUILD, b);
}

export function markSession(info) {
  writeJson(SESSION, info);
}

export function readSession() {
  return readJson(SESSION);
}

export function clearSession() {
  writeJson(SESSION, undefined);
}
