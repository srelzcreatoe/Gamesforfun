// @ts-check
// E17 "It Came Through" — stalking continuity across dimensions.
// A minute or two after a player changes dimension, a heavy arrival sounds near where they came
// through, followed by two steps; footprints lead away from the arrival point. The first time this
// happens in the Nether or the End it records "Elsewhere Too". Scheduled by the dimension-change
// handler, not chosen by the timer.
import { register } from "../director/director.js";
import { SOUNDS } from "../core/constants.js";
import { V, dimIndex } from "../core/util.js";
import { trailAway } from "./common.js";
import { standNear } from "../world/space.js";

register({
  id: "portal_follow",
  tier: 1,
  minStage: 2,
  needsBody: false,
  cooldown: 600,
  manual: true,
  benign: true,
  weight: () => 1,
  async run(enc) {
    const p = enc.p;
    const from = enc.s.followFrom;
    let at = p.location;
    if (from && from[0] === dimIndex(enc.dimId) && V.dist({ x: from[1], y: from[2], z: from[3] }, p.location) < 40) {
      const st = standNear(enc.dim, from[1] + 1.5, from[3] + 1.5, from[2]);
      if (st) at = st.loc;
    }
    if (V.dist(at, p.location) < 6) {
      const back = V.scale(V.flat(p.getViewDirection()), -10);
      const st = standNear(enc.dim, p.location.x + back.x, p.location.z + back.z, p.location.y);
      if (st) at = st.loc;
    }
    enc.sound(SOUNDS.arrival, at, 0.9, 1, "caption.arrival");
    await enc.wait(30);
    enc.sound(SOUNDS.step, at, 0.7, 0.85);
    await enc.wait(12);
    enc.sound(SOUNDS.step, at, 0.6, 0.85);
    const trail = trailAway(enc.dim, at, p.location, 8).reverse();
    enc.leaveTrace(trail);
    enc.footprints(trail);
    if (enc.ctx.d !== 0) {
      enc.discover("elsewhere_too");
      enc.result("followed", true);
    } else enc.result("followed");
  },
});
