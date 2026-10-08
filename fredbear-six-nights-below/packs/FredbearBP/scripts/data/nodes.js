// Route graph for the animatronic AI (local coordinates, standing positions).
//
// Nodes are places an animatronic may stand. Edges are walkable polylines that
// pass through real doorways; tools/validate_map.mjs voxel-checks every
// segment against the generated build so ordinary movement never crosses a
// wall. Access letters: B = Bonnie, C = Chica, F = Freddy, G = Fredbear.
//
// zone: far | mid | near | entry   (entry = attack position outside a barrier)
// entry: L (left door) | R (right door) | H (office hatch)
// golden: designated supernatural relocation node (Fredbear only, warned).

const N = (id, x, y, z, room, zone, extra = {}) => Object.freeze({ id, x, y, z, room, zone, ...extra });

export const NODES = Object.freeze([
  // Stage and north rooms
  N('STAGE_F', 100.5, 1, 22.5, 'STAGE', 'far', { yaw: 0, home: 'freddy' }),
  N('STAGE_B', 93.5, 1, 23.5, 'STAGE', 'far', { yaw: 0, home: 'bonnie' }),
  N('STAGE_C', 107.5, 1, 23.5, 'STAGE', 'far', { yaw: 0, home: 'chica' }),
  N('STAGE_FRONT', 100.5, 0, 35.5, 'STAGE', 'far'),
  N('BACK', 64.5, 0, 26.5, 'BACKSTAGE', 'far'),
  N('PARTS', 34.5, 0, 26.5, 'PARTS', 'far', { dark: true }),
  N('PRP', 136.5, 0, 24.5, 'PROPS', 'far', { dark: true }),
  // Dining hall
  N('DIN_NW', 64.5, 0, 50.5, 'DINING', 'mid'),
  N('DIN_W', 62.5, 0, 84.5, 'DINING', 'mid'),
  N('DIN_C', 100.5, 0, 70.5, 'DINING', 'mid'),
  N('DIN_E', 136.5, 0, 58.5, 'DINING', 'mid'),
  N('DIN_EE', 140.5, 0, 80.5, 'DINING', 'mid'),
  N('DIN_SW', 87.5, 0, 94.5, 'DINING', 'mid'),
  N('DIN_SE', 113.5, 0, 94.5, 'DINING', 'mid'),
  // West wing
  N('COVE_FRONT', 36.5, 0, 55.5, 'COVE', 'far', { dark: true }),
  N('COVE_STAGE', 21.5, 1, 55.5, 'COVE', 'far', { dark: true, golden: true, yaw: -90 }),
  N('ARCADE', 34.5, 0, 87.5, 'ARCADE', 'far'),
  N('PC', 68.5, 0, 108.5, 'PARTY_C', 'mid'),
  N('SUP', 78.5, 0, 128.5, 'SUPPLY', 'near', { dark: true }),
  N('WH_N', 87.5, 0, 103.5, 'W_HALL', 'mid', { dark: true }),
  N('WH_M', 87.5, 0, 116.5, 'W_HALL', 'near', { dark: true }),
  N('WH_S', 87.5, 0, 130.5, 'W_HALL', 'near', { dark: true, golden: true, yaw: -90 }),
  N('W_DOOR', 92.5, 0, 130.0, 'W_ALCOVE', 'entry', { entry: 'L', yaw: -90, dark: true }),
  N('PA', 100.5, 0, 106.5, 'PARTY_A', 'mid'),
  // East wing
  N('EH_N', 113.5, 0, 103.5, 'E_HALL', 'mid', { dark: true }),
  N('EH_M', 113.5, 0, 116.5, 'E_HALL', 'near', { dark: true }),
  N('EH_S', 113.5, 0, 130.5, 'E_HALL', 'near', { dark: true, golden: true, yaw: 90 }),
  N('E_DOOR', 107.5, 0, 130.0, 'E_ALCOVE', 'entry', { entry: 'R', yaw: 90, dark: true }),
  N('PD', 130.5, 0, 108.5, 'PARTY_D', 'mid'),
  N('EMP', 152.5, 0, 106.5, 'EMPLOYEE', 'mid'),
  N('KIT', 166.5, 0, 30.5, 'KITCHEN', 'far', { dark: true, kitchen: true }),
  N('PAN', 156.5, 0, 56.5, 'PANTRY', 'far', { dark: true }),
  N('ES_N', 152.5, 0, 72.5, 'E_SERVICE', 'mid', { dark: true }),
  N('ES_M', 152.5, 0, 81.5, 'E_SERVICE', 'mid', { dark: true }),
  N('ES_S', 152.5, 0, 96.5, 'E_SERVICE', 'mid', { dark: true }),
  N('RH', 162.5, 0, 83.5, 'RESTROOM_HALL', 'mid', { dark: true }),
  // Basement (Fredbear)
  N('CHAMBER_F', 34.5, -9, 36.5, 'CHAMBER', 'far', { home: 'fredbear', yaw: 0, dark: true }),
  N('DINER_STAGE', 40.5, -8, 50.5, 'DINER', 'far', { golden: true, yaw: 0, dark: true }),
  N('DINER_FLOOR', 40.5, -9, 70.5, 'DINER', 'far', { dark: true }),
  N('DINER_KITCHEN', 28.5, -9, 104.5, 'DINER_KITCHEN', 'far', { dark: true }),
  N('CRAWL_MID', 64.5, -9, 114.0, 'CRAWL_D', 'mid', { golden: true, dark: true, crawl: true }),
  N('CRAWL_END', 90.5, -9, 114.0, 'CRAWL_D', 'near', { dark: true, crawl: true }),
  N('TW_SEAL', 67.0, -9, 85.5, 'TUNNEL_W', 'mid', { dark: true }),
  N('TS_W', 75.5, -9, 107.0, 'TUNNEL_S', 'mid', { dark: true }),
  N('TS_MID', 100.0, -9, 107.0, 'TUNNEL_S', 'mid', { dark: true }),
  N('SUB_N', 100.5, -9, 118.5, 'SUBFLOOR', 'near', { golden: true, dark: true }),
  N('H_DOOR', 100.0, -2.2, 137.0, 'SUBFLOOR', 'entry', { entry: 'H', yaw: 180, dark: true }),
]);

