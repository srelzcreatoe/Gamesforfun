// @ts-check
// The Rift's realm (1.6.0; twice the size since 1.7.0): the dead woods and what stands in them, laid out in the rift
// dimension from the pieces tools/rift_world.py draws (structures/rift/*.mcstructure, 48 x 52 x 48 each, every cell
// written, air included).
//
// Seven by seven pieces, 336 x 336 blocks round the centre: the landing in the middle (where a rift sets you down, and
// where the way out opens); in the five by five round it the church, the castle, the observatory, the Garden of Eyes,
// the barrow field, two hamlets, the watchtower and a camp, and the dead woods in the rest; and the woods ending at a
// crumbling edge over the void all the way round the outside. Each time a rift opens and nobody is in there, the realm
// is laid out again, shuffled: every place somewhere else, the woods turned another way, every chest full again,
// whatever was built or broken there gone.
import { world, system, StructureRotation } from "@minecraft/server";
import { rift, RIFT_ID } from "./dimension.js";
import { safe, emit, trace, allPlayers, randInt, shuffle, pick } from "../core/util.js";

export const CELL = 48;
export const GRID = 7;
const MID = (GRID - 1) / 2;
/** The world corner of the grid (chunk-aligned) and its bottom. */
export const ORIGIN = { x: -176, y: 48, z: -176 };
export const SPAN = CELL * GRID;
/** The ground's height. */
export const GROUND = 64;
/** Where the way out opens: the landing's middle. */
export const EXIT = { x: ORIGIN.x + MID * CELL + 24, y: GROUND + 1, z: ORIGIN.z + MID * CELL + 24 };
/** Where you come in: a few steps south of it, facing away. */
export const ARRIVE = { x: EXIT.x + 0.5, y: GROUND + 1, z: EXIT.z + 6.5 };

const KEY = "observer:rift_realm";

const WOODS = ["rift:woods_1", "rift:woods_2", "rift:woods_3", "rift:woods_4", "rift:woods_5", "rift:woods_6"];
/** The places in the woods, one of each (the hamlet twice, a different one each time). */
export const PLACES = ["church", "castle", "observatory", "eye_garden", "graveyard", "hamlet", "hamlet", "watchtower", "camp"];
const EDGES = ["rift:edge_1", "rift:edge_2", "rift:edge_3"];
const CORNERS = ["rift:corner_1", "rift:corner_2"];
const ROT = [StructureRotation.None, StructureRotation.Rotate90, StructureRotation.Rotate180, StructureRotation.Rotate270];

/**
 * Which way to turn an edge piece (its edge drawn on its north side) so that edge faces out of the realm, and a
 * corner piece (north and west). Turning by 90 takes north to east (checked on a dedicated server: rift edge test).
 * @param {number} i @param {number} j @returns {[string, number]|undefined} [piece kind, quarter turns]
 */
function outer(i, j) {
  const last = GRID - 1;
  if (i === 0 && j === 0) return ["corner", 0];
  if (i === last && j === 0) return ["corner", 1];
  if (i === last && j === last) return ["corner", 2];
  if (i === 0 && j === last) return ["corner", 3];
  if (j === 0) return ["edge", 0];
  if (i === last) return ["edge", 1];
  if (j === last) return ["edge", 2];
  if (i === 0) return ["edge", 3];
  return undefined;
}

/**
 * @typedef {{i:number, j:number, id:string, rot:number}} Placement
 * @typedef {{gen:number, layout:Placement[], builtAt:number, church:[number,number], castle:[number,number],
 *   places?: Record<string, [number,number]>}} Realm
 */

/** A fresh shuffle of the realm. @param {number} gen @returns {Realm} */
export function layout(gen) {
  /** @type {Placement[]} */
  const out = [];
  const ring = [];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const o = outer(i, j);
      if (o) out.push({ i, j, id: pick(o[0] === "corner" ? CORNERS : EDGES), rot: o[1] });
      else if (i === MID && j === MID) out.push({ i, j, id: "rift:landing", rot: randInt(0, 3) });
      else ring.push([i, j]);
    }
  }
  // (a new order: shuffle() hands back a shuffled copy — 1.6.0 dropped it, and always had the church and castle in
  // the same two places)
  const order = shuffle(ring);
  /** @type {Record<string, [number,number]>} */
  const places = {};
  const hamlets = shuffle(["rift:hamlet_1", "rift:hamlet_2"]);
  for (const name of PLACES) {
    const c = /** @type {[number,number]} */ (order.shift());
    const id = name === "hamlet" ? /** @type {string} */ (hamlets.shift()) : `rift:${name}`;
    places[id.slice(5)] = c;
    out.push({ i: c[0], j: c[1], id, rot: randInt(0, 3) });
  }
  for (const [i, j] of order) out.push({ i, j, id: pick(WOODS), rot: randInt(0, 3) });
  return { gen, layout: out, builtAt: 0, church: places.church, castle: places.castle, places };
}

