// Story text: wall signs, phone messages, night intros, secrets and ending.
// All writing is original to this project.

/** @param {{ along?: number, dy?: number }} [extra] */
const S = (room, side, text, extra = {}) => ({ room, side, text, along: extra.along, dy: extra.dy });

/** Wall signs placed by the kits' sign pass (max ~4 short lines each). */
export const STORY_SIGNS = Object.freeze([
  S('OFFICE', 'n', 'SECURITY\nOFFICE\nStay inside.\nKeep the lights low.', { along: 95, dy: 2 }),
  S('OFFICE', 's', 'HATCH: welded\nuntil further\nnotice. -Mgmt', { along: 104, dy: 2 }),
  S('W_HALL', 'w', 'WEST HALL\n<- office'),
  S('E_HALL', 'e', 'EAST HALL\noffice ->'),
  S('PARTY_A', 'n', 'PARTY ROOM A'),
  S('PARTY_B', 'n', 'PARTY ROOM B'),
  S('PARTY_C', 'n', 'PARTY ROOM C'),
  S('PARTY_D', 'n', 'PARTY ROOM D'),
  S('DINING', 's', "FREDBEAR'S\nFAMILY PIZZERIA\nEst. 1987", { dy: 4 }),
  S('DINING', 'w', 'STARLIGHT COVE\nis closed\nfor repairs.', { along: 62 }),
  S('STAGE', 's', 'Please do not\ntouch the\nperformers.', { along: 90, dy: 1 }),
  S('BACKSTAGE', 's', 'BACKSTAGE\nSpare heads are\ncounted nightly.'),
  S('PARTS', 'e', 'PARTS & SERVICE\nSuits are NOT\nto be worn.'),
  S('PROPS', 'w', 'PROPS &\nCOSTUMES'),
  S('KITCHEN', 's', 'KITCHEN\nBreaker panel\nis by the door.', { along: 170 }),
  S('PANTRY', 'n', 'PANTRY'),
  S('FREEZER', 'w', 'WALK-IN\nFREEZER\nKeep shut.'),
  S('E_SERVICE', 'w', 'STAFF ONLY\nService corridor'),
  S('COVE', 'e', "FREDBEAR'S\nSTARLIGHT COVE\nOUT OF ORDER", { along: 55 }),
  S('ARCADE', 's', 'ARCADE\nTickets at the\nprize counter.'),
  S('PRIZE', 's', 'PRIZE COUNTER'),
  S('GIFT', 'e', 'GIFT SHOP'),
  S('LOCKERS', 'n', 'STAFF LOCKERS'),
  S('SUPPLY', 'n', 'SUPPLY\nDuct grate is\nloose. Fix it.'),
  S('JANITOR', 'n', 'JANITOR'),
  S('STAFF_BREAK', 'n', 'BREAK ROOM\nNo one goes\nupstairs alone.'),
  S('EMPLOYEE', 'w', 'EMPLOYEE\nENTRANCE\nClock in ->', { along: 112 }),
  S('EMPLOYEE', 's', 'Night guard\nrules: doors,\nlights, cameras,\npower.', { along: 158 }),
  S('TRAINING', 'n', 'TRAINING ROOM\nPress the green\nbutton to begin.', { along: 150 }),
  S('TRAINING', 'w', '1 DOORS stop\nwhat you see.\n2 LIGHTS show\nthe corners.'),
  S('TRAINING', 'e', '3 CAMERAS cost\npower. 4 POWER\nis everything.'),
  S('RECEPTION', 'n', 'TICKETS\nWelcome to\nFredbear\'s!', { along: 100 }),
  S('L2_LANDING', 'n', 'UPPER FLOOR\nParty rooms &\noffices'),
  S('GOLDEN_PARTY', 's', 'THE GOLDEN ROOM\nHis original\nparty room.'),
  S('CAM_SERVER', 's', 'CAMERA SERVER\nReboot if feeds\nshow echoes.'),
  S('RECORDS', 's', 'RECORDS\nIncident files\n1983-1987'),
  S('MANAGEMENT', 's', 'MANAGEMENT\nAll incidents\nare to be\nreported HERE.'),
  S('ATTIC', 's', 'ATTIC'),
  S('COSTUME', 's', 'COSTUME STORAGE\nSPRING-LOCK SUITS\nNOT FOR STAFF'),
  S('FREIGHT_LANDING', 'e', 'BASEMENT\nFreight landing'),
  S('B_STORAGE', 's', 'STORAGE'),
  S('BOILER', 's', 'BOILER ROOM', { along: 100 }),
  S('KITCHEN_CELLAR', 'w', 'CELLAR'),
  S('TUNNEL_W', 'e', 'Do not open\nthis wall.\n- Mgmt 1987', { along: 84 }),
  S('TUNNEL_N', 's', 'NORTH TUNNEL'),
  S('TUNNEL_S', 'n', 'SOUTH TUNNEL\nOffice subfloor\naccess ->', { along: 96 }),
  S('TUNNEL_E', 'w', 'EAST TUNNEL\nStairs ^'),
  S('PUMP', 'n', 'PUMP ROOM'),
  S('ARCHIVE', 's', 'ARCHIVE\nDiner records'),
  S('GENERATOR', 's', 'GENERATOR\nRestart lever:\npull once.'),
  S('ELECTRICAL', 's', 'ELECTRICAL\nBreaker bank B'),
  S('SUBFLOOR', 'w', 'Something sleeps\nunder the office.'),
  S('DINER', 's', "FREDBEAR'S\nFAMILY DINER\n1983", { along: 40 }),
  S('DINER_KITCHEN', 'n', 'Diner kitchen\nCrawlspace ->'),
  S('CHAMBER', 's', 'HE IS STILL\nGOLDEN', { along: 34 }),
  S('CONTROL', 'n', 'COMMAND BLOCK\nCONTROL ROOM\nDeveloper area', { along: 30 }),
]);

