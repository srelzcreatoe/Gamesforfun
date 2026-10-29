// @ts-check
// It learns how you get away. Every way a player ends one of its dangerous encounters is counted;
// once one method has been used 3 times (and more than any other), it adapts to that one method:
//   light   it puts out the lights near you first, and needs brighter light, held longer, to leave
//   water   it waits at the shore for a while instead of giving up at once
//   gaze    it comes from behind, and a stare has to be held half as long again
//   lens    the first look through the Witness Lens in an encounter only makes it flinch
//   hit     the first blow in an encounter no longer makes it flinch
//   outrun  it follows 16 blocks further before it gives up
//   veil    the way back is sealed twice over
//   flare   the first flare in an encounter only makes it flinch
// Only one adaptation at a time, so every other way out still works. It wears off: using another
// way takes half a point from the rest, and a way not used for 20 minutes fades (about half every
// further 20 minutes). Counts do not fade while a way is in use, so three uses always teach it.
import { ps, markPlayerDirty, now } from "../core/state.js";
import { S } from "../core/settings.js";
import { safe, trace, emit } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("../director/encounter.js").Encounter} Encounter */

export const METHODS = ["light", "water", "gaze", "lens", "hit", "outrun", "veil", "flare"];
const NEED = 3;
/** seconds a way out stays fresh before its count starts to fade */
const FRESH = 1200;
/** @type {((p:Player, method:string)=>void)[]} */
const adaptListeners = [];
/** @param {(p:Player, method:string)=>void} cb */
export const onAdapt = (cb) => adaptListeners.push(cb);

/**
 * Which way out an encounter's outcome stands for ("" = none).
 * @param {string} defId @param {string} outcome @param {Record<string, any>} data
 */
export function methodOf(defId, outcome, data) {
  switch (outcome) {
    case "repelled_by_light": return "light";
    case "escaped_water": return "water";
    case "stared_down":
    case "held_off": return "gaze";
    case "escaped": return defId === "closed_path" ? "veil" : "outrun";
    case "repelled": return data.lastRepel === "hit" ? "hit" : "lens";
    case "flared": return "flare";
    default: return "";
  }
}

/** @param {any} s */
function strongest(s) {
  let best = "", n = 0;
  for (const m of METHODS) {
    const v = s.escapes?.[m] ?? 0;
    if (v >= NEED - 1e-6 && (v > n || (v === n && m === s.adapt))) {
      best = m;
      n = v;
    }
  }
  return best;
}

/** Count a way out. @param {Player} p @param {string} method */
export function note(p, method) {
  if (!METHODS.includes(method)) return;
  const s = ps(p);
  if (!s.escapes) s.escapes = {};
  if (!s.escapeAt) s.escapeAt = {};
  for (const m of Object.keys(s.escapes)) if (m !== method) s.escapes[m] = Math.max(0, s.escapes[m] - 0.5);
  s.escapes[method] = (s.escapes[method] ?? 0) + 1;
  s.escapeAt[method] = Math.floor(now());
  const before = s.adapt ?? "";
  s.adapt = strongest(s);
  markPlayerDirty(p);
  emit("learn", { what: "note", player: p.name, method, count: s.escapes[method], adapt: s.adapt });
  if (s.adapt && s.adapt !== before && S().learning !== false) {
    trace(`${p.name}: it has learned "${s.adapt}"`);
    emit("learn", { what: "adapt", player: p.name, method: s.adapt });
    for (const cb of adaptListeners) safe(() => cb(p, s.adapt));
  }
}

/** Every minute: ways not used for 20 minutes fade (×0.966 a minute, about half per 20 minutes). @param {Player} p */
export function decay(p) {
  const s = ps(p);
  if (!s.escapes) return;
  const t = now();
  for (const m of Object.keys(s.escapes)) {
    if (t - (s.escapeAt?.[m] ?? 0) < FRESH) continue;
    s.escapes[m] *= 0.966;
    if (s.escapes[m] < 0.05) {
      delete s.escapes[m];
      if (s.escapeAt) delete s.escapeAt[m];
    }
  }
  const cur = strongest(s);
  if (cur !== (s.adapt ?? "")) {
    s.adapt = cur;
    markPlayerDirty(p);
  }
}

/** The adaptation in force for this player ("" = none, or learning switched off). @param {any} s */
export function adapted(s) {
  return S().learning === false ? "" : s.adapt ?? "";
}

/**
 * Should this repel only make it flinch? True once per encounter for the adapted method.
 * @param {Encounter} enc @param {"lens"|"hit"|"flare"} kind
 */
export function shrug(enc, kind) {
  if (adapted(enc.s) !== kind) return false;
  if (!enc.data.shrugged) enc.data.shrugged = {};
  if (enc.data.shrugged[kind]) return false;
  enc.data.shrugged[kind] = true;
  enc.emit("learn", { what: "shrug", kind });
  return true;
}

/** Extra light it needs before it backs off (0 or 2 levels). @param {Encounter} enc */
export const lightBonus = (enc) => (adapted(enc.s) === "light" ? 2 : 0);
/** Multiplier on how long light / a stare must be held. @param {Encounter} enc @param {"light"|"gaze"} kind */
export const holdFactor = (enc, kind) => (adapted(enc.s) === kind ? 1.5 : 1);
/** Extra distance before it gives up a chase. @param {Encounter} enc */
export const outrunBonus = (enc) => (adapted(enc.s) === "outrun" ? 16 : 0);
