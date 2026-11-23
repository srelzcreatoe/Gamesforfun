// THE CELLAR: what lies under the pizzeria (data/cellar.js is the contract, docs/GOLDEN_DOG.md the design).
//
// cellar(p) is called once at the end of generatePlan() (data/build_plan.js) and appends its ops to the
// plan's phases, so they run after the pizzeria's own: the lot is already filled solid down to y = -9, and the
// cellar is carved out of that fill.
//
// Before Rustgrin's Pizza Revue opened in 1984 this lot held THE GOLDEN DOG SUPPER CLUB (1958 to 1971). The Revue
// was built on the club's foundations and kept its plan: the Dining Hall stands on the club's showroom, the two
// halls on its service passages, the security office on the room the club's night man sat in.
//
//   GOLD ROOM      the showroom (x 26..46, z 16..38). A little proscenium stage across its north end and a
//                  runway from it down the middle of the room to the south door (the aisle x 35..37: his walk).
//                  The tables stand a step lower on either side, in the pit: a dance floor and the chandelier
//                  that came down on it to the west, the bar to the east. A tier along the south wall is level
//                  with the stage, the runway and the rest of the cellar.
//   LONG HALL      from the Gold Room's south door straight to the Other Office: bare brick, the boiler's pipes in
//                  a chase along the top of each wall, one bulb, puddles (in the floor itself: the aisle is empty).
//   OTHER OFFICE   the real office read out of this very plan and rebuilt cell for cell 7 blocks lower in the old
//                  club's finishes (otherOffice() below lists what differs, and why).
//   the passages   under the East and West Hall, from the Gold Room's south corners to the corners outside the
//                  Other Office's doors. The west corner is flooded. Off the east passage: the boiler room. Off the
//                  west passage: the store of the club's old signs and props.
//   the stairs     a narrow flight down from Parts & Service (its middle aisle, x 49..56) to a landing by the
//                  east corner.
//
// Levels: floor blocks y = -8, you stand at -7, the top row of air is -3, the ceiling -2 (the pizzeria's own
// floor, y = -1, lies on it). The Gold Room's pit is one deeper (floor y = -9, the lot's last layer).
//
// Light: the ghost light on the stage burns all night (meta.fixtures). Every other lamp down here is in
// meta.hanging, group "cellar": the game lights them by day with the pizzeria's pendants and puts them out at night.

import { PHASES } from './plan.js';
import { OFFICE } from './layout.js';
import { CELLAR } from './cellar.js';

const FLOOR = CELLAR.floorY;
const STAND = CELLAR.standY;
const CEIL = CELLAR.ceilY;
const TOP = CEIL - 1;
const PIT = FLOOR - 1; // the Gold Room's pit: its floor blocks (you stand at FLOOR)
const DOOR_TOP = STAND + 2; // doorways are 3 tall, like upstairs

const [GX1, GZ1, GX2, GZ2] = CELLAR.rooms.GOLD_ROOM;
const AISLE = CELLAR.aisle;

/** Everything the cellar adds around the three fixed boxes (interior boxes [x1, z1, x2, z2], like layout.js). */
export const CELLAR_PLAN = Object.freeze({
  rooms: Object.freeze({
    E_PASSAGE: Object.freeze([44, 40, 46, 57]), // under the East Hall
    E_CORNER: Object.freeze([42, 58, 46, 70]), // outside the Other Office's right door
    W_PASSAGE: Object.freeze([26, 40, 28, 57]), // under the West Hall
    W_CORNER: Object.freeze([26, 58, 30, 70]), // outside its left door: flooded from z 64 south
    LANDING: Object.freeze([48, 65, 48, 67]), // the foot of the stairs
    BOILER: Object.freeze([49, 44, 57, 53]),
    STORE: Object.freeze([18, 41, 23, 50]),
  }),
  /** doorways cut through the walls: [x1, y1, z1, x2, y2, z2] */
  doors: Object.freeze({
    gold_sw: Object.freeze([26, STAND, 39, 28, DOOR_TOP, 39]),
    gold_se: Object.freeze([44, STAND, 39, 46, DOOR_TOP, 39]),
    landing: Object.freeze([47, STAND, 65, 47, DOOR_TOP, 67]),
    boiler: Object.freeze([47, STAND, 48, 48, DOOR_TOP, 49]),
    store: Object.freeze([24, STAND, 45, 25, DOOR_TOP, 46]),
  }),
  /**
   * The stairs from Parts & Service: one block wide along z = 66. You step off the room's floor at `head`
   * (x 56), the steps run west from x2 (y = -1) down to x1 (y = -7), and the landing is the cell west of that.
   */
  stairs: Object.freeze({ z: 66, head: 56, x1: 49, x2: 55 }),
  /** the Gold Room: the stage, the runway, the tier along the south wall, the pit either side of the runway */
  gold: Object.freeze({
    stage: Object.freeze([GX1, GZ1, GX2, 18]),
    runway: Object.freeze([AISLE.x1, 19, AISLE.x2, 34]),
    tier: Object.freeze([GX1, 35, GX2, GZ2]),
    pitY: PIT + 1, // where you stand in the pit
    posts: Object.freeze([29, 43]), // the proscenium's posts (x), in the stage's front row (z 18)
  }),
  /** the flooded end of the west corner: you stand a block lower, in the water */
  flood: Object.freeze([26, 64, 30, 70]),
  /** the one lamp that burns all night: the ghost light on the stage, beside his spot */
  stageLamp: Object.freeze({ x: 34, y: STAND, z: 18 }),
});

