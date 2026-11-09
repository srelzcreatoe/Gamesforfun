// @ts-check
// The Shaftbreaker's Hollow: a large infected cave territory, placed deterministically per world.
// Generated chunk by chunk as players approach (carving a great central cavern + connecting tunnels,
// infecting stone into Veinstone, and decorating floors/ceilings/walls). Every decoration is attached
// to a real surface (floor, ceiling or wall), so nothing floats.
import { world, system, BlockVolume, BlockTypes, BlockPermutation, EntityInitializationCause } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { W, hollowState, chunkSet, saveChunkSet, markDirty } from "../core/state.js";
import { hash, distXZ, smoothstep, clamp, getBlock, now, rand, randInt, pick, guard, flat, alive } from "../core/util.js";
import { CARVABLE, INFECT_STONE, INFECT_DEEP, NATURAL, solid, scorable } from "../core/blocks.js";

const SIZE_R = [66, 94, 126];
const CELL = [900, 640, 470];
const CHANCE = [0.45, 0.6, 0.75];

export const hooks = { /** @type {null | ((dim:any, h:any, hs:any) => Generator<void, void, void>)} */ buildDwelling: null };

/** @param {string[]} ids */
const validTypes = (ids) => ids.filter((id) => { try { return !!BlockTypes.get(id); } catch { return false; } });
let CARVE_T = null;
let STONE_T = null;
let DEEP_T = null;
function types() {
  if (!CARVE_T) {
    CARVE_T = validTypes(CARVABLE);
    STONE_T = validTypes(INFECT_STONE);
    DEEP_T = validTypes(INFECT_DEEP);
  }
}

export const cellSize = () => CELL[cfg.territoryFrequency] ?? 640;

/** @typedef {{id:string, cx:number, cy:number, cz:number, R:number, rx:number, rz:number, ryUp:number, ryDown:number, tunnels:number[][], forced:boolean}} Hollow */

/** @type {Map<string, Hollow|null>} */
const cache = new Map();

function makeTunnels(h, seedA, seedB) {
  const n = 4 + Math.floor(hash(seedA, seedB, W.salt, 5) * 2);
  /** @type {number[][]} */
  const pts = [];
  for (let i = 0; i < n; i++) {
    let ang = (i / n) * Math.PI * 2 + hash(seedA, seedB, W.salt, 10 + i) * 1.1;
    let pitch = (hash(seedA, seedB, W.salt, 20 + i) - 0.5) * 0.5;
    let x = h.cx;
    let y = h.cy - 3;
    let z = h.cz;
    const L = h.R * 0.92;
    for (let s = 0; s < L; s += 2) {
      ang += (hash(seedA, seedB, i, s, W.salt) - 0.5) * 0.38;
      pitch = clamp(pitch + (hash(seedA, seedB, i, s, W.salt, 1) - 0.5) * 0.22, -0.42, 0.42);
      x += Math.cos(ang) * 2;
      z += Math.sin(ang) * 2;
      y = clamp(y + Math.sin(pitch) * 1.2, -57, h.cy + 26);
      const r = 2.3 + hash(seedA, seedB, i, s, W.salt, 2) * 1.2;
      if (Math.hypot(x - h.cx, z - h.cz) > Math.min(h.rx, h.rz) * 0.75) pts.push([x, y, z, r]);
    }
  }
  return pts;
}

