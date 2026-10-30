// Encounter / presence scheduling and escalation.  Pure: no Minecraft imports.
//
// Waits are measured in ELIGIBLE seconds (time the player actually spends underground,
// or outside at night with surface encounters on).  Standing in a sunny field never
// counts down, and quitting and rejoining cannot skip a cooldown: the record is stored
// on the player.
import { ENCOUNTER, PRESENCE, STAGE } from "../config.js";

export const TPS = 20;

export function emptySchedule() {
  return {
    v: 2, wait: -1, presWait: -1, streak: 0, stage: 0, eligibleS: 0,
    presN: 0, encN: 0, escN: 0, deaths: 0, pres: {}, jr: 0, lastOutcome: "",
  };
}

const num = (x, d, lo, hi) => (Number.isFinite(+x) ? Math.max(lo, Math.min(hi, +x)) : d);

export function parseSchedule(json) {
  let r;
  try {
    r = JSON.parse(json);
  } catch {
    return emptySchedule();
  }
  if (!r || r.v !== 2) return emptySchedule();
  const s = emptySchedule();
  s.wait = num(r.wait, -1, -1, 1e6);
  s.presWait = num(r.presWait, -1, -1, 1e6);
  s.streak = num(r.streak, 0, 0, 10) | 0;
  s.stage = num(r.stage, 0, 0, 3) | 0;
  s.eligibleS = num(r.eligibleS, 0, 0, 1e7);
  s.presN = num(r.presN, 0, 0, 9999) | 0;
  s.encN = num(r.encN, 0, 0, 9999) | 0;
  s.escN = num(r.escN, 0, 0, 9999) | 0;
  s.deaths = num(r.deaths, 0, 0, 9999) | 0;
  s.jr = num(r.jr, 0, 0, 2 ** 30) | 0;
  s.lastOutcome = typeof r.lastOutcome === "string" ? r.lastOutcome.slice(0, 40) : "";
  if (r.pres && typeof r.pres === "object") {
    for (const [k, v] of Object.entries(r.pres)) if (typeof k === "string" && k.length < 24 && Number.isFinite(+v)) s.pres[k] = +v;
  }
  return s;
}

export function serializeSchedule(s) {
  return JSON.stringify(s);
}

/** Escalation stage from what the player has lived through.  Never goes down. */
export function computeStage(s) {
  let st = 0;
  if (s.presN >= STAGE.watchedAfterPresence || s.eligibleS >= STAGE.watchedAfterSeconds) st = 1;
  if (s.encN >= STAGE.huntedAfterEncounters) st = 2;
  if (s.encN >= STAGE.obsessedAfterEncounters || s.escN >= STAGE.obsessedAfterEscapes) st = 3;
  return Math.max(s.stage || 0, st);
}

/** First time the add-on sees this player: arm the first encounter and first presence. */
export function ensureFirst(s, settings, rng) {
  if (s.wait < 0) s.wait = rng.range(settings.firstMin, settings.firstMax);
  if (s.presWait < 0) s.presWait = rng.range(25, 55);
  return s;
}

/** Called each director check while the player is eligible. */
export function tickEligible(s, dt) {
  s.wait = Math.max(0, s.wait - dt);
  s.presWait = Math.max(0, s.presWait - dt);
  s.eligibleS = Math.min(1e7, s.eligibleS + dt);
  s.stage = computeStage(s);
  return s;
}

export function onPlayerDeath(s, settings) {
  s.deaths += 1;
  s.wait = Math.max(s.wait, settings.postDeathSeconds);
  s.presWait = Math.max(s.presWait, 60);
  return s;
}

/**
 * Cooldown after an encounter ends.  Randomised within the configured bounds, stretched
 * after pursuits and after a run of encounters (a genuine quiet period).
 */
export function onEncounterEnd(s, outcome, settings, rng) {
  const lo = Math.min(settings.cooldownMin, settings.cooldownMax);
  const hi = Math.max(settings.cooldownMin, settings.cooldownMax);
  let sec = rng.range(lo, hi);
  if (outcome === "escaped" || outcome === "caught") sec *= 1.15;
  if (outcome === "observed" || outcome === "hidden") sec *= 0.8;
  s.streak = (s.streak || 0) + 1;
  if (s.streak >= 3 && rng.chance(0.5)) {
    sec *= 1.5; // quiet stretch
    s.streak = 0;
  }
  if (outcome !== "aborted") s.encN += 1;
  if (outcome === "escaped" || outcome === "hidden") s.escN += 1;
  s.lastOutcome = outcome;
  s.wait = Math.max(s.wait, sec);
  s.presWait = Math.max(s.presWait, PRESENCE.minGapAfterEncounter);
  s.stage = computeStage(s);
  return s;
}

/** Seconds of eligible time until the next presence event. */
export function nextPresenceDelay(stage, settings, rng) {
  const [lo, hi] = PRESENCE.interval[Math.max(0, Math.min(3, stage))];
  const level = settings.presence | 0;
  const levelScale = level >= 3 ? 0.55 : level === 1 ? 1.8 : 1;
  return rng.range(lo, hi) * levelScale / Math.max(0.3, settings.presenceScale || 1);
}

export function onPresence(s, id, settings, rng) {
  s.presN += 1;
  s.pres[id] = s.eligibleS;
  s.presWait = nextPresenceDelay(s.stage, settings, rng);
  s.stage = computeStage(s);
  return s;
}

/**
 * Eligibility of a single player.  `p` is a plain snapshot built by the adapter.
 * Returns {ok, reason, kind}.  Every rejection reason is surfaced by /tailwail:debug status.
 */
export function eligibility(p, settings, world) {
  if (!settings.enabled) return { ok: false, reason: "disabled" };
  if (world.peaceful) return { ok: false, reason: "peaceful" };
  if (!p.survivalLike) return { ok: false, reason: "gamemode" };
  if (p.dimension !== "minecraft:overworld") return { ok: false, reason: "dimension" };
  if (!p.alive) return { ok: false, reason: "dead" };
  const cave = p.underground && settings.caveEncounters;
  const night = p.nightOutside && settings.surfaceEncounters;
  if (!cave && !night) return { ok: false, reason: "terrain" };
  return { ok: true, reason: cave ? "cave" : "night", kind: cave ? "cave" : "night" };
}

/** Extra conditions for starting a real encounter (presence events skip these). */
export function encounterBlockers(p, s, settings, world) {
  if (s.wait > 0) return "cooldown";
  if (p.health < ENCOUNTER.lowHealthDefer) return "low-health";
  if (p.sinceHurt < ENCOUNTER.recentHurtDefer) return "in-combat";
  if (p.inWater || p.riding || p.sleeping || p.flying) return "busy";
  if (world.activeNear) return "encounter-nearby";
  if (world.activeCount >= settings.maxConcurrent) return "global-cap";
  return null;
}

/** Per-check roll once everything allows a start. */
export function rollStart(settings, rng) {
  return rng.chance(Math.min(0.95, ENCOUNTER.checkChance * settings.frequency));
}

/**
 * Pick one target in a group: the player deepest in darkness who was not the most
 * recent victim, so groups share the experience fairly.
 */
export function pickGroupTarget(candidates) {
  const sorted = [...candidates].sort((a, b) => a.light - b.light || a.encN - b.encN);
  return sorted[0];
}
