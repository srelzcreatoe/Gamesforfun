// Persistent data in world dynamic properties.
//
//   fnar:save    campaign progress + settings (JSON)
//   fnar:origin  world position of local (0, 0, 0) chosen by /fnar:setup (Vector3)
//   fnar:build   builder progress (resumable construction, JSON)
//
// Night state (clock, power, AI, devices) is never persisted: if the world is
// closed mid-night the next load resets to the lobby and the night is replayed.

import { world } from '@minecraft/server';
import { log } from './log.js';

const SAVE = 'fnar:save';
const ORIGIN = 'fnar:origin';
const BUILD = 'fnar:build';
export const SAVE_VERSION = 1;

export function defaultSettings() {
  return { captions: true, hints: true, music: true, bgm: true, camMap: true, camCursor: true, debugOverlay: false, deterministic: false, seed: 1991 };
}

export function defaultSave() {
  return {
    v: SAVE_VERSION,
    next: 1, // the night CONTINUE starts
    beaten: [], // nights survived (1..6) + 7 for any custom night win
    stars: 0, // 1 = the week (night 5), 2 = the Final Act, 3 = showstopper
    showstopper: false,
    hungUp: false, // the guard hung up on the Ringmaster's last call
    custom: { mirehop: 5, noxbriar: 5, rustgrin: 5, cat: 5, purple_rat: 5, top_hat_rat: 5 },
    settings: defaultSettings(),
  };
}

function readJson(key) {
  try {
    const raw = world.getDynamicProperty(key);
    return typeof raw === 'string' ? JSON.parse(raw) : undefined;
  } catch (e) {
    log.warn(`bad ${key}: ${e?.message ?? e}`);
    return undefined;
  }
}

function writeJson(key, value) {
  try {
    world.setDynamicProperty(key, JSON.stringify(value));
  } catch (e) {
    log.error(`could not write ${key}`, e);
  }
}

export function loadSave() {
  const s = readJson(SAVE);
  const d = defaultSave();
  if (!s || typeof s !== 'object') return d;
  return {
    ...d,
    ...s,
    beaten: Array.isArray(s.beaten) ? s.beaten.filter((n) => Number.isInteger(n)) : [],
    custom: { ...d.custom, ...(s.custom || {}) },
    settings: { ...d.settings, ...(s.settings || {}) },
  };
}

export function storeSave(save) {
  writeJson(SAVE, save);
}

/** @returns {{x:number,y:number,z:number} | undefined} */
export function loadOrigin() {
  try {
    const v = world.getDynamicProperty(ORIGIN);
    return v && typeof v === 'object' ? v : undefined;
  } catch {
    return undefined;
  }
}

export function storeOrigin(v) {
  try {
    world.setDynamicProperty(ORIGIN, v);
  } catch (e) {
    log.error('could not store origin', e);
  }
}

export function loadBuild() {
  return readJson(BUILD) ?? { version: 0, done: false, phase: 0, op: 0 };
}

export function storeBuild(b) {
  writeJson(BUILD, b);
}
