// @ts-check
// Identifiers and block/sound tables used by The Observer.
// Block IDs and state names were derived from @minecraft/vanilla-data 1.26.52.

export const NS = "observer";
export const OBSERVER_ID = "observer:the_observer";
export const TARGET_TAG = "observer_target";
export const ENTITY_ENC_PROP = "observer:enc";

export const ITEMS = {
  notes: "observer:field_notes",
  chalk: "observer:chalk",
  lens: "observer:witness_lens",
  vestige: "observer:vestige",
  eye: "observer:observers_eye",
  ward: "observer:ward_lantern",
  wheel: "observer:config_wheel",
};

export const BLOCKS = {
  veil: "observer:veil",
  effigy: "observer:effigy",
  ward: "observer:ward_lantern",
};

export const PARTICLES = {
  footprint: "observer:footprint",
  motes: "observer:motes",
  unravel: "observer:unravel",
  vanish: "observer:vanish",
  chalk: "observer:chalk_mark",
  chalkSmudged: "observer:chalk_smudged",
  dust: "observer:dust",
};

export const SOUNDS = {
  step: "observer.step",
  hum: "observer.hum",
  tell: "observer.tell",
  breath: "observer.breath",
  fabric: "observer.fabric",
  knock: "observer.knock",
  snuff: "observer.snuff",
  strike: "observer.strike",
  whiff: "observer.whiff",
  sting: "observer.sting",
  seal: "observer.seal",
  arrival: "observer.arrival",
  chalk: "observer.chalk",
  discovery: "observer.discovery",
  lens: "observer.lens",
  effigy: "observer.effigy_break",
  vigil: "observer.vigil",
  turn: "observer.turn",
  sink: "observer.sink",
  ring: "observer.ring",
  voice: "observer.voice",
  presence: "observer.presence",
  notice: "observer.notice",
  shriek: "observer.shriek",
  vanish: "observer.vanish",
};

export const FOGS = { dread: "observer:dread", soft: "observer:dread_soft", vigil: "observer:vigil" };

export const DIMENSIONS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];

const WOODS = ["acacia", "bamboo", "birch", "cherry", "crimson", "dark_oak", "jungle", "mangrove", "pale_oak", "poplar", "spruce", "warped"];
const COPPER = ["", "exposed_", "weathered_", "oxidized_", "waxed_", "waxed_exposed_", "waxed_weathered_", "waxed_oxidized_"];

/** Doors (two-block, open_bit + upper_block_bit). Iron variants excluded: they need redstone, so a self-opening iron door reads as a bug. */
export const DOORS = new Set([
  "minecraft:wooden_door",
  ...WOODS.map((w) => `minecraft:${w}_door`),
  ...COPPER.map((c) => `minecraft:${c}copper_door`),
]);
export const TRAPDOORS = new Set([
  "minecraft:trapdoor",
  ...WOODS.map((w) => `minecraft:${w}_trapdoor`),
  ...COPPER.map((c) => `minecraft:${c}copper_trapdoor`),
]);
export const GATES = new Set(["minecraft:fence_gate", ...WOODS.map((w) => `minecraft:${w}_fence_gate`)]);

/** Light sources that are removed and later restored. */
export const REMOVABLE_LIGHTS = new Set([
  "minecraft:torch", "minecraft:soul_torch", "minecraft:copper_torch",
  "minecraft:lantern", "minecraft:soul_lantern",
  ...COPPER.map((c) => `minecraft:${c}copper_lantern`),
]);
const CANDLE_COLORS = ["", "white_", "orange_", "magenta_", "light_blue_", "yellow_", "lime_", "pink_", "gray_", "light_gray_", "cyan_", "purple_", "blue_", "brown_", "green_", "red_", "black_"];
/** Lights that are extinguished through a state change. */
export const CANDLES = new Set(CANDLE_COLORS.map((c) => `minecraft:${c}candle`));
export const CAMPFIRES = new Set(["minecraft:campfire", "minecraft:soul_campfire"]);

/** Objects whose minecraft:cardinal_direction can be turned without touching inventories or redstone. */
export const TURNABLE = new Set([
  "minecraft:carved_pumpkin", "minecraft:lit_pumpkin", "minecraft:pumpkin",
  "minecraft:stonecutter_block", "minecraft:anvil", "minecraft:chipped_anvil", "minecraft:damaged_anvil",
]);

