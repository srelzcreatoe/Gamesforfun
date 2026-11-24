// @ts-nocheck
import * as __dw from "../../link/shared.js";
// =============================================================================
//  THE GOATWALKER  -  core: constants, helpers, sight, player state, decor
//  Script API: @minecraft/server 2.3.0 (stable).  No experimental toggles.
// =============================================================================
import { world, system, BlockVolume, MolangVariableMap, BlockPermutation, GameMode, Difficulty, MoonPhase } from "@minecraft/server";

import { cfg, paceMul, aggro } from "./config.js";

export const NS = "goatwalker";
export const GW = "goatwalker:goatwalker";
export const MARK = "goatwalker:marker";
export const TAG = "gw_managed";
export const PREY = "gw_prey";
export const OVERWORLD = "minecraft:overworld";
export const STELLAR = "goatwalker:stellar_taiga";
// the same woods defined a second way (see worldgen): whichever the game version accepts is the one that grows
export const STELLAR_IDS = ["goatwalker:stellar_taiga"];

// ----------------------------------------------------------------- pacing knobs
export const PACE = { slow: 0.6, normal: 1.0, fast: 2.4 };
export const SHRINE_AT = 45;          // anger at which his shrine appears (unlit)
export const RING_AT = 60;            // anger at which the ring lights and the clock starts
export const CANDLE_BURN = 34;        // seconds per ring candle (8 candles: ~4.5 min warning)

export const ANIMALS = {
  "minecraft:sheep": 3, "minecraft:goat": 3, "minecraft:cow": 1, "minecraft:pig": 1, "minecraft:chicken": 1,
  "minecraft:rabbit": 1, "minecraft:horse": 1, "minecraft:donkey": 1, "minecraft:mule": 1, "minecraft:llama": 1,
  "minecraft:trader_llama": 1, "minecraft:fox": 1, "minecraft:wolf": 1, "minecraft:cat": 1, "minecraft:ocelot": 1,
  "minecraft:parrot": 1, "minecraft:panda": 1, "minecraft:polar_bear": 1, "minecraft:turtle": 1, "minecraft:frog": 1,
  "minecraft:axolotl": 1, "minecraft:camel": 1, "minecraft:sniffer": 1, "minecraft:armadillo": 1,
  "minecraft:mooshroom": 1, "minecraft:bee": 1,
};
const COLORS = ["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan",
  "purple", "blue", "brown", "green", "red", "black"];
export const CANDLES = ["minecraft:candle", ...COLORS.map((c) => `minecraft:${c}_candle`)];
export const TORCHES = ["minecraft:torch", "minecraft:soul_torch"];
export const SMOKE = ["minecraft:campfire", "minecraft:soul_campfire", "minecraft:lit_furnace", "minecraft:lit_smoker",
  "minecraft:lit_blast_furnace", "minecraft:lava", "minecraft:flowing_lava"];
export const LOGS = ["minecraft:spruce_log", `${NS}:gouged_spruce_log`, `${NS}:void_log`, `${NS}:stripped_void_log`,
  `${NS}:carved_void_log`, `${NS}:charred_log`];
export const LEAF_IDS = ["minecraft:spruce_leaves", `${NS}:void_leaves`];
/** light emitters he cares about, and how bright they are */
export const LIGHTS = {
  "minecraft:torch": 14, "minecraft:soul_torch": 10, "minecraft:lantern": 15, "minecraft:soul_lantern": 10,
  "minecraft:glowstone": 15, "minecraft:sea_lantern": 15, "minecraft:shroomlight": 15, "minecraft:lit_pumpkin": 15,
  "minecraft:campfire": 15, "minecraft:soul_campfire": 10, "minecraft:end_rod": 14, "minecraft:beacon": 15,
  "minecraft:lit_redstone_lamp": 15, "minecraft:ochre_froglight": 15, "minecraft:verdant_froglight": 15,
  "minecraft:pearlescent_froglight": 15, "minecraft:copper_torch": 14, "minecraft:copper_lantern": 15,
  "minecraft:light_block_15": 15, "minecraft:light_block_14": 14, "minecraft:light_block_13": 13, "minecraft:light_block_12": 12,
};
export const LIGHT_IDS = Object.keys(LIGHTS);

// blocks a body can stand inside (no collision to speak of)
export const PASS_RE = /(short_grass$|tall_grass$|tallgrass$|fern$|flower|tulip|orchid|allium|bluet|daisy|poppy|dandelion|cornflower|lily_of_the_valley|_bush$|deadbush|snow_layer|sapling|leaf_litter|vine|torch|button|carpet|_rail$|^minecraft:rail$|pressure_plate|wildflowers|light_block|brown_mushroom$|red_mushroom$|sweet_berry|goatwalker:(ash_print|blood_ash|ash_pile|splintered_wood|remains|offering|snuffed_torch|stellar_grass|rift_fern|bleeding_shrub|mooncap|hanging_moss|hanging_moss_tip|ritual_marking|ritual_marking_floor|tattered_cloth|trophy_head|hanging_banner))/;
// blocks nobody should be stood on top of (looks wrong, or floats)
const BAD_GROUND_RE = /(fence|_wall$|_door$|door_block|trapdoor|campfire|cactus|magma|fire|candle|lantern|bed$|chest|sign|void_crystal$|void_crystal_bud|pointed_dripstone|amethyst_cluster|_bud$|chain|ladder|scaffolding)/;
export const LEAVES_RE = /leaves$/;
export const WOOD_RE = /(planks|_log$|_wood$|stripped_|_door$|door_block|trapdoor|fence|_slab$|_stairs$|glass|leaves$|bamboo_block|_stem$|_hyphae$|ladder|crafting_table|^minecraft:bookshelf$|aged_planks|ritual_wood)/;
/** what he will smash through in a chase: built wood, never living trees (no floating canopies) */
export const RAM_RE = /(planks|_door$|door_block|trapdoor|fence|_slab$|_stairs$|glass|bamboo_block|ladder|crafting_table|^minecraft:bookshelf$|ritual_wood|resin_soaked_wood|barrel|_sign$|hay_block)/;
export const SOFT_RE = /(dirt|grass_block|podzol|mycelium|sand$|gravel|clay|mud$|snow|stellar_soil|stellar_dirt|ashen_podzol|moss_block|rooted_dirt|farmland|dirt_path|leaves$|hay_block|wool|netherrack)/;
export const HARD_RE = /(iron|stone|brick|deepslate|blackstone|copper|quartz|sandstone|prismarine|purpur|nether_brick|tuff|concrete|terracotta|obsidian|basalt|andesite|diorite|granite|chest|barrel|chiseled|rift_stone|bleeding_stone|starlit_ore|crystal_block)/;
export const SPLINTER_WOOD = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"];

