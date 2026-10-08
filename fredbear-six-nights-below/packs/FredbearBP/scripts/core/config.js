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
    baseDrain: Object.freeze({ 0: 3, 1: 3, 2: 4, 3: 4, 4: 4, 5: 4, 6: 4 }),
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
      retreatNodes: ['PA', 'DIN_W', 'BACK', 'PC'],
    }),
    chica: Object.freeze({
      moInterval: 100, home: 'STAGE_C', primary: 'R',
      telegraph: (a) => Math.max(80, 160 - 4 * a),
      repelTicks: 40, holdMax: 60,
      recover: (a) => Math.max(260, 520 - 12 * a),
      linger: [200, 600], clatterEvery: [60, 140],
      sabotageChance: (a) => a / 40, sabotageCooldown: 1200,
      retreatNodes: ['KIT', 'DIN_E', 'PAN'],
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
      ramp: true, strobeCharges: 3, reserve: true, maxSabotage: 2,
      fredbear: { phase: 1, entries: ['H'], stir: 500, cooldown: 1400, maxAttempts: 2, powers: ['disrupt'] },
      events: [],
    }),
    5: Object.freeze({
      title: 'Night 5 — Golden Echoes', mechanic: 'Fredbear relocates, false camera events, local blackouts',
      ai: { freddy: 14, bonnie: 15, chica: 14, fredbear: 12 },
      activation: { freddy: 0, bonnie: 0, chica: 0, fredbear: 1200 },
      ramp: true, strobeCharges: 3, reserve: true, maxSabotage: 3,
      fredbear: { phase: 2, entries: ['H', 'L', 'R'], stir: 300, cooldown: 1100, maxAttempts: 3, powers: ['disrupt', 'false_cam', 'blackout', 'relocate'] },
      events: [{ at: 4800, kind: 'maintenance', task: 'electrical' }],
    }),
    6: Object.freeze({
      title: 'Night 6 — Six Nights Below', mechanic: "Fredbear's Golden Hour and the finale",
      ai: { freddy: 18, bonnie: 19, chica: 18, fredbear: 20 },
      activation: { freddy: 0, bonnie: 0, chica: 0, fredbear: 200 },
      ramp: true, strobeCharges: 4, reserve: true, maxSabotage: 3,
      fredbear: { phase: 3, entries: ['H', 'L', 'R'], stir: 200, cooldown: 900, maxAttempts: 4, powers: ['disrupt', 'false_cam', 'blackout', 'relocate'], finale: { atHour: 5, extraAttempts: 2, extraCharges: 2, cooldown: 500 } },
      events: [{ at: 8000, kind: 'finale' }],
    }),
  }),

  // Fredbear power tuning by phase (1..3).
  fredbearPowers: Object.freeze({
    disrupt: Object.freeze({ duration: [0, 100, 120, 140], cooldown: [0, 900, 700, 600] }),
    false_cam: Object.freeze({ duration: [0, 0, 100, 100], cooldown: [0, 0, 900, 700] }),
    blackout: Object.freeze({ warn: 40, duration: [0, 0, 60, 80], cooldown: [0, 0, 1500, 1200], maxPerHour: 1 }),
    relocate: Object.freeze({ cooldown: [0, 0, 400, 300] }),
  }),
});

/** Effective night definition with optional overrides (debug/test). */
export function nightDef(n, overrides = {}) {
  const base = CONFIG.nights[n];
  if (!base) throw new Error(`Unknown night ${n}`);
  return {
    ...base,
    ...overrides,
    ai: { ...base.ai, ...(overrides.ai || {}) },
    activation: { ...base.activation, ...(overrides.activation || {}) },
    fredbear: { ...base.fredbear, ...(overrides.fredbear || {}) },
    events: overrides.events ?? base.events,
    ticksPerHour: overrides.ticksPerHour ?? base.ticksPerHour ?? CONFIG.clock.ticksPerHour,
  };
}
