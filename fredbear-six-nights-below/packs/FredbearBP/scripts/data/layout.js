// FREDBEAR: SIX NIGHTS BELOW - authoritative map layout.
//
// Pure data (no @minecraft imports) so the in-game builder, the route graph,
// the Node validators and the floor-plan generator all read the same source.
//
// COORDINATES
//   Everything here is in LOCAL coordinates. World = local + ORIGIN.
//   ORIGIN is fixed at world (0, -50, 0) so the three levels fit above
//   bedrock (-64) in a default Flat world whose ground is at world y -61.
//   +X = east, +Z = south, -Z = north (Minecraft convention).
//
// ROOMS
//   box: [x1, z1, x2, z2] inclusive. The boundary ring is the wall; the
//   interior is x1+1..x2-1 / z1+1..z2-1. Neighbouring rooms share a wall line.
//   h: interior height in blocks (standing level .. standing level + h - 1);
//   the ceiling block sits at floorY + h + 1.

export const ORIGIN = Object.freeze({ x: 0, y: -50, z: 0 });

export const LEVELS = Object.freeze({
  L0: { id: 'L0', name: 'Basement', floorY: -10, stand: -9 },
  L1: { id: 'L1', name: 'Ground floor', floorY: -1, stand: 0 },
  L2: { id: 'L2', name: 'Upper floor', floorY: 7, stand: 8 },
});

export const PROPERTY = Object.freeze({
  // Fenced 200 x 200 property footprint.
  x1: 0, z1: 0, x2: 199, z2: 199,
  // Raised lot (plinth) and earth berm that slopes to the Flat-world ground.
  plinth: { x1: -2, z1: -2, x2: 201, z2: 201, bottomY: -11, topY: -2 },
  berm: 10,
  gradeY: -1, // ground surface block (local); players stand at y 0 outside
  clearTopY: 40, // air is cleared up to here inside the plinth area
});

/** Ticking areas (world coordinates, chunk aligned, 8x8 = 64 chunks each). */
export const TICKING_AREAS = Object.freeze([
  { name: 'fb_nw', from: [-16, -64, -16], to: [111, -20, 111] },
  { name: 'fb_ne', from: [112, -64, -16], to: [239, -20, 111] },
  { name: 'fb_sw', from: [-16, -64, 112], to: [111, -20, 239] },
  { name: 'fb_se', from: [112, -64, 112], to: [239, -20, 239] },
]);

// zone: public | staff | restricted | secret | safe | exterior | dev
// gameplay notes are reproduced in docs/02_FLOOR_PLAN.md.
/** @param {{ dark?: boolean, shaftFloorY?: number }} [extra] */
const R = (id, name, level, box, h, kit, style, zone, purpose, extra = {}) =>
  Object.freeze({ id, name, level, box, h, kit, style, zone, purpose, dark: !!extra.dark, shaftFloorY: extra.shaftFloorY });

