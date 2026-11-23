/**
 * A city by the sea, for him to find.
 *
 * The script raises it: streets on a grid, towers of every colour with lit windows, a row of houses, a park, a
 * stadium and a wheel, people in the streets, a promenade, a beach - and, off the beach, a sea that is cut
 * DEEP: a hundred blocks straight down to a floor of abyssal basalt, with vents that glow, the ribs of something
 * far larger than he is, drowned spires, a ruin with a chest in it, and at the very bottom of a pit a broken
 * ring that looks like the place he came through.
 *
 * It is built from a plan: a list of boxes to fill, worked through a few a tick (the engine's own fill, never
 * block by block), only in chunks that are loaded (it asks for the ground to be kept loaded while it works), and
 * the same plan from the same place every time, so that a build cut short by the world closing simply runs
 * again.  A true custom biome would need the game's "Custom Biomes" experiment, which this pack does not use:
 * cities are put on real coasts as players explore (never where anything built already stands), or wherever an
 * operator asks for one.
 */
import { BlockVolume, Dimension, ItemStack, Player } from "@minecraft/server";
import { CIVILIAN, CONFIG, IODINE_ITEM, NS, OVERWORLD, SHARD_ITEM, TICKS, TRINITITE_BLOCK } from "./config";
import { players } from "./fx";
import { LANCE_ITEM } from "./lance";
import { store } from "./store";
import { dist, hash, type V3 } from "./vec";
import { NONE, UNLOADED, blockAt, groundY, idAt, isLoaded, isWaterId, overworld, waterColumn } from "./world";

export interface Site { x: number; y: number; z: number; dir: 0 | 1 | 2 | 3; small?: boolean; done: boolean; t: number }
export interface Plan { lotsU: number; lotsV: number; trenchU: number; trenchV: number; floor: number; people: number }
export const FULL: Plan = { lotsU: 9, lotsV: 6, trenchU: 240, trenchV: 100, floor: -40, people: 60 };
export const SMALL: Plan = { lotsU: 3, lotsV: 2, trenchU: 56, trenchV: 40, floor: -40, people: 8 };
const SEA = 62;                       // the top block of the sea
const LOT = 21, ROAD = 7, PITCH = LOT + ROAD;

const AIR = "minecraft:air", WATER = "minecraft:water", STONE = "minecraft:stone", SAND = "minecraft:sand", SANDSTONE = "minecraft:sandstone";
const ASPHALT = "minecraft:gray_concrete", LINE = "minecraft:light_gray_concrete", WALK = "minecraft:smooth_stone", GRASS = "minecraft:grass_block";
const FLOOR = "minecraft:smooth_stone", LIGHT = "minecraft:sea_lantern", LOG = "minecraft:oak_log", LEAVES = "minecraft:oak_leaves";
const ABYSS = `${NS}:abyssal_basalt`, VENT = `${NS}:seam_vent`, LANTERN = `${NS}:drowned_lantern`, BONE = `${NS}:old_bone`;
const WALLS = ["minecraft:white_concrete", "minecraft:light_gray_concrete", "minecraft:light_blue_concrete", "minecraft:blue_concrete", "minecraft:cyan_concrete",
  "minecraft:lime_concrete", "minecraft:orange_concrete", "minecraft:red_concrete", "minecraft:purple_concrete", "minecraft:yellow_concrete", "minecraft:quartz_block",
  "minecraft:gray_concrete", "minecraft:pink_concrete", "minecraft:green_concrete"];
const GLASS = ["minecraft:glass", "minecraft:light_blue_stained_glass", "minecraft:blue_stained_glass", "minecraft:gray_stained_glass", "minecraft:cyan_stained_glass",
  "minecraft:white_stained_glass"];
const HOUSE = ["minecraft:brick_block", "minecraft:white_terracotta", "minecraft:yellow_terracotta", "minecraft:light_blue_terracotta", "minecraft:oak_planks", "minecraft:birch_planks"];
const ROOF = ["minecraft:red_terracotta", "minecraft:brown_terracotta", "minecraft:gray_terracotta", "minecraft:dark_oak_planks", "minecraft:spruce_planks"];
const GONDOLA = ["minecraft:red_concrete", "minecraft:yellow_concrete", "minecraft:blue_concrete", "minecraft:lime_concrete"];
/** What says "somebody built here": a city is never raised by itself where any of these stand. */
const BUILT = ["minecraft:oak_planks", "minecraft:spruce_planks", "minecraft:birch_planks", "minecraft:jungle_planks", "minecraft:acacia_planks", "minecraft:dark_oak_planks",
  "minecraft:cobblestone", "minecraft:stone_bricks", "minecraft:brick_block", "minecraft:glass", "minecraft:torch", "minecraft:chest", "minecraft:crafting_table",
  "minecraft:furnace", "minecraft:bed", "minecraft:wooden_door", "minecraft:farmland", "minecraft:rail", "minecraft:oak_fence", "minecraft:ladder", "minecraft:bookshelf",
  "minecraft:white_wool", "minecraft:hay_block", "minecraft:bell", "minecraft:lantern", "minecraft:glass_pane", "minecraft:oak_stairs", "minecraft:cobblestone_wall"];

type P3 = [number, number, number];        // local: u (along the shore), y (world height), v (toward the sea)
type Op = { k: "fill"; a: P3; b: P3; id: string } | { k: "set"; at: P3[]; id: string } | { k: "mob"; at: P3; id: string } | { k: "chest"; at: P3; items: [string, number][] };

