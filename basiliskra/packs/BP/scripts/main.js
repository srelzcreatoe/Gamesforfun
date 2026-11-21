// Basiliskra behaviour script. Built from src/*.ts (see the repository). Stable @minecraft/server 2.11.0 only.


// src/main.ts
import { EntityDamageCause as EntityDamageCause3, system as system5, world as world9 } from "@minecraft/server";

// src/config.ts
var CONFIG = {
  /** BASILISKRA CONFIG — how fast the story moves.  2 = twice as fast, 0.5 = half. */
  pacing: 1,
  /**
   * What his beam and feet may do to the world.
   *  "none"   only particles and sound
   *  "scorch" (default) natural stone, dirt, sand and grass at the impact are scorched; nothing breaks
   *  "break"  natural terrain at the impact is also broken.  Storage, beds, portals, redstone
   *           and anything a player built from non-natural blocks are never touched in any mode.
   */
  terrain: "scorch",
  /** Furrows (Form II) and footprints (Form III) pressed into natural ground. */
  marks: true,
  /** Damage multiplier for everything he does to players. */
  damage: 1,
  /** On Peaceful he still appears and behaves, but deals no damage. */
  harmlessOnPeaceful: true,
  /** Operator test hooks via /scriptevent basiliskra:debug ... (needs cheats; off for survival). */
  debug: false
};
var NS = "basiliskra";
var TYPE = `${NS}:basiliskra`;
var HITBOX = `${NS}:hitbox`;
var FIN_ITEM = `${NS}:shed_fin`;
var PROP = {
  form: `${NS}:form`,
  bound: `${NS}:bound`,
  phase: `${NS}:phase`,
  charge: `${NS}:charge`,
  lookYaw: `${NS}:look_yaw`,
  lookPitch: `${NS}:look_pitch`,
  bend: `${NS}:bend`,
  pitch: `${NS}:pitch`,
  gait: `${NS}:gait`,
  gill: `${NS}:gill`,
  fxKind: `${NS}:fx_kind`,
  fxSeq: `${NS}:fx_seq`,
  tier: `${NS}:tier`,
  visLo: `${NS}:vis_lo`,
  visHi: `${NS}:vis_hi`
};
var PHASE = {
  idle: 0,
  move: 1,
  arrive: 2,
  ram: 3,
  knock: 4,
  rise: 5,
  bite: 6,
  sweep: 7,
  jam: 8,
  spasm: 9,
  sleep: 10,
  wake: 11,
  evolve: 12,
  beach: 13,
  drink: 14,
  arc: 15,
  pin: 16,
  look: 17,
  charge: 18,
  fire: 19,
  vent: 20,
  grounded: 21,
  scatter: 22,
  roar: 23,
  crossing: 24,
  depart: 25,
  flinch: 26,
  window: 27,
  stalk: 28
};
var TICKS = { second: 20, minute: 1200, day: 24e3 };
var KNOCK_GAP_TICKS = 18;
var OVERWORLD = "minecraft:overworld";

// src/controller.ts
import { ItemStack, system as system4, world as world8 } from "@minecraft/server";

// src/creature.ts
import { EntityDamageCause, GameMode, world as world4 } from "@minecraft/server";

// src/fx.ts
import { MolangVariableMap, world as world2 } from "@minecraft/server";

// src/vec.ts
var add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
var sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
var mul = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
var dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
var len = (a) => Math.sqrt(dot(a, a));
var dist = (a, b) => len(sub(a, b));
var distXZ = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
var norm = (a) => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : { x: 0, y: 0, z: 0 };
};
var clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
var D2R = Math.PI / 180;
var forwardOf = (yaw) => ({ x: -Math.sin(yaw * D2R), y: 0, z: Math.cos(yaw * D2R) });
var leftOf = (yaw) => ({ x: Math.cos(yaw * D2R), y: 0, z: Math.sin(yaw * D2R) });
var yawTo = (from, to) => Math.atan2(-(to.x - from.x), to.z - from.z) / D2R;
var wrapDeg = (a) => {
  a = ((a + 180) % 360 + 360) % 360 - 180;
  return a;
};
var turnTowards = (from, to, maxStep) => {
  const d = wrapDeg(to - from);
  return wrapDeg(from + clamp(d, -maxStep, maxStep));
};
function hash(...n) {
  let h = 2166136261;
  for (const v of n) {
    h ^= (v | 0) + 2654435769 + (h << 6) + (h >>> 2);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 739982445);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

// src/world.ts
import { world } from "@minecraft/server";
var overworld = () => world.getDimension(OVERWORLD);
function isLoaded(dim, p) {
  try {
    return dim.isChunkLoaded(p);
  } catch {
    return false;
  }
}
function blockAt(dim, p) {
  if (!isLoaded(dim, p)) return void 0;
  try {
    return dim.getBlock({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }) ?? void 0;
  } catch {
    return void 0;
  }
}
var idAt = (dim, p) => blockAt(dim, p)?.typeId;
var isWaterId = (id) => id === "minecraft:water" || id === "minecraft:flowing_water";
var SOFT = /(^minecraft:(air|light_block.*|structure_void|short_grass|tall_grass|fern|large_fern|deadbush|seagrass|kelp|vine|.*_vines.*|snow_layer|.*carpet|.*torch|redstone_wire|.*_button|lever|.*rail|.*sapling|.*_flower|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|wheat|carrots|potatoes|beetroot|reeds|sugar_cane|bamboo_sapling|waterlily|.*sign|.*banner|.*pressure_plate|trip_?wire.*|ladder|scaffolding|fire|soul_fire|cobweb|web|.*mushroom|nether_wart|sweet_berry_bush|.*coral_fan.*|sea_pickle|frog_spawn|leaf_litter|bush|firefly_bush|cactus_flower|wildflowers|pink_petals)$)/;
function isSolidBlock(b) {
  if (!b) return false;
  if (b.isAir || b.isLiquid) return false;
  return !SOFT.test(b.typeId);
}
var PLANT = /^minecraft:(?!stripped_)(.*_log|.*_wood|.*_stem|.*_hyphae|.*leaves.*|azalea|flowering_azalea|bamboo|cactus|melon_block|pumpkin|.*mushroom_block|mushroom_stem|mangrove_roots|bee_nest|chorus_plant|chorus_flower|pointed_dripstone|big_dripleaf|hanging_roots)$/;
var NATURAL = /^minecraft:(stone|granite|diorite|andesite|deepslate|tuff|calcite|dirt|coarse_dirt|grass_block|podzol|mycelium|dirt_with_roots|mud|clay|sand|red_sand|gravel|suspicious_sand|suspicious_gravel|sandstone|red_sandstone|snow|ice|packed_ice|blue_ice|powder_snow|moss_block|pale_moss_block|hardened_clay|.*_terracotta|netherrack|basalt|smooth_basalt|blackstone|end_stone|dripstone_block|.*_ore|bedrock|obsidian|magma|soul_sand|soul_soil|muddy_mangrove_roots|amethyst_block|budding_amethyst|.*coral_block|cobbled_deepslate|packed_mud)$/;
var isPlantBlock = (id) => PLANT.test(id);
var isNaturalGround = (id) => NATURAL.test(id) && !id.includes("glazed");
function trunkBlocked(dim, at, feetY, radius, built, cliff, full) {
  const ring = full ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]] : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of ring) {
    const x = at.x + dx * radius, z = at.z + dz * radius;
    const top = blockAt(dim, { x, y: feetY + cliff, z });
    if (top && isSolidBlock(top) && !isPlantBlock(top.typeId)) return true;
    for (const h of built) {
      const b = blockAt(dim, { x, y: feetY + h, z });
      if (b && isSolidBlock(b) && !isPlantBlock(b.typeId) && !isNaturalGround(b.typeId)) return true;
    }
  }
  return false;
}
function waterOver(dim, x, z, floorY, depth) {
  return isWaterId(idAt(dim, { x, y: floorY + depth, z }));
}
function deepHere(dim, x, z, surface, need) {
  if (!isLoaded(dim, { x, y: surface, z })) return UNLOADED;
  for (let d = 1; d <= need; d++) if (!isWaterId(idAt(dim, { x, y: surface - d, z }))) return false;
  return true;
}
var UNLOADED = Symbol("unloaded");
var NONE = Symbol("none");
function groundY(dim, x, z, yTop, depth) {
  const range = dim.heightRange;
  let y = Math.min(Math.floor(yTop), range.max - 1);
  const stop = Math.max(Math.floor(yTop - depth), range.min);
  if (!isLoaded(dim, { x, y, z })) return UNLOADED;
  for (; y >= stop; y--) {
    const b = blockAt(dim, { x, y, z });
    if (!b) return UNLOADED;
    if (isSolidBlock(b) && !PLANT.test(b.typeId)) return y + 1;
  }
  return NONE;
}
function footprintY(dim, at, radius, yTop, depth, floatY = null) {
  const ys = [];
  let unloaded = 0;
  for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) {
    const x = at.x + dx, z = at.z + dz;
    let g = groundY(dim, x, z, yTop, depth);
    if (floatY !== null && g !== UNLOADED && (g === NONE || g < floatY) && isWaterId(idAt(dim, { x, y: floatY, z }))) g = floatY;
    if (g === UNLOADED) unloaded++;
    else if (g !== NONE) ys.push(g);
  }
  if (unloaded > 4) return UNLOADED;
  if (ys.length < 3) return NONE;
  ys.sort((a, b) => a - b);
  return ys[Math.floor((ys.length - 1) / 2)];
}
function waterColumn(dim, x, z, y, reach = 24, deep = 64) {
  if (!isLoaded(dim, { x, y, z })) return UNLOADED;
  let top = Math.floor(y);
  let b = blockAt(dim, { x, y: top, z });
  if (!b) return UNLOADED;
  if (!isWaterId(b.typeId)) {
    let found = false;
    for (let d = 1; d <= reach && !found; d++) {
      for (const yy of [top - d, top + d]) {
        if (isWaterId(idAt(dim, { x, y: yy, z }))) {
          top = yy;
          found = true;
          break;
        }
      }
    }
    if (!found) return NONE;
  }
  while (isWaterId(idAt(dim, { x, y: top + 1, z })) && top < dim.heightRange.max - 2) top++;
  let bottom = top;
  while (bottom > dim.heightRange.min + 1 && bottom > top - deep && isWaterId(idAt(dim, { x, y: bottom - 1, z }))) bottom--;
  return { surface: top + 1, floor: bottom };
}
function clearLine(dim, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 0.01) return true;
  const end = { x: a.x + dx, y: a.y + dy, z: a.z + dz };
  if (!isLoaded(dim, a) || !isLoaded(dim, end)) return false;
  try {
    const hit = dim.getBlockFromRay(a, { x: dx / d, y: dy / d, z: dz / d }, { maxDistance: d, includeLiquidBlocks: false, includePassableBlocks: false });
    return !hit;
  } catch {
    return false;
  }
}
var SCORCH = {
  "minecraft:stone": "minecraft:smooth_basalt",
  "minecraft:andesite": "minecraft:smooth_basalt",
  "minecraft:diorite": "minecraft:smooth_basalt",
  "minecraft:granite": "minecraft:smooth_basalt",
  "minecraft:tuff": "minecraft:smooth_basalt",
  "minecraft:deepslate": "minecraft:smooth_basalt",
  "minecraft:calcite": "minecraft:smooth_basalt",
  "minecraft:dirt": "minecraft:coarse_dirt",
  "minecraft:grass_block": "minecraft:coarse_dirt"
};
var BREAKABLE = /* @__PURE__ */ new Set([...Object.keys(SCORCH), "minecraft:smooth_basalt", "minecraft:coarse_dirt", "minecraft:sand", "minecraft:red_sand", "minecraft:gravel"]);
var scorchOf = (id) => SCORCH[id];
var isBreakableNatural = (id) => BREAKABLE.has(id);
var MARK = { "minecraft:grass_block": "minecraft:dirt", "minecraft:dirt": "minecraft:coarse_dirt" };
var PRINT = { "minecraft:grass_block": "minecraft:mud", "minecraft:dirt": "minecraft:mud", "minecraft:coarse_dirt": "minecraft:mud" };
var furrowOf = (id) => MARK[id];
var printOf = (id) => PRINT[id];
var WILD = /^minecraft:(air|short_grass|tall_grass|fern|large_fern|deadbush|snow_layer|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|leaf_litter|bush|firefly_bush|wildflowers|pink_petals)$/;
function takesMark(dim, at) {
  const b = blockAt(dim, at);
  if (!b) return void 0;
  const above = blockAt(dim, { x: at.x, y: at.y + 1, z: at.z });
  if (!above || !WILD.test(above.typeId)) return void 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, 1]) {
      const n = blockAt(dim, { x: at.x + dx, y: at.y + dy, z: at.z + dz });
      if (n && isSolidBlock(n) && !isNaturalGround(n.typeId) && !isPlantBlock(n.typeId)) return void 0;
    }
  }
  return b;
}

// src/fx.ts
var PARTICLE_BUDGET = 96;
var spent = 0;
var playerCache = [];
var cacheTick = -1;
function beginTick(tick) {
  spent = 0;
  if (tick !== cacheTick) {
    playerCache = world2.getAllPlayers();
    cacheTick = tick;
  }
}
function players() {
  return playerCache;
}
function witnesses(dim, at, range) {
  const out = [];
  for (const p of playerCache) {
    try {
      if (p.isValid && p.dimension.id === dim.id && dist(p.location, at) <= range) out.push(p);
    } catch {
    }
  }
  return out;
}
function sound(dim, id, at, range = 48, volume = 1, pitch = 1) {
  for (const p of witnesses(dim, at, range)) {
    try {
      p.playSound(id, { location: at, volume, pitch });
    } catch {
    }
  }
}
function particle(dim, id, at, range = 48, vars) {
  if (!isLoaded(dim, at)) return;
  for (const p of witnesses(dim, at, range)) {
    if (spent >= PARTICLE_BUDGET) return;
    spent++;
    try {
      p.spawnParticle(id, at, vars);
    } catch {
    }
  }
}
function beamVars(dir, length, width, r = 1, g = 0.1, b = 0.1) {
  const m = new MolangVariableMap();
  m.setFloat("variable.len", length);
  m.setFloat("variable.width", width);
  m.setVector3("variable.dir", dir);
  m.setColorRGB("variable.tint", { red: r, green: g, blue: b });
  return m;
}

