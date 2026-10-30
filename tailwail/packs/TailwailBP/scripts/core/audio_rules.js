// Sound cue table and limiter.  Pure: no Minecraft imports.
// Sound ids map to RP sounds/sound_definitions.json (all custom, synthesized by
// tools/gen_audio_v2.py).  Volumes are multiplied by the player's own volume preference.

export const CUES = {
  // stalking
  breath_far: { sound: "tailwail.breath", volume: 0.8, gap: 8, range: 34, caption: "Slow, wet breathing in the dark" },
  breath_close: { sound: "tailwail.breath_behind", volume: 1.0, gap: 4, range: 16, caption: "Breathing, right there" },
  tail_scrape: { sound: "tailwail.tail_scrape", volume: 0.7, gap: 7, range: 30, caption: "Something drags across stone" },
  knock: { sound: "tailwail.knock", volume: 1.0, gap: 10, range: 34, caption: "Three knocks" },
  skitter: { sound: "tailwail.skitter", volume: 0.9, gap: 1.2, range: 34, caption: "Fast scrabbling limbs" },
  creak: { sound: "tailwail.creak", volume: 0.9, gap: 2, range: 30, caption: "Bones creak" },
  neck_crack: { sound: "tailwail.neck_crack", volume: 0.9, gap: 2.5, range: 30, caption: "A neck cracks, again and again" },
  jaw_crack: { sound: "tailwail.jaw", volume: 0.95, gap: 3, range: 30, caption: "A jaw unhinges" },
  click: { sound: "tailwail.click", volume: 0.9, gap: 1.8, range: 36, caption: "Throat clicking" },
  growl: { sound: "tailwail.growl", volume: 1.0, gap: 2.5, range: 40, caption: "A low growl" },
  // commitment
  inhale: { sound: "tailwail.inhale", volume: 1.0, gap: 5, range: 44, caption: "A long inhale" },
  scream: { sound: "tailwail.scream", volume: 1.0, gap: 10, range: 96, caption: "THE WAIL" },
  scream_far: { sound: "tailwail.scream_far", volume: 1.0, gap: 16, range: 128, caption: "A scream, far away" },
  scream_close: { sound: "tailwail.shriek", volume: 1.0, gap: 4, range: 64, caption: "A shriek, right on top of you" },
  roar: { sound: "tailwail.roar", volume: 1.0, gap: 3, range: 72, caption: "A roar" },
  // the hunt
  screech: { sound: "tailwail.screech", volume: 1.0, gap: 2.5, range: 56, caption: "Screeching" },
  step_soft: { sound: "tailwail.step_soft", volume: 0.6, gap: 0.5, range: 24 },
  step_heavy: { sound: "tailwail.step_heavy", volume: 1.0, gap: 0.15, range: 48 },
  swipe: { sound: "tailwail.swipe", volume: 1.0, gap: 0.5, range: 28 },
  impact: { sound: "tailwail.impact", volume: 1.0, gap: 0.3, range: 28 },
  slam_windup: { sound: "tailwail.grunt", volume: 1.0, gap: 2, range: 36 },
  slam: { sound: "tailwail.slam", volume: 1.0, gap: 1, range: 48, caption: "The ground shakes" },
  pounce: { sound: "tailwail.pounce", volume: 1.0, gap: 2, range: 40, caption: "It leaps" },
  thud: { sound: "tailwail.thud", volume: 1.0, gap: 1, range: 40, caption: "Something heavy lands" },
  climb: { sound: "tailwail.climb", volume: 1.0, gap: 1.5, range: 36, caption: "Claws on stone, climbing" },
  scrape: { sound: "tailwail.scrape", volume: 1.0, gap: 0.6, range: 24, caption: "Claws scraping for you" },
  door_bang: { sound: "tailwail.door_bang", volume: 1.0, gap: 0.3, range: 56, caption: "Something hammers the door" },
  grab: { sound: "tailwail.grab", volume: 1.0, gap: 1, range: 36, caption: "It has you" },
  hold: { sound: "tailwail.hold", volume: 1.0, gap: 2, range: 28 },
  throw: { sound: "tailwail.throw", volume: 1.0, gap: 1, range: 28 },
  bite_windup: { sound: "tailwail.jaw", volume: 1.0, gap: 1, range: 28 },
  bite: { sound: "tailwail.bite", volume: 1.0, gap: 1, range: 28 },
  pain: { sound: "tailwail.pain", volume: 1.0, gap: 2, range: 44, caption: "A shriek of pain" },
  scream_pain: { sound: "tailwail.scream_pain", volume: 1.0, gap: 4, range: 72, caption: "It screams and runs" },
  // search / leaving
  sniff: { sound: "tailwail.sniff", volume: 0.9, gap: 1.5, range: 26, caption: "Sniffing" },
  howl: { sound: "tailwail.frustrated", volume: 1.0, gap: 6, range: 64, caption: "An enraged howl" },
  retreat: { sound: "tailwail.retreat", volume: 0.7, gap: 15, range: 44, caption: "Something withdraws into the dark" },
  hurt: { sound: "tailwail.hurt", volume: 1.0, gap: 0.4, range: 36 },
  death: { sound: "tailwail.death", volume: 1.0, gap: 10, range: 72, caption: "It collapses" },
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
