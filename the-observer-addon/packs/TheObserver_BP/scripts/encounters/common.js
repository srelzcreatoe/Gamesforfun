// @ts-check
// Shared building blocks for encounter scripts.
import { V, rand, safe, DEBUG } from "../core/util.js";
import { ps, markPlayerDirty, now } from "../core/state.js";
import { S, aggression } from "../core/settings.js";
import { SOUNDS } from "../core/constants.js";
import * as body from "../observer/body.js";
import { standNear, findSpot, standAt } from "../world/space.js";
import { visibility, lineOfSight } from "../world/sight.js";
import { effectiveStage } from "../director/context.js";
import { outrunBonus } from "../observer/learn.js";
import * as climb from "../observer/climb.js";
import * as squeeze from "../observer/squeeze.js";
import * as profile from "../observer/profile.js";

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
  // the moment it knows it has been seen: a rattle of clicks and a crack of the neck
  const l = body.loc();
  if (l && !enc.data.noticeSounded) {
    enc.data.noticeSounded = true;
    enc.worldSound(SOUNDS.notice, { x: l.x, y: l.y + 3, z: l.z }, 0.9);
  }
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

/**
 * Should it lunge now that it has been seen? Stage 3+, aggression above "never", and only within the
 * sudden-scare budget (Settings: Sudden scares), so it stays a shock rather than a routine.
 * @param {Encounter} enc
 */
export function wantsLunge(enc) {
  if (DEBUG.lunge === "always") return true;
  if (DEBUG.lunge === "never") return false;
  const sc = S().scares;
  if (sc === 0 || enc.s.stage < 2 || aggression() < 1 || enc.s.witnessed) return false;
  // its own cooldown: 5 min on Standard scares, 10 min on Rare
  if (now() - (enc.s.lungeAt ?? -1e9) < (sc >= 2 ? 300 : 600)) return false;
  const chance = enc.s.stage >= 3 ? (sc >= 2 ? 0.5 : 0.3) : 0.25;
  return Math.random() < chance;
}

/**
 * It has reached the player and does not stop: telegraphed strike after telegraphed strike (0.6 s
 * wind-up each, so stepping back still makes it miss), running them down between strikes, until the
 * player is dead or drives it off with the Witness Lens or a blow. Low aggression strikes once (and is
 * capped); aggression "never" only stops in front of them and everything goes dark.
 * Going up does not help: on a pillar, a ledge or a ladder it climbs after them (observer/climb.js).
 * It does not run: it floats at them a block off the ground (surging, silent but for a rush of air) and
 * strikes from the air. A wall with a gap, a door, glass in the way: it finds its own way through
 * (observer/squeeze.js). Provoked (rage), it comes faster than a sprint, screeching and groaning.
 * @param {Encounter} enc @param {{maxTicks?:number, rage?:boolean}} [o]
 * @returns {Promise<string>} outcome
 */
export async function relentless(enc, o = {}) {
  const p = enc.p;
  const b = body.get();
  if (!b) return "vanished";
  enc.data.reacting = true;
  b.autoPeek = false;
  body.setSilent(true);
  if (aggression() === 0) {
    body.setMode("still");
    body.setState("stare");
    enc.fade(0.1, 0.9, 1.1);
    await enc.wait(12);
    body.despawn("caught");
    enc.result("caught");
    return "caught";
  }
  let hits = 0;
  const end = o.maxTicks ?? 20 * 40;
  const loseAt = 64 + outrunBonus(enc);
  const mode = o.rage ? "rage" : "pursue";
  const track = { best: Infinity, since: 0 };
  if (o.rage) {
    const l0 = body.loc();
    if (l0) enc.worldSound(SOUNDS.shriek, { x: l0.x, y: l0.y + 3, z: l0.z }, 1);
    enc.caption("caption.shriek");
    enc.shake(0.3, 0.8);
    enc.emit("rage", {});
  }
  for (let t = 0; t < end; t += 2) {
    // strikes back to back never pass through enc.wait(): check for an abort (flare, player left) here
    enc.check();
    const l = body.loc();
    if (!l || !p.isValid) return enc.outcome || "vanished";
    if (enc.data.lensed || enc.data.hit) {
      enc.data.lensed = enc.data.hit = false;
      body.setMode("still");
      body.setState("recoil");
      await enc.wait(16);
      body.despawn("repelled");
      enc.result("repelled", true);
      return "repelled";
    }
    const d = V.dist(l, p.location);
    if (d > loseAt) {
      body.despawn("lost_you");
      enc.result("escaped", true);
      return "escaped";
    }
    if (d <= 2.8) {
      const r = await body.strike(p, { recover: 8 });
      if (r === "hit") hits++;
      enc.result(hits ? "struck" : "dodged", true);
      enc.emit("relentless", { hits, result: r });
      if (aggression() === 1) {
        await enc.wait(10);
        body.despawn("struck");
        return enc.outcome;
      }
      track.best = d;
      track.since = t;
      continue;
    }
    // up a pillar, a ledge, a ladder: it climbs after them and strikes from the wall
    if (climb.needed(enc) || body.get()?.clinging) {
      if (await climb.after(enc, { state: "surge" })) continue;
    }
    // a wall with a gap, a door, glass: it finds its own way through
    if (await squeeze.unstick(enc, track, t, d)) continue;
    body.setMode(mode);
    body.surge();
    // no footsteps: only the rush of air as it comes — and, enraged, screeches and groans
    if (t % 40 === 0) enc.worldSound(SOUNDS.drift, { x: l.x, y: l.y + 2, z: l.z }, 0.8);
    if (o.rage && t > 0 && t % 60 === 0) enc.worldSound(t % 120 === 0 ? SOUNDS.shriek : SOUNDS.voice, { x: l.x, y: l.y + 3, z: l.z }, 0.85);
    await enc.wait(2);
  }
  body.despawn("gave_up");
  return enc.outcome || "gave_up";
}