/** Local to world: the city's own axes, turned to face whichever way its sea lies. */
function toWorld(S: Site, u: number, y: number, v: number): V3 {
  switch (S.dir) {
    case 0: return { x: S.x + u, y, z: S.z + v };
    case 1: return { x: S.x - v, y, z: S.z + u };
    case 2: return { x: S.x - u, y, z: S.z - v };
    default: return { x: S.x + v, y, z: S.z - u };
  }
}
export const planOf = (S: Site): Plan => (S.small ? SMALL : FULL);
/** Where the parts of a site are, in its own coordinates. */
export function layout(P: Plan) {
  const cityU = P.lotsU * PITCH + ROAD, cityV = P.lotsV * PITCH + ROAD;
  const vProm = cityV, vBeach = cityV + 6, vShal = vBeach + 32, vDrop = vShal + 20, vTr = vDrop + 20, vEnd = vTr + P.trenchV - 1;
  const uS0 = Math.floor((cityU - P.trenchU) / 2), uS1 = uS0 + P.trenchU - 1;
  return { cityU, cityV, vProm, vBeach, vShal, vDrop, vTr, vEnd, uS0, uS1, uMin: Math.min(0, uS0) - 2, uMax: Math.max(cityU - 1, uS1) + 2 };
}
/** The middle of the city, its beach, and the deepest part of its sea (world coordinates). */
export function landmarks(S: Site): { centre: V3; beach: V3; deep: V3; radius: number } {
  const P = planOf(S), L = layout(P);
  return { centre: toWorld(S, L.cityU / 2, S.y + 1, L.cityV / 2), beach: toWorld(S, L.cityU / 2, S.y + 1, L.vBeach + 10),
           deep: toWorld(S, (L.uS0 + L.uS1) / 2, P.floor + 2, (L.vTr + L.vEnd) / 2), radius: Math.max(L.cityU, L.cityV) / 2 };
}