/** @param {number} gx @param {number} gz @returns {Hollow|null} */
export function hollowAt(gx, gz) {
  const k = `${gx},${gz},${cfg.territoryFrequency},${cfg.territorySize}`;
  if (cache.has(k)) return cache.get(k) ?? null;
  let h = null;
  const C = cellSize();
  if (hash(gx, gz, W.salt) < (CHANCE[cfg.territoryFrequency] ?? 0.6)) {
    const cx = gx * C + C * (0.2 + 0.6 * hash(gx, gz, W.salt, 1));
    const cz = gz * C + C * (0.2 + 0.6 * hash(gx, gz, W.salt, 2));
    let far = true;
    try {
      const sp = world.getDefaultSpawnLocation();
      if (Math.hypot(sp.x - cx, sp.z - cz) < 330) far = false;
    } catch { /* ignore */ }
    if (far) {
      const R = (SIZE_R[cfg.territorySize] ?? 94) * (0.85 + 0.3 * hash(gx, gz, W.salt, 4));
      const cy = Math.floor(-40 + 24 * hash(gx, gz, W.salt, 3));
      h = { id: `${gx}_${gz}`, cx, cy, cz, R, rx: R * 0.33, rz: R * 0.3, ryUp: 15, ryDown: 7, tunnels: [], forced: false };
      h.tunnels = makeTunnels(h, gx, gz);
    }
  }
  cache.set(k, h);
  return h;
}

/** Hollows placed with the admin tool for testing. */
function forcedHollows() {
  const out = [];
  const list = /** @type {any} */ (W).forced || [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    const k = "forced" + i + ":" + f.cx + ":" + f.cz;
    let h = cache.get(k);
    if (!h) {
      const R = f.R;
      h = { id: "f" + Math.floor(f.cx) + "_" + Math.floor(f.cz), cx: f.cx, cy: f.cy, cz: f.cz, R, rx: R * 0.33, rz: R * 0.3,
        ryUp: 15, ryDown: 7, tunnels: [], forced: true };
      h.tunnels = makeTunnels(h, Math.floor(f.cx), Math.floor(f.cz));
      cache.set(k, h);
    }
    out.push(h);
  }
  return out;
}

/** @param {string} id */
export function hollowById(id) {
  if (id.startsWith("f")) return forcedHollows().find((h) => h.id === id) || null;
  const [gx, gz] = id.split("_").map(Number);
  return hollowAt(gx, gz);
}

/** @param {{x:number,y:number,z:number}} loc @param {number} margin */
export function nearbyHollows(loc, margin) {
  const out = [];
  if (!cfg.territory) return out;
  const C = cellSize();
  const gx0 = Math.floor(loc.x / C);
  const gz0 = Math.floor(loc.z / C);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const h = hollowAt(gx0 + dx, gz0 + dz);
      if (h && distXZ(loc, { x: h.cx, y: 0, z: h.cz }) < h.R + margin) out.push(h);
    }
  }
  for (const h of forcedHollows()) if (distXZ(loc, { x: h.cx, y: 0, z: h.cz }) < h.R + margin) out.push(h);
  return out;
}

/** @param {Hollow} h @param {{x:number,y:number,z:number}} loc */
export function strengthIn(h, loc) {
  const d = distXZ(loc, { x: h.cx, y: 0, z: h.cz });
  const dy = loc.y - h.cy;
  const t = Math.max(d / h.R, dy > 0 ? dy / 46 : -dy / 40);
  if (t >= 1) return 0;
  return 1 - smoothstep(0.5, 1.0, t);
}

/** Territory strength at a location (0 = outside, 1 = the heart of the Hollow). @param {{x:number,y:number,z:number}} loc */
export function territoryAt(loc) {
  if (!cfg.territory) return null;
  let best = null;
  for (const h of nearbyHollows(loc, 0)) {
    const s = strengthIn(h, loc);
    if (s > 0 && (!best || s > best.s)) best = { h, s };
  }
  return best;
}

/** @param {{x:number,y:number,z:number}} loc */
export function nearestHollow(loc) {
  const C = cellSize();
  const gx0 = Math.floor(loc.x / C);
  const gz0 = Math.floor(loc.z / C);
  let best = null;
  let bd = Infinity;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      const h = hollowAt(gx0 + dx, gz0 + dz);
      if (!h) continue;
      const d = distXZ(loc, { x: h.cx, y: 0, z: h.cz });
      if (d < bd) { bd = d; best = h; }
    }
  }
  for (const h of forcedHollows()) {
    const d = distXZ(loc, { x: h.cx, y: 0, z: h.cz });
    if (d < bd) { bd = d; best = h; }
  }
  return best;
}

