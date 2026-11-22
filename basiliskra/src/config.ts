/**
 * World-owner settings.  Edit this file (or `scripts/main.js` in the installed behaviour pack:
 * search for "BASILISKRA CONFIG") and reload the world.  Nothing here needs cheats or experiments.
 */
export const CONFIG = {
  /** BASILISKRA CONFIG — how fast the story moves.  2 = twice as fast, 0.5 = half. */
  pacing: 1.0,
  /**
   * What his beam, his roar and his weight may do to the world.
   *  "none"   only light, particles and sound
   *  "scorch" natural stone, dirt, sand and grass at the impact are scorched; nothing breaks
   *  "break"  natural terrain at the impact is also broken
   *  "wither" (default) like the Wither: the beam blasts out whatever it meets, sets fires, and he smashes
   *           through anything built in his way.  Bedrock, portals and command blocks always survive, and so do
   *           chests, beds and other blocks that hold things while `spareStorage` is on.
   */
  terrain: "wither" as "none" | "scorch" | "break" | "wither",
  /** In "wither" mode: chests, barrels, shulker boxes, beds, furnaces, hoppers and the like are never destroyed. */
  spareStorage: true,
  /** Furrows (Form II) and footprints (Form III) pressed into natural ground. */
  marks: true,
  /** Damage multiplier for everything he does to players. */
  damage: 1.0,
  /** On Peaceful he still appears and behaves, but deals no damage. */
  harmlessOnPeaceful: true,
  /** Operator test hooks via /scriptevent basiliskra:debug ... (needs cheats; off for survival). */
  debug: false,
  /** A spawn egg, /summon or /basiliskra:spawn brings the one Basiliskra to that place (false: they are removed). */
  allowSummon: true,
  /** What a spawn egg or /summon makes: 0 = his stage in the story (a new world: I in water, III on land), 1-3 = that form. */
  spawnForm: 0 as 0 | 1 | 2 | 3,
  /** Every player gets the journal the first time they join with the pack on. */
  giveJournal: true,
  /** Operators (and the only player of a single-player world) also get the config wheel on first join. */
  giveWheel: true,
  /**
   * His fallout.  "land" (default): glowing motes, Geiger clicks, and in natural ground only, soil turns to
   * irradiated soil, plants wither and wild leaves fall, healing as it fades.  "visual": motes and clicks only.
   * "off": none of it.
   */
  fallout: "land" as "off" | "visual" | "land",
  /** Players standing in strong fallout get hungry, weak and sick (vanilla effects; milk clears them). */
  sickness: true,
  /** He hunts animals and other creatures too, not only players. */
  huntMobs: true,
};

/** The settings a player may change in game (the config wheel); saved with the world, over the defaults above. */
export const SETTINGS = ["pacing", "terrain", "spareStorage", "marks", "damage", "harmlessOnPeaceful", "allowSummon", "spawnForm", "giveJournal", "giveWheel", "debug", "fallout", "sickness", "huntMobs"] as const;
export const SETTINGS_KEY = "bk:cfg";

export const NS = "basiliskra";
export const TYPE = `${NS}:basiliskra`;
export const HITBOX = `${NS}:hitbox`;
export const FIN_ITEM = `${NS}:shed_fin`;
export const JOURNAL_ITEM = `${NS}:journal`;
export const WHEEL_ITEM = `${NS}:config_wheel`;
export const COUNTER_ITEM = `${NS}:geiger_counter`;
export const SOIL_BLOCK = `${NS}:irradiated_soil`;
export const TRINITITE_BLOCK = `${NS}:scarlet_trinitite`;
export const PROP = {
  form: `${NS}:form`, bound: `${NS}:bound`, phase: `${NS}:phase`, charge: `${NS}:charge`, lookYaw: `${NS}:look_yaw`,
  lookPitch: `${NS}:look_pitch`, bend: `${NS}:bend`, pitch: `${NS}:pitch`, gait: `${NS}:gait`, gill: `${NS}:gill`,
  fxKind: `${NS}:fx_kind`, fxSeq: `${NS}:fx_seq`, tier: `${NS}:tier`, visLo: `${NS}:vis_lo`, visHi: `${NS}:vis_hi`,
} as const;

/** Must match tools/kit/gen_client.py. */
export const PHASE = {
  idle: 0, move: 1, arrive: 2, ram: 3, knock: 4, rise: 5, bite: 6, sweep: 7, jam: 8, spasm: 9, sleep: 10, wake: 11,
  evolve: 12, beach: 13, drink: 14, arc: 15, pin: 16, look: 17, charge: 18, fire: 19, vent: 20, grounded: 21,
  scatter: 22, roar: 23, crossing: 24, depart: 25, flinch: 26, window: 27, stalk: 28,
} as const;
export type PhaseName = keyof typeof PHASE;

export const TICKS = { second: 20, minute: 1200, day: 24000 };
/** Seconds between the three knocks, wherever they are heard. */
export const KNOCK_GAP_TICKS = 18;
export const OVERWORLD = "minecraft:overworld";
