// @ts-check
// The Rift's realm (1.6.0): the dead woods, the church and the castle, laid out in the rift dimension from the pieces
// tools/rift_world.py draws (structures/rift/*.mcstructure, 48 x 52 x 48 each, every cell written, air included).
//
// Five by five pieces, 240 x 240 blocks round the centre: the landing in the middle (where a rift sets you down, and
// where the way out opens), the church and the castle somewhere in the ring round it, the dead woods in the rest of
// that ring, and the woods ending at a crumbling edge over the void all the way round the outside. Each time a rift
// opens and nobody is in there, the realm is laid out again, shuffled: the church and the castle elsewhere, the woods
// turned another way, every chest full again, whatever was built or broken there gone.
import { world, system, StructureRotation } from "@minecraft/server";
import { rift, RIFT_ID } from "./dimension.js";
import { safe, emit, trace, allPlayers, randInt, shuffle, pick } from "../core/util.js";

export const CELL = 48;
export const GRID = 5;
/** The world corner of the grid (chunk-aligned) and its bottom. */
export const ORIGIN = { x: -128, y: 48, z: -128 };
export const SPAN = CELL * GRID;
/** The ground's height. */
export const GROUND = 64;
/** Where the way out opens: the landing's middle. */
export const EXIT = { x: ORIGIN.x + 2 * CELL + 24, y: GROUND + 1, z: ORIGIN.z + 2 * CELL + 24 };
/** Where you come in: a few steps south of it, facing away. */
export const ARRIVE = { x: EXIT.x + 0.5, y: GROUND + 1, z: EXIT.z + 6.5 };

const KEY = "observer:rift_realm";
const AREAS = 3;

const WOODS = ["rift:woods_1", "rift:woods_2", "rift:woods_3", "rift:woods_4"];
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
 * @typedef {{gen:number, layout:Placement[], builtAt:number, church:[number,number], castle:[number,number]}} Realm
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
      else if (i === 2 && j === 2) out.push({ i, j, id: "rift:landing", rot: randInt(0, 3) });
      else ring.push([i, j]);
    }
  }
  shuffle(ring);
  const [church, castle, ...rest] = ring;
  out.push({ i: church[0], j: church[1], id: "rift:church", rot: randInt(0, 3) });
  out.push({ i: castle[0], j: castle[1], id: "rift:castle", rot: randInt(0, 3) });
  for (const [i, j] of rest) out.push({ i, j, id: pick(WOODS), rot: randInt(0, 3) });
  return { gen, layout: out, builtAt: 0, church: /** @type {[number,number]} */ (church), castle: /** @type {[number,number]} */ (castle) };
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
/** The middle of the church's or the castle's piece, in the realm as laid out. @param {"church"|"castle"} what */
export function where(what) {
  const r = current();
  const c = r?.[what];
  if (!c) return undefined;
  const at = cellAt(c[0], c[1]);
  return { x: at.x + CELL / 2, y: GROUND + 1, z: at.z + CELL / 2 };
}

let building = false;
/** Is it being laid out right now? */
export const isBuilding = () => building;

/** The ticking areas that hold the realm's chunks while it is laid out: three strips of 80 x 240 (75 chunks each). */
function areas(add) {
  const d = rift();
  if (!d) return false;
  const w = SPAN / AREAS;
  for (let k = 0; k < AREAS; k++) {
    const x0 = ORIGIN.x + k * w;
    const cmd = add
      ? `tickingarea add ${x0} 0 ${ORIGIN.z} ${x0 + w - 1} 0 ${ORIGIN.z + SPAN - 1} observer_rift_${k} true`
      : `tickingarea remove observer_rift_${k}`;
    safe(() => d.runCommand(cmd));
  }
  return true;
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
    areas(true);
    // wait for the chunks (up to 30 s)
    for (let w = 0; w < 600; w++) {
      let ok = true;
      for (let i = 0; i < GRID && ok; i++) for (let j = 0; j < GRID && ok; j++) {
        const c = cellAt(i, j);
        for (const [dx, dz] of [[1, 1], [CELL - 2, CELL - 2], [1, CELL - 2], [CELL - 2, 1]]) {
          if (!safe(() => d.isChunkLoaded({ x: c.x + dx, y: GROUND, z: c.z + dz }), false)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) break;
      await system.waitTicks(1);
    }
    // the realm's own: whatever was left lying there (or brought in) goes first
    for (const e of safe(() => d.getEntities(), []) ?? []) {
      if (e.typeId !== "minecraft:player" && within(e.location, 32)) safe(() => e.remove());
    }
    let placed = 0;
    for (const pl of r.layout) {
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
      await system.waitTicks(2);
    }
    r.builtAt = Date.now();
    world.setDynamicProperty(KEY, JSON.stringify(r));
    const ms = Date.now() - t0;
    trace(`rift realm ${r.gen} laid out: ${placed}/${r.layout.length} pieces in ${ms} ms`);
    emit("rift", { what: "built", gen: r.gen, placed, of: r.layout.length, ms, church: r.church, castle: r.castle });
    return placed === r.layout.length;
  } finally {
    areas(false);
    building = false;
  }
}

/** Anyone in the realm now? */
export const occupied = () => allPlayers().some((p) => safe(() => p.dimension.id === RIFT_ID, false));
