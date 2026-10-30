// Sound cue table and limiter.  Pure: no Minecraft imports.
// Sound ids map to RP sounds/sound_definitions.json (all custom, synthesized by
// tools/gen_audio.py).  Volumes are multiplied by the player's own volume preference.

export const CUES = {
  // stalking
  breath_far: { sound: "tailwail.breath", volume: 0.6, gap: 8, range: 30, caption: "Slow, wet breathing in the dark" },
  tail_scrape: { sound: "tailwail.tail_scrape", volume: 0.55, gap: 7, range: 26, caption: "Something drags across stone" },
  knock: { sound: "tailwail.knock", volume: 0.8, gap: 15, range: 30, caption: "Three knocks" },
  skitter: { sound: "tailwail.skitter", volume: 0.7, gap: 1.2, range: 28, caption: "Fast scrabbling limbs" },
  creak: { sound: "tailwail.creak", volume: 0.75, gap: 2, range: 26, caption: "Bones creak" },
  neck_crack: { sound: "tailwail.neck_crack", volume: 0.8, gap: 2.5, range: 28, caption: "A neck cracks, again and again" },
  jaw_crack: { sound: "tailwail.jaw", volume: 0.85, gap: 3, range: 28, caption: "A jaw unhinges" },
  click: { sound: "tailwail.click", volume: 0.7, gap: 2.2, range: 32, caption: "Throat clicking" },
  // commitment
  inhale: { sound: "tailwail.inhale", volume: 0.9, gap: 5, range: 40, caption: "A long inhale" },
  scream: { sound: "tailwail.scream", volume: 1.0, gap: 12, range: 80, caption: "THE WAIL" },
  scream_far: { sound: "tailwail.scream_far", volume: 1.0, gap: 20, range: 120, caption: "A scream, far away" },
  // pursuit
  screech: { sound: "tailwail.screech", volume: 0.9, gap: 2.5, range: 48, caption: "Screeching" },
  step_soft: { sound: "tailwail.step_soft", volume: 0.4, gap: 0.5, range: 20 },
  step_heavy: { sound: "tailwail.step_heavy", volume: 0.8, gap: 0.2, range: 40 },
  grab: { sound: "tailwail.grab", volume: 1.0, gap: 1, range: 32, caption: "It has you" },
  hold: { sound: "tailwail.hold", volume: 1.0, gap: 2, range: 24 },
  throw: { sound: "tailwail.throw", volume: 0.9, gap: 1, range: 24 },
  bite: { sound: "tailwail.bite", volume: 1.0, gap: 1, range: 24 },
  swipe: { sound: "tailwail.swipe", volume: 0.85, gap: 0.8, range: 24 },
  impact: { sound: "tailwail.impact", volume: 0.9, gap: 0.8, range: 24 },
  pain: { sound: "tailwail.pain", volume: 0.95, gap: 2, range: 40, caption: "A shriek of pain" },
  // search / leaving
  sniff: { sound: "tailwail.sniff", volume: 0.7, gap: 1.5, range: 22, caption: "Sniffing" },
  frustrated: { sound: "tailwail.frustrated", volume: 0.95, gap: 6, range: 56, caption: "An enraged howl" },
  retreat: { sound: "tailwail.retreat", volume: 0.5, gap: 15, range: 40, caption: "Something withdraws into the dark" },
  hurt: { sound: "tailwail.hurt", volume: 0.85, gap: 0.4, range: 32 },
  death: { sound: "tailwail.death", volume: 1.0, gap: 10, range: 64, caption: "It collapses" },
};

/** Per-encounter limiter: enforces each cue's minimum gap. */
export function createLimiter() {
  return { last: {} };
}

export function allow(lim, cue, t) {
  const c = CUES[cue];
  if (!c) return false;
  const last = lim.last[cue];
  if (last !== undefined && t - last < c.gap) return false;
  lim.last[cue] = t;
  return true;
}

/** Per-player rate cap across all encounters (prevents stacking when two are nearby). */
export function createPlayerBudget(perSecond) {
  return { perSecond, window: [] };
}

export function spend(budget, t) {
  budget.window = budget.window.filter((x) => t - x < 1);
  if (budget.window.length >= budget.perSecond) return false;
  budget.window.push(t);
  return true;
}