// ---------------------------------------------------------------- materials
// (PALETTE keys; lists are picked from at random, cell by cell)
const K = {
  // the raw cellar: damp concrete, brick on a cobble footing
  concrete: ['concrete', 'concrete', 'concrete', 'concrete', 'concrete', 'concrete', 'concrete', 'concrete_puddle'],
  wetConcrete: ['concrete', 'concrete', 'concrete', 'concrete_puddle'], // the Long Hall's floor
  wallLow: ['cobble', 'cobble', 'mossy_cobble', 'stone_bricks'],
  wall: ['brick', 'brick', 'brick', 'brick', 'cracked_bricks'],
  // the club's finishes
  panel: 'panel_rot',
  paper: ['gold_paper', 'gold_paper', 'gold_paper', 'gold_paper', 'gold_paper', 'gold_paper', 'gold_paper_torn'],
  plaster: ['plaster_old', 'plaster_old', 'plaster_old', 'plaster_old', 'plaster_old', 'plaster_old', 'plaster_old', 'plaster_old', 'plaster_old', 'plaster_old_stained'],
  carpet: 'carpet_gold',
  curtain: 'curtain_gold',
  boards: 'stage_floor',
  officeFloor: 'tile_office_old',
};

/** The cells of the wall ring round an interior box. */
function* ringOf(box) {
  const [x1, z1, x2, z2] = box;
  for (let x = x1 - 1; x <= x2 + 1; x++) {
    for (let z = z1 - 1; z <= z2 + 1; z++) if (x < x1 || x > x2 || z < z1 || z > z2) yield [x, z];
  }
}

/** A lamp the game lights by day and puts out at night (with the pizzeria's pendants: meta.hanging). */
function dayLamp(p, x, y, z, key = 'bare_off') {
  p.set(x, y, z, key);
  p.meta.hanging.push({ x, y, z, group: 'cellar' });
}

/** A club table with chairs round it: `chairs` lists the sides (n/s/w/e) and whether the chair there has fallen. */
function tableSet(p, x, y, z, chairs) {
  const side = { n: [0, -1, 's'], s: [0, 1, 'n'], w: [-1, 0, 'e'], e: [1, 0, 'w'] };
  p.set(x, y, z, 'club_table');
  for (const c of chairs) {
    const [dx, dz, face] = side[c[0]];
    p.set(x + dx, y, z + dz, `clubchair_${c.length > 1}_${face}`);
  }
}

// ---------------------------------------------------------------- the plan
/** Append the cellar to a plan (call it last: it reads the finished office out of the plan's own ops). */
export function cellar(p) {
  const office = readBox(p, [OFFICE.box[0] - 1, -1, OFFICE.box[1] - 1, OFFICE.box[2] + 1, 5, OFFICE.box[3] + 1]);
  const rng = p.rng.fork(71);
  shell(p, rng);
  stairs(p, rng);
  p.setPhase('decor');
  goldRoom(p);
  longHall(p);
  passages(p);
  boilerRoom(p);
  store(p);
  otherOffice(p, rng, office);
  p.flush();
}

