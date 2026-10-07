// @ts-check
// E13 "Breathing Room" — escalation. Requires stage 5 and aggression >= 1.
// Warning: a rising hum, nearby lights dying, dread fog. It appears in view at 24-34 blocks and
// stares for three seconds (the response window). Then it runs.
// Rules: watched, it can only walk; light (>= 11) stops it; water stops it; the Witness Lens or a
// blow makes it recoil. It gives up after 35 s, or when the player is 48+ blocks away and out of
// sight. Reaching the player means one telegraphed, avoidable strike, then it leaves.
import { register } from "../director/director.js";
import * as body from "../observer/body.js";
import { SOUNDS } from "../core/constants.js";
import { V, safe } from "../core/util.js";
import { litLightsNear } from "../world/manipulate.js";
import { findSpot } from "../world/space.js";
import { context } from "../director/context.js";
import { sighting } from "./common.js";

register({
  id: "pursuit",
  tier: 4,
  minStage: 5,
  needsBody: true,
  minAggression: 1,
  cooldown: 1800,
  weight(c) {
    if (c.water || c.gliding || c.elevated || c.hp < 0.5) return 0;
    if (!(c.night || c.underground || c.light < 8)) return 0;
    return 7;
  },
  prepare(enc) {
    const p = enc.p;
    const spot = findSpot(p, { minDist: 24, maxDist: 34, bearings: [0, 30, -30], spread: 20, concealment: "visible", needLOS: true,
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
    // ---- the chase
    let escapedTicks = 0;
    for (let t = 0; t < 20 * 35; t += 4) {
      await enc.wait(4);
      const bl = body.loc();
      if (!bl) return;
      const dist = V.dist(p.location, bl);
      const c = t % 20 === 0 ? context(p) : null;
      if (c && c.water) {
        body.setMode("still");
        body.setState("stare");
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
      const watched = enc.updateGaze() || body.watchedBy(enc.watchers(), 30);
      const step = V.add(bl, V.scale(V.flat(V.sub(p.location, bl)), 1.5));
      const lightAt = safe(() => dim.getLightLevel({ x: step.x, y: step.y + 1, z: step.z }), 0) ?? 0;
      const playerLight = safe(() => dim.getLightLevel(p.getHeadLocation()), 0) ?? 0;
      if (lightAt >= 11 || (playerLight >= 12 && dist < 10)) {
        body.setMode("still");
        body.setState("recoil");
        await enc.wait(20);
        enc.result("repelled_by_light", true);
        enc.discover("light_it_doesnt_make");
        return;
      }
      if (watched) {
        body.setMode("approach");
        body.setState("walk");
        if (enc.gaze.seenTicks >= 60) enc.discover("held_gaze");
      } else {
        body.setMode("pursue");
        body.setState("run");
      }
      escapedTicks = dist > 48 && !body.visibleTo([p]) ? escapedTicks + 4 : 0;
      if (escapedTicks >= 80) {
        enc.result("escaped", true);
        enc.discover("breathing_room");
        return;
      }
      if (dist <= 2.7) {
        const r = await body.strike(p);
        sighting(enc, p);
        enc.result(r === "hit" ? "struck" : "dodged", true);
        await enc.wait(16);
        return;
      }
    }
    enc.result("outlasted", true);
    enc.discover("breathing_room");
  },
});
