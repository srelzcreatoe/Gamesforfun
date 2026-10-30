import test from "node:test";
import assert from "node:assert/strict";
import { makeBrain, run, snap } from "./helpers.mjs";
import { CLIP, CHASE, STANDOFF } from "../packs/TailwailBP/scripts/config.js";
import { MAX_STATE_TIME } from "../packs/TailwailBP/scripts/core/brain.js";

const COMMIT_STATES = new Set(["unfold", "windup", "chase"]);

function commitFromStandoff(brain) {
  brain.enter("standoff", "test");
  brain.agit.value = 99.9;
}

test("full commitment: unfold then the supplied 3.2 s wind-up, then exactly one wail", () => {
  const { brain, ctx } = makeBrain();
  commitFromStandoff(brain);
  const s = snap({ target: { dist: 10, hdist: 10, watching: true } });
  run(brain, 0.4, s);
  assert.equal(brain.state, "unfold");
  let windupStart = null;
  let chaseStart = null;
  for (let i = 0; i < 60; i++) {
    run(brain, 0.2, s);
    if (brain.state === "windup" && windupStart === null) windupStart = brain.t;
    if (brain.state === "chase" && chaseStart === null) chaseStart = brain.t;
  }
  assert.ok(windupStart !== null && chaseStart !== null);
  assert.ok(Math.abs(chaseStart - windupStart - CLIP.windup) <= 0.21, `windup lasted ${chaseStart - windupStart}`);
  assert.equal(ctx.calls.cue.filter((c) => c === "wail").length, 1);
  assert.equal(ctx.calls.damage, 0, "no damage before pursuit can even reach");
});

test("rigid tail appears only during a real commitment", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const { brain, ctx } = makeBrain("delayed_imitation", { seed });
    run(brain, 120, (t) => snap({ target: { dist: 8 + (t % 7), hdist: 8, watching: t % 5 < 3, closing: t % 3 < 1 ? 1 : 0 } }));
    for (const v of ctx.calls.visuals) {
      if (v.tail === "rigid") assert.ok(COMMIT_STATES.has(v.state), `rigid tail in ${v.state}`);
    }
  }
});

test("provocation never skips the warning: a hit while stalking gives >= 5 s before damage", () => {
  const { brain, ctx } = makeBrain();
  const close = snap({ target: { dist: 2.5, hdist: 2.5, watching: true } });
  for (let i = 0; i < 6; i++) {
    brain.onHit(true);
    run(brain, 0.2, close);
  }
  let firstDamage = null;
  for (let i = 0; i < 80 && firstDamage === null; i++) {
    run(brain, 0.2, close);
    if (ctx.calls.damage > 0) firstDamage = brain.t;
  }
  assert.ok(firstDamage !== null, "it does eventually attack");
  assert.ok(firstDamage >= CLIP.unfold + CLIP.windup, `first damage at ${firstDamage}`);
});

test("once committed, looking at it does not freeze it", () => {
  const { brain, ctx } = makeBrain();
  brain.enter("chase", "test");
  const before = ctx.calls.moveTo;
  run(brain, 3, snap({ target: { dist: 15, hdist: 15, watching: true }, anyWatching: true }));
  assert.ok(ctx.calls.moveTo > before + 5, "keeps moving while watched");
});

test("escape after ~8 s out of sight with separation, then search, frustration, retreat and despawn when hidden", () => {
  const { brain, ctx } = makeBrain();
  brain.enter("chase", "test");
  run(brain, 1.2, snap({ target: { dist: 12, hdist: 12 } }));
  run(brain, CHASE.escapeNoSight + 0.4, snap({ target: { dist: 20, hdist: 20, canSee: false } }));
  assert.equal(brain.state, "search");
  run(brain, 20, snap({ target: { dist: 25, hdist: 25, canSee: false }, anyWatching: false, anyLos: false }));
  assert.ok(brain.done, "despawned");
  assert.deepEqual(ctx.calls.despawn, ["escaped"]);
});

test("pursuit budget is finite even if the target stays in sight but out of reach", () => {
  const { brain } = makeBrain("delayed_imitation", { settings: { pursuitSeconds: 20 } });
  brain.enter("chase", "test");
  run(brain, 24, snap({ target: { dist: 9, hdist: 9 } }));
  assert.ok(["search", "retreat"].includes(brain.state), brain.state);
});

