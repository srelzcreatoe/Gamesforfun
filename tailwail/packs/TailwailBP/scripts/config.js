// Central tuning for Tailwail: The Rehearsal.
// Every gameplay number lives here so balance changes never require touching logic.
// Times are seconds unless a name ends in Ticks.  Distances are blocks.

export const ADDON_VERSION = "1.0.0";
export const NS = "tailwail";
export const ENTITY_ID = "tailwail:tall_wail";
export const LURE_ID = "tailwail:lure";
export const GUIDE_ITEM_ID = "tailwail:field_guide";

export const TICKS = {
  decision: 4, // brain update period (5 Hz)
  director: 20, // scheduler / housekeeping period
  sweep: 200, // orphan sweep period
};
export const DT = TICKS.decision / 20;

// Movement attribute values.  Measured on BDS 1.26.61 with the 0.9-wide box:
// ground speed (blocks/s) ~= 43.2 * value^2  (0.30 -> 3.89 b/s, 0.45 -> 8.74 b/s).
export const SPEED = {
  creep: 0.19, // ~1.6 b/s  stalking reposition
  walk: 0.245, // ~2.6 b/s  approach / search
  retreat: 0.27, // ~3.1 b/s
  search: 0.3, // ~3.9 b/s
};
export const speedToBlocksPerSecond = (v) => 43.2 * v * v;

// Posture profiles: collision height (must match entities/tall_wail.json) and the
// air clearance (in whole blocks) Tailwail needs before it may adopt the profile.
export const POSTURE = {
  tall: { height: 3.9, clearance: 5, eye: 3.5 },
  hunch: { height: 2.8, clearance: 3, eye: 2.3 },
  crawl: { height: 1.8, clearance: 2, eye: 1.2 },
};
export const POSTURE_MIN_HOLD = 1.5; // seconds between posture changes (hysteresis)

// Durations that must match animation clip lengths in the resource pack.
export const CLIP = {
  unfold: 2.0, // animation.tall_wail.reveal (+ tw_unfold_full / tw_unfold_mid)
  unfoldLow: 1.2, // animation.tall_wail.tw_unfold_low
  windup: 3.2, // animation.tall_wail.windup / windup_c (supplied, untouched timing)
  windupLowAt: 0.8, // windup reaches the planted stance at 0.8 s -> collision may shrink
  wailHold: 1.0, // planted while the wail starts
  strike: 0.95, // animation.tall_wail.tw_strike
  strikeImpact: 0.55, // arm fully extended in tw_strike
  ambush: 1.3, // animation.tall_wail.ambush (frustrated rear-up)
  peek: 0.9, // peek_left / peek_right
  death: 2.0, // death / death_low
};

// Two presets share identical rules; only magnitudes differ.
export const PRESETS = {
  balanced: {
    cooldownMin: 360,
    cooldownMax: 600,
    graceSeconds: 600,
    postDeathSeconds: 300,
    damageHearts: 3.5,
    pursuitSeconds: 25,
    chaseSpeed: 0.4, // ~6.9 b/s, above player sprint (~5.6 b/s)
    imitationChance: 0.7,
    agitationScale: 1.0,
    healthMultiplier: 1.0,
  },
  intense: {
    cooldownMin: 240,
    cooldownMax: 420,
    graceSeconds: 300,
    postDeathSeconds: 240,
    damageHearts: 5,
    pursuitSeconds: 32,
    chaseSpeed: 0.42, // ~7.6 b/s
    imitationChance: 0.85,
    agitationScale: 1.3,
    healthMultiplier: 1.5,
  },
};

export const WORLD_DEFAULTS = {
  v: 1,
  enabled: true,
  preset: "balanced",
  frequency: 1.0, // multiplier on the per-check spawn chance (0.25 .. 2)
  cooldownMin: PRESETS.balanced.cooldownMin,
  cooldownMax: PRESETS.balanced.cooldownMax,
  graceSeconds: PRESETS.balanced.graceSeconds,
  postDeathSeconds: PRESETS.balanced.postDeathSeconds,
  damageHearts: PRESETS.balanced.damageHearts,
  pursuitSeconds: PRESETS.balanced.pursuitSeconds,
  chaseSpeed: PRESETS.balanced.chaseSpeed,
  imitationChance: PRESETS.balanced.imitationChance,
  agitationScale: PRESETS.balanced.agitationScale,
  healthMultiplier: PRESETS.balanced.healthMultiplier,
  caveEncounters: true,
  surfaceEncounters: false, // secondary night-woodland encounters (less tested; off by default)
  openDoors: true,
  maxConcurrent: 2,
  debugLog: false,
};

export const WORLD_LIMITS = {
  frequency: [0.25, 2],
  cooldownMin: [120, 1800],
  cooldownMax: [180, 2400],
  graceSeconds: [0, 1800],
  postDeathSeconds: [60, 1200],
  damageHearts: [1, 10],
  pursuitSeconds: [15, 45],
  chaseSpeed: [0.36, 0.45],
  imitationChance: [0, 1],
  agitationScale: [0.6, 1.6],
  healthMultiplier: [0.5, 2],
  maxConcurrent: [1, 3],
};

