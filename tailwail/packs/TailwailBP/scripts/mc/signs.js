// What it leaves behind (3.2), in the world: claw marks gouged into cave walls along its path,
// a tally scratched by your bed for every time you got away, your things moved while you were
// out, and its nest deep in the caves, where what it took from you is laid out neatly.
// Changes at your base are only made while you are away from it and nobody can see the spot.
// Rules and pacing: core/signs_rules.js.  Tuning: config.js SIGNS.
import { BlockPermutation, BlockVolume, StructureRotation, StructureSaveMode, system, world } from "@minecraft/server";
import { SIGNS } from "../config.js";
import {
  DIRS, clawDue, createClawPace, neatSlots, nestLayout, nextTally, pickDisturbance, pushMark, shufflePairs, talliesOwed,
} from "../core/signs_rules.js";
import { dist, dot, norm, sub } from "../util/vec.js";
import { dlog } from "./log.js";
import { lightAt, losClear } from "./perception.js";
import { findGround, isFloor, safeBlock } from "./terrain.js";
import { findTorches } from "./torches.js";

const WORLD_KEY = "tailwail:signs"; // {claws: [[dim, x, y, z]...], nest: {di, x, y, z, chest}}
const PLAYER_KEY = "tailwail:signs"; // {carved, tally: {x, y, z, f, n}, moveAt, last, moved}
const DIM_IDS = ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"];
const CLAW = "tailwail:claw_marks";
const TALLY = "tailwail:tally";
const BED_STRUCTURE = "tailwail:bed_turn";

const cellOf = (p) => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const centre = (c) => ({ x: c.x + 0.5, y: c.y + 0.5, z: c.z + 0.5 });
const isAirBlock = (b) => !!b && b.isAir;
const solid = (dim, c) => isFloor(safeBlock(dim, c));
const step = (c, f, k = 1) => ({ x: c.x + DIRS[f].x * k, y: c.y, z: c.z + DIRS[f].z * k });
// solid, but not a wall you would scratch: furniture, doors, partial blocks
const NOT_A_WALL = new RegExp("(^minecraft:bed$|_bed$|chest$|barrel$|door|fence|_gate$|slab$|stairs$|_wall$|pane$|glass|leaves$|sign$|banner$|" +
  "lantern$|bars$|ladder$|button$|_plate$|anvil$|_table$|furnace$|smoker$|lectern$|cauldron$|composter$|hopper$|bell$|campfire$|pot$|" +
  "skull$|_head$|candle$|scaffolding$|chain$|shulker_box$|bookshelf$|brewing_stand$|grindstone$|loom$|stonecutter|beacon$|conduit$|" +
  "spawner$|piston|observer$|dispenser$|dropper$|crafter$|jukebox$|noteblock$|tnt$|cake$)");

function isWall(dim, c) {
  const b = safeBlock(dim, c);
  return isFloor(b) && !NOT_A_WALL.test(b.typeId);
}

/** Directions in which a wall (a plain solid block) stands right beside this cell. */
function wallsBeside(dim, c) {
  return Object.keys(DIRS).filter((f) => isWall(dim, step(c, f)));
}

function readJson(holder, key) {
  try {
    const j = holder.getDynamicProperty(key);
    return typeof j === "string" ? JSON.parse(j) : null;
  } catch {
    return null;
  }
}

let worldCache = null;
function worldRec() {
  if (!worldCache) {
    const r = readJson(world, WORLD_KEY) || {};
    worldCache = { claws: Array.isArray(r.claws) ? r.claws.slice(-SIGNS.clawMax) : [], nest: r.nest && typeof r.nest === "object" ? r.nest : null };
  }
  return worldCache;
}
function saveWorld() {
  try {
    world.setDynamicProperty(WORLD_KEY, JSON.stringify(worldRec()));
  } catch (e) {
    dlog("signs save", e);
  }
}

function readPlayer(p) {
  const r = readJson(p, PLAYER_KEY) || {};
  return {
    carved: r.carved | 0,
    tally: r.tally && typeof r.tally === "object" ? r.tally : null,
    moveAt: typeof r.moveAt === "number" ? r.moveAt : null,
    last: typeof r.last === "string" ? r.last : null,
    moved: r.moved && typeof r.moved === "object" ? r.moved : null,
  };
}
function savePlayer(p, st) {
  try {
    p.setDynamicProperty(PLAYER_KEY, JSON.stringify(st));
  } catch (e) {
    dlog("signs player save", e);
  }
}

