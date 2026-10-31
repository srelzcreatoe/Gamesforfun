// @ts-check
// What it knows about each player (1.1.0). Everything a player does that it can see is counted, and every
// repetition teaches it more: a habit's strength is 1 - e^(-n/3) — 28 % after once, 63 % after three times,
// 86 % after six. What it has not seen for a long time slowly fades (about a tenth every 2.5 hours of play).
//   stare      stared it down until it snapped          → its anger builds faster in the next standoff
//   look_away  looked away until it was gone           → it creeps further each time you look away
//   charge     ran straight at it                       → it stands its ground and attacks more often
//   attack     shot it or hit it                        → it keeps further off, behind cover
//   flee       outran it                                → the chase starts closer
//   ignore     never noticed it                          → it stands closer, and lets itself be heard arriving
//   caves / home / surface   where the player spends their time   → the encounters for that place, more often
//   night      plays at night                            → its night encounters, more often
//   lights     puts down a lot of light                  → it puts lights out more often
// It also keeps score of its own encounters: what gets a reaction out of this player it uses more, what they
// never notice it stops wasting its time on. All of it is switched off with "It learns how you escape" off.
import { world } from "@minecraft/server";
import { ps, markPlayerDirty } from "../core/state.js";
import { S } from "../core/settings.js";
import { emit, safe } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */

export const HABITS = ["stare", "look_away", "charge", "attack", "flee", "ignore", "caves", "home", "surface", "night", "lights"];
/** Encounters that belong to a place. */
const PLACE = {
  caves: ["pursuit", "closed_path", "creeping", "distant_watch"],
  home: ["inside", "window_watch", "home_visit", "sign", "night_visit", "door_ajar", "turned_object"],
  surface: ["echo_ahead", "unfamiliar_route", "extra_step", "borrowed_eyes", "mirror_bearing", "borrowed_sound"],
};
const NIGHT = ["pursuit", "creeping", "inside", "night_visit", "snuffed_lights"];
const LIGHTS = /torch|lantern|campfire|candle|glowstone|sea_lantern|shroomlight|froglight|redstone_lamp|end_rod/;

/** @param {any} s */
const prof = (s) => (s.profile ??= {});

/** Something it saw this player do. @param {Player} p @param {string} key @param {number} [n] */
export function note(p, key, n = 1) {
  const s = ps(p);
  const pr = prof(s);
  pr[key] = Math.round(((pr[key] ?? 0) + n) * 100) / 100;
  markPlayerDirty(p);
  emit("profile", { player: p.name, key, n, value: pr[key], habit: Math.round(habit(s, key) * 100) / 100 });
}

/** How strongly it has learned this about the player (0..1; 0 with learning switched off). @param {any} s @param {string} key */
export function habit(s, key) {
  if (S().learning === false) return 0;
  return 1 - Math.exp(-(s.profile?.[key] ?? 0) / 3);
}

/** The share of their time in one place (caves, home, surface), 1/3 until it knows. @param {any} s @param {string} place */
function share(s, place) {
  const pr = s.profile ?? {};
  const all = (pr.caves ?? 0) + (pr.home ?? 0) + (pr.surface ?? 0);
  return all < 1 ? 1 / 3 : (pr[place] ?? 0) / all;
}

/**
 * How much more (or less) it wants to use an encounter on this player: where they spend their time, when, how much
 * light they put down, and how well this encounter has worked on them before (0.5..2.2).
 * @param {any} s @param {string} id
 */
export function weightFactor(s, id) {
  if (S().learning === false) return 1;
  let f = 1;
  for (const [place, ids] of Object.entries(PLACE)) if (ids.includes(id)) f *= 0.8 + 0.9 * share(s, place);
  if (NIGHT.includes(id)) f *= 1 + 0.5 * habit(s, "night");
  if (id === "snuffed_lights") f *= 1 + habit(s, "lights");
  const e = s.effect?.[id];
  if (e !== undefined) f *= 0.6 + 0.8 * e;
  return Math.max(0.5, Math.min(2.2, f));
}

/** An encounter of its ended: did it get a reaction? @param {Player} p @param {string} id @param {boolean} noticed */
export function outcome(p, id, noticed) {
  const s = ps(p);
  if (!s.effect) s.effect = {};
  const e = s.effect[id] ?? 0.5;
  s.effect[id] = Math.round((e * 0.7 + (noticed ? 1 : 0) * 0.3) * 100) / 100;
  if (!noticed) note(p, "ignore", 0.5);
  markPlayerDirty(p);
}

/** Every minute of play: where they are and when; and what it has not seen in a while fades a little. @param {Player} p @param {any} c context */
export function sample(p, c) {
  const s = ps(p);
  const pr = prof(s);
  for (const k of Object.keys(pr)) {
    pr[k] *= 0.9993;
    if (pr[k] < 0.05) delete pr[k];
  }
  const place = c.underground ? "caves" : c.hauntDist < 16 ? "home" : "surface";
  pr[place] = (pr[place] ?? 0) + 0.1;
  if (c.night) pr.night = (pr.night ?? 0) + 0.1;
  markPlayerDirty(p);
}

/** What it knows, for the Field Notes: the habits it has learned well (strength 0.5+). @param {any} s */
export function known(s) {
  if (S().learning === false) return [];
  const out = HABITS.filter((k) => !["caves", "home", "surface", "night"].includes(k) && habit(s, k) >= 0.5);
  const places = ["caves", "home", "surface"].filter((k) => share(s, k) >= 0.55 && ((s.profile?.caves ?? 0) + (s.profile?.home ?? 0) + (s.profile?.surface ?? 0)) >= 3);
  if (habit(s, "night") >= 0.6) places.push("night");
  return [...out, ...places];
}

export function registerEvents() {
  // the light a player puts down
  world.afterEvents.playerPlaceBlock.subscribe((ev) => {
    if (LIGHTS.test(ev.block.typeId)) safe(() => note(ev.player, "lights", 0.25));
  });
}
