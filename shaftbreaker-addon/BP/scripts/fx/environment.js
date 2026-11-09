// @ts-check
// Environment manipulation: torches going out, doors opening by themselves, claw marks appearing
// in the rock, sinew sealing the way back, and the creature smashing through stone.
import { world, system, ItemStack } from "@minecraft/server";
import { cfg } from "../core/config.js";
import { getBlock, randInt, rand, pick, dist, guard, now } from "../core/util.js";
import { isTorch, isWoodDoor, scorable, breakable, solid, passable } from "../core/blocks.js";
import { BlockPermutationResolve, territoryAt } from "../world/territory.js";
import { getP } from "../ai/players.js";

/** Remember torches a player places (so we never have to scan for them). */
world.afterEvents.playerPlaceBlock.subscribe((ev) => {
  guard("placeTrack", () => {
    const id = ev.block.typeId;
    const p = getP(ev.player);
    const loc = ev.block.location;
    p.lastPlace = now();
    p.places.push({ x: loc.x, y: loc.y, z: loc.z, t: now() });
    if (p.places.length > 24) p.places.shift();
    if (isTorch(id)) {
      p.torches.push({ x: loc.x, y: loc.y, z: loc.z });
      if (p.torches.length > 64) p.torches.shift();
      if (p.underground) {
        p.torchTimes.push(now());
        p.torchTimes = p.torchTimes.filter((t) => now() - t < 2400);
        p.profile.torch = Math.min(10, p.profile.torch * 0.97 + p.torchTimes.length * 0.05);
        p.profDirty = true;
      }
    }
  });
});

/**
 * Puts out up to n torches near a location (furthest from the player first). The torch item drops,
 * so nothing is lost; only the light is.
 * @param {import("@minecraft/server").Player} pl @param {{x:number,y:number,z:number}} near @param {number} n @param {number} r
 */
export function extinguishTorches(pl, near, n, r) {
  if (cfg.torchMode <= 0) return 0;
  const p = getP(pl);
  const dim = pl.dimension;
  const cands = p.torches.filter((t) => dist(t, near) < r);
  cands.sort((a, b) => dist(b, pl.location) - dist(a, pl.location));
  let done = 0;
  for (const t of cands) {
    if (done >= n) break;
    const b = getBlock(dim, t);
    if (!b) continue;
    let id = "";
    try { id = b.typeId; } catch { continue; }
    if (!isTorch(id)) {
      p.torches = p.torches.filter((o) => o !== t);
      continue;
    }
    const delay = done * randInt(14, 26);
    done++;
    system.runTimeout(() => guard("torchOut", () => {
      const bb = getBlock(dim, t);
      if (!bb || !isTorch(bb.typeId)) return;
      bb.setType("minecraft:air");
      const c = { x: t.x + 0.5, y: t.y + 0.6, z: t.z + 0.5 };
      dim.spawnItem(new ItemStack(id, 1), c);
      dim.playSound("random.fizz", c, { volume: 0.6, pitch: 1.4 });
      try { dim.spawnParticle("minecraft:basic_smoke_particle", c); } catch { /* */ }
    }), delay);
    p.torches = p.torches.filter((o) => o !== t);
  }
  return done;
}

/** Find a wooden door (lower half) within r blocks. @param {import("@minecraft/server").Dimension} dim */
export function findDoor(dim, center, r) {
  const c = { x: Math.floor(center.x), y: Math.floor(center.y), z: Math.floor(center.z) };
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const b = getBlock(dim, { x: c.x + dx, y: c.y + dy, z: c.z + dz });
        if (!b) continue;
        try {
          if (isWoodDoor(b.typeId) && b.permutation.getState(/** @type {any} */ ("upper_block_bit")) === false) return b;
        } catch { /* */ }
      }
    }
  }
  return undefined;
}

/** @param {import("@minecraft/server").Block} b @param {boolean} open */
export function setDoor(b, open) {
  try {
    const cur = b.permutation.getState(/** @type {any} */ ("open_bit"));
    if (cur === open) return false;
    b.setPermutation(b.permutation.withState(/** @type {any} */ ("open_bit"), open));
    const c = { x: b.location.x + 0.5, y: b.location.y + 1, z: b.location.z + 0.5 };
    b.dimension.playSound(open ? "random.door_open" : "random.door_close", c, { volume: 0.9 });
    return true;
  } catch {
    return false;
  }
}

/** Door taunting: opens and closes a door several times, slowly. */
export function tauntDoor(b, times = 4) {
  if (!cfg.doors) return;
  let open = true;
  for (let i = 0; i < times * 2; i++) {
    system.runTimeout(() => guard("taunt", () => { if (b.isValid) setDoor(b, open); open = !open; }), i * randInt(14, 30));
  }
}

/**
 * Claw marks appear on exposed natural stone near a point. Patterns grow more elaborate with encounters.
 * @param {import("@minecraft/server").Dimension} dim @param {{x:number,y:number,z:number}} near
 */
export function scratchWalls(dim, near, count, level) {
  if (!cfg.scratchMarks) return 0;
  let placed = 0;
  for (let i = 0; i < count * 6 && placed < count; i++) {
    const x = Math.floor(near.x) + randInt(-4, 4);
    const y = Math.floor(near.y) + randInt(0, 3);
    const z = Math.floor(near.z) + randInt(-4, 4);
    const b = getBlock(dim, { x, y, z });
    if (!b) continue;
    let id = "";
    try { id = b.typeId; } catch { continue; }
    if (!scorable(id)) continue;
    // must face open air horizontally (a wall)
    let open = false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = getBlock(dim, { x: x + dx, y, z: z + dz });
      if (n && n.isAir) { open = true; break; }
    }
    if (!open) continue;
    const deep = id.includes("deep");
    const lvl = Math.max(0, Math.min(3, level + randInt(-1, 0)));
    try {
      b.setPermutation(BlockPermutationResolve(deep ? "shaftbreaker:scored_deepslate" : "shaftbreaker:scored_stone", { "shaftbreaker:pattern": lvl }));
      placed++;
    } catch { /* */ }
  }
  return placed;
}

