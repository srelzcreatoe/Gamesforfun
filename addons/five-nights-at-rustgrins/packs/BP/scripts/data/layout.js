// FIVE NIGHTS AT RUSTGRIN'S - authoritative map layout (pure data).
//
// Everything is in LOCAL block coordinates: world = local + origin, where the
// origin is chosen when the map is built (stored in the world, see
// mc/persistence.js). +X east, +Z south, -Z north. Players stand at y = 0
// (floor blocks at y = -1). Most rooms are 5 blocks tall (ceiling at y = 5),
// the dining hall 7 (ceiling at y = 7). The crawl ducts run in the attic at
// y 7..8 above the 5-tall rooms (duct floor y = 6, duct top y = 9), the roof
// is y = 10. An exterior brick skin wraps the building one block outside the
// BUILDING box (x -1 / 81, z -1 / 72).
//
// Room boxes are INTERIOR cells [x1, z1, x2, z2] inclusive; walls sit on the
// ring around them (shared between neighbours).

export const BUILDING = Object.freeze({ x1: 0, z1: 0, x2: 80, z2: 71, floorY: -1, roofY: 10 });
/** The whole lot (cleared and rebuilt by /fnar:setup). */
export const LOT = Object.freeze({ x1: -12, z1: -16, x2: 127, z2: 87, groundY: -1, clearTop: 24, baseY: -6 });

/** Chunk-aligned ticking area covering the lot (relative to the origin, rounded outward at build time). */
export const TICK_PAD = 2;

const R = (id, name, box, h, style) => Object.freeze({ id, name, box: Object.freeze(box), h, style });

// style: floor / wall bands / ceiling, resolved in build_plan.js.
export const ROOMS = Object.freeze([
  R('BACKSTAGE', 'Backstage', [1, 1, 13, 13], 5, 'backstage'),
  R('MIDWAY', 'Midnight Midway', [1, 15, 13, 27], 5, 'midway'),
  R('CABARET', "Kitty's Cabaret", [4, 29, 13, 37], 5, 'cabaret'),
  R('DINING', 'Dining Area', [15, 1, 61, 37], 7, 'dining'),
  R('KITCHEN', 'Kitchen', [63, 1, 79, 13], 5, 'kitchen'),
  R('RESTROOMS', 'Restrooms', [63, 15, 66, 25], 5, 'restroom'),
  R('MENS', "Men's Room", [68, 15, 79, 19], 5, 'restroom'),
  R('WOMENS', "Women's Room", [68, 21, 79, 25], 5, 'restroom'),
  R('FOYER', 'Entrance', [63, 27, 79, 41], 5, 'foyer'),
  R('GALLERY', 'Gallery', [1, 39, 16, 50], 5, 'gallery'),
  R('STAFF', 'Staff Room', [1, 52, 16, 70], 5, 'staff'),
  R('SUPPLY', 'Supply Closet', [19, 41, 24, 50], 5, 'supply'),
  R('WEST_HALL', 'West Hall', [26, 39, 28, 57], 5, 'hall'),
  R('W_CORNER', 'W. Hall Corner', [26, 58, 30, 70], 5, 'hall'),
  R('PRIZE', 'Prize Corner', [30, 39, 42, 56], 5, 'prize'),
  R('OFFICE', 'Office', [32, 60, 40, 70], 5, 'office'),
  R('EAST_HALL', 'East Hall', [44, 39, 46, 57], 5, 'hall'),
  R('E_CORNER', 'E. Hall Corner', [42, 58, 46, 70], 5, 'hall'),
  R('PARTS', 'Parts & Service', [48, 43, 79, 70], 5, 'parts'),
]);
export const ROOM_BY_ID = Object.freeze(Object.fromEntries(ROOMS.map((r) => [r.id, r])));

