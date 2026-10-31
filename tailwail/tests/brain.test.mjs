import test from "node:test";
import assert from "node:assert/strict";
import { MAX_STATE_TIME, STATES } from "../packs/TailwailBP/scripts/core/brain.js";
import { ACT, SHOT } from "../packs/TailwailBP/scripts/core/ids.js";
import { CHASE, GRAB, PRESETS, SEARCH, STALK, STANDOFF, WORLD_DEFAULTS } from "../packs/TailwailBP/scripts/config.js";
import { hunting, makeBrain, run, snap, until } from "./helpers.mjs";

const lastVis = (ctx) => ctx.calls.visuals[ctx.calls.visuals.length - 1];

test("the hunter: one scream, then the hunt, with chase music", () => {
  const { brain, ctx } = makeBrain("the_hunter");
  assert.equal(brain.state, "engage");
  const t = until(brain, (b) => b.state === "hunt", snap({ target: { dist: 25, hdist: 25 } }), 10);
  assert.ok(t <= SHOT.scream.len + 0.3, `hunt after ${t}s`);
  assert.equal(ctx.calls.play.filter((n) => n === "scream").length, 1);
  assert.ok(ctx.calls.fx.includes("chase_on"));
  assert.equal(lastVis(ctx).act, "loco");
});

test("quick to action: every stalker opening reaches the hunt fast, whatever the seed", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { brain } = makeBrain("stalker", { seed });
    // the player looks at it, from 18 blocks, and does nothing else
    const t = until(brain, (b) => b.state === "hunt", snap({ target: { dist: 18, hdist: 18, watching: true, glance: true } }), 120);
    assert.equal(brain.state, "hunt", `seed ${seed} stuck in ${brain.state}`);
    assert.ok(t < STALK.hardCap + STANDOFF.durationMax + 6, `seed ${seed}: ${t.toFixed(1)}s before the hunt`);
  }
});

test("stand-off: it creeps at you even while watched, and turning your back makes it charge", () => {
  const { brain, ctx } = makeBrain("stalker", { seed: 3 });
  brain.enter("standoff", "test");
  run(brain, 3, snap({ target: { dist: 16, hdist: 16, watching: true, glance: true } }));
  assert.ok(ctx.calls.moveTo.some((m) => m.why === "creep"), "creeps while watched");
  assert.equal(brain.state, "standoff");
  const t = until(brain, (b) => b.state !== "standoff", snap({ target: { dist: 16, hdist: 16, watching: false } }), 5);
  assert.equal(brain.state, "engage");
  assert.ok(t <= STANDOFF.turnAwayCharge + 0.25, `charged after ${t}s`);
});

test("observation: it stands idle, approaches slowly, and tests you (bluff charge, sidestep, backing off, neck crane)", () => {
  const modes = new Set();
  const tests = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    const { brain, ctx } = makeBrain("stalker", { seed });
    brain.enter("standoff", "test");
    // kept at the edge of your view: never "stared at", never "turned away from"
    const s = snap({ target: { dist: 18, hdist: 18, watching: false, glance: true, inView: true } });
    let feint = false;
    for (let i = 0; i < 140 && brain.state === "standoff"; i++) {
      brain.update(s, 0.1);
      if (brain.so && brain.so.mode) modes.add(brain.so.mode);
      if (brain.so && brain.so.test) tests.add(brain.so.test.kind);
      if (brain.so && brain.so.test && brain.so.test.kind === "feint" && brain.so.test.phase !== "go") feint = true;
    }
    if (feint) assert.ok(ctx.calls.moveTo.some((m) => m.why === "feint" && m.speed === WORLD_DEFAULTS.chaseSpeed),
      "the bluff charge runs at full speed");
  }
  for (const m of ["idle", "approach", "test"]) assert.ok(modes.has(m), `never ${m}: ${[...modes]}`);
  for (const k of ["feint", "sidestep", "withdraw", "crane"]) assert.ok(tests.has(k), `never tested with ${k}: ${[...tests]}`);
});

