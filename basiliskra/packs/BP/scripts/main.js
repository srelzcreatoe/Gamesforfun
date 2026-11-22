// Basiliskra behaviour script. Built from src/*.ts (see the repository). Stable @minecraft/server 2.11.0 and @minecraft/server-ui 2.3.0 only.


// src/main.ts
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, EntityDamageCause as EntityDamageCause6, EntitySwingSource, GameMode as GameMode2, system as system6, world as world12 } from "@minecraft/server";

// src/config.ts
var CONFIG = {
  /** BASILISKRA CONFIG — how fast the story moves.  2 = twice as fast, 0.5 = half. */
  pacing: 1,
  /**
   * What his beam, his roar and his weight may do to the world.
   *  "none"   only light, particles and sound
   *  "scorch" natural stone, dirt, sand and grass at the impact are scorched; nothing breaks
   *  "break"  natural terrain at the impact is also broken
   *  "wither" (default) like the Wither: the beam blasts out whatever it meets, sets fires, and he smashes
   *           through anything built in his way.  Bedrock, portals and command blocks always survive, and so do
   *           chests, beds and other blocks that hold things while `spareStorage` is on.
   */
  terrain: "wither",
  /** In "wither" mode: chests, barrels, shulker boxes, beds, furnaces, hoppers and the like are never destroyed. */
  spareStorage: true,
  /** Furrows (Form II) and footprints (Form III) pressed into natural ground. */
  marks: true,
  /** Damage multiplier for everything he does to players. */
  damage: 1,
  /** On Peaceful he still appears and behaves, but deals no damage. */
  harmlessOnPeaceful: true,
  /** Operator test hooks via /scriptevent basiliskra:debug ... (needs cheats; off for survival). */
  debug: false,
  /** A spawn egg, /summon or /basiliskra:spawn brings the one Basiliskra to that place (false: they are removed). */
  allowSummon: true,
  /** What a spawn egg or /summon makes: 0 = his stage in the story (a new world: I in water, III on land), 1-3 = that form. */
  spawnForm: 0,
  /** Every player gets the journal the first time they join with the pack on. */
  giveJournal: true,
  /** Operators (and the only player of a single-player world) also get the config wheel on first join. */
  giveWheel: true,
  /**
   * His fallout.  "land" (default): glowing motes, Geiger clicks, and in natural ground only, soil turns to
   * irradiated soil, plants wither and wild leaves fall, healing as it fades.  "visual": motes and clicks only.
   * "off": none of it.
   */
  fallout: "land",
  /** Players standing in strong fallout get hungry, weak and sick (vanilla effects; milk clears them). */
  sickness: true,
  /** He hunts animals and other creatures too, not only players. */
  huntMobs: true,
  /** Short cutscenes (a camera that shows the rift opening, him coming through, and each transformation). */
  cutscenes: true,
  /** His themes play when he is near, fighting, or in his last form. */
  music: true
};
var SETTINGS = ["pacing", "terrain", "spareStorage", "marks", "damage", "harmlessOnPeaceful", "allowSummon", "spawnForm", "giveJournal", "giveWheel", "debug", "fallout", "sickness", "huntMobs", "cutscenes", "music"];
var SETTINGS_KEY = "bk:cfg";
var NS = "basiliskra";
var TYPE = `${NS}:basiliskra`;
var hitboxId = (size) => `${NS}:hitbox_${size}`;
var isHitbox = (typeId) => typeId.startsWith(`${NS}:hitbox_`);
var PART_FAMILY = `${NS}_part`;
var FIN_ITEM = `${NS}:shed_fin`;
var JOURNAL_ITEM = `${NS}:journal`;
var WHEEL_ITEM = `${NS}:config_wheel`;
var COUNTER_ITEM = `${NS}:geiger_counter`;
var SOIL_BLOCK = `${NS}:irradiated_soil`;
var TRINITITE_BLOCK = `${NS}:scarlet_trinitite`;
var ROCK_BLOCK = `${NS}:irradiated_rock`;
var CRYSTAL_BLOCK = `${NS}:crimson_crystal`;
var SLAG_BLOCK = `${NS}:glowing_slag`;
var SLAG_COLD_BLOCK = `${NS}:cooled_slag`;
var LAMP_BLOCK = `${NS}:shard_lamp`;
var SHARD_ITEM = `${NS}:crimson_shard`;
var IODINE_ITEM = `${NS}:iodine_tablets`;
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

// src/settings.ts
import { world } from "@minecraft/server";
var DEFAULTS = { ...CONFIG };
function clean(k, v) {
  switch (k) {
    case "pacing":
      return typeof v === "number" && v >= 0.25 && v <= 4 ? v : void 0;
    case "damage":
      return typeof v === "number" && v >= 0 && v <= 4 ? v : void 0;
    case "terrain":
      return v === "none" || v === "scorch" || v === "break" || v === "wither" ? v : void 0;
    case "spawnForm":
      return v === 0 || v === 1 || v === 2 || v === 3 ? v : void 0;
    case "fallout":
      return v === "off" || v === "visual" || v === "land" ? v : void 0;
    default:
      return typeof v === "boolean" ? v : void 0;
  }
}
function loadSettings() {
  let raw;
  try {
    raw = world.getDynamicProperty(SETTINGS_KEY);
  } catch {
    raw = void 0;
  }
  if (typeof raw !== "string") return;
  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (saved.v === void 0 && saved.terrain === "scorch") delete saved.terrain;
  for (const k of SETTINGS) {
    const v = clean(k, saved[k]);
    if (v !== void 0) CONFIG[k] = v;
  }
}
function saveSettings(change) {
  for (const [k, v] of Object.entries(change)) {
    if (!SETTINGS.includes(k)) continue;
    const c = clean(k, v);
    if (c !== void 0) CONFIG[k] = c;
  }
  const out = { v: 2 };
  for (const k of SETTINGS) if (CONFIG[k] !== DEFAULTS[k]) out[k] = CONFIG[k];
  try {
    world.setDynamicProperty(SETTINGS_KEY, JSON.stringify(out));
  } catch {
  }
}
function resetSettings() {
  for (const k of SETTINGS) CONFIG[k] = DEFAULTS[k];
  try {
    world.setDynamicProperty(SETTINGS_KEY, void 0);
  } catch {
  }
}

// src/ui.ts
import { ItemStack, PlayerPermissionLevel, system as system2, world as world7 } from "@minecraft/server";
import { ActionFormData, FormCancelationReason, MessageFormData, ModalFormData } from "@minecraft/server-ui";

// src/creature.ts
import { EntityDamageCause as EntityDamageCause2, GameMode, world as world5 } from "@minecraft/server";

// src/fx.ts
import { MolangVariableMap, world as world3 } from "@minecraft/server";

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
import { world as world2 } from "@minecraft/server";
var overworld = () => world2.getDimension(OVERWORLD);
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
  return !SOFT.test(b.typeId) && b.typeId !== "basiliskra:crimson_crystal";
}
var PLANT = /^minecraft:(?!stripped_)(.*_log|.*_wood|.*_stem|.*_hyphae|.*leaves.*|azalea|flowering_azalea|bamboo|cactus|melon_block|pumpkin|.*mushroom_block|mushroom_stem|mangrove_roots|bee_nest|chorus_plant|chorus_flower|pointed_dripstone|big_dripleaf|hanging_roots)$/;
var NATURAL = /^minecraft:(stone|granite|diorite|andesite|deepslate|tuff|calcite|dirt|coarse_dirt|grass_block|podzol|mycelium|dirt_with_roots|mud|clay|sand|red_sand|gravel|suspicious_sand|suspicious_gravel|sandstone|red_sandstone|snow|ice|packed_ice|blue_ice|powder_snow|moss_block|pale_moss_block|hardened_clay|.*_terracotta|netherrack|basalt|smooth_basalt|blackstone|end_stone|dripstone_block|.*_ore|bedrock|obsidian|magma|soul_sand|soul_soil|muddy_mangrove_roots|amethyst_block|budding_amethyst|.*coral_block|cobbled_deepslate|packed_mud)$/;
var isPlantBlock = (id) => PLANT.test(id);
var HIS_GROUND = /^basiliskra:(irradiated_soil|irradiated_rock|scarlet_trinitite|glowing_slag|cooled_slag)$/;
var isNaturalGround = (id) => NATURAL.test(id) && !id.includes("glazed") || HIS_GROUND.test(id);
function trunkBlocked(dim, at2, feetY, radius, built, cliff, full, smash = false) {
  const ring = full ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]] : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of ring) {
    const x = at2.x + dx * radius, z = at2.z + dz * radius;
    const top = blockAt(dim, { x, y: feetY + cliff, z });
    if (top && isSolidBlock(top) && !isPlantBlock(top.typeId) && (!smash || isNaturalGround(top.typeId))) return true;
    if (smash) continue;
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
  const stop2 = Math.max(Math.floor(yTop - depth), range.min);
  if (!isLoaded(dim, { x, y, z })) return UNLOADED;
  for (; y >= stop2; y--) {
    const b = blockAt(dim, { x, y, z });
    if (!b) return UNLOADED;
    if (isSolidBlock(b) && !PLANT.test(b.typeId)) return y + 1;
  }
  return NONE;
}
function footprintY(dim, at2, radius, yTop, depth, floatY = null) {
  const ys = [];
  let unloaded = 0;
  for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) {
    const x = at2.x + dx, z = at2.z + dz;
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
function takesMark(dim, at2) {
  const b = blockAt(dim, at2);
  if (!b) return void 0;
  const above = blockAt(dim, { x: at2.x, y: at2.y + 1, z: at2.z });
  if (!above || !WILD.test(above.typeId)) return void 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, 1]) {
      const n = blockAt(dim, { x: at2.x + dx, y: at2.y + dy, z: at2.z + dz });
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
    playerCache = world3.getAllPlayers();
    cacheTick = tick;
  }
}
function players() {
  return playerCache;
}
function witnesses(dim, at2, range) {
  const out = [];
  for (const p of playerCache) {
    try {
      if (p.isValid && p.dimension.id === dim.id && dist(p.location, at2) <= range) out.push(p);
    } catch {
    }
  }
  return out;
}
var QUIET = /^basiliskra\.(geiger|fin_pulse|boat_knock|splash|bell_pin|scrape_far|iii\.window_breath|music)/;
var NEAR = 40;
var FAR = 220;
function sound(dim, id, at2, range = 48, volume = 1, pitch = 1) {
  if (id.startsWith("basiliskra.") && !QUIET.test(id)) {
    loud(dim, id, at2, volume, pitch);
    return;
  }
  for (const p of witnesses(dim, at2, range)) {
    try {
      p.playSound(id, { location: at2, volume, pitch });
    } catch {
    }
  }
}
function loud(dim, id, at2, volume = 1, pitch = 1, far = FAR) {
  for (const p of playerCache) {
    try {
      if (!p.isValid || p.dimension.id !== dim.id) continue;
      const l = p.location, d = dist(l, at2);
      if (d > far) continue;
      if (d <= NEAR) {
        p.playSound(id, { location: at2, volume, pitch });
        continue;
      }
      const k = 10 / d;
      const from = { x: l.x + (at2.x - l.x) * k, y: l.y + 1.6 + (at2.y - l.y) * k, z: l.z + (at2.z - l.z) * k };
      const v = volume * (1 - 0.8 * Math.pow((d - NEAR) / (far - NEAR), 0.8));
      p.playSound(id, { location: from, volume: v, pitch });
    } catch {
    }
  }
}
function stopSound(dim, id, at2, range = 192) {
  for (const p of witnesses(dim, at2, range)) {
    try {
      p.runCommand(`stopsound @s ${id}`);
    } catch {
    }
  }
}
function particle(dim, id, at2, range = 48, vars2) {
  if (!isLoaded(dim, at2)) return;
  for (const p of witnesses(dim, at2, range)) {
    if (spent >= PARTICLE_BUDGET) return;
    spent++;
    try {
      p.spawnParticle(id, at2, vars2);
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
function sizeVars(size) {
  const m = new MolangVariableMap();
  m.setFloat("variable.size", size);
  return m;
}
function flash(dim, at2, range, color, fadeIn = 0.05, hold = 0.1, fadeOut = 0.5) {
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id || dist(p.location, at2) > range) continue;
      p.camera.fade({ fadeColor: color, fadeTime: { fadeInTime: fadeIn, holdTime: hold, fadeOutTime: fadeOut } });
    } catch {
    }
  }
}

