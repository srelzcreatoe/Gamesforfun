// @ts-check
// The Weeping Mire — the Observer's home biome (merged from the user's Weeping Mire 1.2.6; its world
// generation, blocks and look are unchanged). This is the Mire's script, ported: wind gusts and
// leaves for players in the Mire, leaves drifting off the weeping trees, and the torn pages.
// In the original, a faceless "watcher" stood out among the trees and appeared behind you after you read
// the pages. In the merged add-on that watcher is the Observer: its appearances go to the encounter
// "In the Mire" (encounters/mire_watcher.js).
// The Mire generates often and close to the world spawn (biomes/weeping_mire.biome.json); you never start
// in it: a first spawn inside it is moved just outside, facing it, and the world spawn with it.
import { world, system, MolangVariableMap } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { safe, allPlayers, emit, trace } from "../core/util.js";
import { ps } from "../core/state.js";

export const MIRE_BIOME = "wmire:weeping_mire";
const PAGES = [
  "IT DOES NOT MOVE\nWHILE YOU WATCH",
  "the roots are bones.\n\nwhose bones?",
  "count the trees.\nthere is always one\nmore than yesterday.",
  "if the wind stops,\ndo not turn around",
  "black mist where it stood.\nthe ground was cold.",
  "it has no face.\nonly two lights.",
  "I left the lantern burning.\nit was dark when I\ncame back.",
  "ALL OF THEM.\nNOW IT KNOWS YOUR NAME.",
];
const PAGE_PROP = "wmire:pages_found";

/** Is the player standing in the Weeping Mire? @param {import("@minecraft/server").Player} player */
export function inMire(player) {
  if (player.dimension.id !== "minecraft:overworld") return false;
  return safe(() => player.dimension.getBiome(player.location)?.id, "") === MIRE_BIOME;
}

/** @type {Map<string, number>} player id -> seconds spent in the Mire without leaving it */
const here = new Map();
/** Seconds this player has been in the Mire without leaving (0 when outside). @param {string} pid */
export const secondsHere = (pid) => here.get(pid) ?? 0;
/** @param {string} pid */
export const forget = (pid) => here.delete(pid);

/** @type {{watcher:(p:import("@minecraft/server").Player, o:{minDist:number, maxDist:number, behind:boolean, why:string})=>void}} */
let hooks = { watcher: () => {} };

// ------------------------------------------------------------------ wind
const wind = { angle: Math.random() * Math.PI * 2, gust: 0, gustStart: -1, gustLen: 0, nextGust: 300 };

function updateWind(tick) {
  wind.angle += (Math.random() - 0.5) * 0.08; // slow drift
  if (wind.gustStart < 0 && tick >= wind.nextGust) {
    wind.gustStart = tick;
    wind.gustLen = 80 + Math.floor(Math.random() * 80); // 4-8 seconds
    wind.angle += (Math.random() - 0.5) * 0.9; // a gust swings the direction a little
  }
  if (wind.gustStart >= 0) {
    const t = (tick - wind.gustStart) / wind.gustLen;
    if (t >= 1) {
      wind.gustStart = -1;
      wind.gust = 0;
      wind.nextGust = tick + 500 + Math.floor(Math.random() * 600); // calm for 25-55 s
    } else wind.gust = Math.sin(Math.PI * t);
  }
}

/** Is the wind blowing hard right now (0..1)? */
export const gust = () => wind.gust;

function windVars(count) {
  const v = new MolangVariableMap();
  v.setFloat("variable.wind_x", Math.cos(wind.angle));
  v.setFloat("variable.wind_z", Math.sin(wind.angle));
  v.setFloat("variable.speed", 1.2 + wind.gust * 7);
  v.setFloat("variable.count", count);
  return v;
}

/** Every 10 ticks. */
function tickWind() {
  const tick = system.currentTick;
  updateWind(tick);
  const gustBegins = wind.gustStart >= 0 && tick - wind.gustStart < 10;
  const wx = Math.cos(wind.angle);
  const wz = Math.sin(wind.angle);
  for (const player of allPlayers()) {
    if (!inMire(player)) {
      here.delete(player.id);
      continue;
    }
    here.set(player.id, (here.get(player.id) ?? 0) + 0.5);
    const l = player.location;
    const upwind = { x: l.x - wx * 10, y: l.y + 3, z: l.z - wz * 10 };
    safe(() => {
      player.spawnParticle("wmire:wind_motes", { x: l.x, y: l.y + 2, z: l.z }, windVars(3));
      player.spawnParticle("wmire:wind_leaves", upwind, windVars(1 + Math.round(wind.gust * 6)));
      if (wind.gust > 0.3) player.spawnParticle("wmire:wind_streak", upwind, windVars(Math.round(wind.gust * 4)));
      if (gustBegins) player.playSound("elytra.loop", { volume: 0.3, pitch: 0.7 });
    });
  }
}

