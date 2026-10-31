import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyMemory, parseMemory, serializeMemory, recordGesture, recordReaction, endEncounter,
  rememberedGesture, setupWeights, stalkFactor, retreatFactor,
} from "../packs/TailwailBP/scripts/core/memory.js";
import {
  emptySchedule, ensureFirst, tickEligible, onPlayerDeath, onEncounterEnd, eligibility, encounterBlockers, parseSchedule,
  serializeSchedule, computeStage, onPresence, nextPresenceDelay,
} from "../packs/TailwailBP/scripts/core/scheduler.js";
import { SETUPS, SETUP_IDS, fitsTerrain, pickSetup, setupsForStage } from "../packs/TailwailBP/scripts/core/setups.js";
import { PRESENCE_EVENTS, PRESENCE_IDS, mimicSoundFor, pickPresence } from "../packs/TailwailBP/scripts/core/presence_rules.js";
import { JOURNAL, journalBit, unlock } from "../packs/TailwailBP/scripts/core/journal.js";
import { MEMORY, STAGE, WORLD_DEFAULTS } from "../packs/TailwailBP/scripts/config.js";
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

test("setups never repeat back-to-back, respect terrain and unlock with escalation", () => {
  const m = emptyMemory();
  const rng = makeRng(9);
  let last = null;
  for (let i = 0; i < 200; i++) {
    const s = pickSetup(setupWeights(m, setupsForStage(3)), { headroom: 8 }, rng);
    assert.notEqual(s, last, "back-to-back repeat");
    endEncounter(m, s, "observed", 5);
    last = s;
  }
  assert.equal(pickSetup([["the_rehearsal", 1]], { headroom: 3 }, rng), null, "a tall setup is rejected in a low cave");
  assert.equal(pickSetup([["tunnel_crawler", 1]], { headroom: 6 }, rng), null, "tunnel setup needs a low passage");
  assert.ok(!setupsForStage(0).includes("behind_you") && !setupsForStage(0).includes("the_hunter"));
  assert.ok(!setupsForStage(0).includes("ceiling") && setupsForStage(1).includes("ceiling"));
  assert.ok(setupsForStage(2).includes("behind_you") && setupsForStage(2).includes("the_hunter"));
  // caves and the night surface have their own openings; nobody can roll the internal return
  const cave = setupsForStage(3, "cave");
  const surface = setupsForStage(3, "surface");
  assert.ok(cave.includes("ceiling") && !cave.includes("treeline"));
  assert.ok(surface.includes("treeline") && surface.includes("runner") && !surface.includes("ceiling") && !surface.includes("huddle"));
  assert.ok(!cave.includes("the_return") && !surface.includes("the_return"));
  for (const id of SETUP_IDS) assert.ok(fitsTerrain(id, SETUPS[id].needsHeadroom), id);
});

test("scheduler: first encounter and presence armed once; waits only count eligible time; death protection", () => {
  const S = { ...WORLD_DEFAULTS };
  const rng = makeRng(4);
  const s = ensureFirst(emptySchedule(), S, rng);
  assert.ok(s.wait >= S.firstMin && s.wait <= S.firstMax);
  assert.ok(s.presWait > 0 && s.presWait < 60, "the first presence comes early");
  const w = s.wait;
  ensureFirst(s, S, rng);
  assert.equal(s.wait, w, "never re-armed");
  tickEligible(s, 10);
  assert.equal(s.wait, w - 10);
  assert.equal(s.eligibleS, 10);
  onPlayerDeath(s, S);
  assert.ok(s.wait >= S.postDeathSeconds);
  for (let i = 0; i < 200; i++) {
    const t = emptySchedule();
    onEncounterEnd(t, "calm", S, rng);
    assert.ok(t.wait >= S.cooldownMin * 0.99 && t.wait <= S.cooldownMax * 1.15 * 1.5 * 1.01, `cooldown ${t.wait}`);
  }
  assert.equal(parseSchedule("{bad").wait, -1);
  const round = parseSchedule(serializeSchedule({ ...emptySchedule(), stage: 9, jr: 5, pres: { glimpse: 3, ["x".repeat(40)]: 1 } }));
  assert.equal(round.stage, 3, "clamped");
  assert.equal(round.jr, 5);
  assert.deepEqual(round.pres, { glimpse: 3 });
});

test("escalation: unease -> watched -> hunted -> obsessed, never back down", () => {
  const S = { ...WORLD_DEFAULTS };
  const rng = makeRng(2);
  const s = emptySchedule();
  assert.equal(computeStage(s), 0);
  for (let i = 0; i < STAGE.watchedAfterPresence; i++) onPresence(s, "mimic", S, rng);
  assert.equal(s.stage, 1);
  onEncounterEnd(s, "observed", S, rng);
  assert.equal(s.stage, 2);
  for (let i = 0; i < 3; i++) onEncounterEnd(s, "calm", S, rng);
  assert.equal(s.stage, 3);
  s.encN = 0;
  s.escN = 0;
  assert.equal(computeStage(s), 3, "stages never go down");
  const a = emptySchedule();
  onEncounterEnd(a, "aborted", S, rng);
  assert.equal(a.encN, 0, "an aborted encounter does not count");
});

