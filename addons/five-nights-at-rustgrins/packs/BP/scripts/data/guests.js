// The daytime guests' map (pure data and pure helpers; LOCAL coordinates, feet at y = 0).
//
// By day people walk in from the street, through the front doors and the Entrance Hall, under the
// WELCOME arch into the Dining Hall, sit at the tables, play in the Game Room, look at the prizes,
// watch the ball pit, and leave again. They are moved by teleport (mc/guests.js), so everything they
// may ever walk on is written down here and checked against the built voxel model by
// tools/map/validate_guests.mjs (run by the build):
//
//   WAYPOINTS / LINKS  a graph of walkways. Every waypoint has a half-width `w`: a guest keeps its own
//                      lane, up to w to either side of the line, so a crowd is never a parade; the
//                      validator clears the whole corridor (w + the body's radius) of every link
//   seats              found in the build plan (party chairs, star chairs, booths), each with the
//                      spot beside or behind it where a guest steps out of the walkway to sit down
//   cabinets           found in the build plan too: where a player stands at an arcade machine
//   STANDS             places to stand: in front of the stage for a show, at the prize counter, by
//                      the ball pit, at the hand-stamp podium by the doors
//   PORTALS            where guests appear and vanish: across the street and at the far ends of the
//                      front walk
//
// Nothing here imports the game API, so the Node tools can load it.
import { ROOM_BY_ID } from './layout.js';

/** A guest's body for the walkway checks: an adult is about 1.85 tall. */
export const GUEST_BODY = Object.freeze({ radius: 0.3, height: 1.9 });

/** How many guests the pizzeria holds by day: new groups keep coming while there are fewer than `min`, none above `max`. */
export const CROWD = Object.freeze({ min: 14, max: 20, open: 13 });

/**
 * The skins of fnar:guest by build: indices into the entity's skin list (tools/entities/build_guest.py
 * SKINS; tools/map/validate_guests.mjs checks the two agree), and each build's fnar:size range in
 * percent of adult height.
 */
export const SKINS = Object.freeze({
  adult: Object.freeze([0, 1, 2, 3, 4, 5, 8, 9, 11, 12, 13, 14]),
  teen: Object.freeze([6, 7, 10, 15]),
  child: Object.freeze([16, 17, 18, 19, 20, 21, 22, 23]),
});
export const SIZES = Object.freeze({ adult: Object.freeze([94, 102]), teen: Object.freeze([86, 93]), child: Object.freeze([54, 72]) });
const PARTY = (weight, ...kinds) => Object.freeze({ weight, kinds: Object.freeze(kinds) });
/** Who comes together, and how often. */
export const PARTIES = Object.freeze([
  PARTY(3, 'adult', 'child'), PARTY(3, 'adult', 'child', 'child'), PARTY(2, 'adult', 'adult', 'child'), PARTY(2, 'adult', 'adult', 'child', 'child'),
  PARTY(1, 'adult', 'adult'), PARTY(1.5, 'teen', 'teen'), PARTY(0.5, 'teen', 'teen', 'teen'), PARTY(0.7, 'adult'), PARTY(0.6, 'adult', 'teen', 'child'),
]);

/**
 * The front doors by day. The street facade's plinth runs across the doorway at foot level (a block
 * high at x 100), so the two open leaves are opened down to the floor while guests are about and put
 * back as built for the night: [x, y, z] cells.
 */
export const DAY_OPEN = Object.freeze([Object.freeze([100, 0, 35]), Object.freeze([100, 0, 36])]);