test("observation: staring at it too long sets it off; a glance does not", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { brain } = makeBrain("stalker", { seed });
    brain.enter("standoff", "test");
    const t = until(brain, (b) => b.state !== "standoff", snap({ target: { dist: 18, hdist: 18, watching: true } }), 20);
    assert.equal(brain.state, "engage", `seed ${seed}`);
    assert.ok(t <= STANDOFF.stareLimit[1] + 0.3, `stared ${t.toFixed(1)}s`);
    assert.ok(brain.history.some((h) => / \((stared|agitated|decided)\)/.test(h)), brain.history.slice(-3).join(" | "));
    const g = makeBrain("stalker", { seed }).brain;
    g.enter("standoff", "test");
    run(g, STANDOFF.stareLimit[1] + 0.5, snap({ target: { dist: 18, hdist: 18, watching: false, glance: true, inView: true } }));
    assert.ok(!g.history.some((h) => h.includes("(stared)")), "a glance is not a stare");
  }
});

test("observation: shooting at it provokes it at once (a roar, not the long scream), then it sprints at you", () => {
  for (const setup of ["stalker", "treeline"]) {
    const { brain, ctx } = makeBrain(setup, { seed: 4 });
    brain.enter("standoff", "test");
    run(brain, 0.5, snap({ target: { dist: 20, hdist: 20, glance: true } }));
    run(brain, 0.1, snap({ target: { dist: 20, hdist: 20, glance: true, aggro: "shot" } }));
    assert.equal(brain.state, "engage");
    assert.ok(ctx.calls.play.includes("roar") && !ctx.calls.play.includes("scream"), ctx.calls.play.join());
    until(brain, (b) => b.state === "hunt", snap({ target: { dist: 20, hdist: 20 } }), 3);
    assert.equal(brain.state, "hunt");
    run(brain, 0.3, snap({ target: { dist: 20, hdist: 20 } }));
    assert.equal(ctx.calls.moveTo[ctx.calls.moveTo.length - 1].speed, WORLD_DEFAULTS.chaseSpeed);
  }
  // shot at while it is still stalking, or waiting on the ceiling
  const st = makeBrain("stalker", { seed: 2 }).brain;
  run(st, 0.3, snap({ target: { dist: 22, hdist: 22, aggro: "shot" } }));
  assert.equal(st.state, "engage");
  const am = makeBrain("ceiling", { seed: 2, stage: 1 }).brain;
  run(am, 0.3, snap({ target: { dist: 12, hdist: 12, aggro: "shot" } }));
  assert.ok(am.am.triggered, "the ceiling ambush drops when shot at");
});

test("observation: running from its test makes it likelier to come; holding still calms it", () => {
  let ran = 0;
  let held = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const a = makeBrain("stalker", { seed }).brain;
    a.enter("standoff", "test");
    a.so.modes = 3;
    a.so.test = { kind: "feint", react: { fled: 4, advanced: 0 } };
    const before = a.agit.value;
    a.judgeReaction();
    assert.ok(a.agit.value >= Math.min(100, before + 29) || a.state === "engage");
    if (a.state === "engage") ran++;
    const b = makeBrain("stalker", { seed }).brain;
    b.enter("standoff", "test");
    b.so.modes = 3;
    b.so.test = { kind: "feint", react: { fled: 0, advanced: 0 } };
    b.judgeReaction();
    if (b.state === "engage") held++;
  }
  assert.ok(ran > held, `ran ${ran} vs held ${held}`);
});

test("the grab and its mash struggle are parked: default settings never grab", () => {
  assert.equal(WORLD_DEFAULTS.grab, false);
  for (let seed = 1; seed <= 20; seed++) {
    const { brain, ctx } = hunting({ seed });
    run(brain, 12, snap({ target: { dist: 2.4, hdist: 2.4 } }));
    assert.equal(ctx.calls.grabStart.length, 0, `seed ${seed} grabbed`);
    assert.ok(!ctx.calls.play.includes("lunge_grab"));
  }
});

