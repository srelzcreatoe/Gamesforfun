// Deterministic build plan for Rustgrin's Pizza Revue (pure data -> ops).
//
// generatePlan() returns { ops: { phase: op[] }, meta } (see plan.js for the
// op format). The same function runs in the game (mc/builder.js executes the
// ops) and in Node (tools/map/export_voxels.mjs turns the ops into a voxel
// snapshot for the preview renderer and the map validators), so what the
// tools check is exactly what gets built.

import { PlanBuilder } from './plan.js';
import { BUILDING, LOT, ROOMS, ROOM_BY_ID, OPENINGS, OFFICE, DUCTS, STAGE, MIDWAY_RING, SHOW_TAPE, CABARET } from './layout.js';
import { WRITING } from './palette.js';
import { CAMERAS } from './cameras.js';
import { LOBBY_BUTTONS } from './lobby.js';

// ---------------------------------------------------------------- room styles
// bands: list of [fromY, toY, key | key[] (random pick)] for the walls (relative to the floor).
const STYLES = {
  dining: { floor: ['tile', 'tile', 'tile', 'tile_worn'], ceiling: ['ceiling', 'ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, 'wallpaper']] },
  hall: { floor: ['tile', 'tile', 'tile_worn'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, ['plaster', 'plaster', 'plaster', 'plaster_stained']]] },
  office: { floor: ['tile_office'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, ['plaster', 'plaster_stained']]] },
  backstage: { floor: ['polished_deepslate', 'polished_deepslate', 'deepslate_tiles'], ceiling: ['blackstone'], bands: [[0, 9, 'cinder']] },
  midway: { floor: ['carpet'], ceiling: ['tent'], bands: [[0, 0, 'blackstone'], [1, 9, 'tent']] },
  cabaret: { floor: ['carpet'], ceiling: ['black_c'], bands: [[0, 9, 'curtain_purple']] },
  kitchen: { floor: ['tile_kitchen'], ceiling: ['ceiling_stained', 'ceiling'], bands: [[0, 2, 'white_t'], [3, 9, 'cinder']] },
  restroom: { floor: ['tile_worn'], ceiling: ['ceiling_stained', 'ceiling'], bands: [[0, 2, 'smooth_quartz'], [3, 9, ['plaster', 'plaster_stained']]] },
  foyer: { floor: ['tile'], ceiling: ['ceiling'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, 'wallpaper']] },
  gallery: { floor: ['dark_oak'], ceiling: ['black_c'], bands: [[0, 0, 'blackstone'], [1, 9, 'black_c']] },
  staff: { floor: ['tile_office'], ceiling: ['ceiling', 'ceiling_stained'], bands: [[0, 1, 'cinder'], [2, 2, 'trim'], [3, 9, 'plaster']] },
  supply: { floor: ['smooth_stone'], ceiling: ['ceiling_stained'], bands: [[0, 9, 'cinder']] },
  prize: { floor: ['carpet'], ceiling: ['ceiling'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, 'wallpaper']] },
  parts: { floor: ['smooth_stone', 'smooth_stone', 'polished_andesite'], ceiling: ['blackstone'], bands: [[0, 9, ['cinder', 'cinder', 'cinder', 'cracked_bricks']]] },
};

const inBox = (b, x, z) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3];
const interiorOf = (x, z) => ROOMS.find((r) => inBox(r.box, x, z));

// ---------------------------------------------------------------- phases

function ground(p) {
  p.setPhase('ground');
  const L = LOT;
  p.fill(L.x1, L.baseY, L.z1, L.x2, L.baseY, L.z2, 'stone');
  p.fill(L.x1, L.baseY + 1, L.z1, L.x2, L.groundY - 1, L.z2, 'dirt');
  p.fill(L.x1, L.groundY, L.z1, L.x2, L.groundY, L.z2, 'grass');
  p.fill(L.x1, L.groundY + 1, L.z1, L.x2, L.clearTop, L.z2, 'air');
}

function shell(p) {
  p.setPhase('shell');
  const B = BUILDING;
  const top = B.roofY;
  // Solid core for the whole building (walls between rooms, attic), then the exterior skin.
  p.fill(B.x1 - 1, B.floorY - 1, B.z1 - 1, B.x2 + 1, top, B.z2 + 1, 'int_core');
  const skin = (x1, z1, x2, z2) => {
    p.fill(x1, B.floorY, z1, x2, B.floorY, z2, 'ext_base');
    p.fill(x1, 0, z1, x2, 6, z2, 'ext_wall');
    p.fill(x1, 7, z1, x2, 7, z2, 'ext_band');
    p.fill(x1, 8, z1, x2, top, z2, 'ext_wall2');
    p.fill(x1, top + 1, z1, x2, top + 1, z2, 'roof_edge'); // parapet
  };
  skin(B.x1 - 1, B.z1 - 1, B.x2 + 1, B.z1 - 1);
  skin(B.x1 - 1, B.z2 + 1, B.x2 + 1, B.z2 + 1);
  skin(B.x1 - 1, B.z1 - 1, B.x1 - 1, B.z2 + 1);
  skin(B.x2 + 1, B.z1 - 1, B.x2 + 1, B.z2 + 1);
  p.fill(B.x1, top, B.z1, B.x2, top, B.z2, 'roof');
}

function rooms(p) {
  p.setPhase('rooms');
  const rng = p.rng.fork(11);
  for (const r of ROOMS) {
    const st = STYLES[r.style];
    const [x1, z1, x2, z2] = r.box;
    p.fill(x1, 0, z1, x2, r.h - 1, z2, 'air');
    // floor + ceiling with scattered variants
    for (let x = x1; x <= x2; x++) {
      for (let z = z1; z <= z2; z++) {
        p.set(x, -1, z, rng.pick(st.floor));
        p.set(x, r.h, z, rng.pick(st.ceiling));
      }
    }
    // walls: the ring around the interior, skipping cells inside other rooms
    for (let x = x1 - 1; x <= x2 + 1; x++) {
      for (let z = z1 - 1; z <= z2 + 1; z++) {
        if (inBox(r.box, x, z)) continue;
        if (interiorOf(x, z)) continue;
        for (const [a, b, key] of st.bands) {
          for (let y = a; y <= Math.min(b, r.h - 1); y++) p.set(x, y, z, Array.isArray(key) ? rng.pick(key) : key);
        }
      }
    }
  }
}