// src/generated/rig.ts
var RIGS = { "1": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 36, 0], "rot": [0, 0, 0], "zone": 6 }, "chest": { "parent": "body", "pivot": [0, 36, 0], "rot": [0, 0, 0], "zone": 6 }, "gill_l1": { "parent": "chest", "pivot": [48, 36, -17], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "chest", "pivot": [48, 36, -7], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "chest", "pivot": [48, 36, 3], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "chest", "pivot": [-48, 36, -17], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "chest", "pivot": [-48, 36, -7], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "chest", "pivot": [-48, 36, 3], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "chest", "pivot": [0, 36, -24], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 32, -34], "rot": [4, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [27.4, 45.6, -78], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-27.4, 45.6, -78], "rot": [0, 0, 0], "zone": 8 }, "fin_l": { "parent": "chest", "pivot": [40, 13, 16], "rot": [0, -34, 30], "zone": 6 }, "fin_l_tip": { "parent": "fin_l", "pivot": [74, 13, 16], "rot": [0, 0, 0], "zone": 6 }, "fin_r": { "parent": "chest", "pivot": [-40, 13, 16], "rot": [0, 34, -30], "zone": 6 }, "fin_r_tip": { "parent": "fin_r", "pivot": [-74, 13, 16], "rot": [0, 0, 0], "zone": 6 }, "ribbon0": { "parent": "chest", "pivot": [0, 72, 6], "rot": [0, 0, 0], "zone": 6 }, "seg1": { "parent": "chest", "pivot": [0, 36, 24], "rot": [0, 0, 0], "zone": 5 }, "ribbon1": { "parent": "seg1", "pivot": [0, 72, 40], "rot": [0, 0, 0], "zone": 5 }, "seg2": { "parent": "seg1", "pivot": [0, 36, 56], "rot": [0, 0, 0], "zone": 5 }, "ribbon2": { "parent": "seg2", "pivot": [0, 71.5, 72], "rot": [0, 0, 0], "zone": 5 }, "seg3": { "parent": "seg2", "pivot": [0, 36, 88], "rot": [0, 0, 0], "zone": 5 }, "ribbon3": { "parent": "seg3", "pivot": [0, 70.5, 104], "rot": [0, 0, 0], "zone": 5 }, "seg4": { "parent": "seg3", "pivot": [0, 36, 120], "rot": [0, 0, 0], "zone": 4 }, "ribbon4": { "parent": "seg4", "pivot": [0, 69, 136], "rot": [0, 0, 0], "zone": 4 }, "seg5": { "parent": "seg4", "pivot": [0, 36, 152], "rot": [0, 0, 0], "zone": 4 }, "ribbon5": { "parent": "seg5", "pivot": [0, 67, 168], "rot": [0, 0, 0], "zone": 4 }, "seg6": { "parent": "seg5", "pivot": [0, 36, 184], "rot": [0, 0, 0], "zone": 3 }, "ribbon6": { "parent": "seg6", "pivot": [0, 64.5, 200], "rot": [0, 0, 0], "zone": 3 }, "vribbon6": { "parent": "seg6", "pivot": [0, 7.5, 200], "rot": [0, 0, 0], "zone": 3 }, "seg7": { "parent": "seg6", "pivot": [0, 36, 216], "rot": [0, 0, 0], "zone": 3 }, "ribbon7": { "parent": "seg7", "pivot": [0, 61, 232], "rot": [0, 0, 0], "zone": 3 }, "vribbon7": { "parent": "seg7", "pivot": [0, 11, 232], "rot": [0, 0, 0], "zone": 3 }, "seg8": { "parent": "seg7", "pivot": [0, 36, 248], "rot": [0, 0, 0], "zone": 2 }, "ribbon8": { "parent": "seg8", "pivot": [0, 57, 264], "rot": [0, 0, 0], "zone": 2 }, "vribbon8": { "parent": "seg8", "pivot": [0, 15, 264], "rot": [0, 0, 0], "zone": 2 }, "seg9": { "parent": "seg8", "pivot": [0, 36, 280], "rot": [0, 0, 0], "zone": 1 }, "ribbon9": { "parent": "seg9", "pivot": [0, 53, 296], "rot": [0, 0, 0], "zone": 1 }, "vribbon9": { "parent": "seg9", "pivot": [0, 19, 296], "rot": [0, 0, 0], "zone": 1 }, "seg10": { "parent": "seg9", "pivot": [0, 36, 312], "rot": [0, 0, 0], "zone": 1 }, "ribbon10": { "parent": "seg10", "pivot": [0, 49.5, 328], "rot": [0, 0, 0], "zone": 1 }, "vribbon10": { "parent": "seg10", "pivot": [0, 22.5, 328], "rot": [0, 0, 0], "zone": 1 }, "tailfin": { "parent": "seg10", "pivot": [0, 36, 344], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "back": { "bone": "chest", "pos": [0, 72, 0] }, "belly": { "bone": "chest", "pos": [0, 0, 0] }, "spine_0": { "bone": "chest", "pos": [0, 72, 0] }, "gill_l": { "bone": "chest", "pos": [49, 36, -7] }, "gill_r": { "bone": "chest", "pos": [-49, 36, -7] }, "muzzle": { "bone": "head", "pos": [0, 34, -114] }, "nose": { "bone": "head", "pos": [0, 40, -112] }, "throat": { "bone": "head", "pos": [0, 28, -32] }, "mouth": { "bone": "jaw", "pos": [0, 31, -94] }, "eye_l": { "bone": "eye_l", "pos": [27.9, 45.6, -78] }, "eye_r": { "bone": "eye_r", "pos": [-27.9, 45.6, -78] }, "fin_l": { "bone": "fin_l_tip", "pos": [120, 13, 22] }, "fin_r": { "bone": "fin_r_tip", "pos": [-120, 13, 22] }, "spine_1": { "bone": "seg1", "pos": [0, 72, 40] }, "spine_2": { "bone": "seg2", "pos": [0, 71.5, 72] }, "spine_3": { "bone": "seg3", "pos": [0, 70.5, 104] }, "spine_4": { "bone": "seg4", "pos": [0, 69, 136] }, "spine_5": { "bone": "seg5", "pos": [0, 67, 168] }, "spine_6": { "bone": "seg6", "pos": [0, 64.5, 200] }, "spine_7": { "bone": "seg7", "pos": [0, 61, 232] }, "spine_8": { "bone": "seg8", "pos": [0, 57, 264] }, "spine_9": { "bone": "seg9", "pos": [0, 53, 296] }, "spine_10": { "bone": "seg10", "pos": [0, 49.5, 328] }, "knob_u": { "bone": "tailfin", "pos": [0, 100, 409] }, "knob_d": { "bone": "tailfin", "pos": [0, -28, 409] }, "tail_notch": { "bone": "tailfin", "pos": [2.5, 76, 405] }, "tail_tip": { "bone": "tailfin", "pos": [0, 36, 410] } }, "meta": { "glow_y0": 10, "glow_y1": 74, "wetness": 0.8, "bounds_margin": 6, "form": 1 }, "zones": { "6": ["body", "chest", "fin_l", "fin_l_tip", "fin_r", "fin_r_tip", "ribbon0"], "7": ["gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "jaw", "eye_l", "eye_r"], "5": ["seg1", "ribbon1", "seg2", "ribbon2", "seg3", "ribbon3"], "4": ["seg4", "ribbon4", "seg5", "ribbon5"], "3": ["seg6", "ribbon6", "vribbon6", "seg7", "ribbon7", "vribbon7"], "2": ["seg8", "ribbon8", "vribbon8"], "1": ["seg9", "ribbon9", "vribbon9", "seg10", "ribbon10", "vribbon10"], "0": ["tailfin"] } }, "2": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 44, 0], "rot": [0, 0, 0], "zone": 5 }, "chest": { "parent": "body", "pivot": [0, 78, 0], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 122, 0], "rot": [0, 0, 0], "zone": 5 }, "neck": { "parent": "chest", "pivot": [0, 84, -32], "rot": [3, 0, 0], "zone": 6 }, "plates_neck": { "parent": "neck", "pivot": [0, 116, -46], "rot": [0, 0, 0], "zone": 6 }, "gill_l1": { "parent": "neck", "pivot": [37, 84, -56], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck", "pivot": [37, 84, -47], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck", "pivot": [37, 84, -38], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck", "pivot": [-37, 84, -56], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck", "pivot": [-37, 84, -47], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck", "pivot": [-37, 84, -38], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck", "pivot": [0, 84, -62], "rot": [4, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [28.08, 91.46, -97.7], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-28.08, 91.46, -97.7], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 71, -75], "rot": [9, 0, 0], "zone": 8 }, "arm_l": { "parent": "chest", "pivot": [54, 102, -14], "rot": [14, 0, 10], "zone": 5 }, "forearm_l": { "parent": "arm_l", "pivot": [54, 54, -14], "rot": [-38, 0, -10], "zone": 5 }, "claw_l": { "parent": "forearm_l", "pivot": [54, 4, -14], "rot": [24, 0, 0], "zone": 5 }, "arm_r": { "parent": "chest", "pivot": [-54, 102, -14], "rot": [14, 0, -10], "zone": 5 }, "forearm_r": { "parent": "arm_r", "pivot": [-54, 54, -14], "rot": [-38, 0, 10], "zone": 5 }, "claw_r": { "parent": "forearm_r", "pivot": [-54, 4, -14], "rot": [24, 0, 0], "zone": 5 }, "mid": { "parent": "body", "pivot": [0, 66, 30], "rot": [0, 0, 0], "zone": 4 }, "plates_mid": { "parent": "mid", "pivot": [0, 100, 66], "rot": [0, 0, 0], "zone": 4 }, "hips": { "parent": "mid", "pivot": [0, 36, 104], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 72, 126], "rot": [0, 0, 0], "zone": 3 }, "leg_l": { "parent": "hips", "pivot": [40, 24, 126], "rot": [0, -40, 24], "zone": 3 }, "foot_l": { "parent": "leg_l", "pivot": [70, 20, 126], "rot": [0, 0, -24], "zone": 3 }, "leg_r": { "parent": "hips", "pivot": [-40, 24, 126], "rot": [0, 40, -24], "zone": 3 }, "foot_r": { "parent": "leg_r", "pivot": [-70, 20, 126], "rot": [0, 0, 24], "zone": 3 }, "tail1": { "parent": "hips", "pivot": [0, 32, 150], "rot": [0, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 62, 164], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 30, 178], "rot": [0, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 58, 192], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 28, 206], "rot": [0, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 54, 220], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 26, 234], "rot": [0, 0, 0], "zone": 1 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 50, 248], "rot": [0, 0, 0], "zone": 1 }, "tail5": { "parent": "tail4", "pivot": [0, 24, 262], "rot": [0, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 46, 276], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 23, 290], "rot": [0, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 44, 304], "rot": [0, 0, 0], "zone": 1 }, "knob": { "parent": "tail6", "pivot": [0, 23, 318], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "heart": { "bone": "chest", "pos": [0, 78, 0] }, "gill_l": { "bone": "neck", "pos": [38, 84, -47] }, "gill_r": { "bone": "neck", "pos": [-38, 84, -47] }, "muzzle": { "bone": "head", "pos": [0, 77.5, -176.4] }, "nose": { "bone": "head", "pos": [0, 90.5, -173.8] }, "throat": { "bone": "head", "pos": [0, 77.5, -69.8] }, "eye_l": { "bone": "eye_l", "pos": [28.58, 91.46, -97.7] }, "eye_r": { "bone": "eye_r", "pos": [-28.58, 91.46, -97.7] }, "mouth": { "bone": "jaw", "pos": [0, 76.2, -153] }, "claw_l": { "bone": "claw_l", "pos": [54, -6, -44] }, "claw_r": { "bone": "claw_r", "pos": [-54, -6, -44] }, "hip_l": { "bone": "hips", "pos": [30, 0, 140] }, "hip_r": { "bone": "hips", "pos": [-30, 0, 140] }, "foot_l": { "bone": "foot_l", "pos": [86, 11, 126] }, "foot_r": { "bone": "foot_r", "pos": [-86, 11, 126] }, "tail_notch": { "bone": "tail6", "pos": [29.5, 23, 305] }, "knob_core": { "bone": "knob", "pos": [0, 32, 358] }, "horn_l": { "bone": "knob", "pos": [19.3621, 76.8737, 367.5747] }, "horn_r": { "bone": "knob", "pos": [-19.3621, 76.8737, 367.5747] } }, "meta": { "glow_y0": 10, "glow_y1": 104, "wetness": 0.5, "bounds_margin": 6, "form": 2 }, "zones": { "5": ["body", "chest", "plates_chest", "arm_l", "forearm_l", "claw_l", "arm_r", "forearm_r", "claw_r"], "6": ["neck", "plates_neck"], "7": ["gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "jaw"], "4": ["mid", "plates_mid"], "3": ["hips", "plates_hips", "leg_l", "foot_l", "leg_r", "foot_r"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3"], "1": ["tail4", "plates_tail4", "tail5", "plates_tail5", "tail6", "plates_tail6"], "0": ["knob"] } }, "3": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 112, 0], "rot": [0, 0, 0], "zone": 4 }, "plates_mid": { "parent": "body", "pivot": [0, 151, -12], "rot": [0, 0, 0], "zone": 4 }, "chest": { "parent": "body", "pivot": [0, 108, -60], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 148, -92], "rot": [0, 0, 0], "zone": 5 }, "hips": { "parent": "body", "pivot": [0, 110, 36], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 151, 70], "rot": [0, 0, 0], "zone": 3 }, "neck1": { "parent": "chest", "pivot": [0, 114, -126], "rot": [4, 0, 0], "zone": 6 }, "plates_neck1": { "parent": "neck1", "pivot": [0, 150, -134.5], "rot": [0, 0, 0], "zone": 6 }, "neck2": { "parent": "neck1", "pivot": [0, 114, -143], "rot": [3, 0, 0], "zone": 6 }, "plates_neck2": { "parent": "neck2", "pivot": [0, 146.5, -151.5], "rot": [0, 0, 0], "zone": 6 }, "neck3": { "parent": "neck2", "pivot": [0, 114, -160], "rot": [2, 0, 0], "zone": 7 }, "plates_neck3": { "parent": "neck3", "pivot": [0, 143, -168.5], "rot": [0, 0, 0], "zone": 7 }, "neck4": { "parent": "neck3", "pivot": [0, 114, -177], "rot": [0, 0, 0], "zone": 7 }, "plates_neck4": { "parent": "neck4", "pivot": [0, 140, -185.5], "rot": [0, 0, 0], "zone": 7 }, "neck5": { "parent": "neck4", "pivot": [0, 114, -194], "rot": [-2, 0, 0], "zone": 7 }, "plates_neck5": { "parent": "neck5", "pivot": [0, 137.5, -202.5], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck5", "pivot": [0, 114, -211], "rot": [-3, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [26.368, 120.608, -247.4], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-26.368, 120.608, -247.4], "rot": [0, 0, 0], "zone": 8 }, "plates_head": { "parent": "head", "pivot": [0, 133.2, -223.8], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 101.2, -223.8], "rot": [7, 0, 0], "zone": 8 }, "gill_l1": { "parent": "neck5", "pivot": [19.92, 113, -208.5], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck5", "pivot": [19.92, 113, -203.1], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck5", "pivot": [19.92, 113, -197.7], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck5", "pivot": [-19.92, 113, -208.5], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck5", "pivot": [-19.92, 113, -203.1], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck5", "pivot": [-19.92, 113, -197.7], "rot": [0, 0, 0], "zone": 7 }, "leg_fl": { "parent": "chest", "pivot": [40, 104, -100], "rot": [20, 0, 0], "zone": 5 }, "leg_fl_lower": { "parent": "leg_fl", "pivot": [40, 54, -100], "rot": [-35, 0, 0], "zone": 5 }, "foot_fl": { "parent": "leg_fl_lower", "pivot": [40, 7, -100], "rot": [15, 0, 0], "zone": 5 }, "leg_fr": { "parent": "chest", "pivot": [-40, 104, -100], "rot": [20, 0, 0], "zone": 5 }, "leg_fr_lower": { "parent": "leg_fr", "pivot": [-40, 54, -100], "rot": [-35, 0, 0], "zone": 5 }, "foot_fr": { "parent": "leg_fr_lower", "pivot": [-40, 7, -100], "rot": [15, 0, 0], "zone": 5 }, "leg_bl": { "parent": "hips", "pivot": [40, 104, 84], "rot": [-22, 0, 0], "zone": 3 }, "leg_bl_lower": { "parent": "leg_bl", "pivot": [40, 52, 84], "rot": [40, 0, 0], "zone": 3 }, "foot_bl": { "parent": "leg_bl_lower", "pivot": [40, 6, 84], "rot": [-18, 0, 0], "zone": 3 }, "leg_br": { "parent": "hips", "pivot": [-40, 104, 84], "rot": [-22, 0, 0], "zone": 3 }, "leg_br_lower": { "parent": "leg_br", "pivot": [-40, 52, 84], "rot": [40, 0, 0], "zone": 3 }, "foot_br": { "parent": "leg_br_lower", "pivot": [-40, 6, 84], "rot": [-18, 0, 0], "zone": 3 }, "tail1": { "parent": "hips", "pivot": [0, 112, 112], "rot": [-8, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 144, 127.5], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 112, 143], "rot": [-6, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 140, 158.5], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 112, 174], "rot": [-4, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 136, 189], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 112, 204], "rot": [-2, 0, 0], "zone": 1 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 132, 219], "rot": [0, 0, 0], "zone": 1 }, "tail5": { "parent": "tail4", "pivot": [0, 112, 234], "rot": [2, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 129, 249], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 112, 264], "rot": [5, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 126.5, 278.5], "rot": [0, 0, 0], "zone": 1 }, "tail7": { "parent": "tail6", "pivot": [0, 112, 293], "rot": [7, 0, 0], "zone": 1 }, "plates_tail7": { "parent": "tail7", "pivot": [0, 124.5, 307.5], "rot": [0, 0, 0], "zone": 1 }, "tail8": { "parent": "tail7", "pivot": [0, 112, 322], "rot": [6, 0, 0], "zone": 1 }, "plates_tail8": { "parent": "tail8", "pivot": [0, 123, 336], "rot": [0, 0, 0], "zone": 1 }, "club": { "parent": "tail8", "pivot": [0, 112, 350], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "heart": { "bone": "body", "pos": [0, 112, -20] }, "plate_tip_3": { "bone": "plates_mid", "pos": [0, 218.3, -21.8] }, "plate_tip_4": { "bone": "plates_mid", "pos": [0, 228.8, 7.2] }, "plate_tip_5": { "bone": "plates_mid", "pos": [0, 235.5, 35] }, "plate_tip_6": { "bone": "plates_mid", "pos": [0, 235.5, 61] }, "plate_tip_0": { "bone": "plates_chest", "pos": [0, 177.2, -105.2] }, "plate_tip_1": { "bone": "plates_chest", "pos": [0, 193.5, -79] }, "plate_tip_2": { "bone": "plates_chest", "pos": [0, 205.9, -51.4] }, "plate_tip_7": { "bone": "plates_hips", "pos": [0, 229.8, 85.2] }, "plate_tip_8": { "bone": "plates_hips", "pos": [0, 218.3, 106.2] }, "plate_tip_9": { "bone": "plates_hips", "pos": [0, 204.9, 124.6] }, "gill_l": { "bone": "neck5", "pos": [21, 113, -201.5] }, "gill_r": { "bone": "neck5", "pos": [-21, 113, -201.5] }, "muzzle": { "bone": "head", "pos": [0, 107.6, -303.16] }, "throat": { "bone": "head", "pos": [0, 107.6, -218.68] }, "nose": { "bone": "head", "pos": [0, 121.68, -300.6] }, "eye_l": { "bone": "eye_l", "pos": [26.868, 120.608, -247.4] }, "eye_r": { "bone": "eye_r", "pos": [-26.868, 120.608, -247.4] }, "mouth": { "bone": "jaw", "pos": [0, 106.32, -282.68] }, "foot_fl": { "bone": "foot_fl", "pos": [40, -5, -108] }, "foot_fr": { "bone": "foot_fr", "pos": [-40, -5, -108] }, "foot_bl": { "bone": "foot_bl", "pos": [40, -6, 76] }, "foot_br": { "bone": "foot_br", "pos": [-40, -6, 76] }, "tail_notch": { "bone": "tail7", "pos": [11.5, 112, 306] }, "club_core": { "bone": "club", "pos": [0, 112, 374] }, "spike_tip_0": { "bone": "club", "pos": [41.2571, 135.8198, 369.7336] }, "spike_tip_1": { "bone": "club", "pos": [0, 165.2182, 369.1757] }, "spike_tip_2": { "bone": "club", "pos": [-40.6907, 135.4928, 369.799] }, "spike_tip_3": { "bone": "club", "pos": [-43.335, 86.9805, 369.4936] }, "spike_tip_4": { "bone": "club", "pos": [0, 58.6562, 369.1631] }, "spike_tip_5": { "bone": "club", "pos": [46.0464, 85.4151, 369.1805] }, "spike_tip_6": { "bone": "club", "pos": [22.5857, 143.0865, 405.9264] }, "spike_tip_7": { "bone": "club", "pos": [-22.3364, 142.7435, 405.5367] }, "spike_tip_8": { "bone": "club", "pos": [-32.3061, 101.5031, 401.8313] }, "spike_tip_9": { "bone": "club", "pos": [0, 73.6781, 405.8316] }, "spike_tip_10": { "bone": "club", "pos": [32.359, 101.4859, 401.8824] }, "spike_tip_11": { "bone": "club", "pos": [0, 114.8643, 426.2925] } }, "meta": { "glow_y0": 64, "glow_y1": 156, "wetness": 0.15, "bounds_margin": 6, "form": 3 }, "zones": { "4": ["body", "plates_mid"], "5": ["chest", "plates_chest", "leg_fl", "leg_fl_lower", "foot_fl", "leg_fr", "leg_fr_lower", "foot_fr"], "3": ["hips", "plates_hips", "leg_bl", "leg_bl_lower", "foot_bl", "leg_br", "leg_br_lower", "foot_br"], "6": ["neck1", "plates_neck1", "neck2", "plates_neck2"], "7": ["neck3", "plates_neck3", "neck4", "plates_neck4", "neck5", "plates_neck5", "gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "plates_head", "jaw"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3"], "1": ["tail4", "plates_tail4", "tail5", "plates_tail5", "tail6", "plates_tail6", "tail7", "plates_tail7", "tail8", "plates_tail8"], "0": ["club"] } } };
var LOOK = { "1": { "yaw": { "head": 0.6, "chest": 0.4 }, "pitch": { "head": 0.6, "chest": 0.4 } }, "2": { "yaw": { "head": 0.45, "neck": 0.4, "chest": 0.15 }, "pitch": { "head": 0.5, "neck": 0.4, "chest": 0.1 } }, "3": { "yaw": { "head": 0.35, "neck1": 0.11, "neck2": 0.11, "neck3": 0.11, "neck4": 0.11, "neck5": 0.11, "chest": 0.1 }, "pitch": { "head": 0.4, "neck1": 0.12, "neck2": 0.12, "neck3": 0.12, "neck4": 0.12, "neck5": 0.12 } } };
var STRIDE_III = 7;
var STANCE_III = 5.25;
var BODY_DROP_III = 9;
var TAIL_LIFT_III = 4;
var WINDOW_NECK = [32, 28, 20, 0, -24];
var WINDOW_HEAD = [-62.7, 21.8, -51.8];
var GAIT_TICKS = [12, 18, 22];

// src/rig.ts
function rotation(rx, ry, rz) {
  const ax = -rx * D2R, ay = ry * D2R, az = -rz * D2R;
  const cx = Math.cos(ax), sx = Math.sin(ax), cy = Math.cos(ay), sy = Math.sin(ay), cz = Math.cos(az), sz = Math.sin(az);
  return [
    cz * cy,
    cz * sy * sx - sz * cx,
    cz * sy * cx + sz * sx,
    sz * cy,
    sz * sy * sx + cz * cx,
    sz * sy * cx - cz * sx,
    -sy,
    cy * sx,
    cy * cx
  ];
}
function about(R, p) {
  return [
    R[0],
    R[1],
    R[2],
    p[0] - (R[0] * p[0] + R[1] * p[1] + R[2] * p[2]),
    R[3],
    R[4],
    R[5],
    p[1] - (R[3] * p[0] + R[4] * p[1] + R[5] * p[2]),
    R[6],
    R[7],
    R[8],
    p[2] - (R[6] * p[0] + R[7] * p[1] + R[8] * p[2])
  ];
}
function mulM(a, b) {
  const o = new Array(12);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c];
    o[r * 4 + 3] = a[r * 4] * b[3] + a[r * 4 + 1] * b[7] + a[r * 4 + 2] * b[11] + a[r * 4 + 3];
  }
  return o;
}
function apply(m, p) {
  return [
    m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
    m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
    m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11]
  ];
}
function poseOf(form, s) {
  const p = {};
  const L = LOOK[form];
  const yawW = L.yaw, pitchW = L.pitch;
  const set = (b, x, y, z = 0) => {
    const c = p[b] ?? (p[b] = [0, 0, 0]);
    c[0] += x;
    c[1] += y;
    c[2] += z;
  };
  for (const [b, w] of Object.entries(yawW)) set(b, 0, s.lookYaw * w);
  for (const [b, w] of Object.entries(pitchW)) set(b, s.lookPitch * w, 0);
  set("body", s.pitch, 0);
  const charge = s.charge ?? 0, drink = s.drink ?? 0;
  if (form === 1) {
    set("head", 0, s.bend * 0.6);
    for (let i = 1; i <= 10; i++) set(`seg${i}`, 0, -s.bend);
    set("tailfin", 0, -s.bend);
  } else if (form === 2) {
    set("neck", 22 * drink, 0);
    set("head", 16 * drink, 0);
    set("chest", 6 * drink, 0);
    set("mid", 0, -s.bend * 0.5);
    set("hips", 0, -s.bend * 0.8);
    for (let i = 1; i <= 6; i++) set(`tail${i}`, 0, -s.bend * (0.5 + 0.1 * i));
  } else {
    set("hips", 0, -s.bend * 0.3);
    const win = s.window ?? 0;
    for (let i = 1; i <= 5; i++) set(`neck${i}`, -1.5 * charge + WINDOW_NECK[i - 1] * win, 0);
    set("head", -4 * charge + WINDOW_HEAD[0] * win, WINDOW_HEAD[1] * win, WINDOW_HEAD[2] * win);
    for (let i = 1; i <= 8; i++) set(`tail${i}`, -1.7 * charge + (i === 1 ? TAIL_LIFT_III : 0), -s.bend * (0.35 + 0.09 * i));
  }
  return p;
}
var Skeleton = class {
  constructor(form, pose) {
    this.form = form;
    this.pose = pose;
    this.cache = /* @__PURE__ */ new Map();
  }
  bone(name) {
    const hit = this.cache.get(name);
    if (hit) return hit;
    const b = RIGS[this.form].bones[name];
    if (!b) throw new Error(`rig ${this.form}: no bone ${name}`);
    const add2 = this.pose[name];
    const R = rotation(b.rot[0] + (add2 ? add2[0] : 0), b.rot[1] + (add2 ? add2[1] : 0), b.rot[2] + (add2 ? add2[2] : 0));
    const local = about(R, b.pivot);
    if (this.form === 3 && name === "body") local[7] -= BODY_DROP_III;
    const m = b.parent ? mulM(this.bone(b.parent), local) : local;
    this.cache.set(name, m);
    return m;
  }
  /** Model-space position of a locator. */
  locator(name) {
    const l = RIGS[this.form].locators[name];
    if (!l) throw new Error(`rig ${this.form}: no locator ${name}`);
    return apply(this.bone(l.bone), l.pos);
  }
  /** Model-space position of a point given in a bone's rest coordinates. */
  point(bone, p) {
    return apply(this.bone(bone), p);
  }
  pivot(bone) {
    return apply(this.bone(bone), RIGS[this.form].bones[bone].pivot);
  }
};
function toWorld(at, yaw, m) {
  const l = leftOf(yaw), f = forwardOf(yaw);
  const x = m[0] / 16, y = m[1] / 16, z = -m[2] / 16;
  return { x: at.x + l.x * x + f.x * z, y: at.y + y, z: at.z + l.z * x + f.z * z };
}

// src/store.ts
import { world as world3 } from "@minecraft/server";
var SCHEMA = 2;
var KEY = "bk:rec";
var HARM_KEY = "bk:harm";
var CHUNK = 3e4;
function freshRecord() {
  return {
    v: SCHEMA,
    clock: 0,
    stage: "dormant",
    token: "",
    entityId: null,
    form: 1,
    health: 600,
    born: 0,
    rift: null,
    origin: null,
    guilty: null,
    guiltyName: null,
    beach: null,
    last: null,
    down: null,
    pending: null,
    arrival: null,
    evolve: null,
    ending: null,
    mut: { surfacings: 0, episodes: 0, overland: 0, formSince: 0, lastEncounter: 0, beams: 0 },
    learned: { bell: null, bellUses: 0, lures: 0, lureUntil: 0, echoes: {}, rods: 0, fragments: 0, fragmentAt: 0 },
    sites: [],
    weather: "clear"
  };
}
function migrate(raw) {
  const base = freshRecord();
  if (!raw || typeof raw !== "object") return base;
  const rec = { ...base, ...raw };
  rec.mut = { ...base.mut, ...raw.mut ?? {} };
  rec.learned = { ...base.learned, ...raw.learned ?? {} };
  if (!Array.isArray(rec.sites)) rec.sites = [];
  if (rec.form !== 1 && rec.form !== 2 && rec.form !== 3) rec.form = 1;
  const stages = ["dormant", "pending", "arriving", "alive", "departed"];
  if (!stages.includes(rec.stage)) rec.stage = rec.entityId ? "alive" : "dormant";
  if (raw.v === 1 && raw.quiet === true) rec.stage = "departed";
  if (typeof raw.clock !== "number") {
    rec.clock = Math.max(0, rec.born || 0, rec.mut.formSince || 0, rec.down ?? 0, rec.arrival?.t0 ?? 0, rec.evolve?.t0 ?? 0, rec.last?.t ?? 0, rec.pending?.since ?? 0);
  }
  rec.v = SCHEMA;
  return rec;
}
function readChunks(key) {
  const head = world3.getDynamicProperty(key);
  if (typeof head !== "string") return void 0;
  if (!head.startsWith("#")) return head;
  const n = parseInt(head.slice(1), 10);
  let s = "";
  for (let i = 0; i < n; i++) {
    const part = world3.getDynamicProperty(`${key}:${i}`);
    if (typeof part !== "string") return void 0;
    s += part;
  }
  return s;
}
function writeChunks(key, s) {
  if (s.length <= CHUNK) {
    world3.setDynamicProperty(key, s);
    return;
  }
  const n = Math.ceil(s.length / CHUNK);
  for (let i = 0; i < n; i++) world3.setDynamicProperty(`${key}:${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK));
  world3.setDynamicProperty(key, `#${n}`);
}
var Store = class {
  constructor() {
    this.rec = freshRecord();
    this.harm = { regions: {} };
    this.dirty = false;
    this.harmDirty = false;
    this.loaded = false;
  }
  load() {
    try {
      const s = readChunks(KEY);
      this.rec = migrate(s ? JSON.parse(s) : void 0);
    } catch {
      this.rec = freshRecord();
    }
    try {
      const h = readChunks(HARM_KEY);
      this.harm = h ? JSON.parse(h) : { regions: {} };
      if (!this.harm || typeof this.harm.regions !== "object") this.harm = { regions: {} };
    } catch {
      this.harm = { regions: {} };
    }
    this.loaded = true;
  }
  touch() {
    this.dirty = true;
  }
  touchHarm() {
    this.harmDirty = true;
  }
  /** Write now.  Lifecycle transitions call this before they act, never after. */
  save() {
    writeChunks(KEY, JSON.stringify(this.rec));
    this.dirty = false;
  }
  flush() {
    if (this.dirty) this.save();
    if (this.harmDirty) {
      writeChunks(HARM_KEY, JSON.stringify(this.harm));
      this.harmDirty = false;
    }
  }
};
var store = new Store();
function newToken() {
  let s = "";
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 4294967295).toString(16).padStart(8, "0");
  return s;
}

