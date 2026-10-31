// Central tuning for TAILWAIL.
// Every gameplay number lives here so balance changes never require touching logic.
// Times are seconds unless a name ends in Ticks.  Distances are blocks.

export const ADDON_VERSION = "3.1.0";
export const NS = "tailwail";
export const ENTITY_ID = "tailwail:tall_wail";
export const LURE_ID = "tailwail:lure";
export const ECHO_ID = "tailwail:echo";
export const SNUFFED_TORCH_ID = "tailwail:snuffed_torch";
export const GUIDE_ITEM_ID = "tailwail:field_guide";

export const TICKS = {
  decision: 2, // brain update period (10 Hz: hits land on the clip's impact frame)
  director: 20, // scheduler / presence housekeeping period
  presence: 4, // footstep echo / mimicry follow-up period
  sweep: 200, // orphan sweep period
};
export const DT = TICKS.decision / 20;

// Movement attribute values.  Measured on BDS 1.26.61 with the 0.9-wide box:
// ground speed (blocks/s) ~= 43.2 * value^2  (0.30 -> 3.89 b/s, 0.45 -> 8.74 b/s).
export const SPEED = {
  creep: 0.2, // ~1.7 b/s  slow stalking advance (watched)
  walk: 0.25, // ~2.7 b/s  approach
  search: 0.34, // ~5.0 b/s  hunting for you
  retreat: 0.36, // ~5.6 b/s
  burst: 0.42, // ~7.6 b/s  repositioning while unseen, crossing your view
  flee: 0.46, // ~9.1 b/s  wounded, running for its life
  squeeze: 0.2, // ~1.7 b/s  forcing itself through a 1-high gap (any faster speed is capped to this)
};
export const speedToBlocksPerSecond = (v) => 43.2 * v * v;

// Posture profiles: collision height (must match entities/tall_wail.json) and the
// air clearance (in whole blocks) Tailwail needs before it may adopt the profile.
export const POSTURE = {
  tall: { height: 3.9, clearance: 5, eye: 3.5 },
  hunch: { height: 2.8, clearance: 3, eye: 2.3 },
  crawl: { height: 1.8, clearance: 2, eye: 1.2 },
  squeeze: { height: 0.9, clearance: 1, eye: 0.6 }, // crushed flat through 1-high gaps
};
export const POSTURE_ORDER = ["squeeze", "crawl", "hunch", "tall"];
export const POSTURE_MIN_HOLD = 1.5; // seconds between posture growth (hysteresis)

// One-shot clip lengths and their hit / release times are generated into core/ids.js (SHOT)
// from the baked clips, so they can never drift from the resource pack.
export const CLIP = {
  death: 2.4, // animation.tall_wail.v3.death (act, holds its last frame)
};

// Difficulty presets.  Identical rules, different magnitudes.
// chaseSpeed 0.425 on every preset: the Cave Dweller's chase (Gargin's mod: movement speed 0.5 x
// chase speed modifier 0.85; mobs move ~43 * value^2 blocks/s in both editions) = ~7.8 blocks/s,
// faster than a sprinting player (5.6).  You do not outrun it; you break its line of sight, hide, or fight.
// lostSeconds: out of sight this long (and lostDistance away) before it loses you.
// struggle: [min, max] presses for the grab struggle; inescapable: chance a grab cannot be broken.
export const PRESETS = {
  calm: {
    cooldownMin: 420, cooldownMax: 720, firstMin: 300, firstMax: 480, postDeathSeconds: 360,
    presenceScale: 0.7, chaseSpeed: 0.425, lostSeconds: 6, agitationScale: 0.8,
    swipeDamage: 4, slamDamage: 6, pounceDamage: 5, throwDamage: 4, biteDamage: 7, smashDamage: 6,
    struggleMin: 4, struggleMax: 7, inescapable: 0, healthMultiplier: 0.8, fleeAt: 0.45,
  },
  standard: {
    cooldownMin: 270, cooldownMax: 450, firstMin: 180, firstMax: 330, postDeathSeconds: 240,
    presenceScale: 1.0, chaseSpeed: 0.425, lostSeconds: 8, agitationScale: 1.0,
    swipeDamage: 6, slamDamage: 9, pounceDamage: 7, throwDamage: 6, biteDamage: 11, smashDamage: 9,
    struggleMin: 6, struggleMax: 11, inescapable: 0.12, healthMultiplier: 1.0, fleeAt: 0.35,
  },
  nightmare: {
    cooldownMin: 160, cooldownMax: 300, firstMin: 100, firstMax: 200, postDeathSeconds: 180,
    presenceScale: 1.4, chaseSpeed: 0.425, lostSeconds: 11, agitationScale: 1.3,
    swipeDamage: 8, slamDamage: 12, pounceDamage: 9, throwDamage: 8, biteDamage: 15, smashDamage: 12,
    struggleMin: 9, struggleMax: 15, inescapable: 0.25, healthMultiplier: 1.6, fleeAt: 0.25,
  },
};