/** Natural blocks that may be imitated (mimic placement) or temporarily carved at the Unsettling level. */
export const NATURAL = new Set([
  "minecraft:stone", "minecraft:deepslate", "minecraft:cobbled_deepslate", "minecraft:tuff", "minecraft:andesite",
  "minecraft:diorite", "minecraft:granite", "minecraft:calcite", "minecraft:dirt", "minecraft:coarse_dirt",
  "minecraft:grass_block", "minecraft:podzol", "minecraft:mycelium", "minecraft:sand", "minecraft:red_sand",
  "minecraft:gravel", "minecraft:sandstone", "minecraft:red_sandstone", "minecraft:netherrack", "minecraft:soul_sand",
  "minecraft:soul_soil", "minecraft:basalt", "minecraft:blackstone", "minecraft:end_stone", "minecraft:hardened_clay",
  "minecraft:snow", "minecraft:packed_ice", "minecraft:mud", "minecraft:clay", "minecraft:moss_block",
]);
/** What a mimic block becomes when it imitates a natural block (grass and mycelium would look wrong underground). */
// Mimic blocks are never gravity blocks: a falling block would leave its recorded cell (and duplicate)
export const MIMIC_AS = {
  "minecraft:grass_block": "minecraft:dirt", "minecraft:mycelium": "minecraft:dirt", "minecraft:podzol": "minecraft:dirt",
  "minecraft:sand": "minecraft:sandstone", "minecraft:red_sand": "minecraft:red_sandstone", "minecraft:gravel": "minecraft:andesite",
};

/** Blocks the Observer must never stand in or on. */
export const DANGER = new Set([
  "minecraft:lava", "minecraft:flowing_lava", "minecraft:fire", "minecraft:soul_fire", "minecraft:magma", "minecraft:cactus",
  "minecraft:sweet_berry_bush", "minecraft:powder_snow", "minecraft:web", "minecraft:campfire",
  "minecraft:soul_campfire", "minecraft:wither_rose", "minecraft:pointed_dripstone", "minecraft:end_portal",
  "minecraft:portal", "minecraft:bedrock", "minecraft:barrier",
]);

/** Blocks a gaze ray can see through. Leaves count as cover (they mostly hide the figure). */
export const SEE_THROUGH_RX = /(glass|_pane|iron_bars|fence(?!_gate)|_wall$|chain|lantern|torch|scaffolding|ladder|vine|_trapdoor|copper_grate)/;

/** Footstep sound per ground block family (legacy Bedrock sound events). */
export function stepSoundFor(typeId) {
  const t = typeId.replace("minecraft:", "");
  if (/grass|dirt|podzol|mycelium|farmland|path|mud|clay|rooted/.test(t)) return "step.grass";
  if (/deepslate/.test(t)) return "step.deepslate";
  if (/log|planks|wood|stem|hyphae|bookshelf|barrel|crafting|ladder/.test(t)) return /crimson|warped/.test(t) ? "step.nether_wood" : "step.wood";
  if (/^(red_)?sand$|sandstone|suspicious_sand/.test(t)) return "step.sand";
  if (/gravel/.test(t)) return "step.gravel";
  if (/snow|powder/.test(t)) return "step.snow";
  if (/soul_sand/.test(t)) return "step.soul_sand";
  if (/soul_soil/.test(t)) return "step.soul_soil";
  if (/netherrack|nylium/.test(t)) return "step.netherrack";
  if (/basalt|blackstone/.test(t)) return "step.basalt";
  if (/moss/.test(t)) return "step.moss";
  if (/wool|carpet/.test(t)) return "step.cloth";
  if (/tuff/.test(t)) return "step.tuff";
  if (/calcite/.test(t)) return "step.calcite";
  if (/copper/.test(t)) return "step.copper";
  if (/iron|gold_block|anvil/.test(t)) return "step.iron";
  return "step.stone";
}

/** Work sounds the Observer can borrow, keyed by the habit that produced them. */
export const BORROWED = {
  mine: { sounds: ["dig.stone", "dig.deepslate"], beat: [5, 9], reps: [6, 10], caption: "caption.borrowed.mine" },
  chop: { sounds: ["dig.wood"], beat: [6, 10], reps: [5, 8], caption: "caption.borrowed.chop" },
  dig: { sounds: ["dig.gravel", "dig.grass", "dig.sand"], beat: [4, 7], reps: [5, 9], caption: "caption.borrowed.dig" },
  build: { sounds: ["use.stone", "use.wood"], beat: [7, 12], reps: [4, 7], caption: "caption.borrowed.build" },
  doors: { sounds: ["random.door_open", "random.door_close"], beat: [18, 30], reps: [2, 4], caption: "caption.borrowed.doors" },
  store: { sounds: ["random.chestopen", "random.chestclosed"], beat: [16, 26], reps: [2, 4], caption: "caption.borrowed.store" },
  eat: { sounds: ["random.eat"], beat: [4, 5], reps: [5, 8], caption: "caption.borrowed.eat" },
  fight: { sounds: ["game.player.hurt", "random.bow"], beat: [10, 18], reps: [3, 5], caption: "caption.borrowed.fight" },
};
