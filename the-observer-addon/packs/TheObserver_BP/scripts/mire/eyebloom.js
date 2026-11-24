// @ts-check
// The Eyebloom (1.5.1; the Rift's since 1.7.0): a plant three blocks tall — a black-green stalk with drooping,
// red-veined leaves, and for a flower a single eye in a halo of dark petals. The eye is never still (its texture is a
// flipbook: it looks about, it blinks, its pupil widens). And here:
//   * its eye follows you, every step: its head turns to any of 16 headings and tilts up or down to you (1.7.0; before,
//     it only turned in quarter turns, and only while you were not looking at it);
//   * stare at one from close by and it shuts its eye, and opens it again once you look away;
//   * they weep: dark red drops fall from the eye, and red spores drift up from it;
//   * break any part of one and the whole plant comes down (the eye may leave a spider eye behind).
// They grow in the Rift now (tools/rift_world.py puts them in its ground and its gardens); the Mire grows no new ones,
// but those already grown there still watch. A block can only be turned in quarter turns, so the turning is done in
// its model: tools/eyebloom_aim.py, states wmire:aimed (false = as placed), wmire:aim (a heading) and wmire:tilt.
import { system, BlockVolume } from "@minecraft/server";
import { PARTICLES } from "../core/constants.js";
import { V, safe, emit, allPlayers, DEBUG } from "../core/util.js";

/** @typedef {import("@minecraft/server").Player} Player */
/** @typedef {import("@minecraft/server").Dimension} Dimension */
/** @typedef {{x:number,y:number,z:number}} Vec */

export const HEAD = "wmire:eyebloom";
export const STALK = "wmire:eyebloom_stalk";
const PARTS = new Set([HEAD, STALK]);
/** Its own state (not one of the vanilla states the typings know). */
const SHUT = /** @type {any} */ ("wmire:shut");

/** Break one part and the rest of that plant comes down with it. @param {Dimension} dim @param {Vec} l */
export function fell(dim, l) {
  let n = 0;
  for (const dir of [1, -1]) {
    for (let k = 1; k <= 2; k++) {
      const y = l.y + dir * k;
      const b = safe(() => dim.getBlock({ x: l.x, y, z: l.z }));
      if (!b || !PARTS.has(b.typeId)) break;
      if (safe(() => dim.runCommand(`setblock ${l.x} ${y} ${l.z} air destroy`))) n++;
    }
  }
  emit("eyebloom", { what: "fell", n, x: l.x, y: l.y, z: l.z });
  return n;
}

const component = {
  /** @param {import("@minecraft/server").BlockComponentPlayerBreakEvent} ev */
  onPlayerBreak(ev) {
    const l = ev.block.location;
    const dim = ev.dimension;
    system.run(() => fell(dim, { x: l.x, y: l.y, z: l.z }));
  },
};

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent("wmire:eyebloom", component);
});

/** Its states (its own, not ones the typings know). */
const AIMED = /** @type {any} */ ("wmire:aimed");
const AIM = /** @type {any} */ ("wmire:aim");
const TILT = /** @type {any} */ ("wmire:tilt");
const HEADINGS = 16;
const REACH = 26;

/** The heading (0-15) and tilt (0 level, 1 up, 2 down) that look from an eye at a point. @param {Vec} c @param {Vec} at */
export function aimAt(c, at) {
  const dx = at.x - c.x, dy = at.y - c.y, dz = at.z - c.z;
  // heading k looks k*22.5 degrees clockwise from north (seen from above): north, east at 4, south at 8, west at 12
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const aim = (Math.round(deg / (360 / HEADINGS)) % HEADINGS + HEADINGS) % HEADINGS;
  const pitch = (Math.atan2(dy, Math.hypot(dx, dz)) * 180) / Math.PI;
  return { aim, tilt: pitch > 20 ? 1 : pitch < -20 ? 2 : 0 };
}

/**
 * The eyes near players, found once a second, turned every few ticks.
 * @type {Map<string, {dim: Dimension, x: number, y: number, z: number, seen: number, aim: number, tilt: number, shut: boolean}>}
 */
const heads = new Map();
/** Who is where they watch (the Mire or the Rift), by id; refreshed once a second. @type {Set<string>} */
const watched = new Set();
/** How long each eye has been stared at, and until when it stays shut. @type {Map<string, {stare: number, until: number}>} */
const stares = new Map();

