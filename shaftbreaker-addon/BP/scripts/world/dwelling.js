// @ts-check
// Dwellings: the creature's nests. A large Dwelling is built at the heart of every Hollow, and small
// lone Dwellings appear rarely in ordinary caves. Each has a Dwelling Heart; destroying it (by any
// means: mining, fire, explosions) protects the surrounding area from spawns and may trigger the
// final confrontation.
import { world } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { W, markDirty, hollowState } from "../core/state.js";
import { getBlock, hash, rand, randInt, pick, dist, distXZ, guard, now } from "../core/util.js";
import { NATURAL, solid, passable, FLESH_BLOCKS } from "../core/blocks.js";
import { hooks as terrHooks, placePerm, hang } from "./territory.js";

export const dwellingHooks = {
  /** @type {null | ((d: import("../core/state.js").Dwelling, player: import("@minecraft/server").Player | undefined) => void)} */
  onDestroyed: null,
};

const isAirB = (b) => { try { return !!b && b.isAir; } catch { return false; } };
const replaceable = (b) => {
  if (!b) return false;
  try {
    const id = b.typeId;
    return NATURAL.has(id) || FLESH_BLOCKS.has(id) || id === "shaftbreaker:ribstone" || id === "shaftbreaker:pulsing_flesh";
  } catch { return false; }
};

/** first floor (solid with 2 open blocks above) near yRef */
export function localFloor(dim, x, z, yRef, up = 3, down = 6) {
  for (let y = yRef + up; y >= yRef - down; y--) {
    if (solid(getBlock(dim, { x, y, z })) && passable(getBlock(dim, { x, y: y + 1, z })) && passable(getBlock(dim, { x, y: y + 2, z }))) return y;
  }
  return null;
}

function setIfAir(dim, x, y, z, id, states) {
  const b = getBlock(dim, { x, y, z });
  if (!isAirB(b)) return false;
  return placePerm(dim, { x, y, z }, id, states || {});
}
function replaceAt(dim, x, y, z, id) {
  const b = getBlock(dim, { x, y, z });
  if (!replaceable(b)) return false;
  try { /** @type {any} */ (b).setType(id); return true; } catch { return false; }
}

const WALL_MIX = () => {
  const r = rand();
  return r < 0.5 ? "shaftbreaker:fleshstone" : r < 0.75 ? "shaftbreaker:pulsing_flesh" : r < 0.9 ? "shaftbreaker:veinstone" : "shaftbreaker:ribstone";
};

/** Face-connected voxel line from a to b (so arches never have diagonal-only joints). */
function voxelPath(points) {
  const out = [];
  let prev = null;
  for (const p of points) {
    const v = [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])];
    if (prev) {
      // step one axis at a time to keep face adjacency
      let cur = [...prev];
      for (const ax of [1, 0, 2]) {
        while (cur[ax] !== v[ax]) {
          cur[ax] += Math.sign(v[ax] - cur[ax]);
          out.push([...cur]);
        }
      }
    } else out.push(v);
    prev = v;
  }
  return out;
}

