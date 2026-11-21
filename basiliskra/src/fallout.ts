/**
 * Fallout: his own kind of radiation.  Where his light has been (the beam's impact, the ridge scatter, a charge
 * grounded into a rod, the ground he changed on, the seam he came through) a fallout zone is left, and it fades
 * over days.  Inside one:
 *
 *  - the air carries crimson motes and shimmer, and Geiger clicks quicken with the dose;
 *  - in "land" mode the world's own ground changes: grass and dirt turn to irradiated soil, plants wither, wild
 *    leaves fall, snow melts.  Sand his beam hits fuses into scarlet trinitite.  As a zone fades, irradiated soil
 *    heals back to dirt (grass spreads back over it in its own time);
 *  - players in strong fallout get hungry, then weak and sick (vanilla effects, so milk clears them); mobs slow.
 *
 * Bounded like everything else: at most MAX_ZONES zones, a few block reads a tick, only near players, only in
 * loaded chunks, and only ever on natural ground that nothing built touches.
 */
import { Block, Dimension, EquipmentSlot, Player, world } from "@minecraft/server";
import { CONFIG, COUNTER_ITEM, HITBOX, OVERWORLD, SOIL_BLOCK, TICKS, TRINITITE_BLOCK, TYPE } from "./config";
import { particle, players } from "./fx";
import { store } from "./store";
import { dist, distXZ, hash, type V3 } from "./vec";
import { blockAt, isLoaded, isNaturalGround, isPlantBlock, isSolidBlock, overworld } from "./world";

export type Zone = { x: number; y: number; z: number; r: number; s: number; t: number; w?: boolean };

const MAX_ZONES = 32;
const HALF_LIFE = 3 * TICKS.day;          // a zone loses half its strength every three days (at pacing 1)
const GONE = 0.02;                        // below this a zone is forgotten
const HEALING = 0.2;                      // below this the land heals instead of sickening
const NEAR = 96;                          // only zones this close to a player do anything
const SAMPLES_PER_TICK = 6;               // ground columns looked at per tick, all zones together

const SOIL_FROM = new Set(["minecraft:grass_block", "minecraft:dirt", "minecraft:podzol", "minecraft:mycelium", "minecraft:moss_block", "minecraft:coarse_dirt", "minecraft:dirt_with_roots"]);
const WITHERS = /^minecraft:(short_grass|fern|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|.*sapling|sweet_berry_bush|wildflowers|pink_petals|leaf_litter|bush|firefly_bush)$/;
const WITHERS_TALL = /^minecraft:(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|tall_dry_grass)$/;

// ---- custom blocks, with a vanilla stand-in if the game ever refuses them ---------------------------------------
const refused = new Set<string>();
function setTypeOr(b: Block, id: string, fallback: string): boolean {
  if (!refused.has(id)) {
    try { b.setType(id); return true; } catch { refused.add(id); }
  }
  try { b.setType(fallback); return true; } catch { return false; }
}

// ---- the zones --------------------------------------------------------------------------------------------------
const zones = (): Zone[] => store.rec.fallout;

function decayed(z: Zone, now: number): number {
  return z.s * Math.pow(0.5, (Math.max(0, now - z.t) * CONFIG.pacing) / HALF_LIFE);
}

