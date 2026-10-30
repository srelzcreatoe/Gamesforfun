// Route graph for the animatronics (local coordinates; y = feet).
//
// Nodes are the places an animatronic can stop (each is shown by at least one
// camera, see cameras.js `sees`, except the stage-side ones that are seen
// from the office). Edges carry the waypoints walked between two nodes so
// nobody walks through a table or a wall; tools/validate_map.mjs checks every
// segment against the built voxel model (feet and head clear of solid blocks,
// ducts excepted where the pose is a crawl).
//
// yaw: Minecraft convention, 0 = facing south (+Z), 90 = west, 180 = north, -90 = east.

const N = (id, x, y, z, yaw, extra = {}) => Object.freeze({ id, x, y, z, yaw, ...extra });

export const NODES = Object.freeze(Object.fromEntries([
  // stage (performers stand on the 1-block stage)
  N('ST_R', 38.5, 1, 4.5, 0, { pose: 'stage' }),
  N('ST_M', 32.5, 1, 5.5, 0, { pose: 'stage' }),
  N('ST_N', 44.5, 1, 5.5, 0, { pose: 'stage' }),
  // dining area
  N('DIN_FRONT', 38.5, 0, 11.0, 0),
  N('DIN_NW', 19.5, 0, 11.5, -90),
  N('DIN_W', 20.5, 0, 23.5, 135),
  N('DIN_C', 40.0, 0, 22.5, 0),
  N('DIN_E', 52.5, 0, 13.0, 90),
  N('DIN_SW', 28.5, 0, 33.5, 0),
  N('DIN_SE', 45.5, 0, 35.0, 0),
  N('DIN_CAB', 18.0, 0, 33.5, -90),
  // west side
  N('BACK', 6.5, 0, 7.5, 45),
  N('WH_N', 27.5, 0, 44.0, 0),
  N('WH_M', 27.5, 0, 48.5, 0),
  N('WH_S', 27.5, 0, 55.0, 0),
  N('SUP', 21.5, 0, 47.5, -90),
  N('WC', 28.0, 0, 61.5, 0),
  N('DOOR_L', 29.7, 0, 66.0, -90, { door: 'L' }),
  // east side
  N('KIT', 70.5, 0, 9.5, 45),
  N('REST', 64.5, 0, 23.0, 0),
  N('EH_N', 45.5, 0, 44.0, 0),
  N('EH_M', 45.5, 0, 48.5, 0),
  N('EH_S', 45.5, 0, 55.0, 0),
  N('EC', 44.5, 0, 61.5, 0),
  N('WIN_R', 42.7, 0, 62.6, 90, { door: 'R', window: true }),
  N('DOOR_R', 42.7, 0, 66.0, 90, { door: 'R' }),
  N('NOOK', 45.3, 0, 69.5, 150, { dark: true }),
  // Midway and Kitty's Cabaret
  N('MW_T', 6.5, 1, 21.5, -90, { pose: 'stage' }), // the Cat's spot on the Midway ring
  N('MW_EDGE', 11.6, 0, 22.6, -90), // the Cat, stepped off the ring towards the arch
  N('MW_P', 4.5, 1, 19.0, -60, { pose: 'stage' }),
  N('MW_GRATE', 7.5, 1, 23.8, 0),
  N('CAB', 9.5, 1, 33.5, -90, { pose: 'stage' }), // the Ringmaster's stage, the Grand Marquee (once Kitty's Cabaret)
  N('CAB_PEEK', 13.4, 0, 33.0, -90),
  N('CAB_OUT', 16.2, 0, 33.5, -90),
  // west duct (crawl) - the riser from the Midway grate, then towards the office's left vent
  N('WD_0', 7.5, 7, 25.5, 0, { crawl: true }),
  N('WD_1', 7.5, 7, 37.5, 0, { crawl: true }),
  N('WD_2', 7.6, 7, 48.6, -90, { crawl: true }),
  N('WD_3', 20.5, 7, 48.6, -90, { crawl: true }),
  N('WD_4', 33.6, 7, 51.0, 0, { crawl: true }),
  N('WD_5', 33.6, 7, 55.5, 0, { crawl: true }),
  N('WD_END', 33.6, 7, 61.4, 0, { crawl: true, vent: 'L' }),
  // east duct - from the kitchen grate
  N('ED_0', 71.5, 7, 7.5, 0, { crawl: true }),
  N('ED_1', 71.5, 7, 28.5, 0, { crawl: true }),
  N('ED_2', 71.4, 7, 48.6, 90, { crawl: true }),
  N('ED_3', 55.5, 7, 48.6, 90, { crawl: true }),
  N('ED_4', 39.4, 7, 51.0, 0, { crawl: true }),
  N('ED_5', 39.4, 7, 55.5, 0, { crawl: true }),
  N('ED_END', 39.4, 7, 61.4, 0, { crawl: true, vent: 'R' }),
].map((n) => [n.id, n])));

