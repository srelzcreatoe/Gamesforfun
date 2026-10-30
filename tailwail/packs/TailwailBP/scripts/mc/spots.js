// Position finding for stalking, stand-off, search, retreat and spawning.
// All searches are bounded (fixed candidate counts, capped flood fill) and only read
// loaded chunks.  Nothing here moves an entity.
import { ENCOUNTER, POSTURE } from "../config.js";
import { dirFromYaw, dist, hdist, norm, sub, yawTo } from "../util/vec.js";
import { lightAt, losClear } from "./perception.js";
import { findGround, isFloor, isOpen, safeBlock } from "./terrain.js";

const eyeAt = (p, posture) => ({ x: p.x, y: p.y + POSTURE[posture].eye, z: p.z });
const midAt = (p, posture) => ({ x: p.x, y: p.y + POSTURE[posture].height * 0.55, z: p.z });

function playerEyes(players) {
  const out = [];
  for (const p of players) {
    try {
      out.push(p.getHeadLocation());
    } catch {
      /* player went invalid */
    }
  }
  return out;
}

function ring(rng, centre, near, far, baseYaw, spread) {
  const yaw = baseYaw + rng.range(-spread, spread);
  const d = rng.range(near, far);
  const dir = dirFromYaw(yaw);
  return { x: centre.x + dir.x * d, z: centre.z + dir.z * d };
}

function postureFor(head) {
  return head >= POSTURE.tall.clearance ? "tall" : head >= POSTURE.hunch.clearance ? "hunch" : "crawl";
}

/**
 * Observation spot around the target.
 * opts: {near, far, visible, partial, headroom, rng, dim, creaturePos, target, players}
 */
export function findObservationSpot(o) {
  const strict = observationPass(o, false);
  if (strict) return strict;
  // fallback tier: no truly hidden spot nearby (open cavern) -> any dim spot outside the
  // target's current field of view, so it still never walks into plain sight
  return o.visible || o.partial ? null : observationPass(o, true);
}

function observationPass(o, relaxed) {
  const tEye = o.target.getHeadLocation();
  const tPos = o.target.location;
  const view = o.target.getViewDirection();
  const baseYaw = yawTo(tPos, o.creaturePos);
  let best = null;
  for (let i = 0; i < 10; i++) {
    const c = ring(o.rng, tPos, o.near, o.far, baseYaw, i < 6 ? 70 : 150);
    const g = findGround(o.dim, c.x, c.z, o.creaturePos.y, 4, 5, o.headroom);
    if (!g) continue;
    if (hdist(g, o.creaturePos) > 18) continue; // short hops through connected space, not across walls
    const posture = postureFor(g.head);
    const eye = eyeAt(g, posture);
    const mid = midAt(g, posture);
    const seenEye = losClear(o.dim, tEye, eye);
    const seenMid = seenEye ? losClear(o.dim, tEye, mid) : losClear(o.dim, tEye, mid);
    let score = o.rng.range(0, 1);
    const light = lightAt(o.dim, mid);
    score += (15 - light) * 0.15;
    // prefer spots it can see from where it stands: almost always reachable by a short walk
    if (!losClear(o.dim, { x: o.creaturePos.x, y: o.creaturePos.y + 1.2, z: o.creaturePos.z }, { x: g.x, y: g.y + 1.2, z: g.z })) score -= 1.5;
    if (o.visible) {
      if (!seenEye && !seenMid) continue;
      if (light > 6) score -= 2;
    } else if (o.partial) {
      // edge spot: hidden body, but a sliver is visible from one side
      if (seenMid) continue;
      const side = sideVisible(o.dim, tEye, g, posture);
      if (!side) score -= 1.5;
      else score += 1.5;
      g.side = side;
    } else if (seenEye || seenMid) {
      if (!relaxed) continue; // must stay out of sight
      const toSpot = norm(sub(mid, tEye));
      if (toSpot.x * view.x + toSpot.y * view.y + toSpot.z * view.z > 0.2) continue; // within ~78 deg of their view
      score -= 1;
    }
    if (hdist(g, tPos) < ENCOUNTER.spawnMinPlayerGap - 4) continue;
    if (!best || score > best.score) best = { ...g, score };
  }
  return best;
}

function sideVisible(dim, tEye, g, posture) {
  const yaw = yawTo(g, tEye);
  const right = dirFromYaw(yaw - 90);
  const mid = midAt(g, posture);
  for (const side of [{ name: "peek_r", k: 1.3 }, { name: "peek_l", k: -1.3 }]) {
    const p = { x: mid.x + right.x * side.k, y: mid.y, z: mid.z + right.z * side.k };
    if (losClear(dim, tEye, p)) return side.name;
  }
  return null;
}