/** Forget me: the tallies start again. */
export function forgetSigns(p) {
  try {
    p.setDynamicProperty(PLAYER_KEY, undefined);
  } catch {
    /* gone */
  }
}

/** Nobody can see this spot right now: outside every player's view, or no line of sight to it. */
export function unseen(dim, cell, players) {
  const p = centre(cell);
  for (const pl of players) {
    try {
      if (pl.dimension.id !== dim.id) continue;
      const e = pl.getHeadLocation();
      if (dist(e, p) > 96) continue;
      if (dot(norm(sub(p, e)), pl.getViewDirection()) > 0.25 && losClear(dim, e, p)) return false;
    } catch {
      /* gone */
    }
  }
  return true;
}

/** Puts a block into an empty (air) cell only.  Never replaces anything. */
function place(dim, cell, id, states) {
  const b = safeBlock(dim, cell);
  if (!isAirBlock(b)) return false;
  try {
    b.setPermutation(BlockPermutation.resolve(id, states || {}));
    return true;
  } catch (e) {
    dlog("sign place", id, e);
    return false;
  }
}

// ------------------------------------------------------------------ claw marks
/** Gouges the rock beside pos (its own column or the next one, one or two blocks up). */
export function clawMarkNear(dim, pos, rng) {
  const base = cellOf(pos);
  const cands = [];
  for (const [ox, oz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [1, 2]) {
      const c = { x: base.x + ox, y: base.y + dy, z: base.z + oz };
      if (!isAirBlock(safeBlock(dim, c))) continue;
      const walls = wallsBeside(dim, c);
      if (walls.length) cands.push({ c, walls });
    }
  }
  if (!cands.length) return null;
  const pick = rng.pick(cands);
  if (!place(dim, pick.c, CLAW, { "tailwail:facing": rng.pick(pick.walls), "tailwail:variant": rng.int(0, 2) })) return null;
  const gone = pushMark(worldRec().claws, [DIM_IDS.indexOf(dim.id), pick.c.x, pick.c.y, pick.c.z]);
  for (const [di, x, y, z] of gone) scrubClaw(di, { x, y, z });
  saveWorld();
  return pick.c;
}

/** The world keeps the newest marks; the oldest one is scrubbed (if it is loaded). */
function scrubClaw(di, c) {
  try {
    const b = safeBlock(world.getDimension(DIM_IDS[di]), c);
    if (b && b.typeId === CLAW) b.setPermutation(BlockPermutation.resolve("minecraft:air"));
  } catch {
    /* unloaded: it stays */
  }
}

/** One per encounter: gouges the rock now and then as it moves through caves. */
export class ClawTrail {
  constructor(rng) {
    this.rng = rng;
    this.pace = createClawPace();
    this.prev = null;
  }

  step(tw, dim) {
    const l = tw.location;
    const moved = this.prev ? dist(l, this.prev) : 0;
    this.prev = { x: l.x, y: l.y, z: l.z };
    let under = false;
    try {
      under = l.y < 64 && dim.getSkyLightLevel(cellOf({ x: l.x, y: l.y + 1, z: l.z })) <= 3;
    } catch {
      under = false;
    }
    if (clawDue(this.pace, moved, under, this.rng)) clawMarkNear(dim, l, this.rng);
  }
}

// ------------------------------------------------------------------ your base
/** Your base: where you respawn (your bed), if it is in the dimension you are in. */
export function baseOf(p) {
  try {
    const sp = p.getSpawnPoint();
    if (!sp || sp.dimension.id !== p.dimension.id) return null;
    return { x: Math.floor(sp.x), y: Math.floor(sp.y), z: Math.floor(sp.z) };
  } catch {
    return null;
  }
}

// cells around the bed, nearest first (searched for a tally spot)
const AROUND = (() => {
  const out = [];
  const r = SIGNS.baseRadius;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      const d = Math.hypot(dx, dz);
      if (d <= r) for (const dy of [1, 2]) out.push([dx, dy, dz, d + (dy - 1) * 0.4]);
    }
  }
  return out.sort((a, b) => a[3] - b[3]);
})();

