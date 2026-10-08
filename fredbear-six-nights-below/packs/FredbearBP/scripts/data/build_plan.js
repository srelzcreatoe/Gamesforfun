// FREDBEAR: SIX NIGHTS BELOW - procedural build plan.
//
// generatePlan() returns every block operation needed to construct the
// complex in a fresh world, in phases. It is deterministic (fixed seed), pure
// (no Minecraft APIs) and shared by:
//   * scripts/mc/builder.js      - executes it in-game with Dimension.fillBlocks
//   * tools/voxel.mjs            - applies it to a voxel model for validation
//   * tools/render_floorplans.py - draws the docs' floor plans from that model

import { PROPERTY, ROOMS, OPENINGS, STAIRS, SOLIDS, LEVELS, ANCHORS, interior } from './layout.js';
import { EDGES, edgePolyline } from './nodes.js';
import { INPUTS, inputControlPos } from './inputs.js';
import { CAMERAS } from './cameras.js';
import { NODE_BY_ID } from './nodes.js';
import { PlanBuilder } from './plan_builder.js';
import { STAIR_KEY } from './palette.js';
import { decorateRoom } from './kits.js';
import { layoutModules, SECTIONS } from './actuators.js';
import { buildExterior } from './exterior.js';

// ------------------------------------------------------------------ styles
const pick = (rng, list) => {
  let r = rng.next();
  for (const [k, p] of list) {
    if (r < p) return k;
    r -= p;
  }
  return null;
};

/** Floor block for a cell. */
function floorKey(style, x, z, rng) {
  const even = (x + z) % 2 === 0;
  switch (style) {
    case 'pizzeria':
    case 'office':
      return pick(rng, [['lgray_c', 0.04], ['gray_c', 0.02]]) ?? (even ? 'white_c' : 'black_c');
    case 'party':
      return pick(rng, [['lgray_c', 0.03]]) ?? (even ? 'white_c' : 'black_c');
    case 'diner':
      return pick(rng, [['gray_c', 0.08], ['cracked_dt', 0.05], ['lgray_c', 0.05]]) ?? (even ? 'white_c' : 'black_c');
    case 'golden':
      return even ? 'yellow_t' : 'white_t';
    case 'kitchen':
      return pick(rng, [['terracotta', 0.05]]) ?? (even ? 'red_t' : 'white_t');
    case 'tile':
      return even ? 'white_c' : 'cyan_t';
    case 'freezer':
      return rng.chance(0.3) ? 'packed_ice' : 'snow';
    case 'staff':
      return pick(rng, [['andesite', 0.25], ['tuff', 0.05]]) ?? 'polished_andesite';
    case 'control':
      return (x % 4 === 0 || z % 4 === 0) ? 'polished_deepslate' : 'smooth_stone';
    case 'basement':
    default:
      return pick(rng, [['andesite', 0.3], ['cobbled_deepslate', 0.1], ['gravel', 0.02]]) ?? 'polished_andesite';
  }
}