const WP = (id, x, z, w, tag = '') => Object.freeze({ id, x, z, w, tag });
/** Walkway waypoints: id, x, z, half-width. tag 'aisle' = seats may hang off its links. */
export const WAYPOINTS = Object.freeze(Object.fromEntries([
  // ---- the street, the lot and the front walk
  WP('E1', 145.4, 31.5, 0.4), WP('E2', 145.4, 38.5, 0.4), // across the street, either side of the driveway
  WP('STR_N', 134.5, 31.5, 0.8), WP('STR_S', 134.5, 38.5, 0.8),
  WP('LOT_N', 118.0, 31.8, 1.0), WP('LOT_S', 118.0, 39.4, 1.0),
  WP('N1', 103.8, -14.4, 0.4), WP('S1', 103.8, 85.4, 0.4), // the far ends of the front walk
  WP('WALK_N', 103.8, 30.0, 0.5), WP('WALK_S', 103.8, 42.0, 0.5),
  WP('PLZ', 103.4, 36.0, 0.9),
  // ---- the front doors (the two open leaves, z 35..36)
  WP('DOOR_O', 101.6, 36.0, 0.5), WP('DOOR', 100.5, 36.0, 0.45), WP('DOOR_I', 99.2, 36.0, 0.5),
  // ---- the Entrance Hall: the checker walk between the velvet ropes, to the WELCOME arch
  WP('F_E', 96.5, 34.6, 1.4), WP('F_M', 89.0, 34.5, 1.8), WP('F_W', 72.0, 34.2, 1.8),
  WP('ARCH_E', 66.2, 33.5, 1.4), WP('ARCH', 64.0, 33.5, 1.4), WP('ARCH_W', 61.6, 33.5, 1.4),
  // ---- the Prize Corner: in through its wide doorway, round the rope line to the glass counter and back
  WP('F_PRZ', 90.5, 31.2, 1.5), WP('PRZ_DOOR', 90.5, 26.5, 2.0), WP('PRZ_IN', 90.5, 23.6, 1.5),
  WP('PRZ_E', 95.4, 21.8, 0.6), WP('PRZ_NE', 95.6, 16.6, 0.5), WP('PRZ_C_E', 95.3, 13.5, 0.15), WP('PRZ_C_W', 85.3, 13.5, 0.15),
  // ---- the Game Room: from the Entrance Hall's arch and from the Dining Hall's ARCADE passage
  WP('F_GR', 72.0, 39.6, 1.6), WP('GR_ARCH', 72.0, 42.3, 2.0), WP('GR_T0', 68.3, 43.4, 0.5), WP('GR_T1', 68.0, 44.9, 0.4), WP('GR_T2', 75.0, 44.8, 1.6),
  WP('D_ARC', 57.0, 35.0, 1.2), WP('ARC', 57.0, 40.5, 1.4),
  WP('GR_N0', 51.5, 47.0, 0.6), WP('GR_N1', 57.0, 47.0, 0.6), WP('GR_N3', 67.0, 47.0, 0.6), WP('GR_N4', 75.0, 47.0, 0.6), WP('GR_NE', 77.3, 47.2, 0.6),
  WP('GR_M0', 51.5, 53.0, 0.6), WP('GR_M1', 59.0, 53.0, 0.6), WP('GR_M2', 67.0, 53.0, 0.6), WP('GR_ME', 77.3, 53.0, 0.6),
  WP('GR_S0', 51.5, 58.8, 0.5), WP('GR_S1', 59.0, 58.8, 0.5), WP('GR_S2', 67.0, 58.0, 0.5), WP('GR_S3', 77.0, 57.5, 0.4),
  WP('GR_E', 77.6, 50.0, 1.0),
  // ---- the Fun Zone: through the play arch from the games, or its own arch from the Entrance Hall
  WP('PLAY', 80.5, 50.2, 1.0), WP('FZ_W', 82.3, 51.0, 0.6), WP('FZ_C', 88.8, 51.3, 0.35), WP('FZ_E', 95.6, 52.2, 0.4),
  WP('F_FZ', 89.5, 39.6, 1.5), WP('FZ_ARCH', 89.5, 42.5, 2.0), WP('FZ_N', 89.0, 46.4, 1.6),
  WP('FZ_SW', 83.5, 53.5, 0.4), WP('FZ_SE', 96.9, 54.0, 0.4),
  // ---- the Dining Hall: the walk along the south wall, the aisles between the tables, the walk in front of the stage
  WP('DS_6', 59.5, 33.5, 1.2, 'aisle'), WP('DS_5', 53.5, 33.5, 1.2, 'aisle'), WP('DS_4', 48.5, 33.5, 1.2, 'aisle'), WP('DS_3', 39.4, 33.5, 1.2, 'aisle'),
  WP('DS_2', 29.5, 33.5, 1.2, 'aisle'), WP('DS_1', 24.5, 33.5, 1.2, 'aisle'), WP('DS_0', 18.2, 33.2, 0.8, 'aisle'),
  WP('A0n', 17.6, 15.6, 0.9, 'aisle'), WP('A0s', 18.0, 27.6, 0.8, 'aisle'), WP('A0x', 18.4, 30.4, 0.4, 'aisle'),
  WP('A1n', 24.5, 15.6, 0.7, 'aisle'), WP('A1s', 24.5, 31.6, 0.7, 'aisle'),
  WP('A2n', 29.5, 15.6, 0.15, 'aisle'), WP('A2s', 29.5, 31.6, 0.15, 'aisle'),
  WP('A3n', 39.4, 15.6, 2.4, 'aisle'), WP('A3s', 39.4, 31.0, 1.0, 'aisle'), // the wide middle aisle the band looks down
  WP('A4n', 48.5, 15.6, 0.15, 'aisle'), WP('A4s', 48.5, 31.6, 0.15, 'aisle'),
  WP('A5n', 53.5, 16.3, 0.15, 'aisle'), WP('A5s', 53.5, 31.6, 0.15, 'aisle'),
  WP('A6n', 59.5, 15.6, 0.8, 'aisle'), WP('A6s', 59.5, 31.6, 0.8, 'aisle'),
  WP('DF_0', 17.6, 13.0, 0.5, 'aisle'), WP('DF_1', 24.5, 12.7, 0.25, 'aisle'), WP('DF_2', 29.5, 12.7, 0.25, 'aisle'), WP('DF_3', 39.4, 12.7, 0.25, 'aisle'),
  WP('DF_4', 48.5, 12.7, 0.25, 'aisle'), WP('DF_5', 53.5, 12.7, 0.25, 'aisle'), WP('DF_6', 59.0, 13.3, 0.4, 'aisle'),
].map((n) => [n.id, n])));