// ----------------------------------------------------------------- tiny helpers
export const now = () => system.currentTick;
export const rnd = (a, b) => a + Math.random() * (b - a);
export const rint = (a, b) => Math.floor(rnd(a, b + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const chance = (p) => Math.random() < p;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const V = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  mul: (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k }),
  len: (a) => Math.hypot(a.x, a.y, a.z),
  lenH: (a) => Math.hypot(a.x, a.z),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  distH: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
  norm: (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; },
  normH: (a) => { const l = Math.hypot(a.x, a.z) || 1; return { x: a.x / l, y: 0, z: a.z / l }; },
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  floor: (a) => ({ x: Math.floor(a.x), y: Math.floor(a.y), z: Math.floor(a.z) }),
  center: (a) => ({ x: Math.floor(a.x) + 0.5, y: Math.floor(a.y), z: Math.floor(a.z) + 0.5 }),
  up: (a, h) => ({ x: a.x, y: a.y + h, z: a.z }),
  rotY: (a, rad) => ({ x: a.x * Math.cos(rad) - a.z * Math.sin(rad), y: a.y, z: a.x * Math.sin(rad) + a.z * Math.cos(rad) }),
  side: (a) => ({ x: -a.z, y: 0, z: a.x }),
};
export const fromAngle = (rad) => ({ x: Math.cos(rad), y: 0, z: Math.sin(rad) });
export const angleOf = (v) => Math.atan2(v.z, v.x);
export const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const key3 = (l, g) => `${Math.floor(l.x / g)},${Math.floor(l.y / g)},${Math.floor(l.z / g)}`;
export const key2 = (l, g) => `${Math.floor(l.x / g)},${Math.floor(l.z / g)}`;

export function safe(fn, fallback = undefined) {
  try { return fn(); } catch { return fallback; }
}
export function alive(e) { return !!e && safe(() => e.isValid, false) === true; }
export function blockAt(dim, p) {
  return safe(() => dim.getBlock({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }));
}
export function isPassable(b) {
  return !!b && (b.isAir || (!b.isLiquid && PASS_RE.test(b.typeId)));
}
export function isGround(b, allowLeaves = false) {
  if (!b || b.isAir || b.isLiquid) return false;
  const id = b.typeId;
  if (PASS_RE.test(id) || BAD_GROUND_RE.test(id)) return false;
  if (!allowLeaves && LEAVES_RE.test(id)) return false;
  return true;
}
/** First standable spot (feet position, exactly on the ground) at column x,z searching around yHint. */
export function findStand(dim, x, z, yHint, { up = 6, down = 10, height = 3, allowLeaves = false } = {}) {
  const bx = Math.floor(x), bz = Math.floor(z), y0 = Math.floor(yHint);
  for (let y = y0 + up; y >= y0 - down; y--) {
    const g = blockAt(dim, { x: bx, y: y - 1, z: bz });
    if (g === undefined) return undefined;
    if (!isGround(g, allowLeaves)) continue;
    let ok = true;
    for (let h = 0; h < height; h++) {
      const a = blockAt(dim, { x: bx, y: y + h, z: bz });
      if (!a || !isPassable(a)) { ok = false; break; }
    }
    if (!ok) continue;
    // stand exactly on the surface: half slabs and bottom stairs are lower than a full block
    let top = y;
    const gid = g.typeId;
    if (/_slab$/.test(gid) && safe(() => g.permutation.getState("minecraft:vertical_half")) === "bottom") top = y - 0.5;
    return { x: bx + 0.5, y: top, z: bz + 0.5 };
  }
  return undefined;
}
/** Headroom (free blocks) above a feet position, up to `max`. */
export function headroom(dim, pos, max = 4) {
  for (let h = 0; h < max; h++) {
    const b = blockAt(dim, V.up(pos, h));
    if (!b || !isPassable(b)) return h;
  }
  return max;
}
export function playAt(dim, id, loc, volume = 1, pitch = 1) {
  safe(() => dim.playSound(id, loc, { volume, pitch }));
}
export function playFor(p, id, loc, volume = 1, pitch = 1) {
  safe(() => p.playSound(id, { location: loc, volume, pitch }));
}
export function particle(dim, id, loc, vars) {
  safe(() => dim.spawnParticle(id, loc, vars));
}
export function particleDir(dim, id, loc, name, speed, dir) {
  const m = new MolangVariableMap();
  m.setSpeedAndDirection(name, speed, dir);
  particle(dim, id, loc, m);
}
export function setPerm(dim, p, type, states) {
  const b = blockAt(dim, p);
  if (!b) return false;
  return safe(() => { b.setPermutation(BlockPermutation.resolve(type, states)); return true; }, false);
}
export function cmd(e, c) { return safe(() => e.runCommand(c)); }
export function timeOfDay() { return world.getTimeOfDay(); }
export function isNight() { const t = timeOfDay(); return t >= 13000 && t < 23000; }
export function isDusk() { const t = timeOfDay(); return t >= 11600 && t < 13000; }
export function dayIndex() { return Math.floor(world.getAbsoluteTime() / 24000); }
export function isEclipse() { return isNight() && safe(() => world.getMoonPhase(), 1) === MoonPhase.FullMoon; }
export function mobGriefing() { return cfg().grief && safe(() => world.gameRules.mobGriefing, true) !== false; }
/** no harm may come to the player: Peaceful difficulty, or "He can hurt you" switched off on The Wheel */
export function peaceful() { return !cfg().harm || safe(() => world.getDifficulty() === Difficulty.Peaceful, false); }
export function survivalish(p) {
  const g = safe(() => p.getGameMode(), GameMode.Survival);
  return g === GameMode.Survival || g === GameMode.Adventure;
}
export function pace() {
  const v = safe(() => world.getDynamicProperty("gw:pace"));
  return (typeof v === "number" ? v : 1.0) * paceMul();
}
export function say(p, t) { safe(() => p.sendMessage(`§8[Goatwalker]§7 ${t}`)); }
export function hint(p, t) { safe(() => p.onScreenDisplay.setActionBar(t)); }

