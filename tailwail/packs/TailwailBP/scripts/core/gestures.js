// Gesture learning and delayed replay.  Pure: no Minecraft imports.
//
// The detector is fed ONLY with samples taken while Tailwail has line of sight to the
// target (the caller enforces this).  A gap in observation resets the transient timers,
// so nothing is learned through walls or across unloaded chunks.
import { IMITATION } from "../config.js";
import { distortion } from "./agitation.js";

export const GESTURES = ["crouch", "tilt", "step"];

export function createDetector() {
  return {
    lastT: -1,
    sneakSince: -1,
    crouchEmitted: false,
    pitchBase: null,
    tiltSince: -1,
    tiltEmitted: false,
    movingSince: -1,
    stoppedSince: -1,
    hadRun: false,
    stepEmitted: false,
  };
}

function resetTransient(d) {
  d.sneakSince = -1;
  d.crouchEmitted = false;
  d.tiltSince = -1;
  d.tiltEmitted = false;
  d.movingSince = -1;
  d.stoppedSince = -1;
  d.hadRun = false;
  d.stepEmitted = false;
}

/**
 * @param {ReturnType<typeof createDetector>} d
 * @param {{sneaking:boolean, pitch:number, speed:number}} s  sample of the target
 * @param {number} t seconds
 * @returns {null | {type:string, t:number, pitch?:number}}
 */
export function observe(d, s, t) {
  const C = IMITATION;
  if (d.lastT >= 0 && t - d.lastT > 0.75) resetTransient(d); // lost sight -> cannot infer the gap
  d.lastT = t;
  let out = null;

  // crouch
  if (s.sneaking) {
    if (d.sneakSince < 0) d.sneakSince = t;
    if (!d.crouchEmitted && t - d.sneakSince >= C.crouchMinHold) {
      d.crouchEmitted = true;
      out = { type: "crouch", t };
    }
  } else {
    d.sneakSince = -1;
    d.crouchEmitted = false;
  }

  // head tilt: a held pitch well away from the player's recent baseline
  if (d.pitchBase === null) d.pitchBase = s.pitch;
  const off = s.pitch - d.pitchBase;
  if (Math.abs(off) >= C.tiltDegrees) {
    if (d.tiltSince < 0) d.tiltSince = t;
    if (!d.tiltEmitted && t - d.tiltSince >= C.tiltHold && !out) {
      d.tiltEmitted = true;
      out = { type: "tilt", t, pitch: s.pitch };
    }
  } else {
    d.tiltSince = -1;
    d.tiltEmitted = false;
    d.pitchBase += (s.pitch - d.pitchBase) * 0.05; // slow baseline, only while not tilting
  }

  // stop-start: a run that ends in a deliberate stop
  if (s.speed > C.moveSpeed) {
    if (d.movingSince < 0) d.movingSince = t;
    if (t - d.movingSince >= C.movingFor) d.hadRun = true;
    d.stoppedSince = -1;
    d.stepEmitted = false;
  } else if (s.speed < C.stopSpeed) {
    d.movingSince = -1;
    if (d.stoppedSince < 0) d.stoppedSince = t;
    if (d.hadRun && !d.stepEmitted && t - d.stoppedSince >= C.stoppedFor && !out) {
      d.stepEmitted = true;
      d.hadRun = false;
      out = { type: "step", t };
    }
  }
  return out;
}

export function createImitator() {
  return { queue: [], active: null, cooldownUntil: 0, lastType: null, count: 0 };
}

/** Builds the replay record; distortion grows with agitation (deeper, farther, longer). */
export function replayFor(type, at, agit, rng, pitch = 0) {
  const d = distortion(agit);
  const hold = Math.min(IMITATION.holdMax * 1.8, rng.range(IMITATION.holdMin, IMITATION.holdMax) * (1 + 0.8 * d));
  let amt = 1;
  if (type === "crouch") amt = Math.min(1.6, 1 + 0.6 * d);
  if (type === "tilt") amt = Math.min(1.4, 1 + 0.4 * d);
  if (type === "shrug") amt = Math.min(1.5, 0.8 + 0.7 * d);
  return { type, at, until: at + hold, amt, pitch: Math.max(-45, Math.min(45, pitch)), distorted: d > 0.5 };
}

/**
 * Offer an observed gesture.  Returns the scheduled replay or null.
 * chance is the world "imitation frequency" setting.
 */
export function offer(im, gesture, t, agit, rng, chance) {
  if (t < im.cooldownUntil || im.queue.length > 0 || im.active) return null;
  if (!rng.chance(chance)) return null;
  const delay = rng.range(IMITATION.delayMin, IMITATION.delayMax);
  const r = replayFor(gesture.type, t + delay, agit, rng, gesture.pitch || 0);
  im.queue.push(r);
  // a distorted stop-start is followed by shoulders hiked past rest
  if (gesture.type === "step" && r.distorted) im.queue.push(replayFor("shrug", r.until + 0.2, agit, rng));
  return r;
}

/** Schedule a remembered gesture directly (signature "it remembers you" opener). */
export function schedule(im, type, at, agit, rng, pitch = 0) {
  im.queue = [replayFor(type, at, agit, rng, pitch)];
  im.active = null;
  return im.queue[0];
}

/** Advance; returns the visual to show: {mimic, amt, pitch}. */
export function updateImitator(im, t) {
  if (im.active && t >= im.active.until) {
    im.lastType = im.active.type;
    im.active = null;
    im.cooldownUntil = t + IMITATION.cooldown;
  }
  if (!im.active && im.queue.length && t >= im.queue[0].at) {
    im.active = im.queue.shift();
    im.count++;
  }
  if (!im.active) return { mimic: "none", amt: 0, pitch: 0 };
  return { mimic: im.active.type, amt: im.active.amt, pitch: im.active.pitch };
}

export function cancelImitation(im) {
  im.queue = [];
  im.active = null;
}
