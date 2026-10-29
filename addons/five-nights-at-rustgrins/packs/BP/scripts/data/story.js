// Story text: the Ringmaster's calls, the takeover, the Final Act's announcements,
// newspaper clippings, endings and the Shift Guide. All writing is original to this
// project. `{name}` is replaced with the guard's player name, `{cam}` / `{side}` with
// the camera or hall a line refers to.

/**
 * The Ringmaster calls the office every night (he replaced the day manager on the line).
 * Shown as timed lines with a crackling-line sound; the desk phone hangs up on him.
 */
export const CALLS = Object.freeze({
  1: [
    'Good evening, {name}. Yes, I know your name. It was written on the schedule in such a careful hand.',
    'I am the Ringmaster. Tonight I am also your host, your guide and the only voice on this line, so do listen.',
    'Your post is the office: two steel doors, two hall lights and one monitor. All of them drink from the same small cup of power.',
    'The red buttons drop the doors. The white ones light the halls, the only honest way to see who is standing outside.',
    'Mirehop wanders the West Hall and Noxbriar prefers the East. If either one waits at your door, close it and keep it closed until they lose interest.',
    "Don't keep a door shut for nothing, though. When the power runs out, every door opens by itself and the band comes in for an encore.",
    "That's all for opening night. I'll be in my booth, as always, watching the show.",
    'Break a leg, {name}.',
  ],
  2: [
    'A second night! Most guards never make it past the first. You are already one of my favourites.',
    'Tonight my troupe joins the program. The Cat and the Purple Rat perform together on the Midway ring, on CAM 8.',
    'Their music runs off an old tape deck beside the ring. It winds down over time, so press PLAY SHOW on CAM 8 to keep it turning.',
    'While the music plays, they dance. When it slows, they grow restless. When it stops... well. The Cat has very fast feet.',
    'Checking on her keeps her honest. If she ever leaves the ring, she will sprint down a hall. Close that door and let her bang on it.',
    'Each bang costs more power than the last. She has never been good at taking no for an answer.',
    'Enjoy the show, {name}.',
  ],
  3: [
    'Night three, the halfway mark. Strange, isn\'t it, how quickly a place like this starts to feel like home?',
    'A small confession: the Purple Rat has found the ventilation ducts again. Listen for his maracas above the ceiling.',
    'CAM 9 and CAM 10 show the ducts. When the rattling is right above your head, seal that vent with the button over the desk, and open it once he gives up.',
    'Then there is Rustgrin, our star. He will not move while anyone is watching him. Not a single step.',
    'When he reaches the nook outside your right door, his microphone will scream. Only CAM 4B can see that corner, so keep the right door shut while you are on the cameras.',
    "You may have noticed me in my booth on CAM 1C. I don't wander like the others. A ringmaster waits for his cue.",
    'Goodnight, {name}. Mind the feedback.',
  ],
  4: [
    "{name}, have you read the morning paper? 'Final Weekend. Everything Must Go.' They mean us. The band, the troupe, and me.",
    'An auction, they say. Lots one through six. As if a show could be packed into crates and sold by the pound.',
    'Your predecessor, Walter, left in the middle of a shift. He walked straight out to the lot and left the engine running. He left at intermission.',
    'Nobody leaves at intermission, {name}. It is terribly rude to the performers.',
    'Everyone is restless tonight. Watch the tape on CAM 8, watch the halls, watch the ducts. And if you ever find the old Rustgrin slumped in your office...',
    '...raise the monitor at once. He was never there, and he would very much like you to agree.',
    'Two more nights. Then the lights go down for good. Or do they?',
  ],
  5: [
    'The last night, {name}. The last one they will pay you for. Tomorrow, men with clipboards will take us apart bolt by bolt.',
    'I have hosted a thousand shows. Rain, fire, empty tents. Do you know what I have never done?',
    'I have never let the curtain fall before the finale.',
    'So listen carefully. Survive this night the way you have learned to: doors, lights, vents, the tape. All of it.',
    "And when the clock strikes four, don't be alarmed. That is simply when the real show begins.",
    'Places, everyone.',
  ],
});

/** Said at the start of a call if the guard hung up on the previous one. */
export const HUNG_UP = Object.freeze([
  'You hung up on me last night, {name}. I forgive you. The audience never forgets, but I forgive.',
  "Click. That's the sound you made last night. Let's try that conversation again, shall we?",
  'I do hope the line was simply bad last night. Hanging up on your host would be unthinkable.',
  'Once again from the top, since someone walked out of the last rehearsal.',
]);

