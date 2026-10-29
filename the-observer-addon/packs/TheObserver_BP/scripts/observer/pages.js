// @ts-check
// Pages you didn't write. From stage 2, now and then (never more than one per in-game day), a page
// turns up in the player's Field Notes in another hand. Every page is built from something the
// add-on actually tracked about that player: how much they mined, how often they used their door,
// how many times they looked behind them, where they always go back to, how they escape it.
// Stage 4+ pages use the darker variant of each text. When it learns an escape (observer/learn.js)
// it writes that down at once, outside the daily limit.
import { world } from "@minecraft/server";
import { ps, now, markPlayerDirty } from "../core/state.js";
import { S } from "../core/settings.js";
import { safe, rand, emit, trace, allPlayers } from "../core/util.js";
import { SOUNDS } from "../core/constants.js";
import { primaryHaunt } from "./memory.js";

/** @typedef {import("@minecraft/server").Player} Player */

export const MAX_PAGES = 16;
/** seconds between pages (one in-game day = 1200 s), before the frequency setting */
const GAP = [1200, 2100];

/** In-game clock time from a time of day (0 = 06:00). @param {number} tod */
export function clockTime(tod) {
  const h = (Math.floor(tod / 1000) + 6) % 24;
  const m = Math.floor(((tod % 1000) / 1000) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Page templates: key -> what it needs and the numbers it quotes. Each has two texts in the
 * language file: observer.its.<key>.1 (stage 2-3) and observer.its.<key>.2 (stage 4-5).
 * @type {Record<string, (s:any, p:Player)=>(string[]|undefined)>}
 */
const TEMPLATES = {
  mine: (s) => (s.tally?.mine >= 40 ? [String(s.tally.mine)] : undefined),
  chop: (s) => (s.tally?.chop >= 16 ? [String(s.tally.chop)] : undefined),
  dig: (s) => (s.tally?.dig >= 40 ? [String(s.tally.dig)] : undefined),
  light: (s) => (s.tally?.light >= 6 ? [String(s.tally.light)] : undefined),
  doors: (s) => (s.tally?.doors >= 8 ? [String(s.tally.doors)] : undefined),
  store: (s) => (s.tally?.store >= 8 ? [String(s.tally.store)] : undefined),
  eat: (s) => (s.tally?.eat >= 8 ? [String(s.tally.eat)] : undefined),
  fight: (s) => (s.tally?.fight >= 12 ? [String(s.tally.fight)] : undefined),
  sleep: (s) => (s.tally?.sleep >= 1 && s.lastSleep !== undefined ? [clockTime(s.lastSleep)] : undefined),
  turns: (s) => (s.tally?.turns >= 6 ? [String(s.tally.turns)] : undefined),
  walk: (s) => (s.tally?.walk >= 1000 ? [String(Math.floor(s.tally.walk / 100) * 100)] : undefined),
  looked: (s) => (s.sightings >= 2 ? [String(s.sightings)] : undefined),
  deaths: (s) => (s.deaths >= 1 ? [String(s.deaths)] : undefined),
  home: (s, p) => {
    const h = primaryHaunt(p);
    return h ? [String(Math.round(h.center.x)), String(Math.round(h.center.z))] : undefined;
  },
  lens: (s) => (s.disc?.includes("through_the_lens") ? [] : undefined),
  // always possible, used only when nothing else fits
  name: (s, p) => [p.name, p.name, p.name],
};
export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/** @param {Player} p @param {string} key @param {string[]} args */
function add(p, key, args) {
  const s = ps(p);
  if (!Array.isArray(s.its)) s.its = [];
  s.its.push([key, args, Math.floor(now()), safe(() => world.getDay(), 0) ?? 0, s.stage >= 4 ? 2 : 1]);
  while (s.its.length > MAX_PAGES) s.its.shift();
  s.itsUnread = (s.itsUnread ?? 0) + 1;
  markPlayerDirty(p);
  safe(() => p.playSound(SOUNDS.scrawl, { volume: 0.7 }));
  safe(() => p.onScreenDisplay.setActionBar({ rawtext: [{ translate: "observer.ui.its_page" }] }));
  trace(`${p.name}: a page in another hand (${key})`);
  emit("page", { player: p.name, key, args, count: s.its.length });
}

/**
 * Write a page now if one fits. @param {Player} p @param {{force?:boolean, key?:string}} [o]
 * force: ignore the timer (tests, the Config Wheel); key: a specific template.
 * @returns {string|undefined} the template key written
 */
export function write(p, o = {}) {
  const s = ps(p);
  const used = new Set((s.its ?? []).map((x) => x[0]));
  let fits = (o.key ? [o.key] : TEMPLATE_KEYS).map((k) => [k, TEMPLATES[k]?.(s, p)]).filter(([, a]) => a);
  if (fits.length > 1) fits = fits.filter(([k]) => k !== "name");
  if (fits.length === 0) return undefined;
  // prefer something it has not written yet; repeats only quote fresh numbers
  const fresh = fits.filter(([k]) => !used.has(k));
  const [key, args] = (fresh.length ? fresh : fits)[Math.floor(Math.random() * (fresh.length || fits.length))];
  add(p, /** @type {string} */ (key), /** @type {string[]} */ (args));
  return /** @type {string} */ (key);
}

/** It has learned an escape: it says so in the notes (outside the daily limit). @param {Player} p @param {string} method */
export function learned(p, method) {
  if (S().pages === false || !ps(p).notesGiven) return;
  add(p, `learn_${method}`, []);
}

/** Every 20 s from the slow loop. @param {Set<string>} busy ids of players in an encounter right now */
export function tick(busy) {
  const c = S();
  if (!c.enabled || c.pages === false) return;
  const t = now();
  for (const p of allPlayers()) {
    const s = ps(p);
    if (s.stage < 2 || !s.notesGiven || (s.witnessed && s.endMode === "rest")) continue;
    if (!s.itsAt) {
      s.itsAt = t + rand(300, 900);
      markPlayerDirty(p);
      continue;
    }
    if (t < s.itsAt || busy.has(p.id)) continue;
    // its first page waits until it has something real to say (more than the player's name)
    const key = (s.its ?? []).length || TEMPLATE_KEYS.some((k) => k !== "name" && TEMPLATES[k](s, p)) ? write(p) : undefined;
    if (key) s.itsAt = t + rand(GAP[0], GAP[1]) / Math.max(0.5, c.frequency);
    else s.itsAt = t + 300; // nothing to say yet
    markPlayerDirty(p);
  }
}
