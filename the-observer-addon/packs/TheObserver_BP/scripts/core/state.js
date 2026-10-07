// @ts-check
import { world, system } from "@minecraft/server";
import { DEBUG, allPlayers } from "./util.js";

const CHUNK = 30000;
const WORLD_KEY = "observer:world";
const PLAYER_KEY = "observer:player";
const CLOCK_KEY = "observer:clock";
export const SCHEMA_VERSION = 1;

/**
 * Store JSON under key, split across key, key#1, key#2 ... (dynamic property strings cap near 32k chars).
 * @param {{setDynamicProperty:Function,getDynamicProperty:Function}} holder
 * @param {string} key @param {any} value
 */
export function saveJSON(holder, key, value) {
  const s = JSON.stringify(value);
  const parts = Math.max(1, Math.ceil(s.length / CHUNK));
  holder.setDynamicProperty(key, `${parts}|` + s.slice(0, CHUNK));
  for (let i = 1; i < parts; i++) holder.setDynamicProperty(`${key}#${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK));
  // clear stale tail chunks from a previous, longer save
  for (let i = parts; i < parts + 8; i++) {
    if (holder.getDynamicProperty(`${key}#${i}`) === undefined) break;
    holder.setDynamicProperty(`${key}#${i}`, undefined);
  }
}