// src/creature.ts
var SIZES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5];
var PARTS = {
  1: [
    { bone: "head", at: [0, 36, -70], size: 2, tag: "head" },
    { bone: "head", at: [0, 36, -40], size: 3, tag: "head" },
    { bone: "seg2", at: [0, 36, 72], size: 4, tag: "body" },
    { bone: "seg4", at: [0, 36, 136], size: 3, tag: "body" },
    { bone: "seg6", at: [0, 36, 200], size: 3, tag: "body" },
    { bone: "seg8", at: [0, 36, 264], size: 2, tag: "tail" },
    { bone: "seg10", at: [0, 36, 328], size: 1, tag: "tail" },
    { bone: "tailfin", at: [0, 36, 376], size: 2, tag: "tail" }
  ],
  2: [
    { bone: "head", at: [0, 84, -125], size: 3, tag: "head" },
    { bone: "neck", at: [0, 84, -50], size: 3, tag: "head" },
    { bone: "claw_l", at: [54, 6, -30], size: 1, tag: "limb" },
    { bone: "claw_r", at: [-54, 6, -30], size: 1, tag: "limb" },
    { bone: "forearm_l", at: [54, 40, -8], size: 1, tag: "limb" },
    { bone: "forearm_r", at: [-54, 40, -8], size: 1, tag: "limb" },
    { bone: "mid", at: [0, 60, 66], size: 5, tag: "body" },
    { bone: "hips", at: [0, 38, 126], size: 4, tag: "body" },
    { bone: "tail2", at: [0, 30, 192], size: 3, tag: "tail" },
    { bone: "tail4", at: [0, 26, 248], size: 2, tag: "tail" },
    { bone: "tail6", at: [0, 23, 304], size: 2, tag: "tail" },
    { bone: "knob", at: [0, 32, 358], size: 3, tag: "tail" }
  ],
  3: [
    { bone: "head", at: [0, 114, -262], size: 3, tag: "head" },
    { bone: "neck4", at: [0, 114, -186], size: 3, tag: "head" },
    { bone: "neck2", at: [0, 114, -152], size: 3, tag: "head" },
    { bone: "chest", at: [0, 106, -96], size: 5, tag: "body" },
    { bone: "hips", at: [0, 110, 78], size: 5, tag: "body" },
    { bone: "leg_fl_lower", at: [40, 40, -100], size: 2, tag: "limb" },
    { bone: "leg_fr_lower", at: [-40, 40, -100], size: 2, tag: "limb" },
    { bone: "leg_bl_lower", at: [40, 40, 84], size: 2, tag: "limb" },
    { bone: "leg_br_lower", at: [-40, 40, 84], size: 2, tag: "limb" },
    { bone: "foot_fl", at: [40, 4, -112], size: 1, tag: "limb" },
    { bone: "foot_fr", at: [-40, 4, -112], size: 1, tag: "limb" },
    { bone: "foot_bl", at: [40, 4, 72], size: 1, tag: "limb" },
    { bone: "foot_br", at: [-40, 4, 72], size: 1, tag: "limb" },
    { bone: "tail2", at: [0, 112, 158], size: 3, tag: "tail" },
    { bone: "tail4", at: [0, 112, 219], size: 2, tag: "tail" },
    { bone: "tail6", at: [0, 112, 278], size: 1, tag: "tail" },
    { bone: "tail8", at: [0, 112, 336], size: 1, tag: "tail" },
    { bone: "club", at: [0, 112, 374], size: 3, tag: "tail" }
  ]
};
var MOVE = {
  1: { turn: 2.2, accel: 0.02, radius: 3 },
  2: { turn: 1.5, accel: 0.03, radius: 2.5 },
  3: { turn: 1.25, accel: 0.012, radius: 3.5 }
};
var DROP = 30;
var BODY = {
  2: { built: [1.5, 2.6], cliff: 3.6, front: 3.5, look: [4, 7, 10] },
  3: { built: [2.5, 3.6], cliff: 4.8, front: 5.5, look: [6, 10, 14] }
};
var Creature = class {
  constructor(entity) {
    this.entity = entity;
    this.speed = 0;
    /** Navigation request for this tick onwards. */
    this.goal = null;
    this.goalSpeed = 0;
    this.arriveDist = 2;
    /** Form I: wanted depth below the surface for the entity origin (belly). */
    this.swimDepth = 7;
    this.blocked = 0;
    this.blockedWhy = "none";
    this.steerOff = 0;
    this.steerSide = 0;
    this.steerAt = -99;
    this.goalWalled = false;
    /** Land forms keep out of water deeper than they can stand in, unless something (the last crossing) sends them in. */
    this.wade = false;
    /** Swimming: in water over his depth, held at that depth instead of walking the bed. */
    this.afloat = false;
    this.surfY = void 0;
    this.partIds = [];
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.bend = 0;
    this.pitch = 0;
    this.phase = "idle";
    this.phaseTicks = 0;
    this.travelled = 0;
    this.charge = 0;
    this.props = /* @__PURE__ */ new Map();
    this.skel = null;
    this.parts = [];
    this.partPos = [];
    this.fxSeq = 0;
    this.pushAt = /* @__PURE__ */ new Map();
    this.tick = 0;
    /**
     * Form I out of water (the pond was drained, ice closed over, something carried him): look for the
     * nearest deep column in loaded chunks and slide back into it.  He is never left lying in rock.
     */
    this.unsettled = true;
    this.dry = 0;
    /** Curl held while not moving (sleeping at the seam). */
    this.bendHold = 0;
    this.dim = entity.dimension;
    this.pos = { ...entity.location };
    this.yaw = entity.getRotation().y;
    this.lastYaw = this.yaw;
    this.form = store.rec.form;
    const p = entity.getProperty(PROP.phase);
    for (const [k, v] of Object.entries(PHASE)) if (v === p) this.phase = k;
  }
  get valid() {
    try {
      return this.entity.isValid;
    } catch {
      return false;
    }
  }
  // ---- synchronised state -----------------------------------------------------------------
  set(prop, value) {
    if (this.props.get(prop) === value) return;
    this.props.set(prop, value);
    try {
      this.entity.setProperty(prop, value);
    } catch {
    }
  }
  /** Push every synchronised value again (after a load, a rebind, or an evolution). */
  resync() {
    this.props.clear();
    this.set(PROP.form, this.form);
    this.set(PROP.bound, true);
    this.set(PROP.phase, PHASE[this.phase]);
    this.set(PROP.charge, Math.round(this.charge));
    this.set(PROP.lookYaw, Math.round(this.lookYaw));
    this.set(PROP.lookPitch, Math.round(this.lookPitch));
    this.set(PROP.bend, Math.round(this.bend));
    this.set(PROP.pitch, Math.round(this.pitch));
  }
  setPhase(name) {
    if (this.phase !== name) {
      this.phase = name;
      this.phaseTicks = 0;
    }
    this.set(PROP.phase, PHASE[name]);
  }
  setCharge(v) {
    this.charge = clamp(v, 0, 20);
    this.set(PROP.charge, Math.round(this.charge));
  }
  /** A one-shot client effect (locator-bound particles): bump the sequence so clients see a change. */
  pulse(kind) {
    this.fxSeq = this.fxSeq + 1 & 15;
    this.set(PROP.fxKind, kind);
    this.set(PROP.fxSeq, this.fxSeq);
  }
  // ---- skeleton -----------------------------------------------------------------------------
  pose() {
    return poseOf(this.form, {
      lookYaw: Math.round(this.lookYaw),
      lookPitch: Math.round(this.lookPitch),
      bend: Math.round(this.bend),
      pitch: Math.round(this.pitch),
      charge: this.phase === "charge" || this.phase === "fire" ? 1 : 0,
      drink: this.phase === "drink" ? 1 : 0,
      window: this.phase === "window" || this.phase === "stalk" ? 1 : 0
    });
  }
  skeleton() {
    return this.skel ?? (this.skel = new Skeleton(this.form, this.pose()));
  }
  anchor(locator) {
    return toWorld(this.pos, this.yaw, this.skeleton().locator(locator));
  }
  point(bone, at) {
    return toWorld(this.pos, this.yaw, this.skeleton().point(bone, at));
  }
  get forward() {
    return forwardOf(this.yaw);
  }
  /** Where the head is pointing: from the throat through the muzzle. */
  aim() {
    const from = this.anchor("mouth");
    return { from, dir: norm(sub(this.anchor("muzzle"), this.anchor("throat"))) };
  }
  /** Turn the head (not the feet) towards a point; returns how far off the limit it is. */
  lookAt(target, maxYaw = 80, maxPitch = 40) {
    const base = this.form === 1 ? this.anchor("throat") : this.point(this.form === 2 ? "neck" : "neck1", this.form === 2 ? [0, 84, -32] : [0, 114, -126]);
    const want = wrapDeg(yawTo(base, target) - this.yaw);
    const flat = Math.max(0.5, distXZ(base, target));
    const pitch = Math.atan2(base.y - target.y, flat) * 180 / Math.PI;
    this.lookYaw = clamp(want, -maxYaw, maxYaw);
    this.lookPitch = clamp(pitch, -maxPitch, maxPitch);
    return Math.abs(want) - maxYaw;
  }
  lookAhead() {
    this.lookYaw = 0;
    this.lookPitch = 0;
  }
  /**
   * Point the muzzle itself at a target: look, measure where the skeleton actually aims in its
   * current pose, and correct.  Returns the remaining error in degrees.
   */
  aimAt(target, maxYaw = 80, maxPitch = 40) {
    let reach = this.lookAt(target, maxYaw, maxPitch);
    let err = 0;
    for (let i = 0; i < 3; i++) {
      this.skel = null;
      const { from, dir } = this.aim();
      const want = norm(sub(target, from));
      const dy = wrapDeg(Math.atan2(-want.x, want.z) * 180 / Math.PI - Math.atan2(-dir.x, dir.z) * 180 / Math.PI);
      const dp = (-Math.asin(clamp(want.y, -1, 1)) + Math.asin(clamp(dir.y, -1, 1))) * 180 / Math.PI;
      err = Math.hypot(dy, dp);
      if (Math.abs(this.lookYaw + dy) > maxYaw) reach = Math.max(reach, Math.abs(this.lookYaw + dy) - maxYaw);
      this.lookYaw = clamp(this.lookYaw + dy, -maxYaw, maxYaw);
      this.lookPitch = clamp(this.lookPitch + dp, -maxPitch, maxPitch);
    }
    this.skel = null;
    return reach > 0 ? reach : -err;
  }
  // ---- movement -----------------------------------------------------------------------------
  goTo(target, speed, arrive = 2) {
    if (!this.goal || distXZ(this.goal, target) > 1.5) {
      this.blocked = 0;
      this.steerOff = 0;
      this.steerSide = 0;
      this.steerAt = -99;
      this.goalWalled = false;
    }
    this.goal = target;
    this.goalSpeed = speed;
    this.arriveDist = arrive;
  }
  halt() {
    this.goal = null;
    this.goalSpeed = 0;
    this.blocked = 0;
    this.steerOff = 0;
    this.steerSide = 0;
    this.goalWalled = false;
  }
  arrived() {
    return !this.goal || distXZ(this.pos, this.goal) <= this.arriveDist;
  }
  // ---- walls -----------------------------------------------------------------------------------
  walled(at, full) {
    const b = BODY[this.form];
    const feet = this.afloat && this.surfY != null ? Math.max(this.pos.y, this.surfY - 1.2) : this.pos.y;
    return trunkBlocked(this.dim, at, feet, MOVE[this.form].radius, b.built, b.cliff, full);
  }
  /** Is there room for his middle here (used by the few moves that carry him without stepping)? */
  roomAt(at) {
    for (const dy of [1, 3]) {
      const b = blockAt(this.dim, { x: at.x, y: at.y + dy, z: at.z });
      if (b && isSolidBlock(b)) return false;
    }
    return true;
  }
  /** Water deeper than this form wades: Form II drags through shallows, Form III stands belly-deep. */
  tooDeep(at, floorY) {
    if (this.wade || this.form === 1) return false;
    return waterOver(this.dim, at.x, at.z, floorY, this.form === 3 ? 5 : 2);
  }
  /** Already in water over his depth (swimming, or sunk to the bed): then every way is a way out. */
  inDeep() {
    return this.afloat || this.tooDeep(this.pos, this.pos.y);
  }
  clearAlong(yaw, reach) {
    const f = forwardOf(yaw);
    for (const s of BODY[this.form].look) {
      if (s > reach) break;
      const at = add(this.pos, mul(f, s));
      if (this.walled(at, false)) return false;
      const floor = groundY(this.dim, at.x, at.z, this.pos.y + 6, DROP + 6);
      if (floor === NONE) return false;
      if (typeof floor === "number" && !this.inDeep() && this.tooDeep(at, floor)) return false;
    }
    return true;
  }
  /**
   * The heading to hold on the way to the goal.  Straight at it when the way is clear; otherwise the
   * smallest turn that clears the wall, and the same way round until the wall is behind him.
   */
  steer(want, d) {
    if (this.form === 1) return want;
    if (this.tick - this.steerAt >= 4) {
      this.steerAt = this.tick;
      let off = 0;
      if (this.clearAlong(want, d + 1)) this.steerSide = 0;
      else if (d < 16 && this.walled(this.goal, false)) this.goalWalled = true;
      else {
        const sides = this.steerSide ? [this.steerSide, -this.steerSide] : wrapDeg(this.yaw - want) >= 0 ? [1, -1] : [-1, 1];
        search: for (const a of [25, 50, 75, 100, 130]) for (const s of sides) {
          if (this.clearAlong(want + s * a, 1e9)) {
            off = s * a;
            this.steerSide = s;
            break search;
          }
        }
      }
      this.steerOff = off;
    }
    return want + this.steerOff;
  }
  stepLand(next, moving = true) {
    const r = MOVE[this.form].radius;
    const front = mul(this.forward, BODY[this.form].front);
    if (moving && (this.walled(add(next, front), true) || this.walled(next, false)) && !this.walled(this.pos, false)) {
      this.blockedWhy = "wall";
      return null;
    }
    const lim = this.form === 3 ? 5 : 2;
    if (this.tick % 5 === 0 || this.surfY === void 0) {
      const wc = waterColumn(this.dim, next.x, next.z, this.pos.y + lim, 8, 2);
      this.surfY = wc === NONE || wc === UNLOADED ? null : wc.surface;
    }
    const floatY = this.surfY !== null && this.surfY !== void 0 ? this.surfY - lim : null;
    const top = this.form === 3 ? 6 : 3;
    const yTop = this.pos.y + top + (this.afloat ? lim + 2 : 0);
    const mid = groundY(this.dim, next.x, next.z, yTop, DROP + top);
    if (moving && !this.wade && !this.inDeep() && typeof mid === "number" && this.tooDeep(next, mid)) {
      this.blockedWhy = "deep";
      return null;
    }
    let g = footprintY(this.dim, next, r, yTop, DROP + top, floatY);
    if (g === UNLOADED) {
      this.blockedWhy = "unloaded";
      return null;
    }
    if (g === NONE) {
      this.blockedWhy = "edge";
      return null;
    }
    if (floatY !== null && g <= floatY + 0.01 && typeof mid === "number" && mid > floatY) g = mid;
    const rise = g - this.pos.y;
    const swims = floatY !== null && g <= floatY + 0.01 && isWaterId(blockAt(this.dim, { x: next.x, y: floatY, z: next.z })?.typeId);
    if (!swims && rise > (this.afloat ? lim + 1.6 : this.form === 3 ? 3.2 : 1.6)) {
      this.blockedWhy = "climb";
      return null;
    }
    this.afloat = swims || this.afloat && rise > 0.5;
    return { x: next.x, y: this.pos.y + clamp(rise, -0.9, 0.45), z: next.z };
  }
  stepWater(next, moving = true) {
    const col = waterColumn(this.dim, next.x, next.z, this.pos.y + 2, 10, 28);
    if (col === UNLOADED) {
      this.blockedWhy = "unloaded";
      return null;
    }
    if (col === NONE) {
      this.blockedWhy = "edge";
      return null;
    }
    const depth = col.surface - col.floor;
    if (depth < 3.5) {
      this.blockedWhy = "shallow";
      return null;
    }
    if (moving) {
      const head = add(next, mul(this.forward, 7));
      const hb = blockAt(this.dim, { x: head.x, y: this.pos.y + 1.5, z: head.z });
      if (hb && !isWaterId(hb.typeId)) {
        this.blockedWhy = "edge";
        return null;
      }
      const l = leftOf(this.yaw), sh = add(next, mul(this.forward, 3));
      for (const side of [-2.6, 2.6]) for (const dy of [0.8, 2.8]) {
        if (isSolidBlock(blockAt(this.dim, { x: sh.x + l.x * side, y: next.y + dy, z: sh.z + l.z * side }))) {
          this.blockedWhy = "wall";
          return null;
        }
      }
    }
    const want = clamp(col.surface - this.swimDepth, col.floor + 0.2, Math.max(col.floor + 0.2, col.surface - 2.6));
    return { x: next.x, y: this.pos.y + clamp(want - this.pos.y, -0.18, 0.18), z: next.z };
  }
  keepWet() {
    const here = blockAt(this.dim, { x: this.pos.x, y: this.pos.y + 1, z: this.pos.z });
    if (!here || isWaterId(here.typeId)) {
      this.dry = 0;
      return;
    }
    if (++this.dry < 40 || this.dry % 10) return;
    for (let r = 4; r <= 36; r += 4) for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6, x = this.pos.x + Math.cos(a) * r, z = this.pos.z + Math.sin(a) * r;
      const col = waterColumn(this.dim, x, z, this.pos.y + 2, 12);
      if (col === UNLOADED || col === NONE || col.surface - col.floor < 4) continue;
      const to = { x, y: clamp(this.pos.y, col.floor + 0.2, col.surface - 3), z };
      this.pos = add(this.pos, mul(norm(sub(to, this.pos)), Math.min(2.5, dist(to, this.pos))));
      return;
    }
  }
  /** One tick of locomotion.  Returns the distance covered. */
  locomote() {
    const m = MOVE[this.form];
    let wantSpeed = 0;
    if (this.goal) {
      const d = distXZ(this.pos, this.goal);
      if (d > this.arriveDist) {
        const want = this.steer(yawTo(this.pos, this.goal), d);
        const off = Math.abs(wrapDeg(want - this.yaw));
        this.yaw = turnTowards(this.yaw, want, m.turn);
        wantSpeed = this.goalSpeed * (off > 70 ? 0.35 : off > 35 ? 0.7 : 1) * Math.min(1, d / 3 + 0.25);
        if (this.goalWalled) {
          wantSpeed = 0;
          this.blocked++;
          this.blockedWhy = "wall";
        }
      }
    }
    this.speed += clamp(wantSpeed - this.speed, -m.accel * 2, m.accel);
    let moved = 0;
    if (!this.goalWalled) this.blockedWhy = "none";
    if (this.speed > 2e-3) {
      const next = add(this.pos, mul(this.forward, this.speed));
      const settled = this.form === 1 ? this.stepWater(next) : this.stepLand(next);
      if (settled) {
        moved = distXZ(this.pos, settled);
        this.pos = settled;
        if (!this.goalWalled) this.blocked = 0;
      } else {
        this.blocked++;
        this.speed *= 0.5;
      }
    } else {
      if (this.form === 1) {
        const settled = this.stepWater(this.pos, false);
        if (settled) this.pos = settled;
      } else if (this.tick % 5 === 0 || this.unsettled) {
        const settled = this.stepLand(this.pos, false);
        this.unsettled = !!settled && Math.abs(settled.y - this.pos.y) > 0.01;
        if (settled) this.pos = settled;
      }
    }
    if (this.form === 1) this.keepWet();
    return moved;
  }
  /** Hand the result to the engine: velocity for smooth client motion, a teleport only to recover. */
  apply() {
    const e = this.entity;
    if (this.tick % 10 === 0) {
      try {
        if (e.dimension.id !== this.dim.id) {
          e.teleport(this.pos, { dimension: this.dim, rotation: { x: 0, y: this.yaw } });
          return;
        }
      } catch {
      }
    }
    let loc;
    try {
      loc = e.location;
    } catch {
      return;
    }
    const want = sub(this.pos, loc);
    try {
      if (len(want) > 8) e.teleport(this.pos, { rotation: { x: 0, y: this.yaw } });
      else {
        const v = e.getVelocity();
        e.applyImpulse(sub(want, v));
      }
      e.setRotation({ x: 0, y: this.yaw });
    } catch {
      try {
        e.teleport(this.pos, { rotation: { x: 0, y: this.yaw } });
      } catch {
      }
    }
  }
  // ---- hit volumes ----------------------------------------------------------------------------
  syncParts() {
    const defs = PARTS[this.form];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      const c = this.point(d.bone, d.at);
      const s = SIZES[d.size];
      const at = { x: c.x, y: c.y - s / 2, z: c.z };
      let part = this.parts[i];
      let ok = false;
      try {
        ok = !!part && part.isValid;
      } catch {
        ok = false;
      }
      if (!ok) {
        if (this.partIds[i]) {
          partOwner.delete(this.partIds[i]);
          this.partIds[i] = void 0;
        }
        if (!isLoaded(this.dim, at)) continue;
        try {
          part = this.dim.spawnEntity(HITBOX, at);
          part.triggerEvent(`basiliskra:size_${d.size}`);
          partOwner.set(part.id, { creature: this, tag: d.tag });
          this.parts[i] = part;
          this.partIds[i] = part.id;
          this.partPos[i] = at;
        } catch {
          this.parts[i] = void 0;
        }
        continue;
      }
      const last = this.partPos[i];
      if (!last || dist(last, at) > 0.2) {
        try {
          part.teleport(at);
          this.partPos[i] = at;
        } catch {
          this.parts[i] = void 0;
        }
      }
      if (this.tick % 100 === 0) {
        try {
          part.triggerEvent("basiliskra:keep");
        } catch {
        }
      }
    }
    for (let i = defs.length; i < this.parts.length; i++) this.dropPart(i);
    this.parts.length = defs.length;
  }
  dropPart(i) {
    const p = this.parts[i];
    if (this.partIds[i]) {
      partOwner.delete(this.partIds[i]);
      this.partIds[i] = void 0;
    }
    if (!p) return;
    try {
      if (p.isValid) p.remove();
    } catch {
    }
    this.parts[i] = void 0;
  }
  dropParts() {
    for (let i = 0; i < this.parts.length; i++) this.dropPart(i);
    this.parts.length = 0;
  }
  /** Centre and radius of each body volume, for contact checks. */
  volumes() {
    const out = PARTS[this.form].map((d) => ({ at: this.point(d.bone, d.at), r: SIZES[d.size] / 2, tag: d.tag }));
    const trunk = this.form === 1 ? { h: 4.4, r: 3 } : this.form === 2 ? { h: 7.2, r: 3.3 } : { h: 9.6, r: 4.3 };
    out.push({ at: { x: this.pos.x, y: this.pos.y + trunk.h / 2, z: this.pos.z }, r: trunk.r, tag: "body" });
    return out;
  }
  /** His body is solid to players: anyone inside a volume is eased out of it. */
  pushPlayers() {
    const near = witnesses(this.dim, this.pos, 44);
    if (!near.length) return;
    const vols = this.volumes();
    for (const p of near) {
      if (!targetable(p)) continue;
      const last = this.pushAt.get(p.id) ?? -99;
      if (this.tick - last < 4) continue;
      const pl = p.location;
      const c = { x: pl.x, y: pl.y + 0.9, z: pl.z };
      for (const v of vols) {
        const d = dist(c, v.at);
        if (d < v.r + 0.35) {
          if (!clearLine(this.dim, v.at, c)) continue;
          const away = norm({ x: c.x - v.at.x, y: 0, z: c.z - v.at.z });
          try {
            p.applyKnockback({ x: (away.x || 0.01) * 0.55, z: (away.z || 0.01) * 0.55 }, 0.08);
          } catch {
          }
          this.pushAt.set(p.id, this.tick);
          break;
        }
      }
    }
  }
  // ---- per tick -------------------------------------------------------------------------------
  update() {
    this.tick++;
    this.phaseTicks++;
    this.skel = null;
    const moved = this.locomote();
    this.travelled += moved;
    const yawRate = wrapDeg(this.yaw - this.lastYaw);
    this.lastYaw = this.yaw;
    const seg = this.form === 1 ? 2 : 1.8;
    const curve = this.speed > 0.03 ? clamp(yawRate * seg / Math.max(this.speed, 0.08), -24, 24) : this.bendHold;
    this.bend += clamp(curve - this.bend, -1.2, 1.2);
    this.apply();
    this.set(PROP.lookYaw, Math.round(this.lookYaw));
    this.set(PROP.lookPitch, Math.round(this.lookPitch));
    this.set(PROP.bend, Math.round(this.bend));
    this.set(PROP.pitch, Math.round(this.pitch));
    this.skel = null;
    if (this.tick % 2 === 0) {
      this.syncParts();
      this.pushPlayers();
    }
    return moved;
  }
  say(id, at, range = 56, volume = 1, pitch = 1) {
    sound(this.dim, id, at ?? this.pos, range, volume, pitch);
  }
  emit(id, at, range = 56) {
    particle(this.dim, id, at, range);
  }
  /** Damage a player from him (never on Peaceful when configured so; never Creative/Spectator). */
  hurt(p, amount, cause = EntityDamageCause.entityAttack) {
    if (!targetable(p)) return false;
    if (CONFIG.harmlessOnPeaceful && String(world4.getDifficulty()).toLowerCase() === "peaceful") return false;
    try {
      return p.applyDamage(amount * CONFIG.damage, { cause, damagingEntity: this.entity });
    } catch {
      return false;
    }
  }
};
var partOwner = /* @__PURE__ */ new Map();
function targetable(p) {
  try {
    if (!p.isValid) return false;
    const gm = p.getGameMode();
    return gm !== GameMode.Creative && gm !== GameMode.Spectator;
  } catch {
    return false;
  }
}

