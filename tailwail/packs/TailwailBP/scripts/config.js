// Central tuning for TAILWAIL.
// Every gameplay number lives here so balance changes never require touching logic.
// Times are seconds unless a name ends in Ticks.  Distances are blocks.

export const ADDON_VERSION = "2.0.0";
export const NS = "tailwail";
export const ENTITY_ID = "tailwail:tall_wail";
export const LURE_ID = "tailwail:lure";
export const ECHO_ID = "tailwail:echo";
export const SNUFFED_TORCH_ID = "tailwail:snuffed_torch";
export const GUIDE_ITEM_ID = "tailwail:field_guide";

export const TICKS = {
  decision: 4, // brain update period (5 Hz)
  director: 20, // scheduler / presence housekeeping period
  presence: 4, // footstep echo / mimicry follow-up period
  sweep: 200, // orphan sweep period
};
export const DT = TICKS.decision / 20;

// Movement attribute values.  Measured on BDS 1.26.61 with the 0.9-wide box:
// ground speed (blocks/s) ~= 43.2 * value^2  (0.30 -> 3.89 b/s, 0.45 -> 8.74 b/s).
export const SPEED = {
  creep: 0.19, // ~1.6 b/s  stalking reposition
  walk: 0.245, // ~2.6 b/s  approach
  search: 0.3, // ~3.9 b/s
  retreat: 0.3, // ~3.9 b/s
  burst: 0.37, // ~5.9 b/s  the stand-off "it moved while you looked away" burst
};
export const speedToBlocksPerSecond = (v) => 43.2 * v * v;

// Posture profiles: collision height (must match entities/tall_wail.json) and the
// air clearance (in whole blocks) Tailwail needs before it may adopt the profile.
export const POSTURE = {
  tall: { height: 3.9, clearance: 5, eye: 3.5 },
  hunch: { height: 2.8, clearance: 3, eye: 2.3 },
  crawl: { height: 1.8, clearance: 2, eye: 1.2 },
};
export const POSTURE_ORDER = ["crawl", "hunch", "tall"];
export const POSTURE_MIN_HOLD = 1.5; // seconds between posture growth (hysteresis)

// Durations that must match animation clip lengths in the resource pack
// (tools/validate.py compares them).
export const CLIP = {
  unfold: 2.0, // animation.tall_wail.reveal (+ tw_unfold_full / tw_unfold_mid)
  unfoldLow: 1.2, // animation.tall_wail.tw_unfold_low
  scream: 1.8, // animation.tall_wail.tw2_scream
  windupCut: 1.0, // the supplied 3.2 s windup is cut once it has dropped onto all fours
  grab: 0.5, // animation.tall_wail.tw2_grab
  throw: 0.6, // animation.tall_wail.tw2_throw
  throwRelease: 0.3, // arm is at full extension here
  strike: 0.95, // animation.tall_wail.tw_strike (fallback when a grab is impossible)
  strikeImpact: 0.55,
  frustrated: 1.6, // animation.tall_wail.tw2_frustrated
  owl: 1.0, // animation.tall_wail.tw2_owl
  tilt: 1.4, // animation.tall_wail.tw2_tilt
  neck: 1.6, // animation.tall_wail.tw2_neck
  peek: 0.7, // animation.tall_wail.tw2_peek_l / _r
  statue: 0.25, // animation.tall_wail.tw2_statue_*
  behind: 0.2, // animation.tall_wail.tw2_behind
  death: 2.0, // death / death_low
};

// Difficulty presets.  Identical rules, different magnitudes.
export const PRESETS = {
  calm: {
    cooldownMin: 480, cooldownMax: 780, firstMin: 360, firstMax: 540, postDeathSeconds: 360,
    presenceScale: 0.7, chaseSpeed: 0.38, pursuitSeconds: 20, agitationScale: 0.8,
    throwDamage: 4, biteDamage: 8, strikeDamage: 5, strugglePresses: 5, healthMultiplier: 0.8,
  },
  standard: {
    cooldownMin: 300, cooldownMax: 480, firstMin: 240, firstMax: 420, postDeathSeconds: 240,
    presenceScale: 1.0, chaseSpeed: 0.4, pursuitSeconds: 26, agitationScale: 1.0,
    throwDamage: 6, biteDamage: 12, strikeDamage: 7, strugglePresses: 7, healthMultiplier: 1.0,
  },
  nightmare: {
    cooldownMin: 180, cooldownMax: 330, firstMin: 150, firstMax: 270, postDeathSeconds: 180,
    presenceScale: 1.4, chaseSpeed: 0.42, pursuitSeconds: 34, agitationScale: 1.3,
    throwDamage: 8, biteDamage: 16, strikeDamage: 9, strugglePresses: 10, healthMultiplier: 1.6,
  },
};