// ---------------------------------------------------------------- shell: walls, floors, ceilings, doorways
function shell(p, rng) {
  p.setPhase('rooms');
  const R = CELLAR_PLAN.rooms;
  const hall = CELLAR.rooms.LONG_HALL;
  const raw = [hall, R.E_PASSAGE, R.E_CORNER, R.W_PASSAGE, R.W_CORNER, R.LANDING, R.BOILER, R.STORE];
  // 1. walls: every room's ring, brick on a cobble footing
  for (const box of raw) {
    for (const [x, z] of ringOf(box)) {
      p.set(x, FLOOR, z, 'cobble');
      p.set(x, STAND, z, rng.pick(K.wallLow));
      for (let y = STAND + 1; y <= CEIL; y++) p.set(x, y, z, rng.pick(K.wall));
    }
  }
  p.flush();
  // the Gold Room: rotten panelling to the chair rail, old gold wallpaper above (its pit is a block deeper)
  for (const [x, z] of ringOf(CELLAR.rooms.GOLD_ROOM)) {
    p.set(x, PIT, z, 'cobble');
    for (const y of [FLOOR, STAND]) p.set(x, y, z, K.panel);
    p.set(x, STAND + 1, z, z < GZ1 || z > GZ2 ? 'stripped_dark_oak_x' : 'stripped_dark_oak_z');
    for (let y = STAND + 2; y <= TOP; y++) p.set(x, y, z, rng.pick(K.paper));
    p.set(x, CEIL, z, 'brick');
  }
  p.flush();
  // 2. floors, ceilings (timber: a beam every third row), air
  for (const box of raw) {
    const [x1, z1, x2, z2] = box;
    for (let x = x1; x <= x2; x++) {
      for (let z = z1; z <= z2; z++) {
        p.set(x, FLOOR, z, rng.pick(box === hall ? K.wetConcrete : K.concrete));
        p.set(x, CEIL, z, z % 3 === 0 ? 'dark_oak_log_x' : 'spruce');
      }
    }
    p.fill(x1, STAND, z1, x2, TOP, z2, 'air');
  }
  {
    p.fill(GX1, PIT, GZ1, GX2, PIT, GZ2, K.carpet);
    p.fill(GX1, FLOOR, GZ1, GX2, TOP, GZ2, 'air');
    for (let x = GX1; x <= GX2; x++) for (let z = GZ1; z <= GZ2; z++) p.set(x, CEIL, z, rng.pick(K.plaster));
    p.flush();
    const G = CELLAR_PLAN.gold;
    for (const [x1, z1, x2, z2] of [G.stage, G.runway]) p.fill(x1, FLOOR, z1, x2, FLOOR, z2, K.boards);
    p.fill(G.tier[0], FLOOR, G.tier[1], G.tier[2], FLOOR, G.tier[3], 'dark_oak');
    p.fill(AISLE.x1, FLOOR, G.tier[1], AISLE.x2, FLOOR, G.tier[3], K.boards); // the runway crosses the tier to the south door
  }
  // 3. doorways (three tall, a timber lintel over each), and the two openings of the contract (full height)
  p.setPhase('openings');
  for (const [x1, y1, z1, x2, y2, z2] of Object.values(CELLAR_PLAN.doors)) {
    p.fill(x1, y1, z1, x2, y2, z2, 'air');
    p.fill(x1, FLOOR, z1, x2, FLOOR, z2, 'stone_bricks');
    p.fill(x1, y2 + 1, z1, x2, y2 + 1, z2, x1 === x2 || z2 - z1 > x2 - x1 ? 'dark_oak_log_z' : 'dark_oak_log_x');
  }
  for (const [x1, y1, z1, x2, y2, z2] of Object.values(CELLAR.openings)) p.fill(x1, y1, z1, x2, y2, z2, 'air');
  const m = CELLAR.openings.hall_mouth;
  p.fill(m[0], FLOOR, m[2], m[3], FLOOR, m[5], K.boards);
}

/** The stairs down from Parts & Service, and the railing round their trench upstairs. */
function stairs(p, rng) {
  const S = CELLAR_PLAN.stairs;
  // the trench: brick cheeks either side of the flight (the room's floor stays on top of them, under the railing)
  for (const z of [S.z - 1, S.z + 1]) {
    for (let x = S.x1; x <= S.x2; x++) for (let y = FLOOR; y <= -2; y++) p.set(x, y, z, rng.pick(K.wall));
  }
  for (let i = 0; S.x2 - i >= S.x1; i++) {
    const x = S.x2 - i;
    const y = -1 - i;
    p.fill(x, FLOOR, S.z, x, y - 1, S.z, 'stone_bricks'); // solid under every step
    if (i) p.fill(x, y + 1, S.z, x, -1, S.z, 'air');
    p.set(x, y, S.z, 'stone_brick_stairs_e');
  }
  p.set(S.x1 - 1, -1, S.z, 'brick'); // the end wall over the landing's mouth
  p.flush();
  // upstairs: a railing along both sides of the trench, open at the head
  p.setPhase('decor');
  for (let x = S.x1; x <= S.x2; x++) for (const z of [S.z - 1, S.z + 1]) p.set(x, 0, z, 'rail_x');
}

