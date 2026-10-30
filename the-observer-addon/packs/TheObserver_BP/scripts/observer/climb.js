// @ts-check
// Climbing: going up does not get you away from it. When the player it is after stands 2.5+ blocks
// above it and close by — on a pillar, a ledge, a wall top, a ladder, a cliff — it goes to the open
// face beside them and climbs it (about 4 blocks a second, the climb animation, staring up at them):
//   * at an edge (a pillar, the lip of a cliff, a ladder) it clings just below them, close enough to strike
//   * further back on a plateau, it climbs the nearest face toward them, pulls itself over the top and
//     comes on across it
// It only climbs open faces: every cell its body passes through must be empty, so a roof, an overhang
// or a sealed tower stops it. If the player comes down or moves off, it lets go and drops.
import * as body from "./body.js";
import { V, safe, emit } from "../core/util.js";
import { SOUNDS } from "../core/constants.js";
import { isReplaceable, standAt, standNear } from "../world/space.js";

/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {{x:number,y:number,z:number}} Vec */
/** @typedef {import("../director/encounter.js").Encounter} Encounter */

const RISE = 2.5;   // blocks above it before it climbs
const NEAR = 7;     // horizontal blocks from the player within which it climbs
const SPEED = 0.4;  // blocks per 2 ticks (4 b/s)
const BODY = 3;     // cells its body needs, feet upward
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** @param {Dimension} dim @param {number} x @param {number} y @param {number} z */
const open = (dim, x, y, z) => isReplaceable(safe(() => dim.getBlock({ x, y, z })));
/** Room for its body with the feet at y in column (x,z). */
function fits(dim, x, y, z) {
  for (let h = 0; h < BODY; h++) if (!open(dim, x, Math.floor(y) + h, z)) return false;
  return true;
}

/** Open all the way up the face from y0 to y1 (its whole body at every height). */
function pathOpen(dim, x, z, y0, y1) {
  for (let y = Math.floor(Math.min(y0, y1)); y <= Math.floor(Math.max(y0, y1)); y++) if (!fits(dim, x, y, z)) return false;
  return fits(dim, x, y1, z);
}

/** Is the player out of its reach above it (and close enough for it to climb after)? @param {Encounter} enc */
export function needed(enc) {
  const l = body.loc();
  const p = enc.p;
  if (!l || !p.isValid || p.dimension.id !== enc.dimId) return false;
  if (safe(() => p.isFlying, false)) return false;
  return p.location.y - l.y >= RISE && V.hdist(l, p.location) <= NEAR;
}

/**
 * Where to climb: the player's own column if it has an open face (cling below them), otherwise the
 * nearest edge between the player and it (climb over the top onto it).
 * @param {Dimension} dim @param {Player} p @param {Vec} from where it is now
 * @returns {{col:{x:number,z:number}, y:number, top?:Vec, cling:boolean}|undefined}
 */
export function plan(dim, p, from) {
  const px = Math.floor(p.location.x), pz = Math.floor(p.location.z), py = p.location.y;
  const byDist = (cx, cz) => DIRS.map(([dx, dz]) => ({ x: cx + dx, z: cz + dz }))
    .sort((a, b) => Math.hypot(a.x + 0.5 - from.x, a.z + 0.5 - from.z) - Math.hypot(b.x + 0.5 - from.x, b.z + 0.5 - from.z));
  // an edge right at the player: hang just below them, beside them
  for (const c of byDist(px, pz)) {
    const y = py - 1.5;
    if (pathOpen(dim, c.x, c.z, Math.max(from.y, y - 12), y)) return { col: c, y, cling: true };
  }
  // back from the edge: walk the line from the player toward it and find the first lip
  const dir = V.flat(V.sub(from, p.location));
  for (let i = 1; i <= NEAR; i++) {
    const tx = Math.floor(p.location.x + dir.x * i), tz = Math.floor(p.location.z + dir.z * i);
    const top = standAt(dim, tx + 0.5, tz + 0.5, py + 1.5, 3);
    if (!top || Math.abs(top.loc.y - py) > 1.1) continue;
    for (const c of byDist(tx, tz)) {
      const cy = top.loc.y - 1.5;
      if (open(dim, c.x, Math.floor(top.loc.y) - 1, c.z) && pathOpen(dim, c.x, c.z, Math.max(from.y, cy - 12), cy)) {
        return { col: c, y: cy, top: top.loc, cling: false };
      }
    }
  }
  return undefined;
}