test("Cave Dweller pace: 7.8 blocks/s on every preset, one attack a second at arm's length", () => {
  for (const p of Object.values(PRESETS)) assert.equal(p.chaseSpeed, 0.425);
  assert.ok(Math.abs(43.2 * 0.425 * 0.425 - 7.8) < 0.05);
  for (let seed = 1; seed <= 10; seed++) {
    const { brain, ctx } = hunting({ seed, settings: { slamChance: 0 } });
    const starts = [];
    let prev = null;
    for (let i = 0; i < 100; i++) {
      brain.update(snap({ target: { dist: 2.4, hdist: 2.4 }, creature: { headroom: 4 } }), 0.1);
      if (brain.state === "attack" && prev !== "attack") starts.push(brain.t);
      prev = brain.state;
    }
    assert.ok(starts.length >= 8, `seed ${seed}: only ${starts.length} attacks in 10 s`);
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] - starts[i - 1] >= CHASE.attackInterval - 0.05, "never faster than once a second");
    assert.ok(ctx.calls.damage.length >= 8);
  }
});

test("stand-off: too close commits; a hit commits", () => {
  let { brain } = makeBrain("stalker");
  brain.enter("standoff", "test");
  run(brain, 0.3, snap({ target: { dist: STANDOFF.tooClose - 0.5, hdist: 5, watching: true } }));
  assert.equal(brain.state, "engage");
  ({ brain } = makeBrain("stalker"));
  brain.enter("standoff", "test");
  brain.onHit(true, 5);
  run(brain, 0.2, snap({ target: { dist: 15, hdist: 15, watching: true } }));
  assert.equal(brain.state, "engage");
});

test("attacks: up close it rakes, combos, slams or grabs; damage only lands at a hit frame in reach", () => {
  const kinds = new Set();
  for (let seed = 1; seed <= 30; seed++) {
    const { brain, ctx } = hunting({ seed, settings: { grab: true } });
    until(brain, (b) => b.state === "attack" || b.state === "grab", snap({ target: { dist: 2.4, hdist: 2.4 } }), 3);
    if (brain.state === "grab") {
      kinds.add("grab");
      continue;
    }
    assert.equal(brain.state, "attack", `seed ${seed}`);
    kinds.add(brain.a.kind);
    const kind = brain.a.kind;
    run(brain, SHOT[kind].len + 0.2, snap({ target: { dist: 2.4, hdist: 2.4 } }));
    const hits = (SHOT[kind].hits || []).length;
    if (kind !== "pounce") assert.equal(ctx.calls.damage.length, hits, `${kind} should land ${hits}`);
  }
  for (const k of ["swipe_r", "swipe_l", "combo", "grab"]) assert.ok(kinds.has(k), `never chose ${k}: ${[...kinds]}`);
});

test("attacks: out of reach at the hit frame is a miss", () => {
  const { brain, ctx } = hunting({ seed: 5, settings: { grab: false } });
  until(brain, (b) => b.state === "attack", snap({ target: { dist: 2.4, hdist: 2.4 } }), 3);
  assert.equal(brain.state, "attack");
  run(brain, 1.2, snap({ target: { dist: 7, hdist: 7 } }));
  assert.equal(ctx.calls.damage.length, 0);
});

test("pounce: from mid range it leaps (impulse at launch) and keeps hunting", () => {
  let found = false;
  for (let seed = 1; seed <= 20 && !found; seed++) {
    const { brain, ctx } = hunting({ seed });
    until(brain, (b) => b.state === "attack", snap({ target: { dist: 8, hdist: 8 } }), 4);
    if (brain.state !== "attack" || brain.a.kind !== "pounce") continue;
    found = true;
    run(brain, SHOT.pounce.len + 0.3, snap({ target: { dist: 2, hdist: 2 } }));
    assert.equal(ctx.calls.pounce, 1);
    assert.ok(["hunt", "savor", "grab"].includes(brain.state), brain.state);
  }
  assert.ok(found, "no seed pounced from 8 blocks");
});

