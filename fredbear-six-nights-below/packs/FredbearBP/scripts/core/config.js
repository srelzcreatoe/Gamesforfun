// FREDBEAR: SIX NIGHTS BELOW - gameplay configuration.
//
// All values are simulation ticks (nominal 20 ticks per second) unless noted.
// Server lag stretches wall-clock time but never changes the simulation:
// the night clock, power and AI all advance once per processed game tick.
//
// Power uses fixed-point integer arithmetic: 1000 units = 1 % (so 100 % =
// 100000). Every per-tick drain is an integer, so results are exact and
// reproducible across platforms.

export const TPS = 20;

export const CONFIG = Object.freeze({
  clock: Object.freeze({ ticksPerHour: 1600, hours: 6 }), // 9600 ticks = 8 min nominal

  power: Object.freeze({
    unitsPerPercent: 1000,
    start: 100000,
    // Baseline drain (units/tick) by night. 4 => 0.08 %/s => 38.4 % per 8-minute night.
    // 1.3: nights 5-6 drain 5 - fixing the "stuck at the door" bug had made them much easier
    // than 1.2 (the stuck animatronics kept doors shut and drained power; docs/05).
    baseDrain: Object.freeze({ 0: 3, 1: 3, 2: 4, 3: 4, 4: 4, 5: 5, 6: 5, 7: 4, 8: 3, 9: 3 }),
    door: 9, // per closed door, per tick (one door closed for a full hour = 14.4 %)
    light: 6, // per lit hall light, per tick
    cams: 3, // while the camera monitor is up
    hatch: 7, // while the office hatch is sealed
    strobeCost: 2000, // one-shot 2 %
    breakerResetCost: 1000, // one-shot 1 %
    reserveAmount: 8000, // emergency reserve restores 8 %
    reserveWindow: 100, // 5 s to pull the reserve lever at 0 %
    taskBonus: 5000, // completing a pre-shift power task starts the night at 105 %
  }),

  devices: Object.freeze({
    doorDebounce: 8,
    lightDebounce: 6,
    lightAutoOff: 100, // hall lights switch themselves off after 5 s
    camDebounce: 6,
    camSwitchDebounce: 4,
    hatchDebounce: 10,
    strobeCooldown: 200,
    breakerResetTicks: 40,
    jamTicks: 200,
  }),

  // Vent seals (office buttons): close Bonnie's / Morgrave's supply duct or the
  // crawlspace into the office subfloor for a while. Teleports are not stopped.
  seals: Object.freeze({ cost: 3000, duration: 400, cooldown: 300 }), // 3 % power, 20 s sealed, 15 s to recharge

  speeds: Object.freeze({ // blocks per tick
    walk: 0.085, stalk: 0.05, retreat: 0.11, vent: 0.08, crawl: 0.06, climb: 0.06,
    fredbearWalk: 0.1, fredbearCrawl: 0.08,
  }),

  // Hour ramps (nights >= 2): +1 aggression at 2 AM, 3 AM and 4 AM (cap 20).
  hourlyRamp: Object.freeze([0, 0, 1, 2, 3, 3]),

  director: Object.freeze({
    maxConcurrentEntries: 2,
    blackoutGrace: 60,
    maintenanceGrace: 200,
    noiseDecayTicks: 80, // noiseHeat -1 every 80 ticks
    doorUseDecayTicks: 600,
    camFocusDecay: 0.999,
  }),

  characters: Object.freeze({
    bonnie: Object.freeze({
      moInterval: 90, home: 'STAGE_B', primary: 'L',
      telegraph: (a) => Math.max(70, 150 - 4 * a),
      repelTicks: 40, holdMax: 60,
      recover: (a) => Math.max(240, 480 - 12 * a),
      flankMinAI: 5, ventMinAI: 6, agitateTicks: 60,
      partnerMinAI: 8, // double trouble: may join Chica at the right door
      teamworkMinAI: 8, teamworkChance: 0.4, teamworkCooldown: 2400, // bangs on the left door so Chica can sneak right
      retreatNodes: ['PA', 'DIN_W', 'BACK', 'PC'],
    }),
    chica: Object.freeze({
      // 1.3: she reached the office far less often than Bonnie (owner report, docs/04):
      // Bonnie's pace, shorter kitchen stops, closer retreats, and the kitchen only after some retreats.
      moInterval: 70, home: 'STAGE_C', primary: 'R', speedMult: 1.25,
      telegraph: (a) => Math.max(80, 160 - 4 * a),
      repelTicks: 40, holdMax: 60,
      recover: (a) => Math.max(200, 420 - 12 * a),
      linger: [60, 180], clatterEvery: [120, 180], kitchenFirst: 0.5, kitchenAfterRetreat: 0.25, // the kitchen recording's bursts last 3-6 s
      sabotageChance: (a) => a / 30, sabotageCooldown: 1200,
      partnerMinAI: 8, // double trouble: may join Bonnie or Freddy at the right door
      flankMinAI: 8, flankChance: 0.4, // like Bonnie: the left door when the right side is busy
      retreatNodes: ['DIN_E', 'PD', 'ES_M', 'EMP', 'DIN_SE'],
    }),
    freddy: Object.freeze({
      moInterval: 60, home: 'STAGE_F', primary: 'R',
      slipTicks: 40, // 2 s on cameras with the right door open => Freddy slips in
      patience: (a) => Math.max(120, 320 - 10 * a), // door open, player not on cams
      repelTicks: 100,
      ignoreBonusEvery: 600, ignoreBonusMax: 4,
      recover: (a) => Math.max(260, 540 - 12 * a),
      retreatNodes: ['EH_N', 'DIN_SE', 'RH'],
    }),
    fredbear: Object.freeze({
      moInterval: 60, home: 'CHAMBER_F',
      w1: (a) => Math.max(100, 180 - 4 * a), // telegraph: barrier must be closed by the end
      w2: (a) => Math.max(60, 100 - 2 * a), // forcing: strobe now repels
      w3: 60, // jammed-open final window: strobe still repels
      stunTicks: 40,
      relocateWarn: 40,
      holdMax: 200,
      yieldTicks: 40, // a door or the hatch held: he bows at the entry, then vanishes
      flickerNear: 40, // office lamp flicker interval while he is next to the office
      flickerClose: 16, // ... and while he is climbing / walking into an entry
    }),
    // Nights 8-9. Morgrave crawls through the vents and the crawlspace (ai/morgrave.js).
    morgrave: Object.freeze({
      moInterval: 80, home: 'M_HOME',
      telegraph: (a) => Math.max(50, 110 - 3 * a), // short: you should have heard him crawling
      repelTicks: 40,
      sealGiveUp: 160, // 8 s against a sealed duct or shaft and he gives up
      arrivalCueChance: 0.75, // a scratch at the door / hatch when he gets there (not always: watch CAM 17 / 18)
      recover: (a) => Math.max(240, 560 - 12 * a),
    }),
    // Nights 8-9. Valek steps through the dark halls and shows only his eyes (ai/valek.js).
    valek: Object.freeze({
      moInterval: 90, home: 'V_HOME',
      telegraph: (a) => Math.max(80, 170 - 4 * a), minWindow: 60,
      repelTicks: 60,
      vanishTicks: 200, // lit: gone for 10 s, then back - closer
      recover: (a) => Math.max(300, 600 - 12 * a),
      mimicChance: 0.5, humChance: 0.6,
    }),
  }),

  // Night table. ai = aggression (0..20) at 12 AM; activation = tick when the
  // character leaves its home node. Values follow the brief's starting table
  // and were then checked with tools/balance_sim.mjs (docs/05_NIGHTS_AND_BALANCE.md).
  nights: Object.freeze({
    0: Object.freeze({ // tutorial / vertical-slice test night (short, non-lethal option)
      title: 'Training Shift', ticksPerHour: 400,
      ai: { freddy: 0, bonnie: 10, chica: 0, fredbear: 0 },
      activation: { freddy: 99999, bonnie: 200, chica: 99999, fredbear: 99999 },
      ramp: false, strobeCharges: 2, reserve: false, maxSabotage: 0,
      fredbear: { phase: 0 }, events: [],
    }),
    1: Object.freeze({
      title: 'Night 1 — First Shift', mechanic: 'Doors, hall lights, cameras and power',
      ai: { freddy: 1, bonnie: 3, chica: 2, fredbear: 0 },
      activation: { freddy: 4800, bonnie: 400, chica: 1600, fredbear: 99999 },
      ramp: false, strobeCharges: 0, reserve: false, maxSabotage: 0,
      fredbear: { phase: 0 },
      events: [{ at: 4800, kind: 'foreshadow', id: 'cove_glint', cam: 'C04', node: 'COVE_STAGE', hold: 1600 }],
    }),
    2: Object.freeze({
      title: 'Night 2 — Kitchen Duty', mechanic: "Chica's breaker sabotage; Bonnie flanks",
      ai: { freddy: 4, bonnie: 5, chica: 4, fredbear: 0 },
      activation: { freddy: 3200, bonnie: 0, chica: 400, fredbear: 99999 },
      ramp: true, strobeCharges: 0, reserve: false, maxSabotage: 1,
      fredbear: { phase: 0 },
      events: [{ at: 6400, kind: 'foreshadow', id: 'diner_glimpse', cam: 'C16', node: 'DINER_STAGE', hold: 1600 }],
    }),
    3: Object.freeze({
      title: 'Night 3 — Generator Trouble', mechanic: 'Maintenance shortcuts, mid-night generator restart, emergency reserve',
      ai: { freddy: 7, bonnie: 8, chica: 7, fredbear: 0 },
      activation: { freddy: 1600, bonnie: 0, chica: 0, fredbear: 99999 },
      ramp: true, strobeCharges: 0, reserve: true, maxSabotage: 2,
      fredbear: { phase: 0 },
      events: [
        { at: 3200, kind: 'maintenance', task: 'generator' },
        { at: 7200, kind: 'foreshadow', id: 'its_me', cam: 'C07', node: 'WH_S', hold: 800 },
      ],
    }),
    4: Object.freeze({
      title: 'Night 4 — Something Below', mechanic: 'Fredbear wakes: office hatch, emergency strobe, camera disruption',
      ai: { freddy: 10, bonnie: 11, chica: 10, fredbear: 5 },
      activation: { freddy: 0, bonnie: 0, chica: 0, fredbear: 1600 },
      ramp: true, strobeCharges: 4, reserve: true, maxSabotage: 2,
      fredbear: { phase: 1, entries: ['H'], stir: 500, cooldown: 1400, maxAttempts: 2, powers: ['disrupt'] },
      events: [],
    }),
    5: Object.freeze({
      title: 'Night 5 — Golden Echoes', mechanic: 'Fredbear relocates, false camera events, local blackouts',
      ai: { freddy: 14, bonnie: 15, chica: 14, fredbear: 12 },
      activation: { freddy: 0, bonnie: 0, chica: 0, fredbear: 1200 },
      ramp: true, strobeCharges: 5, reserve: true, maxSabotage: 3,
      fredbear: { phase: 2, entries: ['H', 'L', 'R'], stir: 300, cooldown: 1100, maxAttempts: 3, powers: ['disrupt', 'false_cam', 'blackout', 'relocate'] },
      events: [{ at: 4800, kind: 'maintenance', task: 'electrical' }],
    }),
    6: Object.freeze({
      title: 'Night 6 — Six Nights Below', mechanic: "Fredbear's Golden Hour and the finale",
      ai: { freddy: 18, bonnie: 19, chica: 18, fredbear: 20 },
      activation: { freddy: 0, bonnie: 0, chica: 0, fredbear: 200 },
      ramp: true, strobeCharges: 6, reserve: true, maxSabotage: 3,
      fredbear: { phase: 3, entries: ['H', 'L', 'R'], stir: 200, cooldown: 900, maxAttempts: 4, powers: ['disrupt', 'false_cam', 'blackout', 'relocate'], finale: { atHour: 5, extraAttempts: 2, extraCharges: 2, cooldown: 500 } },
      events: [{ at: 8000, kind: 'finale' }],
    }),
    7: Object.freeze({
      title: "Night 7 — Fredbear's Revenge", mechanic: 'Only Fredbear, everywhere at once; the others are switched off in Parts & Service',
      ai: { freddy: 0, bonnie: 0, chica: 0, fredbear: 20 },
      activation: { freddy: 99999, bonnie: 99999, chica: 99999, fredbear: 200 },
      ramp: false, strobeCharges: 6, reserve: true, maxSabotage: 0, store: ['freddy', 'bonnie', 'chica'],
      fredbear: { phase: 3, entries: ['H', 'L', 'R'], stir: 200, cooldown: 700, maxAttempts: 7, powers: ['disrupt', 'false_cam', 'blackout', 'relocate'], omnipresent: true, hauntEvery: [180, 320] },
      events: [],
    }),
    // Night 8 depends on how night 7 ended (variants, chosen by the game from the save):
    // seal -> Morgrave crawls out of the walls; burn -> Valek walks out of the smoke.
    8: Object.freeze({
      title: 'Night 8 — Below the Walls', mechanic: 'A new animatronic, decided by your night 7 ending, joins the trio',
      ai: { freddy: 7, bonnie: 8, chica: 7, fredbear: 0, morgrave: 0, valek: 0 },
      activation: { freddy: 800, bonnie: 0, chica: 0, fredbear: 99999, morgrave: 99999, valek: 99999 },
      ramp: true, strobeCharges: 0, reserve: true, maxSabotage: 2, hatch: true, basementOpen: true,
      fredbear: { phase: 0 },
      events: [],
      variants: Object.freeze({
        seal: Object.freeze({ title: 'Night 8 — Walled In', mechanic: 'Morgrave crawls out of the walls: vents, the crawlspace and the hatch', ai: { morgrave: 13 }, activation: { morgrave: 600 } }),
        burn: Object.freeze({ title: 'Night 8 — Out of the Smoke', mechanic: 'Valek walks out of the smoke: only his eyes, only in the dark', ai: { valek: 15 }, activation: { valek: 600 } }),
      }),
    }),
    9: Object.freeze({
      title: 'Night 9 — Three Below', mechanic: 'Fredbear, Morgrave and Valek together; the others are switched off in Parts & Service',
      ai: { freddy: 0, bonnie: 0, chica: 0, fredbear: 16, morgrave: 13, valek: 13 },
      activation: { freddy: 99999, bonnie: 99999, chica: 99999, fredbear: 400, morgrave: 200, valek: 800 },
      ramp: false, strobeCharges: 6, reserve: true, maxSabotage: 0, hatch: true, basementOpen: true, store: ['freddy', 'bonnie', 'chica'],
      music: false, // no night music: only the building
      fredbear: { phase: 3, entries: ['H', 'L', 'R'], stir: 300, cooldown: 1000, maxAttempts: 5, powers: ['disrupt', 'false_cam', 'blackout', 'relocate'], omnipresent: true, hauntEvery: [220, 380] },
      events: [],
    }),
  }),

  // Challenge modes (unlocked after night 6). Each one is a normal 12-6 AM
  // night built on a base night with overrides, plus session modifiers
  // (NightSession options.mods). Each takes something away and gives
  // something back; tools/balance_sim.mjs checks they stay beatable.
  challenges: Object.freeze({
    no_doors: Object.freeze({
      title: 'No Doors', base: 4,
      text: 'The doors and the hatch are welded open. Keep a hall light on Bonnie, Chica or Freddy in the corner and they back off (Bonnie and Chica after 2 s, Freddy after 5 s). The strobe drives Fredbear off without closing anything.',
      overrides: { ai: { freddy: 5, bonnie: 6, chica: 5, fredbear: 4 }, strobeCharges: 4 },
      mods: { noDoors: true, strobeNoBarrier: true, lightAutoOff: 200 },
    }),
    fredbear_only: Object.freeze({
      title: 'Fredbear Only', base: 5,
      text: 'Just Fredbear, at night 5 strength, with every entry and his night 5 powers. A warm-up for night 7.',
      overrides: { ai: { freddy: 0, bonnie: 0, chica: 0, fredbear: 12 }, activation: { freddy: 99999, bonnie: 99999, chica: 99999, fredbear: 400 }, strobeCharges: 6, maxSabotage: 0, events: [], fredbear: { maxAttempts: 4 } },
      mods: {},
    }),
    double_drain: Object.freeze({
      title: 'Double Power Drain', base: 3,
      text: 'Doors, hall lights and the camera monitor use twice as much power. The emergency reserve gives 25 % instead of 8 %, and the animatronics are calmer than on night 3.',
      overrides: { ai: { freddy: 3, bonnie: 4, chica: 3, fredbear: 0 } },
      mods: { deviceDrainMult: 2, reserveAmount: 25000 },
    }),
    no_cams: Object.freeze({
      title: 'Broken Cameras', base: 3,
      text: 'The camera system is dead: no feeds at all. Footsteps are louder, captions are always on and the hall lights stay on twice as long. Freddy stays on the stage (he only hunts through the cameras).',
      overrides: { ai: { freddy: 0, bonnie: 8, chica: 7, fredbear: 0 }, activation: { freddy: 99999 } },
      mods: { noCams: true, loudSteps: true, lightAutoOff: 200, captions: true },
    }),
  }),

  // Shadow Fredbear: a rare black silhouette on the show stage (CAM 01/02).
  // Checked once per hour from 1 AM on nights 2+; watching it for `stareTicks`
  // in total drains `drain` power units and it vanishes.
  shadow: Object.freeze({ chancePerHour: 0.05, node: 'STAGE_FRONT', holdTicks: 600, stareTicks: 60, drain: 1000, fromNight: 2 }),

  // Fredbear power tuning by phase (1..3).
  fredbearPowers: Object.freeze({
    disrupt: Object.freeze({ duration: [0, 100, 120, 140], cooldown: [0, 900, 700, 600] }),
    false_cam: Object.freeze({ duration: [0, 0, 100, 100], cooldown: [0, 0, 900, 700] }),
    blackout: Object.freeze({ warn: 40, duration: [0, 0, 60, 80], cooldown: [0, 0, 1500, 1200], maxPerHour: 1 }),
    relocate: Object.freeze({ cooldown: [0, 0, 400, 300] }),
  }),
});

