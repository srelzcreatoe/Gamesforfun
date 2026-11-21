/**
 * World-owner settings.  Edit this file (or `scripts/main.js` in the installed behaviour pack:
 * search for "BASILISKRA CONFIG") and reload the world.  Nothing here needs cheats or experiments.
 */
export const CONFIG = {
  /** BASILISKRA CONFIG — how fast the story moves.  2 = twice as fast, 0.5 = half. */
  pacing: 1.0,
  /**
   * What his beam and feet may do to the world.
   *  "none"   only particles and sound
   *  "scorch" (default) natural stone, dirt, sand and grass at the impact are scorched; nothing breaks
   *  "break"  natural terrain at the impact is also broken.  Storage, beds, portals, redstone
   *           and anything a player built from non-natural blocks are never touched in any mode.
   */
  terrain: "scorch" as "none" | "scorch" | "break",
  /** Furrows (Form II) and footprints (Form III) pressed into natural ground. */
  marks: true,
  /** Damage multiplier for everything he does to players. */
  damage: 1.0,
  /** On Peaceful he still appears and behaves, but deals no damage. */
  harmlessOnPeaceful: true,
  /** Operator test hooks via /scriptevent basiliskra:debug ... (needs cheats; off for survival). */
  debug: false,
};

export const NS = "basiliskra";
export const TYPE = `${NS}:basiliskra`;
export const HITBOX = `${NS}:hitbox`;
export const FIN_ITEM = `${NS}:shed_fin`;
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
