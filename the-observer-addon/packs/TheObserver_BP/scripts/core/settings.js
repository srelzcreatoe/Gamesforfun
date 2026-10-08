// @ts-check
import { world, Difficulty } from "@minecraft/server";
import { W, ps, markWorldDirty } from "./state.js";
import { DEBUG } from "./util.js";

/**
 * @typedef {Object} Settings
 * @property {boolean} enabled        master switch
 * @property {string} preset          atmosphere | standard | relentless | custom
 * @property {number} frequency       encounter rate multiplier 0.25..2
 * @property {number} aggression      0 never attacks, 1 low, 2 standard, 3 high
 * @property {number} manipulation    0 off (audio-visual only), 1 subtle, 2 standard, 3 unsettling
 * @property {number} scares          0 off, 1 rare, 2 standard
 * @property {number} camera          0 none (no fades/shakes/darkness pulses), 1 reduced, 2 full
 * @property {boolean} captions       accessibility captions for critical audio cues
 * @property {number} graceMinutes    quiet period for new players
 * @property {boolean} worldEffects   allow world-wide weather during the finale
 * @property {boolean} dev            developer tracing and debug overlay
 * @property {string[]} off           encounter types switched off (Config Wheel toggles)
 */

/** @type {Record<string, Omit<Settings,"enabled"|"preset"|"captions"|"dev"|"worldEffects"|"off">>} */
export const PRESETS = {
  atmosphere: { frequency: 0.6, aggression: 0, manipulation: 1, scares: 0, camera: 1, graceMinutes: 15 },
  standard: { frequency: 1.0, aggression: 2, manipulation: 2, scares: 2, camera: 2, graceMinutes: 12 },
  relentless: { frequency: 1.5, aggression: 3, manipulation: 3, scares: 2, camera: 2, graceMinutes: 5 },
};

/** @returns {Settings} */
export function defaults() {
  return { enabled: true, preset: "standard", ...PRESETS.standard, captions: false, worldEffects: true, dev: false, off: [] };
}

/** @returns {Settings} */
export function S() {
  if (!W.settings) {
    W.settings = defaults();
    markWorldDirty();
  }
  if (!Array.isArray(W.settings.off)) W.settings.off = []; // worlds saved before the toggles existed
  return W.settings;
}

/** Is this encounter type switched on? @param {string} id */
export const typeOn = (id) => !S().off.includes(id);

/** @param {Partial<Settings>} patch */
export function updateSettings(patch) {
  const cur = S();
  const next = { ...cur, ...patch };
  if (patch.preset && patch.preset !== "custom" && PRESETS[patch.preset]) Object.assign(next, PRESETS[patch.preset]);
  next.frequency = Math.min(2, Math.max(0.25, Number(next.frequency) || 1));
  for (const k of ["aggression", "manipulation"]) next[k] = Math.min(3, Math.max(0, Math.round(next[k])));
  for (const k of ["scares", "camera"]) next[k] = Math.min(2, Math.max(0, Math.round(next[k])));
  next.graceMinutes = Math.min(60, Math.max(0, Math.round(next.graceMinutes)));
  next.off = Array.isArray(next.off) ? next.off.filter((x) => typeof x === "string").slice(0, 64) : [];
  W.settings = next;
  DEBUG.on = !!next.dev;
  markWorldDirty();
  return next;
}

/** Accessibility captions: the player's own choice, else the world default. @param {import("@minecraft/server").Player} p */
export function captionsOn(p) {
  const v = ps(p).captions;
  return v === undefined ? S().captions : v;
}

/** Effective aggression: Peaceful difficulty never attacks. */
export function aggression() {
  try {
    if (world.getDifficulty() === Difficulty.Peaceful) return 0;
  } catch {}
  return S().aggression;
}

/** Damage of a landed strike by aggression level (half-hearts). */
export function strikeDamage() {
  return [0, 4, 6, 9][aggression()] ?? 0;
}
