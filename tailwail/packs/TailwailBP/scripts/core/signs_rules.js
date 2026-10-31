// What it leaves behind (3.2): claw marks where it has been, a tally near your bed for every
// time you got away, your things moved while you were out, and its nest.  Pure: no Minecraft
// imports; mc/signs.js measures the world and places the blocks.
import { SIGNS } from "../config.js";

export const DIRS = Object.freeze({
  north: Object.freeze({ x: 0, z: -1 }),
  south: Object.freeze({ x: 0, z: 1 }),
  east: Object.freeze({ x: 1, z: 0 }),
  west: Object.freeze({ x: -1, z: 0 }),
});

/** Per-encounter claw-mark pacing: {since, placed}. */
export function createClawPace() {
  return { since: 0, placed: 0 };
}

/**
 * Called as it moves.  True when it should gouge the rock here: only underground, every few
 * blocks of travel (with a chance), and only so many times per encounter.
 */
export function clawDue(pace, moved, underground, rng) {
  if (!underground) {
    pace.since = 0;
    return false;
  }
  pace.since += Math.max(0, moved);
  if (pace.placed >= SIGNS.clawPerEncounter || pace.since < SIGNS.clawEvery) return false;
  pace.since = 0;
  if (!rng.chance(SIGNS.clawChance)) return false;
  pace.placed += 1;
  return true;
}

/** The world remembers the newest marks only: returns the entries that fell off the end. */
export function pushMark(list, entry, max = SIGNS.clawMax) {
  list.push(entry);
  return list.length > max ? list.splice(0, list.length - max) : [];
}

/** Strokes still owed: one per escape. */
export function talliesOwed(escapes, carved) {
  return Math.max(0, (escapes | 0) - (carved | 0));
}

/** The next stroke: a fifth stroke closes a group, the sixth starts a new block beside it. */
export function nextTally(current) {
  if (!current || current.n >= 5) return { fresh: true, n: 1 };
  return { fresh: false, n: current.n + 1 };
}

/** Which of your things it disturbs.  avail: {torch, barrel, chest, bed}. */
export function pickDisturbance(avail, rng, last = null) {
  const w = [["torch", 3], ["chest", 2], ["barrel", 2], ["bed", 1]].filter(([k]) => avail[k]);
  if (!w.length) return null;
  const fresh = w.filter(([k]) => k !== last);
  return rng.weighted(fresh.length ? fresh : w);
}

/** Pairs of slots to swap so a chest's contents come back subtly wrong. */
export function shufflePairs(size, filled, rng, n = 4) {
  const out = [];
  if (!filled.length || size < 2) return out;
  for (let i = 0; i < n; i++) {
    const a = rng.pick(filled);
    let b = rng.int(0, size - 1);
    if (b === a) b = (a + 1 + rng.int(0, size - 2)) % size;
    out.push([a, b]);
  }
  return out;
}

/**
 * Where items go in a 27-slot chest so they look laid out on purpose: centred in the middle
 * row, evenly spaced, then the top row, then the bottom row.
 */
export function neatSlots(n, taken = new Set()) {
  const patterns = { 1: [4], 2: [3, 5], 3: [2, 4, 6], 4: [1, 3, 5, 7], 5: [0, 2, 4, 6, 8] };
  const out = [];
  for (const row of [9, 0, 18]) {
    const want = Math.min(5, n - out.length);
    if (want <= 0) break;
    const slots = patterns[want].map((c) => row + c);
    if (slots.every((s) => !taken.has(s))) out.push(...slots);
  }
  return out.slice(0, n);
}

/**
 * The nest.  cells: [{dx, dz, floor, walls}] around the centre (radius 3), where floor means
 * air at the floor level and above it with solid ground under it, and walls lists the
 * directions of solid blocks beside the cell one block up.  Returns placements
 * [{dx, dy, dz, what, facing?}] with what in: chest, stick, bone, skull, carpet_black,
 * carpet_brown, cobweb, claw.  Only cells reported as open are ever used.
 */
export function nestLayout(cells, rng) {
  const at = new Map(cells.map((c) => [c.dx + "," + c.dz, c]));
  const ring = (c) => Math.max(Math.abs(c.dx), Math.abs(c.dz));
  const floor = cells.filter((c) => c.floor);
  const used = new Set();
  const key = (c) => c.dx + "," + c.dz;
  const out = [];
  const take = (c, what, extra = {}) => {
    used.add(key(c));
    out.push({ dx: c.dx, dy: 0, dz: c.dz, what, ...extra });
  };
  // the chest: at the edge, against a wall if it can
  const edge = floor.filter((c) => ring(c) === 2);
  const chestAt = edge.find((c) => c.walls.length) || edge[0];
  if (chestAt) take(chestAt, "chest");
  // burnt-out torches it collected, lined up neatly in a row
  let row = null;
  for (const c of rng.shuffle(floor.filter((f) => ring(f) <= 2 && !used.has(key(f))))) {
    for (const [sx, sz] of [[1, 0], [0, 1]]) {
      const line = [];
      for (let i = 0; i < 4; i++) {
        const n = at.get(c.dx + sx * i + "," + (c.dz + sz * i));
        if (!n || !n.floor || used.has(key(n)) || ring(n) > 2) break;
        line.push(n);
      }
      if (line.length >= 3 && (!row || line.length > row.length)) row = line;
    }
    if (row && row.length >= 4) break;
  }
  if (row) for (const c of row) take(c, "stick");
  // bones: three blocks around the rim, one of them heaped two high
  const rim = rng.shuffle(floor.filter((c) => ring(c) >= 2 && !used.has(key(c))));
  rim.slice(0, 3).forEach((c, i) => {
    take(c, "bone");
    if (i === 0) out.push({ dx: c.dx, dy: 1, dz: c.dz, what: "bone" });
  });
  // a skull or two
  const inner = rng.shuffle(floor.filter((c) => ring(c) <= 2 && !used.has(key(c))));
  inner.slice(0, rng.int(1, 2)).forEach((c) => take(c, "skull"));
  // matted hair over the rest of the floor
  for (const c of floor) {
    if (used.has(key(c)) || ring(c) > 2) continue;
    const r = rng.next();
    if (r < 0.5) take(c, "carpet_black");
    else if (r < 0.8) take(c, "carpet_brown");
  }
  // cobwebs in the corners, claw marks on the walls (one block up)
  const walled = rng.shuffle(cells.filter((c) => c.walls.length && ring(c) >= 1));
  walled.slice(0, 2).forEach((c) => out.push({ dx: c.dx, dy: 1, dz: c.dz, what: "cobweb" }));
  walled.slice(2, 2 + SIGNS.nestClaws).forEach((c) => out.push({ dx: c.dx, dy: 1, dz: c.dz, what: "claw", facing: rng.pick(c.walls) }));
  return out;
}
