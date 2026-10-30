// Contact rules: which attack, whether it lands, and how the grab struggle is set up.
// Pure: no Minecraft imports.  Tailwail's vanilla "minecraft:attack" is 0 and its only
// melee goal targets an invulnerable navigation lure, so these scripted contacts are the
// ONLY way it can hurt a player.  Every hit is resolved exactly once, at a frame of the
// clip that shows it (core/ids.js SHOT), and needs reach, sight and facing.
import { CHASE, GRAB } from "../config.js";

/** geom: {hdist, dy, facingCos, los, targetValid} measured by the adapter. */
export function inGrabReach(geom) {
  return !!geom && geom.targetValid && geom.los && geom.hdist <= CHASE.grabReach &&
    Math.abs(geom.dy) <= CHASE.grabReachVertical && geom.facingCos >= CHASE.grabFacingCos;
}

/** Reach of each attack at its impact frame: [horizontal, vertical, minimum facing cos]. */
export const HIT_REACH = {
  swipe_r: [3.7, 2.8, 0.2],
  swipe_l: [3.7, 2.8, 0.2],
  combo: [3.6, 2.8, 0.2],
  slam: [4.2, 3.0, -1], // shockwave: all round
  pounce: [CHASE.pounceHitRange, 2.6, -1],
  reach: [2.6, 1.6, 0.3],
};

export function hitLands(kind, geom) {
  const r = HIT_REACH[kind];
  if (!r || !geom || !geom.targetValid || !geom.los) return false;
  return geom.hdist <= r[0] && Math.abs(geom.dy) <= r[1] && geom.facingCos >= r[2];
}

export function createCooldowns() {
  return { swipe: 0, slam: 0, pounce: 0, grab: 0, roar: 0 };
}

/**
 * Picks the next attack, or null.  o: {t, geom, settings, rng, cd, headroom, canGrab, tunnel}
 * Ranges overlap on purpose: up close it may rake, combo, slam or grab; at mid range it
 * pounces.  Nothing here is a fixed pattern.
 */
export function chooseAttack(o) {
  const g = o.geom;
  if (!g || !g.targetValid || !g.los) return null;
  const t = o.t;
  const cd = o.cd;
  const vOk = Math.abs(g.dy) <= CHASE.grabReachVertical;
  const facing = g.facingCos >= 0.2;
  if (vOk && facing && o.canGrab && t >= cd.grab && inGrabReach(g) && o.rng.chance(CHASE.grabChance)) return "grab";
  if (vOk && !o.tunnel && o.headroom >= 6 && t >= cd.slam && g.hdist <= CHASE.slamRange && o.rng.chance(CHASE.slamChance)) return "slam";
  if (vOk && facing && t >= cd.swipe && g.hdist <= CHASE.swipeRange) {
    if (o.rng.chance(CHASE.comboChance)) return "combo";
    return o.rng.chance(0.5) ? "swipe_r" : "swipe_l";
  }
  if (!o.tunnel && o.headroom >= 3 && t >= cd.pounce && g.hdist >= CHASE.pounceMin && g.hdist <= CHASE.pounceMax &&
      g.dy > -2 && g.dy < 3 && o.rng.chance(CHASE.pounceChance)) return "pounce";
  return null;
}

/** Puts the attack on cooldown (seconds from t). */
export function spendAttack(cd, kind, t, rng) {
  if (kind === "grab") cd.grab = t + CHASE.grabCooldown;
  else if (kind === "slam") cd.slam = t + CHASE.slamCooldown;
  else if (kind === "pounce") cd.pounce = t + CHASE.pounceCooldown;
  // every attack also delays the next rake a little, so it never machine-guns
  cd.swipe = Math.max(cd.swipe, t + CHASE.swipeCooldown + (rng ? rng.range(0, 0.5) : 0.25));
}

/**
 * How this grab's struggle works.  Deliberately inconsistent: the input, the number of
 * presses and the time allowed change every time, the grip can shift halfway through,
 * and sometimes there is no way out at all.
 * @returns {{kind:string, needed:number, window:number, shiftAt:number|null, shiftTo:string|null, inescapable:boolean}}
 */
export function struggleSpec(settings, rng, grabsSoFar) {
  const kinds = Object.entries(GRAB.kinds);
  let kind = rng.weighted(kinds);
  const lo = Math.max(1, settings.struggleMin | 0);
  const hi = Math.max(lo, settings.struggleMax | 0);
  let needed = rng.int(lo, hi);
  let window = rng.range(GRAB.window[0], GRAB.window[1]);
  if (kind === "alternate") needed = Math.max(4, Math.round(needed * 0.8));
  if (kind === "still") window = rng.range(GRAB.stillWindow[0], GRAB.stillWindow[1]);
  // the very first grab of an encounter is always escapable, and never "still"
  if (grabsSoFar === 0 && kind === "still") kind = "jump";
  const inescapable = grabsSoFar > 0 && rng.chance(settings.inescapable || 0);
  let shiftAt = null;
  let shiftTo = null;
  if (!inescapable && kind !== "still" && rng.chance(GRAB.gripShiftChance)) {
    shiftAt = window * rng.range(0.35, 0.55);
    shiftTo = kind === "sneak" ? "jump" : kind === "jump" ? "sneak" : "jump";
    window += 0.8; // a beat to read the new prompt
  }
  return { kind, needed, window, shiftAt, shiftTo, inescapable };
}

/** Struggle meter 0..1. */
export function struggleProgress(presses, needed) {
  if (needed <= 0) return 1;
  return Math.max(0, Math.min(1, presses / needed));
}

/** What it does when the struggle fails. */
export function pickFinisher(rng, headroom) {
  // the throw and the smash lift you overhead (~5.5 blocks): they need the room
  const opts = [["bite", 3]];
  if (headroom >= 6) opts.push(["throw", 3], ["smash", 3]);
  return rng.weighted(opts);
}
