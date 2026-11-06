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

// ---------------------------------------------------------------- room styles
// bands: list of [fromY, toY, key | key[] (random pick)] for the walls (relative to the floor).
const STYLES = {
  dining: {
    floor: ['carpet_confetti'], ceiling: ['ceiling_dark'],
    bands: [[0, 0, 'trim'], [1, 1, 'wallpaper'], [2, 2, 'wall_checker'], [3, 7, 'wallpaper'], [8, 9, 'trim']],
  },
  hall: { floor: ['tile', 'tile', 'tile_worn'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, ['plaster', 'plaster', 'plaster', 'plaster_stained']]] },
  office: { floor: ['tile_office'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, ['plaster', 'plaster_stained']]] },
  backstage: { floor: ['polished_deepslate', 'polished_deepslate', 'deepslate_tiles'], ceiling: ['blackstone'], bands: [[0, 9, 'cinder']] },
  midway: { floor: ['carpet'], ceiling: ['tent'], bands: [[0, 0, 'blackstone'], [1, 9, 'tent']] },
  cabaret: { floor: ['carpet'], ceiling: ['black_c'], bands: [[0, 9, 'curtain_purple']] },
  kitchen: { floor: ['tile_kitchen'], ceiling: ['ceiling_stained', 'ceiling'], bands: [[0, 2, 'white_t'], [3, 9, 'cinder']] },
  restroom: { floor: ['tile_worn'], ceiling: ['ceiling_stained', 'ceiling'], bands: [[0, 2, 'smooth_quartz'], [3, 9, ['plaster', 'plaster_stained']]] },
  foyer: { floor: ['carpet_purple'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 0, 'trim'], [1, 9, 'wall_yellow']] },
  gallery: { floor: ['dark_oak'], ceiling: ['black_c'], bands: [[0, 0, 'blackstone'], [1, 9, 'black_c']] },
  staff: { floor: ['tile_office'], ceiling: ['ceiling', 'ceiling_stained'], bands: [[0, 1, 'cinder'], [2, 2, 'trim'], [3, 9, 'plaster']] },
  supply: { floor: ['smooth_stone'], ceiling: ['ceiling_stained'], bands: [[0, 9, 'cinder']] },
  prize: { floor: ['carpet_confetti'], ceiling: ['ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 3, 'wall_stripe'], [4, 9, 'wallpaper_party']] },
  party: { floor: ['carpet_confetti'], ceiling: ['ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 9, 'wallpaper_party']] },
  gameroom: { floor: ['carpet'], ceiling: ['black_c'], bands: [[0, 0, 'black_c'], [1, 1, 'wall_checker'], [2, 2, 'wall_stripe'], [3, 9, 'wallpaper_party']] },
  parts: { floor: ['smooth_stone', 'smooth_stone', 'polished_andesite'], ceiling: ['blackstone'], bands: [[0, 9, ['cinder', 'cinder', 'cinder', 'cracked_bricks']]] },
  funzone: { floor: ['carpet_confetti'], ceiling: ['ceiling', 'ceiling', 'ceiling', 'ceiling_stained'], bands: [[0, 1, 'wall_checker'], [2, 2, 'trim'], [3, 3, 'wall_stripe'], [4, 9, 'wallpaper_party']] },
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
  // roof clutter: AC units and vents (never over the dining hall's sign side)
  for (const [x, z] of [[8, 20], [52, 50], [72, 34], [30, 62], [62, 66], [88, 10], [90, 58]]) {
    p.fill(x, B.roofY + 1, z, x + 1, B.roofY + 1, z + 1, 'iron_block');
    p.set(x, B.roofY + 2, z, 'iron_trapdoor_floor');
  }
  // dumpster behind the kitchen
  p.fill(70, 0, -4, 73, 1, -3, 'gray_c');
  p.fill(70, 2, -4, 73, 2, -3, 'iron_trapdoor_floor');
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
  band(-1, 72, 0, 0, 'blackstone_bricks');
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
  }
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
  p.set(74, 0, -4, 'pizza_3_e');
  p.set(75, 0, -3, 'pizza_1_n');
  p.set(68, 0, -4, 'trash_s');
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
  prize(p, rng);
  halls(p, rng);
  supply(p, rng);
  party(p, rng);
  office(p, rng);
  staff(p, rng);
  gallery(p, rng);
  gameroom(p, rng);
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
  // The showroom (refs: a family pizza showroom and its curved stage, a haunted pizzeria's long tables, a diner's
  // booths and neon): a curved stage under a cream soffit with red stars, red side drapes, a starry backdrop,
  // footlights in the stage lip and PAR cans; long party tables on a checker aisle, cafe tables with star-back
  // chairs, booths along the walls, a truss of lights, the round drum with the mirror ball, posters over a checker band.
  const [sx1, sz1, sx2] = STAGE.box;
  const top = ROOM_BY_ID.DINING.h - 1; // 8
  const S = STAGE.soffit;
  // ---- the floor: confetti carpet (style), a checker dance floor in front of the stage and a checker aisle down the middle
  p.fill(15, -1, 12, 62, -1, 15, 'tile');
  p.fill(36, -1, 12, 41, -1, 37, 'tile');
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
  // the backdrop: a starry midnight curtain, stars hung on it; red drapes either side, floor to ceiling
  p.fill(sx1, 1, sz1, sx2, top, sz1, 'curtain_star');
  for (const [x, y] of [[27, 6], [31, 7], [35, 5], [42, 5], [46, 7], [50, 6], [38, 7], [33, 3], [44, 3]]) p.set(x, y, sz1 + 1, 'star_s');
  for (const x of STAGE.drapes) p.fill(x, 0, sz1, x, top, STAGE.front[x === 22 ? 23 : 54], 'curtain_red');
  for (const x of [sx1, sx2]) p.fill(x, 1, sz1, x, top, sz1 + 2, 'curtain_red');
  // the soffit: cream plaster following the lip, a red star every third block along its edge
  for (let x = STAGE.drapes[0]; x <= STAGE.drapes[1]; x++) {
    const f = STAGE.front[Math.max(sx1, Math.min(sx2, x))];
    p.set(x, S.y2, f, 'soffit_cream');
    p.set(x, S.y1, f, x % 3 === 1 ? 'soffit_star' : 'soffit_cream');
    p.fill(x, S.y2, sz1 + 2, x, S.y2, f - 1, 'soffit_cream'); // its top closes over the stage
  }
  p.picture('sign_stage', 34, top, STAGE.front[38] + 1, 's', 10, 3); // RUSTGRIN'S PIZZA REVUE in bulbs, on the soffit
  // a row of coloured PAR cans under the soffit's back edge, aimed at the band
  for (const [i, x] of [25, 28, 31, 34, 43, 47, 49, 52].entries()) parCan(p, x, S.y1 - 1, STAGE.front[x] - 1, i, 'n');
  // the band's equipment: speaker stacks at the corners, two amps, a mic stand
  for (const x of [sx1 + 2, sx2 - 2]) for (const y of [1, 2]) p.set(x, y, 7, 'speaker_s');
  p.set(29, 1, 3, 'amp_s');
  p.set(47, 1, 3, 'amp_s');
  p.set(37, 1, 8, 'mic_stand');
  // ---- the hall: long party tables on the checker aisle's sides, red-and-white hats, balloons tied to the tables
  for (const tx of DINING_TABLES.xs) tableRun(p, rng, 'z', tx, DINING_TABLES.z1, DINING_TABLES.z2);
  for (const [x, z] of [[27, 19], [33, 26], [44, 18], [50, 25]]) p.set(x, 1, z, `balloons_${(x + z) % 3}`);
  // cafe tables with star-back chairs at the sides, booths along the east and south walls
  for (const z of [18, 23, 28]) {
    cafeSet(p, rng, 21, z);
    cafeSet(p, rng, 56, z);
  }
  booth(p, rng, 'z', 22, [61, 62]);
  booth(p, rng, 'z', 26, [61, 62]);
  for (const x of [18, 22, 48, 52]) booth(p, rng, 'x', x, [36, 37]);
  // pendant lamps on chains over the long tables (lit by day)
  for (const tx of DINING_TABLES.xs) {
    for (const z of [17, 23, 29]) {
      p.fill(tx, 7, z, tx, top, z, 'chain_y');
      p.set(tx, 6, z, 'hanging_off');
      p.meta.hanging.push({ x: tx, y: 6, z, group: 'dining' });
    }
  }
  // the truss across the room in front of the stage, moving lights hung under it
  for (let x = 16; x <= 61; x++) p.set(x, top, 15, 'truss_e');
  for (const [i, x] of [20, 26, 31, 46, 51, 57].entries()) parCan(p, x, top - 1, 15, i + 1, 'n');
  // the round drum in the ceiling over the middle of the room (refs: a ring of coloured spots), the mirror ball in it
  for (let x = Math.floor(DRUM.cx - DRUM.r - 1); x <= Math.ceil(DRUM.cx + DRUM.r + 1); x++) {
    for (let z = Math.floor(DRUM.cz - DRUM.r - 1); z <= Math.ceil(DRUM.cz + DRUM.r + 1); z++) {
      const d = Math.hypot(x + 0.5 - DRUM.cx, z + 0.5 - DRUM.cz);
      if (d < DRUM.r - 1) {
        p.set(x, top + 1, z, 'air');
        p.set(x, top + 2, z, 'ceiling_dark');
      } else if (d < DRUM.r) {
        p.set(x, top, z, 'soffit_cream');
        p.set(x, top - 1, z, 'wall_checker');
      }
    }
  }
  const cx = Math.floor(DRUM.cx), cz = Math.floor(DRUM.cz);
  for (const [i, [x, z, d]] of [[cx, cz - 4, 's'], [cx + 4, cz, 'w'], [cx, cz + 4, 'n'], [cx - 4, cz, 'e']].entries()) parCan(p, x, top - 2, z, i, d);
  p.fill(cx, top - 1, cz, cx, top + 1, cz, 'chain_y');
  p.set(cx, top - 2, cz, 'disco_ball');
  // warm brass sconces along the walls: pools of amber light by day (switched with the hall's lamps), dead at night
  for (const [x, y, z, d] of [[15, 4, 3, 'e'], [15, 4, 8, 'e'], [15, 4, 27, 'e'], [62, 4, 25, 'w'], [62, 4, 29, 'w'],
    [16, 4, 37, 'n'], [25, 5, 37, 'n'], [34, 4, 37, 'n'], [43, 4, 37, 'n'], [47, 4, 37, 'n'], [60, 4, 37, 'n']]) {
    p.set(x, y, z, `sconce_false_${d}`);
    p.meta.hanging.push({ x, y, z, group: 'dining' });
  }
  // paper garlands strung across the hall behind CAM 1A
  for (let x = 16; x <= 61; x++) if (!DINING_TABLES.xs.includes(x)) p.set(x, 7, 34, 'bunting_s');
  // ---- walls: framed posters over the checker band, kids' drawings, the marquees, the neon
  p.picture('poster_rules', 15, 5, 6, 'e', 2, 2);
  p.picture('poster_auction', 15, 5, 15, 'e', 2, 3);
  p.picture('poster_cabaret', 15, 5, 29, 'e', 2, 3);
  p.picture('sign_midway', 15, 5, 23, 'e', 4, 1);
  p.picture('sign_cabaret', 15, 5, 35, 'e', 3, 1);
  p.picture('poster_revue', 62, 5, 23, 'w', 2, 3);
  p.picture('poster_party', 23, 5, 37, 'n', 2, 2);
  p.picture('poster_midway', 62, 5, 37, 'n', 2, 3);
  p.picture('poster_party', 20, 5, 1, 's', 2, 2);
  for (const [x0, n] of [[30, 4], [39, 4], [49, 5], [17, 4]]) for (let i = 0; i < n; i++) p.picture('drawing', x0 + i, 3, 37, 'n', 1, 1, rng.int(0, 5));
  neon(p, 'showtime', 16, 6, 1, 's'); // red neon by the stage
  neon(p, 'party', 37, 4, 37, 'n'); // over the Party Room door
  neon(p, 'arcade', 58, 4, 37, 'n'); // over the passage to the Game Room
  neon(p, 'pizza', 62, 7, 32, 'w'); // over the WELCOME arch
  neon(p, 'restrooms', 62, 6, 18, 'w'); // over the restroom door
  for (let z = 2; z <= 36; z++) {
    p.set(15, top, z, 'bunting_e');
    p.set(62, top, z, 'bunting_w');
  }
  for (const [x, z] of [[17, 9], [60, 12], [16, 34], [20, 2]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  // old arcade cabinets in the north-west corner, gumball machines by the arcade passage
  for (const z of [2, 4, 6]) {
    p.set(15, 0, z, 'arcade_0_e');
    p.set(15, 1, z, 'arcade_1_e');
  }
  p.set(19, 0, 1, 'speaker_s');
  for (const x of [59, 60]) p.set(x, 0, 36, 'gumball');
  // exits over the hall doors and the entrance arch (high up: no glow spills into the halls)
  for (const [x, y, z, dir] of [[27, 5, 37, 'n'], [45, 5, 37, 'n'], [62, 5, 33, 'w']]) {
    p.set(x, y, z, `exit_true_${dir}`);
    p.meta.exits.push({ x, y, z, dir });
  }
  p.set(61, 0, 21, 'wetsign_w');
  p.set(16, 0, 37, 'trash_e');
  p.set(61, 0, 37, 'trash_w');
  // ---- the order counter in the north-east corner: the kitchen's window, the menu board, the register
  p.fill(58, 0, 8, 62, 0, 8, 'stripped_dark_oak_x');
  p.fill(58, 1, 8, 62, 1, 8, 'quartz_slab');
  p.set(60, 1, 8, 'clutter_s');
  p.fill(62, 0, 3, 62, 0, 6, 'stripped_dark_oak_z');
  p.set(62, 1, 4, 'pizza_2_e');
  p.set(62, 1, 5, 'plates');
  p.picture('menu_board', 58, 6, 1, 's', 4, 2);
  neon(p, 'slice', 62, 6, 2, 'w');
  p.set(58, 0, 2, 'barrel_n');
  p.set(59, 0, 2, 'barrel_n');
  // ---- the salad bar against the east wall: wells of greens under a sneeze guard
  p.fill(62, 0, 13, 62, 0, 17, 'smooth_quartz');
  for (const [z, k] of [[13, 'moss_carpet'], [14, 'lime_carpet'], [15, 'red_carpet'], [16, 'yellow_carpet'], [17, 'white_carpet']]) p.set(62, 1, z, k);
  p.fill(62, 2, 13, 62, 2, 17, 'window');
  p.sign(62, 3, 15, 'w', ['', 'SALAD BAR', 'all you can eat']);
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
  // dining side: SORRY! OUT OF ORDER on the closed half of the curtain, a rope across the front, stars on the frame
  p.picture('sign_out_of_order', 15, 3, 31, 'e', 2, 1);
  for (const z of [29, 37]) p.set(15, 0, z, 'mic_stand');
  for (const z of [30, 31, 35, 36]) p.set(15, 0, z, 'chain_z');
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
  // ovens under the extractor hood along the north wall
  for (let x = 65; x <= 79; x++) {
    const k = ['smoker_s', 'blast_s', 'furnace_s', 'smoker_s', 'iron_block'][(x - 65) % 5];
    p.set(x, 0, 1, k);
    p.set(x, 3, 1, 'iron_block');
  }
  p.fill(65, 4, 1, 79, 4, 2, 'iron_trapdoor_ceiling');
  // prep tables with dough and boxes
  for (const [a, b] of [[66, 70], [74, 78]]) {
    p.fill(a, 0, 7, b, 0, 8, 'iron_block');
    for (let x = a; x <= b; x += 2) p.set(x, 1, 7, rng.chance(0.5) ? 'pizza_2_n' : 'plates');
  }
  // the pass counter under the order window to the Dining Hall
  p.fill(65, 0, 3, 65, 0, 6, 'iron_block');
  p.set(65, 1, 3, 'pizza_1_w');
  p.set(65, 1, 6, 'pizza_3_w');
  for (let z = 4; z <= 12; z += 2) p.set(80, 0, z, 'cauldron');
  p.set(65, 0, 13, 'barrel_e');
  p.set(79, 0, 13, 'trash_w');
  p.set(70, 5, 4, 'hanging_off');
  p.set(75, 5, 11, 'hanging_off');
  p.meta.hanging.push({ x: 70, y: 5, z: 4, group: 'kitchen' }, { x: 75, y: 5, z: 11, group: 'kitchen' });
}

function restrooms(p, _rng) {
  // stall partitions and fixtures
  for (const [zA, zB] of [[15, 19], [21, 25]]) {
    for (const z of [zA + 1, zB - 1]) p.set(80, 0, z, 'toilet_w');
    p.fill(78, 0, (zA + zB) >> 1, 80, 2, (zA + zB) >> 1, 'polished_andesite');
    p.set(71, 0, zA === 15 ? 15 : 25, zA === 15 ? 'sink_s' : 'sink_n');
  }
  p.fill(70, 0, 20, 80, ROOM_BY_ID.MENS.h - 1, 20, 'smooth_quartz');
  p.picture('sign_staff', 68, 2, 16, 'w', 1, 1, 1);
  p.picture('sign_staff', 68, 2, 22, 'w', 1, 1, 2);
  p.set(65, 0, 25, 'mop_e');
  p.set(66, 0, 15, 'wetsign_s');
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
  // The Entrance Hall (x 65-98, z 27-41; ref: a family fun centre's lobby): warm yellow walls over plum carpet, a
  // black-and-white checker path from the glass doors to the WELCOME arch framed in marquee bulbs, the curved token
  // counter under a cream soffit with red stars (a slatwall of plush, a popcorn machine, the price board), brass
  // stanchions with red velvet ropes, the height chart; the ticket booth by the doors, arches to the games.
  // ---- the checker path from the doors to the arch
  p.fill(65, -1, 31, 98, -1, 37, 'tile');
  // ---- the WELCOME arch (the foyer side of the wall at x 64): a frame of marquee bulbs round the doorway
  for (const [y, z] of [[0, 30], [1, 30], [2, 30], [3, 30], [0, 36], [1, 36], [2, 36], [3, 36], [3, 31], [3, 35], [4, 31], [4, 32], [4, 33], [4, 34], [4, 35]]) {
    p.set(64, y, z, 'bulb_off');
    p.meta.hanging.push({ x: 64, y, z, group: 'foyer' });
  }
  p.picture('sign_welcome', 65, 6, 37, 'e', 9, 2);
  p.picture('height_chart', 65, 3, 39, 'e', 1, 3);
  // ---- the token counter in the north-west corner: a curved teal counter, the plush slatwall behind, the soffit
  for (const [x, z] of [[67, 29], [68, 29], [69, 29], [70, 29], [71, 28], [72, 27]]) p.set(x, 0, z, 'cyan_t');
  p.set(67, 1, 29, 'popcorn_s');
  p.set(69, 1, 29, 'clutter_s');
  for (let x = 67; x <= 70; x++) for (const y of [1, 2, 3]) p.set(x, y, 27, 'plushwall_s');
  p.fill(66, 6, 27, 72, 6, 29, 'soffit_cream');
  for (const [x, z] of [[66, 29], [67, 29], [68, 29], [69, 29], [70, 29], [71, 28], [72, 27]]) p.set(x, 5, z, x % 2 ? 'soffit_star' : 'soffit_cream');
  for (const x of [68, 71]) {
    p.set(x, 5, 30, 'hanging_off');
    p.set(x, 6, 30, 'chain_y');
    p.meta.hanging.push({ x, y: 5, z: 30, group: 'foyer' });
  }
  p.picture('token_prices', 73, 4, 27, 's', 2, 2);
  // brass stanchions and red velvet ropes along the path (gaps for the counter, the arches and the prize door)
  const ropeLine = (z, x1, x2) => {
    for (let x = x1; x <= x2; x++) p.set(x, 0, z, (x - x1) % 2 ? 'rope_n' : 'stanchion');
  };
  ropeLine(30, 74, 86);
  ropeLine(38, 77, 85);
  ropeLine(38, 93, 97);
  // ---- the ticket booth in the north-east corner, the hand-stamp podium by the doors
  p.fill(94, 0, 27, 94, 3, 29, 'dark_oak');
  p.fill(98, 0, 27, 98, 3, 29, 'dark_oak');
  p.fill(95, 0, 29, 97, 0, 29, 'stripped_dark_oak_x');
  p.fill(95, 1, 29, 97, 1, 29, 'quartz_slab');
  p.fill(95, 2, 29, 97, 2, 29, 'window');
  p.fill(94, 4, 27, 98, 4, 29, 'red_c');
  p.fill(94, 3, 29, 98, 3, 29, 'red_c');
  p.set(96, 0, 27, 'dark_oak_stairs_n');
  p.set(95, 1, 28, 'clutter_s');
  neon(p, 'tickets', 95, 4, 30, 's');
  p.set(96, 0, 31, 'lectern_e');
  // ---- along the north wall: a bench under the photo-spot poster, gumball machines, the photo booth
  p.fill(75, 0, 27, 80, 0, 27, 'dark_oak_stairs_n');
  p.picture('poster_revue', 77, 5, 27, 's', 2, 3);
  for (const x of [75, 80]) p.set(x, 5, 27, 'star_s');
  for (const x of [73, 74]) p.set(x, 0, 28, 'gumball');
  p.fill(82, 0, 27, 83, 2, 27, 'red_c');
  p.fill(82, 0, 28, 82, 2, 28, 'curtain_red');
  p.fill(83, 0, 28, 83, 1, 28, 'red_c');
  p.set(83, 2, 28, 'window');
  p.fill(82, 3, 27, 83, 3, 28, 'yellow_c');
  // ---- along the south wall: kiddie rides, dead plants, the claw machine, the arches' neon
  for (const x of [66, 77, 85, 93]) {
    p.set(x, 0, 41, 'blackstone_bricks');
    p.set(x, 1, 41, 'dead_bush');
  }
  p.set(79, 0, 41, 'kiddie_n');
  p.set(83, 0, 41, 'kiddie_n');
  clawMachine(p, 65, 40, 'e', 'red_c');
  p.picture('poster_midway', 84, 5, 27, 's', 2, 3);
  p.picture('poster_cabaret', 81, 5, 41, 'n', 2, 3);
  p.picture('poster_party', 95, 5, 41, 'n', 2, 2);
  p.picture('poster_rules', 98, 5, 39, 'w', 2, 2);
  for (let i = 0; i < 6; i++) p.picture('drawing', 78 + i, 2, 41, 'n', 1, 1, rng.int(0, 5));
  neon(p, 'arcade', 72, 5, 41, 'n');
  neon(p, 'funzone', 90, 5, 41, 'n');
  neon(p, 'prizes', 89, 4, 27, 's');
  for (let x = 73; x <= 97; x++) if (x % 2) p.set(x, 6, 27, 'bunting_s');
  for (let x = 66; x <= 97; x++) if (x % 2) p.set(x, 6, 41, 'bunting_n');
  for (const [x, z] of [[85, 28], [97, 40], [66, 38]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  p.set(98, 0, 40, 'trash_w');
  p.set(65, 0, 28, 'trash_e');
}

function prize(p, rng) {
  // The Prize Corner (x 82-98, z 1-25): glass prize cases across the room, the plush wall and the big prizes
  // behind them, token and claw machines on the customers' side, windows on the lot.
  for (let x = 84; x <= 96; x++) p.set(x, 0, 11, 'prizecase_s');
  for (const x of [83, 97]) p.set(x, 0, 11, 'dark_oak');
  for (const x of [85, 89, 93]) p.set(x, 1, 11, 'plush_s');
  for (let x = 83; x <= 97; x++) for (const y of [1, 2, 3, 4]) p.set(x, y, 1, 'plushwall_s');
  neon(p, 'prizes', 89, 5, 1, 's');
  for (const x of [84, 96]) neon(p, 'star', x, 5, 1, 's');
  // shelves of big prizes behind the counter
  for (const [a, b] of [[84, 88], [92, 96]]) {
    p.fill(a, 0, 5, b, 0, 5, 'dark_oak');
    p.fill(a, 1, 5, b, 1, 5, 'dark_oak_slab_top');
    for (let x = a; x <= b; x++) p.set(x, 2, 5, rng.pick(['plush_s', 'gift_red', 'gift_blue', 'gift_yellow', 'pizza_3_n']));
  }
  p.set(90, 0, 3, 'kiddie_s');
  // the customers' side: token machines, claw machines, a bench, balloons
  for (const z of [14, 17, 20]) tokenMachine(p, 82, z, 'e');
  neon(p, 'tokens', 82, 4, 18, 'e');
  clawMachine(p, 98, 18, 'w', 'blue_c');
  clawMachine(p, 98, 24, 'w', 'magenta_c');
  p.fill(82, 0, 22, 82, 0, 24, 'dark_oak_stairs_w');
  for (const x of [85, 89, 93]) p.set(x, 0, 15, 'mic_stand');
  for (const x of [86, 87, 88, 90, 91, 92]) p.set(x, 0, 15, 'chain_x');
  p.set(90, 0, 20, 'kiddie_s');
  // the big prizes hang from the ceiling over the counter
  for (const [x, z] of [[85, 8], [88, 9], [91, 8], [94, 9]]) {
    p.set(x, 5, z, 'chain_y');
    p.set(x, 4, z, 'plush_s');
  }
  for (const [x, z] of [[83, 25], [97, 13], [83, 12]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  p.picture('poster_party', 84, 4, 25, 'n', 2, 2);
  p.picture('poster_revue', 96, 5, 25, 'n', 2, 3);
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
  // more LET'S PARTY! posters and a paper garland down each hall, left up after the last birthday
  p.picture('poster_party', 26, 4, 56, 'e', 2, 2);
  p.picture('poster_party', 46, 4, 47, 'w', 2, 2);
  for (let z = 40; z <= 55; z++) {
    p.set(28, 5, z, 'bunting_w');
    p.set(44, 5, z, 'bunting_e');
  }
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

function party(p, rng) {
  // The Party Room between the halls (x 31-41, z 39-56): one long birthday table, presents, balloons and garlands.
  tableRun(p, rng, 'z', 36, 43, 53, { chairs: 1, every: 1 });
  for (const [z, k] of [[44, 'hat_0'], [46, 'plates'], [48, 'bday_false_n'], [50, 'plates'], [52, 'hat_2']]) p.set(36, 1, z, k);
  for (const [x, z, k] of [[32, 55, 'gift_red'], [33, 55, 'gift_blue'], [32, 54, 'gift_yellow'], [40, 55, 'gift_lime'], [39, 55, 'gift_purple'], [40, 54, 'gift_pink']]) p.set(x, 0, z, k);
  for (const [x, z] of [[31, 40], [41, 40], [31, 56], [41, 56], [36, 56]]) p.set(x, 0, z, `balloons_${rng.int(0, 2)}`);
  for (let x = 31; x <= 41; x++) { p.set(x, 4, 39, 'bunting_s'); p.set(x, 4, 56, 'bunting_n'); }
  for (let z = 40; z <= 55; z++) { p.set(31, 4, z, 'bunting_e'); p.set(41, 4, z, 'bunting_w'); }
  neon(p, 'party', 37, 3, 56, 'n');
  p.picture('poster_party', 31, 3, 46, 'e', 2, 2);
  p.picture('poster_revue', 41, 3, 48, 'w', 2, 3);
  for (let i = 0; i < 3; i++) p.picture('drawing', 31, 2, 50 + i, 'e', 1, 1, rng.int(0, 5));
  p.set(41, 0, 39, 'trash_w');
}

/** One sign out of the neon_sign block (see NEON in palette.js). */
function neon(p, which, x, y, z, dir) {
  const [first, w, h] = NEON[which];
  p.picture('neon_sign', x, y, z, dir, w, h, null, first);
}

function gameroom(p, rng) {
  // The Game Room (x 49-79, z 43-61, 7 tall): skee-ball along the north wall, two back-to-back rows of arcade
  // cabinets, more along the walls, token machines, kiddie rides by the arch, and the overhead crawl tube from
  // the Fun Zone. Bright and loud by day; at night only the screens, the neon and the coin slots still glow.
  // skee-ball along the north wall, west of the passage in from the showroom (x 55-58)
  for (let x = 49; x <= 54; x++) {
    p.set(x, 0, 43, 'skee_back_s');
    p.set(x, 0, 44, 'skee_front_s');
  }
  neon(p, 'skeeball', 50, 4, 43, 's');
  neon(p, 'star', 54, 4, 43, 's');
  neon(p, 'arcade', 56, 4, 43, 's'); // the inside face of the passage
  // arcade rows (back to back), alternating cabinet facings so both sides have a screen
  for (const [zA, zB] of [[49, 50], [55, 56]]) {
    for (let x = 53; x <= 65; x++) {
      if (x === 59) continue; // a gap to walk through
      p.set(x, 0, zA, 'arcade_0_n');
      p.set(x, 1, zA, 'arcade_1_n');
      p.set(x, 0, zB, 'arcade_0_s');
      p.set(x, 1, zB, 'arcade_1_s');
    }
  }
  for (let z = 47; z <= 59; z += 2) {
    p.set(49, 0, z, 'arcade_0_e');
    p.set(49, 1, z, 'arcade_1_e');
  }
  for (const z of [54, 56]) {
    p.set(79, 0, z, 'arcade_0_w');
    p.set(79, 1, z, 'arcade_1_w');
  }
  // token machines on the south wall, either side of the STAFF ONLY door
  for (const x of [55, 57, 66, 68]) tokenMachine(p, x, 61, 'n');
  neon(p, 'tokens', 68, 4, 61, 'n');
  neon(p, 'games', 64, 4, 61, 'n');
  for (const x of [52, 70]) neon(p, 'star', x, 4, 61, 'n');
  // kiddie rides and a claw machine by the arch, tables for the parents
  p.set(66, 0, 44, 'kiddie_s');
  p.set(78, 0, 44, 'kiddie_s');
  clawMachine(p, 79, 45, 'w', 'red_c');
  // two air hockey tables: blue rails, a white playfield, red goals
  for (const x1 of [68, 73]) {
    p.fill(x1, 0, 48, x1 + 2, 0, 51, 'blue_c');
    p.fill(x1, 1, 48, x1 + 2, 1, 51, 'white_carpet');
    p.set(x1 + 1, 1, 48, 'red_carpet');
    p.set(x1 + 1, 1, 51, 'red_carpet');
  }
  // a third row of cabinets and the ticket counter in the south-east corner
  for (let x = 68; x <= 76; x++) {
    p.set(x, 0, 55, 'arcade_0_s');
    p.set(x, 1, 55, 'arcade_1_s');
  }
  for (let x = 71; x <= 77; x++) p.set(x, 0, 59, 'prizecase_n');
  p.set(78, 0, 59, 'dark_oak');
  for (const x of [72, 75]) p.set(x, 1, 59, 'plush_s');
  for (let x = 71; x <= 78; x++) for (const y of [1, 2]) p.set(x, y, 61, 'plushwall_n');
  neon(p, 'tickets', 76, 4, 61, 'n');
  // tables for the parents by the arch
  for (const [x, z] of [[64, 45], [70, 45]]) {
    p.set(x, 0, z, 'table_0_n');
    p.set(x - 1, 0, z, 'chair_e');
    p.set(x + 1, 0, z, 'chair_w');
    p.set(x, 1, z, (x + z) % 2 ? 'plates' : 'pizza_1_n');
  }
  // the overhead crawl tube: out of the Fun Zone wall, west along z 50, a bubble window, into a junction box
  for (let x = 62; x <= 79; x++) {
    const c = ['red', 'yellow', 'blue', 'green'][Math.floor((x - 62) / 3) % 4];
    p.set(x, 5, 50, x % 6 === 1 ? `tube_win_${c}_e` : `tube_${c}_e`);
    if (x % 4 === 0) p.set(x, 6, 50, 'chain_y');
  }
  p.fill(59, 4, 49, 61, 5, 51, 'vinyl_yellow');
  p.fill(60, 6, 50, 60, 6, 50, 'chain_y');
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
}

function funzone(p) {
  // The Fun Zone (x 81-98, z 43-70, 9 tall): two padded play towers joined by a crawl tube, another tube out
  // through the wall into the Game Room, a slide down into a big ball pit, kiddie rides, windows on the lot.
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
  neon(p, 'funzone', 91, 6, 70, 'n'); // over the ball pit
  // ---- two play towers: decks at y 3 on padded posts, net railings, ladders
  const tower = (x1, x2, post) => {
    for (const [x, z] of [[x1, 44], [x2, 44], [x1, 48], [x2, 48]]) {
      p.fill(x, 0, z, x, 2, z, post);
      p.fill(x, 4, z, x, 5, z, post);
    }
    p.fill(x1, 3, 44, x2, 3, 48, 'vinyl_blue');
    for (let x = x1 + 1; x < x2; x++) {
      p.picture('play_net', x, 4, 44, 's', 1, 1, x % 2);
      if (x !== (x1 + x2) >> 1) p.picture('play_net', x, 4, 48, 'n', 1, 1, (x + 1) % 2);
    }
    p.fill(x1 + 1, 6, 44, x2 - 1, 6, 48, 'vinyl_red'); // a padded roof over each tower
    for (let x = x1 + 1; x < x2; x++) for (let z = 45; z <= 47; z++) if ((x + z) % 3 === 0) p.set(x, 0, z, 'balls_top'); // balls spilled under it
  };
  tower(81, 85, 'vinyl_red');
  tower(93, 97, 'vinyl_green');
  for (const z of [45, 47]) p.picture('play_net', 81, 4, z, 'e', 1, 1, 0);
  for (const z of [45, 47]) p.picture('play_net', 97, 4, z, 'w', 1, 1, 1);
  // ladders up to both decks (on the south faces, a padded panel behind them)
  for (const x of [83, 95]) {
    p.fill(x, 0, 48, x, 2, 48, 'vinyl_yellow');
    for (const y of [0, 1, 2]) p.set(x, y, 49, 'ladder_s');
  }
  // the crawl tube between the towers (over the arch from the entrance hall)
  for (let x = 86; x <= 92; x++) p.set(x, 4, 46, x === 89 ? 'tube_win_yellow_e' : `tube_${x % 2 ? 'red' : 'blue'}_e`);
  // a riser box on the west tower and the tube out through the wall into the Game Room
  p.fill(81, 4, 49, 82, 6, 51, 'vinyl_yellow');
  p.set(81, 5, 50, 'tube_red_e');
  // the slide off the east tower into the ball pit
  p.fill(92, 3, 48, 92, 3, 50, 'vinyl_blue'); // the walkway from the tower deck to the top of the slide
  p.set(91, 3, 50, 'vinyl_blue');
  for (const z of [49, 50]) p.fill(92, 0, z, 92, 2, z, 'vinyl_green');
  p.set(91, 3, 51, 'slide_chute_s');
  p.set(91, 2, 52, 'slide_chute_s');
  p.set(91, 1, 53, 'slide_chute_s');
  p.set(91, 1, 54, 'slide_lip_s');
  // ---- the crawl tubes overhead: down from both tower tops, across the room over the ball pit
  /** @type {[number, string][]} */
  const risers = [[83, 'vinyl_green'], [96, 'vinyl_red']];
  for (const [x, post] of risers) {
    for (let z = 49; z <= 56; z++) p.set(x, 7, z, z === 52 ? `tube_win_yellow_n` : `tube_${z % 2 ? 'blue' : 'red'}_n`);
    p.fill(x - 1, 6, 57, x + 1, 8, 59, 'vinyl_yellow');
    p.set(x, 7, 58, 'vinyl_blue');
    p.fill(x, 0, 58, x, 5, 58, post);
    for (const z of [50, 54]) p.set(x, 8, z, 'chain_y');
  }
  for (let x = 85; x <= 94; x++) {
    p.set(x, 7, 58, x === 88 || x === 92 ? 'tube_win_green_e' : `tube_${['red', 'yellow', 'blue'][x % 3]}_e`);
    if (x % 3 === 0) p.set(x, 8, 58, 'chain_y');
  }
  // ---- kiddie rides and benches along the sides of the pit
  for (const z of [55, 62, 66]) p.set(82, 0, z, 'kiddie_e');
  for (const z of [61, 65]) p.fill(98, 0, z, 98, 0, z + 2, 'dark_oak_stairs_e');
  neon(p, 'star', 81, 5, 61, 'e');
  neon(p, 'star', 98, 5, 60, 'w');
  for (const [x, z] of [[81, 69], [98, 44], [98, 69]]) p.set(x, 8, z, 'cobweb');
  // ---- the dust of the last week: tickets, a puddle under a leak, a lost party hat
  /** @type {[number, number, string][]} */
  const litter = [[88, 50, 'tickets'], [92, 52, 'tickets_b'], [87, 44, 'confetti'], [97, 53, 'tickets'], [83, 66, 'confetti']];
  for (const [x, z, k] of litter) p.set(x, 0, z, `decal_${k}_${['n', 'e', 's', 'w'][(x + z) % 4]}`);
  p.set(98, 0, 66, 'decal_puddle_n');
  p.set(98, 9, 66, 'ceiling_missing');
  p.set(98, 8, 66, 'wires_bundle_n');
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
  // Parts & Service (x 49-78, z 64-70, behind the Game Room's STAFF ONLY door): the workshop that kept the
  // band running, and six crates waiting for the auction.
  const top = ROOM_BY_ID.PARTS.h - 1;
  // shelves of spares along the north wall (the door from the Game Room is at x 60-61)
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
  p.set(78, 0, 65, 'suit_mirehop_w');
  // the crates' lids against the west wall, a tarp over something in the east corner
  p.fill(49, 0, 69, 49, 2, 70, 'spruce');
  p.set(50, 0, 70, 'barrel_n');
  p.set(50, 1, 70, 'barrel_n');
  p.fill(76, 0, 68, 78, 0, 70, 'black_wool');
  p.fill(77, 1, 69, 77, 1, 69, 'black_carpet');
  // light: two red emergency lights, one flickering troffer, the work lamps (off at night)
  fixture(p, 49, 3, 65, 'emerg_true_e', 'PARTS');
  fixture(p, 78, 3, 67, 'emerg_true_w', 'PARTS');
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
  decayParty(p);
  decayGameRoom(p);
  decayOffice(p);
  decayStaff(p);
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
  fixture(p, 49, 10, 23, 'lamp_broken', 'DINING');
  // more chairs knocked over, party hats on the floor
  for (const [x, z, k] of [[32, 20, 'fallen_w'], [43, 30, 'fallen_e'], [57, 16, 'fallen_w'], [20, 28, 'fallen_e'], [26, 14, 'fallen_w']]) p.set(x, 0, z, k);
  for (const [x, z, c] of [[35, 17, 1], [47, 29, 0], [30, 23, 3], [54, 15, 2], [41, 31, 0]]) p.set(x, 0, z, `hat_${c}`);
  // fallen ceiling tiles: the void above, wires hanging out of it, debris (and a puddle) below
  for (const [x, z, wire] of [[42, 29, 'wires_bundle_n'], [24, 16, 'wires_box_e'], [54, 30, null], [30, 12, 'wires_bundle_w']]) {
    p.set(x, 10, z, 'ceiling_missing');
    if (wire) p.set(x, 9, z, wire);
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
  for (const [x, z] of [[15, 1], [62, 1], [15, 37], [62, 37], [20, 1]]) p.set(x, 9, z, 'cobweb');
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
  fixture(p, 69, 6, 10, 'lamp_broken', 'KITCHEN');
  fixture(p, 65, 3, 2, 'emerg_true_e', 'KITCHEN');
  p.set(76, 6, 5, 'ceiling_missing');
  p.set(76, 5, 5, 'wires_bundle_e');
  p.set(76, 0, 5, 'decal_debris_n');
  p.set(74, 1, 8, 'pizza_3_e');
  p.set(78, 1, 7, 'pizza_2_n');
  p.set(76, 0, 12, 'decal_puddle_n');
  p.set(68, 0, 12, 'decal_puddle_e');
  for (const [x, z] of [[66, 13], [80, 1]]) p.set(x, 5, z, 'cobweb');
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
  for (const [x, z] of [[65, 41], [98, 27], [65, 27], [98, 41]]) p.set(x, 6, z, 'cobweb');
  p.set(81, 7, 33, 'ceiling_missing');
  p.set(81, 6, 33, 'wires_bundle_e');
  p.set(81, 0, 33, 'decal_debris_n');
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
  for (const [x, z] of [[82, 1], [98, 1], [82, 25], [98, 25]]) p.set(x, 5, z, 'cobweb');
  p.set(88, 0, 16, 'decal_tickets_b_n');
  p.set(85, 0, 21, 'decal_tickets_e');
  p.set(93, 0, 19, 'decal_tickets_n');
  p.set(90, 0, 14, 'plush_s'); // dropped by a child on the way out, years ago
  p.picture('poster_auction', 98, 4, 8, 'w', 2, 3);
}

function decayParty(p) {
  for (const [x, z, k] of [[35, 47, 'fallen_e'], [37, 51, 'fallen_w']]) p.set(x, 0, z, k);
  /** @type {[number, number, string][]} */
  const litter = [[33, 44, 'confetti'], [39, 50, 'confetti'], [34, 53, 'tickets']];
  for (const [x, z, k] of litter) p.set(x, 0, z, `decal_${k}_n`);
  p.set(38, 0, 42, 'hat_1');
  for (const [x, z] of [[31, 39], [41, 56]]) p.set(x, 4, z, 'cobweb');
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
  const groupOf = { DINING: 'dining', WEST_HALL: 'hall_w', W_CORNER: 'hall_w', EAST_HALL: 'hall_e', E_CORNER: 'hall_e', OFFICE: 'office' };
  for (const r of ROOMS) {
    if (['MIDWAY', 'CABARET', 'BACKSTAGE', 'GALLERY', 'PARTS', 'OFFICE', 'W_CORNER', 'E_CORNER'].includes(r.id)) continue;
    const [x1, z1, x2, z2] = r.box;
    const step = r.id === 'DINING' ? 7 : x2 - x1 > 20 ? 6 : 5;
    const nx = Math.max(1, Math.round((x2 - x1 + 1) / step));
    const nz = Math.max(1, Math.round((z2 - z1 + 1) / step));
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = Math.round(x1 + ((i + 0.5) * (x2 - x1 + 1)) / nx - 0.5);
        const z = Math.round(z1 + ((j + 0.5) * (z2 - z1 + 1)) / nz - 0.5);
        const k = `${x},${r.h},${z}`;
        if (used.has(k)) continue;
        if (r.id === 'DINING' && z <= STAGE.box[3] + 1) continue; // stage area: PAR cans instead
        if (r.id === 'DINING' && Math.hypot(x + 0.5 - DRUM.cx, z + 0.5 - DRUM.cz) < DRUM.r + 1) continue; // the drum's recess
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
  p.sign(65, 3, 12, 'e', ['KITCHEN', 'Staff only']);
  p.sign(32, 2, 69, 'e', ['NIGHT GUARD', 'Doors: red', 'Lights: white', 'Power is finite']);
  p.sign(15, 4, 37, 'e', ['THE GRAND', 'MARQUEE', 'private stage', 'do not disturb']);
  p.sign(33, 1, 60, 's', ['', 'LEFT VENT', '^']);
  p.sign(39, 1, 60, 's', ['', 'RIGHT VENT', '^']);
  p.sign(93, 2, 28, 'w', ['TICKETS', '', 'Hand stamps', 'at the podium']);
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
  return p.finish();
}

export { STYLES, ROOM_BY_ID, DINING_TABLES };