function openings(p) {
  p.setPhase('openings');
  for (const o of OPENINGS) {
    let [x1, y1, z1, x2, y2, z2] = o.box;
    // Openings to the outside also cut the exterior skin.
    if (o.b === 'OUTSIDE') {
      if (x1 === BUILDING.x2) x2 = BUILDING.x2 + 1;
      if (x1 === BUILDING.x1) x1 = BUILDING.x1 - 1;
    }
    p.fill(x1, y1, z1, x2, y2, z2, 'air');
    if (o.kind === 'curtain') {
      // the Ringmaster's booth: the curtains hang parted
      p.fill(x1, y1, z1, x2, y2, z2, 'curtain_purple');
      p.fill(x1, CABARET.gap.y1, CABARET.gap.z1, x2, CABARET.gap.y2, CABARET.gap.z2, 'air');
    }
    if (o.kind === 'iron_door') {
      for (let z = z1; z <= z2; z++) {
        p.set(BUILDING.x1 - 1, 0, z, 'iron_door_e');
        p.set(BUILDING.x1 - 1, 1, z, 'iron_door_e_top');
      }
      p.fill(BUILDING.x1, 0, z1, BUILDING.x1, 1, z2, 'air');
      p.fill(BUILDING.x1 - 1, 2, z1, BUILDING.x1, 2, z2, 'blackstone_bricks');
    }
    if (o.kind === 'door') {
      // a dark frame line over the doorway (only where the wall continues above)
      const lintel = y2 + 1;
      if (x1 === x2) p.fill(x1, lintel, z1 - 0, x2, lintel, z2, 'blackstone');
      else p.fill(x1, lintel, z1, x2, lintel, z2, 'blackstone');
    }
  }
  // Floor continuity under openings (doorways take the floor of the room they lead into).
  for (const o of OPENINGS) {
    const [x1, , z1, x2, , z2] = o.box;
    for (let x = x1; x <= x2; x++) for (let z = z1; z <= z2; z++) p.set(x, -1, z, o.kind === 'curtain' ? 'blackstone' : 'tile_worn');
  }
  // Nook partition in the E. Hall Corner (Rustgrin hides behind it, seen only by CAM 4B).
  p.fill(43, 0, 68, 43, 4, 70, 'cinder');
  p.fill(43, 2, 68, 43, 2, 70, 'trim');
}

function ducts(p) {
  p.setPhase('ducts');
  for (const d of Object.values(DUCTS)) {
    for (const [x1, y1, z1, x2, y2, z2] of d.boxes) p.fill(x1 - 1, y1 - 1, z1 - 1, x2 + 1, y2 + 1, z2 + 1, 'duct');
  }
  for (const d of Object.values(DUCTS)) {
    for (const [x1, y1, z1, x2, y2, z2] of d.boxes) p.fill(x1, y1, z1, x2, y2, z2, 'air');
    for (const [x, y, z] of d.risers) p.set(x, y, z, 'air');
    p.set(d.grate.x, d.grate.y, d.grate.z, 'vent_open');
  }
  // The roof above the ducts stays roof.
  p.fill(BUILDING.x1, BUILDING.roofY, BUILDING.z1, BUILDING.x2, BUILDING.roofY, BUILDING.z2, 'roof');
}

function exterior(p) {
  p.setPhase('exterior');
  const rng = p.rng.fork(23);
  const B = BUILDING;
  // sidewalk ring around the building (outside the exterior skin only - the floors inside are done)
  p.fill(B.x1 - 3, -1, B.z1 - 3, B.x2 + 3, -1, B.z1 - 2, 'sidewalk');
  p.fill(B.x1 - 3, -1, B.z2 + 2, B.x2 + 3, -1, B.z2 + 3, 'sidewalk');
  p.fill(B.x1 - 3, -1, B.z1 - 1, B.x1 - 2, -1, B.z2 + 1, 'sidewalk');
  p.fill(B.x2 + 2, -1, B.z1 - 1, B.x2 + 3, -1, B.z2 + 1, 'sidewalk');
  // parking lot (east) with bays
  p.fill(85, -1, 0, 109, -1, 68, 'blackstone');
  for (let z = 2; z <= 66; z += 4) {
    if (z >= 30 && z <= 38) continue; // drive lane in front of the doors
    p.fill(86, -1, z, 91, -1, z, 'paint_line');
    p.fill(103, -1, z, 108, -1, z, 'paint_line');
  }
  p.fill(84, -1, 0, 84, -1, 68, 'curb');
  p.fill(110, -1, 0, 110, -1, 68, 'curb');
  // the street
  p.fill(114, -1, LOT.z1, 124, -1, LOT.z2, 'black_c');
  for (let z = LOT.z1; z <= LOT.z2; z += 6) p.fill(119, -1, z, 119, -1, Math.min(LOT.z2, z + 2), 'paint_yellow');
  p.fill(111, -1, LOT.z1, 113, -1, LOT.z2, 'sidewalk');
  p.fill(125, -1, LOT.z1, 127, -1, LOT.z2, 'sidewalk');
  p.fill(110, -1, 30, 113, -1, 38, 'blackstone'); // driveway
  // street lamps
  for (const z of [-8, 12, 34, 56, 78]) {
    p.fill(112, 0, z, 112, 4, z, 'lamp_post');
    p.set(112, 5, z, 'sea_lantern');
    p.set(112, 6, z, 'blackstone_slab');
  }
  for (const [x, z] of [[96, 18], [96, 50]]) {
    p.fill(x, 0, z, x, 4, z, 'lamp_post');
    p.set(x, 5, z, 'sea_lantern');
    p.set(x, 6, z, 'blackstone_slab');
  }
  // front entrance canopy over the doors (x 82..84, z 30..36)
  p.fill(82, 4, 29, 85, 4, 37, 'red_wool');
  p.fill(82, 5, 29, 85, 5, 37, 'red_carpet');
  for (const z of [29, 37]) p.fill(85, 0, z, 85, 3, z, 'chain_y');
  // windows on the facade (foyer)
  for (const [z1, z2] of [[28, 29], [37, 40]]) p.fill(B.x2, 1, z1, B.x2 + 1, 2, z2, 'window');
  // big sign board on the facade above the canopy: background + the neon picture (6x2 tiles)
  p.fill(B.x2 + 1, 6, 29, B.x2 + 1, 9, 36, 'blackstone_bricks');
  p.picture('sign_revue', B.x2 + 2, 9, 35, 'e', 6, 2); // facing east: tiles run north (-z) to the viewer's right
  // roof clutter: AC units and vents
  for (const [x, z] of [[20, 20], [52, 14], [70, 34], [30, 60], [60, 58]]) {
    p.fill(x, B.roofY + 1, z, x + 1, B.roofY + 1, z + 1, 'iron_block');
    p.set(x, B.roofY + 2, z, 'iron_trapdoor_floor');
  }
  // dumpster behind the kitchen
  p.fill(66, 0, -4, 69, 1, -3, 'gray_c');
  p.fill(66, 2, -4, 69, 2, -3, 'iron_trapdoor_floor');
  // lot edge: fence on three sides, a few weeds
  p.fill(LOT.x1, 0, LOT.z1, LOT.x1, 0, LOT.z2, 'fence_dark');
  p.fill(LOT.x1, 0, LOT.z1, 110, 0, LOT.z1, 'fence_dark');
  p.fill(LOT.x1, 0, LOT.z2, 110, 0, LOT.z2, 'fence_dark');
  for (let i = 0; i < 220; i++) {
    const x = rng.int(LOT.x1 + 1, 110);
    const z = rng.int(LOT.z1 + 1, LOT.z2 - 1);
    const nearBuilding = x >= BUILDING.x1 - 4 && x <= BUILDING.x2 + 4 && z >= BUILDING.z1 - 4 && z <= BUILDING.z2 + 4;
    const onLot = x >= 84 && x <= 110 && z >= 0 && z <= 68;
    if (!nearBuilding && !onLot) p.set(x, 0, z, 'tall_grass');
  }
  lastWeekOutside(p);
}

