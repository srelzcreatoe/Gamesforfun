/**
 * What opens the rift: repeated, player-caused deaths of passive animals together with the
 * stripping of habitat in the same stretch of country.  One meal and one felled tree weigh
 * next to nothing; an undisturbed region heals; each player's share is kept apart so a friend
 * who has just joined inherits none of the blame.  The history is bounded.
 */
import { CONFIG, TICKS } from "./config";
import { store, type Site } from "./store";
import type { V3 } from "./vec";

const REGION = 64;                      // blocks
const MAX_REGIONS = 40;
const MAX_SITES = 4;
const MAX_PLAYERS = 8;
const MAX_GLOBAL_SITES = 24;
const HALF_LIFE = 2 * TICKS.day;        // an untouched region loses half its score every two days
const RECENT_HALF_LIFE = TICKS.day / 2;

/** Passive animals, and the call each is remembered by (vanilla sound events). */
export const ANIMALS: Record<string, string> = {
  "minecraft:cow": "mob.cow.say", "minecraft:mooshroom": "mob.cow.say", "minecraft:sheep": "mob.sheep.say",
  "minecraft:pig": "mob.pig.say", "minecraft:chicken": "mob.chicken.say", "minecraft:rabbit": "mob.rabbit.idle",
  "minecraft:horse": "mob.horse.idle", "minecraft:donkey": "mob.horse.donkey.idle", "minecraft:mule": "mob.horse.donkey.idle",
  "minecraft:llama": "mob.llama.idle", "minecraft:goat": "mob.goat.ambient", "minecraft:fox": "mob.fox.ambient",
  "minecraft:turtle": "mob.turtle.ambient", "minecraft:cod": "mob.fish.flop", "minecraft:salmon": "mob.fish.flop",
  "minecraft:tropicalfish": "mob.fish.flop", "minecraft:squid": "mob.squid.ambient", "minecraft:glow_squid": "mob.glow_squid.ambient",
  "minecraft:dolphin": "mob.dolphin.idle", "minecraft:axolotl": "mob.axolotl.idle", "minecraft:frog": "mob.frog.ambient",
  "minecraft:camel": "mob.camel.ambient", "minecraft:panda": "mob.panda.idle", "minecraft:parrot": "mob.parrot.idle",
  "minecraft:bee": "mob.bee.loop", "minecraft:armadillo": "mob.armadillo.ambient", "minecraft:sniffer": "mob.sniffer.idle",
  "minecraft:polar_bear": "mob.polarbear.idle", "minecraft:ocelot": "mob.ocelot.idle", "minecraft:bat": "mob.bat.idle",
};

/** Habitat a player can strip, and what each block is worth. */
export function habitatWeight(typeId: string): number {
  const id = typeId.replace("minecraft:", "");
  if (id.endsWith("_log") || id.endsWith("_stem") || id === "mangrove_roots") return 0.3;
  if (id === "reeds" || id === "sugar_cane") return 0.4;
  if (id === "waterlily" || id === "lily_pad") return 0.4;
  if (id === "kelp" || id === "seagrass" || id === "sea_pickle") return 0.25;
  if (id === "bamboo" || id === "mangrove_propagule") return 0.2;
  if (id.includes("coral")) return 0.4;
  if (id.endsWith("_leaves") || id.endsWith("leaves")) return 0.04;
  if (id === "tall_grass" || id === "short_grass" || id === "fern" || id === "large_fern") return 0.03;
  return 0;
}

interface Region {
  a: number;      // animals
  h: number;      // habitat
  ra: number;     // recent kills (fast decay): makes the first kill of a spree nearly weightless
  rh: number;     // recent habitat
  t: number;      // last update (absolute tick)
  by: Record<string, number>;
  names: Record<string, string>;
  sites: Site[];
  fired?: boolean;
}

export interface Trigger { region: string; site: V3; guilty: string | null; guiltyName: string | null }

function keyOf(p: V3): string { return `${Math.floor(p.x / REGION)},${Math.floor(p.z / REGION)}`; }