/** The whole plan for a site: every box, in the order it has to be built. */
export function plan(S: Site): Op[] {
  const P = planOf(S), L = layout(P), G = S.y, ops: Op[] = [];
  const rnd = (i: number, j = 0) => hash(S.x * 0.37 + i * 1.7, S.z * 0.53 + j * 2.3, i * 31 + j);
  const pick = <T>(list: T[], i: number, j = 0): T => list[Math.floor(rnd(i, j) * list.length) % list.length];
  // a box, cut into pieces small enough that filling one never costs the game a stutter (16 x 16 x 16 at most)
  const fill = (u0: number, y0: number, v0: number, u1: number, y1: number, v1: number, id: string) => {
    if (u1 < u0 || y1 < y0 || v1 < v0) return;
    for (let u = u0; u <= u1; u += 16) for (let v = v0; v <= v1; v += 16) for (let y = y0; y <= y1; y += 16) {
      ops.push({ k: "fill", a: [u, y, v], b: [Math.min(u1, u + 15), Math.min(y1, y + 15), Math.min(v1, v + 15)], id });
    }
  };
  const set = (at: P3[], id: string) => { if (at.length) ops.push({ k: "set", at, id }); };

  // ---- the ground: open sky over the city and its beach, something firm under them --------------------------
  fill(0, G + 1, 0, L.cityU - 1, G + 72, L.vBeach - 1, AIR);
  fill(0, G - 5, 0, L.cityU - 1, G - 1, L.vBeach - 1, STONE);
  fill(0, G, 0, L.cityU - 1, G, L.cityV - 1, WALK);
  fill(0, G, L.vProm, L.cityU - 1, G, L.vBeach - 1, WALK);
  // ---- streets ---------------------------------------------------------------------------------------------
  for (let i = 0; i <= P.lotsU; i++) { fill(i * PITCH, G, 0, i * PITCH + 6, G, L.cityV - 1, ASPHALT); fill(i * PITCH + 3, G, 0, i * PITCH + 3, G, L.cityV - 1, LINE); }
  for (let j = 0; j <= P.lotsV; j++) { fill(0, G, j * PITCH, L.cityU - 1, G, j * PITCH + 6, ASPHALT); fill(0, G, j * PITCH + 3, L.cityU - 1, G, j * PITCH + 3, LINE); }
  const lamps: P3[] = [], posts: P3[] = [], lights: P3[] = [];

  // ---- what stands on each lot ------------------------------------------------------------------------------
  const tower = (lu: number, lv: number, w: number, d: number, h: number, n: number) => {
    const u0 = lu + Math.floor((LOT - w) / 2), v0 = lv + Math.floor((LOT - d) / 2), u1 = u0 + w - 1, v1 = v0 + d - 1, top = G + h;
    const wall = pick(WALLS, n, 1), glass = pick(GLASS, n, 2), style = Math.floor(rnd(n, 3) * 3);
    fill(u0, G + 1, v0, u1, top, v1, wall);
    fill(u0 + 1, G + 1, v0 + 1, u1 - 1, top - 1, v1 - 1, AIR);
    for (let y = G + 4; y < top - 1; y += 4) { fill(u0 + 1, y, v0 + 1, u1 - 1, y, v1 - 1, FLOOR); lights.push([u0 + (w >> 1), y, v0 + (d >> 1)]); }
    if (style === 0) {
      // bands of window, storey by storey
      for (let y = G + 1; y + 2 < top; y += 4) {
        fill(u0 + 1, y + 1, v0, u1 - 1, y + 2, v0, glass); fill(u0 + 1, y + 1, v1, u1 - 1, y + 2, v1, glass);
        fill(u0, y + 1, v0 + 1, u0, y + 2, v1 - 1, glass); fill(u1, y + 1, v0 + 1, u1, y + 2, v1 - 1, glass);
      }
    } else if (style === 1) {
      // stripes of window from the street to the roof
      for (let u = u0 + 1; u < u1; u += 2) { fill(u, G + 2, v0, u, top - 2, v0, glass); fill(u, G + 2, v1, u, top - 2, v1, glass); }
      for (let v = v0 + 1; v < v1; v += 2) { fill(u0, G + 2, v, u0, top - 2, v, glass); fill(u1, G + 2, v, u1, top - 2, v, glass); }
    } else {
      // a wall of glass in a frame
      fill(u0 + 1, G + 2, v0, u1 - 1, top - 2, v0, glass); fill(u0 + 1, G + 2, v1, u1 - 1, top - 2, v1, glass);
      fill(u0, G + 2, v0 + 1, u0, top - 2, v1 - 1, glass); fill(u1, G + 2, v0 + 1, u1, top - 2, v1 - 1, glass);
    }
    // a way in, a crown, and a light on the highest ones so that aircraft (and he) can see them
    fill(u0 + (w >> 1), G + 1, v1, u0 + (w >> 1), G + 2, v1, AIR);
    if (h > 22) fill(u0 + 2, top + 1, v0 + 2, u1 - 2, top + 2, v1 - 2, wall);
    if (h > 40) { fill(u0 + (w >> 1), top + 3, v0 + (d >> 1), u0 + (w >> 1), top + 8, v0 + (d >> 1), "minecraft:iron_block"); lights.push([u0 + (w >> 1), top + 9, v0 + (d >> 1)]); }
  };
  const houses = (lu: number, lv: number, n: number) => {
    fill(lu + 1, G, lv + 1, lu + LOT - 2, G, lv + LOT - 2, GRASS);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const u0 = lu + 2 + a * 10, v0 = lv + 2 + b * 10, k = n * 4 + a * 2 + b;
      const wall = pick(HOUSE, k, 5), roof = pick(ROOF, k, 6);
      fill(u0, G + 1, v0, u0 + 6, G + 4, v0 + 6, wall);
      fill(u0 + 1, G + 1, v0 + 1, u0 + 5, G + 4, v0 + 5, AIR);
      fill(u0 + 2, G + 2, v0, u0 + 4, G + 2, v0, "minecraft:glass"); fill(u0 + 2, G + 2, v0 + 6, u0 + 4, G + 2, v0 + 6, "minecraft:glass");
      fill(u0, G + 2, v0 + 2, u0, G + 2, v0 + 4, "minecraft:glass");
      fill(u0 + 6, G + 1, v0 + 3, u0 + 6, G + 2, v0 + 3, AIR);
      for (let r = 0; r < 4; r++) fill(u0 - 1 + r, G + 5 + r, v0 - 1 + r, u0 + 7 - r, G + 5 + r, v0 + 7 - r, roof);
      lights.push([u0 + 3, G + 4, v0 + 3]);
    }
  };
  const park = (lu: number, lv: number, n: number) => {
    fill(lu + 1, G, lv + 1, lu + LOT - 2, G, lv + LOT - 2, GRASS);
    fill(lu + 9, G, lv + 1, lu + 11, G, lv + LOT - 2, "minecraft:gravel"); fill(lu + 1, G, lv + 9, lu + LOT - 2, G, lv + 11, "minecraft:gravel");
    fill(lu + 8, G + 1, lv + 8, lu + 12, G + 1, lv + 12, "minecraft:stone_bricks"); fill(lu + 9, G + 1, lv + 9, lu + 11, G + 1, lv + 11, WATER);
    for (const [du, dv] of [[4, 4], [16, 4], [4, 16], [16, 16]]) {
      const h = 4 + Math.floor(rnd(n, du + dv) * 3);
      fill(lu + du - 2, G + h, lv + dv - 2, lu + du + 2, G + h + 2, lv + dv + 2, LEAVES);
      fill(lu + du - 1, G + h + 3, lv + dv - 1, lu + du + 1, G + h + 3, lv + dv + 1, LEAVES);
      fill(lu + du, G + 1, lv + dv, lu + du, G + h + 1, lv + dv, LOG);
    }
  };
  const stadium = (lu: number, lv: number) => {
    const u0 = lu, v0 = lv, u1 = lu + 2 * LOT + ROAD - 1, v1 = lv + 2 * LOT + ROAD - 1;
    fill(u0, G, v0, u1, G, v1, WALK);
    const ring = (inset: number, y0: number, y1: number, id: string) => {
      fill(u0 + inset, y0, v0 + inset, u1 - inset, y1, v0 + inset + 1, id); fill(u0 + inset, y0, v1 - inset - 1, u1 - inset, y1, v1 - inset, id);
      fill(u0 + inset, y0, v0 + inset, u0 + inset + 1, y1, v1 - inset, id); fill(u1 - inset - 1, y0, v0 + inset, u1 - inset, y1, v1 - inset, id);
    };
    ring(0, G + 1, G + 13, "minecraft:quartz_block");
    for (let k = 0; k < 5; k++) ring(2 + 2 * k, G + 1, G + 10 - 2 * k, k % 2 ? "minecraft:blue_concrete" : "minecraft:red_concrete");
    fill(u0 + 12, G, v0 + 12, u1 - 12, G, v1 - 12, "minecraft:lime_concrete");
    fill(u0 + 12, G, (v0 + v1) >> 1, u1 - 12, G, (v0 + v1) >> 1, "minecraft:white_concrete");
    fill((u0 + u1) >> 1, G + 1, v1 - 1, ((u0 + u1) >> 1) + 1, G + 3, v1, AIR);
    for (const [u, v] of [[u0, v0], [u1, v0], [u0, v1], [u1, v1]]) { fill(u, G + 14, v, u, G + 20, v, "minecraft:iron_block"); lights.push([u, G + 21, v]); }
  };
  const wheel = (lu: number, lv: number) => {
    fill(lu + 1, G, lv + 1, lu + LOT - 2, G, lv + LOT - 2, WALK);
    const cu = lu + 10, cv = lv + 10, cy = G + 19, R = 15;
    const rim: P3[] = [], spokes: P3[] = [], legs: P3[] = [], cars: P3[][] = GONDOLA.map(() => []);
    const seen = new Set<string>();
    for (let a = 0; a < 360; a += 3) {
      const p: P3 = [cu + Math.round(R * Math.cos(a * Math.PI / 180)), cy + Math.round(R * Math.sin(a * Math.PI / 180)), cv];
      if (!seen.has(p.join())) { seen.add(p.join()); rim.push(p); }
      if (a % 45 === 0) { cars[(a / 45) % GONDOLA.length].push([p[0], p[1] - 1, cv + 1], [p[0], p[1] - 2, cv + 1]); for (let r = 2; r < R; r += 1) spokes.push([cu + Math.round(r * Math.cos(a * Math.PI / 180)), cy + Math.round(r * Math.sin(a * Math.PI / 180)), cv]); }
    }
    for (let y = G + 1; y < cy; y++) { const k = (cy - y) * 0.42; legs.push([cu - Math.round(k), y, cv - 1], [cu + Math.round(k), y, cv - 1]); }
    set(rim, "minecraft:white_concrete"); set(spokes, "minecraft:iron_bars"); set(legs, "minecraft:iron_block"); set([[cu, cy, cv], [cu, cy, cv - 1]], "minecraft:red_concrete");
    cars.forEach((c, i) => set(c, GONDOLA[i]));
  };
  const big = P.lotsU >= 5 && P.lotsV >= 4;
  for (let i = 0; i < P.lotsU; i++) for (let j = 0; j < P.lotsV; j++) {
    const lu = i * PITCH + ROAD, lv = j * PITCH + ROAD, n = i * 16 + j;
    for (const [cu, cv] of [[lu, lv], [lu + LOT - 1, lv + LOT - 1]]) { posts.push([cu, G + 1, cv], [cu, G + 2, cv], [cu, G + 3, cv]); lamps.push([cu, G + 4, cv]); }
    if (big && i < 2 && j < 2) { if (i === 0 && j === 0) stadium(lu, lv); continue; }
    if (big && i === P.lotsU - 1 && j === 1) { wheel(lu, lv); continue; }
    const r = rnd(n, 9);
    if (j <= (P.lotsV >= 6 ? 1 : 0) && r < 0.75) houses(lu, lv, n);
    else if (r < 0.14 || (!big && i === 1 && j === 0) || (big && i === Math.floor(P.lotsU / 2) && j === Math.floor(P.lotsV / 2))) park(lu, lv, n);
    else {
      // the nearer the water, the taller
      const tall = j === P.lotsV - 1 ? 34 + Math.floor(rnd(n, 10) * 32) : 14 + Math.floor(rnd(n, 10) * (j >= 2 ? 30 : 18));
      tower(lu, lv, 11 + 2 * Math.floor(rnd(n, 11) * 4), 11 + 2 * Math.floor(rnd(n, 12) * 4), 2 + 4 * Math.round(tall / 4), n);
    }
  }
  // lamps along the promenade, and a pier out over the beach
  for (let u = 4; u < L.cityU; u += 12) { posts.push([u, G + 1, L.vProm + 4], [u, G + 2, L.vProm + 4], [u, G + 3, L.vProm + 4]); lamps.push([u, G + 4, L.vProm + 4]); }
  set(posts, "minecraft:nether_brick_fence"); set(lamps, LIGHT); set(lights, LIGHT);

  // ---- the people: in the streets as soon as there are streets (they are what he comes for) ------------------------
  for (let k = 0; k < P.people; k++) {
    const i = Math.floor(rnd(k, 40) * (P.lotsU + 1)), j = Math.floor(rnd(k, 41) * (P.lotsV + 1));
    const along = rnd(k, 42) < 0.5;
    ops.push({ k: "mob", id: CIVILIAN, at: along ? [i * PITCH + 1 + (k % 2) * 4, G + 1, 2 + Math.floor(rnd(k, 43) * (L.cityV - 4))]
      : [2 + Math.floor(rnd(k, 44) * (L.cityU - 4)), G + 1, j * PITCH + 1 + (k % 2) * 4] });
  }

  // ---- the beach: sand shelving down from the promenade to the water and under it ---------------------------
  const strip = (v0: number, v1: number, y: number, top: string) => {
    fill(L.uMin, y - 6, v0, L.uMax, y - 3, v1, SANDSTONE);
    fill(L.uMin, y - 2, v0, L.uMax, y, v1, top);
    if (y < SEA) fill(L.uMin, y + 1, v0, L.uMax, SEA, v1, WATER);
    fill(L.uMin, Math.max(y, SEA) + 1, v0, L.uMax, G + 40, v1, AIR);
  };
  const rows = (v0: number, n: number, yA: number, yB: number, top: string) => {
    let from = 0, y = yA;
    for (let k = 1; k <= n; k++) {
      const yk = k === n ? NaN : Math.round(yA + (yB - yA) * (k / (n - 1)));
      if (yk !== y) { strip(v0 + from, v0 + k - 1, y, top); from = k; y = yk; }
    }
  };
  rows(L.vBeach, 32, G, SEA - 2, SAND);
  rows(L.vShal, 20, SEA - 2, SEA - 9, SAND);
  fill(Math.floor(L.cityU / 2) - 1, G, L.vBeach, Math.floor(L.cityU / 2) + 1, G, L.vShal + 14, "minecraft:spruce_planks");

  // ---- the deep ------------------------------------------------------------------------------------------------
  const F = P.floor, u0 = L.uS0, u1 = L.uS1;
  // its walls and its floor first, so that the sea that fills it has nowhere else to go
  fill(u0 - 2, F - 2, L.vDrop, u0 - 1, SEA - 9, L.vEnd + 2, ABYSS); fill(u1 + 1, F - 2, L.vDrop, u1 + 2, SEA - 9, L.vEnd + 2, ABYSS);
  fill(u0, F - 2, L.vEnd + 1, u1, SEA - 9, L.vEnd + 2, ABYSS);
  fill(u0, F - 2, L.vDrop, u1, F, L.vEnd, ABYSS);
  // the drop: twenty steps from the shallows to the floor
  for (let k = 0; k < 20; k++) {
    const y = Math.round(SEA - 9 + (F - (SEA - 9)) * ((k + 1) / 20));
    fill(u0, F + 1, L.vDrop + k, u1, y, L.vDrop + k, ABYSS);
    fill(u0, y + 1, L.vDrop + k, u1, SEA, L.vDrop + k, WATER);
  }
  fill(u0, F + 1, L.vTr, u1, SEA, L.vEnd, WATER);
  fill(u0 - 2, SEA + 1, L.vDrop, u1 + 2, G + 40, L.vEnd + 2, AIR);
  // the pit in the middle of it, deeper still, and the broken ring at the bottom
  const pu = (u0 + u1) >> 1, pv = (L.vTr + L.vEnd) >> 1, pr = Math.min(17, Math.floor(Math.min(P.trenchU, P.trenchV) / 2) - 6), PF = -57;
  fill(pu - pr - 1, PF - 1, pv - pr - 1, pu + pr + 1, F, pv + pr + 1, ABYSS);
  fill(pu - pr, PF + 1, pv - pr, pu + pr, F, pv + pr, WATER);
  const gate: P3[] = [], gateLit: P3[] = [], gr = Math.min(8, pr - 3);
  for (let a = 20; a < 340; a += 5) {
    const p: P3 = [pu + Math.round(gr * Math.sin(a * Math.PI / 180)), PF + 1 + gr - Math.round(gr * Math.cos(a * Math.PI / 180)), pv];
    (a % 60 < 6 ? gateLit : gate).push(p);
  }
  set(gate, "minecraft:crying_obsidian"); set(gateLit, LANTERN);
  fill(pu - 2, PF, pv - 2, pu + 2, PF, pv + 2, TRINITITE_BLOCK);
  // vents, some of them tall
  const vents: P3[] = [], lit: P3[] = [];
  const nVent = Math.round((P.trenchU * P.trenchV) / 1400), tu = P.trenchU - 8, tv = P.trenchV - 8;
  for (let k = 0; k < nVent; k++) {
    const u = u0 + 4 + Math.floor(rnd(k, 20) * tu), v = L.vTr + 4 + Math.floor(rnd(k, 21) * tv);
    if (Math.abs(u - pu) <= pr + 2 && Math.abs(v - pv) <= pr + 2) continue;
    const h = 1 + Math.floor(rnd(k, 22) * 8);
    fill(u, F + 1, v, u + 1, F + h, v + 1, ABYSS);
    vents.push([u, F + h + 1, v], [u + 1, F + h + 1, v + 1]);
  }
  set(vents, VENT);
  // drowned spires
  const nSpire = Math.max(2, Math.round(P.trenchU / 34));
  for (let k = 0; k < nSpire; k++) {
    const u = u0 + 8 + Math.floor(rnd(k, 30) * (P.trenchU - 16)), v = L.vTr + 6 + Math.floor(rnd(k, 31) * (P.trenchV - 12));
    if (Math.abs(u - pu) <= pr + 3 && Math.abs(v - pv) <= pr + 3) continue;
    const h = 24 + Math.floor(rnd(k, 32) * 36);
    fill(u - 1, F + 1, v - 1, u + 1, F + Math.floor(h / 3), v + 1, ABYSS);
    fill(u, F + 1, v, u, F + h, v, ABYSS);
    for (let y = F + 8; y <= F + h; y += 8) lit.push([u, y, v]);
  }
  // the ribs of something far larger than he is
  const ru = u0 + Math.floor(P.trenchU * 0.24), nRib = Math.max(2, Math.min(6, Math.floor((P.trenchV - 12) / 13))), half = Math.min(14, Math.floor(P.trenchU * 0.2));
  const ribs: P3[] = [];
  for (let r = 0; r < nRib; r++) {
    const v = L.vTr + 8 + r * 13;
    for (let du = -half; du <= half; du++) {
      const y = F + 1 + Math.round(22 * (1 - (du / half) * (du / half)));
      const y2 = F + 1 + Math.round(22 * (1 - ((du + (du < 0 ? 1 : -1)) / half) * ((du + (du < 0 ? 1 : -1)) / half)));
      for (let yy = Math.min(y, y2); yy <= Math.max(y, y2); yy++) ribs.push([ru + du, yy, v], [ru + du, yy, v + 1]);
    }
  }
  set(ribs, BONE);
  fill(ru - 1, F + 22, L.vTr + 6, ru + 1, F + 24, L.vTr + 10 + (nRib - 1) * 13, BONE);
  // a ruin where the drop ends, and what was left in it
  const qu = u1 - Math.floor(P.trenchU * 0.22), qv = L.vTr + 6;
  fill(qu - 4, F + 1, qv - 4, qu + 4, F + 1, qv + 4, "minecraft:prismarine_bricks");
  for (const [du, dv] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) fill(qu + du, F + 2, qv + dv, qu + du, F + 6, qv + dv, "minecraft:dark_prismarine");
  fill(qu - 4, F + 7, qv - 4, qu + 4, F + 7, qv - 4, "minecraft:prismarine_bricks"); fill(qu - 4, F + 7, qv + 4, qu + 4, F + 7, qv + 4, "minecraft:prismarine_bricks");
  lit.push([qu - 4, F + 8, qv - 4], [qu + 4, F + 8, qv + 4], [pu - pr, F + 1, pv - pr], [pu + pr, F + 1, pv + pr], [pu - pr, F + 1, pv + pr], [pu + pr, F + 1, pv - pr]);
  set(lit, LANTERN);
  ops.push({ k: "chest", at: [qu, F + 2, qv], items: [[LANCE_ITEM, 1], [SHARD_ITEM, 12], [IODINE_ITEM, 8], ["minecraft:diamond", 3], ["minecraft:heart_of_the_sea", 1]] });

  return ops;
}

