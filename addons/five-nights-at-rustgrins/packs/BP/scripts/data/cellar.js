// THE CELLAR under the pizzeria, and the Golden Dog who lives in it (pure data, local coordinates like
// layout.js: world = local + origin, +X east, +Z south, players stand at y = 0 upstairs).
//
// This file is the CONTRACT between the map (data/build_plan.js builds what is described here), the game
// (core/ai/golden_dog.js decides, mc/golden.js renders) and the tools. See docs/GOLDEN_DOG.md.
//
// Down here you stand at y = -7 (floor blocks at y = -8); the rooms are 5 tall (air y -7..-3, ceiling
// y = -2), and the pizzeria's own floor (y = -1) lies on top. The lot is dug and filled down to y = -9.
//
//   GOLD ROOM     the supper theatre the Revue was built on top of. Its little stage is at the north end;
//                 the Golden Dog stands on it (CEL_STAGE), facing south down the middle aisle.
//   LONG HALL     three wide, from the Gold Room's south doorway straight to ...
//   OTHER OFFICE  ... the security office again: the same room, cell for cell, 7 blocks below the real one,
//                 but old. There is no wall behind its desk any more: from the seat you look over the desk,
//                 down the Long Hall and across the Gold Room, straight at the stage.
//
// The middle aisle (x 35..37) is kept clear from the stage to the desk: it is the line he walks, and the line
// the guard sees him on.

import { OFFICE } from './layout.js';

/** true since data/cellar_plan.js builds the cellar (map version 13): tools/map/validate_map.mjs checks its camera, nodes, aisle, sight line and walkways. */
export const CELLAR_BUILT = true;

const OFFSET = Object.freeze({ x: 0, y: -7, z: 0 });
const down = (p) => Object.freeze({ ...p, x: p.x + OFFSET.x, y: p.y + OFFSET.y, z: p.z + OFFSET.z });

export const CELLAR = Object.freeze({
  /** feet level, floor blocks, ceiling blocks, the deepest layer the lot touches */
  standY: -7, floorY: -8, ceilY: -2, baseY: -9,
  /** interior boxes [x1, z1, x2, z2] (inclusive), every one 5 tall (y -7..-3) */
  rooms: Object.freeze({
    GOLD_ROOM: Object.freeze([26, 16, 46, 38]),
    LONG_HALL: Object.freeze([35, 40, 37, 59]),
    OTHER_OFFICE: OFFICE.box, // [32, 60, 40, 70]
  }),
  /** the doorway from the Gold Room into the Long Hall, and the missing wall behind the Other Office's desk: [x1, y1, z1, x2, y2, z2] */
  openings: Object.freeze({
    hall_mouth: Object.freeze([35, -7, 39, 37, -3, 39]),
    desk_gap: Object.freeze([35, -7, 59, 37, -3, 59]),
  }),
  /** the aisle that stays clear of everything from the stage to the desk */
  aisle: Object.freeze({ x1: 35, x2: 37, z1: 19, z2: 59 }),
  /** The Other Office: every cell of the real office, moved by `offset`. */
  otherOffice: Object.freeze({
    offset: OFFSET,
    spawn: down(OFFICE.spawn), // the seat, facing the desk (north)
    bounds: Object.freeze({ ...OFFICE.bounds }), // x/z as upstairs
    phone: down(OFFICE.phone), // the way back: it rings, you pick it up
  }),
  /** the camera in the Gold Room */
  cam: '11',
  /** where he stands on his stage, and the nodes he walks from it to the Other Office's desk (in order) */
  stage: 'CEL_STAGE',
  walk: Object.freeze(['CEL_STAGE', 'CEL_PIT', 'CEL_HALL_N', 'CEL_HALL_M', 'CEL_HALL_S', 'CEL_DESK']),
  /** where he stands when he visits the real office: behind the seat, between the doors, facing the guard's back */
  visit: 'OFF_GOLD',
  /**
   * "Gilding": cells upstairs that change while he bends the place (a poster that is his poster for a few
   * seconds, a drawing of a big yellow dog, paw prints on a hall floor). { x, y, z, key } with `key` a
   * palette key; the game puts each one down for a moment and then puts back what was built there.
   * `where`: 'office' (seen from the seat) or 'hall' (seen on a camera). Filled in by the map.
   */
  gild: Object.freeze([]),
});