/**
 * Seals a 1-wide, 2-high passage behind the player with a sinew membrane (easy to break).
 * Only inside the territory and only into empty air.
 * @param {import("@minecraft/server").Player} pl
 */
export function sealBehind(pl) {
  if (!cfg.pathSealing) return false;
  const t = territoryAt(pl.location);
  if (!t || t.s < 0.3) return false;
  const p = getP(pl);
  const trail = p.breaks.length ? p.breaks : [];
  const dim = pl.dimension;
  const vd = pl.getViewDirection();
  // look back along where the player came from (opposite the view), 8-14 blocks
  for (let i = 0; i < 12; i++) {
    const d = randInt(7, 14);
    const base = { x: Math.floor(pl.location.x - vd.x * d), y: Math.floor(pl.location.y), z: Math.floor(pl.location.z - vd.z * d) };
    for (const dy of [0, -1, 1]) {
      const fy = base.y + dy;
      const f0 = getBlock(dim, { x: base.x, y: fy, z: base.z });
      const f1 = getBlock(dim, { x: base.x, y: fy + 1, z: base.z });
      const g = getBlock(dim, { x: base.x, y: fy - 1, z: base.z });
      const top = getBlock(dim, { x: base.x, y: fy + 2, z: base.z });
      if (!f0 || !f1 || !f0.isAir || !f1.isAir || !solid(g) || !solid(top)) continue;
      const ew = solid(getBlock(dim, { x: base.x + 1, y: fy, z: base.z })) && solid(getBlock(dim, { x: base.x - 1, y: fy, z: base.z }));
      const ns = solid(getBlock(dim, { x: base.x, y: fy, z: base.z + 1 })) && solid(getBlock(dim, { x: base.x, y: fy, z: base.z - 1 }));
      if (!ew && !ns) continue;
      const axis = ew ? 1 : 0;
      try {
        f0.setPermutation(BlockPermutationResolve("shaftbreaker:sinew_membrane", { "shaftbreaker:axis": axis }));
        f1.setPermutation(BlockPermutationResolve("shaftbreaker:sinew_membrane", { "shaftbreaker:axis": axis }));
        dim.playSound("shaftbreaker.block.flesh_break", { x: base.x + 0.5, y: fy + 1, z: base.z + 0.5 }, { volume: 0.5, pitch: 0.6 });
        return true;
      } catch { /* */ }
    }
  }
  void trail;
  return false;
}

/**
 * Smashes blocks between the creature and a goal (feet + head height). Returns blocks broken.
 * @param {import("@minecraft/server").Entity} e @param {{x:number,y:number,z:number}} goal @param {number} mode @param {boolean} crawl
 */
export function smashToward(e, goal, mode, crawl) {
  const dim = e.dimension;
  const l = e.location;
  const dx = goal.x - l.x;
  const dz = goal.z - l.z;
  const ax = Math.abs(dx) > Math.abs(dz);
  const step = { x: ax ? Math.sign(dx) : 0, z: ax ? 0 : Math.sign(dz) };
  const dyGoal = goal.y - l.y;
  const fx = Math.floor(l.x + step.x * 0.9);
  const fz = Math.floor(l.z + step.z * 0.9);
  const fy = Math.floor(l.y + 0.1) + (dyGoal > 1.5 ? 1 : dyGoal < -1.5 ? -1 : 0);
  const heights = crawl ? [0] : [0, 1];
  if (dyGoal > 1.5) heights.push(2);
  let broken = 0;
  for (const h of heights) {
    const b = getBlock(dim, { x: fx, y: fy + h, z: fz });
    if (!b || passable(b)) continue;
    let id = "";
    try { id = b.typeId; } catch { continue; }
    if (!breakable(id, mode)) return -1; // something it won't break (player build / unbreakable): give up this way
  }
  for (const h of heights) {
    const b = getBlock(dim, { x: fx, y: fy + h, z: fz });
    if (!b || passable(b)) continue;
    try {
      dim.runCommand(`setblock ${fx} ${fy + h} ${fz} air destroy`);
      broken++;
    } catch { /* */ }
  }
  if (broken) {
    const c = { x: fx + 0.5, y: fy + 1, z: fz + 0.5 };
    dim.playSound("shaftbreaker.smash", c, { volume: 1.0 });
    try { dim.spawnParticle("shaftbreaker:debris", c); } catch { /* */ }
  }
  return broken;
}

/** Dust trickles from the ceiling near a point (rubble warning; never drops blocks). */
export function dustFall(dim, near, n = 3) {
  if (cfg.reducedParticles) n = 1;
  for (let i = 0; i < n; i++) {
    const x = near.x + randInt(-4, 4);
    const z = near.z + randInt(-4, 4);
    for (let y = Math.floor(near.y) + 1; y < Math.floor(near.y) + 8; y++) {
      const b = getBlock(dim, { x, y, z });
      if (solid(b)) {
        try { dim.spawnParticle("shaftbreaker:dust_fall", { x: x + 0.5, y: y - 0.05, z: z + 0.5 }); } catch { /* */ }
        break;
      }
    }
  }
}

export { rand, pick };