export const NODE_BY_ID = Object.freeze(Object.fromEntries(NODES.map((n) => [n.id, n])));

const P = (x, y, z) => [x, y, z];
// E(id, a, b, access, points-between, mode). Endpoints come from the nodes.
const E = (a, b, access, mid = [], mode = 'walk', extra = {}) =>
  Object.freeze({ id: `${a}-${b}`, a, b, access, mid: Object.freeze(mid), mode, ...extra });

export const EDGES = Object.freeze([
  // --- stage exits
  E('STAGE_B', 'STAGE_FRONT', 'B', [P(93.5, 1, 30.5), P(93.5, 1, 31.2), P(93.5, 0, 31.7)]),
  E('STAGE_C', 'STAGE_FRONT', 'C', [P(107.5, 1, 30.5), P(107.5, 1, 31.2), P(107.5, 0, 31.7)]),
  E('STAGE_F', 'STAGE_FRONT', 'F', [P(100.5, 1, 30.5), P(100.5, 1, 31.2), P(100.5, 0, 31.7)]),
  E('STAGE_B', 'BACK', 'B', [P(82.4, 1, 19.0), P(81.9, 1, 19.0), P(81.4, 0, 19.0), P(76.5, 0, 19.0), P(70.5, 0, 19.0)]),
  E('STAGE_C', 'PRP', 'C', [P(118.6, 1, 19.0), P(119.1, 1, 19.0), P(119.6, 0, 19.0), P(124.5, 0, 19.0), P(130.5, 0, 19.0)]),
  // --- north rooms to dining
  E('BACK', 'DIN_NW', 'B', [P(65.0, 0, 38.5), P(65.0, 0, 41.5)]),
  E('BACK', 'PARTS', 'B', [P(53.5, 0, 26.0), P(50.5, 0, 26.0)]),
  E('PARTS', 'COVE_FRONT', 'B', [P(34.0, 0, 38.5), P(34.0, 0, 41.5)]),
  E('PRP', 'DIN_E', 'C', [P(136.0, 0, 38.5), P(136.0, 0, 41.5)]),
  E('STAGE_FRONT', 'DIN_NW', 'B', []),
  E('STAGE_FRONT', 'DIN_C', 'BCF', []),
  E('STAGE_FRONT', 'DIN_E', 'CF', []),
  // --- dining internal
  E('DIN_NW', 'DIN_W', 'B', []),
  E('DIN_NW', 'COVE_FRONT', 'B', [P(54.5, 0, 55.0), P(49.5, 0, 55.0)]),
  E('DIN_W', 'ARCADE', 'B', [P(50.5, 0, 85.0)]),
  E('DIN_W', 'DIN_SW', 'B', []),
  E('DIN_C', 'DIN_SW', 'BF', []),
  E('DIN_C', 'DIN_SE', 'CF', []),
  E('DIN_C', 'DIN_E', 'CF', []),
  E('DIN_E', 'DIN_EE', 'CF', []),
  E('DIN_EE', 'DIN_SE', 'CF', []),
  // --- west wing
  E('DIN_SW', 'WH_N', 'B', [P(87.5, 0, 100.5)]),
  E('DIN_W', 'PC', 'B', [P(67.0, 0, 98.5), P(67.0, 0, 101.5)]),
  E('PC', 'WH_M', 'B', [P(82.5, 0, 108.0), P(86.5, 0, 108.0)]),
  E('WH_N', 'WH_M', 'B', []),
  E('WH_M', 'WH_S', 'BG', []),
  E('WH_S', 'W_DOOR', 'BFG', [P(90.5, 0, 130.0)]),
  E('WH_M', 'SUP', 'B', [P(86.5, 0, 121.0), P(82.5, 0, 121.0), P(78.5, 0, 124.5)]),
  E('SUP', 'W_DOOR', 'B', [P(80.5, 0, 132.5), P(80.5, -1.6, 132.5), P(92.5, -1.6, 132.5), P(92.5, 0, 132.5)], 'vent'),
  E('WH_N', 'PA', 'B', [P(88.5, 0, 106.0), P(91.5, 0, 106.0)]),
  E('PA', 'EH_N', 'B', [P(109.0, 0, 106.0), P(111.5, 0, 106.0)]),
  // --- east wing
  E('DIN_SE', 'EH_N', 'BCF', [P(113.5, 0, 100.5)]),
  E('EH_N', 'EH_M', 'BCF', []),
  E('EH_M', 'EH_S', 'BCFG', []),
  E('EH_S', 'E_DOOR', 'BCFG', [P(109.5, 0, 130.0)]),
  E('DIN_E', 'KIT', 'C', [P(146.5, 0, 45.5), P(150.5, 0, 45.5)]),
  E('KIT', 'PAN', 'C', [P(161.0, 0, 48.5), P(161.0, 0, 51.5)]),
  E('PAN', 'ES_N', 'C', [P(152.0, 0, 60.5), P(152.0, 0, 63.5)]),
  E('ES_N', 'ES_M', 'CF', []),
  E('ES_M', 'ES_S', 'CF', []),
  E('DIN_EE', 'ES_M', 'CF', [P(146.5, 0, 81.0), P(149.5, 0, 81.0)]),
  E('ES_M', 'RH', 'F', [P(155.0, 0, 83.0), P(158.5, 0, 83.0)]),
  E('ES_S', 'EMP', 'CF', [P(152.0, 0, 98.5), P(152.0, 0, 101.5)]),
  E('EMP', 'PD', 'CF', [P(149.5, 0, 105.0), P(146.5, 0, 105.0)]),
  E('PD', 'EH_M', 'CF', [P(117.5, 0, 108.0), P(114.5, 0, 108.0)]),
  E('PD', 'DIN_SE', 'CF', [P(132.0, 0, 101.5), P(132.0, 0, 98.5)]),
  // --- Fredbear hidden routes (basement)
  E('CHAMBER_F', 'DINER_STAGE', 'G', [P(34.5, -9, 42.5), P(34.5, -9, 44.3), P(34.5, -8, 44.8), P(36.5, -8, 47.5)], 'walk', { gate: 'chamber_wall' }),
  E('DINER_STAGE', 'DINER_FLOOR', 'G', [P(40.5, -8, 55.2), P(40.5, -9, 55.7)]),
  E('DINER_FLOOR', 'DINER_KITCHEN', 'G', [P(27.0, -9, 93.5), P(27.0, -9, 97.5)]),
  E('DINER_KITCHEN', 'CRAWL_MID', 'G', [P(38.0, -9, 110.5), P(38.0, -9, 114.0)], 'crawl'),
  E('CRAWL_MID', 'CRAWL_END', 'G', [], 'crawl'),
  E('CRAWL_END', 'SUB_N', 'G', [P(93.5, -9, 114.0)], 'crawl'),
  E('SUB_N', 'H_DOOR', 'G', [P(100.0, -9, 135.0), P(100.0, -9, 137.0)], 'climb'),
  E('DINER_FLOOR', 'TW_SEAL', 'G', [P(60.5, -9, 85.5), P(65.5, -9, 85.5)], 'walk', { gate: 'diner_seal' }),
  E('TW_SEAL', 'TS_W', 'G', [P(67.0, -9, 107.0)]),
  E('TS_W', 'TS_MID', 'G', []),
  E('TS_MID', 'SUB_N', 'G', [P(100.0, -9, 113.5)], 'crawl'),
]);

