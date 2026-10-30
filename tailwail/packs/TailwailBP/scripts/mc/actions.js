// v3 terrain actions: where it can ambush you (ceiling, corner), the line it runs across
// your view, climbing a wall to reach you, smashing doors and glass, and finding you in a
// hole too low for it.  Everything is bounded: fixed scan sizes, and every controller
// ends itself (done / aborted) within a few seconds.
import { system } from "@minecraft/server";
import { AMBUSH, CHASE, POSTURE } from "../config.js";
import { CLING_HEIGHT } from "../core/ids.js";
import { dirFromYaw, hdist, norm, sub, yawTo } from "../util/vec.js";
import { dlog } from "./log.js";
import { lightAt, losClear, playerView } from "./perception.js";
import { findGround, headroom, isFloor, isOpen, safeBlock } from "./terrain.js";

const DOOR_RE = /(_door|_trapdoor|fence_gate)$/;
const GLASS_RE = /(^minecraft:glass$|^minecraft:glass_pane$|_stained_glass$|_stained_glass_pane$|^minecraft:tinted_glass$)/;
const NEVER = /iron_(door|trapdoor)$/;

/** "door" | "glass" | null for a block id, honouring the breakBlocks setting (1 doors, 2 + glass). */
export function breakableKind(id, level) {
  if (!id || NEVER.test(id) || level <= 0) return null;
  if (DOOR_RE.test(id)) return "door";
  if (level >= 2 && GLASS_RE.test(id)) return "glass";
  return null;
}

function hidden(player, pos) {
  try {
    const eye = player.getHeadLocation();
    const v = player.getViewDirection();
    const to = norm(sub(pos, eye));
    const inFront = to.x * v.x + to.y * v.y + to.z * v.z > 0.25;
    return !inFront || !losClear(player.dimension, eye, pos);
  } catch {
    return true;
  }
}

/** Ceiling spot ahead of / around the player: open air from the floor up to a ceiling 5-10 high. */
export function findCeilingSpot(o) {
  const p = o.player;
  const pl = p.location;
  const view = p.getViewDirection();
  const fwd = yawTo({ x: 0, z: 0 }, { x: view.x, z: view.z });
  let best = null;
  for (let i = 0; i < 18; i++) {
    const yaw = fwd + o.rng.range(-60, 60) + (i >= 12 ? 180 : 0);
    const d = o.rng.range(9, 18);
    const dir = dirFromYaw(yaw);
    const g = findGround(o.dim, pl.x + dir.x * d, pl.z + dir.z * d, pl.y, 4, 6, AMBUSH.clingMinCeiling);
    if (!g) continue;
    const h = headroom(o.dim, g, AMBUSH.clingMaxCeiling + 1);
    if (h < AMBUSH.clingMinCeiling || h > AMBUSH.clingMaxCeiling) continue; // open sky or too low
    const ceil = g.y + h; // first solid block above
    const anchor = { x: g.x, y: ceil - CLING_HEIGHT, z: g.z };
    if (!hidden(p, { x: anchor.x, y: anchor.y + 0.5, z: anchor.z })) continue;
    const light = lightAt(o.dim, { x: g.x, y: ceil - 1, z: g.z });
    if (light > 9) continue;
    const score = o.rng.range(0, 1) + (9 - light) * 0.1 + (i < 12 ? 1 : 0);
    if (!best || score > best.score) best = { ...anchor, floorY: g.y, score };
  }
  return best;
}

/** A dark corner (two or more solid sides) out of view, 10-18 blocks away. */
export function findCornerSpot(o) {
  const p = o.player;
  const pl = p.location;
  let best = null;
  for (let i = 0; i < 16; i++) {
    const yaw = o.rng.range(-180, 180);
    const d = o.rng.range(10, 18);
    const dir = dirFromYaw(yaw);
    const g = findGround(o.dim, pl.x + dir.x * d, pl.z + dir.z * d, pl.y, 4, 6, 3);
    if (!g) continue;
    let walls = 0;
    let wallYaw = null;
    for (const [dx, dz, wy] of [[1, 0, -90], [-1, 0, 90], [0, 1, 0], [0, -1, 180]]) {
      const b = safeBlock(o.dim, { x: Math.floor(g.x) + dx, y: g.y + 1, z: Math.floor(g.z) + dz });
      if (b && !isOpen(b)) {
        walls++;
        wallYaw = wy;
      }
    }
    if (walls < 2) continue;
    if (!hidden(p, { x: g.x, y: g.y + 1.2, z: g.z })) continue;
    const light = lightAt(o.dim, { x: g.x, y: g.y + 1, z: g.z });
    if (light > 7) continue;
    const score = o.rng.range(0, 1) + (7 - light) * 0.15 + walls * 0.2;
    if (!best || score > best.score) best = { ...g, score, faceYaw: wallYaw };
  }
  return best;
}