/** Outside, the week before the auction: Walter's car, boarded windows, the notice by the door. */
function lastWeekOutside(p) {
  // Walter's car, where he left it at 3 AM: backed into a bay, headlights on and staring at whoever arrives,
  // the driver's door hanging open, the dome light still glowing
  for (let x = 86; x <= 90; x++) for (let z = 43; z <= 45; z++) p.set(x, 0, z, 'car_body');
  for (const x of [87, 89]) for (const z of [43, 45]) p.set(x, 0, z, 'black_c');
  for (const z of [43, 45]) {
    p.set(90, 0, z, 'headlight');
    p.meta.fixtures.push({ x: 90, y: 0, z, key: 'headlight', room: 'OUTSIDE' });
    p.set(86, 0, z, 'car_tail');
  }
  p.set(90, 0, 44, 'blackstone');
  for (let z = 43; z <= 45; z++) {
    p.set(90, 1, z, 'car_slab');
    p.set(86, 1, z, 'car_slab');
    p.set(89, 1, z, 'window_tint');
    for (let x = 87; x <= 89; x++) p.set(x, 2, z, 'car_slab');
  }
  p.set(87, 1, 43, 'window_tint');
  p.set(87, 1, 45, 'window_tint');
  p.set(88, 1, 45, 'window_tint');
  p.set(88, 1, 43, 'brown_carpet'); // the driver's seat, seen through the open door
  p.set(88, 1, 44, 'brown_carpet');
  p.set(87, 1, 44, 'light5'); // the dome light
  p.meta.fixtures.push({ x: 87, y: 1, z: 44, key: 'light5', room: 'OUTSIDE' });
  for (const y of [0, 1]) p.set(88, y, 42, 'car_door');
  p.set(87, 0, 41, 'decal_puddle_n');
  // the facade: windows boarded over, the auction notice by the doors
  for (const [y, z, k] of [[1, 28, 'across'], [2, 28, 'x'], [1, 29, 'x'], [2, 29, 'across'], [1, 37, 'across'], [2, 37, 'across'],
    [1, 38, 'x'], [2, 38, 'across'], [1, 39, 'across'], [2, 39, 'x'], [1, 40, 'x'], [2, 40, 'across']]) {
    p.set(BUILDING.x2 + 2, y, z, `boards_${k}_e`);
  }
  p.picture('poster_auction', BUILDING.x2 + 2, 3, 31, 'e', 2, 3);
  // rain water standing on the lot, a red light over the staff exit, the dumpster overflowing
  for (const [x, z, d] of [[95, 26, 'n'], [100, 41, 'e'], [91, 55, 's'], [104, 18, 'w'], [83, 38, 'n']]) p.set(x, 0, z, `decal_puddle_${d}`);
  p.set(BUILDING.x1 - 2, 3, 60, 'emerg_true_w');
  p.meta.fixtures.push({ x: BUILDING.x1 - 2, y: 3, z: 60, key: 'emerg_true_w', room: 'OUTSIDE' });
  p.set(70, 0, -4, 'pizza_3_e');
  p.set(71, 0, -3, 'pizza_1_n');
  p.set(64, 0, -4, 'trash_s');
}

// ---------------------------------------------------------------- decor kits

function decor(p) {
  p.setPhase('decor');
  const rng = p.rng.fork(37);
  dining(p, rng);
  midway(p, rng);
  cabaret(p, rng);
  backstage(p, rng);
  kitchen(p, rng);
  restrooms(p, rng);
  foyer(p, rng);
  halls(p, rng);
  supply(p, rng);
  prize(p, rng);
  office(p, rng);
  staff(p, rng);
  gallery(p, rng);
  parts(p, rng);
  lastWeek(p);
  for (const c of CAMERAS) {
    if (!c.mount) continue;
    const [x, y, z, dir] = c.mount;
    p.set(x, y, z, `cctv_${dir}`);
    p.meta.cctv.push({ cam: c.id, x, y, z });
  }
}

