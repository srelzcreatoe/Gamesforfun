import test from "node:test";
import assert from "node:assert/strict";
import { createAgitation, stepAgitation, cueLevel } from "../packs/TailwailBP/scripts/core/agitation.js";
import { createDetector, observe, createImitator, offer, updateImitator } from "../packs/TailwailBP/scripts/core/gestures.js";
import { createStrikeState, startStrike, resolveImpact, finishStrike, canStartStrike, inGrabReach, struggleProgress } from "../packs/TailwailBP/scripts/core/combat_rules.js";
import { createLimiter, allow, createPlayerBudget, spend } from "../packs/TailwailBP/scripts/core/audio_rules.js";
import { AGITATION, IMITATION, CHASE, CLIP } from "../packs/TailwailBP/scripts/config.js";
import { makeRng } from "../packs/TailwailBP/scripts/util/rng.js";

const calm = { watched: false, distance: 11, closing: 0, sprinting: false, hits: 0, movingAway: false };

test("agitation: a brief glance is free, staring beyond the grace budget is not", () => {
  const a = createAgitation();
  for (let i = 0; i < 6; i++) stepAgitation(a, { ...calm, watched: true }, 0.2); // 1.2 s glance
  const afterGlance = a.value;
  assert.ok(afterGlance < 1.0, `glance cost ${afterGlance}`);
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

test("contact: a strike lands at most once; no LOS, no reach or no facing means no damage", () => {
  const s = createStrikeState();
  startStrike(s, 0);
  const geom = { hdist: 2, dy: 0, facingCos: 1, los: true, targetValid: true };
  assert.equal(resolveImpact(s, CLIP.strikeImpact - 0.2, geom), false, "before the impact frame");
  assert.equal(resolveImpact(s, CLIP.strikeImpact + 0.01, geom), true);
  assert.equal(resolveImpact(s, CLIP.strikeImpact + 0.2, geom), false, "never twice");
  finishStrike(s, CLIP.strike + 0.01);
  assert.equal(canStartStrike(s, CLIP.strike + 0.1, geom), false, "cooldown");
  assert.equal(canStartStrike(s, CLIP.strike + CHASE.strikeCooldown + 0.05, geom), true);
  for (const bad of [{ los: false }, { hdist: 4 }, { facingCos: 0 }, { targetValid: false }, { dy: 4 }]) {
    const s2 = createStrikeState();
    startStrike(s2, 0);
    assert.equal(resolveImpact(s2, CLIP.strikeImpact + 0.01, { ...geom, ...bad }), false, JSON.stringify(bad));
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