test("no slam under a low ceiling, no throw or smash finisher under 6 blocks", () => {
  for (let seed = 1; seed <= 30; seed++) {
    const { brain } = hunting({ seed, settings: { grab: false } });
    until(brain, (b) => b.state === "attack", snap({ target: { dist: 2.4, hdist: 2.4 }, creature: { headroom: 4 } }), 3);
    if (brain.state === "attack") assert.notEqual(brain.a.kind, "slam");
  }
  for (let seed = 1; seed <= 20; seed++) {
    const { brain, ctx } = hunting({ seed });
    brain.enter("grab", "test");
    run(brain, GRAB.lunge + 0.2, snap({ target: { dist: 2, hdist: 2 }, creature: { headroom: 4 }, grab: { holding: true } }));
    run(brain, 0.2, snap({ target: { dist: 2, hdist: 2 }, creature: { headroom: 4 }, grab: { holding: true, failed: true } }));
    assert.equal(brain.g.finisher, "bite", `seed ${seed}: ${brain.g.finisher}`);
    assert.ok(ctx.calls.play.includes("bite"));
  }
});

test("struggle varies: kinds, counts, windows, grip shifts; the first grab is always escapable", () => {
  const kinds = new Set();
  const counts = new Set();
  let shifts = 0;
  let inescapable = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const { brain, ctx } = hunting({ seed, settings: { inescapable: 0.3 } });
    brain.grabs = seed % 2; // half first grabs, half later ones
    brain.enter("grab", "test");
    const spec = ctx.calls.grabStart[0];
    kinds.add(spec.kind);
    counts.add(spec.needed);
    if (spec.shiftAt !== null) shifts++;
    if (spec.inescapable) inescapable++;
    if (seed % 2 === 0) {
      assert.equal(spec.inescapable, false, "first grab inescapable");
      assert.notEqual(spec.kind, "still", "first grab is 'still'");
    }
    assert.ok(spec.window >= GRAB.stillWindow[0] && spec.window <= GRAB.window[1] + 0.8 + 1e-9, `window ${spec.window}`);
  }
  for (const k of ["jump", "sneak", "alternate", "still"]) assert.ok(kinds.has(k), `never chose ${k}`);
  assert.ok(counts.size >= 4, `counts barely vary: ${[...counts]}`);
  assert.ok(shifts > 5 && inescapable > 2, `shifts ${shifts} inescapable ${inescapable}`);
});

test("after a failed struggle it hurts you, savours it, and HUNTS ON (it never just leaves)", () => {
  for (let seed = 1; seed <= 10; seed++) {
    const { brain, ctx } = hunting({ seed });
    brain.enter("grab", "test");
    const near = (g) => snap({ target: { dist: 2, hdist: 2 }, grab: g });
    run(brain, GRAB.lunge + 0.1, near({ holding: true }));
    assert.equal(brain.g.phase, "hold");
    assert.equal(ctx.calls.struggle, 1, "struggle clock started when the hands closed");
    run(brain, 0.2, near({ holding: true, failed: true }));
    assert.equal(brain.g.phase, "finisher");
    until(brain, (b) => b.state !== "grab", near({ holding: false }), 3);
    assert.ok(ctx.calls.grabEnd.length === 1 && ["bite", "throw", "smash"].includes(ctx.calls.grabEnd[0]), ctx.calls.grabEnd.join());
    assert.equal(brain.state, "savor");
    until(brain, (b) => b.state !== "savor", snap({ target: { dist: 4, hdist: 4 } }), 3);
    assert.equal(brain.state, "hunt", `seed ${seed}: ${brain.state}`);
  }
});

test("tearing free stuns it, then it roars and comes again", () => {
  const { brain, ctx } = hunting({ seed: 9 });
  brain.enter("grab", "test");
  run(brain, GRAB.lunge + 0.1, snap({ target: { dist: 2, hdist: 2 }, grab: { holding: true } }));
  run(brain, 0.1, snap({ target: { dist: 2, hdist: 2 }, grab: { holding: true, success: true } }));
  assert.deepEqual(ctx.calls.grabEnd, ["free"]);
  assert.equal(brain.state, "stunned");
  until(brain, (b) => b.state === "hunt", snap({ target: { dist: 6, hdist: 6 } }), 6);
  assert.equal(brain.state, "hunt");
  assert.ok(ctx.calls.play.includes("roar"));
});