// ---- building ---------------------------------------------------------------------------------------------------------
const AREA = "bk_city";
/** What one tick of building may cost: blocks of volume, pieces, and milliseconds of the script's time. */
export const BUILD = { volume: 6000, pieces: 20, ms: 4 };
class Build {
  private ops: Op[];
  private done: Uint8Array;
  private left: number;
  private held = false;
  private waited = 0;
  /** Everything before this is done (so a tick does not walk the whole plan to find its work). */
  private first = 0;
  failed = 0;
  constructor(readonly S: Site, private readonly dim: Dimension) {
    this.ops = plan(S);
    this.done = new Uint8Array(this.ops.length);
    this.left = this.ops.length;
  }
  get finished(): boolean { return this.left <= 0; }
  get progress(): number { return 1 - this.left / Math.max(1, this.ops.length); }

  /** Ask the game to keep the whole site loaded while it is built (four areas; if it will not, the plan waits for players). */
  private hold(): void {
    if (this.held) return;
    this.held = true;
    const L = layout(planOf(this.S));
    const a = toWorld(this.S, L.uMin - 2, 0, -2), b = toWorld(this.S, L.uMax + 2, 0, L.vEnd + 4);
    const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    const mx = Math.floor((x0 + x1) / 2), mz = Math.floor((z0 + z1) / 2);
    const quads = [[x0, z0, mx, mz], [mx + 1, z0, x1, mz], [x0, mz + 1, mx, z1], [mx + 1, mz + 1, x1, z1]];
    quads.forEach(([ax, az, bx, bz], k) => {
      try { this.dim.runCommand(`tickingarea remove ${AREA}_${k}`); } catch { /* there was none */ }
      try { this.dim.runCommand(`tickingarea add ${Math.floor(ax)} 0 ${Math.floor(az)} ${Math.floor(bx)} 0 ${Math.floor(bz)} ${AREA}_${k}`); } catch { /* full, or not allowed: it waits for players */ }
    });
  }
  release(): void {
    if (!this.held) return;
    this.held = false;
    for (let k = 0; k < 4; k++) { try { this.dim.runCommand(`tickingarea remove ${AREA}_${k}`); } catch { /* gone */ } }
  }