function findBed(dim, base) {
  let list = [];
  try {
    const vol = new BlockVolume({ x: base.x - 2, y: base.y - 1, z: base.z - 2 }, { x: base.x + 2, y: base.y + 1, z: base.z + 2 });
    list = [...dim.getBlocks(vol, { includeTypes: ["minecraft:bed"] }, true).getBlockLocationIterator()];
  } catch {
    return null;
  }
  list.sort((a, b) => dist(a, base) - dist(b, base));
  for (const a of list) {
    const ab = safeBlock(dim, a);
    if (!ab) continue;
    const head = ab.permutation.getState("head_piece_bit");
    for (const f of Object.keys(DIRS)) {
      const b = step(a, f);
      const bb = safeBlock(dim, b);
      if (bb && bb.typeId === "minecraft:bed" && bb.permutation.getState("head_piece_bit") !== head) {
        const occupied = !!(ab.permutation.getState("occupied_bit") || bb.permutation.getState("occupied_bit"));
        return { a, b, occupied, mid: { x: (a.x + b.x) / 2 + 0.5, y: a.y + 0.5, z: (a.z + b.z) / 2 + 0.5 } };
      }
    }
  }
  return null;
}

function filledSlots(dim, c) {
  try {
    const con = safeBlock(dim, c).getComponent("minecraft:inventory").container;
    const out = [];
    for (let i = 0; i < con.size; i++) if (con.getItem(i)) out.push(i);
    return out;
  } catch {
    return [];
  }
}

export class Signs {
  constructor(rng) {
    this.rng = rng;
    this.lastTally = new Map(); // player id -> tick of the last stroke
    this.building = false;
  }

  /**
   * Once a second per player: tallies and disturbances at your base (only while you are away),
   * and journal pages for the signs you come across.  unlock(flag) opens a journal page.
   */
  tickPlayer(p, sched, settings, unlock) {
    const st = readPlayer(p);
    let dirty = this.discover(p, st, unlock);
    const base = settings.signs ? baseOf(p) : null;
    if (base) {
      const dim = p.dimension;
      const d = dist(p.location, centre(base));
      let loaded = false;
      try {
        loaded = dim.isChunkLoaded(base);
      } catch {
        loaded = false;
      }
      if (loaded && d >= SIGNS.awayMin && d <= SIGNS.awayMax) {
        const players = dim.getPlayers({ location: centre(base), maxDistance: 128 });
        if (players.every((pl) => dist(pl.location, centre(base)) >= SIGNS.awayMin)) {
          // a stroke for every time you got away
          const lastT = this.lastTally.get(p.id);
          if (talliesOwed(sched.escN, st.carved) > 0 && (lastT === undefined || system.currentTick - lastT >= SIGNS.tallyGap * 20)) {
            if (this.carveTally(dim, base, st, players)) {
              st.carved += 1;
              this.lastTally.set(p.id, system.currentTick);
              dirty = true;
            }
          }
          // your things, moved while you were out
          if (st.moveAt === null) {
            st.moveAt = sched.eligibleS + this.rng.range(SIGNS.moveEvery[0], SIGNS.moveEvery[1]);
            dirty = true;
          } else if (sched.stage >= 1 && sched.eligibleS >= st.moveAt) {
            this.disturb(dim, base, st, players);
            st.moveAt = sched.eligibleS + this.rng.range(SIGNS.moveEvery[0], SIGNS.moveEvery[1]);
            dirty = true;
          }
        }
      }
    }
    if (dirty) savePlayer(p, st);
  }

  /** Journal pages: you have seen claw marks, your tally, something it moved, its nest. */
  discover(p, st, unlock) {
    let dirty = false;
    const l = p.location;
    const di = DIM_IDS.indexOf(p.dimension.id);
    const near = (c, r) => Math.abs(l.x - c.x - 0.5) <= r && Math.abs(l.y - c.y) <= r && Math.abs(l.z - c.z - 0.5) <= r;
    const w = worldRec();
    if (w.nest && w.nest.di === di && near(w.nest, SIGNS.discover)) unlock("nest");
    if (st.tally && near(st.tally, 5)) unlock("tally");
    if (st.moved && near(st.moved, 5)) {
      unlock("moved");
      st.moved = null;
      dirty = true;
    }
    for (const [cdi, x, y, z] of w.claws) {
      if (cdi === di && near({ x, y, z }, 4)) {
        unlock("claws");
        break;
      }
    }
    return dirty;
  }