test("staying still when told to: it drops you and moves on", () => {
  const { brain, ctx } = hunting({ seed: 4 });
  brain.enter("grab", "test");
  run(brain, GRAB.lunge + 0.1, snap({ target: { dist: 2, hdist: 2 }, grab: { holding: true } }));
  run(brain, 0.1, snap({ target: { dist: 2, hdist: 2 }, grab: { holding: true, calm: true } }));
  assert.deepEqual(ctx.calls.grabEnd, ["drop"]);
  assert.equal(brain.state, "savor");
});

test("relentless: while it can see you it never gives up (no time budget)", () => {
  const { brain } = hunting({ seed: 2, settings: { grab: false } });
  run(brain, 60, snap({ target: { dist: 14, hdist: 14 } }));
  assert.ok(["hunt", "attack", "savor", "engage"].includes(brain.state), brain.state);
  assert.equal(brain.outcome, null);
});

test("losing it: out of sight long enough and far enough -> search; hiding -> search", () => {
  let { brain } = hunting({ seed: 2 });
  const lost = (b) => b.state === "search";
  const t = until(brain, lost, snap({ target: { dist: CHASE.lostDistance + 2, hdist: 20, canSee: false } }), 30);
  assert.ok(lost(brain));
  assert.ok(t >= 7.8 && t <= 8.5, `lost after ${t}`);
  ({ brain } = hunting({ seed: 2 }));
  until(brain, lost, snap({ target: { dist: 10, hdist: 10, canSee: false, hidden: true } }), 10);
  assert.ok(lost(brain));
});

test("search: spotting you again means a roar and the hunt; noise redirects it; giving up may mean it comes back", () => {
  let { brain, ctx } = hunting({ seed: 2 });
  brain.enter("search", "test");
  run(brain, 1, snap({ target: { dist: 20, hdist: 20, canSee: false, noise: { pos: { x: 5, y: 0, z: 5 }, t: 0 } } }));
  assert.ok(ctx.calls.flags.includes("noise") || brain.se.pts.length);
  until(brain, (b) => b.state === "hunt", snap({ target: { dist: 12, hdist: 12 } }), 5);
  assert.equal(brain.state, "hunt");
  let returned = 0;
  for (let seed = 1; seed <= 12; seed++) {
    ({ brain, ctx } = hunting({ seed }));
    brain.enter("search", "test");
    until(brain, (b) => b.state === "leave", snap({ target: { dist: 30, hdist: 30, canSee: false } }), SEARCH.maxDuration + 6);
    assert.equal(brain.state, "leave", `seed ${seed}`);
    assert.ok(ctx.calls.play.includes("howl"));
    returned += ctx.calls.returns;
  }
  assert.ok(returned > 0, "it never pretended to leave");
});

test("wounded below the flee threshold: it screams and runs", () => {
  const { brain, ctx } = hunting({ seed: 2 });
  run(brain, 0.2, snap({ target: { dist: 8, hdist: 8 }, creature: { health: 40, maxHealth: 160 } }));
  assert.equal(brain.state, "flee");
  assert.equal(brain.outcome, "wounded");
  assert.ok(ctx.calls.cue.includes("scream_pain"));
  run(brain, 3, snap({ target: { dist: 20, hdist: 20 }, anyInView: false, creature: { health: 40, maxHealth: 160 } }));
  assert.ok(brain.done && ctx.calls.despawn.length === 1);
});

test("ceiling ambush: it waits upside down, drops when you pass underneath, then hunts", () => {
  const { brain, ctx } = makeBrain("ceiling");
  assert.equal(brain.state, "ambush");
  run(brain, 2, snap({ target: { dist: 12, hdist: 12 } }));
  assert.equal(lastVis(ctx).act, "cling");
  run(brain, 0.2, snap({ target: { dist: 4, hdist: 3 } }));
  assert.equal(ctx.calls.drop, 1);
  assert.ok(ctx.calls.play.includes("drop"));
  until(brain, (b) => b.state === "hunt", snap({ target: { dist: 4, hdist: 3 } }), 5);
  assert.equal(brain.state, "hunt");
  const { brain: b2 } = makeBrain("ceiling", { clingOk: false });
  assert.equal(b2.state, "stalk", "no ceiling spot: it stalks instead");
});