/** Admin/testing: places a hollow centred here. @param {{x:number,y:number,z:number}} loc */
export function forceHollow(loc) {
  const w = /** @type {any} */ (W);
  if (!w.forced) w.forced = [];
  w.forced.push({ cx: Math.floor(loc.x), cy: Math.floor(Math.min(loc.y, 20)), cz: Math.floor(loc.z), R: SIZE_R[cfg.territorySize] ?? 94 });
  if (w.forced.length > 4) w.forced.shift();
  markDirty();
}

// ============================================================================================ generation
/** @type {{hid:string,cx:number,cz:number,d:number}[]} */
const queue = [];
const queued = new Set();
let jobRunning = false;
export const genStats = { chunks: 0, last: 0 };

function chunkCount(h) {
  let n = 0;
  const r = h.R + 12;
  for (let cx = Math.floor((h.cx - r) / 16); cx <= Math.floor((h.cx + r) / 16); cx++) {
    for (let cz = Math.floor((h.cz - r) / 16); cz <= Math.floor((h.cz + r) / 16); cz++) {
      if (Math.hypot(cx * 16 + 8 - h.cx, cz * 16 + 8 - h.cz) <= r) n++;
    }
  }
  return n;
}

/** Called every 40 ticks: queues un-generated territory chunks near players. */
export function genTick() {
  if (!cfg.territory || !cfg.enabled) return;
  for (const pl of world.getAllPlayers()) {
    if (pl.dimension.id !== "minecraft:overworld") continue;
    const loc = pl.location;
    for (const h of nearbyHollows(loc, 90)) {
      const hs = hollowState(h.id);
      if (hs.done) continue;
      if (!hs.total) { hs.total = chunkCount(h); markDirty(); }
      const set = chunkSet(h.id);
      const pcx = Math.floor(loc.x / 16);
      const pcz = Math.floor(loc.z / 16);
      for (let cx = pcx - 4; cx <= pcx + 4; cx++) {
        for (let cz = pcz - 4; cz <= pcz + 4; cz++) {
          if (Math.hypot(cx * 16 + 8 - h.cx, cz * 16 + 8 - h.cz) > h.R + 12) continue;
          const k = cx + "," + cz;
          const qk = h.id + ":" + k;
          if (set.has(k) || queued.has(qk)) continue;
          queued.add(qk);
          queue.push({ hid: h.id, cx, cz, d: Math.hypot(cx * 16 + 8 - loc.x, cz * 16 + 8 - loc.z) });
        }
      }
    }
  }
  if (queue.length > 1) queue.sort((a, b) => a.d - b.d);
  if (!jobRunning && queue.length) {
    jobRunning = true;
    system.runJob(runQueue());
  }
}

function* runQueue() {
  try {
    types();
    while (queue.length) {
      const item = queue.shift();
      if (!item) break;
      queued.delete(item.hid + ":" + item.cx + "," + item.cz);
      const h = hollowById(item.hid);
      if (!h) continue;
      // only generate while some player is still reasonably close (chunk must be loaded)
      let near = false;
      for (const pl of world.getAllPlayers()) {
        if (pl.dimension.id === "minecraft:overworld" && Math.hypot(pl.location.x - (item.cx * 16 + 8), pl.location.z - (item.cz * 16 + 8)) < 110) near = true;
      }
      if (!near) continue;
      yield* processChunk(h, item.cx, item.cz);
      yield;
    }
  } finally {
    jobRunning = false;
  }
}