/** Leave fallout at `at`: strength `s` (about 1 is a full beam) over radius `r`.  Merges with a zone already there. */
export function addFallout(at: V3, r: number, s: number): void {
  if (CONFIG.fallout === "off") return;
  const now = store.rec.clock, list = zones();
  for (const z of list) {
    if (dist(z, at) <= Math.max(z.r, r) * 0.75) {
      z.s = Math.min(1.5, decayed(z, now) + s);
      z.t = now;
      z.r = Math.min(9, Math.max(z.r, r));
      store.touch();
      return;
    }
  }
  // under water there is no land to change: such a zone only carries motes and clicks
  let wet = false;
  try { const b = blockAt(overworld(), { x: at.x, y: at.y + 1, z: at.z }); wet = !!b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water"); } catch { wet = false; }
  list.push({ x: Math.floor(at.x) + 0.5, y: Math.floor(at.y), z: Math.floor(at.z) + 0.5, r, s: Math.min(1.5, s), t: now, w: wet });
  if (list.length > MAX_ZONES) {
    let weakest = 0;
    for (let i = 1; i < list.length; i++) if (decayed(list[i], now) < decayed(list[weakest], now)) weakest = i;
    list.splice(weakest, 1);
  }
  store.touch();
}

/** The dose at a place: the sum over zones, strongest at a zone's centre, nothing at its edge. 0 .. about 1.5. */
export function doseAt(p: V3, now = store.rec.clock): number {
  let d = 0;
  for (const z of zones()) {
    const k = dist(p, z);
    if (k < z.r + 1.5) d += decayed(z, now) * Math.max(0, 1 - k / (z.r + 1.5));
  }
  return d;
}

/** The nearest zone that still matters, for the journal and the counter. */
export function nearestFallout(p: V3, now = store.rec.clock): { zone: Zone; strength: number; distance: number } | null {
  let best: { zone: Zone; strength: number; distance: number } | null = null;
  for (const z of zones()) {
    const s = decayed(z, now);
    if (s < 0.05) continue;
    const d = distXZ(p, z);
    if (!best || d < best.distance) best = { zone: z, strength: s, distance: d };
  }
  return best;
}

export const falloutCount = (now = store.rec.clock): number => zones().filter((z) => decayed(z, now) >= 0.05).length;

export function clearFallout(): void { store.rec.fallout = []; store.touch(); }

// ---- the land ---------------------------------------------------------------------------------------------------
/** Built blocks next to it (on its level or the one above) mean it is part of somebody's work. */
function touchesBuilt(dim: Dimension, x: number, y: number, z: number): boolean {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, 1]) {
      const n = blockAt(dim, { x: x + dx, y: y + dy, z: z + dz });
      if (n && isSolidBlock(n) && !isNaturalGround(n.typeId) && !isPlantBlock(n.typeId) && n.typeId !== SOIL_BLOCK && n.typeId !== TRINITITE_BLOCK) return true;
    }
  }
  return false;
}

function naturalLeaves(b: Block): boolean {
  if (!/leaves/.test(b.typeId)) return false;
  try { return (b.permutation.getState("persistent_bit" as never) as unknown) !== true; } catch { return false; }   // placed leaves never fall
}

function puff(dim: Dimension, x: number, y: number, z: number, what: "ash" | "glint"): void {
  particle(dim, what === "ash" ? "basiliskra:fallout_ash" : "basiliskra:rad_glint", { x: x + 0.5, y: y + 0.6, z: z + 0.5 }, 40);
}