/** Walkway links (both ways). */
export const LINKS = Object.freeze([
  ['E1', 'STR_N'], ['E2', 'STR_S'], ['STR_N', 'LOT_N'], ['STR_S', 'LOT_S'], ['LOT_N', 'PLZ'], ['LOT_S', 'PLZ'],
  ['N1', 'WALK_N'], ['WALK_N', 'PLZ'], ['S1', 'WALK_S'], ['WALK_S', 'PLZ'],
  ['PLZ', 'DOOR_O'], ['DOOR_O', 'DOOR'], ['DOOR', 'DOOR_I'], ['DOOR_I', 'F_E'],
  ['F_E', 'F_M'], ['F_M', 'F_W'], ['F_W', 'ARCH_E'], ['ARCH_E', 'ARCH'], ['ARCH', 'ARCH_W'], ['ARCH_W', 'DS_6'],
  ['F_E', 'F_PRZ'], ['F_M', 'F_PRZ'], ['F_PRZ', 'PRZ_DOOR'], ['PRZ_DOOR', 'PRZ_IN'],
  ['PRZ_IN', 'PRZ_E'], ['PRZ_E', 'PRZ_NE'], ['PRZ_NE', 'PRZ_C_E'], ['PRZ_C_E', 'PRZ_C_W'],
  ['F_W', 'F_GR'], ['F_GR', 'GR_ARCH'], ['GR_ARCH', 'GR_T0'], ['GR_T0', 'GR_T1'], ['GR_ARCH', 'GR_T2'], ['GR_T1', 'GR_N3'], ['GR_T2', 'GR_N4'],
  ['DS_6', 'D_ARC'], ['DS_5', 'D_ARC'], ['D_ARC', 'ARC'], ['ARC', 'GR_N1'],
  ['GR_N0', 'GR_N1'], ['GR_N1', 'GR_N3'], ['GR_N3', 'GR_N4'], ['GR_N4', 'GR_NE'], ['GR_NE', 'GR_E'], ['GR_E', 'GR_ME'],
  ['GR_M0', 'GR_M1'], ['GR_M1', 'GR_M2'], ['GR_M2', 'GR_ME'], ['GR_S0', 'GR_S1'], ['GR_S1', 'GR_S2'], ['GR_S2', 'GR_S3'],
  ['GR_N0', 'GR_M0'], ['GR_M0', 'GR_S0'], ['GR_N3', 'GR_M2'], ['GR_M2', 'GR_S2'],
  ['GR_E', 'PLAY'], ['PLAY', 'FZ_W'], ['FZ_W', 'FZ_C'], ['FZ_C', 'FZ_E'], ['FZ_W', 'FZ_SW'], ['FZ_E', 'FZ_SE'],
  ['F_M', 'F_FZ'], ['F_FZ', 'FZ_ARCH'], ['FZ_ARCH', 'FZ_N'], ['FZ_N', 'FZ_C'],
  ['DS_6', 'DS_5'], ['DS_5', 'DS_4'], ['DS_4', 'DS_3'], ['DS_3', 'DS_2'], ['DS_2', 'DS_1'], ['DS_1', 'DS_0'],
  ['DS_0', 'A0x'], ['A0x', 'A0s'], ['A0s', 'A0n'], ['DS_1', 'A1s'], ['A1s', 'A1n'], ['DS_2', 'A2s'], ['A2s', 'A2n'], ['DS_3', 'A3s'], ['A3s', 'A3n'],
  ['DS_4', 'A4s'], ['A4s', 'A4n'], ['DS_5', 'A5s'], ['A5s', 'A5n'], ['DS_6', 'A6s'], ['A6s', 'A6n'],
  ['A0n', 'DF_0'], ['A1n', 'DF_1'], ['A2n', 'DF_2'], ['A3n', 'DF_3'], ['A4n', 'DF_4'], ['A5n', 'DF_5'], ['A6n', 'DF_6'],
  ['DF_0', 'DF_1'], ['DF_1', 'DF_2'], ['DF_2', 'DF_3'], ['DF_3', 'DF_4'], ['DF_4', 'DF_5'], ['DF_5', 'DF_6'],
].map((l) => Object.freeze(l)));