/** @param {Hollow} h */
function* processChunk(h, cx, cz) {
  const dim = world.getDimension("overworld");
  const x0 = cx * 16;
  const z0 = cz * 16;
  // all four corners must be loaded
  for (const [ox, oz] of [[0, 0], [15, 0], [0, 15], [15, 15]]) {
    if (!getBlock(dim, { x: x0 + ox, y: h.cy, z: z0 + oz })) return;
  }
  const hs = hollowState(h.id);
  const set = chunkSet(h.id);
  let minTop = 320;
  for (const [ox, oz] of [[0, 0], [15, 0], [0, 15], [15, 15], [8, 8]]) {
    try {
      const tb = dim.getTopmostBlock({ x: x0 + ox, z: z0 + oz });
      if (tb) minTop = Math.min(minTop, tb.location.y);
    } catch { /* ignore */ }
  }
  const yMin = Math.max(-60, h.cy - 40);
  const yMax = Math.min(h.cy + 40, minTop - 10);
  let deepDark = false;
  try {
    const bio = dim.getBiome({ x: x0 + 8, y: Math.max(-58, Math.min(h.cy, yMax)), z: z0 + 8 });
    if (bio && bio.id.includes("deep_dark")) deepDark = true;
  } catch { /* ignore */ }
  if (yMax - yMin >= 6 && !deepDark) {
    const ok = yield* carve(dim, h, x0, z0, yMin, yMax);
    if (ok === false) return; // chunk unloaded mid-way: retry later
    yield* infect(dim, h, x0, z0, yMin, yMax);
    yield* decorate(dim, h, hs, x0, z0, yMin, yMax);
  }
  set.add(cx + "," + cz);
  hs.chunks = set.size;
  if (hs.total && set.size >= hs.total) hs.done = true;
  saveChunkSet(h.id);
  markDirty();
  genStats.chunks++;
  genStats.last = now();
  // the Dwelling is built once the 3x3 chunks around the Hollow's centre exist
  if (!hs.built && cfg.dwellings && hooks.buildDwelling) {
    const ccx = Math.floor(h.cx / 16);
    const ccz = Math.floor(h.cz / 16);
    let all = true;
    for (let dx = -1; dx <= 1 && all; dx++) for (let dz = -1; dz <= 1 && all; dz++) if (!set.has((ccx + dx) + "," + (ccz + dz))) all = false;
    if (all) {
      hs.built = true;
      markDirty();
      yield* hooks.buildDwelling(dim, h, hs);
    }
  }
}

function addInterval(list, a, b) {
  if (b >= a) list.push([a, b]);
}

/** @param {import("@minecraft/server").Dimension} dim @param {Hollow} h */
function* carve(dim, h, x0, z0, yMin, yMax) {
  const tun = h.tunnels.filter((t) => t[0] > x0 - 5 && t[0] < x0 + 21 && t[2] > z0 - 5 && t[2] < z0 + 21);
  const inCavern = Math.abs(x0 + 8 - h.cx) < h.rx + 12 && Math.abs(z0 + 8 - h.cz) < h.rz + 12;
  if (!tun.length && !inCavern) return true;
  let n = 0;
  for (let x = x0; x < x0 + 16; x++) {
    for (let z = z0; z < z0 + 16; z++) {
      /** @type {number[][]} */
      const iv = [];
      if (inCavern) {
        const dx = (x + 0.5 - h.cx) / h.rx;
        const dz = (z + 0.5 - h.cz) / h.rz;
        const q = dx * dx + dz * dz;
        if (q < 1) {
          const f = Math.sqrt(1 - q);
          const wob = (hash(x, z, W.salt, 7) - 0.5) * 1.6;
          addInterval(iv, Math.floor(h.cy - h.ryDown * Math.sqrt(f) + wob * 0.4), Math.ceil(h.cy + h.ryUp * f + wob));
        }
      }
      for (const t of tun) {
        const d2 = (x + 0.5 - t[0]) ** 2 + (z + 0.5 - t[2]) ** 2;
        if (d2 < t[3] * t[3]) {
          const hh = Math.sqrt(t[3] * t[3] - d2) * 0.9;
          addInterval(iv, Math.floor(t[1] - hh * 0.7), Math.ceil(t[1] + hh));
        }
      }
      if (!iv.length) continue;
      iv.sort((a, b) => a[0] - b[0]);
      /** @type {number[][]} */
      const merged = [];
      for (const r of iv) {
        const last = merged[merged.length - 1];
        if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
        else merged.push([r[0], r[1]]);
      }
      for (const [a0, b0] of merged) {
        const a = Math.max(a0, yMin, -59);
        const b = Math.min(b0, yMax);
        if (b < a) continue;
        try {
          dim.fillBlocks(new BlockVolume({ x, y: a, z }, { x, y: b, z }), "minecraft:air", { blockFilter: { includeTypes: CARVE_T } });
        } catch {
          return false;
        }
      }
      if (++n % 12 === 0) yield;
    }
  }
  return true;
}

