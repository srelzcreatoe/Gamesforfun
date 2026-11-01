// Security cameras (local coordinates).
//
// One feed at a time: the guard's view is moved to `loc` looking at `look`
// with the minecraft:free camera preset. `sees` lists the route nodes this
// camera is meant to show; tools/validate_map.mjs ray-casts the built voxel
// model to confirm each one is visible. `audioOnly` feeds are black and relay
// nearby sounds instead. `mount` is where the CCTV prop hangs: [x, y, z, dir]
// (a wall mount, its back on the wall behind it) or [x, y, z, dir, 'ceiling']
// (hanging from the ceiling). Every mounted camera's view sits just in front of
// its prop's lens, up near the ceiling: lens = the mount cell's front face,
// 0.35 above the cell floor (wall) or 0.4 above it (ceiling). The two duct
// cameras have no prop.

const C = (id, label, room, loc, look, sees, extra = {}) => Object.freeze({
  id, label, room, loc: Object.freeze(loc), look: Object.freeze(look), sees: Object.freeze(sees),
  audioOnly: !!extra.audioOnly, mount: extra.mount ? Object.freeze(extra.mount) : null,
});

export const CAMERAS = Object.freeze([
  C('1A', 'CAM 1A · SHOW STAGE', 'DINING', [38.5, 6.4, 17.6], [38.5, 1.9, 4.5], ['ST_R', 'ST_M', 'ST_N', 'DIN_FRONT'], { mount: [38, 6, 18, 'n', 'ceiling'] }),
  C('1B', 'CAM 1B · DINING AREA', 'DINING', [60.5, 6.35, 37.0], [46.8, 2.4, 25.0], ['DIN_NW', 'DIN_W', 'DIN_C', 'DIN_E', 'DIN_SW', 'DIN_SE', 'DIN_FRONT'], { mount: [60, 6, 37, 'n'] }),
  // inside the Grand Marquee, high in the corner by the curtains, looking down on his spot and the gap he peeks through
  C('1C', 'CAM 1C · GRAND MARQUEE', 'CABARET', [13.5, 6.35, 30.0], [11.2, 3.05, 34.1], ['CAB', 'CAB_PEEK'], { mount: [13, 6, 29, 's'] }),
  C('2A', 'CAM 2A · WEST HALL', 'WEST_HALL', [27.5, 5.35, 40.0], [27.5, 0.0, 52.0], ['WH_N', 'WH_M', 'WH_S'], { mount: [27, 5, 39, 's'] }),
  C('2B', 'CAM 2B · W. HALL CORNER', 'W_CORNER', [29.5, 5.35, 59.0], [27.8, 0.3, 65.5], ['WC', 'DOOR_L'], { mount: [29, 5, 58, 's'] }),
  C('3', 'CAM 3 · SUPPLY CLOSET', 'SUPPLY', [19.5, 5.35, 42.0], [23.5, 0.4, 49.0], ['SUP'], { mount: [19, 5, 41, 's'] }),
  C('4A', 'CAM 4A · EAST HALL', 'EAST_HALL', [45.5, 5.35, 40.0], [45.5, 0.0, 52.0], ['EH_N', 'EH_M', 'EH_S'], { mount: [45, 5, 39, 's'] }),
  C('4B', 'CAM 4B · E. HALL CORNER', 'E_CORNER', [42.5, 5.35, 59.0], [44.8, 0.0, 67.0], ['EC', 'NOOK', 'WIN_R', 'DOOR_R'], { mount: [42, 5, 58, 's'] }),
  C('5', 'CAM 5 · BACKSTAGE', 'BACKSTAGE', [12.5, 5.35, 13.0], [3.0, 0.8, 3.0], ['BACK'], { mount: [12, 5, 13, 'n'] }),
  C('6', 'CAM 6 · KITCHEN', 'KITCHEN', [78.5, 5.35, 13.0], [66.0, 0.5, 3.0], ['KIT'], { audioOnly: true, mount: [78, 5, 13, 'n'] }),
  C('7', 'CAM 7 · RESTROOMS', 'RESTROOMS', [63.5, 5.35, 16.0], [65.0, 0.5, 25.0], ['REST'], { mount: [63, 5, 15, 's'] }),
  C('8', 'CAM 8 · MIDNIGHT MIDWAY', 'MIDWAY', [13.5, 6.35, 16.0], [6.0, 0.8, 22.0], ['MW_T', 'MW_P', 'MW_GRATE', 'MW_EDGE'], { mount: [13, 6, 15, 's'] }),
  C('9', 'CAM 9 · WEST DUCT', 'DUCT_W', [33.95, 10.45, 49.4], [33.95, 9.3, 62.0], ['WD_4', 'WD_5', 'WD_END']),
  C('10', 'CAM 10 · EAST DUCT', 'DUCT_E', [39.05, 10.45, 49.4], [39.05, 9.3, 62.0], ['ED_4', 'ED_5', 'ED_END']),
]);

export const CAMERA_BY_ID = Object.freeze(Object.fromEntries(CAMERAS.map((c) => [c.id, c])));
export const CAMERA_ORDER = Object.freeze(CAMERAS.map((c) => c.id));
/** node id -> cameras that show it */
export const CAMS_FOR_NODE = Object.freeze(CAMERAS.reduce((m, c) => {
  for (const n of c.sees) (m[n] ??= []).push(c.id);
  return m;
}, {}));