// src/brain.ts
function* wait(ticks) {
  for (let i = 0; i < ticks; i++) yield;
}
function* travel(c, target, speed, arrive = 2, timeout = 600) {
  c.goTo(target, speed, arrive);
  let t = 0;
  while (!c.arrived()) {
    if (++t > timeout) {
      c.halt();
      return false;
    }
    if (c.blocked > 50) {
      c.halt();
      return false;
    }
    yield;
  }
  c.halt();
  return true;
}
var pace = (ticks) => Math.max(1, Math.round(ticks / CONFIG.pacing));
var isNight = (tod) => tod >= 13e3 && tod < 23e3;
var isDusk = (tod) => tod >= 11800 && tod < 13800;
function nearbyPlayers(c, range) {
  const out = [];
  for (const p of players()) {
    try {
      if (p.dimension.id === c.dim.id && targetable(p) && dist(p.location, c.pos) <= range) out.push(p);
    } catch {
    }
  }
  out.sort((a, b) => dist(a.location, c.pos) - dist(b.location, c.pos));
  return out;
}
function anyoneNear(c, range) {
  for (const p of players()) {
    try {
      if (p.dimension.id === c.dim.id && dist(p.location, c.pos) <= range) return true;
    } catch {
    }
  }
  return false;
}
var Brain = class {
  constructor(c) {
    this.c = c;
    this.act = null;
    this.actName = "none";
    this.actTicks = 0;
    this.actLimit = 0;
    this.cooldown = /* @__PURE__ */ new Map();
    /** Set by the controller: a forced encounter for tests and scripted scenes. */
    this.forced = null;
    this.hurtAt = -9999;
  }
  get rec() {
    return store.rec;
  }
  get now() {
    return store.rec.clock;
  }
  ready(key) {
    return (this.cooldown.get(key) ?? -1e9) <= this.now;
  }
  rest(key, ticks) {
    this.cooldown.set(key, this.now + pace(ticks));
  }
  /** Something that should not wait for the current encounter to end. */
  interrupt() {
    return null;
  }
  begin(ch) {
    this.finish();
    this.act = ch.run;
    this.actName = ch.name;
    this.actTicks = 0;
    this.actLimit = ch.limit;
  }
  /** The single exit for every encounter. */
  finish() {
    if (this.act) {
      try {
        this.act.return();
      } catch {
      }
    }
    this.act = null;
    this.actName = "none";
    const c = this.c;
    c.halt();
    c.lookAhead();
    c.bendHold = 0;
    c.pitch = 0;
    if (c.charge > 0) c.setCharge(0);
    if (c.phase !== "idle") c.setPhase("idle");
    this.onFinish();
  }
  onFinish() {
  }
  tick() {
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      this.begin(f);
    }
    const pre = this.interrupt();
    if (pre) this.begin(pre);
    if (!this.act) {
      const ch = this.choose();
      if (ch) this.begin(ch);
    }
    if (!this.act) return;
    this.actTicks++;
    let done = false;
    try {
      done = this.act.next().done === true;
    } catch (e) {
      done = true;
      if (CONFIG.debug) console.warn(`[basiliskra] ${this.actName}: ${e}`);
    }
    if (done || this.actTicks > this.actLimit) this.finish();
  }
  onHurt(_by) {
    this.hurtAt = this.now;
  }
  onSplash(_at, _by) {
  }
  onBell(_at, _by) {
  }
  onNote(_at) {
  }
};

// src/ending.ts
import { EquipmentSlot } from "@minecraft/server";

// src/forms/three.ts
import { EntityDamageCause as EntityDamageCause2, world as world5 } from "@minecraft/server";
var TIERS = {
  1: { range: 28, radius: 1.4, damage: 4, ticks: 40, sfx: "basiliskra.iii.beam_raw", width: 1.5 },
  2: { range: 48, radius: 0.95, damage: 6, ticks: 60, sfx: "basiliskra.iii.beam", width: 0.9 },
  3: { range: 64, radius: 0.8, damage: 8, ticks: 70, sfx: "basiliskra.iii.beam", width: 0.6 }
};
var ROD = /^minecraft:(waxed_)?(exposed_|weathered_|oxidized_)?lightning_rod$/;
var ROD_REACH = 10;
var FEET = ["foot_bl", "foot_fl", "foot_br", "foot_fr"];
var WINDOW_STANDOFF = 14.9;
var WINDOW_EYE_LEFT = 1.25;
var rodReady = /* @__PURE__ */ new Map();
function segDist(p, a, d, length) {
  const t = clamp(dot(sub(p, a), d), 0, length);
  return dist(p, add(a, mul(d, t)));
}
var BrainThree = class extends Brain {
  constructor() {
    super(...arguments);
    this.beat = 0;
    this.stepAt = 0;
    this.prey = null;
    // the one he remembers
    this.preyUntil = 0;
    this.recoverUntil = 0;
    /** Set when a charge is grounded: the ending listens for it. */
    this.groundedAt = null;
    /** The ending asks for a charge aimed at nothing in particular, beside the seam. */
    this.wantCharge = false;
    /** Rods seen near the club during this charge, by layer: the whole reach is read once every twelve ticks. */
    this.rodSeen = /* @__PURE__ */ new Map();
    this.rodLayer = 0;
  }
  onFinish() {
    this.c.set(PROP.tier, this.tier());
  }
  tier() {
    const b = this.rec.mut.beams;
    return b < 2 ? 1 : b < 5 ? 2 : 3;
  }
  choose() {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world5.getTimeOfDay();
    if (this.wantCharge) {
      this.wantCharge = false;
      return { name: "charge", run: this.beam(null), limit: 30 * TICKS.second };
    }
    const near = nearbyPlayers(c, 72);
    if (rec.origin && rec.guilty && this.ready("remember") && distXZ(rec.origin, c.pos) < 90) {
      const g = near.find((p) => p.id === rec.guilty);
      if (g) {
        this.rest("remember", TICKS.day);
        return { name: "remember", run: this.remember(g), limit: 100 * TICKS.second };
      }
    }
    if (now >= this.recoverUntil) {
      const hunted = this.prey && now < this.preyUntil ? near.filter((p) => p.id === this.prey) : near;
      if (this.tier() === 3 && this.ready("scatter")) {
        const flank = hunted.find((p) => dist(p.location, c.pos) < 18 && Math.abs(wrapDeg(yawTo(c.pos, p.location) - c.yaw)) > 100);
        if (flank) {
          this.rest("scatter", 45 * TICKS.second);
          return { name: "scatter", run: this.scatter(), limit: 20 * TICKS.second };
        }
      }
      if (this.ready("beam")) {
        for (const p of hunted) {
          const d = dist(p.location, c.anchor("mouth"));
          if (d < 10 || d > TIERS[this.tier()].range - 2) continue;
          if (!clearLine(c.dim, c.anchor("mouth"), p.getHeadLocation())) continue;
          this.rest("beam", 25 * TICKS.second);
          return { name: "beam", run: this.beam(p), limit: 30 * TICKS.second };
        }
      }
    }
    if (isNight(tod) && this.ready("window")) {
      for (const p of near) {
        if (this.ready("window:" + p.id) && this.indoors(p)) {
          this.rest("window", 3 * TICKS.minute);
          this.rest("window:" + p.id, TICKS.day);
          return { name: "window", run: this.window(p), limit: 2 * TICKS.minute };
        }
      }
    }
    if (this.prey && now < this.preyUntil) {
      const g = near.find((p) => p.id === this.prey);
      if (g) return { name: "pursue", run: this.pursue(g), limit: 20 * TICKS.second };
    }
    return { name: "roam", run: this.roam(), limit: 80 * TICKS.second };
  }
  // ---- four footfalls --------------------------------------------------------------------------
  /** Walk, landing one foot every quarter stride: left hind, left fore, right hind, right fore. */
  *walk(target, speed, arrive, timeout, phase = "move") {
    const c = this.c;
    c.setPhase(phase);
    c.goTo(target, speed, arrive);
    let t = 0;
    while (!c.arrived()) {
      if (++t > timeout || c.blocked > 50) {
        c.halt();
        return false;
      }
      this.footfalls();
      yield;
    }
    c.halt();
    return true;
  }
  footfalls() {
    const c = this.c;
    if (c.travelled - this.stepAt < STRIDE_III / 4) return;
    this.stepAt = c.travelled - this.stepAt < STRIDE_III / 2 ? this.stepAt + STRIDE_III / 4 : c.travelled;
    const k = this.beat & 3;
    c.set(PROP.gait, k);
    const foot = add(c.anchor(FEET[k]), mul(c.forward, STANCE_III / 2));
    this.beat++;
    this.rec.mut.overland += STRIDE_III / 4;
    sound(c.dim, "basiliskra.iii.step", foot, 96, 1, 0.94 + (this.beat & 3) * 0.03);
    particle(c.dim, "basiliskra:step_dust", { x: foot.x, y: c.pos.y + 0.1, z: foot.z }, 56);
    for (const p of witnesses(c.dim, foot, 28)) {
      try {
        p.runCommand("camerashake add @s 0.08 0.2 positional");
      } catch {
      }
    }
    if (!CONFIG.marks) return;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const at = { x: Math.floor(foot.x) + dx, y: Math.floor(c.pos.y - 0.5), z: Math.floor(foot.z) + dz };
      const b = takesMark(c.dim, at);
      const to = b ? printOf(b.typeId) : void 0;
      if (b && to) {
        try {
          b.setType(to);
        } catch {
        }
      }
    }
  }
  *roam() {
    const c = this.c;
    const near = nearbyPlayers(c, 110);
    let target;
    if (near.length) {
      const p = near[0].location;
      const a = hash(this.now, 41) * Math.PI * 2;
      target = { x: p.x + Math.cos(a) * 22, y: p.y, z: p.z + Math.sin(a) * 22 };
    } else {
      const home = this.rec.origin ?? this.rec.rift ?? c.pos;
      const a = hash(this.now, 43) * Math.PI * 2;
      target = { x: home.x + Math.cos(a) * 40, y: c.pos.y, z: home.z + Math.sin(a) * 40 };
    }
    yield* this.walk(target, 0.14, 6, 1300);
    c.setPhase("idle");
    for (let t = 0; t < 140; t++) {
      if (t % 80 === 0) c.say("basiliskra.iii.breath", c.anchor("nose"), 48, 0.8);
      yield;
    }
  }
  // ---- the eye at the window ------------------------------------------------------------------------
  indoors(p) {
    const c = this.c, head = p.getHeadLocation();
    let roof = false;
    for (let y = 1; y <= 7 && !roof; y++) roof = isSolidBlock(blockAt(c.dim, { x: head.x, y: head.y + y, z: head.z }));
    if (!roof) return false;
    let walls = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= 7; r++) if (isSolidBlock(blockAt(c.dim, { x: head.x + dx * r, y: head.y, z: head.z + dz * r }))) {
        walls++;
        break;
      }
    }
    return walls >= 3;
  }
  /**
   * Which way out of the room is there glass or an opening, how far off, and where is the middle of
   * the pane?  Of several, the one nearest to where he already is.
   */
  windowDir(p) {
    const c = this.c, head = p.getHeadLocation();
    const toHim = norm({ x: c.pos.x - head.x, y: 0, z: c.pos.z - head.z });
    const glassy = (x, y, z) => /glass|iron_bars/.test(idAt(c.dim, { x, y, z }) ?? "");
    let best = toHim, score = -2, reach = 3, pane = add(head, mul(toHim, 3));
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, d = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      let open = false, at = 3, mid = add(head, mul(d, 3));
      for (let r = 1; r <= 9; r++) {
        const q = { x: head.x + d.x * r, y: head.y, z: head.z + d.z * r };
        const b = blockAt(c.dim, q);
        if (!b) break;
        if (/glass|iron_bars|fence_gate/.test(b.typeId)) {
          const bx = Math.floor(q.x), by = Math.floor(q.y), bz = Math.floor(q.z);
          const along = Math.abs(d.x) >= Math.abs(d.z) ? { x: 0, z: 1 } : { x: 1, z: 0 };
          let lo = 0, hi = 0;
          while (lo > -3 && glassy(bx + along.x * (lo - 1), by, bz + along.z * (lo - 1))) lo--;
          while (hi < 3 && glassy(bx + along.x * (hi + 1), by, bz + along.z * (hi + 1))) hi++;
          mid = { x: bx + 0.5 + along.x * (lo + hi) / 2, y: head.y, z: bz + 0.5 + along.z * (lo + hi) / 2 };
          open = true;
          at = r;
          break;
        }
        if (isSolidBlock(b)) break;
        if (r === 9) open = true;
      }
      if (open && dot(d, toHim) > score) {
        score = dot(d, toHim);
        best = d;
        reach = at;
        pane = mid;
      }
    }
    return { dir: best, reach, pane };
  }
  /** Turn where he stands: the feet shuffle round, one planted at a time. */
  *face(target, limit = 400) {
    const c = this.c;
    c.setPhase("move");
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, target);
      if (Math.abs(wrapDeg(want - c.yaw)) < 2) break;
      c.yaw = turnTowards(c.yaw, want, 1.1);
      if (t % 18 === 9) {
        const foot = c.anchor(FEET[Math.floor(t / 18) & 3]);
        sound(c.dim, "basiliskra.iii.step", foot, 72, 0.7, 0.98);
      }
      yield;
    }
  }
  *window(p) {
    const c = this.c;
    const ok = () => {
      try {
        return p.isValid && p.dimension.id === c.dim.id;
      } catch {
        return false;
      }
    };
    const { dir: out, pane } = this.windowDir(p);
    const left = leftOf(yawTo(out, { x: 0, y: 0, z: 0 }));
    const line = (d) => add(add(pane, mul(out, d)), mul(left, WINDOW_EYE_LEFT));
    const RUN = STRIDE_III;
    if (!(yield* this.walk(line(WINDOW_STANDOFF + RUN), 0.14, 0.4, 1800))) return;
    if (!ok()) return;
    yield* this.face(line(0));
    c.setPhase("idle");
    yield* wait(50);
    if (!ok()) return;
    c.setPhase("stalk");
    c.goTo(line(WINDOW_STANDOFF - 6), STRIDE_III / 4 / KNOCK_GAP_TICKS, 0.3);
    c.speed = STRIDE_III / 4 / KNOCK_GAP_TICKS;
    this.stepAt = c.travelled;
    const first = this.beat;
    for (let t = 0; t < 200 && this.beat - first < 4 && c.blocked < 20; t++) {
      this.footfalls();
      if (this.beat - first < 4) yield;
    }
    c.halt();
    c.speed = 0;
    if (!ok()) return;
    c.setPhase("window");
    for (let t = 0; t < 260 && ok(); t++) {
      c.lookAt(p.getHeadLocation(), 18, 0);
      if (t % 80 === 10) {
        try {
          p.playSound("basiliskra.iii.window_breath", { location: c.anchor("nose"), volume: 1 });
        } catch {
        }
      }
      yield;
    }
    c.lookAhead();
    yield* this.walk(line(WINDOW_STANDOFF + RUN + 3), 0.12, 2.5, 500, "stalk");
    c.setPhase("idle");
    yield* wait(50);
    yield* this.walk(add(c.pos, mul(out, 24)), 0.13, 5, 700);
  }
  // ---- he remembers you --------------------------------------------------------------------------------
  *remember(g) {
    const c = this.c;
    const ok = () => {
      try {
        return g.isValid && targetable(g) && g.dimension.id === c.dim.id;
      } catch {
        return false;
      }
    };
    c.halt();
    c.setPhase("look");
    c.say("basiliskra.iii.neck_turn", c.anchor("nose"), 48);
    for (let t = 0; t < 110 && ok(); t++) {
      c.lookAt(g.getHeadLocation(), 85, 35);
      if (t === 36) c.say("basiliskra.iii.growl", c.anchor("nose"), 72);
      yield;
    }
    if (!ok()) return;
    this.prey = g.id;
    this.preyUntil = this.now + 70 * TICKS.second;
    c.lookAhead();
  }
  *pursue(g) {
    const c = this.c;
    for (let t = 0; t < 300; t++) {
      let at;
      try {
        if (!g.isValid || g.dimension.id !== c.dim.id) return;
        at = g.location;
      } catch {
        return;
      }
      c.setPhase("move");
      c.goTo(at, 0.16, 16);
      c.lookAt(at, 60, 25);
      this.footfalls();
      if (dist(at, c.pos) < 17) break;
      yield;
    }
    c.halt();
  }
  // ---- grounding ------------------------------------------------------------------------------------------
  /** A point on the planted club that is above the ground it rests on. */
  clubTop() {
    const k = this.c.anchor("club_core");
    return { x: k.x, y: Math.max(k.y, this.c.pos.y + 1.6), z: k.z };
  }
  scanRods(layers = 1) {
    const c = this.c;
    const club = c.anchor("club_core");
    const y0 = Math.floor(c.pos.y), cx = Math.floor(club.x), cz = Math.floor(club.z);
    for (let n = 0; n < layers; n++) {
      const y = y0 - 3 + this.rodLayer++ % 12;
      for (let dx = -ROD_REACH; dx <= ROD_REACH; dx++) for (let dz = -ROD_REACH; dz <= ROD_REACH; dz++) {
        if (dx * dx + dz * dz > ROD_REACH * ROD_REACH) continue;
        const p = { x: cx + dx, y, z: cz + dz };
        const id = idAt(c.dim, p);
        const key = `${p.x},${p.y},${p.z}`;
        if (id && ROD.test(id)) this.rodSeen.set(key, p);
        else this.rodSeen.delete(key);
      }
    }
  }
  /** The nearest usable rod among those seen (still a rod, not recovering from the last strike). */
  findRod() {
    const c = this.c;
    const club = c.anchor("club_core");
    let best = null, bd = 1e9;
    for (const [key, p] of this.rodSeen) {
      const id = idAt(c.dim, p);
      if (!id || !ROD.test(id)) {
        this.rodSeen.delete(key);
        continue;
      }
      if ((rodReady.get(key) ?? 0) > this.now) continue;
      const d = Math.hypot(p.x + 0.5 - club.x, p.z + 0.5 - club.z);
      if (d <= ROD_REACH && d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }
  /** The discharge leaves one particular spike tip for the rod; the ridge collapses; the throat goes dark. */
  *ground(rod) {
    const c = this.c;
    const top = { x: rod.x + 0.5, y: rod.y + 1, z: rod.z + 0.5 };
    let tip = c.anchor("spike_tip_0"), bd = 1e9;
    for (let k = 0; k < 12; k++) {
      const s = c.anchor(`spike_tip_${k}`);
      const d = dist(s, top);
      if (d < bd) {
        bd = d;
        tip = s;
      }
    }
    rodReady.set(`${rod.x},${rod.y},${rod.z}`, this.now + 30 * TICKS.second);
    if (rodReady.size > 64) rodReady.clear();
    this.rec.learned.rods++;
    this.groundedAt = { tick: this.now, rod };
    c.setPhase("grounded");
    sound(c.dim, "basiliskra.iii.ground", top, 96);
    const steps = Math.max(4, Math.ceil(dist(tip, top) * 1.6));
    for (let t = 0; t < 50; t++) {
      if (t < 14 && t % 2 === 0) {
        for (let i = 0; i <= steps; i++) {
          const k = i / steps;
          const j = i === 0 || i === steps ? 0 : 0.7;
          particle(c.dim, "basiliskra:arc_seg", {
            x: tip.x + (top.x - tip.x) * k + (hash(t, i, 1) - 0.5) * j,
            y: tip.y + (top.y - tip.y) * k + (hash(t, i, 2) - 0.5) * j,
            z: tip.z + (top.z - tip.z) * k + (hash(t, i, 3) - 0.5) * j
          }, 64);
        }
      }
      c.setCharge(c.charge - 1.5);
      if (t === 16) c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 64);
      yield;
    }
    c.setCharge(0);
  }
  // ---- the red beam -----------------------------------------------------------------------------------------
  *vent() {
    const c = this.c;
    c.setPhase("vent");
    for (let k = 0; k < 3; k++) {
      c.say("basiliskra.knock.vent", c.anchor("gill_l"), 64, 1, 1 - k * 0.03);
      c.pulse(3);
      for (let i = 0; i < KNOCK_GAP_TICKS; i++) {
        c.setCharge(c.charge - 0.34);
        yield;
      }
    }
    c.setCharge(0);
  }
  *beam(target) {
    const c = this.c;
    const tier = this.tier();
    const T = TIERS[tier];
    c.set(PROP.tier, tier);
    const ok = () => {
      try {
        return !target || target.isValid && target.dimension.id === c.dim.id;
      } catch {
        return false;
      }
    };
    const aimAt = () => target ? target.getHeadLocation() : add(c.anchor("mouth"), mul(c.forward, 30));
    c.halt();
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 96);
    c.say("basiliskra.iii.charge", c.pos, 96);
    this.rodSeen.clear();
    this.rodLayer = 0;
    for (let t = 0; t < 14; t++) {
      c.setCharge(t / 7);
      if (ok()) c.aimAt(aimAt(), 80, 40);
      this.scanRods();
      yield;
    }
    let rod = null;
    let lit = 1;
    for (let t = 0; t < 54; t++) {
      if (!ok()) return;
      const aim = aimAt();
      const off = c.aimAt(aim, 80, 40);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), 0.6);
      c.setCharge(2 + t / 54 * 14);
      const zone = Math.floor(c.charge / 2);
      if (zone > lit) {
        lit = zone;
        sound(c.dim, "basiliskra.iii.charge_tick", c.anchor(zone >= 6 ? "throat" : zone >= 3 ? "plate_tip_5" : "club_core"), 72, 0.9, 0.75 + zone * 0.09);
      }
      this.scanRods();
      yield;
    }
    rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) {
      yield* this.ground(rod);
      yield* wait(30);
      this.recoverUntil = this.now + 8 * TICKS.second;
      return;
    }
    for (let t = 0; t < 24; t++) {
      c.setCharge(16 + t / 24 * 2);
      yield;
    }
    c.setPhase("fire");
    c.setCharge(20);
    this.rec.mut.beams++;
    this.rec.mut.lastEncounter = this.now;
    c.say(T.sfx, c.anchor("mouth"), 128);
    let lastHit = null;
    for (let t = 0; t < T.ticks; t++) {
      if (tier >= 2 && target && ok() && targetable(target)) {
        const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
        c.lookYaw += clamp(want - c.lookYaw, -0.35, 0.35);
      }
      const sputter = tier === 1 && (t % 13 === 9 || t % 13 === 10 || t % 13 === 11);
      const { from, dir } = c.aim();
      let length = T.range;
      let hitBlock = null;
      if (isLoaded(c.dim, from)) {
        try {
          const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: T.range, includeLiquidBlocks: false, includePassableBlocks: false });
          if (hit) {
            hitBlock = hit.block.location;
            length = Math.max(1, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })) - 0.4);
          }
        } catch {
          length = 6;
        }
      }
      while (length > 4 && !isLoaded(c.dim, add(from, mul(dir, length)))) length -= 4;
      const end = add(from, mul(dir, length));
      if (!sputter) {
        if (t % 2 === 0) {
          particle(c.dim, "basiliskra:beam_core", from, 128, beamVars(dir, length, T.width * (tier === 1 ? 0.8 + hash(t) * 0.6 : 1)));
          particle(c.dim, "basiliskra:beam_halo", from, 128, beamVars(dir, length, T.width * 2.6));
        }
        const side = norm({ x: -dir.z, y: 0, z: dir.x });
        const up = norm({ x: dir.y * side.z - dir.z * side.y, y: dir.z * side.x - dir.x * side.z, z: dir.x * side.y - dir.y * side.x });
        for (let i = 0; i < 6; i++) {
          const along = (t * 2.3 + i * (length / 6)) % length;
          const a = along * 1.1 + t * 0.9;
          const r = T.width * 0.9 + 0.25;
          particle(c.dim, "basiliskra:beam_spiral", add(add(from, mul(dir, along)), add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r))), 96);
        }
        if (hitBlock) {
          if (t % 3 === 0) particle(c.dim, "basiliskra:beam_impact", end, 96);
          if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 96);
          if (t % 6 === 0) this.scorch(hitBlock);
          lastHit = end;
        }
        if (t % 4 === 0) {
          for (const p of players()) {
            try {
              if (p.dimension.id !== c.dim.id || !targetable(p)) continue;
              const body = add(p.location, { x: 0, y: 0.9, z: 0 });
              if (segDist(body, from, dir, length) > T.radius + 0.4) continue;
              const along = clamp(dot(sub(body, from), dir), 0, Math.max(0, length - 0.6));
              if (!clearLine(c.dim, add(from, mul(dir, along)), body)) continue;
              c.hurt(p, T.damage, EntityDamageCause2.entityAttack);
            } catch {
            }
          }
        }
      }
      yield;
    }
    yield* this.vent();
    this.recoverUntil = this.now + 7 * TICKS.second;
    c.setPhase("idle");
    yield* wait(50);
  }
  /** Mark what the beam touched.  Natural ground only; never a block with an inventory, a bed, a portal or redstone. */
  scorch(at) {
    if (CONFIG.terrain === "none") return;
    const c = this.c;
    const hit = blockAt(c.dim, at);
    if (!hit || !isNaturalGround(hit.typeId)) return;
    const free = (x, y, z) => {
      const b = blockAt(c.dim, { x, y, z });
      return !!b && !isSolidBlock(b);
    };
    const built = (x, y, z) => {
      const b = blockAt(c.dim, { x, y, z });
      return !!b && isSolidBlock(b) && !isNaturalGround(b.typeId) && !isPlantBlock(b.typeId);
    };
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 2) continue;
      const x = Math.floor(at.x) + dx, y = Math.floor(at.y) + dy, z = Math.floor(at.z) + dz;
      const b = blockAt(c.dim, { x, y, z });
      if (!b) continue;
      const id = b.typeId;
      const to = scorchOf(id);
      if (!to && !(CONFIG.terrain === "break" && isBreakableNatural(id))) continue;
      if (free(x + 1, y, z) && free(x - 1, y, z) || free(x, y, z + 1) && free(x, y, z - 1)) continue;
      if (built(x + 1, y, z) || built(x - 1, y, z) || built(x, y, z + 1) || built(x, y, z - 1) || built(x, y + 1, z) || built(x, y - 1, z)) continue;
      try {
        if (CONFIG.terrain === "break" && dx === 0 && dy === 0 && dz === 0 && isBreakableNatural(id)) b.setType("minecraft:air");
        else if (to) b.setType(to);
      } catch {
      }
    }
  }
  // ---- the ridge scatter ---------------------------------------------------------------------------------------
  *scatter() {
    const c = this.c;
    c.halt();
    c.setPhase("scatter");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 96);
    this.rodSeen.clear();
    this.rodLayer = 0;
    for (let t = 0; t < 34; t++) {
      c.setCharge(t / 34 * 18);
      this.scanRods();
      if (t % 5 === 0) sound(c.dim, "basiliskra.iii.charge_tick", c.anchor("plate_tip_4"), 64, 0.8, 1.5 - t * 0.02);
      yield;
    }
    const rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) {
      yield* this.ground(rod);
      return;
    }
    c.setCharge(20);
    c.say("basiliskra.iii.scatter", c.anchor("plate_tip_5"), 112);
    const l = leftOf(c.yaw);
    for (let t = 0; t < 56; t++) {
      const elev = (70 - t / 56 * 58) * Math.PI / 180;
      for (let k = 0; k < 10; k++) {
        if ((t + k) % 2) continue;
        const side = k % 2 ? 1 : -1;
        const from = c.anchor(`plate_tip_${k}`);
        const dir = norm({ x: l.x * side * Math.cos(elev) + c.forward.x * (k - 4.5) * -0.05, y: Math.sin(elev), z: l.z * side * Math.cos(elev) + c.forward.z * (k - 4.5) * -0.05 });
        let length = 26;
        try {
          const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: 26, includeLiquidBlocks: false, includePassableBlocks: false });
          if (hit) length = Math.max(0.5, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })));
        } catch {
          length = 4;
        }
        particle(c.dim, "basiliskra:beam_core", from, 96, beamVars(dir, length, 0.22));
        if (t % 5 === 0) {
          for (const p of nearbyPlayers(c, 34)) {
            if (segDist(add(p.location, { x: 0, y: 0.9, z: 0 }), from, dir, length) <= 0.75) c.hurt(p, 4);
          }
        }
      }
      yield;
    }
    this.rec.mut.lastEncounter = this.now;
    yield* this.vent();
    this.recoverUntil = this.now + 8 * TICKS.second;
  }
};