/**
 * The lunge: it shrieks and comes at you through the air in jerks (short unseen-proof hops, ~14 blocks/s,
 * floating a block up), then tears apart right in front of you. On High aggression it strikes instead (still the telegraphed, dodgeable strike).
 * @param {Encounter} enc @param {{harmless?:boolean, test?:boolean}} [o] harmless: never strikes (preview); test: uses no scare budget
 */
export async function lunge(enc, o = {}) {
  const p = enc.p;
  const b = body.get();
  if (!b) return;
  if (!o.harmless && !o.test) {
    enc.s.lungeAt = now();
    markPlayerDirty(p);
  }
  enc.data.reacting = true;
  b.autoPeek = false;
  b.faceTarget = true;
  body.surge();
  enc.worldSound(SOUNDS.shriek, { x: b.e.location.x, y: b.e.location.y + 3, z: b.e.location.z }, 1);
  enc.caption("caption.shriek");
  enc.shake(0.25, 0.6);
  enc.emit("lunge", {});
  for (let i = 0; i < 40; i++) {
    await enc.wait(3);
    const l = body.loc();
    if (!l || !p.isValid) return;
    const d = V.dist(l, p.location);
    if (d <= 3.2) {
      if (aggression() >= 3 && !o.harmless) {
        // High aggression: the lunge does not stop at a scare
        await relentless(enc);
        return;
      } else {
        enc.fade(0.05, 0.2, 0.5);
        enc.result("lunged", true);
      }
      body.despawn("lunge");
      return;
    }
    const dir = V.flat(V.sub(p.location, l));
    const next = V.add(l, V.scale(dir, Math.min(2.3, d - 2.6)));
    const st = standNear(enc.dim, next.x, next.z, next.y);
    if (!st) break;
    body.moveTo(st.loc, p.getHeadLocation());
  }
  enc.result("lunged", true);
  body.despawn("lunge");
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

// ------------------------------------------------------------------ the standoff (1.0.9)

/**
 * The standoff, once it has been seen. It stands and watches: idles, and now and then tests you — the neck
 * cracks, the head tilts, a single slow step toward you while you look. Every time you look away it is a
 * little closer (never inside the too-close distance). Looking at it is one thing; staring at it is another:
 * the longer and the closer you hold it in view, the angrier it gets (from a few seconds at 10 blocks to
 * a dozen at 45), and shooting it or hitting it is worse. It ends one of two ways: it is simply gone (most
 * often once you have looked away for a while, or when it has watched long enough), or it snaps (see
 * provoke). While it is angry its neck cracks and it rattles.
 * @param {Encounter} enc
 * @param {{maxTicks?:number, creep?:boolean, gone?:(why:string)=>void}} [o] gone: how it leaves (default: torn apart)
 * @returns {Promise<"gone"|"provoked">}
 */
export async function standoff(enc, o = {}) {
  const p = enc.p;
  const gone = (why) => {
    if (why === "looked_away") profile.note(p, "look_away");
    enc.emit("standoff", { what: "gone", why, anger: Math.round(enc.data.anger ?? 0) });
    if (o.gone) o.gone(why);
    else body.despawn("standoff");
    return /** @type {"gone"} */ ("gone");
  };
  if (DEBUG.standoff === "off") {
    // tests of other things: the old ending, a moment's stare
    body.setState("stare");
    await enc.wait(Math.round(rand(10, 26)));
    if (o.gone) o.gone("off");
    return "gone";
  }
  const short = DEBUG.standoff === "short";
  if (enc.data.reacting) {
    // already charged at or walked up to: that reaction has it
    await enc.until(() => !body.loc(), 200, 4);
    return "gone";
  }
  // what it has learned of this player: someone who stares it down angers it sooner; someone who looks away, it
  // closes on faster
  const stareH = profile.habit(enc.s, "stare");
  const awayH = profile.habit(enc.s, "look_away");
  enc.data.standoff = true;
  enc.data.anger = 0;
  enc.emit("standoff", { what: "start" });
  const limit = short ? 120 : (o.maxTicks ?? Math.floor(rand(20, 35) * 20));
  const keep = Math.max(enc.data.nearDist ?? 8, 8) + 2.5;
  const stageF = 0.7 + 0.15 * effectiveStage(enc.s, enc.ctx);
  let away = 0, held = 0, creeps = 0;
  try {
    for (let t = 0; t < limit; t += 4) {
      await enc.wait(4);
      const l = body.loc();
      if (!l || !p.isValid) return "gone";
      if (enc.data.reacting) {
        // walked right up to it: the too-close reaction has it now
        await enc.until(() => !body.loc(), 200, 4);
        return "gone";
      }
      if (enc.data.provoked) break;
      const watched = enc.updateGaze();
      const d = V.dist(l, p.location);
      if (d > 72) return gone("lost");
      if (watched) {
        away = 0;
        held += 4;
        // the longer and the closer the stare, the angrier it gets
        enc.data.anger += (380 / Math.max(8, d)) * 0.2 * stageF * (1 + 0.6 * stareH);
        if (held % 60 === 0 && Math.random() < 0.6) await test(enc, d > keep + 3);
        else if (enc.data.anger > 55 && held % 20 === 0) {
          enc.worldSound("observer.crack", { x: l.x, y: l.y + 3, z: l.z }, 0.7);
          if (Math.random() < 0.4) enc.worldSound(SOUNDS.notice, { x: l.x, y: l.y + 3, z: l.z }, 0.5);
        }
      } else {
        away += 4;
        held = 0;
        enc.data.anger = Math.max(0, enc.data.anger - 0.6);
        // looked away long enough: it is gone
        if (short ? away >= 40 : t >= 120 && away >= 60 && Math.random() < 0.08) return gone("looked_away");
        // every time you look away, it is a little closer
        if (o.creep !== false && away % 20 === 0 && d > keep + 1.5 && !body.visibleTo(enc.watchers())) {
          if (await creep(enc, l, d - keep, 1 + 0.8 * awayH)) creeps++;
        }
      }
      if (enc.data.anger >= 100) {
        enc.data.provoked = "stare";
        break;
      }
    }
    if (!enc.data.provoked) return gone("enough");
    return await provoke(enc);
  } finally {
    enc.data.standoff = false;
    enc.emit("standoff", { what: "end", creeps, anger: Math.round(enc.data.anger ?? 0), provoked: enc.data.provoked ?? "" });
  }
}

/** Testing you while you look: a crack of the neck, the head tilting, or one slow step toward you. */
async function test(enc, mayStep) {
  const l = body.loc();
  if (!l) return;
  const r = body.get()?.hide ? 0 : Math.random();
  if (r < 0.35) {
    enc.worldSound("observer.crack", { x: l.x, y: l.y + 3, z: l.z }, 0.8);
    enc.emit("standoff", { what: "test", how: "crack" });
  } else if (r < 0.7 || !mayStep || body.get()?.state === "hang") {
    body.setState("tilt");
    enc.emit("standoff", { what: "test", how: "tilt" });
    await enc.wait(20);
    body.setState("stare");
  } else {
    // a single slow step toward you, while you watch
    const to = V.add(l, V.scale(V.flat(V.sub(enc.p.location, l)), 0.9));
    const st = standNear(enc.dim, to.x, to.z, l.y);
    if (!st) return;
    body.setState("walk");
    enc.emit("standoff", { what: "test", how: "step" });
    for (let i = 1; i <= 6; i++) {
      body.moveTo(V.lerp(l, st.loc, i / 6), enc.p.getHeadLocation());
      await enc.wait(2);
    }
    body.setState("stare");
  }
}

/** While unwatched: a little closer, 2-3.5 blocks (more for a player it knows looks away; down off a ceiling first). @returns {Promise<boolean>} */
async function creep(enc, l, room, bold = 1) {
  const p = enc.p;
  const b = body.get();
  if (!b) return false;
  if (b.state === "hang") {
    // it lets go of the ceiling: when you look back it is standing below where it hung
    const g = body.groundNear(enc.dim, { x: l.x, y: l.y + 1, z: l.z });
    if (!g) return false;
    body.moveTo(g, p.getHeadLocation());
    body.setState("stare");
    enc.emit("standoff", { what: "creep", from: "ceiling" });
    return true;
  }
  const stepLen = Math.min(room, rand(2, 3.5) * bold);
  if (stepLen < 1) return false;
  // out from behind its tree
  b.hide = undefined;
  const to = V.add(l, V.scale(V.flat(V.sub(p.location, l)), stepLen));
  const st = standNear(enc.dim, to.x, to.z, l.y);
  if (!st || V.dist(st.loc, l) < 1) return false;
  body.moveTo(st.loc, p.getHeadLocation());
  body.setStoop(st.stoop);
  body.setState("stare");
  enc.emit("standoff", { what: "creep", d: V.dist(st.loc, p.location) });
  return true;
}

/**
 * It snaps. From stage 2 (one stage earlier in the Weeping Mire), and with aggression above "never", it is a
 * rage: its head snaps round, it shrieks and comes at you faster than a sprint, through whatever is in the way
 * (relentless, rage). Before that, or with aggression "never", it shrieks and comes at you, and is gone.
 * @param {Encounter} enc @returns {Promise<"provoked">}
 */
export async function provoke(enc) {
  const why = enc.data.provoked || "stare";
  enc.data.provoked = why;
  profile.note(enc.p, why === "stare" ? "stare" : "attack");
  enc.emit("standoff", { what: "provoked", why });
  enc.result("provoked", true);
  const l = body.loc();
  if (body.get()?.state === "hang" && l) {
    const g = body.groundNear(enc.dim, { x: l.x, y: l.y + 1, z: l.z });
    if (g) body.moveTo(g, enc.p.getHeadLocation());
  }
  body.setState("stare");
  if (l) enc.worldSound("observer.crack", { x: l.x, y: l.y + 3, z: l.z }, 1);
  await enc.wait(6);
  const rage = aggression() >= 1 && !enc.s.witnessed && effectiveStage(enc.s, enc.ctx) >= 2;
  if (rage) await relentless(enc, { rage: true });
  else await lunge(enc, { harmless: true });
  return "provoked";
}

/**
 * Stalking from a cave ceiling: a spot 12-28 blocks off where the open space under the ceiling is at least six
 * blocks high, in sight of the player (both ways). It hangs by its feet from the ceiling, upside down.
 * @param {import("@minecraft/server").Player} p
 * @returns {{loc:Vec, stoop:boolean, vis:number, side:number, hang:true, ceiling:number, score:number}|undefined}
 */
export function hangSpot(p) {
  const dim = p.dimension;
  const eye = p.getHeadLocation();
  let best;
  for (let i = 0; i < 48; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(12, 28);
    const x = Math.floor(p.location.x + Math.cos(a) * r) + 0.5, z = Math.floor(p.location.z + Math.sin(a) * r) + 0.5;
    let st;
    for (const dy of [1.5, 4.5, -2.5]) {
      st = standAt(dim, x, z, p.location.y + dy, 10);
      if (st) break;
    }
    if (!st || st.liquid) continue;
    const ceil = safe(() => dim.getBlockAbove({ x, y: st.loc.y + 0.2, z }, { includePassableBlocks: false, includeLiquidBlocks: true, maxDistance: 16 }));
    if (!ceil || ceil.isLiquid) continue;
    const top = ceil.location.y;
    if (top - st.loc.y < 6) continue;
    const origin = { x, y: top - 4.05, z };
    const mid = { x, y: origin.y + 2, z };
    if (!lineOfSight(dim, eye, mid).clear || !lineOfSight(dim, mid, eye).clear) continue;
    const light = safe(() => dim.getLightLevel(mid), 8) ?? 8;
    const score = (15 - light) * 0.3 + Math.random();
    if (!best || score > best.score) best = { loc: origin, stoop: false, vis: 3, side: 1, hang: /** @type {true} */ (true), ceiling: top, score };
  }
  return best;
}

