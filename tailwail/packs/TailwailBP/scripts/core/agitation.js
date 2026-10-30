// Agitation model (0..100) for the stand-off.  Pure: no Minecraft imports.
//
// Only the locked target's behaviour feeds the model, so several observers never
// multiply it.  Hits from any player add a fixed burst (rate-limited), which is the
// one way bystanders can influence it.
import { AGITATION } from "../config.js";

export function createAgitation(initial = 0) {
  return {
    value: initial,
    grace: AGITATION.grace, // free-gaze budget; refills slowly while unwatched
    sprinting: false,
    sinceHit: 99,
  };
}

/**
 * @param {ReturnType<typeof createAgitation>} a  mutable state
 * @param {{watched:boolean, distance:number, closing:number, sprinting:boolean,
 *          hits:number, movingAway:boolean}} input
 * @param {number} dt seconds
 * @param {number} scale preset multiplier for increases (decay is never scaled down)
 * @returns {{value:number, delta:number, reasons:string[]}}
 */
export function stepAgitation(a, input, dt, scale = 1) {
  const C = AGITATION;
  const before = a.value;
  const reasons = [];
  let up = 0;
  let down = 0;

  if (input.watched) {
    if (a.grace > 0) {
      a.grace = Math.max(0, a.grace - dt);
    } else {
      up += C.stareRate * dt;
      reasons.push("stare");
    }
  } else {
    a.grace = Math.min(C.grace, a.grace + C.graceRefill * dt);
  }

  if (input.distance < C.closeDistance) {
    up += (C.closeDistance - input.distance) * C.closeRate * dt;
    reasons.push("close");
  }
  if (input.closing > C.approachSpeed && input.distance < C.approachRange) {
    up += C.approachRate * dt;
    reasons.push("approach");
  }

  const sprintNear = input.sprinting && input.distance < C.sprintRange;
  if (sprintNear && !a.sprinting) {
    up += C.sprintBurst;
    reasons.push("sprint-start");
  } else if (sprintNear) {
    up += C.sprintRate * dt;
    reasons.push("sprint");
  }
  a.sprinting = sprintNear;

  a.sinceHit += dt;
  if (input.hits > 0 && a.sinceHit >= C.hitCooldown) {
    up += C.hitBurst;
    a.sinceHit = 0;
    reasons.push("hit");
  }

  const calm = input.movingAway && !input.sprinting && input.distance > C.calmRange && !(input.watched && a.grace <= 0);
  if (calm) {
    down += C.calmDecay * dt;
    reasons.push("calm-retreat");
  } else {
    up += C.drift * dt;
  }

  a.value = Math.max(0, Math.min(C.max, a.value + up * scale - down));
  return { value: a.value, delta: a.value - before, reasons };
}

/** Cue level shown through posture/audio: 1 calm, 2 agitated. 3 is reserved for commitment. */
export function cueLevel(value) {
  return value >= AGITATION.cueTwo ? 2 : 1;
}

/** 0..1 distortion applied to imitation once agitation passes cue two. */
export function distortion(value) {
  return Math.max(0, Math.min(1, (value - 35) / 65));
}
