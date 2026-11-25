// Deterministic build plan for Rustgrin's Pizza Revue (pure data -> ops).
//
// generatePlan() returns { ops: { phase: op[] }, meta } (see plan.js for the
// op format). The same function runs in the game (mc/builder.js executes the
// ops) and in Node (tools/map/export_voxels.mjs turns the ops into a voxel
// snapshot for the preview renderer and the map validators), so what the
// tools check is exactly what gets built.
//
// The look: a big, faded 80s family pizzeria. A grand 10-tall Dining Hall with
// long party tables and the band's stage under a proscenium (starry curtain,
// footlights, the big sign), the Midway showroom and the Grand Marquee's
// curtained side stage off it, a long Entrance Hall with a ticket booth, a
// bright Game Room (arcade rows, skee-ball, token machines) under colourful
// crawl tubes that lead into the Fun Zone's play structure and ball pit, the
// Prize Corner, a Party Room, and the dark halls to the office.

import { PlanBuilder } from './plan.js';
import { BUILDING, LOT, ROOMS, ROOM_BY_ID, OPENINGS, OFFICE, DUCTS, STAGE, DRUM, MIDWAY_RING, SHOW_TAPE, CABARET } from './layout.js';
import { WRITING, NEON } from './palette.js';
import { CAMERAS } from './cameras.js';
import { LOBBY_BUTTONS } from './lobby.js';
import { cellar } from './cellar_plan.js';

