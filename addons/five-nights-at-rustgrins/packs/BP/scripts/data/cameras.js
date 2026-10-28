// Security cameras (local coordinates).
//
// One feed at a time: the guard's view is moved to `loc` looking at `look`
// with the minecraft:free camera preset. `sees` lists the route nodes this
// camera is meant to show; tools/validate_map.mjs ray-casts the built voxel
// model to confirm each one is visible. `audioOnly` feeds are black and relay
// nearby sounds instead. `mount` is where the CCTV prop hangs (block cell +
// the direction it faces).

const C = (id, label, room, loc, look, sees, extra = {}) => Object.freeze({
  id, label, room, loc: Object.freeze(loc), look: Object.freeze(look), sees: Object.freeze(sees),
  audioOnly: !!extra.audioOnly, mount: extra.mount ? Object.freeze(extra.mount) : null,
});

export const CAMERAS = Object.freeze([
  C('1A', 'CAM 1A · SHOW STAGE', 'DINING', [38.5, 6.15, 23.5], [38.5, 2.0, 4.5], ['ST_R', 'ST_M', 'ST_N', 'DIN_FRONT']),
  C('1B', 'CAM 1B · DINING AREA', 'DINING', [60.3, 6.15, 36.3], [30.0, 0.5, 12.0], ['DIN_NW', 'DIN_W', 'DIN_C', 'DIN_E', 'DIN_SW', 'DIN_SE', 'DIN_FRONT'], { mount: [60, 6, 37, 'n'] }),
  C('1C', "CAM 1C · KITTY'S CABARET", 'DINING', [25.5, 5.4, 26.5], [14.5, 1.8, 33.5], ['CAB_PEEK', 'CAB_OUT']),
  C('2A', 'CAM 2A · WEST HALL', 'WEST_HALL', [27.5, 4.35, 40.0], [27.5, 1.0, 57.0], ['WH_N', 'WH_M', 'WH_S'], { mount: [27, 4, 39, 's'] }),
  C('2B', 'CAM 2B · W. HALL CORNER', 'W_CORNER', [29.8, 4.35, 59.0], [27.8, 0.8, 66.5], ['WC', 'DOOR_L'], { mount: [29, 4, 58, 's'] }),
  C('3', 'CAM 3 · SUPPLY CLOSET', 'SUPPLY', [19.6, 4.3, 42.0], [23.5, 0.4, 49.0], ['SUP'], { mount: [19, 4, 41, 's'] }),
  C('4A', 'CAM 4A · EAST HALL', 'EAST_HALL', [45.5, 4.35, 40.0], [45.5, 1.0, 57.0], ['EH_N', 'EH_M', 'EH_S'], { mount: [45, 4, 39, 's'] }),
  C('4B', 'CAM 4B · E. HALL CORNER', 'E_CORNER', [42.4, 4.35, 59.0], [45.0, 0.8, 69.0], ['EC', 'NOOK', 'WIN_R', 'DOOR_R'], { mount: [42, 4, 58, 's'] }),
  C('5', 'CAM 5 · BACKSTAGE', 'BACKSTAGE', [12.6, 4.3, 12.6], [3.0, 0.8, 3.0], ['BACK'], { mount: [12, 4, 13, 'n'] }),
  C('6', 'CAM 6 · KITCHEN', 'KITCHEN', [78.5, 4.3, 12.5], [66.0, 0.5, 3.0], ['KIT'], { audioOnly: true, mount: [78, 4, 13, 'n'] }),
  C('7', 'CAM 7 · RESTROOMS', 'RESTROOMS', [63.6, 4.3, 16.0], [65.0, 0.5, 25.0], ['REST'], { mount: [63, 4, 15, 's'] }),
  C('8', 'CAM 8 · MIDNIGHT MIDWAY', 'MIDWAY', [13.4, 4.3, 16.0], [6.0, 0.8, 22.0], ['MW_T', 'MW_P', 'MW_GRATE'], { mount: [13, 4, 15, 's'] }),
  C('9', 'CAM 9 · WEST DUCT', 'DUCT_W', [33.95, 8.45, 49.4], [33.95, 7.3, 62.0], ['WD_4', 'WD_5', 'WD_END']),
  C('10', 'CAM 10 · EAST DUCT', 'DUCT_E', [39.05, 8.45, 49.4], [39.05, 7.3, 62.0], ['ED_4', 'ED_5', 'ED_END']),
]);

export const CAMERA_BY_ID = Object.freeze(Object.fromEntries(CAMERAS.map((c) => [c.id, c])));
export const CAMERA_ORDER = Object.freeze(CAMERAS.map((c) => c.id));
/** node id -> cameras that show it */
export const CAMS_FOR_NODE = Object.freeze(CAMERAS.reduce((m, c) => {
  for (const n of c.sees) (m[n] ??= []).push(c.id);
  return m;
}, {}));