/** Two ground points on a line across the player's view 20-34 blocks out (the runner). */
export function findCrossPath(o) {
  const p = o.player;
  const pl = p.location;
  const view = p.getViewDirection();
  const fwd = yawTo({ x: 0, z: 0 }, { x: view.x, z: view.z });
  for (let i = 0; i < 8; i++) {
    const d = o.rng.range(20, 34);
    const c = dirFromYaw(fwd + o.rng.range(-20, 20));
    const mid = { x: pl.x + c.x * d, z: pl.z + c.z * d };
    const side = dirFromYaw(fwd + 90 * (o.rng.chance(0.5) ? 1 : -1));
    const half = o.rng.range(10, 15);
    const a = findGround(o.dim, mid.x + side.x * half, mid.z + side.z * half, pl.y, 5, 8, 3);
    const b = findGround(o.dim, mid.x - side.x * half, mid.z - side.z * half, pl.y, 5, 8, 3);
    if (!a || !b || Math.abs(a.y - b.y) > 4) continue;
    const m = findGround(o.dim, mid.x, mid.z, pl.y, 5, 8, 3);
    if (!m) continue;
    if (!losClear(o.dim, p.getHeadLocation(), { x: m.x, y: m.y + 1.5, z: m.z })) continue;
    return { a, b };
  }
  return null;
}

/** The player is in a space too low for it (a 1-high hole or crawl gap). */
export function inLowGap(player) {
  try {
    const l = player.location;
    const dim = player.dimension;
    const feet = safeBlock(dim, { x: Math.floor(l.x), y: Math.floor(l.y + 0.1), z: Math.floor(l.z) });
    const head = safeBlock(dim, { x: Math.floor(l.x), y: Math.floor(l.y + 0.1) + 1, z: Math.floor(l.z) });
    return isOpen(feet) && !!head && !isOpen(head) && !head.isLiquid;
  } catch {
    return false;
  }
}

/** A breakable block between Tailwail and its target within 2.5 blocks, or null. */
export function blockedAhead(tw, target, level) {
  if (level <= 0 || !target) return null;
  try {
    const l = tw.location;
    const t = target.location;
    const dir = norm({ x: t.x - l.x, y: 0, z: t.z - l.z });
    for (const y of [0.5, 1.5]) {
      const from = { x: l.x, y: l.y + y, z: l.z };
      const hit = tw.dimension.getBlockFromRay(from, dir, { maxDistance: 2.5, includeLiquidBlocks: false, includePassableBlocks: true });
      if (!hit) continue;
      const kind = breakableKind(hit.block.typeId, level);
      if (kind) return { kind, loc: hit.block.location };
    }
  } catch {
    /* unloaded */
  }
  return null;
}

/** Hammering a door / window until it gives (hits every 0.45 s, matching the bash clip). */
export class BashController {
  constructor(tw, block, hits, onHit) {
    this.tw = tw;
    this.loc = block.loc;
    this.kind = block.kind;
    this.need = hits;
    this.hits = 0;
    this.active = true;
    this.onHit = onHit;
    this.interval = system.runInterval(() => this.tick(), 9);
  }