/** Phone messages played (as timed text) at the start of each night. */
export const PHONE = Object.freeze({
  0: [
    'Hey, welcome to training. This is the same office you will use every night.',
    'The red buttons close the DOORS. White ones switch on the HALL LIGHTS so you can see the corners.',
    'The dark button raises the MONITOR. Scroll the hotbar to change cameras, sneak to put it down.',
    'Everything costs POWER. If it hits zero, the doors open and the lights die. Plan for that.',
  ],
  1: [
    "Hello? Okay. First night. I'm the guy who had your chair before you.",
    'The characters wander at night. Nobody knows why. Just keep them out of the office.',
    'If you see one in a corner with the light, shut that door. Open it again when they leave.',
    "And don't waste power. Seriously. Goodnight.",
  ],
  2: [
    'Night two. Chica has been messing with the kitchen breaker.',
    'If the hall lights go dead, hit RESET BREAKER. Use the corner cameras until then.',
    'Bonnie has started trying the other door. He gets bored of a closed one.',
  ],
  3: [
    'Bad news. The generator is old. Around 2 AM it will need a manual restart, downstairs.',
    'Everything freezes while it reboots - them included. Go, pull the lever, come back, press RESUME.',
    'Freddy only moves when nobody is watching. Check on him. Ignore him and he gets... impatient.',
    "If power runs dry there's an emergency reserve lever behind you now. One use.",
  ],
  4: [
    "Listen. They unwelded the hatch behind your chair. Something came up the old crawlspace.",
    "If you hear a music box, find WHERE it is. Shut that door or the hatch. Then hit the STROBE.",
    'Shut it first. The flash alone just makes him angry. You get three charges. Make them count.',
  ],
  5: [
    "The cameras have been showing things that aren't there. Purple, glitched, labelled ECHO. Ignore those.",
    "He can be in more than one place now. The music box tells you which door. Trust your ears.",
    "Lights may die for a few seconds. The doors still work. Around 3 AM the breakers need you downstairs.",
  ],
  6: [
    "This is the last message I can leave. I found the old diner records. It was never a costume.",
    "Around 5 AM the others will back off. That's when he comes for real. You'll get extra strobe cells.",
    'Barrier, then flash. Every time. Make it to six. Please.',
  ],
});

/** Pre-shift tasks (optional): objective text, input action, reward. */
export const TASKS = Object.freeze({
  2: { action: 'maint:kitchen_breaker', text: 'Optional: inspect the KITCHEN BREAKER PANEL (kitchen, by the dining door).', reward: 'power' },
  3: { action: 'maint:generator', text: 'Optional: prime the GENERATOR in the basement (staff stairs, east tunnel).', reward: 'power' },
  4: { action: 'maint:diner_wall', text: 'Optional: inspect the sealed wall in the WEST TUNNEL (basement).', reward: 'charge' },
  5: { action: 'maint:cam_server', text: 'Optional: reboot the CAMERA SERVER (upper floor).', reward: 'charge' },
  6: { action: 'maint:records_key', text: 'Optional: take the key from FILE CABINET F-87 in the RECORDS room (upper floor).', reward: 'charge' },
});