export const WORLD_DEFAULTS = {
  v: 2,
  enabled: true,
  preset: "standard",
  ...PRESETS.standard,
  frequency: 1.0, // multiplier on the per-check encounter chance
  presence: 2, // 0 off, 1 rare, 2 normal, 3 constant
  grab: true, // the grab / struggle sequence (off: plain strikes)
  jumpscares: true, // "behind you", bed visit
  fakeChat: true, // fake chat lines (only the haunted player sees them)
  torchSnuff: true, // it puts out torches (they can be relit)
  caveEncounters: true,
  surfaceEncounters: true, // night encounters in dark woods / outside at night
  openDoors: true,
  maxConcurrent: 2,
  debugLog: false,
};

export const WORLD_LIMITS = {
  frequency: [0.25, 2],
  presence: [0, 3],
  cooldownMin: [90, 1800],
  cooldownMax: [120, 2400],
  firstMin: [30, 1800],
  firstMax: [60, 2400],
  postDeathSeconds: [60, 1200],
  presenceScale: [0.3, 2],
  chaseSpeed: [0.36, 0.45],
  pursuitSeconds: [12, 45],
  agitationScale: [0.5, 1.8],
  throwDamage: [1, 20],
  biteDamage: [1, 30],
  strikeDamage: [1, 20],
  strugglePresses: [3, 16],
  healthMultiplier: [0.5, 2.5],
  maxConcurrent: [1, 3],
};

export const PLAYER_DEFAULTS = {
  v: 2,
  volume: 1.0, // 0..1 multiplier on every Tailwail sound for this player
  camera: 2, // 0 off, 1 reduced (no shake/FOV punches), 2 full
  music: true,
  fog: true,
  captions: false, // action-bar captions for important cues
  guideGiven: false,
};

// When and where encounters may start.
export const ENCOUNTER = {
  spawnMin: 18,
  spawnMax: 30,
  spawnAttempts: 30,
  routeNodeBudget: 700,
  spawnMaxLight: 7,
  spawnMinPlayerGap: 14,
  caveSkyLightMax: 3, // player counts as "underground" at or below this sky light
  checkChance: 0.35, // per 10 s eligibility roll at frequency 1.0
  checkPeriod: 10,
  maxTargetDistance: 72,
  groupRadius: 24,
  lowHealthDefer: 6, // HP
  recentHurtDefer: 6,
};

// Escalation stages (per player).  0 unease, 1 watched, 2 hunted, 3 obsessed.
export const STAGE = {
  watchedAfterPresence: 3, // presence events experienced
  watchedAfterSeconds: 360, // eligible (underground / night) seconds
  huntedAfterEncounters: 1,
  obsessedAfterEncounters: 4,
  obsessedAfterEscapes: 2,
};

export const STALK = {
  durationMin: 30,
  durationMax: 60,
  hardCap: 150,
  nearMin: 10,
  farMax: 26,
  repositionMin: 2.5,
  repositionMax: 5,
  noticeTime: 0.4, // continuous gaze that counts as "noticed"
  standoffStare: 2.0, // noticed + this much staring -> stand-off
  standoffApproach: 16, // walking toward it inside this distance -> stand-off
  hiddenLoseTrack: 12, // seconds the target stays hidden before it gives up
  breathMin: 10,
  breathMax: 20,
  knockMin: 18,
  knockMax: 35,
  snuffMin: 14,
  snuffMax: 28,
  standoffMin: 9,
  standoffMax: 14,
  peekHideStare: 1.4,
  slinkChance: 0.35, // first notice: chance it slinks away instead of holding
};

export const STANDOFF = {
  durationMax: 80,
  commitAtTimeout: 55,
  calmDistance: 24,
  calmAgitation: 60,
  hiddenCalm: 8, // seconds hidden (or out of sight) that end a calm stand-off
  tooClose: 4.5, // creeping this close ends the stand-off: it commits
  creepDelay: 0.3, // unwatched this long -> it moves
  creepBurst: 3.5, // blocks per burst
  creepBurstMax: 1.6, // seconds per burst
  creepCooldown: 0.6,
  perfMinGap: 3,
  perfMaxGap: 8,
  creakChance: 0.6, // freezing into a new pose makes a bone-creak
};