// src/generated/rig.ts
var RIGS = { "1": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 36, 0], "rot": [0, 0, 0], "zone": 6 }, "chest": { "parent": "body", "pivot": [0, 36, 0], "rot": [0, 0, 0], "zone": 6 }, "gill_l1": { "parent": "chest", "pivot": [48, 36, -17], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "chest", "pivot": [48, 36, -7], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "chest", "pivot": [48, 36, 3], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "chest", "pivot": [-48, 36, -17], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "chest", "pivot": [-48, 36, -7], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "chest", "pivot": [-48, 36, 3], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "chest", "pivot": [0, 36, -24], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 32, -34], "rot": [4, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [27.4, 45.6, -78], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-27.4, 45.6, -78], "rot": [0, 0, 0], "zone": 8 }, "fin_l": { "parent": "chest", "pivot": [40, 13, 16], "rot": [0, -34, 30], "zone": 6 }, "fin_l_tip": { "parent": "fin_l", "pivot": [74, 13, 16], "rot": [0, 0, 0], "zone": 6 }, "fin_r": { "parent": "chest", "pivot": [-40, 13, 16], "rot": [0, 34, -30], "zone": 6 }, "fin_r_tip": { "parent": "fin_r", "pivot": [-74, 13, 16], "rot": [0, 0, 0], "zone": 6 }, "ribbon0": { "parent": "chest", "pivot": [0, 72, 6], "rot": [0, 0, 0], "zone": 6 }, "seg1": { "parent": "chest", "pivot": [0, 36, 24], "rot": [0, 0, 0], "zone": 5 }, "ribbon1": { "parent": "seg1", "pivot": [0, 72, 40], "rot": [0, 0, 0], "zone": 5 }, "seg2": { "parent": "seg1", "pivot": [0, 36, 56], "rot": [0, 0, 0], "zone": 5 }, "ribbon2": { "parent": "seg2", "pivot": [0, 71.5, 72], "rot": [0, 0, 0], "zone": 5 }, "seg3": { "parent": "seg2", "pivot": [0, 36, 88], "rot": [0, 0, 0], "zone": 5 }, "ribbon3": { "parent": "seg3", "pivot": [0, 70.5, 104], "rot": [0, 0, 0], "zone": 5 }, "seg4": { "parent": "seg3", "pivot": [0, 36, 120], "rot": [0, 0, 0], "zone": 4 }, "ribbon4": { "parent": "seg4", "pivot": [0, 69, 136], "rot": [0, 0, 0], "zone": 4 }, "seg5": { "parent": "seg4", "pivot": [0, 36, 152], "rot": [0, 0, 0], "zone": 4 }, "ribbon5": { "parent": "seg5", "pivot": [0, 67, 168], "rot": [0, 0, 0], "zone": 4 }, "seg6": { "parent": "seg5", "pivot": [0, 36, 184], "rot": [0, 0, 0], "zone": 3 }, "ribbon6": { "parent": "seg6", "pivot": [0, 64.5, 200], "rot": [0, 0, 0], "zone": 3 }, "vribbon6": { "parent": "seg6", "pivot": [0, 7.5, 200], "rot": [0, 0, 0], "zone": 3 }, "seg7": { "parent": "seg6", "pivot": [0, 36, 216], "rot": [0, 0, 0], "zone": 3 }, "ribbon7": { "parent": "seg7", "pivot": [0, 61, 232], "rot": [0, 0, 0], "zone": 3 }, "vribbon7": { "parent": "seg7", "pivot": [0, 11, 232], "rot": [0, 0, 0], "zone": 3 }, "seg8": { "parent": "seg7", "pivot": [0, 36, 248], "rot": [0, 0, 0], "zone": 2 }, "ribbon8": { "parent": "seg8", "pivot": [0, 57, 264], "rot": [0, 0, 0], "zone": 2 }, "vribbon8": { "parent": "seg8", "pivot": [0, 15, 264], "rot": [0, 0, 0], "zone": 2 }, "seg9": { "parent": "seg8", "pivot": [0, 36, 280], "rot": [0, 0, 0], "zone": 1 }, "ribbon9": { "parent": "seg9", "pivot": [0, 53, 296], "rot": [0, 0, 0], "zone": 1 }, "vribbon9": { "parent": "seg9", "pivot": [0, 19, 296], "rot": [0, 0, 0], "zone": 1 }, "seg10": { "parent": "seg9", "pivot": [0, 36, 312], "rot": [0, 0, 0], "zone": 1 }, "ribbon10": { "parent": "seg10", "pivot": [0, 49.5, 328], "rot": [0, 0, 0], "zone": 1 }, "vribbon10": { "parent": "seg10", "pivot": [0, 22.5, 328], "rot": [0, 0, 0], "zone": 1 }, "tailfin": { "parent": "seg10", "pivot": [0, 36, 344], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "back": { "bone": "chest", "pos": [0, 72, 0] }, "belly": { "bone": "chest", "pos": [0, 0, 0] }, "spine_0": { "bone": "chest", "pos": [0, 72, 0] }, "gill_l": { "bone": "chest", "pos": [49, 36, -7] }, "gill_r": { "bone": "chest", "pos": [-49, 36, -7] }, "muzzle": { "bone": "head", "pos": [0, 34, -114] }, "nose": { "bone": "head", "pos": [0, 40, -112] }, "throat": { "bone": "head", "pos": [0, 28, -32] }, "mouth": { "bone": "jaw", "pos": [0, 31, -94] }, "eye_l": { "bone": "eye_l", "pos": [27.9, 45.6, -78] }, "eye_r": { "bone": "eye_r", "pos": [-27.9, 45.6, -78] }, "fin_l": { "bone": "fin_l_tip", "pos": [120, 13, 22] }, "fin_r": { "bone": "fin_r_tip", "pos": [-120, 13, 22] }, "spine_1": { "bone": "seg1", "pos": [0, 72, 40] }, "spine_2": { "bone": "seg2", "pos": [0, 71.5, 72] }, "spine_3": { "bone": "seg3", "pos": [0, 70.5, 104] }, "spine_4": { "bone": "seg4", "pos": [0, 69, 136] }, "spine_5": { "bone": "seg5", "pos": [0, 67, 168] }, "spine_6": { "bone": "seg6", "pos": [0, 64.5, 200] }, "spine_7": { "bone": "seg7", "pos": [0, 61, 232] }, "spine_8": { "bone": "seg8", "pos": [0, 57, 264] }, "spine_9": { "bone": "seg9", "pos": [0, 53, 296] }, "spine_10": { "bone": "seg10", "pos": [0, 49.5, 328] }, "knob_u": { "bone": "tailfin", "pos": [0, 100, 409] }, "knob_d": { "bone": "tailfin", "pos": [0, -28, 409] }, "tail_notch": { "bone": "tailfin", "pos": [2.5, 76, 405] }, "tail_tip": { "bone": "tailfin", "pos": [0, 36, 410] } }, "meta": { "glow_y0": 10, "glow_y1": 74, "wetness": 0.8, "bounds_margin": 6, "form": 1 }, "zones": { "6": ["body", "chest", "fin_l", "fin_l_tip", "fin_r", "fin_r_tip", "ribbon0"], "7": ["gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "jaw", "eye_l", "eye_r"], "5": ["seg1", "ribbon1", "seg2", "ribbon2", "seg3", "ribbon3"], "4": ["seg4", "ribbon4", "seg5", "ribbon5"], "3": ["seg6", "ribbon6", "vribbon6", "seg7", "ribbon7", "vribbon7"], "2": ["seg8", "ribbon8", "vribbon8"], "1": ["seg9", "ribbon9", "vribbon9", "seg10", "ribbon10", "vribbon10"], "0": ["tailfin"] }, "boxes": { "chest": [[-48, 0, -33], [48, 72, 33]], "head": [[-43, 32, -110.5], [43, 68, -20]], "jaw": [[-41, 7, -107.6], [41, 30.8, -19.2]], "fin_l": [[34, 8.5, 0], [74, 17.5, 32]], "fin_l_tip": [[70, 10.8, -3], [126, 15.2, 34]], "fin_r": [[-74, 8.5, 0], [-34, 17.5, 32]], "fin_r_tip": [[-126, 10.8, -3], [-70, 15.2, 34]], "seg1": [[-47.5, 0, 15], [47.5, 72, 57]], "seg2": [[-46.5, 0.5, 47], [46.5, 71.5, 89]], "seg3": [[-45, 1.5, 79], [45, 70.5, 121]], "seg4": [[-42.5, 3, 111], [42.5, 69, 153]], "seg5": [[-39.5, 5, 143], [39.5, 67, 185]], "seg6": [[-35.5, 7.5, 175], [35.5, 64.5, 217]], "seg7": [[-30.5, 11, 207], [30.5, 61, 249]], "seg8": [[-25, 15, 239], [25, 57, 281]], "seg9": [[-19, 19, 271], [19, 53, 313]], "seg10": [[-13.5, 22.5, 303], [13.5, 49.5, 345]], "tailfin": [[-5, -33, 338], [5, 105, 412]] } }, "2": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 44, 0], "rot": [0, 0, 0], "zone": 5 }, "chest": { "parent": "body", "pivot": [0, 78, 0], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 122, 0], "rot": [0, 0, 0], "zone": 5 }, "neck": { "parent": "chest", "pivot": [0, 84, -32], "rot": [3, 0, 0], "zone": 6 }, "plates_neck": { "parent": "neck", "pivot": [0, 116, -46], "rot": [0, 0, 0], "zone": 6 }, "gill_l1": { "parent": "neck", "pivot": [37, 84, -56], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck", "pivot": [37, 84, -47], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck", "pivot": [37, 84, -38], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck", "pivot": [-37, 84, -56], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck", "pivot": [-37, 84, -47], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck", "pivot": [-37, 84, -38], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck", "pivot": [0, 84, -62], "rot": [4, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [28.08, 91.46, -97.7], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-28.08, 91.46, -97.7], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 71, -75], "rot": [9, 0, 0], "zone": 8 }, "arm_l": { "parent": "chest", "pivot": [54, 102, -14], "rot": [14, 0, 10], "zone": 5 }, "forearm_l": { "parent": "arm_l", "pivot": [54, 54, -14], "rot": [-38, 0, -10], "zone": 5 }, "claw_l": { "parent": "forearm_l", "pivot": [54, 4, -14], "rot": [24, 0, 0], "zone": 5 }, "arm_r": { "parent": "chest", "pivot": [-54, 102, -14], "rot": [14, 0, -10], "zone": 5 }, "forearm_r": { "parent": "arm_r", "pivot": [-54, 54, -14], "rot": [-38, 0, 10], "zone": 5 }, "claw_r": { "parent": "forearm_r", "pivot": [-54, 4, -14], "rot": [24, 0, 0], "zone": 5 }, "mid": { "parent": "body", "pivot": [0, 66, 30], "rot": [0, 0, 0], "zone": 4 }, "plates_mid": { "parent": "mid", "pivot": [0, 100, 66], "rot": [0, 0, 0], "zone": 4 }, "hips": { "parent": "mid", "pivot": [0, 36, 104], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 72, 126], "rot": [0, 0, 0], "zone": 3 }, "leg_l": { "parent": "hips", "pivot": [40, 24, 126], "rot": [0, -40, 24], "zone": 3 }, "foot_l": { "parent": "leg_l", "pivot": [70, 20, 126], "rot": [0, 0, -24], "zone": 3 }, "leg_r": { "parent": "hips", "pivot": [-40, 24, 126], "rot": [0, 40, -24], "zone": 3 }, "foot_r": { "parent": "leg_r", "pivot": [-70, 20, 126], "rot": [0, 0, 24], "zone": 3 }, "tail1": { "parent": "hips", "pivot": [0, 32, 150], "rot": [0, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 62, 164], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 30, 178], "rot": [0, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 58, 192], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 28, 206], "rot": [0, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 54, 220], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 26, 234], "rot": [0, 0, 0], "zone": 1 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 50, 248], "rot": [0, 0, 0], "zone": 1 }, "tail5": { "parent": "tail4", "pivot": [0, 24, 262], "rot": [0, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 46, 276], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 23, 290], "rot": [0, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 44, 304], "rot": [0, 0, 0], "zone": 1 }, "knob": { "parent": "tail6", "pivot": [0, 23, 318], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "heart": { "bone": "chest", "pos": [0, 78, 0] }, "gill_l": { "bone": "neck", "pos": [38, 84, -47] }, "gill_r": { "bone": "neck", "pos": [-38, 84, -47] }, "muzzle": { "bone": "head", "pos": [0, 77.5, -176.4] }, "nose": { "bone": "head", "pos": [0, 90.5, -173.8] }, "throat": { "bone": "head", "pos": [0, 77.5, -69.8] }, "eye_l": { "bone": "eye_l", "pos": [28.58, 91.46, -97.7] }, "eye_r": { "bone": "eye_r", "pos": [-28.58, 91.46, -97.7] }, "mouth": { "bone": "jaw", "pos": [0, 76.2, -153] }, "claw_l": { "bone": "claw_l", "pos": [54, -6, -44] }, "claw_r": { "bone": "claw_r", "pos": [-54, -6, -44] }, "hip_l": { "bone": "hips", "pos": [30, 0, 140] }, "hip_r": { "bone": "hips", "pos": [-30, 0, 140] }, "foot_l": { "bone": "foot_l", "pos": [86, 11, 126] }, "foot_r": { "bone": "foot_r", "pos": [-86, 11, 126] }, "tail_notch": { "bone": "tail6", "pos": [29.5, 23, 305] }, "knob_core": { "bone": "knob", "pos": [0, 32, 358] }, "horn_l": { "bone": "knob", "pos": [19.3621, 76.8737, 367.5747] }, "horn_r": { "bone": "knob", "pos": [-19.3621, 76.8737, 367.5747] } }, "meta": { "glow_y0": 10, "glow_y1": 104, "wetness": 0.5, "bounds_margin": 6, "form": 2 }, "zones": { "5": ["body", "chest", "plates_chest", "arm_l", "forearm_l", "claw_l", "arm_r", "forearm_r", "claw_r"], "6": ["neck", "plates_neck"], "7": ["gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "jaw"], "4": ["mid", "plates_mid"], "3": ["hips", "plates_hips", "leg_l", "foot_l", "leg_r", "foot_r"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3"], "1": ["tail4", "plates_tail4", "tail5", "plates_tail5", "tail6", "plates_tail6"], "0": ["knob"] }, "boxes": { "chest": [[-54, 35, -37], [54, 125, 33]], "neck": [[-37, 51, -63], [37, 117, -23]], "head": [[-33.8, 67.1, -172.5], [33.8, 110, -54.2]], "jaw": [[-23.4, 55.4, -167.3], [23.4, 71, -64.6]], "arm_l": [[30, 49, -41], [78, 113, 13]], "forearm_l": [[30.5, 0, -38], [77.5, 65, 14]], "claw_l": [[27.4, -6, -58.7], [80.6, 11, 10]], "arm_r": [[-78, 49, -41], [-30, 113, 13]], "forearm_r": [[-77.5, 0, -38], [-30.5, 65, 14]], "claw_r": [[-80.6, -6, -58.7], [-27.4, 11, 10]], "mid": [[-48, 22.9, 29], [48, 108, 105]], "hips": [[-44, 12.2, 101], [44, 73, 151]], "leg_l": [[36, 13, 116], [70, 35, 136]], "foot_l": [[68.8, 11, 111.1], [100, 16, 140.9]], "leg_r": [[-70, 13, 116], [-36, 35, 136]], "foot_r": [[-100, 11, 111.1], [-68.8, 16, 140.9]], "tail1": [[-40, 10.4, 141], [40, 62, 179]], "tail2": [[-37, 9.8, 169], [37, 58, 207]], "tail3": [[-34, 9.3, 197], [34, 54, 235]], "tail4": [[-31, 8.7, 225], [31, 50, 263]], "tail5": [[-28.5, 8.2, 253], [28.5, 46, 291]], "tail6": [[-26.5, 7.9, 281], [29.3, 44, 319]], "knob": [[-38.2, 0.8, 317], [38.2, 77.4, 406]] } }, "3": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 112, 0], "rot": [0, 0, 0], "zone": 4 }, "plates_mid": { "parent": "body", "pivot": [0, 151, -12], "rot": [0, 0, 0], "zone": 4 }, "chest": { "parent": "body", "pivot": [0, 108, -60], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 148, -92], "rot": [0, 0, 0], "zone": 5 }, "hips": { "parent": "body", "pivot": [0, 110, 36], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 151, 70], "rot": [0, 0, 0], "zone": 3 }, "neck1": { "parent": "chest", "pivot": [0, 114, -126], "rot": [4, 0, 0], "zone": 6 }, "plates_neck1": { "parent": "neck1", "pivot": [0, 150, -134.5], "rot": [0, 0, 0], "zone": 6 }, "neck2": { "parent": "neck1", "pivot": [0, 114, -143], "rot": [3, 0, 0], "zone": 6 }, "plates_neck2": { "parent": "neck2", "pivot": [0, 146.5, -151.5], "rot": [0, 0, 0], "zone": 6 }, "neck3": { "parent": "neck2", "pivot": [0, 114, -160], "rot": [2, 0, 0], "zone": 7 }, "plates_neck3": { "parent": "neck3", "pivot": [0, 143, -168.5], "rot": [0, 0, 0], "zone": 7 }, "neck4": { "parent": "neck3", "pivot": [0, 114, -177], "rot": [0, 0, 0], "zone": 7 }, "plates_neck4": { "parent": "neck4", "pivot": [0, 140, -185.5], "rot": [0, 0, 0], "zone": 7 }, "neck5": { "parent": "neck4", "pivot": [0, 114, -194], "rot": [-2, 0, 0], "zone": 7 }, "plates_neck5": { "parent": "neck5", "pivot": [0, 137.5, -202.5], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck5", "pivot": [0, 114, -211], "rot": [-3, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [26.368, 120.608, -247.4], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-26.368, 120.608, -247.4], "rot": [0, 0, 0], "zone": 8 }, "plates_head": { "parent": "head", "pivot": [0, 133.2, -223.8], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 101.2, -223.8], "rot": [7, 0, 0], "zone": 8 }, "gill_l1": { "parent": "neck5", "pivot": [19.92, 113, -208.5], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck5", "pivot": [19.92, 113, -203.1], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck5", "pivot": [19.92, 113, -197.7], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck5", "pivot": [-19.92, 113, -208.5], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck5", "pivot": [-19.92, 113, -203.1], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck5", "pivot": [-19.92, 113, -197.7], "rot": [0, 0, 0], "zone": 7 }, "leg_fl": { "parent": "chest", "pivot": [40, 104, -100], "rot": [20, 0, 0], "zone": 5 }, "leg_fl_lower": { "parent": "leg_fl", "pivot": [40, 54, -100], "rot": [-35, 0, 0], "zone": 5 }, "foot_fl": { "parent": "leg_fl_lower", "pivot": [40, 7, -100], "rot": [15, 0, 0], "zone": 5 }, "leg_fr": { "parent": "chest", "pivot": [-40, 104, -100], "rot": [20, 0, 0], "zone": 5 }, "leg_fr_lower": { "parent": "leg_fr", "pivot": [-40, 54, -100], "rot": [-35, 0, 0], "zone": 5 }, "foot_fr": { "parent": "leg_fr_lower", "pivot": [-40, 7, -100], "rot": [15, 0, 0], "zone": 5 }, "leg_bl": { "parent": "hips", "pivot": [40, 104, 84], "rot": [-22, 0, 0], "zone": 3 }, "leg_bl_lower": { "parent": "leg_bl", "pivot": [40, 52, 84], "rot": [40, 0, 0], "zone": 3 }, "foot_bl": { "parent": "leg_bl_lower", "pivot": [40, 6, 84], "rot": [-18, 0, 0], "zone": 3 }, "leg_br": { "parent": "hips", "pivot": [-40, 104, 84], "rot": [-22, 0, 0], "zone": 3 }, "leg_br_lower": { "parent": "leg_br", "pivot": [-40, 52, 84], "rot": [40, 0, 0], "zone": 3 }, "foot_br": { "parent": "leg_br_lower", "pivot": [-40, 6, 84], "rot": [-18, 0, 0], "zone": 3 }, "tail1": { "parent": "hips", "pivot": [0, 112, 112], "rot": [-8, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 144, 127.5], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 112, 143], "rot": [-6, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 140, 158.5], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 112, 174], "rot": [-4, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 136, 189], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 112, 204], "rot": [-2, 0, 0], "zone": 1 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 132, 219], "rot": [0, 0, 0], "zone": 1 }, "tail5": { "parent": "tail4", "pivot": [0, 112, 234], "rot": [2, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 129, 249], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 112, 264], "rot": [5, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 126.5, 278.5], "rot": [0, 0, 0], "zone": 1 }, "tail7": { "parent": "tail6", "pivot": [0, 112, 293], "rot": [7, 0, 0], "zone": 1 }, "plates_tail7": { "parent": "tail7", "pivot": [0, 124.5, 307.5], "rot": [0, 0, 0], "zone": 1 }, "tail8": { "parent": "tail7", "pivot": [0, 112, 322], "rot": [6, 0, 0], "zone": 1 }, "plates_tail8": { "parent": "tail8", "pivot": [0, 123, 336], "rot": [0, 0, 0], "zone": 1 }, "club": { "parent": "tail8", "pivot": [0, 112, 350], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "heart": { "bone": "body", "pos": [0, 112, -20] }, "plate_tip_3": { "bone": "plates_mid", "pos": [0, 218.3, -21.8] }, "plate_tip_4": { "bone": "plates_mid", "pos": [0, 228.8, 7.2] }, "plate_tip_5": { "bone": "plates_mid", "pos": [0, 235.5, 35] }, "plate_tip_6": { "bone": "plates_mid", "pos": [0, 235.5, 61] }, "plate_tip_0": { "bone": "plates_chest", "pos": [0, 177.2, -105.2] }, "plate_tip_1": { "bone": "plates_chest", "pos": [0, 193.5, -79] }, "plate_tip_2": { "bone": "plates_chest", "pos": [0, 205.9, -51.4] }, "plate_tip_7": { "bone": "plates_hips", "pos": [0, 229.8, 85.2] }, "plate_tip_8": { "bone": "plates_hips", "pos": [0, 218.3, 106.2] }, "plate_tip_9": { "bone": "plates_hips", "pos": [0, 204.9, 124.6] }, "gill_l": { "bone": "neck5", "pos": [21, 113, -201.5] }, "gill_r": { "bone": "neck5", "pos": [-21, 113, -201.5] }, "muzzle": { "bone": "head", "pos": [0, 107.6, -303.16] }, "throat": { "bone": "head", "pos": [0, 107.6, -218.68] }, "nose": { "bone": "head", "pos": [0, 121.68, -300.6] }, "eye_l": { "bone": "eye_l", "pos": [26.868, 120.608, -247.4] }, "eye_r": { "bone": "eye_r", "pos": [-26.868, 120.608, -247.4] }, "mouth": { "bone": "jaw", "pos": [0, 106.32, -282.68] }, "foot_fl": { "bone": "foot_fl", "pos": [40, -5, -108] }, "foot_fr": { "bone": "foot_fr", "pos": [-40, -5, -108] }, "foot_bl": { "bone": "foot_bl", "pos": [40, -6, 76] }, "foot_br": { "bone": "foot_br", "pos": [-40, -6, 76] }, "tail_notch": { "bone": "tail7", "pos": [11.5, 112, 306] }, "club_core": { "bone": "club", "pos": [0, 112, 374] }, "spike_tip_0": { "bone": "club", "pos": [41.2571, 135.8198, 369.7336] }, "spike_tip_1": { "bone": "club", "pos": [0, 165.2182, 369.1757] }, "spike_tip_2": { "bone": "club", "pos": [-40.6907, 135.4928, 369.799] }, "spike_tip_3": { "bone": "club", "pos": [-43.335, 86.9805, 369.4936] }, "spike_tip_4": { "bone": "club", "pos": [0, 58.6562, 369.1631] }, "spike_tip_5": { "bone": "club", "pos": [46.0464, 85.4151, 369.1805] }, "spike_tip_6": { "bone": "club", "pos": [22.5857, 143.0865, 405.9264] }, "spike_tip_7": { "bone": "club", "pos": [-22.3364, 142.7435, 405.5367] }, "spike_tip_8": { "bone": "club", "pos": [-32.3061, 101.5031, 401.8313] }, "spike_tip_9": { "bone": "club", "pos": [0, 73.6781, 405.8316] }, "spike_tip_10": { "bone": "club", "pos": [32.359, 101.4859, 401.8824] }, "spike_tip_11": { "bone": "club", "pos": [0, 114.8643, 426.2925] } }, "meta": { "glow_y0": 64, "glow_y1": 156, "wetness": 0.15, "bounds_margin": 6, "form": 3 }, "zones": { "4": ["body", "plates_mid"], "5": ["chest", "plates_chest", "leg_fl", "leg_fl_lower", "foot_fl", "leg_fr", "leg_fr_lower", "foot_fr"], "3": ["hips", "plates_hips", "leg_bl", "leg_bl_lower", "foot_bl", "leg_br", "leg_br_lower", "foot_br"], "6": ["neck1", "plates_neck1", "neck2", "plates_neck2"], "7": ["neck3", "plates_neck3", "neck4", "plates_neck4", "neck5", "plates_neck5", "gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "plates_head", "jaw"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3"], "1": ["tail4", "plates_tail4", "tail5", "plates_tail5", "tail6", "plates_tail6", "tail7", "plates_tail7", "tail8", "plates_tail8"], "0": ["club"] }, "boxes": { "body": [[-46, 66, -61], [46, 152.5, 37]], "chest": [[-52, 63, -131], [52, 149, -59]], "hips": [[-52, 68, 35], [52, 152, 115]], "neck1": [[-38, 78, -144], [38, 150, -116]], "neck2": [[-34, 81.5, -161], [34, 146.5, -133]], "neck3": [[-30.5, 85, -178], [30.5, 143, -150]], "neck4": [[-27, 88, -195], [27, 140, -167]], "neck5": [[-24.5, 90.5, -212], [24.5, 137.5, -184]], "head": [[-32, 96.1, -299.3], [32, 139, -203.3]], "jaw": [[-21.8, 85.8, -294.2], [21.8, 101.2, -213.6]], "gill_l1": [[19.4, 102.8, -210.9], [20.4, 123.2, -201.9]], "gill_l2": [[19.4, 102.8, -205.5], [20.4, 123.2, -196.5]], "gill_l3": [[19.4, 102.8, -200.1], [20.4, 123.2, -191.1]], "gill_r1": [[-20.4, 102.8, -210.9], [-19.4, 123.2, -201.9]], "gill_r2": [[-20.4, 102.8, -205.5], [-19.4, 123.2, -196.5]], "gill_r3": [[-20.4, 102.8, -200.1], [-19.4, 123.2, -191.1]], "leg_fl": [[15, 49, -133.7], [65, 113, -67]], "leg_fl_lower": [[18, 3, -124], [62, 64, -70]], "foot_fl": [[16.4, -5, -140.7], [63.6, 14, -76]], "leg_fr": [[-65, 49, -133.7], [-15, 113, -67]], "leg_fr_lower": [[-62, 3, -124], [-18, 64, -70]], "foot_fr": [[-63.6, -5, -140.7], [-16.4, 14, -76]], "leg_bl": [[13, 47, 47], [67, 113, 122.5]], "leg_bl_lower": [[18, 2, 56], [62, 62, 112]], "foot_bl": [[16.4, -6, 43.3], [63.6, 13, 108]], "leg_br": [[-67, 47, 47], [-13, 113, 122.5]], "leg_br_lower": [[-62, 2, 56], [-18, 62, 112]], "foot_br": [[-63.6, -6, 43.3], [-16.4, 13, 108]], "tail1": [[-34, 80, 103], [34, 144, 144]], "tail2": [[-29.5, 84, 134], [29.5, 140, 175]], "tail3": [[-25, 88, 165], [25, 136, 205]], "tail4": [[-21, 92, 195], [21, 132, 235]], "tail5": [[-17.5, 95, 225], [17.5, 129, 265]], "tail6": [[-14.5, 97.5, 255], [14.5, 126.5, 294]], "tail7": [[-12, 99.5, 284], [12.2, 124.5, 323]], "tail8": [[-10, 101, 313], [10, 123, 351]], "club": [[-26, 86, 348], [26, 138, 394]] } } };
var LOOK = { "1": { "yaw": { "head": 0.6, "chest": 0.4 }, "pitch": { "head": 0.6, "chest": 0.4 } }, "2": { "yaw": { "head": 0.45, "neck": 0.4, "chest": 0.15 }, "pitch": { "head": 0.5, "neck": 0.4, "chest": 0.1 } }, "3": { "yaw": { "head": 0.35, "neck1": 0.11, "neck2": 0.11, "neck3": 0.11, "neck4": 0.11, "neck5": 0.11, "chest": 0.1 }, "pitch": { "head": 0.4, "neck1": 0.12, "neck2": 0.12, "neck3": 0.12, "neck4": 0.12, "neck5": 0.12 } } };
var STRIDE_III = 11.9;
var STANCE_III = 8.925;
var BODY_DROP_III = 9;
var WINDOW_CROUCH_III = 6.5;
var BETA_III = 0.75;
var LIFT_III = 16;
var STANCE_MODEL_III = 84;
var SCALE = { 1: 1, 2: 1.25, 3: 1.7 };
var TAIL_LIFT_III = 4;
var WINDOW_NECK = [32, 28, 20, 0, -24];
var WINDOW_HEAD = [-62.7, 21.8, -51.8];
var GAIT_TICKS = [16, 25, 30];
var ROAR_ENV = { "long": [0.53, 0.57, 0.63, 0.66, 0.7, 0.74, 0.77, 0.78, 0.79, 0.8, 0.78, 0.77, 0.77, 0.78, 0.8, 0.87, 0.98, 1, 1, 0.94, 0.89, 0.92, 0.88, 0.85, 0.84, 0.81, 0.85, 0.9, 0.86, 0.84, 0.82, 0.77, 0.76, 0.75, 0.75, 0.8, 0.93, 1, 0.94, 0.85, 0.82, 0.81, 0.84, 0.86, 0.9, 0.92, 0.93, 0.92, 0.83, 0.78, 0.75, 0.76, 0.78, 0.75, 0.71, 0.69, 0.71, 0.69, 0.66, 0.66, 0.65, 0.64, 0.62, 0.61, 0.62, 0.59, 0.52, 0.48, 0.47, 0.44, 0.37, 0.28, 0.2, 0.16, 0.15, 0.15, 0.15, 0.13, 0.11, 0.1, 0.08, 0.07, 0.07, 0.06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "short": [0.12, 0.38, 0.79, 1, 1, 0.96, 0.93, 0.95, 0.97, 0.93, 0.89, 0.86, 0.88, 0.85, 0.81, 0.81, 0.81, 0.8, 0.77, 0.76, 0.77, 0.73, 0.65, 0.59, 0.59, 0.55, 0.47, 0.35, 0.25, 0.2, 0.18, 0.16, 0.15, 0.11, 0.08, 0.06, 0, 0, 0, 0, 0, 0, 0, 0], "under": [0.44, 0.51, 0.54, 0.51, 0.53, 0.58, 0.64, 0.66, 0.66, 0.67, 0.64, 0.64, 0.63, 0.65, 0.72, 0.83, 0.97, 1, 1, 0.89, 0.81, 0.85, 0.8, 0.76, 0.77, 0.74, 0.81, 0.87, 0.83, 0.82, 0.79, 0.72, 0.71, 0.72, 0.71, 0.76, 0.92, 1, 1, 0.87, 0.82, 0.79, 0.81, 0.85, 0.9, 0.91, 0.92, 0.91, 0.83, 0.77, 0.72, 0.73, 0.74, 0.7, 0.66, 0.63, 0.63, 0.62, 0.6, 0.62, 0.62, 0.63, 0.6, 0.6, 0.61, 0.56, 0.46, 0.39, 0.37, 0.32, 0.25, 0.16, 0.09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
var VOICE_KIND = { grunt: 4, growl: 5, breath: 6, hurt: 7, roar: 8, roar_short: 9, roar_under: 10 };

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
  /** `window`: 0..1, how far into the window crouch (Form III). */
  constructor(form, pose, window = 0) {
    this.form = form;
    this.pose = pose;
    this.window = window;
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
    if (this.form === 3 && name === "body") local[7] -= BODY_DROP_III + WINDOW_CROUCH_III * this.window;
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
var drawScale = (form) => SCALE[form];
function toWorld(at2, yaw, m, scale = 1) {
  const l = leftOf(yaw), f = forwardOf(yaw);
  const k = scale / 16;
  const x = m[0] * k, y = m[1] * k, z = -m[2] * k;
  return { x: at2.x + l.x * x + f.x * z, y: at2.y + y, z: at2.z + l.z * x + f.z * z };
}

// src/havoc.ts
import { BlockVolume, EntityDamageCause } from "@minecraft/server";
var NEVER = /^minecraft:(bedrock|invisible_bedrock|barrier|(chain_|repeating_)?command_block|structure_block|structure_void|jigsaw|end_portal|end_portal_frame|end_gateway|portal|reinforced_deepslate|light_block.*|border_block|allow|deny|trial_spawner|vault|mob_spawner|moving_block|(sticky_)?piston_arm_collision)$/;
var STORAGE = /(chest|barrel|shulker_box|^minecraft:bed$|_bed$|furnace|smoker|hopper|dispenser|dropper|crafter|brewing_stand|lectern|bookshelf|decorated_pot|jukebox|beacon|respawn_anchor|lodestone|enchanting_table|anvil|frame$|flower_pot|cauldron|obsidian|_sign$|standing_sign|wall_sign|hanging_sign|banner|campfire|beehive|bee_nest|chiseled_bookshelf|vault|crafting_table)/;
var FRAGILE = /^minecraft:(short_grass|tall_grass|short_dry_grass|tall_dry_grass|fern|large_fern|deadbush|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|snow_layer|.*sapling|wildflowers|pink_petals|leaf_litter|bush|firefly_bush|sweet_berry_bush|.*mushroom|vine|glow_lichen|.*_leaves|azalea_leaves_flowered|cactus_flower|.*eyeblossom|torchflower|pitcher_plant|wither_rose)$/;
var GLASS = /^minecraft:(.*glass(_pane)?|.*_stained_glass.*|glass|glass_pane|tinted_glass|.*lantern|.*torch|.*candle)$/;
var wither = () => CONFIG.terrain === "wither";
var FRAGILE_IDS = [
  "acacia_leaves",
  "acacia_sapling",
  "allium",
  "azalea_leaves",
  "azalea_leaves_flowered",
  "azure_bluet",
  "bamboo_sapling",
  "birch_leaves",
  "birch_sapling",
  "blue_orchid",
  "brown_mushroom",
  "bush",
  "cactus_flower",
  "cherry_leaves",
  "cherry_sapling",
  "closed_eyeblossom",
  "cornflower",
  "dandelion",
  "dark_oak_leaves",
  "dark_oak_sapling",
  "deadbush",
  "fern",
  "firefly_bush",
  "glow_lichen",
  "jungle_leaves",
  "jungle_sapling",
  "large_fern",
  "leaf_litter",
  "lilac",
  "lily_of_the_valley",
  "mangrove_leaves",
  "oak_leaves",
  "oak_sapling",
  "open_eyeblossom",
  "orange_poplar_leaves",
  "orange_tulip",
  "oxeye_daisy",
  "pale_oak_leaves",
  "pale_oak_sapling",
  "peony",
  "pink_petals",
  "pink_tulip",
  "pitcher_plant",
  "poplar_sapling",
  "poppy",
  "red_mushroom",
  "red_poplar_leaves",
  "red_tulip",
  "rose_bush",
  "short_dry_grass",
  "short_grass",
  "snow_layer",
  "spruce_leaves",
  "spruce_sapling",
  "sunflower",
  "sweet_berry_bush",
  "tall_dry_grass",
  "tall_grass",
  "torchflower",
  "vine",
  "white_tulip",
  "wildflowers",
  "wither_rose",
  "yellow_poplar_leaves"
].map((n) => "minecraft:" + n);
var GLASS_IDS = [
  "black_candle",
  "black_stained_glass",
  "black_stained_glass_pane",
  "blue_candle",
  "blue_stained_glass",
  "blue_stained_glass_pane",
  "brown_candle",
  "brown_stained_glass",
  "brown_stained_glass_pane",
  "candle",
  "copper_lantern",
  "copper_torch",
  "cyan_candle",
  "cyan_stained_glass",
  "cyan_stained_glass_pane",
  "exposed_copper_lantern",
  "glass",
  "glass_pane",
  "gray_candle",
  "gray_stained_glass",
  "gray_stained_glass_pane",
  "green_candle",
  "green_stained_glass",
  "green_stained_glass_pane",
  "hard_black_stained_glass",
  "hard_black_stained_glass_pane",
  "hard_blue_stained_glass",
  "hard_blue_stained_glass_pane",
  "hard_brown_stained_glass",
  "hard_brown_stained_glass_pane",
  "hard_cyan_stained_glass",
  "hard_cyan_stained_glass_pane",
  "hard_glass",
  "hard_glass_pane",
  "hard_gray_stained_glass",
  "hard_gray_stained_glass_pane",
  "hard_green_stained_glass",
  "hard_green_stained_glass_pane",
  "hard_light_blue_stained_glass",
  "hard_light_blue_stained_glass_pane",
  "hard_light_gray_stained_glass",
  "hard_light_gray_stained_glass_pane",
  "hard_lime_stained_glass",
  "hard_lime_stained_glass_pane",
  "hard_magenta_stained_glass",
  "hard_magenta_stained_glass_pane",
  "hard_orange_stained_glass",
  "hard_orange_stained_glass_pane",
  "hard_pink_stained_glass",
  "hard_pink_stained_glass_pane",
  "hard_purple_stained_glass",
  "hard_purple_stained_glass_pane",
  "hard_red_stained_glass",
  "hard_red_stained_glass_pane",
  "hard_white_stained_glass",
  "hard_white_stained_glass_pane",
  "hard_yellow_stained_glass",
  "hard_yellow_stained_glass_pane",
  "lantern",
  "light_blue_candle",
  "light_blue_stained_glass",
  "light_blue_stained_glass_pane",
  "light_gray_candle",
  "light_gray_stained_glass",
  "light_gray_stained_glass_pane",
  "lime_candle",
  "lime_stained_glass",
  "lime_stained_glass_pane",
  "magenta_candle",
  "magenta_stained_glass",
  "magenta_stained_glass_pane",
  "orange_candle",
  "orange_stained_glass",
  "orange_stained_glass_pane",
  "oxidized_copper_lantern",
  "pink_candle",
  "pink_stained_glass",
  "pink_stained_glass_pane",
  "purple_candle",
  "purple_stained_glass",
  "purple_stained_glass_pane",
  "red_candle",
  "red_stained_glass",
  "red_stained_glass_pane",
  "sea_lantern",
  "soul_lantern",
  "soul_torch",
  "tinted_glass",
  "torch",
  "waxed_copper_lantern",
  "waxed_exposed_copper_lantern",
  "waxed_oxidized_copper_lantern",
  "waxed_weathered_copper_lantern",
  "weathered_copper_lantern",
  "white_candle",
  "white_stained_glass",
  "white_stained_glass_pane",
  "yellow_candle",
  "yellow_stained_glass",
  "yellow_stained_glass_pane"
].map((n) => "minecraft:" + n);
function brittleAround(dim, center, reach) {
  if (CONFIG.terrain === "none") return [];
  const types = wither() ? [...FRAGILE_IDS, ...GLASS_IDS] : FRAGILE_IDS;
  const out = [];
  try {
    const lo = { x: Math.floor(center.x - reach), y: Math.floor(center.y - 3), z: Math.floor(center.z - reach) };
    const hi = { x: Math.floor(center.x + reach), y: Math.floor(center.y + 8), z: Math.floor(center.z + reach) };
    const found = dim.getBlocks(new BlockVolume(lo, hi), { includeTypes: types }, true);
    for (const p of found.getBlockLocationIterator()) {
      if (Math.hypot(p.x + 0.5 - center.x, p.z + 0.5 - center.z) > reach) continue;
      out.push({ x: p.x, y: p.y, z: p.z });
      if (out.length >= 4e3) break;
    }
  } catch {
    return null;
  }
  out.sort((a, b) => Math.hypot(a.x + 0.5 - center.x, a.z + 0.5 - center.z) - Math.hypot(b.x + 0.5 - center.x, b.z + 0.5 - center.z));
  return out;
}
function shatter(dim, at2) {
  const b = blockAt(dim, at2);
  if (!b || b.isAir) return false;
  const id = b.typeId;
  const isGlass = GLASS.test(id);
  if (!FRAGILE.test(id) && !(isGlass && wither())) return false;
  if (id.endsWith("_leaves") && b.permutation.getState("persistent_bit") === true) return false;
  if (!breakable(id)) return false;
  try {
    b.setType("minecraft:air");
  } catch {
    return false;
  }
  if (isGlass) sound(dim, "random.glass", at2, 32, 0.8, 0.9 + (at2.x + at2.z & 3) * 0.05);
  return true;
}
function breakable(id) {
  if (!id || id === "minecraft:air" || id === "minecraft:fire" || id === "minecraft:soul_fire") return false;
  if (id === "minecraft:water" || id === "minecraft:flowing_water" || id === "minecraft:lava" || id === "minecraft:flowing_lava") return false;
  if (NEVER.test(id)) return false;
  if (CONFIG.spareStorage && STORAGE.test(id)) return false;
  return true;
}
var spheres = /* @__PURE__ */ new Map();
function sphere(r) {
  const key = Math.round(r * 10);
  const hit = spheres.get(key);
  if (hit) return hit;
  const out = [];
  const R = Math.ceil(r);
  for (let x = -R; x <= R; x++) for (let y = -R; y <= R; y++) for (let z = -R; z <= R; z++) {
    const d = Math.hypot(x, y, z);
    if (d <= r) out.push([x, y, z, d]);
  }
  out.sort((a, b) => a[3] - b[3]);
  spheres.set(key, out);
  return out;
}
function carve(dim, at2, r, budget, fire = false) {
  const out = { broken: 0, floor: [] };
  if (!isLoaded(dim, at2)) return out;
  const cx = Math.floor(at2.x), cy = Math.floor(at2.y), cz = Math.floor(at2.z);
  let reads = 0;
  for (const [dx, dy, dz] of sphere(r)) {
    if (out.broken >= budget || reads > budget * 3) break;
    const p = { x: cx + dx, y: cy + dy, z: cz + dz };
    const b = blockAt(dim, p);
    reads++;
    if (!b || !breakable(b.typeId)) continue;
    try {
      b.setType("minecraft:air");
      out.broken++;
    } catch {
      continue;
    }
    if (dy <= 0) out.floor.push(p);
  }
  if (fire && out.floor.length) {
    let lit = 0;
    for (let i = 0; i < out.floor.length && lit < 4; i += 3) {
      const p = out.floor[i];
      const below = blockAt(dim, { x: p.x, y: p.y - 1, z: p.z });
      const here = blockAt(dim, p);
      if (!below || !here || !here.isAir || !isSolidBlock(below)) continue;
      try {
        here.setType("minecraft:fire");
        lit++;
      } catch {
      }
    }
  }
  return out;
}
function crush(dim, pos, forward, front, halfWidth, y0, y1, depth, budget, rockFrom = null, loud2 = true) {
  const left = { x: -forward.z, y: 0, z: forward.x };
  let broken = 0;
  const debris = [];
  for (let d = 0; d < depth && broken < budget; d++) {
    for (let w = -halfWidth; w <= halfWidth && broken < budget; w++) {
      const bx = pos.x + forward.x * (front + d) + left.x * w, bz = pos.z + forward.z * (front + d) + left.z * w;
      for (let y = y0; y <= y1 && broken < budget; y++) {
        const p = { x: bx, y: pos.y + y, z: bz };
        const b = blockAt(dim, p);
        if (!b || b.isAir || b.isLiquid) continue;
        const id = b.typeId;
        if (isNaturalGround(id) && !isPlantBlock(id) && (rockFrom === null || y < rockFrom)) continue;
        if (!breakable(id)) continue;
        try {
          b.setType("minecraft:air");
          broken++;
          if (broken % 6 === 1) debris.push(p);
        } catch {
        }
      }
    }
  }
  if (broken && loud2) {
    const mid = add(pos, { x: forward.x * (front + 0.5), y: (y0 + y1) / 2, z: forward.z * (front + 0.5) });
    sound(dim, "mob.wither.break_block", mid, 96, 1, 0.7);
    for (const p of debris.slice(0, 4)) particle(dim, "basiliskra:impact_debris", p, 72);
  }
  return broken;
}
function shatterRing(dim, center, r0, r1, samples, seed) {
  if (CONFIG.terrain === "none") return 0;
  const glass = wither();
  let reads = 0;
  for (let i = 0; i < samples; i++) {
    const r = r0 + (r1 - r0) * (i % 2 ? 0.75 : 0.25);
    const a = (i + seed % 7 * 0.13) * (Math.PI * 2 / samples);
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
        goes = !id.endsWith("_leaves") || b.permutation.getState("persistent_bit") !== true;
      } else if (glass && GLASS.test(id) && breakable(id)) goes = true;
      if (!goes) continue;
      try {
        b.setType("minecraft:air");
      } catch {
      }
      if (GLASS.test(id)) sound(dim, "random.glass", p, 32, 0.8, 0.9 + i % 5 * 0.05);
    }
  }
  return reads;
}
function mobsNear(dim, at2, r) {
  try {
    return dim.getEntities({ location: at2, maxDistance: r, families: ["mob"], excludeTypes: [TYPE, "minecraft:player"], excludeFamilies: [PART_FAMILY] });
  } catch {
    return [];
  }
}
function alive(e) {
  try {
    return !!e && e.isValid;
  } catch {
    return false;
  }
}
function blast(dim, at2, r, playerDamage, mobDamage, knock, hurtPlayer, source, from = at2, mobs) {
  for (const p of witnesses(dim, at2, r)) {
    try {
      const d = dist(add(p.location, { x: 0, y: 0.9, z: 0 }), at2);
      if (d > r) continue;
      const f = 1 - d / (r + 0.5);
      if (playerDamage > 0) hurtPlayer(p, Math.max(1, Math.round(playerDamage * f)));
      if (knock > 0) {
        const away = norm({ x: p.location.x - from.x, y: 0, z: p.location.z - from.z });
        p.applyKnockback({ x: (away.x || 0.01) * knock * f, z: (away.z || 0.01) * knock * f }, 0.35 + 0.35 * f);
      }
    } catch {
    }
  }
  for (const e of mobs ?? mobsNear(dim, at2, r)) {
    try {
      if (!e.isValid) continue;
      const loc = e.location;
      const d = dist(loc, at2);
      if (d > r + 1) continue;
      const f = Math.max(0.2, 1 - d / (r + 1));
      if (mobDamage > 0) e.applyDamage(Math.round(mobDamage * f), { cause: EntityDamageCause.entityAttack, damagingEntity: source });
      if (knock > 0) {
        const away = norm({ x: loc.x - from.x, y: 0, z: loc.z - from.z });
        e.applyKnockback({ x: (away.x || 0.01) * knock * f, z: (away.z || 0.01) * knock * f }, 0.3 + 0.3 * f);
      }
    } catch {
    }
  }
}
function segDist(p, a, d, length) {
  const t = Math.max(0, Math.min(length, (p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z));
  return dist(p, { x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t });
}

// src/path.ts
var Planner = class {
  constructor(passable, cell, start, goal, reach, maxNodes = 320) {
    this.passable = passable;
    this.cell = cell;
    this.start = start;
    this.reach = reach;
    this.maxNodes = maxNodes;
    this.done = false;
    /** Way-points (cell centres) from the first step to the end; empty if there was nowhere to go. */
    this.path = [];
    /** Did the route reach the goal, or only the nearest place to it that could be reached? */
    this.reached = false;
    this.nodes = /* @__PURE__ */ new Map();
    this.dead = /* @__PURE__ */ new Set();
    this.open = [];
    this.expanded = 0;
    this.gx = Math.round((goal.x - start.x) / cell);
    this.gz = Math.round((goal.z - start.z) / cell);
    const s = { ix: 0, iz: 0, y: start.y, g: 0, f: this.h(0, 0), from: null, open: true };
    this.nodes.set("0,0", s);
    this.open.push(s);
    this.best = s;
  }
  h(ix, iz) {
    const dx = Math.abs(ix - this.gx), dz = Math.abs(iz - this.gz);
    return Math.max(dx, dz) + 0.414 * Math.min(dx, dz);
  }
  /** Do up to `tests` world questions' worth of searching.  Returns true when finished. */
  step(tests) {
    if (this.done) return true;
    let asked = 0;
    while (asked < tests) {
      let bi = -1;
      for (let i = 0; i < this.open.length; i++) if (bi < 0 || this.open[i].f < this.open[bi].f) bi = i;
      if (bi < 0 || this.expanded >= this.maxNodes) return this.finish();
      const n = this.open.splice(bi, 1)[0];
      n.open = false;
      this.expanded++;
      if (this.h(n.ix, n.iz) < this.h(this.best.ix, this.best.iz)) this.best = n;
      if (n.ix === this.gx && n.iz === this.gz) {
        this.best = n;
        this.reached = true;
        return this.finish();
      }
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const ix = n.ix + dx, iz = n.iz + dz, key = `${ix},${iz}`;
        if (this.dead.has(key) || Math.hypot(ix, iz) * this.cell > this.reach) continue;
        let m = this.nodes.get(key);
        const step = dx && dz ? 1.414 : 1;
        if (!m) {
          asked++;
          const y = this.passable(
            this.start.x + ix * this.cell,
            this.start.z + iz * this.cell,
            n.y,
            this.start.x + n.ix * this.cell,
            this.start.z + n.iz * this.cell
          );
          if (y === null) {
            this.dead.add(key);
            continue;
          }
          if (y === false) continue;
          m = { ix, iz, y, g: n.g + step, f: 0, from: n, open: true };
          m.f = m.g + this.h(ix, iz);
          this.nodes.set(key, m);
          this.open.push(m);
        } else if (m.open && n.g + step < m.g) {
          m.g = n.g + step;
          m.f = m.g + this.h(ix, iz);
          m.from = n;
        }
      }
    }
    return false;
  }
  finish() {
    this.done = true;
    const out = [];
    for (let n = this.best; n && n.from; n = n.from) out.push({ x: this.start.x + n.ix * this.cell, y: n.y, z: this.start.z + n.iz * this.cell });
    out.reverse();
    this.path = this.h(this.best.ix, this.best.iz) < this.h(0, 0) - 0.5 ? out : [];
    return true;
  }
};

// src/store.ts
import { world as world4 } from "@minecraft/server";
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
    home: null,
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
    weather: "clear",
    fallout: []
  };
}
function migrate(raw) {
  const base = freshRecord();
  if (!raw || typeof raw !== "object") return base;
  const rec = { ...base, ...raw };
  rec.mut = { ...base.mut, ...raw.mut ?? {} };
  rec.learned = { ...base.learned, ...raw.learned ?? {} };
  if (!Array.isArray(rec.sites)) rec.sites = [];
  if (!Array.isArray(rec.fallout)) rec.fallout = [];
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
  const head = world4.getDynamicProperty(key);
  if (typeof head !== "string") return void 0;
  if (!head.startsWith("#")) return head;
  const n = parseInt(head.slice(1), 10);
  let s = "";
  for (let i = 0; i < n; i++) {
    const part = world4.getDynamicProperty(`${key}:${i}`);
    if (typeof part !== "string") return void 0;
    s += part;
  }
  return s;
}
function writeChunks(key, s) {
  if (s.length <= CHUNK) {
    world4.setDynamicProperty(key, s);
    return;
  }
  const n = Math.ceil(s.length / CHUNK);
  for (let i = 0; i < n; i++) world4.setDynamicProperty(`${key}:${i}`, s.slice(i * CHUNK, (i + 1) * CHUNK));
  world4.setDynamicProperty(key, `#${n}`);
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
var SIZES = [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 9, 11, 13];
var partCache = /* @__PURE__ */ new Map();
function partsFor(form) {
  const hit = partCache.get(form);
  if (hit) return hit;
  const scale = drawScale(form), k = scale / 16;
  const rest = new Skeleton(form, {});
  const maxEdge = SIZES[SIZES.length - 1] / k / 1.02;
  const bones = Object.entries(RIGS[form].boxes).map(([bone, [lo, hi]]) => ({ bone, lo, hi, d: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] })).sort((p, q) => q.d[0] * q.d[1] * q.d[2] - p.d[0] * p.d[1] * p.d[2]);
  const placed = [];
  const inside = (p) => placed.some((b) => Math.abs(p[0] - b.c[0]) <= b.h && Math.abs(p[1] - b.c[1]) <= b.h && Math.abs(p[2] - b.c[2]) <= b.h);
  const out = [];
  for (const { bone, lo, hi, d } of bones) {
    const sorted = [...d].sort((x, y) => y - x), L = sorted[0], M = sorted[1];
    if (L * k < 1) continue;
    let got = 0, all = 0;
    for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) for (const fz of [0.1, 0.5, 0.9]) {
      all++;
      if (inside(rest.point(bone, [lo[0] + d[0] * fx, lo[1] + d[1] * fy, lo[2] + d[2] * fz]))) got++;
    }
    if (got / all >= 0.85) continue;
    const edge = Math.min(L / M < 1.3 ? L : M, maxEdge);
    let si = SIZES.findIndex((sz) => sz >= edge * k * 1.02);
    if (si < 0) si = SIZES.length - 1;
    const half = SIZES[si] / 2 / k;
    const n = d.map((len2) => Math.max(1, Math.ceil((len2 - edge * 0.2) / edge)));
    const tag = /^(head|jaw|neck)/.test(bone) ? "head" : /^(tail|club|knob|seg(8|9|10)$|tailfin)/.test(bone) ? "tail" : /^(leg|foot|arm|forearm|claw|hand|wing|fin)/.test(bone) ? "limb" : "body";
    const lm = form === 3 ? /^(?:leg|foot)_(fl|fr|bl|br)(_lower)?$/.exec(bone) : null;
    const leg = lm ? lm[1] : void 0;
    const swing = lm ? bone.startsWith("foot") ? 1 : lm[2] ? 0.55 : 0.25 : void 0;
    for (let ix = 0; ix < n[0]; ix++) for (let iy = 0; iy < n[1]; iy++) for (let iz = 0; iz < n[2]; iz++) {
      const at2 = [ix, iy, iz].map((i, ax) => n[ax] === 1 ? (lo[ax] + hi[ax]) / 2 : lo[ax] + edge / 2 + i * (d[ax] - edge) / (n[ax] - 1));
      out.push({ bone, at: at2, si, tag, leg, swing });
      placed.push({ c: rest.point(bone, at2), h: half });
    }
  }
  partCache.set(form, out);
  return out;
}
var LEG_PHASE = { bl: 0, fl: 270, br: 180, fr: 90 };
var MOVE = {
  1: { turn: 2.2, accel: 0.02, radius: 3 },
  2: { turn: 1.4, accel: 0.03, radius: 3.1 },
  3: { turn: 1, accel: 0.011, radius: 6 }
};
var DROP = 30;
var BODY = {
  2: { built: [1.8, 3.2], cliff: 4.5, front: 4.4, look: [0.6, 2, 5, 9, 13], wade: 2, climb: 2, top: 4 },
  3: { built: [4.2, 6.1], cliff: 8.2, front: 9.4, look: [0.6, 3, 10, 17, 24], wade: 8, climb: 5.4, top: 10 }
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
    /** Form III: where the walk cycle is, in degrees (0 = left hind landing), kept by the brain from its footfalls. */
    this.walkPhase = 0;
    /** Smash through what is built in his way (wither mode, Form III, set by the brain while he walks). */
    this.smash = false;
    this.crushAt = -99;
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
    this.crushedAt = /* @__PURE__ */ new Map();
    this.tick = 0;
    // ---- a way round -------------------------------------------------------------------------------
    this.planner = null;
    this.route = [];
    this.routeGoal = null;
    this.planAt = -999;
    this.planSeen = /* @__PURE__ */ new Map();
    /** Could his middle be at x,z, coming from height y?  The floor (or swimming height) there, or null. */
    this.passable = (x, z, y, fx, fz) => {
      const n = Math.max(1, Math.ceil(Math.hypot(x - fx, z - fz)));
      if (this.form === 1) {
        for (let i = 1; i <= n; i += 2) {
          const col = waterColumn(this.dim, fx + (x - fx) * i / n, fz + (z - fz) * i / n, y + 2, 10, 28);
          if (col === UNLOADED || col === NONE || col.surface - col.floor < 3.5) return i >= n - 1 ? null : false;
        }
        return y;
      }
      const b = BODY[this.form];
      const g = groundY(this.dim, x, z, y + b.top, DROP + b.top);
      if (typeof g !== "number") return null;
      const R = MOVE[this.form].radius + 1.5, hy = Math.floor(g + b.built[0]);
      const cx = Math.floor(x), cz = Math.floor(z), n0 = Math.ceil(R);
      for (let dx = -n0; dx <= n0; dx++) for (let dz = -n0; dz <= n0; dz++) {
        if (dx * dx + dz * dz > R * R) continue;
        const key = `${cx + dx},${hy},${cz + dz}`;
        let wall = this.planSeen.get(key);
        if (wall === void 0) {
          const q = blockAt(this.dim, { x: cx + dx, y: hy, z: cz + dz });
          wall = !!q && isSolidBlock(q) && !isPlantBlock(q.typeId) && !isNaturalGround(q.typeId);
          this.planSeen.set(key, wall);
        }
        if (wall) return null;
      }
      if (trunkBlocked(this.dim, { x, y: g, z }, g, MOVE[this.form].radius, [], b.cliff, true)) return null;
      if (!this.wade && waterOver(this.dim, x, z, g, b.wade)) return null;
      if (g - y > b.climb + this.cell() * 0.5) return false;
      for (let i = 1; i < n; i++) {
        const px = fx + (x - fx) * i / n, pz = fz + (z - fz) * i / n;
        for (const h of b.built) {
          const q = blockAt(this.dim, { x: px, y: Math.max(y, g) + h, z: pz });
          if (q && isSolidBlock(q) && !isPlantBlock(q.typeId)) return false;
        }
      }
      return g;
    };
    this.crushSoundAt = -99;
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
  /** How much larger than modelled he is drawn. */
  get scale() {
    return drawScale(this.form);
  }
  skeleton() {
    return this.skel ?? (this.skel = new Skeleton(this.form, this.pose(), this.phase === "window" || this.phase === "stalk" ? 1 : 0));
  }
  anchor(locator) {
    return toWorld(this.pos, this.yaw, this.skeleton().locator(locator), this.scale);
  }
  point(bone, at2) {
    return toWorld(this.pos, this.yaw, this.skeleton().point(bone, at2), this.scale);
  }
  /** Model-unit offset (forward, up) of a sole from its rest place, at this point of the walk (as the client solves it). */
  legOffset(leg) {
    const p = ((this.walkPhase + LEG_PHASE[leg]) % 360 + 360) % 360 / 360;
    if (p < BETA_III) return [STANCE_MODEL_III * (0.5 - p / BETA_III), 0];
    const su = (p - BETA_III) / (1 - BETA_III);
    return [-STANCE_MODEL_III / 2 + STANCE_MODEL_III * su * su * (3 - 2 * su), LIFT_III * Math.sin(Math.PI * su) * (this.phase === "move" || this.phase === "stalk" ? 1 : 0)];
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
    if (!this.routeGoal || distXZ(this.routeGoal, target) > 1.5) {
      this.route = [];
      this.planner = null;
      this.routeGoal = { ...target };
      this.planAt = -999;
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
  /** He has been stopped and is working out another way: not the moment to give up on him. */
  get planning() {
    return this.planner !== null;
  }
  cell() {
    return this.form === 1 ? 5 : Math.max(4, Math.round(MOVE[this.form].radius));
  }
  /** Stopped for a while with somewhere to be: look for a route.  A few questions of the world a tick. */
  plan() {
    if (this.planner) {
      this.blocked = Math.min(this.blocked, 20);
      if (!this.planner.step(this.form === 3 ? 5 : 8)) return;
      this.route = this.planner.path;
      this.planner = null;
      this.planAt = this.tick;
      this.blocked = this.route.length ? 0 : Math.max(this.blocked, 60);
      this.steerOff = 0;
      this.steerSide = 0;
      this.goalWalled = false;
      return;
    }
    if (!this.goal || this.blocked < 14 || this.route.length || this.tick - this.planAt < 80 || this.smashing()) return;
    if (this.form === 1 && this.blockedWhy === "wall") return;
    if (this.blockedWhy === "unloaded") return;
    this.planSeen.clear();
    this.planner = new Planner(this.passable, this.cell(), { ...this.pos }, this.goal, 84);
  }
  arrived() {
    return !this.goal || distXZ(this.pos, this.goal) <= this.arriveDist;
  }
  // ---- walls -----------------------------------------------------------------------------------
  walled(at2, full) {
    const b = BODY[this.form];
    const feet = this.afloat && this.surfY != null ? Math.max(this.pos.y, this.surfY - 1.2) : this.pos.y;
    if (this.smashing()) return false;
    return trunkBlocked(this.dim, at2, feet, MOVE[this.form].radius, b.built, b.cliff, full);
  }
  /** Is there room for his middle here (used by the few moves that carry him without stepping)? */
  roomAt(at2) {
    for (const dy of [1, 3]) {
      const b = blockAt(this.dim, { x: at2.x, y: at2.y + dy, z: at2.z });
      if (b && isSolidBlock(b)) return false;
    }
    return true;
  }
  smashing() {
    return this.smash && this.form >= 3 && wither();
  }
  /**
   * He walks THROUGH what stands in his path.  In a slab ahead of his shoulders, as wide as he is and as high as
   * his back: everything built and everything grown goes, from the ground up; and the world's own rock goes
   * where it rises higher than he can step (a cliff is cut down to a step; a slope is simply walked up).  The
   * ground he walks on is never touched, so he does not sink.  A cheap probe first; the slab is only read when
   * the probe finds something standing in it.
   */
  crushAhead() {
    if (this.tick - this.crushAt < 3) return;
    const b = BODY[this.form], r = MOVE[this.form].radius;
    const top = Math.round(9.6 * this.scale), step = Math.floor(b.climb) - 1;
    const f = this.forward, l = leftOf(this.yaw);
    let found = false;
    probe: for (const s of [b.front, b.front + 2]) for (const side of [-0.8, 0, 0.8]) for (const h of [1.2, step + 0.5, top * 0.55, top - 1]) {
      const q = blockAt(this.dim, { x: this.pos.x + f.x * s + l.x * side * r, y: this.pos.y + h, z: this.pos.z + f.z * s + l.z * side * r });
      if (!q || q.isAir || q.isLiquid) continue;
      if (h < step && isNaturalGround(q.typeId) && !isPlantBlock(q.typeId)) continue;
      found = true;
      break probe;
    }
    if (!found) return;
    this.crushAt = this.tick;
    const loud2 = this.tick - this.crushSoundAt >= 14;
    const broke = crush(this.dim, this.pos, this.forward, b.front - 2, Math.ceil(r) + 1, 0, top, 5, 170, this.afloat || this.inDeep() ? null : step, loud2);
    if (broke) {
      this.speed *= 0.8;
      if (loud2) this.crushSoundAt = this.tick;
    }
  }
  /** Water deeper than this form wades: Form II drags through shallows, Form III stands belly-deep. */
  tooDeep(at2, floorY) {
    if (this.wade || this.form === 1) return false;
    return waterOver(this.dim, at2.x, at2.z, floorY, BODY[this.form].wade);
  }
  /** Already in water over his depth (swimming, or sunk to the bed): then every way is a way out. */
  inDeep() {
    return this.afloat || this.tooDeep(this.pos, this.pos.y);
  }
  clearAlong(yaw, reach) {
    const f = forwardOf(yaw);
    for (const s of BODY[this.form].look) {
      if (s > reach) break;
      const at2 = add(this.pos, mul(f, s));
      if (this.walled(at2, true)) return false;
      const floor = groundY(this.dim, at2.x, at2.z, this.pos.y + 6, DROP + 6);
      if (floor === NONE) return false;
      if (typeof floor === "number" && !this.inDeep() && this.tooDeep(at2, floor)) return false;
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
      else if (!this.route.length && d < 16 && this.walled(this.goal, false)) this.goalWalled = true;
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
    const ahead = add(this.pos, mul(this.forward, Math.max(0.6, this.speed)));
    if (moving && (this.walled(add(next, front), true) || this.walled(ahead, false)) && !this.walled(this.pos, false)) {
      this.blockedWhy = "wall";
      return null;
    }
    const lim = BODY[this.form].wade;
    if (this.tick % 5 === 0 || this.surfY === void 0) {
      const wc = waterColumn(this.dim, next.x, next.z, this.pos.y + lim, 8, 2);
      this.surfY = wc === NONE || wc === UNLOADED ? null : wc.surface;
    }
    const floatY = this.surfY !== null && this.surfY !== void 0 ? this.surfY - lim : null;
    const top = BODY[this.form].top;
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
    if (!swims && rise > (this.afloat ? lim + 1.6 : BODY[this.form].climb)) {
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
    this.plan();
    if (this.goal) {
      const d = distXZ(this.pos, this.goal);
      if (d > this.arriveDist) {
        while (this.route.length && distXZ(this.pos, this.route[0]) < this.cell() * 0.8) this.route.shift();
        const via = this.route.length ? this.route[0] : this.goal;
        const want = this.steer(yawTo(this.pos, via), this.route.length ? distXZ(this.pos, via) : d);
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
      if (this.smashing()) this.crushAhead();
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
        else if (this.blockedWhy === "edge" && this.pos.y > this.dim.heightRange.min + 8) {
          this.pos = { x: this.pos.x, y: this.pos.y - 4.5, z: this.pos.z };
          this.unsettled = true;
        }
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
    const defs = partsFor(this.form);
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      let c = this.point(d.bone, d.at);
      if (d.leg) {
        const [fwd, up] = this.legOffset(d.leg);
        const k = (d.swing ?? 1) * this.scale / 16;
        c = add(add(c, mul(this.forward, fwd * k)), { x: 0, y: up * k, z: 0 });
      }
      const si = d.si;
      const s = SIZES[si];
      const at2 = { x: c.x, y: Math.max(c.y - s / 2, this.pos.y - 0.25), z: c.z };
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
        if (!isLoaded(this.dim, at2)) continue;
        try {
          part = this.dim.spawnEntity(hitboxId(si), at2);
          partOwner.set(part.id, { creature: this, tag: d.tag });
          this.parts[i] = part;
          this.partIds[i] = part.id;
          this.partPos[i] = at2;
        } catch {
          this.parts[i] = void 0;
        }
        continue;
      }
      const last = this.partPos[i];
      if (!last || dist(last, at2) > 0.2) {
        try {
          part.teleport(at2);
          this.partPos[i] = at2;
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
  /**
   * Where a ray (a player's reach along their line of sight) first meets one of his hit volumes: the distance
   * along it and which part, or null.  The boxes are where they were last put (the same ones the game is hit on).
   */
  rayHit(from, dir, reach) {
    const defs = partsFor(this.form);
    let best = null;
    for (let i = 0; i < defs.length; i++) {
      const at2 = this.partPos[i];
      if (!at2) continue;
      const h = SIZES[defs[i].si] / 2;
      const lo = [at2.x - h, at2.y, at2.z - h], hi = [at2.x + h, at2.y + 2 * h, at2.z + h];
      const o = [from.x, from.y, from.z], d = [dir.x, dir.y, dir.z];
      let t0 = 0, t1 = reach, ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        if (Math.abs(d[a]) < 1e-9) {
          if (o[a] < lo[a] || o[a] > hi[a]) ok = false;
          continue;
        }
        let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
        if (ta > tb) {
          const s = ta;
          ta = tb;
          tb = s;
        }
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) ok = false;
      }
      if (ok && (!best || t0 < best.dist)) best = { dist: t0, tag: defs[i].tag };
    }
    return best;
  }
  /** Centre and radius of each body volume, for contact checks. */
  volumes() {
    const k = this.scale;
    const out = partsFor(this.form).map((d) => ({ at: this.point(d.bone, d.at), r: SIZES[d.si] / 2, tag: d.tag }));
    const trunk = this.form === 1 ? { h: 4.4, r: 3 } : this.form === 2 ? { h: 7.2 * k, r: 3.3 * k } : { h: 9.6 * k, r: 4.3 * k };
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
          if (this.form !== 1 && this.speed > 0.04 && this.tick - (this.crushedAt.get(p.id) ?? -99) >= 12) {
            this.crushedAt.set(p.id, this.tick);
            this.hurt(p, this.form === 3 ? 4 : 2);
          }
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
  /** A sound from him.  If it is his voice, his mouth moves with it (the client times the jaw to the recording). */
  say(id, at2, range = 56, volume = 1, pitch = 1) {
    sound(this.dim, id, at2 ?? this.pos, range, volume, pitch);
    const m = /^basiliskra\.(?:[a-z]+\.)?(grunt|growl|breath|hurt|roar|roar_short|roar_under)$/.exec(id);
    if (m) this.pulse(VOICE_KIND[m[1]]);
  }
  emit(id, at2, range = 56) {
    particle(this.dim, id, at2, range);
  }
  /** Damage a player from him (never on Peaceful when configured so; never Creative/Spectator). */
  hurt(p, amount, cause = EntityDamageCause2.entityAttack) {
    if (!targetable(p)) return false;
    if (CONFIG.harmlessOnPeaceful && String(world5.getDifficulty()).toLowerCase() === "peaceful") return false;
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
function watchersNear(c, range) {
  const out = [];
  for (const p of players()) {
    try {
      if (p.dimension.id !== c.dim.id || dist(p.location, c.pos) > range) continue;
      if (String(p.getGameMode()).toLowerCase() === "spectator") continue;
      out.push(p);
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
var VOICED = /* @__PURE__ */ new Set(["idle", "move", "look", "drink", "pin", "flinch", "beach"]);
var lastFault = "";
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
    /** His ordinary noise: a grunt, a huff or a growl every so often, from the one recording of his voice. */
    this.voiceAt = -1;
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
  voice() {
    const c = this.c, now = this.now;
    if (this.voiceAt < 0) this.voiceAt = now + 100;
    if (now < this.voiceAt) return;
    this.voiceAt = now + Math.round((10 + 12 * hash(now, 71)) * 20);
    if (!VOICED.has(c.phase) || !anyoneNear(c, 80)) return;
    const tag = ["", "i", "ii", "iii"][c.form];
    const r = hash(now, 72);
    const id = c.form === 1 ? r < 0.75 ? "i.grunt" : "i.breath" : r < 0.6 ? `${tag}.grunt` : r < 0.85 ? `${tag}.breath` : `${tag}.growl`;
    const pitch = (c.form === 1 ? 0.9 : c.form === 2 ? 1.15 : 0.96) * (0.96 + 0.08 * hash(now, 73));
    c.say(`basiliskra.${id}`, c.anchor("nose"), c.form === 3 ? 80 : 64, 0.95, pitch);
  }
  tick() {
    this.voice();
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
      const m = `${this.actName}: ${e}`;
      if (m !== lastFault) {
        lastFault = m;
        console.warn(`[basiliskra] ${m}`);
      }
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
function check(r, key, at2) {
  const p = CONFIG.pacing;
  if (r.a * p < THRESHOLD.animals || r.h * p < THRESHOLD.habitat || (r.a + r.h) * p < THRESHOLD.total) return null;
  let guilty = null, top = 0;
  for (const [id, s] of Object.entries(r.by)) if (s > top) {
    top = s;
    guilty = id;
  }
  let site = at2;
  if (r.sites.length) {
    const n = r.sites.length;
    site = { x: r.sites.reduce((s, q) => s + q.x, 0) / n, y: r.sites.reduce((s, q) => s + q.y, 0) / n, z: r.sites.reduce((s, q) => s + q.z, 0) / n };
  }
  return { region: key, site, guilty, guiltyName: guilty ? r.names[guilty] ?? null : null };
}
function tally(playerId, i) {
  const t = store.harm.tally ??= {};
  if (!t[playerId]) {
    const ids = Object.keys(t);
    if (ids.length >= 32) delete t[ids[0]];
    t[playerId] = [0, 0];
  }
  t[playerId][i]++;
}
function tallyOf(playerId) {
  const t = store.harm.tally;
  return t?.[playerId] ? [t[playerId][0], t[playerId][1]] : [0, 0];
}
function recordKill(at2, typeId, playerId, playerName, now) {
  const call = ANIMALS[typeId];
  if (!call) return null;
  const r = region(at2, now);
  const w = Math.min(1, Math.max(0.15, r.ra / 2));
  r.ra += 1;
  r.a += w;
  r.n = (r.n ?? 0) + 1;
  tally(playerId, 0);
  credit(r, playerId, playerName, w);
  const site = { x: Math.floor(at2.x), y: Math.floor(at2.y), z: Math.floor(at2.z), s: call, t: now };
  r.sites.push(site);
  if (r.sites.length > MAX_SITES) r.sites.shift();
  const all = store.rec.sites;
  all.push(site);
  if (all.length > MAX_GLOBAL_SITES) all.shift();
  store.touch();
  store.touchHarm();
  return check(r, keyOf(at2), at2);
}
function recordHabitat(at2, typeId, playerId, playerName, now) {
  const base = habitatWeight(typeId);
  if (base <= 0) return null;
  const r = region(at2, now);
  const w = base * Math.min(1, Math.max(0.3, r.rh / 2));
  r.rh += base * 2.2;
  r.h += w;
  if (base >= 0.2) {
    r.l = (r.l ?? 0) + 1;
    tally(playerId, 1);
  }
  credit(r, playerId, playerName, w);
  store.touchHarm();
  return check(r, keyOf(at2), at2);
}
function peek(r, now) {
  const c = { ...r, by: { ...r.by }, names: { ...r.names }, sites: [...r.sites] };
  decay(c, now);
  return c;
}
function report(key, r) {
  const [ix, iz] = key.split(",").map(Number);
  const center = { x: ix * REGION + REGION / 2, y: 64, z: iz * REGION + REGION / 2 };
  const a = r?.a ?? 0, h = r?.h ?? 0, p = CONFIG.pacing;
  const animals = Math.min(1, a * p / THRESHOLD.animals);
  const habitat = Math.min(1, h * p / THRESHOLD.habitat);
  const total = Math.min(1, (a + h) * p / THRESHOLD.total);
  const needA = Math.max(0, THRESHOLD.animals / p - a), needH = Math.max(0, THRESHOLD.habitat / p - h);
  const rest = Math.max(0, THRESHOLD.total / p - (a + needA) - (h + needH));
  const pct2 = Math.min(animals, habitat, total);
  return {
    center,
    key,
    animals,
    habitat,
    total,
    pct: pct2,
    progress: pct2 >= 1 ? 1 : Math.min(0.99, (animals + habitat + total) / 3),
    kills: r?.n ?? 0,
    cut: r?.l ?? 0,
    weightA: a * p,
    weightH: h * p,
    needA: THRESHOLD.animals,
    needH: THRESHOLD.habitat,
    moreKills: Math.ceil(needA + rest),
    moreLogs: Math.ceil(needH / 0.3),
    by: { ...r?.by ?? {} },
    names: { ...r?.names ?? {} },
    fired: !!r?.fired
  };
}
function angerAt(at2, now) {
  const k = keyOf(at2);
  const r = store.harm.regions[k];
  return report(k, r ? peek(r, now) : void 0);
}
function angerNear(at2, now) {
  const regs = store.harm.regions;
  const ix = Math.floor(at2.x / REGION), iz = Math.floor(at2.z / REGION);
  let best = angerAt(at2, now);
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const k = `${ix + dx},${iz + dz}`;
    const r = regs[k];
    if (!r) continue;
    const a = report(k, peek(r, now));
    if (a.progress > best.progress) best = a;
  }
  return best;
}
function angriest(now) {
  let best = null;
  for (const [k, r] of Object.entries(store.harm.regions)) {
    const a = report(k, peek(r, now));
    if (!best || a.pct > best.pct || a.pct === best.pct && a.progress > best.progress) best = a;
  }
  return best && best.total > 1e-3 ? best : null;
}
var halfLifeDays = () => HALF_LIFE / TICKS.day / CONFIG.pacing;
function clearHarm() {
  store.harm = { regions: {}, tally: {} };
  store.touchHarm();
}

// src/fallout.ts
import { BlockPermutation, BlockVolume as BlockVolume2, EntityDamageCause as EntityDamageCause3, EquipmentSlot, world as world6 } from "@minecraft/server";

// src/generated/blocks.ts
var SOIL_WAS = ["minecraft:dirt", "minecraft:grass_block", "minecraft:podzol", "minecraft:mycelium", "minecraft:moss_block", "minecraft:coarse_dirt", "minecraft:dirt_with_roots", "minecraft:sand", "minecraft:red_sand", "minecraft:gravel", "minecraft:mud", "minecraft:clay", "minecraft:snow", "minecraft:pale_moss_block"];
var ROCK_WAS = ["minecraft:stone", "minecraft:deepslate", "minecraft:granite", "minecraft:diorite", "minecraft:andesite", "minecraft:tuff", "minecraft:sandstone", "minecraft:red_sandstone", "minecraft:calcite", "minecraft:basalt", "minecraft:blackstone", "minecraft:netherrack", "minecraft:end_stone", "minecraft:dripstone_block", "minecraft:smooth_basalt", "minecraft:hardened_clay"];
var FADES_COMPONENT = "basiliskra:fades";

// src/fallout.ts
var MAX_ZONES = 32;
var SPREAD = 50 * TICKS.second;
var GROWTH = 2.4;
var R_MAX = 24;
var FADE_FROM = 0.45;
var HEAL_FROM = 0.72;
var NEAR2 = 96;
var SAMPLES_PER_TICK = 10;
var HEALS_PER_TICK = 24;
var WAS = "basiliskra:was";
var lifeOf = (s) => (2.5 + 3 * Math.min(1, s)) * 60 * TICKS.second;
var ageOf = (z, now) => Math.max(0, now - z.t);
function radiusOf(z, now = store.rec.clock) {
  const m = z.m ?? z.r, k = Math.min(1, ageOf(z, now) / SPREAD);
  return z.r + (m - z.r) * (1 - (1 - k) * (1 - k));
}
function strengthOf(z, now = store.rec.clock) {
  const a = ageOf(z, now) / lifeOf(z.s);
  if (a >= 1) return 0;
  return a <= FADE_FROM ? z.s : z.s * Math.pow(1 - (a - FADE_FROM) / (1 - FADE_FROM), 1.4);
}
var healing = (z, now) => ageOf(z, now) >= lifeOf(z.s) * HEAL_FROM;
var spreading = (z, now) => ageOf(z, now) < SPREAD && (z.m ?? z.r) > z.r + 0.5;
var SOIL_INDEX = new Map(SOIL_WAS.map((id, i) => [id, i]));
var ROCK_INDEX = new Map(ROCK_WAS.map((id, i) => [id, i]));
var FADING = [SOIL_BLOCK, ROCK_BLOCK, CRYSTAL_BLOCK, SLAG_BLOCK];
var OURS = /* @__PURE__ */ new Set([...FADING, TRINITITE_BLOCK, SLAG_COLD_BLOCK]);
var WITHERS = /^minecraft:(short_grass|fern|dandelion|poppy|.*tulip|.*_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|.*sapling|sweet_berry_bush|wildflowers|pink_petals|leaf_litter|bush|firefly_bush|deadbush|short_dry_grass)$/;
var WITHERS_TALL = /^minecraft:(tall_grass|large_fern|sunflower|lilac|rose_bush|peony|tall_dry_grass)$/;
var refused = /* @__PURE__ */ new Set();
function place(b, id, was = 0) {
  if (refused.has(id)) return false;
  try {
    if (was > 0) b.setPermutation(BlockPermutation.resolve(id, { [WAS]: was }));
    else b.setType(id);
    return true;
  } catch {
    try {
      b.setType(id);
      return true;
    } catch {
      refused.add(id);
      return false;
    }
  }
}
function setTypeOr(b, id, fallback, was = 0) {
  if (place(b, id, was)) return true;
  try {
    b.setType(fallback);
    return true;
  } catch {
    return false;
  }
}
function wasOf(b) {
  try {
    const v = b.permutation.getState(WAS);
    return typeof v === "number" ? v : 0;
  } catch {
    return 0;
  }
}
var zones = () => store.rec.fallout;
function addFallout(at2, r, s) {
  if (CONFIG.fallout === "off") return;
  const now = store.rec.clock, list = zones();
  for (const z of list) {
    const rad = radiusOf(z, now);
    if (dist(z, at2) <= Math.max(r, Math.min(rad, 8)) * 0.75) {
      z.s = Math.min(1.5, strengthOf(z, now) + s);
      z.r = Math.min(R_MAX, Math.max(rad, r));
      z.m = Math.min(R_MAX, Math.max(z.m ?? 0, z.r, r * GROWTH));
      z.t = now;
      delete z.h;
      store.touch();
      return;
    }
  }
  let wet = false;
  try {
    const b = blockAt(overworld(), { x: at2.x, y: at2.y + 1, z: at2.z });
    wet = !!b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water");
  } catch {
    wet = false;
  }
  list.push({ x: Math.floor(at2.x) + 0.5, y: Math.floor(at2.y), z: Math.floor(at2.z) + 0.5, r, m: Math.min(R_MAX, r * GROWTH), s: Math.min(1.5, s), t: now, w: wet });
  if (list.length > MAX_ZONES) {
    let weakest = 0;
    for (let i = 1; i < list.length; i++) if (strengthOf(list[i], now) < strengthOf(list[weakest], now)) weakest = i;
    list.splice(weakest, 1);
  }
  store.touch();
}
function doseAt(p, now = store.rec.clock) {
  let d = 0;
  for (const z of zones()) {
    const k = dist(p, z), R = radiusOf(z, now) + 1.5;
    if (k < R) d += strengthOf(z, now) * (1 - k / R);
  }
  return Math.min(1.5, d);
}
function hotAt(p, now) {
  for (const z of zones()) if (!healing(z, now) && dist(p, z) < radiusOf(z, now) + 2.5) return true;
  return false;
}
function nearestFallout(p, now = store.rec.clock) {
  let best = null;
  for (const z of zones()) {
    const s = strengthOf(z, now);
    if (s < 0.05) continue;
    const d = distXZ(p, z);
    if (!best || d < best.distance) best = { zone: z, strength: s, distance: d, radius: radiusOf(z, now) };
  }
  return best;
}
var falloutCount = (now = store.rec.clock) => zones().filter((z) => strengthOf(z, now) >= 0.05).length;
function clearFallout() {
  store.rec.fallout = [];
  store.touch();
}
function touchesBuilt(dim, x, y, z) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, 1]) {
      const n = blockAt(dim, { x: x + dx, y: y + dy, z: z + dz });
      if (n && isSolidBlock(n) && !isNaturalGround(n.typeId) && !isPlantBlock(n.typeId)) return true;
    }
  }
  return false;
}
function naturalLeaves(b) {
  if (!/leaves/.test(b.typeId)) return false;
  try {
    return b.permutation.getState("persistent_bit") !== true;
  } catch {
    return false;
  }
}
function puff(dim, x, y, z, what) {
  particle(dim, what === "ash" ? "basiliskra:fallout_ash" : "basiliskra:rad_glint", { x: x + 0.5, y: y + 0.6, z: z + 0.5 }, 40);
}
function sample(dim, z, s, R, salt) {
  const a = hash(salt, 1) * Math.PI * 2, rr = Math.sqrt(hash(salt, 2)) * R;
  const x = Math.floor(z.x + Math.cos(a) * rr), zz = Math.floor(z.z + Math.sin(a) * rr);
  const local = s * Math.max(0, 1 - rr / (R + 1.5));
  if (!isLoaded(dim, { x, y: z.y, z: zz })) return;
  if (hash(salt, 4) > 0.25 + local) return;
  for (let y = Math.floor(z.y) + 10; y >= Math.floor(z.y) - 8; y--) {
    const b = blockAt(dim, { x, y, z: zz });
    if (!b) return;
    const id = b.typeId;
    if (id === "minecraft:air" || /^minecraft:light_block_\d+$/.test(id) || id === CRYSTAL_BLOCK) continue;
    if (id === "minecraft:water" || id === "minecraft:flowing_water" || id === "minecraft:lava") return;
    if (naturalLeaves(b)) {
      if (local > 0.25) {
        try {
          b.setType("minecraft:air");
          puff(dim, x, y, zz, "ash");
        } catch {
        }
      }
      return;
    }
    if (isPlantBlock(id)) continue;
    if (WITHERS_TALL.test(id)) {
      try {
        blockAt(dim, { x, y: y + 1, z: zz })?.setType("minecraft:air");
        b.setType("minecraft:air");
        puff(dim, x, y, zz, "ash");
      } catch {
      }
      return;
    }
    if (WITHERS.test(id) || id === "minecraft:snow_layer") {
      try {
        b.setType("minecraft:air");
        puff(dim, x, y, zz, "ash");
      } catch {
      }
      return;
    }
    if (!isSolidBlock(b)) continue;
    const above = blockAt(dim, { x, y: y + 1, z: zz });
    if (!above || isSolidBlock(above)) return;
    if (OURS.has(id)) {
      if (id !== SLAG_BLOCK && local > 0.3 && above.isAir && hash(x, zz, 77) < 0.075 && place(above, CRYSTAL_BLOCK)) {
        puff(dim, x, y + 1, zz, "glint");
        sound(dim, "place.amethyst_cluster", { x: x + 0.5, y: y + 1, z: zz + 0.5 }, 24, 0.7, 0.6 + hash(salt, 9) * 0.3);
      }
      return;
    }
    const soil = SOIL_INDEX.get(id), rock = ROCK_INDEX.get(id);
    if (soil === void 0 && rock === void 0) return;
    if (touchesBuilt(dim, x, y, zz)) return;
    if (soil !== void 0) {
      if (setTypeOr(b, SOIL_BLOCK, "minecraft:coarse_dirt", soil)) puff(dim, x, y, zz, "glint");
    } else if (local > 0.2 && place(b, ROCK_BLOCK, rock)) puff(dim, x, y, zz, "glint");
    return;
  }
}
function revert(b) {
  const id = b.typeId;
  try {
    if (id === SOIL_BLOCK) {
      b.setType(SOIL_WAS[wasOf(b)] ?? SOIL_WAS[0]);
      return true;
    }
    if (id === ROCK_BLOCK) {
      b.setType(ROCK_WAS[wasOf(b)] ?? ROCK_WAS[0]);
      return true;
    }
    if (id === SLAG_BLOCK) {
      if (!place(b, SLAG_COLD_BLOCK)) b.setType("minecraft:blackstone");
      return true;
    }
    if (id === CRYSTAL_BLOCK) {
      b.setType("minecraft:air");
      const at2 = b.location;
      particle(b.dimension, "basiliskra:crystal_break", { x: at2.x + 0.5, y: at2.y + 0.4, z: at2.z + 0.5 }, 32);
      sound(b.dimension, "break.amethyst_cluster", { x: at2.x + 0.5, y: at2.y + 0.4, z: at2.z + 0.5 }, 20, 0.5, 0.7);
      return true;
    }
  } catch {
  }
  return false;
}
function fadeBlock(b) {
  try {
    if (b.dimension.id !== OVERWORLD) {
      revert(b);
      return;
    }
    const at2 = b.location;
    if (CONFIG.fallout !== "land" || !hotAt({ x: at2.x + 0.5, y: at2.y + 0.5, z: at2.z + 0.5 }, store.rec.clock)) revert(b);
  } catch {
  }
}
var healQueue = [];
function healStep(dim, z) {
  const R = Math.ceil(z.m ?? z.r) + 3, tiles = Math.ceil((2 * R + 1) / 16), i = z.h ?? 0;
  if (i >= tiles * tiles) return true;
  const x0 = Math.floor(z.x) - R + i % tiles * 16, z0 = Math.floor(z.z) - R + Math.floor(i / tiles) * 16;
  const lo = { x: x0, y: Math.floor(z.y) - 14, z: z0 }, hi = { x: Math.min(x0 + 15, Math.floor(z.x) + R), y: Math.floor(z.y) + 14, z: Math.min(z0 + 15, Math.floor(z.z) + R) };
  if (!isLoaded(dim, lo) || !isLoaded(dim, hi)) return false;
  try {
    for (const p of dim.getBlocks(new BlockVolume2(lo, hi), { includeTypes: FADING }, true).getBlockLocationIterator()) healQueue.push({ x: p.x, y: p.y, z: p.z });
  } catch {
    return false;
  }
  z.h = i + 1;
  store.touch();
  return false;
}
function fuse(b) {
  if (CONFIG.fallout !== "land") return false;
  if (b.typeId !== "minecraft:sand" && b.typeId !== "minecraft:red_sand") return false;
  try {
    if (touchesBuilt(b.dimension, b.location.x, b.location.y, b.location.z)) return false;
  } catch {
    return false;
  }
  return setTypeOr(b, TRINITITE_BLOCK, "minecraft:smooth_basalt");
}
function sear(dim, floor, max) {
  if (CONFIG.fallout !== "land") return 0;
  let n = 0;
  for (let i = 0; i < floor.length && n < max; i += 2) {
    const p = floor[i];
    const b = blockAt(dim, { x: p.x, y: p.y - 1, z: p.z });
    if (!b || !isSolidBlock(b)) continue;
    const id = b.typeId;
    if (id === "minecraft:sand" || id === "minecraft:red_sand") {
      if (fuse(b)) n++;
      continue;
    }
    if (!ROCK_INDEX.has(id) && id !== ROCK_BLOCK && id !== "minecraft:cobblestone" && id !== "minecraft:gravel") continue;
    if (touchesBuilt(dim, p.x, p.y - 1, p.z)) continue;
    if (place(b, SLAG_BLOCK)) n++;
  }
  return n;
}
var cursor = 0;
var doseOf = /* @__PURE__ */ new Map();
var fogged = /* @__PURE__ */ new Set();
var absorbed = /* @__PURE__ */ new Map();
var BURN_AFTER = 4;
var FOG = "bk_fallout";
function falloutTick(now) {
  const list = zones();
  if (now % 10 === 0) counterTick(now);
  if (CONFIG.fallout === "off" || !list.length) return;
  const dim = overworld(), ps = players().filter((p) => {
    try {
      return p.dimension.id === OVERWORLD;
    } catch {
      return false;
    }
  });
  if (now % 100 === 0) {
    const keep = list.filter((z) => {
      const over = ageOf(z, now) - lifeOf(z.s);
      if (over < 0) return true;
      const R = Math.ceil(z.m ?? z.r) + 3, tiles = Math.ceil((2 * R + 1) / 16);
      return !(z.w || CONFIG.fallout !== "land" || (z.h ?? 0) >= tiles * tiles || over > 20 * 60 * TICKS.second);
    });
    if (keep.length !== list.length) {
      store.rec.fallout = keep;
      store.touch();
    }
  }
  if (!ps.length) return;
  const live = list.filter((z) => ps.some((p) => distXZ(p.location, z) < NEAR2));
  if (!live.length) return;
  if (CONFIG.fallout === "land") {
    const land = live.filter((z) => !z.w && !healing(z, now));
    for (let i = 0; i < SAMPLES_PER_TICK && land.length; i++) {
      const z = land[cursor++ % land.length];
      sample(dim, z, strengthOf(z, now), radiusOf(z, now), now * 13 + i * 7 + cursor);
    }
    for (let n = 0; n < HEALS_PER_TICK && healQueue.length; n++) {
      const b = blockAt(dim, healQueue.pop());
      if (b) revert(b);
    }
    if (!healQueue.length && now % 4 === 0) {
      for (const q of live) {
        if (q.w || !healing(q, now)) continue;
        const before = q.h ?? 0;
        healStep(dim, q);
        if ((q.h ?? 0) !== before) break;
      }
    }
  }
  if (now % 8 === 0) {
    let shown = 0;
    for (const z of live) {
      const s = strengthOf(z, now);
      if (s < 0.05 || shown >= 8) continue;
      shown++;
      const R = radiusOf(z, now), at2 = { x: z.x, y: z.y + 0.6, z: z.z };
      if (hash(now, z.x, z.z) < Math.min(1, 0.35 + s)) particle(dim, "basiliskra:rad_cloud", at2, 72, sizeVars(R));
      if (now % 16 === 0 && spreading(z, now)) particle(dim, "basiliskra:rad_front", at2, 80, sizeVars(R));
      if (s > 0.4 && now % 24 === 0) {
        const a = hash(now, z.x, 2) * Math.PI * 2, rr = Math.sqrt(hash(now, z.z, 3)) * R * 0.6;
        particle(dim, "basiliskra:rad_shimmer", { x: z.x + Math.cos(a) * rr, y: z.y + 0.6, z: z.z + Math.sin(a) * rr }, 40);
      }
    }
  }
  if (now % 40 === 0) sicken(dim, live, now, ps);
}
function counterTick(now) {
  for (const p of players()) {
    let at2;
    try {
      if (p.dimension.id !== OVERWORLD) {
        clearFog(p);
        continue;
      }
      at2 = p.location;
    } catch {
      continue;
    }
    const d = CONFIG.fallout === "off" ? 0 : doseAt(at2, now);
    doseOf.set(p.id, d);
    const holding = holdsCounter(p);
    const level = d < 0.03 ? 0 : d < 0.2 ? 1 : d < 0.45 ? 2 : d < 0.75 ? 3 : 4;
    if (level > 0 || holding && d > 5e-3) {
      try {
        p.playSound(`basiliskra.geiger.${Math.max(1, level)}`, { volume: holding ? 0.9 : 0.6 });
      } catch {
      }
    }
    if (d >= 0.3 && !fogged.has(p.id)) {
      try {
        p.runCommand(`fog @s push basiliskra:fallout_fog ${FOG}`);
        fogged.add(p.id);
      } catch {
      }
    } else if (d < 0.2 && fogged.has(p.id)) clearFog(p);
    if (holding) {
      const n = nearestFallout(at2, now);
      const where = n && n.distance > n.radius ? `  §7fallout §f${Math.round(n.distance - n.radius)}§7 blocks ${direction(at2, n.zone)}` : "";
      const colour = level >= 3 ? "§c" : level >= 1 ? "§6" : "§a";
      const shield = protectedFor(p, now);
      try {
        p.onScreenDisplay.setActionBar(`${colour}Radiation ${Math.round(Math.min(1, d) * 100)}%${shield > 0 ? `  §bIodine ${Math.ceil(shield / TICKS.second)}s` : ""}${where}`);
      } catch {
      }
    } else if (level >= 3 && now % 40 === 0) {
      try {
        p.onScreenDisplay.setActionBar(protectedFor(p, now) > 0 ? "§6Heavy fallout §7(the iodine is holding)" : "§cHeavy fallout: get out of the red");
      } catch {
      }
    }
    try {
      const under = blockAt(p.dimension, { x: at2.x, y: at2.y - 0.3, z: at2.z });
      if (under?.typeId === SLAG_BLOCK && vulnerable(p)) {
        p.setOnFire(4, true);
        p.applyDamage(2 * CONFIG.damage, { cause: EntityDamageCause3.fire });
      }
    } catch {
    }
  }
}
function clearFog(p) {
  if (!fogged.delete(p.id)) return;
  try {
    p.runCommand(`fog @s remove ${FOG}`);
  } catch {
  }
}
function falloutJoin(p) {
  fogged.delete(p.id);
  try {
    p.runCommand(`fog @s remove ${FOG}`);
  } catch {
  }
}
var IODINE_TICKS = 4 * 60 * TICKS.second;
var IODINE_PROP = "bk:iodine";
function protectedFor(p, now = store.rec.clock) {
  try {
    const until = p.getDynamicProperty(IODINE_PROP);
    return typeof until === "number" ? Math.max(0, Math.min(IODINE_TICKS, until - now)) : 0;
  } catch {
    return 0;
  }
}
function takeIodine(p) {
  try {
    p.setDynamicProperty(IODINE_PROP, store.rec.clock + IODINE_TICKS);
    for (const e of ["hunger", "weakness", "nausea", "poison", "wither"]) {
      try {
        p.removeEffect(e);
      } catch {
      }
    }
    p.onScreenDisplay.setActionBar("§bIodine: the fallout cannot make you sick for four minutes. §7(Glowing slag still burns.)");
    p.playSound("random.orb", { volume: 0.6, pitch: 0.7 });
  } catch {
  }
}
var isIodine = (id) => id === IODINE_ITEM;
function holdsCounter(p) {
  try {
    return p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId === COUNTER_ITEM;
  } catch {
    return false;
  }
}
function direction(from, to) {
  const a = Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI;
  return ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"][(Math.round(a / 45) % 8 + 8) % 8];
}
function vulnerable(p) {
  try {
    if (CONFIG.harmlessOnPeaceful && String(world6.getDifficulty()).toLowerCase() === "peaceful") return false;
    const gm = String(p.getGameMode()).toLowerCase();
    return gm !== "creative" && gm !== "spectator";
  } catch {
    return false;
  }
}
function sicken(dim, live, now, ps) {
  if (!CONFIG.sickness) return;
  for (const p of ps) {
    const d = doseOf.get(p.id) ?? 0;
    const open = vulnerable(p) && protectedFor(p, now) <= 0;
    const took = Math.max(0, (absorbed.get(p.id) ?? 0) + (open && d > 0.5 ? d : -0.75));
    if (took > 0) absorbed.set(p.id, Math.min(12, took));
    else absorbed.delete(p.id);
    if (d < 0.1 || !open) continue;
    try {
      p.addEffect("hunger", 100, { amplifier: d > 0.5 ? 2 : d > 0.3 ? 1 : 0, showParticles: false });
      if (d > 0.3) {
        p.addEffect("weakness", 100, { amplifier: d > 0.7 ? 1 : 0, showParticles: false });
        p.addEffect("nausea", 140, { amplifier: 0, showParticles: false });
      }
      if (d > 0.5) p.addEffect("poison", 60, { amplifier: d > 0.9 ? 1 : 0, showParticles: false });
      if (d > 0.8 && took >= BURN_AFTER) p.applyDamage(Math.max(1, Math.round(2 * CONFIG.damage)), { cause: EntityDamageCause3.magic });
    } catch {
    }
  }
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
        } catch {
        }
      }
    } catch {
    }
  }
}

// src/ui.ts
var ROMAN = ["", "I", "II", "III"];
var FALLOUT = ["off", "visual", "land"];
var DUSK = 11800;
function canAdmin(p) {
  try {
    if (p.playerPermissionLevel === PlayerPermissionLevel.Operator) return true;
  } catch {
  }
  try {
    return world7.getAllPlayers().length <= 1;
  } catch {
    return false;
  }
}
var pct = (f) => `${Math.floor(Math.max(0, Math.min(1, f)) * 100)}%`;
function bar(f, colour = "§c") {
  const n = Math.round(Math.max(0, Math.min(1, f)) * 20);
  return `${colour}${"|".repeat(n)}§8${"|".repeat(20 - n)}§r`;
}
function mins(ticks) {
  const m = Math.max(0, ticks) / TICKS.minute;
  if (m < 1) return "less than a minute";
  if (m < 90) return `about ${Math.round(m)} minute${Math.round(m) === 1 ? "" : "s"}`;
  return `about ${(m / 60).toFixed(1)} hours`;
}
function compass(from, to) {
  const dx = to.x - from.x, dz = to.z - from.z;
  if (Math.hypot(dx, dz) < 4) return "right here";
  const names = ["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"];
  const a = Math.atan2(-dx, dz) * 180 / Math.PI;
  return `${Math.round(Math.hypot(dx, dz))} blocks ${names[(Math.round(a / 45) % 8 + 8) % 8]}`;
}
var at = (v) => `${Math.floor(v.x)}, ${Math.floor(v.y)}, ${Math.floor(v.z)}`;
async function present(p, show) {
  for (let i = 0; i < 20; i++) {
    let r;
    try {
      r = await show();
    } catch {
      return void 0;
    }
    if (r.canceled && r.cancelationReason === FormCancelationReason.UserBusy) {
      await new Promise((res) => system2.runTimeout(() => res(), 8));
      continue;
    }
    return r;
  }
  return void 0;
}
function angerLines(p, a, here) {
  const L = [];
  const where = `around ${Math.floor(a.center.x)}, ${Math.floor(a.center.z)}`;
  L.push(here ? `§fNear you §7(the 64-block area ${where})` : `§fThe angriest area: ${where} §7(${compass(p.location, a.center)})`);
  L.push(`  ${bar(a.progress)} §l${pct(a.progress)}§r §7of what calls him`);
  L.push(`  §7Animals killed here by players: §f${a.kills}§7 (they count as §f${a.weightA.toFixed(1)}§7 of the §f${a.needA}§7 it takes)`);
  L.push(`  §7Logs, reeds and shore plants cut here: §f${a.cut}§7 (they count as §f${a.weightH.toFixed(1)}§7 of the §f${a.needH}§7 it takes)`);
  if (a.fired) L.push("  §7He has already been called from here.");
  else if (a.pct < 1) {
    L.push(`  §7Both are needed. Still to go here: about §f${a.moreKills}§7 more animal${a.moreKills === 1 ? "" : "s"} and §f${a.moreLogs}§7 more logs.`);
    L.push("  §8The first kills of a spree and the first logs of a tree count for less; repeated harm counts in full.");
  }
  const total = Object.values(a.by).reduce((s, v) => s + v, 0);
  const mine = a.by[p.id] ?? 0;
  if (total > 0) L.push(`  §7Your share of it: §f${pct(mine / total)}`);
  return L;
}
function evolveLines() {
  const rec = store.rec, now = rec.clock, L = [];
  const need = pace(2 * TICKS.day), since = now - rec.mut.formSince;
  const days = Math.min(1, since / need);
  const item = (done, text) => `  ${done ? "§a[x]" : "§c[ ]"} §7${text}`;
  const wait2 = days >= 1 ? "" : ` §8(about ${Math.max(1, Math.ceil((need - since) / TICKS.minute))} min left)`;
  if (rec.evolve) {
    L.push("§cHe is changing right now.");
    return L;
  }
  if (rec.form === 1) {
    const s = Math.min(1, rec.mut.surfacings / 6), e = Math.min(1, rec.mut.episodes / 3), f = Math.min(days, s, e);
    L.push(`§fBecoming Basiliskra II: ${bar(f, "§6")} §l${pct(f)}§r`);
    L.push("§7All three of these, then the last step:");
    L.push(item(days >= 1, `Two days in the water: ${pct(days)}${wait2}`));
    L.push(item(s >= 1, `Seen at the surface ${Math.min(rec.mut.surfacings, 6)} of 6 times §8(he comes up under boats and near swimmers)`));
    L.push(item(e >= 1, `Spasms ${Math.min(rec.mut.episodes, 3)} of 3 §8(they take him near piers, and in open water at dusk)`));
    L.push(`  §e->§7 Then he beaches on a sand or gravel shore with a player near, and changes there${f >= 1 ? " §a(he is ready: go and stand on a beach)" : ""}.`);
  } else if (rec.form === 2) {
    const o = Math.min(1, rec.mut.overland * CONFIG.pacing / 220), f = Math.min(days, o);
    L.push(`§fBecoming Basiliskra III: ${bar(f, "§6")} §l${pct(f)}§r`);
    L.push("§7Both of these, then the last step:");
    L.push(item(days >= 1, `Two days on the shore: ${pct(days)}${wait2}`));
    L.push(item(o >= 1, `Dragged himself overland ${Math.floor(Math.min(220, rec.mut.overland * CONFIG.pacing))} of 220 blocks §8(he wanders while anyone is near)`));
    L.push(`  §e->§7 Then he changes at night or in rain, with a player near${f >= 1 ? " §a(he is ready: wait for dark or rain, and stay close)" : ""}.`);
  } else {
    L.push("§fThe last crossing");
    L.push("  §7Carry his shed fin to the seam; play his three knocks on note blocks near it and keep playing; lead his charge into a lightning rod near the seam.");
  }
  if (rec.form < 3) L.push("  §8An operator's config wheel can also make him change at once.");
  return L;
}
function comingLines(p, ctl2) {
  const rec = store.rec, now = rec.clock, L = [];
  const tod = world7.getTimeOfDay();
  const toDusk = tod >= DUSK && tod < 13800 ? 0 : (DUSK - tod + 24e3) % 24e3;
  switch (rec.stage) {
    case "dormant":
      L.push("§7Not yet. When one place reaches §f100%§7 he is called through deep water near it.");
      L.push("§7He needs open water about §f6 blocks deep§7 with a clear run of about §f45 blocks§7 within ~90 blocks of that place. Harm far inland calls no one.");
      break;
    case "pending": {
      const pd = rec.pending;
      L.push(`§eHe has been called§7, by what was done near §f${Math.floor(pd.site.x)}, ${Math.floor(pd.site.z)}§7 (${compass(p.location, pd.site)}).`);
      L.push(`§7He is looking for deep, open water there (search ${Math.min(12, (pd.passes ?? 0) + 1)} of 12). Someone must be within 128 blocks of that place.`);
      if ((pd.passes ?? 0) >= 4) L.push("§7No water has been deep and open enough so far. Harm nearer a coast or a big lake will call him there instead.");
      break;
    }
    case "arriving": {
      const a = rec.arrival;
      if (a.step === 0) {
        L.push(`§eHe is coming§7, through the water at §f${at(a.water)}§7 (${compass(p.location, a.water)}).`);
        L.push(toDusk === 0 ? "§7At dusk, which is now: someone must be within 96 blocks of that water." : `§7At the next dusk, in §f${mins(toDusk)}§7, while someone is within 96 blocks of that water.`);
      } else L.push(`§cHe is coming through now§7, at §f${at(a.water)}§7 (${compass(p.location, a.water)}).`);
      break;
    }
    case "alive": {
      const c = ctl2.creature;
      if (c && c.valid) {
        let hp = "";
        try {
          const h = c.entity.getComponent("minecraft:health");
          if (h) hp = ` §7Health §f${Math.ceil(h.currentValue)}/${h.effectiveMax}`;
        } catch {
        }
        L.push(`§cBasiliskra ${ROMAN[rec.form]} is here§7, ${compass(p.location, c.pos)}.${hp}`);
      } else if (rec.entityId === null && rec.down !== null) {
        const left = pace(TICKS.day) - (now - rec.down);
        L.push(`§7Driven off. He comes back through the seam at §f${rec.rift ? at(rec.rift) : "the old place"}§7 in §f${mins(left)}§7, when someone is near it.`);
      } else if (rec.last) {
        L.push(`§7Basiliskra ${ROMAN[rec.form]} is out of reach. Last seen near §f${at(rec.last)}§7 (${compass(p.location, rec.last)}), ${mins(now - rec.last.t)} ago.`);
      } else L.push(`§7Basiliskra ${ROMAN[rec.form]} is out of reach.`);
      if (rec.guiltyName) L.push(`§7He remembers §f${rec.guiltyName}§7.`);
      break;
    }
    case "departed":
      L.push("§7He has gone home. The story in this world is over; nothing calls another.");
      break;
  }
  return L;
}
function falloutLines(p) {
  const L = [], now = store.rec.clock;
  let at2;
  try {
    if (p.dimension.id !== OVERWORLD) return ["§7Only the Overworld carries his fallout."];
    at2 = p.location;
  } catch {
    return L;
  }
  const d = doseAt(at2, now);
  const word = d < 0.03 ? "§anone to speak of" : d < 0.2 ? "§6low" : d < 0.45 ? "§6rising" : d < 0.75 ? "§chigh" : "§4deadly";
  L.push(`§fRadiation where you stand: ${bar(Math.min(1, d))} §l${pct(d)}§r  ${word}`);
  const n = nearestFallout(at2, now), count = falloutCount(now);
  if (!n) L.push("§7No fallout on record. His beam, his changes and his seam leave it where they touch the world.");
  else {
    L.push(`§7Fallout in §f${count}§7 place${count === 1 ? "" : "s"}. The nearest is ${compass(at2, n.zone)}, at §f${pct(n.strength)}§7.`);
    L.push("§7It spreads for about a minute, stands a while, then fades and is gone within a few minutes.");
    if (CONFIG.fallout === "land") L.push("§7In it the ground glows: soil and rock turn irradiated, plants wither, wild leaves fall and crimson crystals grow (break them for shards). Where his beam lands, rock runs to glowing slag and sand fuses to scarlet trinitite. As it fades the land heals back to what it was.");
    if (CONFIG.sickness) L.push("§7It is strong: hunger, then weakness and nausea, then poison, and the heart of a fresh zone burns. Iodine tablets (2 dried kelp, sugar) keep it off for four minutes; milk clears it. A Geiger counter (trinitite or a crimson shard, copper ingot, redstone) reads it.");
  }
  return L;
}
function journalText(p, ctl2) {
  const now = store.rec.clock, L = [];
  L.push("§l§4HIS ANGER§r");
  let here = null;
  try {
    if (p.dimension.id === OVERWORLD) here = angerNear(p.location, now);
  } catch {
    here = null;
  }
  if (here) L.push(...angerLines(p, here, true));
  else L.push("§7Only what is done in the Overworld counts.");
  const top = angriest(now);
  if (top && (!here || top.key !== here.key)) {
    L.push("");
    L.push(...angerLines(p, top, false));
  }
  const [k, c] = tallyOf(p.id);
  L.push(`§7You, everywhere: §f${k}§7 animal${k === 1 ? "" : "s"} killed, §f${c}§7 log${c === 1 ? "" : "s"} and plants cut.`);
  L.push(`§8Anger is kept per 64-block area. Left alone, an area's anger halves every ${halfLifeDays().toFixed(1)} in-game days.`);
  L.push("");
  L.push("§l§4WHEN HE COMES§r");
  L.push(...comingLines(p, ctl2));
  if (store.rec.stage === "alive" || store.rec.stage === "arriving") {
    L.push("");
    L.push("§l§4HIM§r");
    L.push(...evolveLines());
  }
  if (CONFIG.fallout !== "off") {
    L.push("");
    L.push("§l§4FALLOUT§r");
    L.push(...falloutLines(p));
  }
  return L.join("\n");
}
async function openJournal(p, ctl2) {
  for (; ; ) {
    const f = new ActionFormData().title("Basiliskra Journal").body(journalText(p, ctl2)).button("Read again").button("Close");
    if (canAdmin(p)) f.button("Config wheel");
    const r = await present(p, () => f.show(p));
    if (!r || r.canceled) return;
    if (r.selection === 0) continue;
    if (r.selection === 2) await openWheel(p, ctl2);
    return;
  }
}
function placeFor(p, form) {
  const v = p.getViewDirection();
  const n = Math.hypot(v.x, v.z) || 1;
  const d = [0, 15, 24, 46][form] ?? 30;
  const pl = p.location;
  const pos = { x: pl.x + v.x / n * d, y: pl.y, z: pl.z + v.z / n * d };
  const dimension = overworld();
  let g = groundY(dimension, pos.x, pos.z, pl.y + 24, 48);
  if (g === NONE) g = groundY(dimension, pos.x, pos.z, pl.y - 24, pl.y - 24 - dimension.heightRange.min);
  if (g !== UNLOADED && g !== NONE) pos.y = g;
  const yaw = Math.atan2(-(pl.x - pos.x), pl.z - pos.z) * 180 / Math.PI;
  return { at: pos, yaw };
}
function formOf(rec = store.rec) {
  return rec.born > 0 ? rec.form : 0;
}
var SPEEDS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
var DAMAGES = [0, 0.25, 0.5, 1, 1.5, 2, 3, 4];
var TERRAIN = ["none", "scorch", "break", "wither"];
function presetList(values, current, def, word) {
  const items = values.map((v) => `${word(v)}${v === def ? " (default)" : ""}`);
  let index = values.indexOf(current);
  items.push(index < 0 ? `Custom: x${current}` : "Custom (type it in the box below)");
  if (index < 0) index = values.length;
  return { items, index };
}
function typedNumber(typed) {
  const t = typeof typed === "string" ? typed.trim().replace(/^x/i, "").replace(",", ".") : "";
  return t === "" ? void 0 : Number(t);
}
var typedBad = (typed, lo, hi) => {
  const n = typedNumber(typed);
  return n !== void 0 && !(n >= lo && n <= hi);
};
function pickNumber(values, index, typed, current, lo, hi) {
  const n = typedNumber(typed);
  if (n !== void 0 && n >= lo && n <= hi) return Math.round(n * 100) / 100;
  const i = Number(index);
  return Number.isInteger(i) && i >= 0 && i < values.length ? values[i] : current;
}
async function settingsForm(p) {
  const speed = presetList(SPEEDS, CONFIG.pacing, 1, (v2) => `x${v2}${v2 < 1 ? " (slower)" : v2 > 1 ? " (faster)" : ""}`);
  const dmg = presetList(DAMAGES, CONFIG.damage, 1, (v2) => v2 === 0 ? "None (x0)" : `x${v2}`);
  const f = new ModalFormData().title("Basiliskra Settings").dropdown("Story speed", speed.items, { defaultValueIndex: speed.index, tooltip: "x2 halves every wait and threshold; x0.5 doubles them." }).textField("...or type a story speed (0.25 to 4)", "e.g. 1.25").dropdown("What his beam, roar and weight do to the world", [
    "Nothing (light and sound only)",
    "Scorch natural ground",
    "Scorch and break natural ground",
    "Destroy everything, like the Wither (default)"
  ], { defaultValueIndex: Math.max(0, TERRAIN.indexOf(CONFIG.terrain)) }).toggle("Spare chests, beds, furnaces and portals", { defaultValue: CONFIG.spareStorage }).toggle("Footprints and furrows in natural ground", { defaultValue: CONFIG.marks }).dropdown("Damage to players", dmg.items, { defaultValueIndex: dmg.index }).textField("...or type a damage multiplier (0 to 4)", "e.g. 0.75").toggle("Harmless on Peaceful", { defaultValue: CONFIG.harmlessOnPeaceful }).toggle("He hunts animals and other creatures too", { defaultValue: CONFIG.huntMobs }).toggle("Spawn eggs and /summon bring him to you", { defaultValue: CONFIG.allowSummon }).dropdown("A spawn egg makes", ["His stage in the story", "Basiliskra I", "Basiliskra II", "Basiliskra III"], { defaultValueIndex: CONFIG.spawnForm }).toggle("Give new players the journal", { defaultValue: CONFIG.giveJournal }).toggle("Give operators the config wheel", { defaultValue: CONFIG.giveWheel }).toggle("Debug messages in the content log", { defaultValue: CONFIG.debug }).dropdown("His fallout", ["Off", "Glowing motes and Geiger clicks only", "Also changes the land (natural ground only)"], { defaultValueIndex: FALLOUT.indexOf(CONFIG.fallout) }).toggle("Radiation sickness for players", { defaultValue: CONFIG.sickness }).toggle("Cutscenes (the rift, each transformation)", { defaultValue: CONFIG.cutscenes }).toggle("His music", { defaultValue: CONFIG.music }).toggle("§cRestore every default", { defaultValue: false }).submitButton("Save");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  if (v[18] === true) {
    resetSettings();
    p.sendMessage("§7[Basiliskra] Settings restored to the defaults.");
    return;
  }
  const pacing = pickNumber(SPEEDS, v[0], v[1], CONFIG.pacing, 0.25, 4);
  const damage = pickNumber(DAMAGES, v[5], v[6], CONFIG.damage, 0, 4);
  const bad = typedBad(v[1], 0.25, 4) || typedBad(v[6], 0, 4);
  saveSettings({
    pacing,
    terrain: TERRAIN[Number(v[2])] ?? "wither",
    spareStorage: v[3] === true,
    marks: v[4] === true,
    damage,
    harmlessOnPeaceful: v[7] === true,
    huntMobs: v[8] === true,
    allowSummon: v[9] === true,
    spawnForm: Number(v[10]),
    giveJournal: v[11] === true,
    giveWheel: v[12] === true,
    debug: v[13] === true,
    fallout: FALLOUT[Number(v[14])] ?? "land",
    sickness: v[15] === true,
    cutscenes: v[16] === true,
    music: v[17] === true
  });
  p.sendMessage(`§7[Basiliskra] Settings saved with this world. Story speed §fx${CONFIG.pacing}§7, damage §fx${CONFIG.damage}§7.`);
  if (bad) p.sendMessage("§7[Basiliskra] A number you typed was not in range, so the choice above it was used.");
}
async function bringForm(p, ctl2) {
  const f = new ActionFormData().title("Bring him here").body(`§7The one Basiliskra comes to you: moved here if he is about, made here if he is not. There is never more than one.
§7Now: ${store.rec.born > 0 ? `Basiliskra ${ROMAN[store.rec.form]}` : "he has never come"}.`).button("As he is in the story").button("Basiliskra I (the water)").button("Basiliskra II (the shore)").button("Basiliskra III (four footfalls)");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || r.selection === void 0) return;
  if (p.dimension.id !== OVERWORLD) {
    p.sendMessage("§7[Basiliskra] He only lives in the Overworld.");
    return;
  }
  const want = r.selection;
  const place2 = placeFor(p, want || formOf() || 3);
  p.sendMessage(`§7[Basiliskra] ${ctl2.bringHere(place2.at, place2.yaw, want)}`);
}
async function confirm(p, title, body) {
  const f = new MessageFormData().title(title).body(body).button1("Yes").button2("No");
  const r = await present(p, () => f.show(p));
  return !!r && !r.canceled && r.selection === 0;
}
async function openWheel(p, ctl2) {
  if (!canAdmin(p)) {
    p.sendMessage("§7[Basiliskra] Only an operator can use the config wheel.");
    return;
  }
  const rec = store.rec;
  const here = ctl2.creature && ctl2.creature.valid;
  const state = here ? `§cBasiliskra ${ROMAN[rec.form]} is here` : rec.stage === "arriving" ? "§ehe is coming through" : rec.stage === "alive" ? `§7Basiliskra ${ROMAN[rec.form]} is away, owed back` : "§7he is not in this world";
  const f = new ActionFormData().title("Basiliskra Config Wheel").body(`${state}§7 · Story speed §fx${CONFIG.pacing}§7 · Damage §fx${CONFIG.damage}`).button("Settings").button("Call him now (the rift opens)").button("Bring him here (no rift, pick a form)").button("Make him change now (next form)").button("Send him away (until he is called)").button("Skip to dusk").button("Journal").button("§cReset the story");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled) return;
  switch (r.selection) {
    case 0:
      await settingsForm(p);
      break;
    case 1: {
      if (p.dimension.id !== OVERWORLD) {
        p.sendMessage("§7[Basiliskra] He only lives in the Overworld.");
        break;
      }
      const form = rec.stage === "alive" && rec.born > 0 ? rec.form : 1;
      p.sendMessage(`§7[Basiliskra] ${ctl2.callNow(p.location, p, form > 1 ? placeFor(p, form) : void 0)}`);
      break;
    }
    case 2:
      await bringForm(p, ctl2);
      break;
    case 3:
      p.sendMessage(`§7[Basiliskra] ${ctl2.evolveNow()}`);
      break;
    case 4:
      if (await confirm(p, "Send him away", "He leaves through a seam and stays gone until you call him again (or until the land is harmed enough to call him). The story starts again from Basiliskra I; the anger on record and his fallout stay.")) {
        p.sendMessage(ctl2.sendAway() ? "§7[Basiliskra] He is gone. Call him now opens the rift again, whenever you want it." : "§7[Basiliskra] He was not in this world.");
      }
      break;
    case 5:
      world7.setTimeOfDay(DUSK + 100);
      p.sendMessage("§7[Basiliskra] Dusk.");
      break;
    case 6:
      await openJournal(p, ctl2);
      break;
    case 7:
      if (await confirm(p, "Reset the story", "Forget him, his form, everything he has learned and all the anger on record, as if the pack had just been added. He is removed from the world.")) {
        ctl2.resetStory();
        p.sendMessage("§7[Basiliskra] The story has been reset.");
      }
      break;
  }
}
function giveStarterItems(p) {
  try {
    if (p.getDynamicProperty("bk:given") === true) return;
  } catch {
    return;
  }
  const items = [];
  if (CONFIG.giveJournal) items.push(JOURNAL_ITEM);
  if (CONFIG.giveWheel && canAdmin(p)) items.push(WHEEL_ITEM);
  for (const id of items) {
    try {
      const left = p.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack(id, 1));
      if (left) p.dimension.spawnItem(left, p.location);
    } catch {
    }
  }
  try {
    p.setDynamicProperty("bk:given", true);
  } catch {
  }
  if (items.length) p.sendMessage(`§7[Basiliskra] ${items.length > 1 ? "A journal and a config wheel are" : "A journal is"} in your inventory. Use the journal to see how angry he is, and when he will come.`);
}

// src/scene.ts
import { EasingType } from "@minecraft/server";
var FLAG = "bk:film";
var Film = class {
  constructor(dim, focus, o) {
    this.dim = dim;
    this.focus = focus;
    this.o = o;
    this.t = 0;
    this.cast = [];
    this.done = false;
    const f = focus();
    for (const p of players()) {
      try {
        if (p.dimension.id !== dim.id || dist(p.location, f) > o.radius) continue;
        const base = Math.atan2(p.location.z - f.z, p.location.x - f.x);
        this.cast.push({ p, base });
        p.setDynamicProperty(FLAG, true);
        if (o.flash) p.camera.fade({ fadeColor: o.flash, fadeTime: { fadeInTime: 0.1, holdTime: 0.15, fadeOutTime: 0.7 } });
      } catch {
      }
    }
    this.aim();
  }
  aim() {
    const o = this.o, f = this.focus(), k = Math.min(1, this.t / Math.max(1, o.ticks));
    const d = o.dist + ((o.distEnd ?? o.dist) - o.dist) * k;
    for (const { p, base } of this.cast) {
      try {
        if (!p.isValid || p.dimension.id !== this.dim.id) continue;
        const a = base + (o.orbit ?? 0) * Math.PI / 180 * (k - 0.5);
        let at2 = null;
        for (const [kd, kh] of [[1, 1], [1, 1.8], [0.7, 1.4], [0.45, 1.2], [0.3, 2.2]]) {
          const q = { x: f.x + Math.cos(a) * d * kd, y: f.y + o.height * kh, z: f.z + Math.sin(a) * d * kd };
          if (!isLoaded(this.dim, q)) continue;
          if (clearLine(this.dim, q, f)) {
            at2 = q;
            break;
          }
          at2 ??= q;
        }
        if (!at2) continue;
        p.camera.setCamera("minecraft:free", { location: at2, facingLocation: f, easeOptions: { easeTime: 0.25, easeType: EasingType.Linear } });
      } catch {
      }
    }
  }
  tick() {
    if (this.done) return;
    this.t++;
    if (this.t >= this.o.ticks) {
      this.cut();
      return;
    }
    if (this.t % 2 === 0) this.aim();
  }
  /** End it now: every watcher gets their own eyes back. */
  cut() {
    if (this.done) return;
    this.done = true;
    for (const { p } of this.cast) release(p);
    this.cast = [];
  }
};
function release(p) {
  try {
    p.camera.clear();
  } catch {
  }
  try {
    p.setDynamicProperty(FLAG, void 0);
  } catch {
  }
}
var films = [];
function film(dim, focus, o) {
  if (!CONFIG.cutscenes) return { cut() {
  }, done: true };
  const f = new Film(dim, focus, o);
  films.push(f);
  return f;
}
function filmTick() {
  if (!films.length) return;
  for (const f of films) {
    try {
      f.tick();
    } catch {
      f.cut();
    }
  }
  films = films.filter((f) => !f.done);
}
function releaseStale(p) {
  try {
    if (p.getDynamicProperty(FLAG) === true) release(p);
  } catch {
  }
}
function cutAll() {
  for (const f of films) f.cut();
  films = [];
}

// src/music.ts
var TRACK = (t) => `basiliskra.music.${t}`;
var RANGE = { dread: 80, wrath: 128, last: 160 };
var GRACE = 8 * TICKS.second;
var PROP2 = "bk:music";
var playing = /* @__PURE__ */ new Map();
var scene = null;
function sceneTheme(theme, ticks, at2, dim) {
  scene = { theme, until: store.rec.clock + ticks, at: { ...at2 }, dim };
}
var FIGHT = /* @__PURE__ */ new Set(["charge", "beam", "remember", "scatter", "lock", "pursue", "arc", "pin", "flinch", "boat"]);
var fightUntil = -1;
function themeFor(c, now, doing, hurtAt) {
  if (scene && now < scene.until) return scene.theme;
  if (!c || !c.valid) return null;
  if (store.rec.ending?.step || store.rec.evolve) return "last";
  if (c.form >= 4) return "last";
  if (FIGHT.has(doing) || hurtAt > 0 && now - hurtAt < 5 * TICKS.second) fightUntil = now + 25 * TICKS.second;
  if (now < fightUntil) return "wrath";
  return c.phase === "sleep" ? null : "dread";
}
function stop(p) {
  try {
    p.runCommand("music stop 3");
  } catch {
    try {
      p.stopMusic();
    } catch {
    }
  }
  try {
    p.setDynamicProperty(PROP2, void 0);
  } catch {
  }
}
function musicTick(c, now, doing = "", hurtAt = -1) {
  if (now % 20 !== 0) return;
  const want = CONFIG.music ? themeFor(c, now, doing, hurtAt) : null;
  for (const p of players()) {
    let near = false;
    try {
      const inScene = !!scene && now < scene.until && p.dimension.id === scene.dim && dist(p.location, scene.at) <= RANGE.last;
      near = !!want && (inScene || !!c && c.valid && p.dimension.id === c.dim.id && dist(p.location, c.pos) <= RANGE[want]);
    } catch {
      continue;
    }
    const cur = playing.get(p.id);
    if (near && want) {
      if (!cur || cur.theme !== want) {
        try {
          p.playMusic(TRACK(want), { fade: cur ? 3 : 2, loop: true, volume: 0.85 });
          p.setDynamicProperty(PROP2, want);
          playing.set(p.id, { theme: want, lost: -1 });
        } catch {
        }
      } else cur.lost = -1;
    } else if (cur) {
      if (cur.lost < 0) cur.lost = now;
      if (!CONFIG.music || now - cur.lost >= GRACE) {
        stop(p);
        playing.delete(p.id);
      }
    }
  }
}
function musicJoin(p) {
  playing.delete(p.id);
  try {
    if (p.getDynamicProperty(PROP2) !== void 0) stop(p);
  } catch {
  }
}
function musicStop() {
  scene = null;
  fightUntil = -1;
  for (const p of players()) if (playing.delete(p.id)) stop(p);
}

// src/controller.ts
import { ItemStack as ItemStack2, system as system5, world as world11 } from "@minecraft/server";

// src/ending.ts
import { EquipmentSlot as EquipmentSlot2 } from "@minecraft/server";

// src/forms/three.ts
import { EntityDamageCause as EntityDamageCause5, world as world8 } from "@minecraft/server";

// src/roar.ts
import { EntityDamageCause as EntityDamageCause4, MolangVariableMap as MolangVariableMap2 } from "@minecraft/server";
var WAVE_SPEED = 2;
function shake(c, range, peak, seconds = 0.6) {
  for (const p of witnesses(c.dim, c.pos, range)) {
    try {
      const f = Math.max(0, 1 - distXZ(p.location, c.pos) / range);
      const i = clamp(0.08 + (peak - 0.08) * f, 0.05, 4);
      p.runCommand(`camerashake add @s ${i.toFixed(2)} ${seconds.toFixed(2)} positional`);
    } catch {
    }
  }
}
var Shockwave = class {
  /** `power`: damage to a player at his feet (less further out); creatures take twice that. */
  constructor(c, center, reach, power) {
    this.c = c;
    this.center = center;
    this.reach = reach;
    this.power = power;
    this.r = 0;
    this.hit = /* @__PURE__ */ new Set();
    this.n = 0;
    this.next = 0;
    const vars2 = new MolangVariableMap2();
    vars2.setFloat("variable.reach", reach);
    const at2 = { x: center.x, y: center.y + 0.4, z: center.z };
    particle(c.dim, "basiliskra:roar_wave", at2, reach + 64, vars2);
    particle(c.dim, "basiliskra:roar_ring", { x: center.x, y: center.y + 0.2, z: center.z }, reach + 64, vars2);
    sound(c.dim, "basiliskra.iii.club_plant", center, reach + 48, 1, 0.62);
    this.mobs = mobsNear(c.dim, center, reach + 2);
    this.brittle = brittleAround(c.dim, center, reach);
  }
  get done() {
    return this.r >= this.reach;
  }
  /** Carry the ring one tick further out. */
  step() {
    if (this.done) return;
    const c = this.c, r0 = this.r, r1 = Math.min(this.reach, this.r + WAVE_SPEED);
    this.r = r1;
    this.n++;
    if (this.brittle) {
      let n = 0;
      while (this.next < this.brittle.length && n < 160) {
        const p = this.brittle[this.next];
        if (Math.hypot(p.x + 0.5 - this.center.x, p.z + 0.5 - this.center.z) >= r1) break;
        shatter(c.dim, p);
        this.next++;
        n++;
      }
    } else shatterRing(c.dim, this.center, r0, r1, clamp(Math.round(2 * Math.PI * r1 / 1.6), 12, 120), this.n);
    const reached = (loc) => {
      const d = distXZ(loc, this.center);
      return d >= r0 - 1.5 && d < r1 + 1.5 && Math.abs(loc.y - this.center.y) < 14 ? d : null;
    };
    for (const p of witnesses(c.dim, this.center, r1 + 16)) {
      try {
        if (this.hit.has(p.id)) continue;
        const d = reached(p.location);
        if (d === null) continue;
        this.hit.add(p.id);
        const f = 1 - d / (this.reach + 2);
        const away = norm({ x: p.location.x - this.center.x, y: 0, z: p.location.z - this.center.z });
        c.hurt(p, Math.max(1, Math.round(this.power * (0.35 + 0.65 * f))));
        p.applyKnockback({ x: (away.x || 0.01) * (0.8 + 1.6 * f), z: (away.z || 0.01) * (0.8 + 1.6 * f) }, 0.3 + 0.35 * f);
        p.runCommand(`camerashake add @s ${(0.2 + 0.4 * f).toFixed(2)} 0.35 rotational`);
      } catch {
      }
    }
    for (const e of this.mobs) {
      try {
        if (!e.isValid || this.hit.has(e.id)) continue;
        const d = reached(e.location);
        if (d === null) continue;
        this.hit.add(e.id);
        const f = 1 - d / (this.reach + 2);
        const away = norm({ x: e.location.x - this.center.x, y: 0, z: e.location.z - this.center.z });
        e.applyDamage(Math.max(1, Math.round(this.power * 2 * (0.35 + 0.65 * f))), { cause: EntityDamageCause4.entityAttack, damagingEntity: c.entity });
        e.applyKnockback({ x: (away.x || 0.01) * (0.8 + 1.6 * f), z: (away.z || 0.01) * (0.8 + 1.6 * f) }, 0.3 + 0.35 * f);
      } catch {
      }
    }
  }
};
var RoarFx = class {
  /** `rate`: how much faster than recorded the roar is being played (Basiliskra II's is pitched up). */
  constructor(c, big, reach, power, ground = true, rate = 1) {
    this.c = c;
    this.big = big;
    this.reach = reach;
    this.power = power;
    this.ground = ground;
    this.rate = rate;
    this.t = 0;
    this.waves = [];
  }
  tick() {
    const c = this.c, t = this.t++;
    if (t % 5 === 0) {
      const env = ROAR_ENV[this.big ? "long" : "short"];
      const loud2 = env[Math.min(env.length - 1, Math.floor(t * this.rate / 2))] ?? 0;
      if (loud2 > 0.08) shake(c, this.big ? 140 : 110, (this.big ? 0.7 : 0.6) * (0.3 + 0.7 * loud2), 0.45);
    }
    if (this.ground && (t === 14 || this.big && t === 64)) this.waves.push(new Shockwave(c, { ...c.pos }, this.reach * (t === 64 ? 1.25 : 1), this.power));
    for (const w of this.waves) w.step();
    this.waves = this.waves.filter((w) => !w.done);
  }
};

// src/forms/three.ts
var CHARGE_TICKS = 137;
var PLANT_TICKS = 14;
var LIGHT_END = 112;
var FIRE_FULL = 141;
var FIRE_FADE = 14;
var TIERS = {
  1: { range: 40, radius: 1.9, damage: 5, width: 2.4, carve: 2 },
  2: { range: 60, radius: 1.6, damage: 7, width: 1.9, carve: 2.6 },
  3: { range: 76, radius: 1.4, damage: 9, width: 1.6, carve: 3.1 }
};
var CRATER = 6;
var BEAM_MIN = 14;
var ROD = /^minecraft:(waxed_)?(exposed_|weathered_|oxidized_)?lightning_rod$/;
var ROD_REACH = 10;
var FEET = ["foot_bl", "foot_fl", "foot_br", "foot_fr"];
var WINDOW_STANDOFF = 23.6;
var WINDOW_EYE_LEFT = 2.1;
var rodReady = /* @__PURE__ */ new Map();
var isPlayer = (e) => {
  try {
    return e.typeId === "minecraft:player";
  } catch {
    return false;
  }
};
function headOf(e) {
  try {
    return e.getHeadLocation();
  } catch {
    return e.location;
  }
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
    /** Creatures about him, looked up every two seconds. */
    this.mobs = [];
    this.mobsAt = -999;
    this.lastQuarry = null;
    this.roarSeed = 0;
    /** Set when a charge is grounded: the ending listens for it. */
    this.groundedAt = null;
    /** The ending asks for a charge aimed at nothing in particular, beside the seam. */
    this.wantCharge = false;
    this.chargeSounding = false;
    /** Rods seen near the club during this charge, by layer: the whole reach is read once every twelve ticks. */
    this.rodSeen = /* @__PURE__ */ new Map();
    this.rodLayer = 0;
  }
  onFinish() {
    this.c.set(PROP.tier, this.tier());
    this.c.smash = false;
    if (this.chargeSounding) {
      this.chargeSounding = false;
      stopSound(this.c.dim, "basiliskra.iii.charge", this.c.pos);
    }
  }
  /** Creatures he could go after (not players): cached, the entity query runs every two seconds at most. */
  creatures() {
    if (!CONFIG.huntMobs) return [];
    if (this.now - this.mobsAt >= 40) {
      this.mobsAt = this.now;
      this.mobs = mobsNear(this.c.dim, this.c.pos, 72);
    }
    return this.mobs.filter(alive);
  }
  tier() {
    const b = this.rec.mut.beams;
    return b < 2 ? 1 : b < 5 ? 2 : 3;
  }
  choose() {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world8.getTimeOfDay();
    if (this.wantCharge) {
      this.wantCharge = false;
      return { name: "charge", run: this.beam(null), limit: 40 * TICKS.second };
    }
    const near = nearbyPlayers(c, 90);
    if (rec.origin && rec.guilty && this.ready("remember") && distXZ(rec.origin, c.pos) < 90) {
      const g = near.find((p) => p.id === rec.guilty);
      if (g) {
        this.rest("remember", TICKS.day);
        return { name: "remember", run: this.remember(g), limit: 100 * TICKS.second };
      }
    }
    if (!this.cooldown.has("rroar")) this.rest("rroar", (30 + 60 * hash(now, 91)) * TICKS.second);
    if (this.ready("rroar")) {
      this.rest("rroar", (55 + 125 * hash(now, 92)) * TICKS.second);
      if (hash(now, 93) < 0.7 && anyoneNear(c, 110)) return { name: "roar", run: this.roar(hash(now, 94) < 0.25), limit: 12 * TICKS.second };
    }
    const mobs = this.creatures();
    if (now >= this.recoverUntil) {
      const hunted = this.prey && now < this.preyUntil ? near.filter((p) => p.id === this.prey) : near;
      if (this.tier() === 3 && this.ready("scatter")) {
        const flank = hunted.find((p) => dist(p.location, c.pos) < 18 * c.scale && Math.abs(wrapDeg(yawTo(c.pos, p.location) - c.yaw)) > 100);
        if (flank) {
          this.rest("scatter", 45 * TICKS.second);
          return { name: "scatter", run: this.scatter(), limit: 20 * TICKS.second };
        }
      }
      if (this.ready("beam")) {
        const range = TIERS[this.tier()].range - 2;
        const mouth = c.anchor("mouth");
        const quarry2 = [...hunted, ...mobs.filter((m) => !this.prey || now >= this.preyUntil)];
        for (const q of quarry2) {
          const d = dist(q.location, mouth);
          if (d < BEAM_MIN || d > range) continue;
          if (!clearLine(c.dim, mouth, headOf(q))) continue;
          this.rest("beam", 28 * TICKS.second);
          return { name: "beam", run: this.beam(q), limit: 45 * TICKS.second };
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
    let quarry;
    if (this.prey && now < this.preyUntil) quarry = near.find((p) => p.id === this.prey);
    quarry ??= near.find((p) => dist(p.location, c.pos) < 64) ?? mobs.sort((x, y) => dist(x.location, c.pos) - dist(y.location, c.pos))[0];
    if (quarry) {
      if (quarry.id !== this.lastQuarry && this.ready("lockroar")) {
        this.lastQuarry = quarry.id;
        this.rest("lockroar", 50 * TICKS.second);
        const q = quarry;
        return { name: "lock", run: function* (self) {
          c.lookAt(headOf(q), 85, 35);
          yield* self.roar(false);
          yield* self.pursue(q);
        }(this), limit: 30 * TICKS.second };
      }
      this.lastQuarry = quarry.id;
      return { name: "pursue", run: this.pursue(quarry), limit: 20 * TICKS.second };
    }
    return { name: "roam", run: this.roam(), limit: 80 * TICKS.second };
  }
  // ---- four footfalls --------------------------------------------------------------------------
  /** Walk, landing one foot every quarter stride: left hind, left fore, right hind, right fore. */
  *walk(target, speed, arrive, timeout, phase = "move") {
    const c = this.c;
    c.setPhase(phase);
    c.goTo(target, speed, arrive);
    c.smash = phase === "move";
    let t = 0;
    while (!c.arrived()) {
      if (++t > timeout || c.blocked > 50) {
        c.halt();
        c.smash = false;
        return false;
      }
      this.footfalls();
      yield;
    }
    c.halt();
    c.smash = false;
    return true;
  }
  footfalls() {
    const c = this.c;
    c.walkPhase = ((this.beat - 1 & 3) + clamp((c.travelled - this.stepAt) / (STRIDE_III / 4), 0, 1.15)) * 90;
    if (c.travelled - this.stepAt < STRIDE_III / 4) return;
    this.stepAt = c.travelled - this.stepAt < STRIDE_III / 2 ? this.stepAt + STRIDE_III / 4 : c.travelled;
    const k = this.beat & 3;
    c.set(PROP.gait, k);
    const foot = add(c.anchor(FEET[k]), mul(c.forward, STANCE_III / 2));
    this.beat++;
    this.rec.mut.overland += STRIDE_III / 4;
    sound(c.dim, "basiliskra.iii.step", foot, 112, 1, 0.86 + (this.beat & 3) * 0.03);
    const ground = { x: foot.x, y: c.pos.y + 0.1, z: foot.z };
    particle(c.dim, "basiliskra:step_dust", ground, 72);
    for (const p of witnesses(c.dim, foot, 40)) {
      const f = 1 - dist(p.location, foot) / 40;
      try {
        p.runCommand(`camerashake add @s ${(0.06 + 0.16 * f).toFixed(2)} 0.25 positional`);
      } catch {
      }
    }
    blast(c.dim, ground, 2.2 * c.scale, 6, 14, 0.9, (p, n) => c.hurt(p, n), c.entity, ground);
    if (!CONFIG.marks) return;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const at2 = { x: Math.floor(foot.x) + dx, y: Math.floor(c.pos.y - 0.5), z: Math.floor(foot.z) + dz };
      const b = takesMark(c.dim, at2);
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
    const near = watchersNear(c, 110);
    let target;
    if (near.length) {
      const p = near[0].location;
      const a = hash(this.now, 41) * Math.PI * 2;
      const r = 22 + 12 * hash(this.now, 42);
      target = { x: p.x + Math.cos(a) * r, y: p.y, z: p.z + Math.sin(a) * r };
    } else {
      const home = this.rec.home ?? this.rec.origin ?? this.rec.rift ?? c.pos;
      const a = hash(this.now, 43) * Math.PI * 2;
      target = { x: home.x + Math.cos(a) * 40, y: c.pos.y, z: home.z + Math.sin(a) * 40 };
    }
    yield* this.walk(target, 0.13, 6, 1500);
    c.setPhase("idle");
    for (let t = 0; t < 140; t++) {
      if (t === 30) c.say(hash(this.now, 17) < 0.5 ? "basiliskra.iii.breath" : "basiliskra.iii.grunt", c.anchor("nose"), 64, 0.9, 0.95);
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
      let open = false, at2 = 3, mid = add(head, mul(d, 3));
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
          at2 = r;
          break;
        }
        if (isSolidBlock(b)) break;
        if (r === 9) open = true;
      }
      if (open && dot(d, toHim) > score) {
        score = dot(d, toHim);
        best = d;
        reach = at2;
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
    if (!(yield* this.walk(line(WINDOW_STANDOFF + RUN), 0.13, 0.4, 2400))) return;
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
  // ---- the roar ----------------------------------------------------------------------------------------
  /**
   * His roar: head up, jaw open, the ground carrying it.  The whole of it for the things that happen once
   * (the last change, the last crossing); the short bellow for the things that happen again.
   */
  *roar(whole) {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say(whole ? "basiliskra.roar" : "basiliskra.roar_short", c.anchor("mouth"), whole ? 192 : 160);
    const fx = new RoarFx(c, whole, whole ? 40 : 30, whole ? 7 : 5);
    const ticks = whole ? 160 : 88;
    for (let t = 0; t < ticks; t++) {
      fx.tick();
      yield;
    }
    c.setPhase("idle");
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
    yield* this.roar(false);
    if (!ok()) return;
    this.prey = g.id;
    this.preyUntil = this.now + 70 * TICKS.second;
    c.lookAhead();
  }
  /** After it: players at a walk he can keep up with, creatures until he is on them; whatever is underfoot is trodden. */
  *pursue(g) {
    const c = this.c;
    const player = isPlayer(g);
    c.smash = true;
    for (let t = 0; t < 360; t++) {
      let at2;
      try {
        if (!g.isValid || g.dimension.id !== c.dim.id || player && !targetable(g)) break;
        at2 = g.location;
      } catch {
        break;
      }
      c.setPhase("move");
      c.goTo(at2, 0.15, player ? 17 * c.scale * 0.6 : 3);
      c.lookAt(at2, 60, 25);
      this.footfalls();
      if (dist(at2, c.pos) < (player ? 17 * c.scale * 0.6 : 4)) break;
      if (t % 100 === 50) c.say("basiliskra.iii.grunt", c.anchor("nose"), 72, 1, 0.92 + hash(t) * 0.1);
      yield;
    }
    c.halt();
    c.smash = false;
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
    addFallout(rod, 2.5, 0.5);
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
          }, 128);
        }
      }
      c.setCharge(c.charge - 1.5);
      if (t === 16) c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 64);
      yield;
    }
    c.setCharge(0);
    yield* wait(14);
    yield* this.roar(false);
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
    const aimAt = () => target ? headOf(target) : add(c.anchor("mouth"), mul(c.forward, 30));
    c.halt();
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 112);
    c.say("basiliskra.iii.charge", c.anchor("throat"), 128);
    this.chargeSounding = true;
    this.rodSeen.clear();
    this.rodLayer = 0;
    for (let t = 0; t < PLANT_TICKS; t++) {
      c.setCharge(t / 7);
      if (ok()) c.aimAt(aimAt(), 80, 40);
      this.scanRods();
      yield;
    }
    let rod = null;
    let lit = 1;
    const light = LIGHT_END - PLANT_TICKS;
    for (let t = 0; t < light; t++) {
      if (!ok()) return;
      const aim = aimAt();
      const off = c.aimAt(aim, 80, 40);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), 0.6);
      c.setCharge(2 + t / light * 13.4);
      const zone = Math.floor(c.charge / 2);
      if (zone > lit) {
        lit = zone;
        sound(c.dim, "basiliskra.iii.charge_tick", c.anchor(zone >= 6 ? "throat" : zone >= 3 ? "plate_tip_5" : "club_core"), 72, 0.55, 0.75 + zone * 0.09);
      }
      if (t % 20 === 10) shake(c, 48, 0.12 + 0.2 * (t / light), 1);
      this.scanRods();
      yield;
    }
    rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) {
      this.chargeSounding = false;
      stopSound(c.dim, "basiliskra.iii.charge", c.pos);
      yield* this.ground(rod);
      yield* wait(30);
      this.recoverUntil = this.now + 8 * TICKS.second;
      return;
    }
    const lock = CHARGE_TICKS - LIGHT_END;
    for (let t = 0; t < lock; t++) {
      c.setCharge(16 + t / lock * 2);
      if (t % 2 === 0) {
        const { from, dir } = c.aim();
        particle(c.dim, "basiliskra:beam_aim", from, 128, beamVars(dir, this.clearRange(from, dir, T.range), 0.22 + 0.5 * (t / lock)));
      }
      yield;
    }
    c.setPhase("fire");
    c.setCharge(20);
    this.rec.mut.beams++;
    this.rec.mut.lastEncounter = this.now;
    this.chargeSounding = false;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 160);
    {
      const { from, dir } = c.aim();
      particle(c.dim, "basiliskra:muzzle_flash", from, 160);
      particle(c.dim, "basiliskra:muzzle_shock", from, 160, beamVars(dir, 1, 1));
      flash(c.dim, from, 56, { red: 1, green: 0.5, blue: 0.42 }, 0.03, 0.04, 0.3);
      shake(c, 96, 0.9, 0.5);
    }
    const smash = wither();
    let ground = null;
    for (let t = 0; t < FIRE_FULL + FIRE_FADE; t++) {
      const fade = t < FIRE_FULL ? 1 : 1 - (t - FIRE_FULL) / FIRE_FADE;
      if (tier >= 2 && target && ok() && (!isPlayer(target) || targetable(target))) {
        const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
        const rate = tier === 2 ? 0.22 : 0.3;
        c.lookYaw += clamp(want - c.lookYaw, -rate, rate);
      } else if (tier === 1) c.lookYaw = clamp(c.lookYaw + Math.sin(t * 0.09) * 0.12, -80, 80);
      const sputter = tier === 1 && t % 17 >= 14;
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
        const w = T.width * fade * (tier === 1 ? 0.85 + hash(t) * 0.4 : 1) * (1 + 0.14 * Math.sin(t * 1.25));
        if (t % 5 === 0) particle(c.dim, "basiliskra:beam_ring", from, 144, beamVars(dir, length, w * 2.2));
        if (t % 3 === 1) particle(c.dim, "basiliskra:beam_arc", from, 128, beamVars(dir, length, w));
        if (t % 2 === 0) {
          particle(c.dim, "basiliskra:beam_core", from, 160, beamVars(dir, length, w));
          particle(c.dim, "basiliskra:beam_halo", from, 160, beamVars(dir, length, w * 2.4));
          particle(c.dim, "basiliskra:beam_glow", from, 160, beamVars(dir, length, w * 5.2));
        } else {
          particle(c.dim, "basiliskra:beam_smoke", from, 128, beamVars(dir, length, w));
          if (t % 4 === 1) particle(c.dim, "basiliskra:beam_embers", from, 128, beamVars(dir, length, w));
        }
        const side = norm({ x: -dir.z, y: 0, z: dir.x });
        const up = norm({ x: dir.y * side.z - dir.z * side.y, y: dir.z * side.x - dir.x * side.z, z: dir.x * side.y - dir.y * side.x });
        for (let i = 0; i < 4; i++) {
          const along = (t * 2.3 + i * (length / 4)) % length;
          const a = along * 1.1 + t * 0.9;
          const r = w * 0.9 + 0.3;
          particle(c.dim, "basiliskra:beam_spiral", add(add(from, mul(dir, along)), add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r))), 112);
        }
        if (hitBlock) {
          if (t % 3 === 0) particle(c.dim, "basiliskra:beam_impact", end, 112);
          if (t % 5 === 0) particle(c.dim, "basiliskra:impact_blast", end, 128);
          if (t % 6 === 3) particle(c.dim, "basiliskra:impact_smoke", end, 144);
          if (t % 7 === 0) particle(c.dim, "basiliskra:impact_fire", end, 112);
          if (t % 4 === 2) particle(c.dim, "basiliskra:impact_glare", end, 160);
          if (t % 10 === 5) particle(c.dim, "basiliskra:impact_ring", { x: end.x, y: end.y + 0.4, z: end.z }, 144);
          if (t % 8 === 1) particle(c.dim, "basiliskra:impact_fountain", end, 144);
          if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 112);
          if (!ground || dist(ground, hitBlock) > CRATER + 3) ground = hitBlock;
          if (smash) {
            if (t % 4 === 0 && dist(ground, hitBlock) <= CRATER) {
              const got = carve(c.dim, hitBlock, T.carve * fade + 0.5, 110, true);
              if (got.broken) particle(c.dim, "basiliskra:impact_debris", end, 128);
              sear(c.dim, got.floor, 5);
            }
            if (t % 12 === 0) {
              particle(c.dim, "minecraft:huge_explosion_emitter", end, 144);
              sound(c.dim, "random.explode", end, 128, 1.4, 0.7 + hash(t, 3) * 0.2);
            }
            if (t % 8 === 4) blast(c.dim, end, T.carve + 3.5, 4, 12, 0.8, (p, n) => c.hurt(p, n), c.entity, end);
          } else if (t % 6 === 0) this.scorch(hitBlock);
          if (t % 6 === 0) {
            addFallout(ground, [0, 3, 4, 5][tier] + (smash ? 1 : 0), 0.13);
            if (CONFIG.fallout !== "off") particle(c.dim, "basiliskra:fallout_ash", end, 64);
          }
        }
        if (t % 4 === 0) {
          const reach = T.radius * Math.max(0.5, fade) + 0.4;
          for (const p of players()) {
            try {
              if (p.dimension.id !== c.dim.id || !targetable(p)) continue;
              const body = add(p.location, { x: 0, y: 0.9, z: 0 });
              if (segDist(body, from, dir, length) > reach) continue;
              const along = clamp(dot(sub(body, from), dir), 0, Math.max(0, length - 0.6));
              if (!clearLine(c.dim, add(from, mul(dir, along)), body)) continue;
              c.hurt(p, T.damage, EntityDamageCause5.entityAttack);
              try {
                p.setOnFire(3, true);
              } catch {
              }
            } catch {
            }
          }
          for (const e of mobsNear(c.dim, add(from, mul(dir, length / 2)), length / 2 + 3)) {
            try {
              if (segDist(add(e.location, { x: 0, y: 0.6, z: 0 }), from, dir, length) > reach + 0.6) continue;
              e.applyDamage(T.damage * 2, { cause: EntityDamageCause5.entityAttack, damagingEntity: c.entity });
              e.setOnFire(5, true);
            } catch {
            }
          }
        }
      }
      if (t % 10 === 0) shake(c, 64, 0.32 * fade + 0.08, 0.6);
      yield;
    }
    yield* this.vent();
    yield* this.roar(tier === 3 && hash(this.now, 61) < 0.3);
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
    yield* wait(40);
  }
  /** How far along a line the way is clear (up to `max`), for drawing: never into a chunk that is not loaded. */
  clearRange(from, dir, max) {
    const c = this.c;
    let length = max;
    if (isLoaded(c.dim, from)) {
      try {
        const hit = c.dim.getBlockFromRay(from, dir, { maxDistance: max, includeLiquidBlocks: false, includePassableBlocks: false });
        if (hit) length = Math.max(1, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })) - 0.4);
      } catch {
        length = 6;
      }
    }
    while (length > 4 && !isLoaded(c.dim, add(from, mul(dir, length)))) length -= 4;
    return length;
  }
  /** Mark what the beam touched.  Natural ground only; never a block with an inventory, a bed, a portal or redstone. */
  scorch(at2) {
    if (CONFIG.terrain === "none") return;
    const c = this.c;
    const hit = blockAt(c.dim, at2);
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
      const x = Math.floor(at2.x) + dx, y = Math.floor(at2.y) + dy, z = Math.floor(at2.z) + dz;
      const b = blockAt(c.dim, { x, y, z });
      if (!b) continue;
      const id = b.typeId;
      if (Math.abs(dx) + Math.abs(dz) <= 1 && fuse(b)) continue;
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
          if (hit) {
            length = Math.max(0.5, dist(from, add(hit.block.location, { x: 0.5, y: 0.5, z: 0.5 })));
            if (t % 10 === 0) addFallout(hit.block.location, 2, 0.05);
          }
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
var GRACE2 = 60;
function holdsFin(p) {
  try {
    return p.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot2.Mainhand)?.typeId === FIN_ITEM;
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
  onNote(at2) {
    const rift = store.rec.rift;
    if (!rift || distXZ(at2, rift) > NOTE_REACH) return;
    const k = `${Math.floor(at2.x)},${Math.floor(at2.y)},${Math.floor(at2.z)}`;
    if (!this.blocks.has(k) && this.blocks.size < 32) this.blocks.set(k, { x: Math.floor(at2.x), y: Math.floor(at2.y), z: Math.floor(at2.z) });
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
    return this.faltered <= GRACE2;
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
    const k = c.scale;
    for (const [d, arrive] of [[shore + 2, 5], [shore + 24 * k, 2.5]]) {
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
    addFallout(rift, 4, 0.3);
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
    const back = brain.walk(out(25.5 * k), 0.13, 1.5, 1400);
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
    const turn = brain.walk(out(54 * k), 0.14, 5, 2e3);
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
    c.goTo(out(-70 * k), 0.13, 2);
    c.say("basiliskra.roar", c.anchor("mouth"), 192);
    shake(c, 110, 0.6, 3);
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
    const zones2 = RIGS[c.form].zones;
    let hi = 8;
    for (let z = 8; z >= 0; z--) {
      const bones = zones2[String(z)];
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
import { world as world9 } from "@minecraft/server";
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
      const at2 = this.lure;
      this.lure = null;
      return { name: "lure", run: this.investigate(at2), limit: 30 * TICKS.second };
    }
    return null;
  }
  choose() {
    const c = this.c, now = this.now, rec = this.rec;
    const tod = world9.getTimeOfDay();
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
      const at2 = pier ?? this.openWater(near[0].location, 10, 24, 5);
      if (at2) {
        this.rest("harbor", (pier ? 4 : 6) * TICKS.minute);
        return { name: "harbor", run: this.underHarbor(pier ?? { x: at2.x, y: at2.y + 1, z: at2.z }), limit: 2 * TICKS.minute };
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
          const at2 = e.typeId === "minecraft:player" ? e.getHeadLocation() : e.location;
          if (!clearLine(c.dim, g, at2)) continue;
          const d = norm(sub(g, at2));
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
    let at2 = col !== NONE && col !== UNLOADED ? { x: site.x + 0.5, y: col.surface - 1, z: site.z + 0.5 } : null;
    if (!at2) {
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6], [6, -6], [-6, 6]]) {
        const cc = waterColumn(c.dim, site.x + dx, site.z + dz, site.y, 8);
        if (cc !== NONE && cc !== UNLOADED) {
          at2 = { x: site.x + dx, y: cc.surface - 1, z: site.z + dz };
          break;
        }
      }
    }
    if (!at2) return;
    for (const p of nearbyPlayers(c, 64)) {
      try {
        const ear = p.getHeadLocation(), d = dist(ear, at2);
        if (d > 48) continue;
        const from = d <= 10 ? at2 : add(ear, mul(norm(sub(at2, ear)), 10));
        p.playSound(site.s, { location: from, volume: clamp(1.1 - d / 60, 0.35, 0.9), pitch: 0.72 });
      } catch {
      }
    }
    c.halt();
    for (let t = 0; t < 46; t++) {
      c.lookAt(at2, 70, 25);
      yield;
    }
    c.setPhase("move");
    c.swimDepth = 5;
    yield* travel(c, at2, 0.24, 5, 700);
    c.lookAhead();
    c.setPhase("idle");
    yield* wait(70);
    sound(c.dim, site.s, at2, 24, 0.45, 0.66);
    yield* wait(80);
  }
  // ---- the second splash ----------------------------------------------------------------------------
  onSplash(at2, _by) {
    const c = this.c;
    if (dist(at2, c.pos) > 56) return;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 80 && dist(prev.at, at2) <= 6 && this.rec.learned.lureUntil <= this.now) {
      this.lure = at2;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(30 * TICKS.second + Math.min(this.rec.learned.lures, 8) * 15 * TICKS.second);
      this.splash = null;
    } else {
      this.splash = { at: at2, t: this.now };
      if (this.actName === "patrol" || this.actName === "none") c.lookAt(at2, 60, 20);
    }
  }
  *investigate(at2) {
    const c = this.c;
    c.setPhase("move");
    c.swimDepth = 5;
    c.lookAt(at2, 60, 20);
    yield* travel(c, at2, 0.3, 7, 500);
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
    while (isNight(world9.getTimeOfDay()) && t++ < 9e3) {
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
import { world as world10 } from "@minecraft/server";
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
      const at2 = this.lure;
      this.lure = null;
      return { name: "lure", run: this.toLure(at2), limit: 50 * TICKS.second };
    }
    return null;
  }
  choose() {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world10.getTimeOfDay();
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
    if (!this.cooldown.has("rroar")) this.rest("rroar", (60 + 60 * hash(now, 81)) * TICKS.second);
    if (this.ready("rroar")) {
      this.rest("rroar", (90 + 180 * hash(now, 82)) * TICKS.second);
      if (hash(now, 83) < 0.5 && anyoneNear(c, 72)) return { name: "roar", run: this.roar(), limit: 8 * TICKS.second };
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
      c.goTo(target, 0.085, arrive);
      for (let i = 0; i < pull; i++, t++) {
        if (i % 4 === 0) this.furrow();
        yield;
      }
      c.halt();
      stuck = c.planning ? 0 : c.travelled - before < 0.25 ? stuck + 1 : 0;
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
      const at2 = { x: Math.floor(p.x), y: Math.floor(c.pos.y - 0.5), z: Math.floor(p.z) };
      const b = takesMark(c.dim, at2);
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
    const near = watchersNear(c, 96);
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
  *well(at2) {
    const c = this.c;
    if (!(yield* this.drag(at2, 8.5, 1800))) return;
    c.yaw = yawTo(c.pos, at2);
    c.setPhase("drink");
    for (let t = 0; t < 700; t++) {
      if (t % 52 === 0) c.say("basiliskra.ii.drink", c.anchor("muzzle"), 32);
      yield;
    }
  }
  *toLure(at2) {
    const c = this.c;
    c.setPhase("idle");
    for (let t = 0; t < 24; t++) {
      c.lookAt(at2, 70, 20);
      yield;
    }
    c.lookAhead();
    yield* this.drag(at2, 6, 900);
    c.setPhase("idle");
    yield* wait(100);
  }
  onSplash(at2, _by) {
    const c = this.c;
    if (dist(at2, c.pos) > 40) return;
    this.otherSound = this.now;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 100 && dist(prev.at, at2) <= 6 && this.rec.learned.lureUntil <= this.now) {
      this.lure = at2;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(40 * TICKS.second);
      this.splash = null;
    } else this.splash = { at: at2, t: this.now };
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
    yield* this.roar();
  }
  /** The same voice, younger: the short bellow, pitched up. */
  *roar() {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say("basiliskra.roar_short", c.anchor("mouth"), 128, 1, 1.18);
    const fx = new RoarFx(c, false, 20, 3, true, 1.18);
    for (let t = 0; t < 76; t++) {
      fx.tick();
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
  onBell(at2, _by) {
    const c = this.c, rec = this.rec;
    if (dist(at2, c.pos) > 48) return;
    if (this.actName === "pin") {
      const same = rec.learned.bell && dist(rec.learned.bell, at2) < 2;
      if (same) {
        sound(c.dim, "basiliskra.bell_pin", at2, 32);
        particle(c.dim, "basiliskra:grit", { x: at2.x + 0.5, y: at2.y + 0.5, z: at2.z + 0.5 }, 24);
      } else this.otherSound = this.now;
      return;
    }
    if (rec.learned.bellUses < 3) {
      rec.learned.bellUses++;
      rec.learned.bell = { x: Math.floor(at2.x), y: Math.floor(at2.y), z: Math.floor(at2.z) };
      this.startle = at2;
    } else if (rec.learned.bellUses === 3) {
      rec.learned.bellUses = 4;
      rec.learned.bell = { x: Math.floor(at2.x), y: Math.floor(at2.y), z: Math.floor(at2.z) };
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

// src/rift.ts
import { MolangVariableMap as MolangVariableMap3 } from "@minecraft/server";
function vars(size) {
  const m = new MolangVariableMap3();
  m.setFloat("variable.size", size);
  return m;
}
function riftOpen(dim, at2, size) {
  const v = vars(size);
  particle(dim, "basiliskra:rift_flash", at2, 200, v);
  particle(dim, "basiliskra:rift_burst", at2, 160, v);
  particle(dim, "basiliskra:rift_ring", at2, 200, v);
  loud(dim, "basiliskra.rift.open", at2, 1, 0.85);
  loud(dim, "ambient.weather.thunder", at2, 0.9, 0.6);
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id) continue;
      const d = dist(p.location, at2);
      if (d > 120) continue;
      p.camera.fade({ fadeColor: { red: 0.9, green: 0.08, blue: 0.06 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.1, fadeOutTime: 0.6 } });
      p.runCommand(`camerashake add @s ${(0.5 * (1 - d / 120) + 0.1).toFixed(2)} 0.8 positional`);
    } catch {
    }
  }
}
function riftTick(dim, at2, size, t, power = 1) {
  const v = vars(size);
  if (t % 3 === 0) particle(dim, "basiliskra:rift_tear", at2, 200, v);
  if (t % 2 === 0) particle(dim, "basiliskra:rift_core", at2, 200, v);
  if (t % Math.max(2, Math.round(6 - 4 * power)) === 0) particle(dim, "basiliskra:rift_arc", at2, 160, v);
  if (t % 8 === 0) particle(dim, "basiliskra:rift_suck", at2, 128, v);
  if (t % 22 === 0) particle(dim, "basiliskra:rift_ring", at2, 200, v);
  if (t % 60 === 0) loud(dim, "basiliskra.rift.hum", at2, 1, 1);
  if (t % 34 === 17 && hash(t, 5) < 0.5 + 0.4 * power) loud(dim, "basiliskra.ii.arc", { x: at2.x, y: at2.y + size * hash(t, 6), z: at2.z }, 0.9, 0.6 + 0.3 * hash(t, 7));
}
function riftClose(dim, at2, size) {
  const v = vars(size);
  particle(dim, "basiliskra:rift_flash", at2, 200, v);
  particle(dim, "basiliskra:rift_burst", at2, 160, v);
  particle(dim, "basiliskra:rift_ring", at2, 200, v);
  particle(dim, "basiliskra:seam_close", { x: at2.x, y: at2.y + size * 0.4, z: at2.z }, 128);
  loud(dim, "basiliskra.rift.close", at2, 1, 0.9);
}
var RIFT_SIZE = [0, 14, 16, 30, 46];

// src/controller.ts
var TOKEN = "bk:token";
var ROMAN2 = ["", "I", "II", "III"];
function tellNear(dimId, at2, msg) {
  for (const p of players()) {
    try {
      if (p.dimension.id === dimId && dist(p.location, at2) < 64) p.sendMessage(msg);
    } catch {
    }
  }
}
var SPAWN_STEP = 3;
var MAX_FORM = 3;
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
    this.riftShown = -1;
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
      let token2;
      try {
        token2 = e.getDynamicProperty(TOKEN);
      } catch {
        token2 = void 0;
      }
      if (token2 === rec.token) {
        rec.entityId = id;
        rec.down = null;
        store.save();
        this.adopt(e);
        return;
      }
    }
    let token;
    try {
      token = e.getDynamicProperty(TOKEN);
    } catch {
      token = void 0;
    }
    if (token === void 0 && CONFIG.allowSummon) {
      this.summoned(e);
      return;
    }
    this.quarantine(e);
  }
  // ---- called on purpose: spawn egg, /summon, /basiliskra:spawn, the config wheel ----------------------------
  /** A Basiliskra nobody reserved has appeared.  The one Basiliskra comes to that place instead. */
  summoned(e) {
    let at2, yaw = 0, dimId = "";
    try {
      at2 = { ...e.location };
      yaw = e.getRotation().y;
      dimId = e.dimension.id;
    } catch {
      return;
    }
    if (dimId !== OVERWORLD) {
      this.quarantine(e);
      tellNear(dimId, at2, "§7Basiliskra lives in the Overworld. He cannot be called here.");
      return;
    }
    const said = this.bringHere(at2, yaw, CONFIG.spawnForm, e);
    tellNear(dimId, at2, `§7${said}`);
  }
  /**
   * Bring the one Basiliskra to `at`, in `want` form (0 = his stage in the story).  If he is loaded he is moved
   * here; otherwise a body here becomes him and the old one, wherever it lies, is removed when its chunk loads.
   * Never more than one.  Returns what happened, in words.
   */
  bringHere(at2, yaw, want, body) {
    const rec = store.rec, dim = overworld();
    const form = this.formFor(want, at2);
    if (form === 1) {
      const w = this.waterNear(at2, 96);
      if (!w) {
        if (body) this.quarantine(body);
        return "Basiliskra I lives in deep water, and there is none within 96 blocks (it has to be 5 deep). Bring him as II or III, or go to the sea.";
      }
      at2 = w;
    }
    const c = this.creature;
    if (c && c.valid) {
      if (body) this.quarantine(body);
      this.runner = null;
      this.ending.reset();
      if (rec.stage !== "alive") {
        rec.stage = "alive";
        rec.arrival = null;
        rec.pending = null;
      }
      rec.evolve = null;
      rec.down = null;
      if (!rec.born) {
        rec.born = Math.max(1, this.now);
        rec.mut.formSince = this.now;
      }
      if (!rec.rift) rec.rift = { ...this.waterNear(at2, 64) ?? at2, yaw };
      rec.home = { ...at2 };
      if (c.form !== form) this.setForm(c, form);
      this.brain?.finish();
      c.halt();
      c.pos = { ...at2 };
      c.yaw = yaw;
      try {
        c.entity.teleport(at2, { rotation: { x: 0, y: yaw } });
      } catch {
      }
      store.save();
      return `Basiliskra ${ROMAN2[form]} has come.`;
    }
    let made = false;
    if (!body) {
      if (!isLoaded(dim, at2)) return "That place is not loaded.";
      try {
        body = dim.spawnEntity(TYPE, at2, { initialRotation: yaw });
        made = true;
      } catch {
        return "He could not come there.";
      }
    }
    this.ticket = body;
    try {
      rec.stage = "alive";
      if (!rec.token) rec.token = newToken();
      rec.entityId = body.id;
      rec.form = form;
      rec.pending = null;
      rec.arrival = null;
      rec.evolve = null;
      rec.ending = null;
      rec.down = null;
      if (!rec.born) {
        rec.born = Math.max(1, this.now);
        rec.mut.formSince = this.now;
      }
      if (!rec.rift) rec.rift = { ...this.waterNear(at2, 64) ?? at2, yaw };
      if (!rec.origin) rec.origin = { ...at2 };
      rec.home = { ...at2 };
      store.save();
      try {
        body.setDynamicProperty(TOKEN, rec.token);
      } catch {
      }
      this.adopt(body);
      try {
        const h = body.getComponent("minecraft:health");
        if (h) h.setCurrentValue(Math.max(1, Math.min(rec.health || h.effectiveMax, h.effectiveMax)));
      } catch {
      }
    } finally {
      this.ticket = null;
    }
    if (!this.creature && made) {
      try {
        body.remove();
      } catch {
      }
    }
    return this.creature ? `Basiliskra ${ROMAN2[form]} has come.` : "He could not come there.";
  }
  /** Which form a call makes. */
  formFor(want, at2) {
    if (want) return want;
    const rec = store.rec;
    if (rec.born > 0) return rec.form;
    return this.waterNear(at2, 6) ? 1 : 3;
  }
  /** The nearest loaded column of open water at least five deep, at his swimming depth; null if none within reach. */
  waterNear(at2, reach) {
    const dim = overworld();
    for (let r = 0; r <= reach; r += 4) {
      const n = r === 0 ? 1 : Math.max(8, Math.round(r * 1.5));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        const x = at2.x + Math.cos(a) * r, z = at2.z + Math.sin(a) * r;
        const col = waterColumn(dim, x, z, at2.y, 12, 12);
        if (col === UNLOADED || col === NONE || col.surface - col.floor < 5) continue;
        return { x, y: col.surface - 5.5, z };
      }
    }
    return null;
  }
  /** Change his form now, keeping him (the config wheel, /basiliskra:spawn with a form). */
  setForm(c, form) {
    const rec = store.rec;
    rec.form = form;
    rec.mut.formSince = this.now;
    rec.evolve = null;
    c.form = form;
    try {
      c.entity.triggerEvent(`basiliskra:bind_${form}`);
    } catch {
    }
    this.nameHim(c.entity);
    c.dropParts();
    c.resync();
    this.brain = this.makeBrain(c);
  }
  /**
   * The config wheel: open the rift for him NOW.  No dusk, no waiting.  Basiliskra I comes through the nearest
   * deep water (the story begins: he will change as he lives); once he is II or more and has been driven off,
   * the rift opens on land in front of the caller and he walks out of it as he was.
   */
  callNow(site, by, place2) {
    const rec = store.rec;
    const c = this.creature;
    if (c && c.valid) return `He is already here, ${Math.round(dist(c.pos, site))} blocks away. Send him away first, or use Bring him here.`;
    if (rec.stage === "arriving") return "The rift is already open: he is coming through.";
    const returning = rec.stage === "alive" && rec.born > 0;
    const form = returning ? rec.form : 1;
    const origin = { x: Math.floor(site.x), y: Math.floor(site.y), z: Math.floor(site.z) };
    if (form === 1) {
      const w = this.waterNear(site, 96);
      if (!w) return "The rift opens in deep water, and there is none within 96 blocks (it has to be 5 deep). Go to the sea, a deep lake or a wide river and call him again.";
      this.waterSearch = null;
      rec.stage = "arriving";
      rec.token = newToken();
      rec.entityId = null;
      rec.down = null;
      rec.form = 1;
      rec.pending = null;
      rec.arrival = { step: 1, t0: this.now, water: w, yaw: this.openHeading(w) };
      if (!returning) {
        rec.origin = origin;
        rec.guilty = by.id;
        rec.guiltyName = by.name;
      }
      rec.home = null;
      store.save();
      return `The rift is opening in the water ${Math.round(dist(w, site))} blocks from you. Watch it.`;
    }
    if (!place2) return "He could not come there.";
    rec.stage = "arriving";
    rec.entityId = null;
    rec.down = null;
    rec.pending = null;
    if (!rec.token) rec.token = newToken();
    rec.arrival = { step: 0, t0: this.now, water: { ...place2.at }, yaw: place2.yaw, land: true };
    rec.home = { ...place2.at };
    store.save();
    return `The rift is opening in front of you. Basiliskra ${ROMAN2[form]} is coming through.`;
  }
  /** The heading out of a seam in the water with the longest clear, deep run ahead of it (for his first swim). */
  openHeading(w) {
    const dim = overworld();
    let best = 0, run = -1;
    for (let k = 0; k < 8; k++) {
      const yaw = k * 45, f = forwardOf(yaw);
      let n = 0;
      for (let s = 4; s <= 48; s += 4) {
        if (deepHere(dim, w.x + f.x * s, w.z + f.z * s, Math.floor(w.y + 5.5), 4) !== true) break;
        n++;
      }
      if (n > run) {
        run = n;
        best = yaw;
      }
    }
    return best;
  }
  /**
   * The config wheel: he leaves through a seam and stays gone.  The story goes back to its beginning (the anger
   * on record, and his fallout, stay): calling him again starts it afresh.
   */
  sendAway() {
    const c = this.creature;
    const was = store.rec.stage !== "dormant";
    if (c && c.valid) {
      const at2 = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
      if (c.form === 1) c.say("basiliskra.roar_under", c.anchor("nose"), 96);
      else c.say("basiliskra.roar_short", c.anchor("nose"), 128, 1, c.form === 2 ? 1.18 : 1);
      riftOpen(c.dim, at2, RIFT_SIZE[c.form] * 0.6);
      riftClose(c.dim, at2, RIFT_SIZE[c.form] * 0.6);
      this.brain?.finish();
      c.dropParts();
      try {
        c.entity.setProperty(PROP.bound, false);
        c.entity.remove();
      } catch {
      }
    }
    cutAll();
    musicStop();
    this.creature = null;
    this.brain = null;
    this.runner = null;
    this.waterSearch = null;
    this.ending.reset();
    const old = store.rec;
    store.rec = freshRecord();
    store.rec.clock = old.clock;
    store.rec.fallout = old.fallout;
    store.rec.sites = old.sites;
    store.save();
    store.flush();
    return was;
  }
  /** The config wheel: his next change, now, where he stands (with its scene). */
  evolveNow() {
    const c = this.creature, rec = store.rec;
    if (!c || !c.valid || rec.stage !== "alive") return "He is not here to change.";
    if (rec.evolve) return "He is changing already.";
    if (rec.form >= MAX_FORM) return `Basiliskra ${ROMAN2[rec.form]} is his last form.`;
    this.ending.reset();
    rec.evolve = { to: rec.form + 1, step: 0, t0: this.now, at: { ...c.pos } };
    store.save();
    return `Basiliskra ${ROMAN2[rec.form]} is changing into Basiliskra ${ROMAN2[rec.form + 1]}.`;
  }
  /** The config wheel: forget everything, as if the pack had just been added. */
  resetStory() {
    const c = this.creature;
    musicStop();
    this.creature = null;
    this.brain = null;
    this.runner = null;
    this.ending.reset();
    if (c) {
      c.dropParts();
      try {
        c.entity.setProperty(PROP.bound, false);
        c.entity.remove();
      } catch {
      }
    }
    const clock = store.rec.clock;
    store.rec = freshRecord();
    store.rec.clock = clock;
    clearHarm();
    clearFallout();
    store.save();
    store.flush();
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
  create(dim, at2, yaw) {
    const rec = store.rec;
    if (this.creature || rec.entityId !== null || !rec.token) return false;
    if (rec.stage !== "arriving" && rec.stage !== "alive") return false;
    if (!isLoaded(dim, at2)) return false;
    let e;
    try {
      e = dim.spawnEntity(TYPE, at2, { initialRotation: yaw });
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
        dim = world11.getDimension(id);
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
        list = dim.getEntities({ families: [PART_FAMILY] });
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
      system5.run(() => {
        try {
          b.finish();
        } catch {
        }
      });
    }
    system5.run(() => {
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
  driveOff(force = false) {
    const c = this.creature, rec = store.rec;
    if (!c || !c.valid || rec.stage !== "alive") return;
    if (!force && (rec.evolve || rec.ending?.step)) return;
    if (force) {
      this.ending.reset();
      rec.evolve = null;
    }
    const at2 = { x: c.pos.x, y: c.pos.y + 3, z: c.pos.z };
    if (c.form === 1) c.say("basiliskra.roar_under", c.anchor("nose"), 96);
    else c.say("basiliskra.roar_short", c.anchor("nose"), 128, 1, c.form === 2 ? 1.18 : 1);
    shake(c, 80, c.form === 1 ? 0.3 : 0.5, 1.2);
    sound(c.dim, "basiliskra.rift.open", at2, 72, 1, 1.3);
    sound(c.dim, "basiliskra.rift.close", at2, 72);
    for (const p of [at2, c.anchor("nose"), c.anchor("tail_notch")]) particle(c.dim, "basiliskra:seam_close", p, 72);
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
      c.say("basiliskra.hurt", c.anchor("nose"), 64, 1, c.form === 1 ? 0.95 : c.form === 2 ? 1.25 : 1.05);
    }
  }
  // ---- tick ----------------------------------------------------------------------------------------
  tick() {
    const rec = store.rec;
    const now = ++rec.clock;
    if (now % 600 === 0) store.touch();
    beginTick(now);
    filmTick();
    falloutTick(now);
    musicTick(this.creature, now, this.brain?.actName ?? "", this.brain?.hurtAt ?? -1);
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
    if (a.land) {
      this.arriveLand();
      return;
    }
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
        const tod = world11.getTimeOfDay();
        if (near && (isDusk(tod) || t > pace(1.2 * TICKS.day))) this.setStep(1);
        break;
      }
      case 1: {
        if (t % KNOCK_GAP_TICKS === 2 && t < KNOCK_GAP_TICKS * 3) {
          let at2 = add(a.water, { x: 0, y: 5.5, z: 0 });
          try {
            const boat = dim.getEntities({ location: a.water, maxDistance: 40, families: ["boat"] }).find((b) => {
              try {
                return !b.getComponent("minecraft:rideable")?.getRiders().length;
              } catch {
                return true;
              }
            });
            if (boat) {
              at2 = boat.location;
              boat.applyImpulse({ x: (hash(now, 1) - 0.5) * 0.2, y: 0.02, z: (hash(now, 2) - 0.5) * 0.2 });
            }
          } catch {
          }
          sound(dim, "basiliskra.boat_knock", at2, 32);
        }
        if (t > KNOCK_GAP_TICKS * 3 + 30) {
          rec.rift = { ...a.water, yaw: a.yaw };
          this.setStep(2);
        }
        break;
      }
      case 2: {
        const foot = { x: a.water.x, y: a.water.y - 2, z: a.water.z };
        if (t === 1) {
          riftOpen(dim, foot, RIFT_SIZE[1]);
          sceneTheme("dread", 300, foot, dim.id);
          addFallout(a.water, 4, 0.4);
          const head = () => this.creature ? this.creature.anchor("nose") : { x: a.water.x, y: a.water.y + 4, z: a.water.z };
          film(dim, head, { ticks: 330, radius: 110, dist: 30, height: 9, orbit: 50, distEnd: 22, flash: { red: 0.8, green: 0.05, blue: 0.05 } });
        }
        riftTick(dim, foot, RIFT_SIZE[1], t, Math.min(1, t / 90));
        if (t % 4 === 0) particle(dim, "basiliskra:seam", a.water, 72);
        if (t > 90 && near) this.setStep(SPAWN_STEP);
        break;
      }
      case SPAWN_STEP: {
        riftTick(dim, { x: a.water.x, y: a.water.y - 2, z: a.water.z }, RIFT_SIZE[1], t, 1);
        if (!this.creature) {
          if (t % 20 !== 1) break;
          const at2 = add(a.water, mul(forwardOf(a.yaw), -7));
          if (!this.create(dim, at2, a.yaw)) break;
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
            rec.born = Math.max(1, now);
            rec.mut.formSince = now;
          }
          store.save();
          this.brain?.finish();
        }
        break;
      }
    }
  }
  // ---- a rift on land (a call from the wheel once he is Basiliskra II or more) -----------------------------
  arriveLand() {
    const rec = store.rec, a = rec.arrival, dim = overworld(), t = this.now - a.t0;
    const form = rec.form, size = RIFT_SIZE[form], at2 = a.water;
    if (a.step === 0) {
      if (this.riftShown !== a.t0) {
        this.riftShown = a.t0;
        riftOpen(dim, at2, size);
        sceneTheme(store.rec.form >= 3 ? "wrath" : "dread", 420, at2, dim.id);
        addFallout(at2, 5, 0.5);
        const focus = () => this.creature ? this.creature.anchor("nose") : { x: at2.x, y: at2.y + size * 0.4, z: at2.z };
        film(dim, focus, {
          ticks: 400,
          radius: 120,
          dist: size * 1.5 + 14,
          height: size * 0.35 + 4,
          orbit: 60,
          distEnd: size * 1.2 + 10,
          flash: { red: 0.8, green: 0.05, blue: 0.05 }
        });
      }
      riftTick(dim, at2, size, t, Math.min(1, t / 60));
      if (t < 60) return;
      if (!this.creature) {
        const f = forwardOf(a.yaw);
        const reach = [0, 14, 12, 30, 20][form];
        const back = add(at2, mul(f, -(reach + 2)));
        if (!this.create(dim, { x: back.x, y: at2.y + 1, z: back.z }, a.yaw)) return;
      }
      const c = this.creature;
      c.set(PROP.visLo, 9);
      c.setPhase("move");
      c.wade = true;
      this.setStep(4);
      this.runner = this.landWalk();
      return;
    }
    if (!this.creature) {
      if (rec.entityId !== null) return;
      if (this.create(dim, { x: at2.x, y: at2.y + 1, z: at2.z }, a.yaw)) this.finishArrival();
      return;
    }
    if (!this.runner) {
      this.finishArrival();
      return;
    }
    const done = this.runner.next().done;
    this.creature.update();
    if (done) {
      this.runner = null;
      this.finishArrival();
    }
  }
  /** He is through: the story has him, and he says so. */
  finishArrival() {
    const rec = store.rec, c = this.creature;
    rec.stage = "alive";
    rec.arrival = null;
    if (!rec.born) {
      rec.born = Math.max(1, this.now);
      rec.mut.formSince = this.now;
    }
    store.save();
    if (c) {
      c.set(PROP.visLo, 0);
      c.set(PROP.visHi, 8);
      c.wade = false;
    }
    this.brain?.finish();
    const b = this.brain;
    if (b instanceof BrainThree) b.forced = { name: "roar", run: b.roar(true), limit: 220 };
    else if (b instanceof BrainTwo) b.forced = { name: "roar", run: b.roar(), limit: 120 };
  }
  /** He walks out through the tear: what has passed it is what is seen.  Then it closes behind him. */
  *landWalk() {
    const rec = store.rec, a = rec.arrival, dim = overworld();
    const form = rec.form, size = RIFT_SIZE[form];
    const at2 = a.water, f = forwardOf(a.yaw);
    const tail = [0, 26, 24, 42, 62][form];
    const c = this.creature;
    c.goTo(add(at2, mul(f, tail + 4)), form === 2 ? 0.1 : 0.14, 2);
    for (let t = 0; t < 700; t++) {
      if (!this.creature) return;
      const pass = this.passed(c, at2, a.yaw);
      let lo = 9;
      for (let z = 8; z >= 0 && pass[z]; z--) lo = z;
      c.set(PROP.visLo, lo);
      riftTick(dim, at2, size, 60 + t, 1);
      if (t % 24 === 0) {
        c.say(form >= 3 ? "basiliskra.iii.step" : "basiliskra.ii.drag", c.anchor("nose"), 96, 1, 0.9);
        shake(c, 48, 0.2, 0.3);
      }
      if (lo === 0 || c.arrived() || c.blocked > 40) break;
      yield;
    }
    c.wade = false;
    c.set(PROP.visLo, 0);
    c.halt();
    riftClose(dim, at2, size);
    for (let t = 0; t < 20; t++) yield;
  }
  /** Zones (head 8 .. tail 0) that have passed a plane through `at` facing `yaw`. */
  passed(c, at2, yaw) {
    const f = forwardOf(yaw);
    const zones2 = RIGS[c.form].zones;
    const out = [];
    for (let z = 0; z <= 8; z++) {
      const bones = zones2[String(z)];
      if (!bones || !bones.length) {
        out.push(out.length ? out[out.length - 1] : false);
        continue;
      }
      const p = c.point(bones[0], RIGS[c.form].bones[bones[0]].pivot);
      out.push(dot(sub(p, at2), f) > 0);
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
        riftTick(dim, { x: a.water.x, y: a.water.y - 2, z: a.water.z }, RIFT_SIZE[1], t, 1);
        if (lo === 0) break;
        yield;
      }
      c.set(PROP.visLo, 0);
      riftClose(dim, { x: a.water.x, y: a.water.y - 2, z: a.water.z }, RIFT_SIZE[1]);
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
          sound(dim, "basiliskra.roar_under", nose, 96, 0.9);
          shake(c, 64, 0.35, 1.5);
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
        const e = world11.getEntity(rec.entityId);
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
    const at2 = rec.form !== 1 && rec.home ? rec.home : rec.form === 1 ? rec.rift : rec.beach ?? rec.rift;
    const near = players().some((p) => {
      try {
        return p.dimension.id === dim.id && distXZ(p.location, at2) < 96;
      } catch {
        return false;
      }
    });
    if (!near) return;
    if (!isLoaded(dim, at2)) return;
    sound(dim, "basiliskra.rift.open", rec.rift, 72);
    this.create(dim, { x: at2.x + 0.5, y: at2.y + (rec.form === 1 ? 0 : 1), z: at2.z + 0.5 }, rec.rift.yaw);
  }
  // ---- evolution: the same entity, in place, resumable ---------------------------------------------------
  evolve(c) {
    const rec = store.rec, ev = rec.evolve, now = this.now;
    const t = now - ev.t0;
    c.halt();
    const big = [0, 6, 9, 16, 26][ev.to] ?? 16;
    const heart = { x: c.pos.x, y: c.pos.y + big * 0.45, z: c.pos.z };
    const GATHER = 150;
    if (ev.step === 0) {
      if (c.phase !== "evolve") {
        this.brain?.finish();
        c.setPhase("evolve");
        c.say("basiliskra.mutate", c.pos, 72);
        film(
          c.dim,
          () => ({ x: c.pos.x, y: c.pos.y + big * 0.45, z: c.pos.z }),
          { ticks: GATHER + 190, radius: 120, dist: big * 2.4 + 12, height: big * 0.5 + 3, orbit: 140, distEnd: big * 1.7 + 10 }
        );
      }
      c.setCharge(Math.min(20, t / GATHER * 20));
      if (t % 6 === 0) particle(c.dim, "basiliskra:mutate_gather", heart, 160, sizeVars(big));
      if (t % 20 === 0) shake(c, 90, 0.12 + 0.4 * Math.min(1, t / GATHER), 1);
      if (t === 70) c.say("basiliskra.mutate", c.pos, 72, 1, 1.12);
      if (t >= GATHER || t < 0) {
        particle(c.dim, "basiliskra:mutate_burst", heart, 200);
        particle(c.dim, "basiliskra:rift_flash", { x: c.pos.x, y: c.pos.y, z: c.pos.z }, 200, sizeVars(big * 1.6));
        sound(c.dim, "ambient.weather.thunder", heart, 128, 1, 0.55);
        for (const p of players()) {
          try {
            if (p.dimension.id === c.dim.id && dist(p.location, c.pos) < 140) p.camera.fade({ fadeColor: { red: 1, green: 0.85, blue: 0.8 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.12, fadeOutTime: 0.9 } });
          } catch {
          }
        }
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
        addFallout(c.pos, rec.form === 3 ? 7 : 4, rec.form === 3 ? 0.9 : 0.45);
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
    c.setCharge(Math.max(0, 20 - t * 0.2));
    if (t % 10 === 0 && t < 60) particle(c.dim, "basiliskra:shed_flakes", heart, 96);
    if (t >= 110) {
      c.setCharge(0);
      rec.evolve = null;
      store.save();
      this.brain?.finish();
      const b = this.brain;
      if (b instanceof BrainThree) b.forced = { name: "roar", run: b.roar(true), limit: 220 };
      else if (b instanceof BrainTwo) b.forced = { name: "roar", run: b.roar(), limit: 120 };
    }
  }
  dropFin(dim, at2) {
    try {
      dim.spawnItem(new ItemStack2(FIN_ITEM, 1), { x: at2.x, y: at2.y + 1, z: at2.z });
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

// src/main.ts
var ctl = new Controller();
var ready = false;
var lastFault2 = "";
var faultAt = -1e9;
var SPLASHERS = /* @__PURE__ */ new Set(["minecraft:snowball", "minecraft:egg", "minecraft:item", "minecraft:ender_pearl"]);
var flying = [];
function splash(at2, by) {
  const dim = overworld();
  sound(dim, "basiliskra.splash", at2, 24, 0.9);
  particle(dim, "basiliskra:splash", at2, 32);
  ctl.brain?.onSplash(at2, by);
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
world12.afterEvents.worldLoad.subscribe(() => {
  loadSettings();
  ctl.init();
  ready = true;
  system6.runInterval(() => {
    try {
      trackSplashes();
      ctl.tick();
    } catch (e) {
      const m = String(e);
      if (m !== lastFault2 || store.rec.clock - faultAt > 1200) {
        lastFault2 = m;
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
system6.beforeEvents.shutdown.subscribe(() => {
  try {
    store.flush();
    store.save();
  } catch {
  }
});
world12.afterEvents.entityLoad.subscribe((ev) => {
  if (!ready) return;
  try {
    if (ev.entity.typeId === TYPE) ctl.inspect(ev.entity);
    else if (isHitbox(ev.entity.typeId) && !partOwner.has(ev.entity.id)) ev.entity.remove();
  } catch {
  }
});
world12.afterEvents.entitySpawn.subscribe((ev) => {
  if (!ready) return;
  try {
    const id = ev.entity.typeId;
    if (id === TYPE) {
      ctl.inspect(ev.entity);
      return;
    }
    if (isHitbox(id)) {
      if (!partOwner.has(ev.entity.id)) ev.entity.remove();
      return;
    }
    if (SPLASHERS.has(id) && ev.entity.dimension.id === OVERWORLD && ctl.creature && flying.length < 16 && dist(ev.entity.location, ctl.creature.pos) < 64) flying.push({ e: ev.entity, born: store.rec.clock });
  } catch {
  }
});
world12.beforeEvents.entityRemove.subscribe((ev) => {
  try {
    const id = ev.removedEntity.typeId;
    if (id === TYPE) ctl.onRemoving(ev.removedEntity);
    else if (isHitbox(id)) partOwner.delete(ev.removedEntity.id);
  } catch {
  }
});
var PASSES = /* @__PURE__ */ new Set([
  EntityDamageCause6.entityAttack,
  EntityDamageCause6.projectile,
  EntityDamageCause6.entityExplosion,
  EntityDamageCause6.blockExplosion,
  EntityDamageCause6.magic,
  EntityDamageCause6.thorns,
  EntityDamageCause6.sonicBoom,
  EntityDamageCause6.maceSmash,
  EntityDamageCause6.override
]);
var forwardTick = -1;
var forwardKey = "";
var struckAt = /* @__PURE__ */ new Map();
var swungAt = /* @__PURE__ */ new Map();
function meleeDamage(id) {
  if (!id) return 1;
  const tier = /netherite/.test(id) ? 4 : /diamond/.test(id) ? 3 : /iron/.test(id) ? 2 : /stone/.test(id) ? 1 : /wooden|golden/.test(id) ? 0 : -1;
  if (/_sword$/.test(id)) return 5 + Math.max(0, tier);
  if (/_axe$/.test(id)) return 4 + Math.max(0, tier);
  if (/_pickaxe$/.test(id)) return 3 + Math.max(0, tier);
  if (/_shovel$|_hoe$/.test(id)) return 2 + Math.max(0, tier);
  if (id === "minecraft:trident") return 9;
  if (id === "minecraft:mace") return 6;
  return 1;
}
world12.afterEvents.playerSwingStart.subscribe((ev) => {
  const c0 = ctl.creature;
  if (!ready || !c0 || !c0.valid) return;
  if (ev.swingSource !== EntitySwingSource.Attack) return;
  const p = ev.player;
  const t0 = store.rec.clock;
  const held = ev.heldItemStack?.typeId;
  system6.runTimeout(() => {
    try {
      const c = ctl.creature;
      if (!c || !c.valid || !p.isValid || p.dimension.id !== c.dim.id) return;
      if ((struckAt.get(p.id) ?? -99) >= t0) return;
      if (store.rec.clock - (swungAt.get(p.id) ?? -99) < 8) return;
      const from = p.getHeadLocation(), dir = p.getViewDirection();
      const reach = p.getGameMode() === GameMode2.Creative ? 6.5 : 4.5;
      const hit = c.rayHit(from, dir, reach);
      if (!hit) return;
      if (hit.dist > 0.3 && !clearLine(c.dim, from, { x: from.x + dir.x * hit.dist, y: from.y + dir.y * hit.dist, z: from.z + dir.z * hit.dist })) return;
      swungAt.set(p.id, store.rec.clock);
      const amount = meleeDamage(held) * (hit.tag === "head" ? 1.25 : hit.tag === "tail" ? 0.6 : 1);
      c.entity.applyDamage(amount, { cause: EntityDamageCause6.entityAttack, damagingEntity: p });
    } catch {
    }
  }, 2);
});
world12.beforeEvents.entityHurt.subscribe((ev) => {
  let type;
  try {
    type = ev.hurtEntity.typeId;
  } catch {
    return;
  }
  if (isHitbox(type)) {
    ev.cancel = true;
    const owner = partOwner.get(ev.hurtEntity.id);
    if (!owner) return;
    const amount = ev.damage * (owner.tag === "head" ? 1.25 : owner.tag === "tail" ? 0.6 : 1);
    const cause = ev.damageSource.cause, by = ev.damageSource.damagingEntity;
    if (!PASSES.has(cause) || amount <= 0) return;
    const key = `${cause}|${by?.id ?? ""}`;
    if (by) struckAt.set(by.id, store.rec.clock);
    if (forwardTick === store.rec.clock && forwardKey === key) return;
    forwardTick = store.rec.clock;
    forwardKey = key;
    system6.run(() => {
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
    system6.run(() => ctl.driveOff());
    return;
  }
  if (ev.damage >= health - 1) {
    ev.damage = Math.max(0, health - 1.5);
    system6.run(() => ctl.driveOff());
  }
});
world12.afterEvents.entityHurt.subscribe((ev) => {
  try {
    if (ev.hurtEntity.typeId !== TYPE) return;
    const by = ev.damageSource.damagingEntity;
    ctl.onHurt(by && by.typeId === "minecraft:player" ? by : void 0, ev.damage);
  } catch {
  }
});
world12.afterEvents.entityDie.subscribe((ev) => {
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
world12.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    if (ev.dimension.id !== OVERWORLD) return;
    const t = recordHabitat(ev.block.location, ev.brokenBlockPermutation.type.id, ev.player.id, ev.player.name, store.rec.clock);
    if (t) ctl.requestArrival(t);
  } catch {
  }
});
world12.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  try {
    const id = ev.block.typeId, at2 = ev.block.location;
    if (id === "minecraft:bell") ctl.brain?.onBell(at2, ev.player);
    else if (id === "minecraft:noteblock") {
      ctl.ending.onNote(at2);
      ctl.brain?.onNote(at2);
    } else if (ev.beforeItemStack?.typeId === "minecraft:water_bucket") {
      const p = { x: at2.x + 0.5, y: at2.y + 1, z: at2.z + 0.5 };
      system6.runTimeout(() => {
        try {
          if (isWaterId(idAt(ev.player.dimension, p)) || isWaterId(idAt(ev.player.dimension, at2))) splash(p, ev.player);
        } catch {
        }
      }, 4);
    }
  } catch {
  }
});
world12.afterEvents.weatherChange.subscribe((ev) => {
  const w = String(ev.newWeather).toLowerCase();
  store.rec.weather = w.includes("thunder") ? "thunder" : w.includes("rain") ? "rain" : "clear";
  store.touch();
});
world12.afterEvents.itemUse.subscribe((ev) => {
  try {
    const id = ev.itemStack.typeId;
    if (id === JOURNAL_ITEM) void openJournal(ev.source, ctl);
    else if (id === WHEEL_ITEM) void openWheel(ev.source, ctl);
  } catch {
  }
});
world12.afterEvents.itemCompleteUse.subscribe((ev) => {
  try {
    if (isIodine(ev.itemStack?.typeId)) takeIodine(ev.source);
  } catch {
  }
});
world12.afterEvents.playerSpawn.subscribe((ev) => {
  releaseStale(ev.player);
  if (!ev.initialSpawn) return;
  falloutJoin(ev.player);
  musicJoin(ev.player);
  const p = ev.player;
  system6.runTimeout(() => {
    try {
      if (p.isValid) giveStarterItems(p);
    } catch {
    }
  }, 60);
});
var FORMS = ["story", "i", "ii", "iii"];
system6.beforeEvents.startup.subscribe((ev) => {
  try {
    ev.blockComponentRegistry.registerCustomComponent(FADES_COMPONENT, { onRandomTick: (e) => fadeBlock(e.block) });
  } catch (e) {
    console.warn(`[basiliskra] the fading of his blocks could not be registered: ${e}`);
  }
  const reg = ev.customCommandRegistry;
  const who = (o) => {
    const e = o.initiator ?? o.sourceEntity;
    return e && e.typeId === "minecraft:player" ? e : void 0;
  };
  const fail = (message) => ({ status: CustomCommandStatus.Failure, message });
  try {
    reg.registerEnum(`${NS}:form`, FORMS);
    reg.registerCommand({
      name: `${NS}:spawn`,
      description: "Bring the one Basiliskra here (form: story, i, ii or iii). Moves him if he is about.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ name: `${NS}:form`, type: CustomCommandParamType.Enum }]
    }, (origin, form) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      const want = Math.max(0, FORMS.indexOf(form ?? "story"));
      system6.run(() => {
        try {
          if (p.dimension.id !== OVERWORLD) {
            p.sendMessage("§7[Basiliskra] He only lives in the Overworld.");
            return;
          }
          const rec = store.rec;
          const place2 = placeFor(p, want || (rec.born > 0 ? rec.form : 3));
          p.sendMessage(`§7[Basiliskra] ${ctl.bringHere(place2.at, place2.yaw, want)}`);
        } catch (e) {
          p.sendMessage(`§c[Basiliskra] ${e}`);
        }
      });
      return { status: CustomCommandStatus.Success, message: "Calling Basiliskra..." };
    });
    reg.registerCommand({
      name: `${NS}:journal`,
      description: "Open the Basiliskra journal: how angry he is, and when he will come.",
      permissionLevel: CommandPermissionLevel.Any,
      cheatsRequired: false
    }, (origin) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system6.run(() => {
        void openJournal(p, ctl);
      });
      return { status: CustomCommandStatus.Success };
    });
    reg.registerCommand({
      name: `${NS}:config`,
      description: "Open the Basiliskra config wheel (settings; bring, call or send him).",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false
    }, (origin) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system6.run(() => {
        if (canAdmin(p)) void openWheel(p, ctl);
        else p.sendMessage("§7[Basiliskra] Only an operator can use the config wheel.");
      });
      return { status: CustomCommandStatus.Success };
    });
  } catch (e) {
    console.warn(`[${NS}] commands: ${e}`);
  }
});
system6.afterEvents.scriptEventReceive.subscribe((ev) => {
  if (!CONFIG.debug || ev.id !== `${NS}:debug`) return;
  const [cmd, arg] = ev.message.split(" ");
  const rec = store.rec;
  const src = ev.sourceEntity;
  if (cmd === "status") {
    world12.sendMessage(`[${NS}] stage=${rec.stage} form=${rec.form} id=${rec.entityId} loaded=${!!ctl.creature} act=${ctl.brain?.actName} quarantined=${ctl.quarantined}`);
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
    world12.setTimeOfDay(12200);
  }
}, { namespaces: [NS] });
export {
  ctl
};