// Openings cut through walls: [x1, y1, z1, x2, y2, z2] inclusive (y in local block rows).
const O = (id, a, b, box, kind = 'arch') => Object.freeze({ id, a, b, box: Object.freeze(box), kind });
export const OPENINGS = Object.freeze([
  O('backstage_door', 'DINING', 'BACKSTAGE', [14, 0, 10, 14, 3, 12], 'door'),
  O('midway_arch', 'DINING', 'MIDWAY', [14, 0, 17, 14, 4, 25]),
  O('cabaret_mouth', 'DINING', 'CABARET', [14, 0, 30, 14, 4, 36], 'curtain'),
  O('west_hall', 'DINING', 'WEST_HALL', [26, 0, 38, 28, 3, 38]),
  O('prize_door', 'DINING', 'PRIZE', [35, 0, 38, 37, 3, 38]),
  O('east_hall', 'DINING', 'EAST_HALL', [44, 0, 38, 46, 3, 38]),
  O('kitchen_door', 'DINING', 'KITCHEN', [62, 0, 9, 62, 3, 11], 'door'),
  O('restroom_door', 'DINING', 'RESTROOMS', [62, 0, 19, 62, 3, 21], 'door'),
  O('mens_door', 'RESTROOMS', 'MENS', [67, 0, 17, 67, 2, 17], 'door'),
  O('womens_door', 'RESTROOMS', 'WOMENS', [67, 0, 23, 67, 2, 23], 'door'),
  O('foyer_arch', 'DINING', 'FOYER', [62, 0, 31, 62, 4, 35]),
  O('front_doors', 'FOYER', 'OUTSIDE', [80, 0, 32, 80, 2, 34], 'glass_door'),
  O('supply_door', 'WEST_HALL', 'SUPPLY', [25, 0, 45, 25, 2, 46], 'door'),
  O('w_corner_link', 'WEST_HALL', 'W_CORNER', [26, 0, 57, 28, 4, 58]),
  O('e_corner_link', 'EAST_HALL', 'E_CORNER', [44, 0, 57, 46, 4, 58]),
  O('parts_door', 'FOYER', 'PARTS', [70, 0, 42, 71, 2, 42], 'door'),
  O('gallery_door', 'STAFF', 'GALLERY', [14, 0, 51, 15, 2, 51], 'door'),
  O('staff_exit', 'STAFF', 'OUTSIDE', [0, 0, 60, 0, 2, 61], 'iron_door'),
]);

// ---------------------------------------------------------------- the office
// The guard faces north towards the desk. Left door/window in the west wall,
// right door/window in the east wall. Door cells are filled with shutter
// blocks by the game when closed (top row first).
export const OFFICE = Object.freeze({
  box: ROOM_BY_ID.OFFICE.box,
  spawn: Object.freeze({ x: 36.5, y: 0, z: 66.5, yaw: 180 }), // facing north
  bounds: Object.freeze({ x1: 32, z1: 60, x2: 41, z2: 71 }), // the guard is kept inside (x2/z2 exclusive)
  doors: Object.freeze({
    L: Object.freeze({ x: 31, z1: 65, z2: 67, y1: 0, y2: 3 }),
    R: Object.freeze({ x: 41, z1: 65, z2: 67, y1: 0, y2: 3 }),
  }),
  windows: Object.freeze({
    L: Object.freeze({ x: 31, z1: 62, z2: 63, y1: 1, y2: 2 }),
    R: Object.freeze({ x: 41, z1: 62, z2: 63, y1: 1, y2: 2 }),
  }),
  // Wall buttons (door above, light below) on the wall south of each door.
  buttons: Object.freeze({
    door_l: Object.freeze({ x: 32, y: 2, z: 68, dir: 'e', kind: 'door_btn' }),
    light_l: Object.freeze({ x: 32, y: 1, z: 68, dir: 'e', kind: 'light_btn' }),
    door_r: Object.freeze({ x: 40, y: 2, z: 68, dir: 'w', kind: 'door_btn' }),
    light_r: Object.freeze({ x: 40, y: 1, z: 68, dir: 'w', kind: 'light_btn' }),
    // the two ceiling-vent covers: buttons on the wall above the desk, labelled by signs below
    vent_l: Object.freeze({ x: 33, y: 2, z: 60, dir: 's', kind: 'light_btn' }),
    vent_r: Object.freeze({ x: 39, y: 2, z: 60, dir: 's', kind: 'light_btn' }),
  }),
  // Ceiling vents (vent_cover blocks in the ceiling row y = 5).
  vents: Object.freeze({
    L: Object.freeze({ x: 33, y: 5, z: 62 }),
    R: Object.freeze({ x: 39, y: 5, z: 62 }),
  }),
  lamp: Object.freeze({ x: 36, y: 5, z: 65 }),
  monitor: Object.freeze({ x: 36, y: 1, z: 60, dir: 's' }),
  phone: Object.freeze({ x: 38, y: 1, z: 60, dir: 's' }),
  // Hall light volumes (invisible light blocks) + the visible lamp outside each door.
  hallLights: Object.freeze({
    L: Object.freeze({ box: Object.freeze([27, 3, 61, 30, 3, 68]), level: 12, lamp: Object.freeze({ x: 29, y: 5, z: 64 }) }),
    R: Object.freeze({ box: Object.freeze([42, 3, 61, 45, 3, 67]), level: 12, lamp: Object.freeze({ x: 43, y: 5, z: 64 }) }),
  }),
});

