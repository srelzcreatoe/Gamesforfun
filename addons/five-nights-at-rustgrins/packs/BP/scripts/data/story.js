// Story text: phone calls, newspaper clippings, endings and the shift guide.
// All writing is original to this project.

/** Phone messages played at the start of each night (shown as timed text with a muffled-voice sound). */
export const PHONE = Object.freeze({
  1: [
    "Hey hey! Welcome to Rustgrin's Pizza Revue. First night, huh? I'm the day manager. I'll keep this quick.",
    'The animatronics walk around at night. Servo thing. If they stand still too long, the joints seize up.',
    'Mirehop likes the WEST hall, Noxbriar the EAST. If one of them ends up at your door, SHUT it.',
    'Red button: the steel door. White button: the hall light. The light is the only way to see who is outside.',
    "The monitor shows the cameras. Everything costs power, and the budget's gone. When it hits zero, it's zero.",
    "Last thing - don't stare at the curtain in the dining room. Kitty's Cabaret is closed. Goodnight!",
  ],
  2: [
    "Night two! See? Easy money. About Kitty's Cabaret - the Cat gets restless if nobody checks on her.",
    'Look at CAM 1C every now and then. The longer you leave her alone, the further she comes out of the curtain.',
    "If she's gone, she runs. Fast. Check the West Hall and shut the LEFT door before she gets there.",
    'She bangs on it if it is shut. Each bang drains a bit more power. Better than the alternative.',
  ],
  3: [
    "Okay. Two things tonight. First: Purple Rat got into the crawl ducts again. Rats, right?",
    'You will HEAR him - the maracas. Left side or right side, getting closer. CAM 9 and CAM 10 show the ducts.',
    'When he is right above you, close that VENT. The vent buttons are on the remote. Open it again after he bangs on it.',
    'Second: Rustgrin. He only moves when nobody is watching him. If you hear mic feedback outside the right door...',
    'He is in the corner by your right door. Only CAM 4B can see him there. Keep that door SHUT while you use the cameras.',
  ],
  4: [
    "Hey. Uh. The Ringmaster. The rat in the top hat. His show runs off a tape deck in the Midway - CAM 8.",
    'The tape runs down. When the music slows down, open CAM 8 and hit PLAY SHOW until it is full again.',
    'If the music stops... he goes looking for an audience. Doors do not stop him. Nothing stops him.',
    'Rewind the tape before he reaches the corner by your door and he goes back. Keep. The show. Running.',
  ],
  5: [
    "...hello? Hey. Listen. Last night somebody rewound the show tape. From inside the Midway. It wasn't me.",
    "Corporate says the building closes at the end of the week. They're selling the animatronics. All of them.",
    'I think they know. Just... make it to six. Please.',
  ],
  6: [
    '...',
    '[static] ...show... must... go on...',
    '[a calliope plays somewhere on the line, very slowly]',
  ],
});

/** One clipping unlocks after each night survived (lobby board). */
export const CLIPPINGS = Object.freeze([
  { night: 1, date: 'Route 6 Courier, March 3, 1984', headline: "RUSTGRIN'S PIZZA REVUE OPENS", text: 'Families packed the new pizzeria on Route 6 to meet the Rusty Revue: Rustgrin the bear, Mirehop the rabbit and Noxbriar on backup vocals. "The kids would not leave," the owner laughed. "We had to turn the band off to close."' },
  { night: 2, date: 'Route 6 Courier, June 11, 1987', headline: 'TRAVELLING MIDWAY ACT FINDS A HOME', text: "Rustgrin's has bought the animatronic cast of Marvello's Midnight Midway, the travelling show that closed after an incident at a matinee. The Ringmaster, his partner and the dancing Cat will perform in a new circus corner and a curtained cabaret." },
  { night: 3, date: 'Route 6 Courier, February 2, 1989', headline: 'HEALTH INSPECTOR CITES PIZZERIA', text: 'An inspection noted "a persistent smell from the stage area" and "fluid leaking from the costume seams." Management blamed the ventilation ducts and promised repairs. Parents report the animatronics "look at the children too long."' },
  { night: 4, date: 'Route 6 Courier, August 19, 1990', headline: '"THE SHOW WOULD NOT STOP"', text: 'During a Saturday matinee the Ringmaster animatronic kept performing after the power to the Midway was cut. Staff said the show tape "rewound itself." The Midway was closed for the rest of the day. No injuries were reported.' },
  { night: 5, date: 'Route 6 Courier, October 30, 1991', headline: 'NIGHT GUARD LEAVES MID-SHIFT', text: 'A night guard at Rustgrin\'s walked off the job at 3 AM and has not returned calls. His car was found in the parking lot with the engine running. A note on the dashboard read: "the cat ran".' },
  { night: 6, date: 'Route 6 Courier, November 9, 1991', headline: "RUSTGRIN'S TO CLOSE FOR GOOD", text: 'The Route 6 pizzeria will close this weekend. The owners will sell the animatronics at auction. "They have been with us a long time," a spokesman said. "We hope they find a new audience."' },
]);

