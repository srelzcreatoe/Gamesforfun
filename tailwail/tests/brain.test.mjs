import test from "node:test";
import assert from "node:assert/strict";
import { makeBrain, run, snap, until } from "./helpers.mjs";
import { CHASE, CLIP, GRAB, SEARCH, STALK, STANDOFF } from "../packs/TailwailBP/scripts/config.js";
import { MAX_STATE_TIME, STATES } from "../packs/TailwailBP/scripts/core/brain.js";
import { BREATH, POSE, TAIL } from "../packs/TailwailBP/scripts/core/ids.js";
import { makeRng } from "../packs/TailwailBP/scripts/util/rng.js";

const watchedAt = (d) => snap({ target: { dist: d, hdist: d, watching: true } });
const unseenAt = (d) => snap({ target: { dist: d, hdist: d, watching: false, inView: false } });

function standoff(over = {}) {
  const r = makeBrain("statue_hunt", { veteran: true, ...over });
  r.brain.enter("standoff", "test");
  return r;
}

test("commit sequence: silent unfold, ONE scream, drop to all fours, then the chase", () => {
  const { brain, ctx } = standoff();
  brain.agit.value = 99.95;
  const s = watchedAt(10);
  const at = {};
  for (let i = 0; i < 60; i++) {
    run(brain, 0.2, s);
    if (at[brain.state] === undefined) at[brain.state] = brain.t;
  }
  for (const k of ["unfold", "scream", "windup", "chase"]) assert.ok(at[k] !== undefined, `reached ${k}`);
  assert.ok(Math.abs(at.scream - at.unfold - CLIP.unfold) <= 0.21, `unfold lasted ${at.scream - at.unfold}`);
  assert.ok(Math.abs(at.windup - at.scream - CLIP.scream) <= 0.21, `scream lasted ${at.windup - at.scream}`);
  assert.ok(Math.abs(at.chase - at.windup - CLIP.windupCut) <= 0.21, `windup lasted ${at.chase - at.windup}`);
  assert.equal(ctx.calls.cue.filter((c) => c === "scream").length, 1);
  const order = ["silence", "scream", "chase_on"].map((f) => ctx.calls.fx.indexOf(f));
  assert.ok(order[0] >= 0 && order[0] < order[1] && order[1] < order[2], `fx order ${ctx.calls.fx.join(",")}`);
  const unfoldVis = ctx.calls.visuals.filter((v) => v.state === "unfold");
  assert.ok(unfoldVis.every((v) => v.breath === "none" && v.tail === "rigid"), "it holds its breath while rising");
});

test("statue rule: it never moves while anyone has it on screen; it creeps when nobody does", () => {
  const { brain, ctx } = standoff();
  run(brain, 3, watchedAt(14));
  // a glance (on screen, not watched) also freezes it
  run(brain, 2, snap({ target: { dist: 14, hdist: 14, watching: false, inView: true } }));
  // another player watching freezes it too
  run(brain, 2, snap({ target: { dist: 14, hdist: 14, inView: false }, anyInView: true, anyWatching: true }));
  assert.equal(ctx.calls.moveTo.filter((m) => m === "creep").length, 0, "no creep while on screen");
  const before = brain.so.statue;
  run(brain, 0.6, unseenAt(14));
  assert.ok(ctx.calls.moveTo.includes("creep"), "creeps when unwatched");
  assert.ok(ctx.calls.cue.includes("skitter"));
  run(brain, 0.2, watchedAt(14));
  assert.equal(brain.so.creeping, false, "freezes the instant it is seen");
  assert.notEqual(brain.so.statue, before, "and it is standing differently");
  const poses = ctx.calls.visuals.slice(-1)[0].pose;
  assert.ok(poses.startsWith("statue_"), poses);
});

test("letting it creep too close ends the stand-off", () => {
  const { brain } = standoff();
  run(brain, 0.2, snap({ target: { dist: STANDOFF.tooClose - 0.3, hdist: STANDOFF.tooClose - 0.3 } }));
  assert.equal(brain.state, "unfold");
});

