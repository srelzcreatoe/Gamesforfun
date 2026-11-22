/**
 * Fallout: his own kind of radiation.  Where his light has been (the beam's impact, the ridge scatter, a charge
 * grounded into a rod, the ground he changed on, the seam he came through) a fallout zone is left.  A zone
 * SPREADS for about a minute, to more than twice the size it was left with; it stands at full strength for a
 * while; then it fades, the land heals, and within a few minutes it is gone.  Inside one:
 *
 *  - the air is thick with crimson motes, a ring of light marks the edge while it spreads, Geiger clicks quicken
 *    with the dose, and in strong fallout the air itself turns red (a fog);
 *  - in "land" mode the world's own ground glows: soil, sand and gravel turn to irradiated soil and bare rock
 *    to irradiated rock (each block remembers what it was, and heals back to exactly that), plants wither, wild
 *    leaves fall, snow melts, and crimson crystals grow.  Where the beam itself lands, rock runs to glowing slag
 *    (which burns to stand on, and cools to dark slag) and sand fuses to scarlet trinitite;
 *  - it is strong: hunger, then weakness and nausea, then poison, and in the heart of a fresh zone it burns.
 *    Iodine tablets keep it off for a few minutes; milk clears what it has done.  Creatures caught in it wither.
 *
 * Bounded like everything else: at most MAX_ZONES zones, a few block reads a tick, only near players, only in
 * loaded chunks, and only ever on natural ground that nothing built touches.  Every glowing block also looks
 * after itself: on a random tick, with no fallout left where it stands, it goes back (the "fades" component),
 * so nothing is left behind by a zone nobody was near when it ended.
 */
import { Block, BlockPermutation, BlockVolume, Dimension, EntityDamageCause, EquipmentSlot, Player, world } from "@minecraft/server";
import { CONFIG, COUNTER_ITEM, CRYSTAL_BLOCK, IODINE_ITEM, OVERWORLD, PART_FAMILY, ROCK_BLOCK, SLAG_BLOCK, SLAG_COLD_BLOCK, SOIL_BLOCK, TICKS, TRINITITE_BLOCK, TYPE } from "./config";
import { particle, players, sizeVars, sound } from "./fx";
import { ROCK_WAS, SOIL_WAS } from "./generated/blocks";
import { store } from "./store";
import { dist, distXZ, hash, type V3 } from "./vec";
import { blockAt, isLoaded, isNaturalGround, isPlantBlock, isSolidBlock, overworld } from "./world";

/**
 * r: its radius when it was last fed; m: the radius it is spreading to; s: its strength when last fed;
 * t: the tick it was last fed; w: under water (no land to change); h: how far the healing sweep has got.
 */
export type Zone = { x: number; y: number; z: number; r: number; s: number; t: number; w?: boolean; m?: number; h?: number };

const MAX_ZONES = 32;
const SPREAD = 50 * TICKS.second;         // how long it spreads for
const GROWTH = 2.4;                       // ... to this many times the radius it was left with
const R_MAX = 24;
const FADE_FROM = 0.45;                   // of its life: until then it stands at full strength
const HEAL_FROM = 0.72;                   // of its life: from here the land heals
const NEAR = 96;                          // only zones this close to a player do anything
const SAMPLES_PER_TICK = 10;              // ground columns looked at per tick, all zones together
const HEALS_PER_TICK = 24;                // glowing blocks put back per tick
const WAS = "basiliskra:was";

/** How long a zone lasts, start to finish: two and a half minutes for a trace, five and a half for a full beam. */
const lifeOf = (s: number): number => (2.5 + 3 * Math.min(1, s)) * 60 * TICKS.second;
const ageOf = (z: Zone, now: number): number => Math.max(0, now - z.t);

/** Its radius now: spreading fast at first, then slowing to a stop. */
export function radiusOf(z: Zone, now = store.rec.clock): number {
  const m = z.m ?? z.r, k = Math.min(1, ageOf(z, now) / SPREAD);
  return z.r + (m - z.r) * (1 - (1 - k) * (1 - k));
}