/** In clear view of the target, between min and max blocks, reachable footing. */
export function findStandoffSpot(o) {
  const tEye = o.target.getHeadLocation();
  const tPos = o.target.location;
  const baseYaw = yawTo(tPos, o.creaturePos);
  let best = null;
  for (let i = 0; i < 12; i++) {
    const c = ring(o.rng, tPos, o.min, o.max, baseYaw, i < 8 ? 45 : 120);
    const g = findGround(o.dim, c.x, c.z, tPos.y, 3, 4, Math.max(3, o.headroom || 0));
    if (!g) continue;
    const posture = postureFor(g.head);
    if (!losClear(o.dim, tEye, eyeAt(g, posture))) continue;
    const score = o.rng.range(0, 1) - Math.abs(hdist(g, tPos) - (o.min + o.max) / 2) * 0.2 - hdist(g, o.creaturePos) * 0.03 + g.head * 0.1;
    if (!best || score > best.score) best = { ...g, score };
  }
  return best;
}

/** Away from every player, preferably out of sight. Always returns something walkable-ish. */
export function findRetreatSpot(o) {
  const centre = o.target ? o.target.location : o.creaturePos;
  // when the target stands on top of it, "away" falls back to the direction it is facing
  const away = hdist(centre, o.creaturePos) > 2 ? yawTo(centre, o.creaturePos) : o.facing || 0;
  const eyes = playerEyes(o.players);
  let best = null;
  for (let i = 0; i < 14; i++) {
    // later tries use a shorter band so cramped caves still yield a destination
    const band = i < 8 ? [o.min, o.max] : [Math.min(12, o.min), Math.min(20, o.max)];
    const c = ring(o.rng, i < 8 ? centre : o.creaturePos, band[0], band[1], away, i < 8 ? 65 : 120);
    const g = findGround(o.dim, c.x, c.z, o.creaturePos.y, 5, 6, 2);
    if (!g) continue;
    let score = o.rng.range(0, 1) + (15 - lightAt(o.dim, g)) * 0.1;
    const mid = midAt(g, postureFor(g.head));
    if (eyes.some((e) => losClear(o.dim, e, mid))) score -= 3;
    if (!best || score > best.score) best = { ...g, score };
  }
  if (best) return best;
  // fallback: straight away from the target from where it stands
  const dir = dirFromYaw(away);
  return { x: o.creaturePos.x + dir.x * 12, y: o.creaturePos.y, z: o.creaturePos.z + dir.z * 12, head: 2 };
}

export function findSearchPoints(o) {
  const pts = [];
  for (let i = 0; i < o.n * 3 && pts.length < o.n; i++) {
    const c = ring(o.rng, o.origin, 2, o.radius, o.rng.range(0, 360), 180);
    const g = findGround(o.dim, c.x, c.z, o.origin.y, 3, 4, 2);
    if (g && !pts.some((p) => hdist(p, g) < 2)) pts.push(g);
  }
  if (!pts.length) pts.push({ ...o.origin });
  return pts;
}

/** Nearby hidden spot (corner peek withdrawal). */
export function findCover(o) {
  const tEye = o.target.getHeadLocation();
  let best = null;
  for (let i = 0; i < 8; i++) {
    const c = ring(o.rng, o.creaturePos, 3, 8, o.rng.range(0, 360), 180);
    const g = findGround(o.dim, c.x, c.z, o.creaturePos.y, 3, 4, 3);
    if (!g) continue;
    const posture = postureFor(g.head);
    if (losClear(o.dim, tEye, eyeAt(g, posture)) || losClear(o.dim, tEye, midAt(g, posture))) continue;
    const score = o.rng.range(0, 1) - hdist(g, o.creaturePos) * 0.1;
    if (!best || score > best.score) best = { ...g, score };
  }
  return best;
}

// ------------------------------------------------------------------ spawning

/**
 * Plausible-route check: bounded greedy flood fill over walkable cells (step up/down 1)
 * from `from` until it gets within `goalRadius` of `to`.  Yields periodically so it can
 * run inside system.runJob.  Result is written to out.ok.
 */