/** @param {{getDynamicProperty:Function}} holder @param {string} key @param {any} fallback */
export function loadJSON(holder, key, fallback) {
  const head = holder.getDynamicProperty(key);
  if (typeof head !== "string") return fallback;
  const bar = head.indexOf("|");
  const parts = parseInt(head.slice(0, bar), 10) || 1;
  let s = head.slice(bar + 1);
  for (let i = 1; i < parts; i++) {
    const p = holder.getDynamicProperty(`${key}#${i}`);
    if (typeof p !== "string") return fallback;
    s += p;
  }
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- world state

/** @returns {WorldState} */
function freshWorld() {
  return {
    v: SCHEMA_VERSION,
    clock: 0,
    settings: null,
    active: null,
    globalCooldownUntil: 0,
    wards: [],
    traces: [],
    nextEnc: 1,
    stats: { encounters: 0, byType: {} },
  };
}

/**
 * @typedef {Object} WorldState
 * @property {number} v
 * @property {number} clock  seconds of world time with the add-on running
 * @property {any} settings
 * @property {{enc:number,type:string,target:string,started:number,entity?:string}|null} active  interrupted-encounter recovery
 * @property {number} globalCooldownUntil
 * @property {number[][]} wards  [dim,x,y,z]
 * @property {any[]} traces  evidence points (footprint trails)
 * @property {number} nextEnc
 * @property {{encounters:number, byType:Record<string,number>}} stats
 */

/** @type {WorldState} */
export let W = freshWorld();
let worldDirty = false;
let clockBaseTick = 0;
let clockBase = 0;

export function loadWorld() {
  const loaded = loadJSON(world, WORLD_KEY, null);
  W = Object.assign(freshWorld(), loaded || {});
  if (W.v !== SCHEMA_VERSION) W.v = SCHEMA_VERSION; // future migrations go here
  // the clock is saved every few seconds on its own, so timers survive a crash between full saves
  const c = world.getDynamicProperty(CLOCK_KEY);
  if (typeof c === "number" && c > W.clock) W.clock = c;
  clockBase = W.clock;
  clockBaseTick = system.currentTick;
  return !!loaded;
}

export function markWorldDirty() {
  worldDirty = true;
}

export function saveWorld(force = false) {
  W.clock = now();
  try {
    world.setDynamicProperty(CLOCK_KEY, W.clock);
  } catch (e) {
    DEBUG.log(`save clock failed: ${e}`);
  }
  if (!worldDirty && !force) return;
  saveJSON(world, WORLD_KEY, W);
  worldDirty = false;
}

/** Developer aid: advance the add-on clock (timers, cooldowns, restorations). @param {number} sec */
export function warp(sec) {
  clockBase += sec;
}

/** Persistent add-on clock in seconds (does not depend on /time set). */
export function now() {
  return clockBase + (system.currentTick - clockBaseTick) / 20;
}

// ---------------------------------------------------------------- player state

/**
 * @typedef {Object} PlayerState
 * @property {number} v
 * @property {number} first        clock when first seen
 * @property {number} play         seconds played with the add-on
 * @property {number} stage        0 unaware .. 5 escalation
 * @property {number} exposure
 * @property {number} tension      0..100
 * @property {number} nextAt       clock of next allowed encounter
 * @property {number} quietUntil
 * @property {number} recoveryUntil
 * @property {number} sinceQuiet   encounters since last long quiet period
 * @property {number} encCount
 * @property {any[]} hist          recent encounters [type, at, outcome, dim, x, z]
 * @property {Record<string,number>} typeLast
 * @property {string[]} disc       discoveries
 * @property {number} sightings
 * @property {number} bearing      favoured relative bearing (deg, relative to view yaw)
 * @property {number} bearingDist
 * @property {number} bearingHits
 * @property {any[]} haunts        [dim,cx,cz,score,lastVisit,y]
 * @property {any[]} crumbs        [dim,x,y,z,t]
 * @property {Record<string,number[]>} route   cellKey -> [visits, lastVisit]
 * @property {Record<string,number>} habits
 * @property {Record<string,number[]>} lastAct  habit -> [dim,x,y,z,t]
 * @property {number} attn         attentiveness estimate 0..1
 * @property {number} composure    how much more pressure the Observer will take before a long withdrawal
 * @property {boolean} witnessed
 * @property {string} endMode      "" | "attendant" | "endless" | "rest"
 * @property {number[][]} marks    chalk marks [dim,x,y,z,smudged]
 * @property {boolean} notesGiven
 * @property {number} stingAt      last sudden scare
 * @property {number} vigilTries
 * @property {number} deaths
 * @property {boolean} [captions] per-player caption preference (undefined = world default)
 * @property {number} [followAt]   pending dimension follow-up (clock)
 * @property {number[]} [followFrom] [dim,x,y,z] where the player left/arrived
 */

/** @returns {PlayerState} */
export function freshPlayer(t) {
  return {
    v: SCHEMA_VERSION, first: t, play: 0, stage: 0, exposure: 0, tension: 0, nextAt: 0, quietUntil: 0,
    recoveryUntil: 0, sinceQuiet: 0, encCount: 0, hist: [], typeLast: {}, disc: [], sightings: 0,
    bearing: 0, bearingDist: 0, bearingHits: 0, haunts: [], crumbs: [], route: {}, habits: {}, lastAct: {},
    attn: 0.5, composure: 3, witnessed: false, endMode: "", marks: [], notesGiven: false, stingAt: -1e9,
    vigilTries: 0, deaths: 0,
  };
}

/** @type {Map<string, PlayerState>} */
const players = new Map();
/** @type {Set<string>} */
const dirtyPlayers = new Set();

/** @param {import("@minecraft/server").Player} player @returns {PlayerState} */
export function ps(player) {
  let s = players.get(player.id);
  if (!s) {
    const loaded = loadJSON(player, PLAYER_KEY, null);
    s = Object.assign(freshPlayer(now()), loaded || {});
    players.set(player.id, s);
    if (!loaded) dirtyPlayers.add(player.id);
  }
  return s;
}

/** @param {import("@minecraft/server").Player} player */
export function markPlayerDirty(player) {
  dirtyPlayers.add(player.id);
}

/** @param {import("@minecraft/server").Player} player */
export function resetPlayer(player) {
  players.set(player.id, freshPlayer(now()));
  dirtyPlayers.add(player.id);
}

export function savePlayers(force = false) {
  for (const p of allPlayers()) {
    if (!force && !dirtyPlayers.has(p.id)) continue;
    const s = players.get(p.id);
    if (!s) continue;
    try {
      saveJSON(p, PLAYER_KEY, s);
      dirtyPlayers.delete(p.id);
    } catch (e) {
      DEBUG.log(`save player ${p.name} failed: ${e}`);
    }
  }
}

/** Save one player now (used when they leave). @param {import("@minecraft/server").Player} player */
export function savePlayer(player) {
  const s = players.get(player.id);
  if (!s) return;
  saveJSON(player, PLAYER_KEY, s);
  dirtyPlayers.delete(player.id);
}

/** Forget cached state for a player who left (it was saved on the player while online). @param {string} id */
export function dropPlayer(id) {
  players.delete(id);
  dirtyPlayers.delete(id);
}