test("corner ambush: the heap turns round when you come close", () => {
  const { brain, ctx } = makeBrain("huddle");
  run(brain, 1, snap({ target: { dist: 15, hdist: 15 } }));
  assert.equal(lastVis(ctx).act, "huddle");
  run(brain, 0.2, snap({ target: { dist: 6, hdist: 6 } }));
  assert.ok(ctx.calls.play.includes("turn"));
  until(brain, (b) => b.state === "hunt", snap({ target: { dist: 6, hdist: 6 } }), 5);
  assert.equal(brain.state, "hunt");
});

test("terrain: it climbs to a ledge, smashes a door, reaches into a hole and then squeezes in after you", () => {
  let { brain, ctx } = hunting({ seed: 3 });
  run(brain, 0.1, snap({ target: { dist: 6, hdist: 4, dy: 5 }, reach: { los: false }, creature: { stuck: true } }));
  assert.equal(brain.state, "climb");
  assert.equal(ctx.calls.climbStart, 1);
  run(brain, 0.5, snap({ target: { dist: 6, hdist: 4, dy: 5 }, creature: { climbing: true } }));
  assert.equal(brain.state, "climb");
  run(brain, 0.1, snap({ target: { dist: 3, hdist: 3, dy: 0 }, creature: { climbing: false } }));
  assert.ok(["hunt", "attack", "grab"].includes(brain.state), brain.state);
  ({ brain, ctx } = hunting({ seed: 3 }));
  run(brain, 0.1, snap({ target: { dist: 8, hdist: 8 }, reach: { los: false }, creature: { blocked: "door" } }));
  assert.equal(brain.state, "bash");
  assert.equal(ctx.calls.bashStart, 1);
  assert.equal(lastVis(ctx).act, "bash");
  run(brain, 0.2, snap({ target: { dist: 8, hdist: 8 }, creature: { bashing: false } }));
  assert.equal(brain.state, "hunt");
  ({ brain, ctx } = hunting({ seed: 3, settings: { breakBlocks: 0 } }));
  run(brain, 0.5, snap({ target: { dist: 8, hdist: 8 }, reach: { los: false }, creature: { blocked: "door" } }));
  assert.notEqual(brain.state, "bash", "breaking blocks is off");
  ({ brain, ctx } = hunting({ seed: 3 }));
  run(brain, 0.2, snap({ target: { dist: 2.5, hdist: 2.5, inGap: true }, reach: { hdist: 2.2, facingCos: 1 } }));
  assert.equal(brain.state, "reach");
  run(brain, 1.5, snap({ target: { dist: 2.5, hdist: 2.2, inGap: true, canSee: false }, reach: { hdist: 2.2, dy: 0, facingCos: 1 } }));
  assert.ok(ctx.calls.damage.includes("reach"));
  until(brain, (b) => b.state !== "reach", snap({ target: { dist: 2.5, hdist: 2.2, inGap: true, canSee: false } }), 8);
  assert.equal(brain.state, "hunt", "it squeezes in after you");
  run(brain, 0.3, snap({ target: { dist: 2.5, hdist: 2.2, inGap: true }, creature: { posture: "squeeze", headroom: 1 } }));
  assert.equal(lastVis(ctx).postureWant, "squeeze", "it asks for the flattened posture");
  assert.notEqual(brain.state, "reach", "no second reach right away");
  assert.ok(ctx.calls.moveTo.length > 0 || brain.state === "attack");
  brain.enter("search", "test");
  run(brain, 0.3, snap({ target: { dist: 30, hdist: 30, canSee: false } }));
  assert.equal(lastVis(ctx).postureWant, null, "it does not search flattened");
});