// ------------------------------------------------------------------ leaves drifting off the trees
/** @type {import("@minecraft/server").BlockCustomComponent} */
const fallingLeaves = {
  onRandomTick({ block, dimension }) {
    if (Math.random() > 0.15 + wind.gust * 0.5) return;
    safe(() => {
      const below = block.below();
      if (!below || !below.isAir) return;
      dimension.spawnParticle("wmire:falling_leaf", { x: block.x + 0.5, y: block.y - 0.05, z: block.z + 0.5 }, windVars(1));
    });
  },
};

// ------------------------------------------------------------------ torn pages
function pageIndex(b) {
  // well-mixed 32-bit hash of the block position, so nearby pages show different notes
  let h = Math.imul(b.x, 73856093) ^ Math.imul(b.y, 19349663) ^ Math.imul(b.z, 83492791);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return h >>> 0;
}

function countBits(n) {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>>= 1;
  }
  return c;
}

/** A page was read: remember it; a new page may draw the Observer, and all eight always do. */
export function pageRead(player, idx) {
  let mask = Number(player.getDynamicProperty(PAGE_PROP) ?? 0);
  const isNew = (mask & (1 << idx)) === 0;
  mask |= 1 << idx;
  player.setDynamicProperty(PAGE_PROP, mask);
  const found = countBits(mask);
  return { isNew, found, all: found === PAGES.length };
}

function readPage(player, idx) {
  const r = pageRead(player, idx);
  player.playSound("item.book.page_turn", { volume: 0.9, pitch: 0.75 });
  new ActionFormData()
    .title(`Torn Page   ${r.found}/${PAGES.length}`)
    .body(PAGES[idx])
    .button("Put it back")
    .show(player)
    .then(() => afterRead(player, r))
    .catch(() => {});
}

/**
 * What follows a torn page once it is put back: a new page sometimes (one in five) brings the Observer
 * up behind you, and the last of the eight always does.
 * @param {import("@minecraft/server").Player} player @param {{isNew:boolean, all:boolean}} r @param {number} [roll]
 */
export function afterRead(player, r, roll = Math.random()) {
  if (!r.isNew || !player.isValid) return;
  if (r.all) {
    safe(() => player.onScreenDisplay.setTitle("§8. . .", { subtitle: "§7it knows your name", fadeInDuration: 20, stayDuration: 60, fadeOutDuration: 20 }));
    hooks.watcher(player, { minDist: 12, maxDist: 14, behind: true, why: "all_pages" });
  } else if (roll < 0.2) hooks.watcher(player, { minDist: 16, maxDist: 24, behind: true, why: "page" });
}

/**
 * Tests / dev: read torn page idx now, without the form; a new page always draws it. all: the other
 * seven count as found, so this is the last one. clear: forget every page.
 * @param {import("@minecraft/server").Player} player @param {number} idx @param {"page"|"all"|"clear"} how
 */
export function readNow(player, idx, how) {
  if (how === "clear") {
    player.setDynamicProperty(PAGE_PROP, undefined);
    return { isNew: false, found: 0, all: false };
  }
  if (how === "all") player.setDynamicProperty(PAGE_PROP, ((1 << PAGES.length) - 1) & ~(1 << idx));
  const r = pageRead(player, idx);
  afterRead(player, r, 0);
  return r;
}

/** @type {import("@minecraft/server").BlockCustomComponent} */
const readablePage = {
  onPlayerInteract({ block, player }) {
    if (!player) return;
    const idx = pageIndex(block) % PAGES.length;
    system.run(() => readPage(player, idx));
  },
};

// ------------------------------------------------------------------ first spawn: near the Mire, never in it
const SEEN_PROP = "wmire:arrived";
const NOT_GROUND = /leaves|log|wood|tendril|water|lava|magma|fire|cactus|powder_snow/;
/** Room for a player: air or something you walk through. */
const PASSABLE = /grass|fern|flower|bush|sprout|torn_page|vine|snow_layer|leaf_litter|dandelion|poppy|tulip|orchid|allium|bluet|daisy|lily_of|cornflower|mushroom|sapling/;
/** How far from the world spawn a first spawn may land and still count as "at the world spawn". */
const SPAWN_RADIUS = 48;

/** @param {import("@minecraft/server").Dimension} dim @param {{x:number,y:number,z:number}} l */
const biomeAt = (dim, l) => safe(() => dim.getBiome(l)?.id, undefined);