/** Look at one column of a zone and let the fallout do what it does there. */
function sample(dim: Dimension, z: Zone, s: number, salt: number): void {
  const a = hash(salt, 1) * Math.PI * 2, rr = Math.sqrt(hash(salt, 2)) * z.r;
  const x = Math.floor(z.x + Math.cos(a) * rr), zz = Math.floor(z.z + Math.sin(a) * rr);
  const local = s * Math.max(0, 1 - rr / (z.r + 1.5));
  if (!isLoaded(dim, { x, y: z.y, z: zz })) return;
  // from a little above the zone downwards: the first thing that is not air
  for (let y = Math.floor(z.y) + 10; y >= Math.floor(z.y) - 6; y--) {
    const b = blockAt(dim, { x, y, z: zz });
    if (!b) return;
    const id = b.typeId;
    if (id === "minecraft:air" || /^minecraft:light_block_\d+$/.test(id)) continue;
    if (id === "minecraft:water" || id === "minecraft:flowing_water" || id === "minecraft:lava") return;     // water carries the motes, nothing else
    if (s < HEALING) {
      // fading: the ground heals
      if (id === SOIL_BLOCK && hash(salt, 3) < 0.5) { try { b.setType("minecraft:dirt"); } catch { /* protected */ } }
      if (isPlantBlock(id) || WITHERS.test(id) || WITHERS_TALL.test(id) || !isSolidBlock(b)) continue;
      return;
    }
    if (hash(salt, 4) > local * 0.6) return;                       // chance grows with the dose
    if (naturalLeaves(b)) {
      if (local > 0.35) { try { b.setType("minecraft:air"); puff(dim, x, y, zz, "ash"); } catch { /* protected */ } }
      return;
    }
    if (isPlantBlock(id)) continue;                                // trunks: look under the canopy
    if (WITHERS_TALL.test(id)) {
      try { blockAt(dim, { x, y: y + 1, z: zz })?.setType("minecraft:air"); b.setType("minecraft:air"); puff(dim, x, y, zz, "ash"); } catch { /* protected */ }
      return;
    }
    if (WITHERS.test(id) || id === "minecraft:snow_layer") {
      try { b.setType("minecraft:air"); puff(dim, x, y, zz, "ash"); } catch { /* protected */ }
      return;
    }
    if (!isSolidBlock(b)) continue;
    if (SOIL_FROM.has(id) && !touchesBuilt(dim, x, y, zz)) {
      const above = blockAt(dim, { x, y: y + 1, z: zz });
      if (above && !isSolidBlock(above) && setTypeOr(b, SOIL_BLOCK, "minecraft:coarse_dirt")) puff(dim, x, y, zz, "glint");
    }
    return;
  }
}

/** Sand the beam itself touches fuses into trinitite (called from the scorch at an impact). */
export function fuse(b: Block): boolean {
  if (CONFIG.fallout !== "land") return false;
  if (b.typeId !== "minecraft:sand" && b.typeId !== "minecraft:red_sand") return false;
  try {
    if (touchesBuilt(b.dimension, b.location.x, b.location.y, b.location.z)) return false;
  } catch { return false; }
  return setTypeOr(b, TRINITITE_BLOCK, "minecraft:smooth_basalt");
}

// ---- every tick -------------------------------------------------------------------------------------------------
let cursor = 0;
const doseOf = new Map<string, number>();

export function falloutTick(now: number): void {
  const list = zones();
  if (CONFIG.fallout === "off" || !list.length) { if (now % 10 === 0) counterTick(now); return; }
  // forget what has faded away
  if (now % 200 === 0) {
    const keep = list.filter((z) => decayed(z, now) >= GONE);
    if (keep.length !== list.length) { store.rec.fallout = keep; store.touch(); }
  }
  const dim = overworld(), ps = players().filter((p) => { try { return p.dimension.id === OVERWORLD; } catch { return false; } });
  if (!ps.length) return;
  const live = list.filter((z) => ps.some((p) => distXZ(p.location, z) < NEAR));
  if (!live.length) { if (now % 10 === 0) counterTick(now); return; }
  // the land, a few columns a tick, round the zones in turn
  const land = live.filter((z) => !z.w);
  if (CONFIG.fallout === "land" && land.length) {
    for (let i = 0; i < SAMPLES_PER_TICK; i++) {
      const z = land[cursor++ % land.length];
      sample(dim, z, decayed(z, now), now * 13 + i * 7 + cursor);
    }
  }
  // the air
  if (now % 3 === 0) {
    for (const z of live) {
      const s = decayed(z, now);
      if (s < 0.05 || hash(now, z.x, z.z) > Math.min(1, s * 1.4)) continue;
      const a = hash(now, z.x, 2) * Math.PI * 2, rr = Math.sqrt(hash(now, z.z, 3)) * z.r;
      const at = { x: z.x + Math.cos(a) * rr, y: z.y + 1 + hash(now, 5) * 2, z: z.z + Math.sin(a) * rr };
      particle(dim, "basiliskra:rad_mote", at, 48);
      if (s > 0.4 && now % 9 === 0) particle(dim, "basiliskra:rad_shimmer", { x: at.x, y: z.y + 0.6, z: at.z }, 40);
    }
  }
  if (now % 10 === 0) counterTick(now);
  if (now % 40 === 0) sicken(dim, live, now, ps);
}

