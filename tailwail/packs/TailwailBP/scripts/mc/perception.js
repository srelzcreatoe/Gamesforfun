// Visibility in both directions.  "Watching" needs distance, view direction AND an
// unobstructed ray; a player facing Tailwail through a wall is not watching it.
import { POSTURE } from "../config.js";
import { dist, dot, norm, sub } from "../util/vec.js";
import { isSeeThroughId, safeBlock } from "./terrain.js";

let rayCount = 0;
export const takeRayCount = () => {
  const n = rayCount;
  rayCount = 0;
  return n;
};

/** True when nothing opaque lies between a and b.  Glass, bars and fences do not block sight. */
export function losClear(dim, a, b) {
  let from = a;
  for (let hop = 0; hop < 3; hop++) {
    const d = dist(from, b);
    if (d < 0.25) return true;
    const dir = norm(sub(b, from));
    let hit;
    rayCount++;
    try {
      hit = dim.getBlockFromRay(from, dir, { maxDistance: d, includeLiquidBlocks: false, includePassableBlocks: false });
    } catch {
      return false; // unloaded or out of bounds: treat as not visible
    }
    if (!hit) return true;
    if (!isSeeThroughId(hit.block.typeId)) return false;
    const loc = hit.block.location;
    // continue just past the transparent block along the ray
    const centre = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
    const along = dot(sub(centre, from), dir) + 0.9;
    if (along >= d) return true;
    from = { x: from.x + dir.x * along, y: from.y + dir.y * along, z: from.z + dir.z * along };
  }
  return false;
}

export function creatureEyes(tw, posture) {
  const l = tw.location;
  return { x: l.x, y: l.y + POSTURE[posture || "tall"].eye, z: l.z };
}

/** Sample points on Tailwail's body: head, chest, low body (partial sightings count). */
export function bodyPoints(tw, posture) {
  const l = tw.location;
  const h = POSTURE[posture || "tall"].height;
  return [
    { x: l.x, y: l.y + POSTURE[posture || "tall"].eye, z: l.z },
    { x: l.x, y: l.y + h * 0.55, z: l.z },
    { x: l.x, y: l.y + 0.6, z: l.z },
  ];
}

export function lightAt(dim, pos) {
  try {
    return dim.getLightLevel({ x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) });
  } catch {
    return 0;
  }
}

/**
 * How a player sees Tailwail.
 * @returns {{watching:boolean, los:boolean, glance:boolean}}
 *   watching: clearly looking at it (centre of view, unobstructed, lit enough or close)
 *   glance:   within peripheral view and unobstructed
 *   los:      any body point has an unobstructed ray (regardless of facing)
 */
export function playerView(player, tw, posture, opts = {}) {
  const maxDist = opts.maxDist || 56;
  const dim = tw.dimension;
  let eye;
  let view;
  try {
    eye = player.getHeadLocation();
    view = player.getViewDirection();
  } catch {
    return { watching: false, los: false, glance: false };
  }
  const pts = bodyPoints(tw, posture);
  const light = opts.light ?? lightAt(dim, pts[1]);
  let watching = false;
  let glance = false;
  let los = false;
  for (const p of pts) {
    const d = dist(eye, p);
    if (d > maxDist) continue;
    const c = dot(norm(sub(p, eye)), view);
    const centreCos = d < 8 ? 0.7 : 0.82; // wider when it is right in front of you
    const seenEnough = light >= 3 || d <= 18; // a black shape at 40 blocks in total darkness is not "clearly watched"
    if (c < 0.5 && los && !opts.needLos) continue;
    if (!losClear(dim, eye, p)) continue;
    los = true;
    if (c >= 0.5) glance = true;
    if (c >= centreCos && seenEnough) {
      watching = true;
      break;
    }
  }
  return { watching, los, glance };
}

/** Tailwail's own sight of the target: head or torso, unobstructed, within range. */
export function creatureSees(tw, posture, player, range) {
  const eyes = creatureEyes(tw, posture);
  let head;
  try {
    head = player.getHeadLocation();
  } catch {
    return false;
  }
  if (dist(eyes, head) > range) return false;
  const dim = tw.dimension;
  if (!dim.isChunkLoaded(head)) return false;
  if (losClear(dim, eyes, head)) return true;
  const l = player.location;
  return losClear(dim, eyes, { x: l.x, y: l.y + 0.9, z: l.z });
}