  // ---------------------------------------------------------------- tallies
  /** One more stroke near your bed.  True when it was carved. */
  carveTally(dim, base, st, players) {
    const cur = st.tally;
    if (cur) {
      const b = safeBlock(dim, cur);
      const live = !!b && b.typeId === TALLY;
      const next = nextTally(live ? { n: b.permutation.getState("tailwail:count") } : null);
      if (live && !next.fresh) {
        if (!unseen(dim, cur, players)) return false;
        b.setPermutation(b.permutation.withState("tailwail:count", next.n));
        st.tally = { ...cur, n: next.n };
        return true;
      }
      if (live) {
        // a full group of five: the next one goes beside it on the same wall
        const f = cur.f;
        const along = f === "north" || f === "south" ? ["east", "west"] : ["north", "south"];
        for (const s of along) {
          for (let k = 1; k <= 6; k++) {
            const c = step(cur, s, k);
            const cb = safeBlock(dim, c);
            if (cb && cb.typeId === TALLY) continue; // an older group: keep going along the wall
            if (isAirBlock(cb) && isWall(dim, step(c, f)) && unseen(dim, c, players) &&
                place(dim, c, TALLY, { "tailwail:facing": f, "tailwail:count": 1 })) {
              st.tally = { x: c.x, y: c.y, z: c.z, f, n: 1 };
              return true;
            }
            break;
          }
        }
      }
    }
    const spot = this.tallySpot(dim, base, players);
    if (!spot) return false;
    if (!place(dim, spot.c, TALLY, { "tailwail:facing": spot.f, "tailwail:count": 1 })) return false;
    st.tally = { x: spot.c.x, y: spot.c.y, z: spot.c.z, f: spot.f, n: 1 };
    return true;
  }

  /** The nearest empty cell beside a wall around your bed, at about head height, out of sight. */
  tallySpot(dim, base, players) {
    for (const [dx, dy, dz] of AROUND) {
      const c = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
      if (!isAirBlock(safeBlock(dim, c))) continue;
      const walls = wallsBeside(dim, c);
      if (walls.length && unseen(dim, c, players)) return { c, f: walls[0] };
    }
    return null;
  }

  // ---------------------------------------------------------------- disturbances
  /** Moves one of your things.  force: torch | barrel | chest | bed (debug).  Returns what, or null. */
  disturb(dim, base, st, players, force = null) {
    const r = SIGNS.baseRadius;
    const vol = new BlockVolume({ x: base.x - r, y: base.y - 3, z: base.z - r }, { x: base.x + r, y: base.y + 4, z: base.z + r });
    const find = (types) => {
      try {
        return [...dim.getBlocks(vol, { includeTypes: types }, true).getBlockLocationIterator()];
      } catch {
        return [];
      }
    };
    const torches = findTorches(dim, centre(base), r).filter((c) => unseen(dim, c, players));
    const barrels = find(["minecraft:barrel"]).filter((c) => {
      const b = safeBlock(dim, c);
      return !!b && !b.permutation.getState("open_bit") && unseen(dim, c, players);
    });
    const chests = find(["minecraft:chest", "minecraft:trapped_chest"]).filter((c) => unseen(dim, c, players) && filledSlots(dim, c).length >= 2);
    const bed = findBed(dim, base);
    const bedOk = !!bed && !bed.occupied && players.every((pl) => dist(pl.location, bed.mid) > 6) &&
      unseen(dim, bed.a, players) && unseen(dim, bed.b, players);
    const avail = { torch: torches.length > 0, barrel: barrels.length > 0, chest: chests.length > 0, bed: bedOk };
    const kind = force ? (avail[force] ? force : null) : pickDisturbance(avail, this.rng, st.last);
    if (!kind) return null;
    let at = null;
    if (kind === "torch") at = this.shiftTorch(dim, this.rng.pick(torches), players);
    else if (kind === "barrel") at = this.openBarrel(dim, this.rng.pick(barrels));
    else if (kind === "chest") at = this.shuffleChest(dim, this.rng.pick(chests));
    else at = this.turnBed(dim, bed);
    if (!at) return null;
    st.last = kind;
    st.moved = { x: at.x, y: at.y, z: at.z, k: kind };
    dlog(`it moved a ${kind} at ${at.x} ${at.y} ${at.z}`);
    return kind;
  }

