// Deterministic build plan for Rustgrin's Pizza Revue (pure data -> ops).
//
// generatePlan() returns { ops: { phase: op[] }, meta } (see plan.js for the
// op format). The same function runs in the game (mc/builder.js executes the
// ops) and in Node (tools/map/export_voxels.mjs turns the ops into a voxel
// snapshot for the preview renderer and the map validators), so what the
// tools check is exactly what gets built.

import { PlanBuilder } from './plan.js';
import { BUILDING, LOT, ROOMS, ROOM_BY_ID, OPENINGS, OFFICE, DUCTS, STAGE, MIDWAY_RING, SHOW_TAPE, CABARET } from './layout.js';
import { WRITING, NEON } from './palette.js';
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
  prize: { floor: ['carpet'], ceiling: ['ceiling'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, 'wallpaper_party']] },
  parts: { floor: ['smooth_stone', 'smooth_stone', 'polished_andesite'], ceiling: ['blackstone'], bands: [[0, 9, ['cinder', 'cinder', 'cinder', 'cracked_bricks']]] },
  funzone: { floor: ['carpet'], ceiling: ['ceiling', 'ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, 'wallpaper_party']] },
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
  p.fill(43, 0, 68, 43, ROOM_BY_ID.E_CORNER.h - 1, 70, 'cinder');
  p.fill(43, 2, 68, 43, 2, 70, 'trim');
}

function ducts(p) {
  p.setPhase('ducts');
  for (const d of Object.values(DUCTS)) {
    for (const [x1, y1, z1, x2, y2, z2] of d.boxes) p.fill(x1 - 1, y1 - 1, z1 - 1, x2 + 1, y2 + 1, z2 + 1, 'duct');
  }
  // the shafts down to the grates and vents: lined with duct metal
  for (const d of Object.values(DUCTS)) for (const [x, y, z] of d.risers) p.fill(x - 1, y, z - 1, x + 1, y, z + 1, 'duct');
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
  funzone(p);
  parts(p, rng);
  lastWeek(p);
  for (const c of CAMERAS) {
    if (!c.mount) continue;
    const [x, y, z, dir, kind] = c.mount;
    p.set(x, y, z, kind === 'ceiling' ? `cctv_ceil_${dir}` : `cctv_${dir}`);
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
  // backdrop: red velvet wings framing a gold tinsel curtain, stars, the band's equipment
  p.fill(sx1, 1, 1, sx2, 6, 1, 'curtain_red');
  p.fill(sx1 + 6, 1, 1, sx2 - 6, 6, 1, 'tinsel');
  // the light rig: a box truss hung across the front of the stage (the spotlights hang in it) and down both sides
  for (let x = sx1; x <= sx2; x++) if (![30, 38, 46].includes(x)) p.set(x, 6, 11, 'truss_e');
  for (let z = 3; z <= 10; z++) {
    p.set(sx1, 6, z, 'truss_n');
    p.set(sx2, 6, z, 'truss_n');
  }
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
  for (const [x, y, z, dir] of [[27, 5, 37, 'n'], [45, 5, 37, 'n'], [61, 5, 33, 'w']]) { // high above the hall doors: no glow spills into the halls
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
  for (let x = 1; x <= 13; x++) if (x < 3 || x > 4) p.set(x, 6, 15, 'bunting_s');
  p.set(SHOW_TAPE.x, SHOW_TAPE.y, SHOW_TAPE.z, `tape_4_${SHOW_TAPE.dir}`);
  p.set(12, 0, 16, `balloons_${rng.int(0, 2)}`);
  p.set(1, 0, 27, `balloons_${rng.int(0, 2)}`);
  p.set(2, 0, 16, 'speaker_e');
  p.set(1, 0, 23, 'trash_e');
  p.set(6, 6, 21, 'hanging_off');
  p.meta.hanging.push({ x: 6, y: 6, z: 21, group: 'midway' });
}

function cabaret(p, rng) {
  const [x1, z1, x2, z2] = CABARET.stage;
  p.fill(x1, 0, z1, x2, 0, z2, 'stage_floor');
  for (const z of [30, 33, 36]) p.set(5, 3, z, 'star_e');
  p.set(5, 0, 29, `balloons_${rng.int(0, 2)}`);
  // his spotlight hangs at the stage's far front corner, out of CAM 1C's view (the camera is high in the other corner)
  p.set(11, 6, 36, 'spot_false_w');
  p.meta.spots.push({ x: 11, y: 6, z: 36, dir: 'w', group: 'cabaret' });
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
  p.set(6, 5, 6, 'hanging_off');
  p.meta.hanging.push({ x: 6, y: 5, z: 6, group: 'backstage' });
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
  p.set(70, 5, 4, 'hanging_off');
  p.set(74, 5, 11, 'hanging_off');
  p.meta.hanging.push({ x: 70, y: 5, z: 4, group: 'kitchen' }, { x: 74, y: 5, z: 11, group: 'kitchen' });
}

function restrooms(p, _rng) {
  // stall partitions and fixtures
  for (const [zA, zB, wall] of [[15, 19, 20], [21, 25, 20]]) {
    for (const z of [zA + 1, zB - 1]) p.set(79, 0, z, 'toilet_w');
    p.fill(77, 0, (zA + zB) >> 1, 79, 2, (zA + zB) >> 1, 'polished_andesite');
    p.set(69, 0, zA === 15 ? 15 : 25, zA === 15 ? 'sink_s' : 'sink_n');
    void wall;
  }
  p.fill(68, 0, 20, 79, ROOM_BY_ID.MENS.h - 1, 20, 'smooth_quartz');
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
  // the Prize Corner: arcade rows, the prize counter in glass cases and a whole wall of plush prizes behind it
  for (const z of [41, 43, 45, 47]) {
    p.set(31, 0, z, 'arcade_0_e');
    p.set(31, 1, z, 'arcade_1_e');
    p.set(41, 0, z, 'arcade_0_w');
    p.set(41, 1, z, 'arcade_1_w');
  }
  for (let x = 33; x <= 39; x++) p.set(x, 0, 52, 'prizecase_n');
  for (const x of [32, 40]) p.set(x, 0, 52, 'dark_oak');
  for (let x = 31; x <= 41; x++) for (const y of [1, 2, 3]) p.set(x, y, 56, 'plushwall_n');
  for (const x of [32, 35, 38, 40]) p.set(x, 0, 55, rng.chance(0.5) ? 'pizza_3_n' : 'barrel_n'); // stock behind the counter
  neon(p, 'prizes', 37, 4, 56, 'n');
  neon(p, 'star', 40, 4, 56, 'n');
  neon(p, 'star', 32, 4, 56, 'n');
  neon(p, 'games', 36, 4, 39, 's');
  p.set(32, 0, 39, `balloons_${rng.int(0, 2)}`);
  p.set(40, 0, 39, `balloons_${rng.int(0, 2)}`);
}

/** One sign out of the neon_sign block (see NEON in palette.js). */
function neon(p, which, x, y, z, dir) {
  const [first, w, h] = NEON[which];
  p.picture('neon_sign', x, y, z, dir, w, h, null, first);
}

function funzone(p) {
  // The Fun Zone (x 48-79, z 43-61, 7 tall): a play structure over a ball pit, skee-ball, arcades, kiddie rides and a
  // party room. Bright and loud by day; at night only the neon, the game lights and the coin slots are still on.
  const VINYL = ['vinyl_red', 'vinyl_blue', 'vinyl_yellow', 'vinyl_green'];
  // ---- the ball pit (x 50-59, z 50-60): padded walls two high (blue, a yellow top rail), balls a block and a half deep
  for (let x = 50; x <= 59; x++) {
    for (let z = 50; z <= 60; z++) {
      const wall = x === 50 || x === 59 || z === 50 || z === 60;
      if (wall) {
        p.set(x, 0, z, 'vinyl_blue');
        p.set(x, 1, z, 'vinyl_yellow');
      } else {
        p.set(x, 0, z, 'balls');
        p.set(x, 1, z, 'balls_top');
      }
    }
  }
  neon(p, 'funzone', 56, 5, 61, 'n'); // over the ball pit
  // ---- the play structure (x 49-55, z 43-47): a padded deck two blocks up on red posts, net railings, a slide
  for (const [x, z] of [[49, 43], [55, 43], [49, 47], [55, 47]]) p.fill(x, 0, z, x, 1, z, 'vinyl_red');
  p.fill(55, 0, 44, 55, 1, 46, 'vinyl_yellow'); // the east side is closed in; the ladder goes up it
  p.set(55, 1, 45, 'air'); // a crawl hole into the dark under the deck
  p.fill(49, 2, 43, 55, 2, 47, 'vinyl_blue');
  for (let x = 50; x <= 54; x++) if (x !== 52) p.set(x, 0, 47, 'balls_top'); // balls spilled under the deck
  for (const y of [0, 1]) p.set(56, y, 45, 'ladder_e');
  for (const [x, z] of [[49, 43], [55, 43], [49, 47], [55, 47]]) p.fill(x, 3, z, x, 4, z, 'vinyl_red'); // railing posts
  for (let x = 50; x <= 54; x++) {
    p.picture('play_net', x, 3, 43, 's', 1, 1, x % 2);
    if (x !== 52) p.picture('play_net', x, 3, 47, 'n', 1, 1, (x + 1) % 2);
  }
  for (const z of [44, 45, 46]) p.picture('play_net', 49, 3, z, 'e', 1, 1, z === 45 ? 1 : 0);
  // a crawl tube out of the deck to a second, lower platform (x 60-62)
  for (let x = 56; x <= 59; x++) p.set(x, 3, 45, x === 58 ? 'tube_win_green_e' : `tube_${x % 2 ? 'red' : 'yellow'}_e`);
  for (const [x, z] of [[60, 44], [62, 44], [60, 46], [62, 46]]) p.fill(x, 0, z, x, 1, z, 'vinyl_green');
  p.fill(60, 2, 44, 62, 2, 46, 'vinyl_blue');
  for (const x of [61, 62]) p.picture('play_net', x, 3, 44, 's', 1, 1, 0);
  for (const [x, z] of [[60, 44], [62, 44], [62, 46]]) p.fill(x, 3, z, x, 4, z, 'vinyl_green');
  // the slide: off the deck's south edge, two chutes down into the pit
  p.set(52, 2, 48, 'slide_chute_s');
  p.set(52, 1, 49, 'slide_chute_s');
  p.set(52, 1, 50, 'slide_lip_s');
  // ---- skee-ball: five lanes against the north wall, the players' end towards the room
  for (let x = 63; x <= 67; x++) {
    p.set(x, 0, 43, 'skee_back_s');
    p.set(x, 0, 44, 'skee_front_s');
  }
  neon(p, 'games', 64, 5, 43, 's');
  // ---- the entrance (the arch at x 69-72): kiddie rocket rides either side, the FUN ZONE sign outside
  p.set(68, 0, 47, 'kiddie_e');
  p.set(74, 0, 46, 'kiddie_w');
  neon(p, 'funzone', 72, 4, 41, 'n');
  neon(p, 'star', 70, 5, 43, 's');
  neon(p, 'star', 71, 5, 43, 's');
  // ---- arcades along the east wall, and a back-to-back row in the middle
  for (const z of [44, 46, 48]) {
    p.set(79, 0, z, 'arcade_0_w');
    p.set(79, 1, z, 'arcade_1_w');
  }
  for (let x = 63; x <= 67; x += 2) {
    p.set(x, 0, 55, 'arcade_0_n');
    p.set(x, 1, 55, 'arcade_1_n');
    p.set(x, 0, 56, 'arcade_0_s');
    p.set(x, 1, 56, 'arcade_1_s');
  }
  // ---- tables for the parents between the pit and the arcades
  for (const [x, z] of [[62, 50], [66, 51], [69, 49]]) {
    p.set(x, 0, z, 'table_0_n');
    p.set(x - 1, 0, z, 'chair_e');
    p.set(x + 1, 0, z, (x + z) % 3 === 0 ? 'fallen_w' : 'chair_w');
    p.set(x, 1, z, (x + z) % 2 ? 'plates' : 'pizza_1_n');
  }
  // ---- the party room (x 72-79, z 52-61): its own wallpaper, a table set for a party nobody came back to
  p.fill(71, 0, 51, 79, 6, 51, 'wallpaper_party');
  p.fill(71, 0, 52, 71, 6, 61, 'wallpaper_party');
  p.fill(71, 0, 51, 79, 0, 51, 'wall_checker');
  p.fill(71, 0, 52, 71, 0, 61, 'wall_checker');
  p.fill(74, 0, 51, 75, 2, 51, 'air'); // the doorway
  p.fill(74, 3, 51, 75, 3, 51, 'blackstone');
  neon(p, 'party', 75, 4, 50, 'n');
  for (let z = 54; z <= 59; z++) p.set(76, 0, z, z === 54 ? 'table_1_n' : z === 59 ? 'table_1_s' : 'table_2_n');
  for (let z = 55; z <= 58; z++) {
    p.set(75, 0, z, 'chair_e');
    p.set(77, 0, z, z === 57 ? 'fallen_w' : 'chair_w');
  }
  for (const [z, k] of [[54, 'hat_1'], [55, 'plates'], [56, 'bday_false_n'], [57, 'plates'], [58, 'hat_3'], [59, 'pizza_2_n']]) p.set(76, 1, z, k);
  p.picture('poster_party', 79, 4, 54, 'w', 2, 2);
  for (const [x, z] of [[72, 52], [79, 61], [72, 61]]) p.set(x, 0, z, `balloons_${(x + z) % 3}`);
  for (let z = 52; z <= 61; z++) p.set(79, 6, z, 'bunting_w');
  for (let x = 72; x <= 79; x++) p.set(x, 6, 52, 'bunting_s');
  // ---- the dust of the last week: tickets everywhere, a puddle under a leak, a lost shoe-sized party hat
  /** @type {[number, number, string][]} */
  const litter = [[66, 47, 'tickets'], [70, 49, 'tickets_b'], [61, 52, 'confetti'], [68, 59, 'tickets'], [64, 50, 'tickets_b'], [73, 47, 'confetti']];
  for (const [x, z, k] of litter) p.set(x, 0, z, `decal_${k}_${['n', 'e', 's', 'w'][(x + z) % 4]}`);
  p.set(66, 0, 61, 'decal_puddle_n');
  p.set(66, 7, 61, 'ceiling_missing');
  p.set(66, 6, 61, 'wires_bundle_n');
  p.set(60, 0, 49, 'hat_2');
  for (const [x, z] of [[49, 61], [79, 43], [79, 61]]) p.set(x, 6, z, 'cobweb');
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
    p.set(x, 6, z + (z < 45 ? 1 : -1), z < 45 ? 'spot_true_n' : 'spot_true_s');
    p.meta.spots.push({ x, y: 6, z: z + (z < 45 ? 1 : -1), dir: z < 45 ? 'n' : 's', group: 'gallery', slot: i });
  }
}

function parts(p, _rng) {
  // Parts & Service (x 48-79, z 63-70, behind the Fun Zone's STAFF ONLY door): the workshop that kept the band
  // running, and six crates waiting for the auction.
  const top = ROOM_BY_ID.PARTS.h - 1;
  // shelves of spares along the north wall (the door from the Fun Zone is at x 60-61)
  const north = [[49, 'head_rustgrin_s'], [51, 'endo_skull_s'], [53, 'head_cat_s'], [55, null], [57, 'head_noxbriar_s'],
    [63, 'head_mirehop_s'], [65, null], [67, 'head_rat_s'], [69, 'head_rustgrin_s'], [71, 'endo_skull_s'], [73, 'head_mirehop_s'], [75, null], [77, 'head_cat_s']];
  for (const [x, head] of north) {
    p.set(x, 0, 64, 'shelf_s');
    if (head) p.set(x, 1, 64, head);
  }
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
  // endoskeletons on their stands down the middle, a head on the floor, two empty costumes
  p.set(57, 0, 66, 'endo_stand_s');
  p.set(70, 0, 66, 'endo_stand_w');
  p.set(64, 0, 65, 'head_rustgrin_n');
  p.set(49, 0, 66, 'suit_rustgrin_e');
  p.set(79, 0, 65, 'suit_mirehop_w');
  // the crates' lids against the west wall, a tarp over something in the east corner
  p.fill(49, 0, 69, 49, 2, 70, 'spruce');
  p.set(50, 0, 70, 'barrel_n');
  p.set(50, 1, 70, 'barrel_n');
  p.fill(76, 0, 68, 78, 0, 70, 'black_wool');
  p.fill(77, 1, 69, 77, 1, 69, 'black_carpet');
  // light: two red emergency lights, one flickering troffer, the work lamps (off at night)
  fixture(p, 49, 3, 65, 'emerg_true_e', 'PARTS');
  fixture(p, 79, 3, 67, 'emerg_true_w', 'PARTS');
  fixture(p, 64, top + 1, 66, 'lamp_broken', 'PARTS');
  for (const x of [56, 70]) {
    p.set(x, top, 66, 'hanging_off');
    p.meta.hanging.push({ x, y: top, z: 66, group: 'parts' });
  }
  for (const [x, z] of [[61, 65], [73, 66]]) p.fill(x, top - 1, z, x, top, z, 'chain_y');
  // faint footprints from the crates to the door; drag marks; dust
  for (const [x, z] of [[65, 66], [63, 66], [61, 65]]) p.set(x, 0, z, 'decal_prints_faint_n');
  p.set(59, 0, 66, 'decal_drag_e');
  p.set(67, 0, 65, 'decal_debris_n');
  for (const [x, z] of [[49, 70], [79, 64]]) p.set(x, top, z, 'cobweb');
  p.set(52, top, 66, 'wires_bundle_n');
  p.picture('sign_staff', 59, 2, 61, 'n', 1, 1, 0); // STAFF ONLY, on the Fun Zone side of the door
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
  for (const z of [29, 37]) p.set(4, 6, z, 'cobweb');
}

function decayMidway(p) {
  // the ring floor stays clear: LOT 4 and LOT 5 hang on the wall behind it, over the show tape
  p.picture('lot_tag', 5, 2, 27, 'n', 1, 1, 3); // the Cat
  p.picture('lot_tag', 7, 2, 27, 'n', 1, 1, 4); // the Purple Rat
  for (const [x, z] of [[1, 15], [1, 27]]) p.set(x, 6, z, 'cobweb');
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
  p.set(4, 5, 4, 'wires_bundle_n');
  p.set(3, 5, 10, 'wires_box_s');
  for (const [x, z] of [[1, 1], [13, 13]]) p.set(x, 5, z, 'cobweb');
  // something heavy was dragged in from the stage door
  for (const [x, z] of [[12, 11], [10, 10]]) p.set(x, 0, z, 'decal_drag_w');
}

function decayKitchen(p) {
  fixture(p, 68, 6, 10, 'lamp_broken', 'KITCHEN');
  fixture(p, 63, 3, 3, 'emerg_true_e', 'KITCHEN');
  p.set(75, 6, 5, 'ceiling_missing');
  p.set(75, 5, 5, 'wires_bundle_e');
  p.set(75, 0, 5, 'decal_debris_n');
  p.set(73, 1, 8, 'pizza_3_e');
  p.set(77, 1, 7, 'pizza_2_n');
  p.set(75, 0, 12, 'decal_puddle_n');
  p.set(67, 0, 12, 'decal_puddle_e');
  for (const [x, z] of [[64, 13], [79, 1]]) p.set(x, 5, z, 'cobweb');
}

function decayRestrooms(p) {
  fixture(p, 64, 6, 20, 'lamp_broken', 'RESTROOMS');
  p.picture('sign_out_of_order', 66, 3, 24, 'w', 2, 1);
  p.set(64, 0, 19, 'decal_puddle_n');
  p.set(65, 0, 24, 'decal_puddle_e');
  p.set(66, 5, 15, 'cobweb');
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
  p.set(26, 6, 47, 'ceiling_missing');
  p.set(26, 5, 47, 'wires_bundle_e');
  p.set(26, 0, 47, 'decal_debris_n');
  p.set(28, 5, 56, 'cobweb');
  // W. Hall Corner (CAM 2B, and through the left door when its light is on)
  writing(p, 'name', 26, 4, 67, 'e');
  p.set(30, 5, 70, 'cobweb');
  // East Hall (CAM 4A): somebody counted, then stopped counting
  writing(p, 'scratches', 46, 3, 50, 'w');
  p.set(46, 6, 45, 'ceiling_missing');
  p.set(46, 5, 45, 'wires_box_w');
  p.set(46, 0, 45, 'decal_debris_n');
  p.set(44, 0, 52, 'decal_puddle_n');
  p.set(44, 5, 56, 'cobweb');
  // the nook where Rustgrin waits (CAM 4B)
  writing(p, 'scratches', 45, 2, 70, 'n');
  p.set(46, 5, 70, 'cobweb');
}

function decaySupply(p) {
  p.set(22, 0, 50, 'suit_rustgrin_n');
  p.set(23, 0, 48, 'decal_puddle_n');
  p.set(24, 5, 50, 'cobweb');
}

function decayPrize(p) {
  for (const [x, z] of [[31, 41], [41, 47]]) p.set(x, 2, z, 'cobweb');
  p.set(36, 0, 45, 'decal_tickets_b_n');
  p.set(33, 0, 49, 'decal_tickets_e');
  p.set(39, 0, 48, 'decal_tickets_n');
  p.set(37, 0, 50, 'plush_s'); // dropped by a child on the way out, years ago
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
  p.set(L.x, L.y, L.z, 'lamp_office');
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
  p.sign(63, 3, 11, 'e', ['KITCHEN', 'Staff only']);
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