test("calm withdrawal ends a stand-off without an attack", () => {
  const { brain, ctx } = makeBrain();
  brain.enter("standoff", "test");
  run(brain, 3, snap({ target: { dist: 11 } }));
  run(brain, 2, snap({ target: { dist: 21, movingAway: true, closing: -1 } }));
  assert.equal(brain.state, "retreat");
  assert.equal(brain.outcome, "calm");
  assert.equal(ctx.calls.damage, 0);
});

test("stand-off has a maximum duration that cannot be stalled by staring groups", () => {
  const { brain } = makeBrain();
  brain.enter("standoff", "test");
  // observers watching but agitation kept low (glances with long pauses, far away)
  run(brain, STANDOFF.durationMax + 2, (t) => snap({ target: { dist: 14, watching: t % 10 < 1 }, anyWatching: true }));
  assert.notEqual(brain.state, "standoff");
});

test("stalking holds still while watched and repositions while unobserved", () => {
  const { brain, ctx } = makeBrain();
  run(brain, 4, snap({ target: { dist: 20, watching: true }, anyWatching: true }));
  assert.equal(ctx.calls.moveTo, 0);
  run(brain, 4, snap({ target: { dist: 20, watching: false }, anyWatching: false }));
  assert.ok(ctx.calls.moveTo > 0);
});

test("delayed copy: a crouch seen during the stand-off is replayed 1-2 s later; nothing is learned unseen", () => {
  const { brain, ctx } = makeBrain("delayed_imitation", { settings: { imitationChance: 1 } });
  brain.enter("standoff", "test");
  run(brain, 1, snap({ target: { dist: 10 } }));
  const crouchAt = brain.t;
  let shownAt = null;
  run(brain, 4, (t) => {
    const v = ctx.calls.visuals[ctx.calls.visuals.length - 1];
    if (v && v.mimic === "crouch" && shownAt === null) shownAt = t;
    return snap({ target: { dist: 10, sneaking: true } });
  });
  assert.ok(shownAt !== null);
  assert.ok(shownAt - crouchAt >= 0.9 && shownAt - crouchAt <= 2.3, `copy after ${(shownAt - crouchAt).toFixed(2)} s`);
  const b2 = makeBrain("delayed_imitation", { settings: { imitationChance: 1 } });
  b2.brain.enter("standoff", "test");
  run(b2.brain, 4, snap({ target: { dist: 10, sneaking: true, canSee: false } }));
  assert.ok(b2.ctx.calls.visuals.every((v) => v.mimic === "none"), "cannot copy what it cannot see");
});

test("remembered gesture opens a later encounter before the player performs it", () => {
  const { brain, ctx } = makeBrain("delayed_imitation", { remembered: { type: "tilt", pitch: -30 } });
  run(brain, 3, snap({ target: { dist: 20, watching: true }, anyWatching: true }));
  assert.ok(ctx.calls.visuals.some((v) => v.mimic === "tilt"));
});

test("target loss always leads to a clean withdrawal", () => {
  const { brain, ctx } = makeBrain();
  brain.enter("chase", "test");
  run(brain, 1, snap({ target: { valid: false, alive: false } }));
  assert.equal(brain.state, "retreat");
  run(brain, 8, snap({ target: { valid: false }, anyWatching: false, anyLos: false }));
  assert.equal(ctx.calls.despawn.length, 1);
});

test("outcome labels: a kill during pursuit is 'caught', a disconnect is not", () => {
  const a = makeBrain();
  a.brain.enter("chase", "test");
  run(a.brain, 0.4, snap({ target: { valid: true, alive: false } }));
  assert.equal(a.brain.outcome, "caught");
  const b = makeBrain();
  b.brain.enter("chase", "test");
  run(b.brain, 0.4, snap({ target: { valid: false, alive: false } }));
  assert.equal(b.brain.outcome, "escaped");
});

test("every state has a ceiling", () => {
  for (const st of ["stalk", "standoff", "search"]) {
    const { brain } = makeBrain();
    brain.enter(st, "test");
    run(brain, MAX_STATE_TIME[st] + 2, snap({ target: { dist: 30, watching: true, canSee: false }, anyWatching: true }));
    assert.notEqual(brain.state, st, `${st} overstayed`);
  }
});

test("voluntary withdrawal setup leaves after being noticed, without a stand-off", () => {
  const { brain } = makeBrain("voluntary_withdrawal");
  run(brain, 20, snap({ target: { dist: 22, watching: true }, anyWatching: true }));
  assert.equal(brain.state, "retreat");
  assert.equal(brain.outcome, "observed");
});