test("backing away calmly ends it without an attack; hiding does too", () => {
  const { brain, ctx } = standoff();
  run(brain, 1, watchedAt(12));
  run(brain, 1, watchedAt(STANDOFF.calmDistance + 1));
  assert.equal(brain.state, "retreat");
  assert.equal(brain.outcome, "calm");
  assert.equal(ctx.calls.grabStart + ctx.calls.damage, 0);
  assert.ok(ctx.calls.fx.includes("end"), "mood effects are ended");

  const h = standoff();
  run(h.brain, STANDOFF.hiddenCalm + 0.6, snap({ target: { dist: 12, hdist: 12, canSee: false, hidden: true } }));
  assert.equal(h.brain.state, "retreat");
  assert.ok(h.ctx.calls.flags.includes("hid"));
});

test("staring it down long enough makes it commit", () => {
  const { brain } = standoff();
  const t = until(brain, (b) => b.state === "unfold", watchedAt(12), 120);
  assert.equal(brain.state, "unfold");
  assert.ok(t >= 15 && t <= 60, `stare commit after ${t.toFixed(1)} s`);
});

test("provocation never skips the warning: a hit gives the full rise and scream before contact", () => {
  const { brain, ctx } = makeBrain("statue_hunt", { veteran: true });
  brain.onHit(true, 6);
  const close = snap({ target: { dist: 2.4, hdist: 2.4, watching: true } });
  const t = until(brain, () => ctx.calls.grabStart > 0, close, 30);
  assert.ok(ctx.calls.grabStart > 0, "it does eventually grab");
  assert.ok(t >= CLIP.unfold + CLIP.scream + CLIP.windupCut - 0.21, `first contact at ${t}`);
});

function chasing(over = {}) {
  const r = makeBrain("statue_hunt", { veteran: true, ...over });
  r.brain.enter("chase", "test");
  return r;
}
const inReach = (grab = {}) => snap({ target: { dist: 2, hdist: 2, watching: true }, grab: { holding: true, presses: 0, needed: 7, ...grab } });

test("grab: lifted, held; mashing jump breaks free and it staggers before chasing again", () => {
  const { brain, ctx } = chasing();
  run(brain, 0.2, inReach());
  assert.equal(brain.state, "grab");
  assert.equal(ctx.calls.grabStart, 1);
  run(brain, CLIP.grab + 0.2, inReach());
  assert.equal(brain.g.phase, "hold");
  run(brain, 0.2, inReach({ presses: 7 }));
  assert.deepEqual(ctx.calls.grabEnd, ["free"]);
  assert.ok(ctx.calls.flags.includes("struggle"));
  const t = until(brain, (b) => b.state === "chase", inReach({ holding: false }), 10);
  assert.ok(t >= CLIP.frustrated - 0.21, `stagger ${t}`);
  assert.equal(ctx.calls.damage, 0, "the brain never damages directly during a grab");
});

test("grab: no struggle means it throws you; the second catch is a bite and it leaves", () => {
  const { brain, ctx } = chasing();
  run(brain, 0.2, inReach());
  until(brain, () => ctx.calls.grabEnd.length > 0, inReach(), 10);
  assert.deepEqual(ctx.calls.grabEnd, ["throw"]);
  until(brain, (b) => b.state === "chase", inReach({ holding: false }), 5);
  assert.equal(brain.state, "chase");
  // grab cooldown: no instant re-grab
  run(brain, 1, inReach({ holding: false }));
  assert.equal(ctx.calls.grabStart, 1);
  until(brain, (b) => b.state === "grab", inReach(), 10);
  until(brain, () => ctx.calls.grabEnd.length > 1, inReach(), 10);
  assert.deepEqual(ctx.calls.grabEnd, ["throw", "bite"]);
  until(brain, (b) => b.state === "retreat", inReach({ holding: false }), 5);
  assert.equal(brain.outcome, "caught");
});

test("grab refused by the world (no room, already held) falls back to the chase without a release", () => {
  const { brain, ctx } = chasing({ grabOk: false });
  run(brain, 1.0, inReach());
  assert.equal(brain.state, "chase");
  assert.equal(ctx.calls.grabStart, 1, "cooldown prevents retry spam");
  assert.equal(ctx.calls.grabEnd.length, 0);
});