function dining(p, rng) {
  const [sx1, sz1, sx2, sz2] = STAGE.box;
  // the stage: boards, a step along the front, side steps
  p.fill(sx1, 0, sz1, sx2, 0, sz2 - 1, 'stage_floor');
  p.fill(sx1, 0, sz2, sx2, 0, sz2, 'dark_oak_stairs_n');
  p.fill(sx1 - 1, 0, 4, sx1 - 1, 0, sz2, 'dark_oak_stairs_e');
  p.fill(sx2 + 1, 0, 4, sx2 + 1, 0, sz2, 'dark_oak_stairs_w');
  // backdrop curtain with stars and the band's equipment
  p.fill(sx1, 1, 1, sx2, 6, 1, 'curtain_red');
  for (const x of [27, 31, 45, 49]) p.set(x, 5, 2, 'star_s');
  for (const x of [35, 41]) p.set(x, 4, 2, 'star_s');
  p.set(38, 6, 2, 'star_s');
  p.set(25, 1, 2, 'speaker_s');
  p.set(51, 1, 2, 'speaker_s');
  p.set(30, 1, 3, 'amp_s');
  // stage lights hanging in front of the stage
  for (const x of [30, 38, 46]) {
    p.set(x, 6, 11, 'spot_false_n');
    p.meta.spots.push({ x, y: 6, z: 11, dir: 'n', group: 'stage' });
  }
  // party tables (1 wide, N-S) with chairs, hats, plates and pizza boxes
  for (const tx of [25, 31, 37, 43, 49, 55]) {
    for (let z = 14; z <= 32; z++) {
      const key = z === 14 ? 'table_1_n' : z === 32 ? 'table_1_s' : 'table_2_n';
      p.set(tx, 0, z, key);
      if (z % 2 === 0 && z > 14 && z < 32) {
        if (rng.chance(0.85)) p.set(tx - 1, 0, z, 'chair_e');
        if (rng.chance(0.85)) p.set(tx + 1, 0, z, 'chair_w');
      }
      const r = rng.next();
      if (r < 0.28) p.set(tx, 1, z, `hat_${rng.int(0, 3)}`);
      else if (r < 0.45) p.set(tx, 1, z, 'plates');
      else if (r < 0.52) p.set(tx, 1, z, `pizza_${rng.int(1, 2)}_${rng.pick(['n', 'e'])}`);
    }
  }
  // posters, drawings, bunting, balloons
  p.picture('poster_revue', 61, 5, 23, 'w', 2, 3);
  p.picture('poster_party', 61, 5, 6, 'w', 2, 2);
  p.picture('poster_rules', 15, 5, 7, 'e', 2, 2);
  p.picture('poster_cabaret', 15, 4, 27, 'e', 2, 3);
  for (let i = 0; i < 6; i++) p.picture('drawing', 30 + i, 3, 37, 'n', 1, 1, rng.int(0, 5));
  for (let i = 0; i < 6; i++) p.picture('drawing', 48 + i, 3, 37, 'n', 1, 1, rng.int(0, 5));
  for (let x = 16; x <= 60; x += 1) if (x < 24 || x > 52) p.set(x, 6, 1, 'bunting_s');
  for (let z = 2; z <= 36; z += 1) if ((z < 9 || z > 12) && (z < 16 || z > 26) && (z < 29 || z > 37)) p.set(15, 6, z, 'bunting_e');
  for (let z = 2; z <= 36; z += 1) if ((z < 8 || z > 12) && (z < 18 || z > 22) && (z < 30 || z > 36)) p.set(61, 6, z, 'bunting_w');
  for (const [x, z] of [[23, 9], [53, 9], [16, 36], [60, 2]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  // exits over the hall entrances and the foyer arch
  for (const [x, y, z, dir] of [[27, 4, 37, 'n'], [45, 4, 37, 'n'], [61, 5, 33, 'w']]) {
    p.set(x, y, z, `exit_true_${dir}`);
    p.meta.exits.push({ x, y, z, dir });
  }
  p.set(61, 0, 27, 'wetsign_w');
  p.set(16, 0, 2, 'trash_e');
  p.set(60, 0, 36, 'trash_w');
  // signs over the Midway arch and the Cabaret mouth (dining side)
  p.picture('sign_midway', 15, 5, 23, 'e', 4, 1);
  p.picture('sign_cabaret', 15, 5, 35, 'e', 3, 1);
}

function midway(p, rng) {
  const { cx, cz, r } = MIDWAY_RING;
  for (let x = cx - r - 1; x <= cx + r + 1; x++) {
    for (let z = cz - r - 1; z <= cz + r + 1; z++) {
      const d = Math.hypot(x + 0.5 - (cx + 0.5), z + 0.5 - (cz + 0.5));
      if (d <= r + 0.35) p.set(x, 0, z, d > r - 0.75 ? 'red_t' : 'stage_floor');
    }
  }
  p.picture('poster_midway', 3, 4, 15, 's', 2, 3);
  for (let x = 1; x <= 13; x++) if (x < 3 || x > 4) p.set(x, 4, 15, 'bunting_s');
  p.set(SHOW_TAPE.x, SHOW_TAPE.y, SHOW_TAPE.z, `tape_4_${SHOW_TAPE.dir}`);
  p.set(12, 0, 16, `balloons_${rng.int(0, 2)}`);
  p.set(1, 0, 27, `balloons_${rng.int(0, 2)}`);
  p.set(2, 0, 16, 'speaker_e');
  p.set(1, 0, 23, 'trash_e');
  p.set(6, 4, 21, 'hanging_off');
  p.meta.hanging.push({ x: 6, y: 4, z: 21, group: 'midway' });
}

function cabaret(p, rng) {
  const [x1, z1, x2, z2] = CABARET.stage;
  p.fill(x1, 0, z1, x2, 0, z2, 'stage_floor');
  for (const z of [30, 33, 36]) p.set(5, 3, z, 'star_e');
  p.set(5, 0, 29, `balloons_${rng.int(0, 2)}`);
  p.set(11, 4, 33, 'spot_false_w');
  p.meta.spots.push({ x: 11, y: 4, z: 33, dir: 'w', group: 'cabaret' });
}

function backstage(p, rng) {
  for (let x = 2; x <= 12; x += 2) p.set(x, 0, 1, 'shelf_s');
  for (let z = 3; z <= 9; z += 2) p.set(1, 0, z, 'shelf_e');
  // workbench with parts
  p.fill(8, 0, 4, 11, 0, 4, 'blackstone_slab_top');
  p.set(9, 1, 4, 'anvil');
  p.set(11, 1, 4, 'pizza_1_n');
  p.set(4, 0, 12, 'barrel_n');
  p.set(5, 0, 12, 'barrel_n');
  p.set(4, 1, 12, 'barrel_n');
  p.set(13, 0, 1, 'mop_n');
  p.picture('poster_rules', 13, 3, 4, 'w', 2, 2);
  p.set(6, 4, 6, 'hanging_off');
  p.meta.hanging.push({ x: 6, y: 4, z: 6, group: 'backstage' });
  if (rng.chance(1)) p.set(2, 0, 12, 'trash_e');
}

function kitchen(p, rng) {
  for (let x = 64; x <= 78; x++) {
    const k = ['smoker_s', 'blast_s', 'furnace_s', 'smoker_s', 'iron_block'][(x - 64) % 5];
    p.set(x, 0, 1, k);
    p.set(x, 3, 1, 'iron_block'); // extractor hood
  }
  p.fill(64, 4, 1, 78, 4, 2, 'iron_trapdoor_ceiling');
  for (const [a, b] of [[65, 69], [73, 77]]) {
    p.fill(a, 0, 7, b, 0, 8, 'iron_block');
    for (let x = a; x <= b; x += 2) p.set(x, 1, 7, rng.chance(0.5) ? 'pizza_2_n' : 'plates');
  }
  for (let z = 4; z <= 12; z += 2) p.set(79, 0, z, 'cauldron');
  for (let z = 5; z <= 11; z += 3) p.set(63, 0, z, 'barrel_e');
  p.set(78, 0, 13, 'trash_w');
  p.set(70, 4, 4, 'hanging_off');
  p.set(74, 4, 11, 'hanging_off');
  p.meta.hanging.push({ x: 70, y: 4, z: 4, group: 'kitchen' }, { x: 74, y: 4, z: 11, group: 'kitchen' });
}

function restrooms(p, _rng) {
  // stall partitions and fixtures
  for (const [zA, zB, wall] of [[15, 19, 20], [21, 25, 20]]) {
    for (const z of [zA + 1, zB - 1]) p.set(79, 0, z, 'toilet_w');
    p.fill(77, 0, (zA + zB) >> 1, 79, 2, (zA + zB) >> 1, 'polished_andesite');
    p.set(69, 0, zA === 15 ? 15 : 25, zA === 15 ? 'sink_s' : 'sink_n');
    void wall;
  }
  p.fill(68, 0, 20, 79, 4, 20, 'smooth_quartz');
  p.picture('sign_staff', 66, 2, 16, 'w', 1, 1, 1);
  p.picture('sign_staff', 66, 2, 22, 'w', 1, 1, 2);
  p.set(63, 0, 25, 'mop_e');
  p.set(64, 0, 15, 'wetsign_s');
}

function foyer(p, _rng) {
  // ticket counter
  p.fill(66, 0, 36, 72, 0, 36, 'dark_oak');
  p.fill(66, 1, 36, 72, 1, 36, 'quartz_slab');
  p.fill(66, 0, 37, 66, 1, 40, 'dark_oak');
  p.set(69, 2, 36, 'timeclock_n');
  p.picture('poster_party', 70, 4, 27, 's', 2, 2);
  p.picture('poster_rules', 75, 4, 27, 's', 2, 2);
  p.picture('poster_missing', 63, 3, 39, 'e', 1, 2);
  // benches along the north wall
  p.fill(74, 0, 28, 78, 0, 28, 'dark_oak_stairs_n');
  p.set(79, 0, 41, 'trash_w');
  p.set(64, 0, 28, 'balloons_1');
}

function halls(p, rng) {
  // West hall: posters and kids' drawings, a trash can, the wet floor sign
  p.picture('poster_rules', 26, 4, 42, 'e', 2, 2);
  for (let z = 44; z <= 54; z += 2) p.picture('drawing', 28, 3, z, 'w', 1, 1, rng.int(0, 5));
  p.picture('poster_missing', 26, 3, 69, 'e', 1, 2);
  p.set(26, 0, 52, 'trash_e');
  p.set(28, 0, 40, 'wetsign_w');
  // East hall
  for (let z = 44; z <= 54; z += 2) p.picture('drawing', 44, 3, z, 'e', 1, 1, rng.int(0, 5));
  p.picture('poster_party', 46, 4, 60, 'w', 2, 2); // the corner poster
  p.picture('poster_revue', 46, 4, 42, 'w', 2, 3);
  p.set(46, 0, 53, 'trash_w');
  // office windows (glass + bars) on both sides
  for (const side of ['L', 'R']) {
    const w = OFFICE.windows[side];
    p.fill(w.x, w.y1, w.z1, w.x, w.y2, w.z2, 'window');
  }
}

function supply(p, _rng) {
  for (const z of [41, 43]) p.set(19, 0, z, 'shelf_e');
  p.set(24, 0, 41, 'shelf_w');
  p.set(19, 0, 50, 'mop_e');
  p.set(20, 0, 50, 'barrel_n');
  p.set(20, 1, 50, 'barrel_n');
  p.set(24, 0, 50, 'wetsign_n');
  p.set(23, 0, 44, 'trash_w');
}

function prize(p, rng) {
  for (const z of [41, 43, 45, 47]) {
    p.set(30, 0, z, 'arcade_0_e');
    p.set(30, 1, z, 'arcade_1_e');
    p.set(42, 0, z, 'arcade_0_w');
    p.set(42, 1, z, 'arcade_1_w');
  }
  // prize counter
  p.fill(32, 0, 52, 40, 0, 52, 'dark_oak');
  p.fill(32, 1, 52, 40, 1, 52, 'window');
  for (let x = 32; x <= 40; x += 2) p.set(x, 0, 55, rng.chance(0.5) ? 'plush_n' : 'shelf_n');
  for (let x = 33; x <= 39; x += 2) p.set(x, 0, 56, 'plush_n');
  p.set(31, 0, 39, `balloons_${rng.int(0, 2)}`);
  p.set(41, 0, 39, `balloons_${rng.int(0, 2)}`);
}

function office(p, rng) {
  // desk: a solid back row against the north wall, a slab top in front
  p.fill(33, 0, 60, 39, 0, 60, 'stripped_dark_oak_x');
  p.fill(33, 0, 61, 39, 0, 61, 'dark_oak_slab_top');
  const m = OFFICE.monitor;
  p.set(m.x, m.y, m.z, `crt_true_${m.dir}`);
  p.set(34, 1, 60, 'fan_s');
  p.set(OFFICE.phone.x, OFFICE.phone.y, OFFICE.phone.z, `phone_false_${OFFICE.phone.dir}`);
  p.set(35, 1, 60, 'clutter_s');
  p.set(37, 1, 61, 'clutter_s');
  p.set(39, 1, 61, 'plush_s');
  p.set(33, 1, 61, 'plates');
  // posters and drawings on the walls
  p.picture('poster_party', 34, 4, 60, 's', 2, 2);
  for (let i = 0; i < 3; i++) p.picture('drawing', 37 + i, 3, 60, 's', 1, 1, rng.int(0, 5));
  p.picture('drawing', 38, 2, 60, 's', 1, 1, 5);
  p.picture('poster_revue', 35, 4, 70, 'n', 2, 3);
  p.picture('drawing', 32, 3, 61, 'e', 1, 1, 2);
  p.picture('drawing', 40, 3, 61, 'w', 1, 1, 0);
  p.set(39, 0, 70, 'trash_n');
  p.set(33, 0, 70, 'locker_0_n');
  p.set(33, 1, 70, 'locker_1_n');
}

function staff(p, _rng) {
  // time-clock terminal wall (north): buttons with labels; stars above
  for (const b of LOBBY_BUTTONS) {
    p.set(b.x, 1, b.z, 'button_s');
    p.sign(b.x, 2, b.z, 's', b.lines);
  }
  p.set(8, 3, 52, 'timeclock_s');
  // lockers on the west wall, a couch, a table
  for (const z of [55, 57, 59]) {
    p.set(1, 0, z, 'locker_0_e');
    p.set(1, 1, z, 'locker_1_e');
  }
  p.fill(14, 0, 64, 14, 0, 68, 'dark_oak_stairs_w');
  p.fill(15, 0, 64, 16, 0, 68, 'red_wool');
  p.fill(8, 0, 66, 10, 0, 67, 'dark_oak_slab_top');
  p.set(9, 1, 66, 'pizza_1_n');
  p.picture('poster_missing', 16, 3, 55, 'w', 1, 2);
  p.picture('poster_rules', 3, 4, 70, 'n', 2, 2);
  p.set(16, 0, 70, 'trash_w');
}

function gallery(p, _rng) {
  // six pedestals with a spotlight each (the extras gallery)
  for (const [i, [x, z]] of [[3, 42], [8, 42], [13, 42], [3, 48], [8, 48], [13, 48]].entries()) {
    p.set(x, 0, z, 'quartz_pillar');
    p.set(x, 4, z + (z < 45 ? 1 : -1), z < 45 ? 'spot_true_n' : 'spot_true_s');
    p.meta.spots.push({ x, y: 4, z: z + (z < 45 ? 1 : -1), dir: z < 45 ? 'n' : 's', group: 'gallery', slot: i });
  }
}

function parts(p, _rng) {
  // Parts & Service: the workshop where the band was kept running, and six crates waiting for the auction.
  // shelves of spares along the north wall (the door to the foyer is at x 70-71)
  const north = [[49, 'head_rustgrin_s'], [51, 'endo_skull_s'], [53, 'head_cat_s'], [55, null], [57, 'head_noxbriar_s'], [59, 'endo_skull_s'],
    [61, 'head_mirehop_s'], [63, null], [65, 'head_rat_s'], [67, 'head_rustgrin_s']];
  for (const [x, top] of north) {
    p.set(x, 0, 43, 'shelf_s');
    if (top) p.set(x, 1, 43, top);
  }
  for (const z of [46, 49, 52, 55, 58, 61]) p.set(79, 0, z, 'shelf_w');
  p.set(79, 1, 49, 'head_mirehop_w');
  p.set(79, 1, 55, 'endo_skull_w');
  p.set(79, 1, 61, 'head_cat_w');
  // two workbenches under hanging lamps: parts laid out mid-repair
  for (const [x1, x2, z] of [[53, 59, 52], [65, 71, 52]]) {
    p.fill(x1, 0, z, x2, 0, z, 'dark_oak_slab_top');
    p.fill(x1, 0, z + 1, x2, 0, z + 1, 'dark_oak_slab_top');
  }
  p.set(54, 1, 52, 'endo_arm_s');
  p.set(56, 1, 53, 'head_rustgrin_e');
  p.set(58, 1, 52, 'endo_skull_w');
  p.set(59, 1, 53, 'pizza_2_n');
  p.set(66, 1, 53, 'endo_arm_e');
  p.set(68, 1, 52, 'head_rat_s');
  p.set(70, 1, 53, 'endo_skull_s');
  p.set(71, 1, 52, 'plates');
  p.set(56, 0, 55, 'endo_stand_n');
  p.set(68, 0, 50, 'endo_stand_s');
  p.set(56, 4, 52, 'hanging_off');
  p.set(68, 4, 52, 'hanging_off');
  p.meta.hanging.push({ x: 56, y: 4, z: 52, group: 'parts' }, { x: 68, y: 4, z: 52, group: 'parts' });
  p.set(64, 4, 56, 'hanging_off');
  p.meta.hanging.push({ x: 64, y: 4, z: 56, group: 'parts' });
  // six upright shipping crates against the south wall, LOT 1 to LOT 6: open, empty, chains hanging inside.
  // LOT 4 is nailed shut.
  for (let i = 0; i < 6; i++) {
    const a = 52 + i * 4; // left wall column; the cavity is a + 1, the right wall a + 2
    p.fill(a, 0, 69, a + 2, 3, 70, 'spruce');
    p.fill(a, 0, 68, a, 3, 68, 'stripped_spruce');
    p.fill(a + 2, 0, 68, a + 2, 3, 68, 'stripped_spruce');
    p.fill(a + 1, 3, 68, a + 1, 3, 68, 'spruce');
    p.fill(a + 1, 0, 68, a + 1, 2, 69, 'air');
    p.set(a + 1, 0, 69, 'brown_carpet');
    p.set(a + 1, 2, 69, 'chain_y');
    p.set(a + 1, 1, 69, 'chain_y');
    p.picture('lot_tag', a, 2, 67, 'n', 1, 1, i);
    if (i === 3) for (const y of [0, 1, 2]) p.set(a + 1, y, 67, `boards_${y === 1 ? 'x' : 'across'}_n`);
  }
  // two free-standing shelf rows, back to back, between the benches and the crates
  for (const x0 of [53, 65]) {
    for (let x = x0; x <= x0 + 6; x += 2) {
      p.set(x, 0, 58, 'shelf_n');
      p.set(x, 0, 59, 'shelf_s');
    }
  }
  for (const [x, z, k] of [[53, 58, 'head_cat_n'], [57, 58, 'endo_skull_n'], [59, 59, 'head_rustgrin_s'], [67, 58, 'head_noxbriar_n'],
    [69, 59, 'endo_skull_s'], [71, 58, 'head_mirehop_n'], [55, 59, 'pizza_3_n']]) p.set(x, 1, z, k);
  p.set(62, 0, 48, 'endo_stand_e');
  p.set(73, 0, 45, 'endo_stand_w'); // waiting by the door, facing whoever comes in
  p.set(76, 0, 47, 'head_rustgrin_n');
  p.set(66, 0, 46, 'decal_puddle_e');
  p.set(57, 0, 47, 'decal_debris_n');
  p.set(75, 0, 55, 'endo_stand_w');
  p.set(79, 0, 67, 'suit_mirehop_w');
  for (const [x, z] of [[77, 69], [78, 69], [77, 70]]) p.set(x, 0, z, 'barrel_n');
  p.set(78, 0, 70, 'pizza_3_w');
  // the crates' lids, leaned against the west wall; a tarp over something by the corner
  p.fill(48, 0, 46, 48, 2, 47, 'spruce');
  p.fill(49, 0, 66, 51, 0, 68, 'black_wool');
  p.fill(50, 1, 67, 50, 1, 67, 'black_carpet');
  // an empty costume against the west wall, a red emergency light over each end of the room
  p.set(48, 0, 60, 'suit_rustgrin_e');
  p.set(48, 0, 56, 'barrel_n');
  p.set(48, 1, 56, 'barrel_n');
  fixture(p, 48, 3, 51, 'emerg_true_e', 'parts');
  fixture(p, 79, 3, 64, 'emerg_true_w', 'parts');
  fixture(p, 62, 5, 58, 'lamp_broken', 'parts');
  // chain hoists, dust and drag marks, faint footprints from the crates to the door
  for (const [x, z] of [[61, 50], [73, 58]]) p.fill(x, 3, z, x, 4, z, 'chain_y');
  p.set(60, 0, 64, 'decal_drag_n');
  p.set(60, 0, 62, 'decal_drag_n');
  for (const [x, z] of [[65, 66], [66, 62], [67, 58], [68, 54], [69, 49], [70, 45]]) p.set(x, 0, z, 'decal_prints_faint_n');
  p.set(62, 0, 58, 'decal_debris_n');
  p.set(75, 0, 47, 'decal_puddle_n');
  p.set(77, 0, 66, 'mop_w');
  p.set(78, 0, 44, 'trash_w');
  for (const [x, z] of [[48, 43], [79, 43], [48, 70]]) p.set(x, 4, z, 'cobweb');
  p.set(64, 4, 61, 'wires_bundle_n');
  p.set(72, 4, 50, 'wires_box_e');
}

/** A light that is built lit and never switched by the game (the last fixtures still working). */
function fixture(p, x, y, z, key, room) {
  p.set(x, y, z, key);
  p.meta.fixtures.push({ x, y, z, key, room });
}

// ---------------------------------------------------------------- the last week: decay, dread, implication
// Runs after every room's own decor (p.flush() first, so these cells win over what the rooms placed).
// Nothing here may stand in an animatronic's path or a camera's line of sight (tools/map/validate_map.mjs).

/** One picture out of the wall_writing block (see WRITING in palette.js). */
function writing(p, which, x, y, z, dir) {
  const [first, w, h] = WRITING[which];
  p.picture('wall_writing', x, y, z, dir, w, h, null, first);
}

function lastWeek(p) {
  p.flush();
  decayDining(p);
  decayMarquee(p);
  decayMidway(p);
  decayBackstage(p);
  decayKitchen(p);
  decayRestrooms(p);
  decayFoyer(p);
  decayHalls(p);
  decaySupply(p);
  decayPrize(p);
  decayOffice(p);
  decayStaff(p);
}

function decayDining(p) {
  // the last birthday party nobody cleaned up: one candle still burning under a flickering lamp
  fixture(p, 49, 1, 24, 'bday_true_e', 'DINING');
  for (const z of [23, 25]) p.set(49, 1, z, 'plates');
  p.set(49, 1, 22, 'hat_2');
  p.set(49, 1, 26, 'hat_0');
  p.set(49, 1, 21, 'pizza_1_e');
  p.set(48, 0, 22, 'fallen_e');
  p.set(50, 0, 24, 'fallen_w');
  p.set(48, 0, 25, 'hat_1');
  p.set(51, 0, 23, 'hat_3');
  p.set(51, 0, 21, 'balloons_2');
  p.set(51, 0, 25, 'decal_confetti_n');
  p.set(47, 0, 23, 'decal_confetti_e');
  fixture(p, 48, 7, 23, 'lamp_broken', 'DINING');
  // more chairs knocked over, party hats on the floor
  for (const [x, z, k] of [[32, 20, 'fallen_w'], [42, 30, 'fallen_e'], [56, 16, 'fallen_w'], [24, 28, 'fallen_e'], [38, 14, 'fallen_w']]) p.set(x, 0, z, k);
  for (const [x, z, c] of [[34, 17, 1], [46, 29, 0], [28, 23, 3], [52, 15, 2], [35, 31, 0]]) p.set(x, 0, z, `hat_${c}`);
  // fallen ceiling tiles: the void above, wires hanging out of it, debris (and a puddle) below
  for (const [x, z, wire] of [[41, 29, 'wires_bundle_n'], [21, 16, 'wires_box_e'], [54, 30, null], [28, 9, 'wires_bundle_w']]) {
    p.set(x, 7, z, 'ceiling_missing');
    if (wire) p.set(x, 6, z, wire);
    p.set(x, 0, z, 'decal_debris_n');
  }
  p.set(54, 0, 31, 'decal_puddle_n');
  // ADMIT ONE: ticket stubs trailing from the tables to the Ringmaster's stage
  /** @type {[number, number, string][]} */
  const stubs = [[33, 34, 'tickets'], [28, 32, 'tickets_b'], [25, 34, 'tickets'], [22, 33, 'tickets_b'], [19, 34, 'tickets'], [17, 32, 'tickets_b'], [15, 33, 'tickets']];
  for (const [x, z, k] of stubs) p.set(x, 0, z, `decal_${k}_${['n', 'e', 's', 'w'][(x + z) % 4]}`);
  // one chair set out alone, facing his stage
  p.set(16, 0, 30, 'chair_w');
  // the performers have been tagged for the auction: LOT 1-3 pinned to the stage curtain behind them
  p.picture('lot_tag', 38, 2, 2, 's', 1, 1, 0); // Rustgrin
  p.picture('lot_tag', 32, 2, 2, 's', 1, 1, 1); // Mirehop
  p.picture('lot_tag', 44, 2, 2, 's', 1, 1, 2); // Noxbriar
  p.picture('poster_torn', 61, 5, 27, 'w', 2, 2);
  p.picture('poster_auction', 15, 4, 14, 'e', 2, 3);
  for (const [x, z] of [[15, 1], [61, 1], [15, 37], [24, 2], [52, 2]]) p.set(x, 6, z, 'cobweb');
}

function decayMarquee(p) {
  // the trail of tickets ends at his feet; LOT 6 is pinned beside him
  for (const [x, y, z, k] of [[13, 0, 33, 'tickets_e'], [12, 1, 34, 'tickets_b_s'], [11, 1, 32, 'tickets_n'], [10, 1, 33, 'tickets_b_w'], [8, 1, 35, 'tickets_e']]) {
    p.set(x, y, z, `decal_${k}`);
  }
  p.picture('lot_tag', 4, 2, 31, 'e', 1, 1, 5);
  for (const z of [29, 37]) p.set(4, 4, z, 'cobweb');
}

function decayMidway(p) {
  // the ring floor stays clear: LOT 4 and LOT 5 hang on the wall behind it, over the show tape
  p.picture('lot_tag', 5, 2, 27, 'n', 1, 1, 3); // the Cat
  p.picture('lot_tag', 7, 2, 27, 'n', 1, 1, 4); // the Purple Rat
  for (const [x, z] of [[1, 15], [1, 27]]) p.set(x, 4, z, 'cobweb');
  p.set(2, 0, 25, 'decal_confetti_n');
  p.set(12, 0, 19, 'decal_tickets_b_e');
}

function decayBackstage(p) {
  // CAM 5: every shelf has a face on it, watching the camera, under the Ringmaster's motto
  writing(p, 'show', 5, 3, 1, 's');
  const top = [[2, 'head_rustgrin_s'], [4, 'head_mirehop_s'], [6, 'head_cat_s'], [8, 'endo_skull_s'], [10, 'head_noxbriar_s'], [12, 'head_rat_s']];
  for (const [x, k] of top) p.set(x, 1, 1, k);
  for (const [z, k] of [[3, 'head_rustgrin_e'], [5, 'endo_skull_e'], [7, 'head_mirehop_e'], [9, 'head_cat_e']]) p.set(1, 1, z, k);
  // the workbench: a head being repaired, an arm, a skull
  p.set(8, 1, 4, 'head_rustgrin_s');
  p.set(9, 1, 4, 'endo_arm_s');
  p.set(10, 1, 4, 'endo_skull_s');
  p.set(11, 0, 7, 'endo_stand_s');
  // a second table nearer the camera: an endoskeleton half put together, a Cat head waiting for it
  p.fill(3, 0, 5, 5, 0, 6, 'dark_oak_slab_top');
  p.set(3, 1, 5, 'endo_arm_e');
  p.set(4, 1, 6, 'head_cat_s');
  p.set(5, 1, 5, 'endo_skull_s');
  p.set(3, 1, 6, 'pizza_2_e');
  p.set(4, 0, 8, 'endo_stand_s');
  p.set(12, 0, 3, 'amp_w');
  p.set(7, 0, 12, 'speaker_n');
  // an empty Mirehop costume slumped in the corner
  p.set(1, 0, 11, 'suit_mirehop_e');
  p.set(2, 0, 12, 'air');
  p.set(3, 0, 12, 'trash_n');
  fixture(p, 13, 3, 8, 'emerg_true_w', 'BACKSTAGE');
  p.set(4, 4, 4, 'wires_bundle_n');
  p.set(3, 4, 10, 'wires_box_s');
  for (const [x, z] of [[1, 1], [13, 13]]) p.set(x, 4, z, 'cobweb');
  // something heavy was dragged in from the stage door
  for (const [x, z] of [[12, 11], [10, 10]]) p.set(x, 0, z, 'decal_drag_w');
}

function decayKitchen(p) {
  fixture(p, 68, 5, 10, 'lamp_broken', 'KITCHEN');
  fixture(p, 63, 3, 3, 'emerg_true_e', 'KITCHEN');
  p.set(75, 5, 5, 'ceiling_missing');
  p.set(75, 4, 5, 'wires_bundle_e');
  p.set(75, 0, 5, 'decal_debris_n');
  p.set(73, 1, 8, 'pizza_3_e');
  p.set(77, 1, 7, 'pizza_2_n');
  p.set(75, 0, 12, 'decal_puddle_n');
  p.set(67, 0, 12, 'decal_puddle_e');
  for (const [x, z] of [[64, 13], [79, 1]]) p.set(x, 4, z, 'cobweb');
}

function decayRestrooms(p) {
  fixture(p, 64, 5, 20, 'lamp_broken', 'RESTROOMS');
  p.picture('sign_out_of_order', 66, 3, 24, 'w', 2, 1);
  p.set(64, 0, 19, 'decal_puddle_n');
  p.set(65, 0, 24, 'decal_puddle_e');
  p.set(66, 4, 15, 'cobweb');
}

function decayFoyer(p) {
  p.picture('poster_auction', 70, 4, 27, 's', 2, 3);
  p.set(79, 0, 33, 'decal_puddle_n');
  for (const [x, z] of [[76, 33], [73, 34], [70, 33]]) p.set(x, 0, z, 'decal_prints_faint_e');
  p.set(68, 0, 35, 'decal_tickets_n');
  for (const [x, z] of [[63, 41], [79, 27]]) p.set(x, 4, z, 'cobweb');
}

function decayHalls(p) {
  // West Hall (CAM 2A): the wet floor sign's puddle, and wet footprints walking south towards the office
  p.set(27, 0, 41, 'decal_puddle_n');
  for (const [z, k] of [[43, 'prints'], [46, 'prints'], [49, 'prints_faint'], [52, 'prints_faint'], [55, 'prints_faint']]) p.set(27, 0, z, `decal_${k}_s`);
  writing(p, 'show', 26, 4, 52, 'e');
  p.picture('poster_torn', 26, 4, 42, 'e', 2, 2); // over the old rules poster, right in CAM 2A's face
  p.set(26, 5, 47, 'ceiling_missing');
  p.set(26, 4, 47, 'wires_bundle_e');
  p.set(26, 0, 47, 'decal_debris_n');
  p.set(28, 4, 56, 'cobweb');
  // W. Hall Corner (CAM 2B, and through the left door when its light is on)
  writing(p, 'name', 26, 4, 67, 'e');
  p.set(30, 4, 70, 'cobweb');
  // East Hall (CAM 4A): somebody counted, then stopped counting
  writing(p, 'scratches', 46, 3, 50, 'w');
  p.set(46, 5, 45, 'ceiling_missing');
  p.set(46, 4, 45, 'wires_box_w');
  p.set(46, 0, 45, 'decal_debris_n');
  p.set(44, 0, 52, 'decal_puddle_n');
  p.set(44, 4, 56, 'cobweb');
  // the nook where Rustgrin waits (CAM 4B)
  writing(p, 'scratches', 45, 2, 70, 'n');
  p.set(46, 4, 70, 'cobweb');
}

function decaySupply(p) {
  p.set(22, 0, 50, 'suit_rustgrin_n');
  fixture(p, 19, 3, 47, 'emerg_true_e', 'SUPPLY');
  p.set(23, 0, 48, 'decal_puddle_n');
  p.set(24, 4, 50, 'cobweb');
}

function decayPrize(p) {
  for (const [x, z] of [[30, 41], [42, 47]]) p.set(x, 2, z, 'cobweb');
  p.set(36, 0, 45, 'decal_tickets_b_n');
  p.set(33, 0, 49, 'decal_tickets_e');
  p.set(37, 0, 50, 'plush_s');
}

function decayOffice(p) {
  // Walter's things, where he left them at 3 AM: the notice for the auction over his desk
  p.picture('poster_auction', 34, 4, 60, 's', 2, 3);
  p.set(33, 1, 61, 'walter_desk_s');
  fixture(p, 35, 0, 69, 'walter_flashlight_w', 'OFFICE');
  writing(p, 'tally', 32, 3, 68, 'e');
  p.set(40, 4, 70, 'cobweb');
  // behind the seat: a tile has come down, and something has walked in through the left door
  p.set(38, 5, 69, 'ceiling_missing');
  p.set(38, 4, 69, 'wires_bundle_s');
  p.set(38, 0, 68, 'decal_debris_n');
  for (const [x, z] of [[32, 66], [34, 67]]) p.set(x, 0, z, 'decal_prints_faint_e');
}

function decayStaff(p) {
  p.picture('poster_torn', 16, 4, 62, 'w', 2, 2);
  p.set(16, 4, 70, 'cobweb');
}

// ---------------------------------------------------------------- lights and controls

function lights(p) {
  p.setPhase('lights');
  const used = new Set([...Object.values(OFFICE.vents).map((v) => `${v.x},${v.y},${v.z}`), `${OFFICE.lamp.x},${OFFICE.lamp.y},${OFFICE.lamp.z}`]);
  for (const d of Object.values(DUCTS)) used.add(`${d.grate.x},${d.grate.y},${d.grate.z}`);
  const groupOf = { DINING: 'dining', WEST_HALL: 'hall_w', W_CORNER: 'hall_w', EAST_HALL: 'hall_e', E_CORNER: 'hall_e', OFFICE: 'office' };
  for (const r of ROOMS) {
    if (['MIDWAY', 'CABARET', 'BACKSTAGE', 'GALLERY', 'PARTS', 'OFFICE', 'W_CORNER', 'E_CORNER'].includes(r.id)) continue;
    const [x1, z1, x2, z2] = r.box;
    const step = r.id === 'DINING' ? 7 : 5;
    const nx = Math.max(1, Math.round((x2 - x1 + 1) / step));
    const nz = Math.max(1, Math.round((z2 - z1 + 1) / step));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = Math.round(x1 + ((i + 0.5) * (x2 - x1 + 1)) / nx - 0.5);
        const z = Math.round(z1 + ((j + 0.5) * (z2 - z1 + 1)) / nz - 0.5);
        const k = `${x},${r.h},${z}`;
        if (used.has(k)) continue;
        if (r.id === 'DINING' && z <= STAGE.box[3] + 1) continue; // stage area: spotlights instead
        used.add(k);
        p.set(x, r.h, z, 'lamp_off');
        p.meta.lamps.push({ x, y: r.h, z, room: r.id, group: groupOf[r.id] ?? r.id.toLowerCase() });
      }
    }
  }
  // the office lamp (on at night)
  const L = OFFICE.lamp;
  p.set(L.x, L.y, L.z, 'lamp_on');
  p.meta.lamps.push({ x: L.x, y: L.y, z: L.z, room: 'OFFICE', group: 'office' });
  // the two hall-light lamps outside the doors
  for (const side of ['L', 'R']) {
    const h = OFFICE.hallLights[side].lamp;
    p.set(h.x, h.y, h.z, 'lamp_off');
    p.meta.lamps.push({ x: h.x, y: h.y, z: h.z, room: side === 'L' ? 'W_CORNER' : 'E_CORNER', group: side === 'L' ? 'door_l' : 'door_r' });
  }
}

