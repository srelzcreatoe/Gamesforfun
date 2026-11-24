// @ts-nocheck
// =============================================================================
//  The Goatwalker - settings (changed in game with The Wheel)
//  One small object, saved in the world, read by everything else.
// =============================================================================
import { world } from "@minecraft/server";

/** how often things happen (multiplies every timer) */
export const PACE_OPTS = [0.6, 0.8, 1.0, 1.5, 2.4];
export const PACE_NAMES = ["Very slow", "Slow", "Normal", "Fast", "Relentless"];
/** how fast his anger builds, and how readily he attacks */
export const AGGRO_OPTS = [0.5, 1.0, 1.8, 3.0];
export const AGGRO_NAMES = ["Wary (he mostly watches)", "Angry (normal)", "Vicious", "Nightmare"];

export const DEFAULTS = {
  pace: 2,          // index into PACE_OPTS
  aggro: 1,         // index into AGGRO_OPTS
  harm: true,       // he can hurt and kill you (off: every scare, no damage, no hunts)
  chase: true,      // the chase you cannot outrun ("Too Slow")
  meta: true,       // fourth-wall scares: fake chat lines, words on your screen
  shake: true,      // camera shake
  day: true,        // he is active by day too
  grief: true,      // he snuffs torches, rams doors, moves things
  eyes: true,       // eyes in the dark
  jumpscare: true,  // when he gets you: his face, all of it, all at once
  wheel: false,     // give The Wheel when you arrive and every time you die (merged into The Observer: off; its Config Wheel opens his)
  spawn: true,      // a brand-new world starts at the edge of his woods
};

const KEY = "gw:cfg";
let CACHE = null;

export function cfg() {
  if (CACHE) return CACHE;
  CACHE = { ...DEFAULTS };
  try {
    const raw = world.getDynamicProperty(KEY);
    if (typeof raw === "string") {
      const o = JSON.parse(raw);
      for (const k of Object.keys(DEFAULTS)) if (o && typeof o[k] === typeof DEFAULTS[k]) CACHE[k] = o[k];
    }
  } catch { /* first run */ }
  CACHE.pace = Math.max(0, Math.min(PACE_OPTS.length - 1, CACHE.pace | 0));
  CACHE.aggro = Math.max(0, Math.min(AGGRO_OPTS.length - 1, CACHE.aggro | 0));
  return CACHE;
}
export function setCfg(patch) {
  const c = cfg();
  for (const k of Object.keys(DEFAULTS)) if (k in patch && typeof patch[k] === typeof DEFAULTS[k]) c[k] = patch[k];
  c.pace = Math.max(0, Math.min(PACE_OPTS.length - 1, c.pace | 0));
  c.aggro = Math.max(0, Math.min(AGGRO_OPTS.length - 1, c.aggro | 0));
  try { world.setDynamicProperty(KEY, JSON.stringify(c)); } catch { /* best effort */ }
  return c;
}
export function resetCfg() { return setCfg({ ...DEFAULTS }); }
export const paceMul = () => PACE_OPTS[cfg().pace];
/** how fast he runs, by how angry the settings make him */
export const SPEED_OPTS = [0.88, 1.0, 1.08, 1.18];
export const speedMul = () => SPEED_OPTS[cfg().aggro];
export const aggro = () => AGGRO_OPTS[cfg().aggro];
