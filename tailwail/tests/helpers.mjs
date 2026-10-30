// Shared test fixtures: a mock adapter for the Brain and snapshot builders.
import { makeRng } from "../packs/TailwailBP/scripts/util/rng.js";
import { WORLD_DEFAULTS } from "../packs/TailwailBP/scripts/config.js";
import { emptyMemory } from "../packs/TailwailBP/scripts/core/memory.js";
import { Brain } from "../packs/TailwailBP/scripts/core/brain.js";

export function mockCtx() {
  const calls = { cue: [], moveTo: 0, hold: 0, damage: 0, despawn: [], visuals: [], recover: 0 };
  const ctx = {
    calls,
    log() {},
    cue: (n) => calls.cue.push(n),
    setVisual: (v) => calls.visuals.push({ ...v }),
    hold: () => calls.hold++,
    moveTo: () => calls.moveTo++,
    faceToward() {},
    recover: () => calls.recover++,
    findObservationSpot: () => ({ x: 20, y: 0, z: 0 }),
    findStandoffSpot: () => ({ x: 10, y: 0, z: 0 }),
    findRetreatSpot: () => ({ x: 40, y: 0, z: 0 }),
    findSearchPoints: (o) => [{ x: o.x + 2, y: 0, z: o.z }, { x: o.x - 2, y: 0, z: o.z }],
    findCover: () => ({ x: 22, y: 0, z: 5 }),
    dealDamage: () => calls.damage++,
    despawn: (o) => calls.despawn.push(o),
  };
  return ctx;
}

export function snap(over = {}) {
  const target = {
    valid: true, alive: true, dimensionOk: true, eligible: true, pos: { x: 0, y: 0, z: 0 }, dist: 10, hdist: 10, dy: 0,
    canSee: true, watching: false, sneaking: false, sprinting: false, pitch: 0, speed: 0, closing: 0, movingAway: false,
    ...(over.target || {}),
  };
  return {
    target,
    anyWatching: over.anyWatching ?? target.watching,
    anyLos: over.anyLos ?? true,
    others: { nearCreature: 0, ...(over.others || {}) },
    creature: { pos: { x: 10, y: 0, z: 0 }, posture: "tall", headroom: 8, stuck: false, ...(over.creature || {}) },
    strikeGeom: { hdist: target.hdist, dy: 0, facingCos: 1, los: true, targetValid: true, ...(over.strikeGeom || {}) },
  };
}

export function makeBrain(setup = "delayed_imitation", over = {}) {
  const ctx = mockCtx();
  const brain = new Brain({
    setup,
    settings: { ...WORLD_DEFAULTS, ...(over.settings || {}) },
    memory: over.memory || emptyMemory(),
    rng: makeRng(over.seed || 42),
    ctx,
    remembered: over.remembered || null,
  });
  return { brain, ctx };
}

/** advance the brain `seconds` with the same snapshot (or a function of time) */
export function run(brain, seconds, snapOrFn, dt = 0.2) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    const s = typeof snapOrFn === "function" ? snapOrFn(brain.t) : snapOrFn;
    brain.update(s, dt);
    if (brain.done) break;
  }
}
