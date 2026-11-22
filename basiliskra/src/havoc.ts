/**
 * What he breaks.  In "wither" mode his beam blasts out whatever it meets, his roar throws a shockwave across the
 * ground, and his weight smashes through anything built in his way.  In every mode bedrock, portals and command
 * blocks survive; with `spareStorage` on (the default) so does anything that holds things (chests, barrels,
 * shulker boxes, beds, furnaces, hoppers...) and the obsidian a portal stands in.
 *
 * Everything here is bounded: a carve or a crush is given a block budget and stops there, and nothing reads
 * or writes an unloaded chunk.
 */
import { BlockVolume, Dimension, Entity, EntityDamageCause, Player } from "@minecraft/server";
import { CONFIG, PART_FAMILY, TYPE } from "./config";
import { particle, sound, witnesses } from "./fx";
import { add, dist, norm, type V3 } from "./vec";
import { blockAt, isLoaded, isNaturalGround, isPlantBlock, isSolidBlock } from "./world";

/** Never broken, in any mode. */
const NEVER = /^minecraft:(bedrock|invisible_bedrock|barrier|(chain_|repeating_)?command_block|structure_block|structure_void|jigsaw|end_portal|end_portal_frame|end_gateway|portal|reinforced_deepslate|light_block.*|border_block|allow|deny|trial_spawner|vault|mob_spawner|moving_block|(sticky_)?piston_arm_collision)$/;
/** Spared while `spareStorage` is on: what holds things, what people sleep in, and portal frames. */
const STORAGE = /(chest|barrel|shulker_box|^minecraft:bed$|_bed$|furnace|smoker|hopper|dispenser|dropper|crafter|brewing_stand|lectern|bookshelf|decorated_pot|jukebox|beacon|respawn_anchor|lodestone|enchanting_table|anvil|frame$|flower_pot|cauldron|obsidian|_sign$|standing_sign|wall_sign|hanging_sign|banner|campfire|beehive|bee_nest|chiseled_bookshelf|vault|crafting_table)/;
/** Thin, brittle or loose: what a roar's shockwave breaks (glass only in wither mode). */
const FRAGILE = /^minecraft:(short_grass|tall_grass|short_dry_grass|tall_dry_grass|fern|large_fern|deadbush|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|snow_layer|.*sapling|wildflowers|pink_petals|leaf_litter|bush|firefly_bush|sweet_berry_bush|.*mushroom|vine|glow_lichen|.*_leaves|azalea_leaves_flowered|cactus_flower|.*eyeblossom|torchflower|pitcher_plant|wither_rose)$/;
const GLASS = /^minecraft:(.*glass(_pane)?|.*_stained_glass.*|glass|glass_pane|tinted_glass|.*lantern|.*torch|.*candle)$/;