/** @param {import("@minecraft/server").Dimension} dim @param {Hollow} h */
function* infect(dim, h, x0, z0, yMin, yMax) {
  for (let y = Math.floor(yMin / 8) * 8; y <= yMax; y += 8) {
    for (let ox = 0; ox < 16; ox += 8) {
      for (let oz = 0; oz < 16; oz += 8) {
        const c = { x: x0 + ox + 4, y: y + 4, z: z0 + oz + 4 };
        const s = strengthIn(h, c);
        const n = hash(c.x >> 3, c.y >> 3, c.z >> 3, W.salt, 11);
        if (s * 1.2 + (n - 0.5) * 0.6 <= 0.42) continue;
        const a = { x: x0 + ox, y: Math.max(y, yMin), z: z0 + oz };
        const b = { x: x0 + ox + 7, y: Math.min(y + 7, yMax), z: z0 + oz + 7 };
        if (b.y < a.y) continue;
        try {
          const vol = new BlockVolume(a, b);
          dim.fillBlocks(vol, "shaftbreaker:veinstone", { blockFilter: { includeTypes: STONE_T } });
          dim.fillBlocks(vol, "shaftbreaker:deep_veinstone", { blockFilter: { includeTypes: DEEP_T } });
          if (s > 0.5 && hash(c.x, c.y, c.z, W.salt, 12) < 0.3 * s) {
            const fx = a.x + randInt(0, 4);
            const fy = Math.min(b.y, a.y + randInt(0, 4));
            const fz = a.z + randInt(0, 4);
            dim.fillBlocks(new BlockVolume({ x: fx, y: fy, z: fz }, { x: fx + 3, y: Math.min(b.y, fy + 3), z: fz + 3 }),
              "shaftbreaker:fleshstone", { blockFilter: { includeTypes: ["shaftbreaker:veinstone", "shaftbreaker:deep_veinstone"] } });
          }
          if (hash(c.x, c.y, c.z, W.salt, 13) < 0.22 * s) {
            const fx = a.x + randInt(0, 5);
            const fy = Math.min(b.y, a.y + randInt(0, 5));
            const fz = a.z + randInt(0, 5);
            dim.fillBlocks(new BlockVolume({ x: fx, y: fy, z: fz }, { x: fx + 1, y: Math.min(b.y, fy + 2), z: fz + 1 }),
              "shaftbreaker:cracked_veinstone", { blockFilter: { includeTypes: ["shaftbreaker:veinstone"] } });
          }
        } catch {
          return;
        }
        yield;
      }
    }
  }
}

/** @param {import("@minecraft/server").Block} b @param {string} id */
function setType(b, id) {
  try { b.setType(id); return true; } catch { return false; }
}
/** Places a block with states (BlockPermutation.resolve). */
export function placePerm(dim, loc, id, states) {
  const b = getBlock(dim, loc);
  if (!b) return false;
  try {
    b.setPermutation(BlockPermutationResolve(id, states));
    return true;
  } catch {
    return false;
  }
}
export function BlockPermutationResolve(id, states) {
  return BlockPermutation.resolve(id, states);
}

const isAirB = (b) => { try { return !!b && b.isAir; } catch { return false; } };