// ---------------------------------------------------------------- the Gold Room
function goldRoom(p) {
  const G = CELLAR_PLAN.gold;
  const [postW, postE] = G.posts;
  const pit = PIT + 1;
  // ---- the stage: gold curtains across the back wall, a post either side of the opening, a valance between them,
  // the drapes drawn back behind the posts, the wings closed off from the room
  p.fill(postW, STAND, GZ1 - 1, postE, TOP, GZ1 - 1, K.curtain);
  for (const x of G.posts) p.fill(x, STAND, 18, x, TOP, 18, 'stripped_dark_oak');
  p.fill(postW + 1, TOP, 18, postE - 1, TOP, 18, K.curtain);
  for (const x of [postW + 1, postE - 1]) p.fill(x, STAND, 18, x, TOP - 1, 18, K.curtain);
  p.fill(GX1, STAND, 18, postW - 1, TOP, 18, K.curtain);
  p.fill(postE + 1, STAND, 18, GX2, TOP, 18, K.curtain);
  // THE GOLDEN DOG SUPPER CLUB: the club's sign, hung on the back curtain over his head
  p.picture('sign_golden_dog', 33, TOP, GZ1, 's', 7, 2);
  // dead footlights along the stage's front edge (not across the runway)
  for (let x = postW + 2; x <= postE - 2; x++) if (x < AISLE.x1 || x > AISLE.x2) p.set(x, FLOOR, 18, 'lip_false_s');
  // the ghost light, the one lamp left burning, on one side of his spot; the old microphone on the other
  const L = CELLAR_PLAN.stageLamp;
  p.set(L.x, L.y, L.z, 'ghost_on');
  p.meta.fixtures.push({ x: L.x, y: L.y, z: L.z, key: 'ghost_on', room: 'CELLAR' });
  p.set(AISLE.x2 + 1, STAND, 18, 'mic_stand');
  // the wings: a costume trunk and a chair on its back in one, the fly lines and a cask in the other
  p.set(GX1, STAND, GZ1, 'barrel_e');
  p.set(GX1 + 1, STAND, GZ1, 'clubchair_true_s');
  p.set(GX1, TOP, GZ1 + 1, 'cobweb');
  p.set(GX2, STAND, GZ1, 'barrel_w');
  p.fill(GX2, STAND + 1, GZ1 + 1, GX2, TOP, GZ1 + 1, 'chain_y');
  p.set(GX2 - 1, TOP, GZ1, 'cobweb');
  // ---- the tier along the south wall: a balustrade at its edge, steps down into the pit either side of the runway
  const edge = G.tier[1];
  const steps = [[30, 32], [40, 42]];
  for (let x = GX1; x <= GX2; x++) {
    if (x >= AISLE.x1 && x <= AISLE.x2) continue;
    if (steps.some(([a, b]) => x >= a && x <= b)) p.set(x, pit, edge - 1, 'dark_oak_stairs_s');
    else p.set(x, STAND, edge, 'fence_dark');
  }
  p.picture('poster_golden_dog', 32, STAND + 3, GZ2, 'n', 2, 3); // his show poster, by the south door
  p.set(39, STAND + 3, GZ2, 'sconce_false_n'); // dead
  // a step up onto the runway from each side of the pit
  p.set(AISLE.x1 - 1, pit, 27, 'dark_oak_stairs_e');
  p.set(AISLE.x2 + 1, pit, 27, 'dark_oak_stairs_w');
  // ---- the pit, west: the dance floor in front of the stage, and the chandelier that came down on it
  for (let x = 28; x <= 33; x++) for (let z = 20; z <= 25; z++) p.set(x, PIT, z, (x + z) % 2 ? 'spruce' : 'dark_oak');
  p.set(31, pit, 23, 'chandelier_e');
  p.fill(31, TOP - 1, 23, 31, TOP, 23, 'chain_y'); // what is left of its chain
  for (const [x, z] of [[30, 23], [32, 22], [31, 24], [31, 22]]) p.set(x, CEIL, z, 'plaster_old_stained');
  for (const [x, z, d] of [[29, 22, 'n'], [32, 24, 'e'], [30, 25, 's']]) p.set(x, pit, z, `decal_debris_${d}`);
  p.set(33, pit, 21, 'clubchair_true_e');
  // a banquette along the west wall, tables before it
  p.fill(GX1, pit, 27, GX1, pit, 33, 'dark_oak_stairs_w');
  tableSet(p, 28, pit, 28, ['e']);
  tableSet(p, 28, pit, 32, ['e!', 's']);
  tableSet(p, 31, pit, 30, ['w', 'e', 'n!']);
  tableSet(p, 33, pit, 32, ['w']);
  p.set(GX1, pit, 21, 'club_table');
  p.set(GX1 + 1, pit, 21, 'clubchair_false_w');
  dayLamp(p, GX1, STAND + 2, 30, 'sconce_false_e'); // one of the wall lamps still works, by day
  p.set(GX1, STAND + 2, 22, 'sconce_false_e'); // the other is dead
  // ---- the pit, east: tables, and the bar along the wall (casks and dusty bottles behind it)
  tableSet(p, 40, pit, 21, ['w', 'e', 's']);
  tableSet(p, 41, pit, 25, ['n', 'w!']);
  tableSet(p, 40, pit, 31, ['w', 's!', 'e']);
  p.fill(44, pit, 23, 44, pit, 32, 'stripped_dark_oak_z');
  p.set(45, pit, 23, 'stripped_dark_oak_x');
  for (const [z, k] of [[24, 'bottles_bar_w'], [27, 'bottles_row_e'], [29, 'bottles_bar_e'], [32, 'bottles_bar_w']]) p.set(44, pit + 1, z, k);
  for (let z = 24; z <= 32; z++) {
    p.set(GX2, pit, z, z % 2 ? 'dark_oak' : 'barrel_w');
    if (z % 4 !== 3) p.set(GX2, pit + 1, z, 'bottles_row_w');
    if (z >= 25 && z <= 31) {
      p.set(GX2, pit + 2, z, 'dark_oak_slab_top');
      if (z % 3) p.set(GX2, pit + 3, z, 'bottles_row_w');
    }
  }
  p.set(43, pit, 25, 'clubchair_false_e');
  p.set(43, pit, 28, 'clubchair_false_e');
  p.set(42, pit, 30, 'clubchair_true_n');
  p.set(GX2, pit, 20, 'jukebox');
  dayLamp(p, GX2, TOP, 28, 'sconce_false_w'); // the lamp over the back bar: by day
  // cobwebs in the corners and along the valance
  for (const [x, y, z] of [[GX1, TOP, 19], [GX2, TOP, 19], [GX1, TOP, GZ2], [GX2, TOP, GZ2], [GX1, TOP, 34], [postW + 2, TOP - 1, 18], [postE - 2, TOP - 1, 18], [GX2, TOP, 33]]) {
    p.set(x, y, z, 'cobweb');
  }
}