function controls(p) {
  p.setPhase('controls');
  for (const [, b] of Object.entries(OFFICE.buttons)) p.set(b.x, b.y, b.z, `${b.kind}_false_${b.dir}`);
  for (const v of Object.values(OFFICE.vents)) p.set(v.x, v.y, v.z, 'vent_open');
  // door cells start open
  for (const side of ['L', 'R']) {
    const d = OFFICE.doors[side];
    p.fill(d.x, d.y1, d.z1, d.x, d.y2, d.z2, 'air');
    p.fill(d.x, d.y2 + 1, d.z1, d.x, d.y2 + 1, d.z2, 'blackstone');
  }
}

function signs(p) {
  p.setPhase('signs');
  p.sign(27, 3, 39, 's', ['WEST HALL', '', 'OFFICE', 'v']);
  p.sign(45, 3, 39, 's', ['EAST HALL', '', 'OFFICE', 'v']);
  p.sign(25, 2, 47, 'e', ['SUPPLY', 'CLOSET']);
  p.sign(63, 2, 11, 'e', ['KITCHEN', 'Staff only']);
  p.sign(32, 2, 69, 'e', ['NIGHT GUARD', 'Doors: red', 'Lights: white', 'Power is finite']);
  p.sign(15, 3, 31, 'e', ['THE GRAND', 'MARQUEE', 'private stage', 'do not disturb']);
  p.sign(33, 1, 60, 's', ['', 'LEFT VENT', '^']);
  p.sign(39, 1, 60, 's', ['', 'RIGHT VENT', '^']);
  p.sign(BUILDING.x2 + 2, 2, 35, 'e', ['FINAL WEEKEND', 'Everything', 'must go!', 'Auction Sat.']);
}

/** Generate the full plan. */
export function generatePlan(seed = 1991) {
  const p = new PlanBuilder(seed);
  ground(p);
  shell(p);
  rooms(p);
  openings(p);
  ducts(p);
  exterior(p);
  decor(p);
  lights(p);
  controls(p);
  signs(p);
  return p.finish();
}

export { STYLES, ROOM_BY_ID };
