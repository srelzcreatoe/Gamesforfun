// Encounter scheduling rules.  Pure: no Minecraft imports.
// Times are world ticks (from world.getAbsoluteTime()), which persist with the save,
// so quitting and reloading cannot skip a cooldown.
import { ENCOUNTER } from "../config.js";

export const TPS = 20;

export function emptySchedule() {
  return { v: 1, nextAt: -1, lastEnd: -1, lastDeath: -1, streak: 0 };
}

export function parseSchedule(json) {
  try {
    const r = JSON.parse(json);
    if (r && r.v === 1) {
      return {
        v: 1,
        nextAt: Number.isFinite(r.nextAt) ? r.nextAt : -1,
        lastEnd: Number.isFinite(r.lastEnd) ? r.lastEnd : -1,
        lastDeath: Number.isFinite(r.lastDeath) ? r.lastDeath : -1,
        streak: Math.max(0, Math.min(10, r.streak | 0)),
      };
    }
  } catch {
    /* fall through */
  }
  return emptySchedule();
}

/** First time the add-on sees this player: start the initial grace period. */
export function ensureGrace(s, now, settings) {
  if (s.nextAt < 0) s.nextAt = now + settings.graceSeconds * TPS;
  return s;
}

export function onPlayerDeath(s, now, settings) {
  s.lastDeath = now;
  s.nextAt = Math.max(s.nextAt, now + settings.postDeathSeconds * TPS);
  return s;
}

/**
 * Cooldown after an encounter ends.  Randomised within the configured bounds, stretched
 * after pursuits and after a run of encounters (a genuine quiet period).
 */
export function onEncounterEnd(s, now, outcome, settings, rng) {
  const lo = Math.min(settings.cooldownMin, settings.cooldownMax);
  const hi = Math.max(settings.cooldownMin, settings.cooldownMax);
  let sec = rng.range(lo, hi);
  if (outcome === "escaped" || outcome === "caught") sec *= 1.2;
  if (outcome === "observed") sec *= 0.85;
  s.streak = (s.streak || 0) + 1;
  if (s.streak >= 3 && rng.chance(0.6)) {
    sec *= 1.6; // quiet stretch
    s.streak = 0;
  }
  s.lastEnd = now;
  s.nextAt = Math.max(s.nextAt, now + Math.round(sec * TPS));
  return s;
}

/**
 * Eligibility of a single player.  `p` is a plain snapshot built by the adapter.
 * Returns {ok, reason}.  Every rejection reason is surfaced by /tailwail:debug status.
 */
export function eligibility(p, s, now, settings, world) {
  if (!settings.enabled) return { ok: false, reason: "disabled" };
  if (world.peaceful) return { ok: false, reason: "peaceful" };
  if (!p.survivalLike) return { ok: false, reason: "gamemode" };
  if (p.dimension !== "minecraft:overworld") return { ok: false, reason: "dimension" };
  if (!p.alive) return { ok: false, reason: "dead" };
  if (now < s.nextAt) return { ok: false, reason: "cooldown" };
  if (p.health < ENCOUNTER.lowHealthDefer) return { ok: false, reason: "low-health" };
  if (p.sinceHurt < ENCOUNTER.recentHurtDefer) return { ok: false, reason: "in-combat" };
  if (p.inWater || p.riding || p.sleeping || p.flying) return { ok: false, reason: "busy" };
  if (world.activeNear) return { ok: false, reason: "encounter-nearby" };
  if (world.activeCount >= settings.maxConcurrent) return { ok: false, reason: "global-cap" };
  const cave = p.underground && settings.caveEncounters;
  const woods = p.nightWoodland && settings.surfaceEncounters;
  if (!cave && !woods) return { ok: false, reason: "terrain" };
  return { ok: true, reason: cave ? "cave" : "woodland" };
}

/** Per-check roll once eligible. Average wait at frequency 1 is ~45 s of eligible play. */
export function rollStart(settings, rng) {
  return rng.chance(Math.min(0.9, ENCOUNTER.checkChance * settings.frequency));
}

/**
 * Pick one target in a group: the player deepest in darkness who is not already the
 * most recent victim, so groups share the experience fairly.
 */
export function pickGroupTarget(candidates) {
  const sorted = [...candidates].sort((a, b) => a.light - b.light || a.lastEncAt - b.lastEncAt);
  return sorted[0];
}