test("squeezed flat in a 1-high gap: no pounces, no slams, no grabs, but it still rakes", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { brain } = hunting({ seed, settings: { grab: true } });
    const seen = new Set();
    for (let i = 0; i < 80; i++) {
      brain.update(snap({ target: { dist: 2.4, hdist: 2.4 }, creature: { posture: "squeeze", headroom: 1 } }), 0.1);
      if (brain.state === "attack") seen.add(brain.a.kind);
      assert.notEqual(brain.state, "grab");
    }
    assert.ok(!seen.has("pounce") && !seen.has("slam"), [...seen].join());
  }
});

test("headroom: under a low ceiling the scream becomes a roar", () => {
  const { brain, ctx } = makeBrain("the_hunter");
  brain.enter("engage", "test");
  run(brain, 0.1, snap({ creature: { headroom: 3 } }));
  const { brain: b2, ctx: c2 } = makeBrain("stalker");
  b2.update(snap({ creature: { headroom: 3 } }), 0.1);
  b2.enter("engage", "timeout");
  assert.ok(c2.calls.play.includes("roar") && !c2.calls.play.includes("scream"), c2.calls.play.join());
  assert.ok(ctx.calls.play.length >= 1);
});

test("death: the clip plays out, then it is removed; a grab in progress is released", () => {
  const { brain, ctx } = hunting({ seed: 3 });
  brain.enter("grab", "test");
  brain.die();
  assert.equal(brain.state, "death");
  assert.deepEqual(ctx.calls.grabEnd, ["abort"]);
  run(brain, 4, snap({}));
  assert.equal(ctx.calls.despawn[0], "killed");
});

test("target gone mid-hunt: it leaves and despawns out of sight", () => {
  const { brain, ctx } = hunting({ seed: 3 });
  run(brain, 0.2, snap({ target: { valid: false } }));
  assert.equal(brain.state, "leave");
  assert.equal(brain.outcome, "escaped");
  run(brain, 4, snap({ target: { valid: false }, anyInView: false }));
  assert.equal(ctx.calls.despawn.length, 1);
});

test("fuzz: 25 seeds of random perception never break the ceilings, the act ids or the grab bookkeeping", () => {
  const setups = ["stalker", "corner_peek", "ceiling", "huddle", "the_hunter", "treeline", "runner", "behind_you"];
  for (let seed = 1; seed <= 25; seed++) {
    const { brain, ctx } = makeBrain(setups[seed % setups.length], { seed, crossOk: seed % 3 === 0 });
    let holding = false;
    let r = seed * 7919;
    const rnd = () => ((r = (r * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = 0; i < 1500 && !brain.done; i++) {
      const d = 1 + rnd() * 40;
      if (brain.state === "grab" && brain.g && brain.g.holding) holding = true;
      const s = snap({
        target: { dist: d, hdist: d * 0.9, dy: rnd() < 0.1 ? 5 : 0, canSee: rnd() < 0.7, watching: rnd() < 0.4, hidden: rnd() < 0.1,
          inGap: rnd() < 0.05, alive: rnd() > 0.002 },
        creature: { stuck: rnd() < 0.05, headroom: rnd() < 0.3 ? 3 : 8, climbing: rnd() < 0.5, bashing: rnd() < 0.5,
          blocked: rnd() < 0.03 ? "door" : null, health: rnd() < 0.003 ? 30 : 160, maxHealth: 160 },
        grab: { holding: holding && rnd() < 0.98, success: rnd() < 0.05, failed: rnd() < 0.05, calm: rnd() < 0.02 },
      });
      brain.update(s, 0.1);
      assert.ok(STATES.includes(brain.state), brain.state);
      assert.ok(brain.stateT <= MAX_STATE_TIME[brain.state] + 0.2, `${brain.state} overstayed ${brain.stateT}`);
      const v = lastVis(ctx);
      if (v) assert.ok(v.act in ACT, `bad act ${v.act}`);
    }
    // every started grab was released exactly once
    assert.ok(ctx.calls.grabEnd.length <= ctx.calls.grabStart.length, `released ${ctx.calls.grabEnd.length} of ${ctx.calls.grabStart.length}`);
    if (brain.state !== "grab") assert.equal(ctx.calls.grabEnd.length, ctx.calls.grabStart.filter(() => ctx.grabOk).length);
  }
});
