// @ts-check
import { world } from "@minecraft/server";

const WKEY = "shaftbreaker:world";
const PKEY = "shaftbreaker:profile";

/**
 * @typedef {{id:string, x:number, y:number, z:number, hx:number, hy:number, hz:number, alive:boolean,
 *   hollow:string|null, big:boolean, destroyedAt:number, cleansed:boolean}} Dwelling
 * @typedef {{organsBroken:number, podsBroken:number, organs:number, rage:number, pods:number[][], dwelling:string|null,
 *   built:boolean, done:boolean, chunks:number, total:number}} HollowState
 */

/** Persistent world data (small; chunk sets are stored separately per hollow). */
export const W = {
  v: 1,
  salt: 0,
  ticks: 0, // ticks of play (counted while at least one player is online)
  lastEncounterEnd: -999999,
  encounters: 0,
  anger: 0,
  deathCooldownUntil: 0,
  /** @type {Record<string, HollowState>} */
  hollows: {},
  /** @type {Dwelling[]} */
  dwellings: [],
  /** @type {number[][]} x,y,z,untilTicks */
  muffled: [],
  /** @type {number[][]} */
  chimes: [],
  dwellerKills: 0,
  lastWasHunt: false,
  /** @type {{cx:number,cy:number,cz:number,R:number}[]} */
  forced: [],
  /** @type {string[]} */
  loneCells: [],
};
let dirty = false;
export const markDirty = () => { dirty = true; };

export function loadWorld() {
  try {
    const raw = world.getDynamicProperty(WKEY);
    if (typeof raw === "string") Object.assign(W, JSON.parse(raw));
  } catch {
    // fresh
  }
  if (!W.salt) {
    W.salt = Math.floor(Math.random() * 2 ** 30) + 1;
    dirty = true;
  }
  W.ticks = Math.round((Number(W.ticks) || 0) / 20) * 20;
  if (!W.hollows) W.hollows = {};
  if (!Array.isArray(W.dwellings)) W.dwellings = [];
  if (!Array.isArray(W.muffled)) W.muffled = [];
  if (!Array.isArray(W.chimes)) W.chimes = [];
}

export function saveWorld(force = false) {
  if (!dirty && !force) return;
  try {
    let s = JSON.stringify(W);
    if (s.length > 30000) {
      // keep the save bounded: forget the oldest dead dwellings / finished hollow details
      W.dwellings = W.dwellings.filter((d) => d.alive || !d.cleansed).slice(-40);
      s = JSON.stringify(W);
    }
    world.setDynamicProperty(WKEY, s);
    dirty = false;
  } catch {
    // ignore
  }
}

/** @param {string} id */
export function hollowState(id) {
  let h = W.hollows[id];
  if (!h) {
    h = { organsBroken: 0, podsBroken: 0, organs: 0, rage: 0, pods: [], dwelling: null, built: false, done: false,
      chunks: 0, total: 0 };
    W.hollows[id] = h;
    dirty = true;
  }
  return h;
}

/** Per-hollow processed chunk set (separate dynamic property to keep the main save small). */
const chunkCache = new Map();
/** @param {string} hid */
export function chunkSet(hid) {
  let s = chunkCache.get(hid);
  if (!s) {
    s = new Set();
    try {
      const raw = world.getDynamicProperty("shaftbreaker:h:" + hid);
      if (typeof raw === "string" && raw.length) for (const k of raw.split(";")) if (k) s.add(k);
    } catch {
      // ignore
    }
    chunkCache.set(hid, s);
  }
  return s;
}
/** @param {string} hid */
export function saveChunkSet(hid) {
  const s = chunkCache.get(hid);
  if (!s) return;
  try {
    world.setDynamicProperty("shaftbreaker:h:" + hid, [...s].join(";"));
  } catch {
    // ignore
  }
}
export function clearChunkCache() { chunkCache.clear(); }

// ------------------------------------------------------------------ player profiles (learning memory, journal)
export function newProfile() {
  return {
    v: 1,
    enc: 0, hunts: 0, escapes: 0, deaths: 0, kills: 0, standoffs: 0, sightings: 0,
    esc: { pillar: 0, surface: 0, shelter: 0, water: 0, seal: 0, fight: 0, ride: 0, run: 0 },
    torch: 0, strip: 0, lookBack: 0, boom: 0, lure: 0, flare: 0,
    /** @type {number[][]} */ hide: [],
    /** @type {number[][]} */ routes: [],
    skills: { doors: 0, climb: 0, break: 0, torch: 0, surface: 0, ambush: 0 },
    /** @type {string[]} */ journal: [],
    rhythm: 12,
    day: -1,
    gotItems: false,
    lastDeathTick: -999999,
  };
}
/** @typedef {ReturnType<typeof newProfile>} Profile */

/** @param {import("@minecraft/server").Player} p @returns {Profile} */
export function loadProfile(p) {
  const prof = newProfile();
  try {
    const raw = p.getDynamicProperty(PKEY);
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw);
      Object.assign(prof, parsed);
      prof.esc = Object.assign(newProfile().esc, parsed.esc || {});
      prof.skills = Object.assign(newProfile().skills, parsed.skills || {});
      if (!Array.isArray(prof.journal)) prof.journal = [];
      if (!Array.isArray(prof.hide)) prof.hide = [];
      if (!Array.isArray(prof.routes)) prof.routes = [];
    }
  } catch {
    // fresh profile
  }
  return prof;
}
/** @param {import("@minecraft/server").Player} p @param {Profile} prof */
export function saveProfile(p, prof) {
  try {
    p.setDynamicProperty(PKEY, JSON.stringify(prof));
  } catch {
    // ignore
  }
}