// src/ending.ts
var NOTE = "minecraft:noteblock";
var NOTE_REACH = 24;
var GAP_MIN = 11;
var GAP_MAX = 26;
var ROD_NEAR_SEAM = 48;
var GRACE = 60;
function holdsFin(p) {
  try {
    return p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId === FIN_ITEM;
  } catch {
    return false;
  }
}
function carriesFin(p) {
  try {
    const inv = p.getComponent("minecraft:inventory")?.container;
    if (!inv) return false;
    for (let i = 0; i < inv.size; i++) if (inv.getItem(i)?.typeId === FIN_ITEM) return true;
  } catch {
  }
  return false;
}
var Ending = class {
  constructor(ctl2) {
    this.ctl = ctl2;
    /** Note blocks near the seam, by position.  Entries stay until the block is seen to be gone. */
    this.blocks = /* @__PURE__ */ new Map();
    this.powered = /* @__PURE__ */ new Map();
    this.scanAt = 0;
    this.lastNote = -9999;
    this.streak = 0;
    this.aliveUntil = -9999;
    this.act = null;
    this.coolUntil = 0;
    this.finNext = /* @__PURE__ */ new Map();
    this.faltered = 0;
  }
  get rhythm() {
    return store.rec.clock <= this.aliveUntil;
  }
  reset() {
    if (this.act) {
      try {
        this.act.return();
      } catch {
      }
    }
    this.act = null;
    if (this.ctl.creature) this.ctl.creature.wade = false;
    if (store.rec.ending) {
      store.rec.ending = null;
      store.touch();
    }
  }
  /** A note sounded near the seam (a player's hand or a redstone pulse). */
  onNote(at) {
    const rift = store.rec.rift;
    if (!rift || distXZ(at, rift) > NOTE_REACH) return;
    const k = `${Math.floor(at.x)},${Math.floor(at.y)},${Math.floor(at.z)}`;
    if (!this.blocks.has(k) && this.blocks.size < 32) this.blocks.set(k, { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) });
    const now = store.rec.clock;
    const gap = now - this.lastNote;
    if (gap < 4) return;
    this.streak = gap >= GAP_MIN && gap <= GAP_MAX ? this.streak + 1 : 1;
    this.lastNote = now;
    if (this.streak >= 3) this.aliveUntil = now + GAP_MAX + 14;
  }
  // ---- every tick, whether or not he is loaded ----------------------------------------------
  tick(c) {
    const rec = store.rec, now = store.rec.clock;
    const rift = rec.rift;
    if (rec.stage !== "alive" || !rift) return;
    const dim = overworld();
    if (now % 5 === 0) {
      for (const p of players()) {
        let pl;
        try {
          if (p.dimension.id !== dim.id) continue;
          pl = p.location;
        } catch {
          continue;
        }
        if (!holdsFin(p)) {
          this.finNext.delete(p.id);
          continue;
        }
        if ((this.finNext.get(p.id) ?? 0) > now) continue;
        const d = dist(pl, rift);
        this.finNext.set(p.id, now + Math.round(clamp(8 + d * 0.3, 8, 70)));
        const eye = p.getHeadLocation();
        const to = norm(sub(rift, eye));
        try {
          p.playSound("basiliskra.fin_pulse", { volume: clamp(1.2 - d / 160, 0.35, 1) });
          p.spawnParticle("basiliskra:fin_spark", add(eye, mul(to, 1.3)));
        } catch {
        }
      }
    }
    if (now % 100 === 0 && rec.form >= 2 && rec.beach && now - rec.learned.fragmentAt > 10 * TICKS.minute) {
      for (const p of players()) {
        try {
          if (p.dimension.id === dim.id && dist(p.location, rec.beach) < 7 && !carriesFin(p) && isLoaded(dim, rec.beach)) {
            const lying = dim.getEntities({ location: rec.beach, maxDistance: 10, type: "minecraft:item" }).some((e) => {
              try {
                return e.getComponent("minecraft:item")?.itemStack.typeId === FIN_ITEM;
              } catch {
                return false;
              }
            });
            if (!lying) this.ctl.dropFin(dim, rec.beach);
            else {
              rec.learned.fragmentAt = now;
            }
            break;
          }
        } catch {
        }
      }
    }
    if (rec.form !== 3) return;
    const someone = players().some((p) => {
      try {
        return p.dimension.id === dim.id && distXZ(p.location, rift) < 40;
      } catch {
        return false;
      }
    });
    if (!someone || !isLoaded(dim, rift)) return;
    const cyc = now % 140;
    if (cyc === 0 || cyc === KNOCK_GAP_TICKS || cyc === KNOCK_GAP_TICKS * 2) {
      particle(dim, "basiliskra:seam_pulse", { x: rift.x, y: rift.y + 5, z: rift.z }, 40);
      if (!this.rhythm) sound(dim, "basiliskra.knock.gill", rift, 24, 0.35);
    }
    const SIDE = NOTE_REACH * 2 + 1, LAYERS = 19, y0 = Math.floor(rift.y) - 1;
    for (let n = 0; n < 60; n++) {
      const i = this.scanAt++ % (SIDE * SIDE * LAYERS);
      const x = Math.floor(rift.x) - NOTE_REACH + i % SIDE, z = Math.floor(rift.z) - NOTE_REACH + Math.floor(i / SIDE) % SIDE, y = y0 + Math.floor(i / (SIDE * SIDE));
      if (this.blocks.size < 32 && idAt(dim, { x, y, z }) === NOTE) this.blocks.set(`${x},${y},${z}`, { x, y, z });
    }
    for (const [k, b] of this.blocks) {
      const blk = blockAt(dim, b);
      if (!blk) continue;
      if (blk.typeId !== NOTE) {
        this.blocks.delete(k);
        this.powered.delete(k);
        continue;
      }
      let on = false;
      try {
        on = (blk.getRedstonePower() ?? 0) > 0;
      } catch {
        on = false;
      }
      if (on && !this.powered.get(k)) this.onNote(b);
      this.powered.set(k, on);
    }
  }
  // ---- taking over the animal ------------------------------------------------------------------
  /** Returns true while the ending is driving him (the ordinary encounters are suspended). */
  drive(c) {
    const rec = store.rec, now = store.rec.clock;
    if (rec.form !== 3 || !rec.rift) return false;
    if (!this.act) {
      if (!this.rhythm || now < this.coolUntil || distXZ(c.pos, rec.rift) > 130) return false;
      const brain = this.ctl.brain;
      if (!(brain instanceof BrainThree)) return false;
      brain.finish();
      rec.ending = { step: 1, t0: now, tries: rec.ending?.tries ?? 0 };
      store.touch();
      this.act = this.sequence(c, brain);
    }
    c.wade = true;
    let done = true;
    try {
      done = this.act.next().done === true;
    } catch (e) {
      done = true;
      console.warn(`[basiliskra] crossing: ${e}`);
    }
    if (done) {
      this.act = null;
      c.wade = false;
      if (store.rec.stage === "alive") {
        c.set(PROP.visHi, 8);
        c.setPhase("idle");
        c.halt();
        if (store.rec.ending && store.rec.ending.step !== 0) {
          store.rec.ending = null;
          store.touch();
        }
      }
    }
    return true;
  }
  holding() {
    this.faltered = this.rhythm ? 0 : this.faltered + 1;
    return this.faltered <= GRACE;
  }
  *sequence(c, brain) {
    const rec = store.rec, rift = rec.rift, dim = c.dim;
    const seam = (t2) => {
      if (t2 % 4 === 0) particle(dim, "basiliskra:seam", rift, 96);
      if (t2 % 60 === 0) sound(dim, "basiliskra.rift.hum", rift, 64);
    };
    this.faltered = 0;
    const surface = rift.y + 5.5;
    let u = norm({ x: c.pos.x - rift.x, y: 0, z: c.pos.z - rift.z });
    if (!u.x && !u.z) u = { x: 1, y: 0, z: 0 };
    let shore = 8, found = 1e9;
    const toHim = u;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, d0 = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      for (let d = 8; d <= 64 && d < found + 6; d += 2) {
        const g2 = blockAt(dim, { x: rift.x + d0.x * d, y: surface - 4.5, z: rift.z + d0.z * d });
        if (!g2 || !isSolidBlock(g2) || isPlantBlock(g2.typeId)) continue;
        const cost = d - 5 * dot(d0, toHim);
        if (cost < found) {
          found = cost;
          shore = d;
          u = d0;
        }
        break;
      }
    }
    const out = (d) => ({ x: rift.x + u.x * d, y: c.pos.y, z: rift.z + u.z * d });
    for (const [d, arrive] of [[shore + 2, 5], [shore + 24, 2.5]]) {
      const walk = brain.walk(out(d), 0.15, arrive, 2400);
      for (; ; ) {
        if (!this.holding()) return;
        if (walk.next().done) break;
        yield;
      }
    }
    brain.groundedAt = null;
    const charge = brain.beam(null);
    for (; ; ) {
      this.holding();
      if (charge.next().done) break;
      yield;
    }
    const g = brain.groundedAt;
    if (!g || distXZ(g.rod, rift) > ROD_NEAR_SEAM || !this.holding()) {
      this.coolUntil = store.rec.clock + 20 * TICKS.second;
      return;
    }
    rec.ending = { step: 3, t0: store.rec.clock, tries: rec.ending?.tries ?? 0 };
    store.save();
    sound(dim, "basiliskra.rift.open", rift, 96);
    let t = 0;
    const near = brain.walk(out(3), 0.14, 4, 1400);
    for (; ; ) {
      seam(t++);
      if (!this.holding()) {
        yield* this.backAway(c, null);
        return;
      }
      if (near.next().done) break;
      yield;
    }
    const back = brain.walk(out(25.5), 0.13, 1.5, 900);
    for (; ; ) {
      seam(t++);
      if (!this.holding()) {
        yield* this.backAway(c, null);
        return;
      }
      if (back.next().done) break;
      yield;
    }
    c.setPhase("crossing");
    for (let i = 0; i < 70; i++) {
      seam(t++);
      if (!this.holding()) {
        yield* this.backAway(c, null);
        return;
      }
      if (i % 10 === 0) particle(dim, "basiliskra:arc_seg", c.anchor("tail_notch"), 64);
      yield;
    }
    const turn = brain.walk(out(54), 0.14, 5, 1200);
    for (; ; ) {
      seam(t++);
      if (!this.holding()) {
        yield* this.backAway(c, null);
        return;
      }
      if (turn.next().done) break;
      yield;
    }
    const travel3 = mul(u, -1);
    const yaw = yawTo({ x: 0, y: 0, z: 0 }, travel3);
    c.setPhase("depart");
    c.goTo(out(-70), 0.13, 2);
    sound(dim, "basiliskra.iii.growl", c.anchor("nose"), 72);
    for (let i = 0; i < 3e3; i++) {
      seam(t++);
      const hi = this.visibleUpTo(c, rift, travel3);
      c.set(PROP.visHi, hi);
      if (hi < 0) break;
      if (!this.holding()) {
        yield* this.backAway(c, travel3);
        return;
      }
      if (hi < 8) {
        c.pos = add(c.pos, mul(travel3, 0.13));
        c.yaw = yaw;
        c.halt();
      }
      yield;
    }
    if (this.visibleUpTo(c, rift, travel3) >= 0) {
      yield* this.backAway(c, travel3);
      return;
    }
    sound(dim, "basiliskra.crossing", rift, 96);
    sound(dim, "basiliskra.rift.close", rift, 96);
    particle(dim, "basiliskra:seam_close", rift, 96);
    this.ctl.retire();
  }
  /** Highest zone still on this side of the seam (-1: the tail has cleared). */
  visibleUpTo(c, rift, travel3) {
    const zones = RIGS[c.form].zones;
    let hi = 8;
    for (let z = 8; z >= 0; z--) {
      const bones = zones[String(z)];
      if (!bones || !bones.length) continue;
      const p = c.point(bones[0], RIGS[c.form].bones[bones[0]].pivot);
      if (dot(sub(p, rift), travel3) > 0) hi = z - 1;
      else break;
    }
    return hi;
  }
  /** Interrupted: he backs out of the seam, it closes, and another attempt is allowed. */
  *backAway(c, travel3) {
    const rec = store.rec, rift = rec.rift;
    c.halt();
    if (travel3) {
      for (let i = 0; i < 220; i++) {
        const to = add(c.pos, mul(travel3, -0.12));
        if (!c.roomAt(to)) break;
        c.pos = to;
        const hi = this.visibleUpTo(c, rift, travel3);
        c.set(PROP.visHi, hi);
        if (hi >= 8 && i > 20) break;
        yield;
      }
    }
    c.set(PROP.visHi, 8);
    sound(c.dim, "basiliskra.rift.close", rift, 96);
    particle(c.dim, "basiliskra:seam_close", rift, 96);
    this.coolUntil = store.rec.clock + 30 * TICKS.second;
    rec.ending = { step: 0, t0: store.rec.clock, tries: (rec.ending?.tries ?? 0) + 1 };
    store.save();
    this.aliveUntil = -9999;
    this.streak = 0;
  }
};