test("a victim lost mid-hold ends the encounter cleanly", () => {
  const { brain, ctx } = chasing();
  run(brain, 0.2, inReach());
  run(brain, 0.8, inReach());
  run(brain, 0.2, inReach({ holding: false }));
  assert.equal(brain.state, "retreat");
  assert.deepEqual(ctx.calls.grabEnd, ["lost"]);
});

test("no room to lift: plain strikes, which land once and only with reach, sight and facing", () => {
  const { brain, ctx } = chasing();
  const s = snap({ target: { dist: 2, hdist: 2 }, reach: { holdClear: false } });
  run(brain, CLIP.strike + 0.4, s);
  assert.equal(ctx.calls.damage, 1);
  assert.equal(ctx.calls.grabStart, 0);
  const b2 = chasing();
  run(b2.brain, 3, snap({ target: { dist: 2, hdist: 2 }, reach: { holdClear: false, los: false } }));
  assert.equal(b2.ctx.calls.damage, 0, "never through walls");
});

test("escape: out of sight with distance -> search -> enraged howl -> retreat -> gone", () => {
  const { brain, ctx } = chasing();
  const lost = snap({ target: { dist: 20, hdist: 20, canSee: false, watching: false, inView: false }, anyLos: false });
  run(brain, CHASE.escapeNoSight + 0.4, lost);
  assert.equal(brain.state, "search");
  until(brain, (b) => b.state === "retreat", lost, 30);
  assert.equal(brain.outcome, "escaped");
  assert.ok(ctx.calls.cue.includes("frustrated"));
  until(brain, (b) => b.done, lost, 20);
  assert.deepEqual(ctx.calls.despawn, ["escaped"]);
});

test("hiding: a crouched player in the dark is only found when it almost touches them", () => {
  const { brain } = chasing();
  run(brain, 0.2, snap({ target: { dist: 12, hdist: 12 } }));
  brain.enter("search", "test");
  run(brain, 2, snap({ target: { dist: 6, hdist: 6, canSee: true, hidden: true } }));
  assert.equal(brain.state, "search", "not found at 6 blocks");
  run(brain, 0.2, snap({ target: { dist: SEARCH.hiddenDetect - 0.3, hdist: 2.5, canSee: true, hidden: true } }));
  assert.equal(brain.state, "chase");
});

test("noise pulls the search toward it", () => {
  const { brain } = chasing();
  brain.enter("search", "test");
  run(brain, 0.2, snap({ target: { canSee: false, dist: 12, noise: { pos: { x: 30, y: 0, z: 4 }, t: brain.t + 0.2 } } }));
  assert.deepEqual(brain.se.points[brain.se.idx], { x: 30, y: 0, z: 4 });
});

test("stalking: freezes into a pose when watched, moves when not, a held stare starts the stand-off", () => {
  const { brain, ctx } = makeBrain("statue_hunt", { veteran: true });
  run(brain, 2, unseenAt(20));
  assert.ok(ctx.calls.moveTo.includes("stalk"));
  const moves = ctx.calls.moveTo.length;
  run(brain, 1, watchedAt(20));
  assert.equal(ctx.calls.moveTo.length, moves, "no movement while watched");
  assert.ok(ctx.calls.visuals.slice(-1)[0].pose.startsWith("statue_"));
  run(brain, STALK.standoffStare, watchedAt(20));
  assert.equal(brain.state, "standoff");
});

test("stalking: staying hidden makes it lose track of you", () => {
  const { brain, ctx } = makeBrain("statue_hunt", { veteran: true });
  run(brain, STALK.hiddenLoseTrack + 0.4, snap({ target: { dist: 18, hidden: true, canSee: false } }));
  assert.equal(brain.state, "retreat");
  assert.equal(brain.outcome, "hidden");
  assert.ok(ctx.calls.flags.includes("hid"));
});

test("the hunter screams from far away and comes running", () => {
  const { brain, ctx } = makeBrain("the_hunter", { veteran: true });
  assert.equal(brain.state, "scream");
  assert.ok(ctx.calls.cue.includes("scream_far"));
  until(brain, (b) => b.state === "chase", unseenAt(30), 10);
  assert.equal(brain.state, "chase");
});