// ----------------------------------------------------------------- sight
export function eye(p) { return p.getHeadLocation(); }
export function lineClear(dim, from, to) {
  const d = V.sub(to, from);
  const len = V.len(d);
  if (len < 0.6) return true;
  const hit = safe(() => dim.getBlockFromRay(from, V.mul(d, 1 / len), { maxDistance: len - 0.4, includeLiquidBlocks: false, includePassableBlocks: false }));
  return !hit;
}
/** Is a world point inside the player's view cone (roughly on screen)? */
export function inCone(p, pos, cos = 0.58) {
  const to = V.norm(V.sub(pos, eye(p)));
  return V.dot(to, p.getViewDirection()) > cos;
}
/** Could the player see something standing at feet position `pos` (3 blocks tall) right now? */
export function visibleSpot(p, pos, cos = 0.58) {
  const head = V.up(pos, 2.5), mid = V.up(pos, 1.4);
  if (!inCone(p, mid, cos)) return false;
  return lineClear(p.dimension, eye(p), head) || lineClear(p.dimension, eye(p), mid);
}
/** Is a spot exposed to the player's line of sight at all (ignoring where they look)? */
export function exposedSpot(p, pos) {
  return lineClear(p.dimension, eye(p), V.up(pos, 2.5)) || lineClear(p.dimension, eye(p), V.up(pos, 1.4));
}
export function staringAt(p, pos, cos = 0.985) {
  return inCone(p, pos, cos) && lineClear(p.dimension, eye(p), pos);
}
/** Approximate block light at a point from nearby emitters (sky light ignored on purpose: he hates *your* light). */
export function lightAt(dim, loc, r = 7) {
  const c = V.floor(loc);
  let best = 0;
  safe(() => {
    const vol = new BlockVolume({ x: c.x - r, y: c.y - 3, z: c.z - r }, { x: c.x + r, y: c.y + 4, z: c.z + r });
    for (const l of dim.getBlocks(vol, { includeTypes: LIGHT_IDS }, false).getBlockLocationIterator()) {
      const b = blockAt(dim, l);
      if (!b) continue;
      let lv = LIGHTS[b.typeId] || 0;
      if (b.typeId.includes("campfire") && safe(() => b.permutation.getState("extinguished")) === true) lv = 0;
      const d = Math.abs(l.x - c.x) + Math.abs(l.y - c.y) + Math.abs(l.z - c.z);
      best = Math.max(best, lv - d);
    }
  });
  return best;
}

// ----------------------------------------------------------------- biome / domain
export function biomeId(dim, loc) { return safe(() => dim.getBiome(loc).id, ""); }
/** "stellar" (his woods) | "taiga" (the edge he roams) | "other" */
export function domainAt(dim, loc) {
  if (dim.id !== OVERWORLD) return "other";
  const id = biomeId(dim, loc);
  if (STELLAR_IDS.includes(id)) return "stellar";
  if (/taiga|redwood/.test(id)) return "taiga";
  return "other";
}
const EARTH_RE = /(stone|dirt|deepslate|tuff|gravel|andesite|diorite|granite|sand|clay|_ore$|stellar_soil|stellar_dirt|ashen_podzol|rift_stone|grass_block|podzol|bedrock|calcite|basalt|netherrack|mud$|dripstone|moss_block|bleeding_stone|crystal_block)/;
/** Under rock or earth (not merely under a tree or a roof). */
export function isUnderground(p) {
  const dim = p.dimension, h = eye(p);
  const sky = safe(() => dim.getSkyLightLevel(h), 15);
  if (sky > 0) return false;
  for (let dy = 1; dy <= 40; dy++) {
    const b = blockAt(dim, V.up(h, dy));
    if (!b) return false;
    if (b.isAir || b.isLiquid || PASS_RE.test(b.typeId) || LEAVES_RE.test(b.typeId) || /log$|_wood$|planks|_slab$|_stairs$|glass|leaves/.test(b.typeId)) continue;
    return EARTH_RE.test(b.typeId);
  }
  return false;
}

// ----------------------------------------------------------------- player state
export const STATE = new Map();
const PERSIST = ["anger", "sins", "offers", "kills", "intro", "lastHuntDay", "hornDay", "restUntil", "shrine", "meals", "horns",
  "flockDay", "offerDay", "seenDay", "shiftDay", "shifts", "knockDay"];