/** The great Dwelling at the centre of a Hollow. */
function* buildBig(dim, h, hs) {
  const x = Math.floor(h.cx);
  const z = Math.floor(h.cz);
  const fy = localFloor(dim, x, z, h.cy, 6, 16);
  if (fy === null) return;
  const floor = new Map();
  let ops = 0;
  // floor disk
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -7; dz <= 7; dz++) {
      const r = Math.hypot(dx, dz);
      if (r > 6.6) continue;
      const lf = localFloor(dim, x + dx, z + dz, fy, 3, 4);
      if (lf === null) continue;
      floor.set(dx + "," + dz, lf);
      replaceAt(dim, x + dx, lf, z + dz, r < 2.3 ? "shaftbreaker:pulsing_flesh" : rand() < 0.75 ? "shaftbreaker:fleshstone" : "shaftbreaker:bloodmoss");
      if (++ops % 30 === 0) yield;
    }
  }
  // entrances
  const ent = [hash(x, z, W.salt, 31) * Math.PI * 2];
  ent.push(ent[0] + 2.0 + hash(x, z, W.salt, 32) * 0.8);
  ent.push(ent[0] + 4.1 + hash(x, z, W.salt, 33) * 0.6);
  const isEntrance = (a) => ent.some((e) => Math.abs(Math.atan2(Math.sin(a - e), Math.cos(a - e))) < 0.42);
  // wall ring
  for (let dx = -7; dx <= 7; dx++) {
    for (let dz = -7; dz <= 7; dz++) {
      const r = Math.hypot(dx, dz);
      if (r < 5.3 || r > 6.6) continue;
      const a = Math.atan2(dz, dx);
      if (isEntrance(a)) continue;
      const lf = floor.get(dx + "," + dz);
      if (lf === undefined) continue;
      const hgt = 2 + Math.floor(hash(x + dx, z + dz, W.salt, 34) * 3);
      for (let i = 1; i <= hgt; i++) setIfAir(dim, x + dx, lf + i, z + dz, WALL_MIX());
      if (++ops % 20 === 0) yield;
    }
  }
  // two crossing rib arches over the nest (legs on the floor, all blocks face-connected)
  for (let k = 0; k < 2; k++) {
    const a = ent[0] + 0.8 + k * (Math.PI / 2);
    const p1 = [x + Math.round(Math.cos(a) * 6), 0, z + Math.round(Math.sin(a) * 6)];
    const p2 = [x - Math.round(Math.cos(a) * 6), 0, z - Math.round(Math.sin(a) * 6)];
    const f1 = floor.get((p1[0] - x) + "," + (p1[2] - z)) ?? fy;
    const f2 = floor.get((p2[0] - x) + "," + (p2[2] - z)) ?? fy;
    const pts = [];
    for (let i = 1; i <= 3; i++) pts.push([p1[0], f1 + i, p1[2]]);
    for (let t = 0; t <= 1.0001; t += 0.04) {
      const px = p1[0] + (p2[0] - p1[0]) * t;
      const pz = p1[2] + (p2[2] - p1[2]) * t;
      const base = f1 + (f2 - f1) * t + 3;
      pts.push([px, base + Math.sin(Math.PI * t) * 4.2, pz]);
    }
    for (let i = 3; i >= 1; i--) pts.push([p2[0], f2 + i, p2[2]]);
    const vox = voxelPath(pts);
    const placed = [];
    for (const [vx, vy, vz] of vox) {
      const b = getBlock(dim, { x: vx, y: vy, z: vz });
      if (isAirB(b) || replaceable(b)) {
        try { /** @type {any} */ (b).setType("shaftbreaker:ribstone"); placed.push([vx, vy, vz]); } catch { /* */ }
      }
      if (++ops % 25 === 0) yield;
    }
    // hanging tissue beneath the arch
    for (let i = 0; i < 4 && placed.length; i++) {
      const [vx, vy, vz] = pick(placed);
      if (vy - fy > 4) hang(dim, vx, vy, vz, "tissue", randInt(1, 2));
    }
  }
  // heart altar
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) setIfAir(dim, x + dx, fy + 1, z + dz, "shaftbreaker:fleshstone");
  for (const [dx, dz] of [[1, 1], [-1, -1]]) setIfAir(dim, x + dx, fy + 1, z + dz, "shaftbreaker:organ_core");
  for (const [dx, dz] of [[1, -1], [-1, 1]]) setIfAir(dim, x + dx, fy + 1, z + dz, "shaftbreaker:pulsing_flesh");
  const b = getBlock(dim, { x, y: fy + 1, z });
  if (b) { try { b.setType("shaftbreaker:dwelling_heart"); } catch { /* */ } }
  hs.organs += 3;
  // interior clutter
  for (let i = 0; i < 16; i++) {
    const dx = randInt(-5, 5);
    const dz = randInt(-5, 5);
    const r = Math.hypot(dx, dz);
    if (r < 2.2 || r > 5) continue;
    const lf = floor.get(dx + "," + dz);
    if (lf === undefined) continue;
    setIfAir(dim, x + dx, lf + 1, z + dz, pick(["shaftbreaker:skull_pile", "shaftbreaker:skull_pile", "shaftbreaker:dweller_droppings",
      "shaftbreaker:dweller_droppings", "shaftbreaker:glowspore_cluster", "shaftbreaker:bloodmoss_carpet"]));
  }
  yield;
  // watchers at the entrances, a sinew curtain across one of them
  for (let i = 0; i < ent.length; i++) {
    const e = ent[i];
    const ex = x + Math.round(Math.cos(e) * 8.5);
    const ez = z + Math.round(Math.sin(e) * 8.5);
    const lf = localFloor(dim, ex, ez, fy, 3, 4);
    if (lf !== null && setIfAir(dim, ex, lf + 1, ez, "shaftbreaker:watcher_pod")) {
      if (hs.pods.length < 40) hs.pods.push([ex, lf + 1, ez]);
      hs.organs++;
    }
    if (i === 0) {
      const mx = x + Math.round(Math.cos(e) * 6);
      const mz = z + Math.round(Math.sin(e) * 6);
      const mf = floor.get((mx - x) + "," + (mz - z));
      if (mf !== undefined) {
        const axis = Math.abs(Math.cos(e)) > Math.abs(Math.sin(e)) ? 1 : 0;
        for (const ox of [-1, 0, 1]) {
          const cx = axis === 1 ? mx : mx + ox;
          const cz = axis === 1 ? mz + ox : mz;
          for (const dy of [1, 2]) setIfAir(dim, cx, mf + dy, cz, "shaftbreaker:sinew_membrane", { "shaftbreaker:axis": axis });
        }
      }
    }
  }
  const entry = { id: "d" + x + "_" + z, x, y: fy + 1, z, hx: x, hy: fy + 1, hz: z, alive: true, hollow: h.id, big: true, destroyedAt: 0, cleansed: false };
  registerDwelling(entry);
  hs.dwelling = entry.id;
  markDirty();
}
terrHooks.buildDwelling = buildBig;