/** Wall block for a cell: r = rows above the floor (0-based), a = position along the wall. */
function wallKey(style, r, a, h, rng) {
  switch (style) {
    case 'pizzeria':
      if (r === 0) return 'black_t';
      if (r === 1 || r === 2) return (a + r) % 2 === 0 ? 'red_c' : 'white_c';
      if (r === 3) return 'black_t';
      if (r >= 7) return a % 6 === 0 ? 'gray_c' : 'lgray_c';
      return pick(rng, [['lgray_t', 0.1], ['white_c', 0.05]]) ?? 'white_t';
    case 'party':
      if (r === 0) return 'purple_t';
      if (r === 1 || r === 2) return ['magenta_t', 'yellow_t', 'lime_t', 'lblue_t'][(a * 7 + r * 3) % 4];
      if (r === 3) return 'purple_t';
      return pick(rng, [['lgray_t', 0.08]]) ?? 'white_t';
    case 'office':
      if (r === 0) return 'black_t';
      if (r <= 3) return pick(rng, [['gray_t', 0.06]]) ?? 'gray_c';
      return 'lgray_c';
    case 'golden':
      if (r === 0) return 'brown_t';
      if (r === 1 || r === 2) return (a + r) % 2 === 0 ? 'yellow_c' : 'purple_t';
      if (r === 3) return 'gold';
      return 'yellow_t';
    case 'diner':
      if (r === 0) return 'brown_t';
      if (r === 1) return 'red_c';
      if (r === 2) return 'white_c';
      if (r === 3) return 'red_c';
      return pick(rng, [['terracotta', 0.15], ['lgray_t', 0.1]]) ?? 'white_t';
    case 'kitchen':
      if (r === 2) return 'lgray_c';
      return pick(rng, [['lgray_c', 0.05]]) ?? 'white_c';
    case 'tile':
      if (r === 1) return 'cyan_t';
      return 'white_c';
    case 'freezer':
      return rng.chance(0.25) ? 'smooth_quartz' : 'packed_ice';
    case 'staff':
      if (r <= 1) return 'gray_t';
      return pick(rng, [['white_t', 0.06]]) ?? 'lgray_t';
    case 'control':
      return r === 0 ? 'pb_bricks' : 'polished_deepslate';
    case 'basement':
    default:
      if (r === 0) return 'deepslate_bricks';
      return pick(rng, [['cracked_sb', 0.2], ['mossy_sb', 0.08]]) ?? 'stone_bricks';
  }
}

function ceilingKey(style, x, z, rng) {
  switch (style) {
    case 'basement':
      return rng.chance(0.15) ? 'cracked_dt' : 'deepslate_tiles';
    case 'control':
      return 'deepslate_tiles';
    case 'diner':
      return rng.chance(0.2) ? 'brown_t' : 'terracotta';
    case 'golden':
      return 'white_t';
    case 'office':
      return 'gray_c';
    case 'freezer':
      return 'iron_block';
    default:
      return rng.chance(0.05) ? 'gray_c' : 'smooth_stone';
  }
}

const STYLE_ORDER = ['control', 'basement', 'staff', 'kitchen', 'freezer', 'tile', 'party', 'golden', 'diner', 'pizzeria', 'office'];

// ------------------------------------------------------------------ phases
function terrain(P) {
  P.setPhase('terrain');
  const pl = PROPERTY.plinth;
  // Clear everything above grade, then lay the raised lot.
  P.fill(pl.x1 - PROPERTY.berm, 0, pl.z1 - PROPERTY.berm, pl.x2 + PROPERTY.berm, PROPERTY.clearTopY, pl.z2 + PROPERTY.berm, 'air');
  P.fill(pl.x1, pl.bottomY, pl.z1, pl.x2, pl.topY, pl.z2, 'stone');
  P.fill(pl.x1, PROPERTY.gradeY, pl.z1, pl.x2, PROPERTY.gradeY, pl.z2, 'grass');
  // Earth berm sloping down to the Flat-world ground (local y -11).
  for (let d = 1; d <= PROPERTY.berm; d++) {
    const top = PROPERTY.gradeY - d;
    const x1 = pl.x1 - d;
    const x2 = pl.x2 + d;
    const z1 = pl.z1 - d;
    const z2 = pl.z2 + d;
    P.fill(x1, top + 1, z1, x2, -1, z1, 'air');
    P.fill(x1, top + 1, z2, x2, -1, z2, 'air');
    P.fill(x1, top + 1, z1, x1, -1, z2, 'air');
    P.fill(x2, top + 1, z1, x2, -1, z2, 'air');
    if (top >= pl.bottomY) {
      P.fill(x1, pl.bottomY, z1, x2, top - 1, z1, 'dirt');
      P.fill(x1, pl.bottomY, z2, x2, top - 1, z2, 'dirt');
      P.fill(x1, pl.bottomY, z1, x1, top - 1, z2, 'dirt');
      P.fill(x2, pl.bottomY, z1, x2, top - 1, z2, 'dirt');
      P.fill(x1, top, z1, x2, top, z1, 'grass');
      P.fill(x1, top, z2, x2, top, z2, 'grass');
      P.fill(x1, top, z1, x1, top, z2, 'grass');
      P.fill(x2, top, z1, x2, top, z2, 'grass');
    }
  }
}