/** Where guests come from and go to (waypoint ids). The east ones are across the street: most people use them. */
export const PORTALS = Object.freeze([
  Object.freeze({ id: 'E1', weight: 3 }), Object.freeze({ id: 'E2', weight: 3 }), Object.freeze({ id: 'N1', weight: 1 }), Object.freeze({ id: 'S1', weight: 1 }),
]);
/** The doorway: outside it, in it, inside it. A guest is "inside" west of `x`. */
export const DOOR = Object.freeze({ outside: 'DOOR_O', sill: 'DOOR', inside: 'DOOR_I', x: 100.0, chime: Object.freeze({ x: 99.5, y: 2.2, z: 36.0 }) });
/** What the last child out looks back at: the stage. */
export const STAGE_FOCUS = Object.freeze({ x: 38.5, y: 2.6, z: 6.5 });

const DIR = Object.freeze({ n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] });
/** Minecraft yaw of a compass letter: 0 = south (+Z), 90 = west, 180 = north, -90 = east. */
export const DIR_YAW = Object.freeze({ s: 0, w: 90, n: 180, e: -90 });

const ST = (kind, x, z, yaw, extra = {}) => Object.freeze({ kind, x, z, yaw, ...extra });
/**
 * Places to stand. kind:
 *   stage   in front of the stage for a show: `row` 0 = the front row (children), 1 = behind them. Never
 *           in the middle aisle (x 35.5..41.5): the band looks down it, and so does whoever stands there
 *   prize   at the Prize Corner's glass counter        pit    at the edge of the ball pit
 *   podium  by the hand-stamp podium inside the doors   skee   at a skee-ball lane
 */
