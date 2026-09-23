// The ONLY shared mutable state of the add-on. Modules import { S } and read/write fields listed in ARCHITECTURE.md §4.
/** @type {Record<string, any>} */
export const S = {
  tick: 0,
  loaded: false,
  /** parsed config object (config.js) */
  config: null,
  /** the live creature Entity or undefined */
  active: undefined,
  /** per-encounter record (director.js) or undefined */
  record: undefined,
  /** parsed reservation (reservation.js) or undefined */
  reservation: undefined,
  /** preview session (preview.js) or undefined */
  preview: undefined,
  /** chain fragment markers: [{pos, until}] */
  markers: [],
  /** live waypoint entity ids */
  waypoints: [],
  /** recent noise events: [{tick, kind, pos, playerId, loudness}] */
  noise: [],
  /** playerId -> ring of movement samples */
  samples: new Map(),
  lastError: 0,
  nextNaturalCheck: 0,
  naturalGraceUntil: 0,
  debug: false,
  /** playerId -> current music track name */
  music: new Map(),
  /** looping sound bookkeeping: key -> nextTick */
  loops: new Map(),
  /** history ring of encounter variants (persisted) */
  history: [],
  /** answering-the-mine listener */
  mine: { intervals: [], lastBreak: 0, playerId: undefined, interruptedUntil: 0 },
  /** omens in flight (omens.js) */
  omen: undefined,
  /** lure bookkeeping per encounter: [{pos, tick}] */
  lures: [],
  /** owner player id cache */
  owner: undefined,
  /** whether master gate is currently off (cached from config) */
  muted: false,
};

/** Fresh encounter record. All fields listed in ARCHITECTURE.md §4 (state.js). */
export function newRecord(generation, mode, variant, targetId, tick) {
  return {
    generation, mode, variant, state: 'EMERGE', since: tick, stateEntered: tick, startedTick: tick, budgetEnd: tick + 20 * 150,
    huntStart: 0, huntBudgetTicks: 900, target: targetId,
    tension: 0, pose: 'emerge', action: 0, actionUntil: 0, overlay: 0, track: false, motion: '', low: false,
    lastPos: undefined, lastProgress: tick, nextAttack: tick + 40, pendingAttack: null,
    enragedUntil: 0, snapCooldownUntil: 0, hurtCooldownUntil: 0, fragmentsEnabled: false, lastFragment: 0,
    lit: { count: 0, threshold: 3, hesitating: false, until: 0 },
    omens: { nextAllowed: tick, lastKind: undefined, footstepsUsed: 0, mineUsed: 0, dragUsed: 0 },
    lastLink: { active: false, releasedAt: 0 },
    corner: { active: false, coverPoint: undefined, revealPoint: undefined, watchedTicks: 0, hesitateUntil: 0, tightened: false, moves: 0 },
    thresholds: [], flank: { active: false, point: undefined, since: 0 }, retreatPause: { used: false, active: false, until: 0 },
    stalkStart: 0, stalkLength: 600, sightingOnly: false, unreachableTicks: 0, outsideTicks: 0, lureRedirect: undefined,
    staredTotal: 0, rageAnnounced: false, lastLine: 0, snapPending: false, warned: false, faceYaw: undefined,
    // director bookkeeping (documented here so every field of a record is declared in one place)
    virtualHealth: 80, observeUntil: 0, omenBudgetEnd: 0, omensPlayed: 0, omensEndWithoutSpawn: false, spawnTries: 0, investigatePoint: undefined,
    warningUntil: 0, searchPoint: undefined, vanishAt: 0, vanishDone: 0, collapseDone: 0, flinchUntil: 0, snapUntil: 0, targetLit: false, noLosTicks: 0, feintDone: false,
  };
}
