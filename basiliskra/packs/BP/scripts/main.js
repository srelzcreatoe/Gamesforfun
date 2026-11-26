// Basiliskra behaviour script. Built from src/*.ts (see the repository). Stable @minecraft/server 2.11.0 and @minecraft/server-ui 2.3.0 only.


// src/main.ts
import { CommandPermissionLevel, CustomCommandParamType, CustomCommandStatus, EntityDamageCause as EntityDamageCause11, EntitySwingSource, GameMode as GameMode2, system as system6, world as world16 } from "@minecraft/server";

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
  /**
   * Minutes he spends in each form before he changes into the next.  Time is the only thing a change waits on.
   * 0: the story's own timing (two in-game days as I, two as II, three as III: 40, 40 and 60 minutes at story
   * speed 1).  Any other number: that many minutes for every change.
   */
  changeMinutes: 0,
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
  /** Cities are raised on coasts as players explore (never where anything built stands).  Off: only where an operator asks. */
  cities: true,
  /** Short cutscenes (a camera that shows the rift opening, him coming through, and each transformation). */
  cutscenes: true,
  /** His themes play when he is near, fighting, or in his last form. */
  music: true,
  /**
   * Vathrok (2.0), the other kaiju, met in survival: now and then at night it comes up out of the ground near a
   * player, and whenever its lure is used; it can be beaten.  Off: it never comes, and one that is about goes.
   */
  vathrok: true,
  /** The Vathrok Titan, for battles (its egg, /basiliskra:vathrok titan, the wheel): as strong as the Titan.  Off: none can be made, and those there are go. */
  vathrokTitan: true
};
var SETTINGS = ["pacing", "terrain", "spareStorage", "marks", "damage", "harmlessOnPeaceful", "allowSummon", "spawnForm", "giveJournal", "giveWheel", "debug", "fallout", "sickness", "huntMobs", "cutscenes", "music", "changeMinutes", "cities", "vathrok", "vathrokTitan"];
var SETTINGS_KEY = "bk:cfg";
var NS = "basiliskra";
var TYPE = `${NS}:basiliskra`;
var TITAN = `${NS}:titan`;
var VATHROK = `${NS}:vathrok`;
var VATHROK_TITAN = `${NS}:vathrok_titan`;
var VATHROK_SCALE_ITEM = `${NS}:vathrok_scale`;
var VATHROK_HEART_ITEM = `${NS}:vathrok_heart`;
var VATHROK_LURE_ITEM = `${NS}:vathrok_lure`;
var CIVILIAN = `${NS}:civilian`;
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
  stalk: 28,
  // Basiliskra IV
  stare: 29,
  skid: 30,
  pivot: 31,
  recoil: 32,
  drag: 33,
  swallow: 34,
  carry: 35,
  // the Titan
  fall: 36,
  // 1.8: Form II swimming for the shore; the claw swipe (IV and the Titan); the breath poured onto the ground before it narrows
  swim: 37,
  swipe: 38,
  pour: 39,
  // 1.9: thrown back, head to the sky, before the breath is let go
  rear: 40,
  // 2.3: fighting another giant, he leaps back to have room to breathe at it
  leap: 41
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
    case "changeMinutes":
      return typeof v === "number" && v >= 0 && v <= 600 ? v : void 0;
    case "spawnForm":
      return v === 0 || v === 1 || v === 2 || v === 3 || v === 4 ? v : void 0;
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
import { ItemStack as ItemStack4, PlayerPermissionLevel, system as system2, world as world11 } from "@minecraft/server";
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
function trunkBlocked(dim, at3, feetY, radius, built, cliff, full, smash = false) {
  const ring = full ? [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]] : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const [dx, dz] of ring) {
    const x = at3.x + dx * radius, z = at3.z + dz * radius;
    const top2 = blockAt(dim, { x, y: feetY + cliff, z });
    if (top2 && isSolidBlock(top2) && !isPlantBlock(top2.typeId) && (!smash || isNaturalGround(top2.typeId))) return true;
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
function deepHere(dim, x, z, surface2, need) {
  if (!isLoaded(dim, { x, y: surface2, z })) return UNLOADED;
  for (let d = 1; d <= need; d++) if (!isWaterId(idAt(dim, { x, y: surface2 - d, z }))) return false;
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
function footprintY(dim, at3, radius, yTop, depth, floatY = null) {
  const ys = [];
  let unloaded = 0;
  for (const dx of [-radius, 0, radius]) for (const dz of [-radius, 0, radius]) {
    const x = at3.x + dx, z = at3.z + dz;
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
  let top2 = Math.floor(y);
  let b = blockAt(dim, { x, y: top2, z });
  if (!b) return UNLOADED;
  if (!isWaterId(b.typeId)) {
    let found = false;
    for (let d = 1; d <= reach && !found; d++) {
      for (const yy of [top2 - d, top2 + d]) {
        if (isWaterId(idAt(dim, { x, y: yy, z }))) {
          top2 = yy;
          found = true;
          break;
        }
      }
    }
    if (!found) return NONE;
  }
  while (isWaterId(idAt(dim, { x, y: top2 + 1, z })) && top2 < dim.heightRange.max - 2) top2++;
  let bottom = top2;
  while (bottom > dim.heightRange.min + 1 && bottom > top2 - deep && isWaterId(idAt(dim, { x, y: bottom - 1, z }))) bottom--;
  return { surface: top2 + 1, floor: bottom };
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
function takesMark(dim, at3) {
  const b = blockAt(dim, at3);
  if (!b) return void 0;
  const above = blockAt(dim, { x: at3.x, y: at3.y + 1, z: at3.z });
  if (!above || !WILD.test(above.typeId)) return void 0;
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, 1]) {
      const n = blockAt(dim, { x: at3.x + dx, y: at3.y + dy, z: at3.z + dz });
      if (n && isSolidBlock(n) && !isNaturalGround(n.typeId) && !isPlantBlock(n.typeId)) return void 0;
    }
  }
  return b;
}
function shoreFrom(dim, at3, further, reach = 128, avoid = []) {
  let best = null;
  const dry = (x, z) => {
    const col = waterColumn(dim, x, z, at3.y + 4, 14);
    if (col !== NONE) return null;
    const g = groundY(dim, x, z, at3.y + 24, 48);
    return typeof g === "number" && !isWaterId(idAt(dim, { x, y: g + 1, z })) ? g : null;
  };
  for (let i = 0; i < 24; i++) {
    const a = i / 24 * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
    for (let r = 4; r <= reach && (!best || r < best.d); r += 3) {
      const x = at3.x + cx * r, z = at3.z + cz * r;
      if (!isLoaded(dim, { x, y: at3.y, z })) break;
      const g = dry(x, z);
      if (g === null) continue;
      if (avoid.some((q) => Math.hypot(q.x - x, q.z - z) < 14)) break;
      const ix = at3.x + cx * (r + further), iz = at3.z + cz * (r + further);
      const gi = isLoaded(dim, { x: ix, y: at3.y, z: iz }) ? dry(ix, iz) : null;
      best = { edge: { x, y: g + 1, z }, inland: gi === null ? { x, y: g + 1, z } : { x: ix, y: gi + 1, z: iz }, d: r };
      break;
    }
  }
  return best;
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
function witnesses(dim, at3, range) {
  const out = [];
  for (const p of playerCache) {
    try {
      if (p.isValid && p.dimension.id === dim.id && dist(p.location, at3) <= range) out.push(p);
    } catch {
    }
  }
  return out;
}
var QUIET = /^basiliskra\.(geiger|fin_pulse|boat_knock|splash|bell_pin|scrape_far|iii\.window_breath|music)/;
var NEAR = 40;
var FAR = 220;
function sound(dim, id, at3, range = 48, volume = 1, pitch = 1) {
  if (id.startsWith("basiliskra.") && !QUIET.test(id)) {
    loud(dim, id, at3, volume, pitch);
    return;
  }
  for (const p of witnesses(dim, at3, range)) {
    try {
      p.playSound(id, { location: at3, volume, pitch });
    } catch {
    }
  }
}
function loud(dim, id, at3, volume = 1, pitch = 1, far = FAR) {
  for (const p of playerCache) {
    try {
      if (!p.isValid || p.dimension.id !== dim.id) continue;
      const l = p.location, d = dist(l, at3);
      if (d > far) continue;
      if (d <= NEAR) {
        p.playSound(id, { location: at3, volume, pitch });
        continue;
      }
      const k = 10 / d;
      const from = { x: l.x + (at3.x - l.x) * k, y: l.y + 1.6 + (at3.y - l.y) * k, z: l.z + (at3.z - l.z) * k };
      const v = volume * (1 - 0.8 * Math.pow((d - NEAR) / (far - NEAR), 0.8));
      p.playSound(id, { location: from, volume: v, pitch });
    } catch {
    }
  }
}
function stopSound(dim, id, at3, range = 192) {
  for (const p of witnesses(dim, at3, range)) {
    try {
      p.runCommand(`stopsound @s ${id}`);
    } catch {
    }
  }
}
function particle(dim, id, at3, range = 48, vars2, but) {
  if (!isLoaded(dim, at3)) return;
  for (const p of witnesses(dim, at3, range)) {
    if (spent >= PARTICLE_BUDGET) return;
    if (but && p.id === but.id) continue;
    spent++;
    try {
      p.spawnParticle(id, at3, vars2);
    } catch {
    }
  }
}
function particleFor(to, id, at3, vars2) {
  for (const p of to) {
    if (spent >= PARTICLE_BUDGET) return;
    spent++;
    try {
      p.spawnParticle(id, at3, vars2);
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
function flash(dim, at3, range, color, fadeIn = 0.05, hold = 0.1, fadeOut = 0.5) {
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id || dist(p.location, at3) > range) continue;
      p.camera.fade({ fadeColor: color, fadeTime: { fadeInTime: fadeIn, holdTime: hold, fadeOutTime: fadeOut } });
    } catch {
    }
  }
}

// src/generated/rig.ts
var RIGS = { "1": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 36, 0], "rot": [0, 0, 0], "zone": 6 }, "chest": { "parent": "body", "pivot": [0, 36, 0], "rot": [0, 0, 0], "zone": 6 }, "gill_l1": { "parent": "chest", "pivot": [48, 36, -17], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "chest", "pivot": [48, 36, -7], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "chest", "pivot": [48, 36, 3], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "chest", "pivot": [-48, 36, -17], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "chest", "pivot": [-48, 36, -7], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "chest", "pivot": [-48, 36, 3], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "chest", "pivot": [0, 36, -24], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 32, -34], "rot": [4, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [27.4, 45.6, -78], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-27.4, 45.6, -78], "rot": [0, 0, 0], "zone": 8 }, "fin_l": { "parent": "chest", "pivot": [40, 13, 16], "rot": [0, -34, 30], "zone": 6 }, "fin_l_tip": { "parent": "fin_l", "pivot": [74, 13, 16], "rot": [0, 0, 0], "zone": 6 }, "fin_r": { "parent": "chest", "pivot": [-40, 13, 16], "rot": [0, 34, -30], "zone": 6 }, "fin_r_tip": { "parent": "fin_r", "pivot": [-74, 13, 16], "rot": [0, 0, 0], "zone": 6 }, "ribbon0": { "parent": "chest", "pivot": [0, 72, 6], "rot": [0, 0, 0], "zone": 6 }, "seg1": { "parent": "chest", "pivot": [0, 36, 24], "rot": [0, 0, 0], "zone": 5 }, "ribbon1": { "parent": "seg1", "pivot": [0, 72, 40], "rot": [0, 0, 0], "zone": 5 }, "seg2": { "parent": "seg1", "pivot": [0, 36, 56], "rot": [0, 0, 0], "zone": 5 }, "ribbon2": { "parent": "seg2", "pivot": [0, 71.5, 72], "rot": [0, 0, 0], "zone": 5 }, "seg3": { "parent": "seg2", "pivot": [0, 36, 88], "rot": [0, 0, 0], "zone": 5 }, "ribbon3": { "parent": "seg3", "pivot": [0, 70.5, 104], "rot": [0, 0, 0], "zone": 5 }, "seg4": { "parent": "seg3", "pivot": [0, 36, 120], "rot": [0, 0, 0], "zone": 4 }, "ribbon4": { "parent": "seg4", "pivot": [0, 69, 136], "rot": [0, 0, 0], "zone": 4 }, "seg5": { "parent": "seg4", "pivot": [0, 36, 152], "rot": [0, 0, 0], "zone": 4 }, "ribbon5": { "parent": "seg5", "pivot": [0, 67, 168], "rot": [0, 0, 0], "zone": 4 }, "seg6": { "parent": "seg5", "pivot": [0, 36, 184], "rot": [0, 0, 0], "zone": 3 }, "ribbon6": { "parent": "seg6", "pivot": [0, 64.5, 200], "rot": [0, 0, 0], "zone": 3 }, "vribbon6": { "parent": "seg6", "pivot": [0, 7.5, 200], "rot": [0, 0, 0], "zone": 3 }, "seg7": { "parent": "seg6", "pivot": [0, 36, 216], "rot": [0, 0, 0], "zone": 3 }, "ribbon7": { "parent": "seg7", "pivot": [0, 61, 232], "rot": [0, 0, 0], "zone": 3 }, "vribbon7": { "parent": "seg7", "pivot": [0, 11, 232], "rot": [0, 0, 0], "zone": 3 }, "seg8": { "parent": "seg7", "pivot": [0, 36, 248], "rot": [0, 0, 0], "zone": 2 }, "ribbon8": { "parent": "seg8", "pivot": [0, 57, 264], "rot": [0, 0, 0], "zone": 2 }, "vribbon8": { "parent": "seg8", "pivot": [0, 15, 264], "rot": [0, 0, 0], "zone": 2 }, "seg9": { "parent": "seg8", "pivot": [0, 36, 280], "rot": [0, 0, 0], "zone": 1 }, "ribbon9": { "parent": "seg9", "pivot": [0, 53, 296], "rot": [0, 0, 0], "zone": 1 }, "vribbon9": { "parent": "seg9", "pivot": [0, 19, 296], "rot": [0, 0, 0], "zone": 1 }, "seg10": { "parent": "seg9", "pivot": [0, 36, 312], "rot": [0, 0, 0], "zone": 1 }, "ribbon10": { "parent": "seg10", "pivot": [0, 49.5, 328], "rot": [0, 0, 0], "zone": 1 }, "vribbon10": { "parent": "seg10", "pivot": [0, 22.5, 328], "rot": [0, 0, 0], "zone": 1 }, "tailfin": { "parent": "seg10", "pivot": [0, 36, 344], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "back": { "bone": "chest", "pos": [0, 72, 0] }, "belly": { "bone": "chest", "pos": [0, 0, 0] }, "spine_0": { "bone": "chest", "pos": [0, 72, 0] }, "gill_l": { "bone": "chest", "pos": [49, 36, -7] }, "gill_r": { "bone": "chest", "pos": [-49, 36, -7] }, "muzzle": { "bone": "head", "pos": [0, 34, -114] }, "nose": { "bone": "head", "pos": [0, 40, -112] }, "throat": { "bone": "head", "pos": [0, 28, -32] }, "mouth": { "bone": "jaw", "pos": [0, 31, -94] }, "eye_l": { "bone": "eye_l", "pos": [27.9, 45.6, -78] }, "eye_r": { "bone": "eye_r", "pos": [-27.9, 45.6, -78] }, "fin_l": { "bone": "fin_l_tip", "pos": [120, 13, 22] }, "fin_r": { "bone": "fin_r_tip", "pos": [-120, 13, 22] }, "spine_1": { "bone": "seg1", "pos": [0, 72, 40] }, "spine_2": { "bone": "seg2", "pos": [0, 71.5, 72] }, "spine_3": { "bone": "seg3", "pos": [0, 70.5, 104] }, "spine_4": { "bone": "seg4", "pos": [0, 69, 136] }, "spine_5": { "bone": "seg5", "pos": [0, 67, 168] }, "spine_6": { "bone": "seg6", "pos": [0, 64.5, 200] }, "spine_7": { "bone": "seg7", "pos": [0, 61, 232] }, "spine_8": { "bone": "seg8", "pos": [0, 57, 264] }, "spine_9": { "bone": "seg9", "pos": [0, 53, 296] }, "spine_10": { "bone": "seg10", "pos": [0, 49.5, 328] }, "knob_u": { "bone": "tailfin", "pos": [0, 100, 409] }, "knob_d": { "bone": "tailfin", "pos": [0, -28, 409] }, "tail_notch": { "bone": "tailfin", "pos": [2.5, 76, 405] }, "tail_tip": { "bone": "tailfin", "pos": [0, 36, 410] } }, "meta": { "glow_y0": 10, "glow_y1": 74, "wetness": 0.8, "bounds_margin": 6, "form": 1 }, "zones": { "6": ["body", "chest", "fin_l", "fin_l_tip", "fin_r", "fin_r_tip", "ribbon0"], "7": ["gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "jaw", "eye_l", "eye_r"], "5": ["seg1", "ribbon1", "seg2", "ribbon2", "seg3", "ribbon3"], "4": ["seg4", "ribbon4", "seg5", "ribbon5"], "3": ["seg6", "ribbon6", "vribbon6", "seg7", "ribbon7", "vribbon7"], "2": ["seg8", "ribbon8", "vribbon8"], "1": ["seg9", "ribbon9", "vribbon9", "seg10", "ribbon10", "vribbon10"], "0": ["tailfin"] }, "boxes": { "chest": [[-48, 0, -33], [48, 72, 33]], "head": [[-43, 32, -110.5], [43, 68, -20]], "jaw": [[-41, 7, -107.6], [41, 30.8, -19.2]], "fin_l": [[34, 8.5, 0], [74, 17.5, 32]], "fin_l_tip": [[70, 10.8, -3], [126, 15.2, 34]], "fin_r": [[-74, 8.5, 0], [-34, 17.5, 32]], "fin_r_tip": [[-126, 10.8, -3], [-70, 15.2, 34]], "seg1": [[-47.5, 0, 15], [47.5, 72, 57]], "seg2": [[-46.5, 0.5, 47], [46.5, 71.5, 89]], "seg3": [[-45, 1.5, 79], [45, 70.5, 121]], "seg4": [[-42.5, 3, 111], [42.5, 69, 153]], "seg5": [[-39.5, 5, 143], [39.5, 67, 185]], "seg6": [[-35.5, 7.5, 175], [35.5, 64.5, 217]], "seg7": [[-30.5, 11, 207], [30.5, 61, 249]], "seg8": [[-25, 15, 239], [25, 57, 281]], "seg9": [[-19, 19, 271], [19, 53, 313]], "seg10": [[-13.5, 22.5, 303], [13.5, 49.5, 345]], "tailfin": [[-5, -33, 338], [5, 105, 412]] } }, "2": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 44, 0], "rot": [0, 0, 0], "zone": 5 }, "chest": { "parent": "body", "pivot": [0, 78, 0], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 122, 0], "rot": [0, 0, 0], "zone": 5 }, "neck": { "parent": "chest", "pivot": [0, 84, -32], "rot": [3, 0, 0], "zone": 6 }, "plates_neck": { "parent": "neck", "pivot": [0, 116, -46], "rot": [0, 0, 0], "zone": 6 }, "gill_l1": { "parent": "neck", "pivot": [37, 84, -56], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck", "pivot": [37, 84, -47], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck", "pivot": [37, 84, -38], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck", "pivot": [-37, 84, -56], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck", "pivot": [-37, 84, -47], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck", "pivot": [-37, 84, -38], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck", "pivot": [0, 84, -62], "rot": [4, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [28.08, 91.46, -97.7], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-28.08, 91.46, -97.7], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 71, -75], "rot": [9, 0, 0], "zone": 8 }, "arm_l": { "parent": "chest", "pivot": [54, 102, -14], "rot": [14, 0, 10], "zone": 5 }, "forearm_l": { "parent": "arm_l", "pivot": [54, 54, -14], "rot": [-38, 0, -10], "zone": 5 }, "claw_l": { "parent": "forearm_l", "pivot": [54, 4, -14], "rot": [24, 0, 0], "zone": 5 }, "arm_r": { "parent": "chest", "pivot": [-54, 102, -14], "rot": [14, 0, -10], "zone": 5 }, "forearm_r": { "parent": "arm_r", "pivot": [-54, 54, -14], "rot": [-38, 0, 10], "zone": 5 }, "claw_r": { "parent": "forearm_r", "pivot": [-54, 4, -14], "rot": [24, 0, 0], "zone": 5 }, "mid": { "parent": "body", "pivot": [0, 66, 30], "rot": [0, 0, 0], "zone": 4 }, "plates_mid": { "parent": "mid", "pivot": [0, 100, 66], "rot": [0, 0, 0], "zone": 4 }, "hips": { "parent": "mid", "pivot": [0, 36, 104], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 72, 126], "rot": [0, 0, 0], "zone": 3 }, "leg_l": { "parent": "hips", "pivot": [40, 24, 126], "rot": [0, -40, 24], "zone": 3 }, "foot_l": { "parent": "leg_l", "pivot": [70, 20, 126], "rot": [0, 0, -24], "zone": 3 }, "leg_r": { "parent": "hips", "pivot": [-40, 24, 126], "rot": [0, 40, -24], "zone": 3 }, "foot_r": { "parent": "leg_r", "pivot": [-70, 20, 126], "rot": [0, 0, 24], "zone": 3 }, "tail1": { "parent": "hips", "pivot": [0, 32, 150], "rot": [0, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 62, 164], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 30, 178], "rot": [0, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 58, 192], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 28, 206], "rot": [0, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 54, 220], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 26, 234], "rot": [0, 0, 0], "zone": 1 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 50, 248], "rot": [0, 0, 0], "zone": 1 }, "tail5": { "parent": "tail4", "pivot": [0, 24, 262], "rot": [0, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 46, 276], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 23, 290], "rot": [0, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 44, 304], "rot": [0, 0, 0], "zone": 1 }, "knob": { "parent": "tail6", "pivot": [0, 23, 318], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "heart": { "bone": "chest", "pos": [0, 78, 0] }, "gill_l": { "bone": "neck", "pos": [38, 84, -47] }, "gill_r": { "bone": "neck", "pos": [-38, 84, -47] }, "muzzle": { "bone": "head", "pos": [0, 77.5, -176.4] }, "nose": { "bone": "head", "pos": [0, 90.5, -173.8] }, "throat": { "bone": "head", "pos": [0, 77.5, -69.8] }, "eye_l": { "bone": "eye_l", "pos": [28.58, 91.46, -97.7] }, "eye_r": { "bone": "eye_r", "pos": [-28.58, 91.46, -97.7] }, "mouth": { "bone": "jaw", "pos": [0, 76.2, -153] }, "claw_l": { "bone": "claw_l", "pos": [54, -6, -44] }, "claw_r": { "bone": "claw_r", "pos": [-54, -6, -44] }, "hip_l": { "bone": "hips", "pos": [30, 0, 140] }, "hip_r": { "bone": "hips", "pos": [-30, 0, 140] }, "foot_l": { "bone": "foot_l", "pos": [86, 11, 126] }, "foot_r": { "bone": "foot_r", "pos": [-86, 11, 126] }, "tail_notch": { "bone": "tail6", "pos": [29.5, 23, 305] }, "knob_core": { "bone": "knob", "pos": [0, 32, 358] }, "horn_l": { "bone": "knob", "pos": [19.3621, 76.8737, 367.5747] }, "horn_r": { "bone": "knob", "pos": [-19.3621, 76.8737, 367.5747] } }, "meta": { "glow_y0": 10, "glow_y1": 104, "wetness": 0.5, "bounds_margin": 6, "form": 2 }, "zones": { "5": ["body", "chest", "plates_chest", "arm_l", "forearm_l", "claw_l", "arm_r", "forearm_r", "claw_r"], "6": ["neck", "plates_neck"], "7": ["gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "jaw"], "4": ["mid", "plates_mid"], "3": ["hips", "plates_hips", "leg_l", "foot_l", "leg_r", "foot_r"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3"], "1": ["tail4", "plates_tail4", "tail5", "plates_tail5", "tail6", "plates_tail6"], "0": ["knob"] }, "boxes": { "chest": [[-54, 35, -37], [54, 125, 33]], "neck": [[-37, 51, -63], [37, 117, -23]], "head": [[-33.8, 67.1, -172.5], [33.8, 110, -54.2]], "jaw": [[-23.4, 55.4, -167.3], [23.4, 71, -64.6]], "arm_l": [[30, 49, -41], [78, 113, 13]], "forearm_l": [[30.5, 0, -38], [77.5, 65, 14]], "claw_l": [[27.4, -6, -58.7], [80.6, 11, 10]], "arm_r": [[-78, 49, -41], [-30, 113, 13]], "forearm_r": [[-77.5, 0, -38], [-30.5, 65, 14]], "claw_r": [[-80.6, -6, -58.7], [-27.4, 11, 10]], "mid": [[-48, 22.9, 29], [48, 108, 105]], "hips": [[-44, 12.2, 101], [44, 73, 151]], "leg_l": [[36, 13, 116], [70, 35, 136]], "foot_l": [[68.8, 11, 111.1], [100, 16, 140.9]], "leg_r": [[-70, 13, 116], [-36, 35, 136]], "foot_r": [[-100, 11, 111.1], [-68.8, 16, 140.9]], "tail1": [[-40, 10.4, 141], [40, 62, 179]], "tail2": [[-37, 9.8, 169], [37, 58, 207]], "tail3": [[-34, 9.3, 197], [34, 54, 235]], "tail4": [[-31, 8.7, 225], [31, 50, 263]], "tail5": [[-28.5, 8.2, 253], [28.5, 46, 291]], "tail6": [[-26.5, 7.9, 281], [29.3, 44, 319]], "knob": [[-38.2, 0.8, 317], [38.2, 77.4, 406]] } }, "3": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 112, 0], "rot": [0, 0, 0], "zone": 4 }, "plates_mid": { "parent": "body", "pivot": [0, 151, -12], "rot": [0, 0, 0], "zone": 4 }, "chest": { "parent": "body", "pivot": [0, 108, -60], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 148, -92], "rot": [0, 0, 0], "zone": 5 }, "hips": { "parent": "body", "pivot": [0, 110, 36], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 151, 70], "rot": [0, 0, 0], "zone": 3 }, "neck1": { "parent": "chest", "pivot": [0, 114, -126], "rot": [4, 0, 0], "zone": 6 }, "plates_neck1": { "parent": "neck1", "pivot": [0, 150, -134.5], "rot": [0, 0, 0], "zone": 6 }, "neck2": { "parent": "neck1", "pivot": [0, 114, -143], "rot": [3, 0, 0], "zone": 6 }, "plates_neck2": { "parent": "neck2", "pivot": [0, 146.5, -151.5], "rot": [0, 0, 0], "zone": 6 }, "neck3": { "parent": "neck2", "pivot": [0, 114, -160], "rot": [2, 0, 0], "zone": 7 }, "plates_neck3": { "parent": "neck3", "pivot": [0, 143, -168.5], "rot": [0, 0, 0], "zone": 7 }, "neck4": { "parent": "neck3", "pivot": [0, 114, -177], "rot": [0, 0, 0], "zone": 7 }, "plates_neck4": { "parent": "neck4", "pivot": [0, 140, -185.5], "rot": [0, 0, 0], "zone": 7 }, "neck5": { "parent": "neck4", "pivot": [0, 114, -194], "rot": [-2, 0, 0], "zone": 7 }, "plates_neck5": { "parent": "neck5", "pivot": [0, 137.5, -202.5], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck5", "pivot": [0, 114, -211], "rot": [-3, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [26.368, 120.608, -247.4], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-26.368, 120.608, -247.4], "rot": [0, 0, 0], "zone": 8 }, "plates_head": { "parent": "head", "pivot": [0, 133.2, -223.8], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 101.2, -223.8], "rot": [7, 0, 0], "zone": 8 }, "gill_l1": { "parent": "neck5", "pivot": [19.92, 113, -208.5], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck5", "pivot": [19.92, 113, -203.1], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck5", "pivot": [19.92, 113, -197.7], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck5", "pivot": [-19.92, 113, -208.5], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck5", "pivot": [-19.92, 113, -203.1], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck5", "pivot": [-19.92, 113, -197.7], "rot": [0, 0, 0], "zone": 7 }, "leg_fl": { "parent": "chest", "pivot": [40, 104, -100], "rot": [20, 0, 0], "zone": 5 }, "leg_fl_lower": { "parent": "leg_fl", "pivot": [40, 54, -100], "rot": [-35, 0, 0], "zone": 5 }, "foot_fl": { "parent": "leg_fl_lower", "pivot": [40, 7, -100], "rot": [15, 0, 0], "zone": 5 }, "leg_fr": { "parent": "chest", "pivot": [-40, 104, -100], "rot": [20, 0, 0], "zone": 5 }, "leg_fr_lower": { "parent": "leg_fr", "pivot": [-40, 54, -100], "rot": [-35, 0, 0], "zone": 5 }, "foot_fr": { "parent": "leg_fr_lower", "pivot": [-40, 7, -100], "rot": [15, 0, 0], "zone": 5 }, "leg_bl": { "parent": "hips", "pivot": [40, 104, 84], "rot": [-22, 0, 0], "zone": 3 }, "leg_bl_lower": { "parent": "leg_bl", "pivot": [40, 52, 84], "rot": [40, 0, 0], "zone": 3 }, "foot_bl": { "parent": "leg_bl_lower", "pivot": [40, 6, 84], "rot": [-18, 0, 0], "zone": 3 }, "leg_br": { "parent": "hips", "pivot": [-40, 104, 84], "rot": [-22, 0, 0], "zone": 3 }, "leg_br_lower": { "parent": "leg_br", "pivot": [-40, 52, 84], "rot": [40, 0, 0], "zone": 3 }, "foot_br": { "parent": "leg_br_lower", "pivot": [-40, 6, 84], "rot": [-18, 0, 0], "zone": 3 }, "tail1": { "parent": "hips", "pivot": [0, 112, 112], "rot": [-8, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 144, 127.5], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 112, 143], "rot": [-6, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 140, 158.5], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 112, 174], "rot": [-4, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 136, 189], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 112, 204], "rot": [-2, 0, 0], "zone": 1 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 132, 219], "rot": [0, 0, 0], "zone": 1 }, "tail5": { "parent": "tail4", "pivot": [0, 112, 234], "rot": [2, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 129, 249], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 112, 264], "rot": [5, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 126.5, 278.5], "rot": [0, 0, 0], "zone": 1 }, "tail7": { "parent": "tail6", "pivot": [0, 112, 293], "rot": [7, 0, 0], "zone": 1 }, "plates_tail7": { "parent": "tail7", "pivot": [0, 124.5, 307.5], "rot": [0, 0, 0], "zone": 1 }, "tail8": { "parent": "tail7", "pivot": [0, 112, 322], "rot": [6, 0, 0], "zone": 1 }, "plates_tail8": { "parent": "tail8", "pivot": [0, 123, 336], "rot": [0, 0, 0], "zone": 1 }, "club": { "parent": "tail8", "pivot": [0, 112, 350], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "heart": { "bone": "body", "pos": [0, 112, -20] }, "plate_tip_3": { "bone": "plates_mid", "pos": [0, 218.3, -21.8] }, "plate_tip_4": { "bone": "plates_mid", "pos": [0, 228.8, 7.2] }, "plate_tip_5": { "bone": "plates_mid", "pos": [0, 235.5, 35] }, "plate_tip_6": { "bone": "plates_mid", "pos": [0, 235.5, 61] }, "plate_tip_0": { "bone": "plates_chest", "pos": [0, 177.2, -105.2] }, "plate_tip_1": { "bone": "plates_chest", "pos": [0, 193.5, -79] }, "plate_tip_2": { "bone": "plates_chest", "pos": [0, 205.9, -51.4] }, "plate_tip_7": { "bone": "plates_hips", "pos": [0, 229.8, 85.2] }, "plate_tip_8": { "bone": "plates_hips", "pos": [0, 218.3, 106.2] }, "plate_tip_9": { "bone": "plates_hips", "pos": [0, 204.9, 124.6] }, "gill_l": { "bone": "neck5", "pos": [21, 113, -201.5] }, "gill_r": { "bone": "neck5", "pos": [-21, 113, -201.5] }, "muzzle": { "bone": "head", "pos": [0, 107.6, -303.16] }, "throat": { "bone": "head", "pos": [0, 107.6, -218.68] }, "nose": { "bone": "head", "pos": [0, 121.68, -300.6] }, "eye_l": { "bone": "eye_l", "pos": [26.868, 120.608, -247.4] }, "eye_r": { "bone": "eye_r", "pos": [-26.868, 120.608, -247.4] }, "mouth": { "bone": "jaw", "pos": [0, 106.32, -282.68] }, "foot_fl": { "bone": "foot_fl", "pos": [40, -5, -108] }, "foot_fr": { "bone": "foot_fr", "pos": [-40, -5, -108] }, "foot_bl": { "bone": "foot_bl", "pos": [40, -6, 76] }, "foot_br": { "bone": "foot_br", "pos": [-40, -6, 76] }, "tail_notch": { "bone": "tail7", "pos": [11.5, 112, 306] }, "club_core": { "bone": "club", "pos": [0, 112, 374] }, "spike_tip_0": { "bone": "club", "pos": [41.2571, 135.8198, 369.7336] }, "spike_tip_1": { "bone": "club", "pos": [0, 165.2182, 369.1757] }, "spike_tip_2": { "bone": "club", "pos": [-40.6907, 135.4928, 369.799] }, "spike_tip_3": { "bone": "club", "pos": [-43.335, 86.9805, 369.4936] }, "spike_tip_4": { "bone": "club", "pos": [0, 58.6562, 369.1631] }, "spike_tip_5": { "bone": "club", "pos": [46.0464, 85.4151, 369.1805] }, "spike_tip_6": { "bone": "club", "pos": [22.5857, 143.0865, 405.9264] }, "spike_tip_7": { "bone": "club", "pos": [-22.3364, 142.7435, 405.5367] }, "spike_tip_8": { "bone": "club", "pos": [-32.3061, 101.5031, 401.8313] }, "spike_tip_9": { "bone": "club", "pos": [0, 73.6781, 405.8316] }, "spike_tip_10": { "bone": "club", "pos": [32.359, 101.4859, 401.8824] }, "spike_tip_11": { "bone": "club", "pos": [0, 114.8643, 426.2925] } }, "meta": { "glow_y0": 64, "glow_y1": 156, "wetness": 0.15, "bounds_margin": 6, "form": 3 }, "zones": { "4": ["body", "plates_mid"], "5": ["chest", "plates_chest", "leg_fl", "leg_fl_lower", "foot_fl", "leg_fr", "leg_fr_lower", "foot_fr"], "3": ["hips", "plates_hips", "leg_bl", "leg_bl_lower", "foot_bl", "leg_br", "leg_br_lower", "foot_br"], "6": ["neck1", "plates_neck1", "neck2", "plates_neck2"], "7": ["neck3", "plates_neck3", "neck4", "plates_neck4", "neck5", "plates_neck5", "gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "plates_head", "jaw"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3"], "1": ["tail4", "plates_tail4", "tail5", "plates_tail5", "tail6", "plates_tail6", "tail7", "plates_tail7", "tail8", "plates_tail8"], "0": ["club"] }, "boxes": { "body": [[-46, 66, -61], [46, 152.5, 37]], "chest": [[-52, 63, -131], [52, 149, -59]], "hips": [[-52, 68, 35], [52, 152, 115]], "neck1": [[-38, 78, -144], [38, 150, -116]], "neck2": [[-34, 81.5, -161], [34, 146.5, -133]], "neck3": [[-30.5, 85, -178], [30.5, 143, -150]], "neck4": [[-27, 88, -195], [27, 140, -167]], "neck5": [[-24.5, 90.5, -212], [24.5, 137.5, -184]], "head": [[-32, 96.1, -299.3], [32, 139, -203.3]], "jaw": [[-21.8, 85.8, -294.2], [21.8, 101.2, -213.6]], "gill_l1": [[19.4, 102.8, -210.9], [20.4, 123.2, -201.9]], "gill_l2": [[19.4, 102.8, -205.5], [20.4, 123.2, -196.5]], "gill_l3": [[19.4, 102.8, -200.1], [20.4, 123.2, -191.1]], "gill_r1": [[-20.4, 102.8, -210.9], [-19.4, 123.2, -201.9]], "gill_r2": [[-20.4, 102.8, -205.5], [-19.4, 123.2, -196.5]], "gill_r3": [[-20.4, 102.8, -200.1], [-19.4, 123.2, -191.1]], "leg_fl": [[15, 49, -133.7], [65, 113, -67]], "leg_fl_lower": [[18, 3, -124], [62, 64, -70]], "foot_fl": [[16.4, -5, -140.7], [63.6, 14, -76]], "leg_fr": [[-65, 49, -133.7], [-15, 113, -67]], "leg_fr_lower": [[-62, 3, -124], [-18, 64, -70]], "foot_fr": [[-63.6, -5, -140.7], [-16.4, 14, -76]], "leg_bl": [[13, 47, 47], [67, 113, 122.5]], "leg_bl_lower": [[18, 2, 56], [62, 62, 112]], "foot_bl": [[16.4, -6, 43.3], [63.6, 13, 108]], "leg_br": [[-67, 47, 47], [-13, 113, 122.5]], "leg_br_lower": [[-62, 2, 56], [-18, 62, 112]], "foot_br": [[-63.6, -6, 43.3], [-16.4, 13, 108]], "tail1": [[-34, 80, 103], [34, 144, 144]], "tail2": [[-29.5, 84, 134], [29.5, 140, 175]], "tail3": [[-25, 88, 165], [25, 136, 205]], "tail4": [[-21, 92, 195], [21, 132, 235]], "tail5": [[-17.5, 95, 225], [17.5, 129, 265]], "tail6": [[-14.5, 97.5, 255], [14.5, 126.5, 294]], "tail7": [[-12, 99.5, 284], [12.2, 124.5, 323]], "tail8": [[-10, 101, 313], [10, 123, 351]], "club": [[-26, 86, 348], [26, 138, 394]] } }, "4": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 170, 6], "rot": [0, 0, 0], "zone": 4 }, "plates_mid": { "parent": "body", "pivot": [0, 226, 58], "rot": [0, 0, 0], "zone": 4 }, "hips": { "parent": "body", "pivot": [0, 166, 10], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 176, 68], "rot": [0, 0, 0], "zone": 3 }, "chest": { "parent": "body", "pivot": [0, 250, -6], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 300, 50], "rot": [0, 0, 0], "zone": 5 }, "ribs_l": { "parent": "chest", "pivot": [82, 280, -10], "rot": [0, 0, 0], "zone": 5 }, "neck1": { "parent": "chest", "pivot": [0, 336, -22], "rot": [0, 0, 0], "zone": 6 }, "neck2": { "parent": "neck1", "pivot": [0, 366, -28], "rot": [0, 0, 0], "zone": 7 }, "plates_neck1": { "parent": "neck1", "pivot": [0, 352, 12], "rot": [0, 0, 0], "zone": 6 }, "plates_neck2": { "parent": "neck2", "pivot": [0, 382, 2], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck2", "pivot": [0, 398, -28], "rot": [8, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [32.96, 405.94, -75.1], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-32.96, 405.94, -75.1], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 382, -40.8], "rot": [13, 0, 0], "zone": 8 }, "plates_head": { "parent": "head", "pivot": [0, 423.6, -37.6], "rot": [0, 0, 0], "zone": 8 }, "gill_l1": { "parent": "neck2", "pivot": [35.86, 378, -44.5], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck2", "pivot": [35.86, 378, -37.5], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck2", "pivot": [35.86, 378, -30.5], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck2", "pivot": [-35.86, 378, -44.5], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck2", "pivot": [-35.86, 378, -37.5], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck2", "pivot": [-35.86, 378, -30.5], "rot": [0, 0, 0], "zone": 7 }, "leg_l": { "parent": "hips", "pivot": [68, 170, 6], "rot": [-28, 0, 0], "zone": 3 }, "leg_l_lower": { "parent": "leg_l", "pivot": [68, 86, 6], "rot": [44, 0, 0], "zone": 3 }, "foot_l": { "parent": "leg_l_lower", "pivot": [68, 12, 6], "rot": [-16, 0, 0], "zone": 3 }, "leg_r": { "parent": "hips", "pivot": [-68, 170, 6], "rot": [-28, 0, 0], "zone": 3 }, "leg_r_lower": { "parent": "leg_r", "pivot": [-68, 86, 6], "rot": [44, 0, 0], "zone": 3 }, "foot_r": { "parent": "leg_r_lower", "pivot": [-68, 12, 6], "rot": [-16, 0, 0], "zone": 3 }, "arm_l": { "parent": "chest", "pivot": [102, 302, -16], "rot": [14, 0, -15], "zone": 5 }, "forearm_l": { "parent": "arm_l", "pivot": [102, 230, -16], "rot": [-52, 0, 0], "zone": 5 }, "hand_l": { "parent": "forearm_l", "pivot": [102, 164, -16], "rot": [34, 0, 0], "zone": 5 }, "arm_r": { "parent": "chest", "pivot": [-102, 302, -16], "rot": [14, 0, 15], "zone": 5 }, "forearm_r": { "parent": "arm_r", "pivot": [-102, 230, -16], "rot": [-52, 0, 0], "zone": 5 }, "hand_r": { "parent": "forearm_r", "pivot": [-102, 164, -16], "rot": [34, 0, 0], "zone": 5 }, "wing_l": { "parent": "chest", "pivot": [46, 322, 40], "rot": [0, -32, -62], "zone": 5 }, "wing_l_arm": { "parent": "wing_l", "pivot": [166, 322, 40], "rot": [0, 0, 27.3], "zone": 5 }, "wing_l_f1": { "parent": "wing_l_arm", "pivot": [336, 322, 40], "rot": [0, 0, -7.4], "zone": 5 }, "wing_l_f2": { "parent": "wing_l_arm", "pivot": [336, 322, 40], "rot": [0, 0, 9.4], "zone": 5 }, "wing_l_f3": { "parent": "wing_l_arm", "pivot": [336, 322, 40], "rot": [0, 0, 25.9], "zone": 5 }, "wing_l_f4": { "parent": "wing_l_arm", "pivot": [336, 322, 40], "rot": [0, 0, 41.3], "zone": 5 }, "wing_r": { "parent": "chest", "pivot": [-46, 322, 40], "rot": [0, 32, 62], "zone": 5 }, "wing_r_arm": { "parent": "wing_r", "pivot": [-166, 322, 40], "rot": [0, 0, -27.3], "zone": 5 }, "wing_r_f1": { "parent": "wing_r_arm", "pivot": [-336, 322, 40], "rot": [0, 0, 7.4], "zone": 5 }, "wing_r_f2": { "parent": "wing_r_arm", "pivot": [-336, 322, 40], "rot": [0, 0, -9.4], "zone": 5 }, "wing_r_f3": { "parent": "wing_r_arm", "pivot": [-336, 322, 40], "rot": [0, 0, -25.9], "zone": 5 }, "wing_r_f4": { "parent": "wing_r_arm", "pivot": [-336, 322, 40], "rot": [0, 0, -41.3], "zone": 5 }, "tail1": { "parent": "hips", "pivot": [0, 152, 62], "rot": [-32, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 207, 87], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 152, 112], "rot": [-12, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 200, 137], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 152, 162], "rot": [5, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 193, 186], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 152, 210], "rot": [16, 0, 0], "zone": 2 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 186, 234], "rot": [0, 0, 0], "zone": 2 }, "tail5": { "parent": "tail4", "pivot": [0, 152, 258], "rot": [13, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 180, 281], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 152, 304], "rot": [9, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 176, 327], "rot": [0, 0, 0], "zone": 1 }, "tail7": { "parent": "tail6", "pivot": [0, 152, 350], "rot": [7, 0, 0], "zone": 1 }, "plates_tail7": { "parent": "tail7", "pivot": [0, 173, 372], "rot": [0, 0, 0], "zone": 1 }, "tail8": { "parent": "tail7", "pivot": [0, 152, 394], "rot": [6, 0, 0], "zone": 1 }, "plates_tail8": { "parent": "tail8", "pivot": [0, 170, 416], "rot": [0, 0, 0], "zone": 1 }, "tail9": { "parent": "tail8", "pivot": [0, 152, 438], "rot": [5, 0, 0], "zone": 1 }, "plates_tail9": { "parent": "tail9", "pivot": [0, 167.5, 459], "rot": [0, 0, 0], "zone": 1 }, "tail10": { "parent": "tail9", "pivot": [0, 152, 480], "rot": [4, 0, 0], "zone": 1 }, "plates_tail10": { "parent": "tail10", "pivot": [0, 165.5, 500], "rot": [0, 0, 0], "zone": 1 }, "club": { "parent": "tail10", "pivot": [0, 152, 520], "rot": [0, 0, 0], "zone": 0 }, "plate_break": { "parent": "plates_mid", "pivot": [0, 240, 64], "rot": [0, 0, 0], "zone": 4 } }, "locators": { "heart": { "bone": "body", "pos": [0, 280, -30] }, "plate_tip_3": { "bone": "plates_mid", "pos": [0, 280.5, 134.1481] }, "plate_tip_4": { "bone": "plates_mid", "pos": [0, 254.5, 136.1481] }, "plate_tip_5": { "bone": "plates_hips", "pos": [0, 224.9, 137.9127] }, "plate_tip_6": { "bone": "plates_hips", "pos": [0, 195.5, 130.5596] }, "plate_tip_0": { "bone": "plates_chest", "pos": [0, 345.9, 86.3242] }, "plate_tip_1": { "bone": "plates_chest", "pos": [0, 325.3, 111.6773] }, "plate_tip_2": { "bone": "plates_chest", "pos": [0, 303.8, 121.4715] }, "ribs": { "bone": "ribs_l", "pos": [92, 280, -12] }, "gill_l": { "bone": "neck2", "pos": [40, 378, -36] }, "gill_r": { "bone": "neck2", "pos": [-40, 378, -36] }, "muzzle": { "bone": "head", "pos": [0, 390, -143.2] }, "throat": { "bone": "head", "pos": [0, 390, -37.6] }, "nose": { "bone": "head", "pos": [0, 407.6, -140] }, "eye_l": { "bone": "eye_l", "pos": [33.46, 405.94, -75.1] }, "eye_r": { "bone": "eye_r", "pos": [-33.46, 405.94, -75.1] }, "mouth": { "bone": "jaw", "pos": [0, 388.4, -117.6] }, "foot_l": { "bone": "foot_l", "pos": [68, -12, -8] }, "heel_l": { "bone": "foot_l", "pos": [68, -12, 46] }, "foot_r": { "bone": "foot_r", "pos": [-68, -12, -8] }, "heel_r": { "bone": "foot_r", "pos": [-68, -12, 46] }, "hand_l": { "bone": "hand_l", "pos": [92, 126, -16] }, "hand_r": { "bone": "hand_r", "pos": [-92, 126, -16] }, "wing_tip_l": { "bone": "wing_l_arm", "pos": [336, 362, 40] }, "wing_vein_l0": { "bone": "wing_l_f1", "pos": [336, 50.32, 40] }, "wing_vein_l1": { "bone": "wing_l_f2", "pos": [336, 30.16, 40] }, "wing_vein_l2": { "bone": "wing_l_f3", "pos": [336, 20.56, 40] }, "wing_vein_l3": { "bone": "wing_l_f4", "pos": [336, 12.88, 40] }, "wing_tip_r": { "bone": "wing_r_arm", "pos": [-336, 362, 40] }, "wing_vein_r0": { "bone": "wing_r_f1", "pos": [-336, 50.32, 40] }, "wing_vein_r1": { "bone": "wing_r_f2", "pos": [-336, 30.16, 40] }, "wing_vein_r2": { "bone": "wing_r_f3", "pos": [-336, 20.56, 40] }, "wing_vein_r3": { "bone": "wing_r_f4", "pos": [-336, 12.88, 40] }, "tail_notch": { "bone": "tail9", "pos": [15.5, 152, 454] }, "club_core": { "bone": "club", "pos": [0, 152, 551.68] }, "spike_tip_0": { "bone": "club", "pos": [54.875, 183.6821, 546.0003] }, "spike_tip_1": { "bone": "club", "pos": [0, 217.8263, 545.7541] }, "spike_tip_2": { "bone": "club", "pos": [-59.9753, 186.6268, 545.4114] }, "spike_tip_3": { "bone": "club", "pos": [-59.2924, 117.7675, 545.4902] }, "spike_tip_4": { "bone": "club", "pos": [0, 81.1796, 545.2547] }, "spike_tip_5": { "bone": "club", "pos": [58.4937, 118.2286, 545.5825] }, "spike_tip_6": { "bone": "club", "pos": [30.7834, 194.3697, 595.3397] }, "spike_tip_7": { "bone": "club", "pos": [-29.1209, 192.0815, 592.7407] }, "spike_tip_8": { "bone": "club", "pos": [-47.8792, 136.4431, 593.4756] }, "spike_tip_9": { "bone": "club", "pos": [0, 102.2913, 592.8926] }, "spike_tip_10": { "bone": "club", "pos": [49.0644, 136.058, 594.6207] }, "spike_tip_11": { "bone": "club", "pos": [0, 155.8957, 623.002] }, "plate_break": { "bone": "plate_break", "pos": [0, 240, 72] } }, "meta": { "glow_y0": 40, "glow_y1": 430, "wetness": 0.12, "bounds_margin": 8, "form": 4 }, "zones": { "4": ["body", "plates_mid", "plate_break"], "3": ["hips", "plates_hips", "leg_l", "leg_l_lower", "foot_l", "leg_r", "leg_r_lower", "foot_r"], "5": ["chest", "plates_chest", "ribs_l", "arm_l", "forearm_l", "hand_l", "arm_r", "forearm_r", "hand_r", "wing_l", "wing_l_arm", "wing_l_f1", "wing_l_f2", "wing_l_f3", "wing_l_f4", "wing_r", "wing_r_arm", "wing_r_f1", "wing_r_f2", "wing_r_f3", "wing_r_f4"], "6": ["neck1", "plates_neck1"], "7": ["neck2", "plates_neck2", "gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "jaw", "plates_head"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3", "tail4", "plates_tail4"], "1": ["tail5", "plates_tail5", "tail6", "plates_tail6", "tail7", "plates_tail7", "tail8", "plates_tail8", "tail9", "plates_tail9", "tail10", "plates_tail10"], "0": ["club"] }, "boxes": { "body": [[-78, 195, -71], [78, 263, 66]], "hips": [[-92, 127, -56], [92, 205, 76]], "chest": [[-102, 249, -82], [102, 345, 58]], "ribs_l": [[82.5, 251.4, -50], [89.5, 309.5, 26.7]], "neck1": [[-45, 327, -69], [45, 371, 17]], "neck2": [[-41, 361, -71], [41, 403, 7]], "head": [[-40, 375.6, -138.4], [40, 434.8, -15.2]], "jaw": [[-28, 361.2, -132], [28, 382, -28]], "gill_l1": [[35.4, 366.8, -47.1], [36.4, 389.2, -37.7]], "gill_l2": [[35.4, 366.8, -40.1], [36.4, 389.2, -30.7]], "gill_l3": [[35.4, 366.8, -33.1], [36.4, 389.2, -23.7]], "gill_r1": [[-36.4, 366.8, -47.1], [-35.4, 389.2, -37.7]], "gill_r2": [[-36.4, 366.8, -40.1], [-35.4, 389.2, -30.7]], "gill_r3": [[-36.4, 366.8, -33.1], [-35.4, 389.2, -23.7]], "leg_l": [[25, 79, -54], [111, 187, 60]], "leg_l_lower": [[32, 7, -43], [104, 100, 47]], "foot_l": [[22.5, -12, -83.2], [113.5, 22, 46]], "leg_r": [[-111, 79, -54], [-25, 187, 60]], "leg_r_lower": [[-104, 7, -43], [-32, 100, 47]], "foot_r": [[-113.5, -12, -83.2], [-22.5, 22, 46]], "arm_l": [[71, 225, -52], [133, 325, 20]], "forearm_l": [[77, 161, -43], [127, 244, 19]], "hand_l": [[81, 115.5, -47.4], [117, 170, 11.5]], "arm_r": [[-133, 225, -52], [-71, 325, 20]], "forearm_r": [[-127, 161, -43], [-77, 244, 19]], "hand_r": [[-117, 115.5, -47.4], [-81, 170, 11.5]], "wing_l": [[37, 295, 13], [171, 349, 67]], "wing_l_arm": [[155, 305, 23], [348, 339, 57]], "wing_l_f1": [[330.5, 39, 34.5], [341.5, 323.5, 45.5]], "wing_l_f2": [[330.9, 18, 34.9], [341.1, 323.5, 45.1]], "wing_l_f3": [[331.3, 8, 35.3], [340.7, 323.5, 44.7]], "wing_l_f4": [[331.7, 0, 35.7], [340.3, 323.5, 44.3]], "wing_r": [[-171, 295, 13], [-37, 349, 67]], "wing_r_arm": [[-348, 305, 23], [-155, 339, 57]], "wing_r_f1": [[-341.5, 39, 34.5], [-330.5, 323.5, 45.5]], "wing_r_f2": [[-341.1, 18, 34.9], [-330.9, 323.5, 45.1]], "wing_r_f3": [[-340.7, 8, 35.3], [-331.3, 323.5, 44.7]], "wing_r_f4": [[-340.3, 0, 35.7], [-331.7, 323.5, 44.3]], "tail1": [[-60, 97, 51], [60, 207, 113]], "tail2": [[-52, 104, 101], [52, 200, 163]], "tail3": [[-44, 111, 151], [44, 193, 211]], "tail4": [[-37, 118, 199], [37, 186, 259]], "tail5": [[-31, 124, 247], [31, 180, 305]], "tail6": [[-26, 128, 293], [26, 176, 351]], "tail7": [[-22, 131, 339], [22, 173, 395]], "tail8": [[-18.5, 134, 383], [18.5, 170, 439]], "tail9": [[-15.5, 136.5, 427], [15.9, 167.5, 481]], "tail10": [[-13, 138.5, 469], [13, 165.5, 521]], "club": [[-34.3, 117.7, 517.4], [34.3, 186.3, 578.1]] } }, "5": { "bones": { "root": { "parent": null, "pivot": [0, 0, 0], "rot": [0, 0, 0], "zone": null }, "body": { "parent": "root", "pivot": [0, 124, 0], "rot": [0, 0, 0], "zone": 4 }, "chest": { "parent": "body", "pivot": [0, 157.4, -60], "rot": [0, 0, 0], "zone": 5 }, "plates_chest": { "parent": "chest", "pivot": [0, 214, -100], "rot": [0, 0, 0], "zone": 5 }, "plates_mid": { "parent": "body", "pivot": [0, 186, -10], "rot": [0, 0, 0], "zone": 4 }, "hips": { "parent": "body", "pivot": [0, 128.4, 40], "rot": [0, 0, 0], "zone": 3 }, "plates_hips": { "parent": "hips", "pivot": [0, 156, 66], "rot": [0, 0, 0], "zone": 3 }, "neck1": { "parent": "chest", "pivot": [0, 172, -138], "rot": [3, 0, 0], "zone": 6 }, "plates_neck1": { "parent": "neck1", "pivot": [0, 210, -143.5], "rot": [0, 0, 0], "zone": 6 }, "neck2": { "parent": "neck1", "pivot": [0, 172, -149], "rot": [2, 0, 0], "zone": 6 }, "plates_neck2": { "parent": "neck2", "pivot": [0, 207, -154.5], "rot": [0, 0, 0], "zone": 6 }, "neck3": { "parent": "neck2", "pivot": [0, 172, -160], "rot": [1, 0, 0], "zone": 7 }, "plates_neck3": { "parent": "neck3", "pivot": [0, 204, -165.5], "rot": [0, 0, 0], "zone": 7 }, "neck4": { "parent": "neck3", "pivot": [0, 172, -171], "rot": [0, 0, 0], "zone": 7 }, "plates_neck4": { "parent": "neck4", "pivot": [0, 201, -176.5], "rot": [0, 0, 0], "zone": 7 }, "neck5": { "parent": "neck4", "pivot": [0, 172, -182], "rot": [0, 0, 0], "zone": 7 }, "plates_neck5": { "parent": "neck5", "pivot": [0, 199, -187], "rot": [0, 0, 0], "zone": 7 }, "head": { "parent": "neck5", "pivot": [0, 172, -192], "rot": [2, 0, 0], "zone": 8 }, "eye_l": { "parent": "head", "pivot": [25.75, 177.25, -237.5], "rot": [0, 0, 0], "zone": 8 }, "eye_r": { "parent": "head", "pivot": [-25.75, 177.25, -237.5], "rot": [0, 0, 0], "zone": 8 }, "plates_head": { "parent": "head", "pivot": [0, 192, -209.5], "rot": [0, 0, 0], "zone": 8 }, "jaw": { "parent": "head", "pivot": [0, 159.5, -209.5], "rot": [6, 0, 0], "zone": 8 }, "gill_l1": { "parent": "neck5", "pivot": [25.8, 170, -189.5], "rot": [0, 0, 0], "zone": 7 }, "gill_l2": { "parent": "neck5", "pivot": [25.8, 170, -183.9], "rot": [0, 0, 0], "zone": 7 }, "gill_l3": { "parent": "neck5", "pivot": [25.8, 170, -178.3], "rot": [0, 0, 0], "zone": 7 }, "gill_r1": { "parent": "neck5", "pivot": [-25.8, 170, -189.5], "rot": [0, 0, 0], "zone": 7 }, "gill_r2": { "parent": "neck5", "pivot": [-25.8, 170, -183.9], "rot": [0, 0, 0], "zone": 7 }, "gill_r3": { "parent": "neck5", "pivot": [-25.8, 170, -178.3], "rot": [0, 0, 0], "zone": 7 }, "leg_fl": { "parent": "chest", "pivot": [46, 172, -98], "rot": [8, 0, 0], "zone": 5 }, "leg_fl_lower": { "parent": "leg_fl", "pivot": [46, 88, -98], "rot": [-22, 0, 0], "zone": 5 }, "foot_fl": { "parent": "leg_fl_lower", "pivot": [46, 10, -98], "rot": [14, 0, 0], "zone": 5 }, "leg_fr": { "parent": "chest", "pivot": [-46, 172, -98], "rot": [8, 0, 0], "zone": 5 }, "leg_fr_lower": { "parent": "leg_fr", "pivot": [-46, 88, -98], "rot": [-22, 0, 0], "zone": 5 }, "foot_fr": { "parent": "leg_fr_lower", "pivot": [-46, 10, -98], "rot": [14, 0, 0], "zone": 5 }, "leg_bl": { "parent": "hips", "pivot": [40, 102, 72], "rot": [-24, 0, 0], "zone": 3 }, "leg_bl_lower": { "parent": "leg_bl", "pivot": [40, 52, 72], "rot": [42, 0, 0], "zone": 3 }, "foot_bl": { "parent": "leg_bl_lower", "pivot": [40, 6, 72], "rot": [-18, 0, 0], "zone": 3 }, "leg_br": { "parent": "hips", "pivot": [-40, 102, 72], "rot": [-24, 0, 0], "zone": 3 }, "leg_br_lower": { "parent": "leg_br", "pivot": [-40, 52, 72], "rot": [42, 0, 0], "zone": 3 }, "foot_br": { "parent": "leg_br_lower", "pivot": [-40, 6, 72], "rot": [-18, 0, 0], "zone": 3 }, "tail1": { "parent": "hips", "pivot": [0, 109, 106], "rot": [-6, 0, 0], "zone": 2 }, "plates_tail1": { "parent": "tail1", "pivot": [0, 137, 121], "rot": [0, 0, 0], "zone": 2 }, "tail2": { "parent": "tail1", "pivot": [0, 109, 136], "rot": [-4, 0, 0], "zone": 2 }, "plates_tail2": { "parent": "tail2", "pivot": [0, 134, 151], "rot": [0, 0, 0], "zone": 2 }, "tail3": { "parent": "tail2", "pivot": [0, 109, 166], "rot": [-3, 0, 0], "zone": 2 }, "plates_tail3": { "parent": "tail3", "pivot": [0, 131, 180.5], "rot": [0, 0, 0], "zone": 2 }, "tail4": { "parent": "tail3", "pivot": [0, 109, 195], "rot": [-1, 0, 0], "zone": 1 }, "plates_tail4": { "parent": "tail4", "pivot": [0, 128, 209.5], "rot": [0, 0, 0], "zone": 1 }, "tail5": { "parent": "tail4", "pivot": [0, 109, 224], "rot": [1, 0, 0], "zone": 1 }, "plates_tail5": { "parent": "tail5", "pivot": [0, 125, 238], "rot": [0, 0, 0], "zone": 1 }, "tail6": { "parent": "tail5", "pivot": [0, 109, 252], "rot": [2, 0, 0], "zone": 1 }, "plates_tail6": { "parent": "tail6", "pivot": [0, 122.5, 265.5], "rot": [0, 0, 0], "zone": 1 }, "tail7": { "parent": "tail6", "pivot": [0, 109, 279], "rot": [3, 0, 0], "zone": 1 }, "plates_tail7": { "parent": "tail7", "pivot": [0, 120, 292], "rot": [0, 0, 0], "zone": 1 }, "tail8": { "parent": "tail7", "pivot": [0, 109, 305], "rot": [3, 0, 0], "zone": 1 }, "plates_tail8": { "parent": "tail8", "pivot": [0, 118, 317.5], "rot": [0, 0, 0], "zone": 1 }, "club": { "parent": "tail8", "pivot": [0, 109, 330], "rot": [0, 0, 0], "zone": 0 } }, "locators": { "heart": { "bone": "body", "pos": [0, 148.7, -30] }, "back": { "bone": "body", "pos": [0, 194.6, -40] }, "plate_tip_0": { "bone": "plates_chest", "pos": [0, 259.5, -119] }, "plate_tip_1": { "bone": "plates_chest", "pos": [0, 277.7343, -90.5] }, "plate_tip_2": { "bone": "plates_chest", "pos": [0, 284.9457, -62.5] }, "plate_tip_3": { "bone": "plates_mid", "pos": [0, 281.9914, -35] }, "plate_tip_4": { "bone": "plates_mid", "pos": [0, 269.5371, -10] }, "plate_tip_5": { "bone": "plates_mid", "pos": [0, 253.2829, 14] }, "plate_tip_6": { "bone": "plates_mid", "pos": [0, 235.1286, 37.5] }, "plate_tip_7": { "bone": "plates_hips", "pos": [0, 217.64, 59] }, "plate_tip_8": { "bone": "plates_hips", "pos": [0, 202.0514, 81] }, "plate_tip_9": { "bone": "plates_hips", "pos": [0, 184.5629, 102.5] }, "gill_l": { "bone": "neck5", "pos": [27, 170, -182.5] }, "gill_r": { "bone": "neck5", "pos": [-27, 170, -182.5] }, "horn_l": { "bone": "head", "pos": [30.5098, 202.6179, -170.548] }, "horn_r": { "bone": "head", "pos": [-30.5098, 202.6179, -170.548] }, "muzzle": { "bone": "head", "pos": [0, 165.75, -314.5] }, "throat": { "bone": "head", "pos": [0, 165.75, -202] }, "nose": { "bone": "head", "pos": [0, 177, -309.5] }, "eye_l": { "bone": "eye_l", "pos": [26.25, 177.25, -237.5] }, "eye_r": { "bone": "eye_r", "pos": [-26.25, 177.25, -237.5] }, "mouth": { "bone": "jaw", "pos": [0, 164.5, -294.5] }, "claw_l": { "bone": "foot_fl", "pos": [46, 2, -158] }, "foot_fl": { "bone": "foot_fl", "pos": [46, -2, -106] }, "claw_r": { "bone": "foot_fr", "pos": [-46, 2, -158] }, "foot_fr": { "bone": "foot_fr", "pos": [-46, -2, -106] }, "foot_bl": { "bone": "foot_bl", "pos": [40, -6, 64] }, "foot_br": { "bone": "foot_br", "pos": [-40, -6, 64] }, "tail_notch": { "bone": "tail7", "pos": [10, 109, 317] }, "club_core": { "bone": "club", "pos": [0, 109, 350] }, "spike_tip_0": { "bone": "club", "pos": [23.2066, 111.881, 359.286] }, "spike_tip_1": { "bone": "club", "pos": [-23.2066, 111.881, 359.286] }, "spike_tip_2": { "bone": "club", "pos": [0, 109, 396] }, "spike_tip_3": { "bone": "club", "pos": [0, 129, 340] }, "spike_tip_4": { "bone": "club", "pos": [0, 126, 351] }, "spike_tip_5": { "bone": "club", "pos": [0, 123, 362] }, "spike_tip_6": { "bone": "club", "pos": [0, 120, 373] }, "spike_tip_7": { "bone": "club", "pos": [0, 89, 340] }, "spike_tip_8": { "bone": "club", "pos": [0, 92, 351] }, "spike_tip_9": { "bone": "club", "pos": [0, 95, 362] }, "spike_tip_10": { "bone": "club", "pos": [0, 98, 373] }, "spike_tip_11": { "bone": "club", "pos": [0, 109, 360] } }, "meta": { "glow_y0": 130, "glow_y1": 300, "wetness": 0.1, "bounds_margin": 6, "form": 5, "veins": 0.3 }, "zones": { "4": ["body", "plates_mid"], "5": ["chest", "plates_chest", "leg_fl", "leg_fl_lower", "foot_fl", "leg_fr", "leg_fr_lower", "foot_fr"], "3": ["hips", "plates_hips", "leg_bl", "leg_bl_lower", "foot_bl", "leg_br", "leg_br_lower", "foot_br"], "6": ["neck1", "plates_neck1", "neck2", "plates_neck2"], "7": ["neck3", "plates_neck3", "neck4", "plates_neck4", "neck5", "plates_neck5", "gill_l1", "gill_l2", "gill_l3", "gill_r1", "gill_r2", "gill_r3"], "8": ["head", "eye_l", "eye_r", "plates_head", "jaw"], "2": ["tail1", "plates_tail1", "tail2", "plates_tail2", "tail3", "plates_tail3"], "1": ["tail4", "plates_tail4", "tail5", "plates_tail5", "tail6", "plates_tail6", "tail7", "plates_tail7", "tail8", "plates_tail8"], "0": ["club"] }, "boxes": { "body": [[-51.4, 93.7, -72.3], [51.4, 199.1, 35.7]], "chest": [[-61.1, 114.6, -153.2], [61.1, 224.9, -47.3]], "plates_chest": [[-27.2, 185.9, -148.5], [27.2, 224.6, -65]], "plates_mid": [[-27.2, 151.3, -76.5], [27.2, 206.2, 38.8]], "hips": [[-48.9, 73.3, 12.7], [48.9, 171.2, 116.7]], "plates_hips": [[-4.5, 137.2, 25.5], [4.5, 169.1, 110.4]], "neck1": [[-42, 134, -150], [42, 210, -127]], "plates_neck1": [[-3.5, 199.8, -151.5], [3.5, 209.2, -136.1]], "neck2": [[-39, 137, -161], [39, 207, -138]], "plates_neck2": [[-3.5, 196.8, -162.5], [3.5, 206.5, -147]], "neck3": [[-36, 140, -172], [36, 204, -149]], "plates_neck3": [[-3.5, 193.8, -173.5], [3.5, 203.8, -158]], "neck4": [[-33, 143, -183], [33, 201, -160]], "plates_neck4": [[-3.5, 190.8, -184.5], [3.5, 201.1, -168.9]], "neck5": [[-30, 145, -193], [30, 199, -171]], "plates_neck5": [[-3.5, 188.8, -195], [3.5, 199.4, -179.4]], "head": [[-31.9, 155.8, -310.8], [31.9, 203.6, -169.7]], "plates_head": [[-2.5, 184.1, -218.3], [2.5, 192.8, -206.4]], "jaw": [[-23.8, 144.5, -315.8], [23.8, 160.8, -199.5]], "gill_l1": [[25.3, 158.8, -192.1], [26.3, 181.2, -182.7]], "gill_l2": [[25.3, 158.8, -186.5], [26.3, 181.2, -177.1]], "gill_l3": [[25.3, 158.8, -180.9], [26.3, 181.2, -171.5]], "gill_r1": [[-26.3, 158.8, -192.1], [-25.3, 181.2, -182.7]], "gill_r2": [[-26.3, 158.8, -186.5], [-25.3, 181.2, -177.1]], "gill_r3": [[-26.3, 158.8, -180.9], [-25.3, 181.2, -171.5]], "leg_fl": [[22, 83, -128.6], [70, 183, -68]], "leg_fl_lower": [[23, 6, -123], [69, 98, -68]], "foot_fl": [[22, -2, -138.6], [70, 17, -74]], "leg_fr": [[-70, 83, -128.6], [-22, 183, -68]], "leg_fr_lower": [[-69, 6, -123], [-23, 98, -68]], "foot_fr": [[-70, -2, -138.6], [-22, 17, -74]], "leg_bl": [[15, 47, 38], [65, 113, 107.4]], "leg_bl_lower": [[17, 2, 43], [63, 62, 100]], "foot_bl": [[18, -6, 33.4], [62, 13, 96]], "leg_br": [[-65, 47, 38], [-15, 113, 107.4]], "leg_br_lower": [[-63, 2, 43], [-17, 62, 100]], "foot_br": [[-62, -6, 33.4], [-18, 13, 96]], "tail1": [[-32, 81, 97], [32, 137, 137]], "plates_tail1": [[-4, 125.7, 108.5], [4, 139.9, 133.4]], "tail2": [[-28, 84, 127], [28, 134, 167]], "plates_tail2": [[-4, 122.9, 139.4], [4, 136.3, 162.4]], "tail3": [[-24.7, 87, 157], [24.7, 131, 196]], "plates_tail3": [[-4, 120.1, 169.8], [4, 132.6, 190.9]], "tail4": [[-21.5, 90, 186], [21.5, 128, 225]], "plates_tail4": [[-4, 117.2, 199.7], [4, 129, 219]], "tail5": [[-18.7, 93, 215], [18.7, 125, 253]], "plates_tail5": [[-3, 114.4, 229], [3, 125.3, 246.5]], "tail6": [[-15.9, 95.5, 243], [15.9, 122.5, 280]], "plates_tail6": [[-3, 112.1, 257.4], [3, 122.1, 273]], "tail7": [[-12.5, 98, 270], [12.5, 120, 306]], "plates_tail7": [[-3, 109.8, 284.8], [3, 119, 298.5]], "tail8": [[-10, 100, 296], [10, 118, 331]], "plates_tail8": [[-3, 108, 311.2], [3, 116.3, 323]], "club": [[-23.9, 97, 328], [23.9, 121, 360.1]] } } };
var LOOK = { "1": { "yaw": { "head": 0.6, "chest": 0.4 }, "pitch": { "head": 0.6, "chest": 0.4 } }, "2": { "yaw": { "head": 0.45, "neck": 0.4, "chest": 0.15 }, "pitch": { "head": 0.5, "neck": 0.4, "chest": 0.1 } }, "3": { "yaw": { "head": 0.35, "neck1": 0.11, "neck2": 0.11, "neck3": 0.11, "neck4": 0.11, "neck5": 0.11, "chest": 0.1 }, "pitch": { "head": 0.4, "neck1": 0.12, "neck2": 0.12, "neck3": 0.12, "neck4": 0.12, "neck5": 0.12 } }, "4": { "yaw": { "head": 0.4, "neck2": 0.2, "neck1": 0.2, "chest": 0.2 }, "pitch": { "head": 0.45, "neck2": 0.25, "neck1": 0.2, "chest": 0.1 } }, "5": { "yaw": { "head": 0.35, "neck1": 0.11, "neck2": 0.11, "neck3": 0.11, "neck4": 0.11, "neck5": 0.11, "chest": 0.1 }, "pitch": { "head": 0.4, "neck1": 0.12, "neck2": 0.12, "neck3": 0.12, "neck4": 0.12, "neck5": 0.12 } } };
var STRIDE_III = 11.9;
var STANCE_III = 8.925;
var BODY_DROP_III = 9;
var WINDOW_CROUCH_III = 6.5;
var BETA_III = 0.75;
var LIFT_III = 16;
var STANCE_MODEL_III = 84;
var SCALE = { 1: 1, 2: 1.25, 3: 1.7, 4: 2, 5: 1.7 };
var STRIDE_IV = 14;
var BETA_IV = 0.6;
var STANCE_MODEL_IV = 67.2;
var LIFT_IV = 22;
var WING_FOLD = { "root": [30, -70, -50], "arm": [50, 130], "fingers": [30, 14, 0, -14] };
var TAIL_LIFT_III = 4;
var TITAN_HEALTH = 1e6;
var VATHROK_HEALTH = 1e6;
var WINDOW_NECK = [32, 28, 20, 0, -24];
var WINDOW_HEAD = [-62.7, 21.8, -51.8];
var GAIT_TICKS = [16, 25, 30];
var ROAR_ENV = { "long": [0.53, 0.57, 0.63, 0.66, 0.7, 0.74, 0.77, 0.78, 0.79, 0.8, 0.78, 0.77, 0.77, 0.78, 0.8, 0.87, 0.98, 1, 1, 0.94, 0.89, 0.92, 0.88, 0.85, 0.84, 0.81, 0.85, 0.9, 0.86, 0.84, 0.82, 0.77, 0.76, 0.75, 0.75, 0.8, 0.93, 1, 0.94, 0.85, 0.82, 0.81, 0.84, 0.86, 0.9, 0.92, 0.93, 0.92, 0.83, 0.78, 0.75, 0.76, 0.78, 0.75, 0.71, 0.69, 0.71, 0.69, 0.66, 0.66, 0.65, 0.64, 0.62, 0.61, 0.62, 0.59, 0.52, 0.48, 0.47, 0.44, 0.37, 0.28, 0.2, 0.16, 0.15, 0.15, 0.15, 0.13, 0.11, 0.1, 0.08, 0.07, 0.07, 0.06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "short": [0.12, 0.38, 0.79, 1, 1, 0.96, 0.93, 0.95, 0.97, 0.93, 0.89, 0.86, 0.88, 0.85, 0.81, 0.81, 0.81, 0.8, 0.77, 0.76, 0.77, 0.73, 0.65, 0.59, 0.59, 0.55, 0.47, 0.35, 0.25, 0.2, 0.18, 0.16, 0.15, 0.11, 0.08, 0.06, 0, 0, 0, 0, 0, 0, 0, 0], "under": [0.44, 0.51, 0.54, 0.51, 0.53, 0.58, 0.64, 0.66, 0.66, 0.67, 0.64, 0.64, 0.63, 0.65, 0.72, 0.83, 0.97, 1, 1, 0.89, 0.81, 0.85, 0.8, 0.76, 0.77, 0.74, 0.81, 0.87, 0.83, 0.82, 0.79, 0.72, 0.71, 0.72, 0.71, 0.76, 0.92, 1, 1, 0.87, 0.82, 0.79, 0.81, 0.85, 0.9, 0.91, 0.92, 0.91, 0.83, 0.77, 0.72, 0.73, 0.74, 0.7, 0.66, 0.63, 0.63, 0.62, 0.6, 0.62, 0.62, 0.63, 0.6, 0.6, 0.61, 0.56, 0.46, 0.39, 0.37, 0.32, 0.25, 0.16, 0.09, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
var VOICE_KIND = { grunt: 4, growl: 5, breath: 6, hurt: 7, roar: 8, roar_short: 9, roar_under: 10 };

// src/rig.ts
var quad = (f) => f === 3 || f === 5;
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
  set("body", s.pitch + (s.lean ?? 0), 0);
  if (s.jaw) set("jaw", s.jaw, 0);
  if (s.chest) set("chest", s.chest, 0);
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
  } else if (form === 4) {
    for (const n of ["neck1", "neck2"]) set(n, -2 * charge, 0);
    set("head", -4 * charge, 0);
    const plant = s.plant ?? 0, pivot = s.pivot ?? 0;
    for (let i = 1; i <= 10; i++) set(`tail${i}`, i >= 5 ? -2.6 * plant : 0, -s.bend * (0.12 + 0.03 * i) * (1 - 0.7 * pivot));
    const fold = 1 - (s.wings ?? 0);
    for (const [side, sg] of [["l", 1], ["r", -1]]) {
      set(`wing_${side}`, WING_FOLD.root[0] * fold, sg * WING_FOLD.root[1] * fold, sg * WING_FOLD.root[2] * fold);
      set(`wing_${side}_arm`, 0, sg * WING_FOLD.arm[0] * fold, sg * WING_FOLD.arm[1] * fold);
      WING_FOLD.fingers.forEach((a, i) => set(`wing_${side}_f${i + 1}`, 0, 0, sg * a * fold));
    }
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
  /** `window`: 0..1, how far into the window crouch (Form III).  `body`: [x, y, z] the body is carried (model units). */
  constructor(form, pose, window = 0, body2 = [0, 0, 0]) {
    this.form = form;
    this.pose = pose;
    this.window = window;
    this.body = body2;
    this.cache = /* @__PURE__ */ new Map();
  }
  bone(name) {
    const hit = this.cache.get(name);
    if (hit) return hit;
    const b = RIGS[this.form].bones[name];
    if (!b) throw new Error(`rig ${this.form}: no bone ${name}`);
    const add3 = this.pose[name];
    const R = rotation(b.rot[0] + (add3 ? add3[0] : 0), b.rot[1] + (add3 ? add3[1] : 0), b.rot[2] + (add3 ? add3[2] : 0));
    const local = about(R, b.pivot);
    if (quad(this.form) && name === "body") local[7] -= BODY_DROP_III + WINDOW_CROUCH_III * this.window;
    if (name === "body") {
      local[3] += this.body[0];
      local[7] += this.body[1];
      local[11] += this.body[2];
    }
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
  /** The same point, but with this bone at its rest angle (its parent posed): where a locator on the jaw is with the mouth shut. */
  restPoint(bone, p) {
    const b = RIGS[this.form].bones[bone];
    const local = about(rotation(b.rot[0], b.rot[1], b.rot[2]), b.pivot);
    return apply(b.parent ? mulM(this.bone(b.parent), local) : local, p);
  }
  pivot(bone) {
    return apply(this.bone(bone), RIGS[this.form].bones[bone].pivot);
  }
};
var drawScale = (form) => SCALE[form];
function toWorld(at3, yaw, m, scale = 1) {
  const l = leftOf(yaw), f = forwardOf(yaw);
  const k = scale / 16;
  const x = m[0] * k, y = m[1] * k, z = -m[2] * k;
  return { x: at3.x + l.x * x + f.x * z, y: at3.y + y, z: at3.z + l.z * x + f.z * z };
}

// src/havoc.ts
import { BlockVolume, EntityDamageCause } from "@minecraft/server";

// src/generated/ids.ts
var NEVER_IDS = ["minecraft:allow", "minecraft:barrier", "minecraft:bedrock", "minecraft:border_block", "minecraft:chain_command_block", "minecraft:command_block", "minecraft:deny", "minecraft:end_portal", "minecraft:end_portal_frame", "minecraft:jigsaw", "minecraft:light_block_0", "minecraft:light_block_1", "minecraft:light_block_10", "minecraft:light_block_11", "minecraft:light_block_12", "minecraft:light_block_13", "minecraft:light_block_14", "minecraft:light_block_15", "minecraft:light_block_2", "minecraft:light_block_3", "minecraft:light_block_4", "minecraft:light_block_5", "minecraft:light_block_6", "minecraft:light_block_7", "minecraft:light_block_8", "minecraft:light_block_9", "minecraft:mob_spawner", "minecraft:piston_arm_collision", "minecraft:portal", "minecraft:reinforced_deepslate", "minecraft:repeating_command_block", "minecraft:sticky_piston_arm_collision", "minecraft:structure_block", "minecraft:structure_void", "minecraft:trial_spawner", "minecraft:vault"];
var STORAGE_IDS = ["minecraft:acacia_hanging_sign", "minecraft:acacia_standing_sign", "minecraft:acacia_wall_sign", "minecraft:anvil", "minecraft:bamboo_hanging_sign", "minecraft:bamboo_standing_sign", "minecraft:bamboo_wall_sign", "minecraft:barrel", "minecraft:beacon", "minecraft:bed", "minecraft:bee_nest", "minecraft:beehive", "minecraft:birch_hanging_sign", "minecraft:birch_standing_sign", "minecraft:birch_wall_sign", "minecraft:black_shulker_box", "minecraft:blast_furnace", "minecraft:blue_shulker_box", "minecraft:bookshelf", "minecraft:brewing_stand", "minecraft:brown_shulker_box", "minecraft:campfire", "minecraft:cauldron", "minecraft:cherry_hanging_sign", "minecraft:cherry_standing_sign", "minecraft:cherry_wall_sign", "minecraft:chest", "minecraft:chipped_anvil", "minecraft:chiseled_bookshelf", "minecraft:copper_chest", "minecraft:crafter", "minecraft:crafting_table", "minecraft:crimson_hanging_sign", "minecraft:crimson_standing_sign", "minecraft:crimson_wall_sign", "minecraft:crying_obsidian", "minecraft:cyan_shulker_box", "minecraft:damaged_anvil", "minecraft:dark_oak_hanging_sign", "minecraft:darkoak_standing_sign", "minecraft:darkoak_wall_sign", "minecraft:decorated_pot", "minecraft:dispenser", "minecraft:dropper", "minecraft:enchanting_table", "minecraft:ender_chest", "minecraft:exposed_copper_chest", "minecraft:flower_pot", "minecraft:frame", "minecraft:furnace", "minecraft:glow_frame", "minecraft:gray_shulker_box", "minecraft:green_shulker_box", "minecraft:hopper", "minecraft:jukebox", "minecraft:jungle_hanging_sign", "minecraft:jungle_standing_sign", "minecraft:jungle_wall_sign", "minecraft:lectern", "minecraft:light_blue_shulker_box", "minecraft:light_gray_shulker_box", "minecraft:lime_shulker_box", "minecraft:lit_blast_furnace", "minecraft:lit_furnace", "minecraft:lit_smoker", "minecraft:lodestone", "minecraft:magenta_shulker_box", "minecraft:mangrove_hanging_sign", "minecraft:mangrove_standing_sign", "minecraft:mangrove_wall_sign", "minecraft:oak_hanging_sign", "minecraft:obsidian", "minecraft:orange_shulker_box", "minecraft:oxidized_copper_chest", "minecraft:pale_oak_hanging_sign", "minecraft:pale_oak_standing_sign", "minecraft:pale_oak_wall_sign", "minecraft:pink_shulker_box", "minecraft:poplar_hanging_sign", "minecraft:poplar_standing_sign", "minecraft:poplar_wall_sign", "minecraft:purple_shulker_box", "minecraft:red_shulker_box", "minecraft:respawn_anchor", "minecraft:smoker", "minecraft:soul_campfire", "minecraft:spruce_hanging_sign", "minecraft:spruce_standing_sign", "minecraft:spruce_wall_sign", "minecraft:standing_banner", "minecraft:standing_sign", "minecraft:straw_bed", "minecraft:trapped_chest", "minecraft:undyed_shulker_box", "minecraft:wall_banner", "minecraft:wall_sign", "minecraft:warped_hanging_sign", "minecraft:warped_standing_sign", "minecraft:warped_wall_sign", "minecraft:waxed_copper_chest", "minecraft:waxed_exposed_copper_chest", "minecraft:waxed_oxidized_copper_chest", "minecraft:waxed_weathered_copper_chest", "minecraft:weathered_copper_chest", "minecraft:white_shulker_box", "minecraft:yellow_shulker_box"];
var NATURAL_IDS = ["minecraft:amethyst_block", "minecraft:andesite", "minecraft:basalt", "minecraft:bedrock", "minecraft:black_terracotta", "minecraft:blackstone", "minecraft:blue_ice", "minecraft:blue_terracotta", "minecraft:brain_coral_block", "minecraft:brown_terracotta", "minecraft:bubble_coral_block", "minecraft:budding_amethyst", "minecraft:calcite", "minecraft:clay", "minecraft:coal_ore", "minecraft:coarse_dirt", "minecraft:cobbled_deepslate", "minecraft:copper_ore", "minecraft:cyan_terracotta", "minecraft:dead_brain_coral_block", "minecraft:dead_bubble_coral_block", "minecraft:dead_fire_coral_block", "minecraft:dead_horn_coral_block", "minecraft:dead_tube_coral_block", "minecraft:deepslate", "minecraft:deepslate_coal_ore", "minecraft:deepslate_copper_ore", "minecraft:deepslate_diamond_ore", "minecraft:deepslate_emerald_ore", "minecraft:deepslate_gold_ore", "minecraft:deepslate_iron_ore", "minecraft:deepslate_lapis_ore", "minecraft:deepslate_redstone_ore", "minecraft:diamond_ore", "minecraft:diorite", "minecraft:dirt", "minecraft:dirt_with_roots", "minecraft:dripstone_block", "minecraft:emerald_ore", "minecraft:end_stone", "minecraft:fire_coral_block", "minecraft:gold_ore", "minecraft:granite", "minecraft:grass_block", "minecraft:gravel", "minecraft:gray_terracotta", "minecraft:green_terracotta", "minecraft:hardened_clay", "minecraft:horn_coral_block", "minecraft:ice", "minecraft:iron_ore", "minecraft:lapis_ore", "minecraft:light_blue_terracotta", "minecraft:light_gray_terracotta", "minecraft:lime_terracotta", "minecraft:lit_deepslate_redstone_ore", "minecraft:lit_redstone_ore", "minecraft:magenta_terracotta", "minecraft:magma", "minecraft:moss_block", "minecraft:mud", "minecraft:muddy_mangrove_roots", "minecraft:mycelium", "minecraft:nether_gold_ore", "minecraft:netherrack", "minecraft:obsidian", "minecraft:orange_terracotta", "minecraft:packed_ice", "minecraft:packed_mud", "minecraft:pale_moss_block", "minecraft:pink_terracotta", "minecraft:podzol", "minecraft:powder_snow", "minecraft:purple_terracotta", "minecraft:quartz_ore", "minecraft:red_sand", "minecraft:red_sandstone", "minecraft:red_terracotta", "minecraft:redstone_ore", "minecraft:sand", "minecraft:sandstone", "minecraft:smooth_basalt", "minecraft:snow", "minecraft:soul_sand", "minecraft:soul_soil", "minecraft:stone", "minecraft:suspicious_gravel", "minecraft:suspicious_sand", "minecraft:tube_coral_block", "minecraft:tuff", "minecraft:white_terracotta", "minecraft:yellow_terracotta"];

// src/havoc.ts
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
function shatter(dim, at3) {
  const b = blockAt(dim, at3);
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
  if (isGlass) sound(dim, "random.glass", at3, 32, 0.8, 0.9 + (at3.x + at3.z & 3) * 0.05);
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
function carve(dim, at3, r, budget, fire = false) {
  const out = { broken: 0, floor: [] };
  if (!isLoaded(dim, at3)) return out;
  const cx = Math.floor(at3.x), cy = Math.floor(at3.y), cz = Math.floor(at3.z);
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
var HIS_GROUND2 = ["basiliskra:irradiated_soil", "basiliskra:irradiated_rock", "basiliskra:scarlet_trinitite", "basiliskra:glowing_slag", "basiliskra:cooled_slag"];
var LIQUID = ["minecraft:air", "minecraft:water", "minecraft:flowing_water", "minecraft:lava", "minecraft:flowing_lava"];
var keptLists = /* @__PURE__ */ new Map();
function kept(ground) {
  const key = `${CONFIG.spareStorage}|${ground}`;
  let list = keptLists.get(key);
  if (!list) {
    list = [...LIQUID, ...NEVER_IDS, ...CONFIG.spareStorage ? STORAGE_IDS : [], ...ground ? [...NATURAL_IDS, ...HIS_GROUND2] : []];
    keptLists.set(key, list);
  }
  return list;
}
var fillRefused = false;
function clearBox(dim, lo, hi, keepGround) {
  if (!wither()) return 0;
  if (fillRefused) return -1;
  try {
    return dim.fillBlocks(new BlockVolume(lo, hi), "minecraft:air", { blockFilter: { excludeTypes: kept(keepGround) }, ignoreChunkBoundErrors: true }).getCapacity();
  } catch (e) {
    if (!/Unloaded/i.test(String(e))) fillRefused = true;
    return -1;
  }
}
function ploughBox(dim, pos, forward, front, halfWidth, top2, depth, rockFrom) {
  if (!wither()) return 0;
  const lx = Math.abs(forward.z) * halfWidth + 1, lz = Math.abs(forward.x) * halfWidth + 1;
  const y0 = Math.floor(pos.y);
  let n = 0;
  for (let d = 0; d < depth; d += 2) {
    const cx = pos.x + forward.x * (front + d), cz = pos.z + forward.z * (front + d);
    if (!isLoaded(dim, { x: cx, y: y0, z: cz })) continue;
    const x0 = Math.floor(cx - lx), x1 = Math.floor(cx + lx), z0 = Math.floor(cz - lz), z1 = Math.floor(cz + lz);
    const split = rockFrom === null ? top2 + 1 : Math.min(rockFrom, top2 + 1);
    if (split > 0) {
      const a = clearBox(dim, { x: x0, y: y0, z: z0 }, { x: x1, y: y0 + split - 1, z: z1 }, true);
      if (a < 0) return -1;
      n += a;
    }
    if (split <= top2) {
      const b = clearBox(dim, { x: x0, y: y0 + split, z: z0 }, { x: x1, y: y0 + top2, z: z1 }, false);
      if (b < 0) return -1;
      n += b;
    }
  }
  return n;
}
function ploughNoise(dim, at3, broken) {
  sound(dim, "mob.wither.break_block", at3, 128, 1, 0.55);
  const n = Math.min(4, 1 + Math.floor(broken / 60));
  for (let i = 0; i < n; i++) particle(dim, "basiliskra:impact_debris", { x: at3.x + (i - n / 2) * 3, y: at3.y + 2 + i * 3, z: at3.z + (i % 2 ? 2 : -2) }, 96);
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
    const top2 = i % 4 === 0 ? 6 : 2;
    for (let dy = -1; dy <= top2; dy++) {
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
function mobsNear(dim, at3, r) {
  try {
    const out = dim.getEntities({ location: at3, maxDistance: r, families: ["mob"], excludeTypes: [TYPE, TITAN, VATHROK, VATHROK_TITAN, "minecraft:player"], excludeFamilies: [PART_FAMILY] });
    const seen = new Set(out.map((e) => e.id));
    for (const e of dim.getEntities({ location: at3, maxDistance: r, families: ["monster"], excludeTypes: [TYPE, TITAN, "minecraft:player"], excludeFamilies: [PART_FAMILY, "mob"] })) {
      if (!seen.has(e.id)) out.push(e);
    }
    return out;
  } catch {
    return [];
  }
}
var GIANT_HEALTH = 2e3;
function foreignGiantsNear(dim, at3, r) {
  try {
    return dim.getEntities({ location: at3, maxDistance: r, families: ["monster"], excludeTypes: [TYPE, TITAN, "minecraft:player"], excludeFamilies: [PART_FAMILY] }).filter((e) => {
      try {
        return (e.getComponent("minecraft:health")?.effectiveMax ?? 0) >= GIANT_HEALTH;
      } catch {
        return false;
      }
    });
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
function blast(dim, at3, r, playerDamage, mobDamage, knock, hurtPlayer, source, from = at3, mobs) {
  for (const p of witnesses(dim, at3, r)) {
    try {
      const d = dist(add(p.location, { x: 0, y: 0.9, z: 0 }), at3);
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
  for (const e of mobs ?? mobsNear(dim, at3, r)) {
    try {
      if (!e.isValid) continue;
      const loc = e.location;
      const d = dist(loc, at3);
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
  if (rec.form !== 1 && rec.form !== 2 && rec.form !== 3 && rec.form !== 4) rec.form = 1;
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
  const head2 = world4.getDynamicProperty(key);
  if (typeof head2 !== "string") return void 0;
  if (!head2.startsWith("#")) return head2;
  const n = parseInt(head2.slice(1), 10);
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
    const big = form === 4;
    if (big && M * k < 3) continue;
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
    const n = d.map((len2) => Math.max(1, Math.ceil((len2 - edge * (big ? 0.35 : 0.2)) / edge)));
    const tag = /^(head|jaw|neck)/.test(bone) ? "head" : /^(tail|club|knob|seg(8|9|10)$|tailfin)/.test(bone) ? "tail" : /^(leg|foot|arm|forearm|claw|hand|wing|fin)/.test(bone) ? "limb" : "body";
    const lm = quad(form) ? /^(?:leg|foot)_(fl|fr|bl|br)(_lower)?$/.exec(bone) : form === 4 ? /^(?:leg|foot)_(l|r)(_lower)?$/.exec(bone) : null;
    const leg = lm ? lm[1] : void 0;
    const swing = lm ? bone.startsWith("foot") ? 1 : lm[2] ? 0.55 : 0.25 : void 0;
    for (let ix = 0; ix < n[0]; ix++) for (let iy = 0; iy < n[1]; iy++) for (let iz = 0; iz < n[2]; iz++) {
      const at3 = [ix, iy, iz].map((i, ax) => n[ax] === 1 ? (lo[ax] + hi[ax]) / 2 : lo[ax] + edge / 2 + i * (d[ax] - edge) / (n[ax] - 1));
      out.push({ bone, at: at3, si, tag, leg, swing });
      placed.push({ c: rest.point(bone, at3), h: half });
    }
  }
  partCache.set(form, out);
  return out;
}
var WINGS = { recoil: 1, roar: 0.85, evolve: 1, rise: 0.7, fire: 0.3, rear: 1, pivot: 0.45, bite: 0.5, fall: 0.6 };
var PLANTED = /* @__PURE__ */ new Set(["charge", "fire", "pour", "rear", "pivot", "skid"]);
var LEG_PHASE = { bl: 0, fl: 270, br: 180, fr: 90, l: 0, r: 180 };
var MOVE = {
  1: { turn: 2.2, accel: 0.02, radius: 3 },
  2: { turn: 1.4, accel: 0.03, radius: 3.1 },
  3: { turn: 1, accel: 0.011, radius: 6 },
  4: { turn: 0.75, accel: 0.012, radius: 9 },
  // Vathrok (2.0): longer and taller than Form III, on the same four-beat walk
  5: { turn: 0.95, accel: 0.012, radius: 7 }
};
var DROP = 30;
var BODY = {
  2: { built: [1.8, 3.2], cliff: 4.5, front: 4.4, look: [0.6, 2, 5, 9, 13], wade: 2, climb: 2, top: 4 },
  3: { built: [4.2, 6.1], cliff: 8.2, front: 9.4, look: [0.6, 3, 10, 17, 24], wade: 8, climb: 5.4, top: 10 },
  4: { built: [6, 11], cliff: 15, front: 11, look: [0.6, 4, 14, 24, 34], wade: 16, climb: 7.4, top: 24 },
  5: { built: [5, 8.5], cliff: 10, front: 12, look: [0.6, 3, 12, 20, 28], wade: 10, climb: 6, top: 16 }
};
var Creature = class {
  constructor(entity, form = store.rec.form) {
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
    /** How much harder than Basiliskra himself this body hits, and how much faster it walks (the Titan). */
    this.might = 1;
    /** If set, what any blow of its does to a player or a creature, whatever the blow (the Titan: they die of it). */
    this.lethal = 0;
    /** Whose colours its breath is drawn in: "" his red, "v" Vathrok's green (beam.ts tint). */
    this.hue = "";
    /** Off the ground (a leap, 2.3): his brain carries him through the air; he neither walks nor settles onto the ground. */
    this.airborne = false;
    this.haste = 1;
    this.skelForm = 1;
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
    this.waves = [];
    /**
     * Form I out of water (the pond was drained, ice closed over, something carried him): look for the
     * nearest deep column in loaded chunks and slide back into it.  He is never left lying in rock.
     */
    this.unsettled = true;
    this.dry = 0;
    /** Curl held while not moving (sleeping at the seam). */
    this.bendHold = 0;
    /** Told of every blow another giant lands on this body (`heavy`: its jaws, its tail, its weight; not its breath). */
    this.onBlow = null;
    this.dim = entity.dimension;
    this.pos = { ...entity.location };
    this.yaw = entity.getRotation().y;
    this.lastYaw = this.yaw;
    this.form = form;
    giants.set(entity.id, this);
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
    const b = this.breathPose();
    return poseOf(this.form, {
      lookYaw: Math.round(this.lookYaw),
      lookPitch: Math.round(this.lookPitch),
      bend: Math.round(this.bend),
      pitch: Math.round(this.pitch),
      charge: b.charge,
      drink: this.phase === "drink" ? 1 : 0,
      window: this.phase === "window" || this.phase === "stalk" ? 1 : 0,
      wings: WINGS[this.phase] ?? 0,
      plant: PLANTED.has(this.phase) ? 1 : 0,
      pivot: this.phase === "pivot" ? 1 : 0,
      jaw: b.jaw,
      lean: b.lean,
      chest: b.chest
    });
  }
  /**
   * What the client animation adds to his jaw, chest and body in the phases of a breath, once it has settled (the
   * same numbers as tools/kit/gen_client.py): the mouth the beam leaves by must be where it is drawn.
   */
  breathPose() {
    const ph = this.phase, f = this.form;
    const charging = ph === "charge" || ph === "fire" || ph === "pour" || ph === "rear" || f === 4 && (ph === "skid" || ph === "pivot");
    const firing = ph === "fire" || f === 4 && (ph === "skid" || ph === "pivot");
    const pour = ph === "pour" ? 10 : ph === "rear" ? 22 : 0;
    const skid = f === 4 && (ph === "skid" || ph === "pivot");
    if (f === 3) {
      return {
        charge: charging ? 1 : 0,
        jaw: (charging ? this.charge * 0.9 : 0) + (firing ? 16 : 0) + pour + (ph === "vent" ? 6 : 0) + (ph === "grounded" ? 8 : 0),
        lean: 0,
        chest: (firing ? -1.5 : 0) + (ph === "pour" ? 3 : ph === "rear" ? -8 : 0),
        body: [0, charging ? -3 : 0, 0]
      };
    }
    if (f === 4) {
      return {
        charge: charging ? 1 : 0,
        jaw: (charging ? this.charge * 0.8 : 0) + (firing ? 14 : 0) + pour + (ph === "vent" ? 6 : 0) + (ph === "grounded" ? 8 : 0) + (ph === "recoil" ? 24 : 0),
        lean: skid ? -6 : 0,
        chest: (firing ? -2 : 0) + (ph === "pour" ? 12 : ph === "rear" ? -30 : 0),
        body: [0, (charging ? -4 : 0) + (skid ? -5 : 0), skid ? 5 : 0]
      };
    }
    return { charge: 0, jaw: 0, lean: 0, chest: 0, body: [0, 0, 0] };
  }
  /** How much larger than modelled he is drawn. */
  get scale() {
    return drawScale(this.form);
  }
  skeleton() {
    if (this.skel && this.skelForm !== this.form) this.skel = null;
    if (!this.skel) {
      this.skel = new Skeleton(this.form, this.pose(), this.phase === "window" || this.phase === "stalk" ? 1 : 0, this.breathPose().body);
      this.skelForm = this.form;
    }
    return this.skel;
  }
  anchor(locator) {
    return toWorld(this.pos, this.yaw, this.skeleton().locator(locator), this.scale);
  }
  point(bone, at3) {
    return toWorld(this.pos, this.yaw, this.skeleton().point(bone, at3), this.scale);
  }
  /** Model-unit offset (forward, up) of a sole from its rest place, at this point of the walk (as the client solves it). */
  legOffset(leg) {
    const p = ((this.walkPhase + LEG_PHASE[leg]) % 360 + 360) % 360 / 360;
    const four = this.form === 4, beta = four ? BETA_IV : BETA_III, stance = four ? STANCE_MODEL_IV : STANCE_MODEL_III, lift = four ? LIFT_IV : LIFT_III;
    if (p < beta) return [stance * (0.5 - p / beta), 0];
    const su = (p - beta) / (1 - beta);
    return [-stance / 2 + stance * su * su * (3 - 2 * su), lift * Math.sin(Math.PI * su) * (this.phase === "move" || this.phase === "stalk" || this.phase === "carry" ? 1 : 0)];
  }
  get forward() {
    return forwardOf(this.yaw);
  }
  /**
   * Where his breath leaves him, and the way his head points (from the throat through the muzzle).  It leaves by the
   * middle of the open mouth: half way between the line of his upper jaw (the mouth locator as it is with the jaw
   * shut) and the dropped lower jaw (the same locator as the jaw is drawn).
   */
  aim() {
    const dir = norm(sub(this.anchor("muzzle"), this.anchor("throat")));
    const loc = RIGS[this.form].locators.mouth;
    if (!loc || loc.bone !== "jaw") return { from: this.anchor("mouth"), dir };
    const sk = this.skeleton();
    const open = sk.point("jaw", loc.pos), shut = sk.restPoint("jaw", loc.pos);
    const mid = [(open[0] + shut[0]) / 2, (open[1] + shut[1]) / 2, (open[2] + shut[2]) / 2];
    return { from: toWorld(this.pos, this.yaw, mid, this.scale), dir };
  }
  /** How wide his mouth stands open, in blocks (the breath is drawn to fill it). */
  mouthGap() {
    const loc = RIGS[this.form].locators.mouth;
    if (!loc || loc.bone !== "jaw") return 0;
    const sk = this.skeleton();
    const a = sk.point("jaw", loc.pos), b = sk.restPoint("jaw", loc.pos);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * this.scale / 16;
  }
  /** Turn the head (not the feet) towards a point; returns how far off the limit it is. */
  lookAt(target, maxYaw = 80, maxPitch = 40) {
    const base = this.form === 1 ? this.anchor("throat") : this.form === 5 ? this.point("neck1", RIGS[5].bones.neck1.pivot) : this.point(this.form === 2 ? "neck" : "neck1", this.form === 2 ? [0, 84, -32] : this.form === 4 ? [0, 336, -22] : [0, 114, -126]);
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
  /** The look was set by hand: the skeleton (and so the muzzle) is posed afresh. */
  relook() {
    this.skel = null;
  }
  /**
   * Turn the head toward a point, but no faster than `rate` degrees a tick on each axis (what is aimed at moves; a
   * head this size does not snap round).  The muzzle is pointed as aimAt points it; if the neck cannot reach, the
   * feet shuffle round.  Returns the error left, in degrees.
   */
  trackTo(target, rate, maxYaw = 80, maxPitch = 80) {
    const y0 = this.lookYaw, p0 = this.lookPitch;
    const reach = this.aimAt(target, maxYaw, maxPitch);
    const wantY = this.lookYaw, wantP = this.lookPitch;
    this.lookYaw = y0 + clamp(wantY - y0, -rate, rate);
    this.lookPitch = p0 + clamp(wantP - p0, -rate, rate);
    this.skel = null;
    if (reach > 0) this.yaw = turnTowards(this.yaw, yawTo(this.pos, target), Math.min(1.2, rate * 0.5));
    return Math.hypot(wantY - this.lookYaw, wantP - this.lookPitch);
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
    this.goalSpeed = speed * this.haste;
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
      if (!this.planner.step(this.form >= 3 ? 5 : 8)) return;
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
  walled(at3, full) {
    const b = BODY[this.form];
    const feet = this.afloat && this.surfY != null ? Math.max(this.pos.y, this.surfY - 1.2) : this.pos.y;
    if (this.smashing()) return false;
    return trunkBlocked(this.dim, at3, feet, MOVE[this.form].radius, b.built, b.cliff, full);
  }
  /** Is there room for his middle here (used by the few moves that carry him without stepping)? */
  roomAt(at3) {
    for (const dy of [1, 3]) {
      const b = blockAt(this.dim, { x: at3.x, y: at3.y + dy, z: at3.z });
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
    const step = Math.floor(b.climb) - 1;
    if (this.form === 4) {
      if (this.tick - this.crushAt < 5 || this.speed < 0.01) return;
      this.crushAt = this.tick;
      const rock = this.afloat || this.inDeep() ? null : step;
      const broke2 = ploughBox(this.dim, this.pos, this.forward, b.front - 3, Math.ceil(r) + 3, 56, 7, rock);
      if (broke2 < 0) {
        crush(this.dim, this.pos, this.forward, b.front - 2, Math.ceil(r) + 1, 0, 26, 5, 220, rock, this.tick - this.crushSoundAt >= 14);
        return;
      }
      if (broke2 > 12 && this.tick - this.crushSoundAt >= 14) {
        this.crushSoundAt = this.tick;
        ploughNoise(this.dim, add(this.pos, mul(this.forward, b.front)), broke2);
      }
      if (broke2 > 0) ploughBox(this.dim, { x: this.pos.x, y: this.pos.y + 57, z: this.pos.z }, this.forward, b.front - 3, Math.ceil(r) + 3, 50, 7, null);
      return;
    }
    const top2 = Math.round(9.6 * this.scale);
    const f = this.forward, l = leftOf(this.yaw);
    let found = false;
    probe: for (const s of [b.front, b.front + 2]) for (const side of [-0.8, 0, 0.8]) for (const h of [1.2, step + 0.5, top2 * 0.55, top2 - 1]) {
      const q = blockAt(this.dim, { x: this.pos.x + f.x * s + l.x * side * r, y: this.pos.y + h, z: this.pos.z + f.z * s + l.z * side * r });
      if (!q || q.isAir || q.isLiquid) continue;
      if (h < step && isNaturalGround(q.typeId) && !isPlantBlock(q.typeId)) continue;
      found = true;
      break probe;
    }
    if (!found) return;
    this.crushAt = this.tick;
    const loud2 = this.tick - this.crushSoundAt >= 14;
    const broke = crush(this.dim, this.pos, this.forward, b.front - 2, Math.ceil(r) + 2, 0, top2, 6, 260, this.afloat || this.inDeep() ? null : step, loud2);
    if (broke) {
      this.speed *= 0.8;
      if (loud2) this.crushSoundAt = this.tick;
      ploughBox(this.dim, { x: this.pos.x, y: this.pos.y + top2 + 1, z: this.pos.z }, this.forward, b.front - 2, Math.ceil(r) + 2, 70, 6, null);
    }
  }
  /**
   * A footfall's shock rolling out ahead of him: a band wider than he is, sweeping forward two blocks a tick from his
   * shoulders, and everything built or grown in it goes (never the ground itself).  `reach`: how far it rolls;
   * `extra`: how much wider than his body; `top`: how high it reaches.  In the destructive setting only.
   */
  stompWave(reach, extra, top2) {
    if (!this.smashing() || this.afloat || this.inDeep()) return;
    const front = BODY[this.form].front;
    this.waves.push({ pos: { ...this.pos }, fwd: this.forward, d: front - 1, end: front + reach, half: Math.ceil(MOVE[this.form].radius) + extra, top: top2 });
    if (this.waves.length > 3) this.waves.shift();
  }
  waveTick() {
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      const n = ploughBox(this.dim, w.pos, w.fwd, w.d, w.half, w.top, 2, null);
      if (n > 8) {
        const at3 = add(w.pos, mul(w.fwd, w.d + 1));
        particle(this.dim, "basiliskra:impact_debris", { x: at3.x, y: at3.y + 2, z: at3.z }, 96);
        particle(this.dim, "basiliskra:step_dust", { x: at3.x, y: at3.y + 0.5, z: at3.z }, 96);
        if (n > 30 && this.tick - this.crushSoundAt >= 6) {
          this.crushSoundAt = this.tick;
          ploughNoise(this.dim, at3, n);
        }
      }
      w.d += 2;
      if (n < 0 || w.d >= w.end) this.waves.splice(i, 1);
    }
  }
  /** Water deeper than this form wades: Form II drags through shallows, Form III stands belly-deep. */
  tooDeep(at3, floorY) {
    if (this.wade || this.form === 1) return false;
    return waterOver(this.dim, at3.x, at3.z, floorY, BODY[this.form].wade);
  }
  /** Already in water over his depth (swimming, or sunk to the bed): then every way is a way out. */
  inDeep() {
    return this.afloat || this.tooDeep(this.pos, this.pos.y);
  }
  clearAlong(yaw, reach) {
    const f = forwardOf(yaw);
    for (const s of BODY[this.form].look) {
      if (s > reach) break;
      const at3 = add(this.pos, mul(f, s));
      if (this.walled(at3, true)) return false;
      const floor = groundY(this.dim, at3.x, at3.z, this.pos.y + 6, DROP + 6);
      if (floor === NONE) return false;
      if (typeof floor === "number" && !this.inDeep() && this.tooDeep(at3, floor)) return false;
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
    const top2 = BODY[this.form].top;
    const yTop = this.pos.y + top2 + (this.afloat ? lim + 2 : 0);
    const mid = groundY(this.dim, next.x, next.z, yTop, DROP + top2);
    if (moving && !this.wade && !this.inDeep() && typeof mid === "number" && this.tooDeep(next, mid)) {
      this.blockedWhy = "deep";
      return null;
    }
    let g = footprintY(this.dim, next, r, yTop, DROP + top2, floatY);
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
      const head2 = add(next, mul(this.forward, 7));
      const hb = blockAt(this.dim, { x: head2.x, y: this.pos.y + 1.5, z: head2.z });
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
    if (this.airborne) {
      this.speed = 0;
      return 0;
    }
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
      const at3 = { x: c.x, y: Math.max(c.y - s / 2, this.pos.y - 0.25), z: c.z };
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
        if (!isLoaded(this.dim, at3)) continue;
        try {
          part = this.dim.spawnEntity(hitboxId(si), at3);
          partOwner.set(part.id, { creature: this, tag: d.tag });
          this.parts[i] = part;
          this.partIds[i] = part.id;
          this.partPos[i] = at3;
        } catch {
          this.parts[i] = void 0;
        }
        continue;
      }
      const last = this.partPos[i];
      if (!last || dist(last, at3) > 0.2) {
        try {
          part.teleport(at3);
          this.partPos[i] = at3;
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
      const at3 = this.partPos[i];
      if (!at3) continue;
      const h = SIZES[defs[i].si] / 2;
      const lo = [at3.x - h, at3.y, at3.z - h], hi = [at3.x + h, at3.y + 2 * h, at3.z + h];
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
    const trunk = this.form === 1 ? { h: 4.4, r: 3 } : this.form === 2 ? { h: 7.2 * k, r: 3.3 * k } : this.form === 4 ? { h: 20 * k, r: 5 * k } : this.form === 5 ? { h: 12 * k, r: 5 * k } : { h: 9.6 * k, r: 4.3 * k };
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
            this.hurt(p, this.form >= 3 ? 4 : 2);
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
    if (this.waves.length) this.waveTick();
    return moved;
  }
  /** A sound from him.  If it is his voice, his mouth moves with it (the client times the jaw to the recording). */
  say(id, at3, range = 56, volume = 1, pitch = 1) {
    sound(this.dim, id, at3 ?? this.pos, range, volume, pitch);
    const m = /^basiliskra\.(?:[a-z]+\.)?(grunt|growl|breath|huff|hurt|roar|roar_short|roar_under)$/.exec(id);
    if (m) this.pulse(VOICE_KIND[m[1] === "huff" ? "breath" : m[1]]);
  }
  emit(id, at3, range = 56) {
    particle(this.dim, id, at3, range);
  }
  /** Damage a player from him (never on Peaceful when configured so; never Creative/Spectator). */
  hurt(p, amount, cause = EntityDamageCause2.entityAttack) {
    if (!targetable(p)) return false;
    if (CONFIG.harmlessOnPeaceful && String(world5.getDifficulty()).toLowerCase() === "peaceful") return false;
    const dealt = this.lethal > 0 ? this.lethal : amount * this.might;
    try {
      return p.applyDamage(dealt * CONFIG.damage, { cause, damagingEntity: this.entity });
    } catch {
      return false;
    }
  }
  /** What a blow of `base` does to a creature that is not a giant. */
  mobHit(base) {
    return this.lethal > 0 ? this.lethal : base * this.might;
  }
  /** How far his trunk reaches from his middle, on the ground. */
  get girth() {
    return MOVE[this.form].radius;
  }
  /** A blow from another giant (its breath, its jaws, its tail). */
  takeBlow(by, amount, heavy = false) {
    if (amount <= 0 || !this.valid) return false;
    try {
      this.onBlow?.(by, amount, heavy);
    } catch {
    }
    try {
      return this.entity.applyDamage(amount, { cause: EntityDamageCause2.entityAttack, damagingEntity: by.entity });
    } catch {
      return false;
    }
  }
  /** The middle of his trunk: what another giant aims at. */
  middle() {
    const h = this.form === 1 ? 2.2 : this.form === 2 ? 3.6 * this.scale : this.form === 4 ? 12 * this.scale : this.form === 5 ? 8.5 * this.scale : 4.8 * this.scale;
    return { x: this.pos.x, y: this.pos.y + h, z: this.pos.z };
  }
  /** Thrown back by a blow from something his own size: he gives ground if there is ground to give. */
  shove(away, blocks) {
    if (this.form === 1) return;
    const d = norm({ x: away.x, y: 0, z: away.z });
    for (let k = blocks; k > 0.4; k -= 1) {
      const to = { x: this.pos.x + d.x * k, y: this.pos.y, z: this.pos.z + d.z * k };
      if (!isLoaded(this.dim, to)) continue;
      const settled = this.stepLand(to, false);
      if (settled && Math.abs(settled.y - this.pos.y) < 6) {
        this.pos = settled;
        return;
      }
    }
  }
};
var giants = /* @__PURE__ */ new Map();
function giantOf(e) {
  try {
    if (!e) return null;
    const g = giants.get(e.id);
    return g && g.valid ? g : null;
  } catch {
    return null;
  }
}
function separateGiants() {
  const all = [...giants.values()].filter((g) => g.valid && g.form >= 2);
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.dim.id !== b.dim.id) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
    const min = (a.girth + b.girth) * 0.75;
    if (d >= min) continue;
    const away = d > 0.01 ? { x: dx / d, y: 0, z: dz / d } : { x: 1, y: 0, z: 0 };
    const push = (min - d) / 2 + 0.1;
    b.shove(away, push);
    a.shove({ x: -away.x, y: 0, z: -away.z }, push);
  }
}
function otherGiants(c) {
  const out = [];
  for (const [id, g] of giants) {
    if (!g.valid) {
      giants.delete(id);
      continue;
    }
    if (g !== c && g.dim.id === c.dim.id) out.push(g);
  }
  return out;
}
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

// src/city.ts
import { BlockVolume as BlockVolume3, ItemStack } from "@minecraft/server";

// src/lance.ts
import { EntityDamageCause as EntityDamageCause5 } from "@minecraft/server";

// src/beam.ts
import { EntityDamageCause as EntityDamageCause4 } from "@minecraft/server";

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
function addFallout(at3, r, s) {
  if (CONFIG.fallout === "off") return;
  const now = store.rec.clock, list = zones();
  for (const z of list) {
    const rad = radiusOf(z, now);
    if (dist(z, at3) <= Math.max(r, Math.min(rad, 8)) * 0.75) {
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
    const b = blockAt(overworld(), { x: at3.x, y: at3.y + 1, z: at3.z });
    wet = !!b && (b.typeId === "minecraft:water" || b.typeId === "minecraft:flowing_water");
  } catch {
    wet = false;
  }
  list.push({ x: Math.floor(at3.x) + 0.5, y: Math.floor(at3.y), z: Math.floor(at3.z) + 0.5, r, m: Math.min(R_MAX, r * GROWTH), s: Math.min(1.5, s), t: now, w: wet });
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
      const at3 = b.location;
      particle(b.dimension, "basiliskra:crystal_break", { x: at3.x + 0.5, y: at3.y + 0.4, z: at3.z + 0.5 }, 32);
      sound(b.dimension, "break.amethyst_cluster", { x: at3.x + 0.5, y: at3.y + 0.4, z: at3.z + 0.5 }, 20, 0.5, 0.7);
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
    const at3 = b.location;
    if (CONFIG.fallout !== "land" || !hotAt({ x: at3.x + 0.5, y: at3.y + 0.5, z: at3.z + 0.5 }, store.rec.clock)) revert(b);
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
function glassify(dim, at3) {
  if (CONFIG.fallout !== "land") return false;
  const b = blockAt(dim, at3);
  if (!b || !isSolidBlock(b) || !isNaturalGround(b.typeId) || b.typeId === TRINITITE_BLOCK) return false;
  if (touchesBuilt(dim, Math.floor(at3.x), Math.floor(at3.y), Math.floor(at3.z))) return false;
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
      const R = radiusOf(z, now), at3 = { x: z.x, y: z.y + 0.6, z: z.z };
      if (hash(now, z.x, z.z) < Math.min(1, 0.35 + s)) particle(dim, "basiliskra:rad_cloud", at3, 72, sizeVars(R));
      if (now % 16 === 0 && spreading(z, now)) particle(dim, "basiliskra:rad_front", at3, 80, sizeVars(R));
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
    let at3;
    try {
      if (p.dimension.id !== OVERWORLD) {
        clearFog(p);
        continue;
      }
      at3 = p.location;
    } catch {
      continue;
    }
    const d = CONFIG.fallout === "off" ? 0 : doseAt(at3, now);
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
      const n = nearestFallout(at3, now);
      const where = n && n.distance > n.radius ? `  §7fallout §f${Math.round(n.distance - n.radius)}§7 blocks ${direction(at3, n.zone)}` : "";
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
      const under = blockAt(p.dimension, { x: at3.x, y: at3.y - 0.3, z: at3.z });
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

// src/beam.ts
var BIG = {
  "minecraft:ender_dragon": 6,
  "minecraft:ghast": 2.5,
  "minecraft:happy_ghast": 2.5,
  "minecraft:wither": 1.4,
  "minecraft:ravager": 1.2,
  "minecraft:iron_golem": 0.8,
  "minecraft:warden": 0.8,
  "minecraft:elder_guardian": 1.2,
  "minecraft:sniffer": 1
};
function tint(hue, id) {
  return hue && id.startsWith("basiliskra:") ? `basiliskra:${hue}_${id.slice(11)}` : id;
}
var CRATER = 6;
function beamTick(c, T, t, fade, st, shot = {}) {
  const aim = shot.from && shot.dir ? { from: shot.from, dir: shot.dir } : c.aim();
  const from = aim.from, dir = aim.dir;
  const smash = wither() && !shot.harmless;
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
  let struck = null;
  for (const g of otherGiants(c)) {
    if (dist(g.pos, from) > length + 70) continue;
    for (const v of g.volumes()) {
      const along = dot(sub(v.at, from), dir);
      if (along <= 0 || along >= length + v.r) continue;
      if (dist(v.at, add(from, mul(dir, along))) > v.r + T.radius * 0.5) continue;
      const stop2 = Math.max(1, along - v.r * 0.6);
      if (stop2 < length) {
        length = stop2;
        hitBlock = null;
        struck = g;
      }
    }
  }
  const end = add(from, mul(dir, length));
  if (struck) {
    if (t % 3 === 0) particle(c.dim, tint(c.hue, "basiliskra:beam_impact"), end, 128);
    if (t % 4 === 2) particle(c.dim, tint(c.hue, "basiliskra:impact_glare"), end, 160);
    if (t % 7 === 0) particle(c.dim, tint(c.hue, "basiliskra:impact_fire"), end, 128);
    if (t % 6 === 3) particle(c.dim, tint(c.hue, "basiliskra:impact_smoke"), end, 144);
    if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 128);
    if (t % 4 === 0) struck.takeBlow(c, T.damage * 0.5 * Math.max(0.3, fade));
  }
  const w = T.width * fade * (T.rough ? 0.85 + hash(t) * 0.4 : 1) * (1 + 0.14 * Math.sin(t * 1.25));
  drawBeam(c.dim, from, dir, length, w, t, hitBlock !== null || struck !== null, end, void 0, void 0, c.hue);
  const side = norm({ x: -dir.z, y: 0, z: dir.x });
  const up = norm({ x: dir.y * side.z - dir.z * side.y, y: dir.z * side.x - dir.x * side.z, z: dir.x * side.y - dir.y * side.x });
  for (let i = 0; i < 4; i++) {
    const along = (t * 2.3 + i * (length / 4)) % length;
    const a = along * 1.1 + t * 0.9;
    const r = w * 0.45 + 0.3;
    particle(c.dim, tint(c.hue, "basiliskra:beam_spiral"), add(add(from, mul(dir, along)), add(mul(side, Math.cos(a) * r), mul(up, Math.sin(a) * r))), 112);
  }
  if (hitBlock) {
    if (t % 3 === 0) particle(c.dim, tint(c.hue, "basiliskra:beam_impact"), end, 112);
    if (t % 5 === 0) particle(c.dim, tint(c.hue, "basiliskra:impact_blast"), end, 128);
    if (t % 6 === 3) particle(c.dim, tint(c.hue, "basiliskra:impact_smoke"), end, 144);
    if (t % 7 === 0) particle(c.dim, tint(c.hue, "basiliskra:impact_fire"), end, 112);
    if (t % 4 === 2) particle(c.dim, tint(c.hue, "basiliskra:impact_glare"), end, 160);
    if (t % 10 === 5) particle(c.dim, tint(c.hue, "basiliskra:impact_ring"), { x: end.x, y: end.y + 0.4, z: end.z }, 144);
    if (t % 8 === 1) particle(c.dim, tint(c.hue, "basiliskra:impact_fountain"), end, 144);
    if (t % 10 === 0) sound(c.dim, "basiliskra.iii.beam_impact", end, 112);
    if (!st.ground || dist(st.ground, hitBlock) > CRATER + 3) st.ground = hitBlock;
    if (smash) {
      if (t % 4 === 0 && dist(st.ground, hitBlock) <= CRATER) {
        const got = carve(c.dim, hitBlock, T.carve * fade + 0.5, 110, true);
        if (got.broken) particle(c.dim, "basiliskra:impact_debris", end, 128);
        if (!shot.clean) sear(c.dim, got.floor, 5);
      }
      if (t % 12 === 0) {
        particle(c.dim, "minecraft:huge_explosion_emitter", end, 144);
        sound(c.dim, "random.explode", end, 128, 1.4, 0.7 + hash(t, 3) * 0.2);
      }
      if (t % 8 === 4) blast(c.dim, end, T.carve + 3.5, 4, c.mobHit(12), 0.8, (p, n) => c.hurt(p, n), c.entity, end);
    } else if (t % 6 === 0 && !shot.harmless) shot.scorch?.(hitBlock);
    if (t % 6 === 0 && !shot.harmless && !shot.clean) {
      addFallout(st.ground, T.fallout + (smash ? 1 : 0), 0.13);
      if (CONFIG.fallout !== "off") particle(c.dim, "basiliskra:fallout_ash", end, 64);
    }
  }
  if (t % 4 === 0) {
    const reach = T.radius * Math.max(0.5, fade) + 0.4;
    for (const p of players()) {
      try {
        if (p.dimension.id !== c.dim.id || !targetable(p)) continue;
        const body2 = add(p.location, { x: 0, y: 0.9, z: 0 });
        if (segDist(body2, from, dir, length) > reach) continue;
        const along = clamp(dot(sub(body2, from), dir), 0, Math.max(0, length - 0.6));
        if (!clearLine(c.dim, add(from, mul(dir, along)), body2)) continue;
        c.hurt(p, T.damage, EntityDamageCause4.entityAttack);
        try {
          p.setOnFire(3, true);
        } catch {
        }
      } catch {
      }
    }
    for (const e of mobsNear(c.dim, add(from, mul(dir, length / 2)), length / 2 + 10)) {
      try {
        let tall = 1.6;
        try {
          tall = Math.max(1, e.getHeadLocation().y - e.location.y);
        } catch {
        }
        const big = BIG[e.typeId] ?? (tall > 6 ? Math.min(6, 1.5 + tall * 0.12) : 0);
        const heights = tall > 4 ? [0.6, tall * 0.5, tall * 0.9] : [0.6 + big * 0.4];
        if (Math.min(...heights.map((h) => segDist(add(e.location, { x: 0, y: h, z: 0 }), from, dir, length))) > reach + 0.6 + big) continue;
        e.applyDamage(c.lethal > 0 ? c.lethal : T.damage * 2, { cause: EntityDamageCause4.entityAttack, damagingEntity: c.entity });
        e.setOnFire(5, true);
      } catch {
      }
    }
  }
  return { end, hit: hitBlock, length, from, dir, struck };
}
function drawBeam(dim, from, dir, length, w, t, landed, end, to, but, hue = "") {
  const show = (id, at3, range, vars2) => {
    if (to) particleFor(to, tint(hue, id), at3, vars2);
    else particle(dim, tint(hue, id), at3, range, vars2, but);
  };
  const v = beamVars(dir, length, w);
  if (t % 2 === 0) {
    show("basiliskra:beam_glow", from, 192, v);
    show("basiliskra:beam_halo", from, 192, v);
    show("basiliskra:beam_heat", from, 192, v);
    show("basiliskra:beam_core", from, 192, v);
    show("basiliskra:beam_pulse", from, 160, v);
    show("basiliskra:mouth_burst", from, 160, v);
  } else {
    show("basiliskra:beam_smoke", from, 128, v);
    show("basiliskra:beam_sparks", from, 128, v);
    if (t % 4 === 1) show("basiliskra:beam_embers", from, 128, v);
  }
  if (t % 4 === 1) show("basiliskra:mouth_star", from, 160, v);
  if (t % 5 === 0) show("basiliskra:beam_ring", from, 160, v);
  if (t % 3 === 1) show("basiliskra:beam_arc", from, 128, v);
  if (landed && t % 4 === 2) show("basiliskra:impact_flash", end, 192, v);
}
function clearRange(c, from, dir, max) {
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

// src/lance.ts
var LANCE_ITEM = `${NS}:seam_lance`;
var CATEGORY = `${NS}_lance`;
var LANCE = { range: 140, cooldown: 12, damage: 34, head: 1.5, tail: 0.7, other: 9 };
var LASER = { width: 0.9, ticks: 7 };
var MUZZLE_FP = { right: 0.74, up: -0.37, fwd: 2.9 };
var MUZZLE_TP = { right: 0.35, up: 1.06, fwd: 1.5 };
var lasers = [];
function lanceTick() {
  for (let i = lasers.length - 1; i >= 0; i--) {
    const L = lasers[i];
    let ok = true;
    try {
      ok = L.shooter.isValid;
    } catch {
      ok = false;
    }
    if (!ok || L.t >= LASER.ticks) {
      lasers.splice(i, 1);
      continue;
    }
    const fade = L.t < LASER.ticks - 3 ? 1 : (LASER.ticks - L.t) / 3;
    const w = LASER.width * fade * (1 + 0.12 * Math.sin(L.t * 2.1));
    for (const [from, to, but] of [[L.fp, [L.shooter], void 0], [L.tp, void 0, L.shooter]]) {
      const d = sub(L.end, from), len2 = Math.max(0.5, Math.hypot(d.x, d.y, d.z));
      drawBeam(L.dim, from, norm(d), len2, w, L.t * 3 + 4, L.landed, L.end, to, but);
    }
    L.t++;
  }
}
var firedAt = /* @__PURE__ */ new Map();
function fireLance(p, targets, now) {
  if (now - (firedAt.get(p.id) ?? -99) < LANCE.cooldown) return "cooling";
  firedAt.set(p.id, now);
  if (firedAt.size > 64) {
    for (const [k, t] of firedAt) if (now - t > 200) firedAt.delete(k);
  }
  try {
    p.startItemCooldown(CATEGORY, LANCE.cooldown);
  } catch {
  }
  const dim = p.dimension;
  let from, dir;
  try {
    from = p.getHeadLocation();
    dir = p.getViewDirection();
  } catch {
    return "nothing";
  }
  let reach = LANCE.range;
  try {
    const b = dim.getBlockFromRay(from, dir, { maxDistance: LANCE.range, includeLiquidBlocks: false, includePassableBlocks: false });
    if (b) reach = Math.max(0.5, Math.hypot(b.block.location.x + 0.5 - from.x, b.block.location.y + 0.5 - from.y, b.block.location.z + 0.5 - from.z) - 0.4);
  } catch {
  }
  let struck = "nothing";
  let best = null;
  for (const c of targets) {
    try {
      if (!c || !c.valid || c.dim.id !== dim.id) continue;
      const h = c.rayHit(from, dir, reach);
      if (h && (!best || h.dist < best.dist)) best = { c, dist: h.dist, tag: h.tag };
    } catch {
    }
  }
  if (best) {
    reach = Math.max(0.5, best.dist);
    const amount = LANCE.damage * (best.tag === "head" ? LANCE.head : best.tag === "tail" ? LANCE.tail : 1);
    try {
      best.c.entity.applyDamage(amount, { cause: EntityDamageCause5.entityAttack, damagingEntity: p });
      struck = "him";
    } catch {
    }
    try {
      p.playSound("random.orb", { volume: 0.5, pitch: best.tag === "head" ? 1.6 : 1.1 });
    } catch {
    }
  } else {
    try {
      for (const r of dim.getEntitiesFromRay(from, dir, { maxDistance: reach })) {
        const e = r.entity;
        if (e.id === p.id || e.typeId === "minecraft:item" || e.typeId === TYPE || e.typeId === TITAN || isHitbox(e.typeId)) continue;
        reach = Math.max(0.5, r.distance);
        e.applyDamage(LANCE.other, { cause: EntityDamageCause5.entityAttack, damagingEntity: p });
        struck = "other";
        break;
      }
    } catch {
    }
  }
  const end = add(from, mul(dir, reach));
  const landed = struck !== "nothing" || reach < LANCE.range - 1;
  const flat = norm({ x: dir.x, y: 0, z: dir.z });
  const right = norm({ x: -dir.z, y: 0, z: dir.x });
  const camUp = { x: right.y * dir.z - right.z * dir.y, y: right.z * dir.x - right.x * dir.z, z: right.x * dir.y - right.y * dir.x };
  let feet = from;
  try {
    feet = p.location;
  } catch {
  }
  const fp = add(add(add(from, mul(right, MUZZLE_FP.right)), mul(camUp, MUZZLE_FP.up)), mul(dir, MUZZLE_FP.fwd));
  const tp = add(add(add(feet, mul(right, MUZZLE_TP.right)), { x: 0, y: MUZZLE_TP.up, z: 0 }), mul(flat, MUZZLE_TP.fwd));
  lasers.push({ dim, shooter: p, fp, tp, end, landed, t: 0 });
  if (lasers.length > 32) lasers.shift();
  lanceTick();
  for (const [at3, to] of [[fp, true], [tp, false]]) {
    for (const w of witnesses(dim, at3, 96)) {
      if (w.id === p.id !== to) continue;
      try {
        w.spawnParticle("basiliskra:muzzle_flash", at3);
        w.spawnParticle("basiliskra:lamp_flare", at3);
      } catch {
      }
    }
  }
  if (landed) {
    particle(dim, "basiliskra:beam_impact", end, 96);
    particle(dim, "basiliskra:impact_blast", end, 96);
    particle(dim, "basiliskra:impact_glare", end, 128);
    particle(dim, "basiliskra:crystal_break", end, 64);
    sound(dim, "break.amethyst_cluster", end, 48, 0.9, 0.7);
    sound(dim, "random.explode", end, 48, 0.35, 1.6);
  }
  sound(dim, "crossbow.shoot", from, 48, 1, 0.6);
  sound(dim, "firework.blast", from, 64, 0.8, 1.5);
  sound(dim, "beacon.deactivate", from, 32, 0.6, 1.9);
  try {
    p.runCommand("camerashake add @s 0.12 0.1 rotational");
  } catch {
  }
  return struck;
}

// src/city.ts
var FULL = { lotsU: 9, lotsV: 6, trenchU: 240, trenchV: 100, floor: -40, people: 60 };
var SMALL = { lotsU: 3, lotsV: 2, trenchU: 56, trenchV: 40, floor: -40, people: 8 };
var SEA = 62;
var LOT = 21;
var ROAD = 7;
var PITCH = LOT + ROAD;
var AIR = "minecraft:air";
var WATER = "minecraft:water";
var STONE = "minecraft:stone";
var SAND = "minecraft:sand";
var SANDSTONE = "minecraft:sandstone";
var ASPHALT = "minecraft:gray_concrete";
var LINE = "minecraft:light_gray_concrete";
var WALK = "minecraft:smooth_stone";
var GRASS = "minecraft:grass_block";
var FLOOR = "minecraft:smooth_stone";
var LIGHT = "minecraft:sea_lantern";
var LOG = "minecraft:oak_log";
var LEAVES = "minecraft:oak_leaves";
var ABYSS = `${NS}:abyssal_basalt`;
var VENT = `${NS}:seam_vent`;
var LANTERN = `${NS}:drowned_lantern`;
var BONE = `${NS}:old_bone`;
var WALLS = [
  "minecraft:white_concrete",
  "minecraft:light_gray_concrete",
  "minecraft:light_blue_concrete",
  "minecraft:blue_concrete",
  "minecraft:cyan_concrete",
  "minecraft:lime_concrete",
  "minecraft:orange_concrete",
  "minecraft:red_concrete",
  "minecraft:purple_concrete",
  "minecraft:yellow_concrete",
  "minecraft:quartz_block",
  "minecraft:gray_concrete",
  "minecraft:pink_concrete",
  "minecraft:green_concrete"
];
var GLASS2 = [
  "minecraft:glass",
  "minecraft:light_blue_stained_glass",
  "minecraft:blue_stained_glass",
  "minecraft:gray_stained_glass",
  "minecraft:cyan_stained_glass",
  "minecraft:white_stained_glass"
];
var HOUSE = ["minecraft:brick_block", "minecraft:white_terracotta", "minecraft:yellow_terracotta", "minecraft:light_blue_terracotta", "minecraft:oak_planks", "minecraft:birch_planks"];
var ROOF = ["minecraft:red_terracotta", "minecraft:brown_terracotta", "minecraft:gray_terracotta", "minecraft:dark_oak_planks", "minecraft:spruce_planks"];
var GONDOLA = ["minecraft:red_concrete", "minecraft:yellow_concrete", "minecraft:blue_concrete", "minecraft:lime_concrete"];
var BUILT = [
  "minecraft:oak_planks",
  "minecraft:spruce_planks",
  "minecraft:birch_planks",
  "minecraft:jungle_planks",
  "minecraft:acacia_planks",
  "minecraft:dark_oak_planks",
  "minecraft:cobblestone",
  "minecraft:stone_bricks",
  "minecraft:brick_block",
  "minecraft:glass",
  "minecraft:torch",
  "minecraft:chest",
  "minecraft:crafting_table",
  "minecraft:furnace",
  "minecraft:bed",
  "minecraft:wooden_door",
  "minecraft:farmland",
  "minecraft:rail",
  "minecraft:oak_fence",
  "minecraft:ladder",
  "minecraft:bookshelf",
  "minecraft:white_wool",
  "minecraft:hay_block",
  "minecraft:bell",
  "minecraft:lantern",
  "minecraft:glass_pane",
  "minecraft:oak_stairs",
  "minecraft:cobblestone_wall"
];
function toWorld2(S, u, y, v) {
  switch (S.dir) {
    case 0:
      return { x: S.x + u, y, z: S.z + v };
    case 1:
      return { x: S.x - v, y, z: S.z + u };
    case 2:
      return { x: S.x - u, y, z: S.z - v };
    default:
      return { x: S.x + v, y, z: S.z - u };
  }
}
var planOf = (S) => S.small ? SMALL : FULL;
function layout(P) {
  const cityU = P.lotsU * PITCH + ROAD, cityV = P.lotsV * PITCH + ROAD;
  const vProm = cityV, vBeach = cityV + 6, vShal = vBeach + 32, vDrop = vShal + 20, vTr = vDrop + 20, vEnd = vTr + P.trenchV - 1;
  const uS0 = Math.floor((cityU - P.trenchU) / 2), uS1 = uS0 + P.trenchU - 1;
  return { cityU, cityV, vProm, vBeach, vShal, vDrop, vTr, vEnd, uS0, uS1, uMin: Math.min(0, uS0) - 2, uMax: Math.max(cityU - 1, uS1) + 2 };
}
function landmarks(S) {
  const P = planOf(S), L = layout(P);
  return {
    centre: toWorld2(S, L.cityU / 2, S.y + 1, L.cityV / 2),
    beach: toWorld2(S, L.cityU / 2, S.y + 1, L.vBeach + 10),
    deep: toWorld2(S, (L.uS0 + L.uS1) / 2, P.floor + 2, (L.vTr + L.vEnd) / 2),
    radius: Math.max(L.cityU, L.cityV) / 2
  };
}
function plan(S) {
  const P = planOf(S), L = layout(P), G = S.y, ops = [];
  const rnd = (i, j = 0) => hash(S.x * 0.37 + i * 1.7, S.z * 0.53 + j * 2.3, i * 31 + j);
  const pick = (list, i, j = 0) => list[Math.floor(rnd(i, j) * list.length) % list.length];
  const fill = (u02, y0, v0, u12, y1, v1, id) => {
    if (u12 < u02 || y1 < y0 || v1 < v0) return;
    for (let u = u02; u <= u12; u += 16) for (let v = v0; v <= v1; v += 16) for (let y = y0; y <= y1; y += 16) {
      ops.push({ k: "fill", a: [u, y, v], b: [Math.min(u12, u + 15), Math.min(y1, y + 15), Math.min(v1, v + 15)], id });
    }
  };
  const set = (at3, id) => {
    if (at3.length) ops.push({ k: "set", at: at3, id });
  };
  fill(0, G + 1, 0, L.cityU - 1, G + 72, L.vBeach - 1, AIR);
  fill(0, G - 5, 0, L.cityU - 1, G - 1, L.vBeach - 1, STONE);
  fill(0, G, 0, L.cityU - 1, G, L.cityV - 1, WALK);
  fill(0, G, L.vProm, L.cityU - 1, G, L.vBeach - 1, WALK);
  for (let i = 0; i <= P.lotsU; i++) {
    fill(i * PITCH, G, 0, i * PITCH + 6, G, L.cityV - 1, ASPHALT);
    fill(i * PITCH + 3, G, 0, i * PITCH + 3, G, L.cityV - 1, LINE);
  }
  for (let j = 0; j <= P.lotsV; j++) {
    fill(0, G, j * PITCH, L.cityU - 1, G, j * PITCH + 6, ASPHALT);
    fill(0, G, j * PITCH + 3, L.cityU - 1, G, j * PITCH + 3, LINE);
  }
  const lamps = [], posts = [], lights = [];
  const tower = (lu, lv, w, d, h, n) => {
    const u02 = lu + Math.floor((LOT - w) / 2), v0 = lv + Math.floor((LOT - d) / 2), u12 = u02 + w - 1, v1 = v0 + d - 1, top2 = G + h;
    const wall = pick(WALLS, n, 1), glass = pick(GLASS2, n, 2), style = Math.floor(rnd(n, 3) * 3);
    fill(u02, G + 1, v0, u12, top2, v1, wall);
    fill(u02 + 1, G + 1, v0 + 1, u12 - 1, top2 - 1, v1 - 1, AIR);
    for (let y = G + 4; y < top2 - 1; y += 4) {
      fill(u02 + 1, y, v0 + 1, u12 - 1, y, v1 - 1, FLOOR);
      lights.push([u02 + (w >> 1), y, v0 + (d >> 1)]);
    }
    if (style === 0) {
      for (let y = G + 1; y + 2 < top2; y += 4) {
        fill(u02 + 1, y + 1, v0, u12 - 1, y + 2, v0, glass);
        fill(u02 + 1, y + 1, v1, u12 - 1, y + 2, v1, glass);
        fill(u02, y + 1, v0 + 1, u02, y + 2, v1 - 1, glass);
        fill(u12, y + 1, v0 + 1, u12, y + 2, v1 - 1, glass);
      }
    } else if (style === 1) {
      for (let u = u02 + 1; u < u12; u += 2) {
        fill(u, G + 2, v0, u, top2 - 2, v0, glass);
        fill(u, G + 2, v1, u, top2 - 2, v1, glass);
      }
      for (let v = v0 + 1; v < v1; v += 2) {
        fill(u02, G + 2, v, u02, top2 - 2, v, glass);
        fill(u12, G + 2, v, u12, top2 - 2, v, glass);
      }
    } else {
      fill(u02 + 1, G + 2, v0, u12 - 1, top2 - 2, v0, glass);
      fill(u02 + 1, G + 2, v1, u12 - 1, top2 - 2, v1, glass);
      fill(u02, G + 2, v0 + 1, u02, top2 - 2, v1 - 1, glass);
      fill(u12, G + 2, v0 + 1, u12, top2 - 2, v1 - 1, glass);
    }
    fill(u02 + (w >> 1), G + 1, v1, u02 + (w >> 1), G + 2, v1, AIR);
    if (h > 22) fill(u02 + 2, top2 + 1, v0 + 2, u12 - 2, top2 + 2, v1 - 2, wall);
    if (h > 40) {
      fill(u02 + (w >> 1), top2 + 3, v0 + (d >> 1), u02 + (w >> 1), top2 + 8, v0 + (d >> 1), "minecraft:iron_block");
      lights.push([u02 + (w >> 1), top2 + 9, v0 + (d >> 1)]);
    }
  };
  const houses = (lu, lv, n) => {
    fill(lu + 1, G, lv + 1, lu + LOT - 2, G, lv + LOT - 2, GRASS);
    for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
      const u02 = lu + 2 + a * 10, v0 = lv + 2 + b * 10, k = n * 4 + a * 2 + b;
      const wall = pick(HOUSE, k, 5), roof = pick(ROOF, k, 6);
      fill(u02, G + 1, v0, u02 + 6, G + 4, v0 + 6, wall);
      fill(u02 + 1, G + 1, v0 + 1, u02 + 5, G + 4, v0 + 5, AIR);
      fill(u02 + 2, G + 2, v0, u02 + 4, G + 2, v0, "minecraft:glass");
      fill(u02 + 2, G + 2, v0 + 6, u02 + 4, G + 2, v0 + 6, "minecraft:glass");
      fill(u02, G + 2, v0 + 2, u02, G + 2, v0 + 4, "minecraft:glass");
      fill(u02 + 6, G + 1, v0 + 3, u02 + 6, G + 2, v0 + 3, AIR);
      for (let r = 0; r < 4; r++) fill(u02 - 1 + r, G + 5 + r, v0 - 1 + r, u02 + 7 - r, G + 5 + r, v0 + 7 - r, roof);
      lights.push([u02 + 3, G + 4, v0 + 3]);
    }
  };
  const park = (lu, lv, n) => {
    fill(lu + 1, G, lv + 1, lu + LOT - 2, G, lv + LOT - 2, GRASS);
    fill(lu + 9, G, lv + 1, lu + 11, G, lv + LOT - 2, "minecraft:gravel");
    fill(lu + 1, G, lv + 9, lu + LOT - 2, G, lv + 11, "minecraft:gravel");
    fill(lu + 8, G + 1, lv + 8, lu + 12, G + 1, lv + 12, "minecraft:stone_bricks");
    fill(lu + 9, G + 1, lv + 9, lu + 11, G + 1, lv + 11, WATER);
    for (const [du, dv] of [[4, 4], [16, 4], [4, 16], [16, 16]]) {
      const h = 4 + Math.floor(rnd(n, du + dv) * 3);
      fill(lu + du - 2, G + h, lv + dv - 2, lu + du + 2, G + h + 2, lv + dv + 2, LEAVES);
      fill(lu + du - 1, G + h + 3, lv + dv - 1, lu + du + 1, G + h + 3, lv + dv + 1, LEAVES);
      fill(lu + du, G + 1, lv + dv, lu + du, G + h + 1, lv + dv, LOG);
    }
  };
  const stadium = (lu, lv) => {
    const u02 = lu, v0 = lv, u12 = lu + 2 * LOT + ROAD - 1, v1 = lv + 2 * LOT + ROAD - 1;
    fill(u02, G, v0, u12, G, v1, WALK);
    const ring = (inset, y0, y1, id) => {
      fill(u02 + inset, y0, v0 + inset, u12 - inset, y1, v0 + inset + 1, id);
      fill(u02 + inset, y0, v1 - inset - 1, u12 - inset, y1, v1 - inset, id);
      fill(u02 + inset, y0, v0 + inset, u02 + inset + 1, y1, v1 - inset, id);
      fill(u12 - inset - 1, y0, v0 + inset, u12 - inset, y1, v1 - inset, id);
    };
    ring(0, G + 1, G + 13, "minecraft:quartz_block");
    for (let k = 0; k < 5; k++) ring(2 + 2 * k, G + 1, G + 10 - 2 * k, k % 2 ? "minecraft:blue_concrete" : "minecraft:red_concrete");
    fill(u02 + 12, G, v0 + 12, u12 - 12, G, v1 - 12, "minecraft:lime_concrete");
    fill(u02 + 12, G, v0 + v1 >> 1, u12 - 12, G, v0 + v1 >> 1, "minecraft:white_concrete");
    fill(u02 + u12 >> 1, G + 1, v1 - 1, (u02 + u12 >> 1) + 1, G + 3, v1, AIR);
    for (const [u, v] of [[u02, v0], [u12, v0], [u02, v1], [u12, v1]]) {
      fill(u, G + 14, v, u, G + 20, v, "minecraft:iron_block");
      lights.push([u, G + 21, v]);
    }
  };
  const wheel = (lu, lv) => {
    fill(lu + 1, G, lv + 1, lu + LOT - 2, G, lv + LOT - 2, WALK);
    const cu = lu + 10, cv = lv + 10, cy = G + 19, R = 15;
    const rim = [], spokes = [], legs = [], cars = GONDOLA.map(() => []);
    const seen = /* @__PURE__ */ new Set();
    for (let a = 0; a < 360; a += 3) {
      const p = [cu + Math.round(R * Math.cos(a * Math.PI / 180)), cy + Math.round(R * Math.sin(a * Math.PI / 180)), cv];
      if (!seen.has(p.join())) {
        seen.add(p.join());
        rim.push(p);
      }
      if (a % 45 === 0) {
        cars[a / 45 % GONDOLA.length].push([p[0], p[1] - 1, cv + 1], [p[0], p[1] - 2, cv + 1]);
        for (let r = 2; r < R; r += 1) spokes.push([cu + Math.round(r * Math.cos(a * Math.PI / 180)), cy + Math.round(r * Math.sin(a * Math.PI / 180)), cv]);
      }
    }
    for (let y = G + 1; y < cy; y++) {
      const k = (cy - y) * 0.42;
      legs.push([cu - Math.round(k), y, cv - 1], [cu + Math.round(k), y, cv - 1]);
    }
    set(rim, "minecraft:white_concrete");
    set(spokes, "minecraft:iron_bars");
    set(legs, "minecraft:iron_block");
    set([[cu, cy, cv], [cu, cy, cv - 1]], "minecraft:red_concrete");
    cars.forEach((c, i) => set(c, GONDOLA[i]));
  };
  const big = P.lotsU >= 5 && P.lotsV >= 4;
  for (let i = 0; i < P.lotsU; i++) for (let j = 0; j < P.lotsV; j++) {
    const lu = i * PITCH + ROAD, lv = j * PITCH + ROAD, n = i * 16 + j;
    for (const [cu, cv] of [[lu, lv], [lu + LOT - 1, lv + LOT - 1]]) {
      posts.push([cu, G + 1, cv], [cu, G + 2, cv], [cu, G + 3, cv]);
      lamps.push([cu, G + 4, cv]);
    }
    if (big && i < 2 && j < 2) {
      if (i === 0 && j === 0) stadium(lu, lv);
      continue;
    }
    if (big && i === P.lotsU - 1 && j === 1) {
      wheel(lu, lv);
      continue;
    }
    const r = rnd(n, 9);
    if (j <= (P.lotsV >= 6 ? 1 : 0) && r < 0.75) houses(lu, lv, n);
    else if (r < 0.14 || !big && i === 1 && j === 0 || big && i === Math.floor(P.lotsU / 2) && j === Math.floor(P.lotsV / 2)) park(lu, lv, n);
    else {
      const tall = j === P.lotsV - 1 ? 34 + Math.floor(rnd(n, 10) * 32) : 14 + Math.floor(rnd(n, 10) * (j >= 2 ? 30 : 18));
      tower(lu, lv, 11 + 2 * Math.floor(rnd(n, 11) * 4), 11 + 2 * Math.floor(rnd(n, 12) * 4), 2 + 4 * Math.round(tall / 4), n);
    }
  }
  for (let u = 4; u < L.cityU; u += 12) {
    posts.push([u, G + 1, L.vProm + 4], [u, G + 2, L.vProm + 4], [u, G + 3, L.vProm + 4]);
    lamps.push([u, G + 4, L.vProm + 4]);
  }
  set(posts, "minecraft:nether_brick_fence");
  set(lamps, LIGHT);
  set(lights, LIGHT);
  for (let k = 0; k < P.people; k++) {
    const i = Math.floor(rnd(k, 40) * (P.lotsU + 1)), j = Math.floor(rnd(k, 41) * (P.lotsV + 1));
    const along = rnd(k, 42) < 0.5;
    ops.push({ k: "mob", id: CIVILIAN, at: along ? [i * PITCH + 1 + k % 2 * 4, G + 1, 2 + Math.floor(rnd(k, 43) * (L.cityV - 4))] : [2 + Math.floor(rnd(k, 44) * (L.cityU - 4)), G + 1, j * PITCH + 1 + k % 2 * 4] });
  }
  const strip = (v0, v1, y, top2) => {
    fill(L.uMin, y - 6, v0, L.uMax, y - 3, v1, SANDSTONE);
    fill(L.uMin, y - 2, v0, L.uMax, y, v1, top2);
    if (y < SEA) fill(L.uMin, y + 1, v0, L.uMax, SEA, v1, WATER);
    fill(L.uMin, Math.max(y, SEA) + 1, v0, L.uMax, G + 40, v1, AIR);
  };
  const rows = (v0, n, yA, yB, top2) => {
    let from = 0, y = yA;
    for (let k = 1; k <= n; k++) {
      const yk = k === n ? NaN : Math.round(yA + (yB - yA) * (k / (n - 1)));
      if (yk !== y) {
        strip(v0 + from, v0 + k - 1, y, top2);
        from = k;
        y = yk;
      }
    }
  };
  rows(L.vBeach, 32, G, SEA - 2, SAND);
  rows(L.vShal, 20, SEA - 2, SEA - 9, SAND);
  fill(Math.floor(L.cityU / 2) - 1, G, L.vBeach, Math.floor(L.cityU / 2) + 1, G, L.vShal + 14, "minecraft:spruce_planks");
  const F = P.floor, u0 = L.uS0, u1 = L.uS1;
  fill(u0 - 2, F - 2, L.vDrop, u0 - 1, SEA - 9, L.vEnd + 2, ABYSS);
  fill(u1 + 1, F - 2, L.vDrop, u1 + 2, SEA - 9, L.vEnd + 2, ABYSS);
  fill(u0, F - 2, L.vEnd + 1, u1, SEA - 9, L.vEnd + 2, ABYSS);
  fill(u0, F - 2, L.vDrop, u1, F, L.vEnd, ABYSS);
  for (let k = 0; k < 20; k++) {
    const y = Math.round(SEA - 9 + (F - (SEA - 9)) * ((k + 1) / 20));
    fill(u0, F + 1, L.vDrop + k, u1, y, L.vDrop + k, ABYSS);
    fill(u0, y + 1, L.vDrop + k, u1, SEA, L.vDrop + k, WATER);
  }
  fill(u0, F + 1, L.vTr, u1, SEA, L.vEnd, WATER);
  fill(u0 - 2, SEA + 1, L.vDrop, u1 + 2, G + 40, L.vEnd + 2, AIR);
  const pu = u0 + u1 >> 1, pv = L.vTr + L.vEnd >> 1, pr = Math.min(17, Math.floor(Math.min(P.trenchU, P.trenchV) / 2) - 6), PF = -57;
  fill(pu - pr - 1, PF - 1, pv - pr - 1, pu + pr + 1, F, pv + pr + 1, ABYSS);
  fill(pu - pr, PF + 1, pv - pr, pu + pr, F, pv + pr, WATER);
  const gate = [], gateLit = [], gr = Math.min(8, pr - 3);
  for (let a = 20; a < 340; a += 5) {
    const p = [pu + Math.round(gr * Math.sin(a * Math.PI / 180)), PF + 1 + gr - Math.round(gr * Math.cos(a * Math.PI / 180)), pv];
    (a % 60 < 6 ? gateLit : gate).push(p);
  }
  set(gate, "minecraft:crying_obsidian");
  set(gateLit, LANTERN);
  fill(pu - 2, PF, pv - 2, pu + 2, PF, pv + 2, TRINITITE_BLOCK);
  const vents = [], lit = [];
  const nVent = Math.round(P.trenchU * P.trenchV / 1400), tu = P.trenchU - 8, tv = P.trenchV - 8;
  for (let k = 0; k < nVent; k++) {
    const u = u0 + 4 + Math.floor(rnd(k, 20) * tu), v = L.vTr + 4 + Math.floor(rnd(k, 21) * tv);
    if (Math.abs(u - pu) <= pr + 2 && Math.abs(v - pv) <= pr + 2) continue;
    const h = 1 + Math.floor(rnd(k, 22) * 8);
    fill(u, F + 1, v, u + 1, F + h, v + 1, ABYSS);
    vents.push([u, F + h + 1, v], [u + 1, F + h + 1, v + 1]);
  }
  set(vents, VENT);
  const nSpire = Math.max(2, Math.round(P.trenchU / 34));
  for (let k = 0; k < nSpire; k++) {
    const u = u0 + 8 + Math.floor(rnd(k, 30) * (P.trenchU - 16)), v = L.vTr + 6 + Math.floor(rnd(k, 31) * (P.trenchV - 12));
    if (Math.abs(u - pu) <= pr + 3 && Math.abs(v - pv) <= pr + 3) continue;
    const h = 24 + Math.floor(rnd(k, 32) * 36);
    fill(u - 1, F + 1, v - 1, u + 1, F + Math.floor(h / 3), v + 1, ABYSS);
    fill(u, F + 1, v, u, F + h, v, ABYSS);
    for (let y = F + 8; y <= F + h; y += 8) lit.push([u, y, v]);
  }
  const ru = u0 + Math.floor(P.trenchU * 0.24), nRib = Math.max(2, Math.min(6, Math.floor((P.trenchV - 12) / 13))), half = Math.min(14, Math.floor(P.trenchU * 0.2));
  const ribs = [];
  for (let r = 0; r < nRib; r++) {
    const v = L.vTr + 8 + r * 13;
    for (let du = -half; du <= half; du++) {
      const y = F + 1 + Math.round(22 * (1 - du / half * (du / half)));
      const y2 = F + 1 + Math.round(22 * (1 - (du + (du < 0 ? 1 : -1)) / half * ((du + (du < 0 ? 1 : -1)) / half)));
      for (let yy = Math.min(y, y2); yy <= Math.max(y, y2); yy++) ribs.push([ru + du, yy, v], [ru + du, yy, v + 1]);
    }
  }
  set(ribs, BONE);
  fill(ru - 1, F + 22, L.vTr + 6, ru + 1, F + 24, L.vTr + 10 + (nRib - 1) * 13, BONE);
  const qu = u1 - Math.floor(P.trenchU * 0.22), qv = L.vTr + 6;
  fill(qu - 4, F + 1, qv - 4, qu + 4, F + 1, qv + 4, "minecraft:prismarine_bricks");
  for (const [du, dv] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) fill(qu + du, F + 2, qv + dv, qu + du, F + 6, qv + dv, "minecraft:dark_prismarine");
  fill(qu - 4, F + 7, qv - 4, qu + 4, F + 7, qv - 4, "minecraft:prismarine_bricks");
  fill(qu - 4, F + 7, qv + 4, qu + 4, F + 7, qv + 4, "minecraft:prismarine_bricks");
  lit.push([qu - 4, F + 8, qv - 4], [qu + 4, F + 8, qv + 4], [pu - pr, F + 1, pv - pr], [pu + pr, F + 1, pv + pr], [pu - pr, F + 1, pv + pr], [pu + pr, F + 1, pv - pr]);
  set(lit, LANTERN);
  ops.push({ k: "chest", at: [qu, F + 2, qv], items: [[LANCE_ITEM, 1], [SHARD_ITEM, 12], [IODINE_ITEM, 8], ["minecraft:diamond", 3], ["minecraft:heart_of_the_sea", 1]] });
  return ops;
}
var AREA = "bk_city";
var BUILD = { volume: 6e3, pieces: 20, ms: 4 };
var AREAS = { chunks: 10, slots: 8, settle: 40 };
function byGround(ops) {
  const out = [];
  for (const op of ops) {
    if (op.k !== "set" || op.at.length < 2) {
      out.push(op);
      continue;
    }
    const cells = /* @__PURE__ */ new Map();
    for (const q of op.at) {
      const key = `${Math.floor(q[0] / 16)},${Math.floor(q[2] / 16)}`;
      const list = cells.get(key);
      if (list) list.push(q);
      else cells.set(key, [q]);
    }
    for (const at3 of cells.values()) out.push({ ...op, at: at3 });
  }
  return out;
}
var Build = class {
  constructor(S, dim) {
    this.S = S;
    this.dim = dim;
    this.held = false;
    this.waited = 0;
    /** The site cut into areas the game will hold, which of them each of our areas holds now, and when one last moved. */
    this.tiles = [];
    this.holding = /* @__PURE__ */ new Map();
    this.moved = -1e9;
    this.ticks = 0;
    /** The last quarter of the work that was announced. */
    this.told = 0;
    /** Everything before this is done (so a tick does not walk the whole plan to find its work). */
    this.first = 0;
    this.failed = 0;
    this.ops = byGround(plan(S));
    this.done = new Uint8Array(this.ops.length);
    this.first = Math.max(0, Math.min(this.ops.length, S.from ?? 0));
    this.done.fill(1, 0, this.first);
    this.left = this.ops.length - this.first;
  }
  get finished() {
    return this.left <= 0;
  }
  get progress() {
    return 1 - this.left / Math.max(1, this.ops.length);
  }
  /** The tiles: the site's chunks, cut into rectangles of at most AREAS.chunks a side. */
  cut() {
    const L = layout(planOf(this.S));
    const a = toWorld2(this.S, L.uMin - 2, 0, -2), b = toWorld2(this.S, L.uMax + 2, 0, L.vEnd + 4);
    const cx0 = Math.floor(Math.min(a.x, b.x) / 16), cx1 = Math.floor(Math.max(a.x, b.x) / 16);
    const cz0 = Math.floor(Math.min(a.z, b.z) / 16), cz1 = Math.floor(Math.max(a.z, b.z) / 16);
    const out = [];
    for (let cx = cx0; cx <= cx1; cx += AREAS.chunks) for (let cz = cz0; cz <= cz1; cz += AREAS.chunks) {
      out.push({ x0: cx * 16, z0: cz * 16, x1: Math.min(cx1, cx + AREAS.chunks - 1) * 16 + 15, z1: Math.min(cz1, cz + AREAS.chunks - 1) * 16 + 15 });
    }
    return out;
  }
  unhold(slot) {
    try {
      this.dim.runCommand(`tickingarea remove ${AREA}_${slot}`);
    } catch {
    }
    this.holding.delete(slot);
  }
  /** Point one of our areas at a rectangle.  False if the game would not have it (the world's ten are taken, or not allowed). */
  place(slot, t) {
    this.unhold(slot);
    try {
      const r = this.dim.runCommand(`tickingarea add ${t.x0} 0 ${t.z0} ${t.x1} 0 ${t.z1} ${AREA}_${slot}`);
      if (r && typeof r.successCount === "number" && r.successCount < 1) return false;
    } catch {
      return false;
    }
    this.holding.set(slot, t);
    return true;
  }
  /** Ask the game to keep the site loaded while it is built: every tile at once if it will (a full city is six). */
  hold() {
    if (this.held) return;
    this.held = true;
    this.tiles = this.cut();
    for (let k = 0; k < AREAS.slots; k++) this.unhold(k);
    for (let k = 0; k < Math.min(AREAS.slots, this.tiles.length); k++) if (!this.place(k, this.tiles[k])) break;
    this.moved = this.ticks;
  }
  /**
   * The work is waiting on ground nobody holds (the game gave fewer areas than there are tiles): move the area we have
   * held longest onto the ground that work stands on (centred on it, so a piece that straddles two tiles is wholly
   * inside), and give it time to load before moving any again.
   */
  follow(b) {
    if (this.ticks - this.moved < AREAS.settle) return;
    const cx0 = Math.floor(b.lo.x / 16), cx1 = Math.floor(b.hi.x / 16), cz0 = Math.floor(b.lo.z / 16), cz1 = Math.floor(b.hi.z / 16);
    const inside = (t2) => t2.x0 <= cx0 * 16 && t2.x1 >= cx1 * 16 + 15 && t2.z0 <= cz0 * 16 && t2.z1 >= cz1 * 16 + 15;
    if ([...this.holding.values()].some(inside)) return;
    const n = AREAS.chunks;
    const from = (a, z) => a - Math.max(0, Math.floor((n - (z - a + 1)) / 2));
    const ax = from(cx0, cx1), az = from(cz0, cz1);
    const t = { x0: ax * 16, z0: az * 16, x1: (ax + n - 1) * 16 + 15, z1: (az + n - 1) * 16 + 15 };
    this.moved = this.ticks;
    const ours = [...this.holding.keys()];
    const slot = ours.length ? ours[0] : 0;
    this.place(slot, t);
  }
  release() {
    if (!this.held) return;
    this.held = false;
    for (let k = 0; k < AREAS.slots; k++) this.unhold(k);
  }
  /** How many areas the game is holding for it, and how many chunks the largest is (for the test report). */
  get areas() {
    const size = (t) => (t.x1 - t.x0 + 1) / 16 * ((t.z1 - t.z0 + 1) / 16);
    return { held: this.holding.size, tiles: this.tiles.length, chunks: Math.max(0, ...this.tiles.map(size), ...[...this.holding.values()].map(size)) };
  }
  box(op) {
    const pts = op.k === "fill" ? [op.a, op.b] : op.k === "set" ? op.at : [op.at];
    const lo = { x: 1e9, y: 1e9, z: 1e9 }, hi = { x: -1e9, y: -1e9, z: -1e9 };
    for (const [u, y, v] of pts) {
      const w = toWorld2(this.S, u, y, v);
      lo.x = Math.min(lo.x, w.x);
      lo.y = Math.min(lo.y, w.y);
      lo.z = Math.min(lo.z, w.z);
      hi.x = Math.max(hi.x, w.x);
      hi.y = Math.max(hi.y, w.y);
      hi.z = Math.max(hi.z, w.z);
    }
    return { lo, hi };
  }
  /**
   * A tick's worth, kept small enough that nobody feels it: boxes in order up to a few thousand blocks, two dozen
   * pieces and a few milliseconds of the script's time; a box whose ground is not loaded waits, and so does
   * everything over the same ground.  (A city is millions of blocks: it is raised over a minute or two, not at once.)
   */
  tick() {
    this.ticks++;
    this.hold();
    let volume = 0, small = 0, any = false;
    const started = Date.now();
    const blocked = [];
    for (let i = this.first; i < this.ops.length && volume < BUILD.volume && small < BUILD.pieces && blocked.length < 12 && Date.now() - started < BUILD.ms; i++) {
      if (this.done[i]) continue;
      const op = this.ops[i], b = this.box(op);
      if (blocked.some((q) => b.lo.x <= q.hi.x && b.hi.x >= q.lo.x && b.lo.z <= q.hi.z && b.hi.z >= q.lo.z)) continue;
      if (!isLoaded(this.dim, b.lo) || !isLoaded(this.dim, b.hi) || !isLoaded(this.dim, { x: b.lo.x, y: 0, z: b.hi.z }) || !isLoaded(this.dim, { x: b.hi.x, y: 0, z: b.lo.z })) {
        blocked.push(b);
        continue;
      }
      const cost = op.k === "fill" ? (b.hi.x - b.lo.x + 1) * (b.hi.y - b.lo.y + 1) * (b.hi.z - b.lo.z + 1) : op.k === "set" ? op.at.length * 20 : 0;
      if (small > 0 && volume + cost > BUILD.volume) break;
      try {
        if (op.k === "fill") {
          const same = op.id === AIR ? [AIR] : op.id === WATER ? [WATER, "minecraft:flowing_water"] : void 0;
          this.dim.fillBlocks(new BlockVolume3(b.lo, b.hi), op.id, same ? { ignoreChunkBoundErrors: true, blockFilter: { excludeTypes: same } } : { ignoreChunkBoundErrors: true });
          volume += (b.hi.x - b.lo.x + 1) * (b.hi.y - b.lo.y + 1) * (b.hi.z - b.lo.z + 1);
        } else if (op.k === "set") {
          for (const [u, y, v] of op.at) {
            const at3 = blockAt(this.dim, toWorld2(this.S, u, y, v));
            if (at3) at3.setType(op.id);
          }
          volume += op.at.length * 20;
        } else if (op.k === "mob") {
          const w = toWorld2(this.S, op.at[0], op.at[1], op.at[2]);
          this.dim.spawnEntity(op.id, { x: w.x + 0.5, y: w.y, z: w.z + 0.5 });
        } else {
          const at3 = blockAt(this.dim, toWorld2(this.S, op.at[0], op.at[1], op.at[2]));
          if (at3) {
            at3.setType("minecraft:chest");
            const box = at3.getComponent("minecraft:inventory")?.container;
            if (box) op.items.forEach(([id, n], slot) => {
              try {
                box.setItem(slot * 2 + 3, new ItemStack(id, n));
              } catch {
              }
            });
          }
        }
      } catch {
        this.failed++;
      }
      this.done[i] = 1;
      this.left--;
      small++;
      any = true;
    }
    while (this.first < this.ops.length && this.done[this.first]) this.first++;
    if (this.ticks % 100 === 0 && this.S.from !== this.first) {
      this.S.from = this.first;
      store.touch();
    }
    this.waited = any ? 0 : this.waited + 1;
    if (!any && blocked.length) this.follow(blocked[0]);
  }
  /** Nothing could be done for a long while: the ground is not loading (the plan stays, and is taken up again when someone is near). */
  get stalled() {
    return this.waited > 60 * TICKS.second;
  }
};
var building = null;
var cities = () => store.rec.cities ??= [];
function occupied(dim, S) {
  const L = layout(planOf(S));
  let found = 0;
  for (let u = 0; u < L.cityU; u += 32) for (let v = 0; v < L.vShal; v += 32) {
    const a = toWorld2(S, u, S.y - 2, v), b = toWorld2(S, Math.min(L.cityU - 1, u + 31), S.y + 30, Math.min(L.vShal - 1, v + 31));
    if (!isLoaded(dim, a) || !isLoaded(dim, b)) continue;
    try {
      const lo = { x: Math.min(a.x, b.x), y: a.y, z: Math.min(a.z, b.z) }, hi = { x: Math.max(a.x, b.x), y: b.y, z: Math.max(a.z, b.z) };
      for (const _ of dim.getBlocks(new BlockVolume3(lo, hi), { includeTypes: BUILT }, true).getBlockLocationIterator()) {
        if (++found > 6) return true;
      }
    } catch {
    }
  }
  return false;
}
function raiseCity(at3, dir, small = false, force = true) {
  if (building) return `A city is still being built (${Math.round(building.progress * 100)}%). One at a time.`;
  const list = cities();
  if (list.length >= 8) return "There are eight cities in this world already.";
  const P = small ? SMALL : FULL, L = layout(P);
  const y = Math.max(SEA + 1, Math.min(82, Math.floor(at3.y) - 1));
  const S = { x: 0, y, z: 0, dir, small: small || void 0, done: false, t: store.rec.clock };
  const o = toWorld2(S, -L.cityU / 2, 0, -(L.vProm + 3));
  S.x = Math.floor(at3.x + o.x);
  S.z = Math.floor(at3.z + o.z);
  const dim = overworld();
  if (!force && occupied(dim, S)) return "Something is built there already: no city is raised over it.";
  list.push(S);
  store.touch();
  building = new Build(S, dim);
  return `A city is rising: ${L.cityU} by ${L.cityV} blocks of streets behind the promenade, a beach in front of it, and a sea cut ${SEA - P.floor} blocks deep beyond.`;
}
function nearestCity(at3) {
  let best = null;
  for (const S of cities()) {
    const m = landmarks(S), d = Math.hypot(m.centre.x - at3.x, m.centre.z - at3.z);
    if (!best || d < best.distance) best = { site: S, centre: m.centre, distance: d, radius: m.radius };
  }
  return best;
}
function seekCoast(dim, p) {
  let at3;
  try {
    at3 = p.location;
  } catch {
    return null;
  }
  const near = nearestCity(at3);
  if (near && near.distance < 900) return null;
  if (hash(Math.floor(at3.x / 640), Math.floor(at3.z / 640), 5) > 0.55) return null;
  const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];
  for (let k = 0; k < 4; k++) {
    const [dx, dz] = DIRS[k];
    let land = -1;
    for (let s = 8; s <= 72; s += 8) {
      const x = at3.x + dx * s, z = at3.z + dz * s;
      if (!isLoaded(dim, { x, y: 64, z })) break;
      const col = waterColumn(dim, x, z, SEA, 6, 40);
      if (col === UNLOADED) break;
      if (col === NONE) {
        const g = groundY(dim, x, z, 90, 40);
        if (typeof g === "number" && g >= SEA && g <= SEA + 10) land = s;
        else land = -1;
        continue;
      }
      if (land < 0 || col.surface - col.floor < 3) continue;
      const far = waterColumn(dim, at3.x + dx * (s + 16), at3.z + dz * (s + 16), SEA, 6, 60);
      if (far === NONE || far === UNLOADED || far.surface - far.floor < 6) break;
      let biome = "";
      try {
        biome = dim.getBiome({ x, y: SEA, z }).id;
      } catch {
        biome = "ocean";
      }
      if (!/ocean|beach|coast/.test(biome)) break;
      const said = raiseCity({ x: at3.x + dx * (s - 26), y: SEA + 2, z: at3.z + dz * (s - 26) }, k, false, false);
      return /rising/.test(said) ? said : null;
    }
  }
  return null;
}
function cityTick(now) {
  if (building) {
    building.tick();
    const quarter = Math.floor(building.progress * 4);
    if (!building.finished && quarter > building.told) {
      building.told = quarter;
      const m = landmarks(building.S);
      for (const p of players()) {
        try {
          if (p.dimension.id === OVERWORLD && dist(p.location, m.centre) < 400) p.sendMessage(`§7[Basiliskra] The city is ${quarter * 25}% built.`);
        } catch {
        }
      }
    }
    if (building.finished) {
      building.S.done = true;
      store.touch();
      const m = landmarks(building.S);
      for (const p of players()) {
        try {
          if (p.dimension.id === OVERWORLD && dist(p.location, m.centre) < 400) p.sendMessage(`§7[Basiliskra] The city stands. Its beach is ${compass(p.location, m.beach)}; the deep water is beyond it.`);
        } catch {
        }
      }
      building.release();
      building = null;
    } else if (building.stalled) {
      building.release();
      building = null;
    }
    return;
  }
  if (now % 100 !== 50) return;
  const dim = overworld();
  const open = cities().find((S) => !S.done && players().some((p) => {
    try {
      return p.dimension.id === OVERWORLD && dist(p.location, landmarks(S).centre) < 160;
    } catch {
      return false;
    }
  }));
  if (open) {
    building = new Build(open, dim);
    return;
  }
  if (!CONFIG.cities || cities().length >= 6) return;
  for (const p of players()) {
    try {
      if (p.dimension.id !== OVERWORLD) continue;
      const said = seekCoast(dim, p);
      if (said) {
        p.sendMessage(`§7[Basiliskra] ${said}`);
        return;
      }
    } catch {
    }
  }
}
function compass(from, to) {
  const a = Math.atan2(-(to.x - from.x), to.z - from.z) * 180 / Math.PI;
  const d = Math.round(Math.hypot(to.x - from.x, to.z - from.z));
  return `${d} blocks ${["south", "south-west", "west", "north-west", "north", "north-east", "east", "south-east"][(Math.round(a / 45) % 8 + 8) % 8]}`;
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
var STORY_DAYS = [0, 2, 2, 3];
var changeTicks = (form) => CONFIG.changeMinutes > 0 ? CONFIG.changeMinutes * TICKS.minute : pace((STORY_DAYS[form] ?? 3) * TICKS.day);
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
var IDLE_ACTS = /* @__PURE__ */ new Set(["roam", "raze", "pursue", "wander", "patrol", "sleep", "harbor", "well", "lure", "echo"]);
var sensed = /* @__PURE__ */ new Map();
function settlementNear(c, now) {
  let best = null, bd = 1e9;
  const city = nearestCity(c.pos);
  if (city && city.distance < 500) {
    best = city.centre;
    bd = city.distance;
  }
  let s = sensed.get(c.entity.id);
  if (!s || now - s.t >= 100) {
    s = { at: null, t: now };
    try {
      let nd = 1e9;
      for (const e of [
        ...c.dim.getEntities({ type: "minecraft:villager_v2", location: c.pos, maxDistance: 180 }),
        ...c.dim.getEntities({ type: CIVILIAN, location: c.pos, maxDistance: 180 })
      ]) {
        const d = dist(e.location, c.pos);
        if (d < nd) {
          nd = d;
          s.at = { ...e.location };
        }
      }
    } catch {
    }
    sensed.set(c.entity.id, s);
    if (sensed.size > 8) sensed.clear();
  }
  if (s.at && dist(s.at, c.pos) < bd) best = s.at;
  return best;
}
var VOICED = /* @__PURE__ */ new Set(["idle", "move", "look", "drink", "pin", "flinch", "beach", "carry"]);
var lastFault = "";
var Brain = class {
  /** `own`: a record of this body's own (a Titan's).  Without one, the story's record. */
  constructor(c, own) {
    this.c = c;
    this.own = own;
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
    return this.own ?? store.rec;
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
  /** Has he been in this form as long as a form lasts?  (Time is all a change waits on.) */
  changeDue() {
    const rec = this.rec;
    return this.c.form < 4 && !rec.evolve && !rec.ending?.step && this.now - rec.mut.formSince >= changeTicks(this.c.form);
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
    c.airborne = false;
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
    const r = hash(now, 72);
    if (c.form === 5) {
      c.say(r < 0.6 ? "basiliskra.vathrok.huff" : "basiliskra.vathrok.growl", c.anchor("nose"), 96, 0.95, 0.94 + 0.12 * hash(now, 73));
      return;
    }
    const tag = ["", "i", "ii", "iii", "iii"][c.form];
    const id = c.form === 1 ? r < 0.75 ? "i.grunt" : "i.breath" : r < 0.6 ? `${tag}.grunt` : r < 0.85 ? `${tag}.breath` : `${tag}.growl`;
    const pitch = (c.form === 1 ? 0.9 : c.form === 2 ? 1.15 : c.form === 4 ? 0.84 : 0.96) * (0.96 + 0.08 * hash(now, 73));
    c.say(`basiliskra.${id}`, c.anchor("nose"), c.form >= 3 ? 80 : 64, 0.95, pitch);
  }
  tick() {
    this.voice();
    if (this.forced) {
      const f = this.forced;
      this.forced = null;
      this.begin(f);
    }
    if (this.act && IDLE_ACTS.has(this.actName) && this.changeDue()) this.finish();
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
function check(r, key, at3) {
  const p = CONFIG.pacing;
  if (r.a * p < THRESHOLD.animals || r.h * p < THRESHOLD.habitat || (r.a + r.h) * p < THRESHOLD.total) return null;
  let guilty = null, top2 = 0;
  for (const [id, s] of Object.entries(r.by)) if (s > top2) {
    top2 = s;
    guilty = id;
  }
  let site = at3;
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
function recordKill(at3, typeId, playerId, playerName, now) {
  const call = ANIMALS[typeId];
  if (!call) return null;
  const r = region(at3, now);
  const w = Math.min(1, Math.max(0.15, r.ra / 2));
  r.ra += 1;
  r.a += w;
  r.n = (r.n ?? 0) + 1;
  tally(playerId, 0);
  credit(r, playerId, playerName, w);
  const site = { x: Math.floor(at3.x), y: Math.floor(at3.y), z: Math.floor(at3.z), s: call, t: now };
  r.sites.push(site);
  if (r.sites.length > MAX_SITES) r.sites.shift();
  const all = store.rec.sites;
  all.push(site);
  if (all.length > MAX_GLOBAL_SITES) all.shift();
  store.touch();
  store.touchHarm();
  return check(r, keyOf(at3), at3);
}
function recordHabitat(at3, typeId, playerId, playerName, now) {
  const base = habitatWeight(typeId);
  if (base <= 0) return null;
  const r = region(at3, now);
  const w = base * Math.min(1, Math.max(0.3, r.rh / 2));
  r.rh += base * 2.2;
  r.h += w;
  if (base >= 0.2) {
    r.l = (r.l ?? 0) + 1;
    tally(playerId, 1);
  }
  credit(r, playerId, playerName, w);
  store.touchHarm();
  return check(r, keyOf(at3), at3);
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
function angerAt(at3, now) {
  const k = keyOf(at3);
  const r = store.harm.regions[k];
  return report(k, r ? peek(r, now) : void 0);
}
function angerNear(at3, now) {
  const regs = store.harm.regions;
  const ix = Math.floor(at3.x / REGION), iz = Math.floor(at3.z / REGION);
  let best = angerAt(at3, now);
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

// src/titan.ts
import { ItemStack as ItemStack2, world as world9 } from "@minecraft/server";

// src/forms/four.ts
import { EntityDamageCause as EntityDamageCause9, MolangVariableMap as MolangVariableMap4, world as world8 } from "@minecraft/server";

// src/pour.ts
import { EntityDamageCause as EntityDamageCause7 } from "@minecraft/server";

// src/roar.ts
import { EntityDamageCause as EntityDamageCause6, MolangVariableMap as MolangVariableMap3 } from "@minecraft/server";
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
    const vars2 = new MolangVariableMap3();
    vars2.setFloat("variable.reach", reach);
    const at3 = { x: center.x, y: center.y + 0.4, z: center.z };
    particle(c.dim, "basiliskra:roar_wave", at3, reach + 64, vars2);
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
        e.applyDamage(Math.max(1, Math.round(this.power * 2 * (0.35 + 0.65 * f))), { cause: EntityDamageCause6.entityAttack, damagingEntity: c.entity });
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

// src/pour.ts
var POUR = { smoke: 42, lift: 20 };
var REAR_PITCH = -68;
var SLAM_PITCH = 72;
var CHARGE_KILLS = 30;
var freshPour = () => ({ down: null, origin: null, heading: 0 });
function groundAhead(c, target) {
  const m = c.anchor("mouth");
  const h = norm({ x: target.x - c.pos.x, y: 0, z: target.z - c.pos.z });
  const along = Math.min(Math.hypot(target.x - m.x, target.z - m.z), c.girth * 1.2 + 4 + Math.max(0, m.y - c.pos.y) * 0.45);
  const x = m.x + h.x * along, z = m.z + h.z * along;
  const g = isLoaded(c.dim, { x, y: c.pos.y, z }) ? groundY(c.dim, x, z, c.pos.y + 8, 40) : null;
  return { x, y: (typeof g === "number" ? g : c.pos.y - 1) + 0.6, z };
}
var floodReach = (spec) => spec.width * 10;
var easeOut = (k) => 1 - (1 - k) * (1 - k);
var smooth = (k) => k * k * (3 - 2 * k);
function pourTick(c, spec, ps, t, n, aimAt, scorch) {
  if (!ps.down) ps.down = groundAhead(c, aimAt());
  c.trackTo(ps.down, 3, 80, 80);
  const { from, dir } = c.aim();
  const length = clearRange(c, from, dir, 90);
  const hit = add(from, mul(dir, length));
  if (!ps.origin) {
    ps.origin = hit;
    ps.heading = yawTo(c.pos, ps.down);
    sound(c.dim, "random.fizz", hit, 160, 2, 0.4);
  }
  const reach = floodReach(spec);
  if (t < POUR.smoke) {
    if (t % 2 === 0) for (let k = 0; k < 3; k++) particle(c.dim, "basiliskra:soot_stream", add(from, mul(dir, length * k / 3)), 192, beamVars(dir, 1, spec.width));
    soot(c, spec, ps.origin, ps.heading, 5 + reach * 0.75 * easeOut((t + 1) / POUR.smoke), t);
    if (t % 10 === 0) sound(c.dim, "mob.blaze.breathe", from, 128, 1.6, 0.45);
  } else {
    if (t === POUR.smoke) {
      particle(c.dim, "basiliskra:impact_blast", ps.origin, 192);
      particle(c.dim, "basiliskra:impact_ring", ps.origin, 192);
      sound(c.dim, "mob.ghast.fireball", ps.origin, 192, 2, 0.5);
      flash(c.dim, ps.origin, 48, { red: 1, green: 0.35, blue: 0.2 }, 0.03, 0.05, 0.4);
      shake(c, 128, 0.8, 0.6);
    }
    for (let k = 0; k < 3; k++) particle(c.dim, "basiliskra:fire_stream", add(from, mul(dir, length * k / 3)), 192, beamVars(dir, 1, spec.width));
    if (t % 4 === 0) particle(c.dim, "basiliskra:impact_fire", hit, 160);
    flood(c, spec, ps.origin, ps.heading, reach * easeOut((t - POUR.smoke + 1) / Math.max(1, n - POUR.smoke)), t, scorch);
    if (t % 3 === 0) soot(c, spec, ps.origin, ps.heading, reach, t, 0.4);
  }
  if (t % 6 === 0) shake(c, 96, 0.35, 0.5);
  if (c.lethal > 0 && t % 10 === 0) killRound(c, spec);
}
function rearTick(c, spec, ps, t, n, mark) {
  c.lookPitch += clamp(REAR_PITCH - c.lookPitch, -7, 7);
  c.relook();
  c.lookYaw += clamp(clamp(wrapDeg(yawTo(c.pos, mark) - c.yaw), -45, 45) - c.lookYaw, -2, 2);
  const mouth = c.anchor("mouth");
  if (t % 3 === 0) particle(c.dim, "basiliskra:mouth_star", mouth, 192);
  if (t % 4 === 1) particle(c.dim, "basiliskra:impact_glare", mouth, 192);
  if (t % 6 === 0) sound(c.dim, "basiliskra.iii.charge_tick", mouth, 128, 0.8, 1.2 + t / n * 0.8);
  if (ps.origin && t % 2 === 0) flood(c, spec, ps.origin, ps.heading, floodReach(spec), 1e3 + t, () => {
  }, 0.45);
  if (t % 5 === 0) shake(c, 128, 0.3 + 0.5 * (t / n), 0.5);
  if (c.lethal > 0 && t % 10 === 0) killRound(c, spec);
}
function* slamAndLift(c, spec, ps, st, mark, scorch) {
  shake(c, 160, 1.1, 0.6);
  for (let t = 0; t < POUR.lift; t++) {
    const k = smooth((t + 1) / POUR.lift);
    const goal = mark();
    c.aimAt(goal, 80, 80);
    const ahead = clamp(wrapDeg(yawTo(c.pos, goal) - c.yaw), -80, 80);
    if (Math.abs(wrapDeg(c.lookYaw - ahead)) > 25) c.lookYaw = ahead;
    c.lookPitch += (Math.max(c.lookPitch, SLAM_PITCH) - c.lookPitch) * (1 - k);
    c.relook();
    beamTick(c, { ...spec, width: spec.width * (2 - k), damage: spec.damage * 0.3 }, t, 1, st, { scorch, clean: true });
    if (ps.origin && t % 3 === 0) flood(c, spec, ps.origin, ps.heading, floodReach(spec), 2e3 + t, scorch, 0.5);
    if (t % 8 === 0) shake(c, 96, 0.45, 0.5);
    yield;
  }
  st.ground = null;
}
function soot(c, spec, origin, heading, r, t, share = 1) {
  const dim = c.dim;
  const n = Math.round((t % 2 === 0 ? 6 : 2) * share);
  for (let i = 0; i < n; i++) {
    const a = (heading + (hash(c.tick, i, 61) - 0.5) * 110) * Math.PI / 180;
    const d = r * (i < n * 0.6 ? 0.7 + 0.3 * hash(c.tick, i, 62) : hash(c.tick, i, 63));
    const x = origin.x - Math.sin(a) * d, z = origin.z + Math.cos(a) * d;
    if (!isLoaded(dim, { x, y: origin.y, z })) continue;
    const g = groundY(dim, x, z, origin.y + 10, 24);
    if (typeof g !== "number") continue;
    const out = norm({ x: -Math.sin(a), y: 0, z: Math.cos(a) });
    particle(dim, "basiliskra:soot_billow", { x, y: g + 1.5, z }, 192, beamVars(out, 1, spec.width));
    if (i % 3 === 0) particle(dim, "basiliskra:soot_ember", { x, y: g + 1, z }, 128, beamVars(out, 1, spec.width));
  }
}
function flood(c, spec, origin, heading, r, t, scorch, share = 1) {
  const dim = c.dim;
  const n = Math.round((t % 2 === 0 ? 7 : 3) * share);
  for (let i = 0; i < n; i++) {
    const a = (heading + (hash(c.tick, i, 71) - 0.5) * 120) * Math.PI / 180;
    const d = r * (i < n * 0.65 ? 0.72 + 0.28 * hash(c.tick, i, 72) : hash(c.tick, i, 73));
    const x = origin.x - Math.sin(a) * d, z = origin.z + Math.cos(a) * d;
    if (!isLoaded(dim, { x, y: origin.y, z })) continue;
    const g = groundY(dim, x, z, origin.y + 10, 24);
    if (typeof g !== "number") continue;
    const at3 = { x, y: g + 1.2, z };
    const out = norm({ x: -Math.sin(a), y: 0, z: Math.cos(a) });
    particle(dim, "basiliskra:flood_fire", at3, 192, beamVars(out, 1, spec.width));
    if (i % 3 === 0) particle(dim, "basiliskra:flood_ember", at3, 128, beamVars(out, 1, spec.width));
    if (i === 0 && t % 4 === 0) particle(dim, "basiliskra:flood_smoke", { ...at3, y: at3.y + 2 }, 192, beamVars(out, 1, spec.width));
    if (CONFIG.terrain !== "none" && i < 2 && t % 2 === 0) {
      scorch({ x, y: g, z });
      const above = blockAt(dim, { x, y: g + 1, z }), under = blockAt(dim, { x, y: g, z });
      if (above && above.isAir && under && isSolidBlock(under) && (wither() || isNaturalGround(under.typeId)) && hash(c.tick, i, 74) < 0.5) {
        try {
          above.setType("minecraft:fire");
        } catch {
        }
      }
    }
  }
  if (t % 4 !== 0) return;
  const eye = { x: origin.x, y: origin.y + 1.5, z: origin.z };
  const near = (p) => {
    const d = dist({ x: p.x, y: origin.y, z: p.z }, origin);
    if (d > r + 1.5 || Math.abs(p.y - origin.y) > 6) return false;
    if (d >= 4) {
      const b = Math.atan2(-(p.x - origin.x), p.z - origin.z) * 180 / Math.PI;
      if (Math.abs(wrapDeg(b - heading)) > 18) return false;
    }
    return clearLine(dim, eye, { x: p.x, y: p.y + 1, z: p.z });
  };
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id || !targetable(p) || !near(p.location)) continue;
      c.hurt(p, spec.damage * 0.6, EntityDamageCause7.fire);
      p.setOnFire(4, true);
    } catch {
    }
  }
  for (const e of mobsNear(dim, origin, r + 2)) {
    try {
      if (!near(e.location)) continue;
      e.applyDamage(c.mobHit(spec.damage), { cause: EntityDamageCause7.fire, damagingEntity: c.entity });
      e.setOnFire(6, true);
    } catch {
    }
  }
}
function killRound(c, spec) {
  const r = CHARGE_KILLS + c.girth;
  for (const p of players()) {
    try {
      if (p.dimension.id !== c.dim.id || !targetable(p) || dist(p.location, c.pos) > r) continue;
      c.hurt(p, spec.damage, EntityDamageCause7.fire);
    } catch {
    }
  }
  for (const e of mobsNear(c.dim, c.pos, r)) {
    try {
      e.applyDamage(c.lethal, { cause: EntityDamageCause7.fire, damagingEntity: c.entity });
    } catch {
    }
  }
}

// src/forms/three.ts
import { EntityDamageCause as EntityDamageCause8, world as world7 } from "@minecraft/server";
var CHARGE_TICKS = 137;
var PLANT_TICKS = 14;
var LIGHT_END = 112;
var FIRE_FULL = 141;
var FIRE_FADE = 14;
var TIERS = {
  // (width: the breath as drawn, in proportion to his mouth, which stands 3.7 blocks open when he fires)
  1: { range: 40, radius: 1.9, damage: 5, width: 2.5, carve: 2 },
  2: { range: 60, radius: 1.6, damage: 7, width: 2.8, carve: 2.6 },
  3: { range: 76, radius: 1.4, damage: 9, width: 3, carve: 3.1 }
};
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
  const g = giantOf(e);
  if (g) return g.middle();
  try {
    return e.getHeadLocation();
  } catch {
    return e.location;
  }
}
var FLYERS = /* @__PURE__ */ new Set([
  "minecraft:ender_dragon",
  "minecraft:wither",
  "minecraft:ghast",
  "minecraft:happy_ghast",
  "minecraft:phantom",
  "minecraft:blaze",
  "minecraft:vex",
  "minecraft:breeze",
  "minecraft:bee",
  "minecraft:parrot",
  "minecraft:bat",
  "minecraft:allay"
]);
function isFlyer(e) {
  try {
    if (FLYERS.has(e.typeId)) return true;
    if (isPlayer(e)) return e.isGliding || e.isFlying;
    return false;
  } catch {
    return false;
  }
}
function aimOf(e, lead = 4) {
  let at3 = headOf(e);
  try {
    if (e.typeId === "minecraft:ender_dragon" || e.typeId === "minecraft:ghast" || e.typeId === "minecraft:happy_ghast") at3 = { x: e.location.x, y: e.location.y + 2, z: e.location.z };
    if (isFlyer(e)) {
      const v = e.getVelocity();
      at3 = { x: at3.x + v.x * lead, y: at3.y + v.y * lead, z: at3.z + v.z * lead };
    }
  } catch {
  }
  return at3;
}
function standOff(c, e, player, other) {
  const g = giantOf(e);
  return g ? c.girth + g.girth + 6 : isPlayer(e) ? player : other;
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
    /** His footfall and his grunt (Vathrok, which walks as he does, has its own). */
    this.voices = { step: "basiliskra.iii.step", grunt: "basiliskra.iii.grunt" };
    /** From how far he knows of another giant. */
    this.giantSight = 160;
    this.foreign = [];
    this.foreignAt = -999;
    /** To a village or a city, and then through it from one side to the other, and again: what he walks through is gone. */
    // ---- another giant (2.3) ----------------------------------------------------------------------------------------
    // Asked for: "when Basiliskra is fighting against another kaiju have it build distance to shoot lazerbeams by
    // jumping back as well but gets closer to attack melee way".  Too close to breathe, with his breath ready: he leaps
    // back over the ground and breathes as he lands.  His breath not ready: he goes in and uses his body.  Between the
    // two, with a clear line: he breathes.  Form III fights with his jaws and his club; Form IV and the Titan with their
    // jaws and hand, their claws and their tail (four.ts).
    /** What his body does to another giant (Form IV and the Titan set their own). */
    this.blows = { bite: 60, tail: 90, lunge: 85, swipe: 100, ram: 110 };
    /** While his breath is at another giant (Form IV then keeps his head on it instead of turning on his club). */
    this.inDuel = false;
    this.bites = 0;
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
    const ours = otherGiants(this.c).filter((g) => dist(g.pos, this.c.pos) < this.giantSight).sort((a, b) => dist(a.pos, this.c.pos) - dist(b.pos, this.c.pos)).map((g) => g.entity);
    if (this.now - this.foreignAt >= 40) {
      this.foreignAt = this.now;
      this.foreign = foreignGiantsNear(this.c.dim, this.c.pos, this.giantSight);
    }
    const big = [...ours, ...this.foreign.filter(alive)];
    if (!CONFIG.huntMobs) return big;
    if (this.now - this.mobsAt >= 40) {
      this.mobsAt = this.now;
      this.mobs = mobsNear(this.c.dim, this.c.pos, this.c.form >= 4 ? 130 : 72);
    }
    return [...big, ...this.mobs.filter(alive)];
  }
  tier() {
    const b = this.rec.mut.beams;
    return b < 2 ? 1 : b < 5 ? 2 : 3;
  }
  choose() {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world7.getTimeOfDay();
    if (this.wantCharge) {
      this.wantCharge = false;
      return { name: "charge", run: this.beam(null), limit: 40 * TICKS.second };
    }
    if (!rec.evolve && !rec.ending?.step && now - rec.mut.formSince >= changeTicks(3)) {
      rec.evolve = { to: 4, step: 0, t0: now, at: { ...c.pos } };
      return { name: "evolve", run: wait(900), limit: 900 };
    }
    const near = nearbyPlayers(c, 90);
    if (rec.origin && rec.guilty && this.ready("remember") && distXZ(rec.origin, c.pos) < 90) {
      const g = near.find((p) => p.id === rec.guilty);
      if (g) {
        this.rest("remember", TICKS.day);
        return { name: "remember", run: this.remember(g), limit: 100 * TICKS.second };
      }
    }
    const k = this.kaiju();
    if (k) {
      const ch = this.duel(k);
      if (ch) return ch;
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
    const town = settlementNear(c, now);
    if (town) return { name: "raze", run: this.raze(town), limit: 150 * TICKS.second };
    return { name: "roam", run: this.roam(), limit: 80 * TICKS.second };
  }
  /** The giant he is fighting, if one is near: the nearest of ours, else another add-on's monster. */
  kaiju() {
    const c = this.c;
    let best = null, bd = this.giantSight;
    for (const g of otherGiants(c)) {
      const d = dist(g.pos, c.pos);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    if (best) return { g: best, e: best.entity };
    if (this.now - this.foreignAt >= 40) {
      this.foreignAt = this.now;
      this.foreign = foreignGiantsNear(c.dim, c.pos, this.giantSight);
    }
    const f = this.foreign.filter(alive).sort((a, b) => dist(a.location, c.pos) - dist(b.location, c.pos))[0];
    return f ? { g: null, e: f } : null;
  }
  foeAt(f) {
    try {
      return f.g && f.g.valid ? f.g.pos : f.e.location;
    } catch {
      return this.c.pos;
    }
  }
  foeMiddle(f) {
    try {
      return f.g && f.g.valid ? f.g.middle() : headOf(f.e);
    } catch {
      return this.c.pos;
    }
  }
  foeAlive(f) {
    try {
      return f.g ? f.g.valid && f.g.dim.id === this.c.dim.id : f.e.isValid && f.e.dimension.id === this.c.dim.id;
    } catch {
      return false;
    }
  }
  /** How far his breath reaches (Form IV and the Titan reach further). */
  breathRange() {
    return TIERS[this.tier()].range - 2;
  }
  /** His breath at another giant (Form IV and the Titan breathe their own). */
  duelBreath(e) {
    return this.beam(e);
  }
  /** How far back he leaps, and how high (blocks). */
  leapReach() {
    return { far: 22, high: 6 };
  }
  duel(f) {
    const c = this.c, now = this.now;
    const at3 = this.foeAt(f);
    const d = distXZ(at3, c.pos), reach = c.girth + (f.g ? f.g.girth : 4);
    const bearing = wrapDeg(yawTo(c.pos, at3) - c.yaw);
    const breathReady = this.ready("beam") && now >= this.recoverUntil;
    if (f.e.id !== this.lastQuarry) {
      this.lastQuarry = f.e.id;
      if (this.ready("lockroar")) {
        this.rest("lockroar", 50 * TICKS.second);
        return { name: "lock", run: this.duelChallenge(f), limit: 16 * TICKS.second };
      }
    }
    if (d < reach + 16) {
      if (breathReady && this.ready("leap")) {
        this.rest("leap", 14 * TICKS.second);
        this.rest("beam", 28 * TICKS.second);
        return { name: "leap", run: this.leapAndBreathe(f), limit: 60 * TICKS.second };
      }
      const m = this.duelMelee(f, d, reach, bearing);
      if (m) return m;
      return { name: "square", run: this.duelSquare(f), limit: 2 * TICKS.second };
    }
    if (breathReady && d < this.breathRange() && clearLine(c.dim, c.anchor("mouth"), this.foeMiddle(f))) {
      this.rest("beam", 28 * TICKS.second);
      return { name: "beam", run: this.breatheAt(f), limit: 90 * TICKS.second };
    }
    return { name: "close", run: this.duelClose(f), limit: 20 * TICKS.second };
  }
  /** Form III, at close quarters: the club for what is beside or behind him, the jaws for what is in front. */
  duelMelee(f, _d, _reach, bearing) {
    if (Math.abs(bearing) > 60 && this.ready("tail")) {
      this.rest("tail", 7 * TICKS.second);
      this.bites = 0;
      return { name: "tail", run: this.duelClub(bearing >= 0 ? 1 : -1, f), limit: 4 * TICKS.second };
    }
    if (this.bites >= 2 && this.ready("tail")) {
      this.rest("tail", 7 * TICKS.second);
      this.bites = 0;
      const side = hash(this.now, 71) < 0.5 ? 1 : -1;
      return { name: "tail", run: this.wheelAndClub(f, side), limit: 7 * TICKS.second };
    }
    if (this.ready("bite")) {
      this.rest("bite", 4 * TICKS.second);
      this.bites++;
      return { name: "bite", run: this.duelBite(f), limit: 5 * TICKS.second };
    }
    return null;
  }
  /** A quick turn on the spot that brings what he is fighting round to one side of him, then the club. */
  *wheelAndClub(f, side) {
    const c = this.c;
    c.halt();
    c.setPhase("move");
    for (let t = 0; t < 40 && this.foeAlive(f); t++) {
      const want = wrapDeg(yawTo(c.pos, this.foeAt(f)) - 80 * side);
      if (Math.abs(wrapDeg(want - c.yaw)) < 4) break;
      c.yaw = turnTowards(c.yaw, want, 3.5);
      c.lookYaw = clamp(wrapDeg(yawTo(c.pos, this.foeAt(f)) - c.yaw), -70, 70);
      if (t % 8 === 4) {
        const feet = this.shuffleFeet();
        sound(c.dim, "basiliskra.iii.step", c.anchor(feet[(t >> 3) % feet.length]), 96, 0.8, 0.95);
      }
      yield;
    }
    if (!this.foeAlive(f)) return;
    yield* this.duelClub(side, f);
  }
  *duelChallenge(f) {
    const c = this.c;
    c.halt();
    yield* this.face(this.foeAt(f), 60);
    c.lookAt(this.foeMiddle(f), 85, 35);
    yield* this.roar(false);
  }
  *duelSquare(f) {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 14 && this.foeAlive(f); t++) {
      c.yaw = turnTowards(c.yaw, yawTo(c.pos, this.foeAt(f)), 2.5);
      c.lookAt(this.foeMiddle(f), 70, 40);
      yield;
    }
  }
  /** In to arm's length (his breath is not ready): whatever is underfoot is trodden. */
  *duelClose(f) {
    const c = this.c;
    c.smash = true;
    for (let t = 0; t < 400 && this.foeAlive(f); t++) {
      const at3 = this.foeAt(f), reach = c.girth + (f.g ? f.g.girth : 4) + 8;
      c.setPhase("move");
      c.goTo(at3, 0.2, reach);
      c.lookAt(this.foeMiddle(f), 60, 30);
      this.footfalls();
      if (distXZ(at3, c.pos) < reach + 1 || c.blocked > 60) break;
      yield;
    }
    c.halt();
    c.smash = false;
    c.setPhase("idle");
  }
  /** Where a blow lands: the noise of it, the shake, the ground under it. */
  duelImpact(at3, big) {
    const c = this.c;
    sound(c.dim, "random.explode", at3, 160, 1.6, big ? 0.5 : 0.62);
    sound(c.dim, "basiliskra.iii.step", at3, 160, 1, 0.5);
    particle(c.dim, "basiliskra:impact_blast", at3, 160);
    particle(c.dim, "basiliskra:impact_debris", at3, 128);
    particle(c.dim, "basiliskra:impact_ring", { x: at3.x, y: c.pos.y + 0.4, z: at3.z }, 160);
    particle(c.dim, "minecraft:huge_explosion_emitter", at3, 160);
    shake(c, 128, big ? 1.2 : 0.8, 0.5);
  }
  /** Form III's jaws: his head drawn back, then thrown forward with his weight behind it (the client: phase `bite`). */
  *duelBite(f) {
    const c = this.c;
    c.halt();
    yield* this.face(this.foeAt(f), 24);
    c.lookAhead();
    c.setPhase("bite");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.85);
    for (let t = 0; t < 25; t++) {
      if (t === 9) {
        const front = add(c.pos, mul(c.forward, c.girth + 8));
        for (const g of otherGiants(c)) {
          if (distXZ(g.pos, c.pos) > c.girth + g.girth + 14 || Math.abs(wrapDeg(yawTo(c.pos, g.pos) - c.yaw)) > 60) continue;
          g.takeBlow(c, this.blows.bite, true);
          g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, 4);
          this.duelImpact(c.anchor("mouth"), false);
        }
        if (!f.g && this.foeAlive(f) && distXZ(f.e.location, front) < c.girth + 12) {
          try {
            f.e.applyDamage(c.mobHit(this.blows.bite), { cause: EntityDamageCause8.entityAttack, damagingEntity: c.entity });
          } catch {
          }
        }
        blast(c.dim, front, 8, 12, c.mobHit(26), 1.3, (p, n) => c.hurt(p, n), c.entity, c.pos);
      }
      yield;
    }
    c.setPhase("idle");
  }
  /** Form III's club: his tail winds away, then swings round to the side his head has turned to (phase `sweep`). */
  *duelClub(side, f) {
    const c = this.c;
    c.halt();
    c.lookYaw = 70 * side;
    c.lookPitch = 0;
    c.setPhase("sweep");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.78);
    for (let t = 0; t < 36; t++) {
      c.lookYaw = 70 * side;
      if (t === 11) sound(c.dim, "basiliskra.iii.club_swing", c.anchor("club_core"), 160, 1, 0.9);
      if (t === 15) {
        let struck = false;
        for (const g of otherGiants(c)) {
          const b = wrapDeg(yawTo(c.pos, g.pos) - c.yaw) * side;
          if (b < 35 || distXZ(g.pos, c.pos) > c.girth + g.girth + 24) continue;
          g.takeBlow(c, this.blows.tail, true);
          g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, 7);
          this.duelImpact({ x: (g.pos.x + c.pos.x) / 2, y: c.pos.y + 8, z: (g.pos.z + c.pos.z) / 2 }, true);
          struck = true;
        }
        if (f && !f.g && this.foeAlive(f)) {
          const at3 = f.e.location, b = wrapDeg(yawTo(c.pos, at3) - c.yaw) * side;
          if (b >= 35 && distXZ(at3, c.pos) <= c.girth + 28) {
            try {
              f.e.applyDamage(c.mobHit(this.blows.tail), { cause: EntityDamageCause8.entityAttack, damagingEntity: c.entity });
            } catch {
            }
            this.duelImpact({ x: (at3.x + c.pos.x) / 2, y: c.pos.y + 8, z: (at3.z + c.pos.z) / 2 }, true);
            struck = true;
          }
        }
        for (const deg of [65, 105, 145]) {
          const fw = { x: -Math.sin((c.yaw + deg * side) * Math.PI / 180), y: 0, z: Math.cos((c.yaw + deg * side) * Math.PI / 180) };
          const at3 = { x: c.pos.x + fw.x * 20, y: c.pos.y + 1.5, z: c.pos.z + fw.z * 20 };
          if (!isLoaded(c.dim, at3)) continue;
          blast(c.dim, at3, 9, 14, c.mobHit(30), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
          if (wither()) carve(c.dim, at3, 3.6, 120, false);
          particle(c.dim, "basiliskra:step_dust", at3, 128);
        }
        sound(c.dim, "basiliskra.iii.club_plant", c.anchor("club_core"), 160, 1, 1.2);
        if (!struck) shake(c, 96, 0.5, 0.4);
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
  }
  /**
   * He leaps back from what he is fighting, to have room to breathe at it: a crouch; off the ground and back over it
   * (from 0.35 s to 1.15 s, the client draws the same), still facing it; the landing, which the ground feels.  He comes
   * down on open, loaded ground near his own height, as far back as there is such ground (at least half his leap).
   * Returns false, having done nothing, if there is none.
   */
  *leapBack(f) {
    const c = this.c;
    const { far, high } = this.leapReach();
    const from = this.foeAt(f);
    const away = norm({ x: c.pos.x - from.x, y: 0, z: c.pos.z - from.z });
    let land = null;
    for (let k = far; k >= far * 0.5; k -= 2) {
      const x = c.pos.x + away.x * k, z = c.pos.z + away.z * k;
      if (!isLoaded(c.dim, { x, y: c.pos.y, z })) continue;
      const g = groundY(c.dim, x, z, c.pos.y + 12, 28);
      if (typeof g !== "number" || Math.abs(g - c.pos.y) > 10) continue;
      land = { x, y: g, z };
      break;
    }
    if (!land) return false;
    const start = { ...c.pos };
    c.halt();
    c.setPhase("leap");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.8);
    for (let t = 0; t < 7; t++) {
      c.lookAt(this.foeMiddle(f), 70, 40);
      yield;
    }
    sound(c.dim, "basiliskra.iii.step", start, 160, 1, 0.6);
    particle(c.dim, "basiliskra:step_dust", start, 128);
    shake(c, 128, 0.7, 0.4);
    c.airborne = true;
    try {
      const n = 16;
      for (let t = 0; t < n; t++) {
        const u = (t + 1) / n, s = u * u * (3 - 2 * u);
        c.pos = { x: start.x + (land.x - start.x) * s, y: start.y + (land.y - start.y) * s + high * Math.sin(Math.PI * u), z: start.z + (land.z - start.z) * s };
        if (this.foeAlive(f)) {
          c.yaw = turnTowards(c.yaw, yawTo(c.pos, this.foeAt(f)), 2);
          c.lookAt(this.foeMiddle(f), 70, 40);
        }
        yield;
      }
    } finally {
      c.airborne = false;
    }
    c.pos = { ...land };
    sound(c.dim, "basiliskra.iii.step", land, 192, 1, 0.5);
    sound(c.dim, "random.explode", land, 160, 1.2, 0.6);
    particle(c.dim, "basiliskra:impact_ring", { x: land.x, y: land.y + 0.4, z: land.z }, 192);
    particle(c.dim, "basiliskra:step_dust", land, 160);
    particle(c.dim, "basiliskra:impact_debris", land, 128);
    shake(c, 160, 1.1, 0.6);
    blast(c.dim, land, 4 * c.scale, 10, c.mobHit(20), 1.2, (p, n) => c.hurt(p, n), c.entity, land);
    if (wither()) c.stompWave(14, 4, 34);
    for (let t = 0; t < 7; t++) yield;
    c.setPhase("idle");
    return true;
  }
  /** Back, then his breath at it as he lands (if he could not leap, he breathes where he stands). */
  *leapAndBreathe(f) {
    yield* this.leapBack(f);
    if (!this.foeAlive(f)) return;
    yield* this.breatheAt(f);
  }
  /** How long, from the end of one breath at another giant, until the next: the time he spends fighting it with his body. */
  breathGap() {
    return 22 * TICKS.second;
  }
  /** His breath at another giant; the wait for the next is counted from the end of this one, so he goes in between. */
  *breatheAt(f) {
    this.inDuel = true;
    try {
      yield* this.duelBreath(f.e);
    } finally {
      this.inDuel = false;
      this.rest("beam", this.breathGap());
      this.rest("leap", this.breathGap());
    }
  }
  *raze(town) {
    const c = this.c;
    for (let leg = 0; leg < 4; leg++) {
      const there = distXZ(c.pos, town) < 60;
      const a = hash(this.now, leg, 51) * Math.PI * 2, r = there ? 22 + 34 * hash(this.now, leg, 52) : 12 * hash(this.now, leg, 53);
      const got = yield* this.walk({ x: town.x + Math.cos(a) * r, y: town.y, z: town.z + Math.sin(a) * r }, this.c.form === 4 ? 0.16 : 0.14, 9, 1500);
      if (!got) break;
      if (nearbyPlayers(c, 80).length || this.creatures().length) break;
      if (leg % 2 === 1 && there) c.say("basiliskra.iii.growl", c.anchor("nose"), 96, 1, 0.9);
    }
    c.setPhase("idle");
    yield* wait(30);
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
    sound(c.dim, this.voices.step, foot, 112, 1, 0.86 + (this.beat & 3) * 0.03);
    const ground = { x: foot.x, y: c.pos.y + 0.1, z: foot.z };
    particle(c.dim, "basiliskra:step_dust", ground, 72);
    for (const p of witnesses(c.dim, foot, 40)) {
      const f = 1 - dist(p.location, foot) / 40;
      try {
        p.runCommand(`camerashake add @s ${(0.06 + 0.16 * f).toFixed(2)} 0.25 positional`);
      } catch {
      }
    }
    blast(c.dim, ground, 2.2 * c.scale, 6, 14 * c.might, 0.9, (p, n) => c.hurt(p, n), c.entity, ground);
    if (c.smash && wither()) c.stompWave(14, 4, 34);
    if (!CONFIG.marks) return;
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const at3 = { x: Math.floor(foot.x) + dx, y: Math.floor(c.pos.y - 0.5), z: Math.floor(foot.z) + dz };
      const b = takesMark(c.dim, at3);
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
    const c = this.c, head2 = p.getHeadLocation();
    let roof = false;
    for (let y = 1; y <= 7 && !roof; y++) roof = isSolidBlock(blockAt(c.dim, { x: head2.x, y: head2.y + y, z: head2.z }));
    if (!roof) return false;
    let walls = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let r = 1; r <= 7; r++) if (isSolidBlock(blockAt(c.dim, { x: head2.x + dx * r, y: head2.y, z: head2.z + dz * r }))) {
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
    const c = this.c, head2 = p.getHeadLocation();
    const toHim = norm({ x: c.pos.x - head2.x, y: 0, z: c.pos.z - head2.z });
    const glassy = (x, y, z) => /glass|iron_bars/.test(idAt(c.dim, { x, y, z }) ?? "");
    let best = toHim, score = -2, reach = 3, pane = add(head2, mul(toHim, 3));
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, d = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      let open = false, at3 = 3, mid = add(head2, mul(d, 3));
      for (let r = 1; r <= 9; r++) {
        const q = { x: head2.x + d.x * r, y: head2.y, z: head2.z + d.z * r };
        const b = blockAt(c.dim, q);
        if (!b) break;
        if (/glass|iron_bars|fence_gate/.test(b.typeId)) {
          const bx = Math.floor(q.x), by = Math.floor(q.y), bz = Math.floor(q.z);
          const along = Math.abs(d.x) >= Math.abs(d.z) ? { x: 0, z: 1 } : { x: 1, z: 0 };
          let lo = 0, hi = 0;
          while (lo > -3 && glassy(bx + along.x * (lo - 1), by, bz + along.z * (lo - 1))) lo--;
          while (hi < 3 && glassy(bx + along.x * (hi + 1), by, bz + along.z * (hi + 1))) hi++;
          mid = { x: bx + 0.5 + along.x * (lo + hi) / 2, y: head2.y, z: bz + 0.5 + along.z * (lo + hi) / 2 };
          open = true;
          at3 = r;
          break;
        }
        if (isSolidBlock(b)) break;
        if (r === 9) open = true;
      }
      if (open && dot(d, toHim) > score) {
        score = dot(d, toHim);
        best = d;
        reach = at3;
        pane = mid;
      }
    }
    return { dir: best, reach, pane };
  }
  /** Turn where he stands: the feet shuffle round, one planted at a time. */
  /** The feet he shuffles on when he turns on the spot (Form IV and the Titan stand on two). */
  shuffleFeet() {
    return FEET;
  }
  *face(target, limit = 400) {
    const c = this.c;
    c.setPhase("move");
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, target);
      if (Math.abs(wrapDeg(want - c.yaw)) < 2) break;
      c.yaw = turnTowards(c.yaw, want, 1.1);
      if (t % 18 === 9) {
        const feet = this.shuffleFeet();
        const foot = c.anchor(feet[Math.floor(t / 18) % feet.length]);
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
      let at3;
      try {
        if (!g.isValid || g.dimension.id !== c.dim.id || player && !targetable(g)) break;
        at3 = g.location;
      } catch {
        break;
      }
      c.setPhase("move");
      const keep = standOff(c, g, 17 * c.scale * 0.6, 3);
      if (t === 0 && dist(at3, c.pos) < keep + 1) {
        yield* this.watch(g, 30);
        break;
      }
      c.goTo(at3, 0.15, keep);
      c.lookAt(headOf(g), 60, 25);
      this.footfalls();
      if (dist(at3, c.pos) < keep + 1) break;
      if (t % 100 === 50) c.say(this.voices.grunt, c.anchor("nose"), 72, 1, 0.92 + hash(t) * 0.1);
      yield;
    }
    c.halt();
    c.smash = false;
  }
  /** Already as near as he means to come: he stands and watches it for a moment. */
  *watch(g, ticks) {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < ticks; t++) {
      try {
        if (!g.isValid || g.dimension.id !== c.dim.id) break;
        c.lookAt(headOf(g), 70, 40);
      } catch {
        break;
      }
      yield;
    }
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
    const top2 = { x: rod.x + 0.5, y: rod.y + 1, z: rod.z + 0.5 };
    let tip = c.anchor("spike_tip_0"), bd = 1e9;
    for (let k = 0; k < 12; k++) {
      const s = c.anchor(`spike_tip_${k}`);
      const d = dist(s, top2);
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
    sound(c.dim, "basiliskra.iii.ground", top2, 96);
    const steps = Math.max(4, Math.ceil(dist(tip, top2) * 1.6));
    for (let t = 0; t < 50; t++) {
      if (t < 14 && t % 2 === 0) {
        for (let i = 0; i <= steps; i++) {
          const k = i / steps;
          const j = i === 0 || i === steps ? 0 : 0.7;
          particle(c.dim, "basiliskra:arc_seg", {
            x: tip.x + (top2.x - tip.x) * k + (hash(t, i, 1) - 0.5) * j,
            y: tip.y + (top2.y - tip.y) * k + (hash(t, i, 2) - 0.5) * j,
            z: tip.z + (top2.z - tip.z) * k + (hash(t, i, 3) - 0.5) * j
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
    const flying2 = !!target && isFlyer(target);
    const aimAt = () => target ? aimOf(target) : add(c.anchor("mouth"), mul(c.forward, 30));
    const pitchMax = flying2 ? 80 : 40;
    const pour = !flying2;
    const ps = freshPour();
    const charging = () => pour ? groundAhead(c, aimAt()) : aimAt();
    const chargeMax = pour ? 80 : pitchMax;
    const spec = { ...T, fallout: [0, 3, 4, 5][tier], rough: tier === 1 };
    c.halt();
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 112);
    c.say("basiliskra.iii.charge", c.anchor("throat"), 128);
    this.chargeSounding = true;
    this.rodSeen.clear();
    this.rodLayer = 0;
    for (let t = 0; t < PLANT_TICKS; t++) {
      c.setCharge(t / 7);
      if (ok()) c.trackTo(charging(), 3, 80, chargeMax);
      this.scanRods();
      yield;
    }
    let rod = null;
    let lit = 1;
    const light = LIGHT_END - PLANT_TICKS;
    if (pour) c.setPhase("pour");
    for (let t = 0; t < light; t++) {
      if (!ok()) return;
      const aim = aimAt();
      let off;
      if (pour) {
        pourTick(c, spec, ps, t, light, aimAt, (hit) => this.scorch(hit));
        off = Math.abs(c.lookYaw) > 70 ? 1 : 0;
      } else off = c.aimAt(aim, 80, pitchMax);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), flying2 ? 1.4 : 0.6);
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
    const mark = aimAt();
    if (pour) c.setPhase("rear");
    for (let t = 0; t < lock; t++) {
      c.setCharge(16 + t / lock * 2);
      if (pour) rearTick(c, spec, ps, t, lock, mark);
      if (flying2 && ok()) c.trackTo(aimAt(), 4, 80, 80);
      if (t % 2 === 0) {
        const { from, dir: d0 } = c.aim();
        const dir = pour ? norm(sub(aimAt(), from)) : d0;
        particle(c.dim, "basiliskra:beam_aim", from, 128, beamVars(dir, clearRange(c, from, dir, T.range), 0.22 + 0.5 * (t / lock)));
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
      particle(c.dim, "basiliskra:muzzle_flash", from, 160, beamVars(dir, 1, TIERS[this.tier()].width));
      particle(c.dim, "basiliskra:muzzle_shock", from, 160, beamVars(dir, 1, TIERS[this.tier()].width));
      flash(c.dim, from, 56, { red: 1, green: 0.5, blue: 0.42 }, 0.03, 0.04, 0.3);
      shake(c, 96, 0.9, 0.5);
    }
    const st = { ground: null };
    if (pour) yield* slamAndLift(c, spec, ps, st, () => mark, (hit) => this.scorch(hit));
    for (let t = pour ? POUR.lift : 0; t < FIRE_FULL + FIRE_FADE; t++) {
      const fade = t < FIRE_FULL ? 1 : 1 - (t - FIRE_FULL) / FIRE_FADE;
      if (flying2 && target && ok() && (!isPlayer(target) || targetable(target))) {
        c.trackTo(aimOf(target), tier === 1 ? 2.2 : 3.2, 80, 80);
      } else if (tier >= 2 && target && ok() && (!isPlayer(target) || targetable(target))) {
        const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
        const rate = tier === 2 ? 0.22 : 0.3;
        c.lookYaw += clamp(want - c.lookYaw, -rate, rate);
      } else if (tier === 1) c.lookYaw = clamp(c.lookYaw + Math.sin(t * 0.09) * 0.12, -80, 80);
      if (!(tier === 1 && t % 17 >= 14)) beamTick(c, spec, t, fade, st, { scorch: (hit) => this.scorch(hit) });
      if (t % 10 === 0) shake(c, 64, 0.32 * fade + 0.08, 0.6);
      yield;
    }
    yield* this.vent();
    yield* this.roar(tier === 3 && hash(this.now, 61) < 0.3);
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
    yield* wait(40);
  }
  /** Mark what the beam touched.  Natural ground only; never a block with an inventory, a bed, a portal or redstone. */
  scorch(at3) {
    if (CONFIG.terrain === "none") return;
    const c = this.c;
    const hit = blockAt(c.dim, at3);
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
      const x = Math.floor(at3.x) + dx, y = Math.floor(at3.y) + dy, z = Math.floor(at3.z) + dz;
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

// src/forms/four.ts
var SPEC = { range: 150, radius: 2.4, damage: 11, width: 4, carve: 3.8, fallout: 6 };
var THIN = { range: 60, radius: 1, damage: 5, width: 0.55, carve: 1.2, fallout: 2 };
var BEAM_MIN2 = 18;
var FEET2 = ["foot_l", "foot_r"];
var VEINS = [0, 1, 2, 3].flatMap((k) => [`wing_vein_l${k}`, `wing_vein_r${k}`]);
var HALF = STRIDE_IV / 2;
var FIRE = 155;
var SKID_AT = 30;
var LIFT_AT = 55;
var SWEEP_AT = 79;
var SWEEP_END = 129;
var PULSE_TICKS = 100;
var PLATE_REACH = 70;
var PLATE_SHOTS = 3;
var BrainFour = class extends BrainThree {
  constructor(c, own) {
    super(c, own);
    this.lastFailed = false;
    this.heading = -1;
    /** His breath (the Titan's is its own). */
    this.spec = SPEC;
    /**
     * He charges, following `aimAt` with his eye until the lock.  Returns "lock" when the charge is whole,
     * "cover" if the quarry got something solid between them while he was still following (see the swallow), and
     * "gone" if there is nothing left to fire at.
     */
    /** What the breath being drawn has poured and where it means to go (1.9): its charge sets them, its shot uses them. */
    this.ps = freshPour();
    this.markAt = null;
    c.set(PROP.tier, 3);
    c.set(PROP.gill, !!this.four().plate);
  }
  four() {
    return this.rec.four ??= { debut: false, shots: 0, plate: null };
  }
  tier() {
    return 3;
  }
  onFinish() {
    super.onFinish();
    this.c.bendHold = 0;
    this.c.wade = false;
  }
  /** What is close enough in front of him to swipe at: the nearest player he can hurt, creature or other giant. */
  withinClaw() {
    const c = this.c, reach = c.girth + 18;
    const inFront = (p, extra = 0) => distXZ(p, c.pos) <= reach + extra && Math.abs(wrapDeg(yawTo(c.pos, p) - c.yaw)) <= 80 && Math.abs(p.y - c.pos.y) < 40;
    for (const g of otherGiants(c)) if (inFront(g.pos, g.girth)) return { at: () => g.middle(), giant: g };
    for (const p of nearbyPlayers(c, reach + 4)) if (targetable(p) && inFront(p.location)) return { at: () => p.location, giant: null };
    for (const e of this.creatures()) {
      try {
        if (inFront(e.location)) return { at: () => e.location, giant: null };
      } catch {
      }
    }
    return null;
  }
  /** Walking at something, or across the world, and something comes within reach of his claws: he swipes at it. */
  interrupt() {
    if (this.now % 5 !== 2 || !["pursue", "roam", "raze", "wander"].includes(this.actName) || !this.ready("swipe") || this.now < this.recoverUntil) return null;
    const hit = this.withinClaw();
    if (!hit) return null;
    this.rest("swipe", 5 * TICKS.second);
    return { name: "swipe", run: this.swipe(hit.at, hit.giant), limit: 4 * TICKS.second };
  }
  choose() {
    const c = this.c, now = this.now, F = this.four();
    if (this.wantCharge) {
      this.wantCharge = false;
      return { name: "charge", run: this.beam(null), limit: 40 * TICKS.second };
    }
    if (!F.debut) return { name: "debut", run: this.debut(), limit: 60 * TICKS.second };
    const k = this.kaiju();
    if (k) {
      const ch = this.duel(k);
      if (ch) return ch;
    }
    const near = nearbyPlayers(c, 170);
    const mobs = this.creatures();
    if (!this.cooldown.has("rroar")) this.rest("rroar", (40 + 60 * hash(now, 91)) * TICKS.second);
    if (this.ready("rroar")) {
      this.rest("rroar", (70 + 120 * hash(now, 92)) * TICKS.second);
      if (hash(now, 93) < 0.6 && anyoneNear(c, 160)) return { name: "roar", run: this.roar(hash(now, 94) < 0.3), limit: 12 * TICKS.second };
    }
    if (now >= this.recoverUntil) {
      const eye = c.anchor("nose");
      if (this.ready("swipe")) {
        const hit = this.withinClaw();
        if (hit) {
          this.rest("swipe", 5 * TICKS.second);
          return { name: "swipe", run: this.swipe(hit.at, hit.giant), limit: 4 * TICKS.second };
        }
      }
      if (this.ready("stare")) {
        const p = near.find((q) => dist(q.location, c.pos) <= 130 && clearLine(c.dim, eye, headOf(q)));
        if (p) {
          this.rest("stare", (55 + 40 * hash(now, 95)) * TICKS.second);
          return { name: "stare", run: this.stare(p), limit: 14 * TICKS.second };
        }
      }
      if (this.ready("drag")) {
        const shore = this.shoreVictim(near);
        if (shore) {
          this.rest("drag", 4 * TICKS.minute);
          return { name: "drag", run: this.dragSeabed(shore), limit: 30 * TICKS.second };
        }
      }
      if (this.ready("beam")) {
        const mouth = c.anchor("mouth");
        for (const q of [...near, ...mobs]) {
          const d = dist(q.location, mouth);
          if (d < BEAM_MIN2 || d > this.spec.range - 6) continue;
          if (clearLine(c.dim, mouth, headOf(q))) {
            this.rest("beam", 24 * TICKS.second);
            return { name: "beam", run: this.breath(q), limit: 90 * TICKS.second };
          }
          if (isPlayer(q) && this.plateSees(q)) {
            this.rest("beam", 26 * TICKS.second);
            return { name: "beam", run: this.plateShot(q), limit: 45 * TICKS.second };
          }
        }
      }
    }
    const quarry = near.find((p) => dist(p.location, c.pos) < 110) ?? mobs.sort((x, y) => dist(x.location, c.pos) - dist(y.location, c.pos))[0];
    if (quarry) return { name: "pursue", run: this.pursue(quarry), limit: 20 * TICKS.second };
    const town = settlementNear(c, now);
    if (town) return { name: "raze", run: this.raze(town), limit: 150 * TICKS.second };
    return { name: "roam", run: this.roam(), limit: 90 * TICKS.second };
  }
  // ---- another giant (2.3) ----------------------------------------------------------------------------------------
  breathRange() {
    return this.spec.range - 6;
  }
  duelBreath(e) {
    return this.breath(e);
  }
  breathGap() {
    return 20 * TICKS.second;
  }
  shuffleFeet() {
    return FEET2;
  }
  leapReach() {
    return { far: 28, high: 8 };
  }
  /** At close quarters: the tail for what is beside or behind him, jaws and hand for what is in front, then the claws. */
  duelMelee(f, _d, _reach, bearing) {
    if (Math.abs(bearing) > 55 && this.ready("tail")) {
      this.rest("tail", 6 * TICKS.second);
      return { name: "tail", run: this.tail(bearing >= 0 ? 1 : -1), limit: 4 * TICKS.second };
    }
    if (this.ready("lunge")) {
      this.rest("lunge", 3.5 * TICKS.second);
      return { name: "lunge", run: this.lunge(f), limit: 5 * TICKS.second };
    }
    if (Math.abs(bearing) <= 60 && this.ready("swipe")) {
      this.rest("swipe", 6 * TICKS.second);
      return { name: "swipe", run: this.swipe(() => this.foeMiddle(f), f.g, this.blows.swipe), limit: 4 * TICKS.second };
    }
    return null;
  }
  /** Jaws and the right hand, thrown forward: whatever is in front of him and within his reach is struck (phase `bite`). */
  *lunge(f) {
    const c = this.c;
    c.halt();
    yield* this.turnTo(this.foeAt(f), 3, 24);
    c.lookAhead();
    c.setPhase("bite");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.78);
    for (let t = 0; t < 25; t++) {
      if (t === 9) {
        const fw = c.forward;
        const front = { x: c.pos.x + fw.x * (c.girth + 7), y: c.pos.y + 1, z: c.pos.z + fw.z * (c.girth + 7) };
        for (const g of otherGiants(c)) {
          if (distXZ(g.pos, c.pos) > c.girth + g.girth + 15 || Math.abs(wrapDeg(yawTo(c.pos, g.pos) - c.yaw)) > 60) continue;
          g.takeBlow(c, this.blows.lunge, true);
          g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, 5);
          this.duelImpact(add(c.pos, add(mul(fw, c.girth + 5), { x: 0, y: 26 * c.scale / 2, z: 0 })), false);
        }
        if (!f.g && this.foeAlive(f) && distXZ(f.e.location, front) < c.girth + 14) {
          try {
            f.e.applyDamage(c.mobHit(this.blows.lunge), { cause: EntityDamageCause9.entityAttack, damagingEntity: c.entity });
          } catch {
          }
        }
        blast(c.dim, front, 9, 10, c.mobHit(30), 1.4, (p, n) => c.hurt(p, n), c.entity, c.pos);
      }
      yield;
    }
    c.setPhase("idle");
  }
  /**
   * The tail: it winds away, then lashes round to the side his head has turned to (`side`: +1 the side his yaw grows
   * towards).  Everything on that side of him, from beside his shoulder round to behind him, is struck (phase `sweep`).
   */
  *tail(side) {
    const c = this.c;
    c.halt();
    c.lookYaw = 70 * side;
    c.lookPitch = 0;
    c.setPhase("sweep");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.7);
    for (let t = 0; t < 36; t++) {
      c.lookYaw = 70 * side;
      if (t === 13) sound(c.dim, "basiliskra.iii.club_plant", c.anchor("club_core"), 160, 1, 1.3);
      if (t === 15) {
        let struck = false;
        for (const g of otherGiants(c)) {
          const b = wrapDeg(yawTo(c.pos, g.pos) - c.yaw) * side;
          if (b < 35 || distXZ(g.pos, c.pos) > c.girth + g.girth + 28) continue;
          g.takeBlow(c, this.blows.tail, true);
          g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, 9);
          this.duelImpact({ x: (g.pos.x + c.pos.x) / 2, y: c.pos.y + 14, z: (g.pos.z + c.pos.z) / 2 }, true);
          struck = true;
        }
        for (const deg of [65, 105, 145]) {
          const a = (c.yaw + deg * side) * Math.PI / 180;
          const at3 = { x: c.pos.x - Math.sin(a) * 24, y: c.pos.y + 1.5, z: c.pos.z + Math.cos(a) * 24 };
          if (!isLoaded(c.dim, at3)) continue;
          blast(c.dim, at3, 10, 10, c.mobHit(34), 1.8, (p, n) => c.hurt(p, n), c.entity, c.pos);
          if (wither()) {
            const got = carve(c.dim, at3, 4.2, 140, false);
            if (got.broken > 10) particle(c.dim, "basiliskra:impact_debris", at3, 128);
          }
          particle(c.dim, "basiliskra:step_dust", at3, 128);
        }
        if (!struck) shake(c, 96, 0.5, 0.4);
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
  }
  // ---- the claws (1.8) ------------------------------------------------------------------------------------------
  /**
   * A swipe of the claws: the hand on the side of what he swipes at goes up and out, then tears across in front of
   * him.  Three great marks hang in the air where the claws went through it, three gouges are torn in the ground
   * under them, and whatever was in the way is struck and thrown.  `giant`: another giant in the way, if that is what
   * he swipes at (it takes `giantBlow`).
   */
  *swipe(at3, giant, giantBlow = 60) {
    const c = this.c;
    c.halt();
    const bearing = clamp(wrapDeg(yawTo(c.pos, at3()) - c.yaw), -70, 70);
    const side = bearing >= 0 ? 1 : -1;
    c.lookYaw = clamp(bearing * 0.6, -45, 45) || side * 6;
    c.lookPitch = -8;
    c.setPhase("swipe");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.82);
    for (let t = 0; t < 26; t++) {
      if (t === 8) sound(c.dim, "basiliskra.iii.club_swing", c.anchor(side > 0 ? "hand_l" : "hand_r"), 128, 1, 0.8);
      if (t === 12) this.tear(side, giant, giantBlow);
      yield;
    }
    c.setPhase("idle");
    yield* wait(6);
  }
  /** The moment the claws go through: the marks, the gouges, and the blow. */
  tear(side, giant, giantBlow) {
    const c = this.c, f = c.forward, l = leftOf(c.yaw);
    const reach = c.girth + 10, height = c.pos.y + (c.form === 4 ? 26 : 10) * (c.scale / 2);
    const size = this.spec.width * 2.4;
    for (let k = 0; k < 3; k++) {
      const a = (side * 55 - side * 45 * k) * Math.PI / 180;
      const dir = { x: f.x * Math.cos(a) + l.x * Math.sin(a), y: 0, z: f.z * Math.cos(a) + l.z * Math.sin(a) };
      const at3 = { x: c.pos.x + dir.x * reach, y: height - k * 3, z: c.pos.z + dir.z * reach };
      const v = new MolangVariableMap4();
      v.setFloat("variable.width", size);
      v.setFloat("variable.spin", side > 0 ? -28 + k * 6 : 208 - k * 6);
      particle(c.dim, "basiliskra:claw_scratch", at3, 192, v);
      if (k === 1) particle(c.dim, "basiliskra:claw_glow", at3, 192, v);
      particle(c.dim, "basiliskra:claw_sparks", at3, 160);
    }
    if (CONFIG.terrain !== "none") {
      const across = { x: -side * l.x, y: 0, z: -side * l.z };
      for (let g = -1; g <= 1; g++) {
        const off = mul(f, g * 3.2);
        for (let s = -9; s <= 9; s += 1.5) {
          const p = add(add(c.pos, mul(f, reach * 0.8)), add(off, mul(across, s)));
          if (!isLoaded(c.dim, p)) continue;
          const gy = groundY(c.dim, p.x, p.z, c.pos.y + 6, 14);
          if (typeof gy !== "number") continue;
          const q = { x: p.x, y: gy, z: p.z };
          if (wither()) carve(c.dim, q, 1.2, 12, true);
          else this.scorch(q);
        }
      }
      particle(c.dim, "basiliskra:impact_debris", add(c.pos, mul(f, reach * 0.8)), 160);
    }
    sound(c.dim, "basiliskra.iii.beam_impact", add(c.pos, mul(f, reach)), 160, 1, 1.4);
    shake(c, 96, 0.7, 0.5);
    const inArc = (p) => {
      const d = distXZ(p, c.pos);
      if (d > c.girth + 20 || Math.abs(p.y - c.pos.y) > 40) return false;
      return Math.abs(wrapDeg(yawTo(c.pos, p) - c.yaw)) <= 85;
    };
    for (const p of nearbyPlayers(c, c.girth + 22)) {
      try {
        if (!targetable(p) || !inArc(p.location)) continue;
        c.hurt(p, 26);
        const away = norm({ x: p.location.x - c.pos.x, y: 0, z: p.location.z - c.pos.z });
        p.applyKnockback({ x: away.x * 3.2, z: away.z * 3.2 }, 0.8);
      } catch {
      }
    }
    for (const e of mobsNear(c.dim, add(c.pos, mul(f, c.girth + 8)), c.girth + 14)) {
      try {
        if (!inArc(e.location)) continue;
        e.applyDamage(c.mobHit(30), { cause: EntityDamageCause9.entityAttack, damagingEntity: c.entity });
        const away = norm({ x: e.location.x - c.pos.x, y: 0, z: e.location.z - c.pos.z });
        e.applyKnockback({ x: away.x * 3, z: away.z * 3 }, 0.7);
      } catch {
      }
    }
    for (const g of otherGiants(c)) {
      if (g !== giant && !(distXZ(g.pos, c.pos) <= c.girth + g.girth + 18 && inArc(g.pos))) continue;
      g.takeBlow(c, giantBlow, true);
      g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, 2);
    }
  }
  // ---- two feet, and what is under them -----------------------------------------------------------------
  footfalls() {
    const c = this.c;
    c.walkPhase = ((this.beat - 1 & 1) + clamp((c.travelled - this.stepAt) / HALF, 0, 1.15)) * 180;
    if (c.travelled - this.stepAt < HALF) return;
    this.stepAt = c.travelled - this.stepAt < STRIDE_IV ? this.stepAt + HALF : c.travelled;
    const k = this.beat & 1;
    c.set(PROP.gait, k);
    const foot = add(c.anchor(FEET2[k]), mul(c.forward, HALF * 0.5));
    this.beat++;
    this.rec.mut.overland += HALF;
    this.stomp({ x: foot.x, y: c.pos.y + 0.1, z: foot.z });
  }
  /** One foot coming down: the ground under it is blown out, like the Wither's, and whatever stood there with it. */
  stomp(ground) {
    const c = this.c;
    sound(c.dim, "basiliskra.iii.step", ground, 128, 1, 0.66 + (this.beat & 1) * 0.04);
    particle(c.dim, "basiliskra:step_dust", ground, 96);
    particle(c.dim, "basiliskra:impact_ring", { x: ground.x, y: ground.y + 0.3, z: ground.z }, 128);
    for (const p of witnesses(c.dim, ground, 70)) {
      const f = 1 - dist(p.location, ground) / 70;
      try {
        p.runCommand(`camerashake add @s ${(0.08 + 0.3 * f).toFixed(2)} 0.3 positional`);
      } catch {
      }
    }
    blast(c.dim, ground, 8, 8, c.mobHit(20), 1.1, (p, n) => c.hurt(p, n), c.entity, ground);
    if (wither() && !c.afloat) {
      const P = this.rec.four?.plate;
      const r = P ? Math.min(4.2, Math.hypot(ground.x - P.x - 0.5, ground.z - P.z - 0.5) - 2) : 4.2;
      const got = r < 1.5 ? { broken: 0 } : carve(c.dim, { x: ground.x, y: ground.y - 0.6, z: ground.z }, r, 220, false);
      if (got.broken > 20) particle(c.dim, "basiliskra:impact_debris", { x: ground.x, y: ground.y + 1, z: ground.z }, 96);
      c.stompWave(22, 6, 70);
    }
  }
  *pursue(g) {
    const c = this.c;
    const player = isPlayer(g);
    c.smash = true;
    for (let t = 0; t < 380; t++) {
      let at3;
      try {
        if (!g.isValid || g.dimension.id !== c.dim.id || player && !targetable(g)) break;
        at3 = g.location;
      } catch {
        break;
      }
      c.setPhase("move");
      const keep = standOff(c, g, 26, 6);
      if (t === 0 && dist(at3, c.pos) < keep + 1) {
        yield* this.watch(g, 30);
        break;
      }
      c.goTo(at3, 0.17, keep);
      c.lookAt(headOf(g), 60, 40);
      this.footfalls();
      if (dist(at3, c.pos) < keep + 1) break;
      if (t % 100 === 50) c.say("basiliskra.iii.grunt", c.anchor("nose"), 72, 1, 0.8 + hash(t) * 0.08);
      yield;
    }
    c.halt();
    c.smash = false;
  }
  /** He goes a long way in one direction before he thinks of another: across the world, not round a place. */
  *roam() {
    const c = this.c;
    const near = watchersNear(c, 220);
    let target;
    if (near.length && hash(this.now, 41) < 0.65) {
      const p = near[0].location;
      const on = norm({ x: p.x - c.pos.x, y: 0, z: p.z - c.pos.z });
      target = { x: p.x + on.x * 30 + (hash(this.now, 42) - 0.5) * 50, y: p.y, z: p.z + on.z * 30 + (hash(this.now, 43) - 0.5) * 50 };
    } else {
      if (this.heading < 0) this.heading = hash(this.now, 44) * 360;
      this.heading = (this.heading + (hash(this.now, 45) - 0.5) * 70 + 360) % 360;
      const a = this.heading * Math.PI / 180;
      target = { x: c.pos.x - Math.sin(a) * 150, y: c.pos.y, z: c.pos.z + Math.cos(a) * 150 };
    }
    const got = yield* this.walk(target, 0.16, 10, 1700);
    if (!got) this.heading = (this.heading + 110 + 360) % 360;
    c.setPhase("idle");
    for (let t = 0; t < 90; t++) {
      if (t === 30) c.say(hash(this.now, 17) < 0.5 ? "basiliskra.iii.breath" : "basiliskra.iii.growl", c.anchor("nose"), 80, 0.9, 0.82);
      yield;
    }
  }
  /** His roar is the same roar, from a bigger chest: it reaches further and throws harder.  The wings open with it. */
  *roar(whole) {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say(whole ? "basiliskra.roar" : "basiliskra.roar_short", c.anchor("mouth"), whole ? 192 : 160);
    const fx = new RoarFx(c, whole, whole ? 56 : 42, whole ? 9 : 6);
    const ticks = whole ? 160 : 88;
    for (let t = 0; t < ticks; t++) {
      fx.tick();
      yield;
    }
    c.setPhase("idle");
  }
  *turnTo(at3, rate = 1.2, limit = 240) {
    const c = this.c;
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, at3);
      if (Math.abs(wrapDeg(want - c.yaw)) < 2) break;
      c.yaw = turnTowards(c.yaw, want, rate);
      yield;
    }
  }
  // ---- the stare ------------------------------------------------------------------------------------------
  /** He looks at one player.  While he can see them they can barely walk; when he looks away, it wears off. */
  *stare(p) {
    const c = this.c;
    c.halt();
    c.setPhase("stare");
    c.say("basiliskra.iii.neck_turn", c.anchor("nose"), 96);
    let lost = 0, told = false;
    const peaceful = () => {
      try {
        return CONFIG.harmlessOnPeaceful && String(world8.getDifficulty()).toLowerCase() === "peaceful";
      } catch {
        return false;
      }
    };
    for (let t = 0; t < 170; t++) {
      let head2;
      try {
        if (!p.isValid || !targetable(p) || p.dimension.id !== c.dim.id) break;
        head2 = p.getHeadLocation();
      } catch {
        break;
      }
      c.lookAt(head2, 85, 50);
      if (t === 34) c.say("basiliskra.iii.growl", c.anchor("nose"), 96, 1, 0.78);
      if (t >= 14 && t % 10 === 4) {
        const sees = dist(head2, c.pos) <= 140 && clearLine(c.dim, c.anchor("nose"), head2);
        lost = sees ? 0 : lost + 1;
        if (lost >= 3) break;
        if (sees && !peaceful()) {
          try {
            p.addEffect("slowness", 50, { amplifier: 2, showParticles: false });
            if (!told) {
              told = true;
              p.onScreenDisplay.setActionBar("§cHe is looking at you.");
              p.playSound("basiliskra.iii.window_breath", { volume: 1 });
            }
            p.runCommand("camerashake add @s 0.05 0.5 rotational");
          } catch {
          }
        }
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
    yield* wait(20);
  }
  // ---- 1. his first roar comes after his first beam ----------------------------------------------------------
  *debut() {
    const c = this.c, F = this.four();
    c.halt();
    const who = watchersNear(c, 170)[0];
    const toward = who ? norm({ x: who.location.x - c.pos.x, y: 0, z: who.location.z - c.pos.z }) : c.forward;
    if (who) yield* this.turnTo(who.location, 1.5, 160);
    c.setPhase("look");
    const reach = who ? clamp(distXZ(who.location, c.pos) - 8, 30, 70) : 46;
    const line = [];
    for (let d = reach; d > reach - 26; d -= 1) {
      const x = c.pos.x + toward.x * d, z = c.pos.z + toward.z * d;
      const g = groundY(c.dim, x, z, c.pos.y + 24, 60);
      if (typeof g === "number" && !isWaterId(idAt(c.dim, { x, y: g, z }))) line.push({ x, y: g - 1, z });
    }
    if (line.length < 6) {
      F.debut = true;
      store.touch();
      yield* this.roar(true);
      return;
    }
    yield* wait(24);
    const st = { ground: null };
    for (let t = 0; t < 52; t++) {
      const at3 = line[Math.min(line.length - 1, Math.floor(t / 52 * line.length))];
      const top2 = { x: at3.x, y: at3.y + 1, z: at3.z };
      c.lookAt(top2, 85, 60);
      const from = c.anchor("mouth");
      const dir = norm(sub(top2, from));
      beamTick(c, { ...THIN, range: dist(from, top2) + 2 }, t, 1, st, { from, dir, harmless: true });
      if (t % 2 === 0) particle(c.dim, "basiliskra:beam_impact", top2, 128);
      if (t % 8 === 0) sound(c.dim, "basiliskra.iii.charge_tick", top2, 96, 0.8, 1.5);
      yield;
    }
    c.lookAhead();
    for (let t = 0; t < 60; t++) {
      if (t % 6 === 0) for (let i = t % 12 === 0 ? 0 : 1; i < line.length; i += 2) particle(c.dim, "basiliskra:rad_glint", { x: line[i].x, y: line[i].y + 1.1, z: line[i].z }, 96);
      yield;
    }
    for (let i = 0; i < line.length; i++) {
      const at3 = line[i];
      const made = glassify(c.dim, at3);
      particle(c.dim, made ? "basiliskra:crystal_break" : "basiliskra:rad_glint", { x: at3.x, y: at3.y + 1.2, z: at3.z }, 96);
      sound(c.dim, "random.pop", at3, 64, 1, 0.6 + i / line.length * 0.9);
      yield* wait(3);
    }
    addFallout(line[Math.floor(line.length / 2)], 5, 0.5);
    F.debut = true;
    store.touch();
    yield* this.roar(true);
    this.recoverUntil = this.now + 4 * TICKS.second;
  }
  // ---- the breath, and what can happen inside it ---------------------------------------------------------------
  igniteAt(from, dir) {
    const c = this.c;
    particle(c.dim, "basiliskra:muzzle_flash", from, 192, beamVars(dir, 1, this.spec.width));
    particle(c.dim, "basiliskra:muzzle_shock", from, 192, beamVars(dir, 1, this.spec.width));
    flash(c.dim, from, 80, { red: 1, green: 0.5, blue: 0.42 }, 0.03, 0.04, 0.3);
    shake(c, 128, 1, 0.5);
  }
  /** The plate that stands in the ground lights with the gap in his spine. */
  plateGlow(t) {
    const P = this.four().plate;
    if (!P || P.burnt || t % 10 !== 0) return;
    const top2 = { x: P.x + 0.5, y: P.y + 3, z: P.z + 0.5 };
    particle(this.c.dim, "basiliskra:impact_glare", top2, 128);
    particle(this.c.dim, "basiliskra:rad_glint", { x: top2.x, y: top2.y + 2, z: top2.z }, 96);
    if (t % 20 === 0) sound(this.c.dim, "basiliskra.iii.charge_tick", top2, 64, 0.5, 0.7);
  }
  *charge(target, aimAt, watchCover, pour = true) {
    const c = this.c;
    this.ps = freshPour();
    this.markAt = null;
    const ok = () => {
      try {
        return !target || target.isValid && target.dimension.id === c.dim.id;
      } catch {
        return false;
      }
    };
    const flying2 = !!target && isFlyer(target);
    const duel = !flying2 && this.inDuel;
    const pitchMax = flying2 ? 80 : 50;
    const down = pour && !flying2;
    const gather = () => down ? groundAhead(c, aimAt()) : aimAt();
    c.halt();
    c.setPhase("charge");
    c.say("basiliskra.iii.club_plant", c.anchor("club_core"), 128);
    c.say("basiliskra.iii.charge", c.anchor("throat"), 160);
    this.chargeSounding = true;
    this.rodSeen.clear();
    this.rodLayer = 0;
    for (let t = 0; t < PLANT_TICKS; t++) {
      c.setCharge(t / 7);
      if (ok()) {
        if (down) c.trackTo(gather(), 3, 80, 80);
        else c.aimAt(aimAt(), 80, pitchMax);
      }
      this.scanRods();
      yield;
    }
    const light = LIGHT_END - PLANT_TICKS;
    let hidden = 0, lit = 1;
    if (down) c.setPhase("pour");
    for (let t = 0; t < light; t++) {
      if (!ok()) return "gone";
      const aim = aimAt();
      let off;
      if (down) {
        pourTick(c, this.spec, this.ps, t, light, aimAt, (hit) => this.scorch(hit));
        off = Math.abs(c.lookYaw) > 60 ? 1 : 0;
      } else off = c.aimAt(aim, 80, pitchMax);
      if (off > 0) c.yaw = turnTowards(c.yaw, yawTo(c.pos, aim), flying2 ? 1.2 : 0.5);
      c.setCharge(2 + t / light * 13.4);
      const zone = Math.floor(c.charge / 2);
      if (zone > lit) {
        lit = zone;
        sound(c.dim, "basiliskra.iii.charge_tick", c.anchor(zone >= 6 ? "throat" : "club_core"), 96, 0.55, 0.6 + zone * 0.08);
      }
      if (t % 20 === 10) shake(c, 64, 0.14 + 0.24 * (t / light), 1);
      this.plateGlow(t);
      this.scanRods();
      if (watchCover && target && t > 24 && t % 4 === 0) {
        hidden = clearLine(c.dim, c.anchor("mouth"), headOf(target)) ? 0 : hidden + 1;
        if (hidden >= 4) return "cover";
      }
      yield;
    }
    const lock = CHARGE_TICKS - LIGHT_END;
    if (down) {
      this.markAt = aimAt();
      c.setPhase("rear");
    }
    for (let t = 0; t < lock; t++) {
      c.setCharge(16 + t / lock * 2);
      if (down && this.markAt) rearTick(c, this.spec, this.ps, t, lock, this.markAt);
      if (flying2 && ok()) c.trackTo(aimAt(), 4, 80, 80);
      if (t % 2 === 0) {
        const { from, dir: d0 } = c.aim();
        const dir = down ? norm(sub(aimAt(), from)) : d0;
        particle(c.dim, "basiliskra:beam_aim", from, 160, beamVars(dir, clearRange(c, from, dir, this.spec.range), 0.3 + 0.7 * (t / lock)));
      }
      this.plateGlow(LIGHT_END + t);
      yield;
    }
    return "lock";
  }
  cutCharge() {
    if (!this.chargeSounding) return;
    this.chargeSounding = false;
    stopSound(this.c.dim, "basiliskra.iii.charge", this.c.pos);
  }
  /** The breath at something he can see. */
  *breath(target) {
    const c = this.c, F = this.four();
    if (!F.plate && F.shots >= 2) yield* this.shedPlate();
    const got = yield* this.charge(target, () => aimOf(target), isPlayer(target) && !isFlyer(target) && this.ready("swallow"));
    if (got === "gone") {
      this.cutCharge();
      return;
    }
    if (got === "cover") {
      this.rest("swallow", 3 * TICKS.minute);
      yield* this.swallow(target);
      return;
    }
    const rod = this.findRod();
    if (rod && clearLine(c.dim, this.clubTop(), { x: rod.x + 0.5, y: rod.y + 1.2, z: rod.z + 0.5 })) {
      this.cutCharge();
      yield* this.ground(rod);
      this.recoverUntil = this.now + 8 * TICKS.second;
      return;
    }
    if (!this.lastFailed && F.shots >= 1 && hash(this.now, 96) < 0.22) {
      this.lastFailed = true;
      yield* this.misfire();
      return;
    }
    this.lastFailed = false;
    yield* this.fire(target);
    yield* this.vent();
    yield* this.roar(hash(this.now, 61) < 0.3);
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
    yield* wait(30);
  }
  /** 2. The shot, the skid, and the turn on the buried club. */
  *fire(target, aim) {
    const c = this.c, F = this.four();
    c.setPhase("fire");
    c.setCharge(20);
    F.shots++;
    this.rec.mut.beams++;
    this.rec.mut.lastEncounter = this.now;
    this.chargeSounding = false;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 192);
    {
      const { from, dir } = c.aim();
      this.igniteAt(from, dir);
    }
    const st = { ground: null };
    const live = () => {
      try {
        return !!target && target.isValid && target.dimension.id === c.dim.id && (!isPlayer(target) || targetable(target));
      } catch {
        return false;
      }
    };
    let side = 0;
    let pivot = null;
    const flying2 = !!target && isFlyer(target);
    const duel = !flying2 && this.inDuel;
    if (!flying2 && this.ps.origin) {
      const fixed = this.markAt ?? (live() ? aimOf(target) : add(c.anchor("mouth"), mul(c.forward, 40)));
      yield* slamAndLift(c, this.spec, this.ps, st, aim ?? (() => fixed), (hit) => this.scorch(hit));
    }
    for (let t = 0; t < FIRE; t++) {
      const fade = t < FIRE - 16 ? 1 : (FIRE - t) / 16;
      if (flying2) {
        if (live()) c.trackTo(aimOf(target), 3.5, 80, 80);
      } else if (duel) {
        if (live()) c.trackTo(aim ? aim() : aimOf(target), 1.2, 80, 60);
        if (t >= SKID_AT && t < LIFT_AT) this.skid(t);
        else if (t === LIFT_AT) c.setPhase("fire");
      } else if (t < SKID_AT) {
        if (live()) {
          const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
          c.lookYaw += clamp(want - c.lookYaw, -0.3, 0.3);
        }
      } else if (t < LIFT_AT) {
        this.skid(t);
      } else if (t < SWEEP_AT) {
        if (t === LIFT_AT) {
          const bearing = live() ? wrapDeg(yawTo(c.pos, target.location) - (c.yaw + c.lookYaw)) : hash(this.now, 97) - 0.5;
          side = bearing >= 0 ? 1 : -1;
          pivot = c.anchor("club_core");
          c.setPhase("pivot");
          c.bendHold = 30 * side;
          c.say("basiliskra.iii.club_plant", pivot, 128, 1, 0.8);
          particle(c.dim, "basiliskra:impact_ring", { x: pivot.x, y: c.pos.y + 0.3, z: pivot.z }, 128);
          shake(c, 96, 0.5, 0.4);
        }
      } else if (t < SWEEP_END && pivot) {
        const step = 1.4 * side;
        const a = step * Math.PI / 180;
        const rx = c.pos.x - pivot.x, rz = c.pos.z - pivot.z;
        const to = { x: pivot.x + rx * Math.cos(a) - rz * Math.sin(a), y: c.pos.y, z: pivot.z + rx * Math.sin(a) + rz * Math.cos(a) };
        if (isLoaded(c.dim, to)) {
          c.pos = to;
          c.yaw = wrapDeg(c.yaw + step);
        }
        if (t % 12 === 0) this.stomp({ ...c.anchor(side > 0 ? "foot_r" : "foot_l"), y: c.pos.y + 0.1 });
      } else if (t === SWEEP_END && pivot) {
        c.setPhase("fire");
        c.bendHold = 0;
        sound(c.dim, "mob.wither.break_block", pivot, 128, 1, 0.5);
        particle(c.dim, "basiliskra:impact_debris", { x: pivot.x, y: c.pos.y + 1, z: pivot.z }, 128);
        particle(c.dim, "basiliskra:impact_ring", { x: pivot.x, y: c.pos.y + 0.3, z: pivot.z }, 128);
        blast(c.dim, { x: pivot.x, y: c.pos.y + 1, z: pivot.z }, 9, 9, c.mobHit(18), 1.3, (p, n) => c.hurt(p, n), c.entity);
        if (wither()) carve(c.dim, { x: pivot.x, y: c.pos.y, z: pivot.z }, 3, 120, false);
      }
      beamTick(c, this.spec, t, fade, st, { scorch: (hit) => this.scorch(hit) });
      if (t % 10 === 0) shake(c, 96, 0.4 * fade + 0.1, 0.6);
      yield;
    }
    c.bendHold = 0;
  }
  /** The breath shoves him backward on his heels. */
  skid(t) {
    const c = this.c;
    if (t === SKID_AT) {
      c.setPhase("skid");
      c.say("basiliskra.iii.grunt", c.anchor("nose"), 96, 1, 0.74);
    }
    const back = mul(c.forward, -0.07);
    const to = { x: c.pos.x + back.x, y: c.pos.y, z: c.pos.z + back.z };
    if (isLoaded(c.dim, to) && typeof groundY(c.dim, to.x, to.z, c.pos.y + 4, 10) === "number") c.pos = to;
    if (t % 3 === 0) for (const h of ["heel_l", "heel_r"]) particle(c.dim, "basiliskra:step_dust", { ...c.anchor(h), y: c.pos.y + 0.2 }, 96);
  }
  // ---- 3. the misfire: his wings take the recoil -----------------------------------------------------------------
  *misfire() {
    const c = this.c;
    this.cutCharge();
    c.setPhase("recoil");
    c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 128);
    c.setCharge(8);
    shake(c, 96, 0.7, 0.5);
    const f = c.forward, l = leftOf(c.yaw);
    const states = VEINS.map(() => ({ ground: null }));
    for (let t = 0; t < 96; t++) {
      if (t >= 16 && t < 80) {
        for (let k = 0; k < VEINS.length; k++) {
          if (t < 16 + k * 2 || (t + k) % 2) continue;
          const sgn = k % 2 === 0 ? 1 : -1, out = 0.2 + 0.22 * Math.floor(k / 2);
          const from = c.anchor(VEINS[k]);
          const dir = norm({ x: -f.x * 0.7 + l.x * sgn * out, y: -0.62, z: -f.z * 0.7 + l.z * sgn * out });
          beamTick(c, THIN, t + k * 3, 1, states[k], { from, dir, scorch: (hit) => this.scorch(hit) });
        }
        if (t % 12 === 0) sound(c.dim, "basiliskra.ii.arc", c.anchor(VEINS[t / 12 % VEINS.length | 0]), 96, 1, 0.7);
      }
      c.setCharge(Math.max(0, 8 - t * 0.09));
      yield;
    }
    c.setCharge(0);
    c.setPhase("idle");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 96, 1, 0.8);
    this.recoverUntil = this.now + 5 * TICKS.second;
    yield* wait(40);
  }
  // ---- 6. the beam he swallows ----------------------------------------------------------------------------------
  *swallow(target) {
    const c = this.c;
    this.cutCharge();
    c.setPhase("swallow");
    c.say("basiliskra.iii.fizzle", c.anchor("mouth"), 96, 1, 0.7);
    c.lookAhead();
    for (let t = 0; t < 36; t++) {
      c.setCharge(Math.max(0, 16 - t * 0.5));
      yield;
    }
    let last = { ...target.location };
    let pulses = 0;
    c.smash = true;
    for (let t = 1; pulses < 3; t++) {
      let seen = false;
      try {
        if (target.isValid && targetable(target) && target.dimension.id === c.dim.id) {
          const mouth = c.anchor("mouth");
          seen = dist(target.location, mouth) < this.spec.range - 6 && dist(target.location, mouth) > 10 && clearLine(c.dim, mouth, headOf(target));
          if (seen) last = { ...target.location };
        }
      } catch {
      }
      if (seen && Math.abs(wrapDeg(yawTo(c.pos, last) - c.yaw)) < 70) break;
      c.setPhase("carry");
      c.goTo(last, 0.17, 12);
      this.footfalls();
      if (t % PULSE_TICKS === 0) {
        pulses++;
        c.pulse(11);
        c.say("basiliskra.knock.vent", c.anchor("throat"), 96, 1, 0.8 + pulses * 0.1);
        shake(c, 64, 0.3, 0.3);
      }
      yield;
    }
    c.halt();
    c.smash = false;
    const forced = pulses >= 3;
    let live = false;
    try {
      live = target.isValid && target.dimension.id === c.dim.id;
    } catch {
      live = false;
    }
    c.lookAhead();
    yield* this.snapShot(!forced && live ? target : null, 72);
    yield* this.vent();
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
  }
  /** A shot with no warning but the pulse: what he was already carrying. */
  *snapShot(target, ticks) {
    const c = this.c, F = this.four();
    c.setPhase("fire");
    c.setCharge(20);
    try {
      if (target && target.isValid) c.aimAt(headOf(target), 80, 50);
    } catch {
    }
    F.shots++;
    this.rec.mut.beams++;
    this.rec.mut.lastEncounter = this.now;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 192);
    {
      const { from, dir } = c.aim();
      this.igniteAt(from, dir);
    }
    const st = { ground: null };
    for (let t = 0; t < ticks; t++) {
      const fade = t < ticks - 12 ? 1 : (ticks - t) / 12;
      try {
        if (target && target.isValid) {
          const want = clamp(wrapDeg(yawTo(c.anchor("throat"), target.location) - c.yaw), -80, 80);
          c.lookYaw += clamp(want - c.lookYaw, -0.25, 0.25);
        }
      } catch {
      }
      beamTick(c, this.spec, t, fade, st, { scorch: (hit) => this.scorch(hit) });
      if (t % 10 === 0) shake(c, 96, 0.4 * fade + 0.1, 0.6);
      yield;
    }
    stopSound(c.dim, "basiliskra.iii.beam", c.pos);
  }
  // ---- 5. the plate that keeps charging --------------------------------------------------------------------------
  plateBlocks(P) {
    const out = [];
    for (let h = 0; h < 5; h++) out.push({ x: P.x, y: P.y + h, z: P.z });
    out.push({ x: P.x + 1, y: P.y + 2, z: P.z }, { x: P.x - 1, y: P.y + 3, z: P.z }, { x: P.x + 1, y: P.y + 3, z: P.z });
    return out;
  }
  *shedPlate() {
    const c = this.c, F = this.four();
    const from = c.anchor("plate_break");
    const l = leftOf(c.yaw), f = c.forward;
    const spot = { x: Math.floor(c.pos.x + l.x * 15 - f.x * 9), z: Math.floor(c.pos.z + l.z * 15 - f.z * 9) };
    const g = groundY(c.dim, spot.x + 0.5, spot.z + 0.5, c.pos.y + 20, 50);
    if (typeof g !== "number") return;
    const P = { x: spot.x, y: g, z: spot.z, uses: 0, burnt: false };
    c.set(PROP.gill, true);
    sound(c.dim, "random.glass", from, 128, 1, 0.5);
    sound(c.dim, "basiliskra.iii.ground", from, 128, 1, 0.8);
    particle(c.dim, "basiliskra:impact_fountain", from, 160);
    c.say("basiliskra.hurt", c.anchor("nose"), 96, 1, 0.8);
    const top2 = { x: P.x + 0.5, y: P.y + 2.5, z: P.z + 0.5 };
    for (let t = 0; t < 18; t++) {
      const k = t / 18;
      particle(c.dim, "basiliskra:impact_glare", { x: from.x + (top2.x - from.x) * k, y: from.y + (top2.y - from.y) * k * k, z: from.z + (top2.z - from.z) * k }, 160);
      yield;
    }
    if (CONFIG.terrain !== "none") {
      for (const b of this.plateBlocks(P)) {
        const at3 = blockAt(c.dim, b);
        if (!at3 || isSolidBlock(at3) && at3.typeId !== CRYSTAL_BLOCK) continue;
        try {
          at3.setType(TRINITITE_BLOCK);
        } catch {
          try {
            at3.setType("minecraft:red_nether_brick");
          } catch {
          }
        }
      }
    }
    sound(c.dim, "mob.wither.break_block", top2, 128, 1, 0.6);
    particle(c.dim, "basiliskra:impact_ring", { x: top2.x, y: P.y + 0.3, z: top2.z }, 128);
    particle(c.dim, "basiliskra:impact_debris", top2, 128);
    blast(c.dim, top2, 5, 6, c.mobHit(12), 0.9, (p, n) => c.hurt(p, n), c.entity);
    F.plate = P;
    store.touch();
    yield* wait(20);
  }
  plateTop() {
    const P = this.four().plate;
    return P && !P.burnt ? { x: P.x + 0.5, y: P.y + 5.3, z: P.z + 0.5 } : null;
  }
  /** Can the plate see someone his mouth cannot? */
  plateSees(q) {
    const top2 = this.plateTop();
    if (!top2) return false;
    const c = this.c;
    const mouth = c.anchor("mouth");
    return dist(top2, mouth) <= PLATE_REACH && dist(top2, q.location) <= 60 && dist(top2, q.location) > 3 && clearLine(c.dim, mouth, { x: top2.x, y: top2.y + 0.8, z: top2.z }) && clearLine(c.dim, top2, headOf(q));
  }
  /** He fires into his own broken plate, and it throws the beam at whoever sheltered from his mouth. */
  *plateShot(target) {
    const c = this.c, F = this.four();
    const top2 = this.plateTop();
    if (!top2 || !F.plate) return;
    const got = yield* this.charge(null, () => top2, false, false);
    if (got !== "lock") {
      this.cutCharge();
      return;
    }
    c.setPhase("fire");
    c.setCharge(20);
    F.shots++;
    this.rec.mut.beams++;
    this.rec.mut.lastEncounter = this.now;
    this.chargeSounding = false;
    c.say("basiliskra.iii.beam", c.anchor("mouth"), 192);
    {
      const { from, dir } = c.aim();
      this.igniteAt(from, dir);
    }
    let aim = top2;
    try {
      aim = headOf(target);
    } catch {
    }
    const out = norm(sub(aim, top2));
    const a = { ground: null }, b = { ground: null };
    for (let t = 0; t < 110; t++) {
      const fade = t < 96 ? 1 : (110 - t) / 14;
      const from = c.anchor("mouth");
      const leg = sub(top2, from);
      beamTick(c, { ...this.spec, range: Math.hypot(leg.x, leg.y, leg.z) }, t, fade, a, { from, dir: norm(leg), harmless: true });
      beamTick(c, { ...this.spec, range: 70, width: this.spec.width * 0.7 }, t + 1, fade, b, { from: top2, dir: out, scorch: (hit) => this.scorch(hit) });
      if (t % 4 === 0) particle(c.dim, "basiliskra:impact_glare", top2, 160);
      if (t % 10 === 0) shake(c, 96, 0.4 * fade + 0.1, 0.6);
      yield;
    }
    stopSound(c.dim, "basiliskra.iii.beam", c.pos);
    F.plate.uses++;
    if (F.plate.uses >= PLATE_SHOTS) {
      F.plate.burnt = true;
      for (const q of this.plateBlocks(F.plate)) {
        const at3 = blockAt(c.dim, q);
        if (at3 && at3.typeId === TRINITITE_BLOCK) {
          try {
            at3.setType(SLAG_COLD_BLOCK);
          } catch {
            try {
              at3.setType("minecraft:blackstone");
            } catch {
            }
          }
        }
      }
      sound(c.dim, "random.fizz", top2, 96, 1, 0.6);
      particle(c.dim, "basiliskra:impact_smoke", top2, 128);
    }
    store.touch();
    yield* this.vent();
    this.recoverUntil = this.now + 6 * TICKS.second;
    c.setPhase("idle");
  }
  // ---- 4. he drags the seabed ashore ------------------------------------------------------------------------------
  /** Standing in the shallows, with somebody on dry land ahead: who the wave is for. */
  shoreVictim(near) {
    const c = this.c;
    const feet = idAt(c.dim, { x: c.pos.x, y: c.pos.y + 1.2, z: c.pos.z });
    if (!isWaterId(feet)) return null;
    for (const p of near) {
      const d = distXZ(p.location, c.pos);
      if (d < 24 || d > 90) continue;
      const under = idAt(c.dim, { x: p.location.x, y: p.location.y - 0.5, z: p.location.z });
      if (under && !isWaterId(under) && under !== "minecraft:air") return p;
    }
    return null;
  }
  *dragSeabed(p) {
    const c = this.c;
    c.halt();
    let goal = { ...c.pos };
    try {
      goal = { ...p.location };
    } catch {
      return;
    }
    yield* this.turnTo(goal, 1.2, 200);
    c.setPhase("drag");
    c.say("basiliskra.iii.growl", c.anchor("nose"), 128, 1, 0.74);
    const f = c.forward, l = leftOf(c.yaw);
    for (let t = 0; t < 84; t++) {
      if (t % 5 === 0) for (const h of ["hand_l", "hand_r"]) {
        const at3 = c.anchor(h);
        particle(c.dim, "basiliskra:surge", { x: at3.x, y: c.pos.y + 1, z: at3.z }, 96);
      }
      if (t % 20 === 10) shake(c, 80, 0.2 + t * 4e-3, 0.8);
      yield;
    }
    c.say("basiliskra.roar_short", c.anchor("mouth"), 160);
    sound(c.dim, "random.explode", add(c.pos, mul(f, 14)), 128, 1, 0.5);
    shake(c, 128, 0.9, 0.8);
    const WIDTH = 17, REACH = Math.min(70, distXZ(goal, c.pos) + 22), SPEED = 1.3;
    const swept = /* @__PURE__ */ new Set();
    let boats = 0;
    let end = { ...c.pos };
    for (let t = 0; t * SPEED < REACH; t++) {
      const d = 12 + t * SPEED;
      const mid = { x: c.pos.x + f.x * d, z: c.pos.z + f.z * d };
      const gy = groundY(c.dim, mid.x, mid.z, c.pos.y + 16, 30);
      const y = typeof gy === "number" ? gy : c.pos.y + 1;
      end = { x: mid.x, y, z: mid.z };
      for (let w = -WIDTH; w <= WIDTH; w += 3) {
        const at3 = { x: mid.x + l.x * w, z: mid.z + l.z * w };
        const g = groundY(c.dim, at3.x, at3.z, y + 8, 16);
        if (g === UNLOADED || g === NONE) continue;
        const here = { x: at3.x, y: g + 0.4, z: at3.z };
        particle(c.dim, (t + w) % 2 ? "basiliskra:surge" : "basiliskra:surge_spray", here, 128);
      }
      if (t % 6 === 0) sound(c.dim, "basiliskra.splash", { x: mid.x, y, z: mid.z }, 96, 1, 0.7);
      try {
        for (const e of c.dim.getEntities({ location: { x: mid.x, y, z: mid.z }, maxDistance: WIDTH + 4 })) {
          try {
            if (e.id === c.entity.id || swept.has(e.id) || e.typeId === "minecraft:item") continue;
            const rel = sub(e.location, { x: c.pos.x, y: e.location.y, z: c.pos.z });
            const along = rel.x * f.x + rel.z * f.z, across = rel.x * l.x + rel.z * l.z;
            if (Math.abs(along - d) > 3 || Math.abs(across) > WIDTH || Math.abs(e.location.y - y) > 7) continue;
            if (this.sweep(e, f)) {
              swept.add(e.id);
              if (/boat/.test(e.typeId)) boats++;
            }
          } catch {
          }
        }
      } catch {
      }
      yield;
    }
    try {
      const at3 = { x: end.x, y: end.y + 0.6, z: end.z };
      if (isLoaded(c.dim, at3)) {
        if (!boats) c.dim.spawnEntity("minecraft:boat", at3);
        c.dim.spawnEntity("minecraft:cod", { x: at3.x + 1.5, y: at3.y, z: at3.z + 0.5 });
        c.dim.spawnEntity("minecraft:cod", { x: at3.x - 4, y: at3.y, z: at3.z - 3 });
      }
    } catch {
    }
    c.setPhase("idle");
    this.recoverUntil = this.now + 5 * TICKS.second;
    yield* wait(50);
  }
  /** One thing caught by the wave.  True if it was moved. */
  sweep(e, f) {
    const c = this.c;
    if (e.typeId === "minecraft:player") {
      const p = e;
      if (!targetable(p)) return false;
      c.hurt(p, 5, EntityDamageCause9.entityAttack);
      try {
        p.applyKnockback({ x: f.x * 3.4, z: f.z * 3.4 }, 0.7);
      } catch {
      }
      try {
        p.runCommand("camerashake add @s 0.6 0.6 positional");
      } catch {
      }
      return true;
    }
    if (/boat|minecart/.test(e.typeId)) {
      try {
        e.applyImpulse({ x: f.x * 2.2, y: 0.55, z: f.z * 2.2 });
        return true;
      } catch {
        return false;
      }
    }
    if (!alive(e)) return false;
    try {
      e.applyKnockback({ x: f.x * 3, z: f.z * 3 }, 0.6);
      e.applyDamage(c.mobHit(6), { cause: EntityDamageCause9.entityAttack, damagingEntity: c.entity });
      return true;
    } catch {
      return false;
    }
  }
};

// src/titan.ts
var TITAN_MAX = 3;
var TITAN_NAMES = ["Alpha", "Beta", "Gamma"];
var LETHAL = 1e5;
var GIANT = TITAN_HEALTH / 4e3;
var TITAN_SPEC = { range: 220, radius: 3.4, damage: 30 * GIANT, width: 4.6, carve: 5.2, fallout: 8 };
var BLOW = { lunge: 85 * GIANT, tail: 130 * GIANT, ram: 110 * GIANT, swipe: 100 * GIANT };
var MIGHT = 3;
var HASTE = 1.35;
var TAG = "bk:titan";
var PROWL = 70;
var BrainTitan = class extends BrainFour {
  constructor(c, own, home) {
    super(c, own);
    /** Set when a blow would have killed it: it goes down, and then it is gone. */
    this.dying = false;
    /** Set when it has gone down for good: the manager takes the body away. */
    this.gone = false;
    this.reeling = false;
    this.home = { ...home };
    this.spec = TITAN_SPEC;
    this.giantSight = 240;
    this.blows = { bite: BLOW.lunge, tail: BLOW.tail, lunge: BLOW.lunge, swipe: BLOW.swipe, ram: BLOW.ram };
    c.set(PROP.gill, false);
  }
  /** Something its own size has struck it. */
  onBlow(_by, _amount, heavy) {
    this.hurtAt = this.now;
    if (heavy && this.ready("reel")) {
      this.rest("reel", 5 * TICKS.second);
      this.reeling = true;
    }
  }
  /** The nearest giant that is not itself. */
  foe() {
    let best = null, bd = this.giantSight;
    for (const g of otherGiants(this.c)) {
      const d = dist(g.pos, this.c.pos);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }
  interrupt() {
    if (this.dying) return this.actName === "fall" ? null : { name: "fall", run: this.fall(), limit: 12 * TICKS.second };
    if (this.reeling) {
      this.reeling = false;
      if (["charge", "fire", "pour", "skid", "pivot", "roar", "vent", "fall", "swipe", "leap"].includes(this.c.phase)) return null;
      return { name: "reel", run: this.reel(), limit: 3 * TICKS.second };
    }
    return this.foe() ? null : super.interrupt();
  }
  choose() {
    const c = this.c, now = this.now;
    const foe = this.foe();
    if (!foe) {
      const near = nearbyPlayers(c, 170);
      if (near.length || this.creatures().length) return super.choose();
      const town = settlementNear(c, now);
      if (town && distXZ(town, this.home) < 160) return { name: "raze", run: this.raze(town), limit: 150 * TICKS.second };
      if (this.ready("rroar") && hash(now, 93) < 0.4) {
        this.rest("rroar", (60 + 80 * hash(now, 92)) * TICKS.second);
        return { name: "roar", run: this.roar(hash(now, 94) < 0.3), limit: 12 * TICKS.second };
      }
      return { name: "roam", run: this.roam(), limit: 60 * TICKS.second };
    }
    const d = distXZ(foe.pos, c.pos), reach = c.girth + foe.girth;
    const bearing = wrapDeg(yawTo(c.pos, foe.pos) - c.yaw);
    if (foe.entity.id !== this.lastQuarry) {
      this.lastQuarry = foe.entity.id;
      if (this.ready("lockroar")) {
        this.rest("lockroar", 40 * TICKS.second);
        return { name: "lock", run: this.challenge(foe), limit: 14 * TICKS.second };
      }
    }
    if (d < reach + 14) {
      if (Math.abs(bearing) > 55 && this.ready("tail")) {
        this.rest("tail", 6 * TICKS.second);
        return { name: "tail", run: this.tail(bearing >= 0 ? 1 : -1), limit: 4 * TICKS.second };
      }
      if (this.ready("lunge")) {
        this.rest("lunge", 3.5 * TICKS.second);
        return { name: "lunge", run: this.lunge({ g: foe, e: foe.entity }), limit: 5 * TICKS.second };
      }
      if (Math.abs(bearing) <= 60 && this.ready("swipe") && hash(now, 88) < 0.6) {
        this.rest("swipe", 7 * TICKS.second);
        return { name: "swipe", run: this.swipe(() => foe.middle(), foe, BLOW.swipe), limit: 4 * TICKS.second };
      }
      if (this.ready("circle") && this.ready("tail")) {
        this.rest("circle", 9 * TICKS.second);
        return { name: "circle", run: this.circle(foe), limit: 8 * TICKS.second };
      }
    }
    if (this.ready("beam") && now >= this.recoverUntil && d < this.spec.range - 10) {
      if (d < reach + 16 && this.ready("leap")) {
        this.rest("leap", 12 * TICKS.second);
        this.rest("beam", 16 * TICKS.second);
        return { name: "leap", run: this.leapAndBreathe({ g: foe, e: foe.entity }), limit: 60 * TICKS.second };
      }
      if (d < reach + 14 && hash(now, 81) < 0.55) this.rest("beam", 5 * TICKS.second);
      else if (clearLine(c.dim, c.anchor("mouth"), foe.middle())) {
        this.rest("beam", 15 * TICKS.second);
        return { name: "beam", run: this.breatheAt({ g: foe, e: foe.entity }), limit: 60 * TICKS.second };
      }
    }
    if (d > reach + 34 && this.ready("ram")) {
      this.rest("ram", 22 * TICKS.second);
      return { name: "ram", run: this.ram(foe), limit: 30 * TICKS.second };
    }
    if (d >= reach + 14) return { name: "pursue", run: this.pursue(foe.entity), limit: 20 * TICKS.second };
    return { name: "square", run: this.square(foe), limit: 2 * TICKS.second };
  }
  leapReach() {
    return { far: 32, high: 9 };
  }
  /** Its breath at another giant (when it leaps back first). */
  duelBreath(e) {
    return this.breath(e);
  }
  breathGap() {
    return 16 * TICKS.second;
  }
  /** Its breath is whole every time: nothing fails in its mouth, nothing is swallowed, no plate is shed. */
  *breath(target) {
    const g = giants.get(target.id);
    let last = { ...target.location };
    const mark = () => {
      try {
        last = g && g.valid ? g.middle() : target.isValid ? aimOf(target) : last;
      } catch {
      }
      return last;
    };
    const got = yield* this.charge(target, mark, false);
    if (got !== "lock") {
      this.cutCharge();
      return;
    }
    yield* this.fire(target, mark);
    yield* this.vent();
    this.rest("beam", 16 * TICKS.second);
    this.recoverUntil = this.now + 3 * TICKS.second;
    this.c.setPhase("idle");
  }
  aimPoint(e) {
    try {
      return e.getHeadLocation();
    } catch {
      return this.c.pos;
    }
  }
  *challenge(foe) {
    yield* this.turnTo(foe.pos, 2.5, 60);
    this.c.lookAt(foe.middle(), 80, 40);
    yield* this.roar(false);
  }
  *square(foe) {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 14 && foe.valid; t++) {
      c.yaw = wrapDeg(c.yaw + Math.max(-2.5, Math.min(2.5, wrapDeg(yawTo(c.pos, foe.pos) - c.yaw))));
      c.lookAt(foe.middle(), 70, 40);
      yield;
    }
  }
  /** A quarter of the way round the enemy, at arm's length: it ends side-on to it. */
  *circle(foe) {
    const c = this.c;
    const side = hash(this.now, 83) < 0.5 ? 1 : -1;
    const r = c.girth + foe.girth + 8;
    const a = Math.atan2(c.pos.z - foe.pos.z, c.pos.x - foe.pos.x) + side * 1.25;
    const to = { x: foe.pos.x + Math.cos(a) * r, y: c.pos.y, z: foe.pos.z + Math.sin(a) * r };
    for (let t = 0; t < 130; t++) {
      if (!foe.valid) break;
      c.setPhase("move");
      c.goTo(to, 0.2, 3);
      c.lookAt(foe.middle(), 80, 40);
      this.footfalls();
      if (distXZ(to, c.pos) < 4 || c.blocked > 30) break;
      if (t > 30 && Math.abs(wrapDeg(yawTo(c.pos, foe.pos) - c.yaw)) > 65 && distXZ(foe.pos, c.pos) < r + 6) break;
      yield;
    }
    c.halt();
  }
  /** Its whole weight, at a run: it does not stop until it has hit the enemy or lost it. */
  *ram(foe) {
    const c = this.c;
    yield* this.turnTo(foe.pos, 2.5, 50);
    c.say("basiliskra.roar_short", c.anchor("mouth"), 192);
    c.smash = true;
    for (let t = 0; t < 420; t++) {
      if (!foe.valid || foe.dim.id !== c.dim.id) break;
      const reach = c.girth + foe.girth;
      c.setPhase("move");
      c.goTo(foe.pos, 0.3, reach + 2);
      c.lookAt(foe.middle(), 60, 40);
      this.footfalls();
      if (distXZ(foe.pos, c.pos) < reach + 5) {
        const away = norm({ x: foe.pos.x - c.pos.x, y: 0, z: foe.pos.z - c.pos.z });
        foe.takeBlow(c, BLOW.ram * Math.min(1, 0.5 + c.speed / 0.5), true);
        foe.shove(away, 11);
        this.duelImpact({ x: (foe.pos.x + c.pos.x) / 2, y: c.pos.y + 22, z: (foe.pos.z + c.pos.z) / 2 }, true);
        break;
      }
      if (c.blocked > 60) break;
      yield;
    }
    c.halt();
    c.smash = false;
    c.setPhase("idle");
    for (let t = 0; t < 12; t++) yield;
  }
  /** Staggered by a blow from something its own size: its wings fly open and it loses a second. */
  *reel() {
    const c = this.c;
    c.halt();
    c.setPhase("recoil");
    c.say("basiliskra.hurt", c.anchor("nose"), 128, 1, 0.82);
    for (let t = 0; t < 18; t++) yield;
    c.setPhase("idle");
  }
  /** Round the place it was made: never far from where a second one will be put down to meet it. */
  *roam() {
    const c = this.c, now = this.now;
    const a = hash(now, 51) * Math.PI * 2, r = 20 + hash(now, 52) * (PROWL - 20);
    const to = { x: this.home.x + Math.cos(a) * r, y: c.pos.y, z: this.home.z + Math.sin(a) * r };
    yield* this.walk(to, 0.14, 8, 900);
    c.setPhase("idle");
    for (let t = 0; t < 100; t++) {
      if (t === 30) c.say(hash(now, 17) < 0.5 ? "basiliskra.iii.breath" : "basiliskra.iii.growl", c.anchor("nose"), 96, 0.9, 0.78);
      if (this.foe()) break;
      yield;
    }
  }
  /** Beaten: onto its knees, the fire in it failing, and then nothing of it but ash and what it leaves. */
  *fall() {
    const c = this.c;
    c.halt();
    c.smash = false;
    c.setCharge(0);
    c.lookAhead();
    c.setPhase("fall");
    c.say("basiliskra.roar_short", c.anchor("mouth"), 224, 1, 0.9);
    for (let t = 0; t < 96; t++) {
      c.setPhase("fall");
      if (t % 7 === 3) {
        const v = c.volumes();
        const at3 = v[Math.floor(hash(this.now, t) * v.length)].at;
        particle(c.dim, "minecraft:huge_explosion_emitter", at3, 192);
        particle(c.dim, "basiliskra:impact_fire", at3, 160);
        sound(c.dim, "random.explode", at3, 160, 1.2, 0.55 + hash(t, 5) * 0.2);
      }
      if (t === 44) {
        const f = forwardOf(c.yaw);
        const at3 = { x: c.pos.x + f.x * 6, y: c.pos.y + 0.5, z: c.pos.z + f.z * 6 };
        sound(c.dim, "basiliskra.iii.step", at3, 192, 1, 0.45);
        particle(c.dim, "basiliskra:impact_ring", at3, 192);
        particle(c.dim, "basiliskra:step_dust", at3, 160);
        shake(c, 160, 1.6, 0.9);
        blast(c.dim, at3, 12, 8, c.mobHit(30), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
      }
      yield;
    }
    const mid = c.middle();
    for (const v of c.volumes()) {
      if (hash(v.at.x, v.at.z) < 0.4) particle(c.dim, "basiliskra:fallout_ash", v.at, 160);
      if (hash(v.at.z, v.at.y) < 0.25) particle(c.dim, "basiliskra:impact_smoke", v.at, 192);
    }
    particle(c.dim, "basiliskra:impact_glare", mid, 224);
    particle(c.dim, "minecraft:huge_explosion_emitter", mid, 224);
    sound(c.dim, "random.explode", mid, 224, 2, 0.4);
    addFallout({ x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) }, 9, 0.6);
    try {
      c.dim.spawnItem(new ItemStack2(SHARD_ITEM, 24), { x: c.pos.x, y: c.pos.y + 1.5, z: c.pos.z });
      c.dim.spawnItem(new ItemStack2(FIN_ITEM, 1), { x: c.pos.x + 1, y: c.pos.y + 1.5, z: c.pos.z });
    } catch {
    }
    this.gone = true;
    yield;
  }
};
function tellNear(dim, at3, msg) {
  for (const p of witnesses(dim, at3, 96)) {
    try {
      p.sendMessage(msg);
    } catch {
    }
  }
}
var Titans = class {
  constructor() {
    this.list = /* @__PURE__ */ new Map();
    /** More rows for the health line: the Vathrok Titans' (2.0; set from main.ts, so neither module loads the other). */
    this.extraRows = () => [];
    this.hurtCry = /* @__PURE__ */ new Map();
  }
  get count() {
    return this.list.size;
  }
  /** The body an entity is, if it is a Titan that has been taken up. */
  of(e) {
    try {
      return this.list.get(e.id);
    } catch {
      return void 0;
    }
  }
  creatures() {
    return [...this.list.values()].map((t) => t.c);
  }
  /** Are any of them at each other, or at him, just now? */
  fighting() {
    for (const t of this.list.values()) if (t.brain.foe()) return true;
    return false;
  }
  /** The one nearest a place (for the music). */
  nearest(dimId, at3) {
    let best = null, bd = 1e9;
    for (const t of this.list.values()) {
      if (!t.c.valid || t.c.dim.id !== dimId) continue;
      const d = dist(t.c.pos, at3);
      if (d < bd) {
        bd = d;
        best = t.c;
      }
    }
    return best;
  }
  /** An entity of the Titan's type has appeared or loaded: it is taken up, or (one too many, the wrong world) removed. */
  inspect(e) {
    let id, dimId, at3;
    try {
      if (!e.isValid || e.typeId !== TITAN) return;
      id = e.id;
      dimId = e.dimension.id;
      at3 = { ...e.location };
    } catch {
      return;
    }
    if (this.list.has(id)) return;
    if (dimId !== OVERWORLD) {
      tellNear(e.dimension, at3, "§7A Titan can only stand in the Overworld.");
      try {
        e.remove();
      } catch {
      }
      return;
    }
    if (this.list.size >= TITAN_MAX) {
      tellNear(e.dimension, at3, `§7There are ${TITAN_MAX} Titans in the world already: that is as many as there can be.`);
      try {
        e.remove();
      } catch {
      }
      return;
    }
    this.adopt(e, at3);
  }
  adopt(e, at3) {
    let saved = null;
    try {
      const s = e.getDynamicProperty(TAG);
      if (typeof s === "string") saved = JSON.parse(s);
    } catch {
      saved = null;
    }
    const taken = new Set([...this.list.values()].map((t) => t.n));
    let n = saved && Number.isInteger(saved.n) && !taken.has(saved.n) ? saved.n : -1;
    if (n < 0) for (n = 0; taken.has(n); n++) {
    }
    const home = saved && Array.isArray(saved.home) ? { x: saved.home[0], y: saved.home[1], z: saved.home[2] } : at3;
    const fresh = !saved;
    try {
      e.triggerEvent("basiliskra:bind");
      e.setDynamicProperty(TAG, JSON.stringify({ n, home: [Math.round(home.x), Math.round(home.y), Math.round(home.z)] }));
      e.nameTag = `Titan ${TITAN_NAMES[n % TITAN_NAMES.length]}`;
    } catch {
      return;
    }
    const c = new Creature(e, 4);
    c.might = MIGHT;
    c.haste = HASTE;
    c.lethal = LETHAL;
    c.resync();
    c.set(PROP.visLo, 0);
    c.set(PROP.visHi, 8);
    c.set(PROP.gait, 1);
    const rec = freshRecord();
    rec.stage = "alive";
    rec.form = 4;
    rec.home = home;
    rec.born = rec.mut.formSince = store.rec.clock;
    rec.four = { debut: true, shots: 0, plate: null };
    const brain = new BrainTitan(c, rec, home);
    c.onBlow = (by, amount, heavy) => brain.onBlow(by, amount, heavy);
    this.list.set(e.id, { c, brain, rec, n });
    if (fresh) {
      tellNear(e.dimension, at3, `§4Titan ${TITAN_NAMES[n % TITAN_NAMES.length]}§7 stands here. (${this.list.size} of ${TITAN_MAX}.)`);
      brain.forced = { name: "roar", run: brain.roar(true), limit: 12 * TICKS.second };
    }
  }
  /** Make one here (the command and the config wheel).  Returns what happened, in words. */
  spawn(dim, at3, yaw) {
    if (dim.id !== OVERWORLD) return "A Titan can only stand in the Overworld.";
    if (this.list.size >= TITAN_MAX) return `There are ${TITAN_MAX} Titans in the world already: that is as many as there can be.`;
    if (!isLoaded(dim, at3)) return "That place is not loaded.";
    const before = this.list.size;
    try {
      const e = dim.spawnEntity(TITAN, at3, { initialRotation: yaw });
      this.inspect(e);
    } catch {
      return "A Titan could not be made here.";
    }
    return this.list.size > before ? "A Titan stands here." : "A Titan could not be made here.";
  }
  /** Take every Titan out of the world.  Returns how many there were. */
  clear() {
    const n = this.list.size;
    for (const t of [...this.list.values()]) this.drop(t, true);
    return n;
  }
  drop(t, remove) {
    let id = "";
    for (const [k, v] of this.list) if (v === t) id = k;
    t.c.dropParts();
    if (id) {
      this.list.delete(id);
      giants.delete(id);
      this.hurtCry.delete(id);
    }
    if (remove) {
      try {
        t.c.entity.setProperty(PROP.bound, false);
        t.c.entity.remove();
      } catch {
      }
    }
  }
  onRemoving(e) {
    const t = this.of(e);
    if (t) this.drop(t, false);
  }
  /**
   * A blow is about to land on a Titan.  Returns the damage it may do: all of it; or, when it would kill, none
   * (the Titan goes down in its own time, and is removed when it has).
   */
  beforeHurt(e, damage) {
    const t = this.of(e);
    if (!t) return damage;
    if (t.brain.dying) return 0;
    let health = 1;
    try {
      health = e.getComponent("minecraft:health")?.currentValue ?? 1;
    } catch {
      health = 1;
    }
    if (damage >= health - 1) {
      t.brain.dying = true;
      return 0;
    }
    return damage;
  }
  onHurt(e, by, amount) {
    const t = this.of(e);
    if (!t || amount <= 0) return;
    let player;
    try {
      if (by && by.typeId === "minecraft:player") player = by;
    } catch {
      player = void 0;
    }
    t.brain.onHurt(player);
    const now = store.rec.clock;
    if (amount >= 20 && now - (this.hurtCry.get(e.id) ?? -999) > 90 && !t.brain.dying) {
      this.hurtCry.set(e.id, now);
      t.c.say("basiliskra.hurt", t.c.anchor("nose"), 96, 1, 0.9);
    }
  }
  /** Health of each, for whoever is near enough to be watching the fight. */
  hud() {
    const rows = [];
    for (const t of this.list.values()) {
      let h = 0;
      try {
        h = t.c.entity.getComponent("minecraft:health")?.currentValue ?? 0;
      } catch {
        continue;
      }
      if (t.brain.dying) h = 0;
      const k = Math.max(0, Math.min(10, Math.ceil(h / TITAN_HEALTH * 10)));
      rows.push({ c: t.c, text: `§4${TITAN_NAMES[t.n % TITAN_NAMES.length]} §c${"█".repeat(k)}§8${"█".repeat(10 - k)} §7${Math.max(0, Math.round(h))}` });
    }
    rows.push(...this.extraRows());
    if (!rows.length) return;
    for (const p of players()) {
      try {
        if (holdsCounter(p)) continue;
        const mine = rows.filter((r) => r.c.dim.id === p.dimension.id && dist(r.c.pos, p.location) < 150);
        if (mine.length) p.onScreenDisplay.setActionBar(mine.map((r) => r.text).join("§r   "));
      } catch {
      }
    }
  }
  tick(now) {
    if (now % 20 === 7) {
      try {
        for (const e of store.loaded ? worldTitans() : []) this.inspect(e);
      } catch {
      }
    }
    for (const t of [...this.list.values()]) {
      if (!t.c.valid) {
        this.drop(t, false);
        continue;
      }
      t.brain.tick();
      if (t.brain.gone) {
        this.drop(t, true);
        continue;
      }
      t.c.update();
    }
    if (now % 10 === 3) this.hud();
  }
};
function worldTitans() {
  try {
    return world9.getDimension(OVERWORLD).getEntities({ type: TITAN });
  } catch {
    return [];
  }
}
var titans = new Titans();

// src/vathrok.ts
import { EntityDamageCause as EntityDamageCause10, ItemStack as ItemStack3, MolangVariableMap as MolangVariableMap5, world as world10 } from "@minecraft/server";
var VATHROK_MAX = { boss: 1, battle: 3 };
var ROMAN = ["I", "II", "III", "IV", "V"];
var BATTLE_SPEC = { range: 220, radius: 3.4, damage: 30 * GIANT, width: 4.2, carve: 5, fallout: 0 };
var BOSS_SPEC = { range: 130, radius: 2.2, damage: 8, width: 3.4, carve: 3.2, fallout: 0 };
var BOSS_HIT = { bite: 18, claws: 15, tail: 16, ram: 20 };
var BOSS_BLOW = { lunge: 60, tail: 90, ram: 80, swipe: 70 };
var TAG2 = "bk:vathrok";
var PROWL2 = 70;
var NEXT_KEY = "bk:vathrok_next";
var BrainVathrok = class extends BrainThree {
  constructor(c, own, home, battle) {
    super(c, own);
    this.dying = false;
    this.gone = false;
    this.reeling = false;
    this.bigAt = -999;
    this.big = [];
    this.chargeOn = false;
    this.battle = battle;
    this.home = { ...home };
    this.breathSpec = battle ? BATTLE_SPEC : BOSS_SPEC;
    this.giantSight = battle ? 240 : 140;
    this.voices = { step: "basiliskra.vathrok.step", grunt: "basiliskra.vathrok.huff" };
    c.set(PROP.gill, false);
  }
  onBlow(_by, _amount, heavy) {
    this.hurtAt = this.now;
    if (heavy && this.ready("reel")) {
      this.rest("reel", 5 * TICKS.second);
      this.reeling = true;
    }
  }
  onFinish() {
    super.onFinish();
    if (this.chargeOn) {
      this.chargeOn = false;
      stopSound(this.c.dim, "basiliskra.vathrok.charge", this.c.pos);
    }
  }
  n(blow) {
    return this.battle ? BLOW[blow] : BOSS_BLOW[blow];
  }
  hit(kind) {
    return this.battle ? LETHAL : BOSS_HIT[kind];
  }
  /** The nearest giant of ours that is not itself (the survival one minds only those that come near). */
  foe() {
    let best = null, bd = this.battle ? this.giantSight : 110;
    for (const g of otherGiants(this.c)) {
      const d = dist(g.pos, this.c.pos);
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }
  /** Whatever else it goes for: another add-on's giant, players (the survival one: these first), creatures. */
  quarry() {
    const c = this.c;
    if (this.now - this.bigAt >= 40) {
      this.bigAt = this.now;
      this.big = foreignGiantsNear(c.dim, c.pos, this.giantSight);
    }
    const alive2 = (e) => {
      try {
        return e.isValid;
      } catch {
        return false;
      }
    };
    const big = this.big.filter(alive2);
    const near = nearbyPlayers(c, this.battle ? 170 : 160);
    const order = this.battle ? [big, near] : [near, big];
    for (const list of order) if (list.length) return list[0];
    if (!CONFIG.huntMobs) return null;
    const mobs = mobsNear(c.dim, c.pos, 90).filter((e) => !giants.has(e.id));
    mobs.sort((a, b) => dist(a.location, c.pos) - dist(b.location, c.pos));
    return mobs[0] ?? null;
  }
  interrupt() {
    if (this.dying) return this.actName === "fall" ? null : { name: "fall", run: this.fall(), limit: 12 * TICKS.second };
    if (this.reeling) {
      this.reeling = false;
      if (["charge", "fire", "roar", "vent", "fall", "swipe"].includes(this.c.phase)) return null;
      return { name: "reel", run: this.reel(), limit: 3 * TICKS.second };
    }
    return null;
  }
  choose() {
    const c = this.c, now = this.now;
    const g = this.foe();
    const e = g ? g.entity : this.quarry();
    if (!e) {
      if (this.ready("rroar") && hash(now, 93) < 0.35) {
        this.rest("rroar", (60 + 80 * hash(now, 92)) * TICKS.second);
        return { name: "roar", run: this.vroar(), limit: 10 * TICKS.second };
      }
      return { name: "roam", run: this.roam(), limit: 60 * TICKS.second };
    }
    const foe = { giant: g, e };
    const at3 = this.where(foe);
    const d = distXZ(at3, c.pos), reach = c.girth + (g ? g.girth : 2);
    const bearing = wrapDeg(yawTo(c.pos, at3) - c.yaw);
    if (e.id !== this.lastQuarry) {
      this.lastQuarry = e.id;
      if (this.ready("lockroar")) {
        this.rest("lockroar", 40 * TICKS.second);
        return { name: "lock", run: this.challenge(foe), limit: 12 * TICKS.second };
      }
    }
    if (d < reach + 14) {
      if (Math.abs(bearing) > 55 && this.ready("tail")) {
        this.rest("tail", 6 * TICKS.second);
        return { name: "tail", run: this.tail(bearing >= 0 ? 1 : -1), limit: 4 * TICKS.second };
      }
      if (this.ready("lunge")) {
        this.rest("lunge", 3.5 * TICKS.second);
        return { name: "lunge", run: this.lunge(foe), limit: 5 * TICKS.second };
      }
      if (Math.abs(bearing) <= 60 && this.ready("swipe")) {
        this.rest("swipe", 6 * TICKS.second);
        return { name: "swipe", run: this.rake(foe), limit: 4 * TICKS.second };
      }
      if (g && this.ready("circle") && this.ready("tail")) {
        this.rest("circle", 9 * TICKS.second);
        return { name: "circle", run: this.circle(g), limit: 8 * TICKS.second };
      }
    }
    if (this.ready("beam") && now >= this.recoverUntil && d < this.breathSpec.range - 10 && d >= reach + 10) {
      if (clearLine(c.dim, c.anchor("mouth"), g ? g.middle() : aimOf(e))) {
        this.rest("beam", 15 * TICKS.second);
        return { name: "beam", run: this.breath(foe), limit: 20 * TICKS.second };
      }
    }
    if (g && d > reach + 34 && this.ready("ram")) {
      this.rest("ram", 22 * TICKS.second);
      return { name: "ram", run: this.ram(g), limit: 30 * TICKS.second };
    }
    if (d >= reach + 8) return { name: "pursue", run: this.close(foe), limit: 20 * TICKS.second };
    return { name: "square", run: this.square(foe), limit: 2 * TICKS.second };
  }
  where(f) {
    try {
      return f.giant && f.giant.valid ? f.giant.pos : f.e.location;
    } catch {
      return this.c.pos;
    }
  }
  middleOf(f) {
    try {
      return f.giant && f.giant.valid ? f.giant.middle() : aimOf(f.e);
    } catch {
      return this.c.pos;
    }
  }
  alive(f) {
    try {
      if (f.giant) return f.giant.valid && f.giant.dim.id === this.c.dim.id;
      return f.e.isValid && f.e.dimension.id === this.c.dim.id && (!isPlayer(f.e) || targetable(f.e));
    } catch {
      return false;
    }
  }
  *turnTo(at3, rate = 1.2, limit = 240) {
    const c = this.c;
    c.halt();
    for (let t = 0; t < limit; t++) {
      const want = yawTo(c.pos, at3);
      if (Math.abs(wrapDeg(want - c.yaw)) < 4) break;
      c.yaw = turnTowards(c.yaw, want, rate);
      c.setPhase(Math.abs(wrapDeg(want - c.yaw)) > 25 ? "move" : "idle");
      yield;
    }
    c.setPhase("idle");
  }
  /** Its roar: head up, jaws wide, the ground carrying it. */
  *vroar() {
    const c = this.c;
    c.halt();
    c.setPhase("roar");
    c.say("basiliskra.vathrok.roar", c.anchor("mouth"), 224);
    const fx = new RoarFx(c, true, 36, 6);
    for (let t = 0; t < 104; t++) {
      fx.tick();
      yield;
    }
    c.setPhase("idle");
  }
  *challenge(f) {
    yield* this.turnTo(this.where(f), 2.5, 60);
    this.c.lookAt(this.middleOf(f), 80, 40);
    yield* this.vroar();
  }
  /** Up to it, to within reach of its jaws. */
  *close(f) {
    const c = this.c;
    c.smash = true;
    for (let t = 0; t < 400 && this.alive(f); t++) {
      const at3 = this.where(f);
      const reach = c.girth + (f.giant ? f.giant.girth : 2) + 6;
      c.setPhase("move");
      c.goTo(at3, this.battle ? 0.22 : 0.18, reach);
      c.lookAt(this.middleOf(f), 60, 35);
      this.footfalls();
      if (distXZ(at3, c.pos) < reach + 1 || c.blocked > 60) break;
      if (t % 100 === 50) c.say("basiliskra.vathrok.growl", c.anchor("nose"), 96, 1, 0.95 + hash(t) * 0.1);
      yield;
    }
    c.halt();
    c.smash = false;
  }
  *square(f) {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 14 && this.alive(f); t++) {
      c.yaw = turnTowards(c.yaw, yawTo(c.pos, this.where(f)), 2.5);
      c.lookAt(this.middleOf(f), 70, 40);
      yield;
    }
  }
  /** A quarter of the way round another giant, at arm's length: it ends side-on to it, where its tail is. */
  *circle(foe) {
    const c = this.c;
    const side = hash(this.now, 83) < 0.5 ? 1 : -1;
    const r = c.girth + foe.girth + 8;
    const a = Math.atan2(c.pos.z - foe.pos.z, c.pos.x - foe.pos.x) + side * 1.25;
    const to = { x: foe.pos.x + Math.cos(a) * r, y: c.pos.y, z: foe.pos.z + Math.sin(a) * r };
    for (let t = 0; t < 130 && foe.valid; t++) {
      c.setPhase("move");
      c.goTo(to, 0.2, 3);
      c.lookAt(foe.middle(), 80, 40);
      this.footfalls();
      if (distXZ(to, c.pos) < 4 || c.blocked > 30) break;
      if (t > 30 && Math.abs(wrapDeg(yawTo(c.pos, foe.pos) - c.yaw)) > 65 && distXZ(foe.pos, c.pos) < r + 6) break;
      yield;
    }
    c.halt();
  }
  /** Where a blow lands: the noise of it, the shake, the green fire, the ground under it. */
  impact(at3, big) {
    const c = this.c;
    sound(c.dim, "random.explode", at3, 160, 1.6, big ? 0.5 : 0.62);
    sound(c.dim, "basiliskra.vathrok.step", at3, 160, 1, 0.6);
    particle(c.dim, "basiliskra:v_impact_blast", at3, 160);
    particle(c.dim, "basiliskra:impact_debris", at3, 128);
    particle(c.dim, "basiliskra:v_impact_ring", { x: at3.x, y: c.pos.y + 0.4, z: at3.z }, 160);
    particle(c.dim, "minecraft:huge_explosion_emitter", at3, 160);
    shake(c, 128, big ? 1.2 : 0.8, 0.5);
  }
  /** A blow on whatever stands in front of it: another giant there takes `giantN` and is thrown back. */
  strikeGiants(maxAngle, range, giantN, throwBack, sideOf = 0) {
    const c = this.c;
    let struck = false;
    for (const g of otherGiants(c)) {
      const b = wrapDeg(yawTo(c.pos, g.pos) - c.yaw);
      if (distXZ(g.pos, c.pos) > c.girth + g.girth + range) continue;
      if (sideOf ? b * sideOf < 35 : Math.abs(b) > maxAngle) continue;
      g.takeBlow(c, giantN, true);
      g.shove({ x: g.pos.x - c.pos.x, y: 0, z: g.pos.z - c.pos.z }, throwBack);
      this.impact({ x: (g.pos.x + c.pos.x) / 2, y: c.pos.y + 16, z: (g.pos.z + c.pos.z) / 2 }, throwBack > 6);
      struck = true;
    }
    return struck;
  }
  /** Its jaws: head drawn back, thrown forward with its whole body behind it. */
  *lunge(f) {
    const c = this.c;
    c.halt();
    yield* this.turnTo(this.where(f), 3, 24);
    c.lookAhead();
    c.setPhase("bite");
    c.say("basiliskra.vathrok.growl", c.anchor("nose"), 128, 1, 0.9);
    for (let t = 0; t < 25; t++) {
      if (t === 9) {
        const fw = forwardOf(c.yaw);
        const front = { x: c.pos.x + fw.x * (c.girth + 9), y: c.pos.y + 1, z: c.pos.z + fw.z * (c.girth + 9) };
        c.say("basiliskra.vathrok.bite", c.anchor("mouth"), 128);
        this.strikeGiants(60, 15, this.n("lunge"), 5);
        blast(c.dim, front, 9, this.hit("bite"), c.mobHit(30), 1.4, (p, n) => c.hurt(p, n), c.entity, c.pos);
        if (!f.giant && this.alive(f) && dist(f.e.location, front) < 11 && !isPlayer(f.e)) {
          try {
            f.e.applyDamage(c.mobHit(30), { cause: EntityDamageCause10.entityAttack, damagingEntity: c.entity });
          } catch {
          }
        }
      }
      yield;
    }
    c.setPhase("idle");
  }
  /** Its claws: it rears on its hind legs and rakes down with the arm on the side its head is turned to. */
  *rake(f) {
    const c = this.c;
    c.halt();
    yield* this.turnTo(this.where(f), 3, 20);
    const bearing = wrapDeg(yawTo(c.pos, this.where(f)) - c.yaw);
    const side = bearing >= 0 ? 1 : -1;
    c.lookYaw = 30 * side;
    c.lookPitch = 0;
    c.setPhase("swipe");
    for (let t = 0; t < 30; t++) {
      c.lookYaw = 30 * side;
      if (t === 8) c.say("basiliskra.vathrok.claw", c.anchor("mouth"), 128);
      if (t === 12) {
        const fw = forwardOf(c.yaw), l = leftOf(c.yaw);
        const reach = c.girth + 8;
        for (let k = -1; k <= 1; k++) {
          const at3 = add(c.pos, add(mul(fw, reach), mul(l, side * 6 + k * 4)));
          const mid = { x: at3.x, y: c.pos.y + 6 * c.scale / 1.7, z: at3.z };
          const v = new MolangVariableMap5();
          v.setFloat("variable.width", 4.2 * 2.4);
          v.setFloat("variable.spin", side * (40 + k * 6));
          particle(c.dim, "basiliskra:v_claw_scratch", mid, 192, v);
          if (k === 0) {
            particle(c.dim, "basiliskra:v_claw_glow", mid, 160, v);
            particle(c.dim, "basiliskra:v_claw_sparks", mid, 160, v);
          }
          const ground = { x: at3.x, y: c.pos.y + 1, z: at3.z };
          if (isLoaded(c.dim, ground) && wither()) carve(c.dim, ground, 3.2, 60, false);
          particle(c.dim, "basiliskra:v_step_dust", ground, 128);
        }
        this.strikeGiants(65, 16, this.n("swipe"), 3);
        blast(c.dim, add(c.pos, mul(fw, reach)), 10, this.hit("claws"), c.mobHit(28), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
        shake(c, 96, 0.6, 0.4);
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
  }
  /** The tail: it winds away, then lashes round to the side its head has turned to. */
  *tail(side) {
    const c = this.c;
    c.halt();
    c.lookYaw = 70 * side;
    c.lookPitch = 0;
    c.setPhase("sweep");
    c.say("basiliskra.vathrok.growl", c.anchor("nose"), 128, 1, 0.85);
    for (let t = 0; t < 36; t++) {
      c.lookYaw = 70 * side;
      if (t === 13) sound(c.dim, "basiliskra.vathrok.claw", c.anchor("club_core"), 160, 1, 0.7);
      if (t === 15) {
        const struck = this.strikeGiants(180, 30, this.n("tail"), 9, side);
        for (const deg of [65, 105, 145]) {
          const fw = forwardOf(c.yaw + deg * side);
          const at3 = { x: c.pos.x + fw.x * 26, y: c.pos.y + 1.5, z: c.pos.z + fw.z * 26 };
          if (!isLoaded(c.dim, at3)) continue;
          blast(c.dim, at3, 10, this.hit("tail"), c.mobHit(34), 1.8, (p, n) => c.hurt(p, n), c.entity, c.pos);
          if (wither()) carve(c.dim, at3, 4, 120, false);
          particle(c.dim, "basiliskra:v_step_dust", at3, 128);
        }
        if (!struck) shake(c, 96, 0.5, 0.4);
      }
      yield;
    }
    c.lookAhead();
    c.setPhase("idle");
  }
  /** Its whole weight at a run, at another giant: it does not stop until it has hit it or lost it. */
  *ram(foe) {
    const c = this.c;
    yield* this.turnTo(foe.pos, 2.5, 50);
    c.say("basiliskra.vathrok.growl", c.anchor("mouth"), 192, 1, 0.8);
    c.smash = true;
    for (let t = 0; t < 420; t++) {
      if (!foe.valid || foe.dim.id !== c.dim.id) break;
      const reach = c.girth + foe.girth;
      c.setPhase("move");
      c.goTo(foe.pos, 0.3, reach + 2);
      c.lookAt(foe.middle(), 60, 40);
      this.footfalls();
      if (distXZ(foe.pos, c.pos) < reach + 5) {
        const away = norm({ x: foe.pos.x - c.pos.x, y: 0, z: foe.pos.z - c.pos.z });
        foe.takeBlow(c, this.n("ram") * Math.min(1, 0.5 + c.speed / 0.5), true);
        foe.shove(away, 11);
        this.impact({ x: (foe.pos.x + c.pos.x) / 2, y: c.pos.y + 18, z: (foe.pos.z + c.pos.z) / 2 }, true);
        break;
      }
      if (c.blocked > 60) break;
      yield;
    }
    c.halt();
    c.smash = false;
    c.setPhase("idle");
    for (let t = 0; t < 12; t++) yield;
  }
  /** Its breath: braced on its arms, spines lighting from the tail up; a green line shows where it will go; then a
   *  torrent of green corroding fire, raked side to side across that place. */
  *breath(f) {
    const c = this.c, spec = this.breathSpec;
    let last = this.middleOf(f);
    const mark = () => {
      if (this.alive(f)) last = this.middleOf(f);
      return last;
    };
    yield* this.turnTo(this.where(f), 2.5, 50);
    c.setPhase("charge");
    c.say("basiliskra.vathrok.charge", c.anchor("mouth"), 192);
    this.chargeOn = true;
    let fixed = mark();
    for (let t = 0; t < 80; t++) {
      c.setCharge(Math.min(18, t / 70 * 18));
      if (t < 56) fixed = mark();
      c.trackTo(t < 56 ? fixed : fixed, 2.5, 80, 60);
      if (t % 4 === 0) particle(c.dim, "basiliskra:v_charge_gather", c.anchor("muzzle"), 160);
      if (t % 8 === 0) particle(c.dim, "basiliskra:v_plate_blaze", c.anchor(`plate_tip_${9 - Math.min(9, Math.floor(t / 8))}`), 160);
      if (t >= 56 && t % 2 === 0) {
        const { from } = c.aim();
        const dir = norm(sub(fixed, from));
        particle(c.dim, "basiliskra:v_beam_aim", from, 160, beamVars(dir, clearRange(c, from, dir, spec.range), 0.25 + 0.5 * ((t - 56) / 24)));
      }
      if (this.dying) return;
      yield;
    }
    this.chargeOn = false;
    stopSound(c.dim, "basiliskra.vathrok.charge", c.pos);
    c.setPhase("fire");
    c.setCharge(20);
    c.say("basiliskra.vathrok.beam", c.anchor("mouth"), 224);
    particle(c.dim, "basiliskra:v_muzzle_shock", c.anchor("muzzle"), 192);
    shake(c, 160, 0.9, 0.5);
    const st = { ground: null };
    const across = leftOf(yawTo(c.pos, fixed));
    const sweep = this.battle ? 14 : 8;
    for (let t = 0; t < 100; t++) {
      const goal = f.giant && f.giant.valid ? mark() : fixed;
      const k = Math.sin(t / 100 * Math.PI * 2) * Math.min(1, t / 15);
      c.trackTo(add(goal, mul(across, k * sweep)), 5, 80, 70);
      const fade = t < 85 ? 1 : (100 - t) / 15;
      beamTick(c, spec, t, fade, st, { scorch: (at3) => this.scorch(at3), clean: true });
      if (t % 10 === 0) shake(c, 128, 0.5, 0.4);
      if (this.dying) return;
      yield;
    }
    c.setCharge(0);
    c.setPhase("vent");
    c.say("basiliskra.vathrok.huff", c.anchor("nose"), 96);
    for (let t = 0; t < 30; t++) yield;
    c.setPhase("idle");
    this.rest("beam", (this.battle ? 16 : 22) * TICKS.second);
    this.recoverUntil = this.now + 3 * TICKS.second;
  }
  *reel() {
    const c = this.c;
    c.halt();
    c.setPhase("recoil");
    c.say("basiliskra.vathrok.hurt", c.anchor("nose"), 128);
    for (let t = 0; t < 18; t++) yield;
    c.setPhase("idle");
  }
  /** Round the place it was put down, or came up. */
  *roam() {
    const c = this.c, now = this.now;
    const a = hash(now, 51) * Math.PI * 2, r = 20 + hash(now, 52) * (PROWL2 - 20);
    const to = { x: this.home.x + Math.cos(a) * r, y: c.pos.y, z: this.home.z + Math.sin(a) * r };
    yield* this.walk(to, 0.14, 8, 900);
    c.setPhase("idle");
    for (let t = 0; t < 100; t++) {
      if (t === 30) c.say(hash(now, 17) < 0.5 ? "basiliskra.vathrok.huff" : "basiliskra.vathrok.growl", c.anchor("nose"), 96, 0.9);
      if (this.foe() || t % 20 === 0 && this.quarry()) break;
      yield;
    }
  }
  /** Come up out of the ground: the ground shakes, splits and smokes, and it roars. */
  *emerge() {
    const c = this.c;
    c.halt();
    c.setPhase("idle");
    for (let t = 0; t < 50; t++) {
      if (t % 4 === 0) {
        const a = hash(this.now, t) * Math.PI * 2, r = c.girth * (0.6 + hash(t, 7));
        const at3 = { x: c.pos.x + Math.cos(a) * r, y: c.pos.y + 0.5, z: c.pos.z + Math.sin(a) * r };
        particle(c.dim, "basiliskra:impact_debris", at3, 160);
        particle(c.dim, "basiliskra:v_step_dust", at3, 160);
        particle(c.dim, "basiliskra:v_impact_smoke", at3, 160);
      }
      if (t % 10 === 0) {
        shake(c, 192, 0.8, 0.6);
        sound(c.dim, "basiliskra.vathrok.step", c.pos, 192, 1, 0.5 + t * 4e-3);
      }
      yield;
    }
    particle(c.dim, "basiliskra:v_impact_ring", { x: c.pos.x, y: c.pos.y + 0.4, z: c.pos.z }, 192);
    particle(c.dim, "minecraft:huge_explosion_emitter", c.pos, 192);
    yield* this.vroar();
  }
  /** Beaten: it sinks onto its belly with a long groan, the light in its spines going out; then it is gone. */
  *fall() {
    const c = this.c;
    c.halt();
    c.smash = false;
    c.setCharge(0);
    c.lookAhead();
    c.setPhase("fall");
    c.say("basiliskra.vathrok.death", c.anchor("mouth"), 224);
    for (let t = 0; t < 96; t++) {
      c.setPhase("fall");
      if (t % 7 === 3) {
        const v = c.volumes();
        const at3 = v[Math.floor(hash(this.now, t) * v.length)].at;
        particle(c.dim, "basiliskra:v_impact_fire", at3, 160);
        particle(c.dim, "basiliskra:v_impact_smoke", at3, 160);
      }
      if (t === 72) {
        const fw = forwardOf(c.yaw);
        const at3 = { x: c.pos.x + fw.x * 6, y: c.pos.y + 0.5, z: c.pos.z + fw.z * 6 };
        particle(c.dim, "basiliskra:v_impact_ring", at3, 192);
        particle(c.dim, "basiliskra:v_step_dust", at3, 160);
        shake(c, 160, 1.4, 0.8);
        blast(c.dim, at3, 12, this.battle ? 8 : 6, c.mobHit(20), 1.6, (p, n) => c.hurt(p, n), c.entity, c.pos);
      }
      yield;
    }
    const mid = c.middle();
    for (const v of c.volumes()) if (hash(v.at.z, v.at.y) < 0.3) particle(c.dim, "basiliskra:v_impact_smoke", v.at, 192);
    particle(c.dim, "basiliskra:v_impact_glare", mid, 224);
    sound(c.dim, "random.explode", mid, 224, 2, 0.45);
    try {
      const n = this.battle ? 24 : 10 + Math.floor(hash(this.now, 5) * 6);
      c.dim.spawnItem(new ItemStack3(VATHROK_SCALE_ITEM, n), { x: c.pos.x, y: c.pos.y + 1.5, z: c.pos.z });
      c.dim.spawnItem(new ItemStack3(VATHROK_HEART_ITEM, 1), { x: c.pos.x + 1, y: c.pos.y + 1.5, z: c.pos.z });
      if (!this.battle) for (let k = 0; k < 24; k++) c.dim.spawnEntity("minecraft:xp_orb", { x: c.pos.x + (hash(k, 1) - 0.5) * 6, y: c.pos.y + 1.5, z: c.pos.z + (hash(k, 2) - 0.5) * 6 });
    } catch {
    }
    this.gone = true;
    yield;
  }
};
function tellNear2(dim, at3, msg) {
  for (const p of witnesses(dim, at3, 128)) {
    try {
      p.sendMessage(msg);
    } catch {
    }
  }
}
var isVathrok = (id) => id === VATHROK || id === VATHROK_TITAN;
var Vathroks = class {
  constructor() {
    this.list = /* @__PURE__ */ new Map();
    this.hurtCry = /* @__PURE__ */ new Map();
    this.comingAt = -1;
    this.pending = null;
  }
  creatures() {
    return [...this.list.values()].map((v) => v.c);
  }
  count(battle) {
    let n = 0;
    for (const v of this.list.values()) if (v.battle === battle) n++;
    return n;
  }
  of(e) {
    try {
      return this.list.get(e.id);
    } catch {
      return void 0;
    }
  }
  /** Is any of them at something just now (for the music)? */
  fighting() {
    for (const v of this.list.values()) if (v.c.valid && (v.brain.foe() || ["lock", "beam", "lunge", "swipe", "tail", "ram", "pursue"].includes(v.brain.actName))) return v.c;
    return null;
  }
  inspect(e) {
    let id, typeId, dimId, at3;
    try {
      if (!e.isValid) return;
      typeId = e.typeId;
      if (!isVathrok(typeId)) return;
      id = e.id;
      dimId = e.dimension.id;
      at3 = { ...e.location };
    } catch {
      return;
    }
    if (this.list.has(id)) return;
    const battle = typeId === VATHROK_TITAN;
    const refuse = (why) => {
      tellNear2(e.dimension, at3, `§7${why}`);
      try {
        e.remove();
      } catch {
      }
    };
    if (battle ? !CONFIG.vathrokTitan : !CONFIG.vathrok) return refuse(battle ? "The Vathrok Titan is turned off in the settings." : "Vathrok is turned off in the settings.");
    if (dimId !== OVERWORLD) return refuse("Vathrok can only stand in the Overworld.");
    const max = battle ? VATHROK_MAX.battle : VATHROK_MAX.boss;
    if (this.count(battle) >= max) return refuse(battle ? `There are ${max} Vathrok Titans in the world already: that is as many as there can be.` : "Vathrok is in the world already: there is only one.");
    this.adopt(e, at3, battle, false);
  }
  adopt(e, at3, battle, rising) {
    let saved = null;
    try {
      const s = e.getDynamicProperty(TAG2);
      if (typeof s === "string") saved = JSON.parse(s);
    } catch {
      saved = null;
    }
    const taken = new Set([...this.list.values()].filter((v) => v.battle === battle).map((v) => v.n));
    let n = saved && Number.isInteger(saved.n) && !taken.has(saved.n) ? saved.n : -1;
    if (n < 0) for (n = 0; taken.has(n); n++) {
    }
    const home = saved && Array.isArray(saved.home) ? { x: saved.home[0], y: saved.home[1], z: saved.home[2] } : at3;
    const fresh = !saved;
    const name = battle ? `Vathrok Titan ${ROMAN[n % ROMAN.length]}` : "Vathrok";
    try {
      e.triggerEvent("basiliskra:bind");
      e.setDynamicProperty(TAG2, JSON.stringify({ n, home: [Math.round(home.x), Math.round(home.y), Math.round(home.z)] }));
      e.nameTag = name;
    } catch {
      return;
    }
    const c = new Creature(e, 5);
    c.might = battle ? 3 : 1;
    c.haste = battle ? 1.35 : 1.1;
    c.lethal = battle ? LETHAL : 0;
    c.hue = "v";
    c.resync();
    c.set(PROP.visLo, 0);
    c.set(PROP.visHi, 8);
    c.set(PROP.gait, 1);
    const rec = freshRecord();
    rec.stage = "alive";
    rec.form = 3;
    rec.home = home;
    rec.born = rec.mut.formSince = store.rec.clock;
    const brain = new BrainVathrok(c, rec, home, battle);
    c.onBlow = (by, amount, heavy) => brain.onBlow(by, amount, heavy);
    this.list.set(e.id, { c, brain, rec, battle, n });
    if (fresh) {
      tellNear2(e.dimension, at3, battle ? `§2${name}§7 stands here. (${this.count(true)} of ${VATHROK_MAX.battle}.)` : "§2Vathrok§7 has come up out of the ground.");
      brain.forced = rising || !battle ? { name: "emerge", run: brain.emerge(), limit: 12 * TICKS.second } : { name: "roar", run: brain.vroar(), limit: 10 * TICKS.second };
    }
  }
  /** Make one here (the command, the wheel, the lure).  Returns what happened, in words. */
  spawn(dim, at3, yaw, battle) {
    if (battle ? !CONFIG.vathrokTitan : !CONFIG.vathrok) return battle ? "The Vathrok Titan is turned off in the settings." : "Vathrok is turned off in the settings.";
    if (dim.id !== OVERWORLD) return "Vathrok can only stand in the Overworld.";
    const max = battle ? VATHROK_MAX.battle : VATHROK_MAX.boss;
    if (this.count(battle) >= max) return battle ? `There are ${max} Vathrok Titans in the world already.` : "Vathrok is in the world already: there is only one.";
    if (!isLoaded(dim, at3)) return "That place is not loaded.";
    const before = this.list.size;
    try {
      const e = dim.spawnEntity(battle ? VATHROK_TITAN : VATHROK, at3, { initialRotation: yaw });
      this.inspect(e);
    } catch {
      return "Vathrok could not be made here.";
    }
    if (this.list.size <= before) return "Vathrok could not be made here.";
    return battle ? "A Vathrok Titan stands here." : "Vathrok is coming up out of the ground.";
  }
  /**
   * The lure, used by a player: the ground shakes, and a few seconds later Vathrok comes up out of it some way off.
   * Returns false (and says why) if it cannot come.
   */
  lure(p) {
    const say = (m) => {
      try {
        p.sendMessage(`§7[Basiliskra] ${m}`);
      } catch {
      }
    };
    if (!CONFIG.vathrok) {
      say("Vathrok is turned off in the settings.");
      return false;
    }
    if (p.dimension.id !== OVERWORLD) {
      say("Vathrok only lives in the Overworld.");
      return false;
    }
    if (this.count(false) >= VATHROK_MAX.boss || this.comingAt >= 0) {
      say("Vathrok is already in the world.");
      return false;
    }
    const at3 = this.groundNear(p.dimension, p.location, 50, 70);
    if (!at3) {
      say("The ground here will not let it up. Try in the open.");
      return false;
    }
    this.comingAt = store.rec.clock;
    for (const w of witnesses(p.dimension, p.location, 96)) {
      try {
        w.sendMessage("§2The ground is shaking...");
        w.runCommand("camerashake add @s 0.3 4 positional");
      } catch {
      }
    }
    sound(p.dimension, "basiliskra.vathrok.growl", at3, 192, 1, 0.6);
    const dim = p.dimension, yaw = yawTo(at3, p.location);
    this.pending = { dim, at: at3, yaw, t: store.rec.clock + 80 };
    return true;
  }
  /** A place on open ground between `r0` and `r1` blocks from `from` (the first of twelve bearings that has one). */
  groundNear(dim, from, r0, r1) {
    for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2 + hash(store.rec.clock, 3) * 6.28;
      const r = r0 + (r1 - r0) * hash(k, store.rec.clock);
      const x = from.x + Math.cos(a) * r, z = from.z + Math.sin(a) * r;
      if (!isLoaded(dim, { x, y: from.y, z })) continue;
      const g = groundY(dim, x, z, from.y + 30, 60);
      if (typeof g !== "number") continue;
      try {
        const b = dim.getBlock({ x: Math.floor(x), y: Math.floor(g) - 1, z: Math.floor(z) });
        if (!b || b.isLiquid || b.typeId.includes("water")) continue;
      } catch {
        continue;
      }
      return { x, y: g, z };
    }
    return null;
  }
  /** Take them out of the world: `which` the survival one, the battle ones, or both.  Returns how many there were. */
  clear(which = "all") {
    let n = 0;
    for (const v of [...this.list.values()]) {
      if (which === "all" || which === "battle" === v.battle) {
        this.drop(v, true);
        n++;
      }
    }
    return n;
  }
  drop(v, remove) {
    let id = "";
    for (const [k, x] of this.list) if (x === v) id = k;
    v.c.dropParts();
    if (id) {
      this.list.delete(id);
      giants.delete(id);
      this.hurtCry.delete(id);
    }
    if (remove) {
      try {
        v.c.entity.setProperty(PROP.bound, false);
        v.c.entity.remove();
      } catch {
      }
    }
  }
  onRemoving(e) {
    const v = this.of(e);
    if (v) this.drop(v, false);
  }
  /** A blow is about to land: all of it, or, when it would kill, none (it goes down in its own time). */
  beforeHurt(e, damage) {
    const v = this.of(e);
    if (!v) return damage;
    if (v.brain.dying) return 0;
    let health = 1;
    try {
      health = e.getComponent("minecraft:health")?.currentValue ?? 1;
    } catch {
      health = 1;
    }
    if (damage >= health - 1) {
      v.brain.dying = true;
      return 0;
    }
    return damage;
  }
  onHurt(e, by, amount) {
    const v = this.of(e);
    if (!v || amount <= 0) return;
    let player;
    try {
      if (by && by.typeId === "minecraft:player") player = by;
    } catch {
      player = void 0;
    }
    v.brain.onHurt(player);
    v.brain.hurtAt = store.rec.clock;
    const now = store.rec.clock;
    if (amount >= (v.battle ? 20 : 6) && now - (this.hurtCry.get(e.id) ?? -999) > 90 && !v.brain.dying) {
      this.hurtCry.set(e.id, now);
      v.c.say("basiliskra.vathrok.hurt", v.c.anchor("nose"), 128);
    }
  }
  /** Rows for the health line over the hotbar (the battle ones; the survival one has a boss bar). */
  rows() {
    const out = [];
    for (const v of this.list.values()) {
      if (!v.battle) continue;
      let h = 0;
      try {
        h = v.c.entity.getComponent("minecraft:health")?.currentValue ?? 0;
      } catch {
        continue;
      }
      if (v.brain.dying) h = 0;
      const k = Math.max(0, Math.min(10, Math.ceil(h / VATHROK_HEALTH * 10)));
      out.push({ c: v.c, text: `§2Vathrok ${ROMAN[v.n % ROMAN.length]} §a${"█".repeat(k)}§8${"█".repeat(10 - k)} §7${Math.max(0, Math.round(h))}` });
    }
    return out;
  }
  /**
   * Now and then, at night, the survival one comes by itself: at most once every three in-game days, and then only
   * one night in four, near a player in Survival or Adventure standing on land in the Overworld.
   */
  natural(now) {
    if (!CONFIG.vathrok || this.count(false) > 0 || this.pending) return;
    let tod = 0;
    try {
      tod = world10.getTimeOfDay();
    } catch {
      return;
    }
    if (tod < 15e3 || tod > 21e3) return;
    let next = 0;
    try {
      next = Number(world10.getDynamicProperty(NEXT_KEY) ?? 0);
    } catch {
      next = 0;
    }
    if (now < next) return;
    const ps = players().filter((p2) => {
      try {
        return p2.dimension.id === OVERWORLD && targetable(p2);
      } catch {
        return false;
      }
    });
    if (!ps.length) return;
    const comes = hash(now, 62) < 0.25;
    try {
      world10.setDynamicProperty(NEXT_KEY, now + (comes ? 3 : 1) * TICKS.day - 2e3);
    } catch {
      return;
    }
    if (!comes) return;
    const p = ps[Math.floor(hash(now, 63) * ps.length)];
    const at3 = this.groundNear(p.dimension, p.location, 60, 90);
    if (!at3) {
      try {
        world10.setDynamicProperty(NEXT_KEY, now + 600);
      } catch {
      }
      return;
    }
    for (const w of witnesses(p.dimension, p.location, 128)) {
      try {
        w.sendMessage("§2The ground is shaking...");
      } catch {
      }
    }
    this.pending = { dim: p.dimension, at: at3, yaw: yawTo(at3, p.location), t: now + 80 };
  }
  tick(now) {
    if (now % 20 === 11) {
      try {
        for (const e of store.loaded ? worldVathroks() : []) this.inspect(e);
      } catch {
      }
      for (const v of [...this.list.values()]) {
        if (v.battle ? !CONFIG.vathrokTitan : !CONFIG.vathrok) {
          tellNear2(v.c.dim, v.c.pos, v.battle ? "§7The Vathrok Titan is turned off: it is gone." : "§7Vathrok is turned off: it is gone.");
          this.drop(v, true);
        }
      }
    }
    if (now % 600 === 300) this.natural(now);
    if (this.pending && now >= this.pending.t) {
      const { dim, at: at3, yaw } = this.pending;
      this.pending = null;
      this.comingAt = -1;
      try {
        if (CONFIG.vathrok && this.count(false) === 0 && isLoaded(dim, at3)) {
          const e = dim.spawnEntity(VATHROK, at3, { initialRotation: yaw });
          this.inspect(e);
        }
      } catch {
      }
    }
    for (const v of [...this.list.values()]) {
      if (!v.c.valid) {
        this.drop(v, false);
        continue;
      }
      v.brain.tick();
      if (v.brain.gone) {
        this.drop(v, true);
        continue;
      }
      v.c.update();
    }
  }
};
function worldVathroks() {
  try {
    const d = world10.getDimension(OVERWORLD);
    return [...d.getEntities({ type: VATHROK }), ...d.getEntities({ type: VATHROK_TITAN })];
  } catch {
    return [];
  }
}
var vathroks = new Vathroks();

// src/ui.ts
var ROMAN2 = ["", "I", "II", "III", "IV"];
var FALLOUT = ["off", "visual", "land"];
var DUSK = 11800;
function canAdmin(p) {
  try {
    if (p.playerPermissionLevel === PlayerPermissionLevel.Operator) return true;
  } catch {
  }
  try {
    return world11.getAllPlayers().length <= 1;
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
function compass2(from, to) {
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
  L.push(here ? `§fNear you §7(the 64-block area ${where})` : `§fThe angriest area: ${where} §7(${compass2(p.location, a.center)})`);
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
  if (rec.evolve) {
    L.push("§cHe is changing right now.");
    return L;
  }
  if (rec.form < 4) {
    const need = changeTicks(rec.form), since = Math.max(0, now - rec.mut.formSince), f = Math.min(1, since / need);
    const left = Math.max(0, need - since);
    L.push(`§fBecoming Basiliskra ${ROMAN2[rec.form + 1]}: ${bar(f, rec.form === 3 ? "§4" : "§6")} §l${pct(f)}§r`);
    L.push(f >= 1 ? "  §aThe time is up: he changes as soon as he is free to." : `  §7Only time: §f${left >= TICKS.minute ? `${Math.ceil(left / TICKS.minute)} min` : `${Math.ceil(left / TICKS.second)} s`}§7 left of ${Math.round(need / TICKS.minute)} min as Basiliskra ${ROMAN2[rec.form]}.`);
    L.push("  §8Nothing else is needed. The config wheel can set the minutes, or make him change at once.");
  } else L.push("§4Basiliskra IV is his last form.");
  if (rec.form >= 3) {
    L.push(rec.form === 4 ? "§fThe last crossing §8(it still sends him home)" : "§fThe last crossing §8(sends him home)");
    L.push("  §7Carry his shed fin to the seam; play his three knocks on note blocks near it and keep playing; lead his charge into a lightning rod near the seam.");
  }
  return L;
}
function comingLines(p, ctl2) {
  const rec = store.rec, now = rec.clock, L = [];
  const tod = world11.getTimeOfDay();
  const toDusk = tod >= DUSK && tod < 13800 ? 0 : (DUSK - tod + 24e3) % 24e3;
  switch (rec.stage) {
    case "dormant":
      L.push("§7Not yet. When one place reaches §f100%§7 he is called through deep water near it.");
      L.push("§7He needs open water about §f6 blocks deep§7 with a clear run of about §f45 blocks§7 within ~90 blocks of that place. Harm far inland calls no one.");
      break;
    case "pending": {
      const pd = rec.pending;
      L.push(`§eHe has been called§7, by what was done near §f${Math.floor(pd.site.x)}, ${Math.floor(pd.site.z)}§7 (${compass2(p.location, pd.site)}).`);
      L.push(`§7He is looking for deep, open water there (search ${Math.min(12, (pd.passes ?? 0) + 1)} of 12). Someone must be within 128 blocks of that place.`);
      if ((pd.passes ?? 0) >= 4) L.push("§7No water has been deep and open enough so far. Harm nearer a coast or a big lake will call him there instead.");
      break;
    }
    case "arriving": {
      const a = rec.arrival;
      if (a.step === 0) {
        L.push(`§eHe is coming§7, through the water at §f${at(a.water)}§7 (${compass2(p.location, a.water)}).`);
        L.push(toDusk === 0 ? "§7At dusk, which is now: someone must be within 96 blocks of that water." : `§7At the next dusk, in §f${mins(toDusk)}§7, while someone is within 96 blocks of that water.`);
      } else L.push(`§cHe is coming through now§7, at §f${at(a.water)}§7 (${compass2(p.location, a.water)}).`);
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
        L.push(`§cBasiliskra ${ROMAN2[rec.form]} is here§7, ${compass2(p.location, c.pos)}.${hp}`);
      } else if (rec.entityId === null && rec.down !== null) {
        const left = pace(TICKS.day) - (now - rec.down);
        L.push(`§7Driven off. He comes back through the seam at §f${rec.rift ? at(rec.rift) : "the old place"}§7 in §f${mins(left)}§7, when someone is near it.`);
      } else if (rec.last) {
        L.push(`§7Basiliskra ${ROMAN2[rec.form]} is out of reach. Last seen near §f${at(rec.last)}§7 (${compass2(p.location, rec.last)}), ${mins(now - rec.last.t)} ago.`);
      } else L.push(`§7Basiliskra ${ROMAN2[rec.form]} is out of reach.`);
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
  let at3;
  try {
    if (p.dimension.id !== OVERWORLD) return ["§7Only the Overworld carries his fallout."];
    at3 = p.location;
  } catch {
    return L;
  }
  const d = doseAt(at3, now);
  const word = d < 0.03 ? "§anone to speak of" : d < 0.2 ? "§6low" : d < 0.45 ? "§6rising" : d < 0.75 ? "§chigh" : "§4deadly";
  L.push(`§fRadiation where you stand: ${bar(Math.min(1, d))} §l${pct(d)}§r  ${word}`);
  const n = nearestFallout(at3, now), count = falloutCount(now);
  if (!n) L.push("§7No fallout on record. His beam, his changes and his seam leave it where they touch the world.");
  else {
    L.push(`§7Fallout in §f${count}§7 place${count === 1 ? "" : "s"}. The nearest is ${compass2(at3, n.zone)}, at §f${pct(n.strength)}§7.`);
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
  const top2 = angriest(now);
  if (top2 && (!here || top2.key !== here.key)) {
    L.push("");
    L.push(...angerLines(p, top2, false));
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
  const d = [0, 15, 24, 46, 52, 56][form] ?? 30;
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
var MINUTES = [0, 1, 2, 5, 10, 20, 30, 60];
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
  ], { defaultValueIndex: Math.max(0, TERRAIN.indexOf(CONFIG.terrain)) }).toggle("Spare chests, beds, furnaces and portals", { defaultValue: CONFIG.spareStorage }).toggle("Footprints and furrows in natural ground", { defaultValue: CONFIG.marks }).dropdown("Damage to players", dmg.items, { defaultValueIndex: dmg.index }).textField("...or type a damage multiplier (0 to 4)", "e.g. 0.75").toggle("Harmless on Peaceful", { defaultValue: CONFIG.harmlessOnPeaceful }).toggle("He hunts animals and other creatures too", { defaultValue: CONFIG.huntMobs }).toggle("Spawn eggs and /summon bring him to you", { defaultValue: CONFIG.allowSummon }).dropdown("A spawn egg makes", ["His stage in the story", "Basiliskra I", "Basiliskra II", "Basiliskra III", "Basiliskra IV"], { defaultValueIndex: CONFIG.spawnForm }).toggle("Give new players the journal", { defaultValue: CONFIG.giveJournal }).toggle("Give operators the config wheel", { defaultValue: CONFIG.giveWheel }).toggle("Debug messages in the content log", { defaultValue: CONFIG.debug }).dropdown("His fallout", ["Off", "Glowing motes and Geiger clicks only", "Also changes the land (natural ground only)"], { defaultValueIndex: FALLOUT.indexOf(CONFIG.fallout) }).toggle("Radiation sickness for players", { defaultValue: CONFIG.sickness }).toggle("Cutscenes (the rift, each transformation)", { defaultValue: CONFIG.cutscenes }).toggle("His music", { defaultValue: CONFIG.music }).dropdown(
    "Minutes in each form before he changes (time is all it takes)",
    MINUTES.map((m) => m ? `${m} minutes` : "The story's timing: 40, 40, 60 (at story speed 1)"),
    { defaultValueIndex: Math.max(0, MINUTES.indexOf(CONFIG.changeMinutes)) }
  ).toggle("Cities rise on coasts as you explore (never over anything built)", { defaultValue: CONFIG.cities }).toggle("Vathrok in survival (comes up at night now and then, and to its lure; can be beaten)", { defaultValue: CONFIG.vathrok }).toggle("The Vathrok Titan for battles (its egg, the command, the wheel)", { defaultValue: CONFIG.vathrokTitan }).toggle("§cRestore every default", { defaultValue: false }).submitButton("Save");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || !r.formValues) return;
  const v = r.formValues;
  if (v[22] === true) {
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
    music: v[17] === true,
    changeMinutes: MINUTES[Number(v[18])] ?? 0,
    cities: v[19] === true,
    vathrok: v[20] === true,
    vathrokTitan: v[21] === true
  });
  p.sendMessage(`§7[Basiliskra] Settings saved with this world. Story speed §fx${CONFIG.pacing}§7, damage §fx${CONFIG.damage}§7.`);
  if (bad) p.sendMessage("§7[Basiliskra] A number you typed was not in range, so the choice above it was used.");
}
async function bringForm(p, ctl2) {
  const f = new ActionFormData().title("Bring him here").body(`§7The one Basiliskra comes to you: moved here if he is about, made here if he is not. There is never more than one.
§7Now: ${store.rec.born > 0 ? `Basiliskra ${ROMAN2[store.rec.form]}` : "he has never come"}.`).button("As he is in the story").button("Basiliskra I (the water)").button("Basiliskra II (the shore)").button("Basiliskra III (four footfalls)").button("Basiliskra IV (the last form)");
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
async function confirm(p, title, body2) {
  const f = new MessageFormData().title(title).body(body2).button1("Yes").button2("No");
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
  const state = here ? `§cBasiliskra ${ROMAN2[rec.form]} is here` : rec.stage === "arriving" ? "§ehe is coming through" : rec.stage === "alive" ? `§7Basiliskra ${ROMAN2[rec.form]} is away, owed back` : "§7he is not in this world";
  const f = new ActionFormData().title("Basiliskra Config Wheel").body(`${state}§7 · Story speed §fx${CONFIG.pacing}§7 · Damage §fx${CONFIG.damage}`).button("Settings").button("Call him now (the rift opens)").button("Bring him here (no rift, pick a form)").button("Make him change now (next form)").button("Send him away (until he is called)").button("Skip to dusk").button("Journal").button("§cReset the story").button("Raise a city here (a beach, and a very deep sea)").button(`Put a Titan here (for battles: ${titans.count} of ${TITAN_MAX})`).button("Remove the Titans").button(`Put a Vathrok Titan here (for battles: ${vathroks.count(true)} of ${VATHROK_MAX.battle})`).button("Call Vathrok (the one met in survival)").button("Remove every Vathrok");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled) return;
  switch (r.selection) {
    case 9: {
      const place2 = placeFor(p, 4);
      p.sendMessage(`§7[Basiliskra] ${titans.spawn(p.dimension, place2.at, place2.yaw)}`);
      break;
    }
    case 10:
      p.sendMessage(`§7[Basiliskra] ${titans.clear()} Titan(s) removed.`);
      break;
    case 11:
    case 12: {
      const place2 = placeFor(p, 5);
      p.sendMessage(`§7[Basiliskra] ${vathroks.spawn(p.dimension, place2.at, place2.yaw, r.selection === 11)}`);
      break;
    }
    case 13:
      p.sendMessage(`§7[Basiliskra] ${vathroks.clear()} Vathrok(s) removed.`);
      break;
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
      world11.setTimeOfDay(DUSK + 100);
      p.sendMessage("§7[Basiliskra] Dusk.");
      break;
    case 6:
      await openJournal(p, ctl2);
      break;
    case 8:
      await cityForm(p);
      break;
    case 7:
      if (await confirm(p, "Reset the story", "Forget him, his form, everything he has learned and all the anger on record, as if the pack had just been added. He is removed from the world.")) {
        ctl2.resetStory();
        p.sendMessage("§7[Basiliskra] The story has been reset.");
      }
      break;
  }
}
async function cityForm(p) {
  if (!canAdmin(p)) {
    p.sendMessage("§7[Basiliskra] Only an operator can raise a city.");
    return;
  }
  if (p.dimension.id !== OVERWORLD) {
    p.sendMessage("§7[Basiliskra] Cities stand in the Overworld.");
    return;
  }
  const f = new ActionFormData().title("Raise a city here").body("§7You will be standing on its promenade. §fBehind you§7: streets, towers, houses, people. §fAhead of you§7 (the way you are looking): a beach, and beyond it a sea cut a hundred blocks deep, with things on the bottom.\n§cEverything in that area is replaced§7: about 265 by 215 blocks of city and beach, and 265 by 140 of sea (a small one: 95 by 100, and 95 by 80). A full city takes about two minutes to rise, a small one about twenty seconds; you are told as each quarter is done.").button("A full city (259 by 175)").button("A small one (91 by 63)").button("Not here");
  const r = await present(p, () => f.show(p));
  if (!r || r.canceled || r.selection === void 0 || r.selection > 1) return;
  let v = { x: 0, y: 0, z: 1 };
  try {
    v = p.getViewDirection();
  } catch {
  }
  const dir = Math.abs(v.z) >= Math.abs(v.x) ? v.z >= 0 ? 0 : 2 : v.x < 0 ? 1 : 3;
  const at3 = { ...p.location };
  const said = raiseCity(at3, dir, r.selection === 1);
  p.sendMessage(`§7[Basiliskra] ${said}`);
  if (/rising/.test(said)) {
    try {
      p.teleport({ x: at3.x, y: Math.max(64, Math.min(83, Math.floor(at3.y))) + 1.2, z: at3.z });
    } catch {
    }
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
      const left = p.getComponent("minecraft:inventory")?.container?.addItem(new ItemStack4(id, 1));
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
import { EasingType, HudElement, HudVisibility } from "@minecraft/server";
var FLAG = "bk:film";
var HUD = [
  HudElement.PaperDoll,
  HudElement.Armor,
  HudElement.ToolTips,
  HudElement.Crosshair,
  HudElement.Hotbar,
  HudElement.Health,
  HudElement.ProgressBar,
  HudElement.Hunger,
  HudElement.AirBubbles,
  HudElement.HorseHealth,
  HudElement.StatusEffects,
  HudElement.ItemText
];
var span = (v, k) => typeof v === "number" ? v : v[0] + (v[1] - v[0]) * k;
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
        if (o.cinema) {
          try {
            p.onScreenDisplay.setHudVisibility(HudVisibility.Hide, HUD);
          } catch {
          }
        }
        if (o.flash) p.camera.fade({ fadeColor: o.flash, fadeTime: { fadeInTime: 0.1, holdTime: 0.15, fadeOutTime: 0.7 } });
      } catch {
      }
    }
    this.aim();
  }
  /** A place the camera can stand: not inside a block, not under the ground, and able to see what it looks at. */
  stand(want, look) {
    let best = null;
    for (const [kd, up] of [[1, 0], [1, 3], [0.85, 6], [0.7, 10], [0.55, 16], [0.4, 24]]) {
      const q = { x: look.x + (want.x - look.x) * kd, y: want.y + up, z: look.z + (want.z - look.z) * kd };
      if (!isLoaded(this.dim, q)) continue;
      const g = groundY(this.dim, q.x, q.z, q.y + 12, 40);
      if (typeof g === "number" && q.y < g + 1.6) q.y = g + 1.6;
      const here = blockAt(this.dim, q);
      if (here && isSolidBlock(here)) continue;
      if (clearLine(this.dim, q, look)) return q;
      best ??= q;
    }
    return best;
  }
  /** The shot that is playing, which it is, and how far through it the film is (0..1). */
  shot() {
    const shots = this.o.shots;
    if (!shots || !shots.length) return null;
    let t = this.t, i = 0;
    for (const s of shots) {
      if (t < s.ticks) return { s, k: t / Math.max(1, s.ticks - 1), first: t < 2, i };
      t -= s.ticks;
      i++;
    }
    return { s: shots[shots.length - 1], k: 1, first: false, i: shots.length - 1 };
  }
  aimShot() {
    const cur = this.shot();
    if (!cur) return;
    const { s, first } = cur;
    const k = cur.k * cur.k * (3 - 2 * cur.k);
    let look;
    try {
      look = (s.look ?? this.focus)();
    } catch {
      look = this.focus();
    }
    const drift = s.still !== false && typeof s.angle === "number" ? (cur.i % 2 ? 1 : -1) * 7 * (cur.k - 0.5) : 0;
    const creep = s.still !== false && typeof s.dist === "number" ? 1 - 0.08 * cur.k : 1;
    const f = forwardOf((this.o.facing?.() ?? 0) + span(s.angle, k) + drift);
    const d = span(s.dist, k) * creep;
    const at3 = this.stand({ x: look.x + f.x * d, y: look.y + span(s.height, k), z: look.z + f.z * d }, look);
    if (!at3) return;
    for (const { p } of this.cast) {
      try {
        if (!p.isValid || p.dimension.id !== this.dim.id) continue;
        if (first) {
          if (this.t > 1 && s.dip) p.camera.fade({ fadeColor: { red: s.dip.red, green: s.dip.green, blue: s.dip.blue }, fadeTime: { fadeInTime: 0.05, holdTime: s.dip.hold ?? 0.2, fadeOutTime: 0.45 } });
          else if (this.t > 1) p.camera.fade({ fadeColor: { red: 0, green: 0, blue: 0 }, fadeTime: { fadeInTime: 0, holdTime: 0.05, fadeOutTime: 0.2 } });
          p.camera.setCamera("minecraft:free", { location: at3, facingLocation: look });
        } else p.camera.setCamera("minecraft:free", { location: at3, facingLocation: look, easeOptions: { easeTime: 0.15, easeType: EasingType.Linear } });
      } catch {
      }
    }
  }
  aim() {
    if (this.o.shots) {
      this.aimShot();
      return;
    }
    const o = this.o, f = this.focus(), k = Math.min(1, this.t / Math.max(1, o.ticks));
    const d = o.dist + ((o.distEnd ?? o.dist) - o.dist) * k;
    for (const { p, base } of this.cast) {
      try {
        if (!p.isValid || p.dimension.id !== this.dim.id) continue;
        const a = base + (o.orbit ?? 0) * Math.PI / 180 * (k - 0.5);
        let at3 = null;
        for (const [kd, kh] of [[1, 1], [1, 1.8], [0.7, 1.4], [0.45, 1.2], [0.3, 2.2]]) {
          const q = { x: f.x + Math.cos(a) * d * kd, y: f.y + o.height * kh, z: f.z + Math.sin(a) * d * kd };
          if (!isLoaded(this.dim, q)) continue;
          if (clearLine(this.dim, q, f)) {
            at3 = q;
            break;
          }
          at3 ??= q;
        }
        if (!at3) continue;
        p.camera.setCamera("minecraft:free", { location: at3, facingLocation: f, easeOptions: { easeTime: 0.25, easeType: EasingType.Linear } });
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
    for (const card of this.o.cards ?? []) {
      if (card.at !== this.t) continue;
      for (const { p } of this.cast) {
        try {
          p.onScreenDisplay.setTitle(card.title, { subtitle: card.sub, fadeInDuration: 10, stayDuration: card.stay ?? 50, fadeOutDuration: 16 });
        } catch {
        }
      }
    }
    if (this.t % 2 === 0 || this.o.shots) this.aim();
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
    p.onScreenDisplay.setHudVisibility(HudVisibility.Reset, HUD);
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
function sceneTheme(theme, ticks, at3, dim) {
  scene = { theme, until: store.rec.clock + ticks, at: { ...at3 }, dim };
}
var FIGHT = /* @__PURE__ */ new Set([
  "charge",
  "beam",
  "remember",
  "scatter",
  "lock",
  "pursue",
  "raze",
  "arc",
  "pin",
  "flinch",
  "boat",
  // 2.3: fighting another giant
  "leap",
  "close",
  "bite",
  "tail",
  "lunge",
  "swipe",
  "square"
]);
var fightUntil = -1;
function themeFor(c, now, doing, hurtAt, battle) {
  if (scene && now < scene.until) return scene.theme;
  if (!c || !c.valid) return null;
  if (store.rec.ending?.step || store.rec.evolve) return "last";
  if (battle) return "wrath";
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
function musicTick(c, now, doing = "", hurtAt = -1, battle = false) {
  if (now % 20 !== 0) return;
  const want = CONFIG.music ? themeFor(c, now, doing, hurtAt, battle) : null;
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
import { ItemStack as ItemStack5, system as system5, world as world15 } from "@minecraft/server";

// src/change.ts
import { MolangVariableMap as MolangVariableMap6 } from "@minecraft/server";
function at2(c, name, up = 0) {
  try {
    if (name in RIGS[c.form].locators) {
      const p = c.anchor(name);
      return { x: p.x, y: p.y + up, z: p.z };
    }
  } catch {
  }
  const m = c.middle();
  return { x: m.x, y: m.y + up, z: m.z };
}
var head = (c) => () => at2(c, "nose");
var body = (c) => () => c.middle();
function ringAt(c, r, a, y) {
  return { x: c.pos.x + Math.cos(a) * r, y, z: c.pos.z + Math.sin(a) * r };
}
function floorAt(c, x, z) {
  const g = groundY(c.dim, x, z, c.pos.y + 8, 24);
  return typeof g === "number" ? g : c.pos.y;
}
function surface(c) {
  let y = Math.floor(c.pos.y);
  for (let k = 0; k < 16; k++) {
    if (!isWaterId(idAt(c.dim, { x: c.pos.x, y: y + 1, z: c.pos.z }))) break;
    y++;
  }
  return y + 1;
}
function reachVars(reach) {
  const m = new MolangVariableMap6();
  m.setFloat("variable.reach", reach);
  return m;
}
function bolt(c, to, seed, big = false) {
  const from = { x: to.x + (hash(seed, 1) - 0.5) * 14, y: to.y + 70, z: to.z + (hash(seed, 2) - 0.5) * 14 };
  const d = norm(sub(to, from)), L = dist(from, to);
  particle(c.dim, "basiliskra:beam_core", from, 224, beamVars(d, L, big ? 0.9 : 0.5));
  particle(c.dim, "basiliskra:beam_halo", from, 224, beamVars(d, L, big ? 2.6 : 1.5));
  particle(c.dim, "basiliskra:beam_arc", from, 192, beamVars(d, L, big ? 1.6 : 1));
  particle(c.dim, "basiliskra:impact_glare", to, 192);
  particle(c.dim, "basiliskra:horn_arc_big", to, 128);
}
function thunder(c, to, seed, big = false) {
  sound(c.dim, "ambient.weather.thunder", to, 192, big ? 2 : 1.4, (big ? 0.6 : 0.85) + hash(seed, 3) * 0.2);
  sound(c.dim, "ambient.weather.lightning.impact", to, 128, 1.2, 0.8 + hash(seed, 4) * 0.2);
  flash(c.dim, to, 150, { red: 1, green: 0.88, blue: 0.84 }, 0.02, big ? 0.1 : 0.05, big ? 0.6 : 0.3);
}
function scar(c, r, n, seed) {
  for (let k = 0; k < n; k++) {
    const a = hash(seed, k, 5) * Math.PI * 2, d = Math.sqrt(hash(seed, k, 6)) * r;
    const x = c.pos.x + Math.cos(a) * d, z = c.pos.z + Math.sin(a) * d;
    const y = floorAt(c, x, z);
    if (glassify(c.dim, { x, y: y - 1, z })) particle(c.dim, "basiliskra:impact_fire", { x, y: y + 0.2, z }, 96);
  }
}
var OPENING = 36;
var KNOCKS = [0, 18, 36];
var top = 0;
var ONE = {
  before: 176,
  after: 134,
  hold: 90,
  nameAt: 0,
  chapter: "§7The water boils",
  flash: { red: 0.92, green: 0.9, blue: 0.95, hold: 0.14, fade: 1 },
  // high over the sea, coming down toward the water where he lies
  wide: (c, Fo) => ({ ticks: OPENING, look: body(c), angle: [125, 95], dist: [Fo * 1.45, Fo * 1.15], height: [Fo * 0.7, Fo * 0.45] }),
  shots: (c, Fo, Fn) => [
    // his gills, from beside his head, as they knock
    { ticks: 54, look: head(c), angle: [72, 96], dist: [Fo * 0.3 + 2, Fo * 0.26 + 2], height: [2.5, 3.5] },
    // straight down on the sea seething round him
    { ticks: 66, look: body(c), angle: 0, dist: 1.5, height: [Fo * 0.9, Fo * 1.25] },
    // low over the water in front of him as he rears out of it
    { ticks: 56, look: head(c), angle: [-25, 10], dist: [Fo * 0.75, Fo * 0.5], height: [1.5, 2.5] },
    // what is left when the steam goes
    { ticks: 44, look: body(c), angle: [42, 66], dist: [Fn * 0.9, Fn * 1.2], height: [Fn * 0.15, Fn * 0.3] },
    // his horns, and what jumps between them
    { ticks: 56, look: () => at2(c, "horn_l"), angle: [22, -22], dist: [Fn * 0.34, Fn * 0.3], height: [1.5, 2.5] },
    // his face, for the roar
    { ticks: 60, look: head(c), angle: [15, 5], dist: [Fn * 0.5, Fn * 0.4], height: [-1, -0.5] },
    // and round him, slowly, low, while it goes on: the animal he is now (1.8)
    { ticks: 64, look: body(c), angle: [30, 150], dist: [Fn * 0.95, Fn * 1.05], height: [Fn * 0.06, Fn * 0.2], dip: { red: 0.35, green: 0.02, blue: 0.02, hold: 0.1 } }
  ],
  pre(c, t) {
    if (t === 0 || t % 20 === 0) top = surface(c);
    if (t === 0) c.setPhase("knock");
    if (KNOCKS.includes(t)) {
      c.say("basiliskra.knock.gill", at2(c, "gill_l"), 96, 1, 1 - KNOCKS.indexOf(t) * 0.04);
      c.pulse(1);
      for (const g of ["gill_l", "gill_r"]) {
        particle(c.dim, "basiliskra:gill_bubbles", at2(c, g), 64);
        particle(c.dim, "basiliskra:gill_silt", at2(c, g), 64);
      }
    }
    if (t === 54) {
      c.setPhase("spasm");
      c.say("basiliskra.i.spasm", c.pos, 96);
      c.say("basiliskra.i.gill_catch", at2(c, "gill_l"), 80);
    }
    if (t === 120) {
      c.setPhase("rise");
      c.say("basiliskra.i.surface", { x: c.pos.x, y: top, z: c.pos.z }, 112);
      particle(c.dim, "basiliskra:surge_spray", { x: c.pos.x, y: top, z: c.pos.z }, 128);
      particle(c.dim, "basiliskra:fin_splash", at2(c, "fin_l"), 96);
    }
    if (t === 150) {
      c.setPhase("evolve");
      c.say("basiliskra.mutate", c.pos, 96);
    }
    c.setCharge(t < 54 ? 0 : t < 150 ? (t - 54) / 96 * 10 : 10 + (t - 150) / 26 * 10);
    const r = 3 + t * 0.06;
    if (t % 3 === 0) {
      for (let k = 0; k < 2 + Math.floor(t / 60); k++) {
        const a = hash(t, k, 11) * Math.PI * 2, d = r * (0.4 + 0.6 * hash(t, k, 12));
        particle(c.dim, "basiliskra:splash", ringAt(c, d, a, top), 96);
        particle(c.dim, "basiliskra:bubble_trail", ringAt(c, d, a, top - 1.5), 64);
      }
    }
    if (t >= 54 && t % 5 === 0) particle(c.dim, "basiliskra:gill_steam", ringAt(c, r * hash(t, 13), hash(t, 14) * 6.28, top + 0.4), 112);
    if (t >= 54 && t % 12 === 0) for (const f of ["fin_l", "fin_r"]) particle(c.dim, "basiliskra:fin_spark", at2(c, f), 80);
    if (t >= 100 && t % 8 === 0) sound(c.dim, "random.fizz", { x: c.pos.x, y: top, z: c.pos.z }, 80, 0.9, 0.6 + hash(t, 15) * 0.3);
    if (t >= 150 && t % 6 === 0) particle(c.dim, "basiliskra:mutate_gather", c.middle(), 160, sizeVars(6));
    if (t % 20 === 0) shake(c, 80, 0.1 + 0.4 * (t / 176), 1);
  },
  burst(c) {
    top = surface(c);
    const mid = { x: c.pos.x, y: top, z: c.pos.z };
    for (const f of ["fin_l", "fin_r"]) particle(c.dim, "basiliskra:fin_break", at2(c, f), 128);
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      particle(c.dim, "basiliskra:impact_fountain", ringAt(c, 3.5, a, top), 160);
      particle(c.dim, "basiliskra:surge_spray", ringAt(c, 6, a + 0.3, top), 128);
    }
    for (let h = 0; h < 6; h++) particle(c.dim, "basiliskra:gill_steam", { x: mid.x, y: top + h * 2.5, z: mid.z }, 160);
    particle(c.dim, "basiliskra:mutate_burst", c.middle(), 200);
    sound(c.dim, "random.fizz", mid, 128, 2, 0.45);
    sound(c.dim, "basiliskra.splash", mid, 128, 1.5, 0.6);
    shake(c, 96, 1, 0.7);
  },
  post(c, t) {
    if (t === 0) {
      c.setPhase("beach");
      c.say("basiliskra.mutate", c.pos, 96, 1, 0.9);
    }
    if (t < 70 && t % 4 === 0) particle(c.dim, "basiliskra:gill_steam", ringAt(c, 5 * hash(t, 21), hash(t, 22) * 6.28, c.pos.y + 1 + 3 * hash(t, 23)), 112);
    if (t < 60 && t % 10 === 0) particle(c.dim, "basiliskra:shed_flakes", c.middle(), 96);
    c.setCharge(t < 44 ? 20 - t / 44 * 14 : Math.max(0, 6 - (t - 44) * 0.07));
    const k = [44, 62, 80].indexOf(t);
    if (k >= 0) {
      if (k === 0) c.setPhase("arc");
      c.say("basiliskra.ii.arc", at2(c, "horn_l"), 112, 1, 1 + k * 0.06);
      c.pulse(2);
      for (const h of ["horn_l", "horn_r"]) particle(c.dim, "basiliskra:horn_arc_big", at2(c, h), 112);
      flash(c.dim, c.pos, 60, { red: 1, green: 0.8, blue: 0.82 }, 0.02, 0.03, 0.2);
    }
    if (t === 104) c.setPhase("idle");
  }
};
var STRIKES = [50, 100, 140];
var TWO = {
  before: 200,
  after: 150,
  hold: 120,
  nameAt: 0,
  chapter: "§7The sky comes down",
  flash: { red: 1, green: 0.94, blue: 0.9, hold: 0.16, fade: 0.9 },
  // low and far: him against the sky that is about to come down on him
  wide: (c, Fo) => ({ ticks: OPENING, look: () => at2(c, "horn_l", 4), angle: [205, 185], dist: [Fo * 1.65, Fo * 1.35], height: [-3, -1] }),
  shots: (c, Fo, Fn) => [
    // from beside his shoulder and below, up past his horns at the sky the first bolt comes out of
    { ticks: 58, look: () => at2(c, "horn_l", 6), angle: [146, 158], dist: [Fo * 0.8, Fo * 0.72], height: [-5, -4] },
    // straight down on him, coming closer, as the second lands
    { ticks: 50, look: body(c), angle: 90, dist: 2, height: [Fo * 1.3, Fo * 0.9] },
    // his face, close, for the third
    { ticks: 52, look: head(c), angle: [60, 40], dist: [Fo * 0.4, Fo * 0.32], height: [1, 0.5] },
    // all of him, low, as it takes hold
    { ticks: 40, look: head(c), angle: [-32, -12], dist: [Fo * 0.9, Fo * 0.6], height: [0.5, 1.5] },
    // what stands there afterwards, with the charge running out through his club
    { ticks: 34, look: body(c), angle: [-56, -40], dist: [Fn * 0.95, Fn * 1.1], height: [-Fn * 0.08, Fn * 0.05] },
    // along his back from the tail, as the plates light one by one
    { ticks: 76, look: () => at2(c, "plate_tip_5"), angle: [165, 195], dist: [Fn * 0.75, Fn * 0.6], height: [Fn * 0.3, Fn * 0.22] },
    // his face: he shakes the fire out of his plates, and roars
    { ticks: 70, look: head(c), angle: [28, 8], dist: [Fn * 0.5, Fn * 0.4], height: [-Fn * 0.1, -Fn * 0.06] },
    // and the camera goes round him, low, while the roar rolls on (1.8)
    { ticks: 90, look: body(c), angle: [20, 160], dist: [Fn * 0.85, Fn * 1], height: [Fn * 0.04, Fn * 0.22], dip: { red: 0.4, green: 0.03, blue: 0.02, hold: 0.1 } }
  ],
  pre(c, t) {
    if (t === 0) {
      c.setPhase("arc");
      c.say("basiliskra.ii.arc", at2(c, "horn_l"), 112);
    }
    if (t > 0 && t < 150 && t % 30 === 0 && !STRIKES.includes(t)) c.say("basiliskra.ii.arc", at2(c, "horn_r"), 96, 0.7, 1.1);
    if (t % 4 === 0) {
      const a = hash(t, 31) * Math.PI * 2, r = 12 - t % 40 * 0.2;
      const p = ringAt(c, r, a, 0);
      particle(c.dim, hash(t, 32) < 0.5 ? "basiliskra:step_dust" : "basiliskra:grit", { x: p.x, y: floorAt(c, p.x, p.z) + 0.3, z: p.z }, 96);
    }
    const k = STRIKES.indexOf(t);
    if (k >= 0) {
      const to = at2(c, k === 1 ? "horn_r" : "horn_l");
      bolt(c, to, t);
      thunder(c, to, t);
      c.setPhase("flinch");
      c.pulse(3);
      c.setCharge(6 * (k + 1));
      shake(c, 120, 0.9, 0.5);
      particle(c.dim, "basiliskra:shock_ring", { x: c.pos.x, y: c.pos.y + 0.3, z: c.pos.z }, 128);
      particle(c.dim, "basiliskra:impact_ring", { x: c.pos.x, y: c.pos.y + 0.3, z: c.pos.z }, 128);
      scar(c, 4, 2, t);
    }
    for (const s of STRIKES) if (t === s + 1 || t === s + 3) bolt(c, at2(c, STRIKES.indexOf(s) === 1 ? "horn_r" : "horn_l"), s);
    for (const s of STRIKES) if (t === s + 12) c.setPhase("arc");
    if (t === 160) {
      c.setPhase("evolve");
      c.say("basiliskra.mutate", c.pos, 96);
    }
    if (t >= 160) {
      c.setCharge(18 + (t - 160) / 40 * 2);
      if (t % 6 === 0) particle(c.dim, "basiliskra:mutate_gather", c.middle(), 160, sizeVars(9));
    }
    if (t % 20 === 0) shake(c, 90, 0.1 + 0.3 * (t / 200), 1);
  },
  burst(c) {
    const to = c.middle();
    for (let k = 0; k < 3; k++) bolt(c, { x: to.x + (k - 1) * 1.5, y: to.y, z: to.z }, 300 + k, true);
    thunder(c, to, 300, true);
    particle(c.dim, "basiliskra:mutate_burst", to, 200);
    for (let k = 0; k < 10; k++) {
      const p = ringAt(c, 8, k / 10 * Math.PI * 2, 0);
      const y = floorAt(c, p.x, p.z);
      particle(c.dim, k % 2 ? "basiliskra:impact_debris" : "basiliskra:step_dust", { x: p.x, y: y + 0.4, z: p.z }, 128);
    }
    scar(c, 6, 8, 301);
    shake(c, 140, 1.4, 0.8);
  },
  post(c, t) {
    if (t === 0) {
      c.setPhase("grounded");
      c.setCharge(0);
      c.say("basiliskra.iii.ground", at2(c, "club_core"), 128);
      for (const s of ["spike_tip_0", "spike_tip_3", "spike_tip_8"]) particle(c.dim, "basiliskra:club_arc", at2(c, s), 112);
    }
    if (t === 34) c.setPhase("idle");
    if (t >= 34 && t < 110) {
      const before = Math.floor(c.charge / 2);
      c.setCharge((t - 34) / 76 * 18);
      const zone = Math.floor(c.charge / 2);
      if (zone > before) {
        const tip = at2(c, `plate_tip_${Math.max(0, 9 - zone)}`);
        sound(c.dim, "basiliskra.iii.charge_tick", tip, 112, 0.8, 0.6 + zone * 0.08);
        particle(c.dim, "basiliskra:plate_ember", tip, 112);
      }
    }
    if (t === 110) {
      c.setPhase("scatter");
      c.say("basiliskra.iii.scatter", at2(c, "plate_tip_5"), 128);
      shake(c, 96, 0.6, 0.5);
    }
    if (t > 110) c.setCharge(Math.max(0, 18 - (t - 110) * 0.9));
    if (t === 134) c.setPhase("idle");
  }
};
var VENTS = [137, 155, 173];
var THREE = {
  before: 236,
  after: 210,
  hold: 0,
  nameAt: 110,
  chapter: "§7He burns through",
  flash: { red: 1, green: 1, blue: 1, hold: 0.4, fade: 1.3 },
  // from the ground far off, the whole of him, the light already gathering
  wide: (c, Fo) => ({ ticks: OPENING, look: body(c), angle: [-150, -172], dist: [Fo * 1.38, Fo * 1.15], height: [-Fo * 0.08, 0] }),
  shots: (c, Fo, Fn) => [
    // along his back from the tail as the plates light: a charge, like any other
    { ticks: 70, look: () => at2(c, "plate_tip_5"), angle: [160, 195], dist: [Fo * 0.7, Fo * 0.55], height: [Fo * 0.3, Fo * 0.2] },
    // his eye, very close, as it reaches his mouth (1.8)
    { ticks: 28, look: () => at2(c, "nose", 1.5), angle: [62, 54], dist: [Fo * 0.2, Fo * 0.16], height: [1, 0.6] },
    // his face, as he does not fire
    { ticks: 39, look: head(c), angle: [35, 20], dist: [Fo * 0.36, Fo * 0.3], height: [0.5, -1] },
    // at his feet: the vent fails, and the ground under him begins to glow
    { ticks: 54, look: () => ({ x: c.pos.x, y: c.pos.y + 2, z: c.pos.z }), angle: [70, 110], dist: [Fo * 0.6, Fo * 0.5], height: [1, 2.5] },
    // all of him, drawing back from it
    { ticks: 45, look: head(c), angle: [-14, 14], dist: [Fo * 0.35, Fo * 0.85], height: [0, Fo * 0.12] },
    // from the ground, up at a dark shape in the smoke
    { ticks: 64, look: body(c), angle: [-20, -8], dist: [Fn * 0.5, Fn * 0.6], height: [-21, -20] },
    // from behind him as the wings come open
    { ticks: 46, look: body(c), angle: [180, 168], dist: [Fn * 0.85, Fn * 1], height: [Fn * 0.05, Fn * 0.2] },
    // round to the front of him, slowly, from low: all of what he is now
    { ticks: 100, look: body(c), angle: [75, -30], dist: [Fn * 0.7, Fn * 1], height: [-Fn * 0.2, Fn * 0.1] }
  ],
  pre(c, t) {
    if (t === 0) {
      c.setPhase("charge");
      c.say("basiliskra.iii.club_plant", at2(c, "club_core"), 128);
      c.say("basiliskra.iii.charge", at2(c, "throat"), 160);
    }
    if (t < 137) {
      const before = Math.floor(c.charge / 2);
      c.setCharge(t / 137 * 18);
      const zone = Math.floor(c.charge / 2);
      if (zone > before) sound(c.dim, "basiliskra.iii.charge_tick", at2(c, zone >= 6 ? "throat" : "club_core"), 96, 0.55, 0.6 + zone * 0.08);
    }
    const k = VENTS.indexOf(t);
    if (k >= 0) {
      if (k === 0) c.setPhase("vent");
      c.say("basiliskra.knock.vent", at2(c, "gill_l"), 96, 1, 1 - k * 0.03);
      c.pulse(3);
    }
    if (t >= 137 && t < 191) {
      c.setCharge(18 + (t - 137) / 54 * 2);
      if (t % 3 === 0) for (const g of ["gill_l", "gill_r"]) particle(c.dim, "basiliskra:gill_steam", at2(c, g), 112);
      if (t % 4 === 0) scar(c, 4 + (t - 137) * 0.12, 2, t);
      if (t % 6 === 0) particle(c.dim, "basiliskra:rad_shimmer", { x: c.pos.x, y: c.pos.y + 0.5, z: c.pos.z }, 96);
    }
    if (t === 191) {
      c.setPhase("scatter");
      c.say("basiliskra.iii.scatter", at2(c, "plate_tip_5"), 160);
      c.say("basiliskra.mutate", c.pos, 128, 1, 0.8);
    }
    if (t >= 191) {
      c.setCharge(20);
      if (t % 8 === 0) c.pulse(3);
      if (t % 4 === 0) for (const p of [1, 4, 7]) particle(c.dim, "basiliskra:plate_blaze", at2(c, `plate_tip_${p}`), 128);
      if (t % 6 === 0) particle(c.dim, "basiliskra:mutate_gather", c.middle(), 192, sizeVars(16));
      if (t % 5 === 0) scar(c, 11, 2, t);
    }
    if (t % 20 === 0) shake(c, 120, 0.1 + 0.9 * (t / 236) * (t / 236), 1);
  },
  burst(c) {
    const feet = { x: c.pos.x, y: c.pos.y + 0.4, z: c.pos.z };
    particle(c.dim, "basiliskra:mutate_burst", c.middle(), 224);
    particle(c.dim, "basiliskra:roar_ring", feet, 192, reachVars(30));
    particle(c.dim, "basiliskra:roar_wave", feet, 192, reachVars(30));
    particle(c.dim, "basiliskra:shock_ring", feet, 192);
    sound(c.dim, "ambient.weather.thunder", feet, 224, 2, 0.45);
    sound(c.dim, "random.explode", feet, 192, 2, 0.4);
    blast(c.dim, feet, 30, 0, 0, 1.5, () => false, c.entity, feet);
    scar(c, 9, 12, 500);
    shake(c, 192, 2.2, 1.2);
  },
  post(c, t) {
    if (t === 0) {
      c.setPhase("swallow");
      c.setCharge(0);
      c.say("basiliskra.iii.fizzle", at2(c, "mouth"), 128, 1, 0.7);
    }
    if (t === 24) c.say("basiliskra.iii.breath", at2(c, "nose"), 112, 1, 0.7);
    if (t < 80 && t % 5 === 0) {
      const v = c.volumes();
      for (let k = 0; k < 3; k++) particle(c.dim, "basiliskra:impact_smoke", v[Math.floor(hash(t, k, 41) * v.length)].at, 192);
    }
    if (t === 64) {
      c.setPhase("recoil");
      sound(c.dim, "mob.enderdragon.flap", at2(c, "wing_tip_l"), 192, 2, 0.5);
      sound(c.dim, "mob.enderdragon.flap", at2(c, "wing_tip_r"), 192, 2, 0.55);
      c.say("basiliskra.iii.club_swing", c.middle(), 160, 1, 0.7);
      const feet = { x: c.pos.x, y: c.pos.y + 0.4, z: c.pos.z };
      for (let k = 0; k < 12; k++) {
        const p = ringAt(c, 14, k / 12 * Math.PI * 2, 0);
        particle(c.dim, "basiliskra:step_dust", { x: p.x, y: floorAt(c, p.x, p.z) + 0.3, z: p.z }, 128);
      }
      blast(c.dim, feet, 26, 0, 0, 1, () => false, c.entity, feet);
      shake(c, 160, 1.2, 0.6);
    }
    if (t >= 64 && t < 110) c.setCharge((t - 64) / 46 * 12);
    if (t === 110) {
      c.setPhase("rise");
      c.say("basiliskra.iii.growl", at2(c, "nose"), 160, 1, 0.7);
    }
    if (t >= 110 && t < 150) c.setCharge(12 + (t - 110) / 40 * 8);
    if (t >= 110 && t < 170 && t % 6 === 0) particle(c.dim, "basiliskra:plate_ember", at2(c, `plate_tip_${Math.floor(hash(t, 42) * 7)}`), 128);
    if (t >= 170) c.setCharge(Math.max(0, 20 - (t - 170) * 0.5));
    if (t === 190) c.setPhase("idle");
  }
};
var CHANGES = { 2: ONE, 3: TWO, 4: THREE };

// src/ending.ts
import { EquipmentSlot as EquipmentSlot2 } from "@minecraft/server";
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
  onNote(at3) {
    const rift = store.rec.rift;
    if (!rift || distXZ(at3, rift) > NOTE_REACH) return;
    const k = `${Math.floor(at3.x)},${Math.floor(at3.y)},${Math.floor(at3.z)}`;
    if (!this.blocks.has(k) && this.blocks.size < 32) this.blocks.set(k, { x: Math.floor(at3.x), y: Math.floor(at3.y), z: Math.floor(at3.z) });
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
    if (rec.form < 3) return;
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
    if (rec.form < 3 || !rec.rift) return false;
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
    const surface2 = rift.y + 5.5;
    let u = norm({ x: c.pos.x - rift.x, y: 0, z: c.pos.z - rift.z });
    if (!u.x && !u.z) u = { x: 1, y: 0, z: 0 };
    let shore = 8, found = 1e9;
    const toHim = u;
    for (let i = 0; i < 16; i++) {
      const a = i * Math.PI / 8, d0 = { x: Math.cos(a), y: 0, z: Math.sin(a) };
      for (let d = 8; d <= 64 && d < found + 6; d += 2) {
        const g2 = blockAt(dim, { x: rift.x + d0.x * d, y: surface2 - 4.5, z: rift.z + d0.z * d });
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
import { world as world12 } from "@minecraft/server";
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
      const at3 = this.lure;
      this.lure = null;
      return { name: "lure", run: this.investigate(at3), limit: 30 * TICKS.second };
    }
    return null;
  }
  choose() {
    const c = this.c, now = this.now, rec = this.rec;
    const tod = world12.getTimeOfDay();
    const p = Math.max(0.25, 1 / Math.max(0.1, 1));
    if (!rec.evolve && now - rec.mut.formSince >= changeTicks(1) && this.ready("beach")) {
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
      const at3 = pier ?? this.openWater(near[0].location, 10, 24, 5);
      if (at3) {
        this.rest("harbor", (pier ? 4 : 6) * TICKS.minute);
        return { name: "harbor", run: this.underHarbor(pier ?? { x: at3.x, y: at3.y + 1, z: at3.z }), limit: 2 * TICKS.minute };
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
          const at3 = e.typeId === "minecraft:player" ? e.getHeadLocation() : e.location;
          if (!clearLine(c.dim, g, at3)) continue;
          const d = norm(sub(g, at3));
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
    let at3 = col !== NONE && col !== UNLOADED ? { x: site.x + 0.5, y: col.surface - 1, z: site.z + 0.5 } : null;
    if (!at3) {
      for (const [dx, dz] of [[4, 0], [-4, 0], [0, 4], [0, -4], [6, 6], [-6, -6], [6, -6], [-6, 6]]) {
        const cc = waterColumn(c.dim, site.x + dx, site.z + dz, site.y, 8);
        if (cc !== NONE && cc !== UNLOADED) {
          at3 = { x: site.x + dx, y: cc.surface - 1, z: site.z + dz };
          break;
        }
      }
    }
    if (!at3) return;
    for (const p of nearbyPlayers(c, 64)) {
      try {
        const ear = p.getHeadLocation(), d = dist(ear, at3);
        if (d > 48) continue;
        const from = d <= 10 ? at3 : add(ear, mul(norm(sub(at3, ear)), 10));
        p.playSound(site.s, { location: from, volume: clamp(1.1 - d / 60, 0.35, 0.9), pitch: 0.72 });
      } catch {
      }
    }
    c.halt();
    for (let t = 0; t < 46; t++) {
      c.lookAt(at3, 70, 25);
      yield;
    }
    c.setPhase("move");
    c.swimDepth = 5;
    yield* travel(c, at3, 0.24, 5, 700);
    c.lookAhead();
    c.setPhase("idle");
    yield* wait(70);
    sound(c.dim, site.s, at3, 24, 0.45, 0.66);
    yield* wait(80);
  }
  // ---- the second splash ----------------------------------------------------------------------------
  onSplash(at3, _by) {
    const c = this.c;
    if (dist(at3, c.pos) > 56) return;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 80 && dist(prev.at, at3) <= 6 && this.rec.learned.lureUntil <= this.now) {
      this.lure = at3;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(30 * TICKS.second + Math.min(this.rec.learned.lures, 8) * 15 * TICKS.second);
      this.splash = null;
    } else {
      this.splash = { at: at3, t: this.now };
      if (this.actName === "patrol" || this.actName === "none") c.lookAt(at3, 60, 20);
    }
  }
  *investigate(at3) {
    const c = this.c;
    c.setPhase("move");
    c.swimDepth = 5;
    c.lookAt(at3, 60, 20);
    yield* travel(c, at3, 0.3, 7, 500);
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
    const surface2 = col !== NONE && col !== UNLOADED ? col.surface : c.pos.y + 5;
    for (let t = 0; t < 84; t++) {
      const k = Math.floor((t - 6) / 7);
      if (t >= 6 && (t - 6) % 7 === 0 && k <= 10) {
        const s = c.anchor(`spine_${k}`);
        particle(c.dim, "basiliskra:fin_break", { x: s.x, y: surface2 + 0.05, z: s.z }, 48);
        if (k % 3 === 0) c.say("basiliskra.splash", { x: s.x, y: surface2, z: s.z }, 24, 0.6, 0.8);
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
    while (isNight(world12.getTimeOfDay()) && t++ < 9e3) {
      const head2 = c.anchor("muzzle");
      let woke = this.now - this.hurtAt < 40;
      for (const p of nearbyPlayers(c, 40)) if (dist(p.location, head2) < 7) woke = true;
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
    if (!shelf) {
      this.rec.evolve = { to: 2, step: 0, t0: this.now, at: { ...c.pos } };
      yield* wait(600);
      return;
    }
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
import { world as world13 } from "@minecraft/server";
var LAMP = /^minecraft:((lit_)?redstone_lamp|(soul_)?lantern|.*copper_lantern|sea_lantern|glowstone|.*copper_bulb|(soul_|redstone_|copper_)?torch|shroomlight|.*froglight)$/;
var STONE2 = /^minecraft:(stone|cobblestone|mossy_cobblestone|stone_bricks|andesite|diorite|granite|deepslate|tuff|.*_slab|stone_.*|polished_.*|smooth_stone|gravel)$/;
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
    if (this.now % 10 === 3 && this.actName !== "ashore" && this.actName !== "evolve" && this.ready("ashore") && this.wet()) {
      return { name: "ashore", run: this.ashore(), limit: 2 * TICKS.minute };
    }
    if (this.startle && this.actName !== "flinch") {
      const from = this.startle;
      this.startle = null;
      return { name: "flinch", run: this.flinch(from), limit: 20 * TICKS.second };
    }
    if (this.lure && (this.actName === "well" || this.actName === "wander" || this.actName === "pin")) {
      const at3 = this.lure;
      this.lure = null;
      return { name: "lure", run: this.toLure(at3), limit: 50 * TICKS.second };
    }
    return null;
  }
  choose() {
    const c = this.c, rec = this.rec, now = this.now;
    const tod = world13.getTimeOfDay();
    if (!rec.evolve && now - rec.mut.formSince >= changeTicks(2)) {
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
  // ---- out of the water ----------------------------------------------------------------------------
  /** In water deeper than he drags through (afloat, or sunk to the bed): not the shallows of a beach. */
  wet() {
    const c = this.c;
    if (c.afloat) return true;
    const col = waterColumn(c.dim, c.pos.x, c.pos.z, c.pos.y + 3, 6, 40);
    return col !== NONE && col !== UNLOADED && col.surface - Math.max(col.floor, c.pos.y) >= 2.6;
  }
  /**
   * Newly come out of the change in the sea (or put down in it): he swims for the nearest land, straight there at
   * the surface, limbs folded back and the tail driving him, and hauls himself out onto it.  Nothing else first.
   */
  *ashore() {
    const c = this.c;
    const failed = [];
    let land = shoreFrom(c.dim, c.pos, c.girth + 8, 160);
    if (!land) {
      this.rest("ashore", 20 * TICKS.second);
      yield* wait(40);
      return;
    }
    c.wade = true;
    c.setPhase("swim");
    c.say("basiliskra.ii.breath", c.anchor("nose"), 64, 1, 0.9);
    c.goTo(land.inland, 0.26, 3);
    let t = 0, out = 0, gain = distXZ(c.pos, land.inland), checked = 0;
    while (t < 2 * TICKS.minute) {
      t++;
      if (t % 6 === 0) {
        particle(c.dim, "basiliskra:splash", c.anchor("nose"), 64);
        if (t % 12 === 0) particle(c.dim, "basiliskra:splash", c.anchor("knob_core"), 64);
      }
      if (t % 40 === 0) c.say("basiliskra.ii.breath", c.anchor("nose"), 48, 0.8, 0.9);
      out = this.wet() ? 0 : out + 1;
      if (out > 20 || c.arrived()) break;
      if (t - checked >= 60) {
        checked = t;
        const d = distXZ(c.pos, land.inland);
        if (d > gain - 1.5) {
          failed.push(land.edge);
          const again = shoreFrom(c.dim, c.pos, c.girth + 8, 160, failed);
          if (again) {
            land = again;
            c.goTo(land.inland, 0.26, 3);
          }
        }
        gain = distXZ(c.pos, land.inland);
      }
      yield;
    }
    c.halt();
    c.wade = false;
    c.setPhase("idle");
    c.say("basiliskra.ii.growl", c.anchor("nose"), 96);
    particle(c.dim, "basiliskra:splash", c.pos, 64);
    yield* wait(30);
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
      const at3 = { x: Math.floor(p.x), y: Math.floor(c.pos.y - 0.5), z: Math.floor(p.z) };
      const b = takesMark(c.dim, at3);
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
    if (!STONE2.test(under)) return false;
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
    } else if (settlementNear(c, this.now)) {
      const town = settlementNear(c, this.now);
      const a = hash(this.now, 24) * Math.PI * 2;
      target = { x: town.x + Math.cos(a) * 16, y: town.y, z: town.z + Math.sin(a) * 16 };
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
  *well(at3) {
    const c = this.c;
    if (!(yield* this.drag(at3, 8.5, 1800))) return;
    c.yaw = yawTo(c.pos, at3);
    c.setPhase("drink");
    for (let t = 0; t < 700; t++) {
      if (t % 52 === 0) c.say("basiliskra.ii.drink", c.anchor("muzzle"), 32);
      yield;
    }
  }
  *toLure(at3) {
    const c = this.c;
    c.setPhase("idle");
    for (let t = 0; t < 24; t++) {
      c.lookAt(at3, 70, 20);
      yield;
    }
    c.lookAhead();
    yield* this.drag(at3, 6, 900);
    c.setPhase("idle");
    yield* wait(100);
  }
  onSplash(at3, _by) {
    const c = this.c;
    if (dist(at3, c.pos) > 40) return;
    this.otherSound = this.now;
    const prev = this.splash;
    if (prev && this.now - prev.t <= 100 && dist(prev.at, at3) <= 6 && this.rec.learned.lureUntil <= this.now) {
      this.lure = at3;
      this.rec.learned.lures++;
      this.rec.learned.lureUntil = this.now + pace(40 * TICKS.second);
      this.splash = null;
    } else this.splash = { at: at3, t: this.now };
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
  onBell(at3, _by) {
    const c = this.c, rec = this.rec;
    if (dist(at3, c.pos) > 48) return;
    if (this.actName === "pin") {
      const same = rec.learned.bell && dist(rec.learned.bell, at3) < 2;
      if (same) {
        sound(c.dim, "basiliskra.bell_pin", at3, 32);
        particle(c.dim, "basiliskra:grit", { x: at3.x + 0.5, y: at3.y + 0.5, z: at3.z + 0.5 }, 24);
      } else this.otherSound = this.now;
      return;
    }
    if (rec.learned.bellUses < 3) {
      rec.learned.bellUses++;
      rec.learned.bell = { x: Math.floor(at3.x), y: Math.floor(at3.y), z: Math.floor(at3.z) };
      this.startle = at3;
    } else if (rec.learned.bellUses === 3) {
      rec.learned.bellUses = 4;
      rec.learned.bell = { x: Math.floor(at3.x), y: Math.floor(at3.y), z: Math.floor(at3.z) };
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
import { MolangVariableMap as MolangVariableMap7 } from "@minecraft/server";
function vars(size) {
  const m = new MolangVariableMap7();
  m.setFloat("variable.size", size);
  return m;
}
function riftOpen(dim, at3, size) {
  const v = vars(size);
  particle(dim, "basiliskra:rift_flash", at3, 200, v);
  particle(dim, "basiliskra:rift_burst", at3, 160, v);
  particle(dim, "basiliskra:rift_ring", at3, 200, v);
  loud(dim, "basiliskra.rift.open", at3, 1, 0.85);
  loud(dim, "ambient.weather.thunder", at3, 0.9, 0.6);
  for (const p of players()) {
    try {
      if (p.dimension.id !== dim.id) continue;
      const d = dist(p.location, at3);
      if (d > 120) continue;
      p.camera.fade({ fadeColor: { red: 0.9, green: 0.08, blue: 0.06 }, fadeTime: { fadeInTime: 0.05, holdTime: 0.1, fadeOutTime: 0.6 } });
      p.runCommand(`camerashake add @s ${(0.5 * (1 - d / 120) + 0.1).toFixed(2)} 0.8 positional`);
    } catch {
    }
  }
}
function riftTick(dim, at3, size, t, power = 1) {
  const v = vars(size);
  if (t % 3 === 0) particle(dim, "basiliskra:rift_tear", at3, 200, v);
  if (t % 2 === 0) particle(dim, "basiliskra:rift_core", at3, 200, v);
  if (t % Math.max(2, Math.round(6 - 4 * power)) === 0) particle(dim, "basiliskra:rift_arc", at3, 160, v);
  if (t % 8 === 0) particle(dim, "basiliskra:rift_suck", at3, 128, v);
  if (t % 22 === 0) particle(dim, "basiliskra:rift_ring", at3, 200, v);
  if (t % 60 === 0) loud(dim, "basiliskra.rift.hum", at3, 1, 1);
  if (t % 34 === 17 && hash(t, 5) < 0.5 + 0.4 * power) loud(dim, "basiliskra.ii.arc", { x: at3.x, y: at3.y + size * hash(t, 6), z: at3.z }, 0.9, 0.6 + 0.3 * hash(t, 7));
}
function riftClose(dim, at3, size) {
  const v = vars(size);
  particle(dim, "basiliskra:rift_flash", at3, 200, v);
  particle(dim, "basiliskra:rift_burst", at3, 160, v);
  particle(dim, "basiliskra:rift_ring", at3, 200, v);
  particle(dim, "basiliskra:seam_close", { x: at3.x, y: at3.y + size * 0.4, z: at3.z }, 128);
  loud(dim, "basiliskra.rift.close", at3, 1, 0.9);
}
var RIFT_SIZE = [0, 14, 16, 30, 46];

// src/civilians.ts
import { world as world14 } from "@minecraft/server";
var SIGHT = 110;
var FELT = 36;
var FRIGHT = 300;
var SCARED = `${NS}:scared`;
var frightened = /* @__PURE__ */ new Map();
function panic(e) {
  try {
    e.triggerEvent(`${NS}:panic`);
    e.setProperty(SCARED, true);
  } catch {
  }
}
function calm(e) {
  try {
    e.triggerEvent(`${NS}:calm`);
    e.setProperty(SCARED, false);
  } catch {
  }
}
function civiliansTick(now, giants2) {
  if (now % 10 !== 4) return;
  for (const g of giants2) {
    if (!g.valid) continue;
    let near = [];
    try {
      near = g.dim.getEntities({ type: CIVILIAN, location: g.pos, maxDistance: SIGHT });
    } catch {
      continue;
    }
    const mid = g.middle();
    let looks = 0;
    for (const e of near) {
      let d = 1e9;
      try {
        d = dist(e.location, g.pos);
      } catch {
        continue;
      }
      let sees = d < FELT + g.girth;
      if (!sees && looks < 24) {
        looks++;
        try {
          sees = clearLine(g.dim, e.getHeadLocation(), mid);
        } catch {
          sees = false;
        }
      }
      if (!sees) continue;
      if ((frightened.get(e.id) ?? -1) <= now) panic(e);
      frightened.set(e.id, now + FRIGHT);
    }
  }
  for (const [id, until] of frightened) {
    if (until > now) continue;
    frightened.delete(id);
    let e;
    try {
      e = world14.getEntity(id);
    } catch {
      e = void 0;
    }
    if (e) calm(e);
  }
}

// src/controller.ts
var TOKEN = "bk:token";
var ROMAN3 = ["", "I", "II", "III", "IV"];
function tellNear3(dimId, at3, msg) {
  for (const p of players()) {
    try {
      if (p.dimension.id === dimId && dist(p.location, at3) < 64) p.sendMessage(msg);
    } catch {
    }
  }
}
var SPAWN_STEP = 3;
var MAX_FORM = 4;
var FRAME = [0, 17, 21, 34, 46];
var BODY_MID = [0, 1.5, 3.5, 6, 24];
var NAME_CARD = ["", "", "§7he has left the water", "§7he stands up", "§7the last form"];
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
    // ---- evolution: the same entity, in place, resumable ---------------------------------------------------
    /** The scene that is playing (so that its film is started once). */
    this.sceneKey = "";
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
    let at3, yaw = 0, dimId = "";
    try {
      at3 = { ...e.location };
      yaw = e.getRotation().y;
      dimId = e.dimension.id;
    } catch {
      return;
    }
    if (dimId !== OVERWORLD) {
      this.quarantine(e);
      tellNear3(dimId, at3, "§7Basiliskra lives in the Overworld. He cannot be called here.");
      return;
    }
    const said = this.bringHere(at3, yaw, CONFIG.spawnForm, e);
    tellNear3(dimId, at3, `§7${said}`);
  }
  /**
   * Bring the one Basiliskra to `at`, in `want` form (0 = his stage in the story).  If he is loaded he is moved
   * here; otherwise a body here becomes him and the old one, wherever it lies, is removed when its chunk loads.
   * Never more than one.  Returns what happened, in words.
   */
  bringHere(at3, yaw, want, body2) {
    const rec = store.rec, dim = overworld();
    const form = this.formFor(want, at3);
    if (form === 1) {
      const w = this.waterNear(at3, 96);
      if (!w) {
        if (body2) this.quarantine(body2);
        return "Basiliskra I lives in deep water, and there is none within 96 blocks (it has to be 5 deep). Bring him as II or III, or go to the sea.";
      }
      at3 = w;
    }
    const c = this.creature;
    if (c && c.valid) {
      if (body2) this.quarantine(body2);
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
      if (!rec.rift) rec.rift = { ...this.waterNear(at3, 64) ?? at3, yaw };
      rec.home = { ...at3 };
      if (c.form !== form) this.setForm(c, form);
      this.brain?.finish();
      c.halt();
      c.pos = { ...at3 };
      c.yaw = yaw;
      try {
        c.entity.teleport(at3, { rotation: { x: 0, y: yaw } });
      } catch {
      }
      store.save();
      return `Basiliskra ${ROMAN3[form]} has come.`;
    }
    let made = false;
    if (!body2) {
      if (!isLoaded(dim, at3)) return "That place is not loaded.";
      try {
        body2 = dim.spawnEntity(TYPE, at3, { initialRotation: yaw });
        made = true;
      } catch {
        return "He could not come there.";
      }
    }
    this.ticket = body2;
    try {
      rec.stage = "alive";
      if (!rec.token) rec.token = newToken();
      rec.entityId = body2.id;
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
      if (!rec.rift) rec.rift = { ...this.waterNear(at3, 64) ?? at3, yaw };
      if (!rec.origin) rec.origin = { ...at3 };
      rec.home = { ...at3 };
      store.save();
      try {
        body2.setDynamicProperty(TOKEN, rec.token);
      } catch {
      }
      this.adopt(body2);
      try {
        const h = body2.getComponent("minecraft:health");
        if (h) h.setCurrentValue(Math.max(1, Math.min(rec.health || h.effectiveMax, h.effectiveMax)));
      } catch {
      }
    } finally {
      this.ticket = null;
    }
    if (!this.creature && made) {
      try {
        body2.remove();
      } catch {
      }
    }
    return this.creature ? `Basiliskra ${ROMAN3[form]} has come.` : "He could not come there.";
  }
  /** Which form a call makes. */
  formFor(want, at3) {
    if (want) return want;
    const rec = store.rec;
    if (rec.born > 0) return rec.form;
    return this.waterNear(at3, 6) ? 1 : 3;
  }
  /** The nearest loaded column of open water at least five deep, at his swimming depth; null if none within reach. */
  waterNear(at3, reach) {
    const dim = overworld();
    for (let r = 0; r <= reach; r += 4) {
      const n = r === 0 ? 1 : Math.max(8, Math.round(r * 1.5));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        const x = at3.x + Math.cos(a) * r, z = at3.z + Math.sin(a) * r;
        const col = waterColumn(dim, x, z, at3.y, 12, 12);
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
    if (form === 4) rec.four = void 0;
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
  /**
   * Where a rift may open for him near a place: in the sea, deep enough for the form he comes as, open all round
   * (the water reaches the surface everywhere the tear stands, and nothing solid stands in its height), and as near
   * a shore as that allows, facing it: he comes out of the water and up onto the beach.  A city's own deep sea is
   * taken first when one is near (it was cut for this).  Null if there is no such water within reach.
   */
  riftSite(site, form, reach = 160) {
    const dim = overworld(), size = RIFT_SIZE[form];
    const need = [0, 6, 3, 3, 3][form], half = Math.max(4, Math.min(14, size * 0.3));
    const open = (x, z, surface2, base) => {
      for (let k = 0; k < 8; k++) {
        const a = k / 8 * Math.PI * 2, px = x + Math.cos(a) * half, pz = z + Math.sin(a) * half;
        const col = waterColumn(dim, px, pz, surface2 - 1, 3, 40);
        if (col === NONE || col === UNLOADED || Math.abs(col.surface - surface2) > 1 || col.surface - col.floor < 2) return false;
      }
      for (const [px, pz] of [[x, z], [x + half * 0.7, z], [x - half * 0.7, z], [x, z + half * 0.7], [x, z - half * 0.7]]) {
        for (let y = base; y <= base + size; y += 3) if (isSolidBlock(blockAt(dim, { x: px, y, z: pz }))) return false;
      }
      return true;
    };
    const shoreDist = (x, z, surface2) => {
      const d = norm({ x: site.x - x, y: 0, z: site.z - z });
      for (let s = 4; s <= 120; s += 4) {
        const col = waterColumn(dim, x + d.x * s, z + d.z * s, surface2 - 1, 3, 12);
        if (col === UNLOADED) return 999;
        if (col === NONE) return s;
      }
      return 999;
    };
    const city = nearestCity(site);
    const want = size * 0.8 + 14;
    let best = null, score = 1e9;
    const consider = (x, z, bonus) => {
      const col = waterColumn(dim, x, z, Math.max(site.y, 63), 16, 160);
      if (col === NONE || col === UNLOADED || col.surface - col.floor < need) return;
      const base = form === 1 ? col.surface - 5.5 : Math.max(col.floor, Math.floor(col.surface - size * 0.4));
      if (!open(x, z, col.surface, Math.ceil(col.surface))) return;
      const shore = shoreDist(x, z, col.surface);
      const sc = Math.abs(Math.min(shore, 200) - want) + Math.hypot(x - site.x, z - site.z) * 0.2 - bonus;
      if (sc < score) {
        score = sc;
        best = { at: { x: Math.floor(x), y: Math.floor(base), z: Math.floor(z) }, yaw: yawTo({ x, y: 0, z }, site) };
      }
    };
    if (city && city.distance < reach + 120) {
      const m = landmarks(city.site);
      for (const k of [0.35, 0.55, 0.75]) consider(m.beach.x + (m.deep.x - m.beach.x) * k, m.beach.z + (m.deep.z - m.beach.z) * k, 60);
      if (best) return best;
    }
    for (let r = 10; r <= reach; r += 6) {
      const n = Math.max(12, Math.round(r * 0.7));
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        consider(site.x + Math.cos(a) * r, site.z + Math.sin(a) * r, 0);
      }
      if (best && score < 12) break;
    }
    return best;
  }
  /** Somewhere on land in front of a place where the whole tear stands in open air (none of it in a hill or a house). */
  landRift(place2, form) {
    const dim = overworld(), size = RIFT_SIZE[form], half = Math.max(3, Math.min(12, size * 0.3));
    const f = forwardOf(place2.yaw), l = { x: -f.z, y: 0, z: f.x };
    for (const d of [0, 8, 16, 24, 32, 44]) for (const s of [0, 10, -10, 20, -20]) {
      const x = place2.at.x - f.x * d + l.x * s, z = place2.at.z - f.z * d + l.z * s;
      const g = groundY(dim, x, z, place2.at.y + 24, 48);
      if (typeof g !== "number") continue;
      let clear = true;
      for (const [px, pz] of [[x, z], [x + l.x * half, z + l.z * half], [x - l.x * half, z - l.z * half]]) {
        for (let y = g + 1; y <= g + size && clear; y += 2) if (isSolidBlock(blockAt(dim, { x: px, y, z: pz }))) clear = false;
      }
      if (clear) return { at: { x: Math.floor(x), y: g, z: Math.floor(z) }, yaw: place2.yaw };
    }
    return null;
  }
  callNow(site, by, place2) {
    const rec = store.rec;
    const c = this.creature;
    if (c && c.valid) return `He is already here, ${Math.round(dist(c.pos, site))} blocks away. Send him away first, or use Bring him here.`;
    if (rec.stage === "arriving") return "The rift is already open: he is coming through.";
    const returning = rec.stage === "alive" && rec.born > 0;
    const form = returning ? rec.form : 1;
    const origin = { x: Math.floor(site.x), y: Math.floor(site.y), z: Math.floor(site.z) };
    if (form === 1) {
      const r = this.riftSite(site, 1, 120);
      const w = r ? { x: r.at.x + 0.5, y: r.at.y, z: r.at.z + 0.5 } : this.waterNear(site, 96);
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
    let fromSea = false;
    const sea = this.riftSite(site, form);
    if (sea) {
      place2 = sea;
      fromSea = true;
    } else if (place2) place2 = this.landRift(place2, form) ?? void 0;
    if (!place2) return "There is nowhere near here for the rift to open: no deep, open water, and no open ground clear of hills and buildings.";
    rec.stage = "arriving";
    rec.entityId = null;
    rec.down = null;
    rec.pending = null;
    if (!rec.token) rec.token = newToken();
    rec.arrival = { step: 0, t0: this.now, water: { ...place2.at }, yaw: place2.yaw, land: true };
    rec.home = { ...place2.at };
    store.save();
    return fromSea ? `The rift is opening in the sea ${Math.round(dist(place2.at, site))} blocks from you. Basiliskra ${ROMAN3[form]} is coming out of the water.` : `The rift is opening on open ground in front of you. Basiliskra ${ROMAN3[form]} is coming through.`;
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
      const at3 = { x: c.pos.x, y: c.pos.y, z: c.pos.z };
      if (c.form === 1) c.say("basiliskra.roar_under", c.anchor("nose"), 96);
      else c.say("basiliskra.roar_short", c.anchor("nose"), 128, 1, c.form === 2 ? 1.18 : 1);
      riftOpen(c.dim, at3, RIFT_SIZE[c.form] * 0.6);
      riftClose(c.dim, at3, RIFT_SIZE[c.form] * 0.6);
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
    store.rec.cities = old.cities;
    store.save();
    store.flush();
    return was;
  }
  /** The config wheel: his next change, now, where he stands (with its scene). */
  evolveNow() {
    const c = this.creature, rec = store.rec;
    if (!c || !c.valid || rec.stage !== "alive") return "He is not here to change.";
    if (rec.evolve) return "He is changing already.";
    if (rec.form >= MAX_FORM) return `Basiliskra ${ROMAN3[rec.form]} is his last form.`;
    this.ending.reset();
    rec.evolve = { to: rec.form + 1, step: 0, t0: this.now, at: { ...c.pos } };
    store.save();
    return `Basiliskra ${ROMAN3[rec.form]} is changing into Basiliskra ${ROMAN3[rec.form + 1]}.`;
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
    const clock = store.rec.clock, cities2 = store.rec.cities;
    store.rec = freshRecord();
    store.rec.clock = clock;
    store.rec.cities = cities2;
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
      e.nameTag = `Basiliskra ${ROMAN3[store.rec.form]}`;
    } catch {
    }
  }
  makeBrain(c) {
    if (c.form === 3) c.set(PROP.gait, 3);
    if (c.form === 4) c.set(PROP.gait, 1);
    return c.form === 1 ? new BrainOne(c) : c.form === 2 ? new BrainTwo(c) : c.form === 4 ? new BrainFour(c) : new BrainThree(c);
  }
  /** The only place the entity is ever created.  The reservation is already saved when this runs. */
  create(dim, at3, yaw) {
    const rec = store.rec;
    if (this.creature || rec.entityId !== null || !rec.token) return false;
    if (rec.stage !== "arriving" && rec.stage !== "alive") return false;
    if (!isLoaded(dim, at3)) return false;
    let e;
    try {
      e = dim.spawnEntity(TYPE, at3, { initialRotation: yaw });
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
        dim = world15.getDimension(id);
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
    const at3 = { x: c.pos.x, y: c.pos.y + 3, z: c.pos.z };
    if (c.form === 1) c.say("basiliskra.roar_under", c.anchor("nose"), 96);
    else c.say("basiliskra.roar_short", c.anchor("nose"), 128, 1, c.form === 2 ? 1.18 : 1);
    shake(c, 80, c.form === 1 ? 0.3 : 0.5, 1.2);
    sound(c.dim, "basiliskra.rift.open", at3, 72, 1, 1.3);
    sound(c.dim, "basiliskra.rift.close", at3, 72);
    for (const p of [at3, c.anchor("nose"), c.anchor("tail_notch")]) particle(c.dim, "basiliskra:seam_close", p, 72);
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
    const vfight = vathroks.fighting();
    const lead = this.creature ?? titans.creatures().find((t) => t.valid) ?? vfight ?? null;
    musicTick(lead, now, this.brain?.actName ?? "", this.brain?.hurtAt ?? -1, titans.fighting() || !!vfight);
    cityTick(now);
    titans.tick(now);
    vathroks.tick(now);
    separateGiants();
    civiliansTick(now, [...this.creature ? [this.creature] : [], ...titans.creatures(), ...vathroks.creatures()]);
    lanceTick();
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
        const tod = world15.getTimeOfDay();
        if (near && (isDusk(tod) || t > pace(1.2 * TICKS.day))) this.setStep(1);
        break;
      }
      case 1: {
        if (t % KNOCK_GAP_TICKS === 2 && t < KNOCK_GAP_TICKS * 3) {
          let at3 = add(a.water, { x: 0, y: 5.5, z: 0 });
          try {
            const boat = dim.getEntities({ location: a.water, maxDistance: 40, families: ["boat"] }).find((b) => {
              try {
                return !b.getComponent("minecraft:rideable")?.getRiders().length;
              } catch {
                return true;
              }
            });
            if (boat) {
              at3 = boat.location;
              boat.applyImpulse({ x: (hash(now, 1) - 0.5) * 0.2, y: 0.02, z: (hash(now, 2) - 0.5) * 0.2 });
            }
          } catch {
          }
          sound(dim, "basiliskra.boat_knock", at3, 32);
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
          const tear = () => ({ x: a.water.x, y: a.water.y + 4, z: a.water.z });
          const head2 = () => this.creature ? this.creature.anchor("nose") : tear();
          const surface2 = () => {
            const h = head2();
            return { x: h.x, y: Math.max(h.y, a.water.y + 5), z: h.z };
          };
          film(dim, head2, { ticks: 330, radius: 110, dist: 30, height: 9, cinema: true, facing: () => a.yaw, flash: { red: 0.8, green: 0.05, blue: 0.05 }, shots: [
            { ticks: 50, look: tear, angle: [6, -6], dist: [44, 36], height: [2, 3] },
            { ticks: 45, look: tear, angle: [55, 70], dist: [16, 12], height: [1, 2.5] },
            { ticks: 90, look: surface2, angle: [30, 10], dist: [22, 16], height: [7, 3] },
            { ticks: 145, look: head2, angle: [70, 40], dist: [14, 10], height: [1.5, 0.5] }
          ] });
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
          const at3 = add(a.water, mul(forwardOf(a.yaw), -7));
          if (!this.create(dim, at3, a.yaw)) break;
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
    const form = rec.form, size = RIFT_SIZE[form], at3 = a.water;
    if (a.step === 0) {
      if (this.riftShown !== a.t0) {
        this.riftShown = a.t0;
        riftOpen(dim, at3, size);
        sceneTheme(store.rec.form >= 3 ? "wrath" : "dread", 420, at3, dim.id);
        addFallout(at3, 5, 0.5);
        const tear = () => ({ x: at3.x, y: at3.y + size * 0.5, z: at3.z });
        const head2 = () => this.creature ? this.creature.anchor("nose") : tear();
        const body2 = () => this.creature ? { x: this.creature.pos.x, y: this.creature.pos.y + BODY_MID[form], z: this.creature.pos.z } : tear();
        const F = FRAME[form];
        film(dim, body2, { ticks: 400, radius: 140, dist: F, height: 4, cinema: true, facing: () => a.yaw, flash: { red: 0.8, green: 0.05, blue: 0.05 }, shots: [
          { ticks: 40, look: tear, angle: [-4, 4], dist: [size * 1.8 + 20, size * 1.5 + 16], height: [-size * 0.35, -size * 0.3] },
          { ticks: 30, look: tear, angle: [48, 62], dist: [size * 0.7 + 6, size * 0.55 + 5], height: [0, size * 0.1] },
          { ticks: 70, look: head2, angle: [-62, -40], dist: [F * 0.55, F * 0.45], height: [-F * 0.12, -F * 0.06] },
          { ticks: 150, look: body2, angle: [8, -8], dist: [F * 1.1, F * 0.8], height: [-F * 0.18, -F * 0.1] },
          { ticks: 110, look: head2, angle: [26, 14], dist: [F * 0.45, F * 0.36], height: [-F * 0.1, -F * 0.05] }
        ] });
      }
      riftTick(dim, at3, size, t, Math.min(1, t / 60));
      if (t < 60) return;
      if (!this.creature) {
        const f = forwardOf(a.yaw);
        const reach = [0, 14, 12, 30, 22][form];
        const back = add(at3, mul(f, -(reach + 2)));
        if (!this.create(dim, { x: back.x, y: at3.y + 1, z: back.z }, a.yaw)) return;
      }
      const c = this.creature;
      c.set(PROP.visLo, 9);
      c.setPhase("move");
      c.wade = true;
      this.setStep(4);
      this.runner = this.landWalk();
      this.nameCard(c, form, "§7comes through");
      return;
    }
    if (!this.creature) {
      if (rec.entityId !== null) return;
      if (this.create(dim, { x: at3.x, y: at3.y + 1, z: at3.z }, a.yaw)) this.finishArrival();
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
    if (b instanceof BrainFour) rec.four = { debut: false, shots: rec.four?.shots ?? 0, plate: rec.four?.plate ?? null };
    else if (b instanceof BrainThree) b.forced = { name: "roar", run: b.roar(true), limit: 220 };
    else if (b instanceof BrainTwo) b.forced = { name: "roar", run: b.roar(), limit: 120 };
  }
  /** He walks out through the tear: what has passed it is what is seen.  Then it closes behind him. */
  *landWalk() {
    const rec = store.rec, a = rec.arrival, dim = overworld();
    const form = rec.form, size = RIFT_SIZE[form];
    const at3 = a.water, f = forwardOf(a.yaw);
    const tail = [0, 26, 24, 42, 70][form];
    const c = this.creature;
    c.goTo(add(at3, mul(f, tail + 4)), form === 2 ? 0.1 : 0.14, 2);
    for (let t = 0; t < 700; t++) {
      if (!this.creature) return;
      const pass = this.passed(c, at3, a.yaw);
      let lo = 9;
      for (let z = 8; z >= 0 && pass[z]; z--) lo = z;
      c.set(PROP.visLo, lo);
      riftTick(dim, at3, size, 60 + t, 1);
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
    riftClose(dim, at3, size);
    for (let t = 0; t < 20; t++) yield;
  }
  /** Zones (head 8 .. tail 0) that have passed a plane through `at` facing `yaw`. */
  passed(c, at3, yaw) {
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
      out.push(dot(sub(p, at3), f) > 0);
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
        const e = world15.getEntity(rec.entityId);
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
    const at3 = rec.form !== 1 && rec.home ? rec.home : rec.form === 1 ? rec.rift : rec.beach ?? rec.rift;
    const near = players().some((p) => {
      try {
        return p.dimension.id === dim.id && distXZ(p.location, at3) < 96;
      } catch {
        return false;
      }
    });
    if (!near) return;
    if (!isLoaded(dim, at3)) return;
    sound(dim, "basiliskra.rift.open", rec.rift, 72);
    this.create(dim, { x: at3.x + 0.5, y: at3.y + (rec.form === 1 ? 0 : 1), z: at3.z + 0.5 }, rec.rift.yaw);
  }
  evolve(c) {
    const rec = store.rec, ev = rec.evolve, now = this.now;
    c.halt();
    const CH = CHANGES[ev.to];
    const big = [0, 6, 9, 16, 34][ev.to] ?? 16;
    if (ev.step === 0) {
      const key = `${ev.to}:${rec.token}:${rec.mut.formSince}`;
      if (this.sceneKey !== key) {
        this.sceneKey = key;
        ev.t0 = now;
        this.brain?.finish();
        const was = ev.to - 1, Fo = FRAME[was], Fn = FRAME[ev.to];
        const body2 = () => ({ x: c.pos.x, y: c.pos.y + BODY_MID[c.form], z: c.pos.z });
        film(c.dim, body2, {
          ticks: OPENING + CH.before + CH.after + CH.hold,
          radius: 140,
          dist: Fo,
          height: 4,
          cinema: true,
          facing: () => c.yaw,
          shots: [CH.wide(c, Fo), ...CH.shots(c, Fo, Fn)],
          // (1.8) a chapter heading over the establishing shot
          cards: [{ at: 4, title: CH.chapter, sub: `§8Basiliskra ${ROMAN3[was]}  §7→  §8${ROMAN3[ev.to]}`, stay: 40 }]
        });
        c.say("basiliskra.mutate", c.pos, 96, 0.6, 0.7);
      }
      const t2 = now - ev.t0 - OPENING;
      if (t2 < 0) {
        if ((t2 + OPENING) % 12 === 0) shake(c, 110, 0.12 + 0.2 * ((t2 + OPENING) / OPENING), 0.8);
        return;
      }
      if (t2 < CH.before) {
        CH.pre(c, t2);
        return;
      }
      CH.burst(c);
      particle(c.dim, "basiliskra:rift_flash", { x: c.pos.x, y: c.pos.y, z: c.pos.z }, 200, sizeVars(big * 1.6));
      for (const p of players()) {
        try {
          if (p.dimension.id === c.dim.id && dist(p.location, c.pos) < 140) {
            p.camera.fade({ fadeColor: { red: CH.flash.red, green: CH.flash.green, blue: CH.flash.blue }, fadeTime: { fadeInTime: 0.05, holdTime: CH.flash.hold, fadeOutTime: CH.flash.fade } });
          }
        } catch {
        }
      }
      rec.form = ev.to;
      rec.mut.formSince = now;
      if (ev.to === 4) rec.four = void 0;
      ev.step = 1;
      ev.t0 = now;
      store.save();
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
        addFallout(c.pos, rec.form >= 3 ? 7 : 4, rec.form >= 3 ? 0.9 : 0.45);
        if (rec.form === 2) {
          this.dropFin(c.dim, c.pos);
          rec.beach = { x: Math.floor(c.pos.x), y: Math.floor(c.pos.y), z: Math.floor(c.pos.z) };
        }
      }
      ev.step = 2;
      ev.t0 = now;
      CH.post(c, 0);
      if (CH.nameAt === 0) this.nameCard(c, ev.to);
      store.save();
      return;
    }
    if (c.form !== rec.form) {
      ev.step = 1;
      return;
    }
    const t = now - ev.t0;
    if (t > 0 && t < CH.after) {
      CH.post(c, t);
      if (t === CH.nameAt) this.nameCard(c, ev.to);
      return;
    }
    c.setCharge(0);
    rec.evolve = null;
    store.save();
    this.brain?.finish();
    const b = this.brain;
    if (b instanceof BrainFour) {
    } else if (b instanceof BrainThree) b.forced = { name: "roar", run: b.roar(true), limit: 220 };
    else if (b instanceof BrainTwo) b.forced = { name: "roar", run: b.roar(), limit: 120 };
  }
  /** His name, as the new animal is seen for the first time (or as he comes through a rift). */
  nameCard(c, form, subtitle = NAME_CARD[form]) {
    for (const p of players()) {
      try {
        if (p.dimension.id !== c.dim.id || dist(p.location, c.pos) > 160) continue;
        p.onScreenDisplay.setTitle(`§4BASILISKRA ${ROMAN3[form]}`, { subtitle, fadeInDuration: 12, stayDuration: 60, fadeOutDuration: 24 });
      } catch {
      }
    }
  }
  dropFin(dim, at3) {
    try {
      dim.spawnItem(new ItemStack5(FIN_ITEM, 1), { x: at3.x, y: at3.y + 1, z: at3.z });
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
titans.extraRows = () => vathroks.rows();
var isVathrok2 = (id) => id === VATHROK || id === VATHROK_TITAN;
var ctl = new Controller();
var ready = false;
var lastFault2 = "";
var faultAt = -1e9;
var SPLASHERS = /* @__PURE__ */ new Set(["minecraft:snowball", "minecraft:egg", "minecraft:item", "minecraft:ender_pearl"]);
var flying = [];
function splash(at3, by) {
  const dim = overworld();
  sound(dim, "basiliskra.splash", at3, 24, 0.9);
  particle(dim, "basiliskra:splash", at3, 32);
  ctl.brain?.onSplash(at3, by);
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
world16.afterEvents.worldLoad.subscribe(() => {
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
world16.afterEvents.entityLoad.subscribe((ev) => {
  if (!ready) return;
  try {
    if (ev.entity.typeId === TYPE) ctl.inspect(ev.entity);
    else if (ev.entity.typeId === TITAN) titans.inspect(ev.entity);
    else if (isVathrok2(ev.entity.typeId)) vathroks.inspect(ev.entity);
    else if (isHitbox(ev.entity.typeId) && !partOwner.has(ev.entity.id)) ev.entity.remove();
  } catch {
  }
});
world16.afterEvents.entitySpawn.subscribe((ev) => {
  if (!ready) return;
  try {
    const id = ev.entity.typeId;
    if (id === TYPE) {
      ctl.inspect(ev.entity);
      return;
    }
    if (id === TITAN) {
      titans.inspect(ev.entity);
      return;
    }
    if (isVathrok2(id)) {
      vathroks.inspect(ev.entity);
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
world16.beforeEvents.entityRemove.subscribe((ev) => {
  try {
    const id = ev.removedEntity.typeId;
    if (id === TYPE) ctl.onRemoving(ev.removedEntity);
    else if (id === TITAN) titans.onRemoving(ev.removedEntity);
    else if (isVathrok2(id)) vathroks.onRemoving(ev.removedEntity);
    else if (isHitbox(id)) partOwner.delete(ev.removedEntity.id);
  } catch {
  }
});
var PASSES = /* @__PURE__ */ new Set([
  EntityDamageCause11.entityAttack,
  EntityDamageCause11.projectile,
  EntityDamageCause11.entityExplosion,
  EntityDamageCause11.blockExplosion,
  EntityDamageCause11.magic,
  EntityDamageCause11.thorns,
  EntityDamageCause11.sonicBoom,
  EntityDamageCause11.maceSmash,
  EntityDamageCause11.override
]);
var forwardTick = -1;
var forwardKey = "";
var TITAN_ON_HIM = 0.3 / GIANT;
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
var everyGiant = () => [...ctl.creature ? [ctl.creature] : [], ...titans.creatures(), ...vathroks.creatures()];
world16.afterEvents.playerSwingStart.subscribe((ev) => {
  if (!ready || !everyGiant().length) return;
  if (ev.swingSource !== EntitySwingSource.Attack) return;
  const p = ev.player;
  const t0 = store.rec.clock;
  const held = ev.heldItemStack?.typeId;
  system6.runTimeout(() => {
    try {
      if (!p.isValid) return;
      if ((struckAt.get(p.id) ?? -99) >= t0) return;
      if (store.rec.clock - (swungAt.get(p.id) ?? -99) < 8) return;
      const from = p.getHeadLocation(), dir = p.getViewDirection();
      const reach = p.getGameMode() === GameMode2.Creative ? 6.5 : 4.5;
      let c = null, hit = null;
      for (const g of everyGiant()) {
        if (!g.valid || p.dimension.id !== g.dim.id) continue;
        const h = g.rayHit(from, dir, reach);
        if (h && (!hit || h.dist < hit.dist)) {
          hit = h;
          c = g;
        }
      }
      if (!c || !hit) return;
      if (hit.dist > 0.3 && !clearLine(c.dim, from, { x: from.x + dir.x * hit.dist, y: from.y + dir.y * hit.dist, z: from.z + dir.z * hit.dist })) return;
      swungAt.set(p.id, store.rec.clock);
      const amount = meleeDamage(held) * (hit.tag === "head" ? 1.25 : hit.tag === "tail" ? 0.6 : 1);
      c.entity.applyDamage(amount, { cause: EntityDamageCause11.entityAttack, damagingEntity: p });
    } catch {
    }
  }, 2);
});
world16.beforeEvents.entityHurt.subscribe((ev) => {
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
    const key = `${cause}|${by?.id ?? ""}|${owner.creature.entity.id}`;
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
  if (type === TITAN) {
    if (!PASSES.has(ev.damageSource.cause)) {
      ev.cancel = true;
      return;
    }
    if (titans.beforeHurt(ev.hurtEntity, ev.damage) <= 0) ev.cancel = true;
    return;
  }
  if (isVathrok2(type)) {
    if (!PASSES.has(ev.damageSource.cause)) {
      ev.cancel = true;
      return;
    }
    if (vathroks.beforeHurt(ev.hurtEntity, ev.damage) <= 0) ev.cancel = true;
    return;
  }
  if (type !== TYPE) return;
  if (!PASSES.has(ev.damageSource.cause)) {
    ev.cancel = true;
    return;
  }
  try {
    const t = ev.damageSource.damagingEntity?.typeId;
    if (t === TITAN || t === VATHROK_TITAN) ev.damage *= TITAN_ON_HIM;
  } catch {
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
world16.afterEvents.entityHurt.subscribe((ev) => {
  try {
    if (ev.hurtEntity.typeId === TITAN) {
      titans.onHurt(ev.hurtEntity, ev.damageSource.damagingEntity, ev.damage);
      return;
    }
    if (isVathrok2(ev.hurtEntity.typeId)) {
      vathroks.onHurt(ev.hurtEntity, ev.damageSource.damagingEntity, ev.damage);
      return;
    }
    if (ev.hurtEntity.typeId !== TYPE) return;
    const by = ev.damageSource.damagingEntity;
    ctl.onHurt(by && by.typeId === "minecraft:player" ? by : void 0, ev.damage);
  } catch {
  }
});
world16.afterEvents.entityDie.subscribe((ev) => {
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
world16.afterEvents.playerBreakBlock.subscribe((ev) => {
  try {
    if (ev.dimension.id !== OVERWORLD) return;
    const t = recordHabitat(ev.block.location, ev.brokenBlockPermutation.type.id, ev.player.id, ev.player.name, store.rec.clock);
    if (t) ctl.requestArrival(t);
  } catch {
  }
});
world16.afterEvents.playerInteractWithBlock.subscribe((ev) => {
  try {
    const id = ev.block.typeId, at3 = ev.block.location;
    if (id === "minecraft:bell") ctl.brain?.onBell(at3, ev.player);
    else if (id === "minecraft:noteblock") {
      ctl.ending.onNote(at3);
      ctl.brain?.onNote(at3);
    } else if (ev.beforeItemStack?.typeId === "minecraft:water_bucket") {
      const p = { x: at3.x + 0.5, y: at3.y + 1, z: at3.z + 0.5 };
      system6.runTimeout(() => {
        try {
          if (isWaterId(idAt(ev.player.dimension, p)) || isWaterId(idAt(ev.player.dimension, at3))) splash(p, ev.player);
        } catch {
        }
      }, 4);
    }
  } catch {
  }
});
world16.afterEvents.weatherChange.subscribe((ev) => {
  const w = String(ev.newWeather).toLowerCase();
  store.rec.weather = w.includes("thunder") ? "thunder" : w.includes("rain") ? "rain" : "clear";
  store.touch();
});
world16.afterEvents.itemUse.subscribe((ev) => {
  try {
    const id = ev.itemStack.typeId;
    if (id === JOURNAL_ITEM) void openJournal(ev.source, ctl);
    else if (id === WHEEL_ITEM) void openWheel(ev.source, ctl);
    else if (id === LANCE_ITEM) fireLance(ev.source, everyGiant(), store.rec.clock);
    else if (id === VATHROK_LURE_ITEM) {
      const p = ev.source;
      if (vathroks.lure(p) && p.getGameMode() !== GameMode2.Creative) {
        const inv = p.getComponent("minecraft:inventory")?.container, slot = p.selectedSlotIndex;
        const st = inv?.getItem(slot);
        if (inv && st && st.typeId === VATHROK_LURE_ITEM) {
          if (st.amount > 1) {
            st.amount -= 1;
            inv.setItem(slot, st);
          } else inv.setItem(slot);
        }
      }
    }
  } catch {
  }
});
world16.afterEvents.itemCompleteUse.subscribe((ev) => {
  try {
    if (isIodine(ev.itemStack?.typeId)) takeIodine(ev.source);
  } catch {
  }
});
world16.afterEvents.playerSpawn.subscribe((ev) => {
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
var FORMS = ["story", "i", "ii", "iii", "iv"];
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
      description: "Bring the one Basiliskra here (form: story, i, ii, iii or iv). Moves him if he is about.",
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
    reg.registerEnum(`${NS}:titan_do`, ["here", "clear"]);
    reg.registerCommand({
      name: `${NS}:titan`,
      description: "Put a Titan where you look (a Basiliskra IV made for battles; up to three), or clear them all.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ name: `${NS}:titan_do`, type: CustomCommandParamType.Enum }]
    }, (origin, what) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system6.run(() => {
        try {
          if (what === "clear") {
            p.sendMessage(`§7[Basiliskra] ${titans.clear()} Titan(s) removed.`);
            return;
          }
          const place2 = placeFor(p, 4);
          p.sendMessage(`§7[Basiliskra] ${titans.spawn(p.dimension, place2.at, place2.yaw)}`);
        } catch (e) {
          p.sendMessage(`§c[Basiliskra] ${e}`);
        }
      });
      return { status: CustomCommandStatus.Success };
    });
    reg.registerEnum(`${NS}:vathrok_do`, ["boss", "titan", "clear"]);
    reg.registerCommand({
      name: `${NS}:vathrok`,
      description: "Vathrok, the other kaiju: call the one met in survival (boss), put a Vathrok Titan where you look (titan), or clear them all.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false,
      optionalParameters: [{ name: `${NS}:vathrok_do`, type: CustomCommandParamType.Enum }]
    }, (origin, what) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system6.run(() => {
        try {
          if (what === "clear") {
            p.sendMessage(`§7[Basiliskra] ${vathroks.clear()} Vathrok(s) removed.`);
            return;
          }
          const place2 = placeFor(p, 5);
          p.sendMessage(`§7[Basiliskra] ${vathroks.spawn(p.dimension, place2.at, place2.yaw, what !== "boss")}`);
        } catch (e) {
          p.sendMessage(`§c[Basiliskra] ${e}`);
        }
      });
      return { status: CustomCommandStatus.Success };
    });
    reg.registerCommand({
      name: `${NS}:city`,
      description: "Raise a city where you stand: streets behind you, a beach and a very deep sea ahead.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: false
    }, (origin) => {
      const p = who(origin);
      if (!p) return fail("Run this as a player.");
      system6.run(() => {
        void cityForm(p);
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
    world16.sendMessage(`[${NS}] stage=${rec.stage} form=${rec.form} id=${rec.entityId} loaded=${!!ctl.creature} act=${ctl.brain?.actName} quarantined=${ctl.quarantined}`);
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
    world16.setTimeOfDay(12200);
  }
}, { namespaces: [NS] });
export {
  ctl
};