export const ROOMS = Object.freeze([
  // ---------------------------------------------------------------- L1 north (1.6: the theatre)
  // 1.6 rebuilt the ground floor west of the staff wing (owner item 188, "bigger and creepier"): a theatre
  // around the old show stage, a play place, the Starlight Cove between them, a long arcade hall, a party
  // wing, a dining hall, and two winding halls with blind bends down to the office. The office, its two
  // corners, the supply closet and its duct, the staff wing (east), the reception and the basement keep
  // their places, so every office system and basement route still lines up.
  R('PARTS', 'Parts & Service', 'L1', [16, 12, 52, 40], 6, 'parts', 'staff', 'staff',
    'Spare endoskeletons and heads; freight stairs to the basement; CAM 03.', { dark: true }),
  R('BACKSTAGE', 'Backstage', 'L1', [52, 12, 70, 40], 6, 'backstage', 'staff', 'staff',
    "The theatre's west wing: spare-head shelves; Bonnie's way off the stage; CAM 02.", { dark: true }),
  R('THEATRE', 'The Fredbear Theatre', 'L1', [70, 12, 130, 64], 14, 'theatre', 'theatre', 'public',
    'The show stage with Freddy, Bonnie and Chica, rows of seats, a balcony catwalk; CAM 01.'),
  R('PROPS', 'Prop & Costume Storage', 'L1', [130, 12, 148, 40], 6, 'props', 'staff', 'staff',
    "The theatre's east wing: costume racks and props; ladder to the stage loft.", { dark: true }),
  R('KITCHEN', 'Kitchen', 'L1', [148, 12, 184, 50], 6, 'kitchen', 'kitchen', 'staff',
    'Chica clatter and breaker sabotage; loading door; CAM 10 is audio-only.', { dark: true }),
  // ---------------------------------------------------------------- L1 middle
  R('PLAY_PLACE', 'Play Place', 'L1', [16, 40, 52, 70], 8, 'playplace', 'party', 'public',
    'Ball pit, climbing frame and a slide; CAM 04.', { dark: true }),
  R('COVE', "Fredbear's Starlight Cove", 'L1', [52, 40, 70, 70], 6, 'cove', 'party', 'public',
    'Curtained side stage, OUT OF ORDER. Fredbear foreshadowing; CAM 05.', { dark: true }),
  R('PARTY_E', 'Party Room E', 'L1', [130, 40, 148, 64], 6, 'party', 'party', 'public',
    'Between the theatre wing, the kitchen and the dining hall (Chica\'s way round).', { dark: true }),
  R('ARCADE', 'Arcade Hall', 'L1', [16, 70, 70, 92], 6, 'arcade', 'party', 'public',
    'A long hall of cabinets, half of them still glowing; Bonnie patrol; CAM 06.'),
  R('DINING', 'Dining Hall', 'L1', [70, 64, 148, 100], 10, 'dining', 'pizzeria', 'public',
    'Long party tables under the theatre arch; the hub of every route; CAM 08 / 09.'),
  R('PANTRY', 'Pantry & Receiving', 'L1', [148, 50, 184, 62], 6, 'pantry', 'kitchen', 'staff',
    'Dry stores between kitchen and service corridor.', { dark: true }),
  R('E_SERVICE', 'East Service Corridor', 'L1', [148, 62, 156, 100], 6, 'corridor', 'staff', 'staff',
    'Chica and Freddy staff route; CAM 11.', { dark: true }),
  R('STAFF_STAIRS', 'Staff Stairwell', 'L1', [156, 62, 166, 80], 6, 'stairwell', 'staff', 'staff',
    'Stairs to the basement maintenance tunnels.', { shaftFloorY: -10, dark: true }),
  R('FREEZER', 'Walk-in Freezer', 'L1', [166, 62, 184, 80], 6, 'freezer', 'freezer', 'staff',
    'Cold storage, hanging chains; story note.', { dark: true }),
  R('RESTROOM_HALL', 'Restroom Vestibule', 'L1', [156, 80, 184, 86], 6, 'corridor', 'tile', 'public', 'Access to restrooms.'),
  R('RESTROOM_M', "Men's Restroom", 'L1', [156, 86, 170, 100], 6, 'restroom', 'tile', 'public', 'Stalls, sinks; secret behind a mirror.', { dark: true }),
  R('RESTROOM_F', "Women's Restroom", 'L1', [170, 86, 184, 100], 6, 'restroom', 'tile', 'public', 'Stalls, sinks; graffiti clue.', { dark: true }),
  // ---------------------------------------------------------------- L1 south
  R('PARTY_HALL', 'Party Wing', 'L1', [16, 92, 70, 98], 6, 'partyhall', 'party', 'public', 'The corridor of the party rooms; CAM 07.', { dark: true }),
  R('PARTY_1', 'Party Room 1', 'L1', [16, 98, 34, 124], 6, 'party', 'party', 'public', 'Party room, tables still set.', { dark: true }),
  R('PARTY_2', 'Party Room 2', 'L1', [34, 98, 52, 124], 6, 'party', 'party', 'public', 'Party room; balloons on the ceiling.', { dark: true }),
  R('PARTY_3', 'Party Room 3', 'L1', [52, 98, 70, 116], 6, 'party', 'party', 'public', "Joins the party wing and the West Hall (Bonnie's back way).", { dark: true }),
  R('GIFT', 'Gift Shop', 'L1', [16, 124, 52, 152], 6, 'gift', 'party', 'public', 'Plush shelves; front-of-house loop.'),
  R('LOCKERS', 'Staff Lockers', 'L1', [52, 116, 72, 140], 6, 'lockers', 'staff', 'staff', 'Lockers; previous guard notes.'),
  R('SUPPLY', 'Supply Closet', 'L1', [72, 116, 84, 140], 6, 'supply', 'staff', 'staff',
    "Bonnie's maintenance-duct shortcut to the west corner; CAM 17.", { dark: true }),
  R('W_HALL_N', 'West Hall (north)', 'L1', [70, 100, 76, 110], 6, 'hall', 'pizzeria', 'restricted', 'Out of the dining hall: the first blind bend.', { dark: true }),
  R('W_HALL_T', 'West Hall (bend)', 'L1', [70, 110, 90, 116], 6, 'hall', 'pizzeria', 'restricted', 'Turns east past the photo booth.', { dark: true }),
  R('W_HALL', 'West Hall', 'L1', [84, 116, 90, 134], 6, 'hall', 'pizzeria', 'restricted', 'Left approach to the office; CAM 16.', { dark: true }),
  R('W_ALCOVE', 'West Hall Corner', 'L1', [90, 126, 94, 134], 6, 'alcove', 'pizzeria', 'restricted',
    'Blind corner outside the left door; lit by the left hall light; CAM 15.', { dark: true }),
  R('PHOTO', 'Photo Booth', 'L1', [76, 100, 90, 110], 6, 'photo', 'party', 'public', 'Smile for the camera. A dead end.', { dark: true }),
  R('PARTY_A', 'Party Room A', 'L1', [90, 100, 110, 110], 6, 'party', 'party', 'public', 'Off the dining hall, north of Party Room B.'),
  R('PARTY_B', 'Party Room B', 'L1', [90, 110, 110, 126], 6, 'party', 'party', 'public', 'Right above the office: the cross-link between the two halls (Bonnie flank route).', { dark: true }),
  R('PRIZE', 'Prize Corner', 'L1', [110, 100, 124, 110], 6, 'prize', 'party', 'public', 'Prize shelves and ticket redemption.', { dark: true }),
  R('OFFICE', 'Security Office', 'L1', [94, 126, 106, 140], 6, 'office', 'office', 'safe',
    'Player station: doors, lights, cameras, power, strobe, hatch.'),
  R('E_ALCOVE', 'East Hall Corner', 'L1', [106, 126, 110, 134], 6, 'alcove', 'pizzeria', 'restricted',
    'Blind corner outside the right door; lit by the right hall light; CAM 13.', { dark: true }),
  R('E_HALL_N', 'East Hall (north)', 'L1', [124, 100, 130, 110], 6, 'hall', 'pizzeria', 'restricted', 'Out of the dining hall: the first blind bend.', { dark: true }),
  R('E_HALL_T', 'East Hall (bend)', 'L1', [110, 110, 130, 116], 6, 'hall', 'pizzeria', 'restricted', 'Turns west past the prize corner.', { dark: true }),
  R('E_HALL', 'East Hall', 'L1', [110, 116, 116, 134], 6, 'hall', 'pizzeria', 'restricted', 'Right approach to the office; CAM 12.', { dark: true }),
  R('PARTY_D', 'Party Room D', 'L1', [130, 100, 148, 116], 6, 'party', 'party', 'public', 'Joins dining, the East Hall and the employee entrance.'),
  R('JANITOR', 'Janitor Closet', 'L1', [116, 116, 128, 140], 6, 'janitor', 'staff', 'staff', 'Mops, buckets; secret note.', { dark: true }),
  R('STAFF_BREAK', 'Staff Break Room', 'L1', [128, 116, 148, 140], 6, 'breakroom', 'staff', 'staff', 'Break room; stairs to management.'),
  R('EMPLOYEE', 'Employee Entrance (Time Clock)', 'L1', [148, 100, 184, 124], 6, 'lobby', 'staff', 'safe',
    'Campaign lobby: clock in to choose a night; staff door to the delivery road.'),
  R('TRAINING', 'Training Room', 'L1', [148, 124, 184, 152], 6, 'training', 'staff', 'safe', 'Tutorial briefing boards and the training start button.'),
  R('RECEPTION', 'Reception & Ticket Counters', 'L1', [52, 140, 148, 152], 6, 'reception', 'pizzeria', 'public',
    'Front doors, ticket counters, public stairs to the upper floor.'),
  // ---------------------------------------------------------------- L2
  R('L2_LANDING', 'Upper Landing', 'L2', [52, 138, 72, 152], 6, 'landing', 'party', 'public', 'Top of the public stairs.'),
  R('GOLDEN_PARTY', 'Golden Party Room', 'L2', [72, 138, 100, 152], 6, 'golden', 'golden', 'public', 'Old Fredbear-themed deluxe party room; story.'),
  R('CAM_SERVER', 'Camera Server Room', 'L2', [100, 138, 120, 152], 6, 'server', 'office', 'staff', 'Camera racks; Night 5 pre-shift task; disruption sparks.'),
  R('RECORDS', 'Records Room', 'L2', [120, 138, 148, 152], 6, 'records', 'office', 'staff', 'Incident files; Night 6 pre-shift task (Fredbear key).'),
  R('UPPER_HALL', 'Upper Hall', 'L2', [52, 130, 148, 138], 6, 'corridor', 'office', 'staff', 'Connects every upper room.'),
  R('COSTUME', 'Costume Storage', 'L2', [52, 116, 84, 130], 6, 'costume', 'staff', 'staff', 'Suit racks; spring-lock warning posters.', { dark: true }),
  R('CRAWL_UP', 'Ceiling Crawlspace', 'L2', [84, 116, 120, 130], 3, 'crawl', 'basement', 'restricted', 'Low crawlspace above the office; secret.', { dark: true }),
  R('MANAGEMENT', 'Management Office', 'L2', [120, 116, 148, 130], 6, 'management', 'office', 'staff', 'Manager desk, safe, memos.'),
  R('ATTIC', 'Attic Storage', 'L2', [16, 104, 52, 152], 6, 'attic', 'basement', 'staff', 'Boxed decorations; secret.', { dark: true }),
  R('PROPS_LOFT', 'Stage Loft', 'L2', [130, 12, 148, 40], 6, 'loft', 'staff', 'staff', 'Rigging loft leading onto the theatre catwalk.', { dark: true }),
  // ---------------------------------------------------------------- L0
  R('FREIGHT_LANDING', 'Freight Landing', 'L0', [16, 12, 34, 28], 6, 'landing_b', 'basement', 'staff', 'Bottom of the freight stairs from Parts & Service.', { dark: true }),
  R('B_STORAGE', 'Basement Storage', 'L0', [34, 12, 76, 28], 6, 'storage', 'basement', 'staff', 'Crates and retired decorations.', { dark: true }),
  R('BOILER', 'Boiler & Machinery Hall', 'L0', [76, 12, 124, 72], 6, 'boiler', 'basement', 'staff', 'Boilers, pipes and tanks below the stage and dining hall.', { dark: true }),
  R('KITCHEN_CELLAR', 'Kitchen Cellar', 'L0', [148, 12, 184, 50], 6, 'cellar', 'basement', 'staff', 'Cold cellar under the kitchen.', { dark: true }),
  R('CHAMBER', "Fredbear's Chamber", 'L0', [16, 28, 52, 44], 6, 'chamber', 'golden', 'secret',
    "Fredbear's dormant node and the campaign ending set.", { dark: true }),
  R('DINER', "Sealed Diner (Fredbear's Family Diner, 1983)", 'L0', [16, 44, 64, 96], 6, 'diner', 'diner', 'secret',
    'The original diner the pizzeria was built over; Fredbear stirring node; CAM 24.', { dark: true }),
  R('DINER_KITCHEN', 'Diner Back Kitchen', 'L0', [16, 96, 40, 112], 6, 'diner_kitchen', 'diner', 'secret', 'Entrance to the old crawlspace.', { dark: true }),
  R('CRAWL_D', 'Old Crawlspace', 'L0', [36, 112, 92, 116], 3, 'crawl', 'basement', 'secret', "Fredbear's hidden route toward the office subfloor.", { dark: true }),
  // 1.5 (owner item 178): Valek and Morgrave's nightmare room, through a crawl hole in the old crawlspace.
  R('NIGHTMARE', 'The Workshop', 'L0', [16, 116, 58, 140], 6, 'nightmare', 'nightmare', 'secret',
    'Where Valek and Morgrave wait between nights: torn costumes, heads on hooks, little chairs facing a wall of eyes; CAM 21.', { dark: true }),
  R('TUNNEL_W', 'West Maintenance Tunnel', 'L0', [64, 72, 70, 110], 6, 'tunnel', 'basement', 'staff', 'Passes the bricked diner entrance.', { dark: true }),
  R('TUNNEL_N', 'North Maintenance Tunnel', 'L0', [70, 72, 150, 78], 6, 'tunnel', 'basement', 'staff', 'Spine under the dining hall.', { dark: true }),
  R('TUNNEL_S', 'South Maintenance Tunnel', 'L0', [70, 104, 170, 110], 6, 'tunnel', 'basement', 'staff', 'Spine under the party rooms.', { dark: true }),
  R('TUNNEL_E', 'East Maintenance Tunnel', 'L0', [150, 62, 156, 104], 6, 'tunnel', 'basement', 'staff', 'Links the staff stairwell to the tunnels.', { dark: true }),
  R('PUMP', 'Pump Room', 'L0', [70, 78, 100, 104], 6, 'pump', 'basement', 'staff', 'Water pumps and pipes.', { dark: true }),
  R('ARCHIVE', 'Old Archive', 'L0', [100, 78, 120, 104], 6, 'archive', 'basement', 'staff', 'Diner-era records and newspaper clippings.', { dark: true }),
  R('GENERATOR', 'Generator Room', 'L0', [120, 78, 150, 104], 6, 'generator', 'basement', 'staff',
    'Main generator; Night 3 pre-shift and mid-night maintenance; CAM 20.', { dark: true }),
  R('ELECTRICAL', 'Electrical Maintenance', 'L0', [156, 80, 184, 104], 6, 'electrical', 'basement', 'staff',
    'Breaker banks; Night 5 mid-night maintenance.', { dark: true }),
  R('CRAWL_A', 'Subfloor Access', 'L0', [97, 110, 103, 112], 3, 'crawl', 'basement', 'restricted', 'Short crawl from the south tunnel to the office subfloor.', { dark: true }),
  R('SUBFLOOR', 'Office Subfloor', 'L0', [92, 112, 108, 142], 4, 'subfloor', 'basement', 'restricted',
    'Crawlspace below the office leading to the maintenance hatch.', { dark: true }),
  // ---------------------------------------------------------------- dev
  R('CONTROL', 'Command-Block Control Room', 'L0', [20, 164, 180, 196], 6, 'control', 'control', 'dev',
    'Labelled command-block modules (developer area, under the parking lot).'),
]);