export const WORLD_DEFAULTS = {
  v: 4,
  enabled: true,
  preset: "standard",
  ...PRESETS.standard,
  frequency: 1.0, // multiplier on the per-check encounter chance
  presence: 2, // 0 off, 1 rare, 2 normal, 3 constant
  // The grab and its mash-to-escape struggle are parked: the code (mc/grab.js, the brain's grab
  // state, core/combat_rules.js struggleSpec) is kept and tested for reuse, but no setting turns it
  // on in game (mc/store.js forces this off).
  grab: false,
  jumpscares: true, // "behind you", bed visit
  torchSnuff: true, // it puts out torches (they can be relit)
  caveEncounters: true,
  surfaceEncounters: true, // night encounters outside, in the dark
  openDoors: true,
  breakBlocks: 2, // 0 never, 1 smashes doors / trapdoors / gates, 2 also glass
  climbing: true, // climbs walls to reach you
  ambushes: true, // ceiling and corner ambushes in caves
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
  chaseSpeed: [0.36, 0.5],
  lostSeconds: [4, 16],
  agitationScale: [0.5, 1.8],
  swipeDamage: [1, 20],
  slamDamage: [1, 24],
  pounceDamage: [1, 20],
  throwDamage: [1, 20],
  biteDamage: [1, 30],
  smashDamage: [1, 24],
  struggleMin: [2, 16],
  struggleMax: [3, 20],
  inescapable: [0, 0.5],
  healthMultiplier: [0.5, 2.5],
  fleeAt: [0, 0.6],
  breakBlocks: [0, 2],
  maxConcurrent: [1, 3],
};