// ---------------------------------------------------------------- the Long Hall
function longHall(p) {
  const [x1, z1, x2, z2] = CELLAR.rooms.LONG_HALL;
  // a pipe chase along the top of each wall, outside the aisle (which stays empty, floor to ceiling): the
  // boiler's pipes run in them, and the hall's one bulb hangs in the west one
  for (const [x, back] of [[x1 - 1, x1 - 2], [x2 + 1, x2 + 2]]) {
    p.fill(back, TOP, z1, back, CEIL, z2 - 1, 'brick');
    p.fill(x, TOP, z1, x, TOP, z2 - 1, 'air');
    for (let z = z1; z <= z2 - 1; z++) if (!(x < x1 && z === 49)) p.set(x, TOP, z, 'pipes_run_n');
  }
  dayLamp(p, x1 - 1, TOP, 49);
}

// ---------------------------------------------------------------- the passages, the corners, the landing
function passages(p) {
  const R = CELLAR_PLAN.rooms;
  // ---- the east passage: the boiler's pipes along its east wall, casks by the corner
  for (let z = 40; z <= 47; z++) p.set(46, TOP, z, 'pipes_run_n');
  p.fill(46, STAND, 50, 46, TOP, 50, 'pipes_riser_w');
  p.set(44, STAND, 56, 'barrel_e');
  p.set(44, STAND + 1, 56, 'barrel_e');
  p.set(44, STAND, 55, 'barrel_n');
  p.set(44, TOP, 40, 'cobweb');
  dayLamp(p, 45, TOP, 44);
  dayLamp(p, 45, TOP, 54);
  // ---- the east corner: the nook partition of the corner upstairs stands here too. Behind it, one chair,
  // facing the wall
  p.fill(43, STAND, 68, 43, TOP, 70, 'brick');
  p.set(45, STAND, 70, 'clubchair_false_s');
  p.set(46, TOP, 70, 'cobweb');
  p.set(42, TOP, 58, 'cobweb');
  dayLamp(p, 42, TOP, 63); // by the Other Office's right window: a little of it falls in
  // ---- the landing: the empty costume that sat against the west wall upstairs is at the foot of the stairs now
  p.set(R.LANDING[0], STAND, R.LANDING[3], 'suit_rustgrin_n');
  dayLamp(p, R.LANDING[0], TOP, R.LANDING[1]);
  // ---- the west passage: his posters, crates outside the store
  p.picture('poster_golden_dog', 26, STAND + 3, 52, 'e', 2, 3);
  p.set(28, STAND, 44, 'barrel_w');
  p.set(28, STAND, 43, 'spruce');
  p.set(28, STAND + 1, 43, 'barrel_n');
  p.set(28, TOP, 40, 'cobweb');
  dayLamp(p, 27, TOP, 42);
  dayLamp(p, 27, TOP, 54);
  // ---- the west corner: its south end is flooded. The floor has sunk a block and black water stands in it,
  // two casks awash, a riser coming down the wall into it
  const [fx1, fz1, fx2, fz2] = CELLAR_PLAN.flood;
  p.fill(fx1, PIT, fz1, fx2, PIT, fz2, 'mud');
  p.fill(fx1, FLOOR, fz1, fx2, FLOOR, fz2, 'flood');
  p.set(27, FLOOR, 68, 'barrel_n');
  p.set(29, FLOOR, 70, 'barrel_e');
  p.fill(fx1, STAND, fz2, fx1, TOP, fz2, 'pipes_riser_n');
  p.set(fx2, TOP, fz2, 'cobweb');
  p.set(fx1, TOP, 58, 'cobweb');
  dayLamp(p, 30, TOP, 62); // by the left window
}

