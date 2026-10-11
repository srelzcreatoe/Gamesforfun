// Story text: wall signs, phone messages, night intros, secrets, newspaper
// clippings, the night 4 flashback and the endings.
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
  S('DINER', 's', "FREDBEAR'S\nFAMILY DINER\n1983", { along: 30 }),
  S('DINER', 's', 'HAPPY 8TH\nBIRTHDAY\n- C. -\nAug 19, 1983', { along: 49, dy: 2 }),
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
    'Shut it first. The flash alone just makes him angry. You get four charges. Make them count.',
    "A shut door or hatch can hold him off by itself - once. After that it's the flash or nothing.",
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
  7: [
    '...this line was disconnected in 1987. If you can hear this, you came back.',
    "They switched the others off and dragged them into Parts & Service tonight. All of them except him. He knows you beat him.",
    "He is everywhere tonight - the halls, the kitchen, even the main stage. Don't trust where you saw him last.",
    'Every door, the hatch, every trick he has. The doors hold once each. Then it is the flash.',
    'Make it to six, and then decide what happens to this place. For good.',
  ],
  // Night 8 depends on how night 7 ended (game.js phoneLines).
  '8_seal': [
    "You sealed him in. Good. But he wasn't alone down there.",
    "There was a rabbit at the diner. His partner. They walled it in with him in '83 and nobody wrote it down.",
    'It does not walk the halls. It lives in the walls: the supply duct on the left, the crawlspace under your hatch.',
    "Listen for scraping. Watch CAM 18 and CAM 17. The new SEAL buttons on your desk close the duct and the shaft for a while.",
  ],
  '8_burn': [
    "You burned it. Most of it. They rebuilt the rest in a week, like nothing happened.",
    "The fire crew found a bear in Parts & Service. Gray. Nobody remembers ordering it. It wasn't even scorched.",
    'You will only see its eyes. It steps closer through the dark when nobody is looking at that spot.',
    "Light its corner and it's gone - but it comes back closer, and angrier. A closed door calms it down. It copies the others' sounds. Don't trust your ears.",
  ],
  9: [
    '...',
    'No music tonight. Just the building.',
    'The others are switched off in Parts & Service. The three of them are not.',
    'Fredbear everywhere. The rabbit in the walls. The gray bear in the dark. Seal, close, flash, light - and keep your power.',
    'Make it to six. This is the last shift.',
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

/** Newspaper clippings (lobby board): one unlocks after each night is survived. */
export const CLIPPINGS = Object.freeze([
  { night: 1, date: 'Hurricane Herald, June 2, 1983', headline: "FREDBEAR'S FAMILY DINER OPENS ON ROUTE 9", text: `Families lined up around the block for the opening of Fredbear's Family Diner, where a golden singing bear and his friend entertain young guests between slices. "He knows every child by name," said one delighted mother.` },
  { night: 2, date: 'Hurricane Herald, August 19, 1983', headline: 'DINER CLOSES AFTER BIRTHDAY PARTY INCIDENT', text: `Fredbear's Family Diner closed its doors without notice on Saturday after what police called "an accident involving the performing animal suit" during a birthday party. No further details were released. The owners declined to comment.` },
  { night: 3, date: 'Hurricane Herald, March 4, 1984', headline: 'OLD DINER SITE SOLD; "WE WILL BUILD SOMETHING HAPPIER"', text: 'The Route 9 lot has been bought by the same family. Plans show a large family pizzeria built directly over the old diner. "The past stays in the past," the new manager said. Construction crews were told the basement would be sealed.' },
  { night: 4, date: 'Hurricane Herald, May 30, 1987', headline: "FREDBEAR'S FAMILY PIZZERIA OPENS TO RECORD CROWDS", text: `Three new performers - Freddy, Bonnie and Chica - debuted on the show stage to cheering crowds. Asked about the diner's famous golden bear, staff said he had been "retired with honours." Several guests reported a music box playing somewhere beneath the dining hall.` },
  { night: 5, date: 'Hurricane Herald, October 11, 1987', headline: 'NIGHT GUARD MISSING; POLICE SEARCH PIZZERIA', text: `A night security guard at Fredbear's Family Pizzeria did not return home on Friday. Police found the office doors jammed open and the hatch behind the guard's chair "pulled up from below." The pizzeria reopened the next morning.` },
  { night: 6, date: 'Hurricane Herald, November 2, 1987', headline: 'PIZZERIA TO CLOSE "FOR RENOVATIONS"', text: `Fredbear's Family Pizzeria will close at the end of the month. A former employee, who asked not to be named, said: "Don't let them tell you it was a costume. We all heard him laughing under the floor."` },
  { night: 7, date: 'Hurricane Herald, today', headline: 'FORMER NIGHT GUARD WALKS OUT AT DAWN', text: `A night guard was seen leaving the long-closed pizzeria on Route 9 at six in the morning, carrying a set of keys and a strobe lamp. What the guard did next is up to you.` },
  { night: 8, date: 'Hurricane Herald, the next week', headline: 'NEIGHBOURS REPORT SOUNDS FROM CLOSED PIZZERIA', text: `Residents near the Route 9 pizzeria describe "scraping inside the walls" and a low hum after midnight. The owners have hired a night guard again. Asked why, a spokesman said only: "Insurance."` },
  { night: 9, date: 'Hurricane Herald, undated', headline: 'THE LAST SHIFT', text: `A typed note was left on the office desk: "All three were awake. I made it to six. The doors are open. The music box is quiet. Whoever reads this: don't take the job."` },
]);

/** Night 4 flashback (shown once, before the first night 4 shift): [title, subtitle] per shot. */
export const FLASHBACK = Object.freeze([
  ['§61983', "Fredbear's Family Diner"],
  [' ', 'Every Saturday, the golden bear sang for the children.'],
  [' ', 'He knew every name. He never forgot a face.'],
  [' ', 'Then one birthday, the music stopped.'],
  ['§4SOMETHING BELOW', 'has woken up.'],
]);

/** Night 9 ending: [title, subtitle] per shot. */
export const NIGHT_NINE_ENDING = Object.freeze([
  ['§f6 AM', 'The music box in the old diner winds down for the last time.'],
  [' ', 'Three of them stand below. Every one of them turns to look at you.'],
  [' ', 'You walk out into the morning. Nobody follows. Not tonight.'],
  ['§lTHE END', 'You survived every night of FREDBEAR: SIX NIGHTS BELOW. Thank you for playing.'],
]);

export const ENDING = Object.freeze([
  '6 AM. The music box winds down mid-note.',
  'Below the office, something golden settles back into the dark of the old diner.',
  'You walk out through the front doors. The parking lot lights flicker, then hold.',
  'Behind you, the sign buzzes: FREDBEAR\'S FAMILY PIZZERIA.',
  'Six nights. You made it. He is still below.',
  'THE END - thank you for playing FREDBEAR: SIX NIGHTS BELOW.',
]);

/** Night 7 endings: the player's choice after surviving Fredbear's Revenge. */
export const FINAL_CHOICE = Object.freeze({
  question: 'Six AM. The keys to the whole building are in your hand, and the strobe still has a charge. What happens to this place?',
  seal: Object.freeze({
    button: 'SEAL IT FOREVER',
    lines: Object.freeze([
      ['§fSEALED', 'You chain the diner door and pour the last of the concrete over the crawlspace.'],
      [' ', 'The music box below plays one last note, then nothing.'],
      [' ', 'You lock the front doors behind you and hang the sign: CLOSED.'],
      [' ', 'He is still down there. He is still golden. And he is still waiting.'],
      ['§6THE END', 'Ending: SEALED.'],
    ]),
  }),
  burn: Object.freeze({
    button: 'BURN IT DOWN',
    lines: Object.freeze([
      ['§cFIRE', 'You splash fuel across the old diner floor and strike the match.'],
      [' ', 'The stage curtains go first. Then the posters. Then the golden fur.'],
      [' ', 'Somewhere in the smoke, a music box plays faster and faster... and stops.'],
      [' ', 'By sunrise, there is nothing left of Fredbear\'s but ash.'],
      ['§6THE END', 'Ending: ASHES.'],
    ]),
  }),
});

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