  private box(op: Op): { lo: V3; hi: V3 } {
    const pts = op.k === "fill" ? [op.a, op.b] : op.k === "set" ? op.at : [op.at];
    const lo = { x: 1e9, y: 1e9, z: 1e9 }, hi = { x: -1e9, y: -1e9, z: -1e9 };
    for (const [u, y, v] of pts) {
      const w = toWorld(this.S, u, y, v);
      lo.x = Math.min(lo.x, w.x); lo.y = Math.min(lo.y, w.y); lo.z = Math.min(lo.z, w.z);
      hi.x = Math.max(hi.x, w.x); hi.y = Math.max(hi.y, w.y); hi.z = Math.max(hi.z, w.z);
    }
    return { lo, hi };
  }

  /**
   * A tick's worth, kept small enough that nobody feels it: boxes in order up to a few thousand blocks, two dozen
   * pieces and a few milliseconds of the script's time; a box whose ground is not loaded waits, and so does
   * everything over the same ground.  (A city is millions of blocks: it is raised over a minute or two, not at once.)
   */
  tick(): void {
    this.hold();
    let volume = 0, small = 0, any = false;
    const started = Date.now();
    const blocked: { lo: V3; hi: V3 }[] = [];
    for (let i = this.first; i < this.ops.length && volume < BUILD.volume && small < BUILD.pieces && blocked.length < 12 && Date.now() - started < BUILD.ms; i++) {
      if (this.done[i]) continue;
      const op = this.ops[i], b = this.box(op);
      if (blocked.some((q) => b.lo.x <= q.hi.x && b.hi.x >= q.lo.x && b.lo.z <= q.hi.z && b.hi.z >= q.lo.z)) continue;
      if (!isLoaded(this.dim, b.lo) || !isLoaded(this.dim, b.hi) || !isLoaded(this.dim, { x: b.lo.x, y: 0, z: b.hi.z }) || !isLoaded(this.dim, { x: b.hi.x, y: 0, z: b.lo.z })) { blocked.push(b); continue; }
      // a piece that would take this tick over its budget waits for the next (one piece is always allowed)
      const cost = op.k === "fill" ? (b.hi.x - b.lo.x + 1) * (b.hi.y - b.lo.y + 1) * (b.hi.z - b.lo.z + 1) : op.k === "set" ? op.at.length * 20 : 0;
      if (small > 0 && volume + cost > BUILD.volume) break;
      try {
        if (op.k === "fill") {
          // air where it is already air, and sea where it is already sea, are left alone: no update for the game to send
          const same = op.id === AIR ? [AIR] : op.id === WATER ? [WATER, "minecraft:flowing_water"] : undefined;
          this.dim.fillBlocks(new BlockVolume(b.lo, b.hi), op.id, same ? { ignoreChunkBoundErrors: true, blockFilter: { excludeTypes: same } } : { ignoreChunkBoundErrors: true });
          volume += (b.hi.x - b.lo.x + 1) * (b.hi.y - b.lo.y + 1) * (b.hi.z - b.lo.z + 1);
        } else if (op.k === "set") {
          for (const [u, y, v] of op.at) { const at = blockAt(this.dim, toWorld(this.S, u, y, v)); if (at) at.setType(op.id); }
          volume += op.at.length * 20;
        } else if (op.k === "mob") {
          const w = toWorld(this.S, op.at[0], op.at[1], op.at[2]);
          this.dim.spawnEntity(op.id, { x: w.x + 0.5, y: w.y, z: w.z + 0.5 });
        } else {
          const at = blockAt(this.dim, toWorld(this.S, op.at[0], op.at[1], op.at[2]));
          if (at) {
            at.setType("minecraft:chest");
            const box = at.getComponent("minecraft:inventory")?.container;
            if (box) op.items.forEach(([id, n], slot) => { try { box.setItem(slot * 2 + 3, new ItemStack(id, n)); } catch { /* an item the game does not know */ } });
          }
        }
      } catch { this.failed++; }
      this.done[i] = 1; this.left--; small++; any = true;
    }
    while (this.first < this.ops.length && this.done[this.first]) this.first++;
    this.waited = any ? 0 : this.waited + 1;
  }
  /** Nothing could be done for a long while: the ground is not loading (the plan stays, and is taken up again when someone is near). */
  get stalled(): boolean { return this.waited > 30 * TICKS.second; }
}