/** Night 5, 4 AM: the fake ending, then the Ringmaster takes the night. [title, subtitle] steps. */
export const TAKEOVER = Object.freeze({
  fake: Object.freeze([
    ['§f6 AM', '§aNight 5 complete'],
    ['§aSHIFT COMPLETE', '§fFive nights. You made it, {name}.'],
    ['§7THANK YOU FOR PLAYING', '§8Five Nights at Rustgrin\'s'],
  ]),
  interrupt: Object.freeze([
    ['§4Leaving before the finale, {name}?', ''],
    ['§4No. No, no, no.', ''],
    ['§4There is no "thank you for playing."', '§4There is only the next act.'],
    ['§4The show is not over', '§4until I say it is over.'],
  ]),
  card: Object.freeze(['§l§4THE FINAL ACT', '§7Night 6']),
});

/** The Final Act (night 6): what the Ringmaster says over the PA. */
export const FINAL = Object.freeze({
  intro: Object.freeze([
    'Ladies and gentlemen... and {name}. Welcome to the Final Act.',
    'No tickets. No refunds. No exits.',
  ]),
  acts: Object.freeze({
    1: Object.freeze({
      card: Object.freeze(['§6ACT I', '§fMeet the Performers']),
      lines: Object.freeze(['I shall introduce each performer personally. You will have ten seconds to prepare a proper welcome.']),
    }),
    2: Object.freeze({
      card: Object.freeze(['§6ACT II', '§fAudience Participation']),
      lines: Object.freeze(['Every show needs a volunteer. Congratulations, {name}. Do exactly as I say.']),
    }),
    3: Object.freeze({
      card: Object.freeze(['§4ACT III', '§fThe Ringmaster']),
      lines: Object.freeze([
        'The finale. The Ringmaster performs alone.',
        "I'm coming to you now, {name}. Doors won't help. Find me on the cameras and hit me with the SPOTLIGHT.",
      ]),
    }),
  }),
  summon: Object.freeze({
    mirehop: Object.freeze([
      'Stage left! Mirehop, and a guitar that has never once been in tune!',
      'Mirehop has rehearsed a solo just for you. He is taking the West Hall.',
      'From the West Hall, all strings and no mercy: Mirehop!',
    ]),
    noxbriar: Object.freeze([
      'On your right, our sweetest voice: Noxbriar! She will sing at your window.',
      'Noxbriar hums only for the people she loves. Listen to your right.',
      'The East Hall belongs to Noxbriar tonight. Do let her in... or don\'t.',
    ]),
    rustgrin: Object.freeze([
      'The star of the Revue: Rustgrin! He would rather you didn\'t watch him walk.',
      'Rustgrin, everyone! He is heading for your right door. Mind the feedback.',
      'A legend needs no introduction. Rustgrin, on your right!',
    ]),
    cat: Object.freeze([
      'The fastest feet in the Midway: the Cat! Which hall will she pick?',
      'The Cat has never once missed her cue. Ten seconds, {name}.',
      'Here she comes! Listen for her bells and choose a door.',
    ]),
    purple_rat: Object.freeze([
      'From inside the walls themselves: the Purple Rat!',
      'Listen. Maracas, overhead. Which vent, {name}? Which vent?',
      'The Purple Rat is coming through the ducts. He does so love a tight squeeze.',
    ]),
  }),
  blocked: Object.freeze([
    'A locked door! How very rude. And how very wise.',
    'Turned away at the door. They will be back.',
    'Well played. The audience murmurs its approval.',
    'Denied! Oh, the crowd loves a little drama.',
  ]),
  games: Object.freeze({
    still: Object.freeze(['Not a sound. Not a twitch. Touch nothing for ten seconds.', 'Freeze! Hands off every button until I say so.']),
    cam: Object.freeze(['Show me CAM {cam}. I want to see what you see.', 'Quickly now: CAM {cam}, if you please.']),
    find: Object.freeze(['Can you find me, {name}? Look at my booth. CAM 1C.']),
    doors: Object.freeze(['Close both doors. Now.', 'Shut them both! Left and right!']),
    doors_open: Object.freeze(['Now open them again. Trust me.', 'Open both doors. Let the air in.']),
    light: Object.freeze(['Light the {side} hall for me.', 'Shine a light down the {side} hall. Someone wants to be seen.']),
    vents: Object.freeze(['Seal both vents. Something is crawling.', 'Close the vents! Both of them!']),
  }),
  success: Object.freeze(['Bravo!', 'Splendid. The audience adores you.', "Oh, you're good. You're very good.", 'Perfect. Just like rehearsal.']),
  fail: Object.freeze([
    "Tsk. A volunteer who won't volunteer. Let me send you some help.",
    "Wrong! Don't worry, someone is coming to show you how it's done.",
    'Too slow, {name}. Far too slow.',
  ]),
  step: Object.freeze({
    DIN_SW: Object.freeze(["I'm in the dining room now. Can you hear the cane?"]),
    WC: Object.freeze(['The corner, {name}. Right outside. Can you see me?']),
    EC: Object.freeze(['The corner, {name}. Right outside. Can you see me?']),
    DOOR_L: Object.freeze(['Knock, knock.', "I'm at your door, {name}."]),
    DOOR_R: Object.freeze(['Knock, knock.', "I'm at your door, {name}."]),
  }),
  spotlight: Object.freeze([
    'Ah, the spotlight! I take my bow... and one step back.',
    'Applause! Very well, I shall give you a moment.',
    'Blinding. Simply blinding.',
    'A star always bows to the light.',
  ]),
  miss: Object.freeze(['Nothing there, {name}. You are wasting the light.']),
  hour5: Object.freeze(['One more hour. The finale always runs long.']),
});