// ---------------------------------------------------------------- crawl ducts
// Interior air boxes [x1, y1, z1, x2, y2, z2]; ceiling grates connect them to rooms.
export const DUCTS = Object.freeze({
  W: Object.freeze({
    boxes: Object.freeze([[7, 7, 24, 8, 8, 49], [7, 7, 48, 34, 8, 49], [33, 7, 48, 34, 8, 62]]),
    risers: Object.freeze([[7, 6, 24], [33, 6, 62]]), // openings in the duct floor (y 6)
    grate: Object.freeze({ x: 7, y: 5, z: 24, room: 'MIDWAY' }),
    vent: 'L',
  }),
  E: Object.freeze({
    boxes: Object.freeze([[71, 7, 6, 72, 8, 49], [39, 7, 48, 72, 8, 49], [39, 7, 48, 40, 8, 62]]),
    risers: Object.freeze([[71, 6, 6], [39, 6, 62]]),
    grate: Object.freeze({ x: 71, y: 5, z: 6, room: 'KITCHEN' }),
    vent: 'R',
  }),
});

// ---------------------------------------------------------------- stages and props the game animates
export const STAGE = Object.freeze({ box: Object.freeze([24, 1, 52, 8]), topY: 0 }); // stage blocks at y = 0, performers stand at y = 1
export const MIDWAY_RING = Object.freeze({ cx: 6, cz: 21, r: 4, topY: 0 });
export const SHOW_TAPE = Object.freeze({ x: 10, y: 0, z: 26, dir: 'n' }); // on the floor by the Midway's south wall, facing the room
export const CABARET = Object.freeze({
  curtain: Object.freeze({ x: 14, y1: 0, y2: 4, z1: 30, z2: 36 }),
  gap: Object.freeze({ z1: 32, z2: 33, y1: 0, y2: 3 }), // cells opened when the Cat peeks (wider at stage 2)
  outOfOrder: Object.freeze({ x: 15, y: 2, z1: 33, z2: 34, dir: 'e' }),
  stage: Object.freeze([6, 30, 12, 36]),
});

// ---------------------------------------------------------------- the time-clock lobby (staff room)
export const LOBBY = Object.freeze({
  spawn: Object.freeze({ x: 8.5, y: 0, z: 59.5, yaw: 180 }), // facing north, towards the terminal wall
  terminalWallZ: 52, // buttons hang on the north wall (z = 52 interior row, facing south)
});

/**
 * Daytime fill lights (invisible light blocks) for free roam: the tall dining hall,
 * the stage, the Midway, the Cabaret and the halls. [x, y, z, level]; removed at night.
 */
export const DAY_LIGHTS = Object.freeze([
  ...[18, 26, 34, 42, 50, 58].flatMap((x) => [12, 20, 28, 35].map((z) => Object.freeze([x, 4, z, 13]))),
  ...[27, 33, 38, 43, 49].map((x) => Object.freeze([x, 5, 6, 14])),
  Object.freeze([3, 3, 24, 13]), Object.freeze([10, 3, 18, 13]), Object.freeze([9, 3, 31, 12]),
  Object.freeze([27, 3, 45, 12]), Object.freeze([27, 3, 53, 12]), Object.freeze([45, 3, 45, 12]), Object.freeze([45, 3, 53, 12]),
]);

export const SPAWN_OUTSIDE = Object.freeze({ x: 96.5, y: 0, z: 33.5, yaw: 90 }); // parking lot, facing the entrance (west)