export function* routeCheck(dim, from, to, budget, goalRadius, out) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const start = { x: Math.floor(from.x), y: Math.floor(from.y), z: Math.floor(from.z) };
  const open = [start];
  const seen = new Set([key(start.x, start.y, start.z)]);
  let n = 0;
  out.ok = false;
  out.nodes = 0;
  while (open.length && n < budget) {
    // greedy: expand the open node closest to the goal
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < open.length; i++) {
      const d = hdist(open[i], to) + Math.abs(open[i].y - to.y) * 0.5;
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    const cur = open.splice(bi, 1)[0];
    n++;
    if (hdist(cur, to) <= goalRadius && Math.abs(cur.y - Math.floor(to.y)) <= 3) {
      out.ok = true;
      break;
    }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (const dy of [0, 1, -1]) {
        const x = cur.x + dx;
        const y = cur.y + dy;
        const z = cur.z + dz;
        const k = key(x, y, z);
        if (seen.has(k)) continue;
        const floor = safeBlock(dim, { x, y: y - 1, z });
        const feet = safeBlock(dim, { x, y, z });
        const head = safeBlock(dim, { x, y: y + 1, z });
        if (isFloor(floor) && isOpen(feet) && isOpen(head)) {
          if (dy === 1 && !isOpen(safeBlock(dim, { x: cur.x, y: cur.y + 2, z: cur.z }))) continue;
          seen.add(k);
          open.push({ x, y, z });
          break; // one vertical variant per direction
        }
      }
    }
    if (n % 40 === 0) yield;
  }
  out.nodes = n;
}

/**
 * Spawn-site search (generator for system.runJob).
 * o: {dim, player, players, rng, band:[min,max], minHead, maxHead, out}
 * out.result = {x,y,z,head} | null, out.reason = string
 */
export function* spawnSearch(o) {
  const out = o.out;
  out.result = null;
  out.reason = "no-candidate";
  const pPos = o.player.location;
  const view = o.player.getViewDirection();
  const eyes = playerEyes(o.players);
  const tried = [];
  for (let i = 0; i < ENCOUNTER.spawnAttempts; i++) {
    // prefer columns behind or beside the player's facing: never in open view
    const behind = yawTo({ x: 0, z: 0 }, { x: -view.x, z: -view.z });
    const c = ring(o.rng, pPos, o.band[0], o.band[1], behind, i < 14 ? 100 : 180);
    if (!o.dim.isChunkLoaded({ x: c.x, y: pPos.y, z: c.z })) {
      out.reason = "unloaded";
      continue;
    }
    const g = findGround(o.dim, c.x, c.z, pPos.y, 6, 8, o.minHead);
    if (!g) continue;
    if (o.maxHead !== undefined && g.head > o.maxHead) continue;
    if (o.players.some((p) => hdist(p.location, g) < ENCOUNTER.spawnMinPlayerGap)) {
      out.reason = "too-close";
      continue;
    }
    if (Math.abs(g.y - pPos.y) > 10) continue;
    const posture = postureFor(g.head);
    const feetLight = lightAt(o.dim, g);
    const headLight = lightAt(o.dim, eyeAt(g, posture));
    if (Math.max(feetLight, headLight) > ENCOUNTER.spawnMaxLight) {
      out.reason = "too-bright";
      continue;
    }
    const pts = [eyeAt(g, posture), midAt(g, posture), { x: g.x, y: g.y + 0.5, z: g.z }];
    if (eyes.some((e) => pts.some((p) => losClear(o.dim, e, p)))) {
      out.reason = "in-view";
      continue;
    }
    // reject lava within two blocks of the feet
    let lava = false;
    for (let dx = -2; dx <= 2 && !lava; dx++) {
      for (let dz = -2; dz <= 2 && !lava; dz++) {
        const b = safeBlock(o.dim, { x: g.x + dx, y: g.y - 1, z: g.z + dz });
        if (b && b.typeId.includes("lava")) lava = true;
      }
    }
    if (lava) {
      out.reason = "lava";
      continue;
    }
    tried.push(g);
    yield;
    const route = {};
    yield* routeCheck(o.dim, g, pPos, ENCOUNTER.routeNodeBudget, 5, route);
    if (!route.ok) {
      out.reason = "no-route";
      continue;
    }
    out.result = { ...g, posture, light: Math.max(feetLight, headLight), facing: yawTo(g, pPos), dist: dist(g, pPos) };
    out.reason = "ok";
    return;
  }
}

/** Woodland surface encounters (optional): a dark, tree-covered spot at night. */
export function isNightWoodland(dim, player, timeOfDay) {
  const night = timeOfDay > 13000 && timeOfDay < 23000;
  if (!night) return false;
  try {
    const biome = dim.getBiome(player.location).id;
    return /forest|taiga|jungle|grove|woodland|swamp/.test(biome);
  } catch {
    return false;
  }
}

export { norm };