/**
 * Climb after the player: called while needed(enc) (or while clinging). Returns true when it is now
 * clinging beside them or over the top; false if there is nothing it can climb (or it let go).
 * @param {Encounter} enc @param {{state?:string}} [o] the state to resume after pulling itself over the top
 */
export async function after(enc, o = {}) {
  const b = body.get();
  const p = enc.p;
  if (!b) return false;
  const dim = enc.dim;
  if (!needed(enc)) {
    if (b.clinging) letGo(enc);
    return false;
  }
  const from = b.e.location;
  const route = plan(dim, p, from);
  if (!route) {
    if (b.clinging) letGo(enc);
    return false;
  }
  const cx = route.col.x + 0.5, cz = route.col.z + 0.5;
  // face the wall it climbs (the player's column, or the lip it goes over)
  const wall = route.top ?? { x: Math.floor(p.location.x) + 0.5, y: p.location.y, z: Math.floor(p.location.z) + 0.5 };
  body.setMode("still");
  b.faceTarget = false;
  b.autoPeek = false;
  body.setSilent(true);
  body.setState("climb");
  if (!b.clinging) enc.emit("climb", { what: "start", cling: route.cling, height: route.y - from.y });
  b.clinging = true;
  let pos = { x: from.x, y: from.y, z: from.z };
  const face = (y) => ({ x: wall.x, y: y + 2, z: wall.z });
  // across to the foot of the face (it is usually already there)
  for (let i = 0; i < 12 && V.hdist(pos, { x: cx, y: 0, z: cz }) > 0.2; i++) {
    const step = Math.min(SPEED, V.hdist(pos, { x: cx, y: 0, z: cz }));
    const d = V.flat(V.sub({ x: cx, y: pos.y, z: cz }, pos));
    const next = { x: pos.x + d.x * step, y: pos.y, z: pos.z + d.z * step };
    if (!fits(dim, Math.floor(next.x), next.y, Math.floor(next.z))) break;
    pos = next;
    body.moveTo(pos, face(pos.y));
    await enc.wait(2);
  }
  pos = { x: cx, y: pos.y, z: cz };
  // up (or down, if the player stepped lower while it hung there)
  let n = 0;
  while (Math.abs(pos.y - route.y) > 0.05) {
    const dy = Math.max(-SPEED, Math.min(SPEED, route.y - pos.y));
    const next = { x: cx, y: pos.y + dy, z: cz };
    if (!fits(dim, route.col.x, next.y, route.col.z)) {
      enc.emit("climb", { what: "blocked" });
      letGo(enc);
      return false;
    }
    pos = next;
    body.moveTo(pos, face(pos.y));
    if (n++ % 3 === 0) enc.worldSound(SOUNDS.turn, pos, 0.5, 0.8 + Math.random() * 0.3);
    await enc.wait(2);
    if (!p.isValid || V.hdist(pos, p.location) > NEAR + 2) {
      letGo(enc);
      return false;
    }
  }
  if (route.cling) {
    body.faceTo(p.getHeadLocation());
    if (!b.hung) enc.emit("climb", { what: "cling", y: pos.y });
    b.hung = true;
    await enc.wait(2);
    return true;
  }
  // over the top and on across the plateau
  const top = route.top ?? pos;
  body.moveTo(top, p.getHeadLocation());
  b.clinging = false;
  b.hung = false;
  body.setState(o.state ?? "run");
  enc.emit("climb", { what: "over", x: top.x, y: top.y, z: top.z });
  return true;
}

/** Let go of the wall and drop to the ground below. @param {Encounter} enc */
export function letGo(enc) {
  const b = body.get();
  if (!b || !b.clinging) return;
  b.clinging = false;
  b.hung = false;
  const l = b.e.location;
  const g = standNear(enc.dim, l.x, l.z, l.y - 1) ?? standAt(enc.dim, l.x, l.z, l.y, 24);
  if (g) body.moveTo(g.loc, enc.p.isValid ? enc.p.getHeadLocation() : undefined);
  emit("climb", { enc: enc.id, what: "let_go" });
}