export const PLAYER_DEFAULTS = {
  v: 1,
  volume: 1.0, // 0..1 multiplier on every Tailwail sound for this player
  effects: 2, // 0 off, 1 subtle (no camera shake), 2 full
  captions: false, // action-bar captions for important cues
  guideGiven: false,
};

export const ENCOUNTER = {
  spawnMin: 18,
  spawnMax: 28,
  spawnAttempts: 28, // candidate columns sampled per spawn attempt
  routeNodeBudget: 700, // flood-fill nodes for the plausible-route check
  spawnMaxLight: 7, // combined light level at the feet must be <= this
  spawnMinPlayerGap: 14, // never closer than this to ANY player
  caveSkyLightMax: 3, // player counts as "underground" at or below this sky light
  checkChance: 0.22, // per 10 s eligibility roll at frequency 1.0
  checkPeriod: 10,
  maxTargetDistance: 72, // beyond this the encounter is abandoned
  groupRadius: 24, // players within this share one encounter
  lowHealthDefer: 8, // HP; a badly hurt player is left alone
  recentHurtDefer: 8, // s since the player was last hurt by something else
};

export const STALK = {
  durationMin: 40,
  durationMax: 95,
  hardCap: 180,
  nearMin: 10,
  farMax: 26,
  repositionMin: 3,
  repositionMax: 6,
  noticeTime: 0.4, // continuous gaze needed to count as "noticed"
  breathMin: 14,
  breathMax: 26,
  scrapeGap: 12,
  nailGapMin: 30,
  nailGapMax: 55,
  interruptStare: 4, // continuous stare while approaching that halts the approach
  standoffMin: 8,
  standoffMax: 12,
  silhouetteWatchMin: 25,
  silhouetteWatchMax: 45,
  peekHideStare: 2.5,
  withdrawAfterNoticeMin: 6,
  withdrawAfterNoticeMax: 12,
};

export const STANDOFF = {
  durationMin: 40,
  durationMax: 70,
  calmDistance: 20,
  calmAgitation: 55,
  lostSightCalm: 6,
  commitAtTimeout: 70,
  approachKeep: 11,
  followIfBeyond: 16,
  clickGapMin: 3,
  clickGapMax: 6,
  clickLength: 1.2,
  inhaleAbove: 75,
};

export const AGITATION = {
  max: 100,
  cueTwo: 40, // >= this: twitching tail + throat clicks + distorted imitation
  grace: 1.5, // seconds of free gaze ("a glance is safe")
  graceRefill: 0.35, // grace seconds regained per unwatched second
  stareRate: 6.0, // per second of staring beyond the grace budget
  closeDistance: 7,
  closeRate: 2.6, // per second per block inside closeDistance
  approachRate: 5.0, // per second while the target closes in faster than approachSpeed
  approachSpeed: 0.8,
  approachRange: 14,
  sprintRange: 16,
  sprintBurst: 10,
  sprintRate: 4.0,
  hitBurst: 30,
  hitCooldown: 0.5,
  calmDecay: 5.0,
  calmRange: 9,
  drift: 0.6,
};

export const CHASE = {
  escapeNoSight: 8,
  escapeDistance: 16,
  sightRange: 48,
  reach: 3.2, // horizontal reach from body centre at impact (arm length at 1.5x scale)
  reachVertical: 2.6,
  reachArcCos: 0.34, // target must be within ~70 deg of facing
  strikeCooldown: 1.2,
  strikeRange: 3.0, // start a strike inside this distance
  stuckProgress: 0.6,
  stuckWindow: 3.0,
  recoveryAttempts: 3,
  exertionGap: 2.2,
  stepEvery: 1.62, // blocks per gallop cycle (matches the crawl clip calibration)
};

export const SEARCH = {
  points: 3,
  radius: 6,
  listen: 1.5,
  maxDuration: 10,
};

export const RETREAT = {
  distanceMin: 28,
  distanceMax: 40,
  hideDistance: 20,
  minBeforeDespawn: 4,
  maxDuration: 45,
  hardCap: 120,
  respots: 3,
};

export const IMITATION = {
  delayMin: 0.5, // after the 0.5 s detection hold, replays start ~1.0-1.7 s after the player's gesture began
  delayMax: 1.2,
  cooldown: 4.0,
  holdMin: 1.2,
  holdMax: 3.0,
  crouchMinHold: 0.5,
  tiltDegrees: 28,
  tiltHold: 0.6,
  moveSpeed: 2.0,
  stopSpeed: 0.3,
  movingFor: 1.0,
  stoppedFor: 0.8,
  rememberedChance: 0.6,
  rememberedMinCount: 2,
};

export const MEMORY = {
  version: 1,
  decay: 0.85, // per-encounter decay of learned weights
  countCap: 99,
  recentSetups: 4,
  maxBytes: 900,
};

export const AUDIO = {
  hearing: 56, // players beyond this never receive a cue
  perPlayerPerSecond: 3,
};

export const DEATH_ANIM_SECONDS = 2.4;
