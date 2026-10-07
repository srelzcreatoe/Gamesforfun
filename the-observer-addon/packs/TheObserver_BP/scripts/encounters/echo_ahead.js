// @ts-check
// E10 "Echo Ahead" — a visual and audible cue predicts where it will be.
// A slow column of dark motes and a chime appear at a spot ahead of the player. A few seconds
// later it stands there — but only if nobody is watching the spot. A player who keeps watching the
// marked place denies it the arrival (it turns up behind them instead, briefly). Either way the
// player who reads the cue learns the rule.
import { register } from "../director/director.js";
import { SOUNDS, PARTICLES } from "../core/constants.js";
import { V } from "../core/util.js";
import { findSpot } from "../world/space.js";
import { visibility } from "../world/sight.js";
import { observe, sighting, acknowledge, favouredBearing, travelDir } from "./common.js";

register({
  id: "echo_ahead",
  tier: 2,
  minStage: 3,
  needsBody: true,
  cooldown: 600,
  benign: true,
  weight(c) {
    if (c.water || c.gliding || c.elevated) return 0;
    return c.moving ? 7 : 4;
  },
  prepare(enc) {
    const p = enc.p;
    const spot = findSpot(p, {
      minDist: 20, maxDist: 32, bearings: [0], spread: 25, baseYaw: V.yawTo({ x: 0, y: 0, z: 0 }, travelDir(p)),
      concealment: "any", needLOS: true, hideFrom: enc.witnesses(), yMode: enc.ctx.underground ? "near" : "surface",
    });
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const spot = enc.data.spot;
    const col = (h) => ({ x: spot.loc.x, y: spot.loc.y + h, z: spot.loc.z });
    for (let i = 0; i < 3; i++) {
      for (let h = 0; h < 4; h++) enc.particle(PARTICLES.motes, col(h * 0.9));
      if (i === 0) enc.sound(SOUNDS.tell, col(2), 0.7, 0.9, "caption.chime_ahead");
      await enc.wait(30);
    }
    // arrive when the spot is out of view; if watched the whole time, it is denied
    let watchedSpot = 0;
    let arrived = false;
    for (let t = 0; t < 20 * 14; t += 4) {
      await enc.wait(4);
      if (visibility(p, spot.loc, { fov: 40, stooped: spot.stoop }).points > 0) watchedSpot += 4;
      else if (!enc.witnesses().some((w) => visibility(w, spot.loc, { fov: 70 }).points > 0)) {
        arrived = !!enc.spawnBody(spot.loc, { state: "stare", stoop: spot.stoop, side: spot.side });
        break;
      }
    }
    if (!arrived) {
      // denied: it shows itself behind them for a moment instead
      const fb = favouredBearing(enc);
      const behind = findSpot(p, { minDist: 10, maxDist: 14, bearings: [fb.bearing], spread: 20, concealment: "hidden", watchLOSIgnoringView: true });
      if (behind) enc.spawnBody(behind.loc, { state: "tilt", stoop: behind.stoop });
      enc.result("denied", watchedSpot > 100);
      if (watchedSpot > 100) enc.discover("echo_ahead");
      if (behind) await observe(enc, { maxTicks: 80, noticeTicks: 6 });
      return;
    }
    const r = await observe(enc, { maxTicks: 20 * 20, noticeTicks: 8, approachDist: 12 });
    if (r.noticed || r.approached) {
      sighting(enc, r.by ?? p);
      enc.discover("echo_ahead");
      await acknowledge(enc, 8, 18);
    } else enc.result("missed");
  },
});