/** Solid masses inside the building envelope that are not rooms. */
export const SOLIDS = Object.freeze([
  { level: 'L1', box: [84, 134, 94, 140] },
  { level: 'L1', box: [106, 134, 116, 140] },
]);

// Openings. axis 'x' => wall at x = c, spanning z a1..a2; axis 'z' => wall at
// z = c spanning x a1..a2. y1..y2 are absolute local Y. kind:
//   door | arch | window | vent | sealed | gate (dynamic barrier) | secret
/** @param {{ gate?: string, exterior?: boolean, glass?: boolean }} [extra] */
const O = (id, axis, c, a1, a2, y1, y2, kind = 'door', extra = {}) =>
  Object.freeze({ id, axis, c, a1, a2, y1, y2, kind, gate: extra.gate, exterior: !!extra.exterior, glass: !!extra.glass });
const L1D = (id, axis, c, a1, a2, h = 3, kind = 'door', extra) => O(id, axis, c, a1, a2, 0, h - 1, kind, extra);
const L0D = (id, axis, c, a1, a2, h = 3, kind = 'door', extra) => O(id, axis, c, a1, a2, -9, -9 + h - 1, kind, extra);
const L2D = (id, axis, c, a1, a2, h = 3, kind = 'door', extra) => O(id, axis, c, a1, a2, 8, 8 + h - 1, kind, extra);