test("presence: stage gating, cooldowns, needs, settings and no back-to-back repeats", () => {
  const S = { ...WORLD_DEFAULTS };
  const rng = makeRng(11);
  const allEnv = { wall: true, torch: true, torches: true, door: true, window: true };
  for (let i = 0; i < 300; i++) {
    const id = pickPresence(0, 1000, {}, allEnv, S, rng);
    assert.equal(PRESENCE_EVENTS[id].stage, 0, id);
  }
  const seen = new Set();
  for (let i = 0; i < 2000; i++) seen.add(pickPresence(3, 5000, {}, allEnv, S, rng));
  for (const id of PRESENCE_IDS) assert.ok(seen.has(id), `stage 3 can reach ${id}`);
  // cooldown
  const last = { footsteps: 990, mimic: 990, knock: 990, scrape: 990 };
  assert.equal(pickPresence(0, 1000, last, allEnv, S, rng), null, "everything on cooldown");
  // needs + settings
  for (let i = 0; i < 300; i++) {
    const id = pickPresence(3, 5000, {}, { wall: true }, { ...S, jumpscares: false }, rng);
    assert.ok(!["snuff", "lights_out", "door", "door_bang", "window", "behind"].includes(id), id);
  }
  for (let i = 0; i < 100; i++) assert.notEqual(pickPresence(0, 1000, {}, allEnv, S, rng, "mimic"), "mimic");
  // pacing scales with the presence level
  const avg = (lvl) => {
    let t = 0;
    for (let i = 0; i < 500; i++) t += nextPresenceDelay(1, { ...S, presence: lvl }, rng);
    return t / 500;
  };
  assert.ok(avg(3) < avg(2) && avg(2) < avg(1));
});

test("presence: mimicry maps actions to real vanilla sounds", () => {
  assert.deepEqual(mimicSoundFor("break", "minecraft:deepslate"), { sound: "dig.deepslate", pitch: 0.8 });
  assert.equal(mimicSoundFor("break", "minecraft:oak_log").sound, "dig.wood");
  assert.equal(mimicSoundFor("place", "minecraft:gravel").sound, "use.gravel");
  assert.equal(mimicSoundFor("step", "minecraft:grass_block").sound, "step.grass");
  assert.equal(mimicSoundFor("chest").sound, "random.chestopen");
  assert.equal(mimicSoundFor("hurt").sound, "game.player.hurt");
  assert.equal(mimicSoundFor("nonsense"), null);
});

test("journal: each page unlocks once, from its flag", () => {
  let mask = 0;
  const first = unlock(mask, "standoff");
  assert.ok(first.added && first.added.title);
  mask = first.mask;
  assert.equal(unlock(mask, "standoff").added, null);
  assert.equal(unlock(mask, "not-a-flag").added, null);
  assert.equal(JOURNAL.length <= 30, true, "fits the bitmask");
  // pages are only ever appended, so saved journals keep their bits: 3.2's four come after "killed"
  assert.equal(journalBit("killed"), 16);
  assert.equal(journalBit("nest"), JOURNAL.length - 1);
});

test("scheduler: eligibility and encounter blockers report a reason", () => {
  const S = { ...WORLD_DEFAULTS };
  const ok = { survivalLike: true, dimension: "minecraft:overworld", alive: true, health: 20, sinceHurt: 99, inWater: false,
    riding: false, sleeping: false, flying: false, underground: true, nightOutside: false };
  const W = { peaceful: false };
  assert.equal(eligibility(ok, S, W).ok, true);
  assert.equal(eligibility({ ...ok, underground: false, nightOutside: true }, S, W).kind, "night");
  const cases = [
    [{ ...ok }, { peaceful: true }, "peaceful"],
    [{ ...ok, survivalLike: false }, W, "gamemode"],
    [{ ...ok, dimension: "minecraft:nether" }, W, "dimension"],
    [{ ...ok, underground: false }, W, "terrain"],
  ];
  for (const [p, w, reason] of cases) assert.equal(eligibility(p, S, w).reason, reason);
  assert.equal(eligibility(ok, { ...S, enabled: false }, W).reason, "disabled");
  const s = { ...emptySchedule(), wait: 0 };
  const WB = { activeNear: false, activeCount: 0 };
  assert.equal(encounterBlockers(ok, s, S, WB), null);
  assert.equal(encounterBlockers(ok, { ...s, wait: 5 }, S, WB), "cooldown");
  assert.equal(encounterBlockers({ ...ok, health: 4 }, s, S, WB), "low-health");
  assert.equal(encounterBlockers({ ...ok, sinceHurt: 2 }, s, S, WB), "in-combat");
  assert.equal(encounterBlockers({ ...ok, sleeping: true }, s, S, WB), "busy");
  assert.equal(encounterBlockers(ok, s, S, { ...WB, activeNear: true }), "encounter-nearby");
  assert.equal(encounterBlockers(ok, s, S, { ...WB, activeCount: S.maxConcurrent }), "global-cap");
});