export const ENDINGS = Object.freeze({
  week: Object.freeze({
    title: 'PAYDAY',
    lines: Object.freeze([
      ["§f6 AM", 'Friday. You made it through the week.'],
      [' ', 'An envelope waits on the office desk.'],
      ['§aPAY TO THE ORDER OF', 'THE NIGHT GUARD - $120.50 - Five nights.'],
      [' ', 'Clipped to it: "One more shift? Night 6 pays overtime."'],
      ['§6THE END', 'Night 6 is now open.'],
    ]),
  }),
  overtime: Object.freeze({
    title: 'OVERTIME',
    lines: Object.freeze([
      ['§f6 AM', 'The music in the Midway winds down for the last time.'],
      [' ', 'On the stage, the band stands exactly where it should.'],
      [' ', 'Every head is turned towards the office.'],
      ['§aOVERTIME', '$0.50 - and a note: "Don\'t come back."'],
      ['§6THE END', 'The Custom Night is now open.'],
    ]),
  }),
  showstopper: Object.freeze({
    title: 'SHOWSTOPPER',
    lines: Object.freeze([
      ['§f6 AM', 'Silence. Then, from the dining room, applause.'],
      [' ', 'Six animatronics clap for you, slowly, in perfect time.'],
      ['§6SHOWSTOPPER', 'You beat 20/20/20/20/20/20. You were the show.'],
    ]),
  }),
});

/** Shift guide topics (lobby item and the remote). */
export const GUIDE = Object.freeze([
  ['Controls', 'In the office the walls have a RED door button and a WHITE light button on each side. Right-click / tap them.\nThe CRT monitor on the desk (or the Camera Tablet) raises the monitor. On the cameras: click a camera on the map, scroll the hotbar to step through them, and sneak (or LOWER) to put the monitor down.\nThe Office Remote opens every control in one menu, including the two ceiling VENTS.'],
  ['Power', 'Power drains all night. Every closed door, lit hall light, closed vent and the raised monitor uses more (see USAGE). At 0 % the doors open, the lights die... and someone comes to sing for you.'],
  ['Mirehop', 'The green rabbit. Comes down the WEST hall to the LEFT door. A guitar twang means he is there. Check with the left light and shut the left door until he leaves.'],
  ['Noxbriar', 'The black bear. Comes down the EAST hall to the RIGHT window. Soft humming means she is there. She is almost invisible on dark cameras - look for her eyes.'],
  ['Rustgrin', 'The grey bear. Moves only when nobody watches him on camera. When you hear mic feedback outside the RIGHT door he is in the corner nook - only CAM 4B sees him, the light never does. Keep the right door shut while you are on the cameras.'],
  ['The Cat', "Lives behind the curtain of Kitty's Cabaret (CAM 1C). Checking the cameras keeps her in. If she is gone she sprints down a hall - usually the West Hall (CAM 2A); shut that door. Each bang on a shut door costs more power."],
  ['Purple Rat', 'Lives in the crawl ducts above the ceilings. Listen for the maracas: left or right, getting closer. CAM 9 / CAM 10 show the ducts. Close that VENT when he is above you, open it after he bangs on it.'],
  ['The Ringmaster', 'His show tape (CAM 8) runs down. Press PLAY SHOW on CAM 8 to rewind it. When the music slows his troupe gets bolder. If it stops he walks to your office and NO door stops him - rewind the tape above 60 % before he reaches a hall corner.'],
  ['Custom Night', 'After night 6: set each animatronic from 0 to 20. Beat all six at 20 for the third star.'],
]);

export const TUTORIAL_HINTS = Object.freeze({
  1: 'Tip: check the hall lights (white buttons) every few seconds. Shut a door only while someone is there.',
  2: "Tip: glance at CAM 1C (Kitty's Cabaret) often - it keeps the Cat in.",
  3: 'Tip: maracas = Purple Rat in a duct. Close that VENT when the sound is right above you.',
  4: 'Tip: when the calliope slows down, open CAM 8 and press PLAY SHOW a few times.',
  5: 'Tip: mic feedback at the right door = Rustgrin in the corner. Right door shut before the cameras!',
  6: 'Tip: power is tight tonight. Open doors and vents as soon as the threat is gone.',
});