/** Mid-night maintenance sections (clock paused, animatronics suspended). */
export const MAINTENANCE = Object.freeze({
  generator: { action: 'maint:generator', title: 'GENERATOR RESTART', hint: 'Generator Room (basement) via the Staff Stairwell - pull the lever', text: 'Go to the GENERATOR ROOM in the basement: out the RIGHT door, through the East Hall, Party Room D and the Employee Entrance to the East Service Corridor, down the STAFF STAIRWELL, then along the East Maintenance Tunnel. Pull the restart lever, come back and press START/RESUME on the office console. Follow the green sparkles.', target: [135, -9, 91] },
  electrical: { action: 'maint:electrical', title: 'BREAKER BANK B', hint: 'Electrical Maintenance (basement) via the Staff Stairwell - pull bank B', text: 'Go to ELECTRICAL MAINTENANCE in the basement: out the RIGHT door to the East Service Corridor, down the STAFF STAIRWELL and east along the East Maintenance Tunnel. Pull breaker bank B, come back and press START/RESUME. Follow the green sparkles.', target: [170, -9, 91] },
});

export const SECRETS = Object.freeze({
  '01': ['Parts bin', 'A work order: "Gold suit #1 returned from the diner. Spring-locks seized. Do NOT re-skin. Do NOT reactivate."'],
  '02': ['Spare head shelf', 'Five spare heads. The inventory card says four. The fifth one is gold.'],
  '03': ['Cove backstage', 'Chalk on the floor: a circle, and inside it, a hat.'],
  '04': ['Freezer crate', 'A crate stamped DINER - 1983 - FREDBEAR. It is warm.'],
  '05': ['Restroom mirror', 'Written in the steam: "it hums when the lights go out"'],
  '06': ['Janitor bucket', 'The janitor quit after cleaning the west hall. His note: "the footprints go INTO the wall."'],
  '07': ['Attic box', 'Old diner flyer: "FREDBEAR & FRIEND - LIVE EVERY SATURDAY!" The friend has been cut out.'],
  '08': ["Manager's safe", 'Memo: "Seal the diner. Pour the new floor over it. Open on schedule. Tell staff nothing."'],
  '09': ['Archive drawer', 'Newspaper, 1983: "Family diner closes after incident at birthday party."'],
  '10': ['Diner jukebox', 'The jukebox plays one record. The label has been scratched to read: SIX NIGHTS.'],
  '11': ['Golden shrine', 'The plaque under the shrine reads: "Our first friend. Always golden. Always below."'],
  '12': ['Crawlspace note', 'Previous guard: "Shut the right door FIRST, then flash. Never the other way around."'],
});

export const ENDING = Object.freeze([
  '6 AM. The music box winds down mid-note.',
  'Below the office, something golden settles back into the dark of the old diner.',
  'You walk out through the front doors. The parking lot lights flicker, then hold.',
  'Behind you, the sign buzzes: FREDBEAR\'S FAMILY PIZZERIA.',
  'Six nights. You made it. He is still below.',
  'THE END - thank you for playing FREDBEAR: SIX NIGHTS BELOW.',
]);

export const TUTORIAL_STEPS = Object.freeze([
  { id: 'door', text: 'Press the RED button on the left of the console to CLOSE THE LEFT DOOR.', expect: 'door_l' },
  { id: 'door_open', text: 'Press it again to OPEN the door. Closed doors drain power.', expect: 'door_l' },
  { id: 'light', text: 'Press the WHITE button to switch on the LEFT HALL LIGHT and look through the window.', expect: 'light_l' },
  { id: 'cams', text: 'Press the dark MONITOR button (or use the Camera Tablet) to open the cameras.', expect: 'cams_open' },
  { id: 'cam_switch', text: 'Scroll the hotbar (or LB/RB, or tap a hotbar slot) to switch cameras.', expect: 'cam_switch' },
  { id: 'cams_close', text: 'SNEAK (or press the monitor button again) to put the monitor down.', expect: 'cams_close' },
  { id: 'demo', text: 'Bonnie is coming down the WEST HALL. Watch the left corner with the light and CLOSE THE DOOR when he arrives.', expect: 'repel' },
  { id: 'strobe', text: 'Last thing: the orange STROBE button. On later nights it repels Fredbear, but ONLY when his barrier is closed. Press it now.', expect: 'strobe' },
]);