function decay(r: Region, now: number): void {
  const dt = Math.max(0, now - r.t);
  if (dt <= 0) return;
  const k = Math.pow(0.5, (dt * CONFIG.pacing) / HALF_LIFE);
  const kr = Math.pow(0.5, dt / RECENT_HALF_LIFE);
  r.a *= k; r.h *= k; r.ra *= kr; r.rh *= kr;
  for (const id of Object.keys(r.by)) { r.by[id] *= k; if (r.by[id] < 0.05) { delete r.by[id]; delete r.names[id]; } }
  r.t = now;
}

function region(p: V3, now: number): Region {
  const regs = store.harm.regions as Record<string, Region>;
  const k = keyOf(p);
  let r = regs[k];
  if (!r) {
    const keys = Object.keys(regs);
    if (keys.length >= MAX_REGIONS) {
      // forget the region with the least left in it
      let worst = keys[0], low = Infinity;
      for (const kk of keys) { decay(regs[kk], now); const s = regs[kk].a + regs[kk].h; if (s < low) { low = s; worst = kk; } }
      delete regs[worst];
    }
    r = regs[k] = { a: 0, h: 0, ra: 0, rh: 0, t: now, by: {}, names: {}, sites: [] };
  }
  decay(r, now);
  return r;
}

function credit(r: Region, playerId: string, name: string, w: number): void {
  if (!(playerId in r.by) && Object.keys(r.by).length >= MAX_PLAYERS) {
    let least = "", low = Infinity;
    for (const [id, s] of Object.entries(r.by)) if (s < low) { low = s; least = id; }
    delete r.by[least]; delete r.names[least];
  }
  r.by[playerId] = (r.by[playerId] ?? 0) + w;
  r.names[playerId] = name;
}

export const THRESHOLD = { animals: 8, habitat: 6, total: 18 };

function check(r: Region, key: string, at: V3): Trigger | null {
  const p = CONFIG.pacing;
  // over the line: say so every time.  Whether anything comes of it is the controller's decision, so a
  // call that could not be answered (no deep water near, or one already owed) is never used up here.
  if (r.a * p < THRESHOLD.animals || r.h * p < THRESHOLD.habitat || (r.a + r.h) * p < THRESHOLD.total) return null;
  let guilty: string | null = null, top = 0;
  for (const [id, s] of Object.entries(r.by)) if (s > top) { top = s; guilty = id; }
  let site = at;
  if (r.sites.length) {
    const n = r.sites.length;
    site = { x: r.sites.reduce((s, q) => s + q.x, 0) / n, y: r.sites.reduce((s, q) => s + q.y, 0) / n, z: r.sites.reduce((s, q) => s + q.z, 0) / n };
  }
  return { region: key, site, guilty, guiltyName: guilty ? r.names[guilty] ?? null : null };
}

/** A passive animal died to a player.  Natural deaths never reach here. */
export function recordKill(at: V3, typeId: string, playerId: string, playerName: string, now: number): Trigger | null {
  const call = ANIMALS[typeId];
  if (!call) return null;
  const r = region(at, now);
  // one meal weighs little; the third kill of a spree weighs in full
  const w = Math.min(1, Math.max(0.15, r.ra / 2));
  r.ra += 1;
  r.a += w;
  credit(r, playerId, playerName, w);
  const site: Site = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z), s: call, t: now };
  r.sites.push(site);
  if (r.sites.length > MAX_SITES) r.sites.shift();
  const all = store.rec.sites;
  all.push(site);
  if (all.length > MAX_GLOBAL_SITES) all.shift();
  store.touch();
  store.touchHarm();
  return check(r, keyOf(at), at);
}

/** A player removed habitat. */
export function recordHabitat(at: V3, typeId: string, playerId: string, playerName: string, now: number): Trigger | null {
  const base = habitatWeight(typeId);
  if (base <= 0) return null;
  const r = region(at, now);
  // one felled tree is a handful of logs at a fraction of their weight
  const w = base * Math.min(1, Math.max(0.3, r.rh / 2));
  r.rh += base * 2.2;
  r.h += w;
  credit(r, playerId, playerName, w);
  store.touchHarm();
  return check(r, keyOf(at), at);
}

export function regionScore(at: V3, now: number): { a: number; h: number; by: Record<string, number> } {
  const r = region(at, now);
  return { a: r.a, h: r.h, by: { ...r.by } };
}