export const AGITATION = {
  max: 100,
  cueTwo: 35, // >= this: twitching tail, heavy breath, distorted imitation
  cueThree: 65, // >= this: curled tail, frantic breath, tremor, jaw parts
  grace: 2.0, // seconds of free gaze ("a glance is safe")
  graceRefill: 0.4,
  stareRate: 4.0, // per second of staring beyond the grace budget
  closeDistance: 8,
  closeRate: 2.2,
  approachRate: 6.0,
  approachSpeed: 0.8,
  approachRange: 16,
  sprintRange: 16,
  sprintBurst: 14,
  sprintRate: 5.0,
  hitBurst: 100, // hitting it ends the stand-off
  hitCooldown: 0.5,
  calmDecay: 6.0,
  calmRange: 9,
  drift: 0.5,
};

export const CHASE = {
  escapeNoSight: 6,
  escapeDistance: 14,
  sightRange: 40,
  grabReach: 2.9, // horizontal, from body centre
  grabReachVertical: 2.6,
  grabFacingCos: 0.3,
  grabCooldown: 3.5,
  strikeRange: 3.0,
  strikeCooldown: 1.4,
  stuckProgress: 0.6,
  stuckWindow: 3.0,
  recoveryAttempts: 3,
  screechMin: 3.5,
  screechMax: 7,
  snuffEvery: 0.8, // torches along its path
  stepEvery: 1.62,
};

export const GRAB = {
  hold: 2.6, // seconds held at its face
  freeStagger: CLIP.frustrated,
  othersDamageToDrop: 10, // damage from other players during a hold that makes it let go
  throwH: 2.4, // knockback (horizontal) on release
  throwV: 0.55,
  freeDamage: 2,
  // measured from tw2_hold at 1.5x (tools/client_sim.py composite): both hands meet 2.39 blocks
  // in front at 3.1 up; the head is 1.73 in front at 3.05 up.  The victim's feet go here:
  holdForward: 2.35,
  holdUp: 1.95,
  faceForward: 1.73,
  faceUp: 3.05,
  needHeadroom: 4, // the hold pose stands up; lower ceilings use a strike instead
  throwSideDeg: -35, // the throw swings to its right
};

export const SEARCH = {
  points: 4,
  radius: 7,
  listen: 1.8,
  maxDuration: 14,
  hiddenLight: 5, // sneaking at or below this light is hiding
  hiddenDetect: 2.8, // a hidden player is still found inside this distance
  noiseRadius: 24,
};

export const RETREAT = {
  distanceMin: 26,
  distanceMax: 38,
  hideDistance: 20,
  minBeforeDespawn: 3,
  maxDuration: 40,
  hardCap: 90,
  respots: 3,
  owlChance: 0.65, // walks away with its head turned all the way round, watching you
};

export const IMITATION = {
  delayMin: 0.5,
  delayMax: 1.2,
  cooldown: 3.0,
  holdMin: 1.2,
  holdMax: 3.0,
  crouchMinHold: 0.5,
  tiltDegrees: 28,
  tiltHold: 0.6,
  moveSpeed: 2.0,
  stopSpeed: 0.3,
  movingFor: 1.0,
  stoppedFor: 0.8,
  chance: 0.85,
  rememberedChance: 0.6,
  rememberedMinCount: 2,
};

export const MEMORY = {
  version: 1,
  decay: 0.85,
  countCap: 99,
  recentSetups: 4,
  maxBytes: 900,
};

// Presence: what happens BETWEEN encounters.  Intervals (s) per stage, scaled by settings.
export const PRESENCE = {
  interval: [[100, 170], [70, 130], [50, 100], [40, 80]],
  minGapAfterEncounter: 45,
  footstepFollow: [8, 14], // seconds a footstep echo lasts
  footstepBehind: [9, 15], // blocks behind the player
  mimicWindow: 60, // seconds an armed mimic waits for an action
  mimicDelay: [1.1, 2.2],
  glimpseRange: [22, 40],
  glimpseLife: 7,
  peekRange: [12, 24],
  behindWindow: 2.2, // seconds to turn around after the breath
  snuffRange: [5, 16],
  doorRange: 12,
};

export const AUDIO = {
  hearing: 56,
  perPlayerPerSecond: 4,
};
