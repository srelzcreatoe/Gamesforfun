// Security camera definitions (local coordinates).
//
// Only one feed is shown at a time (the player's view is moved to the camera
// with the stable `minecraft:free` camera preset). `sees` lists the route
// nodes the camera is designed to show; tools/validate_map.mjs ray-casts the
// built voxel model to confirm each listed node is actually visible and that
// no unlisted route node is visible (blind spots stay blind).
//
// audioOnly cameras render a black feed and relay nearby audio cues instead.

/** @param {{ audioOnly?: boolean, lostSignalBefore?: number }} [extra] */
const C = (id, label, room, loc, look, sees, extra = {}) =>
  Object.freeze({ id, label, room, loc: Object.freeze(loc), look: Object.freeze(look), sees: Object.freeze(sees), audioOnly: !!extra.audioOnly, lostSignalBefore: extra.lostSignalBefore });

export const CAMERAS = Object.freeze([
  // Ground floor, in walking order: the stage and the rooms west of it, the dining hall, the kitchen and
  // the east side, then round the office (east hall, east corner, the ceiling vent, west corner, west hall)
  // and the supply closet with its duct (cameras near each other have neighbouring numbers since 1.4).
  C('C01', 'CAM 01 · SHOW STAGE', 'STAGE', [100.5, 5.0, 50.5], [100.5, 1.5, 22.5], ['STAGE_F', 'STAGE_B', 'STAGE_C', 'STAGE_FRONT']),
  C('C02', 'CAM 02 · BACKSTAGE', 'BACKSTAGE', [74.5, 4.5, 38.5], [58.5, 0.5, 15.5], ['BACK']),
  C('C03', 'CAM 03 · PARTS & SERVICE', 'PARTS', [50.5, 5.4, 38.5], [22.5, 0.5, 14.5], ['PARTS', 'PARTS_F', 'PARTS_B', 'PARTS_C', 'V_HOME']),
  C('C04', 'CAM 04 · STARLIGHT COVE', 'COVE', [50.5, 2.8, 58.5], [21.5, 1.5, 55.5], ['COVE_FRONT', 'COVE_STAGE']),
  C('C05', 'CAM 05 · ARCADE', 'ARCADE', [50.5, 5.4, 102.5], [24.5, 0.5, 76.5], ['ARCADE']),
  C('C06', 'CAM 06 · DINING HALL WEST', 'DINING', [98.5, 11.0, 98.5], [72.0, 0.0, 66.0], ['DIN_NW', 'DIN_W', 'DIN_C', 'DIN_SW', 'STAGE_B', 'STAGE_F', 'STAGE_FRONT']),
  C('C07', 'CAM 07 · DINING HALL EAST', 'DINING', [102.5, 11.0, 98.5], [140.5, 0.0, 62.5], ['DIN_E', 'DIN_EE', 'DIN_SE', 'STAGE_C']),
  C('C08', 'CAM 08 · KITCHEN (AUDIO ONLY)', 'KITCHEN', [182.5, 4.5, 48.5], [160.5, 0.5, 20.5], ['KIT'], { audioOnly: true }),
  C('C09', 'CAM 09 · EAST SERVICE', 'E_SERVICE', [152.5, 4.6, 63.2], [152.5, 0.5, 99.5], ['ES_N', 'ES_M', 'ES_S', 'EMP']),
  C('C10', 'CAM 10 · EAST HALL', 'E_HALL', [113.5, 4.6, 98.5], [113.5, 0.5, 128.5], ['EH_N', 'EH_M', 'EH_S']),
  C('C11', 'CAM 11 · EAST CORNER', 'E_ALCOVE', [108.5, 4.6, 127.5], [107.5, 0.8, 132.5], ['E_DOOR', 'E_DOOR_B']),
  // The crawlspace above the office, looking along it at the ceiling-vent grate (1.4). No route nodes:
  // Morgrave and Valek use fixed spots there (data/visitors.js).
  C('C12', 'CAM 12 · CEILING VENT', 'CRAWL_UP', [111.5, 9.6, 127.5], [101.5, 7.9, 127.9], []),
  C('C13', 'CAM 13 · WEST CORNER', 'W_ALCOVE', [91.5, 4.6, 127.5], [92.5, 0.8, 132.5], ['W_DOOR']),
  C('C14', 'CAM 14 · WEST HALL', 'W_HALL', [87.5, 4.6, 98.5], [87.5, 0.5, 128.5], ['WH_N', 'WH_M', 'WH_S']),
  C('C15', 'CAM 15 · SUPPLY CLOSET', 'SUPPLY', [82.5, 4.5, 138.5], [76.5, 0.5, 120.5], ['SUP']),
  C('C16', 'CAM 16 · SUPPLY DUCT', 'VENT', [80.5, -2.5, 132.5], [92.5, -2.5, 132.5], ['VENT_W']),
  // Below: the office subfloor, the maintenance tunnel, then the sealed 1983 diner up to Fredbear's chamber.
  C('C17', 'CAM 17 · OFFICE SUBFLOOR', 'SUBFLOOR', [106.5, -6.5, 114.5], [100.0, -8.0, 135.0], ['SUB_N']),
  C('C18', 'CAM 18 · MAINTENANCE TUNNEL', 'TUNNEL_S', [72.5, -4.6, 107.5], [110.5, -9.0, 107.0], ['TS_W', 'TS_MID']),
  C('C19', 'CAM 19 · DINER KITCHEN', 'DINER_KITCHEN', [38.5, -5.0, 110.5], [20.0, -9.0, 98.0], ['DINER_KITCHEN'], { lostSignalBefore: 4 }),
  C('C20', 'CAM 20 · DINER PARTY ROOM', 'DINER', [20.5, -4.6, 60.5], [48.0, -9.0, 88.0], ['DINER_FLOOR', 'DINER_KITCHEN'], { lostSignalBefore: 4 }),
  C('C21', 'CAM 21 · SEALED DINER', 'DINER', [62.5, -4.6, 94.5], [40.5, -8.0, 50.5], ['DINER_STAGE', 'DINER_FLOOR'], { lostSignalBefore: 4 }),
  C('C22', "CAM 22 · FREDBEAR'S CHAMBER", 'CHAMBER', [49.5, -4.8, 42.5], [30.0, -9.0, 35.0], ['CHAMBER_F', 'M_HOME'], { lostSignalBefore: 4 }),
]);

export const CAMERA_BY_ID = Object.freeze(Object.fromEntries(CAMERAS.map((c) => [c.id, c])));
export const CAMERA_ORDER = Object.freeze(CAMERAS.map((c) => c.id));

/**
 * Tabletop camera map on the office console: [column, row] -> button at
 * local (98 + column, 0, 127 + row); north is row 0. Cell [3, 2] is the
 * "YOU ARE HERE" office marker. Column -1 (x 97) holds Fredbear's chamber and
 * the two diner rooms; [5, 2] the subfloor, [6, 1] the supply duct; [6, 2] the ceiling vent (1.4).
 */
export const CAMERA_MAP_LAYOUT = Object.freeze({
  C22: [-1, 0], C03: [0, 0], C02: [1, 0], C01: [2, 0], C06: [3, 0], C08: [4, 0], C09: [5, 0],
  C20: [-1, 1], C04: [0, 1], C05: [1, 1], C14: [2, 1], C07: [3, 1], C10: [4, 1], C18: [5, 1], C16: [6, 1],
  C19: [-1, 2], C21: [0, 2], C15: [1, 2], C13: [2, 2], C11: [4, 2], C17: [5, 2], C12: [6, 2],
});