let building: Build | null = null;
const cities = (): Site[] => (store.rec.cities ??= []);

/** Does anything somebody built stand on the ground a city would take?  (Looked at where it is loaded.) */
function occupied(dim: Dimension, S: Site): boolean {
  const L = layout(planOf(S));
  let found = 0;
  for (let u = 0; u < L.cityU; u += 32) for (let v = 0; v < L.vShal; v += 32) {
    const a = toWorld(S, u, S.y - 2, v), b = toWorld(S, Math.min(L.cityU - 1, u + 31), S.y + 30, Math.min(L.vShal - 1, v + 31));
    if (!isLoaded(dim, a) || !isLoaded(dim, b)) continue;
    try {
      const lo = { x: Math.min(a.x, b.x), y: a.y, z: Math.min(a.z, b.z) }, hi = { x: Math.max(a.x, b.x), y: b.y, z: Math.max(a.z, b.z) };
      for (const _ of dim.getBlocks(new BlockVolume(lo, hi), { includeTypes: BUILT }, true).getBlockLocationIterator()) { if (++found > 6) return true; }
    } catch { /* unloading */ }
  }
  return false;
}

/**
 * Raise a city.  `at`: a place on its promenade, at its middle; `dir`: which way its sea lies (0 +z, 1 -x, 2 -z,
 * 3 +x).  Returns what happened, in words.
 */