/**
 * A small lone Dwelling built into an ordinary cave floor at loc (feet position on a floor).
 * @param {import("@minecraft/server").Dimension} dim @param {{x:number,y:number,z:number}} loc
 */
export function* buildSmall(dim, loc) {
  const x = Math.floor(loc.x);
  const z = Math.floor(loc.z);
  const fy = localFloor(dim, x, z, Math.floor(loc.y) - 1, 2, 3);
  if (fy === null) return false;
  const floor = new Map();
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const r = Math.hypot(dx, dz);
      if (r > 3.6) continue;
      const lf = localFloor(dim, x + dx, z + dz, fy, 2, 3);
      if (lf === null) continue;
      floor.set(dx + "," + dz, lf);
      replaceAt(dim, x + dx, lf, z + dz, r < 1.5 ? "shaftbreaker:pulsing_flesh" : rand() < 0.7 ? "shaftbreaker:fleshstone" : "shaftbreaker:veinstone");
    }
  }
  yield;
  const gapA = rand() * Math.PI * 2;
  for (const [k, lf] of floor) {
    const [dx, dz] = k.split(",").map(Number);
    const r = Math.hypot(dx, dz);
    if (r < 2.6) continue;
    const a = Math.atan2(dz, dx);
    if (Math.abs(Math.atan2(Math.sin(a - gapA), Math.cos(a - gapA))) < 0.9) continue;
    const hgt = 1 + Math.floor(rand() * 2);
    for (let i = 1; i <= hgt; i++) setIfAir(dim, x + dx, lf + i, z + dz, WALL_MIX());
  }
  // heart at the back (opposite the gap)
  const hx = x + Math.round(Math.cos(gapA + Math.PI) * 1.5);
  const hz = z + Math.round(Math.sin(gapA + Math.PI) * 1.5);
  const hf = floor.get((hx - x) + "," + (hz - z)) ?? fy;
  const hb = getBlock(dim, { x: hx, y: hf + 1, z: hz });
  if (!hb || !passable(hb)) return false;
  try { hb.setType("shaftbreaker:dwelling_heart"); } catch { return false; }
  for (let i = 0; i < 7; i++) {
    const dx = randInt(-2, 2);
    const dz = randInt(-2, 2);
    const lf = floor.get(dx + "," + dz);
    if (lf === undefined || (x + dx === hx && z + dz === hz)) continue;
    setIfAir(dim, x + dx, lf + 1, z + dz, pick(["shaftbreaker:skull_pile", "shaftbreaker:dweller_droppings", "shaftbreaker:dweller_droppings"]));
  }
  // hanging tissue from the cave ceiling above, if there is one within reach
  for (let i = 0; i < 4; i++) {
    const dx = randInt(-3, 3);
    const dz = randInt(-3, 3);
    for (let y = fy + 3; y <= fy + 7; y++) {
      const b = getBlock(dim, { x: x + dx, y, z: z + dz });
      if (solid(b)) { if (y - fy >= 4) hang(dim, x + dx, y, z + dz, "tissue", randInt(1, 2)); break; }
    }
  }
  // droppings trail leading out of the gap (evidence outside the shelter)
  for (let i = 4; i <= 7; i++) {
    const tx = x + Math.round(Math.cos(gapA) * i);
    const tz = z + Math.round(Math.sin(gapA) * i);
    const lf = localFloor(dim, tx, tz, fy, 2, 3);
    if (lf !== null && rand() < 0.6) setIfAir(dim, tx, lf + 1, tz, "shaftbreaker:dweller_droppings");
  }
  const entry = { id: "s" + x + "_" + z, x, y: fy + 1, z, hx, hy: hf + 1, hz, alive: true, hollow: null, big: false, destroyedAt: 0, cleansed: false };
  registerDwelling(entry);
  return true;
}