/** One clipping unlocks after each night survived (lobby board). */
export const CLIPPINGS = Object.freeze([
  { night: 1, date: 'Route 6 Courier, March 3, 1984', headline: "RUSTGRIN'S PIZZA REVUE OPENS ITS DOORS", text: 'The Rusty Revue played to a packed house on opening night: Rustgrin the bear, Mirehop on guitar and Noxbriar on harmonies. "The kids wouldn\'t leave," the owner laughed. "We had to unplug the band to close."' },
  { night: 2, date: 'Tri-County Ledger, May 14, 1986', headline: 'MIDWAY SHOWMAN MISSING AFTER MATINEE', text: 'Aurelio Marvello, owner of the travelling Midnight Midway, vanished during a Sunday matinee. Witnesses say his animatronic Ringmaster kept the show running for three days afterwards, to an empty tent.' },
  { night: 3, date: 'Route 6 Courier, June 11, 1987', headline: 'PIZZERIA BUYS FAMOUS MIDWAY TROUPE', text: 'Rustgrin\'s has bought the Ringmaster, the Purple Rat and the Cat from the Marvello estate. "They are beautifully made," the owner said. "The Ringmaster even greets the staff by name."' },
  { night: 4, date: 'Route 6 Courier, August 19, 1990', headline: 'THE SHOW THAT WOULD NOT STOP', text: 'During a Saturday matinee the Midway ring kept performing after its power was cut. Staff say the show tape "rewound by itself." The Ringmaster has since been moved to a private booth, "for maintenance."' },
  { night: 5, date: 'Route 6 Courier, October 30, 1991', headline: 'NIGHT GUARD WALKS OFF THE JOB', text: 'Walter Pruitt left his post at Rustgrin\'s at 3 AM and has not been seen since. His car was found in the lot with the engine running and a note on the dashboard: "he called me by my name."' },
  { night: 6, date: 'Route 6 Courier, November 11, 1991', headline: 'AUCTION CANCELLED: ANIMATRONICS MISSING', text: 'Bidders arrived at Rustgrin\'s on Saturday to find lots one through six gone from their crates. The building was locked from the inside. The only item recovered was a ticket stub that read ADMIT ONE - ENCORE.' },
]);

export const ENDINGS = Object.freeze({
  final_act: Object.freeze({
    title: 'THE FINAL ACT',
    lines: Object.freeze([
      ['§f6 AM', 'The house lights rise. The music stops mid-note.'],
      [' ', 'In the doorway, the Ringmaster lowers his cane... and bows.'],
      [' ', '"A full house. A perfect finale. Thank you, {name}."'],
      [' ', 'The curtain falls. When it lifts again, the booth is empty.'],
      ['§6THE END', 'On your desk: a single ticket. ADMIT ONE - ENCORE.'],
      ['§eENCORE', 'The Custom Night is now open.'],
    ]),
  }),
  encore: Object.freeze({
    title: 'ENCORE',
    lines: Object.freeze([
      ['§f6 AM', 'Applause rolls through the empty dining room.'],
      [' ', '"Again, {name}? You spoil me."'],
      ['§6ENCORE', 'The show goes on.'],
    ]),
  }),
  showstopper: Object.freeze({
    title: 'SHOWSTOPPER',
    lines: Object.freeze([
      ['§f6 AM', 'Silence. Then, from the dining room, applause.'],
      [' ', 'Six animatronics clap for you, slowly and in perfect time.'],
      [' ', '"No one has ever stopped my show before, {name}."'],
      ['§6SHOWSTOPPER', 'You beat 20/20/20/20/20/20. You were the show.'],
    ]),
  }),
});

