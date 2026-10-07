// @ts-check
// Shared building blocks for encounter scripts.
import { V, rand, safe } from "../core/util.js";
import { ps, markPlayerDirty } from "../core/state.js";
import * as body from "../observer/body.js";
import { standNear, findSpot } from "../world/space.js";
import { visibility } from "../world/sight.js";

/** @typedef {import("../director/encounter.js").Encounter} Encounter */
/** @typedef {{x:number,y:number,z:number}} Vec */

/**
 * Watch the target until noticed, approached, or time runs out.
 * @param {Encounter} enc
 * @param {{maxTicks:number, noticeTicks?:number, approachDist?:number, stop?:()=>boolean}} o
 * @returns {Promise<{noticed:boolean, approached:boolean, by?:import("@minecraft/server").Player}>}
 */
export async function observe(enc, o) {
  const need = o.noticeTicks ?? 20;
  for (let t = 0; t < o.maxTicks; t += 2) {
    await enc.wait(2);
    enc.updateGaze();
    const l = body.loc();
    if (!l) break;
    if (enc.gaze.seenTicks >= need) return { noticed: true, approached: false, by: enc.gaze.lastWatcher };
    if (o.approachDist && enc.p.location && V.dist(enc.p.location, l) < o.approachDist) return { noticed: enc.gaze.seenTicks > 4, approached: true };
    if (o.stop && o.stop()) break;
  }
  return { noticed: false, approached: false };
}

/** Record a sighting (and its discoveries) for whoever saw it. */
export function sighting(enc, by = enc.p) {
  enc.result("noticed", true);
  const s = ps(by);
  s.sightings++;
  markPlayerDirty(by);
  enc.discover("the_figure", by);
  if (by.id !== enc.pid) enc.discover("second_witness", by);
}

/** The favoured relative bearing: assigned once per player, reused everywhere (a learnable tell). */
export function favouredBearing(enc) {
  const s = enc.s;
  if (!s.bearing) {
    s.bearing = [140, 150, 210, 220][Math.floor(Math.random() * 4)];
    s.bearingDist = Math.round(rand(18, 23));
    markPlayerDirty(enc.p);
  }
  return { bearing: s.bearing, dist: s.bearingDist };
}

/** Count a sighting at the favoured bearing; three of them teach "Behind and to the Left/Right". */
export function bearingHit(enc) {
  enc.s.bearingHits++;
  markPlayerDirty(enc.p);
  if (enc.s.bearingHits >= 3) enc.discover("behind_left");
}

/**
 * A footprint trail leading away from a point (direction away from `from`), snapped to the ground.
 * @param {import("@minecraft/server").Dimension} dim @param {Vec} start @param {Vec} from @param {number} steps
 */
export function trailAway(dim, start, from, steps = 7) {
  const dir = V.flat(V.sub(start, from));
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const p = V.add(start, V.scale(dir, i * 0.9));
    const st = standNear(dim, p.x, p.z, p.y);
    if (!st) break;
    pts.push({ x: p.x, y: st.loc.y, z: p.z });
  }
  return pts;
}

/** A trail between two points (e.g. door to bed). */
export function trailBetween(dim, a, b) {
  const n = Math.min(24, Math.max(2, Math.floor(V.hdist(a, b) / 0.9)));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const p = V.lerp(a, b, i / n);
    const st = standNear(dim, p.x, p.z, p.y);
    if (st) pts.push({ x: p.x, y: st.loc.y, z: p.z });
  }
  return pts;
}

/**
 * Spawn the body only when no watcher can currently see that spot ("it arrives unseen").
 * @returns {Promise<boolean>}
 */
export async function arriveUnseen(enc, spot, opts = {}, waitTicks = 200) {
  const watchers = enc.watchers();
  const ok = await enc.until(() => !watchers.some((w) => w.isValid && visibility(w, spot.loc, { stooped: spot.stoop, fov: 72, maxDist: 160 }).points > 0), waitTicks, 4);
  if (!ok) return false;
  return !!enc.spawnBody(spot.loc, { stoop: spot.stoop, side: spot.side, ...opts });
}

/** After being seen: hold the gaze for a moment, tilt the head, then let cleanup walk it away. */
export async function acknowledge(enc, holdTicks = 14, tiltTicks = 26) {
  body.setState("stare");
  await enc.wait(holdTicks);
  body.setState("tilt");
  await enc.wait(tiltTicks);
}

/** Water exit: sink below the surface, then vanish. */
export async function sink(enc) {
  const b = body.get();
  if (!b) return;
  body.setState("watch");
  enc.sound("observer.sink", b.e.location, 0.8);
  for (let i = 0; i < 24; i++) {
    const l = body.loc();
    if (!l) return;
    body.moveTo({ x: l.x, y: l.y - 0.18, z: l.z });
    await enc.wait(2);
  }
  body.despawn("sank");
}

/** Spot search with progressively looser requirements. */
export function findSpotLoose(p, specs) {
  for (const spec of specs) {
    const s = findSpot(p, spec);
    if (s) return s;
  }
  return undefined;
}

/** Player's horizontal travel direction (from view when barely moving). */
export function travelDir(p) {
  const v = safe(() => p.getVelocity(), { x: 0, y: 0, z: 0 }) ?? { x: 0, y: 0, z: 0 };
  if (Math.hypot(v.x, v.z) > 0.05) return V.flat(v);
  return V.flat(p.getViewDirection());
}
