import test from "node:test";
import assert from "node:assert/strict";
import { SIGNS, WORLD_DEFAULTS, WORLD_LIMITS } from "../packs/TailwailBP/scripts/config.js";
import {
  clawDue, createClawPace, neatSlots, nestLayout, nextTally, pickDisturbance, pushMark, shufflePairs, talliesOwed,
} from "../packs/TailwailBP/scripts/core/signs_rules.js";
import { JOURNAL, unlock } from "../packs/TailwailBP/scripts/core/journal.js";
import { makeRng } from "../packs/TailwailBP/scripts/util/rng.js";

test("only one Tailwail in the world: the cap is fixed at 1", () => {
  assert.equal(WORLD_DEFAULTS.maxConcurrent, 1);
  assert.deepEqual(WORLD_LIMITS.maxConcurrent, [1, 1]);
  assert.equal(WORLD_DEFAULTS.signs, true);
});

test("claw marks: only underground, every few blocks, capped per encounter", () => {
  const rng = makeRng(3);
  const above = createClawPace();
  for (let i = 0; i < 200; i++) assert.equal(clawDue(above, 1, false, rng), false, "never on the surface");
  const pace = createClawPace();
  let n = 0;
  let first = -1;
  for (let i = 0; i < 400; i++) {
    if (clawDue(pace, 1, true, rng)) {
      n++;
      if (first < 0) first = i;
    }
  }
  assert.ok(first + 1 >= SIGNS.clawEvery, "not before it has moved a few blocks");
  assert.equal(n, SIGNS.clawPerEncounter, "capped per encounter");
});

test("claw marks: the world keeps the newest ones and scrubs the oldest", () => {
  const list = [];
  let gone = [];
  for (let i = 0; i < SIGNS.clawMax + 5; i++) gone = gone.concat(pushMark(list, [0, i, 0, 0]));
  assert.equal(list.length, SIGNS.clawMax);
  assert.deepEqual(gone.map((g) => g[1]), [0, 1, 2, 3, 4]);
  assert.equal(list[0][1], 5);
});

test("tallies: one stroke per escape, in groups of five", () => {
  assert.equal(talliesOwed(3, 1), 2);
  assert.equal(talliesOwed(1, 4), 0, "never negative");
  let cur = null;
  const seq = [];
  for (let i = 0; i < 7; i++) {
    const nx = nextTally(cur);
    seq.push(nx.fresh ? "new" + nx.n : String(nx.n));
    cur = { n: nx.n };
  }
  assert.deepEqual(seq, ["new1", "2", "3", "4", "5", "new1", "2"]);
});

test("disturbances: only what is there, never the same thing twice running when there is a choice", () => {
  const rng = makeRng(9);
  assert.equal(pickDisturbance({}, rng), null);
  assert.equal(pickDisturbance({ bed: true }, rng, "bed"), "bed", "the only choice stays allowed");
  const seen = new Set();
  for (let i = 0; i < 300; i++) {
    const k = pickDisturbance({ torch: true, barrel: true, chest: true, bed: true }, rng, "torch");
    assert.notEqual(k, "torch");
    seen.add(k);
  }
  assert.deepEqual([...seen].sort(), ["barrel", "bed", "chest"]);
  const pairs = shufflePairs(27, [0, 5, 9], rng, 5);
  assert.equal(pairs.length, 5);
  for (const [a, b] of pairs) {
    assert.ok([0, 5, 9].includes(a));
    assert.ok(b >= 0 && b < 27 && b !== a);
  }
});

test("its nest: what it took from you is laid out neatly in the chest", () => {
  assert.deepEqual(neatSlots(1), [13]);
  assert.deepEqual(neatSlots(3), [11, 13, 15]);
  assert.deepEqual(neatSlots(3, new Set([13])), [2, 4, 6], "middle row taken: the top row");
  assert.deepEqual(neatSlots(7), [9, 11, 13, 15, 17, 3, 5]);
});

test("its nest: a chest, burnt torches in a row, bones, matted hair, webs and claw marks, only on open cells", () => {
  for (let seed = 1; seed <= 25; seed++) {
    const rng = makeRng(seed);
    const cells = [];
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const edge = Math.max(Math.abs(dx), Math.abs(dz)) === 3;
        const walls = [];
        if (dx === -3) walls.push("west");
        if (dx === 3) walls.push("east");
        if (dz === -3) walls.push("north");
        if (dz === 3) walls.push("south");
        cells.push({ dx, dz, floor: !edge || rng.chance(0.5), walls });
      }
    }
    const plan = nestLayout(cells, rng);
    const kinds = plan.map((p) => p.what);
    assert.equal(kinds.filter((k) => k === "chest").length, 1, `seed ${seed}: one chest`);
    const sticks = plan.filter((p) => p.what === "stick");
    assert.ok(sticks.length >= 3, `seed ${seed}: a row of burnt torches`);
    const sameX = sticks.every((s) => s.dx === sticks[0].dx);
    const sameZ = sticks.every((s) => s.dz === sticks[0].dz);
    assert.ok(sameX || sameZ, "in a straight line");
    assert.ok(kinds.includes("bone") && kinds.includes("skull"));
    assert.ok(kinds.some((k) => k.startsWith("carpet_")));
    assert.ok(kinds.includes("cobweb") && kinds.includes("claw"));
    const ground = new Set();
    for (const p of plan) {
      const c = cells.find((q) => q.dx === p.dx && q.dz === p.dz);
      if (p.dy === 0) {
        assert.ok(c.floor, `seed ${seed}: ${p.what} on a closed cell`);
        const k = p.dx + "," + p.dz;
        assert.ok(!ground.has(k), `seed ${seed}: two things on one cell`);
        ground.add(k);
      }
      if (p.what === "claw") assert.ok(c.walls.includes(p.facing), "claw marks face a real wall");
    }
  }
});

test("journal: four new pages for the signs, and the bit layout still fits", () => {
  for (const f of ["claws", "tally", "moved", "nest"]) {
    const r = unlock(0, f);
    assert.ok(r.added, f);
  }
  assert.ok(JOURNAL.length <= 31);
});