/** Hanging column (stalactite / vines / tissue) from a ceiling block downwards; never floats. */
export function hang(dim, x, ceilY, z, kind, len) {
  for (let i = 1; i <= len; i++) {
    const b = getBlock(dim, { x, y: ceilY - i, z });
    if (!isAirB(b)) return i - 1;
  }
  for (let i = 1; i <= len; i++) {
    const y = ceilY - i;
    const last = i === len;
    if (kind === "dripfang") {
      const seg = len === 1 ? 2 : i === 1 ? 0 : last ? 2 : 1;
      placePerm(dim, { x, y, z }, "shaftbreaker:dripfang", { "shaftbreaker:segment": seg });
    } else if (kind === "vines") {
      placePerm(dim, { x, y, z }, "shaftbreaker:bloodroot_vines", { "shaftbreaker:end": last });
    } else if (kind === "tissue") {
      placePerm(dim, { x, y, z }, "shaftbreaker:hanging_tissue", { "shaftbreaker:end": last });
    }
  }
  return len;
}

/** @param {import("@minecraft/server").Dimension} dim @param {Hollow} h */
function* decorate(dim, h, hs, x0, z0, yMin, yMax) {
  const s0 = strengthIn(h, { x: x0 + 8, y: h.cy, z: z0 + 8 });
  const cols = Math.round(24 + 56 * Math.max(0.2, s0));
  for (let i = 0; i < cols; i++) {
    const x = x0 + Math.floor(rand() * 16);
    const z = z0 + Math.floor(rand() * 16);
    let prevSolid = solid(getBlock(dim, { x, y: yMax + 1, z }));
    let ceilY = prevSolid ? yMax + 1 : null;
    for (let y = yMax; y >= yMin; y--) {
      const b = getBlock(dim, { x, y, z });
      if (!b) break;
      const isS = solid(b);
      if (!isS && prevSolid) ceilY = y + 1;
      if (isS && !prevSolid) {
        const gap = ceilY !== null ? ceilY - y - 1 : 99;
        guard("decoGap", () => decorateGap(dim, h, hs, x, y, z, ceilY, gap));
        ceilY = null;
      }
      prevSolid = isS;
    }
    yield;
  }
}

function decorateGap(dim, h, hs, x, floorY, z, ceilY, gap) {
  if (gap < 2) return;
  const s = strengthIn(h, { x, y: floorY, z });
  if (s < 0.06) return;
  const floorB = getBlock(dim, { x, y: floorY, z });
  const above = getBlock(dim, { x, y: floorY + 1, z });
  const FULL_OK = (id) => NATURAL.has(id) || id === "shaftbreaker:pulsing_flesh" || id === "shaftbreaker:ribstone" || id === "shaftbreaker:cracked_organ_core";
  if (floorB && above && isAirB(above) && FULL_OK(floorB.typeId)) {
    const fid = floorB.typeId;
    if (NATURAL.has(fid) && rand() < 0.42 * s) {
      setType(floorB, "shaftbreaker:bloodmoss");
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (rand() > 0.5) continue;
        const nb = getBlock(dim, { x: x + dx, y: floorY, z: z + dz });
        const na = getBlock(dim, { x: x + dx, y: floorY + 1, z: z + dz });
        if (nb && na && NATURAL.has(nb.typeId) && isAirB(na)) setType(nb, "shaftbreaker:bloodmoss");
      }
    }
    const r = rand();
    if (r < 0.1 * s) setType(above, "shaftbreaker:bloodmoss_carpet");
    else if (r < 0.15 * s) setType(above, "shaftbreaker:crimson_thorns");
    else if (r < 0.225 * s) setType(above, "shaftbreaker:glowspore_cluster");
    else if (r < 0.25 * s) setType(above, "shaftbreaker:skull_pile");
    else if (r < 0.3 * s) setType(above, "shaftbreaker:dweller_droppings");
    else if (r < 0.312 * s && gap >= 2 && s > 0.25) {
      if (setType(above, "shaftbreaker:watcher_pod")) {
        if (hs.pods.length < 40) hs.pods.push([x, floorY + 1, z]);
        hs.organs++;
      }
    } else if (r < 0.318 * s && s > 0.55) ribArch(dim, x, floorY, z);
  }
  if (ceilY !== null && gap >= 4) {
    const cb = getBlock(dim, { x, y: ceilY, z });
    if (cb && NATURAL.has(cb.typeId)) {
      const r = rand();
      if (r < 0.24 * s) hang(dim, x, ceilY, z, "dripfang", randInt(1, Math.min(4, gap - 3)));
      else if (r < 0.37 * s) hang(dim, x, ceilY, z, "vines", randInt(2, Math.max(2, Math.min(6, gap - 2))));
      else if (r < 0.43 * s && s > 0.4) hang(dim, x, ceilY, z, "tissue", randInt(1, Math.min(3, gap - 2)));
      else if (r < 0.48 * s) setType(cb, "shaftbreaker:cracked_veinstone");
    }
  }
  // wall sample: walk sideways from inside the gap until a wall is hit
  if (rand() < 0.85) {
    const y = floorY + randInt(1, Math.max(1, Math.min(gap, 4)));
    const [dx, dz] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    for (let k = 1; k <= 7; k++) {
      const b = getBlock(dim, { x: x + dx * k, y, z: z + dz * k });
      if (!b) break;
      if (solid(b)) {
        if (NATURAL.has(b.typeId)) decorateWall(dim, h, hs, b, s, dx, dz);
        break;
      }
    }
  }
}