// src/forms/one.ts
import { world as world6 } from "@minecraft/server";
function boatOf(p) {
  try {
    const r = p.getComponent("minecraft:riding");
    const e = r?.entityRidingOn;
    return e && e.typeId.includes("boat") ? e : void 0;
  } catch {
    return void 0;
  }
}
var BrainOne = class extends Brain {
  constructor() {
    super(...arguments);
    this.splash = null;
    this.lure = null;
    this.quietSince = 0;
  }
  onFinish() {
    this.c.swimDepth = 7;
    this.c.set(PROP.gill, this.rec.mut.surfacings > 0 || this.rec.born > 0);
  }
  interrupt() {
    if (this.lure && this.actName !== "lure" && this.actName !== "beach") {
      const at = this.lure;
      this.lure = null;
      return { name: "lure", run: this.investigate(at), limit: 30 * TICKS.second };
    }
    return null;
  }
  choose() {
    const c = this.c, now = this.now, rec = this.rec;
    const tod = world6.getTimeOfDay();
    const p = Math.max(0.25, 1 / Math.max(0.1, 1));
    if (!rec.evolve && rec.mut.surfacings >= 6 && rec.mut.episodes >= 3 && now - rec.mut.formSince >= pace(2 * TICKS.day) && anyoneNear(c, 96) && this.ready("beach")) {
      this.rest("beach", 2 * TICKS.minute);
      return { name: "beach", run: this.beach(), limit: 3 * TICKS.minute };
    }
    const near = nearbyPlayers(c, 64);
    for (const pl of near) {
      const boat = boatOf(pl);
      if (boat && this.ready("boat:" + pl.id) && this.ready("boat")) {
        this.rest("boat:" + pl.id, 100 * TICKS.second);
        this.rest("boat", 40 * TICKS.second);
        return { name: "boat", run: this.beneathBoat(pl, boat), limit: 70 * TICKS.second };
      }
      let wet = false;
      try {
        wet = pl.isInWater && !boat;
      } catch {
        wet = false;
      }
      if (wet && dist(pl.location, c.pos) < 30 && this.ready("knock")) {
        this.rest("knock", 2 * TICKS.minute);
        return { name: "knock", run: this.gillKnocks(), limit: 40 * TICKS.second };
      }
    }
    if (this.ready("echo")) {
      for (const s of rec.sites) {
        const key = `${s.x},${s.z}`;
        if (distXZ(s, c.pos) < 72 && (rec.learned.echoes[key] ?? -1e9) + pace(3 * TICKS.day) < now) {
          rec.learned.echoes[key] = now;
          this.rest("echo", 5 * TICKS.minute);
          return { name: "echo", run: this.drownedEcho(s), limit: 2 * TICKS.minute };
        }
      }
    }
    if (isNight(tod) && rec.rift && now - this.hurtAt > 2 * TICKS.minute && this.ready("sleep") && isLoaded(c.dim, rec.rift) && distXZ(rec.rift, c.pos) < 120) {
      this.rest("sleep", TICKS.day);
      return { name: "sleep", run: this.sleepAtSeam(), limit: 10 * TICKS.minute };
    }
    if (near.length && this.ready("harbor") && (isNight(tod) || tod > 11500)) {
      const pier = this.findPier(near[0].location);
      const at = pier ?? this.openWater(near[0].location, 10, 24, 5);
      if (at) {
        this.rest("harbor", (pier ? 4 : 6) * TICKS.minute);
        return { name: "harbor", run: this.underHarbor(pier ?? { x: at.x, y: at.y + 1, z: at.z }), limit: 2 * TICKS.minute };
      }
    }
    return { name: "patrol", run: this.patrol(), limit: 40 * TICKS.second };
  }
  // ---- finding water ------------------------------------------------------------------------
  openWater(from, minDist, maxDist, salt) {
    const c = this.c;
    for (let i = 0; i < 10; i++) {
      const a = hash(this.now, salt, i) * Math.PI * 2;
      const r = minDist + hash(this.now, salt, i, 7) * (maxDist - minDist);
      const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
      const col = waterColumn(c.dim, x, z, c.pos.y + 3, 12);
      if (col !== NONE && col !== UNLOADED && col.surface - col.floor >= 5) return { x, y: col.surface - 6, z };
    }
    return null;
  }
  /** Follow the bank: if rock is close on one side, slide the goal away from it. */
  bankNudge() {
    const c = this.c;
    const l = leftOf(c.yaw);
    for (const side of [1, -1]) {
      const probe = add(add(c.pos, mul(l, side * 5)), { x: 0, y: 2, z: 0 });
      if (isSolidBlock(blockAt(c.dim, probe)) && c.goal) {
        c.goal = add(c.goal, mul(l, -side * 0.6));
        if (c.tick % 9 === 0) particle(c.dim, "basiliskra:silt_puff", c.anchor(side > 0 ? "fin_l" : "fin_r"), 32);
      }
    }
  }
  *patrol() {
    const c = this.c;
    const near = nearbyPlayers(c, 96);
    const focus = near.length ? near[0].location : this.rec.rift ?? c.pos;
    const target = this.openWater(focus, 14, 34, 1) ?? this.openWater(c.pos, 8, 24, 2);
    if (!target) {
      yield* wait(40);
      return;
    }
    c.setPhase("move");
    c.goTo(target, 0.2, 3);
    let t = 0;
    while (!c.arrived() && t++ < 500) {
      this.bankNudge();
      if (c.blocked > 24) {
        const headWet = isWaterId(idAt(c.dim, add(c.pos, mul(c.forward, 8))));
        if (headWet && c.blockedWhy !== "unloaded") {
          yield* this.jam();
        }
        break;
      }
      if (c.tick % 70 === 0) c.say(`basiliskra.i.${c.tick % 140 === 0 ? "breath" : "swim"}`, c.pos, 40, 0.8);
      yield;
    }
    c.setPhase("idle");
    yield* wait(30 + Math.floor(hash(this.now, 3) * 60));
  }
  *jam() {
    const c = this.c;
    c.halt();
    c.setPhase("jam");
    c.say("basiliskra.i.jam", c.anchor("back"), 48);
    for (let i = 0; i < 44; i++) {
      if (i % 8 === 0) particle(c.dim, "basiliskra:silt_puff", c.anchor(i % 16 === 0 ? "gill_l" : "gill_r"), 32);
      yield;
    }
    const step = mul(c.forward, -0.15);
    for (let i = 0; i < 60; i++) {
      const to = add(c.pos, step), tail = add(to, mul(c.forward, -6));
      if (!isWaterId(idAt(c.dim, { x: to.x, y: to.y + 1, z: to.z })) || !isWaterId(idAt(c.dim, { x: tail.x, y: to.y + 1, z: tail.z }))) break;
      c.pos = to;
      yield;
    }
    c.blocked = 0;
  }
  // ---- beneath the boat -----------------------------------------------------------------------
  *beneathBoat(pl, boat) {
    const c = this.c;
    const ok = () => {
      try {
        return pl.isValid && boat.isValid && targetable(pl) && pl.dimension.id === c.dim.id && boatOf(pl)?.id === boat.id;
      } catch {
        return false;
      }
    };
    c.setPhase("move");
    c.swimDepth = 7.5;
    for (let t = 0; t < 400 && ok(); t++) {
      const b = boat.location;
      if (distXZ(b, c.pos) < 7) break;
      c.goTo(b, 0.42, 5);
      yield;
    }
    if (!ok()) return;
    for (let t = 0; t < 150 && ok(); t++) {
      const b = boat.location, v = boat.getVelocity();
      const lead = add(b, mul({ x: v.x, y: 0, z: v.z }, 12));
      c.goTo(lead, clamp(Math.hypot(v.x, v.z) + 0.03, 0.06, 0.5), 1.2);
      if (t % 4 === 0) {
        const col = waterColumn(c.dim, c.pos.x, c.pos.z, c.pos.y + 3, 12);
        if (col !== NONE && col !== UNLOADED) {
          const side = mul(leftOf(c.yaw), Math.sin(t * 0.09) * 2.4 + 1.6);
          particle(c.dim, "basiliskra:bubble_trail", { x: c.pos.x + side.x, y: col.surface - 0.1, z: c.pos.z + side.z }, 40);
        }
      }
      yield;
    }
    if (!ok()) return;
    c.setPhase("rise");
    c.swimDepth = 4.5;
    c.say("basiliskra.i.surface", c.anchor("back"), 56);
    this.rec.mut.surfacings++;
    this.rec.mut.lastEncounter = this.now;
    for (let t = 0; t < 110 && ok(); t++) {
      const b = boat.location, v = boat.getVelocity();
      c.goTo(add(b, mul({ x: v.x, y: 0, z: v.z }, 10)), clamp(Math.hypot(v.x, v.z) + 0.02, 0.05, 0.5), 1);
      c.lookAt(pl.getHeadLocation(), 40, 30);
      if (t > 40 && t < 64 && dist(c.anchor("back"), b) < 3.2) {
        try {
          boat.applyImpulse({ x: 0, y: 0.05, z: 0 });
        } catch {
        }
      }
      if (t % 10 === 0) particle(c.dim, "basiliskra:fin_break", { ...c.anchor("spine_2"), y: b.y }, 40);
      yield;
    }
    if (!ok()) return;
    c.setPhase("move");
    c.lookAhead();
    c.swimDepth = 6.5;
    const away = add(c.pos, mul(c.forward, 16));
    c.goTo(away, 0.5, 3);
    for (let t = 0; t < 70 && !c.arrived(); t++) yield;
    for (let t = 0; t < 260 && ok(); t++) {
      const b = boat.location, v = boat.getVelocity();
      c.swimDepth = 3.4;
      c.goTo(add(b, mul({ x: v.x, y: 0, z: v.z }, 8)), 0.52, 1);
      if (dist(c.anchor("muzzle"), b) < 6) {
        c.setPhase("bite");
        c.say("basiliskra.i.bite", c.anchor("mouth"), 48);
        yield* wait(5);
        if (ok() && dist(c.anchor("mouth"), boat.location) < 2.8) {
          c.hurt(pl, 9);
          try {
            boat.applyImpulse(mul(norm(sub(boat.location, c.anchor("mouth"))), 0.5));
          } catch {
          }
        }
        yield* wait(14);
        break;
      }
      yield;
    }
  }
  // ---- three gill knocks ------------------------------------------------------------------------
  *knocks(sfx) {
    const c = this.c;
    for (let k = 0; k < 3; k++) {
      const g = c.anchor("gill_l");
      c.say(sfx, g, 56, 1, 1 - k * 0.03);
      particle(c.dim, "basiliskra:silt_ring", g, 48);
      c.pulse(1);
      yield* wait(KNOCK_GAP_TICKS);
    }
  }
  *gillKnocks() {
    const c = this.c;
    c.swimDepth = 64;
    c.halt();
    yield* wait(50);
    c.setPhase("knock");
    c.set(PROP.gill, true);
    yield* wait(2);
    yield* this.knocks("basiliskra.knock.gill");
    const g = c.anchor("gill_l");
    c.say("basiliskra.i.pull", g, 40);
    for (let t = 0; t < 24; t++) {
      if (t % 3 === 0) {
        for (const e of c.dim.getEntities({ location: g, maxDistance: 11, excludeTypes: ["basiliskra:basiliskra", "basiliskra:hitbox"] })) {
          let pull = false;
          try {
            pull = e.typeId === "minecraft:item" || e.typeId === "minecraft:player" && e.isInWater && targetable(e);
          } catch {
            pull = false;
          }
          if (!pull) continue;
          const at = e.typeId === "minecraft:player" ? e.getHeadLocation() : e.location;
          if (!clearLine(c.dim, g, at)) continue;
          const d = norm(sub(g, at));
          try {
            if (e.typeId === "minecraft:player") e.applyKnockback({ x: d.x * 0.42, z: d.z * 0.42 }, d.y * 0.2);
            else e.applyImpulse(mul(d, 0.14));
          } catch {
          }
        }
      }
      yield;
    }
    particle(c.dim, "basiliskra:gravel_cloud", g, 48);
    c.setPhase("idle");
    yield* wait(40);
  }
  // ---- the drowned echo ---------------------------------------------------------------------------
  *drownedEcho(site) {
    const c = this.c;
    const col = waterColumn(c.dim, site.x, site.z, site.y, 8);
    let at = col !== NONE && col !== UNLOADED ? { x: site.x + 0.5, y: col.surface - 1, z: site.z + 0.5 } : null;
    if (!at) {
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6], [6, -6], [-6, 6]]) {
        const cc = waterColumn(c.dim, site.x + dx, site.z + dz, site.y, 8);
        if (cc !== NONE && cc !== UNLOADED) {
          at = { x: site.x + dx, y: cc.surface - 1, z: site.z + dz };
          break;
        }
      }
    }
    if (!at) return;
    for (const p of nearbyPlayers(c, 64)) {
      try {
        const ear = p.getHeadLocation(), d = dist(ear, at);
        if (d > 48) continue;
        const from = d <= 10 ? at : add(ear, mul(norm(sub(at, ear)), 10));
        p.playSound(site.s, { location: from, volume: clamp(1.1 - d / 60, 0.35, 0.9), pitch: 0.72 });
      } catch {
      }
    }
    c.halt();
    for (let t = 0; t < 46; t++) {
      c.lookAt(at, 70, 25);
      yield;
    }
    c.setPhase("move");
    c.swimDepth = 5;
    yield* travel(c, at, 0.24, 5, 700);
    c.lookAhead();
    c.setPhase("idle");
    yield* wait(70);
    sound(c.dim, site.s, at, 24, 0.45, 0.66);
    yield* wait(80);
  }
  // ---- the second splash ----------------------------------------------------------------------------
  onSplash(at, _by) {
    const c = this.c;
    if (dist(at, c.pos) > 56) return;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 80 && dist(prev.at, at) <= 6 && this.rec.learned.lureUntil <= this.now) {
      this.lure = at;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(30 * TICKS.second + Math.min(this.rec.learned.lures, 8) * 15 * TICKS.second);
      this.splash = null;
    } else {
      this.splash = { at, t: this.now };
      if (this.actName === "patrol" || this.actName === "none") c.lookAt(at, 60, 20);
    }
  }
  *investigate(at) {
    const c = this.c;
    c.setPhase("move");
    c.swimDepth = 5;
    c.lookAt(at, 60, 20);
    yield* travel(c, at, 0.3, 7, 500);
    c.lookAhead();
    c.setPhase("sweep");
    c.say("basiliskra.i.sweep", c.anchor("tail_tip"), 56);
    for (let t = 0; t < 34; t++) {
      if (t === 12 || t === 16) {
        const tail = c.anchor("tail_tip");
        particle(c.dim, "basiliskra:fin_break", tail, 40);
        for (const p of nearbyPlayers(c, 48)) {
          if (dist(p.location, tail) < 4.6 && clearLine(c.dim, tail, add(p.location, { x: 0, y: 0.9, z: 0 })) && c.hurt(p, 5)) {
            const d = norm(sub(p.location, tail));
            try {
              p.applyKnockback({ x: d.x * 1.4, z: d.z * 1.4 }, 0.5);
            } catch {
            }
          }
        }
        for (const e of c.dim.getEntities({ location: tail, maxDistance: 5, families: ["boat"] })) {
          try {
            e.applyImpulse(mul(norm(sub(e.location, tail)), 0.6));
          } catch {
          }
        }
      }
      yield;
    }
    c.setPhase("idle");
    yield* wait(60);
  }
  // ---- under the harbour -------------------------------------------------------------------------------
  findPier(around) {
    const c = this.c;
    for (let i = 0; i < 20; i++) {
      const x = Math.floor(around.x + (hash(this.now, i, 11) - 0.5) * 44);
      const z = Math.floor(around.z + (hash(this.now, i, 13) - 0.5) * 44);
      const col = waterColumn(c.dim, x, z, around.y - 1, 8);
      if (col === NONE || col === UNLOADED || col.surface - col.floor < 5) continue;
      for (let dy = 0; dy <= 2; dy++) {
        const id = idAt(c.dim, { x, y: col.surface + dy, z }) ?? "";
        if (/planks|_slab|_stairs|fence|_log|trapdoor/.test(id)) return { x: x + 0.5, y: col.surface - 5, z: z + 0.5 };
      }
    }
    return null;
  }
  *underHarbor(pier) {
    const c = this.c;
    c.setPhase("move");
    c.swimDepth = 5.2;
    if (!(yield* travel(c, pier, 0.2, 3, 700))) return;
    c.setPhase("idle");
    yield* wait(200 + Math.floor(hash(this.now, 17) * 160));
    c.setPhase("spasm");
    c.say("basiliskra.i.spasm", c.anchor("back"), 56);
    this.rec.mut.episodes++;
    this.rec.mut.surfacings++;
    this.rec.mut.lastEncounter = this.now;
    const col = waterColumn(c.dim, c.pos.x, c.pos.z, c.pos.y + 3, 12);
    const surface = col !== NONE && col !== UNLOADED ? col.surface : c.pos.y + 5;
    for (let t = 0; t < 84; t++) {
      const k = Math.floor((t - 6) / 7);
      if (t >= 6 && (t - 6) % 7 === 0 && k <= 10) {
        const s = c.anchor(`spine_${k}`);
        particle(c.dim, "basiliskra:fin_break", { x: s.x, y: surface + 0.05, z: s.z }, 48);
        if (k % 3 === 0) c.say("basiliskra.splash", { x: s.x, y: surface, z: s.z }, 24, 0.6, 0.8);
      }
      yield;
    }
    c.setPhase("idle");
    yield* wait(200);
  }
  // ---- sleeping at the seam --------------------------------------------------------------------------------
  *sleepAtSeam() {
    const c = this.c, rift = this.rec.rift;
    c.setPhase("move");
    c.swimDepth = 64;
    const side = add(rift, mul(leftOf(rift.yaw), -9));
    if (!(yield* travel(c, side, 0.18, 4, 1200))) return;
    c.halt();
    c.bendHold = 19;
    c.setPhase("sleep");
    let t = 0;
    while (isNight(world6.getTimeOfDay()) && t++ < 9e3) {
      const head = c.anchor("muzzle");
      let woke = this.now - this.hurtAt < 40;
      for (const p of nearbyPlayers(c, 40)) if (dist(p.location, head) < 7) woke = true;
      if (woke) break;
      if (t % 90 === 0) c.say("basiliskra.i.breath", c.anchor("back"), 32, 0.6, 0.8);
      yield;
    }
    c.setPhase("wake");
    yield* wait(2);
    yield* this.knocks("basiliskra.knock.gill");
    c.bendHold = 0;
    yield* wait(40);
  }
  // ---- the first claws ----------------------------------------------------------------------------------------
  findShelf() {
    const c = this.c;
    let best = null, bestD = 1e9;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      let lastWater = null;
      for (let r = 6; r <= 64; r += 2) {
        const x = c.pos.x + Math.cos(a) * r, z = c.pos.z + Math.sin(a) * r;
        const col = waterColumn(c.dim, x, z, c.pos.y + 4, 14);
        if (col === UNLOADED) break;
        if (col !== NONE) {
          lastWater = { x, y: col.surface - 3, z };
          continue;
        }
        if (!lastWater) break;
        for (let y = Math.floor(lastWater.y + 6); y >= Math.floor(lastWater.y); y--) {
          const id = idAt(c.dim, { x, y, z });
          if (!id || id === "minecraft:air") continue;
          if (/^minecraft:(sand|gravel|red_sand|clay|dirt|grass_block|coarse_dirt|mud|stone)$/.test(id) && r < bestD) {
            bestD = r;
            best = { water: lastWater, shore: { x, y: y + 1, z } };
          }
          break;
        }
        break;
      }
    }
    return best;
  }
  *beach() {
    const c = this.c;
    const shelf = this.findShelf();
    if (!shelf) return;
    c.setPhase("move");
    c.swimDepth = 3.6;
    yield* travel(c, shelf.water, 0.22, 5, 1600);
    if (distXZ(c.pos, shelf.water) > 12) return;
    c.halt();
    c.setPhase("beach");
    c.say("basiliskra.i.surface", c.pos, 64);
    const from = { ...c.pos };
    const to = add(shelf.shore, mul(norm({ x: shelf.shore.x - shelf.water.x, y: 0, z: shelf.shore.z - shelf.water.z }), 5));
    c.yaw = yawTo(from, to);
    for (let t = 0; t <= 80; t++) {
      const k = t / 80;
      c.pos = { x: from.x + (to.x - from.x) * k, y: from.y + (shelf.shore.y - from.y) * Math.min(1, k * 1.3), z: from.z + (to.z - from.z) * k };
      yield;
    }
    this.rec.evolve = { to: 2, step: 0, t0: this.now, at: { ...c.pos } };
    this.rec.beach = { x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) };
    yield* wait(600);
  }
};