// Edges: [a, b, waypoints between a and b (excluding the endpoints)]. Bidirectional.
const E = (a, b, via = []) => Object.freeze({ a, b, via: Object.freeze(via.map((p) => Object.freeze(p))) });
export const EDGES = Object.freeze([
  // stage <-> dining (step down off the stage front at z 8/9)
  E('ST_R', 'DIN_FRONT', [[38.5, 1, 8.3], [38.5, 0, 9.4]]),
  E('ST_M', 'DIN_FRONT', [[32.5, 1, 8.3], [32.5, 0, 9.4], [36.0, 0, 10.6]]),
  E('ST_N', 'DIN_FRONT', [[44.5, 1, 8.3], [44.5, 0, 9.4], [41.0, 0, 10.6]]),
  E('ST_M', 'DIN_NW', [[30.5, 1, 8.3], [30.0, 0, 9.4], [22.0, 0, 11.0]]),
  E('ST_N', 'DIN_E', [[46.5, 1, 8.3], [47.0, 0, 9.4]]),
  E('ST_R', 'DIN_C', [[39.5, 1, 8.3], [40.0, 0, 9.4], [40.0, 0, 12.5]]),
  // around the dining hall (tables run N-S at x 25,31,37,43,49,55 between z 14 and 32; aisles between)
  E('DIN_FRONT', 'DIN_NW', [[30.0, 0, 11.2], [22.0, 0, 11.4]]),
  E('DIN_FRONT', 'DIN_C', [[40.0, 0, 12.5]]),
  E('DIN_FRONT', 'DIN_E', [[48.0, 0, 11.4]]),
  E('DIN_NW', 'DIN_W', [[19.5, 0, 17.0]]),
  E('DIN_NW', 'BACK', [[16.0, 0, 11.0], [13.2, 0, 11.0], [9.0, 0, 9.0]]),
  E('DIN_W', 'BACK', [[19.5, 0, 14.0], [16.0, 0, 11.0], [13.2, 0, 11.0], [9.0, 0, 9.0]]),
  E('DIN_W', 'DIN_CAB', [[19.5, 0, 28.0]]),
  E('DIN_W', 'DIN_SW', [[22.5, 0, 30.0], [22.5, 0, 34.5]]),
  E('DIN_W', 'MW_GRATE', [[16.0, 0, 22.5], [11.4, 0, 23.0], [10.6, 1, 23.2]]),
  E('DIN_CAB', 'DIN_SW', [[22.5, 0, 34.8]]),
  E('DIN_CAB', 'CAB_OUT', []),
  E('DIN_C', 'DIN_E', [[40.0, 0, 12.5], [48.0, 0, 11.4]]),
  E('DIN_C', 'DIN_SW', [[40.0, 0, 34.0], [30.0, 0, 35.0]]),
  E('DIN_C', 'DIN_SE', [[40.0, 0, 34.0], [44.0, 0, 35.0]]),
  E('DIN_C', 'DIN_W', [[40.0, 0, 12.5], [30.0, 0, 11.2], [22.0, 0, 12.0], [19.5, 0, 17.0]]),
  E('DIN_E', 'DIN_SE', [[59.0, 0, 12.5], [59.0, 0, 34.5], [50.0, 0, 35.0]]),
  E('DIN_SW', 'DIN_SE', [[36.0, 0, 35.0]]),
  E('DIN_E', 'KIT', [[61.0, 0, 10.0], [64.0, 0, 10.0]]),
  E('DIN_E', 'REST', [[59.0, 0, 12.5], [59.0, 0, 20.0], [61.0, 0, 20.0], [64.5, 0, 20.0]]),
  E('KIT', 'REST', [[64.0, 0, 10.0], [61.0, 0, 10.0], [60.0, 0, 15.0], [61.0, 0, 20.0], [64.5, 0, 20.0]]),
  E('REST', 'DIN_SE', [[64.5, 0, 20.0], [61.0, 0, 20.0], [59.0, 0, 34.5], [52.0, 0, 35.0]]),
  E('KIT', 'DIN_SE', [[64.0, 0, 10.0], [61.0, 0, 10.0], [59.0, 0, 18.0], [59.0, 0, 34.5], [52.0, 0, 35.0]]),
  // west hall
  E('DIN_SW', 'WH_N', [[27.5, 0, 38.0]]),
  E('WH_N', 'WH_M'), E('WH_M', 'WH_S'),
  E('WH_N', 'SUP', [[27.0, 0, 45.6], [25.0, 0, 45.6]]),
  E('WH_M', 'SUP', [[27.0, 0, 45.6], [25.0, 0, 45.6]]),
  E('SUP', 'WH_S', [[25.0, 0, 45.6], [27.0, 0, 46.5]]),
  E('WH_S', 'WC', [[27.8, 0, 58.0]]),
  E('WC', 'DOOR_L', [[28.8, 0, 63.5]]),
  // east hall
  E('DIN_SE', 'EH_N', [[45.5, 0, 38.0]]),
  E('EH_N', 'EH_M'), E('EH_M', 'EH_S'),
  E('EH_S', 'EC', [[45.0, 0, 58.0]]),
  E('EC', 'WIN_R', [[43.5, 0, 61.5]]),
  E('EC', 'DOOR_R', [[44.0, 0, 63.5]]),
  E('WIN_R', 'DOOR_R'),
  E('EC', 'NOOK', [[44.8, 0, 66.0]]),
  E('EH_S', 'NOOK', [[45.4, 0, 58.0], [45.6, 0, 64.0]]),
  // Midway and the Cabaret
  E('MW_T', 'DIN_W', [[9.5, 1, 21.5], [10.9, 1, 21.5], [11.4, 0, 21.5], [16.0, 0, 22.0]]),
  E('MW_T', 'MW_EDGE', [[9.5, 1, 21.5], [10.6, 1, 22.0], [11.2, 0, 22.4]]),
  E('MW_EDGE', 'DIN_W', [[14.0, 0, 22.6], [16.0, 0, 22.6]]),
  E('MW_P', 'MW_GRATE', [[6.0, 1, 21.0], [8.0, 1, 22.8]]),
  E('CAB', 'CAB_PEEK', [[12.9, 1, 33.5], [13.3, 0, 33.3]]),
  E('CAB_PEEK', 'CAB_OUT'),
  // ducts (crawl). The grate riser is a climb: MW_GRATE -> WD_0 straight up through (7, 5..6, 24).
  E('MW_GRATE', 'WD_0', [[7.5, 3.0, 24.4], [7.5, 6.0, 24.6]]), // climb through the ceiling grate
  E('WD_0', 'WD_1'), E('WD_1', 'WD_2'), E('WD_2', 'WD_3'), E('WD_3', 'WD_4', [[33.6, 7, 48.6]]), E('WD_4', 'WD_5'), E('WD_5', 'WD_END'),
  E('KIT', 'ED_0', [[71.5, 0, 7.0], [71.5, 3.0, 6.6], [71.5, 6.0, 6.6]]),
  E('ED_0', 'ED_1'), E('ED_1', 'ED_2'), E('ED_2', 'ED_3'), E('ED_3', 'ED_4', [[39.4, 7, 48.6]]), E('ED_4', 'ED_5'), E('ED_5', 'ED_END'),
]);

/** Adjacency: node -> { neighbour: waypoints[] (from node to neighbour, excluding endpoints) } */
export const ADJ = Object.freeze((() => {
  const adj = {};
  for (const e of EDGES) {
    (adj[e.a] ??= {})[e.b] = e.via;
    (adj[e.b] ??= {})[e.a] = Object.freeze([...e.via].reverse());
  }
  return adj;
})());

/** Full polyline from a to b (inclusive), or null when they are not adjacent. */
export function pathBetween(a, b) {
  const via = ADJ[a]?.[b];
  if (!via) return null;
  const A = NODES[a];
  const B = NODES[b];
  return [[A.x, A.y, A.z], ...via, [B.x, B.y, B.z]];
}