export const STANDS = Object.freeze([
  ...[27.3, 30.6, 31.7, 32.8, 33.9, 35.0, 42.5, 43.6, 44.7, 45.8, 46.9, 49.8, 50.9, 52.0].flatMap((x) => [ST('stage', x, 13.95, 180, { row: 0 }), ST('stage', x, 15.1, 180, { row: 1 })]),
  ...[85.6, 87.4, 89.2, 91.0, 92.8, 94.4].map((x) => ST('prize', x, 12.5, 180)),
  ...[87.4, 88.8, 90.1, 93.4, 94.8].map((x) => ST('pit', x, 53.4, 0)),
  ST('pit', 84.4, 55.5, -90), ST('pit', 84.4, 56.8, -90), ST('pit', 96.6, 55.4, 90), ST('pit', 96.6, 56.8, 90),
  ST('podium', 96.5, 32.55, 180), ST('podium', 95.35, 31.6, -90), ST('podium', 95.3, 32.8, -137), ST('podium', 97.65, 32.6, 133), ST('podium', 94.3, 32.2, -90),
  ...[49.5, 50.5, 51.5, 52.5, 53.5, 54.5].map((x) => ST('skee', x, 45.45, 180)),
]);

/** Seat height (blocks above the floor) of the blocks people sit on. */
const SEAT_TOP = Object.freeze({ chair: 8 / 16, starchair: 9 / 16, booth: 8.5 / 16 });
const SEAT_KEY = /^(chair|starchair|booth)_([nsew])$/;
const CABINET_KEY = /^arcade_0_([nsew])$/;
const inBox = (box, x, z) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3];

/**
 * Find the seats and the arcade cabinets in the build plan (what was last set at floor level in each cell).
 * @param {{ ops: Record<string, any[][]> }} plan the generated build plan
 * @returns {{ seats: any[], cabinets: any[] }}
 *   seat: { kind: 'seat', id, bx, bz (its block), x, z (where the guest sits), top, yaw, ax, az (where the
 *           guest steps off the walkway), room, booth, past (id of the booth seat it is reached past, or null) }
 *   cabinet: { kind: 'arcade', id, bx, bz, x, z (where the player stands), yaw }
 */