function exposed(dim, x, y, z) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
    if (isAirB(getBlock(dim, { x: x + dx, y: y + dy, z: z + dz }))) return true;
  }
  return false;
}

function decorateWall(dim, h, hs, b, s, dx, dz) {
  const { x, y, z } = b.location;
  const r = rand();
  // perpendicular axis along the wall
  const px = dz !== 0 ? 1 : 0;
  const pz = dx !== 0 ? 1 : 0;
  if (r < 0.06 * s && s > 0.3) {
    if (setType(b, "shaftbreaker:organ_core")) hs.organs++;
    for (const [a, c] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      if (rand() > 0.75) continue;
      const nb = getBlock(dim, { x: x + px * a, y: y + c, z: z + pz * a });
      if (nb && NATURAL.has(nb.typeId) && exposed(dim, nb.location.x, nb.location.y, nb.location.z)) {
        setType(nb, rand() < 0.6 ? "shaftbreaker:pulsing_flesh" : "shaftbreaker:fleshstone");
      }
    }
  } else if (r < 0.17 * s) {
    const n = randInt(2, 4);
    for (let i = 0; i < n; i++) {
      const nb = getBlock(dim, { x, y: y + i, z });
      if (nb && NATURAL.has(nb.typeId)) setType(nb, rand() < 0.55 ? "shaftbreaker:cracked_veinstone" : "shaftbreaker:fleshstone");
    }
  } else if (r < 0.23 * s) {
    const n = randInt(3, 5);
    for (let i = 0; i < n; i++) {
      const nb = getBlock(dim, { x: x + px * i, y, z: z + pz * i });
      if (nb && NATURAL.has(nb.typeId) && exposed(dim, nb.location.x, y, nb.location.z)) setType(nb, "shaftbreaker:ribstone");
    }
  } else if (r < 0.29) {
    if (scorable(b.typeId)) {
      const deep = b.typeId.includes("deep");
      placePerm(dim, b.location, deep ? "shaftbreaker:scored_deepslate" : "shaftbreaker:scored_stone", { "shaftbreaker:pattern": randInt(0, 2) });
    }
  } else if (r < 0.34 * s) {
    for (const [a, c] of [[0, 0], [1, 0], [0, 1]]) {
      const nb = getBlock(dim, { x: x + px * a, y: y + c, z: z + pz * a });
      if (nb && NATURAL.has(nb.typeId)) setType(nb, "shaftbreaker:fleshstone");
    }
  }
}