/** Shift Guide topics (the Shift Guide item; the music switch is its own button). */
export const GUIDE = Object.freeze([
  ['Controls', 'You sit at the office desk. Each side wall has a RED door button and a WHITE light button. Right-click or tap them.\nClick the CRT monitor (or use the Camera Tablet in your hand) to raise the monitor. On the cameras, click a camera on the map; press LOWER or Esc to put the monitor down. Without the map: scroll the hotbar to change cameras, and sneak or use the tablet to lower.\nThe Office Remote opens every control in one menu, including the two ceiling VENTS.'],
  ['Power', 'Power drains all night. Every closed door, lit hall light, sealed vent and the raised monitor uses more (see USAGE). At 0 % the doors open, the lights die... and someone comes to sing for you.'],
  ['Mirehop', 'The green rabbit. He comes down the WEST hall to your LEFT door, and a guitar twang means he is there. Check with the left light, and keep the left door shut until he leaves.'],
  ['Noxbriar', 'The black bear. She comes down the EAST hall to your RIGHT window, and soft humming means she is there. On dark cameras you will mostly see her eyes.'],
  ['Rustgrin', 'The grey bear. He only moves while nobody watches him. Microphone feedback outside the RIGHT door means he is in the corner nook, which only CAM 4B can see. Keep the right door shut while you are on the cameras.'],
  ['The Cat', 'Dances on the Midway ring (CAM 8) while the show tape plays. When the music slows she gets restless; when it stops she leaves the ring. Checking CAM 8 holds her in place. If she runs, she sprints down a hall: shut that door. Each bang costs more power.'],
  ['Purple Rat', 'Shares the Midway ring with the Cat and loves the crawl ducts. Listen for his maracas above the ceiling, left or right. CAM 9 and CAM 10 show the ducts. Seal that VENT when he is right above you, and open it after he bangs on it.'],
  ['The Show Tape', 'The troupe dances to a tape deck on CAM 8. Press PLAY SHOW there to rewind it. Below 30 % the Cat and the Purple Rat grow bolder; at 0 % the music stops and both come for you. Rewind above 60 % to call the Cat back to the ring.'],
  ['The Ringmaster', 'He stands in his booth (CAM 1C, the old Kitty\'s Cabaret) and calls the office every night. He does not move. Not yet.'],
  ['The Final Act', 'Night 6 belongs to the Ringmaster. ACT I: he sends one performer at a time with a 10-second warning, so shut the right door or vent in time. ACT II: do what he asks before his timer runs out. ACT III: he walks to your office and no door stops him. Find him on a camera and press SPOTLIGHT to drive him back a step.'],
  ['Custom Night', 'After the Final Act: set each animatronic from 0 to 20. With the Ringmaster above 0, he walks to your office all night long; keep the SPOTLIGHT ready. Beat all six at 20 for the third star.'],
]);

/** Shown at the start of a night (hints on) and on the game-over screen. */
export const TUTORIAL_HINTS = Object.freeze({
  1: 'Tip: check the hall lights every few seconds. Shut a door only while someone is standing there.',
  2: 'Tip: keep the show tape on CAM 8 above 30 %, and glance at the Cat often.',
  3: 'Tip: maracas mean the Purple Rat is in a duct. Seal that VENT when the sound is right above you.',
  4: 'Tip: microphone feedback at the right door means Rustgrin. Shut the right door before you raise the monitor.',
  5: 'Tip: power is tight tonight. Open doors and vents as soon as the threat has gone.',
  6: 'Tip: listen to the Ringmaster. Every act starts with a 10-second warning.',
  7: 'Tip: rewind the tape early, and save power for the SPOTLIGHT.',
});

/** Game-over tips by who caught the guard. */
export const KILL_TIPS = Object.freeze({
  mirehop: 'Mirehop came through the LEFT door. Check the left light and shut the door while he is there.',
  noxbriar: 'Noxbriar came through the RIGHT side. Humming at the window means: shut the right door.',
  rustgrin: 'Rustgrin waits in the nook by the RIGHT door. Keep that door shut whenever you raise the monitor.',
  cat: 'The Cat sprinted to your door. Keep the show tape playing and shut the door of the hall she runs down.',
  purple_rat: 'The Purple Rat dropped through a vent. Seal the vent his maracas are rattling above.',
  top_hat_rat: 'Doors do not stop the Ringmaster. Find him on the cameras and press SPOTLIGHT.',
  rusted: 'He was never there. Raise the monitor the moment you see him.',
});
