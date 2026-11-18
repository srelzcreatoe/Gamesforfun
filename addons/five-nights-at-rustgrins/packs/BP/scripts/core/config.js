// FIVE NIGHTS AT RUSTGRIN'S - gameplay configuration (pure data).
//
// All durations are simulation ticks (20 per second). Server lag stretches
// wall-clock time but never the simulation: the clock, power and every AI
// advance once per processed tick.
//
// Power is fixed-point: 1000 units = 1 % (100 % = 100000).

export const TPS = 20;
export const LAST_NIGHT = 6;
export const CUSTOM_NIGHT = 7;
/** The secret night after the Final Act: the Rusted one takes Rustgrin's place. */
export const ENCORE_NIGHT = 8;
export const CAST = Object.freeze(['mirehop', 'noxbriar', 'rustgrin', 'cat', 'purple_rat', 'top_hat_rat']);
export const CAST_NAMES = Object.freeze({
  mirehop: 'Mirehop', noxbriar: 'Noxbriar', rustgrin: 'Rustgrin', cat: 'the Cat', purple_rat: 'Purple Rat', top_hat_rat: 'the Ringmaster',
});

export const CONFIG = Object.freeze({
  clock: Object.freeze({ ticksPerHour: 1600, hours: 6 }), // 80 s per hour, 8 minutes per night

  power: Object.freeze({
    start: 100000,
    // passive drain per tick by night (FNAF-style: later nights drain faster even when idle)
    base: Object.freeze({ 0: 2, 1: 2, 2: 2.6, 3: 3, 4: 3.3, 5: 4.0, 6: 2.6, 7: 2.0, 8: 2.6 }),
    door: 7, // per closed door, per tick (one door shut for an hour = 11.2 %)
    light: 5, // per lit hall light
    cams: 3, // monitor up
    vent: 5, // per closed vent cover
    catBang: Object.freeze({ first: 1000, step: 5000 }), // 1 %, then +5 % per bang (6 %, 11 %, ...)
  }),

  devices: Object.freeze({
    doorDebounce: 6,
    lightDebounce: 4,
    lightAutoOff: 0, // 0 = lights stay on until pressed again (FNAF 1 style: hold-to-light is emulated by toggling)
    camDebounce: 6,
    camSwitchDebounce: 3,
    ventDebounce: 8,
    doorAnimTicks: 6, // shutter slam duration
  }),

  // AI levels rise by these amounts at 2, 3 and 4 AM on nights >= 2 (index = hour).
  hourlyRamp: Object.freeze({
    mirehop: Object.freeze([0, 0, 1, 2, 3, 3]),
    noxbriar: Object.freeze([0, 0, 0, 1, 2, 2]),
    rustgrin: Object.freeze([0, 0, 0, 0, 1, 1]),
    cat: Object.freeze([0, 0, 1, 1, 2, 2]),
    purple_rat: Object.freeze([0, 0, 1, 1, 2, 2]),
    top_hat_rat: Object.freeze([0, 0, 0, 0, 0, 0]),
  }),

  characters: Object.freeze({
    mirehop: Object.freeze({
      mo: 100, start: 'ST_M', side: 'L',
      walkSpeed: 0.14, // blocks per tick while relocating (only seen through static)
      table: Object.freeze({
        ST_M: [['DIN_NW', 3], ['DIN_FRONT', 2]],
        DIN_FRONT: [['DIN_NW', 2], ['DIN_C', 1]],
        DIN_NW: [['BACK', 3], ['DIN_W', 2]],
        BACK: [['DIN_W', 2], ['DIN_NW', 1]],
        DIN_W: [['DIN_SW', 3], ['BACK', 1]],
        DIN_C: [['DIN_SW', 2], ['DIN_W', 1]],
        DIN_SW: [['WH_N', 1]],
        WH_N: [['WH_M', 2], ['SUP', 2]],
        WH_M: [['WH_S', 2], ['SUP', 1]],
        SUP: [['WH_S', 3], ['WH_N', 1]],
        WH_S: [['WC', 1]],
        WC: [['DOOR_L', 3], ['WH_S', 1]],
      }),
      door: 'DOOR_L', retreat: Object.freeze(['DIN_W', 'BACK', 'WH_N', 'DIN_NW']),
      hold: (a) => Math.max(60, 200 - 6 * a), // ticks he lingers at a shut door before giving up
      enterDelay: 30, // after he decides to come in, a moment before the office belongs to him
      // the smarter half (see door_stalker.js). Mirehop is erratic: odd hops, fake-outs, slipping away.
      erratic: 0.3, // chance a hunting step is a random hop instead of the planned one
      dash: 0.3, // while the guard is on the cameras, chance a hunting step is a quick double hop
      slip: true, // stared at too long on a camera, he slips out of the frame behind the static
      linger: (a) => Math.min(0.55, 0.15 + a * 0.025), // chance giving up at a shut door is a fake-out: he waits just out of the light
      lingerMax: 260, // ticks he lingers in the corner before leaving for real
      stalkMax: 240, // ticks he waits at the corner for a good moment before stepping in anyway
      eagerFor: 700, // ticks after being turned away that he hunts again sooner
      busyBonus: (a) => Math.round(a * 0.35), // entry-roll bonus while the guard is on the cameras
      wary: (a) => Math.max(40, 130 - 5 * a), // ticks after a light check on his side that he waits it out (bolder at higher AI)
      entryGrace: 70, // ticks from his arrival in the doorway (and its tell) to his first try at an open door
      // the knock: `after` ticks at the corner with no good moment in sight, he may rap on the wall
      // (bait for a light check: he steps in as that light goes off, within `window`).
      // `bold`: entry-roll bonus on his first try after a bait the guard took
      bait: Object.freeze({ kind: 'knock', fromAi: 5, after: 20, window: 200, cooldown: 500, bold: 4, chance: (a) => Math.min(0.9, 0.4 + a * 0.03) }),
    }),
    noxbriar: Object.freeze({
      mo: 100, start: 'ST_N', side: 'R',
      walkSpeed: 0.13,
      table: Object.freeze({
        ST_N: [['DIN_E', 3], ['DIN_FRONT', 1]],
        DIN_FRONT: [['DIN_C', 2], ['DIN_E', 2]],
        DIN_C: [['DIN_E', 2], ['DIN_SE', 1]],
        DIN_E: [['REST', 2], ['KIT', 3]],
        REST: [['KIT', 2], ['DIN_SE', 2]],
        KIT: [['DIN_SE', 3], ['REST', 1]],
        DIN_SE: [['EH_N', 1]],
        EH_N: [['EH_M', 1]],
        EH_M: [['EH_S', 3], ['EH_N', 1]],
        EH_S: [['EC', 1]],
        EC: [['WIN_R', 3], ['EH_S', 1]],
      }),
      door: 'WIN_R', retreat: Object.freeze(['DIN_E', 'KIT', 'REST', 'EH_N']),
      hold: (a) => Math.max(60, 200 - 6 * a),
      enterDelay: 30,
      kitchenHum: 0.6, // chance her humming plays from the kitchen when she arrives there
      // Noxbriar is patient and quiet: few odd hops, a long wait for the right moment, a soft hum.
      erratic: 0.06, dash: 0, slip: false,
      linger: (a) => Math.min(0.45, 0.05 + a * 0.025), lingerMax: 320, stalkMax: 360, eagerFor: 900,
      busyBonus: (a) => Math.round(a * 0.35), wary: (a) => Math.max(60, 170 - 6 * a), entryGrace: 70,
      hallHum: 0.55, // chance she hums softly as she comes down the East Hall
      // the thrown voice: a hum from the WRONG hall; if the guard lights that hall she steps up to her window
      bait: Object.freeze({ kind: 'decoy', fromAi: 6, after: 20, window: 200, cooldown: 600, bold: 4, chance: (a) => Math.min(0.9, 0.35 + a * 0.03) }),
    }),
    rustgrin: Object.freeze({
      mo: 60, start: 'ST_R', side: 'R',
      walkSpeed: 0.12,
      route: Object.freeze(['ST_R', 'DIN_C', 'DIN_E', 'REST', 'KIT', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'NOOK']),
      repelTo: 'EH_N',
      enterAfter: 60, // ticks of the guard on the cameras (not on 4B) with the right door open
      laughChance: 0.7,
      // camera-shy and patient (see rustgrin.js)
      blinkAfter: 40, // a stare at least this long...
      blinkChance: (a) => Math.min(0.75, a / 24), // ...and the moment the guard looks away he may move at once
      blinkCooldown: 500,
      hotStop: 0.55, // a route stop the guard watches this much is skipped when a darker way exists
      patience: (a) => Math.max(100, 400 - 25 * a), // after the door turns him away he waits this long before coming again
      litPatience: 200, // a right hall light on this long no longer keeps him out of the nook
      // the burnt feed: watched this many ticks in all (it fades at `fade` a tick while unwatched), his
      // microphone squeals through the monitor; still watched `warn` ticks later, that camera is dead for `lasts`
      burn: Object.freeze({ fromAi: 2, after: (a) => Math.max(140, 300 - 8 * a), warn: 50, lasts: (a) => 300 + 15 * a, cooldown: 900, fade: 0.5 }),
    }),
    cat: Object.freeze({
      // Dances on the Midway ring with the Purple Rat while the show tape plays. Stage 0 dancing,
      // 1 stopped and staring, 2 off the ring at its edge, 3 gone (about to sprint).
      mo: 100, start: 'MW_T',
      lockAfterCams: (rng) => rng.int(16, 330), // after the monitor goes down she is frozen for 0.8-16.5 s (FNAF 1 style)
      waitAtStage3: (a) => Math.max(200, 600 - 15 * a), // ticks she lurks out of sight before running anyway
      runSpeed: 0.42, // blocks per tick (a sprint)
      routes: Object.freeze({
        L: Object.freeze(['MW_EDGE', 'DIN_W', 'DIN_SW', 'WH_N', 'WH_M', 'WH_S', 'WC', 'DOOR_L']),
        R: Object.freeze(['MW_EDGE', 'DIN_W', 'DIN_SW', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'EC', 'DOOR_R']),
      }),
      eastFromNight: 4, eastChance: 0.4,
      bangReset: (rng) => rng.int(0, 1), // stage after banging on a shut door
      // at the tape deck: CAM 8 unwatched this long while she dances, she slips behind the curtain and
      // pulls the tape (it runs `drain` times as fast) until the guard rewinds it on CAM 8, watches
      // the empty ring for `stare` ticks, or `lasts` pass
      pull: Object.freeze({ fromAi: 4, ignored: (a) => Math.max(360, 800 - 20 * a), drain: 2.2, lasts: 360, stare: 40, cooldown: 900, tell: 100 }),
    }),
    purple_rat: Object.freeze({
      mo: 80, start: 'MW_P',
      crawlSpeed: 0.09, walkSpeed: 0.16,
      routes: Object.freeze({
        L: Object.freeze(['MW_P', 'MW_GRATE', 'WD_0', 'WD_1', 'WD_2', 'WD_3', 'WD_4', 'WD_5', 'WD_END']),
        R: Object.freeze(['MW_P', 'MW_GRATE', 'DIN_W', 'DIN_C', 'DIN_E', 'KIT', 'ED_0', 'ED_1', 'ED_2', 'ED_3', 'ED_4', 'ED_5', 'ED_END']),
      }),
      twitch: 0.15, // chance an opportunity sends him one node BACK instead
      grace: (a) => Math.max(70, 170 - 4 * a), // ticks at the vent before he drops in
      retreatIndex: 2, // after banging on a shut vent he crawls back to this index of his route
      nervousAfter: 50, // stared at this long in a duct, he squeaks and backs off a section
      turnedAway: 0.6, // each time a vent turned him away, that duct weighs this much less
      // playing dead: a move he held back while a duct camera was on him is spent as a bolt of up to
      // two sections at this many times his crawl speed, if the guard looks away before he squeaks
      burst: Object.freeze({ fromAi: 5, speed: 1.9 }),
    }),
    top_hat_rat: Object.freeze({
      // The Ringmaster. Nights 1-5: stands on his stage, the Grand Marquee (CAM 1C), and never moves.
      // Night 6 (the Final Act) is his; in the Custom Night he walks to the office all night.
      start: 'CAB',
      walkSpeed: 0.1,
      routes: Object.freeze({
        L: Object.freeze(['CAB', 'CAB_PEEK', 'CAB_OUT', 'DIN_CAB', 'DIN_SW', 'WH_N', 'WH_M', 'WH_S', 'WC', 'DOOR_L']),
        R: Object.freeze(['CAB', 'CAB_PEEK', 'CAB_OUT', 'DIN_CAB', 'DIN_SW', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'EC', 'DOOR_R']),
      }),
      // walking: pause at each spot. Custom Night by AI (AI 5: 36 s a spot, AI 20: 8.5 s);
      // the Final Act's Act III by hour (4 AM, 5 AM)
      pause: (a) => Math.max(170, 900 - 37 * a),
      finalPause: Object.freeze([200, 150]),
      doorGrace: 90, // ticks at the office door before he steps in (a spotlight from CAM 2B / 4B still works)
      vanishChance: 0.5, // leaving the booth, he skips straight to the dining room behind a burst of static
      // "Places!": from his booth (from this night on), once a night between these hours, he calls two of
      // the band back to the stage, holds them there, and sends them out again together (eager for a while)
      // (`keen`: AI steps keener while eager)
      places: Object.freeze({ fromNight: 3, hours: Object.freeze([1.6, 3.8]), hold: 180, eager: 900, keen: 3, retry: 100 }),
    }),
  }),

  // The troupe's show tape on CAM 8 (the Cat and the Purple Rat dance to it).
  tape: Object.freeze({
    full: 100000,
    drainAt20: 84, // units per tick at troupe AI 20 (a full tape lasts ~60 s); scales with the higher troupe AI
    minDrain: 18, // even a calm troupe winds the tape down (about 4.6 minutes from full)
    windStep: 22000, // one PLAY SHOW press
    windCooldown: 8,
    rally: 30000, // under 30 % the troupe grows bolder
    rallyBonus: 3,
    stopBonus: 7, // music stopped: the Purple Rat gets this much more, the Cat leaves the ring
    recall: 60000, // rewound above 60 %: the Cat (if she has not run yet) returns to the ring
  }),

  // Night 6, the Final Act: three acts of two hours each.
  finale: Object.freeze({
    takeoverHour: 4, // night 5 at 4 AM: the Ringmaster takes the night
    introTicks: 260, // PA introduction before the first event
    warn: 200, // the 10-second warning of every summon and game
    failWarn: 170, // a performer sent after a failed game arrives a little sooner
    summonGap: Object.freeze([380, 560]), // Act I: ticks between summons
    gameGap: Object.freeze([300, 440]), // Act II: ticks between events (mostly games, some summons)
    gameSummonChance: 0.25,
    lateSummonGap: Object.freeze([620, 900]), // Act III: performers still come now and then
    spotlightCost: 3000, // 3 % power per SPOTLIGHT that hits
    spotlightMissCost: 1500,
    spotlightCooldown: 50,
    blockedReturn: 40, // ticks before a turned-away performer is back on its stage
  }),

  // Power-out sequence (FNAF 1 style).
  powerOut: Object.freeze({
    songDelay: (rng) => rng.int(100, 400), // Rustgrin appears at the left doorway
    songLength: (rng) => rng.int(160, 400),
    darkLength: (rng) => rng.int(40, 200),
  }),

  // Nights. ai = level at 12 AM; activation = tick when the character starts thinking.
  nights: Object.freeze({
    0: Object.freeze({ title: 'Training', ai: { mirehop: 6, noxbriar: 0, rustgrin: 0, cat: 0, purple_rat: 0, top_hat_rat: 0 }, activation: { mirehop: 200 }, ticksPerHour: 300, ramp: false, phone: 0, tape: false, hallucinations: 0 }),
    1: Object.freeze({ title: 'Night 1', ai: { mirehop: 3, noxbriar: 2, rustgrin: 0, cat: 0, purple_rat: 0, top_hat_rat: 0 }, activation: { mirehop: 1000, noxbriar: 2400 }, ramp: true, phone: 1, tape: false, hallucinations: 0 }),
    2: Object.freeze({ title: 'Night 2', ai: { mirehop: 4, noxbriar: 3, rustgrin: 0, cat: 2, purple_rat: 0, top_hat_rat: 0 }, activation: { mirehop: 400, noxbriar: 800, cat: 600 }, ramp: true, phone: 2, tape: true, hallucinations: 0.001 }),
    3: Object.freeze({ title: 'Night 3', ai: { mirehop: 6, noxbriar: 5, rustgrin: 1, cat: 5, purple_rat: 4, top_hat_rat: 0 }, activation: { purple_rat: 800, rustgrin: 1600 }, ramp: true, phone: 3, tape: true, hallucinations: 0.002 }),
    4: Object.freeze({ title: 'Night 4', ai: { mirehop: 9, noxbriar: 9, rustgrin: 3, cat: 7, purple_rat: 7, top_hat_rat: 0 }, activation: {}, ramp: true, phone: 4, tape: true, hallucinations: 0.004 }),
    5: Object.freeze({ title: 'Night 5', ai: { mirehop: 17, noxbriar: 17, rustgrin: 8, cat: 14, purple_rat: 14, top_hat_rat: 0 }, activation: {}, ramp: true, phone: 5, tape: true, hallucinations: 0.006 }),
    // The Final Act: the Ringmaster runs the night; the others are his marionettes (they only move on his cue).
    6: Object.freeze({ title: 'The Final Act', ai: { mirehop: 0, noxbriar: 0, rustgrin: 0, cat: 0, purple_rat: 0, top_hat_rat: 20 }, activation: {}, ramp: false, phone: 0, tape: false, final: true, hallucinations: 0.006 }),
    7: Object.freeze({ title: 'Custom Night', ai: { mirehop: 5, noxbriar: 5, rustgrin: 5, cat: 5, purple_rat: 5, top_hat_rat: 5 }, activation: { top_hat_rat: 1200 }, ramp: false, phone: 0, tape: true, hallucinations: 0.004 }),
    // Encore: Rustgrin's place is taken by the Rusted one (same rules, worse company), and the
    // "he was never there" visits come far more often.
    8: Object.freeze({ title: 'Encore', ai: { mirehop: 9, noxbriar: 9, rustgrin: 8, cat: 8, purple_rat: 8, top_hat_rat: 0 }, activation: { purple_rat: 600 }, ramp: true, phone: 0, tape: true, hallucinations: 0.012, encore: true, rustedChance: 6 }),
  }),

  // Custom Night presets (all 0..20).
  presets: Object.freeze([
    Object.freeze({ id: 'classic', title: 'Classic Five', ai: { mirehop: 5, noxbriar: 5, rustgrin: 5, cat: 5, purple_rat: 5, top_hat_rat: 5 } }),
    Object.freeze({ id: 'band_practice', title: 'Band Practice', ai: { mirehop: 15, noxbriar: 15, rustgrin: 15, cat: 0, purple_rat: 0, top_hat_rat: 0 } }),
    Object.freeze({ id: 'rat_race', title: 'Rat Race', ai: { mirehop: 0, noxbriar: 0, rustgrin: 0, cat: 15, purple_rat: 20, top_hat_rat: 0 } }),
    Object.freeze({ id: 'curtain_call', title: 'Curtain Call', ai: { mirehop: 10, noxbriar: 10, rustgrin: 0, cat: 0, purple_rat: 0, top_hat_rat: 15 } }),
    Object.freeze({ id: 'showstopper', title: 'SHOWSTOPPER (20/20/20/20/20/20)', ai: { mirehop: 20, noxbriar: 20, rustgrin: 20, cat: 20, purple_rat: 20, top_hat_rat: 20 } }),
  ]),

  // What the animatronics notice about the guard (core/ai/guard_model.js) and how they plan
  // their way to the office (core/ai/graph.js: weighted shortest paths over the route graph).
  brain: Object.freeze({
    campWindow: 400, // ticks over which door / vent / monitor habits are averaged
    camp: 0.55, // a door (or vent) shut this much of the time counts as camped
    gapStart: 700, // assumed ticks between hall-light checks before any are seen
    gapAlpha: 0.35, // how fast the learned rhythm follows the guard's checks
    quietTicks: 60, // with no rhythm learnt yet, this long without a light check is a good moment
    afterCheck: 0.45, // a light check just ended: safe for this fraction of the usual gap...
    overdue: 1.6, // ...and again once the guard is this far past it (they stopped checking)
    heatTau: 600, // camera attention fades over ~30 s
    heatFull: 120, // attention that counts as "always watched"
    freezeMax: 160, // an opportunity won while watched waits this long for the guard to look away
    hearSteps: 30, // footsteps carry this many blocks from the office doors
    // path costs (in blocks of extra walking)
    watchedCost: 60, // a node on the live camera
    heatCost: 30, // x attention (0..1)
    litCost: 80, // a node within `lightReach` of a lit hall light
    lightReach: 12,
    crowdCost: 25, // another animatronic is standing there
    otherSideCost: 150, // the other half of the building
  }),

  // The director (core/ai/director.js): pressure by projected power, slots, spacing, pincer.
  director: Object.freeze({
    evalEvery: 100,
    judgeAfter: 0.12, // fraction of the night before the guard's power is judged
    cruise: Object.freeze([Object.freeze([0.45, 2]), Object.freeze([0.28, 1])]), // projected power at 6 AM -> bonus
    struggle: Object.freeze([Object.freeze([-0.1, -3]), Object.freeze([0.0, -2]), Object.freeze([0.1, -1])]),
    maxBonus: Object.freeze({ 1: 1, 2: 1, default: 2 }),
    minBonus: -3,
    closeCallWindow: 600, // close calls within this many ticks...
    closeCallsEase: 2, // ...this many of them, and the director eases off
    minGap: 50, // ticks between two strikes
    breather: 120, // ticks nobody strikes after a close call
    pincer: 2, // roll bonus for a side stalker while the other side is worked or camped
    // group tactics on the later nights (never on the training night or in the Final Act)
    tactics: Object.freeze({
      fromNight: 4,
      // a racket in a room the guard can only listen to (the kitchen, CAM 6): for `window` ticks it
      // covers a stalker's way down its hall and its step up to the door. The errand: the other
      // stalker, within `reach` blocks of that room while its partner is within `near` blocks of
      // its door, steps in there to make the noise
      clatter: Object.freeze({ window: 300, cooldown: 900, lead: 300, near: 30, reach: 30 }),
      // Mirehop and Noxbriar trade halls for one trip (once a night, both at this AI or more)
      trade: Object.freeze({ minAi: 13, hours: Object.freeze([1.4, 4.4]), lasts: 1800 }),
      duoGap: 140, // after the Ringmaster's "places!": the two he sent arrive at least this far apart
    }),
  }),

  // What they remember of the guard from one night of the week to the next (core/ai/memory.js).
  memory: Object.freeze({
    nights: Object.freeze([1, 2, 3, 4, 5]), // the week; night 1 always starts blank
    keep: 0.5, // each new night, everything before it counts half as much
    fullAfter: 3, // hours of a night that tell them all one night can (a night cut short tells less)
    maxNights: 3, // cap on how much they can know
    hours: 3, // tonight's beliefs fade over this many hours: after that, only what they see tonight
    maxChecks: 60, // cap on remembered light checks per hour
    minChecks: 2, // a hall counts as neglected only if the guard checks lights at all (per hour)
    neglect: 0.6, // ...and checks it (or seals that vent) this much less than the other
    minVent: 0.03, // a vent sealed at least this share of the night counts as used
    minGap: 100, // the shortest light rhythm they will believe (ticks)
    camp: 0.45, // a door shut this share of the night was camped
    monitor: 0.6, // the monitor up this share of the night: a camera watcher
    shy: 0.2, // ...or this little: a guard who hardly uses the cameras
    // the opener: the stalker whose hall is the soft one (or who caught the guard last time) heads
    // straight for its door, `keen` AI steps keener (x trust), until its first visit there
    keen: 4,
    grudgeKeen: 2, // (the one with a grudge is less keen than that: a death never makes the retry harder)
    probeOther: 0.1, // hunt chance the other stalker loses (x how soft, x trust): the pressure moves, it does not grow
    afterYou: 0.7, // ...and while the opener has not been to its door yet, the others hunt this much less (x trust)
    afterYouUntil: 0.4, // ...and do not step into a doorway at all while trust is above this (the first two hours or so)
    afterYouPause: 300, // ...nor for this long after the opener reached its door: one thing at a time
    sideBias: 0.8, // the Purple Rat's and the Cat's lean towards the soft vent / hall (x trust)
    watcher: 0.25, // against a camera watcher: Rustgrin's patience is this much shorter (x trust)
    ignoredCat: 0.4, // against a guard who hardly uses the cameras: the Cat goes for the tape deck this much sooner (x trust)
    ease: 1, // per death in a row the director takes this much off its pressure, and off the highest it may go...
    maxEase: 2, // ...at most this much
    maxDeaths: 3,
  }),

  // Small signs of life while they stand about (core/ai/liveliness.js): cosmetic effects only,
  // one every `every` ticks for the whole cast; a shuffle is this many blocks out and back.
  idle: Object.freeze({ first: 240, every: Object.freeze([150, 330]), shuffle: 1.3 }),

  hallucination: Object.freeze({ cooldown: 400 }),
  // Rare "Rusted Rustgrin" event: when the monitor goes down there is this chance (nights >= 2)
  // that a slumped, rusted Rustgrin sits in the office. Raise the monitor within `window` ticks.
  rusted: Object.freeze({ chance: 0.0008, window: 50, fromNight: 3 }),

  // Cheats and challenges (Extras), applied to any night as `mods`.
  mods: Object.freeze({
    fast: 0.5, // fast nights: hours this much shorter
    doorJam: 2, // door power multiplier
    tapeRot: 2, // show tape drain multiplier
  }),
});