// src/forms/two.ts
import { world as world7 } from "@minecraft/server";
var LAMP = /^minecraft:((lit_)?redstone_lamp|(soul_)?lantern|.*copper_lantern|sea_lantern|glowstone|.*copper_bulb|(soul_|redstone_|copper_)?torch|shroomlight|.*froglight)$/;
var STONE = /^minecraft:(stone|cobblestone|mossy_cobblestone|stone_bricks|andesite|diorite|granite|deepslate|tuff|.*_slab|stone_.*|polished_.*|smooth_stone|gravel)$/;
var BrainTwo = class extends Brain {
  constructor() {
    super(...arguments);
    this.lure = null;
    this.splash = null;
    this.startle = null;
    this.otherSound = 0;
    this.lamps = [];
    this.lampsAt = -9999;
    this.gaitStep = 2;
  }
  onFinish() {
    this.c.set(PROP.gait, this.gaitStep === 5 ? 5 : 2);
  }
  interrupt() {
    if (this.startle && this.actName !== "flinch") {
      const from = this.startle;
      this.startle = null;
      return { name: "flinch", run: this.flinch(from), limit: 20 * TICKS.second };
    }
    if (this.lure && (this.actName === "well" || this.actName === "wander" || this.actName === "pin")) {
      const at = this.lure;
      this.lure = null;
      return { name: "lure", run: this.toLure(at), limit: 50 * TICKS.second };
    }
    return null;
  }
  choose() {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world7.getTimeOfDay();
    if (!rec.evolve && rec.mut.overland >= 220 / CONFIG.pacing && now - rec.mut.formSince >= pace(2 * TICKS.day) && (isNight(tod) || rec.weather !== "clear") && anyoneNear(c, 96)) {
      rec.evolve = { to: 3, step: 0, t0: now, at: { ...c.pos } };
      return { name: "evolve", run: wait(900), limit: 900 };
    }
    if (rec.learned.bell && rec.learned.bellUses >= 4 && this.ready("pin") && distXZ(rec.learned.bell, c.pos) < 56 && isLoaded(c.dim, rec.learned.bell)) {
      this.rest("pin", 6 * TICKS.minute);
      return { name: "pin", run: this.silenceBell(rec.learned.bell), limit: 2 * TICKS.minute };
    }
    if (this.ready("well")) {
      const w = this.findWater();
      if (w) {
        this.rest("well", 4 * TICKS.minute);
        return { name: "well", run: this.well(w), limit: 2 * TICKS.minute };
      }
      this.rest("well", 40 * TICKS.second);
    }
    if (this.ready("arc") && this.onWetStone()) {
      this.rest("arc", TICKS.minute);
      return { name: "arc", run: this.discharge(), limit: 12 * TICKS.second };
    }
    return { name: "wander", run: this.wander(), limit: 90 * TICKS.second };
  }
  // ---- the dragging gait ------------------------------------------------------------------------
  /** Claws hook, elbows pull, hips scrape, the body rests.  The rest is the gap a player can cross. */
  *drag(target, arrive, timeout) {
    const c = this.c;
    const [reach, pull, rest] = GAIT_TICKS;
    let t = 0, stuck = 0;
    c.setPhase("move");
    while (distXZ(c.pos, target) > arrive) {
      if (t > timeout || stuck >= 3) {
        c.halt();
        return false;
      }
      const left = this.gaitStep === 5 || this.gaitStep === 2 ? this.gaitStep === 5 : true;
      const base = this.gaitStep === 5 ? 0 : 3;
      this.gaitStep = base;
      c.set(PROP.gait, base);
      c.halt();
      for (let i = 0; i < reach; i++, t++) {
        c.yaw = wrapDeg(c.yaw + clamp(wrapDeg(yawTo(c.pos, target) - c.yaw), -0.9, 0.9));
        yield;
      }
      const claw = c.anchor(base === 0 ? "claw_l" : "claw_r");
      c.say("basiliskra.ii.claw", claw, 48, 0.9, 0.95 + hash(t) * 0.1);
      particle(c.dim, "basiliskra:grit", claw, 32);
      this.gaitStep = base + 1;
      c.set(PROP.gait, base + 1);
      c.say("basiliskra.ii.drag", c.anchor("hip_l"), 64);
      const before = c.travelled;
      c.goTo(target, 0.095, arrive);
      for (let i = 0; i < pull; i++, t++) {
        if (i % 4 === 0) this.furrow();
        yield;
      }
      c.halt();
      stuck = c.travelled - before < 0.25 ? stuck + 1 : 0;
      this.rec.mut.overland += c.travelled - before;
      this.gaitStep = base + 2;
      c.set(PROP.gait, base + 2);
      c.say("basiliskra.ii.rest", c.pos, 48, 0.8);
      for (let i = 0; i < rest; i++, t++) yield;
      if (t % 5 === 0) c.say("basiliskra.ii.breath", c.anchor("nose"), 40, 0.8);
      this.wetStoneArc();
    }
    c.halt();
    return true;
  }
  /** Two thin furrows behind the hind feet, on natural ground only: floors and builds are left alone. */
  furrow() {
    if (!CONFIG.marks) return;
    const c = this.c;
    for (const side of ["hip_l", "hip_r"]) {
      const p = c.anchor(side);
      const at = { x: Math.floor(p.x), y: Math.floor(c.pos.y - 0.5), z: Math.floor(p.z) };
      const b = takesMark(c.dim, at);
      const to = b ? furrowOf(b.typeId) : void 0;
      if (b && to) {
        try {
          b.setType(to);
        } catch {
        }
      } else if (c.tick % 8 === 0) particle(c.dim, "basiliskra:grit", { x: p.x, y: c.pos.y + 0.1, z: p.z }, 32);
    }
  }
  onWetStone() {
    const c = this.c;
    const k = c.anchor("knob_core");
    const under = idAt(c.dim, { x: k.x, y: c.pos.y - 0.5, z: k.z }) ?? "";
    if (!STONE.test(under)) return false;
    if (this.rec.weather !== "clear") return true;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (isWaterId(idAt(c.dim, { x: k.x + dx, y: c.pos.y, z: k.z + dz }))) return true;
    return false;
  }
  wetStoneArc() {
    const c = this.c;
    if (this.onWetStone() && hash(this.now, 5) < 0.35) {
      c.say("basiliskra.ii.arc", c.anchor("horn_l"), 48, 0.7);
      c.pulse(2);
    }
  }
  *wander() {
    const c = this.c;
    const near = nearbyPlayers(c, 96);
    let target;
    if (near.length) {
      const p = near[0].location;
      const a = hash(this.now, 21) * Math.PI * 2;
      target = { x: p.x + Math.cos(a) * 14, y: p.y, z: p.z + Math.sin(a) * 14 };
      for (const w of witnesses(c.dim, c.pos, 80)) {
        if (dist(w.location, c.pos) > 26 && hash(this.now, 23) < 0.6) {
          try {
            w.playSound("basiliskra.scrape_far", { location: c.pos, volume: 0.9 });
          } catch {
          }
        }
      }
    } else {
      const a = hash(this.now, 25) * Math.PI * 2;
      target = { x: c.pos.x + Math.cos(a) * 18, y: c.pos.y, z: c.pos.z + Math.sin(a) * 18 };
    }
    yield* this.drag(target, 4, 1400);
    c.setPhase("idle");
    yield* wait(120 + Math.floor(hash(this.now, 27) * 200));
  }
  // ---- the village well ---------------------------------------------------------------------------
  /** A reachable water opening with a rim: a village well, else a pond or an irrigation ditch. */
  findWater() {
    const c = this.c;
    let well = null, pond = null, wd = 1e9, pd = 1e9;
    const y0 = Math.floor(c.pos.y);
    for (let i = 0; i < 90; i++) {
      const x = Math.floor(c.pos.x + (hash(this.now, i, 31) - 0.5) * 72);
      const z = Math.floor(c.pos.z + (hash(this.now, i, 33) - 0.5) * 72);
      for (let y = y0 + 3; y >= y0 - 3; y--) {
        if (!isWaterId(idAt(c.dim, { x, y, z }))) continue;
        const above = blockAt(c.dim, { x, y: y + 1, z });
        if (!above || !above.isAir) break;
        const d = Math.hypot(x - c.pos.x, z - c.pos.z);
        if (d < 8) break;
        let water = 0, rim = 0;
        for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
          const id = idAt(c.dim, { x: x + dx, y, z: z + dz });
          if (isWaterId(id)) water++;
          else if (Math.abs(dx) <= 2 && Math.abs(dz) <= 2 && id && id !== "minecraft:air") rim++;
        }
        if (water <= 12 && rim >= 6) {
          if (d < wd) {
            wd = d;
            well = { x: x + 0.5, y, z: z + 0.5 };
          }
        } else if (d < pd) {
          pd = d;
          pond = { x: x + 0.5, y, z: z + 0.5 };
        }
        break;
      }
    }
    return well ?? (pd < 48 ? pond : null);
  }
  *well(at) {
    const c = this.c;
    if (!(yield* this.drag(at, 8.5, 1800))) return;
    c.yaw = yawTo(c.pos, at);
    c.setPhase("drink");
    for (let t = 0; t < 700; t++) {
      if (t % 52 === 0) c.say("basiliskra.ii.drink", c.anchor("muzzle"), 32);
      yield;
    }
  }
  *toLure(at) {
    const c = this.c;
    c.setPhase("idle");
    for (let t = 0; t < 24; t++) {
      c.lookAt(at, 70, 20);
      yield;
    }
    c.lookAhead();
    yield* this.drag(at, 6, 900);
    c.setPhase("idle");
    yield* wait(100);
  }
  onSplash(at, _by) {
    const c = this.c;
    if (dist(at, c.pos) > 40) return;
    this.otherSound = this.now;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 100 && dist(prev.at, at) <= 6 && this.rec.learned.lureUntil <= this.now) {
      this.lure = at;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(40 * TICKS.second);
      this.splash = null;
    } else this.splash = { at, t: this.now };
  }
  // ---- the first discharge -----------------------------------------------------------------------------
  *discharge() {
    const c = this.c;
    c.halt();
    c.setPhase("arc");
    this.rec.mut.episodes++;
    if (this.now - this.lampsAt > 30 * TICKS.second) {
      this.lamps = [];
      this.lampsAt = this.now;
      for (let dy = -1; dy <= 4; dy++) {
        this.scanLamps(dy);
        yield;
      }
    }
    const from = c.anchor("knob_core");
    const lit = this.lamps.map((l) => ({ l, d: dist(l, from) })).sort((a, b) => a.d - b.d);
    for (let t = 0; t < 60; t++) {
      if (t === 2 || t === 14 || t === 27) {
        c.say("basiliskra.ii.arc", c.anchor("horn_l"), 56);
        c.pulse(2);
      }
      for (const { l, d } of lit) {
        if (Math.floor(d * 1.6) + 4 === t) particle(c.dim, "basiliskra:lamp_flare", { x: l.x + 0.5, y: l.y + 0.5, z: l.z + 0.5 }, 48);
      }
      yield;
    }
    c.setPhase("idle");
  }
  /** Lamps along the street (anything a village lights itself with): one layer of a bounded box round the knob. */
  scanLamps(dy) {
    const c = this.c;
    const k = c.anchor("knob_core");
    const y = Math.floor(c.pos.y) + dy;
    for (let dx = -14; dx <= 14; dx += 1) for (let dz = -14; dz <= 14; dz += 1) {
      if (this.lamps.length >= 24) return;
      const id = idAt(c.dim, { x: k.x + dx, y, z: k.z + dz });
      if (id && LAMP.test(id)) this.lamps.push({ x: Math.floor(k.x + dx), y, z: Math.floor(k.z + dz) });
    }
  }
  // ---- the bell ---------------------------------------------------------------------------------------------
  onBell(at, _by) {
    const c = this.c, rec = this.rec;
    if (dist(at, c.pos) > 48) return;
    if (this.actName === "pin") {
      const same = rec.learned.bell && dist(rec.learned.bell, at) < 2;
      if (same) {
        sound(c.dim, "basiliskra.bell_pin", at, 32);
        particle(c.dim, "basiliskra:grit", { x: at.x + 0.5, y: at.y + 0.5, z: at.z + 0.5 }, 24);
      } else this.otherSound = this.now;
      return;
    }
    if (rec.learned.bellUses < 3) {
      rec.learned.bellUses++;
      rec.learned.bell = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
      this.startle = at;
    } else if (rec.learned.bellUses === 3) {
      rec.learned.bellUses = 4;
      rec.learned.bell = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) };
    }
  }
  onNote(_at) {
    this.otherSound = this.now;
  }
  *flinch(from) {
    const c = this.c;
    c.halt();
    c.setPhase("flinch");
    c.say("basiliskra.ii.growl", c.anchor("nose"), 56);
    yield* wait(24);
    const away = add(c.pos, mul(norm({ x: c.pos.x - from.x, y: 0, z: c.pos.z - from.z }), 12));
    yield* this.drag(away, 3, 400);
  }
  /** The nearest door to a place, read a layer a tick. */
  *nearestDoor(around) {
    const c = this.c;
    let best = null, bd = 1e9;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
        const p = { x: around.x + dx, y: around.y + dy, z: around.z + dz };
        const id = idAt(c.dim, p);
        if (id && id.endsWith("_door")) {
          const d = Math.hypot(dx, dz);
          if (d < bd) {
            bd = d;
            best = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
          }
        }
      }
      yield;
    }
    return best;
  }
  *silenceBell(bell) {
    const c = this.c;
    if (idAt(c.dim, bell) !== "minecraft:bell") {
      this.rec.learned.bell = null;
      return;
    }
    if (!(yield* this.drag(bell, 7.5, 1600))) return;
    c.yaw = yawTo(c.pos, bell);
    c.setPhase("pin");
    c.say("basiliskra.ii.claw", { x: bell.x + 0.5, y: bell.y, z: bell.z + 0.5 }, 40);
    const door = yield* this.nearestDoor(bell);
    const began = this.now;
    for (let t = 0; t < 1200; t++) {
      const watch = door ?? nearbyPlayers(c, 40)[0]?.location;
      if (watch) c.lookAt(watch, 70, 20);
      if (this.otherSound > began + 10) break;
      if (t % 80 === 0) c.say("basiliskra.ii.breath", c.anchor("nose"), 40, 0.7);
      yield;
    }
  }
};

// src/controller.ts
var TOKEN = "bk:token";
var SPAWN_STEP = 3;
var WATER_CANDIDATES = 60;
var Controller = class {
  constructor() {
    this.creature = null;
    this.brain = null;
    this.ending = new Ending(this);
    /** How many copied or unauthorised instances have been removed (kept for the test report). */
    this.quarantined = 0;
    this.ticket = null;
    this.runner = null;
    this.missing = 0;
    this.hurtCryAt = -999;
    // ---- pending -> reservation ------------------------------------------------------------------------
    /**
     * Deep water near the site with a clear lane to swim out of the seam and to turn and ram it:
     * every block of a box LANE long, seven wide and his own height deep, from behind where he is
     * created to beyond where he turns.  Nearest places first; the four compass headings, the one
     * facing the shore he was called to before the others.  The reading is spread over ticks (a few
     * hundred blocks at a time) and never goes through an unloaded chunk.
     */
    this.waterSearch = null;
    this.waterWait = 0;
  }
  // ---- start-up ------------------------------------------------------------------------------
  init() {
    store.load();
    this.sweep();
  }
  get now() {
    return store.rec.clock;
  }
  // ---- identity ------------------------------------------------------------------------------
  /** Decide what an entity of our type is: the one Basiliskra, or something to remove at once. */
  inspect(e) {
    let id;
    try {
      if (!e.isValid || e.typeId !== TYPE) return;
      id = e.id;
    } catch {
      return;
    }
    if (this.creature && this.creature.entity.id === id) return;
    if (this.ticket && this.ticket.id === id) return;
    const rec = store.rec;
    const mayExist = rec.stage === "alive" || rec.stage === "arriving";
    if (mayExist && rec.entityId === id) {
      this.adopt(e);
      return;
    }
    if (mayExist && rec.entityId === null && rec.token && !this.creature) {
      let token;
      try {
        token = e.getDynamicProperty(TOKEN);
      } catch {
        token = void 0;
      }
      if (token === rec.token) {
        rec.entityId = id;
        rec.down = null;
        store.save();
        this.adopt(e);
        return;
      }
    }
    this.quarantine(e);
  }
  /** A copy, a stray summon, or anything after his departure: gone before it can act. */
  quarantine(e) {
    try {
      e.setProperty(PROP.bound, false);
    } catch {
    }
    try {
      e.remove();
      this.quarantined++;
    } catch {
    }
  }
  adopt(e) {
    const rec = store.rec;
    try {
      e.setDynamicProperty(TOKEN, rec.token);
      e.triggerEvent(`basiliskra:bind_${rec.form}`);
    } catch {
      return;
    }
    this.nameHim(e);
    const c = new Creature(e);
    c.form = rec.form;
    c.resync();
    c.set(PROP.gill, rec.born > 0);
    c.set(PROP.visLo, 0);
    c.set(PROP.visHi, 8);
    this.creature = c;
    this.brain = this.makeBrain(c);
    this.missing = 0;
    this.runner = null;
    this.ending.reset();
  }
  /** The stage of his life is his name: Basiliskra I, II, III.  It is what a death message says. */
  nameHim(e) {
    try {
      e.nameTag = `Basiliskra ${["I", "II", "III"][store.rec.form - 1]}`;
    } catch {
    }
  }
  makeBrain(c) {
    if (c.form === 3) c.set(PROP.gait, 3);
    return c.form === 1 ? new BrainOne(c) : c.form === 2 ? new BrainTwo(c) : new BrainThree(c);
  }
  /** The only place the entity is ever created.  The reservation is already saved when this runs. */
  create(dim, at, yaw) {
    const rec = store.rec;
    if (this.creature || rec.entityId !== null || !rec.token) return false;
    if (rec.stage !== "arriving" && rec.stage !== "alive") return false;
    if (!isLoaded(dim, at)) return false;
    let e;
    try {
      e = dim.spawnEntity(TYPE, at, { initialRotation: yaw });
    } catch {
      return false;
    }
    this.ticket = e;
    try {
      e.setDynamicProperty(TOKEN, rec.token);
      rec.entityId = e.id;
      rec.down = null;
      store.save();
      this.adopt(e);
    } finally {
      this.ticket = null;
    }
    return this.creature !== null;
  }
  /** Look at every loaded entity of our types.  Bounded: type queries only, a few times a second. */
  sweep() {
    for (const id of [OVERWORLD, "minecraft:nether", "minecraft:the_end"]) {
      let dim;
      try {
        dim = world8.getDimension(id);
      } catch {
        continue;
      }
      let list = [];
      try {
        list = dim.getEntities({ type: TYPE });
      } catch {
        list = [];
      }
      for (const e of list) this.inspect(e);
      try {
        list = dim.getEntities({ type: HITBOX });
      } catch {
        list = [];
      }
      for (const h of list) {
        try {
          if (!partOwner.has(h.id)) h.remove();
        } catch {
        }
      }
    }
  }
  // ---- events from main ------------------------------------------------------------------------
  /** A region crossed the threshold.  Only the first request ever becomes a reservation. */
  requestArrival(t) {
    const rec = store.rec;
    const stale = rec.stage === "pending" && rec.pending !== null && (rec.pending.passes ?? 0) >= 1 && rec.pending.region !== t.region;
    if (rec.stage !== "dormant" && !stale) return false;
    this.waterSearch = null;
    this.waterWait = 0;
    rec.stage = "pending";
    rec.pending = { site: { x: Math.floor(t.site.x), y: Math.floor(t.site.y), z: Math.floor(t.site.z) }, since: this.now, region: t.region };
    rec.origin = rec.pending.site;
    rec.guilty = t.guilty;
    rec.guiltyName = t.guiltyName;
    store.save();
    return true;
  }
  /** Called while the entity can still be read, for an unload as much as for a removal. */
  onRemoving(e) {
    const c = this.creature;
    if (!c) return;
    try {
      if (e.id !== c.entity.id) return;
    } catch {
      return;
    }
    const rec = store.rec;
    try {
      const l = e.location;
      rec.last = { x: l.x, y: l.y, z: l.z, t: this.now };
    } catch {
    }
    const parts = c;
    this.creature = null;
    this.runner = null;
    if (this.brain) {
      const b = this.brain;
      this.brain = null;
      system4.run(() => {
        try {
          b.finish();
        } catch {
        }
      });
    }
    system4.run(() => {
      parts.dropParts();
      store.touch();
    });
  }
  onDie(e) {
    const rec = store.rec;
    let id = "";
    try {
      id = e.id;
    } catch {
      return;
    }
    if (rec.entityId !== id) return;
    rec.entityId = null;
    rec.down = this.now;
    rec.health = 600;
    store.save();
  }
  /**
   * Worn down to his last breath he is not killed: a seam takes him where he stands, and he comes
   * back through the first one a day later, whole, in the form he had.  The reservation never lapses.
   */
  driveOff() {
    const c = this.creature, rec = store.rec;
    if (!c || !c.valid || rec.stage !== "alive" || rec.evolve || rec.ending?.step) return;
    const at = { x: c.pos.x, y: c.pos.y + 3, z: c.pos.z };
    c.say(c.form === 3 ? "basiliskra.iii.roar" : "basiliskra.hurt", c.anchor("nose"), 96);
    sound(c.dim, "basiliskra.rift.open", at, 72, 1, 1.3);
    sound(c.dim, "basiliskra.rift.close", at, 72);
    for (const p of [at, c.anchor("nose"), c.anchor("tail_notch")]) particle(c.dim, "basiliskra:seam_close", p, 72);
    this.brain?.finish();
    rec.last = { x: c.pos.x, y: c.pos.y, z: c.pos.z, t: this.now };
    rec.entityId = null;
    rec.down = this.now;
    rec.health = 600;
    store.save();
    this.creature = null;
    this.brain = null;
    this.runner = null;
    c.dropParts();
    try {
      c.entity.setProperty(PROP.bound, false);
      c.entity.remove();
    } catch {
    }
  }
  onHurt(by, amount) {
    const c = this.creature;
    if (!c || amount <= 0) return;
    this.brain?.onHurt(by);
    if (amount >= 6 && this.now - this.hurtCryAt > 70) {
      this.hurtCryAt = this.now;
      c.say("basiliskra.hurt", c.anchor("nose"), 64);
    }
  }
  // ---- tick ----------------------------------------------------------------------------------------
  tick() {
    const rec = store.rec;
    const now = ++rec.clock;
    if (now % 600 === 0) store.touch();
    beginTick(now);
    if (this.creature && !this.creature.valid) {
      this.creature.dropParts();
      this.creature = null;
      this.brain = null;
      this.runner = null;
    }
    if (now % 20 === 0) this.sweep();
    switch (rec.stage) {
      case "pending":
        this.tryReserve();
        break;
      case "arriving":
        this.arrive();
        break;
      case "alive":
        this.live();
        break;
      default:
        break;
    }
    if (now % 40 === 0) store.flush();
  }
  *searchWater(site) {
    const dim = overworld();
    const LANE = 44, BACK = 9, DEEP = 6, seed = this.now;
    let reads = 0;
    for (let i = 0; i < WATER_CANDIDATES; i++) {
      const a = hash(seed, i, 1) * Math.PI * 2;
      const r = 6 + i / WATER_CANDIDATES * 90;
      const x = Math.floor(site.x + Math.cos(a) * r), z = Math.floor(site.z + Math.sin(a) * r);
      const col = waterColumn(dim, x, z, site.y, 16, 12);
      yield;
      if (col === UNLOADED || col === NONE || col.surface - col.floor < DEEP) continue;
      const toward = yawTo({ x, y: 0, z }, site);
      const yaws = [0, 90, 180, 270].sort((p, q) => Math.cos((toward - q) * Math.PI / 180) - Math.cos((toward - p) * Math.PI / 180));
      for (const yaw of yaws) {
        const f = forwardOf(yaw), l = { x: f.z, y: 0, z: -f.x };
        let ok = true;
        lane: for (let s = -BACK; s <= LANE; s++) {
          for (let side = -3; side <= 3; side++) for (const d of [2, 4, 6]) {
            const b = blockAt(dim, { x: x + f.x * s + l.x * side, y: col.surface - d, z: z + f.z * s + l.z * side });
            if (!b || !isWaterId(b.typeId)) {
              ok = false;
              break lane;
            }
          }
          if ((reads += 21) >= 252) {
            reads = 0;
            yield;
          }
        }
        if (ok) return { at: { x: x + 0.5, y: col.surface - 5.5, z: z + 0.5 }, yaw };
      }
    }
    return null;
  }
  tryReserve() {
    const rec = store.rec;
    if (rec.stage !== "pending" || !rec.pending) return;
    if (this.now < this.waterWait) return;
    const site = rec.pending.site;
    const dim = overworld();
    if (!this.waterSearch || this.now % 20 === 0) {
      if (!players().some((p) => {
        try {
          return p.dimension.id === dim.id && distXZ(p.location, site) < 128;
        } catch {
          return false;
        }
      })) {
        this.waterSearch = null;
        this.waterWait = this.now + 100;
        return;
      }
    }
    if (!this.waterSearch) this.waterSearch = this.searchWater(site);
    const step = this.waterSearch.next();
    if (!step.done) return;
    this.waterSearch = null;
    const w = step.value;
    if (!w) {
      rec.pending.passes = (rec.pending.passes ?? 0) + 1;
      this.waterWait = this.now + 200;
      if (rec.pending.passes >= 12) {
        rec.stage = "dormant";
        rec.pending = null;
        rec.origin = null;
        rec.guilty = null;
        rec.guiltyName = null;
      }
      store.save();
      return;
    }
    rec.stage = "arriving";
    rec.token = newToken();
    rec.entityId = null;
    rec.form = 1;
    rec.pending = null;
    rec.arrival = { step: 0, t0: this.now, water: w.at, yaw: w.yaw };
    store.save();
  }
  // ---- arrival ---------------------------------------------------------------------------------------
  setStep(step) {
    const a = store.rec.arrival;
    if (!a) return;
    a.step = step;
    a.t0 = this.now;
    store.save();
  }
  arrive() {
    const rec = store.rec, a = rec.arrival;
    if (!a) {
      rec.stage = rec.entityId || rec.down !== null ? "alive" : "dormant";
      store.save();
      return;
    }
    const dim = overworld(), now = this.now, t = now - a.t0;
    const near = players().some((p) => {
      try {
        return p.dimension.id === dim.id && distXZ(p.location, a.water) < 96;
      } catch {
        return false;
      }
    });
    if (a.step >= SPAWN_STEP) {
      if (!this.creature) {
        if (rec.entityId !== null) return;
        if (!isLoaded(dim, a.water)) return;
        if (now % 10 === 0) this.sweep();
        if (this.creature) {
          this.runner = null;
        } else if (++this.missing > 200) {
          this.missing = 0;
          this.runner = null;
          this.setStep(SPAWN_STEP);
        } else if (a.step > SPAWN_STEP) return;
      }
    }
    switch (a.step) {
      case 0: {
        if (near && now % 60 === 0 && isLoaded(dim, a.water)) {
          for (const f of dim.getEntities({ location: a.water, maxDistance: 40, families: ["fish"] }).slice(0, 12)) {
            try {
              f.applyImpulse(mul(norm(sub(a.water, f.location)), 0.12));
            } catch {
            }
          }
        }
        const tod = world8.getTimeOfDay();
        if (near && (isDusk(tod) || t > pace(1.2 * TICKS.day))) this.setStep(1);
        break;
      }
      case 1: {
        if (t % KNOCK_GAP_TICKS === 2 && t < KNOCK_GAP_TICKS * 3) {
          let at = add(a.water, { x: 0, y: 5.5, z: 0 });
          try {
            const boat = dim.getEntities({ location: a.water, maxDistance: 40, families: ["boat"] }).find((b) => {
              try {
                return !b.getComponent("minecraft:rideable")?.getRiders().length;
              } catch {
                return true;
              }
            });
            if (boat) {
              at = boat.location;
              boat.applyImpulse({ x: (hash(now, 1) - 0.5) * 0.2, y: 0.02, z: (hash(now, 2) - 0.5) * 0.2 });
            }
          } catch {
          }
          sound(dim, "basiliskra.boat_knock", at, 32);
        }
        if (t > KNOCK_GAP_TICKS * 3 + 30) {
          rec.rift = { ...a.water, yaw: a.yaw };
          this.setStep(2);
        }
        break;
      }
      case 2: {
        if (t === 1) sound(dim, "basiliskra.rift.open", a.water, 72);
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
        if (t % 60 === 30) sound(dim, "basiliskra.rift.hum", a.water, 48);
        if (t > 90 && near) this.setStep(SPAWN_STEP);
        break;
      }
      case SPAWN_STEP: {
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
        if (!this.creature) {
          if (t % 20 !== 1) break;
          const at = add(a.water, mul(forwardOf(a.yaw), -7));
          if (!this.create(dim, at, a.yaw)) break;
          const c = this.creature;
          c.set(PROP.visLo, 9);
          c.setPhase("arrive");
        }
        this.setStep(4);
        this.runner = this.emerge(true);
        break;
      }
      default: {
        if (!this.creature) break;
        if (!this.runner) this.runner = this.emerge(false);
        const done = this.runner.next().done;
        this.creature.update();
        if (done) {
          this.runner = null;
          rec.stage = "alive";
          rec.arrival = null;
          if (!rec.born) {
            rec.born = now;
            rec.mut.formSince = now;
          }
          store.save();
          this.brain?.finish();
        }
        break;
      }
    }
  }
  /** Zones (head 8 .. tail 0) that have passed a plane through `at` facing `yaw`. */
  passed(c, at, yaw) {
    const f = forwardOf(yaw);
    const zones = RIGS[c.form].zones;
    const out = [];
    for (let z = 0; z <= 8; z++) {
      const bones = zones[String(z)];
      if (!bones || !bones.length) {
        out.push(out.length ? out[out.length - 1] : false);
        continue;
      }
      const p = c.point(bones[0], RIGS[c.form].bones[bones[0]].pivot);
      out.push(dot(sub(p, at), f) > 0);
    }
    return out;
  }
  /** He slips through, the seam closes across his tail tip, and he rams the empty water three times. */
  *emerge(full) {
    const rec = store.rec, a = rec.arrival, dim = overworld();
    const c = this.creature;
    const f = forwardOf(a.yaw);
    if (full) {
      c.swimDepth = 5.5;
      c.goTo(add(a.water, mul(f, 44)), 0.3, 2);
      sound(dim, "basiliskra.i.swim", a.water, 56);
      for (let t = 0; t < 260; t++) {
        if (!this.creature) return;
        const pass = this.passed(c, a.water, a.yaw);
        let lo = 9;
        for (let z = 8; z >= 0 && pass[z]; z--) lo = z;
        c.set(PROP.visLo, lo);
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
        if (lo === 0) break;
        yield;
      }
      c.set(PROP.visLo, 0);
      sound(dim, "basiliskra.rift.close", a.water, 72);
      particle(dim, "basiliskra:seam_close", a.water, 72);
      this.setStep(5);
      c.halt();
      for (let t = 0; t < 30; t++) yield;
      const door = add(a.water, mul(f, 5));
      c.setPhase("move");
      c.goTo(door, 0.1, 5);
      for (let t = 0; t < 130 && Math.abs(wrapDeg(yawTo(c.pos, door) - c.yaw)) > 10; t++) {
        if (!this.creature) return;
        yield;
      }
      for (let k = 0; k < 3; k++) {
        if (!this.creature) return;
        c.setPhase("ram");
        c.goTo(door, 0.62, 5);
        for (let t = 0; t < 90 && !c.arrived() && c.blocked < 6; t++) yield;
        c.halt();
        c.speed = 0;
        const nose = c.anchor("muzzle");
        sound(dim, "basiliskra.ram", nose, 80, 1, k === 2 ? 0.86 : 1);
        particle(dim, "basiliskra:shock_ring", nose, 72);
        if (k === 2) {
          c.set(PROP.gill, true);
          sound(dim, "basiliskra.i.gill_catch", c.anchor("gill_l"), 32);
          try {
            for (const b of dim.getEntities({ location: nose, maxDistance: 32, families: ["boat"] })) b.applyImpulse(mul({ x: -f.z, y: 0.12, z: f.x }, 0.35));
          } catch {
          }
        }
        for (let t = 0; t < 22; t++) yield;
        if (k === 2) break;
        c.setPhase("move");
        for (let t = 0; t < 64; t++) {
          if (!this.creature) return;
          const to = add(c.pos, mul(c.forward, -0.24)), tail = add(to, mul(c.forward, -20));
          const wet = (p) => deepHere(dim, p.x, p.z, Math.floor(c.pos.y) + 3, 3) === true;
          if (!wet(to) || !wet(tail)) break;
          c.pos = to;
          yield;
        }
      }
      this.setStep(6);
    }
    if (!this.creature) return;
    c.set(PROP.visLo, 0);
    c.set(PROP.gill, true);
    c.halt();
    c.setPhase("idle");
    c.swimDepth = 64;
    for (let t = 0; t < 80; t++) yield;
  }
  // ---- alive --------------------------------------------------------------------------------------------
  live() {
    const rec = store.rec, now = this.now;
    const c = this.creature;
    if (!c) {
      this.absent();
      return;
    }
    if (rec.evolve) this.evolve(c);
    else if (!this.ending.drive(c)) this.brain?.tick();
    if (this.creature !== c) return;
    c.update();
    this.ending.tick(c);
    if (now % 20 === 0) {
      rec.last = { x: c.pos.x, y: c.pos.y, z: c.pos.z, t: now };
      try {
        const h = c.entity.getComponent("minecraft:health");
        if (h) rec.health = h.currentValue;
      } catch {
      }
      store.touch();
    }
  }
  /** He is owed to this world but not loaded here.  That alone is never a reason to make another. */
  absent() {
    const rec = store.rec, now = this.now;
    this.ending.tick(null);
    if (now % 100 !== 0) return;
    const dim = overworld();
    if (rec.entityId !== null) {
      try {
        const e = world8.getEntity(rec.entityId);
        if (e) {
          this.inspect(e);
          return;
        }
      } catch {
      }
      const l = rec.last;
      if (!l) return;
      let all = true;
      for (const dx of [-48, -24, 0, 24, 48]) for (const dz of [-48, -24, 0, 24, 48]) if (!isLoaded(dim, { x: l.x + dx, y: l.y, z: l.z + dz })) all = false;
      const watched = players().some((p) => {
        try {
          return p.dimension.id === dim.id && distXZ(p.location, l) < 40;
        } catch {
          return false;
        }
      });
      if (all && watched) {
        if (++this.missing >= 12) {
          this.missing = 0;
          rec.entityId = null;
          rec.down = now - pace(TICKS.day);
          store.save();
        }
      } else this.missing = 0;
      return;
    }
    if (rec.down === null) {
      rec.down = now;
      store.touch();
      return;
    }
    if (now - rec.down < pace(TICKS.day) || !rec.rift) return;
    const near = players().some((p) => {
      try {
        return p.dimension.id === dim.id && distXZ(p.location, rec.rift) < 96;
      } catch {
        return false;
      }
    });
    if (!near) return;
    const at = rec.form === 1 ? rec.rift : rec.beach ?? rec.rift;
    if (!isLoaded(dim, at)) return;
    sound(dim, "basiliskra.rift.open", rec.rift, 72);
    this.create(dim, { x: at.x + 0.5, y: at.y + (rec.form === 1 ? 0 : 1), z: at.z + 0.5 }, rec.rift.yaw);
  }
  // ---- evolution: the same entity, in place, resumable ---------------------------------------------------
  evolve(c) {
    const rec = store.rec, ev = rec.evolve, now = this.now;
    const t = now - ev.t0;
    c.halt();
    if (ev.step === 0) {
      if (c.phase !== "evolve") {
        this.brain?.finish();
        c.setPhase("evolve");
        c.say("basiliskra.mutate", c.pos, 72);
      }
      if (t >= 90 || t < 0) {
        rec.form = ev.to;
        rec.mut.formSince = now;
        ev.step = 1;
        ev.t0 = now;
        store.save();
      }
      return;
    }
    if (ev.step === 1) {
      if (c.form !== rec.form) {
        c.form = rec.form;
        try {
          c.entity.triggerEvent(`basiliskra:bind_${rec.form}`);
        } catch {
          return;
        }
        this.nameHim(c.entity);
        c.dropParts();
        c.resync();
        this.brain = this.makeBrain(c);
        c.setPhase("beach");
        c.say("basiliskra.mutate", c.pos, 72, 1, 0.9);
        if (rec.form === 2) {
          this.dropFin(c.dim, c.pos);
          rec.beach = { x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) };
        }
      }
      ev.step = 2;
      ev.t0 = now;
      store.save();
      return;
    }
    if (c.form !== rec.form) {
      ev.step = 1;
      return;
    }
    if (c.phase !== "beach") c.setPhase("beach");
    if (t >= 70) {
      rec.evolve = null;
      store.save();
      this.brain?.finish();
      if (rec.form === 3) c.say("basiliskra.iii.roar", c.anchor("nose"), 128);
    }
  }
  dropFin(dim, at) {
    try {
      dim.spawnItem(new ItemStack(FIN_ITEM, 1), { x: at.x, y: at.y + 1, z: at.z });
      store.rec.learned.fragments++;
      store.rec.learned.fragmentAt = this.now;
      store.touch();
    } catch {
    }
  }
  /** He is fully across.  Only now is the encounter retired, permanently, for this save. */
  retire() {
    const rec = store.rec;
    const c = this.creature;
    this.creature = null;
    this.brain = null;
    if (c) {
      c.dropParts();
      try {
        c.entity.remove();
      } catch {
      }
    }
    rec.stage = "departed";
    rec.entityId = null;
    rec.down = null;
    rec.evolve = null;
    rec.ending = null;
    rec.arrival = null;
    rec.pending = null;
    store.save();
  }
};