/**
 * Every second: the eyeblooms within reach of each player in the Mire or the Rift (or anywhere, in tests) are found
 * for tracking, and they weep. @param {(p: Player) => boolean} inZone
 */
export function tick(inZone) {
  watched.clear();
  if (DEBUG.eyes === "never") return heads.clear();
  const t = system.currentTick;
  for (const p of allPlayers()) {
    if ((p.dimension.id !== "minecraft:overworld" && p.dimension.id !== "observer:rift") || (DEBUG.eyes !== "always" && !inZone(p))) continue;
    watched.add(p.id);
    const dim = p.dimension;
    const l = p.location;
    const found = safe(() => dim.getBlocks(new BlockVolume({ x: l.x - REACH, y: l.y - 10, z: l.z - REACH }, { x: l.x + REACH, y: l.y + 12, z: l.z + REACH }), { includeTypes: [HEAD] }, true));
    if (!found) continue;
    let n = 0;
    for (const loc of found.getBlockLocationIterator()) {
      if (++n > 64) break;
      const key = `${dim.id}|${loc.x},${loc.y},${loc.z}`;
      const h = heads.get(key);
      if (h) h.seen = t;
      else heads.set(key, { dim, x: loc.x, y: loc.y, z: loc.z, seen: t, aim: -1, tilt: -1, shut: false });
      const c = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
      // it weeps
      if (Math.random() < 0.3) safe(() => dim.spawnParticle(PARTICLES.eyeSpore, c));
      if (Math.random() < 0.2) safe(() => dim.spawnParticle(PARTICLES.eyeDrip, c));
    }
  }
  for (const [k, h] of heads) if (h.seen < t - 60) heads.delete(k);
  for (const [k, s] of stares) if (!heads.has(k)) stares.delete(k);
}

let turnedSince = 0, shutSince = 0, lastSay = 0;

/** Every 3 ticks: each eye looks at the nearest player it watches; stared at from close by, it shuts. */
export function track() {
  if (!heads.size || !watched.size) return;
  const t = system.currentTick;
  const players = allPlayers().filter((p) => watched.has(p.id));
  const near = players.map((p) => ({ p, dim: p.dimension.id, eye: p.getHeadLocation(), view: p.getViewDirection() }));
  for (const [key, h] of heads) {
    const c = { x: h.x + 0.5, y: h.y + 0.5, z: h.z + 0.5 };
    let best = null, bd = REACH + 4;
    for (const q of near) {
      if (q.dim !== h.dim.id) continue;
      const d = V.dist(c, q.eye);
      if (d < bd) (best = q), (bd = d);
    }
    if (!best) continue;
    // stared at from close by (a second and a half, near enough to touch): it shuts its eye; look away and it opens
    const st = stares.get(key) ?? { stare: 0, until: 0 };
    if (bd < 6 && V.angle(best.view, V.sub(c, best.eye)) < 10) st.stare += 3;
    else st.stare = Math.max(0, st.stare - 6);
    if (st.stare >= 30) st.until = t + 30;
    stares.set(key, st);
    const shut = st.until > t;
    const { aim, tilt } = aimAt(c, best.eye);
    if (aim === h.aim && tilt === h.tilt && shut === h.shut) continue;
    const b = safe(() => h.dim.getBlock({ x: h.x, y: h.y, z: h.z }));
    if (!b) continue;
    if (b.typeId !== HEAD) {
      heads.delete(key);
      continue;
    }
    const ok = safe(() => {
      b.setPermutation(b.permutation.withState(AIMED, true).withState(AIM, aim).withState(TILT, tilt).withState(SHUT, shut));
      return true;
    });
    if (!ok) continue;
    if (aim !== h.aim || tilt !== h.tilt) turnedSince++;
    if (shut && !h.shut) shutSince++;
    Object.assign(h, { aim, tilt, shut });
  }
  if ((turnedSince || shutSince) && t - lastSay >= 20) {
    emit("eyebloom", { what: "look", turned: turnedSince, shut: shutSince, n: heads.size });
    turnedSince = shutSince = 0;
    lastSay = t;
  }
}