export function st(p) {
  let s = STATE.get(p.id);
  if (s) return s;
  s = {
    anger: 0, sins: 0, offers: 0, kills: [], intro: 0, lastHuntDay: -9, hornDay: -9, restUntil: -1, shrine: null,
    flockDay: -1, offerDay: -1, seenDay: -1, shiftDay: -1, shifts: 0, knockDay: -1, meals: 0, horns: 0,
    // runtime only
    forest: { woods: false, edge: false, trunks: [], logs: 0, leaves: 0, at: -999 },
    domain: "other", domainAt: -999, under: false,
    enc: null, nextAt: now() + 20 * 40, quietUntil: 0, last: "", bleed: null, fogs: new Set(), smoke: null,
    nextBell: now() + 400, nextDress: now() + 200, nextSmoke: now() + 200, dirty: false, hornCd: 0,
    lastTod: timeOfDay(), music: "", stare: 0, indoor: false, indoorAt: -999, decor: 0,
    lens: false, lensAt: 0, beatAt: 0, group: { n: 0, straggler: false, center: null }, fight: null,
    after: null, crumbs: [], placedAt: [], brokeAt: [], encId: 0, motes: 0, eclipse: false,
  };
  const raw = safe(() => p.getDynamicProperty("gw:state"));
  if (typeof raw === "string") {
    const o = safe(() => JSON.parse(raw), {});
    for (const k of PERSIST) if (o && k in o) s[k] = o[k];
  }
  STATE.set(p.id, s);
  return s;
}
export function saveState(p, s) {
  const o = {};
  for (const k of PERSIST) o[k] = s[k];
  safe(() => p.setDynamicProperty("gw:state", JSON.stringify(o)));
  s.dirty = false;
}
export function addAnger(s, v) {
  s.anger = clamp(s.anger + (v > 0 ? v * aggro() : v), 0, 100);
  s.dirty = true;
}
// ----------------------------------------------------------------- wrath: what his anger makes him
// 0 unaware . 1 watching . 2 stalking . 3 wrathful . 4 hunting.   Everything he does reads this:
// what he chooses to do next, whether he vanishes or comes at you when you walk up to him, the fog, the music.
export const WRATH_AT = [0, 8, 28, 52, 78];
export const WRATH_NAMES = ["unaware of you", "watching you", "stalking you", "wrathful", "hunting you"];
export function wrathOf(s) {
  const a = s.anger;
  return a >= WRATH_AT[4] ? 4 : a >= WRATH_AT[3] ? 3 : a >= WRATH_AT[2] ? 2 : a >= WRATH_AT[1] ? 1 : 0;
}
export function sinLevel(s) {
  return s.sins >= 45 ? 4 : s.sins >= 25 ? 3 : s.sins >= 12 ? 2 : s.sins >= 3 ? 1 : 0;
}
export function inWoods(s) { return s.domain === "stellar" || s.forest.woods; }
export function nearWoods(s) { return inWoods(s) || s.domain === "taiga" || s.forest.edge; }

// ----------------------------------------------------------------- fog / music layers
const FOGS = { near: `${NS}:fog_near`, hunt: `${NS}:fog_hunt`, eclipse: `${NS}:fog_eclipse`, wrath: `${NS}:fog_wrath`, tooslow: `${NS}:fog_tooslow` };
export function pushFog(p, s, k) {
  if (s.fogs.has(k)) return;
  s.fogs.add(k);
  cmd(p, `fog @s push ${FOGS[k]} gw_${k}`);
}
export function popFog(p, s, k) {
  if (!s.fogs.has(k)) return;
  s.fogs.delete(k);
  cmd(p, `fog @s remove gw_${k}`);
}
export function clearFogs(p) { for (const k of Object.keys(FOGS)) cmd(p, `fog @s remove gw_${k}`); }
export function music(p, s, track) {
  if (s.music === track) return;
  if (!track) safe(() => __dw.musicStop("goatwalker", p));
  else safe(() => __dw.musicPlay("goatwalker", p, track, { loop: true, fade: 2.0, volume: 1.0 }));
  s.music = track;
}