/** A grounded arch of ribstone over the cave floor (both legs on solid ground, all blocks connected). */
function ribArch(dim, x, floorY, z) {
  const [dx, dz] = pick([[1, 0], [0, 1]]);
  const w = randInt(4, 6);
  const bx = x + dx * w;
  const bz = z + dz * w;
  const ground = getBlock(dim, { x: bx, y: floorY, z: bz });
  if (!solid(ground)) return;
  const plan = [];
  for (let i = 0; i < 3; i++) { plan.push([x, floorY + 1 + i, z]); plan.push([bx, floorY + 1 + i, bz]); }
  for (let i = 0; i <= w; i++) plan.push([x + dx * i, floorY + 4, z + dz * i]);
  for (let i = 1; i < w; i++) if (i >= Math.floor(w / 2) - 1 && i <= Math.ceil(w / 2)) plan.push([x + dx * i, floorY + 5, z + dz * i]);
  for (const [px, py, pz] of plan) if (!isAirB(getBlock(dim, { x: px, y: py, z: pz }))) return;
  // the air above the arch must also be open (so it is in a cavern, not wedged in a tunnel)
  for (const [px, py, pz] of plan) setType(/** @type {any} */ (getBlock(dim, { x: px, y: py, z: pz })), "shaftbreaker:ribstone");
}

// ============================================================================================ territory life
/** Mobs fear the Hollow: natural spawns inside it mostly fail, and wandering mobs are pushed back out. */
world.afterEvents.entitySpawn.subscribe((ev) => {
  if (!cfg.enabled || !cfg.mobFear || !cfg.territory) return;
  guard("mobSpawn", () => {
    if (ev.cause !== EntityInitializationCause.Spawned) return;
    const e = ev.entity;
    if (!alive(e)) return;
    const id = e.typeId;
    if (id.startsWith("shaftbreaker:") || id === "minecraft:player" || id === "minecraft:item" || id === "minecraft:xp_orb") return;
    if (!e.getComponent("minecraft:health")) return;
    if (e.dimension.id !== "minecraft:overworld") return;
    const t = territoryAt(e.location);
    if (!t || t.s < 0.2) return;
    const near = e.dimension.getPlayers({ location: e.location, maxDistance: 12 });
    if (near.length) return;
    if (Math.random() < 0.92 * Math.min(1, t.s * 1.3)) e.remove();
  });
});

/** every 40 ticks */
export function fearTick() {
  if (!cfg.enabled || !cfg.mobFear || !cfg.territory) return;
  const dim = world.getDimension("overworld");
  for (const pl of dim.getPlayers()) {
    const t = territoryAt(pl.location);
    if (!t || t.s < 0.15) continue;
    let mobs = [];
    try {
      mobs = dim.getEntities({ location: pl.location, maxDistance: 40, excludeFamilies: ["player", "shaftbreaker", "grinning_moth", "inanimate", "shaftbreaker_phantom", "shaftbreaker_waypoint", "irongolem"],
        excludeTypes: ["minecraft:item", "minecraft:xp_orb", "minecraft:arrow", "minecraft:iron_golem"] });
    } catch { continue; }
    for (const m of mobs) {
      guard("fear", () => {
        if (!m.getComponent("minecraft:health")) return;
        const tm = m.getComponent("minecraft:tameable");
        if (tm && /** @type {any} */ (tm).isTamed) return;
        if (m.getComponent("minecraft:riding")) return;
        const s = strengthIn(t.h, m.location);
        if (s < 0.25) return;
        const away = flat({ x: m.location.x - t.h.cx, y: 0, z: m.location.z - t.h.cz });
        m.applyImpulse({ x: away.x * 0.18 * s, y: 0.02, z: away.z * 0.18 * s });
      });
    }
  }
}
