// @ts-check
// E11 "The Path Changed" — on a route the player has walked several times, a few carefully chosen
// alterations are made behind them, out of sight, so the way back is no longer the way they know:
// the tunnel they just came through now ends in a wall of the same stone, or a low wall of local
// blocks stands across the path; a door along the way has changed; at the Unsettling level a new
// opening appears in a nearby wall. It watches from the side for a while. Mimic blocks drop
// nothing when mined. Everything reverts a few minutes after the encounter.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { corridorBehind, findSpot, isReplaceable } from "../world/space.js";
import { findBlocks, OPENABLE, manip, surroundingNatural } from "../world/manipulate.js";
import { NATURAL } from "../core/constants.js";
import { viewAngle } from "../world/sight.js";
import { sighting, travelDir } from "./common.js";

/** @typedef {{x:number,y:number,z:number}} Vec */

/** A low wall (1-2 high, up to 3 wide) across the path at dist along dir on open ground. */
function wallAt(dim, p, dir, dist) {
  const base = V.add(p.location, V.scale(dir, dist));
  const side = { x: -dir.z, y: 0, z: dir.x };
  const cells = [];
  for (const s of [-1, 0, 1]) {
    const col = V.floor(V.add(base, V.scale(side, s)));
    const ground = safe(() => dim.getBlockBelow({ x: col.x + 0.5, y: col.y + 3, z: col.z + 0.5 }, { includePassableBlocks: false, maxDistance: 7 }));
    if (!ground) continue;
    for (const h of [1, 2]) {
      const c = { x: ground.location.x, y: ground.location.y + h, z: ground.location.z };
      if (isReplaceable(safe(() => dim.getBlock(c)))) cells.push(c);
    }
  }
  return cells;
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const isNatural = (dim, l) => NATURAL.has(safe(() => dim.getBlock(l)?.typeId) ?? "");
const isOpen = (dim, l) => isReplaceable(safe(() => dim.getBlock(l)));

/**
 * A new opening in a natural wall beside the path: a wall face at feet and head height that faces
 * open space, 4-10 blocks away and out of view, carved two blocks deep (never a pit in the floor).
 * @returns {Vec[]|undefined}
 */
function carveCandidate(dim, p) {
  const fy = Math.floor(p.location.y);
  const blocks = findBlocks(dim, { x: p.location.x, y: fy + 0.5, z: p.location.z }, 10, 0, NATURAL, 200);
  for (const b of blocks) {
    const d = V.dist({ x: b.x + 0.5, y: b.y, z: b.z + 0.5 }, p.location);
    if (d < 4 || d > 10) continue;
    const above = { x: b.x, y: b.y + 1, z: b.z };
    if (!isNatural(dim, above)) continue;
    // must stand on solid ground and face open space at both heights
    if (isOpen(dim, { x: b.x, y: b.y - 1, z: b.z })) continue;
    const face = SIDES.find(([dx, dz]) => isOpen(dim, { x: b.x + dx, y: b.y, z: b.z + dz }) && isOpen(dim, { x: b.x + dx, y: b.y + 1, z: b.z + dz }));
    if (!face) continue;
    if (viewAngle(p, { x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 }) < 80) continue;
    const cells = [b, above];
    const deep = { x: b.x - face[0], y: b.y, z: b.z - face[1] };
    if (isNatural(dim, deep) && isNatural(dim, { x: deep.x, y: deep.y + 1, z: deep.z })) cells.push(deep, { x: deep.x, y: deep.y + 1, z: deep.z });
    return cells;
  }
  return undefined;
}

register({
  id: "unfamiliar_route",
  tier: 2,
  minStage: 3,
  needsBody: true,
  minManip: 2,
  cooldown: 1200,
  weight(c) {
    if (c.water || c.gliding || !c.moving || c.familiarity < 3) return 0;
    return 6 + Math.min(6, c.familiarity);
  },
  prepare(enc) {
    const p = enc.p;
    const dir = travelDir(p);
    enc.data.dir = dir;
    // the way they came: a tunnel cross-section 8-14 blocks back, or a low wall on open ground
    const tunnel = corridorBehind(p, dir, 8, 14);
    enc.data.cells = tunnel ? tunnel.cells : wallAt(enc.dim, p, V.scale(dir, -1), 10 + Math.random() * 4);
    enc.data.kind = tunnel ? "tunnel" : "wall";
    return enc.data.cells.length > 0;
  },
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    const { dir, cells, kind } = enc.data;
    // only alter what the player is not looking at
    const center = cells[Math.floor(cells.length / 2)];
    const ok = await enc.until(() => viewAngle(p, { x: center.x + 0.5, y: center.y + 0.5, z: center.z + 0.5 }) > 85, 200, 4);
    if (!ok) return enc.result("watched");
    const type = surroundingNatural(dim, center, 3) ?? (enc.ctx.d === 1 ? "minecraft:netherrack" : "minecraft:stone");
    const n = enc.mimic(cells, 8 * 60, type);
    if (n === 0) return enc.result("blocked");
    const changes = [{ x: center.x + 0.5, y: center.y + 0.5, z: center.z + 0.5 }];
    // a door along the way back changes too
    const doors = findBlocks(dim, V.add(p.location, V.scale(dir, -8)), 10, 3, OPENABLE, 4);
    for (const d of doors) if (viewAngle(p, { x: d.x + 0.5, y: d.y + 1, z: d.z + 0.5 }) > 85 && enc.toggle(d, 8 * 60) !== undefined) {
      changes.push({ x: d.x + 0.5, y: d.y + 1, z: d.z + 0.5 });
      break;
    }
    if (manip() >= 3) {
      const cv = carveCandidate(dim, p);
      if (cv && enc.carve(cv, 8 * 60) > 0) changes.push({ x: cv[0].x + 0.5, y: cv[0].y + 1, z: cv[0].z + 0.5 });
    }
    enc.log(`${kind}: ${n} mimic blocks of ${type}, ${changes.length - 1} extra changes`);
    // it watches from the side
    const spot = findSpot(p, { minDist: 16, maxDist: 26, bearings: [90, -90], spread: 30, concealment: "partial", needLOS: true, hideFrom: enc.witnesses() });
    if (spot) enc.spawnBody(spot.loc, { state: "peek", stoop: spot.stoop, side: spot.side });
    let look = 0;
    for (let t = 0; t < 20 * 150; t += 4) {
      if (t === 20 * 60 && body.get() && !body.visibleTo(enc.watchers())) body.despawn("moved_on");
      await enc.wait(4);
      const mined = enc.released.some((r) => r.kind === "mimic" && r.how === "broken");
      for (const c of changes) if (V.dist(p.location, c) < 7 && viewAngle(p, c) < 20) look += 4;
      if (mined || look >= 24) {
        enc.result(mined ? "dug_through" : "noticed_change", true);
        enc.discover("wrong_way");
        enc.sound(SOUNDS.fabric, spot ? spot.loc : center, 0.4);
        break;
      }
      if (body.get()) {
        enc.updateGaze();
        if (enc.gaze.seenTicks >= 14) {
          sighting(enc, enc.gaze.lastWatcher ?? p);
          break;
        }
      }
      if (V.dist(p.location, center) > 64) break;
    }
    if (!enc.noticed) enc.result("passed_by");
    // revert once the player has moved on (or a few minutes at most)
    enc.restoreDelay = 150;
  },
});