function buildRoomShell(P, room) {
  const i = interior(room);
  const [bx1, bz1, bx2, bz2] = room.box;
  const st = room.style;
  const rng = P.rng;
  // Floor (including the wall ring).
  for (let x = bx1; x <= bx2; x++) for (let z = bz1; z <= bz2; z++) P.set(x, i.floorY, z, floorKey(st, x, z, rng));
  P.flush();
  // Walls, row by row.
  const h = i.ceilY - i.floorY - 1;
  for (let r = 0; r < h; r++) {
    const y = i.floorY + 1 + r;
    let a = 0;
    for (let x = bx1; x <= bx2; x++) {
      P.set(x, y, bz1, wallKey(st, r, a, h, rng));
      P.set(x, y, bz2, wallKey(st, r, a + 1000, h, rng));
      a++;
    }
    a = 0;
    for (let z = bz1 + 1; z < bz2; z++) {
      P.set(bx1, y, z, wallKey(st, r, a, h, rng));
      P.set(bx2, y, z, wallKey(st, r, a + 1000, h, rng));
      a++;
    }
  }
  P.flush();
  // Ceiling.
  for (let x = bx1; x <= bx2; x++) for (let z = bz1; z <= bz2; z++) P.set(x, i.ceilY, z, ceilingKey(st, x, z, rng));
  P.flush();
  // Hollow interior.
  P.fill(i.x1, i.floorY + 1, i.z1, i.x2, i.ceilY - 1, i.z2, 'air');
}

function shell(P) {
  P.setPhase('shell');
  // Roof slab over the whole ground-floor footprint (L2 floors overwrite it).
  P.fill(16, 7, 12, 184, 7, 152, 'gray_c');
  const sorted = ROOMS.slice().sort((a, b) => {
    const la = a.level === 'L0' ? 0 : a.level === 'L1' ? 1 : 2;
    const lb = b.level === 'L0' ? 0 : b.level === 'L1' ? 1 : 2;
    if (la !== lb) return la - lb;
    return STYLE_ORDER.indexOf(a.style) - STYLE_ORDER.indexOf(b.style);
  });
  for (const room of sorted) buildRoomShell(P, room);
  for (const s of SOLIDS) {
    const lv = LEVELS[s.level];
    P.fill(s.box[0], lv.floorY, s.box[1], s.box[2], lv.floorY + 7, s.box[3], 'gray_t');
  }
  // Roofs above L2 rooms and tall rooms (y 15), with a parapet ring.
  for (const room of ROOMS) {
    const i = interior(room);
    if (room.level === 'L2' || room.h >= 14) {
      const [x1, z1, x2, z2] = room.box;
      P.fill(x1, i.ceilY + 1, z1, x2, i.ceilY + 1, z2, 'gray_c');
    }
  }
  facade(P);
}

/** Brick facade one block outside the ground-floor envelope (x 15/185, z 11/153). */
function facade(P) {
  const topAt = (x, z) => {
    let top = 7;
    for (const r of ROOMS) {
      if (r.level === 'L0') continue;
      const [x1, z1, x2, z2] = r.box;
      if (x >= x1 && x <= x2 && z >= z1 && z <= z2) top = Math.max(top, interior(r).ceilY + 1);
    }
    return top;
  };
  const column = (x, z, ix, iz) => {
    const top = topAt(ix, iz);
    P.set(x, -1, z, 'stone_bricks');
    P.set(x, 0, z, 'stone_bricks');
    for (let y = 1; y < top; y++) P.set(x, y, z, y === 6 || y === 14 ? 'polished_blackstone' : 'bricks');
    P.set(x, top, z, 'polished_blackstone');
    P.set(x, top + 1, z, 'sb_wall');
  };
  for (let x = 15; x <= 185; x++) {
    column(x, 11, Math.min(184, Math.max(16, x)), 12);
    column(x, 153, Math.min(184, Math.max(16, x)), 152);
  }
  for (let z = 12; z <= 152; z++) {
    column(15, z, 16, z);
    column(185, z, 184, z);
  }
  P.flush();
}

