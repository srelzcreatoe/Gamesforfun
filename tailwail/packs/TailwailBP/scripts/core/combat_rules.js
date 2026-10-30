// The single authoritative damage rule.  Pure: no Minecraft imports.
// Tailwail's vanilla "minecraft:attack" is 0 and its only melee goal targets an
// invulnerable navigation lure, so the scripted strike below is the ONLY way it can
// hurt a player.  Each strike can land at most once.
import { CHASE } from "../config.js";

export function createStrikeState() {
  return { seq: 0, active: null, readyAt: 0 };
}

export function canStartStrike(s, t, hdist, dy, hasLos) {
  return !s.active && t >= s.readyAt && hdist <= CHASE.strikeRange && Math.abs(dy) <= CHASE.reachVertical && hasLos;
}

export function startStrike(s, t, impactAfter, duration) {
  s.seq += 1;
  s.active = { id: s.seq, impactAt: t + impactAfter, endAt: t + duration, landed: false, resolved: false };
  return s.active;
}

/**
 * Evaluates the impact frame.  geom: {hdist, dy, facingCos, los, targetValid}
 * Returns true exactly once per strike when every check passes.
 */
export function resolveImpact(s, t, geom) {
  const a = s.active;
  if (!a || a.resolved || t < a.impactAt) return false;
  a.resolved = true;
  const ok =
    geom.targetValid &&
    geom.los &&
    geom.hdist <= CHASE.reach &&
    Math.abs(geom.dy) <= CHASE.reachVertical &&
    geom.facingCos >= CHASE.reachArcCos;
  a.landed = ok;
  return ok;
}

export function finishStrike(s, t) {
  if (s.active && t >= s.active.endAt) {
    s.active = null;
    s.readyAt = t + CHASE.strikeCooldown;
    return true;
  }
  return false;
}

export function abortStrike(s, t) {
  if (s.active) {
    s.active = null;
    s.readyAt = t + CHASE.strikeCooldown;
  }
}