/** Its strength now: whole until FADE_FROM of its life, then falling away to nothing. */
export function strengthOf(z: Zone, now = store.rec.clock): number {
  const a = ageOf(z, now) / lifeOf(z.s);
  if (a >= 1) return 0;
  return a <= FADE_FROM ? z.s : z.s * Math.pow(1 - (a - FADE_FROM) / (1 - FADE_FROM), 1.4);
}

const healing = (z: Zone, now: number): boolean => ageOf(z, now) >= lifeOf(z.s) * HEAL_FROM;
const spreading = (z: Zone, now: number): boolean => ageOf(z, now) < SPREAD && (z.m ?? z.r) > z.r + 0.5;

const SOIL_INDEX = new Map(SOIL_WAS.map((id, i) => [id, i]));
const ROCK_INDEX = new Map(ROCK_WAS.map((id, i) => [id, i]));
/** Everything of his that glows and goes away again. */
const FADING = [SOIL_BLOCK, ROCK_BLOCK, CRYSTAL_BLOCK, SLAG_BLOCK];
const OURS = new Set([...FADING, TRINITITE_BLOCK, SLAG_COLD_BLOCK]);
const WITHERS = /^minecraft:(short_grass|fern|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|.*sapling|sweet_berry_bush|wildflowers|pink_petals|leaf_litter|bush|firefly_bush|deadbush|short_dry_grass)$/;
const WITHERS_TALL = /^minecraft:(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|tall_dry_grass)$/;

// ---- custom blocks, with a vanilla stand-in if the game ever refuses them ---------------------------------------
const refused = new Set<string>();
/** Put one of his blocks there, remembering what the ground was.  False if the game will not have the block. */
function place(b: Block, id: string, was = 0): boolean {
  if (refused.has(id)) return false;
  try {
    if (was > 0) b.setPermutation(BlockPermutation.resolve(id, { [WAS]: was } as never));
    else b.setType(id);
    return true;
  } catch {
    try { b.setType(id); return true; } catch { refused.add(id); return false; }
  }
}
function setTypeOr(b: Block, id: string, fallback: string, was = 0): boolean {
  if (place(b, id, was)) return true;
  try { b.setType(fallback); return true; } catch { return false; }
}
function wasOf(b: Block): number {
  try { const v = b.permutation.getState(WAS as never) as unknown; return typeof v === "number" ? v : 0; } catch { return 0; }
}

// ---- the zones --------------------------------------------------------------------------------------------------
const zones = (): Zone[] => store.rec.fallout;