  /** A torch taken down and put up again a couple of blocks away, on the floor of the same room. */
  shiftTorch(dim, from, players) {
    const b = safeBlock(dim, from);
    if (!b) return null;
    const type = b.typeId;
    const offs = this.rng.shuffle([[2, 0], [-2, 0], [0, 2], [0, -2], [3, 1], [-3, -1], [1, 3], [-1, -3], [2, 2], [-2, -2]]);
    for (const [ox, oz] of offs) {
      for (const dy of [0, -1, 1]) {
        const c = { x: from.x + ox, y: from.y + dy, z: from.z + oz };
        const cb = safeBlock(dim, c);
        if (!isAirBlock(cb) || !solid(dim, { x: c.x, y: c.y - 1, z: c.z }) || !unseen(dim, c, players)) continue;
        if (!losClear(dim, centre(from), centre(c))) continue; // same room: never through a wall
        try {
          cb.setPermutation(BlockPermutation.resolve(type, { torch_facing_direction: "top" }));
          b.setPermutation(BlockPermutation.resolve("minecraft:air"));
          return c;
        } catch (e) {
          dlog("torch move", e);
          return null;
        }
      }
    }
    return null;
  }

  openBarrel(dim, c) {
    try {
      const b = safeBlock(dim, c);
      b.setPermutation(b.permutation.withState("open_bit", true));
      return c;
    } catch (e) {
      dlog("barrel", e);
      return null;
    }
  }

  /** Nothing is taken: things are just where they should not be. */
  shuffleChest(dim, c) {
    try {
      const con = safeBlock(dim, c).getComponent("minecraft:inventory").container;
      const filled = [];
      for (let i = 0; i < con.size; i++) if (con.getItem(i)) filled.push(i);
      for (const [a, b] of shufflePairs(con.size, filled, this.rng, this.rng.int(3, 6))) con.swapItems(a, b, con);
      return c;
    } catch (e) {
      dlog("chest", e);
      return null;
    }
  }

  /** Your bed, turned the other way round (both halves, colour kept: a structure copy rotated 180). */
  turnBed(dim, bed) {
    if (!bed || bed.occupied) return null;
    const min = { x: Math.min(bed.a.x, bed.b.x), y: bed.a.y, z: Math.min(bed.a.z, bed.b.z) };
    const max = { x: Math.max(bed.a.x, bed.b.x), y: bed.a.y, z: Math.max(bed.a.z, bed.b.z) };
    const sm = world.structureManager;
    try {
      sm.delete(BED_STRUCTURE);
    } catch {
      /* none left over */
    }
    try {
      const s = sm.createFromWorld(BED_STRUCTURE, dim, min, max, { includeEntities: false, includeBlocks: true, saveMode: StructureSaveMode.Memory });
      sm.place(s, dim, min, { rotation: StructureRotation.Rotate180, includeEntities: false });
      return bed.a;
    } catch (e) {
      dlog("bed turn", e);
      return null;
    } finally {
      try {
        sm.delete(BED_STRUCTURE);
      } catch {
        /* gone */
      }
    }
  }

  // ---------------------------------------------------------------- the nest
  /** Its nest within `range` of `around` (built now if there is none).  done(nest | null). */
  ensureNest(dim, around, players, done, range = SIGNS.nestRange, needLoaded = false) {
    const w = worldRec();
    const di = DIM_IDS.indexOf(dim.id);
    const n = w.nest;
    if (n && n.di === di && dist(n, around) <= range && (!needLoaded || (n.chest && safeBlock(dim, n.chest)))) {
      if (done) done(n);
      return;
    }
    if (this.building) {
      if (done) done(null);
      return;
    }
    this.building = true;
    system.runJob(this.buildNest(dim, cellOf(around), players, (nest) => {
      this.building = false;
      if (done) done(nest);
    }));
  }

  * buildNest(dim, around, players, done) {
    let site = null;
    for (let i = 0; i < SIGNS.nestTries && !site; i++) {
      try {
        site = this.nestSite(dim, around, players, i < SIGNS.nestTries * 0.75 ? 4 : 0);
      } catch (e) {
        dlog("nest site", e);
      }
      yield;
    }
    if (!site) {
      dlog("no room for a nest here");
      done(null);
      return;
    }
    let chest = null;
    for (const it of nestLayout(site.cells, this.rng)) {
      const c = { x: site.c.x + it.dx, y: site.c.y + it.dy, z: site.c.z + it.dz };
      if (placeNestPiece(dim, c, it, this.rng) && it.what === "chest") chest = c;
      yield;
    }
    const nest = { di: DIM_IDS.indexOf(dim.id), x: site.c.x, y: site.c.y, z: site.c.z, chest };
    worldRec().nest = nest;
    saveWorld();
    dlog(`its nest is at ${nest.x} ${nest.y} ${nest.z}`);
    done(nest);
  }