export const wither = (): boolean => CONFIG.terrain === "wither";
/** The same, as the exact 1.26.60 ids the engine's block query takes (checked against the vanilla block list). */
const FRAGILE_IDS = [
  "acacia_leaves", "acacia_sapling", "allium", "azalea_leaves", "azalea_leaves_flowered", "azure_bluet",
  "bamboo_sapling", "birch_leaves", "birch_sapling", "blue_orchid", "brown_mushroom", "bush", "cactus_flower",
  "cherry_leaves", "cherry_sapling", "closed_eyeblossom", "cornflower", "dandelion", "dark_oak_leaves",
  "dark_oak_sapling", "deadbush", "fern", "firefly_bush", "glow_lichen", "jungle_leaves", "jungle_sapling",
  "large_fern", "leaf_litter", "lilac", "lily_of_the_valley", "mangrove_leaves", "oak_leaves", "oak_sapling",
  "open_eyeblossom", "orange_poplar_leaves", "orange_tulip", "oxeye_daisy", "pale_oak_leaves", "pale_oak_sapling",
  "peony", "pink_petals", "pink_tulip", "pitcher_plant", "poplar_sapling", "poppy", "red_mushroom",
  "red_poplar_leaves", "red_tulip", "rose_bush", "short_dry_grass", "short_grass", "snow_layer", "spruce_leaves",
  "spruce_sapling", "sunflower", "sweet_berry_bush", "tall_dry_grass", "tall_grass", "torchflower", "vine",
  "white_tulip", "wildflowers", "wither_rose", "yellow_poplar_leaves"
].map((n) => "minecraft:" + n);
const GLASS_IDS = [
  "black_candle", "black_stained_glass", "black_stained_glass_pane", "blue_candle", "blue_stained_glass",
  "blue_stained_glass_pane", "brown_candle", "brown_stained_glass", "brown_stained_glass_pane", "candle",
  "copper_lantern", "copper_torch", "cyan_candle", "cyan_stained_glass", "cyan_stained_glass_pane",
  "exposed_copper_lantern", "glass", "glass_pane", "gray_candle", "gray_stained_glass", "gray_stained_glass_pane",
  "green_candle", "green_stained_glass", "green_stained_glass_pane", "hard_black_stained_glass",
  "hard_black_stained_glass_pane", "hard_blue_stained_glass", "hard_blue_stained_glass_pane",
  "hard_brown_stained_glass", "hard_brown_stained_glass_pane", "hard_cyan_stained_glass",
  "hard_cyan_stained_glass_pane", "hard_glass", "hard_glass_pane", "hard_gray_stained_glass",
  "hard_gray_stained_glass_pane", "hard_green_stained_glass", "hard_green_stained_glass_pane",
  "hard_light_blue_stained_glass", "hard_light_blue_stained_glass_pane", "hard_light_gray_stained_glass",
  "hard_light_gray_stained_glass_pane", "hard_lime_stained_glass", "hard_lime_stained_glass_pane",
  "hard_magenta_stained_glass", "hard_magenta_stained_glass_pane", "hard_orange_stained_glass",
  "hard_orange_stained_glass_pane", "hard_pink_stained_glass", "hard_pink_stained_glass_pane",
  "hard_purple_stained_glass", "hard_purple_stained_glass_pane", "hard_red_stained_glass",
  "hard_red_stained_glass_pane", "hard_white_stained_glass", "hard_white_stained_glass_pane",
  "hard_yellow_stained_glass", "hard_yellow_stained_glass_pane", "lantern", "light_blue_candle",
  "light_blue_stained_glass", "light_blue_stained_glass_pane", "light_gray_candle", "light_gray_stained_glass",
  "light_gray_stained_glass_pane", "lime_candle", "lime_stained_glass", "lime_stained_glass_pane", "magenta_candle",
  "magenta_stained_glass", "magenta_stained_glass_pane", "orange_candle", "orange_stained_glass",
  "orange_stained_glass_pane", "oxidized_copper_lantern", "pink_candle", "pink_stained_glass",
  "pink_stained_glass_pane", "purple_candle", "purple_stained_glass", "purple_stained_glass_pane", "red_candle",
  "red_stained_glass", "red_stained_glass_pane", "sea_lantern", "soul_lantern", "soul_torch", "tinted_glass",
  "torch", "waxed_copper_lantern", "waxed_exposed_copper_lantern", "waxed_oxidized_copper_lantern",
  "waxed_weathered_copper_lantern", "weathered_copper_lantern", "white_candle", "white_stained_glass",
  "white_stained_glass_pane", "yellow_candle", "yellow_stained_glass", "yellow_stained_glass_pane"
].map((n) => "minecraft:" + n);

/**
 * Everything brittle within `reach` of `center` (one query, run by the engine), nearest first: the shockwave
 * breaks each as the ring reaches it.  Null if the engine refused the query (the ring is then sampled instead).
 */
export function brittleAround(dim: Dimension, center: V3, reach: number): V3[] | null {
  if (CONFIG.terrain === "none") return [];
  const types = wither() ? [...FRAGILE_IDS, ...GLASS_IDS] : FRAGILE_IDS;
  const out: V3[] = [];
  try {
    const lo = { x: Math.floor(center.x - reach), y: Math.floor(center.y - 3), z: Math.floor(center.z - reach) };
    const hi = { x: Math.floor(center.x + reach), y: Math.floor(center.y + 8), z: Math.floor(center.z + reach) };
    const found = dim.getBlocks(new BlockVolume(lo, hi), { includeTypes: types }, true);
    for (const p of found.getBlockLocationIterator()) {
      if (Math.hypot(p.x + 0.5 - center.x, p.z + 0.5 - center.z) > reach) continue;
      out.push({ x: p.x, y: p.y, z: p.z });
      if (out.length >= 4000) break;
    }
  } catch { return null; }
  out.sort((a, b) => Math.hypot(a.x + 0.5 - center.x, a.z + 0.5 - center.z) - Math.hypot(b.x + 0.5 - center.x, b.z + 0.5 - center.z));
  return out;
}

/** Break one brittle block the shockwave has reached (a hedge somebody planted keeps its leaves).  True if it went. */
export function shatter(dim: Dimension, at: V3): boolean {
  const b = blockAt(dim, at);
  if (!b || b.isAir) return false;
  const id = b.typeId;
  const isGlass = GLASS.test(id);
  if (!FRAGILE.test(id) && !(isGlass && wither())) return false;
  if (id.endsWith("_leaves") && b.permutation.getState("persistent_bit") === true) return false;
  if (!breakable(id)) return false;
  try { b.setType("minecraft:air"); } catch { return false; }
  if (isGlass) sound(dim, "random.glass", at, 32, 0.8, 0.9 + ((at.x + at.z) & 3) * 0.05);
  return true;
}


