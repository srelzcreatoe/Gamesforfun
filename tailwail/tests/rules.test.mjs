import test from "node:test";
import assert from "node:assert/strict";
import { createAgitation, stepAgitation, cueLevel } from "../packs/TailwailBP/scripts/core/agitation.js";
import { createDetector, observe, createImitator, offer, updateImitator } from "../packs/TailwailBP/scripts/core/gestures.js";
import { HIT_REACH, chooseAttack, createCooldowns, hitLands, inGrabReach, pickFinisher, spendAttack, struggleProgress, struggleSpec } from "../packs/TailwailBP/scripts/core/combat_rules.js";
import { createLimiter, allow, createPlayerBudget, spend } from "../packs/TailwailBP/scripts/core/audio_rules.js";
import { AGITATION, IMITATION, CHASE, PRESETS, WORLD_DEFAULTS } from "../packs/TailwailBP/scripts/config.js";
import { makeRng } from "../packs/TailwailBP/scripts/util/rng.js";

const calm = { watched: false, distance: 11, closing: 0, sprinting: false, hits: 0, movingAway: false };

test("agitation: a brief glance is free, staring beyond the grace budget is not", () => {
  const a = createAgitation();
  for (let i = 0; i < 4; i++) stepAgitation(a, { ...calm, watched: true }, 0.2); // a short glance
  const afterGlance = a.value;
  // a glance inside the grace budget costs nothing beyond the slow ambient drift
  assert.ok(afterGlance <= AGITATION.drift * 0.8 + 0.01, `glance cost ${afterGlance}`);
  for (let i = 0; i < 25; i++) stepAgitation(a, { ...calm, watched: true }, 0.2); // 5 more seconds
  assert.ok(a.value > 15, `stare should agitate, got ${a.value}`);
});

test("agitation: repeated glances do not reset accumulated agitation and drain the grace budget", () => {
  const a = createAgitation(50);
  for (let k = 0; k < 6; k++) {
    for (let i = 0; i < 6; i++) stepAgitation(a, { ...calm, watched: true }, 0.2);
    for (let i = 0; i < 3; i++) stepAgitation(a, { ...calm, watched: false }, 0.2);
  }
  assert.ok(a.value >= 50, "never reset below where it was");
  assert.ok(a.grace < AGITATION.grace, "grace budget is consumed by repeated glances");
});

test("agitation: calm retreat lowers it; hits are rate limited bursts; clamps to 100", () => {
  const a = createAgitation(60);
  for (let i = 0; i < 25; i++) stepAgitation(a, { ...calm, distance: 15, movingAway: true }, 0.2);
  assert.ok(a.value < 60, "calm retreat reduces agitation");
  const b = createAgitation(0);
  stepAgitation(b, { ...calm, hits: 3 }, 0.2);
  const one = b.value;
  stepAgitation(b, { ...calm, hits: 1 }, 0.2); // inside hitCooldown
  assert.ok(b.value - one < AGITATION.hitBurst, "second hit inside cooldown adds no burst");
  for (let i = 0; i < 10; i++) stepAgitation(b, { ...calm, hits: 1, distance: 1 }, 1);
  assert.equal(b.value, 100);
  assert.equal(cueLevel(10), 1);
  assert.equal(cueLevel(80), 2);
});

test("gestures: a crouch is learned only after it is held, and only while observed continuously", () => {
  const d = createDetector();
  let g = null;
  for (let t = 0; t < 0.4; t += 0.2) g = observe(d, { sneaking: true, pitch: 0, speed: 0 }, t) || g;
  assert.equal(g, null, "too short");
  g = observe(d, { sneaking: true, pitch: 0, speed: 0 }, 0.6);
  assert.equal(g && g.type, "crouch");
  // observation gap: crouch that started while unseen cannot be inferred
  const d2 = createDetector();
  observe(d2, { sneaking: false, pitch: 0, speed: 0 }, 0);
  observe(d2, { sneaking: true, pitch: 0, speed: 0 }, 5.0); // seen again after 5 s
  const g2 = observe(d2, { sneaking: true, pitch: 0, speed: 0 }, 5.2);
  assert.equal(g2, null, "timer restarted after the gap");
});

test("gestures: head tilt and stop-start are detected", () => {
  const d = createDetector();
  let got = [];
  for (let t = 0; t < 2; t += 0.2) { const g = observe(d, { sneaking: false, pitch: 0, speed: 0 }, t); if (g) got.push(g.type); }
  for (let t = 2; t < 3; t += 0.2) { const g = observe(d, { sneaking: false, pitch: -40, speed: 0 }, t); if (g) got.push(g.type); }
  for (let t = 3; t < 4.4; t += 0.2) { const g = observe(d, { sneaking: false, pitch: -40, speed: 4 }, t); if (g) got.push(g.type); }
  for (let t = 4.4; t < 6; t += 0.2) { const g = observe(d, { sneaking: false, pitch: -40, speed: 0 }, t); if (g) got.push(g.type); }
  assert.deepEqual(got, ["tilt", "step"]);
});