// ---------------------------------------------------------------- the boiler room
function boilerRoom(p) {
  const [x1, z1, x2, z2] = CELLAR_PLAN.rooms.BOILER;
  // the boiler: a riveted copper drum three blocks each way, its fire door facing the room, a flue to the ceiling
  p.fill(53, STAND, 45, 55, STAND + 2, 47, 'copper_old');
  p.fill(53, STAND + 2, 45, 55, STAND + 2, 47, 'copper_green');
  p.set(54, STAND, 47, 'blast_s');
  p.set(54, STAND + 1, 47, 'iron_block');
  p.fill(54, STAND + 3, 46, 54, TOP, 46, 'lamp_post');
  p.set(53, STAND + 1, 48, 'deadbtn_light_s'); // a dead gauge
  // pipes: up the north wall either side of it, and away under the ceiling towards the door
  for (const x of [52, 56]) p.fill(x, STAND, z1, x, TOP, z1, 'pipes_riser_s');
  for (let x = x1; x <= 51; x++) p.set(x, TOP, 46, 'pipes_run_e');
  // the coal: a heap in the south-east corner behind a board
  p.fill(x2 - 1, STAND, z2 - 1, x2, STAND, z2, 'coal');
  p.set(x2, STAND + 1, z2, 'coal');
  p.set(x2 - 2, STAND, z2, 'spruce_slab');
  // the stoker's corner: a bench, an anvil, casks, a water butt
  p.fill(x1, STAND, z2 - 1, x1, STAND, z2, 'blackstone_slab_top');
  p.set(x1, STAND + 1, z2, 'anvil');
  p.set(x1 + 2, STAND, z2, 'barrel_n');
  p.set(x1 + 3, STAND, z2, 'barrel_n');
  p.set(x1 + 2, STAND + 1, z2, 'barrel_n');
  p.set(x2, STAND, z1 + 5, 'cauldron');
  p.set(x2, STAND, z1 + 6, 'clubchair_false_w');
  for (const [x, z] of [[x1, z1], [x2, z2], [x2, z1 + 4]]) p.set(x, TOP, z, 'cobweb');
  dayLamp(p, x1 + 2, TOP, z1 + 6);
}

