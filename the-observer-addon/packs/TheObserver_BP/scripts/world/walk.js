// @ts-check
// Walking a creature that is not ours (the animals that sense it, the creatures that answer to it): is the way ahead
// walkable? Shared by observer/animals.js and observer/dominion.js; it depends on nothing but the world, so either can
// load it at any time.
import { safe } from "../core/util.js";

/** @typedef {import("@minecraft/server").Entity} Entity */
/** @typedef {{x:number,y:number,z:number}} Vec */

/** Is the way ahead walkable: no wall it cannot step up, no drop of two or more, no water or lava? @param {Entity} m @param {Vec} dir */
export function clearAhead(m, dir) {
  const dim = m.dimension;
  const l = m.location;
  const x = Math.floor(l.x + dir.x * 0.9), z = Math.floor(l.z + dir.z * 0.9), y = Math.floor(l.y);
  const at = (dy) => safe(() => dim.getBlock({ x, y: y + dy, z }));
  const open = (b) => !!b && (b.isAir || !!safe(() => b.isLiquid === false && /grass|fern|flower|bush|sapling|snow_layer|carpet|torch|button|rail|vine|leaf_litter/.test(b.typeId), false));
  const feet = at(0), head = at(1), below = at(-1), below2 = at(-2);
  if (!feet || !head || feet.isLiquid || below?.isLiquid) return false;
  // a step up is fine; a wall is not
  if (!open(feet) && !open(head)) return false;
  if (!open(feet) && !open(at(2))) return false;
  // a drop of one is fine; two or more is not
  if (open(below) && open(below2)) return false;
  return true;
}