test("imitation: replays land 1-2 s after the gesture began and grow with agitation", () => {
  const rng = makeRng(1);
  for (let k = 0; k < 50; k++) {
    const im = createImitator();
    const r = offer(im, { type: "crouch", t: 10 }, 10, 0, rng, 1);
    const sinceStart = r.at - (10 - IMITATION.crouchMinHold);
    assert.ok(sinceStart >= 0.99 && sinceStart <= 2.0, `replay ${sinceStart.toFixed(2)} s after start`);
  }
  const low = offer(createImitator(), { type: "crouch", t: 0 }, 0, 10, makeRng(2), 1);
  const high = offer(createImitator(), { type: "crouch", t: 0 }, 0, 95, makeRng(2), 1);
  assert.ok(high.amt > low.amt && high.until - high.at > low.until - low.at);
  const im = createImitator();
  offer(im, { type: "tilt", t: 0, pitch: -30 }, 0, 0, makeRng(3), 1);
  let seen = "none";
  for (let t = 0; t < 6; t += 0.2) { const v = updateImitator(im, t); if (v.mimic !== "none") seen = v.mimic; }
  assert.equal(seen, "tilt");
  assert.ok(im.cooldownUntil > 0);
  assert.equal(offer(im, { type: "crouch", t: 0 }, im.cooldownUntil - 0.1, 0, makeRng(4), 1), null, "cooldown blocks immediate repeat");
});

test("contact: every hit needs reach, sight and (for rakes) facing at its impact frame", () => {
  const geom = { hdist: 2, dy: 0, facingCos: 1, los: true, targetValid: true };
  for (const kind of Object.keys(HIT_REACH)) assert.equal(hitLands(kind, geom), true, kind);
  for (const bad of [{ los: false }, { hdist: 5 }, { targetValid: false }, { dy: 4 }]) {
    for (const kind of Object.keys(HIT_REACH)) assert.equal(hitLands(kind, { ...geom, ...bad }), false, kind + JSON.stringify(bad));
  }
  assert.equal(hitLands("swipe_r", { ...geom, facingCos: -0.5 }), false, "a rake behind its back misses");
  assert.equal(hitLands("slam", { ...geom, facingCos: -0.5, hdist: 3.9 }), true, "the slam's shockwave goes all round");
  assert.equal(hitLands("nothing", geom), false);
});

test("contact: attack choice follows range, cooldowns, headroom and the grab setting", () => {
  const rng = makeRng(1);
  const base = { t: 0, settings: WORLD_DEFAULTS, rng, headroom: 8, canGrab: true, tunnel: false };
  const g = (over) => ({ hdist: 2.4, dy: 0, facingCos: 1, los: true, targetValid: true, ...over });
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(chooseAttack({ ...base, cd: createCooldowns(), geom: g({}) }));
  for (const k of ["grab", "slam", "combo", "swipe_r", "swipe_l"]) assert.ok(seen.has(k), "close range never picks " + k);
  assert.ok(!seen.has("pounce"), "no pounce at arm's length");
  const mid = new Set();
  for (let i = 0; i < 200; i++) mid.add(chooseAttack({ ...base, cd: createCooldowns(), geom: g({ hdist: 8 }) }));
  assert.deepEqual([...mid].sort(), [null, "pounce"].sort());
  for (let i = 0; i < 200; i++) {
    const k = chooseAttack({ ...base, cd: createCooldowns(), geom: g({}), headroom: 4, tunnel: false, canGrab: false });
    assert.ok(k !== "slam" && k !== "grab", k);
    assert.ok(chooseAttack({ ...base, cd: createCooldowns(), geom: g({ hdist: 8 }), tunnel: true }) !== "pounce");
  }
  assert.equal(chooseAttack({ ...base, cd: createCooldowns(), geom: g({ los: false }) }), null, "never through walls");
  const cd = createCooldowns();
  spendAttack(cd, "pounce", 10, makeRng(2));
  assert.ok(cd.pounce >= 10 + CHASE.pounceCooldown && cd.swipe > 10, "cooldowns spent");
});

test("contact: the struggle spec follows the preset; finishers fit the ceiling", () => {
  const rng = makeRng(5);
  for (const name of Object.keys(PRESETS)) {
    const s = { ...WORLD_DEFAULTS, ...PRESETS[name] };
    for (let i = 0; i < 100; i++) {
      const sp = struggleSpec(s, rng, i % 3);
      if (sp.kind !== "alternate") assert.ok(sp.needed >= s.struggleMin && sp.needed <= s.struggleMax, `${name} ${sp.needed}`);
      if (name === "calm") assert.equal(sp.inescapable, false, "calm is always escapable");
      if (i % 3 === 0) assert.equal(sp.inescapable, false);
    }
  }
  for (let i = 0; i < 50; i++) {
    assert.equal(pickFinisher(rng, 4), "bite");
    assert.ok(["bite", "throw", "smash"].includes(pickFinisher(rng, 8)));
  }
});

test("contact: a grab needs reach, sight and facing; struggle progress is bounded", () => {
  const ok = { hdist: CHASE.grabReach - 0.1, dy: 0, facingCos: 0.9, los: true, targetValid: true };
  assert.equal(inGrabReach(ok), true);
  for (const bad of [{ los: false }, { hdist: CHASE.grabReach + 0.2 }, { facingCos: 0 }, { targetValid: false }, { dy: 3 }]) {
    assert.equal(inGrabReach({ ...ok, ...bad }), false, JSON.stringify(bad));
  }
  assert.equal(inGrabReach(null), false);
  assert.equal(struggleProgress(0, 7), 0);
  assert.equal(struggleProgress(14, 7), 1);
  assert.equal(struggleProgress(3, 0), 1);
});

test("audio: per-cue gaps and a per-player rate cap", () => {
  const l = createLimiter();
  assert.equal(allow(l, "breath_far", 0), true);
  assert.equal(allow(l, "breath_far", 3), false);
  assert.equal(allow(l, "breath_far", 9), true);
  assert.equal(allow(l, "no_such_cue", 0), false);
  const b = createPlayerBudget(3);
  assert.deepEqual([spend(b, 0), spend(b, 0.1), spend(b, 0.2), spend(b, 0.3)], [true, true, true, false]);
  assert.equal(spend(b, 1.5), true);
});