/** @param {import("../core/state.js").Dwelling} d */
export function registerDwelling(d) {
  W.dwellings = W.dwellings.filter((o) => o.id !== d.id);
  W.dwellings.push(d);
  if (W.dwellings.length > 48) W.dwellings.splice(0, W.dwellings.length - 48);
  markDirty();
}

/** @param {{x:number,y:number,z:number}} loc @param {number} r */
export function dwellingsNear(loc, r, aliveOnly = true) {
  return W.dwellings.filter((d) => (!aliveOnly || d.alive) && dist(loc, d) < r);
}

/** True where destroyed Dwellings keep the creature from spawning. @param {{x:number,y:number,z:number}} loc */
export function isProtected(loc) {
  if (!cfg.dwellings) return false;
  for (const d of W.dwellings) {
    if (!d.alive && distXZ(loc, d) < cfg.protectRadius && Math.abs(loc.y - d.y) < 80) return true;
  }
  return false;
}

/** @param {import("../core/state.js").Dwelling} d @param {import("@minecraft/server").Player | undefined} player */
export function destroyDwelling(d, player) {
  if (!d.alive) return;
  d.alive = false;
  d.destroyedAt = W.ticks;
  W.anger = Math.min(100, W.anger + 30);
  if (d.hollow) {
    const hs = hollowState(d.hollow);
    hs.rage = Math.min(100, hs.rage + 45);
  }
  markDirty();
  guard("dwellDestroyed", () => dwellingHooks.onDestroyed && dwellingHooks.onDestroyed(d, player));
}

/** Heart broken by a player. */
export function onHeartBroken(loc, player) {
  const d = W.dwellings.find((o) => o.alive && dist({ x: o.hx, y: o.hy, z: o.hz }, loc) < 2.5);
  if (d) destroyDwelling(d, player);
}

/** every 100 ticks: hearts lost to fire / explosions / anything are detected here. */
export function dwellingTick() {
  if (!cfg.dwellings) return;
  const dim = world.getDimension("overworld");
  const players = dim.getPlayers();
  if (!players.length) return;
  for (const d of W.dwellings) {
    if (!d.alive) continue;
    const pl = players.find((p) => dist(p.location, d) < 72);
    if (!pl) continue;
    const b = getBlock(dim, { x: d.hx, y: d.hy, z: d.hz });
    if (!b) continue;
    let id = "";
    try { id = b.typeId; } catch { continue; }
    if (id !== "shaftbreaker:dwelling_heart") destroyDwelling(d, pl);
  }
}
export { now };