// ----------------------------------------------------------------- world decay list
// things that age: ash prints fade, ash piles blow away, fresh gouges dry, offerings are taken
let DECAY = [];
let decayDirty = false;
export function loadDecay() {
  const raw = safe(() => world.getDynamicProperty("gw:decay"));
  DECAY = typeof raw === "string" ? safe(() => JSON.parse(raw), []) : [];
}
export function track(kind, loc, extra = {}) {
  DECAY.push({ k: kind, x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z), t: world.getAbsoluteTime(), ...extra });
  while (DECAY.length > 400) {                 // over budget: the oldest hoofprint blows away early
    let i = DECAY.findIndex((d) => d.k === "print");
    if (i < 0) i = 0;
    const [old] = DECAY.splice(i, 1);
    const b = blockAt(world.getDimension(OVERWORLD), old);
    if (b && b.typeId === `${NS}:ash_print`) safe(() => b.setType("minecraft:air"));
  }
  decayDirty = true;
}
export function processDecay() {
  const dim = world.getDimension(OVERWORLD);
  const T = world.getAbsoluteTime();
  const keep = [];
  for (const d of DECAY) {
    const b = blockAt(dim, d);
    if (b === undefined) { keep.push(d); continue; }           // not loaded: try later
    const age = (T - d.t) / 20;
    const id = b.typeId;
    if (d.k === "print") {
      if (id !== `${NS}:ash_print`) continue;
      const f = age > 540 ? 3 : age > 360 ? 2 : age > 180 ? 1 : 0;
      if (f === 3) { safe(() => b.setType("minecraft:air")); continue; }
      safe(() => b.setPermutation(b.permutation.withState(`${NS}:fade`, f)));
      keep.push(d);
    } else if (d.k === "pile") {
      if (id !== `${NS}:ash_pile`) continue;
      const stg = Math.floor(age / 45);
      if (stg > 3) { safe(() => b.setType("minecraft:air")); particle(dim, `${NS}:ash_flake`, V.add(d, { x: 0.5, y: 0.3, z: 0.5 })); continue; }
      const cur = safe(() => b.permutation.getState(`${NS}:stage`));
      if (cur !== stg) {
        safe(() => b.setPermutation(b.permutation.withState(`${NS}:stage`, stg)));
        particle(dim, `${NS}:ash_flake`, V.add(d, { x: 0.5, y: 0.3, z: 0.5 }));
      }
      keep.push(d);
    } else if (d.k === "blood") {
      if (id !== `${NS}:blood_ash`) continue;
      if (age > 720) { safe(() => b.setType("minecraft:air")); continue; }
      if (age > 300) safe(() => b.setPermutation(b.permutation.withState(`${NS}:fade`, 1)));
      keep.push(d);
    } else if (d.k === "gouge") {
      if (id !== `${NS}:gouged_spruce_log`) continue;
      if (age > 240) { safe(() => b.setPermutation(b.permutation.withState(`${NS}:mark`, 1))); continue; }
      if (chance(0.5)) particle(dim, `${NS}:blood_drip`, { x: d.x + 0.5, y: d.y + 0.05, z: d.z + 0.5 });
      keep.push(d);
    } else if (d.k === "offer") {
      if (id !== `${NS}:offering`) continue;
      const rotten = safe(() => b.permutation.getState(`${NS}:rotten`)) === true;
      if (!rotten && age > 90) {                                  // he took it; bones are left
        setPerm(dim, d, `${NS}:remains`, { [`${NS}:kind`]: 2, [`${NS}:rot`]: rint(0, 3) });
        playAt(dim, "goatwalker.gnaw", V.add(d, { x: 0.5, y: 0.5, z: 0.5 }), 0.5, 0.8);
        continue;
      }
      if (rotten && age > 360) { safe(() => b.setType("minecraft:air")); continue; }
      keep.push(d);
    } else if (d.k === "splinter") {
      if (id !== `${NS}:splintered_wood`) continue;
      if (age > 480) { safe(() => b.setType("minecraft:air")); continue; }
      keep.push(d);
    } else if (d.k === "light") {                                 // a flare's light, or a stolen glow
      if (!id.startsWith("minecraft:light_block")) continue;
      if (age > (d.life || 22)) { safe(() => b.setType("minecraft:air")); continue; }
      keep.push(d);
    }
  }
  if (keep.length !== DECAY.length) decayDirty = true;
  DECAY = keep;
  if (decayDirty) {
    safe(() => world.setDynamicProperty("gw:decay", JSON.stringify(DECAY)));
    decayDirty = false;
  }
}

// ----------------------------------------------------------------- decor placement (never floating)
export function placeFloorDecal(dim, loc, type, states, kind) {
  const f = V.floor(loc);
  for (let dy = 1; dy >= -2; dy--) {
    const at = { x: f.x, y: f.y + dy, z: f.z };
    const b = blockAt(dim, at), below = blockAt(dim, V.up(at, -1));
    if (!b || !below) return false;
    if ((b.isAir || /short_grass$|tall_grass$|fern$|leaf_litter|stellar_grass/.test(b.typeId)) && isGround(below) && !LEAVES_RE.test(below.typeId)
        && !/_slab$|_stairs$/.test(below.typeId)) {
      if (b.typeId === "minecraft:tall_grass" || b.typeId === "minecraft:large_fern") {
        safe(() => b.above()?.setType("minecraft:air"));
      }
      if (setPerm(dim, at, type, states)) { if (kind) track(kind, at); return true; }
      return false;
    }
  }
  return false;
}
export function dirIndex(v) {           // rotation index for decals (0 north, 1 west, 2 south, 3 east)
  if (Math.abs(v.z) >= Math.abs(v.x)) return v.z < 0 ? 0 : 2;
  return v.x < 0 ? 1 : 3;
}
export const CARDINAL = ["north", "west", "south", "east"];
export function placePrint(dim, loc, travel) {
  return placeFloorDecal(dim, loc, `${NS}:ash_print`, { [`${NS}:fade`]: 0, [`${NS}:rot`]: dirIndex(travel) }, "print");
}
export function placePile(dim, loc) {
  return placeFloorDecal(dim, loc, `${NS}:ash_pile`, { [`${NS}:stage`]: 0 }, "pile");
}
export function placeBlood(dim, loc) {
  return placeFloorDecal(dim, V.add(loc, { x: rnd(-1, 1), y: 0, z: rnd(-1, 1) }), `${NS}:blood_ash`, { [`${NS}:fade`]: 0, [`${NS}:ichor`]: true }, "blood");   // his blood is black
}
function vertical(b) {
  if (b.typeId === "minecraft:spruce_log") return safe(() => b.permutation.getState("pillar_axis")) === "y";
  const f = safe(() => b.permutation.getState("minecraft:block_face"));
  return f === "up" || f === "down" || f === undefined;
}
/** Horn gouge / gnaw mark on a natural trunk (spruce or void), facing a point. mark: 0 fresh, 1 old, 2 gnawed */
export function markTrunk(dim, at, mark, toward) {
  const b = blockAt(dim, at);
  if (!b || (b.typeId !== "minecraft:spruce_log" && b.typeId !== `${NS}:void_log`)) return false;
  if (!vertical(b)) return false;
  const wood = b.typeId === `${NS}:void_log` ? 1 : 0;
  const facing = dirIndex(V.sub(toward, V.add(at, { x: 0.5, y: 0, z: 0.5 })));
  const ok = setPerm(dim, at, `${NS}:gouged_spruce_log`, { [`${NS}:mark`]: mark, [`${NS}:facing`]: facing, [`${NS}:wood`]: wood });
  if (ok && mark === 0) track("gouge", at);
  return ok;
}
/** Something hung on a trunk or wall while you weren't looking (trophy skull, ritual marking, cloth). */
export function hangOn(dim, wallBlock, face, type) {
  // face: the side of wallBlock that faces open air; the decor goes in the air block on that side
  const OFF = { north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 }, west: { x: -1, y: 0, z: 0 }, east: { x: 1, y: 0, z: 0 } };
  const o = OFF[face];
  const at = V.add(wallBlock, o);
  const b = blockAt(dim, at);
  if (!b || !b.isAir) return false;
  // decor model hugs its north side; it faces away from the wall it hangs on
  const facing = { north: "south", south: "north", west: "east", east: "west" }[face];
  return setPerm(dim, at, type, { "minecraft:cardinal_direction": facing });
}