test("mirror: a crouch it sees in the stand-off is copied 1-2 s later on the locomotion pose", () => {
  let found = false;
  for (let seed = 1; seed < 30 && !found; seed++) {
    const { brain, ctx } = standoff({ seed });
    const crouch = snap({ target: { dist: 12, hdist: 12, sneaking: true, watching: true } });
    run(brain, 4, crouch);
    const v = ctx.calls.visuals.find((x) => x.mimic === "crouch");
    if (!v) continue;
    found = true;
    assert.equal(v.pose, "loco", "imitation shows on the locomotion pose");
    const idx = ctx.calls.visuals.indexOf(v);
    const t = (idx + 1) * 0.2;
    assert.ok(t >= 0.9 && t <= 2.2, `copied ${t.toFixed(1)} s after the crouch began`);
  }
  assert.ok(found, "some seed copies the crouch");
});

test("death during a grab drops the victim", () => {
  const { brain, ctx } = chasing();
  run(brain, 0.2, inReach());
  brain.die();
  assert.deepEqual(ctx.calls.grabEnd, ["abort"]);
  until(brain, (b) => b.done, inReach({ holding: false }), 5);
  assert.deepEqual(ctx.calls.despawn, ["killed"]);
});

test("target loss always leads to a clean withdrawal; a disconnect is not a kill", () => {
  const a = chasing();
  run(a.brain, 0.4, snap({ target: { valid: false } }));
  assert.equal(a.brain.state, "retreat");
  assert.equal(a.brain.outcome, "escaped");
  const b = chasing();
  run(b.brain, 0.4, snap({ target: { alive: false } }));
  assert.equal(b.brain.outcome, "caught");
});

test("fuzz: every state has a ceiling, visuals use real ids, every grab is released", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = makeRng(seed * 7919);
    const setups = ["statue_hunt", "corner_peek", "tunnel_crawler", "distant_watcher", "the_rehearsal", "cavern_reveal", "behind_you", "the_hunter"];
    const { brain, ctx } = makeBrain(r.pick(setups), { seed, veteran: r.chance(0.7), grabOk: r.chance(0.8) });
    let holding = false;
    for (let i = 0; i < 1500 && !brain.done; i++) {
      if (brain.state === "grab" && brain.g && brain.g.holding) holding = r.chance(0.97);
      else holding = brain.state === "grab";
      const d = r.range(1.5, 40);
      const watching = r.chance(0.4);
      const s = snap({
        target: {
          dist: d, hdist: d, watching, inView: watching || r.chance(0.2), canSee: r.chance(0.7), hidden: r.chance(0.1),
          sneaking: r.chance(0.1), sprinting: r.chance(0.1), closing: r.range(-2, 2), valid: r.chance(0.995), alive: r.chance(0.998),
        },
        reach: { holdClear: r.chance(0.7), los: r.chance(0.8) },
        grab: { holding, presses: r.int(0, 9), needed: 7 },
      });
      if (r.chance(0.01)) brain.onHit(r.chance(0.5), 4);
      brain.update(s, 0.2);
      assert.ok(STATES.includes(brain.state));
      assert.ok(brain.stateT <= MAX_STATE_TIME[brain.state] + 0.21, `${brain.state} overstayed (${brain.stateT})`);
    }
    for (const v of ctx.calls.visuals) {
      assert.ok(v.pose in POSE, `pose ${v.pose}`);
      assert.ok(v.tail in TAIL, `tail ${v.tail}`);
      assert.ok(v.breath in BREATH, `breath ${v.breath}`);
      if (v.tail === "rigid") assert.ok(["unfold", "scream", "windup", "grab", "frustrated"].includes(v.state), `rigid tail in ${v.state}`);
    }
    const started = ctx.grabOk ? ctx.calls.grabStart : 0;
    const open = brain.state === "grab" && brain.g && !brain.g.released ? 1 : 0;
    assert.equal(ctx.calls.grabEnd.length + open, started, `seed ${seed}: grabs ${started}, releases ${ctx.calls.grabEnd.join(",")}`);
  }
});