  /** One attempt: a dark cave floor 16-40 blocks away, roomy, never in anyone's sight, with walls. */
  nestSite(dim, around, players, minWalled = 0) {
    const a = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(SIGNS.nestDistance[0], SIGNS.nestDistance[1]);
    const x = around.x + Math.cos(a) * r;
    const z = around.z + Math.sin(a) * r;
    if (!dim.isChunkLoaded({ x, y: around.y, z })) return null;
    const g = findGround(dim, x, z, around.y, 6, 12, 3);
    if (!g) return null;
    const c = { x: Math.floor(g.x), y: g.y, z: Math.floor(g.z) };
    if (dim.getSkyLightLevel({ x: c.x, y: c.y + 1, z: c.z }) > 0) return null; // deep: no sky at all
    if (lightAt(dim, { x: c.x + 0.5, y: c.y + 1, z: c.z + 0.5 }) > 4) return null;
    if (players.some((p) => dist(p.location, centre(c)) < 12)) return null;
    if (!unseen(dim, { x: c.x, y: c.y + 1, z: c.z }, players)) return null;
    const cells = [];
    let floors = 0;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const p = { x: c.x + dx, y: c.y, z: c.z + dz };
        const up = { x: p.x, y: p.y + 1, z: p.z };
        const upOpen = isAirBlock(safeBlock(dim, up));
        const floor = isAirBlock(safeBlock(dim, p)) && upOpen && isFloor(safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z }));
        if (floor && Math.max(Math.abs(dx), Math.abs(dz)) <= 2) floors++;
        cells.push({ dx, dz, floor, walls: upOpen ? wallsBeside(dim, up) : [] });
      }
    }
    if (floors < 12 || !cells.find((q) => q.dx === 0 && q.dz === 0).floor) return null;
    if (cells.filter((q) => q.walls.length).length < minWalled) return null;
    return { c, cells };
  }

  /** You died while it hunted you: it carries some of what you dropped to its nest. */
  takeDrops(dim, at, players) {
    system.runTimeout(() => {
      let items = [];
      try {
        items = dim.getEntities({ type: "minecraft:item", location: at, maxDistance: SIGNS.lootRadius });
      } catch {
        return;
      }
      if (!items.length) return;
      this.ensureNest(dim, at, players, (nest) => {
        if (!nest || !nest.chest) return;
        let con;
        try {
          con = safeBlock(dim, nest.chest).getComponent("minecraft:inventory").container;
        } catch {
          return;
        }
        const taken = new Set();
        for (let i = 0; i < con.size; i++) if (con.getItem(i)) taken.add(i);
        const picks = this.rng.shuffle(items.filter((e) => e.isValid)).slice(0, SIGNS.lootStacks);
        const slots = neatSlots(picks.length, taken);
        picks.forEach((e, i) => {
          if (i >= slots.length) return;
          try {
            con.setItem(slots[i], e.getComponent("minecraft:item").itemStack);
            e.remove(); // only once it is safely in the chest
          } catch (err) {
            dlog("carry item", err);
          }
        });
        dlog(`it carried ${Math.min(picks.length, slots.length)} of your things to its nest`);
      }, 64, true);
    }, 30);
  }
}

const NEST_BLOCKS = {
  chest: ["minecraft:chest", {}],
  stick: ["tailwail:snuffed_torch", { "tailwail:facing": "top", "tailwail:kind": 0 }],
  bone: ["minecraft:bone_block", {}],
  skull: ["minecraft:skeleton_skull", { facing_direction: 1 }],
  carpet_black: ["minecraft:black_carpet", {}],
  carpet_brown: ["minecraft:brown_carpet", {}],
  cobweb: ["minecraft:web", {}],
};

function placeNestPiece(dim, c, it, rng) {
  if (it.what === "claw") return place(dim, c, CLAW, { "tailwail:facing": it.facing, "tailwail:variant": rng.int(0, 2) });
  const spec = NEST_BLOCKS[it.what];
  return !!spec && place(dim, c, spec[0], spec[1]);
}