  tick() {
    if (!this.active) return;
    if (!this.tw.isValid) return this.stop();
    const dim = this.tw.dimension;
    const b = safeBlock(dim, this.loc);
    if (!b || !breakableKind(b.typeId, 2)) return this.stop(); // already gone (opened / broken by someone)
    this.hits += 1;
    this.onHit(this.kind, this.loc, this.hits >= this.need);
    if (this.hits >= this.need) {
      try {
        const { x, y, z } = this.loc;
        // a door is two blocks: take both halves
        const parts = [this.loc];
        if (this.kind === "door") {
          for (const dy of [1, -1]) {
            const o = safeBlock(dim, { x, y: y + dy, z });
            if (o && o.typeId === b.typeId) parts.push({ x, y: y + dy, z });
          }
        }
        for (const p of parts) dim.runCommand(`setblock ${p.x} ${p.y} ${p.z} air destroy`);
      } catch (e) {
        dlog("bash break", e);
      }
      this.stop();
    }
  }

  stop() {
    this.active = false;
    if (this.interval !== undefined) system.clearRun(this.interval);
    this.interval = undefined;
  }
}

/**
 * Climbs the wall between Tailwail and a target on a ledge above it: gravity off, it is
 * moved up the face a little every tick (CHASE.climbSpeed), then stepped onto the top.
 */
export class ClimbController {
  constructor(tw, setFloat) {
    this.tw = tw;
    this.setFloat = setFloat;
    this.active = false;
    this.interval = undefined;
  }

  /** Plans the climb toward goal; false when there is no climbable face. */
  start(goal) {
    const tw = this.tw;
    const dim = tw.dimension;
    const l = tw.location;
    const yaw = yawTo(l, goal);
    const dir = dirFromYaw(yaw);
    // the wall: first non-open block in the next 2 blocks toward the target, at foot or knee height
    let wall = null;
    for (const k of [0.8, 1.4, 2.0]) {
      for (const dy of [0, 1]) {
        const p = { x: Math.floor(l.x + dir.x * k), y: Math.floor(l.y) + dy, z: Math.floor(l.z + dir.z * k) };
        const b = safeBlock(dim, p);
        if (b && !isOpen(b) && !b.isLiquid) {
          wall = p;
          break;
        }
      }
      if (wall) break;
    }
    if (!wall) return false;
    // the top of that wall: the first y with standing room above a floor block
    let top = null;
    for (let y = wall.y; y <= Math.floor(l.y) + CHASE.climbMaxRise + 1; y++) {
      const here = safeBlock(dim, { x: wall.x, y, z: wall.z });
      const below = safeBlock(dim, { x: wall.x, y: y - 1, z: wall.z });
      if (isOpen(here) && isFloor(below) && headroom(dim, { x: wall.x, y, z: wall.z }, 3) >= 2) {
        top = { x: wall.x + 0.5, y, z: wall.z + 0.5 };
        break;
      }
    }
    if (!top || top.y - l.y < 1.5) return false;
    // the column it climbs in must be open all the way (its crawl box: 2 blocks)
    const col = { x: Math.floor(l.x), z: Math.floor(l.z) };
    for (let y = Math.floor(l.y); y <= top.y + 1; y++) {
      if (!isOpen(safeBlock(dim, { x: col.x, y, z: col.z }))) return false;
    }
    this.top = top;
    this.x = l.x;
    this.z = l.z;
    this.y = l.y;
    this.yaw = yaw;
    this.active = true;
    this.setFloat(true);
    this.interval = system.runInterval(() => this.tick(), 1);
    return true;
  }

  tick() {
    if (!this.active) return;
    if (!this.tw.isValid) return this.abort();
    this.y += CHASE.climbSpeed / 20;
    try {
      if (this.y >= this.top.y + 0.2) {
        this.tw.teleport(this.top, { rotation: { x: 0, y: this.yaw }, checkForBlocks: false });
        this.finish();
        return;
      }
      this.tw.teleport({ x: this.x, y: this.y, z: this.z }, { rotation: { x: 0, y: this.yaw }, checkForBlocks: false });
    } catch (e) {
      dlog("climb", e);
      this.abort();
    }
  }

  finish() {
    this.active = false;
    if (this.interval !== undefined) system.clearRun(this.interval);
    this.interval = undefined;
    this.setFloat(false);
  }

  abort() {
    this.finish();
  }
}

/** True when the player can see the given point (in front and unobstructed). */
export function seenBy(player, pos) {
  return !hidden(player, pos);
}

export { POSTURE, playerView, hdist };