// ---------------------------------------------------------------- the store
function store(p) {
  const [x1, z1, x2, z2] = CELLAR_PLAN.rooms.STORE;
  // what the club left behind: its posters, the lettered boards from the door, tables and chairs stacked,
  // casks, a rolled curtain, the jukebox that stood by the bar
  p.picture('poster_golden_dog', x1 + 1, STAND + 3, z1, 's', 2, 3);
  p.picture('poster_golden_dog', x1, STAND + 3, z2 - 1, 'e', 2, 3);
  p.set(x1 + 4, STAND + 2, z1, 'star_s');
  p.fill(x1, STAND, z1, x1, STAND + 1, z1, 'spruce');
  p.set(x1 + 3, STAND, z1, 'barrel_s');
  p.set(x1 + 4, STAND, z1, 'barrel_s');
  p.set(x1 + 4, STAND + 1, z1, 'barrel_s');
  p.set(x2, STAND, z1, 'jukebox');
  p.set(x1, STAND, z1 + 3, 'club_table');
  p.set(x1, STAND, z1 + 4, 'club_table');
  p.set(x1 + 1, STAND, z1 + 4, 'clubchair_true_w');
  p.set(x1, STAND, z1 + 6, 'clubchair_false_e');
  p.set(x1, STAND + 1, z1 + 6, 'clubchair_false_e');
  p.fill(x1 + 1, STAND, z2, x1 + 3, STAND, z2, 'curtain_gold'); // a curtain, rolled and stacked
  p.set(x1 + 2, STAND + 1, z2, 'curtain_gold');
  p.set(x2, STAND, z2, 'bookshelf');
  p.set(x2, STAND + 1, z2, 'bookshelf');
  p.set(x2, STAND, z2 - 1, 'barrel_w');
  p.set(x2, STAND, z2 - 2, 'bottles_row_w');
  for (const [x, z] of [[x1, z2], [x2, z1], [x1 + 2, z1]]) p.set(x, TOP, z, 'cobweb');
  dayLamp(p, x1 + 3, TOP, z1 + 5);
  p.flush();
  p.setPhase('signs');
  p.sign(x2, STAND + 1, z1 + 2, 'w', ['THE GOLDEN DOG', 'SUPPER CLUB', '', 'Est. 1958']);
  p.sign(x2, STAND + 2, z1 + 3, 'w', ['TONIGHT', 'The Golden Dog', 'and his band', '9 PM']);
  p.sign(x2, STAND + 1, z1 + 3, 'w', ['COAT CHECK', '25 cents']);
  p.sign(x2, STAND + 1, z2 - 3, 'w', ['CLOSED', 'until further', 'notice', '1971']);
  p.setPhase('decor');
}

// ---------------------------------------------------------------- the Other Office
/**
 * Replay the plan's ops inside a box [x1, y1, z1, x2, y2, z2]: what the pizzeria builds there, cell by cell.
 * Returns { at(x, y, z) -> palette key, signs: Map("x,y,z" -> lines) }.
 */
function readBox(p, [bx1, by1, bz1, bx2, by2, bz2]) {
  p.flush();
  const cells = new Map();
  const signs = new Map();
  const inside = (x, y, z) => x >= bx1 && x <= bx2 && y >= by1 && y <= by2 && z >= bz1 && z <= bz2;
  for (const phase of PHASES) {
    for (const op of p.ops[phase]) {
      if (op[0] === 'F' || op[0] === 'A') {
        const [, x1, y1, z1, x2, y2, z2, key] = op;
        if (x2 < bx1 || x1 > bx2 || y2 < by1 || y1 > by2 || z2 < bz1 || z1 > bz2) continue;
        for (let x = Math.max(x1, bx1); x <= Math.min(x2, bx2); x++) {
          for (let y = Math.max(y1, by1); y <= Math.min(y2, by2); y++) {
            for (let z = Math.max(z1, bz1); z <= Math.min(z2, bz2); z++) {
              const k = `${x},${y},${z}`;
              if (op[0] === 'A' && (cells.get(k) ?? 'air') !== 'air') continue;
              cells.set(k, key);
            }
          }
        }
      } else if (op[0] === 'L') {
        const list = op[2];
        for (let i = 0; i < list.length; i += 3) if (inside(list[i], list[i + 1], list[i + 2])) cells.set(`${list[i]},${list[i + 1]},${list[i + 2]}`, op[1]);
      } else if (op[0] === 'T') {
        if (!inside(op[1], op[2], op[3])) continue;
        cells.set(`${op[1]},${op[2]},${op[3]}`, op[4]);
        signs.set(`${op[1]},${op[2]},${op[3]}`, op[5]);
      }
    }
  }
  return { at: (x, y, z) => cells.get(`${x},${y},${z}`) ?? 'air', signs };
}

/** What the night man's sign says down here (keyed by the first line of the sign upstairs). */
const OLD_SIGNS = Object.freeze({
  'NIGHT GUARD': ['NIGHT MAN', 'Keep the stage', 'lamp burning.', 'Do not look at him'],
});

/** Things low enough to stay on the desk in front of the gap: papers, the wreck of the monitor. */
const FLAT = /^(clutter_|plates$|deadcrt_flat_)/;

