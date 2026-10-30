import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyMemory, parseMemory, serializeMemory, recordGesture, recordReaction, endEncounter,
  rememberedGesture, setupWeights, stalkFactor, retreatFactor,
} from "../packs/TailwailBP/scripts/core/memory.js";
import { emptySchedule, ensureGrace, onPlayerDeath, onEncounterEnd, eligibility, parseSchedule } from "../packs/TailwailBP/scripts/core/scheduler.js";
import { SETUP_IDS, pickSetup } from "../packs/TailwailBP/scripts/core/setups.js";
import { MEMORY, WORLD_DEFAULTS } from "../packs/TailwailBP/scripts/config.js";
import { makeRng } from "../packs/TailwailBP/scripts/util/rng.js";

test("memory stays bounded and decays across a thousand encounters", () => {
  const m = emptyMemory();
  const rng = makeRng(5);
  for (let i = 0; i < 1000; i++) {
    for (let k = 0; k < 5; k++) recordGesture(m, rng.pick(["crouch", "tilt", "step"]), rng.range(-60, 60));
    recordReaction(m, rng.pick(["approach", "flee", "attack", "hide", "stare"]), 0.5);
    endEncounter(m, rng.pick(SETUP_IDS), rng.pick(["observed", "calm", "escaped", "caught"]), rng.range(1, 90));
  }
  const s = serializeMemory(m);
  assert.ok(s.length <= MEMORY.maxBytes, `serialized ${s.length} bytes`);
  assert.ok(m.enc <= MEMORY.countCap && m.gest.crouch.n <= MEMORY.countCap);
  assert.ok(m.recent.length <= MEMORY.recentSetups);
  assert.ok(Object.values(m.gest).every((g) => g.w >= 0 && g.w <= 1 && Math.abs(g.p) <= 45));
  const w0 = m.gest.crouch.w;
  endEncounter(m, "corner_peek", "calm", 10);
  assert.ok(m.gest.crouch.w <= w0 * MEMORY.decay + 1e-9, "weights decay every encounter");
});

test("memory parse is versioned and defensive", () => {
  assert.deepEqual(parseMemory("not json"), emptyMemory());
  assert.deepEqual(parseMemory(JSON.stringify({ v: 999, enc: 5 })), emptyMemory());
  const m = parseMemory(JSON.stringify({ v: 1, enc: 1e9, gest: { crouch: { n: -4, w: 7, p: 400 } }, recent: [1, "x", "y"] }));
  assert.equal(m.enc, MEMORY.countCap);
  assert.deepEqual(m.gest.crouch, { n: 0, w: 1, p: 45 });
  assert.deepEqual(m.recent, ["x", "y"]);
});

test("remembered gesture requires repeated observation; influence factors are bounded", () => {
  const m = emptyMemory();
  recordGesture(m, "tilt", -30);
  assert.equal(rememberedGesture(m, 2), null);
  recordGesture(m, "tilt", -30);
  assert.equal(rememberedGesture(m, 2).type, "tilt");
  for (const notice of [0.1, 5, 500]) {
    const mm = emptyMemory();
    mm.noticeAvg = notice;
    const f = stalkFactor(mm);
    assert.ok(f >= 0.8 && f <= 1.2);
  }
  const r = emptyMemory();
  r.react.approach = 1;
  r.react.attack = 1;
  assert.ok(retreatFactor(r) <= 1.4);
});

test("setups never repeat back-to-back and respect terrain", () => {
  const m = emptyMemory();
  const rng = makeRng(9);
  let last = null;
  for (let i = 0; i < 200; i++) {
    const s = pickSetup(setupWeights(m, SETUP_IDS), { headroom: 8 }, rng);
    assert.notEqual(s, last, "back-to-back repeat");
    endEncounter(m, s, "observed", 5);
    last = s;
  }
  assert.equal(pickSetup([["full_height_reveal", 1]], { headroom: 3 }, rng), null, "cavern-only setup rejected in a low cave");
  assert.equal(pickSetup([["low_tunnel_observation", 1]], { headroom: 6 }, rng), null, "tunnel setup needs a low passage");
});

test("scheduler: grace, post-death protection, randomized cooldown within bounds", () => {
  const S = { ...WORLD_DEFAULTS };
  const s = ensureGrace(emptySchedule(), 1000, S);
  assert.equal(s.nextAt, 1000 + S.graceSeconds * 20);
  onPlayerDeath(s, 2000, S);
  assert.ok(s.nextAt >= 2000 + S.postDeathSeconds * 20);
  const rng = makeRng(3);
  for (let i = 0; i < 200; i++) {
    const t = emptySchedule();
    onEncounterEnd(t, 0, "calm", S, rng);
    const sec = t.nextAt / 20;
    assert.ok(sec >= S.cooldownMin * 0.99 && sec <= S.cooldownMax * 1.2 * 1.6 * 1.01, `cooldown ${sec}`);
  }
  assert.equal(parseSchedule("{bad").nextAt, -1);
});

test("scheduler: eligibility rejects every unsuitable condition with a reason", () => {
  const S = { ...WORLD_DEFAULTS };
  const ok = { survivalLike: true, dimension: "minecraft:overworld", alive: true, health: 20, sinceHurt: 99, inWater: false,
    riding: false, sleeping: false, flying: false, underground: true, nightWoodland: false };
  const sch = { ...emptySchedule(), nextAt: 0 };
  const W = { peaceful: false, activeNear: false, activeCount: 0 };
  assert.equal(eligibility(ok, sch, 100, S, W).ok, true);
  const cases = [
    [{ ...ok }, sch, { ...W, peaceful: true }, "peaceful"],
    [{ ...ok, survivalLike: false }, sch, W, "gamemode"],
    [{ ...ok, dimension: "minecraft:nether" }, sch, W, "dimension"],
    [ok, { ...sch, nextAt: 1e9 }, W, "cooldown"],
    [{ ...ok, health: 4 }, sch, W, "low-health"],
    [{ ...ok, sinceHurt: 2 }, sch, W, "in-combat"],
    [{ ...ok, underground: false }, sch, W, "terrain"],
    [ok, sch, { ...W, activeNear: true }, "encounter-nearby"],
    [ok, sch, { ...W, activeCount: 2 }, "global-cap"],
  ];
  for (const [p, s, w, reason] of cases) assert.equal(eligibility(p, s, 100, S, w).reason, reason);
  assert.equal(eligibility(ok, sch, 100, { ...S, enabled: false }, W).reason, "disabled");
});