/** May his breath or his weight break this block? */
export function breakable(id: string | undefined): boolean {
  if (!id || id === "minecraft:air" || id === "minecraft:fire" || id === "minecraft:soul_fire") return false;
  if (id === "minecraft:water" || id === "minecraft:flowing_water" || id === "minecraft:lava" || id === "minecraft:flowing_lava") return false;
  if (NEVER.test(id)) return false;
  if (CONFIG.spareStorage && STORAGE.test(id)) return false;
  return true;
}

// ---- the crater ---------------------------------------------------------------------------------------
const spheres = new Map<number, [number, number, number, number][]>();
/** Block offsets within radius r, nearest first (cached per tenth of a block). */
function sphere(r: number): [number, number, number, number][] {
  const key = Math.round(r * 10);
  const hit = spheres.get(key);
  if (hit) return hit;
  const out: [number, number, number, number][] = [];
  const R = Math.ceil(r);
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
    const d = Math.hypot(x, y, z);
    if (d <= r) out.push([x, y, z, d]);
  }
  out.sort((a, b) => a[3] - b[3]);
  spheres.set(key, out);
  return out;
}

export interface Carved { broken: number; floor: V3[] }

/**
 * Blast out the blocks within `r` of `at`, nearest first, up to `budget` of them.  No drops: what his breath
 * touches is gone.  With `fire`, a few of the blocks left standing at the edge of the crater catch alight.
 */
export function carve(dim: Dimension, at: V3, r: number, budget: number, fire = false): Carved {
  const out: Carved = { broken: 0, floor: [] };
  if (!isLoaded(dim, at)) return out;
  const cx = Math.floor(at.x), cy = Math.floor(at.y), cz = Math.floor(at.z);
  let reads = 0;
  for (const [dx, dy, dz] of sphere(r)) {
    if (out.broken >= budget || reads > budget * 3) break;
    const p = { x: cx + dx, y: cy + dy, z: cz + dz };
    const b = blockAt(dim, p);
    reads++;
    if (!b || !breakable(b.typeId)) continue;
    try { b.setType("minecraft:air"); out.broken++; } catch { continue; }      // a protected area refuses
    if (dy <= 0) out.floor.push(p);
  }
  if (fire && out.floor.length) {
    let lit = 0;
    for (let i = 0; i < out.floor.length && lit < 4; i += 3) {
      const p = out.floor[i];
      const below = blockAt(dim, { x: p.x, y: p.y - 1, z: p.z });
      const here = blockAt(dim, p);
      if (!below || !here || !here.isAir || !isSolidBlock(below)) continue;
      try { here.setType("minecraft:fire"); lit++; } catch { /* refused */ }
    }
  }
  return out;
}

// ---- smashing through ----------------------------------------------------------------------------------
/**
 * Clear a slab of his body's width in front of him, `depth` blocks deep starting `front` ahead of his middle,
 * from `y0` to `y1` above his feet.  What is built and what grows goes at every height.  The world's own ground
 * goes only from `rockFrom` above his feet up (null: never), so a slope is left to be walked up and a cliff is
 * cut down to a step.  Returns how many blocks went.
 */
export function crush(dim: Dimension, pos: V3, forward: V3, front: number, halfWidth: number, y0: number, y1: number, depth: number, budget: number,
                      rockFrom: number | null = null, loud = true): number {
  const left = { x: -forward.z, y: 0, z: forward.x };
  let broken = 0;
  const debris: V3[] = [];
  for (let d = 0; d < depth && broken < budget; d++) {
    for (let w = -halfWidth; w <= halfWidth && broken < budget; w++) {
      const bx = pos.x + forward.x * (front + d) + left.x * w, bz = pos.z + forward.z * (front + d) + left.z * w;
      for (let y = y0; y <= y1 && broken < budget; y++) {
        const p = { x: bx, y: pos.y + y, z: bz };
        const b = blockAt(dim, p);
        if (!b || b.isAir || b.isLiquid) continue;
        const id = b.typeId;
        // the world's own ground: never (rockFrom null), or only where it stands higher than he can step
        if (isNaturalGround(id) && !isPlantBlock(id) && (rockFrom === null || y < rockFrom)) continue;
        if (!breakable(id)) continue;
        try { b.setType("minecraft:air"); broken++; if (broken % 6 === 1) debris.push(p); } catch { /* protected */ }
      }
    }
  }
  if (broken && loud) {
    const mid = add(pos, { x: forward.x * (front + 0.5), y: (y0 + y1) / 2, z: forward.z * (front + 0.5) });
    sound(dim, "mob.wither.break_block", mid, 96, 1, 0.7);
    for (const p of debris.slice(0, 4)) particle(dim, "basiliskra:impact_debris", p, 72);
  }
  return broken;
}