/** Geiger clicks for everyone in fallout, and the counter's read-out for whoever holds one. */
function counterTick(now: number): void {
  for (const p of players()) {
    let at: V3;
    try { if (p.dimension.id !== OVERWORLD) continue; at = p.location; } catch { continue; }
    const d = CONFIG.fallout === "off" ? 0 : doseAt(at, now);
    doseOf.set(p.id, d);
    const holding = holdsCounter(p);
    const level = d < 0.03 ? 0 : d < 0.2 ? 1 : d < 0.45 ? 2 : d < 0.75 ? 3 : 4;
    if (level > 0 || (holding && d > 0.005)) {
      try { p.playSound(`basiliskra.geiger.${Math.max(1, level)}`, { volume: holding ? 0.9 : 0.6 }); } catch { /* left */ }
    }
    if (holding) {
      const n = nearestFallout(at, now);
      const where = n && n.distance > 2 ? `  §7nearest fallout §f${Math.round(n.distance)}§7 blocks ${direction(at, n.zone)}` : "";
      const colour = level >= 3 ? "§c" : level >= 1 ? "§6" : "§a";
      try { p.onScreenDisplay.setActionBar(`${colour}Radiation ${Math.round(Math.min(1, d) * 100)}%${where}`); } catch { /* left */ }
    }
  }
}

function holdsCounter(p: Player): boolean {
  try { return p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId === COUNTER_ITEM; } catch { return false; }
}

function direction(from: V3, to: V3): string {
  const a = (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
  return ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"][((Math.round(a / 45) % 8) + 8) % 8];
}

/** Players in strong fallout get sick; other creatures slow.  Never on Peaceful when that is set, never Creative. */
function sicken(dim: Dimension, live: Zone[], now: number, ps: Player[]): void {
  if (!CONFIG.sickness) return;
  let peaceful = false;
  try { peaceful = CONFIG.harmlessOnPeaceful && String(world.getDifficulty()).toLowerCase() === "peaceful"; } catch { peaceful = false; }
  for (const p of ps) {
    const d = doseOf.get(p.id) ?? 0;
    if (d < 0.15 || peaceful) continue;
    let gm = "";
    try { gm = String(p.getGameMode()); } catch { continue; }
    if (gm === "Creative" || gm === "creative" || gm === "Spectator" || gm === "spectator") continue;
    try {
      p.addEffect("hunger", 80, { amplifier: d > 0.6 ? 1 : 0, showParticles: false });
      if (d > 0.45) { p.addEffect("weakness", 80, { amplifier: 0, showParticles: false }); p.addEffect("nausea", 60, { amplifier: 0, showParticles: false }); }
      if (d > 0.8) p.addEffect("poison", 50, { amplifier: 0, showParticles: false });
    } catch { /* left */ }
  }
  // the creatures standing in it (a few zones a pass)
  let q = 0;
  for (const z of live) {
    const s = decayed(z, now);
    if (s < 0.35 || q++ >= 4) continue;
    try {
      for (const e of dim.getEntities({ location: z, maxDistance: z.r + 1, excludeTypes: ["minecraft:player", "minecraft:item", TYPE, HITBOX] })) {
        try { e.addEffect("slowness", 80, { amplifier: 0, showParticles: false }); e.addEffect("weakness", 80, { amplifier: 0, showParticles: false }); } catch { /* immune */ }
      }
    } catch { /* unloading */ }
  }
}