export const LAST_NIGHT = 9;
/** Nights whose trio are switched off in Parts & Service (rest pose 'dormant'). */
export const STORE_NIGHTS = Object.freeze(Object.keys(CONFIG.nights).map(Number).filter((n) => CONFIG.nights[n].store));

/** Night 8's variant (from the night 7 ending) as nightDef overrides. */
export function nightVariant(n, variant) {
  return CONFIG.nights[n]?.variants?.[variant] ?? {};
}
export const CHALLENGE_IDS = Object.freeze(Object.keys(CONFIG.challenges));

/** Effective night definition with optional overrides (debug/test/challenges). */
export function nightDef(n, overrides = {}) {
  const base = CONFIG.nights[n];
  if (!base) throw new Error(`Unknown night ${n}`);
  return {
    ...base,
    ...overrides,
    ai: { ...base.ai, ...(overrides.ai || {}) },
    activation: { ...base.activation, ...(overrides.activation || {}) },
    title: overrides.title ?? base.title,
    mechanic: overrides.mechanic ?? base.mechanic,
    fredbear: { ...base.fredbear, ...(overrides.fredbear || {}) },
    events: overrides.events ?? base.events,
    ticksPerHour: overrides.ticksPerHour ?? base.ticksPerHour ?? CONFIG.clock.ticksPerHour,
  };
}