/** Fredbear's supernatural relocation pairs (no polyline; warned teleport). */
export const GOLDEN_NODES = Object.freeze(NODES.filter((n) => n.golden).map((n) => n.id));

/** Entry -> barrier device id. */
export const ENTRY_BARRIER = Object.freeze({ L: 'door_l', R: 'door_r', H: 'hatch' });
/** Entry -> attack node. */
export const ENTRY_NODE = Object.freeze({ L: 'W_DOOR', R: 'E_DOOR', H: 'H_DOOR' });
/** Entry -> approach node from which the final move into the entry starts. */
export const ENTRY_APPROACH = Object.freeze({ L: ['WH_S', 'SUP'], R: ['EH_S'], H: ['SUB_N'] });

/** Character -> access letter. */
export const ACCESS = Object.freeze({ bonnie: 'B', chica: 'C', freddy: 'F', fredbear: 'G' });

/** Full polyline for an edge, oriented from `from` to the other endpoint. */
export function edgePolyline(edge, from) {
  const a = NODE_BY_ID[edge.a];
  const b = NODE_BY_ID[edge.b];
  const pts = [[a.x, a.y, a.z], ...edge.mid.map((p) => [...p]), [b.x, b.y, b.z]];
  return from === edge.a ? pts : pts.reverse();
}

export function polylineLength(pts) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0, z0] = pts[i - 1];
    const [x1, y1, z1] = pts[i];
    len += Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  }
  return len;
}