function openings(P) {
  P.setPhase('openings');
  for (const o of OPENINGS) {
    const key = o.kind === 'window' ? 'glass_pane' : o.kind === 'sealed' ? 'bricks' : o.kind === 'secret' ? 'cracked_sb' : 'air';
    // Exterior openings also cut through the facade (one block further out).
    const depth = o.exterior ? 1 : 0;
    if (o.axis === 'x') {
      const out = o.c === 184 ? 1 : o.c === 16 ? -1 : 0;
      P.fill(o.c, o.y1, o.a1, o.c + out * depth, o.y2, o.a2, key);
    } else {
      const out = o.c === 152 ? 1 : o.c === 12 ? -1 : 0;
      P.fill(o.a1, o.y1, o.c, o.a2, o.y2, o.c + out * depth, key);
    }
    if (o.glass) {
      // Glass double doors with dark frames.
      P.fill(o.a1, o.y1, o.c, o.a2, o.y2, o.c + 1, 'air');
      P.fill(o.a1, o.y2 + 1, o.c, o.a2, o.y2 + 1, o.c + 1, 'polished_blackstone');
    }
  }
  // Boarded front windows either side of the entrance.
  for (const [x1, x2] of [[58, 94], [106, 142]]) {
    for (let x = x1; x <= x2; x++) {
      if ((x - x1) % 6 === 5) continue;
      P.fill(x, 1, 152, x, 3, 153, (x - x1) % 6 < 2 ? 'dark_oak' : 'glass_pane');
    }
  }
}

/** Re-carve every walkable opening after decoration so no prop or lettering blocks a doorway. */
function reopen(P) {
  for (const o of OPENINGS) {
    if (!['door', 'arch', 'vent', 'gate'].includes(o.kind)) continue;
    if (o.axis === 'x') P.fill(o.c, o.y1, o.a1, o.c, o.y2, o.a2, 'air');
    else P.fill(o.a1, o.y1, o.c, o.a2, o.y2, o.c, 'air');
  }
}

function stairs(P) {
  P.setPhase('stairs');
  for (const s of STAIRS) {
    if (s.kind === 'stairs') buildStairs(P, s);
    else if (s.kind === 'ladder') {
      for (let y = s.fromStand; y <= s.toStand; y++) P.set(147, y, s.z, 'ladder_west');
      P.flush();
      P.fill(147, 6, s.z, 147, 7, s.z, 'air');
      P.fill(147, 6, s.z, 147, 7, s.z, 'ladder_west');
    } else if (s.kind === 'hatch') {
      const { x, z, size } = s;
      P.fill(x, -5, z, x + size - 1, -1, z + size - 1, 'air');
      for (let y = -9; y <= -2; y++) for (let dx = 0; dx < size; dx++) P.set(x + dx, y, z + size - 1, 'ladder_north');
      P.flush();
      P.fill(x, -1, z, x + size - 1, -1, z + size - 1, 'iron_trapdoor_closed');
      // Railing (see-through) around the hatch so nobody steps into it.
      for (let dx = -1; dx <= size; dx++) {
        P.set(x + dx, 0, z - 1, 'iron_bars');
        P.set(x + dx, 0, z + size, 'iron_bars');
      }
      for (let dz = 0; dz < size; dz++) {
        P.set(x - 1, 0, z + dz, 'iron_bars');
        P.set(x + size, 0, z + dz, 'iron_bars');
      }
      P.flush();
    } else if (s.kind === 'duct') {
      const [[x1, z1], [x2]] = [s.from, s.to];
      P.fill(x1, s.y, z1, x2, s.y, z1, 'air');
      P.set(x1, -1, z1, 'iron_trapdoor_closed');
      P.set(x2, -1, z1, 'iron_trapdoor_closed');
      P.flush();
    }
  }
}