/** Leave fallout at `at`: strength `s` (about 1 is a full beam) over radius `r`.  It will spread from there.  Feeds a zone already there. */
export function addFallout(at: V3, r: number, s: number): void {
  if (CONFIG.fallout === "off") return;
  const now = store.rec.clock, list = zones();
  for (const z of list) {
    const rad = radiusOf(z, now);
    if (dist(z, at) <= Math.max(r, Math.min(rad, 8)) * 0.75) {
      z.s = Math.min(1.5, strengthOf(z, now) + s);
      z.r = Math.min(R_MAX, Math.max(rad, r));
      z.m = Math.min(R_MAX, Math.max(z.m ?? 0, z.r, r * GROWTH));
      z.t = now;
      delete z.h;
      store.touch();
      return;
    }
  }
  // under water there is no land to change: such a zone only carries motes and clicks
  let wet = false;
  try { const b = blockAt(overworld(), { x: at.x, y: at.y + 1, z: at.z }); wet = !!b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water"); } catch { wet = false; }
  list.push({ x: Math.floor(at.x) + 0.5, y: Math.floor(at.y), z: Math.floor(at.z) + 0.5, r, m: Math.min(R_MAX, r * GROWTH), s: Math.min(1.5, s), t: now, w: wet });
  if (list.length > MAX_ZONES) {
    let weakest = 0;
    for (let i = 1; i < list.length; i++) if (strengthOf(list[i], now) < strengthOf(list[weakest], now)) weakest = i;
    list.splice(weakest, 1);
  }
  store.touch();
}

/** The dose at a place: the sum over zones, strongest at a zone's centre, nothing at its edge. 0 .. about 1.5. */
export function doseAt(p: V3, now = store.rec.clock): number {
  let d = 0;
  for (const z of zones()) {
    const k = dist(p, z), R = radiusOf(z, now) + 1.5;
    if (k < R) d += strengthOf(z, now) * (1 - k / R);
  }
  return Math.min(1.5, d);
}

/** Is there fallout here that has not started to heal?  (What glows stays lit while there is.) */
function hotAt(p: V3, now: number): boolean {
  for (const z of zones()) if (!healing(z, now) && dist(p, z) < radiusOf(z, now) + 2.5) return true;
  return false;
}

/** The nearest zone that still matters, for the journal and the counter. */
export function nearestFallout(p: V3, now = store.rec.clock): { zone: Zone; strength: number; distance: number; radius: number } | null {
  let best: { zone: Zone; strength: number; distance: number; radius: number } | null = null;
  for (const z of zones()) {
    const s = strengthOf(z, now);
    if (s < 0.05) continue;
    const d = distXZ(p, z);
    if (!best || d < best.distance) best = { zone: z, strength: s, distance: d, radius: radiusOf(z, now) };
  }
  return best;
}

export const falloutCount = (now = store.rec.clock): number => zones().filter((z) => strengthOf(z, now) >= 0.05).length;

export function clearFallout(): void { store.rec.fallout = []; store.touch(); }

// ---- the land ---------------------------------------------------------------------------------------------------
/** Built blocks next to it (on its level or the one above) mean it is part of somebody's work. */
function touchesBuilt(dim: Dimension, x: number, y: number, z: number): boolean {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, 1]) {
      const n = blockAt(dim, { x: x + dx, y: y + dy, z: z + dz });
      if (n && isSolidBlock(n) && !isNaturalGround(n.typeId) && !isPlantBlock(n.typeId)) return true;
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
function sample(dim: Dimension, z: Zone, s: number, R: number, salt: number): void {
  const a = hash(salt, 1) * Math.PI * 2, rr = Math.sqrt(hash(salt, 2)) * R;
  const x = Math.floor(z.x + Math.cos(a) * rr), zz = Math.floor(z.z + Math.sin(a) * rr);
  const local = s * Math.max(0, 1 - rr / (R + 1.5));
  if (!isLoaded(dim, { x, y: z.y, z: zz })) return;
  if (hash(salt, 4) > 0.25 + local) return;                        // chance grows with the dose
  // from a little above the zone downwards: the first thing that is not air
  for (let y = Math.floor(z.y) + 10; y >= Math.floor(z.y) - 8; y--) {
    const b = blockAt(dim, { x, y, z: zz });
    if (!b) return;
    const id = b.typeId;
    if (id === "minecraft:air" || /^minecraft:light_block_\d+$/.test(id) || id === CRYSTAL_BLOCK) continue;
    if (id === "minecraft:water" || id === "minecraft:flowing_water" || id === "minecraft:lava") return;     // water carries the motes, nothing else
    if (naturalLeaves(b)) {
      if (local > 0.25) { try { b.setType("minecraft:air"); puff(dim, x, y, zz, "ash"); } catch { /* protected */ } }
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
    const above = blockAt(dim, { x, y: y + 1, z: zz });
    if (!above || isSolidBlock(above)) return;
    if (OURS.has(id)) {
      // already his: here and there a crystal grows out of it (the same few places every time, so they never crowd)
      if (id !== SLAG_BLOCK && local > 0.3 && above.isAir && hash(x, zz, 77) < 0.075 && place(above, CRYSTAL_BLOCK)) {
        puff(dim, x, y + 1, zz, "glint");
        sound(dim, "place.amethyst_cluster", { x: x + 0.5, y: y + 1, z: zz + 0.5 }, 24, 0.7, 0.6 + hash(salt, 9) * 0.3);
      }
      return;
    }
    const soil = SOIL_INDEX.get(id), rock = ROCK_INDEX.get(id);
    if (soil === undefined && rock === undefined) return;
    if (touchesBuilt(dim, x, y, zz)) return;
    if (soil !== undefined) { if (setTypeOr(b, SOIL_BLOCK, "minecraft:coarse_dirt", soil)) puff(dim, x, y, zz, "glint"); }
    else if (local > 0.2 && place(b, ROCK_BLOCK, rock)) puff(dim, x, y, zz, "glint");
    return;
  }
}

/** One of his glowing blocks goes back to what it was (a crystal crumbles, slag cools).  True if it changed. */
function revert(b: Block): boolean {
  const id = b.typeId;
  try {
    if (id === SOIL_BLOCK) { b.setType(SOIL_WAS[wasOf(b)] ?? SOIL_WAS[0]); return true; }
    if (id === ROCK_BLOCK) { b.setType(ROCK_WAS[wasOf(b)] ?? ROCK_WAS[0]); return true; }
    if (id === SLAG_BLOCK) { if (!place(b, SLAG_COLD_BLOCK)) b.setType("minecraft:blackstone"); return true; }
    if (id === CRYSTAL_BLOCK) {
      b.setType("minecraft:air");
      const at = b.location;
      particle(b.dimension, "basiliskra:crystal_break", { x: at.x + 0.5, y: at.y + 0.4, z: at.z + 0.5 }, 32);
      sound(b.dimension, "break.amethyst_cluster", { x: at.x + 0.5, y: at.y + 0.4, z: at.z + 0.5 }, 20, 0.5, 0.7);
      return true;
    }
  } catch { /* protected area */ }
  return false;
}

/**
 * The "fades" component: one of his blocks has had a random tick.  If no fallout is left where it stands
 * (or fallout is switched off), it goes back.  Registered in main.ts; this is what cleans up after a zone
 * that ended with nobody near.
 */
export function fadeBlock(b: Block): void {
  try {
    if (b.dimension.id !== OVERWORLD) { revert(b); return; }
    const at = b.location;
    if (CONFIG.fallout !== "land" || !hotAt({ x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }, store.rec.clock)) revert(b);
  } catch { /* unloading */ }
}

// the healing sweep: a zone that is fading has its ground gone over once, a tile of it at a time
const healQueue: V3[] = [];
/** One step of healing a zone.  True when the whole of it has been gone over. */
function healStep(dim: Dimension, z: Zone): boolean {
  const R = Math.ceil(z.m ?? z.r) + 3, tiles = Math.ceil((2 * R + 1) / 16), i = z.h ?? 0;
  if (i >= tiles * tiles) return true;
  const x0 = Math.floor(z.x) - R + (i % tiles) * 16, z0 = Math.floor(z.z) - R + Math.floor(i / tiles) * 16;
  const lo = { x: x0, y: Math.floor(z.y) - 14, z: z0 }, hi = { x: Math.min(x0 + 15, Math.floor(z.x) + R), y: Math.floor(z.y) + 14, z: Math.min(z0 + 15, Math.floor(z.z) + R) };
  if (!isLoaded(dim, lo) || !isLoaded(dim, hi)) return false;          // wait for someone to come near enough
  try {
    for (const p of dim.getBlocks(new BlockVolume(lo, hi), { includeTypes: FADING }, true).getBlockLocationIterator()) healQueue.push({ x: p.x, y: p.y, z: p.z });
  } catch { return false; }
  z.h = i + 1;
  store.touch();
  return false;
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

/** The world's own ground at a place turns to his glass (Basiliskra IV's first beam leaves a line of it).  True if it did. */
export function glassify(dim: Dimension, at: V3): boolean {
  if (CONFIG.fallout !== "land") return false;
  const b = blockAt(dim, at);
  if (!b || !isSolidBlock(b) || !isNaturalGround(b.typeId) || b.typeId === TRINITITE_BLOCK) return false;
  if (touchesBuilt(dim, Math.floor(at.x), Math.floor(at.y), Math.floor(at.z))) return false;
  return setTypeOr(b, TRINITITE_BLOCK, "minecraft:smooth_basalt");
}

/**
 * The floor of a crater the beam has just blown: rock runs to glowing slag, sand fuses to trinitite.  `floor`:
 * the places that were emptied; what lies under each is what is seared.  At most `max` blocks.
 */
export function sear(dim: Dimension, floor: V3[], max: number): number {
  if (CONFIG.fallout !== "land") return 0;
  let n = 0;
  for (let i = 0; i < floor.length && n < max; i += 2) {
    const p = floor[i];
    const b = blockAt(dim, { x: p.x, y: p.y - 1, z: p.z });
    if (!b || !isSolidBlock(b)) continue;
    const id = b.typeId;
    if (id === "minecraft:sand" || id === "minecraft:red_sand") { if (fuse(b)) n++; continue; }
    if (!ROCK_INDEX.has(id) && id !== ROCK_BLOCK && id !== "minecraft:cobblestone" && id !== "minecraft:gravel") continue;
    if (touchesBuilt(dim, p.x, p.y - 1, p.z)) continue;
    if (place(b, SLAG_BLOCK)) n++;
  }
  return n;
}

// ---- every tick -------------------------------------------------------------------------------------------------
let cursor = 0;
const doseOf = new Map<string, number>();
const fogged = new Set<string>();
const absorbed = new Map<string, number>();
const BURN_AFTER = 4;                     // about eight seconds in the heart of a zone
const FOG = "bk_fallout";

export function falloutTick(now: number): void {
  const list = zones();
  if (now % 10 === 0) counterTick(now);
  if (CONFIG.fallout === "off" || !list.length) return;
  const dim = overworld(), ps = players().filter((p) => { try { return p.dimension.id === OVERWORLD; } catch { return false; } });
  // forget what is over: its life run out and its ground gone over (or long over, wherever it was)
  if (now % 100 === 0) {
    const keep = list.filter((z) => {
      const over = ageOf(z, now) - lifeOf(z.s);
      if (over < 0) return true;
      const R = Math.ceil(z.m ?? z.r) + 3, tiles = Math.ceil((2 * R + 1) / 16);
      return !(z.w || CONFIG.fallout !== "land" || (z.h ?? 0) >= tiles * tiles || over > 20 * 60 * TICKS.second);
    });
    if (keep.length !== list.length) { store.rec.fallout = keep; store.touch(); }
  }
  if (!ps.length) return;
  const live = list.filter((z) => ps.some((p) => distXZ(p.location, z) < NEAR));
  if (!live.length) return;
  if (CONFIG.fallout === "land") {
    // the land, a few columns a tick, round the zones in turn
    const land = live.filter((z) => !z.w && !healing(z, now));
    for (let i = 0; i < SAMPLES_PER_TICK && land.length; i++) {
      const z = land[cursor++ % land.length];
      sample(dim, z, strengthOf(z, now), radiusOf(z, now), now * 13 + i * 7 + cursor);
    }
    // and where it is fading, the land heals
    for (let n = 0; n < HEALS_PER_TICK && healQueue.length; n++) { const b = blockAt(dim, healQueue.pop() as V3); if (b) revert(b); }
    if (!healQueue.length && now % 4 === 0) {
      for (const q of live) {
        if (q.w || !healing(q, now)) continue;
        const before = q.h ?? 0;
        healStep(dim, q);
        if ((q.h ?? 0) !== before) break;                 // one tile a pass (a zone whose ground is not loaded waits its turn)
      }
    }
  }
  // the air: thick with motes, and a ring of light at the edge while it spreads
  if (now % 8 === 0) {
    let shown = 0;
    for (const z of live) {
      const s = strengthOf(z, now);
      if (s < 0.05 || shown >= 8) continue;
      shown++;
      const R = radiusOf(z, now), at = { x: z.x, y: z.y + 0.6, z: z.z };
      if (hash(now, z.x, z.z) < Math.min(1, 0.35 + s)) particle(dim, "basiliskra:rad_cloud", at, 72, sizeVars(R));
      if (now % 16 === 0 && spreading(z, now)) particle(dim, "basiliskra:rad_front", at, 80, sizeVars(R));
      if (s > 0.4 && now % 24 === 0) {
        const a = hash(now, z.x, 2) * Math.PI * 2, rr = Math.sqrt(hash(now, z.z, 3)) * R * 0.6;
        particle(dim, "basiliskra:rad_shimmer", { x: z.x + Math.cos(a) * rr, y: z.y + 0.6, z: z.z + Math.sin(a) * rr }, 40);
      }
    }
  }
  if (now % 40 === 0) sicken(dim, live, now, ps);
}

/** Geiger clicks and the red air for everyone in fallout, the counter's read-out for whoever holds one, and hot slag underfoot. */
function counterTick(now: number): void {
  for (const p of players()) {
    let at: V3;
    try { if (p.dimension.id !== OVERWORLD) { clearFog(p); continue; } at = p.location; } catch { continue; }
    const d = CONFIG.fallout === "off" ? 0 : doseAt(at, now);
    doseOf.set(p.id, d);
    const holding = holdsCounter(p);
    const level = d < 0.03 ? 0 : d < 0.2 ? 1 : d < 0.45 ? 2 : d < 0.75 ? 3 : 4;
    if (level > 0 || (holding && d > 0.005)) {
      try { p.playSound(`basiliskra.geiger.${Math.max(1, level)}`, { volume: holding ? 0.9 : 0.6 }); } catch { /* left */ }
    }
    // the air turns red in strong fallout (and clears a little way out, so the edge does not flicker)
    if (d >= 0.3 && !fogged.has(p.id)) { try { p.runCommand(`fog @s push basiliskra:fallout_fog ${FOG}`); fogged.add(p.id); } catch { /* commands unavailable */ } }
    else if (d < 0.2 && fogged.has(p.id)) clearFog(p);
    if (holding) {
      const n = nearestFallout(at, now);
      const where = n && n.distance > n.radius ? `  §7fallout §f${Math.round(n.distance - n.radius)}§7 blocks ${direction(at, n.zone)}` : "";
      const colour = level >= 3 ? "§c" : level >= 1 ? "§6" : "§a";
      const shield = protectedFor(p, now);
      try { p.onScreenDisplay.setActionBar(`${colour}Radiation ${Math.round(Math.min(1, d) * 100)}%${shield > 0 ? `  §bIodine ${Math.ceil(shield / TICKS.second)}s` : ""}${where}`); } catch { /* left */ }
    } else if (level >= 3 && now % 40 === 0) {
      // nobody needs an instrument to know this is bad
      try { p.onScreenDisplay.setActionBar(protectedFor(p, now) > 0 ? "§6Heavy fallout §7(the iodine is holding)" : "§cHeavy fallout: get out of the red"); } catch { /* left */ }
    }
    // glowing slag burns whoever stands on it
    try {
      const under = blockAt(p.dimension, { x: at.x, y: at.y - 0.3, z: at.z });
      if (under?.typeId === SLAG_BLOCK && vulnerable(p)) { p.setOnFire(4, true); p.applyDamage(2 * CONFIG.damage, { cause: EntityDamageCause.fire }); }
    } catch { /* left */ }
  }
}

function clearFog(p: Player): void {
  if (!fogged.delete(p.id)) return;
  try { p.runCommand(`fog @s remove ${FOG}`); } catch { /* left */ }
}

/** A player joining: no haze left over from another session. */
export function falloutJoin(p: Player): void {
  fogged.delete(p.id);
  try { p.runCommand(`fog @s remove ${FOG}`); } catch { /* commands unavailable */ }
}

// ---- iodine -------------------------------------------------------------------------------------------------------
const IODINE_TICKS = 4 * 60 * TICKS.second;
const IODINE_PROP = "bk:iodine";
/** Ticks of protection a player has left. */
export function protectedFor(p: Player, now = store.rec.clock): number {
  try { const until = p.getDynamicProperty(IODINE_PROP); return typeof until === "number" ? Math.max(0, Math.min(IODINE_TICKS, until - now)) : 0; } catch { return 0; }
}
/** A player has swallowed iodine tablets: the fallout cannot sicken them for four minutes, and what it had done is cleared. */
export function takeIodine(p: Player): void {
  try {
    p.setDynamicProperty(IODINE_PROP, store.rec.clock + IODINE_TICKS);
    for (const e of ["hunger", "weakness", "nausea", "poison", "wither"]) { try { p.removeEffect(e); } catch { /* not on them */ } }
    p.onScreenDisplay.setActionBar("§bIodine: the fallout cannot make you sick for four minutes. §7(Glowing slag still burns.)");
    p.playSound("random.orb", { volume: 0.6, pitch: 0.7 });
  } catch { /* left */ }
}
export const isIodine = (id: string | undefined): boolean => id === IODINE_ITEM;

function holdsCounter(p: Player): boolean {
  try { return p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId === COUNTER_ITEM; } catch { return false; }
}

function direction(from: V3, to: V3): string {
  const a = (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
  return ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"][((Math.round(a / 45) % 8) + 8) % 8];
}

/** Can this player be harmed by it at all?  Never on Peaceful when that is set, never Creative or Spectator. */
function vulnerable(p: Player): boolean {
  try {
    if (CONFIG.harmlessOnPeaceful && String(world.getDifficulty()).toLowerCase() === "peaceful") return false;
    const gm = String(p.getGameMode()).toLowerCase();
    return gm !== "creative" && gm !== "spectator";
  } catch { return false; }
}

/** Players in fallout get sick, quickly and badly; other creatures wither. */
function sicken(dim: Dimension, live: Zone[], now: number, ps: Player[]): void {
  if (!CONFIG.sickness) return;
  for (const p of ps) {
    const d = doseOf.get(p.id) ?? 0;
    // what a body has taken in builds while it stands in strong fallout, and leaves again outside it
    const open = vulnerable(p) && protectedFor(p, now) <= 0;
    const took = Math.max(0, (absorbed.get(p.id) ?? 0) + (open && d > 0.5 ? d : -0.75));
    if (took > 0) absorbed.set(p.id, Math.min(12, took)); else absorbed.delete(p.id);
    if (d < 0.1 || !open) continue;
    try {
      p.addEffect("hunger", 100, { amplifier: d > 0.5 ? 2 : d > 0.3 ? 1 : 0, showParticles: false });
      if (d > 0.3) { p.addEffect("weakness", 100, { amplifier: d > 0.7 ? 1 : 0, showParticles: false }); p.addEffect("nausea", 140, { amplifier: 0, showParticles: false }); }
      if (d > 0.5) p.addEffect("poison", 60, { amplifier: d > 0.9 ? 1 : 0, showParticles: false });
      // the heart of a fresh zone burns, once a body has stood in it for a few seconds: nothing to wait out, only to leave
      if (d > 0.8 && took >= BURN_AFTER) p.applyDamage(Math.max(1, Math.round(2 * CONFIG.damage)), { cause: EntityDamageCause.magic });
    } catch { /* left */ }
  }
  // the creatures standing in it (a few zones a pass)
  let q = 0;
  for (const z of live) {
    const s = strengthOf(z, now);
    if (s < 0.3 || q++ >= 4) continue;
    try {
      const R = radiusOf(z, now);
      for (const e of dim.getEntities({ location: z, maxDistance: R, excludeTypes: ["minecraft:player", "minecraft:item", TYPE], excludeFamilies: [PART_FAMILY] })) {
        try {
          e.addEffect("slowness", 100, { amplifier: 0, showParticles: false });
          e.addEffect("weakness", 100, { amplifier: 0, showParticles: false });
          if (s * (1 - dist(e.location, z) / (R + 1.5)) > 0.45) e.addEffect("wither", 60, { amplifier: 0, showParticles: false });
        } catch { /* immune */ }
      }
    } catch { /* unloading */ }
  }
}
