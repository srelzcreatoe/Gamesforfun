// @ts-check
// E9 "Behind and to the Left" — the relative-position tell.
// Each player is assigned one favoured bearing (behind-left or behind-right) and distance. The
// Observer keeps returning to exactly that relative position, wherever the player is. A faint
// chime from that direction announces it two seconds before it arrives. Players who learn the
// pattern can turn and catch it; three catches record the discovery.
import { register } from "../director/director.js";
import { SOUNDS } from "../core/constants.js";
import { V } from "../core/util.js";
import { findSpot } from "../world/space.js";
import { observe, sighting, favouredBearing, bearingHit, acknowledge, trailAway } from "./common.js";

register({
  id: "mirror_bearing",
  tier: 2,
  minStage: 2,
  needsBody: true,
  cooldown: 540,
  benign: true,
  weight(c, s) {
    if (c.gliding) return 0;
    return s.bearing ? 9 : 5;
  },
  prepare(enc) {
    const p = enc.p;
    const fb = favouredBearing(enc);
    const yaw = p.getRotation().y;
    const spot = findSpot(p, {
      minDist: fb.dist - 2, maxDist: fb.dist + 2, bearings: [fb.bearing], spread: 8, baseYaw: yaw,
      concealment: "hidden", watchLOSIgnoringView: true, hideFrom: enc.witnesses(), liquidSurface: enc.ctx.water, preferLiquid: enc.ctx.water,
      yMode: enc.ctx.underground ? "near" : "surface",
    });
    if (!spot) return false;
    enc.data.spot = spot;
    return true;
  },
  async run(enc) {
    const p = enc.p;
    const spot = enc.data.spot;
    // the tell: a chime from where it will be
    enc.sound(SOUNDS.tell, { x: spot.loc.x, y: spot.loc.y + 2, z: spot.loc.z }, 0.8, 1, "caption.chime");
    await enc.wait(40);
    if (!enc.spawnBody(spot.loc, { state: "watch", stoop: spot.stoop, side: spot.side })) return enc.result("deferred");
    const r = await observe(enc, { maxTicks: 20 * 9, noticeTicks: 8, approachDist: 10 });
    if (r.noticed) {
      sighting(enc, r.by ?? p);
      bearingHit(enc);
      await acknowledge(enc, 8, 12);
    } else {
      enc.result("unseen");
      enc.leaveTrace(trailAway(enc.dim, spot.loc, p.location, 6));
    }
    enc.log(`bearing ${enc.s.bearing} hits=${enc.s.bearingHits} dist=${V.dist(spot.loc, p.location).toFixed(1)}`);
  },
});