export const OPENINGS = Object.freeze([
  // L1 north block (1.6)
  L1D('PARTS_BACKSTAGE', 'x', 52, 25, 26),
  L1D('PARTS_PLAY', 'z', 40, 33, 34),
  L1D('BACKSTAGE_THEATRE', 'x', 70, 18, 19, 4),
  L1D('BACKSTAGE_COVE', 'z', 40, 56, 57),
  L1D('PROPS_THEATRE', 'x', 130, 18, 19, 4),
  L1D('PROPS_PARTYE', 'z', 40, 138, 139, 4),
  O('THEATRE_DINING', 'z', 64, 92, 108, 0, 6, 'arch'),
  L1D('THEATRE_PARTYE', 'x', 130, 52, 53),
  L1D('KITCHEN_PARTYE', 'x', 148, 44, 46, 4),
  L1D('PARTYE_DINING', 'z', 64, 138, 139, 4),
  L1D('KITCHEN_PANTRY', 'z', 50, 160, 161),
  L1D('KITCHEN_LOADING', 'x', 184, 24, 28, 4, 'door', { exterior: true }),
  L1D('PANTRY_SERVICE', 'z', 62, 151, 152),
  L1D('PANTRY_FREEZER', 'z', 62, 174, 175),
  L1D('SERVICE_DINING', 'x', 148, 80, 81, 4),
  L1D('SERVICE_STAIRS', 'x', 156, 64, 65),
  L1D('SERVICE_RESTROOMS', 'x', 156, 82, 83),
  L1D('RESTROOM_M_DOOR', 'z', 86, 162, 163),
  L1D('RESTROOM_F_DOOR', 'z', 86, 176, 177),
  L1D('SERVICE_EMPLOYEE', 'z', 100, 151, 152),
  // West: play place, cove, arcade hall, party wing
  O('PLAY_COVE', 'x', 52, 53, 56, 0, 3, 'arch'),
  O('PLAY_ARCADE', 'z', 70, 30, 33, 0, 3, 'arch'),
  O('COVE_ARCADE', 'z', 70, 55, 58, 0, 3, 'arch'),
  O('ARCADE_DINING', 'x', 70, 78, 86, 0, 4, 'arch'),
  O('ARCADE_PARTYHALL', 'z', 92, 40, 44, 0, 3, 'arch'),
  L1D('PARTYHALL_P1', 'z', 98, 24, 25),
  L1D('PARTYHALL_P2', 'z', 98, 42, 43),
  L1D('PARTYHALL_P3', 'z', 98, 60, 61),
  L1D('P2_P3', 'x', 52, 108, 109),
  L1D('P1_GIFT', 'z', 124, 25, 26),
  L1D('P2_GIFT', 'z', 124, 43, 44),
  L1D('GIFT_RECEPTION', 'x', 52, 145, 147),
  L1D('P3_WHALL', 'x', 70, 104, 105),
  L1D('P3_LOCKERS', 'z', 116, 61, 62),
  L1D('LOCKERS_RECEPTION', 'z', 140, 61, 62),
  L1D('SUPPLY_WHALL', 'x', 84, 120, 121),
  // The winding West Hall: out of the dining hall, a bend east past the photo booth, then south to the corner.
  O('WHALL_DINING', 'z', 100, 71, 75, 0, 4, 'arch'),
  O('WHALL_BEND_N', 'z', 110, 71, 75, 0, 4, 'arch'),
  O('WHALL_BEND_S', 'z', 116, 85, 89, 0, 4, 'arch'),
  L1D('WHALL_PHOTO', 'x', 76, 104, 105),
  L1D('WHALL_PARTYB', 'x', 90, 112, 113),
  O('WHALL_ALCOVE', 'x', 90, 127, 133, 0, 4, 'arch'),
  L1D('PARTYA_DINING', 'z', 100, 99, 100, 4),
  L1D('PARTYA_PARTYB', 'z', 110, 99, 100),
  L1D('PARTYB_EHALL', 'x', 110, 112, 113),
  L1D('PRIZE_DINING', 'z', 100, 116, 117, 4),
  L1D('PRIZE_EHALL', 'x', 124, 104, 105),
  // The winding East Hall, the mirror image.
  O('EHALL_DINING', 'z', 100, 125, 129, 0, 4, 'arch'),
  O('EHALL_BEND_N', 'z', 110, 125, 129, 0, 4, 'arch'),
  O('EHALL_BEND_S', 'z', 116, 111, 115, 0, 4, 'arch'),
  O('EHALL_ALCOVE', 'x', 110, 127, 133, 0, 4, 'arch'),
  L1D('EHALL_PARTYD', 'x', 130, 104, 105),
  L1D('EHALL_JANITOR', 'x', 116, 120, 121),
  L1D('PARTYD_DINING', 'z', 100, 138, 139, 4),
  L1D('PARTYD_EMPLOYEE', 'x', 148, 104, 105),
  L1D('PARTYD_BREAK', 'z', 116, 137, 138),
  L1D('BREAK_RECEPTION', 'z', 140, 137, 138),
  L1D('EMPLOYEE_TRAINING', 'z', 124, 165, 166),
  L1D('EMPLOYEE_STAFFDOOR', 'x', 184, 101, 102, 3, 'door', { exterior: true }),
  L1D('TRAINING_RECEPTION', 'x', 148, 145, 146),
  O('FRONT_DOORS', 'z', 152, 98, 102, 0, 3, 'door', { exterior: true, glass: true }),
  // Office: gates are dynamic barriers controlled by the night director.
  L1D('OFFICE_DOOR_W', 'x', 94, 129, 130, 3, 'gate', { gate: 'door_l' }),
  L1D('OFFICE_DOOR_E', 'x', 106, 129, 130, 3, 'gate', { gate: 'door_r' }),
  O('OFFICE_WINDOW_W', 'x', 94, 132, 133, 1, 2, 'window'),
  O('OFFICE_WINDOW_E', 'x', 106, 132, 133, 1, 2, 'window'),
  // L2
  L2D('L2_LANDING_HALL', 'z', 138, 62, 63),
  L2D('L2_GOLDEN_HALL', 'z', 138, 85, 86),
  L2D('L2_SERVER_HALL', 'z', 138, 109, 110),
  L2D('L2_RECORDS_HALL', 'z', 138, 133, 134),
  L2D('L2_COSTUME_HALL', 'z', 130, 67, 68),
  O('L2_CRAWL_HALL', 'z', 130, 101, 102, 8, 9, 'vent'),
  L2D('L2_MGMT_HALL', 'z', 130, 133, 134),
  L2D('L2_LANDING_ATTIC', 'x', 52, 145, 146),
  O('LOFT_CATWALK', 'x', 130, 14, 15, 8, 10, 'door'),
  // L0
  L0D('B_FREIGHT_STORAGE', 'x', 34, 19, 20),
  L0D('B_STORAGE_BOILER', 'x', 76, 20, 21),
  L0D('B_BOILER_TUNNELN', 'z', 72, 99, 100),
  O('B_DINER_SEAL', 'x', 64, 84, 86, -9, -7, 'sealed', { gate: 'diner_seal' }),
  O('B_CHAMBER_SECRET', 'z', 44, 33, 35, -9, -6, 'secret', { gate: 'chamber_wall' }),
  L0D('B_DINER_KITCHEN', 'z', 96, 26, 27),
  O('B_DKITCHEN_CRAWL', 'z', 112, 37, 38, -9, -8, 'vent'),
  O('B_CRAWL_SUBFLOOR', 'x', 92, 113, 114, -9, -8, 'vent'),
  O('B_CRAWL_NIGHTMARE', 'z', 116, 46, 47, -9, -8, 'vent'),
  O('B_TUNNELW_N', 'x', 70, 73, 77, -9, -6, 'arch'),
  O('B_TUNNELW_S', 'x', 70, 105, 109, -9, -6, 'arch'),
  O('B_TUNNELN_E', 'x', 150, 73, 77, -9, -6, 'arch'),
  L0D('B_TUNNELN_PUMP', 'z', 78, 85, 86),
  L0D('B_TUNNELW_PUMP', 'x', 70, 90, 91),
  L0D('B_PUMP_ARCHIVE', 'x', 100, 90, 91),
  L0D('B_ARCHIVE_TUNNELS', 'z', 104, 110, 111),
  L0D('B_GEN_TUNNELN', 'z', 78, 135, 136),
  L0D('B_GEN_TUNNELS', 'z', 104, 128, 129),
  L0D('B_GEN_TUNNELE', 'x', 150, 90, 91),
  L0D('B_TUNNELE_STAIRS', 'x', 156, 76, 77),
  L0D('B_TUNNELE_ELEC', 'x', 156, 92, 93),
  L0D('B_ELEC_TUNNELS', 'z', 104, 160, 161),
  O('B_TUNNELE_TUNNELS', 'z', 104, 151, 155, -9, -6, 'arch'),
  O('B_TUNNELS_CRAWLA', 'z', 110, 99, 101, -9, -7, 'vent'),
  O('B_CRAWLA_SUBFLOOR', 'z', 112, 99, 101, -9, -7, 'vent'),
]);

