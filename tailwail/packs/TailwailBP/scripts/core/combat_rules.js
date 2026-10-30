// Contact rules: the grab and the fallback strike.  Pure: no Minecraft imports.
// Tailwail's vanilla "minecraft:attack" is 0 and its only melee goal targets an
// invulnerable navigation lure, so these scripted contacts are the ONLY way it can hurt
// a player.  Each strike resolves exactly once; a grab needs reach, sight and facing.
import { CHASE, CLIP } from "../config.js";

/** geom: {hdist, dy, facingCos, los, targetValid} measured by the adapter. */
export function inGrabReach(geom) {
  return !!geom && geom.targetValid && geom.los && geom.hdist <= CHASE.grabReach &&
    Math.abs(geom.dy) <= CHASE.grabReachVertical && geom.facingCos >= CHASE.grabFacingCos;
}

export function createStrikeState() {
  return { seq: 0, active: null, readyAt: 0 };
}

export function canStartStrike(s, t, geom) {
  return !s.active && t >= s.readyAt && !!geom && geom.targetValid && geom.los &&
    geom.hdist <= CHASE.strikeRange && Math.abs(geom.dy) <= CHASE.grabReachVertical;
}

export function startStrike(s, t) {
  s.seq += 1;
  s.active = { id: s.seq, impactAt: t + CLIP.strikeImpact, endAt: t + CLIP.strike, landed: false, resolved: false };
  return s.active;
}

/** Evaluates the impact frame; true exactly once per strike when every check passes. */
export function resolveImpact(s, t, geom) {
  const a = s.active;
  if (!a || a.resolved || t < a.impactAt) return false;
  a.resolved = true;
  const ok = !!geom && geom.targetValid && geom.los && geom.hdist <= CHASE.grabReach + 0.3 &&
    Math.abs(geom.dy) <= CHASE.grabReachVertical && geom.facingCos >= CHASE.grabFacingCos;
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

/** Struggle meter: presses of Jump while held.  Returns 0..1 progress. */
export function struggleProgress(presses, needed) {
  if (needed <= 0) return 1;
  return Math.max(0, Math.min(1, presses / needed));
}