export function raiseCity(at: V3, dir: 0 | 1 | 2 | 3, small = false, force = true): string {
  if (building) return `A city is still being built (${Math.round(building.progress * 100)}%). One at a time.`;
  const list = cities();
  if (list.length >= 8) return "There are eight cities in this world already.";
  const P = small ? SMALL : FULL, L = layout(P);
  const y = Math.max(SEA + 1, Math.min(82, Math.floor(at.y) - 1));
  const S: Site = { x: 0, y, z: 0, dir, small: small || undefined, done: false, t: store.rec.clock };
  // put the origin so that `at` is the middle of the promenade
  const o = toWorld(S, -L.cityU / 2, 0, -(L.vProm + 3));
  S.x = Math.floor(at.x + o.x); S.z = Math.floor(at.z + o.z);
  const dim = overworld();
  if (!force && occupied(dim, S)) return "Something is built there already: no city is raised over it.";
  list.push(S);
  store.touch();
  building = new Build(S, dim);
  return `A city is rising: ${L.cityU} by ${L.cityV} blocks of streets behind the promenade, a beach in front of it, and a sea cut ${SEA - P.floor} blocks deep beyond.`;
}

/** The city nearest a place (finished or not), and how far its middle is. */
export function nearestCity(at: V3): { site: Site; centre: V3; distance: number; radius: number } | null {
  let best: { site: Site; centre: V3; distance: number; radius: number } | null = null;
  for (const S of cities()) {
    const m = landmarks(S), d = Math.hypot(m.centre.x - at.x, m.centre.z - at.z);
    if (!best || d < best.distance) best = { site: S, centre: m.centre, distance: d, radius: m.radius };
  }
  return best;
}
export const cityBuilding = (): number | null => (building ? building.progress : null);
/** Stop work on the city being built (it stays on record, unfinished, and is taken up again when someone is near it). */
export function stopBuilding(): void { if (building) { building.release(); building = null; } }

