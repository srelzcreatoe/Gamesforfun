// Sound cue table and limiter.  Pure: no Minecraft imports.
// Sound ids map to RP sounds/sound_definitions.json.  Volumes are pre-multiplied by the
// player's own volume preference at playback time.

export const CUES = {
  breath_far: { sound: "tailwail.breath", volume: 0.55, gap: 10, range: 30, caption: "Slow breathing in the dark" },
  tail_scrape: { sound: "tailwail.tail_scrape", volume: 0.5, gap: 9, range: 26, caption: "Something drags across stone" },
  nail_scrape: { sound: "tailwail.nail_scrape", volume: 0.6, gap: 25, range: 28, caption: "Fingernails on rock" },
  step_soft: { sound: "tailwail.step_soft", volume: 0.35, gap: 0.6, range: 20 },
  throat_click: { sound: "tailwail.click", volume: 0.7, gap: 2.5, range: 32, caption: "Throat clicking" },
  inhale: { sound: "tailwail.inhale", volume: 0.85, gap: 6, range: 40, caption: "A deep, sharp inhale" },
  wail: { sound: "tailwail.wail", volume: 1.0, gap: 20, range: 72, caption: "THE WAIL", once: true },
  exertion: { sound: "tailwail.exertion", volume: 0.8, gap: 2.0, range: 40 },
  step_heavy: { sound: "tailwail.step_heavy", volume: 0.75, gap: 0.22, range: 40 },
  swipe: { sound: "tailwail.swipe", volume: 0.85, gap: 0.8, range: 24 },
  impact: { sound: "tailwail.impact", volume: 0.9, gap: 0.8, range: 24 },
  snarl: { sound: "tailwail.snarl", volume: 0.75, gap: 4, range: 40, caption: "A frustrated snarl" },
  retreat: { sound: "tailwail.retreat", volume: 0.5, gap: 20, range: 40, caption: "Something withdraws into the dark" },
  hurt: { sound: "tailwail.hurt", volume: 0.8, gap: 0.4, range: 32 },
  death: { sound: "tailwail.death", volume: 1.0, gap: 10, range: 64, caption: "Tailwail collapses" },
};

/** Per-encounter limiter: enforces each cue's minimum gap and one-shot cues. */
export function createLimiter() {
  return { last: {}, onceUsed: {} };
}

export function allow(lim, cue, t) {
  const c = CUES[cue];
  if (!c) return false;
  if (c.once && lim.onceUsed[cue]) return false;
  const last = lim.last[cue];
  if (last !== undefined && t - last < c.gap) return false;
  lim.last[cue] = t;
  if (c.once) lim.onceUsed[cue] = true;
  return true;
}

/** Re-arms a one-shot cue for a new, genuine commitment. */
export function rearm(lim, cue) {
  delete lim.onceUsed[cue];
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