// Stairs and ladders. Stairs: run along `dir` starting at (x, z) for `steps`
// blocks, `width` wide (perpendicular, growing +x or +z), descending or
// ascending from standing level `fromStand`. Ladder: vertical shaft.
export const STAIRS = Object.freeze([
  { id: 'PUBLIC_STAIRS', kind: 'stairs', x: 54, z: 142, dir: '+x', width: 3, fromStand: 0, toStand: 8, material: 'dark_oak' },
  { id: 'MGMT_STAIRS', kind: 'stairs', x: 130, z: 118, dir: '+x', width: 3, fromStand: 0, toStand: 8, material: 'spruce' },
  { id: 'FREIGHT_STAIRS', kind: 'stairs', x: 18, z: 15, dir: '+z', width: 3, fromStand: 0, toStand: -9, material: 'stone_brick' },
  { id: 'STAFF_STAIRS', kind: 'stairs', x: 158, z: 67, dir: '+z', width: 3, fromStand: 0, toStand: -9, material: 'stone_brick' },
  { id: 'CELLAR_STAIRS', kind: 'stairs', x: 178, z: 16, dir: '+z', width: 3, fromStand: 0, toStand: -9, material: 'stone_brick' },
  { id: 'LOFT_LADDER', kind: 'ladder', x: 146, z: 30, face: 'west', fromStand: 0, toStand: 8 },
  { id: 'OFFICE_HATCH', kind: 'hatch', x: 99, z: 136, size: 2, fromStand: -9, toStand: 0, gate: 'hatch' },
  { id: 'VENT_DUCT', kind: 'duct', from: [80, 132], to: [92, 132], y: -3, h: 2 }, // two high since 1.3 (CAM 18 looks along it)
  { id: 'CEILING_VENT', kind: 'ceilvent' }, // 1.4: grate over a hole in the office ceiling (data/visitors.js CEILING_VENT)
]);

