// Shared test fixtures: a mock adapter for the Brain and snapshot builders.
import { makeRng } from "../packs/TailwailBP/scripts/util/rng.js";
import { WORLD_DEFAULTS } from "../packs/TailwailBP/scripts/config.js";
import { emptyMemory } from "../packs/TailwailBP/scripts/core/memory.js";
import { Brain } from "../packs/TailwailBP/scripts/core/brain.js";

export function mockCtx(opts = {}) {
  const calls = {
    cue: [], fx: [], moveTo: [], hold: 0, damage: [], despawn: [], visuals: [], recover: 0, grabStart: [], grabEnd: [], flags: [],
    play: [], pounce: 0, placeAt: 0, drop: 0, climbStart: 0, bashStart: 0, returns: 0, struggle: 0,
  };
  const ctx = {
    calls,
    grabOk: opts.grabOk ?? true,
    creepOk: opts.creepOk ?? true,
    clingOk: opts.clingOk ?? true,
    huddleOk: opts.huddleOk ?? true,
    climbOk: opts.climbOk ?? true,
    bashOk: opts.bashOk ?? true,
    crossOk: opts.crossOk ?? false,
    log() {},
    cue: (n) => calls.cue.push(n),
    fx: (n) => calls.fx.push(n),
    setVisual: (v) => calls.visuals.push({ ...v }),
    play: (n) => calls.play.push(n),
    hold: () => calls.hold++,
    moveTo: (p, speed, why) => calls.moveTo.push({ why: why || "move", speed }),
    faceToward() {},
    faceNow() {},
    pounce: () => calls.pounce++,
    recover: () => calls.recover++,
    findObservationSpot: () => ({ x: 20, y: 0, z: 0 }),
    findStandoffSpot: () => ({ x: 10, y: 0, z: 0 }),
    findRetreatSpot: () => ({ x: 40, y: 0, z: 0 }),
    findSearchPoints: (o) => [{ x: o.x + 2, y: 0, z: o.z }, { x: o.x - 2, y: 0, z: o.z }],
    findCover: () => ({ x: 22, y: 0, z: 5, side: "l" }),
    findCreepPoint: () => (ctx.creepOk ? { x: 6, y: 0, z: 0 } : null),
    findCrossPath: () => (ctx.crossOk ? { a: { x: 20, y: 0, z: -12 }, b: { x: 20, y: 0, z: 12 } } : null),
    placeAt: () => calls.placeAt++,
    cling: () => ctx.clingOk,
    huddle: () => ctx.huddleOk,
    drop: () => calls.drop++,
    climbStart: () => {
      calls.climbStart++;
      return ctx.climbOk;
    },
    climbAbort() {},
    bashStart: () => {
      calls.bashStart++;
      return ctx.bashOk;
    },
    bashStop() {},
    grabStart: (spec) => {
      calls.grabStart.push(spec);
      return ctx.grabOk;
    },
    grabStruggle: () => calls.struggle++,
    grabEnd: (k) => calls.grabEnd.push(k),
    dealDamage: (k) => calls.damage.push(k),
    despawn: (o) => calls.despawn.push(o),
    scheduleReturn: () => calls.returns++,
    onFlag: (f) => calls.flags.push(f),
  };
  return ctx;
}

export function snap(over = {}) {
  const target = {
    valid: true, alive: true, eligible: true, pos: { x: 0, y: 0, z: 0 }, dist: 10, hdist: 10, dy: 0,
    canSee: true, watching: false, glance: false, inView: false, los: true, sneaking: false, sprinting: false, pitch: 0, speed: 0,
    closing: 0, movingAway: false, hidden: false, light: 4, noise: null, inGap: false,
    ...(over.target || {}),
  };
  if (target.watching && over.target && over.target.inView === undefined) target.inView = true;
  return {
    target,
    anyWatching: over.anyWatching ?? target.watching,
    anyInView: over.anyInView ?? target.inView,
    anyLos: over.anyLos ?? true,
    others: { nearCreature: 0, ...(over.others || {}) },
    creature: {
      pos: { x: 10, y: 0, z: 0 }, posture: "tall", headroom: 8, stuck: false, atGoal: false, health: 160, maxHealth: 160,
      climbing: false, bashing: false, blocked: null, ...(over.creature || {}),
    },
    reach: { hdist: target.hdist, dy: target.dy, facingCos: 1, los: true, targetValid: true, holdClear: true, ...(over.reach || {}) },
    grab: { holding: false, success: false, failed: false, calm: false, ...(over.grab || {}) },
  };
}

export function makeBrain(setup = "stalker", over = {}) {
  const ctx = mockCtx(over);
  const memory = over.memory || emptyMemory();
  const brain = new Brain({
    setup,
    settings: { ...WORLD_DEFAULTS, ...(over.settings || {}) },
    memory,
    rng: makeRng(over.seed || 42),
    ctx,
    remembered: over.remembered || null,
    showcase: !!over.showcase,
    stage: over.stage || 0,
  });
  return { brain, ctx };
}

/** advance the brain `seconds` with the same snapshot (or a function of time) */
export function run(brain, seconds, snapOrFn, dt = 0.1) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const s = typeof snapOrFn === "function" ? snapOrFn(brain.t) : snapOrFn;
    brain.update(s, dt);
    if (brain.done) break;
  }
}

/** run until a predicate holds (or a time limit passes); returns the elapsed brain time */
export function until(brain, pred, snapOrFn, limit = 60, dt = 0.1) {
  const t0 = brain.t;
  while (!pred(brain) && brain.t - t0 < limit && !brain.done) {
    const s = typeof snapOrFn === "function" ? snapOrFn(brain.t) : snapOrFn;
    brain.update(s, dt);
  }
  return brain.t - t0;
}

/** Puts a brain straight into the hunt (past its opening). */
export function hunting(over = {}) {
  const { brain, ctx } = makeBrain(over.setup || "the_hunter", over);
  until(brain, (b) => b.state === "hunt", snap({ target: { dist: 20, hdist: 20 } }), 10);
  return { brain, ctx };
}