/** Dry standing ground in this column (loaded chunks only), with room for a player. @param {import("@minecraft/server").Dimension} dim */
function dryGround(dim, x, z) {
  const g = safe(() => dim.getBlockBelow({ x, y: 319, z }, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: 384 }));
  if (!g || g.isLiquid || NOT_GROUND.test(g.typeId)) return undefined;
  for (let dy = 1; dy <= 2; dy++) {
    const b = safe(() => g.above(dy));
    if (!b || !(b.isAir || PASSABLE.test(b.typeId))) return undefined;
  }
  return { x: Math.floor(x) + 0.5, y: g.location.y + 1, z: Math.floor(z) + 0.5 };
}

/**
 * The nearest dry ground outside the Mire, at least 6 blocks clear of its edge, searched outward ring by ring
 * (one ring a tick, up to 160 blocks, loaded chunks only).
 * @param {import("@minecraft/server").Dimension} dim @param {{x:number,y:number,z:number}} from
 */
async function outside(dim, from) {
  for (let r = 6; r <= 160; r += 4) {
    const start = Math.random() * 360;
    for (let a = 0; a < 360; a += 10) {
      const rad = ((start + a) * Math.PI) / 180;
      const dx = Math.sin(rad), dz = Math.cos(rad);
      const g = dryGround(dim, from.x + dx * r, from.z + dz * r);
      if (!g) continue;
      const here = biomeAt(dim, g);
      if (here === undefined || here === MIRE_BIOME) continue;
      const beyond = { x: g.x + dx * 6, y: g.y, z: g.z + dz * 6 };
      const b = biomeAt(dim, beyond);
      if (b === undefined || b === MIRE_BIOME) continue;
      return g;
    }
    await system.waitTicks(1);
  }
  return undefined;
}

/**
 * A player's first time in this world. If they came in at the world spawn and that is inside the Mire, they are
 * moved to the nearest ground just outside it, facing it, and the world spawn moves there too (so a respawn or
 * the next new player starts outside it as well).
 * @param {import("@minecraft/server").Player} player
 */
async function firstSpawn(player) {
  if (!player.isValid || player.getDynamicProperty(SEEN_PROP)) return;
  player.setDynamicProperty(SEEN_PROP, true);
  // only someone new: a player returning from before this version has played here already, wherever they stand
  const isNew = (ps(player).play ?? 0) < 60;
  const ws = world.getDefaultSpawnLocation();
  const at = player.location;
  // a new world's spawn is unset (y 32767): the game picks the spot itself, near 0,0 or wherever there is land
  // (a first spawn can have no bed of its own)
  const unset = ws.y >= 32000;
  const atSpawn = isNew && player.dimension.id === "minecraft:overworld" && (unset || Math.hypot(at.x - ws.x, at.z - ws.z) <= SPAWN_RADIUS);
  // let the chunks around them load
  await system.waitTicks(40);
  if (!player.isValid) return;
  const inside = inMire(player);
  if (!atSpawn || !inside) {
    emit("mire_spawn", { player: player.name, atSpawn, inside, moved: false });
    return;
  }
  const from = player.location;
  const g = await outside(player.dimension, from);
  if (!g || !player.isValid) {
    trace(`${player.name}: started in the Mire, no way out found nearby`);
    emit("mire_spawn", { player: player.name, atSpawn, inside, moved: false });
    return;
  }
  safe(() => player.teleport(g, { facingLocation: { x: from.x, y: from.y + 1.6, z: from.z } }));
  safe(() => world.setDefaultSpawnLocation({ x: Math.floor(g.x), y: Math.floor(g.y), z: Math.floor(g.z) }));
  const d = Math.hypot(g.x - from.x, g.z - from.z);
  trace(`${player.name}: started in the Mire; moved ${d.toFixed(0)} blocks out of it, world spawn moved too`);
  emit("mire_spawn", { player: player.name, atSpawn, inside, moved: true, d, x: g.x, y: g.y, z: g.z });
}

/** @param {{watcher:(p:import("@minecraft/server").Player, o:{minDist:number, maxDist:number, behind:boolean, why:string})=>void}} h */
export function register(h) {
  hooks = h;
  system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
    blockComponentRegistry.registerCustomComponent("wmire:falling_leaves", fallingLeaves);
    blockComponentRegistry.registerCustomComponent("wmire:readable_page", readablePage);
  });
  system.runInterval(() => safe(() => tickWind()), 10);
  world.afterEvents.playerSpawn.subscribe((ev) => {
    if (ev.initialSpawn) firstSpawn(ev.player).catch(() => {});
  });
}
