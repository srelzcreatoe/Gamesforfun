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
export const CAST = Object.freeze(['mirehop', 'noxbriar', 'rustgrin', 'cat', 'purple_rat', 'top_hat_rat']);
export const CAST_NAMES = Object.freeze({
  mirehop: 'Mirehop', noxbriar: 'Noxbriar', rustgrin: 'Rustgrin', cat: 'the Cat', purple_rat: 'Purple Rat', top_hat_rat: 'the Ringmaster',
});

export const CONFIG = Object.freeze({
  clock: Object.freeze({ ticksPerHour: 1600, hours: 6 }), // 80 s per hour, 8 minutes per night

  power: Object.freeze({
    start: 100000,
    // passive drain per tick by night (FNAF-style: later nights drain faster even when idle)
    base: Object.freeze({ 0: 2, 1: 2, 2: 2.6, 3: 3, 4: 3.3, 5: 3.5, 6: 3.8, 7: 3.6 }),
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
    top_hat_rat: Object.freeze([0, 0, 0, 1, 1, 2]),
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
    }),
    rustgrin: Object.freeze({
      mo: 60, start: 'ST_R', side: 'R',
      walkSpeed: 0.12,
      route: Object.freeze(['ST_R', 'DIN_C', 'DIN_E', 'REST', 'KIT', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'NOOK']),
      repelTo: 'EH_N',
      enterAfter: 60, // ticks of the guard on the cameras (not on 4B) with the right door open
      laughChance: 0.7,
    }),
    cat: Object.freeze({
      mo: 100, start: 'CAB',
      lockAfterCams: (rng) => rng.int(16, 330), // after the monitor goes down she is frozen for 0.8-16.5 s (FNAF 1 style)
      waitAtStage3: (a) => Math.max(200, 600 - 15 * a), // ticks she waits behind the empty curtain before running anyway
      runSpeed: 0.42, // blocks per tick (a sprint)
      routes: Object.freeze({
        L: Object.freeze(['CAB_OUT', 'DIN_CAB', 'DIN_SW', 'WH_N', 'WH_M', 'WH_S', 'WC', 'DOOR_L']),
        R: Object.freeze(['CAB_OUT', 'DIN_CAB', 'DIN_SW', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'EC', 'DOOR_R']),
      }),
      eastFromNight: 4, eastChance: 0.4,
      bangReset: (rng) => rng.int(0, 1), // curtain stage after banging on a shut door
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
    }),
    top_hat_rat: Object.freeze({
      start: 'MW_T',
      tapeFull: 100000,
      drainAt20: 84, // units per tick at AI 20 (a full tape lasts ~60 s); scales linearly with AI
      windStep: 22000, // one PLAY SHOW press
      windCooldown: 8,
      rally: 30000, // under 30 % he rallies Purple Rat and the Cat
      rallyBonus: 3,
      recall: 60000, // rewinding above 60 % while he walks sends him back
      walkSpeed: 0.075, // slow, deliberate - ~25 s to the office
      routes: Object.freeze({
        L: Object.freeze(['MW_T', 'DIN_W', 'DIN_SW', 'WH_N', 'WH_M', 'WH_S', 'WC', 'DOOR_L']),
        R: Object.freeze(['MW_T', 'DIN_W', 'DIN_SW', 'DIN_SE', 'EH_N', 'EH_M', 'EH_S', 'EC', 'DOOR_R']),
      }),
      pointOfNoReturn: 'WC', // once at the corner (WC / EC) nothing stops him
    }),
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
    2: Object.freeze({ title: 'Night 2', ai: { mirehop: 5, noxbriar: 4, rustgrin: 0, cat: 2, purple_rat: 0, top_hat_rat: 0 }, activation: { mirehop: 400, noxbriar: 800, cat: 600 }, ramp: true, phone: 2, tape: false, hallucinations: 0 }),
    3: Object.freeze({ title: 'Night 3', ai: { mirehop: 7, noxbriar: 6, rustgrin: 1, cat: 5, purple_rat: 4, top_hat_rat: 0 }, activation: { purple_rat: 800, rustgrin: 1600 }, ramp: true, phone: 3, tape: false, hallucinations: 0.002 }),
    4: Object.freeze({ title: 'Night 4', ai: { mirehop: 8, noxbriar: 8, rustgrin: 3, cat: 7, purple_rat: 7, top_hat_rat: 5 }, activation: {}, ramp: true, phone: 4, tape: true, hallucinations: 0.004 }),
    5: Object.freeze({ title: 'Night 5', ai: { mirehop: 11, noxbriar: 11, rustgrin: 5, cat: 10, purple_rat: 10, top_hat_rat: 9 }, activation: {}, ramp: true, phone: 5, tape: true, hallucinations: 0.006 }),
    6: Object.freeze({ title: 'Night 6', ai: { mirehop: 14, noxbriar: 14, rustgrin: 9, cat: 13, purple_rat: 13, top_hat_rat: 12 }, activation: {}, ramp: true, phone: 6, tape: true, hallucinations: 0.012 }),
    7: Object.freeze({ title: 'Custom Night', ai: { mirehop: 5, noxbriar: 5, rustgrin: 5, cat: 5, purple_rat: 5, top_hat_rat: 5 }, activation: {}, ramp: false, phone: 0, tape: true, hallucinations: 0.004 }),
  }),

  // Custom Night presets (all 0..20).
  presets: Object.freeze([
    Object.freeze({ id: 'classic', title: 'Classic Five', ai: { mirehop: 5, noxbriar: 5, rustgrin: 5, cat: 5, purple_rat: 5, top_hat_rat: 5 } }),
    Object.freeze({ id: 'band_practice', title: 'Band Practice', ai: { mirehop: 15, noxbriar: 15, rustgrin: 15, cat: 0, purple_rat: 0, top_hat_rat: 0 } }),
    Object.freeze({ id: 'rat_race', title: 'Rat Race', ai: { mirehop: 0, noxbriar: 0, rustgrin: 0, cat: 10, purple_rat: 20, top_hat_rat: 20 } }),
    Object.freeze({ id: 'curtain_call', title: 'Curtain Call', ai: { mirehop: 10, noxbriar: 0, rustgrin: 0, cat: 20, purple_rat: 0, top_hat_rat: 10 } }),
    Object.freeze({ id: 'showstopper', title: 'SHOWSTOPPER (20/20/20/20/20/20)', ai: { mirehop: 20, noxbriar: 20, rustgrin: 20, cat: 20, purple_rat: 20, top_hat_rat: 20 } }),
  ]),

  hallucination: Object.freeze({ cooldown: 400 }),
  // Rare "Rusted Rustgrin" event: when the monitor goes down there is this chance (nights >= 2)
  // that a slumped, rusted Rustgrin sits in the office. Raise the monitor within `window` ticks.
  rusted: Object.freeze({ chance: 0.0008, window: 50, fromNight: 3 }),
});

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