/** Room lookup by id. */
export const ROOM_BY_ID = Object.freeze(Object.fromEntries(ROOMS.map((r) => [r.id, r])));

/** Interior bounds of a room in local coordinates. */
export function interior(room) {
  const lv = LEVELS[room.level];
  const [x1, z1, x2, z2] = room.box;
  const floorY = room.shaftFloorY ?? lv.floorY;
  return { x1: x1 + 1, z1: z1 + 1, x2: x2 - 1, z2: z2 - 1, y1: floorY + 1, y2: lv.floorY + room.h, floorY, ceilY: lv.floorY + room.h + 1 };
}

/** Convert local coordinates to world coordinates. */
export function toWorld(p) {
  return { x: p.x + ORIGIN.x, y: p.y + ORIGIN.y, z: p.z + ORIGIN.z };
}

/** Find the room containing a local point (first match, interior inclusive). */
export function roomAt(x, y, z) {
  for (const r of ROOMS) {
    const i = interior(r);
    if (x >= i.x1 && x <= i.x2 + 0.999 && z >= i.z1 && z <= i.z2 + 0.999 && y >= i.y1 - 1 && y <= i.y2 + 1) return r;
  }
  return undefined;
}

// Player-facing important anchors (local, standing positions).
export const ANCHORS = Object.freeze({
  lobbySpawn: { x: 177.5, y: 0, z: 112.5, yaw: -90 },
  officeSeat: { x: 100.5, y: 0, z: 131.5, yaw: 180 },
  officeEye: { x: 100.5, y: 1.62, z: 131.5 },
  trainingSpawn: { x: 166.5, y: 0, z: 138.5, yaw: 0 },
  parkingSpawn: { x: 100.5, y: 0, z: 178.5, yaw: 180 },
  controlRoom: { x: 30.5, y: -9, z: 179.5, yaw: -90 }, // the walkway between module rows z 178 and z 181 (labels at z 180)
  endingCam: { x: 34.5, y: -6.5, z: 40.5 },
});

/**
 * Office volume used for "player is in the office" checks (local, inclusive).
 * Doors are on the west (x=94) and east (x=106) walls, hatch at the back.
 */
export const OFFICE_BOUNDS = Object.freeze({ x1: 95, x2: 105.999, y1: -0.5, y2: 6, z1: 127, z2: 139.999 });