export function scanPlan(plan) {
  /** @type {Map<string, string>} what the plan's cell lists put at floor level, last write wins */
  const floor = new Map();
  for (const ops of Object.values(plan.ops)) {
    for (const op of ops) {
      if (op[0] !== 'L') continue;
      const list = op[2];
      for (let i = 0; i < list.length; i += 3) if (list[i + 1] === 0) floor.set(`${list[i]},${list[i + 2]}`, op[1]);
    }
  }
  const dining = ROOM_BY_ID.DINING.box;
  const games = ROOM_BY_ID.GAMEROOM.box;
  const at = (x, z) => floor.get(`${x},${z}`);
  /** Can a guest stand in this cell, as far as the plan's cell lists and the room's walls tell? */
  const open = (box, x, z) => inBox(box, x, z) && !at(x, z);
  const seats = [];
  const cabinets = [];
  for (const [k, key] of floor) {
    const [bx, bz] = k.split(',').map(Number);
    const seat = SEAT_KEY.exec(key);
    if (seat) {
      const box = inBox(dining, bx, bz) ? dining : inBox(games, bx, bz) ? games : null;
      if (!box) continue; // the Party Room and the rest are not open to guests
      const [fx, fz] = DIR[seat[2]];
      const booth = seat[1] === 'booth';
      let ax;
      let az;
      let past = null;
      if (booth) {
        // a bench against a wall: slide in from its open end, past the seat beside it if there is one
        let found = false;
        for (const [sx, sz] of [[-fz, fx], [fz, -fx]]) {
          for (let n = 1; n <= 2 && !found; n++) {
            const x = bx + sx * n;
            const z = bz + sz * n;
            if (open(box, x, z)) {
              ax = x + 0.5;
              az = z + 0.5;
              if (n === 2) past = `seat_${bx + sx}_${bz + sz}`;
              found = true;
            } else if (!SEAT_KEY.test(at(x, z) ?? '')) break;
          }
          if (found) break;
        }
        if (!found) continue;
      } else {
        // a chair: from behind it, else from either side
        const side = [[-fx, -fz], [-fz, fx], [fz, -fx]].find(([sx, sz]) => open(box, bx + sx, bz + sz));
        if (!side) continue;
        ax = bx + side[0] + 0.5;
        az = bz + side[1] + 0.5;
      }
      seats.push(Object.freeze({
        kind: 'seat', id: `seat_${bx}_${bz}`, bx, bz,
        // sit a little towards the backrest
        x: bx + 0.5 - fx * 0.08, z: bz + 0.5 - fz * 0.08, top: SEAT_TOP[seat[1]], yaw: DIR_YAW[seat[2]], dir: seat[2],
        ax, az, room: box === dining ? 'DINING' : 'GAMEROOM', booth, past,
      }));
      continue;
    }
    const cab = CABINET_KEY.exec(key);
    if (cab && inBox(games, bx, bz)) {
      const [fx, fz] = DIR[cab[1]];
      if (at(bx + fx, bz + fz)) continue;
      // face the screen from a step in front of it
      cabinets.push(Object.freeze({ kind: 'arcade', id: `cab_${bx}_${bz}`, bx, bz, x: bx + 0.5 + fx * 0.88, z: bz + 0.5 + fz * 0.88, yaw: DIR_YAW[cab[1]] + 180, dir: cab[1] }));
    }
  }
  const byId = (a, b) => (a.bx - b.bx) || (a.bz - b.bz);
  return { seats: seats.sort(byId), cabinets: cabinets.sort(byId) };
}

// ---------------------------------------------------------------- the walkway graph
/**
 * The walkway graph with shortest paths between all waypoints.
 * @returns {{
 *   ids: string[], index: Record<string, number>, pts: { id: string, x: number, z: number, w: number, tag: string }[],
 *   edges: { a: number, b: number, len: number, aisle: boolean }[], dist: Float64Array, next: Int16Array,
 * }}
 */
export function buildGraph() {
  const ids = Object.keys(WAYPOINTS);
  const index = Object.fromEntries(ids.map((id, i) => [id, i]));
  const pts = ids.map((id) => WAYPOINTS[id]);
  const n = ids.length;
  const dist = new Float64Array(n * n).fill(Infinity);
  const next = new Int16Array(n * n).fill(-1);
  const edges = [];
  for (let i = 0; i < n; i++) {
    dist[i * n + i] = 0;
    next[i * n + i] = i;
  }
  for (const [ia, ib] of LINKS) {
    const a = index[ia];
    const b = index[ib];
    if (a === undefined || b === undefined) throw new Error(`guests: unknown waypoint in link ${ia} - ${ib}`);
    const len = Math.hypot(pts[a].x - pts[b].x, pts[a].z - pts[b].z);
    edges.push({ a, b, len, aisle: pts[a].tag === 'aisle' && pts[b].tag === 'aisle' });
    dist[a * n + b] = dist[b * n + a] = len;
    next[a * n + b] = b;
    next[b * n + a] = a;
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const ik = dist[i * n + k];
      if (ik === Infinity) continue;
      for (let j = 0; j < n; j++) {
        const d = ik + dist[k * n + j];
        if (d < dist[i * n + j]) {
          dist[i * n + j] = d;
          next[i * n + j] = next[i * n + k];
        }
      }
    }
  }
  return { ids, index, pts, edges, dist, next };
}

/**
 * Where a point joins the walkways: the nearest spot on the nearest link.
 * @param {ReturnType<typeof buildGraph>} g
 * @param {number} x
 * @param {number} z
 * @param {{ aisle?: boolean }} [o] aisle: only the Dining Hall's walkways (for its seats)
 * @returns {{ x: number, z: number, edge: number, t: number, px: number, pz: number, pw: number, off: number }}
 */