function buildStairs(P, s) {
  const up = s.toStand > s.fromStand;
  const n = Math.abs(s.toStand - s.fromStand);
  // Ascending: n stair blocks (standing levels from+1 .. to).
  // Descending: n-1 stair blocks (standing from-1 .. to+1), then the lower floor.
  const steps = up ? n : n - 1;
  const dx = s.dir === '+x' ? 1 : s.dir === '-x' ? -1 : 0;
  const dz = s.dir === '+z' ? 1 : s.dir === '-z' ? -1 : 0;
  const wx = dz !== 0 ? 1 : 0; // width grows along +x for z-runs
  const wz = dx !== 0 ? 1 : 0; // and along +z for x-runs
  const ascendDir = up ? s.dir : (s.dir[0] === '+' ? '-' : '+') + s.dir[1];
  const stairMat = s.material;
  const solid = s.material === 'dark_oak' ? 'dark_oak' : s.material === 'spruce' ? 'spruce' : 'stone_bricks';
  const pos = (k, w) => [s.x + dx * k + wx * w, s.z + dz * k + wz * w];
  const lowStand = Math.min(s.fromStand, s.toStand);
  const standAt = (k) => (up ? s.fromStand + k + 1 : s.fromStand - 1 - k);
  for (let k = 0; k < steps; k++) {
    const stand = standAt(k);
    for (let w = 0; w < s.width; w++) {
      const [x, z] = pos(k, w);
      P.fill(x, stand, z, x, stand + 3, z, 'air'); // headroom (cuts ceilings/floors)
      P.set(x, stand - 1, z, STAIR_KEY(stairMat, ascendDir));
      P.flush();
      if (stand - 2 >= lowStand - 1) P.fill(x, lowStand - 1, z, x, stand - 2, z, solid);
    }
  }
  // Headroom over the landing at the far end of the run.
  for (let w = 0; w < s.width; w++) {
    const [x, z] = pos(steps, w);
    const stand = up ? s.toStand : s.toStand;
    P.fill(x, stand, z, x, stand + 3, z, 'air');
  }
  // Railing around the hole the headroom cut in the upper floor.
  const upperFloorY = Math.max(s.fromStand, s.toStand) - 1;
  const holeKs = [];
  for (let k = 0; k < steps; k++) if (standAt(k) + 3 >= upperFloorY) holeKs.push(k);
  if (!holeKs.length) return;
  const rail = s.material === 'stone_brick' ? 'iron_bars' : 'dark_oak_fence';
  const railY = upperFloorY + 1;
  for (const k of holeKs) {
    for (const w of [-1, s.width]) {
      const [x, z] = pos(k, w);
      P.set(x, railY, z, rail);
    }
  }
  // Close the end of the hole that is not the walking entry.
  const closedK = up ? holeKs[0] - 1 : holeKs[holeKs.length - 1] + 1;
  for (let w = -1; w <= s.width; w++) {
    const [x, z] = pos(closedK, w);
    P.set(x, railY, z, rail);
  }
  P.flush();
}