// ---- the shockwave -------------------------------------------------------------------------------------
/**
 * One tick of a roar's shockwave: the ring between r0 and r1 round `center`.  Plants are flattened, snow blown
 * off, wild leaves stripped; in wither mode glass, lanterns and torches shatter too.  Returns block reads.
 */
export function shatterRing(dim: Dimension, center: V3, r0: number, r1: number, samples: number, seed: number): number {
  if (CONFIG.terrain === "none") return 0;
  const glass = wither();
  let reads = 0;
  for (let i = 0; i < samples; i++) {
    // two radii across the band, alternately; a quarter of the samples also look up into hedges, trees and windows
    const r = r0 + (r1 - r0) * (i % 2 ? 0.75 : 0.25);
    const a = (i + (seed % 7) * 0.13) * (Math.PI * 2 / samples);
    const x = center.x + Math.cos(a) * r, z = center.z + Math.sin(a) * r;
    if (!isLoaded(dim, { x, y: center.y, z })) continue;
    const top = i % 4 === 0 ? 6 : 2;
    for (let dy = -1; dy <= top; dy++) {
      const p = { x, y: center.y + dy, z };
      const b = blockAt(dim, p);
      reads++;
      if (!b || b.isAir || b.isLiquid) continue;
      const id = b.typeId;
      let goes = false;
      if (FRAGILE.test(id)) {
        // a hedge somebody planted keeps its leaves
        goes = !id.endsWith("_leaves") || b.permutation.getState("persistent_bit") !== true;
      } else if (glass && GLASS.test(id) && breakable(id)) goes = true;
      if (!goes) continue;
      try { b.setType("minecraft:air"); } catch { /* protected */ }
      if (GLASS.test(id)) sound(dim, "random.glass", p, 32, 0.8, 0.9 + (i % 5) * 0.05);
    }
  }
  return reads;
}

// ---- who is in the way ------------------------------------------------------------------------------------
/** Creatures (not players, not him) near a point. */
export function mobsNear(dim: Dimension, at: V3, r: number): Entity[] {
  try {
    return dim.getEntities({ location: at, maxDistance: r, families: ["mob"], excludeTypes: [TYPE, "minecraft:player"], excludeFamilies: [PART_FAMILY] });
  } catch { return []; }
}

export function alive(e: Entity | undefined): boolean {
  try { return !!e && e.isValid; } catch { return false; }
}

/**
 * Hurt and throw everything within `r` of `at`: players through `hurtPlayer` (which applies the damage setting and
 * Peaceful), creatures directly.  Knockback points away from `from`.
 */
export function blast(dim: Dimension, at: V3, r: number, playerDamage: number, mobDamage: number, knock: number,
                      hurtPlayer: (p: Player, amount: number) => boolean, source: Entity | undefined, from: V3 = at, mobs?: Entity[]): void {
  for (const p of witnesses(dim, at, r)) {
    try {
      const d = dist(add(p.location, { x: 0, y: 0.9, z: 0 }), at);
      if (d > r) continue;
      const f = 1 - d / (r + 0.5);
      if (playerDamage > 0) hurtPlayer(p, Math.max(1, Math.round(playerDamage * f)));
      if (knock > 0) {
        const away = norm({ x: p.location.x - from.x, y: 0, z: p.location.z - from.z });
        p.applyKnockback({ x: (away.x || 0.01) * knock * f, z: (away.z || 0.01) * knock * f }, 0.35 + 0.35 * f);
      }
    } catch { /* left */ }
  }
  for (const e of mobs ?? mobsNear(dim, at, r)) {
    try {
      if (!e.isValid) continue;
      const loc = e.location;
      const d = dist(loc, at);
      if (d > r + 1) continue;
      const f = Math.max(0.2, 1 - d / (r + 1));
      if (mobDamage > 0) e.applyDamage(Math.round(mobDamage * f), { cause: EntityDamageCause.entityAttack, damagingEntity: source });
      if (knock > 0) {
        const away = norm({ x: loc.x - from.x, y: 0, z: loc.z - from.z });
        e.applyKnockback({ x: (away.x || 0.01) * knock * f, z: (away.z || 0.01) * knock * f }, 0.3 + 0.3 * f);
      }
    } catch { /* gone */ }
  }
}

/** Distance from p to the segment a + d*t, t in [0, length]. */
export function segDist(p: V3, a: V3, d: V3, length: number): number {
  const t = Math.max(0, Math.min(length, (p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z));
  return dist(p, { x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t });
}