// ----------------------------------------------------------------- forest awareness
export function scanForest(p, s) {
  const dim = p.dimension;
  const c = V.floor(p.location);
  const vol = new BlockVolume({ x: c.x - 18, y: c.y - 8, z: c.z - 18 }, { x: c.x + 18, y: c.y + 16, z: c.z + 18 });
  const logs = [];
  let leaves = 0;
  const ok = safe(() => {
    const L = dim.getBlocks(vol, { includeTypes: LOGS }, false);
    for (const loc of L.getBlockLocationIterator()) { logs.push({ x: loc.x, y: loc.y, z: loc.z }); if (logs.length > 1400) break; }
    const F = dim.getBlocks(vol, { includeTypes: LEAF_IDS }, false);
    for (const _ of F.getBlockLocationIterator()) { if (++leaves > 500) break; }
    return true;
  }, false);
  if (!ok) return;
  // columns of logs ...
  const cols = new Map();
  for (const l of logs) {
    const k = l.x + "," + l.z;
    const t = cols.get(k);
    if (!t) cols.set(k, { x: l.x, z: l.z, y0: l.y, y1: l.y });
    else { t.y0 = Math.min(t.y0, l.y); t.y1 = Math.max(t.y1, l.y); }
  }
  // ... merged into trunks (giant void trees are 2-4 blocks thick)
  const list = [...cols.values()].filter((t) => t.y1 - t.y0 >= 3);
  const seen = new Set();
  const trunks = [];
  for (const t of list) {
    const k0 = t.x + "," + t.z;
    if (seen.has(k0)) continue;
    const group = [t];
    seen.add(k0);
    for (let i = 0; i < group.length; i++) {
      const g = group[i];
      for (const o of list) {
        const k = o.x + "," + o.z;
        if (seen.has(k)) continue;
        if (Math.abs(o.x - g.x) <= 1 && Math.abs(o.z - g.z) <= 1) { seen.add(k); group.push(o); }
      }
      if (group.length > 30) break;
    }
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const g of group) { x0 = Math.min(x0, g.x); x1 = Math.max(x1, g.x); z0 = Math.min(z0, g.z); z1 = Math.max(z1, g.z); y0 = Math.min(y0, g.y0); y1 = Math.max(y1, g.y1); }
    trunks.push({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.max(x1 - x0, z1 - z0) / 2 + 0.5, y0, y1,
      bx: group[0].x, bz: group[0].z });
  }
  s.forest = { at: now(), logs: logs.length, leaves, trunks, woods: trunks.length >= 5 && leaves >= 110, edge: trunks.length >= 2 };
}
export function nearbyTrunks(p, s, min, max) {
  const out = [];
  const at = p.location;
  for (const t of s.forest.trunks) {
    const d = V.distH(at, { x: t.x + 0.5, z: t.z + 0.5, y: 0 });
    if (d >= min && d <= max) out.push(t);
  }
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
export function isIndoors(p, s) {
  if (now() - s.indoorAt < 60) return s.indoor;
  s.indoorAt = now();
  const dim = p.dimension, h = eye(p);
  let roof = false;
  for (let dy = 1; dy <= 8; dy++) {
    const b = blockAt(dim, V.up(h, dy));
    if (!b) break;
    if (!b.isAir && !b.isLiquid && !LEAVES_RE.test(b.typeId) && !PASS_RE.test(b.typeId)) { roof = true; break; }
  }
  let walls = 0;
  if (roof) {
    for (const d of [{ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 }]) {
      const hit = safe(() => dim.getBlockFromRay(h, d, { maxDistance: 8, includePassableBlocks: false }));
      if (hit && !LEAVES_RE.test(hit.block.typeId)) walls++;
    }
  }
  s.indoor = roof && walls >= 3;
  return s.indoor;
}
/** The way out of an enclosed space: a door if there is one, else the longest open horizontal ray. */
export function findEntrance(p) {
  const dim = p.dimension, h = eye(p), c = V.floor(p.location);
  const doors = [];
  safe(() => {
    const vol = new BlockVolume({ x: c.x - 9, y: c.y - 2, z: c.z - 9 }, { x: c.x + 9, y: c.y + 3, z: c.z + 9 });
    for (const l of dim.getBlocks(vol, { excludeTypes: ["minecraft:air"] }, false).getBlockLocationIterator()) {
      const b = blockAt(dim, l);
      if (!b) continue;
      const id = b.typeId;
      if (/_door$|void_door_block/.test(id) && !id.includes("trapdoor")) {
        const upper = id === `${NS}:void_door_block` ? safe(() => b.permutation.getState(`${NS}:upper`)) : safe(() => b.permutation.getState("upper_block_bit"));
        if (!upper) doors.push({ x: l.x, y: l.y, z: l.z, door: true });
      }
      if (doors.length > 6) break;
    }
  });
  if (doors.length) {
    doors.sort((a, b) => V.dist(a, h) - V.dist(b, h));
    const d = doors[0];
    // outside = the side of the door further from the player
    const out = V.normH(V.sub(V.add(d, { x: 0.5, y: 0, z: 0.5 }), p.location));
    const axis = Math.abs(out.x) > Math.abs(out.z) ? { x: Math.sign(out.x), y: 0, z: 0 } : { x: 0, y: 0, z: Math.sign(out.z) };
    return { at: V.add(d, { x: 0.5, y: 0, z: 0.5 }), out: axis, door: d };
  }
  let best = null;
  for (let i = 0; i < 16; i++) {
    const dir = fromAngle((i / 16) * Math.PI * 2);
    const hit = safe(() => dim.getBlockFromRay(h, dir, { maxDistance: 24, includePassableBlocks: false }));
    const len = hit ? V.distH(hit.block.location, h) : 24;
    if (!best || len > best.len) best = { len, dir };
  }
  if (!best || best.len < 5) return undefined;
  return { at: V.add(p.location, V.mul(best.dir, Math.min(best.len - 1, 8))), out: best.dir, door: null };
}

// ----------------------------------------------------------------- spot finding
export function viewYaw(p) { return angleOf(p.getViewDirection()); }

/** Ground spot at distance [min,max]; side: "behind" | "front" | "any"; hidden: not visible right now */
export function groundSpot(p, { min, max, side = "any", hidden = true, exposed = false, center = undefined, tries = 18, height = 3 }) {
  const dim = p.dimension;
  const c = center || p.location;
  const yaw = viewYaw(p);
  for (let i = 0; i < tries; i++) {
    let a = rnd(0, Math.PI * 2);
    if (side === "behind") a = yaw + Math.PI + rnd(-1.2, 1.2);
    if (side === "front") a = yaw + rnd(-0.9, 0.9);
    if (side === "flank") a = yaw + (chance(0.5) ? 1 : -1) * rnd(1.1, 1.9);
    const r = rnd(min, max);
    const pos = findStand(dim, c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, c.y, { height });
    if (!pos) continue;
    if (V.dist(pos, p.location) < 6) continue;
    if (hidden && visibleSpot(p, pos)) continue;
    if (exposed && !exposedSpot(p, pos)) continue;
    return pos;
  }
  return undefined;
}
/** Spot beside a trunk. kind: "peek" (trunk on his right, facing you), "hide" (fully behind), "gnaw" */
export function trunkSpot(p, s, { min, max, kind = "peek", hidden = true, exposedHead = false, from = undefined }) {
  const dim = p.dimension;
  const src = from || p.location;
  for (const t of nearbyTrunks(p, s, min, max).slice(0, 14)) {
    const tc = { x: t.x + 0.5, y: t.y0, z: t.z + 0.5 };
    const away = V.normH(V.sub(tc, src));                 // from player through the trunk
    const r = t.r || 0.5;
    let pos, face;
    if (kind === "hide") { pos = V.add(tc, V.mul(away, r + 0.75)); face = p.location; }
    else if (kind === "peek") {
      const f = V.mul(away, -1);                          // he faces the player
      const right = V.side(f);
      pos = V.add(V.add(tc, V.mul(right, -(r + 0.55))), V.mul(away, 0.4));
      face = p.location;
    } else {
      const f = V.rotY(away, chance(0.5) ? Math.PI / 2 : -Math.PI / 2);
      pos = V.add(tc, V.mul(V.side(f), -(r + 0.55)));
      face = V.add(pos, f);
    }
    const stand = findStand(dim, pos.x, pos.z, t.y0, { up: 3, down: 4 });
    if (!stand) continue;
    if (hidden && visibleSpot(p, stand)) continue;
    if (exposedHead && !exposedSpot(p, stand)) continue;
    return { pos: stand, face, trunk: t };
  }
  return undefined;
}
/** Somewhere above you: a tree top, a roof, a ledge. */
export function perchSpot(p, s, { min = 10, max = 30 } = {}) {
  const dim = p.dimension;
  const cands = [];
  for (const t of nearbyTrunks(p, s, min, max).slice(0, 10)) cands.push({ x: t.bx ?? t.x, z: t.bz ?? t.z });
  for (let i = 0; i < 10; i++) {
    const a = rnd(0, Math.PI * 2), r = rnd(min, max);
    cands.push({ x: Math.floor(p.location.x + Math.cos(a) * r), z: Math.floor(p.location.z + Math.sin(a) * r) });
  }
  for (const c of cands) {
    const top = safe(() => dim.getTopmostBlock({ x: c.x, z: c.z }));
    if (!top || top.isLiquid || PASS_RE.test(top.typeId) || BAD_GROUND_RE.test(top.typeId)) continue;
    if (top.location.y < p.location.y + 3 || top.location.y > p.location.y + 26) continue;
    const pos = { x: c.x + 0.5, y: top.location.y + 1, z: c.z + 0.5 };
    let clear = true;
    for (let h = 0; h < 3; h++) { const a = blockAt(dim, V.up(pos, h)); if (!a || !a.isAir) { clear = false; break; } }
    if (!clear) continue;
    if (visibleSpot(p, pos)) continue;           // appear while you are not looking ...
    if (!exposedSpot(p, pos)) continue;          // ... somewhere you will see when you turn
    return pos;
  }
  return undefined;
}
/** A dark, standable spot along a tunnel, out of your torchlight. */
export function caveSpot(p, { min = 12, max = 26, behind = false } = {}) {
  const dim = p.dimension, h = eye(p);
  const yaw = viewYaw(p);
  const from = V.up(p.location, 1.1);
  for (let i = 0; i < 28; i++) {
    // tunnels are narrow: try along the four axes first, then anywhere
    const a = i < 8 ? (Math.floor(i / 2) * Math.PI / 2 + (i % 2 ? 0.08 : -0.08)) : behind ? yaw + Math.PI + rnd(-1.3, 1.3) : rnd(0, Math.PI * 2);
    const dir = V.norm({ x: Math.cos(a), y: rnd(-0.04, 0.02), z: Math.sin(a) });
    const hit = safe(() => dim.getBlockFromRay(from, dir, { maxDistance: max + 2, includePassableBlocks: false }));
    const len = hit ? V.distH(hit.block.location, from) - 1.2 : max;
    if (len < min) continue;
    const d = rnd(min, Math.min(len, max));
    const at = V.add(from, V.mul(dir, d));
    const pos = findStand(dim, at.x, at.z, at.y, { up: 2, down: 4, height: 2 });
    if (!pos) continue;
    if (!lineClear(dim, h, V.up(pos, 1.2))) continue;
    if (visibleSpot(p, pos)) continue;
    if (lightAt(dim, pos, 6) > 6) continue;
    return { pos, low: headroom(dim, pos, 3) < 3 };
  }
  return undefined;
}

/** Path blocked and nobody watching: slip a few blocks closer, out of sight.  Never used during a pursuit. */
export function hopToward(p, w, goal) {
  if (!w.ok || visibleSpot(p, w.loc)) return false;
  const toward = V.normH(V.sub(goal, w.loc));
  for (let i = 0; i < 4; i++) {
    const hop = V.add(w.loc, V.mul(V.rotY(toward, rnd(-0.5, 0.5)), rnd(4, 7)));
    const pos = findStand(p.dimension, hop.x, hop.z, w.loc.y);
    if (pos && !visibleSpot(p, pos) && V.dist(pos, p.location) > 7) {
      safe(() => w.e.teleport(pos, { facingLocation: V.up(p.location, 1.6) }));
      return true;
    }
  }
  return false;
}
export function shakeCam(p, intensity, seconds) {
  if (!cfg().shake) return;
  cmd(p, `camerashake add @s ${intensity.toFixed(3)} ${seconds.toFixed(2)} positional`);
}
/**
 * The jumpscare: the camera is torn round to his face, an arm's length away, with a shriek and a red flash, and
 * let go a moment later.  At most one every 25 seconds.  `head` is where his face is.  Returns true if it happened.
 */
export function jumpscare(p, head, opts = {}) {
  if (!cfg().jumpscare && !opts.force) return false;
  const s = st(p);
  if (!opts.force && now() < (s.scareCd || 0)) return false;
  if (!head || !alive(p)) return false;
  s.scareCd = now() + 20 * 25;
  const from = V.normH(V.sub(eye(p), head));                       // from his face toward you
  const at = { x: head.x + from.x * 1.45, y: head.y, z: head.z + from.z * 1.45 };   // just clear of his snout and horns
  safe(() => p.camera.fade({ fadeColor: { red: 0.45, green: 0.0, blue: 0.0 }, fadeTime: { fadeInTime: 0.0, holdTime: 0.06, fadeOutTime: 0.3 } }));
  const ok = safe(() => { p.camera.setCamera("minecraft:free", { location: at, facingLocation: { x: head.x, y: head.y - 0.05, z: head.z } }); return true; }, false);
  playFor(p, "goatwalker.jumpscare", eye(p), 1.0, rnd(0.92, 1.05));
  shakeCam(p, 0.55, 0.7);
  s.scaring = now();
  system.runTimeout(() => {
    safe(() => p.camera.clear());
    safe(() => p.camera.fade({ fadeColor: { red: 0.0, green: 0.0, blue: 0.0 }, fadeTime: { fadeInTime: 0.0, holdTime: 0.12, fadeOutTime: 0.5 } }));
    s.scaring = 0;
  }, opts.hold ?? 14);
  return ok;
}
/** words across the middle of the screen (the chase; fourth-wall scares) */
export function flash(p, title, sub = "", stay = 14, fadeIn = 0, fadeOut = 6) {
  safe(() => p.onScreenDisplay.setTitle(title, { subtitle: sub, fadeInDuration: fadeIn, stayDuration: stay, fadeOutDuration: fadeOut }));
}
/** a point on the ground about `r` blocks from the player in direction `ang` (radians), nudged until he can stand there */
export function standNear(p, ang, r, { spread = 0.5, height = 3 } = {}) {
  const l = p.location;
  for (const da of [0, spread * 0.5, -spread * 0.5, spread, -spread, spread * 1.6, -spread * 1.6]) {
    for (const rr of [r, r + 2, r - 2, r + 4]) {
      if (rr < 3) continue;
      const pos = findStand(p.dimension, l.x + Math.cos(ang + da) * rr, l.z + Math.sin(ang + da) * rr, l.y, { height });
      if (pos && Math.abs(pos.y - l.y) < 7) return pos;
    }
  }
  return undefined;
}
export function heldItem(p) {
  return safe(() => p.getComponent("minecraft:inventory").container.getItem(p.selectedSlotIndex));
}
export function consumeHeld(p, typeId) {
  const inv = p.getComponent("minecraft:inventory");
  const c = inv && inv.container;
  if (!c) return false;
  const slot = p.selectedSlotIndex;
  const it = c.getItem(slot);
  if (!it || it.typeId !== typeId) return false;
  if (it.amount > 1) { it.amount -= 1; c.setItem(slot, it); } else c.setItem(slot, undefined);
  return true;
}
