// @ts-check
// Bounded adaptive learning. The creature "learns" by keeping small, decaying scores about what each
// player repeatedly does (escape style, torch habits, strip-mining, hiding spots, routes) and turns the
// strongest few into tactics. Nothing here is omniscient: every score comes from something it witnessed.
import { world } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { clamp, dist } from "../core/util.js";

const SKILL_CAP = 3;

export function learnRate() {
  return cfg.learning ? cfg.learningStrength : 0;
}

/** @param {any} p @param {keyof import("../core/state.js").Profile["skills"]} skill @param {number} amt */
export function teach(p, skill, amt) {
  const r = learnRate();
  if (r <= 0) return;
  const s = p.profile.skills;
  s[skill] = clamp((s[skill] || 0) + amt * r, 0, SKILL_CAP);
  p.profDirty = true;
}

/** @param {any} p @param {string} style */
export function noteEscape(p, style) {
  const e = p.profile.esc;
  e[style] = clamp((e[style] || 0) + 1, 0, 10);
  p.profile.escapes++;
  p.profDirty = true;
  if (style === "pillar") teach(p, "climb", 0.7);
  if (style === "seal") teach(p, "break", 0.7);
  if (style === "shelter") teach(p, "doors", 0.7);
  if (style === "surface") teach(p, "surface", 0.8);
  if (style === "water") teach(p, "climb", 0.2);
  if (style === "run") teach(p, "ambush", 0.35);
}

/** Remember a place where the player hid or escaped to (kept to 5, counted). */
export function noteSpot(list, loc) {
  for (const s of list) {
    if (dist({ x: s[0], y: s[1], z: s[2] }, loc) < 6) {
      s[3] = Math.min(9, (s[3] || 1) + 1);
      return;
    }
  }
  list.push([Math.floor(loc.x), Math.floor(loc.y), Math.floor(loc.z), 1]);
  if (list.length > 5) {
    list.sort((a, b) => b[3] - a[3]);
    list.length = 5;
  }
}

/** Daily decay so habits fade when the player stops repeating them. @param {any} p */
export function decay(p) {
  const day = Math.floor(world.getAbsoluteTime() / 24000);
  const prof = p.profile;
  if (prof.day === day) return;
  if (prof.day >= 0) {
    const steps = Math.min(5, day - prof.day);
    for (let i = 0; i < steps; i++) {
      for (const k in prof.esc) prof.esc[k] = Math.max(0, prof.esc[k] * 0.85 - 0.05);
      for (const k in prof.skills) prof.skills[k] = Math.max(0, prof.skills[k] - 0.12);
      prof.torch *= 0.9;
      prof.strip *= 0.88;
      prof.lookBack *= 0.9;
      prof.lure = Math.max(0, prof.lure - 0.5);
      prof.flare = Math.max(0, prof.flare - 0.5);
      for (const s of prof.hide) s[3] = Math.max(0, s[3] - 0.5);
      for (const s of prof.routes) s[3] = Math.max(0, s[3] - 0.5);
      prof.hide = prof.hide.filter((s) => s[3] > 0.1);
      prof.routes = prof.routes.filter((s) => s[3] > 0.1);
    }
  }
  prof.day = day;
  p.profDirty = true;
}

/**
 * Active adaptations: only the strongest 3 learned skills are usable at once.
 * With learning disabled, a flat level derived from aggression is used instead.
 * @param {any} p @returns {Record<string, number>}
 */
export function abilities(p) {
  const s = p.profile.skills;
  /** @type {Record<string, number>} */
  const out = { doors: 0, climb: 0, break: 0, torch: 0, surface: 0, ambush: 0 };
  if (!cfg.learning) {
    const lvl = cfg.aggression >= 1.4 ? 2 : cfg.aggression >= 0.8 ? 1 : 0;
    for (const k in out) out[k] = lvl;
    return out;
  }
  const ranked = Object.entries(s).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 3);
  for (const [k, v] of ranked) out[k] = Math.floor(v);
  // encounters themselves slowly unlock a base level of persistence
  const enc = p.profile.enc;
  if (enc >= 3) out.break = Math.max(out.break, 1);
  if (enc >= 5) out.climb = Math.max(out.climb, 1);
  if (enc >= 7) out.doors = Math.max(out.doors, 1);
  return out;
}

/** Overall aggression for this player (grows with encounters, capped). @param {any} p */
export function aggressionFor(p) {
  const enc = p.profile.enc;
  return cfg.aggression * (1 + Math.min(0.6, enc * 0.04 * (cfg.learning ? cfg.learningStrength : 0.5)));
}

/** Effectiveness of a distraction that the player keeps reusing. */
export function habituation(count) {
  return 1 / (1 + 0.25 * Math.max(0, count));
}

/** Eerie descriptions of what it has learned, for the Field Journal. @param {any} p */
export function learnedLines(p) {
  const s = p.profile.skills;
  const lines = [];
  if (s.climb >= 1) lines.push("It has seen you climb out of reach. It climbs now, too.");
  if (s.break >= 1) lines.push("Walls you build no longer stop it. It listens for fresh stone.");
  if (s.doors >= 1) lines.push("It understands doors. Sometimes it opens and closes them just to let you know.");
  if (s.torch >= 1) lines.push("It has noticed your torches. They go out more often around you.");
  if (s.surface >= 1) lines.push("Daylight no longer means you are safe. It has followed you up before.");
  if (s.ambush >= 1) lines.push("You use the same way out. It waits along it.");
  if (p.profile.strip >= 3) lines.push("You dig long straight tunnels. It likes to watch you from the far end.");
  if (p.profile.torch >= 2) lines.push("You light your way heavily. It keeps to the edge of your light.");
  if (p.profile.lure >= 4) lines.push("The rattling bones don't fool it like they used to.");
  if (p.profile.lookBack >= 4) lines.push("You check behind you often. So it comes from the side.");
  if (!lines.length) lines.push("It is still watching. It hasn't decided what you are yet.");
  return lines;
}