/**
 * The real office, moved by CELLAR.otherOffice.offset and decades older. Every cell of its box and of its wall
 * ring is read out of the plan (so the two can never drift apart) and translated:
 *   - finishes: the checker wainscot is rotten panelling, the plaster old gold wallpaper, the tiles are stained
 *   - there is no wall behind the desk (CELLAR.openings.desk_gap: the Long Hall's mouth), and nothing stands on
 *     or above the desk between x 35 and 37 but flat things: no bank of monitors, no shelf
 *   - the lamp is dead, and so is everything the guard works upstairs: the buttons and the monitor are wrecks
 *     of themselves, not the control blocks (clicking them does nothing)
 *   - the desk phone is the real fnar:desk_phone, in its own cell: the game rings it, and it is the way back
 *   - Walter's things, the fan and the plush are not here; the poster and the drawings are of the Golden Dog,
 *     and the faint footprints on the floor are paw prints
 * Nothing is added: where the office has air, so has this room (tools/map/validate_map.mjs checks it).
 */
function otherOffice(p, rng, office) {
  p.flush();
  const o = CELLAR.otherOffice.offset;
  const [x1, z1, x2, z2] = OFFICE.box;
  const gap = CELLAR.openings.desk_gap;
  const inGap = (x, y, z) => x >= gap[0] && x <= gap[3] && y >= gap[1] && y <= gap[4] && z >= gap[2] && z <= gap[5];
  /** @type {[number, number, number, string, string[]][]} */
  const signs = [];
  for (let x = x1 - 1; x <= x2 + 1; x++) {
    for (let z = z1 - 1; z <= z2 + 1; z++) {
      for (let y = -1; y <= 5; y++) {
        const X = x + o.x, Y = y + o.y, Z = z + o.z;
        if (inGap(X, Y, Z)) {
          p.set(X, Y, Z, 'air');
          continue;
        }
        const key = office.at(x, y, z);
        const lines = office.signs.get(`${x},${y},${z}`);
        if (lines) {
          signs.push([X, Y, Z, key.slice(-1), OLD_SIGNS[lines[0]] ?? lines]);
          continue;
        }
        let old = oldKey(key, rng, { y, alongZ: x < x1 || x > x2 });
        // nothing but flat things on the desk in front of the gap, and nothing above them
        if (x >= gap[0] && x <= gap[3] && z <= z1 + 1 && y >= 1 && y <= 4 && old !== 'air' && !FLAT.test(old)) old = 'air';
        p.set(X, Y, Z, old);
      }
    }
  }
  p.flush();
  p.fill(gap[0], FLOOR, gap[2], gap[3], FLOOR, gap[5], 'concrete'); // the floor of the gap is the hall's
  p.setPhase('signs');
  for (const [x, y, z, dir, lines] of signs) p.sign(x, y, z, dir, lines);
  p.setPhase('decor');
}

/** The old club's version of one of the office's blocks. */
function oldKey(key, rng, at) {
  if (key === 'air' || /^light\d+$/.test(key)) return 'air';
  if (key.startsWith('pic:')) {
    const [, name, tile, dir] = key.split(':');
    if (name === 'poster_revue') return `pic:poster_golden_dog:${tile}:${dir}`;
    if (name === 'drawing') return `pic:drawing_golden_dog:${Number(tile) % 2}:${dir}`;
    if (name === 'wall_writing') return key; // somebody kept count down here too
    return 'air';
  }
  const direct = {
    tile_office: K.officeFloor, wall_checker: K.panel, cinder: K.panel,
    trim: at.alongZ ? 'stripped_dark_oak_z' : 'stripped_dark_oak_x',
    lamp_office: 'lamp_off', lamp_on: 'lamp_off', vent_closed: 'vent_open',
    stripped_dark_oak_x: 'dark_oak_log_x', int_core: at.y < 0 ? 'dark_oak' : 'brick',
    fan_s: 'clutter_s', plush_s: 'air', walter_desk_s: 'air', walter_flashlight_w: 'air',
    ceiling_missing: 'plaster_old_stained', crt_true_s: 'deadcrt_flat_s', crt_false_s: 'deadcrt_up_s',
  }[key];
  if (direct) return direct;
  if (key === 'plaster' || key === 'plaster_stained') return rng.pick(K.paper);
  if (key === 'ceiling' || key === 'ceiling_stained') return rng.pick(K.plaster);
  const button = /^(door|light)_btn_(?:false|true)_([nsew])$/.exec(key);
  if (button) return `deadbtn_${button[1]}_${button[2]}`;
  const prints = /^decal_prints(?:_faint)?_([nsew])$/.exec(key);
  if (prints) return `paws_faint_${prints[1]}`;
  if (/^(crt|door_btn|light_btn)_/.test(key)) return 'air'; // never one of the guard's controls
  return key;
}