/** Extras > Challenges: a fixed night (Custom Night rules) with one twist; beating it earns a trophy. */
export const CHALLENGES = Object.freeze([
  Object.freeze({ id: 'lights_out', title: 'Lights Out', text: 'The hall lights are broken. Listen for them.', mods: Object.freeze({ lightsOut: true }) }),
  Object.freeze({ id: 'tape_rot', title: 'Tape Rot', text: 'The show tape winds down twice as fast.', mods: Object.freeze({ tapeRot: true }) }),
  Object.freeze({ id: 'door_jam', title: 'Door Jam', text: 'The doors use twice the power.', mods: Object.freeze({ doorJam: true }) }),
  Object.freeze({ id: 'blind', title: 'Blind Spot', text: 'No camera map. Scroll through the cameras with the hotbar.', mods: Object.freeze({}), blind: true }),
]);
export const CHALLENGE_AI = Object.freeze({ mirehop: 10, noxbriar: 10, rustgrin: 6, cat: 10, purple_rat: 10, top_hat_rat: 0 });

/** Effective night definition with optional overrides (custom night / debug). */
export function nightDef(n, overrides = {}) {
  const base = CONFIG.nights[n];
  if (!base) throw new Error(`unknown night ${n}`);
  return {
    ...base,
    ...overrides,
    night: n,
    ai: { ...base.ai, ...(overrides.ai || {}) },
    activation: { ...base.activation, ...(overrides.activation || {}) },
    ticksPerHour: overrides.ticksPerHour ?? base.ticksPerHour ?? CONFIG.clock.ticksPerHour,
  };
}