// ---------------------------------------------------------------- room styles
// bands: list of [fromY, toY, key | key[] (random pick)] for the walls (relative to the floor).
const STYLES = {
  dining: {
    floor: ['carpet_confetti'], ceiling: ['ceiling_dark'],
    bands: [[0, 1, 'wainscot'], [2, 2, 'wall_checker'], [3, 6, 'wallpaper'], [7, 7, 'soffit_cream'], [8, 9, 'trim']],
  },
  hall: { floor: ['tile', 'tile', 'tile_worn'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 4, ['plaster', 'plaster', 'plaster', 'plaster_stained']], [5, 9, 'trim']] },
  office: { floor: ['tile_office'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, ['plaster', 'plaster_stained']]] },
  backstage: { floor: ['polished_deepslate', 'polished_deepslate', 'deepslate_tiles'], ceiling: ['blackstone'], bands: [[0, 1, 'cinder'], [2, 2, 'trim'], [3, 9, 'cinder']] },
  midway: { floor: ['carpet'], ceiling: ['tent'], bands: [[0, 0, 'blackstone'], [1, 9, 'tent']] },
  cabaret: { floor: ['carpet'], ceiling: ['black_c'], bands: [[0, 9, 'curtain_purple']] },
  kitchen: { floor: ['tile_kitchen'], ceiling: ['ceiling_stained', 'ceiling'], bands: [[0, 3, 'tile_white'], [4, 9, 'cinder']] },
  restroom: { floor: ['tile', 'tile_worn'], ceiling: ['ceiling_stained', 'ceiling'], bands: [[0, 2, 'tile_mint'], [3, 3, 'trim'], [4, 9, ['plaster', 'plaster_stained']]] },
  foyer: { floor: ['carpet_purple'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wainscot'], [2, 2, 'wall_stripe'], [3, 5, 'wall_yellow'], [6, 9, 'soffit_cream']] },
  gallery: { floor: ['dark_oak'], ceiling: ['black_c'], bands: [[0, 1, 'wainscot'], [2, 9, 'black_c']] },
  staff: { floor: ['tile_office'], ceiling: ['ceiling', 'ceiling_stained'], bands: [[0, 1, 'cinder'], [2, 2, 'trim'], [3, 9, 'plaster']] },
  supply: { floor: ['smooth_stone'], ceiling: ['ceiling_stained'], bands: [[0, 9, 'cinder']] },
  prize: { floor: ['carpet_confetti'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 3, 'wall_stripe'], [4, 9, 'wallpaper_party']] },
  party: { floor: ['carpet_confetti'], ceiling: ['ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, 'wallpaper_party']] },
  gameroom: { floor: ['carpet'], ceiling: ['black_c'], bands: [[0, 0, 'black_c'], [1, 1, 'wall_checker'], [2, 2, 'wall_stripe'], [3, 9, 'wallpaper_party']] },
  parts: { floor: ['smooth_stone', 'smooth_stone', 'polished_andesite'], ceiling: ['blackstone'], bands: [[0, 9, ['cinder', 'cinder', 'cinder', 'cracked_bricks']]] },
  funzone: { floor: ['carpet_confetti'], ceiling: ['ceiling', 'ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 3, 'wall_stripe'], [4, 9, 'wallpaper_party']] },
};
/** Lamp groups the game switches by name (the others: the room's id in lower case). */
const LAMP_GROUP = { DINING: 'dining', WEST_HALL: 'hall_w', W_CORNER: 'hall_w', EAST_HALL: 'hall_e', E_CORNER: 'hall_e', OFFICE: 'office' };
/** Rooms that hang their own lamps in their decor (the others get a grid of ceiling troffers in lights()). */
const OWN_LAMPS = ['MIDWAY', 'CABARET', 'BACKSTAGE', 'GALLERY', 'PARTS', 'OFFICE', 'W_CORNER', 'E_CORNER', 'DINING', 'FOYER', 'GAMEROOM', 'MENS', 'WOMENS'];

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
  wallOwners(p);
}

/**
 * Where two rooms still share one wall, say whose finish it shows. (Most rooms have a wall layer of their own:
 * see ROOMS in layout.js.) The showroom's south wall is the showroom's; in its west wall the Midway's striped
 * tent front and the Grand Marquee's purple velvet each surround their own opening, like two shop fronts.
 */
function wallOwners(p) {
  p.flush();
  styleWall(p, 'dining', 15, 38, 62, 38, ROOM_BY_ID.DINING.h - 1);
  p.fill(14, 0, 14, 14, 6, 27, 'tent');
  p.fill(14, 0, 29, 14, 6, 37, 'curtain_purple');
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
      p.fill(x1, y2 + 1, z1, x2, y2 + 1, z2, 'blackstone');
    }
    if (o.kind === 'glass_door') {
      // the front entrance: glass double doors in a dark frame, the middle pair standing open, a glass transom
      for (const z of [z1, z2]) p.fill(x2, y1, z, x2, y2, z, 'window');
      p.fill(x2, y2 + 1, z1, x2, y2 + 1, z2, 'window');
      for (const z of [z1 - 1, z2 + 1]) p.fill(x2, y1, z, x2, y2 + 2, z, 'blackstone');
      p.fill(x2, y2 + 2, z1, x2, y2 + 2, z2, 'blackstone');
    }
    if (o.kind === 'welcome') {
      // the WELCOME arch: round the top of the doorway off
      p.fill(x1, y2 + 1, z1 + 1, x2, y2 + 1, z2 - 1, 'air');
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
  // The order window: the kitchen passes the pizzas through to the counter in the Dining Hall.
  p.fill(63, 1, 3, 64, 2, 6, 'air');
  p.fill(63, 0, 3, 64, 0, 6, 'stripped_dark_oak_z');
  // The overhead crawl tube leaves the Fun Zone through the wall above the play arch.
  p.fill(80, 5, 50, 80, 5, 50, 'air');
  // The short passage under the ARCADE sign, from the showroom into the Game Room: striped walls, a black ceiling.
  for (const x of [54, 59]) {
    p.fill(x, 0, 39, x, 1, 41, 'wall_checker');
    p.fill(x, 2, 39, x, 2, 41, 'wall_stripe');
  }
  p.fill(55, 3, 39, 58, 3, 41, 'black_c');
  p.fill(55, -1, 38, 58, -1, 42, 'tile');
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

// ---------------------------------------------------------------- outside
const FRONT = BUILDING.x2 + 1; // the street facade's skin (x 100)
const LOTX = Object.freeze({ curbW: 105, x1: 106, x2: 131, curbE: 132, walk1: 133, street1: 136, street2: 144, walk2: 145 });

function exterior(p) {
  p.setPhase('exterior');
  const rng = p.rng.fork(23);
  const B = BUILDING;
  // sidewalk ring around the building (outside the exterior skin only - the floors inside are done)
  p.fill(B.x1 - 3, -1, B.z1 - 3, FRONT + 2, -1, B.z1 - 2, 'sidewalk');
  p.fill(B.x1 - 3, -1, B.z2 + 2, FRONT + 2, -1, B.z2 + 3, 'sidewalk');
  p.fill(B.x1 - 3, -1, B.z1 - 1, B.x1 - 2, -1, B.z2 + 1, 'sidewalk');
  // the front plaza: a wide walk along the facade
  p.fill(FRONT + 1, -1, B.z1 - 3, LOTX.curbW - 1, -1, B.z2 + 3, 'sidewalk');
  // the parking lot (east of the building), cracked and patched, fenced north and south
  const lz1 = -9, lz2 = 80;
  p.fill(LOTX.x1, -1, lz1, LOTX.x2, -1, lz2, 'blackstone');
  for (let i = 0; i < 90; i++) p.set(rng.int(LOTX.x1, LOTX.x2), -1, rng.int(lz1, lz2), rng.pick(['asphalt2', 'gravel', 'blackstone_bricks']));
  for (let z = lz1 + 2; z <= lz2 - 2; z += 4) {
    if (z >= 28 && z <= 40) continue; // the drive lane in front of the doors
    p.fill(LOTX.x1 + 1, -1, z, LOTX.x1 + 6, -1, z, 'paint_line');
    p.fill(LOTX.x2 - 6, -1, z, LOTX.x2 - 1, -1, z, 'paint_line');
  }
  for (let x = LOTX.x1 + 9; x <= LOTX.x2 - 9; x += 4) p.fill(x, -1, 35, x + 1, -1, 35, 'paint_yellow'); // the centre line of the drive lane
  p.fill(LOTX.curbW, -1, lz1, LOTX.curbW, -1, lz2, 'curb');
  p.fill(LOTX.curbE, -1, lz1, LOTX.curbE, -1, lz2, 'curb');
  p.fill(LOTX.curbE, -1, 28, LOTX.walk1 + 2, -1, 40, 'blackstone'); // the driveway to the street
  // chain-link fence along the lot's north and south edges, a sagging gate post here and there
  for (const z of [lz1 - 1, lz2 + 1]) {
    p.fill(LOTX.curbW, 0, z, LOTX.curbE, 1, z, 'fence_iron');
    for (let x = LOTX.curbW; x <= LOTX.curbE; x += 6) p.fill(x, 0, z, x, 2, z, 'lamp_post');
  }
  // the street
  p.fill(LOTX.walk1, -1, LOT.z1, LOTX.street1 - 1, -1, LOT.z2, 'sidewalk');
  p.fill(LOTX.street1, -1, LOT.z1, LOTX.street2, -1, LOT.z2, 'black_c');
  for (let z = LOT.z1; z <= LOT.z2; z += 6) p.fill(140, -1, z, 140, -1, Math.min(LOT.z2, z + 2), 'paint_yellow');
  p.fill(LOTX.walk2, -1, LOT.z1, LOT.x2, -1, LOT.z2, 'sidewalk');
  p.fill(LOTX.walk1, -1, 28, LOTX.street1 - 1, -1, 40, 'blackstone'); // the curb cut
  // street lamps along the road, two lamps in the lot
  for (const z of [-10, 10, 52, 74]) {
    p.fill(LOTX.walk1 + 1, 0, z, LOTX.walk1 + 1, 5, z, 'lamp_post');
    p.set(LOTX.walk1 + 1, 6, z, 'sea_lantern');
    p.set(LOTX.walk1 + 1, 7, z, 'blackstone_slab');
  }
  for (const [x, z] of [[118, 14], [118, 56]]) {
    p.fill(x, 0, z, x, 4, z, 'lamp_post');
    p.set(x, 5, z, 'sea_lantern');
    p.set(x, 6, z, 'blackstone_slab');
  }
  // the roadside pylon: the old sign on a pole, readable from both directions of the road
  p.fill(LOTX.walk1 + 1, 0, 23, LOTX.walk1 + 1, 9, 23, 'lamp_post');
  p.fill(LOTX.walk1 + 1, 10, 20, LOTX.walk1 + 1, 13, 25, 'blackstone_bricks');
  p.picture('sign_revue', LOTX.walk1 + 2, 12, 25, 'e', 6, 2);
  p.picture('sign_revue', LOTX.walk1, 12, 20, 'w', 6, 2);
  facade(p);
  p.batch(streetFront);
  // roof clutter: condensers (never over the dining hall's sign side)
  for (const [x, z] of [[8, 20], [52, 50], [72, 34], [30, 62], [62, 66], [88, 10], [90, 58]]) {
    for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) p.set(x + dx, B.roofY + 1, z + dz, 'ac_unit');
  }
  // lot edge: fence on the three land sides, weeds
  p.fill(LOT.x1, 0, LOT.z1, LOT.x1, 0, LOT.z2, 'fence_dark');
  p.fill(LOT.x1, 0, LOT.z1, LOTX.curbW - 1, 0, LOT.z1, 'fence_dark');
  p.fill(LOT.x1, 0, LOT.z2, LOTX.curbW - 1, 0, LOT.z2, 'fence_dark');
  for (let i = 0; i < 300; i++) {
    const x = rng.int(LOT.x1 + 1, LOTX.curbW - 1);
    const z = rng.int(LOT.z1 + 1, LOT.z2 - 1);
    const nearBuilding = x >= B.x1 - 4 && x <= LOTX.curbW && z >= B.z1 - 4 && z <= B.z2 + 4;
    if (!nearBuilding) p.set(x, 0, z, 'tall_grass');
  }
  for (let i = 0; i < 40; i++) {
    const x = rng.int(LOTX.curbW + 1, LOTX.curbE - 1);
    const z = rng.pick([rng.int(LOT.z1 + 1, lz1 - 3), rng.int(lz2 + 3, LOT.z2 - 1)]);
    p.set(x, 0, z, 'tall_grass');
  }
  lastWeekOutside(p);
}

/** The street front (ref: the haunted pizzeria's front at night): long, low and symmetric about the doors (z 35.5).
 *  Teal standing-seam cladding over a red trim line, pale stone pillars washed by uplights, dark arched windows in
 *  the wings, a checker band at the base, taller end towers with red-framed windows; in the middle the glass doors
 *  under the big neon sign, and Rustgrin in his red top hat waving over the roofline. */
const FACADE = Object.freeze({
  pillars: Object.freeze([-1, 8, 18, 19, 29, 42, 52, 53, 63, 72]),
  bays: Object.freeze([[9, 17], [20, 28], [43, 51], [54, 62]]),
  towers: Object.freeze([[0, 7], [64, 71]]),
});

function facade(p) {
  const X = FRONT;
  const top = BUILDING.roofY + 1; // the coping
  // the main body: a dark plinth, the checker band, warm yellow wall, a red trim line, teal cladding, the coping
  const band = (z1, z2, y1, y2, key) => p.fill(X, y1, z1, X, y2, z2, key);
  // the plinth stops at the doorway (it used to run across it: a one-block sill in the entrance), and the two
  // fixed glass leaves reach the floor
  for (const [z1, z2] of [[-1, 33], [38, 72]]) band(z1, z2, 0, 0, 'blackstone_bricks');
  for (const z of [34, 37]) band(z, z, 0, 0, 'window');
  for (const [z1, z2] of [[-1, 32], [39, 72]]) band(z1, z2, 1, 1, 'wall_checker');
  for (const [z1, z2] of [[-1, 32], [39, 72]]) band(z1, z2, 2, 4, 'wall_yellow');
  band(-1, 72, 5, 5, 'wall_yellow');
  band(-1, 72, 6, 6, 'red_c');
  band(-1, 72, 7, top - 1, 'cladding_teal');
  band(-1, 72, top, top, 'roof_edge');
  // the arched dark windows in the wings
  for (const [a, b] of FACADE.bays) {
    p.fill(X - 1, 2, a + 1, X, 3, b - 1, 'window_tint');
    p.fill(X - 1, 4, a + 2, X, 4, b - 2, 'window_tint');
    p.fill(X - 1, 5, a + 3, X, 5, b - 3, 'window_tint');
  }
  // the end towers rise higher: quilted teal below, two tall red-framed windows, a lit yellow band, the cap
  for (const [z1, z2] of FACADE.towers) {
    p.fill(X - 3, top, z1, X, top + 3, z2, 'ext_wall2');
    p.fill(X - 3, top + 3, z1, X, top + 3, z2, 'roof_edge');
    band(z1, z2, 1, 5, 'dark_prismarine');
    band(z1, z2, 7, top, 'red_c');
    for (const [w1, w2] of [[z1 + 1, z1 + 2], [z2 - 2, z2 - 1]]) band(w1, w2, 8, top - 1, 'window_cyan');
    band(z1, z2, top + 1, top + 1, 'yellow_t');
    band(z1, z2, top + 2, top + 2, 'red_c');
  }
  // pale stone pillars, uplights at their feet
  for (const z of FACADE.pillars) {
    const tower = z === -1 || z === 8 || z === 63 || z === 72;
    p.fill(X, 0, z, X + 1, tower ? top + 3 : top + 1, z, 'cut_sandstone');
    fixture(p, X + 2, 0, z, 'foot_true_w', 'OUTSIDE');
    fixture(p, X + 2, 2, z, 'light12', 'OUTSIDE'); // the uplight's wash up the stone
  }
  // a warm glow low in every bay and over the doors (the lit yellow panels of the reference)
  for (const [a, b] of FACADE.bays) fixture(p, X + 1, 1, (a + b) >> 1, 'light10', 'OUTSIDE');
  for (const z of [31, 40]) fixture(p, X + 1, 2, z, 'light11', 'OUTSIDE');
  // the entrance: the sign board over the doors on a ledge, the big neon sign, Rustgrin waving above the roofline
  band(30, 41, 7, top - 1, 'blackstone_bricks');
  p.fill(X + 1, 6, 30, X + 1, 6, 41, 'blackstone_slab');
  p.picture('sign_facade', X + 1, 10, 41, 'e', 12, 4);
  p.picture('sign_mascot', X + 1, 16, 38, 'e', 6, 6);
  p.fill(X - 1, 0, 35, X - 1, 0, 36, 'red_carpet');
}

/** A dead tree: a bare dark trunk with crooked branches and twigs, no leaves. */
function deadTree(p, x, z, h) {
  p.fill(x, 0, z, x, h, z, 'dark_oak_log');
  p.fill(x - 3, h - 4, z, x - 1, h - 4, z, 'dark_oak_log_x');
  p.fill(x - 3, h - 3, z, x - 3, h - 2, z, 'fence_dark');
  p.fill(x + 1, h - 2, z, x + 2, h - 2, z, 'dark_oak_log_x');
  p.fill(x + 2, h - 1, z, x + 2, h + 1, z, 'fence_dark');
  p.fill(x, h - 1, z + 1, x, h - 1, z + 3, 'dark_oak_log_z');
  p.fill(x, h, z + 3, x, h + 1, z + 3, 'fence_dark');
  p.fill(x, h - 6, z - 2, x, h - 6, z - 1, 'dark_oak_log_z');
  p.fill(x, h - 5, z - 2, x, h - 4, z - 2, 'fence_dark');
  p.fill(x, h + 1, z, x, h + 2, z, 'fence_dark');
}

/** Outside, the week before the auction: Walter's car, boarded windows, the notice by the door. */
function lastWeekOutside(p) {
  // Walter's car, where he left it at 3 AM: backed into a bay, headlights on and staring at whoever arrives,
  // the driver's door hanging open, the dome light still glowing
  const cx = LOTX.x1 + 1; // the car's back end
  for (let x = cx; x <= cx + 4; x++) for (let z = 43; z <= 45; z++) p.set(x, 0, z, 'car_body');
  for (const x of [cx + 1, cx + 3]) for (const z of [43, 45]) p.set(x, 0, z, 'black_c');
  for (const z of [43, 45]) {
    p.set(cx + 4, 0, z, 'headlight');
    p.meta.fixtures.push({ x: cx + 4, y: 0, z, key: 'headlight', room: 'OUTSIDE' });
    p.set(cx, 0, z, 'car_tail');
  }
  p.set(cx + 4, 0, 44, 'blackstone');
  for (let z = 43; z <= 45; z++) {
    p.set(cx + 4, 1, z, 'car_slab');
    p.set(cx, 1, z, 'car_slab');
    p.set(cx + 3, 1, z, 'window_tint');
    for (let x = cx + 1; x <= cx + 3; x++) p.set(x, 2, z, 'car_slab');
  }
  p.set(cx + 1, 1, 43, 'window_tint');
  p.set(cx + 1, 1, 45, 'window_tint');
  p.set(cx + 2, 1, 45, 'window_tint');
  p.set(cx + 2, 1, 43, 'brown_carpet'); // the driver's seat, seen through the open door
  p.set(cx + 2, 1, 44, 'brown_carpet');
  p.set(cx + 1, 1, 44, 'light5'); // the dome light
  p.meta.fixtures.push({ x: cx + 1, y: 1, z: 44, key: 'light5', room: 'OUTSIDE' });
  for (const y of [0, 1]) p.set(cx + 2, y, 42, 'car_door');
  p.set(cx + 1, 0, 41, 'decal_puddle_n');
  // the facade: windows boarded over, the auction notice by the doors
  const X = FRONT + 1;
  for (const [y, z, k] of [[2, 11, 'across'], [3, 12, 'x'], [2, 13, 'across'], [3, 14, 'across'], [4, 13, 'x'],
    [2, 23, 'x'], [3, 24, 'across'], [2, 46, 'across'], [5, 47, 'x'],
    [2, 56, 'across'], [3, 57, 'x'], [2, 58, 'across'], [3, 59, 'across'], [4, 58, 'x'], [2, 60, 'x']]) {
    p.set(X, y, z, `boards_${k}_e`);
  }
  p.picture('poster_auction', X, 4, 32, 'e', 2, 3);
  p.picture('poster_party', X, 4, 40, 'e', 2, 2);
  // bare trees behind the building and at the lot's edge, black against the sky
  deadTree(p, -8, 24, 17);
  deadTree(p, -7, 49, 15);
  deadTree(p, 40, -12, 11);
  deadTree(p, 96, 82, 9);
  // rain water standing on the lot, a red light over the staff exit, the dumpster overflowing
  for (const [x, z, d] of [[116, 26, 'n'], [121, 41, 'e'], [112, 55, 's'], [125, 18, 'w'], [104, 38, 'n'], [127, 63, 'e']]) p.set(x, 0, z, `decal_puddle_${d}`);
  p.set(BUILDING.x1 - 2, 3, 60, 'emerg_true_w');
  p.meta.fixtures.push({ x: BUILDING.x1 - 2, y: 3, z: 60, key: 'emerg_true_w', room: 'OUTSIDE' });
  p.batch(yards);
}

// @once streetwork
/**
 * The street front's depth: a stone cornice, a stepped pediment behind the sign and the mascot outlined in
 * neon, a neon line along the red trim of both wings, a striped awning over the doors, concrete planters with
 * dead shrubs under the windows, a bench and a bin, bollards along the curb, wheel stops in the bays, a faded
 * blue bay by the entrance.
 */
function streetFront(p) {
  const X = FRONT;
  const top = BUILDING.roofY + 1; // 13
  for (let z = -1; z <= 72; z++) if (!FACADE.pillars.includes(z) && (z < 30 || z > 41)) p.set(X + 1, top, z, 'sandstone_slab_top');
  // the pediment: two steps of dark brick behind the sign, coped, its edges in teal and pink neon
  p.fill(X - 1, top + 1, 30, X, top + 2, 41, 'blackstone_bricks');
  p.fill(X - 1, top + 3, 32, X, top + 4, 39, 'blackstone_bricks');
  for (const z of [30, 31, 40, 41]) {
    p.fill(X - 1, top + 3, z, X, top + 3, z, 'roof_edge');
    p.set(X + 1, top + 2, z, 'glow_pink_bar_e');
  }
  p.fill(X - 1, top + 5, 32, X, top + 5, 39, 'roof_edge');
  for (let z = 32; z <= 39; z++) p.set(X + 1, top + 4, z, 'glow_teal_top_e');
  for (const z of [32, 39]) p.set(X + 1, top + 3, z, 'glow_teal_post_e');
  // striped awnings over the window bays
  for (const [a, b] of FACADE.bays) for (let z = a + 1; z <= b - 1; z++) p.set(X + 1, 5, z, 'awning_e');
  // a pink neon line along the red trim of both wings
  for (const [a, b] of FACADE.bays) for (let z = a; z <= b; z++) p.set(X + 1, 6, z, 'glow_pink_bar_e');
  // the doors: a striped awning, a bench and a bin beside them
  for (let z = 33; z <= 38; z++) p.set(X + 1, 4, z, 'awning_e');
  p.set(X + 1, 0, 41, 'dark_oak_stairs_w');
  p.set(X + 1, 0, 40, 'dark_oak_stairs_w');
  p.set(X + 1, 0, 30, 'trash_e');
  // planters under the windows
  for (const [a, b] of FACADE.bays) for (let z = a + 2; z <= b - 2; z += 2) if (z !== ((a + b) >> 1)) p.set(X + 1, 0, z, 'planter');
  // bollards along the curb (not across the way in from the lot), wheel stops in the bays, the blue bay
  for (let z = -6; z <= 78; z += 6) if (z < 28 || z > 42) p.set(LOTX.curbW, 0, z, 'bollard');
  for (let z = -5; z <= 77; z += 4) {
    if (z >= 26 && z <= 42) continue;
    if (z !== 43) p.set(LOTX.x1 + 1, 0, z, 'wheelstop_e');
    p.set(LOTX.x2 - 1, 0, z, 'wheelstop_w');
  }
  p.fill(LOTX.x1 + 1, -1, 26, LOTX.x1 + 6, -1, 27, 'blue_c');
  for (const [x, z] of [[LOTX.x1 + 3, 26], [LOTX.x1 + 3, 27], [LOTX.x1 + 4, 26]]) p.set(x, -1, z, 'paint_line');
}

/**
 * The three brick sides: a dark stone base course, brick buttresses with stone caps every twelve blocks,
 * downpipes between them, a band of dark high windows; the kitchen's yard behind a chain-link fence (the back
 * door boarded up, dumpsters, pallets, drums, condensers); the loading dock's shutter by the stage door; the
 * staff exit's stoop.
 */
function yards(p) {
  const B = BUILDING;
  const top = B.roofY; // 12
  // ---- base course
  p.fill(B.x1 - 1, 0, B.z1 - 1, B.x2, 0, B.z1 - 1, 'ext_base');
  p.fill(B.x1 - 1, 0, B.z2 + 1, B.x2, 0, B.z2 + 1, 'ext_base');
  p.fill(B.x1 - 1, 0, B.z1 - 1, B.x1 - 1, 0, 59, 'ext_base');
  p.fill(B.x1 - 1, 0, 62, B.x1 - 1, 0, B.z2 + 1, 'ext_base');
  // ---- buttresses, downpipes and high windows: north and south sides
  for (const [z, d] of /** @type {[number, string][]} */ ([[B.z1 - 2, 'n'], [B.z2 + 2, 's']])) {
    const wall = d === 'n' ? B.z1 - 1 : B.z2 + 1;
    for (let x = 5; x <= 95; x += 12) {
      p.set(x, 0, z, 'ext_base');
      column(p, x, z, 1, top - 1, 'ext_wall');
      p.set(x, top, z, 'sandstone_slab');
      if (x + 6 <= 95) {
        p.set(x + 6, 0, z, `drain_foot_${d}`);
        column(p, x + 6, z, 1, top, `drain_pipe_${d}`);
        for (const wx of [x + 2, x + 3, x + 4, x + 8, x + 9, x + 10]) p.fill(wx, 9, wall, wx, 10, wall, 'window_tint');
      }
    }
  }
  // the west side
  for (const z of [10, 22, 34, 46, 58, 70]) {
    p.set(B.x1 - 2, 0, z, 'ext_base');
    column(p, B.x1 - 2, z, 1, top - 1, 'ext_wall');
    p.set(B.x1 - 2, top, z, 'sandstone_slab');
  }
  for (const z of [16, 28, 40, 52, 66]) {
    p.set(B.x1 - 2, 0, z, 'drain_foot_w');
    column(p, B.x1 - 2, z, 1, top, 'drain_pipe_w');
  }
  for (const z of [13, 14, 18, 19, 25, 26, 30, 31, 37, 38, 42, 43, 49, 50, 54, 55]) p.fill(B.x1 - 1, 9, z, B.x1 - 1, 10, z, 'window_tint');
  // ---- the loading dock at the stage door (west side, z 3-7): a steel shutter, a concrete dock, bumpers, bollards
  p.fill(B.x1 - 1, 1, 3, B.x1 - 1, 3, 7, 'shutter');
  p.fill(B.x1 - 1, 0, 3, B.x1 - 1, 0, 7, 'shutter_bottom');
  p.fill(B.x1 - 1, 4, 2, B.x1 - 1, 4, 8, 'blackstone_bricks');
  p.fill(B.x1 - 3, 0, 2, B.x1 - 2, 0, 8, 'smooth_stone');
  for (const z of [2, 8]) p.set(B.x1 - 4, 0, z, 'bollard');
  for (const z of [3, 7]) p.set(B.x1 - 4, 0, z, 'black_wool');
  p.set(B.x1 - 2, 1, 8, 'pallets_2');
  p.set(B.x1 - 3, 1, 2, 'road_case');
  p.sign(B.x1 - 2, 5, 5, 'w', ['', 'DELIVERIES', 'STAGE DOOR']);
  fixture(p, B.x1 - 2, 4, 5, 'sconce_true_w', 'OUTSIDE');
  // ---- the staff exit: a stoop, a bin, a condenser
  p.set(B.x1 - 2, 0, 63, 'trash_w');
  p.set(B.x1 - 2, 0, 56, 'ac_unit');
  // ---- the kitchen's yard (north side, x 63-83): gravel behind a chain-link fence with its gate left open
  p.fill(63, 0, -8, 83, 2, -4, 'air');
  p.fill(63, -1, -7, 83, -1, -4, 'gravel');
  for (let x = 63; x <= 83; x++) if (x < 71 || x > 74) p.fill(x, 0, -8, x, 1, -8, 'iron_bars_x');
  for (const x of [63, 83]) p.fill(x, 0, -7, x, 1, -4, 'iron_bars_z');
  for (const x of [63, 70, 75, 83]) column(p, x, -8, 0, 2, 'lamp_post');
  // the back door, boarded up; a lamp over it that still burns
  p.set(72, 0, B.z1 - 1, 'iron_door_n');
  p.set(72, 1, B.z1 - 1, 'iron_door_n_top');
  p.set(72, 1, -2, 'boards_x_n');
  p.set(72, 0, -2, 'boards_across_n');
  fixture(p, 72, 3, -2, 'sconce_true_n', 'OUTSIDE');
  p.picture('sign_staff', 71, 2, -2, 'n', 1, 1, 3);
  // dumpsters, pallets, drums, condensers on the wall, what did not fit in the bins
  for (const x of [65, 68]) {
    p.set(x, 0, -6, 'dumpster_n');
    p.set(x + 1, 0, -6, 'dumpster_s');
  }
  p.set(80, 0, -5, 'pallets_3');
  p.set(81, 0, -5, 'pallets_1');
  p.set(81, 0, -6, 'pallets_2');
  for (const [x, y, z] of [[78, 0, -4], [78, 1, -4], [77, 0, -4]]) p.set(x, y, z, 'barrel_n');
  for (const x of [74, 79]) p.set(x, 0, -2, 'ac_unit');
  p.set(70, 0, -5, 'pizza_3_e');
  p.set(71, 0, -6, 'pizza_1_n');
  p.set(64, 0, -5, 'trash_s');
  p.set(73, 0, -5, 'decal_puddle_n');
  p.set(67, 0, -4, 'decal_puddle_e');
  // ---- the south side: condensers, pallets
  for (const x of [20, 22, 60]) p.set(x, 0, B.z2 + 2, 'ac_unit');
  p.set(40, 0, B.z2 + 2, 'pallets_2');
}
// @end streetwork

// ---------------------------------------------------------------- decor kits

// ---------------------------------------------------------------- the rework's architecture kit // @once archkit
/** A column of one block from y1 to y2. */
function column(p, x, z, y1, y2, key) {
  for (let y = y1; y <= y2; y++) p.set(x, y, z, key);
}

/** A cream pilaster from the floor (or y1) to y2: a panelled shaft, a starred cap. */
function pilaster(p, x, z, y2, y1 = 0) {
  column(p, x, z, y1, y2 - 1, 'column');
  p.set(x, y2, z, 'column_cap');
}

/** A wall segment in a room style's bands, from the floor up to `top` (wing walls, piers, re-faced walls). */
function styleWall(p, style, x1, z1, x2, z2, top) {
  for (const [a, b, key] of STYLES[style].bands) {
    if (a > top) continue;
    p.fill(x1, a, z1, x2, Math.min(b, top), z2, Array.isArray(key) ? key[0] : key);
  }
}

/** A lamp the game switches with its room's lamp group (any block with fnar:lit): the house lights. */
function houseLamp(p, x, y, z, key, room, group = room.toLowerCase()) {
  p.set(x, y, z, key);
  p.meta.lamps.push({ x, y, z, room, group });
}

/** A lit thing that goes on by day with everything else and dark with its room at closing time (fnar:lit). */
function dayLamp(p, x, y, z, key, group) {
  p.set(x, y, z, key);
  p.meta.hanging.push({ x, y, z, group });
}

/** A ceiling troffer (off as built), switched with its room. */
function troffer(p, x, y, z, room, group = room.toLowerCase()) {
  houseLamp(p, x, y, z, 'lamp_off', room, group);
}

/**
 * A doorway's frame, cut into the wall it stands in: jambs either side of the opening and a head over it.
 * `axis` = the direction the opening spans ('x' or 'z'); the wall's thickness is the other one.
 */
function doorFrame(p, id, axis, key, head = key) {
  const [x1, y1, z1, x2, y2, z2] = OPENINGS.find((o) => o.id === id).box;
  if (axis === 'z') {
    for (const z of [z1 - 1, z2 + 1]) p.fill(x1, y1, z, x2, y2 + 1, z, key);
    p.fill(x1, y2 + 1, z1, x2, y2 + 1, z2, head);
  } else {
    for (const x of [x1 - 1, x2 + 1]) p.fill(x, y1, z1, x, y2 + 1, z2, key);
    p.fill(x1, y2 + 1, z1, x2, y2 + 1, z2, head);
  }
}
// @end archkit

function decor(p) {
  p.setPhase('decor');
  const rng = p.rng.fork(37);
  // (each room is written as a batch: its large fills, then every other cell once: see PlanBuilder.batch)
  for (const room of [dining, midway, cabaret, backstage, kitchen, restrooms, foyer, prize, halls, supply, party, office, staff, gallery, gameroom, funzone, parts]) {
    p.batch((q) => room(q, rng));
  }
  lastWeek(p);
  for (const c of CAMERAS) {
    if (!c.mount) continue;
    const [x, y, z, dir, kind] = c.mount;
    p.set(x, y, z, kind === 'ceiling' ? `cctv_ceil_${dir}` : `cctv_${dir}`);
    p.meta.cctv.push({ cam: c.id, x, y, z });
  }
}

/** A run of party tables (1 wide) from a to b along x or z, chairs on both sides, hats, plates and pizza on top. */
function tableRun(p, rng, axis, fixed, a, b, { chairs = 0.85, every = 2 } = {}) {
  for (let t = a; t <= b; t++) {
    const [x, z] = axis === 'z' ? [fixed, t] : [t, fixed];
    const key = axis === 'z' ? (t === a ? 'table_1_n' : t === b ? 'table_1_s' : 'table_2_n') : (t === a ? 'table_1_w' : t === b ? 'table_1_e' : 'table_2_e');
    p.set(x, 0, z, key);
    if ((t - a) % every === 0 && t > a && t < b) {
      if (axis === 'z') {
        if (rng.chance(chairs)) p.set(x - 1, 0, z, 'chair_e');
        if (rng.chance(chairs)) p.set(x + 1, 0, z, 'chair_w');
      } else {
        if (rng.chance(chairs)) p.set(x, 0, z - 1, 'chair_s');
        if (rng.chance(chairs)) p.set(x, 0, z + 1, 'chair_n');
      }
    }
    const r = rng.next();
    if (r < 0.3) p.set(x, 1, z, `hat_${rng.int(0, 3)}`);
    else if (r < 0.5) p.set(x, 1, z, 'plates');
    else if (r < 0.58) p.set(x, 1, z, `pizza_${rng.int(1, 2)}_${rng.pick(['n', 'e'])}`);
  }
}

/** Dining-hall long party-table columns (x) and their z range. */
const DINING_TABLES = Object.freeze({ xs: Object.freeze([27, 33, 44, 50]), z1: 16, z2: 30 });
/** The showroom's sconces that still burn at night (their pilaster's x,z). */
const NIGHT_SCONCES = Object.freeze(['15,13', '62,26', '17,37', '59,37']);
/** Where the band steps off the stage (the lip has steps there instead of footlights). */
const STAGE_STEPS = Object.freeze([30, 32, 38, 39, 44, 46]);
const PAR = ['red', 'pink', 'blue', 'green'];

/** A PAR can (coloured, switched with the stage lights). */
function parCan(p, x, y, z, i, dir) {
  p.set(x, y, z, `par_${PAR[i % 4]}_false_${dir}`);
  p.meta.spots.push({ x, y, z, dir, group: 'stage' });
}

/** A square cafe table with a star-back chair on each side. */
function cafeSet(p, rng, x, z) {
  p.set(x, 0, z, 'cafe_table');
  p.set(x - 1, 0, z, 'starchair_e');
  p.set(x + 1, 0, z, 'starchair_w');
  p.set(x, 0, z - 1, 'starchair_s');
  p.set(x, 0, z + 1, rng.chance(0.25) ? 'fallen_n' : 'starchair_n');
  if (rng.chance(0.5)) p.set(x, 1, z, rng.pick(['plates', 'pizza_1_n', 'hat_0']));
}

/** A diner booth: two padded benches facing each other across a table. axis 'z': benches at a and a + 2 along z
 *  over the columns xs; axis 'x': benches at a and a + 2 along x over the rows zs. */
function booth(p, rng, axis, a, cross) {
  for (const c of cross) {
    const [b1, t, b2] = axis === 'z' ? [[c, a], [c, a + 1], [c, a + 2]] : [[a, c], [a + 1, c], [a + 2, c]];
    p.set(b1[0], 0, b1[1], axis === 'z' ? 'booth_s' : 'booth_e');
    p.set(b2[0], 0, b2[1], axis === 'z' ? 'booth_n' : 'booth_w');
    p.set(t[0], 0, t[1], 'cafe_table');
    if (rng.chance(0.5)) p.set(t[0], 1, t[1], rng.pick(['plates', 'pizza_2_n', 'hat_0']));
  }
}

function dining(p, rng) {
  // The showroom (48 x 37, 9 tall): a real proscenium at its north end (cream piers, a wing wall, the curved stage
  // under a soffit edged with marquee bulbs, a band riser, tinsel behind the band), cream pilasters with brass
  // sconces round the walls over oak wainscot, a dropped soffit all the way round with a row of bulbs on its
  // edge, the round drum and the mirror ball; long party tables on a checker aisle, cafe tables, booths, the
  // pizza counter under its striped awning by the kitchen's window, the salad bar, the sound booth at the back.
  const [sx1, sz1, sx2] = STAGE.box;
  const top = ROOM_BY_ID.DINING.h - 1; // 8
  const S = STAGE.soffit;
  // ---- the floor: confetti carpet (style), a checker dance floor in front of the stage and a checker aisle down the middle
  p.fill(15, -1, 12, 62, -1, 15, 'tile');
  p.fill(36, -1, 12, 41, -1, 37, 'tile');
  // ---- the stage house: a wing wall closes the corner west of the stage, a pier stands at each end of the lip
  styleWall(p, 'dining', 15, 9, 20, 9, top);
  for (const x0 of [21, 55]) {
    for (const x of [x0, x0 + 1]) for (const z of [9, 10]) pilaster(p, x, z, top);
  }
  // ---- the stage: boards from the backdrop to the curved lip; footlights in the lip, steps where the band comes down
  for (let x = sx1; x <= sx2; x++) {
    const f = STAGE.front[x];
    p.fill(x, 0, sz1, x, 0, f - 1, 'stage_floor');
    p.fill(x, -1, f + 1, x, -1, 15, 'tile');
    if (STAGE_STEPS.includes(x)) p.set(x, 0, f, 'dark_oak_stairs_n');
    else {
      p.set(x, 0, f, 'lip_false_s');
      p.meta.spots.push({ x, y: 0, z: f, dir: 's', group: 'stage' });
    }
  }
  // the backdrop: a starry midnight curtain, a tinsel panel behind the singer, stars hung on it; red drapes either
  // side, floor to ceiling
  p.fill(sx1, 1, sz1, sx2, top, sz1, 'curtain_star');
  p.fill(35, 1, sz1, 42, top - 1, sz1, 'tinsel');
  for (const [x, y] of [[27, 6], [31, 7], [34, 4], [43, 4], [46, 7], [50, 6], [29, 3], [48, 3], [25, 4], [52, 4]]) p.set(x, y, sz1 + 1, 'star_s');
  for (const x of STAGE.drapes) p.fill(x, 0, sz1, x, top, 8, 'curtain_red');
  for (const x of [sx1, sx2]) p.fill(x, 1, sz1, x, top, sz1 + 2, 'curtain_red');
  // the band's riser along the backdrop, the amps on it
  p.fill(30, 1, 2, 47, 1, 3, 'stage_floor');
  p.set(31, 2, 3, 'amp_s');
  p.set(46, 2, 3, 'amp_s');
  for (const x of [34, 43]) p.set(x, 2, 2, 'speaker_s');
  // the soffit: cream plaster following the lip, a red star every third block, a row of marquee bulbs under it
  for (let x = sx1; x <= sx2; x++) {
    const f = STAGE.front[x];
    p.set(x, S.y2, f, x % 3 === 1 ? 'soffit_star' : 'soffit_cream');
    p.set(x, S.y1, f, 'bulb_off');
    p.meta.spots.push({ x, y: S.y1, z: f, dir: 's', group: 'stage' });
    p.fill(x, S.y2, sz1 + 2, x, S.y2, f - 1, 'soffit_cream'); // its top closes over the stage
  }
  p.fill(34, S.y1 - 1, STAGE.front[38], 43, S.y1 - 1, STAGE.front[38], 'soffit_cream'); // a fascia behind the sign's bottom row
  p.picture('sign_stage', 34, top, STAGE.front[38] + 1, 's', 10, 3); // RUSTGRIN'S PIZZA REVUE in bulbs, on the soffit
  // a row of coloured PAR cans under the soffit's back edge, aimed at the band
  for (const [i, x] of [25, 28, 31, 34, 43, 47, 49, 52].entries()) parCan(p, x, S.y1 - 1, STAGE.front[x] - 1, i, 'n');
  // the band's equipment: speaker stacks at the corners, a mic stand
  for (const x of [sx1 + 2, sx2 - 2]) for (const y of [1, 2]) p.set(x, y, 7, 'speaker_s');
  p.set(37, 1, 8, 'mic_stand');
  // the wing wall towards the room: SHOWTIME! in red neon, the rules, the jukebox (still lit at night)
  neon(p, 'showtime', 16, 6, 10, 's');
  p.picture('poster_rules', 16, 4, 10, 's', 2, 2);
  p.set(19, 0, 10, 'juke_0_s');
  p.set(19, 1, 10, 'juke_1_s');
  p.set(20, 0, 10, 'gumball');
  // the east wing: the band's road cases between the pier and the pizza counter
  for (const [x, y, z] of [[56, 0, 7], [56, 1, 7], [57, 0, 5], [56, 0, 4], [56, 0, 2], [57, 0, 2], [57, 1, 2]]) p.set(x, y, z, 'road_case');
  p.set(57, 0, 7, 'speaker_w');
  // ---- pilasters round the walls, a brass sconce on each (lit by day, dead at night)
  /** @type {[number, number, string][]} */
  const piers = [[15, 13, 'e'], [15, 28, 'e'],
    ...[12, 17, 22, 26, 30, 36].map((z) => /** @type {[number, number, string]} */ ([62, z, 'w'])),
    ...[17, 25, 29, 34, 38, 43, 47, 54, 59].map((x) => /** @type {[number, number, string]} */ ([x, 37, 'n']))];
  for (const [x, z, d] of piers) {
    pilaster(p, x, z, top - 1);
    const [dx, dz] = { e: [1, 0], w: [-1, 0], n: [0, -1] }[d];
    // four of them were never switched off: pools of amber light in the dark hall, well away from the hall doors
    if (NIGHT_SCONCES.includes(`${x},${z}`)) fixture(p, x + dx, 3, z + dz, `sconce_true_${d}`, 'DINING');
    else dayLamp(p, x + dx, 3, z + dz, `sconce_false_${d}`, 'dining');
  }
  // the frieze: a red star every third block under the soffit
  for (let z = 10; z <= 37; z++) if (z % 3 === 0) p.set(63, 7, z, 'soffit_star');
  for (let x = 15; x <= 62; x++) if (x % 3 === 0) p.set(x, 7, 38, 'soffit_star');
  for (let x = 15; x <= 20; x++) if (x % 3 === 0) p.set(x, 7, 9, 'soffit_star');
  // ---- the dropped soffit round the room, a row of marquee bulbs along its edge: the house lights
  p.fill(15, top, 10, 16, top, 37, 'soffit_cream');
  p.fill(61, top, 9, 62, top, 37, 'soffit_cream');
  p.fill(15, top, 36, 62, top, 37, 'soffit_cream');
  for (let z = 10; z <= 35; z++) houseLamp(p, 17, top, z, 'bulb_off', 'DINING');
  for (let z = 9; z <= 35; z++) houseLamp(p, 60, top, z, 'bulb_off', 'DINING');
  for (let x = 18; x <= 59; x++) houseLamp(p, x, top, 35, 'bulb_off', 'DINING');
  // ---- the hall: long party tables on the checker aisle's sides, red-and-white hats, balloons tied to the tables
  for (const tx of DINING_TABLES.xs) tableRun(p, rng, 'z', tx, DINING_TABLES.z1, DINING_TABLES.z2);
  for (const [x, z] of [[27, 19], [33, 26], [44, 18], [50, 25]]) p.set(x, 1, z, `balloons_${(x + z) % 3}`);
  // cafe tables with star-back chairs at the sides, booths along the east and south walls
  for (const z of [18, 23, 28]) {
    cafeSet(p, rng, 21, z);
    cafeSet(p, rng, 56, z);
  }
  booth(p, rng, 'z', 23, [61, 62]);
  booth(p, rng, 'z', 27, [61, 62]);
  for (const x of [18, 21, 48, 51]) booth(p, rng, 'x', x, [36, 37]);
  // pendant lamps on chains over the long tables (lit by day)
  for (const tx of DINING_TABLES.xs) {
    for (const z of [17, 23, 29]) {
      p.fill(tx, 7, z, tx, top, z, 'chain_y');
      dayLamp(p, tx, 6, z, 'hanging_off', 'dining');
    }
  }
  // the truss across the room in front of the stage, moving lights hung under it
  for (let x = 18; x <= 59; x++) p.set(x, top, 15, 'truss_e');
  for (const [i, x] of [20, 26, 31, 46, 51, 57].entries()) parCan(p, x, top - 1, 15, i + 1, 'n');
  // the round drum in the ceiling over the middle of the room: a ring of bulbs and coloured spots, the mirror ball in it
  for (let x = Math.floor(DRUM.cx - DRUM.r - 1); x <= Math.ceil(DRUM.cx + DRUM.r + 1); x++) {
    for (let z = Math.floor(DRUM.cz - DRUM.r - 1); z <= Math.ceil(DRUM.cz + DRUM.r + 1); z++) {
      const d = Math.hypot(x + 0.5 - DRUM.cx, z + 0.5 - DRUM.cz);
      if (d < DRUM.r - 1) {
        p.set(x, top + 1, z, 'air');
        p.set(x, top + 2, z, 'ceiling_dark');
      } else if (d < DRUM.r) {
        p.set(x, top, z, 'soffit_cream');
        houseLamp(p, x, top - 1, z, 'bulb_off', 'DINING');
      }
    }
  }
  const cx = Math.floor(DRUM.cx), cz = Math.floor(DRUM.cz);
  /** @type {[number, number, string][]} */
  const drumCans = [[cx, cz - 4, 's'], [cx + 4, cz, 'w'], [cx, cz + 4, 'n'], [cx - 4, cz, 'e']];
  for (const [i, [x, z, d]] of drumCans.entries()) parCan(p, x, top - 2, z, i, d);
  p.fill(cx, top - 1, cz, cx, top + 1, cz, 'chain_y');
  p.set(cx, top - 2, cz, 'disco_ball');
  // paper garlands strung across the hall behind CAM 1A
  for (let x = 18; x <= 59; x++) if (!DINING_TABLES.xs.includes(x)) p.set(x, 7, 34, 'bunting_s');
  // ---- walls: framed posters between the pilasters, kids' drawings, the neon
  p.picture('poster_auction', 18, 5, 10, 's', 2, 3);
  p.picture('sign_midway', 15, 6, 23, 'e', 4, 1);
  p.picture('sign_cabaret', 15, 6, 35, 'e', 3, 1);
  p.picture('poster_revue', 62, 5, 23, 'w', 2, 3);
  p.picture('poster_party', 20, 5, 37, 'n', 2, 2);
  p.picture('poster_cabaret', 24, 5, 37, 'n', 2, 3);
  p.picture('poster_midway', 62, 5, 37, 'n', 2, 3);
  for (const [x0, n] of [[39, 4], [49, 5], [19, 4]]) for (let i = 0; i < n; i++) p.picture('drawing', x0 + i, 3, 37, 'n', 1, 1, rng.int(0, 5));
  neon(p, 'party', 37, 4, 37, 'n'); // over the Party Room door
  neon(p, 'arcade', 58, 4, 37, 'n'); // over the passage to the Game Room
  neon(p, 'pizza', 62, 6, 32, 'w'); // over the WELCOME arch
  neon(p, 'restrooms', 62, 5, 18, 'w'); // over the restroom door
  for (const [x, z] of [[17, 11], [57, 11], [16, 34], [24, 36]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  for (const x of [60, 61]) p.set(x, 0, 37, 'gumball');
  p.set(41, 0, 37, 'trash_n');
  p.fill(39, 0, 37, 40, 0, 37, 'dark_oak_stairs_s'); // a bench between the hall doors
  // exits over the hall doors and the entrance arch (high up: no glow spills into the halls)
  /** @type {[number, number, number, string][]} */
  const exits = [[27, 5, 37, 'n'], [45, 5, 37, 'n'], [62, 5, 33, 'w']];
  for (const [x, y, z, dir] of exits) {
    p.set(x, y, z, `exit_true_${dir}`);
    p.meta.exits.push({ x, y, z, dir });
  }
  p.set(61, 0, 21, 'wetsign_w');
  fixture(p, 61, 5, 12, 'emerg_true_w', 'DINING'); // by the kitchen door: it still turns at night
  p.set(15, 4, 11, 'exit_true_e');
  p.meta.exits.push({ x: 15, y: 4, z: 11, dir: 'e' });
  // the doors: dark oak frames
  doorFrame(p, 'backstage_door', 'z', 'dark_oak');
  doorFrame(p, 'kitchen_door', 'z', 'dark_oak');
  doorFrame(p, 'restroom_door', 'z', 'dark_oak');
  for (const id of ['west_hall', 'party_door', 'east_hall']) doorFrame(p, id, 'x', 'dark_oak');
  // ---- the sound and light booth at the back of the hall: a platform, the desk, a follow spot on its stand
  p.fill(30, 0, 36, 33, 0, 37, 'dark_oak');
  p.set(31, 1, 36, 'mixer_s');
  p.set(32, 1, 36, 'mixer_s');
  p.set(31, 1, 37, 'stool');
  p.fill(33, 1, 37, 33, 2, 37, 'iron_bars');
  p.set(33, 3, 37, 'spot_false_n');
  p.meta.spots.push({ x: 33, y: 3, z: 37, dir: 'n', group: 'stage' });
  p.set(30, 1, 37, 'road_case');
  p.set(30, 1, 36, 'clutter_n');
  // ---- the pizza counter in the north-east corner, at the kitchen's window: an oak counter under a cream fascia
  // and a striped awning, the menu board, the till, the soda fountain, stools
  p.fill(58, 0, 8, 62, 0, 8, 'wainscot');
  p.fill(58, 0, 3, 58, 0, 7, 'wainscot');
  column(p, 58, 8, 1, 3, 'column');
  p.fill(58, 4, 8, 62, 5, 8, 'soffit_cream');
  p.fill(58, 4, 1, 58, 5, 7, 'soffit_cream');
  for (let x = 59; x <= 62; x++) p.set(x, 3, 9, 'awning_s');
  for (let z = 2; z <= 8; z++) p.set(57, 3, z, 'awning_w');
  p.picture('menu_board', 59, 5, 9, 's', 4, 2);
  neon(p, 'slice', 58, 5, 9, 's');
  p.set(59, 1, 8, 'till_s');
  p.set(61, 1, 8, 'soda_s');
  p.set(60, 1, 8, 'pizza_2_n');
  p.set(62, 1, 8, 'plates');
  p.set(58, 1, 5, 'pizza_3_e');
  p.set(58, 1, 3, 'plates');
  for (const x of [59, 60, 61]) p.set(x, 0, 9, 'stool');
  // the pass under the window, heat lamps over it
  p.fill(62, 0, 3, 62, 0, 6, 'steel');
  p.set(62, 1, 4, 'pizza_2_e');
  p.set(62, 1, 6, 'pizza_1_n');
  p.fill(59, 5, 1, 62, 5, 7, 'soffit_cream');
  for (const z of [4, 6]) dayLamp(p, 61, 4, z, 'hanging_off', 'dining');
  p.set(60, 0, 2, 'barrel_n');
  p.set(59, 0, 1, 'trash_s');
  // ---- the salad bar against the east wall
  for (const [z, k] of [[13, 'greens'], [14, 'cheese'], [15, 'greens'], [16, 'empty']]) p.set(62, 0, z, `salad_${k}_w`);
  p.sign(62, 3, 15, 'w', ['', 'SALAD BAR', 'all you can eat']);
}

function midway(p, rng) {
  // The Midnight Midway (x 1-13, z 15-26, 7 tall): the striped tent with the ring in it. A frame of marquee bulbs
  // round the arch, a square truss of coloured cans and four pendants over the ring, paper garlands strung under
  // the tent top, gold stars on the canvas, a popcorn stand; the show tape by the south wall.
  const { cx, cz, r } = MIDWAY_RING;
  for (let x = cx - r - 1; x <= cx + r + 1; x++) {
    for (let z = cz - r - 1; z <= cz + r + 1; z++) {
      const d = Math.hypot(x + 0.5 - (cx + 0.5), z + 0.5 - (cz + 0.5));
      if (d <= r + 0.35) p.set(x, 0, z, d > r - 0.75 ? 'red_t' : 'stage_floor');
    }
  }
  // the arch's frame of bulbs (seen from both sides)
  for (let y = 0; y <= 5; y++) for (const z of [16, 26]) dayLamp(p, 14, y, z, 'bulb_off', 'midway');
  for (let z = 17; z <= 25; z++) dayLamp(p, 14, 5, z, 'bulb_off', 'midway');
  // over the ring: a truss square with coloured cans, pendants at its corners, the old lamp in the middle
  for (let x = 2; x <= 11; x++) for (const z of [17, 25]) p.set(x, 6, z, 'truss_e');
  for (let z = 18; z <= 24; z++) for (const x of [2, 11]) p.set(x, 6, z, 'truss_n'); // (east of the ring's edge: they step off it under x 10)
  /** @type {[number, number, string, number][]} */
  const cans = [[4, 18, 's', 0], [8, 18, 's', 2], [4, 24, 'n', 1], [8, 24, 'n', 3]];
  for (const [x, z, d, i] of cans) dayLamp(p, x, 6, z, `par_${PAR[i]}_false_${d}`, 'midway');
  for (const [x, z] of [[6, 21], [3, 16], [11, 16], [12, 25]]) dayLamp(p, x, 6, z, 'hanging_off', 'midway');
  // garlands under the tent top, stars on the canvas, the poster
  for (let x = 1; x <= 12; x++) {
    if (x < 3 || x > 4) p.set(x, 6, 15, 'bunting_s');
    p.set(x, 6, 26, 'bunting_n');
  }
  for (let z = 19; z <= 23; z++) if (z !== 21) p.set(6, 5, z, 'bunting_e');
  for (const [y, z] of [[4, 17], [5, 20], [3, 22], [5, 24]]) p.set(1, y, z, 'star_e');
  p.picture('poster_midway', 3, 4, 15, 's', 2, 3);
  p.picture('poster_cabaret', 9, 4, 15, 's', 2, 3);
  // the floor: the show tape, a popcorn stand, a speaker, balloons
  p.set(SHOW_TAPE.x, SHOW_TAPE.y, SHOW_TAPE.z, `tape_4_${SHOW_TAPE.dir}`);
  p.set(13, 0, 26, 'barrel_n');
  p.set(13, 1, 26, 'popcorn_w');
  p.set(12, 0, 16, `balloons_${rng.int(0, 2)}`);
  p.set(1, 0, 26, `balloons_${rng.int(0, 2)}`);
  p.set(2, 0, 16, 'speaker_e');
  p.set(1, 0, 16, 'road_case');
  p.set(1, 0, 23, 'trash_e');
}

function cabaret(p, rng) {
  // The Grand Marquee, the Ringmaster's own stage: purple velvet all round, a tinsel panel behind him, footlights
  // at the stage's edge, speaker stacks; towards the showroom a frame of marquee bulbs round the curtains.
  const [x1, z1, x2, z2] = CABARET.stage;
  p.fill(x1, 0, z1, x2, 0, z2, 'stage_floor');
  p.fill(3, 1, 31, 3, 5, 35, 'tinsel');
  for (const z of [30, 33, 36]) p.set(4, 3, z, 'star_e');
  for (const z of [31, 35]) {
    p.set(12, 1, z, 'foot_false_w');
    p.meta.spots.push({ x: 12, y: 1, z, dir: 'w', group: 'cabaret' });
    p.set(6, 1, z, 'speaker_e');
  }
  p.set(5, 0, 29, `balloons_${rng.int(0, 2)}`);
  // his spotlight hangs at the stage's far front corner, out of CAM 1C's view (the camera is high in the other corner)
  p.set(11, 6, 36, 'spot_false_w');
  p.meta.spots.push({ x: 11, y: 6, z: 36, dir: 'w', group: 'cabaret' });
  // dining side: the frame of bulbs, SORRY! OUT OF ORDER on the closed half of the curtain, a rope across the front
  for (let y = 0; y <= 5; y++) {
    for (const z of [29, 37]) {
      p.set(14, y, z, 'bulb_off');
      p.meta.spots.push({ x: 14, y, z, dir: 'e', group: 'cabaret' });
    }
  }
  for (let z = 30; z <= 36; z++) {
    p.set(14, 5, z, 'bulb_off');
    p.meta.spots.push({ x: 14, y: 5, z, dir: 'e', group: 'cabaret' });
  }
  p.picture('sign_out_of_order', 15, 3, 31, 'e', 2, 1);
  for (const z of [29, 37]) p.set(15, 0, z, 'stanchion');
  for (const z of [30, 31, 35, 36]) p.set(15, 0, z, 'rope_e');
}

function backstage(p, rng) {
  // Backstage (x 1-12, z 1-12; CAM 5): shelves of spare heads on two walls and the workbench (see decayBackstage),
  // and the band's dressing room round them: make-up mirrors ringed with bulbs over a counter on the east wall,
  // costume rails along the south wall, road cases, pendant lamps.
  for (let x = 2; x <= 12; x += 2) p.set(x, 0, 1, 'shelf_s');
  for (let z = 3; z <= 9; z += 2) p.set(1, 0, z, 'shelf_e');
  // workbench with parts
  p.fill(8, 0, 4, 11, 0, 4, 'blackstone_slab_top');
  p.set(9, 1, 4, 'anvil');
  p.set(11, 1, 4, 'pizza_1_n');
  // the dressing counter: mirrors, stools, somebody's things
  p.fill(12, 0, 5, 12, 0, 8, 'dark_oak_slab_top');
  for (const z of [5, 6, 8]) dayLamp(p, 12, 1, z, 'vanity_false_w', 'backstage');
  p.set(12, 1, 7, 'clutter_w');
  for (const z of [5, 7]) p.set(11, 0, z, 'stool');
  // costume rails along the south wall, road cases in the corner
  for (const [x, k] of [[4, 'band'], [5, 'midway'], [6, 'band'], [8, 'midway'], [9, 'bare']]) p.set(x, 0, 12, `rack_${k}_n`);
  for (const [x, y, z] of [[3, 0, 10], [3, 1, 10], [4, 0, 10], [2, 0, 9]]) p.set(x, y, z, 'road_case');
  p.set(12, 0, 2, 'mop_w');
  p.picture('poster_rules', 12, 4, 3, 'w', 2, 2);
  for (const [x, z] of [[6, 6], [10, 6], [4, 3], [9, 2], [3, 8], [8, 11]]) dayLamp(p, x, 5, z, 'hanging_off', 'backstage');
  if (rng.chance(1)) p.set(10, 0, 12, 'trash_n');
}

function kitchen(p, _rng) {
  // The kitchen (x 65-79, z 1-12; CAM 6, audio only): white tile to head height. Four deck ovens and a range under
  // a stainless hood on the north wall, the walk-in freezer in the north-east corner, two prep lines under a pot
  // rack, wire shelving and stacked boxes down the east wall, sinks and a drinks cooler (still lit) on the south
  // wall, the pass under the order window. The floor between the door and the duct's grate stays clear.
  // ---- the ovens and the range under the hood
  for (let x = 67; x <= 70; x++) {
    p.set(x, 0, 1, 'oven_0_s');
    p.set(x, 1, 1, 'oven_1_s');
  }
  p.set(72, 0, 1, 'smoker_s');
  p.set(73, 0, 1, 'blast_s');
  p.set(74, 0, 1, 'smoker_s');
  p.set(66, 0, 1, 'trash_s');
  p.fill(66, 4, 1, 74, 5, 2, 'steel');
  for (let x = 66; x <= 74; x++) p.set(x, 3, 2, 'iron_trapdoor_ceiling');
  // ---- the walk-in freezer: a stainless box with a heavy door, its compressor on top
  p.fill(76, 0, 1, 79, 4, 5, 'steel');
  p.set(76, 0, 3, 'freezer_0_w');
  p.set(76, 1, 3, 'freezer_1_w');
  p.picture('sign_small', 75, 2, 3, 'w', 1, 1, 1);
  p.set(77, 5, 3, 'ac_unit');
  // ---- two prep lines, a pot rack on chains over the first
  for (const [x, k] of [[67, 'dough'], [68, 'board'], [69, 'rail'], [73, 'rail'], [74, 'dough'], [75, 'board']]) p.set(x, 0, 6, `prep_${k}_s`);
  for (const x of [67, 69]) p.fill(x, 4, 6, x, 5, 6, 'chain_y');
  for (let x = 67; x <= 69; x++) p.set(x, 3, 6, 'potrack_n');
  p.set(68, 1, 6, 'pizza_1_n');
  p.set(75, 1, 6, 'pizza_3_e');
  // ---- the pass under the order window to the Dining Hall
  p.fill(65, 0, 3, 65, 0, 6, 'steel');
  p.set(65, 1, 3, 'pizza_1_w');
  p.set(65, 1, 6, 'pizza_3_w');
  p.set(65, 1, 5, 'plates');
  // ---- the east wall: wire shelving, boxes on a pallet
  for (let z = 7; z <= 10; z++) {
    p.set(79, 0, z, 'wshelf_0_w');
    p.set(79, 1, z, 'wshelf_1_w');
  }
  p.set(79, 0, 11, 'pallets_1');
  p.set(79, 1, 11, 'pizza_3_w');
  p.set(79, 0, 12, 'trash_w');
  // ---- the south wall: the drinks cooler (still running), three sinks, the mop
  for (const x of [67, 68]) {
    p.set(x, 0, 12, 'cooler_0_n');
    p.set(x, 1, 12, 'cooler_1_n');
  }
  for (let x = 71; x <= 73; x++) p.set(x, 0, 12, 'prep_sink_n');
  p.set(75, 0, 12, 'mop_n');
  p.set(76, 0, 12, 'wetsign_n');
  p.set(65, 0, 12, 'barrel_e');
  p.picture('sign_small', 72, 3, 12, 'n', 1, 1, 5);
  p.set(77, 1, 12, 'extinguisher_n');
  // floor drains
  for (const [x, z] of [[72, 4], [74, 9]]) p.set(x, -1, z, 'iron_trapdoor_floor');
}

function restrooms(p, _rng) {
  // The restrooms: a tiled passage (CAM 7) with the two doors, and behind each a low room with two laminate
  // stalls at the far end, sinks under mirrors, a hand dryer; urinals in the men's.
  for (const id of ['mens_door', 'womens_door']) doorFrame(p, id, 'z', 'smooth_quartz');
  p.picture('sign_staff', 68, 2, 16, 'w', 1, 1, 1);
  p.picture('sign_staff', 68, 2, 22, 'w', 1, 1, 2);
  p.set(68, 1, 20, 'mirror_whole_w');
  p.set(68, 0, 19, 'trash_w');
  p.set(65, 0, 17, 'fountain_e');
  p.set(65, 0, 25, 'mop_e');
  p.set(66, 0, 15, 'wetsign_s');
  p.set(68, 1, 25, 'extinguisher_w');
  for (const [id, z1, z2] of /** @type {[string, number, number][]} */ ([['MENS', 15, 19], ['WOMENS', 21, 25]])) {
    const men = id === 'MENS';
    // a dropped ceiling with one troffer: these rooms are 3 high
    p.fill(70, 3, z1, 79, 3, z2, 'ceiling');
    p.set(77, 3, z1 + 1, 'ceiling_stained');
    troffer(p, 74, 3, z1 + 2, id);
    // two stalls at the east end (each two blocks wide and deep): partitions, a fixed panel and a door each
    for (const [i, zs] of [[z1, z1 + 1], [z1 + 2, z1 + 3]].entries()) {
      p.set(79, 0, i === 0 ? zs[0] : zs[1], 'toilet_w');
      for (const x of [78, 79]) for (const h of [0, 1]) p.set(x, h, zs[1], `stall_wall_${h}_n`);
      const doorZ = i === 0 ? zs[1] : zs[0];
      const panelZ = i === 0 ? zs[0] : zs[1];
      for (const h of [0, 1]) {
        p.set(77, h, panelZ, `stall_wall_${h}_w`);
        p.set(77, h, doorZ, `stall_${i === 0 && men ? 'ajar' : 'door'}_${h}_w`);
      }
    }
    // sinks under mirrors on the wall away from the passage's noise, a hand dryer, a bin
    const wallZ = men ? z1 : z2;
    const d = men ? 's' : 'n';
    for (const [k, x] of [71, 72, 73].entries()) {
      p.set(x, 0, wallZ, `sink_${d}`);
      p.set(x, 1, wallZ, `mirror_${k === 1 ? 'cracked' : 'whole'}_${d}`);
    }
    p.set(75, 1, wallZ, `dryer_${d}`);
    p.set(70, 0, men ? z2 : z1, 'trash_e');
    if (men) for (const x of [72, 74]) p.set(x, 0, z2, 'urinal_n');
    else p.fill(72, 0, z1, 74, 0, z1, 'dark_oak_stairs_n');
    p.picture('sign_small', 76, 2, wallZ, d, 1, 1, 5);
  }
}

/** A coin-op token machine against a wall: steel base, the coin face, a lit header. `dir` = facing. */
function tokenMachine(p, x, z, dir) {
  p.set(x, 0, z, 'lgray_c');
  p.set(x, 1, z, `dropper_${dir}`);
  p.set(x, 2, z, 'yellow_c');
}

/** A claw machine against a wall: toys behind a glass front, the claw on its chain. (x, z) = the back cell, dir = facing. */
function clawMachine(p, x, z, dir, colour = 'blue_c') {
  const [dx, dz] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[dir];
  const fx = x + dx, fz = z + dz;
  p.set(x, 0, z, colour);
  p.set(fx, 0, fz, colour);
  p.set(x, 1, z, `plush_${dir}`);
  p.set(x, 2, z, 'chain_y');
  p.set(fx, 1, fz, 'window');
  p.set(fx, 2, fz, 'window');
  p.set(x, 3, z, 'yellow_c');
  p.set(fx, 3, fz, 'yellow_c');
}

function foyer(p, rng) {
  // The Entrance Hall (x 65-98, z 28-40, 7 tall): the lobby people queue in. Oak wainscot and a racing stripe under
  // warm yellow walls, cream pilasters, a dropped soffit along both long walls edged with marquee bulbs, pendant
  // lamps over the checker path from the glass doors to the WELCOME arch. Inside the doors the host stand and the
  // coat rack on one side, the ticket booth under its awning on the other; the mural of the whole cast over a
  // bench, the token counter under its starry bulkhead, prize cabinets either side of the Prize Corner's doorway,
  // rides, a claw machine and a photo booth between the arches to the games.
  const R = ROOM_BY_ID.FOYER;
  const top = R.h - 1; // 6
  // ---- the checker path from the doors to the arch
  p.fill(65, -1, 31, 98, -1, 37, 'tile');
  // ---- the WELCOME arch (the foyer side of the wall at x 64): a frame of marquee bulbs round the doorway
  for (const [y, z] of [[0, 30], [1, 30], [2, 30], [3, 30], [0, 36], [1, 36], [2, 36], [3, 36], [3, 31], [3, 35], [4, 31], [4, 32], [4, 33], [4, 34], [4, 35]]) {
    p.set(64, y, z, 'bulb_off');
    p.meta.hanging.push({ x: 64, y, z, group: 'foyer' });
  }
  p.picture('sign_welcome', 65, 6, 37, 'e', 9, 2);
  p.picture('height_chart', 65, 3, 39, 'e', 1, 3);
  for (const z of [30, 36]) p.set(65, 0, z, 'planter');
  // ---- pilasters, the soffits along the north and south walls and their bulbs (the house lights), pendants
  for (const x of [73, 86, 94]) pilaster(p, x, 28, top - 1);
  for (const x of [66, 77, 85, 93]) pilaster(p, x, 40, top - 1);
  p.fill(65, top, 28, 98, top, 29, 'soffit_cream');
  p.fill(65, top, 39, 98, top, 40, 'soffit_cream');
  for (let x = 73; x <= 98; x++) houseLamp(p, x, top, 30, 'bulb_off', 'FOYER');
  for (let x = 65; x <= 98; x++) houseLamp(p, x, top, 38, 'bulb_off', 'FOYER');
  for (const x of [70, 77, 84, 91, 97]) {
    p.set(x, top, 34, 'chain_y');
    dayLamp(p, x, top - 1, 34, 'hanging_off', 'foyer');
  }
  // ---- the token counter in the north-west corner: an oak counter with a glass case in it, the plush slatwall
  // behind, a cream bulkhead with red stars over it, the price board beside it
  p.fill(67, 0, 30, 69, 0, 30, 'wainscot');
  for (const x of [70, 71]) p.set(x, 0, 30, 'prizecase_s');
  p.fill(72, 0, 28, 72, 0, 30, 'wainscot');
  p.set(67, 1, 30, 'popcorn_s');
  p.set(68, 1, 30, 'till_s');
  p.set(69, 1, 30, 'plush_s');
  p.set(72, 1, 30, 'clutter_s');
  p.set(72, 1, 28, 'pizza_2_e');
  for (let x = 67; x <= 71; x++) for (const y of [1, 2, 3]) p.set(x, y, 28, 'plushwall_s');
  p.set(66, 0, 28, 'stool');
  p.fill(66, top - 1, 28, 72, top - 1, 29, 'soffit_cream');
  p.fill(66, top - 1, 30, 72, top, 30, 'soffit_cream');
  for (let x = 66; x <= 72; x += 2) p.set(x, top - 1, 30, 'soffit_star');
  neon(p, 'tokens', 68, top, 31, 's');
  p.picture('token_prices', 74, 4, 28, 's', 2, 2);
  for (const x of [74, 75]) p.set(x, 0, 28, 'gumball');
  // ---- the mural on the north wall, a bench under it behind a velvet rope
  p.picture('mural_revue', 76, 4, 28, 's', 8, 2);
  p.fill(77, 0, 28, 82, 0, 28, 'dark_oak_stairs_n');
  for (let x = 76; x <= 84; x++) p.set(x, 0, 30, (x - 76) % 2 ? 'rope_n' : 'stanchion');
  p.picture('poster_revue', 84, 5, 28, 's', 2, 3);
  // ---- the Prize Corner's doorway: a tall prize cabinet either side, PRIZES in neon over it
  doorFrame(p, 'prize_door', 'x', 'dark_oak');
  for (const x of [85, 95]) {
    p.set(x, 0, 28, 'case_0_s');
    p.set(x, 1, 28, 'case_1_s');
  }
  neon(p, 'prizes', 89, 4, 28, 's');
  // ---- inside the doors, north: the host stand, the coat rack over a bench, the auction notice
  p.set(96, 0, 31, 'host_s');
  for (const [z, k] of [[29, 'full'], [30, 'empty'], [31, 'full']]) p.set(98, 1, z, `coats_${k}_w`);
  p.picture('sign_small', 98, 3, 30, 'w', 1, 1, 6);
  p.fill(98, 0, 29, 98, 0, 30, 'dark_oak_stairs_e');
  p.picture('poster_auction', 96, 5, 28, 's', 2, 3);
  p.set(97, 0, 28, `balloons_${rng.int(0, 2)}`);
  // the doors' inner frame, the EXIT sign over them
  for (const z of [33, 38]) p.fill(99, 0, z, 99, 3, z, 'dark_oak');
  p.fill(99, 3, 34, 99, 3, 37, 'dark_oak');
  p.set(98, 4, 35, 'exit_true_w');
  p.meta.exits.push({ x: 98, y: 4, z: 35, dir: 'w' });
  // ---- inside the doors, south: the ticket booth (an oak counter, glass, a cream fascia, a striped awning)
  p.fill(94, 0, 38, 98, 0, 38, 'wainscot');
  p.fill(94, 0, 39, 94, 2, 40, 'wainscot');
  for (const x of [94, 98]) column(p, x, 38, 1, 2, 'column');
  for (const x of [95, 97]) p.fill(x, 1, 38, x, 2, 38, 'window');
  p.set(96, 2, 38, 'window');
  p.set(96, 1, 38, 'clutter_n');
  p.fill(94, 3, 38, 98, 4, 38, 'soffit_cream');
  p.fill(94, 3, 39, 94, 4, 40, 'soffit_cream');
  p.fill(95, 4, 39, 98, 4, 40, 'soffit_cream');
  for (const x of [94, 96, 98]) p.set(x, 4, 38, 'soffit_star');
  for (let x = 95; x <= 97; x++) p.set(x, 3, 37, 'awning_n');
  neon(p, 'tickets', 97, 5, 37, 'n');
  p.fill(95, 5, 38, 97, 5, 38, 'blackstone_slab');
  p.set(96, 0, 39, 'stool');
  dayLamp(p, 96, 3, 39, 'hanging_off', 'foyer');
  // ---- between the arches to the games: a photo booth, kiddie rides, the claw machine, kids' drawings
  doorFrame(p, 'gameroom_arch', 'x', 'dark_oak');
  doorFrame(p, 'funzone_arch', 'x', 'dark_oak');
  p.fill(78, 0, 39, 79, 2, 40, 'red_c');
  p.fill(78, 0, 39, 78, 1, 39, 'curtain_red');
  p.set(79, 1, 39, 'window');
  p.fill(78, 3, 39, 79, 3, 40, 'yellow_c');
  p.sign(79, 2, 38, 'n', ['PHOTOS', '', '4 for $1']);
  p.set(81, 0, 40, 'kiddie_n');
  p.set(82, 0, 40, 'claw_0_n');
  p.set(82, 1, 40, 'claw_1_n');
  p.set(84, 0, 40, 'kiddie_n');
  for (let x = 78; x <= 84; x++) p.set(x, 0, 37, (x - 78) % 2 ? 'rope_n' : 'stanchion');
  for (let i = 0; i < 3; i++) p.picture('drawing', 82 + i, 4, 40, 'n', 1, 1, rng.int(0, 5));
  p.picture('poster_cabaret', 81, 5, 40, 'n', 2, 3);
  neon(p, 'arcade', 73, 5, 40, 'n');
  neon(p, 'funzone', 90, 5, 40, 'n');
  p.set(65, 0, 40, 'trash_e');
  p.set(65, 0, 28, 'trash_e');
  p.set(93, 0, 38, `balloons_${rng.int(0, 2)}`);
}

function prize(p, rng) {
  // The Prize Corner (x 82-98, z 1-25): the glass counter across the room under a cream bulkhead edged with
  // bulbs, the plush wall and lit prize cabinets behind it, the grand prize on its stand; on the customers' side
  // change machines, claw machines between cream pilasters, benches under the windows, a velvet rope line.
  p.fill(83, -1, 12, 97, -1, 14, 'tile');
  // ---- the counter and what is behind it
  for (let x = 84; x <= 96; x++) p.set(x, 0, 11, 'prizecase_s');
  for (const x of [83, 97]) p.set(x, 0, 11, 'wainscot');
  for (const x of [85, 89, 93]) p.set(x, 1, 11, 'plush_s');
  p.set(96, 1, 11, 'till_s');
  for (let x = 83; x <= 97; x++) for (const y of [1, 2, 3, 4]) p.set(x, y, 1, 'plushwall_s');
  neon(p, 'prizes', 89, 5, 1, 's');
  for (const x of [84, 96]) neon(p, 'star', x, 5, 1, 's');
  for (const x of [84, 86, 88, 92, 94, 96]) {
    p.set(x, 0, 5, 'case_0_s');
    p.set(x, 1, 5, 'case_1_s');
  }
  for (const x of [85, 87, 93, 95]) p.set(x, 0, 5, rng.pick(['gift_red', 'gift_blue', 'gift_yellow', 'gift_purple']));
  for (const x of [85, 87, 93, 95]) p.set(x, 1, 5, rng.pick(['plush_s', 'pizza_3_n', 'gift_pink', 'gift_lime']));
  // the grand prize: a rocket ride on a stand, 5000 tickets
  p.fill(89, 0, 3, 91, 0, 4, 'smooth_quartz');
  p.set(90, 1, 3, 'kiddie_s');
  p.sign(90, 0, 5, 's', ['GRAND PRIZE', '5000', 'tickets']);
  // ---- the bulkhead over the counter: cream plaster, red stars, a row of bulbs (the room's house lights)
  p.fill(82, 5, 10, 98, 5, 12, 'soffit_cream');
  for (let x = 83; x <= 97; x++) {
    if (x % 3 === 0) p.set(x, 5, 10, 'soffit_star');
    houseLamp(p, x, 5, 12, 'bulb_off', 'PRIZE');
  }
  for (const [x, z] of [[85, 8], [88, 9], [91, 8], [94, 9]]) {
    p.set(x, 5, z, 'chain_y');
    p.set(x, 4, z, 'plush_s');
  }
  // ---- the customers' side: change machines and a bench on the west wall, claw machines between pilasters and
  // benches under the windows on the east wall, the rope line
  for (const z of [14, 17, 20]) {
    p.set(82, 0, z, 'change_0_e');
    p.set(82, 1, z, 'change_1_e');
  }
  neon(p, 'tokens', 82, 4, 18, 'e');
  p.fill(82, 0, 22, 82, 0, 24, 'dark_oak_stairs_w');
  for (const z of [9, 17, 20]) pilaster(p, 98, z, 5);
  for (const z of [18, 19]) {
    p.set(98, 0, z, 'claw_0_w');
    p.set(98, 1, z, 'claw_1_w');
  }
  p.fill(98, 0, 12, 98, 0, 15, 'dark_oak_stairs_e');
  p.fill(98, 0, 22, 98, 0, 24, 'dark_oak_stairs_e');
  for (let x = 85; x <= 93; x++) p.set(x, 0, 15, (x - 85) % 2 ? 'rope_n' : 'stanchion');
  p.set(90, 0, 20, 'kiddie_s');
  for (const [x, z] of [[83, 25], [97, 13], [83, 12]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  p.picture('poster_party', 84, 4, 25, 'n', 2, 2);
  p.picture('poster_revue', 96, 5, 25, 'n', 2, 3);
  p.picture('sign_small', 82, 3, 12, 'e', 1, 1, 3);
  p.set(97, 0, 25, 'trash_n');
}

function halls(p, rng) {
  // The two halls to the office (3 wide, 6 tall): checker wainscot under a charcoal rail, stained plaster, a dark
  // crown under the ceiling. Charcoal piers every six blocks give them a rhythm, dead brass sconces between
  // (lit by day), posters and kids' drawings, a fire extinguisher, a drinking fountain, the staff notice board.
  // Nothing here is lit at night: the halls stay black until a hall light is switched on.
  /** A wall pier from the floor to the crown: side 'e' = on the west wall (facing east), 'w' = on the east wall. */
  const pier = (x, z, d) => {
    p.set(x, 0, z, `pier_foot_${d}`);
    for (let y = 1; y <= 4; y++) p.set(x, y, z, `pier_shaft_${d}`);
    p.set(x, 5, z, `pier_head_${d}`);
  };
  for (const z of [41, 47, 53]) {
    pier(26, z, 'e');
    pier(28, z, 'w');
    pier(44, z, 'e');
    pier(46, z, 'w');
  }
  // ---- West Hall (CAM 2A): the rules poster, drawings down the east wall, a paper garland left up at the far end
  p.picture('poster_rules', 26, 4, 43, 'e', 2, 2);
  for (let z = 44; z <= 54; z += 2) p.picture('drawing', 28, 3, z, 'w', 1, 1, rng.int(0, 5));
  p.picture('poster_party', 26, 4, 56, 'e', 2, 2);
  for (const z of [44, 54]) dayLamp(p, 26, 3, z, 'sconce_false_e', 'hall_w');
  for (const z of [43, 49, 55]) dayLamp(p, 28, 4, z, 'sconce_false_w', 'hall_w');
  p.set(28, 1, 46, 'extinguisher_w');
  p.set(26, 0, 52, 'trash_e');
  p.set(28, 0, 40, 'wetsign_w');
  for (let z = 39; z <= 40; z++) {
    p.set(28, 5, z, 'bunting_w');
    p.set(26, 5, z, 'bunting_e');
  }
  doorFrame(p, 'supply_door', 'z', 'dark_oak');
  // ---- W. Hall Corner (CAM 2B, and through the left door when its light is on): piers either side of the door,
  // a dead beacon over it, a dead plant and a bin at the blind end
  pier(30, 64, 'w');
  pier(30, 68, 'w');
  pier(26, 59, 'e');
  pier(26, 68, 'e');
  p.set(30, 4, 66, 'emerg_false_w');
  for (let z = 59; z <= 70; z++) p.set(26, 5, z, 'pipes_run_n'); // old heating pipes under the ceiling
  for (let z = 64; z <= 68; z++) p.set(30, -1, z, z % 2 ? 'black_c' : 'yellow_c'); // a hazard strip across the threshold
  p.picture('poster_missing', 26, 3, 69, 'e', 1, 2);
  p.set(26, 0, 70, 'planter');
  p.set(30, 0, 70, 'trash_w');
  p.set(27, 0, 60, 'decal_drag_s');
  // ---- East Hall (CAM 4A): drawings down the west wall, posters and the notice board on the east wall
  for (let z = 44; z <= 54; z += 2) p.picture('drawing', 44, 3, z, 'e', 1, 1, rng.int(0, 5));
  p.picture('poster_revue', 46, 4, 42, 'w', 2, 3);
  p.picture('poster_party', 46, 4, 48, 'w', 2, 2);
  p.picture('notice_board', 46, 3, 55, 'w', 2, 1);
  for (const z of [43, 49, 55]) dayLamp(p, 44, 4, z, 'sconce_false_e', 'hall_e');
  for (const z of [46, 52]) dayLamp(p, 46, 3, z, 'sconce_false_w', 'hall_e');
  p.set(46, 0, 40, 'fountain_w');
  p.set(44, 1, 45, 'extinguisher_e');
  p.set(46, 0, 54, 'trash_w');
  for (let z = 39; z <= 40; z++) p.set(44, 5, z, 'bunting_e');
  // ---- E. Hall Corner (CAM 4B): piers either side of the right door, the corner poster
  pier(42, 64, 'e');
  pier(42, 68, 'e');
  pier(46, 59, 'w');
  p.set(42, 4, 66, 'emerg_false_e');
  for (let z = 59; z <= 69; z++) p.set(46, 5, z, 'pipes_run_n');
  for (let z = 64; z <= 68; z++) p.set(42, -1, z, z % 2 ? 'black_c' : 'yellow_c');
  p.picture('poster_party', 46, 4, 60, 'w', 2, 2);
  p.set(46, 1, 63, 'extinguisher_w');
  p.set(46, 0, 66, 'decal_drag_n');
  // office windows (glass + bars) on both sides
  for (const side of ['L', 'R']) {
    const w = OFFICE.windows[side];
    p.fill(w.x, w.y1, w.z1, w.x, w.y2, w.z2, 'window');
  }
}

function supply(p, _rng) {
  // The Supply Closet (x 19-23, z 41-50; CAM 3): wire shelving down the west wall, parts shelves at the end, the
  // janitor's sink, pallets and drums; the middle of the floor stays clear.
  for (let z = 43; z <= 47; z++) {
    p.set(19, 0, z, 'wshelf_0_e');
    p.set(19, 1, z, 'wshelf_1_e');
  }
  for (const x of [20, 22]) p.set(x, 0, 41, 'shelf_s');
  p.set(21, 0, 41, 'road_case');
  p.set(23, 0, 41, 'prep_sink_w');
  p.set(23, 0, 43, 'mop_w');
  p.set(23, 1, 49, 'extinguisher_w');
  p.set(19, 0, 49, 'pallets_2');
  p.set(19, 0, 50, 'barrel_n');
  p.set(20, 0, 50, 'barrel_n');
  p.set(20, 1, 50, 'barrel_n');
  p.set(23, 0, 50, 'wetsign_n');
  p.set(22, 0, 42, 'trash_w');
  p.picture('sign_small', 23, 3, 44, 'w', 1, 1, 5);
  for (const z of [44, 49]) p.set(20, 5, z, 'wires_bundle_n');
}

function party(p, rng) {
  // The Party Room between the halls (x 31-41, z 40-56): one long birthday table, and at the far end a little
  // dais under a starry backdrop with the birthday chair, HAPPY BIRTHDAY strung over it; a gift table, garlands
  // across the room, balloons everywhere, two warm pendants over the table.
  tableRun(p, rng, 'z', 36, 43, 52, { chairs: 1, every: 1 });
  for (const [z, k] of [[44, 'hat_0'], [46, 'plates'], [48, 'bday_false_n'], [50, 'plates'], [51, 'hat_2']]) p.set(36, 1, z, k);
  p.fill(34, -1, 41, 38, -1, 53, 'tile');
  for (const z of [42, 47, 52]) for (const x of [31, 41]) if (!(x === 31 && z === 47) && !(x === 41 && z === 47)) pilaster(p, x, z, 4);
  for (const x of [33, 39]) p.set(x, 0, 41, `balloons_${x % 3}`);
  // the dais and its backdrop
  p.fill(33, 0, 55, 39, 0, 56, 'dark_oak');
  p.fill(34, 0, 54, 38, 0, 54, 'dark_oak_stairs_s');
  p.fill(33, 1, 57, 39, 4, 57, 'curtain_star');
  for (const x of [33, 39]) p.fill(x, 1, 57, x, 4, 57, 'tinsel');
  p.set(36, 1, 56, 'starchair_n');
  p.picture('banner_birthday', 39, 4, 56, 'n', 6, 1);
  for (const [x, k] of [[34, 'gift_red'], [35, 'gift_yellow'], [37, 'gift_blue'], [38, 'gift_purple']]) p.set(x, 1, 56, k);
  p.set(34, 2, 56, 'gift_pink');
  for (const x of [33, 39]) p.set(x, 1, 55, `balloons_${x % 3}`);
  // the gift table on the west wall, a bench on the east
  for (const [z, k] of [[49, 'table_1_n'], [50, 'table_2_n'], [51, 'table_1_s']]) p.set(31, 0, z, k);
  for (const [z, k] of [[49, 'gift_lime'], [50, 'pizza_3_e'], [51, 'gift_blue']]) p.set(31, 1, z, k);
  p.fill(41, 0, 43, 41, 0, 45, 'dark_oak_stairs_e');
  // garlands round and across the room, the neon over the door, posters, drawings
  for (let x = 31; x <= 41; x++) {
    p.set(x, 4, 40, 'bunting_s');
    for (const z of [45, 50]) p.set(x, 4, z, 'bunting_s');
  }
  for (let z = 41; z <= 55; z++) {
    if (z !== 45 && z !== 50) {
      p.set(31, 4, z, 'bunting_e');
      p.set(41, 4, z, 'bunting_w');
    }
  }
  neon(p, 'party', 36, 4, 40, 's');
  for (const z of [46, 51]) dayLamp(p, 36, 4, z, 'hanging_off', 'party');
  p.picture('poster_party', 31, 3, 46, 'e', 2, 2);
  p.picture('poster_revue', 41, 3, 48, 'w', 2, 3);
  for (let i = 0; i < 3; i++) p.picture('drawing', 31, 2, 53 + i, 'e', 1, 1, rng.int(0, 5));
  for (const [x, z] of [[31, 41], [41, 41], [32, 53], [40, 53], [41, 47]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  p.set(41, 0, 40, 'trash_w');
}

/** One sign out of the neon_sign block (see NEON in palette.js). */
function neon(p, which, x, y, z, dir) {
  const [first, w, h] = NEON[which];
  p.picture('neon_sign', x, y, z, dir, w, h, null, first);
}

function gameroom(p, rng) {
  // The Game Room (x 49-79, z 43-61, 7 tall, black ceiling): banks of five different arcade games back to back,
  // a row of pinball tables down the west wall, skee-ball along the north wall, air hockey, change machines, claw
  // machines by the arch, the ticket counter in the south-east corner, the crawl tube from the Fun Zone overhead.
  // A line of pink and teal neon runs round the walls: at night it, the screens and the coin slots are all
  // that is still lit.
  /** An arcade machine (both halves): game 0 is RAT RACE, 1-4 the others. */
  const cab = (x, z, dir, game) => {
    const k = game ? `arcade${game}` : 'arcade';
    p.set(x, 0, z, `${k}_0_${dir}`);
    p.set(x, 1, z, `${k}_1_${dir}`);
  };
  /** A two-block machine of another kind (change, claw). */
  const tall = (key, x, z, dir) => {
    p.set(x, 0, z, `${key}_0_${dir}`);
    p.set(x, 1, z, `${key}_1_${dir}`);
  };
  // ---- the floor: a checker walk in from the arch and along the counter
  p.fill(68, -1, 43, 76, -1, 46, 'tile');
  p.fill(70, -1, 57, 79, -1, 58, 'tile');
  // ---- the neon line round the walls (four blocks pink, four teal), under the ceiling
  const tube = (x, z, d, i) => p.set(x, 5, z, `glow_${Math.floor(i / 4) % 2 ? 'teal' : 'pink'}_bar_${d}`);
  for (let x = 49; x <= 79; x++) {
    if (x < 59 || x > 61) tube(x, 43, 's', x - 49);
    tube(x, 61, 'n', x - 49 + 2);
  }
  for (let z = 44; z <= 60; z++) {
    tube(49, z, 'e', z - 44 + 2);
    if (z !== 50) tube(79, z, 'w', z - 44);
  }
  // ---- skee-ball along the north wall, west of the passage in from the showroom (x 55-58)
  for (let x = 49; x <= 54; x++) {
    p.set(x, 0, 43, 'skee_back_s');
    p.set(x, 0, 44, 'skee_front_s');
  }
  neon(p, 'skeeball', 50, 4, 43, 's');
  neon(p, 'star', 54, 4, 43, 's');
  neon(p, 'arcade', 56, 4, 43, 's'); // the inside face of the passage
  // ---- two pairs of arcade banks back to back (their games change every three machines), a third pair beyond
  for (const [zA, zB, g0] of [[49, 50, 0], [55, 56, 2]]) {
    for (let x = 53; x <= 65; x++) {
      if (x === 59) continue; // a gap to walk through
      const g = (g0 + Math.floor((x - 53) / 3)) % 5;
      cab(x, zA, 'n', g);
      cab(x, zB, 's', (g + 2) % 5);
    }
  }
  for (let x = 69; x <= 75; x++) cab(x, 55, 'n', (1 + Math.floor((x - 69) / 3)) % 5);
  for (let x = 69; x <= 72; x++) cab(x, 56, 's', 4);
  for (const z of [55, 57]) cab(79, z, 'w', z === 55 ? 3 : 0);
  for (const [x, z] of [[54, 48], [57, 48], [63, 48], [61, 51], [56, 57], [70, 54]]) p.set(x, 0, z, 'stool');
  // ---- pinball down the west wall: the backboxes against the wall, the players in the aisle
  for (const z of [47, 49, 51, 55, 57, 59]) {
    p.set(49, 0, z, 'pinball_back_e');
    p.set(50, 0, z, 'pinball_front_e');
  }
  // ---- two air hockey tables
  for (const x of [69, 73]) {
    p.set(x, 0, 50, 'airhockey_w');
    p.set(x + 1, 0, 50, 'airhockey_e');
  }
  // ---- change machines under the tube's junction box and on the south wall, either side of the STAFF ONLY door
  for (const x of [59, 61]) tall('change', x, 43, 's');
  for (const x of [55, 57, 66, 68]) tall('change', x, 61, 'n');
  neon(p, 'tokens', 68, 4, 61, 'n');
  neon(p, 'games', 64, 4, 61, 'n');
  for (const x of [52, 70]) neon(p, 'star', x, 4, 61, 'n');
  // ---- by the arch from the Entrance Hall: claw machines, a kiddie ride, tables for the parents
  for (const x of [77, 78]) tall('claw', x, 43, 's');
  tall('claw', 79, 45, 'w');
  p.set(66, 0, 44, 'kiddie_s');
  for (const [x, z] of [[64, 45], [70, 45]]) {
    p.set(x, 0, z, 'table_0_n');
    p.set(x - 1, 0, z, 'chair_e');
    p.set(x + 1, 0, z, 'chair_w');
    p.set(x, 1, z, (x + z) % 2 ? 'plates' : 'pizza_1_n');
  }
  // ---- the ticket counter in the south-east corner: glass cases, the plush wall, stools
  for (let x = 71; x <= 77; x++) p.set(x, 0, 59, 'prizecase_n');
  p.set(78, 0, 59, 'wainscot');
  for (const x of [72, 75]) p.set(x, 1, 59, 'plush_s');
  p.set(78, 1, 59, 'till_n');
  for (let x = 71; x <= 78; x++) for (const y of [1, 2]) p.set(x, y, 61, 'plushwall_n');
  neon(p, 'tickets', 76, 4, 61, 'n');
  p.set(74, 0, 60, 'stool');
  // ---- pendant lamps (the room's lamps by day)
  for (const [x, z] of [[54, 46], [63, 46], [72, 47], [77, 53], [53, 53], [61, 58], [67, 53], [74, 53]]) houseLamp(p, x, 6, z, 'hanging_off', 'GAMEROOM');
  // ---- the overhead crawl tube: out of the Fun Zone wall, west along z 50, a bubble window, into a junction box
  for (let x = 62; x <= 79; x++) {
    const c = ['red', 'yellow', 'blue', 'green'][Math.floor((x - 62) / 3) % 4];
    p.set(x, 5, 50, x % 6 === 1 ? `tube_win_${c}_e` : `tube_${c}_e`);
    if (x % 4 === 0) p.set(x, 6, 50, 'chain_y');
  }
  p.fill(59, 4, 49, 61, 5, 51, 'vinyl_yellow');
  p.set(60, 6, 50, 'chain_y');
  p.set(60, 4, 50, 'vinyl_red');
  for (let z = 44; z <= 48; z++) p.set(60, 5, z, z === 46 ? 'tube_win_red_n' : `tube_${z % 2 ? 'green' : 'blue'}_n`);
  p.fill(59, 4, 43, 61, 5, 43, 'vinyl_green');
  for (const [x, z] of [[49, 43], [79, 61], [49, 61]]) p.set(x, 6, z, 'cobweb');
  // the floor of a busy game room: ticket strips everywhere
  /** @type {[number, number, string][]} */
  const strips = [[61, 47, 'tickets'], [67, 52, 'tickets_b'], [58, 53, 'tickets'], [72, 46, 'confetti'], [63, 58, 'tickets_b'], [76, 57, 'tickets']];
  for (const [x, z, k] of strips) {
    p.set(x, 0, z, `decal_${k}_${['n', 'e', 's', 'w'][(x + z) % 4]}`);
  }
  if (rng.chance(0)) p.set(50, 0, 53, 'trash_e');
}

function funzone(p) {
  // The Fun Zone (x 81-98, z 43-70, 9 tall): a soft-play frame that fills the room. Two two-storey towers either
  // side of the way in, joined by a crawl tube; a slide off the east one into the ball pit; over the far end of
  // the pit a castle on four posts with a three-lane slide, a top deck under a red roof, foam steps up its side;
  // crawl tubes overhead from the towers round to the castle and out through the wall into the Game Room.
  // Padded mats on the floor, shoe cubbies by the door, neon along the side walls.
  // ---- padded floor mats (two by two, blue and red) round the pit
  for (let x = 81; x <= 98; x++) for (let z = 43; z <= 70; z++) p.set(x, -1, z, (x % 4 < 2) === (z % 4 < 2) ? 'vinyl_blue' : z < 53 ? 'vinyl_yellow' : 'vinyl_red');
  // ---- the ball pit (x 85-95, z 54-69): padded walls two high (blue, a yellow top rail), balls a block and a half deep
  for (let x = 85; x <= 95; x++) {
    for (let z = 54; z <= 69; z++) {
      const wall = x === 85 || x === 95 || z === 54 || z === 69;
      if (wall) {
        p.set(x, 0, z, 'vinyl_blue');
        p.set(x, 1, z, 'vinyl_yellow');
      } else {
        p.set(x, 0, z, 'balls');
        p.set(x, 1, z, 'balls_top');
      }
    }
  }
  p.fill(89, 0, 69, 91, 1, 69, 'vinyl_red'); // the steps in at the back
  p.set(90, 1, 69, 'balls_top');
  // ---- two play towers, two storeys each: decks at y 3 and 6 on padded posts, net railings, a red roof
  const tower = (x1, x2, post, tubeX) => {
    for (const [x, z] of [[x1, 44], [x2, 44], [x1, 48], [x2, 48]]) column(p, x, z, 0, 8, post);
    p.fill(x1, 3, 44, x2, 3, 48, 'vinyl_blue');
    p.fill(x1, 6, 44, x2, 6, 48, 'vinyl_yellow');
    p.fill(x1, 8, 44, x2, 8, 48, 'vinyl_red');
    for (const y of [4, 7]) {
      for (let x = x1 + 1; x < x2; x++) {
        p.picture('play_net', x, y, 44, 's', 1, 1, (x + y) % 2);
        if (x !== (y === 4 ? (x1 + x2) >> 1 : tubeX)) p.picture('play_net', x, y, 48, 'n', 1, 1, (x + y + 1) % 2);
      }
    }
    for (let x = x1 + 1; x < x2; x++) for (let z = 45; z <= 47; z++) if ((x + z) % 3 === 0) p.set(x, 0, z, 'balls_top'); // balls spilled under it
  };
  tower(81, 85, 'vinyl_red', 83);
  tower(93, 97, 'vinyl_green', 96);
  for (const x of [83, 95]) dayLamp(p, x, 2, 46, 'hanging_off', 'funzone'); // a lamp under each deck
  for (let x = 86; x <= 92; x++) p.set(x, 6, 43, `glow_${x % 2 ? 'pink' : 'yellow'}_bar_s`); // neon over the way in
  for (const y of [4, 7]) {
    for (const z of [45, 47]) p.picture('play_net', 85, y, z, 'w', 1, 1, 0);
    for (const z of [45, 47]) p.picture('play_net', 93, y, z, 'e', 1, 1, 1);
  }
  // ladders up to both decks (on the south faces, a padded panel behind them)
  for (const x of [83, 95]) {
    p.fill(x, 0, 48, x, 2, 48, 'vinyl_yellow');
    for (const y of [0, 1, 2]) p.set(x, y, 49, 'ladder_s');
  }
  // the crawl tube between the towers (over the arch from the entrance hall)
  for (let x = 86; x <= 92; x++) p.set(x, 4, 46, x === 89 ? 'tube_win_yellow_e' : `tube_${x % 2 ? 'red' : 'blue'}_e`);
  // a riser box on the west tower and the tube out through the wall into the Game Room
  p.fill(81, 4, 49, 82, 5, 51, 'vinyl_yellow');
  p.set(81, 5, 50, 'tube_red_e');
  // the slide off the east tower into the ball pit
  p.fill(92, 3, 48, 92, 3, 50, 'vinyl_blue'); // the walkway from the tower deck to the top of the slide
  p.set(91, 3, 50, 'vinyl_blue');
  for (const z of [49, 50]) p.fill(92, 0, z, 92, 2, z, 'vinyl_green');
  p.set(91, 3, 51, 'slide_chute_s');
  p.set(91, 2, 52, 'slide_chute_s');
  p.set(91, 1, 53, 'slide_chute_s');
  p.set(91, 1, 54, 'slide_lip_s');
  // ---- the castle over the far end of the pit: four posts, a deck with net railings, a gate beam with the
  // FUN ZONE neon, a three-lane slide down into the balls, a top deck under a red roof
  /** @type {[number, number, string][]} */
  const posts = [[86, 62, 'vinyl_red'], [94, 62, 'vinyl_green'], [86, 68, 'vinyl_green'], [94, 68, 'vinyl_red']];
  for (const [x, z, k] of posts) column(p, x, z, 0, 7, k);
  p.fill(86, 3, 62, 94, 3, 68, 'vinyl_blue');
  for (const [x, z, k] of posts) column(p, x, z, 4, 7, k);
  p.fill(87, 5, 62, 93, 5, 62, 'vinyl_yellow');
  neon(p, 'funzone', 91, 5, 61, 'n');
  for (let x = 87; x <= 93; x++) {
    if (x < 89 || x > 91) p.picture('play_net', x, 4, 62, 's', 1, 1, x % 2);
    p.picture('play_net', x, 4, 68, 'n', 1, 1, (x + 1) % 2);
  }
  for (let z = 63; z <= 67; z++) {
    p.picture('play_net', 94, 4, z, 'w', 1, 1, z % 2);
    if (z < 66) p.picture('play_net', 86, 4, z, 'e', 1, 1, (z + 1) % 2);
  }
  for (const x of [89, 90, 91]) {
    p.set(x, 3, 61, 'slide_chute_n');
    p.set(x, 2, 60, 'slide_chute_n');
    p.set(x, 1, 59, 'slide_chute_n');
    p.set(x, 1, 58, 'slide_lip_n');
  }
  for (const [x, z] of [[88, 64], [92, 64], [88, 68], [92, 68]]) column(p, x, z, 4, 7, 'vinyl_yellow');
  p.fill(88, 6, 64, 92, 6, 68, 'vinyl_blue');
  p.fill(87, 8, 63, 93, 8, 68, 'vinyl_red');
  for (let x = 89; x <= 91; x++) p.picture('play_net', x, 7, 64, 's', 1, 1, x % 2);
  p.fill(87, 4, 66, 87, 4, 67, 'vinyl_red'); // foam steps up to the top deck
  p.set(87, 5, 67, 'vinyl_red');
  // foam steps up its west side
  p.set(84, 0, 66, 'vinyl_yellow');
  p.fill(84, 0, 67, 84, 1, 67, 'vinyl_red');
  p.fill(84, 0, 68, 84, 2, 68, 'vinyl_green');
  p.fill(85, 2, 66, 85, 2, 68, 'vinyl_blue');
  p.fill(85, 3, 66, 85, 3, 68, 'vinyl_blue');
  // ---- the crawl tubes overhead: out of both tower tops, south along the walls, a junction box each, across the
  // room over the pit, and on round into the castle's top deck
  /** @type {[number, string][]} */
  const risers = [[83, 'vinyl_green'], [96, 'vinyl_red']];
  for (const [x, post] of risers) {
    for (let z = 49; z <= 56; z++) p.set(x, 7, z, z === 52 ? `tube_win_yellow_n` : `tube_${z % 2 ? 'blue' : 'red'}_n`);
    p.fill(x - 1, 6, 57, x + 1, 8, 59, 'vinyl_yellow');
    p.set(x, 7, 58, 'vinyl_blue');
    column(p, x, 58, 0, 5, post);
    for (const z of [50, 54, 62]) p.set(x, 8, z, 'chain_y');
    for (let z = 60; z <= 64; z++) p.set(x, 7, z, z === 62 ? 'tube_win_green_n' : `tube_${z % 2 ? 'yellow' : 'red'}_n`);
    p.set(x, 7, 65, 'vinyl_yellow');
    p.set(x, 8, 65, 'chain_y');
  }
  for (let x = 84; x <= 87; x++) p.set(x, 7, 65, `tube_${x % 2 ? 'blue' : 'green'}_e`);
  for (let x = 93; x <= 95; x++) p.set(x, 7, 65, `tube_${x % 2 ? 'blue' : 'green'}_e`);
  for (let x = 85; x <= 94; x++) {
    p.set(x, 7, 58, x === 88 || x === 92 ? 'tube_win_green_e' : `tube_${['red', 'yellow', 'blue'][x % 3]}_e`);
    if (x % 3 === 0) p.set(x, 8, 58, 'chain_y');
  }
  // ---- by the door: shoe cubbies under the towers, SOCKS ONLY
  for (const x of [82, 83, 84, 94, 95, 96]) p.set(x, 0, 43, 'cubby_s');
  p.picture('sign_small', 85, 2, 43, 's', 1, 1, 4);
  p.picture('sign_small', 93, 2, 43, 's', 1, 1, 4);
  // ---- kiddie rides and benches along the sides of the pit, neon along the side walls
  for (const z of [55, 60]) p.set(82, 0, z, 'kiddie_e');
  for (const z of [61, 65]) p.fill(98, 0, z, 98, 0, z + 2, 'dark_oak_stairs_e');
  for (let z = 53; z <= 70; z++) {
    p.set(81, 6, z, `glow_${Math.floor((z - 53) / 3) % 2 ? 'pink' : 'yellow'}_bar_e`);
    p.set(98, 6, z, `glow_${Math.floor((z - 53) / 3) % 2 ? 'yellow' : 'pink'}_bar_w`);
  }
  neon(p, 'star', 81, 5, 61, 'e');
  neon(p, 'star', 98, 5, 60, 'w');
  for (const [x, z] of [[81, 69], [98, 44], [98, 70]]) p.set(x, 8, z, 'cobweb');
  // ---- the dust of the last week: tickets, a puddle under a leak, a lost party hat
  /** @type {[number, number, string][]} */
  const litter = [[88, 50, 'tickets'], [92, 52, 'tickets_b'], [87, 44, 'confetti'], [97, 53, 'tickets'], [83, 63, 'confetti']];
  for (const [x, z, k] of litter) p.set(x, 0, z, `decal_${k}_${['n', 'e', 's', 'w'][(x + z) % 4]}`);
  p.set(98, 0, 69, 'decal_puddle_n');
  p.set(98, 9, 69, 'ceiling_missing');
  p.set(98, 8, 69, 'wires_bundle_n');
  p.set(86, 0, 52, 'hat_2');
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
  // the old bank of security monitors over the desk: dead since the 80s, only the desk CRT still works
  for (let x = 34; x <= 38; x++) for (const y of [2, 3]) p.set(x, y, 60, 'crt_false_s');
  p.fill(34, 4, 60, 38, 4, 60, 'blackstone_slab_top');
  // posters and drawings on the walls
  p.picture('drawing', 32, 3, 61, 'e', 1, 1, 2);
  p.picture('drawing', 40, 3, 61, 'w', 1, 1, 0);
  p.picture('poster_revue', 35, 4, 70, 'n', 2, 3);
  for (let i = 0; i < 2; i++) p.picture('drawing', 38 + i, 2, 70, 'n', 1, 1, rng.int(0, 5));
  p.set(39, 0, 70, 'trash_n');
  p.set(33, 0, 70, 'locker_0_n');
  p.set(33, 1, 70, 'locker_1_n');
}

function staff(p, _rng) {
  // The Staff Room (x 1-16, z 52-70): the time-clock lobby along its north wall (every menu is a button there),
  // and behind it a real break room: lockers either side of the back door, the break table and chairs, a sofa,
  // two vending machines (still lit), a kitchenette counter, the notice board.
  for (const b of LOBBY_BUTTONS) {
    p.set(b.x, 1, b.z, 'button_s');
    p.sign(b.x, 2, b.z, 's', b.lines);
  }
  p.set(8, 3, 52, 'timeclock_s');
  // lockers on the west wall either side of the staff exit, the EXIT sign over it
  for (const z of [54, 55, 56, 57, 63, 64, 65, 66]) {
    p.set(1, 0, z, 'locker_0_e');
    p.set(1, 1, z, 'locker_1_e');
  }
  p.set(1, 3, 60, 'exit_true_e');
  p.meta.exits.push({ x: 1, y: 3, z: 60, dir: 'e' });
  p.fill(3, 0, 64, 3, 0, 65, 'dark_oak_slab');
  // a low wall with a counter top between the lobby and the break room, dead plants at its ends; a worn rug
  p.fill(5, 0, 59, 12, 0, 59, 'cinder');
  p.fill(5, 1, 59, 12, 1, 59, 'dark_oak_slab');
  for (const x of [4, 13]) p.set(x, 0, 59, 'planter');
  p.set(7, 1, 59, 'clutter_n');
  for (let x = 5; x <= 11; x++) for (let z = 62; z <= 68; z++) p.set(x, 0, z, (x + z) % 7 === 0 ? 'brown_carpet' : 'red_carpet');
  // the break table and four chairs
  p.set(8, 0, 64, 'breaktable_n');
  p.set(7, 0, 64, 'chair_e');
  p.set(9, 0, 64, 'chair_w');
  p.set(8, 0, 63, 'chair_s');
  p.set(8, 0, 65, 'chair_n');
  // the sofa against the south wall, a dead set on a road case in front of it
  for (const [x, k] of [[6, 'left'], [7, 'mid'], [8, 'mid'], [9, 'right']]) p.set(x, 0, 70, `sofa_${k}_n`);
  p.set(8, 0, 67, 'road_case');
  p.set(8, 1, 67, 'crt_false_s');
  // the east wall: vending machines, the kitchenette
  for (const z of [57, 58]) {
    p.set(16, 0, z, 'vending_0_w');
    p.set(16, 1, z, 'vending_1_w');
  }
  p.fill(16, 0, 64, 16, 0, 68, 'wainscot');
  p.set(16, 0, 66, 'prep_sink_w');
  p.set(16, 1, 64, 'kitchenette_coffee_w');
  p.set(16, 1, 65, 'plates');
  p.set(16, 1, 67, 'kitchenette_microwave_w');
  p.set(16, 1, 68, 'pizza_2_e');
  p.set(15, 0, 70, 'trash_n');
  p.set(16, 0, 70, 'cooler_0_n');
  p.set(16, 1, 70, 'cooler_1_n');
  // the walls: the notice board, the rules, a missing poster
  p.picture('notice_board', 13, 3, 70, 'n', 2, 1);
  p.picture('poster_rules', 3, 4, 70, 'n', 2, 2);
  p.picture('poster_missing', 16, 3, 55, 'w', 1, 2);
  p.set(1, 0, 70, 'mop_e');
  p.set(2, 0, 70, 'wetsign_n');
  doorFrame(p, 'gallery_door', 'x', 'dark_oak');
}

function gallery(p, _rng) {
  // The Gallery (the extras' exhibition): a black room over oak wainscot, six pedestals each under its own
  // spotlight behind a velvet rope, a red carpet down the middle, the show's posters framed on the walls.
  for (const [i, [x, z]] of [[3, 42], [8, 42], [13, 42], [3, 48], [8, 48], [13, 48]].entries()) {
    p.set(x, 0, z, 'quartz_pillar');
    p.set(x, 6, z + (z < 45 ? 1 : -1), z < 45 ? 'spot_true_n' : 'spot_true_s');
    p.meta.spots.push({ x, y: 6, z: z + (z < 45 ? 1 : -1), dir: z < 45 ? 'n' : 's', group: 'gallery', slot: i });
    p.picture('lot_tag', x, 0, z + (z < 45 ? 1 : -1), z < 45 ? 's' : 'n', 1, 1, [0, 1, 2, 4, 3, 5][i]);
  }
  for (let x = 1; x <= 15; x++) {
    for (const z of [44, 46]) if (x >= 2 && x <= 14) p.set(x, 0, z, x % 2 ? 'rope_n' : 'stanchion');
    p.set(x, 0, 45, 'red_carpet');
  }
  p.picture('poster_revue', 5, 5, 40, 's', 2, 3);
  p.picture('poster_midway', 10, 5, 40, 's', 2, 3);
  p.picture('poster_cabaret', 6, 5, 49, 'n', 2, 3);
  p.picture('poster_party', 11, 4, 49, 'n', 2, 2);
  p.picture('poster_auction', 16, 4, 44, 'w', 2, 3);
}

function parts(p, _rng) {
  // Parts & Service (x 49-78, z 64-70, behind the Game Room's STAFF ONLY door): the workshop that kept the
  // band running, and six crates waiting for the auction.
  const top = ROOM_BY_ID.PARTS.h - 1;
  // shelves of spares along the north wall, one every other block, every one with a head or a skull standing
  // square on it (the door from the Game Room is at x 60-61)
  const north = [[49, 'head_rustgrin_s'], [51, 'head_mirehop_s'], [53, 'head_noxbriar_s'], [55, 'head_cat_s'], [57, 'head_rat_s'],
    [63, 'endo_skull_s'], [65, 'head_rustgrin_s'], [67, 'head_mirehop_s'], [69, 'head_noxbriar_s'], [71, 'head_cat_s'], [73, 'head_rat_s'],
    [75, 'endo_skull_s'], [77, 'head_rustgrin_s']];
  for (const [x, head] of north) {
    p.set(x, 0, 64, 'shelf_s');
    p.set(x, 1, 64, head);
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
  // two endoskeletons on their stands, the same distance either side of the middle and both facing the door; a
  // head on the floor between them; an empty costume slumped against the east wall. (The west half of the
  // aisle, x 49..56, is the stairwell down to the cellar: data/cellar_plan.js cuts it, rails it and puts the
  // other costume at the foot of the stairs.)
  p.set(57, 0, 66, 'endo_stand_n');
  p.set(70, 0, 66, 'endo_stand_n');
  p.set(64, 0, 66, 'head_rustgrin_n');
  p.set(78, 0, 66, 'suit_mirehop_w');
  // the crates' lids against the west wall, a tarp over something in the east corner
  p.fill(49, 0, 69, 49, 2, 70, 'spruce');
  p.set(50, 0, 70, 'barrel_n');
  p.set(50, 1, 70, 'barrel_n');
  p.fill(76, 0, 68, 78, 0, 70, 'black_wool');
  p.fill(77, 1, 69, 77, 1, 69, 'black_carpet');
  // light: two red emergency lights, one flickering troffer, the work lamps (off at night)
  fixture(p, 49, 3, 66, 'emerg_true_e', 'PARTS');
  fixture(p, 78, 3, 66, 'emerg_true_w', 'PARTS');
  fixture(p, 64, top + 1, 66, 'lamp_broken', 'PARTS');
  for (const x of [57, 70]) { // a work lamp over each stand
    p.set(x, top, 66, 'hanging_off');
    p.meta.hanging.push({ x, y: top, z: 66, group: 'parts' });
  }
  for (const x of [61, 66]) p.fill(x, top - 1, 66, x, top, 66, 'chain_y');
  // faint footprints from the crates to the door; drag marks; dust
  for (const [x, z] of [[65, 66], [63, 66], [61, 65]]) p.set(x, 0, z, 'decal_prints_faint_n');
  p.set(59, 0, 66, 'decal_drag_e');
  p.set(67, 0, 65, 'decal_debris_n');
  for (const [x, z] of [[49, 70], [78, 64]]) p.set(x, top, z, 'cobweb');
  p.set(52, top, 66, 'wires_bundle_n');
  p.picture('sign_staff', 59, 2, 61, 'n', 1, 1, 0); // STAFF ONLY, on the Game Room side of the door
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
  p.batch((q) => {
    for (const decay of [decayDining, decayMarquee, decayMidway, decayBackstage, decayKitchen, decayRestrooms, decayFoyer, decayHalls, decaySupply, decayPrize,
      decayParty, decayGameRoom, decayOffice, decayStaff]) decay(q);
  });
}

function decayDining(p) {
  // the last birthday party nobody cleaned up: one candle still burning under a flickering lamp
  fixture(p, 50, 1, 24, 'bday_true_e', 'DINING');
  for (const z of [23, 25]) p.set(50, 1, z, 'plates');
  p.set(50, 1, 22, 'hat_2');
  p.set(50, 1, 26, 'hat_0');
  p.set(50, 1, 21, 'pizza_1_e');
  p.set(49, 0, 22, 'fallen_e');
  p.set(51, 0, 24, 'fallen_w');
  p.set(49, 0, 25, 'hat_1');
  p.set(52, 0, 23, 'hat_3');
  p.set(52, 0, 21, 'balloons_2');
  p.set(52, 0, 25, 'decal_confetti_n');
  p.set(48, 0, 23, 'decal_confetti_e');
  fixture(p, 49, 9, 23, 'lamp_broken', 'DINING');
  // more chairs knocked over, party hats on the floor
  for (const [x, z, k] of [[32, 20, 'fallen_w'], [43, 30, 'fallen_e'], [57, 16, 'fallen_w'], [20, 28, 'fallen_e'], [26, 14, 'fallen_w']]) p.set(x, 0, z, k);
  for (const [x, z, c] of [[35, 17, 1], [47, 29, 0], [30, 23, 3], [54, 15, 2], [41, 31, 0]]) p.set(x, 0, z, `hat_${c}`);
  // fallen ceiling tiles: the void above, wires hanging out of it, debris (and a puddle) below
  for (const [x, z, wire] of [[42, 29, 'wires_bundle_n'], [24, 16, 'wires_box_e'], [54, 30, null], [30, 12, 'wires_bundle_w']]) {
    p.set(x, 9, z, 'ceiling_missing');
    if (wire) p.set(x, 8, z, wire);
    p.set(x, 0, z, 'decal_debris_n');
  }
  p.set(54, 0, 31, 'decal_puddle_n');
  // ADMIT ONE: ticket stubs trailing from the tables to the Ringmaster's stage
  /** @type {[number, number, string][]} */
  const stubs = [[34, 35, 'tickets'], [30, 34, 'tickets_b'], [25, 35, 'tickets'], [22, 34, 'tickets_b'], [19, 35, 'tickets'], [17, 33, 'tickets_b'], [15, 34, 'tickets']];
  for (const [x, z, k] of stubs) p.set(x, 0, z, `decal_${k}_${['n', 'e', 's', 'w'][(x + z) % 4]}`);
  // one chair set out alone, facing his stage
  p.set(16, 0, 29, 'chair_w');
  // the performers have been tagged for the auction: LOT 1-3 pinned to the stage curtain behind them
  p.picture('lot_tag', 38, 2, 2, 's', 1, 1, 0); // Rustgrin
  p.picture('lot_tag', 32, 2, 2, 's', 1, 1, 1); // Mirehop
  p.picture('lot_tag', 44, 2, 2, 's', 1, 1, 2); // Noxbriar
  p.picture('poster_torn', 62, 5, 27, 'w', 2, 2);
  for (const [x, z] of [[18, 11], [59, 10], [18, 34]]) p.set(x, 7, z, 'cobweb');
  for (const [x, z] of [[23, 10], [54, 10]]) p.set(x, 6, z, 'cobweb');
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
  p.picture('lot_tag', 5, 2, 26, 'n', 1, 1, 3); // the Cat
  p.picture('lot_tag', 7, 2, 26, 'n', 1, 1, 4); // the Purple Rat
  for (const [x, z] of [[1, 15], [1, 26]]) p.set(x, 6, z, 'cobweb');
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
  fixture(p, 12, 3, 8, 'emerg_true_w', 'BACKSTAGE');
  p.set(4, 5, 4, 'wires_bundle_n');
  p.set(3, 5, 10, 'wires_box_s');
  for (const [x, z] of [[1, 1], [12, 12]]) p.set(x, 5, z, 'cobweb');
  // something heavy was dragged in from the stage door
  for (const [x, z] of [[12, 11], [10, 10]]) p.set(x, 0, z, 'decal_drag_w');
}

function decayKitchen(p) {
  fixture(p, 69, 6, 10, 'lamp_broken', 'KITCHEN');
  fixture(p, 65, 3, 2, 'emerg_true_e', 'KITCHEN');
  p.set(74, 6, 4, 'ceiling_missing');
  p.set(74, 5, 4, 'wires_bundle_e');
  p.set(74, 0, 4, 'decal_debris_n');
  p.set(77, 0, 8, 'pizza_3_e');
  p.set(77, 0, 7, 'pizza_2_n');
  p.set(70, 0, 11, 'decal_puddle_n');
  p.set(75, 0, 4, 'decal_puddle_e');
  for (const [x, z] of [[66, 12], [79, 1]]) p.set(x, 5, z, 'cobweb');
}

function decayRestrooms(p) {
  fixture(p, 66, 6, 20, 'lamp_broken', 'RESTROOMS');
  p.picture('sign_out_of_order', 68, 3, 24, 'w', 2, 1);
  p.set(66, 0, 19, 'decal_puddle_n');
  p.set(67, 0, 24, 'decal_puddle_e');
  p.set(68, 5, 15, 'cobweb');
}

function decayFoyer(p) {
  p.picture('poster_auction', 98, 4, 30, 'w', 2, 3);
  p.set(97, 0, 34, 'decal_puddle_n');
  for (const [x, z] of [[94, 33], [88, 35], [82, 34], [76, 33], [70, 34]]) p.set(x, 0, z, 'decal_prints_faint_e');
  p.set(85, 0, 35, 'decal_tickets_n');
  p.set(73, 0, 38, 'decal_confetti_e');
  for (const [x, z] of [[65, 39], [98, 29], [65, 29], [98, 39]]) p.set(x, 5, z, 'cobweb');
  p.set(81, 7, 33, 'ceiling_missing');
  p.set(81, 6, 33, 'wires_bundle_e');
  p.set(81, 0, 33, 'decal_debris_n');
}

function decayHalls(p) {
  // West Hall (CAM 2A): the wet floor sign's puddle, and wet footprints walking south towards the office
  p.set(27, 0, 41, 'decal_puddle_n');
  for (const [z, k] of [[43, 'prints'], [46, 'prints'], [49, 'prints_faint'], [52, 'prints_faint'], [55, 'prints_faint']]) p.set(27, 0, z, `decal_${k}_s`);
  writing(p, 'show', 26, 4, 52, 'e');
  p.picture('poster_torn', 26, 4, 43, 'e', 2, 2); // over the old rules poster, right in CAM 2A's face
  p.set(26, 6, 50, 'ceiling_missing');
  p.set(26, 5, 50, 'wires_bundle_e');
  p.set(26, 0, 50, 'decal_debris_n');
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
  p.set(23, 5, 50, 'cobweb');
}

function decayPrize(p) {
  for (const [x, z] of [[82, 1], [98, 1], [82, 25], [98, 25]]) p.set(x, 5, z, 'cobweb');
  p.set(88, 0, 16, 'decal_tickets_b_n');
  p.set(85, 0, 21, 'decal_tickets_e');
  p.set(93, 0, 19, 'decal_tickets_n');
  p.set(90, 0, 14, 'plush_s'); // dropped by a child on the way out, years ago
  p.picture('poster_auction', 98, 4, 7, 'w', 2, 3);
}

function decayParty(p) {
  for (const [x, z, k] of [[35, 47, 'fallen_e'], [37, 51, 'fallen_w']]) p.set(x, 0, z, k);
  /** @type {[number, number, string][]} */
  const litter = [[33, 44, 'confetti'], [39, 50, 'confetti'], [34, 53, 'tickets']];
  for (const [x, z, k] of litter) p.set(x, 0, z, `decal_${k}_n`);
  p.set(38, 0, 42, 'hat_1');
  for (const [x, z] of [[31, 40], [41, 56]]) p.set(x, 4, z, 'cobweb');
  p.set(33, 5, 49, 'ceiling_missing');
  p.set(33, 4, 49, 'wires_bundle_e');
}

function decayGameRoom(p) {
  p.picture('sign_out_of_order', 64, 1, 57, 's', 2, 1); // taped across two dead cabinets' screens
  p.picture('poster_auction', 49, 5, 52, 'e', 2, 3);
  p.set(64, 0, 47, 'decal_puddle_n');
  p.set(64, 7, 47, 'ceiling_missing');
}

function decayOffice(p) {
  // Walter's things, where he left them at 3 AM: the notice for the auction by the right door
  p.picture('poster_auction', 40, 4, 69, 'w', 2, 3);
  p.set(33, 1, 61, 'walter_desk_s');
  fixture(p, 35, 0, 69, 'walter_flashlight_w', 'OFFICE');
  writing(p, 'tally', 32, 3, 68, 'e');
  p.set(39, 4, 70, 'cobweb');
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
  for (const r of ROOMS) {
    if (OWN_LAMPS.includes(r.id)) continue; // these rooms hang their own lamps (see their decor)
    const [x1, z1, x2, z2] = r.box;
    const step = x2 - x1 > 20 ? 6 : 5;
    const nx = Math.max(1, Math.round((x2 - x1 + 1) / step));
    const nz = Math.max(1, Math.round((z2 - z1 + 1) / step));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = Math.round(x1 + ((i + 0.5) * (x2 - x1 + 1)) / nx - 0.5);
        const z = Math.round(z1 + ((j + 0.5) * (z2 - z1 + 1)) / nz - 0.5);
        const k = `${x},${r.h},${z}`;
        if (used.has(k)) continue;
        used.add(k);
        p.set(x, r.h, z, 'lamp_off');
        p.meta.lamps.push({ x, y: r.h, z, room: r.id, group: LAMP_GROUP[r.id] ?? r.id.toLowerCase() });
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
  p.sign(26, 2, 44, 'e', ['SUPPLY', 'CLOSET']);
  p.sign(65, 3, 12, 'e', ['KITCHEN', 'Staff only']);
  p.sign(32, 2, 69, 'e', ['NIGHT GUARD', 'Doors: red', 'Lights: white', 'Power is finite']);
  p.sign(15, 4, 37, 'e', ['THE GRAND', 'MARQUEE', 'private stage', 'do not disturb']);
  p.sign(33, 1, 60, 's', ['', 'LEFT VENT', '^']);
  p.sign(39, 1, 60, 's', ['', 'RIGHT VENT', '^']);
  p.sign(93, 2, 39, 'w', ['TICKETS', '', 'Hand stamps', 'at the podium']);
  p.sign(FRONT + 1, 2, 39, 'e', ['FINAL WEEKEND', 'Everything', 'must go!', 'Auction Sat.']);
  p.sign(FRONT + 1, 2, 31, 'e', ['RUSTGRIN\'S', 'Pizza Revue', 'OPEN 11 - 9', 'Shows hourly!']);
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
  cellar(p); // the Golden Dog's cellar, carved out under all of the above (data/cellar_plan.js)
  return p.finish();
}

export { STYLES, ROOM_BY_ID, DINING_TABLES };
