// @ts-check
// E13 "Breathing Room" — escalation. Requires stage 4 and aggression >= 1.
// Warning: a rising hum, nearby lights dying, dread fog. It appears in view at 24-34 blocks and
// stares for three seconds (the response window). Then it comes — floating (1.0.6): a block off the
// ground, no footsteps, only rushing air; it surges at you, arms and legs streaming behind, and while
// watched it drifts, upright and limp. Climbing does not save you: it climbs after you (observer/climb.js).
// Water still does: it floats to the water's edge and hovers there, watching.
// Rules: watched, it can only walk; light (>= 11) stops it; water stops it; the Witness Lens or a
// blow makes it recoil. It gives up after 35 s, or when the player is 48+ blocks away and out of
// sight. Reaching the player means one telegraphed, avoidable strike, then it leaves.
// It learns (observer/learn.js): used to light, it needs brighter light; used to water, it waits at
// the shore for up to 15 s and comes on if you climb out; outrun, it follows 16 blocks further.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { litLightsNear } from "../world/manipulate.js";
import { findSpot, standNear } from "../world/space.js";
import { context } from "../director/context.js";
import { sighting, relentless } from "./common.js";
import * as learn from "../observer/learn.js";
import * as climb from "../observer/climb.js";
import * as squeeze from "../observer/squeeze.js";
import { habit } from "../observer/profile.js";

/**
 * It floats to the last dry ground between it and the player in the water, and hovers there.
 * @param {import("../director/encounter.js").Encounter} enc
 */
async function hoverAtShore(enc) {
  const p = enc.p;
  const bl = body.loc();
  if (!bl) return;
  body.setMode("still");
  body.setState("float");
  const dir = V.flat(V.sub(bl, p.location));
  let shore;
  for (let i = 1; i <= Math.min(24, V.hdist(bl, p.location)); i++) {
    const at = V.add(p.location, V.scale(dir, i));
    const st = standNear(enc.dim, at.x, at.z, at.y); // never a liquid surface
    if (st) {
      shore = st.loc;
      break;
    }
  }
  if (!shore) return;
  let pos = bl;
  for (let i = 0; i < 40 && V.dist(pos, shore) > 0.3; i++) {
    pos = V.add(pos, V.scale(V.norm(V.sub(shore, pos)), Math.min(0.5, V.dist(pos, shore))));
    body.moveTo(pos, p.getHeadLocation());
    await enc.wait(2);
  }
  enc.emit("shore", { x: shore.x, y: shore.y, z: shore.z, d: V.dist(shore, p.location) });
}

register({
  id: "pursuit",
  reactNear: false,
  tier: 4,
  minStage: 4,
  needsBody: true,
  minAggression: 1,
  cooldown: 1800,
  weight(c) {
    if (c.water || c.gliding || c.elevated || c.hp < 0.5) return 0;
    if (!(c.night || c.underground || c.light < 8)) return 0;
    return c.underground ? 11 : 7; // caves are where it hunts
  },
  prepare(enc) {
    const p = enc.p;
    // it learned this player outruns it: it starts closer
    const close = Math.round(8 * habit(enc.s, "flee"));
    const spot = findSpot(p, { minDist: 24 - close, maxDist: 34 - close, bearings: [0, 30, -30], spread: 20, concealment: "visible", needLOS: true,
      yMode: enc.ctx.underground ? "near" : "surface" });
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const dim = enc.dim;
    const spot = enc.data.spot;
    enc.restoreDelay = 60;
    // ---- warning
    enc.sound(SOUNDS.hum, spot.loc, 1, 0.9, "caption.hum");
    enc.fog("dread");
    for (const l of litLightsNear(dim, p.location, 10, 5)) {
      if (enc.snuff(l, 300)) enc.sound(SOUNDS.snuff, l, 0.6);
      await enc.wait(4);
    }
    if (!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop })) return enc.result("deferred");
    enc.caption("caption.it_sees_you");
    await enc.wait(60);
    // ---- the chase: it floats
    body.setSilent(true);
    let escapedTicks = 0;
    const lightBonus = learn.lightBonus(enc);
    const escapeAt = 48 + learn.outrunBonus(enc);
    const track = { best: Infinity, since: 0 };
    for (let t = 0; t < 20 * 35; t += 4) {
      await enc.wait(4);
      const bl = body.loc();
      if (!bl) return;
      const dist = V.dist(p.location, bl);
      const c = t % 20 === 0 ? context(p) : null;
      if (c && c.water && learn.adapted(enc.s) === "water" && !enc.data.shoreWaited) {
        // it has learned that you run for the water: it waits at the edge
        enc.data.shoreWaited = true;
        enc.emit("learn", { what: "shore" });
        await hoverAtShore(enc);
        let back = false;
        for (let w = 0; w < 20 * 15 && !back; w += 10) {
          await enc.wait(10);
          back = !context(p).water;
        }
        if (back) continue; // out of the water: the chase goes on
      }
      if (c && c.water) {
        // it does not cross water: it floats to the water's edge and hovers there, watching
        await hoverAtShore(enc);
        await enc.wait(40);
        enc.result("escaped_water", true);
        enc.discover("breathing_room");
        return;
      }
      if (enc.data.lensed || enc.data.hit) {
        enc.data.lensed = enc.data.hit = false;
        body.setMode("still");
        body.setState("recoil");
        await enc.wait(24);
        enc.result("repelled", true);
        return;
      }
      // up a pillar, a ledge, a ladder: it climbs after you
      if (climb.needed(enc) || body.get()?.clinging) {
        if (await climb.after(enc, { state: "surge" })) {
          const nl = body.loc();
          if (nl && V.dist(nl, p.location) <= 2.8) {
            sighting(enc, p);
            await relentless(enc);
            return;
          }
          continue;
        }
      }
      // a wall, a door, glass, a gap too low for it: it finds its own way through (observer/squeeze.js)
      if (await squeeze.unstick(enc, track, t, dist)) continue;
      if (t % 40 === 0) enc.worldSound(SOUNDS.drift, { x: bl.x, y: bl.y + 2, z: bl.z }, 0.8);
      const watched = enc.updateGaze() || body.watchedBy(enc.watchers(), 30);
      const step = V.add(bl, V.scale(V.flat(V.sub(p.location, bl)), 1.5));
      const lightAt = safe(() => dim.getLightLevel({ x: step.x, y: step.y + 1, z: step.z }), 0) ?? 0;
      const playerLight = safe(() => dim.getLightLevel(p.getHeadLocation()), 0) ?? 0;
      if (lightAt >= 11 + lightBonus || (playerLight >= 12 + lightBonus && dist < 10)) {
        body.setMode("still");
        body.setState("recoil");
        await enc.wait(20);
        enc.result("repelled_by_light", true);
        enc.discover("light_it_doesnt_make");
        return;
      }
      if (watched) {
        // watched, it only drifts: upright, limp, still coming
        body.setMode("approach");
        body.setState("float");
        if (enc.gaze.seenTicks >= 60) enc.discover("held_gaze");
      } else {
        // unwatched, it surges through the air
        body.setMode("pursue");
        body.setState("surge");
      }
      escapedTicks = dist > escapeAt && !body.visibleTo([p]) ? escapedTicks + 4 : 0;
      if (escapedTicks >= 80) {
        enc.result("escaped", true);
        enc.discover("breathing_room");
        return;
      }
      if (dist <= 2.7) {
        sighting(enc, p);
        await relentless(enc);
        return;
      }
    }
    enc.result("outlasted", true);
    enc.discover("breathing_room");
  },
});
