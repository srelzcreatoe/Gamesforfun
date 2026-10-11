// Persistent data in world dynamic properties.
//
//   fb:save     campaign progress + settings (survives quitting, never reset by a night)
//   fb:build    builder progress (resumable construction)
//   fb:session  marker written while a night is in progress (crash/quit recovery)
//   fb:holiday  seasonal decorations currently placed in the world (map state, not progress)
//
// Temporary night state (clock, power, AI, devices) is NEVER persisted: if
// the world is closed mid-night, the next load performs a full reset and
// returns the player to the lobby (the night must be replayed).

import { world } from '@minecraft/server';
import { log } from './log.js';

const SAVE = 'fb:save';
const BUILD = 'fb:build';
const SESSION = 'fb:session';
const HOLIDAY = 'fb:holiday';
export const SAVE_VERSION = 3;
const LAST_NIGHT = 9;
const CHALLENGES = ['no_doors', 'fredbear_only', 'double_drain', 'no_cams'];

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    unlocked: 1, // highest night that may be started (7 after night 6, 8 after 7, 9 after 8)
    completed: [], // nights survived at least once (unlock the newspaper clippings)
    tutorialDone: false,
    campaignDone: false, // night 6 beaten (unlocks night 7 and the challenges)
    secrets: [],
    tasksDone: [],
    challenges: [], // challenge modes beaten
    endings: [], // night 7 endings seen: 'seal' | 'burn'
    lastEnding: null, // the most recent night 7 ending: decides which night 8 you get
    tapesSeen: false, // the 1987 security tapes played once
    flashbackSeen: false, // night 4 flashback shown once
    settings: { captions: true, hints: true, deterministic: false, seed: 1983, debugOverlay: false, music: true, holidays: true, camMap: true },
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
  const completed = Array.isArray(s.completed) ? s.completed.filter((n) => n >= 1 && n <= LAST_NIGHT) : [];
  const endings = Array.isArray(s.endings) ? s.endings.filter((e) => e === 'seal' || e === 'burn') : [];
  // A night opens once the one before it was survived: the campaign done opens night 7 (1.1 saves were capped at 6),
  // night 7 survived opens 8 (1.2 saves were capped at 7), night 8 opens 9 - never further.
  let unlocked = Math.max(1, Math.min(LAST_NIGHT, Number(s.unlocked) || 1));
  if (s.campaignDone) unlocked = Math.max(unlocked, 7);
  for (const n of [7, 8]) if (completed.includes(n)) unlocked = Math.max(unlocked, n + 1);
  for (const n of [7, 8]) if (unlocked > n && !completed.includes(n)) unlocked = n;
  return {
    ...d,
    ...s,
    unlocked,
    completed,
    lastEnding: s.lastEnding === 'seal' || s.lastEnding === 'burn' ? s.lastEnding : endings.at(-1) ?? null,
    secrets: Array.isArray(s.secrets) ? s.secrets : [],
    tasksDone: Array.isArray(s.tasksDone) ? s.tasksDone : [],
    challenges: Array.isArray(s.challenges) ? s.challenges.filter((c) => CHALLENGES.includes(c)) : [],
    endings,
    flashbackSeen: !!s.flashbackSeen,
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

/** Seasonal decoration currently placed ('halloween' | 'christmas' | null). */
export function readHoliday() {
  return readJson(HOLIDAY)?.season ?? null;
}

export function storeHoliday(season) {
  writeJson(HOLIDAY, { season });
}