// ------------------------------------------------------------------ reservations
function reservations(P) {
  // Route corridors (3 wide) so props never block an animatronic path.
  for (const e of EDGES) {
    if (e.mode === 'vent') continue;
    const pts = edgePolyline(e, e.a);
    for (let s = 1; s < pts.length; s++) {
      const [x0, y0, z0] = pts[s - 1];
      const [x1, y1, z1] = pts[s];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.ceil(len / 0.3));
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const x = x0 + (x1 - x0) * f;
        const y = y0 + (y1 - y0) * f;
        const z = z0 + (z1 - z0) * f;
        const lvl = P.levelOfY(y);
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) P.reserve(lvl, x + a, z + b);
      }
    }
  }
  // Doorways: keep the approach on both sides clear.
  for (const o of OPENINGS) {
    const lvl = P.levelOfY(o.y1);
    if (o.axis === 'x') P.reserveRect(lvl, o.c - 2, o.a1, o.c + 2, o.a2);
    else P.reserveRect(lvl, o.a1, o.c - 2, o.a2, o.c + 2);
  }
  // Stairs and their landings.
  for (const s of STAIRS) {
    if (s.kind !== 'stairs') {
      if (s.kind === 'hatch') P.reserveRect('L1', s.x - 1, s.z - 1, s.x + 2, s.z + 2);
      if (s.kind === 'ladder') {
        P.reserveRect('L1', 145, s.z - 1, 147, s.z + 1);
        P.reserveRect('L2', 145, s.z - 1, 147, s.z + 1);
      }
      continue;
    }
    const dx = s.dir === '+x' ? 1 : s.dir === '-x' ? -1 : 0;
    const dz = s.dir === '+z' ? 1 : s.dir === '-z' ? -1 : 0;
    const n = Math.abs(s.toStand - s.fromStand) + 3;
    for (let k = -2; k <= n; k++) {
      for (let w = -1; w <= s.width; w++) {
        const x = s.x + dx * k + (dz !== 0 ? w : 0);
        const z = s.z + dz * k + (dx !== 0 ? w : 0);
        P.reserve('L1', x, z);
        P.reserve(s.toStand > 0 ? 'L2' : 'L0', x, z);
      }
    }
  }
  // Inputs and the cell around each console.
  for (const inp of INPUTS) {
    const [x, y, z] = inp.p;
    P.reserveRect(P.levelOfY(y), x - 1, z - 1, x + 1, z + 1);
  }
  for (const a of Object.values(ANCHORS)) P.reserveRect(P.levelOfY(a.y), a.x - 1, a.z - 1, a.x + 1, a.z + 1);
  // Camera sightlines: keep tall props out of every designed view ray.
  for (const cam of CAMERAS) {
    for (const id of cam.sees) {
      const n = NODE_BY_ID[id];
      const [cx, cy, cz] = cam.loc;
      const d = Math.hypot(n.x - cx, n.z - cz);
      const steps = Math.ceil(d / 0.4);
      for (let k = 0; k <= steps; k++) {
        const f = k / steps;
        const y = cy + (n.y + 1.3 - cy) * f;
        if (y > n.y + 2.2) continue; // only the low part of the ray; tall props check rays in 3D (kits.js)
        P.reserve(P.levelOfY(n.y), cx + (n.x - cx) * f, cz + (n.z - cz) * f);
      }
    }
  }
  // Walkable spine: every doorway of a room connects to the room centre.
  for (const room of ROOMS) {
    const i = interior(room);
    const cx = Math.floor((i.x1 + i.x2) / 2);
    const cz = Math.floor((i.z1 + i.z2) / 2);
    const lvl = room.level;
    for (const o of OPENINGS) {
      if (P.levelOfY(o.y1) !== lvl) continue;
      let ox;
      let oz;
      if (o.axis === 'x') {
        if (o.c !== room.box[0] && o.c !== room.box[2]) continue;
        if (o.a2 < room.box[1] || o.a1 > room.box[3]) continue;
        ox = o.c === room.box[0] ? o.c + 1 : o.c - 1;
        oz = Math.floor((o.a1 + o.a2) / 2);
      } else {
        if (o.c !== room.box[1] && o.c !== room.box[3]) continue;
        if (o.a2 < room.box[0] || o.a1 > room.box[2]) continue;
        oz = o.c === room.box[1] ? o.c + 1 : o.c - 1;
        ox = Math.floor((o.a1 + o.a2) / 2);
      }
      P.reserveRect(lvl, Math.min(ox, cx), oz, Math.max(ox, cx), oz);
      P.reserveRect(lvl, cx, Math.min(oz, cz), cx, Math.max(oz, cz));
    }
  }
}