/** The realm as last laid out. @returns {Realm|undefined} */
export function current() {
  const s = world.getDynamicProperty(KEY);
  if (typeof s !== "string") return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** A cell's world corner. @param {number} i @param {number} j */
export const cellAt = (i, j) => ({ x: ORIGIN.x + i * CELL, y: ORIGIN.y, z: ORIGIN.z + j * CELL });
/** Which cell a point is in, if it is in the realm. @param {{x:number,z:number}} l */
export function cellOf(l) {
  const i = Math.floor((l.x - ORIGIN.x) / CELL), j = Math.floor((l.z - ORIGIN.z) / CELL);
  return i >= 0 && j >= 0 && i < GRID && j < GRID ? [i, j] : undefined;
}
/** Is this point inside the realm's square (with a margin)? @param {{x:number,z:number}} l */
export const within = (l, margin = 0) => l.x >= ORIGIN.x - margin && l.z >= ORIGIN.z - margin && l.x < ORIGIN.x + SPAN + margin && l.z < ORIGIN.z + SPAN + margin;
/** The middle of a place's piece (church, castle, observatory, ...), in the realm as laid out. @param {string} what */
export function where(what) {
  const r = current();
  const c = r?.places?.[what] ?? (what === "church" || what === "castle" ? r?.[what] : undefined);
  if (!c) return undefined;
  const at = cellAt(c[0], c[1]);
  return { x: at.x + CELL / 2, y: GROUND + 1, z: at.z + CELL / 2 };
}

let building = false;
/** Is it being laid out right now? */
export const isBuilding = () => building;

/**
 * @typedef {{x0:number, z0:number, x1:number, z1:number}} Rect  a strip of chunks to hold (inclusive block bounds)
 */

/**
 * Hold strips of chunks with ticking areas, as many at once as the game will take (it holds ten in a world, and a
 * player or another add-on may have some), and when each wave is in, do the work for each strip; then let them go
 * and do the next wave. Every strip must be at most 100 chunks. Resolves to [waves, ms spent waiting for chunks, starved]:
 * starved if the game would give it no ticking area at all (all ten someone else's) — then it stops, leaving the rest.
 * @param {Rect[]} rects @param {(r: Rect, i: number) => Promise<void>} work @returns {Promise<[number, number, boolean]>}
 */
async function inWaves(rects, work) {
  const d = rift();
  if (!d) return [0, 0, true];
  const name = (/** @type {number} */ i) => `observer_rift_${i}`;
  const drop = (/** @type {number} */ i) => safe(() => d.runCommand(`tickingarea remove ${name(i)}`));
  for (let i = 0; i < 10; i++) drop(i);
  let pending = rects.map((_, i) => i);
  let waves = 0, waited = 0, starved = false;
  try {
    while (pending.length) {
      waves++;
      const t1 = Date.now();
      /** @type {number[]} */
      let wave = [];
      // (areas just let go are not free again at once: the game refuses new ones for a moment — keep asking, up to 5 s)
      for (let tries = 0; tries < 50 && !wave.length; tries++) {
        if (tries) await system.waitTicks(2);
        for (const i of pending) {
          if (wave.length >= 8) break;
          const r = rects[i];
          const ok = !!safe(() => d.runCommand(`tickingarea add ${r.x0} 0 ${r.z0} ${r.x1} 0 ${r.z1} ${name(wave.length)} true`).successCount > 0, false);
          if (ok) wave.push(i);
          else break;
        }
      }
      const held = wave.length;
      // (none to be had: they are all someone else's — stop here rather than wait on chunks that will never come)
      if (!wave.length) {
        starved = true;
        trace("rift: no ticking area free (all ten in use): stopped");
        break;
      }
      // wait for every one of its chunks' corners and middles (up to 40 s)
      for (let w = 0; w < 800; w++) {
        const missing = wave.some((i) => {
          const r = rects[i];
          for (let x = r.x0 + 1; x <= r.x1; x += 47) for (let z = r.z0 + 1; z <= r.z1; z += 47) {
            if (!safe(() => d.isChunkLoaded({ x, y: GROUND, z }), false)) return true;
          }
          return !safe(() => d.isChunkLoaded({ x: r.x1 - 1, y: GROUND, z: r.z1 - 1 }), false);
        });
        if (!missing) break;
        await system.waitTicks(1);
      }
      waited += Date.now() - t1;
      trace(`rift: a wave of ${wave.length} strip(s) (${held} held) in ${Date.now() - t1} ms`);
      for (const i of wave) await work(rects[i], i);
      for (let k = 0; k < wave.length; k++) drop(k);
      pending = pending.filter((i) => !wave.includes(i));
    }
  } finally {
    for (let i = 0; i < 10; i++) drop(i);
  }
  return [waves, waited, starved];
}

/** The realm's columns of pieces, as strips: 48 x 336 (63 chunks). */
const columns = () => Array.from({ length: GRID }, (_, i) => ({ x0: ORIGIN.x + i * CELL, z0: ORIGIN.z, x1: ORIGIN.x + i * CELL + CELL - 1, z1: ORIGIN.z + SPAN - 1 }));

/**
 * The Rift's sky (1.7.1). The dimension's own sky is the game's ocean blue, and no mist colours it, so the realm is
 * shut in: a ceiling 86 blocks over the ground, a floor deep in the void and walls 96 blocks out from its edge — all of it
 * beyond the mist's 80 blocks, so all of it is the mist's dark grey, and its blocks are that grey too. It lets the light
 * through. Built once in a world (it never changes when the realm is laid out again).
 */
export const SKY = { margin: 96, top: 150, bottom: -63, version: "1" };
const SKY_KEY = "observer:rift_sky";
/** The sky's strips: 48 wide, the whole box deep (48 x 528: 99 chunks). */
function skyStrips() {
  const x0 = ORIGIN.x - SKY.margin, z0 = ORIGIN.z - SKY.margin, size = SPAN + 2 * SKY.margin;
  return Array.from({ length: Math.ceil(size / CELL) }, (_, i) => ({ x0: x0 + i * CELL, z0, x1: Math.min(x0 + size, x0 + (i + 1) * CELL) - 1, z1: z0 + size - 1 }));
}
/** Is the sky up? */
export const skyBuilt = () => world.getDynamicProperty(SKY_KEY) === SKY.version;
/** @type {Promise<boolean>|undefined} the sky going up now */
let skyJob;
/**
 * Put the sky up (the box round the realm), unless it is already; one at a time (a second call waits for the first).
 * @param {boolean} [force]
 */
export function buildSky(force = false) {
  if (!skyJob) skyJob = putSkyUp(force).finally(() => (skyJob = undefined));
  return skyJob;
}
// Put up early, well before any rift opens: half a minute after the world loads, if nobody is in there. (Putting it up
// just as someone went in left a thousand changed chunks saving while their landing was loading.)
world.afterEvents.worldLoad.subscribe(() => {
  system.runTimeout(() => {
    if (rift() && !skyBuilt() && !occupied()) buildSky();
  }, 600);
});
/** @param {boolean} force */
async function putSkyUp(force) {
  const d = rift();
  if (!d || (!force && skyBuilt())) return false;
  const t0 = Date.now();
  const strips = skyStrips();
  const lo = strips[0].z0, hi = strips[0].z1, west = strips[0].x0, east = strips[strips.length - 1].x1;
  let fills = 0, failed = 0;
  const fill = (/** @type {string} */ box) => {
    if (safe(() => d.runCommand(`fill ${box} observer:rift_sky`).successCount >= 0, false)) fills++;
    else failed++;
  };
  let fillMs = 0;
  const [waves, waited, starved] = await inWaves(strips, async (r) => {
    const tf = Date.now();
    fill(`${r.x0} ${SKY.top} ${r.z0} ${r.x1} ${SKY.top} ${r.z1}`);               // the ceiling
    fill(`${r.x0} ${SKY.bottom} ${r.z0} ${r.x1} ${SKY.bottom} ${r.z1}`);         // the floor
    fill(`${r.x0} ${SKY.bottom} ${lo} ${r.x1} ${SKY.top} ${lo}`);                // the north wall
    fill(`${r.x0} ${SKY.bottom} ${hi} ${r.x1} ${SKY.top} ${hi}`);                // the south wall
    for (const x of [west, east]) {                                             // the west and east walls, in four
      if (x < r.x0 || x > r.x1) continue;
      const q = Math.ceil((hi - lo + 1) / 4);
      for (let z = lo; z <= hi; z += q) fill(`${x} ${SKY.bottom} ${z} ${x} ${SKY.top} ${Math.min(hi, z + q - 1)}`);
    }
    fillMs += Date.now() - tf;
    await system.waitTicks(2);
  });
  if (!failed && !starved) world.setDynamicProperty(SKY_KEY, SKY.version);
  const ms = Date.now() - t0;
  trace(`rift sky: ${fills} fills (${failed} failed) in ${waves} wave(s), ${ms} ms (chunks ${waited} ms, fills ${fillMs} ms)`);
  emit("rift", { what: "sky", fills, failed, waves, ms, waited, fillMs });
  return !failed;
}

let held = false;
/** Hold the landing's chunks (where the way out stands) while anyone is in there. @param {boolean} on */
export function holdLanding(on) {
  const d = rift();
  if (!d || held === on) return;
  held = on;
  safe(() => d.runCommand("tickingarea remove observer_rift_exit"));
  if (on) safe(() => d.runCommand(`tickingarea add circle ${EXIT.x} 0 ${EXIT.z} 2 observer_rift_exit true`));
}

/**
 * Lay the realm out again (a new shuffle). Spread over ticks: one piece every other tick once its chunks are there.
 * Resolves true when every piece is down. @param {{gen?:number}} [o] @returns {Promise<boolean>}
 */
export async function build(o = {}) {
  const d = rift();
  if (!d || building) return false;
  building = true;
  const t0 = Date.now();
  const prev = current();
  const r = layout(o.gen ?? (prev?.gen ?? 0) + 1);
  try {
    // the realm's own: whatever was left lying there (or brought in) goes first
    for (const e of safe(() => d.getEntities(), []) ?? []) {
      if (e.typeId !== "minecraft:player" && within(e.location, 32)) safe(() => e.remove());
    }
    // the sky first, the once (1.7.1)
    if (!skyBuilt()) await buildSky();
    // in waves: as many columns as the game will hold areas for at once (all seven, as a rule: they come in together
    // in a moment, where one at a time took thirty times as long), laid out, let go, then the rest
    let placed = 0;
    const [waves, loadedMs, starved] = await inWaves(columns(), async (_, i) => {
      for (const pl of r.layout) {
        if (pl.i !== i) continue;
        let ok = false;
        for (let tries = 0; tries < 40 && !ok; tries++) {
          ok = !!safe(() => {
            world.structureManager.place(pl.id, d, cellAt(pl.i, pl.j), { rotation: ROT[pl.rot], includeEntities: false });
            return true;
          }, false);
          if (!ok) await system.waitTicks(5);
        }
        if (ok) placed++;
        else console.warn(`[Observer] the rift: ${pl.id} could not be laid down at ${pl.i},${pl.j}`);
        // (a piece takes ~100 ms: three ticks between them keep the server near its pace — one tick apart, 49 of them
        // pulled it down to 11 ticks a second for the few seconds of laying out)
        await system.waitTicks(3);
      }
    });
    r.builtAt = Date.now();
    // (kept only when all of it went down: a realm half laid out keeps the record of the one before)
    if (placed === r.layout.length) world.setDynamicProperty(KEY, JSON.stringify(r));
    else console.warn(`[Observer] the rift: only ${placed} of ${r.layout.length} pieces laid out${starved ? " (no ticking area free)" : ""}`);
    const ms = Date.now() - t0;
    trace(`rift realm ${r.gen} laid out: ${placed}/${r.layout.length} pieces in ${ms} ms (its ground in ${loadedMs} ms, ${waves} wave(s))`);
    emit("rift", { what: "built", gen: r.gen, placed, of: r.layout.length, ms, loadedMs, waves, starved, church: r.church, castle: r.castle, places: r.places });
    return placed === r.layout.length;
  } finally {
    building = false;
  }
}

/** Anyone in the realm now? */
export const occupied = () => allPlayers().some((p) => safe(() => p.dimension.id === RIFT_ID, false));