export const PLAYER_DEFAULTS = {
  v: 3,
  volume: 1.0, // 0..1 multiplier on every Tailwail sound for this player
  camera: 2, // 0 off, 1 reduced (no shake/FOV punches), 2 full
  music: true,
  fog: true,
  captions: false, // action-bar captions for important cues
  guideGiven: false,
  rpChecked: "", // last add-on version whose resource-pack check this player was shown
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

// The opening: short "beats" in which it shows itself (watching, peeking, running across
// your view), each ending with it bolting off, holding your stare, or coming for you.
export const STALK = {
  beatsMin: 1,
  beatsMax: 3,
  hardCap: 75, // the whole opening never lasts longer than this
  nearMin: 12,
  farMax: 30,
  watchMin: 2.5, // seconds it holds a spot when nobody looks
  watchMax: 6,
  noticeTime: 0.35, // continuous gaze that counts as "noticed"
  reactDelay: 0.25, // it reacts this fast to being seen
  approachStandoff: 14, // walking toward it inside this distance -> stand-off
  hiddenLoseTrack: 10,
  chargeChance: [0.15, 0.3, 0.45, 0.6], // per stage: being seen makes it charge right away
  bolt: 0.45, // otherwise: chance it bolts out of sight (else it holds the stare)
  crossChance: 0.3, // a beat where it sprints across your view instead of watching
};

// The stand-off: seconds, not minutes.  It creeps at you even while watched now.
// The stand-off is an observation: it stands idle, approaches slowly, or tests how you react.
export const STANDOFF = {
  durationMin: 6,
  durationMax: 13,
  tooClose: 6, // it commits when this close
  turnAwayCharge: 0.8, // looking away this long makes it charge
  stareLimit: [5, 9], // staring straight at it this long (a glance does not count) sets it off
  idle: [1.5, 3.2], // seconds of each observation mode
  approach: [2.0, 3.6],
  approachStep: 2.4, // blocks per slow advance
  feintStep: [3.0, 4.5], // the bluff charge: this far at full speed, then it stops dead
  feintTime: 0.9,
  sidestep: [2.5, 4.0],
  withdraw: [2.5, 3.5],
  craneTime: 1.4,
  reactWindow: [1.2, 1.8], // how long it reads your reaction to a test
  decideBase: 0.12, // after each mode: chance it simply decides to attack (+ agitation, stage, time)
  decideMax: 0.85,
  perfMinGap: 1.5,
  perfMaxGap: 3.5,
};

export const AGITATION = {
  max: 100,
  cueTwo: 30,
  cueThree: 60,
  grace: 1.0,
  graceRefill: 0.4,
  stareRate: 9.0,
  closeDistance: 9,
  closeRate: 6,
  approachRate: 10,
  approachSpeed: 0.8,
  approachRange: 16,
  sprintRange: 16,
  sprintBurst: 20,
  sprintRate: 8,
  hitBurst: 100,
  hitCooldown: 0.5,
  calmDecay: 2.0,
  calmRange: 9,
  drift: 2.0,
};

// The hunt.  Relentless while it can see or hear you; no time budget.
export const CHASE = {
  lostDistance: 18, // with settings.lostSeconds out of sight
  sightRange: 48,
  hardCap: 160, // a single unbroken hunt ends (it "lets you go") after this long
  grabReach: 2.9, // horizontal, from body centre
  grabReachVertical: 2.6,
  grabFacingCos: 0.3,
  grabCooldown: 9,
  grabChance: 0.45, // per attack decision in grab range (when grabs are on)
  swipeRange: 3.3,
  attackInterval: 1.0, // the Cave Dweller's melee rhythm: one attack a second while you are in reach
  comboChance: 0.35,
  slamRange: 3.6,
  slamCooldown: 6,
  slamChance: 0.25,
  pounceMin: 5,
  pounceMax: 11,
  pounceCooldown: 7,
  pounceChance: 0.55,
  pounceSpeed: 1.25, // horizontal impulse
  pounceLift: 0.45,
  pounceHitRange: 2.6,
  roarEvery: [10, 18],
  stuckProgress: 0.6,
  stuckWindow: 2.4,
  recoveryAttempts: 4,
  screechMin: 3.0,
  screechMax: 6,
  snuffEvery: 0.8, // torches along its path
  stepEvery: 1.5,
  climbMinRise: 2.5, // target this much higher and unreachable -> it climbs
  climbMaxRise: 14,
  climbSpeed: 3.2, // blocks per second up the wall
  bashHits: [3, 5], // door / glass hits before it breaks through
  reachInTime: [1.6, 2.6], // an arm into your hole first; then it squeezes its whole body in after you
  squeezeIn: 10, // seconds it stays crushed flat to follow you through the gap
};

export const GRAB = {
  lunge: 0.5, // lunge_grab clip
  window: [2.2, 3.4], // seconds you get to struggle (randomised every grab)
  stillWindow: [2.0, 3.0], // "don't move": stay still this long and it drops you
  gripShiftChance: 0.3, // halfway through it shifts its grip: the input changes
  kinds: { jump: 3, sneak: 2, alternate: 2, still: 1 }, // weights of the struggle kinds
  othersDamageToDrop: 10, // damage from other players during a hold that makes it let go
  throwH: 2.6, // knockback (horizontal) on a throw
  throwV: 0.6,
  freeDamage: 2,
  stunned: [1.6, 2.4], // after you tear free
  savor: [1.0, 1.8], // after it hurts you: it stands over you, then hunts on
  // measured from the hold clip at 1.5x (tools/client_sim.py composite): the victim's feet go here
  holdForward: 2.35,
  holdUp: 1.95,
  faceForward: 1.73,
  faceUp: 3.05,
  needHeadroom: 4, // the hold pose stands up; lower ceilings use strikes instead
  throwSideDeg: -35, // the throw swings to its right
};

export const SEARCH = {
  points: 5,
  radius: 8,
  listen: 1.4,
  maxDuration: 22,
  hiddenLight: 5, // sneaking at or below this light is hiding
  hiddenDetect: 2.8, // a hidden player is still found inside this distance
  noiseRadius: 28,
  returnChance: 0.45, // it pretends to leave, then comes back running
  returnDelay: [25, 50],
};

export const RETREAT = {
  distanceMin: 26,
  distanceMax: 38,
  hideDistance: 20,
  minBeforeDespawn: 2,
  maxDuration: 35,
  hardCap: 80,
  respots: 3,
  owlChance: 0.5, // walks away with its head turned all the way round, watching you
};

// Ambushes (caves): hanging from the ceiling, or balled up in a corner facing the wall.
export const AMBUSH = {
  clingMinCeiling: 5, // blocks of open air under the ceiling spot
  clingMaxCeiling: 10,
  dropRange: 4.5, // horizontal distance at which it lets go
  lookUpDrop: 1.2, // seconds of being stared at from below before it drops anyway
  huddleTrigger: 7,
  huddleStare: 2.0,
  waitMax: 45, // nobody came: it slips away
};

// Surface (night) openers.
export const SURFACE = {
  nightStart: 13000,
  nightEnd: 23000,
  treelineRange: [26, 44],
  runnerRange: [22, 34],
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
  interval: [[70, 120], [50, 95], [35, 75], [28, 60]],
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