/** A coast near a player where a city could stand: land behind, open sea in front, nothing built. */
function seekCoast(dim: Dimension, p: Player): string | null {
  let at: V3;
  try { at = p.location; } catch { return null; }
  const near = nearestCity(at);
  if (near && near.distance < 900) return null;
  // not every coast: about half the regions of the world have one to find
  if (hash(Math.floor(at.x / 640), Math.floor(at.z / 640), 5) > 0.55) return null;
  const DIRS: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = DIRS[k];
    let land = -1;
    for (let s = 8; s <= 72; s += 8) {
      const x = at.x + dx * s, z = at.z + dz * s;
      if (!isLoaded(dim, { x, y: 64, z })) break;
      const col = waterColumn(dim, x, z, SEA, 6, 40);
      if (col === UNLOADED) break;
      if (col === NONE) { const g = groundY(dim, x, z, 90, 40); if (typeof g === "number" && g >= SEA && g <= SEA + 10) land = s; else land = -1; continue; }
      if (land < 0 || col.surface - col.floor < 3) continue;
      // the shore is between `land` and here: is it the sea beyond, and is it sea all along?
      const far = waterColumn(dim, at.x + dx * (s + 16), at.z + dz * (s + 16), SEA, 6, 60);
      if (far === NONE || far === UNLOADED || far.surface - far.floor < 6) break;
      let biome = "";
      try { biome = dim.getBiome({ x, y: SEA, z }).id; } catch { biome = "ocean"; }
      if (!/ocean|beach|coast/.test(biome)) break;
      const said = raiseCity({ x: at.x + dx * (s - 26), y: SEA + 2, z: at.z + dz * (s - 26) }, k as 0 | 1 | 2 | 3, false, false);
      return /rising/.test(said) ? said : null;
    }
  }
  return null;
}

/** Once a tick, from the controller. */
export function cityTick(now: number): void {
  if (building) {
    building.tick();
    if (building.finished) {
      building.S.done = true;
      store.touch();
      const m = landmarks(building.S);
      for (const p of players()) {
        try { if (p.dimension.id === OVERWORLD && dist(p.location, m.centre) < 400) p.sendMessage(`§7[Basiliskra] The city stands. Its beach is ${compass(p.location, m.beach)}; the deep water is beyond it.`); } catch { /* left */ }
      }
      building.release();
      building = null;
    } else if (building.stalled) { building.release(); building = null; }      // taken up again below, when someone is near it
    return;
  }
  if (now % 100 !== 50) return;
  const dim = overworld();
  // a city whose building was cut short (the world closed, or its ground would not load) is taken up again
  const open = cities().find((S) => !S.done && players().some((p) => { try { return p.dimension.id === OVERWORLD && dist(p.location, landmarks(S).centre) < 160; } catch { return false; } }));
  if (open) { building = new Build(open, dim); return; }
  if (!CONFIG.cities || cities().length >= 6) return;
  for (const p of players()) {
    try {
      if (p.dimension.id !== OVERWORLD) continue;
      const said = seekCoast(dim, p);
      if (said) { p.sendMessage(`§7[Basiliskra] ${said}`); return; }
    } catch { /* left */ }
  }
}

function compass(from: V3, to: V3): string {
  const a = (Math.atan2(-(to.x - from.x), to.z - from.z) * 180) / Math.PI;
  const d = Math.round(Math.hypot(to.x - from.x, to.z - from.z));
  return `${d} blocks ${["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"][((Math.round(a / 45) % 8) + 8) % 8]}`;
}
// (kept for callers that only want to know whether water is near a place)
export const isSea = (dim: Dimension, at: V3): boolean => isWaterId(idAt(dim, at));