// ------------------------------------------------------------------ consoles & controls
function consoles(P) {
  P.setPhase('consoles');
  for (const inp of INPUTS) {
    if (inp.kind === 'plate') continue;
    const [x, y, z] = inp.p;
    P.set(x, y, z, inp.block ?? 'console_dark');
  }
  P.flush();
}

function controls(P) {
  P.setPhase('controls');
  for (const inp of INPUTS) {
    const [x, y, z] = inputControlPos(inp);
    const key = inp.kind === 'lever' ? 'lever_up' : inp.kind === 'plate' ? 'plate' : inp.block === 'console_hidden' ? 'dark_button_up' : 'button_up';
    P.set(x, y, z, key);
  }
  P.flush();
}

// ------------------------------------------------------------------ labels
/** Control room: a sign north of every module's impulse block + section headers on the west wall. */
function controlRoomLabels(P) {
  const { modules, repeaters } = layoutModules();
  const rowSections = new Map();
  for (const p of modules) {
    const [x, y, z] = p.impulse;
    const short = p.module.id.length > 15 ? p.module.id.slice(0, 15) : p.module.id;
    P.sign(x, y, z - 1, 'north', `${p.module.section}: ${short}\n${p.module.purpose.slice(0, 45)}`);
    if (!rowSections.has(z)) rowSections.set(z, new Set());
    rowSections.get(z).add(p.module.section);
  }
  for (const r of repeaters) P.sign(r.pos[0], r.pos[1], r.pos[2] - 1, 'north', `L: ${r.repeater.id}\nREPEATING`);
  for (const [z, secs] of rowSections) {
    P.sign(21, -8, z, 'east', [...secs].map((s) => `${s} ${SECTIONS[s].slice(0, 14)}`).join('\n'));
  }
}

/** Short labels next to consoles (lobby terminal, office front row, maintenance, dev panel). */
function inputLabels(P) {
  for (const inp of INPUTS) {
    const [x, y, z] = inp.p;
    if (inp.id.startsWith('in.lobby.') && x === 181) P.sign(181, y + 2, z, 'west', inp.label);
    else if (inp.id.startsWith('in.office.') && z === 130) P.sign(x, y, z + 1, 'south', inp.label);
    else if (inp.id.startsWith('in.dev.')) P.sign(x, y, z + 1, 'south', inp.label);
    else if (inp.id.startsWith('in.maint.') || inp.id === 'in.training.begin') P.sign(x, y, z + 1, 'south', inp.label);
  }
}

// ------------------------------------------------------------------ entry point
export function generatePlan() {
  const P = new PlanBuilder(1983);
  terrain(P);
  shell(P);
  openings(P);
  stairs(P);
  reservations(P);
  P.setPhase('decor');
  for (const room of ROOMS) decorateRoom(P, room);
  reopen(P);
  P.setPhase('exterior');
  buildExterior(P);
  consoles(P);
  controls(P);
  P.setPhase('signs');
  for (const room of ROOMS) decorateRoom(P, room, { signsOnly: true });
  controlRoomLabels(P);
  inputLabels(P);
  return P.result();
}

/** Count ops and affected blocks per phase (docs/diagnostics). */
export function planStats(plan) {
  const out = [];
  for (const ph of plan.phases) {
    let blocks = 0;
    for (const op of ph.ops) {
      if (op[0] === 'F' || op[0] === 'A') blocks += (op[4] - op[1] + 1) * (op[5] - op[2] + 1) * (op[6] - op[3] + 1);
      else if (op[0] === 'L') blocks += op[2].length / 3;
      else blocks += 1;
    }
    out.push({ phase: ph.name, ops: ph.ops.length, blocks });
  }
  return out;
}