// src/harm.ts
var REGION = 64;
var MAX_REGIONS = 40;
var MAX_SITES = 4;
var MAX_PLAYERS = 8;
var MAX_GLOBAL_SITES = 24;
var HALF_LIFE = 2 * TICKS.day;
var RECENT_HALF_LIFE = TICKS.day / 2;
var ANIMALS = {
  "minecraft:cow": "mob.cow.say",
  "minecraft:mooshroom": "mob.cow.say",
  "minecraft:sheep": "mob.sheep.say",
  "minecraft:pig": "mob.pig.say",
  "minecraft:chicken": "mob.chicken.say",
  "minecraft:rabbit": "mob.rabbit.idle",
  "minecraft:horse": "mob.horse.idle",
  "minecraft:donkey": "mob.horse.donkey.idle",
  "minecraft:mule": "mob.horse.donkey.idle",
  "minecraft:llama": "mob.llama.idle",
  "minecraft:goat": "mob.goat.ambient",
  "minecraft:fox": "mob.fox.ambient",
  "minecraft:turtle": "mob.turtle.ambient",
  "minecraft:cod": "mob.fish.flop",
  "minecraft:salmon": "mob.fish.flop",
  "minecraft:tropicalfish": "mob.fish.flop",
  "minecraft:squid": "mob.squid.ambient",
  "minecraft:glow_squid": "mob.glow_squid.ambient",
  "minecraft:dolphin": "mob.dolphin.idle",
  "minecraft:axolotl": "mob.axolotl.idle",
  "minecraft:frog": "mob.frog.ambient",
  "minecraft:camel": "mob.camel.ambient",
  "minecraft:panda": "mob.panda.idle",
  "minecraft:parrot": "mob.parrot.idle",
  "minecraft:bee": "mob.bee.loop",
  "minecraft:armadillo": "mob.armadillo.ambient",
  "minecraft:sniffer": "mob.sniffer.idle",
  "minecraft:polar_bear": "mob.polarbear.idle",
  "minecraft:ocelot": "mob.ocelot.idle",
  "minecraft:bat": "mob.bat.idle"
};
function habitatWeight(typeId) {
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
function keyOf(p) {
  return `${Math.floor(p.x / REGION)},${Math.floor(p.z / REGION)}`;
}
function decay(r, now) {
  const dt = Math.max(0, now - r.t);
  if (dt <= 0) return;
  const k = Math.pow(0.5, dt * CONFIG.pacing / HALF_LIFE);
  const kr = Math.pow(0.5, dt / RECENT_HALF_LIFE);
  r.a *= k;
  r.h *= k;
  r.ra *= kr;
  r.rh *= kr;
  for (const id of Object.keys(r.by)) {
    r.by[id] *= k;
    if (r.by[id] < 0.05) {
      delete r.by[id];
      delete r.names[id];
    }
  }
  r.t = now;
}
function region(p, now) {
  const regs = store.harm.regions;
  const k = keyOf(p);
  let r = regs[k];
  if (!r) {
    const keys = Object.keys(regs);
    if (keys.length >= MAX_REGIONS) {
      let worst = keys[0], low = Infinity;
      for (const kk of keys) {
        decay(regs[kk], now);
        const s = regs[kk].a + regs[kk].h;
        if (s < low) {
          low = s;
          worst = kk;
        }
      }
      delete regs[worst];
    }
    r = regs[k] = { a: 0, h: 0, ra: 0, rh: 0, t: now, by: {}, names: {}, sites: [] };
  }
  decay(r, now);
  return r;
}
function credit(r, playerId, name, w) {
  if (!(playerId in r.by) && Object.keys(r.by).length >= MAX_PLAYERS) {
    let least = "", low = Infinity;
    for (const [id, s] of Object.entries(r.by)) if (s < low) {
      low = s;
      least = id;
    }
    delete r.by[least];
    delete r.names[least];
  }
  r.by[playerId] = (r.by[playerId] ?? 0) + w;
  r.names[playerId] = name;
}
var THRESHOLD = { animals: 8, habitat: 6, total: 18 };
function check(r, key, at) {
  const p = CONFIG.pacing;
  if (r.a * p < THRESHOLD.animals || r.h * p < THRESHOLD.habitat || (r.a + r.h) * p < THRESHOLD.total) return null;
  let guilty = null, top = 0;
  for (const [id, s] of Object.entries(r.by)) if (s > top) {
    top = s;
    guilty = id;
  }
  let site = at;
  if (r.sites.length) {
    const n = r.sites.length;
    site = { x: r.sites.reduce((s, q) => s + q.x, 0) / n, y: r.sites.reduce((s, q) => s + q.y, 0) / n, z: r.sites.reduce((s, q) => s + q.z, 0) / n };
  }
  return { region: key, site, guilty, guiltyName: guilty ? r.names[guilty] ?? null : null };
}
function recordKill(at, typeId, playerId, playerName, now) {
  const call = ANIMALS[typeId];
  if (!call) return null;
  const r = region(at, now);
  const w = Math.min(1, Math.max(0.15, r.ra / 2));
  r.ra += 1;
  r.a += w;
  credit(r, playerId, playerName, w);
  const site = { x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z), s: call, t: now };
  r.sites.push(site);
  if (r.sites.length > MAX_SITES) r.sites.shift();
  const all = store.rec.sites;
  all.push(site);
  if (all.length > MAX_GLOBAL_SITES) all.shift();
  store.touch();
  store.touchHarm();
  return check(r, keyOf(at), at);
}
function recordHabitat(at, typeId, playerId, playerName, now) {
  const base = habitatWeight(typeId);
  if (base <= 0) return null;
  const r = region(at, now);
  const w = base * Math.min(1, Math.max(0.3, r.rh / 2));
  r.rh += base * 2.2;
  r.h += w;
  credit(r, playerId, playerName, w);
  store.touchHarm();
  return check(r, keyOf(at), at);
}

// src/main.ts
var ctl = new Controller();
var ready = false;
var lastFault = "";
var faultAt = -1e9;
var SPLASHERS = /* @__PURE__ */ new Set(["minecraft:snowball", "minecraft:egg", "minecraft:item", "minecraft:ender_pearl"]);
var flying = [];
function splash(at, by) {
  const dim = overworld();
  sound(dim, "basiliskra.splash", at, 24, 0.9);
  particle(dim, "basiliskra:splash", at, 32);
  ctl.brain?.onSplash(at, by);
}
function trackSplashes() {
  for (let i = flying.length - 1; i >= 0; i--) {
    const f = flying[i];
    let done = store.rec.clock - f.born > 100;
    try {
      if (!f.e.isValid) done = true;
      else if (isWaterId(idAt(f.e.dimension, f.e.location))) {
        splash(f.e.location, f.by);
        done = true;
      }
    } catch {
      done = true;
    }
    if (done) flying.splice(i, 1);
  }
}
world9.afterEvents.worldLoad.subscribe(() => {
  ctl.init();
  ready = true;
  system5.runInterval(() => {
    try {
      trackSplashes();
      ctl.tick();
    } catch (e) {
      const m = String(e);
      if (m !== lastFault || store.rec.clock - faultAt > 1200) {
        lastFault = m;
        faultAt = store.rec.clock;
        const where = String(e?.stack ?? "").split("\n").slice(0, 4).join(" | ");
        console.warn(`[${NS}] tick: ${m} ${where}`);
      }
      try {
        if (store.rec.clock % 40 === 0) store.flush();
      } catch {
      }
    }
  }, 1);
});
system5.beforeEvents.shutdown.subscribe(() => {
  try {
    store.flush();
    store.save();
  } catch {
  }
});
world9.afterEvents.entityLoad.subscribe((ev) => {
  if (!ready) return;
  try {
    if (ev.entity.typeId === TYPE) ctl.inspect(ev.entity);
    else if (ev.entity.typeId === HITBOX && !partOwner.has(ev.entity.id)) ev.entity.remove();
  } catch {
  }
});
world9.afterEvents.entitySpawn.subscribe((ev) => {
  if (!ready) return;
  try {
    const id = ev.entity.typeId;
    if (id === TYPE) {
      ctl.inspect(ev.entity);
      return;
    }
    if (id === HITBOX) {
      if (!partOwner.has(ev.entity.id)) ev.entity.remove();
      return;
    }
    if (SPLASHERS.has(id) && ev.entity.dimension.id === OVERWORLD && ctl.creature && flying.length < 16 && dist(ev.entity.location, ctl.creature.pos) < 64) flying.push({ e: ev.entity, born: store.rec.clock });
  } catch {
  }
});
world9.beforeEvents.entityRemove.subscribe((ev) => {
  try {
    const id = ev.removedEntity.typeId;
    if (id === TYPE) ctl.onRemoving(ev.removedEntity);
    else if (id === HITBOX) partOwner.delete(ev.removedEntity.id);
  } catch {
  }
});
var PASSES = /* @__PURE__ */ new Set([
  EntityDamageCause3.entityAttack,
  EntityDamageCause3.projectile,
  EntityDamageCause3.entityExplosion,
  EntityDamageCause3.blockExplosion,
  EntityDamageCause3.magic,
  EntityDamageCause3.thorns,
  EntityDamageCause3.sonicBoom,
  EntityDamageCause3.maceSmash,
  EntityDamageCause3.override
]);
var forwardTick = -1;
var forwardKey = "";
world9.beforeEvents.entityHurt.subscribe((ev) => {
  let type;
  try {
    type = ev.hurtEntity.typeId;
  } catch {
    return;
  }
  if (type === HITBOX) {
    ev.cancel = true;
    const owner = partOwner.get(ev.hurtEntity.id);
    if (!owner) return;
    const amount = ev.damage * (owner.tag === "head" ? 1.25 : owner.tag === "tail" ? 0.6 : 1);
    const cause = ev.damageSource.cause, by = ev.damageSource.damagingEntity;
    if (!PASSES.has(cause) || amount <= 0) return;
    const key = `${cause}|${by?.id ?? ""}`;
    if (forwardTick === store.rec.clock && forwardKey === key) return;
    forwardTick = store.rec.clock;
    forwardKey = key;
    system5.run(() => {
      try {
        if (owner.creature.valid) owner.creature.entity.applyDamage(amount, by ? { cause, damagingEntity: by } : { cause });
      } catch {
      }
    });
    return;
  }
  if (type !== TYPE) return;
  if (!PASSES.has(ev.damageSource.cause)) {
    ev.cancel = true;
    return;
  }
  let health = 1;
  try {
    health = ev.hurtEntity.getComponent("minecraft:health")?.currentValue ?? 1;
  } catch {
    health = 1;
  }
  if (health <= 2) {
    ev.cancel = true;
    system5.run(() => ctl.driveOff());
    return;
  }
  if (ev.damage >= health - 1) {
    ev.damage = Math.max(0, health - 1.5);
    system5.run(() => ctl.driveOff());
  }
});
world9.afterEvents.entityHurt.subscribe((ev) => {
  try {
    if (ev.hurtEntity.typeId !== TYPE) return;
    const by = ev.damageSource.damagingEntity;
    ctl.onHurt(by && by.typeId === "minecraft:player" ? by : void 0, ev.damage);
  } catch {
  }
});
world9.afterEvents.entityDie.subscribe((ev) => {
  let type;
  try {
    type = ev.deadEntity.typeId;
  } catch {
    return;
  }
  if (type === TYPE) {
    ctl.onDie(ev.deadEntity);
    return;
  }
  if (!(type in ANIMALS)) return;
  try {
    const killer = ev.damageSource.damagingEntity;
    if (!killer || killer.typeId !== "minecraft:player" || ev.deadEntity.dimension.id !== OVERWORLD) return;
    const p = killer;
    const t = recordKill(ev.deadEntity.location, type, p.id, p.name, store.rec.clock);
    if (t) ctl.requestArrival(t);
  } catch {
  }
});
world9.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    if (ev.dimension.id !== OVERWORLD) return;
    const t = recordHabitat(ev.block.location, ev.brokenBlockPermutation.type.id, ev.player.id, ev.player.name, store.rec.clock);
    if (t) ctl.requestArrival(t);
  } catch {
  }
});
world9.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  try {
    const id = ev.block.typeId, at = ev.block.location;
    if (id === "minecraft:bell") ctl.brain?.onBell(at, ev.player);
    else if (id === "minecraft:noteblock") {
      ctl.ending.onNote(at);
      ctl.brain?.onNote(at);
    } else if (ev.beforeItemStack?.typeId === "minecraft:water_bucket") {
      const p = { x: at.x + 0.5, y: at.y + 1, z: at.z + 0.5 };
      system5.runTimeout(() => {
        try {
          if (isWaterId(idAt(ev.player.dimension, p)) || isWaterId(idAt(ev.player.dimension, at))) splash(p, ev.player);
        } catch {
        }
      }, 4);
    }
  } catch {
  }
});
world9.afterEvents.weatherChange.subscribe((ev) => {
  const w = String(ev.newWeather).toLowerCase();
  store.rec.weather = w.includes("thunder") ? "thunder" : w.includes("rain") ? "rain" : "clear";
  store.touch();
});
system5.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!CONFIG.debug || ev.id !== `${NS}:debug`) return;
  const [cmd, arg] = ev.message.split(" ");
  const rec = store.rec;
  const src = ev.sourceEntity;
  if (cmd === "status") {
    world9.sendMessage(`[${NS}] stage=${rec.stage} form=${rec.form} id=${rec.entityId} loaded=${!!ctl.creature} act=${ctl.brain?.actName} quarantined=${ctl.quarantined}`);
  } else if (cmd === "arrive" && src) {
    ctl.requestArrival({ region: "debug", site: src.location, guilty: src.id, guiltyName: src.name ?? null });
  } else if (cmd === "stats") {
    rec.mut.surfacings = 99;
    rec.mut.episodes = 99;
    rec.mut.overland = 9999;
    rec.mut.formSince = -1e7;
    rec.mut.beams = Number(arg ?? rec.mut.beams);
    store.save();
  } else if (cmd === "dusk") {
    world9.setTimeOfDay(12200);
  }
}, { namespaces: [NS] });
export {
  ctl
};
