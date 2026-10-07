// @ts-check
// What players can see. The Observer's rules are built on these checks:
// it avoids being looked at directly, it notices when it has been seen, and it
// prefers positions where it is only partly visible.
import { SEE_THROUGH_RX } from "../core/constants.js";
import { V, safe } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {{x:number,y:number,z:number}} Vec */

/** Degrees from the centre of the player's view to point. @param {Player} p @param {Vec} point */
export function viewAngle(p, point) {
  const eye = p.getHeadLocation();
  return V.angle(p.getViewDirection(), V.sub(point, eye));
}

/**
 * True when nothing opaque lies between a and b. Glass, panes, bars, fences and
 * similar blocks are looked through (the ray restarts past them).
 * @param {Dimension} dim @param {Vec} a @param {Vec} b
 * @returns {{clear:boolean, through:number}} through = see-through blocks crossed (windows)
 */
export function lineOfSight(dim, a, b) {
  let from = a;
  let through = 0;
  for (let hop = 0; hop < 5; hop++) {
    const delta = V.sub(b, from);
    const dist = V.len(delta);
    if (dist < 0.3) return { clear: true, through };
    const dir = V.scale(delta, 1 / dist);
    const hit = safe(() => dim.getBlockFromRay(from, dir, { maxDistance: dist, includeLiquidBlocks: false, includePassableBlocks: false }));
    if (!hit) return { clear: true, through };
    if (!SEE_THROUGH_RX.test(hit.block.typeId)) return { clear: false, through };
    through++;
    // continue just beyond the transparent block along the ray
    const bl = hit.block.location;
    const center = { x: bl.x + 0.5, y: bl.y + 0.5, z: bl.z + 0.5 };
    const along = V.dot(V.sub(center, from), dir) + 0.9;
    from = V.add(from, V.scale(dir, Math.max(along, 0.5)));
  }
  return { clear: false, through };
}

/** Sample points on the Observer's body (feet, chest, head), adjusted for stooping. @param {Vec} feet @param {boolean} stooped */
export function bodyPoints(feet, stooped = false) {
  const h = stooped ? 2.6 : 3.7;
  return [
    { x: feet.x, y: feet.y + 0.6, z: feet.z },
    { x: feet.x, y: feet.y + h * 0.55, z: feet.z },
    { x: feet.x, y: feet.y + h, z: feet.z },
  ];
}

/**
 * How visible a body standing at feet is to a player.
 * @param {Player} p @param {Vec} feet
 * @param {{stooped?:boolean, fov?:number, ignoreView?:boolean, maxDist?:number}} [o]
 * @returns {{points:number, angle:number, dist:number, through:number}}
 *   points = 0..3 body points both inside the view cone (unless ignoreView) and unobstructed.
 */
export function visibility(p, feet, o = {}) {
  const eye = p.getHeadLocation();
  const pts = bodyPoints(feet, o.stooped);
  const angle = V.angle(p.getViewDirection(), V.sub(pts[1], eye));
  const dist = V.dist(eye, pts[1]);
  if (o.maxDist && dist > o.maxDist) return { points: 0, angle, dist, through: 0 };
  const fov = o.fov ?? 62;
  let points = 0;
  let through = 0;
  for (const pt of pts) {
    if (!o.ignoreView && V.angle(p.getViewDirection(), V.sub(pt, eye)) > fov) continue;
    const los = lineOfSight(p.dimension, eye, pt);
    if (los.clear) {
      points++;
      through = Math.max(through, los.through);
    }
  }
  return { points, angle, dist, through };
}

/** Is the player looking at the body (centre of attention, not just in frame)? */
export function isWatching(p, feet, stooped = false, focusDeg = 24) {
  const v = visibility(p, feet, { stooped, fov: focusDeg });
  return v.points > 0;
}

/**
 * Could any of these players see a body at feet right now?
 * @param {Player[]} players @param {Vec} feet @param {boolean} [stooped]
 */
export function seenByAny(players, feet, stooped = false) {
  return players.some((p) => visibility(p, feet, { stooped, fov: 68, maxDist: 160 }).points > 0);
}

/**
 * Accumulates how long a body has been looked at. Call update() every few ticks.
 */
export class GazeTracker {
  /** @param {number} stepTicks */
  constructor(stepTicks = 2) {
    this.step = stepTicks;
    this.seenTicks = 0;      // cumulative focused-look time
    this.visibleTicks = 0;   // cumulative time in frame
    this.streak = 0;         // consecutive focused ticks
    this.firstSeenAt = -1;
    /** @type {Player|undefined} */
    this.lastWatcher = undefined;
  }

  /**
   * @param {Player[]} watchers @param {Vec} feet @param {boolean} stooped @param {number} tick
   * @returns {boolean} focused this update
   */
  update(watchers, feet, stooped, tick) {
    let focused = false;
    let visible = false;
    for (const p of watchers) {
      const v = visibility(p, feet, { stooped, fov: 66, maxDist: 160 });
      if (v.points === 0) continue;
      visible = true;
      if (v.angle < 26) {
        focused = true;
        this.lastWatcher = p;
      }
    }
    if (visible) this.visibleTicks += this.step;
    if (focused) {
      this.seenTicks += this.step;
      this.streak += this.step;
      if (this.firstSeenAt < 0) this.firstSeenAt = tick;
    } else this.streak = 0;
    return focused;
  }
}