export function anchor(g, x, z, o = {}) {
  let best = null;
  for (let e = 0; e < g.edges.length; e++) {
    const E = g.edges[e];
    if (o.aisle && !E.aisle) continue;
    const A = g.pts[E.a];
    const B = g.pts[E.b];
    const dx = B.x - A.x;
    const dz = B.z - A.z;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (z - A.z) * dz) / (E.len * E.len || 1)));
    const px = A.x + dx * t;
    const pz = A.z + dz * t;
    const off = Math.hypot(x - px, z - pz);
    if (!best || off < best.off) best = { x, z, edge: e, t, px, pz, pw: A.w + (B.w - A.w) * t, off };
  }
  if (!best) throw new Error('guests: no walkway to anchor to');
  return best;
}

/** An anchor that is a waypoint itself (a portal, the doorway). */
export function anchorAt(g, id) {
  const i = g.index[id];
  if (i === undefined) throw new Error(`guests: unknown waypoint ${id}`);
  const e = g.edges.findIndex((E) => E.a === i || E.b === i);
  const P = g.pts[i];
  return { x: P.x, z: P.z, edge: e, t: g.edges[e].a === i ? 0 : 1, px: P.x, pz: P.z, pw: P.w, off: 0 };
}

/**
 * The walk from one anchor to another: points [x, z, w] along the walkways (w = how far a guest may keep
 * to one side there; 0 at the ends, off the walkway).
 * @param {ReturnType<typeof buildGraph>} g
 * @returns {number[][]}
 */
export function route(g, from, to) {
  const n = g.ids.length;
  const out = [];
  const push = (x, z, w) => {
    const l = out[out.length - 1];
    if (l && Math.hypot(l[0] - x, l[1] - z) < 0.06) {
      l[2] = Math.max(l[2], w);
      return;
    }
    out.push([x, z, w]);
  };
  push(from.x, from.z, 0);
  push(from.px, from.pz, from.pw);
  if (from.edge !== to.edge) {
    const EA = g.edges[from.edge];
    const EB = g.edges[to.edge];
    let best = null;
    for (const [u, du] of [[EA.a, from.t * EA.len], [EA.b, (1 - from.t) * EA.len]]) {
      for (const [v, dv] of [[EB.a, to.t * EB.len], [EB.b, (1 - to.t) * EB.len]]) {
        const d = du + g.dist[u * n + v] + dv;
        if (!best || d < best.d) best = { d, u, v };
      }
    }
    if (!best || best.d === Infinity) return [];
    for (let k = best.u, guard = 0; guard < n + 1; guard++) {
      const P = g.pts[k];
      push(P.x, P.z, P.w);
      if (k === best.v) break;
      k = g.next[k * n + best.v];
    }
  }
  push(to.px, to.pz, to.pw);
  push(to.x, to.z, 0);
  return out;
}

/** Length of a route. */
export function routeLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

/**
 * A guest's own line along a route: every point moved `lane` to the right of the way it walks (negative =
 * left), but never further from the middle than the walkway is wide there.
 * @param {number[][]} pts [x, z, w]
 * @param {number} lane
 * @returns {number[][]} [x, z]
 */
export function laneOf(pts, lane) {
  const n = pts.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = 0;
    let dz = 0;
    if (i > 0) {
      const l = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1;
      dx += (p[0] - a[0]) / l;
      dz += (p[1] - a[1]) / l;
    }
    if (i < n - 1) {
      const l = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
      dx += (b[0] - p[0]) / l;
      dz += (b[1] - p[1]) / l;
    }
    const l = Math.hypot(dx, dz);
    const off = Math.max(-p[2], Math.min(p[2], lane));
    if (l < 1e-6 || !off) out.push([p[0], p[1]]);
    else out.push([p[0] + (-dz / l) * off, p[1] + (dx / l) * off]); // right of travel: heading east (+x) it is south (+z)
  }
  return out;
}
